from functools import lru_cache
from os import environ, getenv
from pathlib import Path


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in environ:
            continue
        value = value.strip().strip('"').strip("'")
        environ[key] = value


load_env_file(Path(__file__).resolve().parents[2] / ".env")


class Settings:
    base_dir = Path(__file__).resolve().parents[2]
    app_name = "4Ever Aggregation Platform"
    app_host = getenv("APP_HOST", "127.0.0.1")
    app_port = int(getenv("APP_PORT", "7778"))
    api_prefix = "/api"
    ai_timeout_seconds = float(getenv("AI_TIMEOUT_SECONDS", "120"))
    mcp_timeout_seconds = float(getenv("MCP_TIMEOUT_SECONDS", "30"))
    mcp_result_max_chars = int(getenv("MCP_RESULT_MAX_CHARS", "3000"))
    bigmodel_mcp_live = getenv("BIGMODEL_MCP_LIVE", "").strip().lower() in {"1", "true", "yes", "on"}
    agent_synthesis_provider = getenv("AGENT_SYNTHESIS_PROVIDER", "").strip().lower()
    agent_synthesis_base_url = getenv("AGENT_SYNTHESIS_BASE_URL", "").strip()
    agent_synthesis_api_key = getenv("AGENT_SYNTHESIS_API_KEY", "").strip()
    agent_synthesis_model = getenv("AGENT_SYNTHESIS_MODEL", "").strip()
    agent_synthesis_live = getenv("AGENT_SYNTHESIS_LIVE", "").strip().lower() in {"1", "true", "yes", "on"}
    agent_graph_runtime = getenv("AGENT_GRAPH_RUNTIME", "auto").strip().lower()
    agent_langgraph_checkpoint_path = getenv("AGENT_LANGGRAPH_CHECKPOINT_PATH", "").strip()
    database_url = getenv("DATABASE_URL", "sqlite:///./4ever.db")
    media_root = Path(getenv("MEDIA_ROOT", str(base_dir / "media"))).resolve()
    avatar_upload_dirname = getenv("AVATAR_UPLOAD_DIRNAME", "avatars")
    tencent_map_key = getenv("TENCENT_MAP_KEY", "")
    tencent_map_signature_key = getenv("TENCENT_MAP_SIGNATURE_KEY", "")

    @property
    def cors_origins(self) -> list[str]:
        raw = getenv(
            "CORS_ORIGINS",
            "http://localhost:7777,http://127.0.0.1:7777",
        )
        return [origin.strip() for origin in raw.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
