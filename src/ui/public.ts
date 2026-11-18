// 大眾版首頁：一個狀態（和平常比的倍數決定顏色）＋絕對機率＋可展開的說明。
// 提醒與資料限制集中在 ⓘ 頁（info.ts）；這裡只留「已驗證／外推估計」的小標籤。
import type { State, Cond } from "../state";
import type { Feed } from "../data/schema";
import { RADII, TIMES, MAGS, COUNTIES, timeLabel, placeShort } from "../state";
import type { CondSlider } from "../state";
import { condSliders } from "./sliders";
import { FAV_MAX, FAV_NAME_MAX, type Fav } from "../favs";
import { assess, assessPoint, allWeights, isVerified } from "../core/hazard";
import { pickMainshock, MAINSHOCK_RULES } from "../core/aftershock";
import { outlookSection } from "./outlook";
import { rankPlaces, scanPlace, MIN_P, RANK_RADIUS_KM, type ScanHit } from "../core/scan";
import { levelOf, pct, odds, ratioText, twTime, ago, esc, distText, LEVEL_EDGES } from "../format";
import { COARSE_M, coordText, epicenterText, loadedTowns } from "../geo/towns";
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

/**
 * 餘震卡：最近 7 天內 M5 以上（或 30 天內 M6 以上）的最大地震，震央周圍 50 km 之後再發生地震的機率。
 * 沒有這種地震就不出現。「大地震後偏低」這個限制直接寫在卡片上，不藏到 ⓘ 頁。
 */
export function aftershockCard(f: Feed): string {
  const q = pickMainshock(f);
  if (!q) return "";
  // 震央在哪個鄉鎮區：界線檔在手機上判斷（main.ts 會在需要時載入）；還沒載入就先給座標
  const idx = loadedTowns();
  const where = idx ? epicenterText(idx, q.lat, q.lon) : coordText(q.lat, q.lon);
  const rule = MAINSHOCK_RULES.map((r) => `${r.days} 天內規模 ${r.minMl} 以上`).join("、或 ");
  return `
  <section class="card aftershock">
    <div class="as-head"><b>最近的較大地震</b><span>${esc(twTime(q.time))}・${esc(ago(q.time))}</span></div>
    <p class="as-quake">規模 ${q.ml.toFixed(1)}・深度 ${Math.round(q.depth_km)} 公里・震央${where.startsWith("離") ? "" : "在"}${esc(where)}</p>
    ${outlookSection(f, q, `<p>挑哪一個地震：資料發布前 ${esc(rule)}的地震中，規模最大的那一個。</p>`)}
    <p class="as-foot">統計機率，不是地震預報；最新消息以中央氣象署為準。<a href="#/expert/more">最近的地震 →</a></p>
  </section>`;
}

// ---------- 全台排行與條件掃描 ----------

const IN_GRID = COUNTIES.filter((c) => !c.outside);
const SCAN_TIMES = TIMES.map(([T]) => T);
const MIN_P_TEXT = `${MIN_P * 100}%`;
const rankCache = new WeakMap<Feed, ScanHit[]>();

/** 全台排行只和資料有關（範圍固定 50 km），同一份資料只算一次（20 個縣市 × 20 組條件） */
export function nationalRank(f: Feed): ScanHit[] {
  let r = rankCache.get(f);
  if (!r) rankCache.set(f, (r = rankPlaces(f, IN_GRID, RANK_RADIUS_KM, MAGS, SCAN_TIMES)));
  return r;
}

/** 排行的一列：名次、名稱與條件、倍數與機率。整列是按鈕，attrs 決定點了之後套用什麼 */
function hitRow(h: ScanHit, n: number, title: string, sub: string, attrs: string): string {
  return `<li><button type="button" class="rk-item ${levelOf(h.ratio).key}" ${attrs}>
    <span class="rk-n">${n}</span>
    <span class="rk-t"><b>${esc(title)}</b><small>${esc(sub)}</small></span>
    <span class="rk-r"><b>${ratioText(h.ratio)}</b><small>現在 ${pct(h.p)}・平常 ${pct(h.pBg)}</small></span>
  </button></li>`;
}

/**
 * 首頁的全台排行：各縣市周圍 50 km，所有規模 × 時間中「現在機率 ≥ 1%」且倍數最高的一組，依倍數排序。
 * 標題寫「倍數最高」，不寫「最危險」。全部都低於「比平常高一些」的門檻時，不列名次（差距很小，排第一沒有意義），
 * 改寫一句「目前全台沒有明顯高於平常的地方」，想看的人可以展開。
 */
