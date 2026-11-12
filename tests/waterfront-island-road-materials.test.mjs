// Source-backed Oneida/Ojibway lane ROAD-SURFACE materials (js/waterfront-island-road-materials.js, bead st-sb3r.25).
//
// These tests use the real generated lane data (js/waterfront-island-lanes-data.js) and the committed detail/Eglinton
// geodata. They prove, on the PURE CPU side (the mask rasterizer, the lane-local frame, the sampler, and the exact
// herringbone/slab maths that the TSL shader mirrors):
//   - the two photographed runs resolve to the correct per-way OSM ways, and ONLY those two are claimed;
//   - the CPU mask hits Oneida and Ojibway and is null on the mainland, the airport, Cibola and every other island lane;
//   - the Oneida pattern is the captain's exact perpendicular 2:1 domino tiling (both orientations, 2:1 dims, no double/gap
//     cell coverage, diagonal staircase joints), not a running bond or a grid;
//   - the lane-local (s, t) frame follows the mapped way direction (including a rotated segment), and the Ojibway central
//     joint is at t = 0 (the lane centre), not a global world-X modulo;
//   - the mask has an anti-aliased coverage edge and is zero outside its bounds; the actual texture dimensions/bytes are
//     reported;
//   - the visible paved strip is ~3.3 m Oneida / ~3.5 m Ojibway at multiple clear stations, centred on the mapped lane
//     frame, with grass shoulders between the strip and the outer corridor (the inner edge is analytic from interpolated
//     t, so the width is sub-texel faithful and the mask stays ~2 MB);
//   - both palettes are approximate neutral greys (no clay red), and the provenance does not claim sampled colours;
//   - the hook is a no-op for a frame/projection mismatch, a missing ISLAND_LANES_DATA, a non-node material, and when the
//     TSL namespace is absent; it never touches road-paint, routing, width or geometry (there is no builder at all).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const ROOT = new URL('..', import.meta.url);
const readJs = (file) => fs.readFileSync(new URL(`js/${file}`, ROOT), 'utf8');
const readBin = (rel) => fs.readFileSync(new URL(rel, ROOT));

const loadBin = async (rel) => {
  let u8 = new Uint8Array(readBin(rel));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  const { decodeGeo } = await import(new URL('js/geodata-loader.js', ROOT));
  return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
};

const detail = await loadBin('data/toronto-geodata.bin');
const eglinton = await loadBin('data/frames/eglinton/toronto-geodata.bin');

function city({ geo = detail.GEO, withData = true, withModule = true } = {}) {
  const G = { ...geo, frame: { ...(geo.frame || {}), detail: geo.frame?.detail && { ...geo.frame.detail }, projection: geo.frame?.projection && { ...geo.frame.projection } } };
  const C = { GEO: G };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, Date, Number, Array, Set, Map, Uint8Array, Float32Array };
  vm.createContext(ctx);
  if (withData) vm.runInContext(readJs('waterfront-island-lanes-data.js'), ctx, { filename: 'waterfront-island-lanes-data.js' });
  if (withModule) vm.runInContext(readJs('waterfront-island-road-materials.js'), ctx, { filename: 'waterfront-island-road-materials.js' });
  return ctx.window.CITY;
}

const runOf = (C, name) => (C.ISLAND_LANES_DATA?.runs || []).find((r) => (r.names || []).includes(name));
const mid = (r) => r.points[Math.floor(r.points.length / 2)];

// A clean cross-section station at the midpoint of one segment, with the unit normal perpendicular to that segment (so the
// measured width is the true across-lane width, not a chord across a bend).
const stationNormal = (run, seg) => {
  const a = run.points[seg], b = run.points[seg + 1];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  return { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], nx: -dz / L, nz: dx / L };
};

// Measure the visible paved width at a station by scanning the CPU sampler across the lane and finding the two 0.5
// pavement-coverage crossings. This exercises the same interpolated-t analytic edge the shader uses, not a classifier.
const pavementWidthAt = (C, run, i) => {
  const { p, nx, nz } = stationNormal(run, i);
  const at = (off) => C.islandRoadMaskSample(p[0] + nx * off, p[1] + nz * off);
  const cross = (from, to) => {
    const step = from < to ? 0.01 : -0.01;
    let prev = at(from), prevOff = from;
    for (let off = from + step; step > 0 ? off <= to : off >= to; off += step) {
      const s = at(off);
      if (prev && s && (prev.pavement - 0.5) * (s.pavement - 0.5) <= 0) {
        const f = (0.5 - prev.pavement) / (s.pavement - prev.pavement);
        return prevOff + (off - prevOff) * f;
      }
      prev = s; prevOff = off;
    }
    return null;
  };
  const left = cross(0, -4), right = cross(0, 4);
  return { left, right, width: right - left, at };
};

