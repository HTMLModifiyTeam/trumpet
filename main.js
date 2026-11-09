import * as THREE from "three" // Main 3D Library
import { rand, randi, pick, clamp, V3, C } from "./classes/utils.js"
import { UI_ } from "./classes/UI.js"
import { POSE, G, ANGRY_LINES, TRUMPET_LINES, POSE_NAMES } from "./classes/data.js"
import { Person } from "./classes/Person.js"
import { Batch, mtx, shadeHex, mergeGeoms } from "./classes/Materials.js"

// ===================== 오디오 엔진 =====================
const AE = { ctx: null, ready: false, synth: {} };
const UI = new UI_();

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
      y += a * (d[i] - y);
      d[i] = y;
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
    const osc = oc.createOscillator();
    osc.type = 'sawtooth';
    const female = v % 2 === 1, base = female ? rand(185, 235) : rand(100, 135), fs = female ? 1.12 : 1;
    const f1 = oc.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 5;
    const f2 = oc.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 8;
    const g = oc.createGain();
    g.gain.value = 0;
    const mix = oc.createGain();
    const pan = oc.createStereoPanner ? oc.createStereoPanner() : null;
    osc.connect(f1);
    osc.connect(f2);
    f1.connect(mix);
    f2.connect(mix);
    mix.connect(g);
    if (pan) {
      pan.pan.value = rand(-0.85, 0.85);
      g.connect(pan);
      pan.connect(oc.destination);
    } else g.connect(oc.destination);
    let t = rand(0, 0.6);
    while (t < dur - 0.3) {
      if (Math.random() < 0.22) {
        t += rand(0.25, 0.9);
        continue;
      }
      const sd = rand(0.08, 0.22),
        vw = pick(V);
      f1.frequency.setValueAtTime(vw[0] * fs, t);
      f2.frequency.setValueAtTime(vw[1] * fs, t);
      osc.frequency.setValueAtTime(base * rand(0.88, 1.22), t);
      osc.frequency.linearRampToValueAtTime(base * rand(0.85, 1.1), t + sd);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.18, 0.4), t + 0.02);
      g.gain.linearRampToValueAtTime(0, t + sd);
      t += sd + rand(0.01, 0.05);
    }
    osc.start(0);
    osc.stop(dur);
  }
  const buf = await new Promise(res => {
    const p = oc.startRendering();
    if (p && p.then) p.then(res);
    else oc.oncomplete = e => res(e.renderedBuffer);
  });
  // 루프 이음새 크로스페이드
  const xf = Math.floor(0.6 * sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c),
      N = d.length;
    for (let i = 0; i < xf; i++) {
      const a = i / xf;
      d[i] = d[i] * a + d[N - xf + i] * (1 - a);
    }
  }
  return buf;
}
async function initAudio(ctxOverride) {
  if (AE.ctx && !ctxOverride) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = ctxOverride || new AC({ latencyHint: 'interactive' });
  AE.ctx = ctx;
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch { }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 3.2;
  comp.attack.value = 0.006;
  comp.release.value = 0.24;
  const master = ctx.createGain();
  master.gain.value = 0.85;
  // 마지막에 한 번 더 눌러서 소리가 깨지지 않게 (리미터)
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3;
  lim.knee.value = 0;
  lim.ratio.value = 20;
  lim.attack.value = 0.002;
  lim.release.value = 0.12;
  master.connect(comp);
  comp.connect(lim);
  lim.connect(ctx.destination);
  const rev = ctx.createConvolver();
  rev.buffer = makeIR(ctx, 1.7, 2.4);
  const revOut = ctx.createGain();
  revOut.gain.value = 0.85;
  rev.connect(revOut);
  revOut.connect(master);
  const bus = (gain, send) => {
    const g = ctx.createGain();
    g.gain.value = gain;
    g.connect(master);
    const s = ctx.createGain();
    s.gain.value = send;
    g.connect(s);
    s.connect(rev);
    return g;
  };
  AE.master = master;
  // 웅성거림 버스 (멀리서 들리게 저역통과)
  const babLP = ctx.createBiquadFilter();
  babLP.type = 'lowpass';
  babLP.frequency.value = 2200;
  const babG = ctx.createGain();
  babG.gain.value = 0;
  babLP.connect(babG);
  babG.connect(bus(0.95, 0.32));
  AE.babbleGain = babG;
  AE.babbleIn = babLP;
  AE.trumpetBus = bus(0.3, 0.28); // 시끄러운 트럼펫 버스 (리버브 조금)
  // 합성 소리 미리 굽기
  const SY = AE.synth;
  try {
    SY.babble = await renderBabble(ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = SY.babble;
    src.loop = true;
    src.connect(AE.babbleIn);
    src.start();
  } catch (e) { console.warn('babble', e); }
  AE.ready = true;
}
// ===================== 시끄러운 트럼펫 (오실레이터) =====================
const TRUMPET = { on: true, timer: 0, busy: false };
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

function makeDistCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) * 2 - 1;
    c[i] = Math.tanh(x * k) / Math.tanh(k);
  }
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
  const mix = ctx.createGain();
  mix.gain.value = 0.22;
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = o.vibRate ?? rand(5, 8.5);
  const lfoG = ctx.createGain();
  lfoG.gain.setValueAtTime(0, t0);
  lfoG.gain.linearRampToValueAtTime(vibDepth, t0 + Math.min(0.35, dur * 0.6));
  lfo.connect(lfoG);
  const oscs = [];
  // 살짝씩 어긋난 톱니파/사각파를 겹쳐서 지저분하고 뾰족하게
  [['sawtooth', 1, 0, 1], ['sawtooth', 1, 17, 0.8], ['square', 1, -13, 0.5], ['sawtooth', 2, 7, 0.45], ['sawtooth', 0.5, -5, 0.4]].forEach(([type, mult, cents, amp]) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.detune.value = cents;
    const f = freq * mult;
    osc.frequency.setValueAtTime(f * scoop, t0);
    osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.07);
    osc.frequency.setValueAtTime(f, Math.max(t0 + 0.08, t1 - 0.18));
    osc.frequency.exponentialRampToValueAtTime(f * fall, t1 + 0.04);
    lfoG.connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.value = amp;
    osc.connect(g);
    g.connect(mix);
    osc.start(t0);
    osc.stop(t1 + 0.15);
    oscs.push(osc);
  });
  lfo.start(t0);
  lfo.stop(t1 + 0.15);
  // 브라스 특유의 "뿌우~" 필터 열림 + 벨 공명 + 날카로운 대역
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 3.5;
  const hi = Math.min(freq * 9, 9000);
  lp.frequency.setValueAtTime(Math.min(freq * 2, 3000), t0);
  lp.frequency.exponentialRampToValueAtTime(hi, t0 + 0.09);
  lp.frequency.exponentialRampToValueAtTime(Math.min(freq * 5, 6000), t1);
  const pk1 = ctx.createBiquadFilter();
  pk1.type = 'peaking';
  pk1.frequency.value = 1250;
  pk1.Q.value = 1.6;
  pk1.gain.value = 9;
  const pk2 = ctx.createBiquadFilter();
  pk2.type = 'peaking';
  pk2.frequency.value = 3100;
  pk2.Q.value = 2.2;
  pk2.gain.value = 7;
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDistCurve(o.drive ?? 7);
  shaper.oversample = '4x';
  mix.connect(lp);
  lp.connect(pk1);
  pk1.connect(pk2);
  pk2.connect(shaper);
  // 전체 볼륨 (+ 선택: 방귀 같은 떨림)
  const trem = ctx.createGain();
  trem.gain.value = 1;
  let tremLfo = null;
  if (o.trem) {
    trem.gain.value = 0.55;
    tremLfo = ctx.createOscillator();
    tremLfo.type = 'square';
    tremLfo.frequency.value = o.trem;
    const tg = ctx.createGain();
    tg.gain.value = 0.45;
    tremLfo.connect(tg);
    tg.connect(trem.gain);
    tremLfo.start(t0);
    tremLfo.stop(t1 + 0.15);
  }
  const env = ctx.createGain();
  const peak = 0.55 * vel, sus = 0.38 * vel;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + 0.03);
  env.gain.linearRampToValueAtTime(sus, t0 + 0.16);
  env.gain.setValueAtTime(sus, Math.max(t0 + 0.17, t1 - 0.05));
  env.gain.linearRampToValueAtTime(0.0001, t1 + 0.06);
  shaper.connect(trem);
  trem.connect(env);
  // 숨소리 / 침 튀는 "퍽" 소리
  const nz = ctx.createBufferSource();
  nz.buffer = getNoise(ctx);
  nz.loop = true;
  const nbp = ctx.createBiquadFilter();
  nbp.type = 'bandpass';
  nbp.frequency.value = Math.min(freq * 3, 5000);
  nbp.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t0);
  ng.gain.linearRampToValueAtTime((o.spit ?? 0.5) * vel, t0 + 0.012);
  ng.gain.exponentialRampToValueAtTime(0.06 * vel, t0 + 0.14);
  ng.gain.setValueAtTime(0.06 * vel, Math.max(t0 + 0.15, t1 - 0.05));
  ng.gain.linearRampToValueAtTime(0, t1 + 0.04);
  nz.connect(nbp);
  nbp.connect(ng);
  ng.connect(env);
  nz.start(t0, Math.random());
  nz.stop(t1 + 0.15);
  env.connect(AE.trumpetBus);
  oscs[0].onended = () => {
    try {
      env.disconnect();
    } catch (e) { }
  };
}
// 말도 안 되는 즉흥 연주 한 토막
function trumpetPhrase() {
  const kind = pick(['honk', 'honk', 'run', 'run', 'squeal', 'long', 'fart', 'stab']);
  const noteHz = () => midiHz(58 + randi(0, 26)) * Math.pow(2, rand(-0.4, 0.4) / 12); // 일부러 음정 어긋나게
  let total = 0;
  const at = (delay, f, d, o) => {
    setTimeout(() => trumpetBlast(f, d, o), delay * 1000);
    total = Math.max(total, delay + d);
  };
  if (kind === 'honk') {
    const d = rand(0.25, 0.7);
    at(0, noteHz(), d);
  } else if (kind === 'long') {
    const d = rand(1.3, 2.4);
    at(0, midiHz(randi(60, 74)), d, { vel: 1, vib: 0.045, vibRate: rand(4, 6), scoop: 0.8, fall: 0.75 });
  } else if (kind === 'squeal') {
    const d = rand(0.4, 1.0);
    at(0, rand(1300, 2300), d, { vel: 0.85, scoop: 0.6, fall: 1.15, vib: 0.05, vibRate: 9, drive: 10, spit: 0.8 });
  } else if (kind === 'fart') {
    const d = rand(0.5, 1.1);
    at(0, rand(70, 130), d, { vel: 1.2, trem: rand(18, 30), vib: 0.06, scoop: 1.2, fall: 0.6, drive: 9 });
  } else if (kind === 'stab') {
    for (let i = 0; i < 3; i++) at(i * 0.16, noteHz() * (i === 2 ? 2 : 1), i === 2 ? 0.55 : 0.1, { vel: 1.1 });
  } else { // run: 급하게 막 올라갔다 내려갔다
    const n = randi(6, 12);
    let m = 58 + randi(0, 14), t = 0;
    for (let i = 0; i < n; i++) {
      m = clamp(m + randi(-5, 6), 52, 88);
      const d = rand(0.07, 0.14);
      at(t, midiHz(m) * Math.pow(2, rand(-0.3, 0.3) / 12), d, { vel: 0.9, scoop: rand(0.92, 1), vib: 0.004, drive: 8 });
      t += d + rand(0.01, 0.05);
    }
  }
  // 관객 반응: 웅성거림이 커지고 누군가 화를 냄
  setBabble(0.95);
  setTimeout(() => setBabble(0.5), total * 1000 + 400);
  if (typeof UI !== 'undefined' && G.people && G.people.length) {
    const p = pick(G.people);
    if (p) UI.bubble(p, pick(TRUMPET_LINES), Math.random() < 0.35, 0.15);
  }
  return total;
}

