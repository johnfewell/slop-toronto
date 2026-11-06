// Naturalistic water edges (st-de3g): js/water-edges.js sorts the city's water outlines into natural shores (bank,
// beach, marsh), which get the apron, the shallows & the sand, and engineered ones, which stay crisp. The shore data is
// js/toronto-shores.js (tools/build-shores.mjs, from OpenStreetMap).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
// (the city with the water edges, `search` its page query: ?shores=all classifies every natural shore of the map, by
// default only the rollout's areas get theirs)
const city = (search) => {
  const context = vm.createContext({
    window: { CITY: {} }, console: { info() {}, log() {}, warn() {} }, Buffer, URLSearchParams, performance,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'), location: { search }
  });
  for (const path of ['js/toronto-geodata.js', 'js/high-park-data.js', 'js/don-valley.js', 'js/city-config.js', 'js/toronto-shores.js', 'js/water-edges.js']) vm.runInContext(read(path), context);
  return context.window.CITY;
};
const C = city('?shores=all');
const WE = C.waterEdges;
const runs = WE.naturalShores();
const samples = runs.flatMap((r) => r.pts.map((p) => ({ ...p, level: r.level, pilot: r.pilot })));
const near = (x, z, r) => samples.filter((p) => Math.hypot(p.x - x, p.z - z) < r);
const length = (list) => list.reduce((t, r) => t + r.pts.reduce((u, p, i) => u + (i ? Math.hypot(p.x - r.pts[i - 1].x, p.z - r.pts[i - 1].z) : 0), 0), 0);
const BANK = 1, BEACH = 2;

test('the shore data carries the beaches, wetlands & engineered edges from OpenStreetMap', () => {
  const names = new Set(C.SHORES.beaches.map((b) => b.n));
  for (const n of ['Cherry Beach', 'Sunnyside Beach', 'Wards Island Beach', 'Gibraltar Point Beach']) assert.ok(names.has(n), `${n} is in the shore data`);
  assert.ok(C.SHORES.wetlands.length > 20, `${C.SHORES.wetlands.length} wetlands`);
  const kinds = new Set(C.SHORES.hard.map((h) => h.k));
  for (const k of ['pier', 'breakwater', 'wall']) assert.ok(kinds.has(k), `hard edges include ${k}`);
});

test('natural shores: Grenadier Pond, the Island lagoons & beaches, Cherry Beach', () => {
  const total = length(runs);
  assert.ok(total > 30000 && total < 90000, `${Math.round(total)} m of natural shore`);
  // Grenadier Pond (High Park's pilot pond, at its own level): most of its outline is a natural bank or marsh
  const g = C.POND_BODIES.find((w) => w.name === 'Grenadier Pond');
  let per = 0;
  for (let i = 0; i < g.pts.length; i++) { const a = g.pts[i], b = g.pts[(i + 1) % g.pts.length]; per += Math.hypot(b.x - a.x, b.z - a.z); }
  const onG = samples.filter((p) => p.pilot && Math.abs(p.level - C.DON_VALLEY.pondLevel(g)) < 1e-6 && p.x > g.minX - 1 && p.x < g.maxX + 1 && p.z > g.minZ - 1 && p.z < g.maxZ + 1);
  assert.ok(onG.length * 1.5 > per * 0.7, `Grenadier Pond: ${onG.length * 1.5} of ${Math.round(per)} m natural`);
  // the Island's lake-facing south shore is beach; a lagoon's bank is a bank
  assert.ok(near(1000, 2560, 120).some((p) => p.cls === BEACH), "Ward's Island's south shore is a beach");
  assert.ok(near(-400, 2987, 20).some((p) => p.cls === BANK), 'the lagoon south of Centre Island has a natural bank');
  // Cherry Beach (mapped natural=beach on the mainland's lake shore)
  assert.ok(near(2700, 1690, 60).some((p) => p.cls === BEACH), 'Cherry Beach is a beach');
});

test('engineered edges stay crisp: the harbour, the slips & channels, Ontario Place, mapped hard edges', () => {
  for (const [x0, z0, x1, z1] of WE.HARD_ZONES) {
    const inZone = samples.filter((p) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1);
    assert.equal(inZone.length, 0, `no natural shore in the hard zone ${[x0, z0, x1, z1]}`);
  }
  for (const w of C.WATER_BODIES.filter((b) => /Slip|Channel|Basin/.test(b.name || ''))) {
    const on = samples.filter((p) => p.x > w.minX && p.x < w.maxX && p.z > w.minZ && p.z < w.maxZ && C.waterAt(p.x + p.nx * 2, p.z + p.nz * 2) === w);
    assert.equal(on.length, 0, `${w.name} keeps its walls`);
  }
  // the mainland lake shore between the beaches: armour stone (Humber Bay Shores' front, west of the Humber's mouth)
  assert.equal(near(-7600, -120, 150).filter((p) => !p.pilot).length, 0, 'Humber Bay Shores keeps its armour stone');
});

test('every sample faces the water and has a level & a land top above it', () => {
  for (const p of samples) {
    assert.ok(C.waterAt(p.x + p.nx * 2, p.z + p.nz * 2) || C.waterAt(p.x + p.nx * 4, p.z + p.nz * 4) || !C.waterAt(p.x - p.nx * 2, p.z - p.nz * 2), `the water side at ${p.x.toFixed(0)},${p.z.toFixed(0)}`);
    assert.ok(Number.isFinite(p.top) && Number.isFinite(p.level), 'heights');
  }
});

test('the rollout: by default only the pilot areas (High Park, the Toronto Islands) get their natural shores', () => {
  const pilot = city('').waterEdges;
  const inside = (p) => Object.values(pilot.ROLLOUT).some(([x0, z0, x1, z1]) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1);
  const runsPilot = pilot.naturalShores();
  const pts = runsPilot.flatMap((r) => r.pts);
  assert.ok(pts.length > 1000, `${pts.length} samples in the pilot`);
  assert.equal(pts.filter((p) => !inside(p)).length, 0, 'no natural shore outside the rollout');
  assert.ok(length(runsPilot) < length(runs), 'the pilot is a part of the whole');
});
