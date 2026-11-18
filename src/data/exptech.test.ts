import { describe, expect, it } from "vitest";
import { EXPTECH_HOSTS, fetchQuakes, parseQuake, parseQuakes, quakeRow } from "./exptech";

// 2026-11-17 實際回應的一筆（api.core.exptech.dev/api/v2/eq/report）
const REAL = {
  id: "115000-2026-1117-222850", lat: 23.41, lon: 121.51, depth: 34,
  loc: "臺東縣政府北北東方  81.7  公里 (位於臺東縣近海)", mag: 3.8, time: 1794925730000, int: 2, trem: 0,
  md5: "0F854FD3319472B28DA0094B8D32C70F",
};
const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

describe("ExpTech 地震報告", () => {
  it("解析實際回應的格式", () => {
    const q = parseQuake(REAL)!;
    expect(q).toMatchObject({ mag: 3.8, depth_km: 34, maxInt: 2, local: true });
    expect(q.loc).toBe("臺東縣政府北北東方 81.7 公里 (位於臺東縣近海)");
  });

  it("壞掉的一筆只丟掉那一筆，並依時間新到舊排序", () => {
    const list = parseQuakes([REAL, { ...REAL, mag: "4" }, null, { ...REAL, id: "115123-x", time: REAL.time + 1, lat: 999 },
      { ...REAL, id: "115124-x", time: REAL.time + 2 }]);
    expect(list.map((q) => q.id)).toEqual(["115124-x", REAL.id]);
    expect(list[0].local).toBe(false);
    expect(() => parseQuakes({ error: 1 })).toThrow();
  });

  it("地點文字會跳脫，不會變成 HTML", () => {
    const evil = parseQuake({ ...REAL, loc: `<img src=x onerror=alert(1)>` })!;
    const html = quakeRow(evil, () => "<b>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
  });

  it("連線錯誤或 5xx 換下一台主機；4xx 不換", async () => {
    const seen: string[] = [];
    const flaky = async (url: RequestInfo | URL) => {
      seen.push(new URL(String(url)).host);
      if (seen.length === 1) throw new TypeError("Failed to fetch");
      if (seen.length === 2) return json({}, 503);
      return json([REAL]);
    };
    expect(await fetchQuakes(flaky as typeof fetch)).toHaveLength(1);
    expect(seen).toEqual(EXPTECH_HOSTS);
    // 請求不帶位置等使用者資料
    const urls: string[] = [];
    await fetchQuakes((async (u: RequestInfo | URL) => (urls.push(String(u)), json([]))) as typeof fetch);
    expect(new URL(urls[0]).search).toBe("?limit=50&minIntensity=0");

    let n = 0;
    const limited = async () => (n++, json({}, 429));
    await expect(fetchQuakes(limited as typeof fetch)).rejects.toThrow("請求太頻繁");
    expect(n).toBe(1);
  });
});

describe("列表的一列", () => {
  const q = parseQuake(REAL)!;
  it("整列可以點（帶地震編號），預設不標「還沒算進」", () => {
    const html = quakeRow(q, () => "11/17 22:28");
    expect(html).toContain(`data-quake="${REAL.id}"`);
    expect(html).toContain('role="button"');
    expect(html).not.toContain("還沒算進");
  });
  it("pending 時加上「還沒算進風險數字」", () => {
    expect(quakeRow(q, () => "", true)).toContain("還沒算進風險數字");
  });
});
