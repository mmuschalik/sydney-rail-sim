// Track network model: edges (polylines with heights), speed limits, signals,
// and Path objects that trains move along.

export const FLAG = { TUNNEL: 1, BRIDGE: 2, METRO: 4, ELECTRIFIED: 8, ONEWAY: 16, FREIGHT: 32 };

export class Network {
  constructor(json) {
    this.edges = json.edges.map((e, id) => {
      const p = new Float32Array(e.p);
      const n = p.length / 3;
      const cum = new Float32Array(n);
      for (let i = 1; i < n; i++) {
        const dx = p[i * 3] - p[i * 3 - 3], dz = p[i * 3 + 2] - p[i * 3 - 1];
        cum[i] = cum[i - 1] + Math.hypot(dx, dz);
      }
      return {
        id, a: e.a, b: e.b, p, cum, len: cum[n - 1], speed: e.s, flags: e.f, service: e.sv, ref: e.r, layer: e.l,
      };
    });
    this.stations = json.stations;
    this.stops = json.stops;
    this.platforms = json.platforms;
    this.features = json.features;
    this.crossings = json.features.filter((f) => f[2] === 'level_crossing').map(([e, off], i) => ({ id: i, e, off, active: false, t: 0 }));
    this.crossingsByEdge = new Map();
    for (const c of this.crossings) {
      if (!this.crossingsByEdge.has(c.e)) this.crossingsByEdge.set(c.e, []);
      this.crossingsByEdge.get(c.e).push(c);
    }
    this.signals = json.signals.map(([e, off, dir, type, pos, ref, states, speed], i) => ({
      id: i, e, off, dir, type, pos, ref, states, speed, aspect: 3, held: 0,
    }));
    this._synthesizeSignals();
    this.signalsByEdge = new Map();
    for (const s of this.signals) {
      if (!this.signalsByEdge.has(s.e)) this.signalsByEdge.set(s.e, []);
      this.signalsByEdge.get(s.e).push(s);
    }
    this.nodeEdges = new Map();
    for (const e of this.edges) {
      for (const n of [e.a, e.b]) {
        if (!this.nodeEdges.has(n)) this.nodeEdges.set(n, []);
        this.nodeEdges.get(n).push(e.id);
      }
    }
    this.pathCache = new Map();
  }

  /**
   * OSM maps many but not all automatic signals. Fill long unsignalled main-line
   * stretches with automatic block signals (~0.8 km spacing, typical Sydney suburban),
   * and give Metro track short invisible blocks approximating CBTC moving block.
   */
  _synthesizeSignals() {
    const real = new Map();
    for (const s of this.signals) {
      if (s.type !== 'main' && s.type !== 'metro') continue;
      const k = s.e * 2 + (s.dir > 0 ? 0 : 1);
      if (!real.has(k)) real.set(k, []);
      real.get(k).push(s.off);
    }
    let id = this.signals.length;
    for (const e of this.edges) {
      if (e.service !== 0) continue;
      const metro = (e.flags & FLAG.METRO) !== 0;
      const SP = metro ? 300 : 800, CLEAR = metro ? 150 : 400;
      const dirs = e.flags & FLAG.ONEWAY ? [1] : [1, -1];
      for (const d of dirs) {
        const offs = real.get(e.id * 2 + (d > 0 ? 0 : 1)) || [];
        for (let x = SP / 2; x < e.len - 150; x += SP) {
          const off = d > 0 ? x : e.len - x;
          if (offs.some((o) => Math.abs(o - off) < CLEAR)) continue;
          this.signals.push({ id: id++, e: e.id, off, dir: d, type: metro ? 'metro' : 'main', pos: 'left', ref: 'A' + id,
            states: 'GYR', speed: '', aspect: 3, held: 0, synthetic: true, hidden: metro });
        }
      }
    }
  }

