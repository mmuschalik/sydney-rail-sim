// Web worker: decode a building chunk and generate extruded meshes.
import { ShapeUtils, Vector2 } from 'three';

// palettes (sRGB 0-255)
const BRICK = [[150, 82, 58], [168, 98, 70], [138, 76, 56], [186, 150, 112], [204, 186, 158], [210, 198, 176], [176, 110, 80], [120, 72, 56]];
const CONCRETE = [[176, 172, 164], [156, 152, 146], [190, 184, 172], [136, 134, 132], [196, 178, 146], [168, 150, 124], [122, 118, 112], [200, 196, 188]];
const GLASS = [[70, 94, 112], [92, 112, 128], [58, 74, 88], [108, 126, 136], [84, 98, 104]];
const INDUSTRIAL = [[160, 162, 160], [182, 182, 176], [132, 140, 146], [150, 140, 120]];
const ROOF_TILE = [[140, 66, 46], [158, 78, 54], [112, 58, 44], [86, 84, 84], [64, 68, 72], [128, 62, 44], [150, 96, 70]];
const ROOF_FLAT = [[128, 128, 126], [150, 148, 144], [104, 106, 108], [168, 166, 160], [92, 96, 98]];

function rnd(seed) { const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }

self.onmessage = async (ev) => {
  const { url, key, ox, oz, colours } = ev.data;
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const dv = new DataView(buf);
    const count = dv.getUint32(0, true);
    let o = 4;
    const pos = [], nor = [], col = [], uv = [];
    let tall = 0;
    for (let b = 0; b < count; b++) {
      const n = dv.getUint16(o, true); const h = dv.getUint16(o + 2, true) / 10; const mh = dv.getUint16(o + 4, true) / 10;
      const ground = dv.getInt16(o + 6, true) / 10; const kf = dv.getUint8(o + 8); const ci = dv.getUint8(o + 9);
      o += 10;
      const pts = [];
      for (let i = 0; i < n; i++) { pts.push([dv.getInt16(o, true) / 10, dv.getInt16(o + 2, true) / 10]); o += 4; }
      const kind = kf & 31;
      const flags = kf >> 5;
      const seed = (pts[0][0] * 7.3 + pts[0][1] * 3.1) | 0;
      // footprint area
      let area = 0;
      for (let i = 0; i < n; i++) { const a = pts[i], c = pts[(i + 1) % n]; area += a[0] * c[1] - c[0] * a[1]; }
      const sgn = area > 0 ? 1 : -1;
      area = Math.abs(area / 2);
      const residential = kind === 1 || kind === 2 || (kind === 0 && h <= 8 && area < 350) || kind === 3 && h <= 9;
      let wall;
      if (ci && colours[ci - 1]) wall = parseColour(colours[ci - 1]) || CONCRETE[0];
      else if (residential) wall = BRICK[Math.floor(rnd(seed) * BRICK.length)];
      else if (h > 40) wall = rnd(seed) < 0.6 ? GLASS[Math.floor(rnd(seed + 1) * GLASS.length)] : CONCRETE[Math.floor(rnd(seed + 2) * CONCRETE.length)];
      else if (kind === 7 || kind === 8) wall = INDUSTRIAL[Math.floor(rnd(seed) * INDUSTRIAL.length)];
      else wall = CONCRETE[Math.floor(rnd(seed) * CONCRETE.length)];
      const pitched = (residential && n <= 8 && area < 500 && h < 12) || (flags & 2);
      const roofC = pitched ? ROOF_TILE[Math.floor(rnd(seed + 5) * ROOF_TILE.length)] : ROOF_FLAT[Math.floor(rnd(seed + 6) * ROOF_FLAT.length)];
      const y0 = ground + mh - (mh > 0 ? 0 : 1.5);
      const roofH = pitched ? Math.min(3.2, Math.sqrt(area) * 0.22) : 0;
      const wallTop = ground + Math.max(h - roofH, mh + 2.4);
      if (h > 40) tall++;
      const windows = h - mh > 7.5 && !residential ? 1 : 0;
      // walls
      let per = 0;
      const shade = 0.92 + rnd(seed + 9) * 0.16;
      const wc = wall.map((v) => Math.min(255, v * shade));
      for (let i = 0; i < n; i++) {
        const a = pts[i], c = pts[(i + 1) % n];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (L < 0.05) continue;
        // outward normal (ring is CCW seen from above in x/z with +z south => clockwise math); compute and fix by centroid test later
        const nx = sgn * (c[1] - a[1]) / L, nz = -sgn * (c[0] - a[0]) / L;
        const quad = [[a[0], y0, a[1], per, y0 - ground], [c[0], y0, c[1], per + L, y0 - ground], [c[0], wallTop, c[1], per + L, wallTop - ground], [a[0], wallTop, a[1], per, wallTop - ground]];
        for (const k of [0, 1, 2, 0, 2, 3]) {
          const q = quad[k];
          pos.push(q[0], q[1], q[2]); nor.push(nx, 0, nz); col.push(wc[0], wc[1], wc[2]);
          uv.push(windows ? q[3] : -1, q[4] + (windows ? (seed % 97) * 1000 : 0));
        }
        per += L;
      }
      // roof
      const r = roofC;
      if (pitched && n === 4) {
        // hipped roof on a quad: ridge along the longer axis
        const e0 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
        const e1 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
        const [p0, p1, p2, p3] = e0 >= e1 ? pts : [pts[1], pts[2], pts[3], pts[0]];
        const lenL = Math.max(e0, e1), wid = Math.min(e0, e1);
        const inset = Math.min(wid / 2, lenL / 2) / lenL;
        const m03 = [(p0[0] + p3[0]) / 2, (p0[1] + p3[1]) / 2], m12 = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        const r0 = [m03[0] + (m12[0] - m03[0]) * inset, m03[1] + (m12[1] - m03[1]) * inset];
        const r1 = [m12[0] + (m03[0] - m12[0]) * inset, m12[1] + (m03[1] - m12[1]) * inset];
        const top = wallTop + roofH;
        const tris = [[p0, p1, r1, r0], [p1, p2, r1], [p2, p3, r0, r1], [p3, p0, r0]];
        for (const f of tris) {
          const vs = f.map((p) => [p[0], (p === r0 || p === r1) ? top : wallTop, p[1]]);
          const faces = vs.length === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]];
          for (const tri of faces) {
            const A = vs[tri[0]], B = vs[tri[1]], C = vs[tri[2]];
            let nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
            let ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
            let nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
            let tri2 = [A, B, C];
            if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; tri2 = [A, C, B]; }
            const l = Math.hypot(nx, ny, nz) || 1;
            for (const v of tri2) { pos.push(v[0], v[1], v[2]); nor.push(nx / l, ny / l, nz / l); col.push(r[0], r[1], r[2]); uv.push(-1, 0); }
          }
        }
      } else {
        const contour = pts.map((p) => new Vector2(p[0], p[1]));
        let tris;
        try { tris = ShapeUtils.triangulateShape(contour, []); } catch { tris = []; }
        const top = pitched ? wallTop + roofH * 0.3 : wallTop;
        for (const t of tris) {
          const A = pts[t[0]], B = pts[t[1]], C = pts[t[2]];
          // ensure upward winding
          const cross = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
          const order = cross < 0 ? [A, B, C] : [A, C, B];
          for (const v of order) { pos.push(v[0], top, v[1]); nor.push(0, 1, 0); col.push(r[0], r[1], r[2]); uv.push(-1, 0); }
        }
      }
    }
    // fix wall normals/winding: ensure walls face outward using triangle winding vs normal
    const P = new Float32Array(pos), N = new Float32Array(nor), U = new Float32Array(uv);
    for (let i = 0; i < P.length; i += 9) {
      if (N[i + 1] !== 0) continue; // roofs handled
      const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2];
      const vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
      const gx = uy * vz - uz * vy, gz = ux * vy - uy * vx;
      if (gx * N[i] + gz * N[i + 2] < 0) {
        // swap vertex 1 and 2 to flip winding so the face is front-facing outward
        for (const k of [0, 1, 2]) { const t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t; }
        const j = (i / 3) * 2; for (const k of [0, 1]) { const t = U[j + 2 + k]; U[j + 2 + k] = U[j + 4 + k]; U[j + 4 + k] = t; }
      }
    }
    // orient normals consistently with the (now outward) winding
    for (let i = 0; i < P.length; i += 9) {
      if (N[i + 1] !== 0) continue;
      const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2];
      const vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
      let nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      for (let k = 0; k < 3; k++) { N[i + k * 3] = nx; N[i + k * 3 + 2] = nz; }
    }
    // sRGB -> linear for the colour attribute
    const LUT = new Uint8Array(256);
    for (let i = 0; i < 256; i++) LUT[i] = Math.round(Math.pow(i / 255, 2.2) * 255);
    const C = new Uint8Array(col.length);
    for (let i = 0; i < col.length; i++) C[i] = LUT[Math.max(0, Math.min(255, Math.round(col[i])))];
    self.postMessage({ key, pos: P, nor: N, col: C, uv: U, tall }, [P.buffer, N.buffer, C.buffer, U.buffer]);
  } catch (e) {
    self.postMessage({ key, error: String(e) });
  }
};

function parseColour(s) {
  const named = { white: [235, 235, 230], grey: [150, 150, 150], gray: [150, 150, 150], red: [160, 70, 55], brown: [130, 90, 60],
    yellow: [220, 200, 120], beige: [215, 200, 170], black: [50, 50, 50], blue: [90, 110, 150], green: [100, 130, 100], sandstone: [212, 180, 130], cream: [235, 225, 195], silver: [190, 190, 195] };
  if (named[s]) return named[s];
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  return null;
}
