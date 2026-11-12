// Toronto Music Garden (js/waterfront-music-garden.js): six rooms georeferenced on the REAL OpenStreetMap movement
// nodes in GEO.pois, tiled into the measured landmark ring as nearest-node cells, with the Music Pavilion, the grass
// Gigue amphitheatre and the Sarabande water stone placed on their nodes. The tests check the real coordinates and
// geometry, not source strings alone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';

const read = (file) => fs.readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const makeContext = () => {
  const context = vm.createContext({
    window: { CITY: { THREE } }, console: { info() {}, log() {}, warn() {} },
    location: { search: '' }, URLSearchParams, Buffer, performance,
    atob: (s) => Buffer.from(s, 'base64').toString('binary')
  });
  for (const file of ['toronto-geodata.js', 'high-park-data.js', 'don-valley.js', 'city-config.js', 'waterfront-music-garden.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  return context.window.CITY;
};
const C = makeContext();
const ROOMS = C.MUSIC_GARDEN_ROOMS;
const scene = { added: [], add(object) { this.added.push(object); } };
const garden = C.createWaterfrontMusicGarden(THREE, scene);
const LAYOUT = C.gardenLayout();
const FRAME = C.gardenFrame();
const ANCHORS = C.musicGardenAnchors();
const BY_ID = Object.fromEntries(LAYOUT.rooms.map((r) => [r.id, r]));

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

test('the six rooms are anchored on the real OSM movement nodes, at their committed coordinates', () => {
  assert.equal(ROOMS.length, 6);
  // real nodes from GEO.pois, the committed OSM place POIs
  const expect = {
    Allemande: [-1429.3, 569.3], Prelude: [-1391.9, 572.3], Courante: [-1351.0, 562.8],
    Sarabande: [-1322.7, 561.4], Menuett: [-1286.7, 564.0], Gigue: [-1312.8, 600.1]
  };
  for (const [name, [x, z]] of Object.entries(expect)) {
    const a = ANCHORS[name];
    assert.ok(a, `anchor ${name} exists`);
    assert.ok(Math.abs(a.x - x) < 0.2 && Math.abs(a.z - z) < 0.2, `${name} at its OSM node (${a.x}, ${a.z})`);
  }
  // every room names the node it is anchored on, and that node exists
  for (const room of ROOMS) assert.ok(ANCHORS[room.anchor], `${room.id} anchors the real ${room.anchor} node`);
});

test('physical west-to-east order is Allemande, Prelude, Courante, Sarabande, Gigue, Menuett (not suite order)', () => {
  assert.equal(ROOMS.map((r) => r.id).join(','), 'allemande,prelude,courante,sarabande,gigue,menuett');
  assert.equal(ROOMS.map((r) => r.name).join(','), 'Allemande,Prelude,Courante,Sarabande,Gigue,Menuett');
  // the roman numerals are the Bach movement numbers, which are NOT the physical order
  assert.equal(ROOMS.map((r) => r.movement).join(','), 'II,I,III,IV,VI,V');
  // the six real nodes advance eastward (world x increasing) in that order
  const xs = ROOMS.map((r) => ANCHORS[r.anchor].x);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], `${ROOMS[i].name} is east of ${ROOMS[i - 1].name}`);
  // Menuett (the pavilion) is the easternmost of the six nodes
  const menuett = ANCHORS.Menuett;
  for (const name of ['Allemande', 'Prelude', 'Courante', 'Sarabande', 'Gigue']) {
    assert.ok(menuett.x > ANCHORS[name].x, `Menuett is east of ${name}`);
  }
});

test('the Gigue amphitheatre is west of the pavilion and sits toward the harbour (south)', () => {
  const gigue = ANCHORS.Gigue, menuett = ANCHORS.Menuett;
  assert.ok(gigue.x < menuett.x, 'the grass amphitheatre is west of the pavilion');
  assert.ok(gigue.z > menuett.z + 20, 'the Gigue node is well south of the pavilion (down toward the harbour)');
  // the modelled amphitheatre feature is at the (clamped) Gigue anchor and the pavilion at the Menuett anchor
  const feats = Object.fromEntries(garden.stats.features.map((f) => [f.id, f]));
  assert.ok(Math.hypot(feats.amphitheatre.x - Math.max(gigue.x, -9999), feats.amphitheatre.z - gigue.z) < 8,
    'amphitheatre is at the Gigue node (clamped into the park)');
  assert.ok(Math.hypot(feats.pavilion.x - menuett.x, feats.pavilion.z - menuett.z) < 0.5, 'pavilion is at the Menuett node');
  assert.ok(feats.amphitheatre.x < feats.pavilion.x, 'amphitheatre is west of the pavilion');
});