function startTrumpet() {
  if (TRUMPET.busy) return;
  TRUMPET.busy = true;
  const next = () => {
    let d = 0;
    if (TRUMPET.on && AE.ready && AE.ctx && AE.ctx.state === 'running' && !document.hidden) d = trumpetPhrase();
    TRUMPET.timer = setTimeout(next, d * 1000 + rand(250, 1400));
  };
  TRUMPET.timer = setTimeout(next, 1200);
}
// ===================== 3D 장면 =====================
function canvasTex(w, h, draw, o = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (o.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(o.repeat[0], o.repeat[1]);
  }
  return t;
}
const FONT_D = '"Black Han Sans","Noto Sans CJK KR","Noto Sans KR",sans-serif';

function woodTex(base, rows, repeat, seams = true) {
  return canvasTex(512, 512, (g, w, h) => {
    const ph = h / rows;
    for (let i = 0; i < rows; i++) {
      g.fillStyle = shadeHex(base, rand(-0.1, 0.08));
      g.fillRect(0, i * ph, w, ph);
      for (let k = 0; k < 34; k++) {
        g.strokeStyle = `rgba(70,35,12,${rand(0.03, 0.1)})`;
        g.lineWidth = rand(0.6, 2.2);
        g.beginPath();
        const y = i * ph + rand(2, ph - 2);
        g.moveTo(0, y);
        for (let x = 0; x <= w; x += 24) g.lineTo(x, y + Math.sin(x * 0.015 + k) * rand(0.4, 2.2));
        g.stroke();
      }
      if (seams) {
        g.fillStyle = 'rgba(45,22,8,0.55)';
        g.fillRect(0, i * ph, w, 2);
        g.fillRect(rand(40, w - 40), i * ph, 2, ph);
      }
    }
  }, { repeat });
}

