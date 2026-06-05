import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ChevronDown,
  CheckCircle2,
  Combine,
  Image,
  KeyRound,
  Layers3,
  Leaf,
  Lightbulb,
  LogOut,
  Map,
  MessageSquareText,
  Moon,
  NotebookPen,
  Pencil,
  PlugZap,
  RefreshCw,
  Save,
  Search,
  Shield,
  Shuffle,
  Sparkles,
  Sprout,
  Star,
  Gauge,
  Sun,
  Languages,
  ThermometerSun,
  Trash2,
  UserRound,
  UserPlus,
  Wand2,
  Workflow,
  X,
} from "lucide-react";

import { fetchCurrentUser, fetchModules, resolveMediaUrl, signIn, signUp } from "./services/api";
import AdminPanel from "./AdminPanel";
import ChatPanel from "./ChatPanel";
import ImageGenerationPanel from "./ImageGenerationPanel";
import InspirationCanvasPanel from "./InspirationCanvasPanel";
import MemoryMapPanel from "./MemoryMapPanel";
import ModelHubPanel from "./ModelHubPanel";
import NotesPanel from "./NotesPanel";
import ProfilePanel from "./ProfilePanel";
import TokenUsagePanel from "./TokenUsagePanel";
import WorkflowPanel from "./WorkflowPanel";
import type { AuthUser } from "./types/auth";
import type { PlatformModule } from "./types/platform";

type RouteId = "home" | "sign-in" | "sign-up" | "insight" | "profile" | "chat" | "image" | "aggregation" | "notes" | "map" | "automation" | "token-usage" | "inspiration" | "admin";
type ModuleId = "dashboard" | "profile" | "chat" | "image-generation" | "provider-hub" | "notes" | "memory-map" | "workflow" | "token-usage" | "inspiration" | "admin";
type UiLanguage = "zh" | "en";
type LandingMaskState = {
  targetX: number;
  targetY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  opacity: number;
  targetOpacity: number;
  radius: number;
  lastTimestamp: number;
  frame: number;
  hasPosition: boolean;
};

const authTokenKey = "4ever.auth.token";
const authUserKey = "4ever.auth.user";
const colorModeKey = "4ever.ui.colorMode";
const colorTemperatureKey = "4ever.ui.colorTemperature";
const languageKey = "4ever.ui.language";
const introSeenKey = "4ever.ui.introSeen";
const landingMaskHiddenPosition = -999;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const moduleRoutes: Record<ModuleId, RouteId> = {
  dashboard: "insight",
  profile: "profile",
  chat: "chat",
  "image-generation": "image",
  "provider-hub": "aggregation",
  notes: "notes",
  "memory-map": "map",
  workflow: "automation",
  "token-usage": "token-usage",
  inspiration: "inspiration",
  admin: "admin",
};

const routeModules = Object.fromEntries(Object.entries(moduleRoutes).map(([moduleId, route]) => [route, moduleId])) as Record<RouteId, ModuleId>;

const fallbackModules: PlatformModule[] = [
  { id: "chat", name: "交耳", description: "AI 与联系人会话。", category: "ai", enabled: true },
  { id: "profile", name: "个人中心", description: "管理头像、签名、所在地和绑定平台。", category: "system", enabled: true },
  { id: "provider-hub", name: "中枢", description: "统一维护全局模型 API 与当前配置。", category: "integration", enabled: true },
  { id: "notes", name: "笔记", description: "Markdown 写作、实时预览和导出。", category: "productivity", enabled: true },
  { id: "memory-map", name: "地图纪念", description: "保存城市记忆。", category: "memory", enabled: true },
  { id: "workflow", name: "秩序", description: "面向用户开放 Agent、MCP 和工作流编排。", category: "automation", enabled: true },
  { id: "token-usage", name: "Token统计", description: "统计本机 AI Token 用量和活跃度。", category: "analytics", enabled: true },
  { id: "inspiration", name: "灵感", description: "可视化 AI 工作流编排，拖拽节点组合接口。", category: "creativity", enabled: true },
  { id: "image-generation", name: "虚实", description: "图像生成实验台。", category: "ai", enabled: true },
  { id: "admin", name: "管理员端", description: "管理用户、模块和运营状态。", category: "admin", enabled: true },
];

