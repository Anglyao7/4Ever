# 4Ever Agent / MCP / Go Graph Workflow

This document describes the Go implementation of the 4Ever Agent/MCP workflow layer. The previous graph design has been replaced by a Go backend with an internal graph runtime that keeps the same product contract: backend-owned tools, durable run history, checkpoints, SSE events, and resumable workflow provenance.

## Current Baseline

- Frontend: React + Vite workflow UI at `/automation`, implemented by `frontend/src/WorkflowPanel.tsx`.
- Backend: Go service under `backend/`, with Agent/MCP routing in `backend/internal/agents`.
- Catalog API: `GET /api/agents/catalog`.
- Secret boundary: browser clients receive server ids, endpoint metadata, tool names, enablement state, and live/planned state. Raw MCP API keys stay in backend environment variables.

## Implemented Backend Surface

The Go backend ships the Agent/MCP layer as a first-class backend module:

- Local catalog of Agent blueprints, workflow policies, workflow templates, and BigModel MCP servers.
- Backend-owned MCP streamable HTTP JSON-RPC client for `tools/list` and `tools/call`.
- Agent/template/MCP allowlist validation before execution.
- Admin MCP enablement controls and Agent prompt override controls with audit logs.
- Internal Go graph executor with deterministic graph steps, retry events, run events, per-step checkpoints, and resume support.
- Persisted workflow run records in `workflow_agent_runs` and durable per-step rows in `workflow_agent_checkpoints`.
- SSE creation and replay endpoints for workflow progress and history hydration.

## BigModel MCP Notes

BigModel exposes remote MCP servers over HTTP. The starting servers are:

| Server | Purpose | Endpoint | Tools | Auth |
| --- | --- | --- | --- | --- |
| BigModel Web Search Prime | Search and current-context research | `https://open.bigmodel.cn/api/mcp/web_search_prime/mcp` | `webSearchPrime` | `Authorization: Bearer <BIGMODEL_API_KEY>` |
| BigModel Web Reader | Read web pages into agent context | `https://open.bigmodel.cn/api/mcp/web_reader/mcp` | `webReader` | `Authorization: Bearer <BIGMODEL_API_KEY>` |
| BigModel ZRead | Read repository/code knowledge | `https://open.bigmodel.cn/api/mcp/zread/mcp` | `search_doc`, `get_repo_structure`, `read_file` | `Authorization: Bearer <BIGMODEL_API_KEY>` |

Configure the Go backend with:

```env
BIGMODEL_API_KEY=
BIGMODEL_MCP_LIVE=0
MCP_TIMEOUT_SECONDS=30
MCP_RESULT_MAX_CHARS=3000
AGENT_SYNTHESIS_LIVE=0
AGENT_SYNTHESIS_PROVIDER=openai
AGENT_SYNTHESIS_BASE_URL=
AGENT_SYNTHESIS_API_KEY=
AGENT_SYNTHESIS_MODEL=
AGENT_GRAPH_RUNTIME=auto
```

Planned mode is the default. Set `BIGMODEL_MCP_LIVE=1` only when backend-hosted live MCP calls should run. Catalog responses expose `configured` and `live_enabled` so the UI can show readiness without exposing secrets.

`AGENT_GRAPH_RUNTIME` remains accepted for compatibility with earlier configuration. The Go backend always reports and uses the internal graph runtime.

## Product Model

4Ever treats Agent/MCP as four layers:

1. Agent blueprint: role, model hint, prompt version/checksum, system prompt, allowed MCP servers, allowed workflow templates.
2. MCP server: provider, endpoint, transport, auth mode, required backend env var, enablement, configured state, tags.
3. Workflow policy: execution mode, review requirement, side-effect labels, retry limit, timeout, and audit level.
4. Workflow run: selected template, input, Agent, MCP servers, graph steps, node results, events, and checkpoints.

The key templates are:

| Template | Graph steps |
| --- | --- |
| `agent-research-brief` | `load_agent -> mcp_search -> mcp_read -> synthesize -> persist` |
| `agent-repo-brief` | `load_agent -> mcp_repo_search -> mcp_repo_structure -> mcp_read_file -> synthesize -> persist` |
| `canvas-workflow` | Canvas-derived ordered graph nodes plus `persist` |
| `note-copy` | `source -> transform -> copy -> persist` |
| `note-message` | `source -> chat -> persist` |

## Go Backend Modules

```text
backend/
├── cmd/server/main.go                  # Go app entrypoint
├── internal/agents/catalog.go          # Agent, MCP, policy, and template registry
├── internal/agents/http.go             # Agent/MCP handlers, graph execution, MCP client, SSE, checkpoints
├── internal/admin/admin.go             # Admin MCP and Agent prompt controls
├── internal/models/models.go           # GORM models, including run/checkpoint records
├── internal/database/database.go       # migration and compatibility schema updates
└── internal/server/server.go           # route composition
```

Implemented endpoints:

