<template>
  <section class="memory-map-panel" :aria-label="copy.panelAria">
    <div class="module-view-header memory-map-header">
      <div>
        <p class="eyebrow">Poetry Atlas</p>
        <h1>{{ copy.title }}</h1>
      </div>
      <div class="memory-map-actions">
        <span class="memory-map-mode">{{ activeWeatherLabel }}</span>
        <button type="button" @click="resetView">
          <RotateCcw :size="16" />
          <span>{{ copy.reset }}</span>
        </button>
      </div>
    </div>

    <div class="memory-map-workspace">
      <div class="memory-map-stage" :class="`weather-${activeWeather}`">
        <div ref="mapRef" class="tencent-map-canvas" />
        <div class="map-terrain-tint" />
        <div class="weather-layer" aria-hidden="true">
          <span v-for="index in 34" :key="index" />
        </div>
        <div v-if="loading" class="memory-map-state">
          <LoaderCircle :size="20" class="spin" />
          <span>{{ copy.loading }}</span>
        </div>
        <div v-else-if="error" class="memory-map-state error">
          <TriangleAlert :size="20" />
          <span>{{ error }}</span>
        </div>
        <div class="memory-map-hint">
          <Move3D :size="16" />
          <span>{{ copy.hint }}</span>
        </div>
      </div>

      <aside class="memory-map-sidebar">
        <div class="memory-map-stat">
          <strong>{{ poems.length }}</strong>
          <span>{{ copy.points }}</span>
        </div>

        <div class="weather-switcher" :aria-label="copy.weather">
          <button
            v-for="weather in weatherOptions"
            :key="weather.value"
            type="button"
            :class="{ active: activeWeather === weather.value }"
            @click="activeWeather = weather.value"
          >
            {{ weather.label }}
          </button>
        </div>

        <div class="memory-map-list">
          <button
            v-for="poem in filteredPoems"
            :key="poem.id"
            :class="{ active: poem.id === activePoemId }"
            type="button"
            @click="focusPoem(poem)"
          >
            <i :style="{ background: poem.color }" />
            <span>{{ poem.title }}</span>
            <small>{{ poem.place }} / {{ poem.author }}</small>
          </button>
        </div>
      </aside>
    </div>

    <Transition name="poem-card">
      <article v-if="activePoem" class="poem-detail-card" :class="`scene-${activePoem.weather}`">
        <button class="poem-card-close" type="button" :title="copy.close" @click="activePoemId = ''">
          <X :size="18" />
        </button>
        <div class="poem-scene">
          <span>{{ activePoem.scene }}</span>
        </div>
        <div class="poem-card-body">
          <p class="eyebrow">{{ activePoem.place }}</p>
          <h2>{{ activePoem.title }}</h2>
          <strong>{{ activePoem.author }}</strong>
          <blockquote>{{ activePoem.excerpt }}</blockquote>
          <p>{{ activePoem.background }}</p>
        </div>
      </article>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { LoaderCircle, Move3D, RotateCcw, TriangleAlert, X } from "lucide-vue-next";

import { fetchTencentMapConfig } from "../services/api";

type WeatherType = "all" | "rain" | "snow" | "sand" | "mist";

type PoemPoint = {
  id: string;
  title: string;
  author: string;
  place: string;
  lat: number;
  lon: number;
  color: string;
  weather: Exclude<WeatherType, "all">;
  scene: string;
  excerpt: string;
  background: string;
};

type TencentLatLng = unknown;
type TencentMapInstance = {
  setCenter?: (center: TencentLatLng) => void;
  setZoom?: (zoom: number) => void;
  setPitch?: (pitch: number) => void;
  setRotation?: (rotation: number) => void;
  destroy?: () => void;
};
type TencentLayer = {
  setMap?: (map: TencentMapInstance | null) => void;
  on?: (event: string, handler: (event: { geometry?: { id?: string } }) => void) => void;
};
type TencentMapNamespace = {
  LatLng: new (lat: number, lon: number) => TencentLatLng;
  Map: new (container: HTMLElement, options: Record<string, unknown>) => TencentMapInstance;
  MultiLabel?: new (options: Record<string, unknown>) => TencentLayer;
  MultiMarker?: new (options: Record<string, unknown>) => TencentLayer;
  LabelStyle?: new (options: Record<string, unknown>) => unknown;
  MarkerStyle?: new (options: Record<string, unknown>) => unknown;
};

