"""Extract OSM buildings in the network bbox into 1 km binary chunks for streaming.

public/data/bld/{cx}_{cz}.bin   (cx, cz = floor(x/1000), floor(z/1000))
  uint32 count, then per building:
    uint16 nPts, uint16 heightDm, uint16 minHeightDm, int16 groundDm, uint8 kind, uint8 colourIdx
    nPts x (int16 xDm, int16 zDm) relative to chunk origin (outer ring, CCW in x/z, no repeat)
public/data/bld/index.json      list of chunk keys with counts
"""
import osmium, json, os, sys, math, struct, collections
import numpy as np
sys.path.insert(0, 'scripts')
from netlib import project, DEM

S, W, N, E = -34.24, 150.53, -33.48, 151.36
dem = DEM()
EXCLUDE = set()
try:
    EXCLUDE = set(json.load(open('data/build/landmark_exclude.json')))
except Exception:
    pass

KIND = {'house': 1, 'detached': 1, 'semidetached_house': 1, 'bungalow': 1, 'terrace': 2, 'residential': 3,
        'apartments': 4, 'commercial': 5, 'office': 5, 'retail': 6, 'industrial': 7, 'warehouse': 7,
        'garage': 8, 'garages': 8, 'shed': 8, 'carport': 8, 'roof': 9, 'school': 10, 'university': 10,
        'church': 11, 'cathedral': 11, 'hospital': 12, 'train_station': 13, 'transportation': 13,
        'hotel': 5, 'yes': 0}
DEFAULT_H = {0: 7, 1: 6, 2: 8, 3: 8, 4: 16, 5: 14, 6: 7, 7: 9, 8: 3, 9: 5, 10: 10, 11: 14, 12: 18, 13: 9}

COLOURS = {}  # building:colour -> idx (runtime palette appended)
colour_list = []


def colour_idx(c):
    if not c:
        return 0
    c = c.strip().lower()
    if c not in COLOURS:
        if len(colour_list) >= 250:
            return 0
        COLOURS[c] = len(colour_list) + 1
        colour_list.append(c)
    return COLOURS[c]


def num(v):
    if not v:
        return None
    try:
        v = v.replace('m', '').replace(',', '.').split(';')[0].strip()
        return float(v)
    except ValueError:
        return None


chunks = collections.defaultdict(list)
stats = collections.Counter()
parts_bbox = []


class H(osmium.SimpleHandler):
    def area(self, a):
        t = a.tags
        isb = 'building' in t
        isp = 'building:part' in t
        if not (isb or isp):
            return
        if t.get('building') in ('no', 'construction', 'demolished', 'proposed') and not isp:
            return
        oid = ('w%d' if a.from_way() else 'r%d') % a.orig_id()
        if oid in EXCLUDE:
            stats['excluded'] += 1
            return
        for outer in a.outer_rings():
            pts = [(n.lat, n.lon) for n in outer]
            if len(pts) < 4:
                continue
            la = [p[0] for p in pts]; lo = [p[1] for p in pts]
            if max(la) < S or min(la) > N or max(lo) < W or min(lo) > E:
                return
            xz = [project(p[0], p[1]) for p in pts[:-1]]
            kind_s = t.get('building:part') if isp and t.get('building:part') not in ('yes', None) else t.get('building', 'yes')
            kind = KIND.get(kind_s, 0)
            h = num(t.get('height'))
            lv = num(t.get('building:levels'))
            if h is None and lv is not None:
                h = lv * 3.1 + (1.5 if (num(t.get('roof:levels')) or 0) > 0 else 0.5)
            if h is None:
                h = DEFAULT_H.get(kind, 7)
            mh = num(t.get('min_height'))
            if mh is None:
                ml = num(t.get('building:min_level'))
                mh = ml * 3.1 if ml else 0.0
            if isp and mh == 0 and t.get('building:part') == 'roof':
                mh = max(0, h - 1)
            arr = np.array(xz)
            cx, cz = arr.mean(0)
            # signed area in x/z (x east, z south): make CCW when viewed from above (+y)
            area = 0.5 * np.sum(arr[:, 0] * np.roll(arr[:, 1], -1) - np.roll(arr[:, 0], -1) * arr[:, 1])
            if abs(area) < 4:
                continue
            if area > 0:
                arr = arr[::-1]
            ground = float(np.min(dem.sample(arr[:, 0], arr[:, 1])))
            key = (int(math.floor(cx / 1000)), int(math.floor(cz / 1000)))
            col = colour_idx(t.get('building:colour') or t.get('colour'))
            flags = (1 if isp else 0) | (2 if t.get('roof:shape') in ('gabled', 'hipped', 'pyramidal') else 0)
            chunks[key].append((arr, h, mh, ground, kind, col, flags, isb and not isp, abs(area), oid))
            stats['part' if isp else 'building'] += 1


