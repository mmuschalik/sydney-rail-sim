// Track infrastructure rendering: ballast + sleepers, rails, overhead wiring, bridges,
// tunnel overlays, distant network lines. Geometry is chunked (4 km cells) with distance LOD.
import * as THREE from 'three';
import { FLAG } from '../sim/network.js';

const CELL = 4000;
const GAUGE_HALF = 0.7525;

function ballastTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512; // v across track (256 px = 3.0 m), u along (512 px = 2.4 m)
  const g = c.getContext('2d');
  // basalt ballast: grey-blue stones with darker gaps
  g.fillStyle = '#5d5b57'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 256, y = Math.random() * 512, r = 1.2 + Math.random() * 2.6;
    const l = 70 + Math.random() * 70;
    g.fillStyle = `rgb(${l * 1.02},${l},${l * 0.95})`;
    g.beginPath(); g.ellipse(x, y, r, r * (0.6 + Math.random() * 0.5), Math.random() * 3, 0, 7); g.fill();
  }
  // rust / brake dust between and near the rails
  const grd = g.createLinearGradient(0, 0, 256, 0);
  grd.addColorStop(0.18, 'rgba(92,58,36,0)'); grd.addColorStop(0.3, 'rgba(92,58,36,0.55)'); grd.addColorStop(0.5, 'rgba(80,52,34,0.35)');
  grd.addColorStop(0.7, 'rgba(92,58,36,0.55)'); grd.addColorStop(0.82, 'rgba(92,58,36,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 512);
  // concrete sleepers every 0.6 m, 2.5 m long, 0.22 m wide
  for (let k = 0; k < 4; k++) {
    const y = (k + 0.5) * 128 - 9;
    g.fillStyle = '#8f8a82'; g.fillRect(22, y, 212, 19);
    g.fillStyle = 'rgba(70,45,30,0.45)'; g.fillRect(22, y, 212, 19); // weathering
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(22, y + 16, 212, 3);
    g.fillStyle = '#2b2a28';
    for (const x of [64, 192]) { g.fillRect(x - 9, y + 2, 7, 15); g.fillRect(x + 2, y + 2, 7, 15); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

/** resample a polyline (Float32 xyz) to <= step spacing; returns arrays */
function resample(p, step) {
  const out = [];
  const n = p.length / 3;
  out.push(p[0], p[1], p[2]);
  for (let i = 1; i < n; i++) {
    const x0 = p[i * 3 - 3], y0 = p[i * 3 - 2], z0 = p[i * 3 - 1];
    const x1 = p[i * 3], y1 = p[i * 3 + 1], z1 = p[i * 3 + 2];
    const L = Math.hypot(x1 - x0, z1 - z0);
    const k = Math.max(1, Math.ceil(L / step));
    for (let j = 1; j <= k; j++) {
      const t = j / k;
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t);
    }
  }
  return out;
}

/** lateral unit normals (x,z) per point */
function normals(pts) {
  const n = pts.length / 3;
  const nx = new Float32Array(n), nz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = pts[b * 3] - pts[a * 3], dz = pts[b * 3 + 2] - pts[a * 3 + 2];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    nx[i] = -dz; nz[i] = dx; // left of travel direction
  }
  return { nx, nz };
}

class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; this.col = null; }
  get count() { return this.pos.length / 3; }
  v(x, y, z, nx, ny, nz, u, w) { this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, w); return this.count - 1; }
  geometry(origin) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(this.pos);
    for (let i = 0; i < p.length; i += 3) { p[i] -= origin.x; p[i + 2] -= origin.z; }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export class TrackRenderer {
  constructor(net, scene, opts = {}) {
    this.net = net;
    this.skipStructure = opts.skipStructure || (() => false);
    this.group = new THREE.Group();
    this.group.name = 'tracks';
    scene.add(this.group);
    this.cells = new Map();
    this.mats = {
      ballast: new THREE.MeshStandardMaterial({ map: ballastTexture(), roughness: 0.95, metalness: 0 }),
      rail: new THREE.MeshStandardMaterial({ color: 0x8d8a86, roughness: 0.35, metalness: 0.85 }),
      railSide: new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.8, metalness: 0.3 }),
      concrete: new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.9 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x6d7276, roughness: 0.6, metalness: 0.6 }),
      wire: new THREE.LineBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.85 }),
      shell: new THREE.MeshStandardMaterial({ color: 0x7d8fa3, roughness: 0.6, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
      far: new THREE.LineBasicMaterial({ color: 0xe8dcc8, transparent: true, opacity: 0.55 }),
      tunnel: new THREE.LineBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.55, depthTest: false }),
      metroTunnel: new THREE.LineBasicMaterial({ color: 0x2ad1c4, transparent: true, opacity: 0.6, depthTest: false }),
    };
    this.mats.ballast.polygonOffset = true; this.mats.ballast.polygonOffsetFactor = -1; this.mats.ballast.polygonOffsetUnits = -2;
    this.build();
  }

  cell(x, z) {
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    let c = this.cells.get(key);
    if (!c) {
      c = {
        key, origin: new THREE.Vector3((Math.floor(x / CELL) + 0.5) * CELL, 0, (Math.floor(z / CELL) + 0.5) * CELL),
        ballast: new Builder(), rails: new Builder(), deck: new Builder(), shell: new Builder(), wires: [], far: [], tunnel: [], metroTunnel: [], masts: [],
      };
      this.cells.set(key, c);
    }
    return c;
  }

  build() {
    const net = this.net;
    // spatial hash of track points to know if there is a neighbour track on either side
    const hash = new Map();
    const H = 8;
    const hkey = (x, z) => `${Math.floor(x / H)},${Math.floor(z / H)}`;
    const samples = [];
    for (const e of net.edges) {
      const pts = resample(e.p, 20);
      for (let i = 0; i < pts.length; i += 3) {
        const k = hkey(pts[i], pts[i + 2]);
        if (!hash.has(k)) hash.set(k, []);
        hash.get(k).push(e.id, pts[i], pts[i + 2]);
      }
      samples.push(pts);
    }
    const trackNear = (x, z, eid) => {
      const cx = Math.floor(x / H), cz = Math.floor(z / H);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const arr = hash.get(`${cx + i},${cz + j}`);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 3) {
          if (arr[k] === eid) continue;
          if (Math.hypot(arr[k + 1] - x, arr[k + 2] - z) < 5.5) return true;
        }
      }
      return false;
    };
    this.trackNear = trackNear;

    const mastMatrices = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);

    for (const e of net.edges) {
      const tunnel = (e.flags & FLAG.TUNNEL) !== 0;
      const bridge = (e.flags & FLAG.BRIDGE) !== 0;
      const metro = (e.flags & FLAG.METRO) !== 0;
      const pts = resample(e.p, 8);
      const n = pts.length / 3;
      const { nx, nz } = normals(pts);
      const c = this.cell(pts[0], pts[2]);
      // distant line representation
      const farArr = tunnel ? (metro ? c.metroTunnel : c.tunnel) : c.far;
      for (let i = 1; i < n; i++) farArr.push(pts[i * 3 - 3], pts[i * 3 - 2] + 1, pts[i * 3 - 1], pts[i * 3], pts[i * 3 + 1] + 1, pts[i * 3 + 2]);

      // ballast ribbon (also in tunnels, for underground views); slab track look on bridges
      const B = c.ballast;
      let u = 0;
      const base = B.count;
      for (let i = 0; i < n; i++) {
        const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
        if (i > 0) u += Math.hypot(x - pts[i * 3 - 3], z - pts[i * 3 - 1]) / 2.4;
        const w0 = bridge ? 2.0 : 2.3, w1 = 1.5;
        B.v(x + nx[i] * w0, y - 0.62, z + nz[i] * w0, nx[i] * 0.5, 0.86, nz[i] * 0.5, -0.12, u);
        B.v(x + nx[i] * w1, y - 0.2, z + nz[i] * w1, 0, 1, 0, 0.0, u);
        B.v(x - nx[i] * w1, y - 0.2, z - nz[i] * w1, 0, 1, 0, 1.0, u);
        B.v(x - nx[i] * w0, y - 0.62, z - nz[i] * w0, -nx[i] * 0.5, 0.86, -nz[i] * 0.5, 1.12, u);
        if (i > 0) {
          const a = base + (i - 1) * 4, b = base + i * 4;
          for (let s = 0; s < 3; s++) B.idx.push(a + s, b + s, a + s + 1, a + s + 1, b + s, b + s + 1);
        }
      }
      // rails: top + two sides each
      const R = c.rails;
      for (const side of [1, -1]) {
        const rb = R.count;
        for (let i = 0; i < n; i++) {
          const x = pts[i * 3] + nx[i] * side * GAUGE_HALF, y = pts[i * 3 + 1], z = pts[i * 3 + 2] + nz[i] * side * GAUGE_HALF;
          const hx = nx[i] * 0.036, hz = nz[i] * 0.036;
          R.v(x + hx, y - 0.17, z + hz, nx[i], 0, nz[i], 0, 0);
          R.v(x + hx, y, z + hz, nx[i], 0.3, nz[i], 0, 0);
          R.v(x - hx, y, z - hz, -nx[i], 0.3, -nz[i], 0, 0);
          R.v(x - hx, y - 0.17, z - hz, -nx[i], 0, -nz[i], 0, 0);
          if (i > 0) {
            const a = rb + (i - 1) * 4, b = rb + i * 4;
            for (let s = 0; s < 3; s++) R.idx.push(a + s, a + s + 1, b + s, a + s + 1, b + s + 1, b + s);
          }
        }
      }
      // tunnel shell (shown in x-ray mode): walls + arched roof as a ribbon
      if (tunnel) {
        const S = c.shell;
        const prof = [[-2.4, -0.7], [-2.6, 2.5], [-1.8, 5.0], [0, 5.8], [1.8, 5.0], [2.6, 2.5], [2.4, -0.7]];
        const sb = S.count;
        for (let i = 0; i < n; i++) {
          const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
          for (const [lx, ly] of prof) S.v(x + nx[i] * lx, y + ly, z + nz[i] * lx, nx[i] * Math.sign(lx), ly > 4 ? 1 : 0, nz[i] * Math.sign(lx), 0, 0);
          if (i > 0) {
            const a = sb + (i - 1) * prof.length, b = sb + i * prof.length;
            for (let k = 0; k < prof.length - 1; k++) S.idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
          }
        }
      }
      // bridge deck + piers
      if (bridge && !this.skipStructure(pts[Math.floor(n / 2) * 3], pts[Math.floor(n / 2) * 3 + 2])) {
        const D = c.deck;
        const db = D.count;
        for (let i = 0; i < n; i++) {
          const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
          D.v(x + nx[i] * 2.6, y - 0.6, z + nz[i] * 2.6, nx[i], 0, nz[i], 0, 0);
          D.v(x + nx[i] * 2.6, y - 2.2, z + nz[i] * 2.6, nx[i], 0, nz[i], 0, 0);
          D.v(x - nx[i] * 2.6, y - 2.2, z - nz[i] * 2.6, 0, -1, 0, 0, 0);
          D.v(x - nx[i] * 2.6, y - 0.6, z - nz[i] * 2.6, -nx[i], 0, -nz[i], 0, 0);
          if (i > 0) {
            const a = db + (i - 1) * 4, b = db + i * 4;
            for (let s = 0; s < 3; s++) D.idx.push(a + s, a + s + 1, b + s, a + s + 1, b + s + 1, b + s);
          }
        }
        // piers every ~30 m (tall boxes descending below terrain)
        let acc = 0;
        for (let i = 1; i < n; i++) {
          acc += Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 2] - pts[i * 3 - 1]);
          if (acc >= 30) {
            acc = 0;
            const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
            const ang = Math.atan2(nx[i], nz[i]);
            const pb = D.count;
            const h = 70, w = 1.4, l = 0.9;
            const cs = Math.cos(ang), sn = Math.sin(ang);
            const corners = [[-w, -l], [w, -l], [w, l], [-w, l]].map(([a, b2]) => [x + a * sn + b2 * cs, z + a * cs - b2 * sn]);
            for (const [px, pz] of corners) { D.v(px, y - 2.2, pz, px - x, 0, pz - z, 0, 0); D.v(px, y - 2.2 - h, pz, px - x, 0, pz - z, 0, 0); }
            for (let s = 0; s < 4; s++) {
              const a = pb + s * 2, b2 = pb + ((s + 1) % 4) * 2;
              D.idx.push(a, a + 1, b2, b2, a + 1, b2 + 1);
            }
          }
        }
      }
      // overhead wiring: contact + catenary wires, masts every ~55 m on the outer side
      if ((e.flags & FLAG.ELECTRIFIED) && !tunnel) {
        for (let i = 1; i < n; i++) {
          const x0 = pts[i * 3 - 3], y0 = pts[i * 3 - 2], z0 = pts[i * 3 - 1];
          const x1 = pts[i * 3], y1 = pts[i * 3 + 1], z1 = pts[i * 3 + 2];
          c.wires.push(x0, y0 + 5.4, z0, x1, y1 + 5.4, z1);
          c.wires.push(x0, y0 + 6.5, z0, x1, y1 + 6.5, z1);
        }
        let acc = 27;
        for (let i = 1; i < n; i++) {
          acc += Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 2] - pts[i * 3 - 1]);
          if (acc < 55) continue;
          acc = 0;
          const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
          let side = 0;
          if (!trackNear(x + nx[i] * 4.2, z + nz[i] * 4.2, e.id)) side = 1;
          else if (!trackNear(x - nx[i] * 4.2, z - nz[i] * 4.2, e.id)) side = -1;
          if (!side) continue;
          const mx = x + nx[i] * side * 3.1, mz = z + nz[i] * side * 3.1;
          q.setFromAxisAngle(up, Math.atan2(nx[i] * side, nz[i] * side));
          m4.compose(new THREE.Vector3(mx, y - 0.6, mz), q, sc);
          mastMatrices.push(m4.clone());
          c.wires.push(x, y + 5.4, z, x, y + 6.5, z); // dropper at mast
        }
      }
    }

    // assemble per cell
    for (const c of this.cells.values()) {
      const grp = new THREE.Group();
      grp.position.copy(c.origin);
      const o = c.origin;
      if (c.ballast.count) { const m = new THREE.Mesh(c.ballast.geometry(o), this.mats.ballast); m.receiveShadow = true; grp.add(m); c.ballastMesh = m; }
      if (c.rails.count) { c.railMesh = new THREE.Mesh(c.rails.geometry(o), this.mats.rail); grp.add(c.railMesh); }
      if (c.shell.count) {
        c.shellMesh = new THREE.Mesh(c.shell.geometry(o), this.mats.shell);
        c.shellMesh.renderOrder = 3; c.shellMesh.visible = false; grp.add(c.shellMesh);
      }
      if (c.deck.count) { const m = new THREE.Mesh(c.deck.geometry(o), this.mats.concrete); m.castShadow = true; m.receiveShadow = true; grp.add(m); }
      const lines = (arr, mat) => {
        if (!arr.length) return null;
        const f = new Float32Array(arr);
        for (let i = 0; i < f.length; i += 3) { f[i] -= o.x; f[i + 2] -= o.z; }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(f, 3));
        const l = new THREE.LineSegments(g, mat); grp.add(l); return l;
      };
      c.wireMesh = lines(c.wires, this.mats.wire);
      c.farMesh = lines(c.far, this.mats.far);
      c.tunnelMesh = lines(c.tunnel, this.mats.tunnel);
      c.metroTunnelMesh = lines(c.metroTunnel, this.mats.metroTunnel);
      if (c.tunnelMesh) c.tunnelMesh.renderOrder = 5;
      if (c.metroTunnelMesh) c.metroTunnelMesh.renderOrder = 5;
      c.group = grp;
      this.group.add(grp);
      delete c.ballast; delete c.rails; delete c.deck; delete c.shell; delete c.wires; delete c.far; delete c.tunnel; delete c.metroTunnel;
    }

    // masts: instanced I-beam pole + cantilever arm
    const pole = new THREE.BoxGeometry(0.3, 7.6, 0.25); pole.translate(0, 3.8, 0);
    const arm = new THREE.BoxGeometry(0.1, 0.1, 3.4); arm.translate(0, 6.6, -1.7);
    const brace = new THREE.BoxGeometry(0.06, 0.06, 3.3); brace.rotateX(-0.33); brace.translate(0, 6.0, -1.6);
    const reg = new THREE.BoxGeometry(0.05, 1.2, 0.05); reg.translate(0, 6.0, -3.1);
    const mg = mergeGeoms([pole, arm, brace, reg]);
    this.masts = new THREE.InstancedMesh(mg, this.mats.steel, mastMatrices.length);
    mastMatrices.forEach((m, i) => this.masts.setMatrixAt(i, m));
    this.masts.castShadow = true;
    this.masts.computeBoundingSphere();
    this.group.add(this.masts);
    this.mastCount = mastMatrices.length;
  }

  /** distance LOD per cell + tunnel overlay toggle */
  update(camera, opts = {}) {
    const cp = camera.position;
    const alt = Math.max(0, cp.y);
    for (const c of this.cells.values()) {
      const d = Math.hypot(c.origin.x - cp.x, c.origin.z - cp.z) - CELL * 0.7;
      const dist3 = Math.hypot(Math.max(d, 0), alt);
      if (c.railMesh) c.railMesh.visible = dist3 < 2500;
      if (c.wireMesh) c.wireMesh.visible = dist3 < 2200;
      if (c.ballastMesh) c.ballastMesh.visible = dist3 < 9000;
      if (c.farMesh) c.farMesh.visible = dist3 > 1500;
      const xray = opts.xray || alt > 600;
      if (c.tunnelMesh) c.tunnelMesh.visible = xray && dist3 > 800;
      if (c.metroTunnelMesh) c.metroTunnelMesh.visible = xray && dist3 > 800;
      if (c.shellMesh) c.shellMesh.visible = !!opts.xray && dist3 < 4000;
    }
    this.masts.visible = alt < 2500;
  }
}

export function mergeGeoms(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const idx = [];
  let o = 0;
  for (const g0 of list) {
    const g = g0.index ? g0 : g0;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.index) for (const i of g.index.array) idx.push(i + o);
    else for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + o);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}
