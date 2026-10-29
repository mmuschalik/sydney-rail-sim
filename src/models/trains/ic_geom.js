// Geometry helpers for the intercity / metro / DMU train models (intercity.js).
// All geometry is generated with transforms baked in, then merged per material,
// so a car is a Group of at most one Mesh per shared material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Bucket: collects geometries per material and merges them.
// ---------------------------------------------------------------------------
export class Bucket {
  constructor() { this.map = new Map(); }
  add(mat, geo) {
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(geo);
    return geo;
  }
  toGroup(name) {
    const g = new THREE.Group();
    g.name = name;
    for (const [mat, geos] of this.map) {
      const merged = mergeGeometries(geos.map(normaliseGeo), false);
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = mat.name;
      g.add(mesh);
    }
    return g;
  }
}

function normaliseGeo(geo) {
  let g = geo;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(idx);
  }
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

export function triCount(obj) {
  let t = 0;
  obj.traverse((o) => {
    if (o.isMesh) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  return t;
}

// Set every uv of a geometry to one point (used for solid-colour swatches).
export function setUV(geo, uv) {
  const a = geo.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, uv[0], uv[1]);
  a.needsUpdate = true;
  return geo;
}

// Axis-aligned box centred at (x,y,z). uv: optional constant uv.
export function box(sx, sy, sz, x, y, z, uv) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(x, y, z);
  if (uv) setUV(g, uv);
  return g;
}

// Box stretched between two points (a beam), thickness t (square section).
export function beam(p0, p1, t, tz = t, uv) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(len, t, tz);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  g.applyQuaternion(q);
  const m = a.clone().add(b).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  if (uv) setUV(g, uv);
  return g;
}

// Cylinder whose axis is along Z (wheels, axles).
export function cylZ(r, len, seg, x, y, z, uv, open = false) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, open);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  if (uv) setUV(g, uv);
  return g;
}
export function cylY(r, len, seg, x, y, z, uv) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.translate(x, y, z);
  if (uv) setUV(g, uv);
  return g;
}

// ---------------------------------------------------------------------------
// Car body cross-section.
// spec: { halfW, yWaist, yCant, th (tumblehome at cantrail), H (roof apex),
//         nS (# side points), nR (# roof points), n (superellipse exponent),
//         zTop (half width of flat roof-centre row), bev (bottom bevel), C (bottom/top columns) }
// A ring is a closed loop: bottom row (left->right), right edge (bottom->top),
// top interior (right->left), left edge (top->bottom).
// Every point carries vLen = "unrolled height" used for side texture v.
// ---------------------------------------------------------------------------
export function sideZ(spec, y) {
  if (y <= spec.yWaist) return spec.halfW;
  const t = Math.min(1, (y - spec.yWaist) / (spec.yCant - spec.yWaist));
  return spec.halfW - spec.th * t * t;
}

function rightEdge(spec, yb) {
  const { yCant, H, nS, nR, n = 3, zTop = 0.3, bev = 0.06 } = spec;
  const pts = [];
  for (let j = 0; j < nS; j++) {
    const y = yb + bev + (yCant - (yb + bev)) * (j / (nS - 1));
    pts.push({ z: sideZ(spec, y), y, vLen: y });
  }
  const zc = spec.halfW - spec.th, hR = H - yCant;
  const thMax = Math.acos(Math.pow(Math.min(0.999, zTop / zc), n / 2));
  let prev = pts[pts.length - 1], acc = prev.vLen;
  for (let k = 1; k <= nR; k++) {
    const th = (thMax * k) / nR;
    const z = zc * Math.pow(Math.cos(th), 2 / n);
    const y = yCant + hR * Math.pow(Math.sin(th), 2 / n);
    acc += Math.hypot(z - prev.z, y - prev.y);
    const p = { z, y, vLen: acc };
    pts.push(p);
    prev = p;
  }
  return pts;
}

