// Source-keyed storefront signs (st-wt0.15) and the generated storefronts & entrances under them (st-sz0).
// docs/storefronts.md. No raw data needed: everything here reads committed files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { faceOf, idResolver } from '../tools/geo-ids.mjs';
import { loadCommitted, compileStorefronts, reviewSheet, streetPoint, wallAt, alongFace, addressOrderConflicts, houseNumber, normName, categoryOf,
  RULES, CORRIDOR, MANIFEST } from '../tools/build-storefront-signs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const { GEO, IDS, CAFETO, geodataHash } = loadCommitted();
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const runtime = (() => {
  const c = { window: {} };
  vm.runInNewContext(read('js/toronto-storefronts.js'), c);
  return c.window.CITY.STOREFRONTS;
})();

test('the committed signs are the compile of the committed manifest, for the committed geodata', () => {
  assert.equal(runtime.geodata, IDS.geodata, 'compiled against the geodata the identity sidecar describes');
  assert.equal(runtime.geodata, geodataHash);
  const data = compileStorefronts({ GEO, IDS, manifest, geodataHash });
  assert.deepEqual(JSON.parse(JSON.stringify(runtime)), JSON.parse(JSON.stringify(data)));
  assert.equal(data.dropped.length, manifest.records.filter((r) => r.enabled === false).length, 'only disabled records drop');
  assert.ok(runtime.signs.length >= 40 && runtime.signs.length <= 140, `${runtime.signs.length} signs on the pilot corridor`);
  assert.match(runtime.attribution, /OpenStreetMap contributors \(ODbL/);
  assert.equal(read('docs/storefront-signs-review.md'), reviewSheet(manifest, data), 'the published review sheet is current');
});

test('every record carries its source IDs, provenance, evidence, confidence, review and rights (ID-1, ID-7)', () => {
  assert.equal(manifest.schema, 1);
  assert.match(manifest.sources.osm.licence, /Open Database License/);
  assert.match(manifest.sources.cafeto.licence, /Open Government Licence/);
  for (const r of manifest.records) {
    assert.match(r.id, /^osm:(node|way|relation)\/\d+$/);
    assert.match(r.face, /^to-3dmassing-2025:\d+(\.\d+)?:[nesw]$/);
    assert.ok(r.evidence.length, `${r.id} has evidence`);
    for (const e of r.evidence) {
      if (e.source === 'osm') assert.ok(e.date >= RULES.checkDateMedium, `${r.id} surveyed ${e.date}`);
      else assert.ok(e.source === 'cafeto' && CAFETO.records.some((p) => p.id === e.licence), `${r.id} permit ${e.licence}`);
    }
    assert.ok(['high', 'medium'].includes(r.confidence));
    assert.ok(r.review?.status && r.review.date && r.review.by);
    assert.match(r.rights, /ODbL/);
    assert.match(r.rights, /no logo/);
    assert.ok(categoryOf({ [r.category.split('=')[0]]: r.category.split('=')[1] }), `${r.id} is a storefront business`);
    assert.ok(r.span[1] - r.span[0] >= RULES.minSpan);
    // the real spelling: the source name unless a correction is recorded with a note
    if (r.name !== r.sourceName) assert.ok(r.note, `${r.id}: a corrected name needs a note`);
    assert.equal(r.name, r.name.normalize('NFC'));
  }
  assert.ok(manifest.rejected.every((r) => r.reason && r.id), 'every turned-down candidate says why');
});

test('each sign stands on its own building’s street face, never a rear wall or another row (ID-1)', () => {
  const resolve = idResolver(IDS);
  const near = streetPoint(GEO, CORRIDOR.street);
  for (const s of runtime.signs) {
    const place = resolve(s.id), face = resolve(s.face);
    assert.equal(place.row, s.poi);
    assert.equal(face.row, s.b);
    assert.equal(GEO.pois[s.poi][4], s.b, `${s.name}: the face is the place's own building`);
    assert.deepEqual([...s.bc], [GEO.buildings[s.b][0], GEO.buildings[s.b][1]]);
    // the wall looks at the addressed street, close to it
    const n = near(s.x, s.z);
    assert.ok(n.d <= RULES.maxFaceToStreet, `${s.name}: wall ${n.d.toFixed(1)} m from ${CORRIDOR.street}`);
    const dx = n.px - s.x, dz = n.pz - s.z, d = Math.hypot(dx, dz);
    assert.ok((s.nx * dx + s.nz * dz) / d > 0.7, `${s.name}: the wall faces the street`);
    // and the wall is the building's real wall there (on the plan's outline, not inside it)
    const f = faceOf(GEO.buildings[s.b], face.side);
    const w = wallAt(GEO.buildings[s.b], face.side, alongFace(f, s.x, s.z));
    assert.ok(w && Math.hypot(w.x - s.x, w.z - s.z) < 0.05 && w.wall === s.wall);
  }
});

test('signs sharing a wall have their own stretches of it', () => {
  const byWall = new Map();
  for (const r of manifest.records) (byWall.get(r.face) || byWall.set(r.face, []).get(r.face)).push(r);
  for (const [face, list] of byWall) {
    list.sort((a, b) => a.span[0] - b.span[0]);
    for (let i = 1; i < list.length; i++) assert.ok(list[i].span[0] >= list[i - 1].span[1] - 1e-6, `${face}: ${list[i - 1].name} / ${list[i].name}`);
  }
});

test('the compiler drops what does not resolve and never re-attaches it; disabling and corrections work (ID-2)', () => {
  const one = manifest.records[0];
  const variant = (patch) => compileStorefronts({ GEO, IDS, geodataHash, manifest: { ...manifest, records: [{ ...one, ...patch }] } });
  assert.deepEqual(variant({ enabled: false }).dropped, [{ id: one.id, reason: 'disabled' }]);
  assert.equal(variant({ id: 'osm:node/1' }).signs.length, 0, 'an unknown place is dropped');
  assert.equal(variant({ face: 'to-3dmassing-2025:999999999:n' }).signs.length, 0, 'an unknown face is dropped');
  // another building's face (a neighbour's) cannot carry this place's sign
  const other = manifest.records.find((r) => r.face.split(':').slice(0, 2).join(':') !== one.face.split(':').slice(0, 2).join(':'));
  assert.equal(variant({ face: other.face, span: other.span }).signs.length, 0, 'a face away from the place is refused');
  const fixed = variant({ name: 'Corrected Name Café', note: 'test' });
  assert.equal(fixed.signs[0].name, 'Corrected Name Café');
  assert.throws(() => compileStorefronts({ GEO, IDS, geodataHash, manifest: { ...manifest, records: [one, one] } }), /duplicate/);
  assert.throws(() => variant({ name: '' }), /bad name/);
  assert.throws(() => variant({ style: 'neon' }), /unknown style/);
  assert.throws(() => compileStorefronts({ GEO, IDS, geodataHash, manifest: { schema: 2, records: [] } }), /schema/);
});

test('evidence rules: address order, house numbers and names', () => {
  assert.equal(houseNumber('607B'), 607);
  assert.equal(houseNumber('482-484'), 482);
  assert.equal(houseNumber('650.5'), 650.5);
  assert.equal(houseNumber('rear'), null);
  assert.equal(normName("The Roasted Nut"), normName('ROASTED NUT'));
  assert.equal(normName('Nadège Patisserie'), 'NADEGEPATISSERIE');
  // numbers fall eastward on one side; the one out of order and the neighbour it contradicts are both uncertain
  const side = (pairs) => pairs.map(([t, number]) => ({ t, number, sideKey: 1 }));
  assert.deepEqual([...addressOrderConflicts(side([[0, 790], [10, 780], [20, 770], [30, 760]]))], []);
  assert.deepEqual([...addressOrderConflicts(side([[0, 790], [10, 780], [20, 788], [30, 760], [40, 750]]))].sort(), [1, 2]);
  assert.equal(categoryOf({ shop: 'vacant' }), null);
  assert.equal(categoryOf({ shop: 'erotic' }), null);
  assert.equal(categoryOf({ amenity: 'parking' }), null);
  assert.equal(categoryOf({ amenity: 'cafe' }), 'amenity=cafe');
  // a food place whose address holds another operator's CaféTO permit stays generic
  assert.ok(manifest.rejected.some((r) => /CaféTO permit at the address names another operator/.test(r.reason)));
});

// --- the browser side, in a VM with stand-ins for three.js ---
function loadSigns() {
  const tsl = new Proxy({}, { get: () => () => ({}) });
  const window = { CITY: { THREE: {}, TSL: tsl } };
  vm.runInNewContext(read('js/storefront-signs.js'), { window, console });
  return window.CITY;
}

test('lettering keeps every name whole: one line, a squeeze, or two lines; never truncated', () => {
  const { layoutSign } = loadSigns();
  const measure = (text, px) => text.length * px * 0.55; // a sans font's average advance
  const short = layoutSign('Saku', 5, measure);
  assert.deepEqual([...short.lines], ['Saku']);
  assert.ok(short.boardW >= 1.6 && short.boardW < 5, 'a short name gets a board to suit it');
  const long = layoutSign('The Kettle Modern Indian Canadian Food', 6, measure);
  assert.equal(long.lines.length, 2);
  assert.equal(long.lines.join(' '), 'The Kettle Modern Indian Canadian Food');
  for (const [name, w] of [['Fresh Picked Fresh Produce & Flowers', 3.0], ['Supercalifragilisticexpialidocious', 2.6], ['Köz Bingöl', 3], ['Uncle Terry’s', 2.7]]) {
    const l = layoutSign(name, w, measure);
    assert.equal(l.lines.join(' '), name.split(/\s+/).join(' '));
    assert.ok(l.cellW <= 1024 && l.boardW <= Math.max(1.6, w) + 1e-9 && l.textW <= l.boardW && l.px >= 8);
  }
});

test('the sign atlas fits the spec’s per-tier ceilings with mips (ID-4)', () => {
  const { storefrontAtlasSize, STOREFRONT_ATLAS_CEILING } = loadSigns();
  const n = runtime.signs.length;
  assert.ok(storefrontAtlasSize(n, 1).bytes <= STOREFRONT_ATLAS_CEILING.high);
  assert.ok(storefrontAtlasSize(n, 0.5).bytes <= STOREFRONT_ATLAS_CEILING.low);
  assert.equal(STOREFRONT_ATLAS_CEILING.high, 24 * 1048576);
  assert.equal(STOREFRONT_ATLAS_CEILING.low, 8 * 1048576);
  const src = read('js/storefront-signs.js');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src), 'names are drawn with fillText only');
});

