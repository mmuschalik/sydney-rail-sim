// Simulation orchestrator: timetable loading, train lifecycle, clock, signalling.
import { Train } from './train.js';

const ASPECT = { RED: 0, YELLOW: 1, DYELLOW: 2, GREEN: 3 };
export { ASPECT };

export class Simulation {
  constructor(net, patterns) {
    this.net = net;
    this.patterns = patterns;
    this.trains = [];
    this.active = [];
    this.time = 0;          // seconds since midnight of this.date (service day)
    this.speed = 1;
    this.paused = false;
    this.date = null;
    this.mainSignals = net.signals.filter((s) => s.type === 'main' || s.type === 'metro');
    this.sigTimer = 0;
  }

  async loadDate(dateStr, index) {
    // choose the timetable file: exact date, else same weekday
    let ds = dateStr;
    if (!index.find((d) => d.date === ds)) {
      const dow = (new Date(`${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}T12:00:00`).getDay() + 6) % 7;
      ds = index.find((d) => d.dow === dow).date;
    }
    const prev = shiftDate(dateStr, -1);
    let ps = index.find((d) => d.date === prev) ? prev : null;
    if (!ps) {
      const dow = (new Date(`${prev.slice(0, 4)}-${prev.slice(4, 6)}-${prev.slice(6, 8)}T12:00:00`).getDay() + 6) % 7;
      ps = index.find((d) => d.dow === dow).date;
    }
    const [today, yday] = await Promise.all([
      fetch(`data/tt/${ds}.json`).then((r) => r.json()),
      fetch(`data/tt/${ps}.json`).then((r) => r.json()),
    ]);
    this.date = dateStr;
    this.ttDate = ds;
    // trips from yesterday's service still running after midnight
    const late = yday.trips.filter((t) => t.t[t.t.length - 3] > 86400 - 600).map((t) => ({
      ...t, t: t.t.map((v, i) => (i % 3 === 2 ? v : v - 86400)), id: t.id + '#y',
    }));
    this.buildTrains([...late, ...today.trips]);
  }

  /**
   * Group trips into physical trains. TfNSW run numbers change per trip, so trains are
   * formed the way terminus turnarounds work: a consist that terminates at a platform
   * forms the next departure from that same platform (same fleet and car count),
   * at least MIN_TURN seconds later and within MAX_TURN.
   */
  buildTrains(trips) {
    const MIN_TURN = 120, MAX_TURN = 75 * 60;
    const items = [];
    for (const t of trips) {
      const pattern = this.patterns[t.p];
      if (pattern) items.push({ trip: t, pattern, path: null });
    }
    items.sort((a, b) => a.trip.t[1] - b.trip.t[1]);
    const waiting = new Map(); // platform stop id -> [{chain, freeAt, key}]
    const chains = [];
    for (const it of items) {
      const st0 = it.pattern.stops[0][0];
      const dep = it.trip.t[1];
      const key = it.trip.f + '|' + it.trip.n;
      let chain = null;
      const list = st0 && waiting.get(st0);
      if (list) {
        let bi = -1;
        for (let i = 0; i < list.length; i++) {
          const w = list[i];
          if (w.key === key && w.freeAt + MIN_TURN <= dep && dep - w.freeAt <= MAX_TURN && (bi < 0 || w.freeAt < list[bi].freeAt)) bi = i;
        }
        if (bi >= 0) { chain = list[bi].chain; list.splice(bi, 1); }
      }
      if (!chain) { chain = []; chains.push(chain); }
      chain.push(it);
      const last = it.pattern.stops[it.pattern.stops.length - 1][0];
      if (last) {
        if (!waiting.has(last)) waiting.set(last, []);
        waiting.get(last).push({ chain, freeAt: it.trip.t[it.trip.t.length - 3], key });
      }
    }
    const trains = chains.map((c) => new Train(this, c[0].trip.run, c));
    trains.sort((a, b) => a.spawnTime - b.spawnTime);
    this.trains = trains;
    this.active = [];
    this.nextSpawn = 0;
  }

  stationOf(stopId) {
    const s = this.net.stops[stopId];
    return s ? s.st : stopId;
  }

