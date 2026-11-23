// tools/report-building-forms.mjs — st-ndw9.5: rank the city's buildings by FORM, taken from the shared Toronto data
// repo's buildings/3 dataset through tools/data/building-inputs.json, not from any rule of this script's own.
//
// Reads committed data only: js/toronto-geodata.js, js/toronto-geodata-ids.js, data/toronto-massing.bin (through
// js/massing-data.js) and tools/data/building-inputs.json (tools/build-building-inputs.mjs). No raw cache is read, so
// the report builds on a fresh checkout. Nothing the page loads is changed.
//
// usage: node tools/report-building-forms.mjs [--json <path>] [--md <path>] [--examples N] [--quiet]
//
// =====================================================================================================================
// WHAT COMES FROM WHERE — the inputs file holds the dataset's own answers; this script only names and ranks them.
// =====================================================================================================================
// The dataset supplies, per City 3D Massing part: houseScale, dwellings, form (detached / semi / row for a house-scale
// group, outbuilding, or other), the OpenStreetMap use class, and the joined group. A building is one joined group. A
// house building is a group whose form is detached, semi or row (the dataset's own three house forms).
//
// The house test is buildings/3's (the inputs file's `parameters`, read from the dataset's manifest):
//   footprint per address point < 250 m² (the area over max(address points, 1))
//   total footprint < 800 m²
//   canopy-robust height < 11 m (MIN_HEIGHT when recorded, else the median of house-shaped neighbours, else AVG_HEIGHT)
//   the use class is not business / worship / civic / industrial / shed / apartments, it is not a shop, and it is not an
//   outbuilding.
// The sensitivity table re-derives this rule with each numeric threshold moved ±20%; its base reproduces the dataset's
// `houseScale` flag. The thresholds are never constants here: they come from the inputs file's `parameters`.
//
//   STOREY_M                 3.4 m    (the dataset's parameters.storeyM; js/buildings.js FLOOR_HEIGHTS[0])
//   HEIGHT_BANDS             h1 < 1.5, h2 1.5–2.5, h3 2.5–3, h4 3–5, h5 5–13, h6 13+ storeys (from MAX_HEIGHT)
//   AREA_BANDS               a1 < 200, a2 200–500, a3 500–1,500, a4 1,500–5,000, a5 5,000–20,000, a6 20,000+ m²
//   TOP HEIGHT               MAX_HEIGHT, or AVG_HEIGHT where MAX_HEIGHT is 0
//   NON-HOUSE FORM           height band (tallest MAX_HEIGHT) + area band (total footprint) + podium + main street +
//                            shop front + use class. The use class comes from the shared dataset.
// =====================================================================================================================

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import { pick, KIND_NAMES, FLOOR_M } from './report-building-classes.mjs';
import { OSM_CLASS, OSM_CLASS_NAMES } from './build-building-inputs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
export const SELF_ = SELF;

export const STOREY_M = FLOOR_M;
export const HEIGHT_BANDS = [
  { id: 'h1', min: -Infinity, max: 1.5 },
  { id: 'h2', min: 1.5, max: 2.5 },
  { id: 'h3', min: 2.5, max: 3 },
  { id: 'h4', min: 3, max: 5 },
  { id: 'h5', min: 5, max: 13 },
  { id: 'h6', min: 13, max: Infinity }
];
export const AREA_BANDS = [
  { id: 'a1', min: -Infinity, max: 200 },
  { id: 'a2', min: 200, max: 500 },
  { id: 'a3', min: 500, max: 1500 },
  { id: 'a4', min: 1500, max: 5000 },
  { id: 'a5', min: 5000, max: 20000 },
  { id: 'a6', min: 20000, max: Infinity }
];
export const OUTBUILDING = { maxArea: 60, maxHeight: 5 };
export const FORM_FAMILIES = ['detached', 'semi', 'row', 'low-rise', 'mid-rise', 'tower', 'outbuilding', 'industrial', 'worship', 'civic', 'other'];
export const HOUSE_FORMS = ['detached', 'semi', 'row'];
export const BAND_LABEL = { h1: 'under 1.5', h2: '1.5–2.5', h3: '2.5–3', h4: '3–5', h5: '5–13', h6: '13+' };
export const OSM_DISPLAY = { none: 'unmapped', house: 'residential', business: 'commercial', worship: 'worship', civic: 'institutional', industrial: 'industrial', shed: 'outbuilding', apartments: 'apartments', other: 'other' };
export const AREA_LABEL = { a1: 'under 200', a2: '200–500', a3: '500–1,500', a4: '1,500–5,000', a5: '5,000–20,000', a6: '20,000+' };

// The two earlier runs this one is compared against. Their numbers are those runs' committed outputs (st-ndw9.3's
// docs/building-forms.md at PR #155, and this bead's first run with buildings/2); the old inputs are not read here.
export const PREVIOUS = {
  st103: {
    label: 'st-ndw9.3 (PR #155)',
    records: 35254, buildings: 22855, houseBuildings: 16095, houseRecords: 17723, nonHouseBuildings: 6760, nonHouseRecords: 17531,
    totalAreaM2: 11960369, detached: 9050, semi: 5745, row: 1300, houseScaleRecords: 19638,
    crossTotals: { house: 16073, 'low-rise': 3672, 'mid-rise': 9503, tower: 3981, shed: 328, works: 88, worship: 300, civic: 1309 },
    houseScaleByKind: { house: 12575, 'low-rise': 1282, 'mid-rise': 3792, tower: 13, shed: 51, works: 10, worship: 0, civic: 0 }
  },
  buildings2: {
    label: 'buildings/2 (this bead, first run)',
    records: 35254, buildings: 22737, houseBuildings: 15922, houseRecords: 17634, nonHouseBuildings: 6815, nonHouseRecords: 17620,
    totalAreaM2: 11955230, detached: 8850, semi: 5736, row: 1336, houseScaleRecords: 19468,
    crossTotals: { house: 16073, 'low-rise': 3672, 'mid-rise': 9503, tower: 3981, shed: 328, works: 88, worship: 300, civic: 1309 },
    houseScaleByKind: { house: 12516, 'low-rise': 1277, 'mid-rise': 3783, tower: 13, shed: 35, works: 10, worship: 0, civic: 0 }
  }
};
const bandOf = (storeys, bands = HEIGHT_BANDS) => bands.find((b) => storeys >= b.min && storeys < b.max) || bands[bands.length - 1];
const areaBandOf = (area) => AREA_BANDS.find((b) => area >= b.min && area < b.max) || AREA_BANDS[AREA_BANDS.length - 1];
const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : null; };
const round = (v, d = 1) => (v == null ? null : +Number(v).toFixed(d));
const pct = (v, d = 2) => (v == null ? null : +(v * 100).toFixed(d));
const hashStr = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };

