// Sydney Harbour Bridge (1932) — procedural model in world coordinates.
//
// Geometry sources
//  * Bridge axis / pylons: OSM building:part ways 142518160-63 (the four granite pylons).
//  * Rail alignment: OSM ways of the North Shore line (Down/Up Shore) from the Wynyard
//    tunnel portal to the Lavender St bridge north of Milsons Point (data/harbourBridge.json).
//  * North approach piers / abutment: OSM ways 156584778..815.
//  * Dimensions: arch span 503 m between bearing pins, 28 panels, top of arch 134 m AMSL,
//    truss depth 18 m at crown / 57 m at the ends, trusses 30 m (98 ft 6 in) apart, deck 48.8 m wide,
//    pylons 89 m AMSL, approach spans 5 x 170 ft each side (south outermost 238 ft),
//    deck grade 1 in 40 (south) / 1 in 39 (north), ~49 m shipping clearance at mid-span.
//
// Local frame: s = metres along the bridge axis (positive towards Milsons Point / north),
//              t = metres across (positive east). Model coords: X = t, Y = AMSL, Z = -s.
import * as THREE from 'three';
import { project } from '../../geo.js';
import D from './data/harbourBridge.json';
import { GeoBuilder, V, Y_, canvasTexture, stdMat, nightLit, AxisFrame, rng, speckle, blotches } from './util.js';

// ----------------------------------------------------------------------------- frame
const PS = project(D.pylonS[0], D.pylonS[1]);
const PN = project(D.pylonN[0], D.pylonN[1]);
const F = new AxisFrame((PS.x + PN.x) / 2, (PS.z + PN.z) / 2, PN.x - PS.x, PN.z - PS.z);
const PYLON_HALF_SEP = Math.hypot(PN.x - PS.x, PN.z - PS.z) / 2; // ~283.8 m

// ----------------------------------------------------------------------------- dimensions
const SPAN = 503, HALF = SPAN / 2, PANELS = 28, PANEL = SPAN / PANELS;
const TRUSS_T = 15;           // arch truss planes at t = +-15 m (30 m apart)
const DECK_HALF = 24.4;       // 48.8 m deck
const BEARING_Y = 8;          // arch hinge pins (m AMSL)
const LOWER_CROWN = 115;      // lower chord centreline at crown
const UPPER_CROWN = 132.6;    // upper chord centreline at crown (top of steel ~134 m)
const UPPER_END = 65;         // upper chord at the end posts (57 m truss depth)
const PYLON_S0 = PYLON_HALF_SEP - 12.6, PYLON_S1 = PYLON_HALF_SEP + 12.6; // pylon footprint along axis
const PYLON_T0 = 15.3, PYLON_T1 = 25.5;  // pylon footprint across (each side)
const PYLON_TOP = 89;
const TRACKBED_DEPTH = 0.35;  // deck/trackbed surface is this far below top of rail

// ----------------------------------------------------------------------------- vertical alignment (top of rail)
const RAIL_CREST = 54.0;            // m AMSL at crest of the vertical curve (centre of arch span)
const G_S = 1 / 40, G_N = 1 / 39;   // approach grades (falling away from the arch)
const VC_K = (G_S + G_N) / (2 * SPAN);
const VC_SC = -HALF + G_S / (2 * VC_K); // crest station (~ -3.2 m)
// North of the arch the 1 in 39 grade falls to ~40 m AMSL near Milsons Point station (where
// Burton St passes beneath) and the line then runs roughly level to the Lavender St underbridge,
// matching the ground level the line continues on towards North Sydney.
const NORTH_LEVEL = 40.0, NORTH_VC = 45;
const Y_BEARING_N = RAIL_CREST - VC_K * (HALF - VC_SC) ** 2;
const SIG_NORTH_LEVEL = HALF + (Y_BEARING_N - NORTH_LEVEL) / G_N;
function profile(sig) {
  if (sig < -HALF) return RAIL_CREST - VC_K * (-HALF - VC_SC) ** 2 + (sig + HALF) * G_S;
  if (sig > HALF) {
    if (sig < SIG_NORTH_LEVEL - NORTH_VC) return Y_BEARING_N - (sig - HALF) * G_N;
    if (sig > SIG_NORTH_LEVEL + NORTH_VC) return NORTH_LEVEL;
    return NORTH_LEVEL + G_N * (sig - (SIG_NORTH_LEVEL + NORTH_VC)) ** 2 / (4 * NORTH_VC);
  }
  return RAIL_CREST - VC_K * (sig - VC_SC) ** 2;
}
const deckY = (sig) => profile(sig) - TRACKBED_DEPTH;
const lowerY = (s) => BEARING_Y + (LOWER_CROWN - BEARING_Y) * (1 - (s / HALF) ** 2);
const upperY = (s) => UPPER_END + (UPPER_CROWN - UPPER_END) * (1 - (s / HALF) ** 2);

// ----------------------------------------------------------------------------- rail polylines (local s,t)
const toST = ([lat, lon]) => { const p = project(lat, lon); return F.toLocal(p.x, p.z); };
const DOWN = D.down.map(toST), UP = D.up.map(toST);

