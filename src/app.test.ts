// 不碰畫面的小邏輯：免責聲明何時顯示、本機儲存的清理、底圖與金鑰、距離文字。
import { describe, expect, it } from "vitest";
import { distText } from "./format";
import { coarsen, placeShort, sanitize, sliderCond, sliderFromTime, timeFromSlider, timeLabel, validCond, DEFAULT_COND, M_MAX, RADIUS_MIN, TIMES, TIME_STEPS, T_MAX, T_MIN, type Place } from "./state";
import { BASEMAPS, DEFAULT_BASEMAP, resolveBasemap, tileUrl, usable, validCartoKey } from "./ui/basemaps";
import { DISCLAIMER_VERSION, disclaimerPoints, shouldShow } from "./ui/disclaimer";

describe("使用前說明", () => {
  const v = String(DISCLAIMER_VERSION);
  it("第一次開一定顯示", () => expect(shouldShow(null, null)).toBe(true));
  it("按過「我了解」：這次開啟不再顯示，下次開啟還會顯示", () => {
    expect(shouldShow(null, v)).toBe(false);
    expect(shouldShow(null, null)).toBe(true);
  });
  it("勾了「不再顯示」：之後都不顯示", () => expect(shouldShow(v, null)).toBe(false));
  it("說明內容改版（版本號加一）後，勾過的人也會再看到一次", () => {
    expect(shouldShow(v, v, DISCLAIMER_VERSION + 1)).toBe(true);
  });
  it("儲存的內容被改壞時當作沒看過", () => expect(shouldShow("abc", null)).toBe(true));
  it("假資料階段多一條提醒；一定有「不是地震預報」與「位置不外送」", () => {
    const mock = disclaimerPoints(true).join(""), real = disclaimerPoints(false).join("");
    expect(mock).toContain("假資料");
    expect(real).not.toContain("假資料");
    for (const text of [mock, real]) {
      expect(text).toContain("這不是地震預報");
      expect(text).toContain("不會傳送出去");
      expect(text).toContain("中央氣象署");
    }
  });
});

describe("本機儲存", () => {
  it("只收看得懂的欄位，壞掉的資料整個丟掉", () => {
    expect(sanitize(null)).toEqual({});
    expect(sanitize("x")).toEqual({});
    expect(sanitize({ place: { lat: "23", lon: 120, label: "a", source: "gps" } })).toEqual({});
    expect(sanitize({ cond: { radiusKm: 9999, T: 3, m: 5 } })).toEqual({});
    expect(sanitize({ smooth: 7, mapLayer: "x", basemap: 3 })).toEqual({});
  });
  it("雛型版存的舊格式仍然讀得進來", () => {
    const old = { place: { lat: 22.63, lon: 120.3, label: "高雄市", source: "county" }, cond: { radiusKm: 50, T: 3, m: 5 } };
    expect(sanitize(old)).toEqual(old);
  });
  it("存檔前降低座標精度：GPS 約 1 km、地圖選點約 100 m", () => {
    const gps: Place = { lat: 22.651432, lon: 120.328512, label: "高雄市三民區", source: "gps", accuracyM: 20 };
    expect(coarsen(gps)).toMatchObject({ lat: 22.65, lon: 120.33 });
    expect(coarsen({ ...gps, source: "map" })).toMatchObject({ lat: 22.651, lon: 120.329 });
  });
  it("位置的短名稱去掉「附近」與括號", () => {
    const p = (label: string): Place => ({ lat: 0, lon: 0, label, source: "gps" });
    expect(placeShort(p("高雄市燕巢區附近"))).toBe("高雄市燕巢區");
    expect(placeShort(p("目前位置（高雄市附近）"))).toBe("目前位置");
    expect(placeShort(p("附近"))).toBe("這裡");
  });
});

