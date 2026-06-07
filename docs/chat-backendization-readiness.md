# Chat Backendization Readiness

This note tracks the current state of the chat backendization work and the rollout checks for online/offline compatibility.

## Current State

- AI contacts are backend records in `ai_personas`, scoped by `user_id`. Authenticated chat can send `persona_id` or `contact_id`; the backend resolves the contact name, role, notes, default model profile, and memory strategy. Persona `default_profile_id` values are validated against the same owner-scoped, enabled model profile store before they are saved.
- Model profiles are backend records in `model_profiles`, scoped by `user_id` for authenticated users. Authenticated responses do not reveal API key values; the backend decrypts keys only for runtime provider calls.
- Existing authenticated plaintext model keys are migrated into `api_key_encrypted` during database migration. Legacy anonymous/global profiles keep plaintext compatibility for local offline use.
- Long-term memory is stored in `ai_memories` and exposed through retain, recall, and delete endpoints. Chat recall injects a small memory block before provider execution; retain and recall-retain can write simple preference memories after chat.
- Persona and memory mutations emit privacy-bounded audit rows. Audit details include ids, source/strategy, and character counts, but not persona notes, memory bodies, metadata values, or API keys.
- Chat runs are persisted in `chat_runs` with `run_id`, sanitized message snapshots, usage, selected MCP servers, and stored SSE events. Replay is scoped by the current user.
- Ordinary chat can use MCP servers. Planned mode injects tool context before the model call; live mode can use native tool/function loops for OpenAI-compatible, Anthropic, and Gemini requests.
- Attachments are stored under `private_media_root`, owner-scoped, and can be exposed through signed temporary URLs. Vision-capable AI requests turn owner-visible images into provider image inputs. Text/PDF attachments get extracted chunks for prompt context and citations. Direct-message attachments also use the private upload store; direct message rows persist attachment ids/metadata and sender/recipient responses receive signed temporary URLs instead of embedded data URLs.
- OpenAI-compatible, Anthropic, and Gemini chat streaming use native provider stream endpoints for ordinary chat.
- Image generation can use authenticated backend-owned `profile_id` resolution for encrypted model profile keys; legacy direct-key payloads remain available for local independent image configuration.

## Compatibility Boundary

- Authenticated online users should rely on backend-owned `profile_id` and `persona_id`; the browser should not need to send raw API keys or full AI-contact prompts.
- Frontend chat payloads with `profile_id` are id-first: they send profile/persona ids plus memory, MCP, attachments, and messages, while provider runtime fields stay on the backend.
- When an authenticated chat session finds no backend model profiles but does have usable local profiles, the chat panel imports the local profiles through `PUT /api/catalog/model-profiles` before marking them backend-owned. This preserves local-to-online migration while moving subsequent chat sends onto the id-first path.
- Frontend image-generation payloads with backend-owned profiles are also id-first: they send `profile_id`, prompt, image model, and size, while provider URL/key fields stay on the backend.
- Anonymous/local offline mode is still supported for legacy localStorage profiles and client-side prompt compatibility. This path is intentionally not treated as the online security boundary.
- `system_prompt` remains accepted as a compatibility field, but backend-owned persona/profile prompts take precedence once a valid `profile_id` or `persona_id` is supplied.
- Global legacy model/persona storage with empty `user_id` remains available only when `ALLOW_LEGACY_GLOBAL_MODEL_PROFILES=1` or the backend is running with loopback host and loopback CORS origins. Authenticated users resolve `user_id:public_id` storage ids instead.

## Rollout Checks

- Set `MODEL_PROFILE_ENCRYPTION_KEY` before production launch. Without it, local development can still decrypt using the deterministic local fallback, but production key rotation and portability are weak.
- Set `CHAT_ATTACHMENT_URL_SECRET` before enabling temporary attachment URLs outside local development.
- Keep `BIGMODEL_MCP_LIVE=0` unless live backend MCP calls are intended. Planned MCP mode remains useful for UI and workflow compatibility without external calls.
- Run database migration once before serving traffic and confirm authenticated rows in `model_profiles` have empty `api_key` and non-empty `api_key_encrypted`.
- Set `ALLOW_LEGACY_GLOBAL_MODEL_PROFILES=0` for public deployments; leave it enabled only for local offline compatibility.
- Verify `GET /api/chat/runs` and `GET /api/chat/runs/{run_id}/events` with two different users before enabling run replay in production UI.
- Verify private attachment downloads, direct-message attachment responses, chunk detail, and temporary URLs with owner, non-owner, recipient, and anonymous requests.
- Verify admin audit review with a non-admin user creating/updating/deleting an AI persona and memory. The audit rows should show actor/action/target metadata while omitting prompt notes, memory content, metadata values, and secrets.

## Focused Verification

```bash
cd python_backend
./.venv/bin/python -m pytest tests/test_providers.py
./.venv/bin/python -m pytest tests/test_backend_contracts.py
```

For a wider gate before release:

```bash
cd python_backend && ./.venv/bin/python -m pytest
cd ../frontend && npm run build
```
