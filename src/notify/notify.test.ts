// 通知規則引擎：儲存與檢查、邊緣觸發與回彈、cooldown、資料不可靠時不通知、新地震去重、文案。全部不碰瀏覽器。
import { describe, expect, it } from "vitest";
import { assessPoint } from "../core/hazard";
import type { Feed, RecentEvent } from "../data/schema";
import { makeMockFeed } from "../data/mock";
import type { Fav } from "../favs";
import { LEVEL_EDGES } from "../format";
import { renderNotifyCard } from "../ui/notify";
import { inAppBrowserUA } from "./platform";
import { decide, eventKey, evaluateRule, runNotify, type Evaluation } from "./engine";
import { levelMessage, probMessage, quakeMessage, QUAKE_NOTE, NOT_FORECAST, ratioLabel, ruleText, type Msg } from "./message";
import {
  COOLDOWN_H, QUAKE_MAX_AGE_H, REARM, RULE_MAX, STATE_KEY, RULES_KEY,
  loadRules, loadState, makeRule, pruneForFavs, pruneState, removeRule, sanitizeRules, sanitizeState, storeRules, storeState,
  upsertRule, validThreshold, type NotifyState, type Rule,
} from "./rules";

const H = 36e5;
const NOW = Date.parse("2026-11-21T04:00:00Z");

const FAV: Fav = {
  id: "f1", name: "高雄住家", kind: "place",
  place: { lat: 22.63, lon: 120.3, label: "高雄市", source: "county" },
  cond: { radiusKm: 50, T: 3, m: 5 },
};
const FAV_ALL: Fav = { id: "f2", name: "全台 M5+", kind: "all", cond: { radiusKm: 50, T: 3, m: 5 } };
const FAV_FAR: Fav = { ...FAV, id: "f3", name: "海外", place: { lat: 10, lon: 100, label: "海外", source: "map" } };

/** 真資料的樣子（不是 mock、剛發布）；n_full 乘上 k 倍，就能控制倍數 */
function feedWith(k = 1, extra: RecentEvent[] = [], issuedAt = NOW - 10 * 60e3): Feed {
  const f = structuredClone(makeMockFeed(new Date(NOW)));
  f.mock = false;
  f.issued_at = new Date(issuedAt).toISOString();
  f.n_full = f.n_full.map((row) => row.map((v) => v * k));
  f.recent = extra;
  return f;
}

/** 調整 n_full，使 FAV 的倍數約等於 target（機率不是線性，所以迭代幾次） */
function feedWithRatio(target: number, extra: RecentEvent[] = []): Feed {
  let k = target;
  let f = feedWith(k, extra);
  for (let i = 0; i < 12; i++) {
    const a = assessPoint(f, FAV.place!.lat, FAV.place!.lon, FAV.cond.radiusKm, FAV.cond.m, FAV.cond.T);
    k *= target / a.ratio;
    f = feedWith(k, extra);
  }
  return f;
}

const ratioOf = (f: Feed) => assessPoint(f, FAV.place!.lat, FAV.place!.lon, 50, 5, 3).ratio;
const rule = (kind: Rule["kind"], threshold: number, extra: Partial<Rule> = {}): Rule => ({
  id: "r1", favId: FAV.id, kind, enabled: true, threshold, minRatio: 0, createdAt: 0, ...extra,
});
const quake = (minutesAgo: number, ml = 5.2, lat = 22.7, lon = 120.4): RecentEvent => ({
  time: new Date(NOW - minutesAgo * 60e3).toISOString(), lat, lon, depth_km: 12, ml, source: "CWA",
});