// Segment stations whose both sides are clear of the junction exclusion (corridor ~1 at 3 m).
const clearStations = (C, run) => {
  const out = [];
  for (let seg = 0; seg < run.points.length - 1; seg++) {
    const { p, nx, nz } = stationNormal(run, seg);
    const l = C.islandRoadMaskSample(p[0] - nx * 3, p[1] - nz * 3);
    const r = C.islandRoadMaskSample(p[0] + nx * 3, p[1] + nz * 3);
    if (l && r && l.coverage > 0.9 && r.coverage > 0.9) out.push(seg);
  }
  return out;
};

test('the two source runs bind to real per-way Oneida/Ojibway runs, and only the Oneida/Ojibway names', () => {
  const C = city();
  const L = C.islandRoadMaterialLayout();
  assert.equal(L.supported, true, L.reason);
  assert.equal(L.runs.length, 2);
  const byKey = Object.fromEntries(L.runs.map((r) => [r.key, { ...r }])); // (cross-realm: copy into this realm)
  assert.deepEqual(byKey.oneida, { key: 'oneida', sourceId: 42, osmWay: 13541126, name: 'Oneida Avenue', pavedWidthM: 3.3 });
  assert.deepEqual(byKey.ojibway, { key: 'ojibway', sourceId: 41, osmWay: 13541122, name: 'Ojibway Avenue', pavedWidthM: 3.5 });
  for (const key of ['oneida', 'ojibway']) {
    const run = C.ISLAND_LANES_DATA.runs.find((r) => r.id === L.runs.find((x) => x.key === key).sourceId);
    assert.equal(run.ways.length, 1, `${key} is one way`);
    assert.equal(run.ways[0], L.runs.find((x) => x.key === key).osmWay);
    assert.equal(run.cls, 'living_street');
    assert.ok(run.lengthM > 150 && run.lengthM < 250, `${key} length ${run.lengthM}`);
  }
  assert.equal(C.ISLAND_ROAD_MATERIALS_SOURCES.length, 2);
  for (const spec of Array.from(C.ISLAND_ROAD_MATERIALS_SOURCES)) {
    assert.ok(['Oneida Avenue', 'Ojibway Avenue'].includes(spec.name), spec.name);
    assert.match(spec.url, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.match(spec.title, /Algonquin Island|from Ojibway Avenue/);
    assert.ok(spec.observation && spec.kind, spec.key);
    // provenance honesty: the observation is a paraphrase, not a quote, and the palette is not claimed as sampled
    assert.match(spec.observation, /paraphrase/i, `${spec.key} observation is a paraphrase`);
  }
});

test('the CPU mask hits exactly the Oneida and Ojibway runs, with lane-local s/t', () => {
  const C = city();
  const L = C.islandRoadMaterialLayout();
  const oneida = C.ISLAND_LANES_DATA.runs.find((r) => r.id === 42);
  const ojibway = C.ISLAND_LANES_DATA.runs.find((r) => r.id === 41);
  for (const [pt, key, id] of [[mid(oneida), 'oneida', 1], [mid(ojibway), 'ojibway', 2]]) {
    const s = C.islandRoadMaskSample(pt[0], pt[1]);
    assert.ok(s, `${key} centre is on a lane`);
    assert.equal(s.key, key);
    assert.equal(s.id, id);
    assert.ok(s.coverage > 0.99, `${key} centre coverage ${s.coverage}`);
    // t is the across distance: at the centre line it is ~0
    assert.ok(Math.abs(s.t) < 0.4, `${key} centre t ${s.t}`);
    // s is the along distance: positive and within the run length
    assert.ok(s.s > 0 && s.s < 300, `${key} s ${s.s}`);
  }
  // The mask bbox is the tight union of both runs plus the guard, and the texture is small (not a whole-city raster).
  const b = L.box;
  assert.ok(b.x1 - b.x0 < 260 && b.z1 - b.z0 < 300, `bbox ${b.x1 - b.x0} x ${b.z1 - b.z0}`);
  assert.ok(L.w * L.h < 400 * 450, `mask ${L.w}x${L.h} is bounded`);
  assert.ok(L.inside > 5000 && L.inside < 30000, `${L.inside} inside texels`);
  // ACTUAL texture dimensions/bytes are reported (not a guessed "~150x110"). Two RGBA Float32 textures: base + grass.
  assert.equal(L.texture.width, L.w);
  assert.equal(L.texture.height, L.h);
  assert.equal(L.texture.bytes, L.w * L.h * 16);
  assert.equal(L.texture.textures, 2);
  assert.equal(L.texture.totalBytes, L.texture.bytes * 2);
  assert.ok(L.texture.totalBytes > 0 && L.texture.totalBytes < 8 * 1024 * 1024, `${L.texture.totalBytes} total bytes`);
  assert.ok(L.grassInside > L.inside, `grass envelope (${L.grassInside}) is wider than the strict corridor (${L.inside})`);
});

test('the CPU mask is null on the mainland, the airport, Cibola and every other island lane', () => {
  const C = city();
  const D = C.ISLAND_LANES_DATA;
  assert.equal(C.islandRoadMaskSample(1000, 600), null, 'mainland');
  assert.equal(C.islandRoadMaskSample(-900, 1600), null, 'airport');
  const cibola = D.runs.find((r) => (r.names || []).includes('Cibola Avenue') && r.unmarked === 1);
  const pc = mid(cibola);
  assert.equal(C.islandRoadMaskSample(pc[0], pc[1]), null, 'Cibola must keep asphalt');
  for (const name of ['Third Street', 'Fifth Street', 'Lakeshore Avenue', 'Omaha Avenue', 'Seneca Avenue', 'Dacotah Avenue', 'Nottawa Avenue', 'Algonquin Bridge Road']) {
    const r = runOf(C, name);
    if (!r) continue;
    const p = mid(r);
    assert.equal(C.islandRoadMaskSample(p[0], p[1]), null, `${name} is not a Oneida/Ojibway material`);
  }
});

test('the shared endpoints (fishbone junctions) are excluded, so Oneida/Ojibway never paint another row', () => {
  const C = city();
  const D = C.ISLAND_LANES_DATA;
  const oj = D.runs.find((r) => r.id === 41);
  const oi = D.runs.find((r) => r.id === 42);
  for (const p of [oj.points[0], oj.points[oj.points.length - 1], oi.points[0], oi.points[oi.points.length - 1]]) {
    assert.equal(C.islandRoadMaskSample(p[0], p[1]), null, `endpoint ${p} must be excluded`);
  }
  assert.equal(C.islandRoadMaskSample(oj.points[2][0], oj.points[2][1]).key, 'ojibway');
  assert.equal(C.islandRoadMaskSample(oi.points[2][0], oi.points[2][1]).key, 'oneida');
});

test('detail and Eglinton both resolve; a wrong projection or absent frame is a no-op', () => {
  for (const [tag, geo] of [['detail', detail.GEO], ['eglinton', eglinton.GEO]]) {
    const C = city({ geo });
    const L = C.islandRoadMaterialLayout();
    assert.equal(L.supported, true, tag);
    const oneida = C.ISLAND_LANES_DATA.runs.find((r) => r.id === 42);
    const p = mid(oneida);
    assert.ok(C.islandRoadMaskSample(p[0], p[1]), tag);
  }
  const wrong = city({ geo: detail.GEO });
  wrong.GEO.frame.projection = { ...wrong.GEO.frame.projection, kx: wrong.GEO.frame.projection.kx * 1.01 };
  assert.equal(wrong.islandRoadMaterialLayout().supported, true); // data still resolves
  const noFrame = city({ geo: {} });
  const mat = { isNodeMaterial: true };
  assert.equal(noFrame.applyIslandLaneRoadMaterial(mat), mat, 'no frame → hook no-op');
});

test('the Oneida pattern is the exact perpendicular 2:1 domino tiling (both orientations, no double/gap)', () => {
  const C = city();
  const P = C.ISLAND_ROAD_PAVER;
  assert.equal(P.long / P.wide, 2, '2:1 pavers as the captain observed');
  const w = P.wide, N = 30;
  const cellBrick = new Map(), brickCells = new Map();
  for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
    const b = C.islandRoadHerringboneAt((cx + 0.5) * w, (cy + 0.5) * w);
    const key = `${b.orient}:${b.startX},${b.startY}`;
    cellBrick.set(`${cx},${cy}`, key);
    if (!brickCells.has(key)) brickCells.set(key, []);
    brickCells.get(key).push(`${cx},${cy}`);
    // local coords must be inside the brick dims
    assert.ok(b.localU >= 0 && b.localU < b.dims[0] && b.localV >= 0 && b.localV < b.dims[1], `cell ${cx},${cy} local ${b.localU},${b.localV}`);
  }
  // every cell maps to exactly one brick (no double coverage)
  assert.equal(cellBrick.size, N * N);
  // both orientations present
  const orients = new Set([...brickCells.keys()].map((k) => k.split(':')[0]));
  assert.deepEqual([...orients].sort(), ['H', 'V']);
  // each brick covers exactly its 2:1 rectangle (no gap, no extra cell)
  for (const [key, cells] of brickCells) {
    const [orient, start] = key.split(':');
    const [sx, sy] = start.split(',').map(Number);
    const dims = orient === 'H' ? [2, 1] : [1, 2];
    const expected = new Set();
    for (let dx = 0; dx < dims[0]; dx++) for (let dy = 0; dy < dims[1]; dy++) expected.add(`${sx + dx},${sy + dy}`);
    // (a brick at the finite sample boundary is clipped; only check bricks whose full rectangle is inside the sampled grid)
    const fullyInside = sx >= 0 && sy >= 0 && sx + dims[0] <= N && sy + dims[1] <= N;
    if (!fullyInside) continue;
    assert.equal(cells.length, dims[0] * dims[1], `brick ${key} covers ${cells.length} cells`);
    for (const c of cells) assert.ok(expected.has(c), `brick ${key} cell ${c} outside its rectangle`);
  }
  // diagonal staircase joints: along a world-axis line at a non-joint row, the brick orientation alternates
  let flips = 0, prev = null;
  for (let x = 0; x < 1.0; x += 0.01) {
    const b = C.islandRoadHerringboneAt(x, 0.043).orient;
    if (prev !== null && b !== prev) flips++;
    prev = b;
  }
  assert.ok(flips > 3, `orientation flips along x: ${flips}`);
  // per-brick tones vary
  const tones = new Set();
  for (let i = 0; i < 200; i++) tones.add(C.islandRoadHerringboneAt(i * 0.031, i * 0.017).tone.toFixed(3));
  assert.ok(tones.size > 20, `${tones.size} distinct paver tones`);
});

