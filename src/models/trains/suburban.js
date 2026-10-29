// Sydney Trains suburban double-deck EMU fleet models (procedural, Three.js r186).
//
// Exports FLEETS[code] = { name, operator, carLength, bogieCentres, width, height, maxSpeedKmh,
//   accel, decel, formation(nCars), build(variant, lod) } for GTFS fleet codes A B T M K H.
//
// variant: 'lead' (driving car, cab at +X; carries a pantograph where the real class does),
//          'mid'  (intermediate, no pantograph),
//          'midPan' (intermediate with pantograph).
// lod: 'high' | 'low'.
// carLength is the coupled pitch (over couplers/gangways) — place cars carLength apart.
// The visible body is carLength - 0.36 m; gangway bellows / couplers fill the gap.
//
// Research notes (sources: Wikipedia articles "Sydney Trains A & B sets", "Sydney Trains T set",
// "Sydney Trains M set", "Sydney Trains K set", "New South Wales H set"; reference photos from
// Wikimedia Commons saved in data/reference/trains/sub_*.jpg):
//  A/B Waratah : D 20.732 m / N 20.243 m / T 20.332 m, width 3.035 m, height 4.41 m,
//                2 plug doors per side, 143 km/h design / 130 km/h service, accel 1.03 m/s^2,
//                service decel 1.05 m/s^2 (emergency 1.28). Formation D-N-N-T-T-N-N-D; pantographs
//                are on the trailer cars (D and T) feeding the adjacent motor car.
//                A set livery (2020s): yellow cab front, orange cab side, charcoal-wrapped sides,
//                yellow doors.  B set (2018-20): orange cab with black roof cap / windscreen
//                surround, stainless sides with charcoal window bands, yellow doors.
//  T Tangara   : D 20.32 m / N 20.22 m, 81.08 m per 4 cars, width 3.0 m, height 4.413 m,
//                130 design / 115 km/h service, accel 0.6-0.8 m/s^2, service decel 0.9.
//                D-N-N-D, pantograph on each driving trailer. Flat yellow front, black window
//                band, hazard-chevron centre door, charcoal sides, yellow doors.
//  M Millennium: D 20.532 / N 20.243 m, width 3.03 m, height 4.381 m, 143/130 km/h,
//                D-N-N-D, pantographs on the driving trailers. Yellow frame / black face front,
//                stainless sides, yellow doors.
//  K set       : 20.385 m, width 3.036 m, height 4.368 m, 115 km/h, sliding pocket doors,
//                C-T-T-C (power cars at the ends), pantographs on the trailers. Fluted stainless,
//                yellow lower cab front, twin roof-dome headlights. (Withdrawn Oct 2026.)
//  H OSCAR     : OD 20.34 / ON 20.435 m, width 3.034 m, height 4.403 m, 143/130 km/h,
//                accel 1.03, service decel 1.01. OD-ONL-ON-OD, pantograph on the OD cars at the
//                inner end (visible in photos). Oct-2025+ livery: orange cab and doors, black visor.
//  Bogie centres are not published; ~14.6 m estimated from side-on photos (doors/vestibules sit
//  directly above the bogies, typical NSW DD layout). Wheel dia ~0.86 m, bogie wheelbase 2.5 m.
//  Accel/decel for M and K are not published on Wikipedia: M taken as Waratah-like (1.0/1.0),
//  K as older camshaft-control stock (0.6 / 0.9).
import * as THREE from 'three';
import {
  beam,
  Painter, M, makeMaterials, UV, loft, sideQuad, box, cylX, lampDisc, bogie, pantograph, assemble,
} from './suburbanCommon.js';

const COUPLER_GAP = 0.36;

// ------------------------------------------------------------------ fleet parameter sets
const base = {
  wheelR: 0.43, wheelbase: 2.5, bogieCentres: 14.6,
  prof: { rt: 0.62, rb: 0.08, tumble: 0.1, waistY: 2.3 },
  endYb: 1.02, wellYb: 0.42, cabYb: 0.5,
  doorW: 1.5, doorY0: 1.12, doorY1: 3.18, doorEnd: 2.75,
  cabLen: 2.2, leadDoorGap: 0.35,
  win: { upper: [2.5, 3.55], lower: [0.98, 1.95], mezz: [1.95, 2.85], doorWin: [1.55, 2.95], panesU: 4, panesL: 3, pillar: 0.16 },
  panX: -5.6, acX: 8.4,
};

