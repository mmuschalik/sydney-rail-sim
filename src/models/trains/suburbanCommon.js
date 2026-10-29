// Shared builder for Sydney suburban double-deck EMU cars (A/B Waratah, T Tangara,
// M Millennium, K set, H OSCAR).
//
// Coordinate contract: metres, car centred at origin, +X forward (cab of a lead car at +X),
// +Y up with y = 0 = top of rail, Z lateral.
//
// Construction approach
//  * Car body = a "loft": a series of cross-section slices along X. Each slice is a rounded
//    rectangle (with upper-side tumblehome) so we can drop the body floor into the
//    double-deck "well" between the bogies, and taper/rake the cab nose.
//  * All body surfaces share ONE material per fleet whose map is a 1024x1024 canvas atlas:
//      rows   0..255  : lead (driving) car side   (u = x along body, v = height 0..4.5 m)
//      rows 256..511  : intermediate car side
//      rows 768..1023 : cols 0..255 cab front (projected on the YZ plane), cols 256..511 end wall
//    A matching 512^2 metalness/roughness atlas (G = roughness, B = metalness) lets painted
//    cab fronts, brushed stainless sides and glossy windscreens coexist in one material,
//    and a 256^2 emissive atlas makes the LED destination board glow.
//  * Passenger windows are separate thin quads using the shared `glass` material
//    (userData.nightEmissive) so the runtime can light them up at night.
//  * Every car is returned as a Group with at most one mesh per material (geometry merged),
//    which is what the runtime's instancing/merging expects.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ATLAS = 1024; // colour atlas size (px)
export const TEX_H = 4.5; // metres covered vertically by each side/front region
const FRONT_HALF = 1.6; // metres covered laterally by the front/end regions (+-)

// ---------------------------------------------------------------- materials
export function makeMaterials(code, painter) {
  const { color, mr, emit } = painter.textures();
  const body = new THREE.MeshStandardMaterial({
    name: 'body', map: color, metalnessMap: mr, roughnessMap: mr, metalness: 1, roughness: 1,
    emissive: 0xffffff, emissiveMap: emit, emissiveIntensity: 1.0,
  });
  const glass = new THREE.MeshStandardMaterial({
    name: 'glass', color: 0x26313a, metalness: 0.5, roughness: 0.06,
    emissive: 0xffe6c0, emissiveMap: interiorGlowTexture(), emissiveIntensity: 0,
  });
  glass.userData.nightEmissive = true;
  const dark = new THREE.MeshStandardMaterial({ name: 'dark', color: 0x24272a, metalness: 0.45, roughness: 0.75 });
  const misc = new THREE.MeshStandardMaterial({ name: 'misc', color: 0x9da2a6, metalness: 0.7, roughness: 0.45 });
  const headlight = new THREE.MeshStandardMaterial({
    name: 'headlight', color: 0xfff6e0, emissive: 0xfff3d6, emissiveIntensity: 2.0, roughness: 0.2, metalness: 0,
  });
  const taillight = new THREE.MeshStandardMaterial({
    name: 'taillight', color: 0xff2a1a, emissive: 0xff1a0a, emissiveIntensity: 2.0, roughness: 0.3, metalness: 0,
  });
  for (const m of [body, glass, dark, misc, headlight, taillight]) m.userData.fleet = code;
  return { body, glass, dark, misc, headlight, taillight };
}

// Night interior glow seen through a window quad (uv 0..1 per window): bright ceiling
// strip at the top, warm mid-tones, darker seat backs towards the bottom.
let _glow = null;
function interiorGlowTexture() {
  if (_glow) return _glow;
  const c = canvas2d(64); const g = c.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#fff8e8'); g.addColorStop(0.12, '#fff3da'); g.addColorStop(0.3, '#d9c6a2');
  g.addColorStop(0.65, '#a8957a'); g.addColorStop(1, '#5a4d3e');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  c.fillStyle = 'rgba(40,32,26,0.45)'; // seat backs
  for (let x = 2; x < 64; x += 16) c.fillRect(x, 36, 11, 28);
  _glow = new THREE.CanvasTexture(c.canvas); _glow.colorSpace = THREE.SRGBColorSpace;
  _glow.wrapS = THREE.RepeatWrapping; return _glow;
}

