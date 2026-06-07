# Python Backend

Python/FastAPI backend for 4Ever. This is the active backend runtime for auth, chat, providers, images, maps, admin, token usage, Agent workflows, and backend-owned MCP calls.

## Run

```bash
cd python_backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --host 127.0.0.1 --port 7778
```

## API Coverage

- `GET /health`
- `GET /api/database/health`
- `GET /api/modules`
- `GET /api/catalog/providers`
- `GET /api/catalog/model-profiles`
- `PUT /api/catalog/model-profiles`
- `POST /api/catalog/provider/test`
- `POST /api/catalog/provider/models`
- `POST /api/chat`
- `POST /api/chat/stream`
- `GET /api/chat/personas`
- `POST /api/chat/personas`
- `DELETE /api/chat/personas/{persona_id}`
- `POST /api/chat/memory/retain`
- `GET /api/chat/memory/recall`
- `DELETE /api/chat/memory/{memory_id}`
- `POST /api/chat/attachments`
- `GET /api/chat/attachments/{attachment_id}`
- `DELETE /api/chat/attachments/{attachment_id}`
- `POST /api/chat/attachments/{attachment_id}/temporary-url`
- `GET /api/chat/attachments/{attachment_id}/temporary`
- `GET /api/chat/runs`
- `GET /api/chat/runs/{run_id}/events`
- `POST /api/images/generate`
- `GET /api/maps/tencent/config`
- `GET /api/maps/tencent/city-search`
- Auth, profile, avatar, cover, password, and user search endpoints under `/api/auth`
- Friend request and direct message endpoints under `/api/chat`
- Admin overview, users, modules, MCP servers, agents, and audit log endpoints under `/api/admin`
- `GET /api/admin/readiness`
- `POST /api/admin/chat-attachments/migrate-private`
- `POST /api/admin/chat-attachments/cleanup-orphans`
- Token Usage key, ingest, dashboard, and leaderboard endpoints under `/api/token-usage`
- `GET /api/agents/catalog`
- `GET /api/agents/mcp/{server_id}/tools`
- `POST /api/agents/mcp/{server_id}/tools/call`
- `POST /api/agents/runs`
- `POST /api/agents/runs/stream`
- `GET /api/agents/runs`
- `GET /api/agents/runs/{run_id}`
- `GET /api/agents/runs/{run_id}/events`
- `PATCH /api/agents/runs/{run_id}/review`
- `POST /api/agents/runs/{run_id}/cancel`
- `POST /api/agents/runs/{run_id}/resume`
- `GET /api/agents/runs/{run_id}/checkpoint`
- `GET /api/agents/runs/{run_id}/checkpoints`

Agent execution uses LangGraph `StateGraph`. SQLite table names and JSON payloads are kept stable so the frontend and Token CLI can use the Python backend without API changes. Agent run records, node results, checkpoints, and SSE replay redact secret-like text and embedded data URLs before returning or persisting workflow output; long node output is stored as a bounded preview with `output_truncated=true`.

MCP runs in planned mode by default. Set `BIGMODEL_API_KEY` and `BIGMODEL_MCP_LIVE=1` only when the backend should make live remote BigModel MCP calls. API keys stay in backend environment variables and are never sent to the frontend.

Model profiles are user-scoped when an auth token is present. Local unauthenticated development keeps using the legacy global profile scope for compatibility. `ALLOW_LEGACY_GLOBAL_MODEL_PROFILES` defaults on only for loopback host/CORS settings; set it to `0` for public deployments and to `1` only for local offline compatibility. Set a stable `MODEL_PROFILE_ENCRYPTION_KEY` before production deploys; changing it later prevents decrypting stored model API keys. Authenticated chat can import usable local profiles into backend storage when no backend profiles exist yet, so local-to-online migration still works while subsequent chat payloads use `profile_id`.

Image generation accepts either the legacy direct provider/base URL/API key payload or an authenticated `profile_id`. When `profile_id` is used, the backend resolves the owner-scoped encrypted model profile key and the frontend only sends image prompt/model/size fields.

Direct AI chat now stores lightweight run events in `chat_runs` for authenticated users and legacy local mode, supports backend persona records, memory retain/recall, non-sensitive `thought:summary` stage events, source reference and citation-check events, planned/live MCP tool events, backend-cached MCP `tools/list` schemas for chat tool definitions, bounded multi-round OpenAI-compatible, Anthropic, and Gemini live MCP tool-call loops using native provider transcripts, image attachments for vision-capable OpenAI-compatible (`image_url`), Anthropic (`image` source), and Gemini (`inline_data`) profiles, and native streaming branches for OpenAI-compatible, Anthropic, and Gemini providers. When `ALLOW_LEGACY_GLOBAL_MODEL_PROFILES=0`, anonymous direct-key chat remains usable but run events use an ephemeral `run_id` and are not written to `chat_runs` or `ai_memories`. Direct-message attachments reuse the private chat attachment store and direct message rows persist ids/metadata instead of embedded data URLs; sender/recipient responses include signed temporary URLs for preview or download. Persona and memory create/update/delete operations write privacy-bounded audit rows with ids, source/strategy, and character counts only; prompt notes, memory contents, metadata values, and API keys are not copied into audit details. Every live SSE and replayed chat event payload includes `run_id`, so frontend timelines can correlate `run:start`, chunks, tools, citations, usage, terminal success, and terminal error events without event-type-specific inference. Live `run:error` events and replayed `run:error` events use the same redacted payload. `chat_runs.messages_json` stores a redacted message snapshot: attachment metadata is preserved, but image data URLs, attachment text excerpts, and document chunk bodies are not persisted in the run record. Tool event payloads are also bounded for UI/replay: `tool:start.arguments` and `tool:result.result` redact data URLs and secret-like keys, and long tool results are persisted as a short preview with `result_truncated=true`; the internal provider transcript still receives the tool result returned by the MCP client.

