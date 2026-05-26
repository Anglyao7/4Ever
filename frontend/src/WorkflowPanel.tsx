import { useEffect, useMemo, useState } from "react";
import { FileText, Image, MessageSquareText, Play, Plus, Sparkles, Workflow, X } from "lucide-react";
import type { NoteDraft } from "./types/notes";
import type { WorkflowRun, WorkflowTemplate } from "./types/workflow";

const runsKey = "4ever.workflow.runs";
const notesKey = "4ever.notes";
const activeNoteKey = "4ever.notes.active";
const workflowHandoffKey = "4ever.workflow.handoff";

type WorkflowHandoff = {
  source: "inspiration";
  sourceId: string;
  noteId: string;
  title: string;
  content: string;
  mood: string;
  stage: string;
  createdAt: string;
};

const templates: WorkflowTemplate[] = [
  {
    id: "note-copy",
    name: "笔记整理成文案",
    nameEn: "Note to copy",
    description: "把系统札记整理为一段可发布文案。",
    descriptionEn: "Turn a note into publishable copy.",
    category: "内容",
    categoryEn: "Content",
    inputs: [{ key: "note", label: "笔记内容", labelEn: "Note", placeholder: "选择或粘贴笔记", placeholderEn: "Paste note", type: "textarea", required: true }],
    nodes: [
      { id: "source", type: "notes", title: "读取札记", titleEn: "Read note", description: "读取系统笔记", descriptionEn: "Read note" },
      { id: "transform", type: "transform", title: "整理结构", titleEn: "Structure", description: "提炼标题、要点和语气", descriptionEn: "Extract structure" },
      { id: "copy", type: "ai", title: "生成文案", titleEn: "Generate copy", description: "生成最终文案", descriptionEn: "Generate copy" },
    ],
  },
  {
    id: "note-message",
    name: "笔记发送给联系人",
    nameEn: "Note to contacts",
    description: "把系统笔记整理为适合发送的消息。",
    descriptionEn: "Prepare note as a message.",
    category: "沟通",
    categoryEn: "Communication",
    inputs: [{ key: "note", label: "笔记内容", labelEn: "Note", placeholder: "输入要发送的笔记", placeholderEn: "Paste note", type: "textarea", required: true }],
    nodes: [
      { id: "source", type: "notes", title: "读取札记", titleEn: "Read note", description: "读取系统笔记", descriptionEn: "Read note" },
      { id: "chat", type: "chat", title: "生成消息", titleEn: "Generate message", description: "生成适合发送的消息", descriptionEn: "Generate message" },
    ],
  },
];

