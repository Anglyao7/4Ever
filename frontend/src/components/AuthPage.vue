<template>
  <section class="auth-page" :aria-label="mode === 'sign-in' ? 'Sign in' : 'Sign up'">
    <section class="auth-brand" aria-label="ForEver">
      <a class="auth-brand-link" href="/" @click.prevent="$emit('home')">ForEver</a>
      <p>「知其不可为而为之。」</p>
    </section>

    <main class="auth-glass-shell" :class="{ 'sign-up': mode === 'sign-up' }">
      <section class="auth-card">
        <div class="auth-card-heading">
          <p class="eyebrow">{{ mode === "sign-in" ? "Welcome back" : "Begin here" }}</p>
          <h2>{{ mode === "sign-in" ? "Sign in" : "Sign up" }}</h2>
        </div>

        <div class="auth-tabs" role="tablist" aria-label="Auth mode">
          <button :class="{ active: mode === 'sign-in' }" type="button" @click="switchMode('sign-in')">Sign in</button>
          <button :class="{ active: mode === 'sign-up' }" type="button" @click="switchMode('sign-up')">Sign up</button>
        </div>

        <form v-if="mode === 'sign-in'" class="auth-form" @submit.prevent="submitSignIn">
          <label>
            <span>Username / Email</span>
            <input v-model="signInDraft.identifier" autocomplete="username" />
          </label>
          <label>
            <span>Password</span>
            <input v-model="signInDraft.password" type="password" autocomplete="current-password" />
          </label>
          <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
          <button class="auth-submit" type="submit" :disabled="loading">
            <LogIn :size="18" />
            <span>{{ loading ? "Signing in" : "Sign in" }}</span>
          </button>
        </form>

        <form v-else class="auth-form" @submit.prevent="submitSignUp">
          <label>
            <span>Display name</span>
            <input v-model="signUpDraft.display_name" autocomplete="name" />
          </label>
          <label>
            <span>Username</span>
            <input v-model="signUpDraft.username" autocomplete="username" />
          </label>
          <label>
            <span>Email</span>
            <input v-model="signUpDraft.email" type="email" autocomplete="email" />
          </label>
          <label>
            <span>Password</span>
            <input v-model="signUpDraft.password" type="password" autocomplete="new-password" />
          </label>
          <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
          <button class="auth-submit" type="submit" :disabled="loading">
            <UserPlus :size="18" />
            <span>{{ loading ? "Creating" : "Sign up" }}</span>
          </button>
        </form>
      </section>
    </main>
  </section>
</template>

<script setup lang="ts">
import { reactive, watch } from "vue";
import { LogIn, UserPlus } from "lucide-vue-next";

import type { SignInPayload, SignUpPayload } from "../types/auth";

const props = defineProps<{
  mode: "sign-in" | "sign-up";
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  "sign-in": [payload: SignInPayload];
  "sign-up": [payload: SignUpPayload];
  "switch-mode": [mode: "sign-in" | "sign-up"];
  home: [];
}>();

const signInDraft = reactive({
  identifier: "",
  password: "",
});
const signUpDraft = reactive({
  username: "",
  email: "",
  password: "",
  display_name: "",
});

watch(
  () => props.mode,
  () => {
    signInDraft.password = "";
    signUpDraft.password = "";
  },
);

function switchMode(nextMode: "sign-in" | "sign-up") {
  emit("switch-mode", nextMode);
}

function submitSignIn() {
  emit("sign-in", {
    identifier: signInDraft.identifier.trim(),
    password: signInDraft.password,
  });
}

function submitSignUp() {
  emit("sign-up", {
    username: signUpDraft.username.trim(),
    email: signUpDraft.email.trim(),
    password: signUpDraft.password,
    display_name: signUpDraft.display_name.trim() || undefined,
  });
}
</script>
