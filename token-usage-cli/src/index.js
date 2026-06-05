import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runServiceCommand } from "./service.js";

const CONFIG_DIR = join(homedir(), ".4ever", "token-usage");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const DEFAULT_API_URL = "http://127.0.0.1:7778";
const CODEX_ROOT = join(homedir(), ".codex");
const CODEX_DIRS = [join(CODEX_ROOT, "sessions"), join(CODEX_ROOT, "archived_sessions")];
const CLAUDE_DIR = join(homedir(), ".claude");
const GEMINI_DIR = join(homedir(), ".gemini", "tmp");
const QWEN_DIR = join(homedir(), ".qwen", "projects");
const OPENCODE_DIR = join(homedir(), ".local", "share", "opencode");
const OPENCLAW_DIR = join(homedir(), ".openclaw");
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const ASCII_WORD_RE = /[A-Za-z0-9_]+/y;
const DISPLAY_TIME_ZONE = "Asia/Shanghai";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const PARSERS = [
  { id: "codex", name: "Codex", dataDir: CODEX_ROOT, parse: parseCodex, installed: () => CODEX_DIRS.some((path) => existsSync(path)) },
  { id: "claude-code", name: "Claude Code", dataDir: CLAUDE_DIR, parse: parseClaudeCode, installed: isClaudeInstalled },
  { id: "gemini-cli", name: "Gemini CLI", dataDir: GEMINI_DIR, parse: parseGeminiCli, installed: () => existsSync(GEMINI_DIR) },
  { id: "qwen-code", name: "Qwen Code", dataDir: QWEN_DIR, parse: parseQwenCode, installed: () => existsSync(QWEN_DIR) },
  { id: "opencode", name: "OpenCode", dataDir: OPENCODE_DIR, parse: parseOpenCode, installed: () => existsSync(OPENCODE_DIR) },
  { id: "openclaw", name: "OpenClaw", dataDir: OPENCLAW_DIR, parse: parseOpenClaw, installed: () => existsSync(OPENCLAW_DIR) },
];

export async function main(argv) {
  const [, , command = "usage", ...args] = argv;
  if (command === "init") return init(args);
  if (command === "sync") return sync();
  if (command === "daemon") return daemon(args);
  if (command === "service") return runServiceCommand(args[0], ...args.slice(1));
  if (command === "status") return status();
  if (command === "usage") return usage();
  if (command === "monthly") return monthly();
  if (command === "dayly" || command === "daily") return dayly();
  if (command === "hourly") return hourly();
  if (command === "version" || command === "--version" || command === "-v") return version();
  if (command === "help" || command === "--help" || command === "-h") return help();
  return help();
}

async function init(args) {
  if (hasOption(args, "--api-key")) {
    throw new Error("Do not append the API key to the command. Run forever-token init and paste the key when prompted.");
  }
  const current = loadConfig(false) || {};
  const prompted = await promptInitConfig(current, readOption(args, "--api-url"));
  saveConfig({ ...current, ...prompted, deviceId: current.deviceId || randomUUID() });
  console.log(`4Ever Token CLI initialized for ${prompted.apiUrl}`);
}

async function sync() {
  const config = loadConfig(true);
  const result = await withSpinner("正在扫描本地 AI 工具日志", () => parseLocalUsage());
  if (!result.buckets.length && !result.sessions.length) {
    console.log("No local AI coding token usage found.");
    return;
  }
  const buckets = result.buckets.map((bucket) => ({ ...bucket, deviceId: config.deviceId }));
  const sessions = result.sessions.map((session) => ({ ...session, deviceId: config.deviceId }));
  const batchSize = { buckets: 450, sessions: 900 };
  const batchCount = Math.max(Math.ceil(buckets.length / batchSize.buckets), Math.ceil(sessions.length / batchSize.sessions), 1);
  let bucketCount = 0;
  let sessionCount = 0;
  const progress = startProgressBar("正在上传 Token 用量", batchCount);
  try {
    for (let index = 0; index < batchCount; index += 1) {
      const body = await uploadUsageBatch(config, {
        buckets: buckets.slice(index * batchSize.buckets, (index + 1) * batchSize.buckets),
        sessions: sessions.slice(index * batchSize.sessions, (index + 1) * batchSize.sessions),
      });
      bucketCount += body.bucketCount ?? 0;
      sessionCount += body.sessionCount ?? 0;
      progress.tick(index + 1);
    }
    progress.succeed();
  } catch (error) {
    progress.fail();
    throw error;
  }
  console.log(`Synced ${bucketCount} buckets and ${sessionCount} sessions in ${batchCount} batch${batchCount === 1 ? "" : "es"}.`);
}

