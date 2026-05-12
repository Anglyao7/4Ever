from fastapi import APIRouter

from app.db.session import check_database


router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/api/database/health")
async def database_health() -> dict[str, str]:
    try:
        check_database()
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}
    return {"status": "ok"}
