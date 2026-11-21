// feed.json 的驗證與退回順序（審查 H1、H2、S-12）。
import { describe, expect, it } from "vitest";
import { FeedError, loadFeed, staleHours, validateFeed } from "./feed";
import { makeMockFeed } from "./mock";

const real = () => ({ ...structuredClone(makeMockFeed(new Date("2026-11-17T12:00:00Z"))), mock: false });

class MemStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

const okFetch = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
const downFetch = (async () => {
  throw new TypeError("Failed to fetch");
}) as unknown as typeof fetch;

describe("validateFeed", () => {
  it("合法的 feed 原樣通過，而且只留下已知欄位", () => {
    const f = { ...real(), extra: "<script>" };
    const v = validateFeed(f);
    expect(v.cells.lat.length).toBe(f.cells.lat.length);
    expect(v.n_full[0]).toEqual(f.n_full[0]);
    expect("extra" in v).toBe(false);
  });

  it("舊 feed 沒有 params.kappa：補 1（卜瓦松）；有的話要在 1–20 之間", () => {
    const f = real();
    const old = { ...f, params: { b: f.params.b, m_ref: f.params.m_ref } };
    expect(validateFeed(old).params.kappa).toBe(1);
    expect(validateFeed({ ...f, params: { ...old.params, kappa: 1.6 } }).params.kappa).toBe(1.6);
    expect(() => validateFeed({ ...f, params: { ...old.params, kappa: 0.5 } })).toThrow(FeedError);
  });

  it("近期地震的來源只接受 GDMS、CWA、USGS（擋下塞進 HTML 的字串）", () => {
    const f = real();
    f.recent[0].source = '<img src=x onerror="alert(1)">' as never;
    expect(() => validateFeed(f)).toThrow(FeedError);
  });

  it("數字欄位不能是字串、NaN、負的期望數", () => {
    const a = real();
    (a.recent[0] as unknown as { depth_km: unknown }).depth_km = "<b>10</b>";
    expect(() => validateFeed(a)).toThrow(/depth_km/);
    const b = real();
    b.n_full[3][2] = Number.NaN;
    expect(() => validateFeed(b)).toThrow(/n_full\[3\]\[2\]/);
    const c = real();
    c.n_bg[0][0] = -1;
    expect(() => validateFeed(c)).toThrow(/n_bg/);
  });

  it("長度對不上、時間長度沒有遞增、版本不對都擋下", () => {
    const a = real();
    a.n_full.pop();
    expect(() => validateFeed(a)).toThrow(/列數/);
    const b = real();
    b.horizons_days = [1, 1, 2];
    expect(() => validateFeed(b)).toThrow(/遞增/);
    expect(() => validateFeed({ ...real(), version: 2 })).toThrow(/版本/);
    expect(() => validateFeed(null)).toThrow(FeedError);
  });
});

describe("loadFeed 的退回順序", () => {
  it("下載成功：用最新資料，並存一份在本機", async () => {
    const st = new MemStorage();
    const r = await loadFeed(okFetch(real()), st);
    expect(r.origin).toBe("network");
    expect(r.error).toBeNull();
    expect(st.getItem("eqrisk.feed")).not.toBeNull();
  });

  it("離線：退回上次成功的資料，並說明原因", async () => {
    const st = new MemStorage();
    await loadFeed(okFetch(real()), st);
    const r = await loadFeed(downFetch, st);
    expect(r.origin).toBe("cache");
    expect(r.feed.mock).toBe(false);
    expect(r.error).toBe("無法連線");
  });

  it("格式錯誤：不採用，原因寫明是格式問題；沒有快取就用假資料", async () => {
    const bad = real();
    bad.recent[0].source = "EVIL" as never;
    const r = await loadFeed(okFetch(bad), new MemStorage());
    expect(r.origin).toBe("mock");
    expect(r.feed.mock).toBe(true);
    expect(r.error).toMatch(/資料格式錯誤/);
  });

  it("HTTP 錯誤也算失敗", async () => {
    const f = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const r = await loadFeed(f, null);
    expect(r.origin).toBe("mock");
    expect(r.error).toMatch(/404/);
  });
});

describe("過期判斷", () => {
  it("超過 1 小時才算過期（每 15 分鐘發布）；假資料不算", () => {
    const f = { ...real(), issued_at: "2026-11-17T10:00:00Z" };
    expect(staleHours(f, Date.parse("2026-11-17T10:50:00Z"))).toBeNull();
    expect(staleHours(f, Date.parse("2026-11-17T13:00:00Z"))).toBeCloseTo(3, 6);
    expect(staleHours({ ...f, mock: true }, Date.parse("2026-11-20T00:00:00Z"))).toBeNull();
  });
});
