# Token 统计口径差异分析

日期：2026-05-30

## 结论

当前没有执行 `npm publish`，也没有执行 `forever-token sync`，没有调用 `/api/token-usage/ingest` 写入数据。

本次对比只读取本机文件和源码：

- `node bin/forever-token.js status`
- `TokenArena/cli/src/parsers/*`
- `TokenArena/cli/src/domain/*`

如果页面上的总量从约 19 亿变成约 90 亿，最可能原因不是数据库被改写，而是前端统计范围从默认 `30天` 改成了 `全部历史` 后，页面读取了已有的全量历史数据。这个变化会影响展示口径，但不会修改后端数据。

本机实测结果：

| 来源 | total_tokens |
| --- | ---: |
| 历史本地脚本快照 | 9,195,008,884 |
| 当前 `forever-token status` 本地快照 | 9,194,787,261 |
| 差值 | 221,623 |

这说明当前 4Ever CLI 的本地读取结果已经基本贴近你的脚本。差值约 0.0024%，主要来自 OpenClaw 估算路径/候选目录细节，不是 19 亿 vs 90 亿这种量级问题。

## 为什么你的脚本比 TokenArena 更多

核心原因：TokenArena 采用更保守的“去重、非重叠字段、计费友好”口径；旧本地脚本采用更激进的“本地日志原始累计”口径。4Ever CLI 现在改为“本地日志去重累计”口径：保留更广的数据覆盖范围，但会按稳定事件键去掉重复 usage 记录。

这两个目标不同：

- TokenArena 更适合公开排行榜和避免重复计数。
- 4Ever CLI 更适合回答“本机所有 AI 工具日志里出现过多少不重复的 Token 用量”。

如果 4Ever 的目标是“尽量不漏掉用户真实消耗痕迹”，应该采用本地日志去重累计口径，并在产品里明确说明它不是账单口径。

## 主要差异点

### 1. Codex：最大差异来源

你的脚本：

- 同时扫描 `~/.codex/sessions` 和 `~/.codex/archived_sessions`。
- 通过 `~/.codex/state_5.sqlite` 的 `threads` 表识别 `codex_app` / `codex_cli` / unknown。
- 按 `token_count` 原始事件累计。
- 按事件 id、消息 id 或 usage 内容指纹过滤重复记录。
- `total_tokens = input_tokens + cached_input_tokens + cache_creation_input_tokens + output_tokens + tool_tokens`。
- `reasoning_output_tokens` 单独展示，不塞进 total。

TokenArena：

- 默认只看 `~/.codex/sessions`。
- 统一标记成 `codex` / `Codex CLI`，没有区分 Codex App / VS Code 与 CLI。
- 对 `total_token_usage` 做前后 delta，避免累计快照重复。
- 对字段做非重叠拆分：`inputTokens = input_tokens - cached_input_tokens`，`outputTokens = output_tokens - reasoning_output_tokens`。
- `totalTokens = inputTokens + outputTokens + reasoningTokens + cachedTokens`。

结果：

- 旧本地脚本会更大，因为它保留原始事件累计、包含归档会话，并且没有从 input/output 中扣掉 cached/reasoning。
- 当前 4Ever CLI 仍同时读取 `sessions` 和 `archived_sessions`，但会去掉重复 usage 事件。
- TokenArena 会更小，因为它主动避免重叠字段和累计快照重复。

本机脚本里 Codex 占比非常高：

- Codex App / VS Code：3,310,427,260
- Codex CLI：5,478,699,856

所以 Codex 口径差异会直接造成数十亿级差距。

### 2. Claude Code：cache_creation 与去重策略不同

你的脚本：

- 扫描 `~/.claude/projects/**/*.jsonl`。
- 读取 assistant message 的 usage。
- 累计 `input_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`、`output_tokens`。
- 通过 `uuid` / message id / usage 指纹跳过重复 usage 记录。

TokenArena：

- 扫描 `~/.claude/projects`，也兼容 `CLAUDE_CONFIG_DIR`、`transcripts`、`sessions`。
- 用 `uuid` 去重。
- 计入 `cache_read_input_tokens`，但没有把 `cache_creation_input_tokens` 放进 cached 或 total。

结果：

- 你的脚本通常更多，尤其 Claude cache creation 很大时。
- 历史本地脚本快照中 Claude Code CLI 为 235,420,130，其中 `cache_creation_tokens` 为 18,801,651；这部分 TokenArena 当前 Claude parser 不会进入 total。

### 3. Qwen Code：数据目录与 telemetry fallback 不同

你的脚本：

- 扫描 `~/.qwen/projects/**/*.jsonl`。
- 优先使用 assistant `usageMetadata`。
- 如果没有 assistant usage，则使用 `systemPayload.uiEvent` telemetry。
- 对 telemetry 通过 `response_id` / `prompt_id` / `uuid` 聚合，避免同一条 telemetry 重复覆盖。

TokenArena：

- 默认目录是 `~/.qwen/tmp`。
- 只找 `tmp/<project>/chats/*.jsonl`。
- 只使用 assistant `usageMetadata` / `usage`。
- 不使用 `systemPayload.uiEvent` fallback。
- 同样会扣掉 cached 与 reasoning，走非重叠口径。

结果：

- 如果用户机器上 Qwen 的真实日志在 `~/.qwen/projects`，TokenArena 可能直接少统计。
- 如果文件只有 telemetry usage，没有 assistant usage，TokenArena 会漏掉。

### 4. Gemini CLI：扫描范围和字段拆分不同

你的脚本：

- 扫描 `~/.gemini/tmp/**/*.jsonl`。
- 只要记录里有 `tokens` 字段就累计。
- `total_tokens` 优先使用 `tokens.total`，否则 `input + output`。

