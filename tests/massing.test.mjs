// ?massing=1 (docs/massing-buildings.md, st-2nl): every building in the detailed city from the City's 3D Massing polygon
// (data/toronto-massing.bin, tools/build-massing.mjs, read by js/massing-data.js), extruded by tsl-materials.js
// createFootprintFacades and solid by its polygon in world-collision.js.
// - the data: decodes losslessly (repacked, the same bytes), keyed by durable massing ID to the committed geodata's
//   rows (js/toronto-geodata-ids.js), every row a record or a listed skip, rings clean and simple, wound as stored,
//   the street fronts as buildings.js would have found them from the roads
// - the geometry: walls face out of the mass (into a courtyard for a hole's), roofs face up and cover the polygon,
//   the facade frame attributes stay in range (Kensington Market and the Financial District)
// - the collision: every Kensington building pushes a walker and the car out of it, never across a wall, never NaN;
//   and the degenerate rings of mrdoob's 28c0af7 (Slop New York's polygon collision fix) as fixtures
// - buildCityBlocks: without the data, no footprint material, mesh or polygon collider; with it, exactly the records'
//   rows lose their boxes, and every footprint vertex has its normal, frame and paint
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import * as CORE from '../vendor/three/three.core.js';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows, massingId, rowCheck, MASSING_URL } from '../js/massing-data.js';
import { packGeo } from '../tools/geo-pack.mjs';
import { idResolver } from '../tools/geo-ids.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const bin = fs.readFileSync(new URL('../data/toronto-massing.bin', import.meta.url));
const window = { CITY: {} };
const ctx = vm.createContext({ window, Math, JSON, Object, Array, Number, Map, Set, Float64Array, Uint8Array, WeakMap, Infinity, NaN, isFinite });
for (const f of ['js/toronto-geodata.js', 'js/toronto-geodata-ids.js', 'js/world-collision.js', 'js/city-config.js']) vm.runInContext(read(f), ctx);
const { GEO, GEO_IDS, WorldCollision: W, nearestRoads } = window.CITY;
const { MASSING: M } = await unpackGeo(bin);
const loaded = massingRows(M, GEO);

// createFootprintFacades, as tsl-materials.js defines it, with three's core (the facade materials need a GPU)
const tsl = read('js/tsl-materials.js');
const fnSrc = tsl.slice(tsl.indexOf('function createFootprintFacades('), tsl.indexOf('const _carPaintCache'));
const WALL_KINDS = { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4 };
const createFootprintFacades = vm.runInNewContext(`(${fnSrc})`, { THREE: CORE, WALL_KINDS, Math, Map, Number });

const area = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };
function inRing(x, z, r) {
  let yes = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) yes = !yes;
  }
  return yes;
}
const records = [...loaded.rows].map(([row, r]) => ({ row, ...r }));
// the pilot's area (Kensington Market, inset from its boundary streets) and the Financial District round King & Bay
const KENSINGTON = [[-1147.51, -1778.44], [-1995.31, -1784.14], [-1948.04, -1253.38], [-1117.34, -1218.66]];
const inKensington = (r) => inRing(GEO.buildings[r.row][0], GEO.buildings[r.row][1], KENSINGTON);
const inFinancial = (r) => Math.abs(GEO.buildings[r.row][0] - 100) < 350 && Math.abs(GEO.buildings[r.row][1] + 364) < 350;

test('the sidecar decodes losslessly: its layer repacks to the very bytes committed', () => {
  assert.ok(packGeo({ MASSING: M }).file.equals(bin), 'decode -> encode is the identity');
  const hash = createHash('sha256').update(bin).digest('hex').slice(0, 12);
  assert.equal(MASSING_URL, `./data/toronto-massing.bin?v=${hash}`, 'js/massing-data.js asks for this file by its hash');
  // every ring corner is on the stored grid, as the build snapped it
  for (const r of records) for (const ring of r.rings) for (const [x, z] of ring) assert.ok(Math.round(x * 10) / 10 === x && Math.round(z * 10) / 10 === z);
  // (column lengths agree with the counts)
  const n = M.fid.length;
  for (const k of ['part', 'row', 'base', 'holes', 'partyN', 'hiddenN', 'streetN']) assert.equal(M[k].length, n, k);
  const rings = M.holes.reduce((s, h) => s + h + 1, 0);
  assert.equal(M.corners.length, rings);
  assert.equal(M.start.length, rings * 2);
  assert.equal(M.step.length, (M.corners.reduce((s, c) => s + c, 0) - rings) * 2);
  assert.equal(M.partyEdge.length, M.partyN.reduce((s, c) => s + c, 0));
  assert.equal(M.partyCover.length, M.partyEdge.length);
  assert.equal(M.hiddenEdge.length, M.hiddenN.reduce((s, c) => s + c, 0));
  assert.equal(M.streetEdge.length, M.streetN.reduce((s, c) => s + c, 0));
});

