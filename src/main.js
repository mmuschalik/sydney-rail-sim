// Sydney Rail Network — live timetable simulation.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { Network } from './sim/network.js';
import { Simulation, fmtTime, shiftDate } from './sim/simulation.js';
import { Terrain, initDem } from './world/terrain.js';
import { TrackRenderer } from './world/tracks.js';
import { StationRenderer } from './world/stations.js';
import { SignalRenderer } from './world/signals.js';
import { Buildings } from './world/buildings.js';
import { Environment, sydneyOffset } from './world/environment.js';
import { makeCarver } from './world/carve.js';
import { Water, SkyEnvironment } from './world/water.js';
import { TrainRenderer } from './render/trainRenderer.js';
import { project } from './geo.js';
import { UI } from './ui/ui.js';

const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const progress = (msg, f) => { $('ld-msg').textContent = msg; $('ld-fill').style.width = `${Math.round(f * 100)}%`; };

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance', preserveDrawingBuffer: q.has('shot') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 600000);
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 8;
controls.maxDistance = 150000;
controls.screenSpacePanning = false;
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

// environment map for metallic train bodies
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

// camera presets: [target x, z], camera offset [dx, dy, dz]
const V = (label, tx, tz, ty, dx, dy, dz) => ({ label, target: [tx, ty, tz], pos: [tx + dx, ty + dy, tz + dz] });
export const VIEWS = {
  overview: V('Whole network', -18000, -2000, 0, 6000, 30000, 34000),
  harbour: V('Harbour Bridge', 150, -3300, 40, -700, 330, -900),
  cbd: V('CBD & City Circle', 150, -1300, 20, 1300, 1100, 1700),
  central: V('Central', -40, 150, 25, 420, 260, 520),
  redfern: V('Redfern', -700, 950, 30, 380, 220, 360),
  strathfield: V('Strathfield', -10350, -1280, 25, 600, 380, 600),
  parramatta: V('Parramatta', -18570, -7310, 20, 600, 400, 600),
  chatswood: V('Chatswood', -2340, -9560, 90, 500, 350, 600),
  metro: V('Metro North West', -26100, -21000, 70, 1200, 700, 1300),
  airport: V('Airport line', -3740, 5760, 10, 900, 600, 900),
  blacktown: V('Blacktown', -27650, -12750, 50, 500, 350, 500),
};

// ---------------------------------------------------------------- data
async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }

