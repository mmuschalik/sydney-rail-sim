// Train dynamics + driver model.
//
// A Train is one physical consist working a chain of timetabled trips (same run
// number, consecutive trips starting where the previous one ended).
//
// The driver:
//  - dwells at each stop until the scheduled departure (min dwell when late),
//  - picks a cruise speed so that it arrives at the next stop on time
//    (fastest feasible profile under speed limits when running late),
//  - respects line speed limits (over the whole train length), braking curves
//    to speed restrictions, stopping points and red signals,
//  - accelerates with a power-limited traction curve and brakes at service rate.
import { fleet } from '../models/trains/index.js';

const MIN_DWELL = 20;      // s, when running late
const REVERSE_DWELL = 90;  // s, driver changes ends
const SIGNAL_MARGIN = 12;  // m, stop this far before a red signal
const PREP_TIME = 240;     // s, train appears at its first platform before departure

export class Train {
  constructor(sim, run, trips) {
    this.sim = sim;
    this.run = run;
    this.trips = trips;          // [{trip, pattern}]
    this.tripIdx = 0;
    const t0 = trips[0].trip;
    this.spec = fleet(t0.f);
    this.fleetCode = this.spec === fleet(t0.f) ? t0.f : 'A';
    this.cars = t0.n;
    this.length = this.cars * this.spec.carLength;
    this.state = 'pending';
    this.s = 0;
    this.v = 0;
    this.a = 0;
    this.delay = 0;
    this.cruise = null;
    this.cruiseAt = -1e9;
    this.heldSince = null;
    this.visible = false;
    const first = trips[0];
    const startsAtStop = first.pattern.stops[0][0] !== '';
    this.spawnTime = startsAtStop ? t0.t[1] - PREP_TIME : t0.t[1];
    const last = trips[trips.length - 1].trip;
    this.endTime = last.t[last.t.length - 3] + 150;
    this.id = `${run}@${t0.t[1]}`;
  }

  get trip() { return this.trips[this.tripIdx].trip; }
  get pattern() { return this.trips[this.tripIdx].pattern; }
  get path() { return this.trips[this.tripIdx].path; }

  /** time of stop k of current trip: [arr, dep, flag] */
  times(k) { const t = this.trip.t; return [t[k * 3], t[k * 3 + 1], t[k * 3 + 2]]; }

  spawn(now) {
    this.state = 'dwell';
    this.startTrip(0, now);
  }

  startTrip(idx, now) {
    this.tripIdx = idx;
    const tr = this.trips[idx];
    if (!tr.path) tr.path = this.sim.net.getPath('p' + tr.trip.p, tr.pattern.segs);
    const pat = tr.pattern;
    this.stopIdx = 0;
    this.revIdx = 0;
    this.revs = pat.revs || [];
    const [, dep] = this.times(0);
    if (pat.stops[0][0] === '') {
      // entering from the edge of the modelled network at line speed
      this.s = 0;
      this.v = Math.min(tr.path.limitAt(0), 22);
      this.state = 'run';
      this.departAt = dep;
      this.setTarget(now);
    } else {
      this.s = Math.min(pat.stops[0][3], tr.path.length);
      this.v = 0;
      this.state = 'dwell';
      this.departAt = dep;
    }
    this.atStation = pat.stops[0][0];
  }

  nextStopIndex(from) {
    const n = this.pattern.stops.length;
    for (let k = from + 1; k < n; k++) {
      const [, , f] = this.times(k);
      if (f === 1 || k === n - 1) return k;
    }
    return -1;
  }

  setTarget(now) {
    const k = this.nextStopIndex(this.stopIdx);
    this.targetIdx = k;
    if (k < 0) { this.state = 'done'; return; }
    const st = this.pattern.stops[k];
    this.targetS = st[0] === '' ? Math.max(st[3], this.pattern.len) + 40 : st[3];
    this.targetPass = st[0] === '';
    // reversal before the stop?
    this.revTarget = null;
    while (this.revIdx < this.revs.length && this.revs[this.revIdx] < this.s + 1) this.revIdx++;
    if (this.revIdx < this.revs.length && this.revs[this.revIdx] < this.targetS) this.revTarget = this.revs[this.revIdx];
    this.cruiseAt = -1e9;
  }

  /** Speed limit over the whole train length at head position s */
  trainLimit(s) {
    const p = this.path;
    let v = p.limitAt(s);
    for (let x = 10; x < this.length; x += 10) v = Math.min(v, p.limitAt(s - x));
    return Math.min(v, this.spec.maxSpeedKmh / 3.6);
  }

  tractive(v) {
    // power-limited: full acceleration below ~40 km/h, then ~1/v
    const knee = this.spec.knee || 11;
    return this.spec.accel * (v < knee ? 1 : knee / v);
  }

