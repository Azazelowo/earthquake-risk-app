// 條件掃描與全台排行：只收 p≥1%、依倍數排序、每個地點只出現一次、數字和首頁同一套計算。
import { describe, expect, it } from "vitest";
import { makeMockFeed } from "../data/mock";
import { COUNTIES, MAGS, TIMES } from "../state";
import { assessPoint } from "./hazard";
import { MIN_P, rankPlaces, scanPlace, RANK_RADIUS_KM, type ScanPlace } from "./scan";

const feed = makeMockFeed(new Date("2026-11-18T00:30:00Z"));
const times = TIMES.map(([T]) => T);
const inGrid: ScanPlace[] = COUNTIES.filter((c) => !c.outside);
const hualien = inGrid.find((c) => c.name === "花蓮縣")!;

describe("一個地點的條件掃描", () => {
  const hits = scanPlace(feed, hualien, RANK_RADIUS_KM, MAGS, times);

  it("只留現在機率 ≥ 1% 的組合，而且依倍數由高到低", () => {
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(MAGS.length * times.length); // M7、1 小時這類低機率的被濾掉
    for (const h of hits) expect(h.p).toBeGreaterThanOrEqual(MIN_P);
    for (let i = 1; i < hits.length; i++) expect(hits[i].ratio).toBeLessThanOrEqual(hits[i - 1].ratio);
  });

  it("數字和首頁用的是同一套計算（assessPoint）", () => {
    for (const h of hits) {
      const a = assessPoint(feed, h.place.lat, h.place.lon, h.radiusKm, h.m, h.T);
      expect([h.p, h.pBg, h.ratio]).toEqual([a.p, a.pBg, a.ratio]);
    }
  });

  it("被濾掉的組合確實都低於 1%", () => {
    const kept = new Set(hits.map((h) => `${h.m}:${h.T}`));
    for (const m of MAGS)
      for (const T of times)
        if (!kept.has(`${m}:${T}`)) expect(assessPoint(feed, hualien.lat, hualien.lon, RANK_RADIUS_KM, m, T).p).toBeLessThan(MIN_P);
  });

  it("模型範圍外的地點沒有任何結果（不給數字）", () => {
    const kinmen = COUNTIES.find((c) => c.name === "金門縣")!;
    expect(scanPlace(feed, kinmen, RANK_RADIUS_KM, MAGS, times)).toEqual([]);
  });
});

describe("全台排行", () => {
  const rank = rankPlaces(feed, COUNTIES, RANK_RADIUS_KM, MAGS, times);

  it("每個縣市最多出現一次，取的是它倍數最高的那一組", () => {
    const names = rank.map((h) => h.place.name);
    expect(new Set(names).size).toBe(names.length);
    for (const h of rank) expect(h).toEqual(scanPlace(feed, h.place, RANK_RADIUS_KM, MAGS, times)[0]);
  });

  it("依倍數排序、最多 10 名、金門連江不在榜上", () => {
    expect(rank.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < rank.length; i++) expect(rank[i].ratio).toBeLessThanOrEqual(rank[i - 1].ratio);
    expect(rank.map((h) => h.place.name)).not.toContain("金門縣");
    expect(rank.map((h) => h.place.name)).not.toContain("連江縣");
  });

  it("假資料的花蓮外海序列：花蓮縣排第一", () => {
    expect(rank[0].place.name).toBe("花蓮縣");
    expect(rank[0].ratio).toBeGreaterThan(1.5);
  });

  it("可以只取前幾名", () => {
    expect(rankPlaces(feed, inGrid, RANK_RADIUS_KM, MAGS, times, 3)).toEqual(rank.slice(0, 3));
  });
});