function sydneyNow() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}${p.month}${p.day}`, t: (+p.hour % 24) * 3600 + +p.minute * 60 + +p.second };
}

progress('Loading track network…', 0.05);
const [netJson, patterns, ttIndex] = await Promise.all([getJSON('data/network.json'), getJSON('data/patterns.json'), getJSON('data/tt/index.json')]);
progress('Building network graph…', 0.3);
const net = new Network(netJson);
// rail levels on the modelled Harbour Bridge and Metro cable-stayed bridge decks
let lm = null;
try {
  lm = await import('./models/landmarks/index.js');
  for (const e of net.edges) {
    for (let i = 0; i < e.p.length; i += 3) {
      const h = lm.harbourBridgeRailHeight(e.p[i], e.p[i + 2]) ?? lm.metroBridgeRailHeight(e.p[i], e.p[i + 2]);
      if (h != null) e.p[i + 1] = h;
    }
  }
} catch (err) { console.warn('landmark heights', err); }
const sim = new Simulation(net, patterns);

let { date, t } = sydneyNow();
if (q.get('date')) date = q.get('date');
if (q.get('t')) { const [h, m] = q.get('t').split(':').map(Number); t = h * 3600 + m * 60; }
// service day: before 3am belongs to the previous day's timetable
if (t < 3 * 3600) { date = shiftDate(date, -1); t += 86400; }
progress('Loading timetable…', 0.4);
await sim.loadDate(date, ttIndex);
progress('Placing trains…', 0.55);
sim.seek(t);
sim.speed = +(q.get('speed') || 1);

progress('Building world…', 0.65);
const env = new Environment(scene, renderer);
const water = new Water(scene);
const skyEnv = new SkyEnvironment(renderer, scene, env.sky);
await initDem();
const carver = makeCarver(net);
const terrain = new Terrain(scene, { carve: carver });
const tracks = new TrackRenderer(net, scene, {
  skipStructure: (x, z) => !!lm && (lm.harbourBridgeRailHeight(x, z) != null || lm.metroBridgeRailHeight(x, z) != null),
});
const stations = new StationRenderer(net, scene, 0);
const signals = new SignalRenderer(net, scene);
const buildings = new Buildings(scene);
await buildings.init();
const trains = new TrainRenderer(scene);

// landmarks (optional module built separately)
const landmarkMods = import.meta.glob('./models/landmarks/index.js');
for (const load of Object.values(landmarkMods)) {
  load().then(async (m) => {
    const g = await m.buildLandmarks();
    scene.add(g);
    g.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      if (o.material?.userData?.nightEmissive) nightMats.add(o.material);
    });
  }).catch((e) => console.warn('landmarks', e));
}
const nightMats = new Set();

// ---------------------------------------------------------------- camera / views
const view = VIEWS[q.get('view') || 'overview'] || VIEWS.overview;
camera.position.fromArray(q.get('cam') ? q.get('cam').split(',').map(Number) : view.pos);
controls.target.fromArray(q.get('target') ? q.get('target').split(',').map(Number) : view.target);
controls.update();

const state = { selected: null, mode: 'free', xray: null, fly: null };
function flyTo(v) {
  state.mode = 'free';
  state.fly = { from: camera.position.clone(), fromT: controls.target.clone(), to: new THREE.Vector3(...v.pos), toT: new THREE.Vector3(...v.target), t: 0 };
}
function select(tr, mode = 'follow') {
  state.selected = tr;
  state.mode = tr ? mode : 'free';
  if (tr && mode === 'follow') {
    const c = tr.path.pointAt(tr.s - tr.length / 2, new THREE.Vector3());
    const off = camera.position.clone().sub(controls.target);
    if (off.length() > 900 || off.length() < 30) off.set(160, 90, 160);
    state.fly = { from: camera.position.clone(), fromT: controls.target.clone(), to: c.clone().add(off), toT: c, t: 0, follow: true };
  }
}

// picking
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const v = new THREE.Vector3();
  let best = null, bd = 28;
  for (const tr of sim.active) {
    if (!tr.screenPos) continue;
    // test several points along the train
    for (let k = 0; k <= 4; k++) {
      tr.path.pointAt(tr.s - (tr.length * k) / 4, v);
      v.project(camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
      const d = Math.hypot(sx - e.clientX, sy - e.clientY);
      if (d < bd) { bd = d; best = tr; }
    }
  }
  if (best) select(best, state.mode === 'cab' ? 'cab' : 'follow');
});
renderer.domElement.addEventListener('wheel', () => { if (state.mode === 'cab') state.mode = 'follow'; });

const ui = new UI({ sim, net, state, select, flyTo, views: VIEWS, setSpeed: (s) => { sim.speed = s; sim.paused = s === 0; },
  jumpNow: () => { const n = sydneyNow(); let d = n.date, tt = n.t; if (tt < 3 * 3600) { d = shiftDate(d, -1); tt += 86400; } if (d !== sim.date) sim.loadDate(d, ttIndex).then(() => sim.seek(tt)); else sim.seek(tt); } });

if (q.get('follow')) {
  const want = q.get('follow');
  const cand = sim.active.filter((tr) => tr.state === 'run' && (tr.trip.rt === want || tr.trip.id.startsWith(want)));
  if (cand.length) select(cand[Math.floor(cand.length / 2)], q.get('mode') || 'follow');
}

if (q.get('near')) {
  const [nx, nz] = q.get('near').split(',').map(Number);
  const v = new THREE.Vector3();
  let best = null, bd = 1e9;
  for (const tr of sim.active) {
    if (tr.state === 'pending') continue;
    tr.path.pointAt(tr.s - tr.length / 2, v);
    const d = Math.hypot(v.x - nx, v.z - nz);
    if (d < bd) { bd = d; best = tr; }
  }
  if (best) select(best, q.get('mode') || 'follow');
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
const focus = new THREE.Vector3();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
let sigTimer = 0, uiTimer = 0, frame = 0;
progress('Streaming satellite imagery…', 0.85);

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  frame++;
  sim.step(dt);
  // midnight rollover of the service day at 03:00 next day
  if (sim.time > 86400 + 3 * 3600 && !sim._rolling) {
    sim._rolling = true;
    const nd = shiftDate(sim.date, 1), nt = sim.time - 86400;
    sim.loadDate(nd, ttIndex).then(() => { sim.seek(nt); sim._rolling = false; });
  }

  // camera animation / follow
  const tr = state.selected;
  if (tr && (tr.state === 'done' || tr.state === 'pending')) { state.selected = null; state.mode = 'free'; }
  if (state.fly) {
    const f = state.fly;
    f.t = Math.min(1, f.t + dt / 2.2);
    const k = f.t * f.t * (3 - 2 * f.t);
    if (f.follow && state.selected) {
      const c = state.selected.path.pointAt(state.selected.s - state.selected.length / 2, tmpV);
      f.to.add(tmpV2.subVectors(c, f.toT)); f.toT.copy(c);
    }
    camera.position.lerpVectors(f.from, f.to, k);
    controls.target.lerpVectors(f.fromT, f.toT, k);
    if (f.t >= 1) state.fly = null;
  } else if (state.selected && state.mode === 'follow') {
    const c = state.selected.path.pointAt(state.selected.s - state.selected.length / 2, tmpV);
    const d = tmpV2.subVectors(c, controls.target);
    controls.target.add(d); camera.position.add(d);
  }
  if (state.selected && state.mode === 'cab' && !state.fly) {
    const s = state.selected;
    const head = s.path.pointAt(s.s + 0.4, tmpV);
    const ahead = s.path.pointAt(s.s + 60, tmpV2);
    camera.position.set(head.x, head.y + 2.9, head.z);
    controls.target.set(ahead.x, ahead.y + 2.2, ahead.z);
    camera.lookAt(controls.target);
  } else if (!state.fly) {
    controls.update();
  }
  // keep the camera above ground
  const gh = terrain.heightAt(camera.position.x, camera.position.z);
  if (gh != null && state.mode !== 'cab' && camera.position.y < gh + 4) camera.position.y = gh + 4;

  focus.copy(controls.target);
  const night = env.update(sim.date, sim.time, focus, camera);
  skyEnv.update(env.sunDir, night);
  water.update(performance.now() / 1000, camera);
  trains.night = night;
  buildings.night = night;
  terrain.nightGlow.value = night;
  stations.setNight(night);
  for (const m of nightMats) m.emissiveIntensity = night;

  // x-ray (see-through ground) when asked, or when following a train underground
  const underground = state.selected && (state.selected.path.flagsAt(state.selected.s - state.selected.length / 2) & 1) && state.mode === 'follow';
  const xray = !!state.xray || !!underground;
  terrain.setXray(xray);
  buildings.setXray(xray);
  terrain.update(camera);
  tracks.update(camera, { xray });
  buildings.update(camera, focus);
  stations.update(camera, (x, z) => terrain.heightAt(x, z));
  trains.update(sim.active, camera, { selected: state.selected, tunnelLights: true });
  signals.setVisible(camera);
  sigTimer += dt;
  if (sigTimer > 0.25) { sigTimer = 0; signals.update(); }
  uiTimer += dt;
  if (uiTimer > 0.2) { uiTimer = 0; ui.update(); }
  renderer.render(scene, camera);

  if (frame === 30) $('loading').classList.add('done');
  window.__stats = { frame, tiles: terrain.pending, trains: sim.active.length, bld: buildings.busy + buildings.queue.length };
});

window.__sim = sim; window.__net = net; window.__camera = camera; window.__controls = controls; window.__state = state;
window.__select = select; window.__flyTo = flyTo; window.__buildings = buildings; window.__scene = scene;
