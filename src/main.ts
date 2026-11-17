// 進入點：hash 路由（GitHub Pages 不必設定伺服器轉址）、事件委派、定位、PWA。
//
// 畫面的更新方式很單純：狀態（s）一變就整頁重畫。為了不讓「整頁重畫」打斷使用者，render() 會保留
// 展開中的摺疊區、輸入到一半的文字與鍵盤焦點；地圖則由 ui/map.ts 自己留著，不跟著重建。
import "./style.css";
import { makeMockFeed } from "./data/mock";
import type { State, Cond, Place } from "./state";
import { COUNTIES, DEFAULT_COND, RADIUS_MIN, RADIUS_MAX, loadSaved, save, nearestCounty } from "./state";
import { distText } from "./format";
import { renderPublic, renderPlaceSheet, renderCondSheet } from "./ui/public";
import { renderExpert, renderTabbar, renderLayersSheet, pickNumbers, type ExpertTab } from "./ui/expert";
import { renderInfo } from "./ui/info";
import { mountMap, detachMap, setRadiusLive, focusCircle } from "./ui/map";
import { showDisclaimer } from "./ui/disclaimer";
import { DEFAULT_BASEMAP, setCartoKey } from "./ui/basemaps";
import { loadTowns, describePlace } from "./geo/towns";
import { initPwa, promptInstall, checkUpdate, applyUpdate } from "./pwa";

const saved = loadSaved();
const fallback = COUNTIES.find((c) => c.name === "高雄市")!;
const s: State = {
  feed: makeMockFeed(),
  place: saved.place ?? { lat: fallback.lat, lon: fallback.lon, label: "高雄市", source: "default" },
  cond: saved.cond ?? { ...DEFAULT_COND },
  locate: "idle",
  mapLayer: saved.mapLayer ?? "ratio",
  scope: "point",
  basemap: saved.basemap ?? DEFAULT_BASEMAP,
  smooth: saved.smooth ?? 0,
  mapFull: false,
};
let sheet: "" | "place" | "cond" | "layers" = "";
/** ⓘ 頁按「返回」要回到的畫面 */
let lastMain = "#/";
/** 換頁後要捲到的區塊（例如從地圖設定跳到 ⓘ 頁的金鑰設定） */
let pendingScroll = "";
let renderedHash: string | null = null;

const INSTALL_HINT_KEY = "eqrisk.installHint";
const flag = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 存不了就算了 */
    }
  },
};
let installHint = flag.get(INSTALL_HINT_KEY) !== "off";

const app = document.getElementById("app")!;