function tileTex() {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#efe7d6';
    g.fillRect(0, 0, w, h);
    const tw = 64,th = 32;
    for (let r = 0; r < h / th; r++) {
      const off = (r % 2) * tw / 2;
      for (let c = -1; c < w / tw + 1; c++) {
        const x = c * tw + off, y = r * th;
        g.fillStyle = shadeHex('#1b8a68', rand(-0.12, 0.1));
        g.fillRect(x + 2, y + 2, tw - 4, th - 4);
        g.fillStyle = 'rgba(255,255,255,0.22)';
        g.fillRect(x + 5, y + 5, tw - 10, 4);
      }
    }
  }, { repeat: [7, 1] });
}

function skyTex() {
  return canvasTex(256, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#5fb6f2');
    gr.addColorStop(0.55, '#a9dcfb');
    gr.addColorStop(1, '#eaf7ff');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      const cx = rand(0, w), cy = rand(40, h * 0.5);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        g.arc(cx + rand(-40, 40), cy + rand(-10, 10), rand(14, 30), 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = '#4f9b52';
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.arc(rand(0, w), h - rand(10, 70), rand(30, 60), 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#3f7f45';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc(rand(0, w), h - rand(0, 30), rand(25, 45), 0, Math.PI * 2);
      g.fill();
    }
  });
}

