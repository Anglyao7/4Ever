# 4Ever

4Ever is a modular multi-model workspace. It starts with a clean AI workbench and grows toward one place for chat, image generation, provider aggregation, automation, and personal account space.

The current application includes a FastAPI backend, a Vue 3 frontend, authentication, provider management, a Telegram-inspired chat surface, image generation controls, and a `Self` module for profile, diary, and account settings.

## Features

- Independent module pages for Insight, Chat, Image, Aggregation, Automation, and Self.
- Auth flow with standalone Sign in / Sign up pages.
- Provider aggregation with API key visibility, connection testing, and model fetching.
- Chat interface designed around recent conversations and responsive mobile behavior.
- Image generation panel with simplified size presets.
- Personal Self module for profile, diary drafts, password changes, status, and preferences.
- FastAPI service with SQLite by default and support for PostgreSQL/MySQL URLs.

## TODO List

1. AI 聊天对象可视化
2. MiniMax 语音合成 -> 语音聊天
3. 笔记模块
4. 全局 AI 代理工作流

## Repository Layout

```text
.
├── backend/                    # FastAPI backend service
│   ├── app/
│   │   ├── api/routes/         # HTTP route modules: auth, chat, catalog, images, modules, health
│   │   ├── core/               # Runtime configuration
│   │   ├── db/                 # SQLAlchemy base, session, and database models
│   │   ├── schemas/            # Pydantic request/response schemas
│   │   ├── services/           # Auth helpers and AI provider client/adapters
│   │   └── main.py             # FastAPI app entrypoint
│   ├── .env.example            # Backend environment example
│   ├── requirements.txt        # Python dependencies
│   └── README.md               # Backend-specific notes
├── frontend/                   # Vue 3 + Vite frontend
│   ├── src/
│   │   ├── assets/             # Global styles and visual assets
│   │   ├── components/         # Module panels and shared UI components
│   │   ├── services/           # API client functions
│   │   ├── types/              # Frontend TypeScript contracts
│   │   ├── views/              # Main workspace view
│   │   └── main.ts             # Vue app bootstrap
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
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Run the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open the app at:

```text
http://127.0.0.1:5173
```

The Vite dev server proxies `/api` and `/health` to `http://127.0.0.1:8000`.

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
python3 -m compileall app
```

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/database/health
```

## Git Notes

Runtime files are intentionally ignored, including local databases, `.env` files, `node_modules/`, Vite `dist/`, and local agent artifacts. Keep generated secrets and local SQLite files out of commits.
