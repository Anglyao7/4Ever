from __future__ import annotations

import asyncio
import json
import os
import time
from collections.abc import Mapping
from dataclasses import replace
from typing import Any

from app.agents.catalog import MCP_SERVERS, configured_mcp_server
from app.agents.mcp import arguments_for_tool, call_mcp_tool, list_mcp_tools
from app.config import Settings, load_settings
from app.database import Database
from app.providers import ChatCompletionRequest, _stream_provider, chat_event_secret_key, redact_sensitive_text


PROVIDER_SMOKES: dict[str, dict[str, str]] = {
    "openai": {
        "credential_env": "OPENAI_API_KEY",
        "base_url_env": "OPENAI_BASE_URL",
        "model_env": "OPENAI_MODEL",
        "default_model": "gpt-4.1-mini",
    },
    "anthropic": {
        "credential_env": "ANTHROPIC_API_KEY",
        "base_url_env": "ANTHROPIC_BASE_URL",
        "model_env": "ANTHROPIC_MODEL",
        "default_model": "claude-sonnet-4-20250514",
    },
    "gemini": {
        "credential_env": "GEMINI_API_KEY",
        "base_url_env": "GEMINI_BASE_URL",
        "model_env": "GEMINI_MODEL",
        "default_model": "gemini-2.5-flash",
    },
}

DEFAULT_SMOKE_PROMPT = "Reply with exactly OK."


async def run_ai_runtime_smoke(settings: Settings | None = None, environ: Mapping[str, str] | None = None, database: Database | None = None) -> dict[str, Any]:
    env = environ if environ is not None else os.environ
    active_settings = smoke_settings(settings or load_settings(), env)
    started = time.monotonic()
    provider_results = []
    for provider in selected_provider_ids(env):
        provider_results.append(await run_provider_stream_smoke(active_settings, provider, env))
    mcp_results = run_mcp_smokes(active_settings, env, database)
    results = [*provider_results, *mcp_results]
    payload = {
        "status": aggregate_smoke_status(results),
        "summary": smoke_summary(results),
        "providers": provider_results,
        "mcp": mcp_results,
        "duration_ms": elapsed_ms(started),
    }
    return sanitize_smoke_output(payload)


async def run_provider_stream_smoke(settings: Settings, provider: str, environ: Mapping[str, str]) -> dict[str, Any]:
    provider = provider.strip().lower()
    config = PROVIDER_SMOKES.get(provider)
    if not config:
        return {"target": "provider:stream", "provider": provider, "status": "skipped", "reason": "Unknown provider smoke target."}
    credential_env = config["credential_env"]
    credential = env_value(environ, credential_env)
    model = env_value(environ, config["model_env"]) or config["default_model"]
    base_url = env_value(environ, config["base_url_env"])
    base = {
        "target": "provider:stream",
        "provider": provider,
        "model": model,
        "credential_env": credential_env,
        "base_url_configured": bool(base_url),
    }
    if not credential:
        return {**base, "status": "skipped", "reason": f"{credential_env} is not configured."}
    prompt = env_value(environ, "AI_RUNTIME_SMOKE_PROMPT") or DEFAULT_SMOKE_PROMPT
    payload = ChatCompletionRequest(
        provider=provider,
        base_url=base_url or None,
        api_key=credential,
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
        max_tokens=16,
    )
    event_count = 0
    chunk_count = 0
    content_chars = 0
    usage_seen = False
    started = time.monotonic()
    try:
        async for event in _stream_provider(settings, provider, payload):
            if not isinstance(event, dict):
                continue
            event_count += 1
            if event.get("event") == "message:chunk":
                chunk_count += 1
                data = event.get("data") if isinstance(event.get("data"), dict) else {}
                content_chars += len(str(data.get("content") or ""))
            elif event.get("event") == "token:usage":
                usage_seen = True
    except Exception as error:
        return {**base, "status": "failed", "error": str(error), "duration_ms": elapsed_ms(started)}
    if content_chars <= 0:
        return {
            **base,
            "status": "failed",
            "error": "Provider stream ended without content chunks.",
            "event_count": event_count,
            "chunk_count": chunk_count,
            "usage_seen": usage_seen,
            "duration_ms": elapsed_ms(started),
        }
    return {
        **base,
        "status": "success",
        "event_count": event_count,
        "chunk_count": chunk_count,
        "content_chars": content_chars,
        "usage_seen": usage_seen,
        "duration_ms": elapsed_ms(started),
    }