describe("底圖", () => {
  it("清單有 OSM、OpenTopoMap、國土測繪中心、深色與 CARTO，每個都有來源標示", () => {
    const ids = BASEMAPS.map((b) => b.id);
    for (const id of ["osm", "topo", "nlsc", "nlsc-photo", "dark", "carto-voyager"]) expect(ids).toContain(id);
    for (const b of BASEMAPS) {
      expect(b.attribution.length).toBeGreaterThan(10);
      expect(b.url).toMatch(/^https:\/\//);
    }
    expect(BASEMAPS.filter((b) => b.carto).every((b) => b.attribution.includes("CARTO") && b.attribution.includes("OpenStreetMap"))).toBe(true);
  });
  it("沒有金鑰時 CARTO 不能用，選了也會退回預設底圖；原始碼裡沒有內建金鑰", () => {
    const carto = BASEMAPS.find((b) => b.id === "carto-voyager")!;
    expect(usable(carto)).toBe(false);
    expect(resolveBasemap("carto-voyager").id).toBe(DEFAULT_BASEMAP);
    expect(resolveBasemap("不存在").id).toBe(DEFAULT_BASEMAP);
    expect(resolveBasemap("topo").id).toBe("topo");
    expect(tileUrl(carto)).toContain("?key=");
    expect(tileUrl(carto)).not.toMatch(/key=[A-Za-z0-9]/);
  });
  it("金鑰格式檢查擋掉空白、網址與過短的內容", () => {
    expect(validCartoKey("abcDEF123_-.xyz")).toBe(true);
    for (const bad of ["", "short", "has space 12345", "https://example.com/key", "a&b=c12345678"]) expect(validCartoKey(bad)).toBe(false);
  });
});

describe("距離文字", () => {
  it("取整到看得懂的刻度", () => {
    expect(distText(4)).toBe("約 10 公尺");
    expect(distText(33)).toBe("約 30 公尺");
    expect(distText(840)).toBe("約 850 公尺");
    expect(distText(1530)).toBe("約 1.5 公里");
    expect(distText(23400)).toBe("約 23 公里");
    expect(distText(NaN)).toBe("");
  });
});

describe("條件滑桿（Phase 4）", () => {
  it("時間滑桿是對數刻度：兩端是 1 小時與 30 天，中間取到看得懂的精度", () => {
    expect(timeFromSlider(0)).toBeCloseTo(1 / 24, 12);
    expect(timeFromSlider(TIME_STEPS)).toBe(30);
    expect(timeFromSlider(-50)).toBeCloseTo(1 / 24, 12);
    expect(timeFromSlider(TIME_STEPS * 2)).toBe(30);
    for (let v = 0; v <= TIME_STEPS; v += 37) {
      const T = timeFromSlider(v);
      expect(T).toBeGreaterThanOrEqual(T_MIN * (1 - 1e-12));
      expect(T).toBeLessThanOrEqual(T_MAX);
      expect(timeLabel(T)).toMatch(/^\d+(\.\d)? (小時|天)$/); // 不會出現 2.3456 天這種數字
    }
  });

  it("位置和天數互相換算一致；越往右時間越長", () => {
    for (const [T] of TIMES) expect(timeFromSlider(sliderFromTime(T))).toBeCloseTo(T, 9);
    let prev = 0;
    for (let v = 0; v <= TIME_STEPS; v += 10) {
      const T = timeFromSlider(v);
      expect(T).toBeGreaterThanOrEqual(prev);
      prev = T;
    }
  });

  it("半徑、規模夾在範圍內並取到刻度", () => {
    const c = { ...DEFAULT_COND };
    expect(sliderCond(c, "radius", 3).radiusKm).toBe(RADIUS_MIN);
    expect(sliderCond(c, "radius", 999).radiusKm).toBe(200);
    expect(sliderCond(c, "radius", 73).radiusKm).toBe(75);
    expect(sliderCond(c, "mag", 5.349).m).toBe(5.3);
    expect(sliderCond(c, "mag", 9).m).toBe(M_MAX);
    expect(sliderCond(c, "mag", Number.NaN)).toEqual(c);
    expect(sliderCond(c, "time", 0)).toMatchObject({ radiusKm: c.radiusKm, m: c.m });
  });

  it("本機存的條件超出範圍就不用（時間超過 30 天會讓整頁算不出來，審查 Q6）", () => {
    expect(sanitize({ cond: { radiusKm: 50, T: 31, m: 5 } })).toEqual({});
    expect(sanitize({ cond: { radiusKm: 50, T: 3, m: 9 } })).toEqual({});
    expect(sanitize({ cond: { radiusKm: 50, T: 0.01, m: 5 } })).toEqual({});
    expect(sanitize({ cond: { radiusKm: 150, T: 2.5, m: 6.7 } }).cond).toEqual({ radiusKm: 150, T: 2.5, m: 6.7 });
    expect(validCond({ radiusKm: 200, T: 30, m: 8 })).toBe(true);
  });
});
