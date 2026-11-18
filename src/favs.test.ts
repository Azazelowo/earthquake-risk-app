// 我的情境：只存本機、座標降精度、讀回來逐筆檢查、同名覆蓋、最多 12 個。
import { describe, expect, it } from "vitest";
import { cleanName, makeFav, removeFav, sanitizeFavs, upsertFav, FAV_MAX, FAV_NAME_MAX, type Fav } from "./favs";
import type { Place } from "./state";

const COND = { radiusKm: 50, T: 3, m: 5 };
const GPS: Place = { lat: 22.62749, lon: 120.30512, label: "高雄市三民區", detail: "定位誤差約 30 公尺", source: "gps", accuracyM: 30 };
const COUNTY: Place = { lat: 22.63, lon: 120.3, label: "高雄市", source: "county" };

describe("存成情境", () => {
  it("GPS 位置降到 0.01°、變成固定的點，定位誤差與補充文字都不存", () => {
    const f = makeFav("高雄住家", "place", GPS, COND, "a");
    expect(f.place).toEqual({ lat: 22.63, lon: 120.31, label: "高雄市三民區", source: "map" });
    expect(f.cond).toEqual(COND);
  });

  it("縣市照原樣；名稱空白時用地點名稱", () => {
    expect(makeFav("  ", "place", COUNTY, COND, "b")).toMatchObject({ name: "高雄市", place: COUNTY });
  });

  it("「全台」情境不存位置，預設名稱是「全台 M6+」", () => {
    const f = makeFav("", "all", GPS, { radiusKm: 50, T: 7, m: 6 }, "c");
    expect(f).toEqual({ id: "c", name: "全台 M6+", kind: "all", cond: { radiusKm: 50, T: 7, m: 6 } });
    expect(JSON.stringify(f)).not.toContain("22.6");
  });

  it("名稱去掉控制字元、合併空白、最多 20 字", () => {
    expect(cleanName(" 高雄\n\t住家 ")).toBe("高雄 住家");
    expect(cleanName("一".repeat(30))).toHaveLength(FAV_NAME_MAX);
  });
});

describe("清單", () => {
  const list = [makeFav("家", "place", COUNTY, COND, "1"), makeFav("學校", "place", COUNTY, COND, "2")];

  it("同名的直接換掉（保留原本的編號），不同名的加在後面", () => {
    const replaced = upsertFav(list, makeFav("家", "place", COUNTY, { radiusKm: 30, T: 1, m: 4 }, "9"))!;
    expect(replaced).toHaveLength(2);
    expect(replaced[0]).toMatchObject({ id: "1", cond: { radiusKm: 30, T: 1, m: 4 } });
    expect(upsertFav(list, makeFav("公司", "place", COUNTY, COND, "3"))).toHaveLength(3);
  });

  it("滿 12 個就不能再加新的，但同名的還是可以換掉", () => {
    const full: Fav[] = Array.from({ length: FAV_MAX }, (_, i) => makeFav(`情境${i}`, "place", COUNTY, COND, `${i}`));
    expect(upsertFav(full, makeFav("新的", "place", COUNTY, COND, "x"))).toBeNull();
    expect(upsertFav(full, makeFav("情境3", "all", COUNTY, COND, "x"))).toHaveLength(FAV_MAX);
  });

  it("刪除", () => expect(removeFav(list, "1").map((f) => f.name)).toEqual(["學校"]));
});

describe("讀回來時逐筆檢查", () => {
  it("存進去再讀出來一模一樣", () => {
    const list = [makeFav("家", "place", GPS, COND, "1"), makeFav("全台M6+", "all", GPS, { radiusKm: 50, T: 7, m: 6 }, "2")];
    expect(sanitizeFavs(JSON.parse(JSON.stringify(list)))).toEqual(list);
  });

  it("看不懂的整筆丟掉：不是陣列、條件超出範圍、類型不對、位置壞掉、沒有名稱", () => {
    expect(sanitizeFavs({ a: 1 })).toEqual([]);
    const good = { id: "1", name: "家", kind: "place", place: COUNTY, cond: COND };
    expect(sanitizeFavs([
      good,
      { ...good, id: "2", cond: { radiusKm: 50, T: 40, m: 5 } },
      { ...good, id: "3", kind: "town" },
      { ...good, id: "4", place: { lat: "x", lon: 120, label: "a", source: "map" } },
      { ...good, id: "5", name: "   " },
      null,
    ])).toEqual([good]);
  });

  it("最多讀 12 筆", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, name: `n${i}`, kind: "all", cond: COND }));
    expect(sanitizeFavs(many)).toHaveLength(FAV_MAX);
  });
});
