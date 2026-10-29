// Shared helpers for procedural landmark models.
// GeoBuilder accumulates flat-shaded triangles (positions/normals/uvs) so that
// thousands of beams / blocks can be merged into a single draw call.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

export class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; }
  get triCount() { return this.p.length / 9; }
  tri(a, b, c, ua = [0, 0], ub = [1, 0], uc = [1, 1]) {
    _a.subVectors(b, a); _b.subVectors(c, a); _n.crossVectors(_a, _b);
    const l = _n.length(); if (l < 1e-12) return; _n.multiplyScalar(1 / l);
    this.p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) this.n.push(_n.x, _n.y, _n.z);
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  // a,b,c,d in order around the quad
  quad(a, b, c, d, ua = [0, 0], ub = [1, 0], uc = [1, 1], ud = [0, 1]) {
    this.tri(a, b, c, ua, ub, uc); this.tri(a, c, d, ua, uc, ud);
  }
  // oriented box: centre c, unit axes ax, ay, az, half extents hx, hy, hz; uv scale in metres per texture repeat
  box(c, ax, ay, az, hx, hy, hz, uvs = 4, faces = 63) {
    const P = (sx, sy, sz) => new THREE.Vector3(
      c.x + ax.x * hx * sx + ay.x * hy * sy + az.x * hz * sz,
      c.y + ax.y * hx * sx + ay.y * hy * sy + az.y * hz * sz,
      c.z + ax.z * hx * sx + ay.z * hy * sy + az.z * hz * sz);
    const X = 2 * hx / uvs, Y = 2 * hy / uvs, Z = 2 * hz / uvs;
    const f = (bit, a, b, c2, d, u, v) => { if (faces & bit) this.quad(a, b, c2, d, [0, 0], [u, 0], [u, v], [0, v]); };
    f(1, P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), Y, Z);
    f(2, P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), P(-1, -1, -1), Y, Z);
    f(4, P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), X, Z);
    f(8, P(-1, -1, 1), P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), X, Z);
    f(16, P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), X, Y);
    f(32, P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), X, Y);
  }
  // axis-aligned box from min/max
  aabox(x0, y0, z0, x1, y1, z1, uvs = 4, faces = 63) {
    this.box(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), X_, Y_, Z_, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2, uvs, faces);
  }
  // beam between p0 and p1 with cross-section w (sideways) x h (towards 'up')
  beam(p0, p1, w, h, up = Y_, uvs = 4, ends = true) {
    const d = new THREE.Vector3().subVectors(p1, p0); const L = d.length(); if (L < 1e-6) return;
    d.multiplyScalar(1 / L);
    let side = new THREE.Vector3().crossVectors(d, up);
    if (side.lengthSq() < 1e-8) side = new THREE.Vector3().crossVectors(d, X_);
    side.normalize();
    const u = new THREE.Vector3().crossVectors(side, d).normalize();
    const c = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
    this.box(c, d, u, side, L / 2, h / 2, w / 2, uvs, ends ? 63 : 60);
  }
  // vertical prism from a 2D polygon [[x,z],...] (CCW or CW) between y0 and y1; optional taper polygon at top
  prism(poly, y0, y1, polyTop = null, uvs = 4, caps = 3) {
    const top = polyTop || poly; const n = poly.length;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = new THREE.Vector3(poly[i][0], y0, poly[i][1]), b = new THREE.Vector3(poly[j][0], y0, poly[j][1]);
      const c = new THREE.Vector3(top[j][0], y1, top[j][1]), d = new THREE.Vector3(top[i][0], y1, top[i][1]);
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      this.quad(a, b, c, d, [acc / uvs, y0 / uvs], [(acc + L) / uvs, y0 / uvs], [(acc + L) / uvs, y1 / uvs], [acc / uvs, y1 / uvs]);
      acc += L;
    }
    const cap = (pl, y) => {
      const pts = pl.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(pts, []);
      for (const t of tris) this.tri(...t.map((k) => new THREE.Vector3(pl[k][0], y, pl[k][1])), ...t.map((k) => [pl[k][0] / uvs, pl[k][1] / uvs]));
    };
    if (caps & 1) cap(top, y1);
    if (caps & 2) cap(poly, y0);
  }
  // sweep a closed (or open) 2D section [[lat, up],...] along frames [{p, side, up, v}]
  sweep(frames, section, closed = true, uvs = 4) {
    const m = section.length; const segs = closed ? m : m - 1;
    const per = [0]; for (let k = 1; k <= m; k++) { const a = section[k - 1], b = section[k % m]; per.push(per[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const P = (f, s) => new THREE.Vector3(f.p.x + f.side.x * s[0] + f.up.x * s[1], f.p.y + f.side.y * s[0] + f.up.y * s[1], f.p.z + f.side.z * s[0] + f.up.z * s[1]);
    for (let i = 1; i < frames.length; i++) {
      const f0 = frames[i - 1], f1 = frames[i];
      for (let k = 0; k < segs; k++) {
        const s0 = section[k], s1 = section[(k + 1) % m];
        const u0 = per[k] / uvs, u1 = per[k + 1] / uvs, v0 = f0.v / uvs, v1 = f1.v / uvs;
        this.quad(P(f0, s0), P(f0, s1), P(f1, s1), P(f1, s0), [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
      }
    }
  }
  // merge raw geometry (BufferGeometry, non-indexed or indexed) transformed by matrix
  addGeometry(geo, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position, uv = g.attributes.uv;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let i = 0; i < pos.count; i += 3) {
      for (let k = 0; k < 3; k++) { v[k].fromBufferAttribute(pos, i + k); if (matrix) v[k].applyMatrix4(matrix); }
      const uvk = (k) => (uv ? [uv.getX(i + k), uv.getY(i + k)] : [0, 0]);
      this.tri(v[0].clone(), v[1].clone(), v[2].clone(), uvk(0), uvk(1), uvk(2));
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  mesh(material, name) {
    const m = new THREE.Mesh(this.build(), material); m.name = name || material.name; return m;
  }
}
export const X_ = new THREE.Vector3(1, 0, 0), Y_ = new THREE.Vector3(0, 1, 0), Z_ = new THREE.Vector3(0, 0, 1);
export const V = (x, y, z) => new THREE.Vector3(x, y, z);

// deterministic PRNG
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function canvasTexture(w, h, draw, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// speckle noise overlay
export function speckle(ctx, w, h, n, alpha, light = true, seed = 7, size = 1.5) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    ctx.fillRect(r() * w, r() * h, size * (0.5 + r()), size * (0.5 + r()));
  }
}

// soft blotches for weathering
export function blotches(ctx, w, h, n, color, maxR, alpha, seed = 3) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, rad = maxR * (0.3 + r());
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, color.replace('A', String(alpha * r()))); g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

export function stdMat(name, opts) {
  const m = new THREE.MeshStandardMaterial(opts); m.name = name; return m;
}

// mark a material as night-lit: runtime ramps emissiveIntensity up at night
export function nightLit(m, color, intensity = 1) {
  m.emissive = new THREE.Color(color); m.emissiveIntensity = 0;
  m.userData.nightEmissive = true; m.userData.nightIntensity = intensity;
  return m;
}

export function countTriangles(obj) {
  let n = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry; const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
    n += o.isInstancedMesh ? t * o.count : t;
  });
  return n;
}

// Local frame helper: world (x,z) <-> local (t,s) where s runs along unit axis A, t along P = (-A.z, A.x)
export class AxisFrame {
  constructor(cx, cz, ax, az) {
    const l = Math.hypot(ax, az); this.cx = cx; this.cz = cz; this.ax = ax / l; this.az = az / l;
    this.px = -this.az; this.pz = this.ax;
  }
  // world -> {s, t}
  toLocal(x, z) { const dx = x - this.cx, dz = z - this.cz; return { s: dx * this.ax + dz * this.az, t: dx * this.px + dz * this.pz }; }
  toWorld(s, t) { return { x: this.cx + s * this.ax + t * this.px, z: this.cz + s * this.az + t * this.pz }; }
  // place a group whose local coords are (X = t, Y = y, Z = -s)
  applyTo(obj) { obj.position.set(this.cx, 0, this.cz); obj.rotation.y = Math.atan2(-this.pz, this.px); obj.updateMatrixWorld(true); }
}

// signed area (x,z polygon); > 0 means counter-clockwise in a y-up/x-right sense of [x, z]
export function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
// inward miter offset of a simple polygon by d metres (clamped miter)
export function offsetPolygon(poly, d, _flip = false) {
  const n = poly.length; const s = polyArea(poly) > 0 ? 1 : -1; const out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], c = poly[(i + 1) % n];
    const e1 = [b[0] - a[0], b[1] - a[1]], e2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    // inward normals (for CCW polygon in this convention, inward is (-dy, dx) * s)
    const n1 = [-e1[1] / l1 * s, e1[0] / l1 * s], n2 = [-e2[1] / l2 * s, e2[0] / l2 * s];
    let m = [n1[0] + n2[0], n1[1] + n2[1]]; const ml = Math.hypot(...m) || 1; m = [m[0] / ml, m[1] / ml];
    const cos = m[0] * n1[0] + m[1] * n1[1]; const k = Math.min(3, 1 / Math.max(cos, 0.2));
    out.push([b[0] + m[0] * d * k, b[1] + m[1] * d * k]);
  }
  if (!_flip && d > 0 && Math.abs(polyArea(out)) > Math.abs(polyArea(poly))) return offsetPolygon(poly, -d, true);
  return out;
}
// remove near-duplicate consecutive vertices and closing duplicate
export function cleanPoly(p, eps = 0.3) {
  const o = [];
  for (const q of p) if (!o.length || Math.hypot(q[0] - o[o.length - 1][0], q[1] - o[o.length - 1][1]) > eps) o.push(q);
  if (o.length > 1 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) <= eps) o.pop();
  return o;
}
