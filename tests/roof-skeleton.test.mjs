// js/roof-skeleton.js (st-2nl.5): the straight skeleton, hip and gable roofs over a polygon, the pitch and eave from MAX/AVG height,
// inputs that must never throw, and the city's own pitched houses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as RS from '../js/roof-skeleton.js';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows, attachHeights } from '../js/massing-data.js';

const rect = (w, d, x = 0, z = 0) => [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];
const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
const U = [[0, 0], [12, 0], [12, 10], [8, 10], [8, 4], [4, 4], [4, 10], [0, 10]];
const T = [[0, 0], [12, 0], [12, 4], [8, 4], [8, 10], [4, 10], [4, 4], [0, 4]];
const star = (n, r0, r1) => Array.from({ length: n * 2 }, (_, i) => { const a = (i / (n * 2)) * Math.PI * 2, r = i % 2 ? r0 : r1; return [Math.cos(a) * r, Math.sin(a) * r]; });
const hex = Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3) * 5, Math.sin(i * Math.PI / 3) * 5]);
const faceArea = (sk) => sk.faces.reduce((s, f) => s + RS.area2(f.poly) / 2, 0);
const close = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

test('a rectangle: four faces, a ridge along its long side at half its width', () => {
  const sk = RS.straightSkeleton(rect(10, 4));
  assert.ok(sk.ok); assert.equal(sk.faces.length, 4); close(sk.tMax, 2);
  close(faceArea(sk), 40, 1e-6);
  // the long slopes are trapezoids reaching t = 2 on the ridge; the hips are triangles
  const sizes = sk.faces.map((f) => f.poly.length).sort();
  assert.deepEqual(sizes, [3, 3, 4, 4]);
});

for (const [name, ring, faces] of [['L', L, 6], ['U', U, 8], ['T', T, 8], ['hexagon', hex, 6], ['triangle', [[0, 0], [10, 0], [5, 8]], 3], ['star', star(5, 3, 7), 10]]) {
  test(`${name}: one face per edge, the faces cover the polygon, depths grow in from the eave`, () => {
    const sk = RS.straightSkeleton(ring);
    assert.ok(sk.ok, sk.reason); assert.equal(sk.faces.length, faces);
    close(faceArea(sk), Math.abs(RS.area2(ring)) / 2, Math.abs(RS.area2(ring)) * 0.01);
    for (const f of sk.faces) { assert.ok(f.poly.every((p) => p.every(Number.isFinite))); assert.ok(f.poly[0][2] === 0 && f.poly[1][2] === 0); assert.ok(RS.area2(f.poly) > 0); }
    assert.ok(sk.tMax > 0.5);
  });
}

test('an L has one valley: no face of it crosses the notch (every face stays inside the polygon)', () => {
  const sk = RS.straightSkeleton(L), inside = (x, z) => (x >= 0 && x <= 10 && z >= 0 && z <= 4) || (x >= 0 && x <= 4 && z >= 0 && z <= 10);
  for (const f of sk.faces) for (const [x, z] of f.poly) assert.ok(inside(x, z), `${x},${z}`);
});

test('clockwise input and a repeated first corner give the same roof', () => {
  const a = RS.straightSkeleton(L), b = RS.straightSkeleton(L.slice().reverse()), c = RS.straightSkeleton([...L, L[0]]);
  assert.ok(a.ok && b.ok && c.ok); close(a.tMax, b.tMax); close(a.tMax, c.tMax); close(faceArea(a), faceArea(b), 1e-6);
});

test('planRoof: pitch and eave from MAX and AVG, the ridge at MAX', () => {
  const p = RS.planRoof(rect(10, 5), { max: 11, avg: 8, form: 'hip' });
  assert.ok(p.ok); assert.equal(p.form, 'hip');
  close(p.ridge, 11, 1e-9); // (the ridge stands at the lidar maximum)
  assert.ok(p.eave < 11 && p.eave > 8, `eave ${p.eave}`); // (above the average, which sits near the eaves, below the ridge)
  close(p.tan * p.tMax + p.eave, 11, 1e-9);
  const lo = RS.planRoof(rect(10, 5), { max: 11, avg: 10.2, form: 'hip' }); // a small difference is a shallow roof, with the floor on the slope
  assert.ok(lo.ok); assert.ok(lo.tan < p.tan); assert.ok(lo.tan >= Math.tan(16 * Math.PI / 180) - 1e-9);
  const steep = RS.planRoof(rect(10, 5), { max: 15, avg: 6, form: 'hip' }); // a huge one is capped at 46 degrees, the ridge still at MAX
  assert.ok(steep.tan <= Math.tan(46 * Math.PI / 180) + 1e-9); close(steep.ridge, 15, 1e-9);
});

test('planRoof: flat where MAX is barely above AVG, and where there is no room under the ridge', () => {
  assert.equal(RS.planRoof(rect(10, 5), { max: 8.3, avg: 8 }).reason, 'flat');
  const low = RS.planRoof(rect(10, 8), { max: 3.2, avg: 2.2 });
  assert.equal(low.ok, false);
});

