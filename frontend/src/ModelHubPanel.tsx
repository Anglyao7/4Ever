import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, Download, Eye, EyeOff, KeyRound, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { fetchProviders, testProviderConnection, fetchProviderModels } from "./services/api";
import type { ChatConfig, ModelProfile, ProviderFormat, ProviderInfo, ProviderModel } from "./types/chat";

const profilesKey = "4ever.model.profiles";
const activeProfileKey = "4ever.model.activeProfile";
const imageProfileKey = "4ever.image.profile";
const modelHubStorageError = "本地保存失败，请检查浏览器存储空间后再继续配置。";

const defaultPet = {
  name: "小火花",
  species: "spark" as const,
  level: 1,
  experience: 0,
  mood: 80,
  satiety: 80,
  energy: 80,
  lastAction: "刚刚醒来",
  dailyInteractionDate: "",
  dailyFeedCount: 0,
  dailyPetCount: 0,
  dailyQuestCount: 0,
};

export default function ModelHubPanel() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [profiles, setProfiles] = useState<ModelProfile[]>(loadProfiles);
  const [activeId, setActiveId] = useState(() => loadActiveProfileId() || (profiles[0]?.id ?? ""));
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<ProviderModel[]>([]);
  const activeProfile = profiles.find((profile) => profile.id === activeId) ?? profiles[0] ?? null;
  const draft = activeProfile ?? createProfile("默认 API", providers[0]);
  const canSave = Boolean(draft.name.trim() && draft.baseUrl.trim() && draft.model.trim() && draft.apiKey.trim());
  const canCheckModels = Boolean(draft.name.trim() && draft.baseUrl.trim() && draft.apiKey.trim());
  const missingFields = requiredProfileFields(draft);
  const missingConnectionFields = requiredConnectionFields(draft);
  const statusTone = messageTone(message);
  const providerOptions = useMemo(() => providers.length ? providers : fallbackProviders, [providers]);

  useEffect(() => {
    fetchProviders().then(setProviders).catch(() => setProviders(fallbackProviders));
  }, []);

  function commit(nextProfiles: ModelProfile[], nextActiveId = activeId) {
    const previousProfiles = readStorageValue(profilesKey);
    const previousActiveId = readStorageValue(activeProfileKey);
    const previousImageProfileId = readStorageValue(imageProfileKey);
    try {
      localStorage.setItem(profilesKey, JSON.stringify(nextProfiles));
      if (nextActiveId) {
        localStorage.setItem(activeProfileKey, nextActiveId);
      } else {
        localStorage.removeItem(activeProfileKey);
      }
      const imageProfileId = readStorageValue(imageProfileKey) ?? "";
      if (imageProfileId && !nextProfiles.some((profile) => profile.id === imageProfileId)) {
        localStorage.removeItem(imageProfileKey);
      }
      setProfiles(nextProfiles);
      setActiveId(nextActiveId);
      setDeleteConfirmId("");
      return true;
    } catch {
      restoreStorageValue(profilesKey, previousProfiles);
      restoreStorageValue(activeProfileKey, previousActiveId);
      restoreStorageValue(imageProfileKey, previousImageProfileId);
      setMessage(modelHubStorageError);
      return false;
    }
  }

  function addProfile() {
    const profile = createProfile(`API ${profiles.length + 1}`, providerOptions[0]);
    commit([profile, ...profiles], profile.id);
  }

  function patchProfile(patch: Partial<ModelProfile>) {
    if (patch.provider || patch.baseUrl !== undefined || patch.apiKey !== undefined) {
      setAvailableModels([]);
    }
    if (!activeProfile) {
      const profile = { ...draft, ...patch };
      commit([profile], profile.id);
      return;
    }
    commit(profiles.map((profile) => profile.id === activeProfile.id ? { ...profile, ...patch } : profile), activeProfile.id);
  }

  function requestDeleteProfile() {
    if (!activeProfile) return;
    if (deleteConfirmId !== activeProfile.id) {
      setDeleteConfirmId(activeProfile.id);
      setMessage("再次点击确认删除当前 API 配置。");
      return;
    }
    if (commit(profiles.filter((profile) => profile.id !== activeProfile.id), profiles.find((profile) => profile.id !== activeProfile.id)?.id ?? "")) {
      setMessage("已删除 API 配置。");
    }
  }

  function selectProfile(profileId: string) {
    setMessage("");
    setAvailableModels([]);
    commit(profiles, profileId);
  }

  function changeProvider(provider: ProviderFormat) {
    const option = providerOptions.find((item) => item.id === provider);
    patchProfile({
      provider,
      baseUrl: option?.default_base_url ?? draft.baseUrl,
      model: option?.default_model ?? draft.model,
    });
  }

  async function testConnection() {
    if (testingConnection) return;
    if (!canCheckModels) {
      setMessage(`${missingConnectionFields.join("、")} 填写后才能测试连接。`);
      return;
    }
    setTestingConnection(true);
    setMessage("正在测试连接并读取模型列表...");
    try {
      const result = await testProviderConnection(configFromProfile(draft));
      const models = result.models ?? [];
      setAvailableModels(models);
      setMessage(result.ok ? `连接成功，已读取 ${result.model_count} 个模型。` : result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "连接失败");
    } finally {
      setTestingConnection(false);
    }
  }

  async function fetchCurrentModels() {
    if (fetchingModels) return;
    if (!canCheckModels) {
      setMessage(`${missingConnectionFields.join("、")} 填写后才能获取模型。`);
      return;
    }
    setFetchingModels(true);
    setMessage("正在获取当前 API 的模型列表...");
    try {
      const result = await fetchProviderModels(configFromProfile(draft));
      setAvailableModels(result.models);
      setMessage(result.models.length ? `已获取 ${result.models.length} 个模型，点击下方模型即可选用。` : "连接成功，但当前 API 没有返回模型列表。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "获取模型失败");
    } finally {
      setFetchingModels(false);
    }
  }

  function selectModel(model: ProviderModel) {
    patchProfile({ model: model.id });
    setMessage(`已选择模型 ${model.id}。`);
  }

  return (
    <section className="react-model-hub">
      <div className="module-view-header">
        <div><p className="eyebrow">接口配置</p><h1>接口中枢</h1></div>
        <button className="primary-action compact" type="button" onClick={addProfile}>
          <Plus size={16} />
          <span>新增 API</span>
        </button>
      </div>
      <div className="model-hub-status-grid" aria-label="接口状态">
        <div className={`model-hub-status-card ${canSave ? "ready" : "warning"}`} role="status" aria-live="polite">
          <span><Bot size={16} /></span>
          <div>
            <strong>{activeProfile ? activeProfile.name : "默认 API"}</strong>
            <small>{canSave ? `当前全局生效 · ${providerLabel(draft.provider)} · ${draft.model}` : "当前配置还不能供聊天、灵感和秩序使用"}</small>
          </div>
        </div>
        <div className={`model-hub-status-card ${canSave ? "ready" : "warning"}`} role="status" aria-live="polite">
          <span><KeyRound size={16} /></span>
          <div>
            <strong>{canSave ? "配置完整" : `缺少 ${missingFields.join("、")}`}</strong>
            <small>{canSave ? "当前配置完整，聊天、灵感和秩序会读取这组全局配置。" : "补齐必填项后再测试连接。"}</small>
          </div>
        </div>
      </div>
      <div className="react-model-grid">
        <aside className="react-profile-list">
          {profiles.map((profile) => (
            <button key={profile.id} className={`react-profile-card ${profile.id === draft.id ? "active" : ""}`} type="button" aria-current={profile.id === draft.id ? "true" : undefined} onClick={() => selectProfile(profile.id)}>
              <Bot size={17} />
              <span><strong>{profile.name}</strong><small>{providerLabel(profile.provider)} · {profile.model}</small></span>
            </button>
          ))}
          {!profiles.length && <div className="model-profile-empty" role="status" aria-live="polite"><KeyRound size={18} /><strong>还没有 API 配置</strong><small>先填写右侧表单；配置完整后，聊天、灵感和秩序会读取这里的全局当前配置。</small></div>}
        </aside>
        <article className="react-profile-form">
          <label><span>API 名称<em>必填</em></span><input value={draft.name} aria-label="API 配置名称" placeholder="例如：工作助手 API" onChange={(event) => patchProfile({ name: event.target.value })} /></label>
          <label><span>供应商</span><select value={draft.provider} aria-label="模型供应商" onChange={(event) => changeProvider(event.target.value as ProviderFormat)}>{providerOptions.map((provider) => <option key={provider.id} value={provider.id}>{providerLabel(provider.id)}</option>)}</select></label>
          <label><span>接口地址<em>必填</em></span><input value={draft.baseUrl} aria-label="模型接口地址" placeholder="https://api.openai.com/v1" onChange={(event) => patchProfile({ baseUrl: event.target.value })} /></label>
          <label><span>模型<em>必填</em></span><input value={draft.model} aria-label="模型名称" placeholder="可手填，或先获取模型后点击选择" onChange={(event) => patchProfile({ model: event.target.value })} /></label>
          {availableModels.length > 0 && (
            <div className="provider-model-picker" aria-label="当前 API 支持的模型">
              <div className="provider-model-picker-head"><strong>当前 API 支持的模型</strong><small>{availableModels.length} 个</small></div>
              <div className="provider-model-options">
                {availableModels.map((model) => (
                  <button key={model.id} className={`provider-model-option ${draft.model === model.id ? "active" : ""}`} type="button" aria-pressed={draft.model === model.id} onClick={() => selectModel(model)}>
                    <strong>{model.id}</strong>
                    {model.label !== model.id && <small>{model.label}</small>}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label><span>API Key<em>必填</em></span><div className="react-secret-row"><input type={showKey ? "text" : "password"} value={draft.apiKey} aria-label="模型 API Key" placeholder="粘贴供应商提供的 API Key" autoComplete="off" onChange={(event) => patchProfile({ apiKey: event.target.value })} /><button type="button" aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} title={showKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
          <label><span>系统提示词</span><textarea value={draft.systemPrompt ?? ""} aria-label="系统提示词" placeholder="可选：定义助手的角色、边界和回复风格" onChange={(event) => patchProfile({ systemPrompt: event.target.value })} /></label>
          {!canSave && <p className="react-status-line pending" role="status" aria-live="polite">请补齐 {missingFields.join("、")}，否则全局 AI 功能会保持不可用。</p>}
          <div className={`react-form-actions ${deleteConfirmId === draft.id ? "confirming-delete" : ""}`}>
            <button className="secondary-button" type="button" disabled={!canCheckModels || testingConnection} title={canCheckModels ? "测试当前 API 并读取支持模型" : `请先补齐 ${missingConnectionFields.join("、")}`} onClick={testConnection}>{testingConnection ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}<span>{testingConnection ? "测试中" : "测试连接"}</span></button>
            <button className="secondary-button" type="button" disabled={!canCheckModels || fetchingModels} title={canCheckModels ? "获取当前 API 的所有模型" : `请先补齐 ${missingConnectionFields.join("、")}`} onClick={fetchCurrentModels}>{fetchingModels ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}<span>{fetchingModels ? "获取中" : "获取所有模型"}</span></button>
            <button className="primary-action" type="button" disabled={!canSave || testingConnection || fetchingModels} onClick={() => {
              if (commit(profiles.length ? profiles : [draft], draft.id)) {
                setMessage("已确认这组全局当前配置。");
              }
            }}><Save size={15} /><span>确认全局当前</span></button>
            {profiles.length > 1 && <button className="secondary-button danger" type="button" disabled={testingConnection || fetchingModels} title={deleteConfirmId === draft.id ? "再次点击会删除当前 API 配置" : "删除当前 API 配置"} onClick={requestDeleteProfile}><Trash2 size={15} /><span>{deleteConfirmId === draft.id ? "确认删除" : "删除"}</span></button>}
            {deleteConfirmId === draft.id && <button className="secondary-button compact" type="button" onClick={() => {
              setDeleteConfirmId("");
              setMessage("");
            }}>取消</button>}
          </div>
          {message && <p className={`react-status-line ${statusTone}`} role={statusTone === "error" ? "alert" : "status"} aria-live={statusTone === "error" ? undefined : "polite"}>{statusIcon(statusTone)}{message}</p>}
        </article>
      </div>
    </section>
  );
}

const fallbackProviders: ProviderInfo[] = [
  { id: "openai", label: "OpenAI 兼容", default_base_url: "https://api.openai.com/v1", default_model: "gpt-4o-mini", auth_label: "API Key", endpoint: "/chat/completions" },
  { id: "anthropic", label: "Anthropic", default_base_url: "https://api.anthropic.com", default_model: "claude-3-5-sonnet-latest", auth_label: "API Key", endpoint: "/v1/messages" },
  { id: "gemini", label: "Gemini", default_base_url: "https://generativelanguage.googleapis.com", default_model: "gemini-1.5-flash", auth_label: "API Key", endpoint: "/v1beta/models" },
];

function createProfile(name: string, provider = fallbackProviders[0]): ModelProfile {
  return {
    id: `profile-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    name,
    provider: provider.id,
    baseUrl: provider.default_base_url,
    apiKey: "",
    model: provider.default_model,
    temperature: 0.7,
    maxTokens: 1200,
    systemPrompt: "",
    persona: { alias: name, role: "助手", temperament: "清晰、直接", notes: "" },
    pet: defaultPet,
  };
}

function loadProfiles(): ModelProfile[] {
  try {
    const parsed = JSON.parse(readStorageValue(profilesKey) ?? "[]") as ModelProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadActiveProfileId() {
  return readStorageValue(activeProfileKey) ?? "";
}

function readStorageValue(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function restoreStorageValue(key: string, value: string | null) {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Best-effort rollback; the form keeps the previous state and shows the save error.
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

function requiredProfileFields(profile: ModelProfile) {
  return [
    ["API 名称", profile.name],
    ["接口地址", profile.baseUrl],
    ["模型", profile.model],
    ["API Key", profile.apiKey],
  ].filter(([, value]) => !String(value ?? "").trim()).map(([label]) => label);
}

function requiredConnectionFields(profile: ModelProfile) {
  return [
    ["API 名称", profile.name],
    ["接口地址", profile.baseUrl],
    ["API Key", profile.apiKey],
  ].filter(([, value]) => !String(value ?? "").trim()).map(([label]) => label);
}

function providerLabel(provider: ProviderFormat) {
  return {
    openai: "OpenAI 兼容",
    anthropic: "Anthropic 消息",
    gemini: "Gemini 生成",
  }[provider];
}

function messageTone(message: string) {
  if (/失败|错误|不可用|不能|删除当前/.test(message)) return "error";
  if (/正在|测试/.test(message)) return "pending";
  if (/成功|已保存|已确认|已删除|可用/.test(message)) return "success";
  return "";
}

function statusIcon(tone: string) {
  if (tone === "pending") return <LoaderCircle className="spin" size={14} />;
  if (tone === "error") return <AlertCircle size={14} />;
  return <CheckCircle2 size={14} />;
}
