<template>
  <section class="admin-panel" :aria-label="copy.title">
    <aside class="admin-floating-nav" :aria-label="copy.navigation">
      <div class="admin-nav-brand">
        <ShieldCheck :size="22" />
        <div>
          <strong>{{ copy.title }}</strong>
          <span>{{ copy.console }}</span>
        </div>
      </div>
      <button
        v-for="item in navItems"
        :key="item.id"
        class="admin-nav-item"
        :class="{ active: activeSection === item.id }"
        type="button"
        @click="activeSection = item.id"
      >
        <component :is="item.icon" :size="18" />
        <span>{{ item.label }}</span>
      </button>
    </aside>

    <main class="admin-console">
      <div class="module-view-header admin-console-header">
        <div>
          <p class="eyebrow">Admin Console</p>
          <h1>{{ activeTitle }}</h1>
        </div>
        <button class="secondary-button" type="button" :disabled="refreshing" @click="refreshAll">
          <RefreshCw :size="16" />
          <span>{{ refreshing ? copy.loading : copy.refresh }}</span>
        </button>
      </div>

      <div v-if="!authToken" class="admin-empty-state">
        <UsersRound :size="34" />
        <strong>{{ copy.signInRequired }}</strong>
        <span>{{ copy.signInHint }}</span>
      </div>

      <template v-else>
        <p v-if="error" class="error-line inline">{{ error }}</p>

        <section v-if="activeSection === 'overview'" class="admin-overview-grid">
          <article v-for="metric in metrics" :key="metric.label" class="admin-metric-card">
            <component :is="metric.icon" :size="20" />
            <span>{{ metric.label }}</span>
            <strong>{{ metric.value }}</strong>
          </article>
          <article class="admin-insight-panel">
            <div>
              <p class="eyebrow">{{ copy.issues }}</p>
              <h2>{{ copy.issueTitle }}</h2>
            </div>
            <ul>
              <li v-for="issue in reviewIssues" :key="issue">{{ issue }}</li>
            </ul>
          </article>
        </section>

        <section v-else-if="activeSection === 'users'" class="admin-users-layout">
          <div class="admin-users-card">
            <div class="admin-users-toolbar">
              <label class="admin-search-field">
                <Search :size="16" />
                <input v-model="query" :placeholder="copy.searchPlaceholder" autocomplete="off" @input="scheduleLoad" />
              </label>
            </div>

            <div class="admin-user-table" role="table" :aria-label="copy.userTable">
              <div class="admin-user-row admin-user-head" role="row">
                <span role="columnheader">{{ copy.user }}</span>
                <span role="columnheader">{{ copy.role }}</span>
                <span role="columnheader">{{ copy.activity }}</span>
                <span role="columnheader">{{ copy.createdAt }}</span>
              </div>

              <button
                v-for="user in users"
                :key="user.id"
                class="admin-user-row"
                :class="{ active: selectedUser?.id === user.id }"
                type="button"
                role="row"
                @click="selectedUserId = user.id"
              >
                <div class="admin-user-main" role="cell">
                  <span class="admin-user-avatar">
                    <img v-if="resolveMediaUrl(user.avatar_url)" :src="resolveMediaUrl(user.avatar_url)" :alt="user.display_name" />
                    <b v-else>{{ avatarInitial(user) }}</b>
                  </span>
                  <div>
                    <strong>{{ user.display_name || user.username }}</strong>
                    <small>@{{ user.username }} · {{ user.email }}</small>
                  </div>
                </div>
                <span role="cell">{{ roleLabel(user.role) }}</span>
                <span role="cell">{{ copy.loginCount }} {{ user.login_count }}</span>
                <span role="cell">{{ formatDate(user.created_at) }}</span>
              </button>
            </div>

            <div v-if="!loading && users.length === 0" class="admin-empty-state compact">
              <UsersRound :size="28" />
              <strong>{{ copy.noUsers }}</strong>
            </div>
          </div>

          <aside class="admin-detail-panel">
            <template v-if="selectedUser">
              <div class="admin-detail-hero">
                <span class="admin-user-avatar large">
                  <img
                    v-if="resolveMediaUrl(selectedUser.avatar_url)"
                    :src="resolveMediaUrl(selectedUser.avatar_url)"
                    :alt="selectedUser.display_name"
                  />
                  <b v-else>{{ avatarInitial(selectedUser) }}</b>
                </span>
                <div>
                  <h2>{{ selectedUser.display_name || selectedUser.username }}</h2>
                  <span>@{{ selectedUser.username }}</span>
                </div>
              </div>

              <label class="admin-field">
                <span>{{ copy.role }}</span>
                <select
                  :value="selectedUser.role"
                  :disabled="savingUserId === selectedUser.id || selectedUser.id === currentUserId && selectedUser.role === 'admin'"
                  @change="changeRole(selectedUser, $event)"
                >
                  <option value="member">{{ copy.member }}</option>
                  <option value="admin">{{ copy.admin }}</option>
                </select>
              </label>

              <div class="admin-detail-grid">
                <span>{{ copy.email }}</span>
                <strong>{{ selectedUser.email }}</strong>
                <span>{{ copy.sessions }}</span>
                <strong>{{ selectedUser.session_count }}</strong>
                <span>{{ copy.messages }}</span>
                <strong>{{ selectedUser.message_count }}</strong>
                <span>{{ copy.friends }}</span>
                <strong>{{ selectedUser.friend_count }}</strong>
                <span>{{ copy.lastLogin }}</span>
                <strong>{{ formatDateTime(selectedUser.last_login_at) }}</strong>
                <span>{{ copy.updatedAt }}</span>
                <strong>{{ formatDateTime(selectedUser.updated_at) }}</strong>
              </div>
            </template>
            <div v-else class="admin-empty-state compact">
              <UserCog :size="28" />
              <strong>{{ copy.pickUser }}</strong>
            </div>
          </aside>
        </section>

        <section v-else-if="activeSection === 'modules'" class="admin-module-grid">
          <article v-for="module in modules" :key="module.id" class="admin-module-card" :class="{ disabled: !module.enabled }">
            <div class="admin-module-card-head">
              <span class="admin-module-icon">
                <component :is="moduleIcon(module.id)" :size="20" />
              </span>
              <span class="status-pill" :class="module.enabled ? 'online' : 'offline'">
                {{ module.enabled ? copy.enabled : copy.disabled }}
              </span>
            </div>
            <div>
              <h2>{{ moduleName(module.id, module.name) }}</h2>
              <p>{{ moduleDescription(module.id, module.description) }}</p>
            </div>
            <button
              class="admin-switch"
              :class="{ active: module.enabled }"
              type="button"
              :disabled="module.locked || savingModuleId === module.id"
              @click="toggleModule(module)"
            >
              <span>{{ module.locked ? copy.locked : module.enabled ? copy.unpublish : copy.publish }}</span>
              <i />
            </button>
          </article>
        </section>

        <section v-else class="admin-audit-panel">
          <article class="admin-insight-panel">
            <div>
              <p class="eyebrow">{{ copy.audit }}</p>
              <h2>{{ copy.auditTitle }}</h2>
            </div>
            <div v-if="!auditLogs.length" class="admin-empty-state compact">
              <ShieldCheck :size="28" />
              <strong>{{ copy.noAudit }}</strong>
            </div>
            <ul v-else class="admin-audit-list">
              <li v-for="log in auditLogs" :key="log.id">
                <strong>{{ auditActionLabel(log.action) }}</strong>
                <span>{{ log.actor_name }} · {{ log.target_type }} · {{ log.target_id }}</span>
                <small>{{ log.detail || "-" }} · {{ formatDateTime(log.created_at) }}</small>
              </li>
            </ul>
          </article>
        </section>
      </template>
    </main>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  Blocks,
  ChartNoAxesCombined,
  Globe2,
  Image,
  LayoutDashboard,
  MessageSquareText,
  NotebookPen,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  ToggleLeft,
  UserCog,
  UsersRound,
  Workflow,
} from "lucide-vue-next";

