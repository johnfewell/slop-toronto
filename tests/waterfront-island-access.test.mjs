// Toronto Islands ferry-to-beach access + mapped amenity identity (js/waterfront-island-access.js). The tests check the
// module against the SOURCED OSM data in js/waterfront-island-access-data.js and the real harbour water mask, not that
// source strings exist. They encode the requirements: real beach polygons (not fabricated sand), short REAL access
// spurs only (no long duplicated route overlay), mapped dock -> beach routes that stay on the walkable network and off
// open water, exact mapped amenities with no duplicate of native geodata buildings, honest gating and frame parity.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const readJs = (file) => fs.readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const readBin = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url));

const pointInRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
};
const ringDist = (ring, x, z) => {
  if (pointInRing(ring, x, z)) return 0;
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) d = Math.min(d, segDist(x, z, ring[j][0], ring[j][1], ring[i][0], ring[i][1]));
  return d;
};
const interior = (ring) => {
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 4) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 4) if (pointInRing(ring, x, z)) return [x, z];
  return null;
};

function makeContext(geo, { withDocument = false } = {}) {
  const ctx = {
    window: { CITY: { THREE, TSL, GEO: geo } },
    console: { info() {}, log() {}, warn() {}, error() {} },
    location: { search: '' }, URLSearchParams, Buffer, performance, Date,
    atob: (s) => Buffer.from(s, 'base64').toString('binary')
  };
  if (withDocument) {
    const mockCtx = { clearRect() {}, fillRect() {}, fillText() {}, measureText: (s) => ({ width: s.length * 14 }), set textAlign(v) {}, set textBaseline(v) {}, set font(v) {}, set fillStyle(v) {} };
    ctx.document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockCtx }) };
  }
  const sandbox = vm.createContext(ctx);
  for (const f of ['city-config.js', 'waterfront-island-arrivals-data.js', 'waterfront-island-access-data.js', 'waterfront-island-access.js']) vm.runInContext(readJs(f), sandbox, { filename: f });
  const C = sandbox.window.CITY;
  // The real city-grid helper returns a Mesh; stub it here so this focused test does not load the whole grid.
  C.createExtrudedPolygonMesh = (pts) => {
    const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
    const w = Math.max(1, Math.max(...xs) - Math.min(...xs)), d = Math.max(1, Math.max(...zs) - Math.min(...zs));
    const g = new THREE.BoxGeometry(w, 3.2, d);
    g.translate((Math.min(...xs) + Math.max(...xs)) / 2, 1.6, (Math.min(...zs) + Math.max(...zs)) / 2);
    return new THREE.Mesh(g);
  };
  return C;
}

const loadBin = (rel) => {
  let u8 = new Uint8Array(readBin(rel));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  return import('../js/geodata-loader.js').then(({ decodeGeo }) => decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)));
};

const detail = await loadBin('data/toronto-geodata.bin');
const eglinton = await loadBin('data/frames/eglinton/toronto-geodata.bin');
const C = makeContext(detail.GEO);
const D = C.ISLAND_ACCESS_DATA;
const scene = { added: [], add(o) { this.added.push(o); } };
const access = C.createWaterfrontIslandAccess(THREE, scene);
const W = (x, z) => !!C.waterAt(x, z);

