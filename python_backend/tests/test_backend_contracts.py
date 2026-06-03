from __future__ import annotations

from datetime import datetime, timezone
import uuid

from fastapi.testclient import TestClient

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
