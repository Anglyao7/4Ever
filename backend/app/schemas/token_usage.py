from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class TokenUsageApiKey(BaseModel):
    id: str
    name: str
    prefix: str
    status: str
    last_used_at: Optional[datetime] = None
    created_at: datetime


class TokenUsageApiKeyCreate(BaseModel):
    name: str = Field(default="本机 CLI", min_length=1, max_length=120)


class TokenUsageApiKeyCreateResponse(BaseModel):
    key: TokenUsageApiKey
    raw_key: str


class TokenUsageDevice(BaseModel):
    deviceId: str = Field(min_length=1, max_length=120)
    hostname: str = Field(default="", max_length=160)


class TokenUsageBucketIn(BaseModel):
    source: str = Field(min_length=1, max_length=80)
    model: str = Field(default="unknown", max_length=160)
    projectKey: str = Field(default="unknown", max_length=160)
    projectLabel: str = Field(default="unknown", max_length=240)
    bucketStart: datetime
    deviceId: Optional[str] = Field(default=None, max_length=120)
    hostname: Optional[str] = Field(default=None, max_length=160)
    inputTokens: int = Field(default=0, ge=0)
    outputTokens: int = Field(default=0, ge=0)
    reasoningTokens: int = Field(default=0, ge=0)
    cachedTokens: int = Field(default=0, ge=0)
    totalTokens: int = Field(default=0, ge=0)


class TokenUsageSessionIn(BaseModel):
    source: str = Field(min_length=1, max_length=80)
    projectKey: str = Field(default="unknown", max_length=160)
    projectLabel: str = Field(default="unknown", max_length=240)
    sessionHash: str = Field(min_length=1, max_length=120)
    deviceId: Optional[str] = Field(default=None, max_length=120)
    hostname: Optional[str] = Field(default=None, max_length=160)
    firstMessageAt: datetime
    lastMessageAt: datetime
    durationSeconds: int = Field(default=0, ge=0)
    activeSeconds: int = Field(default=0, ge=0)
    messageCount: int = Field(default=0, ge=0)
    userMessageCount: int = Field(default=0, ge=0)
    inputTokens: int = Field(default=0, ge=0)
    outputTokens: int = Field(default=0, ge=0)
    reasoningTokens: int = Field(default=0, ge=0)
    cachedTokens: int = Field(default=0, ge=0)
    totalTokens: int = Field(default=0, ge=0)
    primaryModel: str = Field(default="", max_length=160)
    modelUsages: list[dict] = Field(default_factory=list)


class TokenUsageIngestRequest(BaseModel):
    schemaVersion: Literal[2] = 2
    device: TokenUsageDevice
    buckets: list[TokenUsageBucketIn] = Field(default_factory=list, max_length=500)
    sessions: list[TokenUsageSessionIn] = Field(default_factory=list, max_length=1000)


class TokenUsageIngestResponse(BaseModel):
    ok: bool = True
    bucketCount: int
    sessionCount: int
    deviceId: str


class TokenUsageOverview(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    cached_tokens: int = 0
    total_tokens: int = 0
    active_seconds: int = 0
    sessions: int = 0
    messages: int = 0
    devices: int = 0
    sources: int = 0
    projects: int = 0
    models: int = 0


class TokenUsageTrendPoint(BaseModel):
    date: str
    total_tokens: int
    active_seconds: int = 0
    sessions: int = 0


class TokenUsageRankItem(BaseModel):
    key: str
    label: str
    total_tokens: int
    input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    cached_tokens: int = 0
    sessions: int = 0


class TokenUsageHeatmapCell(BaseModel):
    day: str
    hour: int
    total_tokens: int
    active_seconds: int = 0


class TokenUsageDeviceSummary(BaseModel):
    device_id: str
    hostname: str = ""
    total_tokens: int = 0
    active_seconds: int = 0
    sessions: int = 0
    sources: int = 0
    last_seen_at: Optional[datetime] = None


class TokenUsageDashboard(BaseModel):
    range: str
    overview: TokenUsageOverview
    token_trend: list[TokenUsageTrendPoint]
    heatmap: list[TokenUsageHeatmapCell]
    by_source: list[TokenUsageRankItem]
    by_model: list[TokenUsageRankItem]
    by_project: list[TokenUsageRankItem]
    devices: list[TokenUsageDeviceSummary] = Field(default_factory=list)
    last_synced_at: Optional[datetime] = None


class TokenUsageLeaderboardEntry(BaseModel):
    rank: int
    user_id: str
    username: str
    display_name: str
    total_tokens: int
    active_seconds: int
    sessions: int


class TokenUsageLeaderboard(BaseModel):
    entries: list[TokenUsageLeaderboardEntry]