function signTex() {
  return canvasTex(300, 256, (g, w, h) => {
    g.fillStyle = '#123f33';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e8b54a';
    g.lineWidth = 10;
    g.strokeRect(12, 12, w - 24, h - 24);
    const text = '임대';
    const pad = h * 0.18;
    const maxW = w - pad * 2;
    let size = h - pad * 2;
    g.font = `${size}px ${FONT_D}`;
    const measured = g.measureText(text).width;
    if (measured > maxW) size = size * (maxW / measured);
    g.font = `${size}px ${FONT_D}`;
    g.fillStyle = '#ffe9a8';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + size * 0.04);
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
  for (let k = 0; k < 3; k++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.2), wm);
    p.position.set(-8, 2.2, -5 + k * 4);
    p.rotation.y = Math.PI / 2;
    es.add(p);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(es, 0.03);
  pm.dispose();
  return rt.texture;
}
const PR = Math.min(window.devicePixelRatio || 1, 2);
function initScene() {
  THREE.ColorManagement.enabled = false;
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setPixelRatio(PR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = C('#f4e2c4');
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 60);
  Object.assign(G, { renderer, scene, camera });
  G.env = makeEnv(renderer);
  const M = G.M;
  M.vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
  M.gloss = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32,envMap: G.env, envMapIntensity: 0.35 });
  M.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.85, envMap: G.env, envMapIntensity: 1.1 });
  M.glass = new THREE.MeshStandardMaterial({ color: C('#d6efff'), roughness: 0.05, transparent: true, opacity: 0.32, envMap: G.env, envMapIntensity: 1.2, depthWrite: false });
  M.person = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68 });
  M.personGloss = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, envMap: G.env, envMapIntensity: 0.5 });
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
  window.addEventListener('resize', onResize);
  onResize();
}

