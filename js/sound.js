/* 効果音：すべてその場で合成するオリジナル音（音声ファイル不要） */
const Sound = {
  ctx: null, master: null, on: true,
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
        s.buffer = b; s.connect(this.master); s.start(0);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { /* 音が出せなくても遊べる */ }
  },
  setOn(v) { this.on = v; if (this.master) this.master.gain.value = v ? 0.5 : 0; },
  ok() { return this.ctx && this.on && this.ctx.state === 'running'; },
  tone(freq, dur, type = 'sine', vol = 0.3, delay = 0, slideTo = null) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.3, delay = 0, freq = 800) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime + delay, n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
    s.buffer = buf; s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  },
  pickup(kind) {
    const base = kind === 'onigiri' ? 660 : kind === 'water' ? 880 : 990;
    this.tone(base, 0.12, 'triangle', 0.25);
    this.tone(base * 1.5, 0.18, 'triangle', 0.22, 0.07);
    if (kind === 'onigiri') this.tone(base * 2, 0.22, 'sine', 0.15, 0.14);
  },
  hit(kind) {
    this.noise(0.18, 0.5, 0, kind === 'thug' ? 500 : 1200);
    this.tone(kind === 'thug' ? 150 : 220, 0.25, 'square', 0.12, 0, 70);
  },
  station() { [784, 1047, 1319, 1175].forEach((f, i) => this.tone(f, 0.35, 'sine', 0.18, i * 0.13)); },
  step() { this.noise(0.035, 0.05, 0, 600); },
  beat() { this.tone(70, 0.12, 'sine', 0.35); this.tone(60, 0.14, 'sine', 0.3, 0.16); },
  over() { [523, 440, 349, 262].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.22, i * 0.2)); },
  clear() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.22, i * 0.12)); },
  stamp() { this.noise(0.06, 0.4, 0, 300); this.tone(1568, 0.25, 'sine', 0.15, 0.08); this.tone(2093, 0.3, 'sine', 0.12, 0.16); },
  bell() { this.tone(2600, 0.18, 'sine', 0.12); this.tone(2600, 0.2, 'sine', 0.1, 0.16); },
  wind() { this.noise(0.7, 0.35, 0, 900); },
  train() { this.noise(1.6, 0.18, 0, 180); },
  click() { this.tone(1200, 0.05, 'sine', 0.12); },
};
