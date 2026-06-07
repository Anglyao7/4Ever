from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import uuid

from fastapi.testclient import TestClient

from app import admin
from app.config import Settings
from app.database import Database
from app.database import now_iso
from app.main import app, database


client = TestClient(app)


def create_user(prefix: str):
    suffix = uuid.uuid4().hex[:10]
    response = client.post(
        "/api/auth/sign-up",
        json={
            "username": f"{prefix}-{suffix}",
            "email": f"{prefix}-{suffix}@example.com",
            "password": "password123",
            "display_name": prefix.title(),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_auth_modules_and_admin_contract():
    auth = create_user("admin")
    token = auth["token"]
    assert auth["user"]["role"] == "member"
    with database.connect() as conn:
        conn.execute("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?", (now_iso(), auth["user"]["id"]))

    modules = client.get("/api/modules", headers={"Authorization": f"Bearer {token}"}).json()
    assert any(module["id"] == "chat" for module in modules)

    overview = client.get("/api/admin/overview", headers={"Authorization": f"Bearer {token}"})
    assert overview.status_code == 200
    assert overview.json()["user_count"] >= 1

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["role"] == "admin"


def test_admin_readiness_requires_admin_and_reports_checks():
    admin_auth = create_user("ready-admin")
    member_auth = create_user("ready-member")
    with database.connect() as conn:
        conn.execute("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?", (now_iso(), admin_auth["user"]["id"]))
        conn.execute("UPDATE users SET role = 'member', updated_at = ? WHERE id = ?", (now_iso(), member_auth["user"]["id"]))

    missing = client.get("/api/admin/readiness")
    assert missing.status_code == 401

    forbidden = client.get("/api/admin/readiness", headers={"Authorization": f"Bearer {member_auth['token']}"})
    assert forbidden.status_code == 403

    response = client.get("/api/admin/readiness", headers={"Authorization": f"Bearer {admin_auth['token']}"})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] in {"ok", "warning", "error"}
    check_ids = {check["id"] for check in data["checks"]}
    assert {"database", "model_profile_encryption_key", "chat_attachment_url_secret", "private_media_root", "document_fts5", "bigmodel_mcp", "legacy_global_model_profiles"} <= check_ids


def test_readiness_report_warns_without_stable_local_secrets(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
    )
    settings.media_root.mkdir(parents=True)
    settings.private_media_root.mkdir(parents=True)
    db = Database(settings)
    db.migrate()

    report = admin.readiness_report(db, settings)
    by_id = {check["id"]: check for check in report["checks"]}

    assert report["status"] == "warning"
    assert by_id["database"]["status"] == "ok"
    assert by_id["private_media_root"]["status"] == "ok"
    assert by_id["model_profile_encryption_key"]["status"] == "warning"
    assert by_id["model_profile_encryption_key"]["configured"] is False
    assert by_id["chat_attachment_url_secret"]["status"] == "warning"
    assert by_id["chat_attachment_url_secret"]["configured"] is False
    assert by_id["legacy_global_model_profiles"]["status"] == "warning"
    assert by_id["legacy_global_model_profiles"]["enabled"] is True


def test_readiness_report_does_not_leak_secret_values(tmp_path, monkeypatch):
    model_secret = "do-not-leak-model-secret"
    url_secret = "do-not-leak-url-secret"
    bigmodel_secret = "do-not-leak-bigmodel-key"
    monkeypatch.setenv("BIGMODEL_API_KEY", bigmodel_secret)
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
        model_profile_encryption_key=model_secret,
        chat_attachment_url_secret=url_secret,
        bigmodel_mcp_live=True,
        allow_legacy_global_model_profiles=False,
    )
    settings.media_root.mkdir(parents=True)
    settings.private_media_root.mkdir(parents=True)
    db = Database(settings)
    db.migrate()

    report = admin.readiness_report(db, settings)
    encoded = json.dumps(report, ensure_ascii=False)
    by_id = {check["id"]: check for check in report["checks"]}

    assert by_id["model_profile_encryption_key"]["status"] == "ok"
    assert by_id["chat_attachment_url_secret"]["status"] == "ok"
    assert by_id["bigmodel_mcp"]["status"] == "ok"
    assert by_id["legacy_global_model_profiles"]["status"] == "ok"
    assert by_id["legacy_global_model_profiles"]["enabled"] is False
    assert model_secret not in encoded
    assert url_secret not in encoded
    assert bigmodel_secret not in encoded


def test_password_minimum_is_six_characters():
    suffix = uuid.uuid4().hex[:10]
    accepted = client.post(
        "/api/auth/sign-up",
        json={
            "username": f"six-{suffix}",
            "email": f"six-{suffix}@example.com",
            "password": "123456",
            "display_name": "Six",
        },
    )
    assert accepted.status_code == 200, accepted.text

    rejected = client.post(
        "/api/auth/sign-up",
        json={
            "username": f"five-{suffix}",
            "email": f"five-{suffix}@example.com",
            "password": "12345",
            "display_name": "Five",
        },
    )
    assert rejected.status_code == 422
    assert "between 6 and 128" in rejected.json()["detail"]

    token = accepted.json()["token"]
    changed = client.post(
        "/api/auth/password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": "123456", "new_password": "abcdef"},
    )
    assert changed.status_code == 200, changed.text

    too_short = client.post(
        "/api/auth/password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": "abcdef", "new_password": "abcde"},
    )
    assert too_short.status_code == 422
    assert "between 6 and 128" in too_short.json()["detail"]


