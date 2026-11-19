// 機率計算核心：對應破專題 app/hazard_core.py。兩邊結果一致由 parity.test.ts 檢查（相對誤差 < 1e-9）。
import type { Feed, BacktestRow } from "../data/schema";

export const KM_PER_DEG = 111.195;
const SUBSAMPLE = 10; // 每格切 10×10 個點估算面積比例（同 Python）

export type Which = "full" | "bg";

/** log–log 內插：每格在時間長度 T（天）的期望數 */
export function interpHorizon(mat: number[][], horizons: number[], T: number): number[] {
  const lo = horizons[0], hi = horizons[horizons.length - 1];
  if (!(lo * (1 - 1e-9) <= T && T <= hi * (1 + 1e-9))) throw new Error(`時間長度 ${T} 天超出範圍`);
  T = Math.min(Math.max(T, lo), hi);
  let k = horizons.findIndex((h) => h >= T);
  if (k >= 0 && Math.abs(horizons[k] - T) < 1e-12) return mat.map((r) => r[k]);
  k = Math.min(Math.max(k, 1), horizons.length - 1);
  const t0 = horizons[k - 1], t1 = horizons[k];
  const w = (Math.log(T) - Math.log(t0)) / (Math.log(t1) - Math.log(t0));
  return mat.map((r) => {
    const y0 = Math.log(Math.max(r[k - 1], 1e-300));
    const y1 = Math.log(Math.max(r[k], 1e-300));
    return Math.exp(y0 + w * (y1 - y0));
  });
}

/** 古騰堡–芮克特：M≥m_ref 的期望數換成 M≥m */
export const scaleMagnitude = (n: number, m: number, mRef: number, b: number) => n * 10 ** (-b * (m - mRef));

/** 卜瓦松：至少發生一次 */
export const probability = (n: number) => -Math.expm1(-n);

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const p1 = lat1 * r, p2 = lat2 * r;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(Math.max(a, 0), 1)));
}

/** 點範圍：每格落在圓內的面積比例 */
export function pointWeights(feed: Feed, lat: number, lon: number, radiusKm: number): number[] {
  const d = feed.grid.deg;
  return feed.cells.lat.map((la, i) => {
    const lo = feed.cells.lon[i];
    // 先粗略排除遠的格子，省掉子點計算
    if (haversineKm(lat, lon, la + d / 2, lo + d / 2) > radiusKm + d * KM_PER_DEG) return 0;
    let inside = 0;
    for (let a = 0; a < SUBSAMPLE; a++)
      for (let b = 0; b < SUBSAMPLE; b++) {
        const pla = la + ((a + 0.5) / SUBSAMPLE) * d, plo = lo + ((b + 0.5) / SUBSAMPLE) * d;
        if (haversineKm(lat, lon, pla, plo) <= radiusKm) inside++;
      }
    return inside / (SUBSAMPLE * SUBSAMPLE);
  });
}

export const allWeights = (feed: Feed) => feed.cells.lat.map(() => 1);

// ---------- 範圍是否落在模型網格內 ----------

/** 區域面積（km²）：每格面積 × 該格的權重。對應 Python region_area_km2。 */
export function regionAreaKm2(feed: Feed, w: number[]): number {
  const d = feed.grid.deg, r = Math.PI / 180;
  let s = 0;
  for (let i = 0; i < w.length; i++) if (w[i]) s += w[i] * (d * KM_PER_DEG) ** 2 * Math.cos((feed.cells.lat[i] + d / 2) * r);
  return s;
}

/** 對應 Python circle_area_km2 */
export const circleAreaKm2 = (radiusKm: number) => Math.PI * radiusKm ** 2;

export function inGrid(feed: Feed, lat: number, lon: number): boolean {
  const g = feed.grid;
  return lat >= g.lat_min && lat <= g.lat_max && lon >= g.lon_min && lon <= g.lon_max;
}

/**
 * 圓形範圍有多少比例落在模型網格內（0–1）。網格外的部分不計入期望數（同 Python 的做法），
 * 所以比例太低時算出來的機率沒有意義——畫面要改顯示「目前模型未涵蓋此區域」，不能顯示成很低的機率。
 * 每格只切 10×10 個子點，小半徑時比例會有幾個百分點的量化誤差，所以上限截在 1。
 */
