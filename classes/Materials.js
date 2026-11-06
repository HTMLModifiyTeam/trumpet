import * as THREE from 'three';
import { C, V3, clamp } from "./utils.js"

const _q = new THREE.Quaternion(), _e = new THREE.Euler();
export function mtx(p, r, s) {
  _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(V3(p[0], p[1], p[2]), _q, V3(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1));
}

export class Batch {
  constructor() {
    this.items = [];
  } 
  add(geo, color, p, r, s) {
    this.items.push({ geo, color: color instanceof THREE.Color ? color : C(color), mat: mtx(p, r, s) });
    return this;
  }
  addM(geo, color, m) {
    this.items.push({ geo, color: color instanceof THREE.Color ? color : C(color), mat: m });
    return this;
  }
  mesh(mat) {
    const m = new THREE.Mesh(mergeGeoms(this.items), mat);
    this.items = [];
    return m;
  }
  get size() {
    return this.items.length;
  }
}

export function shadeHex(hex, amt) {
  const c = new THREE.Color(hex);
  const f = 1 + amt;
  return '#' + new THREE.Color(clamp(c.r * f, 0, 1), clamp(c.g * f, 0, 1), clamp(c.b * f, 0, 1)).getHexString();
}

export function mergeGeoms(items) {
  let total = 0;
  const parts = items.map(({ geo, color, mat }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone(); g.applyMatrix4(mat);
    total += g.attributes.position.count;
    return { g, color };
  });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const { g, color } of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < n; i++) {
      col[(o + i) * 3] = color.r;
      col[(o + i) * 3 + 1] = color.g;
      col[(o + i) * 3 + 2] = color.b;
    }
    o += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}