describe("儲存與檢查", () => {
  it("門檻要合理：等級只能是首頁那三個倍數，機率與規模有範圍", () => {
    for (const e of LEVEL_EDGES) expect(validThreshold("level", e)).toBe(true);
    expect(validThreshold("level", 2)).toBe(false);
    expect(validThreshold("prob", 0.05)).toBe(true);
    expect(validThreshold("prob", 0)).toBe(false);
    expect(validThreshold("prob", 0.95)).toBe(false);
    expect(validThreshold("quake", 5)).toBe(true);
    expect(validThreshold("quake", 2.9)).toBe(false);
    expect(validThreshold("quake", NaN)).toBe(false);
  });

  it("讀回來的資料逐筆檢查，壞掉的整筆丟掉，最多 12 條", () => {
    const good = rule("prob", 0.05, { minRatio: 3 });
    const list = sanitizeRules([
      good, null, "x", { ...good, id: "" }, { ...good, kind: "weird" }, { ...good, id: "b", threshold: 9 },
      { ...rule("level", 3), id: "c", minRatio: 5 },
    ]);
    expect(list.map((r) => r.id)).toEqual(["r1", "c"]);
    expect(list[1].minRatio).toBe(0); // 只有機率規則才有「且倍數」
    expect(sanitizeRules("壞掉")).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => ({ ...good, id: `r${i}` }));
    expect(sanitizeRules(many)).toHaveLength(RULE_MAX);
  });

  it("狀態檢查：seen 只留字串、最多 100 筆", () => {
    const st = sanitizeState({ a: { met: true, firedAt: 5, seen: ["x", 3, "y"], primed: true }, b: 7, c: { met: "yes" } });
    expect(st.a).toEqual({ met: true, firedAt: 5, seen: ["x", "y"], primed: true });
    expect(st.b).toBeUndefined();
    expect(st.c).toEqual({ met: false, firedAt: null, seen: [], primed: false });
    const long = sanitizeState({ a: { seen: Array.from({ length: 300 }, (_, i) => `k${i}`) } });
    expect(long.a.seen).toHaveLength(100);
    expect(long.a.seen[99]).toBe("k299");
  });

  it("存取來回一致；存不了時回傳 false 而不是丟例外", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const r = rule("level", 3);
    expect(storeRules([r], store)).toBe(true);
    expect(loadRules(store)).toEqual([r]);
    const st: NotifyState = { r1: { met: true, firedAt: 1, seen: ["a"], primed: true } };
    expect(storeState(st, store)).toBe(true);
    expect(loadState(store)).toEqual(st);
    mem.set(RULES_KEY, "{壞掉");
    mem.set(STATE_KEY, "{壞掉");
    expect(loadRules(store)).toEqual([]);
    expect(loadState(store)).toEqual({});
    const full = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(storeRules([r], full)).toBe(false);
    expect(storeState(st, full)).toBe(false);
    expect(loadRules(null)).toEqual([]);
  });

  it("新增、取代、刪除、情境刪除後清掉規則與狀態", () => {
    const a = makeRule("f1", "level", 3, 0, 1, "a")!;
    expect(makeRule("", "level", 3)).toBeNull();
    expect(makeRule("f1", "level", 2)).toBeNull();
    let list = upsertRule([], a)!;
    list = upsertRule(list, { ...a, id: "z", enabled: false })!; // 同情境同種同門檻：換掉，id 與建立時間沿用
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "a", enabled: false, createdAt: 1 });
    const b = makeRule("f2", "quake", 5, 0, 2, "b")!;
    list = upsertRule(list, b)!;
    expect(pruneForFavs(list, new Set(["f2"])).map((r) => r.id)).toEqual(["b"]);
    expect(Object.keys(pruneState({ a: { met: true, firedAt: null, seen: [], primed: true }, b: { met: false, firedAt: null, seen: [], primed: true } }, removeRule(list, "a")))).toEqual(["b"]);
    const full = Array.from({ length: RULE_MAX }, (_, i) => makeRule("f1", "prob", 0.01 + i / 1000, 0, 0, `p${i}`)!);
    expect(upsertRule(full, makeRule("f2", "level", 3)!)).toBeNull();
  });
});

