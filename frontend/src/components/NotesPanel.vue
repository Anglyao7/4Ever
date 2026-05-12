<template>
  <section class="notes-panel" :aria-label="copy.title">
    <div class="module-view-header">
      <div>
        <p class="eyebrow">Notes</p>
        <h1>{{ copy.title }}</h1>
      </div>
      <span class="status-pill online">{{ copy.savedState }}</span>
    </div>

    <div class="notes-workspace">
      <aside class="notes-sidebar" :aria-label="copy.draftList">
        <div class="panel-heading compact">
          <div>
            <p class="eyebrow">Drafts</p>
            <h2>{{ copy.draftList }}</h2>
          </div>
          <button class="icon-button ghost" type="button" :title="copy.newNote" @click="createNote">
            <Plus :size="17" />
          </button>
        </div>

        <label class="notes-search">
          <Search :size="16" />
          <input v-model.trim="searchQuery" type="search" :placeholder="copy.search" autocomplete="off" />
        </label>

        <div class="note-draft-list">
          <button
            v-for="note in filteredNotes"
            :key="note.id"
            class="note-draft-card"
            :class="{ active: note.id === activeNoteId }"
            type="button"
            @click="selectNote(note.id)"
          >
            <span class="note-draft-icon">
              <FileText :size="17" />
            </span>
            <span class="note-draft-main">
              <strong>{{ noteTitle(note) }}</strong>
              <small>{{ notePreview(note) }}</small>
            </span>
            <time>{{ formatUpdatedAt(note.updatedAt) }}</time>
          </button>

          <div v-if="filteredNotes.length === 0" class="notes-empty">
            <StickyNote :size="28" />
            <span>{{ copy.empty }}</span>
          </div>
        </div>
      </aside>

      <section class="notes-editor-card" :aria-label="copy.editor">
        <div class="notes-editor-toolbar">
          <label class="note-title-field">
            <span>{{ copy.titleLabel }}</span>
            <input
              v-model="activeNote.title"
              :placeholder="copy.titlePlaceholder"
              autocomplete="off"
              @input="markDraftTouched"
            />
          </label>

          <div class="notes-toolbar-actions">
            <span class="notes-save-meta">
              <Clock3 :size="15" />
              {{ lastSavedLabel }}
            </span>
            <button class="secondary-button" type="button" :disabled="notes.length <= 1" @click="deleteActiveNote">
              <Trash2 :size="16" />
              <span>{{ copy.delete }}</span>
            </button>
          </div>
        </div>

        <div class="notes-live-grid">
          <label class="markdown-editor">
            <span>{{ copy.markdown }}</span>
            <textarea
              v-model="activeNote.content"
              spellcheck="true"
              :placeholder="copy.contentPlaceholder"
              @input="markDraftTouched"
              @keydown.enter="continueMarkdownList"
            />
          </label>

          <article class="markdown-preview-card" :aria-label="copy.preview">
            <div class="markdown-preview-head">
              <span>
                <PanelRightOpen :size="16" />
                {{ copy.preview }}
              </span>
              <small>{{ wordCount }} {{ copy.words }}</small>
            </div>
            <div v-if="activeNote.content.trim()" class="markdown-body" v-html="renderedMarkdown" />
            <div v-else class="markdown-empty">
              <BookOpenText :size="30" />
              <p>{{ copy.previewEmpty }}</p>
            </div>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  BookOpenText,
  Clock3,
  FileText,
  PanelRightOpen,
  Plus,
  Search,
  StickyNote,
  Trash2,
} from "lucide-vue-next";

import type { NoteDraft } from "../types/notes";

const props = defineProps<{
  language: "zh-CN" | "en-US";
}>();

const notesStorageKey = "4ever.notes.drafts";
const activeNoteStorageKey = "4ever.notes.activeDraft";

const notes = ref<NoteDraft[]>(loadNotes());
const activeNoteId = ref(loadActiveNoteId(notes.value));
const searchQuery = ref("");
const draftTouchedAt = ref("");

