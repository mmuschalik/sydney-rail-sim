"""Export the runtime track network: public/data/network.json"""
import json, pickle, os, collections, csv
import numpy as np
from netlib import project, cumlen

net = pickle.load(open('data/build/network.pkl', 'rb'))
g = pickle.load(open('data/build/gtfs_rail.pkl', 'rb'))
E = net['edges']
os.makedirs('public/data', exist_ok=True)

node_ids = {}
def nid(n):
    if n not in node_ids:
        node_ids[n] = len(node_ids)
    return node_ids[n]

SERVICE = {'': 0, 'crossover': 1, 'siding': 2, 'yard': 3, 'spur': 4}
edges = []
for e in E:
    pts = []
    for (x, z), y in zip(e['xz'], e['y']):
        pts += [round(float(x), 2), round(float(y), 2), round(float(z), 2)]
    flags = (1 if e['tunnel'] else 0) | (2 if e['bridge'] else 0) | (4 if e['metro'] else 0) \
        | (8 if e['electrified'] else 0) | (16 if e['oneway'] == 'yes' else 0) | (32 if e['freight'] else 0)
    edges.append(dict(a=nid(e['a']), b=nid(e['b']), p=pts, s=[round(v) for v in e['spd']],
                      f=flags, sv=SERVICE.get(e['service'], 3), r=e['tags'].get('ref', '') or e['tags'].get('name', ''),
                      l=e['layer']))

signals = [[s['e'], s['off'], s['dir'], s['type'], s['pos'], s['ref'], s['states'], s['speed']] for s in net['signals']]
features = [[f['e'], f['off'], f['type']] for f in net['features']]
platforms = []
for p in net['platforms']:
    platforms.append(dict(p=[round(float(v), 2) for xy in p['xz'] for v in xy], y=round(p['y'], 2),
                          c=1 if p['closed'] else 0, ref=p['ref'], n=p['name'], u=1 if p['underground'] else 0,
                          cv=p['covered']))

# stations & stops
stops = {}
stations = {}
for sid, s in g['stops'].items():
    x, z = project(float(s['stop_lat']), float(s['stop_lon']))
    if s.get('location_type') == '1' or not s.get('parent_station'):
        stations[sid] = dict(n=s['stop_name'].replace(' Station', ''), x=round(x, 1), z=round(z, 1))
for sid, s in g['stops'].items():
    if s.get('parent_station'):
        x, z = project(float(s['stop_lat']), float(s['stop_lon']))
        stops[sid] = dict(st=s['parent_station'], pc=s.get('platform_code', ''), x=round(x, 1), z=round(z, 1))

json.dump(dict(edges=edges, signals=signals, features=features, platforms=platforms, stations=stations, stops=stops),
          open('public/data/network.json', 'w'), separators=(',', ':'))
print('network.json', os.path.getsize('public/data/network.json') // 1024, 'KB', len(edges), 'edges')