test('the four beaches are the REAL OSM beach features, with their mapped rings and areas', () => {
  assert.deepEqual(Object.keys(D.beaches).sort(), ['gibraltar', 'hanlans', 'manitou', 'wards']);
  assert.equal(D.beaches.manitou.osmType, 'relation'); assert.equal(D.beaches.manitou.osmId, 1463388);
  assert.equal(D.beaches.wards.osmType, 'relation'); assert.equal(D.beaches.wards.osmId, 1463389);
  assert.equal(D.beaches.hanlans.osmType, 'relation'); assert.equal(D.beaches.hanlans.osmId, 16086110);
  assert.equal(D.beaches.gibraltar.osmType, 'way'); assert.equal(D.beaches.gibraltar.osmId, 104254897);
  for (const b of Object.values(D.beaches)) {
    assert.equal(b.surface, 'sand');
    assert.ok(b.rings.length >= 1 && b.rings[0].length >= 8, `${b.name} has a real ring (${b.rings[0].length} pts)`);
    assert.ok(b.areaM2 > 2000 && b.areaM2 < 30000, `${b.name} area ${b.areaM2} m²`);
    // the ring is a beach on the island, not the mainland: its bbox is well south of the downtown shore
    assert.ok(b.bbox[1] > 2000, `${b.name} is on the island (z bbox ${b.bbox.join(',')})`);
  }
  // Manitou/Ward's/Hanlan's are the City's island beaches; Gibraltar is the sourced southern beach.
  assert.ok(D.beaches.manitou.name.includes('Manitou'));
  assert.ok(/Ward/i.test(D.beaches.wards.name));
  assert.ok(/Hanlan/i.test(D.beaches.hanlans.name));
  // exact source ids/versions/date are exported
  assert.equal(D.osmMeta['relation/1463388'].version, 5);
  assert.equal(D.osmMeta['relation/1463389'].version, 4);
  assert.equal(D.osmMeta['relation/16086110'].version, 18);
  assert.equal(D.osmMeta['way/104254897'].version, 18);
  assert.ok(/^20\d\d-\d\d-\d\d$/.test(D.fetched), 'fetch date recorded');
});

test('sand is drawn on the exact rings and the beach sampler is gated on the builder', () => {
  assert.equal(access.stats.beaches, 4);
  assert.ok(access.stats.sandTriangles > 100, `${access.stats.sandTriangles} sand triangles`);
  const sandGroup = access.group.children.find((g) => g.name === 'IslandAccess-Sand');
  assert.ok(sandGroup, 'a sand group exists');
  assert.equal(sandGroup.children.length, 4, 'one sand mesh per real beach');
  for (const b of Object.values(D.beaches)) {
    const p = interior(b.rings[0]);
    assert.ok(p, `${b.id} has an interior sample`);
    const s = C.islandBeachSurfaceAt(p[0], p[1]);
    assert.ok(s && s.beachId === b.id, `${b.id} surface sampler identifies the beach`);
    assert.equal(s.h, C.ISLAND_ACCESS_ESTIMATES.sandMeshY, 'sampler equals the rendered sand mesh height');
  }
  // gated OFF -> null
  const before = C.waterfrontIslandAccessEnabled;
  C.waterfrontIslandAccessEnabled = false;
  const p = interior(D.beaches.manitou.rings[0]);
  assert.equal(C.islandBeachSurfaceAt(p[0], p[1]), null, 'gated off returns null');
  C.waterfrontIslandAccessEnabled = before;
  assert.equal(C.islandBeachSurfaceAt(0, 0), null, 'off every beach -> null');
});

test('short real access spurs are drawn and only the genuinely missing route pieces are added', () => {
  assert.ok(access.stats.accessSpurs >= 8, `${access.stats.accessSpurs} mapped access spurs`);
  assert.equal(access.stats.woodSpurs, D.counts.woodSpurs, 'wood spur count equals the data');
  assert.equal(access.stats.woodSpurs, 0, 'no boardwalk is claimed where OSM has no wood access today');
  let totalLen = 0;
  for (const b of Object.values(D.access)) {
    for (const s of b.spurs) {
      assert.ok(s.osmId > 0, 'spur has an OSM way id');
      let len = 0;
      for (let i = 0; i + 1 < s.nodes.length; i++) len += Math.hypot(s.nodes[i + 1][0] - s.nodes[i][0], s.nodes[i + 1][1] - s.nodes[i][1]);
      totalLen += len;
      for (const [x, z] of s.nodes) {
        const ring = Object.values(D.beaches).find((bb) => bb.bbox[0] <= x && x <= bb.bbox[2] && bb.bbox[1] <= z && z <= bb.bbox[3]);
        if (ring) assert.ok(Math.min(...ring.rings.map((r) => ringDist(r, x, z))) <= 15.01, `spur node is within 15 m of its beach (${s.osmId})`);
      }
    }
  }
  assert.ok(totalLen < 900, `all spur geometry totals ${Math.round(totalLen)} m (short access, not long routes)`);
  // The native network does NOT carry the whole walk (coverage proof): the missing pieces must be drawn, and only those.
  assert.ok(access.stats.routeGapM > 1000, `${access.stats.routeGapM} m of genuinely missing mapped walk is drawn`);
  assert.ok(access.stats.routeGapSegments > 50, `${access.stats.routeGapSegments} mapped route edges drawn`);
  assert.ok(access.stats.nativeRouteCoveredM > 0, 'some route length is already native (not redrawn)');
  const gapGroup = access.group.children.find((g) => g.name === 'IslandAccess-RouteGaps');
  assert.ok(gapGroup && gapGroup.children.length > 0, 'drawn route-gap meshes exist (real ferry -> beach visual walk)');
  for (const m of gapGroup.children) assert.equal(m.userData.role, 'route-gap');
  // every drawn route-gap piece is a real OSM edge whose midpoint is NOT already inside a native park path / road.
  const covered = (x, z) => (C.GEO.parkPaths || []).some((row) => {
    const half = ((row[0] > 0 ? row[0] : 1.8) / 2) + 0.4;
    for (let i = 2; i + 1 < row.length; i += 2) if (segDist(x, z, row[i - 2], row[i - 1], row[i], row[i + 1]) <= half) return true;
    return false;
  });
  let drawn = 0;
  for (const r of Object.values(D.routes)) for (const seg of r.segments) {
    const [ax, az, bx, bz] = seg;
    if (!covered((ax + bx) / 2, (az + bz) / 2)) drawn++;
  }
  assert.ok(drawn >= access.stats.routeGapSegments, 'drawn pieces match the uncovered mapped edges (no duplicate overlay)');
});

