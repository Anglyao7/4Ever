<template>
  <section class="workflow-panel" :aria-label="copy.title">
    <div class="module-view-header">
      <div>
        <p class="eyebrow">{{ copy.eyebrow }}</p>
        <h1>{{ copy.title }}</h1>
      </div>
      <div class="workflow-header-actions">
        <span class="status-pill" :class="{ online: backendOnline }">
          <CheckCircle2 v-if="backendOnline" :size="16" />
          <XCircle v-else :size="16" />
          {{ backendOnline ? copy.apiReady : copy.apiOffline }}
        </span>
        <button class="primary-action compact workflow-header-run" type="button" :disabled="running || !canRun" @click="runWorkflow">
        <LoaderCircle v-if="running" :size="17" class="spin" />
        <Play v-else :size="17" />
          <span>{{ running ? copy.running : copy.run }}</span>
        </button>
      </div>
    </div>

    <div class="workflow-workspace">
      <aside class="workflow-sidebar" :aria-label="copy.templates">
        <div class="panel-heading compact">
          <div>
            <p class="eyebrow">{{ copy.templatesEyebrow }}</p>
            <h2>{{ copy.templates }}</h2>
          </div>
          <span class="status-pill online">{{ templates.length }}</span>
        </div>

        <div class="workflow-template-list">
          <button
            v-for="template in templates"
            :key="template.id"
            class="workflow-template-card"
            :class="{ active: template.id === activeTemplateId }"
            type="button"
            @click="selectTemplate(template.id)"
          >
            <span class="workflow-template-icon">
              <component :is="templateIcon(template.id)" :size="17" />
            </span>
            <span class="workflow-template-main">
              <strong>{{ templateName(template) }}</strong>
              <small>{{ templateDescription(template) }}</small>
            </span>
            <em>{{ templateCategory(template) }}</em>
          </button>
        </div>
      </aside>

      <section class="workflow-main" :aria-label="copy.detail">
        <div class="workflow-hero-card">
          <div>
            <p class="eyebrow">{{ templateCategory(activeTemplate) }}</p>
            <h2>{{ templateName(activeTemplate) }}</h2>
            <p>{{ templateDescription(activeTemplate) }}</p>
          </div>
          <div class="workflow-stats">
            <span>
              <Route :size="16" />
              {{ formatStepCount(activeTemplate.nodes.length) }}
            </span>
            <span>
              <History :size="16" />
              {{ formatRunCount(runs.length) }}
            </span>
          </div>
        </div>

        <div class="workflow-grid">
          <form class="workflow-input-card" @submit.prevent="runWorkflow">
            <div class="panel-heading compact">
              <div>
                <p class="eyebrow">{{ copy.inputEyebrow }}</p>
                <h2>{{ copy.input }}</h2>
              </div>
            </div>

            <div class="workflow-config-note">
              <Bot :size="15" />
              <span>{{ activeModelLabel }}</span>
            </div>

            <p v-if="disabledReason" class="notice-line workflow-disabled-reason">{{ disabledReason }}</p>

            <label v-for="field in activeTemplate.inputs" :key="field.key" class="workflow-field">
              <span>{{ fieldLabel(field) }}<em v-if="field.required">{{ copy.required }}</em></span>
              <textarea
                v-if="field.multiline"
                v-model="inputValues[field.key]"
                rows="5"
                :placeholder="fieldPlaceholder(field)"
              />
              <input v-else v-model="inputValues[field.key]" :placeholder="fieldPlaceholder(field)" autocomplete="off" />
            </label>

            <p v-if="error" class="error-line inline">{{ error }}</p>

            <button class="send-button workflow-run-button" type="submit" :disabled="running || !canRun">
              <LoaderCircle v-if="running" :size="18" class="spin" />
              <Play v-else :size="18" />
              <span>{{ running ? copy.running : copy.runCurrent }}</span>
            </button>
          </form>

          <div class="workflow-step-card" :aria-label="copy.stepsLabel">
            <div class="panel-heading compact">
              <div>
                <p class="eyebrow">{{ copy.flowEyebrow }}</p>
                <h2>{{ copy.stepsLabel }}</h2>
              </div>
            </div>

            <div class="workflow-step-list">
              <article
                v-for="(node, index) in activeTemplate.nodes"
                :key="node.id"
                class="workflow-step"
                :class="nodeStateClass(node.id)"
              >
                <span class="workflow-step-index">{{ index + 1 }}</span>
                <div>
                  <strong>{{ nodeTitle(node) }}</strong>
                  <p>{{ nodeDescription(node) }}</p>
                  <pre v-if="nodeOutputPreview(node.id)">{{ nodeOutputPreview(node.id) }}</pre>
                </div>
                <span class="workflow-step-icon">
                  <component :is="nodeIcon(node.type)" :size="17" />
                </span>
              </article>
            </div>
          </div>
        </div>

        <section class="workflow-history-card" :aria-label="copy.history">
          <div class="panel-heading compact">
            <div>
              <p class="eyebrow">{{ copy.runsEyebrow }}</p>
              <h2>{{ copy.history }}</h2>
            </div>
            <button class="secondary-button" type="button" :disabled="runs.length === 0" @click="clearRuns">
              <Trash2 :size="16" />
              <span>{{ copy.clear }}</span>
            </button>
          </div>

          <div v-if="runs.length" class="workflow-run-list">
            <button
              v-for="run in runs"
              :key="run.id"
              class="workflow-run-card"
              :class="[run.status, { active: run.id === selectedRunId }]"
              type="button"
              @click="selectRun(run.id)"
            >
              <span class="workflow-run-status">
                <CheckCircle2 v-if="run.status === 'success'" :size="17" />
                <XCircle v-else-if="run.status === 'failed'" :size="17" />
                <LoaderCircle v-else :size="17" class="spin" />
              </span>
                      <span>
                <strong>{{ runWorkflowName(run) }}</strong>
                <small>{{ runSummary(run) }}</small>
              </span>
              <time>{{ formatTime(run.startedAt) }}</time>
            </button>
          </div>

          <div v-else class="workflow-empty">
            <History :size="30" />
            <p>{{ copy.emptyHistory }}</p>
          </div>
        </section>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  Bot,
  CheckCircle2,
  GitBranch,
  History,
  ImagePlus,
  LoaderCircle,
  MessageSquareText,
  NotebookPen,
  Play,
  RefreshCw,
  Route,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-vue-next";

