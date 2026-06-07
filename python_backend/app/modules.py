from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth import hash_token, require_admin
from app.database import Database, now_iso, row_to_dict


BLUEPRINTS: list[dict[str, Any]] = [
    {"id": "dashboard", "name": "见微知著", "description": "查看平台模块、接口状态和后续扩展入口。", "category": "system", "locked": True, "enabled": True},
    {"id": "profile", "name": "个人中心", "description": "管理头像、签名、所在地、密码和绑定平台。", "category": "system", "locked": False, "enabled": True},
    {"id": "chat", "name": "交耳", "description": "真实用户好友、私聊和 AI 会话模块。", "category": "ai", "locked": False, "enabled": True},
    {"id": "image-generation", "name": "虚实", "description": "图像生成实验台，可使用独立图像模型配置。", "category": "ai", "locked": False, "enabled": True},
    {"id": "provider-hub", "name": "中枢", "description": "统一维护全局模型 API 与当前配置。", "category": "integration", "locked": False, "enabled": True},
    {"id": "notes", "name": "笔记", "description": "Markdown 写作、笔记暂存和实时渲染。", "category": "productivity", "locked": False, "enabled": True},
    {"id": "memory-map", "name": "地图纪念", "description": "以普通地图记录地点、时间和纪念点。", "category": "productivity", "locked": False, "enabled": True},
    {"id": "workflow", "name": "秩序", "description": "面向用户开放 Agent、MCP 和工作流编排。", "category": "automation", "locked": False, "enabled": True},
    {"id": "token-usage", "name": "Token统计", "description": "统计本机 AI 工具 Token 用量、活跃度和排行榜。", "category": "analytics", "locked": False, "enabled": True},
    {"id": "inspiration", "name": "灵感", "description": "依托大模型发掘新灵感、追问并沉淀下一步。", "category": "productivity", "locked": False, "enabled": True},
    {"id": "admin", "name": "管理员端", "description": "用户、权限、审计和系统配置能力。", "category": "system", "locked": True, "enabled": True},
]


class ModuleUpdate(BaseModel):
    enabled: bool


def router(db: Database) -> APIRouter:
    api = APIRouter(prefix="/api/modules")

    @api.get("")
    def list_modules(request: Request) -> list[dict[str, Any]]:
        ensure_initial_settings(db)
        enabled = enabled_map(db)
        admin = optional_admin(request, db)
        result: list[dict[str, Any]] = []
        for blueprint in BLUEPRINTS:
            if blueprint["id"] == "admin" and not admin:
                continue
            item = dict(blueprint)
            item["enabled"] = enabled.get(item["id"], bool(item["enabled"]))
            if item["enabled"]:
                result.append(item)
        return result

    return api


def ensure_initial_settings(db: Database) -> None:
    with db.connect() as conn:
        now = now_iso()
        for blueprint in BLUEPRINTS:
            exists = conn.execute("SELECT 1 FROM module_settings WHERE module_id = ?", (blueprint["id"],)).fetchone()
            if not exists:
                conn.execute(
                    "INSERT INTO module_settings (module_id, enabled, locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (blueprint["id"], int(bool(blueprint["enabled"])), int(bool(blueprint["locked"])), now, now),
                )


def enabled_map(db: Database) -> dict[str, bool]:
    with db.connect() as conn:
        rows = conn.execute("SELECT module_id, enabled FROM module_settings").fetchall()
    return {row["module_id"]: bool(row["enabled"]) for row in rows}


def update_module(db: Database, module_id: str, enabled: bool) -> dict[str, Any]:
    blueprint = next((item for item in BLUEPRINTS if item["id"] == module_id), None)
    if not blueprint:
        raise HTTPException(status_code=404, detail="Module not found.")
    if blueprint.get("locked"):
        raise HTTPException(status_code=400, detail="This module cannot be disabled.")
    ensure_initial_settings(db)
    now = now_iso()
    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO module_settings (module_id, enabled, locked, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(module_id) DO UPDATE SET enabled = excluded.enabled, locked = excluded.locked, updated_at = excluded.updated_at
            """,
            (module_id, int(enabled), int(bool(blueprint["locked"])), now, now),
        )
    updated = dict(blueprint)
    updated["enabled"] = enabled
    return updated


def optional_admin(request: Request, db: Database) -> bool:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return False
    token = header.removeprefix("Bearer ").strip()
    if not token:
        return False
    with db.connect() as conn:
        session = row_to_dict(conn.execute("SELECT * FROM auth_sessions WHERE token_hash = ?", (hash_token(token),)).fetchone())
        if not session:
            return False
        user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone())
    return bool(user and user.get("role") == "admin")


def admin_router(db: Database) -> APIRouter:
    api = APIRouter(prefix="/api/admin/modules")

    @api.get("")
    def list_admin_modules(request: Request) -> list[dict[str, Any]]:
        require_admin(request, db)
        ensure_initial_settings(db)
        enabled = enabled_map(db)
        out: list[dict[str, Any]] = []
        for blueprint in BLUEPRINTS:
            item = dict(blueprint)
            item["enabled"] = enabled.get(item["id"], bool(item["enabled"]))
            out.append(item)
        return out

    @api.patch("/{module_id}")
    def patch_module(request: Request, module_id: str, payload: ModuleUpdate) -> dict[str, Any]:
        current = require_admin(request, db)
        updated = update_module(db, module_id, payload.enabled)
        detail = f"{updated['name']}: {'enabled' if payload.enabled else 'disabled'}"
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (current["id"], "module.status.update", "module", module_id, detail, now_iso()),
            )
        return updated

    return api
