<template>
  <section class="self-panel" aria-label="自我">
    <div class="module-view-header">
      <div>
        <p class="eyebrow">Self</p>
        <h1>自我</h1>
      </div>
      <span class="status-pill" :class="{ online: user }">
        <UserRound :size="16" />
        {{ user ? user.display_name : "未登录" }}
      </span>
    </div>

    <div v-if="!user" class="self-access-grid">
      <section class="self-card self-empty-card">
        <span class="self-avatar">
          <UserRound :size="28" />
        </span>
        <h2>建立你的身份</h2>
        <p>个人简介、日记和账户安全都会从这里开始沉淀。</p>
        <div class="self-action-row">
          <button class="secondary-button" type="button" @click="$emit('open-auth', 'sign-in')">Sign in</button>
          <button class="primary-action" type="button" @click="$emit('open-auth', 'sign-up')">Sign up</button>
        </div>
      </section>

      <section class="self-card self-preview-card">
        <div class="self-feature-row">
          <UserRound :size="19" />
          <span>个人简介</span>
        </div>
        <div class="self-feature-row">
          <BookOpenText :size="19" />
          <span>私人日记</span>
        </div>
        <div class="self-feature-row">
          <KeyRound :size="19" />
          <span>账户与密码</span>
        </div>
      </section>
    </div>

    <template v-else>
      <section class="self-card self-identity-card">
        <span class="self-avatar large">{{ initials }}</span>
        <div class="self-identity-main">
          <p class="eyebrow">Profile</p>
          <h2>{{ user.display_name }}</h2>
          <span>@{{ user.username }} · {{ user.email }}</span>
        </div>
        <button class="secondary-button" type="button" @click="$emit('sign-out')">
          <LogOut :size="17" />
          <span>Sign out</span>
        </button>
      </section>

      <div class="self-workspace-grid">
        <section class="self-card self-section-card">
          <div class="self-section-heading">
            <UserRound :size="20" />
            <div>
              <p class="eyebrow">Profile</p>
              <h2>个人简介</h2>
            </div>
          </div>

          <form class="self-form-grid" @submit.prevent="saveProfile">
            <label>
              <span>Display name</span>
              <input v-model="profileDraft.display_name" autocomplete="name" />
            </label>
            <label>
              <span>Email</span>
              <input v-model="profileDraft.email" type="email" autocomplete="email" />
            </label>
            <label class="full-field">
              <span>About me</span>
              <textarea
                v-model="profileDraft.bio"
                rows="5"
                placeholder="写下你想长期保留的自我介绍。"
              />
            </label>
            <p v-if="profileMessage" class="self-message" :class="{ error: profileError }">{{ profileMessage }}</p>
            <button class="primary-action" type="submit" :disabled="profileSaving">
              <Save :size="17" />
              <span>{{ profileSaving ? "Saving" : "Save profile" }}</span>
            </button>
          </form>
        </section>

        <section class="self-card self-section-card self-diary-card">
          <div class="self-section-heading">
            <BookOpenText :size="20" />
            <div>
              <p class="eyebrow">Diary</p>
              <h2>私人日记</h2>
            </div>
          </div>

          <form class="self-form-grid" @submit.prevent="addDiaryEntry">
            <label>
              <span>Title</span>
              <input v-model="diaryDraft.title" placeholder="今天的主题" />
            </label>
            <label class="full-field">
              <span>Content</span>
              <textarea v-model="diaryDraft.content" rows="4" placeholder="写一点只有自己看的内容。" />
            </label>
            <button class="primary-action" type="submit">
              <Plus :size="17" />
              <span>Add entry</span>
            </button>
          </form>

          <div class="diary-list" aria-label="日记列表">
            <article v-for="entry in diaryEntries" :key="entry.id" class="diary-entry">
              <div>
                <time>{{ entry.date }}</time>
                <h3>{{ entry.title }}</h3>
                <p>{{ entry.content }}</p>
              </div>
              <button class="icon-button ghost" type="button" title="删除日记" @click="deleteDiaryEntry(entry.id)">
                <Trash2 :size="17" />
              </button>
            </article>
            <p v-if="!diaryEntries.length" class="self-muted">还没有日记。</p>
          </div>
        </section>

        <section class="self-card self-section-card">
          <div class="self-section-heading">
            <ShieldCheck :size="20" />
            <div>
              <p class="eyebrow">Security</p>
              <h2>账户与密码</h2>
            </div>
          </div>

          <div class="account-facts">
            <span>Username</span>
            <strong>{{ user.username }}</strong>
            <span>Role</span>
            <strong>{{ user.role }}</strong>
          </div>

          <form class="self-form-grid" @submit.prevent="savePassword">
            <label>
              <span>Current password</span>
              <input v-model="passwordDraft.current_password" type="password" autocomplete="current-password" />
            </label>
            <label>
              <span>New password</span>
              <input v-model="passwordDraft.new_password" type="password" autocomplete="new-password" />
            </label>
            <label>
              <span>Confirm password</span>
              <input v-model="passwordDraft.confirm_password" type="password" autocomplete="new-password" />
            </label>
            <p v-if="passwordMessage" class="self-message" :class="{ error: passwordError }">{{ passwordMessage }}</p>
            <button class="primary-action" type="submit" :disabled="passwordSaving">
              <KeyRound :size="17" />
              <span>{{ passwordSaving ? "Updating" : "Update password" }}</span>
            </button>
          </form>
        </section>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { BookOpenText, KeyRound, LogOut, Plus, Save, ShieldCheck, Trash2, UserRound } from "lucide-vue-next";

