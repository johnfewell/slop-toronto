// The low-vegetation source audit (tools/audit-island-low-vegetation.mjs, docs/waterfront-island-low-vegetation.md,
// bead st-sb3r.35). These prove the audit's geometry and classification over the REAL committed lanes, water and the
// saved OSM buildings, through the tool's own exported helpers and its CLI, without inventing a planting pass:
//   - the corridor is only the photographed Oneida/Ojibway centre-line envelope, inside the detail frame;
//   - a point under the lake's land hole (an island) is NOT water, and a point in the open lake IS;
//   - the height classifier puts 1-5 m in `low`, keeps < 1 m bare and >= 5 m tall (the understory blind spot);
//   - the actual OSM building polygons and every mapped paved lane are excluded from the eligible ground;
//   - the CLI runs on the cached lidar (or reports the exact missing-cache error) and reports bounded counts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
// Private research cache (reference downloads that never ship): set WATERFRONT_RESEARCH to its folder.
const WATERFRONT_RESEARCH = process.env.WATERFRONT_RESEARCH || path.join(os.tmpdir(), 'waterfront-research');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOOL = path.join(ROOT, 'tools/audit-island-low-vegetation.mjs');
const AUDIT = await import(new URL('../tools/audit-island-low-vegetation.mjs', import.meta.url));
const { loadCity } = await import(new URL('../tools/terrain-pilot-lib.mjs', import.meta.url));

const C = loadCity(['js/waterfront-island-lanes-data.js']);
const PROJ = C.GEO.frame.projection;
const worldFromLatLon = (lat, lon) => {
  const e = (lon - PROJ.lon0) * PROJ.kx, n = (lat - PROJ.lat0) * PROJ.ky;
  const c = Math.cos(PROJ.theta), s = Math.sin(PROJ.theta);
  return { x: e * c - n * s - PROJ.ox, z: -(e * s + n * c) - PROJ.oz };
};
const corridorLanes = (C.ISLAND_LANES_DATA.runs || []).filter((r) => (r.names || []).some((n) => /oneida|ojibway/i.test(n)));
const BUILDINGS = path.join(WATERFRONT_RESEARCH, 'research/island-cottages/b.json');
const cacheDir = process.env.DON_VALLEY_DTM || path.join(process.env.HOME || '', '.cache/slop-toronto/raw/ontario-dtm-gta2023');
const hasCache = fs.existsSync(path.join(cacheDir, 'manifest-toronto-island-dsm.json')) && fs.existsSync(path.join(cacheDir, 'manifest-toronto-island.json'));

test('the audit binds exactly the Oneida and Ojibway photographed lanes', () => {
  assert.equal(corridorLanes.length, 2);
  const names = corridorLanes.map((r) => r.names[0]).sort();
  // (cross-vm arrays have a different realm's Array prototype, so compare values, not prototype identity)
  assert.deepEqual([...names], ['Ojibway Avenue', 'Oneida Avenue']);
});

test('the corridor is the photographed centre-line envelope (12 m) only', () => {
  // A point on the centre line and a point just inside 12 m belong to the corridor; a point beyond it does not.
  for (const r of corridorLanes) {
    const [ax, az] = r.points[0], [bx, bz] = r.points[r.points.length - 1];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    assert.ok(AUDIT.corridorDistance(corridorLanes, mx, mz).d <= 12 + 1e-9);
    const far = AUDIT.corridorDistance(corridorLanes, mx + 400, mz + 400);
    assert.ok(far.d > 12);
  }
});

test('an island point inside the lake land hole is not water; an open-lake point is', () => {
  const waters = (C.GEO.areas || []).filter((a) => a[0] === 'water').map((a) => ({ flat: a[2], holes: (a[3] || []).filter((h) => Array.isArray(h) && h.length >= 6) }));
  const pt = [1089.1, 2334.5]; // a Oneida/Ojibway corridor point on Algonquin Island
  assert.equal(AUDIT.inWater(waters, ...pt), false, 'island hole was ignored');
  assert.equal(AUDIT.inWater(waters, -6800, 400), true, 'open lake not treated as water');
});

test('the height classifier uses the 1-5 m low band, never a botanical label', () => {
  assert.equal(AUDIT.classifyDiff(0.2), 'below');
  assert.equal(AUDIT.classifyDiff(1.0), 'low');
  assert.equal(AUDIT.classifyDiff(3.0), 'low');
  assert.equal(AUDIT.classifyDiff(4.999), 'low');
  assert.equal(AUDIT.classifyDiff(5.0), 'tall');
  assert.equal(AUDIT.classifyDiff(20), 'tall');
  assert.equal(AUDIT.classifyDiff(NaN), 'noLidar');
});

