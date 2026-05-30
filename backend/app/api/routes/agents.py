import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.models import WorkflowAgentRunRecord
from app.db.session import get_db
from app.schemas.agents import AgentCatalog, AgentCheckpointListResponse, AgentRunCheckpointInspection, AgentRunCreate, AgentRunListResponse, AgentRunResponse, AgentRunReviewUpdate, McpToolCallRequest, McpToolCallResponse, McpToolListResponse
from app.services.agents.active_runs import register_active_run, request_active_run_cancel, unregister_active_run
from app.services.agents.catalog import configured_mcp_server_by_id, get_agent_catalog
from app.services.agents.mcp_client import call_mcp_tool, list_mcp_tools
from app.services.agents.runner import AgentRunError, execute_agent_workflow, prepare_agent_run, resume_agent_workflow
from app.services.agents.storage import cancel_agent_run, get_agent_run, inspect_agent_run_checkpoint, list_agent_checkpoint_records, list_agent_runs, running_agent_run_from_prepared, save_agent_run, save_agent_run_start, sse_event, stream_agent_run_record_events, update_agent_run_review


router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("/catalog", response_model=AgentCatalog)
async def agent_catalog(db: Session = Depends(get_db)) -> AgentCatalog:
    return get_agent_catalog(db)


@router.get("/mcp/{server_id}/tools", response_model=McpToolListResponse)
async def mcp_tools(server_id: str, db: Session = Depends(get_db)) -> McpToolListResponse:
    server = configured_mcp_server_by_id(server_id, db)
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found.")
    if not server.enabled:
        raise HTTPException(status_code=403, detail="MCP server is disabled by admin policy.")
    result = await list_mcp_tools(server)
    return McpToolListResponse(
        server_id=result.get("server_id", server.id),
        server_name=result.get("server_name", server.name),
        tool_name=result.get("tool_name", "tools/list"),
        enabled=server.enabled,
        configured=bool(result.get("configured", server.configured)),
        live_enabled=bool(result.get("live_enabled", server.live_enabled)),
        status=result.get("status", "planned"),
        tools=extract_tool_names(result, server.tool_names),
        reason=result.get("reason", ""),
        error=result.get("error", ""),
    )


@router.post("/mcp/{server_id}/tools/call", response_model=McpToolCallResponse)
async def mcp_tool_call(server_id: str, request: McpToolCallRequest, db: Session = Depends(get_db)) -> McpToolCallResponse:
    server = configured_mcp_server_by_id(server_id, db)
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found.")
    if not server.enabled:
        raise HTTPException(status_code=403, detail="MCP server is disabled by admin policy.")
    if request.tool_name not in server.tool_names:
        raise HTTPException(status_code=400, detail="Tool is not allowlisted for this MCP server.")
    result = await call_mcp_tool(server, request.tool_name, request.arguments)
    return McpToolCallResponse(
        server_id=result.get("server_id", server.id),
        server_name=result.get("server_name", server.name),
        tool_name=result.get("tool_name", request.tool_name),
        enabled=server.enabled,
        configured=bool(result.get("configured", server.configured)),
        live_enabled=bool(result.get("live_enabled", server.live_enabled)),
        status=result.get("status", "planned"),
        arguments=result.get("arguments", request.arguments),
        result=result.get("result", {}),
        reason=result.get("reason", ""),
        error=result.get("error", ""),
    )


@router.post("/runs", response_model=AgentRunResponse)
async def create_agent_run(request: AgentRunCreate, db: Session = Depends(get_db)) -> AgentRunResponse:
    try:
        execution = await execute_agent_workflow(request, db=db)
    except AgentRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return save_agent_run(db, execution.run, execution.events)


