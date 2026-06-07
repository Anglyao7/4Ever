from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
import httpx

from app.config import Settings
from app.database import Database
from app.providers import ProviderConnectionRequest, provider_request_error_detail, resolve_provider_connection, truncate_chat_event_text


class GenerationRequest(ProviderConnectionRequest):
    model: str | None = None
    prompt: str
    size: str | None = None


def router(settings: Settings | None = None, database: Database | None = None) -> APIRouter:
    api = APIRouter(prefix="/api/images")

    @api.post("/generate")
    async def generate(request: Request, payload: GenerationRequest) -> dict[str, Any]:
        connection = resolve_image_provider(settings, database, request, payload)
        provider = (connection.provider or "openai").strip().lower()
        if provider not in {"openai", "custom"}:
            raise HTTPException(status_code=501, detail=f"Image provider '{connection.provider}' is not supported yet.")
        if len(payload.prompt) > 4000:
            raise HTTPException(status_code=422, detail="Prompt must be 4000 characters or fewer.")
        api_key = (connection.api_key or "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="Image generation requires an API key.")
        base_url = (connection.base_url or "https://api.openai.com/v1").strip().rstrip("/")
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
            raise HTTPException(status_code=502, detail=provider_request_error_detail("Image provider request failed", error)) from error
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


def resolve_image_provider(settings: Settings | None, database: Database | None, request: Request, payload: GenerationRequest) -> ProviderConnectionRequest:
    if not (payload.profile_id or "").strip():
        return payload
    runtime_settings = settings or (database.settings if database is not None else Settings())
    return resolve_provider_connection(runtime_settings, database, request, payload)


def provider_error_detail(text: str, status_code: int) -> str:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return truncate_chat_event_text(text or f"Image provider returned HTTP {status_code}.", 800)
    error = payload.get("error")
    if isinstance(error, dict) and error.get("message"):
        return truncate_chat_event_text(str(error["message"]), 800)
    for key in ("detail", "message"):
        if payload.get(key):
            return truncate_chat_event_text(str(payload[key]), 800)
    return truncate_chat_event_text(text or f"Image provider returned HTTP {status_code}.", 800)