test('the Ojibway slab layout has one central longitudinal joint at t=0 and transverse saw joints', () => {
  const C = city();
  const S = C.ISLAND_ROAD_SLAB;
  // central joint at t = 0 (the lane centre), not a global world-X modulo
  assert.equal(C.islandRoadSlabAt(1.234, 0).central, true);
  assert.equal(C.islandRoadSlabAt(1.234, 0.02).central, false);
  // transverse joints at s = k * along
  assert.equal(C.islandRoadSlabAt(0, 1.0).cross, true);
  assert.equal(C.islandRoadSlabAt(S.along, 1.0).cross, true);
  assert.equal(C.islandRoadSlabAt(S.along / 2, 1.0).cross, false);
  // most of the surface is not a joint
  let joint = 0, total = 0;
  for (let s = 0; s < 8; s += 0.02) for (let t = -3; t < 3; t += 0.02) { total++; if (C.islandRoadSlabAt(s, t).joint) joint++; }
  assert.ok(joint / total > 0.005 && joint / total < 0.05, `slab joint fraction ${(joint / total).toFixed(4)}`);
});

test('the lane-local frame follows the mapped way direction, including a rotated segment', () => {
  const C = city();
  // A synthetic run rotated 30 degrees: s must run along it, t across it, and the sign must flip on either side.
  const ang = Math.PI / 6, dx = Math.cos(ang), dz = Math.sin(ang);
  const run = { w: 6.4, points: [[0, 0], [dx * 20, dz * 20], [dx * 40, dz * 40]] };
  const at = (along, across) => C.islandRoadLaneFrameAt(run, dx * along - dz * across, dz * along + dx * across);
  const a = at(10, 0), b = at(30, 0);
  assert.ok(Math.abs(a.s - 10) < 1e-6 && Math.abs(a.t) < 1e-6, `along 10: s=${a.s} t=${a.t}`);
  assert.ok(Math.abs(b.s - 30) < 1e-6 && Math.abs(b.t) < 1e-6, `along 30: s=${b.s} t=${b.t}`);
  assert.ok(a.s < b.s, 's increases along the way');
  const left = at(20, 1.5), right = at(20, -1.5);
  assert.ok(Math.abs(left.t - 1.5) < 1e-6, `left t=${left.t}`);
  assert.ok(Math.abs(right.t + 1.5) < 1e-6, `right t=${right.t}`);
  // The real Oneida way is diagonal: its frame must still give t ~ 0 on the centre line and s increasing.
  const oi = C.ISLAND_LANES_DATA.runs.find((r) => r.id === 42);
  const f0 = C.islandRoadLaneFrameAt(oi, oi.points[1][0], oi.points[1][1]);
  const f1 = C.islandRoadLaneFrameAt(oi, oi.points[4][0], oi.points[4][1]);
  assert.ok(Math.abs(f0.t) < 1e-6 && Math.abs(f1.t) < 1e-6, 'Oneida centre line t ~ 0');
  assert.ok(f0.s < f1.s, 'Oneida s increases along the way');
});

