# AGENTS.md

沿用破專題（earthquake-risk-project）的 `AGENTS.md`：繁體中文（台灣用語）、先分析再動手、不虛構 API 與數據、區分事實／理論／推測。

本 repo 額外規則：

- **計算必須和 `app/hazard_core.py` 一致**；改 `src/core/hazard.ts` 要同步更新對照測試。
- **「平常」一律用 `background_rescale` 換算後的值**（後端匯出時已換算）。
- **措辭**：不可讓人以為完全安全（不用「安全」「無需注意」、不用綠色）；每處都要能看出「不是地震預報」。
- **位置不得送出**：定位只在手機端計算。
- **外部服務**：ExpTech 地震模擬器只放連結並標註「資料來源：ExpTech Studio 地震模擬器」與原始網址；ExpTech API 要先查條款才可串接。
- 建立公開 repo、push、開 Pages 前先問使用者。
- Windows 用 `C:\Program Files\nodejs` 的 Node 24；C 槽空間有限，不要裝大型相依套件。