declare global {
  interface Window {
    TMap?: TencentMapNamespace;
    __initTencentMemoryMap?: () => void;
  }
}

const props = defineProps<{
  language: "zh-CN" | "en-US";
}>();

const copy = computed(() =>
  props.language === "en-US"
    ? {
        panelAria: "Poetry memory map",
        title: "Poetry Atlas",
        reset: "China View",
        close: "Close",
        hint: "Tencent Map GL: zoom, pan, click a poem",
        loading: "Loading Tencent Map",
        mapUnavailable: "Tencent Map failed to load.",
        configMissing: "Tencent map key is not configured.",
        points: "poetry places",
        weather: "Weather scenes",
      }
    : {
        panelAria: "诗词地理纪念地图",
        title: "诗词地理纪念地图",
        reset: "中国视角",
        close: "关闭",
        hint: "腾讯地图 GL：缩放、平移、点击诗词",
        loading: "正在加载腾讯地图",
        mapUnavailable: "腾讯地图加载失败。",
        configMissing: "腾讯地图 Key 未配置。",
        points: "处诗词地点",
        weather: "自然景观",
      },
);

const poems: PoemPoint[] = [
  {
    id: "lushan",
    title: "望庐山瀑布",
    author: "李白",
    place: "庐山瀑布",
    lat: 29.56,
    lon: 115.97,
    color: "#2d6f63",
    weather: "mist",
    scene: "山岚 / 飞瀑",
    excerpt: "飞流直下三千尺，疑是银河落九天。",
    background: "诗人以夸张笔法写庐山香炉峰瀑布，山雾、水汽和垂落的白练共同构成壮阔景象。",
  },
  {
    id: "yellow-crane",
    title: "黄鹤楼",
    author: "崔颢",
    place: "武汉黄鹤楼",
    lat: 30.55,
    lon: 114.3,
    color: "#b7791f",
    weather: "mist",
    scene: "江城 / 晴川",
    excerpt: "晴川历历汉阳树，芳草萋萋鹦鹉洲。",
    background: "黄鹤楼临江而立，诗中将楼台传说、江汉平野和远眺乡愁叠合在一起。",
  },
  {
    id: "jiangnan",
    title: "江南春",
    author: "杜牧",
    place: "江南水乡",
    lat: 31.3,
    lon: 120.6,
    color: "#1f6feb",
    weather: "rain",
    scene: "细雨 / 水乡",
    excerpt: "千里莺啼绿映红，水村山郭酒旗风。",
    background: "江南春景以水网、村落、山郭和轻雨组成，适合用湿润、低饱和的雨幕表达。",
  },
  {
    id: "frontier",
    title: "使至塞上",
    author: "王维",
    place: "河西走廊",
    lat: 39.73,
    lon: 98.49,
    color: "#c47a2c",
    weather: "sand",
    scene: "大漠 / 长河",
    excerpt: "大漠孤烟直，长河落日圆。",
    background: "边塞空间辽阔，孤烟、落日和黄沙形成强烈的地平线叙事。",
  },
  {
    id: "north-snow",
    title: "逢雪宿芙蓉山主人",
    author: "刘长卿",
    place: "东北雪原",
    lat: 45.8,
    lon: 126.53,
    color: "#7a92b8",
    weather: "snow",
    scene: "暮雪 / 山村",
    excerpt: "柴门闻犬吠，风雪夜归人。",
    background: "这首诗的情绪来自雪夜、山村和归人的声音，适合用缓慢飘雪营造寒意。",
  },
];

const weatherOptions = computed<Array<{ value: WeatherType; label: string }>>(() => [
  { value: "all", label: props.language === "en-US" ? "All" : "全部" },
  { value: "rain", label: props.language === "en-US" ? "Rain" : "江南细雨" },
  { value: "snow", label: props.language === "en-US" ? "Snow" : "东北飘雪" },
  { value: "sand", label: props.language === "en-US" ? "Sand" : "西域黄沙" },
  { value: "mist", label: props.language === "en-US" ? "Mist" : "山水烟岚" },
]);

const mapRef = ref<HTMLElement | null>(null);
const loading = ref(true);
const error = ref("");
const activePoemId = ref("");
const activeWeather = ref<WeatherType>("all");

