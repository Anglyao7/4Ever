from __future__ import annotations

from datetime import datetime, timezone
import re
import uuid
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from app.agents.catalog import WORKFLOW_TEMPLATES, configured_agent, configured_mcp_server, workflow_policy
from app.agents.mcp import arguments_for_tool, call_mcp_tool, render_mcp_output, select_mcp_server_for_node, tool_for_node
from app.config import Settings
from app.database import Database, json_dumps, json_loads, now_iso, row_to_dict


class GraphNode(TypedDict):
    node_id: str
    type: str
    title: str
    graph_step: str


class AgentRunState(TypedDict, total=False):
    run_id: str
    source: str
    agent: dict[str, Any]
    mcp_servers: list[dict[str, Any]]
    settings: Settings
    graph_nodes: list[GraphNode]
    graph_plan: list[str]
    canvas: dict[str, Any]
    graph_steps: list[str]
    node_results: list[dict[str, Any]]
    events: list[dict[str, Any]]


RUNS: dict[str, dict[str, Any]] = {}
RUN_EVENTS: dict[str, list[dict[str, Any]]] = {}
AGENT_VALUE_MAX_CHARS = 3000
DATA_URL_PATTERN = re.compile(r"data:[A-Za-z0-9.+/-]+(?:;[A-Za-z0-9_.=+/-]+)*;base64,[A-Za-z0-9+/=_-]+", re.IGNORECASE)
TEXT_SECRET_QUOTED_PATTERN = re.compile(r"([\"']?\b(?:authorization|api[_-]?key|token|secret|password)\b[\"']?\s*[:=]\s*[\"'])(?:Bearer\s+)?[^\"']+([\"'])", re.IGNORECASE)
TEXT_SECRET_BARE_PATTERN = re.compile(r"(\b(?:authorization|api[_-]?key|token|secret|password)\b\s*[:=]\s*)(?:Bearer\s+)?[^\s,;}]+", re.IGNORECASE)


