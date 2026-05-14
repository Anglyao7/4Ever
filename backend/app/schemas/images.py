from typing import Optional

from pydantic import BaseModel, Field


class ImageGenerationRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    provider: str = "openai"
    model: str = "gpt-image-1"
    size: str = "1024x1024"
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class GeneratedImage(BaseModel):
    url: Optional[str] = None
    b64_json: Optional[str] = None
    revised_prompt: Optional[str] = None


class ImageGenerationResponse(BaseModel):
    status: str
    message: str
    images: list[GeneratedImage] = []
    prompt: Optional[str] = None
