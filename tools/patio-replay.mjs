// tools/patio-replay.mjs: the CaféTO patio layout (js/patio-layout.js) run in node with the inputs the browser had, for
// tools/build-patios.mjs and tests/cafeto.test.mjs. The city's data and geometry queries come from the committed scripts
// (tools/cafeto-world.mjs, plus js/world-collision.js, the Bike Share stations and js/cafeto-patios.js's own helpers); what
// exists only once the city is built (the solid colliders the layout met, the laid-out furniture near the cafés) comes
// from the generator's record, tools/data/patio-inputs.json.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadPatioWorld } from './cafeto-world.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The node world with the runtime's helpers: { CITY, records } */
export function loadReplayWorld(root = ROOT) {
  const { CITY, records } = loadPatioWorld(root);
  const context = vm.createContext({ window: { CITY }, location: { search: '' }, URLSearchParams, console: { ...console, info() {}, warn() {} } });
  CITY.CITY_BOUNDS ||= { sidewalkHeight: 0.22 };
  for (const file of ['js/world-collision.js', 'js/bike-share-stations.js', 'js/bike-share.js', 'js/cafeto-patios.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return { CITY, records };
}

/** patioSites with the recorded runtime inputs ({ furniture, colliders }): { sites (rows), rejected, blockers, reasons } */
export function replayPatios(world, inputs) {
  const { CITY, records } = world;
  const blocked = CITY.patioBlocked(inputs.colliders, CITY.WorldCollision);
  const deps = CITY.patioDeps(CITY, { furniture: inputs.furniture, blocked, bikeShareAt: CITY.bikeShareAt });
  const out = CITY.patioSites(records, deps);
  return { sites: out.sites.map(CITY.patioSiteRow), rejected: out.rejected, blockers: out.blockers, reasons: out.reasons };
}
