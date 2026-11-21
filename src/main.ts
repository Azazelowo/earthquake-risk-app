// 進入點：hash 路由（GitHub Pages 不必設定伺服器轉址）、事件委派、定位、PWA。
//
// 畫面的更新方式很單純：狀態（s）一變就整頁重畫。為了不讓「整頁重畫」打斷使用者，render() 會保留
// 展開中的摺疊區、輸入到一半的文字與鍵盤焦點；地圖則由 ui/map.ts 自己留著，不跟著重建。
import "./style.css";
import { makeMockFeed } from "./data/mock";
import { cachedFeed, loadFeed, staleHours } from "./data/feed";
import { findSnapshot, loadHistoryFeed, loadHistoryIndex } from "./data/history";
import { historyBanner, renderHistory, type HistoryView } from "./ui/history";
import { fetchQuakes, type Quake } from "./data/exptech";
import type { State, Cond, Place } from "./state";
import { COUNTIES, DEFAULT_COND, RADIUS_MIN, RADIUS_MAX, loadSaved, save, nearestCounty, placeShort, sliderCond, type CondSlider } from "./state";
import { sliderText } from "./ui/sliders";
import { loadFavs, makeFav, removeFav, storeFavs, upsertFav, FAV_MAX, type Fav } from "./favs";
import { evaluateRule, runNotify, type RuleReport } from "./notify/engine";
import { diagnose, inAppBrowserUA, notifySupport, requestPermissionTracked, showNotice } from "./notify/platform";
import {
  loadRules, loadState, makeRule, pruneForFavs, pruneState, removeRule, storeRules, storeState, upsertRule, validThreshold,
  type Rule, type RuleKind,
} from "./notify/rules";
import { NOTIFY_INPUT_IDS, renderNotifyCard } from "./ui/notify";
import { distText, esc, twTime } from "./format";
import { renderPublic, renderPlaceSheet, renderCondSheet, renderShareSheet, condPreview, condText } from "./ui/public";
import { buildShareUrl, parseShare, shareLocationByDefault, type SharedView } from "./share";
import { renderExpert, renderTabbar, renderLayersSheet, renderQuakeSheet, recentCard, pickNumbers, type ExpertTab } from "./ui/expert";
import { renderInfo } from "./ui/info";
import { mountMap, detachMap, setRadiusLive, focusCircle } from "./ui/map";
import { showDisclaimer } from "./ui/disclaimer";
import { DEFAULT_BASEMAP, setCartoKey } from "./ui/basemaps";
import { loadTowns, loadedTowns, describePlace } from "./geo/towns";
import { pickMainshock } from "./core/aftershock";
import { RANK_RADIUS_KM } from "./core/scan";
import { initPwa, promptInstall, checkUpdate, applyUpdate } from "./pwa";

const saved = loadSaved();
// 先用上次成功下載的資料畫出畫面（沒有就用假資料），同時在背景下載最新的 feed
const cached = cachedFeed();
const fallback = COUNTIES.find((c) => c.name === "高雄市")!;
const s: State = {
  feed: cached ?? makeMockFeed(),
  place: saved.place ?? { lat: fallback.lat, lon: fallback.lon, label: "高雄市", source: "default" },
  cond: saved.cond ?? { ...DEFAULT_COND },
  locate: "idle",
  mapLayer: saved.mapLayer ?? "ratio",
  scope: "point",
  basemap: saved.basemap ?? DEFAULT_BASEMAP,
  smooth: saved.smooth ?? 0,
  mapFull: false,
  feedStatus: { origin: "loading", error: null },
};
let sheet: "" | "place" | "cond" | "layers" | "quake" | "share" = "";
/** 分享面板的「附上位置」（打開面板時依位置來源決定預設：GPS 不勾） */
let shareLoc = false;
/** 用分享連結打開後首頁的提醒：place＝位置和條件都是分享的；cond＝只有條件 */
let sharedKind: "" | "place" | "cond" = "";
/** 地震列表點開的那一筆（sheet＝quake 時用） */
let sheetQuake: Quake | null = null;
/** 歷史回放頁的清單（第一次打開 #/history 才下載） */
let historyView: HistoryView = { status: "idle" };
/** 我的情境（只存在這支手機） */
let favs: Fav[] = loadFavs();
/** 通知規則與各規則的狀態（只存在這支手機）；ntMsg 是設定畫面上的操作結果提示 */
let notifyRules: Rule[] = loadRules();
let notifyState = loadState();
let ntMsg = "";
/** 「允許通知」的結果提示，顯示在按鈕正下方（使用者按下去時眼睛就在那裡） */
let permMsg = "";
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

