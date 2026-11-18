// 餘震卡：挑哪一個地震、數字是否和首頁同一套計算、模型範圍外不給數字。
import { describe, expect, it } from "vitest";
import { makeMockFeed } from "../data/mock";
import type { Feed, RecentEvent } from "../data/schema";
import { aftershockOutlook, pickMainshock, AFTERSHOCK_MAGS, AFTERSHOCK_TIMES } from "./aftershock";
import { assessPoint } from "./hazard";

const ISSUED = "2026-11-18T00:30:00Z";

/** 假資料的網格與期望數，換上自訂的近期地震 */
function feedWith(recent: Partial<RecentEvent>[]): Feed {
  const f = makeMockFeed(new Date(ISSUED));
  f.issued_at = ISSUED;
  f.recent = recent.map((e) => ({ time: ISSUED, lat: 23.95, lon: 121.72, depth_km: 15, ml: 3, source: "CWA", ...e }));
  return f;
}
const daysAgo = (d: number) => new Date(Date.parse(ISSUED) - d * 864e5).toISOString();

describe("挑哪一個地震", () => {
  it("沒有符合條件的地震就不出現卡片", () => {
    const f = feedWith([
      { time: daysAgo(1), ml: 4.9 }, // 不到 M5
      { time: daysAgo(8), ml: 5.5 }, // M5～6 只看 7 天
      { time: daysAgo(31), ml: 6.5 }, // M6 以上只看 30 天
    ]);
    expect(pickMainshock(f)).toBeNull();
    expect(pickMainshock(feedWith([]))).toBeNull();
  });

  it("7 天內 M5 以上、30 天內 M6 以上都算；剛好在邊界上也算", () => {
    expect(pickMainshock(feedWith([{ time: daysAgo(7), ml: 5.0 }]))?.ml).toBe(5.0);
    expect(pickMainshock(feedWith([{ time: daysAgo(30), ml: 6.0 }]))?.ml).toBe(6.0);
    expect(pickMainshock(feedWith([{ time: daysAgo(20), ml: 6.2 }]))?.ml).toBe(6.2);
  });

  it("有好幾個時取規模最大的；一樣大取比較近的", () => {
    const f = feedWith([
      { time: daysAgo(1), ml: 5.1, lat: 24.0 },
      { time: daysAgo(12), ml: 6.3, lat: 23.5 },
      { time: daysAgo(3), ml: 5.6, lat: 22.8 },
    ]);
    expect(pickMainshock(f)?.ml).toBe(6.3);
    const tie = feedWith([
      { time: daysAgo(5), ml: 5.4, lat: 24.0 },
      { time: daysAgo(2), ml: 5.4, lat: 22.8 },
    ]);
    expect(pickMainshock(tie)?.lat).toBe(22.8);
  });

  it("以資料的發布時間為準：發布時間之後、時間壞掉的都略過", () => {
    const f = feedWith([
      { time: daysAgo(-1), ml: 6.8 },
      { time: "not a time", ml: 7.1 },
      { time: daysAgo(2), ml: 5.2 },
    ]);
    expect(pickMainshock(f)?.ml).toBe(5.2);
  });

  it("假資料裡「兩天前花蓮外海 M5.8」會被挑出來", () => {
    const f = makeMockFeed(new Date(ISSUED));
    const q = pickMainshock(f);
    expect(q?.ml).toBe(5.8);
  });
});

describe("震央周圍的機率", () => {
  const f = makeMockFeed(new Date(ISSUED));
  const q = pickMainshock(f)!;
  const o = aftershockOutlook(f, q);

  it("數字和首頁用的是同一套計算（assessPoint）", () => {
    expect(o.rows.map((r) => r.m)).toEqual([...AFTERSHOCK_MAGS]);
    for (const r of o.rows)
      r.cells.forEach((c, j) => {
        expect(c.T).toBe(AFTERSHOCK_TIMES[j]);
        const a = assessPoint(f, q.lat, q.lon, o.radiusKm, r.m, c.T);
        expect(c.p).toBe(a.p);
        expect(c.pBg).toBe(a.pBg);
        expect(c.ratio).toBe(a.ratio);
      });
    expect(o.covered).toBe(true);
    expect(o.coverage).toBeGreaterThan(0.9);
  });

  it("時間越長機率越高、規模門檻越高機率越低", () => {
    for (const r of o.rows) for (let j = 1; j < r.cells.length; j++) expect(r.cells[j].p).toBeGreaterThan(r.cells[j - 1].p);
    o.rows[0].cells.forEach((c, j) => expect(o.rows[1].cells[j].p).toBeLessThan(c.p));
  });

  it("假資料的花蓮外海序列：剛發生後一天內明顯高於平常", () => {
    expect(o.rows[0].cells[0].ratio).toBeGreaterThan(1.5);
  });

  it("震央在模型範圍外：標成未涵蓋（畫面不給數字）", () => {
    const out = feedWith([{ time: daysAgo(1), ml: 6.1, lat: 24.43, lon: 118.32 }]); // 金門附近
    expect(aftershockOutlook(out, pickMainshock(out)!).covered).toBe(false);
  });
});
