import base64
import imghdr
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import AuthSessionRecord, UserRecord
from app.db.session import get_db
from app.schemas.auth import (
    AccountUpdateRequest,
    AuthResponse,
    AuthUser,
    AvatarUploadRequest,
    PasswordChangeRequest,
    SignInRequest,
    SignUpRequest,
    UserSearchResult,
)
from app.services.auth import (
    hash_password,
    hash_token,
    new_session,
    new_user_id,
    normalize_email,
    normalize_username,
    verify_password,
)


router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()
ALLOWED_AVATAR_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_AVATAR_BYTES = 3 * 1024 * 1024


@router.post("/sign-up", response_model=AuthResponse)
async def sign_up(request: SignUpRequest, db: Session = Depends(get_db)) -> AuthResponse:
    username = normalize_username(request.username)
    email = normalize_email(request.email)
    if "@" not in email:
        raise HTTPException(status_code=422, detail="Email is invalid.")

    existing = db.scalar(
        select(UserRecord).where(or_(UserRecord.username == username, UserRecord.email == email)),
    )
    if existing:
        raise HTTPException(status_code=409, detail="Username or email already exists.")

    user = UserRecord(
        id=new_user_id(),
        username=username,
        email=email,
        display_name=(request.display_name or request.username).strip(),
        password_hash=hash_password(request.password),
    )
    token, session = new_session(user)
    db.add(user)
    db.add(session)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or email already exists.") from exc
    db.refresh(user)
    return AuthResponse(token=token, user=to_auth_user(user))


@router.post("/sign-in", response_model=AuthResponse)
async def sign_in(request: SignInRequest, db: Session = Depends(get_db)) -> AuthResponse:
    identifier = normalize_email(request.identifier)
    user = db.scalar(
        select(UserRecord).where(or_(UserRecord.username == identifier, UserRecord.email == identifier)),
    )
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username/email or password.")

    token, session = new_session(user)
    user.login_count = (user.login_count or 0) + 1
    user.last_login_at = datetime.utcnow()
    db.add(session)
    db.commit()
    return AuthResponse(token=token, user=to_auth_user(user))


@router.get("/me", response_model=AuthUser)
async def me(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)) -> AuthUser:
    return to_auth_user(resolve_user(authorization, db))


@router.get("/users/search", response_model=list[UserSearchResult])
async def search_users(
    q: str = Query(min_length=1, max_length=160),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> list[UserSearchResult]:
    current_user = resolve_user(authorization, db)
    query = normalize_email(q)
    pattern = f"%{query}%"
    users = db.scalars(
        select(UserRecord)
        .where(
            UserRecord.id != current_user.id,
            or_(
                UserRecord.username.ilike(pattern),
                UserRecord.email.ilike(pattern),
                UserRecord.display_name.ilike(pattern),
            ),
        )
        .order_by(UserRecord.username.asc())
        .limit(12),
    ).all()
    return [to_user_search_result(user) for user in users]


@router.patch("/me", response_model=AuthUser)
async def update_me(
    request: AccountUpdateRequest,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> AuthUser:
    user = resolve_user(authorization, db)

    if request.email is not None:
        email = normalize_email(request.email)
        if "@" not in email:
            raise HTTPException(status_code=422, detail="Email is invalid.")
        existing = db.scalar(select(UserRecord).where(UserRecord.email == email, UserRecord.id != user.id))
        if existing:
            raise HTTPException(status_code=409, detail="Email already exists.")
        user.email = email

    if request.display_name is not None:
        user.display_name = request.display_name.strip()

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Account update conflicts with an existing user.") from exc
    db.refresh(user)
    return to_auth_user(user)


@router.post("/me/avatar", response_model=AuthUser)
async def upload_avatar(
    request: AvatarUploadRequest,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> AuthUser:
    user = resolve_user(authorization, db)
    content_type = request.content_type.strip().lower()
    extension = ALLOWED_AVATAR_TYPES.get(content_type)
    if not extension:
        raise HTTPException(status_code=415, detail="Avatar must be JPG, PNG, WEBP, or GIF.")

    try:
        image_bytes = base64.b64decode(request.data_base64, validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise HTTPException(status_code=422, detail="Avatar data is invalid.") from exc

    if not image_bytes:
        raise HTTPException(status_code=422, detail="Avatar file is empty.")
    if len(image_bytes) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=413, detail="Avatar must be 3 MB or smaller.")

    sniffed = imghdr.what(None, image_bytes)
    if sniffed not in {"jpeg", "png", "webp", "gif"}:
        raise HTTPException(status_code=415, detail="Avatar content is not a supported image.")

    avatar_dir = settings.media_root / settings.avatar_upload_dirname
    avatar_dir.mkdir(parents=True, exist_ok=True)
    avatar_path = avatar_dir / f"{user.id}{extension}"

    remove_old_avatar_file(user.avatar_path, keep_path=avatar_path)
    avatar_path.write_bytes(image_bytes)

    user.avatar_path = f"{settings.avatar_upload_dirname}/{avatar_path.name}"
    db.commit()
    db.refresh(user)
    return to_auth_user(user)


@router.post("/password")
async def change_password(
    request: PasswordChangeRequest,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    user = resolve_user(authorization, db)
    if not verify_password(request.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")
    user.password_hash = hash_password(request.new_password)
    db.commit()
    return {"status": "ok"}


def resolve_user(authorization: Optional[str], db: Session) -> UserRecord:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token.")
    token = authorization.removeprefix("Bearer ").strip()
    session = db.scalar(select(AuthSessionRecord).where(AuthSessionRecord.token_hash == hash_token(token)))
    if not session:
        raise HTTPException(status_code=401, detail="Invalid auth token.")
    user = db.get(UserRecord, session.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid auth token.")
    return user


def to_auth_user(user: UserRecord) -> AuthUser:
    return AuthUser(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        avatar_url=build_public_avatar_url(user.avatar_path),
        role=user.role,
        created_at=user.created_at,
    )


def to_user_search_result(user: UserRecord) -> UserSearchResult:
    return UserSearchResult(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        status="active",
        bio="",
        avatar_url=build_public_avatar_url(user.avatar_path),
    )


def build_public_avatar_url(avatar_path: Optional[str]) -> Optional[str]:
    if not avatar_path:
        return None
    return f"/api/media/{avatar_path.lstrip('/')}"


def remove_old_avatar_file(stored_path: Optional[str], keep_path: Path) -> None:
    if not stored_path:
        return
    relative = stored_path.strip("/")
    file_path = settings.media_root / relative
    if file_path == keep_path:
        return
    try:
        file_path.unlink(missing_ok=True)
    except OSError:
        return