test('records are keyed by durable massing ID to the committed geodata, every row a record or a listed skip', () => {
  assert.equal(M.schema, 2);
  assert.equal(M.edition, '3DMassingShapefile_2025_WGS84');
  assert.equal(M.dataset, 'to-3dmassing-2025');
  assert.equal(M.geodata, createHash('sha256').update(read('js/toronto-geodata.js')).digest('hex').slice(0, 16), 'built against this geodata');
  assert.equal(M.geodata, GEO_IDS.geodata);
  assert.equal(M.rows, GEO.buildings.length);
  assert.equal(M.rowCheck, rowCheck(GEO.buildings));
  assert.equal(loaded.error, null);
  assert.equal(loaded.rejected, 0, 'no record rejected against the rows it was built for');
  assert.equal(loaded.rows.size, M.fid.length);
  const resolve = idResolver(GEO_IDS);
  const ids = new Set();
  for (let i = 0; i < M.fid.length; i++) {
    const id = massingId(M, i);
    assert.match(id, /^to-3dmassing-2025:\d+(\.\d+)?$/);
    assert.ok(!ids.has(id), `${id} once`); ids.add(id);
    assert.equal(GEO_IDS.buildings[M.row[i]], id, 'the ID -> row index agrees with js/toronto-geodata-ids.js');
    assert.deepEqual(resolve(id), { kind: 'building', row: M.row[i] }, 'idResolver resolves it to that row');
    if (i) assert.ok(M.fid[i] > M.fid[i - 1] || (M.fid[i] === M.fid[i - 1] && M.part[i] > M.part[i - 1]), 'in record order');
    assert.ok(M.base[i] >= 0 && M.base[i] < GEO.buildings[M.row[i]][4], 'a podium base stays under the roof');
  }
  // every row is a record or a skip with its reason, never both
  const skipped = new Set(M.skipRow);
  assert.equal(skipped.size, M.skipRow.length);
  for (const r of M.row) assert.ok(!skipped.has(r));
  assert.equal(M.row.length + M.skipRow.length, GEO.buildings.length, 'every row accounted for');
  for (const w of M.skipWhy) assert.ok(typeof M.reasons[w] === 'string');
  assert.ok(M.skipRow.length < GEO.buildings.length / 1000, `${M.skipRow.length} skipped`);
  // a sidecar for other rows is refused whole, and a record whose row's centre is off its outline on its own
  const moved = { ...GEO, buildings: GEO.buildings.map((b, i) => (i === 7 ? [b[0] + 0.1, ...b.slice(1)] : b)) };
  assert.match(massingRows(M, moved).error, /other geodata/);
  assert.equal(massingRows(M, moved).rows.size, 0);
  assert.match(massingRows({ ...M, schema: 1 }, GEO).error, /schema/);
  const far = { ...GEO, buildings: GEO.buildings.map((b, i) => (i === M.row[0] ? [b[0] + 500, ...b.slice(1)] : b)) };
  const one = massingRows({ ...M, rowCheck: rowCheck(far.buildings) }, far);
  assert.equal(one.rejected, 1);
  assert.ok(!one.rows.has(M.row[0]));
});