type Route = { mode: "public" } | { mode: "info" } | { mode: "expert"; tab: ExpertTab };
function route(): Route {
  if (/^#\/info/.test(location.hash)) return { mode: "info" };
  const m = location.hash.match(/^#\/expert\/(map|mag|time|verify|more)/);
  return m ? { mode: "expert", tab: m[1] as ExpertTab } : { mode: "public" };
}

const INFO_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.4v.2"/></svg>`;

function render() {
  const r = route();
  const expert = r.mode === "expert", info = r.mode === "info";
  const onMap = expert && r.tab === "map";
  if (!onMap) s.mapFull = false;

  // 重畫前先記下「使用者正在用的東西」，重畫後還原
  const samePage = renderedHash === location.hash;
  const folds = samePage ? [...app.querySelectorAll("details")].map((d) => d.open) : [];
  const active = document.activeElement as HTMLElement | null;
  const focusSel = !active || !app.contains(active) ? "" : active.id ? `#${active.id}` : active.dataset.range ? `[data-range="${active.dataset.range}"]` : "";
  const keyDraft = samePage ? (document.getElementById("carto-key") as HTMLInputElement | null)?.value ?? "" : "";

  detachMap();
  document.documentElement.classList.toggle("map-full", s.mapFull);
  const body = info ? renderInfo(s, lastMain) : expert ? renderExpert(s, r.tab) : renderPublic(s, { installHint });
  app.innerHTML = `
  <header class="top">
    <a class="brand" href="#/"><img src="./icon.svg" alt=""><span>臺灣地震風險評估</span></a>
    <div class="top-r">
      <a class="ibtn ${info ? "on" : ""}" href="${info ? lastMain : "#/info"}" aria-label="說明、資料狀態與設定" title="說明、資料狀態與設定">${INFO_ICON}</a>
      <div class="mode seg">
        <a href="#/" class="${r.mode === "public" ? "on" : ""}">大眾</a>
        <a href="#/expert/${expert ? r.tab : "map"}" class="${expert ? "on" : ""}">專家</a>
      </div>
    </div>
  </header>
  ${s.feed.mock ? `<div class="mockbar">雛型：所有數字都是假資料，只用來試操作</div>` : ""}
  <main class="${expert ? "with-tabbar" : ""}">${body}</main>
  ${expert ? renderTabbar(r.tab) : `<footer class="foot">高科大地震風險評估實務專題・不是地震預報</footer>`}
  <div class="scrim ${sheet ? "show" : ""}" data-act="close"></div>
  <div class="sheet ${sheet ? "show" : ""}">${sheet === "place" ? renderPlaceSheet(s) : sheet === "cond" ? renderCondSheet(s) : sheet === "layers" ? renderLayersSheet(s) : ""}</div>`;
  renderedHash = location.hash;

  if (onMap) mountMap(s, { onPick: pickOnMap });
  app.querySelectorAll("details").forEach((d, i) => {
    if (folds[i]) d.open = true;
  });
  const keyEl = document.getElementById("carto-key") as HTMLInputElement | null;
  if (keyEl && keyDraft) keyEl.value = keyDraft;
  if (focusSel) app.querySelector<HTMLElement>(focusSel)?.focus({ preventScroll: true });
}

// ---------- 位置 ----------

/**
 * 把經緯度換成「XX市XX區」。界線檔在手機上判斷（geo/towns.ts），不會把位置送出去。
 * 界線檔要另外下載（約 300 KB），所以先顯示暫時的文字，判斷完再更新。
 */
async function resolveLabel(p: Place) {
  const accText = p.accuracyM ? `定位誤差${distText(p.accuracyM)}` : "";
  let label: string, detail: string;
  try {
    const text = describePlace(await loadTowns(), p.lat, p.lon, p.accuracyM);
    label = text.label;
    detail = text.detail;
  } catch {
    // 界線檔載不到（例如第一次開啟就離線）：退回「最近的縣市」這種粗略說法
    const inTaiwanBox = p.lat > 21.5 && p.lat < 26.5 && p.lon > 118 && p.lon < 122.5;
    label = inTaiwanBox ? `${nearestCounty(p.lat, p.lon)}附近` : p.source === "gps" ? "目前位置" : "地圖選點";
    detail = accText;
  }
  if (s.place !== p) return; // 等待期間使用者已經換了位置
  if (p.source === "map") detail = detail ? `地圖選點・${detail}` : "地圖選點";
  s.place = { ...p, label, detail };
  save(s);
  render();
}

/**
 * fresh：使用者自己按了「使用目前位置」，要重新定位，不拿瀏覽器暫存的舊位置；
 * 開啟時的自動定位則允許用 10 分鐘內的暫存位置（比較快，而且模型一格約 20 公里，不差這一點）。
 */
function locate(opt: { focusMap?: boolean; fresh?: boolean } = {}) {
  if (!("geolocation" in navigator)) {
    s.locate = "denied";
    return render();
  }
  s.locate = "pending";
  render();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      const place: Place = { lat, lon, label: "目前位置", detail: "正在判斷鄉鎮區…", source: "gps", accuracyM: accuracy };
      s.place = place;
      s.locate = "ok";
      save(s);
      render();
      if (opt.focusMap) focusCircle(lat, lon, s.cond.radiusKm);
      void resolveLabel(place);
    },
    () => {
      s.locate = "denied";
      render();
    },
    // 不要求高精度：模型一格約 20 公里，不需要公尺級定位；也比較省電、比較快
    { enableHighAccuracy: false, timeout: 8000, maximumAge: opt.fresh ? 0 : 10 * 60e3 },
  );
}

/** 在地圖上點了一個位置：把它當成新的圓心 */
function pickOnMap(lat: number, lon: number) {
  const place: Place = { lat, lon, label: "地圖選點", detail: "正在判斷鄉鎮區…", source: "map" };
  s.place = place;
  s.locate = "idle";
  save(s);
  render();
  void resolveLabel(place);
}

// ---------- 事件 ----------

const clampRadius = (v: number) => Math.min(Math.max(Math.round(v), RADIUS_MIN), RADIUS_MAX);