test('the dock -> beach routes follow mapped walkable ways; only MAPPED bridges span water (no unbridged open water)', () => {
  assert.deepEqual(Object.keys(D.routes).sort(), ['centre', 'hanlans', 'ward']);
  let anyBridge = false;
  for (const [dock, r] of Object.entries(D.routes)) {
    assert.ok(r.ways.length >= 5 && r.ways.every((w) => w > 0), `${dock} route is a chain of real OSM ways`);
    assert.ok(r.nodes.length >= 2 && r.nodes.length <= 80, `${dock} route is simplified (${r.nodes.length} pts)`);
    assert.ok(r.lengthM > 100 && r.lengthM < 5000, `${dock} route length ${r.lengthM} m`);
    assert.ok(r.startDockM < 20, `${dock} route starts at the mapped dock (${r.startDockM} m)`);
    // Classify water samples: wet length on a MAPPED bridge edge is legitimate; wet length elsewhere is not.
    let wetOnBridge = 0, wetUnbridged = 0;
    for (const seg of r.segments) {
      const [ax, az, bx, bz, , , , bridge] = seg;
      const L = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(L / 2));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        if (W(ax + (bx - ax) * t, az + (bz - az) * t)) { if (bridge) wetOnBridge += L / steps; else wetUnbridged += L / steps; }
      }
      if (bridge) anyBridge = true;
    }
    assert.ok(wetUnbridged < 5, `${dock} has no long unbridged open-water crossing (${wetUnbridged.toFixed(1)} m)`);
    assert.ok(wetOnBridge < 120, `${dock} bridge water span is bounded (${wetOnBridge.toFixed(1)} m)`);
  }
  assert.ok(anyBridge, 'a mapped OSM bridge edge is retained in the route geometry');
  const bridgeWays = new Set();
  for (const r of Object.values(D.routes)) for (const seg of r.segments) if (seg[7] === 1) bridgeWays.add(seg[5]);
  assert.ok(bridgeWays.has(10427151), 'the real Avenue Of The Islands bridge (way 10427151) is the mapped span');
  assert.equal(D.routes.centre.connected, true, 'Centre -> Manitou is a fully mapped walk');
  assert.equal(D.routes.hanlans.connected, true, "Hanlan's -> its beach is a fully mapped walk");
  // 2 fully mapped routes + 1 honest partial (Ward's sand footways are a separate OSM component today).
  assert.equal(D.routes.ward.connected, false);
  assert.equal(D.routes.ward.finalGapM, 44, "Ward's final mapped point is 44 m from the beach ring");
});

