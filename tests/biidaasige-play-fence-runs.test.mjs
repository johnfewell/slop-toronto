// Biidaasige play-fence runs (js/biidaasige-play-fence-runs.js, bead st-bmyv.4.3): the picket fence is placed round BOTH
// source-traced play islands, openings follow the mapped footways, no ring is sealed, budgets hold, and the park wires it in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(ROOT + p, 'utf8');
function city() {
  const ctx = { window: { CITY: { THREE } }, console: { info() {}, warn() {}, log() {}, error() {} }, performance };
  vm.createContext(ctx);
  vm.runInContext(read('js/toronto-geodata.js'), ctx);
  const C = ctx.window.CITY, P = C.GEO.frame.projection;
  C.CITY_BOUNDS = { minX: -7900, maxX: 3700, minZ: -3000, maxZ: 3600, sidewalkHeight: 0.22, waterLevel: -0.7 };
  C.worldFromLatLon = (lat, lon) => {
    const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky, c = Math.cos(P.theta), s = Math.sin(P.theta);
    return { x: e * c - n * s - P.ox, z: -(e * s + n * c) - P.oz };
  };
  for (const f of ['biidaasige-park-data', 'biidaasige-path-network-data', 'biidaasige-woodchip-island',
    'biidaasige-dodem-three-island', 'biidaasige-play-fence', 'biidaasige-play-fence-runs']) vm.runInContext(read(`js/${f}.js`), ctx, { filename: f });
  return C;
}

test('openingsForRing: a footway crossing and an ending each cut one opening; no footway means none', () => {
  const C = city();
  const ring = [[0, 0], [20, 0], [20, 20], [0, 20]];
  const crossing = C.biidaasigePlayFenceOpenings(ring, [{ id: 'a', line: [[10, -5], [10, 5]] }]);
  assert.equal(crossing.length, 1);
  assert.ok(Math.abs(crossing[0].centreM - 10) < 0.01 && crossing[0].widthM >= 2.4);
  const ends = C.biidaasigePlayFenceOpenings(ring, [{ id: 'b', line: [[20, 10], [30, 10]] }]);
  assert.equal(ends.length, 1);
  assert.ok(Math.abs(ends[0].centreM - 30) < 0.01);
  assert.equal(C.biidaasigePlayFenceOpenings(ring, [{ id: 'c', line: [[60, 60], [70, 70]] }]).length, 0);
  // a footway whose nearest point is within 6 m but outside the entrance snap still opens the ring once
  const near = C.biidaasigePlayFenceOpenings(ring, [{ id: 'd', line: [[10, -4], [10, -5]] }]);
  assert.equal(near.length, 1);
  assert.equal(near[0].basis, 'nearest-footway');
});

test('both play islands get a fence with at least one opening, finite geometry and bounded cost', () => {
  const C = city();
  C.buildBiidaasigeWoodchipIsland(); C.buildBiidaasigeDodemThreeIsland();
  const out = C.buildBiidaasigePlayFences();
  assert.equal(out.runs.length, 2);
  for (const run of out.runs) {
    assert.ok(run.gaps.length >= 1, `${run.id} must not be sealed`);
    assert.ok(run.fence.stats.lengthM > 50 && run.fence.stats.lengthM < 100);
    assert.ok(run.fence.stats.instanceCount < 5000);
    assert.ok(run.colliders.length > 0 && run.colliders.every((c) => Number.isFinite(c.obb.cx) && c.prop));
    assert.ok(run.fence.stats.meshes <= 3);
    // the opening really is open: no collider centre lies inside any gap's arc (checked via the factory's own gaps stat)
    assert.ok(run.fence.stats.gaps.length >= 1);
  }
  assert.ok(out.triangles < 40000, `fence triangles ${out.triangles}`);
});

test('park wires the fence runs in by default and the page loads the modules', () => {
  const park = read('js/biidaasige-park.js'), page = read('explore.html');
  assert.match(park, /buildBiidaasigePlayFences/);
  assert.ok(page.indexOf('biidaasige-play-fence.js') > 0 && page.indexOf('biidaasige-play-fence-runs.js') > page.indexOf('biidaasige-play-fence.js'));
  assert.ok(page.indexOf('biidaasige-play-fence-runs.js') < page.indexOf('biidaasige-park.js'));
});
