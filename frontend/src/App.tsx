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
  Sun,
  Trash2,
  UserRound,
  UserPlus,
  Wand2,
  Workflow,
  X,
} from "lucide-react";

import { fetchCurrentUser, fetchModules, signIn, signUp } from "./services/api";
import AdminPanel from "./AdminPanel";
import ChatPanel from "./ChatPanel";
import ImageGenerationPanel from "./ImageGenerationPanel";
import InspirationPanel from "./InspirationPanel";
import MemoryMapPanel from "./MemoryMapPanel";
import ModelHubPanel from "./ModelHubPanel";
import NotesPanel from "./NotesPanel";
import WorkflowPanel from "./WorkflowPanel";
import type { AuthUser } from "./types/auth";
import type { PlatformModule } from "./types/platform";

type RouteId = "home" | "sign-in" | "sign-up" | "insight" | "chat" | "image" | "aggregation" | "notes" | "map" | "automation" | "inspiration" | "admin";
type ModuleId = "dashboard" | "chat" | "image-generation" | "provider-hub" | "notes" | "memory-map" | "workflow" | "inspiration" | "admin";

const authTokenKey = "4ever.auth.token";
const authUserKey = "4ever.auth.user";
const colorModeKey = "4ever.ui.colorMode";

const moduleRoutes: Record<ModuleId, RouteId> = {
  dashboard: "insight",
  chat: "chat",
  "image-generation": "image",
  "provider-hub": "aggregation",
  notes: "notes",
  "memory-map": "map",
  workflow: "automation",
  inspiration: "inspiration",
  admin: "admin",
};

const routeModules = Object.fromEntries(Object.entries(moduleRoutes).map(([moduleId, route]) => [route, moduleId])) as Record<RouteId, ModuleId>;

const fallbackModules: PlatformModule[] = [
  { id: "chat", name: "交耳", description: "AI 与联系人会话。", category: "ai", enabled: true },
  { id: "provider-hub", name: "接口中枢", description: "管理模型 API、人格和宠物。", category: "integration", enabled: true },
  { id: "notes", name: "札记", description: "记录笔记和草稿。", category: "productivity", enabled: true },
  { id: "memory-map", name: "地图纪念", description: "保存城市记忆。", category: "memory", enabled: true },
  { id: "workflow", name: "秩序", description: "用系统数据编排工作流。", category: "automation", enabled: true },
  { id: "inspiration", name: "灵感温室", description: "收集、组合并推进灵感。", category: "creativity", enabled: true },
  { id: "image-generation", name: "绘影", description: "图像生成实验台。", category: "ai", enabled: true },
  { id: "admin", name: "管理员端", description: "管理用户、模块和运营状态。", category: "admin", enabled: true },
];

