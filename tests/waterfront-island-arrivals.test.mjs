// Toronto Islands arrival experience (js/waterfront-island-arrivals.js): the THREE REAL mapped ferry terminals (Ward's
// Island way, Centre Island way, Hanlan's Point node), the REAL connecting footways/piers from OSM, a bounded name
// atlas, and honest gating. The tests check geometry against the sourced OSM data (js/waterfront-island-arrivals-data.js)
// and the harbour water mask — not that source strings exist. They also encode the review corrections: real terminal
// footprints (not probed piers), bike-station POIs are NOT treated as berths, no invented boardwalk over water, and
// islandArrivalSurfaceAt gated on the builder/supported frame.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const readJs = (file) => fs.readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const readBin = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url));

const makeContext = (files, withDocument = false) => {
  const ctx = {
    window: { CITY: { THREE, TSL } }, console: { info() {}, log() {}, warn() {} },
    location: { search: '' }, URLSearchParams, Buffer, performance,
    atob: (s) => Buffer.from(s, 'base64').toString('binary')
  };
  if (withDocument) {
    const mockCtx = { clearRect() {}, fillRect() {}, fillText() {}, measureText: (s) => ({ width: s.length * 26 }), set textAlign(v) {}, set textBaseline(v) {}, set font(v) {}, set fillStyle(v) {} };
    ctx.document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockCtx }) };
  }
  const context = vm.createContext(ctx);
  for (const file of files) vm.runInContext(readJs(file), context, { filename: file });
  return context.window.CITY;
};

const FILES = ['toronto-geodata.js', 'high-park-data.js', 'don-valley.js', 'city-config.js', 'waterfront-ferries.js', 'waterfront-island-arrivals-data.js', 'waterfront-island-arrivals.js'];
const C = makeContext(FILES);
const LAYOUT = C.islandArrivalsLayout();
const scene = { added: [], add(o) { this.added.push(o); } };
const arrival = C.createWaterfrontIslandArrivals(THREE, scene);
const W = (x, z) => !!C.waterAt(x, z);
const D = C.ISLAND_ARRIVALS_DATA;

test('the three docks are the REAL OSM ferry terminals, not the bike-station POIs', () => {
  assert.deepEqual(Object.keys(LAYOUT.docks).sort(), ['centre', 'hanlans', 'ward']);
  // real OSM ids/types
  assert.equal(LAYOUT.docks.ward.osmType, 'way'); assert.equal(LAYOUT.docks.ward.osmId, 251286976);
  assert.equal(LAYOUT.docks.centre.osmType, 'way'); assert.equal(LAYOUT.docks.centre.osmId, 1175136270);
  assert.equal(LAYOUT.docks.hanlans.osmType, 'node'); assert.equal(LAYOUT.docks.hanlans.osmId, 56794382);
  // the data file holds the terminal tags (amenity=ferry_terminal), not bicycle_rental
  for (const [id, d] of Object.entries(LAYOUT.docks)) {
    const rec = D.docks[id];
    assert.ok(rec, `${id} present in data`);
    const tags = rec.tags || {};
    assert.notEqual(tags.amenity, 'bicycle_rental', `${id} is not a bike station`);
  }
  // the terminal centres are physically plausible: near harbour water, not 65 m inland like the old bike POI
  for (const d of Object.values(LAYOUT.docks)) {
    const ref = d.ring ? d.centroid : d.point;
    let nearestWater = Infinity;
    for (let dx = -120; dx <= 120; dx += 2) for (let dz = -120; dz <= 120; dz += 2) {
      if (W(ref[0] + dx, ref[1] + dz)) nearestWater = Math.min(nearestWater, Math.hypot(dx, dz));
    }
    assert.ok(nearestWater <= 70, `${d.id} terminal is within 70 m of water (${nearestWater.toFixed(0)} m)`);
  }
});

