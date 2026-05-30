import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Bot, RefreshCw, ShieldCheck, ToggleLeft, ToggleRight, UserRound } from "lucide-react";
import { fetchAdminAgents, fetchAdminAuditLogs, fetchAdminMcpServers, fetchAdminModules, fetchAdminOverview, fetchAdminUsers, updateAdminAgentPrompt, updateAdminMcpServer, updateAdminModule, updateAdminUserRisk, updateAdminUserRole } from "./services/api";
import type { AdminAuditLog, AdminOverview, AdminUser, AuthUser } from "./types/auth";
import type { AdminModule } from "./types/platform";
import type { AgentBlueprint, McpServer } from "./types/workflow";

export default function AdminPanel(props: { authToken: string; currentUser: AuthUser | null }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [modules, setModules] = useState<AdminModule[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [agents, setAgents] = useState<AgentBlueprint[]>([]);
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<"overview" | "users" | "modules" | "mcp" | "agents" | "audit">("overview");
  const [editingAgentId, setEditingAgentId] = useState("");
  const [agentDrafts, setAgentDrafts] = useState<Record<string, { prompt_version: string; system_prompt: string }>>({});
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState("");
  const visibleUsers = useMemo(() => users.filter((user) => `${user.username} ${user.email} ${user.display_name}`.toLowerCase().includes(query.toLowerCase())), [query, users]);
  const isAdmin = props.currentUser?.role === "admin";

  useEffect(() => {
    if (!props.authToken || !isAdmin) {
      setOverview(null);
      setUsers([]);
      setModules([]);
      setMcpServers([]);
      setAgents([]);
      setLogs([]);
      setAgentDrafts({});
      setError("");
      setLoading(false);
      setPendingAction("");
      return;
    }
    refresh();
  }, [props.authToken, isAdmin]);

  async function refresh() {
    if (!props.authToken) return;
    setLoading(true);
    setError("");
    try {
      const [nextOverview, nextUsers, nextModules, nextMcpServers, nextAgents, nextLogs] = await Promise.all([
        fetchAdminOverview(props.authToken),
        fetchAdminUsers(props.authToken),
        fetchAdminModules(props.authToken),
        fetchAdminMcpServers(props.authToken),
        fetchAdminAgents(props.authToken),
        fetchAdminAuditLogs(props.authToken),
      ]);
      setOverview(nextOverview);
      setUsers(nextUsers);
      setModules(nextModules);
      setMcpServers(nextMcpServers);
      setAgents(nextAgents);
      setAgentDrafts(Object.fromEntries(nextAgents.map((agent) => [agent.id, { prompt_version: agent.prompt_version, system_prompt: agent.system_prompt }])));
      setLogs(nextLogs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "管理员数据加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(user: AdminUser, role: string) {
    const actionId = `user-role:${user.id}`;
    setPendingAction(actionId);
    setError("");
    try {
      const updated = await updateAdminUserRole(props.authToken, user.id, role);
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(adminActionError(cause, "角色更新失败"));
    } finally {
      setPendingAction((current) => current === actionId ? "" : current);
    }
  }

  async function toggleRisk(user: AdminUser) {
    const actionId = `user-risk:${user.id}`;
    setPendingAction(actionId);
    setError("");
    try {
      const updated = await updateAdminUserRisk(props.authToken, user.id, !user.risk_flagged, "Admin review");
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(adminActionError(cause, "风险标记更新失败"));
    } finally {
      setPendingAction((current) => current === actionId ? "" : current);
    }
  }

  async function toggleModule(module: AdminModule) {
    const actionId = `module:${module.id}`;
    setPendingAction(actionId);
    setError("");
    try {
      const updated = await updateAdminModule(props.authToken, module.id, !module.enabled);
      setModules((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(adminActionError(cause, "模块开关更新失败"));
    } finally {
      setPendingAction((current) => current === actionId ? "" : current);
    }
  }

  async function toggleMcpServer(server: McpServer) {
    const actionId = `mcp:${server.id}`;
    setPendingAction(actionId);
    setError("");
    try {
      const updated = await updateAdminMcpServer(props.authToken, server.id, !server.enabled);
      setMcpServers((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(adminActionError(cause, "MCP 开关更新失败"));
    } finally {
      setPendingAction((current) => current === actionId ? "" : current);
    }
  }

  async function saveAgentPrompt(agent: AgentBlueprint) {
    const draft = agentDrafts[agent.id];
    if (!draft) return;
    const actionId = `agent:${agent.id}`;
    setPendingAction(actionId);
    setError("");
    try {
      const updated = await updateAdminAgentPrompt(props.authToken, agent.id, draft);
      setAgents((current) => current.map((item) => item.id === updated.id ? updated : item));
      setAgentDrafts((current) => ({ ...current, [updated.id]: { prompt_version: updated.prompt_version, system_prompt: updated.system_prompt } }));
      setEditingAgentId("");
    } catch (cause) {
      setError(adminActionError(cause, "Agent 提示词保存失败"));
    } finally {
      setPendingAction((current) => current === actionId ? "" : current);
    }
  }

  function updateAgentDraft(agentId: string, key: "prompt_version" | "system_prompt", value: string) {
    setAgentDrafts((current) => ({ ...current, [agentId]: { ...(current[agentId] ?? { prompt_version: "", system_prompt: "" }), [key]: value } }));
  }

  if (!props.authToken) {
    return <section className="admin-empty-state" role="status" aria-live="polite"><ShieldCheck size={28} /><strong>请先登录管理员账号</strong><span>管理员端用于后台开关、审计和配置管理。</span></section>;
  }

  if (!props.currentUser) {
    return <section className="admin-empty-state" role="status" aria-live="polite"><RefreshCw className="spin" size={28} /><strong>正在确认管理员身份</strong><span>确认完成后会显示后台开关、审计和配置管理。</span></section>;
  }

  if (!isAdmin) {
    return <section className="admin-empty-state" role="status" aria-live="polite"><ShieldCheck size={28} /><strong>需要管理员权限</strong><span>Agent、MCP 和工作流面向普通用户开放；后台开关、审计和配置管理仅管理员可见。</span></section>;
  }

  const currentUser = props.currentUser;

  return (
    <section className="admin-panel react-admin-panel">
      <aside className="admin-floating-nav">
        <div className="admin-nav-brand"><ShieldCheck size={20} /><strong>管理员端</strong><span>后台控制台</span></div>
        {(["overview", "users", "modules", "mcp", "agents", "audit"] as const).map((item) => <button key={item} className={`admin-nav-item ${section === item ? "active" : ""}`} type="button" aria-current={section === item ? "page" : undefined} onClick={() => setSection(item)}>{sectionLabel(item)}</button>)}
      </aside>
      <main className="admin-console">
        <div className="module-view-header admin-console-header">
          <div><p className="eyebrow">后台管理</p><h1>{sectionLabel(section)}</h1></div>
          <button className={`secondary-button admin-refresh-button ${loading ? "refreshing" : ""}`} type="button" disabled={loading} onClick={refresh}><RefreshCw size={16} />{loading ? "刷新中" : "刷新"}</button>
        </div>
        {loading && <p className="react-status-line pending" role="status" aria-live="polite"><RefreshCw className="spin" size={14} />正在刷新管理员数据</p>}
        {error && <p className="react-error-line" role="alert">{error}</p>}
        {section === "overview" && <div className="admin-overview-grid">
          <Metric label="用户" value={overview?.user_count ?? users.length} />
          <Metric label="管理员" value={overview?.admin_count ?? users.filter((user) => user.role === "admin").length} />
          <Metric label="会话" value={overview?.active_session_count ?? 0} />
          <Metric label="启用模块" value={overview?.enabled_module_count ?? modules.filter((module) => module.enabled).length} />
        </div>}
        {section === "users" && <div className="admin-users-card">
          <label className="admin-search-field"><UserRound size={15} /><input value={query} aria-label="搜索用户" placeholder="搜索用户" onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="admin-user-table">{visibleUsers.length ? visibleUsers.map((user) => <div key={user.id} className="admin-user-row">
            <div className="admin-user-main"><span className="admin-user-avatar">{user.display_name?.[0] ?? user.username[0]}</span><div><strong>{user.display_name || user.username}</strong><small>{user.email}</small></div></div>
            <span>{user.message_count} 消息</span>
            <select value={user.role} aria-label={`设置角色：${user.display_name || user.username}`} disabled={(user.id === currentUser.id && user.role === "admin") || pendingAction === `user-role:${user.id}`} onChange={(event) => changeRole(user, event.target.value)}><option value="member">成员</option><option value="admin">管理员</option></select>
            <button className={`admin-filter-chip ${user.risk_flagged ? "active" : ""}`} type="button" disabled={pendingAction === `user-risk:${user.id}`} aria-pressed={user.risk_flagged} aria-label={`${user.risk_flagged ? "取消风险标记" : "标记风险"}：${user.display_name || user.username}`} onClick={() => toggleRisk(user)}>{pendingAction === `user-risk:${user.id}` ? "保存中" : user.risk_flagged ? "已标记" : "风险标记"}</button>
          </div>) : <EmptyState icon={<UserRound size={24} />} title={query ? "没有匹配的用户" : "暂无用户"} detail={query ? "调整搜索关键词后再试。" : "用户注册后会出现在这里。"} />}</div>
        </div>}
        {section === "modules" && <div className="admin-module-grid">{modules.length ? modules.map((module) => <article key={module.id} className={`admin-module-card ${module.enabled ? "" : "disabled"} ${pendingAction === `module:${module.id}` ? "saving" : ""}`}><div className="admin-module-card-head"><span className="admin-module-icon"><ShieldCheck size={17} /></span><div><h2>{module.name}</h2><p>{module.description}</p></div></div><button className={`admin-switch ${module.enabled ? "active" : ""} ${pendingAction === `module:${module.id}` ? "saving" : ""}`} disabled={module.locked || pendingAction === `module:${module.id}`} type="button" aria-pressed={module.enabled} aria-label={`${module.enabled ? "停用" : "启用"}模块：${module.name}`} onClick={() => toggleModule(module)}>{pendingAction === `module:${module.id}` ? <RefreshCw className="spin" size={22} /> : module.enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}</button></article>) : <EmptyState icon={<ShieldCheck size={24} />} title="暂无模块" detail="模块配置写入后会出现在这里。" />}</div>}
        {section === "mcp" && <div className="admin-module-grid">{mcpServers.length ? mcpServers.map((server) => <article key={server.id} className={`admin-module-card admin-mcp-card ${server.enabled ? "" : "disabled"} ${pendingAction === `mcp:${server.id}` ? "saving" : ""}`}><div className="admin-module-card-head"><span className="admin-module-icon"><ShieldCheck size={17} /></span><div><h2>{server.name}</h2><p>{server.description}</p><div className="admin-mcp-meta"><span>{server.transport}</span><span>{server.configured ? "环境就绪" : server.required_env}</span><span>{server.live_enabled ? "实时" : "计划"}</span></div></div></div><button className={`admin-switch ${server.enabled ? "active" : ""} ${pendingAction === `mcp:${server.id}` ? "saving" : ""}`} disabled={pendingAction === `mcp:${server.id}`} type="button" aria-pressed={server.enabled} aria-label={`${server.enabled ? "停用" : "启用"}MCP：${server.name}`} onClick={() => toggleMcpServer(server)}>{pendingAction === `mcp:${server.id}` ? <RefreshCw className="spin" size={22} /> : server.enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}</button></article>) : <EmptyState icon={<ShieldCheck size={24} />} title="暂无 MCP 服务" detail="可用 MCP 服务配置后会显示在这里。" />}</div>}
        {section === "agents" && <div className="admin-agent-grid">{agents.length ? agents.map((agent) => {
          const draft = agentDrafts[agent.id] ?? { prompt_version: agent.prompt_version, system_prompt: agent.system_prompt };
          const editing = editingAgentId === agent.id;
          return <article key={agent.id} className={`admin-module-card admin-agent-card ${pendingAction === `agent:${agent.id}` ? "saving" : ""}`}><div className="admin-module-card-head"><span className="admin-module-icon"><Bot size={17} /></span><div><h2>{agent.name}</h2><p>{agent.description}</p><div className="admin-mcp-meta"><span>{agent.role}</span><span>{agent.prompt_version}</span><span>{agent.prompt_checksum}</span></div></div></div>{editing ? <div className="admin-agent-editor"><label><span>提示词版本</span><input value={draft.prompt_version} aria-label={`${agent.name} 提示词版本`} disabled={pendingAction === `agent:${agent.id}`} onChange={(event) => updateAgentDraft(agent.id, "prompt_version", event.target.value)} /></label><label><span>系统提示词</span><textarea value={draft.system_prompt} rows={7} aria-label={`${agent.name} 系统提示词`} disabled={pendingAction === `agent:${agent.id}`} onChange={(event) => updateAgentDraft(agent.id, "system_prompt", event.target.value)} /></label><div className="admin-agent-actions"><button type="button" disabled={pendingAction === `agent:${agent.id}`} onClick={() => saveAgentPrompt(agent)}>{pendingAction === `agent:${agent.id}` ? "保存中" : "保存"}</button><button type="button" disabled={pendingAction === `agent:${agent.id}`} onClick={() => setEditingAgentId("")}>取消</button></div></div> : <div className="admin-agent-summary"><p>{agent.system_prompt}</p><button className="secondary-button" type="button" onClick={() => setEditingAgentId(agent.id)}>编辑提示词</button></div>}</article>;
        }) : <EmptyState icon={<Bot size={24} />} title="暂无 Agent" detail="Agent 蓝图创建后可在这里审阅和调整 Prompt。" />}</div>}
        {section === "audit" && (logs.length ? <ul className="admin-audit-list">{logs.map((log) => <li key={log.id}><strong>{log.action}</strong><span>{log.actor_name} · {log.target_type} · {log.detail}</span><small>{new Date(log.created_at).toLocaleString("zh-CN")}</small></li>)}</ul> : <EmptyState icon={<ShieldCheck size={24} />} title="暂无审计记录" detail="管理员操作发生后会记录在这里。" />)}
      </main>
    </section>
  );
}

function EmptyState(props: { icon: ReactNode; title: string; detail: string }) {
  return <div className="admin-empty-state compact" role="status" aria-live="polite">{props.icon}<strong>{props.title}</strong><span>{props.detail}</span></div>;
}

function Metric(props: { label: string; value: number }) {
  return <article className="admin-metric-card"><ShieldCheck size={18} /><span>{props.label}</span><strong>{props.value}</strong></article>;
}

function adminActionError(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

function sectionLabel(section: string) {
  return { overview: "概览", users: "用户", modules: "模块", mcp: "MCP", agents: "Agent", audit: "审计" }[section] ?? section;
}