async function uploadUsageBatch(config, data) {
  const payload = {
    schemaVersion: 2,
    device: { deviceId: config.deviceId, hostname: hostname().replace(/\.local$/, "") },
    buckets: data.buckets,
    sessions: data.sessions,
  };
  const response = await fetch(new URL("/api/token-usage/ingest", config.apiUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Sync failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function daemon(args) {
  const interval = Number(readOption(args, "--interval") || 300000);
  if (!Number.isFinite(interval) || interval < 30000) {
    throw new Error("--interval must be at least 30000 ms.");
  }
  console.log(`4Ever Token daemon started. Interval: ${Math.round(interval / 1000)}s`);
  await sync().catch((error) => console.error(error.message));
  setInterval(() => void sync().catch((error) => console.error(error.message)), interval);
}

function status() {
  const config = loadConfig(false);
  console.log("4Ever Token 状态");
  console.log(`配置：${config ? config.apiUrl : "未初始化，请先运行 forever-token init"}`);
  for (const parser of PARSERS) {
    console.log(`${parser.name}：${parser.installed() ? parser.dataDir : "未发现"}`);
  }
  const result = withSpinner("正在扫描本地 AI 工具日志", () => parseLocalUsage());
  const totals = summarizeBuckets(result.buckets, result.sessions);
  console.log(`本地快照：${formatTokens(totals.totalTokens)}，${result.buckets.length} 个时间桶，${result.sessions.length} 个会话`);
  for (const [source, sourceTotal] of sourceTotals(result.buckets)) {
    console.log(`  ${source}: ${formatTokens(sourceTotal)}`);
  }
}

function usage() {
  const result = withSpinner("正在扫描本地 AI 工具日志", () => parseLocalUsage());
  const totals = summarizeBuckets(result.buckets, result.sessions);
  console.log("4Ever Token 本地用量");
  printTotals(totals);
  console.log("");
  console.log("工具来源排行：");
  const sources = sourceTotals(result.buckets);
  if (!sources.length) {
    console.log("  暂未发现可统计的本地 Token 用量。");
  } else {
    for (const [source, total] of sources) console.log(`  ${source}: ${formatTokens(total)}`);
  }
  console.log("");
  console.log("提示：运行 forever-token monthly 查看按月统计；运行 forever-token dayly 查看近三个月按日统计；运行 forever-token hourly 查看今日按小时统计。只展示本地读取结果，不会上传数据。");
}

function monthly() {
  const result = withSpinner("正在扫描本地 AI 工具日志", () => parseLocalUsage());
  const rows = groupBucketsBy(result.buckets, (bucket) => displayDateParts(new Date(bucket.bucketStart)).month);
  console.log("4Ever Token 按月统计");
  printRows(rows, "月份");
}

function dayly() {
  const result = withSpinner("正在扫描本地 AI 工具日志", () => parseLocalUsage());
  const today = displayDateParts(new Date()).day;
  const cutoff = displayDateParts(addDays(parseDisplayDate(today), -91)).day;
  const recentBuckets = result.buckets.filter((bucket) => displayDateParts(new Date(bucket.bucketStart)).day >= cutoff);
  const rows = groupBucketsBy(recentBuckets, (bucket) => displayDateParts(new Date(bucket.bucketStart)).day);
  console.log("4Ever Token 按日统计（近三个月）");
  printRows(rows, "日期");
}

function hourly() {
  const result = withSpinner("正在扫描本地 AI 工具日志", () => parseLocalUsage());
  const today = displayDateParts(new Date()).day;
  const todayBuckets = result.buckets.filter((bucket) => displayDateParts(new Date(bucket.bucketStart)).day === today);
  const rows = groupBucketsBy(todayBuckets, (bucket) => {
    const parts = displayDateParts(new Date(bucket.bucketStart));
    return `${parts.day} ${parts.hour}:00`;
  });
  console.log("4Ever Token 今日按小时统计");
  printRows(rows, "小时");
}

function version() {
  console.log(`forever-token ${readPackageVersion()}`);
}

function help() {
  console.log(`4Ever Token CLI\n\n用法：\n  forever-token                 读取本机 AI 工具日志并展示当前 Token 总消耗，不上传数据。\n  forever-token usage           等同于 forever-token。\n  forever-token monthly         按月展示本地 Token 用量。\n  forever-token dayly           按日展示近三个月本地 Token 用量。\n  forever-token daily           dayly 的别名。\n  forever-token hourly          按 GMT+8 展示今日每小时 Token 用量，便于核对前端小时热力图。\n  forever-token status          展示初始化状态、可发现的数据目录和本地快照。\n  forever-token init            交互式绑定 4Ever Token统计 CLI Key。\n  forever-token sync            手动将本地统计同步到 4Ever。\n  forever-token service [action]\n                                管理后台服务（setup|start|stop|restart|status|uninstall）。\n                                setup 后自动开机启动，默认每 5 分钟同步数据。\n                                支持自定义间隔：service setup by N（N 为分钟数）。\n  forever-token daemon --interval 300000\n                                持续定时同步，interval 单位为毫秒（需手动保持运行）。\n  forever-token version         展示当前 CLI 版本号。\n  forever-token help            展示本帮助。\n\n示例：\n  forever-token service setup       # 每 5 分钟自动同步\n  forever-token service setup by 10 # 每 10 分钟自动同步\n  forever-token service setup by 60 # 每 60 分钟自动同步\n\n说明：\n  默认统计 Codex、Claude Code、Gemini CLI、Qwen Code、OpenCode、OpenClaw 等本机日志。\n  除 sync/daemon/service 外，其余统计命令只读本地文件，不会上传数据。\n  本地按日、按月、按小时输出与前端一致使用 GMT+8 统计口径。\n  推荐使用 service setup 实现无感知自动同步。`);
}

function withSpinner(label, work) {
  const spinner = startSpinner(label);
  try {
    const result = work();
    if (result && typeof result.then === "function") {
      return result.then(
        (value) => {
          spinner.succeed();
          return value;
        },
        (error) => {
          spinner.fail();
          throw error;
        },
      );
    }
    spinner.succeed();
    return result;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

function startSpinner(label) {
  if (!output.isTTY || process.env.CI) {
    return { succeed() {}, fail() {} };
  }
  let frameIndex = 0;
  let active = true;
  const render = (frame, text) => {
    output.write(`\r${frame} ${text}`);
  };
  render(SPINNER_FRAMES[frameIndex], label);
  const timer = setInterval(() => {
    if (!active) return;
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
    render(SPINNER_FRAMES[frameIndex], label);
  }, 80);
  return {
    succeed() {
      if (!active) return;
      active = false;
      clearInterval(timer);
      output.write(`\r✓ ${label}\n`);
    },
    fail() {
      if (!active) return;
      active = false;
      clearInterval(timer);
      output.write(`\r✗ ${label}\n`);
    },
  };
}

function startProgressBar(label, total) {
  const width = 24;
  let current = 0;
  let active = Boolean(output.isTTY && !process.env.CI);
  const render = (done = false) => {
    if (!active) return;
    const ratio = total > 0 ? Math.min(1, current / total) : 1;
    const filled = done ? width : Math.round(ratio * width);
    const bar = "#".repeat(filled).padEnd(width, "-");
    const percent = Math.round(ratio * 100).toString().padStart(3, " ");
    output.write(`\r[${bar}] ${percent}% ${current}/${total} ${label}`);
  };
  render();
  return {
    tick(value) {
      current = Math.max(0, Math.min(total, value));
      render();
    },
    succeed() {
      if (!active) return;
      current = total;
      render(true);
      output.write("\n");
      active = false;
    },
    fail() {
      if (!active) return;
      output.write(`\r[${"!".repeat(width)}] failed ${current}/${total} ${label}\n`);
      active = false;
    },
  };
}

function parseLocalUsage() {
  const merged = { buckets: [], sessions: [] };
  for (const parser of PARSERS) {
    try {
      const result = parser.parse();
      merged.buckets.push(...result.buckets);
      merged.sessions.push(...result.sessions);
    } catch (error) {
      console.error(`${parser.name} parse skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return merged;
}

function tokenEntry(fields) {
  const totalTokens = safeNumber(fields.inputTokens) + safeNumber(fields.outputTokens) + safeNumber(fields.reasoningTokens) + safeNumber(fields.cachedTokens);
  const basis = fields.dedupeKey || [
    fields.source,
    fields.sessionId,
    fields.model || "unknown",
    fields.project || "unknown",
    fields.timestamp instanceof Date ? fields.timestamp.toISOString() : String(fields.timestamp || ""),
    totalTokens,
  ].join("|");
  return {
    ...fields,
    inputTokens: safeNumber(fields.inputTokens),
    outputTokens: safeNumber(fields.outputTokens),
    reasoningTokens: safeNumber(fields.reasoningTokens),
    cachedTokens: safeNumber(fields.cachedTokens),
    dedupeKey: createHash("sha256").update(basis).digest("hex").slice(0, 24),
  };
}

function parseCodex() {
  const entries = [];
  const sessionEvents = [];
  for (const root of CODEX_DIRS) for (const filePath of findJsonlFiles(root)) {
    const lines = readFileSafe(filePath).split("\n").filter(Boolean);
    let project = "unknown";
    let source = "codex_unknown";
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "session_meta") {
          project = resolveProject(event.payload);
          source = normalizeCodexSource(event.payload?.source);
          break;
        }
      } catch {
        break;
      }
    }
    let model = "unknown";
    const previousTotals = new Map();
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "turn_context" && event.timestamp) {
          if (event.payload?.model) model = event.payload.model;
            const eventTimestamp = new Date(event.timestamp);
            if (!Number.isNaN(eventTimestamp.getTime())) {
              sessionEvents.push({ sessionId: filePath, source, project, timestamp: eventTimestamp, role: "user" });
            }
          continue;
        }
        if (event.type !== "event_msg" || event.payload?.type !== "token_count") continue;
        const info = event.payload.info || {};
        const timestamp = event.timestamp ? new Date(event.timestamp) : null;
        if (!timestamp || Number.isNaN(timestamp.getTime())) continue;
        const activeModel = info.model || event.payload.model || model || "unknown";
        const usage = resolveUsageDelta(activeModel, info, previousTotals);
        if (!usage) continue;
        const cachedTokens = safeNumber(usage.cached_input_tokens);
        const reasoningTokens = safeNumber(usage.reasoning_output_tokens);
        const inputTokens = safeNumber(usage.input_tokens);
        const outputTokens = safeNumber(usage.output_tokens);
        if (!inputTokens && !outputTokens && !reasoningTokens && !cachedTokens) continue;
        sessionEvents.push({ sessionId: filePath, source, project, timestamp, role: "assistant" });
        entries.push(tokenEntry({ sessionId: filePath, source, model: activeModel, project, timestamp, inputTokens, outputTokens, reasoningTokens, cachedTokens, dedupeKey: event.id || event.payload?.id || `codex:${source}:${project}:${event.timestamp}:${activeModel}:${JSON.stringify(usage)}` }));
      } catch {
        // Skip malformed JSONL rows.
      }
    }
  }
  return { buckets: aggregateBuckets(entries), sessions: extractSessions(sessionEvents, entries) };
}

function parseClaudeCode() {
  const entries = [];
  const sessionEvents = [];
  const seenUuids = new Set();
  const seenSessionIds = new Set();
  const seenProjectFiles = new Set();

  for (const root of getClaudeRoots()) {
    const projectsDir = join(root, "projects");
    for (const filePath of findJsonlFiles(projectsDir)) {
      const relative = projectRelativePath(filePath, projectsDir);
      if (relative !== null) {
        if (seenProjectFiles.has(relative)) continue;
        seenProjectFiles.add(relative);
      }

      const content = readFileSafe(filePath);
      if (!content) continue;

      const sessionId = filePath;
      const project = extractClaudeProject(filePath, projectsDir);
      seenSessionIds.add(hashSessionId(sessionId));

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const timestamp = obj.timestamp ? new Date(obj.timestamp) : null;
          if (!timestamp || Number.isNaN(timestamp.getTime())) continue;

          if (["user", "assistant", "tool_use", "tool_result"].includes(obj.type)) {
            sessionEvents.push({ sessionId, source: "claude-code", project, timestamp, role: obj.type === "user" ? "user" : "assistant" });
          }

          if (obj.type !== "assistant" || !obj.message?.usage) continue;
          if (obj.uuid) {
            if (seenUuids.has(obj.uuid)) continue;
            seenUuids.add(obj.uuid);
          }
          const usage = obj.message.usage;
          const cachedTokens = safeNumber(usage.cache_read_input_tokens) + safeNumber(usage.cache_creation_input_tokens);
          const inputTokens = safeNumber(usage.input_tokens);
          const outputTokens = safeNumber(usage.output_tokens);
          if (!inputTokens && !outputTokens && !cachedTokens) continue;
          entries.push(tokenEntry({ sessionId, source: "claude-code", model: obj.message.model || "unknown", project, timestamp, inputTokens, outputTokens, reasoningTokens: 0, cachedTokens, dedupeKey: obj.uuid || obj.message?.id || `claude-code:${project}:${obj.timestamp}:${obj.message.model || "unknown"}:${JSON.stringify(usage)}` }));
        } catch {
          // Skip malformed JSONL rows.
        }
      }
    }

    for (const transcriptDir of ["transcripts", "sessions"]) {
      for (const filePath of findJsonlFiles(join(root, transcriptDir))) {
        const sessionKey = hashSessionId(filePath);
        if (seenSessionIds.has(sessionKey)) continue;
        seenSessionIds.add(sessionKey);
        const content = readFileSafe(filePath);
        if (!content) continue;
        for (const line of content.split("\n")) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            const timestamp = obj.timestamp ? new Date(obj.timestamp) : null;
            if (!timestamp || Number.isNaN(timestamp.getTime())) continue;
            if (["user", "assistant", "tool_use", "tool_result"].includes(obj.type)) {
              sessionEvents.push({ sessionId: filePath, source: "claude-code", project: "unknown", timestamp, role: obj.type === "user" ? "user" : "assistant" });
            }
          } catch {
            // Skip malformed JSONL rows.
          }
        }
      }
    }
  }

  return { buckets: aggregateBuckets(entries), sessions: extractSessions(sessionEvents, entries) };
}

function parseGeminiCli() {
  const entries = [];
  const sessionEvents = [];
  for (const filePath of findFiles(GEMINI_DIR, (name) => name.endsWith(".jsonl") || name.endsWith(".json"))) {
    if (!filePath.includes(`${sep}chats${sep}`)) continue;
    const record = readGeminiRecord(filePath);
    if (!record) continue;
    const project = projectFromDirectories(record.directories);
    for (const message of record.messages) {
      const role = classifyGeminiRole(message);
      if (!role) continue;
      const rawTimestamp = message.timestamp || message.createTime || record.createTime;
      const timestamp = rawTimestamp ? new Date(rawTimestamp) : null;
      if (!timestamp || Number.isNaN(timestamp.getTime())) continue;
      sessionEvents.push({ sessionId: filePath, source: "gemini-cli", project, timestamp, role });

      const tokens = message.tokens;
      const usage = message.usage || message.usageMetadata || message.token_count;
      if (tokens) {
        const cachedTokens = safeNumber(tokens.cached);
        const reasoningTokens = safeNumber(tokens.thoughts);
        const inputTokens = safeNumber(tokens.input);
        const outputTokens = safeNumber(tokens.output);
        if (!inputTokens && !outputTokens && !reasoningTokens && !cachedTokens) continue;
        entries.push(tokenEntry({ sessionId: filePath, source: "gemini-cli", model: message.model || record.model || "unknown", project, timestamp, inputTokens, outputTokens, reasoningTokens, cachedTokens, dedupeKey: message.id || message.uuid || `gemini-cli:${project}:${rawTimestamp}:${message.model || record.model || "unknown"}:${JSON.stringify(tokens)}` }));
      } else if (usage) {
        const cachedTokens = safeNumber(usage.cachedContentTokenCount);
        const reasoningTokens = safeNumber(usage.thoughtsTokenCount);
        const inputTokens = safeNumber(usage.promptTokenCount || usage.input_tokens);
        const outputTokens = safeNumber(usage.candidatesTokenCount || usage.output_tokens);
        if (!inputTokens && !outputTokens && !reasoningTokens && !cachedTokens) continue;
        entries.push(tokenEntry({ sessionId: filePath, source: "gemini-cli", model: message.model || record.model || "unknown", project, timestamp, inputTokens, outputTokens, reasoningTokens, cachedTokens, dedupeKey: message.id || message.uuid || `gemini-cli:${project}:${rawTimestamp}:${message.model || record.model || "unknown"}:${JSON.stringify(usage)}` }));
      }
    }
  }
  return { buckets: aggregateBuckets(entries), sessions: extractSessions(sessionEvents, entries) };
}

function parseQwenCode() {
  const entries = [];
  const sessionEvents = [];
  const seenUuids = new Set();
  for (const filePath of findFiles(QWEN_DIR, (name) => name.endsWith(".jsonl"))) {
    const content = readFileSafe(filePath);
    if (!content) continue;
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const timestamp = obj.timestamp ? new Date(obj.timestamp) : null;
        if (!timestamp || Number.isNaN(timestamp.getTime())) continue;
        const project = obj.cwd ? leafName(obj.cwd) : projectFromToolTmpPath(filePath, QWEN_DIR);
        if (obj.type === "user" || obj.type === "assistant") {
          sessionEvents.push({ sessionId: filePath, source: "qwen-code", project, timestamp, role: obj.type });
        }
        if (obj.type !== "assistant") continue;
        const usage = obj.usageMetadata || obj.usage || obj.systemPayload?.uiEvent;
        if (!usage) continue;
        if (obj.uuid) {
          if (seenUuids.has(obj.uuid)) continue;
          seenUuids.add(obj.uuid);
        }
        const cachedTokens = safeNumber(usage.cachedContentTokenCount ?? usage.cached_content_token_count);
        const reasoningTokens = safeNumber(usage.thoughtsTokenCount ?? usage.thoughts_token_count);
        const toolTokens = safeNumber(usage.toolTokenCount ?? usage.tool_token_count);
        const inputTokens = safeNumber(usage.promptTokenCount ?? usage.input_tokens ?? usage.input_token_count);
        const outputTokens = safeNumber(usage.candidatesTokenCount ?? usage.output_tokens ?? usage.output_token_count);
        if (!inputTokens && !outputTokens && !reasoningTokens && !cachedTokens) continue;
        entries.push(tokenEntry({ sessionId: filePath, source: "qwen-code", model: obj.model || "unknown", project, timestamp, inputTokens, outputTokens: outputTokens + toolTokens, reasoningTokens, cachedTokens, dedupeKey: obj.uuid || obj.id || obj.response_id || obj.prompt_id || `qwen-code:${project}:${obj.timestamp}:${obj.model || "unknown"}:${JSON.stringify(usage)}` }));
      } catch {
        // Skip malformed JSONL rows.
      }
    }
  }
  return { buckets: aggregateBuckets(entries), sessions: extractSessions(sessionEvents, entries) };
}

function parseOpenCode() {
  const dbPath = join(OPENCODE_DIR, "opencode.db");
  if (!existsSync(dbPath)) return { buckets: [], sessions: [] };
  const rows = readOpenCodeMessages(dbPath);

  const entries = [];
  const sessionEvents = [];
  const timestamp = new Date();
  for (const row of rows) {
    const record = row.record || {};
    const tokens = record.tokens || {};
    const cache = typeof tokens.cache === "object" && tokens.cache ? tokens.cache : {};
    const inputTokens = safeNumber(tokens.input);
    const outputTokens = safeNumber(tokens.output);
    const cachedTokens = safeNumber(cache.read) + safeNumber(cache.write);
    const reasoningTokens = safeNumber(tokens.reasoning);
    if (!inputTokens && !outputTokens && !cachedTokens && !reasoningTokens) continue;
    const sessionId = record.sessionID || record.sessionId || dbPath;
    const project = record.path ? leafName(record.path) : "opencode";
    const model = record.modelID || record.model?.modelID || record.model || "unknown";
    sessionEvents.push({ sessionId, source: "opencode", project, timestamp, role: "assistant" });
    entries.push(tokenEntry({ sessionId, source: "opencode", model, project, timestamp, inputTokens, outputTokens, reasoningTokens, cachedTokens, dedupeKey: `opencode:${row.id}` }));
  }
  return { buckets: aggregateBuckets(entries), sessions: extractSessions(sessionEvents, entries) };
}

function readOpenCodeMessages(dbPath) {
  const sqliteRows = readOpenCodeMessagesWithSQLite(dbPath);
  if (sqliteRows.length) return sqliteRows;
  try {
    const dbBytes = readFileSync(dbPath);
    const cells = extractSQLiteTextCells(dbBytes);
    const rows = [];
    for (const cell of cells) {
      const record = parseLikelyJSON(cell);
      if (!record || record.role !== "assistant" || typeof record.tokens !== "object" || record.tokens === null) continue;
      rows.push({ id: `${dbPath}:${rows.length}`, record });
    }
    return rows;
  } catch {
    return [];
  }
}

function readOpenCodeMessagesWithSQLite(dbPath) {
  try {
    const stdout = execFileSync("sqlite3", ["-json", "-readonly", dbPath, "SELECT id, data FROM message"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    const rows = JSON.parse(stdout || "[]");
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row) => {
      try {
        const record = JSON.parse(row.data);
        if (record?.role !== "assistant" || typeof record.tokens !== "object" || record.tokens === null) return [];
        return [{ id: String(row.id), record }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function extractSQLiteTextCells(bytes) {
  if (bytes.length < 100 || bytes.toString("utf8", 0, 16) !== "SQLite format 3\u0000") return [];
  const pageSize = bytes.readUInt16BE(16) || 65536;
  const cells = [];
  for (let pageStart = 0; pageStart < bytes.length; pageStart += pageSize) {
    const pageTypeOffset = pageStart === 0 ? 100 : pageStart;
    if (pageTypeOffset >= bytes.length || bytes[pageTypeOffset] !== 0x0d) continue;
    const cellCount = bytes.readUInt16BE(pageTypeOffset + 3);
    const pointerBase = pageTypeOffset + 8;
    for (let index = 0; index < cellCount; index += 1) {
      const pointerOffset = pointerBase + index * 2;
      if (pointerOffset + 2 > bytes.length) break;
      const cellOffset = pageStart + bytes.readUInt16BE(pointerOffset);
      cells.push(...decodeSQLiteTableLeafCell(bytes, cellOffset));
    }
  }
  return cells;
}

function decodeSQLiteTableLeafCell(bytes, offset) {
  try {
    const payloadLength = readSQLiteVarint(bytes, offset);
    const rowID = readSQLiteVarint(bytes, payloadLength.next);
    const payloadStart = rowID.next;
    const payloadEnd = payloadStart + payloadLength.value;
    if (payloadEnd > bytes.length) return [];
    const headerLength = readSQLiteVarint(bytes, payloadStart);
    const serialTypes = [];
    let cursor = headerLength.next;
    const headerEnd = payloadStart + headerLength.value;
    while (cursor < headerEnd) {
      const serialType = readSQLiteVarint(bytes, cursor);
      serialTypes.push(serialType.value);
      cursor = serialType.next;
    }
    const values = [];
    cursor = headerEnd;
    for (const serialType of serialTypes) {
      const length = sqliteSerialTypeLength(serialType);
      if (length < 0 || cursor + length > payloadEnd) return [];
      if (serialType >= 13 && serialType % 2 === 1) {
        values.push(bytes.toString("utf8", cursor, cursor + length));
      }
      cursor += length;
    }
    return values;
  } catch {
    return [];
  }
}

function readSQLiteVarint(bytes, offset) {
  let value = 0;
  for (let index = 0; index < 9; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) throw new Error("invalid sqlite varint");
    if (index === 8) return { value: value * 256 + byte, next: offset + 9 };
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: offset + index + 1 };
  }
  throw new Error("invalid sqlite varint");
}

function sqliteSerialTypeLength(serialType) {
  if (serialType === 0 || serialType === 8 || serialType === 9) return 0;
  if (serialType === 1) return 1;
  if (serialType === 2) return 2;
  if (serialType === 3) return 3;
  if (serialType === 4) return 4;
  if (serialType === 5) return 6;
  if (serialType === 6 || serialType === 7) return 8;
  if (serialType >= 12) return Math.floor((serialType - 12) / 2);
  return -1;
}

function parseLikelyJSON(text) {
  if (!text || !text.includes("\"tokens\"") || !text.includes("\"assistant\"")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseOpenClaw() {
  const agentsDir = resolveOpenClawAgentsDir();
  if (!existsSync(agentsDir)) return { buckets: [], sessions: [] };
  const entries = [];
  const sessionEvents = [];
  for (const filePath of findFiles(agentsDir, (name) => name.includes("jsonl") && !name.startsWith("sessions.json"))) {
    let contextEstimate = 0;
    const project = leafName(dirname(dirname(filePath)));
    for (const line of readFileSafe(filePath).split("\n")) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        const message = typeof item.message === "object" && item.message ? item.message : {};
        const role = String(message.role || item.role || "").toLowerCase();
        const timestamp = parseOpenClawTimestamp(item) || new Date();
        const contextContribution = estimateOpenClawContextContribution(item);
        const recordEstimate = estimateOpenClawRecordTokens(item);
        if (role === "user" || role === "assistant") {
          sessionEvents.push({ sessionId: filePath, source: "openclaw", project, timestamp, role: role === "user" ? "user" : "assistant" });
        }
        if (item.type !== "message" || role !== "assistant") {
          contextEstimate += contextContribution;
          continue;
        }
        const model = String(message.model || "unknown");
        if (["delivery-mirror", "gateway-injected", ""].includes(model)) {
          contextEstimate += contextContribution;
          continue;
        }
        const rawUsage = typeof message.usage === "object" && message.usage ? message.usage : {};
        let inputTokens = safeNumber(rawUsage.input || rawUsage.input_tokens || rawUsage.prompt_tokens);
        let outputTokens = safeNumber(rawUsage.output || rawUsage.output_tokens || rawUsage.completion_tokens);
        if (!inputTokens && contextEstimate > 0) inputTokens = contextEstimate;
        if (!outputTokens && recordEstimate > 0) outputTokens = recordEstimate;
        if (inputTokens || outputTokens) {
          entries.push(tokenEntry({ sessionId: filePath, source: "openclaw", model, project, timestamp, inputTokens, outputTokens, reasoningTokens: 0, cachedTokens: 0, dedupeKey: item.uuid || item.id || message.id || `openclaw:${project}:${timestamp.toISOString()}:${model}:${JSON.stringify(rawUsage)}:${recordEstimate}` }));
        }
        contextEstimate += contextContribution;
      } catch {
        // Skip malformed JSONL rows.
      }
    }
  }
  return { buckets: aggregateBuckets(entries), sessions: extractSessions(sessionEvents, entries) };
}

function resolveOpenClawAgentsDir() {
  const configured = process.env.AGENTS_DIR?.trim();
  if (configured) return expandHomePath(configured);
  const candidates = [
    join(process.cwd(), ".openclaw", "agents"),
    join(dirname(new URL(import.meta.url).pathname), ".openclaw", "agents"),
    join(OPENCLAW_DIR, "agents"),
  ];
  return candidates.find((path) => existsSync(path)) || candidates[0];
}

function expandHomePath(value) {
  return value.startsWith(`~${sep}`) ? join(homedir(), value.slice(2)) : value;
}

function resolveUsageDelta(model, info, previousTotals) {
  if (info.last_token_usage) return info.last_token_usage;
  if (!info.total_token_usage) return null;
  const previous = previousTotals.get(model);
  const current = info.total_token_usage;
  previousTotals.set(model, { ...current });
  if (!previous) return current;
  return {
    input_tokens: Math.max(0, safeNumber(current.input_tokens) - safeNumber(previous.input_tokens)),
    output_tokens: Math.max(0, safeNumber(current.output_tokens) - safeNumber(previous.output_tokens)),
    cached_input_tokens: Math.max(0, safeNumber(current.cached_input_tokens) - safeNumber(previous.cached_input_tokens)),
    reasoning_output_tokens: Math.max(0, safeNumber(current.reasoning_output_tokens) - safeNumber(previous.reasoning_output_tokens)),
  };
}

function aggregateBuckets(entries) {
  entries = dedupeEntries(entries);
  const buckets = new Map();
  for (const entry of entries) {
    const bucketStart = roundHalfHour(entry.timestamp).toISOString();
    const projectKey = hashProject(entry.project);
    const key = [entry.source, entry.model, projectKey, bucketStart].join("|");
    const current = buckets.get(key) || { source: entry.source, model: entry.model, projectKey, projectLabel: entry.project, bucketStart, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, totalTokens: 0 };
    current.inputTokens += entry.inputTokens;
    current.outputTokens += entry.outputTokens;
    current.reasoningTokens += entry.reasoningTokens;
    current.cachedTokens += entry.cachedTokens;
    current.totalTokens += entry.inputTokens + entry.outputTokens + entry.reasoningTokens + entry.cachedTokens;
    buckets.set(key, current);
  }
  return Array.from(buckets.values());
}

function extractSessions(events, entries) {
  events = dedupeSessionEvents(events);
  entries = dedupeEntries(entries);
  const grouped = new Map();
  for (const event of events) {
    if (!grouped.has(event.sessionId)) grouped.set(event.sessionId, []);
    grouped.get(event.sessionId).push(event);
  }
  return Array.from(grouped.entries()).map(([sessionId, sessionEvents]) => {
    sessionEvents.sort((a, b) => a.timestamp - b.timestamp);
    const first = sessionEvents[0];
    const last = sessionEvents.at(-1);
    const usage = entries.filter((entry) => entry.sessionId === sessionId);
    const modelUsages = buildModelUsages(usage);
    const totals = modelUsages.reduce((sum, item) => ({ inputTokens: sum.inputTokens + item.inputTokens, outputTokens: sum.outputTokens + item.outputTokens, reasoningTokens: sum.reasoningTokens + item.reasoningTokens, cachedTokens: sum.cachedTokens + item.cachedTokens, totalTokens: sum.totalTokens + item.totalTokens }), { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, totalTokens: 0 });
    const primaryModel = modelUsages[0]?.model || "";
    return { source: first.source, projectKey: hashProject(first.project), projectLabel: first.project, sessionHash: createHash("sha256").update(sessionId).digest("hex").slice(0, 16), firstMessageAt: first.timestamp.toISOString(), lastMessageAt: last.timestamp.toISOString(), durationSeconds: Math.max(0, Math.round((last.timestamp - first.timestamp) / 1000)), activeSeconds: estimateActiveSeconds(sessionEvents), messageCount: sessionEvents.length, userMessageCount: sessionEvents.filter((event) => event.role === "user").length, ...totals, primaryModel, modelUsages };
  });
}

function dedupeSessionEvents(events) {
  const seen = new Set();
  const out = [];
  for (const event of events) {
    const key = [
      event.source,
      event.project || "unknown",
      event.timestamp instanceof Date ? event.timestamp.toISOString() : String(event.timestamp || ""),
      event.role || "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

function dedupeEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = entry.dedupeKey || tokenEntry(entry).dedupeKey;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function buildModelUsages(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const model = entry.model || "unknown";
    const current = grouped.get(model) || { model, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, totalTokens: 0 };
    current.inputTokens += entry.inputTokens;
    current.outputTokens += entry.outputTokens;
    current.reasoningTokens += entry.reasoningTokens;
    current.cachedTokens += entry.cachedTokens;
    current.totalTokens += entry.inputTokens + entry.outputTokens + entry.reasoningTokens + entry.cachedTokens;
    grouped.set(model, current);
  }
  return Array.from(grouped.values()).sort((left, right) => right.totalTokens - left.totalTokens || left.model.localeCompare(right.model));
}

function estimateActiveSeconds(events) {
  let total = 0;
  let turnStart = null;
  let turnEnd = null;
  let waitingForFirstResponse = false;
  for (const event of events) {
    if (event.role === "user") {
      if (turnStart && turnEnd && turnEnd > turnStart) total += Math.round((turnEnd - turnStart) / 1000);
      turnStart = null;
      turnEnd = null;
      waitingForFirstResponse = true;
    } else if (waitingForFirstResponse) {
      turnStart = event.timestamp;
      turnEnd = event.timestamp;
      waitingForFirstResponse = false;
    } else if (turnStart) {
      turnEnd = event.timestamp;
    }
  }
  if (turnStart && turnEnd && turnEnd > turnStart) total += Math.round((turnEnd - turnStart) / 1000);
  return total;
}

function sourceTotals(buckets) {
  const totals = new Map();
  for (const bucket of buckets) {
    totals.set(bucket.source, (totals.get(bucket.source) || 0) + bucket.totalTokens);
  }
  return Array.from(totals.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function summarizeBuckets(buckets, sessions = []) {
  return buckets.reduce((sum, bucket) => ({
    inputTokens: sum.inputTokens + safeNumber(bucket.inputTokens),
    outputTokens: sum.outputTokens + safeNumber(bucket.outputTokens),
    reasoningTokens: sum.reasoningTokens + safeNumber(bucket.reasoningTokens),
    cachedTokens: sum.cachedTokens + safeNumber(bucket.cachedTokens),
    totalTokens: sum.totalTokens + safeNumber(bucket.totalTokens),
    activeSeconds: sum.activeSeconds,
    sessions: sessions.length,
  }), { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, totalTokens: 0, activeSeconds: sessions.reduce((total, session) => total + safeNumber(session.activeSeconds), 0), sessions: sessions.length });
}

function printTotals(totals) {
  console.log(`总计：${formatTokens(totals.totalTokens)}`);
  console.log(`输入：${formatTokens(totals.inputTokens)}`);
  console.log(`输出：${formatTokens(totals.outputTokens)}`);
  console.log(`缓存：${formatTokens(totals.cachedTokens)}`);
  console.log(`推理：${formatTokens(totals.reasoningTokens)}（已计入总计，单独展示方便核对）`);
  console.log(`会话：${formatNumber(totals.sessions)} 个`);
  console.log(`活跃：${formatDuration(totals.activeSeconds)}`);
}

function groupBucketsBy(buckets, keyForBucket) {
  const rows = new Map();
  for (const bucket of buckets) {
    const key = keyForBucket(bucket);
    const current = rows.get(key) || { key, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, totalTokens: 0 };
    current.inputTokens += safeNumber(bucket.inputTokens);
    current.outputTokens += safeNumber(bucket.outputTokens);
    current.reasoningTokens += safeNumber(bucket.reasoningTokens);
    current.cachedTokens += safeNumber(bucket.cachedTokens);
    current.totalTokens += safeNumber(bucket.totalTokens);
    rows.set(key, current);
  }
  return Array.from(rows.values()).sort((left, right) => left.key.localeCompare(right.key));
}

function printRows(rows, label) {
  if (!rows.length) {
    console.log("暂无可展示的本地 Token 数据。");
    return;
  }
  const keyWidth = Math.max(label.length, ...rows.map((row) => row.key.length));
  console.log(`${label.padEnd(keyWidth)}  总计        输入        输出        缓存`);
  for (const row of rows) {
    console.log(`${row.key.padEnd(keyWidth)}  ${formatTokens(row.totalTokens).padStart(10)}  ${formatTokens(row.inputTokens).padStart(10)}  ${formatTokens(row.outputTokens).padStart(10)}  ${formatTokens(row.cachedTokens).padStart(10)}`);
  }
}

function findJsonlFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...findJsonlFiles(path));
    if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files;
}

function findFiles(root, matches) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...findFiles(path, matches));
    if (entry.isFile() && matches(entry.name)) files.push(path);
  }
  return files;
}

function readFileSafe(path) {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function normalizeCodexSource(source) {
  const value = String(source || "").trim().toLowerCase();
  if (["vscode", "app", "desktop"].includes(value)) return "codex_app";
  if (value === "cli") return "codex_cli";
  return "codex_unknown";
}

function getClaudeRoots() {
  const roots = [CLAUDE_DIR];
  const custom = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (custom) roots.push(custom.startsWith("~") ? join(homedir(), custom.slice(1)) : custom);
  const seen = new Set();
  return roots.filter((root) => {
    let key = root;
    try { key = realpathSync(root); } catch { /* Directory may not exist. */ }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isClaudeInstalled() {
  return getClaudeRoots().some((root) => existsSync(join(root, "projects")) || existsSync(join(root, "transcripts")) || existsSync(join(root, "sessions")));
}

function projectRelativePath(filePath, projectsDir) {
  const prefix = projectsDir + sep;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : null;
}

function extractClaudeProject(filePath, projectsDir) {
  const relative = projectRelativePath(filePath, projectsDir);
  const first = relative?.split(sep)[0] || "";
  const parts = first.split("-").filter(Boolean);
  return parts.at(-1) || "unknown";
}

function hashSessionId(sessionId) {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
}

function readGeminiRecord(filePath) {
  const raw = readFileSafe(filePath);
  if (!raw) return null;
  if (filePath.endsWith(".jsonl")) {
    const messages = [];
    let directories = null;
    let model = null;
    let createTime = null;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (!directories && Array.isArray(obj.directories)) {
          directories = obj.directories;
          if (typeof obj.model === "string") model = obj.model;
          if (typeof obj.createTime === "string") createTime = obj.createTime;
          continue;
        }
        if (typeof obj.type === "string" || typeof obj.role === "string" || obj.tokens || obj.usage || obj.usageMetadata) messages.push(obj);
      } catch {
        // Skip malformed JSONL rows.
      }
    }
    return { messages, directories, model, createTime };
  }
  const data = readJsonSafe(filePath);
  if (!data) return null;
  return {
    messages: Array.isArray(data.messages) ? data.messages : Array.isArray(data.history) ? data.history : [],
    directories: Array.isArray(data.directories) ? data.directories : null,
    model: typeof data.model === "string" ? data.model : null,
    createTime: typeof data.createTime === "string" ? data.createTime : null,
  };
}

function classifyGeminiRole(message) {
  const value = message.type || message.role;
  if (value === "user") return "user";
  if (["gemini", "model", "assistant"].includes(value)) return "assistant";
  return message.tokens || message.usage || message.usageMetadata ? "assistant" : null;
}

function projectFromDirectories(directories) {
  if (!Array.isArray(directories) || !directories.length) return "unknown";
  return leafName(String(directories[0])) || "unknown";
}

function projectFromToolTmpPath(filePath, root) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const relative = normalizedPath.startsWith(`${normalizedRoot}/`) ? normalizedPath.slice(normalizedRoot.length + 1) : "";
  return relative.split("/").filter(Boolean)[0] || "unknown";
}

function leafName(value) {
  return basename(String(value).replace(/[\\/]+$/, "")) || "unknown";
}

function parseOpenClawTimestamp(item) {
  const value = item.timestamp || item.createdAt || item.created_at || item.time;
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function estimateOpenClawTextTokens(text) {
  const value = String(text || "");
  let tokens = 0;
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (CJK_RE.test(char)) {
      tokens += 1;
      index += 1;
      continue;
    }
    ASCII_WORD_RE.lastIndex = index;
    const match = ASCII_WORD_RE.exec(value);
    if (match) {
      tokens += Math.max(1, Math.ceil(match[0].length / 4));
      index = ASCII_WORD_RE.lastIndex;
      continue;
    }
    tokens += 1;
    index += 1;
  }
  return tokens;
}

function estimateOpenClawContentTokens(content, includeThinking = false) {
  if (content == null) return 0;
  if (typeof content === "string") return estimateOpenClawTextTokens(content);
  if (Array.isArray(content)) {
    return content.reduce((sum, part) => sum + estimateOpenClawContentTokens(part, includeThinking), 0);
  }
  if (typeof content === "object") {
    const type = String(content.type || "").toLowerCase();
    if (type === "thinking" && !includeThinking) return 0;
    if (type === "image" || type === "image_url" || type === "input_image") return 1200;
    if (typeof content.text === "string") return estimateOpenClawTextTokens(content.text);
    if (typeof content.thinking === "string") return includeThinking ? estimateOpenClawTextTokens(content.thinking) : 0;
    if ("content" in content) return estimateOpenClawContentTokens(content.content, includeThinking);
    const safe = { ...content };
    delete safe.data;
    delete safe.image;
    delete safe.image_url;
    return estimateOpenClawTextTokens(JSON.stringify(safe));
  }
  return estimateOpenClawTextTokens(String(content));
}

function estimateOpenClawRecordTokens(item) {
  const message = typeof item.message === "object" && item.message ? item.message : null;
  return message ? estimateOpenClawContentTokens(message.content, false) : 0;
}

function estimateOpenClawContextContribution(item) {
  const message = typeof item.message === "object" && item.message ? item.message : null;
  if (!message) return 0;
  const role = String(message.role || item.role || "").toLowerCase();
  return role === "user" || role === "assistant" ? estimateOpenClawContentTokens(message.content, false) : 0;
}

function resolveProject(payload = {}) {
  const repo = payload.git?.repository_url?.match(/([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  if (repo) return repo;
  const cwd = String(payload.cwd || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return cwd.split("/").filter(Boolean).pop() || "unknown";
}

function roundHalfHour(date) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() < 30 ? 0 : 30, 0, 0);
  return next;
}

function hashProject(project) {
  return createHash("sha256").update(project || "unknown").digest("hex").slice(0, 16);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function loadConfig(required) {
  if (!existsSync(CONFIG_FILE)) {
    if (required) throw new Error("CLI is not initialized. Run forever-token init first.");
    return null;
  }
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
}

function saveConfig(config) {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function promptInitConfig(current, apiUrlArg) {
  const defaultApiUrl = apiUrlArg || current.apiUrl || DEFAULT_API_URL;
  if (!input.isTTY) {
    output.write("Token统计 CLI Key: ");
    const answers = readFileSync(0, "utf8").split(/\r?\n/);
    const firstAnswer = (answers[0] ?? "").trim();
    const secondAnswer = (answers[1] ?? "").trim();
    const apiUrlInput = (secondAnswer || looksLikeUrl(firstAnswer)) ? firstAnswer : "";
    const apiKey = secondAnswer || (looksLikeUrl(firstAnswer) ? "" : firstAnswer);
    if (!apiKey) {
      throw new Error("CLI Key is required. Generate one in 4Ever Token统计 and paste it here.");
    }
    return { apiUrl: normalizeApiUrl(apiUrlInput || defaultApiUrl), apiKey };
  }
  const prompt = createInterface({ input, output });
  try {
    output.write(`4Ever API URL: ${defaultApiUrl}\n`);
    const apiKey = (await prompt.question("Token统计 CLI Key: ")).trim();
    if (!apiKey) {
      throw new Error("CLI Key is required. Generate one in 4Ever Token统计 and paste it here.");
    }
    return { apiUrl: normalizeApiUrl(defaultApiUrl), apiKey };
  } finally {
    prompt.close();
  }
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value);
}

function normalizeApiUrl(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_API_URL;
  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    throw new Error("Invalid API URL. Example: http://127.0.0.1:7778");
  }
}

function readOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
}

function hasOption(args, name) {
  return args.includes(name);
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatTokens(value) {
  const tokens = safeNumber(value);
  const unit = tokens >= 1_000_000_000 ? { divisor: 1_000_000_000, suffix: "B" } : { divisor: 1_000_000, suffix: "M" };
  const scaled = tokens / unit.divisor;
  const formatted = scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2);
  return `${trimTrailingZeros(formatted)}${unit.suffix} Tokens`;
}

function trimTrailingZeros(value) {
  return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatDuration(seconds) {
  const value = safeNumber(seconds);
  if (value < 60) return `${value} 秒`;
  if (value < 3600) return `${Math.round(value / 60)} 分钟`;
  return `${(value / 3600).toFixed(1)} 小时`;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDisplayDate(value) {
  const [year, month, day] = String(value).split("-").map((item) => Number(item));
  if (!year || !month || !day) return new Date(Number.NaN);
  return new Date(year, month - 1, day);
}

function displayDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const hour = byType.get("hour") === "24" ? "00" : byType.get("hour");
  const day = `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
  return {
    month: `${byType.get("year")}-${byType.get("month")}`,
    day,
    hour: hour || "00",
  };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(join(dirname(new URL(import.meta.url).pathname), "..", "package.json"), "utf8"));
    return packageJson.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}
