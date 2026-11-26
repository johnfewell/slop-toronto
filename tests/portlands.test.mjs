// The Port Lands pieces (js/portlands-*.js, bead jf-li1): the Victory Soya & Essroc silos, the shell arches over the
// Commissioners Street and Cherry Street bridges, the armour-stone banks and the planting behind them.
//
// These build the REAL geometry against the real packed geodata in a Node VM and check what each piece must be, and what
// it must not do: replace the map's own rows and decks without doubling them, stay in this map's lit materials (no toon
// or outline pipeline, no rowing-world life), and sit where the sources put it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { unpackGeo } from '../js/geodata-loader.js';

// (the VM's arrays and objects come from another realm: compare them as JSON)
const same = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const ROOT = new URL('..', import.meta.url).pathname;
const MODULES = ['high-park-data', 'don-valley', 'city-config', 'portlands-kit', 'portlands-landmarks', 'portlands-bridges', 'portlands-banks',
  'biidaasige-park-data', 'biidaasige-map-anchors', 'park-detail', 'biidaasige-path-network-data', 'biidaasige-play-landmarks', 'biidaasige-play-infrastructure',
  'biidaasige-play-pads', 'biidaasige-dog-surfaces', 'biidaasige-woodchip-island', 'biidaasige-dodem-three-island', 'biidaasige-adventure-play',
  'biidaasige-dodem', 'biidaasige-dodem-placements', 'biidaasige-heritage', 'biidaasige-paths', 'biidaasige-river-access', 'biidaasige-ground-mask',
  'biidaasige-park', 'portlands'];

let cached = null;
async function world(search = '') {
  if (!search && cached) return cached;
  const layers = await unpackGeo(fs.readFileSync(ROOT + 'data/toronto-geodata.bin'));
  const quiet = { ...console, info() {}, log() {}, warn() {} };
  const ctx = vm.createContext({ window: { CITY: { ...layers, THREE, Addons: { mergeGeometries } } }, console: quiet, location: { search }, URLSearchParams, performance, Buffer,
    atob: (s) => Buffer.from(s, 'base64').toString('binary') });
  for (const name of MODULES) vm.runInContext(fs.readFileSync(ROOT + 'js/' + name + '.js', 'utf8'), ctx, { filename: name });
  const C = ctx.window.CITY;
  const scene = new THREE.Scene();
  const park = C.createBiidaasigePark(THREE, scene);
  const pl = C.createPortLands(THREE, scene, { parkRing: park?.parkRing });
  const out = { C, scene, park, pl };
  if (!search) cached = out;
  return out;
}
function bbox(object) {
  const b = new THREE.Box3();
  object.updateWorldMatrix(true, true);
  object.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
  return b;
}
function allMeshes(object) { const m = []; object.traverse((o) => { if (o.isMesh) m.push(o); }); return m; }

test('the shape kit writes vertex-coloured, finite, mergeable parts (no toon or outline material anywhere)', async () => {
  const { C, pl } = await world();
  const K = C.PORTLANDS_KIT;
  same([...K.PLAN_ORIGIN], [2250, 500], 'plan metres + [2250, 500] = world metres (Canoe Cove plan transfer)');
  same(K.planToWorld(-240.2, 304).map((v) => Math.round(v * 10) / 10), [2009.8, 804], 'the Atlas Crane node lands on this map\'s OSM node');
  for (const mesh of allMeshes(pl.group)) {
    const m = mesh.material;
    assert.ok(m.vertexColors, `${mesh.name} reads its vertex colour`);
    assert.ok(m.isMeshStandardMaterial || m.isMeshStandardNodeMaterial, `${mesh.name} is a plain lit standard material`);
    assert.ok(!/toon|ink|outline/i.test(`${m.name} ${m.type} ${mesh.name}`), `${mesh.name} has no toon / ink pipeline`);
    assert.ok(mesh.userData.cullDistance > 0, `${mesh.name} is tagged for the scene's distance culling`);
    const p = mesh.geometry.getAttribute('position'), c = mesh.geometry.getAttribute('color'), n = mesh.geometry.getAttribute('normal');
    assert.ok(p.count > 0 && c.count === p.count && n.count === p.count, `${mesh.name} has matching position / colour / normal`);
    for (let i = 0; i < p.count; i += Math.max(1, Math.floor(p.count / 500))) assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)), `${mesh.name} finite vertex ${i}`);
  }
});