describe("評估：什麼時候不通知", () => {
  const lv = rule("level", 3);
  it("假資料、過期資料、情境已刪除、位置在模型外：都不通知，而且講得出原因", () => {
    const mock = structuredClone(feedWith()); mock.mock = true;
    expect(evaluateRule(lv, FAV, mock, NOW)).toEqual({ status: "blocked", reason: "mock" });
    expect(evaluateRule(lv, FAV, feedWith(1, [], NOW - 3 * H), NOW)).toEqual({ status: "blocked", reason: "stale" });
    expect(evaluateRule(lv, undefined, feedWith(), NOW)).toEqual({ status: "blocked", reason: "no-fav" });
    expect(evaluateRule(lv, FAV_FAR, feedWith(), NOW)).toEqual({ status: "blocked", reason: "uncovered" });
  });

  it("blocked 時狀態不動：不通知，資料恢復後也不會因為『看起來剛達標』誤通知", () => {
    const prev = { met: false, firedAt: null, seen: [], primed: true };
    const d = decide(lv, FAV, { status: "blocked", reason: "stale" }, prev, NOW);
    expect(d.fire).toBeNull();
    expect(d.next).toBe(prev);
  });

  it("倍數小於 1（比平常安靜）不會觸發任何等級或機率規則", () => {
    const quiet = feedWithRatio(0.5);
    expect(ratioOf(quiet)).toBeCloseTo(0.5, 2);
    for (const r of [rule("level", 1.5), rule("prob", 0.0001)]) {
      const ev = evaluateRule(r, FAV, quiet, NOW);
      expect(ev.status === "ok" && ev.kind === "value" && ev.metNow).toBe(r.kind === "prob"); // 機率門檻極低時只看機率
    }
    const ev = evaluateRule(rule("level", 1.5), FAV, quiet, NOW);
    expect(ev).toMatchObject({ status: "ok", metNow: false, holding: false });
  });
});

describe("等級與機率規則：邊緣觸發", () => {
  const lv = rule("level", 3);
  const evalAt = (ratio: number) => evaluateRule(lv, FAV, feedWithRatio(ratio), NOW);
  const prime = decide(lv, FAV, evalAt(1), undefined, NOW).next;

  it("第一次評估只記下現況：建立當下已經達標不會馬上通知", () => {
    const d = decide(lv, FAV, evalAt(5), undefined, NOW);
    expect(d.fire).toBeNull();
    expect(d.next).toMatchObject({ met: true, primed: true });
  });

  it("從未達標升到達標：通知一次；之後持續達標不再通知", () => {
    const up = decide(lv, FAV, evalAt(4), prime, NOW);
    expect(up.fire).not.toBeNull();
    expect(up.next).toMatchObject({ met: true, firedAt: NOW });
    const again = decide(lv, FAV, evalAt(6), up.next, NOW + H);
    expect(again.fire).toBeNull();
    expect(again.next.met).toBe(true);
  });

  it("回彈區間：只掉到門檻的 85% 以上不算回到未達標；掉到 85% 以下才會重新武裝", () => {
    const fired = decide(lv, FAV, evalAt(4), prime, NOW).next;
    const dip = decide(lv, FAV, evalAt(3 * (REARM + 0.05)), fired, NOW + 12 * H);
    expect(dip.next.met).toBe(true);
    expect(decide(lv, FAV, evalAt(4), dip.next, NOW + 13 * H).fire).toBeNull(); // 沒有真的掉下去，再升上來也不通知
    const low = decide(lv, FAV, evalAt(3 * (REARM - 0.1)), fired, NOW + 12 * H);
    expect(low.next.met).toBe(false);
    expect(decide(lv, FAV, evalAt(4), low.next, NOW + 13 * H).fire).not.toBeNull(); // 真的回去再升上來：再通知
  });

  it(`cooldown：${COOLDOWN_H} 小時內再次升上來不通知；超過才通知`, () => {
    const fired = decide(lv, FAV, evalAt(4), prime, NOW).next;
    const low = decide(lv, FAV, evalAt(1), fired, NOW + 1 * H).next;
    const early = decide(lv, FAV, evalAt(4), low, NOW + 2 * H);
    expect(early.fire).toBeNull();
    const late = decide(lv, FAV, evalAt(4), { ...low, met: false }, NOW + (COOLDOWN_H + 1) * H);
    expect(late.fire).not.toBeNull();
  });

  it("機率規則：機率達標；可加『且倍數至少』", () => {
    const f = feedWithRatio(4);
    const a = assessPoint(f, FAV.place!.lat, FAV.place!.lon, 50, 5, 3);
    const lowP = rule("prob", a.p / 2), highP = rule("prob", a.p * 2);
    expect(evaluateRule(lowP, FAV, f, NOW)).toMatchObject({ metNow: true });
    expect(evaluateRule(highP, FAV, f, NOW)).toMatchObject({ metNow: false });
    expect(evaluateRule({ ...lowP, minRatio: 3 }, FAV, f, NOW)).toMatchObject({ metNow: true });
    expect(evaluateRule({ ...lowP, minRatio: 8 }, FAV, f, NOW)).toMatchObject({ metNow: false });
  });

  it("全台情境也能評估（範圍是整個模型網格）", () => {
    const ev = evaluateRule(rule("level", 1.5, { favId: FAV_ALL.id }), FAV_ALL, feedWith(), NOW);
    expect(ev.status).toBe("ok");
  });
});

