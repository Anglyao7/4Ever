<template>
  <div class="app-shell" :class="{ 'intro-finished': introFinished }" :style="temperatureStyle">
    <Transition name="intro-fade">
      <section v-if="showIntro" class="intro-stage" aria-label="启动动画">
        <div class="intro-noise" aria-hidden="true" />
        <div class="intro-grid" aria-hidden="true">
          <span v-for="index in 64" :key="index" />
        </div>
        <div class="intro-thread" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div class="intro-core">
          <div class="intro-mark">
            <span class="intro-mark-ring" aria-hidden="true" />
            <Layers3 :size="34" />
          </div>
          <div class="intro-title">
            <span>4Ever</span>
            <strong>AI Aggregation OS</strong>
          </div>
          <div class="intro-chips" aria-hidden="true">
            <span>Chat</span>
            <span>Image</span>
            <span>Notes</span>
          </div>
          <div class="intro-meter" aria-hidden="true"><i /></div>
          <div class="intro-lines" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
      </section>
    </Transition>

    <section v-if="introFinished && routeId === 'home'" class="landing-page" aria-label="平台主页">
      <div class="landing-auth">
        <template v-if="currentUser">
          <button class="secondary-button" type="button" @click="openModule('admin')">
            <UserRound :size="16" />
            <span>{{ dashboardDisplayName }}</span>
          </button>
          <button class="secondary-button danger" type="button" @click="signOut">
            <LogOut :size="16" />
            <span>{{ uiText.signOut }}</span>
          </button>
        </template>
        <template v-else>
          <button class="secondary-button" type="button" @click="openAuth('sign-in')">{{ uiText.signIn }}</button>
          <button class="primary-action compact" type="button" @click="openAuth('sign-up')">{{ uiText.signUp }}</button>
        </template>
      </div>
      <main class="landing-hero">
        <div class="landing-field" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>

        <div class="landing-orbit" aria-hidden="true">
          <span class="orbit-ring ring-one" />
          <span class="orbit-ring ring-two" />
          <span class="orbit-ring ring-three" />
          <span class="orbit-ring ring-four" />
          <span class="orbit-signal signal-one" />
          <span class="orbit-signal signal-two" />
          <span class="orbit-signal signal-three" />
          <span class="orbit-node orbit-chat">
            <MessageSquareText :size="18" />
          </span>
          <span class="orbit-node orbit-image">
            <Image :size="18" />
          </span>
          <span class="orbit-node orbit-provider">
            <PlugZap :size="18" />
          </span>
          <span class="orbit-node orbit-admin">
            <Shield :size="18" />
          </span>
        </div>

        <div class="landing-copy">
          <p class="eyebrow">AI Aggregation OS</p>
          <h1 class="landing-title">
            <span>ForEver</span>
            <span class="type-dots" aria-hidden="true">
              <i>.</i>
              <i>.</i>
              <i>.</i>
            </span>
          </h1>
          <p>{{ uiText.landingQuote }}</p>
          <button class="landing-cta" type="button" @click="enterWorkspace">
            <span>{{ uiText.enter }}</span>
            <ArrowRight :size="19" />
          </button>
        </div>
      </main>
    </section>

    <AuthPage
      v-if="introFinished && isAuthRoute"
      :mode="authMode"
      :loading="authLoading"
      :error="authError"
      @sign-in="handleSignIn"
      @sign-up="handleSignUp"
      @switch-mode="openAuth"
      @home="goHome"
    />

    <template v-if="introFinished && routeId !== 'home' && !isAuthRoute">
      <header class="topbar module-topbar">
        <button class="topbar-brand" type="button" :title="uiText.backHome" @click="activeModuleId === 'dashboard' ? goHome() : openModule('dashboard')">
          <strong>ForEver</strong>
          <span>{{ displayModuleName(activeModuleId) }}</span>
        </button>

        <nav class="topbar-actions" :aria-label="uiText.pageNav">
          <button
            v-if="activeModuleId !== 'dashboard'"
            class="secondary-button module-return-button"
            type="button"
            :title="uiText.backInsight"
            @click="openModule('dashboard')"
          >
            <ArrowLeft :size="17" />
            <span>{{ displayModuleName('dashboard') }}</span>
          </button>

          <div class="user-menu" @click.stop>
            <button
              class="user-menu-trigger"
              type="button"
              aria-haspopup="menu"
              :aria-expanded="userMenuOpen"
              @click.stop="toggleUserMenu"
            >
              <span class="user-avatar">{{ userInitials }}</span>
              <span class="user-menu-name">{{ dashboardDisplayName }}</span>
              <ChevronDown :size="16" />
            </button>

            <div v-if="userMenuOpen" class="user-dropdown" role="menu">
              <div class="user-dropdown-head">
                <span class="user-avatar large">{{ userInitials }}</span>
                <div>
                  <strong>{{ dashboardDisplayName }}</strong>
                  <small>{{ currentUser?.email ?? uiText.notSignedIn }}</small>
                  <em>{{ currentStatusDisplay }}</em>
                </div>
              </div>

              <div class="user-menu-section">
                <div class="user-menu-label">
                  <Languages :size="15" />
                  <span>{{ uiText.language }}</span>
                </div>
                <div class="segmented-options">
                  <button type="button" :class="{ active: uiLanguage === 'zh-CN' }" @click="setLanguage('zh-CN')">中文</button>
                  <button type="button" :class="{ active: uiLanguage === 'en-US' }" @click="setLanguage('en-US')">EN</button>
                </div>
              </div>

              <div class="user-menu-section">
                <div class="user-menu-label">
                  <Sun :size="15" />
                  <span>{{ uiText.displayMode }}</span>
                </div>
                <div class="segmented-options three">
                  <button type="button" :class="{ active: colorMode === 'light' }" @click="setColorMode('light')">{{ uiText.light }}</button>
                  <button type="button" :class="{ active: colorMode === 'dark' }" @click="setColorMode('dark')">{{ uiText.dark }}</button>
                  <button type="button" :class="{ active: colorMode === 'system' }" @click="setColorMode('system')">{{ uiText.system }}</button>
                </div>
                <label class="temperature-control">
                  <span>
                    <i>{{ uiText.cool }}</i>
                    <strong>{{ uiText.temperature }}</strong>
                    <i>{{ uiText.warm }}</i>
                  </span>
                  <input v-model.number="colorTemperature" type="range" min="-100" max="100" step="1" />
                </label>
              </div>

              <div class="user-menu-section">
                <div class="user-menu-label">
                  <CircleDot :size="15" />
                  <span>{{ uiText.statusCurrent }}</span>
                </div>
                <button class="status-open-button" type="button" @click="openStatusBox">
                  <span>{{ currentStatusDisplay }}</span>
                </button>
              </div>

              <label class="user-toggle-row">
                <span>
                  <Wifi :size="15" />
                  {{ uiText.online }}
                </span>
                <input v-model="userOnline" type="checkbox" />
              </label>

              <button class="user-menu-action" type="button" @click="openPreferences">
                <Settings :size="16" />
                <span>{{ uiText.preferences }}</span>
              </button>
              <button v-if="currentUser" class="user-menu-action danger" type="button" @click="signOutFromMenu">
                <LogOut :size="16" />
                <span>{{ uiText.signOut }}</span>
              </button>
              <button v-else class="user-menu-action" type="button" @click="openAuth('sign-in')">
                <UserRound :size="16" />
                <span>{{ uiText.signIn }}</span>
              </button>
            </div>

            <div v-if="statusBoxOpen" class="status-box" role="dialog" :aria-label="uiText.status" @click.stop>
              <div class="status-box-head">
                <div>
                  <p class="eyebrow">{{ uiText.status }}</p>
                  <h2>{{ draftStatusIcon }} {{ draftStatusText || uiText.statusPlaceholder }}</h2>
                </div>
                <button class="icon-button ghost" type="button" :title="uiText.statusCancel" @click="cancelStatusBox">
                  <ArrowLeft :size="17" />
                </button>
              </div>

              <div class="status-icon-grid" :aria-label="uiText.statusIconAria">
                <button
                  v-for="option in statusOptions"
                  :key="option.icon"
                  type="button"
                  class="status-icon-option"
                  :class="{ active: draftStatusIcon === option.icon }"
                  :title="statusOptionLabel(option)"
                  @click="selectDraftStatusOption(option)"
                >
                  <span aria-hidden="true">{{ option.icon }}</span>
                  <small>{{ statusOptionLabel(option) }}</small>
                </button>
              </div>

              <label class="status-text-field">
                <span>{{ uiText.status }}</span>
                <input
                  v-model.trim="draftStatusText"
                  class="status-text-input"
                  type="text"
                  maxlength="18"
                  :placeholder="uiText.statusPlaceholder"
                />
              </label>

              <div class="status-duration-group">
                <div class="user-menu-label">
                  <CircleDot :size="15" />
                  <span>{{ uiText.statusDuration }}</span>
                </div>
                <div class="status-duration-grid" :aria-label="uiText.statusDurationAria">
                  <button
                    v-for="option in statusDurationOptions"
                    :key="option.value"
                    type="button"
                    :class="{ active: draftStatusDuration === option.value }"
                    @click="draftStatusDuration = option.value"
                  >
                    {{ statusDurationLabel(option) }}
                  </button>
                </div>
              </div>

              <div class="status-box-actions">
                <button class="secondary-button" type="button" @click="cancelStatusBox">{{ uiText.statusCancel }}</button>
                <button class="primary-action compact" type="button" @click="confirmStatusBox">{{ uiText.statusConfirm }}</button>
              </div>
            </div>
          </div>
        </nav>
      </header>

      <main class="module-page" :class="modulePageClass">
        <ModuleDashboard
          v-if="activeModuleId === 'dashboard'"
          :modules="modules"
          :backend-online="backendOnline"
          :display-name="dashboardDisplayName"
          :language="uiLanguage"
          @open="openModule"
        />

        <section v-else-if="activeModuleId === 'chat'" class="chat-page telegram-chat-page" :aria-label="displayModuleName('chat')">
          <div class="telegram-shell" :data-mobile-view="mobileChatView">
            <aside class="telegram-sidebar" :aria-label="uiText.recentChats">
              <div class="telegram-sidebar-header">
                <div>
                  <p class="eyebrow">Chat</p>
                  <h1>{{ displayModuleName('chat') }}</h1>
                </div>
                <button class="icon-button ghost" type="button" :title="displayModuleName('provider-hub')" @click="openModule('provider-hub')">
                  <PlugZap :size="18" />
                </button>
              </div>

              <label class="telegram-search">
                <Search :size="16" />
                <input type="search" :placeholder="uiText.search" autocomplete="off" />
              </label>

              <div class="telegram-thread-list">
                <button
                  v-for="thread in chatThreads"
                  :key="thread.id"
                  class="telegram-thread"
                  :class="{ active: activeChatThreadId === thread.id }"
                  type="button"
                  @click="selectChatThread(thread.id)"
                >
                  <span class="thread-avatar" :class="`thread-avatar-${thread.tone}`">
                    <UsersRound v-if="thread.type === 'group'" :size="18" />
                    <UserRound v-else :size="18" />
                  </span>
                  <span class="thread-main">
                    <strong>{{ thread.name }}</strong>
                    <small>{{ thread.subtitle }}</small>
                  </span>
                  <span class="thread-meta">
                    <time>{{ thread.time }}</time>
                    <i v-if="thread.unread">{{ thread.unread }}</i>
                  </span>
                </button>
              </div>
            </aside>

            <section class="telegram-chat-surface" :aria-label="activeChatThread.name">
              <div class="phone-topbar telegram-conversation-topbar">
                <div class="phone-person">
                  <button class="icon-button ghost mobile-thread-back" type="button" :title="uiText.recentChats" @click="mobileChatView = 'list'">
                    <ArrowLeft :size="18" />
                  </button>
                  <span class="phone-avatar">
                    <UsersRound v-if="activeChatThread.type === 'group'" :size="17" />
                    <UserRound v-else :size="17" />
                  </span>
                  <div>
                    <p>{{ activeChatThread.name }}</p>
                    <span>{{ activeChatThread.detail }}</span>
                  </div>
                </div>

                <div class="phone-tools">
                  <button class="icon-button ghost" type="button" :title="uiText.clearChat" @click="clearActiveThreadMessages">
                    <Trash2 :size="18" />
                  </button>
                  <button class="icon-button ghost" type="button" :title="displayModuleName('provider-hub')" @click="openModule('provider-hub')">
                    <PlugZap :size="18" />
                  </button>
                </div>
              </div>

              <ChatPanel
                class="phone-chat-panel telegram-chat-panel"
                :messages="activeChatMessages"
                :loading="loading"
                :error="error"
                :language="uiLanguage"
                @send="handleThreadSend"
                @clear="clearActiveThreadMessages"
              />
            </section>
          </div>
        </section>

        <ImageGenerationPanel
          v-else-if="activeModuleId === 'image-generation'"
          :backend-online="backendOnline"
          :profiles="modelProfiles"
          :language="uiLanguage"
        />

        <ModelHubPanel
          v-else-if="activeModuleId === 'provider-hub'"
          :profiles="modelProfiles"
          :active-profile-id="activeModelProfileId"
          :providers="providers"
          :current-config="config"
          :language="uiLanguage"
          @save="saveModelProfile"
          @select="selectModelProfile"
          @delete="deleteModelProfile"
        />

        <NotesPanel
          v-else-if="activeModuleId === 'notes'"
          :language="uiLanguage"
        />

        <SelfPanel
          v-else-if="activeModuleId === 'admin'"
          :user="currentUser"
          :auth-token="authToken"
          :language="uiLanguage"
          @open-auth="openAuth"
          @sign-out="signOut"
          @user-updated="handleUserUpdated"
        />

        <section v-else class="placeholder-panel module-page-placeholder" :aria-label="displayModuleName(activeModuleId)">
          <div class="module-view-header">
            <div>
              <p class="eyebrow">{{ moduleEnglishName(activeModuleId) }}</p>
              <h1>{{ displayModuleName(activeModuleId) }}</h1>
            </div>
            <button class="secondary-button" type="button" @click="openModule('dashboard')">
              <LayoutDashboard :size="17" />
              <span>{{ displayModuleName('dashboard') }}</span>
            </button>
          </div>
          <div class="placeholder-body">
            <component :is="moduleIcon(activeModuleId)" :size="42" />
            <h2>{{ displayModuleDescription(activeModuleId) }}</h2>
          </div>
        </section>
      </main>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  ChevronDown,
  CircleDot,
  Image,
  LayoutDashboard,
  Layers3,
  LogOut,
  MessageSquareText,
  NotebookPen,
  PlugZap,
  Search,
  Settings,
  Shield,
  Sun,
  Trash2,
  UserRound,
  UsersRound,
  Languages,
  Wifi,
  Workflow,
} from "lucide-vue-next";

