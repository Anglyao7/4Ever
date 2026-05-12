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
          <section class="markdown-editor" :aria-label="copy.markdown">
            <div class="markdown-editor-head">
              <span>{{ copy.markdown }}</span>
              <div class="markdown-format-panel" role="toolbar" :aria-label="copy.syntaxTools">
                <button
                  v-for="action in markdownActions"
                  :key="action.kind"
                  class="markdown-format-button"
                  type="button"
                  :title="action.label"
                  :aria-label="action.label"
                  @pointerdown.prevent.stop
                  @mousedown.prevent.stop
                  @click.prevent.stop="applyMarkdownFormat(action.kind)"
                >
                  <component :is="action.icon" :size="16" />
                </button>
              </div>
            </div>
            <div class="markdown-editor-body">
              <textarea
                ref="markdownInputRef"
                v-model="activeNote.content"
                :aria-label="copy.markdown"
                spellcheck="true"
                :placeholder="copy.contentPlaceholder"
                @input="markDraftTouched"
                @keydown="handleMarkdownKeydown"
                @keyup="rememberMarkdownSelection"
                @mouseup="rememberMarkdownSelection"
                @select="rememberMarkdownSelection"
              />
            </div>
          </section>

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
import type { Component } from "vue";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  BookOpenText,
  Bold,
  Clock3,
  Code,
  CodeXml,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  PanelRightOpen,
  Plus,
  Quote,
  Search,
  SeparatorHorizontal,
  StickyNote,
  Strikethrough,
  Table,
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
const markdownInputRef = ref<HTMLTextAreaElement | null>(null);
const markdownSelection = ref({ start: 0, end: 0 });

type MarkdownFormatKind =
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bold"
  | "italic"
  | "strike"
  | "inline-code"
  | "link"
  | "image"
  | "quote"
  | "unordered-list"
  | "ordered-list"
  | "task-list"
  | "code-block"
  | "table"
  | "horizontal-rule";

type MarkdownFormatAction = {
  kind: MarkdownFormatKind;
  icon: Component;
  label: string;
};

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
        syntaxTools: "Markdown tools",
        heading1: "Heading 1",
        heading2: "Heading 2",
        heading3: "Heading 3",
        bold: "Bold",
        italic: "Italic",
        strike: "Strikethrough",
        inlineCode: "Inline code",
        link: "Link",
        image: "Image",
        quote: "Quote",
        unorderedList: "Bulleted list",
        orderedList: "Numbered list",
        taskList: "Task list",
        codeBlock: "Code block",
        table: "Table",
        horizontalRule: "Divider",
        selectedText: "selected text",
        linkText: "link text",
        imageAlt: "image description",
        codeSample: "code",
        tableHeaderOne: "Header",
        tableHeaderTwo: "Value",
        tableCellOne: "Item",
        tableCellTwo: "Description",
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
        syntaxTools: "Markdown 工具",
        heading1: "一级标题",
        heading2: "二级标题",
        heading3: "三级标题",
        bold: "加粗",
        italic: "斜体",
        strike: "删除线",
        inlineCode: "行内代码",
        link: "链接",
        image: "图片",
        quote: "引用",
        unorderedList: "无序列表",
        orderedList: "有序列表",
        taskList: "任务列表",
        codeBlock: "代码块",
        table: "表格",
        horizontalRule: "分割线",
        selectedText: "选中文本",
        linkText: "链接文字",
        imageAlt: "图片描述",
        codeSample: "代码",
        tableHeaderOne: "标题",
        tableHeaderTwo: "内容",
        tableCellOne: "项目",
        tableCellTwo: "说明",
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

const markdownActions = computed<MarkdownFormatAction[]>(() => [
  { kind: "heading-1", icon: Heading1, label: copy.value.heading1 },
  { kind: "heading-2", icon: Heading2, label: copy.value.heading2 },
  { kind: "heading-3", icon: Heading3, label: copy.value.heading3 },
  { kind: "bold", icon: Bold, label: copy.value.bold },
  { kind: "italic", icon: Italic, label: copy.value.italic },
  { kind: "strike", icon: Strikethrough, label: copy.value.strike },
  { kind: "inline-code", icon: Code, label: copy.value.inlineCode },
  { kind: "link", icon: Link2, label: copy.value.link },
  { kind: "image", icon: Image, label: copy.value.image },
  { kind: "quote", icon: Quote, label: copy.value.quote },
  { kind: "unordered-list", icon: List, label: copy.value.unorderedList },
  { kind: "ordered-list", icon: ListOrdered, label: copy.value.orderedList },
  { kind: "task-list", icon: ListChecks, label: copy.value.taskList },
  { kind: "code-block", icon: CodeXml, label: copy.value.codeBlock },
  { kind: "table", icon: Table, label: copy.value.table },
  { kind: "horizontal-rule", icon: SeparatorHorizontal, label: copy.value.horizontalRule },
]);

