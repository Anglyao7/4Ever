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
  uploaded?: boolean;
}

export interface ChatReplyReference {
  id?: string | number;
  authorName?: string;
  content: string;
  createdAt?: string;
  senderId?: string;
}

export interface DirectReplyReference {
  id?: number;
  author_name?: string;
  content: string;
  created_at?: string;
  sender_id?: string;
}

export interface ChatMessage {
  id?: string | number;
  role: ChatRole;
  content: string;
  authorName?: string;
  authorTone?: string;
  source?: "ai" | "human";
  senderId?: string;
  avatarText?: string;
  avatarUrl?: string;
  renderMarkdown?: boolean;
  createdAt?: string;
  attachments?: ChatAttachment[];
  replyTo?: ChatReplyReference | null;
}

export interface ChatSendPayload {
  content: string;
  attachments: ChatAttachment[];
  replyTo?: ChatReplyReference | null;
}

export interface ChatContact {
  id: string;
  name: string;
  prompt: string;
  tone: "ink" | "green" | "blue" | "clay" | "gold";
  kind: "ai" | "human";
  description?: string;
  remark?: string;
  avatarUrl?: string;
}

export interface ChatGroup {
  id: string;
  name: string;
  memberIds: string[];
  createdAt: string;
}

export interface ChatConfig {
  profileId?: string;
  personaId?: string;
  provider: ProviderFormat;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  supportsVision?: boolean;
  fallbackModel?: string;
  memoryStrategy?: "off" | "recall" | "retain" | "recall-retain";
  mcpServerIds?: string[];
}

export interface ApiPersona {
  alias: string;
  role: string;
  temperament: string;
  notes: string;
}

export interface ApiPet {
  name: string;
  species: "spark" | "leaf" | "stone" | "cloud" | "cat" | "dog" | "rabbit" | "panda" | "fox" | "bird" | "penguin" | "hamster" | "turtle";
  appearance?: PixelPetAppearance;
  level: number;
  experience: number;
  mood: number;
  satiety: number;
  energy: number;
  lastAction: string;
  lastActionAt?: string;
  dailyInteractionDate: string;
  dailyFeedCount: number;
  dailyPetCount: number;
  dailyQuestCount: number;
}

export interface PixelPetAppearance {
  animal: "cat" | "dog" | "rabbit" | "panda" | "fox" | "bird" | "penguin" | "hamster" | "turtle";
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  pattern: "solid" | "spots" | "mask" | "socks" | "split";
  expression: "bright" | "sleepy" | "cool" | "happy";
  accessory: "none" | "scarf" | "bell" | "leaf" | "satchel";
}

export interface ModelProfile extends Omit<ChatConfig, "systemPrompt"> {
  id: string;
  name: string;
  systemPrompt?: string;
  apiKeySet?: boolean;
  persona: ApiPersona;
  pet: ApiPet;
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
  fallback?: {
    from: string;
    to: string;
    reason?: string;
  };
  raw?: Record<string, unknown>;
}

export type ChatStreamEventName = "run:start" | "thought:summary" | "source:references" | "source:citation-check" | "message:chunk" | "message:done" | "token:usage" | "model:fallback" | "tool:start" | "tool:result" | "run:error";

export interface ChatStreamEvent {
  event: ChatStreamEventName;
  data: Record<string, unknown>;
}

export interface ChatSourceReference {
  ref: string;
  attachmentId: string;
  attachmentName: string;
  chunkIndex: number;
  preview: string;
}

export interface ChatDocumentChunk {
  attachmentId: string;
  chunkIndex: number;
  content: string;
  createdAt?: string;
}

export interface ChatDocumentChunkDetail {
  ref: string;
  attachment: {
    id: string;
    name: string;
    type: string;
    size: number;
    kind: string;
    createdAt?: string;
  };
  chunk: ChatDocumentChunk;
}

export interface ChatDocumentChunkSearchResponse {
  attachment: ChatDocumentChunkDetail["attachment"];
  chunks: ChatDocumentChunk[];
}

export interface ChatRunRecord {
  id: string;
  personaId: string;
  profileId: string;
  provider: string;
  model: string;
  status: "running" | "success" | "failed" | string;
  eventCount: number;
  usage: Record<string, unknown>;
  mcpServerIds: string[];
  startedAt?: string;
  endedAt?: string;
  createdAt?: string;
}

export interface ChatRunListResponse {
  runs: ChatRunRecord[];
}

export interface ModelProfileSyncResponse {
  profiles: ModelProfile[];
  activeProfileId: string;
}

export interface AiPersona {
  id: string;
  name: string;
  role: string;
  temperament: string;
  notes: string;
  defaultProfileId: string;
  memoryStrategy: "off" | "recall" | "retain" | "recall-retain";
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiPersonaListResponse {
  personas: AiPersona[];
}

export interface AiPersonaSaveResponse {
  persona: AiPersona;
}

export interface AiMemory {
  id: string;
  personaId: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiMemoryListResponse {
  memories: AiMemory[];
}

export interface AiMemoryRetainPayload {
  personaId?: string;
  content: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface AiMemoryRetainResponse {
  memory: AiMemory;
}

export interface ProviderModel {
  id: string;
  label: string;
}

export interface ProviderConnectionResponse {
  ok: boolean;
  message: string;
  model_count: number;
  models?: ProviderModel[];
}

export interface ProviderModelsResponse {
  models: ProviderModel[];
}

export interface DirectAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "image" | "file";
  data_url?: string;
  uploaded?: boolean;
}

export interface DirectMessageRecord {
  id: number;
  sender_id: string;
  recipient_id: string;
  content: string;
  attachments: DirectAttachment[];
  reply_to_message_id?: number | null;
  reply_to?: DirectReplyReference | null;
  created_at: string;
}

export interface FriendProfile {
  id: string;
  username: string;
  email: string;
  display_name: string;
  status: string;
  bio: string;
  location: string;
  avatar_url?: string | null;
  cover_url?: string | null;
}

export interface FriendRequestRecord {
  id: number;
  requester: FriendProfile;
  addressee: FriendProfile;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  responded_at?: string | null;
}

export interface FriendshipRecord {
  user: FriendProfile;
  created_at: string;
}

export interface ChatGroupMember {
  user: FriendProfile;
  role: "owner" | "member";
  joined_at: string;
}

export interface ChatGroupRecord {
  id: string;
  owner_id: string;
  name: string;
  members: ChatGroupMember[];
  created_at: string;
  updated_at: string;
}

export interface GroupMessageRecord {
  id: number;
  group_id: string;
  sender: FriendProfile;
  sender_id: string;
  content: string;
  created_at: string;
}

export interface FriendSummary {
  friends: FriendshipRecord[];
  incoming_requests: FriendRequestRecord[];
  outgoing_requests: FriendRequestRecord[];
}
