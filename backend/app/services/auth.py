import hashlib
import hmac
import secrets
import uuid

from app.db.models import AuthSessionRecord, UserRecord


PASSWORD_ITERATIONS = 210_000


def normalize_username(value: str) -> str:
    return value.strip().lower()


def normalize_email(value: str) -> str:
    return value.strip().lower()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PASSWORD_ITERATIONS).hex()
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt}${digest}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations, salt, expected = password_hash.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iterations)).hex()
    return hmac.compare_digest(digest, expected)


def new_user_id() -> str:
    return uuid.uuid4().hex


def new_session(user: UserRecord) -> tuple[str, AuthSessionRecord]:
    token = secrets.token_urlsafe(32)
    return token, AuthSessionRecord(user_id=user.id, token_hash=hash_token(token))


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

