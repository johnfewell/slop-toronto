// Toronto's poured sidewalks (js/sidewalk-sections.js): the walk frames city-grid.js gives every walk triangle, so the
// joints run across the walk on every street, and the section rule the shader repeats (repairs, years, stamps)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { ShapeUtils, Vector2 } from 'three';
import { loadCity, runtimeInset } from '../tools/build-sidewalks.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CITY = loadCity();
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/toronto-sidewalks.js'), 'utf8'), { window: { CITY }, console });
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/sidewalk-sections.js'), 'utf8'), { window: { CITY }, console, Math });
const { SIDEWALK, sidewalkSection, stampCentre, sectionPhase, curbRuns, walkFrames, ringSegments, runSeed, sectionHash } = CITY;
const inset = runtimeInset();
const MAT = fs.readFileSync(path.join(ROOT, 'js/tsl-materials.js'), 'utf8');

// A walk (outer ring with holes) triangulated as city-grid.js does (earcut via three's ShapeUtils), as a top-face soup
function soup(outer, holes = []) {
  const v2 = (r) => r.map((p) => new Vector2(p.x, p.z));
  const all = [...outer, ...holes.flat()];
  const tris = ShapeUtils.triangulateShape(v2(outer), holes.map(v2));
  const pos = [], nor = [];
  for (const t of tris) for (const i of t) { pos.push(all[i].x, 0.226, all[i].z); nor.push(0, 1, 0); }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor) };
}
const area2 = (P, i) => Math.abs((P[i + 3] - P[i]) * (P[i + 8] - P[i + 2]) - (P[i + 5] - P[i + 2]) * (P[i + 6] - P[i])) / 2;
// The frame of the output triangle holding (x, z): { ux, uz, c, w, t0, t1 }
function frameAt(r, x, z) {
  const P = r.pos;
  for (let i = 0; i < P.length / 9; i++) {
    const o = i * 9;
    if (area2(P, o) < 1e-9) continue;
    const xs = [P[o], P[o + 3], P[o + 6]], zs = [P[o + 2], P[o + 5], P[o + 8]];
    const cr = (a, b) => (xs[b] - xs[a]) * (z - zs[a]) - (zs[b] - zs[a]) * (x - xs[a]);
    const c0 = cr(0, 1), c1 = cr(1, 2), c2 = cr(2, 0);
    if ((c0 >= 0 && c1 >= 0 && c2 >= 0) || (c0 <= 0 && c1 <= 0 && c2 <= 0)) {
      const F = r.frame, S = r.span, v = i * 3;
      return { ux: F[v * 4], uz: F[v * 4 + 1], c: F[v * 4 + 2], w: F[v * 4 + 3], t0: S[v * 2], t1: S[v * 2 + 1] };
    }
  }
  return null;
}
// A rectangular island turned `deg` from the world axes (the downtown grid), its curb inset and a 2 m walk along it
function turnedIsland(deg, L = 90, D = 40, walk = 2) {
  const a = (deg * Math.PI) / 180, ux = Math.cos(a), uz = Math.sin(a), nx = -uz, nz = ux;
  const P = (s, t) => ({ x: 100 + s * ux + t * nx, z: -50 + s * uz + t * nz });
  const rect = (d) => [P(d, d), P(L - d, d), P(L - d, D - d), P(d, D - d)];
  return { curb: rect(0), inner: rect(0.25), prop: rect(0.25 + walk), dir: [ux, uz], P };
}

test('the joints run across the walk on an off-grid street, round its corners too', () => {
  const isl = turnedIsland(48.6); // Dundas Street West's bearing at Roncesvalles
  const runs = curbRuns(isl.inner);
  assert.equal(runs.length, 4, 'a rectangle is four runs of curb');
  const { pos, nor } = soup(isl.inner, [isl.prop]);
  const r = walkFrames(pos, nor, runs, ringSegments([isl.inner, isl.prop]), runs.map((_, i) => runSeed(7, i)), 0);
  // the walk's area is kept (the corners are cut, never doubled or dropped)
  let aIn = 0, aOut = 0;
  for (let i = 0; i < pos.length; i += 9) aIn += area2(pos, i);
  for (let i = 0; i < r.pos.length; i += 9) aOut += area2(r.pos, i);
  assert.ok(Math.abs(aIn - aOut) < 1e-3 * aIn, `${aIn} m² in, ${aOut} m² out`);
  // along each side the frame runs with that side: the joints (lines of constant s) cross the walk square to it
  const [ux, uz] = isl.dir;
  for (const [s, t, along] of [[45, 1.2, [ux, uz]], [20, 1.0, [ux, uz]], [88.6, 20, [-uz, ux]], [45, 38.8, [ux, uz]], [1.3, 15, [-uz, ux]]]) {
    const p = isl.P(s, t);
    const f = frameAt(r, p.x, p.z);
    assert.ok(f, `a walk triangle at s ${s}, t ${t}`);
    const cross = Math.abs(f.ux * along[1] - f.uz * along[0]);
    assert.ok(cross < 1e-6, `the frame at (${s}, ${t}) runs along its side (|sin| ${cross})`);
    // s = x . u: the same across the walk (a joint is a straight line from the curb to the property side), 1:1 along it
    const across = { x: p.x - f.uz * 0.8, z: p.z + f.ux * 0.8 };
    const sOf = (pt) => pt.x * f.ux + pt.z * f.uz;
    assert.ok(Math.abs(sOf(across) - sOf(p)) < 1e-6);
    const g = frameAt(r, across.x, across.z) || frameAt(r, p.x + f.uz * 0.8, p.z - f.ux * 0.8);
    assert.ok(g && g.ux === f.ux && g.uz === f.uz && g.c === f.c && g.w === f.w, 'the same frame across the walk');
    assert.ok(Math.abs(sOf({ x: p.x + f.ux, z: p.z + f.uz }) - sOf(p) - 1) < 1e-5);
    // and the span is the walk, curb side to property side
    const tIn = p.x * -f.uz + p.z * f.ux - f.c;
    assert.ok(Math.abs(f.t0 - 0) < 0.05 && Math.abs(f.t1 - 2) < 0.05, `span ${f.t0}..${f.t1}`);
    assert.ok(tIn >= f.t0 - 1e-6 && tIn <= f.t1 + 1e-6);
  }
});

