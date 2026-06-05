from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

from app.config import Settings


MCP_PROTOCOL_VERSION = "2025-06-18"


def list_mcp_tools(server: dict[str, Any], settings: Settings) -> dict[str, Any]:
    if not server.get("configured"):
        return planned_mcp_result(server, "tools/list", {}, f"{server['required_env']} is not configured.")
    if not server.get("live_enabled"):
        return planned_mcp_result(server, "tools/list", {}, "BIGMODEL_MCP_LIVE is disabled.")
    try:
        result = mcp_json_rpc(server, "tools/list", {}, settings)
    except Exception as error:
        return {"status": "failed", "error": _truncate(str(error), 600)}
    return {"status": "success", "result": redact_and_trim(result, settings.mcp_result_max_chars)}


def call_mcp_tool(server: dict[str, Any], tool_name: str, arguments: dict[str, Any] | None, settings: Settings) -> dict[str, Any]:
    arguments = arguments or {}
    if tool_name not in (server.get("tool_names") or []):
        return planned_mcp_result(server, tool_name, arguments, f"Tool is not allowlisted for {server['id']}.")
    if not server.get("configured"):
        return planned_mcp_result(server, tool_name, arguments, f"{server['required_env']} is not configured.")
    if not server.get("live_enabled"):
        return planned_mcp_result(server, tool_name, arguments, "BIGMODEL_MCP_LIVE is disabled.")
    try:
        result = mcp_json_rpc(server, "tools/call", {"name": tool_name, "arguments": arguments}, settings)
    except Exception as error:
        return {"status": "failed", "tool_name": tool_name, "arguments": arguments, "error": _truncate(str(error), 600)}
    return {
        "status": "success",
        "tool_name": tool_name,
        "arguments": arguments,
        "result": redact_and_trim(result, settings.mcp_result_max_chars),
    }


def planned_mcp_result(server: dict[str, Any], tool_name: str, arguments: dict[str, Any], reason: str) -> dict[str, Any]:
    return {
        "server_id": server["id"],
        "server_name": server["name"],
        "tool_name": tool_name,
        "arguments": arguments,
        "configured": bool(server.get("configured")),
        "live_enabled": bool(server.get("live_enabled")),
        "status": "planned",
        "reason": reason,
    }


def mcp_json_rpc(server: dict[str, Any], method: str, params: dict[str, Any], settings: Settings) -> dict[str, Any]:
    api_key = os.getenv(str(server["required_env"]), "").strip()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    }
    initialize = _mcp_post(
        str(server["endpoint"]),
        headers,
        {
            "jsonrpc": "2.0",
            "id": "initialize",
            "method": "initialize",
            "params": {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "4Ever", "version": "0.1.0"},
            },
        },
        settings,
    )
    session_id = initialize.get("_session_id")
    if session_id:
        headers["Mcp-Session-Id"] = str(session_id)
    try:
        _mcp_post(str(server["endpoint"]), headers, {"jsonrpc": "2.0", "method": "notifications/initialized"}, settings)
    except Exception:
        pass
    return _mcp_post(
        str(server["endpoint"]),
        headers,
        {"jsonrpc": "2.0", "id": method, "method": method, "params": params},
        settings,
    )


def tool_names_from_result(result: dict[str, Any], fallback: list[str]) -> list[str]:
    if result.get("status") != "success":
        return fallback
    body = result.get("result") if isinstance(result.get("result"), dict) else {}
    tools = body.get("tools") if isinstance(body, dict) else []
    names = [str(item.get("name")) for item in tools if isinstance(item, dict) and item.get("name")]
    return names or fallback


