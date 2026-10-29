# Sydney Rail Network — live timetable simulation (Three.js)

A 3D simulation of the whole Sydney rail network: every timetabled Sydney Trains (T1–T9),
Sydney Metro (M1) and NSW TrainLink intercity service inside the Sydney basin, running on the
real track layout over satellite imagery, with speed limits, block signalling, level crossings,
platforms, overhead wiring, 400k OSM buildings and modelled landmarks.

```
npm install
npm run dev          # http://localhost:5173
```

Opens at the current Sydney time with every train that is in service right now.

## What you see

- **Whole network** view: tracks coloured by the line that runs them; every train as a dot in its
  line colour. Underground sections (City Circle, ESR, Airport line, Epping–Chatswood, Metro
  harbour crossing) are traced in orange/teal.
- **Click any train** to follow it. The panel shows route, run, fleet (Waratah, Tangara,
  Millennium, OSCAR, Mariyung, Metropolis, Endeavour…), car count, speed vs line speed, next
  stop and scheduled time, punctuality, the aspect of the signal ahead and the stopping pattern.
  *Driver's view* rides in the cab.
- Following a train underground switches to an x-ray view (or use **Show tunnels**).
- Time controls: pause, 1×, 5×, 30×, 2 min/s, 10 min/s, **Now**. The sun, sky, shadows and
  night lighting (windows, platform lamps, head/tail lights, street glow) follow the simulated
  time.
- URL parameters for direct links: `?t=08:15&date=20261029&view=harbour`, `&follow=T1`,
  `&mode=cab`, `&near=x,z`, `&speed=30`, `&cam=x,y,z&target=x,y,z`.

## How it works

### Data (all open)

| Source | Use |
|---|---|
| TfNSW *Full Greater Sydney GTFS static* (opendata.transport.nsw.gov.au, CC BY 4.0) | Timetables (second-precision), stops/platforms, shapes; fleet type and car count decoded from trip ids (`.A.8.` = Waratah, 8 cars) |
| OpenStreetMap (© OpenStreetMap contributors, ODbL) via Overpass + Geofabrik extract | Track geometry, track names (Up Main, Down Suburban…), running directions, maxspeed, tunnels/bridges, 844 lineside main signals, switches, level crossings, platforms, buildings |
| AWS Terrain Tiles (Terrarium) | Elevation; filtered (grey opening) to remove buildings from the surface model |
| Esri World Imagery | Satellite imagery, streamed at runtime |

### Pipeline (`scripts/`, Python 3 + venv in `data/raw/venv`)

1. `dem.py`, `dem_filter.py` — download & clean the DEM; writes local tiles `public/data/dem`.
2. `build_network.py` → track graph (6,652 edges / 1,635 km), heights (surface from DEM, bridges
   interpolated, tunnels by OSM layer), per-direction speed limits, signals, crossings, platforms.
3. `gtfs_extract.py` → rail subset of GTFS.
4. `route_trips.py` → map-matches every trip onto the graph. The TfNSW shapes lie on OSM track
   centrelines, so a Viterbi search over candidate tracks at each stop (Dijkstra with turn
   limits at switches, shape-distance costs, reversal moves for shunts such as Lidcombe P0)
   recovers the exact track, platform and crossovers. 53,962 trips → 1,883 stopping patterns.
5. `export_network.py`, `export_timetable.py` → `public/data/network.json`,
   `patterns.json`, `tt/YYYYMMDD.json` (21 days from 29 Oct 2026).
6. `buildings.py` → 1 km binary chunks of OSM buildings (`public/data/bld`), skipping
   footprints replaced by landmark models and roofs over the tracks.

### Simulation (`src/sim/`)

- **Train driver model** (`train.js`): dwells to the scheduled departure, then chooses the cruise
  speed that arrives on time (binary search over a traction/braking profile), obeys the line
  speed over the whole train length, brakes to restrictions, stopping points and red signals.
  Fleet-specific acceleration, braking and top speed.
- **Signalling** (`simulation.js`): NSW four-aspect automatic block. Aspects come from train
  occupancy (red / yellow / double yellow / green); drivers look several signals ahead.
  OSM-mapped signals are kept; long unsignalled stretches get synthesised automatic signals
  (~800 m), and Metro track gets short invisible blocks approximating CBTC.
- **Turnarounds**: TfNSW run numbers change per trip, so physical trains are formed the way a
  terminus works — a consist that arrives at a platform forms the next departure from that same
  platform (same fleet and length).
- **Level crossings**: booms lower and lights flash ~30 s before a train arrives.

Headless check of a full weekday (`node scripts/simtest.mjs 20261029`): 3,455 trips, up to
~245 trains running at once, 50,691 arrivals, median deviation 0 s, 92.6 % within 60 s of the
timetable, p99 ≈ 4 min (peak-hour block conflicts around Redfern/Sydenham), no early arrivals,
no stuck trains. Metro M1 p90 = 7 s.

### Rendering (`src/world`, `src/render`, `src/models`)

Streaming quadtree terrain with the track corridor carved into cuttings/embankments; chunked
track (ballast + sleepers texture, rails, bridge decks/piers, tunnel shells), catenary masts and
wires; OSM platforms with awnings; instanced signals and crossings; OSM buildings meshed in a
worker with procedural windows; procedural train models (9 fleets, 2 LODs, GPU-instanced, cars
placed by their bogies); landmark models (Harbour Bridge — trains run on its deck — Opera House,
Sydney Tower, Central clock tower and concourse, ANZAC Bridge, Metro cable-stayed bridge);
physically based sky with the true solar position for Sydney; harbour water.

## Known limitations

- Track geometry is an OSM snapshot (July 2026); the timetable is the 29 Oct 2026 GTFS.
  Dates outside the 21 exported days reuse the same weekday.
- Signalling is occupancy-based along each train's path. There is no route setting or flank
  protection at junctions, and opposing moves on bidirectional track are not interlocked
  (the timetable already keeps them apart).
- Trains enter and leave service at platforms; yard and siding moves aren't modelled.
  Intercity trains enter/leave at the edge of the modelled area.
- Gradients come from the cleaned DEM, so they are approximate; tunnel depths are estimated
  from OSM layers. Bogie centres for most classes are estimates.
- The satellite imagery is streamed and needs an internet connection; Esri's mosaic has visible
  source boundaries at some zoom levels.

Model sources and research notes are in comments at the top of each file in `src/models/`.
Reference photos and verification screenshots are in `data/reference/`.
