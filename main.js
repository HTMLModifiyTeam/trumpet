// ===================== 공용 유틸 =====================
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ===================== 오디오 엔진 =====================
const AE = { ctx: null, ready: false, synth: {} };

function makeIR(ctx, dur, power) {
  const sr = ctx.sampleRate, n = Math.floor(sr * dur), b = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / dur, power) * Math.exp(-t * 2.6) * 0.55;
    }
    // 초기 반사음 (작은 바 공간)
    [0.009, 0.016, 0.023, 0.034, 0.047].forEach((et, k) => {
      const idx = Math.floor((et + (c ? 0.0021 : 0)) * sr);
      if (idx < n) d[idx] += (0.55 - k * 0.09) * (Math.random() < 0.5 ? -1 : 1);
    });
    // 꼬리를 점점 어둡게
    let y = 0;
    for (let i = 0; i < n; i++) {
      const fc = 9000 - 7000 * (i / n);
      const a = 1 - Math.exp(-2 * Math.PI * fc / sr);
      y += a * (d[i] - y); d[i] = y;
    }
  }
  return b;
}

// 웅성거림 (다른 사람 솔로 때 커지고 내 솔로 때 조용해짐)
async function renderBabble(sr) {
  const dur = 8;
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const oc = new OC(2, Math.floor(sr * dur), sr);
  const V = [[700, 1200], [400, 2000], [300, 870], [550, 1800], [450, 900], [650, 1100], [350, 2200]];
  for (let v = 0; v < 8; v++) {
    const osc = oc.createOscillator(); osc.type = 'sawtooth';
    const female = v % 2 === 1, base = female ? rand(185, 235) : rand(100, 135), fs = female ? 1.12 : 1;
    const f1 = oc.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 5;
    const f2 = oc.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 8;
    const g = oc.createGain(); g.gain.value = 0;
    const mix = oc.createGain();
    const pan = oc.createStereoPanner ? oc.createStereoPanner() : null;
    osc.connect(f1); osc.connect(f2); f1.connect(mix); f2.connect(mix); mix.connect(g);
    if (pan) { pan.pan.value = rand(-0.85, 0.85); g.connect(pan); pan.connect(oc.destination); } else g.connect(oc.destination);
    let t = rand(0, 0.6);
    while (t < dur - 0.3) {
      if (Math.random() < 0.22) { t += rand(0.25, 0.9); continue; }
      const sd = rand(0.08, 0.22), vw = pick(V);
      f1.frequency.setValueAtTime(vw[0] * fs, t); f2.frequency.setValueAtTime(vw[1] * fs, t);
      osc.frequency.setValueAtTime(base * rand(0.88, 1.22), t);
      osc.frequency.linearRampToValueAtTime(base * rand(0.85, 1.1), t + sd);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(rand(0.18, 0.4), t + 0.02); g.gain.linearRampToValueAtTime(0, t + sd);
      t += sd + rand(0.01, 0.05);
    }
    osc.start(0); osc.stop(dur);
  }
  const buf = await new Promise(res => { const p = oc.startRendering(); if (p && p.then) p.then(res); else oc.oncomplete = e => res(e.renderedBuffer); });
  // 루프 이음새 크로스페이드
  const xf = Math.floor(0.6 * sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c), N = d.length;
    for (let i = 0; i < xf; i++) { const a = i / xf; d[i] = d[i] * a + d[N - xf + i] * (1 - a); }
  }
  return buf;
}

async function initAudio(ctxOverride) {
  if (AE.ctx && !ctxOverride) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = ctxOverride || new AC({ latencyHint: 'interactive' });
  AE.ctx = ctx;
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { }

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.2; comp.attack.value = 0.006; comp.release.value = 0.24;
  const master = ctx.createGain(); master.gain.value = 0.85;
  // 마지막에 한 번 더 눌러서 소리가 깨지지 않게 (리미터)
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
  master.connect(comp); comp.connect(lim); lim.connect(ctx.destination);
  const rev = ctx.createConvolver(); rev.buffer = makeIR(ctx, 1.7, 2.4);
  const revOut = ctx.createGain(); revOut.gain.value = 0.85; rev.connect(revOut); revOut.connect(master);
  const bus = (gain, send) => { const g = ctx.createGain(); g.gain.value = gain; g.connect(master); const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(rev); return g; };
  AE.master = master;

  // 웅성거림 버스 (멀리서 들리게 저역통과)
  const babLP = ctx.createBiquadFilter(); babLP.type = 'lowpass'; babLP.frequency.value = 2200;
  const babG = ctx.createGain(); babG.gain.value = 0;
  babLP.connect(babG); babG.connect(bus(0.95, 0.32));
  AE.babbleGain = babG;
  AE.babbleIn = babLP;
  AE.trumpetBus = bus(0.9, 0.28); // 시끄러운 트럼펫 버스 (리버브 조금)

  // 합성 소리 미리 굽기
  const SY = AE.synth;
  try {
    SY.babble = await renderBabble(ctx.sampleRate);
    const src = ctx.createBufferSource(); src.buffer = SY.babble; src.loop = true; src.connect(AE.babbleIn); src.start();
  } catch (e) { console.warn('babble', e); }
  AE.ready = true;
}

// ===================== 시끄러운 트럼펫 (오실레이터) =====================
const TRUMPET = { on: true, timer: 0, busy: false };
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

function makeDistCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); }
  return c;
}
let _noiseBuf = null;
function getNoise(ctx) {
  if (_noiseBuf && _noiseBuf.sampleRate === ctx.sampleRate) return _noiseBuf;
  const n = Math.floor(ctx.sampleRate * 1.5), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return (_noiseBuf = b);
}

// 한 번 빽! 부는 소리. o: { vel, scoop, fall, vib, vibRate, trem, spit }
function trumpetBlast(freq, dur, o = {}) {
  const ctx = AE.ctx;
  if (!AE.ready || !ctx || ctx.state !== 'running') return;
  const vel = o.vel ?? 1, t0 = ctx.currentTime + 0.02, t1 = t0 + dur;

  // 음 높이: 입술 떨림처럼 아래서 미끄러져 올라오고, 끝에서 축 처짐
  const scoop = o.scoop ?? rand(0.86, 0.95), fall = o.fall ?? rand(0.9, 1);
  const vibDepth = freq * (o.vib ?? rand(0.012, 0.03));

  const mix = ctx.createGain(); mix.gain.value = 0.22;
  const lfo = ctx.createOscillator(); lfo.type = 'sine';
  lfo.frequency.value = o.vibRate ?? rand(5, 8.5);
  const lfoG = ctx.createGain(); lfoG.gain.setValueAtTime(0, t0); lfoG.gain.linearRampToValueAtTime(vibDepth, t0 + Math.min(0.35, dur * 0.6));
  lfo.connect(lfoG);

  const oscs = [];
  // 살짝씩 어긋난 톱니파/사각파를 겹쳐서 지저분하고 뾰족하게
  [['sawtooth', 1, 0, 1], ['sawtooth', 1, 17, 0.8], ['square', 1, -13, 0.5], ['sawtooth', 2, 7, 0.45], ['sawtooth', 0.5, -5, 0.4]].forEach(([type, mult, cents, amp]) => {
    const osc = ctx.createOscillator(); osc.type = type; osc.detune.value = cents;
    const f = freq * mult;
    osc.frequency.setValueAtTime(f * scoop, t0);
    osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.07);
    osc.frequency.setValueAtTime(f, Math.max(t0 + 0.08, t1 - 0.18));
    osc.frequency.exponentialRampToValueAtTime(f * fall, t1 + 0.04);
    lfoG.connect(osc.frequency);
    const g = ctx.createGain(); g.gain.value = amp; osc.connect(g); g.connect(mix);
    osc.start(t0); osc.stop(t1 + 0.15); oscs.push(osc);
  });
  lfo.start(t0); lfo.stop(t1 + 0.15);

  // 브라스 특유의 "뿌우~" 필터 열림 + 벨 공명 + 날카로운 대역
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3.5;
  const hi = Math.min(freq * 9, 9000);
  lp.frequency.setValueAtTime(Math.min(freq * 2, 3000), t0);
  lp.frequency.exponentialRampToValueAtTime(hi, t0 + 0.09);
  lp.frequency.exponentialRampToValueAtTime(Math.min(freq * 5, 6000), t1);
  const pk1 = ctx.createBiquadFilter(); pk1.type = 'peaking'; pk1.frequency.value = 1250; pk1.Q.value = 1.6; pk1.gain.value = 9;
  const pk2 = ctx.createBiquadFilter(); pk2.type = 'peaking'; pk2.frequency.value = 3100; pk2.Q.value = 2.2; pk2.gain.value = 7;
  const shaper = ctx.createWaveShaper(); shaper.curve = makeDistCurve(o.drive ?? 7); shaper.oversample = '4x';
  mix.connect(lp); lp.connect(pk1); pk1.connect(pk2); pk2.connect(shaper);

  // 전체 볼륨 (+ 선택: 방귀 같은 떨림)
  const trem = ctx.createGain(); trem.gain.value = 1;
  let tremLfo = null;
  if (o.trem) {
    trem.gain.value = 0.55;
    tremLfo = ctx.createOscillator(); tremLfo.type = 'square'; tremLfo.frequency.value = o.trem;
    const tg = ctx.createGain(); tg.gain.value = 0.45; tremLfo.connect(tg); tg.connect(trem.gain);
    tremLfo.start(t0); tremLfo.stop(t1 + 0.15);
  }
  const env = ctx.createGain(); const peak = 0.55 * vel, sus = 0.38 * vel;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + 0.03);
  env.gain.linearRampToValueAtTime(sus, t0 + 0.16);
  env.gain.setValueAtTime(sus, Math.max(t0 + 0.17, t1 - 0.05));
  env.gain.linearRampToValueAtTime(0.0001, t1 + 0.06);
  shaper.connect(trem); trem.connect(env);

  // 숨소리 / 침 튀는 "퍽" 소리
  const nz = ctx.createBufferSource(); nz.buffer = getNoise(ctx); nz.loop = true;
  const nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = Math.min(freq * 3, 5000); nbp.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t0); ng.gain.linearRampToValueAtTime((o.spit ?? 0.5) * vel, t0 + 0.012); ng.gain.exponentialRampToValueAtTime(0.06 * vel, t0 + 0.14);
  ng.gain.setValueAtTime(0.06 * vel, Math.max(t0 + 0.15, t1 - 0.05)); ng.gain.linearRampToValueAtTime(0, t1 + 0.04);
  nz.connect(nbp); nbp.connect(ng); ng.connect(env);
  nz.start(t0, Math.random()); nz.stop(t1 + 0.15);

  env.connect(AE.trumpetBus);
  oscs[0].onended = () => { try { env.disconnect(); } catch (e) { } };
}

