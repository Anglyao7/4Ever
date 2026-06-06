from __future__ import annotations

import asyncio
import base64
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import admin, auth
from app.agents.mcp import call_mcp_tool, list_mcp_tools, load_mcp_tool_schema_cache, store_mcp_tool_schema_cache
from app.config import Settings
from app.database import Database, now_iso
from app.providers import (
    ChatCompletionRequest,
    _stream_provider,
    anthropic_mcp_tool_definitions,
    build_chat_provider_request,
    chat_mcp_tool_definitions,
    create_chat_run,
    emit_chat_event,
    gemini_mcp_tool_definitions,
    parse_anthropic_stream_line,
    parse_gemini_stream_line,
    parse_openai_stream_line,
    recall_chat_document_chunks,
    resolve_chat_request,
    router,
    sign_chat_attachment_url,
    source_citation_check_payload,
    sse_event,
    store_chat_document_chunks,
)


def sse_data_payloads(text: str) -> list[dict]:
    payloads = []
    for line in text.splitlines():
        if line.startswith("data: "):
            payloads.append(json.loads(line.removeprefix("data: ")))
    return payloads


class LocalStreamingProvider:
    def __init__(self, routes: dict[str, dict[str, Any]]):
        self.routes = routes
        self.records: list[dict[str, Any]] = []
        self.server: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None

    def __enter__(self):
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                parent.records.append({"method": "GET", "path": self.path, "headers": {key.lower(): value for key, value in self.headers.items()}, "json": {}})
                self._write_route()

            def do_POST(self):
                raw_body = self.rfile.read(int(self.headers.get("Content-Length", "0") or 0))
                try:
                    json_body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                except json.JSONDecodeError:
                    json_body = {}
                parent.records.append({"method": "POST", "path": self.path, "headers": {key.lower(): value for key, value in self.headers.items()}, "json": json_body})
                self._write_route()

            def _write_route(self):
                route = parent.routes.get(self.path) or parent.routes.get(self.path.split("?", 1)[0])
                if not route:
                    self.send_response(404)
                    self.end_headers()
                    return
                body = str(route.get("body") or "").encode("utf-8")
                self.send_response(int(route.get("status", 200)))
                self.send_header("Content-Type", str(route.get("content_type") or "text/event-stream"))
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format, *args):
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        if self.thread:
            self.thread.join(timeout=2)

    @property
    def base_url(self) -> str:
        if not self.server:
            raise RuntimeError("Local streaming provider is not running.")
        host, port = self.server.server_address
        return f"http://{host}:{port}"


class LocalMcpJsonRpcServer:
    def __init__(self, tool_result: dict[str, Any] | None = None, stream_tool_result: bool = False, error_method: str = "", error_body: str = "", error_status: int = 500):
        self.tool_result = tool_result or {"content": [{"type": "text", "text": "MCP ok"}]}
        self.stream_tool_result = stream_tool_result
        self.error_method = error_method
        self.error_body = error_body
        self.error_status = error_status
        self.records: list[dict[str, Any]] = []
        self.server: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None

    def __enter__(self):
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                raw_body = self.rfile.read(int(self.headers.get("Content-Length", "0") or 0))
                try:
                    json_body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                except json.JSONDecodeError:
                    json_body = {}
                method = str(json_body.get("method") or "")
                parent.records.append({"path": self.path, "headers": {key.lower(): value for key, value in self.headers.items()}, "json": json_body})
                if parent.error_method and method == parent.error_method:
                    self._write_text(parent.error_body, status=parent.error_status)
                    return
                if method == "initialize":
                    payload = {"jsonrpc": "2.0", "id": json_body.get("id"), "result": {"protocolVersion": "2025-06-18", "serverInfo": {"name": "local-mcp"}}}
                    self._write_json(payload, {"Mcp-Session-Id": "local-session-1"})
                elif method == "notifications/initialized":
                    self._write_json({"jsonrpc": "2.0", "result": {}})
                elif method == "tools/list":
                    self._write_json({"jsonrpc": "2.0", "id": json_body.get("id"), "result": mcp_tools_list_payload()})
                elif method == "tools/call":
                    payload = {"jsonrpc": "2.0", "id": json_body.get("id"), "result": parent.tool_result}
                    if parent.stream_tool_result:
                        self._write_sse(payload)
                    else:
                        self._write_json(payload)
                else:
                    self._write_json({"jsonrpc": "2.0", "error": {"code": -32601, "message": "method not found"}}, status=400)

            def _write_json(self, payload: dict[str, Any], headers: dict[str, str] | None = None, status: int = 200):
                body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                for key, value in (headers or {}).items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(body)

            def _write_sse(self, payload: dict[str, Any]):
                body = ("data: " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n\n").encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _write_text(self, text: str, status: int = 500):
                body = text.encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format, *args):
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        if self.thread:
            self.thread.join(timeout=2)

    @property
    def endpoint(self) -> str:
        if not self.server:
            raise RuntimeError("Local MCP JSON-RPC server is not running.")
        host, port = self.server.server_address
        return f"http://{host}:{port}/mcp"


async def collect_provider_stream_events(settings: Settings, provider: str, payload: ChatCompletionRequest) -> list[dict[str, Any]]:
    events = []
    async for event in _stream_provider(settings, provider, payload):
        events.append(event)
    return events


def test_openai_stream_delta_becomes_chat_event():
    event = parse_openai_stream_line('data: {"choices":[{"delta":{"content":"你好"}}]}')

    assert event == {"event": "message:chunk", "data": {"content": "你好"}}


def test_anthropic_stream_delta_becomes_chat_event():
    event = parse_anthropic_stream_line('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}')

    assert event == {"event": "message:chunk", "data": {"content": "hello"}}


def test_gemini_stream_delta_becomes_chat_event():
    event = parse_gemini_stream_line('data: {"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}')

    assert event == {"event": "message:chunk", "data": {"content": "hello"}}


def test_sse_event_uses_named_event_and_json_data():
    event = sse_event("message:chunk", {"content": "hello"})

    assert event == 'event: message:chunk\ndata: {"content":"hello"}\n\n'


def test_openai_native_streaming_uses_http_sse_contract(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    body = "\n\n".join(
        [
            'data: {"choices":[{"delta":{"content":"mock openai"}}]}',
            'data: {"choices":[{"delta":{"content":" stream"}}]}',
            'data: {"usage":{"total_tokens":7},"choices":[]}',
            "data: [DONE]",
        ]
    )
    with LocalStreamingProvider({"/v1/chat/completions": {"body": body}}) as server:
        payload = ChatCompletionRequest(
            provider="openai",
            base_url=server.base_url,
            api_key="sk-openai",
            model="gpt-4o-mini",
            system_prompt="System prompt",
            messages=[{"role": "user", "content": "hello"}],
        )
        events = asyncio.run(collect_provider_stream_events(settings, "openai", payload))

    chunks = [event["data"]["content"] for event in events if event["event"] == "message:chunk"]
    assert chunks == ["mock openai", " stream"]
    assert [event["data"]["usage"]["total_tokens"] for event in events if event["event"] == "token:usage"] == [7]
    request = server.records[0]
    assert request["path"] == "/v1/chat/completions"
    assert request["headers"]["authorization"] == "Bearer sk-openai"
    assert request["json"]["stream"] is True
    assert request["json"]["messages"][0] == {"role": "system", "content": "System prompt"}
    assert request["json"]["messages"][1] == {"role": "user", "content": "hello"}


def test_anthropic_native_streaming_uses_http_sse_contract(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    body = "\n\n".join(
        [
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"mock anthropic"}}',
            'data: {"type":"message_delta","usage":{"output_tokens":5}}',
            "data: [DONE]",
        ]
    )
    with LocalStreamingProvider({"/messages": {"body": body}}) as server:
        payload = ChatCompletionRequest(
            provider="anthropic",
            base_url=server.base_url,
            api_key="sk-anthropic",
            model="claude-3-5-sonnet",
            system_prompt="System prompt",
            messages=[{"role": "user", "content": "hello"}],
        )
        events = asyncio.run(collect_provider_stream_events(settings, "anthropic", payload))

    assert [event["data"]["content"] for event in events if event["event"] == "message:chunk"] == ["mock anthropic"]
    assert [event["data"]["usage"]["output_tokens"] for event in events if event["event"] == "token:usage"] == [5]
    request = server.records[0]
    assert request["path"] == "/messages"
    assert request["headers"]["x-api-key"] == "sk-anthropic"
    assert request["headers"]["anthropic-version"] == "2023-06-01"
    assert request["json"]["stream"] is True
    assert request["json"]["system"] == "System prompt"
    assert request["json"]["messages"] == [{"role": "user", "content": "hello"}]