def test_friend_request_direct_message_contract():
    left = create_user("left")
    right = create_user("right")
    left_token = left["token"]
    right_token = right["token"]
    right_id = right["user"]["id"]

    request = client.post(f"/api/chat/friends/request/{right_id}", headers={"Authorization": f"Bearer {left_token}"})
    assert request.status_code == 200, request.text
    request_id = request.json()["id"]

    accepted = client.post(f"/api/chat/friends/requests/{request_id}/accept", headers={"Authorization": f"Bearer {right_token}"})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"

    message = client.post(
        f"/api/chat/direct/{right_id}",
        headers={"Authorization": f"Bearer {left_token}"},
        json={"content": "hello", "attachments": []},
    )
    assert message.status_code == 200, message.text
    assert message.json()["content"] == "hello"

    thread = client.get(f"/api/chat/direct/{right_id}", headers={"Authorization": f"Bearer {left_token}"})
    assert thread.status_code == 200
    assert thread.json()[-1]["content"] == "hello"


def test_token_usage_key_ingest_dashboard_contract():
    auth = create_user("usage")
    token = auth["token"]
    created = client.post("/api/token-usage/keys", headers={"Authorization": f"Bearer {token}"}, json={"name": "Local CLI"})
    assert created.status_code == 200, created.text
    raw_key = created.json()["raw_key"]

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    ingest = client.post(
        "/api/token-usage/ingest",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={
            "schemaVersion": 2,
            "device": {"deviceId": "dev-1", "hostname": "workstation"},
            "buckets": [
                {
                    "source": "codex",
                    "model": "gpt-test",
                    "projectKey": "4ever",
                    "projectLabel": "4Ever",
                    "bucketStart": now,
                    "inputTokens": 10,
                    "outputTokens": 5,
                    "reasoningTokens": 2,
                    "cachedTokens": 1,
                }
            ],
            "sessions": [
                {
                    "source": "codex",
                    "projectKey": "4ever",
                    "projectLabel": "4Ever",
                    "sessionHash": "session-1",
                    "firstMessageAt": now,
                    "lastMessageAt": now,
                    "activeSeconds": 30,
                    "messageCount": 2,
                    "inputTokens": 10,
                    "outputTokens": 5,
                    "primaryModel": "gpt-test",
                    "modelUsages": [{"model": "gpt-test"}],
                }
            ],
        },
    )
    assert ingest.status_code == 200, ingest.text
    assert ingest.json()["bucketCount"] == 1

    dashboard = client.get("/api/token-usage/dashboard?range=all", headers={"Authorization": f"Bearer {token}"})
    assert dashboard.status_code == 200, dashboard.text
    data = dashboard.json()
    assert data["overview"]["total_tokens"] >= 18
    assert data["overview"]["sessions"] >= 1


def test_token_usage_leaderboard_all_means_last_six_months():
    recent = create_user("rank-recent")
    old = create_user("rank-old")
    recent_key = client.post("/api/token-usage/keys", headers={"Authorization": f"Bearer {recent['token']}"}, json={"name": "Recent"}).json()["raw_key"]
    old_key = client.post("/api/token-usage/keys", headers={"Authorization": f"Bearer {old['token']}"}, json={"name": "Old"}).json()["raw_key"]

    now = datetime.now(timezone.utc)
    old_day = now - timedelta(days=220)
    cutoff = now - timedelta(days=184)
    with database.connect() as conn:
        current_max = conn.execute(
            "SELECT COALESCE(MAX(total_tokens), 0) AS total FROM token_usage_buckets WHERE bucket_start >= ?",
            (cutoff.isoformat().replace("+00:00", "Z"),),
        ).fetchone()["total"]
    recent_total = int(current_max or 0) + 9_000_000_000
    old_total = recent_total + 9_000_000_000
    for raw_key, stamp, total in [(recent_key, now, recent_total), (old_key, old_day, old_total)]:
        ingest = client.post(
            "/api/token-usage/ingest",
            headers={"Authorization": f"Bearer {raw_key}"},
            json={
                "schemaVersion": 2,
                "device": {"deviceId": f"rank-{total}", "hostname": "workstation"},
                "buckets": [
                    {
                        "source": "codex",
                        "model": "gpt-test",
                        "projectKey": "4ever",
                        "projectLabel": "4Ever",
                        "bucketStart": stamp.isoformat().replace("+00:00", "Z"),
                        "totalTokens": total,
                    }
                ],
                "sessions": [],
            },
        )
        assert ingest.status_code == 200, ingest.text

    leaderboard = client.get("/api/token-usage/leaderboard?range=all", headers={"Authorization": f"Bearer {recent['token']}"})
    assert leaderboard.status_code == 200, leaderboard.text
    ids = {entry["user_id"] for entry in leaderboard.json()["entries"]}
    assert recent["user"]["id"] in ids
    assert old["user"]["id"] not in ids
