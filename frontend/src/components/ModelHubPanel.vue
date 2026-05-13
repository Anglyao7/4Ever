<template>
  <section class="model-hub-panel" :aria-label="copy.title">
    <div class="module-view-header">
      <div>
        <p class="eyebrow">Aggregation</p>
        <h1>{{ copy.title }}</h1>
      </div>
      <span class="status-pill online">{{ activeProfile ? `${copy.current}: ${activeProfile.name}` : copy.noModel }}</span>
    </div>

    <div class="model-hub-grid">
      <div class="model-profile-list">
        <div class="panel-heading compact">
          <div>
            <p class="eyebrow">Profiles</p>
            <h2>{{ copy.profilesTitle }}</h2>
          </div>
          <button class="icon-button ghost" type="button" :title="copy.newConfig" @click="newDraft">
            <Plus :size="17" />
          </button>
        </div>

        <button
          v-for="profile in profiles"
          :key="profile.id"
          class="model-profile-card"
          :class="{ active: profile.id === activeProfileId }"
          type="button"
          @click="selectProfile(profile)"
        >
          <div>
            <strong>{{ profile.name }}</strong>
            <span>{{ providerName(profile.provider) }} / {{ profile.model }}</span>
          </div>
          <small>{{ profile.id === activeProfileId ? copy.inUse : copy.clickSwitch }}</small>
        </button>

        <div v-if="profiles.length === 0" class="profile-empty">
          <PlugZap :size="28" />
          <span>{{ copy.emptyProfiles }}</span>
        </div>
      </div>

      <form class="model-profile-form" @submit.prevent="saveDraft">
        <div class="panel-heading compact">
          <div>
            <p class="eyebrow">Config</p>
            <h2>{{ draft.id ? copy.editConfig : copy.addConfig }}</h2>
          </div>
        </div>

        <div class="form-grid">
          <label>
            <span>{{ copy.configName }}</span>
            <input v-model="draft.name" :placeholder="copy.configNamePlaceholder" autocomplete="off" />
          </label>

          <label>
            <span>{{ copy.providerFormat }}</span>
            <select v-model="draft.provider" @change="applyProviderDefaults">
              <option v-for="provider in providers" :key="provider.id" :value="provider.id">
                {{ providerName(provider.id) }}
              </option>
            </select>
          </label>

          <label>
            <span>Base URL</span>
            <input v-model="draft.baseUrl" placeholder="https://api.example.com/v1" autocomplete="off" />
          </label>

        <label>
          <span>API Key</span>
          <div class="input-with-icon key-field">
            <KeyRound :size="16" />
            <input v-model="draft.apiKey" :type="showApiKey ? 'text' : 'password'" autocomplete="off" />
            <button
              class="visibility-toggle"
              type="button"
              :title="showApiKey ? copy.hideKey : copy.showKey"
              @click="showApiKey = !showApiKey"
            >
              <EyeOff v-if="showApiKey" :size="16" />
              <Eye v-else :size="16" />
            </button>
          </div>
        </label>

          <label>
            <span>Model</span>
            <input v-model="draft.model" :placeholder="copy.modelPlaceholder" autocomplete="off" />
          </label>

          <label>
            <span>Max Tokens</span>
            <input v-model.number="draft.maxTokens" type="number" min="1" step="1" />
          </label>
        </div>

        <div class="range-row">
          <label for="hub-temperature">Temperature</label>
          <input id="hub-temperature" v-model.number="draft.temperature" type="range" min="0" max="2" step="0.1" />
          <output>{{ draft.temperature.toFixed(1) }}</output>
        </div>

        <label class="system-prompt">
          <span>System Prompt</span>
          <textarea v-model="draft.systemPrompt" rows="4" />
        </label>

        <p v-if="notice" class="notice-line">{{ notice }}</p>

        <div class="form-actions">
          <button class="primary-action" type="button" :disabled="!canSave" @click="saveDraft">
            <Save :size="18" />
            <span>{{ copy.saveConfig }}</span>
          </button>
          <button class="secondary-button" type="button" :disabled="testing" @click="testConnection">
            <PlugZap :size="17" />
            <span>{{ testing ? copy.testing : copy.testConnection }}</span>
          </button>
          <button class="secondary-button" type="button" :disabled="loadingModels" @click="loadModels">
            <ListRestart :size="17" />
            <span>{{ loadingModels ? copy.loadingModels : copy.fetchModels }}</span>
          </button>
          <button v-if="draft.id" class="secondary-button danger" type="button" @click="deleteDraft">
            <Trash2 :size="17" />
            <span>{{ copy.delete }}</span>
          </button>
        </div>

        <p v-if="connectionError" class="error-line inline">{{ connectionError }}</p>

        <div v-if="modelOptions.length" class="model-options" :aria-label="copy.modelList">
          <button
            v-for="model in modelOptions"
            :key="model.id"
            class="model-option"
            type="button"
            @click="draft.model = model.id"
          >
            <strong>{{ model.id }}</strong>
            <span>{{ model.label }}</span>
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { Eye, EyeOff, KeyRound, ListRestart, PlugZap, Plus, Save, Trash2 } from "lucide-vue-next";