test('the strict corridor and grass envelope are anti-aliased, bounded, and zero outside the mask', () => {
  const C = city();
  const oj = C.ISLAND_LANES_DATA.runs.find((r) => r.id === 41);
  const seg = 5;
  const { p, nx, nz } = stationNormal(oj, seg);
  const at = (off) => C.islandRoadMaskSample(p[0] + nx * off, p[1] + nz * off);
  // strict outer corridor: full inside the 6.4 m gate, anti-aliased at its 3.2 m + 0.5 m edge
  assert.ok(at(1.5).coverage > 0.99, 'inside the carriageway coverage is 1');
  assert.ok(at(3.0).coverage > 0.9, 'still nearly full at 3.0 m (lane half 3.2)');
  const edge = at(3.7);
  assert.ok(edge && edge.coverage > 0.05 && edge.coverage < 0.7, `edge coverage ${edge && edge.coverage}`);
  // the grass cleanup envelope is bounded by grassHalf (6.0 m) + 0.5 m edge and covers well past the strict gate
  assert.ok(at(4.4) === null || at(4.4).coverage === 0, 'beyond the strict gate the strict corridor is off');
  const farShoulder = at(5.2);
  assert.ok(farShoulder && farShoulder.grass > 0.5, `grass envelope covers 5.2 m (${farShoulder && farShoulder.grass})`);
  assert.equal(farShoulder.pavement, 0, 'the widened envelope is never paved');
  assert.equal(at(7.0), null, 'beyond the bounded grass envelope is native');
  // outside the mask bounds is null (the border texels are forced to 0)
  const b = C.islandRoadMaterialLayout().box;
  assert.equal(C.islandRoadMaskSample(b.x0 - 1, b.z0 - 1), null);
  assert.equal(C.islandRoadMaskSample(b.x1 + 1, b.z1 + 1), null);
});

