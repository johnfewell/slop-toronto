// The Canada Malting Complex (js/waterfront-bathurst.js): the western BIA gateway silos at 5 Eireann Quay / Bathurst
// Quay Common. The 1929 south silos are 100 ft (30.48 m) with 15 circular bins in three rows exposed on the exterior;
// the 1944 north silos are 125 ft (38.1 m) with 14 circular bins in two rows CONCEALED by flat walls (City heritage
// staff report, Reasons for Designation). The module stands on the seven committed "Canada Malting Silos" rows and the
// real OpenStreetMap relation 21646938 rings; it must not invent free-yard cylinders, must not draw the north bins,
// and must not claim the neighbouring Corleck Building. It replaces rows that differ by frame (detail 33097..33103 vs
// eglinton 130964..130970), gated at runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function city({ withGeo = true, three = THREE } = {}) {
  const ctx = {
    window: { CITY: { THREE: three, Addons: { mergeGeometries }, CITY_BOUNDS: { sidewalkHeight: 0.22, waterLevel: -0.7 } } },
    console: { info() {}, warn() {}, error() {} }, performance
  };
  if (withGeo) vm.runInNewContext(read('js/toronto-geodata.js'), ctx);
  vm.runInNewContext(read('js/waterfront-bathurst.js'), ctx);
  return ctx.window.CITY;
}
const inRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const geomFinite = (m) => {
  const p = m.geometry.attributes.position.array;
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) return false;
  return true;
};

test('nothing is built on load; the landmark record, sources and gate are exported', () => {
  const C = city();
  assert.equal(typeof C.createWaterfrontBathurst, 'function');
  assert.equal(C.waterfrontBathurst, undefined);
  const rec = C.WATERFRONT_BATHURST || C.CANADA_MALTING_SILOS;
  assert.ok(rec && rec.id === 'canadaMaltingSilos');
  assert.ok(/100 ft|30\.48|1929/.test(rec.source) && /125 ft|38\.1|1944/.test(rec.source));
  assert.ok(rec.sourceUrls.some((u) => u.includes('backgroundfile-19569')) && rec.sourceUrls.some((u) => u.includes('eraarch')) && rec.sourceUrls.some((u) => u.includes('openstreetmap.org/relation/21646938')));
  assert.equal(typeof C.waterfrontBathurstExcludesBuilding, 'function');
  assert.equal(typeof C.waterfrontBathurstSupported, 'function');
  assert.equal(typeof C.setWaterfrontBathurstEnabled, 'function');
});

test('the documented count/config is the built count/config: south 15 exposed bins (3x5), north 14 concealed (2x7)', () => {
  const C = city();
  const layout = C.waterfrontBathurstLayout();
  assert.equal(layout.supported, true);
  assert.equal(layout.bins.south.rows, 3);
  assert.equal(layout.bins.south.cols, 5);
  assert.equal(layout.bins.south.exposed, true);
  assert.equal(layout.bins.south.count, 15);
  assert.equal(layout.bins.north.count, 14);
  assert.equal(layout.bins.north.rows, 2);
  assert.equal(layout.bins.north.cols, 7);
  assert.equal(layout.bins.north.concealed, true);
  assert.equal(layout.bins.north.exposed, false);
  // the measured, heritage heights override the committed LIDAR massing maxima
  assert.equal(layout.heights.southSilo, 30.48);
  assert.equal(layout.heights.northSilo, 38.1);
  assert.ok(layout.heights.mappedRowHeights.every((h) => h >= 50), 'the mapped LIDAR maxima are 50.6-65.6 m');
  // the north block's bins are concealed: its structure reports concealed and no cylinder geometry is drawn for it
  assert.equal(layout.structures.northBlock.concealed, true);
  assert.equal(layout.structures.southBattery.centers.length, 15);
  assert.equal(layout.lettering.text, 'CANADA MALTING CO. LIMITED');
  assert.equal(layout.lettering.faces.join(','), 'east,west');
  assert.equal(layout.source.osmRelation, 21646938);
});

test('the 15 exposed south bins are measured from the OSM east-edge arcs and all stand inside the mapped ring', () => {
  const C = city();
  const layout = C.waterfrontBathurstLayout();
  const ring = layout.structures.southBattery.ring;
  const centers = layout.structures.southBattery.centers;
  assert.equal(centers.length, 15);
  assert.ok(centers.every((c) => c.inside), 'every bin centre is inside the OSM south ring');
  assert.ok(centers.every((c) => inRing(ring, c.x, c.z)), 'independent point-in-ring check');
  // diameter comes from the measured arc spacing, not a guess
  assert.ok(layout.bins.south.diameter > 7 && layout.bins.south.diameter < 8.5, `measured diameter ${layout.bins.south.diameter}`);
  // 3 rows x 5 columns: five distinct along-axis positions repeated three times
  const cols = new Set(centers.map((c) => c.col));
  assert.equal(cols.size, 5);
  assert.equal(new Set(centers.map((c) => c.row)).size, 3);
  // the east/outer row sits nearer the mapped Portland Slip east edge than the inner rows
  const frame = layout.structures.southBattery.frame;
  const vOf = (c) => frame.toLocal(c.x, c.z).v;
  const eastRow = centers.filter((c) => c.row === 0).map(vOf);
  const innerRow = centers.filter((c) => c.row === 2).map(vOf);
  assert.ok(Math.max(...eastRow) < Math.min(...innerRow), 'row 0 is the exposed east face');
});

