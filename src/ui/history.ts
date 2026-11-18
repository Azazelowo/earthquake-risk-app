// 歷史回放頁（#/history）與回放中的提示列（Phase 5）。
// 點一個時間點，整個 APP（首頁狀態、餘震卡、全台排行、地圖、規模／時間曲線）都換成那個時間點的資料，
// 位置換到震央；上方一直有提示列，隨時可以回到現在。限制直接寫在頁面上（不是當時真的發布的數字）。
import type { State } from "../state";
import type { HistoryIndex } from "../data/history";
import { esc, twFull } from "../format";

export type HistoryView =
  | { status: "idle" | "loading" }
  | { status: "ok"; index: HistoryIndex; loadingId?: string; error?: string }
  | { status: "error"; error: string };

/** 回放中：每一頁最上面的提示列（取代資料過期的提示） */
export function historyBanner(s: State): string {
  const h = s.history;
  if (!h) return "";
  return `<div class="histbar" role="status">
    <span><b>歷史回放</b>・${esc(h.quake.name)}・${esc(h.snap.label)}（${esc(twFull(h.snap.issued_at))}）。用事後資料重算的當時狀態，不是現在。</span>
    <span class="histbar-btns"><a href="#/history">換時間點</a><button type="button" class="btn sm" data-act="history-exit">回到現在</button></span>
  </div>`;
}

export function renderHistory(s: State, view: HistoryView): string {
  const intro = `
  <div class="card">
    <p>選一個時間點，整個 APP（首頁、餘震卡、全台排行、地圖）會換成那個時間點的狀態，位置換到震央。上方會一直提示「歷史回放」，隨時可以回到現在。</p>
    <ul class="notes plain">
      <li><b>不是當時真的發布的數字。</b>用事後整理好的正式目錄、v1.1 參數重算，只用每個時間點之前的資料（校準倍率也是）。參數用 1995–2014 年的資料擬合，這些地震都在之後，模型沒看過。</li>
      <li>當時即時能拿到的資料比較不完整（小地震會少），當時真的跑的話，數字會比這裡低一些。</li>
      <li><b>看看「主震前 1 小時」：</b>模型只會因為「已經發生的地震」而升高。2018 花蓮、2022 池上之前都有前震（池上是前一天的關山 ML 6.6），所以主震前附近已經升高；2016 美濃之前很平靜，模型看不出任何東西；2024 花蓮之前只高一點（兩週前有 M5.4），全台排行第一還在別的地方。模型不知道哪一次地震會變成更大的主震——這不是地震預報。</li>
      <li>目前的模型把大地震和小地震帶來的餘震當成一樣多，主震後的數字偏低。</li>
    </ul>
  </div>`;
  let body: string;
  if (view.status === "error") body = `<div class="card errcard" role="alert"><b>回放清單載入失敗</b><p>${esc(view.error)}</p>
      <button type="button" class="btn" data-act="history-retry">再試一次</button></div>`;
  else if (view.status !== "ok") body = `<p class="muted">正在載入回放清單…</p>`;
  else
    body = view.index.quakes
      .map((q) => `
    <section class="card hq">
      <div class="hq-head"><b>${esc(q.name)}</b><span>${esc(twFull(q.time))}・ML ${q.ml.toFixed(1)}${q.depth_km !== undefined ? `・深度 ${Math.round(q.depth_km)} 公里` : ""}</span></div>
      <div class="hq-snaps">${q.snapshots
        .map((x) => {
          const on = s.history?.snap.id === x.id ? " on" : "";
          const busy = view.loadingId === x.id ? " busy" : "";
          return `<button type="button" class="btn hq-snap${on}${busy}" data-history="${esc(x.id)}">${esc(x.label)}</button>`;
        })
        .join("")}</div>
    </section>`)
      .join("") + (view.error ? `<p class="warn-text small" role="alert">${esc(view.error)}</p>` : "");
  return `
  <div class="history">
    <h2 class="vh">歷史回放：大地震前後，模型怎麼說</h2>
    ${intro}
    ${body}
    ${s.history ? `<button type="button" class="btn wide" data-act="history-exit">回到現在</button>` : ""}
    <p class="muted small">統計機率，不是地震預報。</p>
  </div>`;
}