function App() {
  const [routeId, setRouteId] = useState<RouteId>(() => routeFromLocation());
  const [authToken, setAuthToken] = useState(() => readLocalStorage(authTokenKey) ?? "");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => loadStoredUser());
  const [modules, setModules] = useState<PlatformModule[]>(fallbackModules);
  const [moduleCatalogFallback, setModuleCatalogFallback] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [colorMode, setColorMode] = useState<"light" | "dark">(() => (readLocalStorage(colorModeKey) === "dark" ? "dark" : "light"));
  const [colorTemperature, setColorTemperature] = useState(() => loadColorTemperature());
  const [language, setLanguage] = useState<UiLanguage>(() => (readLocalStorage(languageKey) === "en" ? "en" : "zh"));
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [introVisible, setIntroVisible] = useState(() => readSessionStorage(introSeenKey) !== "true");
  const [introLeaving, setIntroLeaving] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.colorMode = colorMode;
    writeLocalStorage(colorModeKey, colorMode);
  }, [colorMode]);

  useEffect(() => {
    const magnitude = Math.abs(colorTemperature);
    document.documentElement.style.setProperty("--temperature-overlay", colorTemperature < 0 ? "104, 154, 255" : "255, 169, 92");
    document.documentElement.style.setProperty("--temperature-opacity", `${Math.min(0.34, Math.pow(magnitude / 100, 0.82) * 0.34).toFixed(3)}`);
    document.documentElement.style.setProperty("--temperature-panel-shift", `${colorTemperature}`);
    writeLocalStorage(colorTemperatureKey, String(colorTemperature));
  }, [colorTemperature]);

  useEffect(() => {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    writeLocalStorage(languageKey, language);
  }, [language]);

  useEffect(() => {
    if (!introVisible) {
      return;
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      writeSessionStorage(introSeenKey, "true");
      setIntroVisible(false);
      return;
    }
    const leaveTimer = window.setTimeout(() => setIntroLeaving(true), 1320);
    const doneTimer = window.setTimeout(() => {
      writeSessionStorage(introSeenKey, "true");
      setIntroVisible(false);
    }, 1840);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(doneTimer);
    };
  }, [introVisible]);

  useEffect(() => {
    const syncRoute = () => setRouteId(routeFromLocation());
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    fetchModules(authToken)
      .then((nextModules) => {
        setModules(nextModules);
        setModuleCatalogFallback(false);
      })
      .catch(() => {
        setModules(fallbackModules);
        setModuleCatalogFallback(true);
      });
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      return;
    }
    fetchCurrentUser(authToken)
      .then((user) => {
        setCurrentUser(user);
        writeLocalStorage(authUserKey, JSON.stringify(user));
      })
      .catch(() => signOut({ redirectHome: false }));
  }, [authToken]);

  const activeModuleId = routeModules[routeId] ?? "dashboard";
  const visibleModules = useMemo(() => modules.filter((module) => module.enabled !== false && (module.id !== "admin" || currentUser?.role === "admin")), [currentUser?.role, modules]);

  function navigate(nextRoute: RouteId) {
    window.history.pushState({}, "", nextRoute === "home" ? "/" : `/${nextRoute}`);
    setRouteId(nextRoute);
  }

  function openModule(moduleId: ModuleId) {
    navigate(moduleRoutes[moduleId]);
  }

  function signOut(options: { redirectHome?: boolean } = {}) {
    setUserMenuOpen(false);
    setAuthToken("");
    setCurrentUser(null);
    removeLocalStorage(authTokenKey);
    removeLocalStorage(authUserKey);
    if (options.redirectHome ?? true) {
      navigate("home");
    }
  }

  async function handleAuth(mode: "sign-in" | "sign-up", payload: Record<string, string>) {
    setAuthLoading(true);
    setAuthError("");
    try {
      const response = mode === "sign-in"
        ? await signIn({ identifier: payload.identifier, password: payload.password })
        : await signUp({ username: payload.username, email: payload.email, password: payload.password, display_name: payload.display_name });
      setAuthToken(response.token);
      setCurrentUser(response.user);
      writeLocalStorage(authTokenKey, response.token);
      writeLocalStorage(authUserKey, JSON.stringify(response.user));
      navigate("insight");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "认证失败");
    } finally {
      setAuthLoading(false);
    }
  }

  if (routeId === "sign-in" || routeId === "sign-up") {
    return (
      <AuthPage
        mode={routeId}
        loading={authLoading}
        error={authError}
        onHome={() => navigate("home")}
        onSwitch={(mode) => navigate(mode)}
        onSubmit={handleAuth}
      />
    );
  }

  if (routeId === "home") {
    return (
      <div className={`app-shell ${introVisible && !introLeaving ? "" : "intro-finished"}`}>
        {introVisible && <IntroStage leaving={introLeaving} />}
        <LandingPage
          currentUser={currentUser}
          onEnter={() => navigate(currentUser ? "insight" : "sign-in")}
          onSignIn={() => navigate("sign-in")}
          onSignUp={() => navigate("sign-up")}
          onSignOut={signOut}
        />
      </div>
    );
  }

  return (
    <div className={`app-shell ${introVisible && !introLeaving ? "" : "intro-finished"}`}>
      {introVisible && <IntroStage leaving={introLeaving} />}
      <header className="topbar module-topbar">
        <button className="topbar-brand" type="button" onClick={() => (activeModuleId === "dashboard" ? navigate("home") : openModule("dashboard"))}>
          <strong>ForEver</strong>
          <span>{displayModuleName(activeModuleId, language)}</span>
        </button>
        <nav className="topbar-actions" aria-label="页面导航">
          {activeModuleId !== "dashboard" && (
            <button className="secondary-button module-return-button" type="button" onClick={() => openModule("dashboard")}>
              <ArrowLeft size={17} />
              <span>见微知著</span>
            </button>
          )}
          {currentUser ? (
            <UserMenu
              user={currentUser}
              colorMode={colorMode}
              colorTemperature={colorTemperature}
              language={language}
              open={userMenuOpen}
              onToggle={() => setUserMenuOpen((open) => !open)}
              onClose={() => setUserMenuOpen(false)}
              onToggleColorMode={() => setColorMode(colorMode === "dark" ? "light" : "dark")}
              onColorModeChange={setColorMode}
              onColorTemperatureChange={setColorTemperature}
              onLanguageChange={setLanguage}
              onDashboard={() => {
                setUserMenuOpen(false);
                openModule("dashboard");
              }}
              onProfile={() => {
                setUserMenuOpen(false);
                openModule("profile");
              }}
              onSignOut={signOut}
            />
          ) : (
            <button className="primary-action compact" type="button" onClick={() => navigate("sign-in")}>
              登录
            </button>
          )}
        </nav>
      </header>
      <main className="module-page">
        {activeModuleId === "dashboard" ? (
          <ModuleDashboard modules={visibleModules} usingFallback={moduleCatalogFallback} language={language} onOpen={openModule} />
        ) : activeModuleId === "profile" ? (
          <ProfilePanel
            authToken={authToken}
            currentUser={currentUser}
            onUserChange={(user) => {
              setCurrentUser(user);
              writeLocalStorage(authUserKey, JSON.stringify(user));
            }}
          />
        ) : activeModuleId === "inspiration" ? (
          <InspirationCanvasPanel />
        ) : activeModuleId === "notes" ? (
          <NotesPanel />
        ) : activeModuleId === "provider-hub" ? (
          <ModelHubPanel />
        ) : activeModuleId === "chat" ? (
          <ChatPanel authToken={authToken} currentUser={currentUser} language={language} />
        ) : activeModuleId === "memory-map" ? (
          <MemoryMapPanel />
        ) : activeModuleId === "image-generation" ? (
          <ImageGenerationPanel />
        ) : activeModuleId === "workflow" ? (
          <WorkflowPanel />
        ) : activeModuleId === "token-usage" ? (
          <TokenUsagePanel authToken={authToken} currentUser={currentUser} />
        ) : activeModuleId === "admin" ? (
          <AdminPanel authToken={authToken} currentUser={currentUser} />
        ) : null}
      </main>
    </div>
  );
}

