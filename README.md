# 臺灣地震風險評估 APP（earthquake-risk-app）

國立高雄科技大學地震風險評估實務專題的手機網頁 APP（PWA）。**目前的數字都是假資料**；畫面與操作已依手機試用回饋調整（v0.2），下一步才接真資料。

網址：<https://azazelowo.github.io/earthquake-risk-app/>（push 到 `main` 後由 GitHub Actions 自動測試、建置、部署）

- **大眾版**：自動定位、在手機上判斷所在鄉鎮區，看「周圍 50 km、3 天內、M5 以上」和平常比幾倍。
- **專家版**：風險地圖（點地圖換圓心、半徑滑桿、全螢幕、五種免金鑰底圖＋CARTO、平滑化）、機率對規模、機率對時間、驗證與原理、資料下載。
- **ⓘ 頁**：目前條件的提醒、使用前說明、資料狀態、位置與隱私、安裝與更新、CARTO 金鑰、資料來源與授權。
- **可安裝**：Android（Chrome 選單「安裝應用程式」）、iPhone（Safari「分享 → 加入主畫面」）；安裝後沒網路也能開。

模型與資料管線在 [earthquake-risk-project](https://github.com/Azazelowo/earthquake-risk-project)（`app/hazard_core.py`、`app/live_update.py`）。設計與各項決定的理由見 [docs/DESIGN.md](docs/DESIGN.md)。

## 開發

需要 Node 24（Windows：`C:\Program Files\nodejs`）。

```bash
npm install
npm run dev      # http://localhost:5173 ，同網路的手機可用電腦 IP 開
npm test         # 單元測試（vitest）
npm run build    # 型別檢查 → 建置 → 產生 service worker → 建置檢查（scripts/check-dist.mjs）
npm run preview  # 用正式建置的結果開（service worker 只在這裡啟用）
```

- 手機透過區網 `http://` 開時，瀏覽器不允許定位（需要 HTTPS），會自動改成選縣市；部署到 GitHub Pages 後就能定位。
- 開發模式（`npm run dev`）**不註冊** service worker，避免快取讓「改了程式卻看到舊畫面」。

### 重新產生的資料檔（平常不必跑）

| 檔案 | 產生方式 | 什麼時候要重跑 |
|---|---|---|
| `public/icons/*.png` | `python scripts/make_icons.py`（需要 Pillow） | 改了圖示設計 |
| `src/data/towns.topo.json`、`src/geo/towns.fixture.json` | `node scripts/build-towns.mjs <TOWN_MOI_xxxxxxx.shp>`（用 mapshaper，不放進專案相依） | 國土測繪中心發布新版鄉鎮市區界線 |

### CARTO 底圖金鑰

CARTO 底圖需要金鑰。**金鑰不進 git**：使用者在 APP 的 ⓘ 頁貼上自己的金鑰（只存在那支裝置）。
也可以在建置時用環境變數 `VITE_CARTO_KEY`（例如 `.env.local`）內建，但金鑰會出現在公開網站的 JS 裡，
啟用前務必在 CARTO 後台把金鑰限制在網站的網域。

## 結構

```
src/
  main.ts             進入點：路由、事件、定位、啟動流程
  state.ts            位置、條件、縣市清單、本機儲存（存檔前降低座標精度）
  format.ts           狀態門檻、數字與距離格式
  pwa.ts              service worker 註冊、安裝、更新
  core/hazard.ts      機率計算（對應 hazard_core.py）、模型網格涵蓋判斷
  data/schema.ts      feed.json 格式
  data/mock.ts        雛型用假資料
  data/towns.topo.json 鄉鎮市區界線（簡化）
  geo/towns.ts        鄉鎮區本機判斷（誤差上限、「附近」）
  ui/public.ts        大眾版首頁與面板
  ui/info.ts          ⓘ 說明與資料狀態頁
  ui/disclaimer.ts    使用前說明視窗
  ui/expert.ts        專家版各頁、地圖設定面板
  ui/map.ts           Leaflet 地圖（跨重畫保留）
  ui/basemaps.ts      底圖清單與 CARTO 金鑰
  ui/smooth.ts        地圖平滑化（只是顯示效果）
  ui/chart.ts         SVG 折線圖
pwa/sw.js             service worker 樣板（建置時填入檔案清單與版本）
scripts/              圖示、界線檔、建置檢查
```

## 資料來源與授權

- **行政區界線**：內政部國土測繪中心「鄉鎮市區界線(TWD97經緯度)」1140318 版，經簡化（[data.gov.tw/dataset/7441](https://data.gov.tw/dataset/7441)）。此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。政府資料開放授權條款：<https://data.gov.tw/license>
- **地圖底圖**：© OpenStreetMap contributors；OpenTopoMap（CC-BY-SA）；圖資來源：內政部國土測繪中心；© CARTO。各自的條款整理在 [docs/DESIGN.md §8](docs/DESIGN.md)。
- **地震資料**：接上真資料後為中央氣象署與美國地質調查所（USGS），見 earthquake-risk-project。

## 限制

- 不是地震預報；預報的是全部地震（含餘震）。
- 模型網格只涵蓋北緯 21–26°、東經 119–123°；範圍外顯示「目前模型未涵蓋此區域」。
- 地磁前兆經置換檢定沒有證據，不使用。
- 鄉鎮區界線簡化後最多差 61 公尺；交界附近只顯示「XX區附近」。