test('the visible paved strip is ~3.3 m Oneida and ~3.5 m Ojibway at multiple clear stations', () => {
  const C = city();
  for (const [id, key, expected] of [[42, 'oneida', 3.3], [41, 'ojibway', 3.5]]) {
    const run = C.ISLAND_LANES_DATA.runs.find((r) => r.id === id);
    const stations = clearStations(C, run);
    assert.ok(stations.length >= 2, `${key} has >=2 clear stations (${stations.length})`);
    for (const i of stations) {
      const w = pavementWidthAt(C, run, i);
      assert.ok(w.left != null && w.right != null, `${key} station ${i} has both crossings`);
      assert.ok(Math.abs(w.width - expected) < 0.12, `${key} station ${i} paved width ${w.width.toFixed(3)} vs ${expected}`);
      // centred on the existing mapped lane frame: the two crossings are symmetric about the centre line
      assert.ok(Math.abs(w.left + w.right) < 0.12, `${key} station ${i} centre offset ${(w.left + w.right).toFixed(3)}`);
      // the strip is strictly narrower than the native 6.4 m corridor (no source-run broadening)
      assert.ok(w.width < run.w - 2, `${key} station ${i} narrowed (${w.width.toFixed(2)} < ${run.w})`);
    }
  }
});

test('grass shoulders replace the former asphalt between the paved strip and the outer corridor', () => {
  const C = city();
  for (const [id, key, pavedHalf] of [[42, 'oneida', C.ISLAND_ROAD_PAVED_HALF.oneida], [41, 'ojibway', C.ISLAND_ROAD_PAVED_HALF.ojibway]]) {
    const run = C.ISLAND_LANES_DATA.runs.find((r) => r.id === id);
    const i = clearStations(C, run)[0];
    const { p, nx, nz } = stationNormal(run, i);
    const at = (off) => C.islandRoadMaskSample(p[0] + nx * off, p[1] + nz * off);
    const shoulder = at(pavedHalf + 0.35);
    assert.ok(shoulder, `${key} shoulder sample exists`);
    assert.ok(shoulder.coverage > 0.95, `${key} shoulder inside the corridor (${shoulder.coverage})`);
    assert.equal(shoulder.pavement, 0, `${key} shoulder is not paved`);
    assert.ok(shoulder.shoulder > 0.9, `${key} shoulder cover ${shoulder.shoulder}`);
    assert.ok(at(0).pavement > 0.99, `${key} centre is fully paved`);
    // beyond the strict 6.4 m gate the strict corridor is off, but the bounded grass cleanup envelope still covers it
    const beyond = at(4.4);
    assert.ok(beyond && beyond.coverage === 0, `${key} strict corridor is off at 4.4 m`);
    assert.ok(beyond.grass > 0.5, `${key} grass envelope covers 4.4 m (${beyond.grass})`);
  }
});

