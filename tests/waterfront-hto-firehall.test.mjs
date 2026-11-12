// HTO firehall replacement (js/waterfront-hto-firehall.js): the named mapped row is replaced visually by a two-storey
// primary-source mass (13,000 sq ft) with a ~5 m lower volume, recessed upper block to an explicitly estimated 8.5 m,
// glazed garage bays and a roof-terrace rail. GEO is never mutated; the captain gets a per-row exclusion predicate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function city({ geodata = 'js/toronto-geodata.js', geo = null, frame = null } = {}) {
  const C = { THREE, Addons: { mergeGeometries }, CITY_BOUNDS: { sidewalkHeight: 0.22 } };
  if (geo) C.GEO = geo;
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {} }, performance };
  if (geodata) vm.runInNewContext(read(geodata), ctx);
  if (frame) ctx.window.CITY.GEO.frame.detail = frame;
  vm.runInNewContext(read('js/waterfront-hto-firehall.js'), ctx);
  return ctx.window.CITY;
}

const namedRow = (GEO) => GEO.buildings.find((b) => /Toronto Fire and Marine Station 334/i.test(b[9] || ''));

test('the mapped named row is found in the detail frame; the two-storey source facts are recorded', () => {
  const C = city();
  const L = C.htoFirehallLayout();
  assert.equal(L.supported, true);
  assert.equal(L.parts.length, 3);
  assert.equal(L.source.storeys, 2);
  assert.equal(L.source.floorAreaSqFt, 13000);
  assert.equal(L.heights.lower, 5);
  assert.equal(L.heights.upper, 8.5);
  assert.equal(L.heights.upperSource, 'photo estimate');
  assert.match(L.row[9], /Toronto Fire and Marine Station 334/i);
  assert.ok(L.row[3].length >= 3, 'mapped part footprint is used');
  assert.equal(C.HTO_FIREHALL.sourceStoreys, 2);
});

test('the build is a low two-storey mass at the mapped footprint, not the inherited 28.5 m generic tower', () => {
  const C = city();
  const scene = new THREE.Scene();
  const out = C.createWaterfrontHtoFirehall(THREE, scene);
  assert.ok(out);
  assert.equal(scene.children.filter((o) => o === out.group).length, 1);
  assert.equal(out.group.name, 'WaterfrontHtoFirehall');
  assert.equal(out.stats.sourceStoreys, 2);
  assert.equal(out.stats.lowerHeight, 5);
  assert.equal(out.stats.upperHeight, 8.5);
  assert.equal(out.stats.upperHeightSource, 'photo estimate');
  assert.equal(out.stats.parts, 3);
  assert.equal(out.stats.garageBays, 3);
  assert.equal(out.stats.meshes, 8);
  assert.ok(out.stats.triangles > 1000 && out.stats.triangles < 6000, `${out.stats.triangles} triangles`);
  assert.equal(out.colliders.length, 3);
  for (const c of out.colliders) {
    assert.ok(c.prop && c.kind === 'firehall');
    assert.equal(c.minY, 0);
    assert.ok(Math.abs(c.maxY - 5) < 1e-9, 'collider is the lower volume only');
    assert.ok(c.maxX > c.minX && c.maxZ > c.minZ);
  }
  const roles = out.group.children.map((m) => m.userData.role).sort();
  assert.deepEqual(roles, [
    'firehall-corrugated-strip', 'firehall-flat-roof', 'firehall-garage-bays', 'firehall-lower-mass',
    'firehall-recessed-upper', 'firehall-roof-rail', 'firehall-sign-band', 'firehall-vertical-glazing'
  ]);
  for (const m of out.group.children) {
    assert.ok(m.userData.cullDistance > 0 && m.userData.cullCell > 0, `${m.userData.role} culling metadata`);
    const a = m.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]), `${m.userData.role} finite positions`);
    if (m.computeBoundingSphere) { m.computeBoundingSphere(); assert.ok(Number.isFinite(m.boundingSphere.radius)); }
  }
  assert.ok(!roles.some((r) => /boat/i.test(r)), 'no boats without a source placement');
});

test('GEO is never mutated and only the successfully replaced named row is excluded', () => {
  const C = city();
  const row = namedRow(C.GEO);
  const rowSnapshot = JSON.stringify(row);
  const headSnapshot = JSON.stringify(C.GEO.buildings.slice(0, 20));
  const count = C.GEO.buildings.length;
  assert.equal(C.htoFirehallExclusionAt(row[0], row[1]), false, 'no exclusion before the builder succeeds');
  const out = C.createWaterfrontHtoFirehall(THREE, new THREE.Scene());
  assert.ok(out);
  assert.equal(JSON.stringify(row), rowSnapshot, 'named row unchanged');
  assert.equal(JSON.stringify(C.GEO.buildings.slice(0, 20)), headSnapshot, 'other rows unchanged');
  assert.equal(C.GEO.buildings.length, count, 'no building deleted');
  assert.ok(C.GEO.buildings.includes(row), 'original row still in GEO');
  assert.equal(C.htoFirehallReplacesBuilding(row), true);
  assert.equal(C.htoFirehallReplacesBuilding(C.GEO.buildings[0]), C.GEO.buildings[0] === row);
  for (const p of out.layout.parts) {
    assert.equal(C.htoFirehallExclusionAt(p.cx, p.cz), true, 'inside the replaced mapped part footprint');
  }
  assert.equal(C.htoFirehallExclusionAt(row[0] + 500, row[1] + 500), false, 'outside the named row');
});

test('unsupported frame is a clean no-op; the real Eglinton frame builds the same two-storey mass', async () => {
  const C = city({ geodata: null });
  const real = city();
  const realMain = real.htoFirehallLayout().main;
  C.GEO = real.GEO;
  C.GEO.frame = { detail: { x0: -9000, x1: -8000, z0: -9000, z1: -8000 } };
  assert.equal(C.htoFirehallSupported(), false);
  const scene = new THREE.Scene();
  assert.equal(C.createWaterfrontHtoFirehall(THREE, scene), null);
  assert.equal(scene.children.length, 0);
  assert.equal(C.waterfrontHtoFirehallEnabled, false);
  assert.ok(typeof C.waterfrontHtoFirehallError === 'string' && C.waterfrontHtoFirehallError.length > 0);
  assert.equal(C.htoFirehallExclusionAt(realMain.cx, realMain.cz), false);

  const { unpackGeo } = await import('../js/geodata-loader.js');
  const buf = await fs.promises.readFile(new URL('../data/frames/eglinton/toronto-geodata.bin', import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { GEO } = await unpackGeo(ab);
  const E = city({ geodata: null, geo: GEO });
  assert.equal(E.htoFirehallLayout().supported, true);
  const built = E.createWaterfrontHtoFirehall(THREE, new THREE.Scene());
  assert.ok(built && built.stats.sourceStoreys === 2 && built.stats.upperHeight === 8.5 && built.stats.garageBays === 3);
});
