// 假資料：只為雛型，格式與正式 feed.json 相同。數值是「看起來合理」的量級，不是模型輸出。
// 空間分布大致仿台灣東部外海較活躍、西南部次之；另放一個「兩天前花蓮外海 M5.8」的假序列，
// 讓畫面能同時看到「和平常差不多」與「比平常高」兩種狀態。
import type { Feed, RecentEvent, BacktestRow } from "./schema";

const HORIZONS = [1 / 24, 3 / 24, 6 / 24, 12 / 24, 1, 2, 3, 7, 14, 30];
const GRID = { lat_min: 21, lat_max: 26, lon_min: 119, lon_max: 123, deg: 0.2 };

// 背景活躍區（中心緯度、經度、寬度°、權重）
const ZONES: [number, number, number, number][] = [
  [23.8, 121.8, 0.45, 8], // 花蓮外海
  [22.9, 121.5, 0.4, 5], // 台東外海
  [24.6, 122.0, 0.35, 6], // 宜蘭外海
  [23.2, 120.5, 0.35, 3], // 嘉南
  [23.9, 120.9, 0.3, 2.5], // 中部山區
  [22.1, 120.7, 0.35, 2], // 恆春外海
];
const MAIN = { lat: 23.95, lon: 121.72, ml: 5.8, daysAgo: 2.0 };

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** 大森定律 (c+s)^-p 從 a 積到 b */
const omoriInt = (a: number, b: number, c = 0.01, p = 0.8) =>
  ((c + b) ** (1 - p) - (c + a) ** (1 - p)) / (1 - p);

export function makeMockFeed(now = new Date()): Feed {
  const lat: number[] = [], lon: number[] = [], n_full: number[][] = [], n_bg: number[][] = [];
  const g = GRID;
  for (let la = g.lat_min; la < g.lat_max - 1e-9; la += g.deg)
    for (let lo = g.lon_min; lo < g.lon_max - 1e-9; lo += g.deg) {
      const cla = la + g.deg / 2, clo = lo + g.deg / 2;
      let w = 0.15;
      for (const [zla, zlo, s, k] of ZONES) w += k * Math.exp(-((cla - zla) ** 2 + (clo - zlo) ** 2) / (2 * s * s));
      const bgRate = 0.0009 * w; // M≥3.5 每格每天
      const d2 = (cla - MAIN.lat) ** 2 + (clo - MAIN.lon) ** 2;
      const amp = 0.1 * Math.exp(-d2 / (2 * 0.25 ** 2));
      lat.push(+la.toFixed(1));
      lon.push(+lo.toFixed(1));
      n_bg.push(HORIZONS.map((T) => bgRate * T));
      n_full.push(HORIZONS.map((T) => bgRate * T * 0.95 + amp * omoriInt(MAIN.daysAgo, MAIN.daysAgo + T)));
    }

  const r = rng(42);
  const recent: RecentEvent[] = [];
  const t0 = now.getTime();
  recent.push({ time: new Date(t0 - MAIN.daysAgo * 864e5).toISOString(), lat: MAIN.lat, lon: MAIN.lon, depth_km: 18, ml: MAIN.ml, source: "CWA" });
  for (let i = 0; i < 26; i++) {
    const s = MAIN.daysAgo * r() ** 2.5; // 越接近主震越密
    recent.push({
      time: new Date(t0 - (MAIN.daysAgo - s) * 864e5).toISOString(),
      lat: MAIN.lat + (r() - 0.5) * 0.4, lon: MAIN.lon + (r() - 0.5) * 0.4,
      depth_km: Math.round(8 + r() * 25), ml: +(3 + r() ** 3 * 2.2).toFixed(1), source: r() < 0.6 ? "CWA" : "USGS",
    });
  }
  for (let i = 0; i < 18; i++) {
    const z = ZONES[Math.floor(r() * ZONES.length)];
    recent.push({
      time: new Date(t0 - r() * 30 * 864e5).toISOString(),
      lat: z[0] + (r() - 0.5) * 0.8, lon: z[1] + (r() - 0.5) * 0.8,
      depth_km: Math.round(5 + r() * 40), ml: +(3 + r() ** 3 * 2).toFixed(1), source: r() < 0.5 ? "CWA" : "USGS",
    });
  }
  recent.sort((a, b) => b.time.localeCompare(a.time));

  const backtest: BacktestRow[] = [];
  for (const m of [3.5, 4, 5, 6])
    for (const T of [1 / 24, 1, 3, 7, 30]) {
      const n = Math.round(4600 * 10 ** (-0.77 * (m - 3.5)) * Math.min(1, T / 30 + 0.02) + 3);
      backtest.push({
        m, horizon_days: T, n_events: n,
        auc: +(0.95 - (m - 3.5) * 0.015 - (T > 7 ? 0.03 : 0)).toFixed(3),
        ratio: +(T <= 1 && m >= 6 ? 1.62 : 0.95 + ((m * 7 + T) % 0.2)).toFixed(2),
      });
    }

  const iso = new Date(Math.floor(t0 / 36e5) * 36e5).toISOString();
  return {
    version: 1, mock: true, issued_at: iso, grid: g, params: { b: 0.77, m_ref: 3.5 },
    horizons_days: HORIZONS, cells: { lat, lon }, n_full, n_bg, recent, backtest,
    data_status: {
      catalog_end: new Date(t0 - 47 * 864e5).toISOString(), gap_days: 47, n_provisional: 63,
      sources: ["CWA 有感地震報告", "USGS"],
      undercount_by_horizon: { "1": 0.05, "3": 0.09, "7": 0.13, "30": 0.18 },
    },
  };
}
