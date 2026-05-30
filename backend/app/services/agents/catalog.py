from os import getenv
from hashlib import sha256
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import AgentPromptSettingRecord, McpServerSettingRecord
from app.schemas.agents import AgentBlueprint, AgentCatalog, McpServer, WorkflowTemplatePolicy
from app.services.agents.langgraph_adapter import langgraph_runtime_status


MCP_SERVERS = [
    McpServer(
        id="bigmodel-web-search",
        name="BigModel Web Search Prime",
        description="联网搜索和实时信息获取，适合调研、校验和补充最新事实。",
        endpoint="https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
        required_env="BIGMODEL_API_KEY",
        tool_count=1,
        tool_names=["webSearchPrime"],
        tags=["search", "research", "realtime"],
    ),
    McpServer(
        id="bigmodel-web-reader",
        name="BigModel Web Reader",
        description="读取网页正文和结构化内容，适合把外部页面转成工作流上下文。",
        endpoint="https://open.bigmodel.cn/api/mcp/web_reader/mcp",
        required_env="BIGMODEL_API_KEY",
        tool_count=1,
        tool_names=["webReader"],
        tags=["reader", "web", "context"],
    ),
    McpServer(
        id="bigmodel-zread",
        name="BigModel ZRead",
        description="读取开源仓库知识、文档和代码，适合项目调研和技术方案生成。",
        endpoint="https://open.bigmodel.cn/api/mcp/zread/mcp",
        required_env="BIGMODEL_API_KEY",
        tool_count=3,
        tool_names=["search_doc", "get_repo_structure", "read_file"],
        tags=["repo", "code", "docs"],
    ),
]

RESEARCH_AGENT_PROMPT = "你是 4Ever 调研 Agent。你只做可追溯调研、证据压缩和结构化摘要，不执行外部副作用。"
WORKFLOW_AGENT_PROMPT = "你是 4Ever 秩序 Agent。你把灵感、札记和上下文整理成草稿或下一步建议，涉及发送和发布必须等待人工复核。"


def prompt_checksum(prompt: str) -> str:
    return sha256(prompt.encode("utf-8")).hexdigest()[:12]

AGENTS = [
    AgentBlueprint(
        id="research-agent",
        name="调研 Agent",
        role="researcher",
        description="把联网搜索、网页读取和札记输入组合成可追溯的调研摘要。",
        model_hint="GLM / OpenAI compatible chat model",
        prompt_version="research-v1",
        prompt_checksum=prompt_checksum(RESEARCH_AGENT_PROMPT),
        system_prompt=RESEARCH_AGENT_PROMPT,
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
        prompt_checksum=prompt_checksum(WORKFLOW_AGENT_PROMPT),
        system_prompt=WORKFLOW_AGENT_PROMPT,
        mcp_server_ids=["bigmodel-web-reader", "bigmodel-zread"],
        workflow_template_ids=["note-copy", "note-message", "agent-research-brief", "agent-repo-brief"],
    ),
]

