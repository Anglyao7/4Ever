import httpx

from app.core.config import get_settings
from app.schemas.ai import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ProviderConnectionRequest,
    ProviderConnectionResponse,
    ProviderModelsResponse,
)
from app.services.ai.adapters import (
    ProviderError,
    build_provider_models_request,
    build_provider_request,
    parse_provider_models_response,
    parse_provider_response,
)


async def complete_chat(request: ChatCompletionRequest) -> ChatCompletionResponse:
    provider_request = build_provider_request(request)
    settings = get_settings()

    try:
        async with httpx.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
            response = await client.post(
                provider_request.url,
                headers=provider_request.headers,
                json=provider_request.json,
            )
    except httpx.HTTPError as exc:
        raise ProviderError(f"Provider request failed: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text[:1200]
        raise ProviderError(
            f"Provider returned HTTP {response.status_code}: {detail}",
            status_code=502,
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise ProviderError("Provider returned a non-JSON response.") from exc

    return parse_provider_response(request, data)


async def fetch_provider_models(request: ProviderConnectionRequest) -> ProviderModelsResponse:
    provider_request = build_provider_models_request(request)
    settings = get_settings()

    try:
        async with httpx.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
            response = await client.get(
                provider_request.url,
                headers=provider_request.headers,
            )
    except httpx.HTTPError as exc:
        raise ProviderError(f"Provider model request failed: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text[:1200]
        raise ProviderError(
            f"Provider returned HTTP {response.status_code}: {detail}",
            status_code=502,
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise ProviderError("Provider returned a non-JSON model response.") from exc

    models = parse_provider_models_response(request.provider, data)
    return ProviderModelsResponse(models=models)


async def test_provider_connection(request: ProviderConnectionRequest) -> ProviderConnectionResponse:
    models = await fetch_provider_models(request)
    return ProviderConnectionResponse(
        ok=True,
        message="连接正常，模型列表可访问。",
        model_count=len(models.models),
    )