function onResize() {
  G.W = window.innerWidth;
  G.H = window.innerHeight;
  G.renderer.setSize(G.W, G.H, false);
  frameCamera();
}

function frameCamera() {
  const a = G.W / G.H, cam = G.camera;
  let fov, pos, look;
  // 동료는 어느 화면에서든 가장자리에 걸쳐 보이게: 화면 비율마다 카메라와 밴드 자리를 같이 정함
  let band;
  if (a < 0.72) {
    fov = 74;
    pos = V3(0.05, 2.12, 1.75);
    look = V3(-0.05, 0.62, -6.4);
    band = { tb: [0.76, -0.8], pn: [-0.4, -0.72] };
  } else if (a < 1.25) {
    fov = 64;
    pos = V3(0, 2.12, 1.7);
    look = V3(0, 0.6, -6.4);
    band = { tb: [1.05, -0.85], pn: [-0.93, -0.7] };
  } else {
    fov = 52;
    pos = V3(0, 2.15, 1.6);
    look = V3(0, 0.45, -6.4);
    band = { tb: [1.48, -0.9], pn: [-1.3, -0.62] };
  }
  cam.fov = fov;
  cam.aspect = a;
  cam.position.copy(pos);
  cam.lookAt(look);
  cam.updateProjectionMatrix();
  G.camBase = { pos: pos.clone(), look: look.clone() };
  G.bandLayout = band;
  placeBand();
}

function placeBand() {
  const L = G.bandLayout;
  if (!L) return;
  if (G.props.piano) G.props.piano.position.set(L.pn[0] + 0.4, 0, L.pn[1] + 0.72);
  const tb = G.band.tb, pn = G.band.pn;
  if (tb) tb.root.position.set(L.tb[0], 0.42, L.tb[1]);
  if (pn) pn.root.position.set(L.pn[0], 0.42, L.pn[1]);
}

