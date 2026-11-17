// 鄉鎮市區判斷：全部在手機上算，位置不會送到任何伺服器。
//
// 資料：內政部國土測繪中心「鄉鎮市區界線(TWD97經緯度)」，經 scripts/build-towns.mjs 簡化成 TopoJSON
// （src/data/towns.topo.json）。簡化有誤差上限（meta.tolerance_m），所以離界線太近時不敢說是哪一區，
// 只說「XX區附近」——寧可模糊，不要講錯。
import townsUrl from "../data/towns.topo.json?url";
import { distText } from "../format";

export interface Town {
  code: string;
  county: string;
  name: string;
}

interface TownShape extends Town {
  /** [最小經度, 最小緯度, 最大經度, 最大緯度] */
  bbox: [number, number, number, number];
  /** polys[多邊形][環]＝[經度, 緯度, 經度, 緯度, …]；每個多邊形的第一個環是外框，其餘是洞 */
  polys: Float64Array[][];
}

export interface TownIndex {
  towns: TownShape[];
  /** 簡化後的界線和原始界線最多差幾公尺 */
  toleranceM: number;
  /** 來源與版本說明（顯示在 ⓘ 頁） */
  source: string;
}

/** TopoJSON 裡我們用到的部分 */
export interface TownTopology {
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: Record<string, { geometries: TopoGeometry[] }>;
  meta?: { source?: string; tolerance_m?: number };
}
interface TopoGeometry {
  type: "Polygon" | "MultiPolygon" | null;
  arcs?: number[][] | number[][][];
  properties?: Record<string, string>;
}

/**
 * 界線檔的誤差上限（公尺）。真正的值寫在界線檔的 meta.tolerance_m；這裡另放一份常數，
 * 是為了 ⓘ 頁不必先下載 300 KB 的界線檔就能顯示。towns.test.ts 會檢查兩邊一致。
 */
export const TOWN_TOLERANCE_M = 61;

const M_PER_DEG = 111_195;
const RAD = Math.PI / 180;
/** 不在任何鄉鎮區內（海上）時，最遠找這麼遠的最近鄉鎮區 */
export const NEAR_MAX_M = 20_000;

/** 把 TopoJSON 解成每個鄉鎮區的多邊形。弧線是共用的（相鄰兩區的交界只存一次），所以要自己接回環。 */
export function buildIndex(topo: TownTopology): TownIndex {
  const quantized = !!topo.transform;
  const [sx, sy] = topo.transform?.scale ?? [1, 1];
  const [tx, ty] = topo.transform?.translate ?? [0, 0];
  const arcs = topo.arcs.map((arc) => {
    const out = new Float64Array(arc.length * 2);
    let x = 0, y = 0;
    for (let i = 0; i < arc.length; i++) {
      // 有 transform 時座標是「和前一點的差」的整數，要累加再換回經緯度
      if (quantized) (x += arc[i][0]), (y += arc[i][1]);
      else (x = arc[i][0]), (y = arc[i][1]);
      out[2 * i] = x * sx + tx;
      out[2 * i + 1] = y * sy + ty;
    }
    return out;
  });
  const ring = (ids: number[]): Float64Array => {
    const pts: number[] = [];
    for (const id of ids) {
      const a = arcs[id < 0 ? ~id : id]; // 負的編號 ~i 代表這段弧要反著走
      const n = a.length / 2;
      for (let k = 0; k < n; k++) {
        if (k === 0 && pts.length) continue; // 相鄰兩段弧的接點重複，後一段略過第一個點
        const j = id < 0 ? n - 1 - k : k;
        pts.push(a[2 * j], a[2 * j + 1]);
      }
    }
    return Float64Array.from(pts);
  };

  const towns: TownShape[] = [];
  for (const obj of Object.values(topo.objects))
    for (const g of obj.geometries) {
      if (!g.type || !g.arcs) continue;
      const polys = (g.type === "Polygon" ? [g.arcs as number[][]] : (g.arcs as number[][][])).map((p) => p.map(ring));
      const bbox: TownShape["bbox"] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const poly of polys) {
        const outer = poly[0];
        for (let i = 0; i < outer.length; i += 2) {
          if (outer[i] < bbox[0]) bbox[0] = outer[i];
          if (outer[i] > bbox[2]) bbox[2] = outer[i];
          if (outer[i + 1] < bbox[1]) bbox[1] = outer[i + 1];
          if (outer[i + 1] > bbox[3]) bbox[3] = outer[i + 1];
        }
      }
      const p = g.properties ?? {};
      towns.push({ code: p.TOWNCODE ?? "", county: p.COUNTYNAME ?? "", name: p.TOWNNAME ?? "", bbox, polys });
    }
  return { towns, toleranceM: topo.meta?.tolerance_m ?? TOWN_TOLERANCE_M, source: topo.meta?.source ?? "" };
}