import ChatPanel from "../components/ChatPanel.vue";
import AuthPage from "../components/AuthPage.vue";
import ImageGenerationPanel from "../components/ImageGenerationPanel.vue";
import ModelHubPanel from "../components/ModelHubPanel.vue";
import ModuleDashboard from "../components/ModuleDashboard.vue";
import NotesPanel from "../components/NotesPanel.vue";
import SelfPanel from "../components/SelfPanel.vue";
import { fetchCurrentUser, fetchHealth, fetchModules, fetchProviders, sendChat, signIn, signUp } from "../services/api";
import type { AuthUser, SignInPayload, SignUpPayload } from "../types/auth";
import type { ChatConfig, ChatMessage, ModelProfile, ProviderInfo } from "../types/chat";
import type { PlatformModule } from "../types/platform";

const storageKey = "4ever.chat.config";
const messagesKey = "4ever.chat.messages";
const modelProfilesKey = "4ever.model.profiles";
const activeModelProfileKey = "4ever.model.activeProfile";
const authTokenKey = "4ever.auth.token";
const authUserKey = "4ever.auth.user";
const uiLanguageKey = "4ever.ui.language";
const colorModeKey = "4ever.ui.colorMode";
const colorTemperatureKey = "4ever.ui.colorTemperature";
const userStatusIconKey = "4ever.user.status.icon";
const userStatusTextKey = "4ever.user.status.text";
const userStatusExpireAtKey = "4ever.user.status.expireAt";
const userOnlineKey = "4ever.user.online";

