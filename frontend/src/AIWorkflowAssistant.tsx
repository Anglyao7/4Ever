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
1. 工作流必须从手动触发节点开始
2. 节点之间的连接要符合逻辑（输出连接到输入）
3. 只能使用上方可用节点，不能编造发布、知识库、日程、通知、邮箱、云盘、Webhook、表格等系统不存在的接口
4. HTTP/API 调用已经内置在具体节点里，不要生成 http-request、mcp-tool 或类似的单独请求节点
5. 尽量简洁，优先围绕笔记、聊天、虚实、中枢、Token、地图和秩序模块组合

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
    "检索笔记后让 AI 整理摘要，并保存到当前笔记",
    "读取和某个联系人的会话，让 AI 整理回复，然后发送消息",
    "生成一张图片，然后作为附件发送给联系人",
    "测试中枢模型接口，再获取模型列表",
    "读取地图记忆和 Token 统计，整理后送入秩序",
    "新增一条笔记，然后保存内容并导出 Markdown",
  ];

  return (
    <div className="ai-workflow-assistant">
      <div className="ai-assistant-header">
        <div className="ai-assistant-title">
          <Bot size={20} />
          <div>
            <strong>AI 工作流助手</strong>
            <small>描述目标，生成节点</small>
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
            <strong>输入一个目标</strong>
            <div className="ai-quick-prompts">
              <small>示例</small>
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
          <span>请先在中枢配置 AI 模型</span>
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
