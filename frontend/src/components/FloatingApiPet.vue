<template>
  <div
    v-if="pet"
    ref="petRef"
    class="floating-api-pet"
    :class="{ dragging: dragging }"
    :style="petStyle"
    role="button"
    tabindex="0"
    :aria-label="petLabel"
    :title="petLabel"
    @pointerdown="startDrag"
  >
    <div class="floating-api-pet-shadow" aria-hidden="true" />
    <div class="floating-api-pet-card api-pet-character" :class="`api-pet-${pet.species}`">
      <img class="floating-api-pet-sprite" :src="petSprite" alt="" draggable="false" />
      <strong class="floating-api-pet-name">{{ pet.name }}</strong>
    </div>
    <span
      v-for="heart in hearts"
      :key="heart.id"
      class="floating-api-pet-heart"
      :style="{
        '--heart-x': `${heart.x}px`,
        '--heart-delay': `${heart.delay}ms`,
        '--heart-scale': heart.scale.toString(),
      }"
      aria-hidden="true"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ApiPet, PixelPetAppearance } from "../types/chat";

const props = defineProps<{
  pet?: ApiPet;
  profileName?: string;
  language: "zh-CN" | "en-US";
}>();

type Position = { x: number; y: number };
type Heart = { id: number; x: number; delay: number; scale: number };
type PixelPetAnimal = PixelPetAppearance["animal"];
type PixelPetExpression = PixelPetAppearance["expression"];

const storageKey = "4ever.floatingApiPet.position";
const petRef = ref<HTMLElement | null>(null);
const position = ref<Position>({ x: 0, y: 0 });
const hearts = ref<Heart[]>([]);
const dragging = ref(false);
let dragOffset = { x: 0, y: 0 };
let activePointerId: number | null = null;
let movedDuringPointer = false;
let heartId = 0;

const petLabel = computed(() => {
  if (!props.pet) {
    return "";
  }
  return props.language === "en-US"
    ? `${props.pet.name}, API companion`
    : `${props.pet.name}，API 宠物`;
});
const petStyle = computed(() => ({
  transform: `translate3d(${position.value.x}px, ${position.value.y}px, 0)`,
}));
const petSprite = computed(() => {
  if (!props.pet) {
    return "";
  }
  return pixelPetDataUrl(normalizePetAppearance(props.pet.appearance, props.pet.species));
});

onMounted(() => {
  position.value = loadPosition();
  window.addEventListener("resize", clampCurrentPosition);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", clampCurrentPosition);
  window.removeEventListener("pointermove", handleDrag);
  window.removeEventListener("pointerup", stopDrag);
  window.removeEventListener("pointercancel", stopDrag);
});

function startDrag(event: PointerEvent) {
  if (!petRef.value || event.button !== 0) {
    return;
  }
  activePointerId = event.pointerId;
  dragging.value = true;
  movedDuringPointer = false;
  const rect = petRef.value.getBoundingClientRect();
  dragOffset = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  window.addEventListener("pointermove", handleDrag);
  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);
  event.preventDefault();
}

function handleDrag(event: PointerEvent) {
  if (activePointerId !== event.pointerId) {
    return;
  }
  movedDuringPointer = true;
  position.value = clampPosition({
    x: event.clientX - dragOffset.x,
    y: event.clientY - dragOffset.y,
  });
}

function stopDrag(event: PointerEvent) {
  if (activePointerId !== event.pointerId) {
    return;
  }
  activePointerId = null;
  dragging.value = false;
  persistPosition();
  window.removeEventListener("pointermove", handleDrag);
  window.removeEventListener("pointerup", stopDrag);
  window.removeEventListener("pointercancel", stopDrag);
  if (!movedDuringPointer) {
    popHearts();
  }
}

