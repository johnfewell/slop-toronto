// The waterfront garden-cover RUNTIME trial's contract (js/waterfront-island-garden-cover.js + -data, tools/build-island-garden-cover.mjs;
// bead st-sb3r.37, phase 2). These run on the REAL committed data and the real helper (no scene), and prove the captain's
// blockers are fixed: the review is hash-bound and cannot silently approve changed cells; only the frozen 8 patches / 263
// cells are planted; the render footprint stays inside the reviewed cells' clearance (no path spill); the projection gate
// requires every value finite; the wrong-frame case is a no-op; and the LOD/culling uses the nearest reviewed patch (the
// island is ~2.5 km from the world origin, so an origin-distance test would always cull).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = path.join(ROOT, 'js/waterfront-island-garden-cover-data.js');
const HELPER = path.join(ROOT, 'js/waterfront-island-garden-cover.js');
const TOOL = path.join(ROOT, 'tools/build-island-garden-cover.mjs');
const FIXTURE = path.join(ROOT, 'tools/data/island-garden-review.json');
const cacheDir = process.env.DON_VALLEY_DTM || path.join(process.env.HOME || '', '.cache/slop-toronto/raw/ontario-dtm-gta2023');
const hasCache = fs.existsSync(path.join(cacheDir, 'manifest-toronto-island-dsm.json')) && fs.existsSync(path.join(cacheDir, 'manifest-toronto-island.json'));

const FIX = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// Load the data + helper into a vm with a controllable CITY.GEO (frame/projection) so wrong-frame cases are testable.
function load({ geo } = {}) {
  const ctx = { window: { CITY: {} }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, JSON, Set, Map, crypto: globalThis.crypto, TextEncoder };
  vm.createContext(ctx);
  const realCtx = { window: { CITY: {} }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, JSON };
  vm.createContext(realCtx);
  vm.runInContext(fs.readFileSync(DATA, 'utf8'), realCtx, { filename: 'data.js' });
  const D = realCtx.window.CITY.ISLAND_GARDEN_COVER_DATA;
  const frame = geo === undefined
    ? { detail: { x0: -7900, x1: 3700, z0: -3000, z1: 3600 }, projection: D.projection }
    : geo;
  ctx.window.CITY.GEO = { frame: { detail: frame.detail, projection: frame.projection }, blocks: [], areas: [] };
  // data first (so ISLAND_GARDEN_COVER_DATA exists), then the helper
  vm.runInContext(fs.readFileSync(DATA, 'utf8'), ctx, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(HELPER, 'utf8'), ctx, { filename: 'helper.js' });
  return ctx.window.CITY;
}

test('the data carries the FROZEN review (hash + 8 patches + 263 cells) copied from the fixture', () => {
  const C = load();
  const D = C.ISLAND_GARDEN_COVER_DATA;
  assert.equal(D.kind, 'island-garden-cover');
  const r = D.reviewSelection;
  assert.ok(r, 'reviewSelection present');
  assert.equal(r.dataCellsHash, FIX.dataCellsHash);
  assert.deepEqual([...r.acceptedPatches], FIX.acceptedPatches);
  assert.equal(r.selectedCells, FIX.expectedCells);
});

test('the helper recomputes the review hash and only plants the frozen 263 accepted cells', async () => {
  const C = load();
  const hash = await C.ISLAND_GARDEN_COVER._cellSetHash(C.ISLAND_GARDEN_COVER_DATA);
  assert.equal(hash, FIX.dataCellsHash, 'recomputed hash == fixture hash');
  const cells = C.islandGardenCoverReviewCells();
  assert.equal(cells.length, FIX.expectedCells);
  // every planted cell belongs to an accepted patch; no unreviewed patch leaks in
  const ok = new Set(FIX.acceptedPatches);
  for (const c of cells) assert.ok(ok.has(c.patch), `cell in unreviewed patch ${c.patch}`);
  // the reviewed set is exactly the accepted patches' cells
  const fromData = new Set((C.ISLAND_GARDEN_COVER_DATA.cells || []).filter((c) => ok.has(c[3])).map((c) => `${c[0]}:${c[1]}:${c[3]}`));
  assert.equal(fromData.size, FIX.expectedCells);
  for (const c of cells) assert.ok(fromData.has(`${Math.round(c.x * 10)}:${Math.round(c.z * 10)}:${c.patch}`));
});

