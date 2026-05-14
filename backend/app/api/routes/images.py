import httpx
from fastapi import APIRouter, HTTPException

from app.schemas.images import GeneratedImage, ImageGenerationRequest, ImageGenerationResponse


router = APIRouter(prefix="/images", tags=["images"])


@router.post("/generate", response_model=ImageGenerationResponse)
async def generate_image(request: ImageGenerationRequest) -> ImageGenerationResponse:
    provider = request.provider.strip().lower()
    if provider not in {"openai", "custom"}:
        raise HTTPException(status_code=501, detail=f"Image provider '{request.provider}' is not supported yet.")

    api_key = (request.api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="Image generation requires an API key.")

    base_url = (request.base_url or "https://api.openai.com/v1").strip().rstrip("/")
    endpoint = f"{base_url}/images/generations"
    payload = {
        "model": request.model,
        "prompt": request.prompt,
        "size": request.size,
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                endpoint,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Image provider request failed: {exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=provider_error_detail(response))

    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Image provider returned a non-JSON response.") from exc

    images = [parse_generated_image(item) for item in data.get("data", []) if isinstance(item, dict)]
    if not images:
        raise HTTPException(status_code=502, detail="Image provider returned no images.")

    return ImageGenerationResponse(
        status="success",
        message=f"Generated {len(images)} image{'s' if len(images) != 1 else ''}.",
        images=images,
        prompt=request.prompt,
    )


def parse_generated_image(item: dict) -> GeneratedImage:
    return GeneratedImage(
        url=item.get("url"),
        b64_json=item.get("b64_json"),
        revised_prompt=item.get("revised_prompt"),
    )


def provider_error_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return response.text or f"Image provider returned HTTP {response.status_code}."

    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if message:
                return str(message)
        detail = data.get("detail") or data.get("message")
        if detail:
            return str(detail)
    return f"Image provider returned HTTP {response.status_code}."
