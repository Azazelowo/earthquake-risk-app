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
    <p class="as-warn">剛發生的幾個小時，數字主要是依<b>規模</b>估的，不確定性大：回測中 1 天內的總數可能<b>高估</b>約 1.6 倍；但即時資料的小餘震不完整，也可能<b>偏低</b>。</p>
    <details class="as-more" data-fold="aftershock"><summary>怎麼算的、還有什麼限制</summary>
      <p>用的是和首頁「和平常比」同一個模型：以震央為中心、半徑 ${o.radiusKm} 公里，算規模門檻以上的地震「至少發生一次」的機率。「平常」是只用長期紀錄算的機率。</p>
      <p>模型不分主震、餘震，這是震央附近「再發生地震」的機率，包含平常就會有的地震。</p>
      <p>剛發生時怎麼算（v1.2）：大地震剛發生、資料裡還沒有它的餘震時，模型依規模估計它會帶來多少餘震；這部分只維持幾個小時，之後改由真的發生的餘震接手。深度超過 40 公里的地震餘震很少，不加這一項。這組參數只用 1995–2014 年的主震選出，再拿 2015 年後的 148 個主震檢驗：主震後 2 分鐘的預測從 v1.1 的實際的 8% 提升到 7 天內大致相符，1 天內則高估約 1.6 倍。參數受少數大序列（例如 1999 集集）影響，不是很穩定。</p>
      <p>外海定位不準的地震不在模型裡，外海的數字也會偏低；新的地震要等下一次資料更新（每 15 分鐘）才會算進去。</p>
      ${extra}
    </details>`;
}