import { generateImage, sendChat } from "../services/api";
import type { ChatConfig, ChatMessage } from "../types/chat";
import type { ImageGenerationConfig } from "../types/images";
import type { WorkflowInputField, WorkflowNode, WorkflowNodeType, WorkflowRun, WorkflowTemplate } from "../types/workflow";

const props = defineProps<{
  backendOnline: boolean;
  currentConfig: ChatConfig;
  language: "zh-CN" | "en-US";
}>();

type LocalNoteDraft = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
};

const workflowStorageKey = "4ever.workflow.activeTemplate";
const workflowRunsStorageKey = "4ever.workflow.runs";
const notesStorageKey = "4ever.notes.drafts";
const activeNoteStorageKey = "4ever.notes.activeDraft";
const imageConfigStorageKey = "4ever.image.config";
const maxStoredRuns = 20;
const maxStoredNotes = 50;
const maxContextChars = 12_000;
const maxNodeOutputChars = 6_000;
const maxNoteContentChars = 40_000;
const defaultImageConfig: ImageGenerationConfig = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-image-1",
  size: "1024x1024",
  prompt: "",
};

const templates = workflowTemplates();
const activeTemplateId = ref(normalizeTemplateId(localStorage.getItem(workflowStorageKey)));
const inputValues = reactive<Record<string, string>>({});
const runs = ref<WorkflowRun[]>(loadRuns());
const selectedRunId = ref(runs.value[0]?.id ?? "");
const running = ref(false);
const error = ref("");

