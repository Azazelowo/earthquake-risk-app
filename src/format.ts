// 數字與狀態的呈現。狀態只看「和平常比的倍數」；門檻是暫定值，要用回測資料看各狀態出現頻率後再定。

export interface Level {
  key: "lv0" | "lv1" | "lv2" | "lv3";
  title: string;
  hint: string;
}

// 門檻（倍數），2026-11-21 用「真的發生的地震」檢查過（見 LEVEL_BACKTEST.realized）。刻意不用綠色、不說「安全」：台灣本來就常有地震。
export const LEVEL_EDGES = [1.5, 3, 10];

/**
 * 門檻的回測檢查（破專題 app/state_frequency.py → docs/reports/state_frequency.md）：
 * 測試期 2015-01-01～2026-09-30 每天、20 個縣市代表點、首頁預設條件（50 km・3 天・M5 以上），
 * 各狀態出現的比例。share：所有縣市×天；topCounty：全台排行第一名那一天的狀態。
 * 2026-11-21 重算（v1.2）：11-18 的版本（「高不少」以上 2.9%）把「平常」算低了約 2.6 倍（state_frequency.py 的錯誤，
 * 已修正），和 APP 實際的算法不一致；用 APP 的算法，「高不少」以上只占 0.8%（每縣市一年約 3 天）。
 *
 * 2026-11-21 決定維持 1.5／3／10（使用者把決定交給我們）：事先定好規則——各狀態之後 3 天內代表點 50 km 內
 * 真的發生 M5 以上的比例 ÷ 該組「平常」機率（實際倍數），若落在（或信賴區間碰到）該狀態的範圍就維持。
 * 結果 0.41／1.15／3.42／9.39，四個都符合，而且依序上升——標籤有資訊、沒有誇大。
 * 同日稍晚套用群聚係數 κ（機率換算）後重算：0.73／1.94／5.34／16.8，和模型倍數（0.65／1.97／4.60／12.4）幾乎一致。不讓門檻自動調整：
 * 門檻是「倍數」的意思，自動改會讓「高不少」今天和明年代表不同的東西；改成定期用新發生的地震重做這個檢查。
 */
export const LEVEL_BACKTEST = {
  days: 4291,
  share: [0.9169, 0.0745, 0.0081, 0.0004],
  topCounty: [0.3384, 0.5477, 0.1063, 0.0077],
  /** 之後 3 天內 50 km 內真的發生 M5 以上的比例（各狀態） */
  hitRate: [0.0075, 0.0241, 0.1288, 0.4595],
  /** 實際倍數＝真的發生的比例 ÷ 平常的平均機率，和 95% 區間（以月為單位整塊重抽樣）。2026-11-21 套用 κ 後重算 */
  realized: [0.73, 1.94, 5.34, 16.77],
  realizedCI: [[0.58, 0.88], [1.35, 2.57], [2.9, 8.69], [0, 23.85]],
  /** 「遠高於」只有 37 個縣市×天，數字只能參考 */
  n: [78688, 6396, 699, 37],
} as const;

export function levelOf(ratio: number): Level {
  // 倍數算不出來（範圍內沒有模型格子）時不能落到最高等級；呼叫端應該先檢查 covered，這裡是最後一道保險
  if (!isFinite(ratio)) return { key: "lv0", title: "無法比較", hint: "這個範圍沒有可用的模型資料。" };
  if (ratio < LEVEL_EDGES[0])
    return { key: "lv0", title: "和平常差不多", hint: "台灣本來就常有地震，平時的防震準備照常就好。" };
  if (ratio < LEVEL_EDGES[1])
    return { key: "lv1", title: "比平常高一些", hint: "附近最近有地震活動，機率比平常略高。" };
  if (ratio < LEVEL_EDGES[2])
    return { key: "lv2", title: "比平常高不少", hint: "附近最近有較明顯的地震活動，可以檢查一下防震準備。" };
  return { key: "lv3", title: "遠高於平常", hint: "附近剛有較大地震，之後幾天常有餘震。" };
}

export function pct(p: number): string {
  if (!(p > 0)) return "0%";
  if (p < 0.001) return "< 0.1%";
  if (p < 0.01) return `${(p * 100).toFixed(2)}%`;
  if (p < 0.1) return `${(p * 100).toFixed(1)}%`;
  if (p > 0.99) return "> 99%";
  return `${Math.round(p * 100)}%`;
}

/** 「約 1/42」——一般人比較好想像 */
export function odds(p: number): string {
  if (!(p > 0)) return "";
  if (p >= 0.5) return "";
  const n = 1 / p;
  const r = n < 20 ? Math.round(n) : n < 200 ? Math.round(n / 5) * 5 : n < 2000 ? Math.round(n / 50) * 50 : Math.round(n / 500) * 500;
  return `約 1/${r.toLocaleString("zh-TW")}`;
}

export function ratioText(r: number): string {
  if (!isFinite(r)) return "—";
  if (r < 1.15) return "約 1 倍";
  return r < 10 ? `約 ${r.toFixed(1)} 倍` : `約 ${Math.round(r)} 倍`;
}

export function twTime(iso: string, withDate = true): string {
  const d = new Date(iso);
  const o: Intl.DateTimeFormatOptions = { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false };
  if (withDate) Object.assign(o, { month: "numeric", day: "numeric" });
  return d.toLocaleString("zh-TW", o);
}

/** 含年份的台灣時間，例：「2024/4/3 07:58」（歷史回放用） */
export function twFull(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/** 多久以前；now 預設是現在（歷史回放時傳回放的時間點） */
export function ago(iso: string, now = Date.now()): string {
  const h = (now - new Date(iso).getTime()) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} 分鐘前`;
  if (h < 48) return `${Math.round(h)} 小時前`;
  return `${Math.round(h / 24)} 天前`;
}

/** 距離：「約 30 公尺」「約 850 公尺」「約 1.5 公里」——取整到看得懂的刻度，不假裝精確 */
export function distText(m: number): string {
  if (!(m >= 0)) return "";
  if (m < 100) return `約 ${Math.max(10, Math.round(m / 10) * 10)} 公尺`;
  if (m < 1000) return `約 ${Math.round(m / 50) * 50} 公尺`;
  if (m < 10000) return `約 ${(m / 1000).toFixed(1)} 公里`;
  return `約 ${Math.round(m / 1000)} 公里`;
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
