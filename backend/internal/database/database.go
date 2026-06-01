package database

import (
	"fmt"
	"strings"

	"4ever/backend/internal/config"
	"4ever/backend/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func Open(settings config.Settings) (*gorm.DB, error) {
	url := settings.DatabaseURL
	if strings.HasPrefix(url, "sqlite:///") {
		return gorm.Open(sqlite.Open(strings.TrimPrefix(url, "sqlite:///")), &gorm.Config{})
	}
	if strings.HasPrefix(url, "sqlite://") {
		return gorm.Open(sqlite.Open(strings.TrimPrefix(url, "sqlite://")), &gorm.Config{})
	}
	if strings.HasPrefix(url, "postgresql+psycopg://") {
		url = "postgres://" + strings.TrimPrefix(url, "postgresql+psycopg://")
	}
	if strings.HasPrefix(url, "postgres://") || strings.HasPrefix(url, "postgresql://") {
		return gorm.Open(postgres.Open(url), &gorm.Config{})
	}
	return nil, fmt.Errorf("unsupported DATABASE_URL: %s", settings.DatabaseURL)
}

func Migrate(db *gorm.DB) error {
	for _, model := range migrationModels() {
		if db.Migrator().HasTable(model) {
			continue
		}
		if err := db.AutoMigrate(model); err != nil {
			return err
		}
	}
	return nil
}

func Check(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Ping()
}

func migrationModels() []any {
	return []any{
		&models.User{},
		&models.AuthSession{},
		&models.ModelProfile{},
		&models.ModuleSetting{},
		&models.MCPServerSetting{},
		&models.AgentPromptSetting{},
		&models.AdminAuditLog{},
		&models.AdminUserFlag{},
		&models.ChatMessage{},
		&models.WorkflowAgentRun{},
		&models.WorkflowAgentCheckpoint{},
		&models.DirectMessage{},
		&models.FriendRequest{},
		&models.Friendship{},
		&models.TokenUsageAPIKey{},
		&models.TokenUsageBucket{},
		&models.TokenUsageSession{},
	}
}