watch(
  notes,
  (value) => {
    localStorage.setItem(notesStorageKey, JSON.stringify(value));
  },
  { deep: true },
);

watch(activeNoteId, (value) => {
  localStorage.setItem(activeNoteStorageKey, value);
  resetMarkdownSelection();
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

function rememberMarkdownSelection(event?: Event) {
  const input = event?.currentTarget instanceof HTMLTextAreaElement
    ? event.currentTarget
    : markdownInputRef.value;
  if (!input) {
    return;
  }
  markdownSelection.value = {
    start: input.selectionStart,
    end: input.selectionEnd,
  };
}

function resetMarkdownSelection() {
  markdownSelection.value = { start: 0, end: 0 };
}

function handleMarkdownKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    continueMarkdownList(event);
    return;
  }

  if (event.key === "Tab") {
    indentMarkdownSelection(event);
    return;
  }

  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing) {
    return;
  }

  const key = event.key.toLowerCase();
  const shortcuts: Partial<Record<string, MarkdownFormatKind>> = {
    b: "bold",
    i: "italic",
    k: "link",
    e: "inline-code",
  };
  const action = shortcuts[key];
  if (!action) {
    return;
  }
  event.preventDefault();
  applyMarkdownFormat(action);
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

function indentMarkdownSelection(event: KeyboardEvent) {
  if (event.isComposing) {
    return;
  }

  const textarea = event.currentTarget;
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }

  event.preventDefault();

  const content = activeNote.value.content;
  const { start, end } = getMarkdownSelection(textarea);
  if (start === end && !event.shiftKey) {
    replaceMarkdownContent(
      `${content.slice(0, start)}  ${content.slice(end)}`,
      start + 2,
      start + 2,
      textarea,
    );
    return;
  }

  const { lineStart, lineEnd } = selectedLineRange(content, start, end);
  const block = content.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const transformed = lines.map((line) =>
    event.shiftKey ? line.replace(/^( {1,2}|\t)/, "") : `  ${line}`,
  );
  const nextBlock = transformed.join("\n");
  const selectionDelta = nextBlock.length - block.length;
  replaceMarkdownContent(
    `${content.slice(0, lineStart)}${nextBlock}${content.slice(lineEnd)}`,
    Math.max(lineStart, start + (event.shiftKey ? Math.min(0, selectionDelta) : 2)),
    Math.max(lineStart, end + selectionDelta),
    textarea,
  );
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
  replaceMarkdownContent(content, cursor, cursor, textarea);
}

function applyMarkdownFormat(kind: MarkdownFormatKind) {
  const textarea = markdownInputRef.value;
  if (!textarea) {
    return;
  }

  const handlers: Record<MarkdownFormatKind, () => void> = {
    "heading-1": () => applyHeading(1, textarea),
    "heading-2": () => applyHeading(2, textarea),
    "heading-3": () => applyHeading(3, textarea),
    bold: () => wrapInline("**", "**", copy.value.selectedText, textarea),
    italic: () => wrapInline("_", "_", copy.value.selectedText, textarea),
    strike: () => wrapInline("~~", "~~", copy.value.selectedText, textarea),
    "inline-code": () => wrapInline("`", "`", copy.value.codeSample, textarea),
    link: () => insertLink(textarea),
    image: () => insertImage(textarea),
    quote: () => toggleQuote(textarea),
    "unordered-list": () => applyList("unordered", textarea),
    "ordered-list": () => applyList("ordered", textarea),
    "task-list": () => applyList("task", textarea),
    "code-block": () => insertCodeBlock(textarea),
    table: () => insertTable(textarea),
    "horizontal-rule": () => insertHorizontalRule(textarea),
  };

  handlers[kind]();
}

