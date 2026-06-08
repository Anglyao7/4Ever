<div align="center">

# 4Ever

**A modular multi-model workspace for chat, agents, memory, automation, and personal AI usage analytics.**

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=111111)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docs.docker.com/compose/)

</div>

---

## What Is 4Ever?

4Ever is a Python/FastAPI + React workspace that starts as an AI workbench and grows into a personal AI operating surface:

| Area | What It Does |
| --- | --- |
| **Chat** | Multi-provider AI chat with personas, memory, streaming events, attachments, citations, and MCP tool events. |
| **Provider Hub** | Manage model profiles, provider base URLs, API keys, fallback models, and vision capability. |
| **Workflow** | Agent/MCP workflow surface backed by the Python runtime and LangGraph-style execution. |
| **Token Usage** | Local CLI collector, dashboard, heatmap, leaderboard, and device/key management. |
| **Image / Notes / Map / Inspiration** | Personal creation and memory surfaces sharing the same account and backend. |
| **Admin** | Modules, users, MCP server policy, readiness checks, and audit records. |

The original backend surface has been reimplemented in Python while preserving the frontend API contract. SQLite is the default storage engine, so the project can run locally without extra infrastructure.

## Highlights

- **FastAPI backend** for auth, chat, providers, image generation, token usage, admin, and Agent workflows.
- **React + Vite frontend** with modular panels for Chat, Provider Hub, Workflow, Token Usage, Notes, Maps, Inspiration, and Admin.
- **Streaming chat event protocol** covering chunks, errors, tool calls, token usage, citations, and replayable run events.
- **Backend-owned model profiles** with user scoping and encrypted model API keys.
- **Persona and memory support** for more stable AI contacts and longer-running chat context.
- **Private attachment storage** with owner-scoped downloads, signed temporary URLs, and lightweight document chunk retrieval.
- **MCP-ready runtime** with BigModel MCP planned/live modes and admin-controlled allowlists.
- **Docker Compose deployment** with a Caddy frontend/reverse-proxy container and persistent Docker volumes.
- **Token CLI** for syncing local AI coding token usage to the 4Ever dashboard.

## Screens

The app is organized as a workspace rather than a single-purpose chat page.

```text
Chat  | Provider Hub | Workflow | Token Usage | Notes | Memory Map | Inspiration | Admin
```

If you add screenshots later, place them under `docs/images/` and reference them here.

## Quick Start

### 1. Backend

```bash
cd python_backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --host 127.0.0.1 --port 7778
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:7777
```

The Vite dev server proxies `/api` and `/health` to `http://127.0.0.1:7778`.

## Local Docker Deployment

Use this when you want a local containerized deployment instead of two dev servers.

```bash
cd deploy
cp .env.example .env
```

Edit `deploy/.env` for local HTTP:

```env
SITE_ADDRESS=:80
HTTP_PORT=7777
HTTPS_PORT=7443
VITE_API_BASE_URL=

CORS_ORIGINS=http://localhost:7777,http://127.0.0.1:7777
ALLOW_LEGACY_GLOBAL_MODEL_PROFILES=0

MODEL_PROFILE_ENCRYPTION_KEY=local-dev-stable-key
CHAT_ATTACHMENT_URL_SECRET=local-dev-attachment-secret
```

Build and start:

```bash
docker compose build
docker compose up -d
```

Open:

```text
http://127.0.0.1:7777
```

Health checks:

```bash
curl http://127.0.0.1:7777/health
curl http://127.0.0.1:7777/api/database/health
```

Stop while keeping data:

```bash
cd deploy
docker compose down
```

Delete local Docker data:

```bash
cd deploy
docker compose down -v
```

`deploy/.env` is ignored by Git. Keep `MODEL_PROFILE_ENCRYPTION_KEY` stable if you want saved model profile keys to remain decryptable across restarts.

## Token Usage CLI

Install the CLI:

```bash
npm install -g @anglyaoy/token-usage
```

Bind to the hosted 4Ever instance and sync once:

```bash
forever-token init
```

For local development:

```bash
forever-token init local
```

Set up automatic sync:

```bash
forever-token service setup
```

## Configuration

Backend configuration can live in either the project root `.env` or `python_backend/.env`, based on `python_backend/.env.example`.

```env
DATABASE_URL=sqlite:///./4ever.db
BIGMODEL_API_KEY=
BIGMODEL_MCP_LIVE=0
AGENT_SYNTHESIS_LIVE=0
AGENT_GRAPH_RUNTIME=langgraph
```

Frontend configuration lives in `frontend/.env` and can be based on `frontend/.env.example`.

## Repository Layout

```text
.
├── python_backend/             # Python FastAPI backend
│   ├── app/                    # API routes, config, and Agent runtime
│   ├── tests/                  # Backend contract tests
│   ├── .env.example            # Backend environment example
│   └── pyproject.toml          # Python dependencies and pytest config
├── frontend/                   # React + Vite frontend
│   ├── src/                    # Panels, services, types, and app shell
│   ├── .env.example            # Frontend environment example
│   ├── package.json            # Frontend scripts and dependencies
│   └── vite.config.ts          # Vite dev server and proxy config
├── deploy/                     # Docker Compose, Caddy, and deploy env example
├── token-usage-cli/            # forever-token CLI package
├── docs/                       # Research and implementation notes
├── deploy.sh                   # Maintainer server deployment helper
└── README.md
```

## Checks

Frontend:

```bash
cd frontend
npm run build
```

Backend:

```bash
cd python_backend
python3.11 -m pytest
```

Health:

```bash
curl http://127.0.0.1:7778/health
curl http://127.0.0.1:7778/api/database/health
```

## Star History

<a href="https://www.star-history.com/#Anglyao7/4Ever&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Anglyao7/4Ever&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Anglyao7/4Ever&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Anglyao7/4Ever&type=Date" />
  </picture>
</a>

## Notes

- Runtime files are intentionally ignored: local databases, `.env` files, `node_modules/`, Vite `dist/`, and generated media.
- Keep secrets out of commits.
- See [docs/agent-mcp-workflow.md](docs/agent-mcp-workflow.md) for Agent, LangGraph, and BigModel MCP workflow details.
