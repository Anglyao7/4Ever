FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY python_backend/pyproject.toml ./
COPY python_backend/app ./app
COPY python_backend/scripts ./scripts

RUN pip install --upgrade pip \
    && pip install .

EXPOSE 7778

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7778", "--proxy-headers", "--forwarded-allow-ips=*"]
