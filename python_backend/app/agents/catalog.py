from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import os
from typing import Any

from app.config import Settings
from app.database import Database, row_to_dict


RESEARCH_PROMPT = "你是 4Ever 调研 Agent。你只做可追溯调研、证据压缩和结构化摘要，不执行外部副作用。"
WORKFLOW_PROMPT = "你是 4Ever 秩序 Agent。你把灵感、札记和上下文整理成草稿或下一步建议，涉及发送和发布必须等待人工复核。"


@dataclass(frozen=True)
class MCPServer:
    id: str
    name: str
    description: str
    transport: str
    endpoint: str
    auth: str
    provider: str
    required_env: str
    enabled: bool
    tool_count: int
    tool_names: list[str]
    tags: list[str]


@dataclass(frozen=True)
class AgentBlueprint:
    id: str
    name: str
    role: str
    description: str
    model_hint: str
    prompt_version: str
    system_prompt: str
    mcp_server_ids: list[str]
    workflow_template_ids: list[str]


@dataclass(frozen=True)
class WorkflowTemplatePolicy:
    id: str
    name: str
    execution_mode: str
    requires_review: bool
    side_effects: list[str]
    retry_limit: int
    timeout_seconds: int
    audit_level: str


MCP_SERVERS = [
    MCPServer(
        id="bigmodel-web-search",
        name="BigModel Web Search Prime",
        description="联网搜索和实时信息获取，适合调研、校验和补充最新事实。",
        transport="streamable-http",
        endpoint="https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
        auth="bearer",
        provider="bigmodel",
        required_env="BIGMODEL_API_KEY",
        enabled=True,
        tool_count=1,
        tool_names=["webSearchPrime"],
        tags=["search", "research", "realtime"],
    ),
    MCPServer(
        id="bigmodel-web-reader",
        name="BigModel Web Reader",
        description="读取网页正文和结构化内容，适合把外部页面转成工作流上下文。",
        transport="streamable-http",
        endpoint="https://open.bigmodel.cn/api/mcp/web_reader/mcp",
        auth="bearer",
        provider="bigmodel",
        required_env="BIGMODEL_API_KEY",
        enabled=True,
        tool_count=1,
        tool_names=["webReader"],
        tags=["reader", "web", "context"],
    ),
    MCPServer(
        id="bigmodel-zread",
        name="BigModel ZRead",
        description="读取开源仓库知识、文档和代码，适合项目调研和技术方案生成。",
        transport="streamable-http",
        endpoint="https://open.bigmodel.cn/api/mcp/zread/mcp",
        auth="bearer",
        provider="bigmodel",
        required_env="BIGMODEL_API_KEY",
        enabled=True,
        tool_count=3,
        tool_names=["search_doc", "get_repo_structure", "read_file"],
        tags=["repo", "code", "docs"],
    ),
]

AGENTS = [
    AgentBlueprint(
        id="research-agent",
        name="调研 Agent",
        role="researcher",
        description="把联网搜索、网页读取和札记输入组合成可追溯的调研摘要。",
        model_hint="GLM / OpenAI compatible chat model",
        prompt_version="research-v1",
        system_prompt=RESEARCH_PROMPT,
        mcp_server_ids=["bigmodel-web-search", "bigmodel-web-reader", "bigmodel-zread"],
        workflow_template_ids=["agent-research-brief", "agent-repo-brief"],
    ),
    AgentBlueprint(
        id="workflow-agent",
        name="秩序 Agent",
        role="operator",
        description="把灵感、笔记和外部上下文整理成可执行任务步骤。",
        model_hint="GLM / OpenAI compatible chat model",
        prompt_version="workflow-v1",
        system_prompt=WORKFLOW_PROMPT,
        mcp_server_ids=["bigmodel-web-reader", "bigmodel-zread"],
        workflow_template_ids=["canvas-workflow", "note-copy", "note-message", "agent-research-brief", "agent-repo-brief"],
    ),
]

WORKFLOW_POLICIES = [
    WorkflowTemplatePolicy("agent-research-brief", "Agent 联网调研", "read_only", False, [], 1, 90, "evidence"),
    WorkflowTemplatePolicy("agent-repo-brief", "Agent 仓库调研", "read_only", False, [], 1, 90, "code_evidence"),
    WorkflowTemplatePolicy("canvas-workflow", "画布流程执行", "canvas_orchestration", True, ["draft_plan", "reviewed_actions"], 1, 90, "canvas_trace"),
    WorkflowTemplatePolicy("note-copy", "笔记整理成文案", "draft_only", True, ["draft_content"], 0, 60, "standard"),
    WorkflowTemplatePolicy("note-message", "笔记发送给联系人", "draft_only", True, ["draft_message"], 0, 45, "review_required"),
]

