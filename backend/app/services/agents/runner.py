from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.schemas.ai import ChatCompletionRequest, ChatMessage, ChatRole, ProviderFormat
from app.schemas.agents import AgentBlueprint, AgentRunCreate, AgentRunEventRecord, AgentRunExecution, AgentRunNodeResult, AgentRunPrepared, AgentRunResponse, McpServer
from app.services.agents.active_runs import is_cancel_requested
from app.services.agents.catalog import (
    WORKFLOW_TEMPLATES,
    configured_mcp_server_by_id,
    configured_agent_by_id,
    find_mcp_server,
    find_workflow_policy,
)
from app.services.agents.graph import AgentGraphNode, build_agent_graph, graph_execution_plan
from app.services.agents.langgraph_adapter import execute_agent_graph_runtime, langgraph_checkpoint_for_step
from app.services.agents.mcp_client import build_mcp_call_plan, call_mcp_tool
from app.services.ai.adapters import ProviderError
from app.services.ai.client import complete_chat


@dataclass
class AgentRunError(Exception):
    status_code: int
    detail: str


@dataclass(frozen=True)
class NodeRender:
    output: str
    status: str = "success"


async def run_agent_workflow(request: AgentRunCreate, db: Session = None) -> AgentRunResponse:
    execution = await execute_agent_workflow(request, db=db)
    return execution.run


def prepare_agent_run(request: AgentRunCreate) -> AgentRunPrepared:
    return AgentRunPrepared(
        run_id=f"run-{uuid4().hex[:12]}",
        thread_id=f"thread-{uuid4().hex[:12]}",
        started_at=utc_now(),
        request=request,
    )


async def execute_agent_workflow(
    request: AgentRunCreate,
    event_handler=None,
    db: Session = None,
    resume_from: AgentRunResponse = None,
    resume_after: str = "",
    prepared: AgentRunPrepared = None,
    on_prepared=None,
) -> AgentRunExecution:
    agent = _validated_agent(request, db)
    policy = find_workflow_policy(request.template_id)
    run_id = prepared.run_id if prepared else f"run-{uuid4().hex[:12]}"
    thread_id = prepared.thread_id if prepared else (resume_from.thread_id if resume_from and resume_from.thread_id else f"thread-{uuid4().hex[:12]}")
    started_at = prepared.started_at if prepared else utc_now()
    events: list[AgentRunEventRecord] = []
    source_text = first_input_value(request.input)
    mcp_servers = [configured_server(server_id, db) for server_id in request.mcp_server_ids]
    graph = build_agent_graph(request.template_id)
    graph_nodes = graph_execution_plan(request.template_id)
    langgraph_checkpoint_id = langgraph_checkpoint_for_step(thread_id, resume_after) if resume_after else ""
    if on_prepared:
        on_prepared(prepared or AgentRunPrepared(run_id=run_id, thread_id=thread_id, started_at=started_at, request=request), agent, policy)
    initial_trace = resumed_graph_steps(resume_from, resume_after)
    state = {
        "run_id": run_id,
        "thread_id": thread_id,
        "template_id": request.template_id,
        "agent_id": agent.id,
        "input": request.input,
        "status": "running",
        "trace": initial_trace,
        "retry_limit": policy.retry_limit if policy else 0,
        "timeout_seconds": policy.timeout_seconds if policy else 60,
        "resume_after": resume_after,
        "langgraph_checkpoint_id": langgraph_checkpoint_id,
        "cancel_check": lambda: is_cancel_requested(run_id),
    }
    emit_event = event_collector(events, started_at, event_handler)
    graph_results = await execute_agent_graph_runtime(
        graph,
        state,
        lambda node, index, graph_state: render_graph_node(node, index, graph_state, source_text, agent, mcp_servers, graph_nodes),
        emit_event,
    )
    resumed_results = resumed_node_results(resume_from, resume_after)
    node_results = resumed_results + [
        AgentRunNodeResult(
            node_id=result["node_id"],
            type=result["type"],
            title=result["title"],
            graph_step=result["graph_step"],
            status=result.get("status", "success"),
            output=result["output"],
            started_at=result["started_at"],
            ended_at=result["ended_at"],
        )
        for result in graph_results
    ]
    run_status = "canceled" if state.get("status") == "canceled" else "failed" if any(node.status == "failed" for node in node_results) else "success"
    ended_at = utc_now()
    run = AgentRunResponse(
        id=run_id,
        thread_id=thread_id,
        checkpoint_id=checkpoint_id(thread_id, state.get("trace", [])),
        template_id=request.template_id,
        agent_id=agent.id,
        agent_prompt_version=agent.prompt_version,
        agent_prompt_checksum=agent.prompt_checksum,
        mcp_server_ids=request.mcp_server_ids,
        status=run_status,
        graph_steps=state.get("trace", []),
        input={**request.input, "source": request.source},
        node_results=node_results,
        review_status=resume_from.review_status if resume_from else initial_review_status(request.template_id),
        review_note=resume_from.review_note if resume_from else "",
        reviewed_at=resume_from.reviewed_at if resume_from else "",
        started_at=started_at,
        ended_at=ended_at,
    )
    if run.status != "canceled":
        emit_event("run.finished", {"run_id": run.id, "status": run.status, "ended_at": run.ended_at})
    return AgentRunExecution(run=run, events=events)


