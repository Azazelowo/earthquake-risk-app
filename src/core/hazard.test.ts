// 核心計算的基本性質，以及「位置在模型網格外」的處理。
// 和 Python（hazard_core.py）逐項對照的測試在接真資料時（Phase 2）再加；這裡先確保 TS 這一側自己站得住。
import { describe, expect, it } from "vitest";
import { makeMockFeed } from "../data/mock";
import { levelOf } from "../format";
import {
  allWeights, assess, assessPoint, cellIndexAt, cellProbabilities, circleAreaKm2, coverage, inGrid, interpHorizon,
  isVerified, pointWeights, probability, regionAreaKm2, scaleMagnitude, FULL_COVERAGE, MIN_COVERAGE,
} from "./hazard";

const feed = makeMockFeed(new Date("2026-11-15T12:00:00Z"));
const KAOHSIUNG = { lat: 22.63, lon: 120.3 };
const KINMEN = { lat: 24.4367, lon: 118.3186 };

describe("基本公式", () => {
  it("時間內插在節點上等於原值，節點之間單調遞增", () => {
    const h = feed.horizons_days;
    expect(interpHorizon(feed.n_full, h, h[4])).toEqual(feed.n_full.map((r) => r[4]));
    const a = interpHorizon(feed.n_full, h, 1.5), lo = feed.n_full.map((r) => r[4]), hi = feed.n_full.map((r) => r[5]);
    a.forEach((v, i) => {
      expect(v).toBeGreaterThan(lo[i]);
      expect(v).toBeLessThan(hi[i]);
    });
    expect(() => interpHorizon(feed.n_full, h, 60)).toThrow();
  });

  it("規模每加 1，期望數乘上 10^-b；機率永遠在 0 到 1 之間", () => {
    expect(scaleMagnitude(1, 4.5, 3.5, 0.77)).toBeCloseTo(10 ** -0.77, 12);
    expect(probability(0)).toBe(0);
    expect(probability(1e-9)).toBeCloseTo(1e-9, 15);
    expect(probability(50)).toBeLessThanOrEqual(1);
  });
});

describe("範圍與模型網格", () => {
  it("全區面積約等於 5°×4° 的球面面積", () => {
    // 21–26°N、119–123°E：約 555 km × 平均 409 km
    const area = regionAreaKm2(feed, allWeights(feed));
    expect(area).toBeGreaterThan(220_000);
    expect(area).toBeLessThan(235_000);
  });

  it("網格內的圓：涵蓋比例接近 1，面積和 πr² 相差不到 5%", () => {
    for (const r of [30, 50, 100]) {
      const w = pointWeights(feed, KAOHSIUNG.lat, KAOHSIUNG.lon, r);
      expect(regionAreaKm2(feed, w) / circleAreaKm2(r)).toBeGreaterThan(0.95);
      expect(coverage(feed, w, r)).toBeGreaterThan(FULL_COVERAGE);
      expect(coverage(feed, w, r)).toBeLessThanOrEqual(1);
    }
  });

  it("金門在網格外：判定為未涵蓋，而且不會被當成「遠高於平常」", () => {
    expect(inGrid(feed, KINMEN.lat, KINMEN.lon)).toBe(false);
    const a = assessPoint(feed, KINMEN.lat, KINMEN.lon, 50, 5, 3);
    expect(a.covered).toBe(false);
    expect(a.coverage).toBeLessThan(MIN_COVERAGE);
    // 範圍內沒有任何格子時倍數是 NaN（以前是 Infinity，會落到最高等級）
    const none = assess(feed, feed.cells.lat.map(() => 0), 5, 3);
    expect(none.ratio).toBeNaN();
    expect(levelOf(none.ratio).key).toBe("lv0");
    expect(levelOf(Infinity).key).toBe("lv0");
  });

  it("圓心在網格邊緣：有一部分在外面，涵蓋比例介於中間", () => {
    const a = assessPoint(feed, 23.5, 119.05, 100, 5, 3);
    expect(a.coverage).toBeGreaterThan(0.45);
    expect(a.coverage).toBeLessThan(0.7);
  });

  it("網格內的位置有涵蓋，機率與倍數是合理的數字", () => {
    const a = assessPoint(feed, KAOHSIUNG.lat, KAOHSIUNG.lon, 50, 5, 3);
    expect(a.covered).toBe(true);
    expect(a.p).toBeGreaterThan(0);
    expect(a.p).toBeLessThan(1);
    expect(a.ratio).toBeGreaterThan(0);
    expect(Number.isFinite(a.ratio)).toBe(true);
  });

  it("經緯度對得到正確的格子（含浮點邊界），網格外回傳 -1", () => {
    const d = feed.grid.deg;
    for (const [lat, lon] of [[23.85, 121.75], [21.0, 119.0], [25.99, 122.99], [23.8, 121.6], [26, 123]]) {
      const i = cellIndexAt(feed, lat, lon);
      expect(i).toBeGreaterThanOrEqual(0);
      // 格子的西南角 ≤ 點 ≤ 東北角（最北、最東的邊界歸給最後一格）
      expect(feed.cells.lat[i]).toBeLessThanOrEqual(lat + 1e-9);
      expect(feed.cells.lat[i] + d).toBeGreaterThanOrEqual(lat - 1e-9);
      expect(feed.cells.lon[i]).toBeLessThanOrEqual(lon + 1e-9);
      expect(feed.cells.lon[i] + d).toBeGreaterThanOrEqual(lon - 1e-9);
    }
    expect(cellIndexAt(feed, KINMEN.lat, KINMEN.lon)).toBe(-1);
    expect(cellProbabilities(feed, 5, 3, "full")).toHaveLength(feed.cells.lat.length);
  });
});

describe("已驗證／外推估計的標籤", () => {
  it("回測涵蓋的規模與時間是已驗證；太小、太大的規模是外推", () => {
    expect(isVerified(feed, 5, 3)).toBe(true);
    expect(isVerified(feed, 4, 1 / 24)).toBe(true);
    expect(isVerified(feed, 6, 30)).toBe(true);
    expect(isVerified(feed, 7, 3)).toBe(false); // M6.5 以上回測樣本極少
    expect(isVerified(feed, 3, 3)).toBe(false); // 低於 m_ref，目錄不完整
    expect(isVerified({ ...feed, backtest: [] }, 5, 3)).toBe(false);
  });
});
