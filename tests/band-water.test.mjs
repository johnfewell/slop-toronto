// st-bz1o.13: on the Eglinton map the far band's terrain floor (js/terrain.js BAND_FLOOR, just under the street level)
// stood above the water's level, so the band's ponds and rivers (Taddle Creek Pond, the Humber above the Queensway)
// were drawn under it. The near terrain's drawn height (terrainNearHeightAt) is under the water wherever there is water
// in the band and the relief around it is under 3 m (a real hill by the water still shows, as on today's map); away from the water the floor is as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.core.js';
import { loadCity } from '../tools/frames/road-network-bench.mjs';

test('the band\'s floor is under the water of its ponds and rivers, and as before away from them', async () => {
  const C = await loadCity('eglinton', { extra: ['js/terrain.js'], CITY: { createTerrainMaterial: () => new THREE.MeshBasicMaterial() } });
  assert.ok(C.FAR_BAND, 'the Eglinton frame has a far band');
  C.buildTerrain(new THREE.Scene());
  const level = C.CITY_BOUNDS.waterLevel;
  let samples = 0, dry = 0;
  const bodies = C.AREAS.filter((a) => a.kind === 'water' && (a.maxX - a.minX) * (a.maxZ - a.minZ) < 2e7);
  const named = new Set();
  for (const w of bodies) {
    for (let x = w.minX + 2; x < w.maxX; x += 8) for (let z = w.minZ + 2; z < w.maxZ; z += 8) {
      if (!C.FAR_BAND.inBand(x, z) || !C.pointInPoly(w.pts, x, z)) continue;
      // (the 60 m corners round the point under 3 m of relief: the floor's own cells, not a hill's)
      // (and inside the band: the terrain beyond the frame's edge is the land around the map, not the band's floor)
      const xa = Math.floor(x / 60) * 60, za = Math.floor(z / 60) * 60;
      if ([[0, 0], [60, 0], [0, 60], [60, 60]].some(([a, b]) => C.terrainRawAt(xa + a, za + b) >= 3 || !C.FAR_BAND.inBand(xa + a, za + b))) continue;
      samples++;
      if (w.name) named.add(w.name);
      assert.ok(C.terrainNearHeightAt(x, z) < level, `${w.name || 'water'} at ${Math.round(x)}, ${Math.round(z)}: the floor under the water`);
    }
  }
  assert.ok(samples > 500 && named.has('Taddle Creek Pond'), `${samples} points in the band's water`);
  // away from the water: the floor just under the street level, as before (a block north of Bloor, no water near)
  for (const [x, z] of [[400, -4200], [-3000, -5200], [5000, -2000]]) {
    if (C.waterAt(x, z)) continue;
    dry++;
    assert.ok(Math.abs(C.terrainNearHeightAt(x, z) + 0.6) < 0.01, `the floor at ${x}, ${z}`);
  }
  assert.ok(dry >= 2);
});
