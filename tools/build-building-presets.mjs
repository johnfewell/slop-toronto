// tools/build-building-presets.mjs — st-ndw9.10 (phase 1a) and st-ndw9.11: give every building in the downtown frame a
// prototype preset and write it once, beside the massing sidecar, for the page to fetch behind ?massing=1&presets=1.
//
// Reads committed data only: tools/data/building-inputs.json (the shared buildings/3 facts), tools/data/downtown-era-
// draft-1.json (the hand-made neighbourhood era split), data/toronto-massing.bin (through js/massing-data.js, for the
// main-street flag on street edges) and js/building-prototypes.js (the catalogue). Nothing the page loads is changed
// except the new presets file, which only the flag fetches.
//
// st-ndw9.11: the main-street buildings come from Slop's own shop-front rule, not an OpenStreetMap shop tag. The rule
// lives in js/buildings.js (storefrontSelection, signedWalls, buildingFront, shopFrontRule) and is loaded here from
// that very file, so the assignment uses the same test the drawing does; the main-street shop splits by era into
// main-street-shop-early and main-street-shop-later. A second file, data/toronto-building-presets-debug.bin, carries
// the facts the debug view's identify panel shows; it is fetched only behind ?presets=debug.
//
// usage: node tools/build-building-presets.mjs [--out <path>] [--debug <path>] [--md docs/building-presets.md]
//        [--examples 10] [--quiet]
//
// =====================================================================================================================
// THE RULES (one table). Every record is one City 3D Massing part; a building is one joined group. Form,
// houseScale, use class, area, heights, shop, main street, neighbourhood, construction year, religion and tradition
// come from the inputs file. The preset ids are js/building-prototypes.js.
// WORSHIP (st-ndw9.16; ahead of the main-street, house and use-class rules). A place of worship is a group that
// buildings/4 gives a religion (or the OSM use class worship). Its preset comes from its religion, its tradition, its
// construction year and its footprint (`worshipPreset` below):
//   muslim -> mosque; jewish -> synagogue; buddhist, hindu, sikh -> temple
//   christian, or a religion it does not name (unknown, other, none) -> a church by year and size: built before 1930 is
//     church-gothic when the footprint is at least 400 m2 OR the tradition is roman catholic, anglican, presbyterian
//     or orthodox, else church-chapel; built 1930 to 1959 is church-chapel; built 1960 on is church-modern.
//   The year is the group's own yearBuilt where a source has one, else the era the house rule would draw for its
//   neighbourhood (worshipYear). A congregation in a house (every part house-scale and tagged as a house) keeps
//   its house preset and is counted. The rest, including one on a main street, takes its worship preset.
// =====================================================================================================================
// MAIN STREET (ahead of the house and use-class rules): a building of five storeys or fewer with a shop front by
// Slop's own rule (js/buildings.js: a source-keyed sign, a mapped retail place of its own, or a retail strip on the
// street it fronts) is a main-street building, whatever its form or use class. Worship and civic (and so schools) keep
// their own presets. By era: Victorian & Edwardian -> main-street-shop-early; interwar on -> main-street-shop-later. A
// building over five storeys with a shop front keeps its other preset (counted).
// HOUSES (form detached, semi or row; 13 presets). The group's era (below) picks the preset:
//   detached  -> victorian-detached | edwardian-detached | interwar-detached | postwar-detached | recent-detached
//   semi      -> victorian-semi     | edwardian-semi     | interwar-semi     | postwar-semi     | recent-semi
//   row       -> victorian-row      | edwardian-row      | modern-townhouse-row
//   (only three row presets exist: interwar and postwar rows take the Edwardian row, recent the modern townhouse.)
// OUTBUILDING (form outbuilding) -> garage.
// EVERYTHING ELSE, per joined group, from its use class (the largest part's), its height band (the tallest part), a
// podium, a shop and a main street:
//   apartments  13+ on a podium -> glass-tower-podium; 13+ plain -> slab-tower; 6-12 -> mid-rise-block; else walk-up-apartment
//   business    13+ -> dark-curtain-wall-tower; 6-12 -> contemporary-glass; else low-masonry-block
//   civic       a school name -> school; else 6+ storeys or 5,000 m²+ -> institutional-block; else small-civic
//   worship     the six worship presets below, by religion, tradition, year and footprint (not the use-class table)
//   industrial  2 storeys or fewer -> low-shed; else brick-warehouse
//   shed        low-shed
//   no use tag  13+ -> tower; 6-12 -> mid-rise-block; else plain-low-block
//   house/other in a building that is not a house -> fallback (today's look), counted
// Where the spec's table does not say how to choose between two presets, the simplest rule from the data is used and
// counted in docs/building-presets.md: the 3-/6-/13-storey bands (buildings.js FLOOR_HEIGHTS[0] = 3.4 m), the podium
// flag (the sidecar's `base`), the school name, and 5,000 m² for a civic block.
//
// ERA. A group takes its year if a source dates any of its parts (the period that year falls in, js/building-
// prototypes.js eraOfYear). Otherwise it draws from its neighbourhood's split in the era draft, using a number hashed
// from the GROUP's smallest durable id (to-3dmassing-2025:<fid>[.<k>]), so every part of a group agrees and the same
// building always gets the same era; a changed split moves only the buildings whose draw crosses a moved boundary. A
// neighbourhood not in the draft takes the fallback era (FALLBACK_ERA) and is counted. Main-street buildings take an
// era the same way as houses. Buildings that share a wall are then given one era per run, within their own kind (a run
// of houses, or a run of main-street buildings): the run's smallest durable id decides (see RUNS below).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { packGeo } from './geo-pack.mjs';
import { partition } from './report-building-forms.mjs';
import { PROTOTYPES, byId, FALLBACK_ID, ERAS, eraOfYear } from '../js/building-prototypes.js';
import { OSM_CLASS_NAMES, RELIGION_NAMES, TRADITION_NAMES } from './build-building-inputs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const STOREY_M = 3.4; // js/buildings.js FLOOR_HEIGHTS[0]
const HOUSEFORMS = new Set(['detached', 'semi', 'row']);
const FALLBACK_ERA = 'postwar'; // (the two frame neighbourhoods outside the draft, 16 and 161, are edge areas built after the war)
const ERA_ORDER = ERAS.map((e) => e.key);
const EARLY_ERAS = new Set(['victorian', 'edwardian']); // main-street-shop-early; the rest are main-street-shop-later

// ---- worship (st-ndw9.16) -------------------------------------------------------------------------------------------
// The thresholds are named here, once, so the report can move them. A church's footprint is its group's total part
// area. 1930 and 1960 are the year breaks John gave (2026-11-15); the footprint threshold and the "large" traditions
// are the rule's own named values.
export const WORSHIP = {
  gothicMaxYear: 1930,          // built before this, a large or a high-church congregation is gothic
  chapelMaxYear: 1960,          // 1930 to 1959 is a chapel; 1960 on is modern
  gothicMinFootprintM2: 400,     // a pre-1930 church this large is gothic whatever its tradition
  gothicTraditions: ['roman catholic', 'anglican', 'presbyterian', 'orthodox'],
  undatedMinFootprintM2: 200    // a worship group with no year: a footprint this large is a church, below it probably a rectory/shop
};
const RELIGION_BY_USE = { muslim: 'mosque', jewish: 'synagogue', buddhist: 'temple', hindu: 'temple', sikh: 'temple' };

const presetIndex = new Map(PROTOTYPES.map((p, i) => [p.id, i]));
const OSM = { none: 0, house: 1, business: 2, worship: 3, civic: 4, industrial: 5, shed: 6, apartments: 7, other: 8 };

