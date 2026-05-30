export interface TokenUsageApiKey {
  id: string;
  name: string;
  prefix: string;
  status: string;
  last_used_at?: string | null;
  created_at: string;
}

export interface TokenUsageKeyCreateResponse {
  key: TokenUsageApiKey;
  raw_key: string;
}

export interface TokenUsageOverview {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  active_seconds: number;
  sessions: number;
  messages: number;
  devices: number;
  sources: number;
  projects: number;
  models: number;
}

export interface TokenUsageTrendPoint {
  date: string;
  total_tokens: number;
  active_seconds: number;
  sessions: number;
}

export interface TokenUsageRankItem {
  key: string;
  label: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  sessions: number;
}

export interface TokenUsageHeatmapCell {
  day: string;
  hour: number;
  total_tokens: number;
  active_seconds: number;
}

export interface TokenUsageDeviceSummary {
  device_id: string;
  hostname: string;
  total_tokens: number;
  active_seconds: number;
  sessions: number;
  sources: number;
  last_seen_at?: string | null;
}

export interface TokenUsageDashboard {
  range: string;
  overview: TokenUsageOverview;
  token_trend: TokenUsageTrendPoint[];
  heatmap: TokenUsageHeatmapCell[];
  by_source: TokenUsageRankItem[];
  by_model: TokenUsageRankItem[];
  by_project: TokenUsageRankItem[];
  devices: TokenUsageDeviceSummary[];
  last_synced_at?: string | null;
}

export interface TokenUsageLeaderboardEntry {
  rank: number;
  user_id: string;
  username: string;
  display_name: string;
  total_tokens: number;
  active_seconds: number;
  sessions: number;
}

export interface TokenUsageLeaderboard {
  entries: TokenUsageLeaderboardEntry[];
}