async def resume_agent_workflow(previous_run: AgentRunResponse, event_handler=None, db: Session = None) -> AgentRunExecution:
    resume_after = last_successful_graph_step(previous_run)
    if not resume_after:
        raise AgentRunError(status_code=409, detail="Run has no successful checkpoint to resume from.")
    request = AgentRunCreate(
        template_id=previous_run.template_id,
        agent_id=previous_run.agent_id,
        mcp_server_ids=previous_run.mcp_server_ids,
        input={key: value for key, value in previous_run.input.items() if key != "source"},
        source=previous_run.input.get("source", "resume"),
    )
    return await execute_agent_workflow(
        request,
        event_handler=event_handler,
        db=db,
        resume_from=previous_run,
        resume_after=resume_after,
    )


def last_successful_graph_step(run: AgentRunResponse) -> str:
    successful_steps = []
    for node in run.node_results:
        if node.status == "failed":
            break
        if node.graph_step:
            successful_steps.append(node.graph_step)
    return successful_steps[-1] if successful_steps else ""


def resumed_graph_steps(run: AgentRunResponse, resume_after: str) -> list[str]:
    if not run or not resume_after:
        return []
    steps = []
    for node in run.node_results:
        if node.status == "failed" or not node.graph_step:
            break
        steps.append(node.graph_step)
        if node.graph_step == resume_after:
            break
    return steps


def resumed_node_results(run: AgentRunResponse, resume_after: str) -> list[AgentRunNodeResult]:
    if not run or not resume_after:
        return []
    results = []
    for node in run.node_results:
        if node.status == "failed":
            break
        results.append(node)
        if node.graph_step == resume_after:
            break
    return results


def event_collector(events: list[AgentRunEventRecord], started_at: str, event_handler=None):
    def collect(event: str, data: dict) -> None:
        normalized = {key: str(value) for key, value in data.items()}
        if event == "run.started" and "started_at" not in normalized:
            normalized["started_at"] = started_at
        record = AgentRunEventRecord(event=event, data=normalized)
        events.append(record)
        if event_handler:
            event_handler(record)

    return collect


def initial_review_status(template_id: str) -> str:
    policy = find_workflow_policy(template_id)
    return "pending" if policy and policy.requires_review else "not_required"


def checkpoint_id(thread_id: str, trace: list[str]) -> str:
    last_step = trace[-1] if trace else "start"
    return f"{thread_id}:{len(trace)}:{last_step}"


def _validated_agent(request: AgentRunCreate, db: Session = None) -> AgentBlueprint:
    agent = configured_agent_by_id(request.agent_id, db)
    if not agent:
        raise AgentRunError(status_code=404, detail="Agent not found.")
    if request.template_id not in agent.workflow_template_ids:
        raise AgentRunError(status_code=400, detail="Template is not allowed for this agent.")
    if request.template_id not in WORKFLOW_TEMPLATES:
        raise AgentRunError(status_code=404, detail="Workflow template not found.")

    allowed_mcp_ids = set(agent.mcp_server_ids)
    unknown_mcp_ids = [server_id for server_id in request.mcp_server_ids if not find_mcp_server(server_id)]
    if unknown_mcp_ids:
        raise AgentRunError(status_code=404, detail=f"Unknown MCP server: {unknown_mcp_ids[0]}")
    denied_mcp_ids = [server_id for server_id in request.mcp_server_ids if server_id not in allowed_mcp_ids]
    if denied_mcp_ids:
        raise AgentRunError(status_code=400, detail=f"MCP server is not allowed for this agent: {denied_mcp_ids[0]}")
    disabled_mcp_ids = [server_id for server_id in request.mcp_server_ids if not configured_server(server_id, db).enabled]
    if disabled_mcp_ids:
        raise AgentRunError(status_code=403, detail=f"MCP server is disabled by admin policy: {disabled_mcp_ids[0]}")
    return agent


