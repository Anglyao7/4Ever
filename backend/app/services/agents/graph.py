import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional, TypedDict


class AgentGraphState(TypedDict, total=False):
    run_id: str
    template_id: str
    agent_id: str
    input: dict[str, str]
    messages: list[dict]
    evidence: list[dict]
    draft: str
    status: str
    error: str
    trace: list[str]
    retry_limit: int
    timeout_seconds: int
    resume_after: str
    langgraph_checkpoint_id: str
    cancel_check: Callable[[], bool]
    _graph_results: list[dict[str, Any]]
    _start_index: int
    _node_index: dict[str, int]
    _stop_requested: bool


@dataclass(frozen=True)
class AgentGraphNode:
    id: str
    type: str
    title: str
    graph_step: str


@dataclass(frozen=True)
class AgentGraph:
    template_id: str
    nodes: list[AgentGraphNode]
    edges: list[tuple[str, str]]


GraphNodeHandler = Callable[[AgentGraphNode, int, AgentGraphState], Awaitable[dict[str, Any]]]
GraphEventHandler = Callable[[str, dict[str, Any]], None]


def build_agent_graph(template_id: str) -> AgentGraph:
    if template_id == "agent-research-brief":
        nodes = [
            AgentGraphNode("agent", "agent", "选择调研 Agent", "load_agent"),
            AgentGraphNode("search", "mcp", "MCP 联网搜索", "mcp_search"),
            AgentGraphNode("reader", "mcp", "MCP 网页读取", "mcp_read"),
            AgentGraphNode("summary", "ai", "生成摘要", "synthesize"),
        ]
        return AgentGraph(template_id=template_id, nodes=nodes, edges=linear_edges(["load_agent", "mcp_search", "mcp_read", "synthesize", "persist"]))
    if template_id == "agent-repo-brief":
        nodes = [
            AgentGraphNode("agent", "agent", "选择技术 Agent", "load_agent"),
            AgentGraphNode("search_doc", "mcp", "ZRead 文档搜索", "mcp_repo_search"),
            AgentGraphNode("repo_structure", "mcp", "ZRead 仓库结构", "mcp_repo_structure"),
            AgentGraphNode("read_file", "mcp", "ZRead 文件读取", "mcp_read_file"),
            AgentGraphNode("summary", "ai", "生成技术摘要", "synthesize"),
        ]
        return AgentGraph(
            template_id=template_id,
            nodes=nodes,
            edges=linear_edges(["load_agent", "mcp_repo_search", "mcp_repo_structure", "mcp_read_file", "synthesize", "persist"]),
        )
    if template_id == "note-copy":
        nodes = [
            AgentGraphNode("source", "notes", "读取札记", "read_input"),
            AgentGraphNode("transform", "transform", "整理结构", "transform"),
            AgentGraphNode("copy", "ai", "生成文案", "synthesize"),
        ]
        return AgentGraph(template_id=template_id, nodes=nodes, edges=linear_edges(["read_input", "transform", "synthesize", "persist"]))
    if template_id == "note-message":
        nodes = [
            AgentGraphNode("source", "notes", "读取札记", "read_input"),
            AgentGraphNode("chat", "chat", "生成消息", "synthesize"),
        ]
        return AgentGraph(template_id=template_id, nodes=nodes, edges=linear_edges(["read_input", "synthesize", "persist"]))
    return AgentGraph(template_id=template_id, nodes=[], edges=[])


async def execute_agent_graph(
    graph: AgentGraph,
    state: AgentGraphState,
    handler: GraphNodeHandler,
    event_handler: Optional[GraphEventHandler] = None,
) -> list[dict[str, Any]]:
    results = []
    trace = state.setdefault("trace", [])
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
    start_index = resume_start_index(graph, resume_after)
    if event_handler and resume_after:
        event_handler(
            "run.resumed",
            {
                "run_id": state.get("run_id", ""),
                "template_id": graph.template_id,
                "agent_id": state.get("agent_id", ""),
                "resume_after": resume_after,
                "start_index": start_index,
            },
        )
    for index, node in enumerate(graph.nodes[start_index:], start=start_index):
        cancel_check = state.get("cancel_check")
        if callable(cancel_check) and cancel_check():
            state["status"] = "canceled"
            if event_handler:
                event_handler(
                    "run.cancelled",
                    {
                        "run_id": state.get("run_id", ""),
                        "status": "canceled",
                        "reason": "cancelled by user",
                    },
                )
            break
        trace.append(node.graph_step)
        result = await execute_node_with_policy(graph, node, index, state, handler, event_handler)
        result["graph_step"] = node.graph_step
        results.append(result)
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
            break
    trace.append("persist")
    if state.get("status") not in {"failed", "canceled"}:
        state["status"] = "success"
    return results


async def execute_node_with_policy(
    graph: AgentGraph,
    node: AgentGraphNode,
    index: int,
    state: AgentGraphState,
    handler: GraphNodeHandler,
    event_handler: Optional[GraphEventHandler] = None,
) -> dict[str, Any]:
    retry_limit = max(0, int(state.get("retry_limit", 0)))
    timeout_seconds = max(1, int(state.get("timeout_seconds", 60)))
    attempts = retry_limit + 1
    last_result: Optional[dict[str, Any]] = None
    last_error = ""

    for attempt in range(1, attempts + 1):
        try:
            result = await asyncio.wait_for(handler(node, index, state), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            last_error = f"Node timed out after {timeout_seconds}s."
            result = failed_node_result(node, last_error)
        except Exception as exc:  # noqa: BLE001 - graph boundary converts node failures to run state.
            last_error = f"Node failed: {exc}"
            result = failed_node_result(node, last_error)

        last_result = result
        if result.get("status", "success") != "failed":
            if attempt > 1:
                result["output"] = f"Retried successfully on attempt {attempt}.\n{result.get('output', '')}"
            return result

        if attempt < attempts and event_handler:
            event_handler(
                "node.retry",
                {
                    "run_id": state.get("run_id", ""),
                    "template_id": graph.template_id,
                    "node_id": node.id,
                    "graph_step": node.graph_step,
                    "attempt": attempt,
                    "retry_limit": retry_limit,
                    "reason": result.get("output", last_error),
                },
            )

    if last_result is None:
        return failed_node_result(node, "Node did not produce a result.")
    if retry_limit:
        last_result["output"] = f"Retry attempts exhausted after {attempts} attempt(s).\n{last_result.get('output', last_error)}"
    return last_result


def failed_node_result(node: AgentGraphNode, output: str) -> dict[str, Any]:
    timestamp = utc_now()
    return {
        "node_id": node.id,
        "type": node.type,
        "title": node.title,
        "status": "failed",
        "output": output,
        "started_at": timestamp,
        "ended_at": timestamp,
    }


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def graph_execution_plan(template_id: str) -> list[str]:
    graph = build_agent_graph(template_id)
    if not graph.edges:
        return []
    plan = [graph.edges[0][0]]
    plan.extend(edge[1] for edge in graph.edges)
    return plan


def resume_start_index(graph: AgentGraph, resume_after: str) -> int:
    if not resume_after:
        return 0
    for index, node in enumerate(graph.nodes):
        if node.graph_step == resume_after or node.id == resume_after:
            return index + 1
    return 0


def linear_edges(step_ids: list[str]) -> list[tuple[str, str]]:
    return [(step_ids[index], step_ids[index + 1]) for index in range(len(step_ids) - 1)]
