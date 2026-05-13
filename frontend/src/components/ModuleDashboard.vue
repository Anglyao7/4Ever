<template>
  <section class="dashboard-panel" :aria-label="copy.panelAria">
    <div class="home-hero">
      <div class="hero-copy greeting-copy">
        <p class="eyebrow">{{ moduleName("dashboard") }}</p>
        <h1>{{ greeting }}，{{ displayName }}</h1>
      </div>

      <div class="hero-system" :aria-label="copy.systemAria">
        <div class="system-topline">
          <span class="status-pill online">System Map</span>
          <small>{{ modules.length }} {{ copy.paths }}</small>
        </div>

        <div class="system-map" aria-hidden="true">
          <div class="system-node main-node">
            <Layers3 :size="22" />
          </div>
          <div
            v-for="module in visibleNodes"
            :key="module.id"
            class="system-node"
            :class="`node-${module.id}`"
          >
            <component :is="moduleIcon(module.id)" :size="18" />
          </div>
          <span class="system-line line-one" />
          <span class="system-line line-two" />
          <span class="system-line line-three" />
          <span class="system-line line-four" />
        </div>
      </div>
    </div>

    <div class="dashboard-heading">
      <div>
        <p class="eyebrow">Modules</p>
        <h2>{{ copy.moduleEntry }}</h2>
      </div>
    </div>

    <div class="module-grid">
      <button
        v-for="module in modules"
        :key="module.id"
        class="module-card"
        type="button"
        @click="$emit('open', module.id)"
      >
        <div class="module-card-icon" :class="`module-card-icon-${module.category}`">
          <component :is="moduleIcon(module.id)" :size="22" />
        </div>
        <div class="module-card-body">
          <span>{{ moduleEnglishName(module.id) }}</span>
          <h3>{{ moduleName(module.id) }}</h3>
          <p>{{ moduleDescription(module.id, module.description) }}</p>
        </div>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  Blocks,
  Image,
  LayoutDashboard,
  Layers3,
  MessageSquareText,
  NotebookPen,
  PlugZap,
  Shield,
  Workflow,
} from "lucide-vue-next";

import type { PlatformModule } from "../types/platform";

const props = defineProps<{
  modules: PlatformModule[];
  backendOnline: boolean;
  displayName: string;
  language: "zh-CN" | "en-US";
}>();

defineEmits<{
  open: [moduleId: string];
}>();

const now = ref(new Date());
let clockTimer: number | undefined;

const visibleNodes = computed(() => props.modules.filter((module) => module.id !== "dashboard").slice(0, 5));
const displayName = computed(() => props.displayName || copy.value.visitor);
const copy = computed(() =>
  props.language === "en-US"
    ? {
        panelAria: "Platform modules",
        systemAria: "System structure",
        paths: "paths",
        moduleEntry: "Module Entry",
        visitor: "Guest",
        morning: "Good morning",
        noon: "Good noon",
        afternoon: "Good afternoon",
        evening: "Good evening",
      }
    : {
        panelAria: "平台模块",
        systemAria: "系统结构",
        paths: "paths",
        moduleEntry: "模块入口",
        visitor: "访客",
        morning: "早上好",
        noon: "中午好",
        afternoon: "下午好",
        evening: "晚上好",
      },
);

const greeting = computed(() => {
  const hour = now.value.getHours();
  if (hour >= 5 && hour < 12) {
    return copy.value.morning;
  }
  if (hour >= 12 && hour < 14) {
    return copy.value.noon;
  }
  if (hour >= 18 || hour < 5) {
    return copy.value.evening;
  }
  return copy.value.afternoon;
});

onMounted(() => {
  clockTimer = window.setInterval(() => {
    now.value = new Date();
  }, 60_000);
});

onBeforeUnmount(() => {
  if (clockTimer) {
    window.clearInterval(clockTimer);
  }
});

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

function moduleName(moduleId: string) {
  const labels = {
    dashboard: ["见微知著", "Insight"],
    chat: ["交耳", "Chat"],
    "image-generation": ["虚实", "Image"],
    "provider-hub": ["聚合", "Aggregation"],
    notes: ["笔记", "Notes"],
    workflow: ["秩序", "Automation"],
    admin: ["自我", "Self"],
  };
  const pair = labels[moduleId as keyof typeof labels];
  return pair ? pair[props.language === "en-US" ? 1 : 0] : moduleId;
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
    workflow: "Orchestrate workflows, task nodes, and triggers.",
    admin: "Profile, private diary, and account security.",
  };
  return descriptions[moduleId as keyof typeof descriptions] ?? fallback;
}
</script>
