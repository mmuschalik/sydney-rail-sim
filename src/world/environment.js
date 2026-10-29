// Sky, sun (true solar position over Sydney for the simulated date/time), lights, fog, night.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { ORIGIN } from '../geo.js';

/** UTC offset (hours) of Australia/Sydney on a given YYYYMMDD at local noon */
export function sydneyOffset(ds) {
  const d = new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8), 2));
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hour12: false }).formatToParts(d);
  const h = +parts.find((p) => p.type === 'hour').value;
  return (h - 2 + 24) % 24;
}

/** Solar azimuth/elevation (radians) — NOAA algorithm */
export function sunPosition(utcMs, lat, lon) {
  const jd = utcMs / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const Mr = (M * Math.PI) / 180;
  const C = Math.sin(Mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * t) + Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin((omega * Math.PI) / 180);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos((omega * Math.PI) / 180);
  const decl = Math.asin(Math.sin((eps * Math.PI) / 180) * Math.sin((lambda * Math.PI) / 180));
  const y = Math.tan((eps * Math.PI) / 360) ** 2;
  const L0r = (L0 * Math.PI) / 180;
  const eqTime = 4 * (180 / Math.PI) * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
    - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
  const d = new Date(utcMs);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const tst = (minutes + eqTime + 4 * lon) % 1440;
  const ha = ((tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180) * Math.PI) / 180;
  const latr = (lat * Math.PI) / 180;
  const cosZen = Math.sin(latr) * Math.sin(decl) + Math.cos(latr) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZen)));
  const elev = Math.PI / 2 - zen;
  let az = Math.acos(Math.min(1, Math.max(-1, (Math.sin(latr) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(latr) * Math.sin(zen)))));
  az = ha > 0 ? az + Math.PI : Math.PI - az; // from north, clockwise
  return { azimuth: az % (2 * Math.PI), elevation: elev };
}

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.sky = new Sky();
    this.sky.scale.setScalar(450000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    const sc = this.sun.shadow.camera;
    sc.left = -450; sc.right = 450; sc.top = 450; sc.bottom = -450; sc.near = 10; sc.far = 4000;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe2ff, 0x5b5040, 0.9);
    scene.add(this.hemi);
    this.moonlight = new THREE.AmbientLight(0x3a4a70, 0);
    scene.add(this.moonlight);
    scene.fog = new THREE.FogExp2(0xbfd3e6, 0.000018);
    this.night = 0;
    this.sunDir = new THREE.Vector3();
    // stars
    const n = 2500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) + 0.02; v.normalize().multiplyScalar(400000);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);
  }

  /** dateStr YYYYMMDD, t = seconds since local midnight */
  update(dateStr, t, focus, camera) {
    const off = sydneyOffset(dateStr);
    const utc = Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(4, 6) - 1, +dateStr.slice(6, 8)) + (t - off * 3600) * 1000;
    const { azimuth, elevation } = sunPosition(utc, ORIGIN.lat, ORIGIN.lon);
    // world: +x east, +z south; azimuth from north clockwise
    const ce = Math.cos(elevation);
    this.sunDir.set(Math.sin(azimuth) * ce, Math.sin(elevation), -Math.cos(azimuth) * ce);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const el = elevation * 180 / Math.PI;
    const day = THREE.MathUtils.smoothstep(el, -4, 8);
    this.night = 1 - THREE.MathUtils.smoothstep(el, -8, 2);
    const warm = 1 - THREE.MathUtils.smoothstep(el, 2, 25);
    this.sun.color.setRGB(1, 1 - warm * 0.25, 1 - warm * 0.5);
    this.sun.intensity = 2.5 * day;
    this.hemi.intensity = 0.12 + 0.6 * day;
    this.hemi.color.setRGB(0.8 + 0.1 * day, 0.86, 1);
    this.moonlight.intensity = 0.45 * this.night;
    this.renderer.toneMappingExposure = 0.55 + 0.45 * day + 0.25 * this.night;
    this.stars.material.opacity = this.night * 0.9;
    const fogDay = new THREE.Color(0xc4d6e8), fogNight = new THREE.Color(0x0b1220), fogDusk = new THREE.Color(0xd9a27a);
    const fc = fogDay.clone().lerp(fogDusk, warm * day * 0.6).lerp(fogNight, this.night);
    this.scene.fog.color.copy(fc);
    const alt = camera.position.y;
    this.scene.fog.density = alt > 3000 ? 0.000006 : 0.000016;
    // shadow camera follows the focus point
    const f = focus;
    const D = 1500;
    this.sun.position.set(f.x + this.sunDir.x * D, f.y + Math.max(0.05, this.sunDir.y) * D, f.z + this.sunDir.z * D);
    this.sun.target.position.copy(f);
    this.sun.castShadow = day > 0.05 && alt < 2500;
    const s = THREE.MathUtils.clamp(alt * 0.9, 150, 900);
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - s) > 20) { sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.updateProjectionMatrix(); }
    return this.night;
  }
}