export function makeRing(spec, yb) {
  const C = spec.C ?? 6;
  const bev = spec.bev ?? 0.06;
  const zb = spec.halfW - bev;
  const R = rightEdge(spec, yb);
  const ring = [];
  const vb = Math.max(0.001, yb - 0.02);
  for (let c = 0; c <= C; c++) ring.push({ z: -zb + (2 * zb * c) / C, y: yb, vLen: vb });
  for (const p of R) ring.push({ ...p });
  const top = R[R.length - 1];
  for (let c = 1; c < C; c++) {
    const z = top.z - (2 * top.z * c) / C;
    ring.push({ z, y: top.y, vLen: top.vLen + (top.z - Math.abs(z)) });
  }
  for (let j = R.length - 1; j >= 0; j--) ring.push({ ...R[j], z: -R[j].z });
  ring.rows = R.length; // number of right-edge points
  ring.C = C;
  return ring;
}

// Face-grid rows from a ring: row 0 = bottom row, rows 1..M = left/right edge pairs.
function ringRows(ring) {
  const C = ring.C, M = ring.rows;
  const rows = [];
  rows.push(ring.slice(0, C + 1));
  for (let j = 0; j < M; j++) {
    const r = ring[C + 1 + j];
    const row = [];
    for (let c = 0; c <= C; c++) {
      const z = -r.z + (2 * r.z * c) / C;
      row.push({ z, y: r.y, vLen: r.vLen });
    }
    rows.push(row);
  }
  return rows;
}

