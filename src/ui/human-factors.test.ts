// 2026-11-21 人因檢查的修改：倍數文字說實話、狀態圖例、資料時間、分享內容、時間頁說明、名詞解釋。
import { describe, expect, it } from "vitest";
import { levelOf, ratioText } from "../format";
import { makeMockFeed } from "../data/mock";
import { dataAgeLine, levelScale } from "./public";
import { timeTrendText } from "./expert";
import { GLOSSARY, glossaryCard } from "./info";

describe("倍數的文字不再把 0.4 倍寫成「約 1 倍」", () => {
  it("小於 0.95 寫實際倍數，0.95–1.15 才是約 1 倍", () => {
    expect(ratioText(0.43)).toBe("約 0.4 倍");
    expect(ratioText(0.05)).toBe("約 0.05 倍");
    expect(ratioText(1.0)).toBe("約 1 倍");
    expect(ratioText(2.34)).toBe("約 2.3 倍");
    expect(ratioText(NaN)).toBe("—");
  });

  it("門檻不變：< 1.5 都是 lv0；明顯低於（< 1/1.5）標題說「低於平常」，且說明不代表比較安全", () => {
    const low = levelOf(0.43), same = levelOf(1.2);
    expect(low.key).toBe("lv0");
    expect(same.key).toBe("lv0");
    expect(low.title).toBe("低於平常");
    expect(low.hint).toContain("不代表比較安全");
    expect(low.hint).not.toMatch(/安全的|很安全/);
    expect(same.title).toBe("和平常差不多");
    expect(levelOf(1.5).key).toBe("lv1");
  });
});

describe("狀態圖例", () => {
  it("四個等級都有文字和門檻，目前的等級標出來（不只靠顏色）", () => {
    const html = levelScale(4.2);
    expect(html.match(/<span class="lv\d/g)).toHaveLength(4);
    expect(html).toContain('class="lv2 on"');
    expect(html).toContain("3–10 倍");
    expect(html).toContain("目前是「高不少」");
  });
});

describe("資料時間（不是更新時間）", () => {
  it("寫出正式目錄到哪一天，以及之後幾天是暫時資料", () => {
    const f = makeMockFeed(new Date("2026-11-15T12:00:00Z"));
    const line = dataAgeLine({ ...f, data_status: { ...f.data_status, catalog_end: "2026-09-29T09:00:00Z", gap_days: 52.8 } });
    expect(line).toContain("正式地震目錄到 9/29");
    expect(line).toContain("53 天是暫時資料");
    const fresh = dataAgeLine({ ...f, data_status: { ...f.data_status, catalog_end: "2026-11-14T09:00:00Z", gap_days: 1 } });
    expect(fresh).not.toContain("暫時資料");
  });
});

describe("時間頁的說明跟著數字走", () => {
  it("短時間高於平常、拉長變小 → 餘震衰減；都低於平常 → 說明平靜時低於平常是正常的", () => {
    expect(timeTrendText(6, 1.5)).toContain("短時間內比平常高");
    const quiet = timeTrendText(0.4, 0.6);
    expect(quiet).toContain("低於「平常」");
    expect(quiet).toContain("不代表比較安全");
    expect(timeTrendText(1.1, 1.0)).toContain("差不多");
  });
});

describe("名詞解釋", () => {
  it("有規模≠震度、倍數、平常等關鍵詞，κ 用 feed 的值", () => {
    const ids = GLOSSARY.map(([id]) => id);
    for (const k of ["prob", "usual", "ratio", "mag", "kappa"]) expect(ids).toContain(k);
    const html = glossaryCard({ params: { kappa: 1.765 } });
    expect(html).toContain('id="glossary"');
    expect(html).toContain("κ ≈ 1.76");
    expect(html).toContain("規模（M）和震度不一樣");
  });
});