describe("附近新地震報告", () => {
  const q = rule("quake", 5);
  const run = (feed: Feed, prev: ReturnType<typeof decide>["next"] | undefined, now = NOW) =>
    decide(q, FAV, evaluateRule(q, FAV, feed, now), prev, now);

  it("第一次評估只記下現有的事件，不通知", () => {
    const d = run(feedWith(1, [quake(30)]), undefined);
    expect(d.fire).toBeNull();
    expect(d.next.seen).toEqual([eventKey(quake(30))]);
  });

  it("之後出現新事件才通知一次；同一個事件不重複", () => {
    const first = run(feedWith(1, [quake(300)]), undefined).next;
    const withNew = feedWith(1, [quake(300), quake(5, 5.8)]);
    const d = run(withNew, first);
    expect(d.fire?.msg.body).toContain("ML 5.8");
    expect(run(withNew, d.next).fire).toBeNull();
  });

  it("規模、範圍、時間都要符合：低於門檻、半徑外、超過 24 小時的不算（規模含等號）", () => {
    const first = run(feedWith(), undefined).next;
    const noise = feedWith(1, [
      quake(5, 4.9),
      quake(5, 6, 24.5, 121.5),
      quake(QUAKE_MAX_AGE_H * 60 + 5, 6),
    ]);
    expect(run(noise, first).fire).toBeNull();
    expect(run(feedWith(1, [quake(5, 5.0)]), first).fire).not.toBeNull();
  });

  it("全台情境：任何位置的新地震都算", () => {
    const qa = rule("quake", 5, { favId: FAV_ALL.id });
    const first = decide(qa, FAV_ALL, evaluateRule(qa, FAV_ALL, feedWith(), NOW), undefined, NOW).next;
    const ev = evaluateRule(qa, FAV_ALL, feedWith(1, [quake(5, 6, 24.5, 121.5)]), NOW);
    expect(decide(qa, FAV_ALL, ev, first, NOW).fire).not.toBeNull();
  });

  it("資料不可靠時（過期）不通知也不標記為已看過", () => {
    const first = run(feedWith(), undefined).next;
    const stale = feedWith(1, [quake(5)], NOW - 3 * H);
    const d = run(stale, first);
    expect(d.fire).toBeNull();
    expect(d.next).toBe(first);
  });
});