const copy = computed(() =>
  props.language === "en-US"
    ? {
        title: "Automation",
        eyebrow: "Automation",
        templatesEyebrow: "Templates",
        inputEyebrow: "Input",
        flowEyebrow: "Flow",
        runsEyebrow: "Runs",
        templates: "Workflow templates",
        detail: "Workflow detail",
        input: "Run input",
        apiReady: "API ready",
        apiOffline: "API offline",
        required: "Required",
        run: "Run workflow",
        running: "Running",
        runCurrent: "Run current workflow",
        stepsLabel: "Execution steps",
        history: "Run history",
        clear: "Clear",
        emptyHistory: "Run a workflow to keep its execution trace here.",
        missingInput: "Please complete the required input.",
        backendOffline: "Backend is offline. AI and image nodes cannot run.",
        savedNote: "Saved as a new local note.",
        pushedChat: "Prepared a chat handoff summary.",
        imageQueued: "Image request submitted.",
        conditionPassed: "Condition passed.",
        transformDone: "Structured context prepared.",
        failed: "Workflow failed",
        storageFailed: "The workflow finished, but local storage is full or unavailable.",
        imageConfigMissing: "Configure image generation before running this workflow.",
        activeModel: "Model",
      }
    : {
        title: "秩序",
        eyebrow: "秩序",
        templatesEyebrow: "模板",
        inputEyebrow: "输入",
        flowEyebrow: "流程",
        runsEyebrow: "记录",
        templates: "工作流模板",
        detail: "工作流详情",
        input: "运行输入",
        apiReady: "API 就绪",
        apiOffline: "API 离线",
        required: "必填",
        run: "运行工作流",
        running: "运行中",
        runCurrent: "运行当前工作流",
        stepsLabel: "执行步骤",
        history: "运行历史",
        clear: "清空",
        emptyHistory: "运行一次工作流后，这里会保存执行轨迹。",
        missingInput: "请补全必填输入。",
        backendOffline: "后端离线，AI 和图片节点无法运行。",
        savedNote: "已保存为新的本地笔记。",
        pushedChat: "已准备聊天交接摘要。",
        imageQueued: "图片请求已提交。",
        conditionPassed: "条件检查通过。",
        transformDone: "已整理结构化上下文。",
        failed: "工作流运行失败",
        storageFailed: "工作流已完成，但本地存储空间不足或不可用。",
        imageConfigMissing: "请先配置图片生成模块，再运行这个工作流。",
        activeModel: "模型",
      },
);

const activeTemplate = computed(() => templates.find((template) => template.id === activeTemplateId.value) ?? templates[0]);
const selectedRun = computed(() => runs.value.find((run) => run.id === selectedRunId.value));
const selectedNodeOutputs = computed(() => new Map(selectedRun.value?.nodeResults.map((result) => [result.nodeId, result.output]) ?? []));
const nextPendingNodeId = computed(() => activeTemplate.value.nodes.find((node) => !selectedNodeOutputs.value.has(node.id))?.id ?? "");
const requiresBackend = computed(() => activeTemplate.value.nodes.some((node) => node.type === "ai" || node.type === "image"));
const requiresImage = computed(() => activeTemplate.value.nodes.some((node) => node.type === "image"));
const activeModelLabel = computed(() => `${copy.value.activeModel}: ${props.currentConfig.provider} / ${props.currentConfig.model}`);
const disabledReason = computed(() => {
  if (!canRun.value) {
    return copy.value.missingInput;
  }
  if (!props.backendOnline && requiresBackend.value) {
    return copy.value.backendOffline;
  }
  if (requiresImage.value && !isImageConfigReady(loadImageConfig())) {
    return copy.value.imageConfigMissing;
  }
  return "";
});
const timeFormatter = computed(() => new Intl.DateTimeFormat(props.language === "en-US" ? "en-US" : "zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
}));
const canRun = computed(() => activeTemplate.value.inputs.every((field) => !field.required || inputValues[field.key]?.trim()));

watch(activeTemplateId, (value) => {
  writeStorage(workflowStorageKey, value);
  resetInputs();
});

resetInputs();

function selectTemplate(templateId: string) {
  activeTemplateId.value = templateId;
  selectedRunId.value = "";
  error.value = "";
}