test('the built south battery is 15 cylinders, the north block has none (concealed), and the lettering is on east+west', () => {
  const C = city();
  const out = C.createWaterfrontBathurst(THREE, new THREE.Scene());
  const names = out.group.children.map((m) => m.name);
  assert.ok(names.includes('WaterfrontBathurst_SouthSilos_Bins'), 'south bins mesh');
  assert.ok(names.includes('WaterfrontBathurst_NorthBlock_Shell'), 'north block shell');
  assert.ok(names.includes('WaterfrontBathurst_Lettering_east') && names.includes('WaterfrontBathurst_Lettering_west'));
  assert.ok(!names.some((n) => /North.*Bins|NorthCylinder/i.test(n)), 'no north cylinders are drawn');
  const bins = out.group.children.find((m) => m.name === 'WaterfrontBathurst_SouthSilos_Bins');
  // 15 cylinders x (18 side segments + 2 x 18 cap triangles) non-indexed
  const perCyl = 18 * 2 * 3 + 18 * 3 * 2;
  assert.equal(bins.geometry.attributes.position.count, 15 * perCyl, 'exactly 15 cylinders');
  for (const n of ['WaterfrontBathurst_Lettering_east', 'WaterfrontBathurst_Lettering_west']) {
    const s = out.group.children.find((m) => m.name === n);
    assert.equal(s.userData.signText, 'CANADA MALTING CO. LIMITED');
    // Node has no canvas: the panel is a plain concrete-toned band and reports not legible (never a blank white box)
    assert.equal(s.userData.legible, false);
  }
});

test('the geometry is finite, culled, and free of an enormous blank white box', () => {
  const C = city();
  const out = C.createWaterfrontBathurst(THREE, new THREE.Scene());
  assert.equal(out.group.name, 'WaterfrontBathurst');
  assert.ok(out.group.children.length >= 10);
  for (const m of out.group.children) {
    assert.ok(geomFinite(m), `${m.name} has finite positions`);
    assert.ok(m.userData.cullDistance > 0 && m.userData.cullCell > 0, `${m.name} carries culling metadata`);
    assert.ok(m.geometry.boundingSphere && Number.isFinite(m.geometry.boundingSphere.radius), `${m.name} has a bounding sphere`);
    const c = m.material && m.material.color;
    if (c) {
      // pale greige / muted grey / dark windows: none is pure white
      assert.ok(!(c.r === 1 && c.g === 1 && c.b === 1), `${m.name} is not pure white`);
    }
  }
  assert.ok(out.stats.surfaceTexture === false, 'no canvas in Node -> no texture, but the colour is explicit');
  assert.equal(out.stats.concreteColor, '#bdb7a9');
});

test('colliders are finite, reach the marine leg (~55 m), and the silo bins stay under the heritage heights', () => {
  const C = city();
  const out = C.createWaterfrontBathurst(THREE, new THREE.Scene());
  assert.ok(out.colliders.length >= 5);
  for (const c of out.colliders) {
    for (const k of ['minX', 'maxX', 'minZ', 'maxZ', 'minY', 'maxY']) assert.ok(Number.isFinite(c[k]), `${k} finite`);
    assert.ok(c.maxY > c.minY);
  }
  const tall = out.colliders.map((c) => c.maxY).reduce((a, b) => Math.max(a, b), 0);
  assert.ok(tall >= 55 && tall <= 56, `the marine leg reaches ~55 m (estimate), got ${tall}`);
  const battery = out.colliders.find((c) => c.maxY > 30 && c.maxY < 31);
  assert.ok(battery, 'the south battery collider tops out at the measured 30.48 m');
});

test('the exclusion hook resolves the exact seven named rows before the builder runs, and never the Corleck Building', () => {
  const C = city();
  const R = C.waterfrontBathurstResolveRows();
  assert.deepEqual(
    [R.northBlock, R.marineLeg, R.northHeadhouse, R.southHeadhouse, R.southBatteryA, R.southBatteryB, R.southBatteryC],
    [33100, 33097, 33099, 33098, 33101, 33102, 33103]
  );
  const rows = C.waterfrontBathurstExcludedRowsFor();
  assert.equal(rows.length, 7);
  for (const r of rows) assert.equal(C.GEO.buildings[r][9], 'Canada Malting Silos', `excluded row ${r} is a named silo row`);
  // pre-builder (as buildings.js calls it)
  for (const r of rows) assert.equal(C.waterfrontBathurstExcludesBuilding(r), true);
  // the neighbouring Corleck Building (rows 32974/32976) and unrelated rows are untouched
  assert.equal(C.waterfrontBathurstExcludesBuilding(32974), false);
  assert.equal(C.waterfrontBathurstExcludesBuilding(32976), false);
  assert.equal(C.waterfrontBathurstExcludesBuilding(999999), false);
  const out = C.createWaterfrontBathurst(THREE, new THREE.Scene());
  assert.equal([...C.waterfrontBathurstExcludedRows].sort((a, b) => a - b).join(','), rows.slice().sort((a, b) => a - b).join(','));
});

