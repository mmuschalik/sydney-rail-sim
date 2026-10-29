// Sydney Metro Northwest "Skytrain" cable-stayed bridge over Windsor Road, Rouse Hill (2017).
// 270 m long, curved in plan, 135 m main span between two 45 m concrete pylons standing on the
// centreline between the tracks, single plane of stays (16 per pylon, modified fan), concrete
// segmental box-girder deck. Alignment: OSM Down/Up Sydney Metro Northwest ways tagged
// bridge:structure=cable-stayed (data/metroBridge.json); pylon positions from imagery.
import * as THREE from 'three';
import { project } from '../../geo.js';
import D from './data/metroBridge.json';
import { GeoBuilder, V, Y_, canvasTexture, stdMat, nightLit, speckle, blotches } from './util.js';

const MAIN_SPAN = 135, BACK_SPAN = 67.5, PYLON_ABOVE_DECK = 45;
const TRACKBED_DEPTH = 0.35;
const RAIL_WEST = 74.5, RAIL_EAST = 64.5; // top of rail at the ends of the cable-stayed section (m AMSL)

const XZ = ([lat, lon]) => { const p = project(lat, lon); return { x: p.x, z: p.z }; };
const DOWN = D.down.map(XZ), UP = D.up.map(XZ);

function nearestOn(pl, x, z) {
  let best = { d2: Infinity };
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1], b = pl[i]; const dx = b.x - a.x, dz = b.z - a.z; const L2 = dx * dx + dz * dz || 1e-9;
    let u = ((x - a.x) * dx + (z - a.z) * dz) / L2; u = Math.max(0, Math.min(1, u));
    const px = a.x + dx * u, pz = a.z + dz * u; const d2 = (px - x) ** 2 + (pz - z) ** 2;
    if (d2 < best.d2) best = { d2, i, u, x: px, z: pz };
  }
  return best;
}
// track midline with arc length sigma from the west end
const MID = (() => {
  const raw = [];
  for (let i = 1; i < DOWN.length; i++) {
    const a = DOWN[i - 1], b = DOWN[i]; const L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let t = 0; t < L; t += 3) { const p = { x: a.x + (b.x - a.x) * t / L, z: a.z + (b.z - a.z) * t / L }; const q = nearestOn(UP, p.x, p.z); raw.push({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, sep: Math.sqrt(q.d2) }); }
  }
  const sm = raw.map((p, i) => { let x = 0, z = 0, s = 0, n = 0; for (let k = Math.max(0, i - 3); k <= Math.min(raw.length - 1, i + 3); k++) { x += raw[k].x; z += raw[k].z; s += raw[k].sep; n++; } return { x: x / n, z: z / n, sep: s / n }; });
  let acc = 0; sm[0].sig = 0; for (let i = 1; i < sm.length; i++) { acc += Math.hypot(sm[i].x - sm[i - 1].x, sm[i].z - sm[i - 1].z); sm[i].sig = acc; }
  for (let i = 0; i < sm.length; i++) { const a = sm[Math.max(0, i - 1)], b = sm[Math.min(sm.length - 1, i + 1)]; const L = Math.hypot(b.x - a.x, b.z - a.z); sm[i].dx = (b.x - a.x) / L; sm[i].dz = (b.z - a.z) / L; }
  return sm;
})();
const LEN = MID[MID.length - 1].sig;
function midAt(sig) {
  if (sig <= 0) return MID[0]; if (sig >= LEN) return MID[MID.length - 1];
  let lo = 0, hi = MID.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (MID[m].sig < sig) lo = m; else hi = m; }
  const a = MID[lo], b = MID[hi], u = (sig - a.sig) / (b.sig - a.sig); const L = (k) => a[k] + (b[k] - a[k]) * u;
  return { x: L('x'), z: L('z'), sep: L('sep'), dx: L('dx'), dz: L('dz'), sig };
}
const sigmaOf = (x, z) => { const q = nearestOn(MID, x, z); return MID[q.i - 1].sig + (MID[q.i].sig - MID[q.i - 1].sig) * q.u; };
const profile = (sig) => RAIL_WEST + (RAIL_EAST - RAIL_WEST) * Math.max(0, Math.min(1, sig / LEN));
const deckY = (sig) => profile(sig) - TRACKBED_DEPTH;
// pylons (snapped to the midline, symmetric about their mean station, 135 m apart)
const PYL = (() => { const s = D.pylons.map((ll) => { const p = XZ(ll); return sigmaOf(p.x, p.z); }); const m = (s[0] + s[1]) / 2; return [m - MAIN_SPAN / 2, m + MAIN_SPAN / 2]; })();
const SIG0 = Math.max(0, PYL[0] - BACK_SPAN), SIG1 = Math.min(LEN, PYL[1] + BACK_SPAN);
const GROUND = (() => { const g = D.ground.map(([lat, lon, h]) => { const p = XZ([lat, lon]); return { sig: sigmaOf(p.x, p.z), h }; }).sort((a, b) => a.sig - b.sig); return (sig) => { if (sig <= g[0].sig) return g[0].h; for (let i = 1; i < g.length; i++) if (g[i].sig >= sig) { const a = g[i - 1], b = g[i]; return a.h + (b.h - a.h) * (sig - a.sig) / (b.sig - a.sig || 1); } return g[g.length - 1].h; }; })();