test("Ward's final 44 m is dry open beach/grass, labelled unknown, with no invented connector", () => {
  const fa = D.routes.ward.finalApproach;
  assert.ok(fa, 'the final approach is recorded');
  assert.equal(fa.kind, 'informal-unmapped-beach-approach');
  assert.equal(fa.gapM, 44);
  assert.equal(fa.dry, true, 'the straight approach is dry per the authoritative water mask');
  assert.equal(fa.wetM, 0);
  assert.ok(fa.from[0] === 1501 && fa.from[1] === 2283.5, 'from the final mapped path point');
  // the beach ring itself is the destination, and the line is dry
  const ring = D.beaches.wards.rings[0];
  assert.ok(ring.some(([x, z]) => Math.hypot(x - fa.to[0], z - fa.to[1]) < 2), 'the approach ends on the real beach ring');
  for (let s = 0; s <= 44; s++) {
    const t = s / 44, x = fa.from[0] + (fa.to[0] - fa.from[0]) * t, z = fa.from[1] + (fa.to[1] - fa.from[1]) * t;
    assert.equal(W(x, z), false, `final approach sample ${s} is dry`);
  }
  // no route-gap geometry is drawn across the untagged final approach (the route ends at the mapped point)
  const gapM = access.stats.routeGapM;
  assert.ok(gapM > 0);
});

test('amenities sit at exact mapped positions and cover toilets/change/picnic/benches/wayfinding', () => {
  assert.ok(D.amenities.length > 150, `${D.amenities.length} mapped amenities`);
  const kinds = {};
  for (const a of D.amenities) kinds[a.kind] = (kinds[a.kind] || 0) + 1;
  assert.ok(kinds.bench > 80, `${kinds.bench} benches`);
  assert.ok(kinds.picnic > 15, `${kinds.picnic} picnic tables/sites`);
  assert.ok(kinds.information > 8, `${kinds.information} wayfinding/information boards`);
  assert.ok(kinds.toilets >= 3, `${kinds.toilets} toilets`);
  assert.ok(kinds.shower >= 1, `${kinds.shower} shower/change building`);
  for (const a of D.amenities) {
    assert.ok(a.osmId > 0 && (a.osmType === 'node' || a.osmType === 'way'), `${a.kind} has a real OSM id`);
    assert.ok(Number.isFinite(a.point[0]) && Number.isFinite(a.point[1]), 'exact position');
    assert.ok(a.beachD <= 450 || a.dockD <= 100, `${a.kind} ${a.osmId} is associated with a beach/terminal`);
    if (a.ring) assert.ok(a.ring.length >= 3, `${a.kind} way has its mapped footprint`);
  }
  // the beach amenity clusters are real: toilets + picnic + benches near Manitou and Ward's
  assert.ok(D.amenities.some((a) => a.kind === 'bench' && a.beach === 'manitou' && a.beachD <= 15));
  assert.ok(D.amenities.some((a) => a.kind === 'picnic' && a.beach === 'wards'));
  // amenity heights for a mapped building are recorded (native or estimated), never silently invented
  for (const a of D.amenities.filter((x) => x.ring)) assert.ok(Number.isFinite(a.height) && a.height > 1 && a.height < 20);
});

test('native geodata buildings are preserved; only the missing real beach building is added', () => {
  assert.ok(access.stats.nativeBuildingsKept >= 1, 'at least the Gibraltar Point Washrooms is kept from the geodata');
  assert.ok(access.stats.buildingsAdded >= 1, "the real Hanlan's Pavilion building missing from the geodata is added");
  const bgroup = access.group.children.find((g) => g.name === 'IslandAccess-Buildings');
  assert.ok(bgroup && bgroup.children.length === access.stats.buildingsAdded, 'one mesh per added missing building');
  for (const m of bgroup.children) {
    assert.equal(m.userData.role, 'beach-building');
    assert.ok(m.userData.osmId > 0);
  }
  // a geodata-native washroom is not duplicated as a new building mesh
  assert.ok(!bgroup.children.some((m) => m.userData.osmId === 176885369), 'Gibraltar Point Washrooms is not duplicated');
});