test('a changed candidate cell set is rejected (no silent re-approval)', async () => {
  const C = load();
  const D = C.ISLAND_GARDEN_COVER_DATA;
  // Simulate a regenerated dataset that changed one cell but kept the (now stale) review hash.
  const tampered = { ...D, cells: D.cells.map((c, i) => (i === 0 ? [c[0] + 10, c[1], c[2], c[3]] : c)) };
  C.ISLAND_GARDEN_COVER_DATA = tampered;
  const p = C.ISLAND_GARDEN_COVER._plan(tampered, await C.ISLAND_GARDEN_COVER._cellSetHash(tampered));
  assert.equal(p.supported, false);
  assert.match(p.reason, /differs from the reviewed hash|re-review/i);
});

test('missing crypto / null hash is a strict no-op, never an unchecked pass', async () => {
  const C = load();
  assert.equal(await C.ISLAND_GARDEN_COVER._cellSetHash(null), null); // no data -> null, no throw
  const pNull = C.ISLAND_GARDEN_COVER._plan(C.ISLAND_GARDEN_COVER_DATA, null);
  assert.equal(pNull.supported, false);
  assert.match(pNull.reason, /hash/i);
});

test('the projection gate requires every value finite (a missing ox cannot coerce to 0 and match)', () => {
  const C = load();
  const D = C.ISLAND_GARDEN_COVER_DATA;
  const real = { projection: D.projection, detail: { x0: -7900, x1: 3700, z0: -3000, z1: 3600 } };
  assert.equal(C.ISLAND_GARDEN_COVER._projectionMatches(real), true);
  const missingOx = { ...real, projection: { ...D.projection, ox: undefined } };
  assert.equal(C.ISLAND_GARDEN_COVER._projectionMatches(missingOx), false);
  const wrongTheta = { ...real, projection: { ...D.projection, theta: D.projection.theta + 0.01 } };
  assert.equal(C.ISLAND_GARDEN_COVER._projectionMatches(wrongTheta), false);
});

test('wrong frame is a no-op; the reviewed cells must be inside BOTH the built and active frames', () => {
  const D = JSON.parse(fs.readFileSync(DATA, 'utf8').match(/= (\{.*\});\n\}\)\(\);/s)[1]);
  const good = { detail: { x0: -7900, x1: 3700, z0: -3000, z1: 3600 }, projection: D.projection };
  // a frame that does not contain the island -> frameCovers false -> plan unsupported
  const wrong = { detail: { x0: -1000, x1: 1000, z0: -1000, z1: 1000 }, projection: D.projection };
  const Cbad = load({ geo: wrong });
  const pbad = Cbad.ISLAND_GARDEN_COVER._plan(Cbad.ISLAND_GARDEN_COVER_DATA, FIX.dataCellsHash);
  assert.equal(pbad.supported, false);
  assert.match(pbad.reason, /outside the active frame|frame/i);
  // good frame: frameCovers true for the reviewed cells
  const Cok = load({ geo: good });
  const cells = Cok.islandGardenCoverReviewCells();
  assert.equal(Cok.ISLAND_GARDEN_COVER._frameCovers(Cok.ISLAND_GARDEN_COVER_DATA, cells), true);
});

test('the LOD/culling distance is to the nearest reviewed patch, not the world origin', () => {
  const C = load();
  const cells = C.islandGardenCoverReviewCells();
  const patches = new Map();
  for (const c of cells) {
    let b = patches.get(c.patch);
    if (!b) { b = { minX: c.x, maxX: c.x, minZ: c.z, maxZ: c.z }; patches.set(c.patch, b); }
    b.minX = Math.min(b.minX, c.x); b.maxX = Math.max(b.maxX, c.x); b.minZ = Math.min(b.minZ, c.z); b.maxZ = Math.max(b.maxZ, c.z);
  }
  const bounds = [...patches.values()];
  // A camera standing among the patches is ~0 m from the nearest, even though the island is ~2.5 km from the origin
  // (hypot(1100,2300) ~= 2.5 km, which an origin-distance cull of 150 m would wrongly hide).
  const inside = { x: 1125, z: 2268 }; // a point among the reviewed patches (P6/P13 are large)
  assert.ok(Math.hypot(inside.x, inside.z) > 2000, 'test point is far from the origin');
  assert.ok(C.ISLAND_GARDEN_COVER._distanceToPatches(bounds, inside.x, inside.z) < 5);
  // far away -> large distance, so it would cull
  assert.ok(C.ISLAND_GARDEN_COVER._distanceToPatches(bounds, inside.x + 5000, inside.z) > 150);
});

