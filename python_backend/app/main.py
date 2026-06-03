from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import admin, auth, direct_chat, images, maps, modules, providers, token_usage
from app.agents.catalog import catalog, configured_mcp_server
from app.agents.runner import (
    RUN_EVENTS,
    cancel_saved_run,
    checkpoint_from_run,
    execute_run,
    list_saved_runs,
    load_events,
    load_run,
    saved_checkpoints,
    update_review,
)
from app.config import load_settings
from app.database import Database


settings = load_settings()
database = Database(settings)
database.migrate()

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Origin", "Content-Type", "Authorization"],
)
settings.media_root.mkdir(parents=True, exist_ok=True)
app.mount("/api/media", StaticFiles(directory=settings.media_root), name="media")

app.include_router(providers.router(settings))
app.include_router(images.router())
app.include_router(maps.router(settings))
app.include_router(auth.router(database, settings))
app.include_router(direct_chat.router(database))
app.include_router(modules.router(database))
app.include_router(modules.admin_router(database))
app.include_router(admin.router(database, settings))
app.include_router(token_usage.router(database))


class ToolCallRequest(BaseModel):
    tool_name: str = Field(min_length=1, max_length=120)
    arguments: dict[str, Any] = Field(default_factory=dict)


class RunCreate(BaseModel):
    template_id: str
    agent_id: str
    mcp_server_ids: list[str] = Field(default_factory=list)
    input: dict[str, str] = Field(default_factory=dict)
    source: str = "manual"
    canvas: dict[str, Any] = Field(default_factory=dict)


class ReviewUpdate(BaseModel):
    status: str
    note: str = ""


@app.get("/")
def root() -> dict[str, str]:
    return {"name": settings.app_name, "status": "ready"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/database/health")
def database_health() -> dict[str, str]:
    try:
        database.check()
    except Exception as error:
        return {"status": "error", "detail": str(error)}
    return {"status": "ok"}


@app.get("/api/agents/catalog")
def agent_catalog() -> dict[str, Any]:
    return catalog(settings, database)


@app.get("/api/agents/mcp/{server_id}/tools")
def mcp_tools(server_id: str) -> dict[str, Any]:
    server = configured_mcp_server(server_id, settings, database)
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found.")
    if not server["enabled"]:
        raise HTTPException(status_code=403, detail="MCP server is disabled by admin policy.")
    reason = "" if server["configured"] and server["live_enabled"] else (server["required_env"] + " is not configured." if not server["configured"] else "BIGMODEL_MCP_LIVE is disabled.")
    return {
        "server_id": server["id"],
        "server_name": server["name"],
        "tool_name": "tools/list",
        "enabled": server["enabled"],
        "configured": server["configured"],
        "live_enabled": server["live_enabled"],
        "status": "planned",
        "tools": server["tool_names"],
        "reason": reason,
        "error": "",
    }


@app.post("/api/agents/mcp/{server_id}/tools/call")
def mcp_tool_call(server_id: str, payload: ToolCallRequest) -> dict[str, Any]:
    server = configured_mcp_server(server_id, settings, database)
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found.")
    if not server["enabled"]:
        raise HTTPException(status_code=403, detail="MCP server is disabled by admin policy.")
    if payload.tool_name not in server["tool_names"]:
        raise HTTPException(status_code=400, detail="Tool is not allowlisted for this MCP server.")
    reason = "" if server["configured"] and server["live_enabled"] else (server["required_env"] + " is not configured." if not server["configured"] else "BIGMODEL_MCP_LIVE is disabled.")
    return {
        "server_id": server["id"],
        "server_name": server["name"],
        "tool_name": payload.tool_name,
        "enabled": server["enabled"],
        "configured": server["configured"],
        "live_enabled": server["live_enabled"],
        "status": "planned",
        "arguments": payload.arguments,
        "result": {},
        "reason": reason,
        "error": "",
    }


@app.post("/api/agents/runs")
def create_run(payload: RunCreate) -> dict[str, Any]:
    try:
        return execute_run(payload.model_dump(), db=database, settings=settings)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/agents/runs/stream")
def stream_run(payload: RunCreate) -> StreamingResponse:
    run = create_run(payload)
    events = load_events(database, run["id"]) or RUN_EVENTS.get(run["id"], [])
    return StreamingResponse(_sse_events(events), media_type="text/event-stream")


@app.get("/api/agents/runs")
def list_runs(limit: int = 30) -> dict[str, Any]:
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 100.")
    return {"runs": list_saved_runs(database, limit)}


@app.get("/api/agents/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    run = load_run(database, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found.")
    return run


@app.get("/api/agents/runs/{run_id}/events")
def run_events(run_id: str) -> StreamingResponse:
    if not load_run(database, run_id):
        raise HTTPException(status_code=404, detail="Agent run not found.")
    return StreamingResponse(_sse_events(load_events(database, run_id)), media_type="text/event-stream")


@app.patch("/api/agents/runs/{run_id}/review")
def review_run(run_id: str, payload: ReviewUpdate) -> dict[str, Any]:
    run = get_run(run_id)
    if payload.status not in {"approved", "rejected"}:
        raise HTTPException(status_code=422, detail="status must be approved or rejected")
    if run["review_status"] == "not_required":
        raise HTTPException(status_code=400, detail="Review is not required for this run.")
    updated = update_review(database, run_id, payload.status, payload.note)
    if not updated:
        raise HTTPException(status_code=404, detail="Agent run not found.")
    return updated


@app.post("/api/agents/runs/{run_id}/cancel")
def cancel_run(run_id: str) -> dict[str, Any]:
    run = get_run(run_id)
    if run["status"] != "running":
        raise HTTPException(status_code=409, detail="Agent run is already " + run["status"] + ".")
    updated = cancel_saved_run(database, run_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Agent run not found.")
    return updated


@app.post("/api/agents/runs/{run_id}/resume")
def resume_run(run_id: str) -> dict[str, Any]:
    previous = get_run(run_id)
    if previous["status"] not in {"failed", "canceled"}:
        raise HTTPException(status_code=409, detail="Agent run is " + previous["status"] + "; only failed or canceled runs can be resumed.")
    successful = [result["graph_step"] for result in previous["node_results"] if result["status"] != "failed" and result.get("graph_step")]
    if not successful:
        raise HTTPException(status_code=409, detail="Run has no successful checkpoint to resume from.")
    payload = {
        "template_id": previous["template_id"],
        "agent_id": previous["agent_id"],
        "mcp_server_ids": previous["mcp_server_ids"],
        "input": {key: value for key, value in previous["input"].items() if key != "source"},
        "source": previous["input"].get("source", "manual"),
        "canvas": previous.get("canvas") or {},
    }
    try:
        return execute_run(payload, previous, successful[-1], db=database, settings=settings)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/api/agents/runs/{run_id}/checkpoint")
def run_checkpoint(run_id: str) -> dict[str, Any]:
    run = get_run(run_id)
    return checkpoint_from_run(run, load_events(database, run_id))


@app.get("/api/agents/runs/{run_id}/checkpoints")
def run_checkpoints(run_id: str) -> dict[str, Any]:
    get_run(run_id)
    return saved_checkpoints(database, run_id)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


def _sse_events(events: list[dict[str, Any]]):
    for event in events:
        yield "event: " + str(event.get("event", "message")) + "\n"
        yield "data: " + json.dumps(event.get("data", {}), ensure_ascii=False) + "\n\n"
