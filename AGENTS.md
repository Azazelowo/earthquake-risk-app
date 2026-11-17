# AGENTS.md

沿用破專題（earthquake-risk-project）的 `AGENTS.md`：繁體中文（台灣用語）、先分析再動手、不虛構 API 與數據、區分事實／理論／推測。

本 repo 額外規則：

- **計算必須和 `app/hazard_core.py` 一致**；改 `src/core/hazard.ts` 要同步更新對照測試。
- **「平常」一律用 `background_rescale` 換算後的值**（後端匯出時已換算）。
- **措辭**：不可讓人以為完全安全（不用「安全」「無需注意」、不用綠色）；每處都要能看出「不是地震預報」。
- **模型範圍外不給數字**：位置在網格外或範圍大半在外時，顯示「目前模型未涵蓋此區域」（`assessPoint().covered`）。
- **位置不得送出**：定位與鄉鎮區判斷只在手機端計算（`src/geo/towns.ts`），不呼叫任何「座標轉行政區」的 API。
- **地圖平滑化只是顯示效果**：不重算更細的網格、不重做回測；點選顯示的數字一律取原始格子。
- **service worker 不攔截其他網站的請求**（地圖圖磚）：OSM 禁止預抓與離線、CARTO 禁止長期快取與伺服器代理。
- **金鑰不進 git**：CARTO 金鑰由使用者在 ⓘ 頁輸入（只存裝置），或建置時的 `VITE_CARTO_KEY`；`.env*` 已列入 `.gitignore`。
- **外部服務**：ExpTech 地震模擬器只放連結並標註「資料來源：ExpTech Studio 地震模擬器」與原始網址；ExpTech API 要先查條款才可串接（條款重點：讓使用者直接連 API、不要經自己的伺服器轉發；TREM 資料不可用於預測）。
- **`npm test` 與 `npm run build`（含 `scripts/check-dist.mjs`）都要過**；CI 沒過不會部署。
- 建立公開 repo、push、開 Pages 前先問使用者（使用者已同意：每個開發階段完成就 commit、push）。
- Windows 用 `C:\Program Files\nodejs` 的 Node 24；C 槽空間有限，不要裝大型相依套件（界線簡化工具 mapshaper 不放進專案）。
