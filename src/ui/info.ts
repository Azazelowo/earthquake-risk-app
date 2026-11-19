// ⓘ 資訊頁：把首頁原本的黃色警示、資料限制、免責說明、設定與授權集中在這裡。
// 首頁只留一個「回測涵蓋／樣本有限／外推估計」的小標籤——提醒放太多，重要的反而沒人看。
import type { State } from "../state";
import { timeLabel } from "../state";
import { assessPoint, backtestTag, nearestBacktest, BACKTEST_TAG_LABEL, reliabilityNotes, undercountAt, FULL_COVERAGE } from "../core/hazard";
import { esc, twTime, ago } from "../format";
import { pwa } from "../pwa";
import { disclaimerPoints } from "./disclaimer";
import { BASEMAPS, cartoKey, hasOwnCartoKey } from "./basemaps";
import { TOWN_TOLERANCE_M } from "../geo/towns";

const REPO_URL = "https://github.com/Azazelowo/earthquake-risk-app";
const MODEL_REPO_URL = "https://github.com/Azazelowo/earthquake-risk-project";

/** 「目前這組條件」的提醒：首頁不顯示，集中在這裡 */
export function conditionNotes(s: State): string[] {
  const f = s.feed, c = s.cond;
  const a = assessPoint(f, s.place.lat, s.place.lon, c.radiusKm, c.m, c.T);
  if (!a.covered) return ["目前模型未涵蓋此區域：模型只涵蓋北緯 21–26°、東經 119–123°，這個位置的範圍大部分在外面。"];
  const notes = reliabilityNotes(f, c.m, c.T);
  if (a.coverage < FULL_COVERAGE)
    notes.push(`你選的範圍約有 ${Math.round((1 - a.coverage) * 100)}% 在模型網格外，那部分沒有計入，機率會偏低。`);
  if (c.radiusKm < f.grid.deg * 111) notes.push(`範圍比模型的一格（約 ${Math.round(f.grid.deg * 111)} km）還小：是把那一格的機率依面積比例分配，不代表模型能分辨這麼細。`);
  const under = undercountAt(f, c.T);
  if (under) notes.push(`最近 ${esc(String(f.data_status.gap_days))} 天是暫時資料（小地震不完整），「現在」的機率可能低估最多約 ${Math.round(under * 100)}%。`);
  return notes;
}

function installSection(): string {
  let body: string;
  if (pwa.standalone) body = `<p>已經安裝，現在就是以 APP 的方式開啟。</p>`;
  else if (pwa.canInstall) body = `<p>可以把這個網頁安裝成手機上的 APP：從主畫面直接開、沒網路時也能看到上次的資料。</p><button class="btn primary" data-act="install">安裝 APP</button>`;
  else if (pwa.ios) body = `<p><b>iPhone／iPad：</b>用 Safari 開啟這個網頁，點下方的「分享」按鈕，再選「加入主畫面」。</p>`;
  else body = `<p><b>Android（Chrome）：</b>點右上角選單「⋮」，選「安裝應用程式」或「加到主畫面」。<br><b>iPhone：</b>用 Safari 開啟，點「分享」→「加入主畫面」。</p>`;
  const built = new Date(__BUILD_TIME__).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const version = `${built} 建置・${__BUILD_COMMIT__}`;
  return `
  ${body}
  <table class="tbl kvt">
    <tr><th>離線使用</th><td>${pwa.offlineReady ? "已就緒：沒網路也能開（地圖底圖除外）" : "尚未就緒（第一次開啟、或瀏覽器不支援）"}</td></tr>
    <tr><th>版本</th><td>${esc(version)}</td></tr>
  </table>
  <div class="row">
    ${pwa.updateWaiting ? `<button class="btn primary" data-act="apply-update">套用新版並重新載入</button>` : `<button class="btn" data-act="check-update">檢查更新</button>`}
    <span class="muted small" role="status">${esc(pwa.updateNote)}</span>
  </div>`;
}

