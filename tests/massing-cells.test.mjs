// js/massing-cells.js (st-2nl.3, docs/massing-buildings.md): the ?massing=1 buildings as compact cell meshes in three
// distance tiers.
// - the near tier is the 17-float pilot format's geometry (main's createFootprintFacades, kept below as the reference)
//   vertex for vertex: every attribute the facade shaders read decodes to within float32 rounding of it
// - encode/decode bounds city-wide: corners exact on the decimetre grid, edges exact, heights from the table exact
// - the building table: every vertex finds its own building's row, in its own block and tier cell
// - the tiers: hysteresis (nextTier), the index runs a mesh draws (tierRuns), the mid tier's simplification, the boxes
// - determinism: two builds are byte for byte the same
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import * as CORE from '../vendor/three/three.core.js';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import * as MC from '../js/massing-cells.js';
import { legacyFootprintFacades as legacyFormat } from '../tools/massing-legacy-format.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const window = { CITY: {} };
vm.runInContext(read('js/toronto-geodata.js'), vm.createContext({ window, Math, JSON, Object, Array, Number, Map, Set, Float64Array, Uint8Array, WeakMap, Infinity, NaN, isFinite }));
const { GEO } = window.CITY;
const { MASSING } = await unpackGeo(fs.readFileSync(new URL('../data/toronto-massing.bin', import.meta.url)));
const loaded = massingRows(MASSING, GEO);
const WALL_KINDS = { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4 };
const f32 = Math.fround;

