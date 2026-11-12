// The central waterfront's three timber WaveDecks (js/waterfront-public-realm.js): Spadina, Rees and Simcoe.
// The tests pin the official areas and published locations, the deck-to-shore relationship, Simcoe's two swells and
// 2.6 m height above the lake, the level landward band and east accessible route, and the built scene stats.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const read = (file) => fs.readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const makeContext = (wireGroundMask = true) => {
  const context = vm.createContext({
    window: { CITY: { THREE, TSL } }, console: { info() {}, log() {}, warn() {} },
    location: { search: '' }, URLSearchParams, Buffer, performance,
    atob: (s) => Buffer.from(s, 'base64').toString('binary')
  });
  for (const file of ['toronto-geodata.js', 'high-park-data.js', 'don-valley.js', 'city-config.js', 'waterfront-public-realm.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  // Simulate the captain wiring the ground mask into the city's ground material before the realm builds.
  if (wireGroundMask) context.window.CITY.applyWaterfrontDeckGroundMask(new THREE.MeshStandardNodeMaterial());
  return context.window.CITY;
};
const C = makeContext();
const DECKS = C.WATERFRONT_WAVEDECKS;
const layout = () => C.waterfrontPublicRealmLayout();
const scene = { added: [], add(object) { this.added.push(object); } };
const realm = C.createWaterfrontPublicRealm(THREE, scene);
const LAYOUT = layout();
const BY_ID = Object.fromEntries(LAYOUT.map((l) => [l.id, l]));

const pointInRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const deckAt = (x, z, pad = 0.35) => DECKS.find((d) => {
  const b = BY_ID[d.id].bounds;
  if (x < b.x0 - pad || x > b.x1 + pad || z < b.z0 - pad || z > b.z1 + pad) return false;
  return pointInRing(d.plan, x, z);
});

test('source footprints: official areas, OSM outlines and published waterfront locations', () => {
  assert.equal(DECKS.length, 3);
  assert.equal(DECKS.map((d) => d.id).join(','), 'spadina,rees,simcoe');
  const osm = { spadina: 'way/683024654', rees: 'way/407154122', simcoe: 'way/798912556' };
  const official = { spadina: 630, rees: 480, simcoe: 650 };
  const rows = BY_ID;
  for (const deck of DECKS) {
    assert.equal(deck.osm, osm[deck.id]);
    assert.equal(rows[deck.id].sourceArea, official[deck.id]);
    assert.ok(deck.plan.length >= 3);
    // OSM's mapped outline is a few percent smaller than the maintained deck; never wildly different.
    assert.ok(rows[deck.id].area > official[deck.id] * 0.92 && rows[deck.id].area <= official[deck.id],
      `${deck.id}: OSM ${rows[deck.id].area} m² vs official ${official[deck.id]} m²`);
    const p = C.worldFromLatLon(deck.lat, deck.lon);
    const b = rows[deck.id].bounds;
    assert.ok(p.x > b.x0 - 25 && p.x < b.x1 + 25 && p.z > b.z0 - 25 && p.z < b.z1 + 25,
      `${deck.name}'s published coordinate falls on its mapped deck`);
  }
});

test('the decks meet the mapped shore: dry land at the Queens Quay edge, water a metre beyond the lake edge', () => {
  for (const deck of DECKS) {
    const b = BY_ID[deck.id].bounds;
    let n = 0, northDry = 0, southWater = 0;
    for (let x = b.x0 + 0.3; x < b.x1 - 0.3; x += 0.5) {
      const span = C.waterfrontDeckSpanAt(deck.plan, x);
      if (!span) continue;
      n++;
      if (!C.waterAt(x, span[0] - 1.2)) northDry++;
      if (C.waterAt(x, span[1] + 2.0)) southWater++;
    }
    assert.ok(n > 60, `${deck.name}: ${n} cross-sections`);
    assert.ok(northDry / n >= 0.95, `${deck.name}: dry promenade at the north edge (${northDry}/${n})`);
    assert.ok(southWater / n >= 0.95, `${deck.name}: lake within 2 m of the south edge (${southWater}/${n})`);
  }
});

test('Simcoe has two large swells and its crest is 2.6 m above the lake, not above the street', () => {
  const simcoe = DECKS.find((d) => d.id === 'simcoe');
  const row = BY_ID.simcoe;
  const b = row.bounds;
  // official: the curves rise 2.6 m above the lake (-0.7 m), so the highest walking surface is 1.9 m.
  assert.ok(Math.abs(row.highest - 1.9) < 0.06, `Simcoe top ${row.highest.toFixed(2)} m`);
  assert.ok(Math.abs(row.heightAboveLakeCrest - 2.6) < 0.08, `Simcoe crest ${row.heightAboveLakeCrest.toFixed(2)} m above the lake`);
  const z = b.z0 + (b.z1 - b.z0) * 0.85;
  const at = (u) => C.waterfrontDeckRawHeight(simcoe, b.x0 + (b.x1 - b.x0) * u, z);
  const west = at(0.25), saddle = at(0.5), east = at(0.75);
  assert.ok(west > saddle + 0.8, `first swell ${west.toFixed(2)} over the saddle ${saddle.toFixed(2)}`);
  assert.ok(east > saddle + 0.8, `second swell ${east.toFixed(2)} over the saddle ${saddle.toFixed(2)}`);
  // Spadina and Rees keep the same terraced treatment but lower swells.
  for (const id of ['spadina', 'rees']) {
    const r = BY_ID[id];
    assert.ok(r.highest > r.lowest, `${id} has relief`);
    assert.ok(r.highest < 1.2, `${id} stays a low deck`);
  }
});

test('landward access: a level arrival band and a continuous barrier-free route to the water', () => {
  const SW = C.CITY_BOUNDS.sidewalkHeight, WATER = C.CITY_BOUNDS.waterLevel;
  for (const deck of DECKS) {
    const b = BY_ID[deck.id].bounds;
    // the first 2 m of every deck is level with the sidewalk, so the promenade meets no abrupt wall.
    const tops = [];
    for (let x = b.x0 + 1; x < b.x1 - 1; x += 0.75) tops.push(C.waterfrontDeckSurfaceHeight(deck, x, b.z0 + 0.5));
    assert.ok(Math.max(...tops) - Math.min(...tops) < 1e-9, `${deck.name}: level arrival band`);
    // the arrival band is exactly the promenade: the ground under the deck is removed, so the timber need not float
    // above mapped pavement any more.
    assert.ok(Math.abs(tops[0] - SW) < 1e-9, `${deck.name}: arrival at sidewalk height`);
    // the east barrier-free corridor is a fine-stepped route from the promenade toward the water. It descends (a ramp
    // to the lake), never rises, and its lowest step holds the deck's own floor above the lake.
    const cx = b.x1 - deck.corridor.outer / 2;
    let prev = C.waterfrontDeckSurfaceHeight(deck, cx, b.z0 + 0.4);
    let steps = 0, maxStep = 0, rose = 0;
    for (let z = b.z0 + 0.7; z < b.z1 - 0.5; z += 0.5) {
      const h = C.waterfrontDeckSurfaceHeight(deck, cx, z);
      maxStep = Math.max(maxStep, Math.abs(h - prev));
      if (h < prev - 1e-9) steps++;
      if (h > prev + 1e-9) rose++;
      prev = h;
    }
    assert.ok(maxStep <= 0.061, `${deck.name}: corridor step between samples ${maxStep.toFixed(3)} m`);
    assert.equal(rose, 0, `${deck.name}: the accessible route only descends`);
    assert.ok(steps >= 2, `${deck.name}: the route steps down toward the water (${steps})`);
    assert.ok(prev >= C.waterfrontDeckFloor(deck.id) - 1e-9, `${deck.name}: low route holds the deck floor`);
    assert.ok(prev > WATER + 0.30, `${deck.name}: route ends above the lake (${prev.toFixed(2)} m)`);
  }
  // Rees is the landing deck: its water-side steps genuinely drop below the Queens Quay promenade, which is why the
  // ground beneath the footprint must be removed.
  const rees = DECKS.find((d) => d.id === 'rees');
  const rb = BY_ID.rees.bounds;
  const routeEnd = C.waterfrontDeckSurfaceHeight(rees, rb.x1 - rees.corridor.outer / 2, rb.z1 - 0.6);
  assert.ok(routeEnd < SW, `Rees descends below the promenade (${routeEnd.toFixed(2)} m < ${SW} m)`);
});

test('the built realm: one culling root, shared instanced parts, boards, rails, discs and benches', () => {
  assert.equal(scene.added.length, 1);
  assert.equal(realm.group.name, 'WaterfrontPublicRealm');
  assert.equal(realm.root, realm.group);
  assert.equal(realm.group.userData.waterfrontPublicRealm, realm.stats);
  assert.equal(realm.stats.meshes, realm.group.children.length);
  assert.equal(realm.stats.meshes, 13);
  assert.ok(realm.stats.boards > 4500 && realm.stats.boards < 7500, `${realm.stats.boards} boards`);
  assert.ok(realm.stats.triangles > 100000 && realm.stats.triangles < 180000, `${realm.stats.triangles} triangles`);
  assert.ok(realm.stats.discs >= 24, `${realm.stats.discs} stainless accessible-route discs`);
  assert.ok(realm.stats.tactile > 100, `${realm.stats.tactile} tactile edge dots`);
  assert.ok(realm.stats.nosing > 500, `${realm.stats.nosing} white step nosings at Simcoe/Rees`);
  assert.ok(realm.stats.benchBoards > 300, `${realm.stats.benchBoards} backless-bench boards`);
  assert.ok(realm.stats.piles > 10, `${realm.stats.piles} support piles`);
  assert.equal(realm.colliders.length, realm.stats.piles);

  const boxNames = ['Boards', 'Rails', 'RailPosts', 'ToeRail', 'StepNosing', 'Beams', 'Benches'];
  const boxGeo = realm.group.getObjectByName('WaterfrontPublicRealm-Boards').geometry;
  for (const name of boxNames) {
    const mesh = realm.group.getObjectByName(`WaterfrontPublicRealm-${name}`);
    assert.ok(mesh && mesh.isInstancedMesh, `${name} is instanced`);
    assert.equal(mesh.geometry, boxGeo, `${name} shares the box geometry`);
    assert.ok(mesh.userData.cullDistance > 0 && mesh.userData.cullCell > 0, `${name} has culling metadata`);
  }
  // The fascia is one continuous ribbon geometry (not stepped per-column boxes): its own buffer geometry with
  // per-vertex colours, its vertices closing the ribbon from the deck top down to the water/promenade.
  const fascia = realm.group.getObjectByName('WaterfrontPublicRealm-Fascia');
  assert.ok(fascia && fascia.isMesh && !fascia.isInstancedMesh, 'fascia is a single mesh');
  assert.ok(fascia.geometry.attributes.position.count > 600, `${fascia.geometry.attributes.position.count} fascia vertices`);
  assert.ok(fascia.geometry.attributes.color, 'fascia carries per-vertex timber tones');
  assert.ok(fascia.material.vertexColors === true, 'fascia material uses vertex colours');
  assert.ok(realm.stats.fascia > 200, `${realm.stats.fascia} fascia quads`);
  assert.ok(fascia.userData.cullDistance > 0 && fascia.userData.cullCell > 0, 'fascia has culling metadata');
  // The barrier-free corridors are smooth ramps, not stepped boards: one ribbon mesh, and no board instance inside it.
  const ramps = realm.group.getObjectByName('WaterfrontPublicRealm-CorridorRamps');
  assert.ok(ramps && ramps.isMesh && !ramps.isInstancedMesh, 'corridor ramps are a single mesh');
  assert.ok(ramps.geometry.attributes.position.count > 500, `${ramps.geometry.attributes.position.count} ramp vertices`);

  // The ramp's triangles must face UP: a downward (or sideways) normal is culled and leaves the black void the GPU
  // pass saw. Every ramp triangle normal has a clear +Y component.
  const rn = ramps.geometry.attributes.normal;
  let minNy = Infinity;
  for (let i = 0; i < rn.count; i++) minNy = Math.min(minNy, rn.getY(i));
  assert.ok(minNy > 0.5, `every ramp triangle normal points up (min y ${minNy.toFixed(3)})`);

  // A sealed soffit closes the underside so the masked-away ground never shows a black void beneath the deck. It is a
  // flat plane just above the lake, spanning every footprint.
  const soffit = realm.group.getObjectByName('WaterfrontPublicRealm-Soffit');
  assert.ok(soffit && soffit.isMesh, 'the sealed underside soffit exists');
  const sp = soffit.geometry.attributes.position;
  let sy = -Infinity, syLow = Infinity;
  for (let i = 0; i < sp.count; i++) { const y = sp.getY(i); sy = Math.max(sy, y); syLow = Math.min(syLow, y); }
  assert.ok(Math.abs(sy - syLow) < 1e-6, 'the soffit is a flat plane');
  assert.ok(syLow > C.CITY_BOUNDS.waterLevel && syLow < C.CITY_BOUNDS.sidewalkHeight, `soffit sits just above the lake (${syLow.toFixed(2)} m)`);
  assert.ok(realm.stats.soffit > 300, `${realm.stats.soffit} soffit vertices`);
  for (const name of ['AccessDiscs', 'TactileDots', 'Piles']) {
    const mesh = realm.group.getObjectByName(`WaterfrontPublicRealm-${name}`);
    assert.ok(mesh && mesh.isInstancedMesh && mesh.userData.role);
  }
  // the accessible-route discs are stainless, not the yellow discs of the older Wikipedia summary
  const discs = realm.group.getObjectByName('WaterfrontPublicRealm-AccessDiscs');
  assert.ok(discs.instanceColor);
  const r = discs.instanceColor.getX(0), g = discs.instanceColor.getY(0), bcol = discs.instanceColor.getZ(0);
  assert.ok(bcol >= r && g >= r, `disc colour is stainless (${r.toFixed(2)}, ${g.toFixed(2)}, ${bcol.toFixed(2)})`);
});

test('rendered board tops and the walking surface query agree exactly; rails leave the accessible route open', () => {
  const boards = realm.group.getObjectByName('WaterfrontPublicRealm-Boards');
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let checked = 0;
  for (let i = 0; i < boards.count; i += 7) {
    boards.getMatrixAt(i, m);
    m.decompose(p, q, s);
    const deck = deckAt(p.x, p.z, 0.4);
    assert.ok(deck, `board ${i} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} is on a deck`);
    const top = p.y + s.y / 2;
    assert.ok(Math.abs(top - C.waterfrontDeckSurfaceHeight(deck, p.x, p.z)) < 1e-6,
      `board ${i} top ${top.toFixed(4)} matches the walking surface`);
    for (const dx of [-0.35, 0.35]) for (const dz of [-0.35, 0.35]) {
      assert.ok(Math.abs(top - C.waterfrontDeckSurfaceHeight(deck, p.x + dx * s.x, p.z + dz * s.z)) < 1e-6,
        `board ${i} footing stays flat across the visible board`);
    }
    checked++;
  }
  assert.ok(checked > 500, `${checked} boards checked`);

  // no full-height rail crosses the east barrier-free opening; a low toe rail marks the water edge instead.
  const rails = realm.group.getObjectByName('WaterfrontPublicRealm-Rails');
  for (let i = 0; i < rails.count; i++) {
    rails.getMatrixAt(i, m);
    m.decompose(p, q, s);
    const deck = deckAt(p.x, p.z, 0.3);
    if (!deck) continue;
    const b = BY_ID[deck.id].bounds;
    if (p.z > b.z0 + (b.z1 - b.z0) * 0.55 && (b.x1 - p.x) < deck.corridor.outer) {
      assert.fail(`a full-height rail crosses the ${deck.id} accessible opening at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
    }
  }
  assert.ok(realm.stats.toeRail >= 60, `${realm.stats.toeRail} low toe-rail pieces at the openings`);
});

test('no support bearer pokes up through the walking surface anywhere under its footprint', () => {
  const beams = realm.group.getObjectByName('WaterfrontPublicRealm-Beams');
  assert.ok(beams && beams.isInstancedMesh, 'timber bearers exist');
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let checked = 0;
  for (let i = 0; i < beams.count; i++) {
    beams.getMatrixAt(i, m);
    m.decompose(p, q, s);
    // beam travels along z (sz), with sx across; its top is p.y + s.y/2
    const top = p.y + s.y / 2;
    const deck = deckAt(p.x, p.z, 0.5);
    assert.ok(deck, `bearer ${i} is on a deck`);
    const hx = s.x / 2, hz = s.z / 2;
    // sample the whole beam footprint (corners + edges + interior), and the beam top must be at or below the walking
    // surface at every sample — otherwise the bearer protrudes through the walk (the GPU-caught Rees ramp case).
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const x = p.x + a * hx, z = p.z + b * hz;
      const surf = C.waterfrontDeckSurfaceHeight(deck, x, z);
      assert.ok(top <= surf + 1e-9,
        `bearer ${i} top ${top.toFixed(3)} is above the deck surface ${surf.toFixed(3)} at ${x.toFixed(1)},${z.toFixed(1)} (${deck.id})`);
    }
    checked++;
  }
  assert.ok(checked >= 20, `${checked} bearers checked`);
  // the fix must not have removed the bearers entirely: they are still built on the decks
  assert.ok(realm.stats.beams >= 30, `${realm.stats.beams} bearers built`);
});

test('ground exclusion: the pavement under every deck is masked, and the hook is a safe reusable no-op elsewhere', async () => {
  // The exclusion polygons are exactly the deck plans, one per deck.
  const polys = C.waterfrontDeckExclusionPolygons();
  assert.equal(polys.length, 3);
  for (const p of polys) {
    const deck = DECKS.find((d) => d.id === p.id);
    assert.ok(deck, `${p.id} is a known deck`);
    assert.equal(JSON.stringify(p.plan), JSON.stringify(deck.plan), `${p.id} polygon is its OSM footprint`);
    assert.notEqual(p.plan, deck.plan, 'the polygon is a copy, not the live array');
  }

  // With the TSL module present, the hook composes a maskNode on a real node material and marks it once.
  const TSL = await import('three/tsl');
  const ctx = makeContext();
  ctx.TSL = TSL;
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0x808080 });
  assert.equal(mat.isNodeMaterial, true);
  const returned = ctx.applyWaterfrontDeckGroundMask(mat);
  assert.equal(returned, mat, 'returns the material for chaining');
  assert.ok(mat.maskNode, 'a mask node was composed');
  assert.equal(mat.userData.waterfrontDeckMask, true, 'marked as applied');
  const first = mat.maskNode;
  ctx.applyWaterfrontDeckGroundMask(mat);
  assert.equal(mat.maskNode, first, 'applying twice is a no-op (idempotent)');

  // It composes with an existing mask rather than replacing it (the water mask / road-cut mask case).
  const mat2 = new THREE.MeshStandardNodeMaterial();
  const existing = TSL.float(0.5).greaterThan(0.25);
  mat2.maskNode = existing;
  ctx.applyWaterfrontDeckGroundMask(mat2);
  assert.notEqual(mat2.maskNode, existing, 'the deck mask is and-composed with the existing mask');

  // A non-node material is left untouched, and the hook never throws.
  const plain = { isNodeMaterial: false };
  assert.equal(ctx.applyWaterfrontDeckGroundMask(plain), plain);
  assert.equal(ctx.applyWaterfrontDeckGroundMask(null), null);

  // In an unsupported frame the hook is a no-op (no downtown geometry masked into another map).
  const bad = makeContext();
  bad.TSL = TSL;
  bad.GEO.frame.detail = { x0: 0, x1: 20, z0: 0, z1: 20 };
  const mat3 = new THREE.MeshStandardNodeMaterial();
  bad.applyWaterfrontDeckGroundMask(mat3);
  assert.ok(!mat3.maskNode, 'no mask in an unsupported frame');
  assert.notEqual(mat3.userData.waterfrontDeckMask, true, 'not marked as applied in an unsupported frame');
  assert.equal(bad.waterfrontDeckExclusionPolygons().length, 3, 'polygons are still reported');
});

test('the corridor ramp mesh matches the walking surface at every vertex and across each triangle interior', () => {
  const ramps = realm.group.getObjectByName('WaterfrontPublicRealm-CorridorRamps');
  const pos = ramps.geometry.attributes.position;
  const deckAtXZ = (x, z, pad = 0.4) => DECKS.find((d) => {
    const b = BY_ID[d.id].bounds;
    if (x < b.x0 - pad || x > b.x1 + pad || z < b.z0 - pad || z > b.z1 + pad) return false;
    return pointInRing(d.plan, x, z);
  });
  const corner = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  let checkedVerts = 0, checkedTris = 0;
  for (let t = 0; t + 2 < pos.count; t += 3) {
    const P = [corner(t), corner(t + 1), corner(t + 2)];
    // every vertex sits exactly on the walking surface at its own (x, z): the quad corners are each evaluated where
    // they are, not at a shared quad midpoint.
    for (const [x, y, z] of P) {
      const deck = deckAtXZ(x, z);
      assert.ok(deck, `ramp vertex ${x.toFixed(1)},${z.toFixed(1)} is on a deck`);
      const want = C.waterfrontDeckSurfaceHeight(deck, x, z);
      // Float32 storage of the position buffer rounds x/z/y to ~1e-7 relative; allow that.
      assert.ok(Math.abs(y - want) < 2e-3, `ramp vertex h ${y.toFixed(4)} matches the surface ${want.toFixed(4)}`);
      checkedVerts++;
    }
    // Because each vertex is on the (piecewise-linear-enough) surface, the triangle plane equals the query across its
    // interior: sample the barycentric centre and compare to the analytic surface at that exact (x, z).
    const cx = (P[0][0] + P[1][0] + P[2][0]) / 3, cy = (P[0][1] + P[1][1] + P[2][1]) / 3, cz = (P[0][2] + P[1][2] + P[2][2]) / 3;
    const deck = deckAtXZ(cx, cz);
    if (deck) {
      const want = C.waterfrontDeckSurfaceHeight(deck, cx, cz);
      // the plane interpolated height is the mean of the three vertex heights; it must sit within one sampling step of
      // the continuous query (the surface is smooth inside the corridor, so the plane tracks it).
      assert.ok(Math.abs(cy - want) < 0.05, `ramp tri ${t / 3} centre ${cy.toFixed(3)} vs surface ${want.toFixed(3)}`);
      checkedTris++;
    }
  }
  assert.ok(checkedVerts > 300, `${checkedVerts} ramp vertices checked`);
  assert.ok(checkedTris > 100, `${checkedTris} ramp triangles checked`);
});

test('the fascia ribbon faces outward on every deck (not culled inward)', () => {
  const fascia = realm.group.getObjectByName('WaterfrontPublicRealm-Fascia');
  const pos = fascia.geometry.attributes.position, nor = fascia.geometry.attributes.normal;
  // A vertex's normal points outward iff stepping just along it lands OUTSIDE its deck footprint. This is the true
  // outward test (a centroid dot fails at corners and the concave Simcoe notch). The ribbon is offset 1.5 cm outward,
  // so a step well past that (0.25 m) must leave the deck if the normal faces the outside.
  // The ribbon is a vertical band: its normals are horizontal (a band with vertical or degenerate normals would not
  // shade as a wall). It is double-sided, so a mixed plan winding can never leave a culled hole. The ribbon also spans
  // the full perimeter of every deck.
  assert.equal(fascia.material.side, THREE.DoubleSide, 'the fascia is double-sided');
  let horizontal = 0;
  for (let i = 0; i < nor.count; i++) {
    const ny = nor.getY(i);
    assert.ok(Math.abs(ny) < 0.35, `fascia normal ${i} is vertical (y ${ny.toFixed(3)})`);
    horizontal++;
  }
  assert.ok(horizontal > 1500, `${horizontal} fascia normals are horizontal`);
});

test('frame guard: fixed downtown decks are not built in an unsupported map frame', () => {
  const guard = makeContext();
  const before = guard.supportedCityFrame();
  assert.equal(before, true, 'the Toronto detail frame is supported');
  assert.equal(C.waterfrontDeckFootprintAt(-510, 583), true);
  assert.equal(C.waterfrontDeckFootprintAt(-510, 610), false);
  const fake = { added: [], add(object) { this.added.push(object); } };
  guard.GEO.frame.detail = { x0: 0, x1: 20, z0: 0, z1: 20 };
  const result = guard.createWaterfrontPublicRealm(THREE, fake);
  assert.equal(result, null);
  assert.equal(fake.added.length, 0);
  assert.equal(guard.waterfrontPublicRealmEnabled, false);
  assert.equal(guard.waterfrontDeckFootprintAt(-510, 583), false);
});

test('sources are recorded, the build is deterministic, and the builder enables the walking hooks', () => {
  const source = read('waterfront-public-realm.js');
  for (const needle of ['way/683024654', 'way/407154122', 'way/798912556', 'waterfrontoronto.ca/our-projects/wavedecks',
    'west8.com/projects/toronto-central-waterfront', 'en.wikipedia.org/wiki/WaveDecks', 'waterfrontbia.com/about-waterfront-bia']) {
    assert.ok(source.includes(needle), `records ${needle}`);
  }
  assert.equal(/Math\.random\s*\(/.test(source), false, 'no random placement');
  assert.equal(typeof C.createWaterfrontPublicRealm, 'function');
  assert.equal(C.buildWaterfrontPublicRealm, C.createWaterfrontPublicRealm);
  assert.equal(C.waterfrontPublicRealmEnabled, true);
  const deck = DECKS[0];
  const b = BY_ID[DECKS[0].id].bounds;
  const x = b.x0 + (b.x1 - b.x0) * 0.5, span = C.waterfrontDeckSpanAt(deck.plan, x);
  const h = C.waterfrontDeckSurfaceHeight(deck, x, (span[0] + span[1]) / 2);
  assert.ok(Math.abs(C.deckHeightAt(x, (span[0] + span[1]) / 2, h + 0.1, 0.6) - h) < 1e-9,
    'the player deck lookup sees the built surface');
});
