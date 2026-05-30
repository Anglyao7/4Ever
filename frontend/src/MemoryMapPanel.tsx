import { useMemo, useRef, useState } from "react";
import { Camera, Loader2, MapPin, Save, Search, Trash2 } from "lucide-react";
import { searchTencentCities } from "./services/api";
import type { TencentCitySearchResult } from "./types/platform";

type CityMemory = {
  id: string;
  city: TencentCitySearchResult;
  emoji: string;
  note: string;
  photos: string[];
  updatedAt: string;
};

type Notice = {
  area: "search" | "album";
  message: string;
};

const storageKey = "4ever.memoryMap.cityMemories";

export default function MemoryMapPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TencentCitySearchResult[]>([]);
  const [memories, setMemories] = useState<CityMemory[]>(loadMemories);
  const [selectedId, setSelectedId] = useState(memories[0]?.id ?? "");
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState("");
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const selected = memories.find((memory) => memory.id === selectedId) ?? memories[0] ?? null;

  const pins = useMemo(() => memories.slice(0, 18), [memories]);

  async function searchCities() {
    const keyword = query.trim();
    setDeleteConfirmId("");
    if (!keyword) {
      setResults([]);
      setError("");
      setNotice(null);
      setHasSearched(false);
      return;
    }
    setSearching(true);
    setHasSearched(true);
    setResults([]);
    setError("");
    setNotice(null);
    try {
      const found = await searchTencentCities(keyword);
      setResults(found);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "城市搜索失败");
    } finally {
      setSearching(false);
    }
  }

  function updateQuery(value: string) {
    setQuery(value);
    setDeleteConfirmId("");
    if (!value.trim()) {
      setResults([]);
      setError("");
      setNotice(null);
      setHasSearched(false);
    }
  }

  function selectCity(city: TencentCitySearchResult) {
    const existing = memories.find((memory) => memory.city.id === city.id || memory.city.name === city.name);
    if (existing) {
      setDeleteConfirmId("");
      setSelectedId(existing.id);
      setSaveError("");
      setNotice({ area: "album", message: `已打开 ${existing.city.name} 的纪念册。` });
      return;
    }
    const next: CityMemory = {
      id: `memory-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      city,
      emoji: "✨",
      note: "",
      photos: [],
      updatedAt: new Date().toISOString(),
    };
    if (commit([next, ...memories], next.id)) {
      setNotice({ area: "album", message: `已创建 ${city.name} 的纪念册。` });
    }
  }

  function updateMemory(patch: Partial<CityMemory>) {
    if (!selected) return;
    return commit(memories.map((memory) => memory.id === selected.id ? { ...memory, ...patch, updatedAt: new Date().toISOString() } : memory), selected.id);
  }

  async function addPhotos(files: FileList | null) {
    try {
      if (!selected || !files?.length) return;
      setSaveError("");
      setNotice(null);
      const availableSlots = Math.max(0, 12 - selected.photos.length);
      const filesToRead = [...files].slice(0, Math.min(8, availableSlots));
      if (!filesToRead.length) {
        setNotice({ area: "album", message: "当前纪念册最多保留 12 张照片，请先删除旧照片后再上传。" });
        return;
      }
      const dataUrls = await Promise.all(filesToRead.map(readFileAsDataUrl));
      if (updateMemory({ photos: [...dataUrls, ...selected.photos].slice(0, 12) })) {
        setNotice({ area: "album", message: files.length > filesToRead.length ? `已添加 ${dataUrls.length} 张照片，纪念册最多保留 12 张。` : `已添加 ${dataUrls.length} 张照片。` });
      }
    } catch (cause) {
      setNotice(null);
      setSaveError(cause instanceof Error ? cause.message : "照片读取失败，请重新选择图片后再试。");
    } finally {
      if (photoInputRef.current) {
        photoInputRef.current.value = "";
      }
    }
  }

  function commit(next: CityMemory[], nextSelected = selectedId) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setMemories(next);
      setSelectedId(nextSelected);
      setDeleteConfirmId("");
      setError("");
      setSaveError("");
      return true;
    } catch {
      setNotice(null);
      setSaveError("本地保存失败，请检查浏览器存储空间后再继续记录。");
      return false;
    }
  }

  function requestDeleteMemory() {
    if (!selected) return;
    if (deleteConfirmId !== selected.id) {
      setDeleteConfirmId(selected.id);
      setNotice(null);
      setSaveError("");
      return;
    }
    if (commit(memories.filter((memory) => memory.id !== selected.id), memories.find((memory) => memory.id !== selected.id)?.id ?? "")) {
      setNotice({ area: "album", message: "已删除当前城市纪念。" });
    }
  }

  return (
    <section className="react-map-panel">
      <div className="module-view-header">
        <div><p className="eyebrow">记忆地图</p><h1>地图纪念</h1></div>
        <span className="react-soft-stat">{memories.length} 座城市</span>
      </div>
      <div className="react-map-layout">
        <aside className="react-map-search">
          <label className="react-search-field"><Search size={15} /><input value={query} aria-label="搜索城市" placeholder="搜索任意城市" onChange={(event) => updateQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && searchCities()} /></label>
          <button className="primary-action compact" type="button" onClick={searchCities} disabled={searching}>{searching ? <Loader2 size={16} className="spinning" /> : <Search size={16} />}<span>{searching ? "搜索中" : "搜索城市"}</span></button>
          {error && <p className="react-error-line" role="alert">{error}</p>}
          {notice?.area === "search" && <p className="react-status-line success" role="status" aria-live="polite"><Save size={14} />{notice.message}</p>}
          <div className="react-city-results">
            {searching && <div className="react-city-search-state" role="status" aria-live="polite"><Loader2 size={18} className="spinning" /><strong>正在搜索城市</strong><small>匹配结果会显示在这里。</small></div>}
            {!searching && !error && !results.length && <div className="react-city-search-state" role="status" aria-live="polite"><Search size={18} /><strong>{hasSearched ? "没有找到城市" : "搜索结果会显示在这里"}</strong><small>{hasSearched ? "换个关键词再试一次。" : "输入城市名并搜索，然后选择要记录的地点。"}</small></div>}
            {results.map((city) => <button key={city.id} type="button" aria-label={`记录城市：${city.name}，${city.region}`} onClick={() => selectCity(city)}><MapPin size={15} /><span><strong>{city.name}</strong><small>{city.region}</small></span></button>)}
          </div>
        </aside>
        <div className="react-map-canvas">
          <div className="react-map-grid" aria-hidden="true" />
          {pins.map((memory, index) => (
            <button
              key={memory.id}
              className={`react-map-pin ${memory.id === selected?.id ? "active" : ""}`}
              type="button"
              aria-current={memory.id === selected?.id ? "location" : undefined}
              aria-label={`打开记忆：${memory.city.name}`}
              style={{ left: `${12 + (index * 23) % 76}%`, top: `${18 + (index * 31) % 62}%` }}
              onClick={() => {
                setDeleteConfirmId("");
                setSaveError("");
                setSelectedId(memory.id);
              }}
            >
              <span>{memory.emoji}</span>
              <small>{memory.city.name}</small>
            </button>
          ))}
          {!pins.length && <div className="react-map-empty" role="status" aria-live="polite"><MapPin size={28} /><strong>搜索城市，开始第一本纪念册</strong></div>}
        </div>
        <article className="react-memory-album">
          {notice?.area === "album" && <p className="react-status-line success" role="status" aria-live="polite"><Save size={14} />{notice.message}</p>}
          {saveError && <p className="react-status-line error" role="alert"><Save size={14} />{saveError}</p>}
          {selected ? (
            <>
              <header><span>{selected.emoji}</span><div><p className="eyebrow">{selected.city.region}</p><h2>{selected.city.name}</h2></div></header>
              <label><span>Emoji 状态</span><input value={selected.emoji} aria-label="Emoji 状态" maxLength={4} onChange={(event) => updateMemory({ emoji: event.target.value || "✨" })} /></label>
              <label><span>游记</span><textarea value={selected.note} aria-label="城市游记" placeholder="写下这座城市留给你的记忆。" onChange={(event) => updateMemory({ note: event.target.value })} /></label>
              <label className="react-upload-button"><Camera size={16} /><span>上传照片</span><input ref={photoInputRef} type="file" accept="image/*" multiple aria-label="上传城市照片" onChange={(event) => addPhotos(event.target.files)} /></label>
              <div className="react-photo-grid">{selected.photos.map((photo) => <img key={photo} src={photo} alt={selected.city.name} />)}</div>
              <div className={`react-form-actions ${deleteConfirmId === selected.id ? "confirming-delete" : ""}`}>
                <button className="secondary-button danger" type="button" title={deleteConfirmId === selected.id ? "再次点击会删除当前城市纪念" : "删除当前城市纪念"} onClick={requestDeleteMemory}><Trash2 size={15} /><span>{deleteConfirmId === selected.id ? "确认删除" : "删除"}</span></button>
                {deleteConfirmId === selected.id && <button className="secondary-button compact" type="button" onClick={() => setDeleteConfirmId("")}>取消</button>}
                {saveError ? <span className="react-status-line error" role="alert"><Save size={14} /> 未保存</span> : <span className="react-status-line success" role="status" aria-live="polite"><Save size={14} /> 已保存</span>}
              </div>
            </>
          ) : <div className="react-note-empty" role="status" aria-live="polite"><MapPin size={28} /><strong>选择一座城市</strong><small>从左侧搜索城市后，会在这里记录游记和照片。</small></div>}
        </article>
      </div>
    </section>
  );
}

function loadMemories(): CityMemory[] {
  try {
    const parsed = JSON.parse(readStorageValue(storageKey) ?? "[]") as CityMemory[];
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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`照片读取失败：${file.name}`));
    reader.onabort = () => reject(new Error(`照片读取已取消：${file.name}`));
    reader.readAsDataURL(file);
  });
}
