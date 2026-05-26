from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class SignUpRequest(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=8, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=120)


class SignInRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=160)
    password: str = Field(min_length=1, max_length=128)


class AccountUpdateRequest(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    email: Optional[str] = Field(default=None, min_length=5, max_length=160)


class AvatarUploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=240)
    content_type: str = Field(min_length=1, max_length=120)
    data_base64: str = Field(min_length=1)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class AuthUser(BaseModel):
    id: str
    username: str
    email: str
    display_name: str
    avatar_url: Optional[str] = None
    role: str
    created_at: datetime


class AuthResponse(BaseModel):
    token: str
    user: AuthUser


class UserSearchResult(BaseModel):
    id: str
    username: str
    email: str
    display_name: str
    status: str
    bio: str
    avatar_url: Optional[str] = None


class AdminUser(BaseModel):
    id: str
    username: str
    email: str
    display_name: str
    avatar_url: Optional[str] = None
    role: str
    login_count: int = 0
    session_count: int = 0
    message_count: int = 0
    friend_count: int = 0
    risk_flagged: bool = False
    risk_note: Optional[str] = None
    last_login_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class AdminUserRoleUpdate(BaseModel):
    role: str = Field(min_length=1, max_length=40)


class AdminUserRiskUpdate(BaseModel):
    risk_flagged: bool
    note: Optional[str] = Field(default=None, max_length=240)


class AdminOverview(BaseModel):
    user_count: int
    admin_count: int
    active_session_count: int
    direct_message_count: int
    enabled_module_count: int
    disabled_module_count: int


class AdminAuditLog(BaseModel):
    id: int
    actor_id: str
    actor_name: str
    action: str
    target_type: str
    target_id: str
    detail: Optional[str] = None
    created_at: datetime
