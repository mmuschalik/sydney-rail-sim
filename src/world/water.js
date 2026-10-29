// Harbour / river / ocean surface: a sea-level plane with animated ripples and sky reflections.
// The terrain (DEM at ~0 m over water) shows through slightly for shallows.
import * as THREE from 'three';

function rippleNormalMap() {
  const N = 256;
  const h = new Float32Array(N * N);
  // sum of random waves (tileable)
  for (let k = 0; k < 40; k++) {
    const fx = Math.round((Math.random() - 0.5) * 24), fy = Math.round((Math.random() - 0.5) * 24);
    const amp = 1 / (1 + Math.hypot(fx, fy)), ph = Math.random() * 6.28;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] += amp * Math.sin(((fx * x + fy * y) / N) * 6.2832 + ph);
  }
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)];
    const dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
    const nx = -dx * 0.9, ny = -dy * 0.9, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const i = (y * N + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Water {
  constructor(scene) {
    const nm = rippleNormalMap();
    nm.repeat.set(2600, 2600);
    this.nm = nm;
    this.mat = new THREE.MeshPhysicalMaterial({
      color: 0x0c2a38, roughness: 0.07, metalness: 0, ior: 1.333, normalMap: nm, normalScale: new THREE.Vector2(0.35, 0.35),
      transparent: true, opacity: 0.86, envMapIntensity: 1.0,
    });
    this.mat.polygonOffset = true; this.mat.polygonOffsetFactor = -1; this.mat.polygonOffsetUnits = -1;
    const g = new THREE.PlaneGeometry(200000, 200000, 1, 1);
    g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.position.set(-15000, 0.6, 0);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  update(t, camera) {
    this.nm.offset.set((t * 0.0021) % 1, (t * 0.0013) % 1);
    // ripples fade to a calm sheen when seen from high above
    const alt = camera.position.y;
    const s = alt > 3000 ? 0.08 : alt > 800 ? 0.2 : 0.35;
    this.mat.normalScale.set(s, s);
  }
}

/** Environment map from the current sky (re-baked when the sun moves) */
export class SkyEnvironment {
  constructor(renderer, scene, sky) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = scene;
    this.envScene = new THREE.Scene();
    this.sky = sky.clone();
    this.sky.material = sky.material; // share uniforms
    this.envScene.add(this.sky);
    this.last = null;
    this.rt = null;
  }
  update(sunDir, night) {
    if (this.last && this.last.angleTo(sunDir) < 0.03) return;
    this.last = sunDir.clone();
    const old = this.rt;
    this.rt = this.pmrem.fromScene(this.envScene, 0, 1, 900000);
    this.scene.environment = this.rt.texture;
    this.scene.environmentIntensity = 0.12 + 0.28 * (1 - night);
    if (old) old.dispose();
  }
}