test('the rooms tile the measured landmark ring; the six rooms are non-uniform, and the ring area matches geodata', () => {
  const ring = [];
  for (let i = 0; i < C.GEO.landmarks.musicGarden.ring.length; i += 2) {
    ring.push([C.GEO.landmarks.musicGarden.ring[i], C.GEO.landmarks.musicGarden.ring[i + 1]]);
  }
  assert.ok(Math.abs(ringArea(ring) - C.GEO.landmarks.musicGarden.area) / C.GEO.landmarks.musicGarden.area < 0.02);
  // every assigned room cell is inside the ring
  const cells = C.roomCells(FRAME);
  assert.ok(cells.length > 400, `${cells.length} footprint cells`);
  let assigned = 0;
  for (const c of cells) {
    assert.ok(pointInRing(ring, c.x, c.z), 'every cell centre is inside the landmark ring');
    if (c.room) assigned++;
  }
  assert.ok(assigned > 300 && assigned < cells.length, `${assigned} cells assigned to rooms, the rest generic park`);
  // each room's cell is non-empty and the room sizes differ (not equal slices)
  const counts = LAYOUT.rooms.map((r) => r.cell.count);
  for (const n of counts) assert.ok(n > 20, `room cells ${n}`);
  const spread = Math.max(...counts) - Math.min(...counts);
  assert.ok(spread > 40, `room cell counts vary (${counts.join(', ')})`);
});

test('the connecting walk passes every room in physical order', () => {
  const passes = C.gardenPathPassesRooms();
  assert.equal(passes.length, 6);
  assert.equal(passes.map((p) => p.id).join(','), 'allemande,prelude,courante,sarabande,gigue,menuett');
  for (const p of passes) assert.ok(p.passed, `the walk reaches the ${p.id} room`);
  assert.ok(LAYOUT.pathLength > 120 && LAYOUT.pathLength < 320, `path length ${LAYOUT.pathLength.toFixed(0)} m`);
});

test('the built garden: one culling root, instanced parts, grass amphitheatre, pavilion and water stone', () => {
  assert.equal(scene.added.length, 1);
  assert.equal(garden.group.name, 'WaterfrontMusicGarden');
  assert.equal(garden.group.userData.waterfrontMusicGarden, garden.stats);
  assert.equal(garden.stats.meshes, garden.group.children.length);
  // all six rooms have a planted floor and stats
  for (const id of ['allemande', 'prelude', 'courante', 'sarabande', 'gigue', 'menuett']) {
    assert.ok(garden.stats.rooms[id].beds >= 1, `${id} has a room floor`);
    assert.ok(garden.stats.rooms[id].plants > 0, `${id} has planting`);
  }
  assert.ok(garden.stats.plants > 200 && garden.stats.plants < 1200, `${garden.stats.plants} planting clumps`);
  assert.ok(garden.stats.treeSites > 15, `${garden.stats.treeSites} supplemental tree sites`);
  assert.ok(garden.stats.amphitheatreTerraces > 30, `${garden.stats.amphitheatreTerraces} grass amphitheatre terraces`);
  // the garden renders no tree crowns or trunks of its own: the groves are sites for the shared ez-trees pipeline
  assert.equal(garden.group.getObjectByName('WaterfrontMusicGarden-TreeCrowns'), undefined);
  assert.equal(garden.group.getObjectByName('WaterfrontMusicGarden-Trunks'), undefined);
  assert.ok(garden.stats.granitePieces > 0 && garden.stats.granitePieces < garden.stats.amphitheatreTerraces,
    'granite is only a low rim, not the steps');
  assert.equal(garden.stats.waterStones, 1, 'one Sarabande water stone');
  assert.ok(garden.stats.ironwork >= 8, `${garden.stats.ironwork} pavilion iron members`);
  assert.ok(garden.stats.triangles > 8000 && garden.stats.triangles < 60000, `${garden.stats.triangles} triangles`);
  assert.ok(garden.colliders.length >= 8, `${garden.colliders.length} pavilion-column colliders`);

  // the Gigue room's ground is grass and the amphitheatre feature is recorded there
  assert.equal(ROOMS.find((r) => r.id === 'gigue').ground, 'grass');
  assert.ok(garden.stats.features.find((f) => f.id === 'amphitheatre'));
  assert.ok(garden.stats.features.find((f) => f.id === 'pavilion'));
  assert.ok(garden.stats.features.find((f) => f.id === 'waterStone'));
});