/** 射線法：從點往東畫一條線，數它穿過環的次數 */
function crossings(r: Float64Array, lon: number, lat: number): number {
  let c = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c++;
  }
  return c;
}

/** 外框與洞一起數：穿過奇數次＝在多邊形內（落在洞裡會是偶數次） */
function insidePolygon(poly: Float64Array[], lon: number, lat: number): boolean {
  let c = 0;
  for (const r of poly) c += crossings(r, lon, lat);
  return c % 2 === 1;
}

/** 點到環的最短距離（公尺）。範圍只有幾十公里，用以該點為原點的平面近似就夠準。 */
function ringDistM(r: Float64Array, lon: number, lat: number, kx: number): number {
  let best = Infinity;
  let ax = (r[0] - lon) * kx, ay = (r[1] - lat) * M_PER_DEG;
  for (let i = 2; i < r.length; i += 2) {
    const bx = (r[i] - lon) * kx, by = (r[i + 1] - lat) * M_PER_DEG;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.min(Math.max(-(ax * dx + ay * dy) / len2, 0), 1) : 0;
    const px = ax + t * dx, py = ay + t * dy;
    const d2 = px * px + py * py;
    if (d2 < best) best = d2;
    ax = bx;
    ay = by;
  }
  return Math.sqrt(best);
}

export interface TownMatch {
  town: Town;
  /** 0＝點在這個鄉鎮區內；否則是到它邊界的距離（公尺） */
  distM: number;
}

/** 距離 (lat, lon) 不超過 radiusM 的所有鄉鎮區，由近到遠 */
export function townsNear(idx: TownIndex, lat: number, lon: number, radiusM: number): TownMatch[] {
  const kx = M_PER_DEG * Math.cos(lat * RAD);
  const dLat = radiusM / M_PER_DEG, dLon = radiusM / Math.max(kx, 1);
  const out: TownMatch[] = [];
  for (const t of idx.towns) {
    const [x0, y0, x1, y1] = t.bbox;
    if (lon < x0 - dLon || lon > x1 + dLon || lat < y0 - dLat || lat > y1 + dLat) continue;
    let d = Infinity;
    for (const poly of t.polys) {
      if (insidePolygon(poly, lon, lat)) {
        d = 0;
        break;
      }
      for (const r of poly) d = Math.min(d, ringDistM(r, lon, lat, kx));
    }
    if (d <= radiusM) out.push({ town: { code: t.code, county: t.county, name: t.name }, distM: d });
  }
  return out.sort((a, b) => a.distM - b.distM);
}

export interface PlaceText {
  /** 例：「高雄市燕巢區」「高雄市燕巢區附近」 */
  label: string;
  /** 例：「定位誤差約 30 公尺」；沒有可說的就是空字串 */
  detail: string;
  /** true＝有把握就在這個鄉鎮區內（誤差範圍內沒有別的鄉鎮區） */
  confident: boolean;
}

function coordText(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
}

/**
 * 經緯度 → 畫面上的位置文字。
 * 判斷方式：把「定位誤差＋界線簡化誤差」當成不確定半徑，半徑內只有一個鄉鎮區才直接講名字；
 * 半徑內還有別的鄉鎮區（在交界附近），或點落在海上，就加「附近」。
 */
export function describePlace(idx: TownIndex, lat: number, lon: number, accuracyM?: number): PlaceText {
  const acc = accuracyM !== undefined && accuracyM > 0 ? accuracyM : 0;
  const uncertain = acc + idx.toleranceM;
  const accText = acc ? `定位誤差${distText(acc)}` : "";
  const near = townsNear(idx, lat, lon, Math.max(uncertain, NEAR_MAX_M));
  if (!near.length) return { label: coordText(lat, lon), detail: "不在臺灣的鄉鎮市區範圍內", confident: false };

  const first = near[0];
  const name = first.town.county + first.town.name;
  if (first.distM === 0) {
    const neighbour = near.find((t) => t.distM > 0 && t.distM <= uncertain);
    if (!neighbour) return { label: name, detail: accText, confident: true };
    return { label: `${name}附近`, detail: accText || `靠近${neighbour.town.name}交界`, confident: false };
  }
  // 不在任何鄉鎮區內：在海上，或剛好落在簡化後的海岸線外側
  const offshore = first.distM > uncertain ? `離岸${distText(first.distM)}` : "";
  return { label: `${name}附近`, detail: [offshore, accText].filter(Boolean).join("・"), confident: false };
}

let pending: Promise<TownIndex> | null = null;

/** 界線檔約 200 KB，用到才載（第一次定位或點地圖時）；service worker 會存起來，之後離線也能用 */
export function loadTowns(): Promise<TownIndex> {
  if (!pending) {
    pending = fetch(townsUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<TownTopology>;
      })
      .then(buildIndex);
    pending.catch(() => (pending = null)); // 載入失敗（例如第一次開就離線）：下次再試
  }
  return pending;
}