async function runWorkflow() {
  if (running.value) {
    return;
  }
  if (!canRun.value) {
    error.value = copy.value.missingInput;
    return;
  }
  if (disabledReason.value) {
    error.value = disabledReason.value;
    return;
  }

  running.value = true;
  error.value = "";

  const run: WorkflowRun = {
    id: crypto.randomUUID(),
    workflowId: activeTemplate.value.id,
    status: "running",
    input: { ...inputValues },
    nodeResults: [],
    startedAt: new Date().toISOString(),
  };
  runs.value = [run, ...runs.value].slice(0, 20);
  selectedRunId.value = run.id;

  let context = buildInputContext(run.input);

  try {
    for (const node of activeTemplate.value.nodes) {
      const startedAt = new Date().toISOString();
      const output = truncateText(await executeNode(node, context, run.input), maxNodeOutputChars);
      context = truncateText(`${context}\n\n[${nodeTitle(node)}]\n${output}`, maxContextChars);
      run.nodeResults.push({
        nodeId: node.id,
        type: node.type,
        title: nodeTitle(node),
        status: "success",
        output,
        startedAt,
        endedAt: new Date().toISOString(),
      });
      syncRun(run, false);
    }
    run.status = "success";
    run.endedAt = new Date().toISOString();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : copy.value.failed;
    run.status = "failed";
    run.error = message;
    run.endedAt = new Date().toISOString();
    error.value = message;
  } finally {
    syncRun(run, true);
    running.value = false;
  }
}

async function executeNode(node: WorkflowNode, context: string, input: Record<string, string>) {
  if (node.type === "ai") {
    return runAiNode(node, context);
  }
  if (node.type === "image") {
    return runImageNode(context);
  }
  if (node.type === "notes") {
    return saveNote(node, context, input);
  }
  if (node.type === "chat") {
    return `${copy.value.pushedChat}\n\n${context.slice(-1200)}`;
  }
  return context;
}

async function runAiNode(node: WorkflowNode, context: string) {
  const prompt = node.prompt ?? node.description;
  const localizedPrompt = props.language === "en-US" ? node.promptEn ?? prompt : prompt;
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `${localizedPrompt}\n\n${context}`,
    },
  ];
  const response = await sendChat(props.currentConfig, messages);
  return response.content;
}

async function runImageNode(context: string) {
  const prompt = extractImagePrompt(context);
  const response = await generateImage({ ...loadImageConfig(), prompt });
  return formatImageWorkflowOutput(response, prompt);
}

function extractImagePrompt(context: string) {
  const match = context.match(/FINAL_PROMPT\s*:?\s*([\s\S]*?)(?:\n\s*(?:NEGATIVE_PROMPT|STYLE_TAGS|COMPOSITION_NOTES|MODEL_HINTS|REVISION_CHECKLIST)\s*:|$)/i);
  const prompt = match?.[1]?.trim();
  return truncateText(prompt || context.slice(-1800), 4000);
}

function formatImageWorkflowOutput(response: Awaited<ReturnType<typeof generateImage>>, prompt: string) {
  const images = response.images ?? [];
  const lines = [copy.value.imageQueued, `Status: ${response.status}`, response.message, `Images: ${images.length}`];
  images.forEach((image, index) => {
    const label = `${index + 1}.`;
    if (image.url) {
      lines.push(`${label} ${image.url}`);
    } else if (image.b64_json) {
      lines.push(`${label} Base64 image returned (${image.b64_json.length} chars).`);
    } else {
      lines.push(`${label} Image returned without preview data.`);
    }
    if (image.revised_prompt) {
      lines.push(`Revised prompt: ${image.revised_prompt}`);
    }
  });
  lines.push("", "Prompt used:", prompt);
  return lines.join("\n");
}

function saveNote(node: WorkflowNode, context: string, input: Record<string, string>) {
  const notes = loadNotes();
  const now = new Date().toISOString();
  const titleSource = input.topic || input.title || input.question || templateName(activeTemplate.value);
  const separator = props.language === "en-US" ? ": " : "：";
  const note: LocalNoteDraft = {
    id: crypto.randomUUID(),
    title: `${templateName(activeTemplate.value)}${separator}${titleSource.slice(0, 28)}`,
    content: truncateText(`# ${titleSource}\n\n${context}`, maxNoteContentChars),
    updatedAt: now,
  };
  writeStorage(notesStorageKey, JSON.stringify([note, ...notes].slice(0, maxStoredNotes)));
  writeStorage(activeNoteStorageKey, note.id);
  return `${copy.value.savedNote}\n${nodeTitle(node)}${separator}${note.title}`;
}

