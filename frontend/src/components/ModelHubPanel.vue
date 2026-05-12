<template>
  <section class="model-hub-panel" aria-label="聚合">
    <div class="module-view-header">
      <div>
        <p class="eyebrow">Aggregation</p>
        <h1>聚合</h1>
      </div>
      <span class="status-pill online">{{ activeProfile ? `当前：${activeProfile.name}` : "未选择模型" }}</span>
    </div>

    <div class="model-hub-grid">
      <div class="model-profile-list">
        <div class="panel-heading compact">
          <div>
            <p class="eyebrow">Profiles</p>
            <h2>模型配置</h2>
          </div>
          <button class="icon-button ghost" type="button" title="新建配置" @click="newDraft">
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
          <small>{{ profile.id === activeProfileId ? "使用中" : "点击切换" }}</small>
        </button>

        <div v-if="profiles.length === 0" class="profile-empty">
          <PlugZap :size="28" />
          <span>还没有模型配置</span>
        </div>
      </div>

      <form class="model-profile-form" @submit.prevent="saveDraft">
        <div class="panel-heading compact">
          <div>
            <p class="eyebrow">Config</p>
            <h2>{{ draft.id ? "编辑配置" : "新增配置" }}</h2>
          </div>
        </div>

        <div class="form-grid">
          <label>
            <span>配置名称</span>
            <input v-model="draft.name" placeholder="例如：OpenAI 生产环境" autocomplete="off" />
          </label>

          <label>
            <span>模型格式</span>
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
              :title="showApiKey ? '隐藏 Key' : '显示 Key'"
              @click="showApiKey = !showApiKey"
            >
              <EyeOff v-if="showApiKey" :size="16" />
              <Eye v-else :size="16" />
            </button>
          </div>
        </label>

          <label>
            <span>Model</span>
            <input v-model="draft.model" placeholder="模型名称" autocomplete="off" />
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
            <span>保存配置</span>
          </button>
          <button class="secondary-button" type="button" :disabled="testing" @click="testConnection">
            <PlugZap :size="17" />
            <span>{{ testing ? "测试中" : "测试连接" }}</span>
          </button>
          <button class="secondary-button" type="button" :disabled="loadingModels" @click="loadModels">
            <ListRestart :size="17" />
            <span>{{ loadingModels ? "获取中" : "获取模型" }}</span>
          </button>
          <button v-if="draft.id" class="secondary-button danger" type="button" @click="deleteDraft">
            <Trash2 :size="17" />
            <span>删除</span>
          </button>
        </div>

        <p v-if="connectionError" class="error-line inline">{{ connectionError }}</p>

        <div v-if="modelOptions.length" class="model-options" aria-label="模型列表">
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
  notice.value = `已切换到 ${profile.name}`;
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
  notice.value = `已保存并切换到 ${profile.name}`;
}

function deleteDraft() {
  const deletedId = draft.id;
  if (!deletedId) {
    return;
  }
  emit("delete", deletedId);
  Object.assign(draft, emptyDraft());
  notice.value = "已删除配置";
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
    connectionError.value = cause instanceof Error ? cause.message : "连接测试失败";
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
    notice.value = response.models.length ? `已获取 ${response.models.length} 个模型` : "连接正常，但没有返回模型";
  } catch (cause) {
    connectionError.value = cause instanceof Error ? cause.message : "获取模型失败";
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
