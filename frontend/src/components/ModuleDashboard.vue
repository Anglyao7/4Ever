<template>
  <section class="dashboard-panel" aria-label="平台模块">
    <div class="home-hero">
      <div class="hero-copy greeting-copy">
        <p class="eyebrow">见微知著</p>
        <h1>{{ greeting }}，{{ displayName }}</h1>
      </div>

      <div class="hero-system" aria-label="系统结构">
        <div class="system-topline">
          <span class="status-pill online">System Map</span>
          <small>{{ modules.length }} paths</small>
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
        <h2>模块入口</h2>
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
          <h3>{{ module.name }}</h3>
          <p>{{ module.description }}</p>
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
  PlugZap,
  Shield,
  Workflow,
} from "lucide-vue-next";

import type { PlatformModule } from "../types/platform";

const props = defineProps<{
  modules: PlatformModule[];
  backendOnline: boolean;
  displayName: string;
}>();

defineEmits<{
  open: [moduleId: string];
}>();

const now = ref(new Date());
let clockTimer: number | undefined;

const visibleNodes = computed(() => props.modules.filter((module) => module.id !== "dashboard").slice(0, 5));
const displayName = computed(() => props.displayName || "访客");

const greeting = computed(() => {
  const hour = now.value.getHours();
  if (hour >= 5 && hour < 12) {
    return "早上好";
  }
  if (hour >= 12 && hour < 14) {
    return "中午好";
  }
  if (hour >= 18 || hour < 5) {
    return "晚上好";
  }
  return "下午好";
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
    workflow: "automation",
    admin: "Self",
  };
  return labels[moduleId as keyof typeof labels] ?? moduleId;
}
</script>
