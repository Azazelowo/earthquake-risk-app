// 大眾版首頁：一個狀態（和平常比的倍數決定顏色）＋絕對機率＋可展開的說明。
import type { State, Cond } from "../state";
import { RADII, TIMES, MAGS, COUNTIES, timeLabel } from "../state";
import { assess, pointWeights, allWeights, reliabilityNotes, undercountAt } from "../core/hazard";
import { levelOf, pct, odds, ratioText, twTime, ago, esc } from "../format";

const ICP_URL = "https://azazelowo.github.io/i-can-predict-quakes/";
const SIM_URL = "https://eq-simulator.exptech.com.tw/";

export function condText(c: Cond) {
  return `周圍 ${c.radiusKm} km・${timeLabel(c.T)}內・M${c.m} 以上`;
}

function scenario(s: State, label: string, c: Partial<Cond>, all = false) {
  const cond = { ...s.cond, ...c };
  const w = all ? allWeights(s.feed) : pointWeights(s.feed, s.place.lat, s.place.lon, cond.radiusKm);
  const a = assess(s.feed, w, cond.m, cond.T);
  const lv = levelOf(a.ratio);
  const desc = all ? `全台網格・${timeLabel(cond.T)}內・M${cond.m} 以上` : condText(cond);
  return `<button class="scard ${lv.key}" data-apply='${JSON.stringify(all ? {} : c)}' ${all ? 'data-goto="#/expert/map"' : ""}>
    <span class="scard-q">${label}</span>
    <span class="scard-p">${pct(a.p)}<small>平常 ${pct(a.pBg)}</small></span>
    <span class="scard-d">${desc}</span>
    <span class="scard-lv">${lv.title}</span>
  </button>`;
}

