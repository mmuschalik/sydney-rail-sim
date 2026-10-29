"""Map every rail trip onto the OSM track graph and export runtime timetable data.

Uses GTFS shapes (which lie on OSM track centrelines) to choose the exact track,
platform and crossovers, then places stopping points at the far end of the
platform alongside the track.

Outputs:
  public/data/patterns.json         path + stop positions per unique stopping pattern
  public/data/tt/YYYYMMDD.json      trips running on that date
"""
import sys, os, json, math, pickle, heapq, collections, csv, datetime
import numpy as np
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree
import shapely
sys.path.insert(0, os.path.dirname(__file__))
from netlib import project_arr, cumlen

net = pickle.load(open('data/build/network.pkl', 'rb'))
g = pickle.load(open('data/build/gtfs_rail.pkl', 'rb'))
E = net['edges']
node_edges = net['node_edges']
lines = [LineString(e['xz']) for e in E]
tree = STRtree(lines)
cums = [cumlen(e['xz']) for e in E]

# ------------------------------------------------------------------ adjacency with turn limits
def tangent_at(e, node, dist=15.0):
    p = e['xz'] if e['a'] == node else e['xz'][::-1]
    acc = 0.0; j = 1
    while j < len(p) - 1 and acc + math.dist(p[j - 1], p[j]) < dist:
        acc += math.dist(p[j - 1], p[j]); j += 1
    v = p[j] - p[0]
    return v / (math.hypot(*v) or 1)


COS_LIMIT = -math.cos(math.radians(32))
adj = {}
for e in E:
    for d in (1, -1):
        node = e['b'] if d == 1 else e['a']
        tin = tangent_at(e, node)
        out = []
        for fid in node_edges[node]:
            f = E[fid]
            if fid == e['id'] and f['a'] != f['b']:
                continue
            for df, start in ((1, f['a']), (-1, f['b'])):
                if start != node:
                    continue
                tout = tangent_at(f, node) if f['a'] != f['b'] else (f['xz'][1] - f['xz'][0]) * df
                if float(np.dot(tin, tout)) < COS_LIMIT:
                    out.append((fid, df))
        adj[(e['id'], d)] = out

# ------------------------------------------------------------------ shapes
need_shapes = set(t['shape_id'] for t in g['trips'].values())
shape_pts = collections.defaultdict(list)
for row in csv.DictReader(open('data/raw/gtfs/rail_shapes.txt')):
    if row['shape_id'] in need_shapes:
        shape_pts[row['shape_id']].append((int(row['shape_pt_sequence']), float(row['shape_pt_lat']),
                                           float(row['shape_pt_lon']), float(row['shape_dist_traveled'] or 0)))
shapes = {}
for sid, pts in shape_pts.items():
    pts.sort()
    a = np.array(pts)
    x, z = project_arr(a[:, 1], a[:, 2])
    shapes[sid] = dict(xz=np.stack([x, z], 1), dist=a[:, 3])
print('shapes', len(shapes))

_edist = {}


def edge_dists(sid):
    """edge id -> mean distance (m) of the edge's points to the trip shape (edges within 20 m)."""
    if sid in _edist:
        return _edist[sid]
    ln = LineString(shapes[sid]['xz'])
    res = {}
    for i in tree.query(ln.buffer(20.0)):
        p = E[i]['xz']
        allp = np.vstack([p, (p[1:] + p[:-1]) / 2])
        d = shapely.distance(ln, shapely.points(allp))
        res[int(i)] = float(np.mean(d))
    _edist[sid] = res
    return res


def shape_point(sid, dist):
    s = shapes[sid]
    d = s['dist']
    i = int(np.searchsorted(d, dist))
    i = min(max(i, 1), len(d) - 1)
    t = 0 if d[i] == d[i - 1] else (dist - d[i - 1]) / (d[i] - d[i - 1])
    t = min(max(t, 0), 1)
    p = s['xz'][i - 1] + (s['xz'][i] - s['xz'][i - 1]) * t
    j0 = max(int(np.searchsorted(d, dist - 20)) - 1, 0)
    j1 = min(int(np.searchsorted(d, dist + 20)), len(d) - 1)
    v = s['xz'][j1] - s['xz'][j0]
    return p, v / (math.hypot(*v) or 1)


