import { useMemo, useState } from "react";
import { Bot, SendHorizonal, Settings } from "lucide-react";
import { sendChat } from "./services/api";
import type { ChatConfig, ChatMessage, ModelProfile } from "./types/chat";

const profilesKey = "4ever.model.profiles";
const activeProfileKey = "4ever.model.activeProfile";
const messagesKey = "4ever.react.chat.messages";

export default function ChatPanel() {
  const [profiles] = useState<ModelProfile[]>(loadProfiles);
  const [activeProfileId, setActiveProfileId] = useState(() => localStorage.getItem(activeProfileKey) ?? profiles[0]?.id ?? "");
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const activeProfile = useMemo(() => profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0], [activeProfileId, profiles]);

  function commitMessages(nextMessages: ChatMessage[]) {
    setMessages(nextMessages);
    localStorage.setItem(messagesKey, JSON.stringify(nextMessages));
  }

  async function submit() {
    const content = draft.trim();
    if (!content || !activeProfile || sending) return;
    const userMessage: ChatMessage = { id: `msg-${Date.now()}`, role: "user", content, createdAt: new Date().toISOString() };
    const pendingMessages = [...messages, userMessage];
    commitMessages(pendingMessages);
    setDraft("");
    setSending(true);
    setError("");
    try {
      const response = await sendChat(configFromProfile(activeProfile), pendingMessages);
      commitMessages([...pendingMessages, { id: `msg-${Date.now()}-ai`, role: "assistant", content: response.content, createdAt: new Date().toISOString() }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="react-chat-panel">
      <div className="module-view-header chat-view-header">
        <div><p className="eyebrow">Chat</p><h1>交耳</h1></div>
        <div className="chat-header-actions">
          <select value={activeProfile?.id ?? ""} onChange={(event) => {
            setActiveProfileId(event.target.value);
            localStorage.setItem(activeProfileKey, event.target.value);
          }}>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}
          </select>
        </div>
      </div>
      <div className="react-chat-shell">
        <aside className="react-chat-sidebar">
          <Bot size={22} />
          <strong>{activeProfile?.name ?? "未配置 API"}</strong>
          <p>{activeProfile ? `${activeProfile.provider} · ${activeProfile.model}` : "请先到接口中枢创建 API 配置。"}</p>
          <span><Settings size={14} /> 使用接口中枢的当前模型配置</span>
        </aside>
        <article className="react-chat-surface">
          <div className="react-message-list">
            {messages.map((message) => <div key={message.id} className={`react-message ${message.role}`}><p>{message.content}</p><small>{message.role === "user" ? "我" : activeProfile?.name ?? "AI"}</small></div>)}
            {!messages.length && <div className="react-empty-line">开始一段对话。</div>}
          </div>
          {error && <p className="react-error-line">{error}</p>}
          <div className="react-composer">
            <textarea value={draft} placeholder={activeProfile ? "输入消息..." : "请先配置 API"} disabled={!activeProfile || sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }} />
            <button className="primary-action compact" type="button" disabled={!draft.trim() || !activeProfile || sending} onClick={submit}><SendHorizonal size={16} /><span>{sending ? "发送中" : "发送"}</span></button>
          </div>
        </article>
      </div>
    </section>
  );
}

function loadProfiles(): ModelProfile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(profilesKey) ?? "[]") as ModelProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadMessages(): ChatMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(messagesKey) ?? "[]") as ChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function configFromProfile(profile: ModelProfile): ChatConfig {
  return {
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    systemPrompt: profile.systemPrompt ?? "",
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
  };
}
