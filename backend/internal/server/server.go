package server

import (
	"net/http"
	"os"
	"time"

	"4ever/backend/internal/admin"
	"4ever/backend/internal/agents"
	"4ever/backend/internal/auth"
	"4ever/backend/internal/catalog"
	"4ever/backend/internal/chat"
	"4ever/backend/internal/config"
	"4ever/backend/internal/database"
	"4ever/backend/internal/images"
	"4ever/backend/internal/maps"
	"4ever/backend/internal/modules"
	"4ever/backend/internal/tokenusage"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func New(settings config.Settings, db *gorm.DB) *gin.Engine {
	_ = os.MkdirAll(settings.MediaRoot, 0o755)

	router := gin.Default()
	router.Use(cors.New(cors.Config{
		AllowOrigins:     settings.CORSOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	router.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"name": settings.AppName, "status": "ready"})
	})
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	router.GET("/api/database/health", func(c *gin.Context) {
		if err := database.Check(db); err != nil {
			c.JSON(http.StatusOK, gin.H{"status": "error", "detail": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	router.Static("/api/media", settings.MediaRoot)

	api := router.Group(settings.APIPrefix)
	admin.Register(api, admin.Handler{DB: db, Settings: settings})
	agents.Register(api, agents.Handler{DB: db, Settings: settings})
	auth.Register(api, auth.Handler{DB: db, Settings: settings})
	chat.Register(api, chat.Handler{DB: db, Settings: settings})
	modules.Register(api, modules.Handler{DB: db})
	catalog.Register(api, catalog.Handler{Settings: settings})
	maps.Register(api, maps.Handler{Settings: settings})
	images.Register(api, images.Handler{})
	tokenusage.Register(api, tokenusage.Handler{DB: db})

	return router
}
