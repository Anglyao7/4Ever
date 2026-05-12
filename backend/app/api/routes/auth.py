from fastapi import APIRouter, Depends, Header, HTTPException
from typing import Optional
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import AuthSessionRecord, UserRecord
from app.db.session import get_db
from app.schemas.auth import AccountUpdateRequest, AuthResponse, AuthUser, PasswordChangeRequest, SignInRequest, SignUpRequest
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
    db.add(session)
    db.commit()
    return AuthResponse(token=token, user=to_auth_user(user))


@router.get("/me", response_model=AuthUser)
async def me(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)) -> AuthUser:
    return to_auth_user(resolve_user(authorization, db))


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
        role=user.role,
        created_at=user.created_at,
    )