test('rings are clean, simple and wound as stored (outer counter-clockwise in x/z, courtyards clockwise)', () => {
  const cross = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  let selfCrossing = 0, holes = 0, multi = 0;
  for (const r of records) {
    r.rings.forEach((ring, i) => {
      assert.ok(ring.length >= 3 && ring.flat().every(Number.isFinite), `${r.id} ring ${i}`);
      assert.ok(i === 0 ? area(ring) > 0 : area(ring) < 0, `${r.id} ring ${i} winding`);
      for (let k = 0; k < ring.length; k++) assert.ok(ring[k][0] !== ring[(k + 1) % ring.length][0] || ring[k][1] !== ring[(k + 1) % ring.length][1], 'no repeated corner');
      if (i) assert.ok(ring.every(([x, z]) => inRing(x, z, r.rings[0])), `${r.id} courtyard inside its outline`);
    });
    holes += r.rings.length - 1;
    if (/\.\d+$/.test(r.id)) multi++;
    const ring = r.rings[0], n = ring.length;
    for (let a = 0; a < n; a++) for (let b = a + 2; b < n; b++) {
      if (a === 0 && b === n - 1) continue;
      if (cross(ring[a], ring[(a + 1) % n], ring[b], ring[(b + 1) % n])) selfCrossing++;
    }
    const kinds = new Map();
    for (const k of r.hidden) { assert.ok(Number.isInteger(k) && k < n, `${r.id} hidden edge ${k}`); kinds.set(k, 'hidden'); }
    for (const [k, h] of r.covered) {
      assert.ok(Number.isInteger(k) && k < n && h > 0 && !kinds.has(k), `${r.id} party wall ${k}`);
      kinds.set(k, 'party');
    }
    for (const k of r.street.keys()) assert.ok(Number.isInteger(k) && k < n && kinds.get(k) !== 'hidden', `${r.id} street edge ${k}`);
  }
  assert.equal(selfCrossing, 0, 'no outer ring crosses itself');
  assert.ok(holes > 100 && multi > 200, `courtyards (${holes}) and the parts of multi-polygon records (${multi}) are in`);
});

test('the street fronts are those buildings.js found from the roads (Kensington Market)', () => {
  let edges = 0;
  for (const r of records.filter(inKensington)) {
    const outer = r.rings[0];
    for (let i = 0; i < outer.length; i++) {
      const [ax, az] = outer[i], [bx, bz] = outer[(i + 1) % outer.length];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (r.hidden.has(i) || len < 2) continue;
      const nx = dz / len, nz = -dx / len, mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const road = nearestRoads(mx, mz, 40)[0];
      let want;
      if (road) {
        const tx = road.px - mx, tz = road.pz - mz, d = Math.hypot(tx, tz);
        if (d > 0.5 && (tx * nx + tz * nz) / d > 0.7 && d - (road.road.w || 0) / 2 < 15) want = (road.road.w || 0) >= 9;
      }
      assert.equal(r.street.get(i), want, `${r.id} edge ${i}`);
      edges++;
    }
  }
  assert.ok(edges > 3000, `${edges} edges`);
});

