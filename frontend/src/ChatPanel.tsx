import { type Dispatch, type RefObject, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Download, FileText, LogIn, MessageSquareText, Paperclip, Plus, Search, SendHorizonal, Settings, UserPlus, Users, X } from "lucide-react";
import {
  acceptFriendRequest,
  fetchDirectMessages,
  fetchFriendSummary,
  fetchModelProfiles,
  rejectFriendRequest,
  requestFriend,
  searchUsers,
  sendDirectMessage,
  streamChat,
} from "./services/api";
import { resolveMediaUrl } from "./services/api";
import type { AuthUser, UserSearchResult } from "./types/auth";
import type { ChatAttachment, ChatConfig, ChatMessage, DirectAttachment, DirectMessageRecord, FriendProfile, FriendSummary, ModelProfile } from "./types/chat";

const profilesKey = "4ever.model.profiles";
const activeProfileKey = "4ever.model.activeProfile";
const messagesKey = "4ever.react.chat.messages";
const aiContactKey = "4ever.react.chat.aiContact";
const aiMessagesStorageError = "AI 会话保存失败，请检查浏览器存储空间后再继续发送。";

type ChatMode = "people" | "ai";
type UiLanguage = "zh" | "en";
type DialogType = "add-friend" | "new-group" | "new-ai" | null;
type AIContactProfile = {
  name: string;
  persona: string;
};
type DirectMessageView = DirectMessageRecord & {
  local_id?: string;
  local_status?: "sending" | "failed";
  local_error?: string;
  local_payload?: {
    content: string;
    attachments: ChatAttachment[];
  };
};
type ChatProfilePopover = {
  user: AuthUser | FriendProfile;
  x: number;
  y: number;
  side: "left" | "right";
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
    aiIntro: "使用中枢的当前模型配置",
    unavailableAi: "全局 AI 暂不可用",
    configureModel: "去中枢配置",
    modelRequired: "需要先在中枢配置全局模型，聊天不会在这里单独输入 Key。",
    startAi: "开始一段对话。",
    typing: "正在输入中",
    aiSettings: "资料",
    aiName: "名字",
    aiPersona: "性格",
    saveAiProfile: "保存",
    addFriendMenu: "添加好友",
    newGroupMenu: "新建群组",
    newAiMenu: "新建AI",
    addFriendDialogTitle: "添加好友",
    addFriendDialogDesc: "通过用户名、邮箱或昵称搜索并添加好友",
    newGroupDialogTitle: "新建群组",
    newGroupDialogDesc: "创建一个新的群聊",
    newAiDialogTitle: "新建 AI",
    newAiDialogDesc: "创建一个新的 AI 会话助手",
    groupName: "群组名称",
    groupNamePlaceholder: "输入群组名称",
    selectMembers: "选择成员",
    cancel: "取消",
    create: "创建",
    confirm: "确定",
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
    configureModel: "Open Hub",
    modelRequired: "Configure the global model in Hub first. Chat does not collect API keys here.",
    startAi: "Start a conversation.",
    typing: "Composing reply...",
    aiSettings: "Profile",
    aiName: "Name",
    aiPersona: "Persona",
    saveAiProfile: "Save",
    addFriendMenu: "Add Friend",
    newGroupMenu: "New Group",
    newAiMenu: "New AI",
    addFriendDialogTitle: "Add Friend",
    addFriendDialogDesc: "Search and add friends by username, email, or display name",
    newGroupDialogTitle: "New Group",
    newGroupDialogDesc: "Create a new group chat",
    newAiDialogTitle: "New AI",
    newAiDialogDesc: "Create a new AI assistant conversation",
    groupName: "Group Name",
    groupNamePlaceholder: "Enter group name",
    selectMembers: "Select Members",
    cancel: "Cancel",
    create: "Create",
    confirm: "Confirm",
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
  const [profilePopover, setProfilePopover] = useState<ChatProfilePopover | null>(null);
  const [directSending, setDirectSending] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleAction, setPeopleAction] = useState("");
  const [retryingLocalId, setRetryingLocalId] = useState("");
  const [peopleError, setPeopleError] = useState("");
  const [conversationError, setConversationError] = useState("");
  const [profiles, setProfiles] = useState<ModelProfile[]>(loadProfiles);
  const [backendProfileIds, setBackendProfileIds] = useState<Set<string>>(() => new Set());
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [aiContact, setAiContact] = useState<AIContactProfile>(loadAIContact);
  const [aiDraft, setAiDraft] = useState<AIContactProfile>(() => loadAIContact());
  const [aiEditorOpen, setAiEditorOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [aiAttachments, setAiAttachments] = useState<ChatAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [activeDialog, setActiveDialog] = useState<DialogType>(null);
  const [dialogSearchQuery, setDialogSearchQuery] = useState("");
  const [dialogSearchResults, setDialogSearchResults] = useState<UserSearchResult[]>([]);
  const [dialogSearchLoading, setDialogSearchLoading] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [newAiName, setNewAiName] = useState("");
  const [newAiPersona, setNewAiPersona] = useState("");
  const directListRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const aiFileInputRef = useRef<HTMLInputElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const activeProfile = useMemo(() => activeUsableProfile(profiles), [profiles]);
  const selectedFriend = summary.friends.find((friend) => friend.user.id === selectedFriendId)?.user ?? null;
  const outgoingIds = useMemo(() => new Set(summary.outgoing_requests.map((request) => request.addressee.id)), [summary.outgoing_requests]);
  const friendIds = useMemo(() => new Set(summary.friends.map((friend) => friend.user.id)), [summary.friends]);

  function scrollAIToBottom(behavior: ScrollBehavior = "auto") {
    scrollElementToBottom(messageListRef.current, behavior);
  }

  function openAIConversation() {
    setMode("ai");
    scheduleScrollToBottom(messageListRef, "auto");
  }

  function openDirectConversation(friendId: string) {
    setSelectedFriendId(friendId);
    setMode("people");
    scheduleScrollToBottom(directListRef, "auto");
  }

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
    let cancelled = false;
    fetchModelProfiles().then((remote) => {
      if (cancelled || !remote.profiles.length) return;
      setProfiles(remote.profiles);
      setBackendProfileIds(new Set(remote.profiles.map((profile) => profile.id)));
      persistProfileSnapshot(remote.profiles, remote.activeProfileId || remote.profiles[0].id);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [props.authToken, query]);

  useEffect(() => {
    return scheduleScrollToBottom(directListRef, "auto");
  }, [directMessages, selectedFriendId]);

  useEffect(() => {
    if (!profilePopover) return;
    function closeOnPointerDown(event: PointerEvent) {
      if ((event.target as HTMLElement).closest(".message-profile-popover, .chat-message-avatar")) return;
      setProfilePopover(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setProfilePopover(null);
    }
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profilePopover]);

  useEffect(() => {
    scrollAIToBottom(prefersReducedMotion() ? "auto" : "smooth");
  }, [messages, sending]);

  useEffect(() => {
    if (!showAddMenu) return;
    function closeOnPointerDown(event: PointerEvent) {
      if ((event.target as HTMLElement).closest(".chat-add-menu")) return;
      setShowAddMenu(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setShowAddMenu(false);
    }
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showAddMenu]);

  useEffect(() => {
    if (!activeDialog || !props.authToken || !dialogSearchQuery.trim()) {
      setDialogSearchResults([]);
      setDialogSearchLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setDialogSearchLoading(true);
      searchUsers(props.authToken, dialogSearchQuery.trim())
        .then((results) => {
          if (!cancelled) setDialogSearchResults(results);
        })
        .catch((cause) => {
          if (!cancelled) console.error("搜索失败:", cause);
        })
        .finally(() => {
          if (!cancelled) setDialogSearchLoading(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [props.authToken, dialogSearchQuery, activeDialog]);

  function openMessageProfile(user: AuthUser | FriendProfile | null | undefined, event: React.MouseEvent<HTMLElement>, side: "left" | "right") {
    if (!user) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setProfilePopover({
      user,
      x: side === "right" ? rect.left : rect.right,
      y: rect.top + rect.height / 2,
      side,
    });
  }

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

  async function attachFiles(fileList: FileList | null, currentAttachments: ChatAttachment[], setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>, resetInput: () => void, setErrorMessage: (message: string) => void, clearErrorMessage: () => void) {
    if (!fileList) return;
    const remaining = Math.max(0, 4 - currentAttachments.length);
    const files = Array.from(fileList).slice(0, remaining);
    if (fileList.length > remaining) {
      setErrorMessage(t.maxAttachments);
    } else {
      clearErrorMessage();
    }
    try {
      const nextAttachments = await Promise.all(files.map(fileToAttachment));
      setAttachments((current) => [...current, ...nextAttachments].slice(0, 4));
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "附件读取失败");
    }
    resetInput();
  }

  function attachDirectFiles(fileList: FileList | null) {
    void attachFiles(fileList, directAttachments, setDirectAttachments, () => {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }, setConversationError, clearAttachmentLimitError);
  }

  function attachAIFiles(fileList: FileList | null) {
    void attachFiles(fileList, aiAttachments, setAiAttachments, () => {
      if (aiFileInputRef.current) aiFileInputRef.current.value = "";
    }, setError, () => setError((current) => current === t.maxAttachments ? "" : current));
  }

  function removeAIAttachment(attachmentId: string) {
    setAiAttachments((current) => current.filter((item) => item.id !== attachmentId));
    setError((current) => current === t.maxAttachments ? "" : current);
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

  function saveAIContact() {
    const nextProfile = normalizeAIContact(aiDraft);
    try {
      localStorage.setItem(aiContactKey, JSON.stringify(nextProfile));
    } catch {
      // AI contact profile is nice-to-have; the chat should keep working if storage is blocked.
    }
    setAiContact(nextProfile);
    setAiDraft(nextProfile);
    setAiEditorOpen(false);
  }

  async function submitAi() {
    const content = draft.trim();
    if ((!content && !aiAttachments.length) || !activeProfile || sending) return;
    const attachments = aiAttachments;
    const userMessage: ChatMessage = { id: `msg-${Date.now()}`, role: "user", content, attachments, createdAt: new Date().toISOString() };
    const pendingMessages = [...messages, userMessage];
    if (!commitMessages(pendingMessages)) {
      setError(aiMessagesStorageError);
      return;
    }
    setDraft("");
    setAiAttachments([]);
    if (aiFileInputRef.current) aiFileInputRef.current.value = "";
    setSending(true);
    setError("");
    const assistantMessage: ChatMessage = { id: `msg-${Date.now()}-ai`, role: "assistant", content: "", createdAt: new Date().toISOString() };
    let streamedContent = "";
    try {
      const finalContent = await streamChat(configFromProfile(activeProfile, aiContact, backendProfileIds.has(activeProfile.id)), messagesForAIProvider(pendingMessages), (chunk) => {
        streamedContent += chunk;
        setMessages((current) => {
          const withAssistant = current.some((message) => message.id === assistantMessage.id) ? current : [...current, assistantMessage];
          return withAssistant.map((message) => message.id === assistantMessage.id ? { ...message, content: streamedContent } : message);
        });
        window.requestAnimationFrame(() => scrollAIToBottom(prefersReducedMotion() ? "auto" : "smooth"));
      });
      const contentToSave = finalContent || streamedContent;
      if (!contentToSave.trim()) {
        setError("AI 没有返回内容。");
        return;
      }
      const saved = commitMessages([...pendingMessages, { ...assistantMessage, content: contentToSave }]);
      if (!saved) {
        setError(`回复已生成，但${aiMessagesStorageError}`);
      }
    } catch (cause) {
      if (streamedContent.trim()) {
        commitMessages([...pendingMessages, { ...assistantMessage, content: streamedContent }]);
      }
      setError(cause instanceof Error ? cause.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  function openModelHub() {
    window.history.pushState({}, "", "/aggregation");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function handleAddFriendClick() {
    setShowAddMenu(false);
    setActiveDialog("add-friend");
    setDialogSearchQuery("");
    setDialogSearchResults([]);
  }

  function handleNewGroupClick() {
    setShowAddMenu(false);
    setActiveDialog("new-group");
    setNewGroupName("");
    setNewGroupMembers([]);
    setDialogSearchQuery("");
    setDialogSearchResults([]);
  }

  function handleNewAiClick() {
    setShowAddMenu(false);
    setActiveDialog("new-ai");
    setNewAiName("");
    setNewAiPersona("");
  }

  function closeDialog() {
    setActiveDialog(null);
    setDialogSearchQuery("");
    setDialogSearchResults([]);
    setDialogSearchLoading(false);
    setNewGroupName("");
    setNewGroupMembers([]);
    setNewAiName("");
    setNewAiPersona("");
  }

  function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    // TODO: 实现创建群组的API调用
    console.log("创建群组:", { name: newGroupName, members: newGroupMembers });
    closeDialog();
  }

  function handleCreateAi() {
    if (!newAiName.trim()) return;
    // TODO: 实现创建AI的逻辑
    console.log("创建AI:", { name: newAiName, persona: newAiPersona });
    closeDialog();
    setMode("ai");
  }

  function toggleGroupMember(userId: string) {
    setNewGroupMembers((current) =>
      current.includes(userId)
        ? current.filter(id => id !== userId)
        : [...current, userId]
    );
  }

  return (
    <section className="react-chat-panel">
      <div className="direct-chat-shell">
        <aside className="direct-chat-sidebar">
          <>
            {!props.currentUser && <ChatSidebarNotice message={t.loginRequired} />}
            {props.currentUser && <>
              <div className="chat-search-bar">
                <label className="react-search-field"><Search size={15} /><input value={query} aria-label={t.searchPlaceholder} placeholder={t.searchPlaceholder} onChange={(event) => setQuery(event.target.value)} /></label>
                <div className="chat-add-menu-wrapper" ref={addMenuRef}>
                  <button type="button" className="chat-add-button" aria-label="添加" onClick={() => setShowAddMenu(!showAddMenu)}>
                    <Plus size={18} />
                  </button>
                  {showAddMenu && (
                    <div className="chat-add-menu">
                      <button type="button" onClick={handleAddFriendClick}>
                        <UserPlus size={16} />
                        <span>{t.addFriendMenu}</span>
                      </button>
                      <button type="button" onClick={handleNewGroupClick}>
                        <Users size={16} />
                        <span>{t.newGroupMenu}</span>
                      </button>
                      <button type="button" onClick={handleNewAiClick}>
                        <Bot size={16} />
                        <span>{t.newAiMenu}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
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
            </>}
              <div className="direct-friend-list">
                <strong>{t.friends}</strong>
                <button type="button" className={`direct-friend-item ai-thread-item ${mode === "ai" ? "active" : ""}`} aria-current={mode === "ai" ? "true" : undefined} onClick={openAIConversation}>
                  <AIContactIdentity profile={aiContact} detail={activeProfile ? aiContact.persona : t.unavailableAi} />
                </button>
                {props.currentUser && summary.friends.map((friendship) => <button key={friendship.user.id} type="button" className={`direct-friend-item ${mode === "people" && friendship.user.id === selectedFriendId ? "active" : ""}`} aria-current={mode === "people" && friendship.user.id === selectedFriendId ? "true" : undefined} onClick={() => openDirectConversation(friendship.user.id)}><UserIdentity user={friendship.user} /></button>)}
                {props.currentUser && !summary.friends.length && <p className="react-empty-line" role="status" aria-live="polite">{t.noFriends}</p>}
              </div>
              {props.currentUser && !!summary.outgoing_requests.length && <div className="direct-request-list compact"><strong>{t.outgoing}</strong>{summary.outgoing_requests.map((request) => <div key={request.id} className="direct-request-item outgoing"><UserIdentity user={request.addressee} /><span>{t.requested}</span></div>)}</div>}
          </>
        </aside>
        {mode === "people" ? (
          <article className="direct-chat-surface">
            {selectedFriend ? (
              <>
                <div className="direct-chat-head ai-contact-head"><UserIdentity user={selectedFriend} /></div>
                <div className="react-message-list" ref={directListRef} role="log" aria-label="私聊消息" aria-live="polite" aria-relevant="additions text" aria-busy={directSending}>
                  {directMessages.map((message) => {
                    const mine = message.sender_id === props.currentUser?.id;
                    return <div key={message.local_id ?? message.id} className={`react-message ${mine ? "user" : "assistant"} ${message.local_status ?? ""}`}>
                      <ChatMessageAvatar kind={mine ? "user" : "friend"} user={mine ? props.currentUser : selectedFriend} onOpenProfile={(event) => openMessageProfile(mine ? props.currentUser : selectedFriend, event, mine ? "right" : "left")} />
                      <div className="react-message-stack">
                        <time className="react-message-time" dateTime={message.created_at}>{formatTime(message.created_at, language)}</time>
                        <div className="react-message-bubble">
                          {message.content && <p>{message.content}</p>}
                          <MessageAttachments attachments={message.attachments} onPreview={setPreviewAttachment} />
                        </div>
                        {(message.local_status === "sending" || message.local_status === "failed") && <div className="react-message-meta">
                          <small>{message.local_status === "sending" ? t.sending : t.sendFailed}</small>
                          {message.local_status === "failed" && message.local_error && <span className="direct-message-error" role="alert">{message.local_error}</span>}
                          {message.local_status === "failed" && <div className="direct-message-actions">
                            <button type="button" disabled={retryingLocalId === message.local_id} onClick={() => message.local_payload && sendDirectWithLocalState(message.local_payload.content, message.local_payload.attachments, message.local_id)}>{retryingLocalId === message.local_id ? t.sending : t.retry}</button>
                            <button type="button" onClick={() => restoreFailedMessage(message)}>{t.restore}</button>
                          </div>}
                        </div>}
                      </div>
                    </div>;
                  })}
                </div>
                {conversationError && <p className="react-error-line" role="alert">{conversationError}</p>}
                {!!directAttachments.length && <PendingAttachmentTray attachments={directAttachments} label={t.pendingAttachment} onRemove={removeDirectAttachment} />}
                <div className="react-composer direct-composer">
                  <input ref={fileInputRef} className="chat-file-input" type="file" multiple aria-label="选择附件" onChange={(event) => attachDirectFiles(event.target.files)} />
                  <button className="secondary-button compact" type="button" aria-label="添加附件" disabled={directSending || directAttachments.length >= 4} onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /></button>
                  <textarea rows={1} value={directDraft} aria-label="私聊消息内容" placeholder={t.messagePlaceholder} onChange={(event) => setDirectDraft(event.target.value)} onKeyDown={(event) => {
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
            <div className="direct-chat-head ai-contact-head">
              <AIContactIdentity profile={aiContact} detail={activeProfile ? `${providerLabel(activeProfile.provider, language)} · ${activeProfile.model}` : t.unavailableAi} />
              <button className="ai-contact-settings-button" type="button" aria-label={t.aiSettings} title={t.aiSettings} onClick={() => {
                setAiDraft(aiContact);
                setAiEditorOpen((open) => !open);
              }}>
                <Settings size={16} />
              </button>
            </div>
            {aiEditorOpen ? <div className="ai-contact-settings-page">
              <div className="ai-contact-settings-card">
                <div className="ai-contact-settings-preview">
                  <span className="user-avatar"><Bot size={18} /></span>
                  <div><strong>{aiDraft.name || aiContact.name}</strong><small>{activeProfile ? `${providerLabel(activeProfile.provider, language)} · ${activeProfile.model}` : t.unavailableAi}</small></div>
                </div>
                <label><span>{t.aiName}</span><input value={aiDraft.name} onChange={(event) => setAiDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                <label><span>{t.aiPersona}</span><textarea rows={6} value={aiDraft.persona} onChange={(event) => setAiDraft((current) => ({ ...current, persona: event.target.value }))} /></label>
                <div className="ai-contact-editor-actions">
                  <button className="primary-action compact" type="button" onClick={saveAIContact}><Check size={14} /><span>{t.saveAiProfile}</span></button>
                </div>
              </div>
            </div> : <>
            <div className="react-message-list" ref={messageListRef} role="log" aria-label="AI 会话消息" aria-live="polite" aria-relevant="additions text" aria-busy={sending}>
              {messages.map((message) => <div key={message.id} className={`react-message ${message.role}`}>
                <ChatMessageAvatar kind={message.role === "user" ? "user" : "ai"} user={props.currentUser} aiContact={aiContact} onOpenProfile={message.role === "user" ? (event) => openMessageProfile(props.currentUser, event, "right") : undefined} />
                <div className="react-message-stack"><time className="react-message-time" dateTime={message.createdAt}>{formatTime(message.createdAt, language)}</time><div className="react-message-bubble">{message.content && <p>{message.content}</p>}<MessageAttachments attachments={chatAttachmentsToDirect(message.attachments)} onPreview={setPreviewAttachment} /></div></div>
              </div>)}
              {sending && messages[messages.length - 1]?.role !== "assistant" && <div className="react-message assistant pending"><ChatMessageAvatar kind="ai" aiContact={aiContact} /><div className="react-message-stack"><time className="react-message-time" dateTime={new Date().toISOString()}>{formatTime(undefined, language)}</time><div className="react-message-bubble"><p>{t.typing}</p></div></div></div>}
              {!messages.length && (activeProfile ? <div className="react-empty-line" role="status" aria-live="polite">{t.startAi}</div> : <div className="chat-model-empty" role="status" aria-live="polite"><Bot size={18} /><div><strong>{t.unavailableAi}</strong><small>{t.modelRequired}</small></div><button className="secondary-button compact" type="button" onClick={openModelHub}>{t.configureModel}</button></div>)}
            </div>
            {error && <p className="react-error-line" role="alert">{error}</p>}
            {!!aiAttachments.length && <PendingAttachmentTray attachments={aiAttachments} label={t.pendingAttachment} onRemove={removeAIAttachment} />}
            {activeProfile && <div className="react-composer ai-composer">
              <input ref={aiFileInputRef} className="chat-file-input" type="file" multiple aria-label="选择附件" onChange={(event) => attachAIFiles(event.target.files)} />
              <button className="secondary-button compact" type="button" aria-label="添加附件" disabled={sending || aiAttachments.length >= 4} onClick={() => aiFileInputRef.current?.click()}><Paperclip size={16} /></button>
              <textarea rows={1} value={draft} aria-label="AI 会话消息内容" placeholder={activeProfile ? t.messagePlaceholder : t.unavailableAi} disabled={!activeProfile || sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitAi();
                }
              }} />
              <button className="primary-action compact" type="button" disabled={(!draft.trim() && !aiAttachments.length) || !activeProfile || sending} onClick={submitAi}><SendHorizonal size={16} /><span>{sending ? t.sending : t.send}</span></button>
            </div>}
            </>}
          </article>
        )}
      {previewAttachment && <ImagePreviewDialog attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />}
      {profilePopover && <MessageProfilePopover popover={profilePopover} onClose={() => setProfilePopover(null)} />}
      {activeDialog === "add-friend" && <AddFriendDialog
        language={language}
        labels={t}
        authToken={props.authToken}
        searchQuery={dialogSearchQuery}
        searchResults={dialogSearchResults}
        searchLoading={dialogSearchLoading}
        friendIds={friendIds}
        outgoingIds={outgoingIds}
        peopleAction={peopleAction}
        onSearchChange={setDialogSearchQuery}
        onAddFriend={addFriend}
        onClose={closeDialog}
      />}
      {activeDialog === "new-group" && <NewGroupDialog
        language={language}
        labels={t}
        authToken={props.authToken}
        groupName={newGroupName}
        selectedMembers={newGroupMembers}
        searchQuery={dialogSearchQuery}
        searchResults={dialogSearchResults}
        searchLoading={dialogSearchLoading}
        friendIds={friendIds}
        friends={summary.friends}
        onGroupNameChange={setNewGroupName}
        onSearchChange={setDialogSearchQuery}
        onToggleMember={toggleGroupMember}
        onCreate={handleCreateGroup}
        onClose={closeDialog}
      />}
      {activeDialog === "new-ai" && <NewAiDialog
        language={language}
        labels={t}
        aiName={newAiName}
        aiPersona={newAiPersona}
        onNameChange={setNewAiName}
        onPersonaChange={setNewAiPersona}
        onCreate={handleCreateAi}
        onClose={closeDialog}
      />}
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

function AIContactIdentity(props: { profile: AIContactProfile; detail: string }) {
  return <span className="direct-user-identity ai-contact-identity"><span className="user-avatar"><Bot size={15} /></span><span><strong>{props.profile.name}</strong><small>{props.detail}</small></span></span>;
}

function ChatMessageAvatar(props: { kind: "user" | "friend" | "ai"; user?: AuthUser | FriendProfile | null; aiContact?: AIContactProfile; onOpenProfile?: (event: React.MouseEvent<HTMLElement>) => void }) {
  if (props.kind === "ai") {
    return <span className="chat-message-avatar ai" aria-label={props.aiContact?.name ?? "AI"}><Bot size={16} /></span>;
  }
  const name = displayFriendName(props.user ?? undefined);
  return (
    <button className={`chat-message-avatar ${props.kind}`} type="button" aria-label={`查看 ${name} 的资料`} onClick={props.onOpenProfile}>
      {props.user?.avatar_url ? <img src={resolveMediaUrl(props.user.avatar_url)} alt="" /> : name.slice(0, 1).toUpperCase()}
    </button>
  );
}

function MessageProfilePopover(props: { popover: ChatProfilePopover; onClose: () => void }) {
  const user = props.popover.user;
  const name = displayFriendName(user);
  const avatarUrl = resolveMediaUrl(user.avatar_url);
  const coverUrl = resolveMediaUrl(user.cover_url);
  const bio = user.bio?.trim() || "还没有设置签名";
  const location = user.location?.trim() || "未设置所在地";
  const popoverWidth = 380;
  const popoverGap = 12;
  const left = props.popover.side === "left" ? Math.min(window.innerWidth - popoverWidth - popoverGap, props.popover.x + 10) : Math.max(popoverGap, props.popover.x - popoverWidth - popoverGap);
  const top = Math.min(Math.max(12, props.popover.y - 104), window.innerHeight - 270);
  return (
    <article className={`message-profile-popover ${coverUrl ? "has-cover" : ""}`} style={coverUrl ? { left, top, backgroundImage: `url(${coverUrl})` } : { left, top }} role="dialog" aria-label={`${name} 的资料卡`}>
      <button className="message-profile-close" type="button" aria-label="关闭资料卡" onClick={props.onClose}><X size={14} /></button>
      <div className="message-profile-head">
        <span className="message-profile-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : name.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{name}</strong>
        </div>
      </div>
      <div className="message-profile-body">
        <span>{location}</span>
        <p>{bio}</p>
      </div>
    </article>
  );
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

function chatAttachmentsToDirect(attachments: ChatAttachment[] | undefined): DirectAttachment[] {
  return (attachments ?? []).map(chatAttachmentToDirect);
}

function messagesForAIProvider(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (!message.attachments?.length) {
      return message;
    }
    const summary = message.attachments.map((attachment, index) => `${index + 1}. ${attachment.name} · ${attachment.kind} · ${formatBytes(attachment.size)}`).join("\n");
    const content = [message.content?.trim(), `用户随消息附带了本地文件/照片，当前只提供附件元数据，不传送文件内容：\n${summary}`].filter(Boolean).join("\n\n");
    return { ...message, content, attachments: undefined };
  });
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

function displayFriendName(user?: AuthUser | FriendProfile | UserSearchResult | null) {
  return user?.display_name || user?.username || user?.email || "我";
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

function loadAIContact(): AIContactProfile {
  try {
    const parsed = JSON.parse(readStorageValue(aiContactKey) ?? "null") as Partial<AIContactProfile> | null;
    return normalizeAIContact(parsed);
  } catch {
    return defaultAIContact();
  }
}

function normalizeAIContact(profile?: Partial<AIContactProfile> | null): AIContactProfile {
  const fallback = defaultAIContact();
  const name = profile?.name?.trim() || fallback.name;
  const persona = profile?.persona?.trim() || fallback.persona;
  return {
    name: name.slice(0, 40),
    persona: persona.slice(0, 500),
  };
}

function defaultAIContact(): AIContactProfile {
  return {
    name: "知己",
    persona: "温和、真诚、像长期陪伴的联系人一样聊天。回复自然一点，少说说明式的话，多关注对方当下的感受。",
  };
}

function readStorageValue(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persistProfileSnapshot(profiles: ModelProfile[], activeProfileId: string) {
  try {
    localStorage.setItem(profilesKey, JSON.stringify(profiles));
    if (activeProfileId) {
      localStorage.setItem(activeProfileKey, activeProfileId);
    }
  } catch {
    // Chat can keep using the in-memory backend profile snapshot.
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

function scrollElementToBottom(element: HTMLElement | null, behavior: ScrollBehavior = "auto") {
  if (!element) return;
  element.scrollTo({ top: element.scrollHeight, behavior });
}

function scheduleScrollToBottom(ref: RefObject<HTMLElement | null>, behavior: ScrollBehavior = "auto") {
  scrollElementToBottom(ref.current, behavior);
  const timers = [0, 50, 100, 200].map((delay) => window.setTimeout(() => scrollElementToBottom(ref.current, "auto"), delay));
  window.requestAnimationFrame(() => scrollElementToBottom(ref.current, "auto"));
  return () => timers.forEach((timer) => window.clearTimeout(timer));
}

function configFromProfile(profile: ModelProfile, aiContact?: AIContactProfile, backendOwned = false): ChatConfig {
  return {
    profileId: backendOwned ? profile.id : undefined,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    systemPrompt: aiContact ? aiSystemPrompt(backendOwned ? undefined : profile.systemPrompt, aiContact) : backendOwned ? "" : profile.systemPrompt ?? "",
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    supportsVision: profile.supportsVision,
    fallbackModel: profile.fallbackModel ?? "",
  };
}

function aiSystemPrompt(basePrompt: string | undefined, aiContact: AIContactProfile) {
  const prompt = [
    `你正在以联系人“${aiContact.name}”的身份和用户聊天。`,
    `你的性格设定：${aiContact.persona}`,
    "表现得像真实联系人陪伴，不要主动解释自己是模型，不要输出系统说明。",
    basePrompt?.trim() ? `额外系统要求：${basePrompt.trim()}` : "",
  ].filter(Boolean).join("\n");
  return prompt;
}

function formatTime(value: string | undefined, language: UiLanguage) {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(Number.isNaN(date.getTime()) ? new Date() : date);
}

function AddFriendDialog(props: {
  language: UiLanguage;
  labels: typeof copy.zh;
  authToken: string;
  searchQuery: string;
  searchResults: UserSearchResult[];
  searchLoading: boolean;
  friendIds: Set<string>;
  outgoingIds: Set<string>;
  peopleAction: string;
  onSearchChange: (query: string) => void;
  onAddFriend: (userId: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [props.onClose]);

  return (
    <div ref={dialogRef} className="chat-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-friend-title" tabIndex={-1} onClick={props.onClose}>
      <div className="chat-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="chat-dialog-header">
          <div>
            <h2 id="add-friend-title">{props.labels.addFriendDialogTitle}</h2>
            <p>{props.labels.addFriendDialogDesc}</p>
          </div>
          <button type="button" className="chat-dialog-close" aria-label={props.labels.cancel} onClick={props.onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="chat-dialog-body">
          <label className="react-search-field">
            <Search size={15} />
            <input
              value={props.searchQuery}
              placeholder={props.labels.searchPlaceholder}
              onChange={(event) => props.onSearchChange(event.target.value)}
              autoFocus
            />
          </label>
          <div className="chat-dialog-search-results">
            {props.searchResults.map((user) => (
              <UserSearchRow
                key={user.id}
                user={user}
                isFriend={props.friendIds.has(user.id)}
                requested={props.outgoingIds.has(user.id)}
                pending={props.peopleAction === `add:${user.id}`}
                onAdd={() => props.onAddFriend(user.id)}
                labels={props.labels}
              />
            ))}
            {props.searchLoading && <p className="react-empty-line">{props.labels.searchingUsers}</p>}
            {!props.searchLoading && props.searchQuery.trim() && !props.searchResults.length && (
              <p className="react-empty-line">{props.labels.noSearchResults}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewGroupDialog(props: {
  language: UiLanguage;
  labels: typeof copy.zh;
  authToken: string;
  groupName: string;
  selectedMembers: string[];
  searchQuery: string;
  searchResults: UserSearchResult[];
  searchLoading: boolean;
  friendIds: Set<string>;
  friends: Array<{ user: FriendProfile }>;
  onGroupNameChange: (name: string) => void;
  onSearchChange: (query: string) => void;
  onToggleMember: (userId: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [props.onClose]);

  return (
    <div ref={dialogRef} className="chat-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-group-title" tabIndex={-1} onClick={props.onClose}>
      <div className="chat-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="chat-dialog-header">
          <div>
            <h2 id="new-group-title">{props.labels.newGroupDialogTitle}</h2>
            <p>{props.labels.newGroupDialogDesc}</p>
          </div>
          <button type="button" className="chat-dialog-close" aria-label={props.labels.cancel} onClick={props.onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="chat-dialog-body">
          <label className="chat-dialog-field">
            <span>{props.labels.groupName}</span>
            <input
              type="text"
              value={props.groupName}
              placeholder={props.labels.groupNamePlaceholder}
              onChange={(event) => props.onGroupNameChange(event.target.value)}
              autoFocus
            />
          </label>
          <div className="chat-dialog-section">
            <strong>{props.labels.selectMembers}</strong>
            <label className="react-search-field">
              <Search size={15} />
              <input
                value={props.searchQuery}
                placeholder={props.labels.searchPlaceholder}
                onChange={(event) => props.onSearchChange(event.target.value)}
              />
            </label>
          </div>
          <div className="chat-dialog-member-list">
            {(props.searchQuery.trim() ? props.searchResults : props.friends.map(f => f.user)).map((user) => (
              <button
                key={user.id}
                type="button"
                className={`chat-dialog-member-item ${props.selectedMembers.includes(user.id) ? "selected" : ""}`}
                onClick={() => props.onToggleMember(user.id)}
              >
                <UserIdentity user={user} />
                {props.selectedMembers.includes(user.id) && <Check size={16} />}
              </button>
            ))}
            {props.searchLoading && <p className="react-empty-line">{props.labels.searchingUsers}</p>}
          </div>
        </div>
        <div className="chat-dialog-footer">
          <button type="button" className="secondary-button" onClick={props.onClose}>
            {props.labels.cancel}
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={!props.groupName.trim()}
            onClick={props.onCreate}
          >
            {props.labels.create}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewAiDialog(props: {
  language: UiLanguage;
  labels: typeof copy.zh;
  aiName: string;
  aiPersona: string;
  onNameChange: (name: string) => void;
  onPersonaChange: (persona: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [props.onClose]);

  return (
    <div ref={dialogRef} className="chat-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-ai-title" tabIndex={-1} onClick={props.onClose}>
      <div className="chat-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="chat-dialog-header">
          <div>
            <h2 id="new-ai-title">{props.labels.newAiDialogTitle}</h2>
            <p>{props.labels.newAiDialogDesc}</p>
          </div>
          <button type="button" className="chat-dialog-close" aria-label={props.labels.cancel} onClick={props.onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="chat-dialog-body">
          <label className="chat-dialog-field">
            <span>{props.labels.aiName}</span>
            <input
              type="text"
              value={props.aiName}
              placeholder={props.labels.aiName}
              onChange={(event) => props.onNameChange(event.target.value)}
              autoFocus
            />
          </label>
          <label className="chat-dialog-field">
            <span>{props.labels.aiPersona}</span>
            <textarea
              rows={6}
              value={props.aiPersona}
              placeholder={props.labels.aiPersona}
              onChange={(event) => props.onPersonaChange(event.target.value)}
            />
          </label>
        </div>
        <div className="chat-dialog-footer">
          <button type="button" className="secondary-button" onClick={props.onClose}>
            {props.labels.cancel}
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={!props.aiName.trim()}
            onClick={props.onCreate}
          >
            {props.labels.create}
          </button>
        </div>
      </div>
    </div>
  );
}
