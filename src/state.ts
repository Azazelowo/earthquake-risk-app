// 全域狀態：位置、條件、地圖偏好。全部只存在本機（localStorage），從不送出。
import type { Feed } from "./data/schema";

export interface Place {
  lat: number;
  lon: number;
  /** 主要顯示文字，例：「高雄市燕巢區」「高雄市燕巢區附近」「高雄市」 */
  label: string;
  /** 補充說明，例：「定位誤差約 30 公尺」「地圖選點」；沒有就省略 */
  detail?: string;
  /** gps＝裝置定位；county＝選縣市；map＝在地圖上點選；default＝還沒選過 */
  source: "gps" | "county" | "default" | "map";
  /** 裝置回報的定位誤差半徑（公尺），只有 gps 才有 */
  accuracyM?: number;
}

export interface Cond {
  radiusKm: number;
  T: number; // 天
  m: number;
}

export type Locate = "idle" | "pending" | "denied" | "ok";

import type { Quake } from "./data/exptech";

export interface State {
  feed: Feed;
  place: Place;
  cond: Cond;
  locate: Locate;
  mapLayer: "p" | "ratio";
  scope: "point" | "all";
  /** 底圖代號（見 ui/basemaps.ts） */
  basemap: string;
  /** 地圖平滑程度：0＝原始 0.2° 格子，1–3 越大越平滑（只是顯示效果） */
  smooth: number;
  /** 地圖全螢幕（不儲存） */
  mapFull: boolean;
  /** 資料從哪裡來：loading＝第一次下載中；network＝最新；cache＝上次成功的資料（離線或下載失敗）；mock＝示意用假資料 */
  feedStatus?: { origin: "loading" | "network" | "cache" | "mock"; error: string | null };
  /** 即時地震列表（ExpTech 地震報告，只顯示、不進入風險計算）；不儲存 */
  quakes?: { status: "loading" | "ok" | "error"; list: Quake[]; error: string | null; at: number | null };
}

/** 金門、連江在模型網格（21–26°N、119–123°E）外 */
export const COUNTIES: { name: string; lat: number; lon: number; outside?: boolean }[] = [
  { name: "基隆市", lat: 25.13, lon: 121.74 }, { name: "臺北市", lat: 25.04, lon: 121.56 },
  { name: "新北市", lat: 25.01, lon: 121.47 }, { name: "桃園市", lat: 24.99, lon: 121.3 },
  { name: "新竹市", lat: 24.8, lon: 120.97 }, { name: "新竹縣", lat: 24.83, lon: 121.01 },
  { name: "苗栗縣", lat: 24.56, lon: 120.82 }, { name: "臺中市", lat: 24.15, lon: 120.68 },
  { name: "彰化縣", lat: 24.08, lon: 120.54 }, { name: "南投縣", lat: 23.91, lon: 120.68 },
  { name: "雲林縣", lat: 23.71, lon: 120.43 }, { name: "嘉義市", lat: 23.48, lon: 120.45 },
  { name: "嘉義縣", lat: 23.46, lon: 120.25 }, { name: "臺南市", lat: 22.99, lon: 120.21 },
  { name: "高雄市", lat: 22.63, lon: 120.3 }, { name: "屏東縣", lat: 22.67, lon: 120.49 },
  { name: "宜蘭縣", lat: 24.75, lon: 121.75 }, { name: "花蓮縣", lat: 23.99, lon: 121.6 },
  { name: "臺東縣", lat: 22.76, lon: 121.14 }, { name: "澎湖縣", lat: 23.57, lon: 119.58 },
  { name: "金門縣", lat: 24.43, lon: 118.32, outside: true }, { name: "連江縣", lat: 26.16, lon: 119.95, outside: true },
];

export const RADII = [10, 30, 50, 100];
/**
 * 半徑滑桿範圍（km）。小於一格（約 20 km）時是把格內機率依面積比例分配，屬於外推。
 * 上限 200 km（2026-11-18 使用者確認）：300 km 時臺北有 46% 的範圍在模型網格外，數字會明顯偏低。
 */
export const RADIUS_MIN = 5, RADIUS_MAX = 200, RADIUS_STEP = 5;
export const TIMES: [number, string][] = [[1 / 24, "1 小時"], [1, "1 天"], [3, "3 天"], [7, "7 天"], [30, "30 天"]];
/**
 * 時間滑桿範圍（天）。feed 只匯出到 30 天，超過就算不出來（interpHorizon 會丟例外），
 * 所以上限 30 天（2026-11-18 使用者確認；365 天要破專題多匯出時間長度並重新校準，排在 12/9 之後）。
 */
export const T_MIN = TIMES[0][0], T_MAX = TIMES[TIMES.length - 1][0];
/** 時間滑桿是對數刻度：0＝1 小時，TIME_STEPS＝30 天 */
export const TIME_STEPS = 1000;
export const MAGS = [4, 5, 6, 7];
/** 規模滑桿範圍。M6.5 以上回測樣本極少，畫面只標「外推估計」，不跳窗（使用者定案 C） */
export const M_MIN = 4, M_MAX = 8, M_STEP = 0.1;
export const DEFAULT_COND: Cond = { radiusKm: 50, T: 3, m: 5 };
export const SMOOTH_LABELS = ["格子", "輕", "中", "強"];

