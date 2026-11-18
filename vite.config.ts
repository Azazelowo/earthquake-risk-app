import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * 建置完成後產生 dist/sw.js。
 * 為什麼不用現成的 PWA 套件：它會帶進一大串相依（Workbox、Babel），C 槽空間有限；
 * 我們只需要「把輸出檔清單與版本雜湊填進樣板」這一件事，三十行就夠，也比較看得懂。
 */
function swPlugin(): Plugin {
  let outDir = "dist";
  return {
    name: "eqrisk-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push(relative(outDir, full).replace(/\\/g, "/"));
        }
      };
      walk(outDir);
      // icons/ 只有安裝時由系統讀取，不必預存；sw.js 不能快取自己；
      // history/ 是歷史回放的資料（十幾份、共約 2 MB），點開才下載（看過的由 runtime 快取留著），不預存
      const assets = files
        .filter((f) => f !== "sw.js" && !f.startsWith("icons/") && !f.startsWith("history/") && !f.endsWith(".map"))
        .sort();
      const hash = createHash("sha256");
      for (const f of assets) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest("hex").slice(0, 12);
      const template = readFileSync(resolve(__dirname, "pwa/sw.js"), "utf8");
      // 標記必須各出現剛好一次：少了代表樣板被改壞，多了代表有人把標記寫進註解（會換錯地方）
      for (const mark of ["__VERSION__", "__ASSETS__"])
        if (template.split(mark).length !== 2) throw new Error(`pwa/sw.js 裡的 ${mark} 應該剛好出現一次`);
      const out = template.replace("__VERSION__", version).replace("__ASSETS__", JSON.stringify(assets));
      writeFileSync(join(outDir, "sw.js"), out);
      console.log(`service worker：版本 ${version}，預存 ${assets.length} 個檔案`);
    },
  };
}

function commitId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

// base 用相對路徑：GitHub Pages 的子路徑（/earthquake-risk-app/）與本機都能直接開
export default defineConfig({
  base: "./",
  server: { host: true },
  plugins: [swPlugin()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_COMMIT__: JSON.stringify(commitId()),
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
