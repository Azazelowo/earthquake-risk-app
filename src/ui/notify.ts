// ⓘ 頁的「通知」設定：建立規則（掛在「我的情境」上）、看每條規則現在的狀況、允許通知。
// 這個檔案只產生 HTML；點擊事件在 main.ts 處理（data-act="nt-*"）。名稱等使用者輸入的文字一律跳脫。
import { LEVEL_EDGES, levelOf, pct } from "../format";
import { esc } from "../format";
import type { Fav } from "../favs";
import { BLOCK_TEXT, type RuleReport } from "../notify/engine";
import { ratioLabel, ruleText, scopeText } from "../notify/message";
import { PERMISSION_TEXT, type Support } from "../notify/platform";
import { COOLDOWN_H, KIND_LABEL, MAX_FEED_AGE_H, QUAKE_MAX_AGE_H, REARM, RULE_MAX, type Rule, type RuleKind } from "../notify/rules";

export interface NotifyView {
  favs: Fav[];
  rules: Rule[];
  reports: Record<string, RuleReport>;
  support: Support;
  /** 操作結果的提示（新增、刪除、測試通知…） */
  message: string;
  /** 「允許通知」的結果提示（顯示在按鈕下方） */
  permMessage: string;
  /** 一行診斷（權限、模式…），回報「沒反應」時用 */
  diag: string;
}

function permissionBlock(sp: Support, permMessage: string): string {
  if (!sp.supported) return `<p class="note"><b>${PERMISSION_TEXT.unsupported}</b>規則還是可以建立，但不會跳出通知。</p>`;
  if (sp.needsInstall)
    return `<p class="note">iPhone／iPad 要先<b>加入主畫面並從主畫面開啟</b>，才能要求通知權限（Apple 的官方說明，iOS／iPadOS 16.4 起）。請看上面的「安裝與更新」。</p>`;
  const btn = sp.permission === "default"
    ? `<button class="btn primary" data-act="nt-allow">允許通知</button>`
    : sp.permission === "granted"
      ? `<button class="btn" data-act="nt-test">送一則測試通知</button>`
      : "";
  const msg = permMessage ? `<p class="note" role="status">${esc(permMessage)}</p>` : "";
  return `<p class="muted small" role="status">${PERMISSION_TEXT[sp.permission]}</p>${btn ? `<div class="row">${btn}</div>` : ""}${msg}`;
}

function reportLine(r: RuleReport | undefined): string {
  if (!r) return "";
  const ev = r.evaluation;
  if (!r.rule.enabled) return `<span class="muted small">已停用</span>`;
  if (ev.status === "blocked") return `<span class="muted small">${esc(BLOCK_TEXT[ev.reason])}</span>`;
  if (ev.kind === "events")
    return `<span class="muted small">目前範圍內符合條件的近期地震報告：${ev.events.length} 筆（新出現的才會通知）。</span>`;
  const v = ev.value, lv = levelOf(v.ratio).title;
  return `<span class="muted small">現在：機率 ${pct(v.p)}，平常 ${pct(v.pBg)}（${esc(ratioLabel(v.ratio))}${v.ratio >= 0.95 ? `，${esc(lv)}` : ""}）。${ev.metNow ? "已達門檻。" : "還沒達門檻。"}</span>`;
}

function ruleRows(v: NotifyView): string {
  if (!v.rules.length) return `<p class="muted small">還沒有規則。先到首頁把常看的地點與條件「存成情境」，再回來這裡設定。</p>`;
  return `<ul class="notes plain">${v.rules
    .map((r) => {
      const fav = v.favs.find((f) => f.id === r.favId);
      return `<li>${esc(ruleText(r, fav))}${fav ? `（${esc(scopeText(fav))}）` : ""}<br>${reportLine(v.reports[r.id])}
      <span class="row"><button class="btn" data-nt-toggle="${esc(r.id)}">${r.enabled ? "停用" : "啟用"}</button>
      <button class="btn" data-nt-del="${esc(r.id)}">刪除</button></span></li>`;
    })
    .join("")}</ul>`;
}

