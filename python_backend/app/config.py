from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from urllib.parse import urlparse


def _bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    base_dir: Path = Path(".")
    app_name: str = "4Ever Aggregation Platform"
    app_host: str = "127.0.0.1"
    app_port: int = 7778
    api_prefix: str = "/api"
    ai_timeout_seconds: float = 120.0
    cors_origins: tuple[str, ...] = ("http://localhost:7777", "http://127.0.0.1:7777")
    database_url: str = "sqlite:///./4ever.db"
    media_root: Path = Path("media")
    private_media_root: Path = Path("private-media")
    avatar_upload_dirname: str = "avatars"
    profile_cover_dirname: str = "profile-covers"
    chat_attachment_upload_dirname: str = "chat-attachments"
    chat_attachment_url_secret: str = ""
    chat_attachment_url_ttl_seconds: int = 600
    tencent_map_key: str = ""
    tencent_map_signature_key: str = ""
    bigmodel_mcp_live: bool = False
    mcp_timeout_seconds: float = 30.0
    mcp_result_max_chars: int = 3000
    agent_synthesis_provider: str = ""
    agent_synthesis_base_url: str = ""
    agent_synthesis_api_key: str = ""
    agent_synthesis_model: str = ""
    agent_synthesis_live: bool = False
    agent_graph_runtime: str = "langgraph"
    model_profile_encryption_key: str = ""
    allow_legacy_global_model_profiles: bool = True


def load_settings() -> Settings:
    root = Path(__file__).resolve().parents[1]
    base_dir = _detect_base_dir(root)
    _load_env_file(base_dir / ".env")
    _load_env_file(root / ".env")
    database_url = _normalize_database_url(base_dir, os.getenv("DATABASE_URL", "sqlite:///./4ever.db"))
    media_root = Path(os.getenv("MEDIA_ROOT", str(base_dir / "media"))).resolve()
    private_media_root = Path(os.getenv("PRIVATE_MEDIA_ROOT", str(base_dir / "private-media"))).resolve()
    app_host = os.getenv("APP_HOST", "127.0.0.1")
    origins = tuple(item.strip() for item in os.getenv("CORS_ORIGINS", "http://localhost:7777,http://127.0.0.1:7777").split(",") if item.strip())
    allow_legacy_global_model_profiles = _bool_env(
        "ALLOW_LEGACY_GLOBAL_MODEL_PROFILES",
        _local_legacy_global_profile_default(app_host, origins),
    )
    return Settings(
        base_dir=base_dir,
        app_name=os.getenv("APP_NAME", "4Ever Aggregation Platform"),
        app_host=app_host,
        app_port=_int_env("APP_PORT", 7778),
        ai_timeout_seconds=_float_env("AI_TIMEOUT_SECONDS", 120.0),
        cors_origins=origins or ("http://localhost:7777", "http://127.0.0.1:7777"),
        database_url=database_url,
        media_root=media_root,
        private_media_root=private_media_root,
        avatar_upload_dirname=os.getenv("AVATAR_UPLOAD_DIRNAME", "avatars"),
        profile_cover_dirname=os.getenv("PROFILE_COVER_DIRNAME", "profile-covers"),
        chat_attachment_upload_dirname=os.getenv("CHAT_ATTACHMENT_UPLOAD_DIRNAME", "chat-attachments"),
        chat_attachment_url_secret=os.getenv("CHAT_ATTACHMENT_URL_SECRET", "").strip(),
        chat_attachment_url_ttl_seconds=_int_env("CHAT_ATTACHMENT_URL_TTL_SECONDS", 600),
        tencent_map_key=os.getenv("TENCENT_MAP_KEY", ""),
        tencent_map_signature_key=os.getenv("TENCENT_MAP_SIGNATURE_KEY", ""),
        bigmodel_mcp_live=_bool_env("BIGMODEL_MCP_LIVE"),
        mcp_timeout_seconds=_float_env("MCP_TIMEOUT_SECONDS", 30.0),
        mcp_result_max_chars=_int_env("MCP_RESULT_MAX_CHARS", 3000),
        agent_synthesis_provider=os.getenv("AGENT_SYNTHESIS_PROVIDER", "").strip().lower(),
        agent_synthesis_base_url=os.getenv("AGENT_SYNTHESIS_BASE_URL", "").strip(),
        agent_synthesis_api_key=os.getenv("AGENT_SYNTHESIS_API_KEY", "").strip(),
        agent_synthesis_model=os.getenv("AGENT_SYNTHESIS_MODEL", "").strip(),
        agent_synthesis_live=_bool_env("AGENT_SYNTHESIS_LIVE"),
        agent_graph_runtime=os.getenv("AGENT_GRAPH_RUNTIME", "langgraph").strip().lower() or "langgraph",
        model_profile_encryption_key=os.getenv("MODEL_PROFILE_ENCRYPTION_KEY", "").strip(),
        allow_legacy_global_model_profiles=allow_legacy_global_model_profiles,
    )


def _local_legacy_global_profile_default(app_host: str, origins: tuple[str, ...]) -> bool:
    return _is_loopback_host(app_host) and all(_origin_is_loopback(origin) for origin in origins)


def _origin_is_loopback(origin: str) -> bool:
    try:
        parsed = urlparse(origin)
    except Exception:
        return False
    return _is_loopback_host(parsed.hostname or "")


def _is_loopback_host(host: str) -> bool:
    clean = host.strip().strip("[]").lower()
    return clean in {"localhost", "127.0.0.1", "::1"}


def _detect_base_dir(root: Path) -> Path:
    cwd = Path.cwd().resolve()
    candidates = [cwd, *cwd.parents, root, *root.parents]
    for candidate in candidates:
        if (candidate / "python_backend" / "pyproject.toml").exists() and (candidate / "frontend" / "package.json").exists():
            return candidate.resolve()
        if candidate.name == "python_backend" and (candidate / "pyproject.toml").exists():
            parent = candidate.parent
            if (parent / "frontend" / "package.json").exists():
                return parent.resolve()
        if (candidate / ".git").exists():
            return candidate.resolve()
    return root.resolve()


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or os.getenv(key) not in {None, ""}:
            continue
        os.environ[key] = value.strip().strip("\"'")


def _normalize_database_url(base_dir: Path, database_url: str) -> str:
    if database_url.startswith("sqlite:///./"):
        return "sqlite:///" + str((base_dir / database_url.removeprefix("sqlite:///./")).resolve())
    if database_url.startswith("sqlite://./"):
        return "sqlite://" + str((base_dir / database_url.removeprefix("sqlite://./")).resolve())
    return database_url