function popHearts() {
  const burst = Array.from({ length: 6 }, (_, index) => ({
    id: heartId++,
    x: -28 + index * 11 + Math.round(Math.random() * 8 - 4),
    delay: index * 32,
    scale: 0.78 + Math.random() * 0.34,
  }));
  hearts.value = [...hearts.value, ...burst];
  window.setTimeout(() => {
    const ids = new Set(burst.map((heart) => heart.id));
    hearts.value = hearts.value.filter((heart) => !ids.has(heart.id));
  }, 980);
}

function loadPosition() {
  const fallback = defaultPosition();
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as Position;
    return clampPosition({
      x: Number.isFinite(parsed.x) ? parsed.x : fallback.x,
      y: Number.isFinite(parsed.y) ? parsed.y : fallback.y,
    });
  } catch {
    return fallback;
  }
}

function persistPosition() {
  localStorage.setItem(storageKey, JSON.stringify(position.value));
}

function defaultPosition() {
  const size = elementSize();
  return {
    x: Math.max(14, window.innerWidth - size.width - 26),
    y: Math.max(82, window.innerHeight - size.height - 34),
  };
}

function clampCurrentPosition() {
  position.value = clampPosition(position.value);
  persistPosition();
}

function clampPosition(value: Position) {
  const size = elementSize();
  const margin = 10;
  return {
    x: Math.min(Math.max(margin, value.x), Math.max(margin, window.innerWidth - size.width - margin)),
    y: Math.min(Math.max(margin, value.y), Math.max(margin, window.innerHeight - size.height - margin)),
  };
}

function elementSize() {
  const rect = petRef.value?.getBoundingClientRect();
  return {
    width: rect?.width || 134,
    height: rect?.height || 156,
  };
}

