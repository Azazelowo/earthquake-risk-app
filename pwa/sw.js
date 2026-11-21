// Service worker：讓 APP 可以安裝、沒網路時也能開（看到上次載入的畫面）。
//
// 這個檔案是樣板。建置時 vite.config.ts 的 swPlugin 會把下面 VERSION（所有輸出檔的雜湊）與
// ASSETS（要預先存起來的檔案清單）兩個常數的佔位標記換成實際值，輸出成 dist/sw.js。
// 開發模式（npm run dev）不註冊。佔位標記只能出現在那兩行，不要寫進註解裡。
//
// 策略（為什麼這樣選）：
// - 頁面本身（index.html）：先走網路、逾時或離線才用快取 → 有網路時一定拿到最新版，不會卡在舊版。
// - assets/ 底下的檔案（JS／CSS／界線檔，檔名帶雜湊、內容永遠不變）：先用快取 → 開啟快、可離線。
// - 其他自己網站的檔案（圖示、manifest，以及之後會加的 feed.json）：先走網路、失敗才用快取。
//   feed.json 的檔名不帶雜湊、內容每次更新都會變，如果先用快取，使用者會一直看到第一次存下的舊風險數字。
// - 其他網站的資源（地圖圖磚等）：完全不攔截、不快取。OSM 與 CARTO 的條款都不允許預抓或長期離線保存，
//   交給瀏覽器依對方的 HTTP 標頭處理。
// - 新版 service worker 裝好後先等待，不打斷正在使用的畫面；全部關掉再開就會換新，
//   或由 ⓘ 頁的「套用新版」送 SKIP_WAITING 立即更新。

const VERSION = "__VERSION__";
const PRECACHE = `eqrisk-precache-${VERSION}`;
const RUNTIME = "eqrisk-runtime";
const ASSETS = __ASSETS__;
const NAV_TIMEOUT_MS = 4000;
// 比對快取時不看 Vary 標頭：我們的靜態檔內容不會因請求標頭而不同。不加的話，有些主機回的 Vary: Origin
// 會讓「預存的檔案」和「頁面實際發出的請求」對不上，同一個檔案被抓兩次、存兩份。
const MATCH = { ignoreVary: true };

const scope = self.registration.scope; // 例：https://azazelowo.github.io/earthquake-risk-app/
const shellUrl = new URL("index.html", scope).href;
const hashedPath = new URL("assets/", scope).pathname; // Vite 輸出的檔名帶雜湊的資料夾

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) =>
      // cache: "reload"＝略過瀏覽器的 HTTP 快取，確保存進去的是這一版的檔案
      cache.addAll(ASSETS.map((path) => new Request(new URL(path, scope).href, { cache: "reload" }))),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        const stale = (key.startsWith("eqrisk-precache-") && key !== PRECACHE) || key === RUNTIME;
        if (stale) await caches.delete(key);
      }
      await self.clients.claim(); // 第一次安裝後立刻接手，不必重新整理就能離線
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// 點通知：回到已經開著的 APP 視窗，沒有就開一個新的（通知由 APP 自己在手機上評估後送出，見 docs/NOTIFY.md）
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("./", scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(target));
      return open ? open.focus() : self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (!req.url.startsWith(scope)) return; // 其他網站（圖磚）或同網域的其他專案：不處理
  if (req.mode === "navigate") event.respondWith(pageFirstNetwork(req));
  else if (new URL(req.url).pathname.startsWith(hashedPath)) event.respondWith(cacheFirst(req));
  else event.respondWith(networkFirst(req));
});

async function pageFirstNetwork(req) {
  let res;
  try {
    res = await withTimeout(fetch(req), NAV_TIMEOUT_MS);
    if (res.ok) return res;
    // 主機暫時出錯（5xx 等）：有快取就用快取，不顯示錯誤頁
  } catch {
    // 離線或逾時
  }
  const cached = await caches.match(shellUrl, MATCH);
  if (cached) return cached;
  return res ?? fetch(req); // 連快取都沒有（不應發生）：交給瀏覽器顯示原本的回應或離線頁
}

async function cacheFirst(req) {
  const cached = await caches.match(req, MATCH);
  if (cached) return cached;
  const res = await fetch(req);
  keep(req, res);
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    keep(req, res);
    return res;
  } catch (err) {
    const cached = await caches.match(req, MATCH);
    if (cached) return cached;
    throw err;
  }
}

/** 成功的同網站回應存一份，離線時用；換新版時整個 RUNTIME 快取會清掉 */
function keep(req, res) {
  if (!res.ok || res.type !== "basic") return;
  const copy = res.clone();
  caches.open(RUNTIME).then((cache) => cache.put(req, copy));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error) => (clearTimeout(timer), reject(error)),
    );
  });
}
