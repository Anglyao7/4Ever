// 工作流画布节点类型定义

export type NodeType =
  | "trigger"           // 触发器
  | "ai-chat"          // AI 对话
  | "image-gen"        // 图片生成
  | "send-message"     // 发送消息
  | "http-request"     // HTTP 请求
  | "provider-models"  // 获取接口模型
  | "api-health"       // 接口健康检查
  | "webhook-ingress"  // Webhook 入口
  | "token-usage"      // Token 用量
  | "memory-map"       // 地图记忆
  | "chat-thread"      // 会话线程
  | "contact-profile"  // 联系人档案
  | "calendar-event"   // 日程事件
  | "notification-send" // 通知发送
  | "database-query"   // 数据库查询
  | "image-studio"     // 绘影接口
  | "notes-query"      // 笔记读取
  | "knowledge-search" // 知识检索
  | "file-asset"       // 文件资产
  | "email-inbox"      // 邮件收件箱
  | "cloud-drive"      // 云盘文件
  | "sheet-row"        // 表格数据
  | "module-catalog"   // 模块目录
  | "mcp-tool"         // MCP 工具
  | "admin-audit"      // 管理审计
  | "cms-publish"      // 内容发布
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