/** The house test's thresholds from the inputs file's `parameters` (never constants in this script). */
export function houseRule(parameters) {
  return {
    maxPerDwelling: parameters.houseMaxPerDwellingM2,
    maxArea: parameters.houseMaxAreaM2,
    maxHeight: parameters.houseMaxHeightM,
    excludeOsm: (parameters.excludeOsm || []).map((name) => OSM_CLASS[name] ?? OSM_CLASS.other)
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The partition: records -> buildings, from the dataset's own answers
// ---------------------------------------------------------------------------------------------------------------------
/** buildings/3's house-scale rule, re-derived from the dataset's fields so the sensitivity table can move its three
 * numeric thresholds. At the base thresholds it reproduces the dataset's `houseScale` flag exactly. */
export function isHouseScale(rec, rule) {
  if (!(rec.area / Math.max(rec.addressPoints, 1) < rule.maxPerDwelling)) return false;
  if (!(rec.area < rule.maxArea)) return false;
  if (!(rec.canopyHeight < rule.maxHeight)) return false;
  if (rule.excludeOsm.includes(rec.osmClass)) return false;
  return !rec.shop && !rec.outbuilding;
}

/** The coarse family a non-house group falls in, from its use class and the tallest part's MAX_HEIGHT. */
export function nonHouseFamily(group) {
  const cls = group.osmClass;
  if (cls === OSM_CLASS.worship) return 'worship';
  if (cls === OSM_CLASS.civic) return 'civic';
  if (cls === OSM_CLASS.industrial) return 'industrial';
  if (cls === OSM_CLASS.shed) return 'outbuilding';
  if (cls === OSM_CLASS.apartments) return group.heightBand === 'h6' ? 'tower' : group.heightBand === 'h5' ? 'mid-rise' : 'low-rise';
  if (group.streets === 0 && group.totalArea <= OUTBUILDING.maxArea && group.maxHeight < OUTBUILDING.maxHeight) return 'outbuilding';
  const band = group.heightBand;
  if (band === 'h6') return 'tower';
  if (band === 'h5') return 'mid-rise';
  if (band === 'h4') return 'low-rise';
  if (band === 'h3') return 'low-rise';
  return 'outbuilding';
}

/** The readable non-house form: every attribute the brief asks for, in one string. */
export function nonHouseForm(group) {
  const parts = [
    `${BAND_LABEL[group.heightBand]} storeys`,
    `${AREA_LABEL[group.areaBand]} m²`,
    group.podium ? 'podium' : null,
    group.mainStreet ? 'main street' : 'side street',
    group.shop ? 'shop front' : null,
    OSM_DISPLAY[OSM_CLASS_NAMES[group.osmClass]] || 'other'
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * Builds records from the committed geodata and massing sidecar, and takes house-scale, dwellings, form, use class and
 * the joined group from tools/data/building-inputs.json (one array per column, in sidecar order). Every record lands in
 * exactly one building: one joined group. The house rule comes from the inputs file's parameters.
 */
export async function partition({ rule = null } = {}) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/city-config.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata-ids.js'), 'utf8'), ctx);
  const { GEO, latLonFromWorld } = ctx.window.CITY;
  const { GEO_IDS } = ctx.window.CITY;

  const inputs = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/data/building-inputs.json'), 'utf8'));
  const D = inputs.data, E = inputs.enums;
  const fid = new Array(inputs.records);
  let f = 0;
  for (let i = 0; i < inputs.records; i++) { f += D.fidDelta[i]; fid[i] = f; }
  if (fid[0] !== inputs.fidFirst) throw new Error('tools/data/building-inputs.json: fidFirst disagrees with fidDelta[0]');
  const at = (col, i) => D[col][i];
  const ruleUsed = rule || houseRule(inputs.parameters);

  const { MASSING: M } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
  const loaded = massingRows(M, GEO);
  if (loaded.error) throw new Error(loaded.error);

  const recs = [];
  let datasetFlagAgrees = 0, datasetFlagDisagrees = 0;
  for (let i = 0; i < M.fid.length; i++) {
    const r = loaded.rows.get(M.row[i]);
    if (!r) continue; // (a record the sidecar left on its boxes)
    const row = M.row[i], b = GEO.buildings[row];
    const use = E.use[at('use', i)] || 'none';
    const osmClass = OSM_CLASS[use] ?? OSM_CLASS.other;
    const t = (col) => at(col, i) / 10; // (tenths in the file)
    const rec = {
      row, index: i, fid: fid[i], k: at('k', i), id: GEO_IDS.buildings[row], rings: r.rings, outer: r.rings[0], street: r.street, base: t('base'),
      covered: r.covered, // (st-ndw9.10: the party edges, for the neighbour-agreement measure)
      cx: b[0], cz: b[1], h: b[4], kind: b[5], name: b[9] || '',
      // (the dataset's fields, decoded from the compact file)
      area: t('area'), depth: t('depth'), maxHeight: t('maxHeight'), avgHeight: t('avgHeight'),
      canopyHeight: t('canopyHeight'), addressPoints: at('addressPoints', i),
      osmClass, use, shop: at('shop', i) === 1, outbuilding: at('outbuilding', i) === 1,
      houseScaleFlag: at('houseScale', i) === 1, dwellings: at('dwellings', i),
      formField: E.form[at('form', i)],
      // (st-ndw9.10: the two columns the preset assignment adds; absent from an older file, then null)
      neighbourhood: D.neighbourhood ? D.neighbourhood[i] : null,
      yearBuilt: D.yearBuilt ? D.yearBuilt[i] : null,
      // (st-ndw9.16: buildings/4's worship fields, as names or null, and whether the part stands on a school ground)
      religion: D.religion && D.religion[i] >= 0 ? inputs.worshipEnums.religion[D.religion[i]] : null,
      tradition: D.tradition && D.tradition[i] >= 0 ? inputs.worshipEnums.tradition[D.tradition[i]] : null,
      schoolGround: D.schoolGround ? D.schoolGround[i] === 1 : false,
      groupId: at('group', i) < 0 ? `one:${i}` : `group:${at('group', i)}`
    };
    // (some records carry no maximum (0), only an average: the build uses the average as the top, as geo-features does)
    rec.top = rec.maxHeight >= 2.5 ? rec.maxHeight : (rec.avgHeight || rec.h);
    rec.shorter = rec.depth;
    let frontage = 0, streets = 0, main = false;
    for (const [e, isMain] of rec.street) {
      const n = rec.outer.length;
      frontage += Math.hypot(rec.outer[(e + 1) % n][0] - rec.outer[e][0], rec.outer[(e + 1) % n][1] - rec.outer[e][1]);
      streets++; if (isMain) main = true;
    }
    rec.frontage = frontage; rec.streets = streets; rec.mainStreet = main;
    rec.podium = rec.base > 0;
    rec.storeys = rec.h / STOREY_M;
    // (the dataset's own flag is the answer; the re-derived rule is only the sensitivity table's control)
    rec.houseScale = rec.houseScaleFlag;
    rec.houseScaleRederived = isHouseScale(rec, ruleUsed);
    if (rec.houseScaleRederived === rec.houseScaleFlag) datasetFlagAgrees++; else datasetFlagDisagrees++;
    recs.push(rec);
  }
  recs.sort((a, b) => a.row - b.row);

  const byRoot = new Map();
  for (const r of recs) {
    let g = byRoot.get(r.groupId);
    if (!g) byRoot.set(r.groupId, (g = { root: r.groupId, records: [] }));
    g.records.push(r);
  }
  const buildings = [];
  let formInconsistent = 0;
  for (const g of byRoot.values()) {
    g.records.sort((a, b) => a.row - b.row);
    const allHouse = g.records.every((r) => r.houseScale);
    let tallest = g.records[0];
    for (const r of g.records) if (r.top > tallest.top) tallest = r;
    g.size = g.records.length;
    g.tallest = tallest;
    g.totalArea = g.records.reduce((s, r) => s + r.area, 0);
    g.addressTotal = g.records.reduce((s, r) => s + r.addressPoints, 0);
    g.dwellings = Math.max(...g.records.map((r) => r.dwellings || 0));
    g.streets = g.records.reduce((s, r) => s + r.streets, 0);
    g.maxHeight = Math.max(...g.records.map((r) => r.top));
    g.heightBand = bandOf(g.maxHeight / STOREY_M).id;
    g.areaBand = areaBandOf(g.totalArea).id;
    g.podium = g.records.some((r) => r.podium);
    g.mainStreet = g.records.some((r) => r.mainStreet);
    g.shop = g.records.some((r) => r.shop);
    g.osmClass = tallest.osmClass ?? g.records.find((r) => r.osmClass != null)?.osmClass ?? OSM_CLASS.none;
    // (st-ndw9.16: the worship fields are per group in buildings/4, so any part with a religion speaks for the group)
    const faith = g.records.find((r) => r.religion != null) || null;
    g.religion = faith ? faith.religion : null;
    g.tradition = faith && faith.tradition != null ? faith.tradition : null;
    g.worshipish = g.religion != null || g.osmClass === OSM_CLASS.worship;
    g.schoolGround = g.records.some((r) => r.schoolGround);
    // (the dataset gives one form per group; a disagreement would be a dataset bug worth a count)
    const forms = new Set(g.records.map((r) => r.formField));
    if (forms.size > 1) formInconsistent++;
    g.formField = tallest.formField;
    g.house = HOUSE_FORMS.includes(g.formField);
    g.allHouseScale = allHouse;
    g.school = g.records.some((r) => /school|college|university|academy|institute/i.test(r.name));
    g.width = g.records.reduce((s, r) => s + r.frontage, 0) || Math.max(...g.records.map((r) => r.shorter));
    g.storeys = allHouse ? (g.records.reduce((s, r) => s + (r.avgHeight ?? r.h), 0) / g.records.filter((r) => (r.avgHeight ?? r.h) != null).length) / STOREY_M : g.maxHeight / STOREY_M;
    if (g.house) {
      g.form = g.formField;
      g.family = g.formField;
      g.formId = `house ${g.form}`;
    } else if (g.formField === 'outbuilding') {
      g.form = 'outbuilding';
      g.family = 'outbuilding';
      g.formId = 'outbuilding';
    } else {
      g.family = nonHouseFamily(g);
      g.form = nonHouseForm(g);
      g.formId = g.form;
    }
    buildings.push(g);
  }
  return { GEO, latLonFromWorld, GEO_IDS, inputs, parameters: inputs.parameters, rule: ruleUsed, recs, buildings, datasetFlagAgrees, datasetFlagDisagrees, formInconsistent, nearestRoads: ctx.window.CITY.nearestRoads };
}

// ---------------------------------------------------------------------------------------------------------------------
// Checks, histograms, and the report object
// ---------------------------------------------------------------------------------------------------------------------
const ADDRESS_EXPECTED = { '0': 1918, '1': 7983, '2': 4800, '3': 703, '4': 319, '5+': 350 };
const KENSINGTON = [[-1147.51, -1778.44], [-1995.31, -1784.14], [-1948.04, -1253.38], [-1117.34, -1218.66]];
function inRing(x, z, ring) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) yes = !yes;
  }
  return yes;
}
const bins = (list, get, edges) => { const counts = new Array(edges.length + 1).fill(0); for (const r of list) { let k = edges.findIndex((e) => get(r) < e); if (k < 0) k = edges.length; counts[k]++; } return { edges, counts }; };
const addressBucket = (n) => (n >= 5 ? '5+' : String(n));

