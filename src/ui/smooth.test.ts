// 平滑化只是顯示效果：這裡確認它「不會憑空造出數字」——格子中心的值不變、不超出原本的範圍、沒資料的地方不補。
import { describe, expect, it } from "vitest";
import { makeMockFeed } from "../data/mock";
import { cellProbabilities } from "../core/hazard";
import { blur, invMercY, mercY, rasterize, sample, toField, type Field } from "./smooth";

const feed = makeMockFeed(new Date("2026-11-15T12:00:00Z"));
const logp = cellProbabilities(feed, 5, 3, "full").map((p) => Math.log10(p));
const field = toField(feed, logp);

describe("排成網格", () => {
  it("格數正確（25×20），每格都有值", () => {
    expect(field.nLat).toBe(25);
    expect(field.nLon).toBe(20);
    expect([...field.v].every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe("內插", () => {
  it("在格子中心取樣得到原本的值（不改動模型輸出）", () => {
    const d = feed.grid.deg;
    feed.cells.lat.forEach((la, i) => {
      expect(sample(field, la + d / 2, feed.cells.lon[i] + d / 2)).toBeCloseTo(logp[i], 12);
    });
  });

  it("兩格中間的值介於兩格之間；網格外沒有值", () => {
    const d = feed.grid.deg;
    const a = sample(field, 23.9, 121.7), b = sample(field, 23.9, 121.7 + d);
    const mid = sample(field, 23.9, 121.7 + d / 2);
    expect(mid).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-12);
    expect(mid).toBeLessThanOrEqual(Math.max(a, b) + 1e-12);
    expect(sample(field, 20.9, 121)).toBeNaN();
    expect(sample(field, 23, 123.01)).toBeNaN();
    // 最外圈半格沿用邊緣值
    expect(sample(field, 21.01, 119.01)).toBeCloseTo(sample(field, 21.1, 119.1), 12);
  });
});

describe("高斯模糊", () => {
  it("全部一樣的值模糊後不變；一般情況不會超出原本的最小／最大值", () => {
    const flat: Field = { ...field, v: new Float64Array(field.v.length).fill(-2.5) };
    expect([...blur(flat, 1.4).v].every((x) => Math.abs(x + 2.5) < 1e-12)).toBe(true);
    const lo = Math.min(...field.v), hi = Math.max(...field.v);
    for (const x of blur(field, 1.4).v) {
      expect(x).toBeGreaterThanOrEqual(lo - 1e-12);
      expect(x).toBeLessThanOrEqual(hi + 1e-12);
    }
    expect(blur(field, 0)).toBe(field);
  });

  it("越模糊，最高的那一格被壓得越低（所以點選顯示的數字一律用原始格子）", () => {
    const peak = Math.max(...field.v);
    const p1 = Math.max(...blur(field, 0.7).v), p2 = Math.max(...blur(field, 1.4).v);
    expect(p1).toBeLessThan(peak);
    expect(p2).toBeLessThan(p1);
  });

  it("沒有資料的格子保持沒有資料，也不會把旁邊的值拉壞", () => {
    const holed: Field = { ...field, v: Float64Array.from(field.v) };
    const hole = 12 * field.nLon + 10;
    holed.v[hole] = NaN;
    const out = blur(holed, 0.7);
    expect(out.v[hole]).toBeNaN();
    expect(Number.isFinite(out.v[hole + 1])).toBe(true);
    expect(sample(holed, 21 + 12.5 * 0.2, 119 + 10.5 * 0.2)).toBeNaN();
  });
});

describe("轉成影像", () => {
  it("麥卡托換算可逆", () => {
    for (const lat of [21, 23.5, 26]) expect(invMercY(mercY(lat))).toBeCloseTo(lat, 10);
  });

  it("影像長寬比符合麥卡托投影，網格內每個像素都有顏色", () => {
    const ras = rasterize(field, 4, () => [10, 20, 30, 200]);
    expect(ras.width).toBe(80);
    // 5 個緯度在麥卡托上比 4 個經度長：約 80 × (5/4) × 1/cos(23.5°) ≈ 109
    expect(ras.height).toBeGreaterThan(106);
    expect(ras.height).toBeLessThan(112);
    expect(ras.data).toHaveLength(ras.width * ras.height * 4);
    let opaque = 0;
    for (let i = 3; i < ras.data.length; i += 4) if (ras.data[i] === 200) opaque++;
    expect(opaque).toBe(ras.width * ras.height);
  });

  it("影像的列是依麥卡托 y 等分：正中間那一列對應的緯度比 23.5° 略高", () => {
    // 麥卡托把高緯拉長：北半段（23.5–26°）在圖上比南半段長，所以圖的正中間落在 23.5° 以北一點點。
    // 差約 0.024°（2.6 公里）——如果影像用「緯度等分」，貼上地圖後中段就會偏這麼多。
    const midLat = invMercY((mercY(21) + mercY(26)) / 2);
    expect(midLat - 23.5).toBeGreaterThan(0.01);
    expect(midLat - 23.5).toBeLessThan(0.05);
  });
});