export function coverage(feed: Feed, w: number[], radiusKm: number): number {
  return Math.min(1, regionAreaKm2(feed, w) / circleAreaKm2(radiusKm));
}

/** 低於這個比例（或圓心在網格外）就視為模型未涵蓋 */
export const MIN_COVERAGE = 0.5;
/** 低於這個比例要提醒「有一部分在網格外、未計入」 */
export const FULL_COVERAGE = 0.9;

const cellMaps = new WeakMap<Feed, Map<string, number>>();
const cellKey = (lat: number, lon: number, d: number) => `${Math.round(lat / d)}:${Math.round(lon / d)}`;

/** 經緯度落在哪一格（回傳 cells 的索引；不在任何一格回傳 -1） */
export function cellIndexAt(feed: Feed, lat: number, lon: number): number {
  if (!inGrid(feed, lat, lon)) return -1;
  const g = feed.grid, d = g.deg;
  let map = cellMaps.get(feed);
  if (!map) {
    map = new Map();
    for (let i = 0; i < feed.cells.lat.length; i++) map.set(cellKey(feed.cells.lat[i], feed.cells.lon[i], d), i);
    cellMaps.set(feed, map);
  }
  // 先算第幾格再換回西南角，避免 23.8/0.2 這類浮點誤差落到隔壁格
  const la = g.lat_min + Math.min(Math.floor((lat - g.lat_min) / d + 1e-9), Math.round((g.lat_max - g.lat_min) / d) - 1) * d;
  const lo = g.lon_min + Math.min(Math.floor((lon - g.lon_min) / d + 1e-9), Math.round((g.lon_max - g.lon_min) / d) - 1) * d;
  return map.get(cellKey(la, lo, d)) ?? -1;
}

function matOf(feed: Feed, which: Which) {
  return which === "full" ? feed.n_full : feed.n_bg;
}

/** 範圍內 M≥m_ref 的期望數（尚未換規模） */
export function regionRef(feed: Feed, w: number[], T: number, which: Which): number {
  const v = interpHorizon(matOf(feed, which), feed.horizons_days, T);
  let s = 0;
  for (let i = 0; i < v.length; i++) s += w[i] * v[i];
  return s;
}

export function regionProbability(feed: Feed, w: number[], m: number, T: number, which: Which): number {
  return probability(scaleMagnitude(regionRef(feed, w, T, which), m, feed.params.m_ref, feed.params.b));
}

/** 每格機率（地圖用） */
export function cellProbabilities(feed: Feed, m: number, T: number, which: Which): number[] {
  return interpHorizon(matOf(feed, which), feed.horizons_days, T).map((n) =>
    probability(scaleMagnitude(n, m, feed.params.m_ref, feed.params.b)),
  );
}

/** 反查：機率達 p 的規模門檻 */
export function magnitudeAtProbability(feed: Feed, w: number[], T: number, p: number, which: Which = "full") {
  const n = regionRef(feed, w, T, which);
  if (n <= 0) return NaN;
  return feed.params.m_ref + Math.log10(n / -Math.log1p(-p)) / feed.params.b;
}

export interface Assessment {
  p: number;
  pBg: number;
  ratio: number;
}

export function assess(feed: Feed, w: number[], m: number, T: number): Assessment {
  const p = regionProbability(feed, w, m, T, "full");
  const pBg = regionProbability(feed, w, m, T, "bg");
  // 平常機率為 0 代表範圍內沒有任何格子：倍數沒有定義（NaN），不能當成「無限大」而顯示成最高等級
  return { p, pBg, ratio: pBg > 0 ? p / pBg : NaN };
}

export interface PointAssessment extends Assessment {
  /** 圓形範圍落在模型網格內的比例（0–1） */
  coverage: number;
  /** false＝模型未涵蓋這個位置，p／pBg／ratio 不可使用 */
  covered: boolean;
}

/** 以 (lat, lon) 為圓心、半徑 radiusKm 的評估，並檢查是否在模型範圍內 */
export function assessPoint(feed: Feed, lat: number, lon: number, radiusKm: number, m: number, T: number): PointAssessment {
  return assessCircle(feed, pointWeights(feed, lat, lon, radiusKm), lat, lon, radiusKm, m, T);
}