const SPECS = {
  A: {
    ...base, code: 'A', name: 'Waratah', carLength: 20.4, width: 3.035, height: 4.41,
    maxSpeedKmh: 130, accel: 1.03, decel: 1.05,
    nose: { len: 1.35, rakeY: 2.35, rake: 0.42, steps: [[0, 1, 0, 0.62], [0.3, 0.99, 0.0, 0.66], [0.55, 0.96, 0.03, 0.72], [0.75, 0.9, 0.07, 0.8], [0.88, 0.82, 0.11, 0.82], [0.96, 0.75, 0.15, 0.8], [1, 0.71, 0.18, 0.78]] },
    lights: {
      head: [[1.42, 0.9, 0.065], [1.6, 0.9, 0.065], [1.78, 0.9, 0.065], [0.78, 0.9, 0.05]],
      tail: [[3.76, 0.86, 0.045]],
    },
    wipers: [[0.78, 2.47, 0.62, 3.15], [0.05, 2.47, -0.12, 3.15], [-0.72, 2.47, -0.9, 3.1]],
    panOn: ['lead', 'midPan'],
    formation: (n) => (n >= 8 ? ['lead', 'mid', 'mid', 'midPan', 'midPan', 'mid', 'mid', 'lead'] : ['lead', 'mid', 'mid', 'lead'].slice(0, Math.max(2, n))),
  },
  T: {
    ...base, code: 'T', name: 'Tangara', carLength: 20.27, width: 3.0, height: 4.413,
    maxSpeedKmh: 115, accel: 0.7, decel: 0.9,
    prof: { rt: 0.55, rb: 0.06, tumble: 0.08, waistY: 2.3 },
    win: { ...base.win, upper: [2.55, 3.5], lower: [1.0, 1.9], panesU: 4, panesL: 3, pillar: 0.2 },
    nose: { len: 0.5, rakeY: 2.3, rake: 0.18, steps: [[0, 1, 0, 0.55], [0.5, 0.99, 0.02, 0.56], [0.85, 0.97, 0.05, 0.58], [1, 0.95, 0.07, 0.58]] },
    lights: { head: [[1.0, 0.82, 0.06], [3.99, 0.1, 0.045]], tail: [[1.0, 1.1, 0.045]] },
    wipers: [[0.8, 2.47, 0.6, 3.1], [0.05, 2.47, -0.1, 3.1], [-0.75, 2.47, -0.95, 3.1]],
    panOn: ['lead'],
    formation: (n) => unit4(n, ['lead', 'mid', 'mid', 'lead']),
  },
  M: {
    ...base, code: 'M', name: 'Millennium', carLength: 20.39, width: 3.03, height: 4.381,
    maxSpeedKmh: 130, accel: 1.0, decel: 1.0,
    win: { ...base.win, upper: [2.5, 3.55], lower: [0.98, 1.95], panesU: 4, panesL: 3, pillar: 0.12 },
    nose: { len: 1.0, rakeY: 2.3, rake: 0.36, steps: [[0, 1, 0, 0.62], [0.35, 0.99, 0.01, 0.64], [0.65, 0.96, 0.04, 0.68], [0.85, 0.91, 0.08, 0.7], [1, 0.86, 0.12, 0.7]] },
    lights: { head: [[0.85, 1.12, 0.085], [3.47, 0.62, 0.04]], tail: [[3.47, 0.8, 0.035]] },
    wipers: [[0.7, 2.5, 0.52, 3.15], [0.05, 2.5, -0.1, 3.15], [-0.68, 2.5, -0.85, 3.1]],
    panOn: ['lead'],
    formation: (n) => unit4(n, ['lead', 'mid', 'mid', 'lead']),
  },
  K: {
    ...base, code: 'K', name: 'K set', carLength: 20.4, width: 3.036, height: 4.368,
    maxSpeedKmh: 115, accel: 0.6, decel: 0.9,
    prof: { rt: 0.5, rb: 0.05, tumble: 0.06, waistY: 2.3 },
    doorW: 1.4, doorEnd: 2.7, cabLen: 1.9,
    win: { ...base.win, upper: [2.6, 3.35], lower: [1.1, 1.85], mezz: [2.05, 2.85], doorWin: [1.6, 2.9], panesU: 7, panesL: 5, pillar: 0.32 },
    nose: { len: 0.32, rakeY: 3.95, rake: 0.2, steps: [[0, 1, 0, 0.5], [0.5, 0.995, 0.02, 0.52], [1, 0.985, 0.05, 0.56]] },
    lights: { head: [[4.12, 0.11, 0.06], [4.12, -0.11, 0.06]], tail: [[1.55, 1.25, 0.05]] },
    wipers: [[0.85, 2.28, 0.62, 2.9], [-0.85, 2.28, -1.08, 2.9]],
    panOn: ['midPan'],
    formation: (n) => unit4(n, ['lead', 'midPan', 'midPan', 'lead']),
  },
  H: {
    ...base, code: 'H', name: 'OSCAR', carLength: 20.39, width: 3.034, height: 4.403,
    maxSpeedKmh: 130, accel: 1.03, decel: 1.01,
    win: { ...base.win, upper: [2.45, 3.6], lower: [0.95, 2.0], panesU: 4, panesL: 3, pillar: 0.12 },
    nose: { len: 1.1, rakeY: 2.25, rake: 0.38, steps: [[0, 1, 0, 0.62], [0.35, 0.99, 0.01, 0.66], [0.62, 0.96, 0.04, 0.72], [0.82, 0.9, 0.08, 0.76], [0.94, 0.84, 0.12, 0.76], [1, 0.8, 0.15, 0.74]] },
    lights: { head: [[0.75, 1.0, 0.055], [3.74, 0.9, 0.045]], tail: [[0.75, 1.15, 0.04]] },
    wipers: [[0.78, 2.48, 0.6, 3.12], [0.05, 2.48, -0.12, 3.12], [-0.74, 2.48, -0.92, 3.1]],
    panOn: ['lead'],
    formation: (n) => unit4(n, ['lead', 'mid', 'mid', 'lead']),
  },
};
SPECS.B = {
  ...SPECS.A, code: 'B', name: 'Waratah Series 2',
};
function unit4(n, u) { return n >= 8 ? [...u, ...u] : u.slice(0, Math.max(2, Math.min(4, n))); }

