// 我的情境（收藏）：常看的地點＋條件存起來，下次點一下就套用（使用者 11/15：「高雄住家、高科大、全台M6+、南海海槽」）。
//
// - 只存在這支手機的 localStorage，不上傳（使用者定案 J；Google 登入「有空再做」）。
// - 座標存之前先降精度，規則和「記住目前位置」相同：GPS 0.01°（約 1 公里）、地圖選點 0.001°。
// - GPS 位置存成情境後當成固定點（source 改成 map），下次開 APP 不會被自動定位換掉；定位誤差不存。
// - 「全台」情境不存位置，套用時打開專家版的全台地圖（首頁永遠是「周圍幾公里」，沒有全台模式）。
// - 讀回來時逐筆檢查（可能被改過或是舊格式），看不懂的整筆丟掉。名稱是使用者輸入的文字，畫面上一律跳脫。
import type { Cond, Place } from "./state";
import { coarsen, sanitizePlace, validCond } from "./state";

export interface Fav {
  id: string;
  name: string;
  /** place＝某個地點周圍；all＝全台（打開專家版地圖） */
  kind: "place" | "all";
  place?: Place;
  cond: Cond;
}

export const FAV_KEY = "eqrisk.favs.v1";
export const FAV_MAX = 12;
export const FAV_NAME_MAX = 20;

/** 名稱：去掉控制字元、合併空白、限制長度 */
export function cleanName(raw: string): string {
  // 換行、Tab 先變成空白再合併，其他控制字元直接拿掉
  return raw.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, FAV_NAME_MAX);
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 讀回來的資料逐筆檢查，最多 FAV_MAX 筆 */
export function sanitizeFavs(raw: unknown): Fav[] {
  if (!Array.isArray(raw)) return [];
  const out: Fav[] = [];
  for (const x of raw) {
    if (out.length >= FAV_MAX) break;
    if (!x || typeof x !== "object") continue;
    const f = x as Record<string, any>;
    const name = typeof f.name === "string" ? cleanName(f.name) : "";
    const c = f.cond;
    if (!name || typeof f.id !== "string" || !(f.kind === "place" || f.kind === "all")) continue;
    if (!c || !num(c.radiusKm) || !num(c.T) || !num(c.m)) continue;
    const cond: Cond = { radiusKm: c.radiusKm, T: c.T, m: c.m };
    if (!validCond(cond)) continue;
    if (f.kind === "all") {
      out.push({ id: f.id.slice(0, 40), name, kind: "all", cond });
      continue;
    }
    const place = sanitizePlace(f.place);
    if (place) out.push({ id: f.id.slice(0, 40), name, kind: "place", place, cond });
  }
  return out;
}

export function loadFavs(): Fav[] {
  try {
    return sanitizeFavs(JSON.parse(localStorage.getItem(FAV_KEY) || "[]"));
  } catch {
    return [];
  }
}

/** 存不了（無痕模式、空間滿了）回傳 false，畫面要告訴使用者 */
export function storeFavs(list: Fav[]): boolean {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** 把目前的位置與條件做成一個情境 */
export function makeFav(name: string, kind: Fav["kind"], place: Place, cond: Cond, id = newId()): Fav {
  const n = cleanName(name) || (kind === "all" ? `全台 M${cond.m}+` : place.label);
  if (kind === "all") return { id, name: cleanName(n), kind, cond: { ...cond } };
  const p = coarsen(place); // GPS 0.01°、地圖 0.001°；縣市是固定的代表點
  const fixed: Place = { lat: p.lat, lon: p.lon, label: p.label, source: p.source === "gps" ? "map" : p.source };
  return { id, name: cleanName(n), kind, place: fixed, cond: { ...cond } };
}

/** 同名的情境直接換掉（避免存好幾個「高雄住家」）；滿了而且不是換掉舊的，就回傳 null */
export function upsertFav(list: Fav[], fav: Fav): Fav[] | null {
  const i = list.findIndex((f) => f.name === fav.name);
  if (i >= 0) return list.map((f, j) => (j === i ? { ...fav, id: f.id } : f));
  if (list.length >= FAV_MAX) return null;
  return [...list, fav];
}

export const removeFav = (list: Fav[], id: string): Fav[] => list.filter((f) => f.id !== id);

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
