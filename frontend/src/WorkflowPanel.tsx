import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Bot,
  CheckCircle2,
  DatabaseZap,
  FileText,
  Globe2,
  Image,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";

import { callMcpTool, cancelAgentRun, fetchAgentCatalog, fetchAgentRun, fetchAgentRunEvents, fetchAgentRuns, fetchMcpTools, resumeAgentRun, reviewAgentRun, streamAgentRun } from "./services/api";
import type { NoteDraft } from "./types/notes";
import type { AgentCatalog, AgentRunEvent, AgentRunResponse, McpServer, McpToolCallResponse, McpToolListResponse, WorkflowNode, WorkflowNodeType, WorkflowRun, WorkflowTemplate, WorkflowTemplatePolicy } from "./types/workflow";
import type { WorkflowCanvas } from "./types/workflow-canvas";

const runsKey = "4ever.workflow.runs";
const notesKey = "4ever.notes";
const activeNoteKey = "4ever.notes.active";
const workflowHandoffKey = "4ever.workflow.handoff";
const workflowUserSecurityNote = "选择 Agent 和可用工具后运行任务。密钥由系统托管，当前页面只保留输入内容和运行记录。";
const workflowRunsStorageError = "运行记录保存失败，请检查浏览器存储空间后再继续运行。";
const workflowActiveNoteStorageError = "笔记来源已切换，但本地活动笔记保存失败；刷新后可能回到上次选择。";

type WorkflowHandoff = {
  source: "inspiration";
  sourceId: string;
  noteId?: string;
  title: string;
  content: string;
  mood?: string;
  stage?: string;
  createdAt: string;
  canvas?: WorkflowCanvas;
};

type WorkflowEventSummary = {
  count: number;
  retryCount: number;
  lastRetryStep: string;
  lastRetryReason: string;
  eventTrail: string[];
  lastEvent: string;
  cancelled: boolean;
  cancelReason: string;
};

type WorkflowProgressStatus = "pending" | "current" | "finished" | "failed" | "retrying" | "canceled";

type WorkflowProgressState = {
  currentGraphStep: string;
  completedGraphSteps: string[];
  failedGraphStep: string;
  retryGraphStep: string;
  canceled: boolean;
};

type WorkflowProgressStep = {
  id: string;
  title: string;
  type: WorkflowNodeType;
  graphStep: string;
  active: boolean;
  current: boolean;
  status: WorkflowProgressStatus;
};

const emptyProgressState: WorkflowProgressState = {
  currentGraphStep: "",
  completedGraphSteps: [],
  failedGraphStep: "",
  retryGraphStep: "",
  canceled: false,
};

const fallbackAgentCatalog: AgentCatalog = {
  security_note: "选择 Agent 和 MCP 工具即可运行任务，密钥由后端托管，前端只保留工作流参数和运行记录。",
  graph_runtime: { runtime: "internal", requested: "auto", available: false, reason: "backend catalog unavailable" },
  workflow_templates: [
    { id: "agent-research-brief", name: "Agent 联网调研", execution_mode: "read_only", requires_review: false, side_effects: [], retry_limit: 1, timeout_seconds: 90, audit_level: "evidence" },
    { id: "agent-repo-brief", name: "Agent 仓库调研", execution_mode: "read_only", requires_review: false, side_effects: [], retry_limit: 1, timeout_seconds: 90, audit_level: "code_evidence" },
    { id: "note-copy", name: "笔记整理成文案", execution_mode: "draft_only", requires_review: true, side_effects: ["draft_content"], retry_limit: 0, timeout_seconds: 60, audit_level: "standard" },
    { id: "note-message", name: "笔记发送给联系人", execution_mode: "draft_only", requires_review: true, side_effects: ["draft_message"], retry_limit: 0, timeout_seconds: 45, audit_level: "review_required" },
  ],
  agents: [
    {
      id: "research-agent",
      name: "调研 Agent",
      role: "researcher",
      description: "把联网搜索、网页读取和笔记输入组合成可追溯的调研摘要。",
      model_hint: "GLM / OpenAI compatible chat model",
      prompt_version: "research-v1",
      prompt_checksum: "local",
      system_prompt: "你是 4Ever 调研 Agent。你只做可追溯调研、证据压缩和结构化摘要，不执行外部副作用。",
      mcp_server_ids: ["bigmodel-web-search", "bigmodel-web-reader", "bigmodel-zread"],
      workflow_template_ids: ["agent-research-brief", "agent-repo-brief"],
    },
    {
      id: "workflow-agent",
      name: "秩序 Agent",
      role: "operator",
      description: "把灵感、笔记和外部上下文整理成可执行任务步骤。",
      model_hint: "GLM / OpenAI compatible chat model",
      prompt_version: "workflow-v1",
      prompt_checksum: "local",
      system_prompt: "你是 4Ever 秩序 Agent。你把灵感、笔记和上下文整理成草稿或下一步建议，涉及发送和发布必须等待人工复核。",
      mcp_server_ids: ["bigmodel-web-reader", "bigmodel-zread"],
      workflow_template_ids: ["note-copy", "note-message", "agent-research-brief", "agent-repo-brief"],
    },
  ],
  mcp_servers: [
    {
      id: "bigmodel-web-search",
      name: "BigModel Web Search Prime",
      description: "联网搜索和实时信息获取。",
      transport: "streamable-http",
      endpoint: "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
      auth: "bearer",
      provider: "bigmodel",
      required_env: "BIGMODEL_API_KEY",
      enabled: true,
      configured: false,
      live_enabled: false,
      tool_count: 1,
      tool_names: ["webSearchPrime"],
      tags: ["search", "research", "realtime"],
    },
    {
      id: "bigmodel-web-reader",
      name: "BigModel Web Reader",
      description: "读取网页正文和结构化内容。",
      transport: "streamable-http",
      endpoint: "https://open.bigmodel.cn/api/mcp/web_reader/mcp",
      auth: "bearer",
      provider: "bigmodel",
      required_env: "BIGMODEL_API_KEY",
      enabled: true,
      configured: false,
      live_enabled: false,
      tool_count: 1,
      tool_names: ["webReader"],
      tags: ["reader", "web", "context"],
    },
    {
      id: "bigmodel-zread",
      name: "BigModel ZRead",
      description: "读取开源仓库知识、文档和代码。",
      transport: "streamable-http",
      endpoint: "https://open.bigmodel.cn/api/mcp/zread/mcp",
      auth: "bearer",
      provider: "bigmodel",
      required_env: "BIGMODEL_API_KEY",
      enabled: true,
      configured: false,
      live_enabled: false,
      tool_count: 3,
      tool_names: ["search_doc", "get_repo_structure", "read_file"],
      tags: ["repo", "code", "docs"],
    },
  ],
};

