export type WorkflowNodeType = "ai" | "notes" | "image" | "chat";
export type WorkflowRunStatus = "running" | "success" | "failed";
export type WorkflowNodeResultStatus = "success";
export type WorkflowInputType = "text" | "textarea" | "noteSelect";

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
}

export interface WorkflowNodeResult {
  nodeId: string;
  type: WorkflowNodeType;
  title: string;
  status: WorkflowNodeResultStatus;
  output: string;
  startedAt: string;
  endedAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  input: Record<string, string>;
  nodeResults: WorkflowNodeResult[];
  startedAt: string;
  endedAt?: string;
  error?: string;
}