// ---------------------------------------------------------------- painter (canvas atlas)
// mat = { c: css colour, m: metalness 0..1, r: roughness 0..1, e: emissive css colour (optional) }
export const M = {
  stainless: { c: '#b9bec2', m: 0.85, r: 0.38 },
  stainlessDark: { c: '#8d9297', m: 0.85, r: 0.42 },
  roofGrey: { c: '#a3a7aa', m: 0.6, r: 0.55 },
  black: { c: '#16181a', m: 0.2, r: 0.6 },
  charcoal: { c: '#33373b', m: 0.35, r: 0.45 },
  windowDark: { c: '#151b20', m: 0.4, r: 0.1 },
  windscreen: { c: '#27343c', m: 0.55, r: 0.06 },
  rubber: { c: '#0f1011', m: 0.0, r: 0.8 },
  yellowPaint: { c: '#f6b60f', m: 0.05, r: 0.42 },
  yellowDoor: { c: '#f4b81a', m: 0.05, r: 0.42 },
  orangePaint: { c: '#f26a1f', m: 0.05, r: 0.42 },
  orangeDoor: { c: '#f07c1c', m: 0.05, r: 0.42 },
  silverPaint: { c: '#c4c7c9', m: 0.6, r: 0.4 },
  white: { c: '#f3f3f0', m: 0.05, r: 0.5 },
  underGrey: { c: '#3b3e41', m: 0.4, r: 0.7 },
};

export class Painter {
  constructor(bodyLen) {
    this.L = bodyLen;
    this.layers = [
      { name: 'color', s: 1, ctx: canvas2d(ATLAS) },
      { name: 'mr', s: 0.5, ctx: canvas2d(ATLAS / 2) },
      { name: 'emit', s: 0.25, ctx: canvas2d(ATLAS / 4) },
    ];
    // emissive defaults to black
    const e = this.layers[2].ctx; e.fillStyle = '#000'; e.fillRect(0, 0, ATLAS, ATLAS);
  }
  style(layer, mat) {
    if (layer.name === 'color') return mat.c;
    if (layer.name === 'mr') return `rgb(0,${Math.round((mat.r ?? 0.5) * 255)},${Math.round((mat.m ?? 0) * 255)})`;
    return mat.e || '#000';
  }
  // raw pixel-space fill on all layers
  px(x, y, w, h, mat, rad = 0) {
    for (const L of this.layers) {
      const c = L.ctx; c.fillStyle = this.style(L, mat);
      c.beginPath();
      if (rad > 0) c.roundRect(x * L.s, y * L.s, w * L.s, h * L.s, rad * L.s); else c.rect(x * L.s, y * L.s, w * L.s, h * L.s);
      c.fill();
    }
  }
  pxEllipse(cx, cy, rx, ry, mat) {
    for (const L of this.layers) {
      const c = L.ctx; c.fillStyle = this.style(L, mat);
      c.beginPath(); c.ellipse(cx * L.s, cy * L.s, rx * L.s, ry * L.s, 0, 0, Math.PI * 2); c.fill();
    }
  }
  pxPoly(pts, mat) {
    for (const L of this.layers) {
      const c = L.ctx; c.fillStyle = this.style(L, mat);
      c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x * L.s, y * L.s) : c.moveTo(x * L.s, y * L.s))); c.closePath(); c.fill();
    }
  }
  // --- metre-space helpers
  sx(x) { return ((x + this.L / 2) / this.L) * ATLAS; }
  sy(region, y) { return region * 256 + (1 - y / TEX_H) * 256; }
  fz(z, end = false) { return (end ? 256 : 0) + ((FRONT_HALF - z) / (2 * FRONT_HALF)) * 256; }
  fy(y) { return 768 + (1 - y / TEX_H) * 256; }
  /** side rect: region 0 = lead, 1 = mid. x0<x1, y0<y1 metres */
  side(region, x0, x1, y0, y1, mat, radM = 0) {
    const X0 = this.sx(x0), X1 = this.sx(x1), Y0 = this.sy(region, y1), Y1 = this.sy(region, y0);
    this.px(X0, Y0, X1 - X0, Y1 - Y0, mat, radM * (ATLAS / this.L));
  }
  sidePoly(region, pts, mat) { this.pxPoly(pts.map(([x, y]) => [this.sx(x), this.sy(region, y)]), mat); }
  /** front rect (symmetric about z=0 when z0 = -z1); end=true paints the end-wall region */
  front(z0, z1, y0, y1, mat, radM = 0, end = false) {
    const A = this.fz(Math.max(z0, z1), end), B = this.fz(Math.min(z0, z1), end);
    this.px(A, this.fy(y1), B - A, this.fy(y0) - this.fy(y1), mat, radM * (256 / (2 * FRONT_HALF)));
  }
  frontEllipse(z, y, rz, ry, mat, end = false) {
    const k = 256 / (2 * FRONT_HALF);
    this.pxEllipse(this.fz(z, end), this.fy(y), rz * k, ry * (256 / TEX_H), mat);
  }
  frontPoly(pts, mat, end = false) { this.pxPoly(pts.map(([z, y]) => [this.fz(z, end), this.fy(y)]), mat); }
  frontText(text, z, y, hM, color, glow) {
    for (const L of this.layers) {
      if (L.name === 'mr') continue;
      const c = L.ctx; c.save(); c.scale(L.s, L.s);
      c.fillStyle = L.name === 'color' ? color : glow; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `bold ${Math.round(hM * (256 / TEX_H))}px sans-serif`;
      c.fillText(text, this.fz(z), this.fy(y));
      c.restore();
    }
  }
  sideText(region, text, x, y, hM, color) {
    const c = this.layers[0].ctx; c.save(); c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `bold ${Math.round(hM * (256 / TEX_H))}px sans-serif`; c.fillText(text, this.sx(x), this.sy(region, y)); c.restore();
  }
  /** horizontal fluting lines (K/T style corrugated stainless) */
  fluting(region, x0, x1, y0, y1, pitch = 0.06) {
    for (let y = y0; y < y1; y += pitch) this.side(region, x0, x1, y, y + pitch * 0.35, { c: '#9ea3a7', m: 0.85, r: 0.5 });
  }
  textures() {
    if (this._tex) return this._tex;
    const mk = (ctx, srgb) => {
      const t = new THREE.CanvasTexture(ctx.canvas);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4; t.needsUpdate = true; return t;
    };
    this._tex = { color: mk(this.layers[0].ctx, true), mr: mk(this.layers[1].ctx, false), emit: mk(this.layers[2].ctx, true) };
    return this._tex;
  }
}
function canvas2d(n) {
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  return cv.getContext('2d');
}