h = H()
print('reading pbf ...', flush=True)
h.apply_file('data/raw/australia.osm.pbf', locations=True, idx='flex_mem')
print(dict(stats), len(chunks), 'chunks', flush=True)

# drop low buildings / roofs overlapping the rail corridor (they would bury tracks and platforms)
import pickle
from shapely.geometry import LineString
_net = pickle.load(open('data/build/network.pkl', 'rb'))
_tl = [LineString(e['xz']) for e in _net['edges'] if not e['tunnel']]
_tt = STRtree_ = None
from shapely.strtree import STRtree as _STR
_tt = _STR(_tl)
from shapely.geometry import Polygon as _P
removed = 0
for key, items in chunks.items():
    keep = []
    for it in items:
        arr, h, mh, ground, kind, col, flags, isb, area, oid = it
        try:
            poly = _P(arr)
            if not poly.is_valid: poly = poly.buffer(0)
            hit = any(_tl[int(i)].intersects(poly) for i in _tt.query(poly.buffer(1.5)))
        except Exception:
            hit = False
        if hit and mh < 7.5:
            removed += 1
            continue
        keep.append(it)
    chunks[key] = keep
print('removed buildings over tracks', removed)

# drop outline buildings whose footprint is mostly covered by building:parts (OSM 3D convention)
from shapely.geometry import Polygon
from shapely.strtree import STRtree
dropped = 0
for key, items in chunks.items():
    parts = [Polygon(it[0]) for it in items if it[6] & 1]
    if not parts:
        continue
    tree = STRtree(parts)
    keep = []
    for it in items:
        if it[7]:
            poly = Polygon(it[0])
            if not poly.is_valid:
                poly = poly.buffer(0)
            cov = 0.0
            for i in tree.query(poly):
                try:
                    cov += poly.intersection(parts[int(i)]).area
                except Exception:
                    pass
            if cov > 0.5 * poly.area:
                dropped += 1
                continue
        keep.append(it)
    chunks[key] = keep
print('dropped outlines with parts', dropped)

os.makedirs('public/data/bld', exist_ok=True)
index = []
total = 0
for (kx, kz), items in chunks.items():
    ox, oz = kx * 1000, kz * 1000
    buf = bytearray(struct.pack('<I', len(items)))
    for arr, h, mh, ground, kind, col, flags, isb, area, oid in items:
        rel = np.round((arr - [ox, oz]) * 10).astype(int)
        rel = np.clip(rel, -32000, 32000)
        n = len(rel)
        if n > 65535:
            continue
        buf += struct.pack('<HHHhBB', n, int(max(0, min(h * 10, 65000))), int(max(0, min(mh * 10, 65000))),
                           int(max(-3200, min(ground * 10, 32000))), kind | (flags << 5), col)
        buf += rel.astype('<i2').tobytes()
    with open(f'public/data/bld/{kx}_{kz}.bin', 'wb') as f:
        f.write(buf)
    index.append([kx, kz, len(items)])
    total += len(buf)
json.dump(dict(chunks=index, colours=colour_list), open('public/data/bld/index.json', 'w'))
print('wrote', len(index), 'chunks', total // 1024, 'KB')