function nearestOn(pl, s, t) {
  let best = { d2: Infinity };
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1], b = pl[i]; const ds = b.s - a.s, dt = b.t - a.t; const L2 = ds * ds + dt * dt || 1e-9;
    let u = ((s - a.s) * ds + (t - a.t) * dt) / L2; u = Math.max(0, Math.min(1, u));
    const ps = a.s + ds * u, pt = a.t + dt * u; const d2 = (ps - s) ** 2 + (pt - t) ** 2;
    if (d2 < best.d2) best = { d2, i, u, s: ps, t: pt };
  }
  return best;
}
function resample(pl, step) {
  const out = [];
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1], b = pl[i]; const L = Math.hypot(b.s - a.s, b.t - a.t);
    for (let x = 0; x < L; x += step) out.push({ s: a.s + (b.s - a.s) * x / L, t: a.t + (b.t - a.t) * x / L });
  }
  out.push(pl[pl.length - 1]); return out;
}
// midline of the two tracks, smoothed, with arc-length station sigma (sigma = s at the arch centre)
const MID = (() => {
  const raw = resample(DOWN, 4).map((p) => { const q = nearestOn(UP, p.s, p.t); return { s: (p.s + q.s) / 2, t: (p.t + q.t) / 2, sep: Math.sqrt(q.d2) }; });
  const sm = raw.map((p, i) => {
    let s = 0, t = 0, sep = 0, n = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(raw.length - 1, i + 3); k++) { s += raw[k].s; t += raw[k].t; sep += raw[k].sep; n++; }
    return { s: s / n, t: t / n, sep: sep / n };
  });
  let acc = 0; sm[0].a = 0;
  for (let i = 1; i < sm.length; i++) { acc += Math.hypot(sm[i].s - sm[i - 1].s, sm[i].t - sm[i - 1].t); sm[i].a = acc; }
  let a0 = 0;
  for (let i = 1; i < sm.length; i++) if (sm[i - 1].s <= 0 && sm[i].s > 0) { const u = -sm[i - 1].s / (sm[i].s - sm[i - 1].s); a0 = sm[i - 1].a + u * (sm[i].a - sm[i - 1].a); }
  for (const p of sm) p.sig = p.a - a0;
  for (let i = 0; i < sm.length; i++) {
    const a = sm[Math.max(0, i - 1)], b = sm[Math.min(sm.length - 1, i + 1)]; const L = Math.hypot(b.s - a.s, b.t - a.t);
    sm[i].ds = (b.s - a.s) / L; sm[i].dt = (b.t - a.t) / L;
  }
  return sm;
})();
const SIG_START = MID[0].sig, SIG_END = MID[MID.length - 1].sig;
function midAt(sig) {
  let lo = 0, hi = MID.length - 1;
  if (sig <= MID[0].sig) return { ...MID[0] };
  if (sig >= MID[hi].sig) return { ...MID[hi] };
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (MID[m].sig < sig) lo = m; else hi = m; }
  const a = MID[lo], b = MID[hi], u = (sig - a.sig) / (b.sig - a.sig);
  const L = (k) => a[k] + (b[k] - a[k]) * u;
  return { s: L('s'), t: L('t'), sep: L('sep'), ds: L('ds'), dt: L('dt'), sig };
}
function sigmaOf(s, t) {
  const q = nearestOn(MID, s, t); const a = MID[q.i - 1], b = MID[q.i];
  return a.sig + (b.sig - a.sig) * q.u;
}
// track bounding box in local coords (for a fast reject)
const BB = (() => { let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity; for (const p of [...DOWN, ...UP]) { s0 = Math.min(s0, p.s); s1 = Math.max(s1, p.s); t0 = Math.min(t0, p.t); t1 = Math.max(t1, p.t); } return { s0: s0 - 6, s1: s1 + 6, t0: t0 - 6, t1: t1 + 6 }; })();

/**
 * Top-of-rail elevation (m AMSL) for a point on the North Shore line tracks on the Harbour Bridge,
 * its approach spans and approach viaducts (Wynyard tunnel portal -> Lavender St bridge north of
 * Milsons Point). Returns null when (x,z) is not within 4 m of either OSM track centreline in that range.
 */
export function harbourBridgeRailHeight(x, z) {
  const { s, t } = F.toLocal(x, z);
  if (s < BB.s0 || s > BB.s1 || t < BB.t0 || t > BB.t1) return null;
  const d = Math.min(nearestOn(DOWN, s, t).d2, nearestOn(UP, s, t).d2);
  if (d > 16) return null;
  const sig = sigmaOf(s, t);
  if (sig < SIG_START - 0.5 || sig > SIG_END + 0.5) return null;
  return profile(Math.max(SIG_START, Math.min(SIG_END, sig)));
}
const endInfo = (m) => { const w = F.toWorld(m.s, m.t); return { x: w.x, z: w.z, railY: profile(m.sig), grade: (profile(m.sig + 1) - profile(m.sig - 1)) / 2, sigma: m.sig }; };
export const HARBOUR_BRIDGE_RAIL = {
  crestRailY: RAIL_CREST, gradeSouth: G_S, gradeNorth: G_N, trackbedDepth: TRACKBED_DEPTH,
  southEnd: endInfo(MID[0]), northEnd: endInfo(MID[MID.length - 1]),
  railYAtPylons: profile(-HALF), // ~50.9 m
};

// ----------------------------------------------------------------------------- deck path (centreline of the 48.8 m deck)
const S_SOUTH_ABUT = -(PYLON_S1 + 4 * 51.82 + 72.54); // five south approach spans (4 x 170 ft + 238 ft)
const NORTH_ABUT = (() => { const pts = D.abutN.map(toST); const s = pts.reduce((a, p) => a + p.s, 0) / pts.length, t = pts.reduce((a, p) => a + p.t, 0) / pts.length; return { s, t }; })();
const SIG_NORTH_ABUT = sigmaOf(NORTH_ABUT.s, NORTH_ABUT.t) + 2; // deck reaches the abutment wall
const MID_OFFSET = 16; // deck centre is 16 m east of the track midline
function deckAt(sig) {
  // straight axis up to s = 290, offset midline beyond (north approach curves west)
  const m = midAt(sig);
  const cs = m.s + MID_OFFSET * (-m.dt), ct = m.t + MID_OFFSET * m.ds;
  const w = THREE.MathUtils.smoothstep(sig, 290, 335);
  const s = sig * (1 - w) + cs * w, t = ct * w;
  const ds = 1 * (1 - w) + m.ds * w, dt = m.dt * w; const L = Math.hypot(ds, dt);
  return { s, t, ds: ds / L, dt: dt / L, sig };
}
// local 3D point for path station sig, lateral offset off, elevation y
function P3(sig, off, y, path = deckAt) {
  const p = path(sig);
  return V(p.t + off * p.ds, y, -(p.s + off * -p.dt));
}
const railPath = (sig) => midAt(sig);

