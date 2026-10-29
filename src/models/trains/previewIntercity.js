// Preview for intercity.js in src/dev/viewer.js.
//   arg = 'D' | 'MET' | 'N'          -> short consist (3–4 cars) on track, high LOD
//   arg = 'D:low'                    -> same, low LOD
//   arg = 'D:8' / 'D:8:low'          -> full formation of n cars
//   arg = 'all' / 'all:low'          -> one lead car of each fleet side by side
// URL param night=1 switches glass to interior-lit (emissiveIntensity 1).
import * as THREE from 'three';
import { FLEETS, _materials, triangleReport } from './intercity.js';

function track(x0, x1, z = 0) {
  const g = new THREE.Group();
  const len = x1 - x0, cx = (x0 + x1) / 2;
  const shape = new THREE.Shape([new THREE.Vector2(-2.6, -0.5), new THREE.Vector2(2.6, -0.5), new THREE.Vector2(1.7, -0.17), new THREE.Vector2(-1.7, -0.17)]);
  const bg = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
  bg.rotateY(Math.PI / 2).translate(x0, 0, 0);
  const ballast = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 1 }));
  ballast.position.z = z;
  g.add(ballast);
  const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.95 });
  const n = Math.floor(len / 0.6);
  const sl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 0.18, 2.5), sleeperMat, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { m.makeTranslation(x0 + 0.3 + i * 0.6, -0.15 - 0.09 + 0.02, z); sl.setMatrixAt(i, m); }
  g.add(sl);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x6b625a, metalness: 0.7, roughness: 0.4 });
  for (const s of [1, -1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.07), railMat);
    head.position.set(cx, -0.025, z + s * (0.7175 + 0.035));
    const web = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.02), railMat);
    web.position.set(cx, -0.1, z + s * (0.7175 + 0.035));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, 0.14), railMat);
    foot.position.set(cx, -0.15, z + s * (0.7175 + 0.035));
    g.add(head, web, foot);
  }
  return g;
}

function consist(code, list, lod) {
  const F = FLEETS[code];
  const g = new THREE.Group();
  let x = 0;
  list.forEach((v, i) => {
    const car = F.build(v, lod);
    const L = car.userData.length;
    if (i > 0) x -= L / 2;
    car.position.x = x;
    if (i === list.length - 1 && v === 'lead' && list.length > 1) car.rotation.y = Math.PI;
    x -= L / 2;
    g.add(car);
  });
  g.userData.x0 = x;
  return g;
}

export default function preview(arg = 'all') {
  const [code, a2, a3] = String(arg).split(':');
  const lod = [a2, a3].includes('low') ? 'low' : 'high';
  const nCars = [a2, a3].map(Number).find((n) => n > 0);
  const root = new THREE.Group();
  const night = new URLSearchParams(globalThis.location?.search || '').get('night') === '1';

  if (code === 'all') {
    ['D', 'MET', 'N'].forEach((c, i) => {
      const car = FLEETS[c].build('lead', lod);
      const z = (i - 1) * 5.5;
      car.position.set(-car.userData.length / 2 + 12, 0, z);
      root.add(car, track(-30, 16, z));
    });
  } else {
    const F = FLEETS[code];
    let list = F.formation(nCars || (code === 'N' ? 2 : code === 'D' ? 4 : 6));
    if (!nCars && list.length > 4) list = [...list.slice(0, 3), list[list.length - 1]];
    const c = consist(code, list, lod);
    // put the front of the train near x = +10
    c.position.x = 10 - FLEETS[code].carLength / 2;
    root.add(c, track(c.position.x + c.userData.x0 - 5, 25));
  }
  for (const c of ['D', 'MET', 'N']) {
    const m = _materials(c);
    m.glass.emissiveIntensity = night ? 1 : 0;
  }
  root.position.y = 0.5; // sit the track bed on the viewer's ground plane
  try { console.log('triangles', JSON.stringify(triangleReport())); } catch (e) { console.warn(e); }
  return root;
}
