// QCYC marina canopy (js/waterfront-island-residential-canopy.js marina scope + -data, st-sb3r.36).
//
// The reviewed QCYC service sheds (st-sb3r.33/.34) stand in the OSM Queen City Yacht Club marina polygon, bounded by lawn
// that the primary 2024 City orthophoto and the QCYC renovation photos show as mature canopy. This adds the City of
// Toronto topographic Tree Points that fall INSIDE that exact OSM marina polygon (Way 193043084), as a scope distinct
// from the accepted Oneida/Ojibway residential corridor.
//
// These tests are PORTABLE: they read the committed fixture tools/data/island-marina-canopy-source.json (the 24 in-polygon
// City Tree Points plus one outside control, real source coordinates/attributes/hashes and the OSM faucet ring), never
// /tmp caches, and they never skip. The full 581-point union rebuild is a manual, cache-backed audit
// (builder --check with explicitly supplied source paths), not part of this suite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';

const ROOT = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');

const loadBin = async (rel) => {
  let u8 = new Uint8Array(fs.readFileSync(new URL(rel, ROOT)));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  const { decodeGeo } = await import(new URL('js/geodata-loader.js', ROOT));
  return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
};
const detail = await loadBin('data/toronto-geodata.bin');

function city({ geo = detail.GEO, withData = true, withModule = true, dropData = false } = {}) {
  const G = { ...geo, frame: { ...(geo.frame || {}), detail: geo.frame?.detail && { ...geo.frame.detail }, projection: geo.frame?.projection && { ...geo.frame.projection } } };
  const C = { GEO: G };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, Date, Number, Array, Set, Map, Object, JSON };
  vm.createContext(ctx);
  if (withData && !dropData) vm.runInContext(read('js/waterfront-island-residential-canopy-data.js'), ctx, { filename: 'waterfront-island-residential-canopy-data.js' });
  if (withModule) vm.runInContext(read('js/waterfront-island-residential-canopy.js'), ctx, { filename: 'waterfront-island-residential-canopy.js' });
  return ctx.window.CITY;
}

