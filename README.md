# 4Ever Aggregation Platform

一个用于后续扩展的聚合平台骨架。当前包含 Python 后端、Vue 前台，以及一个统一的 AI 对话入口。

## Structure

- `backend/`: FastAPI API service
- `frontend/`: Vue 3 + Vite web app

## Development

Backend:

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

