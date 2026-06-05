from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import json
import sqlite3
from pathlib import Path
from typing import Any, Iterator

from app.config import Settings


class Database:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.path = _sqlite_path(settings.database_url)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def migrate(self) -> None:
        with self.connect() as conn:
            for statement in _CREATE_TABLES:
                conn.execute(statement)
            for table, columns in _SCHEMA_UPDATES.items():
                existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
                for name, spec in columns.items():
                    if name not in existing:
                        conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {spec}")
            for statement in _INDEXES:
                conn.execute(statement)

    def check(self) -> None:
        with self.connect() as conn:
            conn.execute("SELECT 1").fetchone()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: Any, fallback: Any) -> Any:
    if value is None or value == "":
        return fallback
    try:
        return json.loads(str(value))
    except json.JSONDecodeError:
        return fallback


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [row_to_dict(row) or {} for row in rows]


def touch_user(conn: sqlite3.Connection, user_id: str) -> None:
    conn.execute("UPDATE users SET updated_at = ? WHERE id = ?", (now_iso(), user_id))


def _sqlite_path(database_url: str) -> Path:
    if database_url.startswith("sqlite:///"):
        return Path(database_url.removeprefix("sqlite:///")).resolve()
    if database_url.startswith("sqlite://"):
        return Path(database_url.removeprefix("sqlite://")).resolve()
    raise RuntimeError(f"Unsupported DATABASE_URL for Python backend: {database_url}")


_CREATE_TABLES = [
    """
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_path TEXT,
      cover_path TEXT,
      bio TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      login_count INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS model_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT,
      model TEXT NOT NULL,
      system_prompt TEXT,
      temperature REAL NOT NULL DEFAULT 0.7,
      max_tokens INTEGER NOT NULL DEFAULT 1024,
      supports_vision INTEGER NOT NULL DEFAULT 0,
      fallback_model TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 0,
      persona_json TEXT NOT NULL DEFAULT '{}',
      pet_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS module_settings (
      module_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS mcp_server_settings (
      server_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS agent_prompt_settings (
      agent_id TEXT PRIMARY KEY,
      prompt_version TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS admin_user_flags (
      user_id TEXT PRIMARY KEY,
      risk_flagged INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS workflow_agent_runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL DEFAULT '',
      checkpoint_id TEXT NOT NULL DEFAULT '',
      template_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_prompt_version TEXT NOT NULL DEFAULT '',
      agent_prompt_checksum TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success',
      graph_steps_json TEXT NOT NULL DEFAULT '[]',
      events_json TEXT NOT NULL DEFAULT '[]',
      mcp_server_ids_json TEXT NOT NULL,
      input_json TEXT NOT NULL,
      canvas_json TEXT NOT NULL DEFAULT '',
      node_results_json TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'not_required',
      review_note TEXT NOT NULL DEFAULT '',
      reviewed_at TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS workflow_agent_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      thread_id TEXT NOT NULL DEFAULT '',
      checkpoint_id TEXT NOT NULL,
      graph_step TEXT NOT NULL,
      node_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success',
      state_json TEXT NOT NULL DEFAULT '{}',
      node_result_json TEXT NOT NULL DEFAULT '{}',
      events_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      UNIQUE(run_id, graph_step)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS direct_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments_json TEXT,
      reply_to_message_id INTEGER,
      reply_to_preview_json TEXT,
      created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id TEXT NOT NULL,
      addressee_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      responded_at TEXT,
      UNIQUE(requester_id, addressee_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a_id TEXT NOT NULL,
      user_b_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_a_id, user_b_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS token_usage_api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      raw_key TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS token_usage_buckets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      api_key_id TEXT,
      device_id TEXT NOT NULL,
      hostname TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'unknown',
      project_key TEXT NOT NULL DEFAULT 'unknown',
      project_label TEXT NOT NULL DEFAULT '',
      bucket_start TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, api_key_id, device_id, source, model, project_key, bucket_start)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS token_usage_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      api_key_id TEXT,
      device_id TEXT NOT NULL,
      hostname TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      project_key TEXT NOT NULL,
      project_label TEXT NOT NULL DEFAULT '',
      session_hash TEXT NOT NULL,
      first_message_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      active_seconds INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      user_message_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      primary_model TEXT NOT NULL DEFAULT '',
      model_usages_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, api_key_id, device_id, source, session_hash)
    )
    """,
]