function App() {
  const [routeId, setRouteId] = useState<RouteId>(() => routeFromLocation());
  const [authToken, setAuthToken] = useState(() => localStorage.getItem(authTokenKey) ?? "");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => loadStoredUser());
  const [modules, setModules] = useState<PlatformModule[]>(fallbackModules);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [colorMode, setColorMode] = useState<"light" | "dark">(() => (localStorage.getItem(colorModeKey) === "dark" ? "dark" : "light"));
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.colorMode = colorMode;
    localStorage.setItem(colorModeKey, colorMode);
  }, [colorMode]);

  useEffect(() => {
    const syncRoute = () => setRouteId(routeFromLocation());
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    fetchModules(authToken).then(setModules).catch(() => setModules(fallbackModules));
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      return;
    }
    fetchCurrentUser(authToken)
      .then((user) => {
        setCurrentUser(user);
        localStorage.setItem(authUserKey, JSON.stringify(user));
      })
      .catch(() => signOut());
  }, [authToken]);

  const activeModuleId = routeModules[routeId] ?? "dashboard";
  const visibleModules = useMemo(() => modules.filter((module) => module.enabled !== false), [modules]);

  function navigate(nextRoute: RouteId) {
    window.history.pushState({}, "", nextRoute === "home" ? "/" : `/${nextRoute}`);
    setRouteId(nextRoute);
  }

  function openModule(moduleId: ModuleId) {
    navigate(moduleRoutes[moduleId]);
  }

  function signOut() {
    setUserMenuOpen(false);
    setAuthToken("");
    setCurrentUser(null);
    localStorage.removeItem(authTokenKey);
    localStorage.removeItem(authUserKey);
    navigate("home");
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
      localStorage.setItem(authTokenKey, response.token);
      localStorage.setItem(authUserKey, JSON.stringify(response.user));
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
      <div className="app-shell intro-finished">
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
    <div className="app-shell intro-finished">
      <header className="topbar module-topbar">
        <button className="topbar-brand" type="button" onClick={() => (activeModuleId === "dashboard" ? navigate("home") : openModule("dashboard"))}>
          <strong>ForEver</strong>
          <span>{displayModuleName(activeModuleId)}</span>
        </button>
        <nav className="topbar-actions" aria-label="页面导航">
          {activeModuleId !== "dashboard" && (
            <button className="secondary-button module-return-button" type="button" onClick={() => openModule("dashboard")}>
              <ArrowLeft size={17} />
              <span>见微知著</span>
            </button>
          )}
          <button className="secondary-button" type="button" onClick={() => setColorMode(colorMode === "dark" ? "light" : "dark")}>
            {colorMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            <span>{colorMode === "dark" ? "白天" : "黑夜"}</span>
          </button>
          {currentUser ? (
            <UserMenu
              user={currentUser}
              colorMode={colorMode}
              open={userMenuOpen}
              onToggle={() => setUserMenuOpen((open) => !open)}
              onClose={() => setUserMenuOpen(false)}
              onToggleColorMode={() => setColorMode(colorMode === "dark" ? "light" : "dark")}
              onDashboard={() => {
                setUserMenuOpen(false);
                openModule("dashboard");
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
          <ModuleDashboard modules={visibleModules} onOpen={openModule} />
        ) : activeModuleId === "inspiration" ? (
          <InspirationPanel />
        ) : activeModuleId === "notes" ? (
          <NotesPanel />
        ) : activeModuleId === "provider-hub" ? (
          <ModelHubPanel />
        ) : activeModuleId === "chat" ? (
          <ChatPanel />
        ) : activeModuleId === "memory-map" ? (
          <MemoryMapPanel />
        ) : activeModuleId === "image-generation" ? (
          <ImageGenerationPanel />
        ) : activeModuleId === "workflow" ? (
          <WorkflowPanel />
        ) : activeModuleId === "admin" ? (
          <AdminPanel authToken={authToken} currentUserId={currentUser?.id} />
        ) : null}
      </main>
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

  function updateMask(event: React.PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    event.currentTarget.style.setProperty("--landing-mask-x", `${x}px`);
    event.currentTarget.style.setProperty("--landing-mask-y", `${y}px`);
    event.currentTarget.style.setProperty("--landing-mask-opacity", "1");
  }

  function hideMask() {
    heroRef.current?.style.setProperty("--landing-mask-opacity", "0");
  }

  return (
    <section className="landing-page" aria-label="平台主页">
      <div className="landing-auth">
        {props.currentUser ? (
          <>
            <button className="secondary-button" type="button">{props.currentUser.display_name || props.currentUser.username}</button>
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
    <section className="auth-page" aria-label={isSignUp ? "Sign up" : "Sign in"}>
      <div className={`auth-glass-shell ${isSignUp ? "sign-up" : ""}`}>
        <div className="auth-brand">
          <button className="auth-brand-link" type="button" onClick={props.onHome}>ForEver</button>
          <p>你的聚合工作台</p>
        </div>
        <form
          className="auth-card"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit(props.mode, form);
          }}
        >
          <div className="auth-card-heading">
            <p className="eyebrow">Account</p>
            <h2>{isSignUp ? "Sign up" : "Sign in"}</h2>
          </div>
          <div className="auth-tabs">
            <button type="button" className={!isSignUp ? "active" : ""} onClick={() => props.onSwitch("sign-in")}>Sign in</button>
            <button type="button" className={isSignUp ? "active" : ""} onClick={() => props.onSwitch("sign-up")}>Sign up</button>
          </div>
          <div className="auth-form">
            {isSignUp ? (
              <>
                <label><span>Display name</span><input value={form.display_name} onChange={(event) => update("display_name", event.target.value)} /></label>
                <label><span>Username</span><input value={form.username} onChange={(event) => update("username", event.target.value)} required /></label>
                <label><span>Email</span><input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} required /></label>
              </>
            ) : (
              <label><span>Username / Email</span><input value={form.identifier} onChange={(event) => update("identifier", event.target.value)} required /></label>
            )}
            <label><span>Password</span><input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} required /></label>
            {props.error && <p className="auth-error">{props.error}</p>}
            <button className="auth-submit" type="submit" disabled={props.loading}>
              {isSignUp ? <UserPlus size={16} /> : <KeyRound size={16} />}
              <span>{props.loading ? "处理中" : isSignUp ? "Sign up" : "Sign in"}</span>
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
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onToggleColorMode: () => void;
  onDashboard: () => void;
  onSignOut: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const displayName = props.user.display_name || props.user.username;
  const initial = displayName.trim().slice(0, 1).toUpperCase() || "U";

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

  return (
    <div className="user-menu" ref={menuRef}>
      <button className="user-menu-trigger" type="button" onClick={props.onToggle} aria-haspopup="menu" aria-expanded={props.open}>
        <span className="user-avatar">{initial}</span>
        <span className="user-menu-name">{displayName}</span>
        <ChevronDown size={15} />
      </button>
      {props.open && (
        <div className="user-dropdown" role="menu">
          <div className="user-dropdown-head">
            <span className="user-avatar large">{initial}</span>
            <div>
              <strong>{displayName}</strong>
              <small>{props.user.email}</small>
              <em>{props.user.role === "admin" ? "管理员" : "成员"}</em>
            </div>
          </div>
          <div className="user-menu-section">
            <span className="user-menu-label"><UserRound size={14} />账户</span>
            <button className="user-menu-action" type="button" role="menuitem" onClick={props.onDashboard}>
              <Layers3 size={15} />
              <span>回到见微知著</span>
            </button>
            <button className="user-menu-action" type="button" role="menuitem" onClick={props.onToggleColorMode}>
              {props.colorMode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              <span>{props.colorMode === "dark" ? "切换白天" : "切换黑夜"}</span>
            </button>
            <button className="user-menu-action danger" type="button" role="menuitem" onClick={props.onSignOut}>
              <LogOut size={15} />
              <span>退出登录</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModuleDashboard(props: { modules: PlatformModule[]; onOpen: (moduleId: ModuleId) => void }) {
  return (
    <section className="dashboard-panel" aria-label="见微知著">
      <div className="home-hero">
        <div className="hero-copy greeting-copy">
          <p className="eyebrow">ForEver Workspace</p>
          <h1>见微知著</h1>
          <p>把对话、札记、地图、工作流和灵感入口收束在一处，进入任何模块都不打断当前的视觉节奏。</p>
          <div className="hero-actions">
            <button className="primary-action" type="button" onClick={() => props.onOpen("inspiration")}>
              <Sparkles size={16} />
              <span>进入灵感温室</span>
            </button>
          </div>
        </div>
        <div className="hero-system">
          <div className="system-topline">
            <span className="status-pill online"><CheckCircle2 size={14} />Online</span>
            <small>{props.modules.length} modules available</small>
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
          <p className="eyebrow">Modules</p>
          <h2>系统模块</h2>
        </div>
        <div className="module-counts"><span>{props.modules.length} 个可用模块</span></div>
      </div>
      <div className="module-grid">
        {props.modules.map((module) => {
          const moduleId = normalizeModuleId(module.id);
          const Icon = moduleIcon(moduleId);
          return (
            <button key={module.id} className="module-card" type="button" onClick={() => props.onOpen(moduleId)}>
              <span className={`module-card-icon ${module.category === "integration" ? "module-card-icon-integration" : module.category === "automation" ? "module-card-icon-automation" : ""}`}>
                <Icon size={22} />
              </span>
              <span className="module-card-body">
                <span>{module.category}</span>
                <h3>{module.name}</h3>
                <p>{module.description}</p>
                <small className={module.enabled === false ? "" : "active"}>{module.enabled === false ? "已下架" : "可进入"}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function routeFromLocation(): RouteId {
  const route = window.location.pathname.replace(/^\/+/, "") || "home";
  const allowed: RouteId[] = ["home", "sign-in", "sign-up", "insight", "chat", "image", "aggregation", "notes", "map", "automation", "inspiration", "admin"];
  return allowed.includes(route as RouteId) ? (route as RouteId) : "home";
}

function loadStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(authUserKey) ?? "null") as AuthUser | null;
  } catch {
    return null;
  }
}

function normalizeModuleId(id: string): ModuleId {
  return (Object.keys(moduleRoutes).includes(id) ? id : "dashboard") as ModuleId;
}

function displayModuleName(moduleId: ModuleId) {
  return {
    dashboard: "见微知著",
    chat: "交耳",
    "image-generation": "绘影",
    "provider-hub": "接口中枢",
    notes: "札记",
    "memory-map": "地图纪念",
    workflow: "秩序",
    inspiration: "灵感温室",
    admin: "管理员端",
  }[moduleId];
}

function moduleIcon(moduleId: ModuleId) {
  return {
    dashboard: Layers3,
    chat: MessageSquareText,
    "image-generation": Image,
    "provider-hub": Bot,
    notes: NotebookPen,
    "memory-map": Map,
    workflow: Workflow,
    inspiration: Lightbulb,
    admin: Shield,
  }[moduleId];
}

export default App;
