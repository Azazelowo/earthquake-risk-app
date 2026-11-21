// 餘震卡：最近的較大地震，震央周圍「之後再發生地震」的機率。
//
// 沒有另外建餘震模型：數字和首頁一樣，用同一個模型的「現在」和「平常」（assessCircle），
// 計算和破專題 app/hazard_core.py 一致（parity.test.ts）。畫面上必須寫清楚的限制：
// - v1.2（2026-11-21）：大地震剛發生時依規模估計餘震，只維持幾個小時（之後由實際餘震接手）；v1.1 的 alpha＝0
//   讓主震後 2 分鐘只剩實際的約 8%。剛發生時不確定性大（回測 1 天內約高估 1.6 倍），畫面上兩個方向都要寫。
// - 模型不分主震、餘震：算的是震央附近「再發生地震」的機率，包含平常就會有的地震。
// - 外海定位差（方位角空隙大）的地震不在模型的事件母體裡；新地震要等下一次資料更新才算進去。
import type { Feed, RecentEvent } from "../data/schema";
import { assessCircle, pointWeights } from "./hazard";

/** 哪些地震會出現餘震卡：規模越大，往回看越久（feed.recent 本身只放發布前 30 天） */
export const MAINSHOCK_RULES: readonly { minMl: number; days: number }[] = [
  { minMl: 5, days: 7 },
  { minMl: 6, days: 30 },
];
export const AFTERSHOCK_RADIUS_KM = 50;
export const AFTERSHOCK_MAGS: readonly number[] = [4, 5];
export const AFTERSHOCK_TIMES: readonly number[] = [1, 7, 30];

const DAY_MS = 864e5;

/**
 * 挑出要做餘震卡的地震：符合任一條規則的地震中規模最大的（同規模取比較近的）。
 * 「最近幾天」以資料的發布時間為準（模型的「現在」），不是手機的時間——卡片上的機率也是從發布時間算起。
 */
export function pickMainshock(feed: Feed): RecentEvent | null {
  const now = Date.parse(feed.issued_at);
  let best: RecentEvent | null = null;
  for (const e of feed.recent) {
    const t = Date.parse(e.time);
    const ageDays = (now - t) / DAY_MS;
    // 時間格式壞掉（NaN）或在發布時間之後（不該出現）都略過
    if (!(ageDays >= 0)) continue;
    if (!MAINSHOCK_RULES.some((r) => e.ml >= r.minMl && ageDays <= r.days)) continue;
    if (!best || e.ml > best.ml || (e.ml === best.ml && t > Date.parse(best.time))) best = e;
  }
  return best;
}

export interface OutlookCell {
  /** 時間長度（天） */
  T: number;
  p: number;
  pBg: number;
  ratio: number;
}

export interface AftershockOutlook {
  radiusKm: number;
  /** false＝震央周圍不在模型範圍內（或大半在外），不能給數字 */
  covered: boolean;
  /** 圓形範圍落在模型網格內的比例（0–1） */
  coverage: number;
  /** 每個規模門檻一列，每列依 AFTERSHOCK_TIMES 的順序 */
  rows: { m: number; cells: OutlookCell[] }[];
}

/**
 * 震央周圍 radiusKm 內，各規模門檻 × 時間長度的「現在」與「平常」機率。
 * 震央可以是模型資料裡的地震（餘震卡），也可以是即時列表裡點開的地震——只用到經緯度。
 */
export function aftershockOutlook(feed: Feed, at: { lat: number; lon: number }, radiusKm = AFTERSHOCK_RADIUS_KM): AftershockOutlook {
  const w = pointWeights(feed, at.lat, at.lon, radiusKm);
  let covered = true, coverage = 1;
  const rows = AFTERSHOCK_MAGS.map((m) => ({
    m,
    cells: AFTERSHOCK_TIMES.map((T) => {
      const a = assessCircle(feed, w, at.lat, at.lon, radiusKm, m, T);
      covered &&= a.covered;
      coverage = a.coverage;
      return { T, p: a.p, pBg: a.pBg, ratio: a.ratio };
    }),
  }));
  return { radiusKm, covered, coverage, rows };
}
