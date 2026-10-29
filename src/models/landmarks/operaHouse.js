// Sydney Opera House (Utzon, 1973) — procedural model in world coordinates.
//
// * Podium: OSM building relation 9596872 footprint; Monumental Steps on the south side.
// * Shell sets: positions/orientations read off the OSM roof building:part relations
//   (9596873..9677509): Concert Hall (west), Joan Sutherland Theatre (east), Bennelong restaurant.
// * Every shell half is a spherical triangle cut from a sphere of radius 75.2 m (Utzon's
//   "spherical solution"); mirrored halves meet along a ridge that is the intersection circle of the
//   two spheres. Highest shell (Concert Hall A2) 67.4 m above sea level.
// * Tiles: chevron "lids" of glossy white and matte cream tiles (CanvasTexture); bronze glass walls.
import * as THREE from 'three';
import { project } from '../../geo.js';
import D from './data/operaHouse.json';
import { GeoBuilder, V, Y_, canvasTexture, stdMat, nightLit, rng, speckle, blotches } from './util.js';

const R_SPHERE = 75.2;
const PODIUM = 14.5;      // podium terrace level (m AMSL)
const GROUND = 3.0;       // forecourt / Bennelong Point quay level
const XZ = ([lat, lon]) => { const p = project(lat, lon); return new THREE.Vector2(p.x, p.z); };

// shell definitions per hall: dir +1 = opening faces "forward" (harbour/north), -1 = faces back (south)
// d0 = pedestal distance from hall origin, dc/wc = lower corner distance / half width, dt/ht = tip distance / height AMSL
const HALLS = {
  concert: [
    { dir: 1, d0: 0, dc: 27, wc: 26.5, dt: 43, ht: 67.4 },  // A2 (highest)
    { dir: 1, d0: 8, dc: 48, wc: 27.5, dt: 61, ht: 57.5 },  // A1-ish
    { dir: 1, d0: 30, dc: 69, wc: 24.5, dt: 85, ht: 45.5 }, // front shell over the northern foyer
    { dir: -1, d0: 0, dc: 21, wc: 16.5, dt: 37, ht: 47.0 }, // south-facing (A3)
    { dir: -1, d0: 10, dc: 30, wc: 14.0, dt: 44, ht: 37.0 }, // south-facing small (A4)
  ],
  opera: [
    { dir: 1, d0: 0, dc: 23, wc: 22.5, dt: 36, ht: 60.5 },
    { dir: 1, d0: 7, dc: 39, wc: 23.5, dt: 49, ht: 52.0 },
    { dir: 1, d0: 25, dc: 56, wc: 21.0, dt: 69, ht: 42.0 },
    { dir: -1, d0: 0, dc: 16, wc: 14.0, dt: 27, ht: 42.0 },
    { dir: -1, d0: 8, dc: 23, wc: 11.5, dt: 33, ht: 33.0 },
  ],
  restaurant: [
    { dir: 1, d0: 0, dc: 9, wc: 10.5, dt: 15.4, ht: 29.5 },
    { dir: -1, d0: 0, dc: 13, wc: 11.5, dt: 26.8, ht: 33.5 },
  ],
};