test("the City's walk on Dundas Street West at Roncesvalles gets Dundas's bearing, not the grid's", () => {
  const blocks = CITY.GEO.blocks;
  const pieces = CITY.sidewalkPieces(CITY.SIDEWALKS, blocks);
  // the walk on the north side of Dundas, 70 m east of Roncesvalles (Dundas runs 48.6° off the grid there)
  const X = -5164.6, Z = -2453.7;
  let hit = null;
  for (const [id, walks] of pieces) {
    const flat = blocks[id][0], poly = [];
    for (let i = 0; i < flat.length; i += 2) poly.push({ x: flat[i], z: flat[i + 1] });
    const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
    if (X < Math.min(...xs) || X > Math.max(...xs) || Z < Math.min(...zs) || Z > Math.max(...zs)) continue;
    const inner = inset(poly, 0.25);
    const runs = curbRuns(inner);
    for (const w of walks) {
      const { pos, nor } = soup(w.outer, w.holes);
      const r = walkFrames(pos, nor, runs, ringSegments([w.outer, ...w.holes]), runs.map((_, i) => runSeed(id, i)), 0);
      hit = frameAt(r, X, Z) || hit;
    }
  }
  assert.ok(hit, 'a City walk triangle there');
  const deg = (Math.atan2(hit.uz, hit.ux) * 180) / Math.PI;
  const off = Math.abs(((deg - 48.6 + 90) % 180 + 180) % 180 - 90);
  assert.ok(off < 3, `the walk frame runs at ${deg.toFixed(1)}°, Dundas at 48.6°`);
  assert.ok(hit.t1 - hit.t0 > 0.8 && hit.t1 - hit.t0 < 6, `the walk is ${(hit.t1 - hit.t0).toFixed(2)} m across`);
});

test('a repair replaces whole sections, curb side to property side, one to three at a time', () => {
  for (const downtown of [0, 1]) {
    let repaired = 0, n = 0;
    for (let seed = 1; seed < 400; seed += 7) {
      for (let k = -40; k < 40; k++) {
        const sec = sidewalkSection(k, seed, downtown, 2.0);
        // the section's state depends on the section alone: never on where across the walk (nor its width)
        assert.equal(sidewalkSection(k, seed, downtown, 3.4).repair, sec.repair);
        n++;
        if (!sec.repair) continue;
        repaired++;
        // a run of 1-3 consecutive sections inside its group of 4
        const g = Math.floor(k / 4);
        const run = [0, 1, 2, 3].filter((j) => sidewalkSection(g * 4 + j, seed, downtown, 2).repair);
        assert.ok(run.length >= 1 && run.length <= 3, `${run.length} sections`);
        assert.ok(run.every((j, i) => i === 0 || j === run[i - 1] + 1), 'consecutive');
      }
    }
    const share = repaired / n;
    assert.ok(share > 0.06 && share < 0.25, `${(share * 100).toFixed(1)}% of sections repaired`);
  }
  // on a walk, every point across it at one place along is in the same section of the same run: a repair is a strip
  // right across the walk
  const isl = turnedIsland(-23);
  const runs = curbRuns(isl.inner);
  const { pos, nor } = soup(isl.inner, [isl.prop]);
  const r = walkFrames(pos, nor, runs, ringSegments([isl.inner, isl.prop]), runs.map((_, i) => runSeed(3, i)), 0);
  for (const s of [3.3, 10.1, 57.9, 81.2]) {
    const sec = [0.3, 0.9, 1.5, 2.15].map((t) => {
      const p = isl.P(s, t), f = frameAt(r, p.x, p.z);
      const seed = Math.floor(f.w / 2);
      return [Math.floor((p.x * f.ux + p.z * f.uz - sectionPhase(seed)) / SIDEWALK.bay), seed].join();
    });
    assert.equal(new Set(sec).size, 1, `one section across the walk at s ${s}: ${sec}`);
  }
  // the shader's repair test reads the section's group & seed only, nothing across the walk
  const repairLine = MAT.match(/\n {4}repair = [^\n]*\n/);
  assert.ok(repairLine && !/tIn|toEdge|across|span/.test(repairLine[0]), repairLine && repairLine[0]);
});

