// 畫面輸出的第二道防線：就算有外部字串沒被驗證擋下，放進 HTML 前也必須跳脫（審查 H1）。
import { describe, expect, it } from "vitest";
import { makeMockFeed } from "../data/mock";
import type { State } from "../state";
import { DEFAULT_COND } from "../state";
import { renderExpert } from "./expert";

const EVIL = '<img src=x onerror="alert(1)">';

function stateWithEvilFeed(): State {
  const feed = makeMockFeed(new Date("2026-11-17T12:00:00Z"));
  feed.recent[0].source = EVIL as never;
  (feed.recent[0] as unknown as { depth_km: unknown }).depth_km = EVIL;
  feed.data_status.sources = [EVIL];
  (feed.data_status as unknown as { gap_days: unknown }).gap_days = EVIL;
  return {
    feed, place: { lat: 22.63, lon: 120.3, label: "高雄市", source: "default" }, cond: { ...DEFAULT_COND },
    locate: "idle", mapLayer: "ratio", scope: "point", basemap: "osm", smooth: 0, mapFull: false,
  };
}

describe("外部字串一律跳脫", () => {
  it("「更多」頁的最近地震表格", () => {
    const html = renderExpert(stateWithEvilFeed(), "more");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("「驗證與原理」頁的資料狀態", () => {
    const html = renderExpert(stateWithEvilFeed(), "verify");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
