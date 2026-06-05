import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ImagePlus, LoaderCircle, PlugZap, Wand2 } from "lucide-react";
import { generateImage } from "./services/api";
import type { ImageGenerationConfig, GeneratedImage } from "./types/images";
import type { ModelProfile } from "./types/chat";

const imageConfigKey = "4ever.image.config";
const imageProfileKey = "4ever.image.profile";
const profilesKey = "4ever.model.profiles";
const imageStorageError = "本地保存失败，请检查浏览器存储空间后再继续配置。";

export default function ImageGenerationPanel() {
  const [config, setConfig] = useState<ImageGenerationConfig>(() => loadConfig());
  const [profiles] = useState<ModelProfile[]>(loadProfiles);
  const [selectedProfileId, setSelectedProfileId] = useState(loadImageProfileId);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"" | "pending" | "success" | "error">("");
  const [loading, setLoading] = useState(false);
  const previewRef = useRef<HTMLElement | null>(null);
  const selectedProfile = useMemo(() => selectedProfileId ? profiles.find((profile) => profile.id === selectedProfileId) ?? null : null, [profiles, selectedProfileId]);
  const requestConfig = useMemo(() => imageConfigFromProfile(config, selectedProfile), [config, selectedProfile]);
  const profileSynced = Boolean(selectedProfile);
  const selectedProfileSupportsImage = !selectedProfile || selectedProfile.provider === "openai";
  const canGenerate = Boolean(requestConfig.provider && requestConfig.baseUrl && requestConfig.apiKey && requestConfig.model && requestConfig.prompt);
  const generateBlockedReason = imageGenerateBlockedReason({ canGenerate, loading, selectedProfileSupportsImage });

  useEffect(() => {
    if (!selectedProfileId) return;
    if (profiles.some((profile) => profile.id === selectedProfileId)) return;
    try {
      localStorage.removeItem(imageProfileKey);
      setSelectedProfileId("");
    } catch {
      setMessage(imageStorageError);
      setMessageTone("error");
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (!loading || typeof window === "undefined") {
      return;
    }
    if (!window.matchMedia("(max-width: 980px)").matches) {
      return;
    }
    previewRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }, [loading]);

  function openProviderHub() {
    window.history.pushState({}, "", "/aggregation");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function selectProfile(profileId: string) {
    try {
      if (profileId) {
        localStorage.setItem(imageProfileKey, profileId);
      } else {
        localStorage.removeItem(imageProfileKey);
      }
      setSelectedProfileId(profileId);
      setMessage("");
      setMessageTone("");
    } catch {
      setMessage(imageStorageError);
      setMessageTone("error");
    }
  }

  function patch(patchValue: Partial<ImageGenerationConfig>) {
    const next = { ...config, ...patchValue };
    try {
      localStorage.setItem(imageConfigKey, JSON.stringify(next));
      setConfig(next);
      setMessage("");
      setMessageTone("");
    } catch {
      setMessage(imageStorageError);
      setMessageTone("error");
    }
  }

  async function submit() {
    if (!canGenerate || loading) return;
    setLoading(true);
    setMessage("正在生成...");
    setMessageTone("pending");
    try {
      const response = await generateImage(requestConfig);
      setImages(response.images ?? []);
      setMessage(response.message || "生成完成。");
      setMessageTone("success");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "生成失败");
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="react-image-panel">
      <div className="module-view-header">
        <div><p className="eyebrow">图像生成</p><h1>虚实</h1></div>
        <button className="primary-action compact" type="button" onClick={submit} disabled={Boolean(generateBlockedReason)} title={generateBlockedReason || "生成图像"}>
          {loading ? <LoaderCircle className="spin" size={16} /> : <Wand2 size={16} />}
          <span>{loading ? "生成中" : "生成"}</span>
        </button>
      </div>
      <div className="react-image-layout">
        <article className="react-profile-form">
          <div className="image-profile-sync">
            <div>
              <strong>{selectedProfile ? "使用中枢配置" : "未连接中枢"}</strong>
              <small>{selectedProfile ? `${selectedProfile.name} · ${providerLabel(selectedProfile.provider)} · 接口地址 / Key 已同步` : "可使用虚实自己的 API Key 与接口地址"}</small>
            </div>
            {profiles.length ? (
              <select value={selectedProfile?.id ?? ""} aria-label="选择图像接口配置" onChange={(event) => selectProfile(event.target.value)}>
                <option value="">独立配置</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {providerLabel(profile.provider)}</option>)}
              </select>
            ) : (
              <button className="secondary-button compact" type="button" onClick={openProviderHub}>
                <PlugZap size={15} />
                <span>配置 API</span>
              </button>
            )}
          </div>
          <label><span>供应商<em>*</em></span><input value={requestConfig.provider} aria-label="图像供应商" placeholder="openai" disabled={profileSynced} onChange={(event) => patch({ provider: event.target.value })} /></label>
          <label><span>接口地址<em>*</em></span><input value={requestConfig.baseUrl} aria-label="图像接口地址" placeholder="https://api.openai.com/v1" disabled={profileSynced} onChange={(event) => patch({ baseUrl: event.target.value })} /></label>
          <label><span>模型<em>*</em></span><input value={config.model} aria-label="图像模型" placeholder="例如：gpt-image-1" onChange={(event) => patch({ model: event.target.value })} /></label>
          <label><span>API Key<em>*</em></span><input type="password" value={requestConfig.apiKey} aria-label="图像 API Key" placeholder="粘贴图像模型 API Key" autoComplete="off" disabled={profileSynced} onChange={(event) => patch({ apiKey: event.target.value })} /></label>
          <label><span>尺寸</span><input value={config.size} aria-label="图像尺寸" placeholder="1024x1024" onChange={(event) => patch({ size: event.target.value })} /></label>
          <label><span>提示词<em>*</em></span><textarea value={config.prompt} aria-label="图像提示词" placeholder="描述画面主体、风格、构图和需要避免的元素" onChange={(event) => patch({ prompt: event.target.value })} /></label>
          {!selectedProfileSupportsImage && <p className="react-error-line" role="alert">当前中枢配置不是 OpenAI 兼容图像接口，请切换到 OpenAI 兼容配置或使用独立配置。</p>}
          {generateBlockedReason && <p className="react-status-line" role="status" aria-live="polite"><PlugZap size={14} />{generateBlockedReason}</p>}
          {message && <p className={`react-status-line ${messageTone}`} role={messageTone === "error" ? "alert" : "status"} aria-live={messageTone === "error" ? undefined : "polite"}>{messageTone === "pending" ? <LoaderCircle className="spin" size={14} /> : messageTone === "error" ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}{message}</p>}
        </article>
        <article className="react-image-preview" ref={previewRef} aria-label="图像生成结果" aria-live="polite" aria-busy={loading}>
          {loading ? (
            <div className="react-note-empty image-generating-state" role="status" aria-live="polite"><LoaderCircle className="spin" size={34} /><strong>正在生成图像</strong></div>
          ) : images.length ? (
            images.map((image, index) => <img key={index} src={image.url ?? `data:image/png;base64,${image.b64_json}`} alt={image.revised_prompt ?? config.prompt} />)
          ) : (
            <div className="react-note-empty" role="status" aria-live="polite"><ImagePlus size={34} /><strong>生成结果会出现在这里</strong></div>
          )}
        </article>
      </div>
    </section>
  );
}

