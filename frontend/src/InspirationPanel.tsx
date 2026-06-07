import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, CheckCircle2, Compass, KeyRound, Lightbulb, Loader2, NotebookPen, Send, Sparkles, Wand2, Workflow } from "lucide-react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { sendChat } from "./services/api";
import type { ChatConfig, ChatMessage, ModelProfile } from "./types/chat";
import type { NoteDraft } from "./types/notes";

type TutorialStep = {
  title: string;
  body: string;
  action: string;
  target: "form" | "lens" | "results";
  bubbleClass: string;
};

type InspirationResult = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

type InspirationNotice = {
  message: string;
  action?: "notes" | "workflow";
};

type SpotlightRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

const profilesKey = "4ever.model.profiles";
const activeProfileKey = "4ever.model.activeProfile";
const tutorialSeenKey = "4ever.inspiration.tutorialSeen";
const notesStorageKey = "4ever.notes";
const activeNoteStorageKey = "4ever.notes.active";
const workflowHandoffStorageKey = "4ever.workflow.handoff";
const noteSaveFallback = "转成笔记失败，请检查浏览器存储空间后再试。";

const tutorialSteps: TutorialStep[] = [
  { title: "从问题开始", body: "这里不是存档框。先把模糊的主题、困惑或目标写进去，让大模型有东西可以拆。", action: "我有方向了", target: "form", bubbleClass: "bubble-form" },
  { title: "选择发掘角度", body: "同一个主题换一个角度，会得到完全不同的创意分支。先选一个你想打开的方向。", action: "继续", target: "lens", bubbleClass: "bubble-lens" },
  { title: "把结果变成下一步", body: "生成结果会在这里出现。你可以继续追问，也可以转成笔记或送入秩序继续执行。", action: "开始发掘", target: "results", bubbleClass: "bubble-results" },
];

const lenses = ["产品机会", "用户情绪", "反常识", "技术组合", "叙事表达", "商业路径"];

