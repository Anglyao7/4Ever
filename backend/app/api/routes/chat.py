from fastapi import APIRouter, HTTPException

from app.schemas.ai import ChatCompletionRequest, ChatCompletionResponse
from app.services.ai.client import complete_chat
from app.services.ai.adapters import ProviderError


router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatCompletionResponse)
async def chat(request: ChatCompletionRequest) -> ChatCompletionResponse:
    try:
        return await complete_chat(request)
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

