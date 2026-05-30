from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routes.auth import resolve_user
from app.db.models import ModuleSettingRecord
from app.db.session import get_db
from app.schemas.modules import PlatformModule


router = APIRouter(prefix="/modules", tags=["modules"])

MODULE_BLUEPRINTS = [
    {
        "id": "dashboard",
        "name": "见微知著",
        "description": "查看平台模块、接口状态和后续扩展入口。",
        "category": "system",
        "locked": True,
        "enabled": True,
    },
    {
        "id": "chat",
        "name": "交耳",
        "description": "真实用户好友、私聊和 AI 会话模块。",
        "category": "ai",
        "locked": False,
        "enabled": True,
    },
    {
        "id": "image-generation",
        "name": "绘影",
        "description": "图像生成实验台，可使用独立图像模型配置。",
        "category": "ai",
        "locked": False,
        "enabled": True,
    },
    {
        "id": "provider-hub",
        "name": "接口中枢",
        "description": "统一维护全局模型 API 与当前配置。",
        "category": "integration",
        "locked": False,
        "enabled": True,
    },
    {
        "id": "notes",
        "name": "笔记",
        "description": "Markdown 写作、笔记暂存和实时渲染。",
        "category": "productivity",
        "locked": False,
        "enabled": True,
    },
    {
        "id": "memory-map",
        "name": "地图纪念",
        "description": "以普通地图记录地点、时间和纪念点。",
        "category": "productivity",
        "locked": False,
        "enabled": True,
    },
    {
        "id": "workflow",
        "name": "秩序",
        "description": "面向用户开放 Agent、MCP 和工作流编排。",
        "category": "automation",
        "locked": False,
        "enabled": True,
    },
    {
        "id": "token-usage",
        "name": "Token统计",
        "description": "统计本机 AI 工具 Token 用量、活跃度和排行榜。",
        "category": "analytics",
        "locked": False,
        "enabled": True,
    },
    {
        "id": "inspiration",
        "name": "灵感温室",
        "description": "依托大模型发掘新灵感、追问并沉淀下一步。",
        "category": "productivity",
        "locked": False,
        "enabled": True,
    },
    {
        "id": "admin",
        "name": "管理员端",
        "description": "用户、权限、审计和系统配置能力。",
        "category": "system",
        "locked": True,
        "enabled": True,
    },
]


@router.get("", response_model=list[PlatformModule])
async def list_modules(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> list[PlatformModule]:
    ensure_initial_module_settings(db)
    enabled_map = module_enabled_map(db)
    is_admin = user_is_admin(authorization, db)
    modules = []
    for blueprint in MODULE_BLUEPRINTS:
        if blueprint["id"] == "admin" and not is_admin:
            continue
        enabled = enabled_map.get(blueprint["id"], blueprint["enabled"])
        if not enabled:
            continue
        modules.append(
            PlatformModule(
                id=blueprint["id"],
                name=blueprint["name"],
                description=blueprint["description"],
                category=blueprint["category"],
                enabled=enabled,
                locked=blueprint["locked"],
            ),
        )
    return modules


def user_is_admin(authorization: Optional[str], db: Session) -> bool:
    if not authorization:
        return False
    try:
        user = resolve_user(authorization, db)
    except HTTPException:
        return False
    return user.role == "admin"


def module_blueprint(module_id: str) -> Optional[dict]:
    for blueprint in MODULE_BLUEPRINTS:
        if blueprint["id"] == module_id:
            return blueprint
    return None


def module_enabled_map(db: Session) -> dict[str, bool]:
    records = db.scalars(select(ModuleSettingRecord)).all()
    return {record.module_id: record.enabled for record in records}


def ensure_initial_module_settings(db: Session) -> None:
    existing_ids = set(db.scalars(select(ModuleSettingRecord.module_id)).all())
    for blueprint in MODULE_BLUEPRINTS:
        if blueprint["id"] not in existing_ids:
            db.add(
                ModuleSettingRecord(
                    module_id=blueprint["id"],
                    enabled=blueprint["enabled"],
                    locked=blueprint["locked"],
                ),
            )
    db.commit()
