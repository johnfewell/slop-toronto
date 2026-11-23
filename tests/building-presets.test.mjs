// st-ndw9.10: the building presets — the catalogue, the assignment, the file the page fetches. Reads committed data
// only. The expensive partition and run happen once at module load; the tests then assert its output and a second,
// cheaper assignment with a changed draft.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { unpackGeo } from '../js/geodata-loader.js';
import { rowCheck, massingRows } from '../js/massing-data.js';
import { loadBuildingPresets } from '../js/building-presets.js';
import { PROTOTYPES, byId, FALLBACK_ID, ERAS, eraOfYear, debugColor, FAMILY_HUES } from '../js/building-prototypes.js';
import vm from 'node:vm';
import { partition } from '../tools/report-building-forms.mjs';
import { OSM_CLASS } from '../tools/build-building-inputs.mjs';
import { run, pack, packDebug, assignPresets, assignPresetsPhase1a, PHASE1A } from '../tools/build-building-presets.mjs';
import { pickMassing, identifyFacts, readDebugFile, DEBUG_SCHEMA } from '../js/building-presets-debug.js';
import { drawFactsFrom } from '../js/building-presets.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = path.join(ROOT, 'data/toronto-building-presets.bin');
const DRAFT = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/data/downtown-era-draft-1.json'), 'utf8'));

const P = await partition();
const out = await run({ partitioned: P });
const GEO = P.GEO;

test('the catalogue: ids are unique and kebab-case, houses come first, fallback and garage exist', () => {
  const ids = PROTOTYPES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, id);
  assert.equal(ids[0], 'victorian-detached');
  assert.ok(byId.garage && byId[FALLBACK_ID], 'garage and fallback are in the catalogue');
  for (const p of PROTOTYPES) {
    assert.ok(FAMILY_HUES[p.family] != null, `${p.id}: known family`);
    assert.ok(Number.isInteger(p.color) && p.color >= 0 && p.color <= 0xffffff, `${p.id}: colour`);
    if (p.era) assert.ok(ERAS.some((e) => e.key === p.era), `${p.id}: era`);
  }
  // houses first
  const firstNonHouse = ids.findIndex((id) => byId[id].family !== 'house');
  assert.ok(PROTOTYPES.slice(0, firstNonHouse).every((p) => p.family === 'house'));
});

test('the debug palette: one hue family per family, lightness by era (older darker), every preset distinct', () => {
  // the era lightness must increase with the era order (older darker)
  const order = ['victorian', 'edwardian', 'interwar', 'postwar', 'recent'];
  const lum = (c) => ((c >> 16 & 255) + (c >> 8 & 255) + (c & 255)) / 3;
  for (const family of Object.keys(FAMILY_HUES)) {
    if (family === 'fallback') continue;
    const l = order.map((e) => lum(debugColor(family, e)));
    for (let i = 1; i < l.length; i++) assert.ok(l[i] > l[i - 1], `${family}: ${order[i]} lighter than ${order[i - 1]}`);
  }
  // the fallback is grey, and every preset's colour is distinct (so two presets of one family are told apart)
  assert.equal(debugColor('fallback', null) >> 16 & 255, debugColor('fallback', null) & 255);
  const colours = PROTOTYPES.map((p) => p.color);
  assert.equal(new Set(colours).size, colours.length, 'no two presets share a debug colour');
});

test('eraOfYear: the five periods', () => {
  assert.equal(eraOfYear(1899), 'victorian');
  assert.equal(eraOfYear(1900), 'edwardian');
  assert.equal(eraOfYear(1919), 'edwardian');
  assert.equal(eraOfYear(1920), 'interwar');
  assert.equal(eraOfYear(1939), 'interwar');
  assert.equal(eraOfYear(1940), 'postwar');
  assert.equal(eraOfYear(1979), 'postwar');
  assert.equal(eraOfYear(1980), 'recent');
  assert.equal(eraOfYear(2024), 'recent');
  assert.equal(eraOfYear(null), null);
});

