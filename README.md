# 4Ever

4Ever is a modular multi-model workspace. It starts with a clean AI workbench and grows toward one place for chat, image generation, provider aggregation, automation, and personal account space.

The application now runs on a Python/FastAPI backend. The previous backend surface has been reimplemented in Python, with the frontend API contract preserved and LangGraph used for Agent workflow execution.

## Features

- Independent module pages for Insight, Chat, Image, Provider Hub, Notes, Memory Map, Workflow, Inspiration, and Admin.
- Auth flow with standalone Sign in / Sign up pages.
- Provider aggregation with API key visibility, connection testing, and model fetching.
- Chat interface with locally stored API profile selection.
- Image generation panel with provider, model, size, and prompt controls.
- Notes, city memories, workflow templates, and inspiration boards stored locally in the browser.
- Agent/MCP catalog endpoint, workflow UI, and backend-gated BigModel MCP client.
- Backend-owned MCP `tools/list` inspection for workflow MCP server controls.
- Admin MCP enablement controls with backend policy enforcement and audit logs.
- Python service with SQLite by default and a single backend runtime for auth, chat, admin, providers, token usage, Agent workflows, and MCP calls.

## TODO List

1. AI 聊天对象可视化
2. MiniMax 语音合成 -> 语音聊天

## Repository Layout

```text
.
├── python_backend/             # Python FastAPI backend
│   ├── app/                    # API routes, config, and LangGraph Agent runtime
│   ├── tests/                  # Python backend contract tests
│   ├── .env.example            # Backend environment example
│   └── pyproject.toml          # Python dependencies and pytest config
├── frontend/                   # React + Vite frontend
│   ├── src/
│   │   ├── assets/             # Global styles and visual assets
│   │   ├── *Panel.tsx          # Module panels
│   │   ├── App.tsx             # React application shell and routing
│   │   ├── services/           # API client functions
│   │   ├── types/              # Frontend TypeScript contracts
│   │   └── main.ts             # React app bootstrap
│   ├── .env.example            # Frontend environment example
│   ├── package.json            # Frontend scripts and dependencies
│   ├── vite.config.ts          # Vite dev server and proxy config
│   └── README.md               # Frontend-specific notes
├── deploy/                     # Docker Compose and Caddy config
├── deploy.sh                   # Maintainer server deployment helper
├── .gitignore                  # Local runtime/build artifacts excluded from Git
└── README.md                   # Project overview
```

## Development

Run the Python backend:

```bash
cd python_backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --host 127.0.0.1 --port 7778
```

Run the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open the app at:

```text
http://127.0.0.1:7777
```

The Vite dev server proxies `/api` and `/health` to `http://127.0.0.1:7778`.

## Environment

Backend configuration can live in either the project root `.env` or `python_backend/.env`, based on `python_backend/.env.example`.

```env
DATABASE_URL=sqlite:///./4ever.db
BIGMODEL_API_KEY=
BIGMODEL_MCP_LIVE=0
AGENT_SYNTHESIS_LIVE=0
AGENT_GRAPH_RUNTIME=langgraph
```

Frontend configuration lives in `frontend/.env` and can be based on `frontend/.env.example`.

## Useful Checks

```bash
cd frontend
npm run build
```

```bash
cd python_backend
python3.11 -m pytest
```

```bash
curl http://127.0.0.1:7778/health
curl http://127.0.0.1:7778/api/database/health
```

## Local Docker Deployment

For a local Docker deployment, you only need Docker with Compose support. The stack builds the FastAPI backend and a Caddy-powered frontend/reverse-proxy container.

Create the Docker environment file:

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

Then build and start:

```bash
docker compose build
docker compose up -d
```

Open:

```text
http://127.0.0.1:7777
```

Check health:

```bash
curl http://127.0.0.1:7777/health
curl http://127.0.0.1:7777/api/database/health
```

Stop containers while keeping data:

```bash
cd deploy
docker compose down
```

Delete containers and local Docker volume data:

```bash
cd deploy
docker compose down -v
```

`deploy/.env` is ignored by Git. Keep `MODEL_PROFILE_ENCRYPTION_KEY` stable if you want saved model profile keys to remain decryptable across restarts.

## Agent / MCP Workflow

See [docs/agent-mcp-workflow.md](docs/agent-mcp-workflow.md) for the Python Agent, LangGraph, and BigModel MCP workflow implementation.

## Git Notes

Runtime files are intentionally ignored, including local databases, `.env` files, `node_modules/`, Vite `dist/`, and local agent artifacts. Keep generated secrets and local SQLite files out of commits.
