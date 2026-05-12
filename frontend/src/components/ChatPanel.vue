<template>
  <section class="chat-panel" :aria-label="copy.panelAria">
    <div class="chat-heading">
      <div>
        <p class="eyebrow">Chat</p>
        <h2>{{ copy.title }}</h2>
      </div>
      <button class="icon-button ghost" type="button" :title="copy.clear" @click="$emit('clear')">
        <Trash2 :size="18" />
      </button>
    </div>

    <div class="chat-control-rail">
      <div class="chat-persona-strip" role="tablist" :aria-label="copy.personas">
        <button
          v-for="persona in personaOptions"
          :key="persona.id"
          type="button"
          :class="{ active: persona.id === personaId }"
          :title="persona.description"
          :aria-selected="persona.id === personaId"
          @click="$emit('persona-change', persona.id)"
        >
          <component :is="persona.icon" :size="15" />
          <span>{{ persona.label }}</span>
        </button>
      </div>
      <div class="chat-mode-toggle" :aria-label="copy.mode">
        <button
          v-for="option in modeOptions"
          :key="option.id"
          type="button"
          :class="{ active: option.id === mode }"
          @click="$emit('mode-change', option.id)"
        >
          <component :is="option.icon" :size="15" />
          <span>{{ option.label }}</span>
        </button>
      </div>
    </div>

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
import type { Component } from "vue";
import {
  Bot,
  Brain,
  File as FileIcon,
  FileImage,
  LoaderCircle,
  MessagesSquare,
  Paperclip,
  SendHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  WandSparkles,
  X,
} from "lucide-vue-next";

import type { ChatAttachment, ChatMessage, ChatMode, ChatPersonaId, ChatSendPayload } from "../types/chat";

const props = defineProps<{
  messages: ChatMessage[];
  loading: boolean;
  error: string;
  language: "zh-CN" | "en-US";
  personaId: ChatPersonaId;
  mode: ChatMode;
}>();

const emit = defineEmits<{
  send: [payload: ChatSendPayload];
  clear: [];
  "persona-change": [personaId: ChatPersonaId];
  "mode-change": [mode: ChatMode];
}>();

type PersonaOption = {
  id: ChatPersonaId;
  icon: Component;
  label: string;
  description: string;
};

type ModeOption = {
  id: ChatMode;
  icon: Component;
  label: string;
};

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
        title: "Chat",
        clear: "Clear chat",
        empty: "What would you like to talk about today?",
        responding: "Responding",
        placeholder: "Type a message",
        send: "Send",
        personas: "Personas",
        mode: "Conversation mode",
        direct: "Direct",
        roundtable: "Roundtable",
        assistant: "Assistant",
        mentor: "Mentor",
        architect: "Architect",
        critic: "Critic",
        assistantDesc: "Balanced assistant",
        mentorDesc: "Warm and reflective role-play voice",
        architectDesc: "Structured planner for systems and products",
        criticDesc: "Sharp reviewer that looks for weak assumptions",
        attach: "Attach files",
        removeAttachment: "Remove attachment",
        attachmentFallback: "Please review these attachments.",
        tooManyAttachments: "Up to 4 attachments per message.",
        attachmentTooLarge: "Attachments must be 1 MB or smaller.",
      }
    : {
        panelAria: "Chat 交耳",
        title: "交耳",
        clear: "清空对话",
        empty: "今天想聊什么？",
        responding: "正在响应",
        placeholder: "输入消息",
        send: "发送",
        personas: "角色",
        mode: "对话模式",
        direct: "直聊",
        roundtable: "群聊",
        assistant: "助手",
        mentor: "陪伴者",
        architect: "架构师",
        critic: "审稿人",
        assistantDesc: "均衡可靠的默认助手",
        mentorDesc: "更适合情绪、关系和角色扮演",
        architectDesc: "更适合系统、产品和计划拆解",
        criticDesc: "更适合代码 review、反驳和风险排查",
        attach: "添加附件",
        removeAttachment: "移除附件",
        attachmentFallback: "请先看这些附件。",
        tooManyAttachments: "每条消息最多 4 个附件。",
        attachmentTooLarge: "附件不能超过 1 MB。",
      },
);

const personaOptions = computed<PersonaOption[]>(() => [
  { id: "assistant", icon: Sparkles, label: copy.value.assistant, description: copy.value.assistantDesc },
  { id: "mentor", icon: WandSparkles, label: copy.value.mentor, description: copy.value.mentorDesc },
  { id: "architect", icon: Brain, label: copy.value.architect, description: copy.value.architectDesc },
  { id: "critic", icon: MessagesSquare, label: copy.value.critic, description: copy.value.criticDesc },
]);

const modeOptions = computed<ModeOption[]>(() => [
  { id: "direct", icon: UserRound, label: copy.value.direct },
  { id: "roundtable", icon: UsersRound, label: copy.value.roundtable },
]);

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
    personaId: props.personaId,
    mode: props.mode,
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
