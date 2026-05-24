<template>
  <section class="notes-panel" :aria-label="copy.title">
    <div class="module-view-header">
      <div>
        <p class="eyebrow">Notes</p>
        <h1>{{ copy.title }}</h1>
      </div>
      <span class="status-pill online">{{ noteNotice || copy.savedState }}</span>
    </div>

    <div class="notes-workspace" @click="closeNoteMenu">
      <aside class="notes-sidebar" :aria-label="copy.draftList">
        <div class="panel-heading compact">
          <div>
            <p class="eyebrow">Library</p>
            <h2>{{ copy.draftList }}</h2>
          </div>
          <div class="notes-sidebar-actions">
            <button class="icon-button ghost" type="button" :title="copy.newGroup" @click.stop="startCreatingGroup">
              <FolderPlus :size="17" />
            </button>
            <button class="icon-button ghost" type="button" :title="copy.newNote" @click.stop="createNote()">
              <Plus :size="17" />
            </button>
          </div>
        </div>

        <label class="notes-search">
          <Search :size="16" />
          <input v-model.trim="searchQuery" type="search" :placeholder="copy.search" autocomplete="off" />
        </label>

        <div class="notes-filter-bar" :aria-label="copy.filters">
          <button
            v-for="filter in noteFilters"
            :key="filter.kind"
            type="button"
            :class="{ active: activeNoteFilter === filter.kind }"
            @click.stop="activeNoteFilter = filter.kind"
          >
            <component :is="filter.icon" :size="14" />
            <span>{{ filter.label }}</span>
          </button>
        </div>

        <form v-if="creatingGroup" class="note-group-form" @submit.prevent.stop="commitNewGroup">
          <input
            v-model.trim="groupNameDraft"
            type="text"
            :placeholder="copy.groupNamePlaceholder"
            autocomplete="off"
          />
          <button class="icon-button ghost" type="submit" :title="copy.save">
            <Check :size="16" />
          </button>
          <button class="icon-button ghost" type="button" :title="copy.cancel" @click.stop="cancelCreatingGroup">
            <X :size="16" />
          </button>
        </form>

        <div class="note-group-list">
          <section v-for="group in visibleGroups" :key="group.id" class="note-group-section">
            <form
              v-if="editingGroupId === group.id"
              class="note-group-header editable"
              @submit.prevent.stop="commitGroupRename(group.id)"
            >
              <Folder :size="16" />
              <input v-model.trim="groupNameDraft" type="text" :aria-label="copy.renameGroup" autocomplete="off" />
              <button class="icon-button ghost" type="submit" :title="copy.save">
                <Check :size="15" />
              </button>
              <button class="icon-button ghost" type="button" :title="copy.cancel" @click.stop="cancelGroupRename">
                <X :size="15" />
              </button>
            </form>

            <div v-else class="note-group-header" :class="{ active: activeGroupId === group.id }">
              <button class="note-group-toggle" type="button" @click.stop="toggleGroupCollapse(group.id)">
                <ChevronRight v-if="group.collapsed" :size="15" />
                <ChevronDown v-else :size="15" />
                <Folder :size="16" />
                <span>{{ group.name }}</span>
                <em>{{ groupNoteCount(group.id) }}</em>
              </button>
              <div class="note-group-actions">
                <button class="icon-button ghost" type="button" :title="copy.newNoteInGroup" @click.stop="createNote(group.id)">
                  <Plus :size="14" />
                </button>
                <button class="icon-button ghost" type="button" :title="copy.renameGroup" @click.stop="startEditingGroup(group)">
                  <Pencil :size="14" />
                </button>
              </div>
            </div>

            <div v-if="!group.collapsed" class="note-group-notes">
              <article
                v-for="note in groupedNotes[group.id] ?? []"
                :key="note.id"
                class="note-draft-card"
                :class="{ active: note.id === activeNoteId, pinned: note.pinned }"
              >
                <button class="note-draft-pick" type="button" @click.stop="selectNote(note.id)">
                  <span class="note-draft-icon">
                    <FileText :size="17" />
                  </span>
                  <span class="note-draft-main">
                    <span class="note-draft-title-line">
                      <strong>{{ noteTitle(note) }}</strong>
                      <Pin v-if="note.pinned" :size="13" />
                    </span>
                    <small>{{ notePreview(note) }}</small>
                    <span v-if="noteTags(note).length" class="note-tag-list">
                      <em v-for="tag in noteTags(note)" :key="tag">#{{ tag }}</em>
                    </span>
                  </span>
                  <time>{{ formatUpdatedAt(note.updatedAt) }}</time>
                </button>

                <button
                  class="note-card-menu-trigger"
                  type="button"
                  :aria-label="copy.moreOptions"
                  :title="copy.moreOptions"
                  @click.stop="toggleNoteMenu(note.id)"
                >
                  <MoreHorizontal :size="17" />
                </button>

                <div v-if="openNoteMenuId === note.id" class="note-more-menu" @click.stop>
                  <button type="button" @click="startRenamingNote(note)">
                    <Pencil :size="15" />
                    <span>{{ copy.rename }}</span>
                  </button>
                  <button type="button" @click="toggleNotePin(note.id)">
                    <Pin :size="15" />
                    <span>{{ note.pinned ? copy.unpinNote : copy.pinNote }}</span>
                  </button>
                  <label class="note-move-select">
                    <span>{{ copy.moveToGroup }}</span>
                    <select :value="note.groupId ?? defaultGroupId" @change="handleMoveNoteGroup(note.id, $event)">
                      <option v-for="targetGroup in noteGroups" :key="targetGroup.id" :value="targetGroup.id">
                        {{ targetGroup.name }}
                      </option>
                    </select>
                  </label>
                  <button class="danger" type="button" :disabled="notes.length <= 1" @click="deleteNote(note.id)">
                    <Trash2 :size="15" />
                    <span>{{ copy.delete }}</span>
                  </button>
                </div>

                <form
                  v-if="renamingNoteId === note.id"
                  class="note-rename-form"
                  @submit.prevent.stop="commitNoteRename(note.id)"
                >
                  <input v-model.trim="renameNoteDraft" type="text" :aria-label="copy.rename" autocomplete="off" />
                  <button class="icon-button ghost" type="submit" :title="copy.save">
                    <Check :size="15" />
                  </button>
                  <button class="icon-button ghost" type="button" :title="copy.cancel" @click.stop="cancelNoteRename">
                    <X :size="15" />
                  </button>
                </form>
              </article>

              <div v-if="(groupedNotes[group.id] ?? []).length === 0" class="note-group-empty">
                {{ searchQuery ? copy.empty : copy.emptyGroup }}
              </div>
            </div>
          </section>

          <div v-if="visibleGroups.length === 0" class="notes-empty">
            <StickyNote :size="28" />
            <span>{{ copy.empty }}</span>
          </div>
        </div>
      </aside>

      <section class="notes-editor-card" :aria-label="copy.editor">
        <div class="notes-editor-toolbar">
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

          <div class="notes-editor-utility">
            <div class="note-document-actions" :aria-label="copy.documentActions">
              <button class="icon-button ghost" type="button" :title="copy.copyMarkdown" @click.stop="copyActiveNoteMarkdown">
                <Copy :size="15" />
              </button>
              <button class="icon-button ghost" type="button" :title="copy.exportMarkdown" @click.stop="exportActiveNoteMarkdown">
                <Download :size="15" />
              </button>
            </div>
            <div class="notes-document-stats" :aria-label="copy.documentStats">
              <small>{{ readingTimeLabel }}</small>
              <small v-if="taskSummary.total">{{ taskSummary.completed }}/{{ taskSummary.total }} {{ copy.tasks }}</small>
              <small>{{ wordCount }} {{ copy.words }}</small>
            </div>
            <label class="outline-select-field" :class="{ disabled: !noteOutline.length }">
              <ListTree :size="15" />
              <select v-model="selectedOutlineId" :disabled="!noteOutline.length" @change="handleOutlineSelect">
                <option value="">{{ noteOutline.length ? copy.outlinePlaceholder : copy.noOutline }}</option>
                <option v-for="item in noteOutline" :key="item.id" :value="item.id">
                  {{ outlineOptionLabel(item) }}
                </option>
              </select>
            </label>
          </div>
        </div>

        <div class="notes-live-grid">
          <section class="markdown-editor" :aria-label="copy.markdown">
            <div class="markdown-editor-head">
              <span>{{ copy.markdown }}</span>
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
              <span class="markdown-preview-context">{{ activeGroupName }}</span>
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
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  CodeXml,
  Copy,
  Download,
  FileText,
  Folder,
  FolderPlus,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  MoreHorizontal,
  PanelRightOpen,
  Pencil,
  Pin,
  Plus,
  Quote,
  Search,
  SeparatorHorizontal,
  Tags,
  StickyNote,
  Strikethrough,
  Table,
  Trash2,
  X,
} from "lucide-vue-next";