type UiLanguage = "zh-CN" | "en-US";
type ColorMode = "light" | "dark" | "system";
type StatusOption = {
  icon: string;
  label: string;
  text: string;
  labelEn: string;
  textEn: string;
};
type StatusDuration = "hour" | "four-hours" | "today" | "day" | "never";
type StatusDurationOption = {
  value: StatusDuration;
  label: string;
  labelEn: string;
};

type ChatThread = {
  id: string;
  type: "contact" | "group";
  name: string;
  subtitle: string;
  detail: string;
  time: string;
  tone: "ink" | "green" | "blue" | "clay";
  unread?: number;
};

const moduleRoutes = {
  dashboard: "insight",
  chat: "chat",
  "image-generation": "image",
  "provider-hub": "aggregation",
  notes: "notes",
  workflow: "automation",
  admin: "self",
} as const;

const routeModules = Object.fromEntries(
  Object.entries(moduleRoutes).map(([moduleId, route]) => [route, moduleId]),
) as Record<string, string>;

const statusOptions: StatusOption[] = [
  { icon: "🌴", label: "度假", text: "在路上", labelEn: "Travel", textEn: "On the road" },
  { icon: "💻", label: "工作", text: "在工作", labelEn: "Work", textEn: "Working" },
  { icon: "🍢", label: "美食", text: "觅食中", labelEn: "Food", textEn: "Finding food" },
  { icon: "☕", label: "休息", text: "慢慢来", labelEn: "Break", textEn: "Taking it slow" },
  { icon: "📚", label: "学习", text: "读点东西", labelEn: "Study", textEn: "Reading" },
  { icon: "✨", label: "随想", text: "有点灵感", labelEn: "Ideas", textEn: "Catching ideas" },
];

