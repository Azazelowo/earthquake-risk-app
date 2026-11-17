// 即時地震列表：手機直接呼叫 ExpTech 的地震報告 API（中央氣象署地震報告，伺服器每幾秒同步一次）。
//
// 條款（https://exptech.dev/docs/api/start/ ，2026-11-17 查）：
// - 地震報告屬「註明來源・可商用」，標示「資料來源：中央氣象署、ExpTech Studio（exptech.dev）」。
// - 原則上讓使用者直接連 ExpTech API，不要經自己的伺服器轉發 → 這裡由手機直接 fetch，不經過任何我們的伺服器。
// - 目前不需要 Token；就算之後需要，Token 也不能寫進前端。
// - TREM（測站即時資料）不得用於預測：這裡只用地震報告，而且**只顯示成列表，不進入風險計算**。
//   風險數值仍由破專題每 15 分鐘用氣象署開放資料＋USGS 重算（feed.json）。
//
// 不送出任何使用者資料：請求只有固定的查詢參數（筆數、最小震度），沒有位置。
import { esc } from "../format";

/** 依序嘗試；只有連線錯誤、逾時、5xx 才換下一個（ExpTech 文件的備援規則） */
export const EXPTECH_HOSTS = ["api.core.exptech.dev", "api.core-tnn1.exptech.dev", "api.core-tyo1.exptech.dev"];
export const EXPTECH_CREDIT = "資料來源：中央氣象署、ExpTech Studio（exptech.dev）";
const LIMIT = 50;
const TIMEOUT_MS = 8_000;

export interface Quake {
  id: string;
  /** Unix 毫秒 */
  time: number;
  lat: number;
  lon: number;
  depth_km: number;
  mag: number;
  /** 最大震度（0–7；5、6 級的弱／強在報告裡也只給整數） */
  maxInt: number;
  loc: string;
  /** true＝小區域地震，氣象署沒有編號（id 第一段結尾是 000） */
  local: boolean;
}

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** 檢查一筆；格式不對就丟掉這一筆（不讓一筆壞資料拖垮整個列表） */
export function parseQuake(x: unknown): Quake | null {
  if (x === null || typeof x !== "object") return null;
  const e = x as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.loc !== "string") return null;
  if (!fin(e.time) || !fin(e.lat) || !fin(e.lon) || !fin(e.depth) || !fin(e.mag) || !fin(e.int)) return null;
  if (Math.abs(e.lat) > 90 || Math.abs(e.lon) > 180 || e.depth < -10 || e.depth > 1000 || e.mag < -2 || e.mag > 10) return null;
  if (e.int < 0 || e.int > 9) return null;
  return {
    id: e.id.slice(0, 64), time: e.time, lat: e.lat, lon: e.lon, depth_km: e.depth, mag: e.mag, maxInt: Math.round(e.int),
    // 地點文字裡有連續空白（「北北東方  81.7  公里」），整理成一個
    loc: e.loc.replace(/\s+/g, " ").trim().slice(0, 80), local: /^\d{3}000-/.test(e.id),
  };
}

export function parseQuakes(raw: unknown): Quake[] {
  if (!Array.isArray(raw)) throw new Error("回應不是陣列");
  return raw.map(parseQuake).filter((q): q is Quake => q !== null).sort((a, b) => b.time - a.time).slice(0, LIMIT);
}

class Retryable extends Error {}

/** 下載最近的地震報告（含震度 0 的小地震）。全部主機都失敗才丟出錯誤。 */
export async function fetchQuakes(fetchFn: typeof fetch = fetch): Promise<Quake[]> {
  let last: unknown;
  for (const host of EXPTECH_HOSTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchFn(`https://${host}/api/v2/eq/report?limit=${LIMIT}&minIntensity=0`, {
        signal: ctrl.signal, cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer",
      });
      if (res.status >= 500) throw new Retryable(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(res.status === 429 ? "請求太頻繁，稍後再試" : `HTTP ${res.status}`);
      return parseQuakes(await res.json());
    } catch (e) {
      last = e;
      // 4xx 或格式錯誤：換主機也一樣，直接放棄
      const network = e instanceof Retryable || e instanceof TypeError || (e instanceof Error && e.name === "AbortError");
      if (!network) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last instanceof Error ? last : new Error("無法連線");
}

/** 震度顯示：報告只給整數；0 級寫成「0」 */
export const intText = (i: number) => `${i} 級`;

/** 列表的一列（字串一律跳脫，ExpTech 的資料也是外部輸入） */
export function quakeRow(q: Quake, time: (ms: number) => string): string {
  return `<tr><td class="q-time">${esc(time(q.time))}</td><td class="q-num">M${q.mag.toFixed(1)}</td><td class="q-num">${esc(intText(q.maxInt))}</td><td class="q-loc">${esc(q.loc)}<small>深度 ${esc(String(Math.round(q.depth_km)))} km</small></td></tr>`;
}
