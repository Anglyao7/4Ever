import json
import sqlite3
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services.agents.langgraph_adapter import langgraph_checkpoint_path, langgraph_runtime_status
from app.db.models import WorkflowAgentCheckpointRecord, WorkflowAgentRunRecord
from app.schemas.agents import AgentCheckpointRecord, AgentCheckpointStep, AgentRunCheckpointInspection, AgentRunEventRecord, AgentRunNodeResult, AgentRunResponse
from app.services.agents.runner import checkpoint_id, last_successful_graph_step


def save_agent_run(db: Session, run: AgentRunResponse, events: Optional[list[AgentRunEventRecord]] = None) -> AgentRunResponse:
    record = db.get(WorkflowAgentRunRecord, run.id)
    if record:
        apply_run_to_record(record, run, events)
    else:
        record = WorkflowAgentRunRecord(id=run.id)
        apply_run_to_record(record, run, events)
        db.add(record)
    save_agent_checkpoints(db, run, events)
    db.commit()
    return run


def apply_run_to_record(record: WorkflowAgentRunRecord, run: AgentRunResponse, events: Optional[list[AgentRunEventRecord]] = None) -> None:
    record.thread_id = run.thread_id
    record.checkpoint_id = run.checkpoint_id
    record.template_id = run.template_id
    record.agent_id = run.agent_id
    record.agent_prompt_version = run.agent_prompt_version
    record.agent_prompt_checksum = run.agent_prompt_checksum
    record.status = run.status
    record.graph_steps_json = json.dumps(run.graph_steps, ensure_ascii=False)
    record.events_json = json.dumps([dump_model(event) for event in (events or synthesize_agent_run_events(run))], ensure_ascii=False)
    record.mcp_server_ids_json = json.dumps(run.mcp_server_ids, ensure_ascii=False)
    record.input_json = json.dumps(run.input, ensure_ascii=False)
    record.node_results_json = json.dumps([dump_model(node) for node in run.node_results], ensure_ascii=False)
    record.review_status = run.review_status
    record.review_note = run.review_note
    record.reviewed_at = parse_datetime(run.reviewed_at) if run.reviewed_at else None
    record.started_at = parse_datetime(run.started_at)
    record.ended_at = parse_datetime(run.ended_at) if run.status != "running" else None


def save_agent_run_start(db: Session, run: AgentRunResponse, events: Optional[list[AgentRunEventRecord]] = None) -> AgentRunResponse:
    return save_agent_run(db, run, events)


def running_agent_run_from_prepared(prepared, agent, policy) -> AgentRunResponse:
    return AgentRunResponse(
        id=prepared.run_id,
        thread_id=prepared.thread_id,
        checkpoint_id=f"{prepared.thread_id}:0:start",
        template_id=prepared.request.template_id,
        agent_id=prepared.request.agent_id,
        agent_prompt_version=agent.prompt_version,
        agent_prompt_checksum=agent.prompt_checksum,
        mcp_server_ids=prepared.request.mcp_server_ids,
        status="running",
        graph_steps=[],
        input={**prepared.request.input, "source": prepared.request.source},
        node_results=[],
        review_status="pending" if policy and policy.requires_review else "not_required",
        started_at=prepared.started_at,
        ended_at=prepared.started_at,
    )


def get_agent_run(db: Session, run_id: str) -> Optional[AgentRunResponse]:
    record = db.get(WorkflowAgentRunRecord, run_id)
    return run_from_record(record) if record else None