const statusDurationOptions: StatusDurationOption[] = [
  { value: "hour", label: "1 小时", labelEn: "1 hour" },
  { value: "four-hours", label: "4 小时", labelEn: "4 hours" },
  { value: "today", label: "到今天结束", labelEn: "Until tonight" },
  { value: "day", label: "1 天", labelEn: "1 day" },
  { value: "never", label: "不自动过期", labelEn: "No expiry" },
];

const uiCopies = {
  "zh-CN": {
    signIn: "登录",
    signUp: "注册",
    signOut: "退出登录",
    landingQuote: "你眼中的别人，才是真实的你。",
    enter: "进入",
    backHome: "返回主页",
    backInsight: "返回见微知著",
    pageNav: "页面导航",
    notSignedIn: "未登录",
    language: "切换语言",
    displayMode: "显示模式",
    light: "白天",
    dark: "黑夜",
    system: "系统",
    temperature: "冷暖色",
    cool: "冷",
    warm: "暖",
    status: "设置状态",
    statusFallback: "设置状态",
    statusUnset: "未设置状态",
    statusCurrent: "当前状态",
    statusIconAria: "选择状态图标",
    statusPlaceholder: "写一句当前状态",
    statusDuration: "状态时长",
    statusDurationAria: "选择状态时长",
    statusConfirm: "确认",
    statusCancel: "取消",
    online: "是否在线",
    preferences: "偏好设置",
    recentChats: "最近会话",
    search: "搜索",
    clearChat: "清空对话",
    moduleUnavailable: "模块暂不可用。",
  },
  "en-US": {
    signIn: "Sign in",
    signUp: "Sign up",
    signOut: "Sign out",
    landingQuote: "The self you reveal through others is the real you.",
    enter: "Enter",
    backHome: "Back home",
    backInsight: "Back to Insight",
    pageNav: "Page navigation",
    notSignedIn: "Not signed in",
    language: "Language",
    displayMode: "Display mode",
    light: "Light",
    dark: "Dark",
    system: "System",
    temperature: "Temperature",
    cool: "Cool",
    warm: "Warm",
    status: "Status",
    statusFallback: "Set status",
    statusUnset: "No status set",
    statusCurrent: "Current status",
    statusIconAria: "Choose a status icon",
    statusPlaceholder: "Write your status",
    statusDuration: "Duration",
    statusDurationAria: "Choose status duration",
    statusConfirm: "Confirm",
    statusCancel: "Cancel",
    online: "Online",
    preferences: "Preferences",
    recentChats: "Recent chats",
    search: "Search",
    clearChat: "Clear chat",
    moduleUnavailable: "This module is not available yet.",
  },
} satisfies Record<UiLanguage, Record<string, string>>;

const localizedModules: Record<string, { zh: [string, string]; en: [string, string] }> = {
  dashboard: {
    zh: ["见微知著", "查看平台模块、接口状态和扩展入口。"],
    en: ["Insight", "View modules, API health, and extension entry points."],
  },
  chat: {
    zh: ["交耳", "兼容 OpenAI、Anthropic、Gemini 格式的对话模块。"],
    en: ["Chat", "A conversational module connected to aggregated model providers."],
  },
  "image-generation": {
    zh: ["虚实", "文本生图、多模型聚合和生成记录能力。"],
    en: ["Image", "Text-to-image generation with aggregated model configuration."],
  },
  "provider-hub": {
    zh: ["聚合", "统一管理模型供应商、密钥和默认模型。"],
    en: ["Aggregation", "Manage providers, API keys, and default models in one place."],
  },
  notes: {
    zh: ["笔记", "Markdown 写作、笔记暂存和实时渲染。"],
    en: ["Notes", "Markdown writing, draft storage, and live rendering."],
  },
  workflow: {
    zh: ["秩序", "自动化流程、任务节点和触发器。"],
    en: ["Automation", "Orchestrate workflows, task nodes, and triggers."],
  },
  admin: {
    zh: ["自我", "个人简介、日记和账户安全。"],
    en: ["Self", "Profile, private diary, and account security."],
  },
};

