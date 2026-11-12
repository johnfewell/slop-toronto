// Reviewed QCYC marina appearance (st-sb3r.34).
//
// The st-sb3r.33 source-height correction removed three phantom towers at the Queen City Yacht Club marina but left them
// as generic brown-brick flat boxes with home windows (an actual GPU capture: reject as appearance). The primary sources
// (captain's 2024 City orthophoto review; the official 2019 renovation gallery) show row 32501 as a small low shed with
// white paneled plywood/timber walls, dark navy doors/shutters/trim, low eaves and a shallow dark pitched roof, and rows
// 32502/32503 as pale low pads under canopy.
//
// These tests prove the BOUNDED, photo-informed appearance for EXACTLY those three reviewed rows:
//   * the committed data carries a `qcyc-shed` appearance on 32501 and a neutral `qcyc-storage` appearance on 32502/03;
//   * the runtime profile exposes it, and only those three rows carry it;
//   * the renderer consumes it (buildings.js routes the reviewed rows to dedicated materials, never the city brick);
//   * the shed roof is a sealed volume whose base is the low eave and whose apex is the profile total (no stacking above
//     the collider), with closed gable ends; the shed eave helper stays low and below the total;
//   * the shed door/shutter trim is shallow relief inside the mapped footprint (no porch or extension), batched into the
//     existing instanced trim draw;
//   * the two storage rows keep the native flat envelope (no invented pitched roof), and no other row changes;
//   * the material helpers build real TSL nodes from the real three/tsl module (not source grep).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';

const readJs = (file) => fs.readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const readBin = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url));

const loadBin = async (rel) => {
  let u8 = new Uint8Array(readBin(rel));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  const { decodeGeo } = await import('../js/geodata-loader.js');
  return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
};

const detail = await loadBin('data/toronto-geodata.bin');
const TARGETS = [32501, 32502, 32503, 32139]; // (32139: the reviewed QCYC clubhouse, st-sb3r.39)

function city() {
  const C = { GEO: { ...detail.GEO, frame: { ...detail.GEO.frame, detail: { ...detail.GEO.frame.detail }, projection: { ...detail.GEO.frame.projection } } } };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(readJs('waterfront-island-buildings-data.js'), ctx, { filename: 'waterfront-island-buildings-data.js' });
  vm.runInContext(readJs('waterfront-island-buildings.js'), ctx, { filename: 'waterfront-island-buildings.js' });
  return ctx.window.CITY;
}

// Load js/tsl-materials.js and js/buildings.js with the real vendored three/tsl, so the marina material builders build
// actual TSL nodes and facade meshes (not source grep, not a stubbed shader).
async function realBuildings() {
  const THREE = await import('../vendor/three/three.webgpu.js');
  const C = {
    THREE, TSL: THREE.TSL, Addons: {}, GEO: detail.GEO,
    CITY_BOUNDS: { minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 },
    nearestRoads: () => [], QUALITY: { surfaceWear: 2, storefronts: true }
  };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(readJs('tsl-materials.js'), ctx, { filename: 'tsl-materials.js' });
  vm.runInContext(readJs('buildings.js'), ctx, { filename: 'buildings.js' });
  return C;
}

test('the committed data carries photo-informed appearance on exactly the three reviewed rows', () => {
  const D = city().ISLAND_BUILDINGS_DATA;
  const shed = D.records.find((r) => r.row === 32501);
  assert.ok(shed && shed.appearance, 'row 32501 carries an appearance');
  assert.equal(shed.appearance.style, 'qcyc-shed');
  assert.equal(shed.appearance.roofType, 'gable');
  assert.equal(shed.appearance.wall, 0xf2f0ea, 'white paneled wall colour');
  assert.equal(shed.appearance.trim, 0x1b2a44, 'dark navy trim');
  assert.equal(shed.appearance.roof, 0x3a3d42, 'dark roof');
  assert.match(shed.appearance.note, /representative|approximation/i);

  for (const row of [32502, 32503]) {
    const rec = D.massingRecords.find((r) => r.row === row);
    assert.ok(rec && rec.appearance, `row ${row} carries an appearance`);
    assert.equal(rec.appearance.style, 'qcyc-storage');
    assert.equal(rec.appearance.roof, null, 'no invented roof colour for the uncertain pads');
    assert.equal(rec.roof, null, 'native flat envelope kept');
  }

  // No other record claims a marina appearance.
  for (const r of D.records.concat(D.massingRecords || [])) {
    if (TARGETS.includes(r.row)) continue;
    assert.equal(r.appearance, undefined, `row ${r.row} must not carry a marina appearance`);
  }
});

