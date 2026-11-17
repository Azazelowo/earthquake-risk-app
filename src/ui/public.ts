// 大眾版首頁：一個狀態（和平常比的倍數決定顏色）＋絕對機率＋可展開的說明。
// 提醒與資料限制集中在 ⓘ 頁（info.ts）；這裡只留「已驗證／外推估計」的小標籤。
import type { State, Cond } from "../state";
import { RADII, TIMES, MAGS, COUNTIES, timeLabel, placeShort } from "../state";
import { assess, assessPoint, allWeights, isVerified } from "../core/hazard";
import { levelOf, pct, odds, ratioText, twTime, ago, esc, distText } from "../format";
import { COARSE_M } from "../geo/towns";
import { pwa } from "../pwa";
import { conditionNotes } from "./info";

const ICP_URL = "https://azazelowo.github.io/i-can-predict-quakes/";
const SIM_URL = "https://eq-simulator.exptech.com.tw/";

export function condText(c: Cond) {
  return `周圍 ${c.radiusKm} km・${timeLabel(c.T)}內・M${c.m} 以上`;
}

function scenario(s: State, label: string, c: Partial<Cond>, all = false) {
  const cond = { ...s.cond, ...c };
  const desc = all ? `全台網格・${timeLabel(cond.T)}內・M${cond.m} 以上` : condText(cond);
  const attrs = `data-apply='${JSON.stringify(all ? {} : c)}' ${all ? 'data-goto="#/expert/map"' : ""}`;
  const a = all ? assess(s.feed, allWeights(s.feed), cond.m, cond.T) : assessPoint(s.feed, s.place.lat, s.place.lon, cond.radiusKm, cond.m, cond.T);
  if ("covered" in a && !a.covered)
    return `<button class="scard" ${attrs}><span class="scard-q">${label}</span><span class="scard-p">—</span><span class="scard-d">${desc}</span><span class="scard-lv">模型未涵蓋</span></button>`;
  const lv = levelOf(a.ratio);
  return `<button class="scard ${lv.key}" ${attrs}>
    <span class="scard-q">${label}</span>
    <span class="scard-p">${pct(a.p)}<small>平常 ${pct(a.pBg)}</small></span>
    <span class="scard-d">${desc}</span>
    <span class="scard-lv">${lv.title}</span>
  </button>`;
}

/** 位置按鈕：第一行是地點，第二行小字是定位誤差或狀態 */
function locButton(s: State): string {
  let main = esc(s.place.label), sub = esc(s.place.detail ?? ""), subCls = "";
  if (s.locate === "pending") (main = "定位中…"), (sub = "");
  else if (s.locate === "denied") (sub = "無法定位，暫用這個位置"), (subCls = "warn-text");
  return `
    <button class="loc" data-act="pick-place" aria-label="換位置">
      <svg viewBox="0 0 24 24" class="ico"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>
      <span class="loc-t"><b>${main}</b>${sub ? `<small class="${subCls}">${sub}</small>` : ""}</span><span class="chev">▾</span>
    </button>`;
}

/** 定位誤差很大時（多半是電腦）提醒可以自己選位置；數字仍用定位到的座標計算 */
function coarseHint(s: State): string {
  if (s.place.source !== "gps" || s.locate === "pending" || !((s.place.accuracyM ?? 0) > COARSE_M)) return "";
  return `<p class="lv-hint coarse">這台裝置的定位誤差有${esc(distText(s.place.accuracyM!))}（電腦或室內常見），位置可能不對。<a href="#/expert/map">在地圖上點選</a>，或點上方選縣市。</p>`;
}

/** 安裝提示：只在「還沒安裝、而且這台裝置裝得起來」時出現在頁面最下方，可以關掉 */
function installCard(showHint: boolean): string {
  if (!showHint || pwa.standalone || !(pwa.canInstall || pwa.ios)) return "";
  return `
  <div class="install">
    <img src="./icons/icon-192.png" alt="" width="40" height="40">
    <div class="install-t"><b>加到主畫面，像 APP 一樣開</b>
      <span>${pwa.canInstall ? "沒網路時也能看到上次的資料。" : "用 Safari 開啟，點「分享」再選「加入主畫面」。"}</span></div>
    ${pwa.canInstall ? `<button class="btn primary" data-act="install">安裝</button>` : ""}
    <button class="x" data-act="dismiss-install" aria-label="不再提示">✕</button>
  </div>`;
}

