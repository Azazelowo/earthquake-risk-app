// PWA：註冊 service worker、處理「安裝」與「更新」。畫面只讀 pwa 這個狀態物件，不直接碰瀏覽器 API。
//
// 安裝的兩條路：
// - Android／桌面 Chrome：瀏覽器判斷可安裝後會發 beforeinstallprompt，我們留著，讓 APP 內的按鈕也能觸發
//   （瀏覽器選單的「安裝應用程式」照樣可用）。
// - iPhone：沒有這個事件，只能請使用者用 Safari 的「分享 → 加入主畫面」，所以顯示文字說明。

export interface PwaState {
  /** 已經以「安裝後的 APP」開啟（不是瀏覽器分頁） */
  standalone: boolean;
  ios: boolean;
  /** 瀏覽器給了安裝事件，可以由 APP 內的按鈕觸發 */
  canInstall: boolean;
  /** service worker 已就緒，沒網路也能開 */
  offlineReady: boolean;
  /** 有新版在等待；套用後會重新載入 */
  updateWaiting: boolean;
  /** 檢查更新的結果訊息（顯示在 ⓘ 頁） */
  updateNote: string;
}

export const pwa: PwaState = {
  standalone: false,
  ios: false,
  canInstall: false,
  offlineReady: false,
  updateWaiting: false,
  updateNote: "",
};

let deferred: BeforeInstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | undefined;
let notify: () => void = () => {};

export function initPwa(onChange: () => void) {
  notify = onChange;
  const nav = navigator as Navigator & { standalone?: boolean };
  pwa.standalone = matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
  // iPadOS 13 之後自稱 Mac，要用觸控點數分辨
  pwa.ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  window.addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault(); // 不要自動跳出底部橫幅；改由我們的按鈕或瀏覽器選單觸發
    deferred = ev as BeforeInstallPromptEvent;
    pwa.canInstall = true;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    pwa.canInstall = false;
    pwa.standalone = true;
    notify();
  });

  // 開發模式不註冊：service worker 的快取會讓「改了程式卻看到舊畫面」很難查
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // 第一次安裝時 service worker 接手不需要重新載入；只有「舊版換新版」才要
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  // 等頁面載完再註冊：service worker 第一次安裝會下載整份 APP，不要和首頁搶頻寬
  const register = () =>
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        registration = reg;
        watch(reg);
        return navigator.serviceWorker.ready;
      })
      .then(() => {
        pwa.offlineReady = true;
        notify();
      })
      .catch(() => {
        /* 註冊失敗（例如瀏覽器封鎖）：APP 照常可用，只是不能離線 */
      });
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

function watch(reg: ServiceWorkerRegistration) {
  const waiting = () => {
    pwa.updateWaiting = true;
    pwa.updateNote = "有新版本";
    notify();
  };
  if (reg.waiting && navigator.serviceWorker.controller) waiting();
  reg.addEventListener("updatefound", () => {
    const next = reg.installing;
    if (!next) return;
    next.addEventListener("statechange", () => {
      // installed 且目前已有舊版在控制頁面 → 新版在等待
      if (next.state === "installed" && navigator.serviceWorker.controller) waiting();
    });
  });
}

/** 顯示安裝視窗（Android／桌面 Chrome）。回傳使用者是否接受。 */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const ev = deferred;
  deferred = null; // 同一個事件只能用一次
  pwa.canInstall = false;
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  notify();
  return outcome === "accepted";
}

/** ⓘ 頁的「檢查更新」 */
export async function checkUpdate() {
  if (!registration) {
    pwa.updateNote = import.meta.env.PROD ? "這個瀏覽器不支援離線功能" : "開發模式沒有啟用離線功能";
    return notify();
  }
  pwa.updateNote = "檢查中…";
  notify();
  try {
    await registration.update();
    // update() 完成時新版可能還在安裝；稍等一下讓 updatefound／statechange 跑完
    await new Promise((r) => setTimeout(r, 1500));
    if (!pwa.updateWaiting) pwa.updateNote = registration.installing ? "正在下載新版…" : "已經是最新版";
  } catch {
    pwa.updateNote = "檢查失敗（可能沒有網路）";
  }
  notify();
}

/** 套用等待中的新版：service worker 接手後 controllerchange 會重新載入頁面 */
export function applyUpdate() {
  registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
}