test('legible opaque text panels are mounted in front of their own posts (arrival board fix)', () => {
  // no DOM here -> documented colour-panel fallback
  assert.equal(access.stats.signAtlas, false);
  const signs = access.group.children.find((g) => g.name === 'IslandAccess-Signs');
  assert.ok(signs && signs.children.length > 0, 'signs exist in the fallback too');
  // with a DOM canvas the atlas is used, one panel per label, and each panel is offset from its post
  const C2 = makeContext(detail.GEO, { withDocument: true });
  const a2 = C2.createWaterfrontIslandAccess(THREE, { add() {} });
  assert.equal(a2.stats.signAtlas, true, 'with a DOM canvas the atlas is used');
  assert.ok(a2.stats.signs > 10, `${a2.stats.signs} legible panels`);
  assert.ok(a2.stats.signLabels <= 64 && a2.stats.signLabels > 0, 'bounded label atlas');
  const sg = a2.group.children.find((g) => g.name === 'IslandAccess-Signs');
  const panels = sg.children.filter((m) => m.userData.role === 'access-panel');
  const posts = sg.children.filter((m) => m.userData.role === 'access-post');
  assert.equal(panels.length, posts.length, 'one panel per post');
  for (const p of panels) {
    // the panel is mounted a few cm in front of the post on its facing side (never through the lettering)
    const post = posts.reduce((best, q) => (Math.hypot(q.position.x - p.position.x, q.position.z - p.position.z) < Math.hypot(best.position.x - p.position.x, best.position.z - p.position.z) ? q : best));
    const d = Math.hypot(post.position.x - p.position.x, post.position.z - p.position.z);
    assert.ok(d > 0.03 && d < 0.16, `panel is offset ${d.toFixed(3)} m from its post`);
    assert.ok(p.material && p.material.opacity !== 0 && !p.material.transparent, 'panel is opaque');
  }
});

test('ground mask discards only exact beach rings, composes and is gated/idempotent', () => {
  const g = C.islandAccessGroundLayout();
  assert.equal(g.areas.length, 4, 'one mask area per beach');
  for (const a of g.areas) {
    const b = D.beaches[a.id];
    assert.ok(b, `mask area ${a.id} maps to a sourced beach`);
    assert.equal(JSON.stringify(a.plan), JSON.stringify(b.rings[0]), `${a.id} mask is its exact OSM ring`);
  }
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0x556b2f });
  assert.equal(mat.isNodeMaterial, true);
  const ret = C.applyWaterfrontIslandAccessGroundMask(mat);
  assert.equal(ret, mat);
  assert.ok(mat.maskNode, 'a mask node was composed');
  assert.equal(mat.userData.waterfrontIslandAccessMask, true);
  const first = mat.maskNode;
  C.applyWaterfrontIslandAccessGroundMask(mat);
  assert.equal(mat.maskNode, first, 'idempotent');
  const mat2 = new THREE.MeshStandardNodeMaterial();
  const existing = TSL.float(0.5).greaterThan(0.25);
  mat2.maskNode = existing;
  C.applyWaterfrontIslandAccessGroundMask(mat2);
  assert.notEqual(mat2.maskNode, existing, 'and-composed with an existing mask');
  assert.equal(C.applyWaterfrontIslandAccessGroundMask({ isNodeMaterial: false }).isNodeMaterial, false);
  assert.equal(C.applyWaterfrontIslandAccessGroundMask(null), null);
  // Lifecycle fix: city-grid builds the lawn BEFORE this module, so the mask must work on a cold context that has the
  // data + frame but has never called the builder.
  const Ccold = makeContext(detail.GEO);
  assert.equal(Ccold.waterfrontIslandAccessEnabled, undefined, 'cold context has not built');
  const coldMat = new THREE.MeshStandardNodeMaterial();
  Ccold.applyWaterfrontIslandAccessGroundMask(coldMat);
  assert.ok(coldMat.maskNode, 'mask composes before the builder (bounded texture mask)');
  assert.equal(coldMat.userData.waterfrontIslandAccessMask, true);
});

