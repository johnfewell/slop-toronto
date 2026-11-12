// Toronto Islands residential-lot canopy (js/waterfront-island-residential-canopy.js + -data, bead st-sb3r.28).
//
// The residential lots along the photographed Oneida and Ojibway avenues on Algonquin Island get no Ontario-2023 lidar
// crowns (that build keeps only Toronto Island Park blocks), and the photos show dense mature canopy. This module adds
// the City of Toronto's OWN mapped tree points for exactly those two corridors. These tests prove, on the real generated
// data and the committed detail/Eglinton geodata (decoded with js/geodata-loader.js, never the legacy script):
//   - the data is the City Tree Point layer, with exact OBJECTIDs, the source DERIVED_HEIGHT (not a guess) and a generic
//     deciduous with NO species claim, honestly labelled;
//   - every site is a source point, produced by the reproducible builder from the captain's saved query, and the gates
//     (corridor, water, building, street dedupe) sum to the source count;
//   - the sites are inside the two corridors only, exactly where the data says, unmoved, and bounded (no other island
//     block, no mainland site);
//   - the api is a no-op on a mismatched frame/projection, absent data, or outside the frame;
//   - the helper returns EZ-Tree-shaped sites, and dedupe keeps the City's own inventory and only removes generated
//     generic scatter a mapped point already represents.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
// Private research cache (reference downloads that never ship): set WATERFRONT_RESEARCH to its folder.
const WATERFRONT_RESEARCH = process.env.WATERFRONT_RESEARCH || path.join(os.tmpdir(), 'waterfront-research');

const ROOT = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');

const loadBin = async (rel) => {
  let u8 = new Uint8Array(fs.readFileSync(new URL(rel, ROOT)));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  const { decodeGeo } = await import(new URL('js/geodata-loader.js', ROOT));
  return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
};

const detail = await loadBin('data/toronto-geodata.bin');
const eglinton = await loadBin('data/frames/eglinton/toronto-geodata.bin');

function city({ geo = detail.GEO, withData = true, withModule = true, dropData = false } = {}) {
  // Each test gets its own drawing of the frame so a projection-mismatch test cannot leak into the next.
  const G = { ...geo, frame: { ...(geo.frame || {}), detail: geo.frame?.detail && { ...geo.frame.detail }, projection: geo.frame?.projection && { ...geo.frame.projection } } };
  const C = { GEO: G };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, Date, Number, Array, Set, Map, Object, JSON };
  vm.createContext(ctx);
  if (withData && !dropData) vm.runInContext(read('js/waterfront-island-residential-canopy-data.js'), ctx, { filename: 'waterfront-island-residential-canopy-data.js' });
  if (withModule) vm.runInContext(read('js/waterfront-island-residential-canopy.js'), ctx, { filename: 'waterfront-island-residential-canopy.js' });
  return ctx.window.CITY;
}

// Re-derive the corridor distance from the committed lane data, in this frame, so the placement assertions do not
// simply echo the helper.
const lanes = (C) => (() => {
  const ctx = { window: { CITY: {} }, Math, Number, Array, JSON };
  vm.createContext(ctx);
  vm.runInContext(read('js/waterfront-island-lanes-data.js'), ctx, { filename: 'waterfront-island-lanes-data.js' });
  return (ctx.window.CITY.ISLAND_LANES_DATA.runs || []).filter((r) => (r.names || []).some((n) => /oneida|ojibway/i.test(n)));
})();

const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  let t = L > 0 ? ((px - ax) * dx + (pz - az) * dz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
};
const corridorDistance = (runs, x, z) => {
  let best = Infinity;
  for (const r of runs) for (let i = 0; i + 1 < r.points.length; i++) best = Math.min(best, segDist(x, z, r.points[i][0], r.points[i][1], r.points[i + 1][0], r.points[i + 1][1]));
  return best;
};

// The captain's saved City Tree Point query, for the identity tests (read-only; never opened as an image).
const sourcePath = path.join(WATERFRONT_RESEARCH, 'width-audit/city-tree-algonquin.json');
// The builder also reads the saved QCYC marina query and rings from the private research cache (WATERFRONT_RESEARCH).
const marinaCache = ['research/island-cottages/city-tree-marina-qcyc.json', 'research/island-cottages/m.json']
  .every((f) => fs.existsSync(path.join(WATERFRONT_RESEARCH, f)));
