from typing import Optional

from pydantic import BaseModel, Field


class McpServer(BaseModel):
    id: str
    name: str
    description: str
    transport: str = "streamable-http"
    endpoint: str
    auth: str = "bearer"
    provider: str = "bigmodel"
    required_env: str
    enabled: bool = True
    configured: bool = False
    live_enabled: bool = False
    tool_count: int
    tool_names: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class AgentBlueprint(BaseModel):
    id: str
    name: str
    role: str
    description: str
    model_hint: str
    prompt_version: str = "v1"
    prompt_checksum: str = ""
    system_prompt: str = ""
    mcp_server_ids: list[str] = Field(default_factory=list)
    workflow_template_ids: list[str] = Field(default_factory=list)


class AgentPromptAdminUpdate(BaseModel):
    prompt_version: str = Field(min_length=1, max_length=80)
    system_prompt: str = Field(min_length=20, max_length=6000)


class AgentCheckpointStep(BaseModel):
    graph_step: str
    node_id: str = ""
    title: str = ""
    status: str = "pending"
    started_at: str = ""
    ended_at: str = ""
    checkpoint_id: str = ""
    resumable: bool = False


class AgentRunCheckpointInspection(BaseModel):
    run_id: str
    thread_id: str = ""
    checkpoint_id: str = ""
    status: str
    resume_after: str = ""
    resumable: bool = False
    graph_steps: list[str] = Field(default_factory=list)
    completed_steps: list[str] = Field(default_factory=list)
    failed_step: str = ""
    event_count: int = 0
    last_event: str = ""
    steps: list[AgentCheckpointStep] = Field(default_factory=list)
    langgraph: dict[str, object] = Field(default_factory=dict)


class AgentCheckpointRecord(BaseModel):
    id: int
    run_id: str
    thread_id: str = ""
    checkpoint_id: str
    graph_step: str
    node_id: str = ""
    status: str = "success"
    state: dict[str, object] = Field(default_factory=dict)
    event_count: int = 0
    created_at: str


class AgentCheckpointListResponse(BaseModel):
    checkpoints: list[AgentCheckpointRecord] = Field(default_factory=list)


class WorkflowTemplatePolicy(BaseModel):
    id: str
    name: str
    execution_mode: str = "read_only"
    requires_review: bool = False
    side_effects: list[str] = Field(default_factory=list)
    retry_limit: int = Field(default=0, ge=0)
    timeout_seconds: int = Field(default=60, ge=1)
    audit_level: str = "standard"


class AgentCatalog(BaseModel):
    agents: list[AgentBlueprint]
    mcp_servers: list[McpServer]
    workflow_templates: list[WorkflowTemplatePolicy] = Field(default_factory=list)
    security_note: str
    graph_runtime: dict[str, object] = Field(default_factory=dict)


class McpToolListResponse(BaseModel):
    server_id: str
    server_name: str
    tool_name: str = "tools/list"
    enabled: bool = True
    configured: bool = False
    live_enabled: bool = False
    status: str = "planned"
    tools: list[str] = Field(default_factory=list)
    reason: str = ""
    error: str = ""


class McpToolCallRequest(BaseModel):
    tool_name: str = Field(min_length=1, max_length=120)
    arguments: dict[str, object] = Field(default_factory=dict)


class McpToolCallResponse(BaseModel):
    server_id: str
    server_name: str
    tool_name: str
    enabled: bool = True
    configured: bool = False
    live_enabled: bool = False
    status: str = "planned"
    arguments: dict[str, object] = Field(default_factory=dict)
    result: dict[str, object] = Field(default_factory=dict)
    reason: str = ""
    error: str = ""


class McpServerAdminUpdate(BaseModel):
    enabled: bool


class AgentRunCreate(BaseModel):
    template_id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1)
    mcp_server_ids: list[str] = Field(default_factory=list)
    input: dict[str, str] = Field(default_factory=dict)
    source: str = "manual"
    canvas: Optional[dict[str, object]] = None


class AgentRunReviewUpdate(BaseModel):
    status: str = Field(pattern="^(approved|rejected)$")
    note: str = ""


class AgentRunNodeResult(BaseModel):
    node_id: str
    type: str
    title: str
    graph_step: str = ""
    status: str = "success"
    output: str
    started_at: str
    ended_at: str


class AgentRunResponse(BaseModel):
    id: str
    thread_id: str = ""
    checkpoint_id: str = ""
    template_id: str
    agent_id: str
    agent_prompt_version: str = ""
    agent_prompt_checksum: str = ""
    mcp_server_ids: list[str]
    status: str = "success"
    graph_steps: list[str] = Field(default_factory=list)
    input: dict[str, str]
    canvas: Optional[dict[str, object]] = None
    node_results: list[AgentRunNodeResult]
    review_status: str = "not_required"
    review_note: str = ""
    reviewed_at: str = ""
    started_at: str
    ended_at: str


class AgentRunListResponse(BaseModel):
    runs: list[AgentRunResponse]


class AgentRunEventRecord(BaseModel):
    event: str
    data: dict[str, str] = Field(default_factory=dict)


class AgentRunExecution(BaseModel):
    run: AgentRunResponse
    events: list[AgentRunEventRecord] = Field(default_factory=list)


class AgentRunPrepared(BaseModel):
    run_id: str
    thread_id: str
    started_at: str
    request: AgentRunCreate