// --- which buildings get storefronts (js/buildings.js) ---
function loadBuildings() {
  const CELL = 64, grid = new Map();
  for (const r of GEO.roads) {
    const p = r[6], road = { name: r[0] };
    for (let i = 0; i + 3 < p.length; i += 2) {
      const s = { ax: p[i], az: p[i + 1], bx: p[i + 2], bz: p[i + 3], r: road };
      for (let a = Math.floor(Math.min(s.ax, s.bx) / CELL); a <= Math.floor(Math.max(s.ax, s.bx) / CELL); a++) {
        for (let b = Math.floor(Math.min(s.az, s.bz) / CELL); b <= Math.floor(Math.max(s.az, s.bz) / CELL); b++) {
          (grid.get(a * 100000 + b) || grid.set(a * 100000 + b, []).get(a * 100000 + b)).push(s);
        }
      }
    }
  }
  // (city-config.js nearestRoads: the nearest point of each named road within the radius)
  const nearestRoads = (x, z, radius = 60) => {
    const best = new Map();
    for (let a = Math.floor((x - radius) / CELL); a <= Math.floor((x + radius) / CELL); a++) {
      for (let b = Math.floor((z - radius) / CELL); b <= Math.floor((z + radius) / CELL); b++) {
        for (const s of grid.get(a * 100000 + b) || []) {
          const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
          const d = Math.hypot(s.ax + t * dx - x, s.az + t * dz - z);
          if (d > radius) continue;
          const prev = best.get(s.r.name);
          if (!prev || d < prev.dist) best.set(s.r.name, { road: s.r, dist: d, px: s.ax + t * dx, pz: s.az + t * dz });
        }
      }
    }
    return [...best.values()].sort((m, n) => m.dist - n.dist);
  };
  const window = { CITY: { THREE: {}, Addons: {}, TSL: {}, GEO, CITY_BOUNDS: {}, nearestRoads, STOREFRONTS: runtime } };
  vm.runInNewContext(read('js/buildings.js'), { window, console });
  return { ...window.CITY, nearestRoads };
}