def inspect_agent_run_checkpoint(db: Session, run_id: str) -> Optional[AgentRunCheckpointInspection]:
    record = db.get(WorkflowAgentRunRecord, run_id)
    if not record:
        return None
    run = run_from_record(record)
    events = events_from_record(record)
    resume_after = last_successful_graph_step(run) if run.status in {"failed", "canceled"} else ""
    checkpoint_records = list_agent_checkpoints(db, run_id)
    langgraph = inspect_langgraph_checkpoints(run.thread_id)
    if checkpoint_records:
        steps = checkpoint_steps_from_records(checkpoint_records, resume_after, langgraph)
        completed_steps = [record.graph_step for record in checkpoint_records if record.status != "failed"]
        failed_step = next((record.graph_step for record in checkpoint_records if record.status == "failed"), "")
    else:
        completed_steps = []
        failed_step = ""
        steps = []
        for index, node in enumerate(run.node_results, start=1):
            if node.graph_step and node.status != "failed":
                completed_steps.append(node.graph_step)
            if node.status == "failed" and not failed_step:
                failed_step = node.graph_step
            steps.append(
                AgentCheckpointStep(
                    graph_step=node.graph_step,
                    node_id=node.node_id,
                    title=node.title,
                    status=node.status,
                    started_at=node.started_at,
                    ended_at=node.ended_at,
                    checkpoint_id=checkpoint_id(run.thread_id, run.graph_steps[:index]),
                    resumable=bool(resume_after and node.graph_step == resume_after),
                )
            )
    return AgentRunCheckpointInspection(
        run_id=run.id,
        thread_id=run.thread_id,
        checkpoint_id=run.checkpoint_id,
        status=run.status,
        resume_after=resume_after,
        resumable=bool(resume_after),
        graph_steps=run.graph_steps,
        completed_steps=completed_steps,
        failed_step=failed_step,
        event_count=len(events),
        last_event=events[-1].event if events else "",
        steps=steps,
        langgraph=langgraph,
    )


def inspect_langgraph_checkpoints(thread_id: str) -> dict[str, object]:
    status = langgraph_runtime_status()
    summary: dict[str, object] = {
        "runtime": status.runtime,
        "requested": status.requested,
        "available": status.available,
        "reason": status.reason,
        "thread_id": thread_id,
        "checkpoint_count": 0,
        "write_count": 0,
        "latest_checkpoint_id": "",
        "latest_parent_checkpoint_id": "",
        "latest_step": "",
        "latest_source": "",
        "node_checkpoints": {},
        "inspectable": False,
    }
    if not status.available or not thread_id:
        return summary
    path = langgraph_checkpoint_path()
    try:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        summary["reason"] = f"{status.reason}; sqlite inspection unavailable: {exc}"
        return summary
    try:
        checkpoint_count = connection.execute("SELECT COUNT(*) FROM checkpoints WHERE thread_id = ?", (thread_id,)).fetchone()[0]
        write_count = connection.execute("SELECT COUNT(*) FROM writes WHERE thread_id = ?", (thread_id,)).fetchone()[0]
        rows = connection.execute(
            "SELECT checkpoint_id, parent_checkpoint_id, metadata FROM checkpoints WHERE thread_id = ? ORDER BY checkpoint_id ASC",
            (thread_id,),
        ).fetchall()
    except sqlite3.Error as exc:
        summary["reason"] = f"{status.reason}; sqlite inspection failed: {exc}"
        return summary
    finally:
        connection.close()
    summary["inspectable"] = True
    summary["checkpoint_count"] = int(checkpoint_count or 0)
    summary["write_count"] = int(write_count or 0)
    latest = rows[-1] if rows else None
    if latest:
        metadata = safe_json_dict(bytes_to_text(latest[2]))
        summary["latest_checkpoint_id"] = latest[0] or ""
        summary["latest_parent_checkpoint_id"] = latest[1] or ""
        summary["latest_step"] = str(metadata.get("step", ""))
        summary["latest_source"] = str(metadata.get("source", ""))
    summary["node_checkpoints"] = langgraph_node_checkpoint_map(rows)
    return summary


def langgraph_node_checkpoint_map(rows) -> dict[str, dict[str, object]]:
    node_checkpoints: dict[str, dict[str, object]] = {}
    for checkpoint_id_value, parent_checkpoint_id, metadata_value in rows:
        metadata = safe_json_dict(bytes_to_text(metadata_value))
        writes = metadata.get("writes")
        if not isinstance(writes, dict):
            continue
        for node_name in writes.keys():
            if node_name == "__start__" or str(node_name).startswith("__"):
                continue
            node_checkpoints[str(node_name)] = {
                "checkpoint_id": checkpoint_id_value or "",
                "parent_checkpoint_id": parent_checkpoint_id or "",
                "step": metadata.get("step", ""),
                "source": metadata.get("source", ""),
            }
    return node_checkpoints