/**
 * 同 assessPoint，但圓內每格的面積比例 w（＝pointWeights(feed, lat, lon, radiusKm)）由呼叫端先算好。
 * 同一個圓要換很多組規模、時間時（餘震卡、排行榜）用這個，省掉重算面積比例；計算本身完全相同。
 */
export function assessCircle(feed: Feed, w: number[], lat: number, lon: number, radiusKm: number, m: number, T: number): PointAssessment {
  const cov = coverage(feed, w, radiusKm);
  const a = assess(feed, w, m, T);
  return { ...a, coverage: cov, covered: inGrid(feed, lat, lon) && cov >= MIN_COVERAGE && a.pBg > 0 };
}

/**
 * 這組條件是否落在回測涵蓋的範圍內（不看樣本數，樣本數見 backtestTag）。不影響計算。
 * 規模：m_ref ≤ m < 6.5（更小的目錄不完整、更大的回測樣本極少，同 reliabilityNotes）；時間：回測表涵蓋的範圍內。
 */
export function isVerified(feed: Feed, m: number, T: number): boolean {
  if (m < feed.params.m_ref || m >= 6.5) return false;
  const ts = feed.backtest.map((r) => r.horizon_days);
  if (!ts.length) return false;
  return T >= Math.min(...ts) * (1 - 1e-9) && T <= Math.max(...ts) * (1 + 1e-9);
}

/** 回測組地震數少於這個值，校準數字不穩（標籤顯示「回測樣本有限」） */
export const MIN_BACKTEST_EVENTS = 20;

/** 規模與（對數）時間距離最近的回測組 */
export function nearestBacktest(feed: Feed, m: number, T: number): BacktestRow | null {
  let best: BacktestRow | null = null, bestD = Infinity;
  for (const r of feed.backtest) {
    const dd = Math.abs(r.m - m) + Math.abs(Math.log(r.horizon_days) - Math.log(T));
    if (dd < bestD) (bestD = dd), (best = r);
  }
  return best;
}

export type BacktestTag = "ok" | "thin" | "ext";
export const BACKTEST_TAG_LABEL: Record<BacktestTag, string> = {
  ok: "回測涵蓋範圍",
  thin: "回測樣本有限",
  ext: "外推估計",
};

/**
 * 畫面上的小標籤。在回測涵蓋範圍內不等於可信：最接近的回測組地震太少時改標「回測樣本有限」。
 * 只影響標籤，不影響計算。
 */
export function backtestTag(feed: Feed, m: number, T: number): BacktestTag {
  if (!isVerified(feed, m, T)) return "ext";
  const r = nearestBacktest(feed, m, T);
  return r && r.n_events >= MIN_BACKTEST_EVENTS ? "ok" : "thin";
}

/** 可信度提示（對應 Python reliability） */
export function reliabilityNotes(feed: Feed, m: number, T: number): string[] {
  const notes: string[] = [];
  const mRef = feed.params.m_ref;
  if (m < mRef) notes.push(`規模門檻低於 M${mRef}：小地震紀錄不完整，這是往下外推的。`);
  if (m >= 6.5) notes.push("M6.5 以上在回測期間樣本極少，只能當量級參考。");
  const best = nearestBacktest(feed, m, T);
  if (best) {
    if (best.n_events < MIN_BACKTEST_EVENTS) notes.push(`最接近的回測組只有 ${best.n_events} 個地震，校準數字不穩。`);
    if (best.ratio > 1.25) notes.push(`回測中這類組合系統性高估（預測÷實際≈${best.ratio.toFixed(2)}），實際可能比顯示的低。`);
    else if (best.ratio < 0.8) notes.push(`回測中這類組合系統性低估（預測÷實際≈${best.ratio.toFixed(2)}），實際可能比顯示的高。`);
  }
  return notes;
}

/** 取最接近 T 的缺口評估 */
export function undercountAt(feed: Feed, T: number): number | null {
  const e = Object.entries(feed.data_status.undercount_by_horizon);
  if (!e.length) return null;
  e.sort((a, b) => Math.abs(Math.log(+a[0] / T)) - Math.abs(Math.log(+b[0] / T)));
  return e[0][1];
}