// Regression: a nodata sentinel on both surfaces must NOT cancel to 0 and be counted as lawn. Both elevations are
// validated independently before differencing.
test('nodata sentinels on both surfaces are noLidar, not a false lawn reading', () => {
  for (const sentinel of [-9999, -32768, 9999, 1e30]) {
    assert.equal(AUDIT.classifySample(sentinel, sentinel), 'noLidar', `both ${sentinel}`);
    assert.equal(AUDIT.classifySample(80, sentinel), 'noLidar', `dtm only ${sentinel}`);
    assert.equal(AUDIT.classifySample(sentinel, 80), 'noLidar', `dsm only ${sentinel}`);
  }
  assert.equal(AUDIT.plausibleElevation(-9999), false);
  assert.equal(AUDIT.plausibleElevation(NaN), false);
  assert.equal(AUDIT.plausibleElevation(80), true);
  // A genuine low pair still classifies (the guard does not swallow real data).
  assert.equal(AUDIT.classifySample(80.2, 80), 'below');
  assert.equal(AUDIT.classifySample(82.0, 80), 'low');
  assert.equal(AUDIT.classifySample(86.0, 80), 'tall');
});

test('the CLI rejects a non-positive or non-finite sample step and a negative building pad', () => {
  for (const bad of ['0', '-1', 'abc', 'Infinity']) {
    const r = spawnSync(process.execPath, [TOOL, '--sample', bad], { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 1, `--sample ${bad} should be rejected`);
    assert.match(r.stderr, /--sample must be a finite number > 0/);
  }
  for (const bad of ['-1', 'abc']) {
    const r = spawnSync(process.execPath, [TOOL, '--building-pad', bad], { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 1, `--building-pad ${bad} should be rejected`);
    assert.match(r.stderr, /--building-pad must be a finite number >= 0/);
  }
});

test('the OSM building polygons and mapped paved lanes are excluded from the audit ground', { skip: !fs.existsSync(BUILDINGS) && `no saved Overpass buildings at ${BUILDINGS} (set WATERFRONT_RESEARCH)` }, () => {
  const j = JSON.parse(fs.readFileSync(BUILDINGS, 'utf8'));
  const rings = [];
  for (const e of j.elements || []) {
    if (!Array.isArray(e.geometry) || e.geometry.length < 4) continue;
    const flat = [];
    for (const p of e.geometry) { const w = worldFromLatLon(p.lat, p.lon); flat.push(w.x, w.z); }
    if (flat.length >= 6) rings.push(flat);
  }
  assert.ok(rings.length > 400, `${rings.length} OSM building rings`);
  // A real building's interior is neither corridor ground nor eligible: the ring contains its own centroid, and the
  // audit's ring distance is 0 inside it.
  let inside = 0;
  for (const flat of rings) {
    const cx = flat.filter((_, i) => i % 2 === 0).reduce((a, v) => a + v, 0) / (flat.length / 2);
    const cz = flat.filter((_, i) => i % 2 === 1).reduce((a, v) => a + v, 0) / (flat.length / 2);
    if (AUDIT.corridorDistance(corridorLanes, cx, cz).d <= 12) { assert.equal(AUDIT.ringDistance(flat, cx, cz), 0); inside++; }
  }
  assert.ok(inside > 0, 'no building fell on the corridor; the exclusion would be untested');
});

test('the CLI completes on the cached lidar (or names the exact missing cache)', (t) => {
  if (!hasCache) { t.skip(`no island DS/DTM cache at ${cacheDir} (set DON_VALLEY_DTM); cannot run the lidar audit`); return; }
  if (!fs.existsSync(BUILDINGS)) { t.skip(`no saved Overpass buildings at ${BUILDINGS} (set WATERFRONT_RESEARCH)`); return; }
  const out = path.join(process.env.TMPDIR || '/tmp', `island-low-veg-audit-${process.pid}.json`);
  const r = spawnSync(process.execPath, [TOOL, '--out', out], { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(out, { force: true });
  assert.equal(j.kind, 'island-low-vegetation-audit');
  assert.equal(j.bead, 'st-sb3r.35');
  const s = j.summary;
  // Bounded, photographed-frontage ground only: tens of thousands of 0.5 m cells, not the whole island.
  assert.ok(s.corridorCells > 10000 && s.corridorCells < 120000, `${s.corridorCells} corridor cells`);
  assert.ok(s.excluded.building > 0 && s.excluded.pavement > 0, 'no building or pavement was excluded');
  const sums = s.below1m.cells + s.low1to5m.cells + s.tall5mPlus.cells + s.noLidarCells;
  assert.equal(sums, s.corridorCells - s.excluded.building - s.excluded.pavement - s.excluded.water - s.excluded.outOfFrame);
  assert.ok(s.low1to5m.share !== null && s.low1to5m.share > 0 && s.low1to5m.share < 0.5, `low share ${s.low1to5m.share}`);
  // The first-return blind spot is honestly reported, not folded into the low layer.
  assert.ok(s.tall5mPlus.share > 0.4, `tall share ${s.tall5mPlus.share}`);
});
