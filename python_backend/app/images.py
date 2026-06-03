from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException
import httpx
from pydantic import BaseModel


class GenerationRequest(BaseModel):
    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    prompt: str
    size: str | None = None


def router() -> APIRouter:
    api = APIRouter(prefix="/api/images")

    @api.post("/generate")
    async def generate(payload: GenerationRequest) -> dict[str, Any]:
        provider = (payload.provider or "openai").strip().lower()
        if provider not in {"openai", "custom"}:
            raise HTTPException(status_code=501, detail=f"Image provider '{payload.provider}' is not supported yet.")
        if len(payload.prompt) > 4000:
            raise HTTPException(status_code=422, detail="Prompt must be 4000 characters or fewer.")
        api_key = (payload.api_key or "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="Image generation requires an API key.")
        base_url = (payload.base_url or "https://api.openai.com/v1").strip().rstrip("/")
        model = payload.model or "gpt-image-1"
        size = payload.size or "1024x1024"
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                response = await client.post(
                    base_url + "/images/generations",
                    headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
                    json={"model": model, "prompt": payload.prompt, "size": size},
                )
        except httpx.HTTPError as error:
            raise HTTPException(status_code=502, detail="Image provider request failed: " + str(error)) from error
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail=provider_error_detail(response.text, response.status_code))
        try:
            data = response.json()
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=502, detail="Image provider returned a non-JSON response.") from error
        images = []
        for item in data.get("data") if isinstance(data.get("data"), list) else []:
            if isinstance(item, dict):
                images.append({"url": item.get("url"), "b64_json": item.get("b64_json"), "revised_prompt": item.get("revised_prompt")})
        if not images:
            raise HTTPException(status_code=502, detail="Image provider returned no images.")
        suffix = "" if len(images) == 1 else "s"
        return {"status": "success", "message": f"Generated {len(images)} image{suffix}.", "images": images, "prompt": payload.prompt}

    return api


def provider_error_detail(text: str, status_code: int) -> str:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return text or f"Image provider returned HTTP {status_code}."
    error = payload.get("error")
    if isinstance(error, dict) and error.get("message"):
        return str(error["message"])
    for key in ("detail", "message"):
        if payload.get(key):
            return str(payload[key])
    return text or f"Image provider returned HTTP {status_code}."
