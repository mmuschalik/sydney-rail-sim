// Streams OSM building chunks around the camera; meshes are built in a worker pool.
import * as THREE from 'three';

export class Buildings {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    scene.add(this.group);
    this.chunks = new Map(); // key -> {state, mesh}
    this.index = null;
    this.workers = [];
    this.busy = 0;
    this.queue = [];
    this.night = 0;
    this.uniforms = { uNight: { value: 0 } };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = this.uniforms.uNight;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 wuv;\nvarying vec2 vW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = wuv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uNight;
varying vec2 vW;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (vW.x >= 0.0) {
  float seed = floor(vW.y / 1000.0);
  float v = mod(vW.y, 1000.0);
  vec2 g = vec2(vW.x / 2.7, v / 3.4);
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float fw = max(max(fwidth(g.x), fwidth(g.y)), 1e-4);
  float aa = 1.0 - smoothstep(0.25, 0.7, fw);   // fade pattern when sub-pixel
  float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.28, f.y) * step(f.y, 0.86) * step(1.0, cell.y);
  float winA = mix(0.45, win, aa);
  vec3 glass = vec3(0.10, 0.13, 0.17);
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, winA * 0.7);
  float lit = step(0.55, h21(cell + seed * 1.7));
  float bvar = 0.4 + 1.2 * h21(vec2(seed, 3.7));
  totalEmissiveRadiance += vec3(1.0, 0.8, 0.5) * mix(0.03 * bvar, lit * win, aa) * uNight * 1.1;
}`);
    };
    this.material = mat;
    for (let i = 0; i < 4; i++) {
      const w = new Worker(new URL('./buildingWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onResult(e.data, w);
      w.idle = true;
      this.workers.push(w);
    }
  }

  async init() {
    const idx = await (await fetch('data/bld/index.json')).json();
    this.index = new Map(idx.chunks.map(([x, z, n]) => [`${x}_${z}`, n]));
    this.colours = idx.colours;
  }

  onResult(d, w) {
    w.idle = true;
    this.busy--;
    const c = this.chunks.get(d.key);
    if (!c) return;
    if (d.error) { c.state = 'error'; console.warn('bld', d.key, d.error); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(d.col, 3, true));
    g.setAttribute('wuv', new THREE.BufferAttribute(d.uv, 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.material);
    m.position.set(c.ox, 0, c.oz);
    m.castShadow = true; m.receiveShadow = true;
    m.matrixAutoUpdate = false; m.updateMatrix();
    this.group.add(m);
    c.mesh = m;
    c.state = 'ready';
    this.pump();
  }

  pump() {
    this.queue.sort((a, b) => a.d - b.d);
    for (const w of this.workers) {
      if (!w.idle || !this.queue.length) continue;
      const job = this.queue.shift();
      const c = this.chunks.get(job.key);
      if (!c || c.state !== 'queued') continue;
      c.state = 'loading';
      w.idle = false; this.busy++;
      w.postMessage({ url: new URL(`data/bld/${job.key}.bin`, location.href).href, key: job.key, ox: c.ox, oz: c.oz, colours: this.colours });
    }
  }

  setXray(on) {
    if (on === this.material.transparent) return;
    this.material.transparent = on; this.material.opacity = on ? 0.18 : 1; this.material.depthWrite = !on;
    this.material.needsUpdate = true;
  }

  update(camera, focus) {
    if (!this.index) return;
    const cp = camera.position;
    const alt = Math.max(cp.y, 0);
    const R = Math.min(9000, 2200 + alt * 1.4);
    const fx = focus ? focus.x : cp.x, fz = focus ? focus.z : cp.z;
    const cx0 = Math.floor((fx - R) / 1000), cx1 = Math.floor((fx + R) / 1000);
    const cz0 = Math.floor((fz - R) / 1000), cz1 = Math.floor((fz + R) / 1000);
    const want = new Set();
    for (let x = cx0; x <= cx1; x++) for (let z = cz0; z <= cz1; z++) {
      const key = `${x}_${z}`;
      if (!this.index.has(key)) continue;
      const d = Math.hypot((x + 0.5) * 1000 - fx, (z + 0.5) * 1000 - fz);
      if (d > R) continue;
      want.add(key);
      if (!this.chunks.has(key)) {
        this.chunks.set(key, { state: 'queued', ox: x * 1000, oz: z * 1000 });
        this.queue.push({ key, d });
      }
    }
    for (const [key, c] of this.chunks) {
      if (want.has(key)) continue;
      const [x, z] = key.split('_').map(Number);
      const d = Math.hypot((x + 0.5) * 1000 - fx, (z + 0.5) * 1000 - fz);
      if (d > R * 1.35 + 1500) {
        if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); }
        this.chunks.delete(key);
      }
    }
    this.queue = this.queue.filter((j) => this.chunks.get(j.key)?.state === 'queued');
    this.pump();
    this.uniforms.uNight.value = this.night;
  }
}
