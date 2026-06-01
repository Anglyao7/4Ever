# Backend

Go service for 4Ever API routing, auth, workflow, chat, admin, image, map, and token usage endpoints.

## Run

```bash
go run ./cmd/server
```

## API

- `GET /health`
- `GET /api/database/health`
- `GET /api/catalog/providers`
- `POST /api/chat`
- `POST /api/chat/stream`
- `GET /api/modules`
- `GET /api/agents/catalog`
- `GET /api/agents/mcp/{server_id}/tools`
- `POST /api/agents/mcp/{server_id}/tools/call`
- `GET /api/admin/mcp-servers`
- `PATCH /api/admin/mcp-servers/{server_id}`
- `GET /api/admin/agents`
- `PATCH /api/admin/agents/{agent_id}`
- `POST /api/agents/runs`
- `POST /api/agents/runs/stream`
- `GET /api/agents/runs`
- `GET /api/agents/runs/{run_id}`
- `PATCH /api/agents/runs/{run_id}/review`
- `POST /api/agents/runs/{run_id}/cancel`
- `POST /api/agents/runs/{run_id}/resume`
- `GET /api/agents/runs/{run_id}/checkpoint`
- `GET /api/agents/runs/{run_id}/checkpoints`
- `GET /api/agents/runs/{run_id}/events`
- `GET /api/token-usage/keys`
- `POST /api/token-usage/keys`
- `POST /api/token-usage/ingest`
- `GET /api/token-usage/dashboard`
- `GET /api/token-usage/leaderboard`

## Agent / MCP

BigModel MCP keys stay on the backend. Planned mode is the default; set live mode only when remote MCP tool calls should be attempted.

Admin MCP controls can enable or disable individual backend-owned MCP servers. Disabled servers stay visible in the catalog for UI explanation, and backend tool inspection and workflow run creation reject them.

```bash
BIGMODEL_API_KEY=...
BIGMODEL_MCP_LIVE=1
MCP_TIMEOUT_SECONDS=30
MCP_RESULT_MAX_CHARS=3000
AGENT_SYNTHESIS_LIVE=1
AGENT_SYNTHESIS_PROVIDER=openai
AGENT_SYNTHESIS_BASE_URL=https://api.openai.com/v1
AGENT_SYNTHESIS_API_KEY=...
AGENT_SYNTHESIS_MODEL=gpt-4.1-mini
AGENT_GRAPH_RUNTIME=auto
```

`AGENT_GRAPH_RUNTIME` is retained for configuration compatibility. The Go backend uses the internal workflow runtime.

## Database

Set `DATABASE_URL` before starting the service.

Examples:

```bash
DATABASE_URL=sqlite:///./4ever.db
DATABASE_URL=postgresql+psycopg://user:password@127.0.0.1:5432/4ever
```

On startup the backend runs GORM auto migration for the existing table names used by the previous backend. It does not delete existing rows.

## Checks

```bash
go test ./...
```