test('Atlas Crane: the park places the Port Lands frame at the OSM node, replacing (not stacking on) the old gantry', async () => {
  const { C, park } = await world();
  const crane = park.models.find((m) => m.id === 'atlas-crane');
  assert.ok(crane, 'the park placed the crane');
  assert.equal(park.models.filter((m) => m.id === 'atlas-crane').length, 1, 'one crane');
  assert.equal(crane.pose.yaw, 0, 'built in world axes about the node');
  const node = C.biidaasigeParkWorld('atlas-crane');
  assert.ok(Math.hypot(crane.pose.x - node.x, crane.pose.z - node.z) < 1e-6, 'placed on the OSM node');
  const names = [];
  park.group.traverse((o) => { if (o.name.startsWith('BiidaasigeAtlasCrane')) names.push(o.name); });
  same(names, [], 'the old four-column gantry meshes are gone');
  const found = [];
  park.group.traverse((o) => { if (o.name.startsWith('PortLandsAtlasCrane')) found.push(o.name); });
  assert.ok(found.length >= 2, 'the new crane meshes are in the park group');
  // its head line runs on compass bearing 333 (NNW), square to the bank: the fifth member's footing lies NNW of the frame
  const b = crane.bounds, ground = (b.max.y - b.min.y);
  assert.ok(ground > 34 && ground < 42, `crane stands ~36 m (${ground.toFixed(1)})`);
  assert.ok(park.excludedNativeRows.size >= 9, 'the native crane stand-in row is still left out of CityBuildings');
});

test('silos: Victory Soya Mills and Essroc stand on their two City massing rows, which are left out of CityBuildings', async () => {
  const { C, pl } = await world();
  const rows = C.GEO.buildings.map((b, i) => [b, i]).filter(([b]) => C.portLandsSiloRowMatches(b)).map(([, i]) => i);
  assert.equal(rows.length, 2, 'exactly the two documented rows match (place AND form)');
  same([...pl.excludedRows].sort((a, b) => a - b), rows.sort((a, b) => a - b));
  assert.equal(C.portLandsExcludesBuilding(rows[0]), true);
  assert.equal(C.portLandsExcludesBuilding(rows[0] + 1), false, 'no neighbouring row is excluded');
  const victory = pl.group.getObjectByName('PortLandsSilos-victory-silos');
  const essroc = pl.group.getObjectByName('PortLandsSilos-essroc-silos');
  assert.ok(victory && essroc, 'both complexes built');
  const bv = bbox(victory);
  assert.ok(Math.abs((bv.min.x + bv.max.x) / 2 - 1721.2) < 4 && Math.abs((bv.min.z + bv.max.z) / 2 - 298.5) < 4, 'Victory sits on the massing block "Silo"');
  assert.ok(bv.max.y > 36 && bv.max.y < 42, `Victory: bin tops ~33 m under a headhouse ridge ~38 m (${bv.max.y.toFixed(1)})`);
  assert.ok(bv.min.y < 0 && bv.min.y >= -3, 'Victory: its basement slab is sunk into the ground');
  const be = bbox(essroc);
  assert.ok(be.max.y > 40 && be.max.y < 50, `Essroc: the southern pair's machinery ~45 m (${be.max.y.toFixed(1)})`);
  // 36 bins in four rows of nine at Victory: the outer rows are round 16-sided shells, the inner rows eight-sided
  const g = victory.geometry;
  assert.ok(g.getAttribute('position').count / 3 > 2000, 'a real structure, not a box');
  // the rowing world's fun (painter on a cradle, pigeons, flags, climber, gulls, people) is not in the map
  for (const mesh of allMeshes(pl.group)) assert.ok(!/painter|pigeon|climber|gull|flag|person|mural/i.test(mesh.name), mesh.name);
  assert.ok(pl.colliders.some((c) => c.id === 'victory-silos') && pl.colliders.some((c) => /essroc/.test(c.id)), 'colliders for both');
});

test('without the City rows the silos are not placed (nothing is invented away from the data)', async () => {
  const { C } = await world();
  const r = C.buildPortLandsSilos({ geo: { buildings: [] } });
  assert.equal(r.group.children.length, 0);
  same(r.matchedRows, []);
});