function wrapInline(prefix: string, suffix: string, placeholder: string, textarea: HTMLTextAreaElement) {
  const content = activeNote.value.content;
  const { start, end } = getMarkdownSelection(textarea, true);
  const selected = content.slice(start, end) || placeholder;
  const nextContent = `${content.slice(0, start)}${prefix}${selected}${suffix}${content.slice(end)}`;
  const nextStart = start + prefix.length;
  replaceMarkdownContent(nextContent, nextStart, nextStart + selected.length, textarea);
}

function insertLink(textarea: HTMLTextAreaElement) {
  const content = activeNote.value.content;
  const { start, end } = getMarkdownSelection(textarea, true);
  const selectedContent = content.slice(start, end);
  const selected = selectedContent || copy.value.linkText;
  const url = "https://";
  const nextText = `[${selected}](${url})`;
  const nextContent = `${content.slice(0, start)}${nextText}${content.slice(end)}`;
  const selectStart = selectedContent ? start + selected.length + 3 : start + 1;
  const selectEnd = selectedContent ? selectStart + url.length : selectStart + selected.length;
  replaceMarkdownContent(nextContent, selectStart, selectEnd, textarea);
}

function insertImage(textarea: HTMLTextAreaElement) {
  const content = activeNote.value.content;
  const { start, end } = getMarkdownSelection(textarea, true);
  const selected = content.slice(start, end) || copy.value.imageAlt;
  const url = "https://";
  const nextText = `![${selected}](${url})`;
  const nextContent = `${content.slice(0, start)}${nextText}${content.slice(end)}`;
  const selectStart = start + selected.length + 4;
  replaceMarkdownContent(nextContent, selectStart, selectStart + url.length, textarea);
}

function applyHeading(level: 1 | 2 | 3, textarea: HTMLTextAreaElement) {
  transformSelectedLines(textarea, (line) => {
    const withoutHeading = line.replace(/^(\s*)#{1,6}\s+/, "$1");
    const [, indent = "", body = ""] = withoutHeading.match(/^(\s*)(.*)$/) ?? [];
    return `${indent}${"#".repeat(level)} ${body}`;
  });
}

function toggleQuote(textarea: HTMLTextAreaElement) {
  const content = activeNote.value.content;
  const { start, end } = getMarkdownSelection(textarea, true);
  const { lineStart, lineEnd } = selectedLineRange(content, start, end);
  const lines = content.slice(lineStart, lineEnd).split("\n");
  const quoteLines = lines.filter((line) => line.trim());
  const shouldRemove = quoteLines.length > 0 && quoteLines.every((line) => /^\s*>\s?/.test(line));
  const nextBlock = lines
    .map((line) => {
      if (!line.trim()) {
        return line;
      }
      return shouldRemove ? line.replace(/^(\s*)>\s?/, "$1") : line.replace(/^(\s*)/, "$1> ");
    })
    .join("\n");
  replaceLineBlock(content, lineStart, lineEnd, nextBlock, textarea);
}

function applyList(type: "unordered" | "ordered" | "task", textarea: HTMLTextAreaElement) {
  let orderedIndex = 1;

  transformSelectedLines(textarea, (line, index, isMultiLine) => {
    if (isMultiLine && !line.trim()) {
      return line;
    }
    const [, indent = "", body = ""] = line.match(/^(\s*)(.*)$/) ?? [];
    const cleanBody = body.replace(/^([-+*]\s+\[[ xX]\]\s+|[-+*]\s+|\d+[.)]\s+)/, "");
    if (type === "ordered") {
      const nextLine = `${indent}${orderedIndex}. ${cleanBody}`;
      orderedIndex += 1;
      return nextLine;
    }
    if (type === "task") {
      return `${indent}- [ ] ${cleanBody}`;
    }
    return `${indent}- ${cleanBody}`;
  });
}

function insertCodeBlock(textarea: HTMLTextAreaElement) {
  const content = activeNote.value.content;
  const { start, end } = getMarkdownSelection(textarea, true);
  const selected = content.slice(start, end) || copy.value.codeSample;
  const prefix = start > 0 && content[start - 1] !== "\n" ? "\n" : "";
  const suffix = end < content.length && content[end] !== "\n" ? "\n" : "";
  const block = `${prefix}\`\`\`\n${selected}\n\`\`\`${suffix}`;
  const nextContent = `${content.slice(0, start)}${block}${content.slice(end)}`;
  const selectStart = start + prefix.length + 4;
  replaceMarkdownContent(nextContent, selectStart, selectStart + selected.length, textarea);
}

