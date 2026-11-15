// 機率計算核心：對應破專題 app/hazard_core.py。之後會加「同一組輸入，TS 與 Python 結果一致」的對照測試。
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
  return { p, pBg, ratio: pBg > 0 ? p / pBg : Infinity };
}

/** 可信度提示（對應 Python reliability） */
export function reliabilityNotes(feed: Feed, m: number, T: number): string[] {
  const notes: string[] = [];
  const mRef = feed.params.m_ref;
  if (m < mRef) notes.push(`規模門檻低於 M${mRef}：小地震紀錄不完整，這是往下外推的。`);
  if (m >= 6.5) notes.push("M6.5 以上在回測期間樣本極少，只能當量級參考。");
  let best: BacktestRow | null = null, bestD = Infinity;
  for (const r of feed.backtest) {
    const dd = Math.abs(r.m - m) + Math.abs(Math.log(r.horizon_days) - Math.log(T));
    if (dd < bestD) (bestD = dd), (best = r);
  }
  if (best) {
    if (best.n_events < 20) notes.push(`最接近的回測組只有 ${best.n_events} 個地震，校準數字不穩。`);
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
