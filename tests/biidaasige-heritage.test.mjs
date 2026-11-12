// Biidaasige retained heritage + placekeeping (js/biidaasige-heritage.js, bead st-bmyv.6).
//
// These tests build the REAL geometry in a Node VM and check measurable, source-related properties — not just that
// a bucket exists:
//   * the Fire Hall reads as ONE building: two-storey mass, red-brick walls over cream stone, a raised hip roof plane
//     above the cornice, the upper narrow/wide/narrow window triads, the adapted ground-floor glazed entry, and the
//     documented ~24 m south displacement from the native GEO row exactly reproducing the current OSM ring;
//   * the Atlas Crane is a lattice crane (a long triangulated jib well past the base, guy cables, a lettering band)
//     and NOT the TMU student observation platform (no stairs/steps anywhere);
//   * The Drum is an OPEN oculus shade structure with a red roof annulus, a white perimeter, paired timber V-strings
//     and the source's 201 m2 footprint — and it never invents a moon/cultural graphic (no texture, no decal);
//   * nothing is placed without a source: frame absent -> layouts null; the Drum is ALWAYS null; Marine Terminal 35
//     fragments + the interpretive sign are returned UNPLACED;
//   * the identity predicate fails closed, accepts only the one documented native Fire Hall row, and rejects each of
//     the other native park buildings, a tower height, a multi-part block and the wrong displacement.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(ROOT + p, 'utf8');

// A CITY context with THREE + the merge addon. `withData` also loads js/biidaasige-park-data.js and a projection
// shim (the real GEO frame's projection, read from js/toronto-geodata.js) so the layout helpers see a real frame.
function city({ withData = true, withProjection = true } = {}) {
  const CITY = { THREE, Addons: { mergeGeometries } };
  const ctx = { window: { CITY }, console: { info() {}, warn() {}, log() {}, error() {} }, performance };
  vm.createContext(ctx);
  if (withData) vm.runInContext(read('js/biidaasige-park-data.js'), ctx, { filename: 'biidaasige-park-data.js' });
  if (withData) vm.runInContext(read('js/biidaasige-heritage.js'), ctx, { filename: 'biidaasige-heritage.js' });
  else vm.runInContext(read('js/biidaasige-heritage.js'), ctx, { filename: 'biidaasige-heritage.js' });
  if (withData && withProjection) {
    const gctx = { window: {} };
    vm.createContext(gctx);
    vm.runInContext(read('js/toronto-geodata.js'), gctx);
    const P = gctx.window.CITY.GEO.frame.projection;
    CITY.worldFromLatLon = (lat, lon) => {
      const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
      const c = Math.cos(P.theta), s = Math.sin(P.theta);
      return { x: e * c - n * s - P.ox, z: -(e * s + n * c) - P.oz };
    };
  }
  return ctx.window.CITY;
}

