<template>
  <section class="image-panel" :aria-label="copy.panelAria">
    <div class="module-view-header">
      <div>
        <p class="eyebrow">Image</p>
        <h1>{{ copy.title }}</h1>
      </div>
      <span class="status-pill" :class="{ online: backendOnline }">
        <CheckCircle2 :size="16" />
        {{ backendOnline ? copy.apiReady : copy.apiOffline }}
      </span>
    </div>

    <div class="image-workspace">
      <form class="image-form" @submit.prevent="submit">
        <div class="form-grid">
          <label class="full-field">
            <span>{{ copy.aggregationConfig }}</span>
            <select :value="activeProfileId" @change="applyProfile(($event.target as HTMLSelectElement).value)">
              <option value="">{{ copy.manualConfig }}</option>
              <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
                {{ profile.name }} / {{ profile.model }}
              </option>
            </select>
          </label>

          <label>
            <span>Provider</span>
            <select v-model="config.provider">
              <option value="openai">OpenAI Images</option>
              <option value="gemini">Gemini Images</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          <label>
            <span>Model</span>
            <input v-model="config.model" autocomplete="off" />
          </label>

          <label>
            <span>Base URL</span>
            <input v-model="config.baseUrl" autocomplete="off" />
          </label>

        <label>
          <span>API Key</span>
          <div class="input-with-icon key-field">
            <KeyRound :size="16" />
            <input v-model="config.apiKey" :type="showApiKey ? 'text' : 'password'" autocomplete="off" />
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
            <span>Size</span>
            <select v-model="config.size">
              <option value="1024x1024">1K</option>
              <option value="2048x2048">2K</option>
              <option value="4096x4096">4K</option>
            </select>
          </label>
        </div>

        <label class="prompt-field">
          <span>Prompt</span>
          <textarea v-model="config.prompt" rows="8" :placeholder="copy.promptPlaceholder" />
        </label>

        <p v-if="error" class="error-line inline">{{ error }}</p>
        <p v-if="result" class="notice-line">{{ result }}</p>

        <button class="send-button image-submit" type="submit" :disabled="loading || !config.prompt.trim()">
          <LoaderCircle v-if="loading" :size="18" class="spin" />
          <ImagePlus v-else :size="18" />
          <span>{{ loading ? copy.submitting : copy.generate }}</span>
        </button>
      </form>

      <div class="image-preview">
        <div class="preview-empty">
          <ImageIcon :size="42" />
          <strong>{{ copy.preview }}</strong>
          <span>{{ copy.waiting }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { CheckCircle2, Eye, EyeOff, Image as ImageIcon, ImagePlus, KeyRound, LoaderCircle } from "lucide-vue-next";

import { generateImage } from "../services/api";
import type { ModelProfile } from "../types/chat";
import type { ImageGenerationConfig } from "../types/images";

const props = defineProps<{
  backendOnline: boolean;
  profiles: ModelProfile[];
  language: "zh-CN" | "en-US";
}>();

const storageKey = "4ever.image.config";
const activeProfileKey = "4ever.image.activeProfile";
const defaultConfig: ImageGenerationConfig = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-image-1",
  size: "1024x1024",
  prompt: "",
};

const config = reactive<ImageGenerationConfig>(loadConfig());
const activeProfileId = ref(localStorage.getItem(activeProfileKey) ?? "");
const loading = ref(false);
const error = ref("");
const result = ref("");
const showApiKey = ref(false);
const copy = computed(() =>
  props.language === "en-US"
    ? {
        panelAria: "Image",
        title: "Image",
        apiReady: "API ready",
        apiOffline: "API offline",
        aggregationConfig: "Aggregation config",
        manualConfig: "Manual config",
        hideKey: "Hide key",
        showKey: "Show key",
        promptPlaceholder: "Describe the image you want to generate",
        submitting: "Submitting",
        generate: "Generate image",
        preview: "Generation preview",
        waiting: "Waiting for aggregation config",
      }
    : {
        panelAria: "Image 虚实",
        title: "虚实",
        apiReady: "API 就绪",
        apiOffline: "API 离线",
        aggregationConfig: "聚合配置",
        manualConfig: "手动配置",
        hideKey: "隐藏 Key",
        showKey: "显示 Key",
        promptPlaceholder: "描述要生成的图片",
        submitting: "提交中",
        generate: "生成图片",
        preview: "生成预览",
        waiting: "等待聚合配置",
      },
);

watch(
  config,
  (value) => {
    localStorage.setItem(storageKey, JSON.stringify(value));
  },
  { deep: true },
);

watch(activeProfileId, (value) => {
  if (value) {
    localStorage.setItem(activeProfileKey, value);
  } else {
    localStorage.removeItem(activeProfileKey);
  }
});

watch(
  () => props.profiles,
  (profiles) => {
    if (activeProfileId.value && !profiles.some((profile) => profile.id === activeProfileId.value)) {
      activeProfileId.value = "";
    }
  },
  { deep: true },
);

function applyProfile(profileId: string) {
  activeProfileId.value = profileId;
  if (!profileId) {
    return;
  }

  const profile = props.profiles.find((item) => item.id === profileId);
  if (!profile) {
    return;
  }

  config.provider = profile.provider;
  config.baseUrl = profile.baseUrl;
  config.apiKey = profile.apiKey;
  config.model = profile.model;
}

async function submit() {
  if (!config.prompt.trim() || loading.value) {
    return;
  }

  loading.value = true;
  error.value = "";
  result.value = "";

  try {
    const response = await generateImage(config);
    result.value = response.message;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "生成请求失败";
  } finally {
    loading.value = false;
  }
}

function loadConfig(): ImageGenerationConfig {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return { ...defaultConfig };
  }

  try {
    return { ...defaultConfig, ...JSON.parse(raw) };
  } catch {
    return { ...defaultConfig };
  }
}
</script>
