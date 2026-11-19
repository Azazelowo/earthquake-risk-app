// 首頁的措辭與區塊：不能讓人以為安全、每處看得出不是預報、模型範圍外不給數字。
import { describe, expect, it } from "vitest";
import { makeMockFeed } from "../data/mock";
import type { Feed } from "../data/schema";
import type { State } from "../state";
import { DEFAULT_COND } from "../state";
import { aftershockCard, condPreview, rankCard, renderCondSheet, renderPlaceSheet, renderPublic, renderShareSheet } from "./public";
import { makeFav } from "../favs";
import { renderExpert } from "./expert";

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

describe("調整條件面板的滑桿（Phase 4）", () => {
  it("三排預設按鈕都還在，每排下面有一條滑桿，範圍是 5–200 km、對數時間、M4–M8", () => {
    const html = renderCondSheet(state(makeMockFeed(ISSUED)));
    expect(html.match(/data-cond="radiusKm"/g)).toHaveLength(4);
    expect(html).toMatch(/min="5" max="200" step="5" value="50" data-range="c-radius"/);
    expect(html).toMatch(/min="0" max="1000" step="1" value="\d+" data-range="c-time"/);
    expect(html).toMatch(/min="4" max="8" step="0.1" value="5" data-range="c-mag"/);
    expect(html).toContain('id="cond-preview"');
  });

  it("預覽：網格內給數字與回測標籤；M6.5 以上是外推估計", () => {
    const s = state(makeMockFeed(ISSUED));
    expect(condPreview(s, { radiusKm: 50, T: 3, m: 5 })).toContain("回測涵蓋範圍");
    expect(condPreview(s, { radiusKm: 50, T: 1 / 24, m: 6 })).toContain("回測樣本有限");
    const ext = condPreview(s, { radiusKm: 50, T: 2.5, m: 6.8 });
    expect(ext).toContain("外推估計");
    expect(ext).toContain("2.5 天內・M6.8 以上");
  });

  it("預覽：模型範圍外不給數字", () => {
    const s = state(makeMockFeed(ISSUED));
    s.place = { lat: 24.43, lon: 118.32, label: "金門縣", source: "county" };
    const html = condPreview(s, { radiusKm: 50, T: 3, m: 5 });
    expect(html).toContain("目前模型未涵蓋此區域");
    expect(html).not.toContain("%");
  });

  it("專家版的地圖、規模、時間也有滑桿", () => {
    const s = state(makeMockFeed(ISSUED));
    expect(renderExpert(s, "map")).toMatch(/data-range="c-mag"[\s\S]*data-range="c-time"/);
    expect(renderExpert(s, "mag")).toMatch(/data-range="c-radius"[\s\S]*data-range="c-time"/);
    expect(renderExpert(s, "time")).toMatch(/data-range="c-radius"[\s\S]*data-range="c-mag"/);
  });
});

describe("選位置面板的「我的情境」", () => {
  it("沒有情境時說明怎麼用；有存檔表單與兩個選項", () => {
    const html = renderPlaceSheet(state(makeMockFeed(ISSUED)), []);
    expect(html).toContain("還沒有存任何情境");
    expect(html).toContain('id="fav-name"');
    expect(html).toContain('value="all"');
    expect(html).toContain("全台・3 天內・M5 以上（打開地圖）");
    expect(html).toContain("只存在這支手機");
  });

  it("列出情境與說明；名稱是使用者輸入的，一律跳脫", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const favs = [
      makeFav(evil, "place", { lat: 22.63, lon: 120.3, label: "高雄市", source: "county" }, { radiusKm: 30, T: 1, m: 4 }, "id1"),
      makeFav("全台M6+", "all", { lat: 22.63, lon: 120.3, label: "高雄市", source: "county" }, { radiusKm: 50, T: 7, m: 6 }, "id2"),
    ];
    const html = renderPlaceSheet(state(makeMockFeed(ISSUED)), favs);
    expect(html).not.toContain("<img");
    expect(html).toContain('data-fav="id1"');
    expect(html).toContain('data-fav-del="id2"');
    expect(html).toContain("高雄市・周圍 30 km・1 天內・M4 以上");
    expect(html).toContain("全台・7 天內・M6 以上（打開地圖）");
  });
});

describe("分享面板", () => {
  const BASE = "https://azazelowo.github.io/earthquake-risk-app/";
  it("縣市位置預設附上；有系統分享時多一顆「分享…」；寫明不是預報、APP 不會自己傳出去", () => {
    const s = state(makeMockFeed(ISSUED));
    s.place = { lat: 23.99, lon: 121.6, label: "花蓮縣", source: "county" };
    const html = renderShareSheet(s, BASE, true, true);
    expect(html).toMatch(/data-share-loc checked/);
    expect(html).toContain("附上位置：花蓮縣");
    expect(html).toContain('data-act="share-go"');
    expect(html).toContain("c=%E8%8A%B1%E8%93%AE%E7%B8%A3");
    expect(html).toContain("不是地震預報");
    expect(html).toContain("APP 不會自己把連結傳出去");
  });

  it("GPS 位置：沒勾就不放位置，並說明為什麼預設不附；電腦上只有「複製連結」", () => {
    const s = state(makeMockFeed(ISSUED));
    s.place = { lat: 22.6275, lon: 120.3051, label: "高雄市三民區", source: "gps", accuracyM: 20 };
    const html = renderShareSheet(s, BASE, false, false);
    expect(html).not.toMatch(/data-share-loc checked/);
    expect(html).toContain("預設不附");
    expect(html).not.toMatch(/lat=|lon=/);
    expect(html).not.toContain('data-act="share-go"');
  });

  it("首頁更新時間那一行有「分享」；用分享連結打開時最上面有提醒", () => {
    const s = state(makeMockFeed(ISSUED));
    expect(renderPublic(s, { installHint: false })).toContain('data-act="share"');
    expect(renderPublic(s, { installHint: false, shared: "place" })).toContain("已套用分享連結的位置和條件");
    expect(renderPublic(s, { installHint: false, shared: "cond" })).toContain("位置還是你自己的");
    expect(renderPublic(s, { installHint: false })).not.toContain("已套用分享連結");
  });
});