test('every sidecar record has a valid preset, and every record of a building shares it', () => {
  assert.equal(out.checks.everySidecarRecordHasPreset, true);
  assert.equal(out.perRecord.length, P.inputs.records);
  assert.equal(out.perRecord.length, 35254);
  for (const v of out.perRecord) assert.ok(v >= 0 && v < PROTOTYPES.length, String(v));
  for (const g of P.buildings) {
    const first = out.perRecord[g.records[0].index];
    for (const r of g.records) assert.equal(out.perRecord[r.index], first, `${g.root}: all records one preset`);
  }
});

test('the presets file matches the committed inputs and draft: rebuilding gives identical bytes', () => {
  const packed = pack(out);
  assert.deepEqual(packed.file, fs.readFileSync(FILE), 'byte-identical rebuild');
});

test('the committed presets file validates against the sidecar (schema, records, rowCheck)', async () => {
  const { PRESETS } = await unpackGeo(fs.readFileSync(FILE));
  assert.equal(PRESETS.schema, 1);
  assert.equal(PRESETS.rowCheck, rowCheck(GEO.buildings));
  assert.equal(PRESETS.records, P.inputs.records);
  assert.deepEqual(PRESETS.ids, PROTOTYPES.map((p) => p.id));
  assert.equal(PRESETS.preset.length, P.inputs.records);
  assert.equal(new Set(PRESETS.ids).size, PRESETS.ids.length);
  assert.match(PRESETS.edition, /3DMassing/);
});

test('the era draw is group-consistent and stable', () => {
  // every house building has one era, drawn afresh the same way (assignPresets is pure)
  const again = assignPresets(P.buildings, DRAFT, OSM_CLASS, P.inputs.records, out.shopFronts);
  assert.deepEqual(Array.from(again.perRecord), Array.from(out.perRecord), 'same draft -> same presets');
  for (const g of P.buildings) {
    if (!g.house) continue;
    const era = out.eraOfBuilding.get(g.root);
    assert.ok(ERAS.some((e) => e.key === era), `${g.root}: an era`);
  }
  // the run rule makes wall-sharing houses agree (measured in the report); here, the run count is < the building count
  assert.ok(out.checks.runs <= out.checks.houseBuildings);
  assert.ok(out.checks.runEraDisagreements <= out.checks.baseEraDisagreements);
});

test('a changed split moves only buildings in that neighbourhood', () => {
  const nb = 86; // Roncesvalles: many house buildings, few dated
  const inNb = new Set(P.buildings.filter((g) => g.records.slice().sort((a, b) => (a.fid - b.fid) || (a.k - b.k))[0].neighbourhood === nb).map((g) => g.root));
  assert.ok(inNb.size > 100, `${inNb.size} house buildings in neighbourhood ${nb}`);
  const draft2 = JSON.parse(JSON.stringify(DRAFT));
  draft2.weights[nb].weights = [0, 0, 0, 0, 100]; // all recent now
  const moved = assignPresets(P.buildings, draft2, OSM_CLASS, P.inputs.records, out.shopFronts);
  let changed = 0;
  const changedRoots = new Set();
  for (const g of P.buildings) {
    const before = out.perRecord[g.records[0].index], after = moved.perRecord[g.records[0].index];
    if (before !== after) { changed++; changedRoots.add(g.root); }
  }
  assert.ok(changed > 0, 'the change moved some buildings');
  for (const root of changedRoots) assert.ok(inNb.has(root), `building ${root} outside neighbourhood ${nb} moved`);
  // and a neighbourhood not in the draft is unchanged by this
  const other = assignPresets(P.buildings, DRAFT, OSM_CLASS, P.inputs.records, out.shopFronts);
  for (let i = 0; i < out.perRecord.length; i++) assert.equal(other.perRecord[i], out.perRecord[i]);
});

test('the checked-in file is small enough to fetch with the polygons', () => {
  const bytes = fs.statSync(FILE).size;
  assert.ok(bytes < 100 * 1024, `${(bytes / 1024).toFixed(1)} KiB`);
});