test('bridge shells: three white arches families on the map\'s own decks, which are left exactly as they are', async () => {
  const { C, pl } = await world();
  const built = pl.layers.bridges.built;
  same(built.map((b) => b.id), ['commissioners', 'cherry-south', 'cherry-north']);
  same(built.map((b) => b.accent), ['#df6a2c', '#f2b400', '#cf4a40'], 'orange, yellow and red with white (Waterfront Toronto backgrounder)');
  assert.equal(built[0].arches.length, 2, 'Commissioners has two humps in a row');
  assert.ok(built[0].arches[0].rise !== built[0].arches[1].rise, 'the humps differ');
  assert.equal(built[1].arches.length, 1);
  assert.equal(built[2].arches.length, 1);
  // the shell never replaces a deck: the road-bridge list is the map's own, sidewalks and all
  assert.equal(C.ROAD_BRIDGES.length, 29, 'no deck added or removed');
  assert.ok(C.ROAD_BRIDGES.every((d) => Array.isArray(d.sidewalks)), 'sidewalks intact');
  const shells = pl.group.getObjectByName('PortLandsBridgeShells-steel');
  const b = bbox(shells);
  assert.ok(b.min.y >= 0.2, `the shell stands on the deck, no deeper than the sidewalk top (${b.min.y.toFixed(2)})`);
  assert.ok(b.max.y > 8 && b.max.y < 14, `highest crown ~12 m scaled to this map's shorter deck (${b.max.y.toFixed(1)})`);
  // each family sits over its own crossing (world metres, plan + [2250, 500])
  for (const [id, mid] of [['commissioners', [2768.9, 488.6]], ['cherry-south', [2151.5, 796]], ['cherry-north', [1993.6, 387.7]]]) {
    const chain = C.portLandsBridgeChains().find((c) => c.pts.some((p) => Math.hypot(p.x - mid[0], p.z - mid[1]) < 30));
    assert.ok(chain, `${id}: a deck chain under the plan crossing`);
  }
  // a walker can still cross: the shell adds no colliders
  same(C.buildPortLandsBridges({}).colliders, []);
});

test('bridge chains join the pieces one bridge is mapped as, in either direction', async () => {
  const { C } = await world();
  const pts = (a, b) => [{ x: a[0], z: a[1], h: 0 }, { x: b[0], z: b[1], h: 0 }];
  const mk = (name, a, b) => ({ name, w: 7.4, sidewalks: [2.5, 2.5], pts: pts(a, b) });
  const chains = C.portLandsBridgeChains([mk('X', [0, 0], [10, 0]), mk('X', [20, 0], [10, 0]), mk('X', [20, 0], [30, 0]), mk('Y', [100, 0], [110, 0])]);
  assert.equal(chains.length, 2);
  const x = chains.find((c) => c.name === 'X');
  assert.equal(x.pieces, 3);
  assert.equal(Math.round(Math.hypot(x.pts[0].x - x.pts[x.pts.length - 1].x, x.pts[0].z - x.pts[x.pts.length - 1].z)), 30);
});

test('armour-stone banks: dark rough blocks sunk in a slope on the water\'s edge and land side, nothing on decks or far inland', async () => {
  const { C, pl } = await world();
  const stats = pl.layers.banks;
  assert.ok(stats.chains >= 8 && stats.bankLengthM > 3000, `the river shores through the park (${stats.chains} chains, ${stats.bankLengthM} m)`);
  assert.ok(stats.stones > 5000, `thousands of blocks (${stats.stones})`);
  assert.ok(stats.triangles < 700000, `within a sane merged-geometry budget (${stats.triangles})`);
  const group = pl.group.getObjectByName('PortLandsBanks');
  const stoneMeshes = allMeshes(group).filter((m) => m.name.includes('armour'));
  assert.ok(stoneMeshes.length >= 8 && stoneMeshes.every((m) => m.userData.cullCell === 200), 'cut into cells so distance culling can drop the far ones');
  let sampled = 0, deck = 0, lum = 0, bright = 0, high = 0;
  for (const m of stoneMeshes) {
    const p = m.geometry.getAttribute('position'), c = m.geometry.getAttribute('color');
    for (let i = 0; i < p.count; i += 23) {
      sampled++;
      if (C.bridgeAt(p.getX(i), p.getZ(i), 0)) deck++;
      const l = 0.3 * c.getX(i) + 0.59 * c.getY(i) + 0.11 * c.getZ(i);
      lum += l; if (l > 0.62) bright++;
      assert.ok(p.getY(i) > 0.224 - 1.0 && p.getY(i) < 0.224 + 0.95, `height ${p.getY(i)}`);
      if (p.getY(i) > 0.224 + 0.8) high++;
    }
  }
  assert.ok(sampled > 2000);
  assert.ok(lum / sampled < 0.36, `dark limestone, not white slabs (mean luminance ${(lum / sampled).toFixed(2)})`);
  assert.equal(bright, 0, 'no pale vertex');
  assert.equal(deck, 0, 'no stone on a bridge deck');
  assert.ok(high === 0, `blocks sit low in the slope, not piled up (${high}/${sampled})`);
});

