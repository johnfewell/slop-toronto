// The City's poster columns, publication corrals and litter receptacles: the dated snapshots, both frames' import,
// the sidewalk placement rules and the two shipped models.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { furniture, feedCounts, frameBoxes, streetFurniture, STREET_FURNITURE } from '../tools/build-open-data.mjs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const context = { window: { CITY: {} } };
for (const file of ['js/toronto-geodata.js', 'js/bench-layout.js']) vm.runInNewContext(read(file), context);
const C = context.window.CITY;
const eglintonWorld = JSON.parse(read('tools/frames/eglinton.json')).world;
const boxes = frameBoxes(C.GEO.frame, eglintonWorld);
const snap = (name) => JSON.parse(read(`tools/data/${name}-20261126.json`));
const snapshots = Object.fromEntries(STREET_FURNITURE.map(({ name }) => [name, snap(name)]));

test('the snapshots carry their City source, resource, date and licence', () => {
  for (const [name, s] of Object.entries(snapshots)) {
    assert.match(s.source.package, /^street-furniture-/, name);
    assert.equal(s.source.licence, 'open-government-licence-toronto');
    assert.equal(s.source.fetchedAt, '2026-11-26');
    assert.match(s.source.resourceId, /^[0-9a-f-]{36}$/);
  }
});

test('feed counts: every feature, Existing, Temporarily Removed, and those in each frame', () => {
  const p = feedCounts(snapshots['poster-structures'], boxes.detail);
  assert.deepEqual([p.feed, p.existing, p.removed, p.inFrame], [834, 740, 94, 278]);
  assert.deepEqual(p.byType, { PPC: 734, Collar: 6 });
  const u = feedCounts(snapshots['publication-structures'], boxes.detail);
  assert.deepEqual([u.feed, u.existing, u.removed, u.inFrame], [763, 742, 21, 90]);
  const l = feedCounts(snapshots['litter-receptacles'], boxes.detail);
  assert.deepEqual([l.feed, l.existing, l.removed, l.inFrame], [10457, 9822, 635, 2277]);
  assert.equal(Object.values(l.byType).reduce((a, b) => a + b, 0), 9822);
  const le = feedCounts(snapshots['litter-receptacles'], boxes.eglinton);
  assert.equal(le.inFrame, 4445);
  assert.equal(feedCounts(snapshots['poster-structures'], boxes.eglinton).inFrame, 413);
  assert.equal(feedCounts(snapshots['publication-structures'], boxes.eglinton).inFrame, 187);
});

test('the litter count in each frame is the number of litter bins its geodata binary holds', async () => {
  const { unpackGeo } = await import('../js/geodata-loader.js');
  const egl = await unpackGeo(fs.readFileSync(new URL('../data/frames/eglinton/toronto-geodata.bin', import.meta.url)));
  assert.equal(egl.GEO.props.litterBin.length / 2, feedCounts(snapshots['litter-receptacles'], boxes.eglinton).inFrame);
  assert.equal(C.GEO.props.litterBin.length / 2, feedCounts(snapshots['litter-receptacles'], boxes.detail).inFrame);
});

test('Existing records only, unique IDs, none lost between frames; the Eglinton frame holds the detail frame\'s', () => {
  for (const name of ['poster-structures', 'publication-structures']) {
    const d = furniture(snapshots[name], boxes.detail), e = furniture(snapshots[name], boxes.eglinton);
    assert.equal(new Set(d.records.map((r) => r.id)).size, d.records.length);
    assert.ok(d.records.every((r) => r.id && r.frontage && r.type && Number.isFinite(r.x) && Number.isFinite(r.z)));
    const ids = new Set(e.records.map((r) => r.id));
    assert.ok(d.records.every((r) => ids.has(r.id)), `${name}: the larger frame has every detail record`);
    const removed = new Set(snapshots[name].features.filter((f) => f.properties.STATUS !== 'Existing').map((f) => f.properties.ID));
    assert.ok(e.records.every((r) => !removed.has(r.id)), `${name}: no Temporarily Removed record`);
  }
  const posters = furniture(snapshots['poster-structures'], { ...boxes.eglinton, detail: { x0: -1e5, x1: 1e5, z0: -1e5, z1: 1e5 } });
  assert.equal(posters.records.filter((r) => r.type === 'Collar').length, 6, 'the six pole collars stay in the data, flagged by their type (none inside either frame)');
  assert.throws(() => furniture({ ...snapshots['poster-structures'], features: [snapshots['poster-structures'].features[0], snapshots['poster-structures'].features[0]] }, boxes.detail), /duplicate/);
});

test('the shipped frame files are the build\'s output for each frame', () => {
  for (const [frame, file] of [['detail', 'js/toronto-street-furniture.js'], ['eglinton', 'js/frames/eglinton/toronto-street-furniture.js']]) {
    const ctx = { window: { CITY: {} } };
    vm.runInNewContext(read(file), ctx);
    const want = streetFurniture(snapshots, boxes[frame]);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.window.CITY.STREET_FURNITURE)), JSON.parse(JSON.stringify(want)), file);
  }
});

