// Preview for suburban double-deck fleets.
//   arg = 'A' | 'B' | 'T' | 'M' | 'K' | 'H'  -> 4-car consist (from formation) on a short track, lead at +X
//   arg = 'all'                              -> one lead car of every fleet side by side (along Z)
//   suffix ':low' uses the low LOD (e.g. 'A:low', 'all:low'); ':mid' shows a single mid/midPan pair.
// With ?night=1 in the page URL the glass night-emissive is switched on (as the runtime would).
import * as THREE from 'three';
import { FLEETS } from './suburban.js';

function track(len, z = 0) {
  const g = new THREE.Group();
  const ballast = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, 3.8), new THREE.MeshStandardMaterial({ color: 0x7d776e, roughness: 1 }));
  ballast.position.set(0, -0.37, z); g.add(ballast);
  const sleeperGeo = new THREE.BoxGeometry(0.22, 0.16, 2.5);
  const sleepers = new THREE.InstancedMesh(sleeperGeo, new THREE.MeshStandardMaterial({ color: 0x6f6a63, roughness: 0.95 }), Math.floor(len / 0.6));
  const m = new THREE.Matrix4();
  for (let i = 0; i < sleepers.count; i++) { m.makeTranslation(-len / 2 + i * 0.6 + 0.3, -0.24 + 0.06, z); sleepers.setMatrixAt(i, m); }
  g.add(sleepers);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, metalness: 0.8, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, 0.07), railMat);
    r.position.set(0, -0.08, z + s * 0.7525); g.add(r);
  }
  return g;
}

export default function previewSuburban(arg = 'A') {
  const [code, opt] = String(arg).split(':');
  const lod = opt === 'low' ? 'low' : 'high';
  const night = typeof location !== 'undefined' && new URLSearchParams(location.search).get('night') === '1';
  const root = new THREE.Group();
  const tris = {};
  if (code === 'tris') { // triangle report for every fleet / variant / lod
    for (const [c, F] of Object.entries(FLEETS)) for (const v of ['lead', 'mid', 'midPan']) for (const l of ['high', 'low']) tris[`${c}.${v}.${l}`] = F.build(v, l).userData.triangles;
    console.log('triangles', JSON.stringify(tris));
    return root;
  }
  if (code === 'all') {
    const codes = Object.keys(FLEETS);
    codes.forEach((c, i) => {
      const z = (i - (codes.length - 1) / 2) * 4.6;
      const car = FLEETS[c].build('lead', lod);
      car.position.z = z; root.add(car); root.add(track(26, z));
      tris[c] = car.userData.triangles;
    });
  } else {
    const F = FLEETS[code];
    let vars = F.formation(4);
    if (opt === 'mid') vars = ['mid', 'midPan'];
    const n = vars.length; const L = F.carLength;
    vars.forEach((v, i) => {
      const car = F.build(v, lod);
      car.position.x = ((n - 1) / 2 - i) * L;
      if (i === n - 1 && v === 'lead') car.rotation.y = Math.PI; // trailing cab faces -X
      root.add(car); tris[v] = car.userData.triangles;
    });
    root.add(track(n * L + 10));
    root.position.x = -((n - 1) / 2) * L; // lead car centred on the origin, cab at +X
  }
  root.position.y = 0.55; // sit the track (rail top = local y 0) on the viewer's ground plane
  root.traverse((o) => {
    if (o.isMesh && o.material.userData.nightEmissive) o.material.emissiveIntensity = night ? 1 : 0;
    if (o.isMesh && o.material.name === 'taillight') o.visible = true;
  });
  console.log('triangles', JSON.stringify(tris));
  return root;
}