Persona `default_profile_id` links are validated at save time against the same user-scoped model profile table, and disabled or missing profiles are rejected before they can become a runtime default.

Provider native streaming is covered by local HTTP mock tests for OpenAI-compatible, Anthropic, and Gemini request URLs, provider-specific auth headers, request bodies, SSE chunks, and usage events. These tests prove local protocol compatibility without requiring real API keys; production deploys should still run external smoke tests against the configured providers.

MCP live transport is covered by local JSON-RPC mock tests for initialize, session propagation, `notifications/initialized`, `tools/list`, `tools/call`, JSON responses, SSE responses, Bearer auth, schema cache writes, and MCP result redaction/trimming. Provider and MCP HTTP error bodies are also covered for secret-like text and embedded data URL redaction before model-list responses, non-stream chat errors, live SSE, replay, or failed tool payloads expose them. These tests prove the backend protocols locally without requiring external credentials; production deploys should still run external provider and BigModel MCP smoke tests when live integrations are enabled.

## External AI Runtime Smoke

Run the optional external smoke runner before enabling live provider or BigModel MCP integrations in production:

```bash
cd python_backend
source .venv/bin/activate
python scripts/ai_runtime_smoke.py
```

The runner skips checks whose environment variables are missing and prints non-sensitive JSON only. Provider streaming checks use `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY`, with optional `*_BASE_URL` and `*_MODEL` overrides. BigModel MCP checks require `BIGMODEL_API_KEY` and `BIGMODEL_MCP_LIVE=1`; they run `tools/list` for `AI_RUNTIME_SMOKE_MCP_SERVERS` and only call tools explicitly listed in `AI_RUNTIME_SMOKE_MCP_TOOL_CALLS` as semicolon-separated `server_id|tool_name|source` entries. Example:

```bash
AI_RUNTIME_SMOKE_MCP_TOOL_CALLS='bigmodel-web-search|webSearchPrime|4Ever AI chat runtime smoke' \
python scripts/ai_runtime_smoke.py
```

The smoke output reports `success`, `skipped`, or `failed`, event counts, tool counts, and redacted error summaries. It does not print prompts, model responses, MCP result bodies, API keys, Bearer tokens, or embedded data URLs.

Logged-in AI chat attachments should be uploaded through `POST /api/chat/attachments`. The upload endpoint requires auth, stores files below `PRIVATE_MEDIA_ROOT/CHAT_ATTACHMENT_UPLOAD_DIRNAME/{user_id}`, records metadata in `chat_attachments`, and later hydrates only the owning user's attachments into provider request bodies. Image attachments can become vision inputs; `text/plain`, `text/markdown`, `application/json`, and parseable `application/pdf` attachments store a bounded text excerpt and lightweight `chat_document_chunks` records for owner-scoped retrieval during chat. When SQLite FTS5 is available, the backend also maintains `chat_document_chunks_fts` and ranks query matches with BM25; if FTS5 is unavailable or a query cannot run, retrieval falls back to the existing bounded keyword scoring path. Retrieved chunks receive stable refs such as `attachment-id#chunk2`, are included in the provider prompt, and are emitted as non-sensitive `source:references` run events for timeline/replay. When retrieved chunks exist, the backend asks the model to mark used excerpts with `[ref]` and append a final `引用：[ref1, ref2]` line, then emits a lightweight `source:citation-check` event after the final answer to record cited, missing, unknown, inline, and structured citation refs. `GET /api/chat/attachments/{attachment_id}/chunks` searches owner-scoped chunks, and `GET /api/chat/document-chunks/{ref}` returns a single owner-scoped citation detail. PDF extraction uses `pypdf` for the first 12 pages and falls back to metadata if the parser is unavailable or the file cannot be parsed. `GET /api/chat/attachments/{attachment_id}` provides owner-scoped authenticated download access, and `DELETE /api/chat/attachments/{attachment_id}` removes the owner record, stored file, and document chunks. `POST /api/chat/attachments/{attachment_id}/temporary-url` returns a short-lived signed URL for browser-friendly downloads; set a stable `CHAT_ATTACHMENT_URL_SECRET` and tune `CHAT_ATTACHMENT_URL_TTL_SECONDS` before production deploys. Admins can dry-run and execute `POST /api/admin/chat-attachments/migrate-private` to move legacy public chat attachments into private storage, and `POST /api/admin/chat-attachments/cleanup-orphans` to remove unreferenced files after review. Local unauthenticated development can still send data URLs for compatibility. Current scope is private local file storage, temporary signed local URLs, owner deletion, admin-managed legacy migration/orphan cleanup, image hydration for vision models, lightweight document chunk retrieval with optional FTS5/BM25 ranking, source reference events, citation detail UI, structured citation-list parsing, and lexical citation presence checks; object storage/OCR/vector RAG/semantic citation verification/hard cited-answer schema enforcement are not implemented yet.

`GET /api/admin/readiness` is an admin-only deployment check for production readiness. It reports non-sensitive `ok` / `warning` / `error` checks for database reachability, stable AI-profile and attachment URL secrets, private attachment storage isolation/writability, temporary URL TTL, SQLite FTS5 availability, `pypdf`, BigModel MCP live configuration, and CORS origin presence. It intentionally returns only status flags, counts, and error types; it does not return API keys, raw secret values, or configured filesystem paths.

## Checks

```bash
cd python_backend
python3.11 -m pytest
```
