// 使用前說明（免責聲明）：第一次開啟時顯示，按「我了解」才能繼續；勾「不再顯示」之後就不再出現。
// ⓘ 頁可以隨時重看，也可以把「不再顯示」取消。
//
// 為什麼要有版本號：說明的內容之後若有重大改變（例如接上真資料），把 DISCLAIMER_VERSION 加一，
// 已經勾過「不再顯示」的人也會再看到一次新的內容。

export const DISCLAIMER_VERSION = 2; // 2：接上真資料（2026-11-17）
const FOREVER_KEY = "eqrisk.disclaimer"; // localStorage：已同意且不再顯示的版本號
const SESSION_KEY = "eqrisk.disclaimer.seen"; // sessionStorage：這次開啟已經按過「我了解」的版本號

/** 要不要顯示（純函式，方便測試）：永久同意過這一版或更新的 → 不顯示；這次開啟已按過 → 不顯示 */
export function shouldShow(forever: string | null, session: string | null, version = DISCLAIMER_VERSION): boolean {
  if (Number(forever) >= version) return false;
  return session !== String(version);
}

const read = (store: () => Storage, key: string): string | null => {
  try {
    return store().getItem(key);
  } catch {
    return null; // 無痕模式或瀏覽器封鎖儲存：當作沒看過，每次都顯示
  }
};
const write = (store: () => Storage, key: string, value: string | null) => {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
  } catch {
    /* 存不了就算了：最多是下次再顯示一次 */
  }
};

/** 說明的條列內容（HTML）。ⓘ 頁也用同一份，避免兩邊寫得不一樣。 */
export function disclaimerPoints(mock: boolean): string[] {
  return [
    "<b>這不是地震預報。</b>目前沒有任何方法能預測地震確切的時間、地點與規模。這裡顯示的是統計模型估計的「機率」，會有誤差。",
    "<b>「和平常差不多」不代表不會有地震。</b>台灣隨時可能發生強震，平時就要做好防震準備。",
    "<b>地震速報與正式資訊請以中央氣象署為準。</b>這個 APP 不會發出警報或通知。",
    "<b>資料有延遲。</b>正式地震目錄約落後一個半月，之後每 15 分鐘用氣象署有感地震報告與 USGS 暫時補上；暫時資料的小地震不完整，所以「現在」的數字可能偏低。",
    "<b>僅供教育與研究參考。</b>這是國立高雄科技大學的學生實務專題成果，不應作為避難、工程、保險、投資等決定的依據。",
    ...(mock ? ["<b>目前是雛型：所有數字都是假資料</b>，只用來試操作。"] : []),
    "<b>你的位置只在這支手機上計算</b>，不會傳送出去。",
  ];
}

let open: Promise<void> | null = null;

/**
 * 顯示說明視窗。回傳的 Promise 在使用者按下「我了解」後完成（不需要顯示時立刻完成）。
 * force＝true：從 ⓘ 頁重看，不管之前有沒有同意過都顯示。
 */
export function showDisclaimer(mock: boolean, force = false): Promise<void> {
  if (open) return open;
  const forever = read(() => localStorage, FOREVER_KEY);
  if (!force && !shouldShow(forever, read(() => sessionStorage, SESSION_KEY))) return Promise.resolve();

  open = new Promise<void>((resolve) => {
    const root = document.createElement("div");
    root.className = "dlg-scrim";
    root.innerHTML = `
      <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">使用前請先了解</h2>
        <ul class="dlg-list">${disclaimerPoints(mock).map((p) => `<li>${p}</li>`).join("")}</ul>
        <label class="dlg-check"><input type="checkbox" id="dlg-never" ${Number(forever) >= DISCLAIMER_VERSION ? "checked" : ""}>不再顯示</label>
        <button class="btn primary wide" id="dlg-ok">我了解</button>
      </div>`;
    document.body.appendChild(root);
    document.documentElement.classList.add("modal-open"); // 鎖住背景捲動
    const ok = root.querySelector<HTMLButtonElement>("#dlg-ok")!;
    const never = root.querySelector<HTMLInputElement>("#dlg-never")!;
    const before = document.activeElement as HTMLElement | null;
    ok.focus({ preventScroll: true });
    // 視窗開著時 Tab 只在視窗內的兩個控制項之間移動
    root.addEventListener("keydown", (ev) => {
      if (ev.key !== "Tab") return;
      ev.preventDefault();
      (document.activeElement === ok ? never : ok).focus();
    });
    ok.addEventListener("click", () => {
      write(() => localStorage, FOREVER_KEY, never.checked ? String(DISCLAIMER_VERSION) : null);
      write(() => sessionStorage, SESSION_KEY, String(DISCLAIMER_VERSION));
      root.remove();
      document.documentElement.classList.remove("modal-open");
      before?.focus?.({ preventScroll: true });
      open = null;
      resolve();
    });
  });
  return open;
}
