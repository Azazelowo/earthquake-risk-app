// 規則評估與「要不要通知」的決定。全部是純函式（時間、儲存、送出通知都由呼叫端傳進來），所以可以單元測試。
//
// 兩個原則：
//   1. 邊緣觸發：只在「從未達標變成達標」那一刻通知，持續達標不會每次更新都通知；
//      達標後要降到門檻的 REARM（85%）以下才算回到未達標，避免在門檻上下抖動一直通知。
//   2. 寧可不通知，也不要用不可靠的資料通知：假資料、過期資料、模型未涵蓋的位置、算不出倍數，一律不通知（blocked），
//      而且 blocked 時不改變規則的狀態（資料恢復後不會因為「看起來剛達標」而誤通知，也不會漏掉真正的變化）。
import { allWeights, assess, assessPoint, haversineKm } from "../core/hazard";
import type { Feed, RecentEvent } from "../data/schema";
import type { Fav } from "../favs";
import { levelMessage, probMessage, quakeMessage, type Msg, type Value } from "./message";
import {
  COOLDOWN_H, MAX_FEED_AGE_H, QUAKE_MAX_AGE_H, REARM, SEEN_MAX,
  type NotifyState, type Rule, type RuleState,
} from "./rules";

export type BlockReason = "no-fav" | "mock" | "stale" | "uncovered" | "no-ratio";

export const BLOCK_TEXT: Record<BlockReason, string> = {
  "no-fav": "這個情境已經刪除，規則不會運作。",
  mock: "現在是示意用的假資料，不會通知。",
  stale: "資料太久沒更新，不會通知（避免用舊資料說「現在」）。",
  uncovered: "模型沒有涵蓋這個位置，不會通知。",
  "no-ratio": "算不出和平常的倍數，不會通知。",
};

export type Evaluation =
  | { status: "blocked"; reason: BlockReason }
  | { status: "ok"; kind: "value"; metNow: boolean; holding: boolean; value: Value }
  | { status: "ok"; kind: "events"; events: RecentEvent[] };

export const eventKey = (e: RecentEvent) => `${e.time}|${e.lat}|${e.lon}|${e.ml}`;

/** 評估一條規則（不改任何狀態）。設定畫面的「現在會不會觸發」預覽也用這個。 */
export function evaluateRule(rule: Rule, fav: Fav | undefined, feed: Feed, now: number): Evaluation {
  if (!fav) return { status: "blocked", reason: "no-fav" };
  if (feed.mock) return { status: "blocked", reason: "mock" };
  const age = (now - Date.parse(feed.issued_at)) / 36e5;
  if (!(age <= MAX_FEED_AGE_H)) return { status: "blocked", reason: "stale" };

  if (rule.kind === "quake") {
    const cutoff = now - QUAKE_MAX_AGE_H * 36e5;
    const events = feed.recent
      .filter((e) => e.ml >= rule.threshold - 1e-9 && Date.parse(e.time) >= cutoff && Date.parse(e.time) <= now + 5 * 60e3)
      .filter((e) => fav.kind === "all" || !fav.place || haversineKm(fav.place.lat, fav.place.lon, e.lat, e.lon) <= fav.cond.radiusKm)
      .sort((a, b) => b.ml - a.ml || Date.parse(b.time) - Date.parse(a.time));
    return { status: "ok", kind: "events", events };
  }

  const c = fav.cond;
  const a = fav.kind === "all" || !fav.place
    ? (() => {
        const x = assess(feed, allWeights(feed), c.m, c.T);
        return { ...x, covered: x.pBg > 0 };
      })()
    : assessPoint(feed, fav.place.lat, fav.place.lon, c.radiusKm, c.m, c.T);
  if (!a.covered) return { status: "blocked", reason: "uncovered" };
  if (!Number.isFinite(a.ratio)) return { status: "blocked", reason: "no-ratio" };
  const value = { p: a.p, pBg: a.pBg, ratio: a.ratio };
  if (rule.kind === "level") {
    return { status: "ok", kind: "value", value, metNow: a.ratio >= rule.threshold, holding: a.ratio >= rule.threshold * REARM };
  }
  const ratioOk = (k: number) => rule.minRatio <= 0 || a.ratio >= rule.minRatio * k;
  return {
    status: "ok", kind: "value", value,
    metNow: a.p >= rule.threshold && ratioOk(1),
    holding: a.p >= rule.threshold * REARM && ratioOk(REARM),
  };
}