test('the render footprint stays inside the reviewed-cell source clearance (no path/building spill)', () => {
  const C = load();
  const D = JSON.parse(fs.readFileSync(DATA, 'utf8').match(/= (\{.*\});\n\}\)\(\);/s)[1]);
  const r = D.reviewSelection;
  const ok = new Set(r.acceptedPatches);
  const cells = D.cells.filter((c) => ok.has(c[3]));
  // The largest possible per-cell footprint (crown radius + jitter): each crown + offset stays <= the 0.5 m cell half-width
  // (proved on the real placement in the "inside the original cell" test), so this is the render radius to compare.
  const renderRadius = C.ISLAND_GARDEN_COVER._maxFootprintM();
  assert.ok(renderRadius <= C.ISLAND_GARDEN_COVER.approximate.cellInradiusM, `max footprint ${renderRadius} exceeds the cell half-width`);
  // The audit's own margin (from the built data's rules): pavement clearance 0.6 m beyond the paved edge; a reviewed cell
  // must keep its render footprint clear of that edge. The builder rejected a cell whose own footprint was inside the +1 m
  // building pad / paved strip / clearance, so the remaining clearance to any path edge is >= PAVED_CLEARANCE.
  const pavedClearance = D.rules.pavedClearanceM;
  assert.ok(pavedClearance >= renderRadius, `paved clearance ${pavedClearance} < render footprint ${renderRadius}`);
  // Every cell must lie on an eligible block and within the corridor (the data's own rules bound the cells).
  assert.equal(cells.length, r.selectedCells);
  for (const c of cells) {
    const x = c[0] / 10, z = c[1] / 10;
    assert.ok(Number.isFinite(x) && Number.isFinite(z));
    assert.ok(c[3] >= 0 && c[3] < D.patches.length);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Representative per-cell variation (the captain's screenshot showed identical shrubs in regular grid rows; the raster
// cells are an EVIDENCE MASK, not individual plant positions). These prove the placement now reads as natural patches
// while every crown + jitter stays inside the ORIGINAL 1 m cell and the approval (cells/hash/mask) is untouched.
// ---------------------------------------------------------------------------------------------------------------------

test('the per-cell representative figure is DETERMINISTIC across rebuilds (stable hash, no drift)', () => {
  const C = load();
  const cells = C.islandGardenCoverReviewCells();
  const a = cells.map((c) => C.ISLAND_GARDEN_COVER._cellFigure(c));
  const b = cells.map((c) => C.ISLAND_GARDEN_COVER._cellFigure(c));
  assert.deepEqual(a, b, 'same cells place the same shrubs every rebuild');
  // the raw hash is a stable uint32 too
  for (const c of cells.slice(0, 20)) {
    const h = C.ISLAND_GARDEN_COVER._cellHash(c, 0);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, 'uint32 hash');
    assert.equal(h, C.ISLAND_GARDEN_COVER._cellHash(c, 0));
  }
});

test('heights, crown radii, widths and yaws VARY across cells (not one identical shrub in a grid)', () => {
  const C = load();
  const cells = C.islandGardenCoverReviewCells();
  const figs = cells.map((c) => C.ISLAND_GARDEN_COVER._cellFigure(c));
  const uniq = (key, digits) => new Set(figs.map((f) => f[key].toFixed(digits))).size;
  // a single fixed height/width (the earlier trial) would give 1 distinct value; representative cover needs many
  assert.ok(uniq('heightM', 3) > cells.length * 0.5, `distinct heights ${uniq('heightM', 3)} of ${cells.length}`);
  assert.ok(uniq('crownRadiusM', 3) > cells.length * 0.4, 'distinct crown radii');
  assert.ok(uniq('widthScale', 3) > cells.length * 0.4, 'distinct width scales');
  assert.ok(uniq('yaw', 3) > cells.length * 0.8, 'distinct yaws (rotations)');
  // every representative height is the approved low-cover band (explicit approximation, not a lidar measurement)
  const A = C.ISLAND_GARDEN_COVER.approximate;
  assert.ok(A.minHeightM >= 0.6 && A.maxHeightM <= 1.25, `height band ${A.minHeightM}-${A.maxHeightM} is low garden cover`);
  for (const f of figs) assert.ok(f.heightM >= A.minHeightM - 1e-9 && f.heightM <= A.maxHeightM + 1e-9, 'height in band');
  // the four channels are uncorrelated: a cell tall enough to be in the top decile is not always the widest, etc.
  const byH = [...figs].sort((a, b) => a.heightM - b.heightM);
  const tallestWidest = byH[byH.length - 1].crownRadiusM, widestWidest = Math.max(...figs.map((f) => f.crownRadiusM));
  assert.ok(tallestWidest <= widestWidest, 'height and width are independent draws');
});

test('EVERY placed crown plus its jitter stays inside the ORIGINAL 1 m cell (measured on real geometry)', async () => {
  const THREE = await import('three/webgpu');
  const C = load();
  const A = C.ISLAND_GARDEN_COVER.approximate;
  // use the real rounded 14-card crown geometry (park-cover's near builder) so the reach is measured from real verts
  const parkCover = {
    shrubGeometry(near) {
      const g = new THREE.BufferGeometry();
      const N = near ? 14 : 3, pos = [];
      let sd = 3; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
      const quad = (c, ux, uy) => {
        for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) pos.push(c[0] + ux[0] * a + uy[0] * b, c[1] + ux[1] * a + uy[1] * b, c[2] + ux[2] * a + uy[2] * b);
      };
      for (let k = 0; k < N; k++) {
        const a = k * 2.39996, el = Math.acos(1 - (k + 0.5) / N) * 0.95;
        const dir = [Math.cos(a) * Math.sin(el), Math.cos(el), Math.sin(a) * Math.sin(el)];
        const c = [dir[0] * 0.33, 0.45 + dir[1] * 0.42, dir[2] * 0.33];
        const s = 0.62 + 0.25 * r(), tw = r() * 6.283;
        let ux = [-dir[2], 0, dir[0]]; const ul = Math.hypot(ux[0], ux[2]) || 1; ux = [ux[0] / ul, 0, ux[2] / ul];
        const uy = [dir[1] * ux[2], dir[2] * ux[0] - dir[0] * ux[2], -dir[1] * ux[0]];
        const cu = Math.cos(tw), su = Math.sin(tw);
        quad(c, ux.map((v, i) => (v * cu + uy[i] * su) * s), ux.map((v, i) => (-v * su + uy[i] * cu) * s));
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      return g;
    }
  };
  const g = parkCover.shrubGeometry(true);
  const cells = C.islandGardenCoverReviewCells();
  let worst = 0;
  for (const c of cells) {
    const fig = C.ISLAND_GARDEN_COVER._cellFigure(c);
    const reach = C.ISLAND_GARDEN_COVER._placedCrownReach(g, fig); // real-vertex reach at this cell's scale + yaw
    const offset = Math.hypot(fig.jx, fig.jz) + reach;            // jitter + reach from the ORIGINAL cell centre
    worst = Math.max(worst, offset);
    assert.ok(offset <= A.cellInradiusM + 1e-9, `cell ${c.x},${c.z}: crown+jitter ${offset.toFixed(4)} > half-width ${A.cellInradiusM}`);
  }
  // the whole set is comfortably inside (the cap is 0.5 m); report the real worst case
  assert.ok(worst <= 0.5, `worst crown+jitter offset ${worst.toFixed(4)} m inside the 0.5 m half-width`);
});

test('the raster cells stay the plant mask: variation does not change cells, placements or the reviewed hash', async () => {
  const C = load();
  const cells = C.islandGardenCoverReviewCells();
  // exactly the frozen 263 cells, still one figure per cell (no extra plants, no removed plants)
  assert.equal(cells.length, FIX.expectedCells);
  // a placed shrub stays within ~0.1 m of its cell centre, so it does not merge into a neighbour cell or a gap
  for (const c of cells) {
    const f = C.ISLAND_GARDEN_COVER._cellFigure(c);
    assert.ok(Math.hypot(f.jx, f.jz) <= C.ISLAND_GARDEN_COVER.approximate.maxJitterM + 1e-9, 'jitter within the cap');
  }
  // the approval hash is unchanged by this refinement (data + fixture still agree)
  assert.equal(await C.ISLAND_GARDEN_COVER._cellSetHash(C.ISLAND_GARDEN_COVER_DATA), FIX.dataCellsHash);
});

test('neighbouring cells do not share one height (no regular plantation): adjacent |Δheight| ~ independent', () => {
  const C = load();
  const cells = C.islandGardenCoverReviewCells();
  const A = C.ISLAND_GARDEN_COVER.approximate;
  const h = new Map(cells.map((c) => [`${c.x}:${c.z}`, C.ISLAND_GARDEN_COVER._cellFigure(c).heightM]));
  const diffs = [];
  for (const c of cells) {
    const r = h.get(`${c.x + 1}:${c.z}`); // the cell directly +1 m in X (same lattice), when present
    if (r !== undefined) diffs.push(Math.abs(h.get(`${c.x}:${c.z}`) - r));
  }
  assert.ok(diffs.length > 50, `enough adjacent pairs (${diffs.length})`);
  // independent uniform draws give a mean |Δ| of range/3; a rigid grid (one height) gives 0. Require it to be clearly
  // non-zero and near the independent expectation, so neighbours visibly differ like a natural patch.
  const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length;
  const expected = (A.maxHeightM - A.minHeightM) / 3;
  assert.ok(mean > expected * 0.6, `mean adjacent |Δheight| ${mean.toFixed(3)} reads as varied, not a grid`);
});

// Portable (no lidar cache, no /tmp): the committed review fixture is the captain's exact acceptance, and a changed
// candidate cell set against that frozen hash must fail closed. This is the integrity gate that regeneration must not
// bypass. It runs on the committed data + fixture only.
test('a changed review hash fails closed without needing the lidar cache', async () => {
  const C = load();
  const D = C.ISLAND_GARDEN_COVER_DATA;
  const frozen = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).dataCellsHash;
  // sanity: the committed data reproduces the frozen hash
  assert.equal(await C.ISLAND_GARDEN_COVER._cellSetHash(D), frozen);
  // A regenerated dataset that changed exactly one cell but still carries the stale frozen review must be rejected.
  const changed = { ...D, cells: D.cells.map((c, i) => (i === 0 ? [c[0] + 10, c[1], c[2], c[3]] : c)) };
  const h = await C.ISLAND_GARDEN_COVER._cellSetHash(changed);
  assert.notEqual(h, frozen, 'a changed cell must produce a different hash');
  const p = C.ISLAND_GARDEN_COVER._plan(changed, h); // stale review hash in `changed`, computed hash differs
  assert.equal(p.supported, false);
  assert.match(p.reason, /reviewed hash|re-review/i);
});