const copy = computed(() =>
  props.language === "en-US"
    ? {
        title: "Notes",
        draftList: "Drafts",
        newNote: "New note",
        search: "Search notes",
        empty: "No matching drafts",
        editor: "Markdown editor",
        titleLabel: "Title",
        titlePlaceholder: "Untitled note",
        markdown: "Markdown",
        contentPlaceholder: "Write Markdown here...",
        preview: "Live preview",
        previewEmpty: "The rendered note appears here as you type.",
        savedState: "Auto-saved locally",
        delete: "Delete",
        justNow: "Saved just now",
        savedAt: "Saved",
        words: "words",
        untitled: "Untitled note",
        emptyPreview: "No content yet",
      }
    : {
        title: "笔记",
        draftList: "暂存笔记",
        newNote: "新建笔记",
        search: "搜索笔记",
        empty: "没有匹配的暂存笔记",
        editor: "Markdown 编辑器",
        titleLabel: "标题",
        titlePlaceholder: "未命名笔记",
        markdown: "Markdown",
        contentPlaceholder: "在这里写 Markdown...",
        preview: "实时渲染",
        previewEmpty: "输入内容后会在这里实时渲染。",
        savedState: "已本地暂存",
        delete: "删除",
        justNow: "刚刚已暂存",
        savedAt: "暂存于",
        words: "字",
        untitled: "未命名笔记",
        emptyPreview: "还没有内容",
      },
);

const activeNote = computed<NoteDraft>({
  get() {
    return notes.value.find((note) => note.id === activeNoteId.value) ?? notes.value[0];
  },
  set(nextNote) {
    notes.value = notes.value.map((note) => (note.id === nextNote.id ? nextNote : note));
  },
});

const filteredNotes = computed(() => {
  const query = searchQuery.value.toLowerCase();
  if (!query) {
    return notes.value;
  }
  return notes.value.filter((note) =>
    `${note.title}\n${note.content}`.toLowerCase().includes(query),
  );
});

const renderedMarkdown = computed(() => {
  const parsed = marked.parse(activeNote.value.content, {
    async: false,
    breaks: true,
    gfm: true,
  });
  return DOMPurify.sanitize(parsed);
});

const lastSavedLabel = computed(() => {
  if (draftTouchedAt.value) {
    return copy.value.justNow;
  }
  return `${copy.value.savedAt} ${formatUpdatedAt(activeNote.value.updatedAt)}`;
});

const wordCount = computed(() => {
  const content = activeNote.value.content.trim();
  if (!content) {
    return 0;
  }
  if (props.language === "zh-CN") {
    return Array.from(content.replace(/\s+/g, "")).length;
  }
  return content.split(/\s+/).filter(Boolean).length;
});

watch(
  notes,
  (value) => {
    localStorage.setItem(notesStorageKey, JSON.stringify(value));
  },
  { deep: true },
);

watch(activeNoteId, (value) => {
  localStorage.setItem(activeNoteStorageKey, value);
});

function createNote() {
  const now = new Date().toISOString();
  const note: NoteDraft = {
    id: crypto.randomUUID(),
    title: "",
    content: sampleContent(),
    updatedAt: now,
  };
  notes.value = [note, ...notes.value];
  activeNoteId.value = note.id;
  searchQuery.value = "";
  draftTouchedAt.value = now;
}

function selectNote(noteId: string) {
  activeNoteId.value = noteId;
  draftTouchedAt.value = "";
}

function deleteActiveNote() {
  if (notes.value.length <= 1) {
    return;
  }
  const index = notes.value.findIndex((note) => note.id === activeNoteId.value);
  notes.value = notes.value.filter((note) => note.id !== activeNoteId.value);
  activeNoteId.value = notes.value[Math.max(0, index - 1)]?.id ?? notes.value[0].id;
  draftTouchedAt.value = "";
}

function markDraftTouched() {
  const current = activeNote.value;
  if (!current) {
    return;
  }
  const updatedAt = new Date().toISOString();
  current.updatedAt = updatedAt;
  draftTouchedAt.value = updatedAt;
}