def execute_run(
    payload: dict[str, Any],
    resume_from: dict[str, Any] | None = None,
    resume_after: str = "",
    db: Database | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    template_id = str(payload.get("template_id") or "")
    agent_id = str(payload.get("agent_id") or "")
    agent = configured_agent(agent_id, db)
    if not agent:
        raise ValueError("Agent not found.")
    if template_id not in agent["workflow_template_ids"]:
        raise ValueError("Template is not allowed for this agent.")
    policy = workflow_policy(template_id)
    if not policy:
        raise ValueError("Workflow template not found.")
    if settings:
        for server_id in payload.get("mcp_server_ids") or []:
            server = configured_mcp_server(str(server_id), settings, db)
            if not server:
                raise ValueError("Unknown MCP server: " + str(server_id))
            if server_id not in agent["mcp_server_ids"]:
                raise ValueError("MCP server is not allowed for this agent: " + str(server_id))
            if not server["enabled"]:
                raise PermissionError("MCP server is disabled by admin policy: " + str(server_id))
    selected_mcp_servers = _selected_mcp_servers(payload.get("mcp_server_ids") or [], settings, db)

    run_id = "run-" + uuid.uuid4().hex[:12]
    thread_id = resume_from.get("thread_id") if resume_from else ""
    if not thread_id:
        thread_id = "thread-" + uuid.uuid4().hex[:12]
    now = _now()
    graph_nodes = build_graph_nodes(template_id, payload.get("canvas") or {})
    graph_steps = _resumed_graph_steps(resume_from, resume_after)
    node_results = _resumed_node_results(resume_from, resume_after)
    start_index = _resume_start_index(graph_nodes, resume_after)
    events: list[dict[str, Any]] = [{"event": "run.started", "data": {"run_id": run_id, "template_id": template_id, "agent_id": agent_id, "status": "running", "started_at": now}}]
    if resume_after:
        events.append({"event": "run.resumed", "data": {"run_id": run_id, "template_id": template_id, "agent_id": agent_id, "resume_after": resume_after, "start_index": str(start_index)}})

    state: AgentRunState = {
        "run_id": run_id,
        "source": _first_input_value(payload.get("input") or {}),
        "agent": agent,
        "mcp_servers": selected_mcp_servers,
        "settings": settings,
        "graph_nodes": graph_nodes[start_index:],
        "graph_plan": [node["graph_step"] for node in graph_nodes] + (["persist"] if graph_nodes else []),
        "canvas": payload.get("canvas") or {},
        "graph_steps": graph_steps,
        "node_results": node_results,
        "events": events,
    }
    graph = _compile_graph(state["graph_nodes"])
    final_state = graph.invoke(state) if state["graph_nodes"] else state

    if graph_nodes and (not final_state["graph_steps"] or final_state["graph_steps"][-1] != "persist"):
        final_state["graph_steps"].append("persist")
    status = "failed" if any(result["status"] == "failed" for result in final_state["node_results"]) else "success"
    ended = _now()
    review_status = resume_from.get("review_status", "pending" if policy.requires_review else "not_required") if resume_from else ("pending" if policy.requires_review else "not_required")
    run = {
        "id": run_id,
        "thread_id": thread_id,
        "checkpoint_id": checkpoint_id(thread_id, final_state["graph_steps"]),
        "template_id": template_id,
        "agent_id": agent_id,
        "agent_prompt_version": agent["prompt_version"],
        "agent_prompt_checksum": agent["prompt_checksum"],
        "mcp_server_ids": list(payload.get("mcp_server_ids") or []),
        "status": status,
        "graph_steps": final_state["graph_steps"],
        "input": {**(payload.get("input") or {}), "source": payload.get("source") or "manual"},
        "canvas": payload.get("canvas") or {},
        "node_results": final_state["node_results"],
        "review_status": review_status,
        "review_note": resume_from.get("review_note", "") if resume_from else "",
        "reviewed_at": resume_from.get("reviewed_at", "") if resume_from else "",
        "started_at": now,
        "ended_at": ended,
    }
    final_event = "run.failed" if status == "failed" else "run.finished"
    final_state["events"].append({"event": final_event, "data": {"run_id": run_id, "status": status, "ended_at": ended}})
    run = sanitize_agent_run(run)
    events = sanitize_agent_events(final_state["events"])
    RUNS[run_id] = run
    RUN_EVENTS[run_id] = events
    if db:
        save_run(db, run, events)
    return run


def build_graph_nodes(template_id: str, canvas: dict[str, Any]) -> list[GraphNode]:
    if canvas.get("nodes"):
        return _build_canvas_nodes(canvas)
    return [
        {"node_id": _node_id_for_step(step, node_type), "type": node_type, "title": title, "graph_step": step}
        for step, node_type, title in WORKFLOW_TEMPLATES.get(template_id, [])
    ]


def checkpoint(run_id: str) -> dict[str, Any]:
    run = RUNS[run_id]
    completed_steps = [result["graph_step"] for result in run["node_results"] if result["status"] != "failed" and result.get("graph_step")]
    failed_step = next((result["graph_step"] for result in run["node_results"] if result["status"] == "failed"), "")
    resume_after = completed_steps[-1] if run["status"] in {"failed", "canceled"} and completed_steps else ""
    steps = [
        {
            "graph_step": result["graph_step"],
            "node_id": result["node_id"],
            "title": result["title"],
            "status": result["status"],
            "started_at": result["started_at"],
            "ended_at": result["ended_at"],
            "checkpoint_id": checkpoint_id(run["thread_id"], run["graph_steps"][: index + 1]),
            "resumable": bool(resume_after and result["graph_step"] == resume_after),
        }
        for index, result in enumerate(run["node_results"])
    ]
    events = RUN_EVENTS.get(run_id, [])
    return {
        "run_id": run_id,
        "thread_id": run["thread_id"],
        "checkpoint_id": run["checkpoint_id"],
        "status": run["status"],
        "resume_after": resume_after,
        "resumable": bool(resume_after),
        "graph_steps": run["graph_steps"],
        "completed_steps": completed_steps,
        "failed_step": failed_step,
        "event_count": len(events),
        "last_event": events[-1]["event"] if events else "",
        "steps": steps,
        "graph_runtime": {"runtime": "langgraph", "available": True, "reason": "Python backend LangGraph StateGraph runtime", "thread_id": run["thread_id"]},
    }


def checkpoints(run_id: str) -> dict[str, Any]:
    run = RUNS[run_id]
    return {
        "checkpoints": [
            {
                "id": index + 1,
                "run_id": run_id,
                "thread_id": run["thread_id"],
                "checkpoint_id": checkpoint_id(run["thread_id"], run["graph_steps"][: index + 1]),
                "graph_step": result["graph_step"],
                "node_id": result["node_id"],
                "status": result["status"],
                "state": {"run_id": run_id, "thread_id": run["thread_id"], "trace": run["graph_steps"][: index + 1], "status": result["status"]},
                "event_count": index + 2,
                "created_at": result["ended_at"],
            }
            for index, result in enumerate(run["node_results"])
        ]
    }


def save_run(db: Database, run: dict[str, Any], events: list[dict[str, Any]]) -> None:
    run = sanitize_agent_run(run)
    events = sanitize_agent_events(events)
    ended_at = run.get("ended_at") or None
    with db.connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO workflow_agent_runs (
              id, thread_id, checkpoint_id, template_id, agent_id, agent_prompt_version, agent_prompt_checksum,
              status, graph_steps_json, events_json, mcp_server_ids_json, input_json, canvas_json, node_results_json,
              review_status, review_note, reviewed_at, started_at, ended_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run["id"],
                run["thread_id"],
                run["checkpoint_id"],
                run["template_id"],
                run["agent_id"],
                run["agent_prompt_version"],
                run["agent_prompt_checksum"],
                run["status"],
                json_dumps(run["graph_steps"]),
                json_dumps(events),
                json_dumps(run["mcp_server_ids"]),
                json_dumps(run["input"]),
                json_dumps(run.get("canvas") or {}),
                json_dumps(run["node_results"]),
                run["review_status"],
                run.get("review_note", ""),
                run.get("reviewed_at") or None,
                run["started_at"],
                ended_at,
                now_iso(),
            ),
        )
        conn.execute("DELETE FROM workflow_agent_checkpoints WHERE run_id = ?", (run["id"],))
        for index, result in enumerate(run["node_results"]):
            graph_step = result.get("graph_step") or ""
            if not graph_step:
                continue
            trace = run["graph_steps"][: index + 1]
            checkpoint = checkpoint_id(run["thread_id"], trace)
            state = {
                "run_id": run["id"],
                "thread_id": run["thread_id"],
                "template_id": run["template_id"],
                "agent_id": run["agent_id"],
                "trace": trace,
                "status": result["status"],
                "resume_after": graph_step if result["status"] != "failed" else "",
            }
            conn.execute(
                """
                INSERT INTO workflow_agent_checkpoints (
                  run_id, thread_id, checkpoint_id, graph_step, node_id, status, state_json, node_result_json, events_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run["id"],
                    run["thread_id"],
                    checkpoint,
                    graph_step,
                    result.get("node_id", ""),
                    result["status"],
                    json_dumps(state),
                    json_dumps(result),
                    json_dumps(_events_until_step(events, graph_step)),
                    result.get("ended_at") or now_iso(),
                ),
            )


def run_from_record(record: dict[str, Any]) -> dict[str, Any]:
    return sanitize_agent_run({
        "id": record["id"],
        "thread_id": record.get("thread_id") or "",
        "checkpoint_id": record.get("checkpoint_id") or "",
        "template_id": record["template_id"],
        "agent_id": record["agent_id"],
        "agent_prompt_version": record.get("agent_prompt_version") or "",
        "agent_prompt_checksum": record.get("agent_prompt_checksum") or "",
        "mcp_server_ids": json_loads(record.get("mcp_server_ids_json"), []),
        "status": record.get("status") or "success",
        "graph_steps": json_loads(record.get("graph_steps_json"), []),
        "input": json_loads(record.get("input_json"), {}),
        "canvas": json_loads(record.get("canvas_json"), {}),
        "node_results": json_loads(record.get("node_results_json"), []),
        "review_status": record.get("review_status") or "not_required",
        "review_note": record.get("review_note") or "",
        "reviewed_at": record.get("reviewed_at") or "",
        "started_at": record.get("started_at") or "",
        "ended_at": record.get("ended_at") or "",
    })


def load_run(db: Database, run_id: str) -> dict[str, Any] | None:
    with db.connect() as conn:
        record = row_to_dict(conn.execute("SELECT * FROM workflow_agent_runs WHERE id = ?", (run_id,)).fetchone())
    return run_from_record(record) if record else None


def list_saved_runs(db: Database, limit: int) -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM workflow_agent_runs ORDER BY started_at DESC LIMIT ?", (limit,)).fetchall()
    return [run_from_record(row_to_dict(row) or {}) for row in rows]


def load_events(db: Database, run_id: str) -> list[dict[str, Any]]:
    with db.connect() as conn:
        record = row_to_dict(conn.execute("SELECT events_json FROM workflow_agent_runs WHERE id = ?", (run_id,)).fetchone())
    return sanitize_agent_events(json_loads(record.get("events_json") if record else None, []))


def update_review(db: Database, run_id: str, status: str, note: str) -> dict[str, Any] | None:
    reviewed_at = now_iso()
    with db.connect() as conn:
        conn.execute(
            "UPDATE workflow_agent_runs SET review_status = ?, review_note = ?, reviewed_at = ? WHERE id = ?",
            (status, note, reviewed_at, run_id),
        )
        record = row_to_dict(conn.execute("SELECT * FROM workflow_agent_runs WHERE id = ?", (run_id,)).fetchone())
    return run_from_record(record) if record else None


def cancel_saved_run(db: Database, run_id: str) -> dict[str, Any] | None:
    run = load_run(db, run_id)
    if not run:
        return None
    ended_at = now_iso()
    run["status"] = "canceled"
    run["ended_at"] = ended_at
    events = load_events(db, run_id)
    events.append({"event": "run.cancelled", "data": {"run_id": run_id, "status": "canceled", "reason": "cancelled by user", "ended_at": ended_at}})
    events = sanitize_agent_events(events)
    with db.connect() as conn:
        conn.execute("UPDATE workflow_agent_runs SET status = ?, ended_at = ?, events_json = ? WHERE id = ?", ("canceled", ended_at, json_dumps(events), run_id))
    RUNS[run_id] = run
    RUN_EVENTS[run_id] = events
    return run


def checkpoint_from_run(run: dict[str, Any], events: list[dict[str, Any]]) -> dict[str, Any]:
    completed_steps = [result["graph_step"] for result in run["node_results"] if result["status"] != "failed" and result.get("graph_step")]
    failed_step = next((result["graph_step"] for result in run["node_results"] if result["status"] == "failed"), "")
    resume_after = completed_steps[-1] if run["status"] in {"failed", "canceled"} and completed_steps else ""
    steps = [
        {
            "graph_step": result["graph_step"],
            "node_id": result["node_id"],
            "title": result["title"],
            "status": result["status"],
            "started_at": result["started_at"],
            "ended_at": result["ended_at"],
            "checkpoint_id": checkpoint_id(run["thread_id"], run["graph_steps"][: index + 1]),
            "resumable": bool(resume_after and result["graph_step"] == resume_after),
        }
        for index, result in enumerate(run["node_results"])
    ]
    return {
        "run_id": run["id"],
        "thread_id": run["thread_id"],
        "checkpoint_id": run["checkpoint_id"],
        "status": run["status"],
        "resume_after": resume_after,
        "resumable": bool(resume_after),
        "graph_steps": run["graph_steps"],
        "completed_steps": completed_steps,
        "failed_step": failed_step,
        "event_count": len(events),
        "last_event": events[-1]["event"] if events else "",
        "steps": steps,
        "graph_runtime": {"runtime": "langgraph", "available": True, "reason": "Python backend LangGraph StateGraph runtime", "thread_id": run["thread_id"]},
    }


def saved_checkpoints(db: Database, run_id: str) -> dict[str, Any]:
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM workflow_agent_checkpoints WHERE run_id = ? ORDER BY id ASC", (run_id,)).fetchall()
    return {
        "checkpoints": [
            {
                "id": row["id"],
                "run_id": row["run_id"],
                "thread_id": row["thread_id"],
                "checkpoint_id": row["checkpoint_id"],
                "graph_step": row["graph_step"],
                "node_id": row["node_id"],
                "status": row["status"],
                "state": json_loads(row["state_json"], {}),
                "event_count": len(json_loads(row["events_json"], [])),
                "created_at": row["created_at"],
            }
            for row in rows
        ]
    }


def _compile_graph(nodes: list[GraphNode]):
    graph = StateGraph(AgentRunState)
    if not nodes:
        graph.add_node("noop", lambda state: state)
        graph.set_entry_point("noop")
        graph.add_edge("noop", END)
        return graph.compile()
    for node in nodes:
        graph.add_node(node["graph_step"], _node_callable(node))
    graph.set_entry_point(nodes[0]["graph_step"])
    for current, nxt in zip(nodes, nodes[1:]):
        graph.add_edge(current["graph_step"], nxt["graph_step"])
    graph.add_edge(nodes[-1]["graph_step"], END)
    return graph.compile()


def _events_until_step(events: list[dict[str, Any]], graph_step: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for event in events:
        out.append(event)
        data = event.get("data")
        if isinstance(data, dict) and data.get("graph_step") == graph_step:
            break
    return out


def sanitize_agent_run(run: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in run.items():
        if key == "node_results" and isinstance(value, list):
            out[key] = [sanitize_agent_node_result(item) for item in value if isinstance(item, dict)]
        else:
            out[str(key)] = sanitize_agent_value(value)
    return out


def sanitize_agent_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sanitized = []
    for event in events:
        if not isinstance(event, dict):
            continue
        sanitized.append({str(key): sanitize_agent_value(value) for key, value in event.items()})
    return sanitized


def sanitize_agent_node_result(result: dict[str, Any]) -> dict[str, Any]:
    out = {str(key): sanitize_agent_value(value) for key, value in result.items() if key != "output"}
    if "output" in result:
        output, truncated = sanitize_agent_text(str(result.get("output") or ""), AGENT_VALUE_MAX_CHARS)
        out["output"] = output
        if truncated:
            out["output_truncated"] = True
    return out


def sanitize_agent_value(value: Any) -> Any:
    if isinstance(value, str):
        return sanitize_agent_text(value, AGENT_VALUE_MAX_CHARS)[0]
    if isinstance(value, list):
        return [sanitize_agent_value(item) for item in value]
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            if _agent_secret_key(key_text):
                out[key_text] = "[redacted]"
            elif key_text in {"data_url", "dataUrl"}:
                out[key_text] = "[redacted data URL]"
            elif key_text == "output" and isinstance(item, str):
                out[key_text], truncated = sanitize_agent_text(item, AGENT_VALUE_MAX_CHARS)
                if truncated:
                    out["output_truncated"] = True
            else:
                out[key_text] = sanitize_agent_value(item)
        return out
    return value


def sanitize_agent_text(value: str, limit: int) -> tuple[str, bool]:
    text = DATA_URL_PATTERN.sub("[redacted data URL]", str(value or ""))
    text = TEXT_SECRET_QUOTED_PATTERN.sub(r"\1[redacted]\2", text)
    text = TEXT_SECRET_BARE_PATTERN.sub(r"\1[redacted]", text)
    if len(text) <= limit:
        return text, False
    return text[:limit].rstrip() + "... [trimmed]", True


def _agent_secret_key(key: str) -> bool:
    return bool(re.search(r"(authorization|api[_-]?key|token|secret|password)", key, re.IGNORECASE))


def _node_callable(node: GraphNode):
    def run_node(state: AgentRunState) -> AgentRunState:
        output, status = _render_node(node, state)
        now = _now()
        result = {
            "node_id": node["node_id"],
            "type": node["type"],
            "title": node["title"],
            "graph_step": node["graph_step"],
            "status": status,
            "output": output,
            "started_at": now,
            "ended_at": now,
        }
        state["graph_steps"] = [*state.get("graph_steps", []), node["graph_step"]]
        state["node_results"] = [*state.get("node_results", []), result]
        state["events"] = [*state.get("events", []), {"event": "node.finished", "data": {**result, "run_id": state["run_id"]}}]
        return state

    return run_node


def _render_node(node: GraphNode, state: AgentRunState) -> tuple[str, str]:
    canvas_note = _canvas_node_note(node["node_id"], state.get("canvas") or {})
    source = state.get("source") or ""
    if not source.strip() and node["type"] != "agent":
        return "\n".join(part for part in [canvas_note, "等待输入内容。"] if part).strip(), "success"
    if node["type"] == "agent":
        agent = state["agent"]
        return "\n".join(part for part in [
            f"{agent['name']} 已加载。模型建议：{agent['model_hint']}。",
            "Graph runtime: LangGraph StateGraph",
            "Graph plan: " + " -> ".join(state.get("graph_plan", [])),
            "Graph trace: " + " -> ".join(state.get("graph_steps", [])),
            canvas_note,
            "密钥由后端环境变量托管。",
        ] if part), "success"
    if node["type"] == "mcp":
        server = select_mcp_server_for_node(node, state.get("mcp_servers") or [])
        settings = state.get("settings")
        if not server:
            return "\n".join(part for part in [canvas_note, "没有绑定 MCP Server。"] if part).strip(), "success"
        if not settings:
            return "\n".join(part for part in [canvas_note, "计划模式：MCP 工具调用由 Python 后端托管；缺少运行配置。"] if part), "success"
        tool = tool_for_node(node, server)
        result = call_mcp_tool(server, tool, arguments_for_tool(tool, source), settings)
        status = "failed" if result.get("status") == "failed" else "success"
        return "\n".join(part for part in [canvas_note, render_mcp_output(server, tool, result)] if part).strip(), status
    if node["type"] == "notes":
        return "\n".join(part for part in [canvas_note, _truncate(source, 120)] if part), "success"
    if node["type"] == "transform":
        return "\n".join(part for part in [canvas_note, f"标题：{_truncate(source, 18)}...\n要点：{_truncate(source, 180)}"] if part), "success"
    if node["type"] == "chat":
        return "\n".join(part for part in [canvas_note, "我整理了一段内容，想同步给你：" + _truncate(source, 160)] if part), "success"
    if node["type"] == "ai":
        return "\n".join(part for part in [canvas_note, "模型生成摘要\n" + _truncate(source, 600)] if part), "success"
    return "\n".join(part for part in [canvas_note, f"{node['title']} 已处理：{_truncate(source, 180)}"] if part), "success"


def _build_canvas_nodes(canvas: dict[str, Any]) -> list[GraphNode]:
    nodes = _ordered_canvas_nodes(list(canvas.get("nodes") or []), list(canvas.get("connections") or []))
    out: list[GraphNode] = []
    for index, node in enumerate(nodes):
        node_type = str(node.get("type") or "transform")
        out.append({
            "node_id": "canvas-" + str(node.get("id")),
            "type": _workflow_type_for_canvas_node(node_type),
            "title": str(node.get("label") or node_type),
            "graph_step": f"canvas_{index + 1}_{_slug(node_type)}",
        })
    return out


def _ordered_canvas_nodes(nodes: list[dict[str, Any]], connections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    valid = [node for node in nodes if node.get("id")]
    if not valid or not connections:
        return valid
    by_id = {str(node["id"]): node for node in valid}
    targets = {str(connection.get("targetNodeId")) for connection in connections if connection.get("targetNodeId")}
    starts = [node_id for node_id in by_id if node_id not in targets] or [str(valid[0]["id"])]
    ordered: list[dict[str, Any]] = []
    visited: set[str] = set()

    def walk(node_id: str) -> None:
        if node_id in visited or node_id not in by_id:
            return
        visited.add(node_id)
        ordered.append(by_id[node_id])
        for connection in connections:
            if str(connection.get("sourceNodeId")) == node_id:
                walk(str(connection.get("targetNodeId")))

    for start in starts:
        walk(start)
    for node_id in by_id:
        walk(node_id)
    return ordered


def _canvas_node_note(node_id: str, canvas: dict[str, Any]) -> str:
    canvas_node_id = node_id.removeprefix("canvas-")
    nodes = list(canvas.get("nodes") or [])
    connections = list(canvas.get("connections") or [])
    for node in nodes:
        if str(node.get("id")) != canvas_node_id:
            continue
        incoming = sum(1 for connection in connections if str(connection.get("targetNodeId")) == canvas_node_id)
        outgoing = sum(1 for connection in connections if str(connection.get("sourceNodeId")) == canvas_node_id)
        config = node.get("config") or {}
        config_keys = [key for key, value in config.items() if str(value).strip()]
        runtime = node.get("runtime") or {}
        runtime_note = ""
        if runtime.get("label"):
            runtime_note = f" · 内部动作：{runtime['label']}"
            if runtime.get("method") and runtime.get("path"):
                runtime_note += f" ({runtime['method']} {runtime['path']})"
        note = f"Canvas node: {node.get('label') or node_id} ({node.get('type') or 'node'}) · {incoming} 入 / {outgoing} 出{runtime_note}"
        if config_keys:
            note += " · 配置：" + "、".join(config_keys)
        return note
    return ""


def _workflow_type_for_canvas_node(node_type: str) -> str:
    if node_type == "trigger":
        return "source"
    if node_type == "ai-chat":
        return "ai"
    if node_type == "image-gen":
        return "image"
    if node_type in {"send-message", "send-attachment", "chat-thread"}:
        return "chat"
    if node_type in {"note-create", "note-save", "note-delete", "note-export", "notes-query"}:
        return "notes"
    if node_type == "agent-run":
        return "agent"
    if node_type in {"provider-models", "memory-map", "api-health"}:
        return "mcp"
    return "transform"


def _node_id_for_step(step: str, node_type: str) -> str:
    if step == "load_agent":
        return "agent"
    if step == "mcp_search":
        return "search"
    if step == "mcp_read":
        return "reader"
    if step == "mcp_repo_search":
        return "search_doc"
    if step == "mcp_repo_structure":
        return "repo_structure"
    if step == "mcp_read_file":
        return "read_file"
    if step == "read_input":
        return "source"
    if step == "synthesize":
        return "chat" if node_type == "chat" else "summary"
    return step


def _first_input_value(input_map: dict[str, Any]) -> str:
    for value in input_map.values():
        if str(value).strip():
            return str(value)
    return ""


def _selected_mcp_servers(server_ids: list[Any], settings: Settings | None, db: Database | None) -> list[dict[str, Any]]:
    if not settings:
        return []
    servers: list[dict[str, Any]] = []
    for server_id in server_ids:
        server = configured_mcp_server(str(server_id), settings, db)
        if server:
            servers.append(server)
    return servers


def _resumed_graph_steps(run: dict[str, Any] | None, resume_after: str) -> list[str]:
    if not run or not resume_after:
        return []
    out: list[str] = []
    for result in run.get("node_results") or []:
        if result.get("status") == "failed" or not result.get("graph_step"):
            break
        out.append(result["graph_step"])
        if result["graph_step"] == resume_after:
            break
    return out


def _resumed_node_results(run: dict[str, Any] | None, resume_after: str) -> list[dict[str, Any]]:
    if not run or not resume_after:
        return []
    out: list[dict[str, Any]] = []
    for result in run.get("node_results") or []:
        if result.get("status") == "failed":
            break
        out.append(result)
        if result.get("graph_step") == resume_after:
            break
    return out


def _resume_start_index(nodes: list[GraphNode], resume_after: str) -> int:
    if not resume_after:
        return 0
    for index, node in enumerate(nodes):
        if node["graph_step"] == resume_after or node["node_id"] == resume_after:
            return index + 1
    return 0


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug or "node"


def _truncate(value: str, limit: int) -> str:
    text = str(value)
    return text if len(text) <= limit else text[:limit] + "..."


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def checkpoint_id(thread_id: str, graph_steps: list[str]) -> str:
    seed = "|".join([thread_id, *graph_steps])
    return "ckpt-" + uuid.uuid5(uuid.NAMESPACE_URL, seed).hex[:12]
