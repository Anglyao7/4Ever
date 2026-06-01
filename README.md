# 4Ever

4Ever is a modular multi-model workspace. It starts with a clean AI workbench and grows toward one place for chat, image generation, provider aggregation, automation, and personal account space.

The current application includes a Go backend, a React + Vite frontend, authentication, provider management, chat, image generation, notes, memory map, workflow, inspiration, and admin modules.

## Features

- Independent module pages for Insight, Chat, Image, Provider Hub, Notes, Memory Map, Workflow, Inspiration, and Admin.
- Auth flow with standalone Sign in / Sign up pages.
- Provider aggregation with API key visibility, connection testing, and model fetching.
- Chat interface with locally stored API profile selection.
- Image generation panel with provider, model, size, and prompt controls.
- Notes, city memories, workflow templates, and inspiration boards stored locally in the browser.
- Go service with SQLite by default and support for PostgreSQL URLs.

## TODO List

1. AI 聊天对象可视化
2. MiniMax 语音合成 -> 语音聊天
3. 笔记模块
4. 全局 AI 代理工作流

## Repository Layout

```text
.
├── backend/                    # Go backend service
│   ├── cmd/server              # Go app entrypoint
│   ├── internal/               # API routes, services, configuration, and database models
│   ├── .env.example            # Backend environment example
│   ├── go.mod                  # Go module dependencies
│   └── README.md               # Backend-specific notes
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
├── .gitignore                  # Local runtime/build artifacts excluded from Git
└── README.md                   # Project overview
```

## Development

Run the backend:

```bash
cd backend
go run ./cmd/server
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

Backend configuration lives in `backend/.env` and can be based on `backend/.env.example`.

```env
DATABASE_URL=sqlite:///./4ever.db
```

Frontend configuration lives in `frontend/.env` and can be based on `frontend/.env.example`.

## Useful Checks

```bash
cd frontend
npm run build
```

```bash
cd backend
go test ./...
```

```bash
curl http://127.0.0.1:7778/health
curl http://127.0.0.1:7778/api/database/health
```

## Git Notes

Runtime files are intentionally ignored, including local databases, `.env` files, `node_modules/`, Vite `dist/`, and local agent artifacts. Keep generated secrets and local SQLite files out of commits.
