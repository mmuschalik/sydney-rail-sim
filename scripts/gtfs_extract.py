"""Extract rail-only GTFS subset into data/build/gtfs_rail.pkl."""
import csv, pickle, collections
G='data/raw/gtfs'
routes={x['route_id']:x for x in csv.DictReader(open(f'{G}/routes.txt',encoding='utf-8-sig'))
        if x['agency_id'] in ('x0001','SMNW','X0000','X000') and x['route_type'] in ('2','401')}
trips={t['trip_id']:t for t in csv.DictReader(open(f'{G}/trips.txt',encoding='utf-8-sig')) if t['route_id'] in routes}
st=collections.defaultdict(list)
with open(f'{G}/stop_times.txt',encoding='utf-8-sig') as f:
    r=csv.reader(f); h=next(r); ix={k:i for i,k in enumerate(h)}
    for row in r:
        tid=row[0]
        if tid in trips:
            st[tid].append((int(row[ix['stop_sequence']]),row[ix['arrival_time']],row[ix['departure_time']],row[ix['stop_id']],row[ix['pickup_type']],row[ix['drop_off_type']],row[ix['shape_dist_traveled']]))
for v in st.values(): v.sort()
used=set(s[3] for v in st.values() for s in v)
stops={s['stop_id']:s for s in csv.DictReader(open(f'{G}/stops.txt',encoding='utf-8-sig'))}
keep={}
for sid in used:
    s=stops[sid]; keep[sid]=s
    p=s.get('parent_station')
    if p and p in stops: keep[p]=stops[p]
cal={c['service_id']:c for c in csv.DictReader(open(f'{G}/calendar.txt',encoding='utf-8-sig'))}
svc=set(t['service_id'] for t in trips.values())
cal={k:v for k,v in cal.items() if k in svc}
cd=[c for c in csv.DictReader(open(f'{G}/calendar_dates.txt',encoding='utf-8-sig')) if c['service_id'] in svc]
pickle.dump(dict(routes=routes,trips=trips,stop_times=dict(st),stops=keep,calendar=cal,calendar_dates=cd),open('data/build/gtfs_rail.pkl','wb'))
print(len(trips),len(st),len(keep),len(cal),len(cd))