export function rankCard(f: Feed): string {
  const rank = nationalRank(f);
  const head = `<div class="rk-head"><b>全台排行：和平常比，倍數最高的地方</b></div>`;
  const cap = `各縣市周圍 ${RANK_RADIUS_KM} 公里，只列現在機率 ${MIN_P_TEXT} 以上的組合，每個縣市取倍數最高的一組`;
  const foot = `<p class="rk-foot">統計機率，不是地震預報。點一項就換成那個地點和條件。</p>`;
  if (!rank.length)
    return `<section class="card rank">${head}<p class="rk-flat">目前沒有任何縣市的機率達到 ${MIN_P_TEXT}，無法排行。</p>${foot}</section>`;
  const rows = rank.map((h, i) =>
    hitRow(h, i + 1, h.place.name, `M${h.m} 以上・${timeLabel(h.T)}內`, `data-rank="${esc(h.place.name)}" data-m="${h.m}" data-t="${h.T}"`),
  );
  if (!(rank[0].ratio >= LEVEL_EDGES[0]))
    return `
  <section class="card rank">${head}
    <p class="rk-flat">目前全台沒有明顯高於平常的地方（最高${ratioText(rank[0].ratio)}）。台灣本來就常有地震，防震準備照常。</p>
    <details class="rk-more" data-fold="rank-flat"><summary>還是想看排序</summary>
      <p class="rk-cap">${cap}。倍數差距很小，排在前面不代表那裡比較危險。</p>
      <ol class="rk-list">${rows.join("")}</ol>
    </details>
    ${foot}
  </section>`;
  return `
  <section class="card rank">${head}
    <p class="rk-cap">${cap}</p>
    <ol class="rk-list">${rows.slice(0, 3).join("")}</ol>
    ${rows.length > 3 ? `<details class="rk-more" data-fold="rank-more"><summary>看前 ${rows.length} 名</summary><ol class="rk-list">${rows.slice(3).join("")}</ol></details>` : ""}
    ${foot}
  </section>`;
}

