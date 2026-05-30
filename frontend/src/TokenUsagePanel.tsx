import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BarChart3, Check, Clipboard, Clock3, Flame, KeyRound, LoaderCircle, Medal, Package, RefreshCw, TerminalSquare, Trophy, Zap } from "lucide-react";
import { createPortal } from "react-dom";

import { createTokenUsageKey, fetchTokenUsageDashboard, fetchTokenUsageKeys, fetchTokenUsageLeaderboard, getApiBaseUrl } from "./services/api";
import type { AuthUser } from "./types/auth";
import type { TokenUsageApiKey, TokenUsageDashboard, TokenUsageDeviceSummary, TokenUsageLeaderboard } from "./types/tokenUsage";

type TokenUsageView = "dashboard" | "leaderboard" | "guide";
type TrendMode = "day" | "week" | "month" | "custom";
type TokenUsageRangeQuery = "1d" | "7d" | "30d" | "all" | `custom:${string}:${string}`;

type TooltipData = {
  x: number;
  y: number;
  content: React.ReactNode;
} | null;

type ContributionDay = {
  day: string;
  date: Date;
  total_tokens: number;
  active_seconds: number;
  inRange: boolean;
};

type ContributionWeek = {
  key: string;
  days: ContributionDay[];
};

type ContributionHeatmap = {
  weeks: ContributionWeek[];
  monthLabels: Array<{ key: string; label: string; column: number }>;
  peak: number;
};

type TrendBar = {
  key: string;
  label: string;
  title: string;
  total_tokens: number;
  active_seconds: number;
};

type TrendData = {
  bars: TrendBar[];
  error: string;
};

const emptyDashboard: TokenUsageDashboard = {
  range: "all",
  overview: {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    total_tokens: 0,
    active_seconds: 0,
    sessions: 0,
    messages: 0,
    devices: 0,
    sources: 0,
    projects: 0,
    models: 0,
  },
  token_trend: [],
  heatmap: [],
  by_source: [],
  by_model: [],
  by_project: [],
  devices: [],
  last_synced_at: null,
};

