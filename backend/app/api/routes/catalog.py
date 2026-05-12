from fastapi import APIRouter
from fastapi import HTTPException

from app.schemas.ai import (
    ProviderConnectionRequest,
    ProviderConnectionResponse,
    ProviderInfo,
    ProviderModelsResponse,
)
from app.services.ai.client import fetch_provider_models, test_provider_connection
from app.services.ai.adapters import ProviderError
from app.services.ai.adapters import get_provider_catalog


router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/providers", response_model=list[ProviderInfo])
async def providers() -> list[ProviderInfo]:
    return get_provider_catalog()


@router.post("/provider/test", response_model=ProviderConnectionResponse)
async def test_provider(request: ProviderConnectionRequest) -> ProviderConnectionResponse:
    try:
        return await test_provider_connection(request)
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/provider/models", response_model=ProviderModelsResponse)
async def provider_models(request: ProviderConnectionRequest) -> ProviderModelsResponse:
    try:
        return await fetch_provider_models(request)
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