import type { NoteDraft, NoteGroup } from "../types/notes";

const props = defineProps<{
  language: "zh-CN" | "en-US";
}>();

const notesStorageKey = "4ever.notes.drafts";
const activeNoteStorageKey = "4ever.notes.activeDraft";
const groupsStorageKey = "4ever.notes.groups";
const defaultGroupId = "default";

const noteGroups = ref<NoteGroup[]>(loadNoteGroups());
const notes = ref<NoteDraft[]>(normalizeNotes(loadNotes(), noteGroups.value));
const activeNoteId = ref(loadActiveNoteId(notes.value));
const searchQuery = ref("");
const markdownInputRef = ref<HTMLTextAreaElement | null>(null);
const markdownSelection = ref({ start: 0, end: 0 });
const selectedOutlineId = ref("");
const openNoteMenuId = ref<string | null>(null);
const renamingNoteId = ref<string | null>(null);
const renameNoteDraft = ref("");
const creatingGroup = ref(false);
const editingGroupId = ref<string | null>(null);
const groupNameDraft = ref("");
const activeNoteFilter = ref<NoteFilterKind>("all");
const noteNotice = ref("");
let noteNoticeTimer: number | undefined;

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

type NoteFilterKind = "all" | "pinned" | "tasks" | "tagged";

