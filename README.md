# 臺灣地震風險評估 APP（earthquake-risk-app）

國立高雄科技大學地震風險評估實務專題的手機網頁 APP（PWA）。**數字來自真資料**：APP 讀取 [earthquake-risk-project](https://github.com/Azazelowo/earthquake-risk-project) 每 15 分鐘發布的 `feed.json`（`mock: false`），用統計模型算出「某地周圍、某段時間內、某規模以上至少發生一次地震」的機率，並和長期平常的機率比較。

> **這不是確定性的地震預報**，也不是預警。它給的是統計機率，大部分時間各地都接近平常；模型無法事先指出哪一次地震會是大地震。

網址：<https://azazelowo.github.io/earthquake-risk-app/>（push 到 `main` 後由 GitHub Actions 自動測試、建置、部署）

- **大眾版**：自動定位、在手機上判斷所在鄉鎮區，看「周圍 50 km、3 天內、M5 以上」和平常比幾倍。
- **首頁其他卡片**：大地震後的餘震卡、全台排行、「幫我找」條件掃描、半徑／時間／規模滑桿、我的情境（只存本機）、分享網址（GPS 位置預設不附）。
- **專家版**：風險地圖（點地圖換圓心、半徑滑桿、全螢幕、五種免金鑰底圖＋CARTO、平滑化）、機率對規模、機率對時間、驗證與原理、資料下載。
- **最近的地震**：手機直接讀 ExpTech 地震報告，**只顯示、不進入風險計算**；發布時間之後的地震會標「還沒算進風險數字」。
- **歷史回放**（`#/history`）：用事後整理的目錄重算過去大地震前後的數字，**不是當時真的發布的預測**。
- **ⓘ 頁**：目前條件的提醒、使用前說明、資料狀態、位置與隱私、安裝與更新、CARTO 金鑰、資料來源與授權。
- **可安裝**：Android（Chrome 選單「安裝應用程式」）、iPhone（Safari「分享 → 加入主畫面」）；安裝後沒網路也能開。

模型與資料管線在 [earthquake-risk-project](https://github.com/Azazelowo/earthquake-risk-project)（`app/hazard_core.py`、`app/live_update.py`）。設計與各項決定的理由見 [docs/DESIGN.md](docs/DESIGN.md)。

## 資料狀態（要先知道的）

| 項目 | 內容 |
|---|---|
| 正式目錄 | 中央氣象署地震目錄（GDMS 正式目錄），通常比現在晚 1～2 個月 |
| 暫時資料 | 正式目錄之後的空窗，用中央氣象署有感地震報告＋美國地質調查所（USGS）暫時補上；兩者都只收較大的地震，所以近期小地震會缺 |
| 缺口造成的低估 | feed 內附評估（`data_status.undercount_by_horizon`），APP 的 ⓘ 頁會顯示。例：2026-11-20 的 feed 正式目錄到 2026-09-29（空窗約 51 天、暫時補入 20 筆），總數可能低估約 12～19%（3 天約 17%）。這是缺口評估，不是誤差保證 |
| 更新 | 外部定時服務每 15 分鐘觸發破專題的 GitHub Actions；超過 1 小時沒更新，APP 標示「資料過期」 |
| 離線 | 連不上時用上次成功的資料（標示時間）；從沒成功過才退回示意用假資料並明確標示 |
| 模型網格 | 0.2°，北緯 21–26°、東經 119–123°；金門、連江在範圍外 |

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
  data/feed.ts        下載、驗證、快取 feed.json
  data/mock.ts        示意用假資料（測試，以及從沒連上過時的退路）
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
- **地震資料**：風險計算用中央氣象署（正式目錄與有感地震報告）與美國地質調查所（USGS），見 earthquake-risk-project；「最近的地震」列表用 ExpTech 地震報告（只顯示）。

## 限制

- 不是地震預報；算的是全部地震（含餘震）的統計機率。
- **大地震剛發生後的幾個小時不確定性大**：v1.2 起依規模先估計餘震（v1.1 的 alpha＝0 讓主震後 2 分鐘只剩實際的約 8%）；回測中 1 天內約高估 1.6 倍、7 天大致相符，參數受少數大序列影響。深度 > 40 km 的地震不加這一項。
- **機率用複合卜瓦松換算**：P = 1 − exp(−N/κ)，κ 約 1.77（地震成群發生，原本的卜瓦松換算會高估「至少一次」約 1.4–1.9 倍）；κ 只用 1995–2014 年估，2015 年後檢驗 36 組條件中 35 組變準。M6 仍偏高約 1.1–1.3 倍。
- **「回測涵蓋範圍」不等於「可信度高」**：AUC 只代表分辨得出哪裡比較可能發生，機率準不準要看「預測÷實際」；最接近的回測組地震數少於 20 個時，APP 改標「回測樣本有限」。
- 模型網格只涵蓋北緯 21–26°、東經 119–123°；範圍外顯示「目前模型未涵蓋此區域」。
- 地磁前兆經置換檢定沒有證據，不使用。
- 鄉鎮區界線簡化後最多差 61 公尺；交界附近只顯示「XX區附近」。
