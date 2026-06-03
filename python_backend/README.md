# Python Backend

Python/FastAPI backend for 4Ever. This directory is the migration target for replacing the Go backend while preserving the frontend API contract.

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
- `POST /api/catalog/provider/test`
- `POST /api/catalog/provider/models`
- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/images/generate`
- `GET /api/maps/tencent/config`
- `GET /api/maps/tencent/city-search`
- Auth, profile, avatar, cover, password, and user search endpoints under `/api/auth`
- Friend request and direct message endpoints under `/api/chat`
- Admin overview, users, modules, MCP servers, agents, and audit log endpoints under `/api/admin`
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

Agent execution uses LangGraph `StateGraph`. SQLite table names and JSON payloads are kept compatible with the Go backend so the frontend and Token CLI can use the Python backend without API changes.

## Checks

```bash
cd python_backend
python3.11 -m pytest
```