function continueMarkdownList(event: KeyboardEvent) {
  if (event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  const textarea = event.currentTarget;
  if (!(textarea instanceof HTMLTextAreaElement) || textarea.selectionStart !== textarea.selectionEnd) {
    return;
  }

  const cursor = textarea.selectionStart;
  const content = activeNote.value.content;
  const lineStart = content.lastIndexOf("\n", cursor - 1) + 1;
  const lineEnd = content.indexOf("\n", cursor);
  const currentLineEnd = lineEnd === -1 ? content.length : lineEnd;
  const lineBeforeCursor = content.slice(lineStart, cursor);
  const lineAfterCursor = content.slice(cursor, currentLineEnd);
  const continuation = markdownListContinuation(lineBeforeCursor);

  if (!continuation) {
    return;
  }

  event.preventDefault();

  if (!continuation.hasContent && !lineAfterCursor.trim()) {
    const nextContent = `${content.slice(0, lineStart)}${continuation.indent}${content.slice(currentLineEnd)}`;
    const nextCursor = lineStart + continuation.indent.length;
    updateActiveNoteContent(nextContent, nextCursor, textarea);
    return;
  }

  const insertion = `\n${continuation.nextPrefix}`;
  const nextContent = `${content.slice(0, cursor)}${insertion}${content.slice(cursor)}`;
  updateActiveNoteContent(nextContent, cursor + insertion.length, textarea);
}

function markdownListContinuation(line: string) {
  const taskMatch = line.match(/^(\s*)([-+*])\s+\[([ xX])\]\s*(.*)$/);
  if (taskMatch) {
    const [, indent, marker, , value] = taskMatch;
    return {
      indent,
      nextPrefix: `${indent}${marker} [ ] `,
      hasContent: Boolean(value.trim()),
    };
  }

  const unorderedMatch = line.match(/^(\s*)([-+*])\s+(.*)$/);
  if (unorderedMatch) {
    const [, indent, marker, value] = unorderedMatch;
    return {
      indent,
      nextPrefix: `${indent}${marker} `,
      hasContent: Boolean(value.trim()),
    };
  }

  const orderedMatch = line.match(/^(\s*)(\d+)([.)])\s+(.*)$/);
  if (orderedMatch) {
    const [, indent, rawNumber, delimiter, value] = orderedMatch;
    return {
      indent,
      nextPrefix: `${indent}${Number(rawNumber) + 1}${delimiter} `,
      hasContent: Boolean(value.trim()),
    };
  }

  return null;
}

function updateActiveNoteContent(content: string, cursor: number, textarea: HTMLTextAreaElement) {
  activeNote.value.content = content;
  markDraftTouched();
  nextTick(() => {
    textarea.setSelectionRange(cursor, cursor);
  });
}

function noteTitle(note: NoteDraft) {
  return note.title.trim() || copy.value.untitled;
}

function notePreview(note: NoteDraft) {
  const content = note.content.replace(/[#>*_`[\]-]/g, "").replace(/\s+/g, " ").trim();
  if (!content) {
    return copy.value.emptyPreview;
  }
  return content.length > 42 ? `${content.slice(0, 42)}...` : content;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat(props.language === "en-US" ? "en-US" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function loadNotes(): NoteDraft[] {
  const raw = localStorage.getItem(notesStorageKey);
  if (!raw) {
    return [defaultNote()];
  }
  try {
    const parsed = JSON.parse(raw) as NoteDraft[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [defaultNote()];
  } catch {
    return [defaultNote()];
  }
}

function loadActiveNoteId(drafts: NoteDraft[]) {
  const stored = localStorage.getItem(activeNoteStorageKey);
  return drafts.some((note) => note.id === stored) ? stored ?? drafts[0].id : drafts[0].id;
}

function defaultNote(): NoteDraft {
  return {
    id: crypto.randomUUID(),
    title: "Markdown Notes",
    content: sampleContent(),
    updatedAt: new Date().toISOString(),
  };
}

function sampleContent() {
  return [
    "# 今日笔记",
    "",
    "- 支持 **Markdown** 输入",
    "- 内容会自动暂存到本地",
    "- 右侧实时渲染预览",
    "",
    "> 把零散想法先留下来。",
  ].join("\n");
}
</script>