def run_mcp_smokes(settings: Settings, environ: Mapping[str, str], database: Database | None = None) -> list[dict[str, Any]]:
    credential = env_value(environ, "BIGMODEL_API_KEY")
    if not credential:
        return [
            {
                "target": "mcp",
                "provider": "bigmodel",
                "credential_env": "BIGMODEL_API_KEY",
                "status": "skipped",
                "reason": "BIGMODEL_API_KEY is not configured.",
            }
        ]
    if not settings.bigmodel_mcp_live:
        return [
            {
                "target": "mcp",
                "provider": "bigmodel",
                "credential_env": "BIGMODEL_API_KEY",
                "status": "skipped",
                "reason": "BIGMODEL_MCP_LIVE is disabled.",
            }
        ]
    results = []
    for server_id in selected_mcp_server_ids(environ):
        results.append(run_mcp_tools_list_smoke(settings, server_id, database))
    for spec in parse_mcp_tool_call_specs(environ):
        if spec.get("status") == "failed":
            results.append(spec)
            continue
        results.append(run_mcp_tool_call_smoke(settings, spec["server_id"], spec["tool_name"], spec["source"], database))
    return results


def run_mcp_tools_list_smoke(settings: Settings, server_id: str, database: Database | None = None) -> dict[str, Any]:
    started = time.monotonic()
    server = configured_mcp_server(server_id, settings, database)
    base = {"target": "mcp:tools/list", "server_id": server_id, "provider": "bigmodel"}
    if not server:
        return {**base, "status": "skipped", "reason": "Unknown MCP server id."}
    result = list_mcp_tools(server, settings, database)
    status = str(result.get("status") or "failed")
    if status == "success":
        body = result.get("result") if isinstance(result.get("result"), dict) else {}
        tools = body.get("tools") if isinstance(body.get("tools"), list) else []
        return {
            **base,
            "status": "success",
            "tool_count": len(tools),
            "tool_names": [str(item.get("name") or "") for item in tools[:12] if isinstance(item, dict) and item.get("name")],
            "duration_ms": elapsed_ms(started),
        }
    if status == "planned":
        return {**base, "status": "skipped", "reason": str(result.get("reason") or "MCP tools/list was not executed."), "duration_ms": elapsed_ms(started)}
    return {**base, "status": "failed", "error": str(result.get("error") or "MCP tools/list failed."), "duration_ms": elapsed_ms(started)}


def run_mcp_tool_call_smoke(settings: Settings, server_id: str, tool_name: str, source: str, database: Database | None = None) -> dict[str, Any]:
    started = time.monotonic()
    server = configured_mcp_server(server_id, settings, database)
    base = {"target": "mcp:tools/call", "server_id": server_id, "tool_name": tool_name, "provider": "bigmodel"}
    if not server:
        return {**base, "status": "skipped", "reason": "Unknown MCP server id."}
    arguments = arguments_for_tool(tool_name, source)
    result = call_mcp_tool(server, tool_name, arguments, settings)
    status = str(result.get("status") or "failed")
    if status == "success":
        body = result.get("result") if isinstance(result.get("result"), dict) else {}
        return {
            **base,
            "status": "success",
            "argument_keys": sorted(arguments.keys()),
            "result_summary": summarize_mcp_result(body),
            "duration_ms": elapsed_ms(started),
        }
    if status == "planned":
        return {**base, "status": "skipped", "reason": str(result.get("reason") or "MCP tool call was not executed."), "duration_ms": elapsed_ms(started)}
    return {
        **base,
        "status": "failed",
        "argument_keys": sorted(arguments.keys()),
        "error": str(result.get("error") or "MCP tool call failed."),
        "duration_ms": elapsed_ms(started),
    }