// ---- the era: a group's split draw, the year where a source dates it ------------------------------------------------
const hashId = (id) => { let h = 0x811c9dc5; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const cmpId = (a, b) => (a.fid - b.fid) || (a.k - b.k);

/** The era key of a number in [0, 1) against a neighbourhood's percentage split (in ERA_ORDER). */
function eraFromSplit(weights, u) {
  let cum = 0;
  for (let i = 0; i < ERA_ORDER.length; i++) { cum += (weights[i] || 0) / 100; if (u < cum) return ERA_ORDER[i]; }
  return ERA_ORDER[ERA_ORDER.length - 1];
}

/** The era of one building: a source year wins, else the neighbourhood split drawn by the group's smallest id. */
function baseEra(group, draft) {
  const dated = group.records.filter((r) => r.yearBuilt != null).sort(cmpId)[0];
  if (dated) return { era: eraOfYear(dated.yearBuilt), source: 'year', year: dated.yearBuilt };
  const rep = group.records.slice().sort(cmpId)[0];
  const w = draft.weights[rep.neighbourhood];
  if (!w) return { era: FALLBACK_ERA, source: 'fallback' };
  return { era: eraFromSplit(w.weights, hashId(rep.id) / 4294967296), source: 'neighbourhood' };
}

// ---- the shared shop-front rule (js/buildings.js) -------------------------------------------------------------------
// The page decides a shop front when it draws a building (js/buildings.js). The assignment must apply the same rule, so
// it loads that file here, in a vm with the same stubs the storefront tests use, and calls its own pure functions:
// storefrontSelection, signedWalls, buildingFront and shopFrontRule. Nothing is copied or re-implemented.
function loadBuildingRule(GEO, nearestRoads, STOREFRONTS) {
  const window = { CITY: { THREE: {}, Addons: {}, TSL: {}, GEO, CITY_BOUNDS: {}, nearestRoads, STOREFRONTS } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/buildings.js'), 'utf8'), { window, console });
  return window.CITY;
}
function loadStorefronts() {
  const c = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/toronto-storefronts.js'), 'utf8'), c);
  return c.window.CITY.STOREFRONTS;
}

/**
 * Per joined group, whether Slop's shop-front rule gives any of its parts a shop front on a street-facing edge, and the
 * name of the street it fronts. Calls js/buildings.js's own functions on the same GEO rows the page draws.
 */
export function computeShopFronts(P) {
  const { GEO, buildings, nearestRoads } = P;
  const { storefrontSelection, signedWalls, shopFrontRule, buildingFront } = loadBuildingRule(GEO, nearestRoads, loadStorefronts());
  const retail = storefrontSelection(GEO.pois);
  const signWalls = signedWalls();
  const out = new Map();
  for (const g of buildings) {
    let shop = false, street = null;
    for (const r of g.records) {
      const b = GEO.buildings[r.row];
      if (!b) continue;
      const signed = signWalls.get(r.row);
      const { front, near } = buildingFront(b[0], b[1], b[2], signed, nearestRoads);
      const res = shopFrontRule({ signed, own: retail.own.has(r.row), kind: b[5], front, parts: b[3], cx: b[0], cz: b[1], ang: b[2], near, retail, nearestRoads });
      if (res.shopFront) { shop = true; if (!street && near.length) street = near[0].road.name; }
    }
    out.set(g.root, { shopFront: shop, street });
  }
  return out;
}

// ---- RUNS: buildings that share a wall get one era (the brief's "a row of joined main-street buildings must agree as
// the houses do"). A run is a connected set of eligible buildings joined by a shared wall (a party edge, both in the
// same neighbourhood); its era is the base era of its smallest durable id. The wall is found by matching a party
// edge's endpoints (on the decimetre grid) across buildings. -----------------------------------------------------------
function sharedWallPairs(recs) {
  const CELL = 2, REACH = 0.8;
  const grid = new Map();
  const edges = [];
  for (const r of recs) {
    const n = r.outer.length;
    for (let e = 0; e < n; e++) {
      const [ax, az] = r.outer[e], [bx, bz] = r.outer[(e + 1) % n];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1e-9;
      const o = { r, e, mx: (ax + bx) / 2, mz: (az + bz) / 2, ux: dx / len, uz: dz / len };
      edges.push(o);
      const k = `${Math.floor(o.mx / CELL)},${Math.floor(o.mz / CELL)}`;
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(o);
    }
  }
  const pairs = [];
  for (const r of recs) {
    if (!r.covered || r.covered.size === 0) continue;
    for (const e of r.covered.keys()) {
      const [ax, az] = r.outer[e], [bx, bz] = r.outer[(e + 1) % (r.outer.length)];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1e-9;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, ux = dx / len, uz = dz / len;
      for (let ix = Math.floor((mx - REACH) / CELL); ix <= Math.floor((mx + REACH) / CELL); ix++) {
        for (let iz = Math.floor((mz - REACH) / CELL); iz <= Math.floor((mz + REACH) / CELL); iz++) {
          for (const o of grid.get(`${ix},${iz}`) || []) {
            if (o.r.row === r.row) continue;
            if (Math.hypot(o.mx - mx, o.mz - mz) > REACH) continue;
            if (Math.abs(ux * o.ux + uz * o.uz) < 0.7) continue; // (a shared wall runs parallel)
            pairs.push([r, o.r]);
          }
        }
      }
    }
  }
  return pairs;
}

/** Union-find over eligible buildings sharing a wall in the same neighbourhood; returns each building's run root. */
function eraRuns(buildings, recs, buildingOfRow, eligible) {
  const parent = new Map();
  const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; } return r; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const g of buildings) if (eligible.has(g.root)) parent.set(g.root, g.root);
  let connected = 0, crossNeighbourhood = 0;
  for (const [a, b] of sharedWallPairs(recs)) {
    const ga = buildingOfRow.get(a.row), gb = buildingOfRow.get(b.row);
    if (!ga || !gb || !eligible.has(ga.root) || !eligible.has(gb.root)) continue;
    const na = ga.records.slice().sort(cmpId)[0].neighbourhood, nb = gb.records.slice().sort(cmpId)[0].neighbourhood;
    if (na !== nb) { crossNeighbourhood++; continue; } // (a changed split must move only its own neighbourhood)
    if (find(ga.root) !== find(gb.root)) { union(ga.root, gb.root); connected++; }
  }
  const runs = new Map();
  for (const g of buildings) if (eligible.has(g.root)) {
    const r = find(g.root);
    let run = runs.get(r);
    if (!run) runs.set(r, (run = { root: r, buildings: [] }));
    run.buildings.push(g);
  }
  return { runs, connected, crossNeighbourhood };
}

/** One era per run: the base era of the run's smallest durable id (every member shares the neighbourhood). */
function runEras(runs, base) {
  const runEra = new Map(), runSize = [];
  for (const run of runs.values()) {
    const smallest = run.buildings.map((g) => g.records.slice().sort(cmpId)[0]).reduce((a, r) => (cmpId(a, r) < 0 ? a : r));
    const pick = run.buildings.find((g) => { const rep = g.records.slice().sort(cmpId)[0]; return rep.fid === smallest.fid && rep.k === smallest.k; }) || run.buildings[0];
    const era = base.get(pick.root)?.era;
    for (const g of run.buildings) runEra.set(g.root, era);
    runSize.push(run.buildings.length);
  }
  return { runEra, runSize };
}

// ---- the assignment -------------------------------------------------------------------------------------------------
function housePreset(form, era) {
  if (form === 'row') return era === 'victorian' ? 'victorian-row' : era === 'recent' ? 'modern-townhouse-row' : 'edwardian-row';
  return `${era}-${form}`; // detached and semi: the era's own preset
}

/**
 * The worship preset of a group (st-ndw9.16), from its religion, tradition, year and footprint:
 *   muslim / jewish / buddhist, hindu, sikh -> mosque / synagogue / temple;
 *   every other religion (christian, or one the data does not name) -> a church by the year (and, undated, the size):
 *     before 1930: gothic when the tradition is high church or the footprint is 400 m² or more, else chapel;
 *     1930 to 1959: chapel; 1960 on: modern.
 * A group with no year (its neighbourhood is outside the draft's houses unsplit): below 200 m² footprint it is probably
 * a rectory or a shop named for its congregation and it takes church-chapel; at 200 m² or more the size and tradition
 * choose as they would for a pre-1930 church (counted in the report). The footprint is the group's total part area.
 * The thresholds are WORSHIP's.
 */