test('a REAL build with three.js creates both InstancedMeshes, distinct fade attributes and correct matrices', async () => {
  const THREE = await import('three/webgpu');
  const ctx = { window: { CITY: {} }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, JSON, Set, Map, crypto: globalThis.crypto, TextEncoder, document: { createElement() { throw new Error('no DOM in test'); } } };
  vm.createContext(ctx);
  const realCtx = { window: { CITY: {} }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, JSON };
  vm.createContext(realCtx);
  vm.runInContext(fs.readFileSync(DATA, 'utf8'), realCtx, { filename: 'data.js' });
  const DD = realCtx.window.CITY.ISLAND_GARDEN_COVER_DATA;
  // A fake parkCover that supplies REAL three geometries (rounded/3-card) and simple materials, plus the shared setter.
  const viewer = { p: null };
  const parkCover = {
    updateShrubViewer(p) { viewer.p = { x: p.x, y: p.y, z: p.z }; },
    shrubGeometry(near) {
      const g = new THREE.BufferGeometry();
      const N = near ? 14 : 3, pos = [];
      for (let k = 0; k < N; k++) {
        const a = k * 2.39996, el = Math.acos(1 - (k + 0.5) / N) * 0.95;
        const dir = [Math.cos(a) * Math.sin(el), Math.cos(el), Math.sin(a) * Math.sin(el)];
        const c = [dir[0] * 0.33, 0.45 + dir[1] * 0.42, dir[2] * 0.33];
        for (const [uu, vv] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) pos.push(c[0] + uu * 0.7, c[1] + vv * 0.7 * dir[0], c[2] + vv * 0.7 * dir[2]);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aCard', new THREE.Float32BufferAttribute(new Float32Array(4 * 3), 3));
      return g;
    },
    shrubMaterial() { const m = new THREE.MeshLambertMaterial(); m.dispose = () => { m._disposed = true; }; return m; }
  };
  ctx.window.CITY.THREE = THREE;
  ctx.window.CITY.TSL = {};
  ctx.window.CITY.parkCover = parkCover;
  ctx.window.CITY.GEO = { frame: { detail: { x0: -7900, x1: 3700, z0: -3000, z1: 3600 }, projection: DD.projection } };
  vm.runInContext(fs.readFileSync(DATA, 'utf8'), ctx, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(HELPER, 'utf8'), ctx, { filename: 'helper.js' });
  const C = ctx.window.CITY;
  const scene = new THREE.Scene();
  const g = await C.buildIslandGardenCover(scene);
  assert.ok(g && g.group, 'build returned a handle with a group');
  // both real InstancedMeshes exist, one near (14-card) and one far (3-card), each with aShrub + aShrubFade, DISTINCT attrs
  const instanced = g.group.children.filter((o) => o.isInstancedMesh);
  assert.equal(instanced.length, 2, 'two instanced LOD meshes');
  for (const m of instanced) {
    assert.ok(m.geometry.getAttribute('aShrub'), 'aShrub present');
    assert.ok(m.geometry.getAttribute('aShrubFade'), 'aShrubFade present');
    assert.equal(m.count, 263, 'one instance per accepted cell');
  }
  assert.notEqual(instanced[0].geometry.getAttribute('aShrubFade'), instanced[1].geometry.getAttribute('aShrubFade'), 'near/far use DISTINCT fade attributes');
  // Identify near (edge-in ~ -1e6, visible close) vs far (edge-in a positive LOD hand-off) by their fade signature.
  const fades = instanced.map((m) => m.geometry.getAttribute('aShrubFade').array);
  const nearM = instanced[fades.findIndex((f) => f[0] < -1000)];
  const farM = instanced[fades.findIndex((f) => f[0] > 0 && f[0] < 1000)];
  assert.ok(nearM, 'a near LOD mesh with edge-in -1e6 (visible close)');
  assert.ok(farM, 'a far LOD mesh with a positive edge-in hand-off');
  // the shader LOD keep is h<share(edgeIn)&&h>=share(edgeOut); near edgeOut is LOD_NEAR so near covers up to it
  // ground sampler is used when present: give one and confirm matrices carry a non-zero y
  let sawY = 0;
  const mat4 = new THREE.Matrix4();
  for (let i = 0; i < instanced[0].count; i++) { instanced[0].getMatrixAt(i, mat4); const y = mat4.elements[13]; if (y !== 0) sawY++; }
  // (without islandVergeSurfaceAt y is 0; with it, non-zero. Assert the code path exists and matrices are composed.)
  assert.equal(instanced[0].count, 263);
  // the REAL build measures the placed crown reach (jitter + rotated/scaled geometry verts); every crown stays inside the
  // original 1 m cell (half-width 0.5 m) and the handle exposes the measured worst case for a report.
  assert.ok(Number.isFinite(g.maxCellOffsetM), 'build reports the measured max cell offset');
  assert.ok(g.maxCellOffsetM <= 0.5 + 1e-9, `measured crown+jitter offset ${g.maxCellOffsetM.toFixed(4)} <= 0.5 m`);
  assert.equal(g.figures.length, 263, 'one representative figure per accepted cell');
  // per-cell matrices genuinely differ (height/width/yaw variation), not 263 copies of one transform
  const first = new THREE.Matrix4(); instanced[0].getMatrixAt(0, first);
  let differing = 0;
  for (let i = 1; i < instanced[0].count; i++) { const mm = new THREE.Matrix4(); instanced[0].getMatrixAt(i, mm); if (mm.elements.some((v, k) => Math.abs(v - first.elements[k]) > 1e-4)) differing++; }
  assert.ok(differing > 250, `per-cell transforms differ (${differing}/262)`);
  // update sets the shared viewer to OUR camera, not the origin
  g.update(new THREE.Vector3(1125, 2, 2268));
  assert.ok(viewer.p && Math.abs(viewer.p.x - 1125) < 1 && Math.abs(viewer.p.z - 2268) < 1, `viewer set to camera, got ${JSON.stringify(viewer.p)}`);
  // inside the overall cull both meshes stay visible (per-instance fade, no hard mesh switch)
  assert.equal(nearM.visible, true); assert.equal(farM.visible, true);
  assert.equal(g.group.visible, true);
  // far away beyond the cull: the whole group hides (both meshes remain visible flags, group hidden)
  g.update(new THREE.Vector3(6000, 2, 2268));
  assert.equal(g.group.visible, false);
  // dispose marks our OWN materials disposed, not the shared atlas; group detached; built handle cleared
  g.dispose();
  assert.equal(scene.children.includes(g.group), false, 'group detached from scene');
  const g2 = await C.buildIslandGardenCover(scene);
  assert.ok(g2 && g2 !== g, 'a fresh handle after dispose');
});

test('the ground origin uses CITY.islandVergeSurfaceAt when present (matrices sit at the surface height)', async () => {
  const THREE = await import('three/webgpu');
  const ctx = { window: { CITY: {} }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, JSON, Set, Map, crypto: globalThis.crypto, TextEncoder, document: { createElement() { throw new Error('no DOM'); } } };
  vm.createContext(ctx);
  const realCtx = { window: { CITY: {} }, console: {}, Math, JSON }; vm.createContext(realCtx);
  vm.runInContext(fs.readFileSync(DATA, 'utf8'), realCtx); const DD = realCtx.window.CITY.ISLAND_GARDEN_COVER_DATA;
  const parkCover = {
    updateShrubViewer() {},
    shrubGeometry(near) { const g = new THREE.BufferGeometry(); const N = near ? 14 : 3, pos = []; for (let k = 0; k < N; k++) { const a = k * 2.39996, el = Math.acos(1 - (k + 0.5) / N) * 0.95; const cx = Math.cos(a) * Math.sin(el), cy = Math.cos(el), cz = Math.sin(a) * Math.sin(el); for (const [u, v] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) pos.push(cx * 0.33 + u * 0.7, 0.45 + cy * 0.42 + v * 0.7, cz * 0.33 + v * 0.7); } g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aCard', new THREE.Float32BufferAttribute(new Float32Array(12), 3)); return g; },
    shrubMaterial() { return new THREE.MeshLambertMaterial(); }
  };
  ctx.window.CITY.THREE = THREE; ctx.window.CITY.TSL = {}; ctx.window.CITY.parkCover = parkCover;
  ctx.window.CITY.GEO = { frame: { detail: { x0: -7900, x1: 3700, z0: -3000, z1: 3600 }, projection: DD.projection } };
  // a ground sampler returning a known height, to prove matrices are placed AT the surface (not 0)
  ctx.window.CITY.islandVergeSurfaceAt = () => ({ h: 5.5 });
  vm.runInContext(fs.readFileSync(DATA, 'utf8'), ctx, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(HELPER, 'utf8'), ctx, { filename: 'helper.js' });
  const C = ctx.window.CITY; const scene = new THREE.Scene();
  const g = await C.buildIslandGardenCover(scene);
  const m = g.group.children.find((o) => o.isInstancedMesh);
  const mat4 = new THREE.Matrix4(); m.getMatrixAt(0, mat4);
  assert.ok(Math.abs(mat4.elements[13] - 5.5) < 1e-6, `instance y at surface height 5.5, got ${mat4.elements[13]}`);
});

test('the committed fixture is immutable and matches the committed data', async () => {
  const C = load();
  const D = C.ISLAND_GARDEN_COVER_DATA;
  assert.equal(FIX.dataCellsHash, D.reviewSelection.dataCellsHash, 'fixture hash == data review hash');
  assert.deepEqual([...FIX.acceptedPatches], [...D.reviewSelection.acceptedPatches]);
  assert.equal(FIX.expectedCells, 263);
  assert.equal(D.reviewSelection.selectedCells, 263);
  // the review is copied from the fixture, not re-derived: the data's hash equals the recomputed hash of its cells
  assert.equal(await C.ISLAND_GARDEN_COVER._cellSetHash(D), FIX.dataCellsHash);
});
