<template>
  <section class="chat-panel" :aria-label="copy.panelAria">
    <div ref="messageListRef" class="message-list">
      <div v-if="messages.length === 0" class="empty-state">
        <Bot :size="32" />
        <p>{{ copy.empty }}</p>
      </div>

      <article
        v-for="(message, index) in messages"
        :key="`${message.role}-${index}`"
        class="message"
        :class="[message.role, message.authorTone]"
      >
        <div class="avatar">
          <UserRound v-if="message.role === 'user'" :size="16" />
          <Bot v-else :size="16" />
        </div>
        <div class="message-bubble-stack">
          <span v-if="message.authorName" class="message-author">{{ message.authorName }}</span>
          <p>{{ message.content }}</p>
          <div v-if="message.attachments?.length" class="message-attachments">
            <figure v-for="attachment in message.attachments" :key="attachment.id">
              <img v-if="attachment.kind === 'image' && attachment.dataUrl" :src="attachment.dataUrl" :alt="attachment.name" />
              <FileImage v-else-if="attachment.kind === 'image'" :size="18" />
              <FileIcon v-else :size="18" />
              <figcaption>
                <strong>{{ attachment.name }}</strong>
                <small>{{ formatAttachmentSize(attachment.size) }}</small>
              </figcaption>
            </figure>
          </div>
        </div>
      </article>

      <article v-if="loading" class="message assistant pending">
        <div class="avatar">
          <LoaderCircle :size="16" class="spin" />
        </div>
        <p>{{ copy.responding }}</p>
      </article>
    </div>

    <Transition name="toast-fade">
      <p v-if="visibleError" class="error-line">{{ visibleError }}</p>
    </Transition>

    <form class="composer" :class="{ 'has-draft': draft.trim() || attachments.length }" @submit.prevent="submit">
      <div class="composer-input">
        <div v-if="attachments.length" class="composer-attachments">
          <span v-for="attachment in attachments" :key="attachment.id">
            <FileImage v-if="attachment.kind === 'image'" :size="14" />
            <FileIcon v-else :size="14" />
            {{ attachment.name }}
            <button type="button" :title="copy.removeAttachment" @click="removeAttachment(attachment.id)">
              <X :size="13" />
            </button>
          </span>
        </div>
        <textarea
          ref="composerInputRef"
          v-model="draft"
          rows="1"
          :placeholder="copy.placeholder"
          :disabled="loading"
          @input="resizeComposer"
          @keydown.enter.exact="submitFromKeyboard"
        />
      </div>
      <input
        ref="attachmentInputRef"
        class="visually-hidden"
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.md,.csv,.json"
        @change="handleAttachmentInput"
      />
      <button class="composer-tool-button" type="button" :title="copy.attach" :disabled="loading" @click="openAttachmentPicker">
        <Paperclip :size="18" />
      </button>
      <button class="send-button" type="submit" :title="copy.send" :disabled="loading || !canSubmit">
        <SendHorizontal :size="18" />
        <span>{{ copy.send }}</span>
      </button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  Bot,
  File as FileIcon,
  FileImage,
  LoaderCircle,
  Paperclip,
  SendHorizontal,
  UserRound,
  X,
} from "lucide-vue-next";

import type { ChatAttachment, ChatMessage, ChatSendPayload } from "../types/chat";

const props = defineProps<{
  messages: ChatMessage[];
  loading: boolean;
  error: string;
  language: "zh-CN" | "en-US";
}>();

const emit = defineEmits<{
  send: [payload: ChatSendPayload];
  clear: [];
}>();

const maxAttachments = 4;
const maxAttachmentSize = 1024 * 1024;
const draft = ref("");
const attachments = ref<ChatAttachment[]>([]);
const attachmentError = ref("");
const messageListRef = ref<HTMLElement | null>(null);
const composerInputRef = ref<HTMLTextAreaElement | null>(null);
const attachmentInputRef = ref<HTMLInputElement | null>(null);

const copy = computed(() =>
  props.language === "en-US"
    ? {
        panelAria: "Chat",
        empty: "What would you like to talk about today?",
        responding: "Responding",
        placeholder: "Type a message",
        send: "Send",
        attach: "Attach files",
        removeAttachment: "Remove attachment",
        attachmentFallback: "Please review these attachments.",
        tooManyAttachments: "Up to 4 attachments per message.",
        attachmentTooLarge: "Attachments must be 1 MB or smaller.",
      }
    : {
        panelAria: "Chat 交耳",
        empty: "今天想聊什么？",
        responding: "正在响应",
        placeholder: "输入消息",
        send: "发送",
        attach: "添加附件",
        removeAttachment: "移除附件",
        attachmentFallback: "请先看这些附件。",
        tooManyAttachments: "每条消息最多 4 个附件。",
        attachmentTooLarge: "附件不能超过 1 MB。",
      },
);

const visibleError = computed(() => attachmentError.value || props.error);
const canSubmit = computed(() => Boolean(draft.value.trim() || attachments.value.length));

onMounted(() => {
  resizeComposer();
});

function submit() {
  if (!canSubmit.value || props.loading) {
    return;
  }
  const payload: ChatSendPayload = {
    content: draft.value.trim() || copy.value.attachmentFallback,
    attachments: attachments.value,
  };
  emit("send", payload);
  draft.value = "";
  attachments.value = [];
  attachmentError.value = "";
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

function openAttachmentPicker() {
  attachmentInputRef.value?.click();
}

async function handleAttachmentInput(event: Event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  const files = Array.from(input.files ?? []);
  input.value = "";
  attachmentError.value = "";

  for (const file of files) {
    if (attachments.value.length >= maxAttachments) {
      attachmentError.value = copy.value.tooManyAttachments;
      return;
    }
    if (file.size > maxAttachmentSize) {
      attachmentError.value = copy.value.attachmentTooLarge;
      continue;
    }
    const kind = file.type.startsWith("image/") ? "image" : "file";
    attachments.value = [
      ...attachments.value,
      {
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        kind,
        dataUrl: kind === "image" ? await readFileAsDataUrl(file) : undefined,
      },
    ];
  }
}

function removeAttachment(attachmentId: string) {
  attachments.value = attachments.value.filter((attachment) => attachment.id !== attachmentId);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function formatAttachmentSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
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