/** 「幫我找」：目前位置與範圍，所有規模 × 時間掃一遍，依倍數排序；點一項就套用那組規模與時間 */
function scanBlock(s: State): string {
  const c = s.cond, name = placeShort(s.place);
  const hits = scanPlace(s.feed, { name, lat: s.place.lat, lon: s.place.lon }, c.radiusKm, MAGS, SCAN_TIMES).slice(0, 10);
  let body: string;
  if (!assessPoint(s.feed, s.place.lat, s.place.lon, c.radiusKm, c.m, c.T).covered) body = `<p class="rk-flat">目前模型未涵蓋此區域，沒有可以比較的條件。</p>`;
  else if (!hits.length) body = `<p class="rk-flat">沒有任何組合的機率達到 ${MIN_P_TEXT}。範圍很小時常見，可以把範圍調大再試。</p>`;
  else
    body = `${hits[0].ratio >= LEVEL_EDGES[0] ? "" : `<p class="rk-flat">每一組都和平常差不多，排在前面不代表比較危險。</p>`}
      <ol class="rk-list">${hits
        .map((h, i) => hitRow(h, i + 1, `M${h.m} 以上・${timeLabel(h.T)}內`, `周圍 ${h.radiusKm} km`, `data-apply='${JSON.stringify({ m: h.m, T: h.T })}'`))
        .join("")}</ol>`;
  return `
    <details class="scan" data-fold="scan"><summary>🔍 幫我找：${esc(name)}倍數最高的條件</summary>
      <p class="rk-cap">${esc(name)}周圍 ${c.radiusKm} 公里，規模 M${MAGS[0]}–M${MAGS[MAGS.length - 1]} × 時間 ${TIMES[0][1]}–${TIMES[TIMES.length - 1][1]} 全部算一遍，只列現在機率 ${MIN_P_TEXT} 以上的，依倍數排序。點一項就套用。</p>
      ${body}
    </details>`;
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
  ${aftershockCard(f)}
  ${rankCard(f)}

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
      ${scanBlock(s)}
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

// ---------- 我的情境（Phase 4） ----------

/** 情境的一行說明：「高雄市燕巢區・周圍 50 km・3 天內・M5 以上」或「全台・3 天內・M6 以上（打開地圖）」 */
export function favDesc(f: Fav): string {
  return f.kind === "all" || !f.place ? allDesc(f.cond) : `${placeShort(f.place)}・${condText(f.cond)}`;
}
const allDesc = (c: Cond) => `全台・${timeLabel(c.T)}內・M${c.m} 以上（打開地圖）`;

/**
 * 選位置面板最上面的「我的情境」：已存的情境（點了套用、✕ 刪除），以及把目前的位置與條件存起來的表單。
 * 選「全台」或「目前位置」用 radio，切換時不必重畫（重畫會把打到一半的名稱洗掉；main.ts 也會保留草稿）。
 */
function favSection(s: State, favs: Fav[]): string {
  const list = favs.length
    ? `<ul class="fav-list">${favs
        .map((f) => `<li>
          <button type="button" class="fav" data-fav="${esc(f.id)}"><b>${esc(f.name)}</b><small>${esc(favDesc(f))}</small></button>
          <button type="button" class="x fav-del" data-fav-del="${esc(f.id)}" aria-label="刪除「${esc(f.name)}」">✕</button></li>`)
        .join("")}</ul>`
    : `<p class="muted small">還沒有存任何情境。把常看的地點和條件存起來，下次點一下就好。</p>`;
  return `
  <section class="favs">
    <h3>我的情境</h3>
    ${list}
    <details class="fav-add" data-fold="fav-add"><summary>＋ 把目前的位置和條件存起來</summary>
      <label class="fav-field">名稱<input id="fav-name" type="text" maxlength="${FAV_NAME_MAX}" placeholder="${esc(placeShort(s.place))}" autocomplete="off"></label>
      <label class="fav-kind"><input type="radio" name="fav-kind" value="place" checked><span>${esc(`${placeShort(s.place)}・${condText(s.cond)}`)}</span></label>
      <label class="fav-kind"><input type="radio" name="fav-kind" value="all"><span>${esc(allDesc(s.cond))}</span></label>
      <button type="button" class="btn primary wide" data-act="fav-save">儲存</button>
      <p class="muted small" id="fav-msg">只存在這支手機，不會上傳；位置會降低精度（約 1 公里）。名稱一樣的會直接換掉，最多 ${FAV_MAX} 個。</p>
    </details>
  </section>`;
}

export function renderPlaceSheet(s: State, favs: Fav[] = []): string {
  return `
  <div class="sheet-head"><h2>選擇位置</h2><button class="x" data-act="close" aria-label="關閉">✕</button></div>
  ${favSection(s, favs)}
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

// ---------- 條件滑桿（Phase 4） ----------

/** 調整條件面板下方的即時預覽：拖滑桿時就看得到結果（首頁本身被面板蓋住） */
export function condPreview(s: State, c: Cond): string {
  const a = assessPoint(s.feed, s.place.lat, s.place.lon, c.radiusKm, c.m, c.T);
  const head = `<span class="cp-q">${esc(placeShort(s.place))}${esc(condText(c))}</span>`;
  if (!a.covered) return `${head}<span class="cp-a"><b>目前模型未涵蓋此區域</b></span>`;
  const v = isVerified(s.feed, c.m, c.T);
  return `${head}<span class="cp-a">現在 <b>${pct(a.p)}</b>・平常 ${pct(a.pBg)}・<b class="${levelOf(a.ratio).key}">${ratioText(a.ratio)}</b>
    <i class="cp-tag ${v ? "ok" : "ext"}">${v ? "已驗證範圍" : "外推估計"}</i></span>`;
}

export function renderCondSheet(s: State): string {
  const row = (title: string, key: string, opts: [number, string][], cur: number, slider: CondSlider) => `
    <div class="field"><label>${title}</label><div class="seg">
      ${opts.map(([v, l]) => `<button class="${Math.abs(v - cur) < 1e-9 ? "on" : ""}" data-cond="${key}" data-v="${v}">${l}</button>`).join("")}
    </div>${condSliders(s.cond, [slider])}</div>`;
  return `
  <div class="sheet-head"><h2>調整條件</h2><button class="x" data-act="close" aria-label="關閉">✕</button></div>
  ${row("範圍（以你為中心）", "radiusKm", RADII.map((r) => [r, `${r} km`]), s.cond.radiusKm, "radius")}
  ${row("時間", "T", TIMES, s.cond.T, "time")}
  ${row("規模", "m", MAGS.map((m) => [m, `M${m}+`]), s.cond.m, "mag")}
  <p class="cond-preview" id="cond-preview" aria-live="polite">${condPreview(s, s.cond)}</p>
  <p class="muted small">按鈕是常用的值，滑桿可以細調。規模 6.5 以上回測樣本極少，標「外推估計」；範圍很大（例如 200 km）時有一部分在模型網格外，那部分不計入，ⓘ 頁會提醒。</p>
  <button class="btn wide" data-act="reset-cond">回到預設（50 km・3 天・M5）</button>`;
}
