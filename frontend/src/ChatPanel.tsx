import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Download, FileText, LogIn, MessageSquareText, Paperclip, Search, SendHorizonal, Settings, UserPlus, X } from "lucide-react";
import {
  acceptFriendRequest,
  fetchDirectMessages,
  fetchFriendSummary,
  rejectFriendRequest,
  requestFriend,
  searchUsers,
  sendChat,
  sendDirectMessage,
} from "./services/api";
import { resolveMediaUrl } from "./services/api";
import type { AuthUser, UserSearchResult } from "./types/auth";
import type { ChatAttachment, ChatConfig, ChatMessage, DirectAttachment, DirectMessageRecord, FriendProfile, FriendSummary, ModelProfile } from "./types/chat";

const profilesKey = "4ever.model.profiles";
const activeProfileKey = "4ever.model.activeProfile";
const messagesKey = "4ever.react.chat.messages";
const aiMessagesStorageError = "AI 会话保存失败，请检查浏览器存储空间后再继续发送。";

type ChatMode = "people" | "ai";
type UiLanguage = "zh" | "en";
type DirectMessageView = DirectMessageRecord & {
  local_id?: string;
  local_status?: "sending" | "failed";
  local_error?: string;
  local_payload?: {
    content: string;
    attachments: ChatAttachment[];
  };
};

const copy = {
  zh: {
    title: "交耳",
    subtitle: "真实用户好友与私聊",
    people: "好友",
    ai: "AI 会话",
    loginRequired: "登录后可以搜索真实用户、添加好友并私聊。",
    searchPlaceholder: "搜索用户名 / 邮箱 / 昵称",
    friends: "好友列表",
    requests: "好友请求",
    outgoing: "已发送",
    noFriends: "还没有好友，先搜索用户添加。",
    searchingUsers: "正在搜索用户...",
    noSearchResults: "没有找到匹配用户。",
    noConversation: "选择一个好友开始聊天。",
    loadingPeople: "正在同步好友与请求...",
    messagePlaceholder: "输入消息...",
    send: "发送",
    sending: "发送中",
    actionPending: "处理中",
    pendingAttachment: "待发送",
    sendFailed: "发送失败",
    retry: "重试",
    restore: "恢复编辑",
    maxAttachments: "最多一次发送 4 个附件。",
    addFriend: "加好友",
    friendAdded: "已是好友",
    requested: "已申请",
    accept: "同意",
    reject: "拒绝",
    aiIntro: "使用接口中枢的当前模型配置",
    unavailableAi: "全局 AI 暂不可用",
    configureModel: "去接口中枢配置",
    modelRequired: "需要先在接口中枢配置全局模型，聊天不会在这里单独输入 Key。",
    startAi: "开始一段 AI 对话。",
    typing: "正在组织回复...",
  },
  en: {
    title: "Conversations",
    subtitle: "Friends and direct messages",
    people: "People",
    ai: "AI Chat",
    loginRequired: "Sign in to search real users, add friends, and send direct messages.",
    searchPlaceholder: "Search username / email / name",
    friends: "Friends",
    requests: "Requests",
    outgoing: "Sent",
    noFriends: "No friends yet. Search for a user to add one.",
    searchingUsers: "Searching users...",
    noSearchResults: "No matching users found.",
    noConversation: "Pick a friend to start chatting.",
    loadingPeople: "Syncing friends and requests...",
    messagePlaceholder: "Type a message...",
    send: "Send",
    sending: "Sending",
    actionPending: "Working",
    pendingAttachment: "Pending",
    sendFailed: "Failed",
    retry: "Retry",
    restore: "Edit",
    maxAttachments: "Send up to 4 attachments at a time.",
    addFriend: "Add",
    friendAdded: "Friend",
    requested: "Requested",
    accept: "Accept",
    reject: "Reject",
    aiIntro: "Using the active provider profile",
    unavailableAi: "Global AI unavailable",
    configureModel: "Open Provider Hub",
    modelRequired: "Configure the global model in Provider Hub first. Chat does not collect API keys here.",
    startAi: "Start an AI conversation.",
    typing: "Composing reply...",
  },
};

