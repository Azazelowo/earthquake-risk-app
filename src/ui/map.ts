// 風險地圖（Leaflet）。底圖需要網路；沒網路時格子仍會畫出來。
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { State } from "../state";
import { cellProbabilities } from "../core/hazard";
import { pct, ratioText, twTime } from "../format";
import { LEVEL_EDGES, levelOf } from "../format";

let map: L.Map | null = null;

// 機率：對數色階（淺藍→深紫），不用紅綠，避免和「狀態」顏色混淆
const P_STOPS = ["#e8f0f7", "#b9d3e8", "#7fb0d6", "#4d86bf", "#3a5da6", "#3b3a8f", "#2b1d6b"];
function pColor(p: number) {
  const t = Math.min(Math.max((Math.log10(Math.max(p, 1e-5)) + 5) / 4.5, 0), 0.999);
  return P_STOPS[Math.floor(t * P_STOPS.length)];
}
const LV_COLOR = { lv0: "#8a96a3", lv1: "#e2b93b", lv2: "#e8822e", lv3: "#d1453b" };

export function mountMap(s: State, onCell?: () => void) {
  const el = document.getElementById("map");
  if (!el) return;
  map?.remove();
  const g0 = s.feed.grid;
  map = L.map(el, { zoomControl: false, attributionControl: true });
  map.fitBounds([[g0.lat_min + 0.6, g0.lon_min + 0.6], [g0.lat_max - 0.6, g0.lon_max - 0.4]]);
  // OSM 標準圖磚（免金鑰，需標註）；CSS 轉灰階，避免底圖顏色和機率色階搶戲
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors", maxZoom: 12, className: "gray-tiles",
  }).addTo(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);

  const f = s.feed, d = f.grid.deg;
  const p = cellProbabilities(f, s.cond.m, s.cond.T, "full");
  const pb = cellProbabilities(f, s.cond.m, s.cond.T, "bg");
  f.cells.lat.forEach((la, i) => {
    const lo = f.cells.lon[i], r = p[i] / pb[i];
    const color = s.mapLayer === "p" ? pColor(p[i]) : LV_COLOR[levelOf(r).key];
    const op = s.mapLayer === "p" ? 0.62 : r < LEVEL_EDGES[0] ? 0.12 : 0.6;
    L.rectangle([[la, lo], [la + d, lo + d]], { stroke: false, fillColor: color, fillOpacity: op })
      .bindPopup(`<b>${la.toFixed(1)}–${(la + d).toFixed(1)}°N, ${lo.toFixed(1)}–${(lo + d).toFixed(1)}°E</b><br>
        M${s.cond.m}+、${s.cond.T < 1 ? "1 小時" : s.cond.T + " 天"}內（這一格）<br>
        現在 ${pct(p[i])}・平常 ${pct(pb[i])}・${ratioText(r)}`)
      .addTo(map!);
  });
  for (const e of f.recent) {
    L.circleMarker([e.lat, e.lon], { radius: 1.5 + (e.ml - 2.5) ** 1.6, color: "#111", weight: 1, fillColor: "#fff", fillOpacity: 0.7 })
      .bindPopup(`M${e.ml.toFixed(1)}・深度 ${e.depth_km} km<br>${twTime(e.time)}（${e.source}）`)
      .addTo(map!);
  }
  {
    // 地圖上永遠畫出你的位置與半徑，方便和大眾版首頁對照
    L.circle([s.place.lat, s.place.lon], { radius: s.cond.radiusKm * 1000, color: "#0f1720", weight: 1.5, dashArray: "4 4", fill: false }).addTo(map);
  }
  map.on("popupopen", () => onCell?.());

  const lg = document.getElementById("legend");
  if (lg)
    lg.innerHTML =
      s.mapLayer === "p"
        ? `<span>0.001%</span>${P_STOPS.map((c) => `<i style="background:${c}"></i>`).join("")}<span>&gt;10%</span>`
        : `${(["lv0", "lv1", "lv2", "lv3"] as const).map((k, i) => `<i style="background:${LV_COLOR[k]}"></i><span>${["≈平常", "高一些", "高不少", "遠高於"][i]}</span>`).join("")}`;
}

export function unmountMap() {
  map?.remove();
  map = null;
}
