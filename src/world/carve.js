// Terrain modifier: forms the rail corridor (cuttings / embankments) so the DEM surface
// meets the track formation instead of burying or floating around it.
import { FLAG } from '../sim/network.js';

const CELL = 40;
const INNER = 7;   // fully flattened half-width (m)
const OUTER = 34;  // blend back to natural ground by this distance

export function makeCarver(net) {
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  for (const e of net.edges) {
    if (e.flags & (FLAG.TUNNEL | FLAG.BRIDGE)) continue;
    const p = e.p, n = p.length / 3;
    for (let i = 1; i < n; i++) {
      const x0 = p[i * 3 - 3], y0 = p[i * 3 - 2], z0 = p[i * 3 - 1];
      const x1 = p[i * 3], y1 = p[i * 3 + 1], z1 = p[i * 3 + 2];
      const L = Math.hypot(x1 - x0, z1 - z0);
      const k = Math.max(1, Math.ceil(L / 6));
      for (let j = 0; j <= k; j++) {
        const t = j / k;
        const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t;
        const kk = key(x, z);
        let arr = grid.get(kk);
        if (!arr) grid.set(kk, (arr = []));
        arr.push(x, y, z);
      }
    }
  }
  return (x, z, h) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = 1e9, by = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = grid.get(`${cx + i},${cz + j}`);
      if (!arr) continue;
      for (let k = 0; k < arr.length; k += 3) {
        const d = (arr[k] - x) ** 2 + (arr[k + 2] - z) ** 2;
        if (d < best) { best = d; by = arr[k + 1]; }
      }
    }
    if (best > OUTER * OUTER) return h;
    const d = Math.sqrt(best);
    const target = by - 0.7;
    const w = d <= INNER ? 1 : 1 - (d - INNER) / (OUTER - INNER);
    const ws = w * w * (3 - 2 * w);
    return h + (target - h) * ws;
  };
}
