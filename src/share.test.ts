// 分享網址：GPS 位置預設不附、縣市只放名稱、收到的網址一律檢查範圍、網址裡的文字不採用。
import { describe, expect, it } from "vitest";
import { buildShareUrl, parseShare, shareLocationByDefault, shareLocationText } from "./share";
import type { Place } from "./state";
import { M_MAX, M_MIN, RADIUS_MAX, RADIUS_MIN, T_MAX, T_MIN } from "./state";

const BASE = "https://azazelowo.github.io/earthquake-risk-app/";
const COND = { radiusKm: 120, T: 2.5, m: 6.3 };
const COUNTY: Place = { lat: 23.99, lon: 121.6, label: "花蓮縣", source: "county" };
const MAP: Place = { lat: 22.62749, lon: 120.30512, label: "高雄市三民區", detail: "地圖選點", source: "map" };
const GPS: Place = { ...MAP, source: "gps", accuracyM: 20 };
const hashOf = (url: string) => url.slice(url.indexOf("#"));

describe("產生分享網址", () => {
  it("縣市只放名稱；地圖選點放 0.01° 座標；網址前面是網站本身", () => {
    const a = buildShareUrl(BASE, COUNTY, COND, true);
    expect(a.startsWith(`${BASE}#/?`)).toBe(true);
    expect(new URLSearchParams(a.split("?")[1]).get("c")).toBe("花蓮縣");
    expect(a).not.toContain("lat=");
    const b = buildShareUrl(`${BASE}#/expert/map`, MAP, COND, true);
    expect(b).toContain("lat=22.63&lon=120.31");
    expect(b).not.toContain("#/expert");
  });

  it("GPS 定位、或由 GPS 存成的固定點：預設不勾「附上位置」；不勾就完全不放位置", () => {
    expect(shareLocationByDefault(GPS)).toBe(false);
    expect(shareLocationByDefault({ ...MAP, personal: true })).toBe(false);
    expect(shareLocationByDefault(MAP)).toBe(true);
    expect(shareLocationByDefault(COUNTY)).toBe(true);
    const url = buildShareUrl(BASE, GPS, COND, false);
    expect(url).not.toMatch(/lat=|lon=|c=/);
    expect(url).not.toContain("22.6");
    expect(shareLocationText(GPS)).toContain("你的位置");
  });

  it("位置的名稱（例如「高雄市三民區」）不會放進網址", () => {
    expect(decodeURIComponent(buildShareUrl(BASE, MAP, COND, true))).not.toContain("三民區");
  });
});

describe("解析收到的網址", () => {
  it("產生→解析一致（位置取到 0.01°）", () => {
    expect(parseShare(hashOf(buildShareUrl(BASE, COUNTY, COND, true)))).toEqual({
      cond: COND, place: { kind: "county", name: "花蓮縣", lat: 23.99, lon: 121.6 },
    });
    expect(parseShare(hashOf(buildShareUrl(BASE, MAP, COND, true)))).toEqual({
      cond: COND, place: { kind: "point", lat: 22.63, lon: 120.31 },
    });
    expect(parseShare(hashOf(buildShareUrl(BASE, GPS, { radiusKm: 50, T: 1 / 24, m: 5 }, false)))).toEqual({
      cond: { radiusKm: 50, T: 1 / 24, m: 5 },
    });
  });

  it("數字一律夾在範圍內（時間超過 30 天會讓畫面算不出來，審查 Q6）", () => {
    expect(parseShare("#/?r=99999&t=999&m=99")?.cond).toEqual({ radiusKm: RADIUS_MAX, T: T_MAX, m: M_MAX });
    expect(parseShare("#/?r=-5&t=-1&m=-3")?.cond).toEqual({ radiusKm: RADIUS_MIN, T: T_MIN, m: M_MIN });
    expect(parseShare("#/?r=abc&t=&m=Infinity&lat=95&lon=121")).toBeNull();
  });

  it("縣市名稱要和內建清單完全一樣；網址裡的文字不會被採用", () => {
    const evil = parseShare(`#/?c=${encodeURIComponent('<img src=x onerror="alert(1)">')}&label=${encodeURIComponent("<b>騙人</b>")}&m=5`);
    expect(evil).toEqual({ cond: { m: 5 } });
    expect(JSON.stringify(evil)).not.toContain("img");
    expect(parseShare("#/?c=%E9%AB%98%E9%9B%84")).toBeNull();
  });

  it("不是分享網址就不處理", () => {
    expect(parseShare("")).toBeNull();
    expect(parseShare("#/")).toBeNull();
    expect(parseShare("#/info")).toBeNull();
    expect(parseShare("#/?foo=1")).toBeNull();
  });
});