test('the runtime profile exposes the appearance with provenance for the three rows only', () => {
  const C = city();
  const p = C.islandBuildingProfile(detail.GEO.buildings[32501], 32501);
  assert.ok(p.appearance && p.appearance.style === 'qcyc-shed');
  assert.ok(p.appearance.source, 'the appearance names its source');
  const s2 = C.islandBuildingProfile(detail.GEO.buildings[32502], 32502);
  assert.equal(s2.appearance.style, 'qcyc-storage');
  assert.equal(s2.osm, null, 'City-only row has no fabricated OSM way');
  // A normal cottage has no marina appearance.
  const cottage = C.ISLAND_BUILDINGS_DATA.records.find((r) => r.typology === 'cottage');
  const cp = C.islandBuildingProfile(detail.GEO.buildings.find((r) => Math.abs(r[0] - cottage.cx) < 0.2 && Math.abs(r[1] - cottage.cz) < 0.2));
  assert.equal(cp.appearance, null);
});

test('buildings.js routes only the reviewed rows to dedicated marina materials, never the city brick', () => {
  const src = readJs('buildings.js');
  // The marina style is gated on the profile appearance, and the shed/storage boxes take their own arrays.
  assert.match(src, /islandProfile\?\.appearance \? islandProfile\.appearance\.style : null/);
  assert.match(src, /marinaShedBoxes\.push\(/);
  assert.match(src, /marinaStorageBoxes\.push\(/);
  assert.match(src, /createMarinaShedMaterial\(\)/);
  assert.match(src, /createMarinaStorageMaterial\(\)/);
  // The shed roof is the sealed pushGableRoof with the wall colour on its ends.
  assert.match(src, /pushGableRoof\(roofTiles, cx, cz, ang, u0, u1, v0, v1, y0 \+ marinaShedWallH, pitch, MARINA_SHED_OVERHANG, rgb, linear\(MARINA_SHED_WALL\)\)/);
});

test('the shed eave stays low and below the profile total, so eaves + roof never stack above the collider', async () => {
  const C = await realBuildings();
  const total = 4; // the reviewed profile height
  const eave = C.marinaShedEaveHeight(total);
  assert.ok(eave < total - 0.3, `eave ${eave} is below the total ${total}`);
  assert.ok(eave >= 2.0 && eave <= 2.6, `eave ${eave} is low (a door + short header)`);
  // A taller total keeps the same low eave (the roof takes more of the envelope, never the wall).
  assert.equal(C.marinaShedEaveHeight(6.5), eave);
});

test('the shed roof is a sealed volume from the low eave to the profile total with closed gable ends', async () => {
  const C = await realBuildings();
  const A = { pos: [], nor: [], uv: [], col: [] };
  const cx = 12, cz = 2181, ang = 0.6, u0 = -5.6, u1 = 5.6, v0 = -3.1, v1 = 3.1;
  const eave = C.marinaShedEaveHeight(4);
  const half = Math.max(1.2, Math.min(u1 - u0, v1 - v0) / 2);
  const pitch = Math.atan2(Math.max(0.5, 4 - eave), half + C.MARINA_SHED_OVERHANG);
  C.pushGableRoof(A, cx, cz, ang, u0, u1, v0, v1, eave, pitch, C.MARINA_SHED_OVERHANG, [0.2, 0.2, 0.22], [0.9, 0.9, 0.88]);
  assert.equal(A.pos.length % 9, 0, 'whole triangles only');
  const verts = [];
  for (let i = 0; i < A.pos.length; i += 3) verts.push({ p: [A.pos[i], A.pos[i + 1], A.pos[i + 2]], n: [A.nor[i], A.nor[i + 1], A.nor[i + 2]] });
  const ys = verts.map((v) => v.p[1]);
  const W = u1 - u0 + 2 * C.MARINA_SHED_OVERHANG, D = v1 - v0 + 2 * C.MARINA_SHED_OVERHANG;
  const rise = Math.min(W, D) / 2 * Math.tan(pitch);
  assert.ok(Math.abs(Math.min(...ys) - (eave - 0.04)) < 1e-6, 'the soffit sits just under the eave');
  assert.ok(Math.abs(Math.max(...ys) - (eave + rise)) < 1e-6, 'the apex is the rise over the eave');
  assert.ok(eave + rise <= 4 + 1e-6, `apex ${eave + rise} does not exceed the profile total 4`);
  // Gable ends are vertical (closed) faces.
  const ends = verts.slice(12, 18);
  assert.ok(ends.every((v) => Math.abs(v.n[1]) < 1e-9), 'gable ends are vertical');
  // Sealed: every undirected triangle edge occurs exactly twice.
  const key = (p) => p.map((v) => v.toFixed(6)).join(',');
  const edge = new Map();
  for (let i = 0; i < verts.length; i += 3) {
    const t = verts.slice(i, i + 3).map((v) => key(v.p));
    for (let j = 0; j < 3; j++) {
      const e = [t[j], t[(j + 1) % 3]].sort().join('|');
      edge.set(e, (edge.get(e) || 0) + 1);
    }
  }
  assert.ok([...edge.values()].every((n) => n === 2), 'roof, ends, underside and fascia form a sealed volume');
});

test('the shed door/shutter trim is thin navy relief just OUTSIDE the opaque wall (visible), inside the footprint', async () => {
  const C = await realBuildings();
  const out = [];
  const cx = 1234.4, cz = 2166.2, ang = 0.551, u0 = -6.3, u1 = 6.3, v0 = -2.8, v1 = 2.8;
  const h = C.marinaShedEaveHeight(4), y0 = 0;
  C.marinaShedTrim(out, cx, cz, ang, u0, u1, v0, v1, h, y0);
  assert.ok(out.length >= 3, 'doors and a shutter are emitted');
  assert.ok(out.every((b) => b.color === C.MARINA_SHED_BLUE || b.color === C.MARINA_SHED_WALL), 'the trim is navy (with a white stile)');
  assert.ok(out.some((b) => b.color === C.MARINA_SHED_BLUE), 'navy doors/shutter are present');
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const toLocal = (x, z) => { const dx = x - cx, dz = z - cz; return [dx * cs - dz * sn, dx * sn + dz * cs]; };
  let proudOfWall = 0;
  for (const b of out) {
    const [u, v] = toLocal(b.x, b.z);
    // Every trim box is a thin panel (one horizontal dimension <= 0.02 m), not a platform.
    assert.ok(Math.min(b.w, b.d) <= 0.02, `thin panel (w ${b.w}, d ${b.d})`);
    // It stays inside the mapped footprint (a few centimetres of visual relief at most).
    assert.ok(u - b.w / 2 >= u0 - 0.03 && u + b.w / 2 <= u1 + 0.03, `u ${u} within footprint`);
    assert.ok(v - b.d / 2 >= v0 - 0.03 && v + b.d / 2 <= v1 + 0.03, `v ${v} within footprint`);
    // The outer face is just OUTSIDE the wall it sits on, so it is not buried inside the opaque wall.
    const onPlusV = b.w >= b.d && v > 0;
    const onPlusU = b.d > b.w && u > 0;
    if (onPlusV) { assert.ok(v + b.d / 2 >= v1 + 0.005, `door outer face ${v + b.d / 2} is proud of the +v wall ${v1}`); proudOfWall++; }
    else if (onPlusU) { assert.ok(u + b.w / 2 >= u1 + 0.005, `shutter outer face ${u + b.w / 2} is proud of the +u wall ${u1}`); proudOfWall++; }
    assert.ok(b.y + b.h / 2 <= h + 1e-6, 'trim does not rise above the eave');
  }
  assert.ok(proudOfWall >= 3, `at least the doors and shutter are visibly proud (${proudOfWall})`);
  // The relief is tiny: no box extends more than 3 cm past the mapped wall plane.
  for (const b of out) {
    const [u, v] = toLocal(b.x, b.z);
    assert.ok(u + b.w / 2 <= u1 + 0.03 && v + b.d / 2 <= v1 + 0.03, 'no footprint platform');
  }
});

test('the storage rows keep the native flat envelope (no invented pitched roof)', () => {
  const D = city().ISLAND_BUILDINGS_DATA;
  for (const row of [32502, 32503]) {
    const rec = D.massingRecords.find((r) => r.row === row);
    assert.equal(rec.roof, null, 'native roof kept');
    assert.equal(rec.appearance.roofType, 'flat');
    assert.equal(rec.appearance.roof, null, 'no roof colour claimed');
  }
  // The shed, by contrast, is a real pitched profile roof.
  const shed = D.records.find((r) => r.row === 32501);
  assert.equal(shed.roof, 1);
  assert.equal(shed.appearance.roofType, 'gable');
});

test('the marina material builders compile real TSL with zero home windows and local panel seams', async () => {
  const C = await realBuildings();
  assert.equal(C.MARINA_PANEL_WINDOW_RATIO_X, 0, 'zero window ratio X: no home glazing');
  assert.equal(C.MARINA_PANEL_WINDOW_RATIO_Y, 0, 'zero window ratio Y: no home glazing');
  const shed = C.createMarinaShedMaterial();
  const storage = C.createMarinaStorageMaterial();
  assert.ok(shed && shed.colorNode, 'the shed material has a real color node');
  assert.ok(storage && storage.colorNode, 'the storage material has a real color node');
  // The builders are the ones buildCityBlocks uses, and they produce real instanced facade meshes.
  const box = { x: 0, y: 1.2, z: 0, w: 6, h: 2.4, d: 5, ry: 0.3, tone: 0.5, paint: [0.9, 0.9, 0.88, 0.2] };
  const inst = C.createFacadeBoxes(shed, [box]);
  assert.ok(inst && inst.isInstancedMesh, 'the shed boxes build a real InstancedMesh');
  // The panel seam is measured along the wall tangent, not a world x+z diagonal.
  const src = readJs('buildings.js');
  assert.match(src, /positionWorld\.x\.mul\(n\.z\.negate\(\)\)\.add\(positionWorld\.z\.mul\(n\.x\)\)/);
  assert.doesNotMatch(src, /positionWorld\.x\.div\(panel\)\.add\(positionWorld\.z\.div\(panel\)\)/);
});

test('the marina materials generate WGSL in the real node builder (no shader compile regression)', async () => {
  const C = await realBuildings();
  const THREE = C.THREE;
  const renderer = new THREE.WebGPURenderer({ canvas: { addEventListener() {}, style: {}, getContext: () => null } });
  renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536, maxStorageBufferBindingSize: 1 << 27 }, features: new Set() };
  renderer.hasFeature = () => false; // generate WGSL, no GPU adapter
  renderer._bindings = undefined;
  const box = { x: 0, y: 1.2, z: 0, w: 6, h: 2.4, d: 5, ry: 0.3, faces: [0, 0, 0, 0], tone: 0.5, paint: [0.9, 0.9, 0.88, 0.2] };
  for (const [name, material] of [['shed', C.createMarinaShedMaterial()], ['storage', C.createMarinaStorageMaterial()]]) {
    const mesh = C.createFacadeBoxes(material, [box]);
    const b = new THREE.WGSLNodeBuilder(mesh, renderer);
    b.scene = new THREE.Scene();
    b.camera = new THREE.PerspectiveCamera();
    b.build();
    assert.ok(b.fragmentShader.length > 1000, `${name}: fragment WGSL generated`);
    assert.ok(b.vertexShader.length > 1000, `${name}: vertex WGSL generated`);
  }
});
