// 鄉鎮區判斷的驗證。標準答案來自「原始」界線檔（由 scripts/build-towns.mjs 用 mapshaper 判斷），
// 和這裡受測的程式（自己解 TopoJSON、自己做點在多邊形內的判斷）互相獨立。
import { describe, expect, it } from "vitest";
import topo from "../data/towns.topo.json";
import fixture from "./towns.fixture.json";
import { buildIndex, describePlace, townsNear, TOWN_TOLERANCE_M, type TownTopology } from "./towns";

const idx = buildIndex(topo as unknown as TownTopology);
const byCode = new Map(idx.towns.map((t) => [t.code, t.county + t.name]));
const points = fixture.points as [number, number, string][];

describe("界線檔", () => {
  it("有 368 個鄉鎮市區，名稱與代碼齊全", () => {
    expect(idx.towns).toHaveLength(368);
    for (const t of idx.towns) {
      expect(t.code).toMatch(/^\d{8}$/);
      expect(t.county.length).toBeGreaterThan(1);
      expect(t.name.length).toBeGreaterThan(1);
      expect(t.polys.length).toBeGreaterThan(0);
    }
    expect(new Set(idx.towns.map((t) => t.code)).size).toBe(368);
  });

  it("誤差上限有寫進檔案、不大，而且和程式裡給 ⓘ 頁用的常數一致", () => {
    expect((topo as unknown as TownTopology).meta?.tolerance_m).toBe(TOWN_TOLERANCE_M);
    expect(idx.toleranceM).toBe(TOWN_TOLERANCE_M);
    expect(idx.toleranceM).toBeLessThanOrEqual(100);
    expect(idx.source).toContain("國土測繪中心");
  });
});

describe("和原始界線的對照點比較", () => {
  it("對照點夠多，而且大部分在界線附近", () => {
    expect(points.length).toBeGreaterThan(1000);
    expect(fixture.near_boundary).toBeGreaterThan(800);
  });

  it("APP 說「有把握」的點，全部和原始界線的答案一致", () => {
    let confident = 0;
    const wrong: string[] = [];
    for (const [lat, lon, code] of points) {
      const r = describePlace(idx, lat, lon);
      if (!r.confident) continue;
      confident++;
      // 原始界線說在海上、簡化後說在某區內（海岸線移動了幾十公尺）：不算錯，最近的就是那一區
      if (code && byCode.get(code) !== r.label) wrong.push(`${lat},${lon}: APP=${r.label} 原始=${byCode.get(code)}`);
    }
    expect(wrong).toEqual([]);
    // 對照點刻意取在界線 200 公尺內（很多還落在海上），仍應有不少離界線夠遠而「有把握」，否則這個測試等於沒測
    expect(confident).toBeGreaterThan(300);
    console.info(`鄉鎮區對照：${points.length} 點中 ${confident} 點有把握，全部正確；誤差上限 ${idx.toleranceM} m`);
  });

  it("原始界線的答案幾乎都在「誤差範圍內候選名單」裡；例外只有被簡化掉的小島礁，而且不會講死", () => {
    let land = 0;
    const missing: string[] = [];
    for (const [lat, lon, code] of points) {
      if (!code) continue;
      land++;
      const near = townsNear(idx, lat, lon, idx.toleranceM);
      if (near.some((t) => t.town.code === code)) continue;
      // 已知限制：比誤差上限還小的島礁（例如恆春外海的七星岩）簡化後會消失，那裡找不到任何候選
      missing.push(`${lat},${lon}: 原始=${byCode.get(code)}`);
      expect(near, `${lat},${lon} 應該是消失的小島礁（附近沒有任何鄉鎮區）`).toEqual([]);
      expect(describePlace(idx, lat, lon).confident).toBe(false);
    }
    expect(missing.length / land).toBeLessThan(0.01);
    console.info(`被簡化掉的小島礁：陸地對照點 ${land} 個中有 ${missing.length} 個（${missing.join("；") || "無"}）`);
  });

  it("直接取最近的一區（不看誤差），和原始界線一致的比例也很高", () => {
    let same = 0, land = 0;
    for (const [lat, lon, code] of points) {
      if (!code) continue;
      land++;
      const hit = townsNear(idx, lat, lon, 0)[0];
      if (hit && hit.town.code === code) same++;
    }
    // 對照點幾乎都貼著界線，所以這是最嚴格的情況；一般位置會遠高於此
    expect(same / land).toBeGreaterThan(0.9);
  });
});

