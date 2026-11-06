import * as THREE from 'three';
import { SKIN, HAIRC, TOPS, BOTTOMS, POSE } from "./data.js"
import { G } from "./data.js"
import { pick, V3, C, rand, clamp, lerp, easeIO } from "./utils.js"
import { Batch, shadeHex } from "./Materials.js"

const P = {
  torso: new THREE.CylinderGeometry(0.2, 0.165, 1, 16),
  limb: new THREE.CylinderGeometry(1, 1, 1, 10),
  cap: new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
  shell: new THREE.CylinderGeometry(1, 1, 1, 16, 1, true, Math.PI * 0.32, Math.PI * 1.36),
  smile: new THREE.TorusGeometry(0.036, 0.0085, 6, 14, Math.PI),
  ring: new THREE.TorusGeometry(1, 0.13, 6, 20),
  skirt: new THREE.CylinderGeometry(0.17, 0.28, 1, 16),
};
function M_() { return G.M; }

export class Person {
  constructor(o) {
    const GE = G.GEO; this.o = o; this.angry = !!o.angry;
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
    if (outfit === 'dress') S.add(P.skirt, top, [0, 0.72, 0], 0, [1, 0.42, 0.85]);
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
    if (outfit === 'tee') { T.add(P.ring, shadeHex(top, -0.25), [0, 0.525, 0.005], [Math.PI / 2, 0, 0], [0.068, 0.068, 0.068]); if (Math.random() < 0.6) T.add(GE.sphLo, accent, [0, 0.36, 0.162], 0, [0.07, 0.07, 0.01]); }
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
    H.add(GE.sphLo, skin, [-0.16, -0.005, -0.005], 0, [0.03, 0.045, 0.035]);
    H.add(GE.sphLo, skin, [0.16, -0.005, -0.005], 0, [0.03, 0.045, 0.035]);
    H.add(GE.sphLo, shadeHex(skin, -0.08), [0, -0.012, 0.162], 0, [0.024, 0.03, 0.027]);
    if (female || Math.random() < 0.25) { H.add(GE.sphLo, '#f29a96', [-0.095, -0.04, 0.128], [0, -0.5, 0], [0.032, 0.018, 0.008]); H.add(GE.sphLo, '#f29a96', [0.095, -0.04, 0.128], [0, 0.5, 0], [0.032, 0.018, 0.008]); }
    const style = o.hair || (female ? pick(['bob', 'long', 'bun', 'pony', 'curly', 'short']) : pick(['short', 'short', 'buzz', 'curly', 'bald', 'side']));
    const hc = hairC;
    if (style !== 'bald') H.add(P.cap, hc, [0, 0.012, -0.006], [-0.38, 0, 0], [style === 'buzz' ? 0.168 : 0.174, style === 'buzz' ? 0.18 : 0.19, 0.172]);
    if (style === 'bob') H.add(P.shell, hc, [0, -0.06, -0.005], 0, [0.178, 0.2, 0.172]);
    if (style === 'long') H.add(P.shell, hc, [0, -0.16, -0.01], 0, [0.178, 0.4, 0.17]);
    if (style === 'bun') H.add(GE.sph, hc, [0, 0.15, -0.1], 0, [0.075, 0.07, 0.075]);
    if (style === 'pony') {
      H.add(GE.sph, hc, [0, 0.06, -0.17], 0, [0.045, 0.045, 0.045]);
      H.add(G.GEO.coneC, hc, [0, -0.06, -0.2], [0.35, 0, Math.PI], [0.05, 0.22, 0.05]);
    }
    if (style === 'curly') for (let k = 0; k < 16; k++) { const a = rand(0, Math.PI * 2), e = rand(0.05, 1.2); H.add(GE.sphLo, hc, [Math.sin(a) * 0.15 * Math.cos(e * 0.6), 0.06 + Math.sin(e) * 0.12, Math.cos(a) * 0.15 * Math.cos(e * 0.6) - 0.04], 0, [0.06, 0.06, 0.06]); }
    if (style === 'bald') H.add(P.shell, '#9a9a9a', [0, -0.01, -0.005], 0, [0.17, 0.07, 0.166]);
    if (style === 'side') H.add(P.shell, hc, [0, -0.04, -0.005], 0, [0.176, 0.12, 0.17]);
    if (!female && Math.random() < 0.28) {
      H.add(GE.sphLo, hc, [0, -0.115, 0.07], 0, [0.12, 0.08, 0.1]);
      H.add(GE.box, hc, [0, -0.047, 0.158], 0, [0.075, 0.018, 0.02]);
    }
    if (o.glasses ?? Math.random() < 0.3) {
      const gc = pick(['#1b1b1b', '#6b3b1a', '#2b3a67']);
      H.add(P.ring, gc, [-0.058, 0.024, 0.163], 0, [0.034, 0.034, 0.03]); H.add(P.ring, gc, [0.058, 0.024, 0.163], 0, [0.034, 0.034, 0.03]);
      H.add(GE.box, gc, [0, 0.03, 0.166], 0, [0.04, 0.008, 0.008]);
    }
    const hat = o.hat || (Math.random() < 0.12 ? pick(['beret', 'cap']) : null);
    if (hat === 'beret') H.add(GE.sph, pick(['#c2262e', '#1b1b1b', '#2b3a67']), [0.02, 0.13, -0.01], [0.1, 0, -0.25], [0.19, 0.06, 0.18]);
    if (hat === 'cap') {
      const cc = pick(['#2f6fdb', '#e2403a', '#1b1b1b']);
      H.add(P.cap, cc, [0, 0.03, -0.005], [-0.25, 0, 0], [0.18, 0.17, 0.178]);
      H.add(GE.box, cc, [0, 0.07, 0.17], [0.2, 0, 0], [0.18, 0.015, 0.12]);
    }
    if (hat === 'pork') {
      H.add(GE.cyl, '#2a2a2a', [0, 0.14, -0.01], [-0.1, 0, 0], [0.13, 0.11, 0.13]);
      H.add(GE.cyl, '#2a2a2a', [0, 0.09, -0.01], [-0.1, 0, 0], [0.24, 0.012, 0.24]);
      H.add(GE.cyl, '#b3242f', [0, 0.11, -0.01], [-0.1, 0, 0], [0.132, 0.025, 0.132]);
    }
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
    this.mouth = new THREE.Group(); this.mouth.position.set(0, -0.068, 0);
    this.head.add(this.mouth);
    const SM = new Batch();
    SM.add(P.smile, '#7a2a2a', [0, 0.03, 0.15], [0, 0, Math.PI], [1, 1, 1]);
    this.smile = mk(SM, M_().person, this.mouth, false);
    const OM = new Batch();
    OM.add(GE.sphLo, '#5a1a1d', [0, -0.005, 0.142], 0, [0.042, 0.04, 0.018]);
    OM.add(GE.box, '#ffffff', [0, 0.022, 0.155], 0, [0.05, 0.012, 0.01]);
    OM.add(GE.sphLo, '#e86f7a', [0, -0.028, 0.151], 0, [0.025, 0.012, 0.01]);
    this.open = new THREE.Group();
    this.mouth.add(this.open);
    mk(OM, M_().person, this.open, false);
    this.open.visible = false;

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

  headWorld(v = V3()) {
    return this.anchor.getWorldPosition(v);
  }
  pan() {
    const v = this.headWorld().project(G.camera);
    return clamp(v.x * 0.85, -0.85, 0.85);
  }
  setAction(type, dur) {
    const n = visNow();
    this.action = { type, t0: n, until: n + dur };
  }
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