const defaultConfig: ChatConfig = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4.1-mini",
  systemPrompt: "你是一个简洁、可靠的 AI 助手。",
  temperature: 0.7,
  maxTokens: 1024,
};

const initialRouteId = readRoute();
const routeId = ref(initialRouteId);
const showIntro = ref(true);
const introFinished = ref(false);
const modules = ref<PlatformModule[]>(fallbackModules());
const config = ref<ChatConfig>(loadConfig());
const messages = ref<ChatMessage[]>(loadMessages());
const providers = ref<ProviderInfo[]>(fallbackProviders());
const modelProfiles = ref<ModelProfile[]>(loadModelProfiles());
const activeModelProfileId = ref(localStorage.getItem(activeModelProfileKey) ?? "");
const authToken = ref(localStorage.getItem(authTokenKey) ?? "");
const currentUser = ref<AuthUser | null>(loadStoredUser());
const authMode = ref<"sign-in" | "sign-up">(initialRouteId === "sign-up" ? "sign-up" : "sign-in");
const authLoading = ref(false);
const authError = ref("");
const userMenuOpen = ref(false);
const statusBoxOpen = ref(false);
const uiLanguage = ref<UiLanguage>(loadPreference<UiLanguage>(uiLanguageKey, "zh-CN"));
const colorMode = ref<ColorMode>(loadPreference<ColorMode>(colorModeKey, "system"));
const colorTemperature = ref(clampNumber(loadNumberPreference(colorTemperatureKey, 0), -100, 100));
const userStatusIcon = ref(loadPreference(userStatusIconKey, statusOptions[1].icon));
const userStatusText = ref(loadPreference(userStatusTextKey, statusOptions[1].text));
const userStatusExpireAt = ref(loadNumberPreference(userStatusExpireAtKey, 0));
const draftStatusIcon = ref(userStatusIcon.value);
const draftStatusText = ref(userStatusText.value);
const draftStatusDuration = ref<StatusDuration>("day");
const userOnline = ref(loadBooleanPreference(userOnlineKey, true));
const backendOnline = ref(false);
const loading = ref(false);
const error = ref("");
let errorTimer: number | undefined;
let statusExpiryTimer: number | undefined;
const currentTime = ref(Date.now());
const activeChatThreadId = ref("assistant");
const mobileChatView = ref<"list" | "conversation">("list");
const threadMessages = ref<Record<string, ChatMessage[]>>(createThreadMessageSamples());

const activeModuleId = computed(() => (routeId.value === "home" ? "dashboard" : routeId.value));
const activeModule = computed(() => modules.value.find((module) => module.id === activeModuleId.value));
const modulePageClass = computed(() => `module-page-${activeModuleId.value}`);
const isAuthRoute = computed(() => routeId.value === "sign-in" || routeId.value === "sign-up");
const dashboardDisplayName = computed(() => currentUser.value?.display_name || currentUser.value?.username || "访客");
const userInitials = computed(() => firstAvatarLetter(dashboardDisplayName.value));
const uiText = computed(() => uiCopies[uiLanguage.value]);
const temperatureStyle = computed(() => {
  const value = colorTemperature.value;
  const intensity = Math.abs(value) / 100;
  const overlay = value >= 0 ? "255, 142, 54" : "70, 132, 255";
  const opacity = (intensity * 0.34).toFixed(3);
  const panelShift = (intensity * 0.22).toFixed(3);
  const hue = value >= 0 ? 28 : 218;
  return {
    "--temperature-overlay": overlay,
    "--temperature-opacity": opacity,
    "--temperature-panel-shift": panelShift,
    "--temperature-hue": `${hue}deg`,
  };
});
const isStatusActive = computed(() => !userStatusExpireAt.value || userStatusExpireAt.value > currentTime.value);
const currentStatusDisplay = computed(() => {
  if (!isStatusActive.value) {
    return uiText.value.statusUnset;
  }
  const matched = statusOptions.find((option) => option.icon === userStatusIcon.value);
  const storedText = userStatusText.value.trim();
  const isPresetText = statusOptions.some((option) => option.text === storedText || option.textEn === storedText);
  const text = isPresetText && matched
    ? statusOptionText(matched)
    : storedText || (matched ? statusOptionText(matched) : uiText.value.statusFallback);
  return `${userStatusIcon.value} ${text}`;
});
const chatThreads = computed<ChatThread[]>(() => [
  {
    id: "assistant",
    type: "contact",
    name: displayModuleName("chat"),
    subtitle: latestMessagePreview() || (uiLanguage.value === "en-US" ? "Tap to start a chat" : "点击开始对话"),
    detail: uiLanguage.value === "en-US" ? "AI assistant" : "AI 助手",
    time: uiLanguage.value === "en-US" ? "Now" : "现在",
    tone: "ink",
  },
  {
    id: "daily",
    type: "contact",
    name: "阿宁",
    subtitle: threadPreview("daily", "晚点再把这件事理一下"),
    detail: uiLanguage.value === "en-US" ? "Contact" : "联系人",
    time: "11:28",
    tone: "green",
  },
  {
    id: "ideas",
    type: "group",
    name: "灵感群",
    subtitle: threadPreview("ideas", "把零碎念头先放这里"),
    detail: uiLanguage.value === "en-US" ? "3 members" : "3 位成员",
    time: "09:42",
    tone: "blue",
  },
  {
    id: "workspace",
    type: "group",
    name: "ForEver 项目室",
    subtitle: threadPreview("workspace", "聚合、虚实、秩序"),
    detail: uiLanguage.value === "en-US" ? "Work group" : "工作群",
    time: uiLanguage.value === "en-US" ? "Tue" : "周二",
    tone: "clay",
  },
]);
const activeChatThread = computed(
  () => chatThreads.value.find((thread) => thread.id === activeChatThreadId.value) ?? chatThreads.value[0],
);
const activeChatMessages = computed(() =>
  activeChatThreadId.value === "assistant" ? messages.value : threadMessages.value[activeChatThreadId.value] ?? [],
);