export default function InspirationPanel(props: { authToken?: string }) {
  const formRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const tutorialDialogRef = useRef<HTMLElement | null>(null);
  const [profiles] = useState<ModelProfile[]>(loadProfiles);
  const [tutorialOpen, setTutorialOpen] = useState(() => readStorageValue(tutorialSeenKey) !== "true");
  const [tutorialIndex, setTutorialIndex] = useState(0);
  const [brief, setBrief] = useState("");
  const [audience, setAudience] = useState("");
  const [lens, setLens] = useState(lenses[0]);
  const [results, setResults] = useState<InspirationResult[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<InspirationNotice | null>(null);
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);
  const activeProfile = useMemo(() => activeUsableProfile(profiles), [profiles]);
  const currentTutorial = tutorialSteps[tutorialIndex];
  const tutorialBubbleStyle = useMemo(() => bubbleStyleForSpotlight(spotlightRect), [spotlightRect]);
  const generateBlockedReason = inspirationBlockedReason({ brief, activeProfile, loading });

  useEffect(() => {
    if (!tutorialOpen) {
      setSpotlightRect(null);
      return;
    }
    const target = {
      form: formRef.current,
      lens: lensRef.current,
      results: resultsRef.current,
    }[currentTutorial.target];
    if (!target) return;
    const updateSpotlight = () => setSpotlightRect(rectWithPadding(target.getBoundingClientRect(), 8));
    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      updateSpotlight();
    });
    const settleTimer = window.setTimeout(updateSpotlight, prefersReducedMotion() ? 0 : 320);
    window.addEventListener("resize", updateSpotlight);
    window.addEventListener("scroll", updateSpotlight, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", updateSpotlight);
      window.removeEventListener("scroll", updateSpotlight, true);
    };
  }, [currentTutorial.target, tutorialOpen]);

  useEffect(() => {
    if (!tutorialOpen) return;
    const focusFrame = window.requestAnimationFrame(() => tutorialDialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finishTutorial();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [tutorialOpen, tutorialIndex]);

  async function generateInspiration(extraInstruction = "") {
    if (!activeProfile || !brief.trim() || loading) return;
    setLoading(true);
    setError("");
    setNotice(null);
    const latestResult = extraInstruction ? results[0] : null;
    const prompt = [
      "你是一个帮助用户发掘新灵感的创意合伙人。不要只整理用户已有想法，要主动提出新方向。",
      `主题或困惑：${brief.trim()}`,
      audience.trim() ? `目标用户/场景：${audience.trim()}` : "目标用户/场景：用户尚未明确，请帮他补全可能人群。",
      `发掘角度：${lens}`,
      latestResult ? `上一轮结果：${latestResult.body.slice(0, 2400)}` : "",
      extraInstruction ? `继续追问：${extraInstruction}` : "",
      "输出 4 个新灵感方向。每个方向包含：标题、洞察、可执行原型、一个可继续追问的问题。用 Markdown，保持具体。",
    ].filter(Boolean).join("\n");
    try {
      const backendOwnedProfile = Boolean(props.authToken && activeProfile.apiKeySet);
      const response = await sendChat(configFromProfile(activeProfile, backendOwnedProfile), [{ role: "user", content: prompt } as ChatMessage], props.authToken ?? "");
      setResults((current) => [{ id: createId(), title: `${lens} · ${brief.trim().slice(0, 24)}`, body: response.content, createdAt: new Date().toISOString() }, ...current]);
      setFollowUp("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "灵感发掘失败");
    } finally {
      setLoading(false);
    }
  }

  function finishTutorial() {
    try {
      localStorage.setItem(tutorialSeenKey, "true");
    } catch {
      // 关闭教程应优先响应用户操作，存储失败只影响下次是否再次显示。
    }
    setTutorialOpen(false);
  }

  function saveAsNote(result: InspirationResult) {
    const previousNotes = readStorageValue(notesStorageKey);
    const previousActiveNote = readStorageValue(activeNoteStorageKey);
    try {
      const note: NoteDraft = {
        id: `note-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
        title: result.title,
        content: `# ${result.title}\n\n${result.body}\n\n---\n来源：灵感 / 大模型发掘`,
        updatedAt: new Date().toISOString(),
        pinned: false,
      };
      const stored = readStoredNotes();
      localStorage.setItem(notesStorageKey, JSON.stringify([note, ...stored]));
      localStorage.setItem(activeNoteStorageKey, note.id);
      setNotice({ message: `已转成笔记：${note.title}`, action: "notes" });
      setError("");
    } catch (cause) {
      restoreStorageValue(notesStorageKey, previousNotes);
      restoreStorageValue(activeNoteStorageKey, previousActiveNote);
      setNotice(null);
      setError(storageActionError(cause, noteSaveFallback));
    }
  }

  function navigateTo(route: string) {
    window.history.pushState({}, "", route);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function sendToWorkflow(result: InspirationResult) {
    try {
      localStorage.setItem(workflowHandoffStorageKey, JSON.stringify({
        source: "inspiration",
        sourceId: result.id,
        noteId: "",
        title: result.title,
        content: result.body,
        mood: lens,
        stage: "seed",
        createdAt: new Date().toISOString(),
      }));
      setNotice({ message: `已送入秩序：${result.title}`, action: "workflow" });
      setError("");
    } catch (cause) {
      setNotice(null);
      setError(storageActionError(cause, "送入秩序失败，请检查浏览器存储空间后再试。"));
    }
  }

  return (
    <section className={`inspiration-panel ai-inspiration-panel ${tutorialOpen ? "inspiration-tutorial-active" : ""}`} aria-label="灵感">
      <div className="module-view-header inspiration-header">
        <div>
          <p className="eyebrow">AI 灵感实验室</p>
          <h1>灵感</h1>
          <span className="module-view-subtitle">依托大模型帮助你发掘新的灵感方向</span>
        </div>
        <div className="inspiration-header-actions">
          <button className="secondary-button" type="button" onClick={() => {
            setTutorialIndex(0);
            setTutorialOpen(true);
          }}><Compass size={16} /><span>教程</span></button>
        </div>
      </div>

      <div className="ai-inspiration-workspace">
        <aside className="ai-inspiration-guide">
          <div className="ai-guide-card active"><span><Lightbulb size={17} /></span><strong>输入模糊主题</strong><p>写下困惑、目标、用户场景或一个还没成形的问题。</p></div>
          <div className="ai-guide-card"><span><Wand2 size={17} /></span><strong>选择发掘角度</strong><p>换角度会得到完全不同的创意分支。</p></div>
          <div className="ai-guide-card"><span><Workflow size={17} /></span><strong>推进成行动</strong><p>把生成结果送入笔记或秩序继续拆解。</p></div>
        </aside>

        <main className="ai-inspiration-console">
          <div className="ai-inspiration-form">
            <div ref={formRef} className={`ai-topic-fields ${tutorialOpen && currentTutorial.target === "form" ? "tutorial-spotlight" : ""}`}>
              <label><span>我想探索</span><textarea value={brief} rows={5} aria-label="我想探索" placeholder="例如：怎样把个人记忆做成一个有情绪的产品？" onChange={(event) => setBrief(event.target.value)} /></label>
              <label><span>目标用户 / 场景</span><input value={audience} aria-label="目标用户或场景" placeholder="可选，例如：独立创作者、长期记录生活的人" onChange={(event) => setAudience(event.target.value)} /></label>
            </div>
            <div ref={lensRef} className={`ai-lens-grid ${tutorialOpen && currentTutorial.target === "lens" ? "tutorial-spotlight" : ""}`} aria-label="发掘角度">{lenses.map((item) => <button key={item} type="button" className={lens === item ? "active" : ""} aria-pressed={lens === item} onClick={() => setLens(item)}>{item}</button>)}</div>
            {!activeProfile && <div className="ai-model-empty" role="status" aria-live="polite"><KeyRound size={17} /><div><strong>需要先配置全局模型</strong><small>灵感读取中枢的当前模型配置，不在这里单独输入 Key。</small></div><button className="secondary-button compact" type="button" onClick={() => navigateTo("/aggregation")}>去中枢</button></div>}
            {error && <p className="inspiration-notice error" role="alert">{error}</p>}
              {notice && <div className="inspiration-notice info action-notice" role="status" aria-live="polite"><span>{notice.message}</span>{notice.action === "notes" && <button type="button" onClick={() => navigateTo("/notes")}>查看笔记</button>}{notice.action === "workflow" && <button type="button" onClick={() => navigateTo("/automation")}>打开秩序</button>}</div>}
              <div className="ai-generate-row">
                <button className="primary-action compact ai-generate-button" type="button" disabled={Boolean(generateBlockedReason)} title={generateBlockedReason || "发掘新灵感"} onClick={() => generateInspiration()}>{loading ? <Loader2 size={16} className="spinning" /> : <Sparkles size={16} />}<span>{loading ? "发掘中" : "发掘新灵感"}</span></button>
                {generateBlockedReason && <p className={`react-status-line ${loading ? "pending" : ""} ai-generate-status`} role="status" aria-live="polite">{loading && <Loader2 size={14} className="spinning" />}{generateBlockedReason}</p>}
              </div>
            </div>

          <div ref={resultsRef} className={`ai-inspiration-results ${tutorialOpen && currentTutorial.target === "results" ? "tutorial-spotlight" : ""}`} aria-live="polite" aria-relevant="additions text" aria-busy={loading}>
            {results.map((result) => <article key={result.id} className="ai-result-card">
              <header><Sparkles size={17} /><strong>{result.title}</strong><small>{new Date(result.createdAt).toLocaleString("zh-CN")}</small></header>
              <MarkdownResult content={result.body} />
              <div className="ai-result-actions">
                <button className="secondary-button" type="button" onClick={() => saveAsNote(result)}><NotebookPen size={15} /><span>转成笔记</span></button>
                <button className="secondary-button" type="button" onClick={() => sendToWorkflow(result)}><Workflow size={15} /><span>送入秩序</span></button>
              </div>
            </article>)}
            {!results.length && <div className="inspiration-empty" role="status" aria-live="polite"><Sparkles size={30} /><strong>等待一次发掘</strong><p>输入主题后，大模型会主动生成新的方向、原型和追问。</p></div>}
          </div>

          {!!results.length && <div className="ai-followup-box">
            <input value={followUp} aria-label="继续追问" placeholder="继续追问，例如：把第 2 个方向做成移动端功能" onChange={(event) => setFollowUp(event.target.value)} />
            <button className="secondary-button" type="button" disabled={!followUp.trim() || loading} onClick={() => generateInspiration(followUp)}><Send size={15} /><span>继续发掘</span></button>
          </div>}
        </main>
      </div>

      {tutorialOpen && <TutorialBackdrop rect={spotlightRect} />}
      {tutorialOpen && createPortal(<article ref={tutorialDialogRef} className={`inspiration-tutorial-card spotlight-bubble ${currentTutorial.bubbleClass}`} style={tutorialBubbleStyle} role="dialog" aria-modal="true" aria-labelledby="inspiration-tutorial-title" tabIndex={-1}>
          <button className="inspiration-tutorial-close" type="button" aria-label="关闭教程" onClick={finishTutorial}>×</button>
          <div className="tutorial-progress" role="list" aria-label={`教程进度：第 ${tutorialIndex + 1} 步，共 ${tutorialSteps.length} 步`}>{tutorialSteps.map((_, index) => <span key={index} role="listitem" className={index <= tutorialIndex ? "active" : ""} aria-current={index === tutorialIndex ? "step" : undefined} aria-label={`第 ${index + 1} 步${index === tutorialIndex ? "，当前步骤" : index < tutorialIndex ? "，已完成" : ""}`} />)}</div>
          <span className="tutorial-icon"><Sparkles size={24} /></span>
          <h2 id="inspiration-tutorial-title">{currentTutorial.title}</h2>
          <p>{currentTutorial.body}</p>
          <div className="tutorial-actions">
            <button className="secondary-button" type="button" onClick={finishTutorial}>跳过</button>
            <button className="primary-action compact" type="button" onClick={() => tutorialIndex === tutorialSteps.length - 1 ? finishTutorial() : setTutorialIndex((current) => current + 1)}>{tutorialIndex === tutorialSteps.length - 1 ? <CheckCircle2 size={16} /> : <ArrowRight size={16} />}<span>{currentTutorial.action}</span></button>
          </div>
        </article>, document.body)}
    </section>
  );
}

function inspirationBlockedReason({ brief, activeProfile, loading }: { brief: string; activeProfile?: ModelProfile; loading: boolean }) {
  if (loading) return "正在发掘，请等待当前结果返回。";
  if (!activeProfile) return "需要先在中枢配置全局模型。";
  if (!brief.trim()) return "先输入要探索的主题或困惑。";
  return "";
}

function TutorialBackdrop(props: { rect: SpotlightRect | null }) {
  const rect = props.rect;
  return (
    <div className="inspiration-tutorial-backdrop spotlight-backdrop" role="presentation" aria-hidden="true">
      {rect ? (
        <>
          <span className="spotlight-mask" style={{ top: 0, right: 0, left: 0, height: rect.top }} />
          <span className="spotlight-mask" style={{ top: rect.bottom, right: 0, bottom: 0, left: 0 }} />
          <span className="spotlight-mask" style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }} />
          <span className="spotlight-mask" style={{ top: rect.top, right: 0, left: rect.right, height: rect.height }} />
        </>
      ) : <span className="spotlight-mask" style={{ inset: 0 }} />}
    </div>
  );
}

function rectWithPadding(rect: DOMRect, padding: number): SpotlightRect {
  const top = Math.max(8, rect.top - padding);
  const left = Math.max(8, rect.left - padding);
  const right = Math.min(window.innerWidth - 8, rect.right + padding);
  const bottom = Math.min(window.innerHeight - 8, rect.bottom + padding);
  return { top, right, bottom, left, width: right - left, height: bottom - top };
}

function bubbleStyleForSpotlight(rect: SpotlightRect | null): CSSProperties | undefined {
  if (!rect || typeof window === "undefined") return undefined;
  const margin = 24;
  const gap = 16;
  if (window.innerWidth <= 620) {
    const mobileMargin = 14;
    const aboveSpace = Math.max(0, rect.top - gap - mobileMargin);
    const belowSpace = Math.max(0, window.innerHeight - rect.bottom - gap - mobileMargin);
    const placeBelow = belowSpace >= aboveSpace;
    const availableSpace = placeBelow ? belowSpace : aboveSpace;
    const maxHeight = Math.min(420, Math.max(160, availableSpace));
    const preferredTop = placeBelow ? rect.bottom + gap : rect.top - gap - maxHeight;
    const top = clamp(preferredTop, mobileMargin, window.innerHeight - mobileMargin - maxHeight);
    return { top, right: mobileMargin, bottom: "auto", left: mobileMargin, width: "auto", maxHeight, overflowX: "hidden", overflowY: "auto" };
  }
  const bubbleWidth = Math.min(480, window.innerWidth - margin * 2);
  const estimatedHeight = 278;
  const rightSpace = window.innerWidth - rect.right - gap - margin;
  const leftSpace = rect.left - gap - margin;
  let left = rect.right + gap;
  let top = rect.top;

  if (rightSpace >= bubbleWidth) {
    left = rect.right + gap;
    top = clamp(rect.top, margin, window.innerHeight - estimatedHeight - margin);
  } else if (leftSpace >= bubbleWidth) {
    left = rect.left - gap - bubbleWidth;
    top = clamp(rect.top, margin, window.innerHeight - estimatedHeight - margin);
  } else {
    left = clamp(rect.left, margin, window.innerWidth - bubbleWidth - margin);
    const belowTop = rect.bottom + gap;
    top = belowTop + estimatedHeight + margin <= window.innerHeight ? belowTop : Math.max(margin, rect.top - estimatedHeight - gap);
  }

  return { top, left, right: "auto", bottom: "auto", width: bubbleWidth };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function loadProfiles(): ModelProfile[] {
  try {
    const parsed = JSON.parse(readStorageValue(profilesKey) ?? "[]") as ModelProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStoredNotes(): NoteDraft[] {
  try {
    const parsed = JSON.parse(readStorageValue(notesStorageKey) ?? "[]") as NoteDraft[];
    return Array.isArray(parsed) ? parsed.filter((item) => item.id) : [];
  } catch {
    return [];
  }
}

function storageActionError(cause: unknown, fallback: string) {
  if (cause instanceof DOMException && (cause.name === "QuotaExceededError" || cause.name === "SecurityError")) {
    return fallback;
  }
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function restoreStorageValue(key: string, value: string | null) {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Best-effort rollback only; the visible error already tells the user the save failed.
  }
}

function readStorageValue(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function activeUsableProfile(profiles: ModelProfile[]) {
  const activeId = readStorageValue(activeProfileKey) ?? "";
  const active = profiles.find((profile) => profile.id === activeId);
  return isUsableProfile(active) ? active : profiles.find(isUsableProfile);
}

function isUsableProfile(profile: ModelProfile | undefined) {
  return Boolean(profile?.baseUrl.trim() && profile.model.trim() && (profile.apiKey.trim() || profile.apiKeySet));
}

function configFromProfile(profile: ModelProfile, backendOwned = false): ChatConfig {
  return {
    profileId: backendOwned ? profile.id : undefined,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    systemPrompt: profile.systemPrompt ?? "",
    temperature: Math.max(profile.temperature ?? 0.7, 0.85),
    maxTokens: profile.maxTokens,
  };
}

function MarkdownResult(props: { content: string }) {
  const html = useMemo(() => renderResultMarkdown(props.content), [props.content]);
  return <div className="markdown-body ai-result-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderResultMarkdown(content: string) {
  const sanitized = DOMPurify.sanitize(marked.parse(content, { async: false }) as string);
  const template = document.createElement("template");
  template.innerHTML = sanitized;
  template.content.querySelectorAll("a[href]").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });
  return template.innerHTML;
}

function createId() {
  return `idea-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
