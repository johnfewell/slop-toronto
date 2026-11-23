#!/usr/bin/env node
// tools/report-building-era.mjs — how far each candidate construction-era source reaches the buildings of the detail
// city (docs/building-era-sources.md, bead st-ndw9.2). Read-only: it never writes data/ or js/ and never fetches.
// It reads only the files tools/fetch-building-era.mjs cached under the building-era cache (plus the committed
// heritage copy and the committed massing sidecar), so every number it prints can be re-derived from bytes on disk.
//
// For each candidate: the records inside the frame, how many of the 35,254 massing outlines they match (a record's
// point inside an outline, or its edge within 15 m; the report says which), the matched buildings split across the six
// eras, and their split by building class (house / low-rise / mid-rise / tower / shed / works / worship / civic, the
// GEO.buildings kind).
//
// usage: node tools/report-building-era.mjs [--json out.json] [--cache DIR] [--quiet]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadGeo, loadMassing, project, inDetail, matchToMassing, countInside, countPolygonsCentredInside } from './building-era-frame.mjs';

const { values: opt } = parseArgs({ options: { json: { type: 'string' }, cache: { type: 'string' }, quiet: { type: 'boolean' } } });
const CACHE = opt.cache || process.env.BUILDING_ERA_CACHE || path.join(process.env.HOME, '.cache/slop-toronto/raw/building-era');
const HERITAGE = process.env.HERITAGE_REGISTER ||
  path.join(process.env.HOME, '.cache/slop-toronto/raw/heritage-register');
const OSM = process.env.OSM_IN_FRAME || path.join(CACHE, 'overpass/osm-buildings-in-frame.json');
const parcelsFile = process.env.PARCELS_IN_FRAME || path.join(CACHE, 'parcels-in-frame.json');

// The six eras of the prototype list (Victorian, Edwardian, interwar, wartime, postwar, new build), as year windows.
// 1946 to 1960 is the one-period choice the sources force: the Census' own period scale splits at 1946 (the wartime
// economy ends) and 1960 (before the 1961-70 boom), and a house holding a 1950 permit is a postwar build.
export const ERAS = [
  { name: 'Victorian', from: 1834, to: 1900 },
  { name: 'Edwardian', from: 1901, to: 1918 },
  { name: 'Interwar', from: 1919, to: 1945 },
  { name: 'Postwar', from: 1946, to: 1960 },
  { name: 'Late postwar', from: 1961, to: 1985 },
  { name: 'New build', from: 1986, to: 2100 },
];
export const eraOf = (year) => (year ? (ERAS.find((e) => year >= e.from && year <= e.to) || { name: 'unknown' }).name : 'unknown');

const KIND = ['house', 'low-rise', 'mid-rise', 'tower', 'shed', 'works', 'worship', 'civic'];
const log = (...a) => { if (!opt.quiet) console.log(...a); };
const round = (v, d = 1) => +v.toFixed(d);
const has = (p) => fs.existsSync(p);

const G = loadGeo();
const P = G.frame.projection;
const outlines = await loadMassing(G);
const TOTAL = outlines.length;
// outlines whose row is not a GEO.buildings row: a massing part standing alone, not drawn by a geodata box
const skipped = outlines.filter((o) => !G.buildings[o.row]).length;
const kindOf = (row) => KIND[G.buildings[row][5]] || 'other';
const label = (row) => (G.buildings[row][9] ? `${G.buildings[row][9]} (${kindOf(row)})` : `row ${row} (${kindOf(row)})`);

const tally = (matches) => {
  const eras = Object.fromEntries(ERAS.map((e) => [e.name, 0]));
  const kinds = {};
  const buildings = new Set();
  for (const m of matches) {
    if (buildings.has(m.row)) continue;
    buildings.add(m.row);
    eras[m.era] = (eras[m.era] || 0) + 1;
    kinds[kindOf(m.row)] = (kinds[kindOf(m.row)] || 0) + 1;
  }
  return { buildings, eras, kinds };
};