const KEY = "eqrisk.v1";

export interface Saved {
  place?: Place;
  cond?: Cond;
  basemap?: string;
  smooth?: number;
  mapLayer?: State["mapLayer"];
}

const num = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const within = (v: number, lo: number, hi: number) => v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9);

/** 條件是否在畫面與資料都能處理的範圍內（時間超過 30 天會算不出來，審查 Q6） */
export function validCond(c: Cond): boolean {
  return within(c.radiusKm, RADIUS_MIN, RADIUS_MAX) && within(c.T, T_MIN, T_MAX) && within(c.m, M_MIN, M_MAX);
}

/** 時間取到畫面上顯示的精度：1 天內到 0.1 小時、10 天內到 0.1 天、再長到整天 */
export function niceTime(T: number): number {
  const t = T < 1 ? Math.round(T * 240) / 240 : T < 10 ? Math.round(T * 10) / 10 : Math.round(T);
  return Math.min(Math.max(t, T_MIN), T_MAX);
}

/** 時間滑桿位置（0–TIME_STEPS，對數刻度）→ 天數 */
export function timeFromSlider(v: number): number {
  const lo = Math.log10(T_MIN), hi = Math.log10(T_MAX), x = Math.min(Math.max(v / TIME_STEPS, 0), 1);
  return niceTime(10 ** (lo + x * (hi - lo)));
}

/** 天數 → 時間滑桿位置 */
export function sliderFromTime(T: number): number {
  const lo = Math.log10(T_MIN), hi = Math.log10(T_MAX);
  return Math.round(((Math.log10(Math.min(Math.max(T, T_MIN), T_MAX)) - lo) / (hi - lo)) * TIME_STEPS);
}

export type CondSlider = "radius" | "time" | "mag";

/** 滑桿的原始值 → 新的條件（夾在範圍內、取到刻度） */
export function sliderCond(c: Cond, key: CondSlider, raw: number): Cond {
  if (!Number.isFinite(raw)) return c;
  if (key === "radius")
    return { ...c, radiusKm: Math.min(Math.max(Math.round(raw / RADIUS_STEP) * RADIUS_STEP, RADIUS_MIN), RADIUS_MAX) };
  if (key === "time") return { ...c, T: timeFromSlider(raw) };
  return { ...c, m: Math.min(Math.max(Math.round(raw * 10) / 10, M_MIN), M_MAX) };
}

/** 本機存的資料可能是舊版格式或被改過：只收看得懂的欄位，其餘丟掉用預設值 */
export function sanitize(raw: unknown): Saved {
  const out: Saved = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, any>;
  const p = r.place;
  if (p && num(p.lat) && num(p.lon) && typeof p.label === "string" && ["gps", "county", "default", "map"].includes(p.source)) {
    out.place = { lat: p.lat, lon: p.lon, label: p.label, source: p.source };
    if (typeof p.detail === "string") out.place.detail = p.detail;
    if (num(p.accuracyM)) out.place.accuracyM = p.accuracyM;
  }
  const c = r.cond;
  if (c && num(c.radiusKm) && num(c.T) && num(c.m) && validCond(c)) out.cond = { radiusKm: c.radiusKm, T: c.T, m: c.m };
  if (typeof r.basemap === "string") out.basemap = r.basemap;
  if (num(r.smooth) && r.smooth >= 0 && r.smooth < SMOOTH_LABELS.length) out.smooth = Math.round(r.smooth);
  if (r.mapLayer === "p" || r.mapLayer === "ratio") out.mapLayer = r.mapLayer;
  return out;
}

export function loadSaved(): Saved {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch {
    return {};
  }
}

/** 存進本機前把座標降低精度：GPS 位置取到 0.01°（約 1 km），地圖選點取到 0.001°（約 100 m） */
export function coarsen(p: Place): Place {
  const d = p.source === "gps" ? 2 : 3;
  return { ...p, lat: +p.lat.toFixed(d), lon: +p.lon.toFixed(d) };
}

export function save(s: State) {
  try {
    const data: Saved = { place: coarsen(s.place), cond: s.cond, basemap: s.basemap, smooth: s.smooth, mapLayer: s.mapLayer };
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* 無痕模式等情況：不存也能用 */
  }
}

export function timeLabel(T: number): string {
  const hit = TIMES.find(([d]) => Math.abs(d - T) < 1e-9);
  if (hit) return hit[1];
  return T < 1 ? `${+(T * 24).toFixed(1)} 小時` : `${+T.toFixed(1)} 天`;
}

/** 位置的短名稱：去掉括號說明與結尾的「附近」，用在「XX 附近 3 天內…」這類句子裡 */
export function placeShort(p: Place): string {
  return p.label.replace(/（.*?）/g, "").replace(/附近$/, "") || "這裡";
}

/** 經緯度 → 最近縣市名稱（界線檔還沒載入時的備援；只在手機端算） */
export function nearestCounty(lat: number, lon: number): string {
  let best = COUNTIES[0], bd = Infinity;
  for (const c of COUNTIES) {
    const d = (c.lat - lat) ** 2 + ((c.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bd) (bd = d), (best = c);
  }
  return best.name;
}
