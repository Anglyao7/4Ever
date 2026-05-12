# Backend

Python FastAPI service for provider-format routing.

## Run

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## API

- `GET /health`
- `GET /api/database/health`
- `GET /api/catalog/providers`
- `POST /api/chat`

## Database

Set `DATABASE_URL` before starting the service.

Examples:

```bash
DATABASE_URL=sqlite:///./4ever.db
DATABASE_URL=postgresql+psycopg://user:password@127.0.0.1:5432/4ever
DATABASE_URL=mysql+pymysql://user:password@127.0.0.1:3306/4ever
```