@router.post("/runs/stream")
async def stream_agent_run(request: AgentRunCreate, db: Session = Depends(get_db)) -> StreamingResponse:
    async def event_stream():
        event_queue = asyncio.Queue()
        execution_result = {}
        prepared = prepare_agent_run(request)

        def collect_event(record) -> None:
            event_queue.put_nowait((record.event, record.data))

        def persist_started_run(validated_prepared, agent, policy) -> None:
            running_run = running_agent_run_from_prepared(validated_prepared, agent, policy)
            save_agent_run_start(db, running_run)
            register_active_run(validated_prepared.run_id)

        async def execute() -> None:
            try:
                execution_result["execution"] = await execute_agent_workflow(request, collect_event, db=db, prepared=prepared, on_prepared=persist_started_run)
            except AgentRunError as exc:
                event_queue.put_nowait(("run.failed", {"status": "failed", "error": exc.detail}))
            finally:
                unregister_active_run(prepared.run_id)
                event_queue.put_nowait(None)

        task = asyncio.create_task(execute())
        while True:
            item = await event_queue.get()
            if item is None:
                break
            event, data = item
            yield sse_event(event, data)
        await task
        execution = execution_result.get("execution")
        if execution:
            save_agent_run(db, execution.run, execution.events)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/runs", response_model=AgentRunListResponse)
async def list_runs(limit: int = Query(default=30, ge=1, le=100), db: Session = Depends(get_db)) -> AgentRunListResponse:
    return AgentRunListResponse(runs=list_agent_runs(db, limit))


@router.get("/runs/{run_id}", response_model=AgentRunResponse)
async def get_run(run_id: str, db: Session = Depends(get_db)) -> AgentRunResponse:
    run = get_agent_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found.")
    return run


@router.get("/runs/{run_id}/checkpoint", response_model=AgentRunCheckpointInspection)
async def get_run_checkpoint(run_id: str, db: Session = Depends(get_db)) -> AgentRunCheckpointInspection:
    inspection = inspect_agent_run_checkpoint(db, run_id)
    if not inspection:
        raise HTTPException(status_code=404, detail="Agent run not found.")
    return inspection


@router.get("/runs/{run_id}/checkpoints", response_model=AgentCheckpointListResponse)
async def list_run_checkpoints(run_id: str, db: Session = Depends(get_db)) -> AgentCheckpointListResponse:
    if not get_agent_run(db, run_id):
        raise HTTPException(status_code=404, detail="Agent run not found.")
    return AgentCheckpointListResponse(checkpoints=list_agent_checkpoint_records(db, run_id))


@router.patch("/runs/{run_id}/review", response_model=AgentRunResponse)
async def review_run(run_id: str, request: AgentRunReviewUpdate, db: Session = Depends(get_db)) -> AgentRunResponse:
    run = get_agent_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found.")
    if run.review_status == "not_required":
        raise HTTPException(status_code=400, detail="Review is not required for this run.")
    updated = update_agent_run_review(db, run_id, request.status, request.note)
    if not updated:
        raise HTTPException(status_code=404, detail="Agent run not found.")
    return updated


@router.post("/runs/{run_id}/cancel", response_model=AgentRunResponse)
async def cancel_run(run_id: str, db: Session = Depends(get_db)) -> AgentRunResponse:
    run = get_agent_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found.")
    if run.status != "running":
        raise HTTPException(status_code=409, detail=f"Agent run is already {run.status}.")
    request_active_run_cancel(run_id)
    cancelled = cancel_agent_run(db, run_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail="Agent run not found.")
    return cancelled


@router.post("/runs/{run_id}/resume", response_model=AgentRunResponse)
async def resume_run(run_id: str, db: Session = Depends(get_db)) -> AgentRunResponse:
    run = get_agent_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found.")
    if run.status not in {"failed", "canceled"}:
        raise HTTPException(status_code=409, detail=f"Agent run is {run.status}; only failed or canceled runs can be resumed.")
    try:
        execution = await resume_agent_workflow(run, db=db)
    except AgentRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return save_agent_run(db, execution.run, execution.events)


@router.get("/runs/{run_id}/events")
async def stream_run_events(run_id: str, db: Session = Depends(get_db)) -> StreamingResponse:
    record = db.get(WorkflowAgentRunRecord, run_id)
    if not record:
        raise HTTPException(status_code=404, detail="Agent run not found.")
    return StreamingResponse(
        stream_agent_run_record_events(record),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def extract_tool_names(result: dict, fallback: list[str]) -> list[str]:
    if result.get("status") != "success":
        return fallback
    payload = result.get("result", {})
    tools = payload.get("tools") if isinstance(payload, dict) else None
    if not isinstance(tools, list):
        return fallback
    names = [tool.get("name", "") for tool in tools if isinstance(tool, dict)]
    return [name for name in names if name] or fallback
