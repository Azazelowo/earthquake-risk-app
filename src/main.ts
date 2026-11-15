// 進入點：hash 路由（GitHub Pages 不必設定伺服器轉址）、事件委派、定位。
import "./style.css";
import { makeMockFeed } from "./data/mock";
import type { State, Cond } from "./state";
import { COUNTIES, DEFAULT_COND, loadSaved, save, nearestCounty } from "./state";
import { renderPublic, renderPlaceSheet, renderCondSheet } from "./ui/public";
import { renderExpert, renderTabbar, type ExpertTab } from "./ui/expert";
import { mountMap, unmountMap } from "./ui/map";

const saved = loadSaved();
const fallback = COUNTIES.find((c) => c.name === "高雄市")!;
const s: State = {
  feed: makeMockFeed(),
  place: saved.place ?? { lat: fallback.lat, lon: fallback.lon, label: "高雄市", source: "default" },
  cond: saved.cond ?? { ...DEFAULT_COND },
  locate: "idle",
  mapLayer: "ratio",
  scope: "point",
};
let sheet: "" | "place" | "cond" = "";

const app = document.getElementById("app")!;

function route(): { mode: "public" } | { mode: "expert"; tab: ExpertTab } {
  const m = location.hash.match(/^#\/expert\/(map|mag|time|verify|more)/);
  return m ? { mode: "expert", tab: m[1] as ExpertTab } : { mode: "public" };
}

function render() {
  const r = route();
  const expert = r.mode === "expert";
  unmountMap();
  app.innerHTML = `
  <header class="top">
    <div class="brand"><img src="./icon.svg" alt=""><span>地震風險</span></div>
    <div class="mode seg">
      <a href="#/" class="${expert ? "" : "on"}">大眾</a>
      <a href="#/expert/${expert ? r.tab : "map"}" class="${expert ? "on" : ""}">專家</a>
    </div>
  </header>
  ${s.feed.mock ? `<div class="mockbar">雛型：所有數字都是假資料，只用來試操作</div>` : ""}
  <main class="${expert ? "with-tabbar" : ""}">${expert ? renderExpert(s, r.tab) : renderPublic(s)}</main>
  ${expert ? renderTabbar(r.tab) : `<footer class="foot">高科大地震風險評估實務專題・不是地震預報</footer>`}
  <div class="scrim ${sheet ? "show" : ""}" data-act="close"></div>
  <div class="sheet ${sheet ? "show" : ""}">${sheet === "place" ? renderPlaceSheet(s) : sheet === "cond" ? renderCondSheet(s) : ""}</div>`;
  if (expert && r.tab === "map") requestAnimationFrame(() => mountMap(s));
}

function locate() {
  if (!("geolocation" in navigator)) {
    s.locate = "denied";
    return render();
  }
  s.locate = "pending";
  render();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      s.place = { lat, lon, label: `目前位置（${nearestCounty(lat, lon)}附近）`, source: "gps" };
      s.locate = "ok";
      save(s);
      render();
    },
    () => {
      s.locate = "denied";
      render();
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60e3 },
  );
}

app.addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-act],[data-county],[data-cond],[data-scope],[data-layer],[data-apply]");
  if (!t) return;
  const d = t.dataset;
  if (d.act === "pick-place") sheet = "place";
  else if (d.act === "edit-cond") sheet = "cond";
  else if (d.act === "close") sheet = "";
  else if (d.act === "locate") (sheet = ""), locate();
  else if (d.act === "reset-cond") s.cond = { ...DEFAULT_COND };
  else if (d.act === "download") return download();
  else if (d.county) {
    const c = COUNTIES.find((x) => x.name === d.county)!;
    s.place = { lat: c.lat, lon: c.lon, label: c.name, source: "county" };
    s.locate = "idle";
    sheet = "";
  } else if (d.cond) s.cond = { ...s.cond, [d.cond as keyof Cond]: +d.v! };
  else if (d.scope) s.scope = d.scope as State["scope"];
  else if (d.layer) s.mapLayer = d.layer as State["mapLayer"];
  else if (d.apply) {
    if (d.goto) return void (location.hash = d.goto);
    s.cond = { ...s.cond, ...JSON.parse(d.apply) };
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  save(s);
  render();
});

function download() {
  const blob = new Blob([JSON.stringify(s.feed)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "feed.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

window.addEventListener("hashchange", () => {
  sheet = "";
  render();
  window.scrollTo(0, 0);
});

render();
// 第一次開、或上次用 GPS：自動定位；使用者選過縣市就尊重他的選擇
if (!saved.place || saved.place.source === "gps") locate();