export function worshipPreset({ religion, tradition, year, footprintM2 = 0 }, WORSHIP_T = WORSHIP) {
  const byReligion = RELIGION_BY_USE[religion];
  if (byReligion) return byReligion;
  // christian, or a religion the data does not name: a church by year and size
  if (year == null) {
    if (footprintM2 < WORSHIP_T.undatedMinFootprintM2) return 'church-chapel';
    if (footprintM2 >= WORSHIP_T.gothicMinFootprintM2) return 'church-gothic';
    return WORSHIP_T.gothicTraditions.includes(tradition) ? 'church-gothic' : 'church-chapel';
  }
  if (year < WORSHIP_T.gothicMaxYear) {
    if (WORSHIP_T.gothicTraditions.includes(tradition)) return 'church-gothic';
    if (footprintM2 >= WORSHIP_T.gothicMinFootprintM2) return 'church-gothic';
    return 'church-chapel';
  }
  if (year < WORSHIP_T.chapelMaxYear) return 'church-chapel';
  return 'church-modern';
}

/**
 * The year a worship group is dated by: its own `yearBuilt` where a source has one, else the year its neighbourhood's
 * era reaches on the worship rule's own scale. The worship scale is not the house era's: the house draw is for Toronto's
 * housing stock and calls most of the old city "Victorian" (before 1900), which would call almost every undated downtown
 * church Gothic. Its bands are mapped by the era's start to the worship bands instead:
 *   Victorian or Edwardian (on the map before 1920) -> 1900 (before 1930); Interwar -> 1930 (chapel); Postwar -> 1960
 *   (modern); Recent -> 2000 (modern). A group in a neighbourhood outside the draft's houses unsplit is `fallback`:
 *   no year, and its size decides (see worshipPreset).
 */
export const WORSHIP_ERA_YEAR = { victorian: 1900, edwardian: 1900, interwar: 1930, postwar: 1960, recent: 2000 };
export function worshipYear(group, draft) {
  const dated = group.records.filter((r) => r.yearBuilt != null).sort(cmpId)[0];
  if (dated) return { year: dated.yearBuilt, source: 'year' };
  const era = baseEra(group, draft);
  if (era.source === 'fallback') return { year: null, source: 'fallback-era', era: era.era };
  return { year: WORSHIP_ERA_YEAR[era.era], source: 'neighbourhood-era', era: era.era };
}

/** A congregation in a house: a place of worship whose parts are all house-scale and whose form is a house form. */
export function isCongregationInHouse(group) {
  return group.house && group.records.every((r) => r.houseScale);
}

function nonHousePreset(g, OSM, legacyShop = false) {
  const band = g.heightBand;
  const tall = band === 'h6';        // 13 storeys or more
  const mid = band === 'h5';         // 5 to 13
  const storeys = g.maxHeight / STOREY_M;
  const cls = g.osmClass;
  if (cls === OSM.apartments) {
    if (tall) return g.podium ? 'glass-tower-podium' : 'slab-tower';
    if (mid) return 'mid-rise-block';
    return 'walk-up-apartment';
  }
  if (cls === OSM.business) {
    if (tall) return 'dark-curtain-wall-tower';
    if (mid) return 'contemporary-glass';
    return 'low-masonry-block';
  }
  if (cls === OSM.civic) {
    if (g.school) return 'school';
    if (tall || mid || g.totalArea >= 5000 || storeys >= 5) return 'institutional-block';
    return 'small-civic';
  }
  if (cls === OSM.worship) return 'church';
  if (cls === OSM.industrial) return storeys <= 2 ? 'low-shed' : 'brick-warehouse';
  if (cls === OSM.shed) return 'low-shed';
  // no useful use tag: either none or a residential (house) tag on a building that is not house-scale (form other).
  // The spec's "untagged block" row covers both, so the preset comes from height alone (the main-street rule runs
  // ahead of this, and st-ndw9.11 took the old shop/main-street branch out of here).
  if (cls === OSM.none || cls === OSM.house) {
    if (legacyShop && g.shop && g.mainStreet && storeys <= 5) return 'main-street-shop';
    if (tall) return 'tower';
    if (mid) return 'mid-rise-block';
    return 'plain-low-block';
  }
  return FALLBACK_ID; // use `other`: the rules cannot place it
}

/** The main-street kind of a group: a shop front by Slop's rule, five storeys or fewer, and not worship/civic/school. */
function isMainStreet(g, shopFronts) {
  if (g.formField === 'outbuilding') return false;
  if (!shopFronts.get(g.root)?.shopFront) return false;
  if (g.osmClass === OSM.worship || g.osmClass === OSM.civic) return false;
  return g.maxHeight / STOREY_M <= 5;
}

/**
 * Every building's preset id (the same for all of its records). `shopFronts` is computeShopFronts's map. Era is used by
 * the houses and the main-street shops. Returns the per-record preset index array plus the per-group maps the report
 * and the debug identify file read.
 */
export function assignPresets(buildings, draft, OSM, totalRecords, shopFronts = new Map()) {
  const buildingOfRow = new Map();
  for (const g of buildings) for (const r of g.records) buildingOfRow.set(r.row, g);
  const recs = buildings.flatMap((g) => g.records);

  // (st-ndw9.16: a place of worship takes a worship preset, ahead of the main-street and house rules, unless it is a
  // congregation in a house: the worship set is built first so a house-scale worship group stays a house)
  const worship = new Set();
  for (const g of buildings) if (g.worshipish && !isCongregationInHouse(g)) worship.add(g.root);
  const ms = new Set(), house = new Set();
  for (const g of buildings) {
    if (worship.has(g.root)) continue;
    if (isMainStreet(g, shopFronts)) ms.add(g.root); else if (g.house) house.add(g.root);
  }

  // base era per era-bearing building, then one era per run of wall-sharing buildings of the same kind
  const base = new Map();
  for (const g of buildings) if (ms.has(g.root) || house.has(g.root)) base.set(g.root, baseEra(g, draft));
  const houseRunsRes = eraRuns(buildings, recs, buildingOfRow, house);
  const msRunsRes = eraRuns(buildings, recs, buildingOfRow, ms);
  const hR = runEras(houseRunsRes.runs, base);
  const mR = runEras(msRunsRes.runs, base);
  const runEra = new Map([...hR.runEra, ...mR.runEra]);

  const presetOfBuilding = new Map();
  const eraOfBuilding = new Map();
  const msEra = new Map();
  const worshipYearOf = new Map();
  for (const g of buildings) {
    if (g.formField === 'outbuilding') { presetOfBuilding.set(g.root, 'garage'); continue; }
    if (ms.has(g.root)) {
      const era = runEra.get(g.root) ?? base.get(g.root)?.era ?? FALLBACK_ERA;
      eraOfBuilding.set(g.root, era); msEra.set(g.root, era);
      presetOfBuilding.set(g.root, EARLY_ERAS.has(era) ? 'main-street-shop-early' : 'main-street-shop-later');
      continue;
    }
    if (house.has(g.root)) {
      const era = runEra.get(g.root) ?? base.get(g.root)?.era ?? FALLBACK_ERA;
      eraOfBuilding.set(g.root, era);
      presetOfBuilding.set(g.root, housePreset(g.formField, era));
      continue;
    }
    if (worship.has(g.root)) {
      const wy = worshipYear(g, draft);
      worshipYearOf.set(g.root, { ...wy, footprintM2: g.totalArea });
      presetOfBuilding.set(g.root, worshipPreset({ religion: g.religion, tradition: g.tradition, year: wy.year, footprintM2: g.totalArea }));
      continue;
    }
    presetOfBuilding.set(g.root, nonHousePreset(g, OSM));
  }
  // one preset per sidecar record
  const perRecord = new Uint8Array(totalRecords);
  for (const g of buildings) {
    const id = presetOfBuilding.get(g.root) || FALLBACK_ID;
    const idx = presetIndex.get(id);
    if (idx == null) throw new Error(`preset ${id} is not in the catalogue`);
    for (const r of g.records) perRecord[r.index] = idx;
  }
  return {
    perRecord, presetOfBuilding, eraOfBuilding, msEra, base, houseSet: house, msSet: ms, shopFronts,
    runs: houseRunsRes.runs, runSize: hR.runSize, connected: houseRunsRes.connected, crossNeighbourhood: houseRunsRes.crossNeighbourhood,
    msRuns: msRunsRes.runs, msRunSize: mR.runSize, msConnected: msRunsRes.connected, msCrossNeighbourhood: msRunsRes.crossNeighbourhood,
    worshipSet: worship, worshipYearOf, recs
  };
}