import { changePassword, updateCurrentUser } from "../services/api";
import type { AuthUser } from "../types/auth";

type DiaryEntry = {
  id: string;
  date: string;
  title: string;
  content: string;
};

const props = defineProps<{
  user: AuthUser | null;
  authToken: string;
}>();

const emit = defineEmits<{
  "open-auth": [mode: "sign-in" | "sign-up"];
  "sign-out": [];
  "user-updated": [user: AuthUser];
}>();

const profileDraft = reactive({
  display_name: "",
  email: "",
  bio: "",
});
const diaryDraft = reactive({
  title: "",
  content: "",
});
const passwordDraft = reactive({
  current_password: "",
  new_password: "",
  confirm_password: "",
});

const diaryEntries = ref<DiaryEntry[]>([]);
const profileSaving = ref(false);
const passwordSaving = ref(false);
const profileMessage = ref("");
const passwordMessage = ref("");
const profileError = ref(false);
const passwordError = ref(false);

const initials = computed(() => {
  const name = props.user?.display_name || props.user?.username || "U";
  return name.slice(0, 2).toUpperCase();
});

watch(
  () => props.user,
  (user) => {
    if (!user) {
      return;
    }
    profileDraft.display_name = user.display_name;
    profileDraft.email = user.email;
    profileDraft.bio = localStorage.getItem(bioKey(user.id)) ?? "";
    diaryEntries.value = loadDiaryEntries(user.id);
  },
  { immediate: true },
);

async function saveProfile() {
  if (!props.user || !props.authToken) {
    setProfileMessage("请先登录。", true);
    return;
  }
  profileSaving.value = true;
  setProfileMessage("", false);
  try {
    const updated = await updateCurrentUser(props.authToken, {
      display_name: profileDraft.display_name.trim(),
      email: profileDraft.email.trim(),
    });
    localStorage.setItem(bioKey(updated.id), profileDraft.bio.trim());
    emit("user-updated", updated);
    setProfileMessage("个人资料已保存。", false);
  } catch (cause) {
    setProfileMessage(cause instanceof Error ? cause.message : "保存失败。", true);
  } finally {
    profileSaving.value = false;
  }
}

function addDiaryEntry() {
  if (!props.user) {
    return;
  }
  const title = diaryDraft.title.trim() || "无题";
  const content = diaryDraft.content.trim();
  if (!content) {
    return;
  }
  diaryEntries.value = [
    {
      id: crypto.randomUUID(),
      date: new Date().toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }),
      title,
      content,
    },
    ...diaryEntries.value,
  ];
  diaryDraft.title = "";
  diaryDraft.content = "";
  persistDiaryEntries();
}

function deleteDiaryEntry(entryId: string) {
  diaryEntries.value = diaryEntries.value.filter((entry) => entry.id !== entryId);
  persistDiaryEntries();
}

async function savePassword() {
  if (!props.authToken) {
    setPasswordMessage("请先登录。", true);
    return;
  }
  if (passwordDraft.new_password !== passwordDraft.confirm_password) {
    setPasswordMessage("两次输入的新密码不一致。", true);
    return;
  }
  passwordSaving.value = true;
  setPasswordMessage("", false);
  try {
    await changePassword(props.authToken, {
      current_password: passwordDraft.current_password,
      new_password: passwordDraft.new_password,
    });
    passwordDraft.current_password = "";
    passwordDraft.new_password = "";
    passwordDraft.confirm_password = "";
    setPasswordMessage("密码已更新。", false);
  } catch (cause) {
    setPasswordMessage(cause instanceof Error ? cause.message : "密码更新失败。", true);
  } finally {
    passwordSaving.value = false;
  }
}

function persistDiaryEntries() {
  if (!props.user) {
    return;
  }
  localStorage.setItem(diaryKey(props.user.id), JSON.stringify(diaryEntries.value));
}

function loadDiaryEntries(userId: string): DiaryEntry[] {
  const raw = localStorage.getItem(diaryKey(userId));
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function setProfileMessage(message: string, isError: boolean) {
  profileMessage.value = message;
  profileError.value = isError;
}

function setPasswordMessage(message: string, isError: boolean) {
  passwordMessage.value = message;
  passwordError.value = isError;
}

function bioKey(userId: string) {
  return `4ever.self.bio.${userId}`;
}

function diaryKey(userId: string) {
  return `4ever.self.diary.${userId}`;
}
</script>
