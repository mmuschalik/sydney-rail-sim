"""Build the track network graph from OSM.

Inputs : data/raw/osm/rail_ways.json, rail_nodes.json, platforms.json, data/raw/dem_z13.*
Outputs: data/build/network.pkl  (full graph for routing)
         public/data/network.json (compact runtime network)
"""
import json, math, pickle, os, collections
import numpy as np
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree
from netlib import project_arr, DEM, cumlen, parse_speed

RAW = 'data/raw/osm'
os.makedirs('data/build', exist_ok=True)
dem = DEM()

ways = json.load(open(f'{RAW}/rail_ways.json'))['elements']
ways = [w for w in ways if w['type'] == 'way' and w['tags'].get('railway') in ('rail', 'subway')
        and w['tags'].get('usage') != 'tourism' and 'geometry' in w]
print('ways', len(ways))

# ---------------------------------------------------------------- nodes
coord = {}
uses = collections.Counter()
ends = set()
for w in ways:
    for nid, g in zip(w['nodes'], w['geometry']):
        coord[nid] = (g['lat'], g['lon'])
        uses[nid] += 1
    ends.add(w['nodes'][0]); ends.add(w['nodes'][-1])
nids = list(coord)
lat = np.array([coord[n][0] for n in nids]); lon = np.array([coord[n][1] for n in nids])
X, Z = project_arr(lat, lon)
nxz = {n: (float(x), float(z)) for n, x, z in zip(nids, X, Z)}
split = {n for n in nids if n in ends or uses[n] > 1}


def is_metro(t):
    return (t.get('railway') == 'subway' or t.get('railway:cbtc') in ('yes', 'uto')
            or 'Metro' in (t.get('name', '') + t.get('ref', '')))


# ---------------------------------------------------------------- edges
edges = []  # dict per edge
node_edges = collections.defaultdict(list)
way_node_edge = {}  # (way id, node idx) -> (edge idx, point idx in edge)
for w in ways:
    t = w['tags']
    ns = w['nodes']
    start = 0
    for i in range(1, len(ns)):
        if ns[i] in split or i == len(ns) - 1:
            seg = ns[start:i + 1]
            if len(seg) >= 2 and not (len(seg) == 2 and seg[0] == seg[1]):
                e = len(edges)
                for k, n in enumerate(seg):
                    way_node_edge[(w['id'], start + k)] = (e, k)
                edges.append(dict(id=e, way=w['id'], a=seg[0], b=seg[-1], nodes=seg,
                                  xz=np.array([nxz[n] for n in seg]), tags=t))
                node_edges[seg[0]].append(e)
                node_edges[seg[-1]].append(e)
            start = i
print('edges', len(edges))

for e in edges:
    t = e['tags']
    e['len'] = float(cumlen(e['xz'])[-1])
    e['tunnel'] = t.get('tunnel') == 'yes' or t.get('location') == 'underground' or (
        t.get('layer', '0').lstrip('-').isdigit() and int(t.get('layer', '0')) <= -1 and t.get('tunnel') != 'no')
    e['bridge'] = t.get('bridge') not in (None, 'no')
    e['metro'] = is_metro(t)
    e['service'] = t.get('service', '')
    e['oneway'] = t.get('oneway')
    e['freight'] = t.get('railway:traffic_mode') == 'freight'
    e['electrified'] = t.get('electrified') == 'contact_line'
    try:
        e['layer'] = int(t.get('layer', '0').split(';')[0])
    except ValueError:
        e['layer'] = 0

# ---------------------------------------------------------------- speed limits (km/h)
def tagspeed(t, d):
    sfx = ':forward' if d > 0 else ':backward'
    cands = []
    for base in ('maxspeed', 'maxspeed:general', 'maxspeed:medium'):
        v = parse_speed(t.get(base + sfx)) or parse_speed(t.get(base))
        if v:
            cands.append(v)
    return max(cands) if cands else None


for e in edges:
    e['spd'] = [tagspeed(e['tags'], 1), tagspeed(e['tags'], -1)]


def tangent_at(e, at_node, inward=True, dist=15.0):
    """Unit direction of edge e pointing away from node at_node (into the edge)."""
    p = e['xz'] if e['a'] == at_node else e['xz'][::-1]
    acc = 0.0
    j = 1
    while j < len(p) - 1 and acc + math.dist(p[j - 1], p[j]) < dist:
        acc += math.dist(p[j - 1], p[j]); j += 1
    v = p[j] - p[0]
    n = math.hypot(*v) or 1
    return v / n


