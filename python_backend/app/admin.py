from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.agents.catalog import configured_agent, configured_mcp_server, find_agent, find_mcp_server, list_configured_agents, list_configured_mcp_servers
from app.auth import public_media_url, require_admin
from app.config import Settings
from app.database import Database, now_iso, row_to_dict
from app.modules import BLUEPRINTS, enabled_map, ensure_initial_settings


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

    return api


def scalar_count(conn, table: str, where: str = "") -> int:
    query = f"SELECT COUNT(*) AS count FROM {table}"
    if where:
        query += " WHERE " + where
    return int(conn.execute(query).fetchone()["count"])


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