type NoteFilter = {
  kind: NoteFilterKind;
  icon: Component;
  label: string;
};

type NoteOutlineItem = {
  id: string;
  title: string;
  level: number;
  offset: number;
};

const copy = computed(() =>
  props.language === "en-US"
    ? {
        title: "Notes",
        draftList: "Library",
        newNote: "New note",
        newNoteInGroup: "New note in this group",
        newGroup: "New group",
        search: "Search notes",
        empty: "No matching drafts",
        emptyGroup: "No notes in this group",
        editor: "Markdown editor",
        markdown: "Markdown",
        contentPlaceholder: "Write Markdown here...",
        preview: "Live preview",
        previewEmpty: "The rendered note appears here as you type.",
        savedState: "Auto-saved locally",
        delete: "Delete",
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
        pinNote: "Pin note",
        unpinNote: "Unpin note",
        moreOptions: "More options",
        rename: "Rename",
        renameGroup: "Rename group",
        moveToGroup: "Move to group",
        groupNamePlaceholder: "Group name",
        defaultGroup: "Inbox",
        save: "Save",
        cancel: "Cancel",
        documentStats: "Document stats",
        documentActions: "Document actions",
        copyMarkdown: "Copy Markdown",
        exportMarkdown: "Export Markdown",
        copied: "Copied",
        exported: "Exported",
        readingTime: "min read",
        tasks: "tasks",
        filters: "Note filters",
        allNotes: "All",
        pinnedOnly: "Pinned",
        taskNotes: "Tasks",
        taggedNotes: "Tags",
        outline: "Outline",
        outlinePlaceholder: "Jump to heading",
        noOutline: "No headings",
      }
    : {
        title: "笔记",
        draftList: "笔记库",
        newNote: "新建笔记",
        newNoteInGroup: "在此分组新建笔记",
        newGroup: "新建分组",
        search: "搜索笔记",
        empty: "没有匹配的暂存笔记",
        emptyGroup: "这个分组还没有笔记",
        editor: "Markdown 编辑器",
        markdown: "Markdown",
        contentPlaceholder: "在这里写 Markdown...",
        preview: "实时渲染",
        previewEmpty: "输入内容后会在这里实时渲染。",
        savedState: "已本地暂存",
        delete: "删除",
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
        pinNote: "置顶笔记",
        unpinNote: "取消置顶",
        moreOptions: "更多选项",
        rename: "修改名字",
        renameGroup: "修改分组名",
        moveToGroup: "移动分组",
        groupNamePlaceholder: "分组名称",
        defaultGroup: "收件箱",
        save: "保存",
        cancel: "取消",
        documentStats: "文档状态",
        documentActions: "文档操作",
        copyMarkdown: "复制 Markdown",
        exportMarkdown: "导出 Markdown",
        copied: "已复制",
        exported: "已导出",
        readingTime: "分钟阅读",
        tasks: "任务",
        filters: "笔记筛选",
        allNotes: "全部",
        pinnedOnly: "置顶",
        taskNotes: "任务",
        taggedNotes: "标签",
        outline: "大纲",
        outlinePlaceholder: "跳转到标题",
        noOutline: "暂无标题",
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
  const searched = query
    ? notes.value.filter((note) => `${note.title}\n${note.content}`.toLowerCase().includes(query))
    : notes.value;
  const matches = searched.filter((note) => noteMatchesFilter(note, activeNoteFilter.value));
  return [...matches].sort((first, second) => {
    if (Boolean(first.pinned) !== Boolean(second.pinned)) {
      return first.pinned ? -1 : 1;
    }
    return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
  });
});

