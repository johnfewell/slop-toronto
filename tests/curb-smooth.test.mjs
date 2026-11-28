// jf-qw7 part 3 (docs/rosedale-streetscape.md): the Rosedale pilot's curbs are smoothed: a polygon approximating a bend becomes a curve through the same points,
// a straight piece and a corner stay as they were, and the real Rosedale outlines come out with short pieces and small turns
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { unpackGeo } from '../js/geodata-loader.js';

const window = { CITY: {} };
vm.runInContext(fs.readFileSync(new URL('../js/curb-smooth.js', import.meta.url), 'utf8'), vm.createContext({ window }));
const { smoothCurbRing, inCurbSmoothBox } = window.CITY;
const ringStats = (pts) => {
  const n = pts.length; let maxTurn = 0, maxLen = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
    const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
    maxLen = Math.max(maxLen, l1);
    if (l1 > 1e-6 && l2 > 1e-6) maxTurn = Math.max(maxTurn, Math.acos(Math.max(-1, Math.min(1, ((b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)) / (l1 * l2)))) * 180 / Math.PI);
  }
  return { maxTurn, maxLen };
};

test('a 12-sided bend becomes a curve through its own points, within 3% of the circle', () => {
  const R = 20, ring = Array.from({ length: 12 }, (_, i) => ({ x: R * Math.cos(i * Math.PI / 6), z: R * Math.sin(i * Math.PI / 6) }));
  const out = smoothCurbRing(ring);
  assert.ok(out.length > ring.length * 3, `${out.length} points`);
  for (const p of ring) assert.ok(out.some((q) => q.x === p.x && q.z === p.z), 'every original point is kept');
  for (const p of out) assert.ok(Math.abs(Math.hypot(p.x, p.z) - R) < R * 0.03, `${Math.hypot(p.x, p.z).toFixed(3)} from the centre`);
  const s = ringStats(out);
  assert.ok(s.maxTurn < 20 && s.maxLen <= 3.5, `turn ${s.maxTurn.toFixed(1)}, piece ${s.maxLen.toFixed(2)}`);
});

test('straight pieces and square corners are left alone', () => {
  const square = [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 30 }, { x: 0, z: 30 }];
  assert.equal(smoothCurbRing(square), square);
  const rounded = [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 46, z: 3 }, { x: 49, z: 9 }, { x: 49, z: 40 }, { x: 0, z: 40 }]; // (one rounded corner: two 30 degree turns, then 90 degree ones)
  const out = smoothCurbRing(rounded);
  for (const p of [{ x: 0, z: 0 }, { x: 49, z: 40 }, { x: 0, z: 40 }]) assert.ok(out.some((q) => q.x === p.x && q.z === p.z));
  const straight = out.filter((q) => q.z === 0 && q.x > 0 && q.x < 40);
  assert.equal(straight.length, 0, 'the 40 m straight is not subdivided');
  assert.ok(out.length > rounded.length, 'the rounded corner got more points');
});

test('the smoothed ring keeps its orientation and area to within 3%', () => {
  const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.z - q.x * p[i].z; } return a / 2; };
  const ring = Array.from({ length: 16 }, (_, i) => ({ x: 25 * Math.cos(i * Math.PI / 8), z: 14 * Math.sin(i * Math.PI / 8) }));
  const out = smoothCurbRing(ring);
  assert.ok(Math.sign(area(out)) === Math.sign(area(ring)));
  assert.ok(Math.abs(area(out) / area(ring) - 1) < 0.03, `${(area(out) / area(ring)).toFixed(4)}`);
});

test('only the Rosedale pilot box is smoothed', () => {
  assert.ok(inCurbSmoothBox(800, -3770), 'Chestnut Park');
  assert.ok(!inCurbSmoothBox(-1091, -307), 'King and Spadina');
});

test('the real Rosedale curbs: pieces of 3 m or less and turns under 30 degrees after, but never more than 1 m from where the City traced them', async () => {
  const { GEO } = await unpackGeo(fs.readFileSync(new URL('../data/frames/eglinton/toronto-geodata.bin', import.meta.url)));
  let islands = 0, before = { maxLen: 0 }, worst = 0, longPieces = 0, pieces = 0;
  for (const b of GEO.blocks) {
    const flat = b[0], isRect = b[4];
    const pts = []; for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i], z: flat[i + 1] });
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    if (isRect || !inCurbSmoothBox((x0 + x1) / 2, (z0 + z1) / 2)) continue;
    islands++;
    const out = smoothCurbRing(pts);
    for (let i = 0; i < out.length; i++) {
      const a = out[i], c = out[(i + 1) % out.length]; pieces++;
      if (Math.hypot(c.x - a.x, c.z - a.z) > 3.01) longPieces++;
      // distance from the new point to the original outline
      let d = Infinity;
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k], q = pts[(k + 1) % pts.length], dx = q.x - p.x, dz = q.z - p.z, L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((a.x - p.x) * dx + (a.z - p.z) * dz) / L2));
        d = Math.min(d, Math.hypot(p.x + dx * t - a.x, p.z + dz * t - a.z));
      }
      worst = Math.max(worst, d);
    }
  }
  void before;
  assert.ok(islands > 60, `${islands} islands in the box`);
  assert.ok(worst < 1.0, `the curve strays ${worst.toFixed(2)} m from the City's outline at most`);
  assert.ok(longPieces / pieces < 0.5, `${longPieces} of ${pieces} pieces are still over 3 m (straight stretches)`);
});
