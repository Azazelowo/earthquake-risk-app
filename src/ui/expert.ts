// 專家版：三種「3 中 2」檢視（地圖／規模／時間）＋驗證＋更多。地圖由 map.ts 在畫面插入後掛上。
import type { State } from "../state";
import type { BacktestRow } from "../data/schema";
import { RADII, TIMES, MAGS, timeLabel } from "../state";
import { pointWeights, allWeights, regionRef, scaleMagnitude, probability, magnitudeAtProbability, reliabilityNotes, interpHorizon } from "../core/hazard";
import { lineChart } from "./chart";
import { pct, ratioText, twTime, esc } from "../format";
import { LEVEL_EDGES } from "../format";

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
    <button class="${s.scope === "point" ? "on" : ""}" data-scope="point">點：${esc(s.place.label.replace(/（.*）/, ""))}</button>
    <button class="${s.scope === "all" ? "on" : ""}" data-scope="all">全區</button>
    <button disabled title="雛型尚未提供">線（之後）</button>
  </div></div>
  ${s.scope === "point" ? `<div class="ctl"><label>半徑</label>${seg("radiusKm", RADII.map((r) => [r, `${r} km`]), s.cond.radiusKm)}</div>` : ""}`;
}

function weights(s: State) {
  return s.scope === "all" ? allWeights(s.feed) : pointWeights(s.feed, s.place.lat, s.place.lon, s.cond.radiusKm);
}

function notesBox(s: State) {
  const n = reliabilityNotes(s.feed, s.cond.m, s.cond.T);
  return n.length ? `<div class="note">${n.map((x) => `<p>⚠ ${esc(x)}</p>`).join("")}</div>` : "";
}

function viewMap(s: State) {
  return `
  <div class="ctls">
    <div class="ctl"><label>規模</label>${seg("m", MAGS.map((m) => [m, `M${m}+`]), s.cond.m)}</div>
    <div class="ctl"><label>時間</label>${seg("T", TIMES, s.cond.T)}</div>
    <div class="ctl"><label>顯示</label>
      <div class="seg sm"><button class="${s.mapLayer === "p" ? "on" : ""}" data-layer="p">機率</button><button class="${s.mapLayer === "ratio" ? "on" : ""}" data-layer="ratio">和平常比</button></div></div>
  </div>
  <div id="map" class="map"></div>
  <div class="legend" id="legend"></div>
  <p class="muted small">點格子看數字。圓點是最近 30 天的地震（大小＝規模）。網格 0.2°（約 20 km）。</p>
  ${notesBox(s)}`;
}

function viewMag(s: State) {
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
  <div class="ctls">${scopeCtl(s)}<div class="ctl"><label>時間</label>${seg("T", TIMES, s.cond.T)}</div></div>
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
  <div class="ctls">${scopeCtl(s)}<div class="ctl"><label>規模</label>${seg("m", MAGS.map((m) => [m, `M${m}+`]), s.cond.m)}</div></div>
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
  <details class="fold"><summary>狀態門檻怎麼定（暫定）</summary><div class="fold-body">
    <p>倍數 &lt; ${LEVEL_EDGES[0]}：和平常差不多；${LEVEL_EDGES[0]}–${LEVEL_EDGES[1]}：高一些；${LEVEL_EDGES[1]}–${LEVEL_EDGES[2]}：高不少；≥ ${LEVEL_EDGES[2]}：遠高於平常。</p>
    <p>目前這份資料（3 天）全區 ${full.length} 格的分布：${["差不多", "高一些", "高不少", "遠高於"].map((t, i) => `${t} ${counts[i]}`).join("、")}。正式門檻會用回測期間各狀態出現的頻率來定，讓「高」不會天天出現。</p>
  </div></details>
  <details class="fold"><summary>資料狀態</summary><div class="fold-body">
    <p>正式目錄到 ${twTime(f.data_status.catalog_end)}；之後 ${f.data_status.gap_days} 天用 ${f.data_status.sources.join("、")} 暫時補了 ${f.data_status.n_provisional} 筆。</p>
    <p>缺口評估（現在的總數可能低估最多）：${Object.entries(f.data_status.undercount_by_horizon).map(([k, v]) => `${tl(+k)} ${Math.round(v * 100)}%`).join("、")}</p>
  </div></details>`;
}

function viewMore(s: State) {
  return `
  <h3 class="vh">更多</h3>
  <div class="card-list">
    <div class="card dim"><b>歷史回放</b><p>選一個過去的日子（例如 2024-04-03 花蓮地震前後），看當時模型怎麼說。<span class="tag">之後做</span></p></div>
    <div class="card"><b>資料下載</b><p>目前畫面用的整份資料（JSON，每格 10 個時間長度的期望數）。</p>
      <button class="btn" data-act="download">下載 feed.json</button></div>
    <div class="card"><b>最近的地震</b>
      <table class="tbl"><thead><tr><th>時間</th><th>規模</th><th>深度</th><th>來源</th></tr></thead><tbody>
      ${s.feed.recent.slice(0, 8).map((e) => `<tr><td>${twTime(e.time)}</td><td>${e.ml.toFixed(1)}</td><td>${e.depth_km} km</td><td>${e.source}</td></tr>`).join("")}
      </tbody></table></div>
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
