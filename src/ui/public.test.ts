// 首頁的措辭與區塊：不能讓人以為安全、每處看得出不是預報、模型範圍外不給數字。
import { describe, expect, it } from "vitest";
import { makeMockFeed } from "../data/mock";
import type { Feed } from "../data/schema";
import type { State } from "../state";
import { DEFAULT_COND } from "../state";
import { aftershockCard, rankCard, renderPublic } from "./public";

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

describe("全台排行", () => {
  it("有明顯升高的地方時列出前 3 名，寫「倍數最高」不寫「最危險」，點了會套用縣市與條件", () => {
    const card = rankCard(makeMockFeed(ISSUED));
    expect(card).toContain("全台排行：和平常比，倍數最高的地方");
    expect(card).toMatch(/data-rank="花蓮縣" data-m="\d" data-t="[\d.]+"/);
    expect(card.indexOf('data-rank="花蓮縣"')).toBe(card.indexOf("data-rank="));
    expect(card).toContain("不是地震預報");
    expect(card).not.toMatch(/最危險|安全|無需注意/);
  });

  it("全部都和平常差不多時不列名次，改寫一句話；想看的人可以展開", () => {
    const f = makeMockFeed(ISSUED);
    f.n_full = f.n_bg.map((r) => [...r]); // 現在＝平常：倍數全部是 1
    const card = rankCard(f);
    expect(card).toContain("目前全台沒有明顯高於平常的地方");
    expect(card).toContain("還是想看排序");
    expect(card).toContain("排在前面不代表那裡比較危險");
  });

  it("首頁有排行卡與「幫我找」，掃描結果點了會套用規模與時間", () => {
    const html = renderPublic(state(makeMockFeed(ISSUED)), { installHint: false });
    expect(html).toContain("全台排行");
    expect(html).toContain("幫我找：高雄市倍數最高的條件");
    const applies = [...html.matchAll(/data-apply='([^']*)'/g)].map((m) => JSON.parse(m[1]));
    expect(applies.some((a) => typeof a.m === "number" && typeof a.T === "number")).toBe(true);
  });

  it("位置在模型範圍外：「幫我找」不給任何組合", () => {
    const s = state(makeMockFeed(ISSUED));
    s.place = { lat: 24.43, lon: 118.32, label: "金門縣", source: "county" };
    const html = renderPublic(s, { installHint: false });
    expect(html).toContain("目前模型未涵蓋此區域，沒有可以比較的條件");
  });
});
