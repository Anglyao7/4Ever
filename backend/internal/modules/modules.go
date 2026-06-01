package modules

import (
	"net/http"
	"strings"

	"4ever/backend/internal/auth"
	"4ever/backend/internal/httputil"
	"4ever/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Handler struct {
	DB *gorm.DB
}

type PlatformModule struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Enabled     bool   `json:"enabled"`
	Locked      bool   `json:"locked"`
}

type ModuleUpdateRequest struct {
	Enabled *bool `json:"enabled" binding:"required"`
}

var Blueprints = []PlatformModule{
	{ID: "dashboard", Name: "见微知著", Description: "查看平台模块、接口状态和后续扩展入口。", Category: "system", Locked: true, Enabled: true},
	{ID: "chat", Name: "交耳", Description: "真实用户好友、私聊和 AI 会话模块。", Category: "ai", Enabled: true},
	{ID: "image-generation", Name: "绘影", Description: "图像生成实验台，可使用独立图像模型配置。", Category: "ai", Enabled: true},
	{ID: "provider-hub", Name: "接口中枢", Description: "统一维护全局模型 API 与当前配置。", Category: "integration", Enabled: true},
	{ID: "notes", Name: "笔记", Description: "Markdown 写作、笔记暂存和实时渲染。", Category: "productivity", Enabled: true},
	{ID: "memory-map", Name: "地图纪念", Description: "以普通地图记录地点、时间和纪念点。", Category: "productivity", Enabled: true},
	{ID: "workflow", Name: "秩序", Description: "面向用户开放 Agent、MCP 和工作流编排。", Category: "automation", Enabled: true},
	{ID: "token-usage", Name: "Token统计", Description: "统计本机 AI 工具 Token 用量、活跃度和排行榜。", Category: "analytics", Enabled: true},
	{ID: "inspiration", Name: "灵感温室", Description: "依托大模型发掘新灵感、追问并沉淀下一步。", Category: "productivity", Enabled: true},
	{ID: "admin", Name: "管理员端", Description: "用户、权限、审计和系统配置能力。", Category: "system", Locked: true, Enabled: true},
}

func Register(group *gin.RouterGroup, h Handler) {
	r := group.Group("/modules")
	r.GET("", h.List)
}

func (h Handler) List(c *gin.Context) {
	EnsureInitialSettings(h.DB)
	enabledMap := EnabledMap(h.DB)
	isAdmin := h.optionalAdmin(c)
	result := []PlatformModule{}
	for _, blueprint := range Blueprints {
		if blueprint.ID == "admin" && !isAdmin {
			continue
		}
		enabled, ok := enabledMap[blueprint.ID]
		if !ok {
			enabled = blueprint.Enabled
		}
		if !enabled {
			continue
		}
		item := blueprint
		item.Enabled = enabled
		result = append(result, item)
	}
	c.JSON(http.StatusOK, result)
}

func (h Handler) optionalAdmin(c *gin.Context) bool {
	header := c.GetHeader("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return false
	}
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if token == "" {
		return false
	}
	var session models.AuthSession
	if err := h.DB.Where("token_hash = ?", auth.HashToken(token)).First(&session).Error; err != nil {
		return false
	}
	var user models.User
	if err := h.DB.First(&user, "id = ?", session.UserID).Error; err != nil {
		return false
	}
	return user.Role == "admin"
}

func EnsureInitialSettings(db *gorm.DB) {
	for _, blueprint := range Blueprints {
		var count int64
		db.Model(&models.ModuleSetting{}).Where("module_id = ?", blueprint.ID).Count(&count)
		if count == 0 {
			db.Create(&models.ModuleSetting{ModuleID: blueprint.ID, Enabled: blueprint.Enabled, Locked: blueprint.Locked})
		}
	}
}

func EnabledMap(db *gorm.DB) map[string]bool {
	var records []models.ModuleSetting
	db.Find(&records)
	result := map[string]bool{}
	for _, record := range records {
		result[record.ModuleID] = record.Enabled
	}
	return result
}

func Blueprint(moduleID string) (PlatformModule, bool) {
	for _, blueprint := range Blueprints {
		if blueprint.ID == moduleID {
			return blueprint, true
		}
	}
	return PlatformModule{}, false
}

func UpdateModule(db *gorm.DB, moduleID string, enabled bool) (PlatformModule, bool, string) {
	blueprint, ok := Blueprint(moduleID)
	if !ok {
		return PlatformModule{}, false, "Module not found."
	}
	if blueprint.Locked {
		return PlatformModule{}, false, "This module cannot be disabled."
	}
	EnsureInitialSettings(db)
	record := models.ModuleSetting{ModuleID: moduleID}
	db.FirstOrInit(&record, "module_id = ?", moduleID)
	record.Enabled = enabled
	record.Locked = blueprint.Locked
	db.Exec(
		"INSERT INTO module_settings (module_id, enabled, locked, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(module_id) DO UPDATE SET enabled = excluded.enabled, locked = excluded.locked, updated_at = CURRENT_TIMESTAMP",
		moduleID,
		enabled,
		blueprint.Locked,
	)
	blueprint.Enabled = enabled
	return blueprint, true, ""
}

func BindUpdate(c *gin.Context) (ModuleUpdateRequest, bool) {
	var req ModuleUpdateRequest
	if !httputil.BindJSON(c, &req) {
		return req, false
	}
	return req, true
}
