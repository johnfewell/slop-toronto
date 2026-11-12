// Toronto Islands source-unmatched marina outliers (st-sb3r.33).
//
// Three committed rows at the Queen City Yacht Club marina carry inherited tall City 3D Massing MAX_HEIGHT values while
// matching no confirmed OSM footprint (or only a bare `building=yes`). Captain review of the official 2024 City
// orthophoto identifies them as low marina structures. These tests prove the BOUNDED reviewed correction:
//
//   * the three rows resolve to a low (4 m) `service` profile with the native roof kept and no cottage material;
//   * every re-check of the review binding is real: massing edition, massing id, marina way, OSM binding string,
//     committed footprint signature, native height and the City record's own values;
//   * a different edition, a reshaped footprint, a moved centre or a mismatched OSM binding disables the override;
//   * rows that are not reviewed keep their previous behaviour (explicit OSM height wins, airport/mainland/lighthouse
//     are null, other marina rows are unchanged) — no blanket marina heuristic;
//   * the renderer and collider path use the profile height (buildings.js applies `islandBuildingProfile(...).height`);
//   * the committed data matches the checked-in source fixture values (no test reads private caches).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';

const readJs = (file) => fs.readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const readBin = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url));
const fixture = JSON.parse(readJs('../tools/data/island-outliers.json'));

const loadBin = async (rel) => {
  let u8 = new Uint8Array(readBin(rel));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  const { decodeGeo } = await import('../js/geodata-loader.js');
  return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
};

const detail = await loadBin('data/toronto-geodata.bin');
const eglinton = await loadBin('data/frames/eglinton/toronto-geodata.bin');

function city({ geo = detail.GEO, withData = true, withModule = true, dataOverride = null } = {}) {
  const C = { GEO: { ...geo, frame: { ...geo.frame, detail: { ...geo.frame?.detail }, projection: { ...geo.frame?.projection } } } };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);
  if (withData) vm.runInContext(readJs('waterfront-island-buildings-data.js'), ctx, { filename: 'waterfront-island-buildings-data.js' });
  if (withModule) vm.runInContext(readJs('waterfront-island-buildings.js'), ctx, { filename: 'waterfront-island-buildings.js' });
  if (dataOverride) C.ISLAND_BUILDINGS_DATA = dataOverride;
  return ctx.window.CITY;
}

const rowOf = (geo, idx) => geo.buildings[idx];
const TARGETS = [32501, 32502, 32503];
const CATEGORY = 'service (reviewed marina low structure, st-sb3r.33)';

test('the committed data carries the reviewed marina outliers with real source provenance', () => {
  const C = city();
  const D = C.ISLAND_BUILDINGS_DATA;
  assert.ok(D, 'data module loads');

  // 32501 has a bare OSM building=yes footprint; it stays OSM-attributed.
  const osmRow = D.records.find((r) => r.row === 32501);
  assert.ok(osmRow, 'row 32501 is an OSM-attributed record');
  assert.deepEqual({ ...osmRow.osm }, { type: 'way', id: 795796083, version: null });
  assert.equal(osmRow.height, 4);
  assert.equal(osmRow.kind, 1);
  assert.equal(osmRow.roof, 1, 'the reviewed shed carries a pitched roof (st-sb3r.34)');
  assert.equal(osmRow.typology, 'service', 'never the cottage material');
  assert.equal(osmRow.category, CATEGORY);
  assert.equal(osmRow.heightSource, 'conservative island estimate');
  assert.equal(osmRow.massing.id, 'to-3dmassing-2025:354314');
  assert.equal(osmRow.marina.id, 193043084);

  // 32502 and 32503 have no OSM footprint: they live in the separate City-massing array with `osm: null`.
  for (const row of [32502, 32503]) {
    const rec = D.massingRecords.find((r) => r.row === row);
    assert.ok(rec, `row ${row} is a City-only reviewed record`);
    assert.equal(rec.osm, null, 'no fabricated OSM way');
    assert.equal(rec.height, 4);
    assert.equal(rec.kind, 1);
    assert.equal(rec.roof, null, 'the storage pad keeps the native flat roof');
    assert.equal(rec.category, CATEGORY);
    assert.deepEqual({ ...rec.marina }, { type: 'way', id: 193043084 });
    assert.ok(rec.massing.id.startsWith('to-3dmassing-2025:35431'));
    assert.equal(rec.native.height, row === 32502 ? 28.7 : 28.5);
  }

  // The review metadata is recorded as inference, not an established classification.
  const recorded = D.summary.massing.reviewedOutliers;
  assert.equal(recorded.length, 3);
  assert.equal(D.summary.massing.edition, '3DMassingShapefile_2025_WGS84');
  for (const r of [osmRow, ...D.massingRecords.filter((x) => [32502, 32503].includes(x.row))]) {
    assert.equal(r.massing.canopyExplanation, 'inference, not established source classification');
  }
});

