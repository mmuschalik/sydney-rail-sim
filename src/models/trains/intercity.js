// Procedural Three.js models of NSW intercity / metro / regional DMU fleets.
//
//   D   – NSW TrainLink "Mariyung" New Intercity Fleet (Hyundai Rotem), double-deck EMU
//   MET – Sydney Metro Alstom Metropolis (M1 Metro North West & Bankstown), driverless, single-deck
//   N   – NSW TrainLink Endeavour railcar (ABB/Adtranz Dandenong), 2-car DMU
//
// Coordinate contract: metres, car centred at origin, +X forward (cab of a lead car at +X),
// +Y up with y = 0 at top of rail, Z lateral. Wheels touch y = 0.
//
// Sources (accessed 2026-10):
//  D   – en.wikipedia.org/wiki/New_South_Wales_D_set: car length 20,435 mm (DD/DDA driving cars),
//        20,340 mm (DNL/DT/DN/DND), width 3,034 mm, height 4,402 mm, 2 plug doors per side per car,
//        design speed 160 km/h, service speed 130 km/h, acceleration 0.84 m/s², service braking
//        1.01 m/s² (emergency 1.10). 1500 V DC overhead, pantograph. Formations 4-car DD–DN–DND–DDA,
//        6-car DD–DNL–DT–DN–DND–DDA; 8 = 4+4, 10 = 6+4 coupled units.
//        Livery: silver/grey body, black window bands, orange doors, black cab mask with orange chin,
//        Aboriginal artwork panel behind cab. Ref photos: data/reference/trains/ref_D*.jpg
//  MET – en.wikipedia.org/wiki/Sydney_Metro_Metropolis_Stock: 20.25 m per car, width 3,035 mm,
//        height ~3.7 m, 3 double doors per side, 840 mm wheels, design 120 km/h (operated 100 km/h),
//        acceleration 1.2 m/s², service braking 1.1 m/s² (emergency 1.4), 6 cars TC–MPC–MC–MC–MPC–TC,
//        pantographs on MPC cars. Livery: brushed stainless, dark charcoal front with teal wrap,
//        teal cantrail line; from 2024 a teal stripe below the side windows. Ref: ref_MET*.jpg
//  N   – en.wikipedia.org/wiki/New_South_Wales_Endeavour_railcar: 25.25 m cars, width 2.92 m,
//        height 4.11 m (over roof equipment), 2 single-leaf plug doors per side per car,
//        design 160 km/h, service limit 145 km/h; Cummins KTA-19R 383 kW + Voith T311r hydraulic.
//        Livery: fluted stainless sides, blue window band, blue/yellow cab front (most of the fleet,
//        2026); 2801/2851 & 2802/2852 carry the orange/yellow "Xplorer-style" scheme (set
//        N_LIVERY = 'orange' to use it). Ref: ref_N*.jpg
//  Not published (engineering estimates, marked "est." below): bogie centres of all three classes,
//  Endeavour acceleration / braking, wheelbases, pantograph positions.
import * as THREE from 'three';
import { planPrism, Bucket, bodyShell, endCap, nose, facePatch, faceLamp, sideGlass, bogie, pantograph, box, beam, cylY, triCount, makeRing } from './ic_geom.js';
import { BodyAtlas, FrontAtlas, toTexture, brushed } from './ic_textures.js';

export let N_LIVERY = 'blue'; // 'blue' (majority of Endeavour fleet) | 'orange' (2801/2802 sets)
export function setEndeavourLivery(l) { N_LIVERY = l; delete KITS.N; CACHE.clear(); }

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
// cosine-interpolated piecewise curve through knots [[y, v], ...]
function curve(knots) {
  return (y) => {
    if (y <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) {
      const [y1, v1] = knots[i], [y0, v0] = knots[i - 1];
      if (y <= y1) {
        const t = (y - y0) / (y1 - y0);
        return v0 + (v1 - v0) * (1 - Math.cos(Math.PI * t)) / 2;
      }
    }
    return knots[knots.length - 1][1];
  };
}
function faceFn(tip, knots, bulge, halfW) {
  const back = curve(knots);
  return (y, z) => tip - back(y) - bulge * (z / halfW) ** 2;
}
// evenly spaced windows between a and b
function windowRow(a, b, n, w, y0, y1) {
  const pitch = (b - a) / n, out = [];
  for (let i = 0; i < n; i++) {
    const c = a + pitch * (i + 0.5);
    out.push({ x0: c - w / 2, x1: c + w / 2, y0, y1 });
  }
  return out;
}

// ===========================================================================
// Fleet definitions
// ===========================================================================
const DEFS = {};

