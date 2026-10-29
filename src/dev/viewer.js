// Dev harness for inspecting 3D models in isolation.
// Query params:
//   module=<path under /src, e.g. models/trains/waratah.js>
//   fn=<export name returning Object3D|Promise<Object3D>> (default "default")
//   arg=<string passed to fn> (optional)
//   cam=x,y,z  target=x,y,z  (camera placement, metres)
//   night=1 (dark scene to check emissive lights)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const night = q.get('night') === '1';
scene.background = new THREE.Color(night ? 0x05070d : 0x9ec3e6);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = night ? 0.05 : 0.6;

const sun = new THREE.DirectionalLight(0xffffff, night ? 0.05 : 2.5);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, far: 300 });
scene.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x6b5a45, night ? 0.02 : 0.6));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x7a7a72, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.0; ground.receiveShadow = true;
if (q.get('ground') !== '0') scene.add(ground);
// water=1: blue plane at y=0 centred on the target (for harbour landmarks far from the origin)
if (q.get('water') === '1') { const w = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x1d4a66, roughness: 0.75, metalness: 0.0 })); w.rotation.x = -Math.PI / 2; w.receiveShadow = true; scene.add(w); w.userData.followTarget = true; window.__water = w; }

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 20000);
const cam = (q.get('cam') || '25,8,25').split(',').map(Number);
const tgt = (q.get('target') || '0,2,0').split(',').map(Number);
camera.position.set(...cam);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(...tgt); controls.update();
if (window.__water) window.__water.position.set(tgt[0], 0, tgt[2]);

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

(async () => {
  const mod = await import(/* @vite-ignore */ '/src/' + q.get('module'));
  const fn = mod[q.get('fn') || 'default'];
  const obj = await fn(q.get('arg') || undefined);
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // night=1: emulate the runtime ramping night-emissive materials
  if (night) obj.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.userData.nightEmissive) m.emissiveIntensity = m.userData.nightIntensity ?? 1; });
  // shadow camera follows the target so large models far from the origin get shadows
  if (window.__water) { sun.position.set(tgt[0] + 300, tgt[1] + 500, tgt[2] + 200); sun.target.position.set(tgt[0], tgt[1], tgt[2]); scene.add(sun.target);
  Object.assign(sun.shadow.camera, { left: -700, right: 700, top: 700, bottom: -700, far: 2000 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.mapSize.set(4096, 4096); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  { let tri = 0; obj.traverse((o) => { if (o.isMesh) { const g = o.geometry; tri += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1); } }); console.log('triangles', tri); }
  scene.add(obj);
  window.__ready = true;
})().catch((e) => { console.error(e.stack || e); });

renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
