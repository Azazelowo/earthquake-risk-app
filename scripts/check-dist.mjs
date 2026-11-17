#!/usr/bin/env node
// 建置後的檢查（npm run build 的最後一步；CI 沒過就不部署）。
//
// 為什麼需要：PWA「能不能安裝」取決於一堆容易漏掉的小條件——manifest 裡的圖示要真的存在、
// 尺寸要和宣告的一樣、service worker 的預存清單裡不能有不存在的檔案（有一個抓不到，整個安裝就失敗，
// 而且只會在使用者的手機上默默失敗）。這些在本機開發時看不出來，所以每次建置都檢查一次。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const problems = [];
const check = (ok, message) => {
  if (!ok) problems.push(message);
};
const read = (path) => readFileSync(join(DIST, path), "utf8");

/** 讀 PNG 檔頭的寬、高與色彩類型（6＝含透明度的 RGBA，2＝不透明的 RGB） */
function png(path) {
  const b = readFileSync(join(DIST, path));
  const isPng = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return isPng ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] } : null;
}

// ---------- index.html ----------
check(existsSync(join(DIST, "index.html")), "缺少 dist/index.html（建置沒有成功？）");
if (!problems.length) {
  const html = read("index.html");
  check(html.includes("<title>臺灣地震風險評估</title>"), "index.html 的標題不是「臺灣地震風險評估」");
  check(/rel="manifest"/.test(html), "index.html 沒有連到 manifest");
  check(/rel="apple-touch-icon"[^>]*\.png"/.test(html), "index.html 的 apple-touch-icon 不是 PNG（iPhone 不吃 SVG）");
  for (const m of html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)) check(existsSync(join(DIST, m[1])), `index.html 引用的檔案不存在：${m[1]}`);

  // ---------- manifest 與圖示 ----------
  const manifest = JSON.parse(read("manifest.webmanifest"));
  check(manifest.name === "臺灣地震風險評估", "manifest 的 name 不是「臺灣地震風險評估」");
  check(!!manifest.short_name, "manifest 缺 short_name");
  check(["standalone", "fullscreen", "minimal-ui"].includes(manifest.display), "manifest 的 display 不是可安裝的模式");
  check(!!manifest.start_url, "manifest 缺 start_url");
  const sizes = new Set();
  for (const icon of manifest.icons ?? []) {
    if (!existsSync(join(DIST, icon.src))) {
      check(false, `manifest 的圖示不存在：${icon.src}`);
      continue;
    }
    if (icon.type !== "image/png") continue;
    const info = png(icon.src);
    check(!!info, `${icon.src} 不是有效的 PNG`);
    if (!info) continue;
    check(`${info.width}x${info.height}` === icon.sizes, `${icon.src} 實際是 ${info.width}x${info.height}，manifest 寫 ${icon.sizes}`);
    sizes.add(`${icon.sizes}/${icon.purpose ?? "any"}`);
    // maskable 會被系統裁切，四角不能是透明的
    if (icon.purpose === "maskable") check(info.colorType === 2, `${icon.src} 是 maskable，卻含透明度`);
  }
  // Chrome 的安裝條件：至少要有 192 與 512 的 PNG
  for (const need of ["192x192/any", "512x512/any", "192x192/maskable", "512x512/maskable"]) check(sizes.has(need), `manifest 缺少圖示：${need}`);
  const apple = png("icons/apple-touch-icon.png");
  check(!!apple && apple.width === 180 && apple.height === 180, "apple-touch-icon 應為 180x180 的 PNG");
  check(!!apple && apple.colorType === 2, "apple-touch-icon 不可含透明度（iPhone 會補成黑色）");

  // ---------- service worker ----------
  check(existsSync(join(DIST, "sw.js")), "缺少 dist/sw.js");
  if (existsSync(join(DIST, "sw.js"))) {
    const sw = read("sw.js");
    check(!sw.includes("__VERSION__") && !sw.includes("__ASSETS__"), "sw.js 的樣板標記沒有換掉");
    const list = sw.match(/const ASSETS = (\[.*?\]);/s);
    check(!!list, "sw.js 裡找不到預存清單");
    if (list) {
      const assets = JSON.parse(list[1]);
      for (const a of assets) check(existsSync(join(DIST, a)), `sw.js 預存清單裡的檔案不存在：${a}`);
      check(assets.includes("index.html"), "預存清單沒有 index.html（離線時會開不起來）");
      check(assets.some((a) => /^assets\/.+\.js$/.test(a)), "預存清單沒有 JS");
      check(assets.some((a) => /^assets\/.+\.css$/.test(a)), "預存清單沒有 CSS");
      check(assets.some((a) => /towns\.topo.*\.json$/.test(a)), "預存清單沒有鄉鎮區界線檔（離線時無法判斷鄉鎮區）");
      check(!assets.includes("sw.js"), "預存清單不該包含 sw.js 自己");
      console.log(`service worker：預存 ${assets.length} 個檔案`);
    }
  }

  // ---------- 提醒（不算錯誤） ----------
  const js = readdirSync(join(DIST, "assets")).filter((f) => f.endsWith(".js")).map((f) => read(`assets/${f}`)).join("\n");
  if (/cartocdn\.com[^"'`]*\?key=[A-Za-z0-9_.-]{8,}/.test(js)) console.warn("提醒：這次建置內含 CARTO 金鑰（VITE_CARTO_KEY），會出現在公開網站上，請確認 CARTO 後台有設網域限制。");
}

if (problems.length) {
  console.error(`\n建置檢查沒過（${problems.length} 項）：\n- ${problems.join("\n- ")}\n`);
  process.exit(1);
}
console.log("建置檢查通過：標題、manifest、圖示尺寸、service worker 預存清單都正確。");