app.addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>(
    "[data-act],[data-county],[data-cond],[data-scope],[data-layer],[data-apply],[data-basemap],[data-smooth]",
  );
  if (!t) return;
  const d = t.dataset;
  if (d.act === "pick-place") sheet = "place";
  else if (d.act === "edit-cond") sheet = "cond";
  else if (d.act === "layers") sheet = "layers";
  else if (d.act === "close") sheet = "";
  else if (d.act === "locate") return (sheet = ""), locate({ fresh: true });
  else if (d.act === "map-locate") return (sheet = ""), locate({ focusMap: true, fresh: true });
  else if (d.act === "map-full") s.mapFull = !s.mapFull;
  else if (d.act === "reset-cond") s.cond = { ...DEFAULT_COND };
  else if (d.act === "download") return download();
  else if (d.act === "show-disclaimer") return void showDisclaimer(s.feed.mock, true);
  else if (d.act === "install") return void promptInstall();
  else if (d.act === "check-update") return void checkUpdate();
  else if (d.act === "apply-update") return applyUpdate();
  else if (d.act === "dismiss-install") (installHint = false), flag.set(INSTALL_HINT_KEY, "off");
  else if (d.act === "need-carto") {
    // CARTO 底圖還沒有金鑰：帶去 ⓘ 頁的設定區
    sheet = "";
    pendingScroll = "carto";
    location.hash = "#/info";
    return;
  } else if (d.act === "save-carto" || d.act === "clear-carto") {
    const input = document.getElementById("carto-key") as HTMLInputElement | null;
    const typed = input?.value.trim() ?? "";
    // 按「儲存」但沒填、或格式不對：不動已經存好的金鑰，只提示
    const ok = d.act === "clear-carto" ? setCartoKey("") : typed !== "" && setCartoKey(typed);
    if (!ok) {
      const status = document.getElementById("carto-status");
      if (status) status.textContent = "這看起來不像 CARTO 金鑰（應該是一串英數字，沒有空白）。沒有儲存。";
      return;
    }
    if (input) input.value = "";
  } else if (d.county) {
    const c = COUNTIES.find((x) => x.name === d.county)!;
    s.place = { lat: c.lat, lon: c.lon, label: c.name, source: "county" };
    s.locate = "idle";
    sheet = "";
  } else if (d.cond) s.cond = { ...s.cond, [d.cond as keyof Cond]: +d.v! };
  else if (d.scope) s.scope = d.scope as State["scope"];
  else if (d.layer) s.mapLayer = d.layer as State["mapLayer"];
  else if (d.basemap) s.basemap = d.basemap;
  else if (d.smooth) s.smooth = +d.smooth;
  else if (d.apply) {
    if (d.goto) return void (location.hash = d.goto);
    s.cond = { ...s.cond, ...JSON.parse(d.apply) };
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  save(s);
  render();
});

// 半徑滑桿：拖的時候只更新圓與數字（input），放開才存檔並重畫（change）
app.addEventListener("input", (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.dataset?.range !== "radius") return;
  const km = clampRadius(+t.value);
  setRadiusLive(km);
  const out = document.getElementById("radius-out");
  if (out) out.textContent = `${km} km`;
  const nums = document.getElementById("pick-nums");
  if (nums) nums.innerHTML = pickNumbers(s, km);
});
app.addEventListener("change", (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.dataset?.range !== "radius") return;
  s.cond = { ...s.cond, radiusKm: clampRadius(+t.value) };
  save(s);
  render();
});

document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (sheet) sheet = "";
  else if (s.mapFull) s.mapFull = false;
  else return;
  render();
});

function download() {
  const blob = new Blob([JSON.stringify(s.feed)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "feed.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

window.addEventListener("hashchange", () => {
  sheet = "";
  if (route().mode !== "info") lastMain = location.hash || "#/";
  render();
  const target = pendingScroll && document.getElementById(pendingScroll);
  pendingScroll = "";
  if (target) target.scrollIntoView({ block: "start" });
  else window.scrollTo(0, 0);
});
// 連線狀態改變時更新地圖上的提示（離線時沒有底圖）
for (const type of ["online", "offline"]) window.addEventListener(type, () => render());

// ---------- 啟動 ----------

if (route().mode !== "info") lastMain = location.hash || "#/";
render();
// PWA 狀態（可安裝、離線就緒、有新版）只影響首頁的安裝提示與 ⓘ 頁；專家頁不必為此重畫
initPwa(() => {
  if (route().mode !== "expert") render();
});
// 先看完使用前說明再要求定位，避免說明視窗和瀏覽器的定位詢問同時跳出來。
// 第一次開、或上次用 GPS：自動定位；使用者選過縣市或地圖選點就尊重他的選擇。
void showDisclaimer(s.feed.mock).then(() => {
  if (!saved.place || saved.place.source === "gps") locate();
});
