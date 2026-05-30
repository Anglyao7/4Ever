import { useEffect, useMemo, useRef, useState } from "react";
import { Bold, Code2, Download, Eye, FileText, Heading1, Heading2, Italic, Link, List, ListOrdered, Minus, Plus, Quote, Save, Search, Star, Table2, Trash2 } from "lucide-react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { NoteDraft } from "./types/notes";

const notesStorageKey = "4ever.notes";
const activeNoteStorageKey = "4ever.notes.active";
const notesSaveError = "本地保存失败，请检查浏览器存储空间后再继续编辑。";

type MarkdownAction = "h1" | "h2" | "bold" | "italic" | "quote" | "ul" | "ol" | "code" | "link" | "table" | "hr";

export default function NotesPanel() {
  const [notes, setNotes] = useState<NoteDraft[]>(loadNotes);
  const [activeId, setActiveId] = useState(() => loadActiveNoteId() || (notes[0]?.id ?? ""));
  const [query, setQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState("");
  const [saveError, setSaveError] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const activeNote = notes.find((note) => note.id === activeId) ?? notes[0] ?? null;
  const visibleNotes = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return [...notes]
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt))
      .filter((note) => !keyword || `${note.title} ${note.content}`.toLowerCase().includes(keyword));
  }, [notes, query]);
  const renderedMarkdown = useMemo(() => renderMarkdown(activeNote?.content ?? ""), [activeNote?.content]);

  useEffect(() => {
    const nextActiveId = activeNote?.id ?? "";
    if (activeId === nextActiveId) return;
    setActiveId(nextActiveId);
    try {
      if (nextActiveId) {
        localStorage.setItem(activeNoteStorageKey, nextActiveId);
      } else {
        localStorage.removeItem(activeNoteStorageKey);
      }
    } catch {
      setSaveError(notesSaveError);
    }
  }, [activeId, activeNote?.id]);

  function commit(nextNotes: NoteDraft[], nextActiveId = activeId) {
    const previousNotes = readStorageValue(notesStorageKey);
    const previousActiveId = readStorageValue(activeNoteStorageKey);
    try {
      localStorage.setItem(notesStorageKey, JSON.stringify(nextNotes));
      if (nextActiveId) {
        localStorage.setItem(activeNoteStorageKey, nextActiveId);
      } else {
        localStorage.removeItem(activeNoteStorageKey);
      }
      setSaveError("");
      setNotes(nextNotes);
      setActiveId(nextActiveId);
    } catch {
      restoreStorageValue(notesStorageKey, previousNotes);
      restoreStorageValue(activeNoteStorageKey, previousActiveId);
      setSaveError(notesSaveError);
    }
  }

  function createNote() {
    const now = new Date().toISOString();
    const note: NoteDraft = {
      id: `note-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      title: "未命名笔记",
      content: "# 未命名笔记\n\n写下一点新的线索。",
      updatedAt: now,
      pinned: false,
    };
    setDeleteConfirmId("");
    commit([note, ...notes], note.id);
  }

  function updateNote(patch: Partial<NoteDraft>) {
    if (!activeNote) return;
    setDeleteConfirmId("");
    commit(notes.map((note) => note.id === activeNote.id ? { ...note, ...patch, updatedAt: new Date().toISOString() } : note), activeNote.id);
  }

  function updateQuery(value: string) {
    setQuery(value);
    setDeleteConfirmId("");
  }

  function clearQuery() {
    setQuery("");
    setDeleteConfirmId("");
  }

  function deleteNote(noteId: string) {
    const nextNotes = notes.filter((note) => note.id !== noteId);
    setDeleteConfirmId("");
    commit(nextNotes, nextNotes[0]?.id ?? "");
  }

  function requestDeleteNote(noteId: string) {
    if (deleteConfirmId === noteId) {
      deleteNote(noteId);
      return;
    }
    setDeleteConfirmId(noteId);
  }

  function selectNote(noteId: string) {
    setDeleteConfirmId("");
    commit(notes, noteId);
  }

  function exportMarkdown() {
    if (!activeNote) return;
    const blob = new Blob([activeNote.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFilename(activeNote.title || "note")}.md`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function applyMarkdown(action: MarkdownAction) {
    if (!activeNote || !editorRef.current) return;
    const textarea = editorRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = activeNote.content.slice(start, end);
    const next = markdownTransform(action, selected);
    const nextContent = `${activeNote.content.slice(0, start)}${next.text}${activeNote.content.slice(end)}`;
    updateNote({ content: nextContent });
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + next.selectionStart, start + next.selectionEnd);
    });
  }

  return (
    <section className="react-notes-panel">
      <div className="module-view-header">
        <div>
          <p className="eyebrow">Markdown 笔记</p>
          <h1>笔记</h1>
        </div>
        <button className="primary-action compact" type="button" onClick={createNote}><Plus size={16} /><span>新建</span></button>
      </div>
      <div className="react-notes-layout markdown-notes-layout">
        <aside className="react-notes-sidebar">
          <label className="react-search-field"><Search size={15} /><input value={query} aria-label="搜索笔记" placeholder="搜索笔记" onChange={(event) => updateQuery(event.target.value)} /></label>
          <div className="react-note-list">
            {visibleNotes.map((note) => (
              <button key={note.id} className={`react-note-item ${activeNote?.id === note.id ? "active" : ""}`} type="button" aria-current={activeNote?.id === note.id ? "true" : undefined} onClick={() => selectNote(note.id)}>
                <FileText size={16} />
                <span><strong>{note.title || "未命名笔记"}</strong><small>{formatDate(note.updatedAt)}</small></span>
                {note.pinned && <Star size={14} />}
              </button>
            ))}
            {!visibleNotes.length && <div className="notes-list-empty" role="status" aria-live="polite"><p className="react-empty-line">{notes.length ? "没有匹配的笔记" : "笔记列表为空"}</p>{notes.length > 0 && <button className="secondary-button compact" type="button" onClick={clearQuery}>清除搜索</button>}</div>}
          </div>
        </aside>
        <article className="react-note-editor markdown-note-editor">
          {activeNote ? (
            <>
              <div className={`react-note-toolbar ${deleteConfirmId === activeNote.id ? "confirming-delete" : ""}`}>
                <button className="secondary-button" type="button" aria-pressed={activeNote.pinned} onClick={() => updateNote({ pinned: !activeNote.pinned })}><Star size={15} /><span>{activeNote.pinned ? "取消置顶" : "置顶"}</span></button>
                <button className="secondary-button" type="button" onClick={exportMarkdown}><Download size={15} /><span>导出 .md</span></button>
                <button className="secondary-button danger" type="button" title={deleteConfirmId === activeNote.id ? "再次点击会删除当前笔记" : "删除当前笔记"} onClick={() => requestDeleteNote(activeNote.id)}><Trash2 size={15} /><span>{deleteConfirmId === activeNote.id ? "确认删除" : "删除"}</span></button>
                {deleteConfirmId === activeNote.id && <button className="secondary-button compact" type="button" onClick={() => setDeleteConfirmId("")}>取消</button>}
              </div>
              <input className="react-note-title" value={activeNote.title} aria-label="笔记标题" placeholder="未命名笔记" onChange={(event) => updateNote({ title: event.target.value })} />
              <div className="notes-live-grid compact-markdown-grid">
                <section className="markdown-editor">
                  <div className="markdown-editor-head">
                    <span>编辑</span>
                    <div className="markdown-format-panel" role="toolbar" aria-label="Markdown 工具栏">
                      {formatActions.map((action) => <button key={action.id} className="markdown-format-button" type="button" title={action.label} aria-label={action.label} onClick={() => applyMarkdown(action.id)}>{action.icon}</button>)}
                    </div>
                  </div>
                  <div className="markdown-editor-body"><textarea ref={editorRef} value={activeNote.content} aria-label="Markdown 正文" placeholder="写下 Markdown 内容" onChange={(event) => updateNote({ content: event.target.value })} /></div>
                </section>
                <section className="markdown-preview-card" aria-label="Markdown 实时预览">
                  <div className="markdown-preview-head"><span><Eye size={15} />实时预览</span><small>{wordCount(activeNote.content)} 字</small></div>
                  {activeNote.content.trim() ? <div className="markdown-body" aria-live="polite" dangerouslySetInnerHTML={{ __html: renderedMarkdown }} /> : <div className="markdown-empty" role="status" aria-live="polite"><FileText size={26} /><p>开始输入 Markdown 内容</p></div>}
                </section>
              </div>
              {saveError ? <div className="react-note-status error" role="alert"><Save size={14} /> {saveError}</div> : <div className="react-note-status" role="status" aria-live="polite"><Save size={14} /> 已自动保存</div>}
            </>
          ) : (
            <div className="react-note-empty" role="status" aria-live="polite"><FileText size={28} /><strong>还没有笔记</strong><button className="primary-action compact" type="button" onClick={createNote}>新建第一条</button></div>
          )}
        </article>
      </div>
    </section>
  );
}