onMounted(() => {
  window.addEventListener("hashchange", syncRoute);
  window.addEventListener("click", closeUserMenu);
  syncRoute();
  statusExpiryTimer = window.setInterval(() => {
    currentTime.value = Date.now();
  }, 60_000);

  const activeProfile = modelProfiles.value.find((profile) => profile.id === activeModelProfileId.value);
  if (activeProfile) {
    config.value = profileToChatConfig(activeProfile);
  }
  refreshCurrentUser();
  refresh();
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.setTimeout(() => {
    showIntro.value = false;
    introFinished.value = true;
  }, prefersReducedMotion ? 150 : 2600);
});

onBeforeUnmount(() => {
  window.removeEventListener("hashchange", syncRoute);
  window.removeEventListener("click", closeUserMenu);
  clearErrorTimer();
  if (statusExpiryTimer) {
    window.clearInterval(statusExpiryTimer);
  }
});

watch(
  config,
  (value) => {
    localStorage.setItem(storageKey, JSON.stringify(value));
  },
  { deep: true },
);

watch(
  messages,
  (value) => {
    localStorage.setItem(messagesKey, JSON.stringify(value));
  },
  { deep: true },
);

watch(
  modelProfiles,
  (value) => {
    localStorage.setItem(modelProfilesKey, JSON.stringify(value));
  },
  { deep: true },
);

watch(uiLanguage, (value) => {
  localStorage.setItem(uiLanguageKey, value);
});

watch(
  colorMode,
  (value) => {
    localStorage.setItem(colorModeKey, value);
    document.documentElement.dataset.colorMode = value;
  },
  { immediate: true },
);

watch(colorTemperature, (value) => {
  localStorage.setItem(colorTemperatureKey, String(clampNumber(value, -100, 100)));
});

watch(userStatusIcon, (value) => {
  localStorage.setItem(userStatusIconKey, value);
});

watch(userStatusText, (value) => {
  localStorage.setItem(userStatusTextKey, value);
});

watch(userStatusExpireAt, (value) => {
  if (value) {
    localStorage.setItem(userStatusExpireAtKey, String(value));
  } else {
    localStorage.removeItem(userStatusExpireAtKey);
  }
});

watch(userOnline, (value) => {
  localStorage.setItem(userOnlineKey, String(value));
});

async function refresh() {
  backendOnline.value = await fetchHealth();

  try {
    modules.value = await fetchModules();
  } catch {
    modules.value = fallbackModules();
  }

  try {
    providers.value = await fetchProviders();
  } catch {
    providers.value = fallbackProviders();
  }
}