// Records as buildings.js makes them, from the sidecar, with every field varied (a seeded stream)
function rng(seed) { let s = seed >>> 0; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
function makeRecords(filter = () => true) {
  const r = rng(6711), out = [];
  let k = 0;
  for (const [row, m] of loaded.rows) {
    const b = GEO.buildings[row];
    if (!filter(b)) continue;
    const [cx, cz, ang, parts, h] = b;
    const base = Math.min(m.base, h - 0.5), cs = Math.cos(ang), sn = Math.sin(ang);
    const kinds = m.rings[0].map((_, i) => (m.hidden.has(i) ? -1 : m.covered.has(i) ? WALL_KINDS.lotLine : Math.floor(r() * 5)));
    out.push({
      cx, cz, style: Math.floor(r() * 5), rings: m.rings, base, h, kinds,
      cover: m.rings[0].map((_, i) => (m.covered.has(i) ? m.covered.get(i) : NaN)),
      capY: (r() < 0.5 ? h - 0.05 : h) - (row % 5) * 0.012, tone: r(), seed: k++ * 29, paint: [r(), r(), r(), r() * 3],
      boxes: parts.filter(([u0, u1, v0, v1]) => u1 - u0 >= 1 && v1 - v0 >= 1).map(([u0, u1, v0, v1]) => {
        const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
        return [cx + uc * cs + vc * sn, cz - uc * sn + vc * cs, u1 - u0, v1 - v0, ang];
      }),
      faces: [0, 1, 2, 3].map(() => Math.floor(r() * 5))
    });
  }
  return out;
}
const KENSINGTON_OR_FINANCIAL = (b) => (b[0] > -1995 && b[0] < -1117 && b[1] > -1784 && b[1] < -1218) || (Math.abs(b[0] - 100) < 350 && Math.abs(b[1] + 364) < 350);

// main's createFootprintFacades (c3a76d7): the 17-float format the cells replace
const legacyFootprintFacades = (material, records) => legacyFormat(CORE, material, records);

test('js/earcut.js is the locked earcut, unchanged', { skip: !fs.existsSync(new URL('../node_modules/earcut/src/earcut.js', import.meta.url)) && 'npm ci first' }, () => {
  const ours = read('js/earcut.js'), theirs = read('node_modules/earcut/src/earcut.js');
  assert.equal(ours.slice(ours.indexOf('/**\n * A vertex')), theirs.slice(theirs.indexOf('/**\n * A vertex')));
  assert.match(read('CREDITS.md'), /earcut/);
});

test('the near tier is the pilot format\'s geometry, vertex for vertex, to float32 rounding', () => {
  const recs = makeRecords(KENSINGTON_OR_FINANCIAL);
  assert.ok(recs.length > 800, `${recs.length} buildings`);
  const worst = { xz: 0, y: 0, normal: 0, width: 0, fromTop: 0, stored: 0 };
  let vertices = 0, wallTris = 0;
  recs.forEach((r, i) => {
    // (legacy numbered the seed by its place in the list: give it the same seed)
    const legacy = legacyFootprintFacades(new CORE.MeshBasicMaterial(), [{ ...r, seed: r.seed }]).meshes[0];
    const cells = MC.buildMassingCells(MC.packInput([r]));
    assert.equal(cells.blocks.length, 1);
    const block = cells.blocks[0], T = block.tiers[0];
    const g = legacy.geometry, n = g.attributes.position.count;
    assert.equal(T.position.length / 4, n, `record ${i}: as many vertices`);
    const P = g.attributes.position.array, N = g.attributes.normal.array, B = g.attributes.box.array, W = g.attributes.facadeWall.array, C = g.attributes.paint.array;
    for (let v = 0; v < n; v++) {
      const d = MC.decodeVertex(block, 0, v, cells.table, cells.yUnit);
      worst.xz = Math.max(worst.xz, Math.abs(d.x - P[v * 3]), Math.abs(d.z - P[v * 3 + 2]));
      worst.y = Math.max(worst.y, Math.abs(f32(d.y) - P[v * 3 + 1]));
      worst.stored = Math.max(worst.stored, Math.abs(d.yStored - d.y));
      for (let k = 0; k < 3; k++) worst.normal = Math.max(worst.normal, Math.abs(d.normal[k] - N[v * 3 + k]));
      worst.width = Math.max(worst.width, Math.abs(d.box[0] - B[v * 4]));
      assert.equal(f32(d.box[1]), B[v * 4 + 1], 'height');
      assert.equal(f32(d.box[3]), B[v * 4 + 3], 'seed + tone');
      assert.equal(d.wall[0], W[v * 3], 'along');
      worst.fromTop = Math.max(worst.fromTop, Math.abs(d.wall[1] - W[v * 3 + 1]));
      assert.equal(d.wall[2], W[v * 3 + 2], 'kind');
      for (let k = 0; k < 4; k++) assert.equal(f32(d.paint[k]), C[v * 4 + k], 'paint');
    }
    // the walls' triangles are the same; the roof's are earcut's (another version: the same count and area)
    const L = g.index.array, walls = T.walls * 6;
    for (let k = 0; k < walls; k++) assert.equal(T.index[k], L[k]);
    // (earcut 3.2.4 leaves out a zero-area triangle three's earcut keeps on a few roofs with courtyards: :354390)
    assert.ok(T.index.length <= L.length && T.index.length >= L.length - 3 * (r.rings.length - 1), `record ${i}: as many triangles`);
    const capArea = (idx, at) => { let a = 0; for (let k = walls; k < idx.length; k += 3) { const [p, q, s] = [idx[k], idx[k + 1], idx[k + 2]].map(at); a += Math.abs((q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0])) / 2; } return a; };
    const a1 = capArea(T.index, (v) => [T.position[v * 4] / 10, T.position[v * 4 + 2] / 10]), a0 = capArea(L, (v) => [P[v * 3], P[v * 3 + 2]]);
    assert.ok(Math.abs(a1 - a0) <= 1e-3 * a0 + 0.01, `record ${i}: roof ${a1} m² against ${a0}`);
    vertices += n; wallTris += walls / 3;
  });
  // float32 absolute positions round to ~0.5 mm this far out; the rest is float32 rounding (two ulps at 300 m)
  assert.ok(worst.xz < 6e-4 && worst.y === 0 && worst.normal < 1e-6 && worst.width < 2e-5 && worst.fromTop < 5e-5, JSON.stringify(worst));
  assert.ok(worst.stored <= 0.005 + 1e-9, `the CPU's copy of y (stand-ins, bounds) within half a centimetre: ${worst.stored}`);
  console.log(`# near tier = pilot format: ${recs.length} buildings, ${vertices} vertices, ${wallTris} wall triangles; worst ${JSON.stringify(worst)}`);
});

