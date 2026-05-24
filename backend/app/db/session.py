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