// ---------------------------------------------------------------- D (Mariyung)
DEFS.D = {
  spec: { halfW: 1.517, yWaist: 1.7, yCant: 3.82, th: 0.07, H: 4.3, nS: 17, nR: 7, n: 3.0, zTop: 0.35, bev: 0.06, C: 6 },
  wheelR: 0.43, wheelbase: 2.5, bogieCentres: 14.6 /* est. */,
  gangway: { w: 1.25, y0: 1.05, y1: 3.15 },
  couplerY: 0.85,
  colors: { silver: '#b4b8bb', roof: '#9b9fa2', black: '#1a1c1e', orange: '#e5521d', glass: '#0a0f14', frame: '#2a2d30' },
  layout(v) {
    const lead = v === 'lead';
    const L = lead ? 20.435 : 20.34;
    const xr = -L / 2 + 0.3;
    const tip = L / 2 - 0.3;
    const xc = tip - 1.75;
    const xf = lead ? xc : L / 2 - 0.3;
    const wellA = -5.75, wellB = lead ? 2.3 : 5.75;
    const stations = [
      { x: xr, yb: 1.0 }, { x: wellA - 0.15, yb: 1.0 }, { x: wellA, yb: 0.35 },
      { x: wellB, yb: 0.35 }, { x: wellB + 0.15, yb: 1.0 }, { x: xf, yb: 1.0 },
    ];
    const doors = lead ? [-L / 2 + 2.75, 3.3] : [-L / 2 + 2.75, L / 2 - 2.75];
    const deckA = -5.5, deckB = lead ? 2.05 : 5.5;
    const nWin = lead ? 4 : 6;
    const upper = windowRow(deckA, deckB, nWin, 1.5, 2.6, 3.5);
    const lower = windowRow(deckA, deckB, nWin, 1.5, 1.0, 1.8);
    const vest = [{ x0: -L / 2 + 0.75, x1: -L / 2 + 1.55, y0: 1.95, y1: 2.85 }];
    if (!lead) vest.push({ x0: L / 2 - 1.55, x1: L / 2 - 0.75, y0: 1.95, y1: 2.85 });
    else vest.push({ x0: 4.6, x1: 5.65, y0: 1.95, y1: 2.9 }); // window in artwork panel
    const doorWins = [];
    for (const c of doors) doorWins.push({ x0: c - 0.68, x1: c - 0.2, y0: 1.95, y1: 2.95 }, { x0: c + 0.2, x1: c + 0.68, y0: 1.95, y1: 2.95 });
    return {
      L, xr, xf, xc, tip, stations, doors, upper, lower, vest, doorWins, deckA, deckB,
      glass: [...upper, ...lower, ...vest, ...doorWins],
      lowGlass: [{ x0: deckA, x1: deckB, y0: 2.6, y1: 3.5 }, { x0: deckA, x1: deckB, y0: 1.0, y1: 1.8 }],
      bogies: [-7.3, 7.3],
      pans: v === 'midPan' ? [-L / 2 + 2.9] : [],
      ac: v === 'midPan' ? [L / 2 - 2.6] : lead ? [-L / 2 + 2.6, 5.2] : [-L / 2 + 2.6, L / 2 - 2.6],
      acSize: [2.4, 0.11, 1.7],
      under: lead ? [[5.9, 1.8], [-8.9, 0.9]] : [[-8.9, 0.9], [8.9, 0.9]],
      underY: [0.55, 1.0],
      cabCrewDoor: tip - 3.3,
    };
  },
  face(lay) {
    return {
      xc: lay.xc,
      xFace: faceFn(lay.tip, [[0, 0], [1.3, 0.03], [2.3, 0.2], [3.75, 1.0], [4.3, 1.65]], 0.32, 1.517),
      inset: { rS: 0.24, rT: 0.25, rB: 0.03 }, steps: 5,
    };
  },
  pantoHead: 5.25, // raised head height (contact wire ~5.2 m nominal, est.)
  lamps: {
    head: [[3.79, 0.86, 0.055], [3.79, 1.0, 0.055]], // [y, |z|, r]
    tail: [[3.79, 1.13, 0.045]],
    low: { head: [3.79, 0.95], tail: [3.79, 1.12] },
  },
  skirt: { y0: 0.42, y1: 1.04, w: 2.8, col: '#a3a7aa', rc: 0.75, back: 0.08 },
  paintSide(p, lay, v) {
    const c = this.colors, { L } = lay, s = this.spec;
    const VM = 9;
    p.rect(-L / 2, L / 2, 0, VM, c.silver);
    brushed(p, -L / 2, L / 2, 0, s.yCant, 0.035);
    p.rect(-L / 2, L / 2, s.yCant + 0.1, VM, c.roof);
    // roof grilles / hatches
    for (const x of [-L / 2 + 2.6, L / 2 - 2.6, 0]) p.rect(x - 1.1, x + 1.1, s.yCant + 0.55, s.yCant + 0.9, '#6d7174');
    p.hlines(-L / 2, L / 2, s.yCant + 0.3, s.yCant + 1.4, 0.25, 'rgba(0,0,0,0.12)', 0.01);
    // bottom skirt shading
    p.vgrad(-L / 2, L / 2, 0.3, 0.6, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.25)']]);
    p.vgrad(-L / 2, L / 2, 1.0, 1.15, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.25)']]);
    // double-deck section: black bands
    p.rect(lay.deckA - 0.1, lay.deckB + 0.1, 2.48, 3.62, c.black);
    p.rect(lay.deckA - 0.1, lay.deckB + 0.1, 0.9, 1.9, c.black);
    for (const w of [...lay.upper, ...lay.lower]) p.rrect(w.x0 - 0.02, w.x1 + 0.02, w.y0 - 0.02, w.y1 + 0.02, 0.06, c.glass);
    // vestibule windows
    for (const w of lay.vest) p.rrect(w.x0 - 0.05, w.x1 + 0.05, w.y0 - 0.05, w.y1 + 0.05, 0.08, c.black);
    // passenger doors: orange plug doors
    for (const d of lay.doors) {
      p.rrect(d - 0.9, d + 0.9, 1.04, 3.16, 0.06, '#7d8184');
      p.rrect(d - 0.86, d + 0.86, 1.06, 3.14, 0.05, c.orange);
      p.rect(d - 0.012, d + 0.012, 1.06, 3.14, '#5a2310');
      for (const s2 of [-1, 1]) p.rrect(d + s2 * 0.44 - 0.27, d + s2 * 0.44 + 0.27, 1.92, 2.98, 0.05, '#101418');
      p.rect(d - 0.86, d + 0.86, 1.06, 1.12, '#e8c22a');
    }
    if (v === 'lead') {
      const xc = lay.xc, x2 = L / 2;
      // black cab mask wraps the side, orange chin band below it
      p.poly([[xc - 1.5, 4.02], [x2, 4.02], [x2, 2.3], [xc - 0.6, 2.3], [xc - 1.3, 3.0]], c.black);
      p.poly([[xc - 0.55, 2.28], [x2, 2.28], [x2, 1.28], [xc + 0.2, 1.28]], c.orange);
      p.poly([[xc - 0.62, 2.31], [x2, 2.31], [x2, 2.26], [xc - 0.55, 2.26]], '#f0f0f0');
      p.rrect(xc - 1.05, xc - 0.15, 2.45, 3.4, 0.08, '#1f2a33'); // cab side window
      // crew door
      const cd = lay.cabCrewDoor;
      p.rrect(cd - 0.38, cd + 0.38, 1.05, 3.15, 0.05, null, '#6f7376', 0.025);
      p.rrect(cd - 0.22, cd + 0.22, 2.2, 2.9, 0.04, '#141a20');
      p.text('Crew only', cd, 1.75, 0.07, '#333');
      // artwork panel (Mariyung = Darkinjung word for emu) + name
      p.poly([[4.3, 0.95], [6.05, 0.95], [6.05, 3.6], [5.4, 4.0], [4.3, 4.0]], '#121315');
      const ctx = p.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(235,235,235,0.85)';
      ctx.lineWidth = 0.025 * p.sx;
      for (let r = 0.05; r < 0.3; r += 0.06) { ctx.beginPath(); ctx.arc(p.X(5.1), p.Y(1.55), r * p.sx, 0, Math.PI * 2); ctx.stroke(); }
      for (let i = 0; i < 6; i++) { const yy = 3.2 + i * 0.08; ctx.beginPath(); ctx.moveTo(p.X(4.45), p.Y(yy)); ctx.quadraticCurveTo(p.X(5.0), p.Y(yy + 0.25), p.X(5.9), p.Y(yy - 0.1)); ctx.stroke(); }
      ctx.restore();
      for (let i = 0; i < 4; i++) p.poly([[5.55 + i * 0.1, 1.2 + i * 0.12], [5.62 + i * 0.1, 1.25 + i * 0.12], [5.55 + i * 0.1, 1.3 + i * 0.12]], '#eee');
      p.text('MARIYUNG', 5.15, 4.12, 0.13, '#1c1c1c');
      p.text('NSW TrainLink', 0.5 * (lay.deckA + lay.deckB), 2.2, 0.12, '#3a3d40', 'bold', undefined);
    } else {
      p.text('NSW TrainLink', 0, 2.2, 0.12, '#3a3d40');
    }
  },
  paintFront(p) {
    const c = this.colors, W = 1.8;
    p.rect(-W, W, 0, 5, c.silver);
    p.rect(-W, W, 1.28, 2.26, c.orange);
    p.rect(-W, W, 2.26, 2.31, '#f0f0f0');
    p.rect(-W, W, 2.31, 4.02, c.black);
    p.rect(-W, W, 4.02, 5, c.roof);
    // windscreen (two panes)
    p.ctx.save();
    p.rrect(-1.06, 1.06, 2.45, 3.58, 0.12, '#24303a');
    p.vgrad(-1.06, 1.06, 2.45, 3.58, [[0, 'rgba(160,190,210,0.35)'], [0.5, 'rgba(40,55,70,0.1)'], [1, 'rgba(0,0,0,0.2)']]);
    p.ctx.restore();
    p.rect(-0.03, 0.03, 2.45, 3.58, '#0c0d0e');
    p.line(-0.9, 2.5, -0.35, 3.05, '#050505', 0.025);
    p.line(0.15, 2.5, 0.7, 3.05, '#050505', 0.025);
    // destination display
    p.rect(-0.8, 0.8, 3.66, 3.93, '#050505');
    p.text('CENTRAL', 0, 3.795, 0.17, '#ffa21f');
    // lamp housings (dark recesses around the lamp meshes)
    for (const s of [-1, 1]) p.rrect(s > 0 ? 0.8 : -1.2, s > 0 ? 1.2 : -0.8, 3.7, 3.88, 0.05, '#070808');
    // lower front
    p.rect(-0.5, 0.5, 0.5, 1.05, '#26282a');
    p.text('D21', 0.95, 1.45, 0.1, '#ffffff');
    p.rect(-W, W, 1.26, 1.29, '#9a3a15');
  },
  lowYb: 0.7,
};

