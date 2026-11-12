#!/usr/bin/env node
// tools/build-biidaasige-woodchip-island.mjs
// Validates the CHECKED-IN woodchip-island source fixture and (re)injects its data block into the runtime module.
//
//   tools/fixtures/biidaasige-woodchip-island.json   the Captain's aerial trace + source export metadata + finish choices
//   js/biidaasige-woodchip-island.js                 the runtime module, whose DATA block is generated from the fixture
//
// The fixture is READONLY here: the Captain owns it. This builder copies it verbatim into the module's DATA const and
// refuses a fixture that is missing the trace, the source export, the uncertainty budget or the explicit finish
// choices. It does not render, place a mesh, invent an animal/trunk, or move the trace.
//
//   node tools/build-biidaasige-woodchip-island.mjs          # write the DATA block into the module
//   node tools/build-biidaasige-woodchip-island.mjs --check  # exit 1 if the committed module is stale
//
// Source: City of Toronto 2025 ortho (aerial trace by the Captain, 2026-11-11). See docs/biidaasige-woodchip-island.md.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_PATH = 'tools/fixtures/biidaasige-woodchip-island.json';
const MODULE_PATH = 'js/biidaasige-woodchip-island.js';
const DATA_START = '// >>> WOODCHIP_ISLAND_DATA';
const DATA_END = '// <<< WOODCHIP_ISLAND_DATA';

function fail(msg) {
  console.error(`[biidaasige-woodchip-island] INVALID FIXTURE: ${msg}`);
  process.exit(1);
}

const fixture = JSON.parse(fs.readFileSync(ROOT + FIXTURE_PATH, 'utf8'));

if (fixture.schema !== 'biidaasige-woodchip-island/1') fail('unexpected schema ' + fixture.schema);
if (!Array.isArray(fixture.ringLatLon) || fixture.ringLatLon.length < 3) fail('ringLatLon needs >= 3 vertices');
if (!Array.isArray(fixture.tracePixels) || fixture.tracePixels.length !== fixture.ringLatLon.length) {
  fail('tracePixels must match ringLatLon length');
}
for (const p of fixture.ringLatLon) {
  if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
    fail('bad ringLatLon vertex');
  }
}
const f = fixture.finishChoices || {};
if (f.groundY !== 0.224) fail('groundY must be 0.224');
if (f.woodchipY !== 0.232) fail('woodchipY must be 0.232');
if (f.curbWidthM !== 0.12) fail('curbWidthM must be 0.12');
if (f.curbRiseM !== 0.06) fail('curbRiseM must be 0.06');
if (!Number.isFinite(fixture.traceErrorM) || fixture.traceErrorM <= 0) fail('traceErrorM missing');
if (!Number.isFinite(fixture.placementUncertaintyM) || fixture.placementUncertaintyM <= 0) fail('placementUncertaintyM missing');
if (!fixture.sourceExport || !fixture.sourceExport.extent) fail('sourceExport extent missing');
if (!fixture.sourceUrl) fail('sourceUrl missing');

// The fixture's privateReference is a Captain-only local path; never copy it into the runtime module.
const runtimeData = { ...fixture };
delete runtimeData.privateReference;
const dataConst = `const DATA = ${JSON.stringify(runtimeData)};`;
const modulePath = ROOT + MODULE_PATH;
const current = fs.readFileSync(modulePath, 'utf8');
const start = current.indexOf(DATA_START);
const end = current.indexOf(DATA_END);
if (start < 0 || end < 0 || end < start) {
  console.error('[biidaasige-woodchip-island] DATA markers not found in the module');
  process.exit(1);
}
const next = `${current.slice(0, start)}${DATA_START}\n${dataConst}\n${current.slice(end)}`;
const check = process.argv.includes('--check');

if (check) {
  if (next !== current) {
    console.error('[biidaasige-woodchip-island] js/biidaasige-woodchip-island.js is STALE; run the builder.');
    process.exit(1);
  }
  console.log(`[biidaasige-woodchip-island] OK — ${fixture.ringLatLon.length} traced vertices, module up to date.`);
} else {
  fs.writeFileSync(modulePath, next);
  console.log(`[biidaasige-woodchip-island] wrote ${MODULE_PATH} from ${fixture.ringLatLon.length} traced vertices.`);
}
