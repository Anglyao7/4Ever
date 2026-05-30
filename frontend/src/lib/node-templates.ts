import type { NodeTemplate } from "../types/workflow-canvas";

export const nodeTemplates: NodeTemplate[] = [
  // 触发器类
  {
    type: "trigger",
    label: "手动触发",
    icon: "⚡",
    category: "trigger",
    description: "手动启动工作流",
    defaultConfig: {},
    inputs: [],
    outputs: ["output"],
    color: "#967739",
  },
  {
    type: "workflow-trigger",
    label: "定时触发",
    icon: "⏰",
    category: "trigger",
    description: "按计划自动执行",
    defaultConfig: { schedule: "0 9 * * *" },
    inputs: [],
    outputs: ["output"],
    color: "#967739",
  },

  // AI 动作类
  {
    type: "ai-chat",
    label: "AI 对话",
    icon: "🤖",
    category: "action",
    description: "调用 AI 模型生成回复",
    defaultConfig: {
      prompt: "",
      model: "",
      temperature: 0.7,
    },
    inputs: ["input", "context"],
    outputs: ["response", "tokens"],
    color: "#2d6f63",
  },
  {
    type: "image-gen",
    label: "生成图片",
    icon: "🎨",
    category: "action",
    description: "使用 AI 生成图片",
    defaultConfig: {
      prompt: "",
      size: "1024x1024",
      quality: "standard",
    },
    inputs: ["prompt"],
    outputs: ["image_url", "revised_prompt"],
    color: "#315f9b",
  },

  // 消息动作类
  {
    type: "send-message",
    label: "发送消息",
    icon: "💬",
    category: "action",
    description: "发送消息给指定用户",
    defaultConfig: {
      recipient: "",
      message: "",
    },
    inputs: ["recipient", "content", "attachments"],
    outputs: ["success", "message_id"],
    color: "#b45b42",
  },

  // HTTP 请求
  {
    type: "http-request",
    label: "HTTP 请求",
    icon: "🌐",
    category: "action",
    description: "发送 HTTP 请求",
    defaultConfig: {
      method: "GET",
      url: "",
      headers: {},
      body: "",
    },
    inputs: ["url", "params"],
    outputs: ["response", "status", "error"],
    color: "#65706b",
  },
  {
    type: "provider-models",
    label: "获取模型列表",
    icon: "🔌",
    category: "action",
    description: "读取接口中枢当前 API 支持的模型",
    defaultConfig: {
      provider: "openai",
      baseUrl: "",
    },
    inputs: ["api_config"],
    outputs: ["models", "selected_model"],
    color: "#2d6f63",
  },
  {
    type: "token-usage",
    label: "Token 统计",
    icon: "📈",
    category: "data",
    description: "读取 Token 统计概览、趋势或排行数据",
    defaultConfig: {
      range: "30d",
      view: "overview",
    },
    inputs: ["range"],
    outputs: ["overview", "trend", "rankings"],
    color: "#315f9b",
  },
  {
    type: "chat-thread",
    label: "会话线程",
    icon: "💬",
    category: "data",
    description: "读取交耳里的 AI 或联系人会话上下文",
    defaultConfig: {
      mode: "active_thread",
      limit: 20,
    },
    inputs: ["query", "user"],
    outputs: ["messages", "summary"],
    color: "#315f9b",
  },
  {
    type: "image-studio",
    label: "绘影接口",
    icon: "🖼️",
    category: "action",
    description: "把提示词送入绘影生成图片或读取最近图片结果",
    defaultConfig: {
      size: "1024x1024",
      count: 1,
    },
    inputs: ["prompt", "style"],
    outputs: ["image_url", "metadata"],
    color: "#315f9b",
  },
  {
    type: "notes-query",
    label: "笔记检索",
    icon: "📚",
    category: "data",
    description: "从笔记模块读取标题、正文或标签线索",
    defaultConfig: {
      query: "",
      limit: 5,
    },
    inputs: ["query"],
    outputs: ["notes", "excerpt"],
    color: "#65706b",
  },
  {
    type: "module-catalog",
    label: "系统模块",
    icon: "🧩",
    category: "data",
    description: "读取当前可用模块、入口和模块启用状态",
    defaultConfig: {
      includeDisabled: false,
    },
    inputs: ["filter"],
    outputs: ["modules", "routes"],
    color: "#65706b",
  },
  {
    type: "mcp-tool",
    label: "MCP 工具",
    icon: "🛠️",
    category: "action",
    description: "选择秩序模块可用 MCP Server 和工具执行",
    defaultConfig: {
      serverId: "bigmodel-web-search",
      toolName: "webSearchPrime",
    },
    inputs: ["arguments", "context"],
    outputs: ["result", "status"],
    color: "#2d6f63",
  },
  {
    type: "admin-audit",
    label: "管理审计",
    icon: "🛡️",
    category: "data",
    description: "读取管理员端策略、模块开关和执行审计线索",
    defaultConfig: {
      scope: "workflow",
    },
    inputs: ["run_id", "scope"],
    outputs: ["policy", "audit"],
    color: "#967739",
  },
  {
    type: "memory-map",
    label: "地图记忆",
    icon: "🗺️",
    category: "data",
    description: "读取或写入城市、地点和记忆线索",
    defaultConfig: {
      city: "",
      query: "",
    },
    inputs: ["city", "memory"],
    outputs: ["places", "memory_card"],
    color: "#65706b",
  },
  {
    type: "agent-run",
    label: "秩序 Agent",
    icon: "🧭",
    category: "action",
    description: "把当前内容交给秩序模块的 Agent / MCP 流程",
    defaultConfig: {
      agentId: "researcher",
      mcpServers: [],
    },
    inputs: ["task", "context"],
    outputs: ["run_id", "summary", "status"],
    color: "#b45b42",
  },

  // 逻辑控制
  {
    type: "condition",
    label: "条件判断",
    icon: "🔀",
    category: "logic",
    description: "根据条件分支执行",
    defaultConfig: {
      condition: "",
      operator: "equals",
    },
    inputs: ["input"],
    outputs: ["true", "false"],
    color: "#967739",
  },
  {
    type: "loop",
    label: "循环",
    icon: "🔁",
    category: "logic",
    description: "遍历数组或重复执行",
    defaultConfig: {
      items: [],
      maxIterations: 100,
    },
    inputs: ["items"],
    outputs: ["item", "index", "done"],
    color: "#967739",
  },
  {
    type: "delay",
    label: "延迟",
    icon: "⏱️",
    category: "logic",
    description: "等待指定时间",
    defaultConfig: {
      duration: 1000,
      unit: "ms",
    },
    inputs: ["input"],
    outputs: ["output"],
    color: "#967739",
  },

  // 数据处理
  {
    type: "transform",
    label: "数据转换",
    icon: "🔧",
    category: "data",
    description: "转换或处理数据",
    defaultConfig: {
      script: "return input;",
    },
    inputs: ["input"],
    outputs: ["output"],
    color: "#65706b",
  },
  {
    type: "note-create",
    label: "创建笔记",
    icon: "📝",
    category: "action",
    description: "保存内容到笔记",
    defaultConfig: {
      title: "",
      content: "",
    },
    inputs: ["title", "content"],
    outputs: ["note_id"],
    color: "#2d6f63",
  },
];

export function getNodeTemplate(type: string): NodeTemplate | undefined {
  return nodeTemplates.find((t) => t.type === type);
}

export function getNodesByCategory(category: string): NodeTemplate[] {
  return nodeTemplates.filter((t) => t.category === category);
}
