from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


class ProviderFormat(str, Enum):
    openai = "openai"
    anthropic = "anthropic"
    gemini = "gemini"


class ChatRole(str, Enum):
    system = "system"
    user = "user"
    assistant = "assistant"


class ChatMessage(BaseModel):
    role: ChatRole
    content: str = Field(min_length=1)


class ChatCompletionRequest(BaseModel):
    provider: ProviderFormat = ProviderFormat.openai
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: str = Field(min_length=1)
    messages: List[ChatMessage] = Field(min_length=1)
    system_prompt: Optional[str] = None
    temperature: Optional[float] = Field(default=0.7, ge=0, le=2)
    max_tokens: Optional[int] = Field(default=1024, ge=1, le=100000)

    @field_validator("base_url", "api_key", "system_prompt", mode="before")
    @classmethod
    def blank_to_none(cls, value: Optional[str]) -> Optional[str]:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


class ChatCompletionResponse(BaseModel):
    provider: ProviderFormat
    model: str
    content: str
    usage: Optional[Dict[str, Any]] = None
    raw: Optional[Dict[str, Any]] = None


class ProviderInfo(BaseModel):
    id: ProviderFormat
    label: str
    default_base_url: str
    default_model: str
    auth_label: str
    endpoint: str


class ProviderConnectionRequest(BaseModel):
    provider: ProviderFormat = ProviderFormat.openai
    base_url: Optional[str] = None
    api_key: Optional[str] = None

    @field_validator("base_url", "api_key", mode="before")
    @classmethod
    def blank_to_none(cls, value: Optional[str]) -> Optional[str]:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


class ProviderModel(BaseModel):
    id: str
    label: str


class ProviderConnectionResponse(BaseModel):
    ok: bool
    message: str
    model_count: int = 0


class ProviderModelsResponse(BaseModel):
    models: List[ProviderModel]