const groupedNotes = computed<Record<string, NoteDraft[]>>(() => {
  const groups = Object.fromEntries(noteGroups.value.map((group) => [group.id, [] as NoteDraft[]]));
  for (const note of filteredNotes.value) {
    const groupId = resolveGroupId(note.groupId);
    groups[groupId] = groups[groupId] ?? [];
    groups[groupId].push(note);
  }
  return groups;
});

const visibleGroups = computed(() => {
  if (!searchQuery.value) {
    return noteGroups.value;
  }
  return noteGroups.value.filter((group) => (groupedNotes.value[group.id] ?? []).length > 0);
});

const activeGroupId = computed(() => resolveGroupId(activeNote.value?.groupId));

const activeGroupName = computed(() => {
  return noteGroups.value.find((group) => group.id === activeGroupId.value)?.name ?? copy.value.defaultGroup;
});

const renderedMarkdown = computed(() => {
  const parsed = marked.parse(activeNote.value.content, {
    async: false,
    breaks: true,
    gfm: true,
  });
  return DOMPurify.sanitize(parsed);
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

const readingTimeLabel = computed(() => {
  const minutes = Math.max(1, Math.ceil(wordCount.value / (props.language === "zh-CN" ? 420 : 220)));
  return `${minutes} ${copy.value.readingTime}`;
});

const taskSummary = computed(() => {
  const matches = activeNote.value.content.match(/^\s*[-+*]\s+\[[ xX]\]\s+/gm) ?? [];
  const completed = matches.filter((item) => /\[[xX]\]/.test(item)).length;
  return { completed, total: matches.length };
});

const noteOutline = computed<NoteOutlineItem[]>(() => extractOutline(activeNote.value.content));

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

const noteFilters = computed<NoteFilter[]>(() => [
  { kind: "all", icon: FileText, label: copy.value.allNotes },
  { kind: "pinned", icon: Pin, label: copy.value.pinnedOnly },
  { kind: "tasks", icon: ListChecks, label: copy.value.taskNotes },
  { kind: "tagged", icon: Tags, label: copy.value.taggedNotes },
]);

watch(
  notes,
  (value) => {
    localStorage.setItem(notesStorageKey, JSON.stringify(value));
  },
  { deep: true },
);

watch(
  noteGroups,
  (value) => {
    localStorage.setItem(groupsStorageKey, JSON.stringify(value));
  },
  { deep: true },
);

watch(activeNoteId, (value) => {
  localStorage.setItem(activeNoteStorageKey, value);
  resetMarkdownSelection();
  selectedOutlineId.value = "";
  closeNoteMenu();
});

watch(noteOutline, (items) => {
  if (!items.some((item) => item.id === selectedOutlineId.value)) {
    selectedOutlineId.value = "";
  }
});

function createNote(groupId = activeGroupId.value) {
  const now = new Date().toISOString();
  const note: NoteDraft = {
    id: crypto.randomUUID(),
    title: "",
    content: sampleContent(),
    updatedAt: now,
    groupId: resolveGroupId(groupId),
  };
  expandGroup(note.groupId ?? defaultGroupId);
  notes.value = [note, ...notes.value];
  activeNoteId.value = note.id;
  searchQuery.value = "";
  openNoteMenuId.value = null;
}

function selectNote(noteId: string) {
  activeNoteId.value = noteId;
}

function deleteNote(noteId: string) {
  if (notes.value.length <= 1) {
    return;
  }
  const index = notes.value.findIndex((note) => note.id === noteId);
  notes.value = notes.value.filter((note) => note.id !== noteId);
  if (activeNoteId.value === noteId) {
    activeNoteId.value = notes.value[Math.max(0, index - 1)]?.id ?? notes.value[0].id;
  }
  openNoteMenuId.value = null;
  renamingNoteId.value = null;
}

function toggleNotePin(noteId: string) {
  const note = notes.value.find((item) => item.id === noteId);
  if (!note) {
    return;
  }
  note.pinned = !note.pinned;
  note.updatedAt = new Date().toISOString();
  openNoteMenuId.value = null;
}

function startRenamingNote(note: NoteDraft) {
  renamingNoteId.value = note.id;
  renameNoteDraft.value = noteTitle(note);
  openNoteMenuId.value = null;
}

function commitNoteRename(noteId: string) {
  const note = notes.value.find((item) => item.id === noteId);
  if (!note) {
    return;
  }
  note.title = renameNoteDraft.value.trim();
  note.updatedAt = new Date().toISOString();
  renamingNoteId.value = null;
  renameNoteDraft.value = "";
}

function cancelNoteRename() {
  renamingNoteId.value = null;
  renameNoteDraft.value = "";
}

function handleMoveNoteGroup(noteId: string, event: Event) {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }
  moveNoteToGroup(noteId, select.value);
}

function moveNoteToGroup(noteId: string, groupId: string) {
  const note = notes.value.find((item) => item.id === noteId);
  if (!note) {
    return;
  }
  note.groupId = resolveGroupId(groupId);
  note.updatedAt = new Date().toISOString();
  expandGroup(note.groupId);
  openNoteMenuId.value = null;
}

function startCreatingGroup() {
  creatingGroup.value = true;
  editingGroupId.value = null;
  groupNameDraft.value = "";
  openNoteMenuId.value = null;
}

function commitNewGroup() {
  const name = groupNameDraft.value.trim();
  if (!name) {
    return;
  }
  const now = new Date().toISOString();
  noteGroups.value = [
    ...noteGroups.value,
    {
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      collapsed: false,
    },
  ];
  creatingGroup.value = false;
  groupNameDraft.value = "";
}

function cancelCreatingGroup() {
  creatingGroup.value = false;
  groupNameDraft.value = "";
}

function startEditingGroup(group: NoteGroup) {
  editingGroupId.value = group.id;
  creatingGroup.value = false;
  groupNameDraft.value = group.name;
  openNoteMenuId.value = null;
}

function commitGroupRename(groupId: string) {
  const name = groupNameDraft.value.trim();
  if (!name) {
    return;
  }
  const group = noteGroups.value.find((item) => item.id === groupId);
  if (group) {
    group.name = name;
  }
  cancelGroupRename();
}

function cancelGroupRename() {
  editingGroupId.value = null;
  groupNameDraft.value = "";
}

function toggleGroupCollapse(groupId: string) {
  const group = noteGroups.value.find((item) => item.id === groupId);
  if (group) {
    group.collapsed = !group.collapsed;
  }
}

function expandGroup(groupId: string) {
  const group = noteGroups.value.find((item) => item.id === groupId);
  if (group) {
    group.collapsed = false;
  }
}

function groupNoteCount(groupId: string) {
  return notes.value.filter((note) => resolveGroupId(note.groupId) === groupId).length;
}

function toggleNoteMenu(noteId: string) {
  openNoteMenuId.value = openNoteMenuId.value === noteId ? null : noteId;
  renamingNoteId.value = null;
}

function closeNoteMenu() {
  openNoteMenuId.value = null;
}

function markDraftTouched() {
  const current = activeNote.value;
  if (!current) {
    return;
  }
  const updatedAt = new Date().toISOString();
  current.updatedAt = updatedAt;
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

function jumpToOutlineItem(item: NoteOutlineItem) {
  const textarea = markdownInputRef.value;
  if (!textarea) {
    return;
  }
  const lineEnd = activeNote.value.content.indexOf("\n", item.offset);
  const selectionEnd = lineEnd === -1 ? activeNote.value.content.length : lineEnd;
  nextTick(() => {
    textarea.focus();
    textarea.setSelectionRange(item.offset, selectionEnd);
    textarea.scrollTop = Math.max(0, item.offset * 0.28);
    rememberMarkdownSelection();
  });
}

function handleOutlineSelect() {
  const item = noteOutline.value.find((outlineItem) => outlineItem.id === selectedOutlineId.value);
  if (item) {
    jumpToOutlineItem(item);
  }
}

async function copyActiveNoteMarkdown() {
  const content = activeNote.value.content;
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  showNoteNotice(copy.value.copied);
}

function exportActiveNoteMarkdown() {
  const note = activeNote.value;
  const blob = new Blob([note.content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeMarkdownFilename(noteTitle(note))}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  showNoteNotice(copy.value.exported);
}

function showNoteNotice(message: string) {
  if (noteNoticeTimer) {
    window.clearTimeout(noteNoticeTimer);
  }
  noteNotice.value = message;
  noteNoticeTimer = window.setTimeout(() => {
    noteNotice.value = "";
    noteNoticeTimer = undefined;
  }, 1800);
}

function outlineOptionLabel(item: NoteOutlineItem) {
  return `${" ".repeat((item.level - 1) * 2)}${item.title}`;
}

function extractOutline(content: string): NoteOutlineItem[] {
  const outline: NoteOutlineItem[] = [];
  const headingPattern = /^(#{1,3})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(content)) !== null) {
    const [, marker, title] = match;
    outline.push({
      id: `${match.index}-${title}`,
      title: title.replace(/[*_`~[\]()]/g, "").trim(),
      level: marker.length,
      offset: match.index,
    });
  }
  return outline;
}

function noteTags(note: NoteDraft) {
  const tags = new Set<string>();
  const tagPattern = /(^|\s)#([\p{L}\p{N}_-]{2,24})/gu;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(`${note.title}\n${note.content}`)) !== null && tags.size < 4) {
    tags.add(match[2]);
  }
  return [...tags];
}

function noteMatchesFilter(note: NoteDraft, filter: NoteFilterKind) {
  if (filter === "pinned") {
    return Boolean(note.pinned);
  }
  if (filter === "tasks") {
    return /^\s*[-+*]\s+\[[ xX]\]\s+/m.test(note.content);
  }
  if (filter === "tagged") {
    return noteTags(note).length > 0;
  }
  return true;
}

function noteTitle(note: NoteDraft) {
  return note.title.trim() || copy.value.untitled;
}

function safeMarkdownFilename(value: string) {
  const name = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return name || "note";
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

function resolveGroupId(groupId?: string) {
  return noteGroups.value.some((group) => group.id === groupId) ? groupId ?? defaultGroupId : defaultGroupId;
}

function normalizeNotes(drafts: NoteDraft[], groups: NoteGroup[]) {
  const groupIds = new Set(groups.map((group) => group.id));
  const fallbackGroupId = groupIds.has(defaultGroupId) ? defaultGroupId : groups[0]?.id ?? defaultGroupId;
  return drafts.map((note) => ({
    ...note,
    groupId: note.groupId && groupIds.has(note.groupId) ? note.groupId : fallbackGroupId,
  }));
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

function loadNoteGroups(): NoteGroup[] {
  const raw = localStorage.getItem(groupsStorageKey);
  if (!raw) {
    return [defaultNoteGroup()];
  }
  try {
    const parsed = JSON.parse(raw) as NoteGroup[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [defaultNoteGroup()];
    }
    const groups = parsed
      .filter((group) => group && typeof group.id === "string" && typeof group.name === "string")
      .map((group) => ({
        id: group.id,
        name: group.name.trim() || defaultNoteGroup().name,
        createdAt: group.createdAt || new Date().toISOString(),
        collapsed: Boolean(group.collapsed),
      }));
    return ensureDefaultGroup(groups);
  } catch {
    return [defaultNoteGroup()];
  }
}

function ensureDefaultGroup(groups: NoteGroup[]) {
  if (groups.some((group) => group.id === defaultGroupId)) {
    return groups;
  }
  return [defaultNoteGroup(), ...groups];
}

function loadActiveNoteId(drafts: NoteDraft[]) {
  const stored = localStorage.getItem(activeNoteStorageKey);
  return drafts.some((note) => note.id === stored) ? stored ?? drafts[0].id : drafts[0].id;
}

function defaultNoteGroup(): NoteGroup {
  return {
    id: defaultGroupId,
    name: props.language === "en-US" ? "Inbox" : "收件箱",
    createdAt: new Date().toISOString(),
    collapsed: false,
  };
}

function defaultNote(): NoteDraft {
  return {
    id: crypto.randomUUID(),
    title: "Markdown Notes",
    content: sampleContent(),
    updatedAt: new Date().toISOString(),
    groupId: defaultGroupId,
  };
}

function sampleContent() {
  return "> 你的情绪和思考很珍贵。";
}
</script>