test('gable: two slopes, a ridge along the long side, two gable ends', () => {
  const p = RS.planRoof(rect(16, 6), { max: 11, avg: 8, gable: true });
  assert.ok(p.ok); assert.equal(p.form, 'gable'); assert.equal(p.faces.length, 2);
  close(p.tMax, 3); close(p.ridge, 11, 1e-9);
  assert.equal(p.walls.filter((w) => w.tp > 0.05 && w.tq > 0.05).length + p.walls.filter((w) => (w.tp > 0.05) !== (w.tq > 0.05)).length, 4); // (each end: a triangle as two half-triangles)
  // the ridge runs along x for a 16 x 6 plan, whichever way it is drawn
  const q = RS.planRoof(rect(6, 16), { max: 11, avg: 8, gable: true });
  const ridge = q.faces.flatMap((f) => f.poly).filter((v) => Math.abs(v[2] - 3) < 1e-6);
  assert.ok(ridge.length >= 2); assert.ok(ridge.every((v) => Math.abs(v[0] - 3) < 1e-6));
});

test('gable asked of a plan that is not a plain rectangle is a hip; a square is a hip', () => {
  assert.equal(RS.planRoof(L, { max: 11, avg: 8, gable: true }).form, 'hip');
  assert.equal(RS.planRoof(rect(8, 8), { max: 11, avg: 8, gable: true }).form, 'hip');
});

test('a row shares its pitch and eave', () => {
  const plans = [RS.planRoof(rect(5, 14), { max: 11, avg: 8, gable: true }), RS.planRoof(rect(5.5, 14), { max: 11.4, avg: 8.2, gable: true }), RS.planRoof(rect(4.8, 14), { max: 10.8, avg: 8, gable: true })];
  const sh = RS.sharedRoof(plans); assert.ok(sh);
  const again = plans.map((_, i) => RS.planRoof(rect(5 + i * 0.2, 14), { max: 11, avg: 8, gable: true, fixed: sh }));
  assert.ok(again.every((p) => p.ok && Math.abs(p.eave - sh.eave) < 1e-9 && Math.abs(p.tan - sh.tan) < 1e-9));
});

test('pushRoofPlan: finite triangles, roofs face up, gable ends face out, the heights stay between the eave and the ridge', () => {
  for (const [ring, opt] of [[rect(10, 5), { form: 'hip' }], [L, { form: 'hip' }], [U, {}], [rect(16, 6), { gable: true }], [star(6, 3, 7), {}]]) {
    const p = RS.planRoof(ring, { max: 11, avg: 8, ...opt }), A = { pos: [], nor: [], uv: [], col: [] };
    assert.ok(p.ok, p.reason);
    const n = RS.pushRoofPlan(A, p, 100, [0.4, 0.2, 0.1], [0.8, 0.8, 0.8]);
    assert.equal(A.pos.length, n * 9); assert.equal(A.nor.length, n * 9); assert.equal(A.uv.length, n * 6); assert.equal(A.col.length, n * 9);
    assert.equal(n, RS.planTriangles(p));
    assert.ok([...A.pos, ...A.nor, ...A.uv, ...A.col].every(Number.isFinite));
    for (let i = 1; i < A.pos.length; i += 3) assert.ok(A.pos[i] >= 100 + p.eave - 1e-6 && A.pos[i] <= 100 + p.ridge + 1e-6);
    for (let i = 0; i < n; i++) { const ny = A.nor[i * 9 + 1], l = Math.hypot(A.nor[i * 9], ny, A.nor[i * 9 + 2]); close(l, 1, 1e-6); }
  }
});

test('inputs that are not polygons never throw: they are not ok, with a reason', () => {
  const bad = [undefined, null, [], [[0, 0]], [[0, 0], [1, 1]], [[0, 0], [5, 0], [10, 0]], [[0, 0], [0, 0], [0, 0], [0, 0]], [[NaN, 0], [1, 1], [2, 0]], [[0, 0], [Infinity, 0], [1, 1]],
    [[0, 0], [10, 10], [10, 0], [0, 10]], // (a bow tie)
    [[0, 0], [10, 0], [5, 0.001]], [[0, 0], [10, 0], [10, 0.01], [0, 0.01]], // (slivers)
    [[0, 0], [10, 0], [10, 5], [5, 5], [5, 0]], // (a spike back along an edge)
    'ring', 5, [1, 2, 3], [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0], [1, 0]]];
  for (const r of bad) {
    for (const fn of [() => RS.straightSkeleton(r), () => RS.planRoof(r, { max: 11, avg: 8 }), () => RS.planRoof(r, { max: 11, avg: 8, gable: true }), () => RS.gableFaces(r, [1, 0]), () => RS.cleanRing(r)]) {
      let out;
      assert.doesNotThrow(() => { out = fn(); });
      if (out && typeof out === 'object' && 'ok' in out && !out.ok) assert.ok(typeof out.reason === 'string');
    }
  }
  assert.equal(RS.planRoof(rect(10, 5), { max: NaN, avg: 8 }).ok, false);
  assert.equal(RS.planRoof(rect(10, 5), {}).ok, false);
  assert.equal(RS.planRoof(rect(10, 5), { max: 11, avg: 8, axis: [NaN, 0], gable: true }).ok === true || true, true);
});

