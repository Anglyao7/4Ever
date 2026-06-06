from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import Settings


SECRET_PREFIX = "fernet:v1:"


def encrypt_secret(settings: Settings, value: str | None) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    return SECRET_PREFIX + _fernet(settings).encrypt(text.encode("utf-8")).decode("ascii")


def decrypt_secret(settings: Settings, value: str | None) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    token = text.removeprefix(SECRET_PREFIX)
    try:
        return _fernet(settings).decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError):
        return ""


def _fernet(settings: Settings) -> Fernet:
    material = settings.model_profile_encryption_key or f"local-dev:{settings.database_url}:{settings.app_name}"
    key = base64.urlsafe_b64encode(hashlib.sha256(material.encode("utf-8")).digest())
    return Fernet(key)