export default function ChatPanel(props: { authToken: string; currentUser: AuthUser | null; language?: UiLanguage }) {
  const language = props.language ?? "zh";
  const t = copy[language];
  const [mode, setMode] = useState<ChatMode>("ai");
  const [summary, setSummary] = useState<FriendSummary>(() => ({ friends: [], incoming_requests: [], outgoing_requests: [] }));
  const [selectedFriendId, setSelectedFriendId] = useState("");
  const [directMessages, setDirectMessages] = useState<DirectMessageView[]>([]);
  const [directDraft, setDirectDraft] = useState("");
  const [directAttachments, setDirectAttachments] = useState<ChatAttachment[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<DirectAttachment | null>(null);
  const [directSending, setDirectSending] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleAction, setPeopleAction] = useState("");
  const [retryingLocalId, setRetryingLocalId] = useState("");
  const [peopleError, setPeopleError] = useState("");
  const [conversationError, setConversationError] = useState("");
  const [profiles] = useState<ModelProfile[]>(loadProfiles);
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const directListRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeProfile = useMemo(() => activeUsableProfile(profiles), [profiles]);
  const selectedFriend = summary.friends.find((friend) => friend.user.id === selectedFriendId)?.user ?? null;
  const outgoingIds = new Set(summary.outgoing_requests.map((request) => request.addressee.id));
  const friendIds = new Set(summary.friends.map((friend) => friend.user.id));

  useEffect(() => {
    if (!props.authToken) {
      setSummary({ friends: [], incoming_requests: [], outgoing_requests: [] });
      setSelectedFriendId("");
      resetDirectComposer();
      setDirectMessages([]);
      setConversationError("");
      setPeopleAction("");
      setRetryingLocalId("");
      return;
    }
    refreshFriends();
  }, [props.authToken]);

  useEffect(() => {
    resetDirectComposer();
    setConversationError("");
  }, [props.currentUser?.id, selectedFriendId]);

  useEffect(() => {
    if (!selectedFriendId || !props.authToken) {
      setDirectMessages([]);
      return;
    }
    fetchDirectMessages(props.authToken, selectedFriendId).then((records) => {
      setDirectMessages((current) => mergeDirectMessages(records, current, selectedFriendId, props.currentUser?.id ?? ""));
      setConversationError("");
    }).catch((cause) => setConversationError(cause instanceof Error ? cause.message : "消息加载失败"));
  }, [props.authToken, props.currentUser?.id, selectedFriendId]);

  useEffect(() => {
    if (!props.authToken || !query.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      setPeopleError("");
      searchUsers(props.authToken, query.trim())
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .catch((cause) => {
          if (!cancelled) setPeopleError(cause instanceof Error ? cause.message : "搜索失败");
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [props.authToken, query]);

  useEffect(() => {
    directListRef.current?.scrollTo({ top: directListRef.current.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [directMessages, selectedFriendId]);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [messages, sending]);

  async function refreshFriends(nextSelectedId = selectedFriendId) {
    if (!props.authToken) return;
    setPeopleLoading(true);
    setPeopleError("");
    try {
      const nextSummary = await fetchFriendSummary(props.authToken);
      setSummary(nextSummary);
      const validSelected = nextSummary.friends.some((friend) => friend.user.id === nextSelectedId);
      setSelectedFriendId(validSelected ? nextSelectedId : nextSummary.friends[0]?.user.id ?? "");
    } catch (cause) {
      setPeopleError(cause instanceof Error ? cause.message : "好友数据加载失败");
    } finally {
      setPeopleLoading(false);
    }
  }

  async function addFriend(userId: string) {
    if (!props.authToken) return;
    const actionId = `add:${userId}`;
    setPeopleAction(actionId);
    setPeopleError("");
    try {
      await requestFriend(props.authToken, userId);
      await refreshFriends(selectedFriendId);
    } catch (cause) {
      setPeopleError(cause instanceof Error ? cause.message : "好友申请失败");
    } finally {
      setPeopleAction((current) => current === actionId ? "" : current);
    }
  }

  async function answerRequest(requestId: number, accept: boolean) {
    if (!props.authToken) return;
    const actionId = `request:${requestId}`;
    setPeopleAction(actionId);
    setPeopleError("");
    try {
      if (accept) {
        await acceptFriendRequest(props.authToken, requestId);
      } else {
        await rejectFriendRequest(props.authToken, requestId);
      }
      await refreshFriends(selectedFriendId);
    } catch (cause) {
      setPeopleError(cause instanceof Error ? cause.message : "请求处理失败");
    } finally {
      setPeopleAction((current) => current === actionId ? "" : current);
    }
  }

  async function submitDirect() {
    const content = directDraft.trim();
    if (!props.authToken || !props.currentUser || !selectedFriendId || directSending || (!content && !directAttachments.length)) return;
    setDirectDraft("");
    const attachments = directAttachments;
    setDirectAttachments([]);
    await sendDirectWithLocalState(content, attachments);
  }

  async function sendDirectWithLocalState(content: string, attachments: ChatAttachment[], previousLocalId?: string) {
    if (!props.authToken || !props.currentUser || !selectedFriendId) return;
    const localId = previousLocalId ?? `local-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    const optimistic: DirectMessageView = {
      id: -Date.now(),
      local_id: localId,
      local_status: "sending",
      local_payload: { content, attachments },
      sender_id: props.currentUser.id,
      recipient_id: selectedFriendId,
      content,
      attachments: attachments.map(chatAttachmentToDirect),
      created_at: new Date().toISOString(),
    };
    setRetryingLocalId(previousLocalId ?? "");
    if (!previousLocalId) setDirectSending(true);
    setConversationError("");
    setDirectMessages((current) => {
      const withoutPrevious = current.filter((message) => message.local_id !== localId);
      return [...withoutPrevious, optimistic];
    });
    try {
      const message = await sendDirectMessage(props.authToken, selectedFriendId, { content, attachments });
      setDirectMessages((current) => current.map((item) => item.local_id === localId ? message : item));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t.sendFailed;
      setConversationError(message);
      setDirectMessages((current) => current.map((item) => item.local_id === localId ? { ...item, local_status: "failed", local_error: message } : item));
    } finally {
      if (!previousLocalId) setDirectSending(false);
      setRetryingLocalId((current) => current === localId ? "" : current);
    }
  }

  function restoreFailedMessage(message: DirectMessageView) {
    if (!message.local_payload) return;
    setDirectDraft(message.local_payload.content);
    setDirectAttachments(message.local_payload.attachments);
    setDirectMessages((current) => current.filter((item) => item.local_id !== message.local_id));
    setConversationError("");
  }

  function resetDirectComposer() {
    setDirectDraft("");
    setDirectAttachments([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function clearAttachmentLimitError() {
    setConversationError((current) => current === t.maxAttachments ? "" : current);
  }

  function removeDirectAttachment(attachmentId: string) {
    setDirectAttachments((current) => current.filter((item) => item.id !== attachmentId));
    clearAttachmentLimitError();
  }

  async function attachFiles(fileList: FileList | null) {
    if (!fileList) return;
    const remaining = Math.max(0, 4 - directAttachments.length);
    const files = Array.from(fileList).slice(0, remaining);
    if (fileList.length > remaining) {
      setConversationError(t.maxAttachments);
    } else {
      clearAttachmentLimitError();
    }
    try {
      const nextAttachments = await Promise.all(files.map(fileToAttachment));
      setDirectAttachments((current) => [...current, ...nextAttachments].slice(0, 4));
    } catch (cause) {
      setConversationError(cause instanceof Error ? cause.message : "附件读取失败");
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function commitMessages(nextMessages: ChatMessage[]) {
    try {
      localStorage.setItem(messagesKey, JSON.stringify(nextMessages));
      setMessages(nextMessages);
      return true;
    } catch {
      return false;
    }
  }

  async function submitAi() {
    const content = draft.trim();
    if (!content || !activeProfile || sending) return;
    const userMessage: ChatMessage = { id: `msg-${Date.now()}`, role: "user", content, createdAt: new Date().toISOString() };
    const pendingMessages = [...messages, userMessage];
    if (!commitMessages(pendingMessages)) {
      setError(aiMessagesStorageError);
      return;
    }
    setDraft("");
    setSending(true);
    setError("");
    try {
      const response = await sendChat(configFromProfile(activeProfile), pendingMessages);
      const saved = commitMessages([...pendingMessages, { id: `msg-${Date.now()}-ai`, role: "assistant", content: response.content, createdAt: new Date().toISOString() }]);
      if (!saved) {
        setError(`回复已生成，但${aiMessagesStorageError}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  function openModelHub() {
    window.history.pushState({}, "", "/aggregation");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <section className="react-chat-panel">
      <div className="module-view-header chat-view-header">
        <div><p className="eyebrow">会话</p><h1>{t.title}</h1><span className="module-view-subtitle">{t.subtitle}</span></div>
      </div>
      <div className="direct-chat-shell">
        <aside className="direct-chat-sidebar">
          <div className="direct-friend-list">
            <strong>{t.ai}</strong>
            <button type="button" className={`direct-friend-item ai-thread-item ${mode === "ai" ? "active" : ""}`} aria-current={mode === "ai" ? "true" : undefined} onClick={() => setMode("ai")}>
              <span className="direct-user-identity"><span className="user-avatar"><Bot size={16} /></span><span><strong>{activeProfile?.name ?? t.unavailableAi}</strong><small>{activeProfile ? `${providerLabel(activeProfile.provider, language)} · ${activeProfile.model}` : t.aiIntro}</small></span></span>
            </button>
          </div>
          {!props.currentUser ? <ChatSidebarNotice message={t.loginRequired} /> : (
            <>
              <label className="react-search-field"><Search size={15} /><input value={query} aria-label={t.searchPlaceholder} placeholder={t.searchPlaceholder} onChange={(event) => setQuery(event.target.value)} /></label>
              {peopleLoading && <p className="react-status-line pending" role="status" aria-live="polite">{t.loadingPeople}</p>}
              {peopleError && <p className="react-error-line sidebar-error" role="alert">{peopleError}</p>}
              {query.trim() && <div className="direct-search-results">
                {searchResults.map((user) => <UserSearchRow key={user.id} user={user} isFriend={friendIds.has(user.id)} requested={outgoingIds.has(user.id)} pending={peopleAction === `add:${user.id}`} onAdd={() => addFriend(user.id)} labels={t} />)}
                {searchLoading && <p className="react-empty-line" role="status" aria-live="polite">{t.searchingUsers}</p>}
                {!searchLoading && !searchResults.length && <p className="react-empty-line" role="status" aria-live="polite">{t.noSearchResults}</p>}
              </div>}
              {!!summary.incoming_requests.length && <div className="direct-request-list">
                <strong>{t.requests}</strong>
                {summary.incoming_requests.map((request) => <div key={request.id} className="direct-request-item">
                  <UserIdentity user={request.requester} />
                  <button type="button" disabled={peopleAction === `request:${request.id}`} aria-label={t.accept} onClick={() => answerRequest(request.id, true)}><Check size={14} /></button>
                  <button type="button" disabled={peopleAction === `request:${request.id}`} aria-label={t.reject} onClick={() => answerRequest(request.id, false)}><X size={14} /></button>
                </div>)}
              </div>}
              <div className="direct-friend-list">
                <strong>{t.friends}</strong>
                {summary.friends.map((friendship) => <button key={friendship.user.id} type="button" className={`direct-friend-item ${mode === "people" && friendship.user.id === selectedFriendId ? "active" : ""}`} aria-current={mode === "people" && friendship.user.id === selectedFriendId ? "true" : undefined} onClick={() => {
                  setSelectedFriendId(friendship.user.id);
                  setMode("people");
                }}><UserIdentity user={friendship.user} /></button>)}
                {!summary.friends.length && <p className="react-empty-line" role="status" aria-live="polite">{t.noFriends}</p>}
              </div>
              {!!summary.outgoing_requests.length && <div className="direct-request-list compact"><strong>{t.outgoing}</strong>{summary.outgoing_requests.map((request) => <div key={request.id} className="direct-request-item outgoing"><UserIdentity user={request.addressee} /><span>{t.requested}</span></div>)}</div>}
            </>
          )}
        </aside>
        {mode === "people" ? (
          <article className="direct-chat-surface">
            {selectedFriend ? (
              <>
                <div className="direct-chat-head"><UserIdentity user={selectedFriend} /><span>{selectedFriend.username}</span></div>
                <div className="react-message-list" ref={directListRef} role="log" aria-label="私聊消息" aria-live="polite" aria-relevant="additions text" aria-busy={directSending}>
                  {directMessages.map((message) => {
                    const mine = message.sender_id === props.currentUser?.id;
                    return <div key={message.local_id ?? message.id} className={`react-message ${mine ? "user" : "assistant"} ${message.local_status ?? ""}`}>
                      {message.content && <p>{message.content}</p>}
                      <MessageAttachments attachments={message.attachments} onPreview={setPreviewAttachment} />
                      <small>{mine ? "我" : displayFriendName(selectedFriend)} · {message.local_status === "sending" ? t.sending : message.local_status === "failed" ? t.sendFailed : formatTime(message.created_at, language)}</small>
                      {message.local_status === "failed" && message.local_error && <span className="direct-message-error" role="alert">{message.local_error}</span>}
                      {message.local_status === "failed" && <div className="direct-message-actions">
                        <button type="button" disabled={retryingLocalId === message.local_id} onClick={() => message.local_payload && sendDirectWithLocalState(message.local_payload.content, message.local_payload.attachments, message.local_id)}>{retryingLocalId === message.local_id ? t.sending : t.retry}</button>
                        <button type="button" onClick={() => restoreFailedMessage(message)}>{t.restore}</button>
                      </div>}
                    </div>;
                  })}
                </div>
                {conversationError && <p className="react-error-line" role="alert">{conversationError}</p>}
                {!!directAttachments.length && <PendingAttachmentTray attachments={directAttachments} label={t.pendingAttachment} onRemove={removeDirectAttachment} />}
                <div className="react-composer direct-composer">
                  <input ref={fileInputRef} className="chat-file-input" type="file" multiple aria-label="选择附件" onChange={(event) => attachFiles(event.target.files)} />
                  <button className="secondary-button compact" type="button" aria-label="添加附件" disabled={directSending || directAttachments.length >= 4} onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /></button>
                  <textarea value={directDraft} aria-label="私聊消息内容" placeholder={t.messagePlaceholder} onChange={(event) => setDirectDraft(event.target.value)} onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submitDirect();
                    }
                  }} />
                  <button className="primary-action compact" type="button" disabled={directSending || (!directDraft.trim() && !directAttachments.length)} onClick={submitDirect}><SendHorizonal size={16} /><span>{directSending ? t.sending : t.send}</span></button>
                </div>
              </>
            ) : <div className="direct-chat-empty" role="status" aria-live="polite"><MessageSquareText size={28} /><strong>{props.currentUser ? t.noConversation : t.loginRequired}</strong>{conversationError && <p className="react-error-line" role="alert">{conversationError}</p>}</div>}
          </article>
        ) : (
          <article className="direct-chat-surface react-chat-surface unified-ai-surface">
            <div className="direct-chat-head"><span className="direct-user-identity"><span className="user-avatar"><Bot size={16} /></span><span><strong>{activeProfile?.name ?? t.unavailableAi}</strong>{activeProfile && <small>{`${providerLabel(activeProfile.provider, language)} · ${activeProfile.model}`}</small>}</span></span>{activeProfile && <span><Settings size={14} /> {t.aiIntro}</span>}</div>
            <div className="react-message-list" ref={messageListRef} role="log" aria-label="AI 会话消息" aria-live="polite" aria-relevant="additions text" aria-busy={sending}>
              {messages.map((message) => <div key={message.id} className={`react-message ${message.role}`}><p>{message.content}</p><small>{message.role === "user" ? "我" : activeProfile?.name ?? "AI"}</small></div>)}
              {sending && <div className="react-message assistant pending"><p>{t.typing}</p><small>{activeProfile?.name ?? "AI"}</small></div>}
              {!messages.length && (activeProfile ? <div className="react-empty-line" role="status" aria-live="polite">{t.startAi}</div> : <div className="chat-model-empty" role="status" aria-live="polite"><Bot size={18} /><div><strong>{t.unavailableAi}</strong><small>{t.modelRequired}</small></div><button className="secondary-button compact" type="button" onClick={openModelHub}>{t.configureModel}</button></div>)}
            </div>
            {error && <p className="react-error-line" role="alert">{error}</p>}
            {activeProfile && <div className="react-composer ai-composer">
              <textarea value={draft} aria-label="AI 会话消息内容" placeholder={activeProfile ? t.messagePlaceholder : t.unavailableAi} disabled={!activeProfile || sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitAi();
                }
              }} />
              <button className="primary-action compact" type="button" disabled={!draft.trim() || !activeProfile || sending} onClick={submitAi}><SendHorizonal size={16} /><span>{sending ? t.sending : t.send}</span></button>
            </div>}
          </article>
        )}
      {previewAttachment && <ImagePreviewDialog attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />}
      </div>
    </section>
  );
}

function ChatSidebarNotice(props: { message: string }) {
  return <div className="chat-sidebar-notice" role="status" aria-live="polite"><LogIn size={16} /><span>{props.message}</span></div>;
}

function mergeDirectMessages(remote: DirectMessageRecord[], current: DirectMessageView[], friendId: string, currentUserId: string): DirectMessageView[] {
  const localMessages = current.filter((message) => {
    if (!message.local_id || !message.local_status) return false;
    if (!currentUserId) return message.recipient_id === friendId || message.sender_id === friendId;
    return (message.sender_id === currentUserId && message.recipient_id === friendId) || (message.sender_id === friendId && message.recipient_id === currentUserId);
  });
  return [...remote, ...localMessages].sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
}

function UserSearchRow(props: { user: UserSearchResult; isFriend: boolean; requested: boolean; pending: boolean; onAdd: () => void; labels: typeof copy.zh }) {
  return <div className="direct-search-row"><UserIdentity user={props.user} /><button className="secondary-button compact" type="button" disabled={props.isFriend || props.requested || props.pending} onClick={props.onAdd}>{props.pending ? <span>{props.labels.actionPending}</span> : <><UserPlus size={14} /><span>{props.isFriend ? props.labels.friendAdded : props.requested ? props.labels.requested : props.labels.addFriend}</span></>}</button></div>;
}

function UserIdentity(props: { user: FriendProfile | UserSearchResult }) {
  const name = displayFriendName(props.user);
  return <span className="direct-user-identity"><span className="user-avatar">{props.user.avatar_url ? <img src={resolveMediaUrl(props.user.avatar_url)} alt="" /> : name.slice(0, 1).toUpperCase()}</span><span><strong>{name}</strong><small>{props.user.email}</small></span></span>;
}

function PendingAttachmentTray(props: { attachments: ChatAttachment[]; label: string; onRemove: (attachmentId: string) => void }) {
  return (
    <div className="chat-attachment-tray composer-attachments" role="status" aria-live="polite" aria-label="待发送附件">
      {props.attachments.map((attachment) => (
        <figure key={attachment.id} className={`composer-attachment-card ${attachment.kind}`}>
          {attachment.kind === "image" && attachment.dataUrl ? <img src={attachment.dataUrl} alt="" /> : <span className="composer-file-backdrop">{fileExtension(attachment.name)}</span>}
          <figcaption><strong>{attachment.name}</strong><small>{props.label} · {formatBytes(attachment.size)}</small></figcaption>
          <button type="button" aria-label={`移除附件：${attachment.name}`} title={`移除 ${attachment.name}`} onClick={() => props.onRemove(attachment.id)}><X size={13} /></button>
        </figure>
      ))}
    </div>
  );
}

function MessageAttachments(props: { attachments: DirectAttachment[]; onPreview: (attachment: DirectAttachment) => void }) {
  if (!props.attachments.length) return null;
  const images = props.attachments.filter((attachment) => attachment.kind === "image");
  const files = props.attachments.filter((attachment) => attachment.kind !== "image");
  return (
    <div className="message-attachments">
      {!!images.length && <div className="message-image-grid">{images.map((attachment) => {
        const url = resolveMediaUrl(attachment.data_url);
        return (
          <figure key={attachment.id} className="message-image-attachment">
            {url ? <button type="button" className="message-image-open" aria-label={`预览 ${attachment.name}`} onClick={() => props.onPreview(attachment)}><img src={url} alt={attachment.name} /></button> : <span className="message-image-missing">图片不可用</span>}
            <figcaption><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small></figcaption>
          </figure>
        );
      })}</div>}
      {files.map((attachment) => {
        const url = resolveMediaUrl(attachment.data_url);
        return (
          <a key={attachment.id} className="message-file-card" data-extension={fileExtension(attachment.name)} href={url || "#"} download={attachment.name} onClick={(event) => !url && event.preventDefault()}>
            <span className="message-file-card-content">
              <FileText size={22} />
              <strong className="message-file-name">{attachment.name}</strong>
              <small>{formatBytes(attachment.size)}</small>
            </span>
          </a>
        );
      })}
    </div>
  );
}

function ImagePreviewDialog(props: { attachment: DirectAttachment; onClose: () => void }) {
  const url = resolveMediaUrl(props.attachment.data_url);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!url) {
      props.onClose();
      return;
    }
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [props.onClose, url]);
  if (!url) return null;
  return (
    <div ref={dialogRef} className="image-preview-backdrop" role="dialog" aria-modal="true" aria-label={props.attachment.name} tabIndex={-1} onClick={props.onClose}>
      <div className="image-preview-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="image-preview-topbar">
          <div><strong>{props.attachment.name}</strong><small>{formatBytes(props.attachment.size)}</small></div>
          <div className="image-preview-actions">
            <a href={url} download={props.attachment.name}><Download size={14} /><span>下载</span></a>
            <button type="button" aria-label="关闭预览" onClick={props.onClose}><X size={15} /></button>
          </div>
        </div>
        <img src={url} alt={props.attachment.name} />
      </div>
    </div>
  );
}