describe("runNotify", () => {
  const shown: Msg[] = [];
  const ok = async (m: Msg) => (shown.push(m), true);

  it("端到端：先記下現況，資料變化後通知一次，再更新不重複", async () => {
    shown.length = 0;
    const r = rule("level", 3);
    let st: NotifyState = {};
    st = (await runNotify(feedWithRatio(1), [FAV], [r], st, { now: NOW, show: ok })).state;
    expect(shown).toHaveLength(0);
    const hit = await runNotify(feedWithRatio(5), [FAV], [r], st, { now: NOW + 15 * 60e3, show: ok });
    expect(shown).toHaveLength(1);
    expect(hit.reports[0].fired).toBe(true);
    await runNotify(feedWithRatio(5), [FAV], [r], hit.state, { now: NOW + 30 * 60e3, show: ok });
    expect(shown).toHaveLength(1);
  });

  it("想通知卻送不出去（沒有權限／丟例外）：不算通知過，下次還能通知", async () => {
    const r = rule("level", 3);
    const base = (await runNotify(feedWithRatio(1), [FAV], [r], {}, { now: NOW, show: ok })).state;
    const denied = await runNotify(feedWithRatio(5), [FAV], [r], base, { now: NOW + 60e3, show: async () => false });
    expect(denied.reports[0]).toMatchObject({ fired: false, failed: true });
    expect(denied.state.r1).toMatchObject({ met: false, firedAt: null, primed: true });
    shown.length = 0;
    await runNotify(feedWithRatio(5), [FAV], [r], denied.state, { now: NOW + 2 * 60e3, show: ok });
    expect(shown).toHaveLength(1);
    const boom = await runNotify(feedWithRatio(5), [FAV], [r], base, { now: NOW + 60e3, show: async () => { throw new Error("x"); } });
    expect(boom.reports[0].failed).toBe(true);
  });

  it("停用的規則不通知、情境已刪除的規則不通知", async () => {
    shown.length = 0;
    const base: NotifyState = { r1: { met: false, firedAt: null, seen: [], primed: true } };
    await runNotify(feedWithRatio(5), [FAV], [rule("level", 3, { enabled: false })], base, { now: NOW, show: ok });
    await runNotify(feedWithRatio(5), [], [rule("level", 3)], base, { now: NOW, show: ok });
    expect(shown).toHaveLength(0);
  });
});

describe("文案", () => {
  const v = { p: 0.062, pBg: 0.012, ratio: 5.2 };
  const msgs: Msg[] = [
    levelMessage(rule("level", 3), FAV, v),
    probMessage(rule("prob", 0.05), FAV, v),
    quakeMessage(rule("quake", 5), FAV, [quake(5, 5.8), quake(9, 5.1)]),
    quakeMessage(rule("quake", 5), FAV_ALL, [quake(5, 5.8)]),
  ];

  it("每一則都看得出不是預報／預警，也不說『安全』『保證』『即將』", () => {
    for (const m of msgs) {
      expect(m.body).toMatch(/不是/);
      expect(m.title + m.body).not.toMatch(/安全|保證|即將|一定會|預言|預測/);
    }
    expect(msgs[0].body).toContain(NOT_FORECAST);
    expect(msgs[2].body).toContain(QUAKE_NOTE);
  });

  it("機率一定附『平常』當對照，並說明倍數；同一條規則共用 tag（新的取代舊的）", () => {
    expect(msgs[0].body).toMatch(/機率 6\.2%.*平常約 1\.2%/);
    expect(msgs[0].body).toContain("5.2 倍");
    expect(msgs[0].tag).toBe(msgs[1].tag);
    expect(msgs[2].body).toContain("另有 1 筆");
  });

  it("倍數小於 1 時顯示實際的倍數（首頁的 ratioText 會寫成『約 1 倍』），並說明那不是比較安全", () => {
    expect(ratioLabel(0.46)).toBe("約 0.5 倍，比近兩年平均安靜");
    expect(ratioLabel(0.05)).toContain("0.05");
    expect(ratioLabel(1)).toBe("約 1 倍");
    expect(ratioLabel(5.2)).toBe("約 5.2 倍");
    expect(ratioLabel(NaN)).toBe("—");
    expect(ratioLabel(0.46)).not.toMatch(/安全/);
  });

  it("規則的描述句", () => {
    expect(ruleText(rule("level", 3), FAV)).toContain("高雄住家");
    expect(ruleText(rule("prob", 0.05, { minRatio: 3 }), FAV)).toContain("且倍數達到 3 倍");
    expect(ruleText(rule("quake", 5), undefined)).toContain("情境已刪除");
  });
});