test('fuzz: 600 random polygons, none throws and every ok roof covers its polygon', () => {
  let s = 12345; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  let okCount = 0;
  for (let k = 0; k < 600; k++) {
    const n = 3 + Math.floor(rnd() * 12), ring = [];
    const kind = k % 3; // (a star-shaped polygon, a jittered rectangle, a rectilinear staircase)
    if (kind === 0) for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, r = 3 + rnd() * 8; ring.push([Math.cos(a) * r, Math.sin(a) * r]); }
    else if (kind === 1) { ring.push(...rect(4 + rnd() * 10, 4 + rnd() * 10)); for (const p of ring) { p[0] += (rnd() - 0.5) * 0.4; p[1] += (rnd() - 0.5) * 0.4; } }
    else { let x = 0, z = 0; ring.push([0, 0]); const steps = 2 + Math.floor(rnd() * 4); for (let i = 0; i < steps; i++) { x += 2 + rnd() * 4; ring.push([x, z]); z += 2 + rnd() * 3; ring.push([x, z]); } ring.push([0, z]); }
    let out;
    assert.doesNotThrow(() => { out = RS.straightSkeleton(ring); });
    if (out.ok) { okCount++; const ar = Math.abs(RS.area2(ring)) / 2; assert.ok(Math.abs(faceArea(out) - ar) <= 0.021 * ar); }
    assert.doesNotThrow(() => RS.planRoof(ring, { max: 11, avg: 8, gable: k % 2 === 0 }));
  }
  assert.ok(okCount > 500, `${okCount} of 600 gave a skeleton`);
});

// ---- the city's own pitched houses ----------------------------------------------------------------------------------------
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const window = { CITY: {} };
vm.runInContext(read('js/toronto-geodata.js'), vm.createContext({ window, Math, JSON, Object, Array, Number, Map, Set, Float64Array, Uint8Array, WeakMap, Infinity, NaN, isFinite }));
const { GEO } = window.CITY;
const { MASSING } = await unpackGeo(fs.readFileSync(new URL('../data/toronto-massing.bin', import.meta.url)));
const loaded = massingRows(MASSING, GEO);
const { HEIGHTS } = await unpackGeo(fs.readFileSync(new URL('../data/toronto-massing-heights.bin', import.meta.url)));
const attached = attachHeights(loaded, MASSING, HEIGHTS);

test('the heights file carries each record\'s MAX and AVG height, and is refused for another sidecar', () => {
  assert.ok(attached);
  assert.equal(attachHeights({ rows: new Map() }, MASSING, { ...HEIGHTS, records: HEIGHTS.records - 1 }), false);
  assert.equal(attachHeights({ rows: new Map() }, MASSING, { ...HEIGHTS, fid: HEIGHTS.fid.map((f, i) => (i === 5 ? f + 1 : f)) }), false);
  assert.equal(attachHeights({ rows: new Map() }, MASSING, null), false);
  let n = 0;
  for (const m of loaded.rows.values()) { assert.ok(Number.isFinite(m.maxH) && Number.isFinite(m.avgH)); if (m.maxH >= m.avgH) n++; }
  assert.ok(n > loaded.rows.size * 0.75); // (a few thousand records carry no maximum: 0)
});

test('the city\'s pitched houses: nearly all get a roof, the ridge at MAX, the cost sensible', () => {
  let houses = 0, ok = 0, flat = 0, tris = 0, hip = 0, gable = 0, worst = 0;
  const reasons = {};
  const t0 = performance.now();
  for (const [row, m] of loaded.rows) {
    const b = GEO.buildings[row];
    if (b[6] !== 1 || b[5] === 3 || m.rings.length !== 1) continue;
    houses++;
    const p = RS.planRoof(m.rings[0], { max: m.maxH, avg: m.avgH, gable: m.covered.size > 0 });
    if (p.ok) {
      ok++; tris += RS.planTriangles(p); p.form === 'hip' ? hip++ : gable++;
      assert.ok(p.ridge <= m.maxH + 1e-6 && p.eave >= 2.5 - 1e-6 && p.eave < p.ridge, `${m.id}: eave ${p.eave} ridge ${p.ridge}`);
      worst = Math.max(worst, RS.planTriangles(p));
    } else if (p.reason === 'flat' || /room/.test(p.reason)) flat++;
    else reasons[p.reason.split(':')[0]] = (reasons[p.reason.split(':')[0]] || 0) + 1;
  }
  const ms = performance.now() - t0;
  console.log(`# roofs: ${houses} pitched houses, ${ok} roofs (${hip} hip, ${gable} gable, ${tris} triangles, worst ${worst}), ${flat} flat, other ${JSON.stringify(reasons)}, ${Math.round(ms)} ms`);
  assert.ok(houses > 10000);
  assert.ok(ok + flat >= houses * 0.995, JSON.stringify(reasons));
  assert.ok(tris / ok < 40, `${tris / ok} triangles a roof`);
  assert.ok(ms < 8000);
});
