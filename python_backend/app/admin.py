from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import tempfile
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.agents.catalog import configured_agent, configured_mcp_server, find_agent, find_mcp_server, list_configured_agents, list_configured_mcp_servers
from app.auth import public_media_url, require_admin
from app.config import Settings
from app.database import Database, json_dumps, now_iso, row_to_dict
from app.modules import BLUEPRINTS, enabled_map, ensure_initial_settings
from app.providers import cleanup_chat_attachment_orphans, migrate_public_chat_attachments_to_private


class RoleUpdate(BaseModel):
    role: str


class RiskUpdate(BaseModel):
    risk_flagged: bool
    note: str | None = None


class ToggleUpdate(BaseModel):
    enabled: bool


class AgentPromptUpdate(BaseModel):
    prompt_version: str
    system_prompt: str


class AttachmentMaintenanceRequest(BaseModel):
    dry_run: bool = True
    min_age_seconds: int = 3600


def router(db: Database, settings: Settings) -> APIRouter:
    api = APIRouter(prefix="/api/admin")

    @api.get("/overview")
    def overview(request: Request) -> dict[str, Any]:
        require_admin(request, db)
        ensure_initial_settings(db)
        enabled = enabled_map(db)
        enabled_count = sum(1 for blueprint in BLUEPRINTS if enabled.get(blueprint["id"], bool(blueprint["enabled"])))
        with db.connect() as conn:
            return {
                "user_count": scalar_count(conn, "users"),
                "admin_count": scalar_count(conn, "users", "role = 'admin'"),
                "active_session_count": scalar_count(conn, "auth_sessions"),
                "direct_message_count": scalar_count(conn, "direct_messages"),
                "enabled_module_count": enabled_count,
                "disabled_module_count": len(BLUEPRINTS) - enabled_count,
            }

    @api.get("/readiness")
    def readiness(request: Request) -> dict[str, Any]:
        require_admin(request, db)
        return readiness_report(db, settings)

    @api.get("/users")
    def users(request: Request, q: str = "") -> list[dict[str, Any]]:
        require_admin(request, db)
        query = q.strip().lower()
        with db.connect() as conn:
            if query:
                pattern = f"%{query}%"
                rows = conn.execute(
                    "SELECT * FROM users WHERE LOWER(username) LIKE ? OR LOWER(email) LIKE ? OR LOWER(display_name) LIKE ? ORDER BY created_at DESC LIMIT 200",
                    (pattern, pattern, pattern),
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM users ORDER BY created_at DESC LIMIT 200").fetchall()
        return [admin_user(db, row_to_dict(row) or {}) for row in rows]

    @api.patch("/users/{user_id}/role")
    def update_user_role(request: Request, user_id: str, payload: RoleUpdate) -> dict[str, Any]:
        current = require_admin(request, db)
        role = payload.role.strip().lower()
        if role not in {"member", "admin"}:
            raise HTTPException(status_code=422, detail="Role must be member or admin.")
        with db.connect() as conn:
            user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
            if not user:
                raise HTTPException(status_code=404, detail="User not found.")
            if user["id"] == current["id"] and role != "admin":
                raise HTTPException(status_code=400, detail="You cannot remove your own admin role.")
            previous = user.get("role") or "member"
            now = now_iso()
            conn.execute("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", (role, now, user_id))
            detail = f"{user['username']}: {previous} -> {role}"
            conn.execute(
                "INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (current["id"], "user.role.update", "user", user_id, detail, now),
            )
            updated = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
        return admin_user(db, updated or {})

    @api.patch("/users/{user_id}/risk")
    def update_user_risk(request: Request, user_id: str, payload: RiskUpdate) -> dict[str, Any]:
        current = require_admin(request, db)
        with db.connect() as conn:
            user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
            if not user:
                raise HTTPException(status_code=404, detail="User not found.")
            note = (payload.note or "").strip() if payload.risk_flagged else None
            now = now_iso()
            conn.execute(
                """
                INSERT INTO admin_user_flags (user_id, risk_flagged, note, updated_by, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET risk_flagged = excluded.risk_flagged, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at
                """,
                (user_id, int(payload.risk_flagged), note, current["id"], now),
            )
            detail = f"{user['username']}: risk flagged" if payload.risk_flagged else f"{user['username']}: risk cleared"
            if note:
                detail += " · " + note
            conn.execute(
                "INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (current["id"], "user.risk.update", "user", user_id, detail, now),
            )
        out = admin_user(db, user)
        out["risk_flagged"] = payload.risk_flagged
        out["risk_note"] = note
        return out

    @api.get("/mcp-servers")
    def mcp_servers(request: Request) -> list[dict[str, Any]]:
        require_admin(request, db)
        return list_configured_mcp_servers(settings, db)

    @api.patch("/mcp-servers/{server_id}")
    def update_mcp_server(request: Request, server_id: str, payload: ToggleUpdate) -> dict[str, Any]:
        current = require_admin(request, db)
        server = find_mcp_server(server_id)
        if not server:
            raise HTTPException(status_code=404, detail="MCP server not found.")
        now = now_iso()
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO mcp_server_settings (server_id, enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(server_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
                """,
                (server_id, int(payload.enabled), now, now),
            )
            detail = f"{server.name}: {'enabled' if payload.enabled else 'disabled'}"
            conn.execute(
                "INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (current["id"], "mcp.status.update", "mcp_server", server_id, detail, now),
            )
        return configured_mcp_server(server_id, settings, db) or {}

    @api.get("/agents")
    def agents(request: Request) -> list[dict[str, Any]]:
        require_admin(request, db)
        return list_configured_agents(db)

    @api.patch("/agents/{agent_id}")
    def update_agent_prompt(request: Request, agent_id: str, payload: AgentPromptUpdate) -> dict[str, Any]:
        current = require_admin(request, db)
        agent = find_agent(agent_id)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found.")
        version = payload.prompt_version.strip()
        prompt = payload.system_prompt.strip()
        if not version:
            raise HTTPException(status_code=422, detail="Prompt version is required.")
        if len(prompt) < 20:
            raise HTTPException(status_code=422, detail="System prompt must be at least 20 characters.")
        now = now_iso()
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO agent_prompt_settings (agent_id, prompt_version, system_prompt, updated_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(agent_id) DO UPDATE SET prompt_version = excluded.prompt_version, system_prompt = excluded.system_prompt, updated_by = excluded.updated_by, updated_at = excluded.updated_at
                """,
                (agent_id, version, prompt, current["id"], now, now),
            )
            detail = f"{agent.name}: {version}"
            conn.execute(
                "INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (current["id"], "agent.prompt.update", "agent", agent_id, detail, now),
            )
        return configured_agent(agent_id, db) or {}

    @api.get("/audit-logs")
    def audit_logs(request: Request) -> list[dict[str, Any]]:
        require_admin(request, db)
        with db.connect() as conn:
            rows = conn.execute("SELECT * FROM admin_audit_logs ORDER BY created_at DESC, id DESC LIMIT 60").fetchall()
            users = {row["id"]: row for row in conn.execute("SELECT id, username, display_name FROM users").fetchall()}
        out = []
        for row in rows:
            record = row_to_dict(row) or {}
            actor = users.get(record["actor_id"])
            actor_name = record["actor_id"]
            if actor:
                actor_name = actor["display_name"] or actor["username"]
            out.append({**record, "actor_name": actor_name})
        return out

    @api.post("/chat-attachments/migrate-private")
    def migrate_chat_attachments(request: Request, payload: AttachmentMaintenanceRequest) -> dict[str, int | bool]:
        current = require_admin(request, db)
        result = migrate_public_chat_attachments_to_private(settings, db, payload.dry_run)
        audit_admin_action(db, current["id"], "chat_attachment.migrate_private", "chat_attachment", "*", {**result, "dry_run": payload.dry_run})
        return {**result, "dry_run": payload.dry_run}

    @api.post("/chat-attachments/cleanup-orphans")
    def cleanup_chat_attachments(request: Request, payload: AttachmentMaintenanceRequest) -> dict[str, int | bool]:
        current = require_admin(request, db)
        min_age_seconds = max(0, int(payload.min_age_seconds or 0))
        result = cleanup_chat_attachment_orphans(settings, db, payload.dry_run, min_age_seconds)
        audit_admin_action(db, current["id"], "chat_attachment.cleanup_orphans", "chat_attachment", "*", {**result, "dry_run": payload.dry_run, "min_age_seconds": min_age_seconds})
        return {**result, "dry_run": payload.dry_run, "min_age_seconds": min_age_seconds}

    return api


def readiness_report(db: Database, settings: Settings) -> dict[str, Any]:
    checks = [
        database_readiness_check(db),
        configured_secret_check(
            "model_profile_encryption_key",
            bool(settings.model_profile_encryption_key),
            "MODEL_PROFILE_ENCRYPTION_KEY is configured.",
            "MODEL_PROFILE_ENCRYPTION_KEY is missing; encrypted model keys will use a local-dev fallback that is not suitable for production.",
        ),
        configured_secret_check(
            "chat_attachment_url_secret",
            bool(settings.chat_attachment_url_secret),
            "CHAT_ATTACHMENT_URL_SECRET is configured.",
            "CHAT_ATTACHMENT_URL_SECRET is missing; temporary attachment URLs will fall back to another local secret source.",
        ),
        private_media_root_check(settings),
        chat_attachment_url_ttl_check(settings),
        document_fts_readiness_check(db),
        pypdf_readiness_check(),
        bigmodel_mcp_readiness_check(settings),
        cors_readiness_check(settings),
    ]
    return {"status": overall_readiness_status(checks), "checks": checks}


def database_readiness_check(db: Database) -> dict[str, Any]:
    try:
        db.check()
    except Exception as error:
        return readiness_check("database", "error", "Database connection failed.", error_type=type(error).__name__)
    return readiness_check("database", "ok", "Database connection is reachable.", driver="sqlite")


def configured_secret_check(check_id: str, configured: bool, ok_message: str, warning_message: str) -> dict[str, Any]:
    status = "ok" if configured else "warning"
    return readiness_check(check_id, status, ok_message if configured else warning_message, configured=configured)


def private_media_root_check(settings: Settings) -> dict[str, Any]:
    private_root = settings.private_media_root.resolve()
    public_root = settings.media_root.resolve()
    if private_root == public_root or path_is_relative_to(private_root, public_root):
        return readiness_check(
            "private_media_root",
            "error",
            "PRIVATE_MEDIA_ROOT must not be the same as, or inside, public MEDIA_ROOT.",
            exists=private_root.exists(),
            writable=False,
            publicly_served_risk=True,
        )
    if not private_root.exists():
        return readiness_check("private_media_root", "error", "PRIVATE_MEDIA_ROOT does not exist.", exists=False, writable=False, publicly_served_risk=False)
    if not private_root.is_dir():
        return readiness_check("private_media_root", "error", "PRIVATE_MEDIA_ROOT is not a directory.", exists=True, writable=False, publicly_served_risk=False)
    try:
        with tempfile.NamedTemporaryFile(prefix=".readiness-", dir=private_root):
            pass
    except Exception as error:
        return readiness_check(
            "private_media_root",
            "error",
            "PRIVATE_MEDIA_ROOT is not writable by the backend process.",
            exists=True,
            writable=False,
            publicly_served_risk=False,
            error_type=type(error).__name__,
        )
    return readiness_check("private_media_root", "ok", "PRIVATE_MEDIA_ROOT exists, is writable, and is isolated from public MEDIA_ROOT.", exists=True, writable=True, publicly_served_risk=False)


def chat_attachment_url_ttl_check(settings: Settings) -> dict[str, Any]:
    ttl = int(settings.chat_attachment_url_ttl_seconds or 0)
    if ttl <= 0:
        return readiness_check("chat_attachment_url_ttl", "error", "CHAT_ATTACHMENT_URL_TTL_SECONDS must be greater than zero.", ttl_seconds=ttl)
    if ttl > 86_400:
        return readiness_check("chat_attachment_url_ttl", "warning", "CHAT_ATTACHMENT_URL_TTL_SECONDS is longer than one day.", ttl_seconds=ttl)
    return readiness_check("chat_attachment_url_ttl", "ok", "Temporary attachment URL TTL is within the expected range.", ttl_seconds=ttl)


def document_fts_readiness_check(db: Database) -> dict[str, Any]:
    try:
        with db.connect() as conn:
            available = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_document_chunks_fts'").fetchone() is not None
    except Exception as error:
        return readiness_check("document_fts5", "error", "Could not inspect the document FTS5 index.", error_type=type(error).__name__)
    if not available:
        return readiness_check("document_fts5", "warning", "SQLite FTS5 document index is unavailable; keyword fallback retrieval will be used.", available=False)
    return readiness_check("document_fts5", "ok", "SQLite FTS5 document index is available.", available=True)


def pypdf_readiness_check() -> dict[str, Any]:
    available = importlib.util.find_spec("pypdf") is not None
    if not available:
        return readiness_check("pypdf", "warning", "pypdf is unavailable; PDF attachments will fall back to metadata-only extraction.", available=False)
    return readiness_check("pypdf", "ok", "pypdf is available for PDF text extraction.", available=True)


def bigmodel_mcp_readiness_check(settings: Settings) -> dict[str, Any]:
    configured = bool(os.getenv("BIGMODEL_API_KEY", "").strip())
    if settings.bigmodel_mcp_live and not configured:
        return readiness_check("bigmodel_mcp", "error", "BIGMODEL_MCP_LIVE is enabled but BIGMODEL_API_KEY is not configured.", live_enabled=True, configured=False)
    if settings.bigmodel_mcp_live:
        return readiness_check("bigmodel_mcp", "ok", "BigModel MCP live mode is enabled and configured.", live_enabled=True, configured=True)
    return readiness_check("bigmodel_mcp", "ok", "BigModel MCP live mode is disabled; planned mode will be used.", live_enabled=False, configured=configured)


def cors_readiness_check(settings: Settings) -> dict[str, Any]:
    origin_count = len(settings.cors_origins)
    if origin_count == 0:
        return readiness_check("cors_origins", "warning", "CORS origins are empty; browser clients may be unable to call the API.", origin_count=0)
    return readiness_check("cors_origins", "ok", "CORS origins are configured.", origin_count=origin_count)


def readiness_check(check_id: str, status: str, message: str, **metadata: Any) -> dict[str, Any]:
    return {"id": check_id, "status": status, "message": message, **metadata}


def overall_readiness_status(checks: list[dict[str, Any]]) -> str:
    if any(check["status"] == "error" for check in checks):
        return "error"
    if any(check["status"] == "warning" for check in checks):
        return "warning"
    return "ok"


def path_is_relative_to(child: Path, parent: Path) -> bool:
    try:
        return child.is_relative_to(parent)
    except ValueError:
        return False


def scalar_count(conn, table: str, where: str = "") -> int:
    query = f"SELECT COUNT(*) AS count FROM {table}"
    if where:
        query += " WHERE " + where
    return int(conn.execute(query).fetchone()["count"])


def audit_admin_action(db: Database, actor_id: str, action: str, target_type: str, target_id: str, detail: dict[str, Any]) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (actor_id, action, target_type, target_id, json_dumps(detail), now_iso()),
        )


def admin_user(db: Database, user: dict[str, Any]) -> dict[str, Any]:
    with db.connect() as conn:
        session_count = scalar_count(conn, "auth_sessions", f"user_id = '{escape_sql(user['id'])}'")
        sent_count = scalar_count(conn, "direct_messages", f"sender_id = '{escape_sql(user['id'])}'")
        received_count = scalar_count(conn, "direct_messages", f"recipient_id = '{escape_sql(user['id'])}'")
        friend_count = scalar_count(conn, "friendships", f"user_a_id = '{escape_sql(user['id'])}' OR user_b_id = '{escape_sql(user['id'])}'")
        flag = row_to_dict(conn.execute("SELECT * FROM admin_user_flags WHERE user_id = ? AND risk_flagged = 1", (user["id"],)).fetchone())
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "display_name": user["display_name"],
        "avatar_url": public_media_url(user.get("avatar_path")),
        "role": user.get("role") or "member",
        "login_count": int(user.get("login_count") or 0),
        "session_count": session_count,
        "message_count": sent_count + received_count,
        "friend_count": friend_count,
        "risk_flagged": bool(flag and flag.get("risk_flagged")),
        "risk_note": flag.get("note") if flag else None,
        "last_login_at": user.get("last_login_at"),
        "created_at": user.get("created_at") or "",
        "updated_at": user.get("updated_at") or "",
    }


def escape_sql(value: Any) -> str:
    return str(value).replace("'", "''")