const filteredPoems = computed(() =>
  activeWeather.value === "all" ? poems : poems.filter((poem) => poem.weather === activeWeather.value),
);
const activePoem = computed(() => poems.find((poem) => poem.id === activePoemId.value));
const activeWeatherLabel = computed(() => {
  if (activePoem.value) {
    return activePoem.value.scene;
  }
  return weatherOptions.value.find((weather) => weather.value === activeWeather.value)?.label ?? copy.value.weather;
});

let tencentMap: TencentMapInstance | null = null;
let labelLayer: TencentLayer | null = null;
let markerLayer: TencentLayer | null = null;

onMounted(() => {
  initializeTencentMap();
});

onBeforeUnmount(() => {
  labelLayer?.setMap?.(null);
  markerLayer?.setMap?.(null);
  tencentMap?.destroy?.();
  labelLayer = null;
  markerLayer = null;
  tencentMap = null;
});

watch(activeWeather, () => {
  activePoemId.value = "";
  renderPoemLayers();
});

async function initializeTencentMap() {
  loading.value = true;
  error.value = "";
  try {
    const config = await fetchTencentMapConfig();
    if (!config.map_key) {
      throw new Error(copy.value.configMissing);
    }
    await loadTencentMapSdk(config.map_key);
    createMap();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : copy.value.mapUnavailable;
  } finally {
    loading.value = false;
  }
}

function createMap() {
  if (!mapRef.value || !window.TMap) {
    throw new Error(copy.value.mapUnavailable);
  }
  const namespace = window.TMap;
  tencentMap = new namespace.Map(mapRef.value, {
    center: new namespace.LatLng(34.2, 108.95),
    zoom: 4.7,
    pitch: 42,
    rotation: 0,
    viewMode: "3D",
    showControl: true,
    baseMap: {
      type: "satellite",
    },
  });
  renderPoemLayers();
}

function renderPoemLayers() {
  if (!tencentMap || !window.TMap) {
    return;
  }
  const namespace = window.TMap;
  labelLayer?.setMap?.(null);
  markerLayer?.setMap?.(null);
  createMarkers(namespace);
  createLabels(namespace);
}

function createMarkers(namespace: TencentMapNamespace) {
  if (!tencentMap || !namespace.MultiMarker) {
    return;
  }
  const markerStyle = namespace.MarkerStyle
    ? new namespace.MarkerStyle({
        width: 18,
        height: 24,
        anchor: { x: 9, y: 24 },
      })
    : undefined;
  markerLayer = new namespace.MultiMarker({
    map: tencentMap,
    styles: markerStyle ? { poem: markerStyle } : undefined,
    geometries: filteredPoems.value.map((poem) => ({
      id: poem.id,
      styleId: markerStyle ? "poem" : undefined,
      position: new namespace.LatLng(poem.lat, poem.lon),
      properties: { title: poem.title },
    })),
  });
  markerLayer.on?.("click", (event) => {
    const poem = poems.find((item) => item.id === event.geometry?.id);
    if (poem) {
      focusPoem(poem);
    }
  });
}

function createLabels(namespace: TencentMapNamespace) {
  if (!tencentMap || !namespace.MultiLabel) {
    return;
  }
  const labelStyle = namespace.LabelStyle
    ? new namespace.LabelStyle({
        color: "#17212f",
        size: 15,
        offset: { x: 0, y: -38 },
        angle: 0,
        strokeColor: "#fffdf8",
        strokeWidth: 4,
      })
    : undefined;
  labelLayer = new namespace.MultiLabel({
    map: tencentMap,
    styles: labelStyle ? { poem: labelStyle } : undefined,
    geometries: filteredPoems.value.map((poem) => ({
      id: poem.id,
      styleId: labelStyle ? "poem" : undefined,
      position: new namespace.LatLng(poem.lat, poem.lon),
      content: `《${poem.title}》`,
      properties: { title: poem.title },
    })),
  });
  labelLayer.on?.("click", (event) => {
    const poem = poems.find((item) => item.id === event.geometry?.id);
    if (poem) {
      focusPoem(poem);
    }
  });
}

function resetView() {
  activePoemId.value = "";
  activeWeather.value = "all";
  if (!tencentMap || !window.TMap) {
    return;
  }
  tencentMap.setCenter?.(new window.TMap.LatLng(34.2, 108.95));
  tencentMap.setZoom?.(4.7);
  tencentMap.setPitch?.(42);
  tencentMap.setRotation?.(0);
}

