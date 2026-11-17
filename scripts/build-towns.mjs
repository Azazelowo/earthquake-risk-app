#!/usr/bin/env node
// 產生鄉鎮市區界線簡化檔（src/data/towns.topo.json）與測試用對照點（src/geo/towns.fixture.json）。
//
// 為什麼要簡化：原始檔 18 MB，手機載不動；簡化到約 0.3 MB 後可以內建在 APP 裡，
// 「我在哪個鄉鎮區」就能完全在手機上判斷，位置不必送給任何伺服器。
//
// 為什麼選 Douglas–Peucker（dp）而不是 mapshaper 預設的方法：dp 保證簡化後的線和原本的線
// 相差不超過指定距離（interval，公尺）。有了這個上限，APP 才能說「離界線超過這個距離就一定沒判錯」，
// 界線附近則老實顯示「附近」。再加上座標量化（存成整數）的誤差，寫進輸出檔的 meta.tolerance_m。
//
// 對照點（驗證層）：沿著「原始」界線每隔一段距離取一點、隨機偏移 0–200 公尺，再加一些隨機點，
// 用 mapshaper 對「原始」界線檔判斷各點屬於哪個鄉鎮區當作標準答案。src/geo/towns.test.ts 拿它檢查
// APP 自己的判斷：凡是 APP 說「有把握」的點，都必須和標準答案一致。
//
// 資料來源：內政部國土測繪中心「鄉鎮市區界線(TWD97經緯度)」，政府資料開放授權條款－第1版
//   https://data.gov.tw/dataset/7441
//
// 用法（mapshaper 不放進專案相依，避免占 C 槽空間）：
//   node scripts/build-towns.mjs <TOWN_MOI_xxxxxxx.shp 的路徑> [--tolerance 50] [--version 1140318]
//   環境變數 MAPSHAPER_BIN 可指定已安裝的 mapshaper/bin/mapshaper；沒設就用 npx 臨時下載。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv.splice(i, 2)[1] : fallback;
};
const TOLERANCE_M = Number(opt("tolerance", 50));
const VERSION = opt("version", "1140318");
const shp = argv[0] && resolve(argv[0]);
if (!shp) {
  console.error("用法：node scripts/build-towns.mjs <TOWN_MOI_xxxxxxx.shp> [--tolerance 50] [--version 1140318]");
  process.exit(1);
}

const QUANTIZATION = 1e5;
const BOUNDARY_STEP_M = 8000; // 沿原始界線每 8 公里取一點
const JITTER_MAX_M = 200; // 再隨機偏移 0–200 公尺：一部分落在誤差範圍內、一部分在外
const RANDOM_POINTS = 300; // 另加的均勻隨機點（含海上）
const TAIWAN_BOX = { lonMin: 119.2, lonMax: 122.2, latMin: 21.8, latMax: 25.4 };
const M_PER_DEG = 111195;

function mapshaper(...args) {
  const opts = { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 };
  const bin = process.env.MAPSHAPER_BIN;
  if (bin) return execFileSync(process.execPath, [bin, ...args], opts).toString();
  return execFileSync("npx", ["--yes", "mapshaper@0.6.121", ...args], { ...opts, shell: true }).toString();
}

