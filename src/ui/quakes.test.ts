// 地震列表：哪些地震標「還沒算進風險數字」、點開的面板什麼時候給數字、外部字串跳脫。
import { describe, expect, it } from "vitest";
import { makeMockFeed } from "../data/mock";
import type { Quake } from "../data/exptech";
import type { State } from "../state";
import { DEFAULT_COND } from "../state";
import { notYetCounted, recentCard, renderExpert, renderQuakeSheet } from "./expert";

const ISSUED = "2026-11-18T00:30:00Z";
const T0 = Date.parse(ISSUED);

function quake(p: Partial<Quake>): Quake {
  return { id: "115001-2026-1118-0800", time: T0 - 36e5, lat: 23.95, lon: 121.72, depth_km: 15, mag: 4.6, maxInt: 3,
    loc: "花蓮縣政府東南方 12.0 公里 (位於花蓮縣近海)", local: false, ...p };
}

function state(list: Quake[]): State {
  const feed = makeMockFeed(new Date(ISSUED));
  feed.issued_at = ISSUED;
  return {
    feed, place: { lat: 22.63, lon: 120.3, label: "高雄市", source: "default" }, cond: { ...DEFAULT_COND },
    locate: "idle", mapLayer: "ratio", scope: "point", basemap: "osm", smooth: 0, mapFull: false,
    quakes: { status: "ok", list, error: null, at: T0 },
  };
}

describe("哪些地震還沒算進風險數字", () => {
  const f = state([]).feed;
  it("發生在資料發布之後、規模到模型計數的門檻（M3.5）：還沒算進", () => {
    expect(notYetCounted(f, quake({ time: T0 + 60e3, mag: 3.5 }))).toBe(true);
    expect(notYetCounted(f, quake({ time: T0 + 60e3, mag: 5.2 }))).toBe(true);
  });
  it("發布之前的地震、或規模太小（本來就不影響模型）：不標", () => {
    expect(notYetCounted(f, quake({ time: T0 - 60e3, mag: 5.2 }))).toBe(false);
    expect(notYetCounted(f, quake({ time: T0 + 60e3, mag: 3.4 }))).toBe(false);
  });
});

describe("最近的地震列表", () => {
  const list = [
    quake({ id: "a", time: T0 + 5 * 60e3, mag: 4.8 }),
    quake({ id: "b", time: T0 + 4 * 60e3, mag: 2.1 }),
    quake({ id: "c", time: T0 - 36e5, mag: 5.1 }),
  ];
  const html = recentCard(state(list));

  it("有固定的外層 id（只更新列表時用），每一列都可以點", () => {
    expect(html).toContain('id="recent-quakes"');
    expect(html.match(/data-quake=/g)).toHaveLength(3);
    expect(html).toContain('role="button"');
  });

  it("只有發布之後、M3.5 以上的那一筆標「還沒算進風險數字」", () => {
    expect(html.match(/還沒算進風險數字<\/span>/g)).toHaveLength(1);
    const rowA = html.slice(html.indexOf('data-quake="a"'), html.indexOf('data-quake="b"'));
    expect(rowA).toContain("還沒算進風險數字");
  });

  it("「更多」頁整頁輸出也帶著同一塊", () => {
    expect(renderExpert(state(list), "more")).toContain('id="recent-quakes"');
  });
});

describe("點開一筆地震的面板", () => {
  it("資料發布前的地震：給震央附近的機率表，寫明不是預報", () => {
    const html = renderQuakeSheet(state([]), quake({}));
    expect(html).toContain("規模 4.6 的地震");
    expect(html).toContain("M4 以上");
    expect(html).toContain("偏低");
    expect(html).toContain("不是地震預報");
  });

  it("發布之後、會影響模型的地震：先不給數字，免得看起來「沒有升高」", () => {
    const html = renderQuakeSheet(state([]), quake({ time: T0 + 10 * 60e3, mag: 6.2 }));
    expect(html).toContain("風險數字還沒反映它");
    expect(html).not.toContain("M4 以上");
    expect(html).not.toContain("%");
  });

  it("太小、不影響模型的地震：照樣給數字", () => {
    expect(renderQuakeSheet(state([]), quake({ time: T0 + 10 * 60e3, mag: 2.3 }))).toContain("M4 以上");
  });

  it("模型範圍外：不給數字", () => {
    const html = renderQuakeSheet(state([]), quake({ lat: 26.2, lon: 119.9, loc: "連江縣政府附近" }));
    expect(html).toContain("不提供數字");
    expect(html).not.toContain("%");
  });

  it("ExpTech 的文字一律跳脫", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const html = renderQuakeSheet(state([]), quake({ loc: evil, id: evil }));
    expect(html).not.toContain("<img");
    expect(recentCard(state([quake({ loc: evil, id: evil })]))).not.toContain("<img");
  });
});