// UV mappers --------------------------------------------------------------
const sideUV = (region, L) => (x, y) => [(x + L / 2) / L, 1 - (region * 256 + (1 - y / TEX_H) * 256) / ATLAS];
const frontUV = (end) => (x, y, z) => [((end ? 256 : 0) + ((FRONT_HALF - z) / (2 * FRONT_HALF)) * 256) / ATLAS, 1 - (768 + (1 - y / TEX_H) * 256) / ATLAS];
export const UV = { sideUV, frontUV };

// ---------------------------------------------------------------- body cross-section / loft
/** profile: { W half width, yb bottom, yt top, rt top-corner radius, rb bottom-corner radius,
 *  tumble inward lean of upper side, waistY where lean starts }. n = arc segments. */
export function ring(p, n) {
  if (n === 0) { // low-LOD: 8-point ring, square bottom, chamfered roof
    const c = p.rt * 0.6;
    const h = [[0, p.yb], [p.W, p.yb], [p.W - p.tumble, p.yt - c], [p.W - p.tumble - c, p.yt], [0, p.yt]];
    return [...h, ...h.slice(1, 4).reverse().map(([z, y]) => [-z, y])];
  }
  const half = [[0, p.yb]];
  const rb = Math.min(p.rb, (p.waistY - p.yb) * 0.9);
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * (i / n); half.push([p.W - rb + rb * Math.cos(a), p.yb + rb + rb * Math.sin(a)]); }
  half.push([p.W, Math.max(p.waistY, p.yb + rb + 0.01)]);
  for (let i = 0; i <= n; i++) { const a = (Math.PI / 2) * (i / n); half.push([p.W - p.tumble - p.rt + p.rt * Math.cos(a), p.yt - p.rt + p.rt * Math.sin(a)]); }
  half.push([0, p.yt]);
  const pts = half.slice();
  for (let i = half.length - 2; i >= 1; i--) pts.push([-half[i][0], half[i][1]]);
  return pts; // closed loop of [z, y]
}
/** half-width of the body side at height y (for placing glass/lights) */
export function sideZ(p, y) {
  if (y <= p.waistY) return p.W;
  const top = p.yt - p.rt;
  return p.W - p.tumble * Math.min(1, (y - p.waistY) / (top - p.waistY));
}

