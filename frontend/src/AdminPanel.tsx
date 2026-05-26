import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldCheck, ToggleLeft, ToggleRight, UserRound } from "lucide-react";
import { fetchAdminAuditLogs, fetchAdminModules, fetchAdminOverview, fetchAdminUsers, updateAdminModule, updateAdminUserRisk, updateAdminUserRole } from "./services/api";
import type { AdminAuditLog, AdminOverview, AdminUser } from "./types/auth";
import type { AdminModule } from "./types/platform";

export default function AdminPanel(props: { authToken: string; currentUserId?: string }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [modules, setModules] = useState<AdminModule[]>([]);
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<"overview" | "users" | "modules" | "audit">("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const visibleUsers = useMemo(() => users.filter((user) => `${user.username} ${user.email} ${user.display_name}`.toLowerCase().includes(query.toLowerCase())), [query, users]);

  useEffect(() => {
    refresh();
  }, [props.authToken]);

  async function refresh() {
    if (!props.authToken) return;
    setLoading(true);
    setError("");
    try {
      const [nextOverview, nextUsers, nextModules, nextLogs] = await Promise.all([
        fetchAdminOverview(props.authToken),
        fetchAdminUsers(props.authToken),
        fetchAdminModules(props.authToken),
        fetchAdminAuditLogs(props.authToken),
      ]);
      setOverview(nextOverview);
      setUsers(nextUsers);
      setModules(nextModules);
      setLogs(nextLogs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "管理员数据加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(user: AdminUser, role: string) {
    const updated = await updateAdminUserRole(props.authToken, user.id, role);
    setUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function toggleRisk(user: AdminUser) {
    const updated = await updateAdminUserRisk(props.authToken, user.id, !user.risk_flagged, "Admin review");
    setUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function toggleModule(module: AdminModule) {
    const updated = await updateAdminModule(props.authToken, module.id, !module.enabled);
    setModules((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  if (!props.authToken) {
    return <section className="admin-empty-state"><ShieldCheck size={28} /><strong>请先登录管理员账号</strong></section>;
  }

  return (
    <section className="admin-panel react-admin-panel">
      <aside className="admin-floating-nav">
        <div className="admin-nav-brand"><ShieldCheck size={20} /><strong>管理员端</strong><span>Admin Console</span></div>
        {(["overview", "users", "modules", "audit"] as const).map((item) => <button key={item} className={`admin-nav-item ${section === item ? "active" : ""}`} type="button" onClick={() => setSection(item)}>{sectionLabel(item)}</button>)}
      </aside>
      <main className="admin-console">
        <div className="module-view-header admin-console-header">
          <div><p className="eyebrow">Admin</p><h1>{sectionLabel(section)}</h1></div>
          <button className={`secondary-button admin-refresh-button ${loading ? "refreshing" : ""}`} type="button" onClick={refresh}><RefreshCw size={16} />刷新</button>
        </div>
        {error && <p className="react-error-line">{error}</p>}
        {section === "overview" && <div className="admin-overview-grid">
          <Metric label="用户" value={overview?.user_count ?? users.length} />
          <Metric label="管理员" value={overview?.admin_count ?? users.filter((user) => user.role === "admin").length} />
          <Metric label="会话" value={overview?.active_session_count ?? 0} />
          <Metric label="启用模块" value={overview?.enabled_module_count ?? modules.filter((module) => module.enabled).length} />
        </div>}
        {section === "users" && <div className="admin-users-card">
          <label className="admin-search-field"><UserRound size={15} /><input value={query} placeholder="搜索用户" onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="admin-user-table">{visibleUsers.map((user) => <div key={user.id} className="admin-user-row">
            <div className="admin-user-main"><span className="admin-user-avatar">{user.display_name?.[0] ?? user.username[0]}</span><div><strong>{user.display_name || user.username}</strong><small>{user.email}</small></div></div>
            <span>{user.message_count} 消息</span>
            <select value={user.role} disabled={user.id === props.currentUserId && user.role === "admin"} onChange={(event) => changeRole(user, event.target.value)}><option value="member">成员</option><option value="admin">管理员</option></select>
            <button className={`admin-filter-chip ${user.risk_flagged ? "active" : ""}`} type="button" onClick={() => toggleRisk(user)}>{user.risk_flagged ? "已标记" : "风险标记"}</button>
          </div>)}</div>
        </div>}
        {section === "modules" && <div className="admin-module-grid">{modules.map((module) => <article key={module.id} className={`admin-module-card ${module.enabled ? "" : "disabled"}`}><div className="admin-module-card-head"><span className="admin-module-icon"><ShieldCheck size={17} /></span><div><h2>{module.name}</h2><p>{module.description}</p></div></div><button className={`admin-switch ${module.enabled ? "active" : ""}`} disabled={module.locked} type="button" onClick={() => toggleModule(module)}>{module.enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}</button></article>)}</div>}
        {section === "audit" && <ul className="admin-audit-list">{logs.map((log) => <li key={log.id}><strong>{log.action}</strong><span>{log.actor_name} · {log.target_type} · {log.detail}</span><small>{new Date(log.created_at).toLocaleString("zh-CN")}</small></li>)}</ul>}
      </main>
    </section>
  );
}

function Metric(props: { label: string; value: number }) {
  return <article className="admin-metric-card"><ShieldCheck size={18} /><span>{props.label}</span><strong>{props.value}</strong></article>;
}

function sectionLabel(section: string) {
  return { overview: "概览", users: "用户", modules: "模块", audit: "审计" }[section] ?? section;
}