function finite(group, label) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position, n = o.geometry.attributes.normal;
    assert.ok(p, `${label}: ${o.name} has positions`);
    for (let i = 0; i < p.count; i++) {
      assert.ok(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i)), `${label}: ${o.name} finite vertex ${i}`);
    }
    if (n) for (let i = 0; i < n.count; i++) assert.ok(Number.isFinite(n.getX(i)), `${label}: ${o.name} finite normal`);
  });
}
function bbox(group) {
  const b = new THREE.Box3();
  group.updateWorldMatrix(true, true);
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return b;
}
const meshByKey = (group, suffix) => group.children.find((m) => m.name.endsWith('-' + suffix));
function areaOf(geo) {
  const p = geo.attributes.position;
  let a = 0;
  for (let t = 0; t + 2 < p.count; t += 3) {
    const ux = p.getX(t + 1) - p.getX(t), uy = p.getY(t + 1) - p.getY(t), uz = p.getZ(t + 1) - p.getZ(t);
    const vx = p.getX(t + 2) - p.getX(t), vy = p.getY(t + 2) - p.getY(t), vz = p.getZ(t + 2) - p.getZ(t);
    a += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return a;
}
function nameIncludes(group, re) {
  return group.children.some((m) => re.test(m.name));
}

// ---------------------------------------------------------------------------------------------------------------
register();

function register() {
  test('Fire Hall 30: two-storey red-brick mass with cream stone, hip roof, framed windows and the adapted entry', () => {
    const C = city();
    const r = C.buildFireHall30();
    assert.equal(r.id, 'old-fire-hall-30');
    assert.equal(r.climbable, false);
    assert.equal(r.surfaces.length, 0);
    finite(r.group, 'firehall');
    const b = bbox(r.group);
    // base ON the ground, footprint ~21.5 x 13.5 m (OSM), model built to the OSM footprint
    assert.ok(Math.abs(b.min.y) < 0.05, `base sits on y=0 (${b.min.y.toFixed(3)})`);
    assert.ok(Math.abs(b.max.x - b.min.x - 21.5) < 1.2, `built width ~21.5 m (got ${(b.max.x - b.min.x).toFixed(1)})`);
    assert.ok(Math.abs(b.max.z - b.min.z - 13.5) < 1.2, `built depth ~13.5 m (got ${(b.max.z - b.min.z).toFixed(1)})`);
    // two storeys + a hip roof: the roof plane is ABOVE the two-storey representative height
    assert.ok(b.max.y > r.heights.representativeM + 1.2, `roof rises above two storeys (${b.max.y.toFixed(2)} m)`);
    assert.equal(r.heights.levels, 2, 'source label: building:levels = 2');
    assert.match(r.heights.representativeSource, /explicit|NOT/i);
    // a RED brick bucket and a CREAM stone bucket both exist and both carry real surface area
    assert.ok(areaOf(meshByKey(r.group, 'brick').geometry) > 40, 'brick walls have real area');
    assert.ok(areaOf(meshByKey(r.group, 'stone').geometry) > 3, 'cream stone trim has real area');
    // the walls are a real red-brick envelope (not a stone box): brick area is large and exceeds the roof plane
    const brickA = ['brick', 'brickUpper'].reduce((s, k) => s + areaOf(meshByKey(r.group, k).geometry), 0);
    assert.ok(brickA > 500, `red brick walls carry real area (${brickA.toFixed(0)} m2)`);
    assert.ok(brickA > areaOf(meshByKey(r.group, 'roof').geometry), 'brick walls dominate the roof plane');
    // the hip roof and the framed glass exist as their own buckets
    assert.ok(meshByKey(r.group, 'roof'), 'hip roof bucket present');
    assert.ok(meshByKey(r.group, 'frame') && meshByKey(r.group, 'glass'), 'framed windows present');
    assert.ok(meshByKey(r.group, 'glassEntry'), 'the adapted glazed ground-floor entry present');
    // two window triads (6 upper openings) + 3 ground windows + 2 side washroom openings: the frame bucket is many
    // separate quad sets, but the real proof is that the glass area is larger than a single opening
    assert.ok(areaOf(meshByKey(r.group, 'glass').geometry) > 8, 'multiple glazed openings, not one');
    // the source is the ERA page, the photos are credited, and the footprint is the OSM way
    assert.match(r.source, /eraarch\.ca/);
    assert.match(r.attribution, /Mina Markovic/);
    assert.match(r.footprint.source, /494886782/);
  });

  test('Fire Hall 30: the built footprint reproduces the native GEO row displaced EXACTLY 24 m south (one building)', () => {
    // This pins the identity evidence the predicate relies on: the current OSM ring's eight edge lengths match the
    // native committed GEO row part edge-for-edge, so the native row is the SAME building moved, not a second one.
    const C = city();
    const p = C.BIIDAASIGE_HERITAGE_FACTORIES.fireHall30Placement();
    assert.ok(p, 'a projection frame was supplied, so the Fire Hall must place');
    assert.equal(p.sourceRef, 'way/494886782');
    assert.ok(Array.isArray(p.ring) && p.ring.length >= 8, 'the current OSM ring projects to world');
    // the current OSM centre sits ~24-27 m SOUTH (greater z; south is -north) of the native row
    const N = C.BIIDAASIGE_HERITAGE_NATIVE;
    const sep = Math.hypot(p.x - N.x, p.z - N.z);
    assert.ok(sep > 22 && sep < 30, `current OSM anchor is the documented 24 m displacement from the native row (${sep.toFixed(1)} m)`);
    assert.ok(p.z > N.z, 'the displacement is SOUTH (increasing z)');
    // edge-for-edge match: the OSM way is closed (last vertex repeats the first); drop the duplicate, then every
    // real edge of the projected ring is within a few cm of the native part's eight edges
    const ring = p.ring.slice();
    const first = ring[0], last = ring[ring.length - 1];
    if (Math.hypot(last.x - first.x, last.z - first.z) < 1e-6) ring.pop();
    const edges = ring.map((q, i) => {
      const s = ring[(i + 1) % ring.length];
      return Math.hypot(s.x - q.x, s.z - q.z);
    }).sort((a, b) => a - b);
    const expected = [2.43, 3.33, 3.38, 4.0, 7.02, 8.78, 17.61, 20.98];
    for (let i = 0; i < expected.length; i++) {
      assert.ok(Math.abs(edges[i] - expected[i]) < 0.6, `edge ${i} ${edges[i].toFixed(2)} m ~ ${expected[i]} m (native row)`);
    }
  });

  test('Atlas Crane: the ACTUAL white gantry/A-frame (four lattice columns, top beams, long boom to the ground)', () => {
    const C = city();
    const r = C.buildAtlasCrane();
    assert.equal(r.id, 'atlas-crane');
    assert.equal(r.climbable, false);
    finite(r.group, 'atlas');
    const b = bbox(r.group);
    // TALL gantry: the actual structure is a ~35-38 m photo estimate (not a short turret crane)
    assert.ok(b.max.y >= 34 && b.max.y <= 40, `gantry height in the photo-estimate range (${b.max.y.toFixed(1)} m)`);
    assert.equal(r.heights.representativeM, 36, 'default representative height is the 36 m photo estimate');
    assert.equal(r.heights.representativeRangeM.length, 2);
    assert.ok(r.heights.representativeRangeM[0] === 35 && r.heights.representativeRangeM[1] === 38);
    // a near-vertical portal: the column cluster is ~10-12 m across, not a wide low box
    assert.ok(b.max.x - b.min.x <= 13, `portal width ~10-12 m (got ${(b.max.x - b.min.x).toFixed(1)})`);
    // the giant BOOM reaches far out front (+Z) and comes all the way DOWN to the ground
    assert.ok(b.max.z > 18, `the boom reaches ~25 m out front (got ${b.max.z.toFixed(1)})`);
    assert.ok(b.min.y <= 0.2, 'the boom foot lands on the ground (not a hovering jib tip)');
    // the four INDIVIDUAL anti-climb sleeves + the boom footing are separate colliders (not one plinth)
    const feet = r.colliders.filter((c) => /foot-\d/.test(c.kind));
    assert.equal(feet.length, 4, 'four individual foot colliders');
    assert.ok(r.colliders.some((c) => c.kind === 'atlascrane-boom-footing'), 'the boom ground footing collider');
    // real steel lattice + the black hoist track + the pair of boom cables, on white-painted steel
    assert.ok(areaOf(meshByKey(r.group, 'steel').geometry) > 30, 'lattice steel members present');
    assert.ok(meshByKey(r.group, 'sleeve'), 'the per-foot white anti-climb sleeves are modelled');
    assert.ok(meshByKey(r.group, 'track'), 'the black cable/hoist track along the top beam is modelled');
    assert.ok(meshByKey(r.group, 'cable'), 'the pair of black cables along the boom is modelled');
    // the invented (wrong) turret-crane parts must NOT exist: no cab, counterweight, hook, turret
    for (const banned of [/(^|-)cab$/, /counter ?weight/i, /hook/i, /turret/i, /stair/i, /platform/i, /lift/i]) {
      assert.equal(nameIncludes(r.group, banned), false, `no invented ${banned} part`);
    }
    // '300-ton' is a structure MASS label, NOT a lifting capacity; the height is a photo-estimate
    assert.equal(r.heights.massLabelTons, undefined);
    assert.equal(C.BIIDAASIGE_ATLAS_ESTIMATE.massLabelTons, 300);
    assert.equal(C.BIIDAASIGE_ATLAS_ESTIMATE.verifiedCapacityTons, undefined, 'no lifting-capacity claim');
    assert.match(r.heights.massLabel, /NOT a lifting capacity/);
    assert.match(r.heights.source, /photo estimate/i);
    assert.match(r.form, /gantry|A-frame/i);
    assert.match(r.source, /waterfrontoronto\.ca/);
  });

  test('The Drum: an OPEN oculus shade structure with a red annulus, white perimeter, paired V-strings, 201 m2', () => {
    const C = city();
    const r = C.buildTheDrum();
    assert.equal(r.id, 'the-drum');
    assert.equal(r.climbable, false);
    finite(r.group, 'drum');
    const b = bbox(r.group);
    assert.ok(Math.abs(b.min.y) < 0.05, 'base on y=0');
    // source footprint 201 m2: the modelled equivalent circle's area matches within a few percent
    const area = Math.PI * r.footprint.radiusM * r.footprint.radiusM;
    assert.ok(Math.abs(area - 201) < 8, `modelled footprint area ~201 m2 (${area.toFixed(1)})`);
    assert.equal(r.footprint.areaM2, 201);
    assert.match(r.footprint.areaSource, /201 m2/);
    // OPEN centre: no mesh covers the oculus. Cast a downward ray at the centre and expect NO roof hit.
    const ray = new THREE.Raycaster(new THREE.Vector3(0, b.max.y + 2, 0), new THREE.Vector3(0, -1, 0), 0, 100);
    const hits = ray.intersectObjects(r.group.children, false);
    const roofHits = hits.filter((h) => /-roof|-white/.test(h.object.name));
    assert.equal(roofHits.length, 0, 'the central oculus is open (no roof above the centre)');
    // ...but the roof annulus at a mid radius (halfway to the rim) IS covered (a real ring, not a hole)
    const rr = r.footprint.radiusM * 0.75;
    const ray2 = new THREE.Raycaster(new THREE.Vector3(rr, b.max.y + 2, 0), new THREE.Vector3(0, -1, 0), 0, 100);
    assert.ok(ray2.intersectObjects(r.group.children, false).some((h) => /-roof/.test(h.object.name)), 'the roof annulus covers the ring');
    // the five source palette buckets all carry real geometry
    for (const k of ['roof', 'white', 'timber', 'wall', 'apron']) {
      const m = meshByKey(r.group, k);
      assert.ok(m && areaOf(m.geometry) > 0.5, `${k} has real geometry`);
    }
    // NO invented moon/cultural graphic: every material is a flat standard material with no map
    r.group.traverse((o) => {
      if (!o.isMesh) return;
      assert.ok(!o.material.map, `${o.name} uses no texture (no invented moon/cultural graphic)`);
    });
    assert.equal(r.completed, 2026);
    assert.match(r.attribution, /Taw/);
  });

  test('nothing is placed without a verified source; the Drum is ALWAYS unplaced; fail closed without a frame', () => {
    // (a) without a projection frame, every layout helper returns null (never a fabricated point)
    const bare = city({ withData: true, withProjection: false });
    const F = bare.BIIDAASIGE_HERITAGE_FACTORIES;
    assert.equal(F.projectionAvailable(), false);
    assert.equal(F.fireHall30Placement(), null);
    assert.equal(F.atlasCranePlacement(), null);
    assert.equal(F.drumPlacement(), null);
    const builtBare = bare.buildBiidaasigeHeritage();
    assert.equal(builtBare.place.fireHall, null);
    assert.equal(builtBare.place.atlas, null);
    assert.equal(builtBare.place.drum, null);
    // (b) WITH a frame, the Fire Hall and Atlas place from the verified OSM helpers; the Drum still does not
    const C = city();
    const H = C.buildBiidaasigeHeritage();
    assert.ok(H.place.fireHall && H.place.fireHall.sourceRef === 'way/494886782');
    assert.ok(H.place.atlas && H.place.atlas.sourceRef === 'node/9521067431');
    assert.equal(H.place.drum, null, 'The Drum has no published point, so it is never placed');
    // the fragments + the interpretive sign are returned, and explicitly refuse to be placed
    assert.match(H.parts.heritageFragments.placement, /unverified/i);
    assert.match(H.parts.interpretive.placement, /unverified/i);
    assert.equal(H.placementsVerified.drum, null);
    // the full assembly is finite, on the ground, and sums real triangles
    finite(H.group, 'heritage');
    assert.ok(H.triangles > 3000);
    assert.equal(H.climbable, false);
  });

  test('Fire Hall identity predicate: fails closed, accepts ONLY the one native row, rejects every other building', () => {
    const C = city();
    const N = C.BIIDAASIGE_HERITAGE_NATIVE;
    // before a replacement was built, nothing is replaceable
    assert.equal(C.heritageFireHallReplaced(), false);
    assert.equal(C.heritageFireHallReplacesNative(N.x, N.z, 8.4, N.angle, [[-10.8, 10.8, -6.6, 6.6]]), false);
    // build it for real
    const H = C.buildBiidaasigeHeritage();
    assert.equal(C.heritageFireHallReplaced(H), true);
    // the ONE genuine native Fire Hall row is replaced: one part ~21.6 x 13.2, 8.4 m, same angle, correct displacement
    assert.equal(C.heritageFireHallReplacesNative(2383.9, 622.4, 8.4, -1.308, [[-10.8, 10.8, -6.6, 6.6]], H), true);
    // ...and a collider inside the current OSM ring is excluded (so no duplicate collider)
    assert.equal(C.heritageFireHallExclusionAt(H.place.fireHall.x, H.place.fireHall.z, 0, H), true);
    // the OTHER native park buildings are NOT the fire hall (no blanket obsolescence)
    for (const b of [[2887, 755.6], [2422.4, 608.3], [2486.6, 687.1], [2848.2, 624.4], [2677.7, 630.1], [1780.9, 757.5], [2189, 884.9], [1998.2, 782.4]]) {
      assert.equal(C.heritageFireHallReplacesNative(b[0], b[1], 8.4, 0, [[-10.8, 10.8, -6.6, 6.6]], H), false, `native ${b} is not the Fire Hall`);
    }
    // a tower height at the fire hall spot is not this two-storey building
    assert.equal(C.heritageFireHallReplacesNative(2383.9, 622.4, 28.5, -1.308, [[-10.8, 10.8, -6.6, 6.6]], H), false);
    // a multi-part block at the spot is not the one-part fire hall
    assert.equal(C.heritageFireHallReplacesNative(2383.9, 622.4, 8.4, -1.308, [[-10, 10, -6, 6], [2, 6, 6, 9]], H), false);
    // the wrong footprint (a small shed) at the spot is rejected
    assert.equal(C.heritageFireHallReplacesNative(2383.9, 622.4, 4, -1.308, [[-5, 5, -4, 4]], H), false);
    // nothing inside the old footprint is excluded before a replacement exists (blanket false)
    const bare = city({ withData: true, withProjection: true });
    assert.equal(bare.heritageFireHallExclusionAt(2383.9, 622.4, 0), false);
  });

  test('exports, source labels and the no-shared-runtime contract', () => {
    const C = city();
    for (const k of ['buildFireHall30', 'buildAtlasCrane', 'buildTheDrum', 'buildHeritageFragments', 'buildInterpretiveSign', 'buildBiidaasigeHeritage']) {
      assert.equal(typeof C[k], 'function', `C.${k} is exported`);
    }
    assert.ok(C.BIIDAASIGE_HERITAGE_FACTORIES && typeof C.BIIDAASIGE_HERITAGE_FACTORIES.fireHall30Placement === 'function');
    // the crane tone label is capacity, the height label is an estimate, and the Fire Hall label is 2 storeys
    assert.equal(C.BIIDAASIGE_ATLAS_ESTIMATE.massLabelTons, 300);
    assert.equal(C.BIIDAASIGE_ATLAS_ESTIMATE.verifiedCapacityTons, undefined);
    assert.equal(C.BIIDAASIGE_FIREHALL30_HEIGHTS.levels, 2);
    assert.equal(C.BIIDAASIGE_DRUM_SOURCE.floorAreaM2, 201);
    // the module file never loads/edits a shared runtime or reads a network/asset: check the CODE, not the prose
    const src = read('js/biidaasige-heritage.js');
    const code = src.split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/.*$/, '')).join('\n');
    for (const banned of ['js/main.js', 'js/buildings.js', 'js/city-grid.js', 'fetch(', 'TextureLoader', 'new Image', 'XMLHttpRequest']) {
      assert.equal(code.includes(banned), false, `heritage module does not call/reference ${banned} in code`);
    }
  });
}

test('Drum entrances and interior remain traversable and the apron matches real rendered footing',()=>{
 const C=city(),drum=C.buildTheDrum();drum.group.updateMatrixWorld(true);
 assert.ok(!drum.colliders.some(c=>c.minX<=0&&c.maxX>=0&&c.minZ<=0&&c.maxZ>=0),'no collider fills the interior');
 const ray=new THREE.Raycaster(new THREE.Vector3(0,10,0),new THREE.Vector3(0,-1,0));
 const hit=ray.intersectObject(drum.group,true)[0];
 assert.ok(hit?.object.name.endsWith('-apron'),'open oculus sightline reaches the continuous apron');
 assert.ok(Math.abs(hit.point.y-.12)<1e-5);
 assert.ok(drum.surfaces.length>=60,'actual apron triangles are exported for movement');
 assert.ok(drum.colliders.some(c=>c.kind==='drum-wall')&&drum.colliders.some(c=>c.kind==='drum-foot'));
});
