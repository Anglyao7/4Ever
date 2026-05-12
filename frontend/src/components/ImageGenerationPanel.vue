<template>
  <section class="image-panel" aria-label="Image 虚实">
    <div class="module-view-header">
      <div>
        <p class="eyebrow">Image</p>
        <h1>虚实</h1>
      </div>
      <span class="status-pill" :class="{ online: backendOnline }">
        <CheckCircle2 :size="16" />
        {{ backendOnline ? "API 就绪" : "API 离线" }}
      </span>
    </div>

    <div class="image-workspace">
      <form class="image-form" @submit.prevent="submit">
        <div class="form-grid">
          <label class="full-field">
            <span>聚合配置</span>
            <select :value="activeProfileId" @change="applyProfile(($event.target as HTMLSelectElement).value)">
              <option value="">手动配置</option>
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
              :title="showApiKey ? '隐藏 Key' : '显示 Key'"
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
          <textarea v-model="config.prompt" rows="8" placeholder="描述要生成的图片" />
        </label>

        <p v-if="error" class="error-line inline">{{ error }}</p>
        <p v-if="result" class="notice-line">{{ result }}</p>

        <button class="send-button image-submit" type="submit" :disabled="loading || !config.prompt.trim()">
          <LoaderCircle v-if="loading" :size="18" class="spin" />
          <ImagePlus v-else :size="18" />
          <span>{{ loading ? "提交中" : "生成图片" }}</span>
        </button>
      </form>

      <div class="image-preview">
        <div class="preview-empty">
          <ImageIcon :size="42" />
          <strong>生成预览</strong>
          <span>等待聚合配置</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { CheckCircle2, Eye, EyeOff, Image as ImageIcon, ImagePlus, KeyRound, LoaderCircle } from "lucide-vue-next";

import { generateImage } from "../services/api";
import type { ModelProfile } from "../types/chat";
import type { ImageGenerationConfig } from "../types/images";

const props = defineProps<{
  backendOnline: boolean;
  profiles: ModelProfile[];
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
