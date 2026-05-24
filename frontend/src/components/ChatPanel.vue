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
        :id="messageDomId(message, index)"
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
          <div class="message-meta-row">
            <span v-if="message.authorName" class="message-author">{{ message.authorName }}</span>
            <time v-if="formatMessageTime(message.createdAt)" class="message-time">{{ formatMessageTime(message.createdAt) }}</time>
          </div>
          <button
            v-if="message.role === 'user' && message.replyTo"
            type="button"
            class="message-reply-quote"
            :title="copy.replyingTo"
            @click="jumpToReply(message.replyTo)"
          >
            <strong>{{ message.replyTo.authorName || copy.replyFallback }}</strong>
            <span>{{ truncateReply(message.replyTo.content) }}</span>
          </button>
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
          <div v-if="message.role === 'user'" class="message-actions">
            <button type="button" class="message-action-button" :title="copy.reply" @click="startReply(message)">
              <Reply :size="14" />
              <span>{{ copy.reply }}</span>
            </button>
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

    <form
      class="composer"
      :class="{ 'has-draft': props.draft.trim() || props.attachments.length || props.replyTo, 'is-dragging-file': draggingAttachment }"
      @submit.prevent="submit"
      @dragenter.prevent="handleComposerDragEnter"
      @dragover.prevent="handleComposerDragOver"
      @dragleave="handleComposerDragLeave"
      @drop.prevent="handleComposerDrop"
    >
      <div class="composer-input">
        <div v-if="props.replyTo" class="composer-reply-bar">
          <div class="composer-reply-copy">
            <strong>{{ props.replyTo.authorName || copy.replyFallback }}</strong>
            <span>{{ truncateReply(props.replyTo.content) }}</span>
          </div>
          <button type="button" :title="copy.cancelReply" @click="emit('cancel-reply')">
            <X :size="14" />
          </button>
        </div>
        <div v-if="props.attachments.length" class="composer-attachments">
          <figure
            v-for="attachment in props.attachments"
            :key="attachment.id"
            class="composer-attachment-card"
            :class="{ image: attachment.kind === 'image' }"
            :data-extension="fileLabel(attachment)"
          >
            <img v-if="attachment.kind === 'image' && attachment.dataUrl" :src="attachment.dataUrl" :alt="attachment.name" />
            <span v-else class="composer-file-backdrop">{{ fileLabel(attachment) }}</span>
            <figcaption>
              <strong>{{ attachment.name }}</strong>
              <small>{{ formatAttachmentSize(attachment.size) }}</small>
            </figcaption>
            <button type="button" :title="copy.removeAttachment" @click="removeAttachment(attachment.id)">
              <X :size="13" />
            </button>
          </figure>
        </div>
        <textarea
          ref="composerInputRef"
          :value="props.draft"
          rows="1"
          :placeholder="copy.placeholder"
          :disabled="loading"
          @input="handleDraftInput"
          @keydown.enter.exact="submitFromKeyboard"
          @paste="handleComposerPaste"
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
  FileImage,
  LoaderCircle,
  Paperclip,
  Reply,
  SendHorizontal,
  UserRound,
  X,
} from "lucide-vue-next";

import type { ChatAttachment, ChatMessage, ChatReplyReference, ChatSendPayload } from "../types/chat";

const props = defineProps<{
  messages: ChatMessage[];
  draft: string;
  attachments: ChatAttachment[];
  replyTo?: ChatReplyReference | null;
  loading: boolean;
  error: string;
  language: "zh-CN" | "en-US";
}>();

const emit = defineEmits<{
  send: [payload: ChatSendPayload];
  clear: [];
  "avatar-click": [message: ChatMessage];
  "update:draft": [value: string];
  "update:attachments": [value: ChatAttachment[]];
  "reply": [message: ChatMessage];
  "cancel-reply": [];
}>();

const maxAttachments = 4;
const maxAttachmentSize = 8 * 1024 * 1024;
const attachmentError = ref("");
const draggingAttachment = ref(false);
const messageListRef = ref<HTMLElement | null>(null);
const composerInputRef = ref<HTMLTextAreaElement | null>(null);
const attachmentInputRef = ref<HTMLInputElement | null>(null);
const previewImage = ref<ChatAttachment | null>(null);