function insertTable(textarea: HTMLTextAreaElement) {
  const table = [
    `| ${copy.value.tableHeaderOne} | ${copy.value.tableHeaderTwo} |`,
    "| --- | --- |",
    `| ${copy.value.tableCellOne} | ${copy.value.tableCellTwo} |`,
  ].join("\n");
  insertBlock(table, textarea);
}

function insertHorizontalRule(textarea: HTMLTextAreaElement) {
  insertBlock("---", textarea, { selectInserted: false });
}

function insertBlock(
  block: string,
  textarea: HTMLTextAreaElement,
  options: { selectInserted?: boolean } = {},
) {
  const selectInserted = options.selectInserted ?? true;
  const content = activeNote.value.content;
  const { start, end } = getMarkdownSelection(textarea, true);
  const prefix = start > 0 && content[start - 1] !== "\n" ? "\n\n" : "";
  const suffix = end < content.length && content[end] !== "\n" ? "\n\n" : "\n";
  const insertion = `${prefix}${block}${suffix}`;
  const nextContent = `${content.slice(0, start)}${insertion}${content.slice(end)}`;
  const nextStart = start + prefix.length;
  const nextEnd = selectInserted ? nextStart + block.length : nextStart + block.length + suffix.length;
  replaceMarkdownContent(nextContent, nextStart, nextEnd, textarea);
}

function transformSelectedLines(
  textarea: HTMLTextAreaElement,
  transform: (line: string, index: number, isMultiLine: boolean) => string,
) {
  const content = activeNote.value.content;
  const { start, end } = getMarkdownSelection(textarea, true);
  const { lineStart, lineEnd } = selectedLineRange(content, start, end);
  const block = content.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const nextBlock = lines.map((line, index) => transform(line, index, lines.length > 1 || end > start)).join("\n");
  replaceLineBlock(content, lineStart, lineEnd, nextBlock, textarea);
}

function replaceLineBlock(
  content: string,
  lineStart: number,
  lineEnd: number,
  nextBlock: string,
  textarea: HTMLTextAreaElement,
) {
  const nextContent = `${content.slice(0, lineStart)}${nextBlock}${content.slice(lineEnd)}`;
  replaceMarkdownContent(nextContent, lineStart, lineStart + nextBlock.length, textarea);
}

function getMarkdownSelection(textarea: HTMLTextAreaElement, preferStoredSelection = false) {
  const contentLength = activeNote.value.content.length;
  const current = {
    start: clampSelectionOffset(textarea.selectionStart, contentLength),
    end: clampSelectionOffset(textarea.selectionEnd, contentLength),
  };
  if (current.end > current.start) {
    markdownSelection.value = current;
    return current;
  }
  if (
    preferStoredSelection
    && document.activeElement !== textarea
    && markdownSelection.value.end > markdownSelection.value.start
  ) {
    return {
      start: clampSelectionOffset(markdownSelection.value.start, contentLength),
      end: clampSelectionOffset(markdownSelection.value.end, contentLength),
    };
  }
  return current;
}

function clampSelectionOffset(offset: number, contentLength: number) {
  return Math.min(Math.max(offset, 0), contentLength);
}

function selectedLineRange(content: string, start: number, end: number) {
  const lineStart = content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const adjustedEnd = end > start && content[end - 1] === "\n" ? end - 1 : end;
  const nextLineBreak = content.indexOf("\n", adjustedEnd);
  const lineEnd = nextLineBreak === -1 ? content.length : nextLineBreak;
  return { lineStart, lineEnd };
}

function replaceMarkdownContent(
  content: string,
  selectionStart: number,
  selectionEnd: number,
  textarea: HTMLTextAreaElement,
) {
  activeNote.value.content = content;
  markDraftTouched();
  markdownSelection.value = { start: selectionStart, end: selectionEnd };
  nextTick(() => {
    textarea.focus();
    textarea.setSelectionRange(selectionStart, selectionEnd);
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
  return "> 你的情绪和思考很珍贵。";
}
</script>
