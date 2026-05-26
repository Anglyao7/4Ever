import { useMemo, useState } from "react";
import { Download, FileText, Plus, Save, Search, Star, Trash2 } from "lucide-react";
import type { NoteDraft } from "./types/notes";

const notesStorageKey = "4ever.notes";
const activeNoteStorageKey = "4ever.notes.active";

export default function NotesPanel() {
  const [notes, setNotes] = useState<NoteDraft[]>(loadNotes);
  const [activeId, setActiveId] = useState(() => localStorage.getItem(activeNoteStorageKey) ?? notes[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const activeNote = notes.find((note) => note.id === activeId) ?? notes[0] ?? null;
  const visibleNotes = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return [...notes]
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt))
      .filter((note) => !keyword || `${note.title} ${note.content}`.toLowerCase().includes(keyword));
  }, [notes, query]);

  function commit(nextNotes: NoteDraft[], nextActiveId = activeId) {
    setNotes(nextNotes);
    setActiveId(nextActiveId);
    localStorage.setItem(notesStorageKey, JSON.stringify(nextNotes));
    localStorage.setItem(activeNoteStorageKey, nextActiveId);
  }

  function createNote() {
    const now = new Date().toISOString();
    const note: NoteDraft = {
      id: `note-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      title: "未命名札记",
      content: "写下一点新的线索。",
      updatedAt: now,
      pinned: false,
    };
    commit([note, ...notes], note.id);
  }

  function updateNote(patch: Partial<NoteDraft>) {
    if (!activeNote) return;
    commit(notes.map((note) => note.id === activeNote.id ? { ...note, ...patch, updatedAt: new Date().toISOString() } : note), activeNote.id);
  }

  function deleteNote(noteId: string) {
    const nextNotes = notes.filter((note) => note.id !== noteId);
    commit(nextNotes, nextNotes[0]?.id ?? "");
  }

  function exportMarkdown() {
    if (!activeNote) return;
    const blob = new Blob([`# ${activeNote.title}\n\n${activeNote.content}`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activeNote.title || "note"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="react-notes-panel">
      <div className="module-view-header">
        <div>
          <p className="eyebrow">Notes</p>
          <h1>札记</h1>
        </div>
        <button className="primary-action compact" type="button" onClick={createNote}><Plus size={16} /><span>新建</span></button>
      </div>
      <div className="react-notes-layout">
        <aside className="react-notes-sidebar">
          <label className="react-search-field"><Search size={15} /><input value={query} placeholder="搜索笔记" onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="react-note-list">
            {visibleNotes.map((note) => (
              <button key={note.id} className={`react-note-item ${activeNote?.id === note.id ? "active" : ""}`} type="button" onClick={() => commit(notes, note.id)}>
                <FileText size={16} />
                <span><strong>{note.title || "未命名札记"}</strong><small>{formatDate(note.updatedAt)}</small></span>
                {note.pinned && <Star size={14} />}
              </button>
            ))}
            {!visibleNotes.length && <p className="react-empty-line">没有匹配的笔记</p>}
          </div>
        </aside>
        <article className="react-note-editor">
          {activeNote ? (
            <>
              <div className="react-note-toolbar">
                <button className="secondary-button" type="button" onClick={() => updateNote({ pinned: !activeNote.pinned })}><Star size={15} /><span>{activeNote.pinned ? "取消置顶" : "置顶"}</span></button>
                <button className="secondary-button" type="button" onClick={exportMarkdown}><Download size={15} /><span>导出</span></button>
                <button className="secondary-button danger" type="button" onClick={() => deleteNote(activeNote.id)}><Trash2 size={15} /><span>删除</span></button>
              </div>
              <input className="react-note-title" value={activeNote.title} onChange={(event) => updateNote({ title: event.target.value })} />
              <textarea className="react-note-body" value={activeNote.content} onChange={(event) => updateNote({ content: event.target.value })} />
              <div className="react-note-status"><Save size={14} /> 已自动保存</div>
            </>
          ) : (
            <div className="react-note-empty"><FileText size={28} /><strong>还没有札记</strong><button className="primary-action compact" type="button" onClick={createNote}>新建第一条</button></div>
          )}
        </article>
      </div>
    </section>
  );
}

function loadNotes(): NoteDraft[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(notesStorageKey) ?? "[]") as NoteDraft[];
    return Array.isArray(parsed) ? parsed.filter((note) => note.id).map((note) => ({ ...note, pinned: Boolean(note.pinned) })) : [];
  } catch {
    return [];
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