# fill missing speeds from straight-through neighbours
for it in range(80):
    changed = 0
    for e in edges:
        for di, d in enumerate((1, -1)):
            if e['spd'][di] is not None:
                continue
            best = None
            for node in (e['a'], e['b']):
                te = tangent_at(e, node)
                for f in node_edges[node]:
                    if f == e['id']:
                        continue
                    fe = edges[f]
                    tf = tangent_at(fe, node)
                    if float(np.dot(te, tf)) < -0.94:  # straight continuation
                        v = fe['spd'][0] if fe['spd'][0] is not None else fe['spd'][1]
                        if v is not None and fe['service'] == e['service']:
                            best = v if best is None else min(best, v)
            if best is not None:
                e['spd'][di] = best; changed += 1
    if not changed:
        break
DEFAULT = {'': 80, 'crossover': 40, 'siding': 25, 'yard': 25, 'spur': 25}
for e in edges:
    dflt = DEFAULT.get(e['service'], 25)
    if e['metro'] and not e['service']:
        dflt = 80
    for di in (0, 1):
        if e['spd'][di] is None:
            e['spd'][di] = dflt
    if e['service'] == 'crossover':
        e['spd'] = [min(s, 60) for s in e['spd']]

# ---------------------------------------------------------------- heights
TUNNEL_DEPTH = {-1: 12, -2: 20, -3: 28, -4: 36, -5: 45}
for e in edges:
    e['ground'] = dem.sample(e['xz'][:, 0], e['xz'][:, 1])

kind = {}  # node -> 'surface' | 'bridge' | 'tunnel'
for n in node_edges:
    ks = set()
    for f in node_edges[n]:
        fe = edges[f]
        ks.add('tunnel' if fe['tunnel'] else 'bridge' if fe['bridge'] else 'surface')
    kind[n] = 'surface' if 'surface' in ks else ('tunnel' if ks == {'tunnel'} else 'bridge' if ks == {'bridge'} else 'portal')

ground_n = {n: float(dem.sample(*nxz[n])) for n in node_edges}


def smooth_ground(n):
    # mean of DEM over 30 m radius to drop noise
    x, z = nxz[n]
    ang = np.linspace(0, 2 * np.pi, 9)[:-1]
    s = dem.sample(x + 30 * np.cos(ang), z + 30 * np.sin(ang))
    return 0.5 * ground_n[n] + 0.5 * float(np.mean(s))


h = {}
fixed = {}
target = {}
for n, k in kind.items():
    if k == 'surface' or k == 'portal':
        h[n] = smooth_ground(n); fixed[n] = True
    elif k == 'tunnel':
        lay = min([edges[f]['layer'] for f in node_edges[n]] + [-1])
        target[n] = ground_n[n] - TUNNEL_DEPTH.get(max(lay, -5), 12)
        h[n] = target[n]
    else:
        h[n] = ground_n[n] + 10
# relax free nodes: Laplacian smoothing with soft anchor for tunnel nodes
free = [n for n in kind if n not in fixed]
for it in range(400):
    for n in free:
        sw = 0.0; s = 0.0
        for f in node_edges[n]:
            fe = edges[f]
            m = fe['b'] if fe['a'] == n else fe['a']
            w = 1.0 / max(fe['len'], 5)
            s += w * h[m]; sw += w
        if n in target:
            lam = 0.3 / 200.0
            s += lam * target[n]; sw += lam
        if sw:
            h[n] = s / sw

for e in edges:
    c = cumlen(e['xz'])
    L = c[-1] or 1
    ha, hb = h[e['a']], h[e['b']]
    lin = ha + (hb - ha) * c / L
    if e['tunnel'] or e['bridge']:
        y = lin
        if e['tunnel']:
            # stay below ground in the middle of long tunnels
            y = np.minimum(y, e['ground'] - np.clip(np.minimum(c, L - c) * 0.04, 0, 8))
            y[0], y[-1] = ha, hb
    else:
        g = e['ground']
        if len(g) > 2:
            # moving average over ~80 m along the line
            win = 40.0
            sm = np.array([g[(c >= ci - win) & (c <= ci + win)].mean() for ci in c])
        else:
            sm = g.copy()
        # pin endpoints to node heights
        y = sm + (ha - sm[0]) + ((hb - sm[-1]) - (ha - sm[0])) * c / L
    e['y'] = y

