<template>
  <section class="chat-panel" :aria-label="copy.panelAria">
    <div ref="messageListRef" class="message-list">
      <div v-if="messages.length === 0" class="empty-state">
        <Bot :size="32" />
        <p>{{ copy.empty }}</p>
      </div>

      <article
        v-for="(message, index) in messages"
        :key="message.id ?? `${message.role}-${index}`"
        class="message"
        :class="[message.role, message.authorTone]"
      >
        <button
          class="avatar"
          :class="{ 'custom-avatar': message.avatarText || message.avatarUrl }"
          type="button"
          :title="message.authorName || copy.avatar"
          @click="emit('avatar-click', message)"
        >
          <img v-if="message.avatarUrl" :src="message.avatarUrl" :alt="message.authorName || message.avatarText || copy.avatar" />
          <span v-else-if="message.avatarText">{{ message.avatarText }}</span>
          <UserRound v-else-if="message.role === 'user' || message.source === 'human'" :size="16" />
          <Bot v-else :size="16" />
        </button>
        <div class="message-bubble-stack">
          <span v-if="message.authorName" class="message-author">{{ message.authorName }}</span>
          <div
            v-if="shouldRenderMarkdown(message)"
            class="message-markdown markdown-body"
            v-html="renderMessageMarkdown(message.content)"
          />
          <p v-else-if="message.content">{{ message.content }}</p>
          <div v-if="imageAttachments(message).length" class="message-image-grid">
            <figure v-for="attachment in imageAttachments(message)" :key="attachment.id" class="message-image-attachment">
              <button
                v-if="attachment.dataUrl"
                class="message-image-open"
                type="button"
                :title="copy.openImage"
                @click="openImagePreview(attachment)"
              >
                <img :src="attachment.dataUrl" :alt="attachment.name" />
              </button>
              <div v-else class="message-image-missing">
                <FileImage :size="22" />
              </div>
              <figcaption>
                <strong>{{ attachment.name }}</strong>
                <small>{{ formatAttachmentSize(attachment.size) }}</small>
              </figcaption>
            </figure>
          </div>
          <div v-if="fileAttachments(message).length" class="message-attachments">
            <figure
              v-for="attachment in fileAttachments(message)"
              :key="attachment.id"
              class="message-file-card"
              :data-extension="fileLabel(attachment)"
            >
              <a v-if="attachment.dataUrl" class="message-file-card-content" :href="attachment.dataUrl" :download="attachment.name">
                <strong class="message-file-name">{{ attachment.name }}</strong>
                <small>{{ formatAttachmentSize(attachment.size) }}</small>
              </a>
              <div v-else class="message-file-card-content">
                <strong class="message-file-name">{{ attachment.name }}</strong>
                <small>{{ formatAttachmentSize(attachment.size) }}</small>
              </div>
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

    <Teleport to="body">
      <div v-if="previewImage" class="image-preview-backdrop" @click.self="closeImagePreview">
        <section class="image-preview-dialog" :aria-label="previewImage.name">
          <header class="image-preview-topbar">
            <div>
              <strong>{{ previewImage.name }}</strong>
              <small>{{ formatAttachmentSize(previewImage.size) }}</small>
            </div>
            <div class="image-preview-actions">
              <a v-if="previewImage.dataUrl" :href="previewImage.dataUrl" :download="previewImage.name">
                {{ copy.downloadImage }}
              </a>
              <button type="button" :title="copy.closeImage" @click="closeImagePreview">
                <X :size="18" />
              </button>
            </div>
          </header>
          <img v-if="previewImage.dataUrl" :src="previewImage.dataUrl" :alt="previewImage.name" />
        </section>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
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
  "avatar-click": [message: ChatMessage];
}>();