/** 固定種子的亂數：每次重跑得到同一批對照點，git 才不會出現無意義的差異 */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tmp = mkdtempSync(join(tmpdir(), "towns-"));
try {
  // ---------- 1. 簡化 ----------
  const topoPath = join(tmp, "towns.json");
  mapshaper(
    shp, "encoding=utf8", "-rename-layers", "towns",
    "-simplify", "dp", `interval=${TOLERANCE_M}`, "keep-shapes",
    "-filter-fields", "TOWNCODE,COUNTYNAME,TOWNNAME",
    "-o", "format=topojson", `quantization=${QUANTIZATION}`, topoPath,
  );
  const topo = JSON.parse(readFileSync(topoPath, "utf8"));
  const [sx, sy] = topo.transform.scale;
  // 量化誤差：每個座標最多差半格；換成公尺（經度用臺灣中部的緯度換算）
  const quantM = Math.hypot((sx / 2) * M_PER_DEG * Math.cos((23.5 * Math.PI) / 180), (sy / 2) * M_PER_DEG);
  const toleranceM = TOLERANCE_M + Math.ceil(quantM);
  const out = {
    type: "Topology",
    meta: {
      source: `內政部國土測繪中心「鄉鎮市區界線(TWD97經緯度)」${VERSION} 版，經簡化`,
      license: "政府資料開放授權條款－第1版 https://data.gov.tw/license",
      dataset: "https://data.gov.tw/dataset/7441",
      simplify: `Douglas-Peucker interval=${TOLERANCE_M}m, quantization=${QUANTIZATION}`,
      tolerance_m: toleranceM,
    },
    transform: topo.transform,
    objects: { towns: topo.objects.towns },
    arcs: topo.arcs,
  };
  const n = out.objects.towns.geometries.length;
  if (n !== 368) console.warn(`注意：鄉鎮市區數是 ${n}，不是 368，請確認來源檔`);
  const topoOut = join(ROOT, "src/data/towns.topo.json");
  writeFileSync(topoOut, JSON.stringify(out));
  console.log(`界線檔：${n} 個鄉鎮市區，誤差上限 ${toleranceM} m（簡化 ${TOLERANCE_M} + 量化 ${quantM.toFixed(1)}），${(readFileSync(topoOut).length / 1024).toFixed(0)} KB`);

  // ---------- 2. 對照點 ----------
  const alongPath = join(tmp, "along.csv");
  mapshaper(
    shp, "encoding=utf8", "-lines", "-points", "interpolated", `interval=${BOUNDARY_STEP_M}`,
    "-each", "lon=this.x, lat=this.y", "-filter-fields", "lon,lat", "-o", "format=csv", alongPath,
  );
  const rand = rng(20261115);
  const pts = [];
  for (const line of readFileSync(alongPath, "utf8").trim().split(/\r?\n/).slice(1)) {
    const [lon, lat] = line.split(",").map(Number);
    if (!isFinite(lon) || !isFinite(lat)) continue;
    const r = rand() * JITTER_MAX_M, a = rand() * 2 * Math.PI;
    pts.push([lat + (r * Math.sin(a)) / M_PER_DEG, lon + (r * Math.cos(a)) / (M_PER_DEG * Math.cos((lat * Math.PI) / 180))]);
  }
  const nearBoundary = pts.length;
  for (let i = 0; i < RANDOM_POINTS; i++)
    pts.push([
      TAIWAN_BOX.latMin + rand() * (TAIWAN_BOX.latMax - TAIWAN_BOX.latMin),
      TAIWAN_BOX.lonMin + rand() * (TAIWAN_BOX.lonMax - TAIWAN_BOX.lonMin),
    ]);
  const ptsPath = join(tmp, "pts.csv");
  writeFileSync(ptsPath, "id,lon,lat\n" + pts.map(([lat, lon], i) => `${i},${lon.toFixed(5)},${lat.toFixed(5)}`).join("\n"));
  const joinedPath = join(tmp, "joined.csv");
  // 標準答案：用「原始」界線檔判斷（mapshaper 的實作，和 APP 的程式互相獨立）
  mapshaper(ptsPath, "-points", "x=lon", "y=lat", "-join", shp, "fields=TOWNCODE", "-o", "format=csv", joinedPath);
  const rows = readFileSync(joinedPath, "utf8").trim().split(/\r?\n/);
  const head = rows[0].split(",");
  const col = (name) => head.indexOf(name);
  const fixture = rows.slice(1).map((line) => {
    const c = line.split(",");
    return [Number(c[col("lat")]), Number(c[col("lon")]), c[col("TOWNCODE")] ?? ""];
  });
  if (fixture.length !== pts.length) throw new Error(`對照點數量不符：${fixture.length} / ${pts.length}`);
  const fixtureOut = join(ROOT, "src/geo/towns.fixture.json");
  writeFileSync(
    fixtureOut,
    JSON.stringify({
      note: "由 scripts/build-towns.mjs 產生：[緯度, 經度, 原始界線檔判斷的 TOWNCODE（空字串＝不在任何鄉鎮區內）]",
      near_boundary: nearBoundary,
      random: RANDOM_POINTS,
      jitter_max_m: JITTER_MAX_M,
      points: fixture,
    }),
  );
  const onLand = fixture.filter((p) => p[2]).length;
  console.log(`對照點：${fixture.length} 個（界線附近 ${nearBoundary}、隨機 ${RANDOM_POINTS}；落在鄉鎮區內 ${onLand}），${(readFileSync(fixtureOut).length / 1024).toFixed(0)} KB`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
