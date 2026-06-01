package database

import (
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateAddsMissingReleaseColumnsToLegacySQLite(t *testing.T) {
	db := openTestDB(t)
	execSQL(t, db, "CREATE TABLE users (id VARCHAR(64) PRIMARY KEY, username VARCHAR(80) NOT NULL, email VARCHAR(160) NOT NULL, display_name VARCHAR(120) NOT NULL, password_hash VARCHAR(240) NOT NULL, created_at DATETIME, updated_at DATETIME)")
	execSQL(t, db, "CREATE TABLE direct_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id VARCHAR(64) NOT NULL, recipient_id VARCHAR(64) NOT NULL, content TEXT NOT NULL, created_at DATETIME)")
	execSQL(t, db, "CREATE TABLE workflow_agent_runs (id VARCHAR(80) PRIMARY KEY, template_id VARCHAR(120) NOT NULL, agent_id VARCHAR(120) NOT NULL, status VARCHAR(24) NOT NULL, mcp_server_ids_json TEXT NOT NULL, input_json TEXT NOT NULL, node_results_json TEXT NOT NULL, started_at DATETIME NOT NULL, ended_at DATETIME, created_at DATETIME)")

	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}

	assertColumns(t, db, "users", "avatar_path", "role", "login_count", "last_login_at")
	assertColumns(t, db, "direct_messages", "reply_to_message_id", "reply_to_preview_json")
	assertColumns(t, db, "workflow_agent_runs", "thread_id", "checkpoint_id", "agent_prompt_version", "agent_prompt_checksum", "graph_steps_json", "events_json", "canvas_json", "review_status", "review_note", "reviewed_at")
	assertIndexes(t, db, "workflow_agent_runs", "ix_workflow_agent_runs_thread_id")
}

func TestMigrateAddsMissingTokenUsageColumnsAndIndexesToLegacySQLite(t *testing.T) {
	db := openTestDB(t)
	execSQL(t, db, "CREATE TABLE token_usage_api_keys (id VARCHAR(80) PRIMARY KEY, user_id VARCHAR(64) NOT NULL)")
	execSQL(t, db, "CREATE TABLE token_usage_buckets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id VARCHAR(64) NOT NULL, device_id VARCHAR(120) NOT NULL, source VARCHAR(80) NOT NULL, bucket_start DATETIME NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0)")
	execSQL(t, db, "CREATE TABLE token_usage_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id VARCHAR(64) NOT NULL, device_id VARCHAR(120) NOT NULL, source VARCHAR(80) NOT NULL, project_key VARCHAR(160) NOT NULL, session_hash VARCHAR(120) NOT NULL, first_message_at DATETIME NOT NULL, last_message_at DATETIME NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0)")

	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}

	assertColumns(t, db, "token_usage_api_keys", "name", "prefix", "key_hash", "raw_key", "status", "last_used_at", "created_at", "updated_at")
	assertIndexes(t, db, "token_usage_api_keys", "ix_token_usage_api_keys_user_id", "ix_token_usage_api_keys_prefix", "ix_token_usage_api_keys_key_hash")

	assertColumns(t, db, "token_usage_buckets", "api_key_id", "hostname", "model", "project_key", "project_label", "reasoning_tokens", "cached_tokens", "total_tokens", "estimated_cost_usd", "created_at", "updated_at")
	assertIndexes(t, db, "token_usage_buckets", "ix_token_usage_buckets_user_id", "ix_token_usage_buckets_bucket_start", "ix_token_usage_buckets_device_id", "ix_token_usage_buckets_source", "ix_token_usage_buckets_model", "ix_token_usage_buckets_project_key")

	assertColumns(t, db, "token_usage_sessions", "api_key_id", "hostname", "project_label", "duration_seconds", "active_seconds", "message_count", "user_message_count", "reasoning_tokens", "cached_tokens", "total_tokens", "primary_model", "model_usages_json", "created_at", "updated_at")
	assertIndexes(t, db, "token_usage_sessions", "ix_token_usage_sessions_user_id", "ix_token_usage_sessions_device_id", "ix_token_usage_sessions_source", "ix_token_usage_sessions_project_key", "ix_token_usage_sessions_session_hash", "ix_token_usage_sessions_first_message_at", "ix_token_usage_sessions_last_message_at")
}

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "legacy.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func execSQL(t *testing.T, db *gorm.DB, sql string) {
	t.Helper()
	if err := db.Exec(sql).Error; err != nil {
		t.Fatal(err)
	}
}

func assertColumns(t *testing.T, db *gorm.DB, table string, expected ...string) {
	t.Helper()
	rows, err := db.Raw("PRAGMA table_info(" + table + ")").Rows()
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	columns := map[string]bool{}
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull int
		var defaultValue any
		var primaryKey int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			t.Fatal(err)
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}

	for _, name := range expected {
		if !columns[name] {
			t.Fatalf("expected %s.%s to exist; columns=%v", table, name, columns)
		}
	}
}

func assertIndexes(t *testing.T, db *gorm.DB, table string, expected ...string) {
	t.Helper()
	rows, err := db.Raw("PRAGMA index_list(" + table + ")").Rows()
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	indexes := map[string]bool{}
	for rows.Next() {
		var seq int
		var name string
		var unique, origin, partial any
		if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			t.Fatal(err)
		}
		indexes[name] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}

	for _, name := range expected {
		if !indexes[name] {
			t.Fatalf("expected index %s on %s to exist; indexes=%v", name, table, indexes)
		}
	}
}