def save_agent_checkpoints(db: Session, run: AgentRunResponse, events: Optional[list[AgentRunEventRecord]] = None) -> None:
    event_records = events or synthesize_agent_run_events(run)
    for index, node in enumerate(run.node_results, start=1):
        if not node.graph_step:
            continue
        checkpoint = db.execute(
            select(WorkflowAgentCheckpointRecord).where(
                WorkflowAgentCheckpointRecord.run_id == run.id,
                WorkflowAgentCheckpointRecord.graph_step == node.graph_step,
            )
        ).scalar_one_or_none()
        if not checkpoint:
            checkpoint = WorkflowAgentCheckpointRecord(run_id=run.id, graph_step=node.graph_step)
            db.add(checkpoint)
        trace = run.graph_steps[:index]
        checkpoint.thread_id = run.thread_id
        checkpoint.checkpoint_id = checkpoint_id(run.thread_id, trace)
        checkpoint.node_id = node.node_id
        checkpoint.status = node.status
        checkpoint.state_json = json.dumps(
            {
                "run_id": run.id,
                "thread_id": run.thread_id,
                "template_id": run.template_id,
                "agent_id": run.agent_id,
                "trace": trace,
                "status": node.status,
                "resume_after": node.graph_step if node.status != "failed" else "",
            },
            ensure_ascii=False,
        )
        checkpoint.node_result_json = json.dumps(dump_model(node), ensure_ascii=False)
        checkpoint.events_json = json.dumps([dump_model(event) for event in events_until_step(event_records, node.graph_step)], ensure_ascii=False)


def list_agent_checkpoints(db: Session, run_id: str) -> list[WorkflowAgentCheckpointRecord]:
    statement = select(WorkflowAgentCheckpointRecord).where(WorkflowAgentCheckpointRecord.run_id == run_id).order_by(WorkflowAgentCheckpointRecord.id.asc())
    return list(db.scalars(statement).all())


def list_agent_checkpoint_records(db: Session, run_id: str) -> list[AgentCheckpointRecord]:
    return [checkpoint_record_response(record) for record in list_agent_checkpoints(db, run_id)]


def checkpoint_record_response(record: WorkflowAgentCheckpointRecord) -> AgentCheckpointRecord:
    return AgentCheckpointRecord(
        id=record.id,
        run_id=record.run_id,
        thread_id=record.thread_id,
        checkpoint_id=record.checkpoint_id,
        graph_step=record.graph_step,
        node_id=record.node_id,
        status=record.status,
        state=safe_json_dict(record.state_json),
        event_count=len(safe_json_list(record.events_json)),
        created_at=record.created_at.isoformat(),
    )


def checkpoint_steps_from_records(records: list[WorkflowAgentCheckpointRecord], resume_after: str, langgraph: Optional[dict[str, object]] = None) -> list[AgentCheckpointStep]:
    langgraph_nodes = (langgraph or {}).get("node_checkpoints", {})
    steps = []
    for record in records:
        node = safe_json_dict(record.node_result_json)
        langgraph_node = langgraph_nodes.get(record.graph_step, {}) if isinstance(langgraph_nodes, dict) else {}
        checkpoint_value = langgraph_node.get("checkpoint_id", record.checkpoint_id) if isinstance(langgraph_node, dict) else record.checkpoint_id
        steps.append(
            AgentCheckpointStep(
                graph_step=record.graph_step,
                node_id=record.node_id,
                title=str(node.get("title") or record.graph_step),
                status=record.status,
                started_at=str(node.get("started_at") or ""),
                ended_at=str(node.get("ended_at") or ""),
                checkpoint_id=str(checkpoint_value or record.checkpoint_id),
                resumable=bool(resume_after and record.graph_step == resume_after),
            )
        )
    return steps


def events_until_step(events: list[AgentRunEventRecord], graph_step: str) -> list[AgentRunEventRecord]:
    selected = []
    for event in events:
        selected.append(event)
        if event.event == "node.finished" and event.data.get("graph_step") == graph_step:
            break
    return selected


def list_agent_runs(db: Session, limit: int = 30) -> list[AgentRunResponse]:
    statement = select(WorkflowAgentRunRecord).order_by(WorkflowAgentRunRecord.started_at.desc()).limit(limit)
    return [run_from_record(record) for record in db.scalars(statement).all()]


