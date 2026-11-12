#!/usr/bin/env node
// tools/build-biidaasige-lighting.mjs
// Re-validates (and, without --check, rewrites) the checked-in source record
//   tools/fixtures/biidaasige-lighting.json
//
// The fixture is a current OpenStreetMap Overpass geometry extract (fetched 2026-11-10) for the Biidaasige Park bbox:
// every highway=street_lamp node, every tourism=information node and every barrier=bollard node/way. This script
// re-runs the ray-cast point-in-polygon test against the committed park polygon
// (js/biidaasige-park-data.js BIIDAASIGE_PARK.park.polygon) and refreshes the derived fields:
//   elements[].inPark, elements[].kind, sourceSites, unplaced, context, classification.
//
// It does NOT fetch the network, render, place a mesh, or invent a lamp/bollard. The raw Overpass elements are the
// source of truth; the classification is the only thing recomputed.
//
//   node tools/build-biidaasige-lighting.mjs          # rewrite the fixture's derived fields
//   node tools/build-biidaasige-lighting.mjs --check  # exit 1 if the committed fixture is stale
//
// Data © OpenStreetMap contributors (ODbL 1.0). See docs/biidaasige-lighting.md.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_PATH = 'tools/fixtures/biidaasige-lighting.json';
const PARK_DATA_PATH = 'js/biidaasige-park-data.js';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function parkPolygon() {
  const ctx = { window: { CITY: {} } };
  vm.runInNewContext(read(PARK_DATA_PATH), ctx);
  const poly = ctx.window.CITY.BIIDAASIGE_PARK?.park?.polygon;
  if (!Array.isArray(poly) || poly.length < 3) throw new Error('BIIDAASIGE_PARK.park.polygon missing');
  return poly;
}

function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function kindOf(tags = {}) {
  if (tags.highway === 'street_lamp') return 'streetLamp';
  if (tags.information) return 'wayfinding';
  if (tags.barrier === 'bollard') return 'bollard';
  return 'other';
}

function derive(fixture, poly) {
  const elements = (fixture.elements || []).map((e) => {
    const tags = e.tags || {};
    const inPark = e.type === 'node' && isNum(e.lat) && isNum(e.lon) ? pointInRing(e.lat, e.lon, poly) : false;
    return { ...e, kind: kindOf(tags), inPark };
  });
  const inside = elements.filter((e) => e.inPark);
  const sourceSites = inside.map((e) => ({
    id: `osm-node-${e.id}`,
    osmId: e.id,
    kind: e.kind,
    lat: e.lat,
    lon: e.lon,
    tags: e.tags,
    placement: 'osm-node',
    positionConfidence: 'mapped'
  }));
  const counts = {};
  for (const e of elements) {
    const key = `${e.kind}${e.inPark ? '-in' : '-out'}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return {
    ...fixture,
    classification: {
      method: 'ray-cast point-in-polygon against BIIDAASIGE_PARK.park.polygon (lat/lon)',
      inside: inside.length,
      outside: elements.length - inside.length,
      counts
    },
    sourceSites,
    unplaced: {
      streetLamps: inside.filter((e) => e.kind === 'streetLamp').length,
      bollards: inside.filter((e) => e.kind === 'bollard').length
    },
    context: {
      streetLampsOutside: elements.filter((e) => e.kind === 'streetLamp' && !e.inPark).length,
      bollardsOutside: elements.filter((e) => e.kind === 'bollard' && !e.inPark).length
    },
    elements
  };
}

const check = process.argv.includes('--check');
const fixture = JSON.parse(read(FIXTURE_PATH));
const poly = parkPolygon();
const next = derive(fixture, poly);
const nextText = JSON.stringify(next, null, 1) + '\n';
const currentText = read(FIXTURE_PATH);

if (check) {
  if (nextText !== currentText) {
    console.error(`[biidaasige-lighting] ${FIXTURE_PATH} is stale; run node tools/build-biidaasige-lighting.mjs`);
    process.exit(1);
  }
  console.log(`[biidaasige-lighting] ${FIXTURE_PATH} is current (${next.sourceSites.length} in-park sites)`);
} else {
  fs.writeFileSync(path.join(ROOT, FIXTURE_PATH), nextText);
  console.log(`[biidaasige-lighting] wrote ${FIXTURE_PATH}: ${next.sourceSites.length} in-park sites, ` +
    `${next.unplaced.streetLamps} lamps / ${next.unplaced.bollards} bollards inside`);
}