/** The preset from section 4 of the spec that a form most resembles, or 'none'. Era is not known, so this is form-only. */
export function suggestPreset(form) {
  const f = form.family;
  const s = form.medianStoreys ?? form.storeys ?? 0;
  const area = form.medianArea ?? form.totalArea ?? 0;
  if (f === 'detached') {
    if (s < 1.75) return "Postwar bungalow";
    if (s < 2.4) return "Wartime one-and-a-half-storey house";
    if (s < 3.2) return "Interwar brick detached";
    return "Large replacement house (stone and stucco, 2000s)";
  }
  if (f === 'semi') {
    if (s >= 3) return "Victorian bay-and-gable semi";
    return "Edwardian semi";
  }
  if (f === 'row') {
    if (s >= 3) return "Victorian bay-and-gable row";
    return "Modern townhouse row";
  }
  if (f === 'worship') return "Church";
  if (f === 'civic') {
    if (form.school) return "School";
    if (s >= 5 || area >= 5000) return "Institutional block (hospital, university)";
    return "Small civic building (fire hall, library, community centre)";
  }
  if (f === 'industrial') {
    if (s <= 2) return area >= 2000 ? "Big-box store or supermarket" : "Low industrial shed";
    return "Brick-and-beam warehouse";
  }
  if (f === 'outbuilding') return area <= 60 ? "Lane garage" : "Laneway or garden suite";
  if (f === 'tower') {
    if (form.osmClass === OSM_CLASS.business || form.osmClass === OSM_CLASS.other) return "Dark curtain-wall office tower";
    if (form.podium) return "Glass condo tower on a podium";
    return "Concrete condo tower, 1970s to 1980s";
  }
  if (f === 'mid-rise') {
    if (form.shop && form.mainStreet) return "New mid-rise with shops at grade (six to twelve storeys)";
    return "Interwar walk-up apartment";
  }
  if (f === 'low-rise') {
    if (form.shop && form.mainStreet) return s <= 1.5 ? "One-storey retail strip" : "Shop with flats above (two to three storeys, brick, cornice)";
    if (s <= 2) return "Co-op or social-housing low-rise block";
    return "Interwar walk-up apartment";
  }
  return "none";
}