function pixelPetDataUrl(appearance: PixelPetAppearance) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(pixelPetSvg(appearance))}`;
}

function defaultPetAppearance(species: ApiPet["species"] = "panda"): PixelPetAppearance {
  const animal = speciesToAnimal(species);
  const palette: Record<PixelPetAnimal, Pick<PixelPetAppearance, "primaryColor" | "secondaryColor" | "accentColor" | "pattern">> = {
    cat: { primaryColor: "#e7a35f", secondaryColor: "#fff2d2", accentColor: "#d95f5f", pattern: "socks" },
    dog: { primaryColor: "#9b6a43", secondaryColor: "#f4dfb6", accentColor: "#4f8bd6", pattern: "spots" },
    rabbit: { primaryColor: "#f4e3db", secondaryColor: "#f0a9b5", accentColor: "#8dcf7a", pattern: "solid" },
    panda: { primaryColor: "#f7f0dc", secondaryColor: "#2e3433", accentColor: "#5fbf8f", pattern: "mask" },
    fox: { primaryColor: "#d78552", secondaryColor: "#ffffff", accentColor: "#3e8fd8", pattern: "split" },
    bird: { primaryColor: "#77b4d8", secondaryColor: "#f8f4e8", accentColor: "#e8b84d", pattern: "solid" },
    penguin: { primaryColor: "#2f3d4b", secondaryColor: "#f5f1df", accentColor: "#f0a13b", pattern: "solid" },
    hamster: { primaryColor: "#d8a56f", secondaryColor: "#fff0d0", accentColor: "#78b86d", pattern: "spots" },
    turtle: { primaryColor: "#6f9e62", secondaryColor: "#d7b16a", accentColor: "#5a7bd6", pattern: "socks" },
  };
  return {
    animal,
    ...palette[animal],
    expression: "happy",
    accessory: "none",
  };
}

function normalizePetAppearance(raw?: Partial<PixelPetAppearance>, species: ApiPet["species"] = "panda"): PixelPetAppearance {
  const fallback = defaultPetAppearance(species);
  const animals: PixelPetAnimal[] = ["cat", "dog", "rabbit", "panda", "fox", "bird", "penguin", "hamster", "turtle"];
  const expressions: PixelPetExpression[] = ["bright", "sleepy", "cool", "happy"];
  const patterns: PixelPetAppearance["pattern"][] = ["solid", "spots", "mask", "socks", "split"];
  const accessories: PixelPetAppearance["accessory"][] = ["none", "scarf", "bell", "leaf", "satchel"];

  return {
    animal: raw?.animal && animals.includes(raw.animal) ? raw.animal : fallback.animal,
    primaryColor: raw?.primaryColor || fallback.primaryColor,
    secondaryColor: raw?.secondaryColor || fallback.secondaryColor,
    accentColor: raw?.accentColor || fallback.accentColor,
    pattern: raw?.pattern && patterns.includes(raw.pattern) ? raw.pattern : fallback.pattern,
    expression: raw?.expression && expressions.includes(raw.expression) ? raw.expression : fallback.expression,
    accessory: raw?.accessory && accessories.includes(raw.accessory) ? raw.accessory : fallback.accessory,
  };
}

function speciesToAnimal(species: ApiPet["species"]): PixelPetAnimal {
  const legacy: Record<"spark" | "leaf" | "stone" | "cloud", PixelPetAnimal> = {
    spark: "panda",
    leaf: "rabbit",
    stone: "turtle",
    cloud: "bird",
  };
  if (species in legacy) {
    return legacy[species as keyof typeof legacy];
  }
  return species as PixelPetAnimal;
}

function pixelPetSvg(appearance: PixelPetAppearance) {
  const base = appearance.primaryColor;
  const patch = appearance.secondaryColor;
  const accent = appearance.accentColor;
  const dark = "#262a28";
  const blush = "#e58a92";
  const light = "#fff7e3";
  const parts: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, color: string, opacity = 1) => {
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" opacity="${opacity}"/>`);
  };
  const body = (x = 8, y = 13, w = 16, h = 13, color = base) => rect(x, y, w, h, color);
  const face = (x = 9, y = 8, w = 14, h = 12, color = base) => rect(x, y, w, h, color);
  const ear = (left: [number, number, number, number], right: [number, number, number, number], color = base) => {
    rect(...left, color);
    rect(...right, color);
  };

  rect(9, 25, 5, 2, dark, 0.22);
  rect(18, 25, 5, 2, dark, 0.22);

  if (appearance.animal === "rabbit") {
    ear([9, 2, 4, 8], [19, 2, 4, 8]);
    rect(10, 3, 2, 5, patch);
    rect(20, 3, 2, 5, patch);
    body(8, 14, 16, 12);
    face(9, 9, 14, 11);
    rect(23, 17, 3, 4, base);
  } else if (appearance.animal === "cat") {
    ear([8, 6, 5, 5], [19, 6, 5, 5]);
    rect(10, 8, 2, 2, patch);
    rect(20, 8, 2, 2, patch);
    body();
    face();
    rect(5, 16, 4, 3, base);
    rect(4, 15, 2, 2, base);
  } else if (appearance.animal === "dog") {
    rect(6, 8, 5, 8, patch);
    rect(21, 8, 5, 8, patch);
    body(8, 14, 16, 12);
    face(9, 8, 14, 12);
    rect(23, 17, 4, 3, base);
  } else if (appearance.animal === "panda") {
    ear([7, 7, 5, 5], [20, 7, 5, 5], patch);
    body(8, 14, 16, 12, patch);
    face(9, 8, 14, 12, base);
    rect(10, 11, 4, 5, patch);
    rect(18, 11, 4, 5, patch);
    rect(11, 20, 3, 5, base);
    rect(18, 20, 3, 5, base);
  } else if (appearance.animal === "fox") {
    ear([8, 5, 5, 6], [19, 5, 5, 6]);
    rect(10, 7, 2, 3, patch);
    rect(20, 7, 2, 3, patch);
    body(8, 14, 16, 12);
    face(9, 8, 14, 12);
    rect(12, 15, 8, 5, patch);
    rect(5, 16, 5, 4, base);
    rect(4, 18, 3, 3, patch);
  } else if (appearance.animal === "bird") {
    rect(11, 7, 10, 9, base);
    body(8, 13, 16, 13);
    rect(6, 15, 5, 7, patch);
    rect(21, 15, 5, 7, patch);
    rect(15, 12, 2, 3, accent);
    rect(13, 3, 6, 4, accent);
  } else if (appearance.animal === "penguin") {
    body(8, 9, 16, 17, base);
    rect(11, 10, 10, 13, patch);
    rect(6, 15, 3, 6, base);
    rect(23, 15, 3, 6, base);
    rect(13, 17, 6, 4, light);
    rect(14, 13, 4, 2, accent);
  } else if (appearance.animal === "hamster") {
    ear([7, 8, 5, 5], [20, 8, 5, 5], patch);
    body(8, 14, 16, 12);
    face(9, 9, 14, 11);
    rect(10, 16, 4, 4, patch);
    rect(18, 16, 4, 4, patch);
  } else {
    body(8, 14, 16, 11, patch);
    rect(6, 16, 20, 7, base);
    rect(10, 9, 12, 8, base);
    rect(8, 21, 3, 4, patch);
    rect(21, 21, 3, 4, patch);
  }

  drawPattern(appearance, rect, patch);
  drawFace(appearance.expression, rect, dark, blush, accent);
  drawAccessory(appearance, rect, dark, accent);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges"><rect width="32" height="32" fill="none"/>${parts.join("")}</svg>`;
}

