// 工作流画布节点类型定义

export type NodeType =
  | "trigger"           // 触发器
  | "ai-chat"          // AI 对话
  | "image-gen"        // 图片生成
  | "send-message"     // 发送消息
  | "http-request"     // HTTP 请求
  | "provider-models"  // 获取接口模型
  | "token-usage"      // Token 用量
  | "memory-map"       // 地图记忆
  | "agent-run"        // 秩序 Agent
  | "condition"        // 条件判断
  | "loop"             // 循环
  | "delay"            // 延迟
  | "transform"        // 数据转换
  | "note-create"      // 创建笔记
  | "workflow-trigger"; // 触发工作流

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

export type WorkflowNode = {
  id: string;
  type: NodeType;
  label: string;
  position: NodePosition;
  config: NodeConfig;
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
  inputs: string[];
  outputs: string[];
  color: string;
};