function form(v: NotifyView): string {
  if (!v.favs.length) return "";
  const favOpts = v.favs.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("");
  const kindOpts = (Object.keys(KIND_LABEL) as RuleKind[]).map((k) => `<option value="${k}">${KIND_LABEL[k]}</option>`).join("");
  // 預設 3 倍：依回測，首頁預設條件下 ≥1.5 倍約占 8.3% 的天數（每縣市每年約 30 天），≥3 倍約 0.8%（約 3 天），1.5 倍當通知太吵
  const lvOpts = LEVEL_EDGES.map((e) => `<option value="${e}"${e === 3 ? " selected" : ""}>${e} 倍以上：${esc(levelOf(e).title)}</option>`).join("");
  return `
  <div class="field"><label for="nt-fav">情境</label><select class="inp" id="nt-fav">${favOpts}</select></div>
  <div class="field"><label for="nt-kind">什麼時候通知</label><select class="inp" id="nt-kind">${kindOpts}</select></div>
  <div class="field"><label for="nt-level">「狀態升到某個等級」用：倍數門檻</label><select class="inp" id="nt-level">${lvOpts}</select></div>
  <div class="field"><label for="nt-prob">「機率達到某個值」用：機率（%）</label><input class="inp" id="nt-prob" type="number" inputmode="decimal" min="0.01" max="90" step="any" value="5"></div>
  <div class="field"><label for="nt-ratio">同上，且倍數至少（選填，空白＝不限）</label><input class="inp" id="nt-ratio" type="number" inputmode="decimal" min="1" step="any" placeholder="例：3"></div>
  <div class="field"><label for="nt-ml">「附近有新的地震報告」用：規模 ML 至少</label><input class="inp" id="nt-ml" type="number" inputmode="decimal" min="3" max="8" step="0.1" value="5"></div>
  <div class="row"><button class="btn primary" data-act="nt-add">新增規則</button></div>`;
}

export const NOTIFY_INPUT_IDS = ["nt-fav", "nt-kind", "nt-level", "nt-prob", "nt-ratio", "nt-ml"];

export function renderNotifyCard(v: NotifyView): string {
  return `
  <section class="card" id="notify">
    <h2>通知</h2>
    <p class="note"><b>這不是地震預警。</b>通知只依「這個 APP 算出的機率」或「資料裡新出現的地震報告」觸發；
    資料每 15 分鐘更新一次、地震報告可能延遲數分鐘到數十分鐘。緊急警報請用氣象署官方 APP。</p>
    <p class="muted small"><b>什麼時候會通知：</b>APP 開著（或在背景還活著）、而且資料更新的時候才會評估。
    APP 完全關閉就不會通知——那需要伺服器推播，目前沒有做。</p>
    ${permissionBlock(v.support, v.permMessage)}
    <h3>我的規則（最多 ${RULE_MAX} 條）</h3>
    ${ruleRows(v)}
    ${v.message ? `<p class="muted small" role="status">${esc(v.message)}</p>` : ""}
    ${form(v)}
    <ul class="notes plain muted small">
      <li>只在「從還沒達到門檻，變成達到門檻」的那一刻通知一次；之後要先回到門檻的 ${Math.round(REARM * 100)}% 以下才會再通知。同一條規則至少相隔 ${COOLDOWN_H} 小時（新地震報告不受限）。</li>
      <li>剛建立規則時，目前已經達標的條件和已經存在的地震報告<b>不會</b>馬上通知，只記下現況。</li>
      <li>資料是示意用假資料、超過 ${MAX_FEED_AGE_H} 小時沒更新、模型沒涵蓋這個位置、或算不出倍數時，不通知。新地震報告只看最近 ${QUAKE_MAX_AGE_H} 小時。</li>
      <li>「倍數」是模型相對「平常」（近兩年平均水準）的比值；低於 1 很常見，只代表現在比平均安靜，<b>不是比較安全</b>，也不會觸發通知。</li>
      <li>規則與位置只存在這支手機，不會上傳。</li>
      <li>通知狀態（回報問題時可以貼這行）：${esc(v.diag)}</li>
    </ul>
  </section>`;
}