_cand = {}


def candidates(sid, dist, tol=15.0, k=6):
    """Shape distance -> up to k candidate positions [(lateral_dist, e, dir, off)]."""
    key = (sid, round(dist, 1), tol)
    if key in _cand:
        return _cand[key]
    p, tv = shape_point(sid, dist)
    pt = Point(p)
    out = []
    for i in tree.query(pt.buffer(tol + 1)):
        i = int(i)
        dd = lines[i].distance(pt)
        if dd > tol:
            continue
        off = lines[i].project(pt)
        c = cums[i]
        kk = min(max(int(np.searchsorted(c, off)), 1), len(c) - 1)
        ev = E[i]['xz'][kk] - E[i]['xz'][kk - 1]
        ev = ev / (math.hypot(*ev) or 1)
        dot = float(np.dot(ev, tv))
        if abs(dot) < 0.7:
            continue  # crossing track, not parallel
        out.append((dd, i, 1 if dot >= 0 else -1, off))
    out.sort()
    out = out[:k]
    _cand[key] = out
    return out


def edge_cost(eid, d, ed):
    e = E[eid]
    dd = ed.get(eid)
    m = 25.0 if dd is None else (1.0 if dd <= 2.0 else min(25.0, 1.0 + (dd - 2.0) * 0.6))
    if e['oneway'] == 'yes' and d == -1:
        m *= 3.0
    return m


BOUNCE = 185.0     # overrun distance before reversing (clears an 8-car train past the points)
REV_COST = 4000.0  # discourages reversals unless the shape needs one


def route_multi(src, targets, ed, max_cost):
    """Dijkstra from src=(e,d,off) to several targets [(e,d,off)].
    Returns list (per target) of (cost, segs) or None."""
    e0, d0, o0 = src
    res = [None] * len(targets)
    by_state = collections.defaultdict(list)
    for j, (e1, d1, o1) in enumerate(targets):
        if e1 == e0 and d1 == d0 and (o1 - o0) * d0 >= 0:
            res[j] = (abs(o1 - o0) * edge_cost(e0, d0, ed), [[e0, d0, o0, o1]])
        else:
            by_state[(e1, d1)].append(j)
    if not by_state:
        return res
    L0 = E[e0]['len']
    first = (L0 - o0) if d0 == 1 else o0
    dist = {(e0, d0): first * edge_cost(e0, d0, ed)}
    prev = {}
    pq = [(dist[(e0, d0)], 0, (e0, d0))]
    cnt = 1
    remaining = sum(len(v) for v in by_state.values())
    while pq and remaining:
        c, _, st = heapq.heappop(pq)
        if c > max_cost:
            break
        if st[0] == 'T':
            j = st[1]
            if res[j] is None:
                # reconstruct
                chain = []
                s2 = prev[st]
                while s2 != (e0, d0):
                    chain.append(s2); s2 = prev[s2]
                chain.reverse()
                segs = [[e0, d0, o0, L0 if d0 == 1 else 0.0]]
                for item in chain:
                    if item[0] == 'B':
                        _, fid, df = item
                        L = E[fid]['len']
                        st0 = 0.0 if df == 1 else L
                        mid = st0 + df * BOUNCE
                        segs.append([fid, df, st0, mid]); segs.append([fid, -df, mid, st0])
                        continue
                    fid, df = item
                    L = E[fid]['len']
                    segs.append([fid, df, 0.0 if df == 1 else L, L if df == 1 else 0.0])
                e1, d1, o1 = targets[j]
                segs.append([e1, d1, 0.0 if d1 == 1 else E[e1]['len'], o1])
                res[j] = (c, segs)
                remaining -= 1
            continue
        if c > dist.get(st, 1e18):
            continue
        if st[0] == 'B':
            nbrs = adj[(st[1], -st[2])]
        else:
            nbrs = adj[st]
            # reversal: run onto a following edge by BOUNCE metres, stop, change ends
            for (fid, df) in nbrs:
                if E[fid]['len'] >= BOUNCE + 5:
                    key = ('B', fid, df)
                    bc = c + 2 * BOUNCE * edge_cost(fid, df, ed) + REV_COST
                    if bc < dist.get(key, 1e18):
                        dist[key] = bc; prev[key] = st
                        heapq.heappush(pq, (bc, cnt, key)); cnt += 1
        for nxt in nbrs:
            fid, df = nxt
            if nxt in by_state:
                L = E[fid]['len']
                for j in by_state[nxt]:
                    o1 = targets[j][2]
                    part = o1 if df == 1 else L - o1
                    tc = c + part * edge_cost(fid, df, ed)
                    key = ('T', j)
                    if tc < dist.get(key, 1e18):
                        dist[key] = tc; prev[key] = st
                        heapq.heappush(pq, (tc, cnt, key)); cnt += 1
            nc = c + E[fid]['len'] * edge_cost(fid, df, ed) + 1.0
            if nc < dist.get(nxt, 1e18):
                dist[nxt] = nc; prev[nxt] = st
                heapq.heappush(pq, (nc, cnt, nxt)); cnt += 1
    return res


