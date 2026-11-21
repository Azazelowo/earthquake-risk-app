// 通知規則：使用者設定「某個收藏情境達到什麼門檻，就通知我」。只存在這支手機（localStorage），不上傳。
//
// 為什麼規則掛在「我的情境」（favs.ts）上而不是自己存一份地點：
//   - 情境已經有地點、半徑、時間長度、規模，而且存的時候已經降低位置精度；規則再存一份座標只會多一個洩漏位置的地方。
//   - 刪掉情境時，掛在它上面的規則自然失效（evaluate 回報 no-fav），畫面上提示使用者清掉。
//
// 三種規則（每種都只在「資料更新後、APP 開著」時評估；沒有伺服器，見 docs/NOTIFY.md）：
//   level  狀態等級：倍數（模型 ÷ 平常）達到 1.5／3／10 之一（和首頁狀態的門檻同一組，LEVEL_EDGES）。
//   prob   機率：這個情境的機率 ≥ 使用者設的值，可選「且倍數 ≥ R」。
//   quake  附近新地震：feed 的「近期地震」出現震央在情境範圍內、規模 ≥ 門檻的新事件。這是地震報告，不是預警。
import { LEVEL_EDGES } from "../format";

export type RuleKind = "level" | "prob" | "quake";

export interface Rule {
  id: string;
  favId: string;
  kind: RuleKind;
  enabled: boolean;
  /** level：倍數門檻（LEVEL_EDGES 之一）；prob：機率 0.0001–0.9；quake：規模 ML 3–8 */
  threshold: number;
  /** prob 規則可選的「且倍數 ≥」；0＝不限 */
  minRatio: number;
  createdAt: number;
}

export interface RuleState {
  /** 這條規則上一次評估時是否「已達門檻」（含回彈區間，見 engine.decide） */
  met: boolean;
  /** 最近一次送出通知的時間（毫秒） */
  firedAt: number | null;
  /** quake：已經處理過的事件（時間|緯度|經度|規模），避免重複通知 */
  seen: string[];
  /** 第一次評估已經做過（建立當下已符合的條件、舊事件，不會立刻通知） */
  primed: boolean;
}

export type NotifyState = Record<string, RuleState>;

export const RULES_KEY = "eqrisk.notify.rules.v1";
export const STATE_KEY = "eqrisk.notify.state.v1";
export const RULE_MAX = 12;
export const SEEN_MAX = 100;
/** 同一條規則兩次通知至少間隔多久（小時）。quake 規則不套用：每個新事件本來就不同 */
export const COOLDOWN_H = 6;
/** 回彈區間：達標之後要降到門檻的這個比例以下，才算回到「未達標」，之後再升上來才會再通知（避免在門檻上下抖動一直通知） */
export const REARM = 0.85;
/** quake 規則只看這段時間內發生的事件（小時）：很久沒開 APP 時不要一次通知一堆舊地震 */
export const QUAKE_MAX_AGE_H = 24;
/** 資料發布時間超過這麼久，不通知（用過期的資料說「現在」是誤導） */
export const MAX_FEED_AGE_H = 2;

export const PROB_MIN = 0.0001, PROB_MAX = 0.9;
export const QUAKE_ML_MIN = 3, QUAKE_ML_MAX = 8;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const KIND_LABEL: Record<RuleKind, string> = {
  level: "狀態升到某個等級",
  prob: "機率達到某個值",
  quake: "附近有新的地震報告",
};

/** 這個門檻對這種規則合不合理 */
export function validThreshold(kind: RuleKind, v: number): boolean {
  if (!num(v)) return false;
  if (kind === "level") return LEVEL_EDGES.some((e) => Math.abs(e - v) < 1e-9);
  if (kind === "prob") return v >= PROB_MIN && v <= PROB_MAX;
  return v >= QUAKE_ML_MIN && v <= QUAKE_ML_MAX;
}

