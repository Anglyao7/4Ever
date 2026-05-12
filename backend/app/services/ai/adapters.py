from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from app.schemas.ai import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatMessage,
    ChatRole,
    ProviderConnectionRequest,
    ProviderFormat,
    ProviderInfo,
    ProviderModel,
)


DEFAULTS: Dict[ProviderFormat, ProviderInfo] = {
    ProviderFormat.openai: ProviderInfo(
        id=ProviderFormat.openai,
        label="OpenAI Compatible",
        default_base_url="https://api.openai.com/v1",
        default_model="gpt-4.1-mini",
        auth_label="Authorization: Bearer",
        endpoint="POST /chat/completions",
    ),
    ProviderFormat.anthropic: ProviderInfo(
        id=ProviderFormat.anthropic,
        label="Anthropic Messages",
        default_base_url="https://api.anthropic.com/v1",
        default_model="claude-sonnet-4-20250514",
        auth_label="x-api-key",
        endpoint="POST /messages",
    ),
    ProviderFormat.gemini: ProviderInfo(
        id=ProviderFormat.gemini,
        label="Gemini GenerateContent",
        default_base_url="https://generativelanguage.googleapis.com/v1beta",
        default_model="gemini-2.5-flash",
        auth_label="x-goog-api-key",
        endpoint="POST /models/{model}:generateContent",
    ),
}


class ProviderError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class ProviderHttpRequest:
    url: str
    headers: Dict[str, str]
    json: Dict[str, Any]


@dataclass(frozen=True)
class ProviderHttpGetRequest:
    url: str
    headers: Dict[str, str]


def get_provider_catalog() -> List[ProviderInfo]:
    return list(DEFAULTS.values())


def build_provider_request(request: ChatCompletionRequest) -> ProviderHttpRequest:
    if request.provider == ProviderFormat.openai:
        return _build_openai_request(request)
    if request.provider == ProviderFormat.anthropic:
        return _build_anthropic_request(request)
    if request.provider == ProviderFormat.gemini:
        return _build_gemini_request(request)
    raise ProviderError(f"Unsupported provider format: {request.provider}", 400)


def parse_provider_response(request: ChatCompletionRequest, data: Dict[str, Any]) -> ChatCompletionResponse:
    if request.provider == ProviderFormat.openai:
        content = _parse_openai_content(data)
        usage = data.get("usage")
    elif request.provider == ProviderFormat.anthropic:
        content = _parse_anthropic_content(data)
        usage = data.get("usage")
    elif request.provider == ProviderFormat.gemini:
        content = _parse_gemini_content(data)
        usage = data.get("usageMetadata")
    else:
        raise ProviderError(f"Unsupported provider format: {request.provider}", 400)

    if not content:
        raise ProviderError("Provider returned an empty response.")

    return ChatCompletionResponse(
        provider=request.provider,
        model=request.model,
        content=content,
        usage=usage,
        raw=data,
    )


def build_provider_models_request(request: ProviderConnectionRequest) -> ProviderHttpGetRequest:
    base_url = _provider_base_url(request.provider, request.base_url)
    headers = _provider_auth_headers(request.provider, request.api_key)
    return ProviderHttpGetRequest(
        url=_append_path(base_url, "models"),
        headers=headers,
    )


def parse_provider_models_response(
    provider: ProviderFormat,
    data: Dict[str, Any],
) -> List[ProviderModel]:
    if provider == ProviderFormat.openai:
        raw_models = data.get("data", [])
        return _parse_model_items(raw_models, id_key="id", label_key="id")
    if provider == ProviderFormat.anthropic:
        raw_models = data.get("data", [])
        return _parse_model_items(raw_models, id_key="id", label_key="display_name")
    if provider == ProviderFormat.gemini:
        raw_models = data.get("models", [])
        models: List[ProviderModel] = []
        for item in raw_models:
            if not isinstance(item, dict):
                continue
            raw_id = str(item.get("name", "")).strip()
            if not raw_id:
                continue
            model_id = raw_id.removeprefix("models/")
            label = str(item.get("displayName") or model_id)
            models.append(ProviderModel(id=model_id, label=label))
        return models
    raise ProviderError(f"Unsupported provider format: {provider}", 400)


def _build_openai_request(request: ChatCompletionRequest) -> ProviderHttpRequest:
    messages = _with_system_messages(request)
    payload: Dict[str, Any] = {
        "model": request.model,
        "messages": [{"role": message.role.value, "content": message.content} for message in messages],
        "stream": False,
    }
    _add_optional_generation_config(payload, request)

    headers = {"Content-Type": "application/json"}
    if request.api_key:
        headers["Authorization"] = f"Bearer {request.api_key}"

    return ProviderHttpRequest(
        url=_append_path(_base_url(request), "chat/completions"),
        headers=headers,
        json=payload,
    )


