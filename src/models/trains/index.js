// Fleet registry: combines suburban (A B T M K H) and intercity/metro (D MET N) fleets.
import { FLEETS as SUB } from './suburban.js';
import { FLEETS as IC } from './intercity.js';

export const FLEETS = { ...SUB, ...IC };

/** Fleet spec for a GTFS fleet code; unknown codes fall back to a Waratah. */
export function fleet(code) {
  return FLEETS[code] || FLEETS.A;
}

/** Variants for an n-car consist. The final car is always a 'lead' rotated 180° by the renderer. */
export function formationOf(code, cars) {
  const f = fleet(code);
  if (f.formation) {
    const v = f.formation(cars);
    if (v && v.length === cars) return v;
  }
  const out = [];
  for (let i = 0; i < cars; i++) out.push(i === 0 || i === cars - 1 ? 'lead' : 'mid');
  return out;
}
