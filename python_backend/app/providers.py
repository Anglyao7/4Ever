from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import httpx
from pydantic import BaseModel

from app.config import Settings


PROVIDERS = [
    {"id": "openai", "label": "OpenAI Compatible", "default_base_url": "https://api.openai.com/v1", "default_model": "gpt-4.1-mini", "auth_label": "Authorization: Bearer", "endpoint": "POST /chat/completions"},
    {"id": "anthropic", "label": "Anthropic Messages", "default_base_url": "https://api.anthropic.com/v1", "default_model": "claude-sonnet-4-20250514", "auth_label": "x-api-key", "endpoint": "POST /messages"},
    {"id": "gemini", "label": "Gemini GenerateContent", "default_base_url": "https://generativelanguage.googleapis.com/v1beta", "default_model": "gemini-2.5-flash", "auth_label": "x-goog-api-key", "endpoint": "POST /models/{model}:generateContent"},
]


class ProviderConnectionRequest(BaseModel):
    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None


class ChatCompletionRequest(ProviderConnectionRequest):
    model: str
    messages: list[dict[str, Any]]
    system_prompt: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None


def router(settings: Settings) -> APIRouter:
    api = APIRouter()

    @api.get("/api/catalog/providers")
    def providers() -> list[dict[str, str]]:
        return PROVIDERS

    @api.post("/api/catalog/provider/test")
    async def test_provider(payload: ProviderConnectionRequest) -> dict[str, Any]:
        models = await fetch_models(settings, payload)
        return {"ok": True, "message": "连接正常，模型列表可访问。", "model_count": len(models), "models": models}

    @api.post("/api/catalog/provider/models")
    async def provider_models(payload: ProviderConnectionRequest) -> dict[str, Any]:
        return {"models": await fetch_models(settings, payload)}

    @api.post("/api/chat")
    async def chat(payload: ChatCompletionRequest) -> dict[str, Any]:
        return await complete_chat(settings, payload)

    @api.post("/api/chat/stream")
    async def chat_stream(payload: ChatCompletionRequest) -> StreamingResponse:
        provider = validate_chat_request(payload)
        if provider != "openai":
            response = await complete_chat(settings, payload)
            return StreamingResponse(iter([response["content"]]), media_type="text/plain; charset=utf-8")
        return StreamingResponse(_stream_openai(settings, payload), media_type="text/plain; charset=utf-8")

    return api


async def fetch_models(settings: Settings, payload: ProviderConnectionRequest) -> list[dict[str, str]]:
    provider = normalize_provider(payload.provider)
    if provider not in {"openai", "anthropic", "gemini"}:
        raise HTTPException(status_code=422, detail="Unsupported provider format: " + provider)
    url = append_provider_path(provider_base_url(provider, payload.base_url), "models")
    try:
        async with httpx.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
            response = await client.get(url, headers=provider_headers(provider, payload.api_key))
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="Provider model request failed: " + str(error)) from error
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Provider returned HTTP {response.status_code} {response.reason_phrase}: {response.text}")
    try:
        data = response.json()
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=502, detail="Provider returned a non-JSON model response.") from error
    return parse_models(provider, data)


async def complete_chat(settings: Settings, payload: ChatCompletionRequest) -> dict[str, Any]:
    provider = validate_chat_request(payload)
    url, body, headers = build_chat_provider_request(provider, payload)
    try:
        async with httpx.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
            response = await client.post(url, headers=headers, json=body)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="Provider request failed: " + str(error)) from error
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Provider returned HTTP {response.status_code} {response.reason_phrase}: {response.text}")
    try:
        data = response.json()
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=502, detail="Provider returned a non-JSON response.") from error
    content, detail = parse_chat_content(provider, data)
    if detail:
        raise HTTPException(status_code=502, detail=detail)
    if not content:
        raise HTTPException(status_code=502, detail="Provider returned an empty response.")
    usage = data.get("usageMetadata") if provider == "gemini" else data.get("usage")
    return {"provider": provider, "model": payload.model, "content": content, "usage": usage, "raw": data}


async def _stream_openai(settings: Settings, payload: ChatCompletionRequest):
    provider = validate_chat_request(payload)
    url, body, headers = build_chat_provider_request(provider, payload)
    body["stream"] = True
    try:
        async with httpx.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
            async with client.stream("POST", url, headers=headers, json=body) as response:
                if response.status_code >= 400:
                    text = await response.aread()
                    raise HTTPException(status_code=502, detail=f"Provider returned HTTP {response.status_code} {response.reason_phrase}: {text.decode('utf-8', 'replace')}")
                async for line in response.aiter_lines():
                    chunk = parse_openai_stream_line(line)
                    if chunk:
                        yield chunk
    except HTTPException:
        raise
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="Provider stream request failed: " + str(error)) from error


def normalize_provider(provider: str | None) -> str:
    return (provider or "openai").strip().lower()


def validate_chat_request(payload: ChatCompletionRequest) -> str:
    provider = normalize_provider(payload.provider)
    if provider not in {"openai", "anthropic", "gemini"}:
        raise HTTPException(status_code=422, detail="Unsupported provider format: " + provider)
    if not payload.model.strip():
        raise HTTPException(status_code=422, detail="Model is required.")
    if not payload.messages:
        raise HTTPException(status_code=422, detail="At least one message is required.")
    for message in payload.messages:
        role = str(message.get("role") or "").strip()
        if role not in {"system", "user", "assistant"}:
            raise HTTPException(status_code=422, detail="Message role must be system, user, or assistant.")
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise HTTPException(status_code=422, detail="Message content is required.")
    if payload.temperature is not None and not 0 <= payload.temperature <= 2:
        raise HTTPException(status_code=422, detail="Temperature must be between 0 and 2.")
    if payload.max_tokens is not None and not 1 <= payload.max_tokens <= 100000:
        raise HTTPException(status_code=422, detail="Max tokens must be between 1 and 100000.")
    return provider


