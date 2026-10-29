// World coordinate system shared by the whole simulation.
//
// Scaled Web Mercator centred on Sydney Central station:
//   +X = east, +Y = up (metres above sea level), +Z = south, units = metres.
// Web Mercator is used so satellite tiles map onto the ground as exact quads;
// the cos(lat0) scale makes distances true near the origin (<0.4% error at
// the edges of the network).

export const ORIGIN = { lat: -33.8832, lon: 151.2063 }; // Central station
const R = 6378137;
const D2R = Math.PI / 180;
const K = Math.cos(ORIGIN.lat * D2R);

function mercX(lon) { return R * lon * D2R; }
function mercY(lat) { return R * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2)); }

const MX0 = mercX(ORIGIN.lon);
const MY0 = mercY(ORIGIN.lat);

/** lat/lon (degrees) -> world {x, z} in metres */
export function project(lat, lon) {
  return { x: (mercX(lon) - MX0) * K, z: -(mercY(lat) - MY0) * K };
}

/** world x/z -> {lat, lon} */
export function unproject(x, z) {
  const mx = x / K + MX0;
  const my = -z / K + MY0;
  return {
    lon: mx / R / D2R,
    lat: (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) / D2R,
  };
}

/** Web Mercator tile (z, x, y) -> world bounds {x0, z0, x1, z1} (x0<x1, z0<z1) */
export function tileBounds(tz, tx, ty) {
  const n = 2 ** tz;
  const size = (2 * Math.PI * R) / n;
  const mx0 = -Math.PI * R + tx * size;
  const my0 = Math.PI * R - ty * size; // top edge (north)
  return {
    x0: (mx0 - MX0) * K,
    x1: (mx0 + size - MX0) * K,
    z0: -(my0 - MY0) * K,
    z1: -(my0 - size - MY0) * K,
  };
}

/** world x/z -> fractional tile coords at zoom tz */
export function worldToTile(x, z, tz) {
  const n = 2 ** tz;
  const mx = x / K + MX0;
  const my = -z / K + MY0;
  return {
    tx: ((mx + Math.PI * R) / (2 * Math.PI * R)) * n,
    ty: ((Math.PI * R - my) / (2 * Math.PI * R)) * n,
  };
}

export const WORLD_SCALE = K;
