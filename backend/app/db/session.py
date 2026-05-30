from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.db.base import Base


settings = get_settings()

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

engine: Engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    from app.db import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    ensure_schema_updates()


def ensure_schema_updates() -> None:
    inspector = inspect(engine)
    try:
        user_columns = {column["name"] for column in inspector.get_columns("users")}
    except Exception:
        return
    with engine.begin() as connection:
        if "avatar_path" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN avatar_path VARCHAR(500)"))
        if "role" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(40) NOT NULL DEFAULT 'member'"))
        if "login_count" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0"))
        if "last_login_at" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN last_login_at DATETIME"))
    try:
        direct_message_columns = {column["name"] for column in inspector.get_columns("direct_messages")}
    except Exception:
        return
    with engine.begin() as connection:
        if "reply_to_message_id" not in direct_message_columns:
            connection.execute(text("ALTER TABLE direct_messages ADD COLUMN reply_to_message_id INTEGER"))
        if "reply_to_preview_json" not in direct_message_columns:
            connection.execute(text("ALTER TABLE direct_messages ADD COLUMN reply_to_preview_json TEXT"))
    try:
        module_columns = {column["name"] for column in inspector.get_columns("module_settings")}
    except Exception:
        module_columns = set()
    if not module_columns:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS module_settings ("
                    "module_id VARCHAR(64) PRIMARY KEY, "
                    "enabled BOOLEAN NOT NULL DEFAULT 1, "
                    "locked BOOLEAN NOT NULL DEFAULT 0, "
                    "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
                    ")",
                ),
            )
    try:
        mcp_setting_columns = {column["name"] for column in inspector.get_columns("mcp_server_settings")}
    except Exception:
        mcp_setting_columns = set()
    if not mcp_setting_columns:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS mcp_server_settings ("
                    "server_id VARCHAR(120) PRIMARY KEY, "
                    "enabled BOOLEAN NOT NULL DEFAULT 1, "
                    "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
                    ")",
                ),
            )
    try:
        agent_prompt_columns = {column["name"] for column in inspector.get_columns("agent_prompt_settings")}
    except Exception:
        agent_prompt_columns = set()
    if not agent_prompt_columns:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS agent_prompt_settings ("
                    "agent_id VARCHAR(120) PRIMARY KEY, "
                    "prompt_version VARCHAR(80) NOT NULL DEFAULT '', "
                    "system_prompt TEXT NOT NULL DEFAULT '', "
                    "updated_by VARCHAR(64), "
                    "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
                    ")",
                ),
            )
    try:
        audit_columns = {column["name"] for column in inspector.get_columns("admin_audit_logs")}
    except Exception:
        audit_columns = set()
    if not audit_columns:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS admin_audit_logs ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "actor_id VARCHAR(64) NOT NULL, "
                    "action VARCHAR(80) NOT NULL, "
                    "target_type VARCHAR(40) NOT NULL, "
                    "target_id VARCHAR(120) NOT NULL, "
                    "detail TEXT, "
                    "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
                    ")",
                ),
            )
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_admin_audit_logs_actor_id ON admin_audit_logs (actor_id)"))
    try:
        workflow_run_columns = {column["name"] for column in inspector.get_columns("workflow_agent_runs")}
    except Exception:
        workflow_run_columns = set()
    if not workflow_run_columns:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS workflow_agent_runs ("
                    "id VARCHAR(80) PRIMARY KEY, "
                    "thread_id VARCHAR(120) NOT NULL DEFAULT '', "
                    "checkpoint_id VARCHAR(120) NOT NULL DEFAULT '', "
                    "template_id VARCHAR(120) NOT NULL, "
                    "agent_id VARCHAR(120) NOT NULL, "
                    "agent_prompt_version VARCHAR(80) NOT NULL DEFAULT '', "
                    "agent_prompt_checksum VARCHAR(80) NOT NULL DEFAULT '', "
                    "status VARCHAR(24) NOT NULL DEFAULT 'success', "
                    "graph_steps_json TEXT NOT NULL DEFAULT '[]', "
                    "events_json TEXT NOT NULL DEFAULT '[]', "
                    "mcp_server_ids_json TEXT NOT NULL, "
                    "input_json TEXT NOT NULL, "
                    "node_results_json TEXT NOT NULL, "
                    "review_status VARCHAR(24) NOT NULL DEFAULT 'not_required', "
                    "review_note TEXT NOT NULL DEFAULT '', "
                    "reviewed_at DATETIME, "
                    "started_at DATETIME NOT NULL, "
                    "ended_at DATETIME, "
                    "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
                    ")",
                ),
            )
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_workflow_agent_runs_template_id ON workflow_agent_runs (template_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_workflow_agent_runs_agent_id ON workflow_agent_runs (agent_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_workflow_agent_runs_thread_id ON workflow_agent_runs (thread_id)"))
    else:
        with engine.begin() as connection:
            if "thread_id" not in workflow_run_columns:
                connection.execute(text("ALTER TABLE workflow_agent_runs ADD COLUMN thread_id VARCHAR(120) NOT NULL DEFAULT ''"))
            if "checkpoint_id" not in workflow_run_columns:
                connection.execute(text("ALTER TABLE workflow_agent_runs ADD COLUMN checkpoint_id VARCHAR(120) NOT NULL DEFAULT ''"))
            if "agent_prompt_version" not in workflow_run_columns:
                connection.execute(text("ALTER TABLE workflow_agent_runs ADD COLUMN agent_prompt_version VARCHAR(80) NOT NULL DEFAULT ''"))
            if "agent_prompt_checksum" not in workflow_run_columns:
                connection.execute(text("ALTER TABLE workflow_agent_runs ADD COLUMN agent_prompt_checksum VARCHAR(80) NOT NULL DEFAULT ''"))
            if "graph_steps_json" not in workflow_run_columns:
                connection.execute(text("ALTER TABLE workflow_agent_runs ADD COLUMN graph_steps_json TEXT NOT NULL DEFAULT '[]'"))
            if "events_json" not in workflow_run_columns:
                connection.execute(text("ALTER TABLE workflow_agent_runs ADD COLUMN events_json TEXT NOT NULL DEFAULT '[]'"))
            if "review_status" not in workflow_run_columns:
                connection.execute(text("ALTER TABLE workflow_agent_runs ADD COLUMN review_status VARCHAR(24) NOT NULL DEFAULT 'not_required'"))
            if "review_note" not in workflow_run_columns:
                connection.execute(text("ALTER TABLE workflow_agent_runs ADD COLUMN review_note TEXT NOT NULL DEFAULT ''"))
            if "reviewed_at" not in workflow_run_columns:
                connection.execute(text("ALTER TABLE workflow_agent_runs ADD COLUMN reviewed_at DATETIME"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_workflow_agent_runs_thread_id ON workflow_agent_runs (thread_id)"))
    try:
        checkpoint_columns = {column["name"] for column in inspector.get_columns("workflow_agent_checkpoints")}
    except Exception:
        checkpoint_columns = set()
    if not checkpoint_columns:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS workflow_agent_checkpoints ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "run_id VARCHAR(80) NOT NULL, "
                    "thread_id VARCHAR(120) NOT NULL DEFAULT '', "
                    "checkpoint_id VARCHAR(160) NOT NULL, "
                    "graph_step VARCHAR(80) NOT NULL, "
                    "node_id VARCHAR(120) NOT NULL DEFAULT '', "
                    "status VARCHAR(24) NOT NULL DEFAULT 'success', "
                    "state_json TEXT NOT NULL DEFAULT '{}', "
                    "node_result_json TEXT NOT NULL DEFAULT '{}', "
                    "events_json TEXT NOT NULL DEFAULT '[]', "
                    "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    "CONSTRAINT uq_workflow_agent_checkpoint_step UNIQUE (run_id, graph_step)"
                    ")",
                ),
            )
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_workflow_agent_checkpoints_run_id ON workflow_agent_checkpoints (run_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_workflow_agent_checkpoints_thread_id ON workflow_agent_checkpoints (thread_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_workflow_agent_checkpoints_checkpoint_id ON workflow_agent_checkpoints (checkpoint_id)"))
    try:
        token_key_columns = {column["name"] for column in inspector.get_columns("token_usage_api_keys")}
    except Exception:
        token_key_columns = set()
    if not token_key_columns:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS token_usage_api_keys ("
                    "id VARCHAR(80) PRIMARY KEY, "
                    "user_id VARCHAR(64) NOT NULL, "
                    "name VARCHAR(120) NOT NULL, "
                    "prefix VARCHAR(24) NOT NULL, "
                    "key_hash VARCHAR(128) NOT NULL UNIQUE, "
                    "status VARCHAR(24) NOT NULL DEFAULT 'active', "
                    "last_used_at DATETIME, "
                    "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
                    ")",
                ),
            )
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_api_keys_user_id ON token_usage_api_keys (user_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_api_keys_prefix ON token_usage_api_keys (prefix)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_api_keys_key_hash ON token_usage_api_keys (key_hash)"))
    try:
        token_bucket_columns = {column["name"] for column in inspector.get_columns("token_usage_buckets")}
    except Exception:
        token_bucket_columns = set()
    if not token_bucket_columns:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS token_usage_buckets ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "user_id VARCHAR(64) NOT NULL, "
                    "api_key_id VARCHAR(80), "
                    "device_id VARCHAR(120) NOT NULL, "
                    "hostname VARCHAR(160) NOT NULL DEFAULT '', "
                    "source VARCHAR(80) NOT NULL, "
                    "model VARCHAR(160) NOT NULL, "
                    "project_key VARCHAR(160) NOT NULL, "
                    "project_label VARCHAR(240) NOT NULL DEFAULT '', "
                    "bucket_start DATETIME NOT NULL, "
                    "input_tokens INTEGER NOT NULL DEFAULT 0, "
                    "output_tokens INTEGER NOT NULL DEFAULT 0, "
                    "reasoning_tokens INTEGER NOT NULL DEFAULT 0, "
                    "cached_tokens INTEGER NOT NULL DEFAULT 0, "
                    "total_tokens INTEGER NOT NULL DEFAULT 0, "
                    "estimated_cost_usd FLOAT, "
                    "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    "CONSTRAINT uq_token_usage_bucket_scope UNIQUE (user_id, device_id, source, model, project_key, bucket_start)"
                    ")",
                ),
            )
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_buckets_user_id ON token_usage_buckets (user_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_buckets_bucket_start ON token_usage_buckets (bucket_start)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_buckets_device_id ON token_usage_buckets (device_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_buckets_source ON token_usage_buckets (source)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_buckets_model ON token_usage_buckets (model)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_buckets_project_key ON token_usage_buckets (project_key)"))
    try:
        token_session_columns = {column["name"] for column in inspector.get_columns("token_usage_sessions")}
    except Exception:
        token_session_columns = set()
    if not token_session_columns:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS token_usage_sessions ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "user_id VARCHAR(64) NOT NULL, "
                    "api_key_id VARCHAR(80), "
                    "device_id VARCHAR(120) NOT NULL, "
                    "hostname VARCHAR(160) NOT NULL DEFAULT '', "
                    "source VARCHAR(80) NOT NULL, "
                    "project_key VARCHAR(160) NOT NULL, "
                    "project_label VARCHAR(240) NOT NULL DEFAULT '', "
                    "session_hash VARCHAR(120) NOT NULL, "
                    "first_message_at DATETIME NOT NULL, "
                    "last_message_at DATETIME NOT NULL, "
                    "duration_seconds INTEGER NOT NULL DEFAULT 0, "
                    "active_seconds INTEGER NOT NULL DEFAULT 0, "
                    "message_count INTEGER NOT NULL DEFAULT 0, "
                    "user_message_count INTEGER NOT NULL DEFAULT 0, "
                    "input_tokens INTEGER NOT NULL DEFAULT 0, "
                    "output_tokens INTEGER NOT NULL DEFAULT 0, "
                    "reasoning_tokens INTEGER NOT NULL DEFAULT 0, "
                    "cached_tokens INTEGER NOT NULL DEFAULT 0, "
                    "total_tokens INTEGER NOT NULL DEFAULT 0, "
                    "primary_model VARCHAR(160) NOT NULL DEFAULT '', "
                    "model_usages_json TEXT NOT NULL DEFAULT '[]', "
                    "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    "CONSTRAINT uq_token_usage_session_scope UNIQUE (user_id, device_id, source, session_hash)"
                    ")",
                ),
            )
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_sessions_user_id ON token_usage_sessions (user_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_sessions_device_id ON token_usage_sessions (device_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_sessions_source ON token_usage_sessions (source)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_sessions_project_key ON token_usage_sessions (project_key)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_sessions_session_hash ON token_usage_sessions (session_hash)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_token_usage_sessions_first_message_at ON token_usage_sessions (first_message_at)"))


def check_database() -> bool:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return True


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
