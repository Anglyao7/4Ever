import type {
  ChatAttachment,
  ChatConfig,
  ChatMessage,
  ChatResponse,
  ChatSendPayload,
  DirectMessageRecord,
  FriendRequestRecord,
  FriendSummary,
  ProviderConnectionResponse,
  ProviderInfo,
  ProviderModelsResponse,
} from "../types/chat";
import type {
  AccountUpdatePayload,
  AdminAuditLog,
  AdminOverview,
  AdminUser,
  AvatarUploadPayload,
  AuthResponse,
  AuthUser,
  PasswordChangePayload,
  UserSearchResult,
  SignInPayload,
  SignUpPayload,
} from "../types/auth";
import type { ImageGenerationConfig, ImageGenerationResponse } from "../types/images";
import type { AdminModule, PlatformModule, TencentCitySearchResult, TencentMapConfig } from "../types/platform";
import type { TokenUsageApiKey, TokenUsageDashboard, TokenUsageKeyCreateResponse, TokenUsageKeyRevealResponse, TokenUsageLeaderboard } from "../types/tokenUsage";
import type { AgentBlueprint, AgentCatalog, AgentCheckpointListResponse, AgentPromptAdminUpdate, AgentRunCheckpointInspection, AgentRunCreate, AgentRunEvent, AgentRunListResponse, AgentRunResponse, AgentRunReviewUpdate, McpServer, McpToolCallRequest, McpToolCallResponse, McpToolListResponse } from "../types/workflow";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

export function getApiBaseUrl() {
  if (API_BASE_URL) {
    return new URL(API_BASE_URL, window.location.origin).origin;
  }
  if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
    return "http://127.0.0.1:7778";
  }
  return window.location.origin;
}

