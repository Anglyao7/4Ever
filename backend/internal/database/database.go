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
	return ensureSchemaUpdates(db)
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

type columnSpec struct {
	sqlite   string
	postgres string
}

func (spec columnSpec) SQL(db *gorm.DB) string {
	if db.Dialector.Name() == "postgres" && spec.postgres != "" {
		return spec.postgres
	}
	return spec.sqlite
}

func ensureSchemaUpdates(db *gorm.DB) error {
	updates := []struct {
		table   string
		columns map[string]columnSpec
		indexes []indexSpec
	}{
		{
			table: "users",
			columns: map[string]columnSpec{
				"avatar_path":   {sqlite: "VARCHAR(500)"},
				"role":          {sqlite: "VARCHAR(40) NOT NULL DEFAULT 'member'"},
				"login_count":   {sqlite: "INTEGER NOT NULL DEFAULT 0"},
				"last_login_at": {sqlite: "DATETIME", postgres: "TIMESTAMPTZ"},
			},
		},
		{
			table: "direct_messages",
			columns: map[string]columnSpec{
				"reply_to_message_id":   {sqlite: "INTEGER"},
				"reply_to_preview_json": {sqlite: "TEXT"},
			},
		},
		{
			table: "workflow_agent_runs",
			columns: map[string]columnSpec{
				"thread_id":             {sqlite: "VARCHAR(120) NOT NULL DEFAULT ''"},
				"checkpoint_id":         {sqlite: "VARCHAR(120) NOT NULL DEFAULT ''"},
				"agent_prompt_version":  {sqlite: "VARCHAR(80) NOT NULL DEFAULT ''"},
				"agent_prompt_checksum": {sqlite: "VARCHAR(80) NOT NULL DEFAULT ''"},
				"graph_steps_json":      {sqlite: "TEXT NOT NULL DEFAULT '[]'"},
				"events_json":           {sqlite: "TEXT NOT NULL DEFAULT '[]'"},
				"canvas_json":           {sqlite: "TEXT NOT NULL DEFAULT ''"},
				"review_status":         {sqlite: "VARCHAR(24) NOT NULL DEFAULT 'not_required'"},
				"review_note":           {sqlite: "TEXT NOT NULL DEFAULT ''"},
				"reviewed_at":           {sqlite: "DATETIME", postgres: "TIMESTAMPTZ"},
			},
			indexes: []indexSpec{
				{name: "ix_workflow_agent_runs_thread_id", columns: []string{"thread_id"}},
			},
		},
		{
			table: "token_usage_api_keys",
			columns: map[string]columnSpec{
				"name":         {sqlite: "VARCHAR(120) NOT NULL DEFAULT '本机 CLI'"},
				"prefix":       {sqlite: "VARCHAR(24) NOT NULL DEFAULT ''"},
				"key_hash":     {sqlite: "VARCHAR(128) NOT NULL DEFAULT ''"},
				"raw_key":      {sqlite: "TEXT"},
				"status":       {sqlite: "VARCHAR(24) NOT NULL DEFAULT 'active'"},
				"last_used_at": {sqlite: "DATETIME", postgres: "TIMESTAMPTZ"},
				"created_at":   {sqlite: "DATETIME", postgres: "TIMESTAMPTZ"},
				"updated_at":   {sqlite: "DATETIME", postgres: "TIMESTAMPTZ"},
			},
			indexes: []indexSpec{
				{name: "ix_token_usage_api_keys_user_id", columns: []string{"user_id"}},
				{name: "ix_token_usage_api_keys_prefix", columns: []string{"prefix"}},
				{name: "ix_token_usage_api_keys_key_hash", columns: []string{"key_hash"}},
			},
		},
		{
			table: "token_usage_buckets",
			columns: map[string]columnSpec{
				"api_key_id":         {sqlite: "VARCHAR(80)"},
				"hostname":           {sqlite: "VARCHAR(160) NOT NULL DEFAULT ''"},
				"model":              {sqlite: "VARCHAR(160) NOT NULL DEFAULT 'unknown'"},
				"project_key":        {sqlite: "VARCHAR(160) NOT NULL DEFAULT 'unknown'"},
				"project_label":      {sqlite: "VARCHAR(240) NOT NULL DEFAULT ''"},
				"reasoning_tokens":   {sqlite: "INTEGER NOT NULL DEFAULT 0"},
				"cached_tokens":      {sqlite: "INTEGER NOT NULL DEFAULT 0"},
				"total_tokens":       {sqlite: "INTEGER NOT NULL DEFAULT 0"},
				"estimated_cost_usd": {sqlite: "FLOAT", postgres: "DOUBLE PRECISION"},
				"created_at":         {sqlite: "DATETIME", postgres: "TIMESTAMPTZ"},
				"updated_at":         {sqlite: "DATETIME", postgres: "TIMESTAMPTZ"},
			},
			indexes: []indexSpec{
				{name: "ix_token_usage_buckets_user_id", columns: []string{"user_id"}},
				{name: "ix_token_usage_buckets_bucket_start", columns: []string{"bucket_start"}},
				{name: "ix_token_usage_buckets_device_id", columns: []string{"device_id"}},
				{name: "ix_token_usage_buckets_source", columns: []string{"source"}},
				{name: "ix_token_usage_buckets_model", columns: []string{"model"}},
				{name: "ix_token_usage_buckets_project_key", columns: []string{"project_key"}},
			},
		},
		{
			table: "token_usage_sessions",
			columns: map[string]columnSpec{
				"api_key_id":         {sqlite: "VARCHAR(80)"},
				"hostname":           {sqlite: "VARCHAR(160) NOT NULL DEFAULT ''"},
				"project_label":      {sqlite: "VARCHAR(240) NOT NULL DEFAULT ''"},
				"duration_seconds":   {sqlite: "INTEGER NOT NULL DEFAULT 0"},
				"active_seconds":     {sqlite: "INTEGER NOT NULL DEFAULT 0"},
				"message_count":      {sqlite: "INTEGER NOT NULL DEFAULT 0"},
				"user_message_count": {sqlite: "INTEGER NOT NULL DEFAULT 0"},
				"reasoning_tokens":   {sqlite: "INTEGER NOT NULL DEFAULT 0"},
				"cached_tokens":      {sqlite: "INTEGER NOT NULL DEFAULT 0"},
				"total_tokens":       {sqlite: "INTEGER NOT NULL DEFAULT 0"},
				"primary_model":      {sqlite: "VARCHAR(160) NOT NULL DEFAULT ''"},
				"model_usages_json":  {sqlite: "TEXT NOT NULL DEFAULT '[]'"},
				"created_at":         {sqlite: "DATETIME", postgres: "TIMESTAMPTZ"},
				"updated_at":         {sqlite: "DATETIME", postgres: "TIMESTAMPTZ"},
			},
			indexes: []indexSpec{
				{name: "ix_token_usage_sessions_user_id", columns: []string{"user_id"}},
				{name: "ix_token_usage_sessions_device_id", columns: []string{"device_id"}},
				{name: "ix_token_usage_sessions_source", columns: []string{"source"}},
				{name: "ix_token_usage_sessions_project_key", columns: []string{"project_key"}},
				{name: "ix_token_usage_sessions_session_hash", columns: []string{"session_hash"}},
				{name: "ix_token_usage_sessions_first_message_at", columns: []string{"first_message_at"}},
				{name: "ix_token_usage_sessions_last_message_at", columns: []string{"last_message_at"}},
			},
		},
	}

	for _, update := range updates {
		if !db.Migrator().HasTable(update.table) {
			continue
		}
		if err := addMissingColumns(db, update.table, update.columns); err != nil {
			return err
		}
		for _, index := range update.indexes {
			if err := createIndexIfNotExists(db, update.table, index); err != nil {
				return err
			}
		}
	}
	return nil
}

func addMissingColumns(db *gorm.DB, table string, columns map[string]columnSpec) error {
	for name, spec := range columns {
		if db.Migrator().HasColumn(table, name) {
			continue
		}
		if err := db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, name, spec.SQL(db))).Error; err != nil {
			return fmt.Errorf("add column %s.%s: %w", table, name, err)
		}
	}
	return nil
}

type indexSpec struct {
	name    string
	columns []string
}

func createIndexIfNotExists(db *gorm.DB, table string, index indexSpec) error {
	sql := fmt.Sprintf(
		"CREATE INDEX IF NOT EXISTS %s ON %s (%s)",
		index.name,
		table,
		strings.Join(index.columns, ", "),
	)
	if err := db.Exec(sql).Error; err != nil {
		return fmt.Errorf("create index %s: %w", index.name, err)
	}
	return nil
}
