import type {
  AiMemory,
  AiMemoryListResponse,
  AiMemoryRetainPayload,
  AiMemoryRetainResponse,
  AiPersona,
  AiPersonaListResponse,
  AiPersonaSaveResponse,
  ChatAttachment,
  ChatConfig,
  ChatDocumentChunkDetail,
  ChatDocumentChunkSearchResponse,
  ChatMessage,
  ChatResponse,
  ChatRunListResponse,
  ChatRunRecord,
  ChatSendPayload,
  ChatStreamEvent,
  DirectMessageRecord,
  FriendRequestRecord,
  FriendSummary,
  ChatGroupRecord,
  GroupMessageRecord,
  ModelProfile,
  ModelProfileSyncResponse,
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
  PlatformSummary,
  PasswordChangePayload,
  ProfileCoverUploadPayload,
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

function authHeaders(token = ""): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  if (/^(https?:|data:|blob:)/i.test(path)) {
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
        data_url: attachment.uploaded ? undefined : attachment.dataUrl,
        uploaded: attachment.uploaded,
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

export async function fetchChatGroups(token: string): Promise<ChatGroupRecord[]> {
  const response = await fetch(apiUrl("/api/chat/groups"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function createChatGroup(token: string, payload: { name: string; memberIds: string[] }): Promise<ChatGroupRecord> {
  const response = await fetch(apiUrl("/api/chat/groups"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: payload.name, member_ids: payload.memberIds }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchGroupMessages(token: string, groupId: string): Promise<GroupMessageRecord[]> {
  const response = await fetch(apiUrl(`/api/chat/groups/${encodeURIComponent(groupId)}/messages`), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function sendGroupMessage(token: string, groupId: string, content: string): Promise<GroupMessageRecord> {
  const response = await fetch(apiUrl(`/api/chat/groups/${encodeURIComponent(groupId)}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchCurrentUserPlatforms(token: string): Promise<PlatformSummary> {
  const response = await fetch(apiUrl("/api/auth/me/platforms"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
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

export async function uploadCurrentUserCover(token: string, payload: ProfileCoverUploadPayload): Promise<AuthUser> {
  const response = await fetch(apiUrl("/api/auth/me/cover"), {
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

export async function testProviderConnection(config: ChatConfig, authToken = ""): Promise<ProviderConnectionResponse> {
  const response = await fetch(apiUrl("/api/catalog/provider/test"), {
    method: "POST",
    headers: {
      ...authHeaders(authToken),
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

export async function fetchProviderModels(config: ChatConfig, authToken = ""): Promise<ProviderModelsResponse> {
  const response = await fetch(apiUrl("/api/catalog/provider/models"), {
    method: "POST",
    headers: {
      ...authHeaders(authToken),
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

export async function fetchModelProfiles(authToken = ""): Promise<ModelProfileSyncResponse> {
  const response = await fetch(apiUrl("/api/catalog/model-profiles"), {
    headers: authHeaders(authToken),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }
  return modelProfileResponseFromApi(await response.json());
}

export async function syncModelProfiles(profiles: ModelProfile[], activeProfileId: string, authToken = ""): Promise<ModelProfileSyncResponse> {
  const response = await fetch(apiUrl("/api/catalog/model-profiles"), {
    method: "PUT",
    headers: {
      ...authHeaders(authToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      profiles: profiles.map(modelProfileToApi),
      active_profile_id: activeProfileId,
    }),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }
  return modelProfileResponseFromApi(await response.json());
}

export async function fetchAiPersonas(authToken = ""): Promise<AiPersonaListResponse> {
  const response = await fetch(apiUrl("/api/chat/personas"), {
    headers: authHeaders(authToken),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }
  const data = await response.json() as { personas?: unknown[] };
  return { personas: Array.isArray(data.personas) ? data.personas.map(aiPersonaFromApi).filter((item): item is AiPersona => Boolean(item)) : [] };
}

export async function saveAiPersona(authToken: string, persona: AiPersona): Promise<AiPersonaSaveResponse> {
  const response = await fetch(apiUrl("/api/chat/personas"), {
    method: "POST",
    headers: {
      ...authHeaders(authToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(aiPersonaToApi(persona)),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }
  const data = await response.json();
  const saved = aiPersonaFromApi(data.persona);
  if (!saved) {
    throw new Error("Persona response is invalid.");
  }
  return { persona: saved };
}

export async function deleteAiPersona(authToken: string, personaId: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/chat/personas/${encodeURIComponent(personaId)}`), {
    method: "DELETE",
    headers: authHeaders(authToken),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }
}

export async function fetchAiMemories(authToken = "", personaId = "", query = "", limit = 12): Promise<AiMemoryListResponse> {
  const params = new URLSearchParams({
    persona_id: personaId,
    q: query,
    limit: String(limit),
  });
  const response = await fetch(apiUrl(`/api/chat/memory/recall?${params.toString()}`), {
    headers: authHeaders(authToken),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }
  const data = await response.json() as { memories?: unknown[] };
  return { memories: Array.isArray(data.memories) ? data.memories.map(aiMemoryFromApi).filter((item): item is AiMemory => Boolean(item)) : [] };
}

export async function retainAiMemory(authToken: string, payload: AiMemoryRetainPayload): Promise<AiMemoryRetainResponse> {
  const response = await fetch(apiUrl("/api/chat/memory/retain"), {
    method: "POST",
    headers: {
      ...authHeaders(authToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      persona_id: payload.personaId ?? "",
      content: payload.content,
      source: payload.source ?? "manual",
      metadata: payload.metadata ?? {},
    }),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }
  const data = await response.json();
  const memory = aiMemoryFromApi(data.memory);
  if (!memory) {
    throw new Error("Memory response is invalid.");
  }
  return { memory };
}

export async function deleteAiMemory(authToken: string, memoryId: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/chat/memory/${encodeURIComponent(memoryId)}`), {
    method: "DELETE",
    headers: authHeaders(authToken),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }
}

export async function uploadChatAttachment(authToken: string, attachment: ChatAttachment): Promise<ChatAttachment> {
  const dataBase64 = typeof attachment.dataUrl === "string" ? attachment.dataUrl.split(",", 2)[1] ?? "" : "";
  const response = await fetch(apiUrl("/api/chat/attachments"), {
    method: "POST",
    headers: {
      ...authHeaders(authToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filename: attachment.name,
      content_type: attachment.type,
      data_base64: dataBase64,
    }),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }
  const data = await response.json() as Record<string, unknown>;
  return {
    ...attachment,
    id: stringField(data.id) || attachment.id,
    name: stringField(data.name) || attachment.name,
    type: stringField(data.type) || attachment.type,
    size: numberField(data.size, attachment.size),
    kind: data.kind === "image" ? "image" : "file",
    uploaded: Boolean(data.uploaded),
  };
}

export async function fetchChatRuns(authToken = "", limit = 12): Promise<ChatRunListResponse> {
  const response = await fetch(apiUrl(`/api/chat/runs?limit=${encodeURIComponent(String(limit))}`), {
    headers: authHeaders(authToken),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }
  const data = await response.json() as { runs?: unknown[] };
  return { runs: Array.isArray(data.runs) ? data.runs.map(chatRunFromApi).filter((item): item is ChatRunRecord => Boolean(item)) : [] };
}

export async function fetchChatRunEvents(authToken: string, runId: string): Promise<ChatStreamEvent[]> {
  const response = await fetch(apiUrl(`/api/chat/runs/${encodeURIComponent(runId)}/events`), {
    headers: authHeaders(authToken),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }
  return parseChatStreamEvents(await response.text());
}

export async function fetchChatAttachmentChunks(authToken: string, attachmentId: string, query = "", limit = 6): Promise<ChatDocumentChunkSearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const response = await fetch(apiUrl(`/api/chat/attachments/${encodeURIComponent(attachmentId)}/chunks?${params.toString()}`), {
    headers: authHeaders(authToken),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }
  return chatDocumentChunkSearchFromApi(await response.json());
}

export async function fetchChatDocumentChunkDetail(authToken: string, ref: string): Promise<ChatDocumentChunkDetail> {
  const response = await fetch(apiUrl(`/api/chat/document-chunks/${encodeURIComponent(ref)}`), {
    headers: authHeaders(authToken),
  });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }
  return chatDocumentChunkDetailFromApi(await response.json());
}

function tokenUsageRangeQuery(range: string) {
  const [start, end] = range.startsWith("custom:") ? range.slice("custom:".length).split(":") : [];
  if (start && end) {
    return new URLSearchParams({ range: "all", custom_start: start, custom_end: end }).toString();
  }
  return new URLSearchParams({ range }).toString();
}

export async function sendChat(config: ChatConfig, messages: ChatMessage[], authToken = ""): Promise<ChatResponse> {
  const response = await fetch(apiUrl("/api/chat"), {
    method: "POST",
    headers: {
      ...authHeaders(authToken),
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
  onEvent?: (event: ChatStreamEvent) => void,
  authToken = "",
): Promise<string> {
  const response = await fetch(apiUrl("/api/chat/stream"), {
    method: "POST",
    headers: {
      ...authHeaders(authToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(chatPayload(config, messages)),
  });

  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }

  if (!response.body) {
    return handleChatStreamText(await response.text(), onChunk, onEvent);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n+/);
    buffer = blocks.pop() ?? "";
    content += consumeChatStreamBlocks(blocks, onChunk, onEvent);
  }

  buffer += decoder.decode();
  content += consumeChatStreamBlocks([buffer], onChunk, onEvent);

  return content;
}

function handleChatStreamText(text: string, onChunk: (chunk: string) => void, onEvent?: (event: ChatStreamEvent) => void) {
  const content = consumeChatStreamBlocks([text], onChunk, onEvent);
  if (!content && text && !text.includes("event:")) {
    onChunk(text);
    return text;
  }
  return content;
}

function consumeChatStreamBlocks(blocks: string[], onChunk: (chunk: string) => void, onEvent?: (event: ChatStreamEvent) => void) {
  let content = "";
  for (const block of blocks) {
    const event = parseChatStreamEvent(block);
    if (!event) {
      continue;
    }
    onEvent?.(event);
    if (event.event === "message:chunk") {
      const chunk = typeof event.data.content === "string" ? event.data.content : "";
      if (chunk) {
        content += chunk;
        onChunk(chunk);
      }
    }
    if (event.event === "run:error") {
      const message = typeof event.data.message === "string" ? event.data.message : "AI 流式响应失败";
      throw new Error(message);
    }
  }
  return content;
}

function parseChatStreamEvent(block: string): ChatStreamEvent | null {
  const lines = block.split("\n").map((line) => line.trimEnd()).filter(Boolean);
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  if (!eventLine || !dataLines.length) {
    return null;
  }
  try {
    return {
      event: eventLine.replace("event:", "").trim() as ChatStreamEvent["event"],
      data: JSON.parse(dataLines.map((line) => line.replace("data:", "").trim()).join("\n")),
    };
  } catch {
    return null;
  }
}

function parseChatStreamEvents(text: string): ChatStreamEvent[] {
  return text
    .split(/\n\n+/)
    .map(parseChatStreamEvent)
    .filter((event): event is ChatStreamEvent => Boolean(event));
}

function chatPayload(config: ChatConfig, messages: ChatMessage[]) {
  const outboundMessages = messages.map((message) => ({
    role: message.role,
    content: message.content,
    attachments: (message.attachments ?? []).slice(0, 4).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      kind: attachment.kind,
      data_url: attachment.uploaded ? undefined : attachment.dataUrl,
      uploaded: attachment.uploaded,
    })),
  }));
  const runtimeIds = {
    profile_id: config.profileId,
    persona_id: config.personaId,
    contact_id: config.personaId,
    memory_strategy: config.memoryStrategy,
    mcp_server_ids: config.mcpServerIds ?? [],
    messages: outboundMessages,
  };

  if (config.profileId) {
    return runtimeIds;
  }
  return {
    ...runtimeIds,
    provider: config.provider,
    base_url: config.baseUrl,
    api_key: config.apiKey,
    model: config.model,
    system_prompt: config.systemPrompt,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    supports_vision: config.supportsVision,
    fallback_model: config.fallbackModel,
  };
}

export async function generateImage(config: ImageGenerationConfig, authToken = ""): Promise<ImageGenerationResponse> {
  const response = await fetch(apiUrl("/api/images/generate"), {
    method: "POST",
    headers: {
      ...authHeaders(authToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(imageGenerationPayload(config)),
  });

  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }

  return response.json();
}

function imageGenerationPayload(config: ImageGenerationConfig) {
  const base = {
    profile_id: config.profileId,
    prompt: config.prompt,
    model: config.model,
    size: config.size,
  };
  if (config.profileId) {
    return base;
  }
  return {
    ...base,
    provider: config.provider,
    base_url: config.baseUrl,
    api_key: config.apiKey,
  };
}

function providerConnectionPayload(config: ChatConfig) {
  return {
    profile_id: config.profileId,
    provider: config.provider,
    base_url: config.baseUrl,
    api_key: config.apiKey,
  };
}

function modelProfileResponseFromApi(payload: { profiles?: unknown[]; active_profile_id?: string }): ModelProfileSyncResponse {
  const profiles = Array.isArray(payload.profiles) ? payload.profiles.map(modelProfileFromApi).filter((profile): profile is ModelProfile => Boolean(profile)) : [];
  const activeProfileId = payload.active_profile_id ?? profiles[0]?.id ?? "";
  return { profiles, activeProfileId };
}

function modelProfileToApi(profile: ModelProfile) {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    base_url: profile.baseUrl,
    api_key: profile.apiKey,
    model: profile.model,
    system_prompt: profile.systemPrompt ?? "",
    temperature: profile.temperature,
    max_tokens: profile.maxTokens,
    supports_vision: Boolean(profile.supportsVision),
    fallback_model: profile.fallbackModel ?? "",
    enabled: true,
    persona: profile.persona,
    pet: profile.pet,
  };
}

function modelProfileFromApi(value: unknown): ModelProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Record<string, unknown>;
  const id = stringField(item.id);
  const provider = normalizeProviderField(item.provider);
  const model = stringField(item.model);
  if (!id || !provider || !model) {
    return null;
  }
  const name = stringField(item.name) || model;
  return {
    id,
    name,
    provider,
    baseUrl: stringField(item.base_url),
    apiKey: stringField(item.api_key),
    apiKeySet: Boolean(item.api_key_set),
    model,
    systemPrompt: stringField(item.system_prompt),
    temperature: numberField(item.temperature, 0.7),
    maxTokens: numberField(item.max_tokens, 1024),
    supportsVision: Boolean(item.supports_vision),
    fallbackModel: stringField(item.fallback_model),
    persona: profilePersonaFromApi(item.persona, name),
    pet: profilePetFromApi(item.pet),
  };
}

function aiPersonaToApi(persona: AiPersona) {
  return {
    id: persona.id,
    name: persona.name,
    role: persona.role,
    temperament: persona.temperament,
    notes: persona.notes,
    default_profile_id: persona.defaultProfileId,
    memory_strategy: persona.memoryStrategy,
    enabled: persona.enabled,
  };
}

function aiPersonaFromApi(value: unknown): AiPersona | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Record<string, unknown>;
  const id = stringField(item.id);
  const name = stringField(item.name);
  if (!id || !name) {
    return null;
  }
  const strategy = stringField(item.memory_strategy);
  return {
    id,
    name,
    role: stringField(item.role),
    temperament: stringField(item.temperament),
    notes: stringField(item.notes),
    defaultProfileId: stringField(item.default_profile_id),
    memoryStrategy: isMemoryStrategy(strategy) ? strategy : "recall",
    enabled: item.enabled !== false,
    createdAt: stringField(item.created_at),
    updatedAt: stringField(item.updated_at),
  };
}

function isMemoryStrategy(value: string): value is AiPersona["memoryStrategy"] {
  return value === "off" || value === "recall" || value === "retain" || value === "recall-retain";
}

function aiMemoryFromApi(value: unknown): AiMemory | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Record<string, unknown>;
  const id = stringField(item.id);
  const content = stringField(item.content);
  if (!id || !content) {
    return null;
  }
  return {
    id,
    personaId: stringField(item.persona_id),
    content,
    source: stringField(item.source),
    metadata: objectField(item.metadata) ?? {},
    createdAt: stringField(item.created_at),
    updatedAt: stringField(item.updated_at),
  };
}

function chatRunFromApi(value: unknown): ChatRunRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Record<string, unknown>;
  const id = stringField(item.id);
  if (!id) {
    return null;
  }
  return {
    id,
    personaId: stringField(item.persona_id),
    profileId: stringField(item.profile_id),
    provider: stringField(item.provider),
    model: stringField(item.model),
    status: stringField(item.status),
    eventCount: numberField(item.event_count, 0),
    usage: objectField(item.usage) ?? {},
    mcpServerIds: stringArrayField(item.mcp_server_ids),
    startedAt: stringField(item.started_at),
    endedAt: stringField(item.ended_at),
    createdAt: stringField(item.created_at),
  };
}

function chatDocumentChunkSearchFromApi(value: unknown): ChatDocumentChunkSearchResponse {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    attachment: chatDocumentChunkAttachmentFromApi(item.attachment),
    chunks: Array.isArray(item.chunks) ? item.chunks.map(chatDocumentChunkFromApi).filter((chunk): chunk is ChatDocumentChunkDetail["chunk"] => Boolean(chunk)) : [],
  };
}

function chatDocumentChunkDetailFromApi(value: unknown): ChatDocumentChunkDetail {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    ref: stringField(item.ref),
    attachment: chatDocumentChunkAttachmentFromApi(item.attachment),
    chunk: chatDocumentChunkFromApi(item.chunk) ?? {
      attachmentId: "",
      chunkIndex: 0,
      content: "",
      createdAt: "",
    },
  };
}

function chatDocumentChunkAttachmentFromApi(value: unknown): ChatDocumentChunkDetail["attachment"] {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    id: stringField(item.id),
    name: stringField(item.name) || "attachment",
    type: stringField(item.type),
    size: numberField(item.size, 0),
    kind: stringField(item.kind) || "file",
    createdAt: stringField(item.created_at),
  };
}

function chatDocumentChunkFromApi(value: unknown): ChatDocumentChunkDetail["chunk"] | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Record<string, unknown>;
  const content = stringField(item.content);
  if (!content) {
    return null;
  }
  return {
    attachmentId: stringField(item.attachment_id),
    chunkIndex: numberField(item.chunk_index, 0),
    content,
    createdAt: stringField(item.created_at),
  };
}

function normalizeProviderField(value: unknown): ModelProfile["provider"] | "" {
  return value === "openai" || value === "anthropic" || value === "gemini" ? value : "";
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberField(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function objectField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function profilePersonaFromApi(value: unknown, fallbackName: string): ModelProfile["persona"] {
  const item = objectField(value);
  return {
    alias: stringField(item?.alias) || fallbackName,
    role: stringField(item?.role) || "助手",
    temperament: stringField(item?.temperament) || "清晰、直接",
    notes: stringField(item?.notes),
  };
}

function profilePetFromApi(value: unknown): ModelProfile["pet"] {
  const fallback = defaultProfilePet();
  const item = objectField(value);
  if (!item) return fallback;
  return {
    ...fallback,
    name: stringField(item.name) || fallback.name,
    species: isKnownPetSpecies(item.species) ? item.species : fallback.species,
    level: numberField(item.level, fallback.level),
    experience: numberField(item.experience, fallback.experience),
    mood: numberField(item.mood, fallback.mood),
    satiety: numberField(item.satiety, fallback.satiety),
    energy: numberField(item.energy, fallback.energy),
    lastAction: stringField(item.lastAction) || fallback.lastAction,
    lastActionAt: stringField(item.lastActionAt) || undefined,
    dailyInteractionDate: stringField(item.dailyInteractionDate) || fallback.dailyInteractionDate,
    dailyFeedCount: numberField(item.dailyFeedCount, fallback.dailyFeedCount),
    dailyPetCount: numberField(item.dailyPetCount, fallback.dailyPetCount),
    dailyQuestCount: numberField(item.dailyQuestCount, fallback.dailyQuestCount),
  };
}

function isKnownPetSpecies(value: unknown): value is ModelProfile["pet"]["species"] {
  return typeof value === "string" && ["spark", "leaf", "stone", "cloud", "cat", "dog", "rabbit", "panda", "fox", "bird", "penguin", "hamster", "turtle"].includes(value);
}

function defaultProfilePet(): ModelProfile["pet"] {
  return {
    name: "小火花",
    species: "spark",
    level: 1,
    experience: 0,
    mood: 80,
    satiety: 80,
    energy: 80,
    lastAction: "刚刚醒来",
    dailyInteractionDate: "",
    dailyFeedCount: 0,
    dailyPetCount: 0,
    dailyQuestCount: 0,
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
