// 歷史回放的資料：清單檢查（檔名只能是安全的代碼）、public/history 裡的每一份都通過 feed 檢查。
import { describe, expect, it } from "vitest";
import { findSnapshot, loadHistoryFeed, validateHistoryIndex } from "./history";
import { validateFeed } from "./feed";
import { pickMainshock } from "../core/aftershock";

// public/history 的檔案用 Vite 的 import.meta.glob 讀（測試環境是 Node，但不必引入 Node 的型別）
const all = import.meta.glob("../../public/history/*.json", { eager: true, import: "default" }) as Record<string, unknown>;
const fileOf = (name: string) => all[`../../public/history/${name}`];
const index = fileOf("index.json") as { quakes: Record<string, unknown>[] };

describe("歷史回放清單", () => {
  it("實際的清單：四個地震、每個四個時間點", () => {
    const idx = validateHistoryIndex(index);
    expect(idx.quakes.map((q) => q.id)).toEqual(["2016-meinong", "2018-hualien", "2022-chishang", "2024-hualien"]);
    for (const q of idx.quakes) expect(q.snapshots.map((s) => s.label)).toEqual(["主震前 1 小時", "主震後 1 小時", "主震後 1 天", "主震後 7 天"]);
    expect(findSnapshot(idx, "2024-hualien-after1h")?.quake.ml).toBeGreaterThanOrEqual(7);
    expect(findSnapshot(idx, "nope")).toBeNull();
  });

  it("代碼只能是小寫英數與連字號（會拿來組網址）；壞掉的整筆丟掉", () => {
    const good = index.quakes[0];
    const bad = [
      { ...good, id: "../../etc" },
      { ...good, snapshots: [{ id: "../x", label: "壞", issued_at: "2020-01-01T00:00:00Z" }] },
      { ...good, ml: "7" },
      null,
    ];
    expect(validateHistoryIndex({ quakes: [good, ...bad] }).quakes).toHaveLength(1);
    expect(() => validateHistoryIndex({ quakes: bad })).toThrow();
    expect(() => validateHistoryIndex(null)).toThrow();
  });

  it("載入時間點前先檢查代碼", async () => {
    await expect(loadHistoryFeed("../secret", (async () => new Response("{}")) as typeof fetch)).rejects.toThrow("代碼");
  });
});

describe("public/history 裡的每一份資料", () => {
  const files = Object.keys(all).map((k) => k.split("/").pop()!).filter((f) => f !== "index.json");

  it("清單上的每個時間點都有檔案，沒有多餘的檔案", () => {
    const ids = validateHistoryIndex(index).quakes.flatMap((q) => q.snapshots.map((s) => `${s.id}.json`));
    expect(files.sort()).toEqual(ids.sort());
  });

  it("都通過 feed 檢查，發布時間和清單一致，地震列表只有那個時間之前的", () => {
    const idx = validateHistoryIndex(index);
    for (const f of files) {
      const feed = validateFeed(fileOf(f));
      const snap = findSnapshot(idx, f.replace(/\.json$/, ""))!;
      expect(feed.issued_at).toBe(snap.snap.issued_at);
      expect(feed.mock).toBe(false);
      for (const e of feed.recent) expect(Date.parse(e.time)).toBeLessThan(Date.parse(feed.issued_at));
    }
  });

  it("主震後的時間點，首頁的餘震卡會挑到那個主震", () => {
    const idx = validateHistoryIndex(index);
    for (const q of idx.quakes) {
      const feed = validateFeed(fileOf(`${q.id}-after1h.json`));
      expect(pickMainshock(feed)?.ml).toBeCloseTo(q.ml, 1);
    }
  });
});
