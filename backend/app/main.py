from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import admin, auth, catalog, chat, health, images, maps, modules
from app.core.config import get_settings
from app.db.session import init_db


settings = get_settings()
settings.media_root.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(admin.router, prefix=settings.api_prefix)
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(catalog.router, prefix=settings.api_prefix)
app.include_router(chat.router, prefix=settings.api_prefix)
app.include_router(images.router, prefix=settings.api_prefix)
app.include_router(maps.router, prefix=settings.api_prefix)
app.include_router(modules.router, prefix=settings.api_prefix)
app.mount("/api/media", StaticFiles(directory=settings.media_root), name="media")


@app.on_event("startup")
async def startup_event() -> None:
    init_db()


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": settings.app_name, "status": "ready"}