function readRoute() {
  const slug = window.location.hash.replace(/^#\/?/, "").replace(/\/$/, "");
  if (!slug) {
    return "home";
  }
  if (slug === "sign-in" || slug === "sign-up") {
    return slug;
  }
  return routeModules[slug] ?? "home";
}

function syncRoute() {
  const nextRoute = readRoute();
  userMenuOpen.value = false;
  statusBoxOpen.value = false;
  if (nextRoute === "chat" && routeId.value !== "chat") {
    mobileChatView.value = "list";
  }
  if (nextRoute === "sign-in" || nextRoute === "sign-up") {
    authMode.value = nextRoute;
    authError.value = "";
  }
  routeId.value = nextRoute;
}

function openModule(moduleId: string) {
  const route = moduleRoutes[moduleId as keyof typeof moduleRoutes] ?? moduleId;
  const nextHash = `#/${route}`;
  if (window.location.hash === nextHash) {
    syncRoute();
    return;
  }
  window.location.hash = `/${route}`;
}

function enterWorkspace() {
  openModule("dashboard");
}

function openAuth(mode: "sign-in" | "sign-up") {
  authMode.value = mode;
  authError.value = "";
  const nextHash = `#/${mode}`;
  if (window.location.hash === nextHash) {
    syncRoute();
    return;
  }
  window.location.hash = `/${mode}`;
}

function goHome() {
  if (window.location.hash === "#/" || window.location.hash === "") {
    syncRoute();
    return;
  }
  window.location.hash = "/";
}

function toggleUserMenu() {
  userMenuOpen.value = !userMenuOpen.value;
  if (userMenuOpen.value) {
    statusBoxOpen.value = false;
  }
}

function closeUserMenu() {
  userMenuOpen.value = false;
  statusBoxOpen.value = false;
}

function setLanguage(language: UiLanguage) {
  uiLanguage.value = language;
}

function setColorMode(mode: ColorMode) {
  colorMode.value = mode;
}

function openStatusBox() {
  draftStatusIcon.value = isStatusActive.value ? userStatusIcon.value : statusOptions[1].icon;
  draftStatusText.value = isStatusActive.value ? userStatusText.value : statusOptionText(statusOptions[1]);
  draftStatusDuration.value = "day";
  userMenuOpen.value = false;
  statusBoxOpen.value = true;
}

function cancelStatusBox() {
  statusBoxOpen.value = false;
}

function confirmStatusBox() {
  userStatusIcon.value = draftStatusIcon.value;
  userStatusText.value = draftStatusText.value.trim() || statusOptionText(
    statusOptions.find((option) => option.icon === draftStatusIcon.value) ?? statusOptions[1],
  );
  userStatusExpireAt.value = calculateStatusExpireAt(draftStatusDuration.value);
  currentTime.value = Date.now();
  statusBoxOpen.value = false;
}

function selectDraftStatusOption(option: StatusOption) {
  const currentText = draftStatusText.value.trim();
  const isPresetText = statusOptions.some((item) => item.text === currentText || item.textEn === currentText);
  draftStatusIcon.value = option.icon;
  if (!currentText || isPresetText) {
    draftStatusText.value = statusOptionText(option);
  }
}

function statusOptionLabel(option: StatusOption) {
  return uiLanguage.value === "en-US" ? option.labelEn : option.label;
}

function statusOptionText(option: StatusOption) {
  return uiLanguage.value === "en-US" ? option.textEn : option.text;
}

function statusDurationLabel(option: StatusDurationOption) {
  return uiLanguage.value === "en-US" ? option.labelEn : option.label;
}

function calculateStatusExpireAt(duration: StatusDuration) {
  const now = new Date();
  if (duration === "never") {
    return 0;
  }
  if (duration === "hour") {
    return now.getTime() + 60 * 60 * 1000;
  }
  if (duration === "four-hours") {
    return now.getTime() + 4 * 60 * 60 * 1000;
  }
  if (duration === "today") {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay.getTime();
  }
  return now.getTime() + 24 * 60 * 60 * 1000;
}

function openPreferences() {
  userMenuOpen.value = false;
  openModule("admin");
}

function signOutFromMenu() {
  userMenuOpen.value = false;
  signOut();
}

async function refreshCurrentUser() {
  if (!authToken.value) {
    return;
  }
  try {
    currentUser.value = await fetchCurrentUser(authToken.value);
    localStorage.setItem(authUserKey, JSON.stringify(currentUser.value));
  } catch {
    signOut();
  }
}

async function handleSignIn(payload: SignInPayload) {
  authLoading.value = true;
  authError.value = "";
  try {
    persistAuth(await signIn(payload));
  } catch (cause) {
    authError.value = cause instanceof Error ? cause.message : "Sign in failed.";
  } finally {
    authLoading.value = false;
  }
}

async function handleSignUp(payload: SignUpPayload) {
  authLoading.value = true;
  authError.value = "";
  try {
    persistAuth(await signUp(payload));
  } catch (cause) {
    authError.value = cause instanceof Error ? cause.message : "Sign up failed.";
  } finally {
    authLoading.value = false;
  }
}

function persistAuth(response: { token: string; user: AuthUser }) {
  authToken.value = response.token;
  currentUser.value = response.user;
  localStorage.setItem(authTokenKey, response.token);
  localStorage.setItem(authUserKey, JSON.stringify(response.user));
  openModule("admin");
}

function handleUserUpdated(user: AuthUser) {
  currentUser.value = user;
  localStorage.setItem(authUserKey, JSON.stringify(user));
}

function signOut() {
  authToken.value = "";
  currentUser.value = null;
  localStorage.removeItem(authTokenKey);
  localStorage.removeItem(authUserKey);
}

async function handleSend(content: string) {
  clearError();
  const nextMessages = [...messages.value, { role: "user", content } satisfies ChatMessage];
  messages.value = nextMessages;
  loading.value = true;

  try {
    const response = await sendChat(config.value, nextMessages);
    messages.value = [
      ...nextMessages,
      {
        role: "assistant",
        content: response.content,
      },
    ];
  } catch (cause) {
    showTransientError(cause instanceof Error ? cause.message : "请求失败");
  } finally {
    loading.value = false;
  }
}

async function handleThreadSend(content: string) {
  clearError();
  if (activeChatThreadId.value === "assistant") {
    await handleSend(content);
    return;
  }

  const threadId = activeChatThreadId.value;
  const existing = threadMessages.value[threadId] ?? [];
  threadMessages.value = {
    ...threadMessages.value,
    [threadId]: [
      ...existing,
      { role: "user", content },
      { role: "assistant", content: "这条会话会在联系人能力接入后同步真实消息。" },
    ],
  };
}

function clearMessages() {
  messages.value = [];
  clearError();
}

function clearActiveThreadMessages() {
  clearError();
  if (activeChatThreadId.value === "assistant") {
    clearMessages();
    return;
  }
  threadMessages.value = {
    ...threadMessages.value,
    [activeChatThreadId.value]: [],
  };
}

function selectChatThread(threadId: string) {
  clearError();
  activeChatThreadId.value = threadId;
  mobileChatView.value = "conversation";
}

function showTransientError(message: string) {
  clearErrorTimer();
  error.value = message;
  errorTimer = window.setTimeout(() => {
    error.value = "";
    errorTimer = undefined;
  }, 4600);
}

function clearError() {
  clearErrorTimer();
  error.value = "";
}

function clearErrorTimer() {
  if (errorTimer) {
    window.clearTimeout(errorTimer);
    errorTimer = undefined;
  }
}

function threadPreview(threadId: string, fallback: string) {
  const latest = [...(threadMessages.value[threadId] ?? [])].reverse().find((message) => message.content.trim());
  if (!latest) {
    return fallback;
  }
  return truncatePreview(latest.content);
}

function latestMessagePreview() {
  const latest = [...messages.value].reverse().find((message) => message.content.trim());
  if (!latest) {
    return "";
  }
  return truncatePreview(latest.content);
}

function truncatePreview(value: string) {
  const content = value.replace(/\s+/g, " ").trim();
  return content.length > 28 ? `${content.slice(0, 28)}...` : content;
}

function createThreadMessageSamples(): Record<string, ChatMessage[]> {
  return {
    daily: [
      { role: "assistant", content: "今晚要不要把生活里的小事先记下来？" },
      { role: "user", content: "先记一下，明天再整理。" },
    ],
    ideas: [
      { role: "assistant", content: "灵感先不用分类，丢进来就行。" },
      { role: "user", content: "以后这里可以按主题自动聚合。" },
    ],
    workspace: [
      { role: "assistant", content: "交耳、虚实、聚合已经可以形成一条使用路径。" },
      { role: "user", content: "下一步再接管理员端。" },
    ],
  };
}

function saveModelProfile(profile: ModelProfile) {
  const nextProfiles = [...modelProfiles.value];
  const index = nextProfiles.findIndex((item) => item.id === profile.id);
  if (index >= 0) {
    nextProfiles[index] = profile;
  } else {
    nextProfiles.unshift(profile);
  }
  modelProfiles.value = nextProfiles;
  selectModelProfile(profile);
}

function selectModelProfile(profile: ModelProfile) {
  activeModelProfileId.value = profile.id;
  localStorage.setItem(activeModelProfileKey, profile.id);
  config.value = profileToChatConfig(profile);
}

function deleteModelProfile(profileId: string) {
  modelProfiles.value = modelProfiles.value.filter((profile) => profile.id !== profileId);
  if (activeModelProfileId.value === profileId) {
    activeModelProfileId.value = "";
    localStorage.removeItem(activeModelProfileKey);
  }
}

function profileToChatConfig(profile: ModelProfile): ChatConfig {
  return {
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    systemPrompt: profile.systemPrompt,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
  };
}

function loadConfig(): ChatConfig {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return defaultConfig;
  }
  try {
    return { ...defaultConfig, ...JSON.parse(raw) };
  } catch {
    return defaultConfig;
  }
}