const templates: WorkflowTemplate[] = [
  {
    id: "agent-research-brief",
    name: "Agent 联网调研",
    nameEn: "Agent research brief",
    description: "调用 BigModel MCP 预设，把主题整理为带来源感的调研摘要。",
    descriptionEn: "Use MCP-backed research to build a brief.",
    category: "Agent",
    categoryEn: "Agent",
    agentId: "research-agent",
    mcpServerIds: ["bigmodel-web-search", "bigmodel-web-reader"],
    inputs: [{ key: "topic", label: "调研主题", labelEn: "Topic", placeholder: "输入要调研的问题、URL 或产品", placeholderEn: "Topic", type: "textarea", required: true }],
    nodes: [
      { id: "agent", type: "agent", title: "选择调研 Agent", titleEn: "Select agent", description: "读取 Agent 角色、模型建议和授权边界", descriptionEn: "Read agent role" },
      { id: "search", type: "mcp", title: "MCP 联网搜索", titleEn: "MCP search", description: "通过 BigModel Web Search Prime 获取上下文", descriptionEn: "Search context" },
      { id: "reader", type: "mcp", title: "MCP 网页读取", titleEn: "MCP reader", description: "读取候选网页正文并压缩为证据", descriptionEn: "Read pages" },
      { id: "summary", type: "ai", title: "生成摘要", titleEn: "Summarize", description: "输出可进入笔记或聊天的结构化结论", descriptionEn: "Generate brief" },
    ],
  },
  {
    id: "agent-repo-brief",
    name: "Agent 仓库调研",
    nameEn: "Agent repo brief",
    description: "用 BigModel ZRead 读取仓库文档、结构和目标文件，生成技术摘要。",
    descriptionEn: "Use ZRead to inspect repo docs, structure, and target files.",
    category: "Agent",
    categoryEn: "Agent",
    agentId: "research-agent",
    mcpServerIds: ["bigmodel-zread"],
    inputs: [{ key: "topic", label: "仓库或文件线索", labelEn: "Repo or file", placeholder: "例如 https://github.com/openai/codex path: docs/usage.md", placeholderEn: "Repo URL and optional path", type: "textarea", required: true }],
    nodes: [
      { id: "agent", type: "agent", title: "选择技术 Agent", titleEn: "Select agent", description: "读取 Agent 角色、模型建议和授权边界", descriptionEn: "Read agent role" },
      { id: "search_doc", type: "mcp", title: "ZRead 文档搜索", titleEn: "Search docs", description: "调用 search_doc 定位仓库相关文档", descriptionEn: "Call search_doc" },
      { id: "repo_structure", type: "mcp", title: "ZRead 仓库结构", titleEn: "Repo structure", description: "调用 get_repo_structure 读取目录骨架", descriptionEn: "Call get_repo_structure" },
      { id: "read_file", type: "mcp", title: "ZRead 文件读取", titleEn: "Read file", description: "调用 read_file 读取目标文件或 README", descriptionEn: "Call read_file" },
      { id: "summary", type: "ai", title: "生成技术摘要", titleEn: "Summarize", description: "输出可追溯的仓库调研结论", descriptionEn: "Generate repo brief" },
    ],
  },
  {
    id: "note-copy",
    name: "笔记整理成文案",
    nameEn: "Note to copy",
    description: "把系统笔记整理为一段可发布文案。",
    descriptionEn: "Turn a note into publishable copy.",
    category: "内容",
    categoryEn: "Content",
    agentId: "workflow-agent",
    mcpServerIds: [],
    inputs: [{ key: "note", label: "笔记内容", labelEn: "Note", placeholder: "选择或粘贴笔记", placeholderEn: "Paste note", type: "textarea", required: true }],
    nodes: [
      { id: "source", type: "notes", title: "读取笔记", titleEn: "Read note", description: "读取系统笔记", descriptionEn: "Read note" },
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
    agentId: "workflow-agent",
    mcpServerIds: [],
    inputs: [{ key: "note", label: "笔记内容", labelEn: "Note", placeholder: "输入要发送的笔记", placeholderEn: "Paste note", type: "textarea", required: true }],
    nodes: [
      { id: "source", type: "notes", title: "读取笔记", titleEn: "Read note", description: "读取系统笔记", descriptionEn: "Read note" },
      { id: "chat", type: "chat", title: "生成消息", titleEn: "Generate message", description: "生成适合发送的消息", descriptionEn: "Generate message" },
    ],
  },
];

export default function WorkflowPanel() {
  const [activeId, setActiveId] = useState(templates[0].id);
  const [input, setInput] = useState("");
  const [runs, setRuns] = useState<WorkflowRun[]>(loadRuns);
  const runsRef = useRef(runs);
  const [running, setRunning] = useState(false);
  const [runningStepIndex, setRunningStepIndex] = useState(0);
  const [liveProgress, setLiveProgress] = useState<WorkflowProgressState>(emptyProgressState);
  const [runningRunId, setRunningRunId] = useState("");
  const [runError, setRunError] = useState("");
  const [runNotice, setRunNotice] = useState("");
  const [eventSummaries, setEventSummaries] = useState<Record<string, WorkflowEventSummary>>({});
  const [workflowHandoff, setWorkflowHandoff] = useState<WorkflowHandoff | null>(loadWorkflowHandoff);
  const [agentCatalog, setAgentCatalog] = useState<AgentCatalog>(fallbackAgentCatalog);
  const [selectedAgentId, setSelectedAgentId] = useState(templates[0].agentId ?? "");
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>(templates[0].mcpServerIds ?? []);
  const [inspectedMcpId, setInspectedMcpId] = useState("");
  const [mcpToolLists, setMcpToolLists] = useState<Record<string, McpToolListResponse>>({});
  const [mcpToolLoadingId, setMcpToolLoadingId] = useState("");
  const [mcpToolError, setMcpToolError] = useState("");
  const historyRef = useRef<HTMLElement | null>(null);
  const pendingHistoryScrollRef = useRef(false);
  const lastTemplateIdRef = useRef(activeId);
  const runAbortRef = useRef<AbortController | null>(null);
  const runningRunIdRef = useRef("");
  const notes = useMemo(loadNotes, []);
  const [selectedNoteId, setSelectedNoteId] = useState(() => {
    const storedActiveId = loadActiveNoteId();
    return notes.some((note) => note.id === storedActiveId) ? storedActiveId : notes[0]?.id ?? "";
  });
  const active = templates.find((template) => template.id === activeId) ?? templates[0];
  const activeView = useMemo(() => presentationTemplate(active, workflowHandoff), [active, workflowHandoff]);
  const templateViews = useMemo(() => templates.map((template) => presentationTemplate(template, workflowHandoff)), [workflowHandoff]);
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? notes[0];
  const sourcePreview = input.trim() || workflowHandoff?.content || selectedNote?.content || "";
  const activePolicy = agentCatalog.workflow_templates.find((template) => template.id === active.id);
  const eligibleAgents = useMemo(
    () => agentCatalog.agents.filter((agent) => agent.workflow_template_ids.includes(active.id)),
    [active.id, agentCatalog.agents],
  );
  const activeAgent = eligibleAgents.find((agent) => agent.id === selectedAgentId) ?? eligibleAgents.find((agent) => agent.id === active.agentId) ?? eligibleAgents[0];
  const availableMcpServers = useMemo(
    () => (activeAgent?.mcp_server_ids ?? [])
      .map((serverId) => agentCatalog.mcp_servers.find((server) => server.id === serverId))
      .filter((server): server is McpServer => Boolean(server)),
    [activeAgent?.mcp_server_ids, agentCatalog.mcp_servers],
  );
  const activeMcpServers = useMemo(
    () => selectedMcpIds
      .map((serverId) => availableMcpServers.find((server) => server.id === serverId))
      .filter((server): server is McpServer => Boolean(server)),
    [availableMcpServers, selectedMcpIds],
  );
  const noAgentAvailable = !activeAgent;
  const requiredInputMissing = activeView.inputs.some((field) => field.required) && !sourcePreview.trim();
  const runDisabled = running || requiredInputMissing || noAgentAvailable;
  const progressSteps = running ? liveRunProgressSteps(activeView, liveProgress, runningStepIndex) : runProgressSteps(runs[0], activeView);
  const progressStripStyle = { "--workflow-step-count": progressSteps.length } as CSSProperties;

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  useEffect(() => {
    fetchAgentCatalog().then(setAgentCatalog).catch(() => setAgentCatalog(fallbackAgentCatalog));
  }, []);

  useEffect(() => {
    fetchAgentRuns(30)
      .then((response) => {
        const persistedRuns = response.runs.map(runFromAgentResponse);
        if (persistedRuns.length) {
          if (!persistRuns(persistedRuns)) {
            setRuns(persistedRuns);
            runsRef.current = persistedRuns;
            setRunError("已从后端读取运行记录，但本地缓存失败；刷新后会重新从后端加载。");
          }
          hydrateEventCounts(persistedRuns);
        }
      })
      .catch(() => {
        // Keep local history when the backend is unavailable during frontend-only work.
      });
  }, []);

  useEffect(() => {
    if (!workflowHandoff) return;
    setActiveId("note-copy");
    setInput(workflowHandoff.content);
    if (workflowHandoff.noteId) {
      setSelectedNoteId(workflowHandoff.noteId);
    }
  }, [workflowHandoff]);

  useEffect(() => {
    const preferredAgentId = active.agentId ?? eligibleAgents[0]?.id ?? "";
    setSelectedAgentId((currentAgentId) => (
      eligibleAgents.some((agent) => agent.id === currentAgentId) ? currentAgentId : preferredAgentId
    ));
  }, [active.agentId, active.id, eligibleAgents]);

  useEffect(() => {
    const availableIds = new Set(availableMcpServers.map((server) => server.id));
    const defaultIds = (active.mcpServerIds ?? []).filter((serverId) => availableIds.has(serverId));
    const templateChanged = lastTemplateIdRef.current !== active.id;
    if (templateChanged) {
      lastTemplateIdRef.current = active.id;
      setSelectedMcpIds(defaultIds);
      setInspectedMcpId("");
      setMcpToolError("");
      return;
    }
    setSelectedMcpIds((currentIds) => {
      const nextIds = currentIds.filter((serverId) => availableIds.has(serverId));
      if (nextIds.length || !defaultIds.length) {
        return nextIds;
      }
      return defaultIds;
    });
  }, [active.id, active.mcpServerIds, availableMcpServers]);

  useEffect(() => {
    if (!running) {
      setRunningStepIndex(0);
      setLiveProgress(emptyProgressState);
      return;
    }
    setRunningStepIndex(0);
    setLiveProgress(emptyProgressState);
    const timer = window.setTimeout(() => {
      setRunningStepIndex((index) => (index === 0 ? Math.min(index + 1, activeView.nodes.length - 1) : index));
    }, prefersReducedMotion() ? 1200 : 900);
    return () => window.clearTimeout(timer);
  }, [activeView.nodes.length, running]);

  useEffect(() => {
    if (!pendingHistoryScrollRef.current || running || !runs.length) {
      return;
    }
    pendingHistoryScrollRef.current = false;
    window.requestAnimationFrame(() => {
      scrollToWorkflowHistory(historyRef.current);
    });
  }, [running, runs.length]);

  async function runWorkflow() {
    const startedAt = new Date().toISOString();
    const source = sourcePreview.trim();
    const sourceKind = workflowHandoff?.source ?? "manual";
    if (requiredInputMissing) {
      setRunNotice("");
      setRunError("请先输入内容，或导入一条笔记。");
      return;
    }
    setRunning(true);
    setRunningRunId("");
    runningRunIdRef.current = "";
    setRunError("");
    setRunNotice("");
    const abortController = new AbortController();
    runAbortRef.current = abortController;
    try {
      if (!activeAgent) {
        throw new Error("当前模板没有可用 Agent。");
      }
      const payload = {
        template_id: active.id,
        agent_id: activeAgent.id,
        mcp_server_ids: activeMcpServers.map((server) => server.id),
        input: { [active.inputs[0]?.key ?? "input"]: source },
        source: sourceKind,
        canvas: workflowHandoff?.canvas,
      };
      const streamedEvents = await streamAgentRun(payload, {
        signal: abortController.signal,
        onEvent: (event) => {
          const runId = event.data.run_id;
          if (runId) {
            setRunningRunId(runId);
            runningRunIdRef.current = runId;
          }
          applyProgressEvent(event, activeView);
        },
      });
      const finishedRunId = streamedEvents.find((event) => event.event === "run.finished")?.data.run_id;
      if (!finishedRunId) {
        throw new Error("工作流事件流未返回完成状态。");
      }
      const response = await fetchAgentRun(finishedRunId);
      if (!commitRun(runFromAgentResponse(response))) {
        setRunError(`运行已完成，但${workflowRunsStorageError}`);
        return;
      }
      setEventSummaries((current) => ({ ...current, [response.id]: summarizeRunEvents(streamedEvents) }));
      clearWorkflowHandoff();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setRunNotice(runningRunIdRef.current ? "已请求取消当前工作流。" : "已停止当前本地等待。后端尚未返回 run id。");
        return;
      }
      const fallbackRun = localRun(activeView, source, sourceKind, activeAgent?.id ?? "", activeMcpServers, startedAt, workflowHandoff?.canvas);
      const runSaved = commitRun(fallbackRun);
      setRunError(runSaved ? formatRunError(error) : `${formatRunError(error)} 但${workflowRunsStorageError}`);
      if (workflowHandoff) {
        setRunNotice("后端暂不可用，已保留灵感来源和输入，可调整后重新运行。");
      }
    } finally {
      await holdWorkflowMotion(startedAt);
      pendingHistoryScrollRef.current = true;
      setRunning(false);
      setRunningRunId("");
      runningRunIdRef.current = "";
      runAbortRef.current = null;
    }
  }

  function applyProgressEvent(event: AgentRunEvent, template: WorkflowTemplate) {
    const graphStep = event.data.graph_step || graphStepForNode(event.data.node_id || "", event.data.type as WorkflowNodeType);
    const stepIndex = graphStep ? template.nodes.findIndex((node) => graphStepForNode(node.id, node.type) === graphStep) : -1;
    const nextGraphStep = stepIndex >= 0 ? graphStepForNode(template.nodes[Math.min(stepIndex + 1, template.nodes.length - 1)].id, template.nodes[Math.min(stepIndex + 1, template.nodes.length - 1)].type) : "";
    setLiveProgress((current) => nextProgressState(current, event, graphStep, nextGraphStep));
    if (stepIndex >= 0) {
      setRunningStepIndex(event.event === "node.finished" ? Math.min(stepIndex + 1, template.nodes.length - 1) : stepIndex);
    }
  }

  async function cancelRunningWorkflow() {
    const runId = runningRunIdRef.current || runningRunId;
    runAbortRef.current?.abort();
    setRunning(false);
    setRunningRunId("");
    runningRunIdRef.current = "";
    pendingHistoryScrollRef.current = true;
    setRunError("");
    if (!runId) {
      setRunNotice("已停止当前本地等待。后端尚未返回 run id。");
      return;
    }
    try {
      const response = await cancelAgentRun(runId);
      if (!commitRun(runFromAgentResponse(response))) {
        setRunNotice("");
        setRunError(`已取消当前工作流，但${workflowRunsStorageError}`);
        return;
      }
      const events = await fetchAgentRunEvents(runId);
      setEventSummaries((current) => ({ ...current, [runId]: summarizeRunEvents(events) }));
      setRunNotice("已取消当前工作流。");
    } catch (error) {
      setRunNotice("");
      setRunError(formatCancelError(error));
    }
  }

  function persistRuns(nextRuns: WorkflowRun[]) {
    try {
      localStorage.setItem(runsKey, JSON.stringify(nextRuns));
      runsRef.current = nextRuns;
      setRuns(nextRuns);
      return true;
    } catch {
      return false;
    }
  }

  function commitRun(run: WorkflowRun) {
    const nextRuns = [run, ...runsRef.current.filter((currentRun) => currentRun.id !== run.id)].slice(0, 20);
    return persistRuns(nextRuns);
  }

  function hydrateEventCounts(persistedRuns: WorkflowRun[]) {
    persistedRuns.slice(0, 10).forEach((run) => {
      fetchAgentRunEvents(run.id)
        .then((events) => setEventSummaries((current) => ({ ...current, [run.id]: summarizeRunEvents(events) })))
        .catch(() => undefined);
    });
  }

  function clearWorkflowHandoff() {
    try {
      localStorage.removeItem(workflowHandoffKey);
    } catch {
      setRunError("灵感来源清除失败，请检查浏览器存储空间后再试。");
      return;
    }
    if (workflowHandoff && input === workflowHandoff.content) {
      setInput("");
    }
    setWorkflowHandoff(null);
  }

  function selectNoteSource(noteId: string) {
    setSelectedNoteId(noteId);
    try {
      if (noteId) {
        localStorage.setItem(activeNoteKey, noteId);
      } else {
        localStorage.removeItem(activeNoteKey);
      }
    } catch {
      setRunNotice("");
      setRunError(workflowActiveNoteStorageError);
    }
  }

  function toggleMcpServer(serverId: string) {
    setSelectedMcpIds((currentIds) => (
      currentIds.includes(serverId) ? currentIds.filter((id) => id !== serverId) : [...currentIds, serverId]
    ));
  }

  function handleMcpChipClick(serverId: string, selected: boolean) {
    if (selected && inspectedMcpId !== serverId) {
      inspectMcpServer(serverId);
      return;
    }
    toggleMcpServer(serverId);
    inspectMcpServer(serverId);
  }

  function inspectMcpServer(serverId: string) {
    setInspectedMcpId(serverId);
    setMcpToolError("");
    if (mcpToolLists[serverId]) {
      return;
    }
    setMcpToolLoadingId(serverId);
    fetchMcpTools(serverId)
      .then((tools) => setMcpToolLists((current) => ({ ...current, [serverId]: tools })))
      .catch((error) => setMcpToolError(formatRunError(error)))
      .finally(() => setMcpToolLoadingId((currentId) => (currentId === serverId ? "" : currentId)));
  }

  async function reviewRun(run: WorkflowRun, status: "approved" | "rejected") {
    setRunError("");
    setRunNotice("");
    try {
      const response = await reviewAgentRun(run.id, { status });
      const reviewedRun = runFromAgentResponse(response);
      const nextRuns = runsRef.current.map((currentRun) => (currentRun.id === reviewedRun.id ? reviewedRun : currentRun));
      if (!persistRuns(nextRuns)) {
        setRunError(`复核状态已提交，但${workflowRunsStorageError}`);
        return;
      }
      setRunNotice(status === "approved" ? "已批准该运行。" : "已拒绝该运行。");
    } catch (error) {
      setRunError(formatRunError(error));
    }
  }

  async function resumeRun(run: WorkflowRun) {
    setRunError("");
    setRunNotice("");
    try {
      const response = await resumeAgentRun(run.id);
      const resumedRun = runFromAgentResponse(response);
      if (!commitRun(resumedRun)) {
        setRunError(`已从后端继续运行，但${workflowRunsStorageError}`);
        return;
      }
      const events = await fetchAgentRunEvents(response.id);
      setEventSummaries((current) => ({ ...current, [response.id]: summarizeRunEvents(events) }));
      pendingHistoryScrollRef.current = true;
      setRunNotice("已从上次进度继续运行。");
    } catch (error) {
      setRunError(formatRunError(error));
    }
  }

  return (
    <section className="workflow-panel">
      <div className="module-view-header">
        <div><p className="eyebrow">Agent 工作流</p><h1>秩序</h1></div>
        <div className="workflow-header-actions">
          {noAgentAvailable ? <span className="workflow-run-hint warning">切换模板或启用 Agent</span> : requiredInputMissing && <span className="workflow-run-hint">填写内容后运行</span>}
          {running ? (
            <button className="secondary-button compact workflow-run-button" type="button" title={runningRunId ? `取消运行 ${runningRunId}` : "停止当前等待"} onClick={cancelRunningWorkflow}>
              <X size={16} />
              <span>{runningRunId ? "取消" : "停止"}</span>
            </button>
          ) : (
            <button className="primary-action compact workflow-run-button" type="button" disabled={runDisabled} title={noAgentAvailable ? "当前模板没有可用 Agent" : requiredInputMissing ? "请先输入内容，或导入一条笔记" : "运行工作流"} onClick={runWorkflow}>
              <Play size={16} />
              <span>运行</span>
            </button>
          )}
        </div>
      </div>
      <div className="workflow-workspace">
        <aside className="workflow-sidebar">
          <p className="eyebrow">模板</p>
          <div className="workflow-template-list">
            {templateViews.map((template) => (
              <button key={template.id} className={`workflow-template-card ${template.id === active.id ? "active" : ""}`} type="button" aria-current={template.id === active.id ? "true" : undefined} onClick={() => setActiveId(template.id)}>
                <span className="workflow-template-icon">{template.agentId ? <Bot size={18} /> : <Workflow size={18} />}</span>
                <span className="workflow-template-main">
                  <strong>{template.name}</strong>
                  <small>{template.description}</small>
                </span>
                <em>{template.id === active.id ? "当前模板" : template.category}</em>
              </button>
            ))}
          </div>
        </aside>

        <div className="workflow-main">
          <article className="workflow-hero-card">
            <div>
              <p className="eyebrow">{activeView.category}</p>
              <h2>{activeView.name}</h2>
              <p>{activeView.description}</p>
            </div>
            <div className="workflow-stats">
              <span><Bot size={14} />{activeAgent?.name ?? "本地 Agent"}</span>
              <span><DatabaseZap size={14} />{activeMcpServers.length}/{availableMcpServers.length} MCP</span>
              <span><ShieldCheck size={14} />{activePolicy?.requires_review ? "需人工复核" : "只读执行"}</span>
              <span><Workflow size={14} />运行记录就绪</span>
              <span><CheckCircle2 size={14} />安全托管</span>
            </div>
          </article>

          <ol className={`workflow-progress-strip ${running ? "running" : ""}`} style={progressStripStyle} aria-label="工作流执行进度">
            {progressSteps.map((step, index) => (
              <li key={`${step.id}-${index}`} className={`workflow-progress-step ${step.active ? "active" : ""} ${step.current ? "current" : ""} ${step.status}`} aria-current={step.current ? "step" : undefined} title={`${step.title} · ${progressStatusLabel(step.status)}`}>
                <span>{nodeIcon(step.type)}</span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{progressStatusLabel(step.status)}</small>
                </div>
              </li>
            ))}
          </ol>

          <div className="workflow-grid">
            <article className="workflow-input-card">
              <p className="workflow-config-note"><Globe2 size={15} />{workflowUserSecurityNote}</p>
              {activePolicy && <WorkflowPolicyPanel policy={activePolicy} />}
              <div className="workflow-agent-selector" aria-label="Agent 选择">
                {eligibleAgents.map((agent) => (
                  <button key={agent.id} type="button" className={agent.id === activeAgent?.id ? "active" : ""} aria-pressed={agent.id === activeAgent?.id} onClick={() => setSelectedAgentId(agent.id)}>
                    <Bot size={15} />
                    <span>
                      <strong>{agent.name}</strong>
                      <small>{agentUserRole(agent.role)} · {agent.description}</small>
                    </span>
                  </button>
                ))}
                {!eligibleAgents.length && <div className="workflow-agent-empty" role="status" aria-live="polite"><Bot size={16} /><span><strong>当前模板没有可用 Agent</strong><small>请切换模板，或在后台启用面向用户的 Agent 配置。</small></span></div>}
              </div>
              {workflowHandoff && (
                <div className="workflow-handoff">
                  <span><Sparkles size={16} /></span>
                  <div>
                    <strong>已接住灵感：{workflowHandoff.title}</strong>
                    <small>{workflowHandoff.mood || "灵感温室"} {stageLabel(workflowHandoff.stage)} · 可直接运行，或继续改写输入。</small>
                  </div>
                  <button type="button" aria-label="清除灵感来源" title="清除灵感来源" onClick={clearWorkflowHandoff}><X size={15} /><span>清除</span></button>
                </div>
              )}
              {workflowHandoff?.canvas && <WorkflowCanvasHandoffPreview canvas={workflowHandoff.canvas} />}
              <label className="workflow-field">
                <span>笔记来源</span>
                <select value={selectedNote?.id ?? ""} aria-label="选择笔记来源" disabled={!notes.length} onChange={(event) => selectNoteSource(event.target.value)}>
                  {!notes.length && <option value="">暂无笔记</option>}
                  {notes.map((note) => <option key={note.id} value={note.id}>{note.title || "未命名笔记"}</option>)}
                </select>
              </label>
              <button className="secondary-button compact" type="button" disabled={!selectedNote} onClick={() => setInput(selectedNote?.content ?? "")}>
                <FileText size={15} />
                <span>导入选中笔记</span>
              </button>
              <label className="workflow-field">
                <span>{activeView.inputs[0]?.label ?? "输入"}<em>{activeView.inputs[0]?.required ? "必填" : ""}</em></span>
                <textarea value={input} aria-label={activeView.inputs[0]?.label ?? "工作流输入"} placeholder={workflowHandoff ? activeView.inputs[0]?.placeholder : selectedNote ? `默认可读取笔记：${selectedNote.title}` : activeView.inputs[0]?.placeholder} onChange={(event) => setInput(event.target.value)} />
              </label>
              {requiredInputMissing && <p className="workflow-disabled-reason" role="status" aria-live="polite">当前模板需要输入内容，或从上方导入一条笔记。</p>}
              {noAgentAvailable && <p className="workflow-disabled-reason react-error-line" role="alert">当前模板没有可用 Agent，暂不能运行。</p>}
              {sourcePreview && <p className="workflow-preview">当前会读取：{sourcePreview.slice(0, 88)}{sourcePreview.length > 88 ? "..." : ""}</p>}
              {availableMcpServers.length > 0 && (
                <div className="workflow-node-palette" aria-label="MCP 服务选择">
                  {availableMcpServers.map((server) => {
                    const selected = activeMcpServers.some((activeServer) => activeServer.id === server.id);
                    return (
                    <button key={server.id} type="button" className={`workflow-mcp-chip ${selected ? "active" : ""} ${inspectedMcpId === server.id ? "inspected" : ""}`} aria-pressed={selected} aria-label={`${server.name}，${mcpAvailabilityLabel(server)}${selected ? "，已选中" : "，未选中"}${selected && inspectedMcpId !== server.id ? "，点击查看工具" : ""}`} title={`${server.name} · ${mcpAvailabilityLabel(server)}${selected && inspectedMcpId !== server.id ? " · 点击查看工具" : ""}`} onClick={() => handleMcpChipClick(server.id, selected)}>
                      <Search size={14} />
                      <span>{server.name}</span>
                      <em>{server.tool_names[0] ?? "工具"} · {mcpAvailabilityLabel(server)}</em>
                    </button>
                    );
                  })}
                </div>
              )}
              {inspectedMcpId && (
                <McpToolPanel
                  loading={mcpToolLoadingId === inspectedMcpId}
                  error={mcpToolError}
                  fallbackServer={availableMcpServers.find((server) => server.id === inspectedMcpId)}
                  tools={mcpToolLists[inspectedMcpId]}
                  source={sourcePreview}
                />
              )}
            </article>

            <article className="workflow-step-card">
              <ol className="workflow-step-list" aria-label={`${activeView.name} steps`}>
                {activeView.nodes.map((node, index) => (
                  <li key={node.id} className="workflow-step">
                    <span className="workflow-step-index" aria-hidden="true">{index + 1}</span>
                    <div>
                      <strong>{node.title}</strong>
                      <p>{node.description}</p>
                    </div>
                    <span className="workflow-step-icon">{nodeIcon(node.type)}</span>
                  </li>
                ))}
              </ol>
            </article>
          </div>

          <article className="workflow-history-card" ref={historyRef}>
            <div className="workflow-history-head">
              <h2>运行记录</h2>
              <span>{running ? "正在执行..." : "最近任务"}</span>
            </div>
            {runNotice && <p className="workflow-disabled-reason react-status-line success" role="status" aria-live="polite">{runNotice}</p>}
            {runError && <p className="workflow-disabled-reason react-error-line" role="alert">{runError}</p>}
            <div className="workflow-run-list">
              {runs.map((run, index) => (
                <WorkflowRunCard
                  key={run.id}
                  run={run}
                  agentCatalog={agentCatalog}
                  eventSummary={eventSummaries[run.id]}
                  initiallyOpen={index === 0}
                  onReview={reviewRun}
                  onResume={resumeRun}
                />
              ))}
              {!runs.length && <div className="workflow-empty" role="status" aria-live="polite"><Workflow size={26} /><strong>暂无运行记录</strong><small>运行后这里会显示 Agent、MCP、执行状态、失败原因和继续操作。</small></div>}
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function runFromAgentResponse(response: AgentRunResponse): WorkflowRun {
  return {
    id: response.id,
    threadId: response.thread_id,
    checkpointId: response.checkpoint_id,
    workflowId: response.template_id,
    status: response.status,
    agentPromptVersion: response.agent_prompt_version,
    agentPromptChecksum: response.agent_prompt_checksum,
    graphSteps: response.graph_steps,
    input: {
      ...response.input,
      agent: response.agent_id,
      mcp: response.mcp_server_ids.join(","),
      canvasNodes: response.canvas?.nodes?.length ? String(response.canvas.nodes.length) : "",
      canvasConnections: response.canvas?.connections?.length ? String(response.canvas.connections.length) : "",
    },
    nodeResults: response.node_results.map((result) => ({
      nodeId: result.node_id,
      type: result.type,
      title: result.title,
      graphStep: result.graph_step,
      status: result.status,
      output: result.output,
      startedAt: result.started_at,
      endedAt: result.ended_at,
    })),
    reviewStatus: response.review_status,
    reviewNote: response.review_note,
    reviewedAt: response.reviewed_at,
    startedAt: response.started_at,
    endedAt: response.ended_at,
  };
}

function McpToolPanel({
  loading,
  error,
  fallbackServer,
  tools,
  source,
}: {
  loading: boolean;
  error: string;
  fallbackServer?: McpServer;
  tools?: McpToolListResponse;
  source: string;
}) {
  const toolNames = tools?.tools.length ? tools.tools : fallbackServer?.tool_names ?? [];
  const [selectedTool, setSelectedTool] = useState(toolNames[0] ?? "");
  const [argumentText, setArgumentText] = useState("{}");
  const [callResult, setCallResult] = useState<McpToolCallResponse | null>(null);
  const [callError, setCallError] = useState("");
  const [calling, setCalling] = useState(false);
  const status = loading ? "loading" : tools?.status ?? "catalog";

  useEffect(() => {
    const nextTool = toolNames.includes(selectedTool) ? selectedTool : toolNames[0] ?? "";
    setSelectedTool(nextTool);
    setArgumentText(JSON.stringify(defaultMcpArguments(nextTool, source), null, 2));
    setCallResult(null);
    setCallError("");
  }, [fallbackServer?.id, source, tools?.server_id, tools?.tools.join("|")]);

  async function executeToolCall() {
    if (!fallbackServer || !selectedTool) return;
    setCalling(true);
    setCallError("");
    setCallResult(null);
    try {
      const parsedArguments = JSON.parse(argumentText || "{}") as Record<string, unknown>;
      const response = await callMcpTool(fallbackServer.id, { tool_name: selectedTool, arguments: parsedArguments });
      setCallResult(response);
    } catch (cause) {
      setCallError(cause instanceof SyntaxError ? "参数必须是合法 JSON。" : cause instanceof Error ? cause.message : "MCP 工具调用失败。");
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="workflow-mcp-tools" aria-live="polite" aria-busy={loading || calling}>
      <div>
        <strong>{tools?.server_name ?? fallbackServer?.name ?? "MCP Server"}</strong>
        <small>{status === "success" ? "工具可用" : status === "failed" ? "读取失败" : status === "planned" ? "计划模式" : "可选工具"}</small>
      </div>
      <div className="workflow-mcp-tool-list">
        {toolNames.map((toolName) => <span key={toolName}>{toolName}</span>)}
        {!toolNames.length && <span>暂无工具</span>}
      </div>
      {loading && <p className="react-status-line pending workflow-mcp-status" role="status" aria-live="polite">正在读取工具列表...</p>}
      {tools?.reason && <p className="react-status-line workflow-mcp-status" role="status" aria-live="polite">{tools.reason}</p>}
      {tools?.error && <p className="react-error-line workflow-mcp-status" role="alert">{tools.error}</p>}
      {error && <p className="react-error-line workflow-mcp-status" role="alert">{error}</p>}
      {fallbackServer && toolNames.length > 0 && (
        <div className="workflow-mcp-call-panel">
          <label>
            <span>工具</span>
            <select value={selectedTool} aria-label="选择 MCP 工具" onChange={(event) => {
              setSelectedTool(event.target.value);
              setArgumentText(JSON.stringify(defaultMcpArguments(event.target.value, source), null, 2));
              setCallResult(null);
              setCallError("");
            }}>
              {toolNames.map((toolName) => <option key={toolName} value={toolName}>{toolName}</option>)}
            </select>
          </label>
          <label>
            <span>参数</span>
            <textarea value={argumentText} rows={5} aria-label="MCP 工具参数" onChange={(event) => setArgumentText(event.target.value)} />
          </label>
          <button className="secondary-button compact" type="button" disabled={calling || !selectedTool} onClick={executeToolCall}>
            <DatabaseZap size={15} />
            <span>{calling ? "调用中" : "调用工具"}</span>
          </button>
          {callResult && <McpToolCallResult result={callResult} />}
          {callError && <p className="react-error-line workflow-mcp-status" role="alert">{callError}</p>}
        </div>
      )}
    </div>
  );
}

function McpToolCallResult({ result }: { result: McpToolCallResponse }) {
  const isFailed = result.status === "failed";
  return (
    <div className={`workflow-mcp-call-result ${result.status}`} role={isFailed ? "alert" : "status"} aria-live={isFailed ? "assertive" : "polite"}>
      <strong>{result.status === "success" ? "实时结果" : result.status === "failed" ? "调用失败" : "计划调用"}</strong>
      <small>{result.server_name} · {result.tool_name} · {result.live_enabled ? "实时可用" : "计划模式"}</small>
      {result.reason && <small>{result.reason}</small>}
      {result.error && <small>{result.error}</small>}
      <pre>{JSON.stringify(result.result && Object.keys(result.result).length ? result.result : result.arguments, null, 2)}</pre>
    </div>
  );
}

function defaultMcpArguments(toolName: string, source: string): Record<string, unknown> {
  const text = source.trim();
  if (toolName === "webSearchPrime") return { query: text || "4Ever Agent MCP" };
  if (toolName === "webReader") return { url: firstUrlFromText(text) || text || "https://example.com" };
  if (toolName === "search_doc") return { query: text || "4Ever Agent 使用说明", ...repoArgumentsFromText(text) };
  if (toolName === "get_repo_structure") return repoArgumentsFromText(text);
  if (toolName === "read_file") return { ...repoArgumentsFromText(text), file_path: filePathFromText(text) };
  return { input: text };
}

function repoArgumentsFromText(text: string): Record<string, unknown> {
  const repo = firstRepoFromText(text);
  return repo ? { repo } : { repo: "openai/codex" };
}

function firstUrlFromText(text: string) {
  return text.split(/\s+/).find((part) => /^https?:\/\//i.test(part))?.replace(/[.,，。)]+$/g, "") ?? "";
}

function firstRepoFromText(text: string) {
  for (const part of text.split(/\s+/)) {
    const cleaned = part.replace(/[.,，。)>]+$/g, "").replace(/^https?:\/\/github\.com\//i, "");
    if (/^[\w.-]+\/[\w.-]+$/.test(cleaned)) return cleaned;
  }
  return "";
}

function filePathFromText(text: string) {
  const markerMatch = text.match(/(?:file:|path:|文件：|路径：)\s*([^\s]+)/i);
  if (markerMatch?.[1]) return markerMatch[1].replace(/[.,，。)]+$/g, "");
  const path = text.split(/\s+/).find((part) => part.includes("/") && part.includes(".") && !part.includes("github.com"));
  return path?.replace(/[.,，。)]+$/g, "") ?? "README.md";
}

function WorkflowPolicyPanel({ policy }: { policy: WorkflowTemplatePolicy }) {
  return (
    <div className="workflow-policy-panel">
      <span><ShieldCheck size={15} /></span>
      <div>
        <strong>{policy.requires_review ? "人工复核后执行" : "只读工作流"}</strong>
        <small>{policy.execution_mode} · timeout {policy.timeout_seconds}s · retry {policy.retry_limit}</small>
      </div>
      <em>{policy.side_effects.length ? policy.side_effects.join(" / ") : policy.audit_level}</em>
    </div>
  );
}

function RunReviewPanel({ run, onReview }: { run: WorkflowRun; onReview: (run: WorkflowRun, status: "approved" | "rejected") => void }) {
  const status = run.reviewStatus ?? "not_required";
  if (status === "not_required" || run.preview) {
    return null;
  }
  return (
    <div className={`workflow-review-panel ${status}`} role={status === "rejected" ? "alert" : "status"} aria-live={status === "rejected" ? "assertive" : "polite"}>
      <span><ShieldCheck size={15} /></span>
      <div>
        <strong>{status === "pending" ? "等待人工复核" : status === "approved" ? "已批准" : "已拒绝"}</strong>
        <small>{run.reviewedAt ? new Date(run.reviewedAt).toLocaleString() : "复核后才允许进入后续副作用动作"}</small>
      </div>
      {status === "pending" ? (
        <div className="workflow-review-actions">
          <button type="button" onClick={() => onReview(run, "approved")}>批准</button>
          <button type="button" onClick={() => onReview(run, "rejected")}>拒绝</button>
        </div>
      ) : <em>{status}</em>}
    </div>
  );
}

function WorkflowRunContext({ run, agentCatalog, eventSummary, canResume }: { run: WorkflowRun; agentCatalog: AgentCatalog; eventSummary?: WorkflowEventSummary; canResume: boolean }) {
  const templateName = templates.find((item) => item.id === run.workflowId)?.name ?? run.workflowId;
  const agentName = displayAgentName(run.input.agent, agentCatalog);
  const mcpNames = displayMcpNames(run.input.mcp, agentCatalog);
  const nextAction = runNextAction(run, canResume);
  return (
    <div className={`workflow-run-context ${run.status}`}>
      <div className="workflow-run-context-main">
        <span className="workflow-run-status" aria-hidden="true">{runStatusIcon(run)}</span>
        <div>
          <strong>{runStatusLabel(run)} · {templateName}</strong>
          <small>{nextAction}</small>
        </div>
      </div>
      <div className="workflow-run-context-grid" aria-label="运行上下文">
        <span><Bot size={13} />Agent：{agentName}</span>
        <span><DatabaseZap size={13} />MCP：{mcpNames.length ? mcpNames.join(" / ") : "未使用外部工具"}</span>
        <span><Workflow size={13} />运行：{run.preview ? "本地预演" : shortId(run.id)}</span>
        {run.input.canvasNodes && <span><Workflow size={13} />画布：{run.input.canvasNodes} 节点 / {run.input.canvasConnections || "0"} 线</span>}
        <span><ShieldCheck size={13} />复核：{reviewStatusLabel(run.reviewStatus)}</span>
        {run.threadId && <span><MessageSquareText size={13} />会话：{shortId(run.threadId)}</span>}
        {run.checkpointId && <span><CheckCircle2 size={13} />检查点：{shortId(run.checkpointId)}</span>}
        {eventSummary?.lastEvent && <span><RefreshCw size={13} />事件：{eventSummary.lastEvent}</span>}
      </div>
    </div>
  );
}

function runNextAction(run: WorkflowRun, canResume: boolean) {
  if (canResume) return "可从上次进度继续，或修改输入后重新运行。";
  if (run.status === "failed") return "查看失败步骤输出，修正输入或工具配置后重新运行。";
  if (run.status === "canceled") return "运行已取消，可从记录继续或重新运行。";
  if (run.reviewStatus === "pending") return "需要人工复核后才能进入后续动作。";
  if (run.preview) return "后端不可用时生成的本地预演，可在服务恢复后重新运行。";
  return "结果已生成，可复制输出、转入笔记或继续调整模板。";
}

function reviewStatusLabel(status?: string) {
  if (status === "pending") return "待复核";
  if (status === "approved") return "已批准";
  if (status === "rejected") return "已拒绝";
  return "不需要";
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function WorkflowRunCard({
  run,
  agentCatalog,
  eventSummary,
  initiallyOpen,
  onReview,
  onResume,
}: {
  run: WorkflowRun;
  agentCatalog: AgentCatalog;
  eventSummary?: WorkflowEventSummary;
  initiallyOpen: boolean;
  onReview: (run: WorkflowRun, status: "approved" | "rejected") => void;
  onResume: (run: WorkflowRun) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const showCancelAudit = eventSummary?.cancelled || run.status === "canceled";
  const cancelReason = eventSummary?.cancelReason || (run.status === "canceled" ? "run.cancelled" : "");
  const canResume = !run.preview && (run.status === "failed" || run.status === "canceled") && run.nodeResults.some((result) => result.status !== "failed" && result.graphStep);
  const failedNode = run.nodeResults.find((result) => result.status === "failed");
  const eventTrail = runEventTrail(run, eventSummary);
  const eventCount = eventSummary?.count ?? run.nodeResults.length;

  return (
    <details className={`workflow-run-card ${run.status} ${run.preview ? "local-preview" : ""}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="workflow-run-status" aria-label={runStatusLabel(run)} title={runStatusLabel(run)}>{runStatusIcon(run)}</span>
        <span>
          <strong>{templates.find((item) => item.id === run.workflowId)?.name ?? run.workflowId}</strong>
          <small>{runHistoryMeta(run, eventSummary).join(" · ")}</small>
        </span>
        <span className="workflow-run-meta">
          <em>{runStatusLabel(run)}</em>
          <time>{new Date(run.startedAt).toLocaleTimeString()}</time>
        </span>
      </summary>
      <WorkflowRunContext run={run} agentCatalog={agentCatalog} eventSummary={eventSummary} canResume={canResume} />
      {failedNode ? (
        <div className="workflow-run-provenance workflow-run-failure" role="alert" aria-live="assertive">
          <span>失败</span>
          <strong>{failedNode.title}</strong>
          <small>{failureReason(failedNode.output || run.error || "")}</small>
        </div>
      ) : null}
      {run.nodeResults.map((result) => (
        <div className={`workflow-step ${result.status === "failed" ? "failed" : "finished"} workflow-step-log`} key={result.nodeId}>
          <span className="workflow-step-icon">{nodeIcon(result.type)}</span>
          <div className="workflow-step-log-body">
            <strong>{result.title}</strong>
            <pre>{result.output}</pre>
          </div>
        </div>
      ))}
      {eventSummary?.retryCount ? (
        <div className="workflow-run-provenance workflow-run-audit" role="status" aria-live="polite">
          <span>重试</span>
          <strong>系统已自动重试 {eventSummary.retryCount} 次</strong>
          <small>{eventSummary.lastRetryReason || "上一步短暂失败后已重试"}</small>
        </div>
      ) : null}
      {eventTrail.length ? (
        <div className="workflow-run-provenance workflow-run-events" role="status" aria-live="polite">
          <span>事件</span>
          <strong>{eventTrail.join(" → ")}</strong>
          <small>{eventCount} 条记录</small>
        </div>
      ) : null}
      {showCancelAudit ? (
        <div className="workflow-run-provenance workflow-run-audit workflow-run-cancelled" role="status" aria-live="polite">
          <span>取消</span>
          <strong>运行已取消</strong>
          <small>{cancelReason}</small>
        </div>
      ) : null}
      {canResume ? (
        <div className="workflow-run-actions">
          <button type="button" onClick={() => onResume(run)}>从上次进度继续</button>
        </div>
      ) : null}
      <RunReviewPanel run={run} onReview={onReview} />
    </details>
  );
}

function runEventTrail(run: WorkflowRun, eventSummary?: WorkflowEventSummary) {
  if (eventSummary?.eventTrail.length) return eventSummary.eventTrail;
  return run.nodeResults.slice(0, 8).map((result) => `${result.status}:${result.graphStep || result.nodeId}`);
}

function displayAgentName(agentId: string | undefined, agentCatalog: AgentCatalog) {
  if (!agentId) return "本地 Agent";
  return agentCatalog.agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function displayMcpNames(value: string | undefined, agentCatalog: AgentCatalog) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((serverId) => agentCatalog.mcp_servers.find((server) => server.id === serverId)?.name ?? serverId);
}

function failureReason(output: string) {
  const trimmed = output.replace(/\s+/g, " ").trim();
  if (!trimmed) return "检查输入内容、Agent 配置或 MCP 工具状态后重新运行。";
  const match = trimmed.match(/(?:Error|Reason|错误|失败)[:：]\s*([^。；;\n]+)/i);
  const reason = match?.[1]?.trim() || trimmed;
  return `${reason.slice(0, 160)}${reason.length > 160 ? "..." : ""}。下一步：修正输入或工具配置后重新运行。`;
}

function runStatusLabel(run: WorkflowRun) {
  if (run.preview) return "本地预演";
  if (run.reviewStatus === "pending") return "等待复核";
  if (run.reviewStatus === "rejected") return "复核拒绝";
  if (run.status === "canceled") return "已取消";
  if (run.status === "failed") return "运行失败";
  if (run.status === "running") return "运行中";
  return "运行成功";
}

function runStatusIcon(run: WorkflowRun) {
  if (run.preview) return <Workflow size={16} />;
  if (run.status === "canceled") return <X size={16} />;
  if (run.status === "failed") return <X size={16} />;
  if (run.status === "running") return <RefreshCw size={16} />;
  return <CheckCircle2 size={16} />;
}

function runHistoryMeta(run: WorkflowRun, eventSummary?: WorkflowEventSummary) {
  const toolCount = run.input.mcp ? run.input.mcp.split(",").filter(Boolean).length : 0;
  const meta = [runExecutionLabel(run), toolCount ? `使用 ${toolCount} 个工具` : "无需外部工具"];
  if (eventSummary?.retryCount) {
    meta.push(`重试 ${eventSummary.retryCount}`);
  }
  if (run.reviewStatus === "pending") {
    meta.push("待复核");
  } else if (run.reviewStatus === "rejected") {
    meta.push("复核拒绝");
  }
  if (eventSummary?.cancelled) {
    meta.push("已取消");
  } else if (run.status === "canceled") {
    meta.push("已取消");
  }
  return meta;
}

function agentUserRole(role: string) {
  if (role === "researcher") return "调研";
  if (role === "operator") return "执行";
  return "Agent";
}

function summarizeRunEvents(events: AgentRunEvent[]): WorkflowEventSummary {
  const retries = events.filter((event) => event.event === "node.retry");
  const lastRetry = retries[retries.length - 1];
  const cancelEvent = events.find((event) => event.event === "run.cancelled");
  const eventTrail = compactEventTrail(events);
  return {
    count: events.length,
    retryCount: retries.length,
    lastRetryStep: lastRetry?.data.graph_step || lastRetry?.data.node_id || "",
    lastRetryReason: lastRetry?.data.reason || "",
    eventTrail,
    lastEvent: eventTrail[eventTrail.length - 1] || "no events",
    cancelled: Boolean(cancelEvent),
    cancelReason: cancelEvent?.data.reason || "",
  };
}

function compactEventTrail(events: AgentRunEvent[]) {
  return events.slice(0, 8).map((event) => {
    if (event.event === "node.finished" || event.event === "node.retry") {
      return `${event.event}:${event.data.graph_step || event.data.node_id || "node"}`;
    }
    return event.event;
  });
}

function runExecutionLabel(run: WorkflowRun) {
  if (run.preview) return "本地预演";
  const output = run.nodeResults.map((result) => result.output).join("\n");
  if (/Live enabled:\s*yes/i.test(output) || /\bResult:/i.test(output)) return "实时工具";
  if (/计划调用|Live enabled:\s*no|Reason:/i.test(output)) return "计划模式";
  return "已执行";
}

function localRun(
  active: WorkflowTemplate,
  source: string,
  sourceKind: string,
  agentId: string,
  activeMcpServers: McpServer[],
  startedAt: string,
  canvas?: WorkflowCanvas,
): WorkflowRun {
  return {
    id: `run-${Date.now()}`,
    workflowId: active.id,
    status: "success",
    preview: true,
    input: {
      note: source,
      source: sourceKind,
      agent: agentId,
      mcp: activeMcpServers.map((server) => server.id).join(","),
      canvasNodes: canvas?.nodes.length ? String(canvas.nodes.length) : "",
      canvasConnections: canvas?.connections.length ? String(canvas.connections.length) : "",
    },
    nodeResults: active.nodes.map((node, index) => ({
      nodeId: node.id,
      type: node.type,
      title: node.title,
      graphStep: graphStepForNode(node.id, node.type),
      status: "success" as const,
      output: renderNodeOutput(node, source, index, agentId || "本地 Agent", activeMcpServers),
      startedAt,
      endedAt: new Date(Date.now() + index * 120).toISOString(),
    })),
    startedAt,
    endedAt: new Date().toISOString(),
  };
}

function runProgressSteps(run: WorkflowRun | undefined, active: WorkflowTemplate) {
  if (!run || run.workflowId !== active.id || !run.nodeResults.length) {
    return active.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      type: node.type,
      graphStep: graphStepForNode(node.id, node.type),
      active: false,
      current: false,
      status: "pending",
    }));
  }
  return active.nodes.map((node) => {
    const expectedGraphStep = graphStepForNode(node.id, node.type);
    const result = run.nodeResults.find((item) => item.nodeId === node.id || item.graphStep === expectedGraphStep);
    return {
      id: node.id,
      title: result?.title ?? node.title,
      type: result?.type ?? node.type,
      graphStep: result?.graphStep || expectedGraphStep,
      active: Boolean(result),
      current: false,
      status: result?.status === "failed" ? "failed" : result ? "finished" : "pending",
    };
  });
}

function liveRunProgressSteps(active: WorkflowTemplate, progress: WorkflowProgressState, fallbackIndex: number): WorkflowProgressStep[] {
  const completed = new Set(progress.completedGraphSteps);
  const currentIndex = active.nodes.findIndex((node) => graphStepForNode(node.id, node.type) === progress.currentGraphStep);
  const effectiveCurrentIndex = currentIndex >= 0 ? currentIndex : Math.min(fallbackIndex, active.nodes.length - 1);
  return active.nodes.map((node, index) => {
    const graphStep = graphStepForNode(node.id, node.type);
    const status = liveProgressStatus(graphStep, index, effectiveCurrentIndex, completed, progress);
    return {
      id: node.id,
      title: node.title,
      type: node.type,
      graphStep,
      active: status !== "pending",
      current: status === "current" || status === "retrying",
      status,
    };
  });
}

function liveProgressStatus(
  graphStep: string,
  index: number,
  currentIndex: number,
  completed: Set<string>,
  progress: WorkflowProgressState,
): WorkflowProgressStatus {
  if (progress.failedGraphStep === graphStep) return "failed";
  if (progress.canceled && progress.currentGraphStep === graphStep) return "canceled";
  if (progress.retryGraphStep === graphStep) return "retrying";
  if (completed.has(graphStep)) return "finished";
  if (index === currentIndex) return "current";
  return "pending";
}

function nextProgressState(current: WorkflowProgressState, event: AgentRunEvent, graphStep: string, nextGraphStep = ""): WorkflowProgressState {
  if (event.event === "run.started") {
    return {
      ...emptyProgressState,
      currentGraphStep: graphStep || "load_agent",
    };
  }
  if (event.event === "node.retry") {
    return {
      ...current,
      currentGraphStep: graphStep || current.currentGraphStep,
      retryGraphStep: graphStep || current.retryGraphStep,
    };
  }
  if (event.event === "node.finished") {
    const completedGraphSteps = graphStep && !current.completedGraphSteps.includes(graphStep)
      ? [...current.completedGraphSteps, graphStep]
      : current.completedGraphSteps;
    const failedGraphStep = event.data.status === "failed" ? graphStep : current.failedGraphStep;
    return {
      ...current,
      completedGraphSteps,
      currentGraphStep: event.data.status === "failed" ? graphStep || current.currentGraphStep : nextGraphStep || graphStep || current.currentGraphStep,
      failedGraphStep,
      retryGraphStep: current.retryGraphStep === graphStep ? "" : current.retryGraphStep,
    };
  }
  if (event.event === "run.failed") {
    return {
      ...current,
      failedGraphStep: graphStep || current.currentGraphStep,
    };
  }
  if (event.event === "run.cancelled") {
    return {
      ...current,
      canceled: true,
    };
  }
  return current;
}

function progressStatusLabel(status: string) {
  if (status === "current") return "执行中";
  if (status === "retrying") return "重试中";
  if (status === "canceled") return "已取消";
  if (status === "finished") return "已完成";
  if (status === "failed") return "失败";
  return "待执行";
}

async function holdWorkflowMotion(startedAt: string) {
  if (prefersReducedMotion()) {
    return;
  }
  const elapsed = Date.now() - new Date(startedAt).getTime();
  const remaining = Math.max(0, 900 - elapsed);
  if (!remaining) return;
  await new Promise((resolve) => window.setTimeout(resolve, remaining));
}

function scrollToWorkflowHistory(target: HTMLElement | null) {
  if (!target) {
    return;
  }
  const top = target.getBoundingClientRect().top + window.scrollY - 84;
  window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function formatRunError(error: unknown) {
  const detail = error instanceof Error ? error.message : "";
  if (!detail) {
    return "后端暂不可用，已使用本地预演结果。";
  }
  if (/request failed|failed to fetch|network|50\d|40[48]/i.test(detail)) {
    return "后端暂不可用，已使用本地预演结果。";
  }
  return `${detail}；已使用本地预演结果。`;
}

function formatCancelError(error: unknown) {
  const detail = error instanceof Error ? error.message : "";
  if (/already/i.test(detail)) {
    return "后端运行已结束，无法取消。";
  }
  return detail || "取消请求失败。";
}

function presentationTemplate(template: WorkflowTemplate, handoff: WorkflowHandoff | null): WorkflowTemplate {
  if (!handoff || template.id !== "note-copy") return template;
  const canvasNodes = handoff.canvas?.nodes.length ? workflowNodesFromCanvas(handoff.canvas) : null;
  return {
    ...template,
    name: canvasNodes ? "画布流程执行" : "灵感拆解成行动",
    nameEn: "Inspiration to action",
    description: canvasNodes ? "按灵感画布节点和连线组织秩序执行步骤。" : "把灵感温室生成的新方向整理成可执行步骤、风险和下一次追问。",
    descriptionEn: "Turn an inspiration result into actionable steps.",
    category: "灵感",
    categoryEn: "Inspiration",
    inputs: [{ ...template.inputs[0], label: "灵感内容", labelEn: "Inspiration", placeholder: "这里已接入灵感温室结果，可直接运行或继续改写。" }],
    nodes: canvasNodes ?? [
      { id: "source", type: "notes", title: "读取灵感", titleEn: "Read inspiration", description: "接入灵感温室生成的方向和上下文", descriptionEn: "Read inspiration context" },
      { id: "transform", type: "transform", title: "拆解行动", titleEn: "Break into actions", description: "提炼下一步、依赖、风险和验证方式", descriptionEn: "Extract next actions and risks" },
      { id: "copy", type: "ai", title: "生成执行草稿", titleEn: "Draft execution plan", description: "输出可继续推进的行动草稿", descriptionEn: "Generate an execution draft" },
    ],
  };
}

function workflowNodesFromCanvas(canvas: WorkflowCanvas): WorkflowNode[] {
  const orderedNodes = orderedCanvasNodes(canvas);
  return orderedNodes.map((node, index) => {
    const incoming = canvas.connections.filter((connection) => connection.targetNodeId === node.id);
    const outgoing = canvas.connections.filter((connection) => connection.sourceNodeId === node.id);
    const templateType = workflowNodeTypeFromCanvas(node.type);
    return {
      id: `canvas-${node.id}`,
      type: templateType,
      title: node.label,
      titleEn: node.label,
      description: canvasNodeDescription(node, index, incoming.length, outgoing.length),
      descriptionEn: canvasNodeDescription(node, index, incoming.length, outgoing.length),
    };
  });
}

function orderedCanvasNodes(canvas: WorkflowCanvas) {
  if (!canvas.connections.length) return canvas.nodes;
  const nodeById = new Map(canvas.nodes.map((node) => [node.id, node]));
  const targets = new Set(canvas.connections.map((connection) => connection.targetNodeId));
  const startNodes = canvas.nodes.filter((node) => !targets.has(node.id));
  const ordered = [] as WorkflowCanvas["nodes"];
  const visited = new Set<string>();
  const walk = (nodeId: string) => {
    const node = nodeById.get(nodeId);
    if (!node || visited.has(nodeId)) return;
    visited.add(nodeId);
    ordered.push(node);
    canvas.connections
      .filter((connection) => connection.sourceNodeId === nodeId)
      .forEach((connection) => walk(connection.targetNodeId));
  };
  (startNodes.length ? startNodes : canvas.nodes.slice(0, 1)).forEach((node) => walk(node.id));
  canvas.nodes.forEach((node) => walk(node.id));
  return ordered;
}

function workflowNodeTypeFromCanvas(type: string): WorkflowNodeType {
  if (type === "trigger" || type === "workflow-trigger") return "source";
  if (type === "ai-chat") return "ai";
  if (type === "image-gen") return "image";
  if (type === "send-message" || type === "chat-thread") return "chat";
  if (type === "note-create" || type === "notes-query") return "notes";
  if (type === "agent-run") return "agent";
  if (type === "image-studio") return "image";
  if (type === "http-request" || type === "provider-models" || type === "memory-map" || type === "mcp-tool") return "mcp";
  if (type === "condition" || type === "loop" || type === "delay" || type === "transform" || type === "token-usage" || type === "module-catalog" || type === "admin-audit") return "transform";
  return "transform";
}

function canvasNodeDescription(node: WorkflowCanvas["nodes"][number], index: number, incomingCount: number, outgoingCount: number) {
  const configKeys = Object.keys(node.config ?? {}).filter((key) => String(node.config[key] ?? "").trim());
  const portSummary = `${incomingCount} 入 / ${outgoingCount} 出`;
  return `画布第 ${index + 1} 步 · ${portSummary}${configKeys.length ? ` · 配置：${configKeys.join("、")}` : ""}`;
}

function WorkflowCanvasHandoffPreview(props: { canvas: WorkflowCanvas }) {
  const canvas = props.canvas;
  const summary = workflowCanvasSummary(canvas);
  return (
    <div className="workflow-canvas-handoff" aria-label="灵感画布流程预览">
      <div className="workflow-canvas-handoff-head">
        <Workflow size={15} />
        <strong>画布流程</strong>
        <small>{canvas.nodes.length} 个节点 · {canvas.connections.length} 条线</small>
      </div>
      {summary.path.length > 0 ? (
        <ol className="workflow-canvas-path">
          {summary.path.map((item, index) => <li key={`${item}-${index}`}><span>{index + 1}</span><strong>{item}</strong></li>)}
        </ol>
      ) : (
        <p className="workflow-canvas-empty">还没有可识别的连接路径，秩序将按输入内容直接拆解。</p>
      )}
      {(summary.branchLabels.length > 0 || summary.disconnectedLabels.length > 0) && (
        <div className="workflow-canvas-warnings" role="status" aria-live="polite">
          {summary.branchLabels.length > 0 && <span>分支：{summary.branchLabels.join(" / ")}</span>}
          {summary.disconnectedLabels.length > 0 && <span>未接入：{summary.disconnectedLabels.join(" / ")}</span>}
        </div>
      )}
    </div>
  );
}

function workflowCanvasSummary(canvas: WorkflowCanvas) {
  const empty = { path: [] as string[], branchLabels: [] as string[], disconnectedLabels: [] as string[] };
  if (!canvas.nodes.length) return empty;
  const nodeById = new Map(canvas.nodes.map((node) => [node.id, node]));
  if (!canvas.connections.length) return { ...empty, disconnectedLabels: canvas.nodes.map((node) => node.label) };
  const connectedNodeIds = new Set<string>();
  canvas.connections.forEach((connection) => {
    connectedNodeIds.add(connection.sourceNodeId);
    connectedNodeIds.add(connection.targetNodeId);
  });
  const targets = new Set(canvas.connections.map((connection) => connection.targetNodeId));
  const first = canvas.nodes.find((node) => !targets.has(node.id)) ?? canvas.nodes[0];
  const path = [first.label];
  const visited = new Set([first.id]);
  let current = first.id;
  while (true) {
    const nextConnection = canvas.connections.find((connection) => connection.sourceNodeId === current && !visited.has(connection.targetNodeId));
    if (!nextConnection) break;
    const nextNode = nodeById.get(nextConnection.targetNodeId);
    if (!nextNode) break;
    path.push(nextNode.label);
    visited.add(nextNode.id);
    current = nextNode.id;
  }
  const branchLabels = canvas.nodes
    .filter((node) => canvas.connections.filter((connection) => connection.sourceNodeId === node.id).length > 1)
    .map((node) => node.label);
  const disconnectedLabels = canvas.nodes.filter((node) => !connectedNodeIds.has(node.id)).map((node) => node.label);
  return { path, branchLabels, disconnectedLabels };
}

function graphStepForNode(nodeId: string, type: WorkflowNodeType) {
  if (nodeId === "agent") return "load_agent";
  if (nodeId === "search") return "mcp_search";
  if (nodeId === "reader") return "mcp_read";
  if (nodeId === "search_doc") return "mcp_repo_search";
  if (nodeId === "repo_structure") return "mcp_repo_structure";
  if (nodeId === "read_file") return "mcp_read_file";
  if (type === "notes") return "read_input";
  if (type === "transform") return "transform";
  if (type === "chat" || type === "ai") return "synthesize";
  return type;
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

function loadActiveNoteId() {
  try {
    return localStorage.getItem(activeNoteKey) ?? "";
  } catch {
    return "";
  }
}

function loadWorkflowHandoff(): WorkflowHandoff | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(workflowHandoffKey) ?? "null") as Partial<WorkflowHandoff> | null;
    if (!parsed?.content || (parsed.source !== "inspiration" && parsed.source !== "inspiration-ai")) return null;
    return {
      source: "inspiration",
      sourceId: parsed.sourceId || `handoff-${Date.now()}`,
      noteId: parsed.noteId || "",
      title: parsed.title || "灵感温室结果",
      content: parsed.content,
      mood: parsed.mood || "灵感温室",
      stage: parsed.stage || "seed",
      createdAt: parsed.createdAt || new Date().toISOString(),
      canvas: isWorkflowCanvas(parsed.canvas) ? parsed.canvas : undefined,
    };
  } catch {
    return null;
  }
}

function isWorkflowCanvas(value: unknown): value is WorkflowCanvas {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkflowCanvas>;
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.connections);
}

function stageLabel(stage?: string) {
  if (stage === "seed") return "种子";
  if (stage === "growing") return "生长中";
  if (stage === "done") return "已完成";
  return "灵感";
}

function mcpAvailabilityLabel(server: McpServer) {
  if (!server.enabled) return "待启用";
  if (server.live_enabled) return "实时可用";
  if (server.configured) return "计划模式";
  return "等待管理员启用";
}

function renderNodeOutput(node: WorkflowNode, source: string, index: number, agentName = "本地 Agent", mcpServers: McpServer[] = []) {
  const { type } = node;
  if (!source && type !== "agent") return "等待输入内容。";
  if (type === "agent") return `${agentName} 已加载。系统会按当前工作流参数执行，并保留运行记录。`;
  if (type === "mcp") {
    const server = mcpServers[index - 1] ?? mcpServers[0];
    const toolName = toolForLocalNode(node.id, server);
    return server
      ? `准备调用 ${server.name}\n工具：${toolName}\n状态：${mcpAvailabilityLabel(server)}\n说明：${server.description}`
      : "没有绑定 MCP Server。";
  }
  if (type === "notes") return source.slice(0, 120);
  if (type === "transform") return `标题：${source.slice(0, 18)}...\n要点：${source.split(/[。.!?]/).filter(Boolean).slice(0, 3).join(" / ")}`;
  if (type === "chat") return `我整理了一段内容，想同步给你：${source.slice(0, 160)}`;
  return `基于内容生成：${source.slice(0, 180)}`;
}

function toolForLocalNode(nodeId: string, server?: McpServer) {
  if (!server) return "tools/call";
  if (server.id === "bigmodel-zread") {
    if (nodeId === "search_doc") return "search_doc";
    if (nodeId === "repo_structure") return "get_repo_structure";
    if (nodeId === "read_file") return "read_file";
  }
  return server.tool_names[0] ?? "tools/call";
}

function nodeIcon(type: WorkflowNodeType) {
  if (type === "notes") return <FileText size={17} />;
  if (type === "image") return <Image size={17} />;
  if (type === "chat") return <MessageSquareText size={17} />;
  if (type === "mcp") return <DatabaseZap size={17} />;
  if (type === "agent") return <Bot size={17} />;
  return <Plus size={17} />;
}
