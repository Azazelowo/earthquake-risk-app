// 不用圖表套件：兩條線（現在／平常）的小型 SVG 折線圖，y 軸機率取對數。

export interface Series {
  name: string;
  cls: string; // CSS class，決定顏色與線型
  pts: [number, number][];
}

export interface ChartOpt {
  xLog?: boolean;
  xTicks: [number, string][];
  xLabel: string;
  marker?: number; // 目前選的 x
}

const W = 340, H = 220, L = 44, R = 12, T = 12, B = 36;

export function lineChart(series: Series[], o: ChartOpt): string {
  const xs = series.flatMap((s) => s.pts.map((p) => p[0]));
  const fx = (v: number) => (o.xLog ? Math.log10(v) : v);
  const x0 = fx(Math.min(...xs)), x1 = fx(Math.max(...xs));
  const ys = series.flatMap((s) => s.pts.map((p) => p[1])).filter((v) => v > 0);
  const y0 = Math.floor(Math.log10(Math.max(Math.min(...ys), 1e-6)));
  const y1 = Math.min(0, Math.ceil(Math.log10(Math.max(...ys))));
  const px = (v: number) => L + ((fx(v) - x0) / (x1 - x0 || 1)) * (W - L - R);
  const py = (v: number) => T + (1 - (Math.log10(Math.max(v, 10 ** y0)) - y0) / (y1 - y0 || 1)) * (H - T - B);

  let g = "";
  for (let e = y0; e <= y1; e++) {
    const y = py(10 ** e);
    const lab = e >= -2 ? `${+(100 * 10 ** e).toPrecision(1)}%` : `${+(100 * 10 ** e).toPrecision(1)}%`;
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="tick" x="${L - 6}" y="${y + 4}" text-anchor="end">${lab}</text>`;
  }
  for (const [v, lab] of o.xTicks) {
    const x = px(v);
    g += `<line class="grid" x1="${x}" x2="${x}" y1="${T}" y2="${H - B}"/><text class="tick" x="${x}" y="${H - B + 16}" text-anchor="middle">${lab}</text>`;
  }
  if (o.marker !== undefined) {
    const x = px(o.marker);
    g += `<line class="marker" x1="${x}" x2="${x}" y1="${T}" y2="${H - B}"/>`;
  }
  g += `<text class="axis" x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">${o.xLabel}</text>`;
  for (const s of series) {
    const d = s.pts.map((p, i) => `${i ? "L" : "M"}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join("");
    g += `<path class="line ${s.cls}" d="${d}"/>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