function cartoSection(): string {
  const own = hasOwnCartoKey(), any = !!cartoKey();
  const status = own ? "這支裝置已儲存金鑰。" : any ? "目前使用網站內建的金鑰。" : "尚未設定金鑰，CARTO 底圖無法選用。";
  return `
  <p>CARTO 底圖（Voyager、Positron、Dark Matter）自 2026 年 9 月起需要金鑰。金鑰<b>只存在這支裝置</b>，不會上傳，也不在這個網站的原始碼裡。</p>
  <p class="muted small">提醒：CARTO 的金鑰是放在圖磚網址裡使用的，建議到 CARTO 後台把金鑰限制成只能用在 <code>azazelowo.github.io</code>。免費金鑰申請：<a href="https://www.carto.com/basemaps/apikey/" target="_blank" rel="noopener">carto.com/basemaps/apikey</a></p>
  <div class="row">
    <input class="inp" id="carto-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="貼上 CARTO 金鑰" aria-label="CARTO 金鑰">
    <button class="btn primary" data-act="save-carto">儲存</button>
    ${own ? `<button class="btn" data-act="clear-carto">清除</button>` : ""}
  </div>
  <p class="muted small" id="carto-status" role="status">${status}</p>`;
}

function sourcesSection(s: State): string {
  // 同一家提供者只列一次（OSM 的淡化與深色、國土測繪中心的兩種圖層、CARTO 的三種樣式）
  const providers: [string, string][] = [["osm", "OpenStreetMap"], ["topo", "OpenTopoMap"], ["nlsc", "國土測繪中心（通用電子地圖、正射影像）"], ["carto-voyager", "CARTO（需金鑰）"]];
  const maps = providers
    .map(([id, name]) => `<li><b>${name}</b>：${BASEMAPS.find((b) => b.id === id)!.attribution}</li>`)
    .join("");
  return `
  <p><b>模型與地震資料</b>：${s.feed.mock ? "目前是假資料。接上真資料後的來源為" : "來源為"}中央氣象署地震目錄與有感地震報告、美國地質調查所（USGS）。模型程式在 <a href="${MODEL_REPO_URL}" target="_blank" rel="noopener">earthquake-risk-project</a>。</p>
  <p><b>行政區界線</b>：內政部國土測繪中心 2025「鄉鎮市區界線(TWD97經緯度)」1140318 版，本 APP 已做簡化處理。此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。政府資料開放授權條款：<a href="https://data.gov.tw/license" target="_blank" rel="noopener">https://data.gov.tw/license</a></p>
  <p><b>地圖底圖</b>（依你選的底圖向對方的伺服器取得，各自的授權如下）：</p>
  <ul class="refs">${maps}</ul>
  <p><b>外部連結</b>：ExpTech Studio 地震模擬器只提供連結，資料與畫面屬於原作者。</p>
  <p><b>本 APP 原始碼</b>：<a href="${REPO_URL}" target="_blank" rel="noopener">earthquake-risk-app</a></p>`;
}