def select_mcp_server_for_node(node: dict[str, Any], servers: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not servers:
        return None
    node_id = str(node.get("node_id") or "")
    graph_step = str(node.get("graph_step") or "")
    haystack = f"{node_id} {graph_step}".lower()
    if any(marker in haystack for marker in ("repo", "structure", "read_file", "search_doc")):
        found = _find_server(servers, "bigmodel-zread")
        if found:
            return found
    if "reader" in haystack or "mcp_read" in haystack:
        found = _find_server(servers, "bigmodel-web-reader")
        if found:
            return found
    if "search" in haystack:
        found = _find_server(servers, "bigmodel-web-search")
        if found:
            return found
    return servers[0]


def tool_for_node(node: dict[str, Any], server: dict[str, Any]) -> str:
    server_id = str(server.get("id") or "")
    node_id = str(node.get("node_id") or "")
    graph_step = str(node.get("graph_step") or "")
    haystack = f"{node_id} {graph_step}".lower()
    if server_id == "bigmodel-web-search":
        return "webSearchPrime"
    if server_id == "bigmodel-web-reader":
        return "webReader"
    if server_id == "bigmodel-zread":
        if "structure" in haystack or "repo_structure" in haystack:
            return "get_repo_structure"
        if "file" in haystack or "read" in haystack:
            return "read_file"
        return "search_doc"
    tool_names = list(server.get("tool_names") or [])
    return str(tool_names[0]) if tool_names else graph_step or node_id


def arguments_for_tool(tool_name: str, source: str) -> dict[str, Any]:
    if tool_name == "webSearchPrime":
        return {"query": source}
    if tool_name == "webReader":
        return {"url": first_url(source) or source}
    if tool_name == "search_doc":
        return {"query": source, **zread_repo_arguments(source)}
    if tool_name == "get_repo_structure":
        return zread_repo_arguments(source)
    if tool_name == "read_file":
        return {**zread_repo_arguments(source), "file_path": zread_file_path(source)}
    return {"input": source}


def render_mcp_output(server: dict[str, Any], tool_name: str, result: dict[str, Any]) -> str:
    status = str(result.get("status") or "planned")
    prefix = "调用 " if status == "success" else "计划调用 "
    lines = [
        prefix + str(server.get("name") or server.get("id")),
        "Tool: " + tool_name,
        "Transport: " + str(server.get("transport") or ""),
        "Auth: " + str(server.get("auth") or "") + " via " + str(server.get("required_env") or ""),
        "Configured: " + _yes_no(bool(server.get("configured"))),
        "Live enabled: " + _yes_no(bool(server.get("live_enabled"))),
        "Endpoint: " + str(server.get("endpoint") or ""),
    ]
    if status == "planned":
        lines.append("Reason: " + str(result.get("reason") or "not executed"))
    elif status == "failed":
        lines.append("Error: " + str(result.get("error") or "MCP call failed"))
    else:
        lines.extend(["Result:", json.dumps(result.get("result") or {}, ensure_ascii=False, separators=(",", ":"))])
    return "\n".join(lines)


def redact_and_trim(payload: dict[str, Any], max_chars: int) -> dict[str, Any]:
    max_chars = max(max_chars or 3000, 1)
    redacted = _redact(payload)
    text = json.dumps(redacted, ensure_ascii=False, separators=(",", ":"))
    if len(text) <= max_chars:
        return redacted if isinstance(redacted, dict) else {"value": redacted}
    trimmed = text[:max_chars] + "... [trimmed]"
    try:
        parsed = json.loads(trimmed)
    except json.JSONDecodeError:
        return {"text": trimmed}
    return parsed if isinstance(parsed, dict) else {"value": parsed}


def parse_mcp_payload(content_type: str, data: bytes) -> dict[str, Any]:
    if "text/event-stream" in content_type.lower():
        for line in data.decode("utf-8", errors="replace").splitlines():
            if not line.startswith("data:"):
                continue
            raw = line.removeprefix("data:").strip()
            if raw:
                return unwrap_json_rpc(raw.encode("utf-8"))
        return {}
    return unwrap_json_rpc(data)


def unwrap_json_rpc(data: bytes) -> dict[str, Any]:
    try:
        payload = json.loads(data.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise RuntimeError("MCP server returned a non-JSON response") from error
    if isinstance(payload, dict) and payload.get("error") is not None:
        raise RuntimeError(f"MCP JSON-RPC error: {payload['error']}")
    if isinstance(payload, dict) and "result" in payload:
        result = payload["result"]
        return result if isinstance(result, dict) else {"value": result}
    return payload if isinstance(payload, dict) else {"value": payload}


def first_url(text: str) -> str:
    for part in text.split():
        if part.startswith(("http://", "https://")):
            return part.strip(".,，。)")
    return ""


def zread_repo_arguments(source: str) -> dict[str, Any]:
    repo = first_repo_reference(source)
    return {"repo": repo} if repo else {"query": source}


def first_repo_reference(text: str) -> str:
    for part in text.replace("\n", " ").split():
        cleaned = part.strip(".,，。)>")
        if "github.com/" in cleaned:
            return cleaned.removeprefix("https://github.com/").removeprefix("http://github.com/")
        if cleaned.count("/") == 1 and not cleaned.startswith(("http://", "https://")):
            return cleaned
    return ""


def zread_file_path(text: str) -> str:
    for marker in ("file:", "path:", "文件：", "路径："):
        if marker not in text:
            continue
        rest = text.split(marker, 1)[1].strip()
        if rest:
            return rest.split()[0].strip(".,，。)")
    for part in text.replace("\n", " ").split():
        cleaned = part.strip(".,，。)")
        if "/" in cleaned and "." in cleaned and "github.com" not in cleaned:
            return cleaned
    return "README.md"


def _mcp_post(endpoint: str, headers: dict[str, str], payload: dict[str, Any], settings: Settings) -> dict[str, Any]:
    response = httpx.post(endpoint, headers=headers, json=payload, timeout=settings.mcp_timeout_seconds)
    if response.status_code >= 400:
        raise RuntimeError(f"MCP server returned HTTP {response.status_code}: {_truncate(response.text, 600)}")
    result = parse_mcp_payload(response.headers.get("content-type", ""), response.content)
    session_id = response.headers.get("Mcp-Session-Id")
    if session_id:
        result["_session_id"] = session_id
    return result


def _find_server(servers: list[dict[str, Any]], server_id: str) -> dict[str, Any] | None:
    return next((server for server in servers if server.get("id") == server_id), None)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if _secret_key(str(key)):
                out[key] = "[redacted]"
            else:
                out[key] = _redact(item)
        return out
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def _secret_key(key: str) -> bool:
    return bool(re.search(r"(authorization|api[_-]?key|token|secret|password)", key, re.IGNORECASE))


def _truncate(value: str, limit: int) -> str:
    return value if len(value) <= limit else value[:limit] + "... [trimmed]"


def _yes_no(value: bool) -> str:
    return "yes" if value else "no"