/** Phase 1a's assignment (st-ndw9.10), for the report's before column: houses only, and the old shop/main-street rule. */
export function assignPresetsPhase1a(buildings, draft, OSM) {
  const buildingOfRow = new Map();
  for (const g of buildings) for (const r of g.records) buildingOfRow.set(r.row, g);
  const recs = buildings.flatMap((g) => g.records);
  const house = new Set(buildings.filter((g) => g.house).map((g) => g.root));
  const base = new Map();
  for (const g of buildings) if (house.has(g.root)) base.set(g.root, baseEra(g, draft));
  const { runEra } = runEras(eraRuns(buildings, recs, buildingOfRow, house).runs, base);
  const presetOfBuilding = new Map();
  for (const g of buildings) {
    if (g.formField === 'outbuilding') { presetOfBuilding.set(g.root, 'garage'); continue; }
    if (g.house) { presetOfBuilding.set(g.root, housePreset(g.formField, runEra.get(g.root) ?? base.get(g.root)?.era ?? FALLBACK_ERA)); continue; }
    presetOfBuilding.set(g.root, nonHousePreset(g, OSM, true));
  }
  return presetOfBuilding;
}

// ---- the report -----------------------------------------------------------------------------------------------------
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : null; };
const pct = (n, d) => (d ? (n / d * 100).toFixed(2) + '%' : '—');
const ll = (p) => `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;

// The phase-1a committed output (st-ndw9.10, docs/building-presets.md at PR #157): the before column. Buildings, per preset.
export const PHASE1A = {
  'victorian-detached': 2873, 'edwardian-detached': 3378, 'interwar-detached': 1733, 'postwar-detached': 561, 'recent-detached': 623,
  'victorian-semi': 2750, 'edwardian-semi': 2223, 'interwar-semi': 678, 'postwar-semi': 284, 'recent-semi': 356,
  'victorian-row': 1552, 'edwardian-row': 1169, 'modern-townhouse-row': 229, garage: 95,
  'walk-up-apartment': 334, 'mid-rise-block': 1067, 'slab-tower': 247, 'glass-tower-podium': 132,
  'low-masonry-block': 320, 'dark-curtain-wall-tower': 156, 'contemporary-glass': 146,
  'main-street-shop': 38, 'plain-low-block': 947, tower: 154, school: 35, 'small-civic': 137,
  'institutional-block': 221, church: 127, 'brick-warehouse': 48, 'low-shed': 97, fallback: 27
};

export async function run({ examples = 10, partitioned = null } = {}) {
  const P = partitioned || await partition();
  const { GEO, latLonFromWorld, buildings, recs, inputs } = P;
  const draft = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/data/downtown-era-draft-1.json'), 'utf8'));
  // the sidecar's own check (rowCheck) and edition, that the page validates the presets against
  const { unpackGeo } = await import('../js/geodata-loader.js');
  const { MASSING } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));

  const shopFronts = computeShopFronts(P);
  const assigned = assignPresets(buildings, draft, OSM, inputs.records, shopFronts);
  const { perRecord, presetOfBuilding, eraOfBuilding, msEra, base, houseSet, msSet, runs, runSize, connected, crossNeighbourhood,
    msRuns, msRunSize, msConnected, msCrossNeighbourhood, worshipSet } = assigned;

  // ---- per-preset counts (a building is its group; every record takes its building's preset) ----
  const presetBuildings = new Map(PROTOTYPES.map((p) => [p.id, []]));
  for (const g of buildings) presetBuildings.get(presetOfBuilding.get(g.root)).push(g);
  const perPreset = PROTOTYPES.map((p) => {
    const list = presetBuildings.get(p.id);
    const recCount = list.reduce((s, g) => s + g.size, 0);
    // (st-ndw9.16: the six worship presets replace the one `church`; the after column's own count is what matters)
    const before = p.family === 'worship' ? 0 : (PHASE1A[p.id] ?? 0);
    return { id: p.id, name: p.name, family: p.family, era: p.era, buildings: list.length, records: recCount, groups: list, before };
  });
  const totalBuildings = buildings.length;
  const totalRecords = recs.length;
  for (const p of perPreset) { p.buildingShare = p.buildings / totalBuildings; p.recordShare = p.records / totalRecords; }

  // ---- where the main-street buildings came from: the phase-1a preset of each group now main-street ----
  const before1a = assignPresetsPhase1a(buildings, draft, OSM);
  const beforeCounts = {};
  for (const g of buildings) { const b = before1a.get(g.root); beforeCounts[b] = (beforeCounts[b] || 0) + 1; }
  const moves = {};
  for (const g of buildings) if (msSet.has(g.root)) { const b = before1a.get(g.root); moves[b] = (moves[b] || 0) + 1; }

  // ---- taller buildings with a shop front that keep their own preset ----
  let tallerWithShop = 0;
  for (const g of buildings) {
    if (g.formField === 'outbuilding') continue;
    if (!shopFronts.get(g.root)?.shopFront) continue;
    if (g.osmClass === OSM.worship || g.osmClass === OSM.civic) continue;
    if (g.maxHeight / STOREY_M > 5) tallerWithShop++;
  }

  // ---- worship (st-ndw9.16): per preset, the religion x tradition cross-table, year against era, and a threshold moved
  const religionCounts = {};
  for (const g of buildings) if (g.religion) religionCounts[g.religion] = (religionCounts[g.religion] || 0) + 1;
  const worshipGroups = buildings.filter((g) => g.religion || g.osmClass === OSM.worship);
  const inHouse = worshipGroups.filter((g) => isCongregationInHouse(g));
  const worshipPresets = ['church-gothic', 'church-chapel', 'church-modern', 'mosque', 'synagogue', 'temple'];
  const worshipPresetCounts = {};
  for (const id of worshipPresets) worshipPresetCounts[id] = presetBuildings.get(id).length;
  const worshipSetOf = worshipSet;
  // the cross-table: religion + tradition -> preset, worship groups in the frame (none in a house)
  const cross = new Map();
  for (const id of worshipPresets) cross.set(id, new Map());
  let worshipByYear = 0, worshipByEra = 0, worshipUndated = 0;
  for (const g of worshipSetOf) {
    const grp = buildings.find((b) => b.root === g);
    const preset = presetOfBuilding.get(g);
    const key = `${grp.religion || '(no religion)'} / ${grp.tradition || '—'}`;
    const m = cross.get(preset);
    if (m) m.set(key, (m.get(key) || 0) + 1);
    const wy = assigned.worshipYearOf.get(g);
    if (wy.source === 'year') worshipByYear++;
    else if (wy.source === 'neighbourhood-era') worshipByEra++;
    else worshipUndated++;
  }
  const crossTable = worshipPresets.map((preset) => ({
    preset, total: presetBuildings.get(preset).length,
    rows: [...cross.get(preset)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }));
  const noReligionWorship = worshipSetOf.size - [...worshipSetOf].filter((root) => { const g = buildings.find((b) => b.root === root); return !!g.religion; }).length;
  // the footprint threshold moved 20% either way: what each worship group would become
  const sensitivity = {};
  for (const [label, factor] of [['-20%', 0.8], ['base', 1], ['+20%', 1.2]]) {
    const T = { ...WORSHIP, gothicMinFootprintM2: WORSHIP.gothicMinFootprintM2 * factor, undatedMinFootprintM2: WORSHIP.undatedMinFootprintM2 * factor };
    const counts = Object.fromEntries(worshipPresets.map((id) => [id, 0]));
    for (const root of worshipSetOf) {
      const g = buildings.find((b) => b.root === root);
      const wy = assigned.worshipYearOf.get(root);
      counts[worshipPreset({ religion: g.religion, tradition: g.tradition, year: wy.year, footprintM2: g.totalArea }, T)]++;
    }
    sensitivity[label] = counts;
  }
  // ten seeded examples per worship preset: name, durable id, lat, lon
  const worshipExamples = worshipPresets.map((preset) => {
    const list = presetBuildings.get(preset).slice().sort((a, b) => a.tallest.row - b.tallest.row);
    return {
      id: preset, count: list.length,
      examples: pick(list, examples, 0x9e71 ^ hashId(preset)).map((g) => {
        const t = g.records.slice().sort(cmpId)[0];
        const w = latLonFromWorld(t.cx, t.cz);
        const name = g.records.map((r) => r.name).find((n) => n && n.trim()) || '';
        return { id: t.id, lat: w.lat, lon: w.lon, records: g.size, religion: g.religion, tradition: g.tradition, name: name.trim() };
      })
    };
  });
  // ten congregations in a house (they keep their house preset)
  const houseExamples = pick(inHouse.slice().sort((a, b) => a.tallest.row - b.tallest.row), examples, 0x51ce).map((g) => {
    const t = g.records.slice().sort(cmpId)[0];
    const w = latLonFromWorld(t.cx, t.cz);
    const name = g.records.map((r) => r.name).find((n) => n && n.trim()) || '';
    return { id: t.id, lat: w.lat, lon: w.lon, records: g.size, religion: g.religion, tradition: g.tradition, name: name.trim(), preset: presetOfBuilding.get(g.root) };
  });
  const worship = {
    groups: worshipGroups.length, presets: worshipSetOf.size, inHouse: inHouse.length, noReligion: noReligionWorship,
    presetCounts: worshipPresetCounts, religionCounts, crossTable, dated: worshipByYear, era: worshipByEra, undated: worshipUndated,
    sensitivity, examples: worshipExamples, houseExamples,
    thresholds: { ...WORSHIP }, eraYear: { ...WORSHIP_ERA_YEAR },
    yearOf: assigned.worshipYearOf
  };

  // ---- main-street buildings by the street they front ----
  const streetCounts = new Map();
  for (const g of buildings) if (msSet.has(g.root)) { const s = shopFronts.get(g.root)?.street || '(unnamed)'; streetCounts.set(s, (streetCounts.get(s) || 0) + 1); }
  const topStreets = [...streetCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([street, count]) => ({ street, count }));

  // ---- the fallback, and why ----
  const fallbackGroups = presetBuildings.get(FALLBACK_ID);
  const fallbackWhy = {};
  for (const g of fallbackGroups) {
    const use = OSM_CLASS_NAMES[g.osmClass];
    const key = `${use} / ${g.formField}`;
    fallbackWhy[key] = (fallbackWhy[key] || 0) + 1;
  }

  // ---- the era split drawn per neighbourhood against the draft (house buildings, as before) ----
  const drawnByNb = new Map();
  let fallbackEraBuildings = 0, yearBuildings = 0;
  for (const g of buildings) {
    if (!g.house) continue;
    const rep = g.records.slice().sort(cmpId)[0];
    const nb = rep.neighbourhood;
    let d = drawnByNb.get(nb);
    if (!d) drawnByNb.set(nb, (d = { nb, name: draft.weights[nb]?.name || `neighbourhood ${nb}`, count: 0, eras: Object.fromEntries(ERA_ORDER.map((k) => [k, 0])), fallback: 0, dated: 0 }));
    d.count++;
    const era = eraOfBuilding.get(g.root);
    const dated = g.records.some((r) => r.yearBuilt != null);
    if (dated) { d.dated++; yearBuildings++; }
    else if (baseEra(g, draft).source === 'fallback') { d.fallback++; fallbackEraBuildings++; }
    if (d.eras[era] != null) d.eras[era]++; else d.fallback++;
  }
  const eraTable = [...drawnByNb.values()].sort((a, b) => a.nb - b.nb).map((d) => {
    const w = draft.weights[d.nb];
    return {
      nb: d.nb, name: d.name, inDraft: !!w, houseBuildings: d.count, dated: d.dated, fallback: d.fallback,
      draft: w ? w.weights : null,
      drawn: ERA_ORDER.map((k) => d.eras[k]),
      drawnPct: ERA_ORDER.map((k) => pct(d.eras[k], d.count))
    };
  });

  // ---- shared-wall era disagreement: base per-group era against the run era ----
  const buildingOfRow = new Map();
  for (const g of buildings) for (const r of g.records) buildingOfRow.set(r.row, g);
  const pairs = sharedWallPairs(recs);
  const housePairs = new Map();
  for (const [a, b] of pairs) {
    const ga = buildingOfRow.get(a.row), gb = buildingOfRow.get(b.row);
    if (!ga || !gb || !houseSet.has(ga.root) || !houseSet.has(gb.root)) continue;
    const k = ga.root < gb.root ? `${ga.root}|${gb.root}` : `${gb.root}|${ga.root}`;
    if (!housePairs.has(k)) housePairs.set(k, [ga, gb]);
  }
  const baseEraOf = new Map();
  for (const g of buildings) if (houseSet.has(g.root)) baseEraOf.set(g.root, base.get(g.root)?.era);
  let baseDiff = 0, runDiff = 0, listed = 0;
  for (const [ga, gb] of housePairs.values()) {
    listed++;
    if (baseEraOf.get(ga.root) !== baseEraOf.get(gb.root)) baseDiff++;
    if (eraOfBuilding.get(ga.root) !== eraOfBuilding.get(gb.root)) runDiff++;
  }

  // ---- 10 seeded examples per preset with durable id, lat and lon ----
  const examplePresets = perPreset.map((p) => {
    const list = p.groups.slice().sort((a, b) => a.tallest.row - b.tallest.row);
    return {
      id: p.id, count: p.buildings,
      examples: pick(list, examples, 0x9e71 ^ hashId(p.id)).map((g) => {
        const t = g.records.slice().sort(cmpId)[0];
        const w = latLonFromWorld(t.cx, t.cz);
        return { id: t.id, lat: w.lat, lon: w.lon, records: g.size, era: eraOfBuilding.get(g.root) || null };
      })
    };
  });

  const msBuildings = msSet.size;
  const checks = {
    records: totalRecords,
    buildings: totalBuildings,
    everySidecarRecordHasPreset: perRecord.length === inputs.records && perRecord.every((v) => v >= 0 && v < PROTOTYPES.length),
    presetIdsUnique: new Set(PROTOTYPES.map((p) => p.id)).size === PROTOTYPES.length,
    houseBuildings: buildings.filter((g) => g.house).length,
    housePresetBuildings: perPreset.filter((p) => byId[p.id].family === 'house').reduce((s, p) => s + p.buildings, 0),
    mainStreetBuildings: msBuildings,
    mainStreetEarly: perPreset.find((p) => p.id === 'main-street-shop-early').buildings,
    mainStreetLater: perPreset.find((p) => p.id === 'main-street-shop-later').buildings,
    tallerWithShop,
    fallbackBuildings: fallbackGroups.length,
    fallbackRecords: fallbackGroups.reduce((s, g) => s + g.size, 0),
    fallbackEraBuildings,
    yearDatedBuildings: yearBuildings,
    runs: runs.size,
    runBuildings: runSize.reduce((s, n) => s + n, 0),
    largestRun: runSize.length ? Math.max(...runSize) : 0,
    medianRun: runSize.length ? q(runSize, 0.5) : 0,
    connectedPairs: connected,
    wallPairsAcrossNeighbourhood: crossNeighbourhood,
    msRuns: msRuns.size,
    msRunBuildings: msRunSize.reduce((s, n) => s + n, 0),
    msLargestRun: msRunSize.length ? Math.max(...msRunSize) : 0,
    msConnectedPairs: msConnected,
    sharedWallPairs: listed,
    baseEraDisagreements: baseDiff,
    runEraDisagreements: runDiff,
    // (st-ndw9.16: worship)
    worshipGroups: worship.groups,
    worshipPresets: worship.presets,
    worshipInHouse: worship.inHouse,
    worshipEveryGroupHasAPreset: [...worshipSetOf].every((root) => worshipPresets.includes(presetOfBuilding.get(root))),
    worshipPresetCounts: worship.presetCounts
  };

  return {
    generatedBy: 'tools/build-building-presets.mjs',
    since: '2026-11-15',
    storeyM: STOREY_M,
    fallbackEra: FALLBACK_ERA,
    rowCheck: MASSING.rowCheck,
    edition: MASSING.edition,
    perRecord, presetOfBuilding, eraOfBuilding, msEra, base, houseSet, msSet, shopFronts, perPreset, eraTable, fallbackWhy, checks, examplePresets,
    moves, beforeCounts, topStreets, msBuildings, tallerWithShop, draft, worship,
    parameters: { storeyM: STOREY_M, fallbackEra: FALLBACK_ERA, groups: 'by (fid, k)', runs: 'shared wall within a neighbourhood, by kind' }
  };
}

function pick(list, n, seed) {
  if (list.length <= n) return list.slice();
  const a = list.slice();
  let s = seed >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < n; i++) { const j = i + Math.floor(r() * (a.length - i)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

// ---- the presets file: PRESETS layer in the TGB1 container, beside the massing sidecar ------------------------------
export function pack(out) {
  const layer = {
    PRESETS: {
      schema: 1,
      records: out.perRecord.length,
      rowCheck: out.rowCheck,
      edition: out.edition,
      ids: PROTOTYPES.map((p) => p.id),
      preset: Array.from(out.perRecord)
    }
  };
  return packGeo(layer);
}

// ---- the debug identify file: per record its group, per group the facts the debug view shows. Fetched only behind
// ?presets=debug (js/building-presets-debug.js), kept small (under 400 KB; the packer deflates it). --------------------
export function packDebug(out, P) {
  const { buildings, inputs } = P;
  const groupIndex = new Map(buildings.map((g, i) => [g.root, i]));
  const groupOfRecord = new Array(inputs.records).fill(0);
  for (const g of buildings) for (const r of g.records) groupOfRecord[r.index] = groupIndex.get(g.root);
  const formNames = [...new Set(buildings.map((g) => g.formField))];
  const fid = [], k = [], form = [], dwellings = [], use = [], era = [], eraYear = [], nb = [], run = [];
  // (st-ndw9.16: the worship facts the identify card shows - religion, tradition, the year the worship rule read)
  const religion = [], tradition = [], worshipYear = [];
  const nbNames = {};
  for (const g of buildings) {
    const rep = g.records.slice().sort(cmpId)[0];
    fid.push(rep.fid); k.push(rep.k);
    form.push(formNames.indexOf(g.formField));
    dwellings.push(g.dwellings || 0);
    use.push(g.osmClass);
    nb.push(rep.neighbourhood ?? 0);
    nbNames[rep.neighbourhood] = out.draft.weights[rep.neighbourhood]?.name || `neighbourhood ${rep.neighbourhood}`;
    const eraBearing = out.houseSet.has(g.root) || out.msSet.has(g.root);
    if (eraBearing) {
      const b = out.base.get(g.root);
      era.push(b.source === 'year' ? 0 : b.source === 'neighbourhood' ? 1 : 2);
      const dated = g.records.filter((r) => r.yearBuilt != null).sort(cmpId)[0];
      eraYear.push(b.source === 'year' && dated ? dated.yearBuilt : 0);
      run.push(out.eraOfBuilding.get(g.root) !== b.era ? 1 : 0);
    } else { era.push(3); eraYear.push(0); run.push(0); }
    religion.push(g.religion ? RELIGION_NAMES.indexOf(g.religion) : -1);
    tradition.push(g.tradition ? TRADITION_NAMES.indexOf(g.tradition) : -1);
    const wy = out.worship ? out.worship.yearOf.get(g.root) : null;
    worshipYear.push(wy ? (wy.year ?? 0) : 0);
  }
  // (a place of worship's name, where the OSM extract gives one: the group's first named part)
  const nameList = buildings.map((g) => { const n = g.records.map((r) => r.name).find((x) => x && x.trim()); return n ? n.trim() : ''; });
  const draft = {};
  for (const [n, w] of Object.entries(out.draft.weights)) draft[n] = w.weights;
  const layer = {
    DEBUG: {
      schema: 2,
      records: inputs.records,
      groups: buildings.length,
      rowCheck: out.rowCheck,
      edition: out.edition,
      dataset: 'to-3dmassing-2025',
      formNames,
      useNames: OSM_CLASS_NAMES,
      nbNames,
      draft,
      // (st-ndw9.16: the worship columns)
      religionNames: RELIGION_NAMES,
      traditionNames: TRADITION_NAMES,
      names: nameList,
      groupOfRecord, fid, k, form, dwellings, use, era, eraYear, nb, run, religion, tradition, worshipYear
    }
  };
  return packGeo(layer);
}

// ---- markdown -------------------------------------------------------------------------------------------------------
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-CA'));
function table(head, rows) { return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n'); }

export function renderMarkdown(out) {
  const c = out.checks;
  const presetRows = out.perPreset.map((p) => [`\`${p.id}\``, p.name, p.family, p.era || '—', num(p.before), num(p.buildings), pct(p.buildings, c.buildings), num(p.records), pct(p.records, c.records)]);
  const rulesTable = table(['input', 'rule'], [
    ['main street', 'a shop front by Slop\'s rule (js/buildings.js) on a street-facing edge, 5 storeys or fewer, and not worship or civic: by era main-street-shop-early (Victorian & Edwardian) or main-street-shop-later (interwar on)'],
    ['form', 'detached / semi / row -> a house preset by era (13); outbuilding -> garage; else the use-class table below'],
    ['house era', 'the group\'s construction year where a source has one, else its neighbourhood\'s draft split drawn by the group\'s smallest durable id'],
    ['apartments', '13+ on a podium glass-tower-podium; 13+ slab-tower; 6–12 mid-rise-block; else walk-up-apartment'],
    ['business', '13+ dark-curtain-wall-tower; 6–12 contemporary-glass; else low-masonry-block'],
    ['civic', 'a school name school; else 6+ storeys or 5,000 m²+ institutional-block; else small-civic'],
    ['worship', 'religion, tradition, year and footprint (the section below): muslim mosque; jewish synagogue; buddhist, hindu or sikh temple; every other religion a church: before 1930 gothic when the tradition is roman catholic, anglican, presbyterian or orthodox or the footprint is 400 m² or more, else chapel; 1930 to 1959 chapel; 1960 on modern; undated: under 200 m² chapel, else by size'],
    ['industrial', '2 storeys or fewer low-shed; else brick-warehouse'],
    ['shed', 'low-shed'],
    ['no use tag (none, or a residential tag on a non-house building)', '13+ tower; 6–12 mid-rise-block; else plain-low-block'],
    ['other', 'fallback']
  ]);
  const eraRows = out.eraTable.map((e) => [
    e.nb, e.name, e.inDraft ? 'yes' : 'no', num(e.houseBuildings), e.draft ? e.draft.join(' / ') : '—', e.drawnPct.join(' / '), num(e.dated), num(e.fallback)
  ]);
  const fbRows = Object.entries(out.fallbackWhy).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, num(v)]);
  const moveRows = Object.entries(out.moves).sort((a, b) => b[1] - a[1]).map(([k, v]) => [`\`${k}\``, num(v)]);
  const streetRows = out.topStreets.map((s, i) => [i + 1, s.street, num(s.count)]);
  const exampleSections = out.examplePresets.map((p) => {
    const rows = p.examples.map((e) => [`\`${e.id}\``, ll({ lat: e.lat, lon: e.lon }), e.era || '—', num(e.records)]);
    return `**${p.id}** (${num(p.count)} buildings)\n\n${table(['durable ID', 'lat, lon', 'era', 'records'], rows)}`;
  }).join('\n\n');
  // (st-ndw9.16: the worship section's tables)
  const wp = out.worship;
  const worshipPresetRows = ['church-gothic', 'church-chapel', 'church-modern', 'mosque', 'synagogue', 'temple'].map((id) => [
    `\`${id}\``, byId[id].name, num(wp.presetCounts[id]), pct(wp.presetCounts[id], wp.presets)
  ]);
  const religionRows = Object.entries(wp.religionCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, num(v)]);
  const crossRows = wp.crossTable.flatMap((t) => t.rows.length ? t.rows.map(([key, n]) => [`\`${t.preset}\``, key, num(n)]) : [[`\`${t.preset}\``, '—', '0']]);
  const sensitivityRows = Object.entries(wp.sensitivity).map(([label, counts]) => [
    label, ...['church-gothic', 'church-chapel', 'church-modern'].map((id) => num(counts[id]))
  ]);
  const worshipExampleSections = wp.examples.map((p) => {
    const rows = p.examples.map((e) => [e.name || '—', `\`${e.id}\``, ll({ lat: e.lat, lon: e.lon }), e.religion || '—', e.tradition || '—']);
    return `**${p.id}** (${num(p.count)} buildings)\n\n${table(['name', 'durable ID', 'lat, lon', 'religion', 'tradition'], rows)}`;
  }).join('\n\n');
  const houseExampleRows = wp.houseExamples.map((e) => [e.name || '—', `\`${e.id}\``, ll({ lat: e.lat, lon: e.lon }), e.religion || '—', `\`${e.preset}\``]);
  const msExampleSections = out.examplePresets.filter((p) => p.id.startsWith('main-street-shop')).map((p) => {
    const rows = p.examples.map((e) => [`\`${e.id}\``, ll({ lat: e.lat, lon: e.lon }), e.era || '—', num(e.records)]);
    return `**${p.id}** (${num(p.count)} buildings)\n\n${table(['durable ID', 'lat, lon', 'era', 'records'], rows)}`;
  }).join('\n\n');

  return `# Building presets: every building's prototype, and the view that shows it

Bead \`st-ndw9.10\` (phase 1a) and \`st-ndw9.11\` of \`docs/building-prototypes-spec.md\`. Every building in the downtown
frame is given one of the catalogue's presets (\`js/building-prototypes.js\`), decided once on the build machine by
\`tools/build-building-presets.mjs\` and written to \`data/toronto-building-presets.bin\`, a small file the page fetches
only behind \`?massing=1&presets=1\`. A second file, \`data/toronto-building-presets-debug.bin\`, carries the facts the
debug view's identify panel shows and is fetched only behind \`?presets=debug\`. Nothing here changes how a building is
drawn in the normal view; drawing the presets is the next phase. Generated by
\`node tools/build-building-presets.mjs --md docs/building-presets.md\`; every number comes from its output.

## Inputs

- **\`tools/data/building-inputs.json\`** — the shared \`buildings/3\` facts per City 3D Massing part (form, house-scale,
  use class, area, heights, shop, address points), plus a **\`neighbourhood\`** column (the City neighbourhood number
  holding the part's centre, from \`derived/neighbourhood-era/1/neighbourhoods.geojson\`) and a **\`yearBuilt\`** column
  (the dataset's construction year where a source has one). ${num(c.records)} records.
- **\`tools/data/downtown-era-draft-1.json\`** — the hand-made split of house periods across the frame's neighbourhoods;
  a copy of the shared repo's \`build/neighbourhood-era/downtown-era-draft-1.json\`, byte for byte. It is an input that
  changes: John corrects neighbourhoods, the file is re-copied and the presets rebuilt.
- **\`data/toronto-massing.bin\`** — the sidecar, for the main-street flag on street edges, read through
  \`js/massing-data.js\` as the page does.
- **\`js/buildings.js\`** — its own shop-front rule (\`storefrontSelection\`, \`signedWalls\`, \`buildingFront\`,
  \`shopFrontRule\`), loaded here and called, so the assignment uses the same test the drawing does.
- **\`js/building-prototypes.js\`** — the catalogue (${PROTOTYPES.length} entries: ${out.perPreset.filter((p) => byId[p.id].family === 'house').length} houses, the rest blocks, offices, civic, worship, industry, a \`garage\` and a \`fallback\`).

## The rules

${rulesTable}

Where the table does not say how to choose between two presets, the simplest rule from the data is used: the storey
bands (\`js/buildings.js\` \`FLOOR_HEIGHTS[0]\` = ${out.storeyM} m), the sidecar's podium flag (\`base\` > 0), a school
name, and 5,000 m² for a civic block. Each is counted below.

## Main-street buildings

A **main-street building** is a building of five storeys or fewer whose front, by Slop's own shop-front rule
(\`js/buildings.js\`: a source-keyed sign, a mapped retail place of its own, or a retail strip on the street it fronts),
is a shop front — whatever its form or use class, except worship and civic (and so schools), which keep their own
presets. The main-street rule runs ahead of the house and use-class rules. By era: **${num(c.mainStreetEarly)}**
\`main-street-shop-early\` (Victorian & Edwardian) and **${num(c.mainStreetLater)}** \`main-street-shop-later\` (interwar
on), **${num(c.mainStreetBuildings)}** in all. **${num(c.tallerWithShop)}** taller buildings (over five storeys) with a
shop front keep their other preset.

Phase 1a's \`main-street-shop\` rule asked for an OpenStreetMap shop tag and a main street and found only
${num(PHASE1A['main-street-shop'])}; the shop-front rule is the one the city is drawn with. Where the main-street
buildings came from (their phase-1a preset):

${table(['phase-1a preset', 'buildings now main-street'], moveRows)}

The ten streets with the most main-street buildings (the nearest named road to the building's centre):

${table(['#', 'street', 'main-street buildings'], streetRows)}

A run of main-street buildings that share a wall is given **one** era, from the run's smallest durable id:
${num(c.msRuns)} runs hold ${num(c.msRunBuildings)} main-street buildings (largest ${num(c.msLargestRun)});
${num(c.msConnectedPairs)} shared walls joined a run.

## Buildings and records per preset

A **building** is one joined group; a preset applies to the whole group, so every record in it takes the same preset.
Totals: **${num(c.buildings)} buildings**, **${num(c.records)} records**. \`before\` is phase 1a's count (st-ndw9.10);
the six worship presets have no phase-1a count of their own (the one \`church\` preset held ${num(PHASE1A.church)}).

${table(['preset', 'name', 'family', 'era', 'before', 'buildings', 'share', 'records', 'share'], presetRows)}

## The era

A house building takes its construction year where a source dates any of its parts (${num(c.yearDatedBuildings)}
buildings), else its neighbourhood's draft split, drawn by the group's smallest durable id. Every part of a group
agrees, and the same building always gets the same era. A run of house buildings that share a wall is given **one**
era, from the run's smallest durable id: ${num(c.runs)} runs hold ${num(c.runBuildings)} house buildings (median run
${num(c.medianRun)}, largest ${num(c.largestRun)}); ${num(c.connectedPairs)} shared walls joined a run, and
${num(c.wallPairsAcrossNeighbourhood)} were left alone because the two buildings are in different neighbourhoods (a
changed split must move only its own neighbourhood). Main-street buildings take their era the same way and agree in
their own runs (above).

Of ${num(c.sharedWallPairs)} pairs of house buildings that share a wall, **${num(c.baseEraDisagreements)}**
(${pct(c.baseEraDisagreements, c.sharedWallPairs)}) would disagree without the run rule and **${num(c.runEraDisagreements)}**
(${pct(c.runEraDisagreements, c.sharedWallPairs)}) disagree with it.

The split actually drawn per neighbourhood against the draft's percentages (Victorian / Edwardian / interwar / postwar
/ recent). \`dated\` is the buildings whose own year won over the split; \`fallback\` the house buildings in a
neighbourhood not in the draft (they take the fallback era, **${out.fallbackEra}**).

${table(['nb', 'name', 'in draft', 'house buildings', 'draft split', 'drawn split', 'dated', 'fallback'], eraRows)}

## The fallback

**${num(c.fallbackBuildings)}** buildings (**${num(c.fallbackRecords)}** records,
${pct(c.fallbackBuildings, c.buildings)}) take the fallback (today's look): a building the rules cannot place, which is
one whose use class is \`other\` (not residential, and not business, apartments, civic, worship, industry or a shed).
By use / form:

${fbRows.length ? table(['use / form', 'buildings'], fbRows) : '_none._'}

House buildings in a neighbourhood not in the draft: **${num(c.fallbackEraBuildings)}**.

## Places of worship (st-ndw9.16)

A **place of worship** is a building the shared \`buildings/4\` dataset gives a religion (or whose use class is
worship). Of **${num(wp.groups)}** such buildings, **${num(wp.inHouse)}** are a congregation in a house (every part
house-scale) and keep their house preset; the other **${num(wp.presets)}** take one of six worship presets. The rule is
in \`worshipPreset\` (\`tools/build-building-presets.mjs\`), with its thresholds named in \`WORSHIP\`:

| input | rule |
|---|---|
| religion muslim | \`mosque\` |
| religion jewish | \`synagogue\` |
| religion buddhist, hindu or sikh | \`temple\` |
| every other religion (christian, or unnamed) | a church by year and size, below |
| a congregation in a house (every part house-scale) | its house preset (${num(wp.inHouse)} buildings) |

A church is dated by the group's own \`yearBuilt\` where a source has one (${num(wp.dated)} buildings), else by the
era its neighbourhood draws (${num(wp.era)} buildings; the era-to-year map is \`WORSHIP_ERA_YEAR\`), else it has no
year (${num(wp.undated)} buildings, in a neighbourhood outside the draft's houses unsplit):

| dated year | preset |
|---|---|
| before 1930 | \`church-gothic\` when the tradition is roman catholic, anglican, presbyterian or orthodox **or** the footprint is ${num(wp.thresholds.gothicMinFootprintM2)} m² or more; else \`church-chapel\` |
| 1930 to 1959 | \`church-chapel\` |
| 1960 on | \`church-modern\` |
| no year, footprint under ${num(wp.thresholds.undatedMinFootprintM2)} m² | \`church-chapel\` (probably a rectory or a shop named for its congregation) |
| no year, footprint ${num(wp.thresholds.undatedMinFootprintM2)} m² or more | as a pre-1930 church: gothic when the tradition is high church or the footprint is ${num(wp.thresholds.gothicMinFootprintM2)} m² or more, else chapel |

The era-to-year map takes the era's own place on the worship scale, not the house era's: the house draw calls most of
the old city "Victorian" (before 1900), which would call almost every undated downtown church Gothic. Victorian and
Edwardian (on the map before 1920) read as **${wp.eraYear.victorian}**, interwar as **${wp.eraYear.interwar}**
(chapel), postwar as **${wp.eraYear.postwar}** and recent as **${wp.eraYear.recent}** (modern).

Counts per preset (${num(wp.presets)} worship buildings):

${table(['preset', 'name', 'buildings', 'share'], worshipPresetRows)}

Religion across every worship group (in a house or not):

${table(['religion', 'groups'], religionRows)}

The cross-table of religion (and tradition) against preset, for the ${num(wp.presets)} worship buildings:

${table(['preset', 'religion / tradition', 'buildings'], crossRows)}

The footprint threshold moved 20% either way (\`gothicMinFootprintM2\` and \`undatedMinFootprintM2\` together; the
other presets do not move):

${table(['threshold', 'church-gothic', 'church-chapel', 'church-modern'], sensitivityRows)}

### Ten seeded examples per worship preset

${worshipExampleSections}

### Ten congregations in a house (they keep their house preset)

${table(['name', 'durable ID', 'lat, lon', 'religion', 'preset'], houseExampleRows)}

## Ten seeded examples per preset

A durable ID is \`to-3dmassing-2025:<fid>[.<k>]\`; lat and lon are six decimals from \`js/city-config.js\`
\`latLonFromWorld\`. Seeded by the preset id, so the same examples come out every run.

${exampleSections}

## The main-street examples (20)

${msExampleSections}

## Checks

- Every sidecar record has a preset: **${c.everySidecarRecordHasPreset ? 'yes' : 'no'}** (${num(c.records)} records).
- Catalogue ids are unique: **${c.presetIdsUnique ? 'yes' : 'no'}** (${PROTOTYPES.length} entries).
- House buildings: **${num(c.houseBuildings)}**; those carrying a house preset: **${num(c.housePresetBuildings)}**
  (they agree where the dataset's form is detached, semi or row for the whole group).
- Main-street buildings: **${num(c.mainStreetBuildings)}** (early ${num(c.mainStreetEarly)}, later ${num(c.mainStreetLater)});
  taller buildings with a shop front that keep their preset: **${num(c.tallerWithShop)}**.
- Rebuilding from the committed inputs and draft gives identical bytes (see \`tests/building-presets.test.mjs\`).

## Limits

- **This phase does not draw the presets.** The normal view is unchanged; \`?massing=1&presets=debug\` paints each
  polygon building its preset's debug colour (a flat map of the assignment), and adds the legend and identify panel.
- **Era is a draft, not a measurement.** The neighbourhood split is the coordinator's judgement (draft 1); the
  per-building years cover ${num(c.yearDatedBuildings)} house buildings. The drawn split is a draw from the draft, not
  a count of real construction dates. The main-street era split uses the same draft.
- **The run rule is bounded to a neighbourhood and to a kind** so a changed split moves only its own neighbourhood; two
  wall-sharing buildings in different neighbourhoods, or a house beside a shop, may still differ.
- **The shop-front rule is the drawing's**, so it inherits its limits: a mapped retail place is one source, a retail
  strip needs two mapped places within 30 m, and a sign is only where one was surveyed.
- **Presets are form-and-era only.** They do not yet set roofs, facades, palettes or parts; the catalogue holds no
  drawing parameters until the next phase.
`;
}

