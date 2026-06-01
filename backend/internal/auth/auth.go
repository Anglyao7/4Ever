package auth

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"image/gif"
	"image/jpeg"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"4ever/backend/internal/config"
	"4ever/backend/internal/httputil"
	"4ever/backend/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/pbkdf2"
	"gorm.io/gorm"
)

const passwordIterations = 210000

type Handler struct {
	DB       *gorm.DB
	Settings config.Settings
}

type SignUpRequest struct {
	Username    string  `json:"username" binding:"required,min=3,max=80"`
	Email       string  `json:"email" binding:"required,min=5,max=160"`
	Password    string  `json:"password" binding:"required,min=8,max=128"`
	DisplayName *string `json:"display_name" binding:"omitempty,max=120"`
}

type SignInRequest struct {
	Identifier string `json:"identifier" binding:"required,max=160"`
	Password   string `json:"password" binding:"required,max=128"`
}

type AccountUpdateRequest struct {
	DisplayName *string `json:"display_name" binding:"omitempty,min=1,max=120"`
	Email       *string `json:"email" binding:"omitempty,min=5,max=160"`
}

type AvatarUploadRequest struct {
	Filename    string `json:"filename" binding:"required,max=240"`
	ContentType string `json:"content_type" binding:"required,max=120"`
	DataBase64  string `json:"data_base64" binding:"required"`
}

type PasswordChangeRequest struct {
	CurrentPassword string `json:"current_password" binding:"required,max=128"`
	NewPassword     string `json:"new_password" binding:"required,min=8,max=128"`
}

type AuthUser struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	AvatarURL   *string   `json:"avatar_url"`
	Role        string    `json:"role"`
	CreatedAt   time.Time `json:"created_at"`
}

type AuthResponse struct {
	Token string   `json:"token"`
	User  AuthUser `json:"user"`
}

type UserSearchResult struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	Email       string  `json:"email"`
	DisplayName string  `json:"display_name"`
	Status      string  `json:"status"`
	Bio         string  `json:"bio"`
	AvatarURL   *string `json:"avatar_url"`
}

func Register(group *gin.RouterGroup, h Handler) {
	r := group.Group("/auth")
	r.POST("/sign-up", h.SignUp)
	r.POST("/sign-in", h.SignIn)
	r.GET("/me", h.Me)
	r.GET("/users/search", h.SearchUsers)
	r.PATCH("/me", h.UpdateMe)
	r.POST("/me/avatar", h.UploadAvatar)
	r.POST("/password", h.ChangePassword)
}

func (h Handler) SignUp(c *gin.Context) {
	var req SignUpRequest
	if !httputil.BindJSON(c, &req) {
		return
	}
	username := NormalizeUsername(req.Username)
	email := NormalizeEmail(req.Email)
	if !strings.Contains(email, "@") {
		httputil.Error(c, http.StatusUnprocessableEntity, "Email is invalid.")
		return
	}
	var existing models.User
	if err := h.DB.Where("username = ? OR email = ?", username, email).First(&existing).Error; err == nil {
		httputil.Error(c, http.StatusConflict, "Username or email already exists.")
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		httputil.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	displayName := strings.TrimSpace(req.Username)
	if req.DisplayName != nil {
		displayName = strings.TrimSpace(*req.DisplayName)
	}
	if displayName == "" {
		displayName = strings.TrimSpace(req.Username)
	}
	user := models.User{
		ID:           uuid.NewString(),
		Username:     username,
		Email:        email,
		DisplayName:  displayName,
		PasswordHash: HashPassword(req.Password),
		Role:         "member",
	}
	token, session := NewSession(user.ID)
	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		return tx.Create(&session).Error
	}); err != nil {
		httputil.Error(c, http.StatusConflict, "Username or email already exists.")
		return
	}
	c.JSON(http.StatusOK, AuthResponse{Token: token, User: ToAuthUser(user)})
}

func (h Handler) SignIn(c *gin.Context) {
	var req SignInRequest
	if !httputil.BindJSON(c, &req) {
		return
	}
	identifier := NormalizeEmail(req.Identifier)
	var user models.User
	if err := h.DB.Where("username = ? OR email = ?", identifier, identifier).First(&user).Error; err != nil {
		httputil.Error(c, http.StatusUnauthorized, "Invalid username/email or password.")
		return
	}
	if !VerifyPassword(req.Password, user.PasswordHash) {
		httputil.Error(c, http.StatusUnauthorized, "Invalid username/email or password.")
		return
	}
	now := time.Now().UTC()
	token, session := NewSession(user.ID)
	user.LoginCount++
	user.LastLoginAt = &now
	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&user).Error; err != nil {
			return err
		}
		return tx.Create(&session).Error
	}); err != nil {
		httputil.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, AuthResponse{Token: token, User: ToAuthUser(user)})
}

