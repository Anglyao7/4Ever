<template>
  <section class="chat-panel" aria-label="Chat 交耳">
    <div class="chat-heading">
      <div>
        <p class="eyebrow">Chat</p>
        <h2>交耳</h2>
      </div>
      <button class="icon-button ghost" type="button" title="清空对话" @click="$emit('clear')">
        <Trash2 :size="18" />
      </button>
    </div>

    <div ref="messageListRef" class="message-list">
      <div v-if="messages.length === 0" class="empty-state">
        <Bot :size="32" />
        <p>今天想聊什么？</p>
      </div>

      <article
        v-for="(message, index) in messages"
        :key="`${message.role}-${index}`"
        class="message"
        :class="message.role"
      >
        <div class="avatar">
          <UserRound v-if="message.role === 'user'" :size="16" />
          <Bot v-else :size="16" />
        </div>
        <p>{{ message.content }}</p>
      </article>

      <article v-if="loading" class="message assistant pending">
        <div class="avatar">
          <LoaderCircle :size="16" class="spin" />
        </div>
        <p>正在响应</p>
      </article>
    </div>

    <Transition name="toast-fade">
      <p v-if="error" class="error-line">{{ error }}</p>
    </Transition>

    <form class="composer" :class="{ 'has-draft': draft.trim() }" @submit.prevent="submit">
      <div class="composer-input">
        <textarea
          ref="composerInputRef"
          v-model="draft"
          rows="1"
          placeholder="输入消息"
          :disabled="loading"
          @input="resizeComposer"
          @keydown.enter.exact="submitFromKeyboard"
        />
      </div>
      <button class="send-button" type="submit" title="发送" :disabled="loading || !draft.trim()">
        <SendHorizontal :size="18" />
        <span>发送</span>
      </button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { Bot, LoaderCircle, SendHorizontal, Trash2, UserRound } from "lucide-vue-next";

import type { ChatMessage } from "../types/chat";

const props = defineProps<{
  messages: ChatMessage[];
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  send: [message: string];
  clear: [];
}>();

const draft = ref("");
const messageListRef = ref<HTMLElement | null>(null);
const composerInputRef = ref<HTMLTextAreaElement | null>(null);

onMounted(() => {
  resizeComposer();
});

function submit() {
  const content = draft.value.trim();
  if (!content || props.loading) {
    return;
  }
  emit("send", content);
  draft.value = "";
  nextTick(resizeComposer);
}

function submitFromKeyboard(event: KeyboardEvent) {
  if (event.isComposing) {
    return;
  }
  event.preventDefault();
  submit();
}

function resizeComposer() {
  const input = composerInputRef.value;
  if (!input) {
    return;
  }
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  input.style.overflowY = input.scrollHeight > 132 ? "auto" : "hidden";
}

watch(
  () => [props.messages.length, props.loading],
  async () => {
    await nextTick();
    messageListRef.value?.scrollTo({
      top: messageListRef.value.scrollHeight,
      behavior: "smooth",
    });
  },
);
</script>