function resetInputs() {
  restoreInputs({});
}

function restoreInputs(values: Record<string, string>) {
  for (const key of Object.keys(inputValues)) {
    delete inputValues[key];
  }
  for (const field of activeTemplate.value.inputs) {
    inputValues[field.key] = values[field.key] ?? "";
  }
}

function selectRun(runId: string) {
  const run = runs.value.find((item) => item.id === runId);
  if (!run) {
    return;
  }
  activeTemplateId.value = normalizeTemplateId(run.workflowId);
  selectedRunId.value = runId;
  restoreInputs(run.input);
}

function clearRuns() {
  runs.value = [];
  selectedRunId.value = "";
  persistRuns();
}

function syncRun(run: WorkflowRun, persist: boolean) {
  runs.value = runs.value.map((item) => (item.id === run.id ? { ...run, nodeResults: [...run.nodeResults] } : item));
  if (persist) {
    persistRuns();
  }
}

function persistRuns() {
  writeStorage(workflowRunsStorageKey, JSON.stringify(runs.value.slice(0, maxStoredRuns)));
}

function nodeOutput(nodeId: string) {
  return selectedNodeOutputs.value.get(nodeId) ?? "";
}

function nodeOutputPreview(nodeId: string) {
  const output = nodeOutput(nodeId);
  return output.length > 1800 ? `${output.slice(0, 1800)}\n...` : output;
}

function nodeStateClass(nodeId: string) {
  if (selectedNodeOutputs.value.has(nodeId)) {
    return "finished";
  }
  if (running.value && selectedRun.value?.status === "running") {
    return nextPendingNodeId.value === nodeId ? "running" : "";
  }
  return "";
}