_SCHEMA_UPDATES = {
    "model_profiles": {
        "supports_vision": "INTEGER NOT NULL DEFAULT 0",
        "fallback_model": "TEXT NOT NULL DEFAULT ''",
        "enabled": "INTEGER NOT NULL DEFAULT 1",
        "is_active": "INTEGER NOT NULL DEFAULT 0",
        "persona_json": "TEXT NOT NULL DEFAULT '{}'",
        "pet_json": "TEXT NOT NULL DEFAULT '{}'",
    },
    "users": {
        "avatar_path": "TEXT",
        "cover_path": "TEXT",
        "bio": "TEXT NOT NULL DEFAULT ''",
        "location": "TEXT NOT NULL DEFAULT ''",
        "role": "TEXT NOT NULL DEFAULT 'member'",
        "login_count": "INTEGER NOT NULL DEFAULT 0",
        "last_login_at": "TEXT",
    },
    "direct_messages": {
        "reply_to_message_id": "INTEGER",
        "reply_to_preview_json": "TEXT",
    },
    "workflow_agent_runs": {
        "thread_id": "TEXT NOT NULL DEFAULT ''",
        "checkpoint_id": "TEXT NOT NULL DEFAULT ''",
        "agent_prompt_version": "TEXT NOT NULL DEFAULT ''",
        "agent_prompt_checksum": "TEXT NOT NULL DEFAULT ''",
        "graph_steps_json": "TEXT NOT NULL DEFAULT '[]'",
        "events_json": "TEXT NOT NULL DEFAULT '[]'",
        "canvas_json": "TEXT NOT NULL DEFAULT ''",
        "review_status": "TEXT NOT NULL DEFAULT 'not_required'",
        "review_note": "TEXT NOT NULL DEFAULT ''",
        "reviewed_at": "TEXT",
    },
    "token_usage_api_keys": {
        "name": "TEXT NOT NULL DEFAULT '本机 CLI'",
        "prefix": "TEXT NOT NULL DEFAULT ''",
        "key_hash": "TEXT NOT NULL DEFAULT ''",
        "raw_key": "TEXT",
        "status": "TEXT NOT NULL DEFAULT 'active'",
        "last_used_at": "TEXT",
        "created_at": "TEXT",
        "updated_at": "TEXT",
    },
    "token_usage_buckets": {
        "api_key_id": "TEXT",
        "hostname": "TEXT NOT NULL DEFAULT ''",
        "model": "TEXT NOT NULL DEFAULT 'unknown'",
        "project_key": "TEXT NOT NULL DEFAULT 'unknown'",
        "project_label": "TEXT NOT NULL DEFAULT ''",
        "reasoning_tokens": "INTEGER NOT NULL DEFAULT 0",
        "cached_tokens": "INTEGER NOT NULL DEFAULT 0",
        "total_tokens": "INTEGER NOT NULL DEFAULT 0",
        "estimated_cost_usd": "REAL",
        "created_at": "TEXT",
        "updated_at": "TEXT",
    },
    "token_usage_sessions": {
        "api_key_id": "TEXT",
        "hostname": "TEXT NOT NULL DEFAULT ''",
        "project_label": "TEXT NOT NULL DEFAULT ''",
        "duration_seconds": "INTEGER NOT NULL DEFAULT 0",
        "active_seconds": "INTEGER NOT NULL DEFAULT 0",
        "message_count": "INTEGER NOT NULL DEFAULT 0",
        "user_message_count": "INTEGER NOT NULL DEFAULT 0",
        "reasoning_tokens": "INTEGER NOT NULL DEFAULT 0",
        "cached_tokens": "INTEGER NOT NULL DEFAULT 0",
        "total_tokens": "INTEGER NOT NULL DEFAULT 0",
        "primary_model": "TEXT NOT NULL DEFAULT ''",
        "model_usages_json": "TEXT NOT NULL DEFAULT '[]'",
        "created_at": "TEXT",
        "updated_at": "TEXT",
    },
}

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_auth_sessions_user_id ON auth_sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS ix_admin_audit_logs_actor_id ON admin_audit_logs(actor_id)",
    "CREATE INDEX IF NOT EXISTS ix_direct_messages_sender_id ON direct_messages(sender_id)",
    "CREATE INDEX IF NOT EXISTS ix_direct_messages_recipient_id ON direct_messages(recipient_id)",
    "CREATE INDEX IF NOT EXISTS ix_friend_requests_requester_id ON friend_requests(requester_id)",
    "CREATE INDEX IF NOT EXISTS ix_friend_requests_addressee_id ON friend_requests(addressee_id)",
    "CREATE INDEX IF NOT EXISTS ix_friendships_user_a_id ON friendships(user_a_id)",
    "CREATE INDEX IF NOT EXISTS ix_friendships_user_b_id ON friendships(user_b_id)",
    "CREATE INDEX IF NOT EXISTS ix_workflow_agent_runs_started_at ON workflow_agent_runs(started_at)",
    "CREATE INDEX IF NOT EXISTS ix_workflow_agent_runs_thread_id ON workflow_agent_runs(thread_id)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_api_keys_user_id ON token_usage_api_keys(user_id)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_api_keys_prefix ON token_usage_api_keys(prefix)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_api_keys_key_hash ON token_usage_api_keys(key_hash)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_buckets_user_id ON token_usage_buckets(user_id)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_buckets_bucket_start ON token_usage_buckets(bucket_start)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_buckets_device_id ON token_usage_buckets(device_id)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_buckets_source ON token_usage_buckets(source)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_buckets_model ON token_usage_buckets(model)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_buckets_project_key ON token_usage_buckets(project_key)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_sessions_user_id ON token_usage_sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_sessions_device_id ON token_usage_sessions(device_id)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_sessions_source ON token_usage_sessions(source)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_sessions_project_key ON token_usage_sessions(project_key)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_sessions_session_hash ON token_usage_sessions(session_hash)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_sessions_first_message_at ON token_usage_sessions(first_message_at)",
    "CREATE INDEX IF NOT EXISTS ix_token_usage_sessions_last_message_at ON token_usage_sessions(last_message_at)",
]