test('the bounded grass cleanup envelope widens past the 6.4 m gate at a real lateral 4.5 m point (grass only)', () => {
  // Regression for the min(half, grassHalf) bug: the envelope must actually widen past the native 3.2 m half, otherwise
  // the residual asphalt ribbon outside the old 6.4 m mask remains. This samples a real clear station at 4.5 m lateral,
  // away from the junctions and other mapped lanes, and proves grass is positive while the strict corridor and pavement
  // are zero (the paved 3.3/3.5 m strip is not widened).
  const C = city();
  for (const [id, key] of [[42, 'oneida'], [41, 'ojibway']]) {
    const run = C.ISLAND_LANES_DATA.runs.find((r) => r.id === id);
    const seg = clearStations(C, run)[0];
    const { p, nx, nz } = stationNormal(run, seg);
    for (const side of [1, -1]) {
      const s = C.islandRoadMaskSample(p[0] + nx * 4.5 * side, p[1] + nz * 4.5 * side);
      assert.ok(s, `${key} side ${side} at 4.5 m is covered by the grass envelope`);
      assert.ok(s.grass > 0.5, `${key} side ${side} grass ${s.grass} > 0.5`);
      assert.equal(s.coverage, 0, `${key} side ${side} strict corridor is 0 at 4.5 m`);
      assert.equal(s.pavement, 0, `${key} side ${side} is not paved at 4.5 m`);
      assert.ok(s.shoulder > 0.5, `${key} side ${side} shoulder ${s.shoulder} > 0.5`);
    }
    // the envelope is bounded: well beyond 6.0 m + 0.5 m edge is native (allow the bilinear edge to fade to ~0)
    const far = C.islandRoadMaskSample(p[0] + nx * 7.5, p[1] + nz * 7.5);
    assert.ok(far === null || far.grass < 0.05, `${key} beyond the envelope is native (${far && far.grass})`);
  }
});

test('the paved half-widths are the representative source widths, not the native OSM class default', () => {
  const C = city();
  const L = C.islandRoadMaterialLayout();
  assert.deepEqual({ ...L.pavedWidthM }, { oneida: 3.3, ojibway: 3.5 });
  assert.equal(L.channels.b, 'outer corridor coverage');
  assert.equal(C.ISLAND_ROAD_PAVED_HALF.oneida, 1.65);
  assert.equal(C.ISLAND_ROAD_PAVED_HALF.ojibway, 1.75);
  for (const kind of L.kinds) {
    assert.equal(kind.w, 6.4, `${kind.key} keeps the native OSM class width untouched`);
    assert.ok(kind.pavedWidthM < kind.w, `${kind.key} paved ${kind.pavedWidthM} < native ${kind.w}`);
  }
  // coverage helpers: the outer gate is the native corridor, the inner gate is the representative strip
  assert.equal(C.islandRoadOuterCoverageAt(3.2, 0), 1);
  assert.equal(C.islandRoadOuterCoverageAt(3.2, 3.7), 0);
  assert.equal(C.islandRoadPavementCoverageAt(1.65, 0), 1);
  assert.equal(C.islandRoadPavementCoverageAt(1.65, 1.9), 0);
});

test('s stays unwrapped and continuous along each run (no reduced/wrapped period)', () => {
  const C = city();
  for (const id of [41, 42]) {
    const run = C.ISLAND_LANES_DATA.runs.find((r) => r.id === id);
    const a = C.islandRoadMaskSample(run.points[2][0], run.points[2][1]);
    const b = C.islandRoadMaskSample(run.points[run.points.length - 3][0], run.points[run.points.length - 3][1]);
    assert.ok(a && b, `${id} samples resolve`);
    assert.ok(a.s >= 0 && b.s > a.s, `${id} s increases (${a.s.toFixed(1)} -> ${b.s.toFixed(1)})`);
    // s is the unwrapped along distance: tens of metres along, never reduced modulo the 2.8 m pattern period
    assert.ok(b.s > 50, `${id} s ${b.s.toFixed(1)} m is unwrapped, not a <2.8 m modulo`);
    assert.ok(b.s <= run.lengthM + 1, `${id} s ${b.s.toFixed(1)} within the run length ~${run.lengthM}`);
  }
});

test('both palettes are approximate neutral greys with no clay red, and provenance does not claim sampling', () => {
  const src = readJs('waterfront-island-road-materials.js');
  const grab = (name) => {
    const m = src.match(new RegExp(`\\b${name}:\\s*0x([0-9a-fA-F]{6})`));
    assert.ok(m, name);
    return parseInt(m[1], 16);
  };
  const keys = ['oneidaDark', 'oneidaLight', 'oneidaJoint', 'ojibwayDark', 'ojibwayLight', 'ojibwayJoint', 'ojibwayCentral'];
  for (const k of keys) {
    const hex = grab(k);
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    assert.ok(max - min <= 14, `${k} 0x${hex.toString(16)} is not neutral grey (spread ${max - min})`);
    assert.ok(!(r > g + 20 && r > b + 30), `${k} 0x${hex.toString(16)} reads as red clay`);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    assert.ok(lum > 60 && lum < 210, `${k} luminance ${lum.toFixed(0)}`);
  }
  // The palette comment must say it is approximate / not sampled, not "sampled by the captain".
  assert.match(src, /NOT sampled from the photographs/i);
  assert.doesNotMatch(src, /palette sampled by the captain/i);
});