const one = (candidate, points, how, allPoints = points) => {
  const inFrame = allPoints.length;
  const r = matchToMassing(G, outlines, points);
  const matched = [];
  for (const [p, m] of r.matches) matched.push({ ...p, row: m.row, how: m.how, distance: m.distance });
  const t = tally(matched);
  const recordEras = {};
  for (const p of matched) recordEras[p.era || 'unknown'] = (recordEras[p.era || 'unknown'] || 0) + 1;
  const out = {
    candidate,
    how,
    recordsInFrame: inFrame,
    recordsMatched: r.matched,
    recordsInside: r.inside,
    recordsWithin15: r.within,
    recordsUnmatched: r.unmatched,
    buildingsCovered: t.buildings.size,
    share: round((100 * t.buildings.size) / TOTAL, 1),
    recordEras,
    eras: t.eras,
    kinds: t.kinds,
    samples: matched.slice(0, 3),
  };
  log(`\n== ${candidate}`);
  log(`   records in frame ${inFrame}; matched ${r.matched} (inside ${r.inside}, within 15 m ${r.within}, none ${r.unmatched})`);
  log(`   massing outlines covered ${t.buildings.size} of ${TOTAL} (${out.share}%)`);
  log(`   eras ${JSON.stringify(t.eras)}`);
  log(`   kinds ${JSON.stringify(t.kinds)}`);
  return out;
};

const results = [];