// 말도 안 되는 즉흥 연주 한 토막
function trumpetPhrase() {
  const kind = pick(['honk', 'honk', 'run', 'run', 'squeal', 'long', 'fart', 'stab']);
  const noteHz = () => midiHz(58 + randi(0, 26)) * Math.pow(2, rand(-0.4, 0.4) / 12); // 일부러 음정 어긋나게
  let total = 0;
  const at = (delay, f, d, o) => { setTimeout(() => trumpetBlast(f, d, o), delay * 1000); total = Math.max(total, delay + d); };
  if (kind === 'honk') { const d = rand(0.25, 0.7); at(0, noteHz(), d); }
  else if (kind === 'long') { const d = rand(1.3, 2.4); at(0, midiHz(randi(60, 74)), d, { vel: 1, vib: 0.045, vibRate: rand(4, 6), scoop: 0.8, fall: 0.75 }); }
  else if (kind === 'squeal') { const d = rand(0.4, 1.0); at(0, rand(1300, 2300), d, { vel: 0.85, scoop: 0.6, fall: 1.15, vib: 0.05, vibRate: 9, drive: 10, spit: 0.8 }); }
  else if (kind === 'fart') { const d = rand(0.5, 1.1); at(0, rand(70, 130), d, { vel: 1.2, trem: rand(18, 30), vib: 0.06, scoop: 1.2, fall: 0.6, drive: 9 }); }
  else if (kind === 'stab') { for (let i = 0; i < 3; i++) at(i * 0.16, noteHz() * (i === 2 ? 2 : 1), i === 2 ? 0.55 : 0.1, { vel: 1.1 }); }
  else { // run: 급하게 막 올라갔다 내려갔다
    const n = randi(6, 12); let m = 58 + randi(0, 14), t = 0;
    for (let i = 0; i < n; i++) { m = clamp(m + randi(-5, 6), 52, 88); const d = rand(0.07, 0.14); at(t, midiHz(m) * Math.pow(2, rand(-0.3, 0.3) / 12), d, { vel: 0.9, scoop: rand(0.92, 1), vib: 0.004, drive: 8 }); t += d + rand(0.01, 0.05); }
  }
  // 관객 반응: 웅성거림이 커지고 누군가 화를 냄
  setBabble(0.95); setTimeout(() => setBabble(0.5), total * 1000 + 400);
  if (typeof UI !== 'undefined' && G.people && G.people.length) {
    const p = pick(G.people); if (p) UI.bubble(p, pick(TRUMPET_LINES), Math.random() < 0.35, 0.15);
  }
  return total;
}
const TRUMPET_LINES = ['트럼펫 좀 꺼!', '귀 아파!!', '저거 누가 좀 말려!', '삑사리 나잖아!', '이게 무슨 소리야!', '제발 그만!', '고막 터져!', '나 집에 갈래!'];

function startTrumpet() {
  if (TRUMPET.busy) return; TRUMPET.busy = true;
  const next = () => {
    let d = 0;
    if (TRUMPET.on && AE.ready && AE.ctx && AE.ctx.state === 'running' && !document.hidden) d = trumpetPhrase();
    TRUMPET.timer = setTimeout(next, d * 1000 + rand(250, 1400));
  };
  TRUMPET.timer = setTimeout(next, 1200);
}

// ===================== 3D 장면 =====================
const G = { renderer: null, scene: null, camera: null, W: 1, H: 1, M: {}, GEO: {}, people: [], band: {}, props: {}, env: null, seats: [] };
const C = h => new THREE.Color(h).convertSRGBToLinear();
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

function shadeHex(hex, amt) {
  const c = new THREE.Color(hex); const f = 1 + amt;
  return '#' + new THREE.Color(clamp(c.r * f, 0, 1), clamp(c.g * f, 0, 1), clamp(c.b * f, 0, 1)).getHexString();
}
function mergeGeoms(items) {
  let total = 0;
  const parts = items.map(({ geo, color, mat }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone(); g.applyMatrix4(mat);
    total += g.attributes.position.count; return { g, color };
  });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const { g, color } of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < n; i++) { col[(o + i) * 3] = color.r; col[(o + i) * 3 + 1] = color.g; col[(o + i) * 3 + 2] = color.b; }
    o += n; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
function mtx(p, r, s) { _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0); _q.setFromEuler(_e); return new THREE.Matrix4().compose(V3(p[0], p[1], p[2]), _q, V3(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1)); }
class Batch {
  constructor() { this.items = []; }
  add(geo, color, p, r, s) { this.items.push({ geo, color: color instanceof THREE.Color ? color : C(color), mat: mtx(p, r, s) }); return this; }
  addM(geo, color, m) { this.items.push({ geo, color: color instanceof THREE.Color ? color : C(color), mat: m }); return this; }
  mesh(mat) { const m = new THREE.Mesh(mergeGeoms(this.items), mat); this.items = []; return m; }
  get size() { return this.items.length; }
}

function canvasTex(w, h, draw, o = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
  return t;
}
const FONT_D = '"Black Han Sans","Noto Sans CJK KR","Noto Sans KR",sans-serif';
const FONT_T = '"Gowun Dodum","Noto Sans CJK KR","Noto Sans KR",sans-serif';

function woodTex(base, rows, repeat, seams = true) {
  return canvasTex(512, 512, (g, w, h) => {
    const ph = h / rows;
    for (let i = 0; i < rows; i++) {
      g.fillStyle = shadeHex(base, rand(-0.1, 0.08)); g.fillRect(0, i * ph, w, ph);
      for (let k = 0; k < 34; k++) {
        g.strokeStyle = `rgba(70,35,12,${rand(0.03, 0.1)})`; g.lineWidth = rand(0.6, 2.2);
        g.beginPath(); const y = i * ph + rand(2, ph - 2); g.moveTo(0, y);
        for (let x = 0; x <= w; x += 24) g.lineTo(x, y + Math.sin(x * 0.015 + k) * rand(0.4, 2.2));
        g.stroke();
      }
      if (seams) { g.fillStyle = 'rgba(45,22,8,0.55)'; g.fillRect(0, i * ph, w, 2); g.fillRect(rand(40, w - 40), i * ph, 2, ph); }
    }
  }, { repeat });
}
function tileTex() {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#efe7d6'; g.fillRect(0, 0, w, h);
    const tw = 64, th = 32;
    for (let r = 0; r < h / th; r++) {
      const off = (r % 2) * tw / 2;
      for (let c = -1; c < w / tw + 1; c++) {
        const x = c * tw + off, y = r * th;
        g.fillStyle = shadeHex('#1b8a68', rand(-0.12, 0.1)); g.fillRect(x + 2, y + 2, tw - 4, th - 4);
        g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x + 5, y + 5, tw - 10, 4);
      }
    }
  }, { repeat: [7, 1] });
}
function skyTex() {
  return canvasTex(256, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#5fb6f2'); gr.addColorStop(0.55, '#a9dcfb'); gr.addColorStop(1, '#eaf7ff');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      const cx = rand(0, w), cy = rand(40, h * 0.5);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(cx + rand(-40, 40), cy + rand(-10, 10), rand(14, 30), 0, Math.PI * 2); g.fill(); }
    }
    g.fillStyle = '#4f9b52';
    for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(rand(0, w), h - rand(10, 70), rand(30, 60), 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#3f7f45'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(rand(0, w), h - rand(0, 30), rand(25, 45), 0, Math.PI * 2); g.fill(); }
  });
}
function posterTex(kind) {
  return canvasTex(360, 500, (g, w, h) => {
    if (kind === 0) {
      g.fillStyle = '#ffcf3f'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e2403a'; g.beginPath(); g.arc(w * 0.62, h * 0.38, 120, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1b2a6b'; g.fillRect(40, 70, 18, 300); g.fillRect(40, 70, 170, 18);
      g.fillStyle = '#1b2a6b'; g.font = `64px ${FONT_D}`; g.fillText('일요일', 36, 430); g.font = `30px ${FONT_T}`; g.fillText('오후 세 시 라이브', 40, 472);
    } else if (kind === 1) {
      g.fillStyle = '#2e7de0'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ffe9b0'; g.lineWidth = 16;
      for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(w / 2, h * 0.42, 40 + i * 30, Math.PI * 0.9, Math.PI * 2.1); g.stroke(); }
      g.fillStyle = '#ffe9b0'; g.font = `52px ${FONT_D}`; g.fillText('박씨네', 40, 420); g.font = `52px ${FONT_D}`; g.fillText('오중주', 40, 476);
    } else {
      g.fillStyle = '#f2ece0'; g.fillRect(0, 0, w, h);
      const cs = ['#e2403a', '#1f9e7a', '#f2b72b', '#2b3a67'];
      for (let i = 0; i < 9; i++) { g.fillStyle = cs[i % 4]; g.fillRect(30 + (i % 3) * 100, 40 + Math.floor(i / 3) * 110, rand(60, 95), rand(60, 100)); }
      g.fillStyle = '#2b3a67'; g.font = `44px ${FONT_D}`; g.fillText('낮달 재즈', 30, 440); g.font = `24px ${FONT_T}`; g.fillText('매주 일요일', 32, 478);
    }
  });
}
function signTex() {
  return canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#123f33'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e8b54a'; g.lineWidth = 10; g.strokeRect(12, 12, w - 24, h - 24);
    g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(150, 128, 78, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#123f33'; g.beginPath(); g.arc(186, 108, 70, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffe9a8'; g.font = `128px ${FONT_D}`;
    g.textBaseline = 'middle'; g.fillText('임대', 270, 136);
  });
}

