<template>
  <section class="workflow-panel" :aria-label="copy.title">
    <div class="module-view-header">
      <div>
        <p class="eyebrow">Automation</p>
        <h1>{{ copy.title }}</h1>
      </div>
      <button class="primary-action compact" type="button" :disabled="running || !canRun" @click="runWorkflow">
        <LoaderCircle v-if="running" :size="17" class="spin" />
        <Play v-else :size="17" />
        <span>{{ running ? copy.running : copy.run }}</span>
      </button>
    </div>

    <div class="workflow-workspace">
      <aside class="workflow-sidebar" :aria-label="copy.templates">
        <div class="panel-heading compact">
          <div>
            <p class="eyebrow">Templates</p>
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
              {{ activeTemplate.nodes.length }} {{ copy.steps }}
            </span>
            <span>
              <History :size="16" />
              {{ runs.length }} {{ copy.runs }}
            </span>
          </div>
        </div>

        <div class="workflow-grid">
          <form class="workflow-input-card" @submit.prevent="runWorkflow">
            <div class="panel-heading compact">
              <div>
                <p class="eyebrow">Input</p>
                <h2>{{ copy.input }}</h2>
              </div>
            </div>

            <label v-for="field in activeTemplate.inputs" :key="field.key" class="workflow-field">
              <span>{{ fieldLabel(field) }}</span>
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
                <p class="eyebrow">Flow</p>
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
                <component :is="nodeIcon(node.type)" :size="17" />
              </article>
            </div>
          </div>
        </div>

        <section class="workflow-history-card" :aria-label="copy.history">
          <div class="panel-heading compact">
            <div>
              <p class="eyebrow">Runs</p>
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
              :class="run.status"
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
  FileText,
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
import type { ChatConfig, ChatMessage, ModelProfile } from "../types/chat";
import type { ImageGenerationConfig } from "../types/images";
import type { WorkflowInputField, WorkflowNode, WorkflowNodeType, WorkflowRun, WorkflowTemplate } from "../types/workflow";

const props = defineProps<{
  backendOnline: boolean;
  profiles: ModelProfile[];
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
const imageConfigStorageKey = "4ever.image.config";
const defaultImageConfig: ImageGenerationConfig = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-image-1",
  size: "1024x1024",
  prompt: "",
};

const templates = workflowTemplates();
const activeTemplateId = ref(localStorage.getItem(workflowStorageKey) ?? templates[0].id);
const inputValues = reactive<Record<string, string>>({});
const runs = ref<WorkflowRun[]>(loadRuns());
const selectedRunId = ref(runs.value[0]?.id ?? "");
const running = ref(false);
const error = ref("");

const copy = computed(() =>
  props.language === "en-US"
    ? {
        title: "Automation",
        templates: "Workflow templates",
        detail: "Workflow detail",
        input: "Run input",
        steps: "steps",
        runs: "runs",
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
      }
    : {
        title: "秩序",
        templates: "工作流模板",
        detail: "工作流详情",
        input: "运行输入",
        steps: "步",
        runs: "次运行",
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
      },
);

const activeTemplate = computed(() => templates.find((template) => template.id === activeTemplateId.value) ?? templates[0]);
const selectedRun = computed(() => runs.value.find((run) => run.id === selectedRunId.value));
const selectedNodeOutputs = computed(() => new Map(selectedRun.value?.nodeResults.map((result) => [result.nodeId, result.output]) ?? []));
const nextPendingNodeId = computed(() => activeTemplate.value.nodes.find((node) => !selectedNodeOutputs.value.has(node.id))?.id ?? "");
const timeFormatter = computed(() => new Intl.DateTimeFormat(props.language === "en-US" ? "en-US" : "zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
}));
const canRun = computed(() => activeTemplate.value.inputs.every((field) => !field.required || inputValues[field.key]?.trim()));

watch(activeTemplateId, (value) => {
  localStorage.setItem(workflowStorageKey, value);
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
  if (!props.backendOnline && activeTemplate.value.nodes.some((node) => node.type === "ai" || node.type === "image")) {
    error.value = copy.value.backendOffline;
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
      const output = await executeNode(node, context, run.input);
      context = `${context}\n\n[${nodeTitle(node)}]\n${output}`;
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
  const response = await sendChat(resolveChatConfig(), messages);
  return response.content;
}

async function runImageNode(context: string) {
  const prompt = context.slice(-1800);
  const response = await generateImage({ ...loadImageConfig(), prompt });
  return `${copy.value.imageQueued}\n${response.message}`;
}

function saveNote(node: WorkflowNode, context: string, input: Record<string, string>) {
  const notes = loadNotes();
  const now = new Date().toISOString();
  const titleSource = input.topic || input.title || input.question || templateName(activeTemplate.value);
  const note: LocalNoteDraft = {
    id: crypto.randomUUID(),
    title: `${templateName(activeTemplate.value)}：${titleSource.slice(0, 28)}`,
    content: `# ${titleSource}\n\n${context}`,
    updatedAt: now,
  };
  localStorage.setItem(notesStorageKey, JSON.stringify([note, ...notes].slice(0, 50)));
  return `${copy.value.savedNote}\n${nodeTitle(node)}：${note.title}`;
}

function resolveChatConfig() {
  return props.currentConfig;
}

function resetInputs() {
  for (const key of Object.keys(inputValues)) {
    delete inputValues[key];
  }
  for (const field of activeTemplate.value.inputs) {
    inputValues[field.key] = "";
  }
}

function selectRun(runId: string) {
  const run = runs.value.find((item) => item.id === runId);
  if (!run) {
    return;
  }
  activeTemplateId.value = run.workflowId;
  selectedRunId.value = runId;
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
  localStorage.setItem(workflowRunsStorageKey, JSON.stringify(runs.value.slice(0, 20)));
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
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
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
    input: FileText,
    ai: Bot,
    transform: Sparkles,
    condition: GitBranch,
    notes: NotebookPen,
    image: ImagePlus,
    chat: MessageSquareText,
    output: CheckCircle2,
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
      name: "图片创作流",
      nameEn: "Image creation",
      description: "把想法扩写成图片 prompt，并提交给图片生成模块。",
      descriptionEn: "Expand an idea into an image prompt and submit it to image generation.",
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
      ],
      nodes: [
        {
          id: "prompt",
          type: "ai",
          title: "扩写 Prompt",
          titleEn: "Expand prompt",
          description: "生成可直接用于图片模型的描述。",
          descriptionEn: "Create a prompt ready for an image model.",
          prompt: "请把这个画面想法扩写成高质量图片生成 prompt，包含主体、场景、光线、镜头、风格和负面约束。",
          promptEn: "Expand this image idea into a high-quality image prompt with subject, scene, lighting, camera, style, and negative constraints.",
        },
        {
          id: "image",
          type: "image",
          title: "提交生图",
          titleEn: "Submit image",
          description: "调用图片生成接口。",
          descriptionEn: "Call the image generation endpoint.",
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
