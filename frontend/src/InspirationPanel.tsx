import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Combine, GitFork, Leaf, NotebookPen, Pencil, RefreshCw, Save, Search, Shuffle, Sparkles, Sprout, Star, Trash2, Wand2, Workflow, X } from "lucide-react";
import type { NoteDraft } from "./types/notes";

type IdeaStage = "seed" | "growing" | "done";
type InspirationFilter = "all" | "pinned" | IdeaStage;

type IdeaCard = {
  id: string;
  title: string;
  body: string;
  mood: string;
  stage: IdeaStage;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
};

type SparkParticle = {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
  tone: string;
};

const storageKey = "4ever.inspiration.ideas";
const notesStorageKey = "4ever.notes";
const activeNoteStorageKey = "4ever.notes.active";
const workflowHandoffStorageKey = "4ever.workflow.handoff";
const moods = ["✨", "🌿", "🔥", "🌊", "🧭", "🪐"];
const stageOrder: IdeaStage[] = ["seed", "growing", "done"];
const filters: InspirationFilter[] = ["all", "pinned", "seed", "growing", "done"];
const prompts = [
  "什么小工具能让今天平静 5%？",
  "把一段记忆变成一个界面。",
  "这个系统应该在你开口前察觉什么？",
  "设计一个像仪式而不是表单的功能。",
];