def _build_anthropic_request(request: ChatCompletionRequest) -> ProviderHttpRequest:
    system_prompt, messages = _split_system_messages(request)
    payload: Dict[str, Any] = {
        "model": request.model,
        "max_tokens": request.max_tokens or 1024,
        "messages": [
            {"role": _anthropic_role(message.role), "content": message.content}
            for message in messages
        ],
    }
    if system_prompt:
        payload["system"] = system_prompt
    if request.temperature is not None:
        payload["temperature"] = request.temperature

    headers = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
    }
    if request.api_key:
        headers["x-api-key"] = request.api_key

    return ProviderHttpRequest(
        url=_append_path(_base_url(request), "messages"),
        headers=headers,
        json=payload,
    )


def _build_gemini_request(request: ChatCompletionRequest) -> ProviderHttpRequest:
    system_prompt, messages = _split_system_messages(request)
    payload: Dict[str, Any] = {
        "contents": [
            {
                "role": "model" if message.role == ChatRole.assistant else "user",
                "parts": [{"text": message.content}],
            }
            for message in messages
        ],
        "generationConfig": {},
    }
    if system_prompt:
        payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
    if request.temperature is not None:
        payload["generationConfig"]["temperature"] = request.temperature
    if request.max_tokens:
        payload["generationConfig"]["maxOutputTokens"] = request.max_tokens
    if not payload["generationConfig"]:
        payload.pop("generationConfig")

    headers = {"Content-Type": "application/json"}
    if request.api_key:
        headers["x-goog-api-key"] = request.api_key

    return ProviderHttpRequest(
        url=_gemini_endpoint(_base_url(request), request.model),
        headers=headers,
        json=payload,
    )


def _base_url(request: ChatCompletionRequest) -> str:
    return _provider_base_url(request.provider, request.base_url)


def _provider_base_url(provider: ProviderFormat, base_url: Optional[str]) -> str:
    return (base_url or DEFAULTS[provider].default_base_url).rstrip("/")


def _provider_auth_headers(provider: ProviderFormat, api_key: Optional[str]) -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if provider == ProviderFormat.openai and api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    elif provider == ProviderFormat.anthropic:
        headers["anthropic-version"] = "2023-06-01"
        if api_key:
            headers["x-api-key"] = api_key
    elif provider == ProviderFormat.gemini and api_key:
        headers["x-goog-api-key"] = api_key
    return headers


def _append_path(base_url: str, suffix: str) -> str:
    suffix = suffix.strip("/")
    if base_url.endswith(f"/{suffix}"):
        return base_url
    return f"{base_url}/{suffix}"


def _gemini_endpoint(base_url: str, model: str) -> str:
    if base_url.endswith(":generateContent"):
        return base_url

    clean_model = model.removeprefix("models/")
    if base_url.endswith("/models"):
        return f"{base_url}/{clean_model}:generateContent"
    return f"{base_url}/models/{clean_model}:generateContent"


def _with_system_messages(request: ChatCompletionRequest) -> List[ChatMessage]:
    if not request.system_prompt:
        return request.messages
    return [ChatMessage(role=ChatRole.system, content=request.system_prompt), *request.messages]


def _split_system_messages(request: ChatCompletionRequest) -> Tuple[Optional[str], List[ChatMessage]]:
    system_parts: List[str] = []
    if request.system_prompt:
        system_parts.append(request.system_prompt)

    messages: List[ChatMessage] = []
    for message in request.messages:
        if message.role == ChatRole.system:
            system_parts.append(message.content)
        else:
            messages.append(message)

    return "\n\n".join(system_parts) or None, messages


def _anthropic_role(role: ChatRole) -> str:
    return "assistant" if role == ChatRole.assistant else "user"


def _add_optional_generation_config(payload: Dict[str, Any], request: ChatCompletionRequest) -> None:
    if request.temperature is not None:
        payload["temperature"] = request.temperature
    if request.max_tokens:
        payload["max_tokens"] = request.max_tokens


def _parse_openai_content(data: Dict[str, Any]) -> str:
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ProviderError("OpenAI-compatible response did not include choices[0].message.content.") from exc
    return _content_to_text(content)


def _parse_anthropic_content(data: Dict[str, Any]) -> str:
    blocks = data.get("content", [])
    if isinstance(blocks, str):
        return blocks
    if not isinstance(blocks, list):
        raise ProviderError("Anthropic response did not include a valid content list.")
    return "\n".join(
        block.get("text", "")
        for block in blocks
        if isinstance(block, dict) and block.get("type") == "text"
    ).strip()


def _parse_gemini_content(data: Dict[str, Any]) -> str:
    try:
        parts = data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ProviderError("Gemini response did not include candidates[0].content.parts.") from exc
    return "\n".join(
        part.get("text", "")
        for part in parts
        if isinstance(part, dict) and part.get("text")
    ).strip()


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and part.get("text")
        ).strip()
    return str(content)


def _parse_model_items(raw_models: Any, id_key: str, label_key: str) -> List[ProviderModel]:
    if not isinstance(raw_models, list):
        raise ProviderError("Provider model list response did not include a valid model array.")

    models: List[ProviderModel] = []
    for item in raw_models:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get(id_key, "")).strip()
        if not model_id:
            continue
        label = str(item.get(label_key) or model_id)
        models.append(ProviderModel(id=model_id, label=label))
    return models