import { fetchProviderModels, testProviderConnection } from "../services/api";
import type { ChatConfig, ModelProfile, ProviderFormat, ProviderInfo, ProviderModel } from "../types/chat";

const props = defineProps<{
  profiles: ModelProfile[];
  activeProfileId: string;
  providers: ProviderInfo[];
  currentConfig: Omit<ModelProfile, "id" | "name">;
  language: "zh-CN" | "en-US";
}>();

const emit = defineEmits<{
  save: [profile: ModelProfile];
  select: [profile: ModelProfile];
  delete: [profileId: string];
}>();

type DraftProfile = ModelProfile;

const draft = reactive<DraftProfile>(emptyDraft());
const notice = ref("");
const showApiKey = ref(false);
const testing = ref(false);
const loadingModels = ref(false);
const connectionError = ref("");
const modelOptions = ref<ProviderModel[]>([]);

const activeProfile = computed(() => props.profiles.find((profile) => profile.id === props.activeProfileId));
const canSave = computed(() => Boolean(draft.name.trim() && draft.model.trim()));
const copy = computed(() =>
  props.language === "en-US"
    ? {
        title: "Aggregation",
        current: "Current",
        noModel: "No model selected",
        profilesTitle: "Model profiles",
        newConfig: "New config",
        inUse: "In use",
        clickSwitch: "Click to switch",
        emptyProfiles: "No model profiles yet",
        editConfig: "Edit config",
        addConfig: "Add config",
        configName: "Config name",
        configNamePlaceholder: "Example: OpenAI production",
        providerFormat: "Provider format",
        hideKey: "Hide key",
        showKey: "Show key",
        modelPlaceholder: "Model name",
        saveConfig: "Save config",
        testing: "Testing",
        testConnection: "Test connection",
        loadingModels: "Fetching",
        fetchModels: "Fetch models",
        delete: "Delete",
        modelList: "Model list",
        switched: "Switched to",
        saved: "Saved and switched to",
        deleted: "Config deleted",
        testFailed: "Connection test failed",
        fetched: "Fetched",
        models: "models",
        noModels: "Connection is healthy, but no models were returned",
        fetchFailed: "Failed to fetch models",
      }
    : {
        title: "聚合",
        current: "当前",
        noModel: "未选择模型",
        profilesTitle: "模型配置",
        newConfig: "新建配置",
        inUse: "使用中",
        clickSwitch: "点击切换",
        emptyProfiles: "还没有模型配置",
        editConfig: "编辑配置",
        addConfig: "新增配置",
        configName: "配置名称",
        configNamePlaceholder: "例如：OpenAI 生产环境",
        providerFormat: "模型格式",
        hideKey: "隐藏 Key",
        showKey: "显示 Key",
        modelPlaceholder: "模型名称",
        saveConfig: "保存配置",
        testing: "测试中",
        testConnection: "测试连接",
        loadingModels: "获取中",
        fetchModels: "获取模型",
        delete: "删除",
        modelList: "模型列表",
        switched: "已切换到",
        saved: "已保存并切换到",
        deleted: "已删除配置",
        testFailed: "连接测试失败",
        fetched: "已获取",
        models: "个模型",
        noModels: "连接正常，但没有返回模型",
        fetchFailed: "获取模型失败",
      },
);

