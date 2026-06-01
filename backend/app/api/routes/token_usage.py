from __future__ import annotations

import hashlib
import json
import secrets
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import and_, desc, func, select
from sqlalchemy.orm import Session

from app.api.routes.auth import resolve_user
from app.db.models import TokenUsageApiKeyRecord, TokenUsageBucketRecord, TokenUsageSessionRecord, UserRecord
from app.db.session import get_db
from app.schemas.token_usage import (
    TokenUsageApiKey,
    TokenUsageApiKeyCreate,
    TokenUsageApiKeyCreateResponse,
    TokenUsageApiKeyRevealResponse,
    TokenUsageApiKeyUpdate,
    TokenUsageDashboard,
    TokenUsageDeviceSummary,
    TokenUsageHeatmapCell,
    TokenUsageHeatmapKeyBreakdown,
    TokenUsageIngestRequest,
    TokenUsageIngestResponse,
    TokenUsageLeaderboard,
    TokenUsageLeaderboardEntry,
    TokenUsageOverview,
    TokenUsageRankItem,
    TokenUsageTrendPoint,
)


router = APIRouter(prefix="/token-usage", tags=["token-usage"])
TOKEN_USAGE_DISPLAY_TZ = timezone(timedelta(hours=8))


@router.get("/keys", response_model=list[TokenUsageApiKey])
async def list_keys(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)) -> list[TokenUsageApiKey]:
    user = resolve_user(authorization, db)
    records = db.scalars(
        select(TokenUsageApiKeyRecord)
        .where(TokenUsageApiKeyRecord.user_id == user.id)
        .order_by(TokenUsageApiKeyRecord.created_at.desc()),
    ).all()
    return [to_api_key(record) for record in records]


