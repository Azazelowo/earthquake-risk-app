// 風險地圖（Leaflet）。底圖需要網路；沒網路時機率格子仍會畫出來。
//
// 這個 APP 每次狀態改變都整頁重畫（innerHTML），但地圖不能跟著重建——否則每按一個按鈕，
// 地圖就跳回全台視角、圖磚全部重抓。所以 Leaflet 的容器（host）由這個模組自己留著：
// 重畫前 detachMap() 把它拿出來，重畫後 mountMap() 再放回新的版面裡，只更新需要變的圖層。
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { State } from "../state";
import { cellProbabilities } from "../core/hazard";
import { LEVEL_EDGES, twTime } from "../format";
import { resolveBasemap, tileUrl } from "./basemaps";
import { blur, rasterize, toField, SMOOTH_SIGMA, type Rgba } from "./smooth";

export interface MapHooks {
  /** 使用者點了地圖上的一個位置（點到地震圓點不算） */
  onPick(lat: number, lon: number): void;
}

// 機率：對數色階（淺藍→深紫），不用紅綠，避免和「狀態」顏色混淆
const P_STOPS = ["#e8f0f7", "#b9d3e8", "#7fb0d6", "#4d86bf", "#3a5da6", "#3b3a8f", "#2b1d6b"];
const P_LOG_MIN = -5, P_LOG_SPAN = 4.5; // 10⁻⁵（0.001%）到 10⁻⁰·⁵（約 32%）
const pStop = (logP: number) => Math.floor(Math.min(Math.max((logP - P_LOG_MIN) / P_LOG_SPAN, 0), 0.999) * P_STOPS.length);
const LV_COLORS = ["#8a96a3", "#e2b93b", "#e8822e", "#d1453b"];
const lvStop = (logRatio: number) => {
  const r = 10 ** logRatio;
  return r < LEVEL_EDGES[0] ? 0 : r < LEVEL_EDGES[1] ? 1 : r < LEVEL_EDGES[2] ? 2 : 3;
};
const P_OPACITY = 0.62;
const lvOpacity = (stop: number) => (stop === 0 ? 0.12 : 0.6); // 「和平常差不多」幾乎透明，才看得出哪裡偏高
const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const P_RGB = P_STOPS.map(hexRgb), LV_RGB = LV_COLORS.map(hexRgb);

/** 平滑影像每格用幾個像素（20×25 格 → 480×約 630 像素，手機上算一次約十幾毫秒） */
const PX_PER_CELL = 24;

let map: L.Map | null = null;
let host: HTMLDivElement | null = null;
let hooks: MapHooks | null = null;
let base: L.TileLayer | null = null;
let baseKey = "";
let risk: L.LayerGroup | null = null; // 機率格子或平滑影像（在底圖上、地震圓點下）
let riskCanvas: L.Canvas | null = null;
let riskKey = "";
let marks: L.LayerGroup | null = null; // 地震圓點、你的圓與中心點
let circles: L.Circle[] = [];
let tileFailures = 0;

export function mountMap(s: State, h: MapHooks) {
  const slot = document.getElementById("map");
  if (!slot) return;
  hooks = h;
  if (!map || !host) {
    host = document.createElement("div");
    host.className = "map-host";
    slot.appendChild(host);
    map = L.map(host, { zoomControl: false, attributionControl: true, preferCanvas: true, minZoom: 5, maxZoom: 16 });
    // 一開始對準臺灣本島（比模型網格小一圈）：手機上地圖只有三百多像素高，對準整個網格會縮到太小
    const g = s.feed.grid;
    map.fitBounds([[g.lat_min + 0.9, g.lon_min + 1.0], [g.lat_max - 0.65, g.lon_max - 0.95]]);
    // 預設的前綴帶一面旗子，手機上太佔位置；保留 Leaflet 的名字與連結就好
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ imperial: false, position: "bottomleft", maxWidth: 90 }).addTo(map);
    map.createPane("risk").style.zIndex = "350"; // 底圖（200）之上、圓點與線（400）之下
    riskCanvas = L.canvas({ pane: "risk" });
    risk = L.layerGroup().addTo(map);
    marks = L.layerGroup().addTo(map);
    map.on("click", (ev) => hooks?.onPick(ev.latlng.lat, ev.latlng.lng));
  } else {
    slot.appendChild(host);
    // 容器大小可能變了（進出全螢幕）：重新量尺寸，並保持畫面中心不動
    map.invalidateSize({ animate: false });
  }
  syncBase(s);
  drawRisk(s);
  drawMarks(s);
  drawLegend(s);
  showNote();
}

/** 整頁重畫前呼叫：先把地圖容器拿出來，免得跟著舊版面一起被丟掉 */
export function detachMap() {
  host?.remove();
}

function syncBase(s: State) {
  if (!map) return;
  const b = resolveBasemap(s.basemap);
  const url = tileUrl(b);
  const key = `${b.id}|${url}`;
  if (key === baseKey) return;
  baseKey = key;
  base?.remove();
  tileFailures = 0;
  base = L.tileLayer(url, {
    attribution: b.attribution,
    maxZoom: 16,
    maxNativeZoom: b.maxNativeZoom,
    subdomains: b.subdomains ?? "abc",
    className: b.className ?? "",
  });
  // 連續載入失敗（對方伺服器掛了、金鑰被拒、離線）就提示可以換底圖；只要有一張成功就收回
  base.on("tileerror", () => {
    tileFailures++;
    showNote();
  });
  base.on("tileload", () => {
    if (!tileFailures) return;
    tileFailures = 0;
    showNote();
  });
  base.addTo(map);
}

