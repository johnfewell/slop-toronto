// Biidaasige Park timber play infrastructure (js/biidaasige-play-infrastructure.js, bead st-bmyv.9).
// Focused CPU geometry checks (the captain runs the GPU review on the Mac mini). These load the ACTUAL module into a
// small CITY and prove, from the REAL built THREE geometry:
//
//   1. The Cableway is the published 20/40 m only — any other length is REFUSED (no invented length), the long axis is
//      +X (the ortho contract), the A-frames are at ±length/2, and the raised ground is a real, bounded 0..0.45 m.
//   2. Every returned triangle in `surfaces` is upward (+Y) wound, real, and agrees with an INDEPENDENT three.js
//      downward raycast (query == drawn height), matching the ortho contract's "exact rendered ground-top triangles".
//   3. The A-frames are SOLID (real post colliders) but the corridor CENTRE LINE is CLEAR (no giant box across it), and
//      a ground finish is never a collider.
//   4. Two Swing Hill pad variants (north / south) with caller-configured 1/2 seats and a basket-seat variant, marked
//      estimated.
//   5. The SIX-unit WholeTrees inverted-trident cluster builds as tall ~5-6 m pale trunks with EMPTY central arches
//      (a horizontal ray crosses below the fork; a downward ray hits the tall trunk), slender bounded colliders, and
//      NOTHING is placed in a scene.
//   6. Merged meshes keep the draw-call budget under 10 per setup, and no geometry is NaN.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MODULE = fs.readFileSync(new URL('../js/biidaasige-play-infrastructure.js', import.meta.url), 'utf8');

function city({ withMerge = true } = {}) {
  const Addons = {};
  if (withMerge) Addons.mergeGeometries = mergeGeometries;
  const CITY = { THREE, Addons };
  const ctx = { window: { CITY }, console: { info() {}, warn() {}, log() {}, error() {} }, performance };
  vm.createContext(ctx);
  vm.runInContext(MODULE, ctx, { filename: 'biidaasige-play-infrastructure.js' });
  return CITY;
}