// ---------------------------------------------------------------------------------------------------------------------
// 1. The City's Heritage Register (CONSTRUCTI, a year or a year range, often circa)
// ---------------------------------------------------------------------------------------------------------------------
const heritageFile = path.join(HERITAGE, 'shp/all.geojson');
if (has(heritageFile)) {
  const h = JSON.parse(fs.readFileSync(heritageFile, 'utf8'));
  const all = h.features.map((f) => ({
    year: hYear(f.properties.CONSTRUCTI),
    status: f.properties.STATUS,
    address: f.properties.ADDRESS,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
  const withYear = all.filter((r) => r.year);
  const pts = withYear.map((r, i) => { const [x, z] = project(P, r.lon, r.lat); return { i, x, z }; });
  const inF = pts.filter((p) => inDetail(G, p.x, p.z));
  const withEra = inF.map((p) => ({ ...p, era: eraOf(withYear[p.i].year) }));
  const res = one('Heritage Register (CONSTRUCTI)', withEra, 'point inside outline, else edge within 15 m', withYear);
  res.detail = {
    sourceRecords: h.features.length,
    withConstructionYear: withYear.length,
    withYearAndInsideFrame: inF.length,
    fieldSamples: withYear.slice(0, 3).map((r) => r.address + ' -> ' + r.year),
  };
  log(`   source records ${h.features.length}; with a year ${withYear.length}; with a year and a point in the frame ${inF.length}`);
  results.push(res);
} else {
  log(`\n== Heritage Register: no ${heritageFile}`);
}

/** A year from CONSTRUCTI: "1914", "1910 (circa)", "1873-1874", "1903-1913 (circa)"; the later year of a range */
export function hYear(s) {
  if (!s) return null;
  const years = String(s).match(/\b(1[6-9]\d\d|20\d\d)\b/g);
  if (!years) return null;
  return Math.max(...years.map(Number));
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. The RentSafeTO apartment registration: YEAR_BUILT on a point per building
// ---------------------------------------------------------------------------------------------------------------------
const absFile = path.join(CACHE, 'cot/apartment-building-registration.json');
if (has(absFile)) {
  const { elements } = readArcgis(absFile);
  const all = elements.filter((e) => Number(e.YEAR_BUILT) > 1800).map((e) => {
    const [x, z] = project(P, e.LONGITUDE, e.LATITUDE);
    return { x, z, era: eraOf(Number(e.YEAR_BUILT)), address: e.SITE_ADDRESS, year: e.YEAR_BUILT };
  });
  const inF = all.filter((r) => inDetail(G, r.x, r.z));
  const res = one('Apartment Building Registration (YEAR_BUILT)', inF, 'point inside outline, else edge within 15 m', all);
  res.detail = { sourceRecords: elements.length, withYearBuilt: all.length, withYearAndInsideFrame: inF.length, fieldSamples: all.slice(0, 3).map((r) => `${r.address} -> ${r.year}`) };
  log(`   registration records ${elements.length}; with a year ${all.length}; in the frame ${inF.length}`);
  results.push(res);
} else log(`\n== Apartment Building Registration: no ${absFile}`);

// ---------------------------------------------------------------------------------------------------------------------
// 3. Building permits: new-building permits, placed at their street address point
// ---------------------------------------------------------------------------------------------------------------------
const permitsFiles = [path.join(CACHE, 'cot/building-permits-new-building.json')];
const addressFile = path.join(CACHE, 'cot/address-point-2021-in-frame.json');
if (permitsFiles.every(has) && has(addressFile)) {
  const permits = permitsFiles.flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).elements);
  const addr = JSON.parse(fs.readFileSync(addressFile, 'utf8')).elements.map((e) => {
    const [x, z] = project(P, e.LONGITUDE, e.LATITUDE);
    return { x, z, full: e.ADDRESS_FULL, key: addressKey(e.ADDRESS_FULL.split(' ')[0], e.ADDRESS_FULL.split(' ').slice(1).join(' ')) };
  });
  const addressesByKey = new Map();
  for (const a of addr) if (!addressesByKey.has(a.key)) addressesByKey.set(a.key, a);
  const pts = [];
  let placed = 0;
  for (const p of permits) {
    const key = addressKey(p.STREET_NUM, [p.STREET_NAME, p.STREET_TYPE, p.STREET_DIRECTION].filter(Boolean).join(' '));
    const hit = addressesByKey.get(key);
    if (!hit) continue;
    const year = Number(String(p.ISSUED_DATE || '').slice(0, 4));
    pts.push({ x: hit.x, z: hit.z, year, era: eraOf(year), permit: p.PERMIT_NUM, address: hit.full });
    placed++;
  }
  const inF = pts.filter((r) => inDetail(G, r.x, r.z));
  const res = one('Building Permits, New Building (base-building and addition permits; placed at the street address point)', inF, 'address point inside outline, else edge within 15 m', pts);
  res.detail = { newBuildingPermitsRead: permits.length, placedOnAnAddressPoint: placed, insideFrame: inF.length, recordsWithoutIssuedDate: pts.filter((r) => !r.year).length };
  log(`   New Building permits ${permits.length}; placed on an address point ${placed}; in the frame ${inF.length}`);
  results.push(res);
} else log(`\n== Building Permits: missing one of ${permitsFiles.join(', ')} or ${addressFile}`);

// ---------------------------------------------------------------------------------------------------------------------
// 4. OpenStreetMap start_date (the Overpass tags for the frame)
// ---------------------------------------------------------------------------------------------------------------------
if (has(OSM)) {
  const d = JSON.parse(fs.readFileSync(OSM, 'utf8'));
  const pts = [];
  let tagged = 0;
  for (const e of d.elements) {
    const t = e.tags || {};
    const y = osYear(t.start_date ?? t.year_of_construction ?? t.construction_date);
    if (y) { tagged++; const c = e.center || e.bounds && { lat: (e.bounds.minlat + e.bounds.maxlat) / 2, lon: (e.bounds.minlon + e.bounds.maxlon) / 2 }; if (!c) continue; const [x, z] = project(P, c.lon, c.lat); pts.push({ x, z, year: y, era: eraOf(y), osm: e.id }); }
  }
  const inF = pts.filter((r) => inDetail(G, r.x, r.z));
  const res = one('OpenStreetMap start_date / year_of_construction / construction_date', inF, 'way centre inside outline, else edge within 15 m', pts);
  res.detail = { osmBuildingsInFrame: d.elements.length, osmTimestamp: d.osm3s.timestamp_osm_base, taggedBuildings: tagged, withYearAndCentre: inF.length };
  log(`   OSM building ways ${d.elements.length} (${d.osm3s.timestamp_osm_base}); tagged with a year ${tagged}; with a centre in the frame ${inF.length}`);
  results.push(res);
} else log(`\n== OSM: no ${OSM}`);

// ---------------------------------------------------------------------------------------------------------------------
// 5. Statistics Canada period of construction: no per-building record; the Toronto CMA scale is quoted, the DA
//    boundaries are counted, and the per-DA join is left unbuilt because the DA-level table is not openly served
// ---------------------------------------------------------------------------------------------------------------------
const censusFile = path.join(CACHE, 'census/toronto-cma-period-of-construction.json');
const daFile = path.join(CACHE, 'cot/census-dissemination-area-2021.json');
if (has(censusFile)) {
  const cma = JSON.parse(fs.readFileSync(censusFile, 'utf8'));
  const total = Number(cma['Toronto (CMA), Ont.']['Total - Period of construction']);
  const fields = Object.entries(cma['Toronto (CMA), Ont.']).filter(([k]) => k !== 'Total - Period of construction');
  log(`\n== Statistics Canada 98-10-0242, Toronto CMA (${total} households), period of construction`);
  for (const [k, v] of fields) log(`   ${k}: ${v} (${round((100 * Number(v)) / total, 1)}%)`);
  results.push({
    candidate: 'Statistics Canada period of construction (98-10-0242)',
    how: 'no per-building record: a household share of a Toronto CMA area',
    recordsInFrame: total,
    buildingsCovered: null,
    share: null,
    cmaToronto: Object.fromEntries(fields),
    cmaTotal: total,
  });
}
if (has(daFile)) {
  const da = readArcgis(daFile).elements.length;
  log(`\n   census dissemination areas intersecting the detail frame: ${da} (City GIS cot_geospatial28 layer 2)`);
  results.push({ candidate: 'Census dissemination areas in the frame', recordsInFrame: da, note: 'the join unit for a per-area period of construction' });
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. How many dwellings or lots one massing outline covers: address points and property (parcel) boundaries
//    (the addendum to the brief). The house outlines are kind 0 in GEO.buildings; the question is how many address
//    points stand inside one, and how many parcels have their centre inside one (a parcel's centre, so a lot that
//    crosses the outline counts once, at the lot it belongs to).
// ---------------------------------------------------------------------------------------------------------------------
const histOf = (counts, list) => {
  const h = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, '5+': 0 };
  for (const o of list) { const n = Math.min(5, counts.get(o.key) || 0); h[n === 5 ? '5+' : n]++; }
  return h;
};
{
  const houses = outlines.filter((o) => G.buildings[o.row] && G.buildings[o.row][5] === 0);
  log(`\n== House outlines (GEO.buildings kind 0): ${houses.length}`);
  const res = { candidate: 'Address points and parcels per house outline', houseOutlines: houses.length };
  if (has(addressFile)) {
    const pts = JSON.parse(fs.readFileSync(addressFile, 'utf8')).elements.map((e) => {
      const [x, z] = project(P, e.LONGITUDE, e.LATITUDE);
      return { x, z, id: e.ADDRESS_POINT_ID };
    }).filter((p) => inDetail(G, p.x, p.z));
    const counts = countInside(G, houses, pts);
    res.addressPoints = { recordsInFrame: pts.length, houseOutlinesByAddressPoints: histOf(counts, houses) };
    log(`   address points in the frame ${pts.length}; house outlines by address points inside ${JSON.stringify(res.addressPoints.houseOutlinesByAddressPoints)}`);
  }
  if (has(parcelsFile)) {
    const polys = JSON.parse(fs.readFileSync(parcelsFile, 'utf8'));
    const counts = countPolygonsCentredInside(G, houses, polys);
    res.parcels = { parcelPolygonsInFrame: polys.length, houseOutlinesByParcelsCrossed: histOf(counts, houses) };
    log(`   parcel polygons in the frame ${polys.length}; house outlines by parcels centred inside ${JSON.stringify(res.parcels.houseOutlinesByParcelsCrossed)}`);
  }
  results.push(res);
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. City open data with a year but no building record: what each can and cannot place
// ---------------------------------------------------------------------------------------------------------------------
for (const f of ['cot/toronto-building-service-layers.json', 'cot/restsafeto-building-layer.json', 'cot/building-outline-topographic-layer.json', 'cot/zoning-area-2021-sample.json']) {
  if (!has(path.join(CACHE, f))) continue;
  const j = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));
  const names = j.layers ? j.layers.map((l) => l.name) : j.fields ? j.fields.map((x) => x.name) : Object.keys(j);
  results.push({ candidate: f, layersOrFields: names.slice(0, 40) });
}

const out = {
  generatedAt: new Date().toISOString(),
  geodata: G.version,
  frame: G.frame.detail,
  buildThresholds: { match: 'point inside the outline, else the nearest outline edge within 15 m', eras: ERAS },
  totalMassingOutlines: TOTAL,
  outlinesWithoutAGeodataRow: skipped,
  candidates: results,
};
if (!opt.quiet) log(`\n== total massing outlines ${TOTAL}`);
if (opt.json) { fs.writeFileSync(opt.json, JSON.stringify(out, null, 1)); log(`wrote ${opt.json}`); }
else console.log(JSON.stringify(out, null, 1));

// ---------------------------------------------------------------------------------------------------------------------
/** ArcGIS feature query (f=json -> { features: [{ attributes, geometry }] }) as rows with lon/lat and the attributes */
export function readArcgis(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  // An ArcGIS response (features[{ attributes, geometry }]) or the flat { elements } form the fetch script writes
  const elements = j.elements ? j.elements : (j.features || []).map((f) => {
    const a = f.attributes || f;
    const g = f.geometry || {};
    return { ...a, X: a.X ?? g.x, Y: a.Y ?? g.y, LONGITUDE: a.LONGITUDE ?? (g.x ?? a.X), LATITUDE: a.LATITUDE ?? (g.y ?? a.Y) };
  });
  return { elements };
}

/** "4434 KINGSTON RD" and the permit's STREET_NUM / STREET_NAME / STREET_TYPE / STREET_DIRECTION -> one comparable key */
export function addressKey(num, rest) {
  const norm = (s) => String(s || '').toUpperCase()
    .replace(/\bNORTH\b/g, 'N').replace(/\bSOUTH\b/g, 'S').replace(/\bEAST\b/g, 'E').replace(/\bWEST\b/g, 'W')
    .replace(/\b(STREET|AVENUE|ROAD|DRIVE|BOULEVARD|CRESCENT|COURT|PLACE|LANE|TERRACE|WAY|TRAIL|GARDENS|GATE|GROVE|HEIGHTS|HILL|PARK|PATH|CIRCLE|SQUARE|MEWS|PARKWAY|GREEN|COMMON|WALK)\b/g, (m) => ({ STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', DRIVE: 'DR', BOULEVARD: 'BLVD', CRESCENT: 'CRES', COURT: 'CT', PLACE: 'PL', LANE: 'LN', TERRACE: 'TER', WAY: 'WAY', TRAIL: 'TRL', GARDENS: 'GDNS', GATE: 'GT', GROVE: 'GRV', HEIGHTS: 'HTS', HILL: 'HILL', PARK: 'PK', PATH: 'PATH', CIRCLE: 'CIR', SQUARE: 'SQ', MEWS: 'MEWS', PARKWAY: 'PKWY', GREEN: 'GRN', COMMON: 'COMMON', WALK: 'WALK' })[m]).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const n = String(num == null ? '' : num).replace(/[^0-9A-Z-]/gi, '').toUpperCase();
  return (n ? n + ' ' : '') + norm(rest);
}

/** An OSM start_date ("1893", "2003-04-01", "2018-04", "~1886") as a year */
export function osYear(s) {
  if (!s) return null;
  const m = String(s).match(/\b(1[5-9]\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
}

/** 50 m grid of points { x, z, ... } for nearest-address lookups */
export function indexPoints(points) {
  const CELL = 50;
  const cells = new Map();
  for (const p of points) { const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(p); }
  return { CELL, cells };
}
