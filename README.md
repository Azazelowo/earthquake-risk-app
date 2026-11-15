# 地震風險評估 APP（earthquake-risk-app）

國立高雄科技大學地震風險評估實務專題的手機網頁 APP（PWA）。**目前是雛型，所有數字都是假資料。**

- 大眾版：自動定位，看「周圍 50 km、3 天內、M5 以上」和平常比幾倍。
- 專家版：風險地圖、機率對規模、機率對時間、驗證與原理、資料下載。

模型與資料管線在 [earthquake-risk-project](https://github.com/Azazelowo/earthquake-risk-project)（`app/hazard_core.py`、`app/live_update.py`）。設計見 [docs/DESIGN.md](docs/DESIGN.md)。

## 開發

需要 Node 24（Windows：`C:\Program Files\nodejs`）。

```bash
npm install
npm run dev      # http://localhost:5173 ，同網路的手機可用電腦 IP 開
npm run build    # 型別檢查＋輸出 dist/
```

手機透過區網 `http://` 開時，瀏覽器不允許定位（需要 HTTPS），會自動改成選縣市；部署到 GitHub Pages（HTTPS）後就能定位。

## 結構

```
src/
  core/hazard.ts    機率計算（對應 hazard_core.py）
  data/schema.ts    feed.json 格式
  data/mock.ts      雛型用假資料
  state.ts          位置、條件、縣市清單、本機儲存
  format.ts         狀態門檻、數字格式
  ui/public.ts      大眾版首頁與面板
  ui/expert.ts      專家版各頁
  ui/map.ts         Leaflet 地圖
  ui/chart.ts       SVG 折線圖
```

## 限制

- 不是地震預報；預報的是全部地震（含餘震）。
- 地磁前兆經置換檢定沒有證據，不使用。
- 地圖底圖：© OpenStreetMap contributors。