function buildRoom() {
  const { scene, M, GEO } = G;
  // 바닥
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(13, 16.4), new THREE.MeshStandardMaterial({ map: woodTex('#c98a4b', 8, [4, 5]), roughness: 0.5, envMap: G.env, envMapIntensity: 0.25 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -4.3);
  floor.receiveShadow = true;
  scene.add(floor);
  // 무대
  const stage = new THREE.Mesh(GEO.box, new THREE.MeshStandardMaterial({ color: C('#6d2f22'), roughness: 0.6 }));
  stage.scale.set(8.8, 0.42, 4.9);
  stage.position.set(0, 0.21, 1.4);
  stage.receiveShadow = true;
  scene.add(stage);
  const stTop = new THREE.Mesh(new THREE.PlaneGeometry(8.8, 4.9), new THREE.MeshStandardMaterial({ map: woodTex('#8a5532', 10, [3, 2]), roughness: 0.45, envMap: G.env, envMapIntensity: 0.3 }));
  stTop.rotation.x = -Math.PI / 2;
  stTop.position.set(0, 0.422, 1.4);
  stTop.receiveShadow = true;
  scene.add(stTop);
  // 벽
  const plaster = new THREE.MeshStandardMaterial({ color: C('#f3e3c8'), roughness: 0.9 });
  const wallL = new THREE.Mesh(new THREE.PlaneGeometry(16.4, 4.4), plaster);
  wallL.rotation.y = Math.PI / 2;
  wallL.position.set(-6.5, 2.2, -4.3);
  wallL.receiveShadow = true;
  scene.add(wallL);
  const wallR = new THREE.Mesh(new THREE.PlaneGeometry(16.4, 4.4), plaster);
  wallR.rotation.y = -Math.PI / 2;
  wallR.position.set(6.5, 2.2, -4.3);
  wallR.receiveShadow = true;
  scene.add(wallR);
  const wallB = new THREE.Mesh(new THREE.PlaneGeometry(13, 4.4), plaster);
  wallB.position.set(0, 2.2, -12.5);
  scene.add(wallB);
  const wallS = new THREE.Mesh(new THREE.PlaneGeometry(13, 4.4), new THREE.MeshStandardMaterial({ color: C('#7a1f2b'), roughness: 0.95 }));
  wallS.rotation.y = Math.PI;
  wallS.position.set(0, 2.2, 3.85);
  scene.add(wallS);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(13, 16.4), new THREE.MeshStandardMaterial({ color: C('#f6ead6'), roughness: 0.95 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, 4.4, -4.3);
  scene.add(ceil);
  const tileMat = new THREE.MeshStandardMaterial({ map: tileTex(), roughness: 0.35, envMap: G.env, envMapIntensity: 0.3 });
  const tL = new THREE.Mesh(new THREE.PlaneGeometry(16.4, 1.12), tileMat);
  tL.rotation.y = Math.PI / 2;
  tL.position.set(-6.49, 0.56, -4.3);
  tL.receiveShadow = true;
  scene.add(tL);
  const tR = new THREE.Mesh(new THREE.PlaneGeometry(16.4, 1.12), tileMat);
  tR.rotation.y = -Math.PI / 2;
  tR.position.set(6.49, 0.56, -4.3);
  tR.receiveShadow = true;
  scene.add(tR);
  const W = new Batch(), Gl = new Batch(), Mt = new Batch(), Glow = new Batch(), Gs = new Batch();
  // 벽 몰딩
  Gl.add(GEO.box, '#6b3a1e', [-6.44, 1.14, -4.3], 0, [0.06, 0.05, 16.4]);
  Gl.add(GEO.box, '#6b3a1e', [6.44, 1.14, -4.3], 0, [0.06, 0.05, 16.4]);
  // 천장 보
  for (let z = -11.6; z <= 3.2; z += 2.4) W.add(GEO.box, '#7b4a2a', [0, 4.31, z], 0, [13, 0.18, 0.2]);
  // 왼쪽 창문 (햇빛)
  const sky = new THREE.MeshBasicMaterial({ map: skyTex() });
  [-10.2, -6.4, -2.6].forEach(z => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.5), sky);
    s.rotation.y = Math.PI / 2;
    s.position.set(-6.47, 2.42, z);
    scene.add(s);
    const fr = '#fbfaf5';
    W.add(GEO.box, fr, [-6.43, 2.42, z - 0.88], 0, [0.09, 2.62, 0.08]);
    W.add(GEO.box, fr, [-6.43, 2.42, z + 0.88], 0, [0.09, 2.62, 0.08]);
    W.add(GEO.box, fr, [-6.43, 3.71, z], 0, [0.09, 0.08, 1.84]);
    W.add(GEO.box, fr, [-6.43, 2.42, z], 0, [0.07, 2.5, 0.05]);
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
    sh.position.set(-4.2, 1.7, z + 0.3);
    sh.rotation.set(0, Math.PI / 2, -0.95);
    scene.add(sh);
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
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.9), new THREE.MeshStandardMaterial({ map: signTex(), roughness: 0.5, emissive: C('#1a1a10'), emissiveIntensity: 0.2 }));
  sign.position.set(0, 3.68, -12.38);
  scene.add(sign);
  G.props.sign = sign;
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
      if (kind < 0.4) {
        Gs.add(GEO.cyl, '#e8a22a', [gx, 0.84, gz], 0, [0.035, 0.15, 0.035]);
        Gs.add(GEO.cyl, '#fff6dd', [gx, 0.925, gz], 0, [0.036, 0.025, 0.036]);
      } else if (kind < 0.75) {
        Gs.add(GEO.coneC, pick(['#e8475f', '#f2b72b', '#58c1e0', '#9be36b']), [gx, 0.87, gz], [Math.PI, 0, 0], [0.055, 0.06, 0.055]);
        Gs.add(GEO.cyl, '#e6f4ff', [gx, 0.8, gz], 0, [0.006, 0.07, 0.006]);
        Gs.add(GEO.cyl, '#e6f4ff', [gx, 0.765, gz], 0, [0.03, 0.006, 0.03]);
      } else Gs.add(GEO.cyl, '#7a3b12', [gx, 0.81, gz], 0, [0.04, 0.09, 0.04]);
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
  for (let k = 0; k < 22; k++) {
    if ([2, 6, 9, 13, 16, 20].includes(k)) continue;
    PW.add(GEO.box, '#141414', [-0.93, 0.42 + 0.762, -1.36 + k * 0.061], 0, [0.09, 0.02, 0.028]);
  }
  PB.add(GEO.box, '#2a1712', [-1.28, 0.42 + 1.32, -0.72], 0, [0.66, 0.05, 1.56]);
  PB.add(GEO.box, '#2a1712', [-0.38, 0.42 + 0.45, -0.72], 0, [0.36, 0.05, 0.8]);
  [[-0.53, -1.05], [-0.23, -1.05], [-0.53, -0.39], [-0.23, -0.39]].forEach(([x, z]) => PB.add(GEO.cyl, '#2a1712', [x, 0.42 + 0.22, z], 0, [0.025, 0.44, 0.025]));
  G.props.piano = new THREE.Group();
  scene.add(G.props.piano);
  {
    const a = PB.mesh(M.gloss), b = PW.mesh(M.vc);
    a.castShadow = true;
    G.props.piano.add(a);
    G.props.piano.add(b);
  }
  const add = (b, mat, cast) => {
    if (!b.size) return;
    const m = b.mesh(mat);
    m.castShadow = !!cast;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  add(W, M.vc, false);
  add(Gl, M.gloss, true);
  add(Mt, M.metal, true);
  add(Gs, M.gloss, false);
  const gm = add(Glow, M.glow, false);
  if (gm) gm.receiveShadow = false;
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
  s.add(new THREE.HemisphereLight(C('#e3f2ff'), C('#e0a86e'), 0.72 * Math.PI));
  s.add(new THREE.AmbientLight(C('#ffffff'), 0.12));
  const sun = new THREE.DirectionalLight(C('#FFF0D6'), 1.65 * Math.PI);
  sun.position.set(-11, 9, -4.5);
  sun.target.position.set(1.5, 0, -5.5);
  s.add(sun.target);
  sun.castShadow = true;
  const big = PR > 1.5 ? 1536 : 2048;
  sun.shadow.mapSize.set(big, big);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 9, bottom: -9, near: 1, far: 32 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.025;
  s.add(sun);
}
// ===================== 관객 배치 =====================
function buildPeople() {
  const seats = G.seats.slice();
  G.people = [];
  seats.forEach((s, _) => {
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
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector2(0.012 + Math.pow(t, 3.2) * 0.1, t * 0.34));
  }
  B.add(new THREE.LatheGeometry(pts, 20), brass, [0.03, 0.1, 0.42], [Math.PI / 2, 0, 0], [1, 1, 1]);
  B.add(GE.cyl, brass, [0.015, 0.05, 0.2], 0, [0.006, 0.1, 0.006]);
  const fixed = new THREE.Mesh(mergeGeoms(B.items), G.M.metal);
  B.items = [];
  const S = new Batch();
  S.add(GE.cyl, brass, [0, 0, 0.62], [Math.PI / 2, 0, 0], [0.012, 0.62, 0.012]);
  S.add(GE.cyl, brass, [0, -0.095, 0.62], [Math.PI / 2, 0, 0], [0.012, 0.62, 0.012]);
  S.add(new THREE.TorusGeometry(0.0475, 0.012, 6, 12, Math.PI), brass, [0, -0.0475, 0.93], [0, Math.PI / 2, 0], [1, 1, 1]);
  S.add(GE.cyl, brass, [0, -0.0475, 0.42], 0, [0.007, 0.095, 0.007]);
  const slide = S.mesh(G.M.metal);
  const g = new THREE.Group();
  g.add(fixed);
  g.add(slide);
  return { g, slide };
}