def seglen(segs):
    return sum(abs(s[3] - s[2]) for s in segs)


# ------------------------------------------------------------------ platforms for stop placement
plats = net['platforms']
plat_geoms = []
for p in plats:
    xz = p['xz']
    if p['closed'] and len(xz) >= 4:
        from shapely.geometry import Polygon
        try:
            geom = Polygon(xz).exterior
        except Exception:
            geom = LineString(xz)
    else:
        geom = LineString(xz)
    plat_geoms.append(geom)
plat_tree = STRtree(plat_geoms)


def path_point(segs, s):
    """Point at distance s along a seg list."""
    acc = 0.0
    for e, d, a, b in segs:
        L = abs(b - a)
        if s <= acc + L or (e, d, a, b) == tuple(segs[-1]):
            off = a + d * (s - acc)
            off = min(max(off, 0), E[e]['len'])
            c = cums[e]
            k = min(max(int(np.searchsorted(c, off)), 1), len(c) - 1)
            t = (off - c[k - 1]) / ((c[k] - c[k - 1]) or 1)
            return E[e]['xz'][k - 1] + (E[e]['xz'][k] - E[e]['xz'][k - 1]) * t
        acc += L
    return None


def platform_extent(segs_before, segs_after, s_stop):
    """Given path segments around a stop (combined list and stop position s_stop),
    find the contiguous platform-adjacent range containing/near s_stop."""
    pass


def plat_adjacent(pt):
    q = Point(pt)
    for i in plat_tree.query(q.buffer(4.2)):
        if plat_geoms[int(i)].distance(q) <= 4.2:
            return True
    return False


# ------------------------------------------------------------------ trips
stops = g['stops']
st_all = g['stop_times']


def secs(t):
    h, m, s = t.split(':')
    return int(h) * 3600 + int(m) * 60 + int(s)


def run_of(tid):
    return tid.split('.')[0]


def fleet_of(t):
    p = t['trip_id'].split('.')
    r = t['route_id']
    if r.startswith('3-M1'):
        return 'MET', 6
    if r.startswith('76-'):
        cars = 2
        try:
            cars = int(p[4]) if p[3] in ('N', 'J') else 2
        except Exception:
            pass
        return 'N', max(cars, 2)
    try:
        return p[4], int(p[5])
    except Exception:
        return 'A', 8


legcache = {}
patterns = {}       # key -> pattern id
pattern_list = []
trip_out = {}
fail = collections.Counter()
ROUTE_SHORT = {rid: r['route_short_name'] for rid, r in g['routes'].items()}
ROUTE_COLOR = {rid: r['route_color'] for rid, r in g['routes'].items()}

trips = g['trips']
order = sorted(trips)
ONLY = os.environ.get('ONLY')
if ONLY:
    import random
    random.seed(1)
    order = [t for t in order if trips[t]['route_id'].startswith(ONLY)]
    order = random.sample(order, min(len(order), int(os.environ.get('N', '300'))))