// ---------------------------------------------------------------- MET (Metropolis)
DEFS.MET = {
  spec: { halfW: 1.5175, yWaist: 1.4, yCant: 3.1, th: 0.1, H: 3.62, nS: 13, nR: 7, n: 3.4, zTop: 0.4, bev: 0.05, C: 6 },
  wheelR: 0.42, wheelbase: 2.2, bogieCentres: 14.3 /* est. */,
  gangway: { w: 1.65, y0: 1.0, y1: 3.15 },
  couplerY: 0.75,
  colors: { silver: '#c6cacd', roof: '#aeb2b5', charcoal: '#2b2f34', teal: '#11a2ad', glass: '#0b0f13', frame: '#2f3337' },
  layout(v) {
    const lead = v === 'lead';
    const L = 20.25;
    const xr = -L / 2 + 0.25, tip = L / 2 - 0.25, xc = tip - 1.15;
    const xf = lead ? xc : L / 2 - 0.25;
    const stations = [{ x: xr, yb: 0.95 }, { x: xf, yb: 0.95 }];
    const doors = lead ? [-6.9, -0.55, 5.8] : [-6.6, 0, 6.6];
    const wy0 = 1.72, wy1 = 2.84;
    const bays = [];
    const edges = [xr + 0.25, ...doors.flatMap((d) => [d - 0.95, d + 0.95]), lead ? xc - 0.3 : xf - 0.25];
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i], b = edges[i + 1], len = b - a;
      if (len > 3.2) bays.push(...windowRow(a, b, 2, len / 2 - 0.25, wy0, wy1));
      else bays.push({ x0: a, x1: b, y0: wy0, y1: wy1 });
    }
    const doorWins = [];
    for (const c of doors) doorWins.push({ x0: c - 0.6, x1: c - 0.12, y0: 1.62, y1: 2.84 }, { x0: c + 0.12, x1: c + 0.6, y0: 1.62, y1: 2.84 });
    return {
      L, xr, xf, xc, tip, stations, doors, bays, doorWins,
      glass: [...bays, ...doorWins],
      lowGlass: [{ x0: xr + 0.2, x1: xf - 0.2, y0: 1.7, y1: 2.84 }],
      bogies: [-7.15, 7.15],
      pans: v === 'midPan' ? [L / 2 - 3.0] : [],
      ac: v === 'midPan' ? [-5.6] : [-5.6, 5.6],
      acSize: [2.6, 0.08, 1.8],
      under: [[-3.6, 2.6], [-0.6, 1.6], [2.4, 2.8], [5.2, 1.0]],
      underY: [0.42, 0.95],
    };
  },
  face(lay) {
    return {
      xc: lay.xc,
      xFace: faceFn(lay.tip, [[0, 0], [1.0, 0.0], [3.0, 0.32], [3.62, 0.95]], 0.24, 1.5175),
      inset: { rS: 0.3, rT: 0.28, rB: 0.02 }, steps: 5,
    };
  },
  frontGlass: { z: 0.9, y0: 1.86, y1: 2.98 },
  pantoHead: 4.95, // est.
  lamps: {
    head: [[1.5, 0.92, 0.06], [1.5, 0.8, 0.045]],
    tail: [[1.68, 0.92, 0.045]],
    low: { head: [1.5, 0.88], tail: [1.68, 0.9] },
  },
  skirt: { y0: 0.34, y1: 0.97, w: 2.7, col: '#24272b', rc: 0.7, back: 0.12 },
  paintSide(p, lay, v) {
    const c = this.colors, { L } = lay, s = this.spec;
    p.rect(-L / 2, L / 2, 0, 9, c.silver);
    brushed(p, -L / 2, L / 2, 0, s.yCant, 0.05);
    p.rect(-L / 2, L / 2, s.yCant + 0.12, 9, c.roof);
    for (const x of [-5.6, 5.6, 0]) p.rect(x - 0.9, x + 0.9, s.yCant + 0.45, s.yCant + 0.7, '#7a7e82');
    p.vgrad(-L / 2, L / 2, 0.95, 1.12, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.3)']]);
    // teal cantrail line
    p.rect(-L / 2, L / 2, 3.0, 3.06, c.teal);
    // windows
    for (const w of lay.bays) p.rrect(w.x0 - 0.04, w.x1 + 0.04, w.y0 - 0.04, w.y1 + 0.04, 0.09, c.frame);
    for (const w of lay.bays) p.rrect(w.x0, w.x1, w.y0, w.y1, 0.07, c.glass);
    // 2024+ livery: teal stripe beneath the side windows (interrupted by doors)
    const ds = [...lay.doors].sort((a, b) => a - b);
    let a = -L / 2;
    for (const d of ds) { p.rect(a, d - 0.8, 1.52, 1.6, c.teal); a = d + 0.8; }
    p.rect(a, L / 2, 1.52, 1.6, c.teal);
    // doors
    for (const d of lay.doors) {
      p.rrect(d - 0.78, d + 0.78, 1.0, 3.02, 0.04, '#9da1a5');
      p.rrect(d - 0.74, d + 0.74, 1.02, 3.0, 0.04, '#cfd3d6');
      p.rect(d - 0.01, d + 0.01, 1.02, 3.0, '#55595d');
      for (const s2 of [-1, 1]) p.rrect(d + s2 * 0.36 - 0.25, d + s2 * 0.36 + 0.25, 1.6, 2.86, 0.05, c.glass);
      p.rect(d - 0.06, d + 0.06, 3.08, 3.14, '#d68a1a'); // door indicator
    }
    p.text('Sydney Metro', lay.doors[1] + 2.4, 1.32, 0.11, '#4a4f54');
    if (v === 'lead') {
      const xc = lay.xc, x2 = L / 2;
      p.rect(xc, x2, 0.9, 3.5, c.charcoal);
      p.poly([[xc - 0.02, 3.45], [x2, 3.45], [x2, 0.9], [xc - 0.6, 0.9], [xc - 0.32, 1.3], [xc - 0.1, 2.2]], c.teal);
    }
  },
  paintFront(p) {
    const c = this.colors, W = 1.8;
    p.rect(-W, W, 0, 5, c.charcoal);
    p.rect(-W, W, 3.48, 5, c.roof);
    // teal side wraps, broadening towards the lower corners
    for (const s of [-1, 1]) {
      const pts = [];
      for (let y = 0.9; y <= 3.5; y += 0.1) {
        const t = Math.min(1, Math.max(0, (y - 0.9) / 1.6));
        const e = 1.0 + 0.24 * (t * t * (3 - 2 * t));
        pts.push([s * e, y]);
      }
      pts.push([s * W, 3.5], [s * W, 0.9]);
      p.poly(pts, c.teal);
    }
    p.rrect(-0.94, 0.94, 1.82, 3.02, 0.1, '#0a0e12');
    p.rect(-0.62, 0.62, 3.1, 3.33, '#020304');
    p.text('TALLAWONG', 0, 3.215, 0.14, '#9cc8ff');
    for (const s of [-1, 1]) p.rrect(s > 0 ? 0.72 : -1.0, s > 0 ? 1.0 : -0.72, 1.38, 1.78, 0.04, '#0d0f11');
    p.text('NSW', -0.2, 1.56, 0.07, '#ffffff');
    p.text('Transport', 0.2, 1.56, 0.075, '#ffffff');
    p.rect(-0.5, 0.5, 0.3, 0.95, '#17191c');
  },
  lowYb: 0.95,
};