// ------------------------------------------------------------------ layout
function layout(S, variant) {
  const Lb = S.carLength - COUPLER_GAP;
  const half = Lb / 2;
  const lead = variant === 'lead';
  const rearDoor = -(half - S.doorEnd);
  const frontDoor = lead ? half - S.cabLen - S.leadDoorGap - S.doorW / 2 : half - S.doorEnd;
  const doors = [rearDoor, frontDoor];
  const dd = [rearDoor + S.doorW / 2 + 0.22, frontDoor - S.doorW / 2 - 0.22];
  const wellX = S.bogieCentres / 2 - S.wheelbase / 2 - S.wheelR - 0.45;
  const { win } = S;
  const panes = (x0, x1, n, pil, y0, y1) => {
    const w = (x1 - x0 - pil * (n - 1)) / n; const r = [];
    for (let i = 0; i < n; i++) r.push({ x0: x0 + i * (w + pil), x1: x0 + i * (w + pil) + w, y0, y1 });
    return r;
  };
  const upper = panes(dd[0] + 0.1, dd[1] - 0.1, win.panesU, win.pillar, ...win.upper);
  const lower = panes(-wellX + 0.15, wellX - 0.15, win.panesL, win.pillar, ...win.lower);
  const mezz = [];
  mezz.push({ x0: -half + 0.45, x1: rearDoor - S.doorW / 2 - 0.3, y0: win.mezz[0], y1: win.mezz[1] });
  if (!lead) mezz.push({ x0: frontDoor + S.doorW / 2 + 0.3, x1: half - 0.45, y0: win.mezz[0], y1: win.mezz[1] });
  const doorWins = [];
  for (const d of doors) for (const s of [-1, 1]) {
    const lx0 = s < 0 ? d - S.doorW / 2 : d, lx1 = s < 0 ? d : d + S.doorW / 2;
    doorWins.push({ x0: lx0 + 0.16, x1: lx1 - 0.16, y0: win.doorWin[0], y1: win.doorWin[1] });
  }
  return { Lb, half, lead, doors, dd, wellX, upper, lower, mezz, doorWins, cabBack: lead ? half - S.cabLen : null, noseStart: half - S.nose.len };
}

// ------------------------------------------------------------------ painting
function paintSide(p, region, S, lay, st) {
  const { half } = lay; const H = S.height; const yt = H - 0.12;
  p.side(region, -half - 0.1, half + 0.1, 0, 4.5, st.base);
  if (st.fluted) p.fluting(region, -half, half, st.fluted[0], st.fluted[1]);
  p.side(region, -half - 0.1, half + 0.1, 0, st.skirtY ?? 0.95, st.skirt);
  // roof (top rows of the region map onto the roof)
  p.side(region, -half - 0.1, half + 0.1, yt - 0.42, 4.5, st.roof);
  p.side(region, -half - 0.1, half + 0.1, yt - 0.45, yt - 0.42, st.gutter || M.stainlessDark);
  for (const s of [-1, 1]) { // roof AC grilles
    const ax = s * S.acX;
    if (lay.lead && s > 0) continue;
    for (let k = 0; k < 6; k++) p.side(region, ax - 1.1 + k * 0.38, ax - 0.85 + k * 0.38, yt - 0.3, yt + 0.1, { c: '#55595d', m: 0.6, r: 0.6 });
  }
  if (st.band) for (const b of st.band(lay)) p.side(region, b[0], b[1], b[2], b[3], st.bandMat, 0.05);
  if (st.stripe) p.side(region, -half - 0.1, half + 0.1, st.stripe[0], st.stripe[1], st.stripeMat);
  for (const w of [...lay.upper, ...lay.lower, ...lay.mezz]) p.side(region, w.x0, w.x1, w.y0, w.y1, M.windowDark, 0.07);
  for (const d of lay.doors) {
    p.side(region, d - S.doorW / 2 - 0.05, d + S.doorW / 2 + 0.05, S.doorY0 - 0.03, S.doorY1 + 0.05, M.rubber, 0.08);
    p.side(region, d - S.doorW / 2, d + S.doorW / 2, S.doorY0, S.doorY1, st.door, 0.07);
    p.side(region, d - 0.012, d + 0.012, S.doorY0, S.doorY1, M.rubber);
  }
  for (const w of lay.doorWins) p.side(region, w.x0 - 0.02, w.x1 + 0.02, w.y0 - 0.02, w.y1 + 0.02, M.rubber, 0.06);
  for (const w of lay.doorWins) p.side(region, w.x0, w.x1, w.y0, w.y1, M.windowDark, 0.05);
  // car end vertical seam / corner post
  p.side(region, -half - 0.1, -half + 0.12, st.skirtY ?? 0.95, yt - 0.45, st.endPost || M.stainlessDark);
  if (region === 1) p.side(region, half - 0.12, half + 0.1, st.skirtY ?? 0.95, yt - 0.45, st.endPost || M.stainlessDark);
}

