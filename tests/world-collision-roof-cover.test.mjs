// js/world-collision.js roofCover rasterises each (nearly) level roof face over the cells whose centres lie in it. It looks, row by row, only at the
// cells that can pass the three half-plane tests; it must flag exactly the cells a test of every cell in the face's box flags.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const window = { CITY: {} };
const ctx = vm.createContext({ window, Math, Infinity, Uint8Array, Float32Array, Map, Set, Number, Object, Array, performance });
vm.runInContext(fs.readFileSync(new URL('../js/world-collision.js', import.meta.url), 'utf8'), ctx);
const { roofCover } = window.CITY.WorldCollision;

// the rasteriser as it was: every cell in each face's box
function reference(tris, roofFrom, x0, z0, cell, W, H) {
  const roof = new Uint8Array(W * H);
  let roofCells = 0;
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2], bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5], cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
    if (Math.min(ay, by, cy) < roofFrom || Math.max(ay, by, cy) > roofFrom + 150) continue;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (l < 1e-9 || Math.abs(ny) / l < 0.3) continue;
    const gx0 = Math.floor((Math.min(ax, bx, cx) - x0) / cell), gx1 = Math.floor((Math.max(ax, bx, cx) - x0) / cell);
    const gz0 = Math.floor((Math.min(az, bz, cz) - z0) / cell), gz1 = Math.floor((Math.max(az, bz, cz) - z0) / cell);
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
      const k = gz * W + gx;
      if (roof[k]) continue;
      const px = x0 + (gx + 0.5) * cell, pz = z0 + (gz + 0.5) * cell;
      const d1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax), d2 = (cx - bx) * (pz - bz) - (cz - bz) * (px - bx), d3 = (ax - cx) * (pz - cz) - (az - cz) * (px - cx);
      if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) { roof[k] = 1; roofCells++; }
    }
  }
  return { roof, roofCells };
}

test('roofCover flags the very cells a test of every cell in the face\'s box does', () => {
  let seed = 4242; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const [cell, size, count] of [[0.15, 30, 400], [0.5, 150, 400], [0.0625, 6, 300], [1, 900, 200]]) {
    const W = Math.ceil(size / cell) + 7, H = W, x0 = 1200.37 - cell * 3, z0 = -840.91 - cell * 3;
    const tris = [];
    const pt = () => [x0 + cell * 3 + rnd() * size, 0, z0 + cell * 3 + rnd() * size];
    for (let t = 0; t < count; t++) {
      const y = 12 + rnd() * 40, kind = t % 6;
      let a = pt(), b = pt(), c = pt();
      if (kind === 1) { b = [a[0] + rnd() * size * 0.05, 0, a[2] + (rnd() - 0.5) * 1e-4]; }          // a sliver along x
      if (kind === 2) { b = [a[0] + (rnd() - 0.5) * 1e-4, 0, a[2] + rnd() * size * 0.05]; }          // a sliver along z
      if (kind === 3) { b = [a[0] + 1, 0, a[2] + 1]; c = [a[0] + 2, 0, a[2] + 2 + (rnd() - 0.5) * 1e-6]; } // nearly collinear
      if (kind === 4) { c = [a[0] + rnd() * 2, 0, b[2]]; }                                         // a flat edge along x
      for (const p of [a, b, c]) tris.push(p[0], y + (kind === 5 ? rnd() * 0.3 : 0), p[2]);
    }
    const mine = roofCover(new Float32Array(tris), 10, x0, z0, cell, W, H), want = reference(new Float32Array(tris), 10, x0, z0, cell, W, H);
    assert.equal(mine.roofCells, want.roofCells, `cell ${cell}: count`);
    assert.ok(mine.roofCells > 0);
    for (let i = 0; i < want.roof.length; i++) if (mine.roof[i] !== want.roof[i]) assert.fail(`cell ${cell}: grid cell ${i} differs (${mine.roof[i]} vs ${want.roof[i]})`);
  }
});
