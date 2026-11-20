// 歷史回放（Phase 5）：過去大地震前後「當時」的風險資料，看模型在那些時間點怎麼說。
//
// 資料由破專題 app/export_history.py 產生，放在 public/history/（和網站一起發布，點開才下載，不預存）：
// - index.json：地震與時間點清單。
// - <時間點 id>.json：和 feed.json 同格式（用 validateFeed 檢查），所以畫面上的所有計算照常可用。
// 怎麼算的：v1.2 參數（1995–2014 擬合）＋事後整理好的正式目錄，只用每個時間點之前的資料
// （校準倍率也是）。當時即時能拿到的資料比較不完整，所以「當時真的跑」的數字會不一樣——畫面上要寫。
import type { Feed } from "./schema";
import { validateFeed } from "./feed";

export interface HistorySnapshot {
  /** 檔名（不含 .json），例：2024-hualien-after1h */
  id: string;
  /** 例：主震後 1 小時 */
  label: string;
  issued_at: string;
}

export interface HistoryQuake {
  id: string;
  /** 例：2024 花蓮地震 */
  name: string;
  /** 主震時間（UTC，ISO 8601） */
  time: string;
  ml: number;
  lat: number;
  lon: number;
  depth_km?: number;
  snapshots: HistorySnapshot[];
}

export interface HistoryIndex {
  note: string;
  quakes: HistoryQuake[];
}

const TIMEOUT_MS = 10_000;
/** 檔名只允許小寫英數與連字號：清單是外部輸入（雖然是自己網站的檔案），組網址前一定要檢查 */
const ID_RE = /^[a-z0-9-]{1,48}$/;

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const str = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max;
const time = (x: unknown): x is string => str(x, 40) && !Number.isNaN(Date.parse(x));

/** 檢查清單；看不懂的地震或時間點整筆丟掉（不讓一筆壞資料拖垮整頁）。全部壞掉才丟出錯誤。 */
export function validateHistoryIndex(raw: unknown): HistoryIndex {
  if (!raw || typeof raw !== "object") throw new Error("歷史回放清單格式不對");
  const r = raw as Record<string, unknown>;
  const quakes: HistoryQuake[] = [];
  for (const x of Array.isArray(r.quakes) ? r.quakes : []) {
    if (!x || typeof x !== "object") continue;
    const q = x as Record<string, unknown>;
    if (!str(q.id, 48) || !ID_RE.test(q.id) || !str(q.name, 40) || !time(q.time)) continue;
    if (!fin(q.ml) || !fin(q.lat) || !fin(q.lon) || Math.abs(q.lat) > 90 || Math.abs(q.lon) > 180) continue;
    const snapshots: HistorySnapshot[] = [];
    for (const y of Array.isArray(q.snapshots) ? q.snapshots : []) {
      if (!y || typeof y !== "object") continue;
      const s = y as Record<string, unknown>;
      if (str(s.id, 48) && ID_RE.test(s.id) && str(s.label, 30) && time(s.issued_at))
        snapshots.push({ id: s.id, label: s.label, issued_at: s.issued_at });
    }
    if (!snapshots.length) continue;
    const quake: HistoryQuake = { id: q.id, name: q.name, time: q.time, ml: q.ml, lat: q.lat, lon: q.lon, snapshots };
    if (fin(q.depth_km)) quake.depth_km = q.depth_km;
    quakes.push(quake);
  }
  if (!quakes.length) throw new Error("歷史回放清單是空的");
  return { note: str(r.note, 200) ? r.note : "", quakes };
}

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal, cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function loadHistoryIndex(fetchFn: typeof fetch = fetch): Promise<HistoryIndex> {
  return validateHistoryIndex(await getJson("./history/index.json", fetchFn));
}

/** 某個時間點的 feed；id 必須來自檢查過的清單 */
export async function loadHistoryFeed(id: string, fetchFn: typeof fetch = fetch): Promise<Feed> {
  if (!ID_RE.test(id)) throw new Error("時間點代碼不對");
  return validateFeed(await getJson(`./history/${id}.json`, fetchFn));
}

/** 清單裡找某個時間點 */
export function findSnapshot(idx: HistoryIndex, id: string): { quake: HistoryQuake; snap: HistorySnapshot } | null {
  for (const quake of idx.quakes) {
    const snap = quake.snapshots.find((s) => s.id === id);
    if (snap) return { quake, snap };
  }
  return null;
}