const copy = computed(() =>
  props.language === "en-US"
    ? {
        panelAria: "Chat",
        empty: "What would you like to talk about today?",
        responding: "The other side is typing",
        placeholder: "Type a message",
        send: "Send",
        avatar: "Avatar",
        attach: "Attach files",
        removeAttachment: "Remove attachment",
        openImage: "Open image",
        closeImage: "Close image",
        downloadImage: "Download",
        reply: "Reply",
        cancelReply: "Cancel reply",
        replyingTo: "Replying to message",
        replyFallback: "Message",
        tooManyAttachments: "Up to 4 attachments per message.",
        attachmentTooLarge: "Attachments must be 8 MB or smaller.",
        imageOnlyReply: "[Image]",
        fileOnlyReply: "[File]",
      }
    : {
        panelAria: "Chat 交耳",
        empty: "今天想聊什么？",
        responding: "对方正在输入中",
        placeholder: "输入消息",
        send: "发送",
        avatar: "头像",
        attach: "添加附件",
        removeAttachment: "移除附件",
        openImage: "打开图片",
        closeImage: "关闭图片",
        downloadImage: "下载",
        reply: "回复",
        cancelReply: "取消回复",
        replyingTo: "查看引用消息",
        replyFallback: "消息",
        tooManyAttachments: "每条消息最多 4 个附件。",
        attachmentTooLarge: "附件不能超过 8 MB。",
        imageOnlyReply: "[图片]",
        fileOnlyReply: "[文件]",
      },
);

const visibleError = computed(() => attachmentError.value || props.error);
const canSubmit = computed(() => Boolean(props.draft.trim() || props.attachments.length));

onMounted(() => {
  resizeComposer();
});

function submit() {
  if (!canSubmit.value || props.loading) {
    return;
  }
  emit("send", {
    content: props.draft.trim(),
    attachments: props.attachments,
    replyTo: props.replyTo ?? null,
  });
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

function handleDraftInput(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) {
    return;
  }
  emit("update:draft", target.value);
  nextTick(resizeComposer);
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
  await appendAttachments(files);
}

async function handleComposerDrop(event: DragEvent) {
  draggingAttachment.value = false;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (!files.length) {
    return;
  }
  await appendAttachments(files);
}

async function handleComposerPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (!files.length) {
    return;
  }
  event.preventDefault();
  await appendAttachments(files);
}

function handleComposerDragEnter(event: DragEvent) {
  if (event.dataTransfer?.types.includes("Files")) {
    draggingAttachment.value = true;
  }
}

function handleComposerDragOver(event: DragEvent) {
  if (event.dataTransfer?.types.includes("Files")) {
    event.dataTransfer.dropEffect = "copy";
    draggingAttachment.value = true;
  }
}

function handleComposerDragLeave(event: DragEvent) {
  const current = event.currentTarget;
  if (current instanceof HTMLElement && event.relatedTarget instanceof Node && current.contains(event.relatedTarget)) {
    return;
  }
  draggingAttachment.value = false;
}

async function appendAttachments(files: File[]) {
  if (!files.length) {
    return;
  }
  attachmentError.value = "";
  const nextAttachments = [...props.attachments];

  for (const file of files) {
    if (nextAttachments.length >= maxAttachments) {
      attachmentError.value = copy.value.tooManyAttachments;
      break;
    }
    if (file.size > maxAttachmentSize) {
      attachmentError.value = copy.value.attachmentTooLarge;
      continue;
    }
    const kind = file.type.startsWith("image/") ? "image" : "file";
    nextAttachments.push({
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      kind,
      dataUrl: await readFileAsDataUrl(file),
    });
  }

  emit("update:attachments", nextAttachments);
}

function removeAttachment(attachmentId: string) {
  emit(
    "update:attachments",
    props.attachments.filter((attachment) => attachment.id !== attachmentId),
  );
}

function openImagePreview(attachment: ChatAttachment) {
  previewImage.value = attachment;
}

function closeImagePreview() {
  previewImage.value = null;
}

function startReply(message: ChatMessage) {
  emit("reply", message);
}

function jumpToReply(replyTo: ChatReplyReference) {
  const targetId = replyTo.id;
  if (targetId === undefined || targetId === null) {
    return;
  }
  const anchor = document.getElementById(`chat-message-${String(targetId)}`);
  if (!anchor) {
    return;
  }
  anchor.scrollIntoView({ behavior: "smooth", block: "center" });
}

function messageDomId(message: ChatMessage, index: number) {
  return `chat-message-${String(message.id ?? `${message.role}-${index}`)}`;
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

function formatMessageTime(value?: string) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(props.language, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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

function truncateReply(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return copy.value.fileOnlyReply;
  }
  return normalized.length > 52 ? `${normalized.slice(0, 52)}…` : normalized;
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

watch(
  () => [props.draft, props.attachments.length, props.replyTo?.id],
  async () => {
    await nextTick();
    resizeComposer();
  },
);
</script>
