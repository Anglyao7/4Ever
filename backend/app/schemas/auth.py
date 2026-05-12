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


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class AuthUser(BaseModel):
    id: str
    username: str
    email: str
    display_name: str
    role: str
    created_at: datetime


class AuthResponse(BaseModel):
    token: str
    user: AuthUser
