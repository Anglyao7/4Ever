import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Eye, EyeOff, KeyRound, Plus, Save, Trash2 } from "lucide-react";
import { fetchProviders, testProviderConnection } from "./services/api";
import type { ChatConfig, ModelProfile, ProviderFormat, ProviderInfo } from "./types/chat";

const profilesKey = "4ever.model.profiles";
const activeProfileKey = "4ever.model.activeProfile";

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
  const [activeId, setActiveId] = useState(() => localStorage.getItem(activeProfileKey) ?? profiles[0]?.id ?? "");
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState("");
  const activeProfile = profiles.find((profile) => profile.id === activeId) ?? profiles[0] ?? null;
  const draft = activeProfile ?? createProfile("默认 API", providers[0]);
  const canSave = Boolean(draft.name.trim() && draft.baseUrl.trim() && draft.model.trim() && draft.apiKey.trim());
  const providerOptions = useMemo(() => providers.length ? providers : fallbackProviders, [providers]);

  useEffect(() => {
    fetchProviders().then(setProviders).catch(() => setProviders(fallbackProviders));
  }, []);

  function commit(nextProfiles: ModelProfile[], nextActiveId = activeId) {
    setProfiles(nextProfiles);
    setActiveId(nextActiveId);
    localStorage.setItem(profilesKey, JSON.stringify(nextProfiles));
    localStorage.setItem(activeProfileKey, nextActiveId);
  }

  function addProfile() {
    const profile = createProfile(`API ${profiles.length + 1}`, providerOptions[0]);
    commit([profile, ...profiles], profile.id);
  }

  function patchProfile(patch: Partial<ModelProfile>) {
    if (!activeProfile) {
      const profile = { ...draft, ...patch };
      commit([profile], profile.id);
      return;
    }
    commit(profiles.map((profile) => profile.id === activeProfile.id ? { ...profile, ...patch } : profile), activeProfile.id);
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
    if (!canSave) {
      setMessage("API 名称、Base URL、Model、Key 都填写后才能测试。");
      return;
    }
    setMessage("正在测试连接...");
    try {
      const result = await testProviderConnection(configFromProfile(draft));
      setMessage(result.ok ? `连接成功，可用模型 ${result.model_count} 个。` : result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "连接失败");
    }
  }

  return (
    <section className="react-model-hub">
      <div className="module-view-header">
        <div><p className="eyebrow">Provider Hub</p><h1>接口中枢</h1></div>
        <button className="primary-action compact" type="button" onClick={addProfile}><Plus size={16} /><span>新增 API</span></button>
      </div>
      <div className="react-model-grid">
        <aside className="react-profile-list">
          {profiles.map((profile) => (
            <button key={profile.id} className={`react-profile-card ${profile.id === draft.id ? "active" : ""}`} type="button" onClick={() => commit(profiles, profile.id)}>
              <Bot size={17} />
              <span><strong>{profile.name}</strong><small>{profile.provider} · {profile.model}</small></span>
            </button>
          ))}
          {!profiles.length && <p className="react-empty-line">还没有 API 配置</p>}
        </aside>
        <article className="react-profile-form">
          <label><span>API 名称</span><input value={draft.name} onChange={(event) => patchProfile({ name: event.target.value })} /></label>
          <label><span>供应商</span><select value={draft.provider} onChange={(event) => changeProvider(event.target.value as ProviderFormat)}>{providerOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
          <label><span>Base URL</span><input value={draft.baseUrl} onChange={(event) => patchProfile({ baseUrl: event.target.value })} /></label>
          <label><span>Model</span><input value={draft.model} onChange={(event) => patchProfile({ model: event.target.value })} /></label>
          <label><span>API Key</span><div className="react-secret-row"><input type={showKey ? "text" : "password"} value={draft.apiKey} onChange={(event) => patchProfile({ apiKey: event.target.value })} /><button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
          <label><span>系统提示词</span><textarea value={draft.systemPrompt ?? ""} onChange={(event) => patchProfile({ systemPrompt: event.target.value })} /></label>
          <div className="react-form-actions">
            <button className="secondary-button" type="button" onClick={testConnection}><KeyRound size={15} /><span>测试连接</span></button>
            <button className="primary-action compact" type="button" disabled={!canSave} onClick={() => {
              commit(profiles.length ? profiles : [draft], draft.id);
              setMessage("已保存。");
            }}><Save size={15} /><span>保存</span></button>
            {profiles.length > 1 && <button className="secondary-button danger" type="button" onClick={() => commit(profiles.filter((profile) => profile.id !== draft.id), profiles.find((profile) => profile.id !== draft.id)?.id ?? "")}><Trash2 size={15} /><span>删除</span></button>}
          </div>
          {message && <p className="react-status-line"><CheckCircle2 size={14} />{message}</p>}
        </article>
      </div>
    </section>
  );
}

const fallbackProviders: ProviderInfo[] = [
  { id: "openai", label: "OpenAI Compatible", default_base_url: "https://api.openai.com/v1", default_model: "gpt-4o-mini", auth_label: "API Key", endpoint: "/chat/completions" },
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
    const parsed = JSON.parse(localStorage.getItem(profilesKey) ?? "[]") as ModelProfile[];
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