function loadMessages(): ChatMessage[] {
  const raw = localStorage.getItem(messagesKey);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function loadModelProfiles(): ModelProfile[] {
  const raw = localStorage.getItem(modelProfilesKey);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function loadStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(authUserKey);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadPreference<T extends string>(key: string, fallback: T): T {
  return (localStorage.getItem(key) as T | null) ?? fallback;
}

function loadBooleanPreference(key: string, fallback: boolean) {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return fallback;
  }
  return raw === "true";
}

function loadNumberPreference(key: string, fallback: number) {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function firstAvatarLetter(value: string) {
  return (Array.from(value.trim())[0] ?? "访").toUpperCase();
}

function moduleIcon(moduleId: string) {
  const icons = {
    dashboard: LayoutDashboard,
    chat: MessageSquareText,
    "image-generation": Image,
    "provider-hub": PlugZap,
    notes: NotebookPen,
    workflow: Workflow,
    admin: Shield,
  };
  return icons[moduleId as keyof typeof icons] ?? Blocks;
}

function moduleEnglishName(moduleId: string) {
  const labels = {
    dashboard: "Insight",
    chat: "Chat",
    "image-generation": "Image",
    "provider-hub": "Aggregation",
    notes: "Notes",
    workflow: "automation",
    admin: "Self",
  };
  return labels[moduleId as keyof typeof labels] ?? moduleId;
}

function displayModuleName(moduleId: string) {
  const moduleCopy = localizedModules[moduleId];
  if (!moduleCopy) {
    return activeModule.value?.name ?? "Module";
  }
  return uiLanguage.value === "en-US" ? moduleCopy.en[0] : moduleCopy.zh[0];
}

function displayModuleDescription(moduleId: string) {
  const moduleCopy = localizedModules[moduleId];
  if (!moduleCopy) {
    return activeModule.value?.description ?? uiText.value.moduleUnavailable;
  }
  return uiLanguage.value === "en-US" ? moduleCopy.en[1] : moduleCopy.zh[1];
}

function fallbackModules(): PlatformModule[] {
  return [
    {
      id: "dashboard",
      name: "见微知著",
      description: "查看平台模块、接口状态和扩展入口。",
      category: "system",
    },
    {
      id: "chat",
      name: "交耳",
      description: "兼容 OpenAI、Anthropic、Gemini 格式的对话模块。",
      category: "ai",
    },
    {
      id: "image-generation",
      name: "虚实",
      description: "文本生图、多模型聚合和生成记录能力。",
      category: "ai",
    },
    {
      id: "provider-hub",
      name: "聚合",
      description: "统一管理模型供应商、密钥和默认模型。",
      category: "integration",
    },
    {
      id: "notes",
      name: "笔记",
      description: "Markdown 写作、笔记暂存和实时渲染。",
      category: "productivity",
    },
    {
      id: "workflow",
      name: "秩序",
      description: "自动化流程、任务节点和触发器。",
      category: "automation",
    },
    {
      id: "admin",
      name: "自我",
      description: "用户、权限、审计和系统配置能力。",
      category: "system",
    },
  ];
}

function fallbackProviders(): ProviderInfo[] {
  return [
    {
      id: "openai",
      label: "OpenAI Compatible",
      default_base_url: "https://api.openai.com/v1",
      default_model: "gpt-4.1-mini",
      auth_label: "Authorization: Bearer",
      endpoint: "POST /chat/completions",
    },
    {
      id: "anthropic",
      label: "Anthropic Messages",
      default_base_url: "https://api.anthropic.com/v1",
      default_model: "claude-sonnet-4-20250514",
      auth_label: "x-api-key",
      endpoint: "POST /messages",
    },
    {
      id: "gemini",
      label: "Gemini GenerateContent",
      default_base_url: "https://generativelanguage.googleapis.com/v1beta",
      default_model: "gemini-2.5-flash",
      auth_label: "x-goog-api-key",
      endpoint: "POST /models/{model}:generateContent",
    },
  ];
}
</script>
