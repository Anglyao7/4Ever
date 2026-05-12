import type {
  ChatConfig,
  ChatMessage,
  ChatResponse,
  ProviderConnectionResponse,
  ProviderInfo,
  ProviderModelsResponse,
} from "../types/chat";
import type {
  AccountUpdatePayload,
  AuthResponse,
  AuthUser,
  PasswordChangePayload,
  SignInPayload,
  SignUpPayload,
} from "../types/auth";
import type { ImageGenerationConfig, ImageGenerationResponse } from "../types/images";
import type { PlatformModule } from "../types/platform";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
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
      messages,
    }),
  });

  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(detail);
  }

  return response.json();
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
