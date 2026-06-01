package admin

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"4ever/backend/internal/agents"
	"4ever/backend/internal/auth"
	"4ever/backend/internal/config"
	"4ever/backend/internal/httputil"
	"4ever/backend/internal/models"
	"4ever/backend/internal/modules"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Handler struct {
	DB       *gorm.DB
	Settings config.Settings
}

type Overview struct {
	UserCount           int64 `json:"user_count"`
	AdminCount          int64 `json:"admin_count"`
	ActiveSessionCount  int64 `json:"active_session_count"`
	DirectMessageCount  int64 `json:"direct_message_count"`
	EnabledModuleCount  int   `json:"enabled_module_count"`
	DisabledModuleCount int   `json:"disabled_module_count"`
}

type AdminUser struct {
	ID           string     `json:"id"`
	Username     string     `json:"username"`
	Email        string     `json:"email"`
	DisplayName  string     `json:"display_name"`
	AvatarURL    *string    `json:"avatar_url"`
	Role         string     `json:"role"`
	LoginCount   int        `json:"login_count"`
	SessionCount int        `json:"session_count"`
	MessageCount int        `json:"message_count"`
	FriendCount  int        `json:"friend_count"`
	RiskFlagged  bool       `json:"risk_flagged"`
	RiskNote     *string    `json:"risk_note"`
	LastLoginAt  *time.Time `json:"last_login_at"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type RoleUpdate struct {
	Role string `json:"role" binding:"required"`
}

type RiskUpdate struct {
	RiskFlagged *bool   `json:"risk_flagged" binding:"required"`
	Note        *string `json:"note"`
}

type AgentPromptUpdate struct {
	PromptVersion string `json:"prompt_version" binding:"required"`
	SystemPrompt  string `json:"system_prompt" binding:"required"`
}

type MCPServerUpdate struct {
	Enabled *bool `json:"enabled" binding:"required"`
}

type AuditLog struct {
	ID         uint      `json:"id"`
	ActorID    string    `json:"actor_id"`
	ActorName  string    `json:"actor_name"`
	Action     string    `json:"action"`
	TargetType string    `json:"target_type"`
	TargetID   string    `json:"target_id"`
	Detail     *string   `json:"detail"`
	CreatedAt  time.Time `json:"created_at"`
}

func Register(group *gin.RouterGroup, h Handler) {
	r := group.Group("/admin")
	r.GET("/overview", h.Overview)
	r.GET("/users", h.ListUsers)
	r.PATCH("/users/:user_id/role", h.UpdateUserRole)
	r.PATCH("/users/:user_id/risk", h.UpdateUserRisk)
	r.GET("/modules", h.ListModules)
	r.PATCH("/modules/:module_id", h.UpdateModule)
	r.GET("/mcp-servers", h.ListMCPServers)
	r.PATCH("/mcp-servers/:server_id", h.UpdateMCPServer)
	r.GET("/agents", h.ListAgents)
	r.PATCH("/agents/:agent_id", h.UpdateAgentPrompt)
	r.GET("/audit-logs", h.ListAuditLogs)
}

func (h Handler) Overview(c *gin.Context) {
	if _, ok := h.requireAdmin(c); !ok {
		return
	}
	modules.EnsureInitialSettings(h.DB)
	enabledMap := modules.EnabledMap(h.DB)
	enabledCount := 0
	for _, blueprint := range modules.Blueprints {
		enabled, ok := enabledMap[blueprint.ID]
		if !ok {
			enabled = blueprint.Enabled
		}
		if enabled {
			enabledCount++
		}
	}
	var out Overview
	h.DB.Model(&models.User{}).Count(&out.UserCount)
	h.DB.Model(&models.User{}).Where("role = ?", "admin").Count(&out.AdminCount)
	h.DB.Model(&models.AuthSession{}).Count(&out.ActiveSessionCount)
	h.DB.Model(&models.DirectMessage{}).Count(&out.DirectMessageCount)
	out.EnabledModuleCount = enabledCount
	out.DisabledModuleCount = len(modules.Blueprints) - enabledCount
	c.JSON(http.StatusOK, out)
}

func (h Handler) ListUsers(c *gin.Context) {
	if _, ok := h.requireAdmin(c); !ok {
		return
	}
	query := strings.TrimSpace(strings.ToLower(c.Query("q")))
	dbq := h.DB.Model(&models.User{})
	if query != "" {
		pattern := "%" + query + "%"
		dbq = dbq.Where("LOWER(username) LIKE ? OR LOWER(email) LIKE ? OR LOWER(display_name) LIKE ?", pattern, pattern, pattern)
	}
	var users []models.User
	dbq.Order("created_at DESC").Limit(200).Find(&users)
	out := make([]AdminUser, 0, len(users))
	for _, user := range users {
		out = append(out, h.toAdminUser(user))
	}
	c.JSON(http.StatusOK, out)
}

func (h Handler) UpdateUserRole(c *gin.Context) {
	current, ok := h.requireAdmin(c)
	if !ok {
		return
	}
	var req RoleUpdate
	if !httputil.BindJSON(c, &req) {
		return
	}
	role := strings.ToLower(strings.TrimSpace(req.Role))
	if role != "member" && role != "admin" {
		httputil.Error(c, http.StatusUnprocessableEntity, "Role must be member or admin.")
		return
	}
	var user models.User
	if err := h.DB.First(&user, "id = ?", c.Param("user_id")).Error; err != nil {
		httputil.Error(c, http.StatusNotFound, "User not found.")
		return
	}
	if user.ID == current.ID && role != "admin" {
		httputil.Error(c, http.StatusBadRequest, "You cannot remove your own admin role.")
		return
	}
	previous := user.Role
	user.Role = role
	detail := fmt.Sprintf("%s: %s -> %s", user.Username, previous, role)
	h.DB.Transaction(func(tx *gorm.DB) error {
		tx.Save(&user)
		tx.Create(&models.AdminAuditLog{ActorID: current.ID, Action: "user.role.update", TargetType: "user", TargetID: user.ID, Detail: &detail})
		return nil
	})
	c.JSON(http.StatusOK, h.toAdminUser(user))
}

func (h Handler) UpdateUserRisk(c *gin.Context) {
	current, ok := h.requireAdmin(c)
	if !ok {
		return
	}
	var req RiskUpdate
	if !httputil.BindJSON(c, &req) {
		return
	}
	var user models.User
	if err := h.DB.First(&user, "id = ?", c.Param("user_id")).Error; err != nil {
		httputil.Error(c, http.StatusNotFound, "User not found.")
		return
	}
	var note *string
	if req.Note != nil {
		text := strings.TrimSpace(*req.Note)
		note = &text
	}
	flag := models.AdminUserFlag{UserID: user.ID}
	h.DB.FirstOrInit(&flag, "user_id = ?", user.ID)
	flag.RiskFlagged = *req.RiskFlagged
	if *req.RiskFlagged {
		flag.Note = note
	} else {
		flag.Note = nil
	}
	flag.UpdatedBy = &current.ID
	detailText := fmt.Sprintf("%s: risk cleared", user.Username)
	if *req.RiskFlagged {
		detailText = fmt.Sprintf("%s: risk flagged", user.Username)
		if note != nil && *note != "" {
			detailText += " · " + *note
		}
	}
	h.DB.Transaction(func(tx *gorm.DB) error {
		tx.Save(&flag)
		tx.Create(&models.AdminAuditLog{ActorID: current.ID, Action: "user.risk.update", TargetType: "user", TargetID: user.ID, Detail: &detailText})
		return nil
	})
	out := h.toAdminUser(user)
	out.RiskFlagged = flag.RiskFlagged
	out.RiskNote = flag.Note
	c.JSON(http.StatusOK, out)
}

func (h Handler) ListModules(c *gin.Context) {
	if _, ok := h.requireAdmin(c); !ok {
		return
	}
	modules.EnsureInitialSettings(h.DB)
	enabledMap := modules.EnabledMap(h.DB)
	out := []modules.PlatformModule{}
	for _, blueprint := range modules.Blueprints {
		item := blueprint
		if enabled, ok := enabledMap[item.ID]; ok {
			item.Enabled = enabled
		}
		out = append(out, item)
	}
	c.JSON(http.StatusOK, out)
}

func (h Handler) UpdateModule(c *gin.Context) {
	current, ok := h.requireAdmin(c)
	if !ok {
		return
	}
	req, ok := modules.BindUpdate(c)
	if !ok {
		return
	}
	updated, ok, detail := modules.UpdateModule(h.DB, c.Param("module_id"), *req.Enabled)
	if !ok {
		status := http.StatusNotFound
		if detail == "This module cannot be disabled." {
			status = http.StatusBadRequest
		}
		httputil.Error(c, status, detail)
		return
	}
	logDetail := fmt.Sprintf("%s: %s", updated.Name, map[bool]string{true: "enabled", false: "disabled"}[*req.Enabled])
	h.DB.Create(&models.AdminAuditLog{ActorID: current.ID, Action: "module.status.update", TargetType: "module", TargetID: updated.ID, Detail: &logDetail})
	c.JSON(http.StatusOK, updated)
}

func (h Handler) ListMCPServers(c *gin.Context) {
	if _, ok := h.requireAdmin(c); !ok {
		return
	}
	c.JSON(http.StatusOK, agents.ListConfiguredMCPServers(h.DB, h.Settings))
}

func (h Handler) UpdateMCPServer(c *gin.Context) {
	current, ok := h.requireAdmin(c)
	if !ok {
		return
	}
	var req MCPServerUpdate
	if !httputil.BindJSON(c, &req) {
		return
	}
	server, exists := agents.FindMCPServer(c.Param("server_id"))
	if !exists {
		httputil.Error(c, http.StatusNotFound, "MCP server not found.")
		return
	}
	record := models.MCPServerSetting{ServerID: server.ID}
	h.DB.FirstOrInit(&record, "server_id = ?", server.ID)
	record.Enabled = *req.Enabled
	logDetail := fmt.Sprintf("%s: %s", server.Name, map[bool]string{true: "enabled", false: "disabled"}[*req.Enabled])
	h.DB.Transaction(func(tx *gorm.DB) error {
		tx.Exec(
			"INSERT INTO mcp_server_settings (server_id, enabled, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(server_id) DO UPDATE SET enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP",
			server.ID,
			*req.Enabled,
		)
		tx.Create(&models.AdminAuditLog{ActorID: current.ID, Action: "mcp.status.update", TargetType: "mcp_server", TargetID: server.ID, Detail: &logDetail})
		return nil
	})
	updated, _ := agents.ConfiguredMCPServerByID(server.ID, h.DB, h.Settings)
	c.JSON(http.StatusOK, updated)
}

func (h Handler) ListAgents(c *gin.Context) {
	if _, ok := h.requireAdmin(c); !ok {
		return
	}
	c.JSON(http.StatusOK, agents.ListConfiguredAgents(h.DB))
}

func (h Handler) UpdateAgentPrompt(c *gin.Context) {
	current, ok := h.requireAdmin(c)
	if !ok {
		return
	}
	var req AgentPromptUpdate
	if !httputil.BindJSON(c, &req) {
		return
	}
	agent, exists := agents.FindAgent(c.Param("agent_id"))
	if !exists {
		httputil.Error(c, http.StatusNotFound, "Agent not found.")
		return
	}
	version := strings.TrimSpace(req.PromptVersion)
	prompt := strings.TrimSpace(req.SystemPrompt)
	if version == "" {
		httputil.Error(c, http.StatusUnprocessableEntity, "Prompt version is required.")
		return
	}
	if len([]rune(prompt)) < 20 {
		httputil.Error(c, http.StatusUnprocessableEntity, "System prompt must be at least 20 characters.")
		return
	}
	record := models.AgentPromptSetting{AgentID: agent.ID}
	h.DB.FirstOrInit(&record, "agent_id = ?", agent.ID)
	record.PromptVersion = version
	record.SystemPrompt = prompt
	record.UpdatedBy = &current.ID
	detail := fmt.Sprintf("%s: %s", agent.Name, version)
	h.DB.Transaction(func(tx *gorm.DB) error {
		tx.Save(&record)
		tx.Create(&models.AdminAuditLog{ActorID: current.ID, Action: "agent.prompt.update", TargetType: "agent", TargetID: agent.ID, Detail: &detail})
		return nil
	})
	updated, _ := agents.ConfiguredAgentByID(agent.ID, h.DB)
	c.JSON(http.StatusOK, updated)
}

func (h Handler) ListAuditLogs(c *gin.Context) {
	if _, ok := h.requireAdmin(c); !ok {
		return
	}
	var records []models.AdminAuditLog
	h.DB.Order("created_at DESC, id DESC").Limit(60).Find(&records)
	out := []AuditLog{}
	for _, record := range records {
		actorName := record.ActorID
		var user models.User
		if err := h.DB.First(&user, "id = ?", record.ActorID).Error; err == nil {
			actorName = user.DisplayName
			if actorName == "" {
				actorName = user.Username
			}
		}
		out = append(out, AuditLog{ID: record.ID, ActorID: record.ActorID, ActorName: actorName, Action: record.Action, TargetType: record.TargetType, TargetID: record.TargetID, Detail: record.Detail, CreatedAt: record.CreatedAt})
	}
	c.JSON(http.StatusOK, out)
}

func (h Handler) requireAdmin(c *gin.Context) (models.User, bool) {
	user, ok := auth.ResolveUser(c, h.DB)
	if !ok {
		return models.User{}, false
	}
	var count int64
	h.DB.Model(&models.User{}).Where("role = ?", "admin").Count(&count)
	if count == 0 {
		user.Role = "admin"
		h.DB.Save(&user)
	}
	if user.Role != "admin" {
		httputil.Error(c, http.StatusForbidden, "Admin access required.")
		return models.User{}, false
	}
	return user, true
}

func (h Handler) toAdminUser(user models.User) AdminUser {
	var sessionCount int64
	h.DB.Model(&models.AuthSession{}).Where("user_id = ?", user.ID).Count(&sessionCount)
	var sentCount int64
	h.DB.Model(&models.DirectMessage{}).Where("sender_id = ?", user.ID).Count(&sentCount)
	var receivedCount int64
	h.DB.Model(&models.DirectMessage{}).Where("recipient_id = ?", user.ID).Count(&receivedCount)
	var friendCount int64
	h.DB.Model(&models.Friendship{}).Where("user_a_id = ? OR user_b_id = ?", user.ID, user.ID).Count(&friendCount)
	var flag models.AdminUserFlag
	riskFlagged := false
	var riskNote *string
	if err := h.DB.First(&flag, "user_id = ? AND risk_flagged = ?", user.ID, true).Error; err == nil {
		riskFlagged = flag.RiskFlagged
		riskNote = flag.Note
	}
	return AdminUser{ID: user.ID, Username: user.Username, Email: user.Email, DisplayName: user.DisplayName, AvatarURL: auth.BuildPublicAvatarURL(user.AvatarPath), Role: user.Role, LoginCount: user.LoginCount, SessionCount: int(sessionCount), MessageCount: int(sentCount + receivedCount), FriendCount: int(friendCount), RiskFlagged: riskFlagged, RiskNote: riskNote, LastLoginAt: user.LastLoginAt, CreatedAt: user.CreatedAt, UpdatedAt: user.UpdatedAt}
}
