package chat

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"

	"4ever/backend/internal/auth"
	"4ever/backend/internal/catalog"
	"4ever/backend/internal/config"
	"4ever/backend/internal/httputil"
	"4ever/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Handler struct {
	DB       *gorm.DB
	Settings config.Settings
}

type DirectAttachment struct {
	ID      *string `json:"id"`
	Name    *string `json:"name"`
	Type    *string `json:"type"`
	Size    int     `json:"size"`
	Kind    *string `json:"kind"`
	DataURL *string `json:"data_url"`
}

type DirectReplyReference struct {
	ID         *uint      `json:"id"`
	AuthorName *string    `json:"author_name"`
	Content    string     `json:"content"`
	CreatedAt  *time.Time `json:"created_at"`
	SenderID   *string    `json:"sender_id"`
}

type DirectMessageCreate struct {
	Content          string             `json:"content"`
	Attachments      []DirectAttachment `json:"attachments"`
	ReplyToMessageID *uint              `json:"reply_to_message_id"`
}

type DirectMessageResponse struct {
	ID               uint                  `json:"id"`
	SenderID         string                `json:"sender_id"`
	RecipientID      string                `json:"recipient_id"`
	Content          string                `json:"content"`
	Attachments      []DirectAttachment    `json:"attachments"`
	ReplyToMessageID *uint                 `json:"reply_to_message_id"`
	ReplyTo          *DirectReplyReference `json:"reply_to"`
	CreatedAt        time.Time             `json:"created_at"`
}

type FriendProfile struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	Email       string  `json:"email"`
	DisplayName string  `json:"display_name"`
	Status      string  `json:"status"`
	Bio         string  `json:"bio"`
	AvatarURL   *string `json:"avatar_url"`
}

type FriendRequestResponse struct {
	ID          uint          `json:"id"`
	Requester   FriendProfile `json:"requester"`
	Addressee   FriendProfile `json:"addressee"`
	Status      string        `json:"status"`
	CreatedAt   time.Time     `json:"created_at"`
	RespondedAt *time.Time    `json:"responded_at"`
}

type FriendshipResponse struct {
	User      FriendProfile `json:"user"`
	CreatedAt time.Time     `json:"created_at"`
}

type FriendSummaryResponse struct {
	Friends          []FriendshipResponse    `json:"friends"`
	IncomingRequests []FriendRequestResponse `json:"incoming_requests"`
	OutgoingRequests []FriendRequestResponse `json:"outgoing_requests"`
}

func Register(group *gin.RouterGroup, h Handler) {
	r := group.Group("/chat")
	r.POST("", h.Chat)
	r.POST("/stream", h.ChatStream)
	r.GET("/friends", h.ListFriends)
	r.POST("/friends/request/:user_id", h.RequestFriend)
	r.POST("/friends/requests/:request_id/accept", h.AcceptFriendRequest)
	r.POST("/friends/requests/:request_id/reject", h.RejectFriendRequest)
	r.DELETE("/friends/:user_id", h.RemoveFriend)
	r.GET("/direct/:user_id", h.ListDirectMessages)
	r.POST("/direct/:user_id", h.SendDirectMessage)
}