const formatActions: Array<{ id: MarkdownAction; label: string; icon: React.ReactNode }> = [
  { id: "h1", label: "一级标题", icon: <Heading1 size={16} /> },
  { id: "h2", label: "二级标题", icon: <Heading2 size={16} /> },
  { id: "bold", label: "加粗", icon: <Bold size={16} /> },
  { id: "italic", label: "斜体", icon: <Italic size={16} /> },
  { id: "quote", label: "引用", icon: <Quote size={16} /> },
  { id: "ul", label: "无序列表", icon: <List size={16} /> },
  { id: "ol", label: "有序列表", icon: <ListOrdered size={16} /> },
  { id: "code", label: "代码块", icon: <Code2 size={16} /> },
  { id: "link", label: "链接", icon: <Link size={16} /> },
  { id: "table", label: "表格", icon: <Table2 size={16} /> },
  { id: "hr", label: "分割线", icon: <Minus size={16} /> },
];

function markdownTransform(action: MarkdownAction, selected: string) {
  const content = selected || defaultSelection(action);
  if (action === "h1") return wrapLine(content, "# ");
  if (action === "h2") return wrapLine(content, "## ");
  if (action === "bold") return wrapInline(content, "**", "**");
  if (action === "italic") return wrapInline(content, "*", "*");
  if (action === "quote") return wrapMultiline(content, "> ");
  if (action === "ul") return wrapMultiline(content, "- ");
  if (action === "ol") return wrapOrderedList(content);
  if (action === "code") return { text: `\n\`\`\`\n${content}\n\`\`\`\n`, selectionStart: 5, selectionEnd: 5 + content.length };
  if (action === "link") return { text: `[${content}](https://)`, selectionStart: 1, selectionEnd: 1 + content.length };
  if (action === "table") return markdownTableTransform();
  return { text: "\n---\n", selectionStart: 5, selectionEnd: 5 };
}