function IntroStage(props: { leaving: boolean }) {
  return (
    <div className={`intro-stage ${props.leaving ? "is-leaving" : ""}`} aria-hidden="true">
      <div className="intro-noise" />
      <div className="intro-grid">{Array.from({ length: 64 }, (_, index) => <span key={index} />)}</div>
      <div className="intro-thread"><span /><span /><span /><span /></div>
      <div className="intro-core">
        <div className="intro-lines"><i /><i /><i /></div>
        <div className="intro-mark">
          <span className="intro-mark-ring" />
          <Layers3 size={34} />
        </div>
        <div className="intro-title">
          <span>Aggregation OS</span>
          <strong>ForEver</strong>
        </div>
        <div className="intro-chips">
          <span>Chat</span>
          <span>Workflow</span>
          <span>Memory</span>
        </div>
        <div className="intro-meter"><i /></div>
      </div>
    </div>
  );
}

function LandingPage(props: {
  currentUser: AuthUser | null;
  onEnter: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  onSignOut: () => void;
}) {
  const heroRef = useRef<HTMLElement | null>(null);
  const maskStateRef = useRef<LandingMaskState>({
    targetX: landingMaskHiddenPosition,
    targetY: landingMaskHiddenPosition,
    x: landingMaskHiddenPosition,
    y: landingMaskHiddenPosition,
    vx: 0,
    vy: 0,
    opacity: 0,
    targetOpacity: 0,
    radius: 220,
    lastTimestamp: 0,
    frame: 0,
    hasPosition: false,
  });

  useEffect(() => {
    return () => {
      if (maskStateRef.current.frame) {
        window.cancelAnimationFrame(maskStateRef.current.frame);
      }
    };
  }, []);

  function writeMaskStyle(element: HTMLElement, state: LandingMaskState) {
    const speed = Math.hypot(state.vx, state.vy);
    const stretch = clampNumber(speed * 1.45, 0, state.radius * 0.52);
    const trailLimit = state.radius * 0.68;
    const trailX = state.x - clampNumber(state.vx * 1.8, -trailLimit, trailLimit);
    const trailY = state.y - clampNumber(state.vy * 1.8, -trailLimit, trailLimit);
    const angle = speed > 0.08 ? Math.atan2(state.vy, state.vx) * 180 / Math.PI : 0;

    element.style.setProperty("--landing-mask-x", `${state.x.toFixed(2)}px`);
    element.style.setProperty("--landing-mask-y", `${state.y.toFixed(2)}px`);
    element.style.setProperty("--landing-trail-x", `${trailX.toFixed(2)}px`);
    element.style.setProperty("--landing-trail-y", `${trailY.toFixed(2)}px`);
    element.style.setProperty("--landing-mask-rx", `${(state.radius + stretch).toFixed(2)}px`);
    element.style.setProperty("--landing-mask-ry", `${Math.max(142, state.radius - stretch * 0.42).toFixed(2)}px`);
    element.style.setProperty("--landing-flow-angle", `${angle.toFixed(2)}deg`);
    element.style.setProperty("--landing-flow-scale-x", `${(1 + stretch / state.radius * 0.42).toFixed(3)}`);
    element.style.setProperty("--landing-flow-scale-y", `${Math.max(0.74, 1 - stretch / state.radius * 0.22).toFixed(3)}`);
    element.style.setProperty("--landing-trail-scale-x", `${(1 + stretch / state.radius * 0.28).toFixed(3)}`);
    element.style.setProperty("--landing-trail-scale-y", `${Math.max(0.78, 1 - stretch / state.radius * 0.18).toFixed(3)}`);
    element.style.setProperty("--landing-mask-opacity", state.opacity.toFixed(3));
  }

  function animateMask(timestamp: number) {
    const element = heroRef.current;
    const state = maskStateRef.current;
    state.frame = 0;

    if (!element) {
      return;
    }

    const elapsed = state.lastTimestamp ? timestamp - state.lastTimestamp : 16.67;
    const dt = clampNumber(elapsed / 16.67, 0.45, 2.4);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    state.lastTimestamp = timestamp;

    if (reduceMotion) {
      state.x = state.targetX;
      state.y = state.targetY;
      state.vx = 0;
      state.vy = 0;
      state.opacity = state.targetOpacity;
    } else {
      const stiffness = 0.18;
      const damping = Math.pow(0.72, dt);
      state.vx = (state.vx + (state.targetX - state.x) * stiffness * dt) * damping;
      state.vy = (state.vy + (state.targetY - state.y) * stiffness * dt) * damping;
      state.x += state.vx * dt;
      state.y += state.vy * dt;
      state.opacity += (state.targetOpacity - state.opacity) * Math.min(1, 0.14 * dt);
    }

    writeMaskStyle(element, state);

    const distance = Math.hypot(state.targetX - state.x, state.targetY - state.y);
    const speed = Math.hypot(state.vx, state.vy);
    const opacityDelta = Math.abs(state.targetOpacity - state.opacity);
    if (distance > 0.35 || speed > 0.05 || opacityDelta > 0.004) {
      state.frame = window.requestAnimationFrame(animateMask);
      return;
    }

    if (state.targetOpacity === 0) {
      state.opacity = 0;
      writeMaskStyle(element, state);
    }
  }

  function startMaskAnimation() {
    const state = maskStateRef.current;
    if (state.frame) {
      return;
    }
    state.lastTimestamp = performance.now();
    state.frame = window.requestAnimationFrame(animateMask);
  }

  function updateMask(event: React.PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const state = maskStateRef.current;
    state.targetX = event.clientX - rect.left;
    state.targetY = event.clientY - rect.top;
    state.radius = clampNumber(Math.min(rect.width, rect.height) * 0.24, 170, 240);
    state.targetOpacity = 1;

    if (!state.hasPosition || state.opacity < 0.02) {
      state.x = state.targetX;
      state.y = state.targetY;
      state.vx = 0;
      state.vy = 0;
      state.hasPosition = true;
    }

    startMaskAnimation();
  }

  function hideMask() {
    maskStateRef.current.targetOpacity = 0;
    startMaskAnimation();
  }

  return (
    <section className="landing-page" aria-label="平台主页">
      <div className="landing-auth">
        {props.currentUser ? (
          <>
            <span className="secondary-button landing-user-badge">{props.currentUser.display_name || props.currentUser.username}</span>
            <button className="secondary-button danger" type="button" onClick={props.onSignOut}>退出登录</button>
          </>
        ) : (
          <>
            <button className="secondary-button" type="button" onClick={props.onSignIn}>登录</button>
            <button className="primary-action compact" type="button" onClick={props.onSignUp}>注册</button>
          </>
        )}
      </div>
      <main ref={heroRef} className="landing-hero" onPointerMove={updateMask} onPointerLeave={hideMask}>
        <div className="landing-image-bg" aria-hidden="true" />
        <div className="landing-image-veil" aria-hidden="true" />
        <div className="landing-fluid-glow landing-fluid-main" aria-hidden="true" />
        <div className="landing-fluid-glow landing-fluid-trail" aria-hidden="true" />
        <div className="landing-field" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="landing-orbit" aria-hidden="true">
          <span className="orbit-ring ring-one" />
          <span className="orbit-ring ring-two" />
          <span className="orbit-ring ring-three" />
          <span className="orbit-ring ring-four" />
          <span className="orbit-signal signal-one" />
          <span className="orbit-signal signal-two" />
          <span className="orbit-signal signal-three" />
          <span className="orbit-node orbit-chat"><MessageSquareText size={18} /></span>
          <span className="orbit-node orbit-image"><Image size={18} /></span>
          <span className="orbit-node orbit-provider"><PlugZap size={18} /></span>
          <span className="orbit-node orbit-admin"><Shield size={18} /></span>
        </div>
        <div className="landing-copy">
          <p className="eyebrow">Aggregation OS</p>
          <h1 className="landing-title"><span>ForEver</span></h1>
          <p>你眼中的别人，才是真实的你。</p>
          <button className="landing-cta" type="button" onClick={props.onEnter}>
            <span>进入</span>
            <ArrowRight size={19} />
          </button>
        </div>
      </main>
    </section>
  );
}