func (h Handler) Chat(c *gin.Context) {
	var req catalog.ChatCompletionRequest
	if !httputil.BindJSON(c, &req) {
		return
	}
	resp, status, detail := catalog.CompleteChat(h.Settings, req)
	if status >= 400 {
		httputil.Error(c, status, detail)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h Handler) ChatStream(c *gin.Context) {
	var req catalog.ChatCompletionRequest
	if !httputil.BindJSON(c, &req) {
		return
	}
	c.Header("Cache-Control", "no-cache")
	c.Header("X-Accel-Buffering", "no")
	c.Header("Content-Type", "text/plain; charset=utf-8")
	status, detail := catalog.StreamChat(h.Settings, req, func(chunk string) error {
		_, err := c.Writer.Write([]byte(chunk))
		c.Writer.Flush()
		return err
	})
	if status >= 400 {
		httputil.Error(c, status, detail)
	}
}

func (h Handler) ListFriends(c *gin.Context) {
	user, ok := auth.ResolveUser(c, h.DB)
	if !ok {
		return
	}
	var friendships []models.Friendship
	h.DB.Where("user_a_id = ? OR user_b_id = ?", user.ID, user.ID).Order("created_at DESC").Find(&friendships)
	var incoming []models.FriendRequest
	h.DB.Where("addressee_id = ? AND status = ?", user.ID, "pending").Order("created_at DESC").Find(&incoming)
	var outgoing []models.FriendRequest
	h.DB.Where("requester_id = ? AND status = ?", user.ID, "pending").Order("created_at DESC").Find(&outgoing)
	summary := FriendSummaryResponse{Friends: []FriendshipResponse{}, IncomingRequests: []FriendRequestResponse{}, OutgoingRequests: []FriendRequestResponse{}}
	for _, friendship := range friendships {
		peerID := friendship.UserBID
		if friendship.UserBID == user.ID {
			peerID = friendship.UserAID
		}
		if peer, ok := h.userByID(peerID); ok {
			summary.Friends = append(summary.Friends, FriendshipResponse{User: toFriendProfile(peer), CreatedAt: friendship.CreatedAt})
		}
	}
	for _, request := range incoming {
		if item, ok := h.toFriendRequest(request); ok {
			summary.IncomingRequests = append(summary.IncomingRequests, item)
		}
	}
	for _, request := range outgoing {
		if item, ok := h.toFriendRequest(request); ok {
			summary.OutgoingRequests = append(summary.OutgoingRequests, item)
		}
	}
	c.JSON(http.StatusOK, summary)
}

func (h Handler) RequestFriend(c *gin.Context) {
	user, ok := auth.ResolveUser(c, h.DB)
	if !ok {
		return
	}
	peerID := c.Param("user_id")
	if _, ok := h.ensureDirectPeer(c, peerID, user.ID, false); !ok {
		return
	}
	if h.areFriends(user.ID, peerID) {
		httputil.Error(c, http.StatusConflict, "Already friends.")
		return
	}
	var reverse models.FriendRequest
	if err := h.DB.Where("requester_id = ? AND addressee_id = ? AND status = ?", peerID, user.ID, "pending").First(&reverse).Error; err == nil {
		h.acceptFriendRequestRecord(c, reverse)
		return
	}
	var existing models.FriendRequest
	if err := h.DB.Where("requester_id = ? AND addressee_id = ?", user.ID, peerID).First(&existing).Error; err == nil {
		existing.Status = "pending"
		existing.RespondedAt = nil
		h.DB.Save(&existing)
		if item, ok := h.toFriendRequest(existing); ok {
			c.JSON(http.StatusOK, item)
		}
		return
	}
	request := models.FriendRequest{RequesterID: user.ID, AddresseeID: peerID, Status: "pending"}
	if err := h.DB.Create(&request).Error; err != nil {
		httputil.Error(c, http.StatusConflict, "Friend request already exists.")
		return
	}
	if item, ok := h.toFriendRequest(request); ok {
		c.JSON(http.StatusOK, item)
	}
}

func (h Handler) AcceptFriendRequest(c *gin.Context) {
	user, ok := auth.ResolveUser(c, h.DB)
	if !ok {
		return
	}
	request, ok := h.pendingIncomingRequest(c, user.ID)
	if !ok {
		return
	}
	h.acceptFriendRequestRecord(c, request)
}

func (h Handler) RejectFriendRequest(c *gin.Context) {
	user, ok := auth.ResolveUser(c, h.DB)
	if !ok {
		return
	}
	request, ok := h.pendingIncomingRequest(c, user.ID)
	if !ok {
		return
	}
	now := time.Now().UTC()
	request.Status = "rejected"
	request.RespondedAt = &now
	h.DB.Save(&request)
	if item, ok := h.toFriendRequest(request); ok {
		c.JSON(http.StatusOK, item)
	}
}

func (h Handler) RemoveFriend(c *gin.Context) {
	user, ok := auth.ResolveUser(c, h.DB)
	if !ok {
		return
	}
	left, right := friendPair(user.ID, c.Param("user_id"))
	h.DB.Where("user_a_id = ? AND user_b_id = ?", left, right).Delete(&models.Friendship{})
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h Handler) ListDirectMessages(c *gin.Context) {
	user, ok := auth.ResolveUser(c, h.DB)
	if !ok {
		return
	}
	peerID := c.Param("user_id")
	if _, ok := h.ensureDirectPeer(c, peerID, user.ID, true); !ok {
		return
	}
	var messages []models.DirectMessage
	h.DB.Where(
		"(sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)",
		user.ID, peerID, peerID, user.ID,
	).Order("created_at ASC, id ASC").Limit(300).Find(&messages)
	out := make([]DirectMessageResponse, 0, len(messages))
	for _, message := range messages {
		out = append(out, toDirectMessage(message))
	}
	c.JSON(http.StatusOK, out)
}

func (h Handler) SendDirectMessage(c *gin.Context) {
	user, ok := auth.ResolveUser(c, h.DB)
	if !ok {
		return
	}
	peerID := c.Param("user_id")
	if _, ok := h.ensureDirectPeer(c, peerID, user.ID, true); !ok {
		return
	}
	var req DirectMessageCreate
	if !httputil.BindJSON(c, &req) {
		return
	}
	if strings.TrimSpace(req.Content) == "" && len(req.Attachments) == 0 {
		httputil.Error(c, http.StatusUnprocessableEntity, "Message content or attachment is required.")
		return
	}
	if len([]rune(req.Content)) > 20000 {
		httputil.Error(c, http.StatusUnprocessableEntity, "Message content must be 20000 characters or fewer.")
		return
	}
	attachments := req.Attachments
	if len(attachments) > 4 {
		attachments = attachments[:4]
	}
	if ok := validateAttachments(c, attachments); !ok {
		return
	}
	attachmentJSON, _ := json.Marshal(attachments)
	attachmentRaw := string(attachmentJSON)
	var replyPreview *string
	var replyID *uint
	if req.ReplyToMessageID != nil {
		target, ok := h.ensureReplyTarget(c, *req.ReplyToMessageID, user.ID, peerID)
		if !ok {
			return
		}
		replyID = &target.ID
		preview := directReplyPreview(target, user.ID)
		raw, _ := json.Marshal(preview)
		text := string(raw)
		replyPreview = &text
	}
	message := models.DirectMessage{SenderID: user.ID, RecipientID: peerID, Content: strings.TrimSpace(req.Content), AttachmentsJSON: &attachmentRaw, ReplyToMessageID: replyID, ReplyToPreviewJSON: replyPreview}
	h.DB.Create(&message)
	c.JSON(http.StatusOK, toDirectMessage(message))
}

func validateAttachments(c *gin.Context, attachments []DirectAttachment) bool {
	for _, attachment := range attachments {
		if attachment.ID == nil || attachment.Name == nil || attachment.Type == nil || attachment.Kind == nil {
			httputil.Error(c, http.StatusUnprocessableEntity, "Attachment id, name, type, and kind are required.")
			return false
		}
		if attachment.Size < 0 {
			httputil.Error(c, http.StatusUnprocessableEntity, "Attachment size must be greater than or equal to 0.")
			return false
		}
	}
	return true
}

func (h Handler) ensureDirectPeer(c *gin.Context, peerID string, currentID string, requireFriendship bool) (models.User, bool) {
	if peerID == currentID {
		httputil.Error(c, http.StatusBadRequest, "Cannot send a direct message to yourself.")
		return models.User{}, false
	}
	peer, ok := h.userByID(peerID)
	if !ok {
		httputil.Error(c, http.StatusNotFound, "User not found.")
		return models.User{}, false
	}
	if requireFriendship && !h.areFriends(currentID, peerID) {
		httputil.Error(c, http.StatusForbidden, "Friend approval is required before messaging.")
		return models.User{}, false
	}
	return peer, true
}

func (h Handler) pendingIncomingRequest(c *gin.Context, currentID string) (models.FriendRequest, bool) {
	var request models.FriendRequest
	if err := h.DB.First(&request, "id = ?", c.Param("request_id")).Error; err != nil || request.AddresseeID != currentID || request.Status != "pending" {
		httputil.Error(c, http.StatusNotFound, "Friend request not found.")
		return models.FriendRequest{}, false
	}
	return request, true
}

func (h Handler) acceptFriendRequestRecord(c *gin.Context, request models.FriendRequest) {
	now := time.Now().UTC()
	request.Status = "accepted"
	request.RespondedAt = &now
	left, right := friendPair(request.RequesterID, request.AddresseeID)
	h.DB.Transaction(func(tx *gorm.DB) error {
		tx.Save(&request)
		var count int64
		tx.Model(&models.Friendship{}).Where("user_a_id = ? AND user_b_id = ?", left, right).Count(&count)
		if count == 0 {
			tx.Create(&models.Friendship{UserAID: left, UserBID: right})
		}
		return nil
	})
	if item, ok := h.toFriendRequest(request); ok {
		c.JSON(http.StatusOK, item)
	}
}

func (h Handler) ensureReplyTarget(c *gin.Context, messageID uint, currentID string, peerID string) (models.DirectMessage, bool) {
	var message models.DirectMessage
	if err := h.DB.First(&message, "id = ?", messageID).Error; err != nil {
		httputil.Error(c, http.StatusNotFound, "Reply target was not found.")
		return models.DirectMessage{}, false
	}
	if !((message.SenderID == currentID && message.RecipientID == peerID) || (message.SenderID == peerID && message.RecipientID == currentID)) {
		httputil.Error(c, http.StatusBadRequest, "Reply target is not in this conversation.")
		return models.DirectMessage{}, false
	}
	return message, true
}

func (h Handler) userByID(id string) (models.User, bool) {
	var user models.User
	if err := h.DB.First(&user, "id = ?", id).Error; err != nil {
		return models.User{}, false
	}
	return user, true
}

func (h Handler) areFriends(leftID string, rightID string) bool {
	left, right := friendPair(leftID, rightID)
	var count int64
	h.DB.Model(&models.Friendship{}).Where("user_a_id = ? AND user_b_id = ?", left, right).Count(&count)
	return count > 0
}

func (h Handler) toFriendRequest(request models.FriendRequest) (FriendRequestResponse, bool) {
	requester, ok1 := h.userByID(request.RequesterID)
	addressee, ok2 := h.userByID(request.AddresseeID)
	if !ok1 || !ok2 {
		return FriendRequestResponse{}, false
	}
	return FriendRequestResponse{ID: request.ID, Requester: toFriendProfile(requester), Addressee: toFriendProfile(addressee), Status: request.Status, CreatedAt: request.CreatedAt, RespondedAt: request.RespondedAt}, true
}

func toFriendProfile(user models.User) FriendProfile {
	return FriendProfile{ID: user.ID, Username: user.Username, Email: user.Email, DisplayName: user.DisplayName, Status: "active", Bio: "", AvatarURL: auth.BuildPublicAvatarURL(user.AvatarPath)}
}

func toDirectMessage(message models.DirectMessage) DirectMessageResponse {
	return DirectMessageResponse{
		ID: message.ID, SenderID: message.SenderID, RecipientID: message.RecipientID, Content: message.Content,
		Attachments: parseAttachments(message.AttachmentsJSON), ReplyToMessageID: message.ReplyToMessageID,
		ReplyTo: parseReplyReference(message.ReplyToPreviewJSON), CreatedAt: message.CreatedAt,
	}
}

func parseAttachments(raw *string) []DirectAttachment {
	if raw == nil || *raw == "" {
		return []DirectAttachment{}
	}
	var parsed []DirectAttachment
	if err := json.Unmarshal([]byte(*raw), &parsed); err != nil {
		return []DirectAttachment{}
	}
	if len(parsed) > 4 {
		return parsed[:4]
	}
	return parsed
}

func parseReplyReference(raw *string) *DirectReplyReference {
	if raw == nil || *raw == "" {
		return nil
	}
	var parsed DirectReplyReference
	if err := json.Unmarshal([]byte(*raw), &parsed); err != nil {
		return nil
	}
	return &parsed
}

func directReplyPreview(message models.DirectMessage, currentID string) DirectReplyReference {
	authorName := "Contact"
	if message.SenderID == currentID {
		authorName = "You"
	}
	content := strings.TrimSpace(message.Content)
	if content == "" {
		content = firstAttachmentLabel(parseAttachments(message.AttachmentsJSON))
	}
	return DirectReplyReference{ID: &message.ID, AuthorName: &authorName, Content: content, CreatedAt: &message.CreatedAt, SenderID: &message.SenderID}
}

func firstAttachmentLabel(attachments []DirectAttachment) string {
	if len(attachments) == 0 || attachments[0].Name == nil || strings.TrimSpace(*attachments[0].Name) == "" {
		return "Attachment"
	}
	return strings.TrimSpace(*attachments[0].Name)
}

func friendPair(left string, right string) (string, string) {
	values := []string{left, right}
	sort.Strings(values)
	return values[0], values[1]
}
