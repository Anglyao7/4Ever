from __future__ import annotations

from hashlib import md5
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.core.config import get_settings


router = APIRouter(prefix="/maps", tags=["maps"])
settings = get_settings()

TENCENT_PLACE_SUGGESTION_URL = "https://apis.map.qq.com/ws/place/v1/suggestion"


@router.get("/tencent/config")
async def get_tencent_map_config() -> dict[str, str]:
    if not settings.tencent_map_key:
        raise HTTPException(status_code=503, detail="Tencent map key is not configured.")
    return {
        "map_key": settings.tencent_map_key,
    }


@router.get("/tencent/city-search")
async def search_tencent_cities(q: str = Query(..., min_length=1, max_length=80)) -> dict[str, list[dict[str, Any]]]:
    if not settings.tencent_map_key:
        raise HTTPException(status_code=503, detail="Tencent map key is not configured.")

    keyword = q.strip()
    if not keyword:
        return {"results": []}

    params = {
        "keyword": keyword,
        "key": settings.tencent_map_key,
        "region": "中国",
        "region_fix": 0,
        "policy": 1,
        "page_size": 10,
    }
    if settings.tencent_map_signature_key:
        signature_query = "&".join(f"{key}={value}" for key, value in sorted(params.items()))
        params["sig"] = md5(
            f"/ws/place/v1/suggestion?{signature_query}{settings.tencent_map_signature_key}".encode("utf-8"),
        ).hexdigest()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(TENCENT_PLACE_SUGGESTION_URL, params=params)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Tencent city search failed.") from exc

    payload = response.json()
    if payload.get("status") != 0:
        raise HTTPException(status_code=502, detail=payload.get("message") or "Tencent city search failed.")

    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in payload.get("data", []):
        location = item.get("location") or {}
        lat = location.get("lat")
        lng = location.get("lng")
        title = str(item.get("title") or "").strip()
        if not title or not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        address_parts = [
            str(item.get("province") or "").strip(),
            str(item.get("city") or "").strip(),
            str(item.get("district") or "").strip(),
        ]
        region = " · ".join(part for index, part in enumerate(address_parts) if part and part not in address_parts[:index])
        result_id = f"tencent:{title}:{lat:.6f}:{lng:.6f}"
        if result_id in seen:
            continue
        seen.add(result_id)
        results.append({
            "id": result_id,
            "name": title,
            "region": region or str(item.get("address") or "").strip() or "中国",
            "lat": float(lat),
            "lon": float(lng),
        })

    return {"results": results}