// one city-wide build for the tests below
const recs = makeRecords();
const city = MC.buildMassingCells(MC.packInput(recs));

test('encode/decode city-wide: corners on the grid, edges exact, every vertex its own building\'s, in its block and tier cell', () => {
  const { blocks, table, order } = city;
  assert.equal(new Set(order).size, recs.length, 'one table row per record');
  for (let row = 0; row < recs.length; row++) {
    const r = recs[order[row]], t = table.subarray(row * 8, row * 8 + 8);
    const seedTone = (Math.floor(r.seed) % 1000) + 0.1 + 0.8 * r.tone;
    assert.deepEqual([...t], [r.h, seedTone, r.base, r.capY, ...r.paint].map(f32), `table row ${row}`);
  }
  let checked = 0, farOff = 0;
  for (const b of blocks) {
    b.tiers.forEach((T, tier) => {
      const owner = new Int32Array(T.position.length / 4).fill(-1);
      for (let v = 0; v < owner.length; v++) {
        const d = MC.decodeVertex(b, tier, v, table, city.yUnit);
        const r = recs[order[d.building]];
        owner[v] = d.building;
        // in its block, by its centre
        assert.ok(Math.floor(r.cx / MC.BLOCK) === b.bx && Math.floor(r.cz / MC.BLOCK) === b.bz && r.style === b.style);
        if (tier < 2) {
          // on the decimetre grid, at a corner of its own rings
          assert.ok(r.rings.some((ring) => ring.some(([x, z]) => Math.abs(x - d.x) < 1e-6 && Math.abs(z - d.z) < 1e-6)), 'a corner of its rings');
        } else {
          const near = Math.min(...r.boxes.flatMap(([x, z, w, dd, ry]) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
            const u = su * w / 2, vv = sv * dd / 2;
            return Math.hypot(x + u * Math.cos(ry) + vv * Math.sin(ry) - d.x, z - u * Math.sin(ry) + vv * Math.cos(ry) - d.z);
          })));
          farOff = Math.max(farOff, near);
        }
        assert.ok(Math.abs(d.yStored - d.y) <= city.yUnit / 2 + 1e-9);
        checked++;
      }
      // a wall's four corners (two at its foot, two at its top) carry its edge: the difference of its two ends
      let walls = 0;
      for (let v = 0; v < owner.length;) {
        if (!T.normal[v * 4] && !T.normal[v * 4 + 1]) { v++; continue; }
        for (const q of [v, v + 2]) {
          const a = MC.decodeVertex(b, tier, q, table, city.yUnit), e = MC.decodeVertex(b, tier, q + 1, table, city.yUnit);
          assert.ok(Math.abs(e.x - a.x - T.normal[q * 4] / 10) < 1e-6 && Math.abs(e.z - a.z - T.normal[q * 4 + 1] / 10) < 1e-6 && e.y === a.y, 'the edge is the wall');
        }
        v += 4; walls++;
      }
      assert.equal(walls, T.walls);
      // each tier cell's index range holds only its own buildings' triangles
      for (let s = 0; s < 4; s++) {
        const [start, count] = [T.ranges[s * 2], T.ranges[s * 2 + 1]];
        for (let k = start; k < start + count; k++) {
          const r = recs[order[owner[T.index[k]]]];
          const sx = Math.floor(r.cx / MC.SUB) - b.bx * 2, sz = Math.floor(r.cz / MC.SUB) - b.bz * 2;
          assert.equal(MC.TIER_ORDER[sx + 2 * sz], s);
        }
      }
      assert.equal(T.ranges[6] + T.ranges[7], T.index.length, 'the ranges cover the index buffer');
    });
  }
  assert.ok(farOff <= 0.0708, `box corners on the decimetre grid: ${farOff} m off`);
  assert.equal(MC.BYTES_PER_VERTEX, 2 * 4 * Int16Array.BYTES_PER_ELEMENT);
  console.log(`# encode/decode: ${checked} vertices`);
});

