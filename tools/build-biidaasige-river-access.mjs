#!/usr/bin/env node
// tools/build-biidaasige-river-access.mjs
// Validates the CHECKED-IN river-access source fixture and (re)injects its data block into the runtime module.
//
//   tools/fixtures/biidaasige-river-access.json   the OSM Overpass source + the committed park polygon + water rings
//   js/biidaasige-river-access.js                 the runtime module, whose DATA block is generated from the fixture
//
// The fixture is a current OpenStreetMap Overpass extract (fetched 2026-11-10) for the Biidaasige Park bbox PLUS
// the two registered Canoe Cove map anchors (tools/fixtures/biidaasige-registration.json). It carries exact source
// geometry for beaches (natural=beach), slipways (leisure=slipway), piers (man_made=pier) and fishing access
// (leisure=fishing) INSIDE the park. It also carries the committed park polygon and the 9 mapped water/wetland
// rings, copied verbatim from js/biidaasige-park-data.js, so the runtime's shore-distance check is self-contained.
//
// The generator does NOT render, place a mesh, invent a dock, boat or toilet, or move a feature onto the park. It
// copies the source geometry verbatim, rejects a feature outside the park bbox, and writes the module's DATA const.
//
//   node tools/build-biidaasige-river-access.mjs          # write the DATA block into js/biidaasige-river-access.js
//   node tools/build-biidaasige-river-access.mjs --check  # exit 1 if the committed module is stale
//
// Data © OpenStreetMap contributors (ODbL 1.0). See docs/biidaasige-river-access.md.

import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_PATH = 'tools/fixtures/biidaasige-river-access.json';
const MODULE_PATH = 'js/biidaasige-river-access.js';
const PARK_DATA_PATH = 'js/biidaasige-park-data.js';

const DATA_START = '// >>> RIVER_ACCESS_DATA';
const DATA_END = '// <<< RIVER_ACCESS_DATA';

const KINDS = new Set(['beach', 'slipway', 'pier', 'fishing']);
const GEOMETRY = new Set(['polygon', 'line', 'point']);

function fail(msg) {
  console.error(`[biidaasige-river-access] INVALID FIXTURE: ${msg}`);
  process.exit(1);
}

function loadPark() {
  const ctx = { window: { CITY: {} }, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + PARK_DATA_PATH, 'utf8'), ctx, { filename: PARK_DATA_PATH });
  return ctx.window.CITY.BIIDAASIGE_PARK;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a / 2);
}
function inRing(ring, lat, lon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function validate(fixture, park) {
  if (!fixture || fixture.schema !== 'biidaasige-river-access/1') fail('unexpected schema ' + (fixture && fixture.schema));
  if (!fixture.park || !Array.isArray(fixture.park.polygon) || fixture.park.polygon.length < 3) fail('missing park polygon');
  // the fixture park polygon must be byte-identical to the committed one
  const committed = JSON.stringify(park.park.polygon);
  if (JSON.stringify(fixture.park.polygon) !== committed) fail('park polygon differs from js/biidaasige-park-data.js');
  if (!Array.isArray(fixture.waterRings) || fixture.waterRings.length !== (park.waterGeometry || []).length) {
    fail('waterRings count differs from the committed park data');
  }
  for (let i = 0; i < fixture.waterRings.length; i++) {
    const a = JSON.stringify(fixture.waterRings[i].ring), b = JSON.stringify(park.waterGeometry[i].ring);
    if (a !== b) fail(`waterRings[${i}] ring differs from the committed park data`);
  }
  if (!Array.isArray(fixture.features) || !fixture.features.length) fail('no features');
  const ids = new Set();
  const bbox = fixture.source?.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4) fail('missing source bbox');
  for (const f of fixture.features) {
    if (!f || typeof f.id !== 'string') fail('feature without id');
    if (ids.has(f.id)) fail('duplicate feature id ' + f.id);
    ids.add(f.id);
    if (!KINDS.has(f.kind)) fail(`feature ${f.id} has unknown kind ${f.kind}`);
    if (!GEOMETRY.has(f.geometryType)) fail(`feature ${f.id} has unknown geometryType ${f.geometryType}`);
    if (!/^(way|node)\/\d+$/.test(f.ref)) fail(`feature ${f.id} has a non-OSM ref ${f.ref}`);
    if (f.geometryType === 'point') {
      if (typeof f.lat !== 'number' || typeof f.lon !== 'number') fail(`point ${f.id} lacks lat/lon`);
    } else {
      if (!Array.isArray(f.geometry) || f.geometry.length < 2) fail(`feature ${f.id} lacks geometry`);
      if (f.geometryType === 'polygon' && f.geometry.length < 3) fail(`polygon ${f.id} has < 3 vertices`);
      if (f.geometryType === 'polygon' && ringArea(f.geometry) < 1e-9) fail(`polygon ${f.id} has no area`);
      for (const pt of f.geometry) {
        if (!Array.isArray(pt) || pt.length !== 2 || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) fail(`feature ${f.id} has a bad vertex`);
        if (pt[0] < bbox[0] || pt[0] > bbox[2] || pt[1] < bbox[1] || pt[1] > bbox[3]) fail(`feature ${f.id} vertex outside the source bbox`);
      }
    }
  }
  for (const a of fixture.registration?.anchors || []) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number') fail('registration anchor lacks lat/lon');
    if (!Number.isFinite(a.approxErrorM) || a.approxErrorM <= 0) fail('registration anchor lacks an error budget');
  }
}

function renderDataConst(fixture) {
  return `const DATA = ${JSON.stringify(fixture)};`;
}

function replaceBlock(moduleSource, dataConst) {
  const start = moduleSource.indexOf(DATA_START);
  const end = moduleSource.indexOf(DATA_END);
  if (start < 0 || end < 0 || end < start) {
    console.error('[biidaasige-river-access] DATA markers not found in the module');
    process.exit(1);
  }
  const before = moduleSource.slice(0, start);
  const after = moduleSource.slice(end);
  return `${before}${DATA_START}\n${dataConst}\n${after}`;
}

const fixture = JSON.parse(fs.readFileSync(ROOT + FIXTURE_PATH, 'utf8'));
const park = loadPark();
validate(fixture, park);

const dataConst = renderDataConst(fixture);
const modulePath = ROOT + MODULE_PATH;
const current = fs.readFileSync(modulePath, 'utf8');
const next = replaceBlock(current, dataConst);
const check = process.argv.includes('--check');

if (check) {
  if (next !== current) {
    console.error('[biidaasige-river-access] js/biidaasige-river-access.js is STALE; run the builder.');
    process.exit(1);
  }
  console.log(`[biidaasige-river-access] OK — ${fixture.features.length} features, ${fixture.waterRings.length} water rings, module up to date.`);
} else {
  fs.writeFileSync(modulePath, next);
  console.log(`[biidaasige-river-access] wrote ${MODULE_PATH} from ${fixture.features.length} features.`);
}