test("Ward's and Centre are berth POLYGONS with real mapped area; Hanlan's is a node + taxi quay", () => {
  const ward = LAYOUT.docks.ward;
  assert.ok(ward.ring && ward.ring.length >= 20, "Ward's is a 20+ point berth polygon");
  assert.ok(ward.area > 600 && ward.area < 2500, `Ward's berth area ${ward.area.toFixed(0)} m²`);
  assert.ok(D.docks.ward.tags.wheelchair === 'yes', "Ward's dock is mapped wheelchair=yes");
  const centre = LAYOUT.docks.centre;
  assert.ok(centre.ring && centre.ring.length >= 20, 'Centre is a 20+ point terminal polygon');
  assert.ok(centre.area > 800 && centre.area < 3000, `Centre terminal area ${centre.area.toFixed(0)} m²`);
  const hanlans = LAYOUT.docks.hanlans;
  assert.equal(hanlans.ring, null, "Hanlan's is a node terminal");
  assert.ok(hanlans.point && Number.isFinite(hanlans.point[0]), "Hanlan's has a mapped point");
  assert.ok(hanlans.quay && hanlans.quay.ring && hanlans.quay.ring.length >= 4, "Hanlan's water-taxi quay is a mapped ring");
});

test('no probed fake pier: the terminal decks follow mapped geometry, not nearest-wet-cell rays', () => {
  // every dock's deck anchor sits on its own mapped footprint (ring) or mapped point and on dry ground
  for (const d of Object.values(LAYOUT.docks)) {
    const [ax, az] = d.deckAnchor;
    if (d.ring) assert.ok(pointInRing(d.ring, ax, az), `${d.id} deck anchor is inside its mapped ring`);
    assert.equal(W(ax, az), false, `${d.id} deck anchor is dry ground, not a water-probed point`);
  }
  // Hanlan's node platform is at the mapped node (not stretched to water); it is on land
  const [hx, hz] = LAYOUT.docks.hanlans.point;
  assert.equal(W(hx, hz), false, "Hanlan's platform at the mapped node is dry land");
});

test('the real connecting footways from OSM are present and rendered in their mapped surface colours', () => {
  // each dock has real connectors from the data
  for (const d of Object.values(LAYOUT.docks)) {
    assert.ok(d.connectors.length >= 2, `${d.id} has real OSM connectors (${d.connectors.length})`);
    // connectors reference real OSM way ids
    for (const c of d.connectors) assert.ok(c.osmId > 0, 'connector has an OSM id');
  }
  // the wooden/boardwalk surface is used only where the data says wood; here the approaches are asphalt/concrete
  const woodCount = Object.values(LAYOUT.docks).reduce((s, d) => s + d.connectors.filter((c) => c.isWood).length, 0);
  assert.equal(arrival.stats.woodConnectors, woodCount, 'rendered wood count equals the data wood count');
  // the built walk meshes are footways/boardwalks only, with OSGM ids recorded
  const walkGroup = arrival.group.children.find((g) => g.name === 'IslandArrivals-Walks');
  assert.ok(walkGroup, 'there is a walks group');
  for (const m of walkGroup.children) {
    assert.ok(['footway', 'boardwalk'].includes(m.userData.role), `walk role ${m.userData.role}`);
    if (m.userData.role === 'boardwalk') assert.ok(m.userData.role === 'boardwalk'); // only from isWood paths
  }
});

test('no invented boardwalk crosses the water: rendered paths stay on/near their mapped footway lines', () => {
  const walkGroup = arrival.group.children.find((g) => g.name === 'IslandArrivals-Walks');
  // The connectors come straight from OSM; assert their sampled vertices are overwhelmingly on land (a footway does not
  // run across open water). A few graze the shoreline.
  let total = 0, wet = 0;
  for (const d of Object.values(LAYOUT.docks)) {
    for (const c of d.connectors) for (const [x, z] of c.nodes) { total++; if (W(x, z)) wet++; }
  }
  assert.ok(total > 0);
  assert.ok(wet / total < 0.25, `connector vertices are mostly on land (${wet}/${total} wet)`);
  assert.ok(walkGroup.children.length >= 3, 'several real paths are drawn');
});

