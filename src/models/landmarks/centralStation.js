// Sydney Central station (1906-21): sandstone terminal building, 85 m clock tower and the
// arched Grand Concourse roof. Footprints from OSM ways 16748116 / 506597798 / 808966807.
// The platforms themselves are drawn by the runtime from OSM.
import * as THREE from 'three';
import { project } from '../../geo.js';
import D from './data/central.json';
import { GeoBuilder, V, Y_, canvasTexture, stdMat, nightLit, rng, speckle, blotches, offsetPolygon, cleanPoly } from './util.js';

const GROUND = 21;          // concourse / Eddy Ave forecourt level (m AMSL)
const WALL_H = 20;          // terminal building eaves (OSM height=20)
const TOWER_TOP = 85;       // clock tower height above ground
const XZ = (ll) => { const p = project(ll[0], ll[1]); return [p.x, p.z]; };

function makeMaterials() {
  const sandTex = canvasTexture(512, 512, (c, w, h) => {
    // 8 m x 8 m facade module: sandstone ashlar with two storeys of windows (arched below)
    c.fillStyle = '#c99a63'; c.fillRect(0, 0, w, h);
    const r = rng(12);
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? -24 : 0; x < w; x += 48) { const v = r(); c.fillStyle = `rgb(${196 + v * 22},${150 + v * 18},${98 + v * 14})`; c.fillRect(x + 1, y + 1, 46, 14); }
    blotches(c, w, h, 40, 'rgba(90,60,35,A)', 60, 0.25, 13); speckle(c, w, h, 12000, 0.12, false, 14);
    // windows: lower storey arched (y 300..470), upper rectangular (y 60..220)
    c.fillStyle = '#2b2620';
    c.fillRect(176, 80, 160, 150);
    c.beginPath(); c.moveTo(176, 470); c.lineTo(176, 340); c.arc(256, 340, 80, Math.PI, 0); c.lineTo(336, 470); c.closePath(); c.fill();
    c.fillStyle = 'rgba(120,140,150,0.45)'; c.fillRect(186, 90, 140, 130); c.fillRect(186, 350, 140, 110);
    c.fillStyle = '#a77c4b'; c.fillRect(0, 250, w, 12); c.fillRect(0, 0, w, 8); // string courses
    c.fillStyle = '#b38754'; c.fillRect(0, 0, 30, h); c.fillRect(w - 30, 0, 30, h); // pilasters
  });
  const plainTex = canvasTexture(256, 256, (c, w, h) => {
    // 4 m tile of plain sandstone ashlar (tower, cornices)
    c.fillStyle = '#c3955f'; c.fillRect(0, 0, w, h);
    const r = rng(16);
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? -24 : 0; x < w; x += 48) { const v = r(); c.fillStyle = `rgb(${192 + v * 20},${146 + v * 18},${96 + v * 14})`; c.fillRect(x + 1, y + 1, 46, 14); }
    blotches(c, w, h, 20, 'rgba(90,60,35,A)', 40, 0.22, 17); speckle(c, w, h, 5000, 0.12, false, 18);
  });
  const roofTex = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#6d6f6c'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { c.fillStyle = 'rgba(30,30,30,0.35)'; c.fillRect(x, 0, 2, h); }
    speckle(c, w, h, 3000, 0.1, true, 15);
  });
  const vaultTex = canvasTexture(256, 512, (c, w, h) => {
    // 8 m across x 16 m along the vault: corrugated roofing with glazed skylight strips
    c.fillStyle = '#7d8580'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { c.fillStyle = 'rgba(40,44,42,0.25)'; c.fillRect(x, 0, 2, h); }
    c.fillStyle = '#9fb3bb'; c.fillRect(0, 0, w, 60); c.fillStyle = 'rgba(40,50,55,0.6)'; for (let x = 0; x < w; x += 32) c.fillRect(x, 0, 3, 60);
    c.fillStyle = '#4d524f'; c.fillRect(0, 254, w, 6); // arch rib
  });
  const sand = stdMat('Central sandstone', { color: 0xffffff, map: sandTex, roughness: 0.9, side: THREE.DoubleSide });
  nightLit(sand, 0x5a3c1c, 1);
  const plain = stdMat('Central sandstone (plain ashlar)', { color: 0xffffff, map: plainTex, roughness: 0.9 });
  nightLit(plain, 0x6a4520, 1);
  const roof = stdMat('Central slate roof', { color: 0xffffff, map: roofTex, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide });
  const vault = stdMat('Central Grand Concourse roof', { color: 0xffffff, map: vaultTex, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide });
  nightLit(vault, 0x403020, 1);
  const clock = stdMat('Central clock face', { color: 0xf0ece0, roughness: 0.4 });
  nightLit(clock, 0xffd9a0, 1.3);
  const dark = stdMat('Central clock hands & trim', { color: 0x1d1b18, roughness: 0.6, metalness: 0.3 });
  return { sand, plain, roof, vault, clock, dark };
}

