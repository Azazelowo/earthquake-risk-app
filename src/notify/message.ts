// 通知的文字。規則（AGENTS.md 與專案共識）：不說「安全」「保證」「即將發生」；每一則都要看得出「不是預報／預警」；
// 機率一定附「平常」當對照；倍數小於 1 不會觸發通知（倍數只在達到門檻時才出現在文字裡）。
import { distText, levelOf, pct, ratioText, twTime } from "../format";
import { haversineKm } from "../core/hazard";
import type { RecentEvent } from "../data/schema";
import type { Fav } from "../favs";
import { placeShort, timeLabel } from "../state";
import type { Rule } from "./rules";

export interface Msg {
  title: string;
  body: string;
  /** 同一條規則的通知用同一個 tag：新的取代舊的，不會在通知中心堆一排 */
  tag: string;
}

export const NOT_FORECAST = "這是機率評估，不是地震預報或預警。";
export const QUAKE_NOTE = "這是事後的地震報告，資料可能延遲數分鐘到數十分鐘；不是預警，緊急警報請看氣象署官方 APP。";

/**
 * 倍數的文字。首頁的 ratioText 把所有小於 1.15 的值都寫成「約 1 倍」，那是給一般人看的簡化；
 * 通知設定要讓人看清楚「現在比平常安靜多少」，所以小於 1 時顯示實際的倍數，並說明那不是「比較安全」。
 */
export function ratioLabel(r: number): string {
  if (!Number.isFinite(r)) return "—";
  if (r < 0.95) return `約 ${r < 0.1 ? r.toFixed(2) : r.toFixed(1)} 倍，比近兩年平均安靜`;
  return ratioText(r);
}

export function scopeText(fav: Fav): string {
  return fav.kind === "all" || !fav.place ? "全台" : `${placeShort(fav.place)}周圍 ${fav.cond.radiusKm} km`;
}

export interface Value {
  p: number;
  pBg: number;
  ratio: number;
}

function condText(fav: Fav, v: Value): string {
  const c = fav.cond;
  return `${scopeText(fav)}${timeLabel(c.T)}內 M${c.m} 以上的機率 ${pct(v.p)}，平常約 ${pct(v.pBg)}（${ratioLabel(v.ratio)}）。`;
}

export function levelMessage(rule: Rule, fav: Fav, v: Value): Msg {
  return { title: `${fav.name}：${levelOf(v.ratio).title}`, body: `${condText(fav, v)}${NOT_FORECAST}`, tag: `eqrisk-${rule.id}` };
}

export function probMessage(rule: Rule, fav: Fav, v: Value): Msg {
  return { title: `${fav.name}：機率達到 ${pct(rule.threshold)}`, body: `${condText(fav, v)}${NOT_FORECAST}`, tag: `eqrisk-${rule.id}` };
}

export function quakeMessage(rule: Rule, fav: Fav, events: RecentEvent[]): Msg {
  const e = events[0];
  const where = fav.kind === "place" && fav.place
    ? `，距「${placeShort(fav.place)}」${distText(haversineKm(fav.place.lat, fav.place.lon, e.lat, e.lon) * 1000)}`
    : "";
  const more = events.length > 1 ? `另有 ${events.length - 1} 筆。` : "";
  return {
    title: `${fav.name}附近有新的地震報告`,
    body: `ML ${e.ml.toFixed(1)}，${twTime(e.time)}${where}。${more}${QUAKE_NOTE}`,
    tag: `eqrisk-${rule.id}`,
  };
}

/** 規則的一句話描述（設定畫面用） */
export function ruleText(rule: Rule, fav: Fav | undefined): string {
  const where = fav ? `「${fav.name}」` : "（情境已刪除）";
  if (rule.kind === "level") return `${where}的倍數達到 ${rule.threshold} 倍以上（${levelOf(rule.threshold).title}）`;
  if (rule.kind === "prob") {
    const extra = rule.minRatio > 0 ? `，且倍數達到 ${rule.minRatio} 倍以上` : "";
    return `${where}的機率達到 ${pct(rule.threshold)}${extra}`;
  }
  return `${where}範圍內出現 ML ${rule.threshold} 以上的新地震報告`;
}