const maxAttachments = 4;
const maxAttachmentSize = 8 * 1024 * 1024;
const draft = ref("");
const attachments = ref<ChatAttachment[]>([]);
const attachmentError = ref("");
const messageListRef = ref<HTMLElement | null>(null);
const composerInputRef = ref<HTMLTextAreaElement | null>(null);
const attachmentInputRef = ref<HTMLInputElement | null>(null);
const previewImage = ref<ChatAttachment | null>(null);

const copy = computed(() =>
  props.language === "en-US"
    ? {
        panelAria: "Chat",
        empty: "What would you like to talk about today?",
        responding: "Responding",
        placeholder: "Type a message",
        send: "Send",
        avatar: "Avatar",
        attach: "Attach files",
        removeAttachment: "Remove attachment",
        openImage: "Open image",
        closeImage: "Close image",
        downloadImage: "Download",
        tooManyAttachments: "Up to 4 attachments per message.",
        attachmentTooLarge: "Attachments must be 8 MB or smaller.",
      }
    : {
        panelAria: "Chat 交耳",
        empty: "今天想聊什么？",
        responding: "正在响应",
        placeholder: "输入消息",
        send: "发送",
        avatar: "头像",
        attach: "添加附件",
        removeAttachment: "移除附件",
        openImage: "打开图片",
        closeImage: "关闭图片",
        downloadImage: "下载",
        tooManyAttachments: "每条消息最多 4 个附件。",
        attachmentTooLarge: "附件不能超过 8 MB。",
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
    content: draft.value.trim(),
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
        dataUrl: await readFileAsDataUrl(file),
      },
    ];
  }
}

function removeAttachment(attachmentId: string) {
  attachments.value = attachments.value.filter((attachment) => attachment.id !== attachmentId);
}

function openImagePreview(attachment: ChatAttachment) {
  previewImage.value = attachment;
}

function closeImagePreview() {
  previewImage.value = null;
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

function imageAttachments(message: ChatMessage) {
  return (message.attachments ?? []).filter((attachment) => attachment.kind === "image");
}

function fileAttachments(message: ChatMessage) {
  return (message.attachments ?? []).filter((attachment) => attachment.kind !== "image");
}

function fileLabel(attachment: ChatAttachment) {
  const extensionLabel = fileExtension(attachment.name);
  if (extensionLabel !== "FILE") {
    return extensionLabel;
  }
  const mimeLabel = mimeToLabel(attachment.type);
  if (mimeLabel) {
    return mimeLabel;
  }
  return extensionLabel;
}

function mimeToLabel(type: string) {
  const value = type.toLowerCase();
  if (value.includes("wordprocessingml.document")) {
    return "DOCX";
  }
  if (value.includes("msword")) {
    return "DOC";
  }
  if (value.includes("pdf")) {
    return "PDF";
  }
  if (value.includes("spreadsheetml.sheet")) {
    return "XLSX";
  }
  if (value.includes("ms-excel") || value.includes("spreadsheetml")) {
    return "XLS";
  }
  if (value.includes("presentationml.presentation")) {
    return "PPTX";
  }
  if (value.includes("ms-powerpoint") || value.includes("presentationml")) {
    return "PPT";
  }
  if (value.includes("zip")) {
    return "ZIP";
  }
  if (value.includes("json")) {
    return "JSON";
  }
  if (value.includes("csv")) {
    return "CSV";
  }
  if (value.includes("text/markdown") || value.includes("markdown")) {
    return "MD";
  }
  if (value.startsWith("text/")) {
    return "TXT";
  }
  return "";
}

function fileExtension(name: string) {
  const cleanName = name.trim();
  const dotIndex = cleanName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === cleanName.length - 1) {
    return "FILE";
  }
  return cleanName.slice(dotIndex + 1).replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 5) || "FILE";
}

function shouldRenderMarkdown(message: ChatMessage) {
  return message.renderMarkdown ?? (message.role === "assistant" && message.source !== "human");
}

function renderMessageMarkdown(content: string) {
  const parsed = marked.parse(content, {
    async: false,
    breaks: true,
    gfm: true,
  });
  return DOMPurify.sanitize(parsed);
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