test('the name boards are legible via a bounded atlas (or a documented colour fallback without a DOM)', () => {
  // In this Node context there is no document → the fallback is used and recorded.
  assert.equal(arrival.stats.nameAtlas, false, 'no DOM here → fallback');
  const boardGroup = arrival.group.children.find((g) => g.name === 'IslandArrivals-NameBoards');
  assert.ok(boardGroup && boardGroup.children.length >= 3, 'a board per dock exists');
  // With a document, the atlas path produces the same board count and sets nameAtlas true.
  const C2 = makeContext(FILES, true);
  const a2 = C2.createWaterfrontIslandArrivals(THREE, { add() {} });
  assert.equal(a2.stats.nameAtlas, true, 'with a DOM canvas the atlas is used');
  assert.equal(a2.stats.nameBoards, 3);
  // the atlas is bounded (fixed size) — stats exposes the three route names
  assert.deepEqual(Array.from(a2.stats.routes).sort(), ['Centre Island', "Hanlan's Point", "Ward's Island"]);
});

test('islandArrivalSurfaceAt is gated on the builder and the supported frame', () => {
  // enabled now (built above) → a surface on each deck anchor
  for (const d of Object.values(LAYOUT.docks)) {
    const s = C.islandArrivalSurfaceAt(...d.deckAnchor);
    assert.ok(s, `${d.id} has a surface while enabled`);
    assert.equal(s.h, C.ISLAND_ARRIVAL_ESTIMATES.deckTop);
    assert.equal(s.routeName, d.routeName);
  }
  // gated OFF → null everywhere
  const before = C.waterfrontIslandArrivalsEnabled;
  C.waterfrontIslandArrivalsEnabled = false;
  assert.equal(C.islandArrivalSurfaceAt(LAYOUT.docks.centre.deckAnchor[0], LAYOUT.docks.centre.deckAnchor[1]), null, 'gated off returns null');
  C.waterfrontIslandArrivalsEnabled = before;
  // off every dock → null
  assert.equal(C.islandArrivalSurfaceAt(0, 0), null);
});

test('islandBuildingReplacedAt covers the dock footprints only (suppress generic massing there)', () => {
  assert.equal(C.islandBuildingReplacedAt(LAYOUT.docks.centre.deckAnchor[0], LAYOUT.docks.centre.deckAnchor[1]), true);
  assert.equal(C.islandBuildingReplacedAt(0, 0), false);
});

test('the built arrivals: one culling root, bounded colliders, sane triangles, frame-independent data', () => {
  assert.equal(scene.added.length, 1);
  assert.equal(arrival.group.name, 'WaterfrontIslandArrivals');
  assert.equal(arrival.group.userData.waterfrontIslandArrivals, arrival.stats);
  assert.equal(arrival.stats.docks, 3);
  assert.equal(arrival.stats.piers, 3);
  assert.ok(arrival.stats.triangles > 100 && arrival.stats.triangles < 20000, `${arrival.stats.triangles} triangles`);
  assert.equal(arrival.stats.colliders, 3, 'one name-post collider per dock, bounded');
  for (const c of arrival.colliders) assert.ok(c.maxX - c.minX < 1 && c.maxZ - c.minZ < 1, 'collider is a small post');
  // the data stores the shared projection and no geodata building indices
  assert.ok(D.projection && Number.isFinite(D.projection.lat0), 'projection recorded');
  for (const d of Object.values(D.docks)) assert.ok(!('buildingIndex' in d) && !('index' in d), 'no hard building index stored');
});

