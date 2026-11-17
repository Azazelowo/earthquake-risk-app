/// <reference types="vite/client" />

/** 建置時間（ISO 8601）與 commit，由 vite.config.ts 注入，顯示在 ⓘ 頁方便確認手機上是哪一版 */
declare const __BUILD_TIME__: string;
declare const __BUILD_COMMIT__: string;

interface ImportMetaEnv {
  /**
   * CARTO 底圖金鑰（可不設）。設了就會被打包進公開網站的 JS——CARTO 的金鑰本來就放在圖磚網址裡，
   * 要靠 CARTO 後台的「網域限制」保護。沒設時，使用者可以在 ⓘ 頁貼上自己的金鑰（只存在那支手機）。
   */
  readonly VITE_CARTO_KEY?: string;
}

/** Android／桌面 Chrome 的安裝事件（還不是標準，TypeScript 內建型別沒有） */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
