/* 記録の保存。
 * Storage … 端末への保存（今はブラウザの localStorage。アプリ化したら Capacitor Preferences に差し替える）
 * Records … 自己ベストの管理
 * Leaderboard … ランキング（アプリ版で Game Center やサーバーにつなぐ場所。今は何もしない） */
const Storage = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できない環境でも遊べるようにする */ }
  },
};

const Records = {
  KEY: 'yamanote-sanpo.records.v2', // v2：一周が目標のルール（v1 の記録は使わない）
  empty() { return { bestStations: 0, bestStationName: '', bestKm: 0, bestTimeMs: null, plays: 0, clears: 0, stamps: [] }; },
  load() { return Object.assign(this.empty(), Storage.get(this.KEY, {})); },
  /* run = { cleared, stations, stationName, km, timeMs, stamps, date }
     一周タイムは競う対象ではなく、ゴールしたときの記録として残す */
  submit(run) {
    const r = this.load();
    const res = { newDistance: false, newTime: false, prev: Object.assign({}, r) };
    r.plays += 1;
    if (run.cleared) r.clears += 1;
    if (run.km > r.bestKm + 1e-6) {
      r.bestKm = run.km; r.bestStations = run.stations; r.bestStationName = run.stationName; res.newDistance = true;
    }
    if (run.cleared && (r.bestTimeMs == null || run.timeMs < r.bestTimeMs)) { r.bestTimeMs = run.timeMs; res.newTime = true; }
    if (!Array.isArray(r.stamps)) r.stamps = [];
    res.newStamps = (run.stamps || []).filter(i => !r.stamps.includes(i));
    r.stamps = r.stamps.concat(res.newStamps).sort((a, b) => a - b);
    Storage.set(this.KEY, r);
    res.records = r;
    Leaderboard.submit(run);
    return res;
  },
};

const Leaderboard = {
  enabled: false,
  submit(run) { if (!this.enabled) return Promise.resolve(null); /* アプリ版でここに送信処理を書く */ return Promise.resolve(null); },
  fetchTop() { return Promise.resolve([]); },
};
