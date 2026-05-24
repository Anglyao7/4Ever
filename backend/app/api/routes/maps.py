from fastapi import APIRouter, HTTPException

from app.core.config import get_settings


router = APIRouter(prefix="/maps", tags=["maps"])
settings = get_settings()


@router.get("/tencent/config")
async def get_tencent_map_config() -> dict[str, str]:
    if not settings.tencent_map_key:
        raise HTTPException(status_code=503, detail="Tencent map key is not configured.")
    return {
        "map_key": settings.tencent_map_key,
    }
