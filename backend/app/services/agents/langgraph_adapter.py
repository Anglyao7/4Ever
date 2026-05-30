from dataclasses import dataclass
from importlib.util import find_spec
from pathlib import Path
import sqlite3
import json
from typing import Any, Awaitable, Callable, Optional

from app.core.config import get_settings
from app.services.agents.graph import AgentGraph, AgentGraphNode, AgentGraphState, GraphEventHandler, GraphNodeHandler, execute_agent_graph, execute_node_with_policy, resume_start_index


@dataclass(frozen=True)
class LangGraphRuntimeStatus:
    available: bool
    runtime: str
    requested: str = "auto"
    reason: str = ""


def langgraph_runtime_status() -> LangGraphRuntimeStatus:
    requested = normalized_runtime(get_settings().agent_graph_runtime)
    if requested == "internal":
        return LangGraphRuntimeStatus(
            available=False,
            runtime="internal",
            requested=requested,
            reason="AGENT_GRAPH_RUNTIME=internal",
        )
    if find_spec("langgraph") is None:
        return LangGraphRuntimeStatus(
            available=False,
            runtime="internal",
            requested=requested,
            reason=f"AGENT_GRAPH_RUNTIME={requested}; langgraph package is not installed; using internal graph executor",
        )
    if find_spec("langgraph.checkpoint.sqlite") is None:
        return LangGraphRuntimeStatus(
            available=False,
            runtime="internal",
            requested=requested,
            reason=f"AGENT_GRAPH_RUNTIME={requested}; langgraph sqlite checkpointer is not installed; using internal graph executor",
        )
    return LangGraphRuntimeStatus(available=True, runtime="langgraph", requested=requested, reason="LangGraph sqlite checkpointer available")


def normalized_runtime(value: str) -> str:
    return value if value in {"auto", "internal", "langgraph"} else "auto"


def langgraph_plan(graph: AgentGraph) -> dict[str, Any]:
    status = langgraph_runtime_status()
    return {
        "template_id": graph.template_id,
        "runtime": status.runtime,
        "requested": status.requested,
        "nodes": [node.graph_step for node in graph.nodes],
        "edges": [{"from": source, "to": target} for source, target in graph.edges],
    }


def compile_langgraph_state_graph(graph: AgentGraph, node_handler: Callable[[AgentGraphNode], Callable], checkpointer: Any = None) -> Optional[Any]:
    if not langgraph_runtime_status().available:
        return None

    from langgraph.graph import END, StateGraph  # type: ignore

    state_graph = StateGraph(AgentGraphState)
    node_by_step = {node.graph_step: node for node in graph.nodes}
    for node in graph.nodes:
        state_graph.add_node(node.graph_step, node_handler(node))

    if graph.nodes:
        state_graph.set_entry_point(graph.nodes[0].graph_step)
    for source, target in graph.edges:
        if source in node_by_step and target in node_by_step:
            state_graph.add_edge(source, target)
        elif source in node_by_step and target == "persist":
            state_graph.add_edge(source, END)
    return state_graph.compile(checkpointer=checkpointer)


async def execute_agent_graph_runtime(
    graph: AgentGraph,
    state: AgentGraphState,
    handler: GraphNodeHandler,
    event_handler: Optional[GraphEventHandler] = None,
) -> list[dict[str, Any]]:
    """Execute through LangGraph when configured, otherwise use the internal executor.

    The public run contract stays identical across runtimes: events, retry policy,
    cancellation, trace, and node result payloads are normalized here.
    """
    if not langgraph_runtime_status().available:
        return await execute_agent_graph(graph, state, handler, event_handler)

    checkpointer_context = create_langgraph_checkpointer()
    if checkpointer_context is None:
        return await execute_agent_graph(graph, state, handler, event_handler)
    cancel_check = state.pop("cancel_check", None)
    async with checkpointer_context as checkpointer:
        compiled = compile_langgraph_state_graph(graph, lambda node: langgraph_node_handler(graph, node, handler, event_handler, cancel_check), checkpointer)
        if compiled is None:
            return await execute_agent_graph(graph, state, handler, event_handler)

        start_from_checkpoint = bool(state.get("resume_after") and state.get("langgraph_checkpoint_id"))
        initialize_graph_state(graph, state, event_handler, start_from_checkpoint=start_from_checkpoint)
        await invoke_compiled_graph(compiled, state)
        normalize_graph_trace(graph, state)
        finalize_graph_state(state)
        return list(state.get("_graph_results", []))


def create_langgraph_checkpointer() -> Optional[Any]:
    if find_spec("langgraph.checkpoint.sqlite.aio") is None:
        return None
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver  # type: ignore

    return AsyncSqliteSaver.from_conn_string(langgraph_checkpoint_path())


def langgraph_checkpoint_path() -> str:
    settings = get_settings()
    configured = settings.agent_langgraph_checkpoint_path
    if configured:
        return configured
    return str((settings.base_dir / "langgraph-checkpoints.sqlite").resolve())


