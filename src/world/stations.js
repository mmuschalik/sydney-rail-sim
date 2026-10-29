// Station platforms (from OSM), awnings, and station name labels.
import * as THREE from 'three';
import { mergeGeoms } from './tracks.js';

function concreteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 175 + Math.random() * 25;
    img.data[i] = n; img.data[i + 1] = n * 0.98; img.data[i + 2] = n * 0.94; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class StationRenderer {
  constructor(net, scene, lift) {
    this.group = new THREE.Group();
    this.group.name = 'stations';
    scene.add(this.group);
    const tex = concreteTexture();
    this.matTop = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    this.matSide = new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.9 });
    this.matEdge = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 });
    this.matRoof = new THREE.MeshStandardMaterial({ color: 0xd9dcdf, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide });
    this.matPost = new THREE.MeshStandardMaterial({ color: 0x2f4f6f, roughness: 0.5, metalness: 0.4 });
    this.matLamp = new THREE.MeshBasicMaterial({ color: 0xfff1d0, toneMapped: false });
    this.matLamp.userData.nightLamp = true;

    const tops = [], sides = [], roofs = [], posts = [], edges = [], lamps = [];
    for (const p of net.platforms) {
      const y = p.y + lift - 0.05;
      let ring = [];
      for (let i = 0; i < p.p.length; i += 2) ring.push(new THREE.Vector2(p.p[i], p.p[i + 1]));
      if (!p.c) ring = bufferLine(ring, 1.8);
      if (ring.length < 3) continue;
      if (ring[0].distanceTo(ring[ring.length - 1]) < 0.01) ring.pop();
      // shape in x / -z so ExtrudeGeometry (in XY) maps to ground after rotation
      const shape = new THREE.Shape(ring.map((v) => new THREE.Vector2(v.x, -v.y)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: 1.15, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      g.translate(0, y - 1.15, 0);
      // ExtrudeGeometry groups: 0 = caps, 1 = sides
      const capG = splitGroup(g, 0), sideG = splitGroup(g, 1);
      // planar UVs on the top
      const pos = capG.attributes.position;
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / 6; uv[i * 2 + 1] = pos.getZ(i) / 6; }
      capG.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      tops.push(capG); sides.push(sideG);
      // yellow safety line along the platform edge (thin band slightly above top on the outline)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const L = a.distanceTo(b);
        if (L < 8) continue;
        const e = new THREE.BoxGeometry(L, 0.02, 0.12);
        e.rotateY(-Math.atan2(b.y - a.y, b.x - a.x));
        e.translate((a.x + b.x) / 2, y + 0.01, (a.y + b.y) / 2);
        edges.push(e);
      }
      // awning over the central part of surface platforms
      if (!p.u) {
        const obb = orientedBox(ring);
        if (obb.len > 30 && obb.wid > 2.5) {
          const roofLen = Math.min(obb.len * 0.45, 90);
          const rg = new THREE.BoxGeometry(roofLen, 0.15, Math.max(obb.wid - 0.6, 2.4));
          rg.rotateY(-obb.angle);
          rg.translate(obb.cx, y + 3.6, obb.cz);
          roofs.push(rg);
          for (let k = -2; k <= 2; k++) {
            const t = (k / 4) * roofLen * 0.9;
            const px = obb.cx + Math.cos(obb.angle) * t, pz = obb.cz + Math.sin(obb.angle) * t;
            const pg = new THREE.CylinderGeometry(0.09, 0.09, 3.6, 8);
            pg.translate(px, y + 1.8, pz);
            posts.push(pg);
            const lg = new THREE.BoxGeometry(1.2, 0.06, 0.18);
            lg.rotateY(-obb.angle);
            lg.translate(px, y + 3.5, pz);
            lamps.push(lg);
          }
        }
      }
    }
    const add = (list, mat, shadow) => {
      if (!list.length) return;
      const m = new THREE.Mesh(mergeAll(list), mat);
      m.castShadow = shadow; m.receiveShadow = true;
      this.group.add(m);
    };
    add(tops, this.matTop, false);
    add(sides, this.matSide, false);
    add(edges, this.matEdge, false);
    add(roofs, this.matRoof, true);
    add(posts, this.matPost, true);
    add(lamps, this.matLamp, false);

    // labels
    this.labels = [];
    for (const [id, s] of Object.entries(net.stations)) {
      const spr = labelSprite(s.n);
      spr.position.set(s.x, 60, s.z);
      spr.userData.station = id;
      this.labels.push(spr);
      this.group.add(spr);
    }
  }

  setNight(f) {
    this.matLamp.color.setScalar(0.25 + f * 0.95);
  }

  update(camera, heightAt) {
    const cp = camera.position;
    for (const l of this.labels) {
      if (!l.userData.grounded && heightAt) {
        const h = heightAt(l.position.x, l.position.z);
        if (h != null) { l.position.y = h + 35; l.userData.grounded = true; }
      }
      const d = l.position.distanceTo(cp);
      l.visible = d < 6000 && cp.y > 80;
      const s = Math.max(6, d * 0.016);
      l.scale.set(s * l.userData.aspect, s, 1);
    }
  }
}

function labelSprite(text) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const fs = 44;
  g.font = `600 ${fs}px "Helvetica Neue", Arial, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 60;
  c.width = w; c.height = 72;
  g.font = `600 ${fs}px "Helvetica Neue", Arial, sans-serif`;
  g.fillStyle = 'rgba(12,20,32,0.82)';
  roundRect(g, 0, 6, w, 60, 14); g.fill();
  g.fillStyle = '#f6a800';
  g.beginPath(); g.arc(28, 36, 12, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff';
  g.fillText(text, 48, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true });
  const s = new THREE.Sprite(m);
  s.userData.aspect = w / 72;
  s.renderOrder = 20;
  s.center.set(0.5, 0);
  return s;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function bufferLine(pts, w) {
  if (pts.length < 2) return [];
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const d = new THREE.Vector2().subVectors(b, a).normalize();
    const n = new THREE.Vector2(-d.y, d.x).multiplyScalar(w);
    left.push(pts[i].clone().add(n)); right.push(pts[i].clone().sub(n));
  }
  return [...left, ...right.reverse()];
}

function orientedBox(ring) {
  // principal axis via longest edge direction
  let best = 0, ang = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = a.distanceTo(b);
    if (L > best) { best = L; ang = Math.atan2(b.y - a.y, b.x - a.x); }
  }
  const c = Math.cos(ang), s = Math.sin(ang);
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (const p of ring) {
    const u = p.x * c + p.y * s, v = -p.x * s + p.y * c;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  return { angle: ang, len: u1 - u0, wid: v1 - v0, cx: uc * c - vc * s, cz: uc * s + vc * c };
}

function splitGroup(g, gi) {
  const gr = g.groups.filter((x) => x.materialIndex === gi);
  const src = g.index ? g.toNonIndexed() : g;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const a = src.attributes[name];
    const parts = gr.map((x) => a.array.slice(x.start * 3, (x.start + x.count) * 3));
    let n = 0; parts.forEach((p) => (n += p.length));
    const arr = new Float32Array(n); let o = 0; parts.forEach((p) => { arr.set(p, o); o += p.length; });
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  return out;
}

function mergeAll(list) {
  const nonIdx = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of nonIdx) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of nonIdx) {
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}
export { mergeAll };