func (h Handler) Me(c *gin.Context) {
	user, ok := ResolveUser(c, h.DB)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, ToAuthUser(user))
}

func (h Handler) SearchUsers(c *gin.Context) {
	rawQuery, exists := c.GetQuery("q")
	if !exists {
		httputil.Error(c, http.StatusUnprocessableEntity, "q is required")
		return
	}
	query := NormalizeEmail(rawQuery)
	if query == "" {
		httputil.Error(c, http.StatusUnprocessableEntity, "q is required")
		return
	}
	if len([]rune(query)) > 160 {
		httputil.Error(c, http.StatusUnprocessableEntity, "q must be 160 characters or fewer.")
		return
	}
	current, ok := ResolveUser(c, h.DB)
	if !ok {
		return
	}
	pattern := "%" + query + "%"
	var users []models.User
	if err := h.DB.Where(
		"id <> ? AND (LOWER(username) LIKE ? OR LOWER(email) LIKE ? OR LOWER(display_name) LIKE ?)",
		current.ID, pattern, pattern, pattern,
	).Order("username ASC").Limit(12).Find(&users).Error; err != nil {
		httputil.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	results := make([]UserSearchResult, 0, len(users))
	for _, user := range users {
		results = append(results, ToUserSearchResult(user))
	}
	c.JSON(http.StatusOK, results)
}

func (h Handler) UpdateMe(c *gin.Context) {
	user, ok := ResolveUser(c, h.DB)
	if !ok {
		return
	}
	var req AccountUpdateRequest
	if !httputil.BindJSON(c, &req) {
		return
	}
	if req.Email != nil {
		email := NormalizeEmail(*req.Email)
		if !strings.Contains(email, "@") {
			httputil.Error(c, http.StatusUnprocessableEntity, "Email is invalid.")
			return
		}
		var existing models.User
		if err := h.DB.Where("email = ? AND id <> ?", email, user.ID).First(&existing).Error; err == nil {
			httputil.Error(c, http.StatusConflict, "Email already exists.")
			return
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			httputil.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		user.Email = email
	}
	if req.DisplayName != nil {
		user.DisplayName = strings.TrimSpace(*req.DisplayName)
	}
	if err := h.DB.Save(&user).Error; err != nil {
		httputil.Error(c, http.StatusConflict, "Account update conflicts with an existing user.")
		return
	}
	c.JSON(http.StatusOK, ToAuthUser(user))
}

func (h Handler) UploadAvatar(c *gin.Context) {
	user, ok := ResolveUser(c, h.DB)
	if !ok {
		return
	}
	var req AvatarUploadRequest
	if !httputil.BindJSON(c, &req) {
		return
	}
	contentType := strings.ToLower(strings.TrimSpace(req.ContentType))
	extByType := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
	ext, ok := extByType[contentType]
	if !ok {
		httputil.Error(c, http.StatusUnsupportedMediaType, "Avatar must be JPG, PNG, WEBP, or GIF.")
		return
	}
	data, err := strictBase64Decode(req.DataBase64)
	if err != nil {
		httputil.Error(c, http.StatusUnprocessableEntity, "Avatar data is invalid.")
		return
	}
	if len(data) == 0 {
		httputil.Error(c, http.StatusUnprocessableEntity, "Avatar file is empty.")
		return
	}
	if len(data) > 3*1024*1024 {
		httputil.Error(c, http.StatusRequestEntityTooLarge, "Avatar must be 3 MB or smaller.")
		return
	}
	if !isSupportedAvatarImage(data, contentType) {
		httputil.Error(c, http.StatusUnsupportedMediaType, "Avatar content is not a supported image.")
		return
	}
	avatarDir := filepath.Join(h.Settings.MediaRoot, h.Settings.AvatarUploadDirname)
	if err := os.MkdirAll(avatarDir, 0o755); err != nil {
		httputil.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	target := filepath.Join(avatarDir, user.ID+ext)
	if user.AvatarPath != nil {
		oldPath := filepath.Join(h.Settings.MediaRoot, strings.Trim(*user.AvatarPath, "/"))
		if oldPath != target {
			_ = os.Remove(oldPath)
		}
	}
	if err := os.WriteFile(target, data, 0o644); err != nil {
		httputil.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	stored := h.Settings.AvatarUploadDirname + "/" + filepath.Base(target)
	user.AvatarPath = &stored
	if err := h.DB.Save(&user).Error; err != nil {
		httputil.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, ToAuthUser(user))
}

func (h Handler) ChangePassword(c *gin.Context) {
	user, ok := ResolveUser(c, h.DB)
	if !ok {
		return
	}
	var req PasswordChangeRequest
	if !httputil.BindJSON(c, &req) {
		return
	}
	if !VerifyPassword(req.CurrentPassword, user.PasswordHash) {
		httputil.Error(c, http.StatusUnauthorized, "Current password is incorrect.")
		return
	}
	user.PasswordHash = HashPassword(req.NewPassword)
	if err := h.DB.Save(&user).Error; err != nil {
		httputil.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func ResolveUser(c *gin.Context, db *gorm.DB) (models.User, bool) {
	header := c.GetHeader("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		httputil.Error(c, http.StatusUnauthorized, "Missing auth token.")
		return models.User{}, false
	}
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	var session models.AuthSession
	if err := db.Where("token_hash = ?", HashToken(token)).First(&session).Error; err != nil {
		httputil.Error(c, http.StatusUnauthorized, "Invalid auth token.")
		return models.User{}, false
	}
	var user models.User
	if err := db.First(&user, "id = ?", session.UserID).Error; err != nil {
		httputil.Error(c, http.StatusUnauthorized, "Invalid auth token.")
		return models.User{}, false
	}
	return user, true
}

func NormalizeUsername(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func NormalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func HashPassword(password string) string {
	salt := randomHex(16)
	digest := pbkdf2.Key([]byte(password), []byte(salt), passwordIterations, 32, sha256.New)
	return fmt.Sprintf("pbkdf2_sha256$%d$%s$%s", passwordIterations, salt, hex.EncodeToString(digest))
}

func VerifyPassword(password string, passwordHash string) bool {
	parts := strings.SplitN(passwordHash, "$", 4)
	if len(parts) != 4 || parts[0] != "pbkdf2_sha256" {
		return false
	}
	iterations := passwordIterations
	fmt.Sscanf(parts[1], "%d", &iterations)
	digest := pbkdf2.Key([]byte(password), []byte(parts[2]), iterations, 32, sha256.New)
	expected, err := hex.DecodeString(parts[3])
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(digest, expected) == 1
}

func NewSession(userID string) (string, models.AuthSession) {
	token := randomURLSafe(32)
	return token, models.AuthSession{UserID: userID, TokenHash: HashToken(token)}
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func ToAuthUser(user models.User) AuthUser {
	return AuthUser{
		ID:          user.ID,
		Username:    user.Username,
		Email:       user.Email,
		DisplayName: user.DisplayName,
		AvatarURL:   BuildPublicAvatarURL(user.AvatarPath),
		Role:        user.Role,
		CreatedAt:   user.CreatedAt,
	}
}

func ToUserSearchResult(user models.User) UserSearchResult {
	return UserSearchResult{
		ID:          user.ID,
		Username:    user.Username,
		Email:       user.Email,
		DisplayName: user.DisplayName,
		Status:      "active",
		Bio:         "",
		AvatarURL:   BuildPublicAvatarURL(user.AvatarPath),
	}
}

func BuildPublicAvatarURL(path *string) *string {
	if path == nil || strings.TrimSpace(*path) == "" {
		return nil
	}
	value := "/api/media/" + strings.TrimLeft(*path, "/")
	return &value
}

func isSupportedAvatarImage(data []byte, contentType string) bool {
	reader := bytes.NewReader(data)
	switch contentType {
	case "image/jpeg":
		_, err := jpeg.DecodeConfig(reader)
		return err == nil
	case "image/png":
		_, err := png.DecodeConfig(reader)
		return err == nil
	case "image/gif":
		_, err := gif.DecodeConfig(reader)
		return err == nil
	case "image/webp":
		return len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP"
	default:
		return false
	}
}

func strictBase64Decode(value string) ([]byte, error) {
	if strings.IndexFunc(value, func(r rune) bool {
		return !((r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '+' || r == '/' || r == '=')
	}) >= 0 {
		return nil, base64.CorruptInputError(0)
	}
	return base64.StdEncoding.Strict().DecodeString(value)
}

func randomHex(bytes int) string {
	buf := make([]byte, bytes)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

func randomURLSafe(bytes int) string {
	buf := make([]byte, bytes)
	_, _ = rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}