TokenArena：

- 只扫描 `~/.gemini/tmp/<hash>/chats/...` 下的 `.jsonl` / `.json`。
- 只接受可识别 role/type 的消息。
- 会把 `cached` 从 input 里扣掉，把 `thoughts` 从 output 里扣掉。

结果：

- 你的脚本扫描范围更宽，能吃到非 chats 目录里的 token 记录。
- TokenArena 更保守，避免把不属于会话消息的记录算进去。

### 5. OpenCode：cache write 处理不同

你的脚本：

- 从 `~/.local/share/opencode/opencode.db` 的 assistant message tokens 读取。
- 计入 `cache.read` 和 `cache.write`。
- `cache.write` 进入 `cache_creation_input_tokens`，参与 total。

TokenArena：

- SQLite 与 legacy JSON 都支持。
- 主要计入 `cache.read`。
- 没有把 `cache.write` 作为 cache creation 单独计入 total。

结果：

- 如果 OpenCode 有 cache write，你的脚本更多。

### 6. OpenClaw：估算策略差异很大

你的脚本：

- 不只读取 `message.usage`，还会在 usage 缺失时用上下文文本估算 input/output。
- 会过滤 `delivery-mirror`、`gateway-injected` 等非真实模型。
- 支持 `AGENTS_DIR`，也会从当前目录、脚本目录、`~/.openclaw/agents` 推断 agents 目录。
- 会把图片按固定 token 估算。

TokenArena：

- 主要读取 OpenClaw message 的 usage 字段。
- 如果 usage 缺失，基本不估算上下文 token。
- 支持多个 OpenClaw root，包括 `~/.openclaw-*` 和 legacy roots。

结果：

- 你的脚本在 OpenClaw usage 字段缺失时仍然能给估算值，所以通常更多。
- 历史本地脚本快照中 OpenClaw 为 28,440,480，当前 CLI 快照之前为 28,218,857，差值约 221,623，说明剩余小差距主要集中在 OpenClaw 估算/目录细节。

### 7. 平台覆盖方向不同

TokenArena 支持更多 parser，例如：

- Copilot CLI
- Cursor
- Cline
- Roo Code
- Kimi Code
- Kiro
- Droid
- Hermes
- GSD
- QwenPaw
- Pi Coding Agent
- Oh My Pi

你的脚本当前重点是：

- Codex App / VS Code
- Codex CLI
- Claude Code CLI
- Gemini CLI
- Qwen Code
- OpenCode
- OpenClaw
- Antigravity 探测
- Trae / VS Code AI 插件 / CodeBuddy / Lingma 等 presence 探测

因此会出现两种情况：

- 对 Codex、Claude、OpenClaw，你的脚本通常更多。
- 对 Cursor、Copilot CLI、Cline、Roo Code 等 TokenArena 已有 parser 的平台，如果本机有真实数据而你的脚本还没接入，TokenArena 可能更多。

## 4Ever 应采用的 npm 采集策略

建议把 4Ever 的 npm 包定义成“本地日志去重累计口径”，保留历史本地脚本的覆盖范围，同时避免同一 usage 记录重复计入。

建议规则：

1. Codex 同时读取 `sessions` 和 `archived_sessions`。
2. Codex 通过 `state_5.sqlite` 区分 `codex_app`、`codex_cli`、unknown。
3. 默认对 usage 记录做稳定键去重；Codex 的 `total_token_usage` 快照继续做 delta，避免累计快照重复。
4. `total_tokens` 统一包含 reasoning，保持：
   `input + cached_input + cache_creation_input + output + reasoning + tool`。
5. `reasoning_output_tokens` 同时单独展示，便于核对推理消耗来源。
6. Claude 计入 `cache_creation_input_tokens`。
7. Qwen 支持 `~/.qwen/projects`，并在没有 assistant usage 时 fallback 到 telemetry uiEvent。
8. OpenClaw 在 usage 缺失时使用文本上下文估算，但 UI 要标记为“估算”。
9. 对 Antigravity、Trae、CodeBuddy、Lingma 等，只在 schema 未确认时显示 found/unavailable，不能把 unavailable 当 0。
10. 后续可以逐步移植 TokenArena 的 Cursor、Copilot CLI、Cline、Roo Code 等 parser，但要转成 4Ever 的 total 口径。

## 发布 npm 前的检查清单

不要直接发布。发布前先做这些只读/本地检查：

```bash
cd /Users/ricardo/4Ever/token-usage-cli
node --check src/index.js
node bin/forever-token.js status
npm pack --dry-run
```

只有确认 `forever-token status` 与历史快照在同一口径下接近，再执行：

```bash
npm version patch
npm publish --access public
```

如果之后包名切到 `@anglyaoy/forever-token`，需要先改：

- `token-usage-cli/package.json` 的 `name`
- `token-usage-cli/README.md` 安装命令
- `frontend/src/TokenUsagePanel.tsx` 安装命令

然后再 publish。不要用旧包静默覆盖口径，应该在 README 写明统计口径。

## 当前风险

1. 4Ever CLI 口径仍可能比 TokenArena 高，这是覆盖范围选择，不是 bug，但必须在 UI 和 README 说明。
2. 去重键依赖日志字段质量；没有稳定 id 的来源会退回到时间、模型、项目和 usage 指纹。
3. 如果追求账单级准确，应提供第二个“计费估算口径”，不要和“本地日志去重累计口径”混在同一个数字里。
4. 当前 4Ever 页面如果默认展示“全部历史”，用户看到的数字会明显高于 30 天视图，应在范围切换上保持醒目。