function defaultSelection(action: MarkdownAction) {
  return action === "link" ? "链接文字" : action === "code" ? "code" : "文本";
}

function wrapInline(content: string, before: string, after: string) {
  return { text: `${before}${content}${after}`, selectionStart: before.length, selectionEnd: before.length + content.length };
}

function wrapLine(content: string, prefix: string) {
  return { text: `${prefix}${content}`, selectionStart: prefix.length, selectionEnd: prefix.length + content.length };
}

function wrapMultiline(content: string, prefix: string) {
  const text = content.split("\n").map((line) => `${prefix}${line}`).join("\n");
  return { text, selectionStart: prefix.length, selectionEnd: text.length };
}

function wrapOrderedList(content: string) {
  const lines = content.split("\n");
  const text = lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
  return { text, selectionStart: "1. ".length, selectionEnd: text.length };
}

function markdownTableTransform() {
  const text = "\n| 列 A | 列 B | 列 C |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n";
  return { text, selectionStart: 3, selectionEnd: 6 };
}

function loadNotes(): NoteDraft[] {
  try {
    const parsed = JSON.parse(readStorageValue(notesStorageKey) ?? "[]") as NoteDraft[];
    return Array.isArray(parsed) ? parsed.filter((note) => note.id).map((note) => ({ ...note, pinned: Boolean(note.pinned) })) : [];
  } catch {
    return [];
  }
}

function loadActiveNoteId() {
  return readStorageValue(activeNoteStorageKey) ?? "";
}

function readStorageValue(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function restoreStorageValue(key: string, value: string | null) {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Best-effort rollback; the UI keeps the last saved note and shows the save error.
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "note";
}

function wordCount(value: string) {
  return value.replace(/\s/g, "").length;
}

function renderMarkdown(content: string) {
  const sanitized = DOMPurify.sanitize(marked.parse(content, { async: false }) as string);
  const template = document.createElement("template");
  template.innerHTML = sanitized;
  template.content.querySelectorAll("a[href]").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });
  return template.innerHTML;
}