export default function WorkflowPanel() {
  const [activeId, setActiveId] = useState(templates[0].id);
  const [input, setInput] = useState("");
  const [runs, setRuns] = useState<WorkflowRun[]>(loadRuns);
  const [workflowHandoff, setWorkflowHandoff] = useState<WorkflowHandoff | null>(loadWorkflowHandoff);
  const notes = useMemo(loadNotes, []);
  const [selectedNoteId, setSelectedNoteId] = useState(() => {
    const storedActiveId = localStorage.getItem(activeNoteKey) ?? "";
    return notes.some((note) => note.id === storedActiveId) ? storedActiveId : notes[0]?.id ?? "";
  });
  const active = templates.find((template) => template.id === activeId) ?? templates[0];
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? notes[0];
  const sourcePreview = input.trim() || workflowHandoff?.content || selectedNote?.content || "";

  useEffect(() => {
    if (!workflowHandoff) return;
    setActiveId("note-copy");
    setInput(workflowHandoff.content);
    if (workflowHandoff.noteId) {
      setSelectedNoteId(workflowHandoff.noteId);
    }
  }, [workflowHandoff]);

  function runWorkflow() {
    const startedAt = new Date().toISOString();
    const source = sourcePreview;
    const outputs = active.nodes.map((node, index) => ({
      nodeId: node.id,
      type: node.type,
      title: node.title,
      status: "success" as const,
      output: renderNodeOutput(node.type, source, index),
      startedAt,
      endedAt: new Date(Date.now() + index * 120).toISOString(),
    }));
    const run: WorkflowRun = {
      id: `run-${Date.now()}`,
      workflowId: active.id,
      status: "success",
      input: { note: source, source: workflowHandoff?.source ?? "manual" },
      nodeResults: outputs,
      startedAt,
      endedAt: new Date().toISOString(),
    };
    const nextRuns = [run, ...runs].slice(0, 20);
    setRuns(nextRuns);
    localStorage.setItem(runsKey, JSON.stringify(nextRuns));
    clearWorkflowHandoff();
  }

  function clearWorkflowHandoff() {
    setWorkflowHandoff(null);
    localStorage.removeItem(workflowHandoffKey);
  }

  return (
    <section className="react-workflow-panel">
      <div className="module-view-header">
        <div><p className="eyebrow">Workflow</p><h1>秩序</h1></div>
        <button className="primary-action compact" type="button" onClick={runWorkflow}><Play size={16} />运行</button>
      </div>
      <div className="react-workflow-layout">
        <aside className="react-profile-list">
          {templates.map((template) => <button key={template.id} className={`react-profile-card ${template.id === active.id ? "active" : ""}`} type="button" onClick={() => setActiveId(template.id)}><Workflow size={17} /><span><strong>{template.name}</strong><small>{template.description}</small></span></button>)}
        </aside>
        <article className="react-workflow-canvas">
          {workflowHandoff && (
            <div className="react-workflow-handoff">
              <span><Sparkles size={16} /></span>
              <div>
                <strong>已接住灵感：{workflowHandoff.title}</strong>
                <small>{workflowHandoff.mood} {stageLabel(workflowHandoff.stage)} · 可直接运行，或继续改写输入。</small>
              </div>
              <button type="button" title="清除灵感来源" onClick={clearWorkflowHandoff}><X size={15} /></button>
            </div>
          )}
          <div className="react-workflow-nodes">
            {active.nodes.map((node) => <div key={node.id} className="react-workflow-node"><span>{nodeIcon(node.type)}</span><strong>{node.title}</strong><small>{node.description}</small></div>)}
          </div>
          <div className="react-workflow-source">
            <label>
              <span>札记来源</span>
              <select value={selectedNote?.id ?? ""} disabled={!notes.length} onChange={(event) => {
                setSelectedNoteId(event.target.value);
                localStorage.setItem(activeNoteKey, event.target.value);
              }}>
                {!notes.length && <option value="">暂无札记</option>}
                {notes.map((note) => <option key={note.id} value={note.id}>{note.title || "未命名札记"}</option>)}
              </select>
            </label>
            <button className="secondary-button" type="button" disabled={!selectedNote} onClick={() => setInput(selectedNote?.content ?? "")}>导入选中札记</button>
          </div>
          <label><span>输入</span><textarea value={input} placeholder={selectedNote ? `默认可读取札记：${selectedNote.title}` : "粘贴笔记内容"} onChange={(event) => setInput(event.target.value)} /></label>
          {sourcePreview && <p className="react-workflow-preview">当前会读取：{sourcePreview.slice(0, 88)}{sourcePreview.length > 88 ? "..." : ""}</p>}
        </article>
        <aside className="react-workflow-history">
          <h2>运行记录</h2>
          {runs.map((run) => <details key={run.id} open={run === runs[0]}><summary>{templates.find((item) => item.id === run.workflowId)?.name ?? run.workflowId}</summary>{run.nodeResults.map((result) => <p key={result.nodeId}><strong>{result.title}</strong>{result.output}</p>)}</details>)}
          {!runs.length && <p className="react-empty-line">暂无运行记录</p>}
        </aside>
      </div>
    </section>
  );
}

function loadRuns(): WorkflowRun[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(runsKey) ?? "[]") as WorkflowRun[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadNotes(): NoteDraft[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(notesKey) ?? "[]") as NoteDraft[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadWorkflowHandoff(): WorkflowHandoff | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(workflowHandoffKey) ?? "null") as WorkflowHandoff | null;
    return parsed?.source === "inspiration" && parsed.content ? parsed : null;
  } catch {
    return null;
  }
}

function stageLabel(stage: string) {
  if (stage === "seed") return "种子";
  if (stage === "growing") return "生长中";
  if (stage === "done") return "已完成";
  return "灵感";
}

function renderNodeOutput(type: string, source: string, index: number) {
  if (!source) return "等待输入内容。";
  if (type === "notes") return source.slice(0, 120);
  if (type === "transform") return `标题：${source.slice(0, 18)}...\n要点：${source.split(/[。.!?]/).filter(Boolean).slice(0, 3).join(" / ")}`;
  if (type === "chat") return `我整理了一段内容，想同步给你：${source.slice(0, 160)}`;
  return `基于内容生成：${source.slice(0, 180)}`;
}

function nodeIcon(type: string) {
  if (type === "notes") return <FileText size={17} />;
  if (type === "image") return <Image size={17} />;
  if (type === "chat") return <MessageSquareText size={17} />;
  return <Plus size={17} />;
}
