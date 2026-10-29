// Sydney Tower Eye (Centrepoint, 1981) — 309 m above street level.
// Position: OSM building:part ways 197801072 (turret, r = 15 m, 240-270 m), 197801074 (upper drum,
// r = 7.5 m, to 290 m) and 273960049 (spire, 309 m). Shaft of stacked steel "barrels" ~7 m across,
// stabilised by 56 cables arranged as a twisted hyperboloid from the podium roof to the turret.
import * as THREE from 'three';
import { project } from '../../geo.js';
import { GeoBuilder, V, Y_, canvasTexture, stdMat, nightLit, speckle } from './util.js';

export const SYDNEY_TOWER_LATLON = [-33.8704899, 151.2089415]; // centre of OSM turret footprint
const GROUND = 25;   // street level at Pitt St Mall / Market St (m AMSL)
const H = (h) => GROUND + h;

function lathe(B, profile, segs = 48, uvs = 4) {
  // profile: [[r, y], ...] bottom -> top
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1], [r1, y1] = profile[i];
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
      const P = (r, y, a) => V(Math.cos(a) * r, y, Math.sin(a) * r);
      const u0 = k / segs * 24, u1 = (k + 1) / segs * 24;
      B.quad(P(r0, y0, a0), P(r1, y1, a0), P(r1, y1, a1), P(r0, y0, a1), [u0, y0 / uvs], [u0, y1 / uvs], [u1, y1 / uvs], [u1, y0 / uvs]);
    }
  }
}

export function build() {
  const glassTex = canvasTexture(256, 256, (c, w, h) => {
    // 4 m repeat: gold glazing with mullions
    c.fillStyle = '#b8913e'; c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,230,160,0.35)'); g.addColorStop(1, 'rgba(90,60,20,0.35)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#5a4520'; for (let x = 0; x < w; x += 64) c.fillRect(x, 0, 5, h);
    c.fillStyle = '#4a3a20'; c.fillRect(0, 0, w, 10);
  });
  const shaftTex = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#c9cacb'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(80,80,80,0.35)'; for (let y = 0; y < h; y += 64) c.fillRect(0, y, w, 3); // barrel joints every 4 m
    speckle(c, w, h, 3000, 0.08, false, 5);
  });
  const shaftMat = stdMat('Sydney Tower shaft', { color: 0xe4e4e2, map: shaftTex, roughness: 0.55, metalness: 0.3 });
  nightLit(shaftMat, 0x303436, 1);
  const glassMat = stdMat('Sydney Tower gold glass', { color: 0xffffff, map: glassTex, roughness: 0.25, metalness: 0.75 });
  nightLit(glassMat, 0xffc070, 0.8);
  const darkMat = stdMat('Sydney Tower cables & bands', { color: 0x3c3f42, roughness: 0.5, metalness: 0.6 });
  const lightMat = stdMat('Sydney Tower lights', { color: 0xdd2222, roughness: 0.4 });
  nightLit(lightMat, 0xff2a1a, 1.5);

  const shaft = new GeoBuilder(), glass = new GeoBuilder(), dark = new GeoBuilder(), lights = new GeoBuilder();
  // shaft (from below street level, hidden in the Westfield podium) — slight entasis
  lathe(shaft, [[3.6, H(-6)], [3.6, H(60)], [3.45, H(150)], [3.4, H(212)]], 32, 4);
  // lift/stair core rings (barrel flanges) every 12 m
  for (let y = 52; y < 212; y += 12) lathe(dark, [[3.75, H(y)], [3.75, H(y + 0.6)]], 32);
  // turret: flared underside, glazed levels, roof, upper drum
  lathe(shaft, [[3.4, H(212)], [6.5, H(222)], [12.5, H(232)], [15.2, H(238)]], 48);
  lathe(dark, [[15.2, H(238)], [15.6, H(239.5)], [15.6, H(241)], [15.2, H(241)]], 48);
  // glazed levels with dark floor bands (4 levels of observation/restaurant floors)
  const lv = [241, 248, 255, 262];
  for (let i = 0; i < lv.length - 1; i++) {
    lathe(glass, [[15.0, H(lv[i])], [15.4, H(lv[i] + 3.5)], [15.0, H(lv[i + 1] - 0.8)]], 48, 4);
    lathe(dark, [[15.0, H(lv[i + 1] - 0.8)], [15.5, H(lv[i + 1] - 0.4)], [15.0, H(lv[i + 1])]], 48);
  }
  lathe(shaft, [[15.0, H(262)], [15.3, H(264)], [13.5, H(266.5)], [9.0, H(268.5)], [8.0, H(270)]], 48);
  // upper drum (plant, sign band) and cap
  lathe(glass, [[7.6, H(270)], [7.6, H(278)]], 32);
  lathe(dark, [[7.6, H(278)], [7.8, H(278.5)], [7.8, H(285)], [7.6, H(285.5)]], 32);
  lathe(shaft, [[7.6, H(285.5)], [7.4, H(289)], [4.5, H(290)], [2.0, H(291)]], 32);
  // spire / antenna mast with platforms
  lathe(shaft, [[1.6, H(291)], [1.3, H(298)], [0.8, H(304)], [0.35, H(309)]], 12);
  for (const y of [294, 300]) lathe(dark, [[2.4, H(y)], [2.4, H(y + 0.4)]], 12);
  // "Westfield" sign panels (red, lit) on the upper drum, four sides
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4; const c = V(Math.cos(a) * 7.9, H(281.7), Math.sin(a) * 7.9);
    lights.box(c, V(-Math.sin(a), 0, Math.cos(a)), Y_, V(Math.cos(a), 0, Math.sin(a)), 4.2, 1.6, 0.12, 4);
  }
  // aviation light
  lights.box(V(0, H(309.3), 0), V(1, 0, 0), Y_, V(0, 0, 1), 0.3, 0.3, 0.3, 1);

  // 56 stay cables: hyperboloid from the podium roof anchor ring to the turret underside
  const N = 56, rBot = 17.0, rTop = 5.0, yBot = H(48), yTop = H(216), twist = (75 / 180) * Math.PI;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2; const dir = i % 2 ? 1 : -1;
    const p0 = V(Math.cos(a) * rBot, yBot, Math.sin(a) * rBot);
    const p1 = V(Math.cos(a + dir * twist) * rTop, yTop, Math.sin(a + dir * twist) * rTop);
    dark.beam(p0, p1, 0.16, 0.16, V(0, 0, 1), 4, false);
  }
  // anchor ring on the podium roof
  lathe(dark, [[rBot + 0.8, H(46)], [rBot + 0.8, H(48.5)], [rBot - 0.8, H(48.5)], [rBot - 0.8, H(46)]], 56);

  const g = new THREE.Group(); g.name = 'Sydney Tower Eye';
  g.add(shaft.mesh(shaftMat, 'Sydney Tower shaft & turret'), glass.mesh(glassMat, 'Sydney Tower glazing'), dark.mesh(darkMat, 'Sydney Tower cables & bands'), lights.mesh(lightMat, 'Sydney Tower lights'));
  const p = project(...SYDNEY_TOWER_LATLON); g.position.set(p.x, 0, p.z);
  return g;
}
export default build;