/** top-of-rail (m AMSL) on the cable-stayed bridge tracks, or null when not on it */
export function metroBridgeRailHeight(x, z) {
  const d = Math.min(nearestOn(DOWN, x, z).d2, nearestOn(UP, x, z).d2);
  if (d > 16) return null;
  const sig = sigmaOf(x, z);
  if (sig < SIG0 - 0.5 || sig > SIG1 + 0.5) return null;
  return profile(sig);
}
export const METRO_BRIDGE_RAIL = {
  trackbedDepth: TRACKBED_DEPTH, grade: (RAIL_EAST - RAIL_WEST) / LEN,
  westEnd: (() => { const m = midAt(SIG0); return { x: m.x, z: m.z, railY: profile(SIG0) }; })(),
  eastEnd: (() => { const m = midAt(SIG1); return { x: m.x, z: m.z, railY: profile(SIG1) }; })(),
};

export function build() {
  const concTex = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#cfcac0'; c.fillRect(0, 0, w, h);
    blotches(c, w, h, 25, 'rgba(120,115,105,A)', 50, 0.2, 61); speckle(c, w, h, 6000, 0.1, false, 62);
    c.fillStyle = 'rgba(100,96,90,0.3)'; for (let x = 0; x < w; x += 96) c.fillRect(x, 0, 2, h); // segment joints (~3 m)
  });
  const bedTex = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#6a6862'; c.fillRect(0, 0, w, h); speckle(c, w, h, 9000, 0.15, true, 63); speckle(c, w, h, 9000, 0.2, false, 64);
    c.fillStyle = 'rgba(40,40,40,0.35)'; for (let y = 0; y < h; y += 32) c.fillRect(0, y, w, 6);
  });
  const conc = stdMat('Metro bridge concrete', { color: 0xffffff, map: concTex, roughness: 0.85, side: THREE.DoubleSide });
  nightLit(conc, 0x5c6068, 1);
  const bed = stdMat('Metro bridge trackbed', { color: 0xffffff, map: bedTex, roughness: 0.95 });
  const cable = stdMat('Metro bridge stay cables', { color: 0xe8e8e4, roughness: 0.4, metalness: 0.4 });
  const lamp = stdMat('Metro bridge lights', { color: 0xaa2222, roughness: 0.5 });
  nightLit(lamp, 0xff2a1a, 1.2);
  const C = new GeoBuilder(), T = new GeoBuilder(), K = new GeoBuilder(), L = new GeoBuilder();
  const P3 = (m, off, y) => V(m.x + (-m.dz) * off, y, m.z + m.dx * off); // off > 0 = right of travel (west->east)

  // deck: segmental box girder following the curve
  const frames = []; const step = 3;
  for (let s = SIG0; s <= SIG1 + 0.01; s += step) { const m = midAt(Math.min(s, SIG1)); frames.push({ m, half: Math.max(6.6, m.sep / 2 + 2.6), y: deckY(s), s }); }
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    const q = (f, o, dy = 0) => P3(f.m, o * f.half, f.y + dy);
    T.quad(q(a, -1, 0.01), q(a, 1, 0.01), q(b, 1, 0.01), q(b, -1, 0.01), [0, a.s / 8], [2, a.s / 8], [2, b.s / 8], [0, b.s / 8]);
    // section: parapet walls, webs, soffit
    const sec = [[-1, 1.5, 0], [-1.03, 1.5, 0], [-1.05, -0.5, 0], [-0.75, -3.2, 0], [0.75, -3.2, 0], [1.05, -0.5, 0], [1.03, 1.5, 0], [1, 1.5, 0]];
    for (let k = 1; k < sec.length; k++) {
      const [o0, y0] = sec[k - 1], [o1, y1] = sec[k];
      const u0 = (k - 1) * 1.5, u1 = k * 1.5;
      C.quad(q(a, o0, y0), q(a, o1, y1), q(b, o1, y1), q(b, o0, y0), [u0, a.s / 8], [u1, a.s / 8], [u1, b.s / 8], [u0, b.s / 8]);
    }
    C.quad(q(a, -1, 1.5), q(a, -1, 0), q(b, -1, 0), q(b, -1, 1.5), [0, a.s / 8], [0.4, a.s / 8], [0.4, b.s / 8], [0, b.s / 8]);
    C.quad(q(a, 1, 1.5), q(a, 1, 0), q(b, 1, 0), q(b, 1, 1.5), [0, a.s / 8], [0.4, a.s / 8], [0.4, b.s / 8], [0, b.s / 8]);
  }
  // pylons, piers and stays
  for (const sp of PYL) {
    const m = midAt(sp), yd = deckY(sp), g = GROUND(sp) - 2;
    const along = V(m.dx, 0, m.dz), side = V(-m.dz, 0, m.dx);
    C.box(V(m.x, (g + yd - 3.2) / 2, m.z), along, Y_, side, 2.6, (yd - 3.2 - g) / 2, 3.4, 8); // pier
    // tapered mast (stacked frusta as boxes)
    const N = 8; for (let k = 0; k < N; k++) {
      const y0 = yd - 3.2 + (PYLON_ABOVE_DECK + 3.2) * k / N, y1 = yd - 3.2 + (PYLON_ABOVE_DECK + 3.2) * (k + 1) / N; const f = 1 - 0.45 * (k + 0.5) / N;
      C.box(V(m.x, (y0 + y1) / 2, m.z), along, Y_, side, 1.9 * f, (y1 - y0) / 2 + 0.02, 1.4 * f, 8);
    }
    L.box(V(m.x, yd + PYLON_ABOVE_DECK + 0.4, m.z), V(1, 0, 0), Y_, V(0, 0, 1), 0.3, 0.3, 0.3, 1);
    // 8 stays each side in one central plane (modified fan)
    for (const dir of [-1, 1]) for (let k = 0; k < 8; k++) {
      const top = V(m.x, yd + 27 + k * 2.2, m.z).addScaledVector(along, dir * 0.9);
      const sa = sp + dir * (10 + k * 7.6); const ma = midAt(sa);
      K.beam(top, V(ma.x, deckY(sa) + 0.8, ma.z), 0.22, 0.22, Y_, 4, false);
    }
  }
  // end piers of the cable-stayed unit and a pier in each back span
  for (const sp of [SIG0 + 1.5, (SIG0 + PYL[0]) / 2, (PYL[1] + SIG1) / 2, SIG1 - 1.5]) {
    const m = midAt(sp), yd = deckY(sp), g = GROUND(sp) - 2;
    C.box(V(m.x, (g + yd - 3.2) / 2, m.z), V(m.dx, 0, m.dz), Y_, V(-m.dz, 0, m.dx), 1.8, (yd - 3.2 - g) / 2, 2.6, 8);
  }

  const grp = new THREE.Group(); grp.name = 'Metro Northwest Windsor Rd cable-stayed bridge';
  grp.add(C.mesh(conc, 'Metro bridge concrete'), T.mesh(bed, 'Metro bridge trackbed'), K.mesh(cable, 'Metro bridge stays'), L.mesh(lamp, 'Metro bridge aviation lights'));
  return grp;
}
export default build;