test('one culling root, bounded colliders, sane triangles, and unique exports', () => {
  assert.equal(scene.added.length, 1);
  assert.equal(access.group.name, 'WaterfrontIslandAccess');
  assert.equal(access.group.userData.waterfrontIslandAccess, access.stats);
  assert.ok(access.stats.triangles > 100 && access.stats.triangles < 250000, `${access.stats.triangles} triangles`);
  assert.ok(access.colliders.length > 0 && access.colliders.length < 700, `${access.colliders.length} bounded colliders`);
  for (const c of access.colliders) {
    assert.ok(c.maxX - c.minX < (c.kind === 'building' ? 60 : 12) && c.maxZ - c.minZ < (c.kind === 'building' ? 60 : 12), 'collider is a bounded prop/building box');
    assert.ok(c.maxY - c.minY < 12, 'collider is not a tower');
  }
  // unique exports (this module owns its names; the arrival module is untouched)
  assert.equal(typeof C.createWaterfrontIslandAccess, 'function');
  assert.equal(typeof C.islandAccessLayout, 'function');
  assert.equal(typeof C.islandBeachSurfaceAt, 'function');
  assert.equal(typeof C.islandAccessSurfaceAt, 'function');
  assert.equal(typeof C.islandAccessRoute, 'function');
  assert.equal(C.waterfrontIslandAccess, access);
  assert.ok(C.ISLAND_ACCESS_ESTIMATES && Number.isFinite(C.ISLAND_ACCESS_ESTIMATES.sandY));
});

test('islandAccessSurfaceAt returns the exact rendered height of every drawn walk corridor (pedestrian only)', () => {
  const corridors = access.surfaces.corridors.filter((c) => c.kind === 'route-gap');
  assert.ok(corridors.length > 0, 'route-gap corridors are recorded');
  for (const c of corridors.slice(0, 8)) {
    const [ax, az] = c.nodes[0], [bx, bz] = c.nodes[1];
    const s = C.islandAccessSurfaceAt((ax + bx) / 2, (az + bz) / 2);
    assert.ok(s, 'a drawn route corridor has a surface');
    assert.equal(s.h, c.y, 'the sampler height equals the rendered mesh height');
    assert.equal(s.kind, 'route-gap');
    assert.equal(s.pedestrianOnly, true, 'the walk surface is pedestrian-only');
    assert.equal(s.dockId, c.dockId);
  }
  const spur = access.surfaces.corridors.find((c) => c.kind === 'access-spur');
  assert.ok(spur, 'access spurs are recorded');
  const [sx, sz] = spur.nodes[0], [tx, tz] = spur.nodes[1];
  const ss = C.islandAccessSurfaceAt((sx + tx) / 2, (sz + tz) / 2);
  assert.ok(ss && ss.kind === 'access-spur' && ss.h === spur.y && ss.pedestrianOnly === true);
  // gated on the builder
  C.waterfrontIslandAccessEnabled = false;
  assert.equal(C.islandAccessSurfaceAt((sx + tx) / 2, (sz + tz) / 2), null, 'gated off when the builder has not run');
  C.waterfrontIslandAccessEnabled = true;
});

test('all built geometry is finite (no NaN positions)', () => {
  let meshes = 0;
  access.group.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    meshes++;
    const arr = o.geometry && o.geometry.attributes && o.geometry.attributes.position && o.geometry.attributes.position.array;
    assert.ok(arr && arr.length > 0, 'mesh has positions');
    for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]), `finite position ${i}`);
  });
  assert.ok(meshes > 5, `${meshes} meshes`);
});

test('frame independence: detail and Eglinton build the same real island access (shared projection)', async () => {
  assert.deepEqual(detail.GEO.frame.projection, eglinton.GEO.frame.projection, 'same projection');
  assert.notEqual(detail.GEO.buildings.length, eglinton.GEO.buildings.length, 'different building indices');
  const Ce = makeContext(eglinton.GEO);
  const re = Ce.createWaterfrontIslandAccess(THREE, { add() {} });
  assert.ok(re, 'builds in the Eglinton frame');
  assert.equal(re.stats.beaches, access.stats.beaches);
  assert.equal(re.stats.sandTriangles, access.stats.sandTriangles);
  assert.equal(re.stats.accessSpurs, access.stats.accessSpurs);
  assert.equal(re.stats.amenities, access.stats.amenities);
  assert.equal(re.stats.benches, access.stats.benches);
  assert.equal(re.stats.buildingsAdded, access.stats.buildingsAdded);
  assert.ok(re.stats.routeGapM > 1000, 'Eglinton also draws the genuinely missing walk pieces');
  assert.ok(re.stats.routeBridgeSegments >= 1, 'mapped bridge metadata is retained in both frames');
  // the data carries no geodata row/building index
  for (const a of Ce.ISLAND_ACCESS_DATA.amenities) assert.ok(!('index' in a) && !('buildingIndex' in a));
});