// The committed primary fixture (portable, no /tmp, no network).
const FIXTURE = JSON.parse(read('tools/data/island-marina-canopy-source.json'));
const P = FIXTURE.projection;
const toWorld = (lon, lat) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
  const c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s, -(e * s + n * c)];
};
const inRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (((zi > z) !== (zj > z)) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const MARINA_WAY = 193043084;
const marinaRing = FIXTURE.marinaWay.ring.map(([lon, lat]) => toWorld(lon, lat));
const sourceById = new Map(FIXTURE.features.map((f) => [f.attributes.OBJECTID, f]));

// Re-derive the pavement distance from the committed lane data, independent of the helper.
const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  let t = L > 0 ? ((px - ax) * dx + (pz - az) * dz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
};
const allLanes = () => (() => {
  const ctx = { window: { CITY: {} }, Math, Number, Array, JSON };
  vm.createContext(ctx);
  vm.runInContext(read('js/waterfront-island-lanes-data.js'), ctx, { filename: 'waterfront-island-lanes-data.js' });
  return ctx.window.CITY.ISLAND_LANES_DATA.runs || [];
})();
const nearestPaved = (runs, x, z) => {
  let best = Infinity;
  for (const r of runs) for (let i = 0; i + 1 < r.points.length; i++) best = Math.min(best, segDist(x, z, r.points[i][0], r.points[i][1], r.points[i + 1][0], r.points[i + 1][1]));
  return best;
};

test('the marina data names the City Tree Point layer, the OSM marina polygon, and claims no species', () => {
  const D = city().ISLAND_RESIDENTIAL_CANOPY_DATA;
  assert.ok(D && D.marina, 'the data carries a marina scope');
  assert.equal(D.marina.osmWay, MARINA_WAY);
  assert.match(D.marina.source.service, /cot_geospatial3\/FeatureServer\/10/);
  assert.match(D.marina.source.licence, /Open Government Licence – Toronto/);
  assert.ok(D.marina.source.cachedOverlapNote != null, 'the cache-coverage note is recorded');
  assert.equal(D.crown.source, null, 'no crown width claimed from the source');
  assert.equal(D.crown.genericDeciduous, true);
  assert.ok(D.marina.rows.length > 0, `${D.marina.rows.length} marina rows`);
  for (const r of D.marina.rows) {
    assert.equal(r.length, 6, 'marina row is [oid, x(dm), z(dm), h(cm), elev, streetM(dm)]');
    assert.ok(Number.isInteger(r[0]) && r[0] > 0);
    assert.ok(r[3] >= D.marina.gates.minHeightM * 100 && r[3] <= D.marina.gates.maxHeightM * 100, `height ${r[3]}`);
  }
  // The accepted 33 residential rows are untouched by this scope.
  assert.equal(D.rows.length, 33, 'the accepted 33 residential rows are unchanged');
});

test('every marina site is a real source point (OBJECTID + DERIVED_HEIGHT), unmoved, inside the marina polygon', () => {
  const C = city();
  const sites = C.islandMarinaCanopySites();
  assert.ok(sites.length > 0, `${sites.length} marina sites`);
  for (const s of sites) {
    const f = sourceById.get(s.oid);
    assert.ok(f, `OBJECTID ${s.oid} is in the committed source fixture`);
    assert.equal(f.attributes.SUBTYPE_DESC, 'Tree Point');
    const [wx, wz] = toWorld(f.geometry.x, f.geometry.y);
    assert.ok(Math.abs(s.x - Math.round(wx * 10) / 10) < 1e-6, `x ${s.x} vs source ${wx}`);
    assert.ok(Math.abs(s.z - Math.round(wz * 10) / 10) < 1e-6, `z ${s.z} vs source ${wz}`);
    assert.ok(Math.abs(s.height - f.attributes.DERIVED_HEIGHT) < 0.01 + 1e-9, `height ${s.height} vs DERIVED_HEIGHT ${f.attributes.DERIVED_HEIGHT}`);
    assert.ok(inRing(marinaRing, s.x, s.z), `site ${s.x},${s.z} is inside marina ${MARINA_WAY}`);
  }
});

test('the fixture covers the marina source: 18 accepted + 6 rejected in-polygon, 1 outside control', () => {
  const D = city().ISLAND_RESIDENTIAL_CANOPY_DATA;
  const accepted = new Set(D.marina.rows.map((r) => r[0]));
  let inPolygon = 0, outside = 0;
  const inPolyAccepted = [];
  for (const f of FIXTURE.features) {
    const [x, z] = toWorld(f.geometry.x, f.geometry.y);
    if (inRing(marinaRing, x, z)) { inPolygon++; if (accepted.has(f.attributes.OBJECTID)) inPolyAccepted.push(f.attributes.OBJECTID); }
    else outside++;
  }
  assert.equal(FIXTURE.geometryType, 'esriGeometryPoint');
  assert.equal(FIXTURE.spatialReference.wkid, 4326);
  assert.equal(outside, 1, 'exactly one outside control point');
  assert.equal(inPolygon, FIXTURE.insideSourceCount, 'the fixture holds every in-polygon source point');
  assert.equal(inPolyAccepted.length, D.marina.rows.length, 'every accepted marina site is an in-polygon fixture point');
  for (const oid of inPolyAccepted) assert.ok(accepted.has(oid));
});

test('no accepted marina trunk stands on a mapped paved strip and the recorded clearance holds', () => {
  const C = city();
  const D = C.ISLAND_RESIDENTIAL_CANOPY_DATA;
  const runs = allLanes();
  const sites = C.islandMarinaCanopySites();
  for (const s of sites) {
    const d = nearestPaved(runs, s.x, s.z);
    // a trunk may sit near a rail it faces, but never on a mapped lane's paved strip (half-width + trunk clearance)
    let limit = 0;
    for (const r of runs) {
      const name = (r.names || [])[0];
      const w = name === 'Oneida Avenue' ? 3.3 : name === 'Ojibway Avenue' ? 3.5 : (Number.isFinite(r.w) ? r.w : 5.6);
      limit = Math.max(limit, w / 2 + 0.4);
    }
    assert.ok(d > limit - 1e-6, `site ${s.x},${s.z} is ${d.toFixed(2)} m from a lane (needs > ${limit.toFixed(2)})`);
  }
  // The recorded clearance is the accepted set's real minimum to paved lanes (re-derive and compare).
  const minPaved = Math.min(...sites.map((s) => nearestPaved(runs, s.x, s.z)));
  assert.ok(Math.abs(D.marina.clearance.minPavedM - minPaved) < 0.05, `recorded ${D.marina.clearance.minPavedM} vs measured ${minPaved.toFixed(2)}`);
  assert.ok(D.marina.clearance.minPavedM >= 0);
});

test('the marina api dedupes against preserved mapped trees and the residential scope, drawing a tree once', () => {
  const C = city();
  const res = C.islandResidentialCanopySites();
  const marina = C.islandMarinaCanopySites([], res);
  assert.ok(Array.isArray(marina) && marina.length > 0);
  const tooClose = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) <= 3.0 + 1e-6;
  for (const m of marina) for (const rr of res) assert.ok(!tooClose(m, rr), `marina ${m.x},${m.z} duplicates residential ${rr.x},${rr.z}`);
  const first = marina[0];
  const preserved = [{ x: first.x, z: first.z, model: 'ez-ash-large', height: 20, width: 4 }];
  const suppressed = C.islandMarinaCanopySites(preserved, res);
  assert.ok(!suppressed.some((s) => s.x === first.x && s.z === first.z), 'a preserved mapped tree at the point wins');
  assert.equal(res.length, C.islandResidentialCanopySites().length, 'the residential result is unchanged');
});

test('the marina api is a no-op on a mismatched frame, absent data, or off the frame', () => {
  const mismatch = city();
  mismatch.GEO.frame.projection = { ...mismatch.GEO.frame.projection, kx: mismatch.GEO.frame.projection.kx * 1.01 };
  assert.equal(mismatch.islandMarinaCanopySites(), null);
  assert.equal(mismatch.islandResidentialCanopyLayout().supported, false);

  const none = city({ dropData: true });
  assert.equal(none.islandMarinaCanopySites(), null);
  assert.equal(none.islandResidentialCanopyLayout().loaded, false);
});

test('each marina site is a valid generic EZ-Tree site (known model id, no conifer, generic deciduous)', () => {
  const C = city();
  const sites = C.islandMarinaCanopySites();
  for (const s of sites) {
    assert.ok(/^ez-ash-(small|medium|large)$/.test(s.model), `model ${s.model}`);
    assert.equal(s.species, 1, 'a broadleaf stand-in, never a conifer');
    assert.equal(s.residentialCanopy, true);
    assert.ok(s.width >= 1.8 && s.width <= 6, `crown radius ${s.width}`);
    assert.ok(s.height >= 4.5 && s.height <= 34, `height ${s.height}`);
  }
});