function AuthPage(props: {
  mode: "sign-in" | "sign-up";
  loading: boolean;
  error: string;
  onHome: () => void;
  onSwitch: (mode: "sign-in" | "sign-up") => void;
  onSubmit: (mode: "sign-in" | "sign-up", payload: Record<string, string>) => void;
}) {
  const [form, setForm] = useState({ identifier: "", username: "", email: "", display_name: "", password: "" });
  const isSignUp = props.mode === "sign-up";

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="auth-page" aria-label={isSignUp ? "注册账户" : "登录账户"}>
      <div className={`auth-glass-shell ${isSignUp ? "sign-up" : ""}`}>
        <div className="auth-brand">
          <button className="auth-brand-link" type="button" onClick={props.onHome}>ForEver</button>
          <p>你的聚合工作台</p>
        </div>
        <form
          className="auth-card"
          aria-busy={props.loading}
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit(props.mode, form);
          }}
        >
          <div className="auth-card-heading">
            <p className="eyebrow">账户</p>
            <h2>{isSignUp ? "注册账户" : "登录账户"}</h2>
          </div>
          <div className="auth-tabs">
            <button type="button" className={!isSignUp ? "active" : ""} disabled={props.loading} aria-pressed={!isSignUp} onClick={() => props.onSwitch("sign-in")}>登录</button>
            <button type="button" className={isSignUp ? "active" : ""} disabled={props.loading} aria-pressed={isSignUp} onClick={() => props.onSwitch("sign-up")}>注册</button>
          </div>
          <div className="auth-form">
            {isSignUp ? (
              <>
                <label><span>显示名称</span><input value={form.display_name} aria-label="显示名称" autoComplete="name" onChange={(event) => update("display_name", event.target.value)} /></label>
                <label><span>用户名</span><input value={form.username} aria-label="用户名" autoComplete="username" onChange={(event) => update("username", event.target.value)} required /></label>
                <label><span>邮箱</span><input type="email" value={form.email} aria-label="邮箱" autoComplete="email" onChange={(event) => update("email", event.target.value)} required /></label>
              </>
            ) : (
              <label><span>用户名 / 邮箱</span><input value={form.identifier} aria-label="用户名或邮箱" autoComplete="username" onChange={(event) => update("identifier", event.target.value)} required /></label>
            )}
            <label><span>密码</span><input type="password" value={form.password} aria-label="密码" autoComplete={isSignUp ? "new-password" : "current-password"} minLength={isSignUp ? 6 : undefined} onChange={(event) => update("password", event.target.value)} required /></label>
            {props.loading && <p className="react-status-line pending" role="status" aria-live="polite"><RefreshCw className="spin" size={14} />正在处理账户请求</p>}
            {props.error && <p className="auth-error" role="alert">{props.error}</p>}
            <button className="auth-submit" type="submit" disabled={props.loading}>
              {isSignUp ? <UserPlus size={16} /> : <KeyRound size={16} />}
              <span>{props.loading ? "处理中" : isSignUp ? "注册" : "登录"}</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function UserMenu(props: {
  user: AuthUser;
  colorMode: "light" | "dark";
  colorTemperature: number;
  language: UiLanguage;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onToggleColorMode: () => void;
  onColorModeChange: (mode: "light" | "dark") => void;
  onColorTemperatureChange: (value: number) => void;
  onLanguageChange: (language: UiLanguage) => void;
  onDashboard: () => void;
  onProfile: () => void;
  onSignOut: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const displayName = props.user.display_name || props.user.username;
  const initial = displayName.trim().slice(0, 1).toUpperCase() || "U";
  const avatarUrl = resolveMediaUrl(props.user.avatar_url);

  useEffect(() => {
    if (!props.open) return;
    function closeOnOutside(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        props.onClose();
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") props.onClose();
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [props.open, props.onClose]);

  function handleMenuTriggerClick(event: React.MouseEvent<HTMLButtonElement>) {
    if ((event.target as HTMLElement).closest(".user-avatar")) {
      props.onProfile();
      return;
    }
    props.onToggle();
  }

  return (
    <div className="user-menu" ref={menuRef}>
      <button className="user-menu-trigger" type="button" onClick={handleMenuTriggerClick} aria-label={`${props.open ? "关闭" : "打开"}用户菜单：${displayName}`} aria-haspopup="dialog" aria-expanded={props.open} aria-controls="user-account-menu">
        <span className="user-avatar" title="个人中心">{avatarUrl ? <img src={avatarUrl} alt="" /> : initial}</span>
        <span className="user-menu-name">{displayName}</span>
        <ChevronDown size={15} />
      </button>
      {props.open && (
        <div id="user-account-menu" className="user-dropdown" role="dialog" aria-label="用户菜单">
          <div className="user-dropdown-head">
            <span className="user-avatar large">{avatarUrl ? <img src={avatarUrl} alt="" /> : initial}</span>
            <div>
              <strong>{displayName}</strong>
              <small>{props.user.email}</small>
              <em>{props.user.role === "admin" ? "管理员" : "成员"}</em>
            </div>
          </div>
          <div className="user-menu-section">
            <span className="user-menu-label"><UserRound size={14} />账户</span>
            <button className="user-menu-action" type="button" onClick={props.onDashboard}>
              <Layers3 size={15} />
              <span>回到见微知著</span>
            </button>
            <button className="user-menu-action" type="button" onClick={props.onProfile}>
              <UserRound size={15} />
              <span>个人中心</span>
            </button>
          </div>
          <div className="user-menu-section">
            <span className="user-menu-label"><Sun size={14} />外观</span>
            <div className="segmented-options" role="group" aria-label="颜色模式">
              <button type="button" className={props.colorMode === "light" ? "active" : ""} aria-pressed={props.colorMode === "light"} onClick={() => props.onColorModeChange("light")}>
                <Sun size={14} />
                <span>白天</span>
              </button>
              <button type="button" className={props.colorMode === "dark" ? "active" : ""} aria-pressed={props.colorMode === "dark"} onClick={() => props.onColorModeChange("dark")}>
                <Moon size={14} />
                <span>黑夜</span>
              </button>
            </div>
            <label className="temperature-control">
              <span>
                <i>冷色</i>
                <strong><ThermometerSun size={13} /> {props.colorTemperature > 0 ? `+${props.colorTemperature}` : props.colorTemperature}</strong>
                <i>暖色</i>
              </span>
              <input type="range" min="-100" max="100" step="1" value={props.colorTemperature} aria-label="色温" onChange={(event) => props.onColorTemperatureChange(Number(event.target.value))} />
            </label>
          </div>
          <div className="user-menu-section">
            <span className="user-menu-label"><Languages size={14} />语言</span>
            <div className="segmented-options" role="group" aria-label="语言">
              <button type="button" className={props.language === "zh" ? "active" : ""} aria-pressed={props.language === "zh"} onClick={() => props.onLanguageChange("zh")}>中文</button>
              <button type="button" className={props.language === "en" ? "active" : ""} aria-pressed={props.language === "en"} onClick={() => props.onLanguageChange("en")}>English</button>
            </div>
          </div>
          <div className="user-menu-section user-menu-footer">
            <button className="user-menu-action danger" type="button" onClick={props.onSignOut}>
              <LogOut size={15} />
              <span>退出登录</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModuleDashboard(props: { modules: PlatformModule[]; usingFallback: boolean; language: UiLanguage; onOpen: (moduleId: ModuleId) => void }) {
  function moveCardHighlight(event: React.PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--card-x", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--card-y", `${event.clientY - rect.top}px`);
  }

  return (
    <section className="dashboard-panel" aria-label="见微知著">
      <div className="home-hero">
        <div className="hero-copy greeting-copy">
          <p className="eyebrow">ForEver Workspace</p>
          <h1>见微知著</h1>
          <p>把对话、笔记、地图、工作流和灵感入口收束在一处，进入任何模块都不打断当前的视觉节奏。</p>
          <div className="hero-actions">
            <button className="primary-action" type="button" onClick={() => props.onOpen("inspiration")}>
              <Sparkles size={16} />
              <span>进入灵感</span>
            </button>
          </div>
        </div>
        <div className="hero-system">
          <div className="system-topline">
            <span className="status-pill online"><CheckCircle2 size={14} />在线</span>
            <small>{props.modules.length} 个模块可用</small>
          </div>
          <div className="system-map" aria-hidden="true">
            <span className="system-line line-one" />
            <span className="system-line line-two" />
            <span className="system-line line-three" />
            <span className="system-line line-four" />
            <span className="system-node main-node"><Layers3 size={21} /></span>
            {props.modules.slice(0, 7).map((module) => {
              const moduleId = normalizeModuleId(module.id);
              const Icon = moduleIcon(moduleId);
              return <span key={module.id} className={`system-node node-${moduleId}`}><Icon size={19} /></span>;
            })}
          </div>
        </div>
      </div>
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">模块入口</p>
          <h2>系统模块</h2>
        </div>
        <div className="module-counts"><span>{props.modules.length} 个可用模块</span></div>
      </div>
      {props.usingFallback && <p className="react-status-line pending dashboard-catalog-status" role="status" aria-live="polite"><RefreshCw className="spin" size={14} />模块目录暂不可用，正在显示本地默认模块。</p>}
      {props.modules.length ? <div className="module-grid">
        {props.modules.map((module) => {
          const moduleId = normalizeModuleId(module.id);
          const Icon = moduleIcon(moduleId);
          const moduleName = displayModuleName(moduleId, props.language);
          const moduleNameEn = displayModuleName(moduleId, "en");
          return (
            <button key={module.id} className="module-card" type="button" aria-label={`进入${moduleName}：${module.description}`} onPointerMove={moveCardHighlight} onClick={() => props.onOpen(moduleId)}>
              <span className={`module-card-icon ${moduleCategoryClass(module.category)}`}>
                <Icon size={22} />
              </span>
              <span className="module-card-body">
                <span>{moduleNameEn}</span>
                <h3>{moduleName}</h3>
                <p>{displayModuleDescription(moduleId, props.language, module.description)}</p>
                <small className={module.enabled === false ? "" : "active"}>{module.enabled === false ? "已下架" : "可进入"}</small>
              </span>
            </button>
          );
        })}
      </div> : <div className="dashboard-empty-state" role="status" aria-live="polite"><Layers3 size={24} /><strong>暂无可用模块</strong><span>模块启用后会出现在这里。</span></div>}
    </section>
  );
}

function moduleCategoryClass(category: string) {
  return {
    ai: "module-card-icon-ai",
    integration: "module-card-icon-integration",
    automation: "module-card-icon-automation",
    productivity: "module-card-icon-productivity",
    memory: "module-card-icon-memory",
    creativity: "module-card-icon-creativity",
    admin: "module-card-icon-admin",
    analytics: "module-card-icon-analytics",
  }[category] ?? "";
}

function routeFromLocation(): RouteId {
  const route = window.location.pathname.replace(/^\/+/, "") || "home";
  const allowed: RouteId[] = ["home", "sign-in", "sign-up", "insight", "profile", "chat", "image", "aggregation", "notes", "map", "automation", "token-usage", "inspiration", "admin"];
  return allowed.includes(route as RouteId) ? (route as RouteId) : "home";
}

function loadStoredUser() {
  try {
    return JSON.parse(readLocalStorage(authUserKey) ?? "null") as AuthUser | null;
  } catch {
    return null;
  }
}

function loadColorTemperature() {
  const stored = Number(readLocalStorage(colorTemperatureKey) ?? "0");
  if (!Number.isFinite(stored)) {
    return 0;
  }
  return Math.max(-100, Math.min(100, Math.round(stored)));
}

function readLocalStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences and auth cache are best-effort; the app should remain usable when storage is blocked.
  }
}

function removeLocalStorage(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup for restricted storage contexts.
  }
}

function readSessionStorage(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionStorage(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Intro replay state is non-critical.
  }
}

function normalizeModuleId(id: string): ModuleId {
  return (Object.keys(moduleRoutes).includes(id) ? id : "dashboard") as ModuleId;
}

function displayModuleName(moduleId: ModuleId, language: UiLanguage = "zh") {
  const names: Record<ModuleId, { zh: string; en: string }> = {
    dashboard: { zh: "见微知著", en: "Insight" },
    profile: { zh: "个人中心", en: "Profile" },
    chat: { zh: "交耳", en: "Conversations" },
    "image-generation": { zh: "虚实", en: "Virtuality" },
    "provider-hub": { zh: "中枢", en: "Hub" },
    notes: { zh: "笔记", en: "Notes" },
    "memory-map": { zh: "地图纪念", en: "Memory Map" },
    workflow: { zh: "秩序", en: "Workflow" },
    "token-usage": { zh: "Token统计", en: "Token Usage" },
    inspiration: { zh: "灵感", en: "Inspiration" },
    admin: { zh: "管理员端", en: "Admin" },
  };
  return names[moduleId][language];
}

function displayModuleDescription(moduleId: ModuleId, language: UiLanguage, fallback: string) {
  if (language === "zh") return fallback;
  const descriptions: Record<ModuleId, string> = {
    dashboard: "Overview of modules, status, and entry points.",
    profile: "Manage avatar, signature, location, password, and linked platforms.",
    chat: "Contacts, private messages, and AI conversations.",
    "image-generation": "Image generation workspace.",
    "provider-hub": "Manage global model APIs and the active configuration.",
    notes: "Markdown writing, preview, and export.",
    "memory-map": "Save city memories.",
    workflow: "Agent, MCP, and workflow orchestration.",
    "token-usage": "Track local AI token usage and activity.",
    inspiration: "Visual AI workflow canvas for organizing ideas.",
    admin: "Manage users, modules, and operations.",
  };
  return descriptions[moduleId];
}

function moduleIcon(moduleId: ModuleId) {
  return {
    dashboard: Layers3,
    profile: UserRound,
    chat: MessageSquareText,
    "image-generation": Image,
    "provider-hub": Bot,
    notes: NotebookPen,
    "memory-map": Map,
    workflow: Workflow,
    "token-usage": Gauge,
    inspiration: Lightbulb,
    admin: Shield,
  }[moduleId];
}

export default App;
