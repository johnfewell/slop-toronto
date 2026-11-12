// Harbourfront Centre (js/waterfront-harbourfront.js): the campus identity from the loaded landmark ring and the mapped
// park polygons, The Power Plant's chimney at its mapped OSM node, and the documented John Quay boardwalk along the
// mapped waterline. The tests check geometry against the loaded land, buildings, water and the mapped chimney node — and
// that the module does NOT invent square furniture, marina piers, or shadow another module's supportedCityFrame guard.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import { unpackGeo } from '../js/geodata-loader.js';

const read = (file) => fs.readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const readBin = (p) => { const b = fs.readFileSync(new URL(`../${p}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const makeContext = ({ overrides = {} } = {}) => {
  const context = vm.createContext({
    window: { CITY: { THREE } }, console: { info() {}, log() {}, warn() {} },
    location: { search: '' }, URLSearchParams, Buffer, performance,
    atob: (s) => Buffer.from(s, 'base64').toString('binary')
  });
  for (const file of ['toronto-geodata.js', 'high-park-data.js', 'don-valley.js', 'city-config.js', 'waterfront-harbourfront.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  Object.assign(context.window.CITY, overrides);
  return context.window.CITY;
};
const C = makeContext();
const FRAME = C.campusFrame();
const RING = FRAME.ring;
const LAYOUT = C.campusLayout();
const BY_ID = Object.fromEntries(LAYOUT.squares.map((s) => [s.id, s]));

const pointInRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
};

const scene = { added: [], add(object) { this.added.push(object); } };
const built = C.createWaterfrontHarbourfront(THREE, scene);

test('the campus frame is the loaded landmark ring and matches its recorded area', () => {
  const m = C.GEO.landmarks.harbourfront;
  assert.ok(FRAME, 'the campus frame resolves');
  assert.ok(ringArea(RING) > 80000 && ringArea(RING) < 95000, `ring ${Math.round(ringArea(RING))} m²`);
  assert.ok(Math.abs(ringArea(RING) - m.area) / m.area < 0.02, 'ring matches the landmark area record');
  assert.ok(LAYOUT.frame.x < -350 && LAYOUT.frame.x > -700, 'campus is on the central waterfront');
});

test('the three named public squares are mapped park polygons on the campus and clear of the water', () => {
  assert.equal(LAYOUT.squares.map((s) => s.id).sort().join(','), 'annTindalPark,canadaSquare,ontarioSquare');
  assert.equal(LAYOUT.squares.map((s) => s.name).sort().join(','), 'Ann Tindal Park,Canada Square,Ontario Square');
  for (const sq of LAYOUT.squares) {
    let wet = 0;
    for (const [x, z] of sq.ring) if (C.waterAt(x, z)) wet++;
    assert.equal(wet, 0, `${sq.name}: no ring vertex falls in the water`);
    assert.ok(pointInRing(RING, sq.x, sq.z), `${sq.name} centre lies inside the campus ring`);
    assert.ok(sq.area > 2500 && sq.area < 9000, `${sq.name} area ${sq.area} m² is a mapped square`);
  }
  assert.equal(LAYOUT.squares.slice().sort((a, b) => b.area - a.area)[0].id, 'canadaSquare');
  assert.equal(LAYOUT.squares.slice().sort((a, b) => a.x - b.x)[0].id, 'annTindalPark');
});

test('no generic square furniture is invented: no trees, benches, lights or square pads are built', () => {
  // a mapped polygon alone does not justify a planting/furniture layout; the module must not ship one
  for (const suffix of ['Squares', 'Benches', 'TreeCrowns', 'Trunks', 'Lights', 'Piers', 'Cleats']) {
    assert.equal(built.group.getObjectByName(`WaterfrontHarbourfront-${suffix}`), undefined,
      `no invented ${suffix} mesh`);
  }
  assert.equal(built.stats.benches, undefined, 'no bench count is produced');
  assert.equal(built.stats.trees, undefined, 'no tree count is produced');
});

test('The Power Plant chimney stands at the mapped OSM chimney node, beside the mapped block (not at its centroid)', () => {
  const chim = built.stats.chimney;
  assert.ok(chim, 'the chimney is recorded');
  assert.equal(C.POWER_PLANT_CHIMNEY.osmId, '555405453');
  // the mapped node is at world ~(-315.3, 706.0) — from 43.6383998, -79.3818476 via the app's projection
  const node = C.worldFromLatLon(C.POWER_PLANT_CHIMNEY.lat, C.POWER_PLANT_CHIMNEY.lon);
  assert.ok(Math.abs(chim.x - node.x) < 0.5 && Math.abs(chim.z - node.z) < 0.5, `stack at the OSM node (${chim.x.toFixed(1)},${chim.z.toFixed(1)})`);
  assert.ok(pointInRing(RING, chim.x, chim.z), 'the stack is inside the campus ring');
  // the stack rises from the ground, with an estimated height (not a roof height plus an estimate)
  assert.equal(chim.baseY, 0, 'the stack base is the ground');
  assert.ok(chim.height >= 20 && chim.height <= 40, `estimated stack height ${chim.height} m`);
  assert.ok(chim.topY <= 45, `stack top ${chim.topY} m is a standalone stack, not 34 m above a 16.5 m roof`);
  // it is adjacent to the mapped Power Plant block (provenance), but not on the tallest block's centroid
  assert.ok(chim.adjacentBlock && chim.adjacentBlock.dist < 15, `adjacent block ${chim.adjacentBlock && chim.adjacentBlock.dist.toFixed(1)} m away`);
  const tallest = { x: -327.4, z: 677.3 };
  assert.ok(Math.hypot(chim.x - tallest.x, chim.z - tallest.z) > 20, 'the stack is not on the tallest block centroid');
  // solid to the player: one collider at the stack (plus one per replaced Power Plant part)
  const chimneyColliders = built.colliders.filter((c) => c.kind === 'chimney');
  assert.equal(chimneyColliders.length, 1);
  assert.ok(chimneyColliders[0].maxY === chim.topY, 'the collider reaches the stack top');
  const ppParts = built.colliders.filter((c) => c.kind === 'power-plant');
  assert.equal(ppParts.length, C.powerPlantLayout().parts.length, 'one native collider per replaced Power Plant part');
});

test('building part centres use the city\'s local-to-world convention (u*cos+v*sin, -u*sin+v*cos)', () => {
  // a synthetic block rotated 90°: a part centred at local (1, 0) maps to world (0, -1), not (0, +1)
  const block = [0, 0, Math.PI / 2, [[1, 1, -1, 1]], 10];
  const c = C.buildingPartWorldCentre(block);
  assert.ok(Math.abs(c.x - 0) < 1e-9, `x ${c.x}`);
  assert.ok(Math.abs(c.z - (-1)) < 1e-9, `z ${c.z} (the reversed convention would give +1)`);
  // and the helper agrees with the mapped Power Plant block centre for a zero-angle block
  const flat = [100, 200, 0, [[-2, 2, -3, 3]], 8];
  const f = C.buildingPartWorldCentre(flat);
  assert.ok(Math.abs(f.x - 100) < 1e-9 && Math.abs(f.z - 200) < 1e-9, 'a symmetric part centre is the block centre');
});

test('the John Quay boardwalk stays on land and follows the mapped waterline; no marina piers are invented', () => {
  assert.ok(built.stats.boardwalkSlabs > 20, `${built.stats.boardwalkSlabs} boardwalk slabs`);
  assert.equal(built.stats.fingerPiers, undefined, 'no finger-pier count is produced');
  const bw = built.group.getObjectByName('WaterfrontHarbourfront-Boardwalk');
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let wetSlabs = 0;
  for (let i = 0; i < bw.count; i++) {
    bw.getMatrixAt(i, m); m.decompose(p, q, s);
    if (C.waterAt(p.x, p.z)) wetSlabs++;
  }
  assert.equal(wetSlabs, 0, 'no boardwalk slab floats over the water');
  // the John Quay berth point (43 38.251 N, 79 23.115 W) is inside the campus and on land
  assert.ok(built.stats.johnQuay, 'the John Quay berth point is recorded');
  assert.equal(C.campusFootprintAt(built.stats.johnQuay.x, built.stats.johnQuay.z), true);
  assert.equal(!!C.waterAt(built.stats.johnQuay.x, built.stats.johnQuay.z), false);
  // the boardwalk is on the west harbour front (John Quay / Pier 4), not the Queens Quay frontage
  let minx = Infinity, maxx = -Infinity;
  for (let i = 0; i < bw.count; i++) { bw.getMatrixAt(i, m); m.decompose(p, q, s); minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); }
  assert.ok(minx > -720 && maxx < -360 && maxx < -300, `boardwalk x ${Math.round(minx)}..${Math.round(maxx)} on the harbour front`);
});

test('The Power Plant: the eight mapped rows resolve by identity in both shipped frames, never by index', async () => {
  assert.equal(C.POWER_PLANT.rows.length, 8);
  const detail = C.powerPlantRows();
  assert.ok(detail, 'the eight rows resolve in the detail frame');
  assert.deepEqual(detail.map((r) => r.index).join(','), '33256,33257,33258,33259,33260,33261,33262,33263');
  // the eglinton frame holds the same rows at different indices: resolution must follow name+centre+height, not index
  const { GEO: EGL } = await unpackGeo(readBin('data/frames/eglinton/toronto-geodata.bin'));
  const ctx = makeContext({ overrides: { GEO: EGL } });
  const eg = ctx.powerPlantRows();
  assert.ok(eg, 'the eight rows resolve in the eglinton frame');
  assert.ok(eg.every((r) => r.index !== detail[eg.indexOf(r)].index), 'the eglinton indices differ from the detail indices');
  assert.equal(eg.map((r) => r.row[0]).join(','), detail.map((r) => r.row[0]).join(','), 'same world centres in both frames');
  // a broken key (wrong height) must not resolve, so no partial complex is drawn
  const broken = makeContext({ overrides: { GEO: { ...EGL, buildings: EGL.buildings.map((b, i) => i === eg[3].index ? [b[0], b[1], b[2], b[3], 99, ...b.slice(5)] : b) } } });
  assert.equal(broken.powerPlantRows(), null, 'a missing key row resolves nothing');
});

test('The Power Plant: the mapped parts/heights are preserved and no unmapped mass is added', () => {
  const layout = C.powerPlantLayout();
  assert.ok(layout, 'the complex layout resolves');
  const rows = C.GEO.buildings;
  let mappedParts = 0;
  for (const r of layout.rows) mappedParts += (rows[r.index][3] || []).length;
  assert.equal(layout.parts.length, mappedParts, 'one drawn part per mapped part, nothing extra');
  // the south gallery is the source-known larger volume at its mapped centre and mapped height
  assert.ok(layout.south, 'the south gallery is identified');
  assert.equal(layout.south.cx, -331.6);
  assert.equal(layout.south.cz, 722.5);
  assert.equal(layout.south.row.row[4], 8.7, 'the mapped gallery height is preserved');
  // every drawn brick mass stays inside its mapped part's horizontal footprint and the mapped height
  for (const p of layout.parts) {
    const part = rows[p.row.index][3].find((q) => q === p.part);
    assert.ok(part, 'the part is a real mapped part');
    assert.ok(p.box.du > 0 && p.box.dv > 0, 'the part has a positive footprint');
    assert.ok(rows[p.row.index][4] > 0, 'the mapped height is positive');
    assert.ok(rows[p.row.index][4] < 100, 'the mapped height is a real building height');
  }
});

test('The Power Plant: the south gallery carries the source-photographed industrial features', () => {
  const pp = built.stats.powerPlant;
  assert.ok(pp, 'the Power Plant is recorded in the build');
  assert.equal(pp.rows.length, 8);
  assert.equal(pp.southGallery.h, 8.7);
  assert.ok(pp.windows >= 8, `${pp.windows} tall multipane windows on the gallery`);
  assert.equal(pp.entry, true, 'a centre glazed entry is built');
  assert.equal(typeof pp.clerestory, 'boolean', 'the rooftop clerestory exposure is recorded');
  assert.equal(pp.shaft, false, 'unresolved near-chimney shaft is not relocated to an arbitrary visible corner');
  assert.equal(pp.signs, 2, 'the south and west signs are built');
  assert.ok(pp.signAspect > 5 && pp.signAspect < 9, `the sign keeps a broad aspect (${pp.signAspect}:1), not compressed`);
  // the whole-gallery meshes exist (brick skin, windows, mullions, entry, clerestory, shaft, hip, signs)
  for (const name of ['PowerPlantBrick', 'PowerPlantParapet', 'PowerPlantRoof', 'PowerPlantWindows', 'PowerPlantMullions',
    'PowerPlantEntryGlass', 'PowerPlantEntryFrame', 'PowerPlantEntryRoof',
    'PowerPlantSignSouth', 'PowerPlantSignWest']) {
    assert.ok(built.group.getObjectByName(`WaterfrontHarbourfront-${name}`), `${name} is built`);
  }
  assert.equal(built.group.getObjectByName('WaterfrontHarbourfront-PowerPlantShaft'), undefined);
  assert.equal(built.group.getObjectByName('WaterfrontHarbourfront-PowerPlantHip'), undefined);
  // no guessed low detail may be present when the exposure test rejects it
  if (!pp.clerestory) assert.equal(built.group.getObjectByName('WaterfrontHarbourfront-PowerPlantClerestory'), undefined, 'no buried gallery clerestory');
  // every window/entry/clerestory/shaft vertex stays within the mapped gallery height (no fake extra mass above 8.7 m)
  const E = C.POWER_PLANT_ESTIMATES;
  assert.ok(E.windowSill + E.windowHeight <= 8.7, 'the windows fit the mapped gallery height');
  assert.ok(E.entryHeight + E.entryRoof <= 8.7, 'the entry + pyramid roof fit the mapped gallery height');
  // theatre: the tallest mapped row is the grey/dark metal volume; the atrium is exposure-gated
  assert.ok(pp.theatre, 'the north theatre is recorded');
  assert.equal(pp.theatre.tallest, 33263, 'the tallest mapped row is the theatre');
  assert.equal(pp.theatre.h, 16.5, 'the theatre keeps its mapped height');
});

test('The Power Plant chimney crown is a flared brick crown, not a steel balcony', () => {
  for (const name of ['Chimney', 'ChimneyCrown', 'ChimneyRings', 'ChimneyRim', 'ChimneyRods']) {
    assert.ok(built.group.getObjectByName(`WaterfrontHarbourfront-${name}`), `${name} is built`);
  }
  assert.equal(built.group.getObjectByName('WaterfrontHarbourfront-ChimneyCap'), undefined, 'no steel balcony cap mesh');
  assert.equal(built.stats.chimney.crown, 'flared brick rings');
});

test('the exclusion hook is keyed by stable identity and only names rows actually drawn', async () => {
  assert.equal(typeof C.waterfrontHarbourfrontExcludesBuilding, 'function', 'the hook exists after the build');
  const drawn = C.powerPlantLayout().parts.map((p) => p.row.index);
  for (const bi of drawn) assert.equal(C.waterfrontHarbourfrontExcludesBuilding(bi), true, `row ${bi} is excluded`);
  for (const bi of [33246, 33247, 33255, 33200, 34614]) assert.equal(C.waterfrontHarbourfrontExcludesBuilding(bi), false, `row ${bi} is not excluded`);
  // identity, not stored index: the same stored indices in ANOTHER frame's data must NOT be excluded
  const { GEO: EGL } = await unpackGeo(readBin('data/frames/eglinton/toronto-geodata.bin'));
  assert.equal(C.waterfrontHarbourfrontExcludesBuilding(33259, EGL), false, 'same index in the eglinton table is a different building');
  const egRow = EGL.buildings.findIndex((b) => b[9] === C.POWER_PLANT.name && Math.abs(b[0] + 331.6) < 0.5 && Math.abs(b[1] - 722.5) < 0.5);
  assert.equal(C.waterfrontHarbourfrontExcludesBuilding(egRow, EGL), true, 'the eglinton gallery row is excluded by identity');
  // a fresh context before any build has no hook
  const fresh = makeContext();
  assert.equal(fresh.waterfrontHarbourfrontExcludesBuilding, undefined, 'no hook before a build');
  // an unsupported frame builds nothing, exposes no hook and clears stale state
  const guard = makeContext();
  guard.GEO.frame.detail = { x0: 0, x1: 20, z0: 0, z1: 20 };
  assert.equal(guard.createWaterfrontHarbourfront(THREE, { add() {} }), null);
  assert.equal(typeof guard.waterfrontHarbourfrontExcludesBuilding, 'function', 'a safe predicate remains');
  assert.equal(guard.waterfrontHarbourfrontExcludesBuilding(33259), false, 'stale state is cleared on an unsupported frame');
});

test('the Power Plant brick uses world-metre courses (not unit-box uv) and a white instance tint (no double multiply)', async () => {
  const webgpu = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const ctx = vm.createContext({
    window: { CITY: { THREE: webgpu, TSL, CITY_BOUNDS: { sidewalkHeight: 0.22, waterLevel: -0.7 } } },
    console: { info() {}, warn() {}, error() {} }, performance,
    location: { search: '' }, URLSearchParams, Buffer, atob: (s) => Buffer.from(s, 'base64').toString('binary')
  });
  for (const file of ['toronto-geodata.js', 'high-park-data.js', 'don-valley.js', 'city-config.js', 'waterfront-harbourfront.js']) {
    vm.runInContext(read(file), ctx, { filename: file });
  }
  const C2 = ctx.window.CITY;
  const out = C2.createWaterfrontHarbourfront(webgpu, { add() {} });
  const brick = out.group.getObjectByName('WaterfrontHarbourfront-PowerPlantBrick');
  assert.ok(brick && brick.material, 'the brick mesh exists');
  assert.ok(brick.material.isMeshStandardNodeMaterial, 'the brick uses a node material on the WebGPU path');
  assert.ok(brick.material.colorNode, 'the brick colour node is built from world position');
  // the material carries the brick colour; every instance tint is white so it is not multiplied twice
  const col = brick.material.color;
  assert.ok(col.r > col.g && col.g > col.b * 0.9, 'the material base is a red-brown brick');
  const c = new webgpu.Color();
  for (let i = 0; i < brick.count; i++) {
    brick.getColorAt(i, c);
    assert.ok(Math.abs(c.r - 1) < 1e-3 && Math.abs(c.g - 1) < 1e-3 && Math.abs(c.b - 1) < 1e-3, `instance ${i} tint is white (no double multiply)`);
  }
  // the world-metre graph is present, not the unit-uv attribute path
  const src = read('waterfront-harbourfront.js');
  assert.ok(/positionWorld\.y\.div\(brickH\)/.test(src), 'courses are metres up, from positionWorld');
  assert.equal(/const uv = attribute\('uv'/.test(src), false, 'no unit-box uv is used for the brick period');
});

test('Power Plant classification: theatre rows are grey metal, low annexes brick, gallery brick', () => {
  const roles = built.stats.powerPlant.roles;
  assert.equal(roles.filter((r) => r === 'theatre').length, 3, 'three north theatre rows');
  assert.equal(roles.filter((r) => r === 'brick').length, 5, 'the gallery, connector and low annexes are brick');
  // the theatre volume is drawn as a distinct grey-metal body, not a brick wall: its screened band exists
  const band = built.group.getObjectByName('WaterfrontHarbourfront-PowerPlantTheatreBand');
  assert.ok(band && band.count >= 3, 'the theatre metal band is built for its taller rows');
});

test('the built campus: one culling root, instanced bounded meshes under the documented roles', () => {
  assert.equal(scene.added.length, 1);
  assert.equal(built.group.name, 'WaterfrontHarbourfront');
  assert.equal(built.root, built.group);
  assert.equal(built.group.userData.waterfrontHarbourfront, built.stats);
  assert.equal(built.stats.meshes, built.group.children.length);
  assert.equal(built.stats.meshes, built.group.children.length);
  for (const name of ['Boardwalk', 'Chimney', 'ChimneyCrown', 'ChimneyRings', 'PowerPlantBrick', 'PowerPlantWindows']) {
    const mesh = built.group.getObjectByName(`WaterfrontHarbourfront-${name}`);
    assert.ok(mesh && mesh.isInstancedMesh, `${name} is instanced`);
    assert.ok(mesh.userData.cullDistance > 0 && mesh.userData.cullCell > 0, `${name} has culling metadata`);
  }
  assert.ok(built.stats.triangles < 40000, `${built.stats.triangles} triangles (a bounded build)`);
});

test('the campus and square predicates identify membership without licensing a tree strip', () => {
  assert.equal(C.campusFootprintAt(-327, 677), true, 'the Power Plant block is on campus');
  assert.equal(C.campusFootprintAt(1000, 600), false, 'Sugar Beach is not the Harbourfront campus');
  assert.equal(C.campusFootprintAt(-300, 1100), false, 'far out over the lake is not campus');
  for (const sq of LAYOUT.squares) {
    const hit = C.campusSquareAt(sq.x, sq.z);
    assert.ok(hit && hit.id === sq.id, `${sq.name} centre resolves to its square`);
  }
  assert.equal(C.campusSquareAt(-152, 793), null, 'the harbour edge has no square');
});

test('exports a unique guard: waterfrontHarbourfrontSupported, never supportedCityFrame', () => {
  assert.equal(typeof C.waterfrontHarbourfrontSupported, 'function');
  const src = read('waterfront-harbourfront.js');
  // the module must not define or export the shared-name supportedCityFrame (other modules own it; it collided)
  assert.equal(/\bfunction\s+supportedCityFrame\b/.test(src), false, 'does not define supportedCityFrame');
  assert.equal(/supportedCityFrame\s*,/.test(src), false, 'does not export supportedCityFrame');
  assert.ok(src.includes('waterfrontHarbourfrontSupported'));
});

test('frame guard: the fixed-coordinate campus is not built in an unsupported map frame', () => {
  const guard = makeContext();
  assert.equal(guard.waterfrontHarbourfrontSupported(), true, 'the Toronto detail frame is supported');
  const fake = { added: [], add(object) { this.added.push(object); } };
  guard.GEO.frame.detail = { x0: 0, x1: 20, z0: 0, z1: 20 };
  const result = guard.createWaterfrontHarbourfront(THREE, fake);
  assert.equal(result, null);
  assert.equal(fake.added.length, 0);
  assert.equal(guard.waterfrontHarbourfrontEnabled, false);
});

test('sources are recorded and the build is deterministic', () => {
  const source = read('waterfront-harbourfront.js');
  for (const needle of ['235 Queens Quay', '10-acre', 'harbourfrontcentre.com/about-us',
    'harbourfrontcentre.com/program/harbourfront-centre-marine', 'The Power Plant', 'Canada Square',
    'Ontario Square', 'Ann Tindal Park', 'waterfrontoronto.ca/our-projects/scope-scale/central-waterfront',
    'man_made=chimney', '555405453', '26594650', '26594651']) {
    assert.ok(source.includes(needle), `records ${needle}`);
  }
  assert.equal(/Math\.random\s*\(/.test(source), false, 'no random placement');
  assert.equal(typeof C.createWaterfrontHarbourfront, 'function');
  assert.equal(C.buildWaterfrontHarbourfront, C.createWaterfrontHarbourfront);
  assert.equal(C.waterfrontHarbourfrontEnabled, true);
  const again = makeContext().campusLayout().squares;
  const canada = again.find((s) => s.id === 'canadaSquare');
  assert.ok(Math.abs(canada.x - BY_ID.canadaSquare.x) < 0.01 && Math.abs(canada.z - BY_ID.canadaSquare.z) < 0.01,
    'Canada Square centre is deterministic');
});