// A street along z = 0 (the road below it) and a sidewalk strip 0 < z < 4.6; the City record's point may sit on the curb
const road = { name: 'Queen St W', raised: false };
const walk = { id: 'walk' };
const world = {
  nearestRoads: (x, z) => [{ road, px: x, pz: 0, dist: Math.abs(z), dx: 1, dz: 0 }],
  blockAt: (x, z) => (z > 0.1 && z < 4.6 ? walk : null)
};
const place = (records, opts = {}) => C.benchSites(records, { ...world, blocked: () => false, ...opts });
const poster = (id, x, z) => ({ id, type: 'PPC', frontage: 'Queen St W', x, z });

test('a poster column is placed on the sidewalk, turned to the street, and rejected on a roadway, in a building or beside another', () => {
  const opts = { halfWidth: .55, halfDepth: .55, clearBehind: 1 };
  const ok = place([poster('a', 10, 1.5)], opts);
  assert.equal(ok.sites.length, 1);
  assert.ok(Math.abs(Math.abs(ok.sites[0].yaw) - Math.PI) < 1e-9 || Math.abs(ok.sites[0].yaw) < 1e-9, 'faces along z, toward the road (z = 0) or away');
  assert.equal(Math.cos(ok.sites[0].yaw) < 0, true, 'its front looks toward the road at z = 0');
  assert.equal(place([poster('b', 10, -3)], opts).rejected.sidewalk + place([poster('b', 10, -3)], opts).rejected.road, 1, 'on the roadway: no site');
  assert.equal(place([poster('c', 10, 1.5)], { ...opts, blocked: (x, z) => z > 1.2 }).rejected.obstruction, 1);
  assert.equal(place([poster('d', 10, 4.4)], opts).sites.length, 0, 'no strip left behind it');
  assert.equal(place([poster('e', 10, 1.5), poster('f', 10.5, 1.5)], opts).sites.length, 1, 'a duplicate point 0.5 m away is dropped');
});

test('a corral keeps its long side along the street and its boxes face the walkers', () => {
  const s = place([{ id: 'PS-1', type: 'Corral', frontage: 'Queen St W', x: 5, z: 1.4 }], { halfWidth: .8, halfDepth: .36, clearBehind: 1 }).sites[0];
  assert.ok(s);
  assert.ok(Math.abs(Math.sin(s.yaw)) < 1e-9, 'its long axis (x) runs along the street');
  assert.ok(Math.cos(s.yaw + Math.PI) > 0, 'rotated half a turn, as street-props.js does, +z points away from the road');
});

test('street-props.js wires both kinds: layout rules, colliders, statistics and no scatter of synthetic ones', () => {
  const src = read('js/street-props.js');
  assert.match(src, /\['posterColumn', 'poster-column', 'front'/);
  assert.match(src, /\['publicationCorral', 'publication-corral', 'back'/);
  assert.match(src, /OPEN_DATA_LAYOUT = \[[^\]]*'posterColumn'[^\]]*'publicationCorral'/);
  assert.match(src, /window\.CITY\.posterStats=/);
  assert.match(src, /window\.CITY\.publicationStats=/);
  assert.match(src, /window\.CITY\.litterStats=/);
  assert.match(src, /circleCollider\(x, z, 0\.52[^)]*\), openData: true/);
  assert.match(src, /boxCollider\(x, z, 0\.76, 0\.33[^)]*\), openData: true/);
  assert.ok(!/Math\.random/.test(src), 'no random synthetic placement');
  const html = read('explore.html');
  assert.match(html, /eglinton \? '\.\/js\/frames\/eglinton\/toronto-street-furniture\.js' : '\.\/js\/toronto-street-furniture\.js'/);
  assert.match(read('js/main.js'), /\['posterColumn', 'posterStats'\], \['publicationCorral', 'publicationStats'\]/);
});

// glTF: the header's JSON chunk
const gltfOf = (name) => {
  const b = fs.readFileSync(new URL(`../assets/props/${name}.glb`, import.meta.url));
  return { bytes: b.length, json: JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()) };
};
test('the two shipped models are small, low-poly, unlit-free and carry no lettering', () => {
  for (const [name, maxTris, maxBytes, meshes] of [['poster-column', 400, 60000, 2], ['publication-corral', 400, 60000, 1]]) {
    const { bytes, json } = gltfOf(name);
    assert.ok(bytes < maxBytes, `${name} ${bytes} bytes`);
    assert.equal(json.meshes.length, meshes);
    const tris = json.meshes.reduce((n, m) => n + m.primitives.reduce((k, p) => k + json.accessors[p.indices].count / 3, 0), 0);
    assert.ok(tris <= maxTris, `${name}: ${tris} triangles`);
    for (const m of json.materials) {
      assert.ok(!m.emissiveFactor || m.emissiveFactor.every((v) => v === 0), 'nothing emissive: no real one is lit');
      assert.ok(!m.emissiveTexture && !(m.extensions && m.extensions.KHR_materials_emissive_strength));
    }
  }
  assert.equal(gltfOf('poster-column').json.images.length, 1, 'one atlas of four original posters');
});
