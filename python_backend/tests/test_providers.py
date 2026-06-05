from __future__ import annotations

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.config import Settings
from app.database import Database
from app.providers import ChatCompletionRequest, parse_openai_stream_line, resolve_chat_request, router, sse_event


def test_openai_stream_delta_becomes_chat_event():
    event = parse_openai_stream_line('data: {"choices":[{"delta":{"content":"你好"}}]}')

    assert event == {"event": "message:chunk", "data": {"content": "你好"}}


def test_sse_event_uses_named_event_and_json_data():
    event = sse_event("message:chunk", {"content": "hello"})

    assert event == 'event: message:chunk\ndata: {"content":"hello"}\n\n'


def test_model_profile_sync_persists_runtime_capabilities(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(router(settings, database))
    client = TestClient(app)

    response = client.put(
        "/api/catalog/model-profiles",
        json={
            "active_profile_id": "profile-main",
            "profiles": [
                {
                    "id": "profile-main",
                    "name": "Main API",
                    "provider": "openai",
                    "base_url": "https://api.example.com",
                    "api_key": "sk-test",
                    "model": "gpt-4o-mini",
                    "system_prompt": "Be concise.",
                    "temperature": 0.4,
                    "max_tokens": 2048,
                    "supports_vision": True,
                    "fallback_model": "gpt-4.1-mini",
                    "persona": {"alias": "Main", "role": "助手", "temperament": "直接", "notes": ""},
                    "pet": {"name": "小火花", "species": "spark"},
                }
            ],
        },
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["active_profile_id"] == "profile-main"
    profile = data["profiles"][0]
    assert profile["provider"] == "openai"
    assert profile["base_url"] == "https://api.example.com/v1"
    assert profile["supports_vision"] is True
    assert profile["fallback_model"] == "gpt-4.1-mini"
    assert profile["is_active"] is True


def test_profile_id_resolves_backend_owned_chat_runtime(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(router(settings, database))
    client = TestClient(app)

    response = client.put(
        "/api/catalog/model-profiles",
        json={
            "active_profile_id": "profile-main",
            "profiles": [
                {
                    "id": "profile-main",
                    "name": "Main API",
                    "provider": "openai",
                    "base_url": "https://api.example.com",
                    "api_key": "sk-backend",
                    "model": "gpt-4o-mini",
                    "system_prompt": "Be concise.",
                    "temperature": 0.4,
                    "max_tokens": 2048,
                    "supports_vision": True,
                    "fallback_model": "gpt-4.1-mini",
                    "persona": {"alias": "Main", "role": "助手", "temperament": "直接", "notes": "只回答必要内容"},
                }
            ],
        },
    )
    assert response.status_code == 200, response.text

    resolved = resolve_chat_request(
        database,
        ChatCompletionRequest(
            profile_id="profile-main",
            provider="gemini",
            base_url="https://front.example.com",
            api_key="front-key",
            model="front-model",
            system_prompt="联系人上下文",
            temperature=1.9,
            max_tokens=77,
            supports_vision=False,
            fallback_model="front-fallback",
            messages=[
                {"role": "system", "content": "frontend override"},
                {"role": "user", "content": "你好"},
            ],
        ),
    )

    assert resolved.provider == "openai"
    assert resolved.base_url == "https://api.example.com/v1"
    assert resolved.api_key == "sk-backend"
    assert resolved.model == "gpt-4o-mini"
    assert resolved.temperature == 0.4
    assert resolved.max_tokens == 2048
    assert resolved.supports_vision is True
    assert resolved.fallback_model == "gpt-4.1-mini"
    assert resolved.messages == [{"role": "user", "content": "你好"}]
    assert "你正在以“Main”" in (resolved.system_prompt or "")
    assert "角色定位：助手" in (resolved.system_prompt or "")
    assert "系统要求：Be concise." in (resolved.system_prompt or "")
    assert "客户端联系人上下文：联系人上下文" in (resolved.system_prompt or "")
    assert "frontend override" not in (resolved.system_prompt or "")


def test_disabled_profile_is_rejected_for_chat_runtime(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(router(settings, database))
    client = TestClient(app)

    response = client.put(
        "/api/catalog/model-profiles",
        json={
            "active_profile_id": "",
            "profiles": [
                {
                    "id": "disabled-profile",
                    "name": "Disabled",
                    "provider": "openai",
                    "base_url": "https://api.example.com",
                    "api_key": "sk-backend",
                    "model": "gpt-4.1-mini",
                    "enabled": False,
                }
            ],
        },
    )
    assert response.status_code == 200, response.text

    with pytest.raises(HTTPException) as error:
        resolve_chat_request(
            database,
            ChatCompletionRequest(
                profile_id="disabled-profile",
                model="front-model",
                messages=[{"role": "user", "content": "hello"}],
            ),
        )

    assert error.value.status_code == 403
    assert error.value.detail == "Model profile is disabled."