test('planting uses the map\'s own vegetation: sites at real sizes in the atlas tiles, none on water, decks or paths, and no stand-in shapes without park-cover', async () => {
  const { C, pl, park } = await world();
  assert.equal(pl.layers.banks.planted, false, 'park-cover is not loaded in this VM, so nothing of our own is drawn in its place');
  assert.equal(pl.group.getObjectByName('PortLandsPlanting'), undefined);
  const { shrubs, grass } = C.buildPortLandsBanks({ parkRing: park.parkRing, planting: false }).sites;
  assert.ok(shrubs.length > 1200 && grass.length > 5000, `a planted shore (${shrubs.length} shrubs, ${grass.length} grass clumps)`);
  for (const s of shrubs) {
    assert.ok([4, 5, 6].includes(s.tile), 'broadleaf, sumac or sapling foliage');
    assert.ok(s.h >= 0.8 && s.h <= 3.3 && s.r >= 0.6 && s.r <= 1.1, `real shrub size ${s.h} x ${s.r}`);
  }
  for (const s of grass) assert.ok([0, 1, 2].includes(s.tile) && s.h >= 0.7 && s.h <= 1.5 && s.r <= 0.9, 'bluestem, goldenrod and forbs at knee to waist height');
  let wet = 0, deck = 0;
  for (const s of [...shrubs, ...grass]) { if (C.waterAt(s.x, s.z)) wet++; if (C.bridgeAt(s.x, s.z, 4)) deck++; }
  assert.equal(wet, 0); assert.equal(deck, 0, 'nothing on or beside a bridge deck');
  assert.ok(shrubs.filter((s) => s.tile === 6).length < shrubs.length * 0.3, 'saplings are the minority: this is a new park with few big trees');
});

test('planting meshes: one near and far model per cell for shrubs, one crossed-card mesh for grass, culled by distance, from the shared park-cover models', async () => {
  const { C, park } = await world();
  const calls = [];
  C.parkCover = {
    shrubGeometry: (near) => { calls.push(near); return new THREE.PlaneGeometry(1, 1); },
    shrubMaterial: () => new THREE.MeshBasicMaterial(),
    updateShrubViewer: (p) => { calls.viewer = p; }
  };
  try {
    const out = C.buildPortLandsBanks({ parkRing: park.parkRing });
    assert.ok(out.stats.planted && out.stats.shrubs === out.sites.shrubs.length && out.stats.grass === out.sites.grass.length);
    const meshes = allMeshes(out.group.getObjectByName('PortLandsPlanting'));
    assert.ok(meshes.every((m) => m.isInstancedMesh && m.geometry.getAttribute('aShrub') && m.geometry.getAttribute('aShrubFade')));
    assert.ok(meshes.some((m) => m.name.includes('shrub-near')) && meshes.some((m) => m.name.includes('grass')));
    const first = meshes.find((m) => m.name.includes('shrub-near'));
    const x = first.geometry.getAttribute('aShrub').getX(0) >= 0 ? first.geometry.getAttribute('aShrub').getY(0) : 0;
    void x;
    const sx = first.geometry.getAttribute('aShrub').getY(0), sz = first.geometry.getAttribute('aShrub').getW(0);
    out.update({ x: sx, y: 2, z: sz });
    assert.ok(meshes.some((m) => m.visible), 'near the planting, it draws');
    assert.equal(calls.viewer.x, sx, 'the shared shrub material measures its dissolve from the camera');
    out.update({ x: sx + 5000, y: 2, z: sz });
    assert.ok(meshes.every((m) => !m.visible), 'far away, none of it draws');
  } finally { delete C.parkCover; }
});

test('bank chains: inland normals point at land, the water side at water, and the same plan gives the same banks', async () => {
  const { C, park } = await world();
  const a = C.portLandsBankChains(park.parkRing), b = C.portLandsBankChains(park.parkRing);
  assert.equal(a.length, b.length);
  let land = 0, water = 0, n = 0;
  for (const chain of a) {
    for (let i = 3; i < chain.px.length - 3; i += 7) {
      n++;
      if (!C.waterAt(chain.px[i] + chain.nx[i] * 3, chain.pz[i] + chain.nz[i] * 3)) land++;
      if (C.waterAt(chain.px[i] - chain.nx[i] * 1.5, chain.pz[i] - chain.nz[i] * 1.5)) water++;
    }
  }
  assert.ok(n > 400);
  assert.ok(land / n > 0.97, `three metres inland is land (${land}/${n})`);
  assert.ok(water / n > 0.97, `one and a half metres out is water (${water}/${n})`);
});

test('?portlands=0 leaves every Port Lands piece out for an A/B and excludes no row', async () => {
  const { C, pl } = await world('?portlands=0');
  assert.equal(pl, null);
  assert.equal(C.portLandsStats, null);
  assert.equal(C.portLandsExcludesBuilding(33863), false);
});