test('walkable surface: the sampler matches every rendered grass-terrace instance top and corner', () => {
  const g = garden.group.getObjectByName('WaterfrontMusicGarden-GrassSteps');
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let centres = 0, corners = 0;
  for (let i = 0; i < g.count; i++) {
    g.getMatrixAt(i, m);
    m.decompose(p, q, s);
    const top = p.y + s.y / 2;
    // centre of the rendered terrace: the sampler must return exactly this top
    const hit = C.waterfrontMusicGardenSurfaceAt(p.x, p.z);
    assert.ok(hit, `terrace ${i} has a walkable surface at its centre`);
    assert.equal(hit.id, 'music-garden-gigue');
    assert.equal(hit.pedestrianOnly, true);
    assert.ok(Math.abs(hit.h - top) < 1e-6, `terrace ${i}: sampler ${hit.h} vs rendered ${top}`);
    centres++;
    // a point just inside each rendered corner must return this terrace's top or a higher overlapping one
    const euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const lx = (s.x / 2) * 0.8 * sx, lz = (s.z / 2) * 0.8 * sz;
      const cos = Math.cos(euler.y), sin = Math.sin(euler.y);
      const wx = p.x + lx * cos + lz * sin;
      const wz = p.z - lx * sin + lz * cos;
      const c = C.waterfrontMusicGardenSurfaceAt(wx, wz);
      assert.ok(c, `terrace ${i} corner is walkable`);
      assert.ok(c.h >= top - 1e-6, `corner returns ${c.h} >= this terrace top ${top}`);
      corners++;
    }
  }
  assert.ok(centres > 30 && corners > 120, `${centres} terrace centres, ${corners} corners sampled`);
  // no ghost floor away from the terraces, and a ground-level point returns null
  assert.equal(C.waterfrontMusicGardenSurfaceAt(-1500, 540), null);
  assert.equal(C.waterfrontMusicGardenSurfaceAt(-1286.7, 564), null, 'the flat pavilion apron is not a raised floor');
  // the highest terraces reach about 1.4 m (the reported sink-through height) rather than 0
  let maxTop = 0;
  for (let i = 0; i < g.count; i++) { g.getMatrixAt(i, m); m.decompose(p, q, s); maxTop = Math.max(maxTop, p.y + s.y / 2); }
  assert.ok(maxTop > 1.2, `terraces rise to ${maxTop.toFixed(2)} m`);
});

test('unsupported frame leaves no ghost floor: the sampler returns null until the garden is built', () => {
  const guard = makeContext();
  assert.equal(guard.waterfrontMusicGardenEnabled, undefined, 'not enabled before a build');
  assert.equal(guard.waterfrontMusicGardenSurfaceAt(-1308.4, 594.2), null);
  assert.equal(guard.gardenStructureKeepoutAt(-1308.4, 594.2), false);
  guard.createWaterfrontMusicGarden(THREE, { add() {} });
  assert.ok(guard.waterfrontMusicGardenSurfaceAt(-1308.4, 594.2), 'built frame has the surface');
});

test('structure keep-out covers the pavilion, amphitheatre and path slabs only, not the whole park', () => {
  const feat = Object.fromEntries(garden.stats.features.map((f) => [f.id, f]));
  // the pavilion apron disc and the amphitheatre terraces are structures
  assert.equal(C.gardenStructureKeepoutAt(feat.pavilion.x, feat.pavilion.z), true, 'pavilion apron');
  assert.equal(C.gardenStructureKeepoutAt(feat.amphitheatre.x, feat.amphitheatre.z), true, 'amphitheatre stage');
  // a point on the connecting path is a keep-out slab
  const mid = LAYOUT.path[Math.floor(LAYOUT.path.length / 2)];
  assert.equal(C.gardenStructureKeepoutAt(mid[0], mid[1], 0.4), true, 'path slab');
  // open planted park between structures is NOT a structure keep-out
  let open = null;
  for (const c of C.roomCells(FRAME)) {
    if (c.room && c.room.id === 'courante' && !C.gardenStructureKeepoutAt(c.x, c.z, 0)) { open = c; break; }
  }
  assert.ok(open, 'some planted park cell is not a structure');
  assert.equal(C.gardenStructureKeepoutAt(-1500, 540), false, 'outside the garden');
});