function showNote() {
  const el = document.getElementById("map-note");
  if (!el) return;
  const msg = !navigator.onLine ? "目前離線：沒有底圖，機率仍可查看" : tileFailures >= 4 ? "這個底圖載不出來，可以按右上角換一個" : "";
  el.textContent = msg;
  el.hidden = !msg;
}

function drawRisk(s: State) {
  if (!map || !risk) return;
  const f = s.feed, g = f.grid;
  const key = [f.issued_at, s.cond.m, s.cond.T, s.mapLayer, s.smooth].join("|");
  if (key === riskKey) return;
  riskKey = key;
  risk.clearLayers();

  const p = cellProbabilities(f, s.cond.m, s.cond.T, "full");
  const pb = cellProbabilities(f, s.cond.m, s.cond.T, "bg");
  const byRatio = s.mapLayer === "ratio";
  // 一律在對數空間處理：色階是對數的，內插後的等色帶才會均勻
  const logv = p.map((x, i) => Math.log10(Math.max(x, 1e-12) / (byRatio ? Math.max(pb[i], 1e-12) : 1)));
  const stopOf = byRatio ? lvStop : pStop;
  const rgb = byRatio ? LV_RGB : P_RGB;
  const opacityOf = byRatio ? lvOpacity : () => P_OPACITY;

  if (s.smooth <= 0) {
    // 原始格子：一格一個矩形，位置完全精確
    const d = g.deg, hex = byRatio ? LV_COLORS : P_STOPS;
    f.cells.lat.forEach((la, i) => {
      const lo = f.cells.lon[i], stop = stopOf(logv[i]);
      L.rectangle([[la, lo], [la + d, lo + d]], {
        stroke: false, fillColor: hex[stop], fillOpacity: opacityOf(stop), interactive: false, pane: "risk", renderer: riskCanvas!,
      }).addTo(risk!);
    });
    return;
  }
  // 平滑：把格子的值內插成一張影像貼上去（只是顯示效果，見 smooth.ts）
  const field = blur(toField(f, logv), SMOOTH_SIGMA[s.smooth] ?? 0);
  const ras = rasterize(field, PX_PER_CELL, (v): Rgba => {
    const stop = stopOf(v);
    return [rgb[stop][0], rgb[stop][1], rgb[stop][2], Math.round(opacityOf(stop) * 255)];
  });
  const cv = document.createElement("canvas");
  cv.width = ras.width;
  cv.height = ras.height;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(ras.width, ras.height);
  img.data.set(ras.data);
  ctx.putImageData(img, 0, 0);
  L.imageOverlay(cv.toDataURL(), [[g.lat_min, g.lon_min], [g.lat_max, g.lon_max]], { interactive: false, pane: "risk" }).addTo(risk);
}

function drawMarks(s: State) {
  if (!map || !marks) return;
  marks.clearLayers();
  for (const e of s.feed.recent) {
    L.circleMarker([e.lat, e.lon], {
      radius: 1.5 + Math.max(e.ml - 2.5, 0) ** 1.6, color: "#111", weight: 1, fillColor: "#fff", fillOpacity: 0.7,
      bubblingMouseEvents: false, // 點地震圓點只看它的資訊，不要當成「換中心」
    })
      .bindPopup(`M${e.ml.toFixed(1)}・深度 ${e.depth_km} km<br>${twTime(e.time)}（${e.source}）`)
      .addTo(marks);
  }
  // 你的範圍：白色粗線墊底＋深色虛線，淺色、深色、航照底圖上都看得到
  const center: L.LatLngTuple = [s.place.lat, s.place.lon];
  const radius = s.cond.radiusKm * 1000;
  circles = [
    L.circle(center, { radius, color: "#fff", weight: 4, opacity: 0.85, fill: false, interactive: false }),
    L.circle(center, { radius, color: "#0f1720", weight: 2, dashArray: "6 6", fill: false, interactive: false }),
  ];
  circles.forEach((c) => c.addTo(marks!));
  L.circleMarker(center, { radius: 6, color: "#fff", weight: 2.5, fillColor: "#1f6fb8", fillOpacity: 1, interactive: false }).addTo(marks);
}

/** 拖半徑滑桿時只改圓的大小，不重畫整頁（否則滑桿會被重建、拖不動） */
export function setRadiusLive(radiusKm: number) {
  for (const c of circles) c.setRadius(radiusKm * 1000);
}

/** 把視角移到指定的圓（按「我的位置」之後用） */
export function focusCircle(lat: number, lon: number, radiusKm: number) {
  map?.fitBounds(L.latLng(lat, lon).toBounds(Math.max(radiusKm, 5) * 2000), { padding: [28, 28], maxZoom: 12 });
}

function drawLegend(s: State) {
  const lg = document.getElementById("legend");
  if (!lg) return;
  lg.innerHTML =
    s.mapLayer === "p"
      ? `<span>0.001%</span>${P_STOPS.map((c) => `<i style="background:${c}"></i>`).join("")}<span>&gt;10%</span>`
      : LV_COLORS.map((c, i) => `<i style="background:${c}"></i><span>${["≈平常", "高一些", "高不少", "遠高於"][i]}</span>`).join("");
}
