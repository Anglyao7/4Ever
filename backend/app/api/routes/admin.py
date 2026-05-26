from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.api.routes.auth import build_public_avatar_url, resolve_user
from app.api.routes.modules import MODULE_BLUEPRINTS, ensure_initial_module_settings, module_blueprint, module_enabled_map
from app.db.models import (
    AdminAuditLogRecord,
    AdminUserFlagRecord,
    AuthSessionRecord,
    DirectMessageRecord,
    FriendshipRecord,
    ModuleSettingRecord,
    UserRecord,
)
from app.db.session import get_db
from app.schemas.auth import AdminAuditLog, AdminOverview, AdminUser, AdminUserRiskUpdate, AdminUserRoleUpdate
from app.schemas.modules import ModuleAdminModule, ModuleUpdateRequest


router = APIRouter(prefix="/admin", tags=["admin"])
ALLOWED_ROLES = {"member", "admin"}


@router.get("/overview", response_model=AdminOverview)
async def overview(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminOverview:
    require_admin(authorization, db)
    ensure_initial_module_settings(db)
    enabled_map = module_enabled_map(db)
    enabled_count = sum(1 for blueprint in MODULE_BLUEPRINTS if enabled_map.get(blueprint["id"], blueprint["enabled"]))
    return AdminOverview(
        user_count=db.scalar(select(func.count(UserRecord.id))) or 0,
        admin_count=db.scalar(select(func.count(UserRecord.id)).where(UserRecord.role == "admin")) or 0,
        active_session_count=db.scalar(select(func.count(AuthSessionRecord.id))) or 0,
        direct_message_count=db.scalar(select(func.count(DirectMessageRecord.id))) or 0,
        enabled_module_count=enabled_count,
        disabled_module_count=len(MODULE_BLUEPRINTS) - enabled_count,
    )


@router.get("/users", response_model=list[AdminUser])
async def list_users(
    q: str = Query(default="", max_length=160),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> list[AdminUser]:
    require_admin(authorization, db)
    session_counts = (
        select(AuthSessionRecord.user_id.label("user_id"), func.count(AuthSessionRecord.id).label("session_count"))
        .group_by(AuthSessionRecord.user_id)
        .subquery()
    )
    sent_message_counts = (
        select(DirectMessageRecord.sender_id.label("user_id"), func.count(DirectMessageRecord.id).label("sent_message_count"))
        .group_by(DirectMessageRecord.sender_id)
        .subquery()
    )
    received_message_counts = (
        select(
            DirectMessageRecord.recipient_id.label("user_id"),
            func.count(DirectMessageRecord.id).label("received_message_count"),
        )
        .group_by(DirectMessageRecord.recipient_id)
        .subquery()
    )
    friendship_counts = (
        select(
            UserRecord.id.label("user_id"),
            func.count(FriendshipRecord.id).label("friendship_count"),
        )
        .join(
            FriendshipRecord,
            or_(FriendshipRecord.user_a_id == UserRecord.id, FriendshipRecord.user_b_id == UserRecord.id),
            isouter=True,
        )
        .group_by(UserRecord.id)
        .subquery()
    )
    risk_flags = (
        select(
            AdminUserFlagRecord.user_id.label("user_id"),
            AdminUserFlagRecord.risk_flagged.label("risk_flagged"),
            AdminUserFlagRecord.note.label("risk_note"),
        )
        .where(AdminUserFlagRecord.risk_flagged.is_(True))
        .subquery()
    )
    statement = (
        select(
            UserRecord,
            func.coalesce(session_counts.c.session_count, 0).label("session_count"),
            func.coalesce(sent_message_counts.c.sent_message_count, 0).label("sent_message_count"),
            func.coalesce(received_message_counts.c.received_message_count, 0).label("received_message_count"),
            func.coalesce(friendship_counts.c.friendship_count, 0).label("friendship_count"),
            func.coalesce(risk_flags.c.risk_flagged, False).label("risk_flagged"),
            risk_flags.c.risk_note.label("risk_note"),
        )
        .outerjoin(session_counts, session_counts.c.user_id == UserRecord.id)
        .outerjoin(sent_message_counts, sent_message_counts.c.user_id == UserRecord.id)
        .outerjoin(received_message_counts, received_message_counts.c.user_id == UserRecord.id)
        .outerjoin(friendship_counts, friendship_counts.c.user_id == UserRecord.id)
        .outerjoin(risk_flags, risk_flags.c.user_id == UserRecord.id)
    )
    query = q.strip().lower()
    if query:
        pattern = f"%{query}%"
        statement = statement.where(
            or_(
                func.lower(UserRecord.username).like(pattern),
                func.lower(UserRecord.email).like(pattern),
                func.lower(UserRecord.display_name).like(pattern),
            ),
        )
    rows = db.execute(statement.order_by(UserRecord.created_at.desc()).limit(200)).all()
    return [
        to_admin_user(
            user,
            session_count=session_count,
            sent_message_count=sent_message_count,
            received_message_count=received_message_count,
            friendship_count=friendship_count,
            risk_flagged=bool(risk_flagged),
            risk_note=risk_note,
        )
        for user, session_count, sent_message_count, received_message_count, friendship_count, risk_flagged, risk_note in rows
    ]


@router.patch("/users/{user_id}/role", response_model=AdminUser)
async def update_user_role(
    user_id: str,
    request: AdminUserRoleUpdate,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminUser:
    current_user = require_admin(authorization, db)
    role = request.role.strip().lower()
    if role not in ALLOWED_ROLES:
        raise HTTPException(status_code=422, detail="Role must be member or admin.")
    user = db.get(UserRecord, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == current_user.id and role != "admin":
        raise HTTPException(status_code=400, detail="You cannot remove your own admin role.")
    previous_role = user.role
    user.role = role
    db.add(
        AdminAuditLogRecord(
            actor_id=current_user.id,
            action="user.role.update",
            target_type="user",
            target_id=user.id,
            detail=f"{user.username}: {previous_role} -> {role}",
        ),
    )
    db.commit()
    db.refresh(user)
    return to_admin_user_with_flag(user, db)


@router.patch("/users/{user_id}/risk", response_model=AdminUser)
async def update_user_risk(
    user_id: str,
    request: AdminUserRiskUpdate,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminUser:
    current_user = require_admin(authorization, db)
    user = db.get(UserRecord, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    note = request.note.strip() if request.note else None
    flag = db.get(AdminUserFlagRecord, user_id)
    if not flag:
        flag = AdminUserFlagRecord(user_id=user_id)
    flag.risk_flagged = request.risk_flagged
    flag.note = note if request.risk_flagged else None
    flag.updated_by = current_user.id
    db.add(flag)
    db.add(
        AdminAuditLogRecord(
            actor_id=current_user.id,
            action="user.risk.update",
            target_type="user",
            target_id=user.id,
            detail=f"{user.username}: {'risk flagged' if request.risk_flagged else 'risk cleared'}{f' · {note}' if note else ''}",
        ),
    )
    db.commit()
    db.refresh(user)
    return to_admin_user(user, risk_flagged=flag.risk_flagged, risk_note=flag.note)


@router.get("/modules", response_model=list[ModuleAdminModule])
async def list_admin_modules(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> list[ModuleAdminModule]:
    require_admin(authorization, db)
    ensure_initial_module_settings(db)
    enabled_map = module_enabled_map(db)
    return [
        ModuleAdminModule(
            id=blueprint["id"],
            name=blueprint["name"],
            description=blueprint["description"],
            category=blueprint["category"],
            enabled=enabled_map.get(blueprint["id"], blueprint["enabled"]),
            locked=blueprint["locked"],
        )
        for blueprint in MODULE_BLUEPRINTS
    ]


@router.patch("/modules/{module_id}", response_model=ModuleAdminModule)
async def update_module_status(
    module_id: str,
    request: ModuleUpdateRequest,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> ModuleAdminModule:
    current_user = require_admin(authorization, db)
    blueprint = module_blueprint(module_id)
    if blueprint is None:
        raise HTTPException(status_code=404, detail="Module not found.")
    if blueprint["locked"]:
        raise HTTPException(status_code=400, detail="This module cannot be disabled.")
    ensure_initial_module_settings(db)
    record = db.get(ModuleSettingRecord, module_id)
    if not record:
        record = ModuleSettingRecord(module_id=module_id, enabled=request.enabled, locked=False)
        db.add(record)
    else:
        record.enabled = request.enabled
    db.add(
        AdminAuditLogRecord(
            actor_id=current_user.id,
            action="module.status.update",
            target_type="module",
            target_id=module_id,
            detail=f"{blueprint['name']}: {'enabled' if request.enabled else 'disabled'}",
        ),
    )
    db.commit()
    return ModuleAdminModule(
        id=blueprint["id"],
        name=blueprint["name"],
        description=blueprint["description"],
        category=blueprint["category"],
        enabled=request.enabled,
        locked=blueprint["locked"],
    )


@router.get("/audit-logs", response_model=list[AdminAuditLog])
async def list_audit_logs(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> list[AdminAuditLog]:
    require_admin(authorization, db)
    rows = db.execute(
        select(AdminAuditLogRecord, UserRecord.display_name, UserRecord.username)
        .join(UserRecord, UserRecord.id == AdminAuditLogRecord.actor_id)
        .order_by(AdminAuditLogRecord.created_at.desc(), AdminAuditLogRecord.id.desc())
        .limit(60),
    ).all()
    return [
        AdminAuditLog(
            id=log.id,
            actor_id=log.actor_id,
            actor_name=display_name or username,
            action=log.action,
            target_type=log.target_type,
            target_id=log.target_id,
            detail=log.detail,
            created_at=log.created_at,
        )
        for log, display_name, username in rows
    ]


def require_admin(authorization: Optional[str], db: Session) -> UserRecord:
    user = resolve_user(authorization, db)
    ensure_initial_admin(user, db)
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


def ensure_initial_admin(user: UserRecord, db: Session) -> None:
    admin_exists = db.scalar(select(UserRecord.id).where(UserRecord.role == "admin").limit(1))
    if admin_exists:
        return
    db.execute(update(UserRecord).where(UserRecord.id == user.id).values(role="admin"))
    db.commit()
    db.refresh(user)


def to_admin_user(
    user: UserRecord,
    session_count: int = 0,
    sent_message_count: int = 0,
    received_message_count: int = 0,
    friendship_count: int = 0,
    risk_flagged: bool = False,
    risk_note: Optional[str] = None,
) -> AdminUser:
    return AdminUser(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        avatar_url=build_public_avatar_url(user.avatar_path),
        role=user.role,
        login_count=user.login_count or 0,
        session_count=session_count,
        message_count=sent_message_count + received_message_count,
        friend_count=friendship_count,
        risk_flagged=risk_flagged,
        risk_note=risk_note,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def to_admin_user_with_flag(user: UserRecord, db: Session) -> AdminUser:
    flag = db.get(AdminUserFlagRecord, user.id)
    return to_admin_user(
        user,
        risk_flagged=bool(flag.risk_flagged) if flag else False,
        risk_note=flag.note if flag and flag.risk_flagged else None,
    )