function buildBand() {
  // 트롬본 (밴드리더) — 오른쪽 앞
  const tb = new Person({ x: 0.76, y: 0.42, z: -0.8, kind: 'stand', ry: Math.PI, female: false, top: '#1f9e7a', bottom: '#3a3a3a', outfit: 'jacket', hat: 'pork', glasses: false, hair: 'short', skin: '#b07246', angry: true });
  tb.isBand = true;
  const tr = buildTrombone();
  tb.torso.add(tr.g);
  tb.trombone = tr;
  tb.root.rotation.y = 0;
  tb.trombone.g.position.set(.27, .2, .06);
  tb.trombone.g.rotation.set(-1.45, 0, 0.12);
  tb.armOverride = { L: [-.3, -.05, -.5], R: [-.2, .05, -.3] };
  G.band.tb = tb;
  // 피아노 — 왼쪽, 건반 쪽을 보고 앉음 (옆모습)
  const pn = new Person({ x: -0.4, y: 0.42, z: -0.72, kind: 'chair', seatY: 0.475, ry: -Math.PI / 2, female: true, top: '#e2403a', outfit: 'blouse', hair: 'bun', glasses: true, angry: true });
  pn.isBand = true;
  pn.armOverride = { R: POSE.keys, L: POSE.keys };
  pn.hit = -9;
  G.band.pn = pn;
  placeBand();
}
// ===================== 대사 =====================
function reactUpdate() {
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
}
const aud = () => G.people;
const visNow = () => AE.ctx && AE.ctx.state === 'running' ? AE.ctx.currentTime - (AE.ctx.outputLatency || 0.02) : performance.now() / 1000;
// ---------- 반응 ----------
function setBabble(v) {
  if (AE.ready) AE.babbleGain.gain.setTargetAtTime(v, AE.ctx.currentTime, 0.7);
}
// ===================== 루프 =====================
let lastFrame = performance.now();