watch(
  () => props.profiles,
  () => {
    if (!draft.id && props.profiles.length === 0) {
      Object.assign(draft, emptyDraft());
    }
  },
  { deep: true },
);

function selectProfile(profile: ModelProfile) {
  Object.assign(draft, { ...profile });
  emit("select", profile);
  notice.value = `${copy.value.switched} ${profile.name}`;
}

function saveDraft() {
  if (!canSave.value) {
    return;
  }

  const profile: ModelProfile = {
    ...draft,
    id: draft.id || createId(),
    name: draft.name.trim(),
    model: draft.model.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    systemPrompt: draft.systemPrompt.trim(),
  };
  Object.assign(draft, { ...profile });
  emit("save", profile);
  emit("select", profile);
  notice.value = `${copy.value.saved} ${profile.name}`;
}

function deleteDraft() {
  const deletedId = draft.id;
  if (!deletedId) {
    return;
  }
  emit("delete", deletedId);
  Object.assign(draft, emptyDraft());
  notice.value = copy.value.deleted;
}

function newDraft() {
  Object.assign(draft, emptyDraft());
  notice.value = "";
}

function applyProviderDefaults() {
  const provider = props.providers.find((item) => item.id === draft.provider);
  if (!provider) {
    return;
  }
  draft.baseUrl = provider.default_base_url;
  draft.model = provider.default_model;
}

async function testConnection() {
  connectionError.value = "";
  notice.value = "";
  testing.value = true;

  try {
    const response = await testProviderConnection(draftToChatConfig());
    notice.value = `${response.message} 共 ${response.model_count} 个模型。`;
  } catch (cause) {
    connectionError.value = cause instanceof Error ? cause.message : copy.value.testFailed;
  } finally {
    testing.value = false;
  }
}

async function loadModels() {
  connectionError.value = "";
  notice.value = "";
  loadingModels.value = true;

  try {
    const response = await fetchProviderModels(draftToChatConfig());
    modelOptions.value = response.models;
    notice.value = response.models.length
      ? `${copy.value.fetched} ${response.models.length} ${copy.value.models}`
      : copy.value.noModels;
  } catch (cause) {
    connectionError.value = cause instanceof Error ? cause.message : copy.value.fetchFailed;
  } finally {
    loadingModels.value = false;
  }
}

function draftToChatConfig(): ChatConfig {
  return {
    provider: draft.provider,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey,
    model: draft.model || "placeholder",
    systemPrompt: draft.systemPrompt,
    temperature: draft.temperature,
    maxTokens: draft.maxTokens,
  };
}

function emptyDraft(): DraftProfile {
  return {
    id: "",
    name: "",
    provider: props.currentConfig.provider,
    baseUrl: props.currentConfig.baseUrl,
    apiKey: props.currentConfig.apiKey,
    model: props.currentConfig.model,
    systemPrompt: props.currentConfig.systemPrompt,
    temperature: props.currentConfig.temperature,
    maxTokens: props.currentConfig.maxTokens,
  };
}

function createId() {
  return `model-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function providerName(provider: ProviderFormat) {
  const names: Record<ProviderFormat, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Gemini",
  };
  return names[provider];
}
</script>