test('the years: the original pour older among the houses, the repairs newer, stamps oval before 1985', () => {
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const years = { 0: [], 1: [], rep: [] };
  for (let seed = 3; seed < 3000; seed += 11) {
    for (const d of [0, 1]) {
      const sec = sidewalkSection(1, seed, d, 2);
      (sec.repair ? years.rep : years[d]).push(sec.year);
      // one year along the whole run for the original pour
      const orig = [...Array(30).keys()].map((k) => sidewalkSection(k, seed, d, 2)).filter((x) => !x.repair).map((x) => x.year);
      assert.equal(new Set(orig).size, 1);
    }
    for (let k = 0; k < 8; k++) {
      const sec = sidewalkSection(k, seed, 0, 2);
      if (sec.repair) years.rep.push(sec.year);
    }
  }
  assert.ok(Math.min(...years[0]) >= 1952 && Math.max(...years[0]) <= 1991);
  assert.ok(Math.min(...years[1]) >= 1976 && Math.max(...years[1]) <= 2013);
  assert.ok(Math.min(...years.rep) >= 1998 && Math.max(...years.rep) <= 2025);
  assert.ok(mean(years[0]) < mean(years[1]) && mean(years[1]) < mean(years.rep));
});

test('stamps: each end of the work & every tenth bay, 50 mm from a joint, centred across, inside the walk', () => {
  const S = SIDEWALK.stamp;
  let originals = 0, repairs = 0;
  for (let seed = 5; seed < 600; seed += 13) {
    for (const width of [0.5, 1.5, 2.1, 4.0]) {
      const stamped = [];
      for (let k = -60; k < 60; k++) {
        const sec = sidewalkSection(k, seed, 0, width);
        if (width < S.minWidth) { assert.equal(sec.stamp, null, 'no stamp on a walk too narrow for one'); continue; }
        if (!sec.stamp) continue;
        const c = stampCentre(k, seed, 0, 0.25, 0.25 + width);
        const s0 = sectionPhase(seed) + k * SIDEWALK.bay;
        // 50 mm from the section's joint at one end, wholly inside the section and the walk
        const fromJoint = c.end ? s0 + SIDEWALK.bay - (c.s + S.along / 2) : c.s - S.along / 2 - s0;
        assert.ok(Math.abs(fromJoint - S.fromJoint) < 1e-9, `${fromJoint} m from the joint`);
        assert.ok(c.t - S.across / 2 >= 0.25 - 1e-9 && c.t + S.across / 2 <= 0.25 + width + 1e-9, 'inside the walk');
        if (c.year >= 1975) assert.ok(Math.abs(c.t - (0.25 + width / 2)) < 1e-9, 'centred across the walk');
        assert.equal(c.oval, c.year < S.ovalBefore);
        if (sec.repair) {
          repairs++;
          // the first section of its repair run, at the run's outer end
          const g = Math.floor(k / 4), j = k - g * 4;
          assert.ok(j === 0 || !sidewalkSection(k - 1, seed, 0, width).repair, 'the first section of the repair');
          assert.equal(c.end, 0);
        } else {
          originals++;
          stamped.push(k);
        }
      }
      // the original pour's stamps every tenth bay
      for (let i = 1; i < stamped.length; i++) if (stamped[i] - stamped[i - 1] < 10) assert.ok(false, `bays ${stamped[i - 1]} & ${stamped[i]}`);
    }
  }
  assert.ok(originals > 100 && repairs > 50, `${originals} original & ${repairs} repair stamps`);
});

test('the shader repeats the section hash & rule constants', () => {
  for (const k of ['0x8da6b343', '0xd8163841', '0x7feb352d', '0x846ca68b', '0xcb1ab31f']) assert.ok(MAT.includes(k), k);
  const SRC = fs.readFileSync(path.join(ROOT, 'js/sidewalk-sections.js'), 'utf8');
  for (const k of ['0x8da6b343', '0xd8163841', '0x7feb352d', '0x846ca68b', '0xcb1ab31f']) assert.ok(SRC.includes(k), k);
  // pinned values: a change here moves every repair & stamp in the city (and must change the shader with it)
  assert.deepEqual([sectionHash(0, 0, 0), sectionHash(-3, 17, 4), sectionHash(1234, 65535, 10)].map((h) => Math.round(h * 16777216)),
    [0, 9937132, 2427237]);
});