test('supplemental tree sites: exported, unique, finite 6-10 m, real manifest models', () => {
  const sites = garden.treeSites;
  assert.ok(Array.isArray(sites) && sites.length > 15, `${sites.length} tree sites`);
  assert.equal(C.waterfrontMusicGardenTreeSites, sites, 'C.waterfrontMusicGardenTreeSites is the result list');
  assert.equal(garden.stats.treeSites, sites.length);
  const models = new Set((C.GEO.treeModels || []).map((m) => m[0]));
  assert.ok(models.size > 0, `${models.size} models in the manifest`);
  const seen = new Set();
  let prev = null;
  for (const s of sites) {
    // ez-trees contract: x, z, y, height, species, model (real id), width, and a scale fallback
    for (const k of ['x', 'z', 'y', 'height', 'width', 'scale']) assert.ok(Number.isFinite(s[k]), `${k} finite (${s[k]})`);
    assert.ok(s.height >= 6 && s.height <= 10, `height ${s.height} in 6-10 m`);
    assert.ok(s.scale > 0 && s.scale < 1.5, `scale ${s.scale} plausible`);
    assert.ok([0, 1, 2].includes(s.species), `species ${s.species} is 0/1/2`);
    assert.ok(models.has(s.model), `model ${s.model} is in the manifest`);
    assert.equal(s.y, 0, 'site stands on the ground');
    // unique within 2 m
    const key = `${Math.round(s.x)}:${Math.round(s.z)}`;
    assert.ok(!seen.has(key), `site near ${key} is not a duplicate`);
    seen.add(key);
    void prev;
    prev = s;
  }
  // sites are inside the garden and clear of the structure keep-outs
  for (const s of sites) {
    assert.ok(Math.abs(C.gardenRoomAt(s.x, s.z) !== null), `site at ${s.x.toFixed(1)}, ${s.z.toFixed(1)} is inside the garden`);
    assert.equal(C.gardenStructureKeepoutAt(s.x, s.z, 0.25), false, 'no site inside a structure keep-out');
  }
  // the sites vary in height and at least two model ids are used across the rooms
  assert.ok(new Set(sites.map((s) => s.model)).size >= 2, 'more than one real model is used');
  assert.ok(Math.max(...sites.map((s) => s.height)) - Math.min(...sites.map((s) => s.height)) > 0.5, 'heights vary');
});

test('tree sites keep the source City street-tree inventory clear', () => {
  const real = C.existingTreePositions(FRAME);
  assert.ok(real.length > 0, `${real.length} real street trees near the garden`);
  for (const s of garden.treeSites) {
    for (const [tx, tz] of real) {
      assert.ok(Math.hypot(s.x - tx, s.z - tz) >= C.MUSIC_GARDEN_ESTIMATES.treeClearance - 0.5,
        `site at ${s.x.toFixed(1)}, ${s.z.toFixed(1)} is clear of the street tree at ${tx.toFixed(1)}, ${tz.toFixed(1)}`);
    }
  }
});

test('boulders have a finite neutral-grey instance colour (no white defaults)', () => {
  const mesh = garden.group.getObjectByName('WaterfrontMusicGarden-Boulders');
  assert.ok(mesh && mesh.isInstancedMesh && mesh.instanceColor, 'boulders carry per-instance colours');
  assert.equal(mesh.instanceColor.array.length, mesh.count * 3);
  assert.equal(mesh.count, garden.stats.boulders);
  for (let i = 0; i < mesh.count; i++) {
    const r = mesh.instanceColor.getX(i), g = mesh.instanceColor.getY(i), b = mesh.instanceColor.getZ(i);
    assert.ok(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b), `boulder ${i} colour finite`);
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 0.12, `boulder ${i} is neutral grey`);
    assert.ok(Math.max(r, g, b) < 0.55, `boulder ${i} is not a bright white default`);
  }
  // pavilion iron is a dark charcoal, not crushed black
  const iron = garden.group.getObjectByName('WaterfrontMusicGarden-Ironwork');
  assert.ok(iron.instanceColor && Math.max(iron.instanceColor.getX(0), iron.instanceColor.getY(0), iron.instanceColor.getZ(0)) > 0.03,
    'iron is not crushed to black');
});