export default function TokenUsagePanel(props: { authToken: string; currentUser: AuthUser | null }) {
  const [view, setView] = useState<TokenUsageView>("dashboard");
  const [trendMode, setTrendMode] = useState<TrendMode>("month");
  const [customStart, setCustomStart] = useState(() => isoDate(addDays(new Date(), -29)));
  const [customEnd, setCustomEnd] = useState(() => isoDate(new Date()));
  const [dashboard, setDashboard] = useState<TokenUsageDashboard>(emptyDashboard);
  const [allTimeDashboard, setAllTimeDashboard] = useState<TokenUsageDashboard>(emptyDashboard);
  const [leaderboard, setLeaderboard] = useState<TokenUsageLeaderboard>({ entries: [] });
  const [keys, setKeys] = useState<TokenUsageApiKey[]>([]);
  const [rawKey, setRawKey] = useState("");
  const [copied, setCopied] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [error, setError] = useState("");
  const [tooltip, setTooltip] = useState<TooltipData>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const apiBaseUrl = getApiBaseUrl();
  const installCommand = "npm install -g @anglyaoy/token-usage";
  const initCommand = "forever-token init";
  const manualSyncCommand = "forever-token sync";
  const autoSyncCommand = "forever-token service setup";
  const uninstallCommand = "npm uninstall -g @anglyaoy/token-usage";

  // 判断是否有数据（首次使用）
  const hasData = dashboard.overview.total_tokens > 0 || dashboard.devices.length > 0;

  useEffect(() => {
    if (!props.authToken) {
      setDashboard(emptyDashboard);
      setAllTimeDashboard(emptyDashboard);
      setLeaderboard({ entries: [] });
      setKeys([]);
      setRawKey("");
      setCopied("");
      setLoading(false);
      setLoadingLabel("");
      return;
    }
    void refresh();
  }, [props.authToken, trendMode, customStart, customEnd]);

  // 首次访问检测
  useEffect(() => {
    const hasVisited = localStorage.getItem("token-usage-visited");
    if (!hasVisited && !hasData) {
      setShowGuideModal(true);
      localStorage.setItem("token-usage-visited", "true");
    }
  }, [hasData]);

  async function refresh() {
    setLoading(true);
    setLoadingLabel("正在同步 Token 统计数据");
    setError("");
    try {
      const queryRange = rangeFromTrendMode(trendMode, customStart, customEnd);
      if (queryRange === null) {
        setError("请选择有效的自定义日期范围。");
        return;
      }
      const [nextDashboard, nextAllTimeDashboard, nextLeaderboard, nextKeys] = await Promise.all([
        fetchTokenUsageDashboard(props.authToken, queryRange),
        fetchTokenUsageDashboard(props.authToken, "all"),
        fetchTokenUsageLeaderboard(props.authToken, queryRange),
        fetchTokenUsageKeys(props.authToken),
      ]);
      setDashboard(nextDashboard);
      setAllTimeDashboard(nextAllTimeDashboard);
      setLeaderboard(nextLeaderboard);
      setKeys(nextKeys);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Token 统计加载失败");
    } finally {
      setLoading(false);
      setLoadingLabel("");
    }
  }

  async function createKey() {
    if (!props.authToken) return;
    setLoading(true);
    setLoadingLabel("正在生成 CLI Key");
    setError("");
    try {
      const result = await createTokenUsageKey(props.authToken, `${props.currentUser?.username ?? "4Ever"} CLI`);
      setRawKey(result.raw_key);
      setKeys((current) => [result.key, ...current]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CLI Key 创建失败");
    } finally {
      setLoading(false);
      setLoadingLabel("");
    }
  }

  async function copyText(value: string, label: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setError("复制失败，请手动选择文本。");
    }
  }

  const trendData = useMemo(() => buildTrendData(dashboard, trendMode, customStart, customEnd), [dashboard, trendMode, customStart, customEnd]);
  const trendMax = useMemo(() => Math.max(1, ...trendData.bars.map((point) => point.total_tokens)), [trendData.bars]);
  const contributionHeatmap = useMemo(() => buildContributionHeatmap(allTimeDashboard.heatmap), [allTimeDashboard.heatmap]);

  // Tooltip 处理函数
  const showTooltip = (event: React.MouseEvent<HTMLElement>, content: React.ReactNode) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const tooltipWidth = 220;
    const tooltipHeight = 90;

    // 默认显示在元素右侧
    let x = rect.right + 10;
    let y = rect.top;

    // 如果右侧空间不够，显示在左侧
    if (x + tooltipWidth > window.innerWidth) {
      x = rect.left - tooltipWidth - 10;
    }

    // 垂直居中对齐
    y = rect.top + rect.height / 2 - tooltipHeight / 2;

    // 确保不超出屏幕
    if (y < 10) y = 10;
    if (y + tooltipHeight > window.innerHeight) y = window.innerHeight - tooltipHeight - 10;

    setTooltip({ x, y, content });
  };

  const hideTooltip = () => {
    setTooltip(null);
  };

  if (!props.currentUser) {
    return (
      <section className="token-panel">
        <div className="module-view-header"><div><p className="eyebrow">Token 用量</p><h1>Token统计</h1><span className="module-view-subtitle">登录后绑定当前系统账户并同步本机 Token 用量</span></div></div>
        <div className="token-login-empty" role="status" aria-live="polite"><KeyRound size={24} /><strong>需要登录账户</strong><p>Token 用量会绑定到当前 4Ever 账户，用于仪表盘、排行榜和活跃度热力图。</p></div>
      </section>
    );
  }

  return (
    <section className="token-panel">
      <div className="module-view-header">
        <div><p className="eyebrow">Token 用量</p><h1>Token统计</h1><span className="module-view-subtitle">绑定 {props.currentUser.display_name || props.currentUser.username} 的本机 AI 工具用量</span></div>
        <div className="token-header-actions">
          <button className="secondary-button compact" type="button" disabled={loading} onClick={refresh}><RefreshCw size={15} /><span>刷新</span></button>
        </div>
      </div>

      <div className="token-section-tabs" role="tablist" aria-label="Token统计视图">
        <button type="button" role="tab" aria-selected={view === "dashboard"} className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}><Activity size={15} /><span>仪表盘</span></button>
        <button type="button" role="tab" aria-selected={view === "leaderboard"} className={view === "leaderboard" ? "active" : ""} onClick={() => setView("leaderboard")}><Trophy size={15} /><span>排行榜</span></button>
        <button type="button" role="tab" aria-selected={view === "guide"} className={view === "guide" ? "active" : ""} onClick={() => setView("guide")}><TerminalSquare size={15} /><span>开始更了解自己！</span></button>
      </div>

      {error && <p className="react-error-line" role="alert">{error}</p>}
      {loading && <p className="react-status-line pending" role="status" aria-live="polite"><LoaderCircle className="spin" size={14} />{loadingLabel || "正在处理 Token 统计数据"}</p>}

      {view === "dashboard" ? <div className="token-dashboard-layout" aria-busy={loading}>
        <article className="token-chart-card token-heatmap-card">
          <div className="token-chart-header">
            <div className="token-chart-title">
              <Activity size={18} />
              <div>
                <strong>活跃度热力图</strong>
                <small>始终展示全部历史中的最近 12 个月，不受趋势筛选影响</small>
              </div>
            </div>
          </div>
          <div className="token-heatmap-table" aria-label="活跃度热力图">
            {contributionHeatmap.weeks.length ? <>
              <div className="token-contribution-months" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${contributionHeatmap.weeks.length}, minmax(0, 1fr))` }}>
                {contributionHeatmap.monthLabels.map((month) => <span key={month.key} style={{ gridColumn: month.column }}>{month.label}</span>)}
              </div>
              <div className="token-contribution-wrap">
                <div className="token-contribution-weekdays" aria-hidden="true"><span>一</span><span>三</span><span>五</span></div>
                <div className="token-contribution-grid" style={{ gridTemplateColumns: `repeat(${contributionHeatmap.weeks.length}, minmax(0, 1fr))` }}>
                  {contributionHeatmap.weeks.map((week) => <div key={week.key} className="token-contribution-week">
                    {week.days.map((day) => <button
                      key={day.day}
                      type="button"
                      className={`token-contribution-cell level-${contributionLevel(day.total_tokens, contributionHeatmap.peak)} ${day.inRange ? "" : "outside"}`}
                      aria-label={`${day.day}，${formatTokens(day.total_tokens)}，活跃 ${formatDuration(day.active_seconds)}`}
                      onMouseEnter={(e) => showTooltip(e, <>
                        <strong>{day.day}</strong>
                        <span>{formatTokens(day.total_tokens)}</span>
                        <small>活跃 {formatDuration(day.active_seconds)}</small>
                      </>)}
                      onMouseLeave={hideTooltip}
                    />)}
                  </div>)}
                </div>
              </div>
              <div className="token-contribution-legend" aria-hidden="true"><span>少</span><i className="level-0" /><i className="level-1" /><i className="level-2" /><i className="level-3" /><i className="level-4" /><span>多</span></div>
            </> : <p className="token-empty-line" role="status" aria-live="polite">同步后显示热力图</p>}
          </div>
        </article>

        <article className="token-chart-card token-trend-card">
          <div className="token-chart-header">
            <div className="token-chart-title">
              <BarChart3 size={18} />
              <div>
                <strong>Token 趋势</strong>
                <small>{trendRangeLabel(trendMode, customStart, customEnd)} · {dashboard.last_synced_at ? `最近同步 ${formatDate(dashboard.last_synced_at)}` : "等待 CLI 上传数据"}</small>
              </div>
            </div>
            <div className="token-trend-controls-shell">
              <div className="token-trend-controls" role="group" aria-label="趋势统计方式">
                {(["day", "week", "month", "custom"] as TrendMode[]).map((mode) => <button key={mode} type="button" className={trendMode === mode ? "active" : ""} aria-pressed={trendMode === mode} onClick={() => setTrendMode(mode)}>{trendModeLabel(mode)}</button>)}
              </div>
              {trendMode === "custom" && <div className="token-trend-custom" aria-label="自定义趋势范围">
                <label><span>开始</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
                <label><span>结束</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
                <small>最多 6 个月，按天均分。</small>
              </div>}
            </div>
          </div>
          {trendData.error && <p className="react-error-line" role="alert">{trendData.error}</p>}
          <div className="token-trend-chart" aria-label="Token 趋势" style={{ gridTemplateColumns: `repeat(${Math.max(1, trendData.bars.length)}, minmax(0, 1fr))` }}>
            {trendData.bars.length ? trendData.bars.map((point) => <span
              key={point.key}
              role="img"
              tabIndex={0}
              aria-label={`${point.title}，${formatTokens(point.total_tokens)}，活跃 ${formatDuration(point.active_seconds)}`}
              style={{ height: `${Math.max(8, (point.total_tokens / trendMax) * 100)}%` }}
              onMouseEnter={(e) => showTooltip(e, <>
                <strong>{point.title}</strong>
                <span>{formatTokens(point.total_tokens)}</span>
                <small>活跃 {formatDuration(point.active_seconds)} · 峰值 {Math.round((point.total_tokens / trendMax) * 100)}%</small>
              </>)}
              onMouseLeave={hideTooltip}
            ><em>{point.label}</em></span>) : <p className="token-empty-line" role="status" aria-live="polite">暂无趋势数据</p>}
          </div>
        </article>

        <StatsGrid overview={dashboard.overview} label={trendRangeLabel(trendMode, customStart, customEnd)} />
      </div> : view === "leaderboard" ? <section className="token-leaderboard-page" aria-busy={loading}>
        <article className="token-card token-leaderboard-main">
          <div className="token-card-head"><Trophy size={18} /><div><strong>账户排行榜</strong><small>当前范围内按 Token 总量排序</small></div></div>
          <div className="token-leaderboard-list expanded">
            {leaderboard.entries.map((entry) => <div key={entry.user_id}><span><Medal size={15} />#{entry.rank}</span><strong>{entry.display_name || entry.username}</strong><em>{formatNumber(entry.total_tokens)}</em><small>{formatDuration(entry.active_seconds)} · {entry.sessions} 个会话</small></div>)}
            {!leaderboard.entries.length && <p className="token-empty-line" role="status" aria-live="polite">暂无排行榜数据</p>}
          </div>
        </article>
        <div className="token-rank-page-grid">
          <RankCard title="工具排行" items={dashboard.by_source} />
          <RankCard title="模型排行" items={dashboard.by_model} />
          <RankCard title="项目排行" items={dashboard.by_project} />
        </div>
      </section> : <GuideView
        installCommand={installCommand}
        initCommand={initCommand}
        manualSyncCommand={manualSyncCommand}
        autoSyncCommand={autoSyncCommand}
        uninstallCommand={uninstallCommand}
        copied={copied}
        onCopy={copyText}
        keys={keys}
        rawKey={rawKey}
        loading={loading}
        onCreateKey={createKey}
        devices={dashboard.devices}
      />}

      {/* Guide Modal */}
      {showGuideModal && createPortal(
        <div className="token-modal-overlay" onClick={() => setShowGuideModal(false)}>
          <div className="token-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="token-modal-header">
              <div>
                <h2>让你更了解你</h2>
                <p>安装 CLI 工具，自动采集本地 AI 使用数据</p>
              </div>
              <button className="token-modal-close" onClick={() => setShowGuideModal(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="token-modal-content">
              <GuideView
                installCommand={installCommand}
                initCommand={initCommand}
                manualSyncCommand={manualSyncCommand}
                autoSyncCommand={autoSyncCommand}
                uninstallCommand={uninstallCommand}
                copied={copied}
                onCopy={copyText}
                keys={keys}
                rawKey={rawKey}
                loading={loading}
                onCreateKey={createKey}
                devices={dashboard.devices}
              />
            </div>
            <div className="token-modal-footer">
              <button className="primary-action" onClick={() => setShowGuideModal(false)}>
                开始使用
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Tooltip Portal */}
      {tooltip && createPortal(
        <div
          className="token-custom-tooltip"
          style={{
            position: 'fixed',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            zIndex: 9999
          }}
        >
          {tooltip.content}
        </div>,
        document.body
      )}
    </section>
  );
}

function CommandLine(props: { value: string; label: string; copied: string; onCopy: (value: string, label: string) => void }) {
  const isCopied = props.copied === props.label;
  return (
    <div className="token-command-row">
      <code>{props.value}</code>
      <button className="secondary-button compact" type="button" aria-label={`复制 ${props.label} 命令`} title="复制命令" onClick={() => props.onCopy(props.value, props.label)}>
        {isCopied ? <Check size={14} /> : <Clipboard size={14} />}
        <span>{isCopied ? "已复制" : "复制"}</span>
      </button>
    </div>
  );
}

function Metric(props: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="token-metric"><span>{props.icon}</span><small>{props.label}</small><strong>{props.value}</strong></div>;
}

function StatsGrid(props: { overview: TokenUsageDashboard["overview"]; label: string }) {
  const overview = props.overview;
  return (
    <section className="token-stats-grid" aria-label={`${props.label}统计概览`}>
      <article className="token-stat-card">
        <div className="token-stat-icon"><Flame size={20} /></div>
        <div className="token-stat-content">
          <span className="token-stat-label">总 Token</span>
          <strong className="token-stat-value">{formatNumber(overview.total_tokens)}</strong>
        </div>
      </article>
      <article className="token-stat-card">
        <div className="token-stat-icon"><Zap size={20} /></div>
        <div className="token-stat-content">
          <span className="token-stat-label">输入 Token</span>
          <strong className="token-stat-value">{formatNumber(overview.input_tokens)}</strong>
        </div>
      </article>
      <article className="token-stat-card">
        <div className="token-stat-icon"><Activity size={20} /></div>
        <div className="token-stat-content">
          <span className="token-stat-label">输出 Token</span>
          <strong className="token-stat-value">{formatNumber(overview.output_tokens)}</strong>
        </div>
      </article>
      <article className="token-stat-card">
        <div className="token-stat-icon"><Clock3 size={20} /></div>
        <div className="token-stat-content">
          <span className="token-stat-label">活跃时长</span>
          <strong className="token-stat-value">{formatDuration(overview.active_seconds)}</strong>
        </div>
      </article>
      <article className="token-stat-card">
        <div className="token-stat-icon"><BarChart3 size={20} /></div>
        <div className="token-stat-content">
          <span className="token-stat-label">会话数</span>
          <strong className="token-stat-value">{overview.sessions}</strong>
        </div>
      </article>
      <article className="token-stat-card">
        <div className="token-stat-icon"><Package size={20} /></div>
        <div className="token-stat-content">
          <span className="token-stat-label">项目数</span>
          <strong className="token-stat-value">{overview.projects}</strong>
        </div>
      </article>
    </section>
  );
}

function GuideView(props: {
  installCommand: string;
  initCommand: string;
  manualSyncCommand: string;
  autoSyncCommand: string;
  uninstallCommand: string;
  copied: string;
  onCopy: (value: string, label: string) => void;
  keys: TokenUsageApiKey[];
  rawKey: string;
  loading: boolean;
  onCreateKey: () => void;
  devices: TokenUsageDeviceSummary[];
}) {
  return (
    <section className="token-guide-page">
      <article className="token-card">
        <div className="token-card-head">
          <TerminalSquare size={18} />
          <div>
            <strong>让你更了解你</strong>
            <small>安装 CLI 工具，自动采集本地 AI 使用数据</small>
          </div>
        </div>
        <div className="token-guide-content">
          <div className="token-guide-section">
            <h3>🔑 CLI Key 管理</h3>
            <p>生成 CLI Key 用于绑定本地设备，初始化时需要输入此 Key</p>
            <div className="token-key-actions">
              <button className="primary-action compact" type="button" disabled={props.loading} onClick={props.onCreateKey}>
                <KeyRound size={15} />
                <span>生成 CLI Key</span>
              </button>
              {props.keys[0] && (
                <span className="token-key-status">
                  当前：{props.keys[0].prefix}... · {props.keys[0].last_used_at ? `上次同步 ${formatDate(props.keys[0].last_used_at)}` : "等待同步"}
                </span>
              )}
            </div>
            {props.rawKey && (
              <div className="token-secret-reveal">
                <p className="token-secret-value">{props.rawKey}</p>
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => props.onCopy(props.rawKey, "key")}
                  title="复制 CLI Key"
                >
                  {props.copied === "key" ? <Check size={15} /> : <Clipboard size={15} />}
                  <span>{props.copied === "key" ? "已复制" : "复制 Key"}</span>
                </button>
              </div>
            )}
            <div className="token-device-grid" aria-label="绑定设备">
              {props.devices.slice(0, 3).map((device) => (
                <div key={device.device_id} className="token-device-item">
                  <strong>{device.hostname || "本机设备"}</strong>
                  <span>
                    {formatNumber(device.total_tokens)} · {device.last_seen_at ? formatDate(device.last_seen_at) : "等待同步"}
                  </span>
                </div>
              ))}
              {!props.devices.length && (
                <div className="token-device-item token-device-empty">
                  <strong>绑定设备</strong>
                  <span>CLI 同步后显示设备</span>
                </div>
              )}
            </div>
          </div>

          <div className="token-guide-section">
            <h3>📦 第一步：安装并初始化</h3>
            <p>首先安装 CLI 工具，然后运行初始化命令绑定你的 CLI Key</p>
            <div className="token-command-list">
              <CommandLine value={props.installCommand} label="install" copied={props.copied} onCopy={props.onCopy} />
              <CommandLine value={props.initCommand} label="init" copied={props.copied} onCopy={props.onCopy} />
            </div>
          </div>

          <div className="token-guide-section">
            <h3>🔄 第二步：选择同步方式</h3>
            <div className="token-sync-options">
              <div className="token-sync-option highlighted">
                <div className="token-sync-option-header">
                  <strong>⚡️ 自动同步（推荐）</strong>
                  <span className="token-sync-badge recommended">推荐</span>
                </div>
                <p>注册为系统服务，开机自启，自动上传数据。支持自定义同步间隔。</p>
                <div className="token-command-list">
                  <CommandLine value={props.autoSyncCommand} label="auto-sync-5" copied={props.copied} onCopy={props.onCopy} />
                  <CommandLine value={`${props.autoSyncCommand} by 10`} label="auto-sync-10" copied={props.copied} onCopy={props.onCopy} />
                  <CommandLine value={`${props.autoSyncCommand} by 60`} label="auto-sync-60" copied={props.copied} onCopy={props.onCopy} />
                </div>
                <p className="token-guide-note">💡 默认每 5 分钟同步，可使用 <code>by N</code> 自定义间隔（单位：分钟）</p>
              </div>

              <div className="token-sync-option">
                <div className="token-sync-option-header">
                  <strong>🖐 手动同步</strong>
                </div>
                <p>需要时手动运行命令上传数据</p>
                <CommandLine value={props.manualSyncCommand} label="manual-sync" copied={props.copied} onCopy={props.onCopy} />
              </div>
            </div>
          </div>

          <div className="token-guide-section">
            <h3>🗑️ 卸载</h3>
            <p>如需卸载 CLI 工具，运行以下命令</p>
            <div className="token-command-list">
              <CommandLine value={props.uninstallCommand} label="uninstall" copied={props.copied} onCopy={props.onCopy} />
            </div>
          </div>

          <div className="token-guide-section">
            <h3>📚 更多帮助</h3>
            <p>查看所有可用命令：<code>forever-token help</code></p>
            <p>查看服务管理命令：<code>forever-token service</code></p>
          </div>
        </div>
      </article>
    </section>
  );
}

function RankCard(props: { title: string; items: { key: string; label: string; total_tokens: number }[] }) {
  const max = Math.max(1, ...props.items.map((item) => item.total_tokens));
  return (
    <article className="token-card">
      <div className="token-card-head"><BarChart3 size={18} /><div><strong>{props.title}</strong><small>按 Token 总量排序</small></div></div>
      <div className="token-rank-list">
        {props.items.map((item) => <div key={item.key}><span><strong>{item.label}</strong><small>{formatNumber(item.total_tokens)}</small></span><i style={{ width: `${Math.max(6, (item.total_tokens / max) * 100)}%` }} /></div>)}
        {!props.items.length && <p className="token-empty-line" role="status" aria-live="polite">暂无数据</p>}
      </div>
    </article>
  );
}

function trendModeLabel(value: TrendMode) {
  return ({ day: "按日", week: "按周", month: "按月", custom: "自定义" })[value];
}

function trendRangeLabel(mode: TrendMode, customStart: string, customEnd: string) {
  if (mode === "day") return "今日";
  if (mode === "week") return "最近 7 天";
  if (mode === "month") return "最近 30 天";
  return `${customStart || "开始日期"} 至 ${customEnd || "结束日期"}`;
}

function rangeFromTrendMode(mode: TrendMode, customStart: string, customEnd: string): TokenUsageRangeQuery | null {
  if (mode === "day") return "1d";
  if (mode === "week") return "7d";
  if (mode === "month") return "30d";
  const start = parseDateInput(customStart);
  const end = parseDateInput(customEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end || end > addMonths(start, 6)) return null;
  return `custom:${customStart}:${customEnd}`;
}

function buildTrendData(dashboard: TokenUsageDashboard, mode: TrendMode, customStart: string, customEnd: string): TrendData {
  if (mode === "day") return buildHourlyTrend(dashboard.heatmap);
  const end = mode === "custom" ? parseDateInput(customEnd) : startOfLocalDay(new Date());
  const start = mode === "week" ? addDays(end, -6) : mode === "month" ? addDays(end, -29) : parseDateInput(customStart);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { bars: [], error: "请选择有效的开始和结束日期。" };
  if (start > end) return { bars: [], error: "开始日期不能晚于结束日期。" };
  if (mode === "custom" && end > addMonths(start, 6)) return { bars: [], error: "自定义范围最多 6 个月。" };
  return { bars: buildDailyTrend(dashboard.token_trend, start, end), error: "" };
}

function buildHourlyTrend(cells: TokenUsageDashboard["heatmap"]): TrendData {
  const today = isoDate(new Date());
  const byHour = new Map<number, { total_tokens: number; active_seconds: number }>();
  for (const cell of cells) {
    if (cell.day !== today) continue;
    const current = byHour.get(cell.hour) ?? { total_tokens: 0, active_seconds: 0 };
    current.total_tokens += cell.total_tokens;
    current.active_seconds += cell.active_seconds;
    byHour.set(cell.hour, current);
  }
  return {
    error: "",
    bars: Array.from({ length: 24 }, (_, hour) => {
      const value = byHour.get(hour) ?? { total_tokens: 0, active_seconds: 0 };
      return { key: `${hour}`, label: hour % 6 === 0 ? `${hour}:00` : "", title: `${today} ${String(hour).padStart(2, "0")}:00`, ...value };
    }),
  };
}

function buildDailyTrend(points: TokenUsageDashboard["token_trend"], start: Date, end: Date): TrendBar[] {
  const byDay = new Map(points.map((point) => [point.date, point]));
  const bars: TrendBar[] = [];
  for (let cursor = startOfLocalDay(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const key = isoDate(cursor);
    const point = byDay.get(key);
    bars.push({
      key,
      label: trendDayLabel(cursor, daysBetween(start, end) + 1),
      title: key,
      total_tokens: point?.total_tokens ?? 0,
      active_seconds: point?.active_seconds ?? 0,
    });
  }
  return bars;
}

function trendDayLabel(date: Date, totalDays: number) {
  const day = date.getDate();
  if (totalDays <= 10) return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
  if (totalDays <= 31) return day === 1 || day % 5 === 0 ? `${day}` : "";
  return day === 1 ? new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(date) : "";
}

function parseDateInput(value: string) {
  const [year, month, day] = value.split("-").map((item) => Number(item));
  if (!year || !month || !day) return new Date(Number.NaN);
  return new Date(year, month - 1, day);
}

function daysBetween(start: Date, end: Date) {
  return Math.round((startOfLocalDay(end).getTime() - startOfLocalDay(start).getTime()) / 86400000);
}

function buildContributionHeatmap(cells: TokenUsageDashboard["heatmap"]): ContributionHeatmap {
  const byDay = new Map<string, { total_tokens: number; active_seconds: number }>();
  for (const cell of cells) {
    const current = byDay.get(cell.day) ?? { total_tokens: 0, active_seconds: 0 };
    current.total_tokens += cell.total_tokens;
    current.active_seconds += cell.active_seconds;
    byDay.set(cell.day, current);
  }

  const end = endOfLocalDay(new Date());
  const rangeStart = startOfLocalDay(addDays(end, -364));
  const calendarStart = startOfWeek(rangeStart);
  const weeks: ContributionWeek[] = [];
  const monthLabels: ContributionHeatmap["monthLabels"] = [];
  let peak = 1;

  for (let cursor = new Date(calendarStart), column = 1; cursor <= end; column += 1) {
    const weekStart = new Date(cursor);
    const days: ContributionDay[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = addDays(weekStart, weekday);
      const day = isoDate(date);
      const usage = byDay.get(day) ?? { total_tokens: 0, active_seconds: 0 };
      const inRange = date >= rangeStart && date <= end;
      if (inRange) peak = Math.max(peak, usage.total_tokens);
      days.push({ day, date, total_tokens: inRange ? usage.total_tokens : 0, active_seconds: inRange ? usage.active_seconds : 0, inRange });
    }
    const firstVisibleDay = days.find((day) => day.inRange);
    if (firstVisibleDay && firstVisibleDay.date.getDate() <= 7) {
      monthLabels.push({ key: `${firstVisibleDay.date.getFullYear()}-${firstVisibleDay.date.getMonth()}`, label: monthLabel(firstVisibleDay.date), column });
    }
    weeks.push({ key: isoDate(weekStart), days });
    cursor = addDays(weekStart, 7);
  }

  return { weeks, monthLabels, peak };
}

function contributionLevel(value: number, peak: number) {
  if (value <= 0) return 0;
  const ratio = value / Math.max(1, peak);
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.45) return 3;
  if (ratio >= 0.18) return 2;
  return 1;
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(date);
}

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function startOfWeek(date: Date) {
  const next = startOfLocalDay(date);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function formatNumber(value: number) {
  return formatTokens(value);
}

function formatTokens(value: number) {
  const tokens = Number.isFinite(value) ? value : 0;
  const absoluteTokens = Math.abs(tokens);
  const unit = absoluteTokens >= 1_000_000_000 ? { divisor: 1_000_000_000, suffix: "B" } : { divisor: 1_000_000, suffix: "M" };
  const valueInUnit = tokens / unit.divisor;
  const digits = Math.abs(valueInUnit) >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(valueInUnit)}${unit.suffix} Tokens`;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
  return `${(seconds / 3600).toFixed(1)} 小时`;
}

function formatDate(value: string) {
  const date = parseServerDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)} GMT+8`;
}

function parseServerDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return new Date(Number.NaN);
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)) return new Date(trimmed);
  return new Date(`${trimmed}Z`);
}