function makeEnv(renderer) {
  const es = new THREE.Scene();
  const g = new THREE.SphereGeometry(10, 32, 16), cols = [], pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10, c = y > 0.35 ? C('#fff3dc') : y > -0.05 ? C('#d9a56d') : C('#6a3b20');
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  es.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const wm = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 4.6) });
  for (let k = 0; k < 3; k++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.2), wm); p.position.set(-8, 2.2, -5 + k * 4); p.rotation.y = Math.PI / 2; es.add(p); }
  const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromScene(es, 0.03); pm.dispose();
  return rt.texture;
}

function initScene() {
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.background = C('#f4e2c4');
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 60);
  Object.assign(G, { renderer, scene, camera });
  G.env = makeEnv(renderer);
  const M = G.M;
  M.vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  M.gloss = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, envMap: G.env, envMapIntensity: 0.35 });
  M.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.85, envMap: G.env, envMapIntensity: 1.1 });
  M.glass = new THREE.MeshStandardMaterial({ color: C('#d6efff'), roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, envMap: G.env, envMapIntensity: 1.2, depthWrite: false });
  M.person = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0 });
  M.personGloss = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0, envMap: G.env, envMapIntensity: 0.5 });
  const GEO = G.GEO;
  GEO.box = new THREE.BoxGeometry(1, 1, 1);
  GEO.cyl = new THREE.CylinderGeometry(1, 1, 1, 18);
  GEO.cyl8 = new THREE.CylinderGeometry(1, 1, 1, 8);
  GEO.sph = new THREE.SphereGeometry(1, 20, 14);
  GEO.sphLo = new THREE.SphereGeometry(1, 10, 8);
  GEO.cone = new THREE.CylinderGeometry(0, 1, 1, 18, 1, true);
  GEO.coneC = new THREE.ConeGeometry(1, 1, 16);
  buildRoom();
  buildLights();
  window.addEventListener('resize', onResize); onResize();
}
function onResize() {
  G.W = window.innerWidth; G.H = window.innerHeight;
  G.renderer.setSize(G.W, G.H, false);
  frameCamera();
}
function frameCamera() {
  const a = G.W / G.H, cam = G.camera;
  let fov, pos, look;
  // 동료는 어느 화면에서든 가장자리에 걸쳐 보이게: 화면 비율마다 카메라와 밴드 자리를 같이 정함
  let band;
  if (a < 0.72) { fov = 74; pos = V3(0.05, 2.12, 1.75); look = V3(-0.05, 0.62, -6.4); band = { tb: [0.76, -0.8], pn: [-0.4, -0.72] }; }
  else if (a < 1.25) { fov = 64; pos = V3(0, 2.12, 1.7); look = V3(0, 0.6, -6.4); band = { tb: [1.05, -0.85], pn: [-0.93, -0.7] }; }
  else { fov = 52; pos = V3(0, 2.15, 1.6); look = V3(0, 0.45, -6.4); band = { tb: [1.48, -0.9], pn: [-1.3, -0.62] }; }
  cam.fov = fov; cam.aspect = a; cam.position.copy(pos); cam.lookAt(look); cam.updateProjectionMatrix();
  G.camBase = { pos: pos.clone(), look: look.clone() }; G.bandLayout = band;
  placeBand();
}