test('the runtime loader attaches every polygon record its preset, and refuses another sidecar', async () => {
  const { MASSING } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
  const loaded = massingRows(MASSING, GEO);
  const bytes = fs.readFileSync(FILE);
  const body = new Uint8Array(bytes).buffer;
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, url: 'presets', arrayBuffer: async () => body });
  try {
    const p = await loadBuildingPresets(loaded, GEO, 'presets');
    assert.equal(p.error, null);
    assert.equal(p.attached, loaded.rows.size);
    assert.deepEqual(p.ids, PROTOTYPES.map((x) => x.id));
    for (const rec of loaded.rows.values()) {
      assert.equal(rec.preset, PROTOTYPES[out.perRecord[rec.index]].id, `record ${rec.index}`);
      assert.ok(byId[rec.preset], rec.preset);
    }
    // a sidecar the file was not built for is refused whole, and nothing is attached
    const fake = { rows: new Map([[0, { index: 0 }]]), records: 1, error: null };
    const refused = await loadBuildingPresets(fake, GEO, 'presets');
    assert.match(refused.error, /another sidecar/);
    assert.equal(refused.attached, 0);
    assert.equal(fake.rows.get(0).preset, undefined);
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// st-ndw9.11: the main-street split, the shared shop-front rule, and the debug identify file
// ---------------------------------------------------------------------------------------------------------------------
const STOREFRONTS = (() => {
  const c = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/toronto-storefronts.js'), 'utf8'), c);
  return c.window.CITY.STOREFRONTS;
})();
// js/buildings.js's own rule functions, loaded the way the storefront tests load them
const RULE = (() => {
  const window = { CITY: { THREE: {}, Addons: {}, TSL: {}, GEO, CITY_BOUNDS: {}, nearestRoads: P.nearestRoads, STOREFRONTS } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/buildings.js'), 'utf8'), { window, console });
  return window.CITY;
})();
const MASSING_LOADED = massingRows((await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')))).MASSING, GEO);

test('the catalogue has the two main-street presets and the old one is gone', () => {
  assert.ok(byId['main-street-shop-early'] && byId['main-street-shop-later'], 'both main-street presets exist');
  assert.equal(byId['main-street-shop'], undefined, 'the single main-street-shop preset is replaced');
  assert.equal(byId['main-street-shop-early'].family, 'main-street');
  assert.equal(byId['main-street-shop-later'].family, 'main-street');
});

test('the main-street split is by era: early is Victorian & Edwardian, later is interwar on', () => {
  assert.ok(out.checks.mainStreetBuildings > 0);
  assert.equal(out.checks.mainStreetBuildings, out.checks.mainStreetEarly + out.checks.mainStreetLater);
  assert.equal(out.checks.mainStreetBuildings, out.msSet.size);
  for (const g of P.buildings) {
    if (!out.msSet.has(g.root)) continue;
    const era = out.msEra.get(g.root);
    const id = out.presetOfBuilding.get(g.root);
    const early = id === 'main-street-shop-early';
    assert.equal(early, era === 'victorian' || era === 'edwardian', `${g.root}: ${id} / ${era}`);
  }
  // a main-street building is a shop front by Slop's rule, five storeys or fewer, and not worship/civic
  for (const g of out.msSet) {
    const grp = P.buildings.find((x) => x.root === g);
    assert.equal(out.shopFronts.get(grp.root).shopFront, true, `${grp.root}: shop front`);
    assert.ok(grp.maxHeight / 3.4 <= 5, `${grp.root}: <= 5 storeys`);
    assert.ok(grp.osmClass !== OSM_CLASS.worship && grp.osmClass !== OSM_CLASS.civic, `${grp.root}: not worship/civic`);
  }
});

test('the phase-1a reproduction matches the committed before column, so the moves table is real', () => {
  const before = assignPresetsPhase1a(P.buildings, DRAFT, OSM_CLASS);
  const counts = {};
  for (const g of P.buildings) { const b = before.get(g.root); counts[b] = (counts[b] || 0) + 1; }
  for (const [id, n] of Object.entries(PHASE1A)) assert.equal(counts[id] || 0, n, `${id} before`);
  assert.equal(Object.values(counts).reduce((s, n) => s + n, 0), P.buildings.length);
  // every main-street building was some other preset before, and the moves sum to the main-street count
  const moved = P.buildings.filter((g) => out.msSet.has(g.root));
  assert.equal(moved.length, out.checks.mainStreetBuildings);
  const moveSum = Object.values(out.moves).reduce((s, n) => s + n, 0);
  assert.equal(moveSum, out.checks.mainStreetBuildings);
});

test('the shared shop-front rule is js/buildings.js\'s own, applied by the assignment on every building', () => {
  // re-derive each group's shop front straight from buildings.js's functions, and compare with computeShopFronts
  const retail = RULE.storefrontSelection(GEO.pois);
  const signWalls = RULE.signedWalls(STOREFRONTS);
  const mine = new Map();
  for (const g of P.buildings) {
    let shop = false;
    for (const r of g.records) {
      const b = GEO.buildings[r.row];
      const signed = signWalls.get(r.row);
      const { front, near } = RULE.buildingFront(b[0], b[1], b[2], signed, P.nearestRoads);
      const res = RULE.shopFrontRule({ signed, own: retail.own.has(r.row), kind: b[5], front, parts: b[3], cx: b[0], cz: b[1], ang: b[2], near, retail, nearestRoads: P.nearestRoads });
      if (res.shopFront) shop = true;
    }
    mine.set(g.root, shop);
  }
  for (const g of P.buildings) assert.equal(out.shopFronts.get(g.root).shopFront, mine.get(g.root), `${g.root}: shop front agrees`);
  // and the rule itself: signed, own retail, retail strip, and neither
  const near = [{ road: { name: 'Queen Street West' }, px: 0, pz: -5, dist: 5 }];
  const parts = [[-2, 2, -3, 3]];
  const retailMock = { own: new Set(), onStrip: () => true };
  const nearestRoads = (x, z, r) => (r > 50 ? near : [{ road: { name: 'Queen Street West' } }]);
  const rule = (o) => ({ ...RULE.shopFrontRule(o) }); // (spread out of the vm realm so deepEqual's prototypes match)
  assert.deepEqual(rule({ signed: new Set([0]), own: false, kind: 0, front: 0, parts, cx: 0, cz: 0, ang: 0, near, retail: retailMock, nearestRoads }), { shopFront: true, strip: false });
  assert.deepEqual(rule({ signed: undefined, own: true, kind: 0, front: 0, parts, cx: 0, cz: 0, ang: 0, near, retail: retailMock, nearestRoads }), { shopFront: true, strip: false });
  assert.deepEqual(rule({ signed: undefined, own: true, kind: 4, front: 0, parts, cx: 0, cz: 0, ang: 0, near, retail: retailMock, nearestRoads }), { shopFront: false, strip: false }); // own on a shed (kind 4): not a shop front
  assert.deepEqual(rule({ signed: undefined, own: false, kind: 0, front: 0, parts, cx: 0, cz: 0, ang: 0, near, retail: retailMock, nearestRoads }), { shopFront: true, strip: true });
  assert.deepEqual(rule({ signed: undefined, own: false, kind: 5, front: 0, parts, cx: 0, cz: 0, ang: 0, near, retail: retailMock, nearestRoads }), { shopFront: false, strip: false });
});

test('the identify file: schema, counts, size under 400 KB, and facts that match the assignment', async () => {
  const DBG = fs.readFileSync(path.join(ROOT, 'data/toronto-building-presets-debug.bin'));
  assert.ok(DBG.length < 400 * 1024, `${(DBG.length / 1024).toFixed(1)} KiB`);
  const { DEBUG } = await unpackGeo(DBG);
  assert.equal(DEBUG.schema, DEBUG_SCHEMA);
  // the module's own validator (async: unpackGeo inflates) accepts the file against this massing and GEO
  const validated = await readDebugFile(new Uint8Array(DBG).buffer, MASSING_LOADED, GEO);
  assert.equal(validated.schema, DEBUG_SCHEMA);
  await assert.rejects(readDebugFile(new Uint8Array(DBG).buffer, { ...MASSING_LOADED, records: 1 }, GEO), /another sidecar/);
  assert.equal(DEBUG.records, P.inputs.records);
  assert.equal(DEBUG.groups, P.buildings.length);
  assert.equal(DEBUG.rowCheck, rowCheck(GEO.buildings));
  assert.equal(DEBUG.groupOfRecord.length, P.inputs.records);
  assert.deepEqual(packDebug(out, P).file, DBG, 'byte-identical debug rebuild from the committed inputs');
  // the identify facts for a building match the assignment's own preset, era and basis
  const msBuildings = P.buildings.filter((g) => out.msSet.has(g.root)).slice(0, 40);
  assert.ok(msBuildings.length > 0);
  for (const g of msBuildings) {
    const rec = massingRows0(g);
    const facts = identifyFacts(DEBUG, GEO, MASSING_LOADED, PROTOTYPES.map((p) => p.id), out.perRecord, rec.row);
    assert.ok(facts, `${g.root}: a fact card`);
    assert.equal(facts.presetId, out.presetOfBuilding.get(g.root), `${g.root}: preset`);
    assert.equal(facts.id, rec.id, `${g.root}: durable id`);
    assert.ok(['detached', 'semi', 'row', 'other', 'outbuilding'].includes(facts.form), facts.form);
    assert.ok(Number.isInteger(facts.dwellings), 'dwellings');
    assert.match(facts.era, /year|split|draft|—/, facts.era);
  }
  // pickMassing: a ray straight down over a building's centre finds a building whose ring holds that point
  const sample = msBuildings[0];
  const b = GEO.buildings[sample.records[0].row];
  const row = pickMassing(MASSING_LOADED, GEO, { x: b[0], y: (b[4] || 0) + 60, z: b[1] }, { x: 0, y: -1, z: 0 });
  assert.ok(row != null, 'a building is under the ray');
  const outer = MASSING_LOADED.rows.get(row).rings[0];
  let inside = false;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const [xi, zi] = outer[i], [xj, zj] = outer[j];
    if ((zi > b[1]) !== (zj > b[1]) && b[0] < ((xj - xi) * (b[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  assert.ok(inside, 'the picked row contains the point');
});

// the group's representative massing row and durable id (the same choice the assignment and the debug file use)
function massingRows0(g) {
  const r = g.records.slice().sort((a, b) => (a.fid - b.fid) || (a.k - b.k))[0];
  return { row: r.row, id: `to-3dmassing-2025:${r.fid}${r.k ? '.' + r.k : ''}` };
}

test('the draw facts read the committed debug file, so ?presets=draw and ?gallery=presets keep working (st-ndw9.16)', async () => {
  // (the debug file's schema went 1 -> 2 with the worship columns; the drawing reads it for the groups and dwellings,
  // which did not move, so its loader must accept schema 2 too or the house presets stop being drawn silently)
  const DBG = fs.readFileSync(path.join(ROOT, 'data/toronto-building-presets-debug.bin'));
  const { DEBUG } = await unpackGeo(DBG);
  const facts = drawFactsFrom(DEBUG, MASSING_LOADED, GEO, { ids: PROTOTYPES.map((p) => p.id), preset: out.perRecord });
  assert.equal(facts.error, null, 'the committed debug file is accepted by the drawing');
  assert.equal(facts.facts.size, P.inputs.records, 'every record has its group and dwellings');
  // every preset has a count, and the six worship presets are in it (st-ndw9.20 draws them: each carries drawing parameters)
  for (const p of PROTOTYPES) assert.ok(Number.isInteger(facts.counts[p.id]), `count for ${p.id}`);
  for (const id of ['church-gothic', 'church-chapel', 'church-modern', 'mosque', 'synagogue', 'temple']) {
    assert.ok(facts.counts[id] > 0, `${id} has buildings`);
    assert.equal(byId[id].draw.kind, 'worship', `${id} is drawn as a place of worship`);
  }
});

test('the debug module and its file are loaded only in debug mode', () => {
  const main = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'explore.html'), 'utf8');
  const presets = fs.readFileSync(path.join(ROOT, 'js/building-presets.js'), 'utf8');
  assert.match(main, /import\('\.\/building-presets-debug\.js'\)/, 'main.js imports the debug module');
  assert.match(main, /__PRESETS_DEBUG/, 'and only behind the debug flag');
  assert.doesNotMatch(html, /building-presets-debug\.js/, 'the debug module is not an eager page script');
  assert.doesNotMatch(presets, /building-presets-debug/, 'the presets loader does not pull in the debug module');
  const debugSrc = fs.readFileSync(path.join(ROOT, 'js/building-presets-debug.js'), 'utf8');
  assert.match(debugSrc, /toronto-building-presets-debug\.bin/, 'the debug file is fetched by the debug module');
});