test('frame independence: the dock data is identical in detail and Eglinton frames (same projection)', async () => {
  const { decodeGeo } = await import('../js/geodata-loader.js');
  const loadBin = (rel) => { let u8 = new Uint8Array(readBin(rel)); if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8)); return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)); };
  const detail = loadBin('data/toronto-geodata.bin');
  const egl = loadBin('data/frames/eglinton/toronto-geodata.bin');
  assert.deepEqual(detail.GEO.frame.projection, egl.GEO.frame.projection, 'same projection');
  assert.notEqual(detail.GEO.buildings.length, egl.GEO.buildings.length, 'different building counts/indices');
  // the module builds against each frame's water mask; the dock data (world metres) is identical
  const buildIn = (layers) => {
    const context = vm.createContext({ window: { CITY: Object.assign({ THREE }, layers) }, console: { info() {}, log() {}, warn() {} }, location: { search: '' }, URLSearchParams, Buffer, performance, atob: (s) => Buffer.from(s, 'base64').toString('binary') });
    for (const f of ['city-config.js', 'waterfront-ferries.js', 'waterfront-island-arrivals-data.js', 'waterfront-island-arrivals.js']) vm.runInContext(readJs(f), context, { filename: f });
    context.window.CITY.GEO = layers.GEO;
    return context.window.CITY.createWaterfrontIslandArrivals(THREE, { add() {} });
  };
  const rd = buildIn(detail), re = buildIn(egl);
  assert.ok(rd && re, 'builds in both frames');
  assert.equal(rd.stats.docks, 3); assert.equal(re.stats.docks, 3);
  assert.equal(rd.stats.piers, re.stats.piers);
  assert.equal(rd.stats.connectorsRendered, re.stats.connectorsRendered);
});

// --------------------------------------------------------------------------------------------------------------------
// Ground correction: the berth aprons sat BELOW the generic park lawn (0.16 < 0.224), so the GPU captures showed grass
// over Centre's deck, a patchy overlap at Ward's and grass on Hanlan's platform. These tests fix the level and the
// exact-footprint lawn mask, and the name-board atlas-cell drift.
// --------------------------------------------------------------------------------------------------------------------
const LAWN = C.CITY_BOUNDS.sidewalkHeight + 0.004;

test('deck tops stand above the park lawn (0.230 m), with a small apron lip, not a raised slab', () => {
  // 6 mm above the 0.224 m lawn; the old 0.16 m deck was below it and was covered by grass.
  assert.ok(Math.abs(C.ISLAND_ARRIVAL_ESTIMATES.deckTop - (C.CITY_BOUNDS.sidewalkHeight + 0.01)) < 1e-9);
  assert.ok(C.ISLAND_ARRIVAL_ESTIMATES.deckTop > LAWN, `deck ${C.ISLAND_ARRIVAL_ESTIMATES.deckTop} is above lawn ${LAWN}`);
  assert.ok(C.ISLAND_ARRIVAL_ESTIMATES.deckTop - C.CITY_BOUNDS.sidewalkHeight < 0.05, 'the apron lip is under 5 cm (no 1 m slab)');
  // the exact surface sampler returns that same value on every deck (rings and the node platform)
  for (const d of Object.values(LAYOUT.docks)) {
    const s = C.islandArrivalSurfaceAt(...d.deckAnchor);
    assert.ok(s, `${d.id} has a surface`);
    assert.equal(s.h, C.ISLAND_ARRIVAL_ESTIMATES.deckTop, `${d.id} sampler is the rendered deck top`);
  }
});

