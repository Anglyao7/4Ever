import json
from dataclasses import dataclass
from os import getenv
from typing import Any

import httpx

from app.core.config import get_settings
from app.schemas.agents import McpServer


MCP_PROTOCOL_VERSION = "2025-06-18"


@dataclass(frozen=True)
class McpCallPlan:
    server_id: str
    server_name: str
    transport: str
    auth: str
    required_env: str
    configured: bool
    endpoint: str
    live_enabled: bool


def build_mcp_call_plan(server: McpServer) -> McpCallPlan:
    """Return redacted connection metadata for a future remote MCP tool call."""
    return McpCallPlan(
        server_id=server.id,
        server_name=server.name,
        transport=server.transport,
        auth=server.auth,
        required_env=server.required_env,
        configured=server.configured,
        endpoint=server.endpoint,
        live_enabled=server.live_enabled,
    )


async def call_mcp_tool(server: McpServer, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Call a backend-owned remote MCP server, or return a safe planned result.

    Live calls are gated behind BIGMODEL_MCP_LIVE because MCP tool calls can
    consume provider quota and depend on external network/service state.
    """
    plan = build_mcp_call_plan(server)
    if tool_name not in server.tool_names:
        return planned_result(plan, tool_name, arguments, f"Tool is not allowlisted for {server.id}.")
    if not plan.configured:
        return planned_result(plan, tool_name, arguments, f"{plan.required_env} is not configured.")
    if not plan.live_enabled:
        return planned_result(plan, tool_name, arguments, "BIGMODEL_MCP_LIVE is disabled.")

    api_key = getenv(plan.required_env, "").strip()
    if not api_key:
        return planned_result(plan, tool_name, arguments, f"{plan.required_env} is not configured.")

    settings = get_settings()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    }
    try:
        async with create_mcp_client(settings.mcp_timeout_seconds) as client:
            session_id = await initialize_session(client, server.endpoint, headers)
            if session_id:
                headers["Mcp-Session-Id"] = session_id
            await send_initialized(client, server.endpoint, headers)
            payload = await json_rpc(
                client,
                server.endpoint,
                headers,
                "tools/call",
                {"name": tool_name, "arguments": arguments},
            )
    except (httpx.HTTPError, ValueError) as exc:
        return {
            "server_id": plan.server_id,
            "server_name": plan.server_name,
            "tool_name": tool_name,
            "arguments": arguments,
            "configured": plan.configured,
            "live_enabled": plan.live_enabled,
            "status": "failed",
            "error": str(exc)[:600],
        }

    return {
        "server_id": plan.server_id,
        "server_name": plan.server_name,
        "tool_name": tool_name,
        "arguments": arguments,
        "configured": plan.configured,
        "live_enabled": plan.live_enabled,
        "status": "success",
        "result": redact_and_trim(payload, settings.mcp_result_max_chars),
    }


async def list_mcp_tools(server: McpServer) -> dict[str, Any]:
    plan = build_mcp_call_plan(server)
    if not plan.configured:
        return planned_result(plan, "tools/list", {}, f"{plan.required_env} is not configured.")
    if not plan.live_enabled:
        return planned_result(plan, "tools/list", {}, "BIGMODEL_MCP_LIVE is disabled.")

    api_key = getenv(plan.required_env, "").strip()
    settings = get_settings()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    }
    try:
        async with create_mcp_client(settings.mcp_timeout_seconds) as client:
            session_id = await initialize_session(client, server.endpoint, headers)
            if session_id:
                headers["Mcp-Session-Id"] = session_id
            await send_initialized(client, server.endpoint, headers)
            payload = await json_rpc(client, server.endpoint, headers, "tools/list", {})
    except (httpx.HTTPError, ValueError) as exc:
        return {
            "server_id": plan.server_id,
            "server_name": plan.server_name,
            "tool_name": "tools/list",
            "configured": plan.configured,
            "live_enabled": plan.live_enabled,
            "status": "failed",
            "error": str(exc)[:600],
        }

    return {
        "server_id": plan.server_id,
        "server_name": plan.server_name,
        "tool_name": "tools/list",
        "configured": plan.configured,
        "live_enabled": plan.live_enabled,
        "status": "success",
        "result": redact_and_trim(payload, settings.mcp_result_max_chars),
    }


async def initialize_session(client: httpx.AsyncClient, endpoint: str, headers: dict[str, str]) -> str:
    response = await client.post(
        endpoint,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": "initialize",
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "4Ever", "version": "0.1.0"},
            },
        },
    )
    raise_for_mcp_status(response)
    parse_mcp_payload(response)
    return response.headers.get("Mcp-Session-Id", "")


def create_mcp_client(timeout_seconds: int) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout_seconds)


async def send_initialized(client: httpx.AsyncClient, endpoint: str, headers: dict[str, str]) -> None:
    response = await client.post(
        endpoint,
        headers=headers,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
    )
    raise_for_mcp_status(response)


async def json_rpc(
    client: httpx.AsyncClient,
    endpoint: str,
    headers: dict[str, str],
    method: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    response = await client.post(
        endpoint,
        headers=headers,
        json={"jsonrpc": "2.0", "id": method, "method": method, "params": params},
    )
    raise_for_mcp_status(response)
    return parse_mcp_payload(response)


def raise_for_mcp_status(response: httpx.Response) -> None:
    if response.status_code >= 400:
        raise ValueError(f"MCP server returned HTTP {response.status_code}: {response.text[:600]}")


def parse_mcp_payload(response: httpx.Response) -> dict[str, Any]:
    content_type = response.headers.get("content-type", "")
    if "text/event-stream" in content_type:
        return parse_sse_payload(response.text)
    try:
        payload = response.json()
    except ValueError as exc:
        raise ValueError("MCP server returned a non-JSON response.") from exc
    return unwrap_json_rpc(payload)


def parse_sse_payload(text: str) -> dict[str, Any]:
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        data = line.removeprefix("data:").strip()
        if not data:
            continue
        try:
            return unwrap_json_rpc(json.loads(data))
        except json.JSONDecodeError as exc:
            raise ValueError("MCP server returned invalid SSE JSON.") from exc
    return {}


def unwrap_json_rpc(payload: dict[str, Any]) -> dict[str, Any]:
    if "error" in payload:
        raise ValueError(f"MCP JSON-RPC error: {payload['error']}")
    result = payload.get("result", payload)
    return result if isinstance(result, dict) else {"value": result}


def planned_result(plan: McpCallPlan, tool_name: str, arguments: dict[str, Any], reason: str) -> dict[str, Any]:
    return {
        "server_id": plan.server_id,
        "server_name": plan.server_name,
        "tool_name": tool_name,
        "arguments": arguments,
        "configured": plan.configured,
        "live_enabled": plan.live_enabled,
        "status": "planned",
        "reason": reason,
    }


def redact_and_trim(payload: dict[str, Any], max_chars: int) -> dict[str, Any]:
    text = json.dumps(payload, ensure_ascii=False, default=str)
    for key in ["authorization", "api_key", "token", "secret"]:
        text = text.replace(key, f"{key[:2]}***")
    if len(text) > max_chars:
        text = f"{text[:max_chars]}... [trimmed]"
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    except json.JSONDecodeError:
        return {"text": text}
