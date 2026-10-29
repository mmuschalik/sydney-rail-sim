// Streaming quadtree terrain: ESRI World Imagery draped on AWS Terrarium elevation.
import * as THREE from 'three';
import { tileBounds, worldToTile, unproject } from '../geo.js';

const IMAGERY = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const AWS_DEM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
// filtered (buildings removed) DEM tiles served locally for the network area, AWS elsewhere
let LOCAL = null;
export async function initDem() {
  try { LOCAL = (await (await fetch('data/dem/index.json')).json()).z13; } catch { LOCAL = null; }
}
function DEM_URL(z, x, y) {
  if (LOCAL && z >= 10 && z <= 13) {
    const s = 2 ** (13 - z);
    const [tx0, ty0, w, h] = LOCAL;
    const x0 = Math.floor(tx0 / s), y0 = Math.floor(ty0 / s), x1 = Math.floor((tx0 + w - 1) / s), y1 = Math.floor((ty0 + h - 1) / s);
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return `data/dem/${z}/${x}/${y}.png`;
  }
  return AWS_DEM(z, x, y);
}
const DEM_Z = 13;
const GRID = 32;
const ROOT_Z = 9;
const MAX_Z = 18;
const SPLIT = 2.2;

const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;

export class Terrain {
  constructor(scene, opts = {}) {
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.demCache = new Map();   // key -> Promise<Float32Array> | Float32Array
    this.demReady = new Map();
    this.loading = 0;
    this.queue = [];
    this.maxLoads = 10;
    this.nodes = new Map();
    this.frame = 0;
    this.carve = opts.carve || null; // optional (x,z,h)=>h  terrain modifier (track cuttings)
    this.nightFactor = 0;
    this.nightGlow = { value: 0 };
    // root tiles covering the Sydney basin + surroundings (Blue Mountains on the horizon)
    const x0 = Math.floor(lon2x(149.9, ROOT_Z)), x1 = Math.floor(lon2x(151.9, ROOT_Z));
    const y0 = Math.floor(lat2y(-33.0, ROOT_Z)), y1 = Math.floor(lat2y(-34.9, ROOT_Z));
    this.roots = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) this.roots.push(this.node(ROOT_Z, x, y));
    this.xray = false;
    this.material = (tex) => {
      const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, metalness: 0, emissiveMap: tex, emissive: new THREE.Color(0, 0, 0) });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uNightGlow = this.nightGlow;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNightGlow;')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // street lighting: bright, low-saturation (paved / built) pixels glow warm at night
  vec3 c = texture2D(emissiveMap, vEmissiveMapUv).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float urban = smoothstep(0.18, 0.45, lum) * (1.0 - smoothstep(0.08, 0.25, sat));
  totalEmissiveRadiance = vec3(1.0, 0.62, 0.3) * urban * uNightGlow * 0.38 + c * uNightGlow * 0.06;
}`);
      };
      if (this.xray) { m.transparent = true; m.opacity = 0.32; m.depthWrite = false; }
      m.polygonOffset = true; m.polygonOffsetFactor = 2; m.polygonOffsetUnits = 2;
      return m;
    };
  }

  node(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let n = this.nodes.get(key);
    if (!n) {
      const b = tileBounds(z, x, y);
      n = { key, z, x, y, b, size: b.x1 - b.x0, cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2, mesh: null, state: 0, children: null, used: 0, hmin: 0, hmax: 100 };
      this.nodes.set(key, n);
    }
    return n;
  }

  /** elevation (m) from loaded DEM tiles, or null */
  heightAt(x, z) {
    const { tx, ty } = worldToTile(x, z, DEM_Z);
    const ix = Math.floor(tx), iy = Math.floor(ty);
    const d = this.demReady.get(`${ix}/${iy}`);
    if (!d) return null;
    return sampleDem(d, (tx - ix) * 256, (ty - iy) * 256);
  }

  async dem(z, x, y) {
    const key = `${x}/${y}`;
    if (this.demCache.has(key)) return this.demCache.get(key);
    const p = (async () => {
      const bmp = await demBitmap(z, x, y);
      const c = new OffscreenCanvas(256, 256);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, 256, 256).data;
      const h = new Float32Array(256 * 256);
      for (let i = 0; i < h.length; i++) h[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
      this.demReady.set(key, h);
      return h;
    })();
    this.demCache.set(key, p);
    return p;
  }

  async loadNode(n) {
    // DEM: the z13 tile containing this tile (or several for coarse tiles — sample per vertex)
    const b = n.b;
    const pos = new Float32Array((GRID + 1) * (GRID + 1) * 3 + (GRID * 4) * 2 * 3);
    const uv = new Float32Array(pos.length / 3 * 2);
    const zd = Math.min(n.z, DEM_Z);
    const demTiles = new Map();
    // which DEM tiles do we need?
    const need = [];
    if (n.z >= DEM_Z) {
      const s = 2 ** (n.z - DEM_Z);
      need.push([DEM_Z, Math.floor(n.x / s), Math.floor(n.y / s)]);
    } else {
      // coarse tile: use DEM at its own zoom (Terrarium has all zooms)
      need.push([n.z, n.x, n.y]);
    }
    const imgP = loadImage(IMAGERY(n.z, n.x, n.y));
    for (const [z, x, y] of need) {
      if (z === DEM_Z) demTiles.set(`${x}/${y}`, await this.dem(z, x, y));
      else demTiles.set(`c${z}/${x}/${y}`, await fetchDemRaw(z, x, y));
    }
    let k = 0, ku = 0, hmin = 1e9, hmax = -1e9;
    const heights = new Float32Array((GRID + 1) * (GRID + 1));
    for (let j = 0; j <= GRID; j++) {
      for (let i = 0; i <= GRID; i++) {
        const fx = i / GRID, fz = j / GRID;
        const x = b.x0 + (b.x1 - b.x0) * fx;
        const z = b.z0 + (b.z1 - b.z0) * fz;
        let h;
        if (n.z >= DEM_Z) {
          const s = 2 ** (n.z - DEM_Z);
          const dx = Math.floor(n.x / s), dy = Math.floor(n.y / s);
          const px = ((n.x - dx * s) + fx) / s * 256, py = ((n.y - dy * s) + fz) / s * 256;
          h = sampleDem(demTiles.get(`${dx}/${dy}`), px, py);
        } else {
          h = sampleDem(demTiles.get(`c${n.z}/${n.x}/${n.y}`), fx * 256, fz * 256);
        }
        h = Math.max(h, -2);
        if (this.carve && n.z >= 13) h = this.carve(x, z, h);
        heights[j * (GRID + 1) + i] = h;
        hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
        pos[k++] = x - n.cx; pos[k++] = h; pos[k++] = z - n.cz;
        uv[ku++] = fx; uv[ku++] = 1 - fz;
      }
    }
    // index (grid first, normals from the grid only, then skirts)
    const idx = [];
    const V = (i, j) => j * (GRID + 1) + i;
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const a = V(i, j), b2 = V(i + 1, j), c = V(i, j + 1), d = V(i + 1, j + 1);
      idx.push(a, c, b2, b2, c, d);
    }
    const gridIdxCount = idx.length;
    let vi = (GRID + 1) * (GRID + 1);
    const skirt = n.size * 0.03 + 5;
    const edge = [];
    for (let i = 0; i < GRID; i++) edge.push([V(i, 0), V(i + 1, 0)]);
    for (let j = 0; j < GRID; j++) edge.push([V(GRID, j), V(GRID, j + 1)]);
    for (let i = GRID; i > 0; i--) edge.push([V(i, GRID), V(i - 1, GRID)]);
    for (let j = GRID; j > 0; j--) edge.push([V(0, j), V(0, j - 1)]);
    for (const [a, c] of edge) {
      for (const s of [a, c]) {
        pos[k++] = pos[s * 3]; pos[k++] = pos[s * 3 + 1] - skirt; pos[k++] = pos[s * 3 + 2];
        uv[ku++] = uv[s * 2]; uv[ku++] = uv[s * 2 + 1];
      }
      const a2 = vi, c2 = vi + 1; vi += 2;
      idx.push(a, c, a2, c, c2, a2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, ku), 2));
    g.setIndex(idx.slice(0, gridIdxCount));
    g.computeVertexNormals();
    // skirt vertices copy the normal of the edge vertex above them
    const nrm = g.attributes.normal;
    {
      let sv = (GRID + 1) * (GRID + 1);
      for (const [a, c] of edge) {
        for (const src of [a, c]) { nrm.setXYZ(sv, nrm.getX(src), nrm.getY(src), nrm.getZ(src)); sv++; }
      }
    }
    g.setIndex(idx);
    let img;
    try { img = await imgP; } catch { img = null; }
    const tex = img ? new THREE.Texture(img) : null;
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.needsUpdate = true;
    }
    const mesh = new THREE.Mesh(g, this.material(tex));
    mesh.position.set(n.cx, 0, n.cz);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    this.group.add(mesh);
    n.mesh = mesh;
    n.gridCount = gridIdxCount;
    if (this.xray) g.setDrawRange(0, gridIdxCount);
    n.heights = heights;
    n.hmin = hmin; n.hmax = hmax;
    n.state = 2;
  }

  request(n, priority) {
    if (n.state !== 0) return;
    n.state = 1;
    n.priority = priority;
    this.queue.push(n);
  }

  pump() {
    this.queue.sort((a, b) => a.priority - b.priority);
    while (this.loading < this.maxLoads && this.queue.length) {
      const n = this.queue.shift();
      this.loading++;
      this.loadNode(n).catch((e) => { n.state = 3; console.warn('tile', n.key, e.message); })
        .finally(() => { this.loading--; });
    }
  }

  update(camera) {
    this.frame++;
    const cam = camera.position;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const box = new THREE.Box3();
    const visible = [];
    const visit = (n) => {
      box.min.set(n.b.x0, n.hmin - 50, n.b.z0); box.max.set(n.b.x1, n.hmax + 50, n.b.z1);
      if (!frustum.intersectsBox(box)) return;
      const dx = Math.max(n.b.x0 - cam.x, 0, cam.x - n.b.x1);
      const dz = Math.max(n.b.z0 - cam.z, 0, cam.z - n.b.z1);
      const dy = Math.max(0, cam.y - n.hmax);
      const dist = Math.hypot(dx, dy, dz);
      const maxZ = cam.y > 9000 ? 12 : cam.y > 4000 ? 14 : MAX_Z;
      const wantSplit = n.z < maxZ && dist < n.size * SPLIT;
      if (wantSplit) {
        if (!n.children) n.children = [0, 1, 2, 3].map((q) => this.node(n.z + 1, n.x * 2 + (q & 1), n.y * 2 + (q >> 1)));
        const ready = n.children.every((c) => c.state >= 2);
        if (ready) { n.children.forEach(visit); return; }
        n.children.forEach((c) => this.request(c, dist / c.size));
      }
      if (n.state >= 2) visible.push(n);
      else {
        this.request(n, dist / n.size - 10);
      }
    };
    this.roots.forEach(visit);
    for (const n of this.nodes.values()) if (n.mesh) n.mesh.visible = false;
    for (const n of visible) if (n.mesh) { n.mesh.visible = true; n.used = this.frame; }
    this.pump();
    // evict old tiles
    if (this.frame % 120 === 0) {
      const loaded = [...this.nodes.values()].filter((n) => n.mesh && n.z > ROOT_Z + 1);
      if (loaded.length > 700) {
        loaded.sort((a, b) => a.used - b.used);
        for (const n of loaded.slice(0, loaded.length - 600)) {
          if (this.frame - n.used < 60) continue;
          n.mesh.geometry.dispose();
          n.mesh.material.map?.dispose();
          n.mesh.material.dispose();
          this.group.remove(n.mesh);
          n.mesh = null; n.state = 0;
        }
      }
    }
  }

  setXray(on) {
    if (on === this.xray) return;
    this.xray = on;
    for (const n of this.nodes.values()) {
      if (!n.mesh) continue;
      const m = n.mesh.material;
      m.transparent = on; m.opacity = on ? 0.32 : 1; m.depthWrite = !on; m.needsUpdate = true;
      n.mesh.geometry.setDrawRange(0, on ? n.gridCount : Infinity);
    }
  }

  get pending() { return this.loading + this.queue.length; }
}

function sampleDem(d, px, py) {
  px = Math.min(Math.max(px - 0.5, 0), 254.999);
  py = Math.min(Math.max(py - 0.5, 0), 254.999);
  const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
  const i = y0 * 256 + x0;
  return d[i] * (1 - fx) * (1 - fy) + d[i + 1] * fx * (1 - fy) + d[i + 256] * (1 - fx) * fy + d[i + 257] * fx * fy;
}

const rawCache = new Map();
async function fetchDemRaw(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (rawCache.has(key)) return rawCache.get(key);
  const p = (async () => {
    const bmp = await demBitmap(z, x, y);
    const c = new OffscreenCanvas(256, 256);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, 256, 256).data;
    const h = new Float32Array(256 * 256);
    for (let i = 0; i < h.length; i++) h[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    return h;
  })();
  rawCache.set(key, p);
  return p;
}

async function demBitmap(z, x, y) {
  const opts = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
  const url = DEM_URL(z, x, y);
  try {
    const res = await fetch(url);
    if (!res.ok || !(res.headers.get('content-type') || '').includes('image')) throw new Error('no local');
    return await createImageBitmap(await res.blob(), opts);
  } catch (e) {
    if (url.startsWith('http')) throw e;
    const res = await fetch(AWS_DEM(z, x, y));
    return createImageBitmap(await res.blob(), opts);
  }
}

async function loadImage(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('img ' + res.status);
  return createImageBitmap(await res.blob(), { imageOrientation: 'flipY' });
}