test('two builds are byte for byte the same', () => {
  const digest = (out) => {
    const h = createHash('sha256');
    h.update(Buffer.from(out.table.buffer)); h.update(Buffer.from(out.order.buffer));
    for (const b of out.blocks) for (const T of b.tiers) for (const a of [T.position, T.normal, T.index, T.ranges]) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    return h.digest('hex');
  };
  assert.equal(digest(MC.buildMassingCells(MC.packInput(recs))), digest(city));
});

test('nextTier: hysteresis at both limits, never flips inside a band, agrees with the plain limits outside them', () => {
  const limits = [600, 1600], band = 40;
  const plain = (d) => (d < limits[0] ? 0 : d < limits[1] ? 1 : 2);
  const r = rng(42);
  for (let run = 0; run < 2000; run++) {
    let t = -1, d = r() * 2500;
    for (let step = 0; step < 200; step++) {
      d = Math.max(0, d + (r() - 0.5) * (r() < 0.1 ? 900 : 60));
      const before = t;
      t = MC.nextTier(t, d, limits, band);
      assert.ok(t === 0 || t === 1 || t === 2);
      // outside every band: the plain tier
      if (limits.every((L) => Math.abs(d - L) > band)) assert.equal(t, plain(d));
      // inside a band: the tier it had, if that is one of the band's two
      for (let k = 0; k < 2; k++) if (Math.abs(d - limits[k]) <= band && before >= 0 && (before === k || before === k + 1)) assert.equal(t, before);
    }
  }
  // standing on a limit: no flicker, from either side
  for (const start of [0, 1]) {
    let t = start;
    for (let i = 0; i < 100; i++) { t = MC.nextTier(t, 600 + (i % 2 ? 39 : -39), limits, band); assert.equal(t, start); }
  }
  // a jump across both limits goes straight there and back
  assert.equal(MC.nextTier(0, 5000, limits, band), 2);
  assert.equal(MC.nextTier(2, 10, limits, band), 0);
  assert.equal(MC.nextTier(-1, NaN, limits, band), 0);
  assert.equal(MC.nextTier(2, NaN, limits, band), 2);
  // the distance to a tier cell: 0 inside it at street level, then to its box
  const cell = { sx: 0, sz: 0, maxY: 50 };
  assert.equal(MC.cellDistance(cell, 250, 1.7, 250), 0);
  assert.equal(MC.cellDistance(cell, -30, 1.7, 250), 30);
  assert.equal(MC.cellDistance(cell, 250, 90, 250), 40);
  assert.ok(Math.abs(MC.cellDistance(cell, 503, 54, 504) - Math.hypot(3, 4, 4)) < 1e-9);
});

