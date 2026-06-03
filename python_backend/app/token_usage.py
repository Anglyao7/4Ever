from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
import hashlib
import json
import secrets
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth import require_user
from app.database import Database, json_dumps, json_loads, now_iso, parse_time, row_to_dict


DISPLAY_TZ = timezone(timedelta(hours=8), "CST")


class APIKeyCreateRequest(BaseModel):
    name: str | None = None


class APIKeyUpdateRequest(BaseModel):
    name: str | None = None
    status: str | None = None


def router(db: Database) -> APIRouter:
    api = APIRouter(prefix="/api/token-usage")

    @api.get("/keys")
    def list_keys(request: Request) -> list[dict[str, Any]]:
        user = require_user(request, db)
        delete_disabled_usage_keys(db, user["id"])
        with db.connect() as conn:
            rows = conn.execute("SELECT * FROM token_usage_api_keys WHERE user_id = ? ORDER BY created_at DESC", (user["id"],)).fetchall()
        return [api_key_response(row_to_dict(row) or {}) for row in rows]

    @api.post("/keys")
    def create_key(request: Request, payload: APIKeyCreateRequest) -> dict[str, Any]:
        user = require_user(request, db)
        if payload.name is not None and len(payload.name) > 120:
            raise HTTPException(status_code=422, detail="name must be 120 characters or fewer.")
        raw_key = "4ev_tok_" + secrets.token_urlsafe(28)
        key_id = secrets.token_hex(12)
        name = (payload.name or "本机 CLI").strip() or "本机 CLI"
        now = now_iso()
        record = {
            "id": key_id,
            "user_id": user["id"],
            "name": name,
            "prefix": raw_key[:14],
            "key_hash": hash_usage_key(raw_key),
            "raw_key": raw_key,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO token_usage_api_keys (id, user_id, name, prefix, key_hash, raw_key, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
                """,
                (record["id"], record["user_id"], record["name"], record["prefix"], record["key_hash"], record["raw_key"], now, now),
            )
        return {"key": api_key_response(record), "raw_key": raw_key}

    @api.get("/keys/{key_id}/reveal")
    def reveal_key(request: Request, key_id: str) -> dict[str, Any]:
        record = resolve_owned_key(request, db, key_id)
        return {"raw_key": record.get("raw_key")}

    @api.patch("/keys/{key_id}")
    def update_key(request: Request, key_id: str, payload: APIKeyUpdateRequest) -> dict[str, Any]:
        record = resolve_owned_key(request, db, key_id)
        if payload.status is not None:
            status = payload.status.strip()
            if status not in {"active", "disabled"}:
                raise HTTPException(status_code=422, detail="status must be active or disabled")
            if status == "disabled":
                delete_usage_keys_with_data(db, [record])
                record["status"] = "disabled"
                return api_key_response(record)
            record["status"] = status
        if payload.name is not None:
            name = payload.name.strip()
            if not name or len(name) > 120:
                raise HTTPException(status_code=422, detail="name must be between 1 and 120 characters.")
            record["name"] = name
        record["updated_at"] = now_iso()
        with db.connect() as conn:
            conn.execute(
                "UPDATE token_usage_api_keys SET name = ?, status = ?, updated_at = ? WHERE id = ?",
                (record["name"], record["status"], record["updated_at"], record["id"]),
            )
        return api_key_response(record)

    @api.post("/ingest")
    async def ingest(request: Request) -> dict[str, Any]:
        api_key = resolve_usage_key(request, db)
        payload = await request.json()
        validate_ingest_payload(payload)
        now = now_iso()
        with db.connect() as conn:
            conn.execute("UPDATE token_usage_api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?", (now, now, api_key["id"]))
            device = payload.get("device") or {}
            bucket_count = 0
            for bucket in payload.get("buckets") or []:
                upsert_bucket(conn, api_key, device, bucket)
                bucket_count += 1
            session_count = 0
            for session in payload.get("sessions") or []:
                upsert_session(conn, api_key, device, session)
                session_count += 1
        return {"ok": True, "bucketCount": bucket_count, "sessionCount": session_count, "deviceId": str((payload.get("device") or {}).get("deviceId") or "")}

    @api.get("/dashboard")
    def dashboard(request: Request, range: str = "30d", custom_start: str = "", custom_end: str = "") -> dict[str, Any]:
        user = require_user(request, db)
        start, end = usage_range(range, custom_start, custom_end)
        delete_disabled_usage_keys(db, user["id"])
        with db.connect() as conn:
            buckets = [row_to_dict(row) or {} for row in conn.execute("SELECT * FROM token_usage_buckets WHERE user_id = ? ORDER BY bucket_start ASC", (user["id"],)).fetchall()]
            sessions = [row_to_dict(row) or {} for row in conn.execute("SELECT * FROM token_usage_sessions WHERE user_id = ? ORDER BY last_message_at DESC", (user["id"],)).fetchall()]
            keys = {row["id"]: row["name"] for row in conn.execute("SELECT id, name FROM token_usage_api_keys WHERE user_id = ?", (user["id"],)).fetchall()}
        buckets = [bucket for bucket in buckets if in_range(bucket.get("bucket_start"), start, end)]
        sessions = [session for session in sessions if in_range(session.get("first_message_at"), start, end)]
        last_synced = max((bucket.get("updated_at") for bucket in buckets if bucket.get("updated_at")), default=None)
        return {
            "range": range,
            "overview": build_overview(buckets, sessions),
            "token_trend": build_trend(buckets, sessions),
            "heatmap": build_heatmap(buckets, sessions, keys),
            "by_source": rank_items(buckets, sessions, "source"),
            "by_model": rank_items(buckets, sessions, "model"),
            "by_project": rank_items(buckets, sessions, "project_key"),
            "devices": build_devices(buckets, sessions),
            "last_synced_at": last_synced,
        }

    @api.get("/leaderboard")
    def leaderboard(request: Request, range: str = "30d", custom_start: str = "", custom_end: str = "") -> dict[str, Any]:
        require_user(request, db)
        start, end = usage_range(range, custom_start, custom_end)
        delete_disabled_usage_keys(db, "")
        with db.connect() as conn:
            users = [row_to_dict(row) or {} for row in conn.execute("SELECT id, username, display_name FROM users").fetchall()]
            buckets = [row_to_dict(row) or {} for row in conn.execute("SELECT * FROM token_usage_buckets").fetchall()]
            sessions = [row_to_dict(row) or {} for row in conn.execute("SELECT * FROM token_usage_sessions").fetchall()]
        buckets = [bucket for bucket in buckets if in_range(bucket.get("bucket_start"), start, end)]
        sessions = [session for session in sessions if in_range(session.get("first_message_at"), start, end)]
        by_user: dict[str, dict[str, int]] = defaultdict(lambda: {"tokens": 0, "active": 0, "sessions": 0})
        for bucket in buckets:
            by_user[str(bucket["user_id"])]["tokens"] += int(bucket.get("total_tokens") or 0)
        for session in sessions:
            row = by_user[str(session["user_id"])]
            row["active"] += int(session.get("active_seconds") or 0)
            row["sessions"] += 1
        user_map = {user["id"]: user for user in users}
        ranked = sorted(by_user.items(), key=lambda item: item[1]["tokens"], reverse=True)[:20]
        return {
            "entries": [
                {
                    "rank": index + 1,
                    "user_id": user_id,
                    "username": user_map.get(user_id, {}).get("username", ""),
                    "display_name": user_map.get(user_id, {}).get("display_name", ""),
                    "total_tokens": values["tokens"],
                    "active_seconds": values["active"],
                    "sessions": values["sessions"],
                }
                for index, (user_id, values) in enumerate(ranked)
            ]
        }

    return api


def api_key_response(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record["id"],
        "name": record["name"],
        "prefix": record["prefix"],
        "status": record.get("status") or "active",
        "last_used_at": record.get("last_used_at"),
        "created_at": record.get("created_at") or "",
    }


def resolve_owned_key(request: Request, db: Database, key_id: str) -> dict[str, Any]:
    user = require_user(request, db)
    with db.connect() as conn:
        record = row_to_dict(conn.execute("SELECT * FROM token_usage_api_keys WHERE id = ? AND user_id = ?", (key_id, user["id"])).fetchone())
    if not record:
        raise HTTPException(status_code=404, detail="Token usage API key not found.")
    return record


def resolve_usage_key(request: Request, db: Database) -> dict[str, Any]:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token usage API key.")
    raw_key = header.removeprefix("Bearer ").strip()
    with db.connect() as conn:
        record = row_to_dict(conn.execute("SELECT * FROM token_usage_api_keys WHERE key_hash = ?", (hash_usage_key(raw_key),)).fetchone())
    if not record or record.get("status") != "active":
        raise HTTPException(status_code=401, detail="Invalid token usage API key.")
    return record


def hash_usage_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def delete_disabled_usage_keys(db: Database, user_id: str) -> None:
    with db.connect() as conn:
        if user_id:
            rows = [row_to_dict(row) or {} for row in conn.execute("SELECT * FROM token_usage_api_keys WHERE user_id = ? AND status = 'disabled'", (user_id,)).fetchall()]
        else:
            rows = [row_to_dict(row) or {} for row in conn.execute("SELECT * FROM token_usage_api_keys WHERE status = 'disabled'").fetchall()]
    delete_usage_keys_with_data(db, rows)


def delete_usage_keys_with_data(db: Database, records: list[dict[str, Any]]) -> None:
    if not records:
        return
    ids = [record["id"] for record in records]
    placeholders = ",".join("?" for _ in ids)
    with db.connect() as conn:
        conn.execute(f"DELETE FROM token_usage_buckets WHERE api_key_id IN ({placeholders})", ids)
        conn.execute(f"DELETE FROM token_usage_sessions WHERE api_key_id IN ({placeholders})", ids)
        conn.execute(f"DELETE FROM token_usage_api_keys WHERE id IN ({placeholders})", ids)


def validate_ingest_payload(payload: dict[str, Any]) -> None:
    schema_version = payload.get("schemaVersion", 2)
    if schema_version != 2:
        raise HTTPException(status_code=422, detail="schemaVersion must be 2.")
    device = payload.get("device")
    if not isinstance(device, dict) or not str(device.get("deviceId") or "").strip():
        raise HTTPException(status_code=422, detail="deviceId is required.")
    buckets = payload.get("buckets") or []
    sessions = payload.get("sessions") or []
    if len(buckets) > 500:
        raise HTTPException(status_code=422, detail="buckets cannot contain more than 500 items.")
    if len(sessions) > 1000:
        raise HTTPException(status_code=422, detail="sessions cannot contain more than 1000 items.")
    for bucket in buckets:
        if any_int_negative(bucket, "inputTokens", "outputTokens", "reasoningTokens", "cachedTokens", "totalTokens"):
            raise HTTPException(status_code=422, detail="Token counts must be greater than or equal to 0.")
    for session in sessions:
        if any_int_negative(session, "durationSeconds", "activeSeconds", "messageCount", "userMessageCount", "inputTokens", "outputTokens", "reasoningTokens", "cachedTokens", "totalTokens"):
            raise HTTPException(status_code=422, detail="Session counters must be greater than or equal to 0.")


def any_int_negative(row: dict[str, Any], *keys: str) -> bool:
    return any(int(row.get(key) or 0) < 0 for key in keys)


def upsert_bucket(conn, api_key: dict[str, Any], device: dict[str, Any], bucket: dict[str, Any]) -> None:
    now = now_iso()
    device_id = str(bucket.get("deviceId") or device.get("deviceId") or "").strip()
    hostname = str(bucket.get("hostname") or device.get("hostname") or "").strip()
    model = default_string(bucket.get("model"), "unknown")
    project_key = default_string(bucket.get("projectKey"), "unknown")
    project_label = default_string(bucket.get("projectLabel"), project_key)
    total = int(bucket.get("totalTokens") or 0)
    input_tokens = int(bucket.get("inputTokens") or 0)
    output_tokens = int(bucket.get("outputTokens") or 0)
    reasoning_tokens = int(bucket.get("reasoningTokens") or 0)
    cached_tokens = int(bucket.get("cachedTokens") or 0)
    if total == 0:
        total = input_tokens + output_tokens + reasoning_tokens + cached_tokens
    bucket_start = normalize_time_text(bucket.get("bucketStart"))
    existing = conn.execute(
        """
        SELECT * FROM token_usage_buckets
        WHERE user_id = ? AND api_key_id = ? AND device_id = ? AND source = ? AND model = ? AND project_key = ? AND bucket_start = ?
        """,
        (api_key["user_id"], api_key["id"], device_id, bucket.get("source"), model, project_key, bucket_start),
    ).fetchone()
    values = (api_key["user_id"], api_key["id"], device_id, hostname, bucket.get("source"), model, project_key, project_label, bucket_start, input_tokens, output_tokens, reasoning_tokens, cached_tokens, total, now)
    if existing:
        conn.execute(
            """
            UPDATE token_usage_buckets
            SET hostname = ?, input_tokens = ?, output_tokens = ?, reasoning_tokens = ?, cached_tokens = ?, total_tokens = ?, project_label = ?, updated_at = ?
            WHERE id = ?
            """,
            (hostname, input_tokens, output_tokens, reasoning_tokens, cached_tokens, total, project_label, now, existing["id"]),
        )
    else:
        conn.execute(
            """
            INSERT INTO token_usage_buckets (
              user_id, api_key_id, device_id, hostname, source, model, project_key, project_label, bucket_start,
              input_tokens, output_tokens, reasoning_tokens, cached_tokens, total_tokens, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (*values, now),
        )


def upsert_session(conn, api_key: dict[str, Any], device: dict[str, Any], session: dict[str, Any]) -> None:
    now = now_iso()
    device_id = str(session.get("deviceId") or device.get("deviceId") or "").strip()
    hostname = str(session.get("hostname") or device.get("hostname") or "").strip()
    project_key = default_string(session.get("projectKey"), "unknown")
    project_label = default_string(session.get("projectLabel"), project_key)
    total = int(session.get("totalTokens") or 0)
    input_tokens = int(session.get("inputTokens") or 0)
    output_tokens = int(session.get("outputTokens") or 0)
    reasoning_tokens = int(session.get("reasoningTokens") or 0)
    cached_tokens = int(session.get("cachedTokens") or 0)
    if total == 0:
        total = input_tokens + output_tokens + reasoning_tokens + cached_tokens
    first_message_at = normalize_time_text(session.get("firstMessageAt"))
    last_message_at = normalize_time_text(session.get("lastMessageAt"))
    existing = conn.execute(
        "SELECT * FROM token_usage_sessions WHERE user_id = ? AND api_key_id = ? AND device_id = ? AND source = ? AND session_hash = ?",
        (api_key["user_id"], api_key["id"], device_id, session.get("source"), session.get("sessionHash")),
    ).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE token_usage_sessions
            SET hostname = ?, project_key = ?, project_label = ?, first_message_at = ?, last_message_at = ?,
                duration_seconds = ?, active_seconds = ?, message_count = ?, user_message_count = ?,
                input_tokens = ?, output_tokens = ?, reasoning_tokens = ?, cached_tokens = ?, total_tokens = ?,
                primary_model = ?, model_usages_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                hostname, project_key, project_label, first_message_at, last_message_at,
                int(session.get("durationSeconds") or 0), int(session.get("activeSeconds") or 0), int(session.get("messageCount") or 0), int(session.get("userMessageCount") or 0),
                input_tokens, output_tokens, reasoning_tokens, cached_tokens, total,
                str(session.get("primaryModel") or ""), json_dumps(session.get("modelUsages") or []), now, existing["id"],
            ),
        )
    else:
        conn.execute(
            """
            INSERT INTO token_usage_sessions (
              user_id, api_key_id, device_id, hostname, source, project_key, project_label, session_hash, first_message_at, last_message_at,
              duration_seconds, active_seconds, message_count, user_message_count, input_tokens, output_tokens, reasoning_tokens, cached_tokens,
              total_tokens, primary_model, model_usages_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                api_key["user_id"], api_key["id"], device_id, hostname, session.get("source"), project_key, project_label, session.get("sessionHash"), first_message_at, last_message_at,
                int(session.get("durationSeconds") or 0), int(session.get("activeSeconds") or 0), int(session.get("messageCount") or 0), int(session.get("userMessageCount") or 0),
                input_tokens, output_tokens, reasoning_tokens, cached_tokens, total, str(session.get("primaryModel") or ""), json_dumps(session.get("modelUsages") or []), now, now,
            ),
        )


def usage_range(value: str, custom_start: str, custom_end: str) -> tuple[datetime | None, datetime | None]:
    if custom_start or custom_end:
        if not custom_start or not custom_end:
            raise HTTPException(status_code=422, detail="Custom range requires both custom_start and custom_end.")
        try:
            start_date = datetime.strptime(custom_start, "%Y-%m-%d").date()
            end_date = datetime.strptime(custom_end, "%Y-%m-%d").date()
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Invalid custom range date.") from error
        start = datetime.combine(start_date, time.min, DISPLAY_TZ).astimezone(timezone.utc)
        end = datetime.combine(end_date, time.max, DISPLAY_TZ).astimezone(timezone.utc)
        if start > end:
            raise HTTPException(status_code=422, detail="custom_start cannot be later than custom_end.")
        if end > start + timedelta(days=184):
            raise HTTPException(status_code=422, detail="Custom range cannot exceed 6 months.")
        return start, end
    if value == "all":
        return None, None
    days = {"1d": 1, "7d": 7, "30d": 30}.get(value)
    if not days:
        raise HTTPException(status_code=422, detail="range must be 1d, 7d, 30d, or all.")
    now_local = datetime.now(timezone.utc).astimezone(DISPLAY_TZ)
    end = datetime.combine(now_local.date(), time.max, DISPLAY_TZ).astimezone(timezone.utc)
    start = (datetime.combine(now_local.date(), time.min, DISPLAY_TZ) - timedelta(days=days - 1)).astimezone(timezone.utc)
    return start, end


def in_range(value: Any, start: datetime | None, end: datetime | None) -> bool:
    parsed = parse_time(value)
    if not parsed:
        return False
    if start and parsed < start:
        return False
    if end and parsed > end:
        return False
    return True


def normalize_time_text(value: Any) -> str:
    parsed = parse_time(value)
    if not parsed:
        raise HTTPException(status_code=422, detail="Invalid timestamp.")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def local_day_hour(value: Any) -> tuple[str, int]:
    parsed = parse_time(value) or datetime.now(timezone.utc)
    local = parsed.astimezone(DISPLAY_TZ)
    return local.strftime("%Y-%m-%d"), local.hour


def build_overview(buckets: list[dict[str, Any]], sessions: list[dict[str, Any]]) -> dict[str, int]:
    devices, sources, projects, models = set(), set(), set(), set()
    overview = {"input_tokens": 0, "output_tokens": 0, "reasoning_tokens": 0, "cached_tokens": 0, "total_tokens": 0, "active_seconds": 0, "sessions": len(sessions), "messages": 0, "devices": 0, "sources": 0, "projects": 0, "models": 0}
    for bucket in buckets:
        overview["input_tokens"] += int(bucket.get("input_tokens") or 0)
        overview["output_tokens"] += int(bucket.get("output_tokens") or 0)
        overview["reasoning_tokens"] += int(bucket.get("reasoning_tokens") or 0)
        overview["cached_tokens"] += int(bucket.get("cached_tokens") or 0)
        overview["total_tokens"] += int(bucket.get("total_tokens") or 0)
        devices.add(bucket.get("device_id"))
        sources.add(bucket.get("source"))
        projects.add(bucket.get("project_key"))
        models.add(bucket.get("model"))
    for session in sessions:
        overview["active_seconds"] += int(session.get("active_seconds") or 0)
        overview["messages"] += int(session.get("message_count") or 0)
    overview["devices"], overview["sources"], overview["projects"], overview["models"] = len(devices), len(sources), len(projects), len(models)
    return overview


def build_trend(buckets: list[dict[str, Any]], sessions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, int]] = defaultdict(lambda: {"tokens": 0, "active": 0, "sessions": 0})
    for bucket in buckets:
        day, _ = local_day_hour(bucket.get("bucket_start"))
        grouped[day]["tokens"] += int(bucket.get("total_tokens") or 0)
    for session in sessions:
        day, _ = local_day_hour(session.get("first_message_at"))
        grouped[day]["active"] += int(session.get("active_seconds") or 0)
        grouped[day]["sessions"] += 1
    return [{"date": day, "total_tokens": row["tokens"], "active_seconds": row["active"], "sessions": row["sessions"]} for day, row in sorted(grouped.items())]


def build_heatmap(buckets: list[dict[str, Any]], sessions: list[dict[str, Any]], key_names: dict[str, str]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, int], dict[str, Any]] = defaultdict(lambda: {"tokens": 0, "active": 0, "keys": defaultdict(int)})
    for bucket in buckets:
        day, hour = local_day_hour(bucket.get("bucket_start"))
        row = grouped[(day, hour)]
        row["tokens"] += int(bucket.get("total_tokens") or 0)
        row["keys"][bucket.get("api_key_id") or "unknown"] += int(bucket.get("total_tokens") or 0)
    for session in sessions:
        day, hour = local_day_hour(session.get("first_message_at"))
        grouped[(day, hour)]["active"] += int(session.get("active_seconds") or 0)
    out = []
    for (day, hour), row in sorted(grouped.items()):
        breakdown = [{"key_id": key_id, "key_name": key_names.get(key_id) or ("未知 Key" if key_id == "unknown" else key_id), "total_tokens": total} for key_id, total in sorted(row["keys"].items(), key=lambda item: item[1], reverse=True) if total > 0]
        out.append({"day": day, "hour": hour, "total_tokens": row["tokens"], "active_seconds": row["active"], "key_breakdown": breakdown})
    return out


def rank_items(buckets: list[dict[str, Any]], sessions: list[dict[str, Any]], attr: str) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for bucket in buckets:
        key = str(bucket.get("source") or "")
        label = key
        if attr == "model":
            key = str(bucket.get("model") or "")
            label = key
        elif attr == "project_key":
            key = str(bucket.get("project_key") or "")
            label = str(bucket.get("project_label") or key)
        row = grouped.setdefault(key, {"key": key, "label": label, "total_tokens": 0, "input_tokens": 0, "output_tokens": 0, "reasoning_tokens": 0, "cached_tokens": 0, "sessions": 0})
        row["input_tokens"] += int(bucket.get("input_tokens") or 0)
        row["output_tokens"] += int(bucket.get("output_tokens") or 0)
        row["reasoning_tokens"] += int(bucket.get("reasoning_tokens") or 0)
        row["cached_tokens"] += int(bucket.get("cached_tokens") or 0)
        row["total_tokens"] += int(bucket.get("total_tokens") or 0)
    session_counts: dict[str, int] = defaultdict(int)
    for session in sessions:
        if attr == "model":
            for model in models_from_session(session):
                session_counts[model] += 1
        elif attr == "project_key":
            session_counts[str(session.get("project_key") or "")] += 1
        else:
            session_counts[str(session.get("source") or "")] += 1
    for key, count in session_counts.items():
        if key in grouped:
            grouped[key]["sessions"] = count
    return sorted(grouped.values(), key=lambda row: (-row["total_tokens"], row["label"]))[:8]


def build_devices(buckets: list[dict[str, Any]], sessions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = defaultdict(lambda: {"hostname": "", "tokens": 0, "active": 0, "sessions": 0, "sources": set(), "last": None})
    for bucket in buckets:
        row = grouped[str(bucket.get("device_id") or "")]
        row["hostname"] = bucket.get("hostname") or row["hostname"]
        row["tokens"] += int(bucket.get("total_tokens") or 0)
        row["sources"].add(bucket.get("source"))
        row["last"] = max_time(row["last"], bucket.get("bucket_start"))
    for session in sessions:
        row = grouped[str(session.get("device_id") or "")]
        row["hostname"] = session.get("hostname") or row["hostname"]
        row["active"] += int(session.get("active_seconds") or 0)
        row["sessions"] += 1
        row["sources"].add(session.get("source"))
        row["last"] = max_time(row["last"], session.get("last_message_at"))
    out = [
        {"device_id": device_id, "hostname": row["hostname"], "total_tokens": row["tokens"], "active_seconds": row["active"], "sessions": row["sessions"], "sources": len(row["sources"]), "last_seen_at": row["last"]}
        for device_id, row in grouped.items()
    ]
    return sorted(out, key=lambda row: (row["last_seen_at"] or "", row["total_tokens"]), reverse=True)[:12]


def models_from_session(session: dict[str, Any]) -> list[str]:
    seen = {str(item.get("model")) for item in json_loads(session.get("model_usages_json"), []) if isinstance(item, dict) and item.get("model")}
    if not seen and session.get("primary_model"):
        seen.add(str(session["primary_model"]))
    return sorted(seen)


def max_time(left: Any, right: Any) -> str | None:
    ldt, rdt = parse_time(left), parse_time(right)
    if not ldt:
        return normalize_time_text(right) if right else None
    if not rdt:
        return normalize_time_text(left) if left else None
    return (ldt if ldt >= rdt else rdt).isoformat().replace("+00:00", "Z")


def default_string(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    return text or fallback
