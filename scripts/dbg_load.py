# exec route_trips.py definitions (everything before the trip loop) for debugging
import os, sys
sys.path.insert(0, 'scripts')
src = open('scripts/route_trips.py').read()
src = src.split('legcache = {}')[0]
exec(compile(src, 'route_trips_defs', 'exec'))
