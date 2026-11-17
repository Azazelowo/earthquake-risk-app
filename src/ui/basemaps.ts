// 底圖清單。每一個都查過使用條款（2026-11-15，整理在 docs/DESIGN.md §8）：
// - 全部只在使用者看地圖時向對方的伺服器要圖磚；service worker 不攔截也不另外存（多數條款禁止預抓與離線保存）。
// - 每個底圖的來源標示由 Leaflet 顯示在地圖角落，不可移除或遮住（OSM、CARTO 的條款都明文要求）。
//
// CARTO 自 2026-09-25 起必須帶金鑰，而且金鑰是放在圖磚網址裡——任何用到它的網頁都看得到，
// 這是 CARTO 的設計（靠後台的「網域限制」保護），不是我們能藏起來的。所以金鑰有兩個來源：
//   1. 使用者在 ⓘ 頁貼上自己的金鑰（只存在那支手機的 localStorage）
//   2. 建置時的環境變數 VITE_CARTO_KEY（會被打包進公開網站；要不要用由專案擁有者決定）
// 沒有金鑰時 CARTO 選項仍在清單上，但標示「需要金鑰」、不可選。

export interface Basemap {
  id: string;
  name: string;
  /** 清單上的一行補充說明 */
  note: string;
  url: string;
  attribution: string;
  /** 對方實際提供的最大縮放層級；再放大就用這一層的圖磚拉大 */
  maxNativeZoom: number;
  subdomains?: string;
  /** 套在圖磚上的 CSS class（淡化、反相） */
  className?: string;
  carto?: boolean;
}

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const NLSC_ATTR = '圖資來源：<a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">內政部國土測繪中心</a>';
const CARTO_ATTR = `${OSM_ATTR}, © <a href="https://carto.com/attribution/" target="_blank" rel="noopener">CARTO</a>`;
const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const nlsc = (layer: string) => `https://wmts.nlsc.gov.tw/wmts/${layer}/default/GoogleMapsCompatible/{z}/{y}/{x}`;
const carto = (style: string) => `https://{s}.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}.png?key={key}`;

export const BASEMAPS: Basemap[] = [
  { id: "osm", name: "OpenStreetMap（淡化）", note: "預設。轉成灰階，機率顏色比較清楚", url: OSM_URL, attribution: OSM_ATTR, maxNativeZoom: 19, className: "tiles-gray" },
  {
    id: "topo", name: "OpenTopoMap 地形圖", note: "等高線與地形陰影；伺服器較慢，偶爾載不出來",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", subdomains: "abc", maxNativeZoom: 17,
    attribution: `地圖資料 ${OSM_ATTR}、SRTM｜地圖樣式 © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a>（<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC-BY-SA</a>）`,
  },
  { id: "nlsc", name: "國土測繪中心 通用電子地圖", note: "中文地名最完整", url: nlsc("EMAP"), attribution: NLSC_ATTR, maxNativeZoom: 19 },
  { id: "nlsc-photo", name: "國土測繪中心 正射影像（航照）", note: "空拍影像", url: nlsc("PHOTO2"), attribution: NLSC_ATTR, maxNativeZoom: 19 },
  { id: "dark", name: "深色", note: "OpenStreetMap 反相，適合晚上看", url: OSM_URL, attribution: OSM_ATTR, maxNativeZoom: 19, className: "tiles-dark" },
  { id: "carto-voyager", name: "CARTO Voyager", note: "彩色、簡潔", url: carto("voyager"), subdomains: "abcd", attribution: CARTO_ATTR, maxNativeZoom: 20, carto: true },
  { id: "carto-light", name: "CARTO Positron", note: "淺灰", url: carto("light_all"), subdomains: "abcd", attribution: CARTO_ATTR, maxNativeZoom: 20, carto: true },
  { id: "carto-dark", name: "CARTO Dark Matter", note: "深色", url: carto("dark_all"), subdomains: "abcd", attribution: CARTO_ATTR, maxNativeZoom: 20, carto: true },
];

export const DEFAULT_BASEMAP = "osm";
const CARTO_KEY_STORE = "eqrisk.cartoKey";

/** CARTO 金鑰看起來的樣子：英數字與少數符號。擋掉空白、網址等明顯貼錯的內容，也避免奇怪字元進到網址裡。 */
export const validCartoKey = (key: string) => /^[A-Za-z0-9_.\-]{8,200}$/.test(key);

/** 這支裝置上存的金鑰優先，其次是建置時內建的；都沒有就是空字串 */
export function cartoKey(): string {
  try {
    const own = localStorage.getItem(CARTO_KEY_STORE);
    if (own && validCartoKey(own)) return own;
  } catch {
    /* 無痕模式等：當作沒有 */
  }
  const built = import.meta.env.VITE_CARTO_KEY ?? "";
  return validCartoKey(built) ? built : "";
}

/** 金鑰是不是這支裝置自己存的（決定 ⓘ 頁顯示「清除」還是「內建」） */
export function hasOwnCartoKey(): boolean {
  try {
    return validCartoKey(localStorage.getItem(CARTO_KEY_STORE) ?? "");
  } catch {
    return false;
  }
}

/** 存金鑰（空字串＝清除）。回傳是否成功。 */
export function setCartoKey(key: string): boolean {
  const k = key.trim();
  try {
    if (!k) localStorage.removeItem(CARTO_KEY_STORE);
    else if (validCartoKey(k)) localStorage.setItem(CARTO_KEY_STORE, k);
    else return false;
    return true;
  } catch {
    return false;
  }
}

/** 這個底圖現在能不能用（CARTO 要有金鑰） */
export const usable = (b: Basemap) => !b.carto || !!cartoKey();

/** 依代號找底圖；代號不存在、或是 CARTO 但沒有金鑰，就退回預設底圖 */
export function resolveBasemap(id: string): Basemap {
  const b = BASEMAPS.find((x) => x.id === id);
  return b && usable(b) ? b : BASEMAPS.find((x) => x.id === DEFAULT_BASEMAP)!;
}

/** 填好金鑰的圖磚網址樣板（{s}{z}{x}{y} 留給 Leaflet 填） */
export const tileUrl = (b: Basemap) => (b.carto ? b.url.replace("{key}", encodeURIComponent(cartoKey())) : b.url);
