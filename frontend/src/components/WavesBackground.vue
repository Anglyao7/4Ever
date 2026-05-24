<template>
  <canvas ref="canvasRef" class="waves-background" aria-hidden="true" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

const props = withDefaults(defineProps<{
  lineColor?: string;
  backgroundColor?: string;
  waveSpeedX?: number;
  waveSpeedY?: number;
  waveAmpX?: number;
  waveAmpY?: number;
  friction?: number;
  tension?: number;
  maxCursorMove?: number;
  xGap?: number;
  yGap?: number;
}>(), {
  lineColor: "#735cd2",
  backgroundColor: "transparent",
  waveSpeedX: 0.035,
  waveSpeedY: 0.02,
  waveAmpX: 55,
  waveAmpY: 20,
  friction: 0.76,
  tension: 0.01,
  maxCursorMove: 60,
  xGap: 12,
  yGap: 36,
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
let animationId = 0;
let resizeHandler: (() => void) | null = null;
let pointerX = 0;
let pointerY = 0;
let pointerVelocityX = 0;
let pointerVelocityY = 0;
let lastPointerX = 0;
let lastPointerY = 0;
let hasPointer = false;
let phase = 0;

function resizeCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(rect.width * pixelRatio));
  canvas.height = Math.max(1, Math.floor(rect.height * pixelRatio));
  const context = canvas.getContext("2d");
  context?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function draw() {
  const canvas = canvasRef.value;
  const context = canvas?.getContext("2d");
  if (!canvas || !context) {
    return;
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.clearRect(0, 0, width, height);
  if (props.backgroundColor !== "transparent") {
    context.fillStyle = props.backgroundColor;
    context.fillRect(0, 0, width, height);
  }

  pointerVelocityX *= props.friction;
  pointerVelocityY *= props.friction;
  phase += 1;

  context.lineWidth = 1;
  context.strokeStyle = props.lineColor;
  context.globalAlpha = 0.52;

  for (let y = -props.yGap; y <= height + props.yGap; y += props.yGap) {
    context.beginPath();
    for (let x = -props.xGap; x <= width + props.xGap; x += props.xGap) {
      const cursorDistance = hasPointer ? Math.hypot(x - pointerX, y - pointerY) : Number.POSITIVE_INFINITY;
      const cursorPower = Math.max(0, 1 - cursorDistance / 280);
      const cursorOffsetX = Math.max(-props.maxCursorMove, Math.min(props.maxCursorMove, pointerVelocityX * cursorPower));
      const cursorOffsetY = Math.max(-props.maxCursorMove, Math.min(props.maxCursorMove, pointerVelocityY * cursorPower));
      const waveX = Math.sin((y + phase * props.waveSpeedY * 120) * 0.018) * props.waveAmpX * 0.1;
      const waveY = Math.sin((x + phase * props.waveSpeedX * 120) * 0.018) * props.waveAmpY;
      const px = x + waveX + cursorOffsetX;
      const py = y + waveY + cursorOffsetY;
      if (x <= -props.xGap) {
        context.moveTo(px, py);
      } else {
        context.lineTo(px, py);
      }
    }
    context.stroke();
  }

  context.globalAlpha = 1;
  animationId = window.requestAnimationFrame(draw);
}

function handlePointerMove(event: PointerEvent) {
  const canvas = canvasRef.value;
  if (!canvas) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  pointerX = event.clientX - rect.left;
  pointerY = event.clientY - rect.top;
  if (hasPointer) {
    pointerVelocityX += (pointerX - lastPointerX) * props.tension * 40;
    pointerVelocityY += (pointerY - lastPointerY) * props.tension * 40;
  }
  lastPointerX = pointerX;
  lastPointerY = pointerY;
  hasPointer = true;
}

function handlePointerLeave() {
  hasPointer = false;
}

onMounted(() => {
  const canvas = canvasRef.value;
  if (!canvas) {
    return;
  }
  resizeCanvas(canvas);
  resizeHandler = () => resizeCanvas(canvas);
  window.addEventListener("resize", resizeHandler);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  animationId = window.requestAnimationFrame(draw);
});

onBeforeUnmount(() => {
  const canvas = canvasRef.value;
  window.cancelAnimationFrame(animationId);
  if (resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
  }
  canvas?.removeEventListener("pointermove", handlePointerMove);
  canvas?.removeEventListener("pointerleave", handlePointerLeave);
});
</script>