function paintEnd(p, S, mat) {
  p.front(-1.6, 1.6, 0, 4.5, mat, 0, true);
  p.front(-0.55, 0.55, 1.15, 3.2, M.black, 0.05, true);
  p.front(-0.35, 0.35, 1.55, 2.9, M.windowDark, 0.05, true);
  p.front(-1.6, 1.6, 0, 0.95, M.underGrey, 0, true);
  p.front(-1.6, 1.6, S.height - 0.55, 4.5, M.roofGrey, 0, true);
}

// destination board helper
function destBoard(p, zHalf, y0, y1, text) {
  p.front(-zHalf, zHalf, y0, y1, M.black, 0.03);
  p.frontText(text, 0, (y0 + y1) / 2, (y1 - y0) * 0.62, '#ffa22e', '#ff9a20');
}
function windscreen(p, zHalf, y0, y1, pillars, rad = 0.08) {
  p.front(-zHalf - 0.04, zHalf + 0.04, y0 - 0.04, y1 + 0.04, M.black, rad + 0.03);
  p.front(-zHalf, zHalf, y0, y1, M.windscreen, rad);
  for (const z of pillars) p.front(z - 0.035, z + 0.035, y0, y1, M.black);
}

const PAINT = {
  A(p, S, layL, layM) {
    const st = {
      base: M.charcoal, skirt: M.stainless, roof: M.roofGrey, door: M.yellowDoor,
      stripe: [1.0, 1.045], stripeMat: M.yellowPaint, bandMat: M.charcoal,
    };
    paintSide(p, 0, S, layL, st); paintSide(p, 1, S, layM, st);
    // cab side: orange panel between cab nose and the front door + yellow wrap from the nose
    const cb = layL.cabBack, half = layL.half;
    p.sidePoly(0, [[layL.doors[1] + S.doorW / 2 + 0.08, 0.95], [half + 0.2, 0.5], [half + 0.2, S.height - 0.55], [layL.doors[1] + S.doorW / 2 + 0.08, S.height - 0.55]], M.orangePaint);
    p.sidePoly(0, [[cb + 0.9, 0.5], [half + 0.2, 0.5], [half + 0.2, S.height], [cb + 1.6, S.height], [cb + 1.2, 2.4]], M.yellowPaint);
    cabSideBits(p, S, layL, M.orangePaint);
    // front
    p.front(-1.6, 1.6, 0, 4.5, M.yellowPaint);
    p.front(-1.6, 1.6, S.height - 0.3, 4.5, M.roofGrey);
    waratahFront(p, false);
    paintEnd(p, S, M.stainless);
  },
  B(p, S, layL, layM) {
    const st = {
      base: M.stainless, skirt: M.stainless, roof: M.roofGrey, door: M.yellowDoor,
      stripe: [1.0, 1.04], stripeMat: M.yellowPaint, bandMat: M.charcoal,
      band: (lay) => [[lay.dd[0] - 0.05, lay.dd[1] + 0.05, 0.93, 3.68], ...lay.mezz.map((m) => [m.x0 - 0.12, m.x1 + 0.12, m.y0 - 0.1, m.y1 + 0.1])],
    };
    paintSide(p, 0, S, layL, st); paintSide(p, 1, S, layM, st);
    p.sideText(1, 'Sydney Trains', 0, 3.2, 0.22, '#f07a2a');
    const half = layL.half;
    p.sidePoly(0, [[layL.doors[1] + S.doorW / 2 + 0.08, 0.5], [half + 0.2, 0.5], [half + 0.2, S.height], [layL.doors[1] + S.doorW / 2 + 0.08, S.height]], M.orangePaint);
    p.side(0, layL.cabBack + 0.2, half + 0.2, S.height - 0.55, 4.5, M.black);
    cabSideBits(p, S, layL, M.orangePaint);
    p.front(-1.6, 1.6, 0, 4.5, M.orangePaint);
    p.front(-1.6, 1.6, 3.42, 4.5, M.black);
    p.front(-1.2, 1.2, 2.2, 3.6, M.black, 0.12);
    waratahFront(p, true);
    paintEnd(p, S, M.stainless);
  },
  T(p, S, layL, layM) {
    const st = {
      base: M.charcoal, skirt: M.stainless, roof: { c: '#3d4145', m: 0.4, r: 0.5 }, door: M.yellowDoor,
      stripe: [0.98, 1.04], stripeMat: M.yellowPaint, gutter: M.charcoal,
    };
    for (const [r, lay] of [[0, layL], [1, layM]]) {
      paintSide(p, r, S, lay, st);
      // fluted stainless panels under the mezzanine windows (car ends)
      for (const m of lay.mezz) { p.side(r, m.x0 - 0.1, m.x1 + 0.1, 1.05, 1.85, M.stainless); p.fluting(r, m.x0 - 0.1, m.x1 + 0.1, 1.05, 1.85, 0.07); }
    }
    const half = layL.half;
    p.side(0, layL.cabBack + 0.1, half + 0.2, 0.95, S.height - 0.5, M.charcoal);
    p.side(0, layL.cabBack + 0.25, half - 0.55, 2.3, 3.25, M.windowDark, 0.06);
    p.side(0, layL.doors[1] + S.doorW / 2 + 0.12, layL.cabBack, 1.15, 3.1, M.charcoal, 0.05);
    p.side(0, half - 0.25, half + 0.2, 0.5, S.height - 0.2, M.yellowPaint);
    // front: yellow with black window band and hazard-chevron centre door
    p.front(-1.6, 1.6, 0, 4.5, M.yellowPaint);
    p.front(-1.6, 1.6, S.height - 0.25, 4.5, M.charcoal);
    p.front(-1.32, 1.32, 2.3, 4.08, M.black, 0.12);
    windscreen(p, 1.22, 2.42, 3.45, [-0.36, 0.36], 0.06);
    p.front(-0.36, 0.36, 2.42, 3.45, { c: '#2a3238', m: 0.4, r: 0.06 });
    destBoard(p, 0.95, 3.56, 3.86, 'City Circle');
    p.front(-0.24, 0.24, 3.92, 4.06, { c: '#2b2e31', m: 0.5, r: 0.3 }, 0.05); // headlight housing
    p.front(-0.36, 0.36, 1.25, 2.3, M.yellowPaint);
    for (let k = -3; k < 12; k++) { // chevrons along the centre door edges
      const y = 1.25 + k * 0.11;
      for (const s of [-1, 1]) p.frontPoly([[s * 0.36, y], [s * 0.36, y + 0.05], [s * 0.26, y + 0.1], [s * 0.26, y + 0.05]].map(([z, yy]) => [z, Math.min(2.3, Math.max(1.25, yy))]), M.black);
    }
    p.front(-1.4, 1.4, 0.5, 1.25, M.black, 0.04);
    for (const s of [-1, 1]) {
      p.front(s * 0.45, s * 1.32, 0.62, 1.2, { c: '#2a2c2e', m: 0.3, r: 0.7 }, 0.03);
      for (let k = 0; k < 6; k++) p.front(s * 0.48, s * 1.29, 0.66 + k * 0.09, 0.69 + k * 0.09, { c: '#111', m: 0.2, r: 0.8 });
    }
    p.front(-0.3, 0.3, 1.25, 1.42, { c: '#d81e1e', m: 0.1, r: 0.5 });
    p.front(-0.35, 0.35, 0.5, 1.05, M.underGrey, 0.03);
    paintEnd(p, S, M.stainless);
  },
  M(p, S, layL, layM) {
    const st = {
      base: M.stainless, skirt: M.stainless, roof: M.roofGrey, door: M.yellowDoor,
      stripe: [0.98, 1.03], stripeMat: M.yellowPaint,
    };
    paintSide(p, 0, S, layL, st); paintSide(p, 1, S, layM, st);
    const half = layL.half;
    p.side(0, layL.cabBack + 0.2, half - 0.5, 2.35, 3.3, M.windowDark, 0.06);
    p.sidePoly(0, [[half - 0.55, 0.5], [half + 0.2, 0.5], [half + 0.2, S.height], [half - 0.25, S.height]], M.yellowPaint);
    cabSideBits(p, S, layL, M.stainless);
    p.front(-1.6, 1.6, 0, 4.5, M.yellowPaint);
    p.front(-1.6, 1.6, S.height - 0.22, 4.5, M.roofGrey);
    p.front(-1.08, 1.08, 1.28, 4.05, { c: '#202326', m: 0.3, r: 0.35 }, 0.18);
    windscreen(p, 1.0, 2.45, 3.42, [-0.35, 0.35], 0.05);
    p.front(-0.35, 0.35, 1.3, 2.45, { c: '#2a2e31', m: 0.3, r: 0.4 });
    p.front(-0.37, -0.33, 1.3, 3.45, M.rubber); p.front(0.33, 0.37, 1.3, 3.45, M.rubber);
    destBoard(p, 0.92, 3.6, 3.9, 'via Strathfield');
    p.front(-1.6, 1.6, 0.5, 1.28, M.silverPaint);
    p.front(-1.6, 1.6, 1.22, 1.3, M.yellowPaint);
    p.front(-0.55, 0.55, 0.5, 1.2, M.black, 0.05);
    for (const s of [-1, 1]) p.front(s * 0.62, s * 0.92, 0.95, 1.2, { c: '#2b2e30', m: 0.3, r: 0.6 });
    p.front(0.62, 0.92, 1.0, 1.22, { c: '#1e9a4a', m: 0.1, r: 0.5 });
    paintEnd(p, S, M.stainless);
  },
  K(p, S, layL, layM) {
    const st = {
      base: M.stainless, skirt: M.underGrey, skirtY: 0.92, roof: { c: '#8f8a86', m: 0.5, r: 0.6 }, door: M.yellowDoor,
      stripe: [0.95, 1.02], stripeMat: { c: '#f39a1e', m: 0.1, r: 0.5 }, fluted: [1.02, 3.95],
    };
    paintSide(p, 0, S, layL, st); paintSide(p, 1, S, layM, st);
    const half = layL.half;
    p.side(0, layL.cabBack + 0.1, half + 0.2, 1.02, 3.9, M.stainless);
    p.side(0, layL.cabBack + 0.13, layL.cabBack + 0.92, 1.23, 3.22, M.rubber, 0.04); p.side(0, layL.cabBack + 0.15, layL.cabBack + 0.9, 1.25, 3.2, M.stainless, 0.04); // crew door
    p.side(0, layL.cabBack + 0.3, layL.cabBack + 0.75, 2.3, 2.95, M.windowDark, 0.04);
    p.side(0, layL.cabBack + 1.0, half - 0.2, 2.35, 3.0, M.windowDark, 0.05);
    p.front(-1.6, 1.6, 0, 4.5, M.silverPaint);
    p.front(-1.6, 1.6, 0.9, 2.12, M.yellowPaint);
    p.front(-1.6, 1.6, 0, 0.92, M.underGrey);
    for (const s of [-1, 1]) {
      p.front(s * 0.4, s * 1.28, 2.2, 3.15, M.black, 0.04);
      p.front(s * 0.45, s * 1.23, 2.25, 3.1, M.windscreen, 0.03);
    }
    p.front(-0.33, 0.33, 0.95, 3.25, { c: '#9fa4a8', m: 0.6, r: 0.45 }, 0.02); // centre door
    p.front(0.33, 0.37, 0.95, 3.25, M.rubber); p.front(-0.37, -0.33, 0.95, 3.25, M.rubber);
    p.front(-0.33, 0.33, 0.95, 2.12, M.yellowPaint, 0.02);
    p.front(-0.2, 0.2, 2.35, 3.15, M.windscreen, 0.03);
    destBoard(p, 1.1, 3.35, 3.78, 'City Circle');
    p.front(-1.25, 1.25, 3.32, 3.81, M.stainlessDark, 0.04); destBoard(p, 1.1, 3.35, 3.78, 'City Circle');
    p.front(-0.3, 0.3, 3.98, 4.26, M.stainlessDark, 0.12);
    p.front(0.62, 1.0, 1.0, 1.3, { c: '#1d3c9c', m: 0.1, r: 0.5 });
    paintEnd(p, S, M.stainless);
  },
  H(p, S, layL, layM) {
    const st = {
      base: M.stainless, skirt: M.stainless, roof: M.roofGrey, door: M.orangeDoor,
      stripe: [0.98, 1.03], stripeMat: M.yellowPaint,
    };
    paintSide(p, 0, S, layL, st); paintSide(p, 1, S, layM, st);
    const half = layL.half;
    p.side(0, layL.cabBack + 0.3, half - 0.6, 2.3, 3.4, M.windowDark, 0.06);
    p.sidePoly(0, [[half - 0.8, 0.5], [half + 0.2, 0.5], [half + 0.2, S.height], [half - 0.2, S.height], [half - 0.45, 2.3]], M.orangePaint);
    p.side(0, half - 0.6, half + 0.2, S.height - 0.5, 4.5, M.black);
    cabSideBits(p, S, layL, M.stainless);
    p.front(-1.6, 1.6, 0, 4.5, M.orangePaint);
    p.front(-1.6, 1.6, S.height - 0.4, 4.5, M.black);
    p.front(-1.25, 1.25, 2.25, 4.2, M.black, 0.2);
    windscreen(p, 1.08, 2.42, 3.45, [-0.42, 0.42], 0.06);
    destBoard(p, 0.8, 3.58, 3.86, 'Richmond');
    p.front(-0.42, -0.38, 1.3, 3.45, M.black); p.front(0.38, 0.42, 1.3, 3.45, M.black);
    p.front(-1.6, 1.6, 0.92, 1.32, M.black);
    p.front(-0.5, 0.5, 0.5, 1.32, { c: '#1b1c1d', m: 0.3, r: 0.6 }, 0.04);
    p.front(-1.05, -0.8, 1.0, 1.25, { c: '#1e9a4a', m: 0.1, r: 0.5 });
    paintEnd(p, S, M.stainless);
  },
};

