import { useState, useRef, useEffect } from "react";
import { Bot, Send, Sparkles, Wand2, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { sendChat } from "./services/api";
import { nodeTemplates } from "./lib/node-templates";
import type { ChatMessage, ModelProfile } from "./types/chat";
import type { NodeConnection, WorkflowNode, NodePosition } from "./types/workflow-canvas";

const profilesKey = "4ever.model.profiles";
const activeProfileKey = "4ever.model.activeProfile";

type AIAssistantProps = {
  onGenerateWorkflow: (nodes: WorkflowNode[], connections?: NodeConnection[]) => void;
};

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

export default function AIWorkflowAssistant({ onGenerateWorkflow }: AIAssistantProps) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [profiles] = useState<ModelProfile[]>(loadProfiles);
  const activeProfile = profiles.find((p) => p.id === readLocalStorage(activeProfileKey)) || profiles[0];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 构建系统提示词
  const buildSystemPrompt = () => {
    const nodeDescriptions = nodeTemplates.map((node) =>
      `- ${node.label} (${node.type}): ${node.description}\n  输入: ${node.inputs.join(", ") || "无"}\n  输出: ${node.outputs.join(", ") || "无"}`
    ).join("\n");

    return `你是一个 AI 工作流设计助手。用户会描述他们想要实现的功能，你需要根据可用的节点设计出合理的工作流。

可用节点列表：
${nodeDescriptions}

设计原则：
1. 工作流必须从触发器节点开始（手动触发或定时触发）
2. 节点之间的连接要符合逻辑（输出连接到输入）
3. 尽量简洁，避免不必要的节点
4. 考虑错误处理和边界情况

当用户描述需求后，你需要：
1. 理解用户的核心需求
2. 设计合理的节点流程
3. 用 JSON 格式返回工作流定义

JSON 格式示例：
\`\`\`json
{
  "nodes": [
    {
      "type": "trigger",
      "label": "手动触发",
      "config": {}
    },
    {
      "type": "ai-chat",
      "label": "AI 对话",
      "config": {
        "prompt": "生成一个创意标题"
      }
    },
    {
      "type": "note-create",
      "label": "创建笔记",
      "config": {
        "title": "AI 生成的标题"
      }
    }
  ],
  "connections": [
    { "from": 0, "output": "output", "to": 1, "input": "input" },
    { "from": 1, "output": "response", "to": 2, "input": "content" }
  ],
  "explanation": "这个工作流会先手动触发，然后调用 AI 生成创意标题，最后保存到笔记"
}
\`\`\`

请用中文回复，并在回复中包含 JSON 工作流定义。`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading || !activeProfile) return;

    const userMessage: AssistantMessage = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setError("");

    try {
      const chatMessages: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt() },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: input.trim() },
      ];

      const response = await sendChat(
        {
          provider: activeProfile.provider,
          baseUrl: activeProfile.baseUrl,
          apiKey: activeProfile.apiKey,
          model: activeProfile.model,
          systemPrompt: "",
          temperature: 0.7,
          maxTokens: 4000,
        },
        chatMessages
      );

      const assistantMessage: AssistantMessage = {
        id: `msg_${Date.now()}`,
        role: "assistant",
        content: response.content,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // 尝试解析 JSON 并生成工作流
      const jsonMatch = response.content.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const workflowData = JSON.parse(jsonMatch[1]);
          if (workflowData.nodes && Array.isArray(workflowData.nodes)) {
            generateWorkflowFromAI(workflowData.nodes, Array.isArray(workflowData.connections) ? workflowData.connections : []);
          }
        } catch (parseError) {
          console.error("Failed to parse workflow JSON:", parseError);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 请求失败");
      const errorMessage: AssistantMessage = {
        id: `msg_${Date.now()}`,
        role: "assistant",
        content: `抱歉，遇到了错误：${cause instanceof Error ? cause.message : "未知错误"}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const generateWorkflowFromAI = (aiNodes: any[], aiConnections: any[]) => {
    const nodes: WorkflowNode[] = aiNodes.map((aiNode, index) => {
      const template = nodeTemplates.find((t) => t.type === aiNode.type);
      if (!template) {
        console.warn(`Unknown node type: ${aiNode.type}`);
        return null;
      }

      const position: NodePosition = {
        x: 150 + index * 280,
        y: 200,
      };

      return {
        id: `node_${Date.now()}_${index}`,
        type: template.type,
        label: aiNode.label || template.label,
        position,
        config: { ...template.defaultConfig, ...aiNode.config },
        inputs: [...template.inputs],
        outputs: [...template.outputs],
      };
    }).filter((node): node is WorkflowNode => node !== null);

    if (nodes.length > 0) {
      onGenerateWorkflow(nodes, normalizeAIConnections(nodes, aiConnections));
    }
  };

  const quickPrompts = [
    "帮我做一个每天早上 9 点自动发送天气预报的工作流",
    "创建一个工作流：用 AI 生成图片描述，然后生成图片，最后发送给我",
    "读取接口中枢的模型列表，选择一个模型后总结 Token 使用情况",
    "把地图记忆里的城市线索整理成一份行动计划，再交给秩序 Agent",
    "设计一个工作流：定时获取新闻，用 AI 总结，保存到笔记",
    "做一个循环处理任务列表的工作流",
  ];

  return (
    <div className="ai-workflow-assistant">
      <div className="ai-assistant-header">
        <div className="ai-assistant-title">
          <Bot size={20} />
          <div>
            <strong>AI 工作流助手</strong>
            <small>描述你的需求，AI 帮你设计工作流</small>
          </div>
        </div>
        {activeProfile && (
          <span className="ai-assistant-model">
            {activeProfile.name || activeProfile.model}
          </span>
        )}
      </div>

      <div className="ai-assistant-messages">
        {messages.length === 0 && (
          <div className="ai-assistant-welcome">
            <Sparkles size={48} />
            <strong>告诉我你想做什么</strong>
            <p>我会根据你的需求自动设计工作流，并在画布上创建节点</p>
            <div className="ai-quick-prompts">
              <small>快速开始：</small>
              {quickPrompts.map((prompt, index) => (
                <button
                  key={index}
                  className="ai-quick-prompt-btn"
                  onClick={() => setInput(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`ai-assistant-message ${message.role}`}
          >
            <div className="ai-message-avatar">
              {message.role === "user" ? "👤" : "🤖"}
            </div>
            <div className="ai-message-content">
              <div className="ai-message-text">{message.content}</div>
              <small className="ai-message-time">
                {new Date(message.timestamp).toLocaleTimeString()}
              </small>
            </div>
          </div>
        ))}

        {loading && (
          <div className="ai-assistant-message assistant">
            <div className="ai-message-avatar">🤖</div>
            <div className="ai-message-content">
              <div className="ai-message-loading">
                <Loader2 size={16} className="spinning" />
                <span>正在设计工作流...</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="ai-assistant-error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="ai-assistant-input" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="描述你想要的工作流..."
          disabled={loading || !activeProfile}
        />
        <button
          type="submit"
          className="ai-assistant-send"
          disabled={!input.trim() || loading || !activeProfile}
        >
          {loading ? <Loader2 size={18} className="spinning" /> : <Send size={18} />}
        </button>
      </form>

      {!activeProfile && (
        <div className="ai-assistant-notice">
          <AlertCircle size={16} />
          <span>请先在接口中枢配置 AI 模型</span>
        </div>
      )}
    </div>
  );
}

function normalizeAIConnections(nodes: WorkflowNode[], aiConnections: any[]): NodeConnection[] {
  const parsed = aiConnections
    .map((connection, index) => {
      const sourceIndex = Number(connection?.from);
      const targetIndex = Number(connection?.to);
      const source = nodes[sourceIndex];
      const target = nodes[targetIndex];
      if (!source || !target || source.id === target.id) return null;
      return {
        id: `conn_${Date.now()}_${index}`,
        sourceNodeId: source.id,
        sourceHandle: String(connection?.output || source.outputs[0] || "output"),
        targetNodeId: target.id,
        targetHandle: String(connection?.input || target.inputs[0] || "input"),
      } satisfies NodeConnection;
    })
    .filter((connection): connection is NodeConnection => Boolean(connection));
  if (parsed.length) return parsed;
  return nodes.slice(0, -1).map((node, index) => {
    const target = nodes[index + 1];
    return {
      id: `conn_${Date.now()}_${index}`,
      sourceNodeId: node.id,
      sourceHandle: node.outputs[0] || "output",
      targetNodeId: target.id,
      targetHandle: target.inputs[0] || "input",
    };
  });
}

function loadProfiles(): ModelProfile[] {
  try {
    const stored = localStorage.getItem(profilesKey);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