function placeBand() {
  const L = G.bandLayout; if (!L) return;
  if (G.props.piano) G.props.piano.position.set(L.pn[0] + 0.4, 0, L.pn[1] + 0.72);
  const tb = G.band.tb, pn = G.band.pn;
  if (tb) tb.root.position.set(L.tb[0], 0.42, L.tb[1]);
  if (pn) pn.root.position.set(L.pn[0], 0.42, L.pn[1]);
}
function buildRoom() {
  const { scene, M, GEO } = G;
  // 바닥
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(13, 16.4), new THREE.MeshStandardMaterial({ map: woodTex('#c98a4b', 8, [4, 5]), roughness: 0.5, envMap: G.env, envMapIntensity: 0.25 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -4.3); floor.receiveShadow = true; scene.add(floor);
  // 무대
  const stage = new THREE.Mesh(GEO.box, new THREE.MeshStandardMaterial({ color: C('#6d2f22'), roughness: 0.6 }));
  stage.scale.set(8.8, 0.42, 4.9); stage.position.set(0, 0.21, 1.4); stage.receiveShadow = true; scene.add(stage);
  const stTop = new THREE.Mesh(new THREE.PlaneGeometry(8.8, 4.9), new THREE.MeshStandardMaterial({ map: woodTex('#8a5532', 10, [3, 2]), roughness: 0.45, envMap: G.env, envMapIntensity: 0.3 }));
  stTop.rotation.x = -Math.PI / 2; stTop.position.set(0, 0.422, 1.4); stTop.receiveShadow = true; scene.add(stTop);
  // 벽
  const plaster = new THREE.MeshStandardMaterial({ color: C('#f3e3c8'), roughness: 0.9 });
  const wallL = new THREE.Mesh(new THREE.PlaneGeometry(16.4, 4.4), plaster); wallL.rotation.y = Math.PI / 2; wallL.position.set(-6.5, 2.2, -4.3); wallL.receiveShadow = true; scene.add(wallL);
  const wallR = new THREE.Mesh(new THREE.PlaneGeometry(16.4, 4.4), plaster); wallR.rotation.y = -Math.PI / 2; wallR.position.set(6.5, 2.2, -4.3); wallR.receiveShadow = true; scene.add(wallR);
  const wallB = new THREE.Mesh(new THREE.PlaneGeometry(13, 4.4), plaster); wallB.position.set(0, 2.2, -12.5); scene.add(wallB);
  const wallS = new THREE.Mesh(new THREE.PlaneGeometry(13, 4.4), new THREE.MeshStandardMaterial({ color: C('#7a1f2b'), roughness: 0.95 })); wallS.rotation.y = Math.PI; wallS.position.set(0, 2.2, 3.85); scene.add(wallS);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(13, 16.4), new THREE.MeshStandardMaterial({ color: C('#f6ead6'), roughness: 0.95 })); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 4.4, -4.3); scene.add(ceil);
  const tileMat = new THREE.MeshStandardMaterial({ map: tileTex(), roughness: 0.35, envMap: G.env, envMapIntensity: 0.3 });
  const tL = new THREE.Mesh(new THREE.PlaneGeometry(16.4, 1.12), tileMat); tL.rotation.y = Math.PI / 2; tL.position.set(-6.49, 0.56, -4.3); tL.receiveShadow = true; scene.add(tL);
  const tR = new THREE.Mesh(new THREE.PlaneGeometry(16.4, 1.12), tileMat); tR.rotation.y = -Math.PI / 2; tR.position.set(6.49, 0.56, -4.3); tR.receiveShadow = true; scene.add(tR);

  const W = new Batch(), Gl = new Batch(), Mt = new Batch(), Glow = new Batch(), Gs = new Batch();
  // 벽 몰딩
  Gl.add(GEO.box, '#6b3a1e', [-6.44, 1.14, -4.3], 0, [0.06, 0.05, 16.4]);
  Gl.add(GEO.box, '#6b3a1e', [6.44, 1.14, -4.3], 0, [0.06, 0.05, 16.4]);
  // 천장 보
  for (let z = -11.6; z <= 3.2; z += 2.4) W.add(GEO.box, '#7b4a2a', [0, 4.31, z], 0, [13, 0.18, 0.2]);
  // 왼쪽 창문 (햇빛)
  const sky = new THREE.MeshBasicMaterial({ map: skyTex() });
  [-10.2, -6.4, -2.6].forEach(z => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.5), sky); s.rotation.y = Math.PI / 2; s.position.set(-6.47, 2.42, z); scene.add(s);
    const fr = '#fbfaf5';
    W.add(GEO.box, fr, [-6.43, 2.42, z - 0.88], 0, [0.09, 2.62, 0.08]); W.add(GEO.box, fr, [-6.43, 2.42, z + 0.88], 0, [0.09, 2.62, 0.08]);
    W.add(GEO.box, fr, [-6.43, 3.71, z], 0, [0.09, 0.08, 1.84]); W.add(GEO.box, fr, [-6.43, 2.42, z], 0, [0.07, 2.5, 0.05]);
    W.add(GEO.box, fr, [-6.43, 2.95, z], 0, [0.07, 0.05, 1.7]);
    Gl.add(GEO.box, '#8a5530', [-6.36, 1.16, z], 0, [0.26, 0.06, 1.95]);
    // 창틀 화분
    const px = -6.33, pz = z + rand(-0.4, 0.4);
    W.add(GEO.cyl, '#c4643a', [px, 1.27, pz], 0, [0.09, 0.17, 0.09]); 
    for (let k = 0; k < 7; k++) W.add(GEO.sphLo, pick(['#2f8f46', '#3fa556', '#1f7a3c', '#57b85f']), [px + rand(-0.1, 0.1), 1.42 + rand(0, 0.22), pz + rand(-0.13, 0.13)], [rand(0, 3), rand(0, 3), 0], [0.09, 0.04, 0.06]);
  });
  // 햇살 기둥
  const shaftMat = new THREE.MeshBasicMaterial({ color: C('#fff1c9'), transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  [-10.2, -6.4, -2.6].forEach(z => {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 6.2), shaftMat);
    sh.position.set(-4.2, 1.7, z + 0.3); sh.rotation.set(0, Math.PI / 2, -0.95); scene.add(sh);
  });

  // ----- 뒤쪽 바 -----
  Gl.add(GEO.box, '#7a4526', [0, 0.52, -11.43], 0, [9.2, 1.04, 0.62]);
  Gl.add(GEO.box, '#b9783f', [0, 1.07, -11.4], 0, [9.4, 0.06, 0.78]);
  for (let x = -4.4; x <= 4.4; x += 0.55) Gl.add(GEO.box, '#5e3219', [x, 0.52, -11.11], 0, [0.04, 0.96, 0.02]);
  Mt.add(GEO.cyl, '#d9a43a', [0, 0.2, -10.98], [0, 0, Math.PI / 2], [0.025, 9.2, 0.025]);
  // 뒷장 선반과 술병
  Gl.add(GEO.box, '#3c2a22', [0, 2.2, -12.44], 0, [9.0, 2.3, 0.06]);
  [1.5, 2.05, 2.6, 3.1].forEach((y, row) => {
    Gl.add(GEO.box, '#8a5530', [0, y, -12.3], 0, [8.6, 0.04, 0.3]);
    if (row === 3) return;
    for (let x = -4.1; x <= 4.1; x += rand(0.22, 0.36)) {
      const c = pick(['#7a3b12', '#1f6b3a', '#a8d0dd', '#c2451e', '#d9a43a', '#3a4fa0', '#5c1a2a', '#e8e1c9', '#2f8f7a']);
      const hgt = rand(0.24, 0.36), r = rand(0.04, 0.06);
      Gl.add(GEO.cyl, c, [x, y + 0.02 + hgt * 0.5, -12.3], 0, [r, hgt, r]);
      Gl.add(GEO.cyl, c, [x, y + 0.02 + hgt + 0.06, -12.3], 0, [r * 0.38, 0.12, r * 0.38]);
      if (Math.random() < 0.7) W.add(GEO.cyl, pick(['#f6f1e2', '#f2d16b', '#1d2f5c']), [x, y + 0.02 + hgt * 0.45, -12.3 + 0.001], 0, [r * 1.03, hgt * 0.32, r * 1.03]);
    }
  });
  // 간판
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshStandardMaterial({ map: signTex(), roughness: 0.5, emissive: C('#1a1a10'), emissiveIntensity: 0.2 }));
  sign.position.set(0, 3.68, -12.38); scene.add(sign); G.props.sign = sign;
  // 바 스툴
  [-3.2, -1.6, 0, 1.6, 3.2].forEach(x => {
    Mt.add(GEO.cyl, '#cfd4d8', [x, 0.38, -10.72], 0, [0.03, 0.76, 0.03]);
    Mt.add(GEO.cyl, '#cfd4d8', [x, 0.02, -10.72], 0, [0.2, 0.03, 0.2]);
    Mt.add(GEO.cyl, '#d9a43a', [x, 0.3, -10.72], 0, [0.17, 0.02, 0.17]);
    Gs.add(GEO.cyl, '#b3242f', [x, 0.78, -10.72], 0, [0.2, 0.08, 0.2]);
    G.seats.push({ x, z: -10.72, seatY: 0.82, kind: 'stool', far: true });
  });
  // 바텐더 자리 + 소품
  Mt.add(GEO.cyl, '#cfd4d8', [-2.6, 1.22, -11.5], 0, [0.05, 0.24, 0.05]);
  Gl.add(GEO.box, '#2b3a67', [3.0, 1.22, -11.5], 0, [0.4, 0.26, 0.3]);

  // ----- 테이블과 의자 -----
  const tables = [[-2.75, -2.75], [0.05, -2.8], [2.8, -2.7], [-3.95, -5.05], [-1.35, -5.1], [1.4, -5.0], [3.95, -5.1], [-2.7, -7.5], [0.1, -7.55], [2.75, -7.45]];
  G.tables = tables;
  tables.forEach(([tx, tz], ti) => {
    Gl.add(GEO.cyl, '#5a3420', [tx, 0.74, tz], 0, [0.44, 0.045, 0.44]);
    Mt.add(GEO.cyl, '#2e2e2e', [tx, 0.37, tz], 0, [0.04, 0.72, 0.04]);
    Mt.add(GEO.cyl, '#2e2e2e', [tx, 0.015, tz], 0, [0.25, 0.03, 0.25]);
    // 촛불과 잔
    Gs.add(GEO.cyl, '#d23a2e', [tx - 0.08, 0.8, tz + 0.12], 0, [0.04, 0.08, 0.04]);
    Glow.add(GEO.sphLo, '#ffd27a', [tx - 0.08, 0.865, tz + 0.12], 0, [0.014, 0.03, 0.014]);
    const nd = randi(1, 3);
    for (let k = 0; k < nd; k++) {
      const gx = tx + rand(-0.28, 0.28), gz = tz + rand(-0.25, 0.2), kind = Math.random();
      if (kind < 0.4) { Gs.add(GEO.cyl, '#e8a22a', [gx, 0.84, gz], 0, [0.035, 0.15, 0.035]); Gs.add(GEO.cyl, '#fff6dd', [gx, 0.925, gz], 0, [0.036, 0.025, 0.036]); }
      else if (kind < 0.75) { Gs.add(GEO.coneC, pick(['#e8475f', '#f2b72b', '#58c1e0', '#9be36b']), [gx, 0.87, gz], [Math.PI, 0, 0], [0.055, 0.06, 0.055]); Gs.add(GEO.cyl, '#e6f4ff', [gx, 0.8, gz], 0, [0.006, 0.07, 0.006]); Gs.add(GEO.cyl, '#e6f4ff', [gx, 0.765, gz], 0, [0.03, 0.006, 0.03]); }
      else { Gs.add(GEO.cyl, '#7a3b12', [gx, 0.81, gz], 0, [0.04, 0.09, 0.04]); }
    }
    // 의자: 무대 반대편에 앉아 무대를 봄
    const seats = [[-0.52, -0.34], [0.52, -0.34]];
    if (ti % 3 === 1) seats.push([0, -0.66]);
    seats.forEach(([dx, dz]) => {
      const sx = tx + dx, sz = tz + dz, ry = Math.atan2(0 - sx, 1 - sz);
      buildChair(Gl, sx, sz, ry);
      G.seats.push({ x: sx, z: sz, seatY: 0.47, kind: 'chair', far: ti >= 7 });
    });
  });
  // 오른쪽 벽 부스
  [-3.6, -6.0].forEach(bz => {
    Gs.add(GEO.box, '#b3242f', [5.95, 0.24, bz], 0, [0.62, 0.42, 1.9]);
    Gs.add(GEO.box, '#b3242f', [6.32, 0.8, bz], 0, [0.16, 1.0, 1.9]);
    for (let k = -2; k <= 2; k++) W.add(GEO.box, '#8d1a25', [6.24, 0.8, bz + k * 0.36], 0, [0.02, 0.92, 0.02]);
    Gl.add(GEO.box, '#5a3420', [5.2, 0.74, bz], 0, [0.65, 0.04, 1.2]);
    Mt.add(GEO.cyl, '#2e2e2e', [5.2, 0.37, bz], 0, [0.05, 0.72, 0.05]);
    [-0.45, 0.45].forEach(o => G.seats.push({ x: 5.85, z: bz + o, seatY: 0.46, kind: 'booth', far: true }));
  });
  // 포스터와 벽등
  [[-3.0, 0], [-6.0, 1], [-9.2, 2]].forEach(([z, k]) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.25), new THREE.MeshStandardMaterial({ map: posterTex(k), roughness: 0.7 }));
    p.rotation.y = -Math.PI / 2; p.position.set(6.44, 2.6, z); scene.add(p);
    W.add(GEO.box, '#2a1a12', [6.47, 2.6, z], 0, [0.03, 1.33, 0.98]);
  });
  [-1.5, -4.6, -7.7, -10.6].forEach(z => {
    Mt.add(GEO.cyl, '#d9a43a', [6.4, 2.35, z], [0, 0, Math.PI / 2], [0.05, 0.16, 0.05]);
    Glow.add(GEO.sphLo, '#fff0c2', [6.3, 2.42, z], 0, [0.07, 0.09, 0.07]);
  });
  // 펜던트 조명
  tables.forEach(([tx, tz]) => {
    Mt.add(GEO.cyl, '#2b2b2b', [tx, 3.85, tz], 0, [0.006, 1.1, 0.006]);
    Mt.add(GEO.cone, '#1f8a6b', [tx, 3.22, tz], 0, [0.24, 0.22, 0.24]);
    Glow.add(GEO.sphLo, '#fff2c4', [tx, 3.14, tz], 0, [0.075, 0.075, 0.075]);
  });
  // 모서리 큰 화분
  [[-5.9, -11.7], [5.9, -11.7], [-5.9, -0.2]].forEach(([x, z]) => {
    W.add(GEO.cyl, '#c4643a', [x, 0.3, z], 0, [0.28, 0.6, 0.28]);
    for (let k = 0; k < 16; k++) W.add(GEO.sphLo, pick(['#2f8f46', '#3fa556', '#1f7a3c', '#57b85f']), [x + rand(-0.35, 0.35), 0.8 + rand(0, 1.1), z + rand(-0.35, 0.35)], [rand(0, 3), rand(0, 3), rand(0, 3)], [0.2, 0.07, 0.12]);
  });
  // ----- 무대 소품 -----
  // 업라이트 피아노 (왼쪽, 건반이 무대 가운데 쪽) — 화면 비율에 따라 위치를 옮기므로 따로 묶음
  const PB = new Batch(), PW = new Batch();
  PB.add(GEO.box, '#2a1712', [-1.3, 0.42 + 0.64, -0.72], 0, [0.6, 1.28, 1.5]);
  PB.add(GEO.box, '#3a2219', [-0.96, 0.42 + 0.7, -0.72], 0, [0.12, 0.05, 1.42]);
  PW.add(GEO.box, '#f7f3ea', [-0.9, 0.42 + 0.74, -0.72], 0, [0.16, 0.025, 1.34]);
  for (let k = 0; k < 22; k++) { if ([2, 6, 9, 13, 16, 20].includes(k)) continue; PW.add(GEO.box, '#141414', [-0.93, 0.42 + 0.762, -1.36 + k * 0.061], 0, [0.09, 0.02, 0.028]); }
  PB.add(GEO.box, '#2a1712', [-1.28, 0.42 + 1.32, -0.72], 0, [0.66, 0.05, 1.56]);
  PB.add(GEO.box, '#2a1712', [-0.38, 0.42 + 0.45, -0.72], 0, [0.36, 0.05, 0.8]);
  [[-0.53, -1.05], [-0.23, -1.05], [-0.53, -0.39], [-0.23, -0.39]].forEach(([x, z]) => PB.add(GEO.cyl, '#2a1712', [x, 0.42 + 0.22, z], 0, [0.025, 0.44, 0.025]));
  G.props.piano = new THREE.Group(); scene.add(G.props.piano);
  { const a = PB.mesh(M.gloss), b = PW.mesh(M.vc); a.castShadow = true; G.props.piano.add(a); G.props.piano.add(b); }

  const add = (b, mat, cast) => { if (!b.size) return; const m = b.mesh(mat); m.castShadow = !!cast; m.receiveShadow = true; scene.add(m); return m; };
  add(W, M.vc, false); add(Gl, M.gloss, true); add(Mt, M.metal, true); add(Gs, M.gloss, false);
}
function buildChair(Gl, x, z, ry) {
  const GEO = G.GEO, m0 = mtx([x, 0, z], [0, ry, 0]);
  const at = (p, r, s, geo, color, batch) => batch.addM(geo, color, m0.clone().multiply(mtx(p, r, s)));
  at([0, 0.45, 0], 0, [0.22, 0.045, 0.22], GEO.cyl, '#7b4423', Gl);
  [[0.15, 0.15], [-0.15, 0.15], [0.15, -0.15], [-0.15, -0.15]].forEach(([a, b]) => at([a, 0.22, b], [b * 0.4, 0, -a * 0.4], [0.016, 0.46, 0.016], GEO.cyl8, '#5e3219', Gl));
  at([0, 0.78, -0.19], [0, 0, 0], [0.19, 0.19, 0.19], new THREE.TorusGeometry(1, 0.08, 6, 16, Math.PI), '#5e3219', Gl);
  [-0.12, 0.12].forEach(a => at([a, 0.62, -0.2], 0, [0.014, 0.34, 0.014], GEO.cyl8, '#5e3219', Gl));
}
function buildLights() {
  const s = G.scene;
  const hemi = new THREE.HemisphereLight(C('#e3f2ff'), C('#e0a86e'), 0.72); s.add(hemi);
  const amb = new THREE.AmbientLight(C('#ffffff'), 0.12); s.add(amb);
  const sun = new THREE.DirectionalLight(C('#fff0d6'), 1.65);
  sun.position.set(-11, 9, -4.5); sun.target.position.set(1.5, 0, -5.5); s.add(sun.target);
  sun.castShadow = true;
  const big = Math.min(window.devicePixelRatio || 1, 2) > 1.5 ? 1536 : 2048;
  sun.shadow.mapSize.set(big, big);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 9, bottom: -9, near: 1, far: 32 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.025;
  s.add(sun);
  const spill = new THREE.PointLight(C('#ffd7a0'), 0.95, 17, 1.3); spill.position.set(0, 3.1, 0.3); s.add(spill);
  const back = new THREE.PointLight(C('#ffe6b8'), 0.55, 10, 1.4); back.position.set(0, 3.2, -9.5); s.add(back);
  // 내 솔로 때 나를 비추는 핀 조명
  const spot = new THREE.SpotLight(C('#fff1c8'), 0, 9, 0.36, 0.55, 1.2);
  spot.position.set(0.1, 4.25, -2.5); spot.target.position.set(0, 1.2, 0.7); s.add(spot); s.add(spot.target);
  const coneMat = new THREE.MeshBasicMaterial({ color: C('#fff3cf'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.95, 4.4, 24, 1, true), coneMat);
  const a = V3(0.1, 4.25, -2.5), b = V3(0, 1.2, 0.7), mid = a.clone().add(b).multiplyScalar(0.5);
  cone.position.copy(mid); cone.lookAt(b); cone.rotateX(-Math.PI / 2);
  s.add(cone);
}

// ===================== 사람들 =====================
const SKIN = ['#f3cfb3', '#e8b48f', '#d49a6a', '#b07246', '#7d4b2a', '#f6dccb', '#eac1a0', '#c98a5c'];
const HAIRC = ['#1c1716', '#2d1c12', '#4a2c1a', '#7a4a26', '#b0753c', '#d9b26a', '#e86a92', '#3b6fd4', '#c2452d'];
const TOPS = ['#e2403a', '#2f6fdb', '#f2b72b', '#1f9e7a', '#8a4fd1', '#ff8a3d', '#2b3a67', '#f4f1e8', '#57b847', '#d6336c', '#14a3b8', '#ffffff', '#ffd23f'];
const BOTTOMS = ['#2b3a67', '#3a3a3a', '#6b4f3a', '#1f2937', '#8b6f47', '#334155', '#1e4d8c', '#5b4a7a'];
const POSE = {
  rest: [-0.5, 0.15, -1.05], clap: [-1.0, 0.46, -1.3], clapHigh: [-2.55, 0.3, -0.55], raise: [-2.5, -0.05, -0.35],
  fist: [-2.75, 0.05, -1.55], whistle: [-1.15, 0.82, -2.3], heart: [-0.6, 0.9, -1.85], snap: [-0.7, 0.12, -1.75],
  slap: [-0.92, 0.18, -0.4], phone: [-1.0, 0.42, -1.95], point: [-1.45, 0.15, -0.08], chin: [-0.75, 0.62, -2.25],
  wave: [-2.6, -0.25, -0.7], hang: [-0.05, 0.05, -0.12], keys: [-1.18, 0.18, -0.5], shake: [-1.6, 0.55, -1.9],
};
const PG = {};
function pgeo() {
  if (PG.ok) return PG;
  PG.torso = new THREE.CylinderGeometry(0.2, 0.165, 1, 16);
  PG.limb = new THREE.CylinderGeometry(1, 1, 1, 10);
  PG.cap = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
  PG.shell = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true, Math.PI * 0.32, Math.PI * 1.36);
  PG.smile = new THREE.TorusGeometry(0.036, 0.0085, 6, 14, Math.PI);
  PG.ring = new THREE.TorusGeometry(1, 0.13, 6, 20);
  PG.skirt = new THREE.CylinderGeometry(0.17, 0.28, 1, 16);
  PG.ok = true; return PG;
}
const easeIO = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const visNow = () => AE.ctx && AE.ctx.state === 'running' ? AE.ctx.currentTime - (AE.ctx.outputLatency || 0.02) : performance.now() / 1000;