// ---------------------------------------------------------------- N (Endeavour)
DEFS.N = {
  spec: { halfW: 1.46, yWaist: 1.45, yCant: 3.25, th: 0.1, H: 3.92, nS: 14, nR: 7, n: 2.6, zTop: 0.35, bev: 0.06, C: 6 },
  wheelR: 0.42, wheelbase: 2.6, bogieCentres: 17.9 /* est. */,
  gangway: { w: 1.1, y0: 1.05, y1: 3.05 },
  couplerY: 0.85,
  colors() {
    return N_LIVERY === 'orange'
      ? { steel: '#c4c7c9', roof: '#a8acaf', band: '#e2552f', door: '#f2b51c', up: '#f4b232', mid: '#e9542a', low: '#141516', glass: '#0d1217' }
      : { steel: '#c4c7c9', roof: '#a8acaf', band: '#22317f', door: '#f0bd12', up: '#24327f', mid: '#f2c200', low: '#141516', glass: '#0d1217' };
  },
  layout() {
    const L = 25.25;
    const xr = -L / 2 + 0.3, tip = L / 2 - 0.3, xc = tip - 0.75;
    const stations = [{ x: xr, yb: 1.0 }, { x: xc, yb: 1.0 }];
    const doors = [tip - 3.1, -L / 2 + 1.45];
    const wins = windowRow(-L / 2 + 2.45, tip - 4.05, 11, 1.18, 1.9, 2.72);
    const cabWin = { x0: tip - 2.35, x1: tip - 1.35, y0: 1.95, y1: 2.78 };
    const doorWins = doors.map((d) => ({ x0: d - 0.22, x1: d + 0.22, y0: 1.92, y1: 2.75 }));
    return {
      L, xr, xf: xc, xc, tip, stations, doors, wins, cabWin, doorWins,
      glass: [...wins, ...doorWins],
      lowGlass: [{ x0: wins[0].x0, x1: wins[wins.length - 1].x1, y0: 1.9, y1: 2.72 }],
      bogies: [-8.95, 8.95],
      pans: [],
      ac: [-3.5], acSize: [3.0, 0.14, 1.7],
      under: [[-4.8, 2.2], [-1.4, 3.6], [2.6, 2.0], [5.2, 1.6]],
      underY: [0.5, 1.0],
    };
  },
  face(lay) {
    return {
      xc: lay.xc,
      xFace: faceFn(lay.tip, [[0, 0], [1.2, 0], [3.25, 0.2], [3.92, 0.62]], 0.14, 1.46),
      inset: { rS: 0.18, rT: 0.26, rB: 0.03 }, steps: 4,
    };
  },
  lamps: {
    head: [[3.385, 0.69, 0.085], [1.475, 0.36, 0.045]],
    tail: [[1.475, 0.54, 0.045]],
    low: { head: [3.385, 0.69], tail: [1.475, 0.54] },
  },
  skirt: { y0: 0.4, y1: 1.04, w: 2.75, col: '#141516', rc: 0.35, back: 0.06 },
  paintSide(p, lay) {
    const c = this.colors(), { L } = lay, s = this.spec;
    p.rect(-L / 2, L / 2, 0, 9, c.steel);
    // fluted stainless
    p.hlines(-L / 2, L / 2, 1.05, 1.72, 0.045, 'rgba(60,64,68,0.35)', 0.012);
    p.hlines(-L / 2, L / 2, 2.9, s.yCant, 0.045, 'rgba(60,64,68,0.3)', 0.012);
    p.rect(-L / 2, L / 2, s.yCant + 0.08, 9, c.roof);
    p.hlines(-L / 2, L / 2, s.yCant + 0.1, s.yCant + 1.4, 0.06, 'rgba(0,0,0,0.12)', 0.012);
    p.rect(-2.0, 2.2, s.yCant + 0.4, s.yCant + 0.75, '#4b4f53'); // radiator grilles on roof
    p.rect(-L / 2, L / 2, 1.0, 1.06, '#5d6164');
    // window band
    p.rect(-L / 2, L / 2, 1.74, 2.88, c.band);
    if (N_LIVERY === 'orange') p.rect(-L / 2, L / 2, 3.1, 3.16, c.band);
    for (const w of [...lay.wins, lay.cabWin]) p.rrect(w.x0, w.x1, w.y0, w.y1, 0.1, c.glass);
    for (const d of lay.doors) {
      p.rect(d - 0.5, d + 0.5, 1.06, 3.1, '#3b3e41');
      p.rrect(d - 0.47, d + 0.47, 1.08, 3.08, 0.04, c.door);
      p.rrect(d - 0.22, d + 0.22, 1.92, 2.75, 0.06, c.glass);
    }
    // cab-end livery wraps onto the side
    const xc = lay.xc, x2 = L / 2;
    p.rect(xc - 0.35, x2, 1.2, 1.78, c.mid);
    p.rect(xc - 0.35, x2, 1.78, 3.5, c.up);
    p.rect(xc - 0.35, x2, 1.0, 1.2, c.low);
    p.rrect(lay.cabWin.x0, lay.cabWin.x1, lay.cabWin.y0, lay.cabWin.y1, 0.1, c.glass);
    p.text('NSW TrainLink', -2, 1.45, 0.12, '#30343a');
  },
  paintFront(p) {
    const c = this.colors(), W = 1.8;
    p.rect(-W, W, 0, 5, c.up);
    if (N_LIVERY === 'orange') p.vgrad(-W, W, 1.2, 2.3, [[0, c.up], [1, c.mid]]);
    p.rect(-W, W, 1.2, 1.78, c.mid);
    p.rect(-W, W, 0, 1.2, c.low);
    p.rect(-W, W, 3.75, 5, c.roof);
    p.rrect(-1.02, 1.02, 2.08, 3.12, 0.16, '#0b0d10');
    p.rrect(-0.97, 0.97, 2.13, 3.07, 0.13, '#1c2731');
    p.vgrad(-0.97, 0.97, 2.13, 3.07, [[0, 'rgba(150,180,200,0.3)'], [1, 'rgba(0,0,0,0.15)']]);
    p.line(-0.6, 2.18, -0.15, 2.5, '#050505', 0.02);
    p.line(0.15, 2.18, 0.6, 2.5, '#050505', 0.02);
    p.rrect(-0.86, 0.86, 3.2, 3.57, 0.08, '#0d0f12');
    p.rect(-0.45, 0.45, 3.28, 3.5, '#030303');
    p.text(N_LIVERY === 'orange' ? '2801' : 'KIAMA', 0, 3.39, 0.13, '#ffb300');
    p.rrect(-0.68, 0.68, 1.36, 1.6, 0.05, '#0c0d0f');
    p.text(N_LIVERY === 'orange' ? '2801' : '2864', 0, 1.48, 0.15, '#ffffff');
  },
  lowYb: 1.0,
};
DEFS.N.colorsStatic = null;

