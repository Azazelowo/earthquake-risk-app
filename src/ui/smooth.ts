// 地圖平滑化：把 0.2° 格子的數值內插成連續的顏色場。
//
// 只是顯示效果——模型解析度仍是 0.2°，沒有重算、也沒有重做回測。點地圖顯示的數字一律取原始格子的值。
// 這個檔案只做數值運算（不碰 DOM），方便測試；轉成影像貼到地圖上由 map.ts 處理。
import type { Feed } from "../data/schema";

export interface Field {
  nLat: number;
  nLon: number;
  latMin: number;
  lonMin: number;
  deg: number;
  /** v[緯度索引 * nLon + 經度索引]；沒有資料的格子是 NaN */
  v: Float64Array;
}

/** 把「每格一個值」的清單排成二維網格 */
export function toField(feed: Feed, values: ArrayLike<number>): Field {
  const g = feed.grid;
  const nLat = Math.round((g.lat_max - g.lat_min) / g.deg), nLon = Math.round((g.lon_max - g.lon_min) / g.deg);
  const v = new Float64Array(nLat * nLon).fill(NaN);
  for (let i = 0; i < feed.cells.lat.length; i++) {
    const a = Math.round((feed.cells.lat[i] - g.lat_min) / g.deg), b = Math.round((feed.cells.lon[i] - g.lon_min) / g.deg);
    if (a >= 0 && a < nLat && b >= 0 && b < nLon) v[a * nLon + b] = values[i];
  }
  return { nLat, nLon, latMin: g.lat_min, lonMin: g.lon_min, deg: g.deg, v };
}

/**
 * 高斯模糊，sigma 以「格」為單位；兩個方向各做一次。
 * 邊界與沒有資料的格子：只用有資料的鄰居重新加權，所以邊緣不會被拉低，沒資料的格子也不會被填上數字。
 */
export function blur(f: Field, sigma: number): Field {
  if (!(sigma > 0)) return f;
  const R = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * R + 1 }, (_, i) => Math.exp(-((i - R) ** 2) / (2 * sigma * sigma)));
  const { nLat, nLon } = f;
  const pass = (src: Float64Array, alongLon: boolean) => {
    const out = new Float64Array(src.length).fill(NaN);
    for (let a = 0; a < nLat; a++)
      for (let b = 0; b < nLon; b++) {
        if (Number.isNaN(src[a * nLon + b])) continue;
        let sum = 0, weight = 0;
        for (let j = -R; j <= R; j++) {
          const aa = alongLon ? a : a + j, bb = alongLon ? b + j : b;
          if (aa < 0 || aa >= nLat || bb < 0 || bb >= nLon) continue;
          const x = src[aa * nLon + bb];
          if (Number.isNaN(x)) continue;
          sum += kernel[j + R] * x;
          weight += kernel[j + R];
        }
        out[a * nLon + b] = sum / weight;
      }
    return out;
  };
  return { ...f, v: pass(pass(f.v, true), false) };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/**
 * 雙線性內插：以格子中心為節點，所以在格子中心取樣會得到原本的值。
 * 網格外回傳 NaN；最外圈的半格沿用邊緣值；點所在的格子沒有資料時回傳 NaN（不把鄰居的值帶進來）。
 */
export function sample(f: Field, lat: number, lon: number): number {
  const y = (lat - f.latMin) / f.deg - 0.5, x = (lon - f.lonMin) / f.deg - 0.5;
  if (!(y >= -0.5 && y <= f.nLat - 0.5 && x >= -0.5 && x <= f.nLon - 0.5)) return NaN;
  const own = f.v[clamp(Math.round(y), 0, f.nLat - 1) * f.nLon + clamp(Math.round(x), 0, f.nLon - 1)];
  if (Number.isNaN(own)) return NaN;
  const y0 = clamp(Math.floor(y), 0, f.nLat - 1), x0 = clamp(Math.floor(x), 0, f.nLon - 1);
  const y1 = Math.min(y0 + 1, f.nLat - 1), x1 = Math.min(x0 + 1, f.nLon - 1);
  const ty = clamp(y - y0, 0, 1), tx = clamp(x - x0, 0, 1);
  let sum = 0, weight = 0;
  const add = (val: number, w: number) => {
    if (w > 0 && !Number.isNaN(val)) (sum += val * w), (weight += w);
  };
  add(f.v[y0 * f.nLon + x0], (1 - ty) * (1 - tx));
  add(f.v[y0 * f.nLon + x1], (1 - ty) * tx);
  add(f.v[y1 * f.nLon + x0], ty * (1 - tx));
  add(f.v[y1 * f.nLon + x1], ty * tx);
  return weight > 0 ? sum / weight : own;
}

const RAD = Math.PI / 180;
/** 網路地圖（麥卡托投影）的 y：緯度越高拉得越開 */
export const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
export const invMercY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;

export interface Raster {
  width: number;
  height: number;
  /** RGBA，每個像素 4 個位元組 */
  data: Uint8ClampedArray;
}
export type Rgba = readonly [number, number, number, number];

/**
 * 把數值場畫成一張影像，之後整張貼到地圖的網格範圍上。
 * 影像的每一列對應的是「麥卡托 y 等間隔」而不是「緯度等間隔」：地圖是麥卡托投影，
 * 如果用緯度等間隔，貼上去後中間會和實際位置差到約 3 公里（網格跨 5 個緯度）。
 */
export function rasterize(f: Field, pxPerCell: number, color: (v: number) => Rgba): Raster {
  const latMax = f.latMin + f.nLat * f.deg, lonSpan = f.nLon * f.deg;
  const yTop = mercY(latMax), yBot = mercY(f.latMin);
  const width = Math.max(1, Math.round(f.nLon * pxPerCell));
  const height = Math.max(1, Math.round((width * (yTop - yBot)) / (lonSpan * RAD)));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let r = 0; r < height; r++) {
    const lat = invMercY(yTop - ((r + 0.5) / height) * (yTop - yBot));
    for (let c = 0; c < width; c++) {
      const v = sample(f, lat, f.lonMin + ((c + 0.5) / width) * lonSpan);
      if (Number.isNaN(v)) continue; // 留透明
      const [R, G, B, A] = color(v);
      const o = (r * width + c) * 4;
      data[o] = R;
      data[o + 1] = G;
      data[o + 2] = B;
      data[o + 3] = A;
    }
  }
  return { width, height, data };
}

/** 平滑程度 → 高斯模糊的 sigma（格）。0＝不用影像，直接畫原始格子；1＝只做內插。 */
export const SMOOTH_SIGMA = [0, 0, 0.7, 1.4];