def configured_server(server_id: str, db: Session = None) -> McpServer:
    server = configured_mcp_server_by_id(server_id, db)
    if not server:
        raise AgentRunError(status_code=404, detail=f"Unknown MCP server: {server_id}")
    return server


def first_input_value(input_data: dict[str, str]) -> str:
    for value in input_data.values():
        if value.strip():
            return value.strip()
    return ""


async def render_graph_node(
    node: AgentGraphNode,
    index: int,
    state: dict,
    source: str,
    agent: AgentBlueprint,
    mcp_servers: list[McpServer],
    graph_nodes: list[str],
) -> dict:
    rendered = await render_node_output(node.id, node.type, source, index, agent, mcp_servers, graph_nodes, state.get("trace", []))
    return {
        "node_id": node.id,
        "type": node.type,
        "title": node.title,
        "status": rendered.status,
        "output": rendered.output,
        "started_at": utc_now(),
        "ended_at": utc_now(),
    }


async def render_node_output(
    node_id: str,
    node_type: str,
    source: str,
    index: int,
    agent: AgentBlueprint,
    mcp_servers: list[McpServer],
    graph_nodes: list[str],
    trace: list[str],
) -> NodeRender:
    if node_type == "agent":
        return NodeRender(
            "\n".join(
                [
                    f"{agent.name} 已加载。模型建议：{agent.model_hint}。",
                    f"LangGraph plan: {' -> '.join(graph_nodes)}",
                    f"Graph trace: {' -> '.join(trace)}",
                    "密钥由后端环境变量托管。",
                ]
            )
        )
    if not source and node_type != "agent":
        return NodeRender("等待输入内容。")
    if node_type == "mcp":
        server_index = max(index - 1, 0)
        server = mcp_servers[server_index] if server_index < len(mcp_servers) else (mcp_servers[0] if mcp_servers else None)
        if not server:
            return NodeRender("没有绑定 MCP Server。")
        plan = build_mcp_call_plan(server)
        tool_name = tool_for_node(node_id, server)
        arguments = arguments_for_tool(tool_name, source)
        result = await call_mcp_tool(server, tool_name, arguments)
        status = "failed" if result.get("status") == "failed" else "success"
        return NodeRender(render_mcp_output(plan, result), status=status)
    if node_type == "notes":
        return NodeRender(source[:120])
    if node_type == "transform":
        points = " / ".join([part for part in split_sentences(source)[:3] if part])
        return NodeRender(f"标题：{source[:18]}...\n要点：{points}")
    if node_type == "chat":
        return NodeRender(f"我整理了一段内容，想同步给你：{source[:160]}")
    if node_type == "ai":
        return await synthesize_with_model_or_plan(node_id, source, agent, trace)
    return NodeRender(f"基于内容生成：{source[:180]}")


async def synthesize_with_model_or_plan(node_id: str, source: str, agent: AgentBlueprint, trace: list[str]) -> NodeRender:
    settings = get_settings()
    if not settings.agent_synthesis_live:
        return NodeRender(render_planned_synthesis(source, "AGENT_SYNTHESIS_LIVE is disabled."))
    if not settings.agent_synthesis_provider or not settings.agent_synthesis_model:
        return NodeRender(render_planned_synthesis(source, "Agent synthesis provider or model is not configured."))
    try:
        provider = ProviderFormat(settings.agent_synthesis_provider)
    except ValueError:
        return NodeRender(render_planned_synthesis(source, f"Unsupported synthesis provider: {settings.agent_synthesis_provider}"), status="failed")

    try:
        response = await complete_chat(
            ChatCompletionRequest(
                provider=provider,
                base_url=settings.agent_synthesis_base_url or None,
                api_key=settings.agent_synthesis_api_key or None,
                model=settings.agent_synthesis_model,
                system_prompt="你是 4Ever 工作流 Agent。基于输入和 MCP 证据，输出结构化、可执行、简洁的中文结果。不要编造来源。",
                messages=[
                    ChatMessage(
                        role=ChatRole.user,
                        content="\n".join(
                            [
                                f"Agent: {agent.name} / {agent.role}",
                                f"Node: {node_id}",
                                f"Graph trace: {' -> '.join(trace)}",
                                "Input and evidence:",
                                source[:6000],
                            ]
                        ),
                    )
                ],
                temperature=0.4,
                max_tokens=900,
            )
        )
    except ProviderError as exc:
        return NodeRender(render_planned_synthesis(source, f"Model synthesis failed: {exc}"), status="failed")
    return NodeRender("\n".join(["模型生成摘要", response.content]))