// ---- CLI ------------------------------------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const { values: opt } = parseArgs({ options: {
    out: { type: 'string', default: 'data/toronto-building-presets.bin' },
    debug: { type: 'string', default: 'data/toronto-building-presets-debug.bin' },
    md: { type: 'string', default: 'docs/building-presets.md' },
    examples: { type: 'string', default: '10' },
    quiet: { type: 'boolean', default: false }
  } });
  const P = await partition();
  const out = await run({ examples: Number(opt.examples), partitioned: P });
  const packed = pack(out);
  const file = path.resolve(ROOT, opt.out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, packed.file);
  const hash = (await import('node:crypto')).createHash('sha256').update(packed.file).digest('hex').slice(0, 12);
  const js = fs.readFileSync(path.join(ROOT, 'js/building-presets.js'), 'utf8');
  const next = js.replace(/(\.\/data\/toronto-building-presets\.bin\?v=)[0-9a-f]*/, `$1${hash}`);
  if (next === js && !js.includes(hash)) throw new Error('js/building-presets.js: no ./data/toronto-building-presets.bin?v= to set');
  if (next !== js) fs.writeFileSync(path.join(ROOT, 'js/building-presets.js'), next);

  const packedDebug = packDebug(out, P);
  const debugFile = path.resolve(ROOT, opt.debug);
  fs.writeFileSync(debugFile, packedDebug.file);
  const debugHash = (await import('node:crypto')).createHash('sha256').update(packedDebug.file).digest('hex').slice(0, 12);
  const djs = fs.readFileSync(path.join(ROOT, 'js/building-presets-debug.js'), 'utf8');
  const dnext = djs.replace(/(\.\/data\/toronto-building-presets-debug\.bin\?v=)[0-9a-f]*/, `$1${debugHash}`);
  if (dnext === djs && !djs.includes(debugHash)) throw new Error('js/building-presets-debug.js: no ./data/toronto-building-presets-debug.bin?v= to set');
  if (dnext !== djs) fs.writeFileSync(path.join(ROOT, 'js/building-presets-debug.js'), dnext);

  if (opt.md) fs.writeFileSync(path.resolve(ROOT, opt.md), renderMarkdown(out));
  const c = out.checks;
  if (!opt.quiet) {
    console.log(`records ${c.records}, buildings ${c.buildings}, presets ${PROTOTYPES.length}`);
    console.log(`main-street ${c.mainStreetBuildings} (early ${c.mainStreetEarly}, later ${c.mainStreetLater}), taller with a shop front ${c.tallerWithShop}`);
    console.log(`fallback ${c.fallbackBuildings} buildings, runs ${c.runs} (largest ${c.largestRun}), shared-wall era disagreements ${c.baseEraDisagreements} -> ${c.runEraDisagreements} of ${c.sharedWallPairs}`);
    console.log(`wrote ${path.relative(ROOT, file)} (${(packed.file.length / 1024).toFixed(1)} KiB, v=${hash}) and ${opt.md}`);
    console.log(`wrote ${path.relative(ROOT, debugFile)} (${(packedDebug.file.length / 1024).toFixed(1)} KiB, v=${debugHash})`);
  }
}
