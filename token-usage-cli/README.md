# @anglyaoy/token-usage

Local Token usage collector for 4Ever.

## Install

```bash
npm install -g @anglyaoy/token-usage
```

## Bind To 4Ever

Generate a CLI key in the 4Ever `Token统计` module, then run the interactive setup:

```bash
forever-token init
```

The CLI will show the API URL it will use, then prompt for the CLI key:

```text
4Ever API URL: http://127.0.0.1:7778
Token统计 CLI Key:
```

For a non-default backend, pass only the API URL and still paste the key into the prompt:

```bash
forever-token init --api-url https://your-4ever.example.com
```

Then sync once:

```bash
forever-token sync
```

For continuous sync:

```bash
forever-token daemon --interval 300000
```

The collector reads local usage from Codex, Claude Code, Gemini CLI, Qwen Code, OpenCode, and OpenClaw where available. It aggregates usage into 30-minute buckets, extracts session activity, and uploads to `/api/token-usage/ingest`. Total Token counts include input, output, cached, and reasoning tokens so the CLI, API dashboard, hourly heatmap, and leaderboard use the same accounting.

Do not pass the CLI key as a command argument. Keeping the key in the interactive `forever-token init` prompt avoids writing it into shell history.

## Local Commands

这些命令只读取本机日志，不会上传数据：

```bash
forever-token
forever-token usage
forever-token monthly
forever-token dayly
forever-token daily
forever-token hourly
forever-token status
forever-token version
forever-token help
```

- `forever-token` / `forever-token usage`：展示当前本机累计 Token 消耗。
- `forever-token monthly`：按月展示本机 Token 消耗。
- `forever-token dayly`：按日展示近三个月本机 Token 消耗。`daily` 是同义别名。
- `forever-token hourly`：按 GMT+8 展示今日每小时 Token 消耗，用来核对前端小时热力图。
- `forever-token status`：展示绑定状态、可发现的数据目录和本地快照。
- `forever-token version`：展示 CLI 版本号。
- `forever-token help`：展示中文命令说明。

本地按日、按月、按小时输出与前端一致使用 GMT+8 统计口径。统计输出统一使用简写单位：低于 `1B` 时显示为 `M Tokens`，达到 `1B` 及以上显示为 `B Tokens`。例如 `3,100,000 tokens` 显示为 `3.1M Tokens`，`310,000,000 tokens` 显示为 `310M Tokens`，`1,000,000,000 tokens` 显示为 `1B Tokens`。
