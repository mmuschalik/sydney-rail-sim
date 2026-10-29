// Level crossings: boom gates and alternating red flashers driven by approaching trains.
import * as THREE from 'three';
import { mergeGeoms } from './tracks.js';

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 8;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#c8102e' : '#f4f4f4'; g.fillRect(i * 16, 0, 16, 8); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CrossingRenderer {
  constructor(net, scene) {
    this.net = net;
    this.group = new THREE.Group();
    this.group.name = 'crossings';
    scene.add(this.group);
    const xs = net.crossings;
    const n = xs.length * 2;
    const post = new THREE.CylinderGeometry(0.09, 0.11, 3.4, 10); post.translate(0, 1.7, 0);
    const box = new THREE.BoxGeometry(0.5, 0.9, 0.35); box.translate(0, 0.45, 0);
    const xbuck = new THREE.BoxGeometry(1.2, 0.18, 0.04); const xb2 = xbuck.clone();
    xbuck.rotateZ(0.6); xb2.rotateZ(-0.6); xbuck.translate(0, 3.6, 0); xb2.translate(0, 3.6, 0);
    const bar = new THREE.BoxGeometry(1.1, 0.1, 0.1); bar.translate(0, 2.9, 0.1);
    this.posts = new THREE.InstancedMesh(mergeGeoms([post, box, bar]), new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.5, metalness: 0.4 }), n);
    this.signs = new THREE.InstancedMesh(mergeGeoms([xbuck, xb2]), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }), n);
    const arm = new THREE.BoxGeometry(6.5, 0.12, 0.1); arm.translate(3.25 + 0.3, 0, 0);
    this.arms = new THREE.InstancedMesh(arm, new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.5 }), n);
    const lamp = new THREE.CircleGeometry(0.13, 14);
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.lampA = new THREE.InstancedMesh(lamp, this.lampMat, n);
    this.lampB = new THREE.InstancedMesh(lamp, this.lampMat, n);
    this.sets = [];
    const p = [0, 0, 0], p2 = [0, 0, 0];
    const up = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    xs.forEach((c, i) => {
      const e = net.edges[c.e];
      net.edgePoint(e, c.off, p);
      net.edgePoint(e, Math.min(e.len, c.off + 4), p2);
      let dx = p2[0] - p[0], dz = p2[2] - p[2];
      if (c.off + 4 > e.len) { net.edgePoint(e, Math.max(0, c.off - 4), p2); dx = p[0] - p2[0]; dz = p[2] - p2[2]; }
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const lx = -dz, lz = dx; // left of track
      for (const side of [1, -1]) {
        // gates diagonally opposite: each on its side, offset along the track
        const x = p[0] + lx * side * 4.2 - dx * side * 5, z = p[2] + lz * side * 4.2 - dz * side * 5, y = p[1] - 0.6;
        // face road traffic approaching the track (along -side*left direction)
        const faceAng = Math.atan2(lx * side, lz * side);
        q.setFromAxisAngle(up, faceAng);
        m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
        const k = this.sets.length;
        this.posts.setMatrixAt(k, m);
        this.signs.setMatrixAt(k, m);
        // lamps on the face (two, side by side)
        const fwd = new THREE.Vector3(lx * side, 0, lz * side);
        const right = new THREE.Vector3(dx, 0, dz).multiplyScalar(side);
        const la = new THREE.Vector3(x, y + 2.9, z).addScaledVector(fwd, 0.17).addScaledVector(right, -0.42);
        const lb = new THREE.Vector3(x, y + 2.9, z).addScaledVector(fwd, 0.17).addScaledVector(right, 0.42);
        this.lampA.setMatrixAt(k, new THREE.Matrix4().compose(la, q, new THREE.Vector3(1, 1, 1)));
        this.lampB.setMatrixAt(k, new THREE.Matrix4().compose(lb, q, new THREE.Vector3(1, 1, 1)));
        // boom pivots at 1.0 m and extends across the road lane, i.e. along the track direction? No:
        // the road crosses the track, so the boom extends parallel to the track over the road approach.
        this.sets.push({ c, pos: new THREE.Vector3(x, y + 1.0, z), dir: new THREE.Vector3(-dx * side, 0, -dz * side), angle: Math.PI / 2 * 0.95 });
      }
    });
    for (const im of [this.posts, this.signs, this.arms, this.lampA, this.lampB]) { im.computeBoundingSphere(); this.group.add(im); }
    this.posts.castShadow = this.arms.castShadow = true;
    this.update(0, 0);
  }

  update(dt, t) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
    const red = new THREE.Color(1, 0.05, 0.03), off = new THREE.Color(0.08, 0.02, 0.02);
    const flash = Math.floor(t * 1.8) % 2;
    const zAxis = new THREE.Vector3(0, 0, 1), yAxis = new THREE.Vector3(0, 1, 0);
    this.sets.forEach((s, k) => {
      const target = s.c.active ? 0 : Math.PI / 2 * 0.95;
      const rate = 0.25 * dt;
      s.angle += Math.max(-rate, Math.min(rate, target - s.angle));
      q.setFromAxisAngle(yAxis, Math.atan2(-s.dir.z, s.dir.x));
      q2.setFromAxisAngle(zAxis, s.angle);
      q.multiply(q2);
      m.compose(s.pos, q, new THREE.Vector3(1, 1, 1));
      this.arms.setMatrixAt(k, m);
      const on = s.c.active;
      this.lampA.setColorAt(k, on && flash ? red : off);
      this.lampB.setColorAt(k, on && !flash ? red : off);
    });
    this.arms.instanceMatrix.needsUpdate = true;
    this.lampA.instanceColor.needsUpdate = true;
    this.lampB.instanceColor.needsUpdate = true;
  }

  setVisible(camera) { this.group.visible = camera.position.y < 2500; }
}
