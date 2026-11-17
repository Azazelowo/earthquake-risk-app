// TS／Python 一致性：同一份 feed.json，src/core/hazard.ts 的結果必須和破專題 app/hazard_core.py 相同。
// 對照資料由破專題 `python app/export_parity.py --feed feed.json --out <本 repo>/src/core/__fixtures__/parity.json` 產生；
// 改 hazard.ts 或 hazard_core.py 任一邊都要重新產生並跑這個測試（AGENTS.md）。
import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/parity.json";
import { validateFeed } from "../data/feed";
import {
  allWeights, cellProbabilities, magnitudeAtProbability, pointWeights, regionAreaKm2, regionProbability,
} from "./hazard";

const TOL = 1e-9;
const feed = validateFeed(fixture.feed);

/** 相對誤差（兩邊都接近 0 時改用絕對誤差）；Python 的 NaN 在 JSON 裡寫成 null */
function close(actual: number, expected: number | null, what: string) {
  if (expected === null) {
    if (!Number.isNaN(actual)) throw new Error(`${what}：Python 沒有定義（NaN），TS 卻是 ${actual}`);
    return;
  }
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-300);
  if (!(err < TOL || Math.abs(actual - expected) < 1e-300))
    throw new Error(`${what}：TS ${actual}，Python ${expected}，相對誤差 ${err.toExponential(2)}`);
}

interface Row { m?: number; T: number; p_full?: number; p_bg?: number; p_target?: number; m_full?: number | null; m_bg?: number | null }

function checkRegion(w: number[], c: { area_km2: number; rows: Row[] }, label: string) {
  close(regionAreaKm2(feed, w), c.area_km2, `${label} 面積`);
  for (const r of c.rows) {
    if (r.m !== undefined) {
      close(regionProbability(feed, w, r.m, r.T, "full"), r.p_full!, `${label} M${r.m} ${r.T}天 現在`);
      close(regionProbability(feed, w, r.m, r.T, "bg"), r.p_bg!, `${label} M${r.m} ${r.T}天 平常`);
    } else {
      close(magnitudeAtProbability(feed, w, r.T, r.p_target!, "full"), r.m_full!, `${label} p=${r.p_target} 反查 現在`);
      close(magnitudeAtProbability(feed, w, r.T, r.p_target!, "bg"), r.m_bg!, `${label} p=${r.p_target} 反查 平常`);
    }
  }
}

describe("TS／Python 一致性（app/hazard_core.py）", () => {
  it("對照資料是 Python 產生、且通過 feed 驗證", () => {
    expect(fixture.generated_by).toContain("export_parity.py");
    expect(feed.cells.lat.length).toBeGreaterThan(100);
    expect(fixture.point_cases.length).toBeGreaterThanOrEqual(15);
  });

  for (const c of fixture.point_cases) {
    it(`${c.name} 半徑 ${c.radius_km} km`, () => {
      const w = pointWeights(feed, c.lat, c.lon, c.radius_km);
      // 面積比例是 k/100，兩邊應完全相同
      const nz = w.flatMap((v, i) => (v ? [[i, v]] : []));
      expect(nz).toEqual(c.weights);
      checkRegion(w, c, `${c.name} ${c.radius_km}km`);
    });
  }

  it("全網格", () => checkRegion(allWeights(feed), fixture.whole_grid, "全網格"));

  it("每格機率（地圖用，T 在刻度之間要內插）", () => {
    const { m, T } = fixture.cells;
    cellProbabilities(feed, m, T, "full").forEach((p, i) => close(p, fixture.cells.p_full[i], `格 ${i} 現在`));
    cellProbabilities(feed, m, T, "bg").forEach((p, i) => close(p, fixture.cells.p_bg[i], `格 ${i} 平常`));
  });
});