  /** Travel time from (s, v) to stop at sEnd capped at cruise speed vc */
  travelTime(s0, v0, sEnd, vc, endSpeed = 0) {
    const p = this.path;
    const D = sEnd - s0;
    if (D <= 0) return 0;
    const n = Math.max(2, Math.min(800, Math.ceil(D / 20)));
    const ds = D / n;
    const v = this._tt || (this._tt = new Float32Array(801));
    const b = this.spec.decel * 0.85;
    v[0] = v0;
    for (let i = 1; i <= n; i++) {
      const lim = Math.min(vc, this.trainLimit(s0 + i * ds));
      const vp = v[i - 1];
      v[i] = Math.min(Math.sqrt(vp * vp + 2 * this.tractive(vp) * ds), lim);
    }
    v[n] = Math.min(v[n], endSpeed);
    for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * b * ds));
    let t = 0;
    for (let i = 1; i <= n; i++) t += ds / Math.max(0.5, (v[i] + v[i - 1]) / 2);
    return t;
  }

  solveCruise(now) {
    const end = this.revTarget ?? this.targetS;
    const endSpeed = this.revTarget == null && this.targetPass ? 20 : 0;
    let [arr] = this.times(this.targetIdx);
    if (this.revTarget != null) {
      // share the available time pro rata to distance (minus the reversal dwell)
      const total = this.targetS - this.s + (this.targetS - this.revTarget);
      const part = this.revTarget - this.s;
      arr = now + Math.max(0, arr - now - REVERSE_DWELL) * (part / Math.max(total, 1));
    }
    const T = arr - now;
    const vmax = this.spec.maxSpeedKmh / 3.6;
    if (T <= 0 || this.travelTime(this.s, this.v, end, vmax, endSpeed) >= T) return vmax;
    let lo = 4, hi = vmax;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (this.travelTime(this.s, this.v, end, mid, endSpeed) > T) lo = mid; else hi = mid;
    }
    return hi;
  }

  update(now, dt) {
    if (this.state === 'dwell') {
      this.v = 0; this.a = 0;
      const [arr, dep] = this.times(this.stopIdx);
      const ready = Math.max(dep, (this.arrivedAt ?? arr) + (this.arrivedAt > arr ? MIN_DWELL : 0));
      if (this.reversing) {
        if (now >= this.reverseUntil) { this.reversing = false; this.state = 'run'; this.cruiseAt = -1e9; }
        return;
      }
      if (now >= ready || now >= this.departAt && this.stopIdx === 0) {
        if (this.stopIdx === this.pattern.stops.length - 1) { this.finishTrip(now); return; }
        this.state = 'run';
        this.departedAt = now;
        this.setTarget(now);
      }
      return;
    }
    if (this.state !== 'run') return;

    const spec = this.spec;
    const b = spec.decel;
    const end = this.revTarget ?? this.targetS;
    const endSpeed = this.revTarget == null && this.targetPass ? 20 : 0;

    if (now - this.cruiseAt > 4) { this.cruise = this.solveCruise(now); this.cruiseAt = now; }

    // constraints: limit over train, braking curves
    let vt = Math.min(this.trainLimit(this.s), this.cruise);
    const brakeDist = (this.v * this.v) / (2 * b) + 60;
    // speed reductions ahead
    for (let x = 10; x < brakeDist + 10; x += 10) {
      const lim = this.path.limitAt(this.s + x);
      vt = Math.min(vt, Math.sqrt(lim * lim + 2 * b * 0.9 * Math.max(0, x - 5)));
    }
    // stopping point
    const dEnd = end - this.s;
    vt = Math.min(vt, Math.sqrt(endSpeed * endSpeed + 2 * b * 0.9 * Math.max(0, dEnd - 0.2)));
    // signals
    const sig = this.sim.signalAhead(this);
    this.signal = sig;
    if (sig && sig.red) {
      const dS = sig.s - SIGNAL_MARGIN - this.s;
      if (dS < brakeDist + 200) {
        vt = Math.min(vt, Math.sqrt(2 * b * 0.9 * Math.max(0, dS)));
        if (this.v < 0.2 && dS < 30) {
          this.heldSince ??= now;
          if (now - this.heldSince > 240) sig.sig.passAuth = this.id; // authority to pass after long hold
        }
      }
    } else this.heldSince = null;
    if (dEnd < 40) vt = Math.max(Math.min(vt, 2.5), endSpeed === 0 ? Math.min(vt, 0.8) : vt);

    // apply acceleration
    let a;
    if (this.v < vt - 0.05) a = Math.min(this.tractive(this.v), (vt - this.v) / dt);
    else a = Math.max(-b * 1.15, (vt - this.v) / dt);
    this.a = a;
    this.v = Math.max(0, this.v + a * dt);
    this.s += this.v * dt;

    if ((endSpeed > 0 && this.s >= end) || (endSpeed === 0 && end - this.s < 1.0 && this.v < 0.6)) {
      if (this.revTarget != null) {
        // driver changes ends: the old tail becomes the head
        this.s = this.revTarget + this.length;
        this.v = 0;
        this.revIdx++;
        this.revTarget = null;
        this.state = 'dwell';
        this.reversing = true;
        this.reverseUntil = now + REVERSE_DWELL;
        this.setTarget(now);
        return;
      }
      this.arrive(now);
    }
  }

  arrive(now) {
    const k = this.targetIdx;
    this.stopIdx = k;
    const [arr] = this.times(k);
    this.delay = now - arr;
    this.arrivedAt = now;
    if (this.targetPass) {
      // left the modelled network
      this.finishTrip(now);
      return;
    }
    this.s = Math.max(this.s, this.targetS - 0.3);
    this.v = 0;
    this.state = 'dwell';
    this.atStation = this.pattern.stops[k][0];
  }

  finishTrip(now) {
    if (this.tripIdx + 1 < this.trips.length) {
      const nt = this.trips[this.tripIdx + 1];
      this.cars = nt.trip.n;
      this.length = this.cars * this.spec.carLength;
      this.startTrip(this.tripIdx + 1, now);
      return;
    }
    this.state = 'done';
  }

  /** Schedule deviation in seconds (+ late). */
  currentDelay(now) {
    if (this.state === 'dwell') {
      const [, dep] = this.times(this.stopIdx);
      return Math.max(0, now - dep);
    }
    return this.delay;
  }
}