test('shared geometry: repeated parts are instanced with culling metadata', () => {
  for (const name of ['Beds', 'Plants', 'Boulders', 'Path', 'Aprons', 'Ironwork', 'GrassSteps']) {
    const mesh = garden.group.getObjectByName(`WaterfrontMusicGarden-${name}`);
    assert.ok(mesh && mesh.isInstancedMesh, `${name} is instanced`);
    assert.ok(mesh.userData.cullDistance > 0 && mesh.userData.cullCell > 0, `${name} has culling metadata`);
  }
  const grass = garden.group.getObjectByName('WaterfrontMusicGarden-GrassSteps');
  assert.equal(grass.count, garden.stats.amphitheatreTerraces);
});

test('the footprint predicate keeps the city\'s generic trees out of the garden; the room lookup resolves a node', () => {
  assert.equal(C.gardenFootprintAt(-1330, 569), true, 'garden interior');
  assert.equal(C.gardenFootprintAt(-1100, 569), false, 'east of the garden');
  assert.equal(C.gardenFootprintAt(-1600, 569), false, 'west of the garden');
  const sarab = C.gardenRoomAt(-1322.7, 561.4);
  assert.ok(sarab && sarab.room.id === 'sarabande', 'the Sarabande node resolves to the Sarabande room');
  assert.equal(C.gardenRoomAt(-1100, 569), null, 'outside the garden has no room');
});

test('frame guard and no collision with waterfront-public-realm', () => {
  const guard = makeContext();
  assert.equal(guard.waterfrontMusicGardenSupported(), true, 'the Toronto detail frame is supported');
  assert.equal(C.supportedCityFrame, undefined, 'the generic name is not exported by the garden module');
  assert.equal(typeof C.waterfrontMusicGardenSupported, 'function');
  const fake = { added: [], add(o) { this.added.push(o); } };
  guard.GEO.frame.detail = { x0: 0, x1: 20, z0: 0, z1: 20 };
  assert.equal(guard.createWaterfrontMusicGarden(THREE, fake), null);

  // load both sibling waterfront modules in one context; each keeps its own guard and builds
  const context = vm.createContext({
    window: { CITY: { THREE } }, console: { info() {}, log() {}, warn() {} },
    location: { search: '' }, URLSearchParams, Buffer, performance,
    atob: (s) => Buffer.from(s, 'base64').toString('binary')
  });
  for (const file of ['toronto-geodata.js', 'high-park-data.js', 'don-valley.js', 'city-config.js',
    'waterfront-public-realm.js', 'waterfront-music-garden.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  const both = context.window.CITY;
  assert.equal(typeof both.supportedCityFrame, 'function');
  assert.equal(typeof both.waterfrontMusicGardenSupported, 'function');
  assert.notEqual(both.supportedCityFrame, both.waterfrontMusicGardenSupported);
  const s = { added: [], add(o) { this.added.push(o); } };
  assert.equal(both.createWaterfrontPublicRealm(THREE, s).group.name, 'WaterfrontPublicRealm');
  assert.equal(both.createWaterfrontMusicGarden(THREE, s).group.name, 'WaterfrontMusicGarden');
});

test('sources are recorded and the build is deterministic', () => {
  const source = read('waterfront-music-garden.js');
  for (const needle of ['479 Queens Quay', 'Bach', 'BWV 1007', 'Yo-Yo Ma', 'Julie Moir Messervy',
    'jmmds.com/portfolio/the-toronto-music-garden', 'Harbourfront Centre', 'Summer Music in the Garden',
    'toronto.ca/explore-enjoy/parks-recreation']) {
    assert.ok(source.includes(needle), `records ${needle}`);
  }
  assert.equal(/Math\.random\s*\(/.test(source), false, 'no random placement');
  assert.equal(C.buildWaterfrontMusicGarden, C.createWaterfrontMusicGarden);
  assert.equal(C.waterfrontMusicGardenEnabled, true);
  // a second context produces the same room anchors (deterministic)
  const fresh = makeContext().gardenLayout();
  for (const id of ['allemande', 'gigue', 'menuett']) {
    const a = BY_ID[id], b = fresh.rooms.find((r) => r.id === id);
    assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6, `${id} is deterministic`);
  }
});