function imageGenerateBlockedReason({ canGenerate, loading, selectedProfileSupportsImage }: { canGenerate: boolean; loading: boolean; selectedProfileSupportsImage: boolean }) {
  if (loading) return "正在生成，请等待当前结果返回。";
  if (!selectedProfileSupportsImage) return "当前中枢配置不支持图像生成。";
  if (!canGenerate) return "请补齐 API 配置和提示词。";
  return "";
}

function loadProfiles(): ModelProfile[] {
  try {
    const parsed = JSON.parse(readStorageValue(profilesKey) ?? "[]") as ModelProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadImageProfileId() {
  return readStorageValue(imageProfileKey) ?? "";
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function imageConfigFromProfile(config: ImageGenerationConfig, profile: ModelProfile | null): ImageGenerationConfig {
  if (!profile) {
    return config;
  }
  return {
    ...config,
    provider: profile.provider === "openai" ? "openai" : "custom",
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
  };
}

function providerLabel(provider: ModelProfile["provider"]) {
  return {
    openai: "OpenAI 兼容",
    anthropic: "Anthropic 消息",
    gemini: "Gemini 生成",
  }[provider];
}

function loadConfig(): ImageGenerationConfig {
  try {
    return {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-image-1",
      size: "1024x1024",
      prompt: "",
      ...JSON.parse(readStorageValue(imageConfigKey) ?? "{}"),
    };
  } catch {
    return { provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-image-1", size: "1024x1024", prompt: "" };
  }
}

function readStorageValue(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