import {
  fetchAdminModules,
  fetchAdminAuditLogs,
  fetchAdminOverview,
  fetchAdminUsers,
  resolveMediaUrl,
  updateAdminModule,
  updateAdminUserRole,
} from "../services/api";
import type { AdminAuditLog, AdminOverview, AdminUser } from "../types/auth";
import type { AdminModule } from "../types/platform";

type AdminSection = "overview" | "users" | "modules" | "audit";

const props = defineProps<{
  authToken: string;
  currentUserId?: string;
  language: "zh-CN" | "en-US";
}>();

const users = ref<AdminUser[]>([]);
const modules = ref<AdminModule[]>([]);
const auditLogs = ref<AdminAuditLog[]>([]);
const overview = ref<AdminOverview | null>(null);
const query = ref("");
const loading = ref(false);
const refreshing = ref(false);
const error = ref("");
const savingUserId = ref("");
const savingModuleId = ref("");
const selectedUserId = ref("");
const activeSection = ref<AdminSection>("overview");
let loadTimer = 0;

const copy = computed(() =>
  props.language === "en-US"
    ? {
        title: "Admin",
        console: "System console",
        navigation: "Admin navigation",
        overview: "Overview",
        users: "Users",
        modules: "Modules",
        audit: "Audit",
        signInRequired: "Sign in required",
        signInHint: "Sign in before managing platform users.",
        searchPlaceholder: "Search username, email, or display name",
        loading: "Loading",
        refresh: "Refresh",
        userTable: "User management",
        user: "User",
        email: "Email",
        role: "Role",
        activity: "Activity",
        createdAt: "Created",
        updatedAt: "Updated",
        member: "Member",
        admin: "Admin",
        noUsers: "No users found",
        pickUser: "Pick a user to inspect",
        loginCount: "Logins",
        sessions: "Sessions",
        messages: "Messages",
        friends: "Friends",
        lastLogin: "Last login",
        enabled: "Online",
        disabled: "Offline",
        publish: "Publish",
        unpublish: "Unpublish",
        locked: "Locked",
        issues: "Self review",
        issueTitle: "Next control points",
        totalUsers: "Users",
        admins: "Admins",
        activeSessions: "Sessions",
        directMessages: "Messages",
        enabledModules: "Online modules",
        disabledModules: "Offline modules",
        auditTitle: "Recent actions",
        noAudit: "No audit logs yet",
      }
    : {
        title: "管理员端",
        console: "系统控制台",
        navigation: "管理员导航",
        overview: "总览",
        users: "用户管理",
        modules: "模块管理",
        audit: "审计",
        signInRequired: "需要登录",
        signInHint: "登录后才能管理平台用户。",
        searchPlaceholder: "搜索用户名、邮箱或昵称",
        loading: "加载中",
        refresh: "刷新",
        userTable: "用户管理",
        user: "用户",
        email: "邮箱",
        role: "角色",
        activity: "活跃",
        createdAt: "创建时间",
        updatedAt: "更新时间",
        member: "普通用户",
        admin: "管理员",
        noUsers: "没有找到用户",
        pickUser: "选择一个用户查看详情",
        loginCount: "登录",
        sessions: "会话数",
        messages: "消息数",
        friends: "好友数",
        lastLogin: "最近登录",
        enabled: "已上架",
        disabled: "已下架",
        publish: "上架",
        unpublish: "下架",
        locked: "锁定",
        issues: "自我 Review",
        issueTitle: "下一批控制点",
        totalUsers: "用户",
        admins: "管理员",
        activeSessions: "登录会话",
        directMessages: "私信消息",
        enabledModules: "上架模块",
        disabledModules: "下架模块",
        auditTitle: "最近操作",
        noAudit: "暂无审计记录",
      },
);