// ===========================================================================
// Kits: shared materials & textures per fleet (lazy, module-level)
// ===========================================================================
const KITS = {};
const VARIANT_ROW = { lead: 0, mid: 1, midPan: 2 };

// Vertical interior-light gradient for window glass (uv.v: 0 = sill, 1 = top):
// dim seat backs at the bottom, bright ceiling light band at the top.
let _glow = null;
function interiorGlowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 64, 0, 0);
  g.addColorStop(0, '#3a3a3a');
  g.addColorStop(0.3, '#5a5a5a');
  g.addColorStop(0.38, '#b8b8b8');
  g.addColorStop(0.8, '#d0d0d0');
  g.addColorStop(1, '#ffffff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 64);
  _glow = toTexture(c);
  return _glow;
}

function vmaxOf(spec) {
  const r = makeRing(spec, 1.0);
  return Math.max(...r.map((p) => p.vLen)) + 0.05;
}

function kit(code) {
  if (KITS[code]) return KITS[code];
  const F = DEFS[code];
  const VMAX = vmaxOf(F.spec);
  const atlas = new BodyAtlas({ w: 2048, rows: code === 'N' ? 1 : 3, rowH: 512, VMAX });
  const rows = code === 'N' ? ['lead'] : ['lead', 'mid', 'midPan'];
  rows.forEach((v, r) => {
    const ctx = atlas.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, r * atlas.rowH, atlas.w, atlas.rowH);
    ctx.clip();
    F.paintSide.call(F, atlas.row(r, F.layout(v).L), F.layout(v), v);
    ctx.restore();
  });
  const colors = typeof F.colors === 'function' ? F.colors() : F.colors;
  const sw = {
    body: atlas.swatch(colors.silver || colors.steel),
    roof: atlas.swatch(colors.roof),
    dark: atlas.swatch('#2a2c2e'),
  };
  const W = F.spec.halfW * 2;
  const front = new FrontAtlas({ size: 1024, Wt: 3.6, Ht: F.spec.H + 0.1 });
  F.paintFront.call(F, front.painter());
  const fsw = { skirt: front.swatch(F.skirt.col), dark: front.swatch('#1b1c1e') };

  const isMetro = code === 'MET';
  const mats = {
    body: new THREE.MeshStandardMaterial({ name: 'body', map: toTexture(atlas.canvas), metalness: code === 'D' ? 0.3 : 0.55, roughness: code === 'D' ? 0.45 : 0.36 }),
    livery: new THREE.MeshStandardMaterial({ name: 'livery', map: toTexture(front.canvas), metalness: 0.15, roughness: 0.32 }),
    glass: new THREE.MeshStandardMaterial({
      name: 'glass', color: 0x0c1218, metalness: 0.1, roughness: 0.06,
      emissive: new THREE.Color(isMetro ? 0xdcebff : 0xffdcaa), emissiveIntensity: 0,
      emissiveMap: interiorGlowTexture(),
    }),
    dark: new THREE.MeshStandardMaterial({ name: 'dark', color: 0x232426, metalness: 0.35, roughness: 0.78 }),
    misc: new THREE.MeshStandardMaterial({ name: 'misc', color: 0x8b9094, metalness: 0.6, roughness: 0.45 }),
    headlight: new THREE.MeshStandardMaterial({ name: 'headlight', color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 1.0, roughness: 0.2 }),
    taillight: new THREE.MeshStandardMaterial({ name: 'taillight', color: 0x550000, emissive: 0xff1a0d, emissiveIntensity: 1.0, roughness: 0.3 }),
  };
  mats.glass.userData.nightEmissive = true;
  KITS[code] = { F, atlas, front, rows, sw, fsw, mats, VMAX, W };
  return KITS[code];
}

