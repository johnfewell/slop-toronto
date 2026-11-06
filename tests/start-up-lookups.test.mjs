// The start-up lookups' shortcuts (st-9u14: the Eglinton map's ready time) answer exactly as the plain tests they
// stand in for: city-config.js waterAt's raster of 32 m cells against every water body's outline, blockAt's banded
// outlines against pointInPoly. On today's map and the Eglinton frame, at random points and along the shores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCity } from '../tools/frames/road-network-bench.mjs';

function check(C, label) {
  const { DETAIL } = { DETAIL: C.GEO.frame.detail };
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const pts = [];
  for (let i = 0; i < 120000; i++) pts.push([DETAIL.x0 + rnd() * (DETAIL.x1 - DETAIL.x0), DETAIL.z0 + rnd() * (DETAIL.z1 - DETAIL.z0)]);
  // and close to the shores and the curbs, where the shortcuts hand over to the full test
  for (const w of C.WATER_BODIES) for (const p of w.pts.filter((_, i) => i % 7 === 0)) pts.push([p.x + (rnd() - 0.5) * 40, p.z + (rnd() - 0.5) * 40]);
  for (const b of C.BLOCKS.filter((_, i) => i % 23 === 0)) for (const p of b.poly) pts.push([p.x + (rnd() - 0.5) * 6, p.z + (rnd() - 0.5) * 6]);
  const inWater = (w, x, z) => x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ && C.pointInPoly(w.pts, x, z) &&
    !w.holes.some((h) => x > h.minX && x < h.maxX && z > h.minZ && z < h.maxZ && C.pointInPoly(h.pts, x, z));
  let water = 0, blocks = 0;
  for (const [x, z] of pts) {
    const w = C.waterAt(x, z);
    const ref = C.WATER_BODIES.filter((v) => inWater(v, x, z));
    assert.ok(w ? ref.includes(w) : ref.length === 0, `${label} waterAt(${x}, ${z})`);
    if (w) water++;
    const b = C.blockAt(x, z);
    if (b) {
      blocks++;
      assert.ok(b.rect || C.pointInPoly(b.poly, x, z), `${label} blockAt(${x}, ${z}) is in its block`);
    } else {
      assert.ok(!C.BLOCKS.some((k) => !k.rect && x >= k.minX && x <= k.maxX && z >= k.minZ && z <= k.maxZ && C.pointInPoly(k.poly, x, z) && !k.median),
        `${label} blockAt(${x}, ${z}) misses no block`);
    }
  }
  assert.ok(water > 1000 && blocks > 10000, `${label}: ${water} in water, ${blocks} on blocks`);
}

test('waterAt and blockAt answer as the full tests do, on today\'s map', async () => check(await loadCity(), 'today'));
test('and on the Eglinton frame', async () => check(await loadCity('eglinton'), 'eglinton'));
