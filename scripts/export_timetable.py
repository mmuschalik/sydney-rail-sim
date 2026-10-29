"""Export patterns + per-date timetables for the runtime.

public/data/patterns.json : [{segs, len, stops:[[stop_id, platStart, platEnd, headStop]], revs:[s,...]}]
public/data/tt/YYYYMMDD.json : {date, dow, trips:[...]}  (trips running on that service date)
public/data/tt/index.json : available dates
"""
import pickle, json, os, datetime, collections

r = pickle.load(open('data/build/routed.pkl', 'rb'))
g = pickle.load(open('data/build/gtfs_rail.pkl', 'rb'))
pats = r['patterns']
trips = r['trips']

out_pats = []
for p in pats:
    revs = []
    acc = 0.0
    segs = p['segs']
    for i, s in enumerate(segs):
        L = abs(s[3] - s[2])
        acc += L
        if i + 1 < len(segs) and segs[i + 1][0] == s[0] and segs[i + 1][1] == -s[1]:
            revs.append(round(acc, 1))
    out_pats.append(dict(segs=segs, len=p['len'], stops=p['stops'], revs=revs))
os.makedirs('public/data/tt', exist_ok=True)
json.dump(out_pats, open('public/data/patterns.json', 'w'), separators=(',', ':'))
print('patterns', len(out_pats), os.path.getsize('public/data/patterns.json') // 1024, 'KB',
      'with reversals', sum(1 for p in out_pats if p['revs']))

cal = g['calendar']
exc = collections.defaultdict(dict)
for c in g['calendar_dates']:
    exc[c['service_id']][c['date']] = c['exception_type']
DOW = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


def active(svc, d):
    ds = d.strftime('%Y%m%d')
    e = exc.get(svc, {}).get(ds)
    if e == '1':
        return True
    if e == '2':
        return False
    c = cal.get(svc)
    if not c:
        return False
    return c['start_date'] <= ds <= c['end_date'] and c[DOW[d.weekday()]] == '1'


start = datetime.date(2026, 10, 29)
dates = []
for k in range(21):
    d = start + datetime.timedelta(days=k)
    ds = d.strftime('%Y%m%d')
    day = []
    for tid, t in trips.items():
        if active(t['svc'], d):
            flat = []
            for a, b, f in t['times']:
                flat += [a, b, f]
            day.append(dict(id=tid, run=t['run'], rt=t['route'], c=t['color'], h=t['head'], f=t['fleet'],
                            n=t['cars'], p=t['pat'], t=flat))
    day.sort(key=lambda x: x['t'][1])
    json.dump(dict(date=ds, dow=d.weekday(), trips=day), open(f'public/data/tt/{ds}.json', 'w'), separators=(',', ':'))
    dates.append(dict(date=ds, dow=d.weekday(), n=len(day)))
    print(ds, DOW[d.weekday()], len(day), 'trips', os.path.getsize(f'public/data/tt/{ds}.json') // 1024, 'KB')
json.dump(dates, open('public/data/tt/index.json', 'w'))