test('footprint walls face out of the mass, roofs face up and cover the footprint, frames stay in range', () => {
  const sample = records.filter((r) => inKensington(r) || inFinancial(r));
  assert.ok(sample.length > 800, `${sample.length} buildings`);
  const recs = sample.map((r) => ({ cx: GEO.buildings[r.row][0], cz: GEO.buildings[r.row][1], rings: r.rings, base: r.base, h: GEO.buildings[r.row][4], kinds: r.rings[0].map(() => WALL_KINDS.rear), tone: 0.5, paint: [0.5, 0.4, 0.3, 2.5] }));
  const built = createFootprintFacades(new CORE.MeshBasicMaterial(), recs);
  // (an edge another part's wall stands on has none)
  const hiddenRecs = recs.map((r, k) => ({ ...r, kinds: r.rings[0].map((_, i) => (sample[k].hidden.has(i) ? -1 : WALL_KINDS.rear)) }));
  const hiddenCount = sample.reduce((s, r) => s + r.hidden.size, 0);
  assert.ok(hiddenCount > 0);
  assert.equal(createFootprintFacades(new CORE.MeshBasicMaterial(), hiddenRecs).walls, built.walls - hiddenCount);
  const edges = recs.reduce((s, r) => s + r.rings.reduce((t, ring) => t + ring.length, 0), 0);
  assert.equal(built.walls, edges, 'a wall per edge');
  assert.equal(built.triangles, edges * 2 + recs.reduce((s, r) => s + r.rings.reduce((t, ring) => t + ring.length, 0) + 2 * (r.rings.length - 1) - 2, 0), 'two per wall, earcut\'s n + 2h - 2 per roof');
  for (const m of built.meshes) {
    assert.ok(m.userData.shadowStandIn === true, 'opts in to the shadow stand-ins');
    const g = m.geometry, wall = g.attributes.facadeWall.array, box = g.attributes.box.array;
    for (let i = 0; i < wall.length; i += 3) assert.ok(wall[i] >= 0 && wall[i] <= 1 && wall[i + 1] >= -1e-3, 'along 0..1, metres below the top >= 0');
    for (let i = 0; i < box.length; i += 4) assert.ok(box[i] > 0 && box[i + 1] > 0 && Number.isFinite(box[i + 3]));
  }
  // building by building: each triangle's winding agrees with its normal; a wall faces out of its own building's mass
  // (or into its courtyard); the roof covers exactly the footprint
  let roofArea = 0, wantArea = 0, outward = 0, inward = 0;
  const bad = [];
  for (const r of recs) {
    wantArea += r.rings.reduce((s, ring) => s + area(ring), 0);
    const [m] = createFootprintFacades(new CORE.MeshBasicMaterial(), [r]).meshes;
    const g = m.geometry, pos = g.attributes.position.array, nor = g.attributes.normal.array, idx = g.index.array;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const k = idx[t] * 3, stored = [nor[k], nor[k + 1], nor[k + 2]];
      const len = Math.hypot(...n);
      if (stored[1] > 0.5) roofArea += len / 2;
      if (len < 0.02) continue; // (a sliver under 0.01 m² whose winding float32 positions can't resolve)
      if ((n[0] * stored[0] + n[1] * stored[1] + n[2] * stored[2]) / len < 0.99) { bad.push({ id: r.cx + ',' + r.cz, a, b, c }); continue; }
      if (stored[1] > 0.5) continue;
      const mx = (a[0] + b[0] + c[0]) / 3 + stored[0] * 0.05, mz = (a[2] + b[2] + c[2]) / 3 + stored[2] * 0.05;
      if (inRing(mx, mz, r.rings[0]) && !r.rings.slice(1).some((h) => inRing(mx, mz, h))) inward++; else outward++;
    }
  }
  assert.deepEqual(bad.slice(0, 3), [], `${bad.length} triangles wound against their normal`);
  assert.ok(Math.abs(roofArea - wantArea) / wantArea < 0.001, `roof caps cover the footprints (${roofArea.toFixed(0)} of ${wantArea.toFixed(0)} m²)`);
  // (5 cm out of a wall can land back in the same outline where it nearly touches itself: a notch or two)
  assert.ok(inward <= 4, `walls face out of their mass (${inward} of ${inward + outward} wall triangles face in)`);
});

test('every Kensington building is solid by its polygon: walking or driving into any wall never ends inside it', () => {
  // (as controllers.js solveContacts: 0.1 m steps, up to four push-out passes each, from 5 m out, square on and slanted)
  const colliders = records.filter(inKensington).map((r) => {
    const outer = r.rings[0];
    const xs = outer.map((p) => p[0]), zs = outer.map((p) => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), maxY: 10, polygon: outer.map(([x, z]) => ({ x, z })), massing: r.id };
  });
  const runs = { car: 0, walk: 0 }, stopped = { car: 0, walk: 0 };
  for (const c of colliders) {
    const pts = c.polygon;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 2.5) continue;
      const nx = (b.z - a.z) / L, nz = -(b.x - a.x) / L, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      for (const mode of ['car', 'walk']) for (const slant of (i % 2 ? [-0.6, 0.25] : [0.6, -0.25])) {
        const heading = Math.atan2(-nx, -nz) + slant;
        const body = (x, z) => (mode === 'car' ? W.carShape(x, z, heading) : W.circleShape(x, z, 0.48));
        let x = mx + nx * 5, z = mz + nz * 5;
        if (W.contact(body(x, z), c)) continue; // (a notch too narrow to start in)
        runs[mode]++;
        let touched = false;
        for (let step = 0; step < 60; step++) {
          x += Math.sin(heading) * 0.1; z += Math.cos(heading) * 0.1;
          for (let pass = 0; pass < 4; pass++) {
            const hit = W.contact(body(x, z), c);
            if (!hit || !(hit.depth > 0)) break;
            assert.ok(Number.isFinite(hit.depth) && Number.isFinite(hit.nx) && Number.isFinite(hit.nz), `${c.massing}: finite contact`);
            x += hit.nx * (hit.depth + W.SKIN); z += hit.nz * (hit.depth + W.SKIN);
            touched = true;
          }
          assert.ok(!W.inside(x, z, pts), `${c.massing} edge ${i}: the ${mode} ends up inside`);
        }
        if (touched) stopped[mode]++;
      }
    }
  }
  assert.ok(runs.car > 4000 && runs.walk > 4000, JSON.stringify(runs));
  assert.ok(stopped.car / runs.car > 0.8 && stopped.walk / runs.walk > 0.8, `the walls stop them: ${JSON.stringify(stopped)} of ${JSON.stringify(runs)}`);
});

