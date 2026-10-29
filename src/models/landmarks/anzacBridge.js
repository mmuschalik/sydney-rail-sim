// ANZAC Bridge (1995) — cable-stayed, 345 m main span, 805 m long, two 120 m concrete pylons
// (inverted-Y: two legs flanking the deck merging into a single shaft), two inclined planes of stays
// anchored at the deck edges, 32.2 m wide deck carrying 8 lanes + shared path (north side).
// Alignment: OSM man_made=bridge way 378280632 (deck outline) and pylon positions read from
// imagery, projected onto the deck centreline.
import * as THREE from 'three';
import { project } from '../../geo.js';
import { GeoBuilder, V, Y_, canvasTexture, stdMat, nightLit, AxisFrame, speckle, blotches } from './util.js';

const PYLON_W = [-33.86869671, 151.18403326], PYLON_E = [-33.86962104, 151.18759657];
const DECK_HALF = 16.1, S_WEST = -414, S_EAST = 312; // deck extent relative to the main-span centre
const PYLON_H = 120, MAIN_HALF = 172.5;
const deckY = (s) => 32.5 - 1.19e-4 * s * s; // road surface, ~27 m navigation clearance at mid-span

export function build() {
  const W = project(...PYLON_W), E = project(...PYLON_E);
  const F = new AxisFrame((W.x + E.x) / 2, (W.z + E.z) / 2, E.x - W.x, E.z - W.z); // s: west -> east, t: south

  const concTex = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#c4bfb4'; c.fillRect(0, 0, w, h);
    blotches(c, w, h, 30, 'rgba(120,115,105,A)', 50, 0.25, 41); speckle(c, w, h, 6000, 0.1, false, 42);
    c.fillStyle = 'rgba(90,90,85,0.25)'; for (let y = 0; y < h; y += 64) c.fillRect(0, y, w, 2); // pour joints every 4 m
  });
  const roadTex = canvasTexture(512, 256, (c, w, h) => {
    // across: t -16.1..16.1 (u 0..1), along 24 m
    const X = (t) => (t + DECK_HALF) / (2 * DECK_HALF) * w; const M = w / (2 * DECK_HALF), MV = h / 24;
    c.fillStyle = '#4b4c4e'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#8f8d87'; c.fillRect(0, 0, X(-12.6), h); // shared path (north side, t < 0)
    speckle(c, w, h, 12000, 0.12, true, 43); speckle(c, w, h, 8000, 0.15, false, 44);
    c.fillStyle = '#e6e4da';
    const line = (t, dash) => { for (let y = 0; y < h; y += 12 * MV) c.fillRect(X(t) - 0.07 * M, y, 0.14 * M, (dash ? 3 : 12) * MV); };
    line(-11.9, false); line(-0.6, false); line(0.6, false); line(15.2, false);
    for (let k = 1; k < 4; k++) { line(-11.9 + k * 2.83, true); line(0.6 + k * 3.65, true); }
  });
  const concrete = stdMat('ANZAC Bridge concrete', { color: 0xffffff, map: concTex, roughness: 0.85, side: THREE.DoubleSide });
  nightLit(concrete, 0x6a6c74, 1);
  const road = stdMat('ANZAC Bridge deck surface', { color: 0xffffff, map: roadTex, roughness: 0.9 });
  const cable = stdMat('ANZAC Bridge stay cables', { color: 0x2b2d30, roughness: 0.45, metalness: 0.5 });
  const lamp = stdMat('ANZAC Bridge lamps', { color: 0x999990, roughness: 0.5 });
  nightLit(lamp, 0xffd8a0, 1.2);

  const C = new GeoBuilder(), R = new GeoBuilder(), K = new GeoBuilder(), L = new GeoBuilder();
  const P = (s, t, y) => V(t, y, -s);

  // deck: surface, edge beams, soffit (cast-in-situ concrete box)
  const frames = [];
  for (let s = S_WEST; s <= S_EAST + 0.01; s += 8) frames.push({ p: P(s, 0, deckY(s)), side: V(1, 0, 0), up: Y_, v: s });
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i]; const q = (f, t) => V(t, f.p.y + 0.01, f.p.z);
    R.quad(q(a, -DECK_HALF), q(a, DECK_HALF), q(b, DECK_HALF), q(b, -DECK_HALF), [0, a.v / 24], [1, a.v / 24], [1, b.v / 24], [0, b.v / 24]);
  }
  C.sweep(frames, [[-DECK_HALF, 0], [-DECK_HALF - 0.4, 0.9], [-DECK_HALF - 0.6, -1.2], [-DECK_HALF + 2.5, -3.2], [DECK_HALF - 2.5, -3.2], [DECK_HALF + 0.6, -1.2], [DECK_HALF + 0.4, 0.9], [DECK_HALF, 0]], false, 8);
  C.sweep(frames, [[-0.35, 0.95], [0.35, 0.95], [0.5, 0], [-0.5, 0]], true, 8); // median barrier
  C.sweep(frames, [[-12.7, 1.0], [-12.4, 1.0], [-12.4, 0], [-12.7, 0]], true, 8); // path barrier

  // pylons: two raked legs from the pile cap through the deck merging into one shaft at ~78 m
  for (const sp of [-MAIN_HALF, MAIN_HALF]) {
    const yd = deckY(sp); const merge = 80;
    for (const sg of [-1, 1]) {
      const footT = sg * 19.5, deckT = sg * 18.6, topT = sg * 1.6;
      // below deck (slightly splayed) and above deck (raked inwards)
      C.beam(P(sp, footT, -6), P(sp, deckT, yd - 1), 4.6, 6.5, V(0, 0, 1), 8);
      C.beam(P(sp, deckT, yd - 1.5), P(sp, topT, merge + 1), 4.0, 6.0, V(0, 0, 1), 8);
    }
    // cross beam under the deck and the single upper shaft (tapering) to 120 m
    C.beam(P(sp, -19, yd - 4.5), P(sp, 19, yd - 4.5), 4.0, 5.0, V(0, 0, 1), 8);
    C.box(V(0, (merge + PYLON_H) / 2, -sp), V(1, 0, 0), Y_, V(0, 0, 1), 3.4, (PYLON_H - merge) / 2, 3.6, 8);
    C.box(V(0, PYLON_H + 0.4, -sp), V(1, 0, 0), Y_, V(0, 0, 1), 3.0, 0.4, 3.2, 8);
    // pile caps
    for (const sg of [-1, 1]) C.box(V(sg * 19.5, -3, -sp), V(1, 0, 0), Y_, V(0, 0, 1), 6, 4, 7, 8);
    // flagpole + aviation light
    K.beam(V(0, PYLON_H + 0.8, -sp), V(0, PYLON_H + 11, -sp), 0.2, 0.2, V(0, 0, 1), 4);
    L.box(V(0, PYLON_H + 1.0, -sp - 2.8), V(1, 0, 0), Y_, V(0, 0, 1), 0.35, 0.35, 0.35, 1);
    // stay cables: 2 inclined planes x 2 directions x 16 cables (128 in total over both pylons)
    const nC = 16;
    for (const dir of [-1, 1]) for (let k = 0; k < nC; k++) {
      const yTop = 86 + k * (31 / (nC - 1));
      const sAnc = sp + dir * (14 + k * 9.6);
      for (const sg of [-1, 1]) {
        const top = P(sp + dir * 1.2, sg * 1.4, yTop);
        const bot = P(sAnc, sg * (DECK_HALF + 0.2), deckY(sAnc) + 0.6);
        K.beam(top, bot, 0.32, 0.32, V(0, 1, 0), 4, false);
      }
    }
  }
  // back-span and approach piers (pairs of slender columns)
  const piers = [-405, -365, -325, -285, -240, 225, 270];
  for (const s of piers) {
    const yd = deckY(s);
    for (const sg of [-1, 1]) C.box(V(sg * 8, (yd - 3.2 - 6) / 2, -s), V(1, 0, 0), Y_, V(0, 0, 1), 1.6, (yd - 3.2 + 6) / 2, 1.8, 8);
    C.box(V(0, yd - 4.2, -s), V(1, 0, 0), Y_, V(0, 0, 1), 12, 1.0, 1.8, 8);
  }
  // abutment walls
  for (const s of [S_WEST, S_EAST]) C.box(V(0, (deckY(s) - 4) / 2, -s), V(1, 0, 0), Y_, V(0, 0, 1), DECK_HALF + 0.5, (deckY(s) + 4) / 2, 2.5, 8);
  // lamp posts along the median every 40 m
  for (let s = S_WEST + 10; s < S_EAST; s += 40) {
    const y = deckY(s); C.beam(P(s, 0, y + 0.9), P(s, 0, y + 11), 0.25, 0.25, V(0, 0, 1), 4);
    for (const sg of [-1, 1]) { C.beam(P(s, 0, y + 11), P(s, sg * 2.5, y + 11.2), 0.15, 0.15, V(0, 0, 1), 4); L.box(P(s, sg * 2.6, y + 11), V(1, 0, 0), Y_, V(0, 0, 1), 0.5, 0.12, 0.25, 1); }
  }

  const g = new THREE.Group(); g.name = 'ANZAC Bridge';
  g.add(C.mesh(concrete, 'ANZAC concrete'), R.mesh(road, 'ANZAC deck surface'), K.mesh(cable, 'ANZAC stay cables'), L.mesh(lamp, 'ANZAC lamps'));
  F.applyTo(g);
  return g;
}
export default build;
