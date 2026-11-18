// 分享網址（Phase 4）：把目前的位置與條件放進網址，對方打開就看到同一組（使用者 11/15：「分享網址直接還原目前條件」）。
//
// 隱私（2026-11-18 使用者確認）：
// - 「選縣市」的位置：只放縣市名稱，對方用 APP 內建的代表點。
// - 在地圖上點的位置：放座標，取到 0.01°（約 1 公里）。
// - GPS 定位的位置（以及由它存成的情境）：預設不放，使用者勾選才放（同樣 0.01°）——連結會留在聊天紀錄裡。
// - APP 自己不會把網址送去任何地方：分享是交給手機的系統分享或剪貼簿，傳給誰由使用者決定。
// 安全（審查 Q6）：網址是外部輸入。數字一律夾在滑桿範圍內並取到刻度；縣市名稱必須和內建清單完全相同；
// 網址裡的任何文字都不會出現在畫面上（地點名稱由收到的手機自己判斷）。
import type { Cond, Place } from "./state";
import { COUNTIES, M_MAX, M_MIN, RADIUS_MAX, RADIUS_MIN, niceTime } from "./state";

export interface SharedView {
  /** 網址裡有、而且看得懂的條件（缺的沿用對方自己的設定） */
  cond: Partial<Cond>;
  place?: { kind: "county"; name: string; lat: number; lon: number } | { kind: "point"; lat: number; lon: number };
}

/** 這個位置是縣市（「選縣市」或還沒選過的預設值），回傳縣市名稱 */
function countyOf(p: Place): string | null {
  if (p.source !== "county" && p.source !== "default") return null;
  return COUNTIES.some((c) => c.name === p.label) ? p.label : null;
}

/** 分享面板「附上位置」預設要不要勾：GPS 定位、或由 GPS 存成的固定點，預設不勾 */
export const shareLocationByDefault = (p: Place): boolean => !(p.source === "gps" || p.personal);

/** 分享面板上「附上位置」後面的說明 */
export function shareLocationText(p: Place): string {
  const county = countyOf(p);
  if (county) return county;
  if (p.source === "gps" || p.personal) return "你的位置（約 1 公里精度）";
  return "地圖上選的點（約 1 公里精度）";
}

/** base 是網站網址（# 前面那段）；includeLocation＝使用者勾了「附上位置」 */
export function buildShareUrl(base: string, place: Place, cond: Cond, includeLocation: boolean): string {
  const q = new URLSearchParams();
  q.set("r", String(cond.radiusKm));
  q.set("t", String(+cond.T.toFixed(5)));
  q.set("m", String(cond.m));
  if (includeLocation) {
    const county = countyOf(place);
    if (county) q.set("c", county);
    else (q.set("lat", place.lat.toFixed(2)), q.set("lon", place.lon.toFixed(2)));
  }
  return `${base.split("#")[0]}#/?${q}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** 解析分享網址的 hash（例如 `#/?r=50&t=3&m=5&c=高雄市`）；不是分享網址就回傳 null */
export function parseShare(hash: string): SharedView | null {
  const i = hash.indexOf("?");
  if (!hash.startsWith("#/") || i < 0) return null;
  const q = new URLSearchParams(hash.slice(i + 1));
  const num = (k: string) => {
    const v = q.get(k);
    return v === null || v.trim() === "" ? NaN : Number(v);
  };
  const cond: Partial<Cond> = {};
  const r = num("r"), t = num("t"), m = num("m");
  if (Number.isFinite(r)) cond.radiusKm = clamp(Math.round(r), RADIUS_MIN, RADIUS_MAX);
  if (Number.isFinite(t)) cond.T = niceTime(t); // niceTime 會夾在 1 小時–30 天
  if (Number.isFinite(m)) cond.m = clamp(Math.round(m * 10) / 10, M_MIN, M_MAX);

  let place: SharedView["place"];
  const name = q.get("c");
  const county = name === null ? undefined : COUNTIES.find((c) => c.name === name);
  if (county) place = { kind: "county", name: county.name, lat: county.lat, lon: county.lon };
  else {
    const lat = num("lat"), lon = num("lon");
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
      place = { kind: "point", lat: +lat.toFixed(2), lon: +lon.toFixed(2) };
  }
  if (!Object.keys(cond).length && !place) return null;
  return place ? { cond, place } : { cond };
}
