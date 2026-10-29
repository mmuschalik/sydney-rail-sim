// Headless simulation check: runs a service day and reports arrival punctuality.
// Usage: node scripts/simtest.mjs [YYYYMMDD] [fromHour] [toHour]
import fs from 'node:fs';
import { Network } from '../src/sim/network.js';
import { Simulation, fmtTime } from '../src/sim/simulation.js';

const [date = '20261029', fromH = '4', toH = '27'] = process.argv.slice(2);
const net = new Network(JSON.parse(fs.readFileSync('public/data/network.json')));
const patterns = JSON.parse(fs.readFileSync('public/data/patterns.json'));
const index = JSON.parse(fs.readFileSync('public/data/tt/index.json'));
globalThis.fetch = async (u) => ({ json: async () => JSON.parse(fs.readFileSync('public/' + u)) });

const sim = new Simulation(net, patterns);
await sim.loadDate(date, index);
console.log('trains', sim.trains.length);
sim.seek(+fromH * 3600);

// instrument arrivals
const delays = [];
const byRoute = {};
const worst = [];
for (const tr of sim.trains) {
  const orig = tr.arrive.bind(tr);
  tr.arrive = (now) => {
    orig(now);
    if (!tr.targetPass) {
      const d = tr.delay;
      delays.push(d);
      const r = tr.trip.rt;
      (byRoute[r] ??= []).push(d);
      if (d > 180) worst.push([d, tr.trip.id, tr.pattern.stops[tr.stopIdx][0], fmtTime(now)]);
    }
  };
}
const t0 = Date.now();
let maxActive = 0;
let lastReport = sim.time;
while (sim.time < +toH * 3600) {
  sim.speed = 40; // 40 sim seconds per 'frame' at dt 1
  sim.step(1);
  maxActive = Math.max(maxActive, sim.active.length);
  if (sim.time - lastReport >= 3600) {
    lastReport = sim.time;
    const moving = sim.active.filter((t) => t.state === 'run').length;
    const held = sim.active.filter((t) => t.heldSince != null).length;
    console.log(fmtTime(sim.time), 'active', sim.active.length, 'running', moving, 'held at signal', held);
  }
}
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))]; };
console.log('sim wall time', ((Date.now() - t0) / 1000).toFixed(1), 's; max active', maxActive);
console.log('arrivals', delays.length, 'median delay', pct(delays, 0.5)?.toFixed(1), 'p90', pct(delays, 0.9)?.toFixed(1),
  'p99', pct(delays, 0.99)?.toFixed(1), 'on-time(<=60s) %', (100 * delays.filter((d) => d <= 60).length / delays.length).toFixed(1),
  'early(<-30s) %', (100 * delays.filter((d) => d < -30).length / delays.length).toFixed(1));
for (const [r, a] of Object.entries(byRoute)) console.log(r.padEnd(5), String(a.length).padStart(6), 'median', pct(a, 0.5).toFixed(0), 'p90', pct(a, 0.9).toFixed(0), 'p99', pct(a, 0.99).toFixed(0));
worst.sort((a, b) => b[0] - a[0]);
for (const w of worst.slice(0, 25)) console.log('late', Math.round(w[0]), w[1], net.stations[net.stops[w[2]]?.st]?.n, w[2], w[3]);