/** 讀回來的資料逐筆檢查（可能被改過或是舊格式），看不懂的整筆丟掉；最多 RULE_MAX 筆 */
export function sanitizeRules(raw: unknown): Rule[] {
  if (!Array.isArray(raw)) return [];
  const out: Rule[] = [];
  for (const x of raw) {
    if (out.length >= RULE_MAX) break;
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const kind = r.kind;
    if (kind !== "level" && kind !== "prob" && kind !== "quake") continue;
    if (typeof r.id !== "string" || typeof r.favId !== "string" || !r.id || !r.favId) continue;
    if (!validThreshold(kind, r.threshold as number)) continue;
    const minRatio = num(r.minRatio) && r.minRatio >= 0 && r.minRatio <= 1000 ? r.minRatio : 0;
    out.push({
      id: r.id.slice(0, 40),
      favId: r.favId.slice(0, 40),
      kind,
      enabled: r.enabled !== false,
      threshold: r.threshold as number,
      minRatio: kind === "prob" ? minRatio : 0,
      createdAt: num(r.createdAt) ? r.createdAt : 0,
    });
  }
  return out;
}

export function sanitizeState(raw: unknown): NotifyState {
  const out: NotifyState = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const s = v as Record<string, unknown>;
    out[id.slice(0, 40)] = {
      met: s.met === true,
      firedAt: num(s.firedAt) ? s.firedAt : null,
      seen: Array.isArray(s.seen) ? s.seen.filter((k): k is string => typeof k === "string").slice(-SEEN_MAX) : [],
      primed: s.primed === true,
    };
  }
  return out;
}

type Store = Pick<Storage, "getItem" | "setItem">;
const defaultStore = (): Store | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

export function loadRules(store: Store | null = defaultStore()): Rule[] {
  try {
    return sanitizeRules(JSON.parse(store?.getItem(RULES_KEY) || "[]"));
  } catch {
    return [];
  }
}

/** 存不了（無痕模式、空間滿了）回傳 false，畫面要告訴使用者 */
export function storeRules(list: Rule[], store: Store | null = defaultStore()): boolean {
  try {
    store!.setItem(RULES_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function loadState(store: Store | null = defaultStore()): NotifyState {
  try {
    return sanitizeState(JSON.parse(store?.getItem(STATE_KEY) || "{}"));
  } catch {
    return {};
  }
}

export function storeState(state: NotifyState, store: Store | null = defaultStore()): boolean {
  try {
    store!.setItem(STATE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function makeRule(favId: string, kind: RuleKind, threshold: number, minRatio = 0, now = Date.now(), id = newId()): Rule | null {
  if (!favId || !validThreshold(kind, threshold)) return null;
  return { id, favId, kind, enabled: true, threshold, minRatio: kind === "prob" && minRatio > 0 ? minRatio : 0, createdAt: now };
}

/** 同一個情境、同一種規則、同一個門檻只留一條（重複新增就換掉舊的）；滿了回傳 null */
export function upsertRule(list: Rule[], rule: Rule): Rule[] | null {
  const i = list.findIndex((r) => r.favId === rule.favId && r.kind === rule.kind && r.threshold === rule.threshold && r.minRatio === rule.minRatio);
  if (i >= 0) return list.map((r, j) => (j === i ? { ...rule, id: r.id, createdAt: r.createdAt } : r));
  if (list.length >= RULE_MAX) return null;
  return [...list, rule];
}

export const removeRule = (list: Rule[], id: string): Rule[] => list.filter((r) => r.id !== id);

/** 刪掉規則時一併清掉它的狀態；刪掉情境時，掛在它上面的規則也清掉 */
export function pruneForFavs(rules: Rule[], favIds: Set<string>): Rule[] {
  return rules.filter((r) => favIds.has(r.favId));
}

export function pruneState(state: NotifyState, rules: Rule[]): NotifyState {
  const keep = new Set(rules.map((r) => r.id));
  return Object.fromEntries(Object.entries(state).filter(([id]) => keep.has(id)));
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
