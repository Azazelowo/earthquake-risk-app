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