test('storefronts go on selected buildings: mapped shops, retail strips and signed walls only (st-sz0)', () => {
  const { storefrontSelection, signedWalls } = loadBuildings();
  const walls = signedWalls();
  for (const s of runtime.signs) assert.ok(walls.get(s.b).has(s.wall), `${s.name}'s wall is a storefront`);
  const sel = storefrontSelection();
  // every building holding a mapped shop, restaurant, bank, market or clinic is a candidate; offices & homes are not
  const retail = new Set(GEO.pois.filter((p) => ['shop', 'food', 'bank', 'market', 'health'].includes(p[3]) && p[4] >= 0).map((p) => p[4]));
  assert.deepEqual([...sel.own].sort((a, b) => a - b), [...retail].sort((a, b) => a - b));
  assert.ok(sel.own.size < GEO.buildings.length * 0.15, 'a minority of the city');
  // a Queen West shopfront position counts as a strip; a quiet residential street doesn't
  assert.equal(sel.onStrip(-1700, -770, 'Queen Street West'), true);
  assert.equal(sel.onStrip(-2200, -2600, 'Queen Street West'), false);
  const src = read('js/buildings.js');
  assert.match(src, /if \(kind === 1\) rnd\(\);/, 'the old shop draw still runs, so every building keeps its colours');
  assert.match(src, /faces\[w\] = WALL_KINDS\.shop/);
});