/** slices: [{x, p (profile), off?: (y)=>dx}] increasing x. uv(x,y,z)->[u,v] */
export function loft(slices, n, uv, { capStart = null, capEnd = null } = {}) {
  const rings = slices.map((s) => ring(s.p, n));
  const m = rings[0].length;
  const pos = [], uvs = [], idx = [];
  slices.forEach((s, i) => rings[i].forEach(([z, y]) => {
    const x = s.x + (s.off ? s.off(y) : 0);
    pos.push(x, y, z); uvs.push(...uv(x, y, z));
  }));
  for (let i = 0; i < slices.length - 1; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = (i + 1) * m + j, c = (i + 1) * m + ((j + 1) % m), d = i * m + ((j + 1) % m);
    idx.push(a, b, c, a, c, d);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx); g.computeVertexNormals(); g = g.toNonIndexed();
  const parts = [g];
  const cap = (si, dirPlus, capUV) => {
    const s = slices[si], r = rings[si];
    const off = s.off || (() => 0);
    const P = r.map(([z, y]) => [s.x + off(y), y, z]);
    const cy = P.reduce((a, p) => a + p[1], 0) / P.length;
    const c = [s.x + off(cy), cy, 0];
    const cp = [], cu = [], cn = [];
    const sgn = dirPlus ? 1 : -1;
    for (let j = 0; j < P.length; j++) {
      const p0 = P[j], p1 = P[(j + 1) % P.length];
      const tri = dirPlus ? [c, p1, p0] : [c, p0, p1];
      for (const v of tri) {
        cp.push(...v); cu.push(...capUV(v[0], v[1], v[2]));
        // smooth analytic normal of the (possibly raked) face x = s.x + off(y)
        const d = (off(v[1] + 0.01) - off(v[1] - 0.01)) / 0.02;
        const l = Math.hypot(1, d); cn.push(sgn / l, (-sgn * d) / l, 0);
      }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
    cg.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3)); parts.push(cg);
  };
  if (capStart) cap(0, false, capStart);
  if (capEnd) cap(slices.length - 1, true, capEnd);
  return parts;
}

// ---------------------------------------------------------------- simple parts
export function box(sx, sy, sz, x, y, z) {
  const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); return g;
}
export function cylX(r, len, seg, x, y, z) { // axis along X
  const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return g;
}
export function cylZ(r, len, seg, x, y, z, capped = true) { // axis along Z
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, !capped); g.rotateX(Math.PI / 2); g.translate(x, y, z); return g;
}
export function cylY(r, len, seg, x, y, z) {
  const g = new THREE.CylinderGeometry(r, r, len, seg); g.translate(x, y, z); return g;
}
/** beam between two points (square section) */
export function beam(a, b, t) {
  const d = new THREE.Vector3().subVectors(b, a); const len = d.length();
  const g = new THREE.BoxGeometry(len, t, t);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
  g.applyQuaternion(q); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return g;
}
/** forward-facing (+X) disc for lamps */
export function lampDisc(r, x, y, z, seg = 10, dir = 1) {
  const g = new THREE.CircleGeometry(r, seg); g.rotateY(dir * Math.PI / 2); g.translate(x, y, z); return g;
}
/** window quad on the side of the body following the tumblehome (split at the waist so it
 *  never sinks behind the body); side = +1 / -1. uv.u runs in ~1.6 m repeats for the glow map. */