export function renderInfo(s: State, backHref: string): string {
  const f = s.feed, c = s.cond;
  const a = assessPoint(f, s.place.lat, s.place.lon, c.radiusKm, c.m, c.T);
  const bt = backtestTag(f, c.m, c.T);
  const near = nearestBacktest(f, c.m, c.T);
  const notes = conditionNotes(s);
  const ds = f.data_status;
  const tag = !a.covered
    ? `<span class="vtag ext">未涵蓋</span>`
    : `<span class="vtag ${bt}">${BACKTEST_TAG_LABEL[bt]}</span>`;
  const tagText = !a.covered ? ""
    : bt === "ok" ? `這組規模與時間在回測涵蓋的範圍內（最接近的回測組有 ${near?.n_events} 個地震）。回測涵蓋不代表機率一定準：AUC 只看分辨能力，校準請看「預測÷實際」。`
    : bt === "thin" ? `這組規模與時間在回測涵蓋的範圍內，但最接近的回測組只有 ${near?.n_events} 個地震，回測結果本身不穩，只能當參考。`
    : "這組條件超出回測涵蓋的範圍（規模太小、太大，或時間超出範圍），數字是模型外推的，只能當量級參考。";

  return `
  <div class="info">
    <a class="back" href="${backHref}">‹ 返回</a>
    <h1 class="info-h">說明與資料狀態</h1>

    <section class="card">
      <h2>目前這組條件 ${tag}</h2>
      <p class="info-cond">${esc(s.place.label)}・周圍 ${c.radiusKm} km・${timeLabel(c.T)}內・M${c.m} 以上</p>
      ${tagText ? `<p>${tagText}</p>` : ""}
      ${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : `<p class="muted">這組條件沒有其他需要提醒的地方。</p>`}
      <a class="link" href="#/expert/verify">看模型怎麼驗證的 →</a>
    </section>

    <section class="card">
      <h2>使用前說明</h2>
      <ul class="notes plain">${disclaimerPoints(f.mock).map((p) => `<li>${p}</li>`).join("")}</ul>
      <button class="btn" data-act="show-disclaimer">再看一次開啟時的說明視窗</button>
    </section>

    <section class="card">
      <h2>資料狀態</h2>
      ${f.mock ? `<p class="note"><b>雛型階段：以下與 APP 內所有數字都是假資料。</b></p>` : ""}
      <table class="tbl kvt">
        <tr><th>模型發布時間</th><td>${twTime(f.issued_at)}（${ago(f.issued_at)}）</td></tr>
        <tr><th>正式目錄到</th><td>${twTime(ds.catalog_end)}</td></tr>
        <tr><th>之後的暫時資料</th><td>${esc(String(ds.gap_days))} 天、${esc(String(ds.n_provisional))} 筆（${esc(ds.sources.join("、"))}）</td></tr>
        <tr><th>可能低估</th><td>${Object.entries(ds.undercount_by_horizon).map(([k, v]) => `${timeLabel(+k)} 最多約 ${Math.round(v * 100)}%`).join("、") || "—"}</td></tr>
        <tr><th>模型範圍</th><td>北緯 ${f.grid.lat_min}–${f.grid.lat_max}°、東經 ${f.grid.lon_min}–${f.grid.lon_max}°，每格 ${f.grid.deg}°（約 ${Math.round(f.grid.deg * 111)} km）</td></tr>
      </table>
    </section>

    <section class="card">
      <h2>位置與隱私</h2>
      <ul class="notes plain">
        <li><b>定位只在這支手機上計算。</b>「你在哪個鄉鎮區」是用 APP 內建的界線檔在手機上判斷，不會查詢任何伺服器。</li>
        <li><b>存在手機裡的位置會降低精度</b>（約 1 公里），而且只存在這支手機，清除瀏覽器資料就會消失。</li>
        <li><b>「我的情境」也只存在這支手機</b>，不會上傳；裡面的位置同樣降低精度，用 GPS 定位存的會變成固定的點，下次開 APP 不會被自動定位換掉。</li>
        <li><b>分享連結</b>：選縣市的位置只放縣市名稱、地圖上點的位置放約 1 公里精度的座標；<b>用 GPS 定位的位置預設不附</b>，要自己勾選。APP 不會自己把連結傳出去，要傳給誰由你決定。收到的連結只會套用範圍內的數字，連結裡的文字不會出現在畫面上。</li>
        <li><b>鄉鎮區界線有簡化</b>，和原始界線最多差 ${TOWN_TOLERANCE_M} 公尺。離交界太近、或定位誤差太大時，只會顯示「XX區附近」。</li>
        <li><b>看地圖時，底圖是向地圖服務的伺服器取得的</b>，對方會知道你瀏覽了哪一塊地圖（不是你的精確位置）。不想這樣可以不開地圖頁，首頁不受影響。</li>
        <li>這個 APP 沒有帳號、沒有廣告、不做使用追蹤。</li>
      </ul>
    </section>

    <section class="card" id="install">
      <h2>安裝與更新</h2>
      ${installSection()}
    </section>

    <section class="card" id="carto">
      <h2>底圖設定：CARTO 金鑰</h2>
      ${cartoSection()}
    </section>

    <section class="card">
      <h2>資料來源與授權</h2>
      ${sourcesSection(s)}
    </section>
  </div>`;
}