// ===========================================================================
// Car builders
// ===========================================================================
function buildHigh(code, v, B) {
  const K = kit(code), F = K.F, M = K.mats, s = F.spec;
  const lay = F.layout(v);
  const lead = v === 'lead';
  const row = code === 'N' ? 0 : VARIANT_ROW[v];
  const uvSide = K.atlas.uvFn(row, lay.L);

  // --- body shell, ends, nose
  B.add(M.body, bodyShell(s, lay.stations, uvSide));
  const st0 = lay.stations[0], st1 = lay.stations[lay.stations.length - 1];
  B.add(M.body, endCap(s, st0, -1, K.sw.body));
  if (lead) {
    const face = { ...F.face(lay), uvFn: K.front.uvFn() };
    for (const g of nose(s, st1.yb, face)) B.add(M.livery, g);
    // lamps
    for (const [y, z, r] of F.lamps.head) for (const sg of [1, -1]) B.add(M.headlight, faceLamp(face, y, sg * z, r, 12));
    for (const [y, z, r] of F.lamps.tail) for (const sg of [1, -1]) B.add(M.taillight, faceLamp(face, y, sg * z, r, 10));
    if (F.frontGlass) {
      const fg = F.frontGlass;
      B.add(M.glass, facePatch(face, -fg.z, fg.z, fg.y0, fg.y1, 6, 3, 0.01));
    }
    // skirt / obstacle deflector + coupler
    const sk = F.skirt, tip = lay.tip;
    B.add(M.livery, planPrism(lay.xc - 0.6, tip - (sk.back || 0.05), sk.w / 2, sk.rc || 0.5, sk.y0, sk.y1, K.fsw.skirt));
    B.add(M.dark, planPrism(lay.xc - 0.4, tip - (sk.back || 0.05) + 0.03, sk.w / 2 - 0.15, sk.rc || 0.5, sk.y0 - 0.06, sk.y0 + 0.12)); // deflector lip
    B.add(M.dark, box(0.55, 0.22, 0.32, tip + 0.05, F.couplerY, 0));
    B.add(M.misc, box(0.12, 0.3, 0.36, lay.L / 2 - 0.06, F.couplerY, 0));
  } else {
    B.add(M.body, endCap(s, st1, 1, K.sw.body));
  }
  // --- inter-car ends: gangway bellows + coupler
  const ends = lead ? [[lay.xr, -1]] : [[lay.xr, -1], [lay.xf, 1]];
  for (const [x, d] of ends) {
    const g = F.gangway, gl = lay.L / 2 - Math.abs(x);
    B.add(M.dark, box(gl, g.y1 - g.y0, g.w, x + (d * gl) / 2, (g.y0 + g.y1) / 2, 0));
    B.add(M.dark, box(gl + 0.02, 0.2, 0.3, x + (d * gl) / 2, F.couplerY, 0));
    // bellows folds
    for (let k = 1; k <= 3; k++) B.add(M.misc, box(0.02, g.y1 - g.y0 + 0.04, g.w + 0.04, x + d * (gl * k) / 4, (g.y0 + g.y1) / 2, 0));
  }
  // --- glass
  B.add(M.glass, sideGlass(s, lay.glass));
  if (code === 'N') B.add(M.glass, sideGlass(s, [lay.cabWin]));
  // --- running gear
  for (const x of lay.bogies) bogie(B, M, x, { wheelR: F.wheelR, wheelbase: F.wheelbase, high: true, frameZ: 0.98 });
  const [uy0, uy1] = lay.underY;
  let k = 0;
  for (const [x, len] of lay.under) {
    const h = (uy1 - uy0) * (k++ % 2 ? 0.8 : 1);
    B.add(M.dark, box(len, h, 2.2, x, uy1 - h / 2, 0));
    B.add(M.misc, box(len * 0.9, 0.04, 2.24, x, uy1 - h * 0.35, 0));
  }
  if (code === 'N') {
    // engine exhaust / radiator detail on roof, fuel tank
    B.add(M.dark, box(1.2, 0.12, 1.0, 2.0, s.H - 0.06, 0));
    B.add(M.dark, cylY(0.07, 0.3, 8, 3.0, s.H + 0.05, 0.3));
  }
  // --- roof gear
  for (const x of lay.ac) {
    const [ax, ah, az] = lay.acSize;
    B.add(M.body, box(ax, ah, az, x, s.H - 0.03 + ah / 2, 0, K.sw.roof));
    B.add(M.dark, box(ax * 0.6, 0.02, az * 0.7, x, s.H - 0.03 + ah + 0.01, 0));
  }
  for (const x of lay.pans) {
    const dir = x > 0 ? -1 : 1;
    pantograph(B, M, x, s.H - 0.05, F.pantoHead, { headW: 1.75, high: true, dir });
    // roof bus line towards the car centre
    B.add(M.misc, box(Math.abs(x) - 1.0, 0.05, 0.05, x / 2 + (x > 0 ? 0.5 : -0.5), s.H + 0.04, 0.3));
  }
  return lay;
}