def langgraph_checkpoint_for_step(thread_id: str, graph_step: str) -> str:
    if not langgraph_runtime_status().available or not thread_id or not graph_step:
        return ""
    try:
        connection = sqlite3.connect(f"file:{langgraph_checkpoint_path()}?mode=ro", uri=True)
    except sqlite3.Error:
        return ""
    try:
        rows = connection.execute(
            "SELECT checkpoint_id, metadata FROM checkpoints WHERE thread_id = ? ORDER BY checkpoint_id ASC",
            (thread_id,),
        ).fetchall()
    except sqlite3.Error:
        return ""
    finally:
        connection.close()
    for checkpoint_id, metadata in rows:
        payload = safe_json_dict(bytes_to_text(metadata))
        writes = payload.get("writes")
        if isinstance(writes, dict) and graph_step in writes:
            return checkpoint_id or ""
    return ""


def initialize_graph_state(graph: AgentGraph, state: AgentGraphState, event_handler: Optional[GraphEventHandler], start_from_checkpoint: bool = False) -> None:
    state.setdefault("trace", [])
    state["_graph_results"] = []
    state["_start_index"] = 0 if start_from_checkpoint else resume_start_index(graph, state.get("resume_after", ""))
    state["_node_index"] = {node.graph_step: index for index, node in enumerate(graph.nodes)}
    if event_handler:
        event_handler(
            "run.started",
            {
                "run_id": state.get("run_id", ""),
                "template_id": graph.template_id,
                "agent_id": state.get("agent_id", ""),
                "status": "running",
            },
        )
    resume_after = state.get("resume_after", "")
    if event_handler and resume_after:
        event_handler(
            "run.resumed",
            {
                "run_id": state.get("run_id", ""),
                "template_id": graph.template_id,
                "agent_id": state.get("agent_id", ""),
                "resume_after": resume_after,
                "start_index": state.get("_start_index", 0),
            },
        )


def langgraph_node_handler(
    graph: AgentGraph,
    node: AgentGraphNode,
    handler: GraphNodeHandler,
    event_handler: Optional[GraphEventHandler],
    cancel_check=None,
) -> Callable[[AgentGraphState], Awaitable[AgentGraphState]]:
    async def run_node(state: AgentGraphState) -> AgentGraphState:
        index = int(state.get("_node_index", {}).get(node.graph_step, 0))
        start_index = int(state.get("_start_index", 0))
        if index < start_index or state.get("_stop_requested"):
            return state

        if callable(cancel_check) and cancel_check():
            state["status"] = "canceled"
            state["_stop_requested"] = True
            if event_handler:
                event_handler(
                    "run.cancelled",
                    {
                        "run_id": state.get("run_id", ""),
                        "status": "canceled",
                        "reason": "cancelled by user",
                    },
                )
            return state

        state.setdefault("trace", []).append(node.graph_step)
        result = await execute_node_with_policy(graph, node, index, state, handler, event_handler)
        result["graph_step"] = node.graph_step
        state.setdefault("_graph_results", []).append(result)
        if event_handler:
            event_handler(
                "node.finished",
                {
                    "run_id": state.get("run_id", ""),
                    "node_id": result.get("node_id", node.id),
                    "graph_step": node.graph_step,
                    "type": result.get("type", node.type),
                    "title": result.get("title", node.title),
                    "status": result.get("status", "success"),
                    "started_at": result.get("started_at", ""),
                    "ended_at": result.get("ended_at", ""),
                },
            )
        if result.get("status") == "failed":
            state["status"] = "failed"
            state["_stop_requested"] = True
        return state

    return run_node


async def invoke_compiled_graph(compiled: Any, state: AgentGraphState) -> None:
    configurable = {"thread_id": state.get("thread_id") or state.get("run_id", "agent-run")}
    resume_checkpoint_id = state.get("langgraph_checkpoint_id")
    invoke_input: Any = state
    if resume_checkpoint_id:
        configurable.update({"checkpoint_ns": "", "checkpoint_id": resume_checkpoint_id})
        if hasattr(compiled, "aupdate_state"):
            config_for_update = {"configurable": configurable}
            next_config = await compiled.aupdate_state(
                config_for_update,
                {
                    "run_id": state.get("run_id", ""),
                    "status": state.get("status", "running"),
                    "_graph_results": [],
                    "_start_index": 0,
                    "_stop_requested": False,
                },
                as_node=state.get("resume_after") or None,
            )
            configurable = dict(next_config.get("configurable", configurable))
            invoke_input = None
    config = {"configurable": configurable}
    if hasattr(compiled, "ainvoke"):
        updated = await compiled.ainvoke(invoke_input, config=config)
    else:
        updated = compiled.invoke(invoke_input, config=config)
    if isinstance(updated, dict) and updated is not state:
        state.update(updated)


def finalize_graph_state(state: AgentGraphState) -> None:
    state.setdefault("trace", []).append("persist")
    if state.get("status") not in {"failed", "canceled"}:
        state["status"] = "success"


def normalize_graph_trace(graph: AgentGraph, state: AgentGraphState) -> None:
    observed = set(state.get("trace", []))
    state["trace"] = [node.graph_step for node in graph.nodes if node.graph_step in observed]


def safe_json_dict(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def bytes_to_text(value) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value or "")