function cabSideBits(p, S, lay, bodyAt) {
  // crew door outline + droplight window just behind the cab front
  const cb = lay.cabBack;
  p.side(0, cb + 0.08, cb + 0.86, 1.2, 3.25, M.rubber, 0.05);
  p.side(0, cb + 0.11, cb + 0.83, 1.23, 3.22, bodyAt);
  p.side(0, cb + 0.2, cb + 0.74, 2.3, 3.05, M.windowDark, 0.05);
}

function waratahFront(p, isB) {
  // windscreen with 3 panes (centre is the emergency-door window)
  windscreen(p, 1.12, 2.42, 3.48, [-0.38, 0.38], 0.08);
  destBoard(p, 0.86, 3.62, 3.9, isB ? 'via Revesby' : 'Homebush');
  // emergency door outline
  for (const s of [-1, 1]) p.front(s * 0.38 - 0.012, s * 0.38 + 0.012, 1.25, 2.42, M.rubber);
  p.front(-0.08, 0.08, 1.9, 2.02, { c: isB ? '#c95514' : '#d29a0a', m: 0.1, r: 0.5 });
  // headlight cluster bezels
  for (const s of [-1, 1]) p.front(s * 0.8, s * 1.0, 1.3, 1.9, M.silverPaint, 0.09);
  // lower: silver bumper with dark coupler pocket
  p.front(-1.6, 1.6, 1.08, 1.16, M.black);
  p.front(-1.6, 1.6, 0.5, 1.08, isB ? { c: '#9a9fa3', m: 0.7, r: 0.4 } : M.silverPaint);
  p.front(-0.5, 0.5, 0.5, 1.08, M.black, 0.04);
  if (isB) p.frontText('Sydney Trains', -0.75, 1.45, 0.11, '#ffffff', '#000');
  p.front(0.62, 0.95, 0.95, 1.06, { c: '#222', m: 0.1, r: 0.5 });
}

