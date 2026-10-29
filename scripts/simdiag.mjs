// Diagnose delay sources: logs, per leg, delay gained and whether the train was held at a signal.
import fs from 'node:fs';
import { Network } from '../src/sim/network.js';
import { Simulation, fmtTime } from '../src/sim/simulation.js';
const [date = '20261029', fromH = '5', toH = '11'] = process.argv.slice(2);
const net = new Network(JSON.parse(fs.readFileSync('public/data/network.json')));
const patterns = JSON.parse(fs.readFileSync('public/data/patterns.json'));
const index = JSON.parse(fs.readFileSync('public/data/tt/index.json'));
globalThis.fetch = async (u) => ({ json: async () => JSON.parse(fs.readFileSync('public/' + u)) });
const sim = new Simulation(net, patterns);
await sim.loadDate(date, index);
sim.seek(+fromH * 3600);
const legs = [];
for (const tr of sim.trains) {
  const origArr = tr.arrive.bind(tr), origUpd = tr.update.bind(tr);
  tr._held = 0; tr._heldBy = new Map();
  tr.update = (now, dt) => {
    origUpd(now, dt);
    if (tr.state === 'run' && tr.signal && tr.signal.red && tr.v < 0.5 && tr.signal.dist < 60) {
      tr._held += dt; const o = tr.signal.sig.owner; const k = o ? o.trip.id + '|' + o.state + '|' + (o.reversing ? 'rev' : '') : '?';
      tr._heldBy.set(k, (tr._heldBy.get(k) || 0) + dt);
    }
  };
  tr.arrive = (now) => {
    const before = tr.delay; const dep = tr.departedAt; const k0 = tr.stopIdx;
    origArr(now);
    if (tr.targetPass) return;
    const [arr] = tr.times(tr.stopIdx); const [, sdep] = tr.times(k0);
    const sched = arr - sdep, actual = now - (dep ?? sdep);
    legs.push({ id: tr.trip.id, rt: tr.trip.rt, from: tr.pattern.stops[k0][0], to: tr.pattern.stops[tr.stopIdx][0], sched, actual,
      gain: actual - sched, held: tr._held, heldBy: [...tr._heldBy], minT: tr._minT, t: fmtTime(now) });
    tr._held = 0; tr._heldBy = new Map();
  };
}
while (sim.time < +toH * 3600) { sim.speed = 20; sim.step(1); }
const nm = (s) => net.stations[net.stops[s]?.st]?.n || s;
const bad = legs.filter((l) => l.gain > 45).sort((a, b) => b.gain - a.gain);
console.log('legs', legs.length, 'legs losing >45s', bad.length, 'of which mostly held', bad.filter((l) => l.held > l.gain * 0.5).length);
for (const l of bad.slice(0, 40)) console.log(l.rt, l.t, nm(l.from), '->', nm(l.to), 'sched', l.sched, 'actual', Math.round(l.actual), 'held', Math.round(l.held), JSON.stringify(l.heldBy.slice(0, 2)));
// stuck trains
const stuck = sim.active.filter((t) => t.state === 'run' && t.v < 0.1);
console.log('stopped-running trains at end:', stuck.length);
for (const t of stuck.slice(0, 15)) console.log(t.trip.id, 's', t.s.toFixed(0), 'target', t.targetS?.toFixed(0), 'sig', t.signal && { d: t.signal.dist.toFixed(0), red: t.signal.red, owner: t.signal.sig.owner?.trip.id, ownerState: t.signal.sig.owner?.state }, 'held', t.heldSince && fmtTime(t.heldSince));