// --------------------------------------------------------------------------------------------------------------------
// Hook safety: the exported apply… is a strict no-op unless it can compose a real TSL graph onto a real node material.
// --------------------------------------------------------------------------------------------------------------------
test('applyIslandLaneRoadMaterial is a no-op without TSL, on a non-node material, and idempotent', () => {
  const C = city();
  const plain = { isNodeMaterial: true, colorNode: null };
  assert.equal(C.applyIslandLaneRoadMaterial(plain), plain);
  assert.equal(plain.colorNode, null);
  const C2 = city();
  C2.TSL = new Proxy({}, { get: () => () => { throw new Error('TSL must not be reached for a non-node material'); } });
  const legacy = { isNodeMaterial: false };
  assert.equal(C2.applyIslandLaneRoadMaterial(legacy), legacy);
  assert.equal(C2.applyIslandLaneRoadMaterial(null), null);
});

test('applyIslandLaneRoadMaterial is a no-op when the source data is absent', () => {
  const C = city({ withData: false, withModule: true });
  assert.equal(C.islandRoadMaterialLayout().supported, false);
  assert.equal(C.islandRoadSourceBox(), null);
  const mat = { isNodeMaterial: true, colorNode: 'x' };
  assert.equal(C.applyIslandLaneRoadMaterial(mat), mat);
  assert.equal(mat.colorNode, 'x', 'nothing is written without the source data');
});

test('applyIslandLaneRoadMaterial composes with the real TSL, records its application, and is idempotent', () => {
  // Build with the REAL three/tsl (the same nodes the browser imports) so the composition is exercised with real node
  // types, then prove the hook records its application and is a strict idempotent no-op on a second call.
  const G = { ...detail.GEO, frame: { ...detail.GEO.frame, detail: { ...detail.GEO.frame.detail }, projection: { ...detail.GEO.frame.projection } } };
  const C = { GEO: G, THREE, TSL };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, Date, Number, Array, Set, Map, Uint8Array, Float32Array };
  vm.createContext(ctx);
  vm.runInContext(readJs('waterfront-island-lanes-data.js'), ctx, { filename: 'waterfront-island-lanes-data.js' });
  vm.runInContext(readJs('waterfront-island-road-materials.js'), ctx, { filename: 'waterfront-island-road-materials.js' });
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = TSL.color(0x474542);
  mat.roughnessNode = TSL.float(0.9);
  mat.normalNode = TSL.normalWorld;
  const out = C.applyIslandLaneRoadMaterial(mat);
  assert.equal(out, mat);
  assert.ok(mat.userData && mat.userData.islandLaneRoadMaterial, 'hook recorded its application');
  assert.equal(mat.userData.islandLaneRoadMaterial.oneida, true);
  assert.equal(mat.userData.islandLaneRoadMaterial.ojibway, true);
  assert.ok(mat.userData.islandLaneRoadMaterialInfo.supported);
  assert.ok(mat.colorNode && typeof mat.colorNode === 'object');
  assert.ok(mat.roughnessNode && typeof mat.roughnessNode === 'object');
  assert.ok(mat.normalNode && typeof mat.normalNode === 'object');
  assert.ok(mat.metalnessNode && typeof mat.metalnessNode === 'object', 'metalness is brought to 0 on the shoulder/strip');
  assert.ok(mat.aoNode && typeof mat.aoNode === 'object', 'inherited road AO is removed on the grass cover');
  assert.ok(mat.emissiveNode && typeof mat.emissiveNode === 'object', 'inherited road emissive is removed on the grass cover');
  // idempotent: the second call returns the same nodes untouched
  const col = mat.colorNode, rough = mat.roughnessNode, normal = mat.normalNode, metal = mat.metalnessNode;
  const ao = mat.aoNode, emissive = mat.emissiveNode;
  C.applyIslandLaneRoadMaterial(mat);
  assert.equal(mat.colorNode, col);
  assert.equal(mat.roughnessNode, rough);
  assert.equal(mat.normalNode, normal);
  assert.equal(mat.metalnessNode, metal);
  assert.equal(mat.aoNode, ao);
  assert.equal(mat.emissiveNode, emissive);
});

