import type {
  ChatAttachment,
  ChatConfig,
  ChatMessage,
  ChatResponse,
  DirectMessageRecord,
  FriendRequestRecord,
  FriendSummary,
  ProviderConnectionResponse,
  ProviderInfo,
  ProviderModelsResponse,
} from "../types/chat";
import type {
  AccountUpdatePayload,
  AvatarUploadPayload,
  AuthResponse,
  AuthUser,
  PasswordChangePayload,
  UserSearchResult,
  SignInPayload,
  SignUpPayload,
} from "../types/auth";
import type { ImageGenerationConfig, ImageGenerationResponse } from "../types/images";
import type { PlatformModule } from "../types/platform";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
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

export async function fetchModules(): Promise<PlatformModule[]> {
  const response = await fetch(apiUrl("/api/modules"));
  if (!response.ok) {
    throw new Error(`Module catalog failed: ${response.status}`);
  }
  return response.json();
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
  payload: { content: string; attachments: ChatAttachment[] },
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

export async function sendChat(config: ChatConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  const outboundMessages = messages.map((message) => ({
    role: message.role,
    content: message.attachments?.length
      ? `${message.content}\n\n${attachmentSummary(message)}`
      : message.content,
  }));

  const response = await fetch(apiUrl("/api/chat"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider: config.provider,
      base_url: config.baseUrl,
      api_key: config.apiKey,
      model: config.model,
      system_prompt: config.systemPrompt,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      messages: outboundMessages,
    }),
  });

  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }

  return response.json();
}

function attachmentSummary(message: ChatMessage) {
  const attachments = message.attachments ?? [];
  if (!attachments.length) {
    return "";
  }
  return [
    "Attached files:",
    ...attachments.map((attachment) => `- ${attachment.name} (${attachment.type || "file"}, ${attachment.size} bytes)`),
  ].join("\n");
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