export interface Fire {
  rule: Rule;
  fav: Fav;
  msg: Msg;
  /** quake：這次通知涵蓋的事件 key，送出成功才記進 seen */
  keys?: string[];
}

const blank = (): RuleState => ({ met: false, firedAt: null, seen: [], primed: false });

/**
 * 依評估結果決定要不要通知，並算出新的狀態。
 * - 第一次評估（primed=false）只記下現況，不通知：建立規則當下已經達標、或 feed 裡本來就有的舊地震，不會立刻響。
 * - blocked：不通知、狀態不動。
 */
export function decide(rule: Rule, fav: Fav, ev: Evaluation, prev: RuleState | undefined, now: number): { fire: Fire | null; next: RuleState } {
  const p = prev ?? blank();
  if (ev.status === "blocked") return { fire: null, next: p };

  if (ev.kind === "events") {
    const keys = ev.events.map(eventKey);
    const seen = new Set(p.seen);
    const fresh = ev.events.filter((e) => !seen.has(eventKey(e)));
    const nextSeen = [...p.seen, ...keys.filter((k) => !seen.has(k))].slice(-SEEN_MAX);
    if (!p.primed || !fresh.length) return { fire: null, next: { ...p, primed: true, seen: nextSeen } };
    return {
      fire: { rule, fav, msg: quakeMessage(rule, fav, fresh), keys: fresh.map(eventKey) },
      next: { ...p, primed: true, seen: nextSeen, firedAt: now },
    };
  }

  const was = p.met;
  const met = was ? ev.holding : ev.metNow;
  const coolOk = p.firedAt == null || now - p.firedAt >= COOLDOWN_H * 36e5;
  const base = { ...p, primed: true, met };
  if (!p.primed || was || !met || !coolOk) return { fire: null, next: base };
  const msg = rule.kind === "level" ? levelMessage(rule, fav, ev.value) : probMessage(rule, fav, ev.value);
  return { fire: { rule, fav, msg }, next: { ...base, firedAt: now } };
}

export interface RuleReport {
  rule: Rule;
  evaluation: Evaluation;
  fired: boolean;
  /** 想通知但送不出去（沒有權限等） */
  failed: boolean;
}

export interface RunResult {
  state: NotifyState;
  reports: RuleReport[];
}

export interface Deps {
  now: number;
  /** 送出一則通知；成功回傳 true。沒有權限或失敗回傳 false（這次不算通知過，下次再試） */
  show: (msg: Msg) => Promise<boolean>;
}

/** 評估所有啟用中的規則，送出該送的通知。呼叫端負責讀寫儲存。 */
export async function runNotify(feed: Feed, favs: Fav[], rules: Rule[], state: NotifyState, deps: Deps): Promise<RunResult> {
  const out: NotifyState = { ...state };
  const reports: RuleReport[] = [];
  for (const rule of rules) {
    const fav = favs.find((f) => f.id === rule.favId);
    const evaluation = evaluateRule(rule, fav, feed, deps.now);
    if (!rule.enabled || !fav) {
      reports.push({ rule, evaluation, fired: false, failed: false });
      continue;
    }
    const { fire, next } = decide(rule, fav, evaluation, state[rule.id], deps.now);
    let fired = false, failed = false;
    if (fire) {
      fired = await deps.show(fire.msg).catch(() => false);
      failed = !fired;
    }
    // 想通知卻送不出去：回到通知前的狀態（但記得已經評估過一次），下次權限好了還能通知
    out[rule.id] = failed ? { ...(state[rule.id] ?? { met: false, firedAt: null, seen: [], primed: false }), primed: true } : next;
    reports.push({ rule, evaluation, fired, failed });
  }
  return { state: out, reports };
}