  /** point on edge at offset: writes [x,y,z] into out */
  edgePoint(e, off, out) {
    const { p, cum } = e;
    const n = cum.length;
    if (off <= 0) { out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return out; }
    if (off >= e.len) { out[0] = p[n * 3 - 3]; out[1] = p[n * 3 - 2]; out[2] = p[n * 3 - 1]; return out; }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= off) lo = m; else hi = m; }
    const t = (off - cum[lo]) / (cum[hi] - cum[lo] || 1);
    out[0] = p[lo * 3] + (p[hi * 3] - p[lo * 3]) * t;
    out[1] = p[lo * 3 + 1] + (p[hi * 3 + 1] - p[lo * 3 + 1]) * t;
    out[2] = p[lo * 3 + 2] + (p[hi * 3 + 2] - p[lo * 3 + 2]) * t;
    return out;
  }

  /** unit tangent of edge e leaving node (pointing into the edge), over ~15 m */
  tangentFrom(e, node) {
    const p = e.p, n = e.cum.length;
    const fwd = e.a === node;
    const i0 = fwd ? 0 : n - 1;
    let j = fwd ? 1 : n - 2;
    const target = 15;
    while (fwd ? j < n - 1 : j > 0) {
      const d = fwd ? e.cum[j] : e.len - e.cum[j];
      if (d >= target) break;
      j += fwd ? 1 : -1;
    }
    const dx = p[j * 3] - p[i0 * 3], dz = p[j * 3 + 2] - p[i0 * 3 + 2];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }

  /** Straight-through continuation from the end of (edge, dir). Returns [edgeId, dir] or null. */
  continuation(eid, dir) {
    const e = this.edges[eid];
    const node = dir > 0 ? e.b : e.a;
    const tin = this.tangentFrom(e, node);
    let best = null, bestDot = -0.85;
    for (const fid of this.nodeEdges.get(node) || []) {
      if (fid === eid) continue;
      const f = this.edges[fid];
      const tout = this.tangentFrom(f, node);
      const dot = tin[0] * tout[0] + tin[1] * tout[1];
      if (dot < bestDot) { bestDot = dot; best = [fid, f.a === node ? 1 : -1]; }
    }
    return best;
  }

  /** Build (or fetch) a Path for a pattern's segment list. */
  getPath(key, segs) {
    let p = this.pathCache.get(key);
    if (!p) { p = new Path(this, segs); this.pathCache.set(key, p); }
    return p;
  }
}

const PRE = 320; // metres of track added behind the path start (room for the train body)
const POST = 60;

export class Path {
  constructor(net, segs) {
    this.net = net;
    // extend backwards from the first seg and forwards from the last along straight continuations
    const pre = [];
    {
      let [e, d, a] = segs[0];
      let need = PRE;
      // the part of edge e behind 'a' in travel direction
      const E0 = net.edges[e];
      const avail = d > 0 ? a : E0.len - a;
      if (avail > 0) { const take = Math.min(avail, need); pre.unshift([e, d, a - d * take, a]); need -= take; }
      let cur = [e, -d];
      while (need > 0) {
        const c = net.continuation(cur[0], cur[1]);
        if (!c) break;
        const f = net.edges[c[0]];
        const take = Math.min(f.len, need);
        // traversed backwards: we walk c in direction c[1]; train travels in -c[1]
        const start = c[1] > 0 ? 0 : f.len;
        const end = start + c[1] * take;
        pre.unshift([c[0], -c[1], end, start]);
        need -= take; cur = c;
      }
    }
    const post = [];
    {
      const [e, d, , b] = segs[segs.length - 1];
      let need = POST;
      const El = net.edges[e];
      const avail = d > 0 ? El.len - b : b;
      if (avail > 0) { const take = Math.min(avail, need); post.push([e, d, b, b + d * take]); need -= take; }
      let cur = [e, d];
      while (need > 0) {
        const c = net.continuation(cur[0], cur[1]);
        if (!c) break;
        const f = net.edges[c[0]];
        const take = Math.min(f.len, need);
        const start = c[1] > 0 ? 0 : f.len;
        post.push([c[0], c[1], start, start + c[1] * take]);
        need -= take; cur = c;
      }
    }
    const preLen = pre.reduce((s, x) => s + Math.abs(x[3] - x[2]), 0);
    this.offset = preLen; // path s=0 (first stop location) sits at this distance into the polyline
    const all = [...pre, ...segs, ...post];
    this.segs = all;
    // polyline
    const pts = [];
    const cum = [];
    const segStart = [];
    const tmp = [0, 0, 0];
    let acc = 0;
    let last = null;
    for (const [eid, d, a, b] of all) {
      const e = net.edges[eid];
      segStart.push(acc);
      // gather interior vertices between a and b in direction d
      const offs = [a];
      const c = e.cum;
      if (d > 0) { for (let i = 0; i < c.length; i++) if (c[i] > a + 0.01 && c[i] < b - 0.01) offs.push(c[i]); }
      else { for (let i = c.length - 1; i >= 0; i--) if (c[i] < a - 0.01 && c[i] > b + 0.01) offs.push(c[i]); }
      offs.push(b);
      for (const o of offs) {
        net.edgePoint(e, o, tmp);
        if (last) {
          const dl = Math.hypot(tmp[0] - last[0], tmp[2] - last[2]);
          if (dl < 0.05) continue;
          acc += dl;
        }
        pts.push(tmp[0], tmp[1], tmp[2]);
        cum.push(acc);
        last = [tmp[0], tmp[1], tmp[2]];
      }
    }
    this.pts = new Float32Array(pts);
    this.cum = new Float64Array(cum);
    this.length = acc - preLen; // usable length from s=0
    this.total = acc;
    this.segStart = segStart;
    this._buildSpeed();
    this._buildSignals();
    this._buildCrossings();
    this._smoothHeights();
  }