def sanitize_smoke_output(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            out[key_text] = "[redacted]" if chat_event_secret_key(key_text) else sanitize_smoke_output(item)
        return out
    if isinstance(value, list):
        return [sanitize_smoke_output(item) for item in value]
    if isinstance(value, str):
        return redact_sensitive_text(value)
    return value


def smoke_settings(settings: Settings, environ: Mapping[str, str]) -> Settings:
    ai_timeout = float_env(environ, "AI_RUNTIME_SMOKE_TIMEOUT_SECONDS", settings.ai_timeout_seconds)
    mcp_timeout = float_env(environ, "AI_RUNTIME_SMOKE_MCP_TIMEOUT_SECONDS", settings.mcp_timeout_seconds)
    return replace(settings, ai_timeout_seconds=ai_timeout, mcp_timeout_seconds=mcp_timeout)


def selected_provider_ids(environ: Mapping[str, str]) -> list[str]:
    return csv_values(environ.get("AI_RUNTIME_SMOKE_PROVIDERS")) or list(PROVIDER_SMOKES.keys())


def selected_mcp_server_ids(environ: Mapping[str, str]) -> list[str]:
    return csv_values(environ.get("AI_RUNTIME_SMOKE_MCP_SERVERS")) or [server.id for server in MCP_SERVERS]


def parse_mcp_tool_call_specs(environ: Mapping[str, str]) -> list[dict[str, Any]]:
    specs = []
    raw = str(environ.get("AI_RUNTIME_SMOKE_MCP_TOOL_CALLS") or "").strip()
    if not raw:
        return specs
    for index, item in enumerate(raw.split(";"), start=1):
        item = item.strip()
        if not item:
            continue
        parts = [part.strip() for part in item.split("|", 2)]
        if len(parts) < 2 or not parts[0] or not parts[1]:
            specs.append({"target": "mcp:tools/call", "status": "failed", "error": f"Invalid MCP tool call spec at position {index}."})
            continue
        specs.append({"server_id": parts[0], "tool_name": parts[1], "source": parts[2] if len(parts) > 2 else DEFAULT_SMOKE_PROMPT})
    return specs


def summarize_mcp_result(payload: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {"result_keys": sorted(str(key) for key in payload.keys())[:12]}
    content = payload.get("content")
    if isinstance(content, list):
        summary["content_item_count"] = len(content)
        summary["content_types"] = sorted({str(item.get("type") or "") for item in content if isinstance(item, dict) and item.get("type")})[:8]
    tools = payload.get("tools")
    if isinstance(tools, list):
        summary["tool_count"] = len(tools)
    return summary


def aggregate_smoke_status(results: list[dict[str, Any]]) -> str:
    statuses = [str(item.get("status") or "") for item in results]
    if any(status == "failed" for status in statuses):
        return "failed"
    if any(status == "success" for status in statuses):
        return "success"
    return "skipped"


def smoke_summary(results: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "total": len(results),
        "success": sum(1 for item in results if item.get("status") == "success"),
        "skipped": sum(1 for item in results if item.get("status") == "skipped"),
        "failed": sum(1 for item in results if item.get("status") == "failed"),
    }


def csv_values(value: str | None) -> list[str]:
    return [item.strip().lower() for item in str(value or "").split(",") if item.strip()]


def env_value(environ: Mapping[str, str], name: str) -> str:
    return str(environ.get(name) or "").strip()


def float_env(environ: Mapping[str, str], name: str, default: float) -> float:
    raw = env_value(environ, name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def elapsed_ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def main() -> int:
    result = asyncio.run(run_ai_runtime_smoke())
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 1 if result.get("status") == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
