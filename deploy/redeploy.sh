#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "已创建 deploy/.env，请先编辑它：nano /opt/4ever/app/deploy/.env"
  exit 1
fi

docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1/health
curl -fsS http://127.0.0.1/api/database/health