def update_agent_run_review(db: Session, run_id: str, status: str, note: str = "") -> Optional[AgentRunResponse]:
    record = db.get(WorkflowAgentRunRecord, run_id)
    if not record:
        return None
    record.review_status = status
    record.review_note = note
    record.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return run_from_record(record)


def cancel_agent_run(db: Session, run_id: str, reason: str = "cancelled by user") -> Optional[AgentRunResponse]:
    record = db.get(WorkflowAgentRunRecord, run_id)
    if not record:
        return None
    record.status = "canceled"
    record.ended_at = datetime.now(timezone.utc)
    events = events_from_record(record) or synthesize_agent_run_events(run_from_record(record))
    events.append(
        AgentRunEventRecord(
            event="run.cancelled",
            data={
                "run_id": record.id,
                "status": "canceled",
                "reason": reason,
                "ended_at": record.ended_at.isoformat(),
            },
        )
    )
    record.events_json = json.dumps([dump_model(event) for event in events], ensure_ascii=False)
    db.commit()
    db.refresh(record)
    return run_from_record(record)


def stream_agent_run_events(run: AgentRunResponse, events: Optional[list[AgentRunEventRecord]] = None):
    for event in events or synthesize_agent_run_events(run):
        yield sse_event(event.event, event.data)


def stream_agent_run_record_events(record: WorkflowAgentRunRecord):
    run = run_from_record(record)
    events = events_from_record(record)
    yield from stream_agent_run_events(run, events if events else None)


def run_from_record(record: WorkflowAgentRunRecord) -> AgentRunResponse:
    return AgentRunResponse(
        id=record.id,
        thread_id=getattr(record, "thread_id", "") or "",
        checkpoint_id=getattr(record, "checkpoint_id", "") or "",
        template_id=record.template_id,
        agent_id=record.agent_id,
        agent_prompt_version=getattr(record, "agent_prompt_version", "") or "",
        agent_prompt_checksum=getattr(record, "agent_prompt_checksum", "") or "",
        mcp_server_ids=json.loads(record.mcp_server_ids_json),
        status=record.status,
        graph_steps=safe_json_list(getattr(record, "graph_steps_json", "[]") or "[]"),
        input=json.loads(record.input_json),
        node_results=[
            AgentRunNodeResult(**node)
            for node in json.loads(record.node_results_json)
        ],
        review_status=getattr(record, "review_status", "not_required") or "not_required",
        review_note=getattr(record, "review_note", "") or "",
        reviewed_at=record.reviewed_at.isoformat() if getattr(record, "reviewed_at", None) else "",
        started_at=record.started_at.isoformat(),
        ended_at=record.ended_at.isoformat() if record.ended_at else record.started_at.isoformat(),
    )


def events_from_record(record: WorkflowAgentRunRecord) -> list[AgentRunEventRecord]:
    events = safe_json_list(getattr(record, "events_json", "[]") or "[]")
    return [AgentRunEventRecord(**event) for event in events if isinstance(event, dict) and event.get("event")]


def synthesize_agent_run_events(run: AgentRunResponse) -> list[AgentRunEventRecord]:
    events = [
        AgentRunEventRecord(
            event="run.started",
            data={
                "run_id": run.id,
                "template_id": run.template_id,
                "agent_id": run.agent_id,
                "status": "running",
                "started_at": run.started_at,
            },
        )
    ]
    events.extend(
        AgentRunEventRecord(
            event="node.finished",
            data={
                "run_id": run.id,
                "node_id": node.node_id,
                "graph_step": node.graph_step,
                "type": node.type,
                "title": node.title,
                "status": node.status,
                "output": node.output,
                "started_at": node.started_at,
                "ended_at": node.ended_at,
            },
        )
        for node in run.node_results
    )
    events.append(
        AgentRunEventRecord(
            event="run.finished",
            data={
                "run_id": run.id,
                "status": run.status,
                "ended_at": run.ended_at,
            },
        )
    )
    return events


def parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def dump_model(model) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def safe_json_list(value: str) -> list[str]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def safe_json_dict(value: str) -> dict:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def bytes_to_text(value) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value or "")


def sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
