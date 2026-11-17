// 讀取真資料 feed.json：下載 → 驗證 → 存一份在本機；失敗時依序退回「上次成功的資料」、「示意用假資料」。
//
// 為什麼要在執行時驗證：TypeScript 的型別只在編譯時檢查。feed.json 是外部檔案（每小時由破專題的
// GitHub Actions 產生），欄位缺少或型別錯誤時，畫面會在任意位置丟出例外；字串欄位若被塞進 HTML，
// 還可能變成 XSS。所以載入時先把整份資料檢查一遍，不合格就不用（審查 H1、H2）。
import type { BacktestRow, DataStatus, Feed, RecentEvent } from "./schema";
import { makeMockFeed } from "./mock";

/** 破專題的 hourly-feed 工作流程把 feed.json 推到 feed 分支；可用 VITE_FEED_URL 換成其他位置 */
export const FEED_URL: string =
  import.meta.env.VITE_FEED_URL || "https://raw.githubusercontent.com/Azazelowo/earthquake-risk-project/feed/feed.json";
const CACHE_KEY = "eqrisk.feed";
const FETCH_TIMEOUT_MS = 10_000;
/** 超過這麼久沒更新就標成「已過期」：每小時更新，留一次失敗的餘裕 */
export const STALE_HOURS = 2;

export type FeedOrigin = "network" | "cache" | "mock";
export interface LoadedFeed {
  feed: Feed;
  origin: FeedOrigin;
  /** 無法取得最新資料的原因（給 ⓘ 頁顯示）；成功時為 null */
  error: string | null;
}

export class FeedError extends Error {}

const SOURCES: readonly RecentEvent["source"][] = ["GDMS", "CWA", "USGS"];
const fail = (msg: string): never => {
  throw new FeedError(msg);
};
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isTime = (x: unknown): x is string => isStr(x) && !Number.isNaN(Date.parse(x));
const obj = (x: unknown, where: string): Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : fail(`${where} 不是物件`);
const arr = (x: unknown, where: string): unknown[] => (Array.isArray(x) ? x : fail(`${where} 不是陣列`));
const num = (x: unknown, where: string, min = -Infinity, max = Infinity): number =>
  isNum(x) && x >= min && x <= max ? x : fail(`${where} 不是 ${min}～${max} 之間的數字`);
const nums = (x: unknown, where: string, len: number, min = -Infinity) => {
  const a = arr(x, where);
  if (a.length !== len) fail(`${where} 長度應為 ${len}，實際 ${a.length}`);
  return a.map((v, i) => num(v, `${where}[${i}]`, min));
};

