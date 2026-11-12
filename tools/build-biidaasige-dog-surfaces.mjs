#!/usr/bin/env node
// tools/build-biidaasige-dog-surfaces.mjs
// Validates the CHECKED-IN dog-turf ortho fixture and (re)injects its compact data block into the runtime module.
//
//   tools/fixtures/biidaasige-dog-turf-ortho.json   the Captain's dedicated 2025 City 8 cm ortho trace
//   js/biidaasige-dog-surfaces.js                   the runtime module, whose DATA block is generated from the fixture
//
// The fixture carries the actual WGS turf rings the Captain traced inside the pale curb, the export extents and the
// published whole nominal dog-area sizes. It is NOT a whole-area turf source: the OSM dog-area rings include the
// surrounding asphalt apron. The generator copies the turf rings verbatim, keeps the 3 m registration uncertainty and
// the .5 m trace tolerance, and writes the module's DATA const. It never renders, places a mesh, invents a fence/gate,
// or expands the published boundary.
//
//   node tools/build-biidaasige-dog-surfaces.mjs          # write the DATA block into js/biidaasige-dog-surfaces.js
//   node tools/build-biidaasige-dog-surfaces.mjs --check  # exit 1 if the committed module is stale
//
// Portable: reads only repo files, no /tmp or network dependency. See docs/biidaasige-dog-surfaces.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_PATH = 'tools/fixtures/biidaasige-dog-turf-ortho.json';
const CITY_FIXTURE_PATH='tools/fixtures/biidaasige-dog-turf-city.json';
const MODULE_PATH = 'js/biidaasige-dog-surfaces.js';
const DATA_START = '// >>> DOG_SURFACES_DATA';
const DATA_END = '// <<< DOG_SURFACES_DATA';

function fail(msg) {
  console.error(`[biidaasige-dog-surfaces] INVALID FIXTURE: ${msg}`);
  process.exit(1);
}

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, FIXTURE_PATH), 'utf8'));
if (!fixture || !Array.isArray(fixture.features) || !fixture.features.length) fail('features[] missing');
if (!(typeof fixture.errorM === 'number' && fixture.errorM > 0)) fail('errorM missing');
if (!(typeof fixture.traceToleranceM === 'number' && fixture.traceToleranceM > 0)) fail('traceToleranceM missing');

const city=JSON.parse(fs.readFileSync(path.join(ROOT,CITY_FIXTURE_PATH),'utf8'));
const features = fixture.features.map((f) => {
  const side=f.id.includes('west')?'West':'East';
  const asset=city.response.features.find(a=>a.attributes.ASSET_NAME.endsWith('('+side+')'));
  if(!asset?.geometry?.rings?.[0])fail(f.id+': City asset ring missing');
  const ring=asset.geometry.rings[0].map(([lon,lat])=>[lat,lon]);
  if (!f.id) fail('feature id missing');
  if (!Array.isArray(f.turfRingLatLon) || f.turfRingLatLon.length < 3) fail(`${f.id}: turfRingLatLon needs >=3 points`);
  for (const p of f.turfRingLatLon) {
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      fail(`${f.id}: invalid turf vertex`);
    }
  }
  if (!(typeof f.nominalWholeAreaM2 === 'number' && f.nominalWholeAreaM2 > 0)) fail(`${f.id}: nominalWholeAreaM2 missing`);
  return {
    id: f.id,
    nominalWholeAreaM2: f.nominalWholeAreaM2,
    dimensionStatus: f.dimensionStatus || null,
    turfRingLatLon: ring,
    geometrySource:{url:city.layerUrl,objectId:asset.attributes.OBJECTID,assetId:asset.attributes.ASSET_ID,assetName:asset.attributes.ASSET_NAME,created:asset.attributes.CREATION_DATE,modified:asset.attributes.LASTMODIFIED_DATE,interpretation:'City asset polygon matches artificial-turf island in independently reviewed orthophoto; not a fence boundary or a surveyed elevation.'},
    export: f.export
      ? { width: f.export.width, height: f.export.height, scale: f.export.scale, extent: f.export.extent }
      : null
  };
});

const DATA = {
  schema: 'biidaasige-dog-surfaces/1',
  source: city.layerUrl,
  vintage: 'City asset records created April2026, modified May2026, retrieved2026-11-11; independently checked against2025 City orthophoto.',
  interpretation:city.captainValidation,
  validationSource:fixture.source,
  errorM: fixture.errorM,
  traceToleranceM: fixture.traceToleranceM,
  features
};

const block = `${DATA_START}\nconst DATA = ${JSON.stringify(DATA)};\n${DATA_END}`;
const moduleSrc = fs.readFileSync(path.join(ROOT, MODULE_PATH), 'utf8');
const start = moduleSrc.indexOf(DATA_START);
const end = moduleSrc.indexOf(DATA_END);
if (start < 0 || end < 0 || end < start) fail(`module markers missing in ${MODULE_PATH}`);
const next = moduleSrc.slice(0, start) + block + moduleSrc.slice(end + DATA_END.length);

if (process.argv.includes('--check')) {
  if (next !== moduleSrc) {
    console.error('[biidaasige-dog-surfaces] STALE: run node tools/build-biidaasige-dog-surfaces.mjs');
    process.exit(1);
  }
  console.log('[biidaasige-dog-surfaces] up to date');
  process.exit(0);
}

fs.writeFileSync(path.join(ROOT, MODULE_PATH), next);
console.log(`[biidaasige-dog-surfaces] wrote ${features.length} feature(s) into ${MODULE_PATH}`);