export function renderPublic(s: State, opt: { installHint: boolean }): string {
  const f = s.feed, c = s.cond;
  const a = assessPoint(f, s.place.lat, s.place.lon, c.radiusKm, c.m, c.T);
  const lv = levelOf(a.ratio);
  const nNotes = conditionNotes(s).length;
  const q = `${placeShort(s.place)}附近 ${timeLabel(c.T)}內會發生規模 ${c.m} 以上的地震`;

  const status = a.covered
    ? `
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
    <p class="abs-cap">${esc(condText(c))}，至少發生一次的機率</p>
    <a class="vtag ${isVerified(f, c.m, c.T) ? "ok" : "ext"}" href="#/info">${isVerified(f, c.m, c.T) ? "已驗證範圍" : "外推估計"}<i>ⓘ</i></a>
  </section>`
    : `
  <section class="status nocover">
    <div class="ring"><div class="ring-in">
      <div class="ratio">—</div>
      <div class="ratio-cap">沒有資料</div>
    </div></div>
    <h1 class="lv-title">目前模型未涵蓋此區域</h1>
    <p class="lv-hint">模型只涵蓋臺灣本島與澎湖附近（北緯 ${f.grid.lat_min}–${f.grid.lat_max}°、東經 ${f.grid.lon_min}–${f.grid.lon_max}°）。這不代表這裡沒有地震風險。</p>
    <button class="btn primary" data-act="pick-place">改選其他位置</button>
  </section>`;

  return `
  <section class="loc-row">
    ${locButton(s)}${coarseHint(s)}
    <button class="cond" data-act="edit-cond">${condText(c)}<span class="chev">調整</span></button>
  </section>
  ${status}

  <p class="fresh">
    <span class="dot"></span>${twTime(f.issued_at)} 更新（${ago(f.issued_at)}）・<a href="#/info">資料說明${nNotes ? `（${nNotes} 則提醒）` : ""}</a>
  </p>

  <details class="fold">
    <summary>這個數字是什麼意思？</summary>
    <div class="fold-body">
      <p><b>不是地震預報。</b>這是統計模型算出的「機率」：根據這裡長期多常有地震，加上最近有沒有地震（大地震後常有餘震），估計在你選的範圍與時間內，<b>至少發生一次</b>這種規模地震的機率。</p>
      <p><b>為什麼看「倍數」？</b>單看一個百分比很難判斷高低。「平常」是只用長期紀錄算的機率；倍數＝現在÷平常。顏色只看倍數。</p>
      <p><b>「和平常差不多」不代表不會有地震。</b>台灣每年有上千次有感地震，平時就要做好防震準備。</p>
      <a class="link" href="#/info">資料限制與完整說明 →</a>
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
  ${installCard(opt.installHint)}
  `;
}

export function renderPlaceSheet(s: State): string {
  return `
  <div class="sheet-head"><h2>選擇位置</h2><button class="x" data-act="close" aria-label="關閉">✕</button></div>
  <button class="btn primary wide" data-act="locate">📍 使用目前位置</button>
  <a class="btn wide center" href="#/expert/map">🗺 在地圖上點選</a>
  <p class="muted small">位置只在你的手機上計算，不會傳出去。</p>
  <div class="county-grid">
    ${COUNTIES.map((c) =>
      `<button class="chip ${s.place.source === "county" && s.place.label === c.name ? "on" : ""}" ${c.outside ? "disabled title='在模型範圍外'" : ""} data-county="${c.name}">${c.name}</button>`,
    ).join("")}
  </div>
  <p class="muted small">金門、連江在模型網格（北緯 21–26°、東經 119–123°）外，暫不提供。</p>`;
}

export function renderCondSheet(s: State): string {
  const row = (title: string, key: string, opts: [number, string][], cur: number) => `
    <div class="field"><label>${title}</label><div class="seg">
      ${opts.map(([v, l]) => `<button class="${Math.abs(v - cur) < 1e-9 ? "on" : ""}" data-cond="${key}" data-v="${v}">${l}</button>`).join("")}
    </div></div>`;
  // 半徑可能是在地圖上用滑桿調出來的任意值：多列一顆代表「目前的值」
  const radii: [number, string][] = RADII.map((r) => [r, `${r} km`]);
  if (!RADII.includes(s.cond.radiusKm)) radii.push([s.cond.radiusKm, `${s.cond.radiusKm} km`]), radii.sort((a, b) => a[0] - b[0]);
  return `
  <div class="sheet-head"><h2>調整條件</h2><button class="x" data-act="close" aria-label="關閉">✕</button></div>
  ${row("範圍（以你為中心）", "radiusKm", radii, s.cond.radiusKm)}
  <p class="muted small">想要其他半徑，可以到專家版的地圖用滑桿調整。</p>
  ${row("時間", "T", TIMES, s.cond.T)}
  ${row("規模", "m", MAGS.map((m) => [m, `M${m}+`]), s.cond.m)}
  <button class="btn wide" data-act="reset-cond">回到預設（50 km・3 天・M5）</button>`;
}
