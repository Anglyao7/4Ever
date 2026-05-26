import { useState } from "react";
import { ImagePlus, LoaderCircle, Wand2 } from "lucide-react";
import { generateImage } from "./services/api";
import type { ImageGenerationConfig, GeneratedImage } from "./types/images";

const imageConfigKey = "4ever.image.config";

export default function ImageGenerationPanel() {
  const [config, setConfig] = useState<ImageGenerationConfig>(() => loadConfig());
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const canGenerate = Boolean(config.provider && config.baseUrl && config.apiKey && config.model && config.prompt);

  function patch(patchValue: Partial<ImageGenerationConfig>) {
    const next = { ...config, ...patchValue };
    setConfig(next);
    localStorage.setItem(imageConfigKey, JSON.stringify(next));
  }

  async function submit() {
    if (!canGenerate || loading) return;
    setLoading(true);
    setMessage("正在生成...");
    try {
      const response = await generateImage(config);
      setImages(response.images ?? []);
      setMessage(response.message || "生成完成。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="react-image-panel">
      <div className="module-view-header">
        <div><p className="eyebrow">Image</p><h1>绘影</h1></div>
        <button className="primary-action compact" type="button" onClick={submit} disabled={!canGenerate || loading}>{loading ? <LoaderCircle size={16} /> : <Wand2 size={16} />}生成</button>
      </div>
      <div className="react-image-layout">
        <article className="react-profile-form">
          <label><span>Provider</span><input value={config.provider} onChange={(event) => patch({ provider: event.target.value })} /></label>
          <label><span>Base URL</span><input value={config.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} /></label>
          <label><span>Model</span><input value={config.model} onChange={(event) => patch({ model: event.target.value })} /></label>
          <label><span>API Key</span><input type="password" value={config.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} /></label>
          <label><span>Size</span><input value={config.size} onChange={(event) => patch({ size: event.target.value })} /></label>
          <label><span>Prompt</span><textarea value={config.prompt} onChange={(event) => patch({ prompt: event.target.value })} /></label>
          {message && <p className="react-status-line">{message}</p>}
        </article>
        <article className="react-image-preview">
          {images.length ? images.map((image, index) => <img key={index} src={image.url ?? `data:image/png;base64,${image.b64_json}`} alt={image.revised_prompt ?? config.prompt} />) : <div className="react-note-empty"><ImagePlus size={34} /><strong>生成结果会出现在这里</strong></div>}
        </article>
      </div>
    </section>
  );
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
      ...JSON.parse(localStorage.getItem(imageConfigKey) ?? "{}"),
    };
  } catch {
    return { provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-image-1", size: "1024x1024", prompt: "" };
  }
}
