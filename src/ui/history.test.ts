// 歷史回放頁與提示列：外部字串跳脫、限制寫在頁面上、回放中一直看得到「不是現在」。
import { describe, expect, it } from "vitest";
import { makeMockFeed } from "../data/mock";
import type { HistoryIndex } from "../data/history";
import type { State } from "../state";
import { DEFAULT_COND } from "../state";
import { historyBanner, renderHistory } from "./history";
import { renderPublic } from "./public";
import { recentCard } from "./expert";

const EVIL = '<img src=x onerror="alert(1)">';
const index: HistoryIndex = {
  note: "",
  quakes: [{
    id: "2024-hualien", name: EVIL, time: "2024-04-02T23:58:09Z", ml: 7.2, lat: 23.876, lon: 121.574, depth_km: 19.7,
    snapshots: [{ id: "2024-hualien-after1h", label: EVIL, issued_at: "2024-04-03T00:58:00Z" }],
  }],
};

function state(history = false): State {
  const s: State = {
    feed: makeMockFeed(new Date("2024-04-03T00:58:00Z")), place: { lat: 23.876, lon: 121.574, label: "震央", source: "map" },
    cond: { ...DEFAULT_COND }, locate: "idle", mapLayer: "ratio", scope: "point", basemap: "osm", smooth: 0, mapFull: false,
  };
  if (history) s.history = { quake: index.quakes[0], snap: index.quakes[0].snapshots[0], back: { place: s.place, cond: s.cond } };
  return s;
}

describe("歷史回放頁", () => {
  it("限制寫在頁面上：不是當時發布的數字、主震前看不出什麼、不是預報", () => {
    const html = renderHistory(state(), { status: "ok", index });
    expect(html).toContain("不是當時真的發布的數字");
    expect(html).toContain("不是地震預報");
    expect(html).toContain('data-history="2024-hualien-after1h"');
    expect(html).not.toContain("<img");
  });

  it("載入失敗時有錯誤卡片與再試一次", () => {
    expect(renderHistory(state(), { status: "error", error: "HTTP 404" })).toContain('data-act="history-retry"');
  });
});

describe("回放中", () => {
  it("提示列寫明「不是現在」並可以回到現在；沒在回放就沒有", () => {
    const bar = historyBanner(state(true));
    expect(bar).toContain("不是現在");
    expect(bar).toContain('data-act="history-exit"');
    expect(bar).not.toContain("<img");
    expect(historyBanner(state(false))).toBe("");
  });

  it("首頁顯示回放的時間點、沒有分享按鈕；地震列表換成回放時間點之前的", () => {
    const home = renderPublic(state(true), { installHint: false });
    expect(home).toContain("回放的時間點");
    expect(home).not.toContain('data-act="share"');
    expect(recentCard(state(true))).toContain("回放時間點之前的地震");
  });
});

describe("回放中的時間", () => {
  it("餘震卡的「多久以前」以回放的時間點來算，不是今天", () => {
    const s = state(true);
    const html = renderPublic(s, { installHint: false });
    // 假資料的主震在發布前約 2 天（顯示成「4X 小時前」）；以今天來算會是好幾百天前
    const m = html.match(/最近的較大地震<\/b><span>[^<]*・(\d+) (小時|天)前<\/span>/);
    expect(m).not.toBeNull();
    expect(m![2] === "小時" || Number(m![1]) < 3).toBe(true);
  });
});
