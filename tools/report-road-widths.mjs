// tools/report-road-widths.mjs — what the road-width rule of tools/geo-blocks.mjs does to a frame (docs/road-widths.md):
// the roads with no mapped surface (City Edge of Roadway or tools/fixtures/road-surfaces.json) that are now drawn at
// their own width instead of a 4 m connector, by class and by street, and the stretches worth a look: under a deck, a
// City polygon close by but out of reach (an offset polygon?), service roads and ramps.
// usage: GEO_DATA=<dir> node --max-old-space-size=12288 tools/report-road-widths.mjs [--frame <frame.json>] [--json out.json]
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { toLonLat } from './geo-base.mjs';
import { rasterRoads } from './geo-roads.mjs';
import { roadCover, specks, CONNECTOR, COVER_TOL, surfaceRaster, surfaceNear } from './geo-blocks.mjs';

const { values: A } = parseArgs({ options: { frame: { type: 'string' }, json: { type: 'string' } }, strict: false });
const km = (m) => Math.round(m / 100) / 10;

// deck pieces, for "under a deck"
const decks = rasterRoads.filter((s) => s.deck);
const cell = 50;
const grid = new Map();
for (const s of decks) {
  for (let gx = Math.floor((Math.min(s.x0, s.x1) - s.r) / cell); gx <= Math.floor((Math.max(s.x0, s.x1) + s.r) / cell); gx++) {
    for (let gz = Math.floor((Math.min(s.z0, s.z1) - s.r) / cell); gz <= Math.floor((Math.max(s.z0, s.z1) + s.r) / cell); gz++) {
      const k = gx + ',' + gz;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(s);
    }
  }
}
function underDeck(x, z) {
  for (const s of grid.get(Math.floor(x / cell) + ',' + Math.floor(z / cell)) || []) {
    const dx = s.x1 - s.x0, dz = s.z1 - s.z0, L2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - s.x0) * dx + (z - s.z0) * dz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (Math.hypot(s.x0 + t * dx - x, s.z0 + t * dz - z) <= s.r) return true;
  }
  return false;
}

const byClass = {}, byName = {};
let deckLen = 0, nearLen = 0;
const deckRuns = [], nearRuns = [];
const NEAR = 6; // m past the reach: a City polygon this close may be the same road, offset
for (const c of roadCover) {
  byClass[c.cls] = (byClass[c.cls] || 0) + c.openLength;
  const name = c.name || `(unnamed ${c.cls})`;
  byName[name] = byName[name] || { length: 0, cls: new Set(), w: new Set() };
  byName[name].length += c.openLength;
  byName[name].cls.add(c.cls);
  byName[name].w.add(c.w);
  const under = c.open.filter(([x, z]) => underDeck(x, z)).length;
  const near = c.open.filter(([x, z]) => surfaceNear(surfaceRaster, x, z, c.reach + NEAR)).length;
  if (near) { nearLen += near; nearRuns.push({ name, cls: c.cls, m: near, at: toLonLat(...c.open[0]).map((v) => +v.toFixed(5)) }); }
  if (under) { deckLen += under; deckRuns.push({ name, cls: c.cls, m: under, at: toLonLat(...c.open[0]).map((v) => +v.toFixed(5)) }); }
}
const total = Object.values(byClass).reduce((a, b) => a + b, 0);
const out = {
  rule: { connector: CONNECTOR * 2, coverTolerance: COVER_TOL },
  openKm: km(total),
  byClass: Object.fromEntries(Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, km(v)])),
  topStreets: Object.entries(byName).filter(([n]) => !n.startsWith('(')).sort((a, b) => b[1].length - a[1].length).slice(0, 20)
    .map(([n, v]) => ({ name: n, km: km(v.length), cls: [...v.cls].join('/'), widths: [...v.w].sort().join('/') })),
  unnamedKm: km(Object.entries(byName).filter(([n]) => n.startsWith('(')).reduce((a, [, v]) => a + v.length, 0)),
  nearSurfaceKm: km(nearLen),
  nearSurface: nearRuns.sort((a, b) => b.m - a.m).slice(0, 20),
  underDeckKm: km(deckLen),
  underDeck: deckRuns.sort((a, b) => b.m - a.m).slice(0, 15),
  // land islands under 40 m², dropped and drawn as roadway: their count and area, and the size of the largest
  specks: { count: specks.length, m2: specks.reduce((a, s) => a + s.area, 0), under5m2: specks.filter((s) => s.area < 5).length,
    largest: specks.slice().sort((a, b) => b.area - a.area).slice(0, 5).map((s) => ({ x: Math.round(s.x), z: Math.round(s.z), m2: s.area })) }
};
console.log(JSON.stringify(out, null, 1));
if (A.json) fs.writeFileSync(A.json, JSON.stringify({ ...out, runs: roadCover.map((c) => ({ ...c, open: undefined, openStretches: c.open.length })) }));