def test_gemini_native_streaming_uses_http_sse_contract(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    body = "\n\n".join(
        [
            'data: {"candidates":[{"content":{"parts":[{"text":"mock gemini"}]}}]}',
            'data: {"usageMetadata":{"totalTokenCount":9}}',
            "data: [DONE]",
        ]
    )
    route = "/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
    with LocalStreamingProvider({route: {"body": body}}) as server:
        payload = ChatCompletionRequest(
            provider="gemini",
            base_url=server.base_url,
            api_key="sk-gemini",
            model="gemini-2.5-flash",
            system_prompt="System prompt",
            messages=[{"role": "user", "content": "hello"}],
        )
        events = asyncio.run(collect_provider_stream_events(settings, "gemini", payload))

    assert [event["data"]["content"] for event in events if event["event"] == "message:chunk"] == ["mock gemini"]
    assert [event["data"]["usage"]["totalTokenCount"] for event in events if event["event"] == "token:usage"] == [9]
    request = server.records[0]
    assert request["path"] == route
    assert request["headers"]["x-goog-api-key"] == "sk-gemini"
    assert "stream" not in request["json"]
    assert request["json"]["systemInstruction"] == {"parts": [{"text": "System prompt"}]}
    assert request["json"]["contents"] == [{"role": "user", "parts": [{"text": "hello"}]}]


def test_provider_stream_http_error_is_redacted_in_live_sse_and_replay(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", model_profile_encryption_key="test-secret")
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    auth_payload = sign_up(client, "http-error")
    headers = {"Authorization": f"Bearer {auth_payload['token']}"}
    error_body = 'provider 500 api_key="SECRET_PROVIDER_KEY" Authorization: Bearer SECRET_PROVIDER_BEARER data:image/png;base64,SECRET_PROVIDER_IMAGE ' + ("provider body " * 200)

    with LocalStreamingProvider({"/v1/chat/completions": {"status": 500, "content_type": "text/plain", "body": error_body}}) as server:
        profile = client.put(
            "/api/catalog/model-profiles",
            headers=headers,
            json={
                "active_profile_id": "profile-main",
                "profiles": [
                    {
                        "id": "profile-main",
                        "name": "Main",
                        "provider": "openai",
                        "base_url": server.base_url,
                        "api_key": "sk-run",
                        "model": "gpt-4o-mini",
                    }
                ],
            },
        )
        assert profile.status_code == 200, profile.text
        stream = client.post(
            "/api/chat/stream",
            headers=headers,
            json={"profile_id": "profile-main", "messages": [{"role": "user", "content": "触发 HTTP 错误"}]},
        )

    assert stream.status_code == 200, stream.text
    assert "event: run:error" in stream.text
    assert "SECRET_PROVIDER_KEY" not in stream.text
    assert "SECRET_PROVIDER_BEARER" not in stream.text
    assert "SECRET_PROVIDER_IMAGE" not in stream.text
    live_error = [payload for payload in sse_data_payloads(stream.text) if payload.get("message")][0]
    assert "[redacted]" in live_error["message"]
    assert "[redacted data URL]" in live_error["message"]
    assert live_error["message"].endswith("... [trimmed]")

    run = client.get("/api/chat/runs", headers=headers).json()["runs"][0]
    replay = client.get(f"/api/chat/runs/{run['id']}/events", headers=headers)
    assert replay.status_code == 200, replay.text
    assert "SECRET_PROVIDER_KEY" not in replay.text
    assert "SECRET_PROVIDER_BEARER" not in replay.text
    assert "SECRET_PROVIDER_IMAGE" not in replay.text
    replay_error = [payload for payload in sse_data_payloads(replay.text) if payload.get("message")][0]
    assert replay_error == live_error


def test_provider_models_http_error_redacts_response_body(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    app = FastAPI()
    app.include_router(router(settings))
    client = TestClient(app)
    error_body = "provider models failed Authorization: Bearer MODEL_SECRET data:image/png;base64,MODEL_IMAGE " + ("long model error " * 120)

    with LocalStreamingProvider({"/v1/models": {"status": 500, "content_type": "text/plain", "body": error_body}}) as server:
        response = client.post(
            "/api/catalog/provider/models",
            json={"provider": "openai", "base_url": server.base_url, "api_key": "sk-models"},
        )

    assert response.status_code == 502, response.text
    assert "MODEL_SECRET" not in response.text
    assert "MODEL_IMAGE" not in response.text
    assert "data:image/png;base64" not in response.text
    assert "[redacted data URL]" in response.text
    assert response.text.endswith('... [trimmed]"}')


def test_non_stream_chat_http_error_is_redacted_in_response_and_replay(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(router(settings, database))
    client = TestClient(app)
    error_body = "chat failed token=CHAT_HTTP_SECRET data:image/png;base64,CHAT_IMAGE " + ("long chat error " * 120)

    with LocalStreamingProvider({"/v1/chat/completions": {"status": 500, "content_type": "text/plain", "body": error_body}}) as server:
        response = client.post(
            "/api/chat",
            json={
                "provider": "openai",
                "base_url": server.base_url,
                "api_key": "sk-chat",
                "model": "gpt-4.1-mini",
                "messages": [{"role": "user", "content": "触发非流式错误"}],
            },
        )

    assert response.status_code == 502, response.text
    assert "CHAT_HTTP_SECRET" not in response.text
    assert "CHAT_IMAGE" not in response.text
    assert "data:image/png;base64" not in response.text
    assert "[redacted data URL]" in response.text

    runs = client.get("/api/chat/runs")
    assert runs.status_code == 200, runs.text
    run = runs.json()["runs"][0]
    assert run["status"] == "failed"
    events = client.get(f"/api/chat/runs/{run['id']}/events")
    assert events.status_code == 200, events.text
    assert "CHAT_HTTP_SECRET" not in events.text
    assert "CHAT_IMAGE" not in events.text
    assert "data:image/png;base64" not in events.text
    replay_error = [payload for payload in sse_data_payloads(events.text) if payload.get("message")][0]
    assert "[redacted data URL]" in replay_error["message"]
    assert replay_error["message"].endswith("... [trimmed]")


def test_chat_run_messages_redact_attachment_payloads(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    database = Database(settings)
    database.migrate()
    payload = ChatCompletionRequest(
        provider="openai",
        model="gpt-4o-mini",
        messages=[
            {
                "role": "user",
                "content": "请总结附件。",
                "attachments": [
                    {
                        "id": "image-1",
                        "name": "photo.png",
                        "type": "image/png",
                        "kind": "image",
                        "data_url": "data:image/png;base64,SECRET_IMAGE_BODY",
                    },
                    {
                        "id": "doc-1",
                        "name": "notes.md",
                        "type": "text/markdown",
                        "kind": "file",
                        "text_excerpt": "PRIVATE_DOCUMENT_BODY",
                        "text_chunks": [{"ref": "doc-1#chunk1", "chunk_index": 0, "content": "PRIVATE_CHUNK_BODY"}],
                    },
                ],
            }
        ],
    )

    run_id = create_chat_run(database, "owner-1", payload)

    with database.connect() as conn:
        raw = conn.execute("SELECT messages_json FROM chat_runs WHERE id = ?", (run_id,)).fetchone()["messages_json"]
    assert "SECRET_IMAGE_BODY" not in raw
    assert "PRIVATE_DOCUMENT_BODY" not in raw
    assert "PRIVATE_CHUNK_BODY" not in raw
    messages = json.loads(raw)
    image_attachment = messages[0]["attachments"][0]
    doc_attachment = messages[0]["attachments"][1]
    assert image_attachment["id"] == "image-1"
    assert image_attachment["data_url_redacted"] is True
    assert "data_url" not in image_attachment
    assert doc_attachment["id"] == "doc-1"
    assert doc_attachment["text_excerpt_present"] is True
    assert doc_attachment["text_excerpt_chars"] == len("PRIVATE_DOCUMENT_BODY")
    assert doc_attachment["text_chunk_count"] == 1
    assert doc_attachment["text_chunk_refs"] == ["doc-1#chunk1"]
    assert "text_excerpt" not in doc_attachment
    assert "text_chunks" not in doc_attachment


def test_tool_result_events_are_redacted_and_trimmed(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    database = Database(settings)
    database.migrate()
    run_id = create_chat_run(database, "owner-1", ChatCompletionRequest(provider="openai", model="gpt-4o-mini", messages=[{"role": "user", "content": "search"}]))
    event = emit_chat_event(
        database,
        run_id,
        "tool:result",
        {
            "tool_name": "webSearchPrime",
            "status": "success",
            "arguments": {"query": "data:image/png;base64,SECRET_ARGUMENT_IMAGE"},
            "result": {
                "api_key": "SECRET_TOOL_KEY",
                "items": [{"title": "Result", "text": "LONG_TOOL_RESULT_" * 400, "image": "data:image/png;base64,SECRET_RESULT_IMAGE"}],
            },
            "error": "error detail " * 120,
        },
    )

    with database.connect() as conn:
        raw = conn.execute("SELECT events_json FROM chat_runs WHERE id = ?", (run_id,)).fetchone()["events_json"]
    assert event["data"]["run_id"] == run_id
    assert event["data"]["arguments"]["query"] == "[redacted data URL]"
    assert event["data"]["result_truncated"] is True
    assert event["data"]["result"]["preview"].endswith("... [trimmed]")
    assert len(event["data"]["error"]) < 900
    assert "SECRET_TOOL_KEY" not in raw
    assert "SECRET_ARGUMENT_IMAGE" not in raw
    assert "SECRET_RESULT_IMAGE" not in raw
    assert "LONG_TOOL_RESULT_" * 80 not in raw


def test_chat_run_snapshot_redacts_text_secrets_and_embedded_data_urls(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    database = Database(settings)
    database.migrate()
    payload = ChatCompletionRequest(
        provider="openai",
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": 'debug api_key="SECRET_TEXT_KEY" Authorization: Bearer SECRET_BEARER data:image/png;base64,SECRET_TEXT_IMAGE'}],
    )

    run_id = create_chat_run(database, "owner-1", payload)

    with database.connect() as conn:
        raw = conn.execute("SELECT messages_json FROM chat_runs WHERE id = ?", (run_id,)).fetchone()["messages_json"]
    assert "SECRET_TEXT_KEY" not in raw
    assert "SECRET_BEARER" not in raw
    assert "SECRET_TEXT_IMAGE" not in raw
    assert "[redacted]" in raw
    assert "[redacted data URL]" in raw


def test_source_citation_check_detects_unknown_refs():
    payload = {"references": [{"ref": "att-1#chunk1"}, {"ref": "att-1#chunk2"}]}
    check = source_citation_check_payload("Used [att-1#chunk1] and [other-doc#chunk4].", payload)

    assert check == {
        "status": "partial",
        "citation_format": "inline",
        "source_count": 2,
        "cited_count": 1,
        "missing_count": 1,
        "cited_refs": ["att-1#chunk1"],
        "missing_refs": ["att-1#chunk2"],
        "unknown_refs": ["other-doc#chunk4"],
        "structured_refs": [],
    }


def test_source_citation_check_parses_structured_citation_list():
    payload = {"references": [{"ref": "att-1#chunk1"}, {"ref": "att-1#chunk2"}]}
    check = source_citation_check_payload("结论见正文。\n引用：[att-1#chunk2, att-1#chunk1]", payload)

    assert check["status"] == "cited"
    assert check["citation_format"] == "structured"
    assert check["cited_refs"] == ["att-1#chunk1", "att-1#chunk2"]
    assert check["missing_refs"] == []
    assert check["structured_refs"] == ["att-1#chunk2", "att-1#chunk1"]


def test_mcp_tools_list_success_updates_schema_cache(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", bigmodel_mcp_live=True)
    database = Database(settings)
    database.migrate()
    server = mcp_schema_test_server()

    def fake_mcp_json_rpc(server, method, params, settings):
        assert method == "tools/list"
        return mcp_tools_list_payload()

    monkeypatch.setattr("app.agents.mcp.mcp_json_rpc", fake_mcp_json_rpc)

    result = list_mcp_tools(server, settings, database)
    cached = load_mcp_tool_schema_cache(database, "bigmodel-web-search", ["webSearchPrime"])

    assert result["status"] == "success"
    assert cached[0]["name"] == "webSearchPrime"
    assert cached[0]["description"] == "Search the web"
    assert cached[0]["input_schema"]["required"] == ["query"]
    assert cached[0]["input_schema"]["properties"]["query"]["type"] == "string"


def test_mcp_live_tools_list_uses_http_json_rpc_session_and_caches_schema(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", bigmodel_mcp_live=True)
    database = Database(settings)
    database.migrate()
    monkeypatch.setenv("BIGMODEL_API_KEY", "bigmodel-live-key")

    with LocalMcpJsonRpcServer() as mcp_server:
        server = {**mcp_schema_test_server(), "endpoint": mcp_server.endpoint}
        result = list_mcp_tools(server, settings, database)

    assert result["status"] == "success"
    assert result["result"]["tools"][0]["name"] == "webSearchPrime"
    assert [record["json"]["method"] for record in mcp_server.records] == ["initialize", "notifications/initialized", "tools/list"]
    assert all(record["headers"]["authorization"] == "Bearer bigmodel-live-key" for record in mcp_server.records)
    assert all(record["headers"]["mcp-protocol-version"] == "2025-06-18" for record in mcp_server.records)
    assert "mcp-session-id" not in mcp_server.records[0]["headers"]
    assert mcp_server.records[1]["headers"]["mcp-session-id"] == "local-session-1"
    assert mcp_server.records[2]["headers"]["mcp-session-id"] == "local-session-1"

    cached = load_mcp_tool_schema_cache(database, "bigmodel-web-search", ["webSearchPrime"])
    assert cached[0]["name"] == "webSearchPrime"
    assert cached[0]["input_schema"]["required"] == ["query"]


def test_mcp_live_tool_call_accepts_sse_result_and_redacts_payload(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", bigmodel_mcp_live=True, mcp_result_max_chars=260)
    monkeypatch.setenv("BIGMODEL_API_KEY", "bigmodel-live-key")
    tool_result = {
        "content": [{"type": "text", "text": "LIVE_MCP_RESULT"}],
        "api_key": "SECRET_FROM_TOOL",
        "items": [{"title": "Large result", "body": "MCP_BODY_" * 200}],
    }

    with LocalMcpJsonRpcServer(tool_result=tool_result, stream_tool_result=True) as mcp_server:
        server = {**mcp_schema_test_server(), "endpoint": mcp_server.endpoint}
        result = call_mcp_tool(server, "webSearchPrime", {"query": "local mcp"}, settings)

    assert result["status"] == "success"
    assert result["tool_name"] == "webSearchPrime"
    assert result["arguments"] == {"query": "local mcp"}
    encoded = json.dumps(result, ensure_ascii=False)
    assert "SECRET_FROM_TOOL" not in encoded
    assert "MCP_BODY_" * 80 not in encoded
    assert "trimmed" in encoded

    assert [record["json"]["method"] for record in mcp_server.records] == ["initialize", "notifications/initialized", "tools/call"]
    call_payload = mcp_server.records[2]["json"]
    assert call_payload["params"] == {"name": "webSearchPrime", "arguments": {"query": "local mcp"}}
    assert mcp_server.records[2]["headers"]["mcp-session-id"] == "local-session-1"


def test_mcp_live_tool_call_http_error_redacts_response_body(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", bigmodel_mcp_live=True)
    monkeypatch.setenv("BIGMODEL_API_KEY", "bigmodel-live-key")
    error_body = 'mcp failed api_key="SECRET_MCP_KEY" token=SECRET_MCP_TOKEN data:image/png;base64,SECRET_MCP_IMAGE ' + ("mcp error " * 120)

    with LocalMcpJsonRpcServer(error_method="tools/call", error_body=error_body, error_status=500) as mcp_server:
        server = {**mcp_schema_test_server(), "endpoint": mcp_server.endpoint}
        result = call_mcp_tool(server, "webSearchPrime", {"query": "local mcp"}, settings)

    assert result["status"] == "failed"
    assert result["tool_name"] == "webSearchPrime"
    assert result["arguments"] == {"query": "local mcp"}
    assert "SECRET_MCP_KEY" not in result["error"]
    assert "SECRET_MCP_TOKEN" not in result["error"]
    assert "SECRET_MCP_IMAGE" not in result["error"]
    assert "[redacted]" in result["error"]
    assert "[redacted data URL]" in result["error"]
    assert result["error"].endswith("... [trimmed]")
    assert [record["json"]["method"] for record in mcp_server.records] == ["initialize", "notifications/initialized", "tools/call"]


def test_mcp_tools_list_cache_failure_does_not_hide_live_result(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", bigmodel_mcp_live=True)
    database = Database(settings)
    server = mcp_schema_test_server()

    monkeypatch.setattr("app.agents.mcp.mcp_json_rpc", lambda server, method, params, settings: mcp_tools_list_payload())

    result = list_mcp_tools(server, settings, database)

    assert result["status"] == "success"
    assert result["result"]["tools"][0]["name"] == "webSearchPrime"
    assert result["cache_error"]


def test_chat_mcp_tool_definitions_use_cached_schema_and_allowlist(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", bigmodel_mcp_live=True)
    database = Database(settings)
    database.migrate()
    server = mcp_schema_test_server()
    store_mcp_tool_schema_cache(database, server, mcp_tools_list_payload())

    openai_tools, openai_map = chat_mcp_tool_definitions(settings, database, [server])
    anthropic_tools, _anthropic_map = anthropic_mcp_tool_definitions(settings, database, [server])
    gemini_tools, _gemini_map = gemini_mcp_tool_definitions(settings, database, [server])

    function_name = openai_tools[0]["function"]["name"]
    assert openai_map[function_name][1] == "webSearchPrime"
    assert openai_tools[0]["function"]["description"] == "Search the web"
    assert openai_tools[0]["function"]["parameters"]["properties"]["query"]["type"] == "string"
    assert anthropic_tools[0]["input_schema"]["required"] == ["query"]
    assert gemini_tools[0]["functionDeclarations"][0]["parameters"]["properties"]["query"]["description"] == "Search query"
    assert "notAllowed" not in str(openai_tools)
    assert "notAllowed" not in str(anthropic_tools)
    assert "notAllowed" not in str(gemini_tools)


def test_chat_mcp_tool_definitions_fall_back_without_schema_cache(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    database = Database(settings)
    database.migrate()
    server = mcp_schema_test_server(configured=False, live_enabled=False)

    tools, tool_map = chat_mcp_tool_definitions(settings, database, [server])

    function_name = tools[0]["function"]["name"]
    assert tool_map[function_name][1] == "webSearchPrime"
    assert tools[0]["function"]["parameters"] == {"type": "object", "properties": {}, "additionalProperties": True}


def test_chat_mcp_tool_definitions_merge_partial_cache_with_fallback(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    database = Database(settings)
    database.migrate()
    server = {**mcp_schema_test_server(), "tool_names": ["webSearchPrime", "webReader"]}
    store_mcp_tool_schema_cache(database, server, mcp_tools_list_payload())

    tools, tool_map = chat_mcp_tool_definitions(settings, database, [server])

    assert len(tools) == 2
    mapped_tools = {tool_name for _function_name, (_server, tool_name) in tool_map.items()}
    assert mapped_tools == {"webSearchPrime", "webReader"}
    assert tools[0]["function"]["parameters"]["required"] == ["query"]
    assert tools[1]["function"]["parameters"] == {"type": "object", "properties": {}, "additionalProperties": True}


def test_openai_vision_attachment_becomes_image_url_part():
    _, body, _ = build_chat_provider_request("openai", vision_request("openai", "gpt-4o-mini"))

    content = body["messages"][0]["content"]
    assert content[0] == {"type": "text", "text": "看图"}
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_anthropic_vision_attachment_becomes_image_block():
    _, body, _ = build_chat_provider_request("anthropic", vision_request("anthropic", "claude-sonnet-4-20250514"))

    content = body["messages"][0]["content"]
    assert content[0] == {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "aGVsbG8="}}
    assert content[1] == {"type": "text", "text": "看图"}


def test_gemini_vision_attachment_becomes_inline_data_part():
    _, body, _ = build_chat_provider_request("gemini", vision_request("gemini", "gemini-2.5-flash"))

    parts = body["contents"][0]["parts"]
    assert parts[0] == {"inline_data": {"mime_type": "image/png", "data": "aGVsbG8="}}
    assert parts[1] == {"text": "看图"}


def test_uploaded_chat_attachment_hydrates_for_owner_vision_request(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
    )
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    owner = sign_up(client, "attach-owner")
    other = sign_up(client, "attach-other")
    headers = {"Authorization": f"Bearer {owner['token']}"}
    image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="

    upload = client.post(
        "/api/chat/attachments",
        headers=headers,
        json={"filename": "pixel.png", "content_type": "image/png", "data_base64": image_base64},
    )

    assert upload.status_code == 200, upload.text
    attachment = upload.json()
    assert attachment["uploaded"] is True
    private_files = list((settings.private_media_root / settings.chat_attachment_upload_dirname / owner["user"]["id"]).glob("*"))
    public_files = list((settings.media_root / settings.chat_attachment_upload_dirname / owner["user"]["id"]).glob("*"))
    assert len(private_files) == 1
    assert public_files == []
    owner_request = ChatCompletionRequest(
        provider="openai",
        base_url="https://api.example.com",
        api_key="test-key",
        model="gpt-4o-mini",
        supports_vision=True,
        messages=[{"role": "user", "content": "看图", "attachments": [attachment]}],
    )
    hydrated = resolve_chat_request(database, owner_request, settings=settings, user_id=owner["user"]["id"])
    _, body, _ = build_chat_provider_request("openai", hydrated)
    content = body["messages"][0]["content"]
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")

    not_owner = resolve_chat_request(database, owner_request, settings=settings, user_id=other["user"]["id"])
    _, other_body, _ = build_chat_provider_request("openai", not_owner)
    assert isinstance(other_body["messages"][0]["content"], str)
    assert "pixel.png" in other_body["messages"][0]["content"]


def test_uploaded_text_attachment_hydrates_excerpt_for_owner_request(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
    )
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    owner = sign_up(client, "text-owner")
    other = sign_up(client, "text-other")
    headers = {"Authorization": f"Bearer {owner['token']}"}
    notes = "Project notes:\n- Keep uploads private.\n- Summarize text attachments."

    upload = client.post(
        "/api/chat/attachments",
        headers=headers,
        json={"filename": "notes.md", "content_type": "text/markdown", "data_base64": base64.b64encode(notes.encode("utf-8")).decode("ascii")},
    )

    assert upload.status_code == 200, upload.text
    attachment = upload.json()
    assert attachment["uploaded"] is True
    assert attachment["text_extracted"] is True
    request = ChatCompletionRequest(
        provider="openai",
        base_url="https://api.example.com",
        api_key="test-key",
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "总结附件", "attachments": [attachment]}],
    )
    owner_request = resolve_chat_request(database, request, settings=settings, user_id=owner["user"]["id"])
    _, body, _ = build_chat_provider_request("openai", owner_request)
    content = body["messages"][0]["content"]
    assert "notes.md" in content
    assert "文本摘录" in content
    assert "Keep uploads private" in content

    other_request = resolve_chat_request(database, request, settings=settings, user_id=other["user"]["id"])
    _, other_body, _ = build_chat_provider_request("openai", other_request)
    other_content = other_body["messages"][0]["content"]
    assert "notes.md" in other_content
    assert "Keep uploads private" not in other_content


def test_uploaded_text_attachment_retrieves_relevant_document_chunk(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
    )
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    owner = sign_up(client, "chunk-owner")
    other = sign_up(client, "chunk-other")
    headers = {"Authorization": f"Bearer {owner['token']}"}
    early_text = "intro filler " * 420
    late_fact = "RETENTION_POLICY says private attachments must stay private."
    notes = early_text + "\n\n" + late_fact

    upload = client.post(
        "/api/chat/attachments",
        headers=headers,
        json={"filename": "long-notes.md", "content_type": "text/markdown", "data_base64": base64.b64encode(notes.encode("utf-8")).decode("ascii")},
    )

    assert upload.status_code == 200, upload.text
    attachment = upload.json()
    request = ChatCompletionRequest(
        provider="openai",
        base_url="https://api.example.com",
        api_key="test-key",
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "What does RETENTION_POLICY say?", "attachments": [attachment]}],
    )
    owner_request = resolve_chat_request(database, request, settings=settings, user_id=owner["user"]["id"])
    _, body, _ = build_chat_provider_request("openai", owner_request)
    content = body["messages"][0]["content"]
    assert "相关文档摘录" in content
    assert "RETENTION_POLICY says private attachments" in content

    other_request = resolve_chat_request(database, request, settings=settings, user_id=other["user"]["id"])
    _, other_body, _ = build_chat_provider_request("openai", other_request)
    other_content = other_body["messages"][0]["content"]
    assert "long-notes.md" in other_content
    assert "RETENTION_POLICY says private attachments" not in other_content

    with database.connect() as conn:
        chunk_count = conn.execute("SELECT COUNT(*) AS count FROM chat_document_chunks WHERE attachment_id = ?", (attachment["id"],)).fetchone()["count"]
    assert chunk_count >= 2


def test_chat_document_chunks_sync_optional_fts_index(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
    )
    database = Database(settings)
    database.migrate()
    with database.connect() as conn:
        has_fts = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_document_chunks_fts'").fetchone() is not None
    if not has_fts:
        pytest.skip("SQLite FTS5 is not available in this environment.")

    first_count = store_chat_document_chunks(database, "owner-1", "attachment-1", ("alpha filler " * 260) + "\n\nUNIQUE_NEEDLE appears in the relevant chunk.")

    with database.connect() as conn:
        indexed_count = conn.execute("SELECT COUNT(*) AS count FROM chat_document_chunks_fts WHERE user_id = ? AND attachment_id = ?", ("owner-1", "attachment-1")).fetchone()["count"]
    assert indexed_count == first_count
    results = recall_chat_document_chunks(database, "owner-1", "attachment-1", "UNIQUE_NEEDLE", 2)
    assert results[0]["retrieval"] == "fts5"
    assert "UNIQUE_NEEDLE appears" in results[0]["content"]

    second_count = store_chat_document_chunks(database, "owner-1", "attachment-1", "replacement chunk with SECOND_NEEDLE only")

    with database.connect() as conn:
        indexed_count = conn.execute("SELECT COUNT(*) AS count FROM chat_document_chunks_fts WHERE user_id = ? AND attachment_id = ?", ("owner-1", "attachment-1")).fetchone()["count"]
    assert indexed_count == second_count
    replacement = recall_chat_document_chunks(database, "owner-1", "attachment-1", "SECOND_NEEDLE", 2)
    assert replacement[0]["retrieval"] == "fts5"
    assert "SECOND_NEEDLE only" in replacement[0]["content"]
    assert "UNIQUE_NEEDLE" not in replacement[0]["content"]


def test_chat_document_chunks_migration_backfills_optional_fts_index(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
    )
    database = Database(settings)
    database.migrate()
    with database.connect() as conn:
        has_fts = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_document_chunks_fts'").fetchone() is not None
    if not has_fts:
        pytest.skip("SQLite FTS5 is not available in this environment.")

    with database.connect() as conn:
        conn.execute(
            """
            INSERT INTO chat_document_chunks (id, user_id, attachment_id, chunk_index, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("legacy-attachment:0", "owner-1", "legacy-attachment", 0, "LEGACY_NEEDLE should be searchable after migration.", now_iso()),
        )
        conn.execute("DELETE FROM chat_document_chunks_fts WHERE id = ?", ("legacy-attachment:0",))
    database.migrate()

    with database.connect() as conn:
        indexed_count = conn.execute("SELECT COUNT(*) AS count FROM chat_document_chunks_fts WHERE id = ?", ("legacy-attachment:0",)).fetchone()["count"]
    assert indexed_count == 1
    results = recall_chat_document_chunks(database, "owner-1", "legacy-attachment", "LEGACY_NEEDLE", 1)
    assert results[0]["retrieval"] == "fts5"
    assert "LEGACY_NEEDLE should be searchable" in results[0]["content"]


def test_existing_text_attachment_lazy_backfills_document_chunks(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
    )
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    owner = sign_up(client, "chunk-backfill")
    attachment_id = "legacy-text"
    relative_path = f"{settings.chat_attachment_upload_dirname}/{owner['user']['id']}/{attachment_id}.md"
    stored_path = settings.private_media_root / relative_path
    stored_path.parent.mkdir(parents=True, exist_ok=True)
    stored_path.write_text("legacy chunk text", encoding="utf-8")
    excerpt = "Legacy upload says BACKFILL_MARKER should be searchable."
    with database.connect() as conn:
        conn.execute(
            """
            INSERT INTO chat_attachments (id, user_id, name, content_type, size, kind, path, sha256, text_excerpt, text_truncated, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (attachment_id, owner["user"]["id"], "legacy.md", "text/markdown", stored_path.stat().st_size, "file", relative_path, hashlib.sha256(stored_path.read_bytes()).hexdigest(), excerpt, 0, now_iso()),
        )
        assert conn.execute("SELECT COUNT(*) AS count FROM chat_document_chunks WHERE attachment_id = ?", (attachment_id,)).fetchone()["count"] == 0

    request = ChatCompletionRequest(
        provider="openai",
        base_url="https://api.example.com",
        api_key="test-key",
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Find BACKFILL_MARKER", "attachments": [{"id": attachment_id, "name": "legacy.md", "type": "text/markdown", "size": stored_path.stat().st_size, "kind": "file", "uploaded": True}]}],
    )
    owner_request = resolve_chat_request(database, request, settings=settings, user_id=owner["user"]["id"])
    _, body, _ = build_chat_provider_request("openai", owner_request)

    assert "BACKFILL_MARKER" in body["messages"][0]["content"]
    with database.connect() as conn:
        assert conn.execute("SELECT COUNT(*) AS count FROM chat_document_chunks WHERE attachment_id = ?", (attachment_id,)).fetchone()["count"] == 1


def test_chat_document_chunk_search_and_detail_are_owner_scoped(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
    )
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    owner = sign_up(client, "chunk-detail-owner")
    other = sign_up(client, "chunk-detail-other")
    owner_headers = {"Authorization": f"Bearer {owner['token']}"}
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    notes = ("intro filler " * 420) + "\n\nDETAIL_MARKER explains owner scoped citations."
    upload = client.post(
        "/api/chat/attachments",
        headers=owner_headers,
        json={"filename": "detail-notes.md", "content_type": "text/markdown", "data_base64": base64.b64encode(notes.encode("utf-8")).decode("ascii")},
    )
    assert upload.status_code == 200, upload.text
    attachment_id = upload.json()["id"]

    search = client.get(f"/api/chat/attachments/{attachment_id}/chunks?q=DETAIL_MARKER&limit=2", headers=owner_headers)
    other_search = client.get(f"/api/chat/attachments/{attachment_id}/chunks?q=DETAIL_MARKER", headers=other_headers)
    anonymous_search = client.get(f"/api/chat/attachments/{attachment_id}/chunks?q=DETAIL_MARKER")

    assert search.status_code == 200, search.text
    assert search.json()["attachment"]["name"] == "detail-notes.md"
    assert "#chunk" in search.json()["chunks"][0]["ref"]
    assert "DETAIL_MARKER explains" in search.json()["chunks"][0]["content"]
    assert other_search.status_code == 404
    assert anonymous_search.status_code == 401

    ref = search.json()["chunks"][0]["ref"]
    encoded_ref = ref.replace("#", "%23")
    detail = client.get(f"/api/chat/document-chunks/{encoded_ref}", headers=owner_headers)
    other_detail = client.get(f"/api/chat/document-chunks/{encoded_ref}", headers=other_headers)
    invalid_detail = client.get("/api/chat/document-chunks/not-a-ref", headers=owner_headers)

    assert detail.status_code == 200, detail.text
    assert detail.json()["ref"] == ref
    assert detail.json()["attachment"]["id"] == attachment_id
    assert "owner scoped citations" in detail.json()["chunk"]["content"]
    assert other_detail.status_code == 404
    assert invalid_detail.status_code == 404


def test_uploaded_pdf_attachment_hydrates_excerpt_for_owner_request(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
    )
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    owner = sign_up(client, "pdf-owner")
    other = sign_up(client, "pdf-other")
    headers = {"Authorization": f"Bearer {owner['token']}"}
    pdf_notes = "PDF project notes keep uploads private."

    upload = client.post(
        "/api/chat/attachments",
        headers=headers,
        json={"filename": "notes.pdf", "content_type": "application/pdf", "data_base64": base64.b64encode(minimal_pdf_bytes(pdf_notes)).decode("ascii")},
    )

    assert upload.status_code == 200, upload.text
    attachment = upload.json()
    assert attachment["uploaded"] is True
    assert attachment["text_extracted"] is True
    request = ChatCompletionRequest(
        provider="openai",
        base_url="https://api.example.com",
        api_key="test-key",
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "总结 PDF", "attachments": [attachment]}],
    )
    owner_request = resolve_chat_request(database, request, settings=settings, user_id=owner["user"]["id"])
    _, body, _ = build_chat_provider_request("openai", owner_request)
    content = body["messages"][0]["content"]
    assert "notes.pdf" in content
    assert "文本摘录" in content
    assert "PDF project notes" in content

    other_request = resolve_chat_request(database, request, settings=settings, user_id=other["user"]["id"])
    _, other_body, _ = build_chat_provider_request("openai", other_request)
    other_content = other_body["messages"][0]["content"]
    assert "notes.pdf" in other_content
    assert "PDF project notes" not in other_content


def test_unparseable_pdf_upload_falls_back_to_metadata(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
    )
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    owner = sign_up(client, "pdf-bad")

    upload = client.post(
        "/api/chat/attachments",
        headers={"Authorization": f"Bearer {owner['token']}"},
        json={"filename": "broken.pdf", "content_type": "application/pdf", "data_base64": base64.b64encode(b"%PDF broken").decode("ascii")},
    )

    assert upload.status_code == 200, upload.text
    assert upload.json()["uploaded"] is True
    assert upload.json()["text_extracted"] is False


def test_chat_attachment_upload_requires_auth(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media")
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)

    response = client.post(
        "/api/chat/attachments",
        json={"filename": "pixel.png", "content_type": "image/png", "data_base64": "aGVsbG8="},
    )

    assert response.status_code == 401


def test_chat_attachment_download_is_owner_scoped(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
    )
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    owner = sign_up(client, "download-owner")
    other = sign_up(client, "download-other")
    owner_headers = {"Authorization": f"Bearer {owner['token']}"}
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
    upload = client.post(
        "/api/chat/attachments",
        headers=owner_headers,
        json={"filename": "pixel.png", "content_type": "image/png", "data_base64": image_base64},
    )
    assert upload.status_code == 200, upload.text
    attachment_id = upload.json()["id"]

    owner_download = client.get(f"/api/chat/attachments/{attachment_id}", headers=owner_headers)
    other_download = client.get(f"/api/chat/attachments/{attachment_id}", headers=other_headers)
    anonymous_download = client.get(f"/api/chat/attachments/{attachment_id}")

    assert owner_download.status_code == 200
    assert owner_download.headers["content-type"].startswith("image/png")
    assert owner_download.content.startswith(b"\x89PNG\r\n\x1a\n")
    assert other_download.status_code == 404
    assert anonymous_download.status_code == 401


def test_chat_attachment_temporary_url_is_signed_and_expires(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
        chat_attachment_url_secret="test-url-secret",
        chat_attachment_url_ttl_seconds=120,
    )
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    owner = sign_up(client, "temporary-owner")
    other = sign_up(client, "temporary-other")
    owner_headers = {"Authorization": f"Bearer {owner['token']}"}
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
    upload = client.post(
        "/api/chat/attachments",
        headers=owner_headers,
        json={"filename": "pixel.png", "content_type": "image/png", "data_base64": image_base64},
    )
    assert upload.status_code == 200, upload.text
    attachment_id = upload.json()["id"]

    created = client.post(f"/api/chat/attachments/{attachment_id}/temporary-url", headers=owner_headers)
    other_created = client.post(f"/api/chat/attachments/{attachment_id}/temporary-url", headers=other_headers)
    anonymous_created = client.post(f"/api/chat/attachments/{attachment_id}/temporary-url")
    assert created.status_code == 200, created.text
    assert created.json()["expires_in"] == 120
    assert created.json()["url"].startswith(f"/api/chat/attachments/{attachment_id}/temporary?token=")
    assert other_created.status_code == 404
    assert anonymous_created.status_code == 401

    temporary_download = client.get(created.json()["url"])
    tampered_download = client.get(created.json()["url"] + "x")
    wrong_attachment_download = client.get(created.json()["url"].replace(attachment_id, "wrong-id", 1))
    expired_token = sign_chat_attachment_url(settings, owner["user"]["id"], attachment_id, 0)
    expired_download = client.get(f"/api/chat/attachments/{attachment_id}/temporary?token={expired_token}")

    assert temporary_download.status_code == 200
    assert temporary_download.content.startswith(b"\x89PNG\r\n\x1a\n")
    assert tampered_download.status_code == 401
    assert wrong_attachment_download.status_code == 401
    assert expired_download.status_code == 401


def test_chat_attachment_delete_removes_owner_record_file_and_invalidates_urls(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
        chat_attachment_url_secret="test-url-secret",
    )
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    owner = sign_up(client, "delete-owner")
    other = sign_up(client, "delete-other")
    owner_headers = {"Authorization": f"Bearer {owner['token']}"}
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
    upload = client.post(
        "/api/chat/attachments",
        headers=owner_headers,
        json={"filename": "pixel.png", "content_type": "image/png", "data_base64": image_base64},
    )
    assert upload.status_code == 200, upload.text
    attachment_id = upload.json()["id"]
    stored_files = list((settings.private_media_root / settings.chat_attachment_upload_dirname / owner["user"]["id"]).glob("*"))
    assert len(stored_files) == 1
    temporary_url = client.post(f"/api/chat/attachments/{attachment_id}/temporary-url", headers=owner_headers).json()["url"]

    other_delete = client.delete(f"/api/chat/attachments/{attachment_id}", headers=other_headers)
    anonymous_delete = client.delete(f"/api/chat/attachments/{attachment_id}")
    owner_delete = client.delete(f"/api/chat/attachments/{attachment_id}", headers=owner_headers)
    second_delete = client.delete(f"/api/chat/attachments/{attachment_id}", headers=owner_headers)
    owner_download = client.get(f"/api/chat/attachments/{attachment_id}", headers=owner_headers)
    temporary_download = client.get(temporary_url)

    assert other_delete.status_code == 404
    assert anonymous_delete.status_code == 401
    assert owner_delete.status_code == 200
    assert owner_delete.json() == {"status": "ok"}
    assert second_delete.status_code == 404
    assert owner_download.status_code == 404
    assert temporary_download.status_code == 404
    assert not stored_files[0].exists()


def test_admin_migrates_legacy_public_chat_attachment_to_private_storage(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
    )
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(admin.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    owner = sign_up(client, "legacy-owner")
    admin_user = sign_up(client, "legacy-admin")
    admin_headers = {"Authorization": f"Bearer {admin_user['token']}"}
    owner_headers = {"Authorization": f"Bearer {owner['token']}"}
    with database.connect() as conn:
        conn.execute("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?", (now_iso(), admin_user["user"]["id"]))

    image_data = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=")
    attachment_id = "legacy-public"
    relative_path = f"{settings.chat_attachment_upload_dirname}/{owner['user']['id']}/{attachment_id}.png"
    public_path = settings.media_root / relative_path
    private_path = settings.private_media_root / relative_path
    public_path.parent.mkdir(parents=True, exist_ok=True)
    public_path.write_bytes(image_data)
    with database.connect() as conn:
        conn.execute(
            """
            INSERT INTO chat_attachments (id, user_id, name, content_type, size, kind, path, sha256, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (attachment_id, owner["user"]["id"], "legacy.png", "image/png", len(image_data), "image", relative_path, hashlib.sha256(image_data).hexdigest(), now_iso()),
        )

    dry_run = client.post("/api/admin/chat-attachments/migrate-private", headers=admin_headers, json={"dry_run": True})
    assert dry_run.status_code == 200, dry_run.text
    assert dry_run.json()["migrated"] == 1
    assert public_path.exists()

    migrated = client.post("/api/admin/chat-attachments/migrate-private", headers=admin_headers, json={"dry_run": False})
    owner_download = client.get(f"/api/chat/attachments/{attachment_id}", headers=owner_headers)

    assert migrated.status_code == 200, migrated.text
    assert migrated.json()["migrated"] == 1
    assert not public_path.exists()
    assert private_path.exists()
    assert owner_download.status_code == 200
    assert owner_download.content.startswith(b"\x89PNG")


def test_admin_cleanup_chat_attachment_orphans_keeps_referenced_files(tmp_path):
    settings = Settings(
        base_dir=tmp_path,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        media_root=tmp_path / "media",
        private_media_root=tmp_path / "private-media",
    )
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(admin.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    owner = sign_up(client, "cleanup-owner")
    admin_user = sign_up(client, "cleanup-admin")
    admin_headers = {"Authorization": f"Bearer {admin_user['token']}"}
    with database.connect() as conn:
        conn.execute("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?", (now_iso(), admin_user["user"]["id"]))

    referenced_relative = f"{settings.chat_attachment_upload_dirname}/{owner['user']['id']}/referenced.txt"
    orphan_private = settings.private_media_root / settings.chat_attachment_upload_dirname / owner["user"]["id"] / "orphan-private.txt"
    orphan_public = settings.media_root / settings.chat_attachment_upload_dirname / owner["user"]["id"] / "orphan-public.txt"
    referenced_path = settings.private_media_root / referenced_relative
    for path, content in [(referenced_path, b"referenced"), (orphan_private, b"orphan-private"), (orphan_public, b"orphan-public")]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    with database.connect() as conn:
        conn.execute(
            """
            INSERT INTO chat_attachments (id, user_id, name, content_type, size, kind, path, sha256, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("referenced", owner["user"]["id"], "referenced.txt", "text/plain", 10, "file", referenced_relative, hashlib.sha256(b"referenced").hexdigest(), now_iso()),
        )

    dry_run = client.post("/api/admin/chat-attachments/cleanup-orphans", headers=admin_headers, json={"dry_run": True, "min_age_seconds": 0})
    assert dry_run.status_code == 200, dry_run.text
    assert dry_run.json()["deleted"] == 2
    assert referenced_path.exists()
    assert orphan_private.exists()
    assert orphan_public.exists()

    cleanup = client.post("/api/admin/chat-attachments/cleanup-orphans", headers=admin_headers, json={"dry_run": False, "min_age_seconds": 0})

    assert cleanup.status_code == 200, cleanup.text
    assert cleanup.json()["deleted"] == 2
    assert referenced_path.exists()
    assert not orphan_private.exists()
    assert not orphan_public.exists()


def vision_request(provider: str, model: str) -> ChatCompletionRequest:
    return ChatCompletionRequest(
        provider=provider,
        base_url="https://api.example.com",
        api_key="test-key",
        model=model,
        supports_vision=True,
        messages=[
            {
                "role": "user",
                "content": "看图",
                "attachments": [
                    {
                        "id": "att-1",
                        "name": "demo.png",
                        "type": "image/png",
                        "size": 5,
                        "kind": "image",
                        "data_url": "data:image/png;base64,aGVsbG8=",
                    }
                ],
            }
        ],
    )


def minimal_pdf_bytes(text: str) -> bytes:
    stream = f"BT\n/F1 18 Tf\n72 720 Td\n({pdf_literal(text)}) Tj\nET\n".encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"endstream",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("ascii"))
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii"))
    return bytes(output)


def pdf_literal(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def mcp_schema_test_server(configured: bool = True, live_enabled: bool = True) -> dict:
    return {
        "id": "bigmodel-web-search",
        "name": "BigModel Web Search Prime",
        "description": "Search",
        "transport": "streamable-http",
        "endpoint": "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
        "auth": "bearer",
        "provider": "bigmodel",
        "required_env": "BIGMODEL_API_KEY",
        "enabled": True,
        "configured": configured,
        "live_enabled": live_enabled,
        "tool_names": ["webSearchPrime"],
    }


def mcp_tools_list_payload() -> dict:
    return {
        "tools": [
            {
                "name": "webSearchPrime",
                "description": "Search the web",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                        "count": {"type": "integer", "minimum": 1, "maximum": 10},
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "notAllowed",
                "description": "Should not leak into chat tools",
                "inputSchema": {"type": "object", "properties": {"secret": {"type": "string"}}},
            },
        ]
    }


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


def test_model_profiles_are_user_scoped_and_api_keys_encrypted(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", model_profile_encryption_key="test-secret")
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    first = sign_up(client, "first")
    second = sign_up(client, "second")

    for auth_payload, key in [(first, "sk-first"), (second, "sk-second")]:
        response = client.put(
            "/api/catalog/model-profiles",
            headers={"Authorization": f"Bearer {auth_payload['token']}"},
            json={
                "active_profile_id": "shared-profile",
                "profiles": [
                    {
                        "id": "shared-profile",
                        "name": "Shared",
                        "provider": "openai",
                        "base_url": "https://api.example.com",
                        "api_key": key,
                        "model": "gpt-4o-mini",
                    }
                ],
            },
        )
        assert response.status_code == 200, response.text
        profile = response.json()["profiles"][0]
        assert profile["id"] == "shared-profile"
        assert profile["api_key"] == ""
        assert profile["api_key_set"] is True

    with database.connect() as conn:
        rows = conn.execute("SELECT id, user_id, public_id, api_key, api_key_encrypted FROM model_profiles ORDER BY user_id").fetchall()
    assert len(rows) == 2
    assert {row["public_id"] for row in rows} == {"shared-profile"}
    assert all(row["api_key"] in {"", None} for row in rows)
    assert all(str(row["api_key_encrypted"]).startswith("fernet:v1:") for row in rows)

    first_resolved = resolve_chat_request(
        database,
        ChatCompletionRequest(profile_id="shared-profile", messages=[{"role": "user", "content": "hello"}]),
        settings=settings,
        user_id=first["user"]["id"],
    )
    second_resolved = resolve_chat_request(
        database,
        ChatCompletionRequest(profile_id="shared-profile", messages=[{"role": "user", "content": "hello"}]),
        settings=settings,
        user_id=second["user"]["id"],
    )
    assert first_resolved.api_key == "sk-first"
    assert second_resolved.api_key == "sk-second"


def test_persona_memory_recall_injects_chat_prompt(tmp_path):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", model_profile_encryption_key="test-secret")
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    auth_payload = sign_up(client, "memory")
    headers = {"Authorization": f"Bearer {auth_payload['token']}"}

    profile = client.put(
        "/api/catalog/model-profiles",
        headers=headers,
        json={
            "active_profile_id": "profile-main",
            "profiles": [
                {
                    "id": "profile-main",
                    "name": "Main",
                    "provider": "openai",
                    "base_url": "https://api.example.com",
                    "api_key": "sk-memory",
                    "model": "gpt-4o-mini",
                }
            ],
        },
    )
    assert profile.status_code == 200, profile.text
    persona = client.post(
        "/api/chat/personas",
        headers=headers,
        json={
            "id": "contact-main",
            "name": "知己",
            "role": "长期陪伴联系人",
            "temperament": "直接、温和",
            "notes": "少说系统说明",
            "default_profile_id": "profile-main",
            "memory_strategy": "recall-retain",
        },
    )
    assert persona.status_code == 200, persona.text
    retained = client.post(
        "/api/chat/memory/retain",
        headers=headers,
        json={"persona_id": "contact-main", "content": "用户喜欢简洁的回答。", "source": "manual"},
    )
    assert retained.status_code == 200, retained.text

    resolved = resolve_chat_request(
        database,
        ChatCompletionRequest(persona_id="contact-main", messages=[{"role": "user", "content": "以后回答风格怎么做？"}]),
        settings=settings,
        user_id=auth_payload["user"]["id"],
    )
    assert resolved.profile_id == "profile-main"
    assert resolved.model == "gpt-4o-mini"
    assert "你正在以“知己”" in (resolved.system_prompt or "")
    assert "角色定位：长期陪伴联系人" in (resolved.system_prompt or "")
    assert "长期记忆" in (resolved.system_prompt or "")
    assert "用户喜欢简洁的回答。" in (resolved.system_prompt or "")


def test_stream_chat_persists_run_and_mcp_tool_events(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", model_profile_encryption_key="test-secret")
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    auth_payload = sign_up(client, "run")
    headers = {"Authorization": f"Bearer {auth_payload['token']}"}

    response = client.put(
        "/api/catalog/model-profiles",
        headers=headers,
        json={
            "active_profile_id": "profile-main",
            "profiles": [
                {
                    "id": "profile-main",
                    "name": "Main",
                    "provider": "openai",
                    "base_url": "https://api.example.com",
                    "api_key": "sk-run",
                    "model": "gpt-4o-mini",
                }
            ],
        },
    )
    assert response.status_code == 200, response.text

    async def fake_stream_openai(settings, payload):
        yield {"event": "message:chunk", "data": {"content": "完成"}}
        yield {"event": "token:usage", "data": {"usage": {"total_tokens": 3}}}

    monkeypatch.setattr("app.providers._stream_openai", fake_stream_openai)
    stream = client.post(
        "/api/chat/stream",
        headers=headers,
        json={
            "profile_id": "profile-main",
            "mcp_server_ids": ["bigmodel-web-search"],
            "messages": [{"role": "user", "content": "搜索 4Ever MCP"}],
        },
    )
    assert stream.status_code == 200, stream.text
    body = stream.text
    assert "event: run:start" in body
    assert "event: thought:summary" in body
    assert "event: tool:start" in body
    assert "event: tool:result" in body
    assert "event: message:done" in body
    live_payloads = sse_data_payloads(body)
    live_run_id = live_payloads[0]["run_id"]
    assert live_run_id
    assert all(payload.get("run_id") == live_run_id for payload in live_payloads)

    runs = client.get("/api/chat/runs", headers=headers)
    assert runs.status_code == 200, runs.text
    run = runs.json()["runs"][0]
    assert run["id"] == live_run_id
    assert run["status"] == "success"
    assert run["event_count"] >= 6
    events = client.get(f"/api/chat/runs/{run['id']}/events", headers=headers)
    assert events.status_code == 200, events.text
    assert "event: thought:summary" in events.text
    assert "event: tool:result" in events.text
    assert all(payload.get("run_id") == run["id"] for payload in sse_data_payloads(events.text))


def test_stream_chat_error_event_is_redacted_in_live_sse_and_replay(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", model_profile_encryption_key="test-secret")
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    auth_payload = sign_up(client, "run-error")
    headers = {"Authorization": f"Bearer {auth_payload['token']}"}

    response = client.put(
        "/api/catalog/model-profiles",
        headers=headers,
        json={
            "active_profile_id": "profile-main",
            "profiles": [
                {
                    "id": "profile-main",
                    "name": "Main",
                    "provider": "openai",
                    "base_url": "https://api.example.com",
                    "api_key": "sk-run",
                    "model": "gpt-4o-mini",
                }
            ],
        },
    )
    assert response.status_code == 200, response.text

    async def fake_stream_openai(settings, payload):
        raise HTTPException(status_code=502, detail="Provider failed data:image/png;base64,SECRET_ERROR_IMAGE " + ("long error " * 200))
        yield {"event": "message:chunk", "data": {"content": "unreachable"}}

    monkeypatch.setattr("app.providers._stream_openai", fake_stream_openai)
    stream = client.post(
        "/api/chat/stream",
        headers=headers,
        json={"profile_id": "profile-main", "messages": [{"role": "user", "content": "触发错误"}]},
    )

    assert stream.status_code == 200, stream.text
    assert "event: run:error" in stream.text
    assert "SECRET_ERROR_IMAGE" not in stream.text
    live_error = [payload for payload in sse_data_payloads(stream.text) if payload.get("message")][0]
    assert "[redacted data URL]" in live_error["message"]
    assert live_error["message"].endswith("... [trimmed]")
    assert len(live_error["message"]) <= 820

    runs = client.get("/api/chat/runs", headers=headers)
    run = runs.json()["runs"][0]
    assert run["status"] == "failed"
    events = client.get(f"/api/chat/runs/{run['id']}/events", headers=headers)
    assert events.status_code == 200, events.text
    assert "SECRET_ERROR_IMAGE" not in events.text
    replay_error = [payload for payload in sse_data_payloads(events.text) if payload.get("message")][0]
    assert replay_error == live_error


def test_stream_chat_emits_source_references_for_document_chunks(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", private_media_root=tmp_path / "private-media", model_profile_encryption_key="test-secret")
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    auth_payload = sign_up(client, "source-ref")
    headers = {"Authorization": f"Bearer {auth_payload['token']}"}

    response = client.put(
        "/api/catalog/model-profiles",
        headers=headers,
        json={
            "active_profile_id": "profile-main",
            "profiles": [
                {
                    "id": "profile-main",
                    "name": "Main",
                    "provider": "openai",
                    "base_url": "https://api.example.com",
                    "api_key": "sk-run",
                    "model": "gpt-4o-mini",
                }
            ],
        },
    )
    assert response.status_code == 200, response.text
    notes = ("general notes " * 420) + "\n\nSOURCE_MARKER says cite this chunk."
    upload = client.post(
        "/api/chat/attachments",
        headers=headers,
        json={"filename": "source-notes.md", "content_type": "text/markdown", "data_base64": base64.b64encode(notes.encode("utf-8")).decode("ascii")},
    )
    assert upload.status_code == 200, upload.text

    async def fake_stream_openai(settings, payload):
        _, body, _ = build_chat_provider_request("openai", payload)
        content = body["messages"][-1]["content"]
        assert "SOURCE_MARKER says cite this chunk" in content
        assert "#chunk" in content
        assert "标注对应 [ref]" in content
        yield {"event": "message:chunk", "data": {"content": "已引用来源"}}

    monkeypatch.setattr("app.providers._stream_openai", fake_stream_openai)
    stream = client.post(
        "/api/chat/stream",
        headers=headers,
        json={
            "profile_id": "profile-main",
            "messages": [{"role": "user", "content": "SOURCE_MARKER 是什么？", "attachments": [upload.json()]}],
        },
    )

    assert stream.status_code == 200, stream.text
    body = stream.text
    assert "event: source:references" in body
    assert "event: source:citation-check" in body
    assert '"status":"missing"' in body
    assert "source-notes.md" in body
    assert "SOURCE_MARKER says cite this chunk" in body
    runs = client.get("/api/chat/runs", headers=headers)
    run = runs.json()["runs"][0]
    events = client.get(f"/api/chat/runs/{run['id']}/events", headers=headers)
    assert "event: source:references" in events.text
    assert "event: source:citation-check" in events.text
    assert '"status":"missing"' in events.text
    assert "#chunk" in events.text


def test_non_stream_chat_persists_cited_source_check_for_document_chunks(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", private_media_root=tmp_path / "private-media", model_profile_encryption_key="test-secret")
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    auth_payload = sign_up(client, "source-cited")
    headers = {"Authorization": f"Bearer {auth_payload['token']}"}

    response = client.put(
        "/api/catalog/model-profiles",
        headers=headers,
        json={
            "active_profile_id": "profile-main",
            "profiles": [
                {
                    "id": "profile-main",
                    "name": "Main",
                    "provider": "openai",
                    "base_url": "https://api.example.com",
                    "api_key": "sk-run",
                    "model": "gpt-4o-mini",
                }
            ],
        },
    )
    assert response.status_code == 200, response.text
    notes = "SOURCE_MARKER says cite this chunk."
    upload = client.post(
        "/api/chat/attachments",
        headers=headers,
        json={"filename": "source-cited.md", "content_type": "text/markdown", "data_base64": base64.b64encode(notes.encode("utf-8")).decode("ascii")},
    )
    assert upload.status_code == 200, upload.text
    ref = f"{upload.json()['id']}#chunk1"

    async def fake_complete_once(settings, payload):
        _, body, _ = build_chat_provider_request("openai", payload)
        content = body["messages"][-1]["content"]
        assert ref in content
        assert "标注对应 [ref]" in content
        assert "回答末尾追加一行" in content
        return {"provider": "openai", "model": payload.model, "content": f"答案来自该摘录 [{ref}]\n引用：[{ref}]", "usage": {"total_tokens": 5}, "raw": {}}

    monkeypatch.setattr("app.providers._complete_chat_once", fake_complete_once)

    chat = client.post(
        "/api/chat",
        headers=headers,
        json={
            "profile_id": "profile-main",
            "messages": [{"role": "user", "content": "SOURCE_MARKER 是什么？", "attachments": [upload.json()]}],
        },
    )

    assert chat.status_code == 200, chat.text
    assert chat.json()["content"] == f"答案来自该摘录 [{ref}]\n引用：[{ref}]"
    runs = client.get("/api/chat/runs", headers=headers)
    run = runs.json()["runs"][0]
    events = client.get(f"/api/chat/runs/{run['id']}/events", headers=headers)
    assert "event: source:references" in events.text
    assert "event: source:citation-check" in events.text
    assert '"status":"cited"' in events.text
    assert '"citation_format":"structured"' in events.text
    assert ref in events.text


def test_stream_chat_openai_live_mcp_uses_autonomous_tool_loop(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", model_profile_encryption_key="test-secret", bigmodel_mcp_live=True)
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    auth_payload = sign_up(client, "tool-loop")
    headers = {"Authorization": f"Bearer {auth_payload['token']}"}
    monkeypatch.setenv("BIGMODEL_API_KEY", "bigmodel-test-key")

    response = client.put(
        "/api/catalog/model-profiles",
        headers=headers,
        json={
            "active_profile_id": "profile-main",
            "profiles": [
                {
                    "id": "profile-main",
                    "name": "Main",
                    "provider": "openai",
                    "base_url": "https://api.example.com",
                    "api_key": "sk-run",
                    "model": "gpt-4o-mini",
                }
            ],
        },
    )
    assert response.status_code == 200, response.text

    seen_tool_messages: list[dict] = []

    async def fake_openai_tool_selection(settings, payload, messages, extra_body=None):
        tools = (extra_body or {}).get("tools") or []
        assert tools
        assert (extra_body or {}).get("tool_choice") == "auto"
        seen_tool_messages.extend([message for message in messages if message.get("role") == "tool"])
        if seen_tool_messages:
            assert seen_tool_messages[0]["tool_call_id"] == "call-1"
            assert "4Ever MCP result" in seen_tool_messages[0]["content"]
            return {"choices": [{"message": {"content": "已根据工具结果回答"}}]}
        function_name = tools[0]["function"]["name"]
        return {
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {"id": "call-1", "type": "function", "function": {"name": function_name, "arguments": '{"query":"4Ever MCP"}'}}
                        ]
                    }
                }
            ]
        }

    def fake_call_mcp_tool(server, tool_name, arguments, settings):
        assert server["id"] == "bigmodel-web-search"
        assert tool_name == "webSearchPrime"
        assert arguments == {"query": "4Ever MCP"}
        return {"status": "success", "result": {"items": [{"title": "4Ever MCP result"}]}}

    monkeypatch.setattr("app.providers.openai_chat_completion_json_with_messages", fake_openai_tool_selection)
    monkeypatch.setattr("app.providers.call_mcp_tool", fake_call_mcp_tool)

    stream = client.post(
        "/api/chat/stream",
        headers=headers,
        json={
            "profile_id": "profile-main",
            "mcp_server_ids": ["bigmodel-web-search"],
            "messages": [{"role": "user", "content": "搜索 4Ever MCP"}],
        },
    )

    assert stream.status_code == 200, stream.text
    body = stream.text
    assert "event: thought:summary" in body
    assert "event: tool:start" in body
    assert "event: tool:result" in body
    assert '"autonomous":true' in body
    assert '"round":1' in body
    assert "已根据工具结果回答" in body
    assert len(seen_tool_messages) == 1


def test_stream_chat_anthropic_live_mcp_uses_native_tool_loop(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", model_profile_encryption_key="test-secret", bigmodel_mcp_live=True)
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    auth_payload = sign_up(client, "anthropic-tool-loop")
    headers = {"Authorization": f"Bearer {auth_payload['token']}"}
    monkeypatch.setenv("BIGMODEL_API_KEY", "bigmodel-test-key")

    response = client.put(
        "/api/catalog/model-profiles",
        headers=headers,
        json={
            "active_profile_id": "profile-main",
            "profiles": [
                {
                    "id": "profile-main",
                    "name": "Main",
                    "provider": "anthropic",
                    "base_url": "https://api.anthropic.example.com",
                    "api_key": "sk-anthropic",
                    "model": "claude-sonnet-4-20250514",
                }
            ],
        },
    )
    assert response.status_code == 200, response.text
    seen_tool_result_messages: list[dict] = []

    async def fake_anthropic_tool_selection(settings, payload, messages, extra_body=None):
        tools = (extra_body or {}).get("tools") or []
        assert tools
        tool_result_messages = [message for message in messages if message.get("role") == "user" and isinstance(message.get("content"), list) and message["content"] and message["content"][0].get("type") == "tool_result"]
        if tool_result_messages:
            seen_tool_result_messages.extend(tool_result_messages)
            assert messages[-2]["role"] == "assistant"
            assert messages[-2]["content"][0]["type"] == "tool_use"
            assert messages[-2]["content"][0]["id"] == "toolu-1"
            assert messages[-1]["content"][0]["tool_use_id"] == "toolu-1"
            assert "Anthropic MCP result" in messages[-1]["content"][0]["content"]
            return {"content": [{"type": "text", "text": "已根据 Anthropic 工具结果回答"}], "usage": {"output_tokens": 5}}
        function_name = tools[0]["name"]
        return {
            "content": [
                {"type": "tool_use", "id": "toolu-1", "name": function_name, "input": {"query": "4Ever Anthropic MCP"}}
            ],
            "stop_reason": "tool_use",
        }

    def fake_call_mcp_tool(server, tool_name, arguments, settings):
        assert server["id"] == "bigmodel-web-search"
        assert tool_name == "webSearchPrime"
        assert arguments == {"query": "4Ever Anthropic MCP"}
        return {"status": "success", "result": {"items": [{"title": "Anthropic MCP result"}]}}

    monkeypatch.setattr("app.providers.anthropic_chat_completion_json_with_messages", fake_anthropic_tool_selection)
    monkeypatch.setattr("app.providers.call_mcp_tool", fake_call_mcp_tool)

    stream = client.post(
        "/api/chat/stream",
        headers=headers,
        json={
            "profile_id": "profile-main",
            "mcp_server_ids": ["bigmodel-web-search"],
            "messages": [{"role": "user", "content": "搜索 Anthropic MCP"}],
        },
    )

    assert stream.status_code == 200, stream.text
    body = stream.text
    assert "event: thought:summary" in body
    assert "event: tool:start" in body
    assert "event: tool:result" in body
    assert '"autonomous":true' in body
    assert '"round":1' in body
    assert "已根据 Anthropic 工具结果回答" in body
    assert len(seen_tool_result_messages) == 1


def test_stream_chat_gemini_live_mcp_uses_native_function_call_loop(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", model_profile_encryption_key="test-secret", bigmodel_mcp_live=True)
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    auth_payload = sign_up(client, "gemini-tool-loop")
    headers = {"Authorization": f"Bearer {auth_payload['token']}"}
    monkeypatch.setenv("BIGMODEL_API_KEY", "bigmodel-test-key")

    response = client.put(
        "/api/catalog/model-profiles",
        headers=headers,
        json={
            "active_profile_id": "profile-main",
            "profiles": [
                {
                    "id": "profile-main",
                    "name": "Main",
                    "provider": "gemini",
                    "base_url": "https://generativelanguage.example.com/v1beta",
                    "api_key": "sk-gemini",
                    "model": "gemini-2.5-flash",
                }
            ],
        },
    )
    assert response.status_code == 200, response.text
    seen_function_response_messages: list[dict] = []

    async def fake_gemini_tool_selection(settings, payload, contents, extra_body=None):
        tools = (extra_body or {}).get("tools") or []
        assert tools
        assert (extra_body or {}).get("toolConfig") == {"functionCallingConfig": {"mode": "AUTO"}}
        function_response_messages = [message for message in contents if message.get("role") == "user" and isinstance(message.get("parts"), list) and message["parts"] and "functionResponse" in message["parts"][0]]
        if function_response_messages:
            seen_function_response_messages.extend(function_response_messages)
            assert contents[-2]["role"] == "model"
            assert contents[-2]["parts"][0]["functionCall"]["id"] == "func-1"
            assert contents[-2]["parts"][0]["thoughtSignature"] == "opaque-thought-signature"
            assert contents[-1]["parts"][0]["functionResponse"]["id"] == "func-1"
            assert contents[-1]["parts"][0]["functionResponse"]["name"] == contents[-2]["parts"][0]["functionCall"]["name"]
            assert "Gemini MCP result" in str(contents[-1]["parts"][0]["functionResponse"]["response"])
            return {"candidates": [{"content": {"parts": [{"text": "已根据 Gemini 工具结果回答"}]}}], "usageMetadata": {"totalTokenCount": 8}}
        function_name = tools[0]["functionDeclarations"][0]["name"]
        return {
            "candidates": [
                {
                    "content": {
                        "role": "model",
                        "parts": [
                            {
                                "functionCall": {"id": "func-1", "name": function_name, "args": {"query": "4Ever Gemini MCP"}},
                                "thoughtSignature": "opaque-thought-signature",
                            }
                        ],
                    }
                }
            ]
        }

    def fake_call_mcp_tool(server, tool_name, arguments, settings):
        assert server["id"] == "bigmodel-web-search"
        assert tool_name == "webSearchPrime"
        assert arguments == {"query": "4Ever Gemini MCP"}
        return {"status": "success", "result": {"items": [{"title": "Gemini MCP result"}]}}

    monkeypatch.setattr("app.providers.gemini_chat_completion_json_with_contents", fake_gemini_tool_selection)
    monkeypatch.setattr("app.providers.call_mcp_tool", fake_call_mcp_tool)

    stream = client.post(
        "/api/chat/stream",
        headers=headers,
        json={
            "profile_id": "profile-main",
            "mcp_server_ids": ["bigmodel-web-search"],
            "messages": [{"role": "user", "content": "搜索 Gemini MCP"}],
        },
    )

    assert stream.status_code == 200, stream.text
    body = stream.text
    assert "event: thought:summary" in body
    assert "event: tool:start" in body
    assert "event: tool:result" in body
    assert '"autonomous":true' in body
    assert '"round":1' in body
    assert "已根据 Gemini 工具结果回答" in body
    assert len(seen_function_response_messages) == 1


def test_chat_gemini_live_mcp_uses_native_function_call_loop(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", model_profile_encryption_key="test-secret", bigmodel_mcp_live=True)
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    auth_payload = sign_up(client, "gemini-chat-loop")
    headers = {"Authorization": f"Bearer {auth_payload['token']}"}
    monkeypatch.setenv("BIGMODEL_API_KEY", "bigmodel-test-key")

    response = client.put(
        "/api/catalog/model-profiles",
        headers=headers,
        json={
            "active_profile_id": "profile-main",
            "profiles": [
                {
                    "id": "profile-main",
                    "name": "Main",
                    "provider": "gemini",
                    "base_url": "https://generativelanguage.example.com/v1beta",
                    "api_key": "sk-gemini",
                    "model": "gemini-2.5-flash",
                }
            ],
        },
    )
    assert response.status_code == 200, response.text
    seen_function_responses = 0

    async def fake_gemini_tool_selection(settings, payload, contents, extra_body=None):
        nonlocal seen_function_responses
        tools = (extra_body or {}).get("tools") or []
        assert tools
        assert (extra_body or {}).get("toolConfig") == {"functionCallingConfig": {"mode": "AUTO"}}
        if any(message.get("role") == "user" and message.get("parts") and "functionResponse" in message["parts"][0] for message in contents):
            seen_function_responses += 1
            return {"candidates": [{"content": {"parts": [{"text": "Gemini 非流式工具结果"}]}}], "usageMetadata": {"totalTokenCount": 6}}
        function_name = tools[0]["functionDeclarations"][0]["name"]
        return {"candidates": [{"content": {"role": "model", "parts": [{"functionCall": {"id": "func-1", "name": function_name, "args": {"query": "non-stream"}}}]}}]}

    monkeypatch.setattr("app.providers.gemini_chat_completion_json_with_contents", fake_gemini_tool_selection)
    monkeypatch.setattr("app.providers.call_mcp_tool", lambda server, tool_name, arguments, settings: {"status": "success", "result": {"query": arguments["query"]}})

    chat = client.post(
        "/api/chat",
        headers=headers,
        json={
            "profile_id": "profile-main",
            "mcp_server_ids": ["bigmodel-web-search"],
            "messages": [{"role": "user", "content": "非流式 Gemini MCP"}],
        },
    )

    assert chat.status_code == 200, chat.text
    assert chat.json()["provider"] == "gemini"
    assert chat.json()["content"] == "Gemini 非流式工具结果"
    run_id = chat.json()["run_id"]
    assert run_id
    assert seen_function_responses == 1
    events = client.get(f"/api/chat/runs/{run_id}/events", headers=headers)
    assert events.status_code == 200, events.text
    replay_payloads = sse_data_payloads(events.text)
    assert replay_payloads
    assert all(payload.get("run_id") == run_id for payload in replay_payloads)


def test_stream_chat_openai_live_mcp_supports_multi_round_tool_loop(tmp_path, monkeypatch):
    settings = Settings(base_dir=tmp_path, database_url=f"sqlite:///{tmp_path / 'test.db'}", media_root=tmp_path / "media", model_profile_encryption_key="test-secret", bigmodel_mcp_live=True)
    database = Database(settings)
    database.migrate()
    app = FastAPI()
    app.include_router(auth.router(database, settings))
    app.include_router(router(settings, database))
    client = TestClient(app)
    auth_payload = sign_up(client, "tool-loop-rounds")
    headers = {"Authorization": f"Bearer {auth_payload['token']}"}
    monkeypatch.setenv("BIGMODEL_API_KEY", "bigmodel-test-key")

    response = client.put(
        "/api/catalog/model-profiles",
        headers=headers,
        json={
            "active_profile_id": "profile-main",
            "profiles": [
                {
                    "id": "profile-main",
                    "name": "Main",
                    "provider": "openai",
                    "base_url": "https://api.example.com",
                    "api_key": "sk-run",
                    "model": "gpt-4o-mini",
                }
            ],
        },
    )
    assert response.status_code == 200, response.text

    selection_messages: list[list[dict]] = []
    final_messages: list[dict] = []

    async def fake_openai_tool_selection(settings, payload, messages, extra_body=None):
        tools = (extra_body or {}).get("tools") or []
        assert tools
        selection_messages.append(messages)
        function_name = tools[0]["function"]["name"]
        call_number = len(selection_messages)
        return {
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {"id": f"call-{call_number}", "type": "function", "function": {"name": function_name, "arguments": f'{{"query":"round {call_number}"}}'}}
                        ]
                    }
                }
            ]
        }

    def fake_call_mcp_tool(server, tool_name, arguments, settings):
        return {"status": "success", "result": {"items": [{"title": f"result {arguments['query']}"}]}}

    async def fake_stream_openai_with_messages(settings, payload, messages):
        final_messages.extend(messages)
        tool_messages = [message for message in messages if message.get("role") == "tool"]
        assert [message["tool_call_id"] for message in tool_messages] == ["call-1", "call-2"]
        assert "result round 1" in tool_messages[0]["content"]
        assert "result round 2" in tool_messages[1]["content"]
        yield {"event": "message:chunk", "data": {"content": "两轮工具结果已整合"}}

    monkeypatch.setattr("app.providers.CHAT_MCP_TOOL_LOOP_MAX_ROUNDS", 2)
    monkeypatch.setattr("app.providers.openai_chat_completion_json_with_messages", fake_openai_tool_selection)
    monkeypatch.setattr("app.providers.call_mcp_tool", fake_call_mcp_tool)
    monkeypatch.setattr("app.providers._stream_openai_with_messages", fake_stream_openai_with_messages)

    stream = client.post(
        "/api/chat/stream",
        headers=headers,
        json={
            "profile_id": "profile-main",
            "mcp_server_ids": ["bigmodel-web-search"],
            "messages": [{"role": "user", "content": "连续搜索两轮"}],
        },
    )

    assert stream.status_code == 200, stream.text
    body = stream.text
    assert body.count("event: tool:start") == 2
    assert body.count("event: tool:result") == 2
    assert '"round":1' in body
    assert '"round":2' in body
    assert "两轮工具结果已整合" in body
    assert len(selection_messages) == 2
    assert len([message for message in final_messages if message.get("role") == "tool"]) == 2


def sign_up(client: TestClient, prefix: str) -> dict:
    response = client.post(
        "/api/auth/sign-up",
        json={
            "username": f"{prefix}-user",
            "email": f"{prefix}@example.com",
            "password": "password123",
            "display_name": prefix.title(),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()