function buildInputContext(input: Record<string, string>) {
  return Object.entries(input)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function loadRuns(): WorkflowRun[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(workflowRunsStorageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(0, maxStoredRuns) : [];
  } catch {
    return [];
  }
}

function loadNotes(): LocalNoteDraft[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(notesStorageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadImageConfig(): ImageGenerationConfig {
  try {
    const parsed = JSON.parse(localStorage.getItem(imageConfigStorageKey) ?? "{}");
    return { ...defaultImageConfig, ...parsed };
  } catch {
    return defaultImageConfig;
  }
}

function isImageConfigReady(config: ImageGenerationConfig) {
  return Boolean(config.provider.trim() && config.baseUrl.trim() && config.model.trim() && config.apiKey.trim());
}

function normalizeTemplateId(value: string | null) {
  return value && templates.some((template) => template.id === value) ? value : templates[0].id;
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    error.value = copy.value.storageFailed;
    return false;
  }
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...` : value;
}

function templateName(template: WorkflowTemplate) {
  return props.language === "en-US" ? template.nameEn : template.name;
}

function templateDescription(template: WorkflowTemplate) {
  return props.language === "en-US" ? template.descriptionEn : template.description;
}

function templateCategory(template: WorkflowTemplate) {
  return props.language === "en-US" ? template.categoryEn : template.category;
}

function fieldLabel(field: WorkflowInputField) {
  return props.language === "en-US" ? field.labelEn : field.label;
}

function fieldPlaceholder(field: WorkflowInputField) {
  return props.language === "en-US" ? field.placeholderEn : field.placeholder;
}

function nodeTitle(node: WorkflowNode) {
  return props.language === "en-US" ? node.titleEn : node.title;
}

function nodeDescription(node: WorkflowNode) {
  return props.language === "en-US" ? node.descriptionEn : node.description;
}

function runWorkflowName(run: WorkflowRun) {
  const template = templates.find((item) => item.id === run.workflowId);
  return template ? templateName(template) : run.workflowId;
}

function runSummary(run: WorkflowRun) {
  const input = Object.values(run.input).find(Boolean) ?? "";
  return run.error || input.slice(0, 80) || run.status;
}

function formatTime(value: string) {
  return timeFormatter.value.format(new Date(value));
}

function formatStepCount(value: number) {
  return props.language === "en-US" ? `${value} ${value === 1 ? "step" : "steps"}` : `${value} 步`;
}

function formatRunCount(value: number) {
  return props.language === "en-US" ? `${value} ${value === 1 ? "run" : "runs"}` : `${value} 次运行`;
}

function templateIcon(templateId: string) {
  const icons = {
    research: GitBranch,
    note: NotebookPen,
    image: ImagePlus,
    compare: Bot,
    review: RefreshCw,
  };
  return icons[templateId as keyof typeof icons] ?? Sparkles;
}

function nodeIcon(type: WorkflowNodeType) {
  const icons = {
    ai: Bot,
    notes: NotebookPen,
    image: ImagePlus,
    chat: MessageSquareText,
  };
  return icons[type];
}

function workflowTemplates(): WorkflowTemplate[] {
  return [
    {
      id: "research",
      name: "研究任务流",
      nameEn: "Research workflow",
      description: "把一个主题拆成问题、路径和结构化结论，并保存为笔记。",
      descriptionEn: "Break a topic into questions, paths, and structured findings, then save it as a note.",
      category: "知识整理",
      categoryEn: "Knowledge",
      inputs: [
        {
          key: "topic",
          label: "研究主题",
          labelEn: "Research topic",
          placeholder: "例如：个人 AI 工作台应该如何设计？",
          placeholderEn: "Example: How should a personal AI workspace be designed?",
          required: true,
        },
        {
          key: "context",
          label: "背景资料",
          labelEn: "Context",
          placeholder: "补充已知信息、限制和你希望得到的结果。",
          placeholderEn: "Add known facts, constraints, and desired outcomes.",
          multiline: true,
        },
      ],
      nodes: [
        {
          id: "scope",
          type: "ai",
          title: "拆解问题",
          titleEn: "Scope questions",
          description: "识别核心问题、子问题和优先级。",
          descriptionEn: "Identify core questions, sub-questions, and priorities.",
          prompt: "请把这个研究主题拆解成核心问题、关键假设、信息缺口和优先级，输出结构化清单。",
          promptEn: "Break this research topic into core questions, key assumptions, information gaps, and priorities as a structured list.",
        },
        {
          id: "synthesis",
          type: "ai",
          title: "形成结论",
          titleEn: "Synthesize findings",
          description: "生成可执行结论和下一步行动。",
          descriptionEn: "Generate actionable conclusions and next steps.",
          prompt: "基于以上内容，输出一份简洁研究结论：判断、理由、风险、下一步行动。",
          promptEn: "Based on the above, produce concise findings: judgment, rationale, risks, and next actions.",
        },
        {
          id: "save-note",
          type: "notes",
          title: "保存笔记",
          titleEn: "Save note",
          description: "把研究过程和结论保存到笔记模块。",
          descriptionEn: "Save the process and findings into Notes.",
        },
      ],
    },
    {
      id: "note",
      name: "笔记加工流",
      nameEn: "Note refinement",
      description: "把原始材料整理为摘要、大纲和行动清单。",
      descriptionEn: "Turn raw material into a summary, outline, and action list.",
      category: "生产力",
      categoryEn: "Productivity",
      inputs: [
        {
          key: "title",
          label: "笔记标题",
          labelEn: "Note title",
          placeholder: "给这段材料起一个标题。",
          placeholderEn: "Give this material a title.",
          required: true,
        },
        {
          key: "content",
          label: "原始内容",
          labelEn: "Raw content",
          placeholder: "粘贴需要整理的内容。",
          placeholderEn: "Paste the content to refine.",
          multiline: true,
          required: true,
        },
      ],
      nodes: [
        {
          id: "summarize",
          type: "ai",
          title: "提炼摘要",
          titleEn: "Summarize",
          description: "提取主题、观点和关键信息。",
          descriptionEn: "Extract themes, arguments, and key details.",
          prompt: "请整理这份笔记，输出：一句话摘要、核心观点、重要细节、可删除噪音。",
          promptEn: "Refine this note into: one-sentence summary, core ideas, key details, and removable noise.",
        },
        {
          id: "actions",
          type: "ai",
          title: "生成行动清单",
          titleEn: "Create actions",
          description: "把内容转为可执行事项。",
          descriptionEn: "Convert the content into actionable items.",
          prompt: "请基于整理后的笔记生成行动清单、待确认问题和后续跟进建议。",
          promptEn: "Generate action items, open questions, and follow-up suggestions from the refined note.",
        },
        {
          id: "save-note",
          type: "notes",
          title: "写入新笔记",
          titleEn: "Write new note",
          description: "保存加工后的版本。",
          descriptionEn: "Save the refined version.",
        },
      ],
    },
    {
      id: "image",
      name: "视觉创意生产线",
      nameEn: "Visual creative pipeline",
      description: "把粗略想法变成创意简报、三套视觉方向、最终 Prompt、生成结果和可复用笔记。",
      descriptionEn: "Turn a rough idea into a creative brief, three visual directions, a final prompt, generated output, and a reusable note.",
      category: "创作",
      categoryEn: "Creation",
      inputs: [
        {
          key: "idea",
          label: "画面想法",
          labelEn: "Image idea",
          placeholder: "例如：赛博东方城市里的雨夜茶馆。",
          placeholderEn: "Example: A rainy cyber-oriental teahouse at night.",
          multiline: true,
          required: true,
        },
        {
          key: "usage",
          label: "用途",
          labelEn: "Usage",
          placeholder: "例如：头像、海报、文章封面、小红书首图、产品概念图。",
          placeholderEn: "Example: avatar, poster, article cover, social post, product concept.",
        },
        {
          key: "style",
          label: "风格偏好",
          labelEn: "Style preference",
          placeholder: "例如：电影感、商业摄影、东方赛博、极简、胶片。",
          placeholderEn: "Example: cinematic, editorial photo, cyber-oriental, minimal, film look.",
        },
        {
          key: "constraints",
          label: "限制与禁忌",
          labelEn: "Constraints",
          placeholder: "例如：不要文字、避免恐怖元素、必须保留蓝绿色、适合方图。",
          placeholderEn: "Example: no text, avoid horror, keep teal tones, square format.",
          multiline: true,
        },
      ],
      nodes: [
        {
          id: "creative-brief",
          type: "ai",
          title: "生成创意简报",
          titleEn: "Build creative brief",
          description: "明确用途、受众、情绪、必须元素和避坑点。",
          descriptionEn: "Clarify usage, audience, mood, must-have elements, and constraints.",
          prompt: "你是资深视觉创意总监。请基于输入生成一份图片创作简报，必须包含：1.核心画面目标；2.目标受众与使用场景；3.情绪和叙事张力；4.必须出现的元素；5.必须避免的元素；6.推荐构图方向；7.最可能节约试错时间的判断。输出要具体，不要泛泛而谈。",
          promptEn: "Act as a senior visual creative director. Create an image production brief with: 1. core visual goal; 2. audience and usage context; 3. mood and narrative tension; 4. must-have elements; 5. avoid list; 6. recommended composition direction; 7. the judgment most likely to reduce iteration time. Be specific, not generic.",
        },
        {
          id: "visual-directions",
          type: "ai",
          title: "提出三套方向",
          titleEn: "Create three directions",
          description: "给出商业稳妥、电影叙事和实验吸睛三种方案。",
          descriptionEn: "Produce commercial-safe, cinematic-storytelling, and bold-experimental options.",
          prompt: "基于上面的创意简报，提出三套差异明显的视觉方向：A 商业稳妥版、B 电影叙事版、C 实验吸睛版。每套都写清：场景、主体、构图、光线、色彩、镜头/质感、为什么它适合这个用途、潜在风险。最后推荐最值得先生成的一套，并说明原因。",
          promptEn: "Based on the creative brief, propose three distinct directions: A commercial-safe, B cinematic-storytelling, C bold-experimental. For each, specify scene, subject, composition, lighting, palette, camera/texture, why it fits the usage, and risks. End by recommending the first direction to generate and why.",
        },
        {
          id: "prompt-pack",
          type: "ai",
          title: "打包最终 Prompt",
          titleEn: "Package final prompt",
          description: "把最佳方向整理为可直接生图的 Prompt 包。",
          descriptionEn: "Convert the best direction into a generation-ready prompt pack.",
          prompt: "请把推荐方向整理成图片模型可直接使用的最终 Prompt 包。必须严格使用以下字段名，并让 FINAL_PROMPT 自包含、具体、适合直接提交给图片模型。不要输出额外分析。\nFINAL_PROMPT:\nNEGATIVE_PROMPT:\nSTYLE_TAGS:\nCOMPOSITION_NOTES:\nMODEL_HINTS:\nREVISION_CHECKLIST:",
          promptEn: "Convert the recommended direction into a generation-ready image prompt pack. Use these exact field names, and make FINAL_PROMPT self-contained, specific, and ready to submit to an image model. Do not include extra analysis.\nFINAL_PROMPT:\nNEGATIVE_PROMPT:\nSTYLE_TAGS:\nCOMPOSITION_NOTES:\nMODEL_HINTS:\nREVISION_CHECKLIST:",
        },
        {
          id: "image",
          type: "image",
          title: "生成首版图片",
          titleEn: "Generate first image",
          description: "提取 FINAL_PROMPT 并调用图片生成接口。",
          descriptionEn: "Extract FINAL_PROMPT and call the image generation endpoint.",
        },
        {
          id: "save-note",
          type: "notes",
          title: "保存创作包",
          titleEn: "Save production package",
          description: "把简报、方向、Prompt 和生成结果保存到笔记。",
          descriptionEn: "Save the brief, directions, prompt, and generation result to Notes.",
        },
      ],
    },
    {
      id: "compare",
      name: "多模型对比流",
      nameEn: "Model comparison",
      description: "用当前聚合配置回答问题，再生成最终判断。",
      descriptionEn: "Answer with the active aggregation config, then produce a final judgment.",
      category: "模型评估",
      categoryEn: "Evaluation",
      inputs: [
        {
          key: "question",
          label: "问题",
          labelEn: "Question",
          placeholder: "输入你想让模型判断的问题。",
          placeholderEn: "Enter the question you want the model to judge.",
          multiline: true,
          required: true,
        },
      ],
      nodes: [
        {
          id: "answer",
          type: "ai",
          title: "模型回答",
          titleEn: "Model answer",
          description: "用当前模型配置生成第一版答案。",
          descriptionEn: "Generate the first answer with the current model config.",
          prompt: "请回答这个问题，要求给出结论、依据和不确定性。",
          promptEn: "Answer this question with conclusion, evidence, and uncertainty.",
        },
        {
          id: "review",
          type: "ai",
          title: "自我审查",
          titleEn: "Self review",
          description: "检查遗漏、反例和更稳妥的结论。",
          descriptionEn: "Check omissions, counterexamples, and a safer conclusion.",
          prompt: "请审查上面的回答，指出漏洞、反例、需要补充的信息，并给出更稳妥的最终版本。",
          promptEn: "Review the answer above, identify gaps, counterexamples, missing information, and provide a safer final version.",
        },
        {
          id: "chat",
          type: "chat",
          title: "交接到聊天",
          titleEn: "Handoff to chat",
          description: "生成可继续追问的聊天上下文。",
          descriptionEn: "Prepare a chat context for follow-up.",
        },
      ],
    },
    {
      id: "review",
      name: "每日复盘流",
      nameEn: "Daily review",
      description: "把一天的事件整理成收获、问题和下一步。",
      descriptionEn: "Turn daily events into wins, problems, and next steps.",
      category: "自我系统",
      categoryEn: "Self system",
      inputs: [
        {
          key: "day",
          label: "今天发生了什么",
          labelEn: "What happened today",
          placeholder: "随便写，流水账也可以。",
          placeholderEn: "Write freely, even as a rough log.",
          multiline: true,
          required: true,
        },
      ],
      nodes: [
        {
          id: "classify",
          type: "ai",
          title: "分类复盘",
          titleEn: "Classify review",
          description: "整理成事实、情绪、问题和收获。",
          descriptionEn: "Organize into facts, emotions, problems, and wins.",
          prompt: "请把这段日常记录整理成：事实、情绪、收获、问题、明天最重要的一件事。",
          promptEn: "Organize this daily log into: facts, emotions, wins, problems, and tomorrow's most important task.",
        },
        {
          id: "save-note",
          type: "notes",
          title: "保存复盘",
          titleEn: "Save review",
          description: "保存为本地复盘笔记。",
          descriptionEn: "Save as a local review note.",
        },
      ],
    },
  ];
}
</script>