examples = collections.defaultdict(list)
print('trips', len(order))
for n_t, tid in enumerate(order):
    t = trips[tid]
    sid = t['shape_id']
    if sid not in shapes:
        fail['noshape'] += 1; continue
    sts = st_all[tid]
    ed = edge_dists(sid)
    cands = [candidates(sid, float(st[6] or 0)) for st in sts]
    inside = [i for i, c in enumerate(cands) if c]
    if len(inside) < 2:
        fail['outside'] += 1; continue
    i0, i1 = inside[0], inside[-1]
    if any(not cands[i] for i in range(i0, i1 + 1)):
        fail['gap'] += 1
        examples['gap'].append((tid, [(stops[sts[i][3]]['stop_name'], sts[i][6]) for i in range(i0, i1 + 1) if not cands[i]]))
        continue
    pts = []
    for i in range(i0, i1 + 1):
        seq, arr, dep, stop_id, pu, do, sd = sts[i]
        pts.append(dict(kind='stop', stop=stop_id, arr=secs(arr), dep=secs(dep), sd=float(sd or 0),
                        cands=cands[i], pu=pu, do=do))

    def boundary(i_out, i_in, entering):
        # walk the shape from the inside stop toward the outside stop; last on-network point
        d_in = float(sts[i_in][6] or 0); d_out = float(sts[i_out][6] or 0)
        step = 25.0 if d_out > d_in else -25.0
        d = d_in; last = None
        while (d - d_out) * (1 if step > 0 else -1) < 0:
            c = candidates(sid, d, tol=6.0, k=1)
            if not c:
                break
            last = (d, c); d += step
        if last is None or abs(last[0] - d_in) < 200:
            return None
        dist = last[0]
        tin = secs(sts[i_in][2] if entering else sts[i_in][1])
        tout = secs(sts[i_out][2] if entering else sts[i_out][1])
        f = (dist - d_out) / ((d_in - d_out) or 1)
        tt = tout + (tin - tout) * f
        return dict(kind='edge', stop=None, arr=int(tt), dep=int(tt), sd=dist, cands=last[1], pu='1', do='1')

    if i0 > 0:
        bnd = boundary(i0 - 1, i0, True)
        if bnd: pts.insert(0, bnd)
    if i1 < len(sts) - 1:
        bnd = boundary(i1 + 1, i1, False)
        if bnd: pts.append(bnd)

    # Viterbi over candidate tracks at each stop
    PEN = 15.0  # cost per metre of lateral offset between shape and candidate track
    best = [[(c[0] * PEN, None, None) for c in pts[0]['cands']]]
    ok = True
    for k in range(1, len(pts)):
        a, b = pts[k - 1], pts[k]
        key = (sid, round(a['sd'], 1), round(b['sd'], 1))
        if key not in legcache:
            shp = abs(b['sd'] - a['sd'])
            tg = [(c[1], c[2], c[3]) for c in b['cands']]
            legcache[key] = [route_multi((c[1], c[2], c[3]), tg, ed, 9000 + 8 * shp) for c in a['cands']]
        mat = legcache[key]
        row = []
        for j, cb in enumerate(b['cands']):
            bestj = (1e18, None, None)
            for i, ca in enumerate(a['cands']):
                if best[-1][i][0] >= 1e17 or mat[i][j] is None:
                    continue
                v = best[-1][i][0] + mat[i][j][0] + cb[0] * PEN
                if v < bestj[0]:
                    bestj = (v, i, mat[i][j][1])
            row.append(bestj)
        best.append(row)
        if all(r[0] >= 1e17 for r in row):
            examples['noroute'].append((tid, stops[a['stop']]['stop_name'] if a['stop'] else 'edge',
                                        stops[b['stop']]['stop_name'] if b['stop'] else 'edge', a['cands'], b['cands']))
            ok = False; break
    if not ok:
        fail['noroute'] += 1; continue
    # backtrack
    j = min(range(len(best[-1])), key=lambda j: best[-1][j][0])
    legs = []
    for k in range(len(pts) - 1, 0, -1):
        v, i, segs = best[k][j]
        legs.append(segs); j = i
    legs.reverse()
    segs_all = []
    stop_s = [0.0]
    acc = 0.0
    for k, segs in enumerate(legs):
        L = seglen(segs)
        a, b = pts[k], pts[k + 1]
        if abs(L - abs(b['sd'] - a['sd'])) > max(150, 0.15 * abs(b['sd'] - a['sd'])):
            fail['lenmismatch'] += 1
            examples['len'].append((tid, stops[a['stop']]['stop_name'] if a['stop'] else 'edge',
                                    stops[b['stop']]['stop_name'] if b['stop'] else 'edge', round(L), round(abs(b['sd'] - a['sd']))))
        segs_all.extend(segs)
        acc += L
        stop_s.append(acc)
    # merge consecutive segs on same edge/dir
    merged = []
    for s in segs_all:
        if abs(s[3] - s[2]) < 1e-6:
            continue
        if merged and merged[-1][0] == s[0] and merged[-1][1] == s[1] and abs(merged[-1][3] - s[2]) < 1e-3:
            merged[-1][3] = s[3]
        else:
            merged.append(list(s))
    pkey = (sid, tuple(round(p['sd']) for p in pts))
    if pkey not in patterns:
        total = acc
        # stopping position: far end of the platform alongside the track (head of train)
        stop_info = []
        for k, p in enumerate(pts):
            s0 = stop_s[k]
            if p['kind'] != 'stop':
                stop_info.append([round(s0, 1), round(s0, 1), round(s0, 1)])
                continue
            # scan +-260 m for platform adjacency
            samples = np.arange(max(0, s0 - 260), min(total, s0 + 260) + 0.1, 4.0)
            adjm = [plat_adjacent(path_point(merged, s)) for s in samples]
            # contiguous run nearest to s0
            runs = []
            cur = None
            for s, a in zip(samples, adjm):
                if a:
                    if cur is None: cur = [s, s]
                    else: cur[1] = s
                elif cur is not None:
                    runs.append(cur); cur = None
            if cur: runs.append(cur)
            runs = [r for r in runs if r[1] - r[0] >= 30]
            if runs:
                r = min(runs, key=lambda r: 0 if r[0] <= s0 <= r[1] else min(abs(r[0] - s0), abs(r[1] - s0)))
                if min(abs(r[0] - s0), abs(r[1] - s0)) < 200 or r[0] <= s0 <= r[1]:
                    stop_info.append([round(r[0], 1), round(r[1], 1), round(min(r[1] - 6, total), 1)])
                    continue
            stop_info.append([round(s0 - 80, 1), round(s0 + 80, 1), round(min(s0 + 75, total), 1)])
        patterns[pkey] = len(pattern_list)
        pattern_list.append(dict(
            segs=[[s[0], s[1], round(s[2], 2), round(s[3], 2)] for s in merged],
            len=round(acc, 1),
            stops=[[p['stop'] or '', si[0], si[1], si[2]] for p, si in zip(pts, stop_info)],
        ))
    pid = patterns[pkey]
    fleet, cars = fleet_of(t)
    trip_out[tid] = dict(
        id=tid, run=run_of(tid), route=ROUTE_SHORT[t['route_id']], color=ROUTE_COLOR[t['route_id']],
        rid=t['route_id'], head=t['trip_headsign'], dir=t['route_direction'], fleet=fleet, cars=cars,
        svc=t['service_id'], pat=pid,
        times=[[p['arr'], p['dep'], 1 if p['kind'] == 'stop' and not (p['pu'] == '1' and p['do'] == '1') else 0] for p in pts],
    )
    if n_t % 5000 == 0:
        print(n_t, len(pattern_list), len(legcache), dict(fail), flush=True)

print('routed', len(trip_out), 'patterns', len(pattern_list), dict(fail))
for k, v in examples.items():
    print(k, len(v))
    for x in v[:12]:
        print('   ', x)
if not ONLY:
    pickle.dump(dict(trips=trip_out, patterns=pattern_list), open('data/build/routed.pkl', 'wb'))