function drawPattern(
  appearance: PixelPetAppearance,
  rect: (x: number, y: number, w: number, h: number, color: string, opacity?: number) => void,
  patch: string,
) {
  if (appearance.pattern === "spots") {
    rect(11, 14, 3, 3, patch);
    rect(19, 17, 3, 3, patch);
    rect(14, 22, 3, 2, patch);
  } else if (appearance.pattern === "mask") {
    rect(10, 11, 4, 4, patch);
    rect(18, 11, 4, 4, patch);
  } else if (appearance.pattern === "socks") {
    rect(9, 22, 4, 4, patch);
    rect(19, 22, 4, 4, patch);
  } else if (appearance.pattern === "split") {
    rect(16, 8, 7, 12, patch);
    rect(16, 14, 8, 12, patch);
  }
}

function drawFace(
  expression: PixelPetExpression,
  rect: (x: number, y: number, w: number, h: number, color: string, opacity?: number) => void,
  dark: string,
  blush: string,
  accent: string,
) {
  if (expression === "sleepy") {
    rect(11, 14, 4, 1, dark);
    rect(18, 14, 4, 1, dark);
    rect(15, 17, 3, 1, dark);
  } else if (expression === "cool") {
    rect(10, 13, 5, 2, dark);
    rect(18, 13, 5, 2, dark);
    rect(15, 14, 3, 1, dark);
    rect(14, 18, 4, 1, dark);
  } else {
    rect(12, 13, 2, 2, dark);
    rect(19, 13, 2, 2, dark);
    rect(15, 16, 2, 1, dark);
    if (expression === "happy") {
      rect(14, 18, 1, 1, dark);
      rect(15, 19, 3, 1, dark);
      rect(18, 18, 1, 1, dark);
    } else {
      rect(15, 18, 3, 1, dark);
    }
  }
  rect(9, 16, 2, 1, blush, 0.72);
  rect(21, 16, 2, 1, blush, 0.72);
  rect(23, 10, 2, 2, accent, 0.82);
}

function drawAccessory(
  appearance: PixelPetAppearance,
  rect: (x: number, y: number, w: number, h: number, color: string, opacity?: number) => void,
  dark: string,
  accent: string,
) {
  if (appearance.accessory === "scarf") {
    rect(9, 19, 14, 2, accent);
    rect(19, 21, 3, 4, accent);
  } else if (appearance.accessory === "bell") {
    rect(15, 20, 2, 2, accent);
    rect(14, 19, 4, 1, dark, 0.55);
  } else if (appearance.accessory === "leaf") {
    rect(17, 5, 4, 2, accent);
    rect(19, 4, 2, 4, accent);
  } else if (appearance.accessory === "satchel") {
    rect(20, 18, 5, 5, "#7d5b44");
    rect(21, 18, 3, 1, accent);
  }
}
</script>