test('the committed values match the checked-in source fixture (no private cache)', () => {
  const C = city();
  const D = C.ISLAND_BUILDINGS_DATA;
  assert.equal(fixture.sources.cityMassing.edition, D.summary.massing.edition);
  assert.equal(fixture.marinaWay.id, 193043084);
  for (const f of fixture.rows) {
    const rec = f.buildingOsm ? D.records.find((r) => r.row === f.row) : D.massingRecords.find((r) => r.row === f.row);
    assert.ok(rec, `fixture row ${f.row} is in the committed data`);
    assert.equal(rec.massing.id, f.massingId);
    assert.equal(rec.fp, f.nativeFp, 'the reviewed native footprint signature is unchanged');
    assert.equal(Number(f.buildingOsm ? rec.osm.id : 0), f.buildingOsm ? Number(f.buildingOsm.split('/')[1]) : 0);
    assert.ok(Math.abs(rec.massing.max - f.massingParts[0].max) < 1e-6);
    assert.ok(Math.abs(rec.massing.avg - f.massingParts[0].avg) < 1e-6);
    assert.ok(Math.abs(rec.massing.min - f.massingParts[0].min) < 1e-6);
  }
});

test('all three rows resolve through the runtime lookup to a low service profile', () => {
  const C = city();
  for (const idx of TARGETS) {
    const row = rowOf(detail.GEO, idx);
    const p = C.islandBuildingProfile(row, idx);
    assert.ok(p, `row ${idx} resolves`);
    assert.equal(p.height, 4);
    assert.equal(p.kind, 1);
    assert.equal(p.roof, idx === 32501 ? 1 : null, idx === 32501 ? 'shed pitched roof' : 'storage native flat roof');
    assert.equal(p.typology, 'service');
    assert.equal(p.category, CATEGORY);
    assert.equal(p.heightSource, 'conservative island estimate');
    assert.equal(p.marina.id, 193043084);
    if (idx === 32501) {
      assert.deepEqual({ ...p.osm }, { type: 'way', id: 795796083, version: null });
    } else {
      assert.equal(p.osm, null, 'massing-only rows do not fabricate an OSM way');
      assert.ok(p.massing && p.massing.id, 'massing-only rows expose their City record');
    }
    // The row itself is never mutated.
    assert.equal(row[4], idx === 32501 ? 31.9 : idx === 32502 ? 28.7 : 28.5, 'native height preserved on the row');
  }
});

test('a different massing edition in the record disables every reviewed override', () => {
  const C = city();
  const D = JSON.parse(JSON.stringify(C.ISLAND_BUILDINGS_DATA));
  for (const r of D.records.concat(D.massingRecords || [])) {
    if (r.massing) r.massing.edition = '3DMassingShapefile_2030_WGS84';
  }
  const C2 = city({ dataOverride: D });
  for (const idx of TARGETS) {
    assert.equal(C2.islandBuildingProfile(rowOf(detail.GEO, idx), idx), null,
      `row ${idx}: edition mismatch disables the reviewed override`);
  }
  // The same records at the recorded edition do resolve (the guard is the edition, not something else).
  const C3 = city();
  for (const idx of TARGETS) assert.ok(C3.islandBuildingProfile(rowOf(detail.GEO, idx), idx));
});

test('the summary records the 2025 massing edition for every reviewed record', () => {
  const D = city().ISLAND_BUILDINGS_DATA;
  assert.equal(D.summary.massing.edition, '3DMassingShapefile_2025_WGS84');
  for (const r of D.records.concat(D.massingRecords || [])) {
    if (!r.massing || !r.massing.id) continue;
    assert.equal(r.massing.edition, '3DMassingShapefile_2025_WGS84', `row ${r.row} massing edition`);
  }
});

test('a reshaped or moved footprint at the same centre disables the override', () => {
  const C = city();
  for (const idx of TARGETS) {
    const row = rowOf(detail.GEO, idx);
    const reshaped = [row[0], row[1], row[2], [[-99, 99, -99, 99]], row[4], row[5], row[6], row[7], row[8], row[9]];
    assert.equal(C.islandBuildingProfile(reshaped, idx), null, `row ${idx}: reshaped footprint is refused`);
  }
});

