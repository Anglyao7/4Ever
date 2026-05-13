export type ProviderFormat = "openai" | "anthropic" | "gemini";
export type ChatRole = "system" | "user" | "assistant";
export type ChatThreadType = "contact" | "group";

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "image" | "file";
  dataUrl?: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  authorName?: string;
  authorTone?: string;
  attachments?: ChatAttachment[];
}

export interface ChatSendPayload {
  content: string;
  attachments: ChatAttachment[];
}

export interface ChatContact {
  id: string;
  name: string;
  prompt: string;
  tone: "ink" | "green" | "blue" | "clay" | "gold";
  description?: string;
}

export interface ChatGroup {
  id: string;
  name: string;
  memberIds: string[];
  createdAt: string;
}

export interface ChatConfig {
  provider: ProviderFormat;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

export interface ModelProfile extends ChatConfig {
  id: string;
  name: string;
}

export interface ProviderInfo {
  id: ProviderFormat;
  label: string;
  default_base_url: string;
  default_model: string;
  auth_label: string;
  endpoint: string;
}

export interface ChatResponse {
  provider: ProviderFormat;
  model: string;
  content: string;
  usage?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface ProviderModel {
  id: string;
  label: string;
}

export interface ProviderConnectionResponse {
  ok: boolean;
  message: string;
  model_count: number;
}

export interface ProviderModelsResponse {
  models: ProviderModel[];
}