class Person {
  constructor(o) {
    const P = pgeo(), GE = G.GEO; this.o = o; this.angry = !!o.angry;
    const female = o.female ?? Math.random() < 0.5; this.female = female;
    const skin = o.skin || pick(SKIN), gray = Math.random() < 0.13;
    const hairC = o.hairC || (gray ? '#a3a3a3' : pick(HAIRC.slice(0, Math.random() < 0.82 ? 6 : 9)));
    const top = o.top || pick(TOPS), bottom = o.bottom || pick(BOTTOMS), shoeC = pick(['#1c1c1c', '#5a3a22', '#e9e4da', '#8b2c2c']);
    const outfit = o.outfit || pick(female ? ['tee', 'blouse', 'dress', 'sweater', 'jacket'] : ['tee', 'shirt', 'jacket', 'sweater', 'shirtTie']);
    const sleeveShort = outfit === 'tee' && Math.random() < 0.6;
    this.root = new THREE.Group(); this.root.position.set(o.x, o.y || 0, o.z);
    const cam = V3(0, 2.0, 0.9);
    this.baseRy = o.ry ?? Math.atan2(cam.x - o.x, cam.z - o.z);
    this.root.rotation.y = this.baseRy;
    G.scene.add(this.root);
    const standing = o.kind === 'stand';
    this.seatY = standing ? 0.91 : (o.seatY ?? 0.47);
    this.pelvis = new THREE.Group(); this.pelvis.position.y = standing ? 0.95 : this.seatY + 0.04; this.root.add(this.pelvis);
    const mk = (b, mat, parent, shadow) => { const m = b.mesh(mat); m.castShadow = !!shadow; m.receiveShadow = false; parent.add(m); return m; };

    // ---- 다리 ----
    const legC = outfit === 'dress' ? skin : bottom;
    if (!standing) {
      const L = new Batch(), sy = this.seatY;
      for (const sx of [-0.1, 0.1]) {
        L.add(P.limb, outfit === 'dress' ? top : bottom, [sx, sy + 0.06, 0.19], [Math.PI / 2, 0, 0], [0.082, 0.42, 0.082]);
        L.add(GE.sphLo, outfit === 'dress' ? top : bottom, [sx, sy + 0.06, 0.4], 0, [0.083, 0.083, 0.083]);
        const sl = Math.min(sy - 0.08, 0.45);
        L.add(P.limb, legC, [sx, sy + 0.06 - sl / 2, 0.41], 0, [0.07, sl, 0.07]);
        L.add(GE.box, shoeC, [sx, sy + 0.04 - sl, 0.45], 0, [0.1, 0.07, 0.21]);
      }
      if (outfit === 'dress') L.add(GE.box, top, [0, sy + 0.1, 0.17], 0, [0.4, 0.05, 0.42]);
      this.legsSit = mk(L, M_().person, this.root, false);
    }
    const S = new Batch();
    for (const sx of [-0.1, 0.1]) { S.add(P.limb, legC, [sx, 0.47, 0], 0, [0.082, 0.9, 0.082]); S.add(GE.box, shoeC, [sx, 0.035, 0.05], 0, [0.1, 0.07, 0.22]); }
    if (outfit === 'dress') S.add(PG.skirt, top, [0, 0.72, 0], 0, [1, 0.42, 0.85]);
    this.legsStand = mk(S, M_().person, this.root, false);
    this.legsStand.visible = standing;

    // ---- 몸통 ----
    this.torso = new THREE.Group(); this.pelvis.add(this.torso);
    const T = new Batch();
    const accent = pick(TOPS.filter(c => c !== top)), shirtC = pick(['#ffffff', '#f4f1e8', '#cfe3ff', '#ffe9e0']);
    T.add(P.torso, top, [0, 0.27, 0], 0, [1.1, 0.52, 0.8]);
    T.add(GE.sph, top, [0, 0.05, 0], 0, [0.2, 0.08, 0.15]);
    T.add(GE.sph, top, [-0.2, 0.465, 0], 0, [0.1, 0.085, 0.09]); T.add(GE.sph, top, [0.2, 0.465, 0], 0, [0.1, 0.085, 0.09]);
    T.add(P.limb, skin, [0, 0.575, 0.005], 0, [0.052, 0.1, 0.052]);
    if (outfit === 'tee') { T.add(PG.ring, shadeHex(top, -0.25), [0, 0.525, 0.005], [Math.PI / 2, 0, 0], [0.068, 0.068, 0.068]); if (Math.random() < 0.6) T.add(GE.sphLo, accent, [0, 0.36, 0.162], 0, [0.07, 0.07, 0.01]); }
    if (outfit === 'shirt' || outfit === 'shirtTie' || outfit === 'blouse') {
      T.add(GE.box, shadeHex(top, 0.15), [-0.045, 0.53, 0.1], [0.35, 0, 0.6], [0.075, 0.022, 0.05]);
      T.add(GE.box, shadeHex(top, 0.15), [0.045, 0.53, 0.1], [0.35, 0, -0.6], [0.075, 0.022, 0.05]);
      [0.43, 0.33, 0.23].forEach(y => T.add(GE.sphLo, shadeHex(top, -0.3), [0, y, 0.163], 0, [0.009, 0.009, 0.006]));
      if (outfit === 'shirtTie') { const tc = pick(['#c2262e', '#1e3a8a', '#f2b72b', '#14532d']); T.add(GE.box, tc, [0, 0.35, 0.168], [0.05, 0, 0], [0.045, 0.3, 0.012]); T.add(GE.sphLo, tc, [0, 0.505, 0.15], 0, [0.025, 0.022, 0.02]); }
    }
    if (outfit === 'jacket') {
      T.add(GE.box, shirtC, [0, 0.43, 0.158], 0, [0.09, 0.2, 0.012]);
      T.add(GE.box, shadeHex(top, -0.22), [-0.06, 0.42, 0.163], [0, 0, -0.35], [0.05, 0.22, 0.012]);
      T.add(GE.box, shadeHex(top, -0.22), [0.06, 0.42, 0.163], [0, 0, 0.35], [0.05, 0.22, 0.012]);
      T.add(GE.sphLo, shadeHex(top, -0.4), [0, 0.22, 0.165], 0, [0.012, 0.012, 0.006]);
    }
    if (outfit === 'sweater') [0.17, 0.27, 0.37].forEach(y => T.add(P.limb, accent, [0, y, 0], 0, [0.208, 0.028, 0.148]));
    if (outfit === 'blouse') for (let k = -2; k <= 2; k++) T.add(GE.sphLo, '#ffffff', [k * 0.028, 0.52 - Math.abs(k) * 0.008, 0.13], 0, [0.018, 0.014, 0.012]);
    this.body = mk(T, M_().person, this.torso, true);

    // ---- 머리 ----
    this.head = new THREE.Group(); this.head.position.set(0, 0.76, 0.012); this.head.rotation.order = 'YXZ'; this.torso.add(this.head);
    const H = new Batch();
    H.add(GE.sph, skin, [0, 0, 0], 0, [0.165, 0.177, 0.162]);
    H.add(GE.sphLo, skin, [-0.16, -0.005, -0.005], 0, [0.03, 0.045, 0.035]); H.add(GE.sphLo, skin, [0.16, -0.005, -0.005], 0, [0.03, 0.045, 0.035]);
    H.add(GE.sphLo, shadeHex(skin, -0.08), [0, -0.012, 0.162], 0, [0.024, 0.03, 0.027]);
    if (female || Math.random() < 0.25) { H.add(GE.sphLo, '#f29a96', [-0.095, -0.04, 0.128], [0, -0.5, 0], [0.032, 0.018, 0.008]); H.add(GE.sphLo, '#f29a96', [0.095, -0.04, 0.128], [0, 0.5, 0], [0.032, 0.018, 0.008]); }
    const style = o.hair || (female ? pick(['bob', 'long', 'bun', 'pony', 'curly', 'short']) : pick(['short', 'short', 'buzz', 'curly', 'bald', 'side']));
    const hc = hairC;
    if (style !== 'bald') H.add(P.cap, hc, [0, 0.012, -0.006], [-0.38, 0, 0], [style === 'buzz' ? 0.168 : 0.174, style === 'buzz' ? 0.18 : 0.19, 0.172]);
    if (style === 'bob') H.add(P.shell, hc, [0, -0.06, -0.005], 0, [0.178, 0.2, 0.172]);
    if (style === 'long') H.add(P.shell, hc, [0, -0.16, -0.01], 0, [0.178, 0.4, 0.17]);
    if (style === 'bun') H.add(GE.sph, hc, [0, 0.15, -0.1], 0, [0.075, 0.07, 0.075]);
    if (style === 'pony') { H.add(GE.sph, hc, [0, 0.06, -0.17], 0, [0.045, 0.045, 0.045]); H.add(G.GEO.coneC, hc, [0, -0.06, -0.2], [0.35, 0, Math.PI], [0.05, 0.22, 0.05]); }
    if (style === 'curly') for (let k = 0; k < 16; k++) { const a = rand(0, Math.PI * 2), e = rand(0.05, 1.2); H.add(GE.sphLo, hc, [Math.sin(a) * 0.15 * Math.cos(e * 0.6), 0.06 + Math.sin(e) * 0.12, Math.cos(a) * 0.15 * Math.cos(e * 0.6) - 0.04], 0, [0.06, 0.06, 0.06]); }
    if (style === 'bald') H.add(P.shell, '#9a9a9a', [0, -0.01, -0.005], 0, [0.17, 0.07, 0.166]);
    if (style === 'side') H.add(P.shell, hc, [0, -0.04, -0.005], 0, [0.176, 0.12, 0.17]);
    if (!female && Math.random() < 0.28) { H.add(GE.sphLo, hc, [0, -0.115, 0.07], 0, [0.12, 0.08, 0.1]); H.add(GE.box, hc, [0, -0.047, 0.158], 0, [0.075, 0.018, 0.02]); }
    if (o.glasses ?? Math.random() < 0.3) {
      const gc = pick(['#1b1b1b', '#6b3b1a', '#2b3a67']);
      H.add(PG.ring, gc, [-0.058, 0.024, 0.163], 0, [0.034, 0.034, 0.03]); H.add(PG.ring, gc, [0.058, 0.024, 0.163], 0, [0.034, 0.034, 0.03]);
      H.add(GE.box, gc, [0, 0.03, 0.166], 0, [0.04, 0.008, 0.008]);
    }
    const hat = o.hat || (Math.random() < 0.12 ? pick(['beret', 'cap']) : null);
    if (hat === 'beret') H.add(GE.sph, pick(['#c2262e', '#1b1b1b', '#2b3a67']), [0.02, 0.13, -0.01], [0.1, 0, -0.25], [0.19, 0.06, 0.18]);
    if (hat === 'cap') { const cc = pick(['#2f6fdb', '#e2403a', '#1b1b1b']); H.add(P.cap, cc, [0, 0.03, -0.005], [-0.25, 0, 0], [0.18, 0.17, 0.178]); H.add(GE.box, cc, [0, 0.07, 0.17], [0.2, 0, 0], [0.18, 0.015, 0.12]); }
    if (hat === 'pork') { H.add(GE.cyl, '#2a2a2a', [0, 0.14, -0.01], [-0.1, 0, 0], [0.13, 0.11, 0.13]); H.add(GE.cyl, '#2a2a2a', [0, 0.09, -0.01], [-0.1, 0, 0], [0.24, 0.012, 0.24]); H.add(GE.cyl, '#b3242f', [0, 0.11, -0.01], [-0.1, 0, 0], [0.132, 0.025, 0.132]); }
    if (female && Math.random() < 0.4) { H.add(GE.sphLo, '#e6b422', [-0.16, -0.07, 0], 0, [0.014, 0.014, 0.014]); H.add(GE.sphLo, '#e6b422', [0.16, -0.07, 0], 0, [0.014, 0.014, 0.014]); }
    this.headMesh = mk(H, M_().person, this.head, true);
    // 눈
    this.eyes = new THREE.Group(); this.eyes.position.y = 0.022; this.head.add(this.eyes);
    const E = new Batch(), eyeC = pick(['#2b1a12', '#3b2a1a', '#1d2a4d', '#2f5d3a']);
    for (const sx of [-0.058, 0.058]) {
      E.add(GE.sphLo, '#ffffff', [sx, 0, 0.138], 0, [0.033, 0.036, 0.02]);
      E.add(GE.sphLo, eyeC, [sx, -0.002, 0.155], 0, [0.019, 0.021, 0.008]);
      E.add(GE.sphLo, '#ffffff', [sx + 0.006, 0.008, 0.162], 0, [0.005, 0.005, 0.003]);
    }
    mk(E, M_().personGloss, this.eyes, false);
    // 눈썹
    this.brows = new THREE.Group(); this.brows.position.y = 0.085; this.head.add(this.brows);
    const B = new Batch(); const bc = gray ? '#7a7a7a' : shadeHex(hairC === '#d9b26a' ? '#8a6a3a' : hairC, -0.1);
    B.add(GE.box, bc, [-0.06, 0, 0.146], [0, 0, this.angry ? -0.42 : 0.12], [0.062, 0.014, 0.016]); B.add(GE.box, bc, [0.06, 0, 0.146], [0, 0, this.angry ? 0.42 : -0.12], [0.062, 0.014, 0.016]);
    mk(B, M_().person, this.brows, false);
    // 입
    this.mouth = new THREE.Group(); this.mouth.position.set(0, -0.068, 0); this.head.add(this.mouth);
    const SM = new Batch(); SM.add(PG.smile, '#7a2a2a', [0, 0.03, 0.15], [0, 0, Math.PI], [1, 1, 1]);
    this.smile = mk(SM, M_().person, this.mouth, false);
    const OM = new Batch();
    OM.add(GE.sphLo, '#5a1a1d', [0, -0.005, 0.142], 0, [0.042, 0.04, 0.018]);
    OM.add(GE.box, '#ffffff', [0, 0.022, 0.155], 0, [0.05, 0.012, 0.01]);
    OM.add(GE.sphLo, '#e86f7a', [0, -0.028, 0.151], 0, [0.025, 0.012, 0.01]);
    this.open = new THREE.Group(); this.mouth.add(this.open); mk(OM, M_().person, this.open, false); this.open.visible = false;

    // ---- 팔 ----
    const sleeve = top, fore = sleeveShort ? skin : top;
    this.arms = {};
    for (const side of ['R', 'L']) {
      const sh = new THREE.Group(); sh.position.set(side === 'R' ? -0.215 : 0.215, 0.455, 0); this.torso.add(sh);
      const UA = new Batch(); UA.add(P.limb, sleeve, [0, -0.14, 0], 0, [0.056, 0.28, 0.056]); mk(UA, M_().person, sh, false);
      const el = new THREE.Group(); el.position.y = -0.28; sh.add(el);
      const FA = new Batch(); FA.add(P.limb, fore, [0, -0.125, 0], 0, [0.05, 0.25, 0.05]); FA.add(GE.sph, skin, [0, -0.29, 0.005], 0, [0.052, 0.06, 0.048]); FA.add(GE.sphLo, skin, [side === 'R' ? 0.035 : -0.035, -0.27, 0.03], 0, [0.018, 0.03, 0.018]);
      mk(FA, M_().person, el, false);
      const hand = new THREE.Group(); hand.position.set(0, -0.31, 0.02); el.add(hand);
      this.arms[side] = { sh, el, hand, cur: POSE.rest.slice() };
    }
    // 손에 드는 것 (잔, 휴대폰)
    const GL = new Batch();
    GL.add(G.GEO.coneC, pick(['#e8475f', '#f2b72b', '#58c1e0', '#9be36b']), [0, -0.07, 0.0], [0, 0, 0], [0.05, 0.06, 0.05]);
    GL.add(G.GEO.cyl, '#e6f4ff', [0, -0.01, 0], 0, [0.006, 0.07, 0.006]);
    this.glass = new THREE.Group(); this.glass.rotation.x = Math.PI; this.glass.position.set(0, 0.02, 0.03); mk(GL, M_().gloss, this.glass, false); this.arms.R.hand.add(this.glass); this.glass.visible = false;
    const PH = new Batch(); PH.add(G.GEO.box, '#1c1c1c', [0, 0, 0], 0, [0.075, 0.14, 0.012]);
    this.phone = new THREE.Group(); this.phone.position.set(0, 0, 0.05); this.phone.rotation.x = -1.2; mk(PH, M_().person, this.phone, false);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.065, 0.125), new THREE.MeshBasicMaterial({ color: C('#bfe6ff') })); scr.position.z = 0.0065; this.phone.add(scr);
    this.arms.R.hand.add(this.phone); this.phone.visible = false;

    // ---- 성격 / 상태 ----
    this.groove = rand(0.65, 1.25); this.half = Math.random() < 0.3; this.phase = rand(0, 6.28);
    this.f0 = female ? rand(190, 245) : rand(102, 145); this.fs = female ? 1.13 : 1;
    this.loud = rand(0.75, 1.15); this.vocalness = rand(0.25, 1); this.smileBase = rand(0.25, 0.85);
    this.nodAmp = 0.3; this.nodTarget = 0.3; this.lean = 0; this.leanTarget = 0;
    this.standT = standing ? 1 : 0; this.standTarget = standing ? 1 : 0; this.alwaysStand = standing;
    this.blinkT = rand(0.5, 4); this.vocalUntil = 0; this.vocalType = ''; this.surprise = 0; this.bliss = 0; this.grinUntil = 0; this.chatUntil = 0;
    this.smileV = this.smileBase; this.mOpenV = 0; this.browUp = 0;
    this.action = null; this.idle = null; this.clapping = false; this.clapTimes = []; this.clapHigh = false; this.snapAt = -9; this.slapAt = -9;
    this.lookAt = null; this.yaw = 0; this.pitch = 0;
    this.anchor = new THREE.Object3D(); this.anchor.position.set(0, 0.3, 0); this.head.add(this.anchor);
    this.far = !!o.far;
  }
  headWorld(v = V3()) { return this.anchor.getWorldPosition(v); }
  pan() { const v = this.headWorld().project(G.camera); return clamp(v.x * 0.85, -0.85, 0.85); }
  setAction(type, dur) { const n = visNow(); this.action = { type, t0: n, until: n + dur }; }
  updateArms(dt, now) {
    const k = 1 - Math.exp(-dt * 10);
    let R = this.idle ? POSE[this.idle] : POSE.rest, L = POSE.rest;
    const a = this.action && now < this.action.until ? this.action : null;
    if (!a) this.action = null;
    if (this.clapping) { R = L = this.clapHigh ? POSE.clapHigh : POSE.clap; }
    else if (a) { if (a.type === 'slap') R = L = POSE.slap; else if (a.type === 'clapHigh') R = L = POSE.clapHigh; else R = POSE[a.type] || R; }
    if (this.armOverride) { R = this.armOverride.R || R; L = this.armOverride.L || L; }
    const AR = this.arms.R, AL = this.arms.L;
    for (let i = 0; i < 3; i++) { AR.cur[i] += (R[i] - AR.cur[i]) * k; AL.cur[i] += (L[i] - AL.cur[i]) * k; }
    let sep = 1;
    if (this.clapping) {
      const ts = this.clapTimes; let nx = null, pv = null;
      for (let i = 0; i < ts.length; i++) if (ts[i] > now) { nx = ts[i]; pv = i > 0 ? ts[i - 1] : nx - 0.22; break; }
      if (nx != null) { const ph = clamp((now - pv) / Math.max(0.05, nx - pv), 0, 1); sep = Math.pow(Math.sin(Math.PI * ph), 0.55); }
    }
    let pR = AR.cur[0], pL = AL.cur[0], rR = AR.cur[1], rL = AL.cur[1];
    if (this.clapping) { rR -= 0.32 * sep; rL -= 0.32 * sep; }
    if (a && a.type === 'fist') pR += 0.28 * Math.sin((now - a.t0) * 10);
    if (a && a.type === 'wave') rR += 0.3 * Math.sin((now - a.t0) * 9);
    if (a && a.type === 'shake') { pR += 0.12 * Math.sin(now * 38); pL = pR; rL = rR; }
    const sl = Math.exp(-Math.max(0, now - this.slapAt) * 14);
    if (a && a.type === 'slap') { pR += 0.35 * sl; pL += 0.35 * sl; }
    AR.sh.rotation.set(pR, 0, rR); AL.sh.rotation.set(pL, 0, -rL);
    AR.el.rotation.x = AR.cur[2]; AL.el.rotation.x = AL.cur[2];
    const fl = now - this.snapAt < 0.13 ? 0.5 : 0; AR.hand.rotation.x = fl;
    this.glass.visible = !!(a && a.type === 'raise');
    this.phone.visible = this.idle === 'phone' && !this.clapping && !a;
  }
  updateFace(dt, now) {
    this.blinkT -= dt; let ey = 1;
    if (this.blinkT < 0) { if (this.blinkT < -0.12) this.blinkT = rand(1.8, 5); else ey = 0.12; }
    if (this.bliss > now) ey = 0.14; else if (this.bored) ey = Math.min(ey, 0.55);
    const sur = this.surprise > now, es = sur ? 1.22 : 1;
    this.eyes.scale.set(es, ey * es, 1);
    this.brows.position.y = 0.085 + (sur ? 0.024 : this.browUp);
    let open = 0;
    if (!this.angry) {
      if (now >= this.vocalStart - 0.02 && now < this.vocalUntil) open = this.vocalType === 'laugh' || this.vocalType === 'ha' ? 0.45 + 0.55 * Math.abs(Math.sin(now * 22)) : this.vocalType === 'mm' ? 0.08 : this.vocalType === 'whistle' ? 0.25 : 0.95;
      else if (sur) open = 0.8;
      else if (this.grinUntil > now) open = 0.42;
      else if (this.chatUntil > now) open = Math.abs(Math.sin(now * 13 + this.phase)) > 0.55 ? 0.38 : 0.04;
    }
    this.mOpenV += (open - this.mOpenV) * Math.min(1, dt * 20);
    const show = this.mOpenV > 0.12;
    this.open.visible = show; this.smile.visible = !show;
    this.open.scale.set(sur ? 0.72 : (this.vocalType === 'whistle' ? 0.5 : 1), Math.max(0.12, this.mOpenV), 1);
    this.smile.scale.set(1, this.angry ? -0.68 : 0.22 + 0.95 * this.smileV, 1);
  }
  update(dt, now, beatPos) {
    const k = 1 - Math.exp(-dt * 6);
    if (!this.alwaysStand) {
      this.standT += clamp(this.standTarget - this.standT, -dt * 3.4, dt * 3.4);
      const e = easeIO(clamp(this.standT, 0, 1));
      this.pelvis.position.y = lerp(this.seatY + 0.04, 0.95, e);
      if (this.legsSit) this.legsSit.visible = this.standT < 0.5;
      this.legsStand.visible = this.standT >= 0.5;
    }
    // 시선
    let yawT = 0, pitchT = 0;
    if (this.lookAt) {
      const lp = this.root.worldToLocal(this.lookAt.clone());
      const hy = this.pelvis.position.y + 0.76;
      yawT = clamp(Math.atan2(lp.x, lp.z), -1.15, 1.15);
      pitchT = clamp(-Math.atan2(lp.y - hy, Math.hypot(lp.x, lp.z)), -0.45, 0.55);
    }
    if (this.idle === 'phone' && !this.clapping) pitchT = 0.42;
    this.yaw += (yawT - this.yaw) * k; this.pitch += (pitchT - this.pitch) * k;
    this.nodAmp += (this.nodTarget - this.nodAmp) * Math.min(1, dt * 2.5);
    const bp = this.half ? beatPos / 2 : beatPos, ph = bp - Math.floor(bp), s = (Math.cos(2 * Math.PI * ph) + 1) / 2;
    const nod = this.nodAmp * this.groove * s * s * s;
    const angryShake = this.angry ? Math.sin(now * 7.8 + this.phase) * 0.22 : 0;
    this.head.rotation.set(this.pitch + nod * 0.3, this.yaw + angryShake, Math.sin(beatPos * Math.PI + this.phase) * 0.05 * this.nodAmp + (this.angry ? Math.sin(now * 7.8 + this.phase) * 0.045 : 0));
    this.lean += (this.leanTarget - this.lean) * k * 0.6;
    this.torso.rotation.set(this.lean + nod * 0.06, 0, Math.sin(beatPos * Math.PI * 0.5 + this.phase) * 0.04 * this.nodAmp * this.groove);
    this.updateArms(dt, now);
    this.updateFace(dt, now);
  }
}
function M_() { return G.M; }

