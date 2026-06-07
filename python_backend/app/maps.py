from __future__ import annotations

import hashlib
import json
from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException
import httpx

from app.config import Settings


TENCENT_SUGGESTION_URL = "https://apis.map.qq.com/ws/place/v1/suggestion"


def router(settings: Settings) -> APIRouter:
    api = APIRouter(prefix="/api/maps")

    @api.get("/tencent/config")
    def tencent_config() -> dict[str, str]:
        if not settings.tencent_map_key:
            raise HTTPException(status_code=503, detail="Tencent map key is not configured.")
        return {"map_key": settings.tencent_map_key}

    @api.get("/tencent/city-search")
    async def city_search(q: str | None = None) -> dict[str, Any]:
        if q is None:
            raise HTTPException(status_code=422, detail="q is required.")
        if len(q) > 80:
            raise HTTPException(status_code=422, detail="q must be 80 characters or fewer.")
        if not settings.tencent_map_key:
            raise HTTPException(status_code=503, detail="Tencent map key is not configured.")
        keyword = q.strip()
        if not keyword:
            return {"results": []}
        params = {
            "keyword": keyword,
            "key": settings.tencent_map_key,
            "region": "中国",
            "region_fix": "0",
            "policy": "1",
            "page_size": "10",
        }
        if settings.tencent_map_signature_key:
            params["sig"] = tencent_signature(params, settings.tencent_map_signature_key)
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get(TENCENT_SUGGESTION_URL + "?" + urlencode(params))
        except httpx.HTTPError as error:
            raise HTTPException(status_code=502, detail="Tencent city search failed.") from error
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="Tencent city search failed.")
        try:
            payload = response.json()
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=502, detail="Tencent city search failed.") from error
        if str(payload.get("status")) not in {"0", "0.0"} and payload.get("status") != 0:
            raise HTTPException(status_code=502, detail=str(payload.get("message") or "Tencent city search failed."))
        return {"results": parse_city_results(payload)}

    return api


def tencent_signature(params: dict[str, str], key: str) -> str:
    parts = "&".join(f"{name}={params[name]}" for name in sorted(params))
    return hashlib.md5(("/ws/place/v1/suggestion?" + parts + key).encode("utf-8")).hexdigest()


def parse_city_results(payload: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in payload.get("data") if isinstance(payload.get("data"), list) else []:
        if not isinstance(item, dict):
            continue
        location = item.get("location") if isinstance(item.get("location"), dict) else {}
        lat = location.get("lat")
        lon = location.get("lng")
        title = str(item.get("title") or "").strip()
        if not title or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            continue
        region_parts: list[str] = []
        used: set[str] = set()
        for key in ("province", "city", "district"):
            value = str(item.get(key) or "").strip()
            if value and value not in used:
                region_parts.append(value)
                used.add(value)
        region = " · ".join(region_parts) or str(item.get("address") or "").strip() or "中国"
        city_id = f"tencent:{title}:{float(lat):.6f}:{float(lon):.6f}"
        if city_id in seen:
            continue
        seen.add(city_id)
        results.append({"id": city_id, "name": title, "region": region, "lat": float(lat), "lon": float(lon)})
    return results