const navItems = computed(() => [
  { id: "overview" as const, label: copy.value.overview, icon: ChartNoAxesCombined },
  { id: "users" as const, label: copy.value.users, icon: UsersRound },
  { id: "modules" as const, label: copy.value.modules, icon: ToggleLeft },
  { id: "audit" as const, label: copy.value.audit, icon: ShieldCheck },
]);

const activeTitle = computed(() => navItems.value.find((item) => item.id === activeSection.value)?.label ?? copy.value.title);

const selectedUser = computed(() => {
  if (!users.value.length) {
    return null;
  }
  return users.value.find((user) => user.id === selectedUserId.value) ?? users.value[0];
});

const metrics = computed(() => [
  { label: copy.value.totalUsers, value: overview.value?.user_count ?? users.value.length, icon: UsersRound },
  { label: copy.value.admins, value: overview.value?.admin_count ?? users.value.filter((user) => user.role === "admin").length, icon: ShieldCheck },
  { label: copy.value.activeSessions, value: overview.value?.active_session_count ?? 0, icon: UserCog },
  { label: copy.value.directMessages, value: overview.value?.direct_message_count ?? 0, icon: MessageSquareText },
  { label: copy.value.enabledModules, value: overview.value?.enabled_module_count ?? modules.value.filter((module) => module.enabled).length, icon: ToggleLeft },
  { label: copy.value.disabledModules, value: overview.value?.disabled_module_count ?? modules.value.filter((module) => !module.enabled).length, icon: Blocks },
]);

