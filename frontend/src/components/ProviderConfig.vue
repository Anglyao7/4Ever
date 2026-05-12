<template>
  <section class="config-panel" aria-label="模型配置">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Provider</p>
        <h2>聚合</h2>
      </div>
      <span class="status-pill" :class="{ online: backendOnline }">
        <CheckCircle2 :size="16" />
        {{ backendOnline ? "API 就绪" : "API 离线" }}
      </span>
    </div>

    <div class="provider-tabs" role="tablist" aria-label="模型格式">
      <button
        v-for="provider in providers"
        :key="provider.id"
        class="provider-tab"
        :class="{ active: modelValue.provider === provider.id }"
        type="button"
        @click="selectProvider(provider)"
      >
        <component :is="providerIcon(provider.id)" :size="17" />
        <span>{{ providerName(provider.id) }}</span>
      </button>
    </div>

    <div class="form-grid">
      <label>
        <span>Base URL</span>
        <input
          :value="modelValue.baseUrl"
          placeholder="https://api.example.com/v1"
          autocomplete="off"
          @input="update('baseUrl', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <label>
        <span>API Key</span>
        <div class="input-with-icon key-field">
          <KeyRound :size="16" />
          <input
            :value="modelValue.apiKey"
            :type="showApiKey ? 'text' : 'password'"
            placeholder="可留空，用于本地兼容接口"
            autocomplete="off"
            @input="update('apiKey', ($event.target as HTMLInputElement).value)"
          />
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
        <input
          :value="modelValue.model"
          placeholder="模型名称"
          autocomplete="off"
          @input="update('model', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <label>
        <span>Max Tokens</span>
        <input
          :value="modelValue.maxTokens"
          type="number"
          min="1"
          step="1"
          @input="updateNumber('maxTokens', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>

    <div class="range-row">
      <label for="temperature">Temperature</label>
      <input
        id="temperature"
        :value="modelValue.temperature"
        type="range"
        min="0"
        max="2"
        step="0.1"
        @input="updateNumber('temperature', ($event.target as HTMLInputElement).value)"
      />
      <output>{{ modelValue.temperature.toFixed(1) }}</output>
    </div>

    <label class="system-prompt">
      <span>System Prompt</span>
      <textarea
        :value="modelValue.systemPrompt"
        rows="4"
        placeholder="给模型的系统指令"
        @input="update('systemPrompt', ($event.target as HTMLTextAreaElement).value)"
      />
    </label>

    <div v-if="activeProvider" class="format-strip">
      <span>{{ activeProvider.auth_label }}</span>
      <span>{{ activeProvider.endpoint }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Bot, CheckCircle2, Eye, EyeOff, KeyRound, MessagesSquare, Sparkles } from "lucide-vue-next";

import type { ChatConfig, ProviderFormat, ProviderInfo } from "../types/chat";

const props = defineProps<{
  modelValue: ChatConfig;
  providers: ProviderInfo[];
  backendOnline: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: ChatConfig];
}>();

const activeProvider = computed(() => props.providers.find((item) => item.id === props.modelValue.provider));
const showApiKey = ref(false);

function update<K extends keyof ChatConfig>(key: K, value: ChatConfig[K]) {
  emit("update:modelValue", {
    ...props.modelValue,
    [key]: value,
  });
}

function updateNumber(key: "temperature" | "maxTokens", value: string) {
  update(key, Number(value));
}

function selectProvider(provider: ProviderInfo) {
  emit("update:modelValue", {
    ...props.modelValue,
    provider: provider.id,
    baseUrl: provider.default_base_url,
    model: provider.default_model,
  });
}

function providerName(provider: ProviderFormat) {
  const names: Record<ProviderFormat, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Gemini",
  };
  return names[provider];
}

function providerIcon(provider: ProviderFormat) {
  const icons = {
    openai: MessagesSquare,
    anthropic: Bot,
    gemini: Sparkles,
  };
  return icons[provider];
}
</script>