const noMarinaCache = !marinaCache && 'the saved marina query and rings are absent (set WATERFRONT_RESEARCH)';
const source = fs.existsSync(sourcePath) ? JSON.parse(fs.readFileSync(sourcePath, 'utf8')) : null;

// --- data identity & schema ------------------------------------------------------------------------------------------
test('the data names the City Tree Point layer and a primary licence/catalogue, and claims no species', () => {
  const C = city();
  const D = C.ISLAND_RESIDENTIAL_CANOPY_DATA;
  assert.ok(D, 'the data module is loaded');
  assert.equal(D.kind, 'island-residential-canopy');
  assert.match(D.source.service, /cot_geospatial3\/FeatureServer\/10/);
  assert.match(D.source.catalogue, /open\.toronto\.ca\/dataset\/topographic-mapping-physical-location-of-trees/);
  assert.match(D.source.licence, /Open Government Licence – Toronto/);
  // No species was invented: the source identifies none.
  assert.equal(D.crown.source, null);
  assert.equal(D.crown.genericDeciduous, true);
  assert.ok((D.rows || []).length > 0, `${D.rows.length} rows`);
  // The pavement gate is source-bound: the narrowed representative widths plus a trunk clearance, trunk only.
  assert.equal(D.gates.pavedWidthM['Oneida Avenue'], 3.3);
  assert.equal(D.gates.pavedWidthM['Ojibway Avenue'], 3.5);
  assert.ok(D.gates.trunkClearanceM > 0 && D.gates.trunkClearanceM < 1, `trunk clearance ${D.gates.trunkClearanceM}`);
  // every row is [oid, x(dm), z(dm), h(cm), elev, laneIndex, streetM(dm)]
  for (const r of D.rows) {
    assert.equal(r.length, 7);
    assert.ok(Number.isInteger(r[0]) && r[0] > 0, `OBJECTID ${r[0]}`);
    assert.ok(Number.isFinite(r[3]) && r[3] >= D.gates.minHeightM * 100 && r[3] <= D.gates.maxHeightM * 100, `height ${r[3]}`);
  }
});

test('every site is a real source point: its OBJECTID and DERIVED_HEIGHT come from the City feature of that OBJECTID', { skip: !source && 'the saved source query is absent' }, () => {
  const D = city().ISLAND_RESIDENTIAL_CANOPY_DATA;
  const byId = new Map(source.features.map((f) => [f.attributes.OBJECTID, f]));
  for (const [oid, , , hcm] of D.rows) {
    const f = byId.get(oid);
    assert.ok(f, `OBJECTID ${oid} is in the source`);
    assert.equal(f.attributes.SUBTYPE_DESC, 'Tree Point');
    assert.equal(Math.round(f.attributes.DERIVED_HEIGHT * 100), hcm, `OBJECTID ${oid} height is DERIVED_HEIGHT, not guessed`);
  }
});

test('the gates reconcile to the source: placed + every rejection = the queried feature count', () => {
  const D = city().ISLAND_RESIDENTIAL_CANOPY_DATA;
  const c = D.counts;
  const rejected = Object.values(c.rejected).reduce((s, n) => s + n, 0);
  assert.equal(c.placed + rejected, c.sourceFeatures, `${c.placed} + ${rejected} = ${c.sourceFeatures}`);
  assert.equal(c.placed, D.rows.length);
  // The corridor is the dominant gate: the bbox is not the whole island, and most of its points are not on these lots.
  assert.ok(c.rejected.outOfCorridor > 400, `${c.rejected.outOfCorridor} outside the corridor`);
  assert.ok(c.rejected.pavement > 0, `${c.rejected.pavement} on a mapped lane's paved strip`);
  assert.equal(Object.keys(c.byLane).length, 2, 'exactly Oneida and Ojibway');
  assert.ok(c.byLane['Oneida Avenue'] > 0 && c.byLane['Ojibway Avenue'] > 0);
});

