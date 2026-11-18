// 專家版：三種「3 中 2」檢視（地圖／規模／時間）＋驗證＋更多。地圖由 map.ts 在畫面插入後掛上。
import type { State } from "../state";
import type { BacktestRow } from "../data/schema";
import { RADII, RADIUS_MIN, RADIUS_MAX, RADIUS_STEP, SMOOTH_LABELS, TIMES, MAGS, timeLabel, placeShort } from "../state";
import {
  pointWeights, allWeights, regionRef, scaleMagnitude, probability, magnitudeAtProbability, reliabilityNotes, interpHorizon,
  assessPoint, cellIndexAt, cellProbabilities, FULL_COVERAGE,
} from "../core/hazard";
import { lineChart } from "./chart";
import { pct, ratioText, twTime, ago, esc, levelOf } from "../format";
import { LEVEL_EDGES, LEVEL_BACKTEST } from "../format";
import { EXPTECH_CREDIT, intText, quakeRow, type Quake } from "../data/exptech";
import { outlookSection } from "./outlook";
import { condSliders } from "./sliders";
import { BASEMAPS, resolveBasemap, usable } from "./basemaps";

export type ExpertTab = "map" | "mag" | "time" | "verify" | "more";

export const TABS: [ExpertTab, string, string][] = [
  ["map", "地圖", "M3 5h5l3-2 3 2h5v14h-5l-3-2-3 2H3z"],
  ["mag", "規模", "M3 20h18M5 17l4-6 4 3 6-9"],
  ["time", "時間", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 3"],
  ["verify", "驗證", "M5 12l4 4 10-10"],
  ["more", "更多", "M5 12h.01M12 12h.01M19 12h.01"],
];

const seg = (key: string, opts: [number | string, string][], cur: number | string) =>
  `<div class="seg sm">${opts
    .map(([v, l]) => `<button class="${String(v) === String(cur) ? "on" : ""}" data-cond="${key}" data-v="${v}">${l}</button>`)
    .join("")}</div>`;

function scopeCtl(s: State) {
  return `<div class="ctl"><label>範圍</label><div class="seg sm">
    <button class="${s.scope === "point" ? "on" : ""}" data-scope="point">點：${esc(placeShort(s.place))}</button>
    <button class="${s.scope === "all" ? "on" : ""}" data-scope="all">全區</button>
    <button disabled title="雛型尚未提供">線（之後）</button>
  </div></div>
  ${s.scope === "point" ? `<div class="ctl"><label>半徑</label>${seg("radiusKm", radiusOpts(s), s.cond.radiusKm)}</div>` : ""}`;
}

/** 半徑選項：固定四個＋（如果是在地圖上用滑桿調的其他值）目前的值 */
function radiusOpts(s: State): [number, string][] {
  const list = RADII.includes(s.cond.radiusKm) ? RADII : [...RADII, s.cond.radiusKm].sort((a, b) => a - b);
  return list.map((r) => [r, `${r} km`]);
}

function weights(s: State) {
  return s.scope === "all" ? allWeights(s.feed) : pointWeights(s.feed, s.place.lat, s.place.lon, s.cond.radiusKm);
}

/** 「點」範圍但位置在模型網格外：不畫圖（全是 0 的曲線沒有意義，也會讓人誤以為機率是 0） */
function uncoveredBox(s: State): string {
  if (s.scope !== "point") return "";
  const a = assessPoint(s.feed, s.place.lat, s.place.lon, s.cond.radiusKm, s.cond.m, s.cond.T);
  if (a.covered) return "";
  return `<div class="note"><p><b>目前模型未涵蓋此區域。</b>模型只涵蓋北緯 ${s.feed.grid.lat_min}–${s.feed.grid.lat_max}°、東經 ${s.feed.grid.lon_min}–${s.feed.grid.lon_max}°。可以改看「全區」，或到地圖換一個位置。</p></div>`;
}

function notesBox(s: State) {
  const n = reliabilityNotes(s.feed, s.cond.m, s.cond.T);
  return n.length ? `<div class="note">${n.map((x) => `<p>⚠ ${esc(x)}</p>`).join("")}</div>` : "";
}

const layerSeg = (s: State) =>
  `<div class="seg sm"><button class="${s.mapLayer === "p" ? "on" : ""}" data-layer="p">機率</button><button class="${s.mapLayer === "ratio" ? "on" : ""}" data-layer="ratio">和平常比</button></div>`;

// 地圖上的按鈕圖示（24×24 線條）
const ICON = {
  full: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  exitFull: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
  locate: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3",
};
const mapBtn = (act: string, icon: string, label: string) =>
  `<button class="mbtn" data-act="${act}" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24"><path d="${icon}"/></svg></button>`;

/**
 * 地圖下方卡片的數字：圓內的評估＋圓心所在那一格的原始值。
 * 獨立成函式是因為拖半徑滑桿時要即時更新這一塊（不重畫整頁）。
 */
export function pickNumbers(s: State, radiusKm = s.cond.radiusKm): string {
  const f = s.feed, c = s.cond;
  const a = assessPoint(f, s.place.lat, s.place.lon, radiusKm, c.m, c.T);
  if (!a.covered) return `<p class="pick-none">目前模型未涵蓋此區域</p><p class="muted small">模型只涵蓋北緯 ${f.grid.lat_min}–${f.grid.lat_max}°、東經 ${f.grid.lon_min}–${f.grid.lon_max}°。</p>`;
  const lv = levelOf(a.ratio);
  const i = cellIndexAt(f, s.place.lat, s.place.lon);
  let cell = "";
  if (i >= 0) {
    // 這一格的數字永遠取模型原始值，不受地圖平滑化影響
    const p = cellProbabilities(f, c.m, c.T, "full")[i], pb = cellProbabilities(f, c.m, c.T, "bg")[i];
    cell = `<div class="pick-row"><label>圓心這一格（${f.grid.deg}°）</label><span>現在 ${pct(p)}・平常 ${pct(pb)}</span></div>`;
  }
  const part = a.coverage < FULL_COVERAGE ? `<p class="muted small">範圍約 ${Math.round((1 - a.coverage) * 100)}% 在模型網格外，未計入。</p>` : "";
  return `
    <div class="pick-row main"><label>圓內・M${c.m}+・${timeLabel(c.T)}內</label>
      <span><b>${pct(a.p)}</b>・平常 ${pct(a.pBg)}・<b class="${lv.key}">${ratioText(a.ratio)}</b></span></div>
    ${cell}${part}`;
}

function pickCard(s: State) {
  const r = s.cond.radiusKm;
  return `
  <div class="pick">
    <div class="pick-head">
      <div class="pick-place"><b>${esc(s.place.label)}</b>${s.place.detail ? `<small>${esc(s.place.detail)}</small>` : ""}</div>
      <span class="muted small">點地圖換中心</span>
    </div>
    <label class="pick-radius"><span>半徑</span>
      <input type="range" min="${RADIUS_MIN}" max="${RADIUS_MAX}" step="${RADIUS_STEP}" value="${r}" data-range="radius" aria-label="半徑（公里）">
      <output id="radius-out">${r} km</output></label>
    <div id="pick-nums">${pickNumbers(s)}</div>
  </div>`;
}

function viewMap(s: State) {
  return `
  <div class="ctls">
    <div class="ctl"><label>規模</label>${seg("m", MAGS.map((m) => [m, `M${m}+`]), s.cond.m)}</div>
    <div class="ctl"><label>時間</label>${seg("T", TIMES, s.cond.T)}</div>
    <div class="ctl-slides">${condSliders(s.cond, ["mag", "time"])}</div>
  </div>
  <div class="mapwrap ${s.mapFull ? "full" : ""}">
    <div class="mapbox">
      <div id="map" class="map"></div>
      <div class="map-layer">${layerSeg(s)}</div>
      <div class="map-btns">
        ${mapBtn("map-full", s.mapFull ? ICON.exitFull : ICON.full, s.mapFull ? "離開全螢幕" : "全螢幕")}
        ${mapBtn("layers", ICON.layers, "底圖與平滑")}
        ${mapBtn("map-locate", ICON.locate, "移到我的位置")}
      </div>
      <div class="map-note" id="map-note" hidden></div>
    </div>
    <div class="legend" id="legend"></div>
    ${pickCard(s)}
  </div>
  <p class="muted small">圓點是最近 30 天的地震（大小＝規模），點它看詳細。模型網格 0.2°（約 20 km）${s.smooth ? "；目前開了平滑，那只是顯示效果，數字仍以原始格子為準" : ""}。</p>
  ${notesBox(s)}`;
}

/** 地圖設定面板：平滑與底圖；全螢幕時上方的條件列被蓋住，所以這裡也放規模與時間（「機率／和平常比」的切換直接浮在地圖左上角） */
export function renderLayersSheet(s: State): string {
  const cur = resolveBasemap(s.basemap).id;
  const opts = BASEMAPS.map((b) =>
    usable(b)
      ? `<button class="opt ${b.id === cur ? "on" : ""}" data-basemap="${b.id}"><b>${esc(b.name)}</b><small>${esc(b.note)}</small></button>`
      : `<button class="opt need" data-act="need-carto"><b>${esc(b.name)}</b><small>需要金鑰：點這裡到 ⓘ 頁設定</small></button>`,
  ).join("");
  return `
  <div class="sheet-head"><h2>地圖設定</h2><button class="x" data-act="close" aria-label="關閉">✕</button></div>
  <div class="field"><label>平滑（只是顯示效果，模型解析度仍是 ${s.feed.grid.deg}°）</label><div class="seg">
    ${SMOOTH_LABELS.map((l, i) => `<button class="${i === s.smooth ? "on" : ""}" data-smooth="${i}">${l}</button>`).join("")}
  </div></div>
  ${s.mapFull ? `
  <div class="field"><label>規模</label><div class="seg">${MAGS.map((m) => `<button class="${m === s.cond.m ? "on" : ""}" data-cond="m" data-v="${m}">M${m}+</button>`).join("")}</div></div>
  <div class="field"><label>時間</label><div class="seg">${TIMES.map(([v, l]) => `<button class="${Math.abs(v - s.cond.T) < 1e-9 ? "on" : ""}" data-cond="T" data-v="${v}">${l}</button>`).join("")}</div></div>` : ""}
  <div class="field"><label>底圖</label><div class="opts">${opts}</div></div>`;
}

function viewMag(s: State) {
  const blocked = uncoveredBox(s);
  if (blocked) return `<div class="ctls">${scopeCtl(s)}</div><h3 class="vh">固定地點＋時間，看規模</h3>${blocked}`;
  const f = s.feed, w = weights(s);
  const nF = regionRef(f, w, s.cond.T, "full"), nB = regionRef(f, w, s.cond.T, "bg");
  const mags: number[] = [];
  for (let m = 3; m <= 7.5 + 1e-9; m += 0.1) mags.push(+m.toFixed(1));
  const P = (n: number, m: number) => probability(scaleMagnitude(n, m, f.params.m_ref, f.params.b));
  const chart = lineChart(
    [
      { name: "平常", cls: "bg", pts: mags.map((m) => [m, P(nB, m)]) },
      { name: "現在", cls: "now", pts: mags.map((m) => [m, P(nF, m)]) },
    ],
    { xTicks: [3, 4, 5, 6, 7].map((m) => [m, `M${m}`]), xLabel: "規模門檻（以上）", marker: s.cond.m },
  );
  const inv = [0.5, 0.1, 0.01].map((p) => {
    const m = magnitudeAtProbability(f, w, s.cond.T, p);
    return `<tr><td>${pct(p)}</td><td>${isFinite(m) && m > 2 ? `M${m.toFixed(1)}` : "—"}</td></tr>`;
  });
  return `
  <div class="ctls">${scopeCtl(s)}<div class="ctl"><label>時間</label>${seg("T", TIMES, s.cond.T)}</div>
    <div class="ctl-slides">${condSliders(s.cond, s.scope === "point" ? ["radius", "time"] : ["time"])}</div></div>
  <h3 class="vh">固定地點＋時間，看規模</h3>
  ${chart}
  <div class="keys"><span class="k now">現在</span><span class="k bg">平常</span></div>
  <div class="kv">
    <div><label>M${s.cond.m}+ 現在</label><b>${pct(P(nF, s.cond.m))}</b></div>
    <div><label>平常</label><b>${pct(P(nB, s.cond.m))}</b></div>
    <div><label>倍數</label><b>${ratioText(P(nF, s.cond.m) / P(nB, s.cond.m))}</b></div>
  </div>
  <table class="tbl"><thead><tr><th>機率達到</th><th>對應規模（以上）</th></tr></thead><tbody>${inv.join("")}</tbody></table>
  ${notesBox(s)}`;
}

function viewTime(s: State) {
  const blocked = uncoveredBox(s);
  if (blocked) return `<div class="ctls">${scopeCtl(s)}</div><h3 class="vh">固定地點＋規模，看時間</h3>${blocked}`;
  const f = s.feed, w = weights(s);
  const Ts: number[] = [];
  for (let e = Math.log10(1 / 24); e <= Math.log10(30) + 1e-9; e += 0.05) Ts.push(10 ** e);
  const P = (T: number, which: "full" | "bg") =>
    probability(scaleMagnitude(regionRef(f, w, Math.min(Math.max(T, f.horizons_days[0]), 30), which), s.cond.m, f.params.m_ref, f.params.b));
  const chart = lineChart(
    [
      { name: "平常", cls: "bg", pts: Ts.map((T) => [T, P(T, "bg")]) },
      { name: "現在", cls: "now", pts: Ts.map((T) => [T, P(T, "full")]) },
    ],
    { xLog: true, xTicks: [[1 / 24, "1時"], [6 / 24, "6時"], [1, "1天"], [3, "3天"], [7, "7天"], [30, "30天"]], xLabel: "時間長度", marker: s.cond.T },
  );
  return `
  <div class="ctls">${scopeCtl(s)}<div class="ctl"><label>規模</label>${seg("m", MAGS.map((m) => [m, `M${m}+`]), s.cond.m)}</div>
    <div class="ctl-slides">${condSliders(s.cond, s.scope === "point" ? ["radius", "mag"] : ["mag"])}</div></div>
  <h3 class="vh">固定地點＋規模，看時間</h3>
  ${chart}
  <div class="keys"><span class="k now">現在</span><span class="k bg">平常</span></div>
  <p class="muted small">「現在」的曲線在短時間內比平常高、時間拉長後倍數變小：近期活動（餘震）會隨時間衰減，長期就回到背景。</p>
  <table class="tbl"><thead><tr><th>時間</th><th>現在</th><th>平常</th><th>倍數</th></tr></thead><tbody>
  ${TIMES.map(([T, l]) => {
    const a = P(T, "full"), b = P(T, "bg");
    return `<tr class="${Math.abs(T - s.cond.T) < 1e-9 ? "hl" : ""}"><td>${l}</td><td>${pct(a)}</td><td>${pct(b)}</td><td>${ratioText(a / b)}</td></tr>`;
  }).join("")}
  </tbody></table>
  ${notesBox(s)}`;
}

/** 規模（列）×時間（欄）的小矩陣，比 20 列長表適合手機 */
function matrix(f: State["feed"], title: string, val: (r: BacktestRow) => string, bad: (r: BacktestRow) => boolean) {
  const ms = [...new Set(f.backtest.map((r) => r.m))].sort((a, b) => a - b);
  const ts = [...new Set(f.backtest.map((r) => r.horizon_days))].sort((a, b) => a - b);
  const cell = (m: number, t: number) => {
    const r = f.backtest.find((x) => x.m === m && x.horizon_days === t);
    return r ? `<td class="${bad(r) ? "bad" : ""}" title="${r.n_events} 個地震">${val(r)}</td>` : "<td>—</td>";
  };
  return `<p class="mt-title">${title}</p><table class="tbl mtx"><thead><tr><th></th>${ts.map((t) => `<th>${timeLabel(t)}</th>`).join("")}</tr></thead>
  <tbody>${ms.map((m) => `<tr><th>M${m}+</th>${ts.map((t) => cell(m, t)).join("")}</tr>`).join("")}</tbody></table>`;
}

function viewVerify(s: State) {
  const f = s.feed;
  const tl = (T: number) => timeLabel(T);
  // 各狀態在全區格子出現的比例（假資料示範；正式版改用回測期間每個發布時間統計）
  const full = interpHorizon(f.n_full, f.horizons_days, 3), bg = interpHorizon(f.n_bg, f.horizons_days, 3);
  const counts = [0, 0, 0, 0];
  full.forEach((n, i) => {
    const r = n / bg[i];
    counts[r < LEVEL_EDGES[0] ? 0 : r < LEVEL_EDGES[1] ? 1 : r < LEVEL_EDGES[2] ? 2 : 3]++;
  });
  return `
  <h3 class="vh">這個模型準不準？</h3>
  ${f.mock ? `<p class="note"><b>以下數字是示意用的假資料</b>，接上真資料後換成回測結果。</p>` : ""}
  <p>回測：用 1995–2014 年的資料定好參數，再拿 2015 年之後每一天「當時只知道過去」的預測，和真的有沒有發生比。</p>
  ${matrix(f, "AUC（越接近 1 越能分辨哪裡會發生）", (r) => r.auc.toFixed(2), () => false)}
  ${matrix(f, "預測÷實際（1 最好，黃色＝偏差超過 25%）", (r) => r.ratio.toFixed(2), (r) => r.ratio > 1.25 || r.ratio < 0.8)}
  <details class="fold"><summary>AUC、預測÷實際是什麼？</summary><div class="fold-body">
    <p><b>AUC</b>：把「有發生」和「沒發生」的格子各抽一個，模型給有發生的那格較高機率的比例。0.5＝亂猜、1＝完美。</p>
    <p><b>預測÷實際</b>：預測的總數÷真的發生的總數。1 最好；大於 1 是高估（例如 1 天、M6 以上）。</p>
  </div></details>
  <details class="fold"><summary>公式</summary><div class="fold-body">
    <pre class="formula">發生率(格, t) = 長期背景 + Σ 近期地震的影響（大森定律）
N(格, T, ≥m) = N(格, T, ≥3.5) × 10^(−b(m−3.5))   b ≈ ${f.params.b}
N(範圍)     = Σ 格 N(格) × 該格在範圍內的面積比例
P(範圍)     = 1 − exp(−N(範圍))                卜瓦松：至少一次</pre>
    <p>「平常」＝只用長期背景單獨擬合的模型（不是完整模型裡的背景項，否則每個地方都會看起來偏高約 2 倍）。</p>
  </div></details>
  <details class="fold"><summary>沒有用的東西：地磁前兆</summary><div class="fold-body">
    <p>我們測試過 8 個地磁站的資料當作「前兆」：用置換檢定（把地磁資料和地震的時間打亂再比）看有沒有比隨機好，<b>沒有找到證據</b>，所以模型不使用地磁。負結果也是結果。</p>
  </div></details>
  <details class="fold"><summary>狀態門檻怎麼定（回測檢查過）</summary><div class="fold-body">
    <p>倍數 &lt; ${LEVEL_EDGES[0]}：和平常差不多；${LEVEL_EDGES[0]}–${LEVEL_EDGES[1]}：高一些；${LEVEL_EDGES[1]}–${LEVEL_EDGES[2]}：高不少；≥ ${LEVEL_EDGES[2]}：遠高於平常。</p>
    <p>目前這份資料（3 天）全區 ${full.length} 格的分布：${["差不多", "高一些", "高不少", "遠高於"].map((t, i) => `${t} ${counts[i]}`).join("、")}。</p>
    <p><b>回測檢查</b>：2015–2026 測試期 ${LEVEL_BACKTEST.days.toLocaleString("zh-TW")} 天、20 個縣市、首頁預設條件（50 km・3 天・M5 以上），各狀態出現的比例：${["差不多", "高一些", "高不少", "遠高於"].map((t, i) => `${t} ${(LEVEL_BACKTEST.share[i] * 100).toFixed(1)}%`).join("、")}。「高不少」以上平均大約一個月一次，符合「不要天天出現」的目標，所以維持這組門檻。全台排行的第一名有 ${Math.round((1 - LEVEL_BACKTEST.topCounty[0]) * 100)}% 的天數至少「高一些」。</p>
  </div></details>
  <details class="fold"><summary>資料狀態</summary><div class="fold-body">
    <p>正式目錄到 ${twTime(f.data_status.catalog_end)}；之後 ${esc(String(f.data_status.gap_days))} 天用 ${esc(f.data_status.sources.join("、"))} 暫時補了 ${esc(String(f.data_status.n_provisional))} 筆。</p>
    <p>缺口評估（現在的總數可能低估最多）：${Object.entries(f.data_status.undercount_by_horizon).map(([k, v]) => `${tl(+k)} ${Math.round(v * 100)}%`).join("、")}</p>
  </div></details>`;
}

const msTime = (ms: number) => twTime(new Date(ms).toISOString());

/** 這個地震會不會影響風險數字、而且還沒算進去：發生在資料發布之後，規模又到模型計數的門檻（m_ref） */
export function notYetCounted(f: State["feed"], q: Quake): boolean {
  return q.time > Date.parse(f.issued_at) && q.mag >= f.params.m_ref;
}

/**
 * 最近的地震：優先用 ExpTech 即時地震報告（手機直接連線）；連不上就用 feed 裡模型用到的地震（最多慢 15 分鐘）。
 * 列表只是「已經發生的地震」，不是預測；新地震要等下一次 feed 更新才會反映到風險數字上。
 * 外層的 id 讓 main.ts 每 2 分鐘更新列表時只換這一塊，不必整頁重畫（審查 E4）。
 */
export function recentCard(s: State): string {
  const q = s.quakes, f = s.feed;
  // 歷史回放中：列回放時間點之前 30 天的地震（正式目錄），不是現在的即時列表
  if (s.history)
    return `<div class="card" id="recent-quakes"><b>回放時間點之前的地震</b>
      <p class="muted small">${esc(twTime(f.issued_at))} 之前 30 天、規模 3 以上（正式目錄，事後整理的資料）。現在的即時列表要先「回到現在」。</p>
      <table class="tbl"><thead><tr><th>時間</th><th>規模</th><th>深度</th></tr></thead><tbody>
      ${f.recent.slice(0, 30).map((e) => `<tr><td>${esc(twTime(e.time))}</td><td>${Number(e.ml).toFixed(1)}</td><td>${esc(String(Math.round(e.depth_km)))} km</td></tr>`).join("")}
      </tbody></table></div>`;
  if (q && q.list.length) {
    const head = `<tr><th>時間</th><th>規模</th><th>最大震度</th><th>地點</th></tr>`;
    return `<div class="card" id="recent-quakes"><b>最近的地震</b>
      <p class="muted small">中央氣象署地震報告，含震度 0 的小地震。這是已經發生的地震，不是預測。<b>點一筆</b>可以看震央附近之後再發生地震的機率。</p>
      <p class="muted small">風險數字每 15 分鐘更新；標「還沒算進風險數字」的地震發生在這次資料（${esc(twTime(f.issued_at))}）之後。規模 ${f.params.m_ref} 以下的地震不影響風險數字。${q.status === "error" ? `<br>目前無法更新（${esc(q.error ?? "原因不明")}），顯示 ${esc(msTime(q.at ?? Date.now()))} 取得的列表。` : ""}</p>
      <div class="tbl-wrap"><table class="tbl quakes"><thead>${head}</thead><tbody>${q.list.slice(0, 30).map((e) => quakeRow(e, msTime, notYetCounted(f, e))).join("")}</tbody></table></div>
      <p class="credit">${esc(EXPTECH_CREDIT)}</p></div>`;
  }
  const note = !q || q.status === "loading" ? "正在取得即時地震報告…" : `無法取得即時地震報告（${esc(q.error ?? "原因不明")}），以下是模型資料裡的地震（規模 3 以上，最多慢 15 分鐘）。`;
  return `<div class="card" id="recent-quakes"><b>最近的地震</b><p class="muted small">${note}</p>
      <table class="tbl"><thead><tr><th>時間</th><th>規模</th><th>深度</th><th>來源</th></tr></thead><tbody>
      ${f.recent.slice(0, 8).map((e) => `<tr><td>${twTime(e.time)}</td><td>${Number(e.ml).toFixed(1)}</td><td>${esc(String(e.depth_km))} km</td><td>${esc(e.source)}</td></tr>`).join("")}
      </tbody></table></div>`;
}

/**
 * 地震列表點開的面板：這個地震的基本資料，以及震央附近之後再發生地震的機率（和首頁餘震卡同一段畫面）。
 * 地震發生在資料發布之後、而且規模會影響模型時，數字還沒反映它——這時不給數字，免得看起來「沒有升高」。
 */
export function renderQuakeSheet(s: State, q: Quake): string {
  const f = s.feed;
  const body = notYetCounted(f, q)
    ? `<p class="as-note">這個地震發生在 ${esc(twTime(f.issued_at))} 的風險資料之後，風險數字還沒反映它，所以先不顯示機率。資料每 15 分鐘更新一次，之後再點開看。</p>`
    : outlookSection(f, q);
  return `
  <div class="sheet-head"><h2>規模 ${q.mag.toFixed(1)} 的地震</h2><button class="x" data-act="close" aria-label="關閉">✕</button></div>
  <p class="qs-meta">${esc(msTime(q.time))}（${esc(ago(new Date(q.time).toISOString()))}）・最大震度 ${esc(intText(q.maxInt))}・深度 ${esc(String(Math.round(q.depth_km)))} 公里</p>
  <p class="qs-loc">${esc(q.loc)}</p>
  ${body}
  <p class="as-foot">統計機率，不是地震預報；最新消息以中央氣象署為準。<br>${esc(EXPTECH_CREDIT)}</p>`;
}

function viewMore(s: State) {
  return `
  <h3 class="vh">更多</h3>
  <div class="card-list">
    <a class="card cardlink" href="#/history"><b>歷史回放</b><p>2016 美濃、2018 花蓮、2022 池上、2024 花蓮地震前後，模型當時怎麼說（用事後資料重算）。</p><span class="link">打開 →</span></a>
    <div class="card"><b>資料下載</b><p>目前畫面用的整份資料（JSON，每格 10 個時間長度的期望數）。</p>
      <button class="btn" data-act="download">下載 feed.json</button></div>
    ${recentCard(s)}
    <div class="card"><b>參考資料</b>
      <ul class="refs">
        <li><a href="https://scweb.cwa.gov.tw/" target="_blank" rel="noopener">中央氣象署 地震測報中心</a></li>
        <li><a href="https://www.earth.sinica.edu.tw/" target="_blank" rel="noopener">中央研究院 地球科學研究所</a></li>
        <li><a href="https://www.j-shis.bosai.go.jp/" target="_blank" rel="noopener">J-SHIS 日本地震危害評估（呈現方式參考）</a></li>
        <li><a href="https://exptech.dev/" target="_blank" rel="noopener">DPIP 災害天氣與地震速報（ExpTech）</a></li>
        <li><a href="https://eq-simulator.exptech.com.tw/" target="_blank" rel="noopener">ExpTech Studio 地震模擬器</a></li>
        <li><a href="https://azazelowo.github.io/i-can-predict-quakes/" target="_blank" rel="noopener">我也會地震預測（矇中機率計算）</a></li>
      </ul></div>
  </div>`;
}

export function renderExpert(s: State, tab: ExpertTab): string {
  const body = { map: viewMap, mag: viewMag, time: viewTime, verify: viewVerify, more: viewMore }[tab](s);
  return `<div class="expert">${body}</div>`;
}

export function renderTabbar(tab: ExpertTab): string {
  return `<nav class="tabbar">${TABS.map(
    ([k, l, d]) => `<a href="#/expert/${k}" class="${k === tab ? "on" : ""}"><svg viewBox="0 0 24 24"><path d="${d}"/></svg><span>${l}</span></a>`,
  ).join("")}</nav>`;
}