function chatAttachmentToDirect(attachment: ChatAttachment): DirectAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    kind: attachment.kind,
    data_url: attachment.dataUrl,
  };
}

function fileToAttachment(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      id: `att-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      kind: file.type.startsWith("image/") ? "image" : "file",
      dataUrl: String(reader.result || ""),
    });
    reader.onerror = () => reject(new Error("附件读取失败"));
    reader.readAsDataURL(file);
  });
}

function fileExtension(name: string) {
  const extension = name.split(".").pop()?.trim();
  return extension && extension !== name ? extension.slice(0, 8).toUpperCase() : "FILE";
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function displayFriendName(user: FriendProfile | UserSearchResult) {
  return user.display_name || user.username || user.email;
}

function loadProfiles(): ModelProfile[] {
  try {
    const parsed = JSON.parse(readStorageValue(profilesKey) ?? "[]") as ModelProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function activeUsableProfile(profiles: ModelProfile[]) {
  const activeId = readStorageValue(activeProfileKey) ?? "";
  const active = profiles.find((profile) => profile.id === activeId);
  return isUsableProfile(active) ? active : profiles.find(isUsableProfile);
}

function isUsableProfile(profile: ModelProfile | undefined) {
  return Boolean(profile?.baseUrl.trim() && profile.model.trim() && profile.apiKey.trim());
}

function loadMessages(): ChatMessage[] {
  try {
    const parsed = JSON.parse(readStorageValue(messagesKey) ?? "[]") as ChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStorageValue(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function providerLabel(provider: ModelProfile["provider"], language: UiLanguage) {
  const labels: Record<ModelProfile["provider"], Record<UiLanguage, string>> = {
    openai: { zh: "OpenAI 兼容", en: "OpenAI compatible" },
    anthropic: { zh: "Anthropic 消息", en: "Anthropic messages" },
    gemini: { zh: "Gemini 生成", en: "Gemini generation" },
  };
  return labels[provider]?.[language] ?? provider;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

function formatTime(value: string, language: UiLanguage) {
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
