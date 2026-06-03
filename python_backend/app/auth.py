from __future__ import annotations

import base64
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import sqlite3
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.config import Settings
from app.database import Database, now_iso, row_to_dict, touch_user


PASSWORD_ITERATIONS = 210000


class SignUpRequest(BaseModel):
    username: str
    email: str
    password: str
    display_name: str | None = None


class SignInRequest(BaseModel):
    identifier: str
    password: str


class AccountUpdateRequest(BaseModel):
    display_name: str | None = None
    email: str | None = None
    bio: str | None = None
    location: str | None = None


class AvatarUploadRequest(BaseModel):
    filename: str
    content_type: str
    data_base64: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


def router(db: Database, settings: Settings) -> APIRouter:
    api = APIRouter(prefix="/api/auth")

    @api.post("/sign-up")
    def sign_up(payload: SignUpRequest) -> dict[str, Any]:
        username = normalize(payload.username)
        email = normalize(payload.email)
        if len(username) < 3 or len(username) > 80:
            raise HTTPException(status_code=422, detail="Username must be between 3 and 80 characters.")
        if len(email) < 5 or len(email) > 160 or "@" not in email:
            raise HTTPException(status_code=422, detail="Email is invalid.")
        if len(payload.password) < 8 or len(payload.password) > 128:
            raise HTTPException(status_code=422, detail="Password must be between 8 and 128 characters.")
        display_name = (payload.display_name or payload.username).strip() or payload.username.strip()
        if len(display_name) > 120:
            raise HTTPException(status_code=422, detail="display_name must be 120 characters or fewer.")
        user_id = str(uuid.uuid4())
        now = now_iso()
        token, token_hash = new_session_token()
        try:
            with db.connect() as conn:
                conn.execute(
                    """
                    INSERT INTO users (id, username, email, display_name, password_hash, role, bio, location, login_count, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'member', '', '', 0, ?, ?)
                    """,
                    (user_id, username, email, display_name, hash_password(payload.password), now, now),
                )
                conn.execute(
                    "INSERT INTO auth_sessions (user_id, token_hash, created_at) VALUES (?, ?, ?)",
                    (user_id, token_hash, now),
                )
                user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="Username or email already exists.") from error
        return {"token": token, "user": to_auth_user(user)}

    @api.post("/sign-in")
    def sign_in(payload: SignInRequest) -> dict[str, Any]:
        identifier = normalize(payload.identifier)
        with db.connect() as conn:
            user = row_to_dict(conn.execute("SELECT * FROM users WHERE username = ? OR email = ?", (identifier, identifier)).fetchone())
            if not user or not verify_password(payload.password, str(user["password_hash"])):
                raise HTTPException(status_code=401, detail="Invalid username/email or password.")
            token, token_hash = new_session_token()
            now = now_iso()
            conn.execute(
                "UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = ?, updated_at = ? WHERE id = ?",
                (now, now, user["id"]),
            )
            conn.execute("INSERT INTO auth_sessions (user_id, token_hash, created_at) VALUES (?, ?, ?)", (user["id"], token_hash, now))
            user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
        return {"token": token, "user": to_auth_user(user)}

    @api.get("/me")
    def me(request: Request) -> dict[str, Any]:
        return to_auth_user(require_user(request, db))

    @api.get("/me/platforms")
    def platforms(request: Request) -> dict[str, Any]:
        user = require_user(request, db)
        with db.connect() as conn:
            cli_keys = conn.execute(
                "SELECT COUNT(*) AS count FROM token_usage_api_keys WHERE user_id = ? AND status = 'active'",
                (user["id"],),
            ).fetchone()["count"]
            sessions = conn.execute("SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = ?", (user["id"],)).fetchone()["count"]
        return {
            "platforms": [
                {"id": "account", "name": "4Ever 账户", "description": "登录身份与基础资料", "status": "active", "detail": f"{sessions} 个会话"},
                {"id": "token-cli", "name": "Token CLI", "description": "本机 Token 用量同步", "status": "active" if cli_keys else "empty", "detail": f"{cli_keys} 个 active key"},
                {"id": "tencent-map", "name": "腾讯地图", "description": "所在地与城市搜索能力", "status": "active" if settings.tencent_map_key else "empty", "detail": "已配置" if settings.tencent_map_key else "未配置"},
            ]
        }

    @api.get("/users/search")
    def search_users(request: Request, q: str = "") -> list[dict[str, Any]]:
        current = require_user(request, db)
        query = normalize(q)
        if not query:
            raise HTTPException(status_code=422, detail="q is required")
        if len(query) > 160:
            raise HTTPException(status_code=422, detail="q must be 160 characters or fewer.")
        pattern = f"%{query}%"
        with db.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM users
                WHERE id <> ? AND (LOWER(username) LIKE ? OR LOWER(email) LIKE ? OR LOWER(display_name) LIKE ?)
                ORDER BY username ASC
                LIMIT 12
                """,
                (current["id"], pattern, pattern, pattern),
            ).fetchall()
        return [to_user_search_result(row_to_dict(row)) for row in rows]

    @api.patch("/me")
    def update_me(request: Request, payload: AccountUpdateRequest) -> dict[str, Any]:
        user = require_user(request, db)
        fields: dict[str, Any] = {}
        if payload.email is not None:
            email = normalize(payload.email)
            if len(email) < 5 or len(email) > 160 or "@" not in email:
                raise HTTPException(status_code=422, detail="Email is invalid.")
            fields["email"] = email
        if payload.display_name is not None:
            display_name = payload.display_name.strip()
            if not display_name or len(display_name) > 120:
                raise HTTPException(status_code=422, detail="display_name must be between 1 and 120 characters.")
            fields["display_name"] = display_name
        if payload.bio is not None:
            if len(payload.bio) > 280:
                raise HTTPException(status_code=422, detail="bio must be 280 characters or fewer.")
            fields["bio"] = payload.bio.strip()
        if payload.location is not None:
            if len(payload.location) > 160:
                raise HTTPException(status_code=422, detail="location must be 160 characters or fewer.")
            fields["location"] = payload.location.strip()
        if not fields:
            return to_auth_user(user)
        fields["updated_at"] = now_iso()
        assignments = ", ".join(f"{name} = ?" for name in fields)
        try:
            with db.connect() as conn:
                conn.execute(f"UPDATE users SET {assignments} WHERE id = ?", (*fields.values(), user["id"]))
                updated = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="Account update conflicts with an existing user.") from error
        return to_auth_user(updated)

    @api.post("/me/avatar")
    def upload_avatar(request: Request, payload: AvatarUploadRequest) -> dict[str, Any]:
        return _upload_profile_image(request, payload, db, settings, settings.avatar_upload_dirname, "Avatar", 3 * 1024 * 1024, "avatar_path")

    @api.post("/me/cover")
    def upload_cover(request: Request, payload: AvatarUploadRequest) -> dict[str, Any]:
        return _upload_profile_image(request, payload, db, settings, settings.profile_cover_dirname, "Profile cover", 6 * 1024 * 1024, "cover_path")

    @api.post("/password")
    def change_password(request: Request, payload: PasswordChangeRequest) -> dict[str, str]:
        user = require_user(request, db)
        if len(payload.new_password) < 8 or len(payload.new_password) > 128:
            raise HTTPException(status_code=422, detail="New password must be between 8 and 128 characters.")
        if not verify_password(payload.current_password, str(user["password_hash"])):
            raise HTTPException(status_code=401, detail="Current password is incorrect.")
        with db.connect() as conn:
            conn.execute("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", (hash_password(payload.new_password), now_iso(), user["id"]))
        return {"status": "ok"}

    return api


def require_user(request: Request, db: Database) -> dict[str, Any]:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token.")
    token = header.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing auth token.")
    with db.connect() as conn:
        session = row_to_dict(conn.execute("SELECT * FROM auth_sessions WHERE token_hash = ?", (hash_token(token),)).fetchone())
        if not session:
            raise HTTPException(status_code=401, detail="Invalid auth token.")
        user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone())
        if not user:
            raise HTTPException(status_code=401, detail="Invalid auth token.")
    return user


def require_admin(request: Request, db: Database) -> dict[str, Any]:
    user = require_user(request, db)
    with db.connect() as conn:
        admin_count = conn.execute("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").fetchone()["count"]
        if admin_count == 0:
            conn.execute("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?", (now_iso(), user["id"]))
            user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()) or user
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


def to_auth_user(user: dict[str, Any] | None) -> dict[str, Any]:
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "display_name": user["display_name"],
        "avatar_url": public_media_url(user.get("avatar_path")),
        "cover_url": public_media_url(user.get("cover_path")),
        "bio": user.get("bio") or "",
        "location": user.get("location") or "",
        "role": user.get("role") or "member",
        "created_at": user.get("created_at") or "",
    }


def to_user_search_result(user: dict[str, Any] | None) -> dict[str, Any]:
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "display_name": user["display_name"],
        "status": "active",
        "bio": user.get("bio") or "",
        "location": user.get("location") or "",
        "avatar_url": public_media_url(user.get("avatar_path")),
        "cover_url": public_media_url(user.get("cover_path")),
    }


def public_media_url(path: Any) -> str | None:
    if not path:
        return None
    return "/api/media/" + str(path).strip("/")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PASSWORD_ITERATIONS, dklen=32)
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    parts = password_hash.split("$", 3)
    if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
        return False
    try:
        iterations = int(parts[1])
        expected = bytes.fromhex(parts[3])
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), parts[2].encode("utf-8"), iterations, dklen=32)
    return hmac.compare_digest(digest, expected)


def new_session_token() -> tuple[str, str]:
    token = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii").rstrip("=")
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def normalize(value: str) -> str:
    return value.strip().lower()


def _upload_profile_image(
    request: Request,
    payload: AvatarUploadRequest,
    db: Database,
    settings: Settings,
    dirname: str,
    label: str,
    max_bytes: int,
    column: str,
) -> dict[str, Any]:
    user = require_user(request, db)
    content_type = payload.content_type.strip().lower()
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}.get(content_type)
    if not extension:
        raise HTTPException(status_code=415, detail=f"{label} must be JPG, PNG, WEBP, or GIF.")
    try:
        data = base64.b64decode(payload.data_base64, validate=True)
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"{label} data is invalid.") from error
    if not data:
        raise HTTPException(status_code=422, detail=f"{label} file is empty.")
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail=f"{label} must be {max_bytes // 1024 // 1024} MB or smaller.")
    if not _matches_image_signature(data, content_type):
        raise HTTPException(status_code=415, detail=f"{label} content is not a supported image.")
    media_dir = settings.media_root / dirname
    media_dir.mkdir(parents=True, exist_ok=True)
    target = media_dir / f"{user['id']}{extension}"
    previous = user.get(column)
    if previous:
        previous_path = settings.media_root / str(previous).strip("/")
        if previous_path != target and previous_path.exists():
            previous_path.unlink()
    target.write_bytes(data)
    stored = f"{dirname}/{target.name}"
    with db.connect() as conn:
        conn.execute(f"UPDATE users SET {column} = ?, updated_at = ? WHERE id = ?", (stored, now_iso(), user["id"]))
        updated = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
    return to_auth_user(updated)


def _matches_image_signature(data: bytes, content_type: str) -> bool:
    if content_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/gif":
        return data.startswith((b"GIF87a", b"GIF89a"))
    if content_type == "image/webp":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False