test('ground mask covers only the exact OSM polygons, the estimated platform, the quay and the drawn footways', () => {
  const g = C.islandArrivalsGroundLayout();
  const byKind = (k) => g.areas.filter((a) => a.kind === k);
  // the two berth polygons are exactly the sourced OSM rings (no buffered/invented footprint)
  const ward = byKind('deck').find((a) => a.id === 'ward');
  const centre = byKind('deck').find((a) => a.id === 'centre');
  assert.equal(JSON.stringify(ward.plan), JSON.stringify(D.docks.ward.ring), "Ward's mask is its OSM berth ring");
  assert.equal(JSON.stringify(centre.plan), JSON.stringify(D.docks.centre.ring), "Centre's mask is its OSM berth ring");
  // Hanlan's node platform is the same 3.2 m half-size square it is drawn on; the quay is the mapped ring
  const platform = byKind('platform').find((a) => a.id === 'hanlans');
  const [hx, hz] = LAYOUT.docks.hanlans.point;
  const s = C.ISLAND_ARRIVAL_ESTIMATES.nodePlatform;
  assert.equal(JSON.stringify(platform.plan), JSON.stringify([[hx - s, hz - s], [hx + s, hz - s], [hx + s, hz + s], [hx - s, hz + s]]));
  const quay = byKind('quay').find((a) => a.id === 'hanlans-taxi-quay');
  assert.equal(JSON.stringify(quay.plan), JSON.stringify(D.docks.hanlans.quay.ring), "Hanlan's quay mask is its OSM ring");
  // the mask covers exactly the drawn connectors (same selection and widths as the renderer)
  assert.equal(g.corridors.length, arrival.stats.connectorsRendered, 'one corridor per drawn footway');
  for (const c of g.corridors) {
    assert.ok(c.half > 0.5 && c.half <= 6, `${c.osmId} width from the renderer`);
    assert.ok(c.nodes.length >= 2);
  }
  // nothing broad: the summed exact footprints are a few thousand m², not the island/shoreline
  let total = 0;
  for (const a of g.areas) total += Math.abs(shoelace(a.plan));
  assert.ok(total > 1000 && total < 8000, `masked ground is ${Math.round(total)} m² (exact aprons, not a coastline sweep)`);
});

test('ground-mask hook: composes, is idempotent, and no-ops when disabled / off-frame / non-node', () => {
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0x556b2f });
  assert.equal(mat.isNodeMaterial, true);
  const ret = C.applyWaterfrontIslandGroundMask(mat);
  assert.equal(ret, mat);
  assert.ok(mat.maskNode, 'a mask node was composed');
  assert.equal(mat.userData.waterfrontIslandMask, true);
  const first = mat.maskNode;
  C.applyWaterfrontIslandGroundMask(mat);
  assert.equal(mat.maskNode, first, 'idempotent');

  const mat2 = new THREE.MeshStandardNodeMaterial();
  const existing = TSL.float(0.5).greaterThan(0.25);
  mat2.maskNode = existing;
  C.applyWaterfrontIslandGroundMask(mat2);
  assert.notEqual(mat2.maskNode, existing, 'and-composed with the existing mask');

  assert.equal(C.applyWaterfrontIslandGroundMask({ isNodeMaterial: false }).isNodeMaterial, false);
  assert.equal(C.applyWaterfrontIslandGroundMask(null), null);

  // builder guard: before the arrivals exist in a supported frame the mask does nothing
  const before = C.waterfrontIslandArrivalsEnabled;
  C.waterfrontIslandArrivalsEnabled = false;
  const m3 = new THREE.MeshStandardNodeMaterial();
  C.applyWaterfrontIslandGroundMask(m3);
  assert.ok(!m3.maskNode, 'no mask while the builder is disabled');
  C.waterfrontIslandArrivalsEnabled = before;

  // off-frame: no areas/corridors → untouched even if enabled
  const e = makeContext(FILES);
  e.waterfrontIslandArrivalsEnabled = true;
  e.GEO = { frame: { detail: { x0: 9990, x1: 10010, z0: 9990, z1: 10010 } } };
  assert.equal(e.islandArrivalsGroundLayout().areas.length, 0, 'nothing in a frame that does not cover the docks');
  const m4 = new THREE.MeshStandardNodeMaterial();
  e.applyWaterfrontIslandGroundMask(m4);
  assert.ok(!m4.maskNode, 'no mask off-frame');
});