// --- placement ------------------------------------------------------------------------------------------------------
test('every site stands within the Oneida/Ojibway corridor, exactly where the data puts it', () => {
  const C = city();
  const D = C.ISLAND_RESIDENTIAL_CANOPY_DATA;
  const runs = lanes(C);
  assert.equal(runs.length, 2);
  const radius = D.corridor.radiusM;
  for (const s of C.islandResidentialCanopySites()) {
    const d = corridorDistance(runs, s.x, s.z);
    assert.ok(d <= radius + 1e-6, `${s.x},${s.z} is ${d.toFixed(2)} m from the corridor (<= ${radius})`);
  }
});

test('placement is unmoved: the helper returns each row’s source position rounded to 0.1 m and its source height, nothing relocated', () => {
  const C = city();
  const D = C.ISLAND_RESIDENTIAL_CANOPY_DATA;
  const sites = C.islandResidentialCanopySites();
  assert.equal(sites.length, D.rows.length);
  for (let i = 0; i < D.rows.length; i++) {
    const r = D.rows[i];
    assert.equal(sites[i].x, r[1] / 10);
    assert.equal(sites[i].z, r[2] / 10);
    assert.ok(Math.abs(sites[i].height - r[3] / 100) < 1e-9, `height ${sites[i].height}`);
    assert.equal(sites[i].oid, r[0]);
  }
});

test('the sites are bounded to the island: every one is inside the built detail frame and no site is on the mainland', () => {
  const C = city();
  const f = detail.GEO.frame.detail;
  const sites = C.islandResidentialCanopySites();
  assert.ok(sites.length > 20, `${sites.length} sites`);
  // the Algonquin residential envelope, not the whole island and certainly not downtown
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of sites) {
    assert.ok(s.x > f.x0 && s.x < f.x1 && s.z > f.z0 && s.z < f.z1, `${s.x},${s.z} in frame`);
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
  }
  // The corridor is Algonquin's south residential rows (x ~ 1000-1200, z ~ 2210-2430 m in the committed frame).
  assert.ok(minX > 950 && maxX < 1250, `x span ${minX}..${maxX}`);
  assert.ok(minZ > 2150 && maxZ < 2500, `z span ${minZ}..${maxZ}`);
});

// --- the api's frame gating -----------------------------------------------------------------------------------------
test('the api is a no-op on a mismatched frame, absent data, and off the built frame', () => {
  // projection mismatch: a frame scaled by 1%
  const mismatch = city();
  mismatch.GEO.frame.projection = { ...mismatch.GEO.frame.projection, kx: mismatch.GEO.frame.projection.kx * 1.01 };
  assert.equal(mismatch.islandResidentialCanopySites(), null);
  assert.equal(mismatch.islandResidentialCanopyLayout().supported, false);

  // no data module: nothing to add, and the layout says so
  const none = city({ dropData: true });
  assert.equal(none.islandResidentialCanopySites(), null);
  assert.equal(none.islandResidentialCanopyLayout().loaded, false);

  // the Eglinton frame shares the projection, so the same sites decode there too, but never outside the frame
  const eg = city({ geo: eglinton.GEO });
  const egSites = eg.islandResidentialCanopySites();
  assert.ok(Array.isArray(egSites) && egSites.length === city().islandResidentialCanopySites().length, 'same projection, same rows');
  const cropped = city();
  cropped.GEO.frame.detail = { x0: -100, x1: 100, z0: -100, z1: 100 };
  assert.equal(cropped.islandResidentialCanopySites().length, 0, 'same projection does not place trees beyond active coverage');
  // the api returns the corridor sites, never an invented point: every x/z is decoded from a row (test 5)
});