test('tierRuns: a mesh draws exactly its tier\'s cells, in at most two index ranges', () => {
  let cases = 0;
  for (let mask = 0; mask < 81; mask++) for (let empty = 0; empty < 16; empty++) {
    const tiers = [0, 1, 2, 3].map((s) => Math.floor(mask / 3 ** s) % 3);
    const ranges = new Uint32Array(8);
    let at = 0;
    for (let s = 0; s < 4; s++) { const c = empty & (1 << s) ? 0 : 3 * (s + 1); ranges[s * 2] = at; ranges[s * 2 + 1] = c; at += c; }
    const drawn = new Set();
    for (let t = 0; t < 3; t++) {
      const runs = MC.tierRuns(ranges, tiers, t);
      assert.ok(runs.length <= 2, `${tiers} ${empty}: ${JSON.stringify(runs)}`);
      for (const [start, count] of runs) for (let k = start; k < start + count; k++) {
        const s = [0, 1, 2, 3].find((q) => k >= ranges[q * 2] && k < ranges[q * 2] + ranges[q * 2 + 1]);
        assert.equal(tiers[s], t);
        assert.ok(!drawn.has(k));
        drawn.add(k);
      }
    }
    assert.equal(drawn.size, at, 'every triangle drawn once');
    cases++;
  }
  assert.equal(cases, 81 * 16);
});

test('mid tier: simplified within its tolerance, simple, without the walls a neighbour covers whole; far tier: the boxes', () => {
  const tol = MC.MID_TOLERANCE / MC.XZ_UNIT;
  let simplified = 0, kept = 0, cornersBefore = 0, cornersAfter = 0, worstDev = 0, dropped = 0;
  for (const r of recs) {
    const X = r.rings.map((ring) => ring.map(([x]) => Math.round(x * 10))), Z = r.rings.map((ring) => ring.map(([, z]) => Math.round(z * 10)));
    const outer = { x: X[0], z: Z[0] }, holes = X.slice(1).map((x, k) => ({ x, z: Z[k + 1] }));
    const coveredFull = (i) => r.kinds[i] === WALL_KINDS.lotLine && r.cover[i] >= r.h - 0.01;
    const mid = MC.midRings(outer, holes, (i) => r.kinds[i], coveredFull, tol);
    const o = mid.rings[0];
    cornersBefore += outer.x.length; cornersAfter += o.x.length;
    if (!mid.simplified) { kept++; continue; }
    simplified++;
    // its corners are corners of the outline, and every corner of the outline lies within the tolerance of it
    for (let k = 0; k < o.x.length; k++) assert.ok(outer.x.some((x, i) => x === o.x[k] && outer.z[i] === o.z[k]));
    for (let i = 0; i < outer.x.length; i++) {
      let best = Infinity;
      for (let k = 0; k < o.x.length; k++) {
        const ax = o.x[k], az = o.z[k], bx = o.x[(k + 1) % o.x.length], bz = o.z[(k + 1) % o.x.length];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
        const t = L2 ? Math.max(0, Math.min(1, ((outer.x[i] - ax) * dx + (outer.z[i] - az) * dz) / L2)) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx - outer.x[i], az + t * dz - outer.z[i]));
      }
      worstDev = Math.max(worstDev, best);
    }
    // a whole-covered party wall is never drawn on its own
    if (o.x.length === outer.x.length) for (let i = 0; i < outer.x.length; i++) if (coveredFull(i)) { assert.equal(o.kinds[i], -1); dropped++; }
  }
  assert.ok(worstDev <= tol + 1e-9, `${worstDev / 10} m`);
  assert.ok(simplified > recs.length * 0.99, `${simplified} simplified, ${kept} kept whole`);
  assert.ok(dropped > 1000);
  // the far tier: four walls and a two-triangle cap per box
  const boxes = recs.reduce((s, r) => s + r.boxes.length, 0);
  assert.equal(city.stats.tiers[2].walls, boxes * 4);
  assert.equal(city.stats.tiers[2].triangles, boxes * 10);
  // what the tiers cost (printed, not asserted)
  const t = city.stats.tiers;
  console.log(`# tiers: ${t.map((x) => `${x.name} ${x.vertices} vertices, ${x.triangles} triangles, ${(x.bytes / 1048576).toFixed(1)} MiB`).join('; ')}; ` +
    `mid ${cornersAfter} of ${cornersBefore} outer corners, ${simplified} simplified, ${kept} kept whole, ${city.stats.coveredDropped} covered walls dropped; built in ${city.stats.ms} ms`);
});
