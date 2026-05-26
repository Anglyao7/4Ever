import { useMemo, useState } from "react";
import { Camera, MapPin, Save, Search, Trash2 } from "lucide-react";
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

const storageKey = "4ever.memoryMap.cityMemories";

export default function MemoryMapPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TencentCitySearchResult[]>([]);
  const [memories, setMemories] = useState<CityMemory[]>(loadMemories);
  const [selectedId, setSelectedId] = useState(memories[0]?.id ?? "");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const selected = memories.find((memory) => memory.id === selectedId) ?? memories[0] ?? null;

  const pins = useMemo(() => memories.slice(0, 18), [memories]);

  async function searchCities() {
    const keyword = query.trim();
    if (!keyword) return;
    setSearching(true);
    setError("");
    try {
      const found = await searchTencentCities(keyword);
      setResults(found);
      if (!found.length) setError("没有找到城市，请换个关键词。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "城市搜索失败");
    } finally {
      setSearching(false);
    }
  }

  function selectCity(city: TencentCitySearchResult) {
    const existing = memories.find((memory) => memory.city.id === city.id || memory.city.name === city.name);
    if (existing) {
      setSelectedId(existing.id);
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
    commit([next, ...memories], next.id);
  }

  function updateMemory(patch: Partial<CityMemory>) {
    if (!selected) return;
    commit(memories.map((memory) => memory.id === selected.id ? { ...memory, ...patch, updatedAt: new Date().toISOString() } : memory), selected.id);
  }

  async function addPhotos(files: FileList | null) {
    if (!selected || !files?.length) return;
    const dataUrls = await Promise.all([...files].slice(0, 8).map(readFileAsDataUrl));
    updateMemory({ photos: [...dataUrls, ...selected.photos].slice(0, 12) });
  }

  function commit(next: CityMemory[], nextSelected = selectedId) {
    setMemories(next);
    setSelectedId(nextSelected);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  return (
    <section className="react-map-panel">
      <div className="module-view-header">
        <div><p className="eyebrow">Memory Map</p><h1>地图纪念</h1></div>
        <span className="react-soft-stat">{memories.length} 座城市</span>
      </div>
      <div className="react-map-layout">
        <aside className="react-map-search">
          <label className="react-search-field"><Search size={15} /><input value={query} placeholder="搜索任意城市" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && searchCities()} /></label>
          <button className="primary-action compact" type="button" onClick={searchCities} disabled={searching}>{searching ? "搜索中" : "搜索城市"}</button>
          {error && <p className="react-error-line">{error}</p>}
          <div className="react-city-results">
            {results.map((city) => <button key={city.id} type="button" onClick={() => selectCity(city)}><MapPin size={15} /><span><strong>{city.name}</strong><small>{city.region}</small></span></button>)}
          </div>
        </aside>
        <div className="react-map-canvas">
          <div className="react-map-grid" aria-hidden="true" />
          {pins.map((memory, index) => (
            <button
              key={memory.id}
              className={`react-map-pin ${memory.id === selected?.id ? "active" : ""}`}
              type="button"
              style={{ left: `${12 + (index * 23) % 76}%`, top: `${18 + (index * 31) % 62}%` }}
              onClick={() => setSelectedId(memory.id)}
            >
              <span>{memory.emoji}</span>
              <small>{memory.city.name}</small>
            </button>
          ))}
          {!pins.length && <div className="react-map-empty"><MapPin size={28} /><strong>搜索城市，开始第一本纪念册</strong></div>}
        </div>
        <article className="react-memory-album">
          {selected ? (
            <>
              <header><span>{selected.emoji}</span><div><p className="eyebrow">{selected.city.region}</p><h2>{selected.city.name}</h2></div></header>
              <label><span>Emoji 状态</span><input value={selected.emoji} maxLength={4} onChange={(event) => updateMemory({ emoji: event.target.value || "✨" })} /></label>
              <label><span>游记</span><textarea value={selected.note} placeholder="写下这座城市留给你的记忆。" onChange={(event) => updateMemory({ note: event.target.value })} /></label>
              <label className="react-upload-button"><Camera size={16} /><span>上传照片</span><input type="file" accept="image/*" multiple onChange={(event) => addPhotos(event.target.files)} /></label>
              <div className="react-photo-grid">{selected.photos.map((photo) => <img key={photo} src={photo} alt={selected.city.name} />)}</div>
              <div className="react-form-actions">
                <button className="secondary-button danger" type="button" onClick={() => commit(memories.filter((memory) => memory.id !== selected.id), memories.find((memory) => memory.id !== selected.id)?.id ?? "")}><Trash2 size={15} />删除</button>
                <span className="react-status-line"><Save size={14} /> 已保存</span>
              </div>
            </>
          ) : <div className="react-note-empty"><MapPin size={28} /><strong>选择一座城市</strong></div>}
        </article>
      </div>
    </section>
  );
}

function loadMemories(): CityMemory[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as CityMemory[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}