type Route = { mode: "public" } | { mode: "info" } | { mode: "history" } | { mode: "expert"; tab: ExpertTab };
function route(): Route {
  if (/^#\/info/.test(location.hash)) return { mode: "info" };
  if (/^#\/history/.test(location.hash)) return { mode: "history" };
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
  const openFolds = new Set(samePage ? [...app.querySelectorAll("details")].filter((d) => d.open).map(foldKey) : []);
  const active = document.activeElement as HTMLElement | null;
  const focusSel = !active || !app.contains(active) ? "" : active.id ? `#${active.id}` : active.dataset.range ? `[data-range="${active.dataset.range}"]` : "";
  // 打到一半的文字（CARTO 金鑰、情境名稱）與情境的「目前位置／全台」選項
  const drafts = samePage ? DRAFT_IDS.map((id) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "") : [];
  const favKind = samePage ? (document.querySelector('input[name="fav-kind"]:checked') as HTMLInputElement | null)?.value : undefined;

  detachMap();
  document.documentElement.classList.toggle("map-full", s.mapFull);
  if (r.mode === "history" && historyView.status === "idle") void openHistoryIndex();
  const body = safely(() =>
    info ? renderInfo(s, lastMain, renderNotifyCard(notifyView()))
    : r.mode === "history" ? renderHistory(s, historyView)
    : expert ? renderExpert(s, r.tab)
    : renderPublic(s, { installHint, shared: sharedKind }),
  );
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
  ${feedBar()}
  <main class="${expert ? "with-tabbar" : ""}">${body}</main>
  ${expert ? renderTabbar(r.tab) : `<footer class="foot">高科大地震風險評估實務專題・不是地震預報</footer>`}
  <div class="scrim ${sheet ? "show" : ""}" data-act="close"></div>
  <div class="sheet ${sheet ? "show" : ""}">${sheetHtml()}</div>`;
  renderedHash = location.hash;

  if (onMap) safely(() => mountMap(s, { onPick: pickOnMap }));
  app.querySelectorAll("details").forEach((d) => {
    if (openFolds.has(foldKey(d))) d.open = true;
  });
  DRAFT_IDS.forEach((id, i) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el && drafts[i]) el.value = drafts[i];
  });
  if (favKind === "all" || favKind === "place") {
    const radio = document.querySelector<HTMLInputElement>(`input[name="fav-kind"][value="${favKind}"]`);
    if (radio) radio.checked = true;
  }
  if (focusSel) app.querySelector<HTMLElement>(focusSel)?.focus({ preventScroll: true });
}

/** 重畫時要保留內容的輸入框 */
const DRAFT_IDS = ["carto-key", "fav-name", ...NOTIFY_INPUT_IDS];

/** 把目前的位置與條件存成情境（只存在這支手機） */
function saveFav() {
  const nameEl = document.getElementById("fav-name") as HTMLInputElement | null;
  const kind = document.querySelector<HTMLInputElement>('input[name="fav-kind"]:checked')?.value === "all" ? "all" : "place";
  const msg = document.getElementById("fav-msg");
  const next = upsertFav(favs, makeFav(nameEl?.value ?? "", kind, s.place, s.cond));
  if (!next) {
    if (msg) msg.textContent = `已經存了 ${FAV_MAX} 個，先刪掉一個再存（名稱一樣的會直接換掉）。`;
    return;
  }
  if (!storeFavs(next)) {
    if (msg) msg.textContent = "這個瀏覽器沒辦法存資料（可能是無痕模式），情境沒有存起來。";
    return;
  }
  favs = next;
  if (nameEl) nameEl.value = "";
  // 存好就把表單收起來，新的情境出現在上面的清單
  const form = document.querySelector<HTMLDetailsElement>("details.fav-add");
  if (form) form.open = false;
  render();
}

/** 底部面板的內容；出錯時顯示錯誤卡片，不讓整頁壞掉 */
function sheetHtml(): string {
  return safely(() =>
    sheet === "place" ? renderPlaceSheet(s, favs)
    : sheet === "cond" ? renderCondSheet(s)
    : sheet === "layers" ? renderLayersSheet(s)
    : sheet === "quake" && sheetQuake ? renderQuakeSheet(s, sheetQuake)
    : sheet === "share" ? renderShareSheet(s, shareBase(), shareLoc, canShare())
    : "",
  );
}

/**
 * 摺疊區的識別：data-fold，沒有就用標題文字。不能用順序對應——餘震卡這類區塊會依資料出現或消失，
 * 順序一變，展開的就會變成別的區塊。
 */
function foldKey(d: HTMLDetailsElement): string {
  return d.dataset.fold ?? d.querySelector("summary")?.textContent ?? "";
}

/**
 * 畫面程式出錯時不要整頁空白（審查 H3）：顯示錯誤卡片，標題列、模式切換、ⓘ 頁仍然可以用。
 * 常見原因是資料和程式版本不合；重新整理通常就會取得一致的版本。
 */
function safely<T>(fn: () => T): T | string {
  try {
    return fn();
  } catch (e) {
    console.error(e);
    return `<div class="card errcard" role="alert"><b>這個畫面暫時無法顯示</b>
      <p>可能是資料和程式版本不一致。請重新整理；如果一直出現，請到 ⓘ 頁查看資料狀態。這不代表地震風險有變化。</p>
      <p class="muted small">${esc((e instanceof Error ? e.message : String(e)).slice(0, 200))}</p>
      <button class="btn" type="button" data-act="reload">重新整理</button></div>`;
  }
}

/** 畫面最上方的資料狀態提示：假資料、離線、過期都要讓人一眼看到（審查 S-12、NFR-R4） */
function feedBar(): string {
  // 歷史回放中：只顯示回放的提示（資料本來就是過去的，不算過期）
  if (s.history) return historyBanner(s);
  const st = s.feedStatus, f = s.feed;
  if (f.mock && st?.origin === "loading") return `<div class="mockbar">正在取得最新資料…</div>`;
  if (f.mock && st?.origin === "mock")
    return `<div class="mockbar">無法取得模型資料（${esc(st.error ?? "原因不明")}）：以下是示意用假資料，不是真實機率</div>`;
  if (f.mock) return `<div class="mockbar">雛型：所有數字都是假資料，只用來試操作</div>`;
  const h = staleHours(f);
  if (st?.origin === "cache")
    return `<div class="mockbar">${h ? "資料已過期・" : ""}目前顯示上次取得的資料（${twTime(f.issued_at)} 發布）${st.error ? `：${esc(st.error)}` : ""}</div>`;
  if (h) return `<div class="mockbar">資料已 ${h < 48 ? `${Math.round(h)} 小時` : `${Math.round(h / 24)} 天`}沒有更新（最後發布 ${twTime(f.issued_at)}），數字可能過時</div>`;
  return "";
}

/** 即時地震列表（ExpTech）；失敗時保留上次的列表 */
async function refreshQuakes() {
  try {
    const list = await fetchQuakes();
    s.quakes = { status: "ok", list, error: null, at: Date.now() };
  } catch (e) {
    const prev = s.quakes;
    s.quakes = { status: "error", list: prev?.list ?? [], error: e instanceof Error && e.name !== "TypeError" ? e.message : "無法連線", at: prev?.at ?? null };
  }
  // 只有正在看列表時才更新，而且只換列表這一塊（審查 E4）：不打斷其他畫面的操作，也不關掉開著的面板
  if (!location.hash.startsWith("#/expert/more")) return;
  const box = document.getElementById("recent-quakes");
  if (box) box.outerHTML = String(safely(() => recentCard(s)));
  else render();
}

/** 下載最新資料後重畫；失敗時 loadFeed 會退回上次的資料或假資料 */
async function refreshFeed() {
  // 歷史回放中不換資料（回到現在時會重新抓）
  if (s.history) return;
  const r = await loadFeed();
  // 畫面上已經有這次開啟時下載到的資料，這次失敗就保留它，不要換成更舊的快取或假資料
  if (r.origin !== "network" && s.feedStatus?.origin === "network") return;
  s.feed = r.feed;
  s.feedStatus = { origin: r.origin, error: r.error };
  render();
  nameEpicenter();
  void evaluateNotifications();
}

// ---------- 通知（規則引擎在 src/notify/；這裡只負責接線）----------

function notifyView() {
  const now = Date.now();
  // 每次畫面重畫都重新評估一次（很輕：最多 12 條規則），設定畫面才看得到「現在會不會觸發」
  const reports: Record<string, RuleReport> = {};
  for (const rule of notifyRules) {
    const fav = favs.find((f) => f.id === rule.favId);
    reports[rule.id] = { rule, evaluation: evaluateRule(rule, fav, s.feed, now), fired: false, failed: false };
  }
  return { favs, rules: notifyRules, reports, support: notifySupport(), message: ntMsg, permMessage: permMsg, diag: diagnose() };
}

/** 資料更新後評估所有規則並送出該送的通知。只在拿到網路上的真資料時做（快取或假資料不通知）。 */
async function evaluateNotifications() {
  if (!notifyRules.length || s.feedStatus?.origin !== "network" || s.history) return;
  const res = await runNotify(s.feed, favs, notifyRules, notifyState, { now: Date.now(), show: showNotice });
  notifyState = pruneState(res.state, notifyRules);
  storeState(notifyState);
  if (res.reports.some((r) => r.fired) && route().mode === "info") render();
}

async function allowNotifications() {
  permMsg = "已送出要求，正在等你回應。請看畫面上方、網址列旁或下方有沒有跳出權限視窗。";
  render();
  const p = await requestPermissionTracked(() => {
    permMsg = "還沒收到回應。權限視窗可能被收成網址列旁的小圖示，或被這個瀏覽器擋掉；也可以到瀏覽器的「網站設定」手動允許通知。";
    render();
  });
  permMsg =
    p === "granted" ? "已允許通知。可以按下面的「送一則測試通知」確認。"
    : p === "denied" ? "通知被封鎖了；要重新開啟請到瀏覽器或手機的網站設定。"
    : p === "unsupported" ? "這個瀏覽器不支援網頁通知。"
    : "沒有允許（視窗被關掉或沒有回應）。再按一次試試；若一直沒有視窗，請到網站設定檢查。";
  if (inAppBrowserUA(navigator.userAgent)) permMsg += " 你可能在 LINE、Facebook 等內建瀏覽器裡，這類環境通常不支援通知，請改用 Chrome 開啟。";
  render();
}

async function testNotification() {
  const ok = await showNotice({
    title: "測試通知",
    body: "看到這則，表示這支裝置可以顯示通知。這只是測試，不是地震預警。",
    tag: "eqrisk-test",
  });
  ntMsg = ok ? "已送出測試通知。" : "沒有送出：請先允許通知。";
  render();
}

function addNotifyRule() {
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
  const kind = val("nt-kind") as RuleKind;
  const favId = val("nt-fav");
  const raw = kind === "level" ? +val("nt-level") : kind === "prob" ? +val("nt-prob") / 100 : +val("nt-ml");
  const minRatio = kind === "prob" && val("nt-ratio").trim() !== "" ? +val("nt-ratio") : 0;
  if (!favs.some((f) => f.id === favId) || !validThreshold(kind, raw) || !Number.isFinite(minRatio) || minRatio < 0) {
    ntMsg = "門檻不在可用的範圍內（機率 0.01%–90%，規模 ML 3–8），沒有新增。";
    return render();
  }
  const rule = makeRule(favId, kind, raw, minRatio);
  const next = rule && upsertRule(notifyRules, rule);
  if (!next) ntMsg = "規則已經滿了，先刪掉一條再新增。";
  else if (!storeRules(next)) ntMsg = "存不了（可能是無痕模式或儲存空間已滿），沒有新增。";
  else {
    notifyRules = next;
    ntMsg = "已新增。建立當下已經達標的條件與已經存在的地震報告不會馬上通知，只記下現況。";
  }
  render();
}

function changeNotifyRule(id: string, action: "toggle" | "delete") {
  const rule = notifyRules.find((r) => r.id === id);
  if (!rule) return;
  if (action === "delete") {
    notifyRules = removeRule(notifyRules, id);
    notifyState = pruneState(notifyState, notifyRules);
    storeState(notifyState);
  } else {
    notifyRules = notifyRules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
    // 重新啟用視同新建立：停用期間的變化不補通知，所以清掉狀態、下次評估只記下現況
    if (!rule.enabled) {
      notifyState = pruneState(notifyState, notifyRules.filter((r) => r.id !== id));
      storeState(notifyState);
    }
  }
  storeRules(notifyRules);
  render();
}

/**
 * 首頁的餘震卡要講震央在哪個鄉鎮區：界線檔還沒載入就先載，載好再重畫首頁。
 * 判斷在手機上做（geo/towns.ts），不會把任何位置送出去。
 */
function nameEpicenter() {
  if (loadedTowns() || !pickMainshock(s.feed)) return;
  loadTowns().then(
    () => route().mode === "public" && render(),
    () => {
      /* 載不到就繼續顯示座標 */
    },
  );
}

// ---------- 位置 ----------

/**
 * 把經緯度換成「XX市XX區」。界線檔在手機上判斷（geo/towns.ts），不會把位置送出去。
 * 界線檔要另外下載（約 300 KB），所以先顯示暫時的文字，判斷完再更新。
 */
async function resolveLabel(p: Place, note = "地圖選點") {
  const accText = p.accuracyM ? `定位誤差${distText(p.accuracyM)}` : "";
  let label: string, detail: string;
  try {
    const text = describePlace(await loadTowns(), p.lat, p.lon, p.accuracyM);
    label = text.label;
    detail = text.detail;
  } catch {
    // 界線檔載不到（例如第一次開啟就離線）：退回「最近的縣市」這種粗略說法
    const inTaiwanBox = p.lat > 21.5 && p.lat < 26.5 && p.lon > 118 && p.lon < 122.5;
    label = inTaiwanBox ? `${nearestCounty(p.lat, p.lon)}附近` : p.source === "gps" ? "目前位置" : note;
    detail = accText;
  }
  if (s.place !== p) return; // 等待期間使用者已經換了位置
  if (p.source === "map") detail = detail ? `${note}・${detail}` : note;
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
    "[data-act],[data-county],[data-cond],[data-scope],[data-layer],[data-apply],[data-rank],[data-quake],[data-fav],[data-fav-del],[data-history],[data-basemap],[data-smooth],[data-nt-toggle],[data-nt-del]",
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
  else if (d.act === "fav-save") return saveFav();
  else if (d.act === "share") (shareLoc = shareLocationByDefault(s.place)), (sheet = "share");
  else if (d.act === "share-go") return void shareNow();
  else if (d.act === "share-copy") return void copyLink();
  else if (d.act === "dismiss-shared") sharedKind = "";
  else if (d.act === "history-exit") return exitHistory();
  else if (d.act === "history-retry") return (historyView = { status: "idle" }), render();
  else if (d.act === "reload") return location.reload();
  else if (d.act === "show-disclaimer") return void showDisclaimer(s.feed.mock, true);
  else if (d.act === "install") return void promptInstall();
  else if (d.act === "check-update") return void checkUpdate();
  else if (d.act === "apply-update") return applyUpdate();
  else if (d.act === "nt-allow") return void allowNotifications();
  else if (d.act === "nt-test") return void testNotification();
  else if (d.act === "nt-add") return addNotifyRule();
  else if (d.ntToggle || d.ntDel) return changeNotifyRule(d.ntToggle ?? d.ntDel!, d.ntToggle ? "toggle" : "delete");
  else if (d.act === "dismiss-install") (installHint = false), flag.set(INSTALL_HINT_KEY, "off");
  else if (d.act === "glossary") {
    // 名詞解釋在 ⓘ 頁；已經在 ⓘ 頁時 hash 不會變，直接捲過去
    sheet = "";
    if (location.hash === "#/info") return void document.getElementById("glossary")?.scrollIntoView({ block: "start" });
    pendingScroll = "glossary";
    location.hash = "#/info";
    return;
  } else if (d.act === "need-carto") {
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
  } else if (d.rank) {
    // 全台排行的一項：換成那個縣市（周圍 50 km）和那組規模、時間
    const c = COUNTIES.find((x) => x.name === d.rank && !x.outside);
    if (!c) return;
    s.place = { lat: c.lat, lon: c.lon, label: c.name, source: "county" };
    s.locate = "idle";
    s.cond = { radiusKm: RANK_RADIUS_KM, m: +d.m!, T: +d.t! };
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (d.quake) {
    // 地震列表的一筆：打開面板看震央附近之後再發生地震的機率
    const q = s.quakes?.list.find((x) => x.id === d.quake);
    if (!q) return;
    sheetQuake = q;
    sheet = "quake";
  } else if (d.history) {
    return void enterHistory(d.history);
  } else if (d.favDel) {
    const f = favs.find((x) => x.id === d.favDel);
    if (!f || !confirm(`刪除情境「${f.name}」？`)) return;
    favs = removeFav(favs, f.id);
    storeFavs(favs);
    // 掛在這個情境上的通知規則一起清掉（規則沒有情境就沒有地點可以評估）
    notifyRules = pruneForFavs(notifyRules, new Set(favs.map((x) => x.id)));
    storeRules(notifyRules);
    notifyState = pruneState(notifyState, notifyRules);
    storeState(notifyState);
  } else if (d.fav) {
    // 套用情境：地點＋條件；「全台」情境打開專家版的全台地圖
    const f = favs.find((x) => x.id === d.fav);
    if (!f) return;
    sheet = "";
    if (f.kind === "all" || !f.place) {
      s.cond = { ...s.cond, m: f.cond.m, T: f.cond.T };
      save(s);
      location.hash = "#/expert/map";
      return;
    }
    s.place = { ...f.place, detail: `我的情境：${f.name}` };
    s.locate = "idle";
    s.cond = { ...f.cond };
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  save(s);
  render();
});

/** 條件滑桿（data-range="c-radius"／"c-time"／"c-mag"）對應的鍵；不是條件滑桿就是 null */
function condSliderKey(t: HTMLInputElement): CondSlider | null {
  const k = t.dataset?.range;
  return k === "c-radius" ? "radius" : k === "c-time" ? "time" : k === "c-mag" ? "mag" : null;
}

// 條件滑桿：拖的時候只更新旁邊的數字與面板裡的預覽（input），放開才存檔並重畫（change）
app.addEventListener("input", (ev) => {
  const t = ev.target as HTMLInputElement, key = condSliderKey(t);
  if (!key) return;
  const c = sliderCond(s.cond, key, +t.value);
  const out = document.getElementById(`c-${key}-out`);
  if (out) out.textContent = sliderText(c, key);
  const pv = document.getElementById("cond-preview");
  if (pv) pv.innerHTML = String(safely(() => condPreview(s, c)));
});
app.addEventListener("change", (ev) => {
  const t = ev.target as HTMLInputElement;
  // 分享面板的「附上位置」：重畫面板，連結與說明跟著變
  if (t.dataset && "shareLoc" in t.dataset) {
    shareLoc = t.checked;
    return render();
  }
  const key = condSliderKey(t);
  if (!key) return;
  s.cond = sliderCond(s.cond, key, +t.value);
  save(s);
  render();
});

// 地圖的半徑滑桿：拖的時候只更新圓與數字（input），放開才存檔並重畫（change）
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
  // 地震列表的列（role="button"）用鍵盤也能打開
  const t = ev.target as HTMLElement;
  if ((ev.key === "Enter" || ev.key === " ") && t.dataset?.quake) {
    ev.preventDefault();
    t.click();
    return;
  }
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
  // APP 開著時又打開一個分享連結（例如從聊天軟體點進來）
  const shared = parseShare(location.hash);
  if (shared) applyShared(shared);
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
// 恢復連線時馬上更新；開著不動時每 5 分鐘檢查 feed（每 15 分鐘發布）、每 2 分鐘檢查地震列表。
// 畫面在背景時不抓，回到前景時補抓一次。
window.addEventListener("online", () => {
  void refreshFeed();
  void refreshQuakes();
});
setInterval(() => document.visibilityState === "visible" && void refreshFeed(), 5 * 60e3);
setInterval(() => document.visibilityState === "visible" && void refreshQuakes(), 2 * 60e3);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - (s.quakes?.at ?? 0) > 60e3) void refreshQuakes();
});

// ---------- 歷史回放（Phase 5） ----------

async function openHistoryIndex() {
  historyView = { status: "loading" };
  try {
    historyView = { status: "ok", index: await loadHistoryIndex() };
  } catch (e) {
    historyView = { status: "error", error: e instanceof Error && e.name !== "TypeError" ? e.message : "無法連線" };
  }
  if (route().mode === "history") render();
}

/**
 * 進入某個時間點：feed 換成那時的資料、位置換到震央、條件回到預設（各時間點才好比較）。
 * 原本的位置與條件記在 history.back，回到現在時還原；回放中不存檔（state.save 會略過）。
 */
async function enterHistory(id: string) {
  if (historyView.status !== "ok") return;
  const hit = findSnapshot(historyView.index, id);
  if (!hit) return;
  const index = historyView.index;
  historyView = { status: "ok", index, loadingId: id };
  render();
  try {
    const feed = await loadHistoryFeed(id);
    const back = s.history?.back ?? { place: s.place, cond: s.cond };
    s.history = { quake: hit.quake, snap: hit.snap, back };
    s.feed = feed;
    s.place = { lat: hit.quake.lat, lon: hit.quake.lon, label: `${hit.quake.name}震央`, detail: "歷史回放", source: "map" };
    s.cond = { ...DEFAULT_COND };
    s.locate = "idle";
    sheet = "";
    historyView = { status: "ok", index };
    location.hash = "#/";
    nameEpicenter();
  } catch (e) {
    historyView = { status: "ok", index, error: `這個時間點的資料載入失敗（${e instanceof Error && e.name !== "TypeError" ? e.message : "無法連線"}）` };
    render();
  }
}

/** 回到現在：還原位置與條件，換回最新的資料 */
function exitHistory() {
  const h = s.history;
  if (!h) return;
  s.history = undefined;
  s.place = h.back.place;
  s.cond = h.back.cond;
  s.feed = cachedFeed() ?? makeMockFeed();
  s.feedStatus = { origin: "loading", error: null };
  sheet = "";
  save(s);
  if (route().mode === "history") location.hash = "#/";
  else render();
  void refreshFeed();
}

// ---------- 分享網址 ----------

/** 網站網址（# 前面那段），分享連結用 */
const shareBase = () => location.href.split("#")[0];
const canShare = () => typeof navigator.share === "function";

/**
 * 套用分享連結：條件夾在範圍內、縣市要在內建清單裡、地點名稱在這支手機上自己判斷（share.ts 已檢查）。
 * 套用後把網址換回 #/，重新整理不會再套一次，網址列也不會一直留著別人的位置。
 */
function applyShared(v: SharedView) {
  s.cond = { ...s.cond, ...v.cond };
  if (v.place?.kind === "county") s.place = { lat: v.place.lat, lon: v.place.lon, label: v.place.name, source: "county" };
  else if (v.place) {
    const p: Place = { lat: v.place.lat, lon: v.place.lon, label: "分享的位置", detail: "正在判斷鄉鎮區…", source: "map" };
    s.place = p;
    void resolveLabel(p, "分享的位置");
  }
  if (v.place) s.locate = "idle";
  sharedKind = v.place ? "place" : "cond";
  save(s);
  history.replaceState(null, "", `${shareBase()}#/`);
}

async function shareNow() {
  const url = buildShareUrl(shareBase(), s.place, s.cond, shareLoc);
  const text = `${shareLoc ? `${placeShort(s.place)}` : ""}${condText(s.cond)}的地震機率（統計機率，不是地震預報）`;
  try {
    await navigator.share({ title: "臺灣地震風險評估", text, url });
  } catch (e) {
    // 使用者自己取消（AbortError）就什麼都不做；其他錯誤改成複製
    if (!(e instanceof Error && e.name === "AbortError")) void copyLink();
  }
}

async function copyLink() {
  const input = document.getElementById("share-link") as HTMLInputElement | null;
  const msg = document.getElementById("share-msg");
  const url = buildShareUrl(shareBase(), s.place, s.cond, shareLoc);
  try {
    await navigator.clipboard.writeText(url);
    if (msg) msg.textContent = "已複製連結。統計機率，不是地震預報。";
  } catch {
    // 沒有剪貼簿權限：選取連結文字，讓使用者自己長按複製
    input?.select();
    if (msg) msg.textContent = "沒辦法自動複製，連結已經選取，請長按複製。";
  }
}

// ---------- 啟動 ----------

// 用分享連結打開：先套用（在第一次畫面之前），而且這次不自動定位，免得 GPS 蓋掉分享的位置
const sharedAtStart = parseShare(location.hash);
if (sharedAtStart) applyShared(sharedAtStart);
if (route().mode !== "info") lastMain = location.hash || "#/";
render();
nameEpicenter();
// PWA 狀態（可安裝、離線就緒、有新版）只影響首頁的安裝提示與 ⓘ 頁；專家頁不必為此重畫
initPwa(() => {
  if (route().mode !== "expert") render();
});
// 先看完使用前說明再要求定位，避免說明視窗和瀏覽器的定位詢問同時跳出來。
// 第一次開、或上次用 GPS：自動定位；使用者選過縣市或地圖選點就尊重他的選擇。
// 先下載資料（最多 10 秒）再顯示使用前說明，說明的內容才會對應「真資料」或「假資料」
void refreshQuakes();
void refreshFeed()
  .then(() => showDisclaimer(s.feed.mock))
  .then(() => {
    if (sharedAtStart?.place) return;
    if (!saved.place || saved.place.source === "gps") locate();
  });
