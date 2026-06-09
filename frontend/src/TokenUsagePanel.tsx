import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BarChart3, Check, Clipboard, Clock3, Eye, EyeOff, Flame, KeyRound, Medal, Package, Pencil, RefreshCw, TerminalSquare, Trophy, XCircle, Zap } from "lucide-react";
import { createPortal } from "react-dom";

import { createTokenUsageKey, fetchTokenUsageDashboard, fetchTokenUsageKeys, fetchTokenUsageLeaderboard, getApiBaseUrl, revealTokenUsageKey, updateTokenUsageKey } from "./services/api";
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

type RefreshOverlayState = "hidden" | "loading" | "done" | "error";

type ContributionDay = {
  day: string;
  date: Date;
  total_tokens: number;
  active_seconds: number;
  key_breakdown: ContributionKeyBreakdown[];
  inRange: boolean;
};

type ContributionKeyBreakdown = {
  key_id: string;
  key_name: string;
  total_tokens: number;
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

const tokenUsageDisplayTimeZone = "Asia/Shanghai";
const tokenUsageVisitedStorageKey = "token-usage-guide-opened";
const tokenUsageHeatmapHighThreshold = 100_000_000;
const tokenUsageHeatmapPeakThreshold = 200_000_000;

type KeyDialogMode = "create" | "rename";

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

function getInitialTokenUsageView(): TokenUsageView {
  try {
    return localStorage.getItem(tokenUsageVisitedStorageKey) ? "dashboard" : "guide";
  } catch {
    return "guide";
  }
}

export default function TokenUsagePanel(props: { authToken: string; currentUser: AuthUser | null }) {
  const [view, setView] = useState<TokenUsageView>(() => getInitialTokenUsageView());
  const [trendMode, setTrendMode] = useState<TrendMode>("month");
  const [customPanelOpen, setCustomPanelOpen] = useState(false);
  const [customStart, setCustomStart] = useState(() => isoDate(addDays(displayCalendarDate(new Date()), -29)));
  const [customEnd, setCustomEnd] = useState(() => displayIsoDate(new Date()));
  const [dashboard, setDashboard] = useState<TokenUsageDashboard>(emptyDashboard);
  const [allTimeDashboard, setAllTimeDashboard] = useState<TokenUsageDashboard>(emptyDashboard);
  const [leaderboard, setLeaderboard] = useState<TokenUsageLeaderboard>({ entries: [] });
  const [keys, setKeys] = useState<TokenUsageApiKey[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<Record<string, string | null>>({});
  const [keyDialog, setKeyDialog] = useState<{ mode: KeyDialogMode; key?: TokenUsageApiKey; name: string } | null>(null);
  const [deleteKeyDialog, setDeleteKeyDialog] = useState<TokenUsageApiKey | null>(null);
  const [copied, setCopied] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tooltip, setTooltip] = useState<TooltipData>(null);
  const [refreshOverlay, setRefreshOverlay] = useState<RefreshOverlayState>("hidden");
  const trendControlsRef = useRef<HTMLDivElement | null>(null);
  const refreshOverlayTimerRef = useRef<number | null>(null);
  const refreshOverlayStartedAtRef = useRef(0);
  const apiBaseUrl = getApiBaseUrl();
  const installCommand = "npm install -g @anglyaoy/token-usage";
  const initCommand = "forever-token init";
  const localInitCommand = "forever-token init local";
  const manualSyncCommand = "forever-token sync";
  const autoSyncCommand = "forever-token service setup";
  const uninstallCommand = "npm uninstall -g @anglyaoy/token-usage";

  useEffect(() => {
    if (!props.authToken) {
      setDashboard(emptyDashboard);
      setAllTimeDashboard(emptyDashboard);
      setLeaderboard({ entries: [] });
      setKeys([]);
      setVisibleKeys({});
      setKeyDialog(null);
      setDeleteKeyDialog(null);
      setCopied("");
      setLoading(false);
      return;
    }
    void refresh();
  }, [props.authToken, trendMode, customStart, customEnd]);

  useEffect(() => () => clearRefreshOverlayTimer(), []);

  useEffect(() => {
    if (!props.authToken || !props.currentUser) return;
    try {
      if (!localStorage.getItem(tokenUsageVisitedStorageKey)) {
        localStorage.setItem(tokenUsageVisitedStorageKey, "true");
      }
    } catch {
      // Ignore storage failures; the first-visit guide still renders for this session.
    }
  }, [props.authToken, props.currentUser]);

  useEffect(() => {
    if (trendMode !== "custom" || !customPanelOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (trendControlsRef.current?.contains(target)) return;
      setCustomPanelOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [trendMode, customPanelOpen]);

  function clearRefreshOverlayTimer() {
    if (refreshOverlayTimerRef.current === null) return;
    window.clearTimeout(refreshOverlayTimerRef.current);
    refreshOverlayTimerRef.current = null;
  }

  function startRefreshOverlay() {
    clearRefreshOverlayTimer();
    setTooltip(null);
    refreshOverlayStartedAtRef.current = window.performance.now();
    setRefreshOverlay("loading");
  }

  function finishRefreshOverlay(state: Exclude<RefreshOverlayState, "hidden" | "loading">) {
    const elapsed = window.performance.now() - refreshOverlayStartedAtRef.current;
    const settleDelay = Math.max(0, 650 - elapsed);
    refreshOverlayTimerRef.current = window.setTimeout(() => {
      setRefreshOverlay(state);
      refreshOverlayTimerRef.current = window.setTimeout(() => {
        setRefreshOverlay("hidden");
        refreshOverlayTimerRef.current = null;
      }, 820);
    }, settleDelay);
  }

  async function refresh(options: { showOverlay?: boolean } = {}) {
    const showOverlay = options.showOverlay === true;
    if (showOverlay) startRefreshOverlay();
    setLoading(true);
    setError("");
    let refreshed = false;
    try {
      const queryRange = rangeFromTrendMode(trendMode, customStart, customEnd);
      if (queryRange === null) {
        setError("请选择有效的自定义日期范围。");
        return;
      }
      const [nextDashboard, nextAllTimeDashboard, nextLeaderboard, nextKeys] = await Promise.all([
        fetchTokenUsageDashboard(props.authToken, queryRange),
        fetchTokenUsageDashboard(props.authToken, "all"),
        fetchTokenUsageLeaderboard(props.authToken, "all"),
        fetchTokenUsageKeys(props.authToken),
      ]);
      setDashboard(nextDashboard);
      setAllTimeDashboard(nextAllTimeDashboard);
      setLeaderboard(nextLeaderboard);
      setKeys(nextKeys);
      refreshed = true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Token 统计加载失败");
    } finally {
      setLoading(false);
      if (showOverlay) finishRefreshOverlay(refreshed ? "done" : "error");
    }
  }

  async function createKey(name: string) {
    if (!props.authToken) return;
    setLoading(true);
    setError("");
    try {
      const result = await createTokenUsageKey(props.authToken, name.trim() || defaultKeyName(props.currentUser));
      setKeys((current) => [result.key, ...current]);
      setVisibleKeys((current) => ({ ...current, [result.key.id]: result.raw_key }));
      setKeyDialog(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CLI Key 创建失败");
    } finally {
      setLoading(false);
    }
  }

  async function renameKey(key: TokenUsageApiKey, name: string) {
    if (!props.authToken) return;
    setLoading(true);
    setError("");
    try {
      const updated = await updateTokenUsageKey(props.authToken, key.id, { name: name.trim() });
      setKeys((current) => current.map((item) => item.id === updated.id ? updated : item));
      setKeyDialog(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CLI Key 修改失败");
    } finally {
      setLoading(false);
    }
  }

  async function disableKey(key: TokenUsageApiKey) {
    if (!props.authToken) return;
    setLoading(true);
    setError("");
    try {
      await updateTokenUsageKey(props.authToken, key.id, { status: "disabled" });
      setKeys((current) => current.filter((item) => item.id !== key.id));
      setVisibleKeys((current) => {
        const next = { ...current };
        delete next[key.id];
        return next;
      });
      setDeleteKeyDialog(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CLI Key 删除失败");
    } finally {
      setLoading(false);
    }
  }

  async function toggleKeyVisibility(key: TokenUsageApiKey) {
    if (Object.prototype.hasOwnProperty.call(visibleKeys, key.id)) {
      setVisibleKeys((current) => {
        const next = { ...current };
        delete next[key.id];
        return next;
      });
      return;
    }
    if (!props.authToken) return;
    setLoading(true);
    setError("");
    try {
      const result = await revealTokenUsageKey(props.authToken, key.id);
      setVisibleKeys((current) => ({ ...current, [key.id]: result.raw_key ?? null }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CLI Key 读取失败");
    } finally {
      setLoading(false);
    }
  }

  function openCreateKeyDialog() {
    setKeyDialog({ mode: "create", name: defaultKeyName(props.currentUser) });
  }

  function openRenameKeyDialog(key: TokenUsageApiKey) {
    setKeyDialog({ mode: "rename", key, name: key.name });
  }

  function openDeleteKeyDialog(key: TokenUsageApiKey) {
    setDeleteKeyDialog(key);
  }

  function submitKeyDialog() {
    if (!keyDialog) return;
    const name = keyDialog.name.trim();
    if (!name) {
      setError("请输入 Key 名称。");
      return;
    }
    if (keyDialog.mode === "create") {
      void createKey(name);
    } else if (keyDialog.key) {
      void renameKey(keyDialog.key, name);
    }
  }

  function selectTrendMode(mode: TrendMode) {
    setTrendMode(mode);
    setCustomPanelOpen((open) => mode === "custom" ? !open : false);
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
    const tooltipWidth = 280;
    const tooltipHeight = 118;

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
          <button className={`secondary-button compact token-refresh-button ${refreshOverlay === "loading" ? "refreshing" : ""}`} type="button" disabled={loading} onClick={() => void refresh({ showOverlay: true })}><RefreshCw size={15} /><span>{refreshOverlay === "loading" ? "刷新中" : "刷新"}</span></button>
        </div>
      </div>

      <div className="token-section-tabs" role="tablist" aria-label="Token统计视图">
        <button type="button" role="tab" aria-selected={view === "dashboard"} className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}><Activity size={15} /><span>仪表盘</span></button>
        <button type="button" role="tab" aria-selected={view === "leaderboard"} className={view === "leaderboard" ? "active" : ""} onClick={() => setView("leaderboard")}><Trophy size={15} /><span>排行榜</span></button>
        <button type="button" role="tab" aria-selected={view === "guide"} className={view === "guide" ? "active" : ""} onClick={() => setView("guide")}><TerminalSquare size={15} /><span>开始更了解自己！</span></button>
      </div>

      {error && <p className="react-error-line" role="alert">{error}</p>}

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
                        <TooltipKeyBreakdown items={day.key_breakdown} />
                      </>)}
                      onMouseLeave={hideTooltip}
                    />)}
                  </div>)}
                </div>
              </div>
              <div className="token-contribution-legend" aria-hidden="true"><span>少</span><i className="level-0" /><i className="level-2" /><i className="level-4" /><i className="level-6" /><i className="level-8" /><span>多</span></div>
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
            <div className="token-trend-controls-shell" ref={trendControlsRef}>
              <div className="token-trend-controls" role="group" aria-label="趋势统计方式">
                {(["day", "week", "month", "custom"] as TrendMode[]).map((mode) => <button key={mode} type="button" className={trendMode === mode ? "active" : ""} aria-pressed={trendMode === mode} onClick={() => selectTrendMode(mode)}>{trendModeLabel(mode)}</button>)}
              </div>
              {trendMode === "custom" && customPanelOpen && <div className="token-trend-custom" aria-label="自定义趋势范围">
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
              style={{ height: `${point.total_tokens > 0 ? Math.max(8, (point.total_tokens / trendMax) * 100) : 0}%` }}
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
          <div className="token-card-head"><Trophy size={18} /><div><strong>账户排行榜</strong><small>全部时期（近 6 个月）按 Token 总量排序</small></div></div>
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
        localInitCommand={localInitCommand}
        manualSyncCommand={manualSyncCommand}
        autoSyncCommand={autoSyncCommand}
        uninstallCommand={uninstallCommand}
        copied={copied}
        onCopy={copyText}
        keys={keys}
        visibleKeys={visibleKeys}
        loading={loading}
        onCreateKey={openCreateKeyDialog}
        onRevealKey={toggleKeyVisibility}
        onRenameKey={openRenameKeyDialog}
        onDisableKey={openDeleteKeyDialog}
        devices={dashboard.devices}
      />}

      {deleteKeyDialog && createPortal(
        <KeyDeleteDialog
          apiKey={deleteKeyDialog}
          loading={loading}
          onCancel={() => setDeleteKeyDialog(null)}
          onConfirm={() => void disableKey(deleteKeyDialog)}
        />,
        document.body
      )}

      {keyDialog && createPortal(
        <KeyDialog
          dialog={keyDialog}
          loading={loading}
          onNameChange={(name) => setKeyDialog((current) => current ? { ...current, name } : current)}
          onCancel={() => setKeyDialog(null)}
          onSubmit={submitKeyDialog}
        />,
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

      {refreshOverlay !== "hidden" && createPortal(
        <div className={`token-refresh-overlay ${refreshOverlay}`} role="status" aria-live="polite" aria-label={refreshOverlay === "loading" ? "正在刷新 Token 统计" : refreshOverlay === "error" ? "Token 统计刷新失败" : "Token 统计刷新完成"}>
          <div className="token-refresh-card">
            <span className="token-refresh-orbit" aria-hidden="true">
              {refreshOverlay === "loading" ? <RefreshCw size={24} /> : refreshOverlay === "error" ? <XCircle size={24} /> : <Check size={24} />}
            </span>
            <strong>{refreshOverlay === "loading" ? "正在刷新 Token 统计" : refreshOverlay === "error" ? "刷新失败" : "刷新完成"}</strong>
            <small>{refreshOverlay === "loading" ? "正在同步仪表盘、排行榜和热力图数据" : refreshOverlay === "error" ? "数据没有更新，请稍后再试" : "最新数据已经写入面板"}</small>
          </div>
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

function TooltipKeyBreakdown(props: { items: ContributionKeyBreakdown[] }) {
  if (!props.items.length) return null;
  return (
    <div className="token-tooltip-breakdown">
      {props.items.map((item) => (
        <small key={item.key_id}>
          {item.key_name}：消耗 {formatTokens(item.total_tokens)}
        </small>
      ))}
    </div>
  );
}

function KeyDialog(props: {
  dialog: { mode: KeyDialogMode; key?: TokenUsageApiKey; name: string };
  loading: boolean;
  onNameChange: (name: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const title = props.dialog.mode === "create" ? "生成 CLI Key" : "修改 Key 名称";
  return (
    <div className="token-dialog-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && props.onCancel()}>
      <div className="token-dialog-box" role="dialog" aria-modal="true" aria-labelledby="token-key-dialog-title">
        <div className="token-dialog-head">
          <div>
            <strong id="token-key-dialog-title">{title}</strong>
            <small>Key 名称会用于区分不同设备和热力图明细。</small>
          </div>
          <button className="token-icon-button" type="button" onClick={props.onCancel} aria-label="关闭">
            <XCircle size={17} />
          </button>
        </div>
        <label className="token-dialog-field">
          <span>Key 名称</span>
          <input
            autoFocus
            type="text"
            value={props.dialog.name}
            maxLength={120}
            placeholder="例如：家里 Mac、公司主机"
            onChange={(event) => props.onNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onSubmit();
              if (event.key === "Escape") props.onCancel();
            }}
          />
        </label>
        <div className="token-dialog-actions">
          <button className="secondary-button compact" type="button" onClick={props.onCancel}>取消</button>
          <button className="primary-action compact" type="button" disabled={props.loading || !props.dialog.name.trim()} onClick={props.onSubmit}>
            <Check size={15} />
            <span>确认</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyDeleteDialog(props: {
  apiKey: TokenUsageApiKey;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="token-dialog-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !props.loading && props.onCancel()}>
      <div
        className="token-dialog-box danger"
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-key-delete-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !props.loading) props.onCancel();
        }}
      >
        <div className="token-dialog-head">
          <div>
            <strong id="token-key-delete-title">删除 CLI Key</strong>
            <small>这会同时删除该 Key 上传过的 Token bucket 和 session 数据。</small>
          </div>
          <button className="token-icon-button danger" type="button" onClick={props.onCancel} disabled={props.loading} aria-label="关闭">
            <XCircle size={17} />
          </button>
        </div>
        <div className="token-dialog-warning">
          <strong>{props.apiKey.name}</strong>
          <span>{props.apiKey.prefix}... 上传过的统计数据会从仪表盘、排行榜和热力图里移除。</span>
        </div>
        <div className="token-dialog-actions">
          <button className="secondary-button compact" type="button" onClick={props.onCancel} disabled={props.loading}>取消</button>
          <button className="secondary-button danger compact" type="button" disabled={props.loading} onClick={props.onConfirm}>
            <XCircle size={15} />
            <span>{props.loading ? "删除中" : "确认删除"}</span>
          </button>
        </div>
      </div>
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
  localInitCommand: string;
  manualSyncCommand: string;
  autoSyncCommand: string;
  uninstallCommand: string;
  copied: string;
  onCopy: (value: string, label: string) => void;
  keys: TokenUsageApiKey[];
  visibleKeys: Record<string, string | null>;
  loading: boolean;
  onCreateKey: () => void;
  onRevealKey: (key: TokenUsageApiKey) => void;
  onRenameKey: (key: TokenUsageApiKey) => void;
  onDisableKey: (key: TokenUsageApiKey) => void;
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
            <p>每台设备生成一个独立 CLI Key，所有设备都会统计到当前账户。</p>
            <div className="token-key-actions">
              <button className="primary-action compact" type="button" disabled={props.loading} onClick={props.onCreateKey}>
                <KeyRound size={15} />
                <span>生成 CLI Key</span>
              </button>
            </div>
            <div className="token-key-list" aria-label="CLI Key 列表">
              {props.keys.map((key) => (
                <div key={key.id} className={`token-key-item ${key.status !== "active" ? "disabled" : ""}`}>
                  <div className="token-key-main">
                    <strong>{key.name}</strong>
                    <span>{key.prefix}... · {key.status === "active" ? "启用中" : "不可用"} · {key.last_used_at ? `上次同步 ${formatDate(key.last_used_at)}` : "等待同步"}</span>
                  </div>
                  {Object.prototype.hasOwnProperty.call(props.visibleKeys, key.id) && (
                    <div className="token-secret-reveal">
                      <p className="token-secret-value">{props.visibleKeys[key.id] || "旧 Key 无法显示完整值，请重新生成。"}</p>
                      {props.visibleKeys[key.id] && (
                        <button
                          className="secondary-button compact"
                          type="button"
                          onClick={() => props.onCopy(props.visibleKeys[key.id] || "", `key-${key.id}`)}
                          title="复制 CLI Key"
                        >
                          {props.copied === `key-${key.id}` ? <Check size={15} /> : <Clipboard size={15} />}
                          <span>{props.copied === `key-${key.id}` ? "已复制" : "复制"}</span>
                        </button>
                      )}
                    </div>
                  )}
                  <div className="token-key-row-actions">
                    <button className="token-icon-button" type="button" onClick={() => props.onRevealKey(key)} title={Object.prototype.hasOwnProperty.call(props.visibleKeys, key.id) ? "隐藏 Key" : "显示 Key"} aria-label={Object.prototype.hasOwnProperty.call(props.visibleKeys, key.id) ? "隐藏 Key" : "显示 Key"}>
                      {Object.prototype.hasOwnProperty.call(props.visibleKeys, key.id) ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                    {props.visibleKeys[key.id] && (
                      <button className="token-icon-button" type="button" onClick={() => props.onCopy(props.visibleKeys[key.id] || "", `key-${key.id}`)} title="复制 Key" aria-label="复制 Key">
                        {props.copied === `key-${key.id}` ? <Check size={16} /> : <Clipboard size={16} />}
                      </button>
                    )}
                    <button className="token-icon-button" type="button" onClick={() => props.onRenameKey(key)} title="修改名称" aria-label="修改名称">
                      <Pencil size={16} />
                    </button>
                    {key.status === "active" && (
                      <button className="token-icon-button danger" type="button" onClick={() => props.onDisableKey(key)} title="删除 Key 和数据" aria-label="删除 Key 和数据">
                        <XCircle size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {!props.keys.length && (
                <div className="token-key-item token-key-empty">
                  <strong>暂无 CLI Key</strong>
                  <span>先为当前设备生成一个 Key。</span>
                </div>
              )}
            </div>
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
            <p>首先安装 CLI 工具，然后运行初始化命令绑定你的 CLI Key。默认连接线上 4Ever，初始化成功后会自动同步一次。</p>
            <div className="token-command-list">
              <CommandLine value={props.installCommand} label="install" copied={props.copied} onCopy={props.onCopy} />
              <CommandLine value={props.initCommand} label="init" copied={props.copied} onCopy={props.onCopy} />
              <CommandLine value={props.localInitCommand} label="init-local" copied={props.copied} onCopy={props.onCopy} />
            </div>
            <p className="token-guide-note">本地开发时使用 <code>forever-token init local</code>，会连接 <code>http://127.0.0.1:7778</code>。</p>
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

function defaultKeyName(user: AuthUser | null) {
  return `${user?.display_name || user?.username || "4Ever"} CLI`;
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
  const end = mode === "custom" ? parseDateInput(customEnd) : displayCalendarDate(new Date());
  const start = mode === "week" ? addDays(end, -6) : mode === "month" ? addDays(end, -29) : parseDateInput(customStart);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { bars: [], error: "请选择有效的开始和结束日期。" };
  if (start > end) return { bars: [], error: "开始日期不能晚于结束日期。" };
  if (mode === "custom" && end > addMonths(start, 6)) return { bars: [], error: "自定义范围最多 6 个月。" };
  return { bars: buildDailyTrend(dashboard.token_trend, start, end), error: "" };
}

function buildHourlyTrend(cells: TokenUsageDashboard["heatmap"]): TrendData {
  const today = displayIsoDate(new Date());
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
  const byDay = new Map<string, { total_tokens: number; active_seconds: number; key_breakdown: Map<string, ContributionKeyBreakdown> }>();
  for (const cell of cells) {
    const current = byDay.get(cell.day) ?? { total_tokens: 0, active_seconds: 0, key_breakdown: new Map<string, ContributionKeyBreakdown>() };
    current.total_tokens += cell.total_tokens;
    current.active_seconds += cell.active_seconds;
    for (const item of cell.key_breakdown ?? []) {
      const existing = current.key_breakdown.get(item.key_id) ?? { key_id: item.key_id, key_name: item.key_name, total_tokens: 0 };
      existing.key_name = item.key_name;
      existing.total_tokens += item.total_tokens;
      current.key_breakdown.set(item.key_id, existing);
    }
    byDay.set(cell.day, current);
  }

  const end = endOfLocalDay(displayCalendarDate(new Date()));
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
      const usage = byDay.get(day) ?? { total_tokens: 0, active_seconds: 0, key_breakdown: new Map<string, ContributionKeyBreakdown>() };
      const inRange = date >= rangeStart && date <= end;
      if (inRange) peak = Math.max(peak, usage.total_tokens);
      days.push({
        day,
        date,
        total_tokens: inRange ? usage.total_tokens : 0,
        active_seconds: inRange ? usage.active_seconds : 0,
        key_breakdown: inRange ? Array.from(usage.key_breakdown.values()).sort((first, second) => second.total_tokens - first.total_tokens || first.key_name.localeCompare(second.key_name, "zh-CN")) : [],
        inRange,
      });
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
  let level = 1;
  if (ratio >= 0.875) level = 8;
  else if (ratio >= 0.75) level = 7;
  else if (ratio >= 0.625) level = 6;
  else if (ratio >= 0.5) level = 5;
  else if (ratio >= 0.375) level = 4;
  else if (ratio >= 0.25) level = 3;
  else if (ratio >= 0.125) level = 2;

  if (value >= tokenUsageHeatmapPeakThreshold) return Math.max(level, 8);
  if (value >= tokenUsageHeatmapHighThreshold) return Math.max(level, 7);
  return level;
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

function displayIsoDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tokenUsageDisplayTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function displayCalendarDate(date: Date) {
  return parseDateInput(displayIsoDate(date));
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
    timeZone: tokenUsageDisplayTimeZone,
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