function finite(group) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    assert.ok(p, `${o.name} has positions`);
    for (let i = 0; i < p.count; i++) {
      assert.ok(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i)), `${o.name} has finite positions`);
    }
  });
}
const upWind = (T) => (T[3] - T[0]) * (T[8] - T[2]) - (T[5] - T[2]) * (T[6] - T[0]) > 0; // (bz-az)(cx-ax) - (cz-az)(bx-ax) style
function triNormalY(T) {
  const ux = T[3] - T[0], uy = T[4] - T[1], uz = T[5] - T[2];
  const vx = T[6] - T[0], vy = T[7] - T[1], vz = T[8] - T[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return ny / (Math.hypot(nx, ny, nz) || 1);
}

// ---------------------------------------------------------------------------------------------------------------------
test('the cableway accepts ONLY the published 20/40 m runs and refuses every other length', () => {
  const C = city();
  assert.deepEqual(Array.from(C.BIIDAASIGE_CABLEWAY_LENGTHS_M), [20, 40]);
  for (const n of [20, 40]) {
    const c = C.buildBiidaasigeCableway(n);
    assert.equal(c.lengthM, n);
    assert.equal(c.longAxis, 'x', 'the ortho contract: local long axis is +X');
    assert.equal(c.placementStatus, 'unplaced');
    assert.equal(c.group.parent, null, 'never added to a scene by default');
    finite(c.group);
  }
  // a call with an explicit invalid length throws a RangeError (checked by name: a vm realm has its own RangeError)
  const refused = (v) => {
    try { C.buildBiidaasigeCableway(v); return false; }
    catch (e) { return e && e.name === 'RangeError'; }
  };
  for (const bad of [undefined, 0, 10, 21, 33, 39, 50, 'twenty', NaN]) {
    assert.equal(refused(bad), true, `lengthM ${bad} is refused`);
  }
});

test('the A-frames stand at ±length/2 with the photo proportions (4 m high, 0.23 m legs, 4 m spread)', () => {
  const C = city();
  const n = 40;
  const c = C.buildBiidaasigeCableway(n, { spec: { boulderCount: 0 } });   // no boulders so the height bounds are clean
  // the frame apexes are the tallest timber; the built height is ~4 m
  const box = new THREE.Box3().setFromObject(c.group);
  assert.ok(box.max.y > 3.6 && box.max.y < 4.6, `apex ~4 m (built ${box.max.y.toFixed(2)} m)`);
  assert.ok(box.min.x <= -n / 2 + 0.01 && box.max.x >= n / 2 - 0.01, `the corridor spans the full ${n} m (x ${box.min.x.toFixed(1)}..${box.max.x.toFixed(1)})`);
  // the four leg colliders stand at x = ±n/2, z = ±2 (the 4 m foot spread)
  const xs = [...new Set(c.colliders.map((k) => ((k.minX + k.maxX) / 2).toFixed(2)))].sort();
  const zs = [...new Set(c.colliders.map((k) => ((k.minZ + k.maxZ) / 2).toFixed(2)))].sort();
  assert.deepEqual(xs, [(-n / 2).toFixed(2), (n / 2).toFixed(2)]);
  assert.deepEqual(zs, ['-2.00', '2.00']);
});

test('the raised ground is a real, bounded 0..0.45 m (photo estimate), never a global height field', () => {
  const C = city();
  for (const n of [20, 40]) {
    const c = C.buildBiidaasigeCableway(n);
    assert.ok(c.raisedGroundMaxM > 0.1 && c.raisedGroundMaxM <= 0.45, `raised ground ${c.raisedGroundMaxM.toFixed(3)} m within 0..0.45`);
    // every rendered rubber/stone triangle lies at or below that bound and at or above the datum
    for (const s of c.surfaces) {
      for (let i = 1; i < 9; i += 3) {
        assert.ok(s.triangle[i] >= -1e-6 && s.triangle[i] <= 0.45 + 1e-6, 'corridor surface within 0..0.45 m');
      }
    }
  }
  // a boulder (which sits above the corridor) must NOT be reported as walkable ground
  const c = C.buildBiidaasigeCableway(20);
  assert.ok(c.surfaces.every((s) => !/boulder|steel|greyTimber/.test(s.kind)), 'only ground finishes are walkable surfaces');
});

test('every surface triangle is upward-wound, and the query equals an INDEPENDENT three.js raycast', () => {
  const C = city();
  const c = C.buildBiidaasigeCableway(20);
  assert.ok(c.surfaces.length > 100, 'the cableway returns a real ground-top triangle set');
  for (const s of c.surfaces) assert.ok(triNormalY(s.triangle) > 0.3, 'each returned triangle faces up');

  // Build a real scene from the group and raycast straight down; the module's query must agree with the highest hit
  // among the CORRIDOR meshes (the rubber/stone bands), which are the only walkable surfaces it reports.
  const scene = new THREE.Scene();
  scene.add(c.group);
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  let checked = 0, worst = 0;
  const span = c.lengthM;
  for (let i = 0; i < 500 && checked < 160; i++) {
    const x = -span / 2 - 1 + (span + 2) * ((i * 0.618) % 1);
    const z = -2.4 + 4.8 * ((i * 0.754 + 0.13) % 1);
    const q = c.surfaceHeightAt(x, z);
    ray.set(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(c.group, true)
      .filter((h) => /-(rubber|rubberCream|stone)$/.test(h.object.name))
      .sort((a, b) => b.point.y - a.point.y)[0];
    if (!q && !hit) continue;
    if (!q || !hit) continue;                 // the surfacing edge bands differ; only compare where both answer
    worst = Math.max(worst, Math.abs(q.h - hit.point.y));
    checked++;
  }
  assert.ok(checked > 60, `enough comparable samples (${checked})`);
  assert.ok(worst < 0.02, `query height == drawn height within 2 cm over the corridor (worst ${worst.toFixed(4)} m)`);
});

test('the A-frame legs are SOLID props, but the corridor centre line is CLEAR (no giant box)', () => {
  const C = city();
  const c = C.buildBiidaasigeCableway(20);
  assert.ok(c.colliders.length >= 4, 'each leg is a solid post collider');
  for (const k of c.colliders) assert.equal(k.prop, true, 'colliders are prop:true');
  // nothing solid covers the corridor centre line (z = 0) between the frames
  for (let x = -9.0; x <= 9.0; x += 0.5) {
    const blocked = c.colliders.some((k) => x >= k.minX && x <= k.maxX && 0 >= k.minZ && 0 <= k.maxZ);
    assert.equal(blocked, false, `corridor centre is clear at x=${x}`);
  }
  // the legs themselves do stop the body (a point at a leg centre is inside a collider box)
  const legHit = c.colliders.some((k) => -10 >= k.minX && -10 <= k.maxX && ((k.minZ + k.maxZ) / 2) >= 1.5 && ((k.minZ + k.maxZ) / 2) <= 2.5);
  assert.ok(legHit, 'a leg centre is a solid collider');
  // the ground finish is not a collider (no collider spans the whole corridor)
  assert.ok(c.colliders.every((k) => (k.maxX - k.minX) < 3 && (k.maxZ - k.minZ) < 3), 'no giant corridor-wide box');
});

// ---------------------------------------------------------------------------------------------------------------------
test('Swing Hill: two pad variants (north/south), caller-configured 1/2 seats and a basket variant, marked estimated', () => {
  const C = city();
  const one = C.buildBiidaasigeSwingSet({ swingCount: 1, pad: 'north' });
  const two = C.buildBiidaasigeSwingSet({ swingCount: 2, pad: 'south' });
  const basket = C.buildBiidaasigeSwingSet({ seats: ['flat', 'basket'] });
  assert.equal(one.swingCount, 1); assert.equal(one.pad, 'north');
  assert.equal(two.swingCount, 2); assert.equal(two.pad, 'south');
  assert.deepEqual(basket.seats, ['flat', 'basket']);
  for (const s of [one, two, basket]) {
    assert.equal(s.placementStatus, 'unplaced');
    assert.equal(s.group.parent, null);
    assert.match(s.swingCountBasis, /ESTIMATED/i);
    finite(s.group);
    assert.ok(s.colliders.length >= 4, 'A-frame legs are solid');
    assert.ok(s.colliders.every((k) => k.prop === true));
  }
  // the basket seat adds real geometry over the flat 2-seat frame
  assert.ok(basket.triangles > two.triangles, 'the basket seat is real geometry, not a label');
  assert.ok(basket.surfaceHeightAt(0, 0), 'the woodchip apron is a queryable ground finish');
});

// ---------------------------------------------------------------------------------------------------------------------
test('WholeTrees timber cluster: SIX ~5-6 m pale trunks, three flared branches, photo proportions', () => {
  const C = city();
  const S = C.BIIDAASIGE_TIMBER_SPEC;
  assert.equal(S.unitCount, 6, 'six inverted-trident units (primary photo)');
  assert.equal(S.forkHeightM, 2.3, 'fork ~2.3 m (photo)');
  assert.equal(S.topHeightM, 5.4, 'flat cut top ~5.4 m (photo)');
  assert.equal(S.footSpreadM, 3.0, 'flared feet ~3 m spread (photo)');
  assert.equal(S.archClearM, 2.0, 'walk-through arch ~2 m (photo)');
  assert.ok(S.upperTrunkDiameterMinM >= 0.35 && S.upperTrunkDiameterMaxM <= 0.45, 'slender upper trunk .35-.45 m');

  const t = C.buildBiidaasigeInvertedTrees();
  assert.equal(t.unitCount, 6, 'the exported factory builds six units by default');
  assert.equal(t.placementStatus, 'unplaced');
  assert.equal(t.group.parent, null, 'never added to a scene');
  finite(t.group);
  // the cluster height is ~5-6 m, NOT a 2.4 m cone
  assert.ok(t.maxHeightM > 5.0 && t.maxHeightM < 6.1, `tall cluster ${t.maxHeightM.toFixed(2)} m (5-6 m)`);
  for (const u of t.layout) assert.ok(u.heightM >= 5.0 && u.heightM <= 6.0, `unit height ${u.heightM} in 5-6 m`);
  // compact footprint, ~5 m across x ~8 m along (not a generic huge ring)
  const box = new THREE.Box3().setFromObject(t.group);
  assert.ok((box.max.x - box.min.x) <= 9 && (box.max.z - box.min.z) <= 11, `compact cluster ${(box.max.x - box.min.x).toFixed(1)} x ${(box.max.z - box.min.z).toFixed(1)} m`);
  // only the woodchip island is a queryable ground finish; the cluster is NOT a floor
  assert.ok(t.surfaces.length > 0 && t.surfaces.every((s) => /woodchip/.test(s.kind)), 'only the woodchip finish is walkable');
  // ORGANIC: each upper stem leans/bends .15-.35 m with height (not a straight robotic pipe), and the reported top
  // moves off the unit centre accordingly
  for (const u of t.layout) {
    assert.ok(u.upperLeanM >= 0.15 && u.upperLeanM <= 0.35, `unit lean ${u.upperLeanM.toFixed(2)} m in .15-.35`);
    const off = Math.hypot(u.upperTop.x - u.x, u.upperTop.z - u.z);
    assert.ok(off > 0.10, `unit top is offset from its base (${off.toFixed(2)} m)`);
  }
  // the same four material buckets (no wild geometry/draw-call growth)
  assert.deepEqual(Array.from(t.drawCalls.map((d) => d.key)).sort(), ['paleOak', 'paleOakEnd', 'paleOakShade', 'woodchip']);
});

test('the cluster colliders are slender: branch/feet + upper trunk only, no cylinder in the central arch', () => {
  const C = city();
  const t = C.buildBiidaasigeInvertedTrees();
  // no group AABB and no giant box exists
  for (const k of t.colliders) {
    assert.equal(k.prop, true);
    assert.ok((k.maxX - k.minX) < 1.2 && (k.maxZ - k.minZ) < 1.2, 'each collider is slender (a foot/branch/trunk)');
  }
  // no collider covers a tree's central arch space at trunk height 0..fork for every unit
  for (const u of t.layout) {
    const blocksCentre = t.colliders.some((k) => u.x >= k.minX && u.x <= k.maxX && u.z >= k.minZ && u.z <= k.maxZ && k.maxY <= 2.3);
    assert.equal(blocksCentre, false, `unit at (${u.x},${u.z}) has no solid below the fork at its centre`);
  }
  assert.deepEqual([...new Set(t.colliders.map((k) => k.kind))].sort(),
    ['inverted-tree-branch-foot', 'inverted-tree-upper-trunk']);
  // the upper-trunk colliders FOLLOW the bent stem: for a leaning unit, at least one upper-trunk collider is offset
  // from the base centre (no single box spanning the empty space beside the lean)
  for (const u of t.layout) {
    const upper = t.colliders.filter((k) => k.kind === 'inverted-tree-upper-trunk' &&
      Math.hypot((k.minX + k.maxX) / 2 - u.x, (k.minZ + k.maxZ) / 2 - u.z) < 1.0);
    assert.ok(upper.length >= 2, 'the upper trunk is collided in segments');
    const maxOff = Math.max(...upper.map((k) => Math.hypot((k.minX + k.maxX) / 2 - u.x, (k.minZ + k.maxZ) / 2 - u.z)));
    assert.ok(maxOff > 0.10, `upper-trunk colliders follow the lean (max offset ${maxOff.toFixed(2)} m)`);
  }
});

test('the cluster geometry is real: a downward ray hits the tall trunk, a side ray crosses a central arch clear', () => {
  const C = city();
  // a single isolated unit first: a horizontal ray at arch height crosses clear below the fork
  const one = C.buildBiidaasigeInvertedTrees({ layout: [{ x: 0, z: 0, yaw: 0, heightM: 5.4 }] });
  const scene = new THREE.Scene();
  scene.add(one.group);
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.set(new THREE.Vector3(-5, 1.4, 0), new THREE.Vector3(1, 0, 0));
  const side = ray.intersectObject(one.group, true).filter((h) => !/-woodchip/.test(h.object.name));
  assert.equal(side.length, 0, 'the central arch below the fork is CLEAR (no solid trunk 0..fork)');
  // a downward ray finds the tall upper trunk geometry (real, drawn, tall). The stem leans, so aim at the ACTUAL
  // reported upper-top position, not the original base centre.
  const top = one.layout[0].upperTop;
  ray.set(new THREE.Vector3(top.x, 20, top.z), new THREE.Vector3(0, -1, 0));
  const down = ray.intersectObject(one.group, true).filter((h) => !/-woodchip/.test(h.object.name));
  assert.ok(down.length > 0 && down[0].point.y > 5.0, `a downward ray hits the ~5.4 m trunk (y ${down[0]?.point.y.toFixed(2)})`);

  // the full six-unit cluster: each unit's upper trunk is hit from above at 5-6 m
  const t = C.buildBiidaasigeInvertedTrees();
  const scene2 = new THREE.Scene(); scene2.add(t.group); scene2.updateMatrixWorld(true);
  for (const u of t.layout) {
    // aim at the reported upper-top (the stem leans), not the base centre
    ray.set(new THREE.Vector3(u.upperTop.x, 20, u.upperTop.z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(t.group, true).filter((h) => !/-woodchip/.test(h.object.name));
    assert.ok(hits.length > 0, `unit (${u.x},${u.z}) trunk is real geometry at its reported top`);
    assert.ok(hits[0].point.y >= 5.0, `unit trunk reaches 5-6 m (top ${hits[0].point.y.toFixed(2)})`);
  }
});

test('the no-mergeGeometries fallback still builds finite geometry for every factory', () => {
  const C = city({ withMerge: false });
  const c = C.buildBiidaasigeCableway(20);
  const s = C.buildBiidaasigeSwingSet({ swingCount: 2 });
  const t = C.buildBiidaasigeTimberPlay();
  for (const r of [c, s, t]) { assert.ok(r && r.triangles > 0); finite(r.group); }
});

test('merged meshes keep the draw-call budget under 10 per setup', () => {
  const C = city();
  for (const r of [C.buildBiidaasigeCableway(20), C.buildBiidaasigeCableway(40), C.buildBiidaasigeSwingSet(), C.buildBiidaasigeTimberPlay()]) {
    assert.ok(r.drawCalls.length < 10, `draw calls ${r.drawCalls.length} < 10`);
  }
});

test('surfaceHeightAt is exact on the query, null off the surfaces, and never clamps a too-high step', () => {
  const C = city();
  const c = C.buildBiidaasigeCableway(20);
  // off the corridor -> null
  assert.equal(c.surfaceHeightAt(0, 40), null, 'far off is null');
  assert.equal(c.surfaceHeightAt(50, 0), null, 'past the corridor end is null');
  // find a real surface point and confirm the baseY/maxRise gate returns null when the step is too high
  let hit = null;
  for (let x = -9; x <= 9 && !hit; x += 0.25) hit = c.surfaceHeightAt(x, 1.2);
  assert.ok(hit, 'an inside point answers');
  const gated = c.surfaceHeightAt(hit.x, hit.z, { baseY: hit.h - 1, maxRise: 0.05 });
  assert.equal(gated, null, 'a too-high step returns null (not a clamped fake)');
  const bare = c.surfaceHeightAt(hit.x, hit.z);
  assert.ok(bare && Math.abs(bare.h - hit.h) < 1e-9, 'the bare query is height-independent and exact');
});