export async function run({ examples = 12 } = {}) {
  const { GEO, latLonFromWorld, GEO_IDS, inputs, parameters, rule, recs, buildings, datasetFlagAgrees, datasetFlagDisagrees, formInconsistent } = await partition();

  // ---- partition check: every record in exactly one building, and the sums agree ----
  const buildingsByRecord = new Map();
  for (const g of buildings) for (const r of g.records) {
    if (buildingsByRecord.has(r.row)) throw new Error(`record row ${r.row} is in two buildings`);
    buildingsByRecord.set(r.row, g);
  }
  const recordSum = buildings.reduce((s, g) => s + g.size, 0);
  const totalArea = buildings.reduce((s, g) => s + g.totalArea, 0);
  const checks = {
    records: recs.length,
    buildings: buildings.length,
    recordSum,
    everyRecordOnce: recordSum === recs.length && buildingsByRecord.size === recs.length && new Set(buildingsByRecord.keys()).size === recs.length,
    houseBuildings: buildings.filter((g) => g.house).length,
    houseRecords: buildings.filter((g) => g.house).reduce((s, g) => s + g.size, 0),
    nonHouseBuildings: buildings.filter((g) => !g.house).length,
    nonHouseRecords: buildings.filter((g) => !g.house).reduce((s, g) => s + g.size, 0),
    totalAreaM2: Math.round(totalArea),
    houseScaleRecords: recs.filter((r) => r.houseScale).length,
    datasetFlagAgrees,
    datasetFlagDisagrees,
    formInconsistent,
    // (a house-scale group the dataset calls an outbuilding or other: counted as a non-house group here, and named)
    houseScaleGroupsNotHouseForm: buildings.filter((g) => g.allHouseScale && !g.house).length,
    houseScaleOutlinesNoAddress: recs.filter((r) => r.houseScale && r.addressPoints === 0).length,
    oneDwellingWithSharedWall: buildings.filter((g) => g.house && g.form === 'semi' && g.dwellings === 1).length
  };
  checks.buildingShareSum = buildings.reduce((s, g) => s + g.size / recs.length, 0);
  checks.areaShareSum = buildings.reduce((s, g) => s + g.totalArea / totalArea, 0);

  // ---- histograms (the values the thresholds were chosen from) ----
  const histograms = {
    area: bins(recs, (r) => r.area, [40, 60, 80, 100, 120, 160, 200, 250, 300, 400, 600, 1000, 2000, 5000, 10000, 50000]),
    avgHeight: bins(recs, (r) => r.avgHeight ?? r.h, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 18, 25, 50, 100]),
    maxHeight: bins(recs, (r) => r.maxHeight ?? r.h, [3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 60, 100, 200, 300]),
    osmClass: Object.fromEntries(OSM_CLASS_NAMES.map((name, i) => [name, recs.filter((r) => r.osmClass === i).length])),
    groupSizes: Object.fromEntries([...new Set(buildings.map((g) => g.size))].sort((a, b) => a - b).map((s) => [s, buildings.filter((g) => g.size === s).length])),
    houseGroupSizes: Object.fromEntries([...new Set(buildings.filter((g) => g.house).map((g) => g.size))].sort((a, b) => a - b).map((s) => [s, buildings.filter((g) => g.house && g.size === s).length]))
  };

  // ---- cross-table: old kind against the new form family, in records ----
  const crossTable = {};
  for (const k of KIND_NAMES) { crossTable[k] = {}; for (const f of FORM_FAMILIES) crossTable[k][f] = 0; }
  for (const g of buildings) for (const r of g.records) {
    const kind = KIND_NAMES[r.kind] || String(r.kind);
    crossTable[kind][g.family] = (crossTable[kind][g.family] || 0) + 1;
  }
  const crossTotals = Object.fromEntries(KIND_NAMES.map((k) => [k, Object.values(crossTable[k]).reduce((s, v) => s + v, 0)]));
  const houseScaleByKind = Object.fromEntries(KIND_NAMES.map((k) => [k, FORM_FAMILIES.slice(0, 3).reduce((s, f) => s + crossTable[k][f], 0)]));

  // ---- forms ranked by buildings, share, cumulative share, area share ----
  const formMap = new Map();
  for (const g of buildings) {
    let f = formMap.get(g.formId);
    if (!f) formMap.set(g.formId, (f = {
      id: g.formId, family: g.family, house: g.house, form: g.form, count: 0, records: 0, areaM2: 0,
      storeys: [], totalArea: [], width: [],
      podium: g.podium, mainStreet: g.mainStreet, shop: g.shop, osmClass: g.osmClass,
      heightBand: g.heightBand, areaBand: g.areaBand, school: g.records.some((r) => /school|college|university|academy|institute/i.test(r.name))
    }));
    f.count++; f.records += g.size; f.areaM2 += g.totalArea;
    f.storeys.push(g.storeys); f.totalArea.push(g.totalArea); f.width.push(g.width);
  }
  const forms = [...formMap.values()].map((f) => {
    f.areaShare = f.areaM2 / totalArea;
    f.share = f.count / buildings.length;
    f.medianStoreys = round(q(f.storeys, 0.5), 1);
    f.medianArea = round(q(f.totalArea, 0.5), 1);
    f.medianWidth = round(q(f.width, 0.5), 1);
    f.suggestion = suggestPreset(f);
    return f;
  }).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  let cum = 0, cumArea = 0;
  for (const f of forms) { cum += f.share; cumArea += f.areaShare; f.cumShare = cum; f.cumAreaShare = cumArea; }

  // ---- house buildings: detached / semi / row by storeys, with width and area quantiles ----
  const houseStoreyBands = ['1', '1.5', '2', '2.5', '3+'];
  const storeyBand = (s) => {
    const r = Math.max(1, Math.round(s * 2) / 2);
    return r <= 1 ? '1' : r <= 1.5 ? '1.5' : r <= 2 ? '2' : r <= 2.5 ? '2.5' : '3+';
  };
  const houseTable = {};
  for (const form of ['detached', 'semi', 'row']) {
    houseTable[form] = {};
    for (const band of houseStoreyBands) {
      const list = buildings.filter((g) => g.house && g.form === form && storeyBand(g.storeys) === band);
      houseTable[form][band] = {
        buildings: list.length,
        records: list.reduce((s, g) => s + g.size, 0),
        area: { p10: round(q(list.map((g) => g.totalArea), 0.1)), median: round(q(list.map((g) => g.totalArea), 0.5)), p90: round(q(list.map((g) => g.totalArea), 0.9)) },
        width: { p10: round(q(list.map((g) => g.width), 0.1)), median: round(q(list.map((g) => g.width), 0.5)), p90: round(q(list.map((g) => g.width), 0.9)) }
      };
    }
  }

  // ---- threshold sensitivity: buildings/3's house test with its three numeric thresholds moved ±20%. The dataset's
  // group ids and forms are fixed; only its house-scale flag is re-derived from the dataset's fields and the rule, so
  // the base row reproduces the dataset's flag ----
  const sensitivity = [];
  for (const [name, pdMul, areaMul, hMul] of [
    ['base', 1, 1, 1],
    ['per-dwelling +20%', 1.2, 1, 1], ['per-dwelling −20%', 0.8, 1, 1],
    ['total area +20%', 1, 1.2, 1], ['total area −20%', 1, 0.8, 1],
    ['canopy height +20%', 1, 1, 1.2], ['canopy height −20%', 1, 1, 0.8],
    ['all three +20%', 1.2, 1.2, 1.2], ['all three −20%', 0.8, 0.8, 0.8]
  ]) {
    const r = { ...rule, maxPerDwelling: rule.maxPerDwelling * pdMul, maxArea: rule.maxArea * areaMul, maxHeight: rule.maxHeight * hMul };
    const flag = new Map(recs.map((rec) => [rec.row, isHouseScale(rec, r)]));
    let houseBuildings = 0, detached = 0, semi = 0, row = 0;
    for (const g of buildings) {
      if (!g.records.every((rec) => flag.get(rec.row))) continue;
      houseBuildings++;
      if (g.formField === 'detached') detached++; else if (g.formField === 'semi') semi++; else if (g.formField === 'row') row++;
    }
    sensitivity.push({
      change: name, maxPerDwelling: round(r.maxPerDwelling, 1), maxArea: round(r.maxArea, 1), maxHeight: round(r.maxHeight, 1),
      houseScaleRecords: recs.filter((rec) => flag.get(rec.row)).length,
      houseBuildings, detached, semi, row,
      nonHouseBuildings: buildings.length - houseBuildings
    });
  }

  // ---- address-point distribution over the 16,073 kind 0 records ----
  const kind0 = recs.filter((r) => r.kind === 0);
  const actual = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5+': 0 };
  for (const r of kind0) actual[addressBucket(r.addressPoints)]++;
  const addressCheck = {
    kind0Records: kind0.length,
    buckets: Object.keys(ADDRESS_EXPECTED).map((b) => ({
      bucket: b, expected: ADDRESS_EXPECTED[b], actual: actual[b],
      difference: actual[b] - ADDRESS_EXPECTED[b],
      within1pct: Math.abs(actual[b] - ADDRESS_EXPECTED[b]) <= 0.01 * ADDRESS_EXPECTED[b]
    })),
    total: Object.values(actual).reduce((s, v) => s + v, 0),
    within1pct: Object.keys(ADDRESS_EXPECTED).every((b) => Math.abs(actual[b] - ADDRESS_EXPECTED[b]) <= 0.01 * ADDRESS_EXPECTED[b])
  };

  // ---- Kensington Market's split ----
  const kenRecords = recs.filter((r) => inRing(r.cx, r.cz, KENSINGTON));
  const kenRowSet = new Set(kenRecords.map((r) => r.row));
  const kenBuildings = buildings.filter((g) => g.records.some((r) => kenRowSet.has(r.row)));
  const kensington = {
    records: kenRecords.length,
    buildings: kenBuildings.length,
    houseScaleRecords: kenRecords.filter((r) => r.houseScale).length,
    byFamily: Object.fromEntries(FORM_FAMILIES.map((f) => [f, kenBuildings.filter((g) => g.family === f).length])),
    byHouseForm: Object.fromEntries(['detached', 'semi', 'row'].map((f) => [f, kenBuildings.filter((g) => g.house && g.form === f).length])),
    byKind: Object.fromEntries(KIND_NAMES.map((k) => [k, kenRecords.filter((r) => KIND_NAMES[r.kind] === k).length])),
    mainStreetRecords: kenRecords.filter((r) => r.mainStreet).length
  };

  // ---- seeded examples: 12 per form for the top 15 forms ----
  const top15 = forms.slice(0, 15);
  const exampleForms = top15.map((f) => {
    const list = buildings.filter((g) => g.formId === f.id).sort((a, b) => a.tallest.row - b.tallest.row);
    return {
      form: f.id, family: f.family, count: f.count,
      examples: pick(list, examples, 0x5eed ^ hashStr(f.id)).map((g) => {
        const t = g.tallest;
        const p = latLonFromWorld(t.cx, t.cz);
        return {
          id: t.id, lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6),
          height: round(t.top, 1), avgHeight: round(t.avgHeight, 1),
          area: round(g.totalArea, 1), addressPoints: g.addressTotal, records: g.size
        };
      })
    };
  });

  const comparison = {
    st103: PREVIOUS.st103,
    buildings2: PREVIOUS.buildings2,
    buildings3: {
      label: inputs.sources.dataset.dataset,
      records: recs.length, buildings: buildings.length, houseBuildings: checks.houseBuildings, houseRecords: checks.houseRecords,
      nonHouseBuildings: checks.nonHouseBuildings, nonHouseRecords: checks.nonHouseRecords, totalAreaM2: checks.totalAreaM2,
      detached: buildings.filter((g) => g.form === 'detached').length,
      semi: buildings.filter((g) => g.form === 'semi').length,
      row: buildings.filter((g) => g.form === 'row').length,
      houseScaleRecords: checks.houseScaleRecords,
      crossTotals, houseScaleByKind
    }
  };

  return {
    generatedBy: 'tools/report-building-forms.mjs',
    since: '2026-11-15',
    thresholdTable: {
      rule, STOREY_M, AREA_BANDS, HEIGHT_BANDS, OUTBUILDING,
      notes: [
        'house-scale, dwellings, form, use class and the joined group come from tools/data/building-inputs.json (the shared buildings/3 dataset)',
        'the house test\'s thresholds are the inputs file\'s `parameters`, read from the dataset\'s manifest: per-dwelling footprint < 250 m², total footprint < 800 m², canopy-robust height < 11 m, not an excluded use, not a shop, not an outbuilding',
        'a house building is a joined group whose form is detached, semi or row',
        'the sensitivity table moves the three numeric thresholds ±20% and re-derives the dataset\'s flag from its fields'
      ]
    },
    parameters: inputs.parameters,
    inputs: { ...inputs.sources, checks: inputs.checks, bytes: fs.statSync(path.join(ROOT, 'tools/data/building-inputs.json')).size },
    city: {
      records: recs.length,
      buildings: buildings.length,
      houseBuildings: checks.houseBuildings,
      nonHouseBuildings: checks.nonHouseBuildings,
      totalAreaM2: checks.totalAreaM2
    },
    forms,
    crossTable,
    crossTotals,
    houseScaleByKind,
    houseTable,
    sensitivity,
    histograms,
    addressCheck,
    kensington,
    exampleForms,
    comparison,
    checks
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------------------------------------------------
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-CA'));
const pc = (v) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`);
const m1 = (v) => (v == null ? '—' : Number(v).toFixed(1));
function table(head, rows) {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}
const ll = (e) => `${Number(e.lat).toFixed(6)}, ${Number(e.lon).toFixed(6)}`;

export function renderMarkdown(out) {
  const c = out.checks;
  const hist = out.histograms;
  const binHead = (h, label, unit) => [label, ...h.edges.map((e) => `<${e}`), `≥${h.edges[h.edges.length - 1]}`].map((x) => (x === label ? `${label} (${unit})` : x));
  const histRows = (h, label, unit) => [binHead(h, label, unit), [...h.counts.map((v) => num(v))]];

  const areaHist = histRows(hist.area, 'footprint area', 'm²');
  const avgHist = histRows(hist.avgHeight, 'average height', 'm');
  const maxHist = histRows(hist.maxHeight, 'maximum height', 'm');

  const kindRows = KIND_NAMES.map((k) => [k, ...FORM_FAMILIES.map((f) => num(out.crossTable[k][f])), num(out.crossTotals[k])]);

  const formRows = out.forms.map((f, i) => [
    i + 1, `\`${f.id}\``, num(f.count), pc(f.share), pc(f.cumShare), pc(f.areaShare), pc(f.cumAreaShare),
    f.house ? m1(f.medianWidth) : '—', m1(f.medianArea)
  ]);

  const houseRows = [];
  for (const form of ['detached', 'semi', 'row']) for (const band of ['1', '1.5', '2', '2.5', '3+']) {
    const h = out.houseTable[form][band];
    houseRows.push([form, band, num(h.buildings), num(h.records), m1(h.width.p10), m1(h.width.median), m1(h.width.p90), m1(h.area.p10), m1(h.area.median), m1(h.area.p90)]);
  }

  const sensRows = out.sensitivity.map((s) => [s.change, m1(s.maxPerDwelling), m1(s.maxArea), m1(s.maxHeight), num(s.houseScaleRecords), num(s.houseBuildings), num(s.detached), num(s.semi), num(s.row), num(s.nonHouseBuildings)]);

  const top25 = out.forms.slice(0, 25);
  const suggestRows = top25.map((f, i) => [i + 1, `\`${f.id}\``, num(f.count), f.suggestion]);

  const exampleSections = out.exampleForms.map((f) => {
    const rows = f.examples.map((e) => [`\`${e.id}\``, ll(e), m1(e.height), m1(e.avgHeight), m1(e.area), num(e.addressPoints), num(e.records)]);
    return `**${f.form}** (${num(f.count)} buildings)\n\n${table(['durable ID', 'lat, lon', 'height', 'avg height', 'area', 'address points', 'records'], rows)}`;
  }).join('\n\n');

  const addrRows = out.addressCheck.buckets.map((b) => [b.bucket, num(b.expected), num(b.actual), (b.difference > 0 ? '+' : '') + num(b.difference), b.within1pct ? 'yes' : 'no']);

  const runs = [out.comparison.st103, out.comparison.buildings2, out.comparison.buildings3];
  const delta = (a, b) => (b > a ? '+' : '') + num(b - a);
  const compareRows = [
    ['Records', ...runs.map((r) => num(r.records)), delta(runs[1].records, runs[2].records)],
    ['Buildings', ...runs.map((r) => num(r.buildings)), delta(runs[1].buildings, runs[2].buildings)],
    ['House buildings', ...runs.map((r) => num(r.houseBuildings)), delta(runs[1].houseBuildings, runs[2].houseBuildings)],
    ['House records', ...runs.map((r) => num(r.houseRecords)), delta(runs[1].houseRecords, runs[2].houseRecords)],
    ['Non-house buildings', ...runs.map((r) => num(r.nonHouseBuildings)), delta(runs[1].nonHouseBuildings, runs[2].nonHouseBuildings)],
    ['Detached', ...runs.map((r) => num(r.detached)), delta(runs[1].detached, runs[2].detached)],
    ['Semi', ...runs.map((r) => num(r.semi)), delta(runs[1].semi, runs[2].semi)],
    ['Row', ...runs.map((r) => num(r.row)), delta(runs[1].row, runs[2].row)],
    ['House-scale records', ...runs.map((r) => num(r.houseScaleRecords)), delta(runs[1].houseScaleRecords, runs[2].houseScaleRecords)],
    ['Total footprint (m²)', ...runs.map((r) => num(r.totalAreaM2)), delta(runs[1].totalAreaM2, runs[2].totalAreaM2)]
  ];
  const kindCompareRows = KIND_NAMES.map((k) => [k, num(runs[0].crossTotals[k]), ...runs.map((r) => num(r.houseScaleByKind[k])), delta(runs[1].houseScaleByKind[k], runs[2].houseScaleByKind[k])]);
  // (the coordinator's own count over buildings/3, for the "within 1%" check; not a computation of this script)
  const EXPECTED = { houseScaleRecords: 22538, detached: 9174, semi: 6291, row: 2950, outbuilding: 95, other: 4236, total: 22746 };
  const actualForms = {
    detached: out.forms.filter((f) => f.family === 'detached').reduce((s, f) => s + f.count, 0),
    semi: out.forms.filter((f) => f.family === 'semi').reduce((s, f) => s + f.count, 0),
    row: out.forms.filter((f) => f.family === 'row').reduce((s, f) => s + f.count, 0),
    // (the dataset's own outbuilding form; this report's wider 'outbuilding' family, which adds OSM sheds, counts as other here)
    outbuilding: out.forms.filter((f) => f.id === 'outbuilding').reduce((s, f) => s + f.count, 0),
    other: out.forms.filter((f) => f.family !== 'detached' && f.family !== 'semi' && f.family !== 'row' && f.id !== 'outbuilding').reduce((s, f) => s + f.count, 0)
  };
  actualForms.total = actualForms.detached + actualForms.semi + actualForms.row + actualForms.outbuilding + actualForms.other;
  const diffPct = (a, b) => (b ? ((a - b) / b * 100).toFixed(2) + '%' : '—');
  const expectedRows = [
    ['House-scale records', num(out.checks.houseScaleRecords), num(EXPECTED.houseScaleRecords), diffPct(out.checks.houseScaleRecords, EXPECTED.houseScaleRecords)],
    ...['detached', 'semi', 'row', 'outbuilding', 'other'].map((f) => [f, num(actualForms[f]), num(EXPECTED[f]), diffPct(actualForms[f], EXPECTED[f])]),
    ['all buildings', num(actualForms.total), num(EXPECTED.total), diffPct(actualForms.total, EXPECTED.total)]
  ];
  const ds = out.inputs.dataset, ic = out.inputs.checks;
  const fallbackList = (ic.fallbackIds || []).map((id) => `\`${id}\``).join(', ');
  const exceptionList = (ic.idSuffixExceptions || []).map((id) => `\`${id}\``).join(', ');

  return `# Building forms: the city's buildings by form, not by the geodata's height kind

Bead \`st-ndw9.5\`. The first count (\`docs/building-classes.md\`) classed each City 3D Massing **record** by the
geodata's \`kind\`, which is set from the lidar maximum height. That calls tall houses mid-rise, cannot see the two
halves of a semi drawn as one outline, and counts a tower and its podium as two buildings. This recount takes the facts
from the shared Toronto data repo's \`${ds.dataset}\` dataset (pinned in \`data/shared-toronto-data-pin.json\`): one
row per City massing part, with the City's address points, its footprint, its heights, the joined group, an
OpenStreetMap use class, house-scale and outbuilding flags, dwellings and form. Its house test is per dwelling
(footprint over address points), caps the total footprint and uses a canopy-robust height. It counts **buildings**: one
joined group. Generated by \`node tools/report-building-forms.mjs --md docs/building-forms.md\`; every number comes
from its output, \`tools/building-forms.json\`. Nothing the page loads was changed.

## Method

### Inputs

- **\`tools/data/building-inputs.json\`**, built by
  \`TORONTO_DATA_CACHE=<the shared cache root> node tools/build-building-inputs.mjs\` from the shared
  \`${ds.dataset}\` dataset (manifest commit \`${ds.manifestCommit}\`, generated ${ds.manifestGenerated};
  ${num(ic.datasetCells)} cells read, ${num(ic.datasetRowsRead)} dataset rows). It is **${(out.inputs.bytes / 1024 / 1024).toFixed(2)} MB**: one array per
  column in sidecar order, lengths and heights in tenths, repeated strings as small integers, the group as an integer.
  It holds **${num(ic.sidecarRecords)} records, one per massing sidecar record, in sidecar order**.
  **${num(ic.matchedByFidK)}** matched the dataset's \`(fid, k)\`; **${num(ic.matchedByFidSinglePart)}** are the one part the
  dataset kept from a multi-polygon record whose other part it dropped upstream (${fallbackList || 'none'}), joined by
  their one dataset row for the fid; **${num(ic.unmatched)}** found no row. The sidecar's durable id is not stored: it
  is derived from \`fid\` and \`k\` (the ${(ic.idSuffixExceptions || []).length} exceptions where the source ring index is
  \`.0\` are ${exceptionList || 'none'}). The house rule comes from the file's \`parameters\`, recorded from the
  dataset's manifest: per-dwelling footprint **< ${num(out.parameters.houseMaxPerDwellingM2)} m²**, total footprint
  **< ${num(out.parameters.houseMaxAreaM2)} m²**, canopy-robust height **< ${num(out.parameters.houseMaxHeightM)} m**,
  use not ${(out.parameters.excludeOsm || []).join(' / ')}, not a shop, not an outbuilding. Re-derived from the
  dataset's own fields, it reproduces its \`houseScale\` flag on **${num(c.datasetFlagAgrees)} of ${num(c.records)}**
  records (${num(c.datasetFlagDisagrees)} disagree). **${num(ic.maxHeightZero)}** records carry no maximum
  (\`MAX_HEIGHT\` 0); the top height is the average there, as the build does. No raw cache is read at report time.
- **\`js/toronto-geodata.js\`** and **\`js/toronto-geodata-ids.js\`**: each record's geodata height, old \`kind\`, name and
  durable ID.
- **\`data/toronto-massing.bin\`**: the outer ring and courtyards, street edges and base, and the sidecar's own record
  order, read through \`js/massing-data.js\` exactly as the census does.

### The form table

The dataset supplies house-scale, dwellings, form, use class and the joined group; this script only names and ranks
them.

| Rule | Value | Source |
|---|---|---|
| House-scale record | footprint per address point **< ${num(out.parameters.houseMaxPerDwellingM2)} m²**, total footprint **< ${num(out.parameters.houseMaxAreaM2)} m²**, canopy-robust height **< ${num(out.parameters.houseMaxHeightM)} m**, use not ${(out.parameters.excludeOsm || []).join(' / ')}, not a shop, not an outbuilding | the dataset's \`houseScale\`; thresholds from its manifest \`parameters\` |
| House building | a joined group whose form is detached, semi or row | the dataset's \`form\` |
| Dwellings | the larger of the group's address-point total and its part count | the dataset's \`dwellings\` |
| Detached | one dwelling, no shared wall | the dataset's \`form\` |
| Semi | two dwellings (one outline with two address points, or a joined pair) | the dataset's \`form\` |
| Row | three or more dwellings (one outline with three or more points, or a joined chain) | the dataset's \`form\` |
| Storey | **${STOREY_M} m** | \`js/buildings.js\` \`FLOOR_HEIGHTS[0]\` |
| Non-house form | height band of the tallest part's MAX_HEIGHT, total footprint, podium, main street, shop front, use class | readings of the dataset's fields |

**${num(c.houseScaleGroupsNotHouseForm)}** joined groups are all-houseScale but the dataset calls them outbuilding or
other; they are counted as non-house buildings here and named in Limits.

### Histograms (the dataset's fields, for reference)

${table(['footprint area (m²)', ...areaHist[0].slice(1)], [areaHist[1]])}

${table(['average height (m)', ...avgHist[0].slice(1)], [avgHist[1]])}

${table(['maximum height (m)', ...maxHist[0].slice(1)], [maxHist[1]])}

Use classes (records): ${OSM_CLASS_NAMES.map((n, i) => `${n} ${num(hist.osmClass[n])}`).join('; ')}.

Joined groups by size (records in group → buildings): ${Object.entries(hist.groupSizes).map(([s, n]) => `${s}→${num(n)}`).join('; ')}.

## The three runs

st-ndw9.3 (PR #155) built the same city from its own raw-cache inputs and its own form rules; this bead's first run
took the same fields from \`buildings/2\`; this run takes them from \`buildings/3\`, whose house test is per dwelling,
caps the total footprint at 800 m² and uses a canopy-robust height. The column after \`buildings/3\` is that run minus
the \`buildings/2\` run.

${table(['measure', runs[0].label, runs[1].label, runs[2].label, 'buildings/3 − buildings/2'], compareRows)}

The old height-only \`kind\` against the share of its records each run makes house-scale:

${table(['old kind', 'records', 'house-scale, st-ndw9.3', 'house-scale, buildings/2', 'house-scale, buildings/3', '3 − 2'], kindCompareRows)}

### Against the coordinator's count over the dataset

The coordinator counted the frame over \`buildings/3\` directly. The differences are small and all inside 1%: the
dataset's own frame check counts **22,746** joined groups over **35,274** parts, while this report groups Slop's
**35,254** sidecar records, 20 parts fewer, so it finds 9 groups fewer (6 detached and 3 other).

${table(['measure', 'this report', "coordinator's count", 'difference'], expectedRows)}

## Headline: old \`kind\` against the new form, in records

A record is one massing part; a building is one house building or one joined group. The rows are the old height-only
kind; the columns are the new form family. **${num(out.houseScaleByKind['mid-rise'])}** of the
**${num(out.crossTotals['mid-rise'])}** "mid-rise" records and **${num(out.houseScaleByKind['low-rise'])}** of the
**${num(out.crossTotals['low-rise'])}** "low-rise" records are house-scale (detached, semi or row), not mid-rise or
low-rise buildings. The old house kind has **${num(out.houseScaleByKind['house'])}** of its
**${num(out.crossTotals['house'])}** records house-scale; the rest are non-house groups.

${table(['old kind', ...FORM_FAMILIES, 'total'], kindRows)}

## Forms ranked by buildings

A building is one joined group. **${num(c.buildings)} buildings** over **${num(c.records)} records**;
**${num(c.houseBuildings)}** house buildings hold **${num(c.houseRecords)}** records, and **${num(c.nonHouseBuildings)}**
non-house buildings hold **${num(c.nonHouseRecords)}** records. Total footprint **${num(c.totalAreaM2)} m²**.

The top of the list is the long tail's head: ${pc(out.forms[0].share)} of buildings in the largest form. The
cumulative column is the share of buildings covered by all forms up to that row.

${table(['#', 'form', 'buildings', 'share', 'cum. share', 'area share', 'cum. area share', 'median width (m)', 'median area (m²)'], formRows)}

## House buildings: detached, semi, row by storeys

Storeys use the average height (near the eaves). Width is the building's street frontage (the sum of its street-facing
edges), or the widest record's narrow side when it has no street edge. Area is the total footprint of the building.

${table(['form', 'storeys', 'buildings', 'records', 'width p10', 'width median', 'width p90', 'area p10', 'area median', 'area p90'], houseRows)}

House-scale outlines with no address point: **${num(c.houseScaleOutlinesNoAddress)}**. They are counted as detached
when they have no shared wall, but the address count says nothing about how many dwellings they hold.

## How the counts move when each threshold moves 20%

Each row re-derives \`buildings/3\`'s house-scale flag from the dataset's own per-dwelling footprint, total footprint,
canopy-robust height, use class, shop flag and outbuilding flag, with the three numeric thresholds moved by the factor
named. The thresholds are the inputs file's \`parameters\` (the dataset's manifest), not constants here. The dataset's
group ids and forms do not move, so detached, semi and row move only where a group's every part crosses the line. The
base row re-derives ${num(out.sensitivity[0].houseScaleRecords)} house-scale records, ${num(c.houseScaleRecords - out.sensitivity[0].houseScaleRecords)} fewer than
the dataset's own flag (${num(c.houseScaleRecords)}), because the compact file stores footprints and heights to 0.1 m
and ${num(c.datasetFlagDisagrees)} records sit on a threshold. "House buildings" here counts every joined group whose
parts are all house-scale, ${num(out.sensitivity[0].houseBuildings - c.houseBuildings)} more than the report's house buildings,
which also require the dataset's form to be detached, semi or row; at the base row detached + semi + row total
${num(out.sensitivity[0].detached + out.sensitivity[0].semi + out.sensitivity[0].row)}, ${num(c.houseBuildings - (out.sensitivity[0].detached + out.sensitivity[0].semi + out.sensitivity[0].row))} from the report's, by the same rounding.

${table(['change', 'max per dwelling (m²)', 'max total area (m²)', 'max canopy height (m)', 'house-scale records', 'house buildings', 'detached', 'semi', 'row', 'non-house buildings'], sensRows)}

## Top 25 forms and the preset they most resemble

Section 4 of \`docs/building-prototypes-spec.md\` lists 32 presets. Era is not known from these inputs, so the
suggestion is form-only and is a starting point for the prototype list, not an assignment.

${table(['#', 'form', 'buildings', "worker's suggestion"], suggestRows)}

## Seeded examples

Twelve seeded examples per form for the top 15 forms. A durable ID is \`to-3dmassing-2025:<fid>[.<k>]\`; lat and lon
are six decimals from \`js/city-config.js\` \`latLonFromWorld\` (the frame's own inverse). Height is the representative
part's MAX_HEIGHT, average height its AVG_HEIGHT, area the building's total footprint, address points the building's
total.

${exampleSections}

## Checks

### Every record in exactly one building

Records **${num(c.records)}**; buildings **${num(c.buildings)}**; records in the buildings **${num(c.recordSum)}**;
every record once: **${c.everyRecordOnce ? 'yes' : 'no'}**. Building count shares sum to
**${out.checks.buildingShareSum.toFixed(6)}**; area shares sum to **${out.checks.areaShareSum.toFixed(6)}**.

### The inputs join

Every sidecar record matched a dataset row: **${ic.everySidecarRecordMatched ? 'yes' : 'no'}**; no dataset row went to
two records: **${ic.rowsUnique ? 'yes' : 'no'}**; every group's parts carry one form: **${c.formInconsistent === 0 ? 'yes' : 'no'}**.

### The address-point distribution over the ${num(out.addressCheck.kind0Records)} kind 0 records

The brief's expected distribution (0, 1, 2, 3, 4, 5 or more) is reproduced to within 1% of each expected bucket, now
from the dataset's address-point counts. The residual is points on shared walls and overlapping outlines: a point
inside two outlines counts for both, which is what "inside its outline" means.

${table(['address points', 'expected', 'actual', 'difference', 'within 1%'], addrRows)}

### Kensington Market's split

Records **${num(out.kensington.records)}**, buildings **${num(out.kensington.buildings)}**, house-scale records
**${num(out.kensington.houseScaleRecords)}**, main-street records **${num(out.kensington.mainStreetRecords)}**.

Buildings by family: ${FORM_FAMILIES.map((f) => `${f} ${num(out.kensington.byFamily[f])}`).join('; ')}.

House buildings: ${['detached', 'semi', 'row'].map((f) => `${f} ${num(out.kensington.byHouseForm[f])}`).join('; ')}.

Records by old kind: ${KIND_NAMES.map((k) => `${k} ${num(out.kensington.byKind[k])}`).join('; ')}.

## Limits

- **Era is not measured.** The presets in section 4 separate eras; this recount measures form only. The suggestions in
  the top 25 table are form-level, not era-level. Era is not in these inputs (the compact file drops the year fields
  the report does not use); see \`docs/building-era-sources.md\`.
- **Address points are dwellings, not households.** A second unit in one house and both halves of a semi both add a
  point; a rooming house may add several. A house-scale outline with no address point is reported separately and
  called detached when it has no shared wall.
- **A house-scale outline with no address point** (${num(c.houseScaleOutlinesNoAddress)} of them) is called detached
  when it has no shared wall, but the address count says nothing about how many dwellings it holds; the city's own
  civic addresses may simply not reach it. They are reported separately in the house table.
- **${(ic.idSuffixExceptions || []).length} records are the source ring index \`.0\`.** ${exceptionList || 'None'}: the source
  record's other polygon was dropped by Slop, so the dataset wrote the one kept part as single-part while the sidecar
  keeps \`.0\`. They join by \`(fid, k)\` exactly, and the derived durable id needs this exception.
- **${num(c.houseScaleGroupsNotHouseForm)} all-houseScale groups** carry the dataset's outbuilding or other form; they
  are counted as non-house buildings, so the house table's detached + semi + row equals the house-building count.
- **${(ic.fallbackIds || []).length} joins are by fid, not by \`(fid, k)\`.** ${fallbackList || 'None'}: each is the part the
  dataset kept from a multi-polygon record whose other part it dropped as a zero-area sliver, so the dataset wrote it
  as single-part while the sidecar keeps the source ring index. Their outline areas agree to under 1%.
- **The use class is per footprint, not per unit.** A tower and its podium can share one OpenStreetMap key, so the
  tower's class can label the podium too. The form's height and area bands still separate them.
- **Not checked:** the shared dataset's own upstream code was not read; its \`houseScale\`, \`form\`, \`dwellings\` and
  \`group\` are taken as given. The join and the flag agreement above are measured from its files.
- **No Street View or visual check was made.** The forms are a data classification; the acceptance step in the spec
  still needs a per-phase visual spot check.
- **The top-15 example sets are seeded samples**, not every building; the full form membership is in
  \`tools/building-forms.json\` (the examples carry durable IDs, so any example can be looked up).
`;
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const { values: opt } = parseArgs({ options: {
    json: { type: 'string', default: 'tools/building-forms.json' },
    md: { type: 'string' },
    examples: { type: 'string', default: '12' },
    quiet: { type: 'boolean', default: false }
  } });
  const out = await run({ examples: Number(opt.examples) });
  const jsonPath = path.resolve(ROOT, opt.json);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2) + '\n');
  if (opt.md) fs.writeFileSync(path.resolve(ROOT, opt.md), renderMarkdown(out));
  if (!opt.quiet) {
    console.log(`records ${out.city.records}, buildings ${out.city.buildings}, house ${out.city.houseBuildings}, non-house ${out.city.nonHouseBuildings}`);
    console.log(`forms ${out.forms.length}; top: ${out.forms.slice(0, 5).map((f) => `${f.id} ${f.count}`).join('; ')}`);
    console.log(`mid-rise house-scale ${out.houseScaleByKind['mid-rise']} of ${out.crossTotals['mid-rise']}; low-rise house-scale ${out.houseScaleByKind['low-rise']} of ${out.crossTotals['low-rise']}`);
    console.log(`address check ${out.addressCheck.within1pct ? 'within 1%' : 'OUTSIDE 1%'}; every record once ${out.checks.everyRecordOnce}`);
    console.log(`wrote ${jsonPath}${opt.md ? ` and ${path.resolve(ROOT, opt.md)}` : ''}`);
  }
}