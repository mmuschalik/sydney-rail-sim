// Landmark models (world coordinates, y = m AMSL). buildLandmarks() builds them all.
import * as THREE from 'three';
import { build as buildHarbourBridge, harbourBridgeRailHeight, HARBOUR_BRIDGE_RAIL } from './harbourBridge.js';
import { build as buildOperaHouse } from './operaHouse.js';
import { build as buildSydneyTower } from './sydneyTower.js';
import { build as buildCentral } from './centralStation.js';
import { build as buildAnzac } from './anzacBridge.js';
import { build as buildMetroBridge, metroBridgeRailHeight, METRO_BRIDGE_RAIL } from './metroBridge.js';

export { harbourBridgeRailHeight, HARBOUR_BRIDGE_RAIL, metroBridgeRailHeight, METRO_BRIDGE_RAIL };

/** OSM building / building:part ids replaced by these models (skip them in the generic extruder) */
export const LANDMARK_EXCLUDE_OSM_IDS = [
  // Sydney Harbour Bridge: four pylons, pylon groups, north approach piers/abutment
  'w142518160', 'w142518161', 'w142518162', 'w142518163', 'w156584774', 'w382401361',
  'w156584778', 'w156584782', 'w156584787', 'w156584791', 'w156584795', 'w156584800',
  'w156584805', 'w156584811', 'w156584815',
  // Sydney Opera House: building + all roof/shell parts + glass foyer roofs
  'r9596872', 'r9596873', 'r9596874', 'r9596876', 'r9596878', 'r9596879', 'r9596880', 'r9596881',
  'r9596883', 'r9677501', 'r9677503', 'r9677509', 'w690624100', 'w690624152',
  // Sydney Tower Eye: turret, upper drum, spire (the Westfield podium stays generic)
  'w197801072', 'w197801074', 'w273960049',
  // Central station: sandstone terminal building, clock tower, Grand Concourse roof
  'w16748116', 'w506597798', 'w808966807',
];

const BUILDERS = [
  ['harbourBridge', buildHarbourBridge],
  ['operaHouse', buildOperaHouse],
  ['sydneyTower', buildSydneyTower],
  ['centralStation', buildCentral],
  ['anzacBridge', buildAnzac],
  ['metroBridge', buildMetroBridge],
];

export async function buildLandmarks() {
  const g = new THREE.Group(); g.name = 'landmarks';
  for (const [name, fn] of BUILDERS) {
    try {
      const o = await fn(); o.userData.landmark = name; g.add(o);
    } catch (e) { console.error('landmark ' + name + ' failed', e); }
  }
  return g;
}
export default buildLandmarks;