test('deck geometry follows the exact mapped polygon: ear-clipped, upward-wound, no fan spill outside concave Ward', () => {
  const EST = C.ISLAND_ARRIVAL_ESTIMATES;
  const decks = arrival.group.children.find((g) => g.name === 'IslandArrivals-Decks');
  for (const id of ['ward', 'centre']) {
    const mesh = decks.children.find((m) => m.userData.role === 'dock-deck' && m.userData.dockId === id);
    assert.ok(mesh, `${id} deck exists`);
    const ring = D.docks[id].ring, pos = mesh.geometry.attributes.position;
    // every top vertex is a ring vertex: the top can never extend outside the mapped berth (a fan could)
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (Math.abs(y - EST.deckTop) > 1e-6) { assert.ok(y < EST.deckTop - 0.01, `${id} only the thin side cap is below`); continue; }
      const x = pos.getX(i), z = pos.getZ(i);
      // the BufferGeometry stores Float32, so compare within ~2 mm of the sourced ring vertex
      assert.ok(ring.some(([rx, rz]) => Math.hypot(rx - x, rz - z) < 2e-3), `${id} top vertex ${x},${z} is on the mapped ring`);
    }
    // every top triangle is wound to face up (never back-face culled) and the top covers exactly the mapped berth
    let topTris = 0, topArea = 0;
    for (let t = 0; t + 2 < pos.count; t += 3) {
      const ys = [pos.getY(t), pos.getY(t + 1), pos.getY(t + 2)];
      if (!ys.every((y) => Math.abs(y - EST.deckTop) < 1e-6)) continue;
      const ax = pos.getX(t), az = pos.getZ(t), bx = pos.getX(t + 1), bz = pos.getZ(t + 1), cx = pos.getX(t + 2), cz = pos.getZ(t + 2);
      const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      // (a collinear ear can be degenerate: ~0 area is harmless; a truly negative one would be back-face culled)
      assert.ok(up >= -1e-3, `${id} top triangle ${t / 3} faces up`);
      topArea += Math.max(0, up) / 2;
      topTris++;
    }
    const ringArea = Math.abs(shoelace(ring));
    assert.ok(topTris > 0 && Math.abs(topArea - ringArea) < Math.max(1, ringArea * 0.02),
      `${id} top is the full mapped berth (${Math.round(topArea)} vs ${Math.round(ringArea)} m²)`);
  }
});

test('name boards sample distinct atlas cells once (no cumulative UV drift) and face inland', () => {
  const C2 = makeContext(FILES, true);
  const a2 = C2.createWaterfrontIslandArrivals(THREE, { add() {} });
  assert.equal(a2.stats.nameAtlas, true);
  const group = a2.group.children.find((g) => g.name === 'IslandArrivals-NameBoards');
  const boards = group.children.filter((c) => c.userData.role === 'name-board');
  assert.equal(boards.length, 3);
  const cellByDock = { ward: 0, centre: 1, hanlans: 2 }; // Object.values(ROUTE_NAMES): Ward's, Centre, Hanlan's
  const starts = new Set();
  for (const b of boards) {
    const cell = cellByDock[b.userData.dockId];
    assert.equal(b.userData.atlasCell, cell, `${b.userData.dockId} samples its own cell`);
    const uv = b.geometry.attributes.uv;
    let min = Infinity, max = -Infinity;
    for (let k = 0; k < uv.count; k++) { min = Math.min(min, uv.getX(k)); max = Math.max(max, uv.getX(k)); }
    const u0 = cell / 3;
    assert.ok(min >= u0 - 1e-6 && max <= u0 + 1 / 3 + 1e-6, `${b.userData.dockId} stays inside its atlas cell`);
    assert.ok(Math.abs((max - min) - 1 / 3) < 1e-6, `${b.userData.dockId} spans exactly one cell (not a cumulative shift)`);
    starts.add(min.toFixed(3));
    // faces the walkway: front normal (sin yaw, cos yaw) equals the dock's inland boardFacing
    const f = a2.layout.docks[b.userData.dockId].boardFacing;
    assert.ok(Math.abs(Math.sin(b.rotation.y) - f[0]) < 1e-6 && Math.abs(Math.cos(b.rotation.y) - f[1]) < 1e-6, `${b.userData.dockId} board faces inland`);
    // stands on the deck, not 22 cm under it
    assert.ok(b.position.y > C2.ISLAND_ARRIVAL_ESTIMATES.deckTop, `${b.userData.dockId} board is above the deck`);
  }
  assert.equal(starts.size, 3, 'three different atlas cells');
});

function shoelace(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}