describe("設定畫面", () => {
  const view = (favs: Fav[], rules: Rule[], supported = true) => ({
    favs, rules, reports: {}, message: "", permMessage: "", diag: "權限＝default",
    support: { supported, permission: "default" as const, ios: false, standalone: false, needsInstall: false },
  });

  it("使用者輸入的情境名稱要跳脫", () => {
    const evil: Fav = { ...FAV, name: `<img src=x onerror=alert(1)>` };
    const html = renderNotifyCard(view([evil], [rule("level", 3)]));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("一定寫明不是預警、APP 關閉不會通知；沒有情境時不顯示表單；不支援時說明", () => {
    const html = renderNotifyCard(view([], []));
    expect(html).toContain("這不是地震預警");
    expect(html).toContain("APP 完全關閉就不會通知");
    expect(html).not.toContain('data-act="nt-add"');
    expect(renderNotifyCard(view([FAV], [], false))).toContain("不支援網頁通知");
    expect(renderNotifyCard(view([FAV], []))).toContain('data-act="nt-add"');
  });

  it("沒有點選處理的 iPhone 要先加入主畫面", () => {
    const html = renderNotifyCard({ ...view([FAV], []), support: { supported: true, permission: "default", ios: true, standalone: false, needsInstall: true } });
    expect(html).toContain("加入主畫面");
    expect(html).not.toContain('data-act="nt-allow"');
  });
});

describe("允許通知的回饋", () => {
  const view = (permMessage: string) => ({
    favs: [FAV], rules: [], reports: {}, message: "", permMessage, diag: "權限＝default，支援＝是",
    support: { supported: true, permission: "default" as const, ios: false, standalone: false, needsInstall: false },
  });

  it("結果提示緊接在按鈕後面，並且要跳脫", () => {
    const html = renderNotifyCard(view("<b>x</b>已送出要求"));
    expect(html.indexOf("nt-allow")).toBeLessThan(html.indexOf("已送出要求"));
    expect(html).toContain("&lt;b&gt;x");
    expect(html).not.toContain("<b>x</b>");
  });

  it("畫面上永遠有一行診斷可以貼出來回報", () => {
    expect(renderNotifyCard(view(""))).toContain("權限＝default，支援＝是");
  });

  it("辨認常見的 App 內建瀏覽器", () => {
    expect(inAppBrowserUA("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36")).toBe(false);
    expect(inAppBrowserUA("Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36 Line/14.0")).toBe(true);
    expect(inAppBrowserUA("Mozilla/5.0 (iPhone) AppleWebKit/605 [FBAN/FBIOS;FBAV/450]")).toBe(true);
  });
});

describe("Evaluation 型別守衛", () => {
  it("evaluateRule 的 ok 結果分成 value 與 events 兩種", () => {
    const a: Evaluation = evaluateRule(rule("level", 3), FAV, feedWith(), NOW);
    const b: Evaluation = evaluateRule(rule("quake", 5), FAV, feedWith(), NOW);
    expect(a.status === "ok" && a.kind).toBe("value");
    expect(b.status === "ok" && b.kind).toBe("events");
  });
});