WORKFLOW_TEMPLATES: dict[str, list[tuple[str, str, str]]] = {
    "agent-research-brief": [
        ("load_agent", "agent", "选择调研 Agent"),
        ("mcp_search", "mcp", "MCP 联网搜索"),
        ("mcp_read", "mcp", "MCP 网页读取"),
        ("synthesize", "ai", "生成摘要"),
    ],
    "agent-repo-brief": [
        ("load_agent", "agent", "选择技术 Agent"),
        ("mcp_repo_search", "mcp", "ZRead 文档搜索"),
        ("mcp_repo_structure", "mcp", "ZRead 仓库结构"),
        ("mcp_read_file", "mcp", "ZRead 文件读取"),
        ("synthesize", "ai", "生成技术摘要"),
    ],
    "canvas-workflow": [
        ("canvas_source", "notes", "读取画布"),
        ("canvas_plan", "transform", "梳理拓扑"),
        ("canvas_agent", "agent", "秩序编排"),
    ],
    "note-copy": [
        ("source", "notes", "读取札记"),
        ("transform", "transform", "整理结构"),
        ("copy", "ai", "生成文案"),
    ],
    "note-message": [
        ("source", "notes", "读取札记"),
        ("chat", "chat", "生成消息"),
    ],
}


def prompt_checksum(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12]


def configured_agent(agent_id: str, db: Database | None = None) -> dict[str, Any] | None:
    for agent in AGENTS:
        if agent.id == agent_id:
            data = asdict(agent)
            if db:
                with db.connect() as conn:
                    override = row_to_dict(conn.execute("SELECT * FROM agent_prompt_settings WHERE agent_id = ?", (agent.id,)).fetchone())
                if override:
                    if override.get("prompt_version"):
                        data["prompt_version"] = override["prompt_version"]
                    if override.get("system_prompt"):
                        data["system_prompt"] = override["system_prompt"]
            data["prompt_checksum"] = prompt_checksum(agent.system_prompt)
            data["prompt_checksum"] = prompt_checksum(data["system_prompt"])
            return data
    return None


def configured_mcp_server(server_id: str, settings: Settings, db: Database | None = None) -> dict[str, Any] | None:
    for server in MCP_SERVERS:
        if server.id == server_id:
            return _server_payload(server, settings, db)
    return None


def catalog(settings: Settings, db: Database | None = None) -> dict[str, Any]:
    return {
        "agents": [configured_agent(agent.id, db) for agent in AGENTS],
        "mcp_servers": [_server_payload(server, settings, db) for server in MCP_SERVERS],
        "workflow_templates": [asdict(policy) for policy in WORKFLOW_POLICIES],
        "security_note": "MCP API keys must stay on the backend. The frontend only selects agents and server ids.",
        "graph_runtime": {
            "runtime": "langgraph",
            "requested": settings.agent_graph_runtime,
            "available": True,
            "reason": "Python backend LangGraph StateGraph runtime",
        },
    }


def workflow_policy(template_id: str) -> WorkflowTemplatePolicy | None:
    return next((policy for policy in WORKFLOW_POLICIES if policy.id == template_id), None)


def list_configured_agents(db: Database | None = None) -> list[dict[str, Any]]:
    return [configured_agent(agent.id, db) for agent in AGENTS]


def list_configured_mcp_servers(settings: Settings, db: Database | None = None) -> list[dict[str, Any]]:
    return [_server_payload(server, settings, db) for server in MCP_SERVERS]


def find_agent(agent_id: str) -> AgentBlueprint | None:
    return next((agent for agent in AGENTS if agent.id == agent_id), None)


def find_mcp_server(server_id: str) -> MCPServer | None:
    return next((server for server in MCP_SERVERS if server.id == server_id), None)


def _server_payload(server: MCPServer, settings: Settings, db: Database | None = None) -> dict[str, Any]:
    configured = bool(os.getenv(server.required_env, "").strip())
    data = asdict(server)
    if db:
        with db.connect() as conn:
            record = row_to_dict(conn.execute("SELECT * FROM mcp_server_settings WHERE server_id = ?", (server.id,)).fetchone())
        if record:
            data["enabled"] = bool(record["enabled"])
    data["configured"] = configured
    data["live_enabled"] = bool(data["enabled"]) and configured and settings.bigmodel_mcp_live
    return data
