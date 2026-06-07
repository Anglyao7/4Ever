from __future__ import annotations

import asyncio
import json
from typing import Any

from app.config import Settings
from app.runtime_smoke import run_ai_runtime_smoke, run_mcp_smokes, sanitize_smoke_output


def test_runtime_smoke_skips_when_external_credentials_are_missing():
    result = asyncio.run(run_ai_runtime_smoke(Settings(), environ={}))

    assert result["status"] == "skipped"
    assert result["summary"]["success"] == 0
    assert result["summary"]["failed"] == 0
    assert result["summary"]["skipped"] == 4
    assert {item["provider"] for item in result["providers"]} == {"openai", "anthropic", "gemini"}
    assert result["mcp"][0]["status"] == "skipped"


def test_runtime_smoke_sanitizes_secret_like_text_and_data_urls():
    payload = {
        "api_key": "sk-live-secret",
        "credential_env": "OPENAI_API_KEY",
        "nested": {
            "Authorization": "Bearer leaked-token",
            "message": "token=abc123 data:image/png;base64,AAAA",
        },
        "items": [{"password": "plain-password"}],
    }

    clean = sanitize_smoke_output(payload)
    dump = json.dumps(clean, ensure_ascii=False)

    assert clean["api_key"] == "[redacted]"
    assert clean["credential_env"] == "OPENAI_API_KEY"
    assert clean["nested"]["Authorization"] == "[redacted]"
    assert clean["items"][0]["password"] == "[redacted]"
    assert "leaked-token" not in dump
    assert "abc123" not in dump
    assert "data:image/png;base64" not in dump


def test_runtime_smoke_provider_success_does_not_emit_prompt_or_response(monkeypatch):
    async def fake_stream_provider(settings: Settings, provider: str, payload: Any):
        assert provider == "openai"
        assert payload.api_key == "real-secret-key"
        assert payload.messages[0]["content"] == "do not expose this prompt"
        yield {"event": "message:chunk", "data": {"content": "do not expose this response"}}
        yield {"event": "token:usage", "data": {"usage": {"prompt_tokens": 1}}}

    monkeypatch.setattr("app.runtime_smoke._stream_provider", fake_stream_provider)

    result = asyncio.run(
        run_ai_runtime_smoke(
            Settings(),
            environ={
                "AI_RUNTIME_SMOKE_PROVIDERS": "openai",
                "OPENAI_API_KEY": "real-secret-key",
                "OPENAI_MODEL": "smoke-model",
                "AI_RUNTIME_SMOKE_PROMPT": "do not expose this prompt",
            },
        )
    )
    dump = json.dumps(result, ensure_ascii=False)

    assert result["status"] == "success"
    assert result["providers"][0]["status"] == "success"
    assert result["providers"][0]["content_chars"] == len("do not expose this response")
    assert "real-secret-key" not in dump
    assert "do not expose this prompt" not in dump
    assert "do not expose this response" not in dump


def test_mcp_smoke_skips_when_live_flag_is_disabled_without_leaking_key():
    result = run_mcp_smokes(Settings(bigmodel_mcp_live=False), environ={"BIGMODEL_API_KEY": "bigmodel-secret"})
    dump = json.dumps(result, ensure_ascii=False)

    assert result == [
        {
            "target": "mcp",
            "provider": "bigmodel",
            "credential_env": "BIGMODEL_API_KEY",
            "status": "skipped",
            "reason": "BIGMODEL_MCP_LIVE is disabled.",
        }
    ]
    assert "bigmodel-secret" not in dump
