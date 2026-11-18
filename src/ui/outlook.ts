// 「震央周圍之後再發生地震的機率」：首頁的餘震卡與地震列表點開的面板共用同一段畫面。
// 限制（大地震後偏低、不分主震餘震）直接寫在表格下方，不藏到 ⓘ 頁。
import type { Feed } from "../data/schema";
import { aftershockOutlook, AFTERSHOCK_TIMES } from "../core/aftershock";
import { FULL_COVERAGE } from "../core/hazard";
import { timeLabel } from "../state";
import { levelOf, pct } from "../format";

/**
 * 機率表＋提醒＋可展開的說明。震央周圍大半在模型範圍外時不給數字，只給一句說明。
 * extra：說明裡要多加的段落（HTML，呼叫端負責跳脫），例如首頁的「挑哪一個地震」。
 */
export function outlookSection(f: Feed, at: { lat: number; lon: number }, extra = ""): string {
  const o = aftershockOutlook(f, at);
  if (!o.covered)
    return `<p class="as-none">震央附近大部分不在模型範圍內（北緯 ${f.grid.lat_min}–${f.grid.lat_max}°、東經 ${f.grid.lon_min}–${f.grid.lon_max}°），這裡不提供數字。這不代表那裡不會有餘震。</p>`;
  const rows = o.rows
    .map((r) => `<tr><th>M${r.m} 以上</th>${r.cells
      .map((c) => `<td><b class="${levelOf(c.ratio).key}">${pct(c.p)}</b><small>平常 ${pct(c.pBg)}</small></td>`)
      .join("")}</tr>`)
    .join("");
  const part = o.coverage < FULL_COVERAGE ? `<p class="as-note">範圍約 ${Math.round((1 - o.coverage) * 100)}% 在模型網格外，那部分沒有計入，數字會偏低。</p>` : "";
  return `
    <p class="as-cap">震央周圍 ${o.radiusKm} 公里內，之後再發生地震的機率</p>
    <table class="tbl as-tbl"><thead><tr><th></th>${AFTERSHOCK_TIMES.map((T) => `<th>${timeLabel(T)}內</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody></table>
    ${part}
    <p class="as-warn">大地震剛發生時，這些數字可能<b>偏低</b>：目前的模型把大地震和小地震帶來的餘震當成一樣多，要等餘震陸續進到資料裡才會追上。</p>
    <details class="as-more" data-fold="aftershock"><summary>怎麼算的、還有什麼限制</summary>
      <p>用的是和首頁「和平常比」同一個模型：以震央為中心、半徑 ${o.radiusKm} 公里，算規模門檻以上的地震「至少發生一次」的機率。「平常」是只用長期紀錄算的機率。</p>
      <p>模型不分主震、餘震，這是震央附近「再發生地震」的機率，包含平常就會有的地震。</p>
      <p>偏低的原因：模型裡「規模對餘震數量的影響」擬合出來是 0，等於假設規模 6 和規模 4 的地震之後會有一樣多的餘震。實際上大地震的餘震多很多，所以剛發生時偏低；之後的餘震陸續發生、算進資料，數字才會跟著上來。這是目前版本的已知限制。</p>
      <p>外海定位不準的地震不在模型裡，外海的數字也會偏低；新的地震要等下一次資料更新（每 15 分鐘）才會算進去。</p>
      ${extra}
    </details>`;
}