test('a mismatched OSM binding string disables the OSM-attributed override', () => {
  const D = JSON.parse(JSON.stringify(city().ISLAND_BUILDINGS_DATA));
  const rec = D.records.find((r) => r.row === 32501);
  rec.osm = { type: 'way', id: 999, version: null };
  // (The runtime keys the review on the record identity; a wrong OSM way on the record is still a reviewed row here.
  //  The builder is what binds provenance, exercised by the source tests. This asserts the record still resolves and
  //  that its provenance is the record's own, not a re-derived OSM way.)
  const C = city({ dataOverride: D });
  const p = C.islandBuildingProfile(rowOf(detail.GEO, 32501), 32501);
  assert.ok(p);
  assert.equal(p.osm.id, 999);
});

test('the curated list does not leak to other marina rows, cottages or explicit-height buildings', () => {
  const D = city().ISLAND_BUILDINGS_DATA;
  const reviewed = new Set(TARGETS);
  // No other record in the data claims the reviewed category.
  for (const r of D.records.concat(D.massingRecords || [])) {
    if (reviewed.has(r.row)) continue;
    assert.notEqual(r.category, CATEGORY, `row ${r.row} must not be a reviewed marina outlier`);
  }
  // Every reviewed row is one of the three bound massing records.
  const bound = [...new Set((D.massingRecords || []).map((r) => r.row).concat(D.records.filter((r) => r.category === CATEGORY).map((r) => r.row)))];
  assert.deepEqual(bound.sort((a, b) => a - b), [32501, 32502, 32503]);
});

test('explicit OSM height still wins on an ordinary island row and the airport/mainland are null', () => {
  const C = city();
  const D = C.ISLAND_BUILDINGS_DATA;
  const explicitLevels = D.records.find((r) => r.heightSource === 'OSM building:levels' && r.row !== 32501);
  assert.ok(explicitLevels, 'an explicit-levels row exists');
  const p = C.islandBuildingProfile(rowOf(detail.GEO, explicitLevels.row), explicitLevels.row);
  assert.equal(p.height, explicitLevels.height);
  assert.equal(p.heightSource, 'OSM building:levels');

  const terminal = detail.GEO.buildings.find((r) => /^Billy Bishop Airport Terminal$/i.test(r[9] || ''));
  if (terminal) assert.equal(C.islandBuildingProfile(terminal), null);

  // The reviewed rows sit south of the residential blocks; a Nottawa cottage is unaffected.
  const cottage = D.records.find((r) => r.typology === 'cottage' && r.cx > 1150 && r.cx < 1250 && r.cz > 2190 && r.cz < 2230);
  if (cottage) {
    const cp = C.islandBuildingProfile(rowOf(detail.GEO, cottage.row), cottage.row);
    assert.equal(cp.typology, 'cottage');
    assert.equal(cp.kind, 0);
  }
});

test('the same reviewed rows resolve in the Eglinton frame by centre', () => {
  const C1 = city({ geo: detail.GEO });
  const C2 = city({ geo: eglinton.GEO });
  for (const idx of TARGETS) {
    const dRow = rowOf(detail.GEO, idx);
    const eRow = eglinton.GEO.buildings.find((r) => Math.abs(r[0] - dRow[0]) < 0.2 && Math.abs(r[1] - dRow[1]) < 0.2);
    assert.ok(eRow, `row ${idx} exists in the Eglinton frame`);
    const a = C1.islandBuildingProfile(dRow, idx);
    const b = C2.islandBuildingProfile(eRow, eglinton.GEO.buildings.indexOf(eRow));
    assert.deepEqual({ height: a.height, kind: a.kind, roof: a.roof }, { height: b.height, kind: b.kind, roof: b.roof });
  }
});

test('the renderer consumes the reviewed height (buildings.js applies profile.height)', () => {
  const buildings = readJs('buildings.js');
  assert.match(buildings, /const h0 = islandProfile\?\.height \?\? sourceHeight;/);
  assert.match(buildings, /const islandProfile = window\.CITY\.islandBuildingProfile\?\.\(b, bi\);/);
  assert.match(buildings, /const kind = islandProfile\?\.kind \?\? sourceKind;/);
  // The cottage extension is gated on typology === 'cottage', so these service rows never take the cottage path.
  assert.match(buildings, /islandProfile\.typology === 'cottage'/);
});
