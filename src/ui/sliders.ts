// 條件的連續滑桿（Phase 4）：首頁的「調整條件」面板與專家版共用。
// 保留預設按鈕，滑桿在下面細調。拖的時候 main.ts 只更新旁邊的數字（input），放開才存檔、整頁重畫（change）。
import type { Cond, CondSlider } from "../state";
import { RADIUS_MIN, RADIUS_MAX, RADIUS_STEP, TIME_STEPS, M_MIN, M_MAX, M_STEP, sliderFromTime, timeLabel } from "../state";

/** 滑桿旁邊顯示的值 */
export function sliderText(c: Cond, key: CondSlider): string {
  return key === "radius" ? `${c.radiusKm} km` : key === "time" ? timeLabel(c.T) : `M${c.m.toFixed(1)} 以上`;
}

/** 時間是對數刻度：1 小時到 1 天、1 天到 30 天各佔差不多的長度，短時間也調得動 */
export function condSliders(c: Cond, keys: CondSlider[]): string {
  return keys
    .map((k) => {
      const [min, max, step, value, aria] =
        k === "radius" ? [RADIUS_MIN, RADIUS_MAX, RADIUS_STEP, c.radiusKm, "範圍（公里）"]
        : k === "time" ? [0, TIME_STEPS, 1, sliderFromTime(c.T), "時間長度"]
        : [M_MIN, M_MAX, M_STEP, c.m, "規模門檻"];
      return `<label class="slide"><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-range="c-${k}" aria-label="${aria}"><output id="c-${k}-out">${sliderText(c, k)}</output></label>`;
    })
    .join("");
}