/** 檢查 feed 的格式與數值範圍，回傳只含已知欄位的乾淨物件；不合格就丟出 FeedError */
export function validateFeed(raw: unknown): Feed {
  const f = obj(raw, "feed");
  if (f.version !== 1) fail(`不支援的版本 ${String(f.version)}`);
  if (typeof f.mock !== "boolean") fail("mock 不是布林值");
  if (!isTime(f.issued_at)) fail("issued_at 不是時間");
  const g = obj(f.grid, "grid");
  const grid = {
    lat_min: num(g.lat_min, "grid.lat_min", -90, 90), lat_max: num(g.lat_max, "grid.lat_max", -90, 90),
    lon_min: num(g.lon_min, "grid.lon_min", -180, 180), lon_max: num(g.lon_max, "grid.lon_max", -180, 180),
    deg: num(g.deg, "grid.deg", 1e-3, 10),
  };
  if (grid.lat_max <= grid.lat_min || grid.lon_max <= grid.lon_min) fail("grid 範圍不合理");
  const p = obj(f.params, "params");
  const params = { b: num(p.b, "params.b", 0.3, 2), m_ref: num(p.m_ref, "params.m_ref", 0, 9) };
  const horizons = arr(f.horizons_days, "horizons_days").map((v, i) => num(v, `horizons_days[${i}]`, 1e-6));
  if (horizons.length < 2 || horizons.some((h, i) => i > 0 && h <= horizons[i - 1])) fail("horizons_days 必須遞增");
  const c = obj(f.cells, "cells");
  const lat = arr(c.lat, "cells.lat").map((v, i) => num(v, `cells.lat[${i}]`, grid.lat_min, grid.lat_max));
  const lon = nums(c.lon, "cells.lon", lat.length).map((v, i) => num(v, `cells.lon[${i}]`, grid.lon_min, grid.lon_max));
  if (lat.length === 0) fail("cells 是空的");
  const matrix = (x: unknown, name: string) => {
    const rows = arr(x, name);
    if (rows.length !== lat.length) fail(`${name} 列數應為 ${lat.length}`);
    return rows.map((r, i) => nums(r, `${name}[${i}]`, horizons.length, 0));
  };
  const ds = obj(f.data_status, "data_status");
  const under = obj(ds.undercount_by_horizon, "data_status.undercount_by_horizon");
  const data_status: DataStatus = {
    catalog_end: isTime(ds.catalog_end) ? ds.catalog_end : fail("data_status.catalog_end 不是時間"),
    gap_days: num(ds.gap_days, "data_status.gap_days", 0),
    n_provisional: num(ds.n_provisional, "data_status.n_provisional", 0),
    sources: arr(ds.sources, "data_status.sources").map((s, i) => (isStr(s) ? s : fail(`data_status.sources[${i}] 不是字串`))),
    undercount_by_horizon: Object.fromEntries(
      Object.entries(under).map(([k, v]) => [isNum(+k) ? k : fail(`undercount 的鍵 ${k} 不是數字`), num(v, `undercount[${k}]`, 0, 1)]),
    ),
  };
  const recent: RecentEvent[] = arr(f.recent, "recent").map((x, i) => {
    const e = obj(x, `recent[${i}]`);
    const source = SOURCES.find((s) => s === e.source) ?? fail(`recent[${i}].source 不在允許的清單內`);
    return {
      time: isTime(e.time) ? e.time : fail(`recent[${i}].time 不是時間`),
      lat: num(e.lat, `recent[${i}].lat`, -90, 90), lon: num(e.lon, `recent[${i}].lon`, -180, 180),
      depth_km: num(e.depth_km, `recent[${i}].depth_km`, -10, 1000), ml: num(e.ml, `recent[${i}].ml`, -2, 10), source,
    };
  });
  const backtest: BacktestRow[] = arr(f.backtest, "backtest").map((x, i) => {
    const r = obj(x, `backtest[${i}]`);
    return {
      m: num(r.m, `backtest[${i}].m`, 0, 10), horizon_days: num(r.horizon_days, `backtest[${i}].horizon_days`, 0),
      auc: num(r.auc, `backtest[${i}].auc`, 0, 1), ratio: num(r.ratio, `backtest[${i}].ratio`, 0),
      n_events: num(r.n_events, `backtest[${i}].n_events`, 0),
    };
  });
  return {
    version: 1, mock: f.mock as boolean, issued_at: f.issued_at as string, grid, params, horizons_days: horizons,
    cells: { lat, lon }, n_full: matrix(f.n_full, "n_full"), n_bg: matrix(f.n_bg, "n_bg"), data_status, recent, backtest,
  };
}

/** 發布時間距今超過 STALE_HOURS 就算過期（假資料不算） */
export function staleHours(feed: Feed, now = Date.now()): number | null {
  if (feed.mock) return null;
  const h = (now - Date.parse(feed.issued_at)) / 36e5;
  return h > STALE_HOURS ? h : null;
}

/** 上次成功下載的資料（沒有或格式不對就回傳 null） */
export function cachedFeed(storage: Pick<Storage, "getItem"> | null = safeStorage()): Feed | null {
  try {
    const text = storage?.getItem(CACHE_KEY);
    return text ? validateFeed(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * 下載最新的 feed。失敗（離線、逾時、格式錯誤）時退回上次成功的資料；連上次的都沒有，才用示意用假資料。
 * fetchFn、storage 可以替換，方便測試。
 */
export async function loadFeed(
  fetchFn: typeof fetch = fetch,
  storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(),
  url = FEED_URL,
): Promise<LoadedFeed> {
  let error: string;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetchFn(url, { cache: "no-cache", signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new FeedError(`HTTP ${res.status}`);
    const feed = validateFeed(await res.json());
    try {
      storage?.setItem(CACHE_KEY, JSON.stringify(feed));
    } catch {
      /* 存不了（無痕模式、空間不足）也沒關係，下次重新下載 */
    }
    return { feed, origin: "network", error: null };
  } catch (e) {
    error = e instanceof FeedError ? `資料格式錯誤：${e.message}` : e instanceof Error && e.name === "AbortError" ? "連線逾時" : "無法連線";
  }
  const cached = cachedFeed(storage);
  if (cached) return { feed: cached, origin: "cache", error };
  return { feed: makeMockFeed(), origin: "mock", error };
}