// --- EZ schema & dedupe --------------------------------------------------------------------------------------------
test('each site is a valid EZ-Tree site: a known model id, a generic deciduous width, and never a conifer', () => {
  const C = city();
  const ids = new Set(detail.GEO.treeModels.map(([id]) => id));
  const sites = C.islandResidentialCanopySites();
  for (const s of sites) {
    assert.ok(ids.has(s.model), `${s.model} is one of the EZ models`);
    assert.ok(!/pine/.test(s.model), 'a generic deciduous, never a conifer');
    assert.ok(s.width >= 1.8 && s.width <= 6, `crown radius ${s.width} m is a bounded generic estimate`);
    assert.ok(Number.isFinite(s.height) && s.height > 0);
    assert.equal(s.woods, false);
    assert.equal(s.tier, 0);
    assert.equal(s.residentialCanopy, true);
  }
});

test('the api dedupes source candidates against preserved named/lidar sites, and reconcile removes only generic scatter', () => {
  const C = city();
  const all = C.islandResidentialCanopySites();
  const anchor = all[0];

  // A preserved lidar crown at a source point suppresses that source candidate (the same tree, not drawn twice).
  const withLidar = C.islandResidentialCanopySites([{ x: anchor.x, z: anchor.z, model: 'ez-ash-medium', height: 20, width: 4 }]);
  assert.equal(withLidar.length, all.length - 1, 'one source candidate deduped against a lidar crown');
  assert.ok(!withLidar.some((s) => s.oid === anchor.oid), 'the deduped candidate is gone');

  // Generic generated scatter does NOT suppress a source candidate: it is the scatter the source replaces.
  const withGeneric = C.islandResidentialCanopySites([{ x: anchor.x, z: anchor.z, tier: 2, species: 0 }]);
  assert.equal(withGeneric.length, all.length, 'generic scatter does not suppress a source point');

  // Reconcile (on the RAW generated list) removes generic scatter near a mapped point, keeps named/lidar and far sites.
  const runtime = [
    { x: anchor.x + 0.4, z: anchor.z + 0.4, tier: 2, species: 0 }, // generated yard scatter near a mapped point: removed
    { x: 9000, z: 9000, tier: 2, species: 0 }, // far away: kept
    { x: anchor.x, z: anchor.z, tier: 1, model: 3, height: 18 }, // a City street-inventory row (model + height): kept
    { x: anchor.x, z: anchor.z, tier: 0, model: 'ez-ash-medium', height: 20, width: 4 } // a lidar crown: kept
  ];
  const rec = C.islandResidentialCanopyReconcile(all, runtime);
  assert.equal(rec.removedCount, 1, `${rec.removedCount} generated scatter removed`);
  assert.equal(rec.kept.length, runtime.length - 1);
  assert.ok(rec.kept.some((t) => t.x === 9000), 'the far generated tree stays');
  assert.ok(rec.kept.some((t) => t.tier === 1 && t.model === 3), 'a City street-inventory row keeps its place (mapped priority)');
  assert.ok(rec.kept.some((t) => t.model === 'ez-ash-medium'), 'a lidar crown keeps its own model');
});

test('the layout reports the source counts, gates and height spread the data was built with', () => {
  const D = city().ISLAND_RESIDENTIAL_CANOPY_DATA;
  const layout = city().islandResidentialCanopyLayout();
  assert.equal(layout.supported, true);
  assert.equal(layout.source, D.source.name);
  // (the layout's values cross the vm context boundary, so compare by value, not reference)
  assert.equal(JSON.stringify(layout.counts), JSON.stringify(D.counts));
  assert.equal(JSON.stringify(layout.heightStats), JSON.stringify(D.heightStats));
  assert.equal(layout.inFrame, D.rows.length);
  assert.equal(layout.dedupeM, 3.0);
  const hs = layout.heightStats;
  assert.ok(hs.min > 0 && hs.max < 40, `heights ${hs.min}..${hs.max}`);
});

