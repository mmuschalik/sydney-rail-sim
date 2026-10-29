// Instanced rendering of every car of every active train.
// Fleet models (Groups) are flattened into one geometry per material and drawn with
// InstancedMesh. Each car is positioned from its two bogie points on the track so it
// follows curves and gradients correctly.
import * as THREE from 'three';
import { fleet, formationOf } from '../models/trains/index.js';

const HIGH_DIST = 650;
const LOW_DIST = 14000;

function flatten(group) {
  group.updateMatrixWorld(true);
  const byMat = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const groups = Array.isArray(o.material) && g.groups.length ? g.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
    for (const gr of groups) {
      const m = mats[gr.materialIndex ?? 0];
      if (!byMat.has(m)) byMat.set(m, []);
      byMat.get(m).push(sub(g, gr.start, gr.count));
    }
  });
  const parts = [];
  for (const [m, list] of byMat) parts.push({ material: m, geometry: concat(list) });
  return parts;
}

function sub(g, start, count) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = g.attributes[name];
    out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize));
  }
  return out;
}

function concat(list) {
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    let n = 0; for (const g of list) n += g.attributes[name].array.length;
    const arr = new Float32Array(n);
    let o = 0; for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

const LIGHT_ON = new THREE.Color(1, 1, 1);
const TAIL_ON = new THREE.Color(1, 0.05, 0.03);
const OFF = new THREE.Color(0.02, 0.02, 0.02);

export class TrainRenderer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'trains';
    scene.add(this.group);
    this.kinds = new Map(); // key fleet|variant|lod -> {parts:[{mesh, material, kind}], count}
    this.glass = new Set();
    this.night = 0;
    this.markerGeom = new THREE.BufferGeometry();
    this.markerPos = new Float32Array(3 * 1024);
    this.markerCol = new Float32Array(3 * 1024);
    this.markerGeom.setAttribute('position', new THREE.BufferAttribute(this.markerPos, 3));
    this.markerGeom.setAttribute('color', new THREE.BufferAttribute(this.markerCol, 3));
    this.markers = new THREE.Points(this.markerGeom, new THREE.PointsMaterial({
      size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true, map: dotTexture(), alphaTest: 0.3,
    }));
    this.markers.renderOrder = 10;
    this.markers.frustumCulled = false;
    scene.add(this.markers);
    this.tmp = { pf: new THREE.Vector3(), pr: new THREE.Vector3() };
    // light glows (headlights white, tail lights red), additive sprites
    this.glowMax = 4096;
    this.glowPos = new Float32Array(this.glowMax * 3);
    this.glowCol = new Float32Array(this.glowMax * 3);
    this.glowGeom = new THREE.BufferGeometry();
    this.glowGeom.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3));
    this.glowGeom.setAttribute('color', new THREE.BufferAttribute(this.glowCol, 3));
    this.glows = new THREE.Points(this.glowGeom, new THREE.PointsMaterial({
      size: 1.6, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, map: glowTexture(), toneMapped: false,
    }));
    this.glows.frustumCulled = false;
    scene.add(this.glows);
  }

  kind(code, variant, lod) {
    const key = `${code}|${variant}|${lod}`;
    let k = this.kinds.get(key);
    if (k) return k;
    const spec = fleet(code);
    let grp;
    try { grp = spec.build(variant, lod); } catch (e) { grp = spec.build(variant === 'leadRev' ? 'lead' : 'mid', lod); }
    const parts = flatten(grp).map(({ material, geometry }) => {
      let mat = material;
      let light = null;
      if (material.name === 'headlight' || material.name === 'taillight') {
        light = material.name;
        mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      }
      if (material.userData?.nightEmissive) this.glass.add(material);
      const mesh = new THREE.InstancedMesh(geometry, mat, 64);
      mesh.count = 0;
      mesh.castShadow = lod === 'high' && !light;
      mesh.receiveShadow = lod === 'high';
      mesh.frustumCulled = false;
      if (light) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
      this.group.add(mesh);
      return { mesh, light };
    });
    k = { parts, n: 0, spec };
    this.kinds.set(key, k);
    return k;
  }

  ensure(k, n) {
    for (const p of k.parts) {
      const cap = p.mesh.instanceMatrix.count;
      if (n <= cap) continue;
      let ncap = cap;
      while (ncap < n) ncap *= 2;
      const m = new THREE.InstancedMesh(p.mesh.geometry, p.mesh.material, ncap);
      m.castShadow = p.mesh.castShadow; m.receiveShadow = p.mesh.receiveShadow; m.frustumCulled = false;
      m.instanceMatrix.array.set(p.mesh.instanceMatrix.array);
      if (p.light) {
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ncap * 3), 3);
        m.instanceColor.array.set(p.mesh.instanceColor.array);
      }
      this.group.remove(p.mesh); p.mesh.dispose();
      this.group.add(m);
      p.mesh = m;
    }
  }

  push(k, matrix, lightState) {
    const i = k.n++;
    this.ensure(k, k.n);
    for (const p of k.parts) {
      p.mesh.setMatrixAt(i, matrix);
      if (p.light) {
        const c = lightState === 0 ? OFF : p.light === 'headlight' ? (lightState === 1 ? LIGHT_ON : OFF) : (lightState === 2 ? TAIL_ON : OFF);
        p.mesh.setColorAt(i, c);
      }
    }
  }

  update(trains, camera, opts = {}) {
    for (const k of this.kinds.values()) k.n = 0;
    const cam = camera.position;
    const m = new THREE.Matrix4();
    const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), C = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const { pf, pr } = this.tmp;
    let mk = 0, gk = 0;
    const addGlow = (p, X, Z, fwd, side, r, g, b) => {
      if (gk >= this.glowMax) return;
      this.glowPos[gk * 3] = p.x + X.x * fwd + Z.x * side; this.glowPos[gk * 3 + 1] = p.y + 1.1; this.glowPos[gk * 3 + 2] = p.z + X.z * fwd + Z.z * side;
      this.glowCol[gk * 3] = r; this.glowCol[gk * 3 + 1] = g; this.glowCol[gk * 3 + 2] = b; gk++;
    };
    const alt = cam.y;
    this.visibleTrains = [];
    for (const tr of trains) {
      if (tr.state === 'pending' || tr.state === 'done') continue;
      const path = tr.path;
      path.pointAt(tr.s - tr.length / 2, C);
      const dist = C.distanceTo(cam);
      // overview marker
      if (mk < 1024) {
        this.markerPos[mk * 3] = C.x; this.markerPos[mk * 3 + 1] = C.y + 4; this.markerPos[mk * 3 + 2] = C.z;
        const col = tr.colorObj || (tr.colorObj = new THREE.Color('#' + (tr.trip.c || '888888')));
        const sel = opts.selected === tr;
        this.markerCol[mk * 3] = sel ? 1 : col.r; this.markerCol[mk * 3 + 1] = sel ? 1 : col.g; this.markerCol[mk * 3 + 2] = sel ? 1 : col.b;
        mk++;
      }
      tr.screenPos = C.clone();
      if (dist > LOW_DIST) continue;
      this.visibleTrains.push(tr);
      const lod = dist < HIGH_DIST ? 'high' : 'low';
      const spec = tr.spec;
      const code = tr.fleetCode;
      const cl = spec.carLength;
      const overhang = (cl - spec.bogieCentres) / 2;
      const vars = tr._form && tr._formN === tr.cars ? tr._form : (tr._form = formationOf(code, tr.cars), tr._formN = tr.cars, tr._form);
      const night = this.night > 0.3 || (opts.tunnelLights && (path.flagsAt(tr.s) & 1));
      for (let i = 0; i < tr.cars; i++) {
        const sf = tr.s - i * cl - overhang;
        path.pointAt(sf, pf);
        path.pointAt(sf - spec.bogieCentres, pr);
        X.subVectors(pf, pr).normalize();
        Z.crossVectors(X, up).normalize();
        Y.crossVectors(Z, X);
        C.addVectors(pf, pr).multiplyScalar(0.5);
        let variant = vars[i];
        let flip = false;
        if (i === tr.cars - 1 && variant === 'lead') flip = true;
        if (flip) { X.negate(); Z.negate(); }
        m.makeBasis(X, Y, Z);
        m.setPosition(C);
        // light state: front cab = headlights, rear cab = tail lights
        let ls = 0;
        if (i === 0) ls = 1;
        else if (i === tr.cars - 1) ls = 2;
        if (ls === 1 && !night && tr.state === 'dwell') ls = 1;
        this.push(this.kind(code, variant, lod), m, ls);
        if (dist < 3000 && (i === 0 || i === tr.cars - 1)) {
          const half = cl / 2 - 0.1;
          const gi = 0.35 + this.night * 0.65;
          if (i === 0) { addGlow(C, X, Z, half, 0.8, gi, gi, gi * 0.92); addGlow(C, X, Z, half, -0.8, gi, gi, gi * 0.92); }
          else { addGlow(C, X, Z, half, 0.9, gi, 0.02, 0.01); addGlow(C, X, Z, half, -0.9, gi, 0.02, 0.01); }
        }
      }
    }
    for (const k of this.kinds.values()) {
      for (const p of k.parts) {
        p.mesh.count = k.n;
        p.mesh.instanceMatrix.needsUpdate = true;
        if (p.light && p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }
    }
    this.glowGeom.setDrawRange(0, gk);
    this.glowGeom.attributes.position.needsUpdate = true;
    this.glowGeom.attributes.color.needsUpdate = true;
    this.glows.material.size = 1.2 + this.night * 1.6;
    this.markerGeom.setDrawRange(0, mk);
    this.markerGeom.attributes.position.needsUpdate = true;
    this.markerGeom.attributes.color.needsUpdate = true;
    this.markers.visible = alt > 900 || !!opts.markers;
    this.markers.material.size = alt > 15000 ? 5 : 7;
    for (const g of this.glass) g.emissiveIntensity = this.night * 1.1;
  }
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.2, 'rgba(255,255,255,0.7)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(16, 16, 13, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = 4; g.stroke();
  const t = new THREE.CanvasTexture(c);
  return t;
}