describe("地標", () => {
  const at = (lat: number, lon: number, acc?: number) => describePlace(idx, lat, lon, acc);

  it("市區內的點直接講出鄉鎮區", () => {
    expect(at(25.034, 121.5645).label).toBe("臺北市信義區"); // 臺北 101
    expect(at(22.6514, 120.3285).label).toBe("高雄市三民區"); // 高科大建工校區
    expect(at(23.9931, 121.6011).label).toBe("花蓮縣花蓮市"); // 花蓮車站
    expect(at(24.1618, 120.6469).label).toBe("臺中市西屯區"); // 臺中市政府
    expect(at(23.5655, 119.5663).label).toBe("澎湖縣馬公市"); // 馬公市區
  });

  it("離島與模型網格外的地方也認得", () => {
    expect(at(22.045, 121.548).label).toBe("臺東縣蘭嶼鄉");
    expect(at(22.34, 120.37).label).toBe("屏東縣琉球鄉");
    expect(at(24.4367, 118.3186).label).toBe("金門縣金城鎮");
    expect(at(26.1598, 119.9583).label).toBe("連江縣南竿鄉");
  });

  it("有定位誤差時附上「誤差約 N 公尺」", () => {
    const r = at(25.034, 121.5645, 30);
    expect(r.label).toBe("臺北市信義區");
    expect(r.detail).toBe("定位誤差約 30 公尺");
    expect(r.confident).toBe(true);
  });

  it("定位誤差大到涵蓋別的鄉鎮區時改說「附近」", () => {
    const r = at(25.034, 121.5645, 1500);
    expect(r.label).toBe("臺北市信義區附近");
    expect(r.detail).toBe("定位誤差約 1.5 公里");
    expect(r.confident).toBe(false);
  });

  it("三區交界的玉山主峰不敢講死", () => {
    const r = at(23.47, 120.9573);
    expect(r.confident).toBe(false);
    expect(r.label).toMatch(/附近$/);
  });

  it("近海的點說「XX附近」並標離岸距離，遠海只給座標", () => {
    const nearShore = at(23.99, 121.66); // 花蓮港外約 3 公里
    expect(nearShore.label).toMatch(/^花蓮縣.+附近$/);
    expect(nearShore.detail).toMatch(/^離岸約 /);
    const farSea = at(23.9, 122.2);
    expect(farSea.label).toBe("23.90°N, 122.20°E");
    expect(farSea.confident).toBe(false);
  });
});

describe("定位誤差很大時（電腦用 Wi-Fi／網路定位）", () => {
  // 三民區內的一點：電腦把楠梓的人定位到這裡，誤差回報好幾公里
  const SANMIN = [22.65, 120.32] as const;

  it("誤差小時照常講到鄉鎮區", () => {
    expect(describePlace(idx, ...SANMIN, 30).label).toBe("高雄市三民區");
  });

  it("誤差超過 2 公里只講縣市，並標示可能不準", () => {
    const r = describePlace(idx, ...SANMIN, 5000);
    expect(r.label).toBe("高雄市");
    expect(r.detail).toContain("可能不準");
    expect(r.confident).toBe(false);
  });

  it("誤差範圍跨好幾個縣市時，縣市也加「附近」", () => {
    const r = describePlace(idx, 23.0, 120.25, 30_000); // 臺南、高雄交界一帶，誤差 30 公里
    expect(r.label).toMatch(/^.+[市縣]附近$/);
    expect(r.confident).toBe(false);
  });
});
