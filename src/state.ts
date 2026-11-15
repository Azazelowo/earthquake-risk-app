// 全域狀態：位置與條件。位置只存在本機（localStorage），從不送出。
import type { Feed } from "./data/schema";

export interface Place {
  lat: number;
  lon: number;
  label: string;
  source: "gps" | "county" | "default";
}

export interface Cond {
  radiusKm: number;
  T: number; // 天
  m: number;
}

export type Locate = "idle" | "pending" | "denied" | "ok";

export interface State {
  feed: Feed;
  place: Place;
  cond: Cond;
  locate: Locate;
  mapLayer: "p" | "ratio";
  scope: "point" | "all";
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
export const TIMES: [number, string][] = [[1 / 24, "1 小時"], [1, "1 天"], [3, "3 天"], [7, "7 天"], [30, "30 天"]];
export const MAGS = [4, 5, 6, 7];
export const DEFAULT_COND: Cond = { radiusKm: 50, T: 3, m: 5 };

const KEY = "eqrisk.v1";

export function loadSaved(): { place?: Place; cond?: Cond } {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function save(s: State) {
  try {
    // GPS 位置四捨五入到 0.01°（約 1 km）再存，降低精確位置留在裝置上的風險
    const p = s.place.source === "gps" ? { ...s.place, lat: +s.place.lat.toFixed(2), lon: +s.place.lon.toFixed(2) } : s.place;
    localStorage.setItem(KEY, JSON.stringify({ place: p, cond: s.cond }));
  } catch {
    /* 無痕模式等情況：不存也能用 */
  }
}

export function timeLabel(T: number): string {
  const hit = TIMES.find(([d]) => Math.abs(d - T) < 1e-9);
  if (hit) return hit[1];
  return T < 1 ? `${+(T * 24).toFixed(1)} 小時` : `${+T.toFixed(1)} 天`;
}

/** 經緯度 → 最近縣市名稱（只在手機端算） */
export function nearestCounty(lat: number, lon: number): string {
  let best = COUNTIES[0], bd = Infinity;
  for (const c of COUNTIES) {
    const d = (c.lat - lat) ** 2 + ((c.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bd) (bd = d), (best = c);
  }
  return best.name;
}
