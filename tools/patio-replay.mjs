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

/**
 * The part of the colliders the layout meets that node can rebuild from the committed code as well as the data, near the
 * cafés (the browser's own 80 m cells, CITY.patioInputs): { decks, mappedPoles }, each `count:hash` like the page's
 * fingerprint. `decks`: the flyover decks' (and raised tracks') surface, city-config.js deckHeightAt sampled every 4 m,
 * which the piers, the mapped poles and the props keep out from under; `mappedPoles`: the City's poles where
 * js/mapped-poles.js stands them (one under a deck is left out). A code change to either reaches the page's collider
 * fingerprint, so the page would lay the patios out at startup (st-hue6: #63's deck tapers covered one pole near a café,
 * and the page did that for a day): tools/build-patios.mjs records these and tests/cafeto.test.mjs recomputes them.
 */
export function patioDerivedInputs(world, root = ROOT) {
  const { CITY, records } = world;
  if (!CITY.mappedPoleSites) {
    const context = vm.createContext({ window: { CITY }, console: { ...console, info() {}, warn() {} } });
    for (const file of ['js/toronto-poles.js', 'js/mapped-poles.js']) {
      vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    }
  }
  // (the café cells, as patioInputs keeps furniture: whatever stands in one, of the plain rows given)
  const near = (rows) => CITY.patioInputs(CITY, records, [], rows).furniture;
  const C = 80, S = 4, cells = new Map();
  for (const r of records) {
    const i = Math.floor(r.x / C), j = Math.floor(r.z / C);
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) cells.set(`${a},${b}`, [a, b]);
  }
  const deck = [];
  for (const [i, j] of cells.values()) {
    for (let x = i * C + S / 2; x < (i + 1) * C; x += S) {
      for (let z = j * C + S / 2; z < (j + 1) * C; z += S) {
        const h = CITY.deckHeightAt(x, z, 1e4, 1e4);
        if (h) deck.push([x, z, h]);
      }
    }
  }
  const { sites } = CITY.mappedPoleSites(CITY.POLES, { blockAt: CITY.blockAt, nearestRoads: CITY.nearestRoads,
    deckHeightAt: CITY.deckHeightAt, cutAt: CITY.cutAt, SW_Y: CITY.CITY_BOUNDS.sidewalkHeight });
  const poles = near(sites.map((s) => ({ x: s.x, z: s.z, kind: `${s.id}`, s }))).map(({ s }) => [s.id, s.type, s.x, s.z, s.y0, s.ax, s.az]);
  return { decks: CITY.patioFingerprint(deck), mappedPoles: CITY.patioFingerprint(poles) };
}