// ===================== 관객 배치 =====================
function buildPeople() {
  const seats = G.seats.slice();
  G.people = [];
  seats.forEach((s, i) => {
    const fill = s.kind === 'chair' ? (s.far ? 0.75 : 1) : s.kind === 'stool' ? 0.8 : 0.75;
    if (Math.random() > fill) return;
    G.people.push(new Person({ x: s.x, z: s.z, seatY: s.seatY, kind: s.kind, far: s.far, angry: true }));
  });
  [[-5.35, -9.1], [-5.65, -6.7], [5.4, -9.9]].forEach(([x, z]) => G.people.push(new Person({ x, z, kind: 'stand', far: true, angry: true })));
  G.band.bartender = new Person({ x: 0.9, z: -11.95, kind: 'stand', ry: 0, top: '#ffffff', outfit: 'shirt', far: true, angry: true });
}

// ===================== 밴드 =====================
function buildTrombone() {
  const B = new Batch(), GE = G.GEO, brass = '#e0aa3e';
  // 고정 관: 마우스피스 쪽 안쪽 슬라이드 두 줄
  B.add(GE.cyl, brass, [0, 0, 0.36], [Math.PI / 2, 0, 0], [0.009, 0.66, 0.009]);
  B.add(GE.cyl, brass, [0, -0.095, 0.36], [Math.PI / 2, 0, 0], [0.009, 0.66, 0.009]);
  B.add(GE.cyl, '#c9c9c9', [0, 0, -0.02], [Math.PI / 2, 0, 0], [0.012, 0.06, 0.012]);
  // 벨 섹션
  B.add(GE.cyl, brass, [0.03, 0.1, 0.18], [Math.PI / 2, 0, 0], [0.011, 0.5, 0.011]);
  B.add(GE.cyl, brass, [0.03, 0.1, -0.12], [Math.PI / 2, 0, 0], [0.011, 0.36, 0.011]);
  B.add(new THREE.TorusGeometry(0.05, 0.011, 6, 12, Math.PI), brass, [0.03, 0.05, -0.3], [0, Math.PI / 2, Math.PI / 2], [1, 1, 1]);
  B.add(GE.cyl, brass, [0.03, 0.0, -0.24], [Math.PI / 2, 0, 0], [0.011, 0.12, 0.011]);
  const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(0.012 + Math.pow(t, 3.2) * 0.1, t * 0.34)); }
  B.add(new THREE.LatheGeometry(pts, 20), brass, [0.03, 0.1, 0.42], [Math.PI / 2, 0, 0], [1, 1, 1]);
  B.add(GE.cyl, brass, [0.015, 0.05, 0.2], 0, [0.006, 0.1, 0.006]);
  const fixed = new THREE.Mesh(mergeGeoms(B.items), G.M.metal); B.items = [];
  const S = new Batch();
  S.add(GE.cyl, brass, [0, 0, 0.62], [Math.PI / 2, 0, 0], [0.012, 0.62, 0.012]);
  S.add(GE.cyl, brass, [0, -0.095, 0.62], [Math.PI / 2, 0, 0], [0.012, 0.62, 0.012]);
  S.add(new THREE.TorusGeometry(0.0475, 0.012, 6, 12, Math.PI), brass, [0, -0.0475, 0.93], [0, Math.PI / 2, 0], [1, 1, 1]);
  S.add(GE.cyl, brass, [0, -0.0475, 0.42], 0, [0.007, 0.095, 0.007]);
  const slide = S.mesh(G.M.metal);
  const g = new THREE.Group(); g.add(fixed); g.add(slide);
  return { g, slide };
}
function buildBand() {
  // 트롬본 (밴드리더) — 오른쪽 앞
  const tb = new Person({ x: 0.76, y: 0.42, z: -0.8, kind: 'stand', ry: Math.PI, female: false, top: '#1f9e7a', bottom: '#3a3a3a', outfit: 'jacket', hat: 'pork', glasses: false, hair: 'short', skin: '#b07246', angry: true });
  tb.isBand = true;
  const tr = buildTrombone(); tb.torso.add(tr.g); tb.trombone = tr; tb.playT = 0; tb.slideExt = 0; tb.turnT = 0;
  G.band.tb = tb;
  // 피아노 — 왼쪽, 건반 쪽을 보고 앉음 (옆모습)
  const pn = new Person({ x: -0.4, y: 0.42, z: -0.72, kind: 'chair', seatY: 0.475, ry: -Math.PI / 2, female: true, top: '#e2403a', outfit: 'blouse', hair: 'bun', glasses: true, angry: true });
  pn.isBand = true; pn.armOverride = { R: POSE.keys, L: POSE.keys }; pn.hit = -9;
  G.band.pn = pn;
  placeBand();
}

