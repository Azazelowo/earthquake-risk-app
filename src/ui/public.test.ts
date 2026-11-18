// 首頁的措辭與區塊：不能讓人以為安全、每處看得出不是預報、模型範圍外不給數字。
import { describe, expect, it } from "vitest";
import { makeMockFeed } from "../data/mock";
import type { Feed } from "../data/schema";
import type { State } from "../state";
import { DEFAULT_COND } from "../state";
import { aftershockCard, renderPublic } from "./public";

const ISSUED = new Date("2026-11-18T00:30:00Z");

function state(feed: Feed): State {
  return {
    feed, place: { lat: 22.63, lon: 120.3, label: "高雄市", source: "default" }, cond: { ...DEFAULT_COND },
    locate: "idle", mapLayer: "ratio", scope: "point", basemap: "osm", smooth: 0, mapFull: false,
  };
}

describe("餘震卡", () => {
  it("有最近的較大地震時出現在首頁，寫明「偏低」與「不是地震預報」", () => {
    const html = renderPublic(state(makeMockFeed(ISSUED)), { installHint: false });
    expect(html).toContain("最近的較大地震");
    expect(html).toContain("規模 5.8");
    expect(html).toContain("偏低");
    expect(html).toContain("不是地震預報");
    expect(html).toContain("M4 以上");
    expect(html).toContain("30 天內");
  });

  it("措辭：不說安全、不說無需注意", () => {
    const card = aftershockCard(makeMockFeed(ISSUED));
    expect(card).not.toMatch(/安全|無需注意|不用擔心/);
  });

  it("沒有符合條件的地震就整張不出現", () => {
    const f = makeMockFeed(ISSUED);
    f.recent = f.recent.filter((e) => e.ml < 5);
    expect(aftershockCard(f)).toBe("");
    expect(renderPublic(state(f), { installHint: false })).not.toContain("最近的較大地震");
  });

  it("震央在模型範圍外：說明不提供數字，不出現百分比", () => {
    const f = makeMockFeed(ISSUED);
    f.recent = [{ time: f.issued_at, lat: 24.43, lon: 118.32, depth_km: 10, ml: 6.0, source: "CWA" }];
    f.recent[0].time = new Date(Date.parse(f.issued_at) - 864e5).toISOString();
    const card = aftershockCard(f);
    expect(card).toContain("不提供數字");
    expect(card).toContain("不代表那裡不會有餘震");
    expect(card).not.toContain("%");
  });

  it("界線檔還沒載入時，震央先用座標表示", () => {
    expect(aftershockCard(makeMockFeed(ISSUED))).toMatch(/震央在\d+\.\d\d°N, \d+\.\d\d°E/);
  });
});
