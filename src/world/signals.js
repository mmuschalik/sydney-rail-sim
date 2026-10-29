// Lineside colour-light signals (NSW style): post, black target, lamps showing live aspects.
import * as THREE from 'three';
import { mergeGeoms } from './tracks.js';

const COLORS = {
  red: new THREE.Color(1.0, 0.06, 0.04),
  yellow: new THREE.Color(1.0, 0.72, 0.05),
  green: new THREE.Color(0.1, 1.0, 0.35),
  off: new THREE.Color(0.04, 0.04, 0.04),
};

export class SignalRenderer {
  constructor(net, scene) {
    this.net = net;
    this.group = new THREE.Group();
    this.group.name = 'signals';
    scene.add(this.group);
    const sigs = net.signals.filter((s) => (s.type === 'main' || s.type === 'distant' || s.type === 'shunt') && !s.hidden);
    this.sigs = sigs;
    const n = sigs.length;
    const post = new THREE.CylinderGeometry(0.08, 0.1, 4.2, 8); post.translate(0, 2.1, 0);
    const head = new THREE.BoxGeometry(0.5, 1.15, 0.28); head.translate(0, 4.6, 0);
    const hood = new THREE.BoxGeometry(0.5, 0.06, 0.25); hood.translate(0, 5.0, 0.24);
    const ladder = new THREE.BoxGeometry(0.05, 3.8, 0.05); ladder.translate(0.25, 2.2, -0.05);
    this.bodies = new THREE.InstancedMesh(mergeGeoms([post, head, hood, ladder]),
      new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.7, metalness: 0.2 }), n);
    // two lamps per head (upper = main aspect, lower = second yellow for double-yellow / off)
    const lamp = new THREE.CircleGeometry(0.11, 16);
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.lampU = new THREE.InstancedMesh(lamp, this.lampMat, n);
    this.lampL = new THREE.InstancedMesh(lamp, this.lampMat, n);
    // glow sprites for visibility at distance
    this.glowGeom = new THREE.BufferGeometry();
    this.glowPos = new Float32Array(n * 3);
    this.glowCol = new Float32Array(n * 3);
    this.glowGeom.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3));
    this.glowGeom.setAttribute('color', new THREE.BufferAttribute(this.glowCol, 3));
    this.glow = new THREE.Points(this.glowGeom, new THREE.PointsMaterial({
      size: 2.2, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, map: glowTex(), toneMapped: false,
    }));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const p = [0, 0, 0], p2 = [0, 0, 0];
    sigs.forEach((s, i) => {
      const e = net.edges[s.e];
      net.edgePoint(e, s.off, p);
      net.edgePoint(e, Math.min(e.len, Math.max(0, s.off + 3 * s.dir)), p2);
      let dx = p2[0] - p[0], dz = p2[2] - p[2];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      if (s.off + 3 * s.dir > e.len || s.off + 3 * s.dir < 0) { dx = -dx; dz = -dz; }
      // left of travel direction (NSW: signals normally on the left)
      const side = s.pos === 'right' ? -1 : 1;
      const lx = -dz * side, lz = dx * side;
      const off = s.pos === 'bridge' ? 0 : 2.4;
      const x = p[0] + lx * off, z = p[2] + lz * off, y = p[1] - 0.4 + (s.pos === 'bridge' ? 2.0 : 0);
      // face approaching trains: lamp normal = -travel direction
      q.setFromAxisAngle(up, Math.atan2(-dx, -dz));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
      this.bodies.setMatrixAt(i, m);
      const fwd = new THREE.Vector3(-dx, 0, -dz);
      const lampAt = (dy) => {
        const lm = new THREE.Matrix4().compose(new THREE.Vector3(x, y + dy, z).addScaledVector(fwd, 0.15), q, new THREE.Vector3(1, 1, 1));
        return lm;
      };
      this.lampU.setMatrixAt(i, lampAt(4.82));
      this.lampL.setMatrixAt(i, lampAt(4.38));
      this.glowPos.set([x - dx * 0.3, y + 4.82, z - dz * 0.3], i * 3);
    });
    for (const im of [this.bodies, this.lampU, this.lampL]) { im.computeBoundingSphere(); this.group.add(im); }
    this.bodies.castShadow = true;
    this.group.add(this.glow);
    this.update(true);
  }

  update() {
    const c = new THREE.Color();
    this.sigs.forEach((s, i) => {
      let u = COLORS.off, l = COLORS.off;
      if (s.type === 'main') {
        if (s.aspect === 0) u = COLORS.red;
        else if (s.aspect === 1) u = COLORS.yellow;
        else if (s.aspect === 2) { u = COLORS.yellow; l = COLORS.yellow; }
        else u = COLORS.green;
      } else if (s.type === 'distant') {
        u = COLORS.green;
      } else {
        u = COLORS.off;
      }
      this.lampU.setColorAt(i, u);
      this.lampL.setColorAt(i, l);
      c.copy(u);
      this.glowCol.set([c.r, c.g, c.b], i * 3);
    });
    this.lampU.instanceColor.needsUpdate = true;
    this.lampL.instanceColor.needsUpdate = true;
    this.glowGeom.attributes.color.needsUpdate = true;
  }

  setVisible(camera) {
    const alt = camera.position.y;
    this.group.visible = alt < 3000;
  }
}

function glowTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