<style scoped>
.floating-api-pet {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 18;
  width: 134px;
  min-height: 156px;
  display: grid;
  justify-items: center;
  gap: 4px;
  user-select: none;
  touch-action: none;
  cursor: grab;
  will-change: transform;
}

.floating-api-pet.dragging {
  cursor: grabbing;
}

.floating-api-pet:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
  border-radius: 8px;
}

.floating-api-pet-shadow {
  position: absolute;
  left: 27px;
  right: 27px;
  bottom: 38px;
  height: 18px;
  background: radial-gradient(ellipse at center, rgba(36, 29, 24, 0.2), rgba(36, 29, 24, 0));
  border-radius: 999px;
  pointer-events: none;
  animation: floatingPetShadow 2.8s ease-in-out infinite;
}

.floating-api-pet-card {
  width: 104px;
  height: 104px;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  place-items: center;
  gap: 3px;
  padding: 9px 10px 8px;
  border-radius: 22px;
  animation: floatingPetBob 2.8s ease-in-out infinite;
}

.floating-api-pet-sprite {
  width: 68px;
  height: 68px;
  display: block;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 10px 14px rgba(36, 29, 24, 0.18));
  pointer-events: none;
}

.floating-api-pet-name {
  max-width: 82px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
  font-family: var(--display-font);
  font-size: 12px;
  font-weight: 900;
  line-height: 1.2;
  text-align: center;
  pointer-events: none;
}

.floating-api-pet-heart {
  position: absolute;
  left: 50%;
  top: 24px;
  z-index: 3;
  width: 4px;
  height: 4px;
  color: #e85f7a;
  background: currentColor;
  box-shadow:
    -4px 0 0 currentColor,
    4px 0 0 currentColor,
    -8px 4px 0 currentColor,
    -4px 4px 0 currentColor,
    0 4px 0 currentColor,
    4px 4px 0 currentColor,
    8px 4px 0 currentColor,
    -4px 8px 0 currentColor,
    0 8px 0 currentColor,
    4px 8px 0 currentColor,
    0 12px 0 currentColor;
  image-rendering: pixelated;
  opacity: 0;
  pointer-events: none;
  transform: translate3d(var(--heart-x), 0, 0) scale(var(--heart-scale));
  animation: floatingPetHeart 900ms ease-out var(--heart-delay) both;
}

:root[data-color-mode="dark"] .floating-api-pet-name {
  color: #f2eee6;
}

@keyframes floatingPetBob {
  0%,
  100% {
    transform: translateY(0) rotate(-1deg);
  }
  50% {
    transform: translateY(-8px) rotate(1deg);
  }
}

@keyframes floatingPetShadow {
  0%,
  100% {
    opacity: 0.72;
    transform: scaleX(1);
  }
  50% {
    opacity: 0.46;
    transform: scaleX(0.82);
  }
}

@keyframes floatingPetHeart {
  0% {
    opacity: 0;
    transform: translate3d(var(--heart-x), 8px, 0) scale(calc(var(--heart-scale) * 0.72));
  }
  18% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate3d(calc(var(--heart-x) * 1.18), -58px, 0) scale(var(--heart-scale));
  }
}

@media (max-width: 640px) {
  .floating-api-pet {
    width: 108px;
    min-height: 132px;
  }

  .floating-api-pet-card {
    width: 88px;
    height: 88px;
    padding: 8px;
    border-radius: 18px;
  }

  .floating-api-pet-sprite {
    width: 56px;
    height: 56px;
  }

  .floating-api-pet-name {
    max-width: 70px;
    font-size: 11px;
  }
}
</style>