# ---------------------------------------------------------------- signals
nodes_raw = json.load(open(f'{RAW}/rail_nodes.json'))['elements']
node_tags = {n['id']: n['tags'] for n in nodes_raw if n['type'] == 'node'}
node_pos_in_ways = collections.defaultdict(list)
for w in ways:
    for i, n in enumerate(w['nodes']):
        if n in node_tags:
            node_pos_in_ways[n].append((w['id'], i))

signals = []
for nid, t in node_tags.items():
    if t.get('railway') != 'signal' or nid not in node_pos_in_ways:
        continue
    wid, i = node_pos_in_ways[nid][0]
    if (wid, i) not in way_node_edge:
        continue
    e, k = way_node_edge[(wid, i)]
    E = edges[e]
    off = float(cumlen(E['xz'])[k])
    d = t.get('railway:signal:direction', 'forward')
    sdir = -1 if d == 'backward' else 1
    main = t.get('railway:signal:main', '')
    if main and 'points' not in main and 'LightRail' not in main:
        typ = 'main'
    elif t.get('railway:signal:distant') or t.get('railway:signal:main_repeated'):
        typ = 'distant'
    elif t.get('railway:signal:shunting'):
        typ = 'shunt'
    elif t.get('railway:signal:speed_limit') and 'LightRail' not in t.get('railway:signal:speed_limit', ''):
        typ = 'speed'
    elif t.get('railway:signal:stop') or t.get('railway:signal:minor'):
        typ = 'board'
    else:
        continue
    if E['metro'] and typ in ('main', 'distant'):
        typ = 'metro'
    pos = t.get('railway:signal:position', 'left')
    sig = dict(e=e, off=round(off, 1), dir=sdir, type=typ, pos=pos, ref=t.get('ref', ''),
               states=t.get('railway:signal:main:states', ''), osm=nid,
               distant=bool(t.get('railway:signal:distant')),
               speed=t.get('railway:signal:speed_limit:speed', ''))
    if d == 'both':
        signals.append(dict(sig)); sig['dir'] = -sig['dir']
    signals.append(sig)
print('signals', collections.Counter(s['type'] for s in signals))

# other trackside features
features = []
for nid, t in node_tags.items():
    r = t.get('railway')
    if r in ('switch', 'buffer_stop', 'level_crossing', 'crossing', 'derail') and nid in node_pos_in_ways:
        wid, i = node_pos_in_ways[nid][0]
        if (wid, i) not in way_node_edge:
            continue
        e, k = way_node_edge[(wid, i)]
        E = edges[e]
        features.append(dict(type=r, e=e, off=round(float(cumlen(E['xz'])[k]), 1),
                             sub=t.get('railway:switch', '')))
print('features', collections.Counter(f['type'] for f in features))

# ---------------------------------------------------------------- platforms
plats = []
tree_lines = [LineString(e['xz']) for e in edges]
tree = STRtree(tree_lines)


def track_height_near(x, z):
    i = tree.nearest(Point(x, z))
    e = edges[int(i)]
    ln = tree_lines[int(i)]
    d = ln.project(Point(x, z))
    c = cumlen(e['xz'])
    return float(np.interp(d, c, e['y'])), float(ln.distance(Point(x, z)))


for w in json.load(open(f'{RAW}/platforms.json'))['elements']:
    t = w.get('tags', {})
    if w['type'] != 'way' or 'geometry' not in w:
        continue
    if not (t.get('railway') == 'platform' or t.get('public_transport') == 'platform'):
        continue
    g = w['geometry']
    px, pz = project_arr([p['lat'] for p in g], [p['lon'] for p in g])
    cx, cz = float(np.mean(px)), float(np.mean(pz))
    y, dist = track_height_near(cx, cz)
    if dist > 40:
        continue
    plats.append(dict(osm=w['id'], ref=t.get('ref', ''), name=t.get('name', ''),
                      closed=w['nodes'][0] == w['nodes'][-1], covered=t.get('covered', ''),
                      xz=np.stack([px, pz], 1), y=y + 1.1,
                      underground=t.get('level', '0').startswith('-') or t.get('location') == 'underground'))
print('platforms', len(plats))

pickle.dump(dict(edges=edges, node_edges=dict(node_edges), nxz=nxz, h=h, signals=signals,
                 features=features, platforms=plats), open('data/build/network.pkl', 'wb'))
print('saved pickle')
