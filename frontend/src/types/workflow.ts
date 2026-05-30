import type { WorkflowCanvas } from "./workflow-canvas";

export type WorkflowNodeType = "source" | "transform" | "ai" | "notes" | "image" | "chat" | "contact" | "mcp" | "agent";
export type WorkflowRunStatus = "running" | "success" | "failed" | "canceled";
export type WorkflowNodeResultStatus = "success" | "failed";
export type WorkflowInputType = "text" | "textarea" | "noteSelect" | "contactMulti";

export interface WorkflowInputField {
  key: string;
  label: string;
  labelEn: string;
  placeholder: string;
  placeholderEn: string;
  type?: WorkflowInputType;
  multiline?: boolean;
  required?: boolean;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  prompt?: string;
  promptEn?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  category: string;
  categoryEn: string;
  inputs: WorkflowInputField[];
  nodes: WorkflowNode[];
  agentId?: string;
  mcpServerIds?: string[];
}

export interface WorkflowNodeResult {
  nodeId: string;
  type: WorkflowNodeType;
  title: string;
  graphStep?: string;
  status: WorkflowNodeResultStatus;
  output: string;
  startedAt: string;
  endedAt: string;
}

export interface WorkflowRun {
  id: string;
  threadId?: string;
  checkpointId?: string;
  workflowId: string;
  status: WorkflowRunStatus;
  preview?: boolean;
  agentPromptVersion?: string;
  agentPromptChecksum?: string;
  graphSteps?: string[];
  input: Record<string, string>;
  nodeResults: WorkflowNodeResult[];
  reviewStatus?: string;
  reviewNote?: string;
  reviewedAt?: string;
  startedAt: string;
  endedAt?: string;
  error?: string;
}

export interface McpServer {
  id: string;
  name: string;
  description: string;
  transport: string;
  endpoint: string;
  auth: string;
  provider: string;
  required_env: string;
  enabled: boolean;
  configured: boolean;
  live_enabled: boolean;
  tool_count: number;
  tool_names: string[];
  tags: string[];
}

export interface McpToolListResponse {
  server_id: string;
  server_name: string;
  tool_name: string;
  enabled: boolean;
  configured: boolean;
  live_enabled: boolean;
  status: "planned" | "success" | "failed";
  tools: string[];
  reason: string;
  error: string;
}

export interface McpToolCallRequest {
  tool_name: string;
  arguments: Record<string, unknown>;
}

export interface McpToolCallResponse {
  server_id: string;
  server_name: string;
  tool_name: string;
  enabled: boolean;
  configured: boolean;
  live_enabled: boolean;
  status: "planned" | "success" | "failed";
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  reason: string;
  error: string;
}

export interface AgentBlueprint {
  id: string;
  name: string;
  role: string;
  description: string;
  model_hint: string;
  prompt_version: string;
  prompt_checksum: string;
  system_prompt: string;
  mcp_server_ids: string[];
  workflow_template_ids: string[];
}

export interface WorkflowTemplatePolicy {
  id: string;
  name: string;
  execution_mode: string;
  requires_review: boolean;
  side_effects: string[];
  retry_limit: number;
  timeout_seconds: number;
  audit_level: string;
}

export interface AgentCatalog {
  agents: AgentBlueprint[];
  mcp_servers: McpServer[];
  workflow_templates: WorkflowTemplatePolicy[];
  security_note: string;
  graph_runtime: {
    runtime?: string;
    requested?: string;
    available?: boolean;
    reason?: string;
  };
}

export interface AgentRunCreate {
  template_id: string;
  agent_id: string;
  mcp_server_ids: string[];
  input: Record<string, string>;
  source: string;
  canvas?: WorkflowCanvas;
}

export interface AgentRunReviewUpdate {
  status: "approved" | "rejected";
  note?: string;
}

export interface AgentRunNodeResult {
  node_id: string;
  type: WorkflowNodeType;
  title: string;
  graph_step: string;
  status: WorkflowNodeResultStatus;
  output: string;
  started_at: string;
  ended_at: string;
}

export interface AgentRunResponse {
  id: string;
  thread_id: string;
  checkpoint_id: string;
  template_id: string;
  agent_id: string;
  agent_prompt_version: string;
  agent_prompt_checksum: string;
  mcp_server_ids: string[];
  status: WorkflowRunStatus;
  graph_steps: string[];
  input: Record<string, string>;
  canvas?: WorkflowCanvas;
  node_results: AgentRunNodeResult[];
  review_status: string;
  review_note: string;
  reviewed_at: string;
  started_at: string;
  ended_at: string;
}

export interface AgentRunListResponse {
  runs: AgentRunResponse[];
}

export interface AgentPromptAdminUpdate {
  prompt_version: string;
  system_prompt: string;
}

export interface AgentCheckpointStep {
  graph_step: string;
  node_id: string;
  title: string;
  status: string;
  started_at: string;
  ended_at: string;
  checkpoint_id: string;
  resumable: boolean;
}

export interface AgentRunCheckpointInspection {
  run_id: string;
  thread_id: string;
  checkpoint_id: string;
  status: WorkflowRunStatus;
  resume_after: string;
  resumable: boolean;
  graph_steps: string[];
  completed_steps: string[];
  failed_step: string;
  event_count: number;
  last_event: string;
  steps: AgentCheckpointStep[];
  langgraph: Record<string, unknown>;
}

export interface AgentCheckpointRecord {
  id: number;
  run_id: string;
  thread_id: string;
  checkpoint_id: string;
  graph_step: string;
  node_id: string;
  status: string;
  state: Record<string, unknown>;
  event_count: number;
  created_at: string;
}

export interface AgentCheckpointListResponse {
  checkpoints: AgentCheckpointRecord[];
}

export interface AgentRunEvent {
  event: "run.started" | "run.resumed" | "node.finished" | "node.retry" | "run.finished" | "run.failed" | "run.cancelled";
  data: Record<string, string>;
}