test('degenerate and grazing outlines (28c0af7 fixtures) never give NaN or a push through the wall', () => {
  const poly = (pts) => {
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    return { minX: Math.min(...xs) - 0, maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), maxY: 10, polygon: pts.map(([x, z]) => ({ x, z })) };
  };
  const finite = (h) => !h || (Number.isFinite(h.depth) && Number.isFinite(h.nx) && Number.isFinite(h.nz) && Number.isFinite(h.nx * h.depth));
  // a long, slightly tilted wall grazed from the street: a tiny push back out, not across the block
  const tilted = poly([[-50, -5e-11], [50, 5e-11], [50, 20], [-50, 20]]);
  for (const s of [W.carShape(0, -2.24, 0), W.circleShape(0, -0.47, 0.48)]) {
    const h = W.contact(s, tilted);
    assert.ok(finite(h));
    if (h) assert.ok(h.nz < -0.99 && h.depth < 0.1, `grazing push ${JSON.stringify(h)}`);
  }
  // a courtyard corner (the outline's notch): back into the notch, a short push
  const notch = poly([[0, 0], [12, 0], [12, 12], [9, 12], [9, 3], [3, 3], [3, 12], [0, 12]]);
  for (const s of [W.circleShape(3.3, 4, 0.48), W.carShape(6, 4.9, 0), W.carShape(6, 5.2, 0.5)]) {
    const h = W.contact(s, notch);
    assert.ok(h && finite(h), 'the corner touches');
    const x = s.x + h.nx * h.depth, z = s.z + h.nz * h.depth;
    assert.ok(h.depth < 1.5 && x > 3 && x < 9 && z > 3, `stays in the notch (${x.toFixed(2)}, ${z.toFixed(2)}, depth ${h.depth.toFixed(2)})`);
  }
  // a narrow slot, a sub-1e-10 sliver, a ring of one point, an empty one and NaN corners
  const slot = poly([[0, 0], [10, 0], [10, 10], [5.3, 10], [5.3, 2], [4.7, 2], [4.7, 10], [0, 10]]);
  assert.ok(finite(W.contact(W.circleShape(5, 6, 0.48), slot)));
  const sliver = poly([[0, 0], [4e-11, 0], [4e-11, 4e-11], [0, 4e-11]]);
  assert.ok(finite(W.contact(W.circleShape(2e-11, 2e-11, 0.48), sliver)));
  assert.ok(finite(W.contact(W.carShape(0, 0, 0.3), sliver)));
  const point = poly([[0, 0], [0, 0]]);
  assert.ok(finite(W.contact(W.carShape(0, 0, 0.3), point)));
  assert.ok(finite(W.contact(W.circleShape(0, 0, 0.48), point)));
  const empty = { minX: -1, maxX: 1, minZ: -1, maxZ: 1, maxY: 10, polygon: [] };
  assert.ok(finite(W.contact(W.circleShape(0, 0, 0.48), empty)));
  assert.ok(finite(W.contact(W.carShape(0, 0, 0.3), empty)));
  const nan = { minX: -1, maxX: 1, minZ: -1, maxZ: 1, maxY: 10, polygon: [{ x: NaN, z: NaN }, { x: 0, z: 0 }, { x: 1, z: 0 }] };
  assert.ok(finite(W.contact(W.circleShape(0.2, 0.1, 0.48), nan)));
  assert.ok(finite(W.contact(W.carShape(0.2, 0.1, 0.3), nan)));
});