function buildLow(code, v, B) {
  const K = kit(code), F = K.F, M = K.mats;
  const s = { ...F.spec, nS: 2, nR: 2, C: 1 };
  const lay = F.layout(v);
  const lead = v === 'lead';
  const row = code === 'N' ? 0 : VARIANT_ROW[v];
  const uvSide = K.atlas.uvFn(row, lay.L);
  const yb = F.lowYb;
  const st = [{ x: lay.xr, yb }, { x: lay.xf, yb }];
  B.add(M.body, bodyShell(s, st, uvSide));
  B.add(M.body, endCap(s, st[0], -1, K.sw.body));
  if (lead) {
    const face = { ...F.face(lay), steps: 1, uvFn: K.front.uvFn() };
    for (const g of nose(s, yb, face)) B.add(M.livery, g);
    const L = F.lamps.low;
    for (const sg of [1, -1]) {
      B.add(M.headlight, faceLamp(face, L.head[0], sg * L.head[1], 0.09, 4));
      B.add(M.taillight, faceLamp(face, L.tail[0], sg * L.tail[1], 0.07, 4));
    }
    if (F.frontGlass) {
      const fg = F.frontGlass;
      B.add(M.glass, facePatch(face, -fg.z, fg.z, fg.y0, fg.y1, 1, 1, 0.01));
    }
  } else {
    B.add(M.body, endCap(s, st[1], 1, K.sw.body));
  }
  B.add(M.glass, sideGlass(s, lay.lowGlass, 0.012, undefined, 1));
  for (const x of lay.bogies) B.add(M.dark, box(F.wheelbase + 0.9, F.wheelR * 2 + 0.1, 2.0, x, F.wheelR + 0.05, 0));
  const ux0 = lay.bogies[0] + F.wheelbase / 2 + 0.5, ux1 = lay.bogies[1] - F.wheelbase / 2 - 0.5;
  const [uy0, uy1] = lay.underY;
  const ylo = code === 'D' ? 0.35 : uy0;
  B.add(M.dark, box(ux1 - ux0, (code === 'D' ? 0.65 : uy1) - ylo, 2.3, (ux0 + ux1) / 2, ((code === 'D' ? 0.65 : uy1) + ylo) / 2, 0));
  for (const x of lay.pans) {
    pantograph(B, M, x, F.spec.H - 0.05, F.pantoHead, { high: false, dir: x > 0 ? -1 : 1 });
  }
}