// oriented rectangle helpers for the clock tower: centre c [x,z], axes u,v (unit), half sizes
function towerBox(B, c, u, v, hu, hv, y0, y1, uvs = 4) {
  B.box(V(c[0], (y0 + y1) / 2, c[1]), V(u[0], 0, u[1]), Y_, V(v[0], 0, v[1]), hu, (y1 - y0) / 2, hv, uvs);
}

export function build() {
  const M = makeMaterials();
  const S = new GeoBuilder(), T = new GeoBuilder(), R = new GeoBuilder(), VB = new GeoBuilder(), CF = new GeoBuilder(), DK = new GeoBuilder();
  const G = GROUND;

  // ---- terminal building: sandstone walls + hipped roof (inset prism)
  const term = cleanPoly(D.terminal.map(XZ));
  S.prism(term, G - 7, G + WALL_H, null, 8, 0);
  const cornice = offsetPolygon(term, -0.6);
  T.prism(cornice, G + WALL_H - 0.4, G + WALL_H + 0.8, null, 8, 3);
  const inset = offsetPolygon(term, 4.5);
  R.prism(term, G + WALL_H + 0.8, G + WALL_H + 5.0, inset, 6, 1);

  // ---- Grand Concourse: barrel-vaulted roof over the OSM roof footprint
  {
    const pts = cleanPoly(D.concourse.map(XZ));
    // find the long axis via the farthest pair of points
    let best = [0, 1, 0]; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]); if (d > best[2]) best = [i, j, d]; }
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    // principal direction (PCA)
    let sxx = 0, sxz = 0, szz = 0; for (const p of pts) { const dx = p[0] - cx, dz = p[1] - cz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; }
    const th = 0.5 * Math.atan2(2 * sxz, sxx - szz); const u = [Math.cos(th), Math.sin(th)], v = [-u[1], u[0]];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) { const a = (p[0] - cx) * u[0] + (p[1] - cz) * u[1], b = (p[0] - cx) * v[0] + (p[1] - cz) * v[1]; u0 = Math.min(u0, a); u1 = Math.max(u1, a); v0 = Math.min(v0, b); v1 = Math.max(v1, b); }
    const half = (v1 - v0) / 2, vm = (v0 + v1) / 2; const spring = G + 16, rise = 13; const N = 24;
    const P = (a, k) => { const t = -1 + 2 * k / N; const b = vm + t * half; const y = spring + rise * Math.sqrt(Math.max(0, 1 - t * t)); return V(cx + u[0] * a + v[0] * b, y, cz + u[1] * a + v[1] * b); };
    const nA = Math.ceil((u1 - u0) / 4);
    for (let i = 0; i < nA; i++) for (let k = 0; k < N; k++) {
      const a0 = u0 + (u1 - u0) * i / nA, a1 = u0 + (u1 - u0) * (i + 1) / nA;
      const uvA = (a) => (a - u0) / 16, uvK = (kk) => kk / N * Math.PI * half / 8 * 1.1;
      VB.quad(P(a0, k), P(a0, k + 1), P(a1, k + 1), P(a1, k), [uvK(k), uvA(a0)], [uvK(k + 1), uvA(a0)], [uvK(k + 1), uvA(a1)], [uvK(k), uvA(a1)]);
    }
    // sandstone/glazed end walls (lunettes) and side walls up to the springing
    for (const a of [u0, u1]) {
      for (let k = 0; k < N; k++) { const p0 = P(a, k), p1 = P(a, k + 1); S.quad(V(p0.x, G, p0.z), V(p1.x, G, p1.z), p1, p0, [0, 0], [1, 0], [1, 1], [0, 1]); }
    }
    for (const b of [v0, v1]) {
      const q0 = V(cx + u[0] * u0 + v[0] * b, 0, cz + u[1] * u0 + v[1] * b), q1 = V(cx + u[0] * u1 + v[0] * b, 0, cz + u[1] * u1 + v[1] * b);
      S.quad(V(q0.x, G - 2, q0.z), V(q1.x, G - 2, q1.z), V(q1.x, spring, q1.z), V(q0.x, spring, q0.z), [0, 0], [(u1 - u0) / 8, 0], [(u1 - u0) / 8, (spring - G) / 8], [0, (spring - G) / 8]);
    }
    // ribs (steel arches) every 8 m
    for (let a = u0; a <= u1 + 0.01; a += (u1 - u0) / Math.round((u1 - u0) / 8)) for (let k = 0; k < N; k++) DK.beam(P(a, k), P(a, k + 1), 0.35, 0.5, V(u[0], 0, u[1]), 2);
    // ridge lantern
    const r0 = P(u0 + 3, N / 2), r1 = P(u1 - 3, N / 2);
    VB.beam(V(r0.x, r0.y + 0.9, r0.z), V(r1.x, r1.y + 0.9, r1.z), 3.0, 1.8, Y_, 4);
  }

  // ---- clock tower
  {
    const fp = cleanPoly(D.clock.map(XZ));
    const cx = fp.reduce((a, p) => a + p[0], 0) / fp.length, cz = fp.reduce((a, p) => a + p[1], 0) / fp.length;
    const e = [fp[1][0] - fp[0][0], fp[1][1] - fp[0][1]]; const el = Math.hypot(...e); const u = [e[0] / el, e[1] / el], v = [-u[1], u[0]];
    let hu = 0, hv = 0; for (const p of fp) { hu = Math.max(hu, Math.abs((p[0] - cx) * u[0] + (p[1] - cz) * u[1])); hv = Math.max(hv, Math.abs((p[0] - cx) * v[0] + (p[1] - cz) * v[1])); }
    hu = Math.min(hu, 5.2); hv = Math.min(hv, 5.2);
    const c = [cx, cz]; const H = (h) => G + h;
    // shaft with corner pilasters
    towerBox(T, c, u, v, hu, hv, H(0), H(56));
    for (const su of [-1, 1]) for (const sv of [-1, 1]) towerBox(T, [cx + u[0] * su * (hu - 0.6) + v[0] * sv * (hv - 0.6), cz + u[1] * su * (hu - 0.6) + v[1] * sv * (hv - 0.6)], u, v, 1.0, 1.0, H(0), H(57));
    towerBox(T, c, u, v, hu + 0.9, hv + 0.9, H(56), H(57.6)); // cornice under the clocks
    towerBox(T, c, u, v, hu - 0.2, hv - 0.2, H(57.6), H(67.5)); // clock stage
    for (const su of [-1, 1]) for (const sv of [-1, 1]) towerBox(T, [cx + u[0] * su * (hu - 0.5) + v[0] * sv * (hv - 0.5), cz + u[1] * su * (hu - 0.5) + v[1] * sv * (hv - 0.5)], u, v, 1.1, 1.1, H(57.6), H(68.5));
    towerBox(T, c, u, v, hu + 0.6, hv + 0.6, H(67.5), H(68.6)); // cornice above the clocks
    // corner finials
    for (const su of [-1, 1]) for (const sv of [-1, 1]) towerBox(T, [cx + u[0] * su * (hu - 0.3) + v[0] * sv * (hv - 0.3), cz + u[1] * su * (hu - 0.3) + v[1] * sv * (hv - 0.3)], u, v, 0.45, 0.45, H(68.6), H(71.2));
    // belfry stage (open arches suggested by recessed core + columns), ogee cap, lantern
    towerBox(T, c, u, v, hu - 2.6, hv - 2.6, H(68.6), H(75));
    for (const su of [-1, 1]) for (const sv of [-1, 1]) towerBox(T, [cx + u[0] * su * (hu - 2.3) + v[0] * sv * (hv - 2.3), cz + u[1] * su * (hu - 2.3) + v[1] * sv * (hv - 2.3)], u, v, 0.7, 0.7, H(68.6), H(75));
    towerBox(T, c, u, v, hu - 1.9, hv - 1.9, H(75), H(76));
    const steps = [[hu - 2.0, 76, 77.5], [hu - 2.5, 77.5, 78.8], [hu - 3.1, 78.8, 79.9], [hu - 3.7, 79.9, 80.8], [hu - 4.2, 80.8, 82.0]];
    for (const [hh, y0, y1] of steps) towerBox(R, c, u, v, Math.max(hh, 0.6), Math.max(hh, 0.6), H(y0), H(y1), 4);
    towerBox(DK, c, u, v, 0.35, 0.35, H(82), H(TOWER_TOP)); // flagpole/finial
    // clock faces (4), 4.6 m diameter discs with hands
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [u[0] * du + v[0] * dv, u[1] * du + v[1] * dv]; const off = du ? hu - 0.1 : hv - 0.1;
      const t = [n[1], -n[0]];
      const centre = V(cx + n[0] * (off + 0.12), H(62.5), cz + n[1] * (off + 0.12));
      const disc = new THREE.CircleGeometry(2.6, 32);
      const m4 = new THREE.Matrix4().makeBasis(V(t[0], 0, t[1]), Y_, V(n[0], 0, n[1])).setPosition(centre);
      CF.addGeometry(disc, m4);
      // hands (10:08 look) & rim
      const hand = (ang, len, w) => { const d = V(Math.sin(ang) * t[0], Math.cos(ang), Math.sin(ang) * t[1]); DK.beam(centre.clone().addScaledVector(V(n[0], 0, n[1]), 0.06), centre.clone().addScaledVector(d, len).addScaledVector(V(n[0], 0, n[1]), 0.06), w, 0.05, V(n[0], 0, n[1]), 1); };
      hand(-0.6, 1.3, 0.22); hand(0.9, 1.9, 0.14);
      for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; const p0 = centre.clone().addScaledVector(V(t[0], 0, t[1]), Math.cos(a) * 2.35).add(V(0, Math.sin(a) * 2.35, 0)); const a2 = (k + 1) / 12 * Math.PI * 2; const p1 = centre.clone().addScaledVector(V(t[0], 0, t[1]), Math.cos(a2) * 2.35).add(V(0, Math.sin(a2) * 2.35, 0)); T.beam(p0, p1, 0.35, 0.3, V(n[0], 0, n[1]), 2); }
    }
  }

  const g = new THREE.Group(); g.name = 'Central Station';
  g.add(S.mesh(M.sand, 'Central sandstone'), T.mesh(M.plain, 'Central clock tower & cornices'), R.mesh(M.roof, 'Central roofs'), VB.mesh(M.vault, 'Central Grand Concourse roof'), CF.mesh(M.clock, 'Central clock faces'), DK.mesh(M.dark, 'Central ironwork'));
  return g;
}
export default build;