// Build an indexed grid surface. verts[k][i] = {p:[x,y,z], uv:[u,v]}; closed => wrap i.
function gridGeometry(verts, closed, flip) {
  const K = verts.length, N = verts[0].length;
  const pos = [], uvs = [], idx = [];
  for (let k = 0; k < K; k++) for (let i = 0; i < N; i++) {
    pos.push(...verts[k][i].p);
    uvs.push(...verts[k][i].uv);
  }
  const segs = closed ? N : N - 1;
  for (let k = 0; k < K - 1; k++) for (let i = 0; i < segs; i++) {
    const i2 = (i + 1) % N;
    const a = k * N + i, b = k * N + i2, c = (k + 1) * N + i, d = (k + 1) * N + i2;
    if (flip) idx.push(a, b, c, b, d, c);
    else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Body shell: stations = [{x, yb}], ascending x. uvFn(x, vLen) -> [u,v].
export function bodyShell(spec, stations, uvFn) {
  const verts = stations.map((s) => makeRing(spec, s.yb).map((p) => ({ p: [s.x, p.y, p.z], uv: uvFn(s.x, p.vLen) })));
  return gridGeometry(verts, true, false);
}

// Flat end cap at station s, facing +X (dir=1) or -X (dir=-1).
export function endCap(spec, s, dir, uv) {
  const rows = ringRows(makeRing(spec, s.yb));
  const verts = rows.map((row) => row.map((p) => ({ p: [s.x, p.y, p.z], uv })));
  return gridGeometry(verts, false, dir < 0);
}

// Nose: loft from the body ring at xc to an inset face ring, then a face grid.
// face: { xc, xFace(y,z) -> x, inset: {rS, rT, rB}, steps, uvFn(y,z) -> [u,v] }
export function nose(spec, yb, face) {
  const P = makeRing(spec, yb);
  const { rS, rT, rB } = face.inset;
  const qspec = { ...spec, halfW: spec.halfW - rS, H: spec.H - rT, yCant: spec.yCant - rT * 0.5, zTop: Math.max(0.05, (spec.zTop ?? 0.3) - rS * 0.3) };
  const Q = makeRing(qspec, yb + rB);
  const steps = face.steps ?? 5;
  const verts = [];
  for (let k = 0; k <= steps; k++) {
    const phi = (k / steps) * (Math.PI / 2);
    const a = 1 - Math.cos(phi), b = Math.sin(phi);
    verts.push(P.map((p, i) => {
      const q = Q[i];
      const y = p.y + (q.y - p.y) * a, z = p.z + (q.z - p.z) * a;
      const xq = Math.max(face.xc + 0.03, face.xFace(q.y, q.z));
      const x = face.xc + (xq - face.xc) * b;
      return { p: [x, y, z], uv: face.uvFn(y, z) };
    }));
  }
  const loft = gridGeometry(verts, true, false);
  const rows = ringRows(Q);
  const fverts = rows.map((row) => row.map((p) => ({ p: [Math.max(face.xc + 0.03, face.xFace(p.y, p.z)), p.y, p.z], uv: face.uvFn(p.y, p.z) })));
  const grid = gridGeometry(fverts, false, false);
  return [loft, grid];
}

// A quad patch lying on the front face (glass, lamps); follows xFace with offset.
export function facePatch(face, z0, z1, y0, y1, nz, ny, off, uv) {
  const verts = [];
  for (let j = 0; j <= ny; j++) {
    const row = [];
    const y = y0 + ((y1 - y0) * j) / ny;
    for (let i = 0; i <= nz; i++) {
      const z = z0 + ((z1 - z0) * i) / nz;
      row.push({ p: [face.xFace(y, z) + off, y, z], uv: uv || [0.5, 0.5] });
    }
    verts.push(row);
  }
  // rows ascend in y, columns ascend in z; outward normal +X
  return gridGeometry(verts, false, false);
}

// Disc lamp on the face at (y,z), radius r, facing +X tilted by local rake.
export function faceLamp(face, y, z, r, seg = 10, off = 0.012) {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateY(Math.PI / 2); // normal -> +X
  const dy = 0.05;
  const slope = (face.xFace(y + dy, z) - face.xFace(y - dy, z)) / (2 * dy); // dx/dy
  g.rotateZ(Math.atan(-slope));
  g.translate(face.xFace(y, z) + off, y, z);
  return g;
}

// Glass quads on both body sides following the tumblehome. rect: {x0,x1,y0,y1}
export function sideGlass(spec, rects, off = 0.008, uv = [0.5, 0.5], rows = 3) {
  const pos = [], uvs = [], idx = [];
  let base = 0;
  for (const r of rects) {
    const nr = r.y1 - r.y0 > 0.4 ? rows : 1;
    for (const s of [1, -1]) {
      for (let j = 0; j <= nr; j++) {
        const y = r.y0 + ((r.y1 - r.y0) * j) / nr;
        const z = (sideZ(spec, y) + off) * s;
        pos.push(r.x0, y, z, r.x1, y, z);
        const v = j / nr; // 0 = bottom of window, 1 = top (emissive gradient)
        uvs.push(0.25, v, 0.75, v);
      }
      for (let j = 0; j < nr; j++) {
        const a = base + 2 * j, b = a + 1, c = a + 2, d = a + 3;
        if (s > 0) idx.push(a, b, d, a, d, c);
        else idx.push(a, d, b, a, c, d);
      }
      base += 2 * (nr + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Running gear
// ---------------------------------------------------------------------------
export function bogie(bucket, mats, x, o) {
  const { wheelR = 0.43, wheelbase = 2.5, gauge = 1.435, high = true, frameZ = 1.0 } = o;
  const dark = mats.dark;
  const zw = gauge / 2 + 0.035;
  const seg = high ? 14 : 6;
  for (const dx of [-wheelbase / 2, wheelbase / 2]) {
    for (const s of [1, -1]) {
      bucket.add(dark, cylZ(wheelR, 0.13, seg, x + dx, wheelR, s * zw));
      if (high) bucket.add(dark, box(0.36, 0.26, 0.16, x + dx, wheelR, s * (frameZ + 0.02))); // axle box
    }
    if (high) bucket.add(dark, cylZ(0.08, 2 * zw, 6, x + dx, wheelR, 0));
  }
  if (!high) {
    bucket.add(dark, box(wheelbase + 0.8, 0.45, 2 * frameZ, x, wheelR + 0.1, 0));
    return;
  }
  const fy = wheelR + 0.12;
  for (const s of [1, -1]) {
    // side frame with dropped centre
    bucket.add(dark, box(wheelbase + 0.75, 0.2, 0.16, x, fy + 0.08, s * frameZ));
    bucket.add(dark, box(1.0, 0.24, 0.18, x, fy - 0.05, s * frameZ));
    // primary springs
    for (const dx of [-wheelbase / 2 + 0.35, wheelbase / 2 - 0.35]) bucket.add(dark, cylY(0.09, 0.22, 6, x + dx, fy + 0.25, s * frameZ));
    // air spring (secondary)
    bucket.add(mats.misc, cylY(0.24, 0.22, 10, x, fy + 0.35, s * (frameZ - 0.12)));
    // brake units
    for (const dx of [-wheelbase / 2 + wheelR + 0.12, wheelbase / 2 - wheelR - 0.12]) bucket.add(dark, box(0.18, 0.22, 0.2, x + dx, wheelR, s * (zw - 0.2)));
  }
  bucket.add(dark, box(0.55, 0.28, 2 * frameZ, x, fy + 0.02, 0)); // transom / bolster
  // traction motor / gearbox blocks
  for (const dx of [-wheelbase / 2 + 0.55, wheelbase / 2 - 0.55]) bucket.add(dark, box(0.5, 0.4, 0.9, x + dx, wheelR + 0.05, 0));
}

// Single-arm pantograph, base on roof at (x, roofY), raised head at headY.
export function pantograph(bucket, mats, x, roofY, headY, o = {}) {
  const { headW = 1.7, high = true, dir = 1 } = o;
  const dark = mats.dark, misc = mats.misc;
  if (!high) {
    bucket.add(dark, box(1.4, 0.12, 1.0, x, roofY + 0.12, 0));
    bucket.add(misc, beam([x - 0.6 * dir, roofY + 0.2, 0], [x + 0.1 * dir, headY, 0], 0.08, 0.5));
    bucket.add(misc, box(0.12, 0.05, headW, x, headY, 0));
    return;
  }
  // insulators + base frame
  for (const dx of [-0.6, 0.6]) for (const s of [1, -1]) bucket.add(misc, cylY(0.07, 0.22, 8, x + dx, roofY + 0.11, s * 0.42));
  bucket.add(dark, box(1.5, 0.08, 0.08, x, roofY + 0.26, 0.42));
  bucket.add(dark, box(1.5, 0.08, 0.08, x, roofY + 0.26, -0.42));
  bucket.add(dark, box(0.08, 0.08, 0.92, x - 0.7, roofY + 0.26, 0));
  bucket.add(dark, box(0.08, 0.08, 0.92, x + 0.7, roofY + 0.26, 0));
  const hinge = [x - 0.55 * dir, roofY + 0.32];
  const head = [x + 0.05 * dir, headY - 0.12];
  const knee = [x + 0.95 * dir, roofY + 0.32 + (headY - roofY) * 0.45];
  // lower arm (two tubes), upper arm (one tube) and push rod
  for (const s of [1, -1]) bucket.add(misc, beam([hinge[0], hinge[1], s * 0.25], [knee[0], knee[1], s * 0.08], 0.07));
  bucket.add(misc, beam([knee[0], knee[1], 0], [head[0], head[1], 0], 0.055));
  bucket.add(misc, beam([hinge[0] + 0.15 * dir, hinge[1], 0], [knee[0] - 0.05 * dir, knee[1] - 0.05, 0], 0.03));
  bucket.add(dark, cylY(0.1, 0.18, 8, hinge[0] - 0.15 * dir, hinge[1] + 0.02, 0)); // drive
  // head: frame + two carbon strips + horns
  bucket.add(misc, box(0.5, 0.04, 0.05, head[0], head[1] + 0.06, 0));
  for (const dx of [-0.2, 0.2]) {
    bucket.add(dark, box(0.06, 0.05, headW - 0.4, head[0] + dx, headY, 0));
    for (const s of [1, -1]) bucket.add(misc, beam([head[0] + dx, headY, s * (headW / 2 - 0.2)], [head[0] + dx, headY - 0.15, s * (headW / 2)], 0.035));
  }
  bucket.add(misc, box(0.45, 0.04, 0.04, head[0], headY - 0.05, 0.5));
  bucket.add(misc, box(0.45, 0.04, 0.04, head[0], headY - 0.05, -0.5));
}

// Vertical prism with a rounded plan (skirts, bumpers). Front at xTip, rear at xBack,
// half width hw, front corners rounded with radius rc. y0..y1 vertical extent.
export function planPrism(xBack, xTip, hw, rc, y0, y1, uv) {
  const sh = new THREE.Shape();
  sh.moveTo(xBack, -hw);
  sh.lineTo(xTip - rc, -hw);
  sh.quadraticCurveTo(xTip, -hw, xTip, -hw + rc);
  sh.lineTo(xTip, hw - rc);
  sh.quadraticCurveTo(xTip, hw, xTip - rc, hw);
  sh.lineTo(xBack, hw);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: false, curveSegments: 5 });
  g.rotateX(Math.PI / 2);
  g.translate(0, y1, 0);
  if (uv) setUV(g, uv);
  return g;
}