export function resolveMediaUrl(path?: string | null): string | undefined {
  if (!path) {
    return undefined;
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (API_BASE_URL) {
    return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  }
  return path;
}

export async function fetchProviders(): Promise<ProviderInfo[]> {
  const response = await fetch(apiUrl("/api/catalog/providers"));
  if (!response.ok) {
    throw new Error(`Provider catalog failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchModules(token = ""): Promise<PlatformModule[]> {
  const response = await fetch(apiUrl("/api/modules"), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Module catalog failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchTencentMapConfig(): Promise<TencentMapConfig> {
  const response = await fetch(apiUrl("/api/maps/tencent/config"));
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchAgentCatalog(): Promise<AgentCatalog> {
  const response = await fetch(apiUrl("/api/agents/catalog"));
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchMcpTools(serverId: string): Promise<McpToolListResponse> {
  const response = await fetch(apiUrl(`/api/agents/mcp/${encodeURIComponent(serverId)}/tools`));
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function callMcpTool(serverId: string, payload: McpToolCallRequest): Promise<McpToolCallResponse> {
  const response = await fetch(apiUrl(`/api/agents/mcp/${encodeURIComponent(serverId)}/tools/call`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function createAgentRun(payload: AgentRunCreate): Promise<AgentRunResponse> {
  const response = await fetch(apiUrl("/api/agents/runs"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function streamAgentRun(
  payload: AgentRunCreate,
  options: { signal?: AbortSignal; onEvent?: (event: AgentRunEvent) => void } = {},
): Promise<AgentRunEvent[]> {
  const response = await fetch(apiUrl("/api/agents/runs/stream"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  if (!response.body) {
    const events = parseSseEvents(await response.text());
    events.forEach((event) => options.onEvent?.(event));
    return events;
  }
  return readSseEvents(response.body, options.onEvent);
}

export async function cancelAgentRun(runId: string): Promise<AgentRunResponse> {
  const response = await fetch(apiUrl(`/api/agents/runs/${encodeURIComponent(runId)}/cancel`), {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function resumeAgentRun(runId: string): Promise<AgentRunResponse> {
  const response = await fetch(apiUrl(`/api/agents/runs/${encodeURIComponent(runId)}/resume`), {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchAgentRuns(limit = 30): Promise<AgentRunListResponse> {
  const response = await fetch(apiUrl(`/api/agents/runs?limit=${encodeURIComponent(String(limit))}`));
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchAgentRun(runId: string): Promise<AgentRunResponse> {
  const response = await fetch(apiUrl(`/api/agents/runs/${encodeURIComponent(runId)}`));
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchAgentRunEvents(runId: string): Promise<AgentRunEvent[]> {
  const response = await fetch(apiUrl(`/api/agents/runs/${encodeURIComponent(runId)}/events`));
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return parseSseEvents(await response.text());
}

export async function fetchAgentRunCheckpoint(runId: string): Promise<AgentRunCheckpointInspection> {
  const response = await fetch(apiUrl(`/api/agents/runs/${encodeURIComponent(runId)}/checkpoint`));
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchAgentRunCheckpoints(runId: string): Promise<AgentCheckpointListResponse> {
  const response = await fetch(apiUrl(`/api/agents/runs/${encodeURIComponent(runId)}/checkpoints`));
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function reviewAgentRun(runId: string, payload: AgentRunReviewUpdate): Promise<AgentRunResponse> {
  const response = await fetch(apiUrl(`/api/agents/runs/${encodeURIComponent(runId)}/review`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function searchTencentCities(query: string): Promise<TencentCitySearchResult[]> {
  const response = await fetch(apiUrl(`/api/maps/tencent/city-search?q=${encodeURIComponent(query)}`));
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const data = await response.json();
  return data.results ?? [];
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const response = await fetch(apiUrl("/health"));
    return response.ok;
  } catch {
    return false;
  }
}

export async function signIn(payload: SignInPayload): Promise<AuthResponse> {
  const response = await fetch(apiUrl("/api/auth/sign-in"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function signUp(payload: SignUpPayload): Promise<AuthResponse> {
  const response = await fetch(apiUrl("/api/auth/sign-up"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchCurrentUser(token: string): Promise<AuthUser> {
  const response = await fetch(apiUrl("/api/auth/me"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchAdminOverview(token: string): Promise<AdminOverview> {
  const response = await fetch(apiUrl("/api/admin/overview"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchAdminUsers(token: string, query = ""): Promise<AdminUser[]> {
  const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  const response = await fetch(apiUrl(`/api/admin/users${suffix}`), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function updateAdminUserRole(token: string, userId: string, role: string): Promise<AdminUser> {
  const response = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(userId)}/role`), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function updateAdminUserRisk(token: string, userId: string, riskFlagged: boolean, note = ""): Promise<AdminUser> {
  const response = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(userId)}/risk`), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ risk_flagged: riskFlagged, note }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchAdminModules(token: string): Promise<AdminModule[]> {
  const response = await fetch(apiUrl("/api/admin/modules"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchAdminMcpServers(token: string): Promise<McpServer[]> {
  const response = await fetch(apiUrl("/api/admin/mcp-servers"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchAdminAgents(token: string): Promise<AgentBlueprint[]> {
  const response = await fetch(apiUrl("/api/admin/agents"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchAdminAuditLogs(token: string): Promise<AdminAuditLog[]> {
  const response = await fetch(apiUrl("/api/admin/audit-logs"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function updateAdminModule(token: string, moduleId: string, enabled: boolean): Promise<AdminModule> {
  const response = await fetch(apiUrl(`/api/admin/modules/${encodeURIComponent(moduleId)}`), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function updateAdminMcpServer(token: string, serverId: string, enabled: boolean): Promise<McpServer> {
  const response = await fetch(apiUrl(`/api/admin/mcp-servers/${encodeURIComponent(serverId)}`), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function updateAdminAgentPrompt(token: string, agentId: string, payload: AgentPromptAdminUpdate): Promise<AgentBlueprint> {
  const response = await fetch(apiUrl(`/api/admin/agents/${encodeURIComponent(agentId)}`), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function searchUsers(token: string, query: string): Promise<UserSearchResult[]> {
  const response = await fetch(apiUrl(`/api/auth/users/search?q=${encodeURIComponent(query)}`), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchDirectMessages(token: string, userId: string): Promise<DirectMessageRecord[]> {
  const response = await fetch(apiUrl(`/api/chat/direct/${encodeURIComponent(userId)}`), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function sendDirectMessage(
  token: string,
  userId: string,
  payload: ChatSendPayload,
): Promise<DirectMessageRecord> {
  const response = await fetch(apiUrl(`/api/chat/direct/${encodeURIComponent(userId)}`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: payload.content,
      attachments: payload.attachments.slice(0, 4).map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        size: attachment.size,
        kind: attachment.kind,
        data_url: attachment.dataUrl,
      })),
      reply_to_message_id: typeof payload.replyTo?.id === "number" ? payload.replyTo.id : null,
    }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchFriendSummary(token: string): Promise<FriendSummary> {
  const response = await fetch(apiUrl("/api/chat/friends"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function requestFriend(token: string, userId: string): Promise<FriendRequestRecord> {
  const response = await fetch(apiUrl(`/api/chat/friends/request/${encodeURIComponent(userId)}`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function acceptFriendRequest(token: string, requestId: number): Promise<FriendRequestRecord> {
  const response = await fetch(apiUrl(`/api/chat/friends/requests/${requestId}/accept`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function rejectFriendRequest(token: string, requestId: number): Promise<FriendRequestRecord> {
  const response = await fetch(apiUrl(`/api/chat/friends/requests/${requestId}/reject`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function removeFriend(token: string, userId: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/chat/friends/${encodeURIComponent(userId)}`), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
}

export async function updateCurrentUser(token: string, payload: AccountUpdatePayload): Promise<AuthUser> {
  const response = await fetch(apiUrl("/api/auth/me"), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function uploadCurrentUserAvatar(token: string, payload: AvatarUploadPayload): Promise<AuthUser> {
  const response = await fetch(apiUrl("/api/auth/me/avatar"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function changePassword(token: string, payload: PasswordChangePayload): Promise<void> {
  const response = await fetch(apiUrl("/api/auth/password"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
}

export async function fetchTokenUsageKeys(token: string): Promise<TokenUsageApiKey[]> {
  const response = await fetch(apiUrl("/api/token-usage/keys"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function createTokenUsageKey(token: string, name: string): Promise<TokenUsageKeyCreateResponse> {
  const response = await fetch(apiUrl("/api/token-usage/keys"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function revealTokenUsageKey(token: string, keyId: string): Promise<TokenUsageKeyRevealResponse> {
  const response = await fetch(apiUrl(`/api/token-usage/keys/${encodeURIComponent(keyId)}/reveal`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function updateTokenUsageKey(token: string, keyId: string, payload: { name?: string; status?: "active" | "disabled" }): Promise<TokenUsageApiKey> {
  const response = await fetch(apiUrl(`/api/token-usage/keys/${encodeURIComponent(keyId)}`), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchTokenUsageDashboard(token: string, range = "30d"): Promise<TokenUsageDashboard> {
  const response = await fetch(apiUrl(`/api/token-usage/dashboard?${tokenUsageRangeQuery(range)}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchTokenUsageLeaderboard(token: string, range = "30d"): Promise<TokenUsageLeaderboard> {
  const response = await fetch(apiUrl(`/api/token-usage/leaderboard?${tokenUsageRangeQuery(range)}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function testProviderConnection(config: ChatConfig): Promise<ProviderConnectionResponse> {
  const response = await fetch(apiUrl("/api/catalog/provider/test"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(providerConnectionPayload(config)),
  });

  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }

  return response.json();
}

export async function fetchProviderModels(config: ChatConfig): Promise<ProviderModelsResponse> {
  const response = await fetch(apiUrl("/api/catalog/provider/models"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(providerConnectionPayload(config)),
  });

  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }

  return response.json();
}

function tokenUsageRangeQuery(range: string) {
  const [start, end] = range.startsWith("custom:") ? range.slice("custom:".length).split(":") : [];
  if (start && end) {
    return new URLSearchParams({ range: "all", custom_start: start, custom_end: end }).toString();
  }
  return new URLSearchParams({ range }).toString();
}

export async function sendChat(config: ChatConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  const response = await fetch(apiUrl("/api/chat"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(chatPayload(config, messages)),
  });

  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }

  return response.json();
}

export async function streamChat(
  config: ChatConfig,
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
): Promise<string> {
  const response = await fetch(apiUrl("/api/chat/stream"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(chatPayload(config, messages)),
  });

  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }

  if (!response.body) {
    const content = await response.text();
    if (content) {
      onChunk(content);
    }
    return content;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) {
      content += chunk;
      onChunk(chunk);
    }
  }

  const tail = decoder.decode();
  if (tail) {
    content += tail;
    onChunk(tail);
  }

  return content;
}

function chatPayload(config: ChatConfig, messages: ChatMessage[]) {
  const outboundMessages = messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  return {
    provider: config.provider,
    base_url: config.baseUrl,
    api_key: config.apiKey,
    model: config.model,
    system_prompt: config.systemPrompt,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    messages: outboundMessages,
  };
}

export async function generateImage(config: ImageGenerationConfig): Promise<ImageGenerationResponse> {
  const response = await fetch(apiUrl("/api/images/generate"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: config.prompt,
      provider: config.provider,
      base_url: config.baseUrl,
      api_key: config.apiKey,
      model: config.model,
      size: config.size,
    }),
  });

  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }

  return response.json();
}

function providerConnectionPayload(config: ChatConfig) {
  return {
    provider: config.provider,
    base_url: config.baseUrl,
    api_key: config.apiKey,
  };
}

function parseSseEvents(text: string): AgentRunEvent[] {
  return text
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLines = lines.filter((line) => line.startsWith("data:"));
      if (!eventLine || !dataLines.length) {
        return null;
      }
      try {
        return {
          event: eventLine.replace("event:", "").trim() as AgentRunEvent["event"],
          data: JSON.parse(dataLines.map((line) => line.replace("data:", "").trim()).join("\n")),
        };
      } catch {
        return null;
      }
    })
    .filter((event): event is AgentRunEvent => Boolean(event));
}

async function readSseEvents(body: ReadableStream<Uint8Array>, onEvent?: (event: AgentRunEvent) => void): Promise<AgentRunEvent[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: AgentRunEvent[] = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n+/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const parsed = parseSseEvents(`${block}\n\n`);
      parsed.forEach((event) => {
        events.push(event);
        onEvent?.(event);
      });
    }
  }

  buffer += decoder.decode();
  parseSseEvents(buffer).forEach((event) => {
    events.push(event);
    onEvent?.(event);
  });
  return events;
}

async function readError(response: Response) {
  try {
    const data = await response.json();
    if (Array.isArray(data.detail)) {
      return (
        data.detail
          .map((item: { msg?: string }) => item.msg)
          .filter(Boolean)
          .join(" ") || `Request failed: ${response.status}`
      );
    }
    return data.detail ?? `Request failed: ${response.status}`;
  } catch {
    return `Request failed: ${response.status}`;
  }
}