@router.post("/keys", response_model=TokenUsageApiKeyCreateResponse)
async def create_key(
    request: TokenUsageApiKeyCreate,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> TokenUsageApiKeyCreateResponse:
    user = resolve_user(authorization, db)
    raw_key = f"4ev_tok_{secrets.token_urlsafe(28)}"
    record = TokenUsageApiKeyRecord(
        id=secrets.token_hex(12),
        user_id=user.id,
        name=request.name.strip() or "本机 CLI",
        prefix=raw_key[:14],
        key_hash=hash_usage_key(raw_key),
        raw_key=raw_key,
        status="active",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return TokenUsageApiKeyCreateResponse(key=to_api_key(record), raw_key=raw_key)


@router.get("/keys/{key_id}/reveal", response_model=TokenUsageApiKeyRevealResponse)
async def reveal_key(
    key_id: str,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> TokenUsageApiKeyRevealResponse:
    record = resolve_owned_key(key_id, authorization, db)
    return TokenUsageApiKeyRevealResponse(raw_key=record.raw_key)


@router.patch("/keys/{key_id}", response_model=TokenUsageApiKey)
async def update_key(
    key_id: str,
    request: TokenUsageApiKeyUpdate,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> TokenUsageApiKey:
    record = resolve_owned_key(key_id, authorization, db)
    if request.name is not None:
        record.name = request.name.strip()
    if request.status is not None:
        record.status = request.status
    db.commit()
    db.refresh(record)
    return to_api_key(record)


@router.post("/ingest", response_model=TokenUsageIngestResponse)
async def ingest_usage(
    request: TokenUsageIngestRequest,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> TokenUsageIngestResponse:
    api_key = resolve_usage_key(authorization, db)
    now = datetime.utcnow()
    api_key.last_used_at = now
    device_id = request.device.deviceId
    hostname = request.device.hostname

    bucket_count = 0
    for bucket in request.buckets:
      bucket_device_id = bucket.deviceId or device_id
      bucket_start = to_utc_naive(bucket.bucketStart)
      existing = db.scalar(
          select(TokenUsageBucketRecord).where(
              and_(
                  TokenUsageBucketRecord.user_id == api_key.user_id,
                  TokenUsageBucketRecord.api_key_id == api_key.id,
                  TokenUsageBucketRecord.device_id == bucket_device_id,
                  TokenUsageBucketRecord.source == bucket.source,
                  TokenUsageBucketRecord.model == (bucket.model or "unknown"),
                  TokenUsageBucketRecord.project_key == (bucket.projectKey or "unknown"),
                  TokenUsageBucketRecord.bucket_start == bucket_start,
              ),
          ),
      )
      total = bucket.totalTokens or (bucket.inputTokens + bucket.outputTokens + bucket.reasoningTokens + bucket.cachedTokens)
      values = {
          "api_key_id": api_key.id,
          "hostname": bucket.hostname or hostname,
          "project_label": bucket.projectLabel or bucket.projectKey or "unknown",
          "input_tokens": bucket.inputTokens,
          "output_tokens": bucket.outputTokens,
          "reasoning_tokens": bucket.reasoningTokens,
          "cached_tokens": bucket.cachedTokens,
          "total_tokens": total,
      }
      if existing:
          for key, value in values.items():
              setattr(existing, key, value)
      else:
          db.add(TokenUsageBucketRecord(
              user_id=api_key.user_id,
              device_id=bucket_device_id,
              source=bucket.source,
              model=bucket.model or "unknown",
              project_key=bucket.projectKey or "unknown",
              bucket_start=bucket_start,
              **values,
          ))
      bucket_count += 1

    session_count = 0
    for session in request.sessions:
      session_device_id = session.deviceId or device_id
      first_message_at = to_utc_naive(session.firstMessageAt)
      last_message_at = to_utc_naive(session.lastMessageAt)
      existing = db.scalar(
          select(TokenUsageSessionRecord).where(
              and_(
                  TokenUsageSessionRecord.user_id == api_key.user_id,
                  TokenUsageSessionRecord.api_key_id == api_key.id,
                  TokenUsageSessionRecord.device_id == session_device_id,
                  TokenUsageSessionRecord.source == session.source,
                  TokenUsageSessionRecord.session_hash == session.sessionHash,
              ),
          ),
      )
      total = session.totalTokens or (session.inputTokens + session.outputTokens + session.reasoningTokens + session.cachedTokens)
      values = {
          "api_key_id": api_key.id,
          "hostname": session.hostname or hostname,
          "project_key": session.projectKey or "unknown",
          "project_label": session.projectLabel or session.projectKey or "unknown",
          "first_message_at": first_message_at,
          "last_message_at": last_message_at,
          "duration_seconds": session.durationSeconds,
          "active_seconds": session.activeSeconds,
          "message_count": session.messageCount,
          "user_message_count": session.userMessageCount,
          "input_tokens": session.inputTokens,
          "output_tokens": session.outputTokens,
          "reasoning_tokens": session.reasoningTokens,
          "cached_tokens": session.cachedTokens,
          "total_tokens": total,
          "primary_model": session.primaryModel,
          "model_usages_json": json.dumps(session.modelUsages, ensure_ascii=True),
      }
      if existing:
          for key, value in values.items():
              setattr(existing, key, value)
      else:
          db.add(TokenUsageSessionRecord(
              user_id=api_key.user_id,
              device_id=session_device_id,
              source=session.source,
              session_hash=session.sessionHash,
              **values,
          ))
      session_count += 1

    db.commit()
    return TokenUsageIngestResponse(bucketCount=bucket_count, sessionCount=session_count, deviceId=device_id)


@router.get("/dashboard", response_model=TokenUsageDashboard)
async def dashboard(
    range: str = Query(default="30d", pattern="^(1d|7d|30d|all)$"),
    custom_start: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    custom_end: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> TokenUsageDashboard:
    user = resolve_user(authorization, db)
    start, end = usage_range(range, custom_start, custom_end)
    buckets = db.scalars(bucket_query(user.id, start, end).order_by(TokenUsageBucketRecord.bucket_start.asc())).all()
    sessions = db.scalars(session_query(user.id, start, end).order_by(TokenUsageSessionRecord.last_message_at.desc())).all()
    api_key_names = usage_key_names(user.id, db)
    last_synced = db.scalar(select(func.max(TokenUsageBucketRecord.updated_at)).where(TokenUsageBucketRecord.user_id == user.id))
    return TokenUsageDashboard(
        range=range,
        overview=build_overview(buckets, sessions),
        token_trend=build_trend(buckets, sessions),
        heatmap=build_heatmap(buckets, sessions, api_key_names),
        by_source=rank_buckets(buckets, "source", session_counts=rank_session_counts(sessions, "source")),
        by_model=rank_buckets(buckets, "model", session_counts=rank_model_session_counts(sessions)),
        by_project=rank_buckets(buckets, "project_key", label_attr="project_label", session_counts=rank_session_counts(sessions, "project_key")),
        devices=build_device_summaries(buckets, sessions),
        last_synced_at=last_synced,
    )


@router.get("/leaderboard", response_model=TokenUsageLeaderboard)
async def leaderboard(
    range: str = Query(default="30d", pattern="^(1d|7d|30d|all)$"),
    custom_start: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    custom_end: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> TokenUsageLeaderboard:
    resolve_user(authorization, db)
    start, end = usage_range(range, custom_start, custom_end)
    conditions = []
    if start is not None:
        conditions.append(TokenUsageBucketRecord.bucket_start >= start)
    if end is not None:
        conditions.append(TokenUsageBucketRecord.bucket_start <= end)
    total_expr = func.coalesce(func.sum(TokenUsageBucketRecord.total_tokens), 0)
    rows = db.execute(
        select(UserRecord.id, UserRecord.username, UserRecord.display_name, total_expr)
        .join(TokenUsageBucketRecord, TokenUsageBucketRecord.user_id == UserRecord.id)
        .where(*conditions)
        .group_by(UserRecord.id, UserRecord.username, UserRecord.display_name)
        .order_by(desc(total_expr))
        .limit(20),
    ).all()
    entries: list[TokenUsageLeaderboardEntry] = []
    for index, row in enumerate(rows, start=1):
        session_conditions = [TokenUsageSessionRecord.user_id == row[0]]
        if start is not None:
            session_conditions.append(TokenUsageSessionRecord.first_message_at >= start)
        if end is not None:
            session_conditions.append(TokenUsageSessionRecord.first_message_at <= end)
        active_seconds = db.scalar(select(func.coalesce(func.sum(TokenUsageSessionRecord.active_seconds), 0)).where(*session_conditions)) or 0
        sessions = db.scalar(select(func.count(TokenUsageSessionRecord.id)).where(*session_conditions)) or 0
        entries.append(TokenUsageLeaderboardEntry(rank=index, user_id=row[0], username=row[1], display_name=row[2], total_tokens=int(row[3] or 0), active_seconds=int(active_seconds), sessions=int(sessions)))
    return TokenUsageLeaderboard(entries=entries)


def hash_usage_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


def resolve_usage_key(authorization: Optional[str], db: Session) -> TokenUsageApiKeyRecord:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token usage API key.")
    raw_key = authorization.removeprefix("Bearer ").strip()
    api_key = db.scalar(select(TokenUsageApiKeyRecord).where(TokenUsageApiKeyRecord.key_hash == hash_usage_key(raw_key)))
    if not api_key or api_key.status != "active":
        raise HTTPException(status_code=401, detail="Invalid token usage API key.")
    return api_key


def resolve_owned_key(key_id: str, authorization: Optional[str], db: Session) -> TokenUsageApiKeyRecord:
    user = resolve_user(authorization, db)
    record = db.scalar(
        select(TokenUsageApiKeyRecord).where(
            and_(
                TokenUsageApiKeyRecord.id == key_id,
                TokenUsageApiKeyRecord.user_id == user.id,
            ),
        ),
    )
    if not record:
        raise HTTPException(status_code=404, detail="Token usage API key not found.")
    return record


def to_api_key(record: TokenUsageApiKeyRecord) -> TokenUsageApiKey:
    return TokenUsageApiKey(id=record.id, name=record.name, prefix=record.prefix, status=record.status, last_used_at=record.last_used_at, created_at=record.created_at)


def range_start(value: str) -> Optional[datetime]:
    start, _end = relative_display_range(value)
    return start


def relative_display_range(value: str) -> tuple[Optional[datetime], Optional[datetime]]:
    if value == "all":
        return None, None
    days_by_range = {"1d": 1, "7d": 7, "30d": 30}
    days = days_by_range.get(value)
    if not days:
        return None, None
    now_local = datetime.now(timezone.utc).astimezone(TOKEN_USAGE_DISPLAY_TZ)
    end_local = now_local.replace(hour=23, minute=59, second=59, microsecond=999999)
    start_local = end_local.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    return to_utc_naive(start_local), to_utc_naive(end_local)


def to_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def to_display_time(value: datetime) -> datetime:
    source = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return source.astimezone(TOKEN_USAGE_DISPLAY_TZ)


def parse_display_date_boundary(value: str, *, end: bool) -> datetime:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid custom range date.") from exc
    local = parsed.replace(tzinfo=TOKEN_USAGE_DISPLAY_TZ)
    if end:
        local = local.replace(hour=23, minute=59, second=59, microsecond=999999)
    return to_utc_naive(local)


def usage_range(value: str, custom_start: Optional[str], custom_end: Optional[str]) -> tuple[Optional[datetime], Optional[datetime]]:
    if custom_start or custom_end:
        if not custom_start or not custom_end:
            raise HTTPException(status_code=422, detail="Custom range requires both custom_start and custom_end.")
        start = parse_display_date_boundary(custom_start, end=False)
        end = parse_display_date_boundary(custom_end, end=True)
        if start > end:
            raise HTTPException(status_code=422, detail="custom_start cannot be later than custom_end.")
        if end > parse_display_date_boundary(custom_start, end=True) + timedelta(days=31 * 6):
            raise HTTPException(status_code=422, detail="Custom range cannot exceed 6 months.")
        return start, end
    return relative_display_range(value)


def bucket_query(user_id: str, start: Optional[datetime], end: Optional[datetime] = None):
    query = select(TokenUsageBucketRecord).where(TokenUsageBucketRecord.user_id == user_id)
    if start is not None:
        query = query.where(TokenUsageBucketRecord.bucket_start >= start)
    if end is not None:
        query = query.where(TokenUsageBucketRecord.bucket_start <= end)
    return query


def session_query(user_id: str, start: Optional[datetime], end: Optional[datetime] = None):
    query = select(TokenUsageSessionRecord).where(TokenUsageSessionRecord.user_id == user_id)
    if start is not None:
        query = query.where(TokenUsageSessionRecord.first_message_at >= start)
    if end is not None:
        query = query.where(TokenUsageSessionRecord.first_message_at <= end)
    return query


def usage_key_names(user_id: str, db: Session) -> dict[str, str]:
    records = db.scalars(select(TokenUsageApiKeyRecord).where(TokenUsageApiKeyRecord.user_id == user_id)).all()
    return {record.id: record.name for record in records}


def build_overview(buckets: list[TokenUsageBucketRecord], sessions: list[TokenUsageSessionRecord]) -> TokenUsageOverview:
    return TokenUsageOverview(
        input_tokens=sum(item.input_tokens for item in buckets),
        output_tokens=sum(item.output_tokens for item in buckets),
        reasoning_tokens=sum(item.reasoning_tokens for item in buckets),
        cached_tokens=sum(item.cached_tokens for item in buckets),
        total_tokens=sum(item.total_tokens for item in buckets),
        active_seconds=sum(item.active_seconds for item in sessions),
        sessions=len(sessions),
        messages=sum(item.message_count for item in sessions),
        devices=len({item.device_id for item in buckets}),
        sources=len({item.source for item in buckets}),
        projects=len({item.project_key for item in buckets}),
        models=len({item.model for item in buckets}),
    )


def build_trend(buckets: list[TokenUsageBucketRecord], sessions: list[TokenUsageSessionRecord]) -> list[TokenUsageTrendPoint]:
    by_day: dict[str, dict[str, int]] = defaultdict(lambda: {"total_tokens": 0, "active_seconds": 0, "sessions": 0})
    for bucket in buckets:
        key = to_display_time(bucket.bucket_start).date().isoformat()
        by_day[key]["total_tokens"] += bucket.total_tokens
    for session in sessions:
        key = to_display_time(session.first_message_at).date().isoformat()
        by_day[key]["active_seconds"] += session.active_seconds
        by_day[key]["sessions"] += 1
    return [TokenUsageTrendPoint(date=day, **values) for day, values in sorted(by_day.items())]


def build_heatmap(
    buckets: list[TokenUsageBucketRecord],
    sessions: list[TokenUsageSessionRecord],
    api_key_names: Optional[dict[str, str]] = None,
) -> list[TokenUsageHeatmapCell]:
    key_names = api_key_names or {}
    by_slot: dict[tuple[str, int], dict[str, object]] = defaultdict(lambda: {"total_tokens": 0, "active_seconds": 0, "key_tokens": Counter()})
    for bucket in buckets:
        local_time = to_display_time(bucket.bucket_start)
        key = (local_time.date().isoformat(), local_time.hour)
        by_slot[key]["total_tokens"] = int(by_slot[key]["total_tokens"]) + bucket.total_tokens
        key_id = bucket.api_key_id or "unknown"
        key_tokens = by_slot[key]["key_tokens"]
        if isinstance(key_tokens, Counter):
            key_tokens[key_id] += bucket.total_tokens
    for session in sessions:
        local_time = to_display_time(session.first_message_at)
        key = (local_time.date().isoformat(), local_time.hour)
        by_slot[key]["active_seconds"] = int(by_slot[key]["active_seconds"]) + session.active_seconds
    cells: list[TokenUsageHeatmapCell] = []
    for (day, hour), values in sorted(by_slot.items()):
        raw_key_tokens = values["key_tokens"]
        key_tokens = raw_key_tokens if isinstance(raw_key_tokens, Counter) else Counter()
        key_breakdown = [
            TokenUsageHeatmapKeyBreakdown(
                key_id=str(key_id),
                key_name=key_names.get(str(key_id), "未知 Key" if key_id == "unknown" else str(key_id)),
                total_tokens=int(total_tokens),
            )
            for key_id, total_tokens in sorted(key_tokens.items(), key=lambda item: (-int(item[1]), key_names.get(str(item[0]), str(item[0]))))
            if int(total_tokens) > 0
        ]
        cells.append(
            TokenUsageHeatmapCell(
                day=day,
                hour=hour,
                total_tokens=int(values["total_tokens"]),
                active_seconds=int(values["active_seconds"]),
                key_breakdown=key_breakdown,
            ),
        )
    return cells


def build_device_summaries(buckets: list[TokenUsageBucketRecord], sessions: list[TokenUsageSessionRecord]) -> list[TokenUsageDeviceSummary]:
    grouped: dict[str, dict[str, object]] = {}
    for bucket in buckets:
        current = grouped.setdefault(bucket.device_id, {"hostname": bucket.hostname, "total_tokens": 0, "active_seconds": 0, "sessions": 0, "sources": set(), "last_seen_at": None})
        if bucket.hostname:
            current["hostname"] = bucket.hostname
        current["total_tokens"] = int(current["total_tokens"]) + bucket.total_tokens
        current["sources"].add(bucket.source)  # type: ignore[union-attr]
        previous = current["last_seen_at"]
        if previous is None or bucket.bucket_start > previous:
            current["last_seen_at"] = bucket.bucket_start
    for session in sessions:
        current = grouped.setdefault(session.device_id, {"hostname": session.hostname, "total_tokens": 0, "active_seconds": 0, "sessions": 0, "sources": set(), "last_seen_at": None})
        if session.hostname:
            current["hostname"] = session.hostname
        current["active_seconds"] = int(current["active_seconds"]) + session.active_seconds
        current["sessions"] = int(current["sessions"]) + 1
        current["sources"].add(session.source)  # type: ignore[union-attr]
        previous = current["last_seen_at"]
        if previous is None or session.last_message_at > previous:
            current["last_seen_at"] = session.last_message_at
    devices = [
        TokenUsageDeviceSummary(
            device_id=device_id,
            hostname=str(values["hostname"] or ""),
            total_tokens=int(values["total_tokens"]),
            active_seconds=int(values["active_seconds"]),
            sessions=int(values["sessions"]),
            sources=len(values["sources"]),  # type: ignore[arg-type]
            last_seen_at=values["last_seen_at"],
        )
        for device_id, values in grouped.items()
    ]
    return sorted(devices, key=lambda item: ((item.last_seen_at.timestamp() if item.last_seen_at else 0), item.total_tokens), reverse=True)[:12]


def rank_buckets(
    buckets: list[TokenUsageBucketRecord],
    key_attr: str,
    label_attr: Optional[str] = None,
    session_counts: Optional[Counter[str]] = None,
) -> list[TokenUsageRankItem]:
    grouped: dict[str, dict[str, int | str]] = {}
    for bucket in buckets:
        key = str(getattr(bucket, key_attr) or "unknown")
        label = str(getattr(bucket, label_attr) if label_attr else key) if label_attr else key
        current = grouped.setdefault(key, {"label": label, "input_tokens": 0, "output_tokens": 0, "reasoning_tokens": 0, "cached_tokens": 0, "total_tokens": 0, "sessions": 0})
        current["input_tokens"] = int(current["input_tokens"]) + bucket.input_tokens
        current["output_tokens"] = int(current["output_tokens"]) + bucket.output_tokens
        current["reasoning_tokens"] = int(current["reasoning_tokens"]) + bucket.reasoning_tokens
        current["cached_tokens"] = int(current["cached_tokens"]) + bucket.cached_tokens
        current["total_tokens"] = int(current["total_tokens"]) + bucket.total_tokens
    if session_counts:
        for key, count in session_counts.items():
            if key in grouped:
                grouped[key]["sessions"] = count
    ranked = sorted(grouped.items(), key=lambda item: (-int(item[1]["total_tokens"]), str(item[1]["label"])))[:8]
    return [TokenUsageRankItem(key=key, label=str(value["label"]), input_tokens=int(value["input_tokens"]), output_tokens=int(value["output_tokens"]), reasoning_tokens=int(value["reasoning_tokens"]), cached_tokens=int(value["cached_tokens"]), total_tokens=int(value["total_tokens"]), sessions=int(value["sessions"])) for key, value in ranked]


def rank_session_counts(sessions: list[TokenUsageSessionRecord], key_attr: str) -> Counter[str]:
    return Counter(str(getattr(session, key_attr) or "unknown") for session in sessions)


def rank_model_session_counts(sessions: list[TokenUsageSessionRecord]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for session in sessions:
        models = set[str]()
        try:
            for usage in json.loads(session.model_usages_json or "[]"):
                model = str(usage.get("model") or "").strip()
                if model:
                    models.add(model)
        except (TypeError, ValueError, AttributeError):
            pass
        if not models and session.primary_model:
            models.add(session.primary_model)
        for model in models:
            counts[model] += 1
    return counts