// ===================== 대사 =====================
const ANGRY_LINES = ['뭐 하는 거야!', '그만 좀 해!', '시끄러워!', '정말 못 들어주겠네!', '관객을 보고 연주해!', '이게 연주야?', '이거 무슨 곡이야?', '나가!', '넌 별로야!'];

const REACT = {};
REACT.update = function() {
  const you = G.camera.position;
  for (const p of aud()) {
    p.lookAt = G.camBase ? G.camBase.pos : you;
    p.nodTarget = 0;
    p.smileV = 0;
    p.leanTarget = 0;
  }
  const tb = G.band.tb, pn = G.band.pn, bt = G.band.bartender;
  tb.lookAt = you; tb.nodTarget = 0; tb.smileV = 0;
  pn.lookAt = you; pn.nodTarget = 0; pn.smileV = 0;
  bt.lookAt = you; bt.nodTarget = 0;
};

const aud = () => G.people;

// ---------- 반응 ----------
function setBabble(v) { if (AE.ready) AE.babbleGain.gain.setTargetAtTime(v, AE.ctx.currentTime, 0.7); }

// ===================== 화면 연결 (UI) =====================
const UI = { bubbles: [], el: {} };
UI.init = function () {
  const $ = id => document.getElementById(id);
  Object.assign(this.el, { bubbles: $('bubbles'), setlist: $('setlist'), glow: $('glow') });
};
UI.bubble = function (p, text, big, delay = 0) {
  const el = document.createElement('div'); el.className = 'bub' + (big ? ' big' : ''); el.textContent = text; el.style.opacity = 0;
  this.el.bubbles.appendChild(el);
  this.bubbles.push({ el, p, t0: performance.now() / 1000 + Math.max(0, delay), dur: big ? 2.6 : 1.8 });
  if (this.bubbles.length > 10) { const o = this.bubbles.shift(); o.el.remove(); }
};
const _bv = V3();
UI.updateBubbles = function () {
  const t = performance.now() / 1000, W = G.W, H = G.H;
  this.bubbles = this.bubbles.filter(b => {
    if (t < b.t0) return true;
    const age = t - b.t0; if (age > b.dur) { b.el.remove(); return false; }
    b.p.headWorld(_bv).project(G.camera);
    if (_bv.z > 1 || Math.abs(_bv.x) > 1.3) { b.el.style.opacity = 0; return true; }
    const bw = b.el.offsetWidth || 80;
    const y = clamp((-_bv.y * 0.5 + 0.5) * H, 84, H - 60);
    const x = clamp((_bv.x * 0.5 + 0.5) * W, bw / 2 + 8, W - bw / 2 - 8);
    const s = age < 0.14 ? 0.55 + age / 0.14 * 0.45 : 1, op = age > b.dur - 0.3 ? (b.dur - age) / 0.3 : 1;
    b.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%) scale(${s})`; b.el.style.opacity = op;
    return true;
  });
};
UI.setlist = function (seg) {
  const map = { intro: 'head', head: 'head', tb: 'tb', pn: 'pn', me: 'me', out: 'out', tag: 'out', end: 'out' };
  const order = ['head', 'tb', 'pn', 'me', 'out'];
  const cur = seg === 'done' ? 'zz' : map[seg], ci = order.indexOf(cur);
  this.el.setlist.querySelectorAll('span').forEach(s => { const i = order.indexOf(s.dataset.s); s.classList.toggle('now', i === ci); s.classList.toggle('done', seg === 'done' || (ci >= 0 && i < ci)); });
};

// ===================== 루프 =====================
let lastFrame = performance.now();
function loop() {
  requestAnimationFrame(loop);
  frame();
}
function frame() {
  const tn = performance.now(), dt = Math.min(0.05, (tn - lastFrame) / 1000); lastFrame = tn;
  const now = visNow();
  const beatPos = tn / 1000 * 1.7;
  REACT.update();
  for (const p of G.people) p.update(dt, now, beatPos);
  if (G.camBase) {
    const { pos, look } = G.camBase;
    const r = () => Math.random() * 2 - 1; // -1..1
    G.camera.position.set(pos.x + r() * 0.035, pos.y + r() * 0.025, pos.z);
    G.camera.lookAt(look.x + r() * 0.025, look.y + r() * 0.018, look.z);
    G.camera.rotation.z += r() * 0.002;
  }
  for (const k of ['tb', 'pn', 'bartender']) {
    const b = G.band[k]; b.update(dt, now, beatPos);
    if (b.shakeUntil > now) b.head.rotation.y += 0.22 * Math.sin(now * 17);
  }
  UI.updateBubbles();
  G.renderer.render(G.scene, G.camera);
}
function bindAudioUnlock() {
  document.addEventListener('pointerdown', () => {
    if (AE.ctx && AE.ctx.state !== 'running') AE.ctx.resume();
  }, { once: true });
}
async function boot() {
  try { await Promise.race([Promise.all([document.fonts.load('40px "Black Han Sans"'), document.fonts.load('20px "Gowun Dodum"')]), new Promise(r => setTimeout(r, 2500))]); } catch (e) { }
  try {
    UI.init(); initScene(); buildPeople(); buildBand();
    bindAudioUnlock();
    requestAnimationFrame(loop);
    await initAudio();
    setBabble(0.5);
    startTrumpet();
    setInterval(() => { const p = pick(aud()); if (p) UI.bubble(p, pick(ANGRY_LINES)); }, 1450);
    document.addEventListener('visibilitychange', () => { if (!AE.ctx) return; if (document.hidden) AE.ctx.suspend(); else AE.ctx.resume(); });
  } catch (e) { console.error(e?.stack || e); }
}
boot();
