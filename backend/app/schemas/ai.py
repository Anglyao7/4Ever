from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


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


class DirectAttachment(BaseModel):
    id: str
    name: str
    type: str
    size: int = Field(ge=0)
    kind: str
    data_url: Optional[str] = None


class DirectReplyReference(BaseModel):
    id: Optional[int] = None
    author_name: Optional[str] = None
    content: str = Field(min_length=1, max_length=500)
    created_at: Optional[datetime] = None
    sender_id: Optional[str] = None


class DirectMessageCreate(BaseModel):
    content: str = Field(default="", max_length=20000)
    attachments: List[DirectAttachment] = Field(default_factory=list)
    reply_to_message_id: Optional[int] = None

    @model_validator(mode="after")
    def require_content_or_attachment(self) -> "DirectMessageCreate":
        if not self.content.strip() and not self.attachments:
            raise ValueError("Message content or attachment is required.")
        return self


class DirectMessageResponse(BaseModel):
    id: int
    sender_id: str
    recipient_id: str
    content: str
    attachments: List[DirectAttachment] = Field(default_factory=list)
    reply_to_message_id: Optional[int] = None
    reply_to: Optional[DirectReplyReference] = None
    created_at: datetime


class FriendProfile(BaseModel):
    id: str
    username: str
    email: str
    display_name: str
    status: str = "active"
    bio: str = ""
    avatar_url: Optional[str] = None


class FriendRequestResponse(BaseModel):
    id: int
    requester: FriendProfile
    addressee: FriendProfile
    status: str
    created_at: datetime
    responded_at: Optional[datetime] = None


class FriendshipResponse(BaseModel):
    user: FriendProfile
    created_at: datetime


class FriendSummaryResponse(BaseModel):
    friends: List[FriendshipResponse] = Field(default_factory=list)
    incoming_requests: List[FriendRequestResponse] = Field(default_factory=list)
    outgoing_requests: List[FriendRequestResponse] = Field(default_factory=list)


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
    models: List[ProviderModel] = Field(default_factory=list)


class ProviderModelsResponse(BaseModel):
    models: List[ProviderModel]