// --- the builder's own gates, on synthetic source points (the actual transform, not a copy) -------------------------
const toLatLon = (x, z) => {
  const P = detail.GEO.frame.projection;
  const u = x + P.ox, v = z + P.oz, c = Math.cos(P.theta), s = Math.sin(P.theta);
  return { lat: P.lat0 + (-u * s - v * c) / P.ky, lon: P.lon0 + (u * c - v * s) / P.kx };
};
const synthFeature = (lat, lon, h = 20) => ({
  attributes: { OBJECTID: 999999, SUBTYPE_DESC: 'Tree Point', DERIVED_HEIGHT: h, ELEVATION: 75, DERIVED_OWNER: 'City of Toronto - Corridor', LAST_GEOMETRY_MAINT: 1621745573000 },
  geometry: { x: lon, y: lat }
});
function runBuilder(features) {
  const src = path.join(os.tmpdir(), `island-canopy-synth-src-${process.pid}.json`);
  fs.writeFileSync(src, JSON.stringify({
    fields: ['OBJECTID', 'DERIVED_HEIGHT', 'DERIVED_OWNER', 'LAST_GEOMETRY_MAINT', 'ELEVATION'].map((name) => ({ name })),
    features
  }));
  const r = spawnSync(process.execPath, ['tools/build-island-residential-canopy.mjs', '--source', src, '--check'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8'
  });
  fs.rmSync(src, { force: true });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

test('the building gate uses the renderer’s rotated-footprint inverse: a trunk inside a rotated building is rejected', { skip: noMarinaCache }, () => {
  const runs = lanes(city());
  // The forward transform is tools/build-island-buildings.mjs rowBox: x = cx + u*cos + v*sin, z = cz - u*sin + v*cos.
  const fwd = (cx, cz, ang, u, v) => { const cs = Math.cos(ang), sn = Math.sin(ang); return { x: cx + u * cs + v * sn, z: cz - u * sn + v * cs }; };
  let point = null;
  for (const b of detail.GEO.buildings) {
    const [cx, cz, ang, parts] = b;
    if (Math.abs(ang) < 0.1) continue; // a genuinely rotated footprint
    for (const [u0, u1, v0, v1] of parts) {
      for (let i = 1; i < 10 && !point; i++) for (let j = 1; j < 10 && !point; j++) {
        const w = fwd(cx, cz, ang, u0 + (u1 - u0) * i / 10, v0 + (v1 - v0) * j / 10);
        if (corridorDistance(runs, w.x, w.z) <= 12) point = w;
      }
      if (point) break;
    }
    if (point) break;
  }
  assert.ok(point, 'a rotated building with an interior point inside the corridor exists');
  const { lat, lon } = toLatLon(point.x, point.z);
  const out = runBuilder([synthFeature(lat, lon)]);
  assert.equal(out.counts.placed, 0, 'the trunk inside the rotated building is not placed');
  assert.ok(out.counts.rejected.building >= 1, `rejected as a building overlap (${JSON.stringify(out.counts.rejected)})`);
});

test('the pavement gate rejects a trunk on a mapped lane’s paved strip (trunk only, not the crown)', { skip: noMarinaCache }, () => {
  const runs = lanes(city());
  const oneida = runs.find((r) => (r.names || []).includes('Oneida Avenue'));
  const a = oneida.points[Math.floor(oneida.points.length / 2)], b = oneida.points[Math.floor(oneida.points.length / 2) + 1];
  const x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2; // on the centre line: inside the paved strip
  const { lat, lon } = toLatLon(x, z);
  const out = runBuilder([synthFeature(lat, lon)]);
  assert.equal(out.counts.placed, 0, 'a trunk on the lane is not placed');
  assert.ok(out.counts.rejected.pavement >= 1, `rejected as pavement (${JSON.stringify(out.counts.rejected)})`);
});

// --- producer reproducibility --------------------------------------------------------------------------------------
test('the data is the builder’s output: re-running the builder on the saved source reproduces the committed file', { skip: (!source && 'the saved source query is absent') || noMarinaCache }, () => {
  const out = path.join(os.tmpdir(), `island-residential-canopy-rebuild-${process.pid}.js`);
  // (run in a child so the builder's fs reads and its exit never touch this test's modules)
  const r = spawnSync(process.execPath, ['tools/build-island-residential-canopy.mjs', '--source', sourcePath, '--out', out], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8'
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const rebuilt = fs.readFileSync(out, 'utf8');
  fs.rmSync(out, { force: true });
  assert.equal(rebuilt, read('js/waterfront-island-residential-canopy-data.js'), 'the committed data is the builder’s output');
});