const CACHE = new Map();

function buildCar(code, variant = 'mid', lod = 'high') {
  const F = DEFS[code];
  let v = variant === 'leadRev' ? 'lead' : variant;
  if (code === 'N') v = 'lead'; // every Endeavour car is a driving car
  if (!['lead', 'mid', 'midPan'].includes(v)) v = 'mid';
  const key = `${code}|${variant}|${lod}`;
  if (CACHE.has(key)) return CACHE.get(key).clone();
  const B = new Bucket();
  if (lod === 'low') buildLow(code, v, B);
  else buildHigh(code, v, B);
  const g = B.toGroup(`${code}-${variant}-${lod}`);
  if (variant === 'leadRev' || (code === 'N' && variant === 'mid')) {
    for (const m of g.children) { m.geometry.rotateY(Math.PI); m.geometry.computeBoundingSphere(); m.geometry.computeBoundingBox(); }
  }
  g.userData = { fleet: code, variant, lod, length: F.layout(v).L, triangles: triCount(g) };
  CACHE.set(key, g);
  return g.clone();
}

// ===========================================================================
// Public FLEETS
// ===========================================================================
// formation(): only 'lead' | 'mid' | 'midPan', plus 'leadRev' for a driving car that sits INSIDE a
// coupled consist with its cab facing backwards (-X). The runtime rotates only the LAST car of the
// array by 180° (which is always a plain 'lead'); a 'leadRev' car comes pre-rotated.
function dFormation(n) {
  const four = ['lead', 'midPan', 'mid', 'lead'];
  const six = ['lead', 'midPan', 'mid', 'midPan', 'mid', 'lead']; // DD–DNL–DT–DN–DND–DDA
  const unit = (u) => { const a = [...u]; a[a.length - 1] = 'leadRev'; return a; };
  if (n <= 4) return four;
  if (n <= 6) return six;
  if (n <= 8) return [...unit(four), ...four];
  return [...unit(six), ...four];
}
function metFormation(n = 6) {
  if (n <= 2) return ['lead', 'lead'];
  const mids = [];
  for (let i = 0; i < n - 2; i++) mids.push(i === 0 || i === n - 3 ? 'midPan' : 'mid');
  return ['lead', ...mids, 'lead'];
}
function nFormation(n = 2) {
  if (n <= 1) return ['lead'];
  const out = [];
  for (let u = 0; u < Math.ceil(n / 2); u++) out.push('lead', 'leadRev');
  out.length = n;
  out[n - 1] = 'lead';
  return out;
}

export const FLEETS = {
  D: {
    name: 'Mariyung', operator: 'NSW TrainLink', classDesc: 'D set (New Intercity Fleet), Hyundai Rotem double-deck EMU',
    carLength: 20.435, midCarLength: 20.34, bogieCentres: DEFS.D.bogieCentres, width: 3.034, height: 4.402,
    maxSpeedKmh: 130, designSpeedKmh: 160, accel: 0.84, decel: 1.01, emergencyDecel: 1.1,
    gauge: 1.435, electrification: '1500 V DC overhead', cars: [4, 6, 8, 10],
    formation: dFormation,
    build: (variant, lod) => buildCar('D', variant, lod),
  },
  MET: {
    name: 'Metropolis', operator: 'Sydney Metro', classDesc: 'Alstom Metropolis driverless single-deck EMU',
    carLength: 20.25, bogieCentres: DEFS.MET.bogieCentres, width: 3.035, height: 3.7,
    maxSpeedKmh: 100, designSpeedKmh: 120, accel: 1.2, decel: 1.1, emergencyDecel: 1.4,
    gauge: 1.435, electrification: '1500 V DC overhead', cars: [6], driverless: true,
    formation: metFormation,
    build: (variant, lod) => buildCar('MET', variant, lod),
  },
  N: {
    name: 'Endeavour', operator: 'NSW TrainLink', classDesc: 'Endeavour railcar diesel-hydraulic multiple unit (2-car)',
    carLength: 25.25, bogieCentres: DEFS.N.bogieCentres, width: 2.92, height: 4.11,
    maxSpeedKmh: 145, designSpeedKmh: 160, accel: 0.55 /* est. */, decel: 0.9 /* est. */, emergencyDecel: 1.2 /* est. */,
    gauge: 1.435, electrification: 'none (diesel)', cars: [2, 4],
    formation: nFormation,
    build: (variant, lod) => buildCar('N', variant, lod),
  },
};

// Debug helper: per-variant triangle counts.
export function triangleReport() {
  const out = {};
  for (const code of Object.keys(FLEETS)) for (const v of ['lead', 'mid', 'midPan']) for (const lod of ['high', 'low']) {
    if (code === 'N' && v !== 'lead') continue;
    out[`${code}.${v}.${lod}`] = triCount(buildCar(code, v, lod));
  }
  return out;
}
export const _materials = (code) => kit(code).mats;