// ------------------------------------------------------------------ textures / materials
function makeMaterials() {
  const tileTex = canvasTexture(256, 512, (c, w, h) => {
    // one rib segment wide (u 0..1), 4 m along (v): chevron lids of glossy white tiles framed by matte cream tiles
    c.fillStyle = '#efeadf'; c.fillRect(0, 0, w, h);
    const r = rng(77);
    // fine tile grid (≈12 cm tiles)
    for (let y = 0; y < h; y += 8) { c.fillStyle = 'rgba(150,140,120,0.10)'; c.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 8) { c.fillStyle = 'rgba(150,140,120,0.08)'; c.fillRect(x, 0, 1, h); }
    // chevrons (lids): two per 4 m
    for (let k = 0; k < 2; k++) {
      const y0 = k * h / 2; c.strokeStyle = 'rgba(190,180,160,0.85)'; c.lineWidth = 6;
      c.beginPath(); c.moveTo(4, y0 + 20); c.lineTo(w / 2, y0 + h / 2 - 20); c.lineTo(w - 4, y0 + 20); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.beginPath(); c.moveTo(14, y0 + 40); c.lineTo(w / 2, y0 + h / 2 - 40); c.lineTo(w - 14, y0 + 40); c.lineTo(w - 14, y0 + 10); c.lineTo(w / 2, y0 + h / 2 - 70); c.lineTo(14, y0 + 10); c.closePath(); c.fill();
    }
    // rib joints (matte cream band at the lid edges)
    c.fillStyle = 'rgba(205,195,172,0.95)'; c.fillRect(0, 0, 5, h); c.fillRect(w - 5, 0, 5, h);
    speckle(c, w, h, 2500, 0.06, false, 78, 1);
    for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(210,200,180,${0.15 * r()})`; c.fillRect(r() * w, r() * h, 8, 8); }
  });
  const podiumTex = canvasTexture(512, 512, (c, w, h) => {
    // 8 m tile: reconstituted pink granite panels with horizontal joints
    c.fillStyle = '#a88f7a'; c.fillRect(0, 0, w, h);
    const r = rng(88);
    for (let x = 0; x < w; x += 16) { const v = r(); c.fillStyle = `rgb(${176 + v * 10},${150 + v * 9},${128 + v * 8})`; c.fillRect(x + 2, 0, 12, h); c.fillStyle = 'rgba(70,55,45,0.25)'; c.fillRect(x, 0, 2, h); }
    for (let y = 0; y < h; y += 128) { c.fillStyle = 'rgba(60,45,35,0.35)'; c.fillRect(0, y, w, 3); }
    speckle(c, w, h, 16000, 0.10, false, 89, 1.2); speckle(c, w, h, 9000, 0.08, true, 90, 1);
    blotches(c, w, h, 25, 'rgba(80,60,50,A)', 80, 0.12, 91);
  });
  const shell = stdMat('Opera House shell tiles', { color: 0xffffff, map: tileTex, roughness: 0.32, metalness: 0.0, side: THREE.DoubleSide });
  nightLit(shell, 0xcfc8b8, 1);
  const podium = stdMat('Opera House podium granite', { color: 0xffffff, map: podiumTex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  nightLit(podium, 0x3a2a20, 1);
  const glass = stdMat('Opera House bronze glass', { color: 0x7a5534, roughness: 0.2, metalness: 0.55, side: THREE.DoubleSide });
  nightLit(glass, 0xffb766, 0.55);
  const rib = stdMat('Opera House shell ribs', { color: 0xd9d0bd, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
  nightLit(rib, 0x8c8678, 1);
  return { shell, podium, glass, rib };
}

// ------------------------------------------------------------------ geometry helpers
function sphereThrough(a, b, c, R, outward) {
  // circumcentre of triangle abc, then offset along the normal to get a sphere of radius R
  const ab = b.clone().sub(a), ac = c.clone().sub(a); const n = new THREE.Vector3().crossVectors(ab, ac);
  const n2 = n.lengthSq();
  const cc = a.clone().add(new THREE.Vector3().crossVectors(n, ab).multiplyScalar(ac.lengthSq()).add(new THREE.Vector3().crossVectors(ac, n).multiplyScalar(ab.lengthSq())).multiplyScalar(1 / (2 * n2)));
  const rho = cc.distanceTo(a); const RR = Math.max(R, rho * 1.04);
  const h = Math.sqrt(RR * RR - rho * rho); const nn = n.clone().normalize();
  let centre = cc.clone().addScaledVector(nn, h);
  if (centre.clone().sub(a.clone().add(b).add(c).multiplyScalar(1 / 3)).dot(outward) > 0) centre = cc.clone().addScaledVector(nn, -h);
  return { centre, R: RR };
}
const onSphere = (p, s) => p.clone().sub(s.centre).normalize().multiplyScalar(s.R).add(s.centre);
// great-circle arc between two sphere points (radial projection of the chord)
const gc = (a, b, t, s) => onSphere(a.clone().lerp(b, t), s);

function buildShell(SB, RB, GB, O, f, r, sh) {
  const dirv = new THREE.Vector3(f.x * sh.dir, 0, f.y * sh.dir);
  const right = new THREE.Vector3(r.x, 0, r.y);
  const P = (d, w, y) => new THREE.Vector3(O.x, y, O.y).addScaledVector(dirv, d).addScaledVector(right, w);
  const Pd = P(sh.d0, 0, PODIUM - 0.5), T = P(sh.dt, 0, sh.ht);
  const halves = [];
  for (const side of [-1, 1]) {
    const C = P(sh.dc, side * sh.wc, PODIUM + 0.2);
    const outward = new THREE.Vector3(0, 1, 0).addScaledVector(right, side * 0.9).addScaledVector(dirv, -0.35).normalize();
    halves.push({ side, C, S: sphereThrough(Pd, C, T, R_SPHERE, outward) });
  }
  // ridge: intersection circle of the two spheres lies in the symmetry plane (through Pd, T, vertical)
  const S0 = halves[0].S; const pn = right; // plane normal
  const cr = S0.centre.clone().addScaledVector(pn, -S0.centre.clone().sub(Pd).dot(pn)); // centre of ridge circle
  const rr = cr.distanceTo(Pd);
  const u0 = Pd.clone().sub(cr).normalize(), u1 = T.clone().sub(cr).normalize();
  const ang = Math.acos(Math.max(-1, Math.min(1, u0.dot(u1))));
  const ridge = (t) => { // slerp around cr from Pd to T
    const s = Math.sin(ang); if (s < 1e-6) return Pd.clone().lerp(T, t);
    const a = Math.sin((1 - t) * ang) / s, b = Math.sin(t * ang) / s;
    return cr.clone().add(u0.clone().multiplyScalar(a * rr).add(u1.clone().multiplyScalar(b * rr)));
  };
  const NF = 22, NR = 26;
  for (const hf of halves) {
    const { S, C } = hf;
    // front edge E(theta): theta 0 = tip T, 1 = corner C
    const E = (th) => gc(T, C, th, S);
    const frontLen = T.distanceTo(C);
    const nRibs = Math.max(4, Math.round(frontLen / 2.3));
    const grid = [];
    for (let i = 0; i <= NF; i++) {
      const th = i / NF; const row = [];
      const e = E(th);
      for (let j = 0; j <= NR; j++) {
        const rho = j / NR;
        let p = gc(Pd, e, rho, S);
        if (th < 1) { const g0 = gc(Pd, T, rho, S); const d = ridge(rho).sub(g0); p.addScaledVector(d, (1 - th) ** 2); p = onSphere(p, S); }
        if (i === 0) p = ridge(rho);
        row.push(p);
      }
      grid.push(row);
    }
    const ribLen = Pd.distanceTo(T);
    for (let i = 0; i < NF; i++) for (let j = 0; j < NR; j++) {
      const uv = (ii, jj) => [ii / NF * nRibs, jj / NR * ribLen / 4];
      SB.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1], uv(i, j), uv(i + 1, j), uv(i + 1, j + 1), uv(i, j + 1));
    }
    // thick rim along the front edge and the lower edge (visible concrete rib ends)
    const rim = []; for (let i = 0; i <= NF; i++) rim.push(grid[i][NR]);
    for (let i = 1; i < rim.length; i++) RB.beam(rim[i - 1], rim[i], 0.9, 0.9, Y_, 2);
    for (let j = 1; j <= NR; j++) RB.beam(grid[NF][j - 1], grid[NF][j], 0.7, 0.7, Y_, 2);
    // bronze glass wall filling the opening under the front edge, hung from the edge and folded back
    const base = (p) => { const q = new THREE.Vector3(p.x, PODIUM, p.z); const back = dirv.clone().multiplyScalar(-3.5); return q.add(back); };
    for (let i = 0; i < NF; i++) {
      const a = rim[i], b = rim[i + 1];
      if (a.y - PODIUM < 0.5 && b.y - PODIUM < 0.5) continue;
      const mid = (p) => { const q = base(p); return new THREE.Vector3((p.x + q.x) / 2 - dirv.x * 1.2, (p.y + q.y) / 2, (p.z + q.z) / 2 - dirv.z * 1.2); };
      GB.quad(a, b, mid(b), mid(a), [0, 0], [1, 0], [1, 1], [0, 1]);
      GB.quad(mid(a), mid(b), base(b), base(a), [0, 0], [1, 0], [1, 1], [0, 1]);
    }
    // mullions on the glass (vertical fins)
    for (let i = 0; i <= NF; i += 2) { const a = rim[i]; if (a.y - PODIUM > 2) GB.beam(a, base(a), 0.12, 0.3, dirv, 2); }
  }
  // ridge rib
  for (let j = 1; j <= NR; j++) RB.beam(ridge((j - 1) / NR), ridge(j / NR), 1.0, 1.0, Y_, 2);
}

// polygon clip (keep side where a*x + b*z + c >= 0)
function clip(poly, a, b, c) {
  const out = []; const f = (p) => a * p[0] + b * p[1] + c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]; const fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

export function build() {
  const mats = makeMaterials();
  const SB = new GeoBuilder(), RB = new GeoBuilder(), GB = new GeoBuilder(), PB = new GeoBuilder();

  // --- podium & Monumental Steps
  const fp = D.footprint.slice(0, -1).map((ll) => { const p = XZ(ll); return [p.x, p.y]; });
  const e0 = XZ(D.stepsEdge[0]), e1 = XZ(D.stepsEdge[1]);
  const eu = e1.clone().sub(e0).normalize(); const ev = new THREE.Vector2(eu.y, -eu.x); // ev points north (into the podium)
  const U = (p) => (p[0] - e0.x) * eu.x + (p[1] - e0.y) * eu.y, Vv = (p) => (p[0] - e0.x) * ev.x + (p[1] - e0.y) * ev.y;
  // half-plane helpers in (u,v)
  const keepV = (poly, v0, above) => clip(poly, (above ? 1 : -1) * ev.x, (above ? 1 : -1) * ev.y, (above ? -1 : 1) * (e0.x * ev.x + e0.y * ev.y + v0));
  const keepU = (poly, u0, above) => clip(poly, (above ? 1 : -1) * eu.x, (above ? 1 : -1) * eu.y, (above ? -1 : 1) * (e0.x * eu.x + e0.y * eu.y + u0));
  void U; void Vv;
  const STEPS_V = 44, STEPS_U0 = 36, STEPS_U1 = 86; // the steps occupy the south strip between the restaurant and the east wing
  const ext = (poly, y0, y1) => { if (poly.length >= 3) PB.prism(poly, y0, y1, null, 8, 1); };
  ext(keepV(fp, STEPS_V, true), GROUND - 1, PODIUM);
  const south = keepV(fp, STEPS_V, false);
  ext(keepU(south, STEPS_U0, false), GROUND - 1, PODIUM);
  ext(keepU(south, STEPS_U1, true), GROUND - 1, PODIUM);
  const mid = keepU(keepU(south, STEPS_U0, true), STEPS_U1, false);
  const nSteps = 34;
  for (let k = 0; k < nSteps; k++) {
    const v0 = STEPS_V * k / nSteps, v1 = STEPS_V * (k + 1) / nSteps; const y = GROUND + (PODIUM - GROUND) * (k + 1) / nSteps;
    ext(keepV(keepV(mid, v0, true), v1, false), GROUND - 1, y);
  }
  // podium parapet ledge & cantilevered concourse edge (a projecting band near the top)
  {
    const band = keepV(fp, STEPS_V - 0.5, true);
    if (band.length >= 3) {
      const c = band.reduce((a, p) => [a[0] + p[0] / band.length, a[1] + p[1] / band.length], [0, 0]);
      const grow = band.map((p) => { const dx = p[0] - c[0], dz = p[1] - c[1]; const l = Math.hypot(dx, dz); return [p[0] + dx / l * 1.2, p[1] + dz / l * 1.2]; });
      PB.prism(grow, PODIUM - 2.2, PODIUM + 0.6, null, 8, 3);
    }
  }

  // --- shells
  for (const [name, defs] of Object.entries(HALLS)) {
    const O = XZ(D.halls[name].O), tip = XZ(D.halls[name].tip);
    const f = tip.clone().sub(O).normalize(); const r = new THREE.Vector2(-f.y, f.x);
    for (const sh of defs) buildShell(SB, RB, GB, O, f, r, sh);
    // enclosed hall walls under the shells (stage towers / foyers), bronze glass
  }

  const g = new THREE.Group(); g.name = 'Sydney Opera House';
  g.add(SB.mesh(mats.shell, 'SOH shells'), RB.mesh(mats.rib, 'SOH shell ribs & mullions'), GB.mesh(mats.glass, 'SOH glass walls'), PB.mesh(mats.podium, 'SOH podium & steps'));
  return g;
}

export default build;
