// 工作流画布节点类型定义

export type NodeType =
  | "trigger"           // 触发器
  | "ai-chat"          // AI 对话
  | "image-gen"        // 图片生成
  | "send-message"     // 发送消息
  | "send-attachment"  // 发送附件
  | "provider-models"  // 获取接口模型
  | "api-health"       // 接口健康检查
  | "token-usage"      // Token 用量
  | "memory-map"       // 地图记忆
  | "chat-thread"      // 会话线程
  | "notes-query"      // 笔记读取
  | "agent-run"        // 秩序 Agent
  | "note-create"      // 创建笔记
  | "note-save"        // 保存笔记
  | "note-delete"      // 删除笔记
  | "note-export";     // 导出笔记

export type NodePosition = {
  x: number;
  y: number;
};

export type NodeConnection = {
  id: string;
  sourceNodeId: string;
  sourceHandle: string;
  targetNodeId: string;
  targetHandle: string;
};

export type NodeConfig = {
  [key: string]: any;
};

export type NodeRuntimeBinding = {
  kind: "api" | "local";
  label: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  path?: string;
  action?: string;
};

export type WorkflowNode = {
  id: string;
  type: NodeType;
  label: string;
  position: NodePosition;
  config: NodeConfig;
  runtime?: NodeRuntimeBinding;
  inputs: string[];   // 输入端口
  outputs: string[];  // 输出端口
};

export type WorkflowCanvas = {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  connections: NodeConnection[];
  createdAt: string;
  updatedAt: string;
};

export type NodeTemplate = {
  type: NodeType;
  label: string;
  icon: string;
  category: "trigger" | "action" | "logic" | "data";
  description: string;
  defaultConfig: NodeConfig;
  runtime?: NodeRuntimeBinding;
  inputs: string[];
  outputs: string[];
  color: string;
};