test('the runtime gate disables both the build and the exclusion predicate', () => {
  const C = city();
  C.setWaterfrontBathurstEnabled(false);
  assert.equal(C.waterfrontBathurstExcludesBuilding(C.waterfrontBathurstResolveRows().northBlock), false);
  const off = C.createWaterfrontBathurst(THREE, new THREE.Scene());
  assert.equal(off.group.children.length, 0);
  assert.equal(off.colliders.length, 0);
  assert.equal(off.stats.enabled, false);
  assert.equal(C.setWaterfrontBathurstEnabled(true), true);
  const on = C.createWaterfrontBathurst(THREE, new THREE.Scene());
  assert.ok(on.group.children.length > 0);
});

test('an unsupported frame yields an empty group and no exclusion claims', () => {
  const C = city();
  const bad = C.waterfrontBathurstLayout({ geo: { ...C.GEO, frame: { detail: { x0: 0, x1: 10, z0: 0, z1: 10 } } } });
  assert.equal(bad.supported, false);
  assert.equal(bad.structures, undefined);
  const C2 = city({ withGeo: false });
  C2.GEO = { frame: { detail: { x0: 0, x1: 0, z0: 0, z1: 0 } }, buildings: [], areas: [] };
  C2.waterfrontBathurstExcludedRows = undefined;
  const out = C2.createWaterfrontBathurst(THREE, new THREE.Scene());
  assert.equal(out.group.children.length, 0);
  assert.equal(out.stats.supported, false);
});

// ---- Integration: the default desktop frame is eglinton, whose building table differs (rows 130964..130970 vs
// 33097..33103). Load the REAL unpacked eglinton geodata and the REAL city-grid helper (which returns a Mesh, not a
// geometry) to cover the integrated-runtime path.
import { unpackGeo } from '../js/geodata-loader.js';

const readBin = (p) => { const b = fs.readFileSync(new URL(`../${p}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

test('eglinton frame: rows resolve by key (index differs), build with the real Mesh-returning helper, exclude only silo rows', async () => {
  const { GEO } = await unpackGeo(readBin('data/frames/eglinton/toronto-geodata.bin'));
  assert.ok(GEO.buildings.length > 100000, 'the eglinton building table is the big one');
  const meshHelper = (T) => (pts, bottomY, height) => {
    const shape = new T.Shape();
    pts.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
    shape.closePath();
    const geo = new T.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, bottomY, 0);
    return new T.Mesh(geo, null); // the real city-grid contract: a MESH
  };
  const ctx = {
    window: { CITY: { THREE, Addons: { mergeGeometries }, CITY_BOUNDS: { sidewalkHeight: 0.22, waterLevel: -0.7 }, createExtrudedPolygonMesh: meshHelper(THREE), GEO } },
    console: { info() {}, warn() {}, error() {} }, performance
  };
  vm.runInNewContext(read('js/waterfront-bathurst.js'), ctx);
  const C = ctx.window.CITY;
  assert.equal(C.waterfrontBathurstSupported(), true, 'eglinton frame is supported');
  const R = C.waterfrontBathurstResolveRows();
  assert.deepEqual(
    [R.northBlock, R.marineLeg, R.northHeadhouse, R.southHeadhouse, R.southBatteryA, R.southBatteryB, R.southBatteryC],
    [130967, 130964, 130966, 130965, 130968, 130969, 130970]
  );
  assert.notEqual(R.northBlock, 33100, 'the eglinton index differs from the detail index (proves it is not hardcoded)');
  for (const bi of Object.values(R)) assert.equal(GEO.buildings[bi][9], 'Canada Malting Silos');
  const out = C.createWaterfrontBathurst(THREE, new THREE.Scene());
  assert.ok(out.group.children.length > 0);
  for (const m of out.group.children) assert.ok(geomFinite(m), `${m.name} finite in eglinton`);
  for (const bi of Object.values(R)) assert.equal(C.waterfrontBathurstExcludesBuilding(bi), true);
  assert.equal(C.waterfrontBathurstExcludesBuilding(0), GEO.buildings[0][9] === 'Canada Malting Silos');
  assert.ok(out.colliders.every((c) => Number.isFinite(c.maxY)));
});

test('the merge is safe with a real Mesh-returning extruded helper (no Mesh reaches mergeGeometries)', () => {
  const C = city();
  C.createExtrudedPolygonMesh = (pts, bottomY, height) => {
    const shape = new THREE.Shape();
    pts.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, bottomY, 0);
    return new THREE.Mesh(geo, null);
  };
  const out = C.createWaterfrontBathurst(THREE, new THREE.Scene());
  assert.equal(out.stats.buildError, undefined);
  assert.ok(out.group.children.some((m) => m.name === 'WaterfrontBathurst_NorthBlock_Shell' && m.geometry.attributes.position.count > 0));
});