// ------------------------------------------------------------------ per-fleet shared state (materials)
const CACHE = {};
const GEO_CACHE = {};
function fleetMats(code) {
  if (CACHE[code]) return CACHE[code];
  const S = SPECS[code];
  const p = new Painter(S.carLength - COUPLER_GAP);
  PAINT[code](p, S, layout(S, 'lead'), layout(S, 'mid'));
  return (CACHE[code] = makeMaterials(code, p));
}

// ------------------------------------------------------------------ car builder
function profAt(S, wFrac = 1, yb, yt, rt) {
  const W = (S.width / 2) * wFrac;
  return { W, yb, yt, rt, rb: S.prof.rb, tumble: S.prof.tumble * wFrac, waistY: S.prof.waistY };
}

function buildCar(code, variant, lod) {
  const S = SPECS[code];
  const mats = fleetMats(code);
  const lay = layout(S, variant);
  const { Lb, half, lead, wellX } = lay;
  const yt = S.height - 0.12;
  const hi = lod !== 'low';
  const n = hi ? 8 : 0;
  const region = lead ? 0 : 1;
  const sUV = UV.sideUV(region, Lb);
  const B = { body: [], glass: [], dark: [], misc: [], headlight: [], taillight: [] };
  const P = (yb, wFrac = 1, ytt = yt, rt = S.prof.rt) => profAt(S, wFrac, yb, ytt, rt);

  // ---- main body loft
  // lead cars: the cab skirt drops from endYb to cabYb just ahead of the leading bogie's wheels
  const skirtX = S.bogieCentres / 2 + S.wheelbase / 2 + S.wheelR + 0.08;
  const ybLead = (x) => (x <= skirtX ? S.endYb : x >= skirtX + 0.2 ? S.cabYb : S.endYb + (S.cabYb - S.endYb) * (x - skirtX) / 0.2);
  const bodyEnd = lead ? lay.noseStart : half;
  const sl = [];
  if (hi) {
    const wellT = 0.3;
    for (const [x, yb] of [[-half, S.endYb], [-wellX - wellT, S.endYb], [-wellX, S.wellYb], [wellX, S.wellYb], [wellX + wellT, S.endYb]]) sl.push({ x, p: P(yb) });
    if (lead && skirtX < bodyEnd) { sl.push({ x: skirtX, p: P(S.endYb) }); sl.push({ x: Math.min(skirtX + 0.2, bodyEnd - 0.01), p: P(S.cabYb) }); }
    sl.push({ x: bodyEnd, p: P(lead ? ybLead(bodyEnd) : S.endYb) });
  } else {
    sl.push({ x: -half, p: P(0.75) }, { x: bodyEnd, p: P(0.75) });
  }
  B.body.push(...loft(sl, n, sUV, { capStart: UV.frontUV(true), capEnd: lead ? null : UV.frontUV(true) }));

  // ---- cab nose (front-projected UVs)
  let noseEndX = half;
  let noseOff = () => 0;
  if (lead) {
    const N = S.nose;
    const steps = hi ? N.steps : [N.steps[0], N.steps[Math.floor(N.steps.length / 2)], N.steps[N.steps.length - 1]];
    const ns = steps.map(([t, wf, dyt, rt]) => {
      const x = lay.noseStart + t * N.len;
      const yb = hi ? ybLead(x) : 0.75;
      const ytt = yt - dyt;
      const off = (y) => -N.rake * t * Math.pow(Math.min(1, Math.max(0, (y - N.rakeY) / (ytt - N.rakeY))), 1.4);
      return { x, p: P(yb, wf, ytt, rt), off };
    });
    if (!hi) ns[ns.length - 1].p.yb = S.cabYb + 0.05;
    B.body.push(...loft(ns, n, UV.frontUV(false), { capEnd: UV.frontUV(false) }));
    const last = ns[ns.length - 1];
    noseEndX = last.x; noseOff = last.off;
    // lamps on the front face
    const faceX = (y) => noseEndX + noseOff(y) + 0.012;
    const heads = hi ? S.lights.head : S.lights.head.slice(0, 1);
    const tails = hi ? S.lights.tail : S.lights.tail.slice(0, 1);
    for (const [y, z, r] of heads) for (const s of z === 0 ? [1] : [1, -1]) {
      if (S.code === 'K' && s < 0) continue;
      B.headlight.push(lampDisc(hi ? r : r * 1.5, faceX(y), y, s * z, hi ? 12 : 3));
    }
    for (const [y, z, r] of tails) for (const s of [1, -1]) B.taillight.push(lampDisc(hi ? r : r * 1.5, faceX(y), y, s * z, hi ? 10 : 3));
    if (hi) {
      // automatic (Scharfenberg-type) coupler: shaft + head reaching the coupled pitch
      const tip = S.carLength / 2;
      B.dark.push(cylX(0.08, tip - noseEndX + 0.2, 8, (tip + noseEndX - 0.2) / 2 - 0.1, 0.82, 0));
      B.dark.push(box(0.22, 0.3, 0.34, tip - 0.11, 0.82, 0));
      B.dark.push(box(0.25, 0.14, 0.62, noseEndX + 0.05, 0.62, 0)); // anticlimber / lower bumper beam
      // windscreen wipers (parked)
      for (const [za, ya, zb, yb] of S.wipers || []) {
        B.dark.push(beam(new THREE.Vector3(faceX(ya) + 0.02, ya, za), new THREE.Vector3(faceX(yb) + 0.02, yb, zb), 0.03));
      }
    }
  }

  // ---- glass (windows that glow at night)
  const prof = P(S.endYb);
  if (hi) {
    const wins = [...lay.upper, ...lay.lower, ...lay.mezz, ...lay.doorWins];
    for (const w of wins) for (const s of [1, -1]) B.glass.push(sideQuad(prof, w.x0, w.x1, w.y0, w.y1, s));
  } else {
    const u = lay.upper, l = lay.lower;
    for (const s of [1, -1]) {
      B.glass.push(sideQuad(prof, u[0].x0, u[u.length - 1].x1, u[0].y0, u[0].y1, s, 0.02));
      B.glass.push(sideQuad(prof, l[0].x0, l[l.length - 1].x1, l[0].y0, l[0].y1, s, 0.02));
    }
  }

  // ---- bogies & underframe
  for (const bx of [-S.bogieCentres / 2, S.bogieCentres / 2]) B.dark.push(...bogie(bx, S.wheelR, S.wheelbase, lod));
  if (hi) {
    for (const s of [-1, 1]) {
      // equipment cases under the ends (outboard of bogies) and around the well ends
      const ox = s * (S.bogieCentres / 2 + S.wheelbase / 2 + S.wheelR + 0.55);
      if (!(lead && s > 0)) B.dark.push(box(0.6, 0.38, 2.2, ox, S.endYb - 0.19, 0));
      B.dark.push(box(0.5, 0.45, 2.4, s * (wellX + 0.05), S.wellYb + 0.2, 0));
      B.dark.push(box(1.2, 0.2, 2.6, s * (wellX - 0.8), S.wellYb - 0.08, 0)); // underfloor tanks
    }
    // gangways + couplers at non-cab ends
    const ends = lead ? [-1] : [-1, 1];
    for (const s of ends) {
      B.dark.push(box(COUPLER_GAP / 2 + 0.02, 2.05, 1.25, s * (half + COUPLER_GAP / 4), 2.17, 0));
      B.dark.push(box(COUPLER_GAP / 2 + 0.05, 0.2, 0.3, s * (half + COUPLER_GAP / 4), 0.82, 0));
    }
    // roof: AC units (misc) and conduit
    for (const s of [-1, 1]) {
      if (lead && s > 0) continue;
      B.misc.push(box(2.6, 0.12, 1.9, s * S.acX, yt + 0.04, 0));
    }
    B.dark.push(box(Lb * 0.7, 0.05, 0.1, -Lb * 0.05, yt + 0.02, 0.55));
  } else {
    const ends = lead ? [-1] : [-1, 1];
    for (const s of ends) B.dark.push(box(COUPLER_GAP / 2 + 0.02, 2.0, 1.2, s * (half + COUPLER_GAP / 4), 2.15, 0));
  }

  // ---- pantograph
  if (S.panOn.includes(variant)) {
    if (hi) {
      const pg = pantograph(S.panX, yt, 5.35, 1);
      B.dark.push(...pg.dark); B.misc.push(...pg.misc);
    } else {
      B.dark.push(box(1.2, 0.25, 1.4, S.panX, yt + 0.12, 0));
    }
  }

  const g = assemble(B, mats, `${code}-${variant}-${lod}`);
  g.userData.fleet = code; g.userData.variant = variant; g.userData.lod = lod;
  return g;
}

// ------------------------------------------------------------------ exports
function spec(code) {
  const S = SPECS[code];
  return {
    name: S.name,
    operator: 'Sydney Trains',
    carLength: S.carLength,
    bogieCentres: S.bogieCentres,
    width: S.width,
    height: S.height,
    maxSpeedKmh: S.maxSpeedKmh,
    accel: S.accel,
    decel: S.decel,
    pantographHeadY: 5.35,
    formation: S.formation,
    // Geometry is built once per (variant, lod) and shared; each call returns a light clone.
    build: (variant = 'lead', lod = 'high') => {
      const v = variant === 'trailer' ? 'mid' : variant; const key = `${code}|${v}|${lod}`;
      if (!GEO_CACHE[key]) GEO_CACHE[key] = buildCar(code, v, lod);
      const g = GEO_CACHE[key].clone(); g.userData = { ...GEO_CACHE[key].userData }; return g;
    },
    materials: () => fleetMats(code),
  };
}

export const FLEETS = {
  A: spec('A'), B: spec('B'), T: spec('T'), M: spec('M'), K: spec('K'), H: spec('H'),
};
export default FLEETS;
