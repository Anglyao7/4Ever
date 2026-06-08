<div align="center">

# 4Ever

**一个面向聊天、Agent、记忆、自动化和个人 AI 用量分析的多模型工作台。**

[English](README_EN.md)

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=111111)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docs.docker.com/compose/)

</div>

---

## 4Ever 是什么？

4Ever 是一个 Python/FastAPI + React 构建的个人 AI 工作空间。它从一个 AI 工作台出发，逐步扩展成集聊天、模型配置、Agent 工作流、长期记忆、Token 用量统计和个人内容管理于一体的系统。

| 模块 | 能力 |
| --- | --- |
| **交耳 Chat** | 多供应商 AI 聊天，支持 Persona、记忆、流式事件、附件、引用和 MCP 工具事件。 |
| **中枢 Provider Hub** | 管理模型 profile、base URL、API key、fallback model 和图片理解能力。 |
| **秩序 Workflow** | 面向 Agent / MCP 的工作流界面，由 Python 后端运行时承载。 |
| **Token 统计** | 本地 CLI 采集、仪表盘、热力图、排行榜和设备 / Key 管理。 |
| **虚实 / 笔记 / 地图纪念 / 灵感** | 围绕创作、记录、记忆和灵感整理的个人工作面。 |
| **管理员端** | 用户、模块、MCP 策略、readiness 检查和审计记录。 |

当前后端已经切到 Python/FastAPI，并保持前端 API 合同稳定。默认使用 SQLite，因此本地运行不需要额外数据库服务。

## 亮点

- **FastAPI 后端**：覆盖认证、聊天、模型供应商、图像生成、Token 统计、管理员端和 Agent 工作流。
- **React + Vite 前端**：模块化工作台，包含 Chat、Provider Hub、Workflow、Token Usage、Notes、Memory Map、Inspiration 和 Admin。
- **流式聊天事件协议**：支持文本 chunk、错误、工具调用、Token 用量、引用校验和运行事件回放。
- **后端托管模型配置**：支持用户隔离、模型 profile 和加密保存模型 API key。
- **Persona 与记忆**：让 AI 联系人更稳定，并支持轻量长期记忆召回。
- **私有附件存储**：owner-scoped 下载、签名临时 URL、文档 chunk 检索和引用详情。
- **MCP-ready 运行时**：支持 BigModel MCP planned/live 模式和管理员 allowlist。
- **Docker Compose 部署**：包含 Caddy 前端 / 反代容器和持久化 Docker volume。
- **Token CLI**：把本机 AI 编程工具的 Token 用量同步到 4Ever 仪表盘。

## 界面结构

4Ever 不是单一聊天页，而是一个模块化工作空间：

```text
交耳 | 中枢 | 秩序 | Token统计 | 笔记 | 地图纪念 | 灵感 | 管理员端
```

后续如果要补产品截图，可以放到 `docs/images/` 后在这里引用。

## 快速开始

### 1. 启动后端

```bash
cd python_backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --host 127.0.0.1 --port 7778
```

### 2. 启动前端

```bash
cd frontend
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:7777
```

Vite 开发服务器会把 `/api` 和 `/health` 代理到 `http://127.0.0.1:7778`。

## 本地 Docker 部署

如果你希望用容器方式在本地运行，而不是分别启动前后端开发服务器，可以使用 Docker Compose。

```bash
cd deploy
cp .env.example .env
```

把 `deploy/.env` 改成本地 HTTP 配置：

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

构建并启动：

```bash
docker compose build
docker compose up -d
```

打开：

```text
http://127.0.0.1:7777
```

健康检查：

```bash
curl http://127.0.0.1:7777/health
curl http://127.0.0.1:7777/api/database/health
```

停止容器但保留数据：

```bash
cd deploy
docker compose down
```

删除容器和本地 Docker volume 数据：

```bash
cd deploy
docker compose down -v
```

`deploy/.env` 已被 Git 忽略。若你希望已保存的模型 API key 在重启后仍可解密，请保持 `MODEL_PROFILE_ENCRYPTION_KEY` 稳定不变。

## Token 统计 CLI

安装 CLI：

```bash
npm install -g @anglyaoy/token-usage
```

绑定线上 4Ever 并立即同步一次：

```bash
forever-token init
```

本地开发服务：

```bash
forever-token init local
```

设置自动同步：

```bash
forever-token service setup
```

## 配置

后端配置可以放在项目根目录 `.env` 或 `python_backend/.env`，参考 `python_backend/.env.example`。

```env
DATABASE_URL=sqlite:///./4ever.db
BIGMODEL_API_KEY=
BIGMODEL_MCP_LIVE=0
AGENT_SYNTHESIS_LIVE=0
AGENT_GRAPH_RUNTIME=langgraph
```

前端配置可以放在 `frontend/.env`，参考 `frontend/.env.example`。

## 项目结构

```text
.
├── python_backend/             # Python FastAPI 后端
│   ├── app/                    # API routes、配置和 Agent runtime
│   ├── tests/                  # 后端合同测试
│   ├── .env.example            # 后端环境变量示例
│   └── pyproject.toml          # Python 依赖和 pytest 配置
├── frontend/                   # React + Vite 前端
│   ├── src/                    # Panels、services、types 和应用壳
│   ├── .env.example            # 前端环境变量示例
│   ├── package.json            # 前端脚本和依赖
│   └── vite.config.ts          # Vite 开发服务器和代理配置
├── deploy/                     # Docker Compose、Caddy 和部署环境变量示例
├── token-usage-cli/            # forever-token CLI 包
├── docs/                       # 调研和实现文档
├── deploy.sh                   # 维护者服务器部署辅助脚本
├── README.md                   # 中文 README
└── README_EN.md                # English README
```

## 检查命令

前端：

```bash
cd frontend
npm run build
```

后端：

```bash
cd python_backend
python3.11 -m pytest
```

健康检查：

```bash
curl http://127.0.0.1:7778/health
curl http://127.0.0.1:7778/api/database/health
```

## Star 趋势

<a href="https://www.star-history.com/#Anglyao7/4Ever&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Anglyao7/4Ever&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Anglyao7/4Ever&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Anglyao7/4Ever&type=Date" />
  </picture>
</a>

## 备注

- 本地数据库、`.env`、`node_modules/`、Vite `dist/` 和生成媒体文件都应保持在 Git 外。
- 不要把密钥提交到仓库。
- Agent、LangGraph 和 BigModel MCP 工作流细节见 [docs/agent-mcp-workflow.md](docs/agent-mcp-workflow.md)。