function loop() {
  requestAnimationFrame(loop);
  frame();
}

function frame() {
  const tn = performance.now(), dt = Math.min(0.05, (tn - lastFrame) / 1000);
  lastFrame = tn;
  const now = visNow();
  const beatPos = tn / 1000 * 1.7;
  reactUpdate();
  for (const p of G.people) p.update(dt, now, beatPos);
  if (G.camBase) {
    const { pos, look } = G.camBase;
    const r = () => Math.random() * 2 - 1; // -1..1
    G.camera.position.set(pos.x + r() * 0.035, pos.y + r() * 0.025, pos.z + r() * 0.002);
    G.camera.lookAt(look.x + r() * 0.025, look.y + r() * 0.018, look.z + r() * 0.002);
  }
  for (const k of ['tb', 'pn', 'bartender']) {
    const b = G.band[k];
    b.update(dt, now, beatPos);
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
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('40px "Black Han Sans"'),
        document.fonts.load('20px "Gowun Dodum"')
      ]),
      new Promise(r => setTimeout(r, 2500))
    ]);
  } catch { }
  try {
    UI.init();
    initScene();
    buildPeople();
    buildBand();
    bindAudioUnlock();
    requestAnimationFrame(loop);
    await initAudio();
    setBabble(0.5);
    startTrumpet();
    setInterval(() => {
      const p = pick(aud());
      if (p) UI.bubble(p, pick(ANGRY_LINES));
    }, 1450);
    document.addEventListener('visibilitychange', () => {
      if (!AE.ctx) return;
      if (document.hidden) AE.ctx.suspend();
      else AE.ctx.resume();
    });
  } catch (e) { console.error(e?.stack || e); }
}
boot();