from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

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
        "description": "兼容 OpenAI、Anthropic、Gemini 格式的对话模块。",
        "category": "ai",
        "locked": False,
        "enabled": True,
    },
    {
        "id": "image-generation",
        "name": "虚实",
        "description": "文本生图、多模型聚合和生成记录能力。",
        "category": "ai",
        "locked": False,
        "enabled": True,
    },
    {
        "id": "provider-hub",
        "name": "聚合",
        "description": "统一管理模型供应商、密钥和默认模型。",
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
        "description": "以 3D 世界地图记录地点、时间和纪念点。",
        "category": "productivity",
        "locked": False,
        "enabled": True,
    },
    {
        "id": "workflow",
        "name": "秩序",
        "description": "自动化流程、任务节点和触发器。",
        "category": "automation",
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
async def list_modules(db: Session = Depends(get_db)) -> list[PlatformModule]:
    ensure_initial_module_settings(db)
    enabled_map = module_enabled_map(db)
    modules = []
    for blueprint in MODULE_BLUEPRINTS:
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
