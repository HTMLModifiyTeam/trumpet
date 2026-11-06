import { clamp, V3 } from "./utils.js";
import { G } from "./data.js"

export class UI_ {
  constructor() {
    this.bubbles = [];
    this.el = {};
    this._bv = V3();
  }

  init() {
    Object.assign(this.el, {
      bubbles: document.getElementById('bubbles'),
      setlist: document.getElementById('setlist')
    });
  }

  bubble(p, text, big, delay = 0) {
    const el = document.createElement('div');
    el.className = 'bub' + (big ? ' big' : '');
    el.textContent = text;
    el.style.opacity = 0;

    this.el.bubbles.appendChild(el);
    this.bubbles.push({ el, p, t0: performance.now() / 1000 + Math.max(0, delay), dur: big ? 2.6 : 1.8 });
    if (this.bubbles.length > 10) {
      const o = this.bubbles.shift();
      o.el.remove();
    }
  }

  updateBubbles() {
    const t = performance.now() / 1000, W = G.W, H = G.H;
    this.bubbles = this.bubbles.filter(b => {
      if (t < b.t0) return true;
      const age = t - b.t0;
      if (age > b.dur) {
        b.el.remove();
        return false;
      }
      b.p.headWorld(this._bv).project(G.camera);
      if (this._bv.z > 1 || Math.abs(this._bv.x) > 1.3) {
        b.el.style.opacity = 0;
        return true;
      }
      const bw = b.el.offsetWidth || 80;
      const y = clamp((-this._bv.y * 0.5 + 0.5) * H, 84, H - 60);
      const x = clamp((this._bv.x * 0.5 + 0.5) * W, bw / 2 + 8, W - bw / 2 - 8);
      const s = age < 0.14 ? 0.55 + age / 0.14 * 0.45 : 1, op = age > b.dur - 0.3 ? (b.dur - age) / 0.3 : 1;
      b.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%) scale(${s})`;
      b.el.style.opacity = op;
      return true;
    });
  }

  setlist(seg) {
    const map = { intro: 'head', head: 'head', tb: 'tb', pn: 'pn', me: 'me', out: 'out', tag: 'out', end: 'out' };
    const order = ['head', 'tb', 'pn', 'me', 'out'];
    const cur = seg === 'done' ? 'zz' : map[seg], ci = order.indexOf(cur);
    this.el.setlist.querySelectorAll('span').forEach(s => {
      const i = order.indexOf(s.dataset.s);
      s.classList.toggle('now', i === ci);
      s.classList.toggle('done', seg === 'done' || (ci >= 0 && i < ci));
    });
  }
}