// --- the shaders: they must build, on the box walls and the ?massing=1 footprint walls ---
async function buildShaders(storefronts) {
  const THREE = await import('../vendor/three/three.webgpu.js');
  const window = { CITY: { THREE, TSL: THREE.TSL, QUALITY: { surfaceWear: 2, storefronts }, GEO, cityUniforms: null } };
  const context = vm.createContext({ window, console });
  vm.runInContext(read('js/tsl-materials.js'), context);
  vm.runInContext(read('js/storefront-signs.js'), context);
  const C = window.CITY;
  const renderer = new THREE.WebGPURenderer({ canvas: { addEventListener() {}, style: {}, getContext: () => null } });
  renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536, maxStorageBufferBindingSize: 1 << 27 }, features: new Set() };
  renderer.hasFeature = () => false; // (no adapter: the WGSL is generated, not compiled)
  const box = { x: 0, y: 5, z: 0, w: 12, h: 10, d: 8, faces: [C.WALL_KINDS.shop, C.WALL_KINDS.entry, 2, 3], paint: [0.5, 0.4, 0.3, 2.5] };
  const out = {};
  const build = (name, mesh) => {
    const b = new THREE.WGSLNodeBuilder(mesh, renderer);
    b.scene = new THREE.Scene();
    b.camera = new THREE.PerspectiveCamera();
    b.build();
    out[name] = b.fragmentShader;
  };
  build('rendered', C.createFacadeBoxes(C.createRenderedFacadeMaterial({ windowWidth: 3.1, floorHeight: 3.4, seed: 13 }), [box]));
  build('rendered1', C.createFacadeBoxes(C.createRenderedFacadeMaterial({ windowWidth: 2.4, floorHeight: 3.6, seed: 29, cornerPier: 0.5 }), [box]));
  build('curtain', C.createFacadeBoxes(C.createCurtainWallMaterial({ windowWidth: 1.6, floorHeight: 3.8, seed: 41, boxLocal: true }), [box]));
  // the ?massing=1 polygon walls (createFootprintFacades): a shop wall on the street and a rear wall
  const foot = [{ cx: 0, cz: 0, rings: [[[0, 0], [12, 0], [12, 8], [0, 8]]], h: 10, kinds: [C.WALL_KINDS.shop, 2, 2, C.WALL_KINDS.entry], paint: [0.5, 0.4, 0.3, 2.5] }];
  build('rendered-footprint', C.createFootprintFacades(C.createRenderedFacadeMaterial({ windowWidth: 3.1, floorHeight: 3.4, seed: 13, footprintLocal: true }), foot).meshes[0]);
  build('curtain-footprint', C.createFootprintFacades(C.createCurtainWallMaterial({ windowWidth: 1.6, floorHeight: 3.8, seed: 41, footprintLocal: true }), foot).meshes[0]);
  // the sign boards: an instanced box with the per-instance attributes storefront-signs.js sets
  const g = new THREE.BoxGeometry(1, 1, 1);
  for (const [k, n] of [['signRect', 4], ['signChannel', 4], ['signBoard', 4], ['signInk', 4], ['signMeta', 2]]) g.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(n), n));
  const atlas = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  build('signs', new THREE.InstancedMesh(g, C.createStorefrontSignMaterial(atlas), 1));
  return { out, THREE, C };
}

test('the storefront & entrance shaders build to WGSL on both detail levels', async () => {
  const src = read('js/tsl-materials.js');
  const store = src.slice(src.indexOf('function createStorefront('), src.indexOf('function createBuildingEntrance('));
  // (upstream 59be218 read NYC's survey-only footprintLocal in the storefront; here it is placed only by facadeCell's
  // wall frame, which the ?massing=1 footprint walls fill too: both builds below)
  assert.ok(!/footprintLocal/.test(store.replace(/\/\/.*$/gm, '')), 'the storefront reads no footprint-only identifiers (upstream 59be218 trap)');
  assert.ok(!/texture\(|fillText|LABELS|labels/.test(store), 'the generated fascia invents no shop names');
  const entrance = src.slice(src.indexOf('function createBuildingEntrance('), src.indexOf('/**\n * Curtain-Wall'));
  assert.match(entrance, /door: doorBay/, 'entrances only in the entry walls’ door bay, never on storefronts (dbaf5f9)');
  for (const level of [2, 1]) {
    const { out } = await buildShaders(level);
    for (const [name, wgsl] of Object.entries(out)) assert.ok(wgsl.length > (name === 'signs' ? 1500 : 10000) && /fn main/.test(wgsl), `${name} at detail ${level}: ${wgsl.length}`);
  }
  const quality = read('js/quality.js');
  assert.match(quality, /storefronts: 2,\n/);
  assert.match(quality, /signRes: 0\.5, lean: true, surfaceWear: 1, storefronts: 1,/);
});
