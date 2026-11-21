// 通知權限與送出。只用瀏覽器內建的 Notification API（沒有伺服器、沒有第三方推播服務）。
//
// 能做到與做不到的（來源與查證日期見 docs/NOTIFY.md §2；這裡只寫已經查證到的）：
//   - 通知只在「APP 開著或在背景但還活著」、並且資料更新時才會評估與送出。APP 完全關閉就不會通知，
//     那需要伺服器推播（階段 B，見文件）。
//   - iPhone／iPad：Apple 官方說明（WebKit blog，iOS／iPadOS 16.4）只談到「加入主畫面的網頁 App」可以要求通知權限，
//     而且要求必須是回應使用者的直接操作（按按鈕）。所以我們只在按鈕的點擊裡要求權限，並且在 iOS 上提示要先加入主畫面。
//     其他瀏覽器（Android Chrome、桌面版）的行為我們沒有逐一查證，一律用同樣的做法（只在按鈕點擊裡要求）。
import { pwa } from "../pwa";
import type { Msg } from "./message";

export type Permission = NotificationPermission | "unsupported";

export interface Support {
  supported: boolean;
  permission: Permission;
  ios: boolean;
  standalone: boolean;
  /** iPhone／iPad 還沒加入主畫面：先要安裝，才能要求通知權限 */
  needsInstall: boolean;
}

export function notifySupport(): Support {
  const supported = typeof Notification !== "undefined" && "serviceWorker" in navigator;
  return {
    supported,
    permission: supported ? Notification.permission : "unsupported",
    ios: pwa.ios,
    standalone: pwa.standalone,
    needsInstall: pwa.ios && !pwa.standalone,
  };
}

/** 要求通知權限。**必須在使用者按按鈕的點擊事件裡呼叫**（Apple 官方說明對 iOS 的要求；其他瀏覽器沿用同一做法）。 */
export async function requestPermission(): Promise<Permission> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * 同 requestPermission，但「很久沒有結果」時先通知畫面一次（onSlow），之後照樣等結果。
 * 為什麼：Android 上按了「允許通知」卻沒看到任何東西的回報，我們沒有那支手機可以重現，原因不確定
 * （權限視窗被瀏覽器收成較不顯眼的樣式、被 App 內建瀏覽器擋掉、之前被封鎖等都有可能）；
 * 至少要讓使用者看到「已經送出要求、現在是什麼狀態」，而不是毫無反應。
 */
export async function requestPermissionTracked(onSlow: () => void, slowMs = 6000): Promise<Permission> {
  const timer = setTimeout(onSlow, slowMs);
  try {
    return await requestPermission();
  } finally {
    clearTimeout(timer);
  }
}

/** 常見「App 內建瀏覽器」的標記（LINE、Facebook、Instagram，以及 Android WebView 的 "; wv)"）。這類環境通常不支援網頁通知。 */
export function inAppBrowserUA(ua: string): boolean {
  return /\bLine\/|FBAN|FBAV|FB_IAB|Instagram|; wv\)/i.test(ua);
}

/** 給使用者回報問題用的一行診斷：只含通知相關狀態，不含任何個人資料。 */
export function diagnose(): string {
  const sp = notifySupport();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const parts = [
    `權限＝${sp.permission}`,
    `支援＝${sp.supported ? "是" : "否"}`,
    `模式＝${sp.standalone ? "已安裝的 APP" : "瀏覽器分頁"}`,
    `安全連線＝${typeof isSecureContext !== "undefined" && isSecureContext ? "是" : "否"}`,
  ];
  if (inAppBrowserUA(ua)) parts.push("內建瀏覽器＝可能是");
  return parts.join("，");
}

/** 送出一則通知。優先用 service worker（手機上才能點通知回到 APP），沒有就退回 Notification 建構式。回傳是否送出。 */
export async function showNotice(msg: Msg): Promise<boolean> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  const options: NotificationOptions = {
    body: msg.body,
    tag: msg.tag,
    icon: "./icons/icon-192.png",
    data: { url: "./#/" },
  };
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(msg.title, options);
        return true;
      }
    }
    new Notification(msg.title, options);
    return true;
  } catch {
    return false;
  }
}

export const PERMISSION_TEXT: Record<Permission, string> = {
  granted: "已允許通知。",
  denied: "通知被封鎖了。要重新開啟，請到瀏覽器或手機的網站／App 設定裡允許通知。",
  default: "還沒決定要不要允許通知。",
  unsupported: "這個瀏覽器不支援網頁通知。",
};