function focusPoem(poem: PoemPoint) {
  activePoemId.value = poem.id;
  activeWeather.value = poem.weather;
  if (!tencentMap || !window.TMap) {
    return;
  }
  tencentMap.setCenter?.(new window.TMap.LatLng(poem.lat, poem.lon));
  tencentMap.setZoom?.(8.4);
  tencentMap.setPitch?.(54);
}

function loadTencentMapSdk(mapKey: string) {
  return new Promise<void>((resolve, reject) => {
    if (window.TMap) {
      resolve();
      return;
    }
    const existingScript = document.querySelector<HTMLScriptElement>("script[data-tencent-map-sdk='true']");
    const timeoutId = window.setTimeout(() => {
      reject(new Error(copy.value.mapUnavailable));
    }, 12_000);

    window.__initTencentMemoryMap = () => {
      window.clearTimeout(timeoutId);
      resolve();
    };

    if (existingScript) {
      existingScript.addEventListener("load", () => window.__initTencentMemoryMap?.(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error(copy.value.mapUnavailable)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(mapKey)}&callback=__initTencentMemoryMap`;
    script.async = true;
    script.defer = true;
    script.dataset.tencentMapSdk = "true";
    script.addEventListener("error", () => {
      window.clearTimeout(timeoutId);
      reject(new Error(copy.value.mapUnavailable));
    });
    document.head.appendChild(script);
  });
}
</script>

<style scoped>
.memory-map-panel {
  position: relative;
  height: min(820px, calc(100vh - 142px));
  min-height: 600px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 16px;
  overflow: hidden;
}

.memory-map-header {
  align-items: center;
}

.memory-map-actions {
  align-items: center;
  display: inline-flex;
  gap: 8px;
}

.memory-map-actions button,
.memory-map-list button,
.weather-switcher button {
  font: inherit;
}

.memory-map-actions button {
  height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(214, 221, 214, 0.92);
  border-radius: 8px;
  font-weight: 800;
}

.memory-map-mode {
  height: 36px;
  display: inline-flex;
  align-items: center;
  padding: 0 11px;
  color: #f7fbf7;
  background: #17212f;
  border: 1px solid rgba(23, 33, 47, 0.2);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 900;
}

.memory-map-workspace {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 14px;
  overflow: hidden;
}

.memory-map-stage {
  position: relative;
  min-height: 0;
  overflow: hidden;
  background: #101410;
  border: 1px solid rgba(214, 221, 214, 0.94);
  border-radius: 8px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 16px 44px rgba(32, 38, 36, 0.08);
}

.map-terrain-tint,
.memory-map-stage::after,
.weather-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.map-terrain-tint {
  z-index: 1;
  background:
    radial-gradient(circle at 45% 38%, rgba(45, 111, 99, 0.14), transparent 40%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(12, 16, 14, 0.2));
  mix-blend-mode: soft-light;
}

.memory-map-stage::after {
  content: "";
  z-index: 2;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.16),
    inset 0 -90px 140px rgba(12, 16, 14, 0.18);
}

.tencent-map-canvas {
  position: absolute;
  inset: 0;
}

.weather-layer {
  z-index: 3;
  overflow: hidden;
}

.weather-layer span {
  position: absolute;
  left: calc((var(--index, 1) * 29px) % 100%);
  top: -10%;
}

.weather-layer span:nth-child(n) {
  --index: 1;
}

.weather-layer span:nth-child(2n) {
  --index: 2;
}

.weather-layer span:nth-child(3n) {
  --index: 3;
}

.weather-layer span:nth-child(4n) {
  --index: 4;
}

.weather-layer span:nth-child(5n) {
  --index: 5;
}

.weather-rain .weather-layer span {
  width: 1px;
  height: 56px;
  background: linear-gradient(180deg, transparent, rgba(174, 210, 230, 0.68));
  animation: rainFall 920ms linear infinite;
}

.weather-snow .weather-layer span {
  width: 5px;
  height: 5px;
  background: rgba(255, 255, 255, 0.84);
  border-radius: 999px;
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.36);
  animation: snowFall 5200ms linear infinite;
}

.weather-sand .weather-layer {
  background:
    linear-gradient(100deg, rgba(194, 122, 44, 0.2), transparent 46%),
    linear-gradient(180deg, rgba(210, 161, 84, 0.12), rgba(123, 74, 29, 0.18));
  animation: sandDrift 2600ms ease-in-out infinite alternate;
}

.weather-sand .weather-layer span {
  width: 120px;
  height: 2px;
  background: rgba(230, 183, 113, 0.42);
  filter: blur(1px);
  animation: sandLine 2200ms linear infinite;
}

.weather-mist .weather-layer {
  background:
    radial-gradient(circle at 30% 40%, rgba(255, 255, 255, 0.24), transparent 28%),
    radial-gradient(circle at 70% 58%, rgba(255, 255, 255, 0.18), transparent 30%);
  filter: blur(1px);
  animation: mistFloat 5200ms ease-in-out infinite alternate;
}

.memory-map-state {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--muted);
  background: rgba(247, 250, 247, 0.84);
  font-size: 13px;
  font-weight: 850;
  backdrop-filter: blur(12px);
}

.memory-map-state.error {
  color: #9b1c1c;
}

.memory-map-hint {
  position: absolute;
  left: 14px;
  bottom: 14px;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(214, 221, 214, 0.86);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 800;
  backdrop-filter: blur(10px);
}

.memory-map-sidebar {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 10px;
}

.memory-map-stat,
.weather-switcher,
.memory-map-list button {
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(214, 221, 214, 0.92);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(32, 38, 36, 0.06);
}

.memory-map-stat {
  padding: 14px;
  display: grid;
  gap: 2px;
}

.memory-map-stat strong {
  color: var(--ink);
  font-size: 28px;
  line-height: 1;
}

.memory-map-stat span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.weather-switcher {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 8px;
}

.weather-switcher button {
  height: 30px;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
  transition:
    color 0.22s ease,
    background 0.22s ease,
    border-color 0.22s ease,
    box-shadow 0.22s ease,
    transform 0.22s ease;
}

.weather-switcher button.active {
  color: #fffdf8;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.16), transparent 42%),
    #2f8d68;
  box-shadow:
    0 12px 26px rgba(47, 141, 104, 0.24),
    0 0 0 3px rgba(47, 141, 104, 0.12);
  transform: translateY(-1px);
  animation: optionSelectPop 0.28s ease both;
}

.memory-map-list {
  display: grid;
  align-content: start;
  gap: 8px;
  overflow: auto;
}

.memory-map-list button {
  min-width: 0;
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 3px 9px;
  padding: 11px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.memory-map-list button.active,
.memory-map-list button:hover {
  border-color: rgba(45, 111, 99, 0.34);
  box-shadow: 0 12px 30px rgba(32, 38, 36, 0.1);
  transform: translateY(-1px);
}

.memory-map-list button.active {
  color: var(--accent-strong);
  background:
    linear-gradient(135deg, rgba(47, 141, 104, 0.12), rgba(255, 255, 255, 0.64)),
    rgba(255, 255, 255, 0.68);
  border-color: rgba(40, 126, 89, 0.62);
  box-shadow:
    0 12px 26px rgba(47, 141, 104, 0.18),
    0 0 0 3px rgba(47, 141, 104, 0.1);
  animation: optionSelectPop 0.28s ease both;
}

@keyframes optionSelectPop {
  0% {
    transform: translateY(0) scale(0.98);
    box-shadow: 0 0 0 0 rgba(47, 141, 104, 0);
  }
  65% {
    transform: translateY(-3px) scale(1.02);
    box-shadow: 0 12px 24px rgba(47, 141, 104, 0.18), 0 0 0 8px rgba(47, 141, 104, 0.06);
  }
  100% {
    transform: translateY(-1px) scale(1);
    box-shadow:
      0 12px 26px rgba(47, 141, 104, 0.24),
      0 0 0 3px rgba(47, 141, 104, 0.12);
  }
}

.memory-map-list i {
  width: 10px;
  height: 10px;
  margin-top: 4px;
  border-radius: 999px;
  grid-row: span 2;
}

.memory-map-list span,
.memory-map-list small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memory-map-list span {
  color: var(--ink);
  font-size: 13px;
  font-weight: 900;
}

.memory-map-list small {
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
}

.poem-detail-card {
  position: absolute;
  left: 44px;
  bottom: 34px;
  z-index: 20;
  width: min(420px, calc(100% - 88px));
  overflow: hidden;
  background: rgba(255, 253, 248, 0.94);
  border: 1px solid rgba(214, 221, 214, 0.92);
  border-radius: 8px;
  box-shadow: 0 24px 70px rgba(12, 16, 14, 0.22);
  backdrop-filter: blur(18px);
}

.poem-card-close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(214, 221, 214, 0.86);
  border-radius: 8px;
}

.poem-scene {
  min-height: 118px;
  display: flex;
  align-items: flex-end;
  padding: 18px;
  color: #fffdf8;
  background:
    linear-gradient(180deg, transparent 20%, rgba(12, 16, 14, 0.62)),
    linear-gradient(135deg, #2d6f63, #17212f);
}

.scene-rain .poem-scene {
  background:
    linear-gradient(180deg, transparent 20%, rgba(12, 16, 14, 0.62)),
    linear-gradient(135deg, #315f8a, #2d6f63);
}

.scene-snow .poem-scene {
  background:
    linear-gradient(180deg, transparent 20%, rgba(12, 16, 14, 0.54)),
    linear-gradient(135deg, #7890a8, #f4f7f8);
}

.scene-sand .poem-scene {
  background:
    linear-gradient(180deg, transparent 20%, rgba(12, 16, 14, 0.62)),
    linear-gradient(135deg, #c47a2c, #7c4a1d);
}

.poem-scene span {
  font-size: 13px;
  font-weight: 900;
}

.poem-card-body {
  display: grid;
  gap: 8px;
  padding: 16px;
}

.poem-card-body h2,
.poem-card-body p,
.poem-card-body blockquote {
  margin: 0;
}

.poem-card-body h2 {
  color: var(--ink);
  font-size: 22px;
}

.poem-card-body strong {
  color: var(--muted);
  font-size: 13px;
}

.poem-card-body blockquote {
  padding-left: 12px;
  color: #2d6f63;
  border-left: 3px solid rgba(45, 111, 99, 0.32);
  font-size: 15px;
  font-weight: 900;
  line-height: 1.7;
}

.poem-card-body p:last-child {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}

.spin {
  animation: spin 850ms linear infinite;
}

.poem-card-enter-active,
.poem-card-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.poem-card-enter-from,
.poem-card-leave-to {
  opacity: 0;
  transform: translateY(14px) scale(0.98);
}

@keyframes rainFall {
  to {
    transform: translate3d(-70px, 780px, 0);
  }
}

@keyframes snowFall {
  to {
    transform: translate3d(34px, 760px, 0);
  }
}

@keyframes sandDrift {
  to {
    transform: translateX(-18px);
  }
}

@keyframes sandLine {
  to {
    transform: translate3d(-260px, 760px, 0);
  }
}

@keyframes mistFloat {
  to {
    transform: translate3d(22px, -10px, 0) scale(1.04);
  }
}

@media (max-width: 960px) {
  .memory-map-workspace {
    grid-template-columns: 1fr;
    grid-template-rows: 520px auto;
  }

  .memory-map-panel {
    height: auto;
    min-height: 0;
    overflow: visible;
  }

  .memory-map-sidebar {
    grid-template-columns: 120px minmax(0, 1fr);
  }

  .memory-map-list {
    grid-auto-flow: column;
    grid-auto-columns: minmax(180px, 1fr);
    overflow-x: auto;
  }

  .poem-detail-card {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: 16px;
    width: auto;
  }
}

@media (max-width: 640px) {
  .memory-map-workspace {
    grid-template-rows: 440px auto;
  }

  .memory-map-sidebar {
    grid-template-columns: 1fr;
  }
}

:global(:root[data-color-mode="dark"]) .memory-map-stage {
  border-color: rgba(202, 211, 204, 0.18);
}

:global(:root[data-color-mode="dark"]) .memory-map-actions button,
:global(:root[data-color-mode="dark"]) .memory-map-hint,
:global(:root[data-color-mode="dark"]) .memory-map-stat,
:global(:root[data-color-mode="dark"]) .weather-switcher,
:global(:root[data-color-mode="dark"]) .memory-map-list button,
:global(:root[data-color-mode="dark"]) .poem-detail-card {
  color: var(--ink);
  background: rgba(255, 255, 255, 0.075);
  border-color: rgba(202, 211, 204, 0.18);
}

:global(:root[data-color-mode="dark"]) .memory-map-mode {
  color: #f7fbf7;
  background: #315f55;
  border-color: rgba(143, 213, 196, 0.26);
}

:global(:root[data-color-mode="dark"]) .memory-map-state {
  background: rgba(16, 20, 16, 0.84);
}
</style>