  _smoothHeights() {
    // gentle vertical smoothing (vertical curves) over ~60 m so trains don't jitter
    const n = this.cum.length;
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = this.pts[i * 3 + 1];
    const out = new Float32Array(n);
    let lo = 0, hi = 0, sum = 0;
    for (let i = 0; i < n; i++) {
      while (hi < n && this.cum[hi] <= this.cum[i] + 30) { sum += y[hi]; hi++; }
      while (this.cum[lo] < this.cum[i] - 30) { sum -= y[lo]; lo++; }
      out[i] = sum / (hi - lo);
    }
    for (let i = 0; i < n; i++) this.pts[i * 3 + 1] = out[i];
  }

  _buildSpeed() {
    // speed limit (m/s) sampled every 10 m of polyline distance
    const STEP = 10;
    const n = Math.ceil(this.total / STEP) + 1;
    const v = new Float32Array(n);
    let si = 0;
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      while (si < this.segs.length - 1 && this.segStart[si + 1] <= s) si++;
      const [eid, d] = this.segs[si];
      const e = this.net.edges[eid];
      v[i] = (d > 0 ? e.speed[0] : e.speed[1]) / 3.6;
    }
    this.speedStep = STEP;
    this.speed = v;
  }

  _buildSignals() {
    // signals along the path facing the direction of travel, sorted by path position (s from origin of polyline)
    const list = [];
    this.segs.forEach(([eid, d, a, b], i) => {
      const sigs = this.net.signalsByEdge.get(eid);
      if (!sigs) return;
      for (const s of sigs) {
        if (s.dir !== d) continue;
        const inRange = d > 0 ? s.off >= a && s.off <= b : s.off <= a && s.off >= b;
        if (!inRange) continue;
        const ps = this.segStart[i] + Math.abs(s.off - a) - this.offset;
        list.push({ s: ps, sig: s });
      }
    });
    list.sort((p, q) => p.s - q.s);
    this.signalList = list;
    this.mainSignals = list.filter((x) => x.sig.type === 'main' || x.sig.type === 'metro');
  }

  _buildCrossings() {
    const list = [];
    this.segs.forEach(([eid, d, a, b], i) => {
      const cs = this.net.crossingsByEdge.get(eid);
      if (!cs) return;
      for (const c of cs) {
        const inRange = d > 0 ? c.off >= a && c.off <= b : c.off <= a && c.off >= b;
        if (inRange) list.push({ s: this.segStart[i] + Math.abs(c.off - a) - this.offset, c });
      }
    });
    list.sort((p, q) => p.s - q.s);
    this.crossingList = list;
  }

  /** speed limit (m/s) at path position s (s relative to first stop) */
  limitAt(s) {
    const i = Math.max(0, Math.min(this.speed.length - 1, Math.floor((s + this.offset) / this.speedStep)));
    return this.speed[i];
  }

  /** world point at path position s (relative); writes into out (Vector3-like with x,y,z) */
  pointAt(s, out) {
    const t = s + this.offset;
    const cum = this.cum, p = this.pts, n = cum.length;
    if (t <= 0) {
      // extrapolate behind start
      const dx = p[3] - p[0], dy = p[4] - p[1], dz = p[5] - p[2];
      const l = cum[1] || 1;
      out.x = p[0] + (dx / l) * t; out.y = p[1] + (dy / l) * t; out.z = p[2] + (dz / l) * t;
      return out;
    }
    if (t >= cum[n - 1]) {
      const i = n - 1;
      const dx = p[i * 3] - p[i * 3 - 3], dy = p[i * 3 + 1] - p[i * 3 - 2], dz = p[i * 3 + 2] - p[i * 3 - 1];
      const l = (cum[i] - cum[i - 1]) || 1;
      const k = (t - cum[i]) / l;
      out.x = p[i * 3] + dx * k; out.y = p[i * 3 + 1] + dy * k; out.z = p[i * 3 + 2] + dz * k;
      return out;
    }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= t) lo = m; else hi = m; }
    const k = (t - cum[lo]) / (cum[hi] - cum[lo] || 1);
    out.x = p[lo * 3] + (p[hi * 3] - p[lo * 3]) * k;
    out.y = p[lo * 3 + 1] + (p[hi * 3 + 1] - p[lo * 3 + 1]) * k;
    out.z = p[lo * 3 + 2] + (p[hi * 3 + 2] - p[lo * 3 + 2]) * k;
    return out;
  }

  /** edge flags at path position s */
  flagsAt(s) {
    const t = s + this.offset;
    let lo = 0, hi = this.segStart.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.segStart[m] <= t) lo = m; else hi = m - 1; }
    return this.net.edges[this.segs[lo][0]].flags;
  }
}