WORKFLOW_TEMPLATES = {
    "agent-research-brief": [
        ("agent", "agent", "选择调研 Agent"),
        ("search", "mcp", "MCP 联网搜索"),
        ("reader", "mcp", "MCP 网页读取"),
        ("summary", "ai", "生成摘要"),
    ],
    "agent-repo-brief": [
        ("agent", "agent", "选择技术 Agent"),
        ("search_doc", "mcp", "ZRead 文档搜索"),
        ("repo_structure", "mcp", "ZRead 仓库结构"),
        ("read_file", "mcp", "ZRead 文件读取"),
        ("summary", "ai", "生成技术摘要"),
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

WORKFLOW_POLICIES = [
    WorkflowTemplatePolicy(
        id="agent-research-brief",
        name="Agent 联网调研",
        execution_mode="read_only",
        requires_review=False,
        side_effects=[],
        retry_limit=1,
        timeout_seconds=90,
        audit_level="evidence",
    ),
    WorkflowTemplatePolicy(
        id="agent-repo-brief",
        name="Agent 仓库调研",
        execution_mode="read_only",
        requires_review=False,
        side_effects=[],
        retry_limit=1,
        timeout_seconds=90,
        audit_level="code_evidence",
    ),
    WorkflowTemplatePolicy(
        id="note-copy",
        name="笔记整理成文案",
        execution_mode="draft_only",
        requires_review=True,
        side_effects=["draft_content"],
        retry_limit=0,
        timeout_seconds=60,
        audit_level="standard",
    ),
    WorkflowTemplatePolicy(
        id="note-message",
        name="笔记发送给联系人",
        execution_mode="draft_only",
        requires_review=True,
        side_effects=["draft_message"],
        retry_limit=0,
        timeout_seconds=45,
        audit_level="review_required",
    ),
]


def get_agent_catalog(db: Optional[Session] = None) -> AgentCatalog:
    runtime = langgraph_runtime_status()
    return AgentCatalog(
        agents=list_configured_agents(db),
        mcp_servers=list_configured_mcp_servers(db),
        workflow_templates=WORKFLOW_POLICIES,
        security_note="MCP API keys must stay on the backend. The frontend only selects agents and server ids.",
        graph_runtime={"runtime": runtime.runtime, "requested": runtime.requested, "available": runtime.available, "reason": runtime.reason},
    )


def find_agent(agent_id: str) -> Optional[AgentBlueprint]:
    return next((agent for agent in AGENTS if agent.id == agent_id), None)


def configured_agent(agent: AgentBlueprint, db: Optional[Session] = None) -> AgentBlueprint:
    if not db:
        return agent
    record = db.get(AgentPromptSettingRecord, agent.id)
    if not record:
        return agent
    prompt = record.system_prompt.strip() or agent.system_prompt
    version = record.prompt_version.strip() or agent.prompt_version
    return agent.model_copy(
        update={
            "prompt_version": version,
            "prompt_checksum": prompt_checksum(prompt),
            "system_prompt": prompt,
        }
    )


def configured_agent_by_id(agent_id: str, db: Optional[Session] = None) -> Optional[AgentBlueprint]:
    agent = find_agent(agent_id)
    return configured_agent(agent, db) if agent else None


def list_configured_agents(db: Optional[Session] = None) -> list[AgentBlueprint]:
    return [configured_agent(agent, db) for agent in AGENTS]


def find_mcp_server(server_id: str) -> Optional[McpServer]:
    return next((server for server in MCP_SERVERS if server.id == server_id), None)


def find_workflow_policy(template_id: str) -> Optional[WorkflowTemplatePolicy]:
    return next((policy for policy in WORKFLOW_POLICIES if policy.id == template_id), None)


def list_configured_mcp_servers(db: Optional[Session] = None) -> list[McpServer]:
    enabled_map = mcp_enabled_map(db) if db else {}
    return [configured_mcp_server(server, enabled_map.get(server.id, True)) for server in MCP_SERVERS]


def mcp_enabled_map(db: Optional[Session]) -> dict[str, bool]:
    if not db:
        return {}
    records = db.query(McpServerSettingRecord).all()
    return {record.server_id: record.enabled for record in records}


def configured_mcp_server(server: McpServer, enabled: bool = True) -> McpServer:
    configured = bool(getenv(server.required_env, "").strip())
    return server.model_copy(
        update={
            "enabled": enabled,
            "configured": configured,
            "live_enabled": enabled and configured and get_settings().bigmodel_mcp_live,
        }
    )


def configured_mcp_server_by_id(server_id: str, db: Optional[Session] = None) -> Optional[McpServer]:
    server = find_mcp_server(server_id)
    if not server:
        return None
    enabled = mcp_enabled_map(db).get(server_id, True) if db else True
    return configured_mcp_server(server, enabled)
