// 前端資料格式（feed.json）。破專題 repo 每 15 分鐘由 GitHub Actions 產生；雛型階段由 mock.ts 產生同格式的假資料。
// 設計原則：後端只給「每格、每個時間長度在 M≥m_ref 的期望數」，規模換算與範圍加總在手機上算（很輕）。

export interface Feed {
  version: 1;
  /** true＝假資料（雛型）。畫面會一直顯示提示條。 */
  mock: boolean;
  /** 發布時間（模型「現在」），ISO 8601 含時區 */
  issued_at: string;
  grid: { lat_min: number; lat_max: number; lon_min: number; lon_max: number; deg: number };
  /** kappa：機率換算的群聚係數（舊 feed 沒有這欄，載入時補 1＝卜瓦松） */
  params: { b: number; m_ref: number; kappa: number };
  /** 10 個時間長度（天），遞增 */
  horizons_days: number[];
  /** 每格西南角 */
  cells: { lat: number[]; lon: number[] };
  /** n_full[格][時間]：完整模型（背景＋近期活動）在 M≥m_ref 的期望數 */
  n_full: number[][];
  /** n_bg[格][時間]：「平常」——已用 background_rescale 換算過的只有背景模型 */
  n_bg: number[][];
  data_status: DataStatus;
  recent: RecentEvent[];
  backtest: BacktestRow[];
}

export interface DataStatus {
  /** 正式目錄（GDMS）最後一筆時間 */
  catalog_end: string;
  /** 正式目錄之後用暫時資料（CWA 有感報告＋USGS）補的天數 */
  gap_days: number;
  n_provisional: number;
  sources: string[];
  /** 缺口評估：暫時資料小地震不完整 → 總數可能低估的比例（0.13＝最多低估約 13%），依時間長度 */
  undercount_by_horizon: Record<string, number>;
}

export interface RecentEvent {
  time: string;
  lat: number;
  lon: number;
  depth_km: number;
  ml: number;
  source: "GDMS" | "CWA" | "USGS";
}

export interface BacktestRow {
  m: number;
  horizon_days: number;
  auc: number;
  /** 預測÷實際：>1 高估、<1 低估 */
  ratio: number;
  n_events: number;
}