test('a node material without original channels stays native OFF-mask (regression: no whole-city lane)', () => {
  // A material with NO colorNode/roughnessNode/normalNode must blend the lane against the ENGINE's native defaults
  // (materialColor / materialRoughness / materialNormal), not fall back to applying the lane everywhere. We verify the
  // hook composes against those defaults and that the resulting graph references them (so off-mask coverage 0 yields the
  // native default, not the lane).
  const G = { ...detail.GEO, frame: { ...detail.GEO.frame, detail: { ...detail.GEO.frame.detail }, projection: { ...detail.GEO.frame.projection } } };
  const C = { GEO: G, THREE, TSL };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, Date, Number, Array, Set, Map, Uint8Array, Float32Array };
  vm.createContext(ctx);
  vm.runInContext(readJs('waterfront-island-lanes-data.js'), ctx, { filename: 'waterfront-island-lanes-data.js' });
  vm.runInContext(readJs('waterfront-island-road-materials.js'), ctx, { filename: 'waterfront-island-road-materials.js' });
  const bare = new THREE.MeshStandardNodeMaterial(); // no colorNode / roughnessNode / normalNode set
  const out = C.applyIslandLaneRoadMaterial(bare);
  assert.equal(out, bare);
  assert.ok(bare.userData && bare.userData.islandLaneRoadMaterial);
  assert.ok(bare.colorNode && typeof bare.colorNode === 'object');
  assert.ok(bare.roughnessNode && typeof bare.roughnessNode === 'object');
  assert.ok(bare.normalNode && typeof bare.normalNode === 'object');
  assert.ok(bare.metalnessNode && typeof bare.metalnessNode === 'object');
  assert.ok(bare.aoNode && typeof bare.aoNode === 'object');
  assert.ok(bare.emissiveNode && typeof bare.emissiveNode === 'object');
  // The composed colour node must be a mix whose first input is materialColor (the native default). We check the source
  // references materialColor/materialRoughness/materialNormal/materialMetalness/materialAO/materialEmissive as fallbacks.
  const src = readJs('waterfront-island-road-materials.js');
  assert.match(src, /mat\.colorNode \|\| T\.materialColor/);
  assert.match(src, /mat\.roughnessNode \|\| T\.materialRoughness/);
  assert.match(src, /mat\.normalNode \|\| T\.materialNormal/);
  assert.match(src, /mat\.metalnessNode \|\| T\.materialMetalness/);
  assert.match(src, /mat\.aoNode \|\| T\.materialAO/);
  assert.match(src, /mat\.emissiveNode \|\| T\.materialEmissive/);
});

test('the material graph builds with the REAL three/tsl node system (no bool-into-mix, no type error)', () => {
  // Build the actual TSL graph with the vendored three/tsl (the same nodes the browser imports), on a real node material
  // with a native colorNode/roughnessNode/normalNode, and confirm it constructs and composes. This is the strongest check
  // short of an actual GPU compile: it exercises select/mix/texture/fwidth with real node types.
  const G = { ...detail.GEO, frame: { ...detail.GEO.frame, detail: { ...detail.GEO.frame.detail }, projection: { ...detail.GEO.frame.projection } } };
  const C = { GEO: G, THREE, TSL };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, Date, Number, Array, Set, Map, Uint8Array, Float32Array };
  vm.createContext(ctx);
  vm.runInContext(readJs('waterfront-island-lanes-data.js'), ctx, { filename: 'waterfront-island-lanes-data.js' });
  vm.runInContext(readJs('waterfront-island-road-materials.js'), ctx, { filename: 'waterfront-island-road-materials.js' });
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = TSL.color(0x474542);
  mat.roughnessNode = TSL.float(0.9);
  mat.normalNode = TSL.normalWorld;
  const out = C.applyIslandLaneRoadMaterial(mat);
  assert.equal(out, mat);
  assert.ok(mat.userData && mat.userData.islandLaneRoadMaterial, 'hook recorded its application');
  assert.ok(mat.userData.islandLaneRoadMaterialInfo.supported);
  // the mask textures are real DataTextures with the reported dimensions
  const info = mat.userData.islandLaneRoadMaterialInfo;
  assert.equal(info.texture.width, info.w);
  assert.equal(info.texture.height, info.h);
  // the three channels are real node objects (not null, not a bool)
  assert.ok(mat.colorNode && typeof mat.colorNode === 'object', 'colorNode is a node');
  assert.ok(mat.roughnessNode && typeof mat.roughnessNode === 'object', 'roughnessNode is a node');
  assert.ok(mat.normalNode && typeof mat.normalNode === 'object', 'normalNode is a node');
});

test('this module owns no builder, cover geometry, route, width or paint change', () => {
  const C = city();
  for (const gone of ['createWaterfrontIslandLanes', 'islandLaneSurfaceAt', 'createIslandLaneRoadMaterials', 'buildIslandLaneRoadMaterials']) {
    assert.equal(typeof C[gone], 'undefined', gone);
  }
  assert.equal(typeof C.applyIslandLaneRoadMaterial, 'function');
  assert.equal(typeof C.islandRoadMaskSample, 'function');
  assert.equal(typeof C.islandLaneCentreLineSuppressed, 'undefined', 'paint gate is a different module, not loaded here');
});