  /** Jump to a time: fast-forward every train that should be running. */
  seek(t) {
    this.time = t;
    this.active = [];
    for (const tr of this.trains) {
      tr.state = 'pending';
      tr.visible = false;
    }
    this.nextSpawn = 0;
    // spawn and fast-simulate trains already underway
    while (this.nextSpawn < this.trains.length && this.trains[this.nextSpawn].spawnTime <= t) {
      const tr = this.trains[this.nextSpawn++];
      if (tr.endTime < t) continue;
      tr.spawn(tr.spawnTime);
      let tt = tr.spawnTime;
      while (tt < t && tr.state !== 'done') {
        const dt = Math.min(2, t - tt);
        tr.update(tt + dt, dt);
        tt += dt;
      }
      if (tr.state !== 'done') this.active.push(tr);
    }
    this.updateSignals();
  }

  step(realDt) {
    if (this.paused) return;
    let simDt = Math.min(realDt, 0.25) * this.speed;
    while (simDt > 1e-6) {
      const dt = Math.min(simDt, this.speed > 20 ? 1.0 : 0.25);
      simDt -= dt;
      this.time += dt;
      while (this.nextSpawn < this.trains.length && this.trains[this.nextSpawn].spawnTime <= this.time) {
        const tr = this.trains[this.nextSpawn++];
        tr.spawn(this.time);
        this.active.push(tr);
      }
      for (const tr of this.active) tr.update(this.time, dt);
      this.sigTimer += dt;
      if (this.sigTimer > 0.5) { this.sigTimer = 0; this.updateSignals(); this.updateCrossings(); }
    }
    let removed = false;
    for (const tr of this.active) if (tr.state === 'done') { tr.visible = false; removed = true; }
    if (removed) this.active = this.active.filter((t) => t.state !== 'done');
  }

  /** Level crossings: warning starts ~30 s before a train arrives, booms rise after it clears. */
  updateCrossings() {
    for (const c of this.net.crossings) c.active = false;
    for (const tr of this.active) {
      if (tr.state === 'pending' || tr.state === 'done') continue;
      const warn = Math.max(250, tr.v * 32);
      for (const x of tr.path.crossingList) {
        if (x.s > tr.s - tr.length - 5 && x.s < tr.s + warn) x.c.active = true;
      }
    }
  }

  /**
   * Signal aspects from train occupancy (automatic block, NSW 4-aspect):
   * the signal protecting the block a train occupies shows red, the one before yellow,
   * the one before that double-yellow (medium), otherwise green.
   */
  updateSignals() {
    for (const s of this.mainSignals) { s.aspect = ASPECT.GREEN; s.owner = null; }
    for (const tr of this.active) {
      if (tr.state === 'pending' || tr.state === 'done') continue;
      const list = tr.path.mainSignals;
      if (!list.length) continue;
      const head = tr.s, tail = tr.s - tr.length - 20;
      // index of first signal ahead of the head
      let k = 0;
      while (k < list.length && list[k].s <= head) k++;
      // all signals between tail and head + the last passed: red
      let firstRed = -1;
      for (let i = k - 1; i >= 0; i--) {
        const sg = list[i];
        if (sg.s >= tail || i === k - 1) {
          setAspect(sg.sig, ASPECT.RED, tr);
          firstRed = i;
        } else break;
      }
      if (firstRed > 0) setAspect(list[firstRed - 1].sig, ASPECT.YELLOW, tr);
      if (firstRed > 1) setAspect(list[firstRed - 2].sig, ASPECT.DYELLOW, tr);
    }
  }

  /**
   * Next main signal ahead of a train with its aspect (ignoring the train's own occupancy).
   * Looks several signals ahead (within braking distance) so a red beyond a yellow is seen.
   */
  signalAhead(tr) {
    const list = tr.path.mainSignals;
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].s <= tr.s + 1) lo = m + 1; else hi = m; }
    if (lo >= list.length) return null;
    const look = (tr.v * tr.v) / (2 * tr.spec.decel * 0.8) + 250;
    let first = null;
    for (let i = lo; i < list.length && i < lo + 6; i++) {
      const x = list[i];
      const sig = x.sig;
      const own = sig.owner === tr;
      const red = sig.aspect === ASPECT.RED && !own && sig.passAuth !== tr.id;
      const info = { s: x.s, sig, red, aspect: own ? ASPECT.GREEN : sig.aspect, dist: x.s - tr.s };
      if (!first) first = info;
      if (red) return info;
      if (x.s - tr.s > look) break;
    }
    return first;
  }

  clockString() {
    return fmtTime(this.time);
  }
}

function setAspect(sig, a, tr) {
  if (a < sig.aspect) { sig.aspect = a; sig.owner = tr; }
}

export function fmtTime(t) {
  t = ((t % 86400) + 86400) % 86400;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function shiftDate(ds, days) {
  const d = new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8)));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