def provider_base_url(provider: str, value: str | None) -> str:
    if value and value.strip():
        return normalize_provider_base_url(provider, value.strip().rstrip("/"))
    default = next((item["default_base_url"] for item in PROVIDERS if item["id"] == provider), PROVIDERS[0]["default_base_url"])
    return normalize_provider_base_url(provider, default)


def normalize_provider_base_url(provider: str, base_url: str) -> str:
    base = base_url.strip().rstrip("/")
    if provider != "openai" or not base:
        return base
    lower = base.lower()
    if "/v1" in lower or "/api/v1" in lower:
        return base
    return base + "/v1"


def provider_headers(provider: str, api_key: str | None) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    key = (api_key or "").strip()
    if provider == "openai" and key:
        headers["Authorization"] = "Bearer " + key
    elif provider == "anthropic":
        headers["anthropic-version"] = "2023-06-01"
        if key:
            headers["x-api-key"] = key
    elif provider == "gemini" and key:
        headers["x-goog-api-key"] = key
    return headers


def append_provider_path(base_url: str, suffix: str) -> str:
    base = base_url.rstrip("/")
    suffix = suffix.strip("/")
    if base.endswith("/" + suffix):
        return base
    return base + "/" + suffix


def parse_models(provider: str, payload: dict[str, Any]) -> list[dict[str, str]]:
    raw = payload.get("models") if provider == "gemini" else payload.get("data")
    models: list[dict[str, str]] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id") or "")
        label = model_id
        if provider == "anthropic":
            label = str(item.get("display_name") or model_id)
        if provider == "gemini":
            model_id = str(item.get("name") or "").removeprefix("models/")
            label = str(item.get("displayName") or model_id)
        if model_id:
            models.append({"id": model_id, "label": label})
    return models


def build_chat_provider_request(provider: str, payload: ChatCompletionRequest) -> tuple[str, dict[str, Any], dict[str, str]]:
    base_url = provider_base_url(provider, payload.base_url)
    headers = provider_headers(provider, payload.api_key)
    clean_messages = [{"role": str(item["role"]).strip(), "content": item["content"]} for item in payload.messages]
    system_prompt = (payload.system_prompt or "").strip()
    if provider == "anthropic":
        messages: list[dict[str, str]] = []
        for message in clean_messages:
            if message["role"] == "system":
                system_prompt = (system_prompt + "\n\n" + message["content"]).strip()
                continue
            messages.append({"role": "assistant" if message["role"] == "assistant" else "user", "content": message["content"]})
        body: dict[str, Any] = {"model": payload.model, "max_tokens": chat_max_tokens(payload), "messages": messages, "temperature": chat_temperature(payload)}
        if system_prompt:
            body["system"] = system_prompt
        return base_url.rstrip("/") + "/messages", body, headers
    if provider == "gemini":
        contents: list[dict[str, Any]] = []
        for message in clean_messages:
            if message["role"] == "system":
                system_prompt = (system_prompt + "\n\n" + message["content"]).strip()
                continue
            contents.append({"role": "model" if message["role"] == "assistant" else "user", "parts": [{"text": message["content"]}]})
        body = {"contents": contents, "generationConfig": {"temperature": chat_temperature(payload), "maxOutputTokens": chat_max_tokens(payload)}}
        if system_prompt:
            body["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        return gemini_endpoint(base_url, payload.model), body, headers
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.extend(clean_messages)
    return base_url.rstrip("/") + "/chat/completions", {"model": payload.model, "messages": messages, "stream": False, "temperature": chat_temperature(payload), "max_tokens": chat_max_tokens(payload)}, headers


def chat_temperature(payload: ChatCompletionRequest) -> float:
    return 0.7 if payload.temperature is None else payload.temperature


def chat_max_tokens(payload: ChatCompletionRequest) -> int:
    return 1024 if payload.max_tokens is None else payload.max_tokens


def parse_chat_content(provider: str, data: dict[str, Any]) -> tuple[str, str]:
    if provider == "anthropic":
        raw = data.get("content")
        if isinstance(raw, str):
            return raw, ""
        if not isinstance(raw, list):
            return "", "Anthropic response did not include a valid content list."
        return "\n".join(str(item.get("text") or "") for item in raw if isinstance(item, dict) and item.get("type") == "text").strip(), ""
    if provider == "gemini":
        try:
            parts = data["candidates"][0]["content"]["parts"]
        except (KeyError, IndexError, TypeError):
            return "", "Gemini response did not include candidates[0].content.parts."
        if not isinstance(parts, list):
            return "", "Gemini response did not include candidates[0].content.parts."
        return "\n".join(str(item.get("text") or "") for item in parts if isinstance(item, dict)).strip(), ""
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return "", "OpenAI-compatible response did not include choices[0].message.content."
    return content_to_text(content), ""


def gemini_endpoint(base_url: str, model: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith(":generateContent"):
        return base
    clean_model = model.removeprefix("models/")
    if base.endswith("/models"):
        return base + "/" + clean_model + ":generateContent"
    return base + "/models/" + clean_model + ":generateContent"


def content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(item.get("text") or "") for item in content if isinstance(item, dict))
    return str(content or "")


def parse_openai_stream_line(line: str) -> str:
    if not line.startswith("data:"):
        return ""
    raw = line.removeprefix("data:").strip()
    if not raw or raw == "[DONE]":
        return ""
    try:
        payload = json.loads(raw)
        return str(payload.get("choices", [{}])[0].get("delta", {}).get("content") or "")
    except (json.JSONDecodeError, IndexError, AttributeError):
        return ""