def render_planned_synthesis(source: str, reason: str) -> str:
    return "\n".join(
        [
            "计划生成摘要",
            f"Reason: {reason}",
            f"Draft: 基于内容生成：{source[:180]}",
        ]
    )


def split_sentences(text: str) -> list[str]:
    normalized = text.replace("。", ".").replace("!", ".").replace("?", ".")
    return [part.strip() for part in normalized.split(".") if part.strip()]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def tool_for_node(node_id: str, server: McpServer) -> str:
    if server.id == "bigmodel-web-search":
        return "webSearchPrime"
    if server.id == "bigmodel-web-reader":
        return "webReader"
    if server.id == "bigmodel-zread":
        source = node_id.lower()
        if "search_doc" in source or "doc_search" in source:
            return "search_doc"
        if "structure" in source or "repo" in source:
            return "get_repo_structure"
        if "file" in source or "read" in source:
            return "read_file"
        return "search_doc"
    return server.tool_names[0] if server.tool_names else node_id


def arguments_for_tool(tool_name: str, source: str) -> dict[str, str]:
    if tool_name == "webSearchPrime":
        return {"query": source}
    if tool_name == "webReader":
        return {"url": first_url(source) or source}
    if tool_name == "search_doc":
        return {"query": source, **zread_repo_arguments(source)}
    if tool_name == "get_repo_structure":
        return zread_repo_arguments(source)
    if tool_name == "read_file":
        return {**zread_repo_arguments(source), "file_path": zread_file_path(source)}
    return {"input": source}


def zread_repo_arguments(source: str) -> dict[str, str]:
    repo = first_repo_reference(source)
    return {"repo": repo} if repo else {"query": source}


def first_repo_reference(text: str) -> str:
    for part in text.replace("\n", " ").split():
        cleaned = part.strip(".,，。)>")
        if "github.com/" in cleaned or cleaned.count("/") == 1 and not cleaned.startswith(("http://", "https://")):
            return cleaned.removeprefix("https://github.com/").removeprefix("http://github.com/")
    return ""


def zread_file_path(text: str) -> str:
    markers = ["file:", "path:", "文件：", "路径："]
    for marker in markers:
        if marker in text:
            return text.split(marker, 1)[1].strip().split()[0].strip(".,，。)")
    for part in text.replace("\n", " ").split():
        cleaned = part.strip(".,，。)")
        if "/" in cleaned and "." in cleaned and "github.com" not in cleaned:
            return cleaned
    return "README.md"


def first_url(text: str) -> str:
    for part in text.split():
        if part.startswith("http://") or part.startswith("https://"):
            return part.strip(".,，。)")
    return ""


def render_mcp_output(plan, result: dict) -> str:
    status = result.get("status", "planned")
    configured = "yes" if plan.configured else "no"
    live_enabled = "yes" if plan.live_enabled else "no"
    lines = [
        f"{'调用' if status == 'success' else '计划调用'} {plan.server_name}",
        f"Tool: {result.get('tool_name', '')}",
        f"Transport: {plan.transport}",
        f"Auth: {plan.auth} via {plan.required_env}",
        f"Configured: {configured}",
        f"Live enabled: {live_enabled}",
        f"Endpoint: {plan.endpoint}",
    ]
    if status == "planned":
        lines.append(f"Reason: {result.get('reason', 'not executed')}")
    elif status == "failed":
        lines.append(f"Error: {result.get('error', 'MCP call failed')}")
    else:
        lines.append("Result:")
        lines.append(str(result.get("result", {})))
    return "\n".join(lines)
