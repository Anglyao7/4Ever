from functools import lru_cache
from os import getenv


class Settings:
    app_name = "4Ever Aggregation Platform"
    api_prefix = "/api"
    ai_timeout_seconds = float(getenv("AI_TIMEOUT_SECONDS", "120"))
    database_url = getenv("DATABASE_URL", "sqlite:///./4ever.db")

    @property
    def cors_origins(self) -> list[str]:
        raw = getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        )
        return [origin.strip() for origin in raw.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