// buildings.js buildCityBlocks with stand-in materials (no GPU): the default build is untouched, and with the loaded
// sidecar (window.CITY.MASSING, as main.js sets it under ?massing=1) its rows become polygon meshes with every
// attribute the facade shaders read, and polygon colliders
function buildBlocks(massing) {
  const anyNode = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : anyNode), apply: () => anyNode });
  class MeshStandardNodeMaterial extends CORE.MeshStandardMaterial {}
  const win = { CITY: { THREE: { ...CORE, MeshStandardNodeMaterial }, Addons: { mergeGeometries: () => new CORE.BufferGeometry() }, DEBUG_ROADS: false } };
  win.CITY.TSL = Object.fromEntries(['Fn', 'float', 'color', 'uv', 'attribute', 'fract', 'smoothstep', 'mix', 'abs'].map((n) => [n, anyNode]));
  const c = vm.createContext({ window: win, Math, JSON, Object, Array, Number, Map, Set, Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, WeakMap, Infinity, NaN, console, performance });
  for (const f of ['js/toronto-geodata.js', 'js/city-config.js']) vm.runInContext(read(f), c);
  if (massing) win.CITY.MASSING = massing;
  const made = [];
  Object.assign(win.CITY, {
    WALL_KINDS, createFootprintFacades,
    createRenderedFacadeMaterial: (o) => { made.push(o); return new CORE.MeshBasicMaterial(); },
    createCurtainWallMaterial: (o) => { made.push(o); return new CORE.MeshBasicMaterial(); },
    createFacadeBoxes: (m, boxes) => new CORE.InstancedMesh(new CORE.BoxGeometry(1, 1, 1), m, boxes.length),
    createFireEscapes: () => ({ begin() {}, add() {}, end() {} })
  });
  vm.runInContext(read('js/buildings.js'), c);
  const t = performance.now();
  const out = win.CITY.buildCityBlocks(new CORE.Scene());
  return { out, made, stats: win.CITY.massingStats, ms: performance.now() - t };
}

test('buildCityBlocks: default unchanged without the data; with it, every record a painted polygon and a collider', { timeout: 120000 }, () => {
  const plain = buildBlocks(null), poly = buildBlocks(loaded);
  const boxes = (r) => r.out.group.children.filter((o) => /^Buildings_/.test(o.name)).reduce((s, o) => s + o.count, 0);
  assert.equal(plain.made.filter((o) => o.footprintLocal).length, 0, 'no footprint materials by default');
  assert.equal(plain.out.group.children.filter((o) => /Massing/.test(o.name)).length, 0);
  assert.equal(plain.out.colliders.filter((c) => c.polygon).length, 0);
  assert.equal(plain.stats, undefined);
  assert.equal(poly.stats.buildings, records.length);
  assert.equal(boxes(plain) - boxes(poly), poly.stats.boxesReplaced, 'exactly the records\' rows lose their boxes');
  assert.ok(boxes(poly) < 60, `only the skipped rows keep boxes (${boxes(poly)})`);
  assert.equal(poly.out.colliders.filter((c) => c.massing).length, records.length);
  const meshes = poly.out.group.children.filter((o) => /^MassingBuildings_/.test(o.name));
  assert.equal(meshes.length, poly.stats.meshes);
  for (const m of meshes) {
    const g = m.geometry, n = g.attributes.position.count;
    for (const a of ['normal', 'box', 'facadeWall', 'paint']) assert.equal(g.attributes[a]?.count, n, `${m.name} has ${a} per vertex`);
    const p = g.attributes.paint.array;
    for (let i = 0; i < p.length; i += 4) assert.ok(p[i] + p[i + 1] + p[i + 2] > 0.05 && Number.isFinite(p[i + 3]), `${m.name}: painted (vertex ${i / 4})`);
  }
  // (the city-wide cost in node, for st-2nl.3: printed, not asserted)
  console.log(`# buildCityBlocks: boxes ${plain.ms.toFixed(0)} ms; polygons ${poly.ms.toFixed(0)} ms: ${JSON.stringify(poly.stats)}`);
});
