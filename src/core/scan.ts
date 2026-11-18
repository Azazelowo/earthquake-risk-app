// 條件掃描：把「地點 × 規模 × 時間」全部算一遍，只留「現在」機率夠高的，依倍數（現在÷平常）排序。
//
// 用途：首頁的「全台排行」（每個縣市取倍數最高的一組）與「幫我找：這裡倍數最高的條件」。
// 數字只用現有的計算（pointWeights＋assessCircle，和首頁完全相同），沒有新的數學；
// 這裡只有篩選與排序，屬於畫面邏輯，由 scan.test.ts 檢查。
import type { Feed } from "../data/schema";
import { assessCircle, pointWeights } from "./hazard";

/**
 * 只收「現在」機率至少這麼高的組合（使用者 2026-11-15 定案）：
 * 避免機率極低、倍數卻很高的組合（例如 M7、1 小時）洗榜。
 */
export const MIN_P = 0.01;
/** 全台排行每個地點的範圍（km）：和首頁的預設相同，排行上的數字和首頁可以直接比 */
export const RANK_RADIUS_KM = 50;

export interface ScanPlace {
  name: string;
  lat: number;
  lon: number;
}

export interface ScanHit {
  place: ScanPlace;
  m: number;
  /** 時間長度（天） */
  T: number;
  radiusKm: number;
  p: number;
  pBg: number;
  ratio: number;
}

/** 倍數由高到低；一樣高時機率高的在前 */
const byRatio = (a: ScanHit, b: ScanHit) => b.ratio - a.ratio || b.p - a.p;

/** 一個地點的所有規模 × 時間：只留在模型範圍內、現在機率 ≥ MIN_P 的組合，依倍數由高到低 */
export function scanPlace(
  feed: Feed, place: ScanPlace, radiusKm: number, mags: readonly number[], times: readonly number[],
): ScanHit[] {
  const w = pointWeights(feed, place.lat, place.lon, radiusKm);
  const hits: ScanHit[] = [];
  for (const m of mags)
    for (const T of times) {
      const a = assessCircle(feed, w, place.lat, place.lon, radiusKm, m, T);
      if (!a.covered || !(a.p >= MIN_P) || !Number.isFinite(a.ratio)) continue;
      hits.push({ place, m, T, radiusKm, p: a.p, pBg: a.pBg, ratio: a.ratio });
    }
  return hits.sort(byRatio);
}

/**
 * 全台排行：每個地點只取倍數最高的那一組，再依倍數排序，取前 limit 名。
 * 每個地點只出現一次，不然前幾名會被同一個地方的不同條件佔滿。
 */
export function rankPlaces(
  feed: Feed, places: readonly ScanPlace[], radiusKm: number, mags: readonly number[], times: readonly number[], limit = 10,
): ScanHit[] {
  const best: ScanHit[] = [];
  for (const pl of places) {
    const top = scanPlace(feed, pl, radiusKm, mags, times)[0];
    if (top) best.push(top);
  }
  return best.sort(byRatio).slice(0, limit);
}