```text
GET  /api/agents/catalog
GET  /api/agents/mcp/{server_id}/tools
POST /api/agents/mcp/{server_id}/tools/call
GET  /api/admin/mcp-servers
PATCH /api/admin/mcp-servers/{server_id}
GET  /api/admin/agents
PATCH /api/admin/agents/{agent_id}
POST /api/agents/runs
POST /api/agents/runs/stream
GET  /api/agents/runs
GET  /api/agents/runs/{run_id}
PATCH /api/agents/runs/{run_id}/review
POST /api/agents/runs/{run_id}/cancel
POST /api/agents/runs/{run_id}/resume
GET  /api/agents/runs/{run_id}/checkpoint
GET  /api/agents/runs/{run_id}/checkpoints
GET  /api/agents/runs/{run_id}/events
```

Run payload:

```json
{
  "template_id": "agent-research-brief",
  "agent_id": "research-agent",
  "mcp_server_ids": ["bigmodel-web-search", "bigmodel-web-reader"],
  "input": {
    "topic": "..."
  },
  "source": "manual"
}
```

## Graph Runtime Contract

The Go runtime deliberately mirrors the previous durable-agent contract:

- Every run receives a `thread_id`.
- Every persisted run receives a deterministic `checkpoint_id`.
- Every node result includes `node_id`, `type`, `title`, `graph_step`, `status`, timestamps, and output.
- `workflow_agent_checkpoints` stores per-step state, node result JSON, and event snapshots.
- Failed or canceled runs can resume after the last contiguous successful graph step.
- Event streams use the same names for live creation and replay: `run.started`, `run.resumed`, `node.retry`, `node.finished`, `run.finished`, `run.failed`, and `run.cancelled`.

`GET /api/agents/runs/{run_id}/checkpoint` exposes aggregate inspection data, including completed steps, failed step, resumable step, event count, last event, and `graph_runtime` metadata.

## MCP Client Boundary

The Go MCP client:

- Reads API keys from environment variables only.
- Never echoes authorization headers or raw keys.
- Enforces catalog allowlists for MCP server ids and tool names.
- Initializes a streamable HTTP JSON-RPC session before tool calls.
- Sends `notifications/initialized` and reuses `Mcp-Session-Id` when returned.
- Parses JSON and SSE responses.
- Redacts and trims tool results before they enter node output.
- Returns planned results when credentials or live mode are unavailable.

## Admin Policy

- `GET /api/admin/mcp-servers` lists backend-owned MCP servers.
- `PATCH /api/admin/mcp-servers/{server_id}` enables or disables a server and writes `mcp.status.update`.
- Disabled servers remain visible in the catalog with `enabled: false` and `live_enabled: false`.
- Disabled servers reject tool inspection and workflow execution even if submitted directly.
- `GET /api/admin/agents` lists effective Agent blueprints.
- `PATCH /api/admin/agents/{agent_id}` stores prompt/version overrides and writes `agent.prompt.update`.
- New runs persist the effective prompt version and checksum for reproducible provenance.

## Frontend Behavior

The workflow UI should remain an operational tool:

- Show available templates, active Agent, eligible MCP servers, and policy metadata.
- Allow backend-owned MCP `tools/list` inspection and allowlisted tool calls.
- Clearly distinguish planned MCP calls, live MCP calls, backend runs, replayed events, and local preview fallback.
- Display graph provenance through `graph_step`, prompt version/checksum, checkpoint id, event count, and review state.
- Keep raw MCP keys out of localStorage, network payloads, and rendered DOM.

## Verification Checklist

- `cd backend && go test ./...` passes.
- `cd frontend && npm run build` passes.
- `cd token-usage-cli && node --check src/index.js` passes.
- `GET /api/agents/catalog` returns Agents, MCP servers, workflow policies, prompt checksums, and `graph_runtime.runtime = "internal"`.
- `GET /api/agents/mcp/{server_id}/tools` returns planned or live tool lists without exposing secrets.
- `POST /api/agents/mcp/{server_id}/tools/call` rejects non-allowlisted tools and disabled servers.
- `POST /api/agents/runs` persists run history, node results, graph steps, events, and checkpoints.
- `POST /api/agents/runs/stream` emits SSE events and persists the completed run.
- `GET /api/agents/runs/{run_id}/events` replays stored events.
- `GET /api/agents/runs/{run_id}/checkpoint` and `/checkpoints` return durable checkpoint inspection data.
- Disabled MCP servers are rejected by backend policy.
- Root-level script remnants and old backend artifacts are absent from the committed tree.

## References

- BigModel Web Search Prime MCP: https://docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server
- BigModel Web Reader MCP: https://docs.bigmodel.cn/cn/coding-plan/mcp/reader-mcp-server
- BigModel ZRead MCP: https://docs.bigmodel.cn/cn/coding-plan/mcp/zread-mcp-server
- BigModel GLM Coding Plan overview and MCP coverage: https://docs.bigmodel.cn/cn/coding-plan/overview
- MCP streamable HTTP transport: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- MCP lifecycle: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