export function renderPublic(s: State): string {
  const f = s.feed;
  const w = pointWeights(f, s.place.lat, s.place.lon, s.cond.radiusKm);
  const a = assess(f, w, s.cond.m, s.cond.T);
  const lv = levelOf(a.ratio);
  const notes = reliabilityNotes(f, s.cond.m, s.cond.T);
  const under = undercountAt(f, s.cond.T);
  const q = `${s.place.label.replace(/（.*）/, "")}附近 ${timeLabel(s.cond.T)}內會發生規模 ${s.cond.m} 以上的地震`;

  const locLine =
    s.locate === "pending" ? `<span class="muted">定位中…</span>`
    : s.locate === "denied" ? `<span class="warn-text">無法定位，暫用 ${esc(s.place.label)}</span>`
    : esc(s.place.label);

  return `
  <section class="loc-row">
    <button class="loc" data-act="pick-place" aria-label="換位置">
      <svg viewBox="0 0 24 24" class="ico"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>
      <span>${locLine}</span><span class="chev">▾</span>
    </button>
    <button class="cond" data-act="edit-cond">${condText(s.cond)}<span class="chev">調整</span></button>
  </section>

  <section class="status ${lv.key}">
    <div class="ring"><div class="ring-in">
      <div class="ratio">${ratioText(a.ratio)}</div>
      <div class="ratio-cap">和平常比</div>
    </div></div>
    <h1 class="lv-title">${lv.title}</h1>
    <p class="lv-hint">${lv.hint}</p>
    <div class="abs">
      <div><b>${pct(a.p)}</b><span>${odds(a.p)}</span><label>現在的機率</label></div>
      <div><b>${pct(a.pBg)}</b><span>${odds(a.pBg)}</span><label>平常的機率</label></div>
    </div>
    <p class="abs-cap">${esc(condText(s.cond))}，至少發生一次的機率</p>
  </section>

  <p class="fresh">
    <span class="dot"></span>${twTime(f.issued_at)} 更新（${ago(f.issued_at)}）
    ${under ? `・近 ${f.data_status.gap_days} 天是暫時資料，現在的機率可能低估最多約 ${Math.round(under * 100)}%` : ""}
  </p>
  ${notes.length ? `<div class="note">${notes.map((n) => `<p>⚠ ${esc(n)}</p>`).join("")}</div>` : ""}

  <details class="fold">
    <summary>這個數字是什麼意思？</summary>
    <div class="fold-body">
      <p><b>不是地震預報。</b>這是統計模型算出的「機率」：根據這裡長期多常有地震，加上最近有沒有地震（大地震後常有餘震），估計在你選的範圍與時間內，<b>至少發生一次</b>這種規模地震的機率。</p>
      <p><b>為什麼看「倍數」？</b>單看「${pct(a.p)}」很難判斷高低。「平常」是只用長期紀錄算的機率；倍數＝現在÷平常。顏色只看倍數。</p>
      <p><b>「和平常差不多」不代表不會有地震。</b>台灣每年有上千次有感地震，平時就要做好防震準備。</p>
      <p><b>資料的限制：</b>正式地震目錄約落後一個半月，最近的部分用中央氣象署有感報告與 USGS 暫時補上，小地震不齊，所以「現在」可能偏低。</p>
      <a class="link" href="#/expert/verify">看模型怎麼驗證的 →</a>
    </div>
  </details>

  <details class="fold">
    <summary>換個情境看看</summary>
    <div class="fold-body">
      <div class="scards">
        ${scenario(s, "如果是 M6 以上？", { m: 6 })}
        ${scenario(s, "如果看 7 天？", { T: 7 })}
        ${scenario(s, "小一點的 M4？", { m: 4 })}
        ${scenario(s, "整個台灣呢？", {}, true)}
      </div>
      <a class="extcard" href="${SIM_URL}" target="_blank" rel="noopener">
        <b>想看某個規模的地震會搖多大？</b>
        <span>用 ExpTech Studio 地震模擬器自己設定震央與規模試試看。</span>
        <small>資料來源：ExpTech Studio 地震模擬器（${SIM_URL}）・教育用途、非商業</small>
      </a>
    </div>
  </details>

  <details class="fold">
    <summary>更多（專家版、其他工具）</summary>
    <div class="fold-body links">
      <a href="#/expert/map">🗺 風險地圖：全台每一格的機率</a>
      <a href="#/expert/mag">📈 換規模：機率怎麼隨規模變</a>
      <a href="#/expert/time">⏱ 換時間：機率怎麼隨時間變</a>
      <a href="#/expert/verify">✅ 驗證與原理：這個模型準不準</a>
      <a href="${ICP_URL}?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">🎲 拿「${esc(q)}」去「我也會地震預測」算算看矇中機率</a>
    </div>
  </details>
  `;
}

export function renderPlaceSheet(s: State): string {
  return `
  <div class="sheet-head"><h2>選擇位置</h2><button class="x" data-act="close">✕</button></div>
  <button class="btn primary wide" data-act="locate">📍 使用目前位置</button>
  <p class="muted small">位置只在你的手機上計算，不會傳出去。</p>
  <div class="county-grid">
    ${COUNTIES.map((c) =>
      `<button class="chip ${s.place.label === c.name ? "on" : ""}" ${c.outside ? "disabled title='在模型範圍外'" : ""} data-county="${c.name}">${c.name}</button>`,
    ).join("")}
  </div>
  <p class="muted small">金門、連江在模型網格（北緯 21–26°、東經 119–123°）外，暫不提供。</p>`;
}

export function renderCondSheet(s: State): string {
  const row = (title: string, key: string, opts: [number, string][], cur: number) => `
    <div class="field"><label>${title}</label><div class="seg">
      ${opts.map(([v, l]) => `<button class="${Math.abs(v - cur) < 1e-9 ? "on" : ""}" data-cond="${key}" data-v="${v}">${l}</button>`).join("")}
    </div></div>`;
  return `
  <div class="sheet-head"><h2>調整條件</h2><button class="x" data-act="close">✕</button></div>
  ${row("範圍（以你為中心）", "radiusKm", RADII.map((r) => [r, `${r} km`]), s.cond.radiusKm)}
  ${row("時間", "T", TIMES, s.cond.T)}
  ${row("規模", "m", MAGS.map((m) => [m, `M${m}+`]), s.cond.m)}
  <button class="btn wide" data-act="reset-cond">回到預設（50 km・3 天・M5）</button>`;
}
