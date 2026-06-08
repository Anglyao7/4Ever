#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "用法: bash deploy.sh <服务器用户> <服务器IP或域名> [SSH端口]"
  echo "示例: bash deploy.sh root 43.106.142.145"
  echo "示例: bash deploy.sh root 43.106.142.145 2222"
  exit 1
fi

SERVER_USER="$1"
SERVER_HOST="$2"
SSH_PORT="${3:-22}"
REMOTE_DIR="/opt/4ever/app"

cd "$(dirname "$0")"

echo "==> 创建远端目录: ${SERVER_USER}@${SERVER_HOST}:${REMOTE_DIR}"
ssh -p "$SSH_PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR'"

echo "==> 上传 4Ever 源码"
rsync -az --delete -e "ssh -p $SSH_PORT" \
  --exclude 'LambChat' \
  --exclude '.local-docs' \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude 'frontend/node_modules' \
  --exclude 'frontend/dist' \
  --exclude 'frontend/.env' \
  --exclude 'deploy/.env' \
  --exclude 'python_backend/.venv' \
  --exclude 'python_backend/.env' \
  --exclude '**/__pycache__' \
  --exclude '*.pyc' \
  --exclude '*.db' \
  --exclude '*.sqlite' \
  --exclude '*.sqlite3' \
  --exclude 'media' \
  --exclude 'private-media' \
  README.md docs deploy frontend python_backend token-usage-cli .dockerignore deploy.sh \
  "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/"

echo "==> 服务器重建并启动容器"
ssh -p "$SSH_PORT" "$SERVER_USER@$SERVER_HOST" "cd '$REMOTE_DIR/deploy' && bash redeploy.sh"

echo "==> 部署完成"
