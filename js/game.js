/* 山手線一周さんぽ — ゲーム本体（描画・操作・進行） */
(function () {
  'use strict';

  // ---------- 調整用の数値 ----------
  const CFG = {
    speed: 14,            // 歩く速さ（ゲーム内の単位/秒）。ずっと一定
    targetSec: 600,       // ノーミスで一周したときの秒数（約10分）
    hpMax: 100,
    drain: [1.7, 2.9],    // 体力の減り方（序盤→終盤 / 秒）
    rowGap: [22, 8.5],    // 障害物の間隔（序盤→終盤）
    doubleChance: [0, 0.7], // 2つ並ぶ確率
    itemChance: [0.64, 0.35],
    late: { from: 18, item: 0.6, drain: 1.12, double: 0.1, gap: 0.92 }, // 池袋(18駅目)から先を厳しくする
    items: { onigiri: { heal: 20, w: 20 }, water: { heal: 12, w: 35 }, snack: { heal: 7, w: 45 } },
    obstacles: { garbage: { dmg: 12 }, rotten: { dmg: 20 }, thug: { dmg: 28 }, drunk: { dmg: 16 }, gull: { dmg: 14 }, robot: { dmg: 16 },
      bike: { dmg: 22 }, walker: { dmg: 12 }, cart: { dmg: 14 }, cat: { dmg: 10 }, flyer: { dmg: 12 } },
  };
  const CAM_H = 4.2, CAM_BACK = 4, NEAR = 0.6, DRAW = 120;
  const LANE = 1.7, ROAD = 2.7, WALK = 4.3;
  const FONT = '"Dela Gothic One","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';
  const FONT_B = '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","Hiragino Sans",sans-serif';

  const N = STATIONS.length;
  const TOTAL_KM = STATIONS.reduce((a, s) => a + s.km, 0);
  const UPK = CFG.targetSec * CFG.speed / TOTAL_KM; // 1kmあたりの単位
  const L = TOTAL_KM * UPK;
  const segStart = []; { let a = 0; for (const s of STATIONS) { segStart.push(a); a += s.km * UPK; } }

  // ---------- 小道具 ----------
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mul = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
  const css = (c, al) => al == null ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al})`;
  function hash(a, b, c) {
    let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
  }
  const wrapZ = (z) => ((z % L) + L) % L;
  function stationIndexAt(z) { z = wrapZ(z); for (let k = N - 1; k >= 0; k--) if (segStart[k] <= z) return k; return 0; }
  for (const k in THEMES) {
    const t = THEMES[k];
    t.groundC = hex(t.ground); t.walkC = hex(t.walk); t.roadC = hex(t.road); t.winC = hex(t.win);
    t.treeC = hex(t.tree); t.colorsC = t.colors.map(hex); t.flowersC = t.flowers ? hex(t.flowers) : null;
  }
  const themeAt = (z) => THEMES[STATIONS[stationIndexAt(z)].theme];

  // ---------- 画面 ----------
  const stage = document.getElementById('stage');
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, F = 0, HOR = 0, FEET = 0;
  const app = document.getElementById('app');
  function resize() {
    // 画面の大きさは実際の要素の大きさから計算する（埋め込み表示でも縦長に収める）
    const aw = app.clientWidth || window.innerWidth || document.documentElement.clientWidth;
    const ah = app.clientHeight || window.innerHeight || document.documentElement.clientHeight;
    stage.style.width = (ah > 300 ? Math.min(aw, ah * 0.62) : aw) + 'px';
    const r = stage.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    F = W * 0.8; FEET = H * 0.83; HOR = FEET - CAM_H * F / CAM_BACK;
    buildSkyline();
  }

  // ---------- 時間帯（進むほど 朝→昼→夕方→夜） ----------
  const SKY = [
    [0.00, '#8fd0f2', '#fde6cf'], [0.30, '#4ea6e6', '#d2ecff'], [0.52, '#5f8fd0', '#f3dcb8'],
    [0.66, '#55508e', '#f59a68'], [0.80, '#232a5a', '#b86b7d'], [1.00, '#0c1233', '#2f3a74'],
  ].map(s => [s[0], hex(s[1]), hex(s[2])]);
  function skyAt(p) {
    for (let i = 0; i < SKY.length - 1; i++) {
      const a = SKY[i], b = SKY[i + 1];
      if (p <= b[0]) { const t = (p - a[0]) / (b[0] - a[0]); return [mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
    }
    const l = SKY[SKY.length - 1]; return [l[1], l[2]];
  }
  let skyline = [];
  function buildSkyline() {
    skyline = []; let x = -0.2;
    while (x < 1.2) { const w = rand(0.02, 0.07); skyline.push({ x, w, h: rand(0.01, 0.07) * (Math.random() < 0.15 ? 2 : 1), lit: Math.random() }); x += w + rand(0, 0.01); }
  }

  // ---------- 絵（アイテム・障害物） ----------
  function mk(w, h, fn) { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); return c; }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  const SPR = {
    onigiri: mk(128, 128, (g) => {
      g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = '#3b3530'; g.fillStyle = '#fffdf6';
      g.beginPath(); g.moveTo(64, 12); g.quadraticCurveTo(76, 12, 112, 92); g.quadraticCurveTo(120, 116, 96, 118);
      g.lineTo(32, 118); g.quadraticCurveTo(8, 116, 16, 92); g.quadraticCurveTo(52, 12, 64, 12); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#1f2e26'; rr(g, 40, 74, 48, 46, 5); g.fill();
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(46, 80, 4, 34);
      g.fillStyle = '#d64545'; g.beginPath(); g.arc(64, 58, 7, 0, 7); g.fill();
    }),
    water: mk(80, 150, (g) => {
      g.lineWidth = 5; g.strokeStyle = '#2a5f8a';
      g.fillStyle = '#ffffff'; rr(g, 26, 4, 28, 18, 4); g.fill(); g.stroke();
      g.fillStyle = 'rgba(150,210,245,.95)'; rr(g, 12, 22, 56, 122, 16); g.fill(); g.stroke();
      g.fillStyle = '#2f8fd8'; g.fillRect(14, 64, 52, 40);
      g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.beginPath(); g.moveTo(18, 86); g.quadraticCurveTo(30, 74, 40, 86); g.quadraticCurveTo(52, 98, 62, 84); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(20, 30, 6, 28);
    }),
    snack: mk(80, 160, (g) => {
      g.fillStyle = '#b58a55'; g.fillRect(37, 8, 6, 150);
      [['#f6a6bd', 30], ['#fbf7ee', 70], ['#9ccf72', 110]].forEach(([c, y]) => {
        g.fillStyle = c; g.strokeStyle = '#5b4636'; g.lineWidth = 5; g.beginPath(); g.arc(40, y, 24, 0, 7); g.fill(); g.stroke();
        g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(32, y - 8, 6, 0, 7); g.fill();
      });
    }),
    garbage: mk(128, 128, (g) => {
      g.fillStyle = '#2a2d33'; g.strokeStyle = '#101114'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(64, 28); g.bezierCurveTo(120, 34, 126, 120, 96, 122); g.lineTo(32, 122); g.bezierCurveTo(2, 120, 8, 34, 64, 28); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(54, 30); g.lineTo(46, 8); g.lineTo(64, 20); g.lineTo(82, 8); g.lineTo(74, 30); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 4; g.beginPath(); g.moveTo(36, 60); g.quadraticCurveTo(30, 90, 40, 110); g.stroke();
      g.fillStyle = '#c9c9c9'; g.save(); g.translate(98, 104); g.rotate(-0.5); g.fillRect(-10, -16, 20, 30); g.fillStyle = '#d84a3a'; g.fillRect(-10, -6, 20, 8); g.restore();
    }),
    rotten: mk(128, 128, (g) => {
      g.strokeStyle = '#6c8a3a'; g.lineWidth = 5; g.lineCap = 'round';
      for (const x of [40, 64, 88]) { g.beginPath(); g.moveTo(x, 54); g.quadraticCurveTo(x - 10, 40, x, 28); g.quadraticCurveTo(x + 10, 16, x, 4); g.stroke(); }
      g.fillStyle = '#e4e0d4'; g.strokeStyle = '#4b4438'; g.beginPath(); g.ellipse(64, 100, 58, 20, 0, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#7d6b3a'; g.beginPath(); g.ellipse(64, 90, 40, 18, 0, Math.PI, 0); g.fill();
      g.fillStyle = '#8fa23e'; [[50, 82, 8], [74, 78, 10], [62, 86, 6]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); });
      g.fillStyle = '#222'; [[26, 40], [104, 30]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.fillStyle = 'rgba(200,220,255,.8)'; g.beginPath(); g.ellipse(x - 4, y - 6, 4, 6, -0.5, 0, 7); g.ellipse(x + 4, y - 6, 4, 6, 0.5, 0, 7); g.fill(); g.fillStyle = '#222'; });
    }),
    thug: mk(128, 230, (g) => {
      g.lineJoin = 'round'; g.strokeStyle = '#1c1420'; g.lineWidth = 5;
      g.fillStyle = '#2b2234'; g.fillRect(36, 150, 22, 72); g.fillRect(70, 150, 22, 72); g.strokeRect(36, 150, 22, 72); g.strokeRect(70, 150, 22, 72);
      g.fillStyle = '#111'; rr(g, 28, 214, 32, 14, 6); g.fill(); rr(g, 68, 214, 32, 14, 6); g.fill();
      g.fillStyle = '#7b3fa0'; g.beginPath(); g.moveTo(26, 70); g.lineTo(102, 70); g.lineTo(112, 176); g.lineTo(16, 176); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#f4f0e6'; g.beginPath(); g.moveTo(52, 70); g.lineTo(76, 70); g.lineTo(64, 110); g.closePath(); g.fill();
      g.fillStyle = '#6a3290'; rr(g, 22, 104, 84, 26, 12); g.fill(); g.stroke(); // 腕組み
      g.fillStyle = '#f0c8a0'; g.beginPath(); g.arc(64, 46, 24, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#15121a'; g.beginPath(); g.moveTo(38, 40); g.quadraticCurveTo(40, 6, 88, 10); g.quadraticCurveTo(104, 14, 100, 26); g.quadraticCurveTo(80, 22, 88, 36); g.lineTo(40, 40); g.fill();
      g.fillStyle = '#111'; rr(g, 42, 40, 18, 10, 3); g.fill(); rr(g, 66, 40, 18, 10, 3); g.fill(); g.fillRect(58, 42, 10, 3);
      g.strokeStyle = '#7a3b2a'; g.lineWidth = 4; g.beginPath(); g.moveTo(54, 60); g.lineTo(74, 58); g.stroke();
    }),
  };
  // 人の形を描く共通の下書き（正面向き）
  function person(g, o) {
    g.lineJoin = 'round'; g.strokeStyle = '#1f1a1a'; g.lineWidth = 5;
    g.fillStyle = o.legs; g.fillRect(34, 140, 18, 62); g.fillRect(58, 140, 18, 62); g.strokeRect(34, 140, 18, 62); g.strokeRect(58, 140, 18, 62);
    g.fillStyle = '#222'; rr(g, 28, 196, 26, 12, 5); g.fill(); rr(g, 56, 196, 26, 12, 5); g.fill();
    g.fillStyle = o.body; rr(g, 22, 62, 66, 88, 14); g.fill(); g.stroke();
    g.fillStyle = o.skin || '#f0c8a0'; g.beginPath(); g.arc(55, 38, 22, 0, 7); g.fill(); g.stroke();
    g.fillStyle = o.hair || '#2a2220'; g.beginPath(); g.arc(55, 32, 22, Math.PI, 0); g.fill();
  }
  Object.assign(SPR, {
    drunk: mk(110, 210, (g) => {
      person(g, { legs: '#3b3f4a', body: '#6b7080' });
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(45, 62); g.lineTo(65, 62); g.lineTo(55, 84); g.fill();
      g.fillStyle = '#d8343a'; g.fillRect(52, 66, 7, 40);
      g.fillStyle = '#d8343a'; g.fillRect(30, 22, 50, 8); // 頭にネクタイ
      g.fillStyle = '#ff8a8a'; g.beginPath(); g.arc(42, 44, 6, 0, 7); g.arc(68, 44, 6, 0, 7); g.fill();
      g.strokeStyle = '#1f1a1a'; g.lineWidth = 3; g.beginPath(); g.moveTo(42, 37); g.lineTo(50, 37); g.moveTo(60, 37); g.lineTo(68, 37); g.stroke();
      g.fillStyle = '#c8a46a'; g.strokeStyle = '#5b4636'; g.lineWidth = 4; rr(g, 70, 112, 32, 24, 4); g.fill(); g.stroke(); // おみやげ
    }),
    gull: mk(150, 90, (g) => {
      g.fillStyle = '#f7f7f4'; g.strokeStyle = '#3a3f46'; g.lineWidth = 4; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(75, 50); g.quadraticCurveTo(40, 10, 4, 30); g.quadraticCurveTo(40, 34, 70, 62); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(75, 50); g.quadraticCurveTo(110, 10, 146, 30); g.quadraticCurveTo(110, 34, 80, 62); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#5d6670'; g.beginPath(); g.moveTo(4, 30); g.lineTo(22, 22); g.lineTo(20, 34); g.fill(); g.beginPath(); g.moveTo(146, 30); g.lineTo(128, 22); g.lineTo(130, 34); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(75, 58, 14, 18, 0, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#f2b134'; g.beginPath(); g.moveTo(70, 62); g.lineTo(80, 62); g.lineTo(75, 78); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.arc(69, 52, 3, 0, 7); g.arc(81, 52, 3, 0, 7); g.fill();
    }),
    robot: mk(110, 120, (g) => {
      g.strokeStyle = '#2a3340'; g.lineWidth = 5; g.lineJoin = 'round';
      g.fillStyle = '#f3f5f7'; rr(g, 10, 22, 90, 72, 14); g.fill(); g.stroke();
      g.fillStyle = '#2f8fe0'; g.fillRect(12, 70, 86, 10);
      g.fillStyle = '#1d2530'; rr(g, 26, 34, 58, 24, 8); g.fill();
      g.fillStyle = '#7ff0ff'; g.beginPath(); g.arc(42, 46, 5, 0, 7); g.arc(68, 46, 5, 0, 7); g.fill();
      g.fillStyle = '#333'; for (const x of [22, 55, 88]) { g.beginPath(); g.arc(x, 102, 10, 0, 7); g.fill(); }
      g.strokeStyle = '#e8743b'; g.lineWidth = 3; g.beginPath(); g.moveTo(88, 22); g.lineTo(88, 2); g.stroke(); g.fillStyle = '#e8743b'; g.fillRect(88, 2, 16, 10);
    }),
    bike: mk(120, 210, (g) => {
      g.lineJoin = 'round';
      g.fillStyle = '#222'; rr(g, 52, 150, 16, 58, 8); g.fill(); // 前輪
      g.strokeStyle = '#999'; g.lineWidth = 6; g.beginPath(); g.moveTo(14, 112); g.lineTo(106, 112); g.stroke(); // ハンドル
      g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(60, 132, 9, 0, 7); g.fill(); // ライト
      g.strokeStyle = '#1f1a1a'; g.lineWidth = 5;
      g.fillStyle = '#3fa36b'; rr(g, 30, 52, 60, 66, 14); g.fill(); g.stroke();
      g.fillStyle = '#f0c8a0'; g.beginPath(); g.arc(60, 34, 20, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#e84a4a'; g.beginPath(); g.arc(60, 28, 22, Math.PI, 0); g.fill(); g.stroke(); // ヘルメット
      g.fillStyle = '#f0c8a0'; g.fillRect(16, 104, 14, 14); g.fillRect(90, 104, 14, 14);
    }),
    cat: mk(120, 90, (g) => {
      g.lineJoin = 'round'; g.strokeStyle = '#3a2a1a'; g.lineWidth = 4;
      g.fillStyle = '#f0a050'; g.beginPath(); g.ellipse(60, 62, 40, 24, 0, 0, 7); g.fill(); g.stroke();
      g.beginPath(); g.arc(60, 36, 22, 0, 7); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(40, 26); g.lineTo(44, 4); g.lineTo(56, 18); g.fill(); g.stroke(); g.beginPath(); g.moveTo(80, 26); g.lineTo(76, 4); g.lineTo(64, 18); g.fill(); g.stroke();
      g.strokeStyle = '#b86a2a'; g.lineWidth = 4; for (const x of [44, 60, 76]) { g.beginPath(); g.moveTo(x, 50); g.lineTo(x, 72); g.stroke(); }
      g.fillStyle = '#2b2b2b'; g.beginPath(); g.ellipse(52, 34, 4, 6, 0, 0, 7); g.ellipse(68, 34, 4, 6, 0, 0, 7); g.fill();
      g.fillStyle = '#e86a7a'; g.beginPath(); g.arc(60, 44, 3, 0, 7); g.fill();
    }),
    cart: mk(100, 130, (g) => {
      g.strokeStyle = '#3a2a2a'; g.lineWidth = 5; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(50, 4); g.lineTo(50, 30); g.stroke(); g.beginPath(); g.moveTo(34, 6); g.lineTo(66, 6); g.stroke();
      g.fillStyle = '#7a3a52'; rr(g, 16, 28, 68, 80, 10); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(255,220,150,.7)'; g.lineWidth = 3;
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(16, 42 + i * 18); g.lineTo(84, 42 + i * 18); g.stroke(); g.beginPath(); g.moveTo(28 + i * 16, 28); g.lineTo(28 + i * 16, 108); g.stroke(); }
      g.fillStyle = '#222'; g.beginPath(); g.arc(26, 116, 11, 0, 7); g.arc(74, 116, 11, 0, 7); g.fill();
    }),
    flyer: mk(130, 210, (g) => {
      person(g, { legs: '#2b2f3a', body: '#ffcf33' });
      g.fillStyle = '#ff7a1a'; g.fillRect(22, 92, 66, 10);
      g.fillStyle = '#ffffff'; g.strokeStyle = '#555'; g.lineWidth = 3;
      for (let i = 0; i < 3; i++) { g.save(); g.translate(98, 96); g.rotate(-0.4 + i * 0.25); g.fillRect(-4, -36, 26, 34); g.strokeRect(-4, -36, 26, 34); g.restore(); }
      g.fillStyle = '#f0c8a0'; g.beginPath(); g.arc(94, 98, 8, 0, 7); g.fill();
    }),
  });
  ['#4a7bd0', '#c0504d', '#5f8f4e'].forEach((c, i) => {
    SPR['walker' + i] = mk(110, 210, (g) => {
      person(g, { legs: '#2f3340', body: c, hair: ['#2a2220', '#6b4a2a', '#111'][i] });
      g.fillStyle = '#e8d8b8'; g.strokeStyle = '#1f1a1a'; g.lineWidth = 4; rr(g, 84, 104, 20, 30, 4); g.fill(); g.stroke();
    });
  });
  const ITEM_H = { onigiri: 0.95, water: 1.1, snack: 1.15, garbage: 1.0, rotten: 0.95, thug: 1.85,
    drunk: 1.8, gull: 0.75, robot: 0.95, bike: 1.9, cat: 0.6, cart: 1.05, flyer: 1.8, walker0: 1.75, walker1: 1.75, walker2: 1.75 };
  const SPEECH = { thug: ['おい！', '#c0283a'], drunk: ['ヒック', '#b0512a'], flyer: ['どうぞ〜', '#c06a00'], bike: ['チリン', '#2b6fb0'], robot: ['とおります', '#2b6fb0'] };

  // ---------- ゲームの状態 ----------
  const G = {
    state: 'title', dist: 0, lane: 0, px: 0, hp: CFG.hpMax, elapsed: 0,
    stagger: 0, invuln: 0, nextIdx: 1, ending: null, endT: 0, shake: 0, stepT: 0, beatT: 0,
    objs: [], scen: [], gates: [], fx: [], nextRow: 0, nextScene: { '-1': 0, '1': 0 }, nextLamp: 0, time: 0,
    hits: 0, picks: 0, clean: true, runStamps: [], seen: {}, windT: 4, windWarn: 0, windDir: 0, gust: 0, trainT: 2, qLane: null, qUntil: 0, nextBridge: 0,
  };
  const camZ = () => G.dist - CAM_BACK;
  const camX = () => G.px * 0.55;
  const progress = () => clamp(G.dist / L, 0, 1);

  function resetWorld(startDist) {
    G.dist = startDist; G.lane = 0; G.px = 0; G.hp = CFG.hpMax; G.elapsed = 0; G.stagger = 0; G.invuln = 0;
    G.nextIdx = 1; G.ending = null; G.endT = 0; G.shake = 0; G.hits = 0; G.picks = 0;
    G.clean = true; G.runStamps = []; G.seen = {}; G.windT = 4; G.windWarn = 0; G.gust = 0; G.trainT = 2; G.qLane = null; G.qUntil = 0; G.nextBridge = startDist;
    G.objs = []; G.scen = []; G.gates = []; G.fx = [];
    G.nextRow = startDist + 60; G.nextScene = { '-1': startDist - 8, '1': startDist - 8 }; G.nextLamp = Math.floor(startDist / 14) * 14;
    G.gateNext = 0;
    spawn();
  }

  // ---------- 生成 ----------
  // 終盤のきびしさ（池袋の少し手前から少しずつ効き始め、池袋の先で最大になる）
  function lateAt(p) {
    const p0 = segStart[CFG.late.from] / L;
    const t = clamp((p - (p0 - 0.02)) / 0.08, 0, 1);
    return t * t * (3 - 2 * t);
  }
  function rowGapAt(p) { return lerp(CFG.rowGap[0], CFG.rowGap[1], Math.pow(p, 0.8)) * lerp(1, CFG.late.gap, lateAt(p)); }
  function nearStation(z, r) { const zz = wrapZ(z); for (let i = 0; i <= N; i++) { const s = i < N ? segStart[i] : L; if (Math.abs(zz - s) < r) return true; } return false; }
  function pickWeighted(table) { let tot = 0; for (const k in table) tot += table[k]; let r = Math.random() * tot; for (const k in table) { r -= table[k]; if (r <= 0) return k; } return Object.keys(table)[0]; }

  const evOf = (si) => EVENTS[STATIONS[si].ev] || EVENTS.start;
  const STATIC = { garbage: 1, rotten: 1, walker: 1, bike: 1 }; // 2つ並べてもよい種類（動かない／まっすぐ）

  // 障害物を1つ作る（種類ごとに動き方を決める）
  function makeObj(kind, lane, z) {
    const o = { kind, x: lane * LANE, z, done: false, bad: true, prz: z - G.dist };
    const side = Math.random() < 0.5 ? -1 : 1;
    if (kind === 'thug') { o.mv = 'chase'; o.sp = 2.0; o.trig = 32; }
    else if (kind === 'flyer') { o.mv = 'chase'; o.sp = 3.2; o.trig = 20; }
    else if (kind === 'drunk') { o.mv = 'sway'; o.bx = o.x; o.ph = rand(0, 6); }
    else if (kind === 'gull') { o.mv = 'cross'; o.x = side * 4.8; o.vx = -side * rand(4.8, 6); o.trig = 25; o.fly = true; }
    else if (kind === 'robot') { o.mv = 'cross'; o.x = side * 3.3; o.vx = -side * 1.5; o.trig = 42; }
    else if (kind === 'cart') { o.mv = 'cross'; o.x = side * 3.1; o.vx = -side * 1.15; o.trig = 38; }
    else if (kind === 'cat') { o.mv = 'cross'; o.x = side * 4.2; o.vx = -side * rand(6.5, 8); o.trig = 15; }
    else if (kind === 'bike') { o.mv = 'oncoming'; o.vz = 8; }
    else if (kind === 'walker') { o.v = (Math.random() * 3) | 0; }
    return o;
  }

  function spawnRows(upto) {
    if (G.state !== 'playing') return;
    while (G.nextRow < upto) {
      const z = G.nextRow, p = clamp(z / L, 0, 1);
      if (z > L - 18) { G.nextRow = Infinity; break; }
      if (nearStation(z, 5)) { G.nextRow += 5; continue; }
      const si = stationIndexAt(z), ev = evOf(si);
      let lanes = [-1, 0, 1].sort(() => Math.random() - 0.5);
      const inQueue = G.qLane != null && z < G.qUntil;
      if (inQueue) lanes = lanes.filter(l => l !== G.qLane).concat([G.qLane]);
      let n = 1;
      if (p > 0.04 && Math.random() < lerp(CFG.doubleChance[0], CFG.doubleChance[1], p) + CFG.late.double * lateAt(p) + (ev.dbl || 0)) n = 2;
      if (p < 0.03 && Math.random() < 0.3) n = 0;
      if (ev.rest) n = Math.random() < 0.25 ? 1 : 0;
      if (inQueue) n = Math.min(n, 1);
      let special = false;
      if (!inQueue && ev.wave && Math.random() < ev.wave) { // 人の波：2人が並んで横切る（すき間は必ずある）
        const side = Math.random() < 0.5 ? -1 : 1, vx = -side * rand(2.2, 2.8);
        for (const off of [0, 3.4]) { const o = makeObj('walker', 0, z); o.mv = 'cross'; o.x = side * (4.2 + off); o.vx = vx; o.trig = 34; G.objs.push(o); }
        special = true;
      } else if (!inQueue && ev.queue && Math.random() < ev.queue) { // 行列：同じレーンに何人も並ぶ
        const ql = lanes[0];
        for (let k = 0; k < 5; k++) G.objs.push(makeObj('walker', ql, z + k * 2.3));
        G.qLane = ql; G.qUntil = z + 5 * 2.3 + 4; special = true;
      }
      if (!special) {
        for (let k = 0; k < n; k++) {
          const w = { garbage: 1, rotten: si >= KINDS.rotten.from ? lerp(0.4, 0.8, p) : 0, thug: si >= KINDS.thug.from ? lerp(0.25, 0.5, p) : 0,
            drunk: si >= KINDS.drunk.from ? 0.12 : 0, bike: si >= KINDS.bike.from ? 0.1 : 0 };
          for (const kk in ev.kinds) w[kk] = (w[kk] || 0) + ev.kinds[kk];
          if (n === 2) for (const kk in w) if (!STATIC[kk]) w[kk] = 0;
          G.objs.push(makeObj(pickWeighted(w), lanes[k], z));
        }
      }
      const ic = lerp(CFG.itemChance[0], CFG.itemChance[1], p) * lerp(1, CFG.late.item, lateAt(p)) * (ev.item || 1) * (ev.rest ? 2 : 1);
      if (Math.random() < ic) {
        const kind = pickWeighted({ onigiri: CFG.items.onigiri.w, water: CFG.items.water.w, snack: CFG.items.snack.w });
        const half = Math.random() < 0.5 || special;
        const lane = half ? pick([-1, 0, 1]) : lanes[Math.min(n, 2)];
        G.objs.push({ kind, x: lane * LANE, z: z + (half ? rowGapAt(p) * 0.5 : 0), done: false, bad: false });
      }
      G.nextRow += rowGapAt(p) * rand(0.85, 1.15) * (special ? 1.3 : 1);
    }
  }

  function spawnScenery(upto) {
    for (const side of [-1, 1]) {
      const key = String(side);
      while (G.nextScene[key] < upto) {
        const z = G.nextScene[key], th = themeAt(z);
        if (th.water && side === 1) { if (Math.random() < 0.35) G.scen.push({ t: 'ship', x: rand(11, 22), z: z + rand(0, 6), c: pick([[240, 240, 235], [220, 90, 70], [70, 120, 190]]) }); G.nextScene[key] += 6; continue; }
        if (th.track && side === -1) { G.nextScene[key] += 6; continue; }
        let kind = pick(th.kinds);
        if (kind === 'tree' || Math.random() < th.trees) {
          G.scen.push({ t: 'tree', x: side * (WALK + rand(0.9, 2.6)), z, h: rand(3.2, 5), c: th.treeC, fl: th.flowersC, seed: (Math.random() * 1e9) | 0 });
          if (Math.random() < 0.5) G.scen.push({ t: 'tree', x: side * (WALK + rand(3.5, 6)), z: z + rand(0.5, 1.5), h: rand(3.5, 6), c: mul(th.treeC, 0.9), fl: th.flowersC, seed: (Math.random() * 1e9) | 0 });
          G.nextScene[key] += rand(2.2, 4.2); continue;
        }
        let len = rand(6, 12), h = rand(th.hMin, th.hMax), dep = rand(6, 11);
        if (kind === 'house') { len = rand(4, 6.5); h = rand(3, 4.5); dep = rand(5, 7); }
        if (kind === 'temple') { len = rand(7, 10); h = 3.4; dep = 8; }
        if (kind === 'low') { h = Math.min(h, rand(3, 6)); len = rand(4, 7); }
        if (kind === 'museum') { len = rand(12, 18); h = rand(5, 7); }
        if (kind === 'warehouse') { len = rand(10, 16); h = rand(5, 9); }
        const x0 = side * (WALK + rand(0.4, 0.8));
        const b = { t: 'bldg', kind, side, x0, x1: x0 + side * dep, z0: z, z1: z + len, h, c: pick(th.colorsC), win: th.winC,
          deco: th.deco, words: th.words, seed: (Math.random() * 1e9) | 0, signs: [] };
        if ((th.deco === 'signs' || th.deco === 'neon' || th.deco === 'pastel' || th.deco === 'lantern') && th.words) {
          const cnt = th.deco === 'neon' ? 2 : 1;
          for (let i = 0; i < cnt; i++) {
            const sz = z + 0.8 + i * (len * 0.5);
            if (sz < z + len - 0.5 && h > 3) b.signs.push({ z: sz, word: pick(th.words), c: hex(pick(['#e8473f', '#f5b82e', '#2f8fe0', '#e64aa0', '#3fbf7a', '#9b5de5'])), y0: Math.min(2.8, h * 0.5), len: Math.min(h - 0.6, rand(2.6, 4.2)) });
          }
        }
        G.scen.push(b);
        G.nextScene[key] += len + rand(th.gap[0], th.gap[1]);
      }
    }
    while (G.nextLamp < upto) {
      for (const side of [-1, 1]) G.scen.push({ t: 'lamp', x: side * (WALK - 0.35), z: G.nextLamp + (side > 0 ? 7 : 0) });
      G.nextLamp += 14;
    }
    // ガード下の高架
    while (G.nextBridge < upto) {
      if (themeAt(G.nextBridge).bridges && !nearStation(G.nextBridge, 8)) { G.scen.push({ t: 'bridge', z: G.nextBridge, seed: (Math.random() * 1e9) | 0 }); G.nextBridge += rand(24, 34); }
      else G.nextBridge += 8;
    }
    // 駅の門
    while (true) {
      const lap = Math.floor(G.gateNext / N), i = G.gateNext % N;
      const gz = lap * L + segStart[i];
      if (gz > upto) break;
      if (gz > camZ() - 2) G.gates.push({ z: gz, i, goal: G.state === 'playing' && lap === 1 && i === 0, start: G.state === 'playing' && lap === 0 && i === 0 });
      G.gateNext++;
      if (G.state === 'playing' && G.gateNext > N) break;
    }
  }

  function spawn() {
    const cz = camZ();
    spawnScenery(cz + DRAW + 15);
    spawnRows(G.dist + 110);
    G.scen = G.scen.filter(s => (s.z1 != null ? s.z1 : s.z) > cz - 2 && !(s.t === 'train' && s.z0 > cz + DRAW + 60));
    G.objs = G.objs.filter(o => o.z > cz - 1 && !(o.done && o.gone));
    G.gates = G.gates.filter(g => g.z > cz - 2);
  }

  // ---------- 進行 ----------
  const HUD = {
    time: document.getElementById('hudTime'), hp: document.getElementById('hpFill'), hpBox: document.getElementById('hpBox'),
    next: document.getElementById('nextName'), nextDist: document.getElementById('nextDist'), count: document.getElementById('stCount'),
    map: document.getElementById('loopMap'), flash: document.getElementById('flash'), banner: document.getElementById('banner'),
    toast: document.getElementById('toast'), stampMark: document.getElementById('stampMark'),
  };
  const mapCtx = HUD.map.getContext('2d');
  let lastHud = {};
  function setText(el, s) { if (lastHud[el.id] !== s) { el.textContent = s; lastHud[el.id] = s; } }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  }

  function showBanner(i, opts = {}) {
    const st = STATIONS[i % N], th = THEMES[st.theme];
    const prev = STATIONS[(i - 1 + N) % N], next = STATIONS[(i + 1) % N];
    HUD.banner.innerHTML = `
      <div class="sign">
        <div class="sign-kana">${st.kana}</div>
        <div class="sign-name">${st.name}</div>
        <div class="sign-band"><span>← ${prev.name}</span><span class="sign-roma">${st.roma}</span><span>${next.name} →</span></div>
      </div>
      <div class="sign-sub">${opts.sub || th.label}</div>
      ${opts.note ? `<div class="sign-note">${opts.note}</div>` : ''}
      ${opts.stamp ? `<div class="stamp-get"><span class="stamp" style="--ink:${stampInk(opts.stampIdx)}">${STATIONS[opts.stampIdx].name}</span><b>スタンプGET！</b></div>` : ''}`;
    HUD.banner.classList.remove('show'); void HUD.banner.offsetWidth; HUD.banner.classList.add('show');
  }

  const INKS = ['#c8332f', '#2f6fb8', '#2f8a4e', '#8a3fa0', '#c06a10'];
  function stampInk(i) { return INKS[i % INKS.length]; }
  function passStation(i) {
    if (i >= N) { if (G.clean) G.runStamps.push(0); startEnding('clear'); return; }
    Sound.station();
    const got = G.clean; // 前の駅からノーミスならスタンプ
    if (got) { G.runStamps.push(i); setTimeout(() => Sound.stamp(), 350); }
    G.clean = true;
    showBanner(i, { sub: `${i}駅目　${THEMES[STATIONS[i].theme].label}`, note: EVENTS[STATIONS[i].ev].note, stamp: got, stampIdx: i });
  }
  let toastTimer = 0;
  function showToast(html) {
    HUD.toast.innerHTML = html; HUD.toast.classList.remove('show'); void HUD.toast.offsetWidth; HUD.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => HUD.toast.classList.remove('show'), 2600);
  }

  function startEnding(kind) {
    if (G.ending) return;
    G.ending = kind; G.endT = kind === 'clear' ? 2.6 : 1.8;
    if (kind === 'clear') {
      Sound.clear(); showBanner(0, { sub: 'ゴール！ 山手線一周 達成' });
      for (let i = 0; i < 80; i++) G.fx.push({ t: 'conf', x: rand(0, W), y: rand(-H * 0.5, 0), vx: rand(-30, 30), vy: rand(80, 200), c: pick(['#8cc63f', '#ffd23f', '#ff6b8b', '#4ec3ff', '#ffffff']), life: 3, r: rand(0, 6) });
    } else { Sound.over(); }
  }

  function addFloat(text, color) { G.fx.push({ t: 'txt', text, color, x: W / 2 + (G.px - camX()) * F / CAM_BACK, y: FEET - 130, life: 1 }); }

  function hitObj(o) {
    o.done = true;
    if (o.bad) {
      if (G.invuln > 0) return;
      const d = CFG.obstacles[o.kind].dmg;
      G.hp -= d; G.hits++; G.clean = false; G.stagger = 2.0; G.invuln = 1.0; G.shake = 0.3;
      Sound.hit(o.kind); addFloat(`-${d}`, '#ff5a5a');
      HUD.flash.classList.remove('on'); void HUD.flash.offsetWidth; HUD.flash.classList.add('on');
      if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) {}
    } else {
      const h = CFG.items[o.kind].heal;
      G.hp = Math.min(CFG.hpMax, G.hp + h); G.picks++; o.gone = true;
      Sound.pickup(o.kind); addFloat(`+${h}`, '#7ee06a');
      for (let i = 0; i < 8; i++) G.fx.push({ t: 'spark', x: W / 2 + (G.px - camX()) * F / CAM_BACK, y: FEET - 70, vx: rand(-120, 120), vy: rand(-220, -60), life: 0.6, c: o.kind === 'water' ? '#7fd3ff' : '#fff2a8' });
    }
  }

  function updateTrains(dt) {
    for (const t of G.scen) if (t.t === 'train') { t.z0 -= t.v * dt; t.z1 -= t.v * dt; }
    G.trainT -= dt;
    if (G.trainT <= 0) {
      G.trainT = rand(5, 8);
      const z = G.dist + 120;
      if (themeAt(z).track || themeAt(G.dist + 40).track) { G.scen.push({ t: 'train', z0: z, z1: z + 44, v: 24, x0: -6.0, x1: -8.6, h: 3.6 }); if (themeAt(G.dist).track) Sound.train(); }
    }
  }
  function update(dt) {
    G.time += dt;
    if (G.state !== 'paused') updateTrains(dt);
    if (G.state === 'paused') return;
    if (G.state === 'title') {
      G.dist += 6 * dt; G.px += (0 - G.px) * Math.min(1, dt * 5);
      spawn(); return;
    }
    if (G.state !== 'playing') return;
    const p = progress();
    if (G.ending) {
      G.endT -= dt;
      if (G.ending === 'clear') G.dist += CFG.speed * 0.4 * dt;
      if (G.endT <= 0) { finish(); return; }
    } else {
      G.elapsed += dt;
      if (G.stagger > 0) G.stagger -= dt;
      if (G.invuln > 0) G.invuln -= dt;
      const sm = G.stagger > 0 ? 1 - 0.85 * Math.min(1, G.stagger / 1.2) : 1;
      G.dist += CFG.speed * sm * dt;
      G.hp -= lerp(CFG.drain[0], CFG.drain[1], p) * lerp(1, CFG.late.drain, lateAt(p)) * dt;
      // 足音・心音
      G.stepT -= dt * sm; if (G.stepT <= 0) { G.stepT = 0.42; Sound.step(); }
      if (G.hp < 25) { G.beatT -= dt; if (G.beatT <= 0) { G.beatT = 0.9; Sound.beat(); } }
      while (G.nextIdx <= N && G.dist >= (G.nextIdx < N ? segStart[G.nextIdx] : L)) { passStation(G.nextIdx); G.nextIdx++; }
      // ビル風（新宿）：予告のあと横に押される
      const ev = evOf(stationIndexAt(G.dist));
      if (ev.wind && !nearStation(G.dist, 6)) {
        if (G.windWarn > 0) { G.windWarn -= dt; if (G.windWarn <= 0) { G.lane = clamp(G.lane + G.windDir, -1, 1); G.gust = 0.6; Sound.wind(); } }
        else { G.windT -= dt; if (G.windT <= 0) { G.windT = rand(3.2, 5.2); G.windDir = G.lane === -1 ? 1 : G.lane === 1 ? -1 : pick([-1, 1]); G.windWarn = 1.0; } }
      } else G.windWarn = 0;
      if (G.gust > 0) G.gust -= dt;
      // 障害物の動き と 当たり判定
      for (const o of G.objs) {
        if (o.done) continue;
        const rz = o.z - G.dist;
        if (o.mv === 'chase') { if (rz < o.trig && rz > 1) o.x += clamp(G.lane * LANE - o.x, -o.sp * dt, o.sp * dt); }
        else if (o.mv === 'cross') { if (rz < o.trig) o.x += o.vx * dt; }
        else if (o.mv === 'sway') { o.x = clamp(o.bx + Math.sin(G.time * 1.7 + o.ph) * 1.9, -LANE - 0.2, LANE + 0.2); }
        else if (o.mv === 'oncoming') { if (rz < 60) { o.z -= o.vz * dt; if (!o.rang && rz < 45) { o.rang = true; Sound.bell(); } } }
        if (o.bad && !G.seen[o.kind] && rz < 55 && Math.abs(o.x) < 5) {
          G.seen[o.kind] = true;
          if (o.kind !== 'garbage') showToast(`<b>はじめて登場</b>${KINDS[o.kind].name}<small>${KINDS[o.kind].tip}</small>`);
        }
        const rz2 = o.z - G.dist;
        const crossed = (o.prz > 0.6 && rz2 < -0.6);
        if ((Math.abs(rz2) < 0.6 || crossed) && Math.abs(o.x - G.px) < (o.bad ? 0.95 : 1.1)) hitObj(o);
        o.prz = rz2;
      }
      if (G.hp <= 0) { G.hp = 0; startEnding('over'); }
    }
    const tx = G.lane * LANE; G.px += clamp(tx - G.px, -18 * dt, 18 * dt);
    if (G.shake > 0) G.shake -= dt;
    spawn();
  }

  // ---------- 描画 ----------
  let night = 0, fogC = [200, 200, 200], dark = 1;
  const xs = (x, s) => W / 2 + (x - camX()) * s;
  const ys = (y, s) => HOR + (CAM_H - y) * s;
  function fogAt(rz) { return clamp((rz - 35) / (DRAW - 35), 0, 1) * 0.88; }
  function shadeC(c, rz, f = 1) { return css(mix(mul(c, f * dark), fogC, fogAt(rz))); }
  function quad(x1, y1, x2, y2, x3, y3, x4, y4) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill(); }

  function drawSky(p) {
    const [top, bot] = skyAt(p);
    fogC = bot;
    const g = ctx.createLinearGradient(0, 0, 0, HOR);
    g.addColorStop(0, css(top)); g.addColorStop(1, css(bot));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, HOR + 2);
    // 太陽と月
    const sunP = clamp(p / 0.72, 0, 1);
    const sx = W * (0.15 + sunP * 0.7), sy = HOR - Math.sin(sunP * Math.PI) * HOR * 0.75 + HOR * 0.12;
    if (p < 0.76) { ctx.fillStyle = css(mix([255, 246, 210], [255, 150, 90], clamp((p - 0.5) / 0.25, 0, 1)), 0.95); ctx.beginPath(); ctx.arc(sx, sy, W * 0.05, 0, 7); ctx.fill(); }
    if (night > 0.05) {
      ctx.fillStyle = `rgba(255,255,240,${night * 0.9})`; ctx.beginPath(); ctx.arc(W * 0.78, HOR * 0.3, W * 0.035, 0, 7); ctx.fill();
      ctx.fillStyle = css(top); ctx.beginPath(); ctx.arc(W * 0.795, HOR * 0.29, W * 0.03, 0, 7); ctx.fill();
      for (let i = 0; i < 40; i++) { const a = hash(i, 7, 3), b = hash(i, 9, 1); ctx.fillStyle = `rgba(255,255,255,${night * 0.7 * hash(i, 3, 3)})`; ctx.fillRect(a * W, b * HOR * 0.7, 1.5, 1.5); }
    }
    // 遠くの街並み
    const scC = mix(bot, mul(top, 0.6), 0.35);
    ctx.fillStyle = css(scC);
    const off = -camX() * 4;
    for (const b of skyline) ctx.fillRect(b.x * W + off, HOR - b.h * H, b.w * W + 1, b.h * H + 2);
    if (night > 0.2) {
      for (const b of skyline) { if (b.lit < 0.6) { ctx.fillStyle = `rgba(255,220,140,${night * 0.6})`; ctx.fillRect(b.x * W + off + b.w * W * 0.4, HOR - b.h * H * 0.6, 1.5, 1.5); } }
    }
  }

  function drawGround() {
    const cz = camZ(), STRIP = 2;
    const zStart = Math.floor((cz + NEAR) / STRIP) * STRIP;
    const zFar = zStart + Math.ceil(DRAW / STRIP) * STRIP;
    ctx.fillStyle = css(fogC); ctx.fillRect(0, HOR, W, H - HOR);
    for (let z = zFar; z >= zStart; z -= STRIP) {
      const za = Math.max(z, cz + NEAR), zb = z + STRIP;
      if (zb <= cz + NEAR) continue;
      const ra = za - cz, rb = zb - cz, sa = F / ra, sb = F / rb;
      const ya = HOR + CAM_H * sa, yb = HOR + CAM_H * sb;
      const th = themeAt(z), alt = (Math.floor(z / STRIP) & 1) ? 1 : 0.93;
      const fr = (ra + rb) / 2;
      ctx.fillStyle = shadeC(th.groundC, fr, alt); ctx.fillRect(0, yb, W, ya - yb + 1);
      if (th.water) {
        ctx.fillStyle = shadeC([70, 130, 175], fr, alt * (1 + 0.08 * Math.sin(z * 0.7 + G.time * 2)));
        quad(xs(WALK + 0.4, sa), ya, W, ya, W, yb, xs(WALK + 0.4, sb), yb);
      }
      if (th.track) {
        ctx.fillStyle = shadeC([128, 120, 108], fr, alt); quad(0, ya, xs(-WALK - 0.4, sa), ya, xs(-WALK - 0.4, sb), yb, 0, yb);
        ctx.fillStyle = shadeC([90, 80, 70], fr, 1);
        if (Math.floor(z / STRIP) % 1 === 0) for (const cx of [-7.3, -10.0]) quad(xs(cx - 1.0, sa), ya, xs(cx + 1.0, sa), ya, xs(cx + 1.0, sa), ya - Math.max(1, 0.12 * sa), xs(cx - 1.0, sa), ya - Math.max(1, 0.12 * sa));
        ctx.fillStyle = shadeC([200, 200, 205], fr, 1);
        for (const cx of [-7.3, -10.0]) for (const r of [-0.55, 0.55]) quad(xs(cx + r - 0.05, sa), ya, xs(cx + r + 0.05, sa), ya, xs(cx + r + 0.05, sb), yb, xs(cx + r - 0.05, sb), yb);
        ctx.fillStyle = shadeC([110, 115, 110], fr, 1); // 柵
        quad(xs(-WALK - 0.35, sa), ya, xs(-WALK - 0.25, sa), ya, xs(-WALK - 0.25, sb), yb, xs(-WALK - 0.35, sb), yb);
      }
      ctx.fillStyle = shadeC(th.walkC, fr, alt);
      quad(xs(-WALK, sa), ya, xs(WALK, sa), ya, xs(WALK, sb), yb, xs(-WALK, sb), yb);
      ctx.fillStyle = shadeC(th.roadC, fr, 1);
      quad(xs(-ROAD, sa), ya, xs(ROAD, sa), ya, xs(ROAD, sb), yb, xs(-ROAD, sb), yb);
      if (th.crosswalk && (Math.floor(z / 30) % 2 === 0) && (Math.floor(z / STRIP) % 15 < 3)) {
        ctx.fillStyle = shadeC([235, 235, 235], fr, 1);
        for (let k = -5; k < 5; k++) { const x1 = k * 0.54 + 0.1, x2 = x1 + 0.3; quad(xs(x1, sa), ya, xs(x2, sa), ya, xs(x2, sb), yb, xs(x1, sb), yb); }
      } else if (Math.floor(z / STRIP) % 3 === 0) {
        ctx.fillStyle = shadeC([236, 232, 220], fr, 1);
        for (const lx of [-LANE / 2, LANE / 2]) quad(xs(lx - 0.05, sa), ya, xs(lx + 0.05, sa), ya, xs(lx + 0.05, sb), yb, xs(lx - 0.05, sb), yb);
      }
      ctx.fillStyle = shadeC([190, 188, 180], fr, 1);
      for (const ex of [-ROAD, ROAD]) quad(xs(ex - 0.08, sa), ya, xs(ex + 0.08, sa), ya, xs(ex + 0.08, sb), yb, xs(ex - 0.08, sb), yb);
    }
  }

  function winLit(b, r, c) { return hash(b.seed, r, c) < 0.55; }

  function drawBldg(b) {
    const cz = camZ();
    const za = Math.max(b.z0, cz + NEAR), zb = b.z1;
    if (zb <= cz + NEAR) return;
    const ra = za - cz, rb = zb - cz;
    if (ra > DRAW + 5) return;
    const sa = F / ra, sb = F / rb, fr = ra;
    const fog = fogAt(fr);
    const xa = xs(b.x0, sa), xb = xs(b.x0, sb);
    const y0a = ys(0, sa), y1a = ys(b.h, sa), y0b = ys(0, sb), y1b = ys(b.h, sb);
    // 横の面（道路側）
    ctx.fillStyle = shadeC(b.c, fr, 0.78);
    quad(xa, y0a, xa, y1a, xb, y1b, xb, y0b);
    // 窓
    const winDay = mix(mul(b.win, 0.75), b.c, 0.25);
    const lit = [255, 214, 130];
    const colW = 1.6;
    const style = b.kind === 'glass' ? [1.45, 1.25] : b.kind === 'warehouse' ? [0.6, 0.5] : b.kind === 'house' ? [0.9, 0.9] : [0.85, 0.8];
    if (b.kind !== 'temple' && fog < 0.75) {
      const rows = b.kind === 'warehouse' ? 1 : Math.floor((b.h - 1.0) / 1.4);
      const cols = Math.floor((b.z1 - b.z0 - 0.4) / colW);
      if (ra < 45 && b.kind !== 'house') {
        for (let c = 0; c < cols; c++) {
          const wz0 = b.z0 + 0.3 + c * colW + (colW - style[0]) / 2, wz1 = wz0 + style[0];
          if (wz0 < cz + NEAR) continue;
          const s0 = F / (wz0 - cz), s1 = F / (wz1 - cz);
          const x0 = xs(b.x0, s0), x1 = xs(b.x0, s1);
          for (let r = 0; r < rows; r++) {
            const wy0 = b.kind === 'warehouse' ? b.h - 1.6 : 1.1 + r * 1.4, wy1 = wy0 + style[1];
            if (ys(wy1, s0) < -10) break;
            const on = night > 0.3 && winLit(b, r, c);
            ctx.fillStyle = on ? css(mix(lit, fogC, fog * 0.5)) : shadeC(winDay, fr, (r + c) & 1 ? 1 : 0.92);
            quad(x0, ys(wy0, s0), x0, ys(wy1, s0), x1, ys(wy1, s1), x1, ys(wy0, s1));
          }
        }
      } else if (b.kind !== 'house') {
        for (let r = 0; r < rows; r++) {
          const wy0 = b.kind === 'warehouse' ? b.h - 1.6 : 1.1 + r * 1.4, wy1 = wy0 + style[1] * 0.8;
          const on = night > 0.3 && winLit(b, r, 99);
          ctx.fillStyle = on ? css(mix(lit, fogC, fog * 0.6), 0.8) : shadeC(winDay, fr, 0.95);
          quad(xa, ys(wy0, sa), xa, ys(wy1, sa), xb, ys(wy1, sb), xb, ys(wy0, sb));
        }
      }
    }
    // 屋根の上面
    if (b.h < CAM_H) {
      ctx.fillStyle = shadeC(b.c, fr, 1.08);
      quad(xs(b.x0, sa), y1a, xs(b.x1, sa), y1a, xs(b.x1, sb), y1b, xs(b.x0, sb), y1b);
    }
    // 正面
    const front = b.z0 >= cz + NEAR;
    if (front) {
      const fx0 = xs(b.x0, sa), fx1 = xs(b.x1, sa);
      ctx.fillStyle = shadeC(b.c, fr, 0.95);
      ctx.fillRect(Math.min(fx0, fx1), y1a, Math.abs(fx1 - fx0), y0a - y1a);
      if (b.kind === 'house' || b.kind === 'low') {
        // 窓と入口
        const w = Math.abs(fx1 - fx0), dir = Math.sign(fx1 - fx0);
        ctx.fillStyle = night > 0.3 ? css(mix(lit, fogC, fog)) : shadeC(b.win, fr, 0.8);
        ctx.fillRect(fx0 + dir * w * 0.2 - (dir < 0 ? w * 0.22 : 0), ys(2.4, sa), w * 0.22, 0.8 * sa);
        ctx.fillStyle = shadeC([90, 70, 55], fr, 1);
        ctx.fillRect(fx0 + dir * w * 0.6 - (dir < 0 ? w * 0.18 : 0), ys(1.8, sa), w * 0.18, 1.8 * sa);
      } else if (b.kind !== 'temple' && ra < 60) {
        const dep = Math.abs(b.x1 - b.x0), cols = Math.floor(dep / colW), rows = Math.floor((b.h - 1.0) / 1.4);
        for (let r = 0; r < rows; r++) {
          const y = ys(1.1 + r * 1.4 + style[1], sa); if (y < -10) break;
          for (let c = 0; c < cols; c++) {
            const wx = b.x0 + b.side * (0.4 + c * colW);
            const on = night > 0.3 && winLit(b, r, c + 50);
            ctx.fillStyle = on ? css(mix(lit, fogC, fog * 0.5)) : shadeC(winDay, fr, 0.9);
            const x0 = xs(wx, sa), x1 = xs(wx + b.side * style[0], sa);
            ctx.fillRect(Math.min(x0, x1), y, Math.abs(x1 - x0), style[1] * sa);
          }
        }
      }
      // 三角屋根
      if (b.kind === 'house') {
        ctx.fillStyle = shadeC(mix(b.c, [120, 60, 50], 0.6), fr, 1);
        ctx.beginPath(); ctx.moveTo(fx0, y1a); ctx.lineTo(fx1, y1a); ctx.lineTo((fx0 + fx1) / 2, ys(b.h + 1.6, sa)); ctx.closePath(); ctx.fill();
      }
    }
    if (b.kind === 'house') { // 屋根の横
      ctx.fillStyle = shadeC(mix(b.c, [120, 60, 50], 0.6), fr, 0.8);
      const xm = b.x0 + (b.x1 - b.x0) / 2;
      quad(xs(b.x0, sa), y1a, xs(xm, sa), ys(b.h + 1.6, sa), xs(xm, sb), ys(b.h + 1.6, sb), xs(b.x0, sb), y1b);
    }
    if (b.kind === 'temple') {
      const rc = [60, 55, 52], ox = b.x0 - b.side * 1.0, xm = b.x0 + (b.x1 - b.x0) / 2;
      ctx.fillStyle = shadeC(rc, fr, 0.85);
      quad(xs(ox, sa), ys(b.h - 0.6, sa), xs(xm, sa), ys(b.h + 2.2, sa), xs(xm, sb), ys(b.h + 2.2, sb), xs(ox, sb), ys(b.h - 0.6, sb));
      if (front) { ctx.fillStyle = shadeC(rc, fr, 1); ctx.beginPath(); ctx.moveTo(xs(ox, sa), ys(b.h - 0.6, sa)); ctx.lineTo(xs(b.x1 + b.side * 1.0, sa), ys(b.h - 0.6, sa)); ctx.lineTo(xs(xm, sa), ys(b.h + 2.2, sa)); ctx.closePath(); ctx.fill(); }
      // 柱
      ctx.fillStyle = shadeC([170, 50, 40], fr, 1);
      for (let z = b.z0 + 0.5; z < b.z1; z += 2) { if (z < cz + NEAR) continue; const s = F / (z - cz); const x = xs(b.x0 - b.side * 0.2, s); ctx.fillRect(x - 0.12 * s, ys(b.h - 0.6, s), 0.24 * s, (b.h - 0.6) * s); }
    }
    // 飾り
    if (b.deco === 'lantern') {
      for (let z = b.z0 + 0.6; z < b.z1; z += 1.3) {
        if (z < cz + NEAR + 0.3) continue; const s = F / (z - cz); const x = xs(b.x0 - b.side * 0.3, s), y = ys(2.4, s);
        if (night > 0.2) { ctx.fillStyle = `rgba(255,120,80,${0.25 * night})`; ctx.beginPath(); ctx.arc(x, y, 0.6 * s, 0, 7); ctx.fill(); }
        ctx.fillStyle = shadeC([225, 60, 50], z - cz, night > 0.3 ? 1.6 : 1); ctx.beginPath(); ctx.ellipse(x, y, 0.2 * s, 0.28 * s, 0, 0, 7); ctx.fill();
      }
    }
    if (b.deco === 'awning' || b.deco === 'pastel') {
      const cols = b.deco === 'pastel' ? [[255, 160, 200], [255, 255, 255], [160, 220, 255], [255, 255, 255]] : [[200, 60, 50], [245, 240, 230], [60, 120, 70], [245, 240, 230]];
      const ci = b.seed % 2 ? 0 : 2;
      for (let z = b.z0 + 0.2, k = 0; z < b.z1 - 0.2; z += 0.8, k++) {
        const z1 = Math.min(z + 0.8, b.z1 - 0.2); if (z < cz + NEAR) continue;
        const s0 = F / (z - cz), s1 = F / (z1 - cz);
        ctx.fillStyle = shadeC(cols[(ci + (k & 1)) % 4], z - cz, 1);
        const xi = b.x0, xo = b.x0 - b.side * 0.9;
        quad(xs(xi, s0), ys(2.7, s0), xs(xi, s1), ys(2.7, s1), xs(xo, s1), ys(2.1, s1), xs(xo, s0), ys(2.1, s0));
      }
    }
    if (b.deco === 'screen' && b.h > 6) {
      const z0 = Math.max(b.z0 + 1, cz + NEAR), z1 = b.z1 - 1;
      if (z1 > z0) {
        const s0 = F / (z0 - cz), s1 = F / (z1 - cz), x0 = xs(b.x0 - b.side * 0.05, s0), x1 = xs(b.x0 - b.side * 0.05, s1);
        const yA = b.h * 0.45, yB = Math.min(b.h - 0.5, yA + 4);
        const hue = (G.time * 40 + b.seed % 360) % 360;
        ctx.fillStyle = `hsl(${hue},75%,${55 - fog * 20}%)`;
        quad(x0, ys(yA, s0), x0, ys(yB, s0), x1, ys(yB, s1), x1, ys(yA, s1));
        const m = (Math.sin(G.time * 2 + b.seed) + 1) / 2, zm = lerp(z0, z1, m), sm = F / (zm - cz);
        ctx.fillStyle = `hsla(${(hue + 160) % 360},85%,70%,0.9)`;
        ctx.beginPath(); ctx.arc(xs(b.x0, sm), ys((yA + yB) / 2, sm), (yB - yA) * 0.3 * sm, 0, 7); ctx.fill();
      }
    }
    for (const sg of b.signs) {
      if (sg.z < cz + NEAR + 0.5) continue;
      const s = F / (sg.z - cz), rz = sg.z - cz;
      const xA = xs(b.x0 - b.side * 0.1, s), xB = xs(b.x0 - b.side * 0.85, s);
      const yT = ys(sg.y0 + sg.len, s), yBt = ys(sg.y0, s);
      const neon = b.deco === 'neon';
      if (neon && night > 0.2) { ctx.fillStyle = css(sg.c, 0.25 * night); ctx.fillRect(Math.min(xA, xB) - 0.3 * s, yT - 0.3 * s, Math.abs(xB - xA) + 0.6 * s, yBt - yT + 0.6 * s); }
      ctx.fillStyle = neon ? shadeC([30, 30, 40], rz, 1) : shadeC(sg.c, rz, night > 0.4 ? 1.3 : 1);
      ctx.fillRect(Math.min(xA, xB), yT, Math.abs(xB - xA), yBt - yT);
      const fs = Math.abs(xB - xA) * 0.72;
      if (fs > 5) {
        ctx.fillStyle = neon ? css(mix(sg.c, [255, 255, 255], 0.35 + 0.3 * night)) : '#fff';
        ctx.font = `${fs | 0}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const chars = [...sg.word], step = Math.min(fs * 1.05, (yBt - yT) / chars.length);
        const cx = (xA + xB) / 2; let y = yT + (yBt - yT - step * chars.length) / 2 + step / 2;
        for (const ch of chars) { ctx.fillText(ch, cx, y); y += step; }
      }
    }
  }

  function drawTree(t) {
    const rz = t.z - camZ(); if (rz < NEAR) return;
    const s = F / rz, x = xs(t.x, s), yb = ys(0, s);
    ctx.fillStyle = shadeC([110, 80, 55], rz, 1); ctx.fillRect(x - 0.13 * s, ys(t.h * 0.45, s), 0.26 * s, t.h * 0.45 * s);
    const r = t.h * 0.3 * s;
    ctx.fillStyle = shadeC(t.c, rz, 0.85); ctx.beginPath(); ctx.arc(x, ys(t.h * 0.62, s), r, 0, 7); ctx.fill();
    ctx.fillStyle = shadeC(t.c, rz, 1.05); ctx.beginPath(); ctx.arc(x - r * 0.25, ys(t.h * 0.75, s), r * 0.75, 0, 7); ctx.fill();
    if (t.fl) { ctx.fillStyle = shadeC(t.fl, rz, 1); for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x + (hash(t.seed, i, 1) - 0.5) * r * 1.4, ys(t.h * (0.5 + hash(t.seed, i, 2) * 0.35), s), 0.12 * s, 0, 7); ctx.fill(); } }
    void yb;
  }

  function drawLamp(l) {
    const rz = l.z - camZ(); if (rz < NEAR) return;
    const s = F / rz, x = xs(l.x, s);
    ctx.fillStyle = shadeC([70, 74, 80], rz, 1); ctx.fillRect(x - 0.05 * s, ys(3.4, s), 0.1 * s, 3.4 * s);
    ctx.fillRect(x - 0.25 * s, ys(3.45, s), 0.5 * s, 0.12 * s);
    if (night > 0.2) { ctx.fillStyle = `rgba(255,230,160,${0.22 * night})`; ctx.beginPath(); ctx.arc(x, ys(3.3, s), 0.9 * s, 0, 7); ctx.fill(); ctx.fillStyle = `rgba(255,240,190,${night})`; ctx.fillRect(x - 0.2 * s, ys(3.35, s), 0.4 * s, 0.08 * s); }
  }

  function drawGate(g) {
    const rz = g.z - camZ(); if (rz < NEAR + 0.3 || rz > DRAW) return;
    const s = F / rz, fog = fogAt(rz), st = STATIONS[g.i % N];
    ctx.globalAlpha = 1 - fog * 0.6;
    ctx.fillStyle = shadeC([120, 125, 130], rz, 1);
    for (const px of [-3.4, 3.4]) ctx.fillRect(xs(px, s) - 0.15 * s, ys(4.6, s), 0.3 * s, 4.6 * s);
    const x0 = xs(-3.7, s), x1 = xs(3.7, s), yT = ys(4.8, s), yB = ys(3.2, s);
    ctx.fillStyle = '#fbfbf7'; ctx.fillRect(x0, yT, x1 - x0, yB - yT);
    ctx.fillStyle = '#8cc63f'; ctx.fillRect(x0, ys(3.5, s), x1 - x0, 0.3 * s);
    ctx.strokeStyle = '#555'; ctx.lineWidth = Math.max(1, 0.04 * s); ctx.strokeRect(x0, yT, x1 - x0, yB - yT);
    const fs = 0.72 * s;
    if (fs > 5) {
      ctx.fillStyle = '#1d1f22'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = g.goal ? `${st.name} ゴール` : g.start ? `${st.name} スタート` : st.name;
      ctx.font = `${fs | 0}px ${FONT}`;
      const tw = ctx.measureText(label).width, maxW = (x1 - x0) * 0.9;
      if (tw > maxW) ctx.font = `${(fs * maxW / tw) | 0}px ${FONT}`;
      ctx.fillText(label, (x0 + x1) / 2, ys(4.05, s));
      if (fs > 14) { ctx.font = `${(0.26 * s) | 0}px ${FONT_B}`; ctx.fillStyle = '#444'; ctx.fillText(st.kana, (x0 + x1) / 2, ys(4.6, s)); ctx.fillStyle = '#fff'; ctx.fillText(st.roma, (x0 + x1) / 2, ys(3.35, s)); }
    }
    ctx.globalAlpha = 1;
  }

  function drawBridge(b) {
    const rz = b.z - camZ(); if (rz < NEAR + 0.2 || rz > DRAW) return;
    const s = F / rz, brick = [120, 62, 48];
    ctx.fillStyle = shadeC(brick, rz, 0.85);
    for (const px of [-ROAD - 0.6, ROAD + 0.6]) ctx.fillRect(xs(px, s) - 0.45 * s, ys(5.2, s), 0.9 * s, 5.2 * s);
    ctx.fillStyle = shadeC(brick, rz, 1); ctx.fillRect(xs(-30, s), ys(6.8, s), xs(30, s) - xs(-30, s), 1.6 * s);
    ctx.fillStyle = shadeC([70, 40, 32], rz, 1); ctx.fillRect(xs(-30, s), ys(5.35, s), xs(30, s) - xs(-30, s), 0.18 * s);
    ctx.fillStyle = shadeC([90, 95, 100], rz, 1); ctx.fillRect(xs(-30, s), ys(7.2, s), xs(30, s) - xs(-30, s), 0.4 * s);
    // 上を走る電車
    const tx = ((G.time * 14 + (b.seed % 100)) % 70) - 35;
    ctx.fillStyle = shadeC([215, 220, 225], rz, 1); ctx.fillRect(xs(tx, s), ys(9.6, s), 16 * s, 2.4 * s);
    ctx.fillStyle = shadeC([140, 198, 63], rz, 1); ctx.fillRect(xs(tx, s), ys(8.3, s), 16 * s, 0.35 * s);
    ctx.fillStyle = night > 0.3 ? 'rgba(255,230,150,.9)' : shadeC([60, 70, 85], rz, 1);
    for (let k = 0; k < 7; k++) ctx.fillRect(xs(tx + 0.8 + k * 2.2, s), ys(9.3, s), 1.2 * s, 0.7 * s);
  }
  function drawShip(sh) {
    const rz = sh.z - camZ(); if (rz < NEAR || rz > DRAW) return;
    const s = F / rz, x = xs(sh.x, s), y = ys(0, s);
    ctx.fillStyle = shadeC(sh.c, rz, 1); ctx.beginPath(); ctx.moveTo(x - 2.2 * s, y - 0.9 * s); ctx.lineTo(x + 2.2 * s, y - 0.9 * s); ctx.lineTo(x + 1.6 * s, y); ctx.lineTo(x - 1.6 * s, y); ctx.fill();
    ctx.fillStyle = shadeC([245, 245, 240], rz, 1); ctx.fillRect(x - 0.9 * s, y - 1.8 * s, 1.6 * s, 0.9 * s);
    ctx.fillStyle = shadeC([60, 70, 90], rz, 1); ctx.fillRect(x - 0.7 * s, y - 1.6 * s, 1.2 * s, 0.3 * s);
  }
  function drawTrain(t) {
    const cz = camZ(), za = Math.max(t.z0, cz + NEAR), zb = t.z1;
    if (zb <= cz + NEAR || za - cz > DRAW) return;
    const ra = za - cz, rb = zb - cz, sa = F / ra, sb = F / rb;
    const body = [212, 216, 222];
    const face = (y0, y1, c) => { ctx.fillStyle = c; quad(xs(t.x0, sa), ys(y0, sa), xs(t.x0, sa), ys(y1, sa), xs(t.x0, sb), ys(y1, sb), xs(t.x0, sb), ys(y0, sb)); };
    face(0.4, t.h, shadeC(body, ra, 0.85));
    face(1.0, 1.35, shadeC([140, 198, 63], ra, 1));
    face(1.7, 2.8, night > 0.3 ? css(mix([255, 230, 150], fogC, fogAt(ra) * 0.5)) : shadeC([70, 85, 100], ra, 1));
    for (let z = t.z0 + 1; z < t.z1; z += 11) { if (z < cz + NEAR) continue; const s = F / (z - cz); ctx.fillStyle = shadeC([90, 95, 100], z - cz, 1); ctx.fillRect(xs(t.x0, s) - 0.05 * s, ys(t.h, s), 0.1 * s, (t.h - 0.4) * s); }
    if (t.z0 >= cz + NEAR) {
      ctx.fillStyle = shadeC(body, ra, 1); ctx.fillRect(xs(t.x1, sa), ys(t.h, sa), xs(t.x0, sa) - xs(t.x1, sa), (t.h - 0.4) * sa);
      ctx.fillStyle = shadeC([40, 50, 60], ra, 1); ctx.fillRect(xs(t.x1 + 0.3, sa), ys(3.1, sa), xs(t.x0 - 0.3, sa) - xs(t.x1 + 0.3, sa), 1.1 * sa);
      ctx.fillStyle = shadeC([140, 198, 63], ra, 1); ctx.fillRect(xs(t.x1, sa), ys(1.35, sa), xs(t.x0, sa) - xs(t.x1, sa), 0.35 * sa);
      ctx.fillStyle = night > 0.2 ? '#fff6c8' : '#e8e8e0'; for (const lx of [t.x1 + 0.5, t.x0 - 0.5]) { ctx.beginPath(); ctx.arc(xs(lx, sa), ys(0.9, sa), 0.16 * sa, 0, 7); ctx.fill(); }
    }
  }

  function drawObj(o) {
    if (o.gone) return;
    const rz = o.z - camZ(); if (rz < NEAR) return;
    const sk = o.kind === 'walker' ? 'walker' + o.v : o.kind;
    const s = F / rz, sp = SPR[sk];
    const alpha = 1 - clamp((rz - 90) / 25, 0, 1);
    if (alpha <= 0) return;
    const hgt = ITEM_H[sk] * s, wid = hgt * sp.width / sp.height;
    const bob = o.fly ? 1.0 + Math.sin(G.time * 8 + o.z) * 0.15 : o.bad ? 0 : (0.25 + Math.sin(G.time * 5 + o.z) * 0.1);
    const x = xs(o.x, s), yb = ys(0, s);
    ctx.globalAlpha = alpha * (o.done && o.bad ? 0.5 : 1);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x, yb, wid * 0.5, wid * 0.14, 0, 0, 7); ctx.fill();
    if (!o.bad) { ctx.fillStyle = `rgba(255,250,200,${0.25 + 0.15 * Math.sin(G.time * 6 + o.z)})`; ctx.beginPath(); ctx.arc(x, yb - hgt * 0.5 - bob * s, hgt * 0.62, 0, 7); ctx.fill(); }
    ctx.drawImage(sp, x - wid / 2, yb - hgt - bob * s, wid, hgt);
    const sp2 = SPEECH[o.kind];
    if (sp2 && rz < 26 && rz > 2 && !o.done) {
      const fs = Math.max(10, 0.32 * s), tw = sp2[0].length * 0.55 + 0.6;
      ctx.font = `${fs | 0}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const bx = x + wid * 0.55, by = yb - hgt * 1.05;
      ctx.fillStyle = '#fff'; rr(ctx, bx - fs * tw, by - fs * 0.75, fs * tw * 2, fs * 1.5, fs * 0.4); ctx.fill();
      ctx.fillStyle = sp2[1]; ctx.fillText(sp2[0], bx, by);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    const k = F / CAM_BACK, x = xs(G.px, k), y = FEET;
    const u = k * 0.95; // 1単位の大きさ
    let phase = (G.dist / 1.6) * Math.PI;
    let sink = 0;
    if (G.ending === 'over') { sink = clamp(1 - G.endT / 1.8, 0, 1) * 0.5; phase = 0; }
    if (G.state === 'playing' && G.invuln > 0 && Math.floor(G.invuln * 12) % 2 === 0) return;
    const sw = Math.sin(phase), bob = Math.abs(Math.cos(phase)) * 0.05 * u;
    const lean = clamp((G.lane * LANE - G.px) * -0.12, -0.25, 0.25);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(x, y, 0.42 * u, 0.12 * u, 0, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(x, y + sink * u); ctx.rotate(lean);
    const sc = u;
    // 足
    ctx.fillStyle = '#2f3f5c';
    ctx.fillRect(-0.2 * sc, -0.62 * sc + sw * 0.06 * sc, 0.16 * sc, 0.6 * sc - sw * 0.06 * sc);
    ctx.fillRect(0.04 * sc, -0.62 * sc - sw * 0.06 * sc, 0.16 * sc, 0.6 * sc + sw * 0.06 * sc);
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(-0.23 * sc, -0.06 * sc + sw * 0.05 * sc, 0.22 * sc, 0.1 * sc);
    ctx.fillRect(0.01 * sc, -0.06 * sc - sw * 0.05 * sc, 0.22 * sc, 0.1 * sc);
    ctx.translate(0, -bob);
    // 腕
    ctx.fillStyle = '#f0c8a0';
    ctx.save(); ctx.translate(-0.3 * sc, -1.08 * sc); ctx.rotate(-sw * 0.4); ctx.fillRect(-0.06 * sc, 0, 0.12 * sc, 0.42 * sc); ctx.restore();
    ctx.save(); ctx.translate(0.3 * sc, -1.08 * sc); ctx.rotate(sw * 0.4); ctx.fillRect(-0.06 * sc, 0, 0.12 * sc, 0.42 * sc); ctx.restore();
    // 体
    ctx.fillStyle = '#5fb3d9'; rr(ctx, -0.3 * sc, -1.15 * sc, 0.6 * sc, 0.58 * sc, 0.12 * sc); ctx.fill();
    // リュック
    ctx.fillStyle = '#e8743b'; rr(ctx, -0.24 * sc, -1.1 * sc, 0.48 * sc, 0.46 * sc, 0.1 * sc); ctx.fill();
    ctx.fillStyle = '#c95a28'; rr(ctx, -0.16 * sc, -0.86 * sc, 0.32 * sc, 0.16 * sc, 0.05 * sc); ctx.fill();
    // 頭
    ctx.fillStyle = '#3a2a22'; ctx.beginPath(); ctx.arc(0, -1.36 * sc, 0.22 * sc, 0, 7); ctx.fill();
    ctx.fillStyle = '#8cc63f'; ctx.beginPath(); ctx.arc(0, -1.42 * sc, 0.23 * sc, Math.PI, 0); ctx.fill();
    ctx.fillRect(-0.23 * sc, -1.44 * sc, 0.46 * sc, 0.06 * sc);
    ctx.restore();
  }

  function drawFx(dt) {
    for (const f of G.fx) {
      f.life -= dt;
      if (f.t === 'txt') {
        f.y -= 60 * dt; ctx.globalAlpha = clamp(f.life * 1.5, 0, 1);
        ctx.font = `${Math.round(W * 0.075)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
      } else if (f.t === 'spark') {
        f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 500 * dt; ctx.globalAlpha = clamp(f.life * 2, 0, 1);
        ctx.fillStyle = f.c; ctx.fillRect(f.x - 3, f.y - 3, 6, 6);
      } else if (f.t === 'conf') {
        f.x += f.vx * dt; f.y += f.vy * dt; f.r += dt * 5; ctx.globalAlpha = clamp(f.life, 0, 1);
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.r); ctx.fillStyle = f.c; ctx.fillRect(-5, -3, 10, 6); ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    G.fx = G.fx.filter(f => f.life > 0);
  }

  function drawMap() {
    const c = mapCtx, s = HUD.map.width, r = s * 0.36, cx = s / 2, cy = s / 2;
    c.clearRect(0, 0, s, s);
    c.lineWidth = s * 0.07; c.strokeStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.stroke();
    const p = progress();
    c.strokeStyle = '#8cc63f'; c.beginPath(); c.arc(cx, cy, r, 0, p * Math.PI * 2); c.stroke();
    c.fillStyle = '#ffffff';
    for (let i = 0; i < N; i++) { const a = segStart[i] / L * Math.PI * 2; c.beginPath(); c.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, s * (i === 0 ? 0.05 : 0.02), 0, 7); c.fill(); }
    const a = p * Math.PI * 2;
    c.fillStyle = '#e8743b'; c.strokeStyle = '#fff'; c.lineWidth = s * 0.025; c.beginPath(); c.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, s * 0.075, 0, 7); c.fill(); c.stroke();
  }

  function updateHud() {
    if (G.state !== 'playing' && G.state !== 'paused') return;
    setText(HUD.time, `${(Math.min(G.dist, L) / UPK).toFixed(1)}km`);
    const hp = clamp(G.hp / CFG.hpMax, 0, 1);
    HUD.hp.style.transform = `scaleX(${hp})`;
    HUD.hp.style.background = hp > 0.5 ? '#7ccf4a' : hp > 0.25 ? '#f2c335' : '#ef4b4b';
    HUD.hpBox.classList.toggle('low', hp < 0.25);
    HUD.stampMark.classList.toggle('lost', !G.clean);
    const ni = Math.min(G.nextIdx, N);
    const nz = G.nextIdx < N ? segStart[G.nextIdx] : L;
    setText(HUD.next, G.nextIdx < N ? STATIONS[ni].name : '東京（ゴール）');
    setText(HUD.nextDist, `あと ${Math.max(0, (nz - G.dist) / UPK).toFixed(1)}km`);
    setText(HUD.count, `${G.nextIdx - 1}/${N}駅`);
    drawMap();
  }

  function render(dt) {
    const p = G.state === 'title' ? 0.08 : progress();
    night = clamp((p - 0.62) / 0.22, 0, 1);
    dark = lerp(1, 0.5, night);
    ctx.save();
    if (G.shake > 0) ctx.translate(rand(-6, 6) * G.shake * 3, rand(-4, 4) * G.shake * 3);
    drawSky(p);
    drawGround();
    const list = [];
    for (const s of G.scen) list.push([s.z0 != null ? s.z0 : s.z, s]);
    for (const g of G.gates) list.push([g.z, g]);
    for (const o of G.objs) list.push([o.z, o]);
    list.sort((a, b) => b[0] - a[0]);
    for (const [, it] of list) {
      if (it.t === 'bldg') drawBldg(it); else if (it.t === 'tree') drawTree(it); else if (it.t === 'lamp') drawLamp(it);
      else if (it.t === 'bridge') drawBridge(it); else if (it.t === 'ship') drawShip(it); else if (it.t === 'train') drawTrain(it);
      else if (it.kind) drawObj(it); else drawGate(it);
    }
    drawPlayer();
    if (G.windWarn > 0 || G.gust > 0) {
      const d = G.windDir, a = G.gust > 0 ? G.gust / 0.6 : 0.6 + 0.4 * Math.sin(G.time * 18);
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.font = `${Math.round(W * 0.09)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = d > 0 ? 'ビル風 →→' : '←← ビル風';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(20,26,46,.7)'; ctx.strokeText(label, W / 2, H * 0.52); ctx.fillStyle = '#e8f6ff'; ctx.fillText(label, W / 2, H * 0.52);
      if (G.gust > 0) { ctx.fillStyle = 'rgba(255,255,255,.6)'; for (let k = 0; k < 14; k++) { const yy = hash(k, 3, 9) * H; const xx = ((hash(k, 5, 1) * W + (0.6 - G.gust) * W * 3 * d) % W + W) % W; ctx.fillRect(xx, yy, W * 0.25, 2); } }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    drawFx(dt);
    updateHud();
  }

  // ---------- 画面の切り替え ----------
  const UI = {
    title: document.getElementById('scrTitle'), pause: document.getElementById('scrPause'), result: document.getElementById('scrResult'),
    hud: document.getElementById('hud'), best: document.getElementById('bestBox'), resBody: document.getElementById('resBody'),
    sound: document.querySelectorAll('.btn-sound'), stamps: document.getElementById('scrStamps'), stampGrid: document.getElementById('stampGrid'),
    stampCount: document.getElementById('stampCount'),
  };
  let backTo = null;
  function show(el) { for (const k of ['title', 'pause', 'result', 'stamps']) UI[k].hidden = UI[k] !== el; }
  function stampHtml(i, got) {
    const nm = STATIONS[i].name, fs = nm.length <= 2 ? 15 : nm.length <= 3 ? 12 : nm.length <= 4 ? 10 : 8;
    return `<div class="stamp-cell${got ? ' got' : ''}"><span class="stamp" style="--ink:${got ? stampInk(i) : '#b9bcc4'};font-size:${fs}px">${nm}</span></div>`;
  }
  function openStamps() {
    const r = Records.load(), set = new Set(r.stamps);
    UI.stampGrid.innerHTML = STATIONS.map((_, i) => stampHtml(i, set.has(i))).join('');
    UI.stampCount.textContent = `${set.size} / ${N}`;
    backTo = G.state === 'result' ? UI.result : UI.title; show(UI.stamps);
  }

  function renderBest() {
    const r = Records.load();
    UI.best.innerHTML = `
      <div class="best-row"><span>いちばん遠く</span><b>${r.bestKm > 0 ? `${r.bestStationName}（${r.bestStations}駅・${r.bestKm.toFixed(1)}km）` : 'まだ記録なし'}</b></div>
      <div class="best-row"><span>一周達成</span><b>${r.clears > 0 ? `${r.clears}回（最速 ${fmtTime(r.bestTimeMs / 1000)}）` : 'まだ'}</b></div>
      <div class="best-row"><span>駅スタンプ</span><b>${r.stamps.length} / ${N}</b></div>`;
  }

  function startGame() {
    Sound.unlock(); Sound.click();
    G.state = 'playing'; resetWorld(0); G.gateNext = 0; G.gates = []; spawn();
    lastHud = {};
    UI.hud.hidden = false; show(null);
    showBanner(0, { sub: '一周スタート！ 外回りで歩こう', note: '駅までノーミスで歩くと駅スタンプ' });
    Sound.station();
  }
  function toTitle() {
    G.state = 'title'; UI.hud.hidden = true; HUD.banner.classList.remove('show');
    resetWorld(rand(0, L)); G.gateNext = Math.floor(G.dist / L) * N + stationIndexAt(G.dist) + 1; G.gates = []; spawn();
    renderBest(); show(UI.title);
  }
  function pause() { if (G.state !== 'playing' || G.ending) return; G.state = 'paused'; show(UI.pause); }
  function resume() { if (G.state !== 'paused') return; G.state = 'playing'; show(null); Sound.unlock(); }

  function finish() {
    const cleared = G.ending === 'clear';
    const stations = cleared ? N : G.nextIdx - 1;
    const km = cleared ? TOTAL_KM : G.dist / UPK;
    const run = { cleared, stations, stationName: cleared ? '一周' : STATIONS[stations].name, km: Math.round(km * 10) / 10,
      timeMs: Math.round(G.elapsed * 1000), hits: G.hits, picks: G.picks, stamps: G.runStamps.slice(), date: new Date().toISOString(), version: 2 };
    const res = Records.submit(run);
    G.state = 'result';
    const nextName = STATIONS[Math.min(stations + 1, N - 1)].name;
    const rec = res.records;
    const stampLine = `<div class="res-stamps">${run.stamps.length ? run.stamps.map(i => `<span class="stamp${res.newStamps.includes(i) ? ' new' : ''}" style="--ink:${stampInk(i)}">${STATIONS[i].name}</span>`).join('') : '<span class="res-sub">今回のスタンプはなし</span>'}</div>
      <div class="res-sub">駅スタンプ ${run.stamps.length}個（新しく${res.newStamps.length}個）・スタンプ帳 ${rec.stamps.length}/${N}</div>`;
    UI.resBody.innerHTML = cleared ? `
      <div class="res-eyebrow">おつかれさま！</div>
      <div class="res-big">山手線一周</div>
      ${rec.clears === 1 ? '<div class="res-new">はじめての一周達成！</div>' : `<div class="res-sub">一周達成 ${rec.clears}回目</div>`}
      <div class="res-stats"><span>${N}駅・${TOTAL_KM.toFixed(1)}km</span><span>一周タイム ${fmtTime(run.timeMs / 1000)}${res.newTime && rec.clears > 1 ? '（最速！）' : ''}</span></div>
      ${stampLine}` : `
      <div class="res-eyebrow">${nextName}の手前でダウン…</div>
      <div class="res-big">${run.stationName}<small>まで</small></div>
      <div class="res-stats"><span>${stations}駅</span><span>${run.km.toFixed(1)}km</span></div>
      ${res.newDistance ? '<div class="res-new">自己ベスト更新！</div>' : `<div class="res-sub">自己ベスト ${rec.bestStationName}（${rec.bestStations}駅・${rec.bestKm.toFixed(1)}km）</div>`}
      ${stampLine}`;
    UI.resBody.insertAdjacentHTML('beforeend', '<div class="res-note">みんなとの記録くらべはアプリ版で登場予定</div>');
    show(UI.result);
  }

  // ---------- 操作 ----------
  function move(d) {
    if (G.state !== 'playing' || G.ending) return;
    G.lane = clamp(G.lane + d, -1, 1);
  }
  let touch = null;
  stage.addEventListener('touchstart', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const t = e.changedTouches[0]; touch = { x: t.clientX, y: t.clientY, swiped: false };
  }, { passive: false });
  stage.addEventListener('touchmove', (e) => {
    if (!touch) return; e.preventDefault();
    const t = e.changedTouches[0], dx = t.clientX - touch.x;
    if (!touch.swiped && Math.abs(dx) > 28) { move(dx > 0 ? 1 : -1); touch.swiped = true; }
  }, { passive: false });
  stage.addEventListener('touchend', (e) => {
    if (!touch) return; e.preventDefault();
    if (!touch.swiped) { const r = stage.getBoundingClientRect(); move(touch.x - r.left < r.width / 2 ? -1 : 1); }
    touch = null;
  }, { passive: false });
  stage.addEventListener('mousedown', (e) => {
    if (e.target.closest('button') || G.state !== 'playing') return;
    const r = stage.getBoundingClientRect(); move(e.clientX - r.left < r.width / 2 ? -1 : 1);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') move(-1);
    else if (e.key === 'ArrowRight' || e.key === 'd') move(1);
    else if (e.key === ' ' || e.key === 'Escape') { if (G.state === 'playing') pause(); else if (G.state === 'paused') resume(); }
    else if (e.key === 'Enter' && G.state === 'title') startGame();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  document.getElementById('btnStart').addEventListener('click', startGame);
  document.getElementById('btnPause').addEventListener('click', pause);
  document.getElementById('btnResume').addEventListener('click', resume);
  document.getElementById('btnQuit').addEventListener('click', toTitle);
  document.getElementById('btnRetry').addEventListener('click', startGame);
  document.getElementById('btnTitle').addEventListener('click', toTitle);
  document.querySelectorAll('.btn-stamps').forEach(b => b.addEventListener('click', () => { Sound.click(); openStamps(); }));
  document.getElementById('btnStampsClose').addEventListener('click', () => { Sound.click(); if (backTo === UI.title) renderBest(); show(backTo || UI.title); });
  function syncSound() { UI.sound.forEach(b => { b.textContent = Sound.on ? '音あり' : '音なし'; b.setAttribute('aria-pressed', String(Sound.on)); }); }
  UI.sound.forEach(b => b.addEventListener('click', () => { Sound.unlock(); Sound.setOn(!Sound.on); Storage.set('yamanote-sanpo.sound', Sound.on); syncSound(); Sound.click(); }));

  // ---------- 起動 ----------
  let last = 0;
  function frame(t) {
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016); last = t;
    if (!W || !H) resize();
    if (W && H) { update(dt); render(dt); }
    requestAnimationFrame(frame);
  }
  function fillLegend() {
    document.querySelectorAll('img[data-spr]').forEach(img => { try { img.src = SPR[img.dataset.spr].toDataURL(); } catch (e) {} });
  }
  function boot() {
    fillLegend();
    Sound.setOn(Storage.get('yamanote-sanpo.sound', true) !== false); syncSound();
    resize(); window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(app);
    window.addEventListener('orientationchange', () => setTimeout(resize, 300));
    toTitle();
    if (document.fonts && document.fonts.load) { document.fonts.load(`20px ${FONT}`).catch(() => {}); }
    requestAnimationFrame(frame);
  }

  // テスト用（自動プレイで難易度を確かめるための入口）
  window.YS = {
    G, CFG, L, UPK, TOTAL_KM, segStart, startGame,
    step(dt) { update(dt); },
    setLane(l) { G.lane = clamp(l, -1, 1); },
    lookahead(range) { return G.objs.filter(o => !o.done && o.z > G.dist - 0.3 && o.z < G.dist + range).map(o => ({ kind: o.kind, x: o.x, rz: o.z - G.dist, bad: o.bad })); },
  };

  boot();
})();