// ----------------------------------------------------------------------------- textures / materials
function makeMaterials() {
  const steelTex = canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = '#6f757a'; c.fillRect(0, 0, w, h);
    blotches(c, w, h, 60, 'rgba(90,96,100,A)', 70, 0.5, 11);
    blotches(c, w, h, 40, 'rgba(140,146,150,A)', 50, 0.35, 12);
    const r = rng(5);
    for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(40,42,44,${0.05 * r()})`; c.fillRect(r() * w, r() * h, 1 + 2 * r(), 30 + 120 * r()); }
    // plate seams and rivet rows (every 128 px = 2 m)
    for (let k = 0; k < 4; k++) {
      const y = k * 128 + 2; c.fillStyle = 'rgba(30,32,34,0.45)'; c.fillRect(0, y, w, 2);
      c.fillStyle = 'rgba(200,205,210,0.35)'; for (let x = 4; x < w; x += 8) { c.fillRect(x, y - 5, 2, 2); c.fillRect(x, y + 6, 2, 2); }
      const x = k * 128 + 64; c.fillStyle = 'rgba(30,32,34,0.35)'; c.fillRect(x, 0, 2, h);
      c.fillStyle = 'rgba(200,205,210,0.3)'; for (let y2 = 4; y2 < h; y2 += 8) { c.fillRect(x - 5, y2, 2, 2); c.fillRect(x + 6, y2, 2, 2); }
    }
    speckle(c, w, h, 4000, 0.12, true, 3); speckle(c, w, h, 4000, 0.15, false, 4);
  });
  const graniteTex = canvasTexture(512, 512, (c, w, h) => {
    // 8 m x 8 m: courses 0.9-1.2 m, ashlar blocks with rock-faced look
    c.fillStyle = '#8f8676'; c.fillRect(0, 0, w, h);
    const r = rng(21); let y = 0;
    while (y < h) {
      const ch = Math.min(h - y, 58 + Math.floor(r() * 18)); let x = -Math.floor(r() * 60);
      while (x < w) {
        const bw = 70 + Math.floor(r() * 90); const v = 176 + Math.floor(r() * 16);
        c.fillStyle = `rgb(${v},${v - 9},${v - 26})`; c.fillRect(x + 2, y + 2, bw - 3, ch - 3);
        const g = c.createLinearGradient(0, y, 0, y + ch); g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.14)');
        c.fillStyle = g; c.fillRect(x + 2, y + 2, bw - 3, ch - 3);
        x += bw;
      }
      y += ch;
    }
    speckle(c, w, h, 18000, 0.16, false, 22, 1.2); speckle(c, w, h, 12000, 0.12, true, 23, 1.2);
    blotches(c, w, h, 30, 'rgba(70,64,54,A)', 90, 0.18, 24);
    // run-off streaks
    for (let i = 0; i < 80; i++) { c.fillStyle = `rgba(50,48,44,${0.06 * r()})`; c.fillRect(r() * w, r() * h * 0.6, 3 + r() * 6, 60 + r() * 200); }
  });
  const masonryTex = canvasTexture(512, 512, (c, w, h) => {
    // sandstone/brick viaduct, 8 m tile, courses ~0.6 m
    c.fillStyle = '#7d7062'; c.fillRect(0, 0, w, h);
    const r = rng(31);
    for (let y = 0; y < h; y += 38) {
      let x = (y / 38) % 2 ? -40 : 0;
      while (x < w) { const bw = 70 + r() * 40; const v = r(); c.fillStyle = `rgb(${160 + v * 25},${140 + v * 22},${118 + v * 18})`; c.fillRect(x + 2, y + 2, bw - 3, 35); x += bw; }
    }
    blotches(c, w, h, 40, 'rgba(70,60,50,A)', 80, 0.35, 32); speckle(c, w, h, 9000, 0.15, false, 33);
  });
  const deckTex = canvasTexture(1024, 512, (c, w, h) => {
    // across: t = -24.4 .. +24.4 (u 0..1); along: 24 m per repeat
    const X = (t) => ((t + DECK_HALF) / (2 * DECK_HALF)) * w; const M = w / (2 * DECK_HALF); const MV = h / 24;
    const band = (t0, t1, col) => { c.fillStyle = col; c.fillRect(X(t0), 0, X(t1) - X(t0), h); };
    band(-24.4, 24.4, '#4a4b4d');
    band(-24.4, -22.0, '#8e8c86'); // cycleway
    band(-22.0, -10.0, '#3f3b37'); // trackbed: steel troughing / ballast, dark
    const r = rng(41);
    for (let i = 0; i < 9000; i++) { const v = 50 + r() * 50; c.fillStyle = `rgba(${v + 8},${v + 2},${v - 4},0.55)`; c.fillRect(X(-22) + r() * (X(-10) - X(-22)), r() * h, 2, 2); }
    for (let y = 0; y < h; y += 0.65 * MV) { c.fillStyle = `rgba(${60 + r() * 15},${50 + r() * 10},${42},0.55)`; c.fillRect(X(-21.6), y, X(-10.4) - X(-21.6), 0.22 * MV); }
    band(-10.0, 15.0, '#47484a'); band(15.0, 21.4, '#46474a'); band(21.4, 24.4, '#9a978f'); // roads + footway
    speckle(c, w, h, 30000, 0.12, true, 42, 1.2); speckle(c, w, h, 20000, 0.18, false, 43, 1.5);
    // lane lines main roadway: -9.4 .. 14.4, 6 lanes
    c.fillStyle = '#e8e6dc';
    const lane = (t, dash) => { for (let y = 0; y < h; y += 12 * MV) c.fillRect(X(t) - 0.07 * M, y, 0.14 * M, (dash ? 3 : 12) * MV); };
    lane(-9.2, false); lane(14.2, false);
    for (let k = 1; k < 6; k++) lane(-9.2 + k * (23.4 / 6), true);
    lane(15.8, false); lane(18.5, true); lane(21.2, false);
    c.fillStyle = 'rgba(30,30,30,0.25)'; for (let i = 0; i < 6; i++) c.fillRect(X(-9.2 + (i + 0.5) * 3.9) - 0.5 * M, 0, M, h); // tyre wear
  });
  deckTex.anisotropy = 16;

  const steel = stdMat('Harbour Bridge grey steel', { color: 0xc9ced2, map: steelTex, roughness: 0.62, metalness: 0.35, side: THREE.DoubleSide });
  nightLit(steel, 0x2e3a48, 1);
  const granite = stdMat('Harbour Bridge granite (Moruya)', { color: 0xe6e0d6, map: graniteTex, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
  nightLit(granite, 0x6a5232, 1);
  const deck = stdMat('Harbour Bridge deck surface', { color: 0xffffff, map: deckTex, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const masonry = stdMat('Harbour Bridge approach masonry', { color: 0xc8c0b4, map: masonryTex, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const lamps = stdMat('Harbour Bridge lamps', { color: 0x9a9a92, roughness: 0.4, metalness: 0 });
  nightLit(lamps, 0xffd28a, 1);
  const red = stdMat('Harbour Bridge aviation lights', { color: 0xaa2222, roughness: 0.4 });
  nightLit(red, 0xff2010, 1);
  return { steel, granite, deck, masonry, lamps, red };
}

// ----------------------------------------------------------------------------- builders
function buildArch(B) {
  const panelS = (i) => -HALF + i * PANEL;
  for (const sg of [-1, 1]) {
    const T = sg * TRUSS_T;
    // chords: sweep along panel points (polygonal like the real chords)
    const chord = (yf, w, hgt, y0 = 0) => {
      const frames = [];
      for (let i = 0; i <= PANELS; i++) {
        const s = panelS(i); const y = yf(s); const e = 0.5; const dy = (yf(s + e) - yf(s - e)) / (2 * e);
        const up = V(0, 1, dy).normalize();
        frames.push({ p: V(T, y + y0, -s), side: V(1, 0, 0), up, v: s });
      }
      B.sweep(frames, [[-w / 2, -hgt / 2], [w / 2, -hgt / 2], [w / 2, hgt / 2], [-w / 2, hgt / 2]], true, 8);
    };
    chord(lowerY, 3.2, 4.8);
    chord(upperY, 2.8, 3.3);
    // lower chord twin webs / upper chord top plates detail (slightly wider flanges)
    chord(lowerY, 3.4, 0.5, 2.0); chord(lowerY, 3.4, 0.5, -2.0);
    chord(upperY, 2.9, 0.4, 1.4);
    // verticals
    for (let i = 0; i <= PANELS; i++) {
      const s = panelS(i);
      if (i === 0 || i === PANELS) {
        // massive end posts from the bearing to the top of the chord
        // (kept slim across and offset outward so the Up Shore track envelope stays clear)
        B.beam(V(T + sg * 0.4, BEARING_Y - 2, -s), V(T + sg * 0.4, upperY(s) + 1.6, -s), 2.2, 4.2, V(0, 0, 1));
        continue;
      }
      B.beam(V(T, lowerY(s) + 2.0, -s), V(T, upperY(s) - 1.4, -s), 1.9, 1.9, V(0, 0, 1));
    }
    // diagonals: N-pattern, running from the upper chord at the outer panel point down to the
    // lower chord at the inner one (mirrored about the crown), as on the real trusses
    for (let j = 0; j < PANELS; j++) {
      const a = panelS(j), b = panelS(j + 1); const leftHalf = (a + b) / 2 < 0;
      const up0 = V(T, upperY(a) - 1.2, -a), lo0 = V(T, lowerY(a) + 1.8, -a), up1 = V(T, upperY(b) - 1.2, -b), lo1 = V(T, lowerY(b) + 1.8, -b);
      const [p0, p1] = leftHalf ? [up0, lo1] : [lo0, up1];
      B.beam(p0, p1, 1.6, 1.5, V(1, 0, 0));
      // secondary members subdividing the deep end panels
      const depth = upperY((a + b) / 2) - lowerY((a + b) / 2);
      if (depth > 28) {
        const m0 = p0.clone().lerp(p1, 0.5);
        const [q0, q1] = leftHalf ? [lo0, up1] : [up0, lo1];
        B.beam(m0, q0.clone().lerp(m0, 0.0), 0.7, 0.6, V(1, 0, 0));
        B.beam(m0, q1, 0.7, 0.6, V(1, 0, 0));
        const mv0 = lo0.clone().lerp(up0, 0.5), mv1 = lo1.clone().lerp(up1, 0.5);
        B.beam(mv0, m0, 0.6, 0.5, V(1, 0, 0)); B.beam(m0, mv1, 0.6, 0.5, V(1, 0, 0));
      }
    }
  }
  // lateral bracing between trusses: upper chord plane (struts + X) everywhere, lower chord plane
  // where it is clear of the deck traffic envelope, sway frames above the traffic envelope.
  for (let i = 0; i <= PANELS; i++) {
    const s = panelS(i); const yU = upperY(s), yL = lowerY(s), yd = deckY(s);
    B.beam(V(-TRUSS_T, yU, -s), V(TRUSS_T, yU, -s), 1.2, 1.8, V(0, 0, 1));
    const lowerClear = yL > yd + 7.5 || yL < yd - 7;
    if (lowerClear) B.beam(V(-TRUSS_T, yL, -s), V(TRUSS_T, yL, -s), 1.2, 2.2, V(0, 0, 1));
    const swayBot = Math.max(yL + 2, yd + 7.5), swayTop = yU - 1.5;
    if (swayTop - swayBot > 5 && i % 2 === 0 && i > 0 && i < PANELS) {
      B.beam(V(-TRUSS_T, swayBot, -s), V(TRUSS_T, swayTop, -s), 0.7, 0.6, V(0, 0, 1));
      B.beam(V(TRUSS_T, swayBot, -s), V(-TRUSS_T, swayTop, -s), 0.7, 0.6, V(0, 0, 1));
      B.beam(V(-TRUSS_T, swayBot, -s), V(TRUSS_T, swayBot, -s), 0.8, 0.9, V(0, 0, 1));
    }
    if (i < PANELS) {
      const s2 = panelS(i + 1);
      B.beam(V(-TRUSS_T, upperY(s), -s), V(TRUSS_T, upperY(s2), -s2), 0.7, 0.7);
      B.beam(V(TRUSS_T, upperY(s), -s), V(-TRUSS_T, upperY(s2), -s2), 0.7, 0.7);
      const yL2 = lowerY(s2), yd2 = deckY(s2);
      if (lowerClear && (yL2 > yd2 + 7.5 || yL2 < yd2 - 7)) {
        B.beam(V(-TRUSS_T, yL, -s), V(TRUSS_T, yL2, -s2), 0.8, 0.8);
        B.beam(V(TRUSS_T, yL, -s), V(-TRUSS_T, yL2, -s2), 0.8, 0.8);
      }
    }
  }
  // hangers from lower chord panel points to the deck cross girders
  for (let i = 1; i < PANELS; i++) {
    const s = panelS(i); const yL = lowerY(s) - 2.1, yd = deckY(s);
    if (yL - yd < 3) continue;
    for (const sg of [-1, 1]) B.beam(V(sg * TRUSS_T, yL, -s), V(sg * TRUSS_T, yd - 2.2, -s), 1.1, 0.75, V(0, 0, 1));
  }
}

// deck structure along the deck path between sigma a..b (steel part + surface)
function buildDeck(Bs, Bd, a, b, step = 6) {
  const frames = (off = 0) => {
    const f = []; const n = Math.max(2, Math.ceil((b - a) / step));
    for (let k = 0; k <= n; k++) {
      const sig = a + (b - a) * k / n; const p = deckAt(sig);
      f.push({ p: V(p.t, deckY(sig), -p.s), side: V(p.ds, 0, p.dt), up: V(0, 1, 0), v: sig });
    }
    return f;
  };
  const fr = frames();
  // deck surface (textured)
  for (let i = 1; i < fr.length; i++) {
    const f0 = fr[i - 1], f1 = fr[i];
    const P = (f, t) => V(f.p.x + f.side.x * t, f.p.y + 0.005, f.p.z + f.side.z * t);
    Bd.quad(P(f0, -DECK_HALF), P(f0, DECK_HALF), P(f1, DECK_HALF), P(f1, -DECK_HALF), [0, f0.v / 24], [1, f0.v / 24], [1, f1.v / 24], [0, f1.v / 24]);
  }
  // slab edges + soffit
  Bs.sweep(fr, [[-DECK_HALF, 0], [-DECK_HALF, -0.7], [DECK_HALF, -0.7], [DECK_HALF, 0]], false, 8);
  // stringers
  for (const t of [-22.5, -18, -14, -9, -4, 2, 8, 13, 18, 22.5]) Bs.sweep(fr, [[t - 0.3, -0.7], [t + 0.3, -0.7], [t + 0.3, -2.1], [t - 0.3, -2.1]], true, 8);
  // fascia girders at the deck edges
  for (const sg of [-1, 1]) Bs.sweep(fr, [[sg * DECK_HALF, 0.1], [sg * (DECK_HALF + 0.35), 0.1], [sg * (DECK_HALF + 0.35), -2.0], [sg * DECK_HALF, -2.0]], true, 8);
  // railings: outer parapets (posts + rails), cycleway fence, rail/road barrier, hanger-line kerb
  for (const sg of [-1, 1]) {
    Bs.sweep(fr, [[sg * (DECK_HALF - 0.15), 1.25], [sg * (DECK_HALF + 0.15), 1.25], [sg * (DECK_HALF + 0.15), 1.05], [sg * (DECK_HALF - 0.15), 1.05]], true, 8);
    Bs.sweep(fr, [[sg * (DECK_HALF - 0.1), 0.6], [sg * (DECK_HALF + 0.1), 0.6], [sg * (DECK_HALF + 0.1), 0.0], [sg * (DECK_HALF - 0.1), 0.0]], true, 8);
  }
  Bs.sweep(fr, [[-22.15, 2.2], [-21.95, 2.2], [-21.95, 2.0], [-22.15, 2.0]], true, 8); // cycleway safety fence top rail
  Bs.sweep(fr, [[-10.2, 1.1], [-9.8, 1.1], [-9.7, 0], [-10.3, 0]], true, 8); // rail / road barrier
  Bs.sweep(fr, [[14.6, 0.9], [15.4, 0.9], [15.5, 0], [14.5, 0]], true, 8); // eastern lanes barrier
  // posts every 3 m for parapets and the cycleway fence
  for (let sig = a; sig < b; sig += 3) {
    const p = deckAt(sig); const y = deckY(sig);
    for (const t of [-DECK_HALF, DECK_HALF]) { const c = P3(sig, t, y + 0.6); Bs.box(c, V(p.ds, 0, p.dt), Y_, V(-p.dt, 0, p.ds).multiplyScalar(-1), 0.08, 0.6, 0.08, 4, 63 - 12); }
    const c = P3(sig, -22.05, y + 1.1); Bs.box(c, V(p.ds, 0, p.dt), Y_, V(p.dt, 0, -p.ds), 0.06, 1.1, 0.06, 4, 63 - 12);
  }
}

function buildCrossGirders(B) {
  for (let i = 0; i <= PANELS; i++) {
    const s = -HALF + i * PANEL; const y = deckY(s);
    B.aabox(-DECK_HALF + 0.3, y - 5.2, -s - 0.5, DECK_HALF - 0.3, y - 2.1, -s + 0.5, 8);
    B.aabox(-DECK_HALF + 0.3, y - 5.4, -s - 0.9, DECK_HALF - 0.3, y - 5.1, -s + 0.9, 8); // bottom flange
    // bottom lateral bracing of the floor system
    if (i < PANELS) {
      const s2 = s + PANEL, y2 = deckY(s2);
      B.beam(V(-20, y - 2.3, -s), V(20, y2 - 2.3, -s2), 0.4, 0.4);
      B.beam(V(20, y - 2.3, -s), V(-20, y2 - 2.3, -s2), 0.4, 0.4);
    }
  }
}

// deck trusses (2 lines at +-15 m) for an approach span between sigma a and b
function buildApproachTruss(B, a, b) {
  const L = b - a; const n = Math.max(4, Math.round(L / 8.6)); const D = 9.0;
  const pt = (k, off, top) => { const sig = a + L * k / n; return P3(sig, off, deckY(sig) - (top ? 2.1 : 2.1 + D)); };
  for (const sg of [-1, 1]) {
    const off = sg * TRUSS_T;
    for (let k = 0; k < n; k++) {
      B.beam(pt(k, off, true), pt(k + 1, off, true), 1.4, 1.4);
      B.beam(pt(k, off, false), pt(k + 1, off, false), 1.4, 1.6);
      B.beam(k % 2 ? pt(k, off, true) : pt(k, off, false), k % 2 ? pt(k + 1, off, false) : pt(k + 1, off, true), 1.0, 0.9);
    }
    for (let k = 0; k <= n; k++) B.beam(pt(k, off, false), pt(k, off, true), 1.1, 0.9);
  }
  for (let k = 0; k <= n; k++) {
    B.beam(pt(k, -TRUSS_T, false), pt(k, TRUSS_T, false), 0.8, 0.9);
    if (k < n) { B.beam(pt(k, -TRUSS_T, false), pt(k + 1, TRUSS_T, false), 0.5, 0.5); B.beam(pt(k, TRUSS_T, false), pt(k + 1, -TRUSS_T, false), 0.5, 0.5); }
    if (k % 2 === 0) { B.beam(pt(k, -TRUSS_T, false), pt(k, TRUSS_T, true), 0.5, 0.5); B.beam(pt(k, TRUSS_T, false), pt(k, -TRUSS_T, true), 0.5, 0.5); }
    // floor beams carrying the stringers
    const sig = a + L * k / n; const p = deckAt(sig);
    const c = P3(sig, 0, deckY(sig) - 2.1 - 0.6);
    B.box(c, V(p.ds, 0, p.dt), Y_, V(p.dt, 0, -p.ds), DECK_HALF - 0.3, 0.6, 0.35, 8);
  }
}

// granite pier: two columns at +-15 at sigma (straight axis) or explicit positions
function buildPierColumn(G, s, t, ds, dt, yTop) {
  const ax = V(dt, 0, -ds).normalize(), az = V(ds, 0, dt).normalize();
  const x = t, z = -s;
  G.box(V(x, (-4 + yTop - 1.5) / 2, z), ax, Y_, az, 3.0, (yTop - 1.5 + 4) / 2, 3.2, 8); // shaft
  G.box(V(x, yTop - 0.75, z), ax, Y_, az, 3.5, 0.75, 3.7, 8); // cap
  G.box(V(x, 2, z), ax, Y_, az, 3.6, 6, 3.8, 8); // plinth
}

let WIN = null; // builder for dark window panels (set in build)
// a pylon (one of four). side = -1 (west) / +1 (east), end = -1 (south) / +1 (north)
function buildPylon(G, side, end) {
  const s0 = PYLON_S0 * end, s1 = PYLON_S1 * end; const sMin = Math.min(s0, s1), sMax = Math.max(s0, s1);
  const t0 = side * PYLON_T0, t1 = side * PYLON_T1; const tMin = Math.min(t0, t1), tMax = Math.max(t0, t1);
  const yd = deckY(end * PYLON_S1); // lowest deck level across the pylon (deck falls away from the arch)
  const tc = (tMin + tMax) / 2, sc = (sMin + sMax) / 2, hw = (tMax - tMin) / 2, hl = (sMax - sMin) / 2;
  // base tower below deck (wider), from below ground/water to deck soffit
  const bw = hw + 1.6, bl = hl + 1.6;
  G.aabox(tc - bw, -4, -(sc + bl), tc + bw, yd - 0.8, -(sc - bl), 8);
  // portal storey with arched passage along the axis (rail / cycleway or eastern lanes / footway)
  const portalTop = yd + 17;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0); shape.lineTo(hw, 0); shape.lineTo(hw, portalTop - yd + 0.8); shape.lineTo(-hw, portalTop - yd + 0.8); shape.closePath();
  const ow = hw - 1.0, spring = 9.5;
  const hole = new THREE.Path();
  hole.moveTo(-ow, 0.0001); hole.lineTo(ow, 0.0001); hole.lineTo(ow, spring); hole.absarc(0, spring, ow, 0, Math.PI, false); hole.lineTo(-ow, 0.0001);
  shape.holes.push(hole);
  const eg = new THREE.ExtrudeGeometry(shape, { depth: 2 * hl, bevelEnabled: false, curveSegments: 10 });
  const m = new THREE.Matrix4().makeTranslation(tc, yd - 0.8, -(sc - hl));
  // extrude goes +z; we want it from -(sc-hl) towards -(sc+hl): flip z
  m.multiply(new THREE.Matrix4().makeScale(1, 1, -1));
  // scale UVs of extrude (they are in metres already)
  const uv = eg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 8, uv.getY(i) / 8);
  G.addGeometry(eg, m);
  // shaft above the portal, slight taper, with pilaster corners
  const y0 = portalTop + 0.8, y1 = 80.5; const tp = 0.9;
  const poly = [[tMin, -sMin], [tMax, -sMin], [tMax, -sMax], [tMin, -sMax]];
  const shrink = (pl, d) => { const cx = tc, cz = -sc; return pl.map(([x, z]) => [cx + (x - cx) * (1 - d / hw), cz + (z - cz) * (1 - d / hl)]); };
  G.prism(poly, y0, y1, shrink(poly, tp), 8, 0);
  // string course at the portal top and at the cornice
  G.prism(shrink(poly, -0.5), portalTop, portalTop + 1.6, null, 8, 3);
  G.prism(shrink(poly, tp - 0.6), 80.5, 82.3, null, 8, 3);
  // stepped crown
  G.prism(shrink(poly, tp + 0.6), 82.3, 85.2, shrink(poly, tp + 1.0), 8, 3);
  G.prism(shrink(poly, tp + 2.6), 85.2, 87.3, shrink(poly, tp + 3.0), 8, 3);
  G.prism(shrink(poly, tp + 4.4), 87.3, PYLON_TOP, shrink(poly, tp + 5.0), 8, 3);
  // vertical recessed panels on the long faces (shallow projecting pilasters at corners)
  for (const f of [-1, 1]) {
    const tt = f < 0 ? tMin : tMax;
    for (const ss of [sMin + 1.6, sMax - 1.6]) G.aabox(tt - 0.5, y0, -ss - 1.6, tt + 0.5, 80.5, -ss + 1.6, 8);
  }
  for (const f of [-1, 1]) {
    const ss = f < 0 ? sMin : sMax;
    for (const tt of [tMin + 1.4, tMax - 1.4]) G.aabox(tt - 1.4, y0, -ss - 0.5, tt + 1.4, 80.5, -ss + 0.5, 8);
  }
  // arched lookout windows high on each face (dark glazing panels, slightly proud of the face)
  const win = (cx, cz, nx, nz, width) => {
    const sh = new THREE.Shape(); const hw2 = width / 2;
    sh.moveTo(-hw2, 0); sh.lineTo(hw2, 0); sh.lineTo(hw2, 6); sh.absarc(0, 6, hw2, 0, Math.PI, false); sh.lineTo(-hw2, 0);
    const sg = new THREE.ShapeGeometry(sh, 8);
    const m4 = new THREE.Matrix4().makeBasis(V(-nz, 0, nx), Y_, V(nx, 0, nz)).setPosition(cx, 70, cz);
    WIN.addGeometry(sg, m4);
  };
  const off = 0.06 - tp * (74 - y0) / (y1 - y0);
  win(tc, -sMin + off, 0, 1, 3.4); win(tc, -sMax - off, 0, -1, 3.4);
  win(tMin - off, -sc, -1, 0, 4.2); win(tMax + off, -sc, 1, 0, 4.2);
  // bearing seat block between the arch hinge and the pylon base
  const ta = side * (TRUSS_T - 4.5), tb = side * (TRUSS_T + 4.5);
  G.aabox(Math.min(ta, tb), -4, -(end * (HALF - 4)), Math.max(ta, tb), BEARING_Y - 2, -(end * (PYLON_S0 - 1)), 8);
}

// masonry rail viaduct along the track midline between sigma a..b
function buildRailViaduct(M, Dk, a, b, ground) {
  const step = 12;
  const n = Math.max(1, Math.round(Math.abs(b - a) / step));
  for (let k = 0; k < n; k++) {
    const s0 = a + (b - a) * k / n, s1 = a + (b - a) * (k + 1) / n;
    const m0 = midAt(s0), m1 = midAt(s1);
    const half = Math.max(m0.sep, m1.sep) / 2 + 2.6;
    const y0 = profile(s0) - TRACKBED_DEPTH, y1 = profile(s1) - TRACKBED_DEPTH;
    const g = Math.min(ground(s0), ground(s1));
    const yb = g - 3; const L = Math.hypot(m1.s - m0.s, m1.t - m0.t) + 0.3;
    // local 2D shape: x along segment, y up (relative to yb)
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(L, 0); shape.lineTo(L, y1 - yb); shape.lineTo(0, y0 - yb); shape.closePath();
    const clear = Math.min(y0, y1) - g;
    if (clear > 7.5) {
      const pw = 1.4, ow = (L - 2 * pw) / 2; const top = Math.min(y0, y1) - yb - 1.6; const spring = top - ow;
      if (spring > 1) {
        const hole = new THREE.Path(); hole.moveTo(pw, 0.5); hole.lineTo(L - pw, 0.5); hole.lineTo(L - pw, spring); hole.absarc(L / 2, spring, ow, 0, Math.PI, false); hole.lineTo(pw, 0.5);
        shape.holes.push(hole);
      }
    }
    if (y0 - yb < 0.5 && y1 - yb < 0.5) continue;
    const eg = new THREE.ExtrudeGeometry(shape, { depth: 2 * half, bevelEnabled: false, curveSegments: 8 });
    const uv = eg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 8, uv.getY(i) / 8);
    // basis: x -> along (local), y -> up, z -> lateral
    const ds = (m1.s - m0.s), dt = (m1.t - m0.t); const l = Math.hypot(ds, dt);
    const ex = V(dt / l, 0, -ds / l), ey = V(0, 1, 0);
    const right = { s: -dt / l, t: ds / l }; // right-hand normal in (s,t)
    const zAxis = V(right.t, 0, -right.s); // local 3D of +right
    const origin = V(m0.t - right.t * half - ex.x * 0.15, yb, -(m0.s - right.s * half) - ex.z * 0.15);
    const mat = new THREE.Matrix4().makeBasis(ex, ey, zAxis).setPosition(origin);
    M.addGeometry(eg, mat);
    // trackbed surface on top
    const P = (m, off, y) => V(m.t + right.t * off, y + 0.01, -(m.s + right.s * off));
    const u0 = (-22.0 + DECK_HALF) / (2 * DECK_HALF), u1 = (-10.0 + DECK_HALF) / (2 * DECK_HALF);
    Dk.quad(P(m0, -half, y0), P(m0, half, y0), P(m1, half, y1), P(m1, -half, y1), [u0, s0 / 24], [u1, s0 / 24], [u1, s1 / 24], [u0, s1 / 24]);
  }
}

// ground elevation along the rail midline (baked DEM samples; DSM so it includes some buildings)
function makeGround() {
  const pts = D.demDown.map(([lat, lon, h]) => { const p = toST([lat, lon]); return { sig: sigmaOf(p.s, p.t), h }; }).sort((a, b) => a.sig - b.sig);
  return (sig) => {
    if (sig <= pts[0].sig) return pts[0].h; if (sig >= pts[pts.length - 1].sig) return pts[pts.length - 1].h;
    let i = 1; while (pts[i].sig < sig) i++;
    const a = pts[i - 1], b = pts[i]; return a.h + (b.h - a.h) * (sig - a.sig) / (b.sig - a.sig || 1);
  };
}

export function build() {
  const mats = makeMaterials();
  const steel = new GeoBuilder(), granite = new GeoBuilder(), deck = new GeoBuilder(), masonry = new GeoBuilder(), lamps = new GeoBuilder(), red = new GeoBuilder();

  buildArch(steel);
  buildCrossGirders(steel);
  // deck: south abutment -> north abutment
  buildDeck(steel, deck, S_SOUTH_ABUT, SIG_NORTH_ABUT, 6);

  // south approach spans and piers (straight)
  const southSup = [-PYLON_S1, -PYLON_S1 - 51.82, -PYLON_S1 - 2 * 51.82, -PYLON_S1 - 3 * 51.82, -PYLON_S1 - 4 * 51.82, S_SOUTH_ABUT];
  for (let i = 1; i < southSup.length; i++) buildApproachTruss(steel, southSup[i], southSup[i - 1]);
  for (let i = 1; i < southSup.length - 1; i++) for (const sg of [-1, 1]) buildPierColumn(granite, southSup[i], sg * TRUSS_T, 1, 0, deckY(southSup[i]) - 11.1);
  // south abutment wall
  { const y = deckY(S_SOUTH_ABUT); granite.aabox(-DECK_HALF - 1, -4, -(S_SOUTH_ABUT) - 0, DECK_HALF + 1, y - 0.75, -(S_SOUTH_ABUT) + 7, 8); }

  // north approach: piers from OSM (pairs W/E)
  const pierPts = D.piersN.map(toST);
  const northSup = [PYLON_S1];
  for (let k = 0; k < pierPts.length; k += 2) {
    const w = pierPts[k], e = pierPts[k + 1];
    // station of the pier line: project pier-pair centre onto deck path by searching sigma
    let best = { d: Infinity, sig: 0 };
    for (let q = PYLON_S1; q < SIG_NORTH_ABUT + 20; q += 0.5) { const p = deckAt(q); const d = Math.hypot(p.s - (w.s + e.s) / 2, p.t - (w.t + e.t) / 2); if (d < best.d) best = { d, sig: q }; }
    northSup.push(best.sig);
    const p = deckAt(best.sig);
    for (const c of [w, e]) buildPierColumn(granite, c.s, c.t, p.ds, p.dt, deckY(best.sig) - 11.1);
  }
  northSup.push(SIG_NORTH_ABUT);
  for (let i = 1; i < northSup.length; i++) buildApproachTruss(steel, northSup[i - 1], northSup[i]);
  // north abutment wall (OSM footprint, extruded up to the deck)
  { const poly = D.abutN.slice(0, -1).map(toST).map((p) => [p.t, -p.s]); granite.prism(poly, -4, deckY(SIG_NORTH_ABUT) - 0.75, null, 8, 1); }

  // pylons
  WIN = steel;
  for (const end of [-1, 1]) for (const side of [-1, 1]) buildPylon(granite, side, end);
  // deck support between pylon bases / bearings (solid granite under the deck within the pylon zone)
  for (const end of [-1, 1]) { const y = deckY(end * PYLON_S1); granite.aabox(-PYLON_T0 + 0.5, y - 9, -(end * PYLON_S1), PYLON_T0 - 0.5, y - 0.75, -(end * (PYLON_S0 - 2)), 8); }

  // rail-only masonry approach viaducts (south: Rocks to the Wynyard tunnel portal; north: Milsons Point)
  const ground = makeGround();
  buildRailViaduct(masonry, deck, SIG_START, S_SOUTH_ABUT, ground);
  buildRailViaduct(masonry, deck, SIG_NORTH_ABUT - 1, SIG_END, ground);

  // lamps: road lighting along the hanger lines and deck edges, aviation lights on the arch & pylons
  for (let sig = S_SOUTH_ABUT + 10; sig < SIG_NORTH_ABUT - 5; sig += PANEL) {
    const y = deckY(sig);
    for (const off of [-9.9, 14.9, -DECK_HALF + 0.2, DECK_HALF - 0.2]) {
      const c = P3(sig, off, y + (Math.abs(off) > 20 ? 4.5 : 9.0));
      lamps.box(c, V(1, 0, 0), Y_, V(0, 0, 1), 0.3, 0.1, 0.3, 1);
      steel.beam(P3(sig, off, y), P3(sig, off, c.y - 0.2), 0.22, 0.22, V(0, 0, 1));
    }
  }
  for (const sg of [-1, 1]) {
    red.box(V(sg * TRUSS_T, UPPER_CROWN + 2.4, 0), V(1, 0, 0), Y_, V(0, 0, 1), 0.5, 0.5, 0.5, 1);
    for (const end of [-1, 1]) red.box(V(sg * (PYLON_T0 + PYLON_T1) / 2, PYLON_TOP + 0.5, -end * PYLON_HALF_SEP), V(1, 0, 0), Y_, V(0, 0, 1), 0.4, 0.5, 0.4, 1);
  }
  // flag masts on the crown (two flags fly on top of the arch)
  for (const s of [-10, 10]) { steel.beam(V(0, UPPER_CROWN + 1.5, -s), V(0, UPPER_CROWN + 14, -s), 0.25, 0.25, V(0, 0, 1)); }

  const g = new THREE.Group(); g.name = 'Sydney Harbour Bridge';
  g.add(steel.mesh(mats.steel, 'SHB steelwork'), granite.mesh(mats.granite, 'SHB granite pylons & piers'), deck.mesh(mats.deck, 'SHB deck & trackbed'), masonry.mesh(mats.masonry, 'SHB approach viaducts'), lamps.mesh(mats.lamps, 'SHB lamps'), red.mesh(mats.red, 'SHB aviation lights'));
  F.applyTo(g);
  g.userData.railHeight = harbourBridgeRailHeight;
  return g;
}

export default build;