export function sideQuad(prof, x0, x1, y0, y1, side, out = 0.012) {
  const ys = y0 < prof.waistY && y1 > prof.waistY ? [y0, prof.waistY, y1] : [y0, y1];
  const pos = [], uv = [];
  const u0 = 0, u1 = Math.max(1, Math.round((x1 - x0) / 1.6));
  for (let k = 0; k < ys.length - 1; k++) {
    const ya = ys[k], yb = ys[k + 1];
    const za = (sideZ(prof, ya) + out) * side, zb = (sideZ(prof, yb) + out) * side;
    const va = (ya - y0) / (y1 - y0), vb = (yb - y0) / (y1 - y0);
    const A = [x0, ya, za, u0, va], Bv = [x1, ya, za, u1, va], C = [x1, yb, zb, u1, vb], D = [x0, yb, zb, u0, vb];
    const tris = side > 0 ? [A, Bv, C, A, C, D] : [Bv, A, D, Bv, D, C];
    for (const t of tris) { pos.push(t[0], t[1], t[2]); uv.push(t[3], t[4]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals(); return g;
}

// ---------------------------------------------------------------- bogie / pantograph
/** Two-axle bogie centred at x. wheel radius r, wheelbase wb. Returns geometries (dark). */
export function bogie(x, r = 0.43, wb = 2.5, lod = 'high') {
  if (lod === 'low') return [box(wb + 2 * r, 2 * r + 0.1, 2.0, x, r + 0.05, 0)];
  const gs = [];
  const zW = 0.7175 + 0.03; // wheel tread centre (1435 mm gauge)
  for (const dx of [-wb / 2, wb / 2]) {
    for (const s of [-1, 1]) {
      gs.push(cylZ(r, 0.13, 18, x + dx, r, s * zW));
      gs.push(box(0.36, 0.24, 0.22, x + dx, r, s * 1.0)); // axle box
      gs.push(cylY(0.09, 0.22, 8, x + dx, r + 0.24, s * 1.0)); // primary spring
    }
    gs.push(cylZ(0.08, 2.0, 8, x + dx, r, 0));
  }
  for (const s of [-1, 1]) {
    gs.push(box(wb + 0.7, 0.26, 0.16, x, r + 0.2, s * 1.0)); // side frame
    gs.push(cylY(0.22, 0.25, 12, x, r + 0.45, s * 0.95)); // air spring
    gs.push(box(0.5, 0.18, 0.08, x - wb / 2 + 0.6, r + 0.05, s * 1.13)); // brake unit
    gs.push(box(0.5, 0.18, 0.08, x + wb / 2 - 0.6, r + 0.05, s * 1.13));
  }
  gs.push(box(0.5, 0.3, 2.05, x, r + 0.2, 0)); // transom
  gs.push(box(0.6, 0.12, 2.3, x, r + 0.6, 0)); // bolster
  return gs;
}
/** Single-arm (Faiveley/Austbreck style) pantograph raised to headY, base at roof (x, roofY). */
export function pantograph(x, roofY, headY = 5.35, dir = 1) {
  const dark = [], misc = [];
  // base frame on 4 insulators
  for (const sx of [-0.55, 0.55]) for (const sz of [-0.45, 0.45]) misc.push(cylY(0.06, 0.22, 6, x + sx, roofY + 0.11, sz));
  dark.push(box(1.4, 0.08, 1.05, x, roofY + 0.26, 0));
  const knee = new THREE.Vector3(x + dir * 0.95, roofY + 0.3 + (headY - roofY - 0.3) * 0.5, 0);
  for (const sz of [-0.28, 0.28]) {
    dark.push(beam(new THREE.Vector3(x - dir * 0.55, roofY + 0.32, sz), new THREE.Vector3(knee.x, knee.y, sz * 0.4), 0.07));
  }
  dark.push(cylY(0.08, 0.25, 6, x - dir * 0.45, roofY + 0.42, 0)); // drive
  const head = new THREE.Vector3(x - dir * 0.05, headY - 0.12, 0);
  dark.push(beam(knee, head, 0.06));
  dark.push(beam(new THREE.Vector3(x - dir * 0.3, roofY + 0.32, 0), new THREE.Vector3(knee.x - dir * 0.1, knee.y - 0.05, 0), 0.025));
  // head: two collector strips ~1.6 m wide with horns
  for (const dx of [-0.17, 0.17]) misc.push(box(0.06, 0.05, 1.3, head.x + dx, headY - 0.02, 0));
  dark.push(box(0.4, 0.06, 0.9, head.x, headY - 0.1, 0));
  for (const s of [-1, 1]) dark.push(beam(new THREE.Vector3(head.x, headY - 0.02, s * 0.65), new THREE.Vector3(head.x, headY - 0.18, s * 0.9), 0.04));
  return { dark, misc };
}

// ---------------------------------------------------------------- group assembly
export function assemble(buckets, mats, name) {
  const g = new THREE.Group(); g.name = name;
  let tris = 0;
  for (const [key, list] of Object.entries(buckets)) {
    if (!list.length) continue;
    const norm = list.map((geo) => {
      let q = geo.index ? geo.toNonIndexed() : geo;
      for (const a of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(a)) q.deleteAttribute(a);
      if (!q.attributes.normal) q.computeVertexNormals();
      if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((q.attributes.position.count) * 2), 2));
      return q;
    });
    const merged = mergeGeometries(norm, false);
    merged.computeBoundingSphere();
    tris += merged.attributes.position.count / 3;
    const mesh = new THREE.Mesh(merged, mats[key]); mesh.name = key;
    g.add(mesh);
  }
  g.userData.triangles = tris;
  return g;
}