export default function InspirationPanel() {
  const panelRef = useRef<HTMLElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const [ideas, setIdeas] = useState<IdeaCard[]>(loadIdeas);
  const [promptIndex, setPromptIndex] = useState(0);
  const [draft, setDraft] = useState({ title: "", body: "", mood: "✨", stage: "seed" as IdeaStage });
  const [editingId, setEditingId] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"info" | "error">("info");
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<InspirationFilter>("all");
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [selectedIdea, setSelectedIdea] = useState<IdeaCard | null>(null);
  const [sparks, setSparks] = useState<SparkParticle[]>([]);
  const [bloomId, setBloomId] = useState("");
  const [draftPulse, setDraftPulse] = useState(false);
  const [dragId, setDragId] = useState("");
  const [dragOverStage, setDragOverStage] = useState<IdeaStage | "">("");

  const activePrompt = prompts[promptIndex % prompts.length];
  const sortedIdeas = useMemo(() => [...ideas].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [ideas]);
  const filteredIdeas = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return sortedIdeas.filter((idea) => {
      const matchesFilter = activeFilter === "all" || (activeFilter === "pinned" && idea.pinned) || idea.stage === activeFilter;
      const haystack = `${idea.title} ${idea.body} ${idea.mood}`.toLowerCase();
      return matchesFilter && (!keyword || haystack.includes(keyword));
    });
  }, [activeFilter, query, sortedIdeas]);
  const ideasByStage = useMemo(() => ({
    seed: filteredIdeas.filter((idea) => idea.stage === "seed"),
    growing: filteredIdeas.filter((idea) => idea.stage === "growing"),
    done: filteredIdeas.filter((idea) => idea.stage === "done"),
  }), [filteredIdeas]);
  const stageTotals = useMemo(() => ({
    seed: ideas.filter((idea) => idea.stage === "seed").length,
    growing: ideas.filter((idea) => idea.stage === "growing").length,
    done: ideas.filter((idea) => idea.stage === "done").length,
  }), [ideas]);
  const newestIdea = sortedIdeas[0];
  const canSave = Boolean(draft.title.trim() && draft.body.trim());
  const draftEnergy = Math.min(100, Math.round((draft.title.trim().length * 2 + draft.body.trim().length) / 2));
  const gardenMomentum = ideas.length ? Math.round(((stageTotals.growing * 0.6 + stageTotals.done) / ideas.length) * 100) : 0;

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "Escape") {
        if (selectedIdea) {
          setSelectedIdea(null);
          event.preventDefault();
          return;
        }
        if (query || mergeIds.length || activeFilter !== "all") {
          setQuery("");
          setMergeIds([]);
          setActiveFilter("all");
          burstAt(58, 32, 5);
          event.preventDefault();
        }
        return;
      }
      if (isTyping) {
        return;
      }
      if (event.key === "/") {
        searchInput.current?.focus();
        burstAt(58, 30, 4);
        event.preventDefault();
      }
      if (event.key.toLowerCase() === "n") {
        createIdea();
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [activeFilter, mergeIds.length, query, selectedIdea]);

  function persist(nextIdeas: IdeaCard[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(nextIdeas));
      setIdeas(nextIdeas);
      setNotice("");
      return true;
    } catch {
      setNoticeTone("error");
      setNotice("浏览器本地存储已满，请删除部分灵感后再试。");
      return false;
    }
  }

  function createIdea() {
    setEditingId("");
    setDraft({ title: activePrompt, body: "", mood: "✨", stage: "seed" });
    burstAt(40, 28, 8);
  }

  function pulseDraft(field: "title" | "body") {
    setDraftPulse(true);
    window.setTimeout(() => setDraftPulse(false), 360);
    burstAt(field === "title" ? 39 : 44, field === "title" ? 46 : 55, field === "title" ? 2 : 3);
  }

  function saveDraft(event: React.FormEvent) {
    event.preventDefault();
    commitDraft();
  }

  function commitDraft() {
    if (!canSave) {
      return;
    }
    const now = new Date().toISOString();
    const savedId = editingId || createId();
    const nextIdeas = editingId
      ? ideas.map((idea) => idea.id === editingId ? { ...idea, ...draft, title: draft.title.trim(), body: draft.body.trim(), updatedAt: now } : idea)
      : [{ id: savedId, title: draft.title.trim(), body: draft.body.trim(), mood: draft.mood, stage: draft.stage, pinned: false, createdAt: now, updatedAt: now }, ...ideas];
    if (persist(nextIdeas)) {
      setDraft({ title: "", body: "", mood: "✨", stage: "seed" });
      setEditingId("");
      setBloom(savedId);
      burstAt(56, 54, 12);
    }
  }

  function editIdea(idea: IdeaCard) {
    setEditingId(idea.id);
    setSelectedIdea(null);
    setDraft({ title: idea.title, body: idea.body, mood: idea.mood, stage: idea.stage });
    burstAt(48, 42, 5);
  }

  function forkIdea(idea: IdeaCard) {
    setEditingId("");
    setSelectedIdea(null);
    setDraft({
      title: `分叉：${idea.title}`,
      body: `从「${idea.title}」延伸：\n\n${idea.body}\n\n下一步：`,
      mood: idea.mood,
      stage: "seed",
    });
    setBloom(idea.id);
    burstAt(45, 58, 12);
  }

  function createNoteFromIdea(idea: IdeaCard) {
    const now = new Date().toISOString();
    const note: NoteDraft = {
      id: `note-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      title: idea.title,
      content: `${idea.body}\n\n---\n来源：灵感温室 / ${stageLabel(idea.stage)} ${idea.mood}`,
      updatedAt: now,
      pinned: Boolean(idea.pinned),
    };
    const stored = JSON.parse(localStorage.getItem(notesStorageKey) ?? "[]") as NoteDraft[];
    const notes = Array.isArray(stored) ? stored.filter((item) => item.id) : [];
    localStorage.setItem(notesStorageKey, JSON.stringify([note, ...notes]));
    localStorage.setItem(activeNoteStorageKey, note.id);
    return note;
  }

  function sendIdeaToNotes(idea: IdeaCard) {
    try {
      createNoteFromIdea(idea);
      setNoticeTone("info");
      setNotice("已送入札记，可在札记模块继续整理。");
      setBloom(idea.id);
      burstAt(64, 54, 12);
    } catch {
      setNoticeTone("error");
      setNotice("无法写入札记，请检查浏览器本地存储。");
    }
  }

  function sendIdeaToWorkflow(idea: IdeaCard) {
    try {
      const note = createNoteFromIdea(idea);
      localStorage.setItem(workflowHandoffStorageKey, JSON.stringify({
        source: "inspiration",
        sourceId: idea.id,
        noteId: note.id,
        title: idea.title,
        content: note.content,
        mood: idea.mood,
        stage: idea.stage,
        createdAt: new Date().toISOString(),
      }));
      setNoticeTone("info");
      setNotice("已送入秩序，工作流会接住这条灵感。");
      setBloom(idea.id);
      burstAt(70, 52, 14);
      window.setTimeout(() => window.location.assign("/automation"), 180);
    } catch {
      setNoticeTone("error");
      setNotice("无法写入工作流来源，请检查浏览器本地存储。");
    }
  }

  function togglePin(idea: IdeaCard) {
    const nextIdeas = ideas.map((item) => item.id === idea.id ? { ...item, pinned: !item.pinned, updatedAt: new Date().toISOString() } : item);
    if (persist(nextIdeas)) {
      const nextIdea = nextIdeas.find((item) => item.id === idea.id);
      if (nextIdea) {
        setSelectedIdea((current) => current?.id === idea.id ? nextIdea : current);
      }
      setBloom(idea.id);
      burstAt(78, 42, 8);
    }
  }

  function advanceIdea(idea: IdeaCard) {
    const nextStage: Record<IdeaStage, IdeaStage> = { seed: "growing", growing: "done", done: "seed" };
    const nextIdeas = ideas.map((item) => item.id === idea.id ? { ...item, stage: nextStage[item.stage], updatedAt: new Date().toISOString() } : item);
    if (persist(nextIdeas)) {
      const nextIdea = nextIdeas.find((item) => item.id === idea.id);
      if (nextIdea) {
        setSelectedIdea((current) => current?.id === idea.id ? nextIdea : current);
      }
      setBloom(idea.id);
      burstAt(82, 46, 9);
    }
  }

  function deleteIdea(ideaId: string) {
    if (!persist(ideas.filter((idea) => idea.id !== ideaId))) {
      return;
    }
    if (editingId === ideaId) {
      setEditingId("");
      setDraft({ title: "", body: "", mood: "✨", stage: "seed" });
    }
    setSelectedIdea((current) => current?.id === ideaId ? null : current);
  }

  function mergeIdeas() {
    const selected = mergeIds.map((id) => ideas.find((idea) => idea.id === id)).filter(Boolean) as IdeaCard[];
    if (selected.length < 2) {
      return;
    }
    const now = new Date().toISOString();
    const nextIdea = {
      id: createId(),
      title: `共鸣灵感 · ${selected.map((idea) => idea.mood).join("")}`,
      body: `这些灵感碰撞出了一个新方向：\n\n${selected.map((idea) => `- ${idea.title}: ${idea.body}`).join("\n")}`,
      mood: "🧭",
      stage: "seed" as IdeaStage,
      pinned: true,
      createdAt: now,
      updatedAt: now,
    };
    if (persist([nextIdea, ...ideas])) {
      setMergeIds([]);
      setSelectedIdea(nextIdea);
      setBloom(nextIdea.id);
      burstAt(72, 38, 18);
    }
  }

  function dropIdea(stage: IdeaStage) {
    const targetId = dragId;
    setDragId("");
    setDragOverStage("");
    if (!targetId) {
      return;
    }
    const target = ideas.find((idea) => idea.id === targetId);
    if (!target || target.stage === stage) {
      return;
    }
    const nextIdeas = ideas.map((idea) => idea.id === targetId ? { ...idea, stage, updatedAt: new Date().toISOString() } : idea);
    if (persist(nextIdeas)) {
      setBloom(targetId);
      burstAt(stage === "seed" ? 70 : stage === "growing" ? 82 : 93, 48, 10);
    }
  }

  function wanderIdea() {
    const pool = filteredIdeas.length ? filteredIdeas : sortedIdeas;
    const idea = pool[Math.floor(Math.random() * pool.length)];
    if (idea) {
      setSelectedIdea(idea);
      setBloom(idea.id);
      burstAt(62, 36, 12);
    }
  }

  function plantStarterIdeas() {
    const now = new Date().toISOString();
    const starterIdeas: IdeaCard[] = [
      { id: createId(), title: activePrompt, body: "先从触摸、拖拽、组合这些灵感开始。", mood: "✨", stage: "seed", pinned: true, createdAt: now, updatedAt: now },
      { id: createId(), title: "一个小小的交互仪式", body: "选中两张卡片加入共鸣，再把它们组合成新的方向。", mood: "🌿", stage: "growing", pinned: false, createdAt: now, updatedAt: now },
    ];
    if (persist(starterIdeas)) {
      burstAt(50, 60, 20);
    }
  }

  function burstAt(x: number, y: number, amount = 6) {
    const tones = ["#79c99e", "#7bbbd3", "#f0c766", "#f4a6b5"];
    const particles = Array.from({ length: amount }, (_, index) => ({
      id: `spark-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 7)}`,
      x,
      y,
      dx: (Math.random() - 0.5) * 42,
      dy: -18 - Math.random() * 44,
      size: 5 + Math.random() * 8,
      tone: tones[index % tones.length],
    }));
    setSparks((current) => [...current, ...particles].slice(-42));
    window.setTimeout(() => {
      const ids = new Set(particles.map((particle) => particle.id));
      setSparks((current) => current.filter((particle) => !ids.has(particle.id)));
    }, 920);
  }

  function setBloom(ideaId: string) {
    setBloomId(ideaId);
    window.setTimeout(() => setBloomId((current) => (current === ideaId ? "" : current)), 760);
  }

  return (
    <section
      ref={panelRef}
      className="inspiration-panel"
      aria-label="灵感温室"
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--pointer-x", `${((event.clientX - rect.left) / rect.width) * 100}%`);
        event.currentTarget.style.setProperty("--pointer-y", `${((event.clientY - rect.top) / rect.height) * 100}%`);
      }}
    >
      <div className="inspiration-ambient" aria-hidden="true">
        {sparks.map((spark) => (
          <span key={spark.id} style={{
            left: `${spark.x}%`,
            top: `${spark.y}%`,
            width: `${spark.size}px`,
            height: `${spark.size}px`,
            "--spark-dx": `${spark.dx}px`,
            "--spark-dy": `${spark.dy}px`,
            "--spark-tone": spark.tone,
          } as React.CSSProperties} />
        ))}
      </div>
      <div className="module-view-header inspiration-header">
        <div>
          <p className="eyebrow">Inspiration Garden</p>
          <h1>灵感温室</h1>
        </div>
        <div className="inspiration-header-actions">
          <span className="inspiration-stat"><Sprout size={15} />{ideas.length} 条灵感</span>
          <span className="inspiration-stat"><Star size={15} />{ideas.filter((idea) => idea.pinned).length} 个收藏</span>
          <button className="primary-action compact" type="button" onClick={createIdea}><Sparkles size={16} /><span>新灵感</span></button>
        </div>
      </div>

      <div className="inspiration-workspace">
        <aside className="inspiration-prompt-panel" onPointerDown={() => burstAt(28, 34, 3)}>
          <div className="inspiration-prompt-copy">
            <p className="eyebrow">创意提示</p>
            <h2>{activePrompt}</h2>
            <span>给下一条记录一点轻轻的推力。</span>
          </div>
          <div className="inspiration-garden-pulse" aria-label="灵感态势">
            <div>
              <span>推进度</span>
              <strong>{gardenMomentum}%</strong>
            </div>
            <meter min="0" max="100" value={gardenMomentum} />
            <small>{newestIdea ? `最近更新：${newestIdea.title}` : "等待第一条灵感进入系统"}</small>
          </div>
          <div className="inspiration-seed-tray" aria-label="灵感种子">
            {prompts.map((prompt, index) => (
              <button key={prompt} type="button" className={index === promptIndex ? "active" : ""} onClick={() => {
                setPromptIndex(index);
                if (!draft.title.trim()) {
                  setDraft((current) => ({ ...current, title: prompt }));
                }
                burstAt(22 + index * 9, 34 + index * 4, 5);
              }}>
                <span>{index + 1}</span>{prompt}
              </button>
            ))}
          </div>
          <button className="secondary-button" type="button" onClick={() => {
            setPromptIndex((current) => (current + 1) % prompts.length);
            burstAt(24, 34, 7);
          }}><RefreshCw size={16} /><span>换一个</span></button>
        </aside>

        <form className={`inspiration-compose ${draftPulse ? "pulsing" : ""}`} onSubmit={saveDraft}>
          <div className="inspiration-compose-head">
            <span className="inspiration-compose-mark"><Leaf size={17} /></span>
            <div><p className="eyebrow">{editingId ? "编辑中" : "捕捉"}</p><strong>清晨便签</strong></div>
          </div>
          <label><span>标题</span><input value={draft.title} placeholder="给这个火花命名" onChange={(event) => {
            setDraft((current) => ({ ...current, title: event.target.value }));
            pulseDraft("title");
          }} /></label>
          <label><span>记录</span><textarea value={draft.body} placeholder="在它消失前，先记下这个想法的形状..." rows={6} onChange={(event) => {
            setDraft((current) => ({ ...current, body: event.target.value }));
            pulseDraft("body");
          }} /></label>
          <div className="inspiration-energy" aria-label="灵感浓度">
            <div><span>灵感浓度</span><strong>{draftEnergy}%</strong></div>
            <meter min="0" max="100" value={draftEnergy} />
          </div>
          <div className="inspiration-form-row">
            <label><span>情绪</span><div className="inspiration-mood-picker">{moods.map((mood) => <button key={mood} type="button" className={draft.mood === mood ? "active" : ""} onClick={() => setDraft((current) => ({ ...current, mood }))}>{mood}</button>)}</div></label>
            <label><span>阶段</span><div className="inspiration-stage-picker">{stageOrder.map((stage) => <button key={stage} type="button" className={draft.stage === stage ? "active" : ""} onClick={() => setDraft((current) => ({ ...current, stage }))}>{stageIcon(stage)}<span>{stageLabel(stage)}</span></button>)}</div></label>
          </div>
          {notice && <p className={`inspiration-notice ${noticeTone}`}>{notice}</p>}
          <div className="inspiration-actions">
            <button className="secondary-button" type="button" onClick={() => {
              setEditingId("");
              setDraft({ title: "", body: "", mood: "✨", stage: "seed" });
            }}><X size={16} /><span>清空</span></button>
            <button className="primary-action compact" type="button" disabled={!canSave} onClick={commitDraft}><Save size={16} /><span>{editingId ? "更新" : "保存"}</span></button>
          </div>
        </form>

        <div className="inspiration-board">
          <div className="inspiration-focus-strip">
            <label className="inspiration-search"><Search size={15} /><input ref={searchInput} value={query} type="search" placeholder="搜索这座温室" onChange={(event) => setQuery(event.target.value)} /></label>
            <div className="inspiration-filter-tabs" aria-label="筛选灵感">{filters.map((filter) => <button key={filter} type="button" className={activeFilter === filter ? "active" : ""} onClick={() => {
              setActiveFilter(filter);
              burstAt(filter === "pinned" ? 58 : 48, 30, 5);
            }}>{filterLabel(filter)}</button>)}</div>
            <button className="secondary-button" type="button" disabled={!ideas.length} onClick={wanderIdea}><Shuffle size={15} /><span>随机漫游</span></button>
          </div>
          <div className="inspiration-stage-overview" aria-label="阶段概览">
            {stageOrder.map((stage) => (
              <button key={stage} type="button" className={activeFilter === stage ? "active" : ""} onClick={() => {
                setActiveFilter(stage);
                burstAt(stage === "seed" ? 42 : stage === "growing" ? 54 : 66, 36, 6);
              }}>
                <span>{stageIcon(stage)}</span>
                <strong>{stageTotals[stage]}</strong>
                <small>{stageLabel(stage)}</small>
              </button>
            ))}
          </div>
          {notice && <p className={`inspiration-notice board-notice ${noticeTone}`}>{notice}</p>}
          {mergeIds.length > 0 && (
            <div className="inspiration-merge-bar">
              <div><Sparkles size={16} /><strong>正在共鸣</strong><span>{mergeIds.length} 项</span></div>
              <button className="secondary-button" type="button" onClick={() => setMergeIds([])}><X size={15} /><span>清除</span></button>
              <button className="primary-action compact" type="button" disabled={mergeIds.length < 2} onClick={mergeIdeas}><Wand2 size={15} /><span>组合灵感</span></button>
            </div>
          )}
          {stageOrder.map((stage) => (
            <section key={stage} className={`inspiration-lane lane-${stage} ${dragOverStage === stage ? "drag-over" : ""}`} onDragOver={(event) => {
              event.preventDefault();
              setDragOverStage(stage);
            }} onDragLeave={() => setDragOverStage("")} onDrop={() => dropIdea(stage)}>
              <header className="inspiration-lane-head"><span>{stageIcon(stage)}</span><div><strong>{stageLabel(stage)}</strong><small>{ideasByStage[stage].length} 项</small></div></header>
              <div className="inspiration-lane-list">
                {ideasByStage[stage].map((idea) => (
                  <article key={idea.id} className={`idea-card stage-${idea.stage} ${idea.pinned ? "pinned" : ""} ${bloomId === idea.id ? "blooming" : ""}`} draggable onDragStart={() => setDragId(idea.id)} onDragEnd={() => {
                    setDragId("");
                    setDragOverStage("");
                  }}>
                    <button className="idea-card-main" type="button" onClick={() => {
                      setSelectedIdea(idea);
                      burstAt(50, 34, 8);
                    }}>
                      <span>{idea.mood}</span>
                      <h3>{highlight(idea.title, query)}</h3>
                      <p>{highlight(idea.body, query)}</p>
                      <small>{formatDate(idea.updatedAt)}</small>
                    </button>
                    <div className="idea-card-actions">
                      <button type="button" className={mergeIds.includes(idea.id) ? "active" : ""} title="加入共鸣" onClick={() => setMergeIds((current) => current.includes(idea.id) ? current.filter((id) => id !== idea.id) : [...current, idea.id])}><Combine size={15} /></button>
                      <button type="button" className={idea.pinned ? "active" : ""} title="收藏灵感" onClick={() => togglePin(idea)}><Star size={15} /></button>
                      <button type="button" title="编辑灵感" onClick={() => editIdea(idea)}><Pencil size={15} /></button>
                      <button type="button" title="分叉为新灵感" onClick={() => forkIdea(idea)}><GitFork size={15} /></button>
                      <button type="button" title="转成札记" onClick={() => sendIdeaToNotes(idea)}><NotebookPen size={15} /></button>
                      <button type="button" title="送入秩序" onClick={() => sendIdeaToWorkflow(idea)}><Workflow size={15} /></button>
                      <button type="button" title="推进阶段" onClick={() => advanceIdea(idea)}><ArrowRight size={15} /></button>
                      <button type="button" title="删除灵感" onClick={() => deleteIdea(idea.id)}><Trash2 size={15} /></button>
                    </div>
                  </article>
                ))}
                {ideasByStage[stage].length === 0 && <div className="inspiration-lane-empty">{dragId ? "松手，灵感会落到这里" : "等待一颗新火花"}</div>}
              </div>
            </section>
          ))}
          {!ideas.length && <div className="inspiration-empty"><Sparkles size={30} /><strong>还没有灵感</strong><button className="primary-action compact" type="button" onClick={plantStarterIdeas}><Sparkles size={15} /><span>种下第一批灵感</span></button></div>}
          {ideas.length > 0 && filteredIdeas.length === 0 && <div className="inspiration-empty inspiration-empty-filtered"><Search size={28} /><strong>没有匹配的灵感</strong></div>}
        </div>
      </div>

      {selectedIdea && (
        <div className="idea-reader-backdrop" onClick={(event) => {
          if (event.currentTarget === event.target) {
            setSelectedIdea(null);
          }
        }}>
          <article className="idea-reader">
            <div className="idea-reader-orbit" aria-hidden="true">{[1, 2, 3, 4, 5].map((index) => <span key={index} />)}</div>
            <button className="idea-reader-close" type="button" title="关闭" onClick={() => setSelectedIdea(null)}><X size={18} /></button>
            <div className="idea-reader-mood">{selectedIdea.mood}</div>
            <p className="eyebrow">{stageLabel(selectedIdea.stage)} · {formatDate(selectedIdea.updatedAt)}</p>
            <h2>{selectedIdea.title}</h2>
            <p>{selectedIdea.body}</p>
            <div className="idea-reader-actions">
              <button className="secondary-button" type="button" onClick={() => editIdea(selectedIdea)}><Pencil size={15} /><span>编辑灵感</span></button>
              <button className="secondary-button" type="button" onClick={() => forkIdea(selectedIdea)}><GitFork size={15} /><span>分叉新稿</span></button>
              <button className="secondary-button" type="button" onClick={() => sendIdeaToNotes(selectedIdea)}><NotebookPen size={15} /><span>转成札记</span></button>
              <button className="secondary-button" type="button" onClick={() => sendIdeaToWorkflow(selectedIdea)}><Workflow size={15} /><span>送入秩序</span></button>
              <button className="primary-action compact" type="button" onClick={() => advanceIdea(selectedIdea)}><ArrowRight size={15} /><span>推进阶段</span></button>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}

function loadIdeas() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as IdeaCard[];
    return Array.isArray(parsed)
      ? parsed.filter((idea) => idea.id && idea.title && idea.body).map((idea) => ({ ...idea, pinned: Boolean(idea.pinned) }))
      : [];
  } catch {
    return [];
  }
}

function createId() {
  return `idea-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function stageLabel(stage: IdeaStage) {
  return { seed: "种子", growing: "生长中", done: "已完成" }[stage];
}

function filterLabel(filter: InspirationFilter) {
  if (filter === "all") return "全部";
  if (filter === "pinned") return "收藏";
  return stageLabel(filter);
}

function stageIcon(stage: IdeaStage) {
  const icons = { seed: <Sprout size={14} />, growing: <Leaf size={14} />, done: <CheckCircle2 size={14} /> };
  return icons[stage];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function highlight(value: string, query: string) {
  const keyword = query.trim();
  if (!keyword) {
    return value;
  }
  const index = value.toLowerCase().indexOf(keyword.toLowerCase());
  if (index < 0) {
    return value;
  }
  return (
    <>
      {value.slice(0, index)}
      <mark>{value.slice(index, index + keyword.length)}</mark>
      {value.slice(index + keyword.length)}
    </>
  );
}