const reviewIssues = computed(() =>
  props.language === "en-US"
    ? [
        "Module publishing is now persistent, but audit logs should be added next.",
        "User details now expose activity metrics; account lock and password reset controls remain future work.",
        "Admin is locked online to prevent accidentally hiding the console.",
      ]
    : [
        "模块上下架已经持久化，下一步应该补审计日志。",
        "用户详情已经有活跃指标，后续还可以加封禁、重置密码和风险标记。",
        "管理员端和首页被锁定上架，避免误操作把控制台隐藏。",
      ],
);

onMounted(() => {
  void refreshAll();
});

watch(
  () => props.authToken,
  () => {
    void refreshAll();
  },
);

async function refreshAll() {
  window.clearTimeout(loadTimer);
  if (!props.authToken) {
    users.value = [];
    modules.value = [];
    auditLogs.value = [];
    overview.value = null;
    return;
  }
  refreshing.value = true;
  loading.value = true;
  error.value = "";
  try {
    const [nextOverview, nextUsers, nextModules] = await Promise.all([
      fetchAdminOverview(props.authToken),
      fetchAdminUsers(props.authToken, query.value),
      fetchAdminModules(props.authToken),
    ]);
    const nextAuditLogs = await fetchAdminAuditLogs(props.authToken);
    overview.value = nextOverview;
    users.value = nextUsers;
    modules.value = nextModules;
    auditLogs.value = nextAuditLogs;
    if (!selectedUserId.value && nextUsers.length) {
      selectedUserId.value = nextUsers[0].id;
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to load admin console.";
  } finally {
    refreshing.value = false;
    loading.value = false;
  }
}

async function loadUsers() {
  window.clearTimeout(loadTimer);
  if (!props.authToken) {
    users.value = [];
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    users.value = await fetchAdminUsers(props.authToken, query.value);
    if (!selectedUser.value && users.value.length) {
      selectedUserId.value = users.value[0].id;
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to load users.";
  } finally {
    loading.value = false;
  }
}

function scheduleLoad() {
  window.clearTimeout(loadTimer);
  loadTimer = window.setTimeout(() => {
    void loadUsers();
  }, 260);
}

async function changeRole(user: AdminUser, event: Event) {
  const role = (event.target as HTMLSelectElement).value;
  if (role === user.role) {
    return;
  }
  if (user.id === props.currentUserId && role !== "admin") {
    error.value = props.language === "en-US" ? "You cannot remove your own admin role." : "不能移除自己的管理员权限。";
    (event.target as HTMLSelectElement).value = user.role;
    return;
  }
  savingUserId.value = user.id;
  error.value = "";
  try {
    const updated = await updateAdminUserRole(props.authToken, user.id, role);
    users.value = users.value.map((item) => (item.id === updated.id ? { ...item, ...updated } : item));
    await loadOverview();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to update role.";
    (event.target as HTMLSelectElement).value = user.role;
  } finally {
    savingUserId.value = "";
  }
}

async function toggleModule(module: AdminModule) {
  if (module.locked) {
    return;
  }
  savingModuleId.value = module.id;
  error.value = "";
  try {
    const updated = await updateAdminModule(props.authToken, module.id, !module.enabled);
    modules.value = modules.value.map((item) => (item.id === updated.id ? updated : item));
    await loadOverview();
    auditLogs.value = await fetchAdminAuditLogs(props.authToken);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to update module.";
  } finally {
    savingModuleId.value = "";
  }
}

async function loadOverview() {
  if (!props.authToken) {
    return;
  }
  overview.value = await fetchAdminOverview(props.authToken);
  auditLogs.value = await fetchAdminAuditLogs(props.authToken);
}

function avatarInitial(user: AdminUser) {
  return (user.display_name || user.username || "?").slice(0, 1).toUpperCase();
}

function roleLabel(role: string) {
  return role === "admin" ? copy.value.admin : copy.value.member;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(props.language === "en-US" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat(props.language === "en-US" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function moduleIcon(moduleId: string) {
  const icons = {
    dashboard: LayoutDashboard,
    chat: MessageSquareText,
    "image-generation": Image,
    "provider-hub": PlugZap,
    notes: NotebookPen,
    "memory-map": Globe2,
    workflow: Workflow,
    admin: ShieldCheck,
  };
  return icons[moduleId as keyof typeof icons] ?? Blocks;
}

function moduleName(moduleId: string, fallback: string) {
  const labels = {
    dashboard: ["见微知著", "Insight"],
    chat: ["交耳", "Chat"],
    "image-generation": ["虚实", "Image"],
    "provider-hub": ["聚合", "Aggregation"],
    notes: ["笔记", "Notes"],
    "memory-map": ["地图纪念", "Memory Map"],
    workflow: ["秩序", "Automation"],
    admin: ["管理员端", "Admin"],
  };
  const pair = labels[moduleId as keyof typeof labels];
  return pair ? pair[props.language === "en-US" ? 1 : 0] : fallback;
}

function moduleDescription(moduleId: string, fallback: string) {
  if (props.language !== "en-US") {
    return fallback;
  }
  const descriptions = {
    dashboard: "View modules, API health, and extension entry points.",
    chat: "A conversational module connected to aggregated model providers.",
    "image-generation": "Text-to-image generation with aggregated model configuration.",
    "provider-hub": "Manage providers, API keys, and default models in one place.",
    notes: "Markdown writing, draft storage, and live rendering.",
    "memory-map": "Record places, time, and memories on a 3D world map.",
    workflow: "Orchestrate workflows, task nodes, and triggers.",
    admin: "Manage users, roles, and platform operations.",
  };
  return descriptions[moduleId as keyof typeof descriptions] ?? fallback;
}

function auditActionLabel(action: string) {
  const labels = {
    "user.role.update": props.language === "en-US" ? "Role updated" : "角色更新",
    "module.status.update": props.language === "en-US" ? "Module changed" : "模块变更",
  };
  return labels[action as keyof typeof labels] ?? action;
}
</script>
