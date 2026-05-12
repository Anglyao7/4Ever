from fastapi import APIRouter, HTTPException

from app.schemas.images import ImageGenerationRequest, ImageGenerationResponse


router = APIRouter(prefix="/images", tags=["images"])


@router.post("/generate", response_model=ImageGenerationResponse)
async def generate_image(request: ImageGenerationRequest) -> ImageGenerationResponse:
    raise HTTPException(
        status_code=501,
        detail=(
            "Image generation module is scaffolded but no image provider is configured yet. "
            f"Requested provider={request.provider}, model={request.model}."
        ),
    )

