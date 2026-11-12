// Toronto Islands flush verge (js/waterfront-island-lanes.js gates + js/city-grid.js producer, st-sb3r.23 follow-up).
//
// The interior lanes are photographed with flush green verges and no raised kerb. The producer replaces the former
// concrete walk band and stone kerb on the source-confirmed edges with a real ramp from the road at the block outline
// to the existing yard at the prop inset, and stores the exact rendered triangles. These tests prove:
//   - the pure gates are source-scoped (only the photo-evidenced rows), pure, and no-op on a mismatched frame;
//   - the ramp is a real full-band ramp (not a 0.22 m rise over the 0.25 m kerb), and the former band/kerb are not
//     built on the flagged edges (no overlay, no native slab side poking through);
//   - the exact surface sampler matches a raycast of the actual rendered ramp geometry, including corners, mixed
//     flagged edges and the opposite outline winding;
//   - the sampler is null before a build, on an unsupported frame, and off the ramp.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// The browser's mergeGeometries accepts the mixed attribute arrays city-grid produces; the node_modules copy used by
// this test is stricter and returns null. Fall back to a plain concatenation so the built CityGround is raycastable
// (a test-harness detail, not a package change).
function lenientMerge(list, useGroups) {
  const merged = mergeGeometries(list, useGroups);
  if (merged) return merged;
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const itemSize = geos[0].attributes[name].itemSize;
    let count = 0;
    for (const g of geos) count += g.attributes[name].count;
    const arr = new Float32Array(count * itemSize);
    let offset = 0;
    for (const g of geos) { arr.set(g.attributes[name].array, offset); offset += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  }
  return out;
}

function makeCity({ withLanes = true, withBuildings = false, projectionScale = 1, reverseBlock = null } = {}) {
  const mat = () => new THREE.MeshStandardNodeMaterial();
  const mats = Object.fromEntries(['createRoadSurfaceMaterial', 'createSidewalkMaterial', 'createCurbMaterial', 'createWaterMaterial', 'createParkLawnMaterial',
    'createTerrainMaterial', 'createPlotGroundMaterial', 'createForecourtMaterial', 'createRenderedWallMaterial', 'createConcreteMaterial', 'createLanePavingMaterial'].map((k) => [k, mat]));
  const C = { THREE, TSL, Addons: { mergeGeometries: lenientMerge }, DEBUG_ROADS: false, QUALITY: { cull: 1 }, runSeed: () => 0.5, ...mats };
  const ctx = vm.createContext({
    window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'), performance, URLSearchParams, location: { search: '' },
    Math, Date, Number, Array, Set, Map, Buffer
  });
  vm.runInContext(read('js/toronto-geodata.js'), ctx, { filename: 'js/toronto-geodata.js' });
  // The City's physical sidewalks: city-grid reads cityWalks at build time, and the verge refinement asks whether a
  // mapped sidewalk covers a block edge. Load the polygons so the build (and the per-edge test) sees the real data.
  vm.runInContext(read('js/sidewalk-polygons.js'), ctx, { filename: 'js/sidewalk-polygons.js' });
  vm.runInContext(read('js/toronto-sidewalks.js'), ctx, { filename: 'js/toronto-sidewalks.js' });
  if (reverseBlock != null) {
    const flat = C.GEO.blocks[reverseBlock][0];
    const rev = [];
    for (let i = flat.length - 2; i >= 0; i -= 2) rev.push(flat[i], flat[i + 1]);
    C.GEO.blocks[reverseBlock][0] = rev;
  }
  const files = ['js/city-config.js',
    ...(withBuildings ? ['js/waterfront-island-buildings-data.js', 'js/waterfront-island-buildings.js'] : []),
    ...(withLanes ? ['js/waterfront-island-lanes-data.js', 'js/waterfront-island-lanes.js'] : []),
    'js/sidewalk-sections.js', 'js/city-grid.js'];
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  if (projectionScale !== 1) C.GEO.frame.projection = { ...C.GEO.frame.projection, kx: C.GEO.frame.projection.kx * projectionScale };
  return C;
}

const city = makeCity();
const SW = city.GEO.frame.sidewalk;
const SW_TOP = city.CITY_BOUNDS.sidewalkHeight;

// Build the ground once: the exact verge sampler is filled by the producer, so the raycast tests need a real build.
const scene = new THREE.Scene();
{
  const warn = console.warn, error = console.error;
  console.warn = console.error = () => {};
  try { city.buildCityGrid(scene); } finally { console.warn = warn; console.error = error; }
}
const ground = scene.getObjectByName('CityGround');
ground.updateMatrixWorld(true);

function blockPoly(id) {
  const flat = city.GEO.blocks[id][0];
  const poly = [];
  for (let i = 0; i + 1 < flat.length; i += 2) poly.push({ x: flat[i], z: flat[i + 1] });
  return poly;
}
function blockParts(id, reverse = false) {
  let poly = blockPoly(id);
  if (reverse) poly = poly.slice().reverse();
  const inner = city.offsetPolygonInward(poly, 0.25);
  const prop = city.offsetPolygonInward(poly, SW);
  const flags = city.islandVergeFlags(inner);
  return { poly, inner, prop, flags };
}

// A raycast of the WHOLE built CityGround (every merged mesh), returning the topmost rendered surface at (x, z).
function groundRaycaster(root = ground) {
  const ray = new THREE.Raycaster();
  return (x, z) => {
    ray.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(root, true).filter((h) => h.object.isMesh);
    return hits.length ? { y: hits[0].point.y, name: hits[0].object.name } : null;
  };
}

// Bilinear point across one edge's ramp quad: t along the edge, f from the outline (0) to the prop inset (1).
function rampPoint(poly, prop, i, t, f) {
  const i2 = (i + 1) % poly.length;
  const bx = poly[i].x + (poly[i2].x - poly[i].x) * t, bz = poly[i].z + (poly[i2].z - poly[i].z) * t;
  const cx = prop[i].x + (prop[i2].x - prop[i].x) * t, cz = prop[i].z + (prop[i2].z - prop[i].z) * t;
  return [bx + (cx - bx) * f, bz + (cz - bz) * f];
}

// Points strictly inside the actual rendered triangles: each triangle's centroid, its edge midpoints (pulled 2% toward
// the centroid so they are not on an edge where a coincident neighbour can tie the raycast) and points near each
// vertex. These are guaranteed to lie on the rendered surface, unlike a bilinear quad point on a twisted quad.
function triangleSamples(geo) {
  const p = geo.attributes.position.array;
  const out = [];
  for (let i = 0; i + 8 < p.length; i += 9) {
    const A = [p[i], p[i + 2]], B = [p[i + 3], p[i + 5]], C = [p[i + 6], p[i + 8]];
    const mix = (wa, wb, wc) => [A[0] * wa + B[0] * wb + C[0] * wc, A[1] * wa + B[1] * wb + C[1] * wc];
    out.push(mix(1 / 3, 1 / 3, 1 / 3));
    const c = 0.02 / 3, w = 0.49 + c; // edge midpoint (0.5, 0.5, 0) pulled 2% toward the centroid
    out.push(mix(w, w, c), mix(w, c, w), mix(c, w, w));
    out.push(mix(0.8, 0.1, 0.1), mix(0.1, 0.8, 0.1), mix(0.1, 0.1, 0.8));
  }
  return out;
}

// --- pure gates -----------------------------------------------------------------------------------------------------
test('the verge gate is source-scoped: only the photo-evidenced rows, and a mismatched frame is a no-op', () => {
  const layout = city.islandVergeLayout();
  assert.equal(layout.skipped, null);
  assert.equal(layout.stats.vergeRuns, 39, `${layout.stats.vergeRuns} verge runs`);
  assert.equal(layout.stats.livingStreet, 27);
  assert.equal(layout.stats.service, 12);
  assert.ok(layout.stats.vergeM > 7000, `${layout.stats.vergeM} m`);

  // A Third Street edge is grass; an unphotographed service lane edge is not.
  const third = city.ISLAND_LANES_DATA.runs.find((r) => r.names.includes('Third Street') && r.unmarked === 1);
  const p = third.points[Math.floor(third.points.length / 2)];
  assert.ok(city.islandVergeEdgeAt(p[0], p[1]));
  const svc = city.ISLAND_LANES_DATA.runs.find((r) => r.names.includes('Island Service Road'));
  const q = svc.points[Math.floor(svc.points.length / 2)];
  assert.equal(city.islandVergeEdgeAt(q[0], q[1]), null);

  // The ramp profile is the full former band, not the 0.25 m kerb.
  const prof = city.islandVergeRampProfile({ roadY: 0, walkY: SW_TOP, width: SW });
  assert.equal(prof.outerY, 0);
  assert.equal(prof.innerY, SW_TOP);
  assert.ok(prof.slope < 0.06, `slope ${prof.slope} is a gentle full-band ramp`);

  // A mismatched projection draws nothing.
  const wrong = makeCity({ projectionScale: 1.01 });
  const inner = wrong.offsetPolygonInward(blockPoly(2902), 0.25);
  assert.equal(wrong.islandVergeFlags(inner), null);
  assert.equal(wrong.islandVergeSurfaceAt(0, 0), null);
});

test('the producer replaces the former band and kerb on flagged edges (no overlay, no native slab side)', () => {
  const { poly, inner, prop, flags } = blockParts(2894); // all edges flagged
  assert.ok(flags && flags.every(Boolean), 'block 2894 is entirely source-confirmed');
  const keep = new Uint8Array(inner.length); // nothing kept: every edge is the ramp
  assert.equal(city.walkBandGeometryXZEdges(inner, prop, 0.03, SW_TOP, keep), null, 'no concrete band on flagged edges');
  assert.equal(city.kerbRingGeometryXZEdges(poly, inner, 0.0, 0.18, keep), null, 'no stone kerb on flagged edges');
  const ramp = city.rampGeometryXZ(poly, prop, flags, { roadY: 0, walkY: SW_TOP, kerbY: 0.18 });
  assert.ok(ramp && ramp.attributes.position.count > 0, 'the ramp is built');
  // The ramp spans the full former band: its outer edge is at the road, its inner edge at the yard.
  const ys = ramp.attributes.position.array;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < ys.length; i += 3) { minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]); }
  assert.ok(Math.abs(minY) < 1e-6, `outer edge at the road (${minY})`);
  assert.ok(Math.abs(maxY - SW_TOP) < 1e-6, `inner edge at the yard (${maxY})`);
});

// --- exact surface sampler vs the WHOLE built CityGround ------------------------------------------------------
test('the exact sampler matches the whole built CityGround topmost surface on a mixed block, corners included', () => {
  const { poly, inner, prop, flags } = blockParts(2902);
  assert.ok(flags && flags.some(Boolean) && flags.some((v) => !v), 'block 2902 has mixed flagged edges');
  const geo = city.rampGeometryXZ(poly, prop, flags, { roadY: 0, walkY: SW_TOP, kerbY: 0.18 });
  const ray = groundRaycaster();
  let checked = 0;
  for (const [x, z] of triangleSamples(geo)) {
    const s = city.islandVergeSurfaceAt(x, z);
    const r = ray(x, z);
    assert.ok(s && r, `ramp covers ${x.toFixed(1)},${z.toFixed(1)}`);
    assert.ok(Math.abs(s.h - r.y) < 2e-6, `sampler ${s.h} vs whole-ground ${r.y} (${r.name}) at ${x.toFixed(1)},${z.toFixed(1)}`);
    checked++;
  }
  assert.ok(checked > 20, `${checked} samples`);
  // An unflagged edge is not a ramp.
  const ci = flags.findIndex((v) => !v);
  const [ux, uz] = rampPoint(poly, prop, ci, 0.5, 0.5);
  assert.equal(city.islandVergeSurfaceAt(ux, uz), null);
});

test('the exact sampler matches the whole built CityGround on an all-flagged block, both outline windings', () => {
  const { poly, inner, prop, flags } = blockParts(2894);
  assert.ok(flags && flags.every(Boolean), 'block 2894 is entirely source-confirmed');
  const geo = city.rampGeometryXZ(poly, prop, flags, { roadY: 0, walkY: SW_TOP, kerbY: 0.18 });
  const ray = groundRaycaster();
  let checked = 0;
  for (const [x, z] of triangleSamples(geo)) {
    const s = city.islandVergeSurfaceAt(x, z);
    const r = ray(x, z);
    assert.ok(s && r, `ramp covers ${x.toFixed(1)},${z.toFixed(1)}`);
    assert.ok(Math.abs(s.h - r.y) < 2e-6, `sampler ${s.h} vs whole-ground ${r.y} (${r.name})`);
    checked++;
  }
  assert.ok(checked > 40, `${checked} samples`);

  // Material continuity: the ramp is drawn in the SAME material as the yard it meets (not a bright lawn). Compare the
  // whole-ground topmost mesh at the ramp's inner edge (where it meets the yard) with the mesh inside the yard (prop).
  const i = flags.findIndex(Boolean);
  const [mx, mz] = rampPoint(poly, prop, i, 0.5, 0.99);
  const rampTop = ray(mx, mz);
  const cx = prop.reduce((s, p) => s + p.x, 0) / prop.length, cz = prop.reduce((s, p) => s + p.z, 0) / prop.length;
  const yardTop = ray(cx, cz);
  assert.ok(rampTop && yardTop, 'both the ramp and the yard are rendered');
  assert.equal(rampTop.name, yardTop.name, `ramp material ${rampTop.name} matches the yard ${yardTop.name}`);

  // The opposite outline winding: reverse block 2894 before the build, then the producer's own sampler must match the
  // whole-ground raycast of its reversed-winding ramp.
  const rev = makeCity({ reverseBlock: 2894 });
  const revScene = new THREE.Scene();
  {
    const warn = console.warn, error = console.error;
    console.warn = console.error = () => {};
    try { rev.buildCityGrid(revScene); } finally { console.warn = warn; console.error = error; }
  }
  const revGround = revScene.getObjectByName('CityGround');
  revGround.updateMatrixWorld(true);
  const rflat = rev.GEO.blocks[2894][0];
  const rpoly = [];
  for (let i = 0; i + 1 < rflat.length; i += 2) rpoly.push({ x: rflat[i], z: rflat[i + 1] });
  const rinner = rev.offsetPolygonInward(rpoly, 0.25);
  const rprop = rev.offsetPolygonInward(rpoly, rev.GEO.frame.sidewalk);
  const rflags = rev.islandVergeFlags(rinner);
  assert.ok(rflags && rflags.every(Boolean), 'the reversed outline is still entirely source-confirmed');
  const rgeo = rev.rampGeometryXZ(rpoly, rprop, rflags, { roadY: 0, walkY: rev.CITY_BOUNDS.sidewalkHeight, kerbY: 0.18 });
  const rray = groundRaycaster(revGround);
  let rchecked = 0;
  for (const [x, z] of triangleSamples(rgeo)) {
    const s = rev.islandVergeSurfaceAt(x, z);
    const r = rray(x, z);
    assert.ok(s && r, `reversed ramp covers ${x.toFixed(1)},${z.toFixed(1)}`);
    assert.ok(Math.abs(s.h - r.y) < 2e-6, `reversed sampler ${s.h} vs whole-ground ${r.y} (${r.name})`);
    rchecked++;
  }
  assert.ok(rchecked > 40, `${rchecked} reversed samples`);
});

test('the sampler is null before a build, off the ramp, and on an unsupported frame', () => {
  const cold = makeCity();
  assert.equal(cold.islandVergeSurfaceAt(1000, 2300), null, 'no build yet');
  assert.equal(city.islandVergeSurfaceAt(0, 0), null, 'off the island');
  assert.equal(city.islandVergeSurfaceAt(1000, 600), null, 'mainland');
});

// --- producer integration: the build fills the exact sampler -----------------------------------------------------
test('buildCityGrid fills the exact verge sampler from the rendered ramp triangles', () => {
  const stats = city.islandVergeRampStats();
  assert.ok(stats.triangles > 100, `${stats.triangles} ramp triangles`);
  assert.ok(stats.cells > 0, `${stats.cells} spatial cells`);
  // A point on a Third Street verge resolves to a ramp height between the road and the yard.
  const { poly, inner, prop, flags } = blockParts(2894);
  const i = flags.findIndex(Boolean);
  const [x, z] = rampPoint(poly, prop, i, 0.5, 0.5);
  const s = city.islandVergeSurfaceAt(x, z);
  assert.ok(s && (s.kind === 'ramp' || s.kind === 'yard'), 'the built sampler resolves the verge');
  assert.ok(s.h > 0 && s.h <= SW_TOP, `verge height ${s.h} is between the road and the yard`);
});

// --- City sidewalk refinement: confirmed lane edges the City does not map still get the flush verge -----------------
test('a City-sidewalk block keeps the walk only where the City maps it; the lane edge still flushes', () => {
  // The captain's Third Street left edge: block 2887 holds City sidewalk pieces on its far side, but none along the
  // Third Street lane. Before this refinement the whole block was excluded from the verge (the narrow whole-block gate),
  // so the left kerb and concrete band stayed. The per-edge City-walk test keeps those mapped edges and re-claims only
  // the lane edge.
  const cityWalks = city.sidewalkPieces(city.SIDEWALKS, city.GEO.blocks);
  assert.ok(cityWalks && cityWalks.get(2887)?.length >= 1, 'block 2887 has mapped City sidewalks somewhere');
  // The pure per-edge test: a point just inside a mapped City walk edge is covered, the Third Street lane edge is not.
  const flat = city.GEO.blocks[2887][0];
  const poly = [];
  for (let i = 0; i + 1 < flat.length; i += 2) poly.push({ x: flat[i], z: flat[i + 1] });
  const inner = city.offsetPolygonInward(poly, 0.25);
  const pieces = cityWalks.get(2887);
  let covered = 0, notCovered = 0;
  for (let i = 0; i < inner.length; i++) {
    let any = false;
    for (const t of [0.25, 0.5, 0.75]) {
      const a = inner[i], b = inner[(i + 1) % inner.length];
      for (const off of [0.6, 1.2, 2.0]) {
        const L = Math.hypot(b.x - a.x, b.z - a.z); if (!(L > 1e-6)) continue;
        let area = 0; for (let k = 0; k < inner.length; k++) { const p = inner[k], q = inner[(k + 1) % inner.length]; area += p.x * q.z - q.x * p.z; }
        const s = area > 0 ? 1 : -1;
        const ix = -((b.z - a.z) / L) * s, iz = ((b.x - a.x) / L) * s;
        const x = a.x + (b.x - a.x) * t + ix * off, z = a.z + (b.z - a.z) * t + iz * off;
        for (const piece of pieces) {
          const inPoly = (pts) => { let c = false; for (let m = 0, j = pts.length - 1; m < pts.length; j = m++) { const p = pts[m], q = pts[j]; if ((p.z > z) !== (q.z > z) && x < ((q.x - p.x) * (z - p.z)) / (q.z - p.z) + p.x) c = !c; } return c; };
          if (inPoly(piece.outer) && !piece.holes.some(inPoly)) any = true;
        }
      }
    }
    if (any) covered++; else notCovered++;
  }
  assert.ok(covered > 0, 'some edges are covered by the City walk');
  assert.ok(notCovered > 0, 'the lane edges are not covered by the City walk');
});

// The final built ground must still match the ramp sampler everywhere (the City-walk refinement changes which blocks
// build a ramp, not the ramp contract).
test('every built ramp still matches the whole CityGround after the City-walk refinement', () => {
  const ray = groundRaycaster();
  let count = 0, worst = 0;
  const T = city.THREE;
  const down = new T.Vector3(0, -1, 0);
  const r2 = new T.Raycaster();
  const meshes = [];
  ground.traverse((o) => { if (o.isMesh && !/Water|Lake|Streams|Walls|Bridge|Flyover/.test(o.name)) meshes.push(o); });
  for (let x = 900; x < 1800; x += 9) for (let z = 1700; z < 2600; z += 9) {
    const s = city.islandVergeSurfaceAt(x, z);
    if (!s) continue;
    r2.set(new T.Vector3(x, 2, z), down);
    const hit = r2.intersectObjects(meshes, false)[0];
    assert.ok(hit, `no rendered ground under ${x},${z}`);
    const err = Math.abs(hit.point.y - s.h);
    worst = Math.max(worst, err);
    assert.ok(err < 2e-6, `sampler ${s.h} vs rendered ${hit.point.y} (${hit.object.name}) at ${x},${z}`);
    count++;
  }
  assert.ok(count > 100, `${count} ramp samples`);
  assert.ok(worst < 2e-6, `worst ${worst}`);
});


// --- City-walk refinement regressions (captain review 2026-11-10) ---------------------------------------------------
// These assert the ACTUAL built scene, not a copy of the builder's classifier: a retained edge keeps its yard material
// and walking-floor height, the surveyed City walk pieces are still the topmost surface, and the known Oneida left-side
// yard is plot material rather than the inherited concrete.

// One built scene with the island building profiles loaded (the residential yard material needs them).
let _builtWithBuildings = null;
function builtWithBuildings() {
  if (_builtWithBuildings) return _builtWithBuildings;
  const built = makeCity({ withBuildings: true });
  const s = new THREE.Scene();
  const warn = console.warn, error = console.error;
  console.warn = console.error = () => {};
  try { built.buildCityGrid(s); } finally { console.warn = warn; console.error = error; }
  const g = s.getObjectByName('CityGround');
  g.updateMatrixWorld(true);
  _builtWithBuildings = { built, ground: g };
  return _builtWithBuildings;
}
function topAt(ground, x, z) {
  const ray = new THREE.Raycaster();
  ray.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(ground, true).filter((h) => h.object.isMesh)[0];
  return hit ? { y: hit.point.y, name: hit.object.name } : null;
}

test('a retained edge away from the City walk is still yard material at the walking floor, not a new sidewalk', () => {
  const { built, ground } = builtWithBuildings();
  const cityWalks = built.sidewalkPieces(built.SIDEWALKS, built.GEO.blocks);
  const pieces = cityWalks.get(2887);
  assert.ok(pieces && pieces.length, 'block 2887 has City walk pieces');
  const flat = built.GEO.blocks[2887][0];
  const poly = [];
  for (let i = 0; i + 1 < flat.length; i += 2) poly.push({ x: flat[i], z: flat[i + 1] });
  const inner = built.offsetPolygonInward(poly, 0.25);
  const prop = built.offsetPolygonInward(poly, SW);
  const flags = built.islandVergeFlags(inner);
  assert.ok(flags, 'block 2887 has source-confirmed verge edges');
  // Pick a retained (unflagged) edge whose band does not overlap a City walk piece (a test-point choice, not the
  // assertion: the assertion below is on the built mesh).
  let edge = -1;
  for (let i = 0; i < inner.length; i++) {
    if (flags[i]) continue;
    if (!built.cityWalkOverlapsEdge(poly, prop, i, pieces)) { edge = i; break; }
  }
  assert.ok(edge >= 0, 'a retained edge away from the City walk exists');
  const i2 = (edge + 1) % inner.length;
  const x = ((inner[edge].x + inner[i2].x) / 2 + (prop[edge].x + prop[i2].x) / 2) / 2;
  const z = ((inner[edge].z + inner[i2].z) / 2 + (prop[edge].z + prop[i2].z) / 2) / 2;
  const hit = topAt(ground, x, z);
  assert.ok(hit, `rendered ground at ${x.toFixed(1)},${z.toFixed(1)}`);
  // Block 2887 is a mapped residential plot block: its retained band is the plot yard, never the concrete walk band.
  assert.equal(hit.name, 'Yards', `retained band is the plot yard, not a new sidewalk (${hit.name})`);
  assert.ok(Math.abs(hit.y - SW_TOP) < 1e-6, `retained band stays at the walking floor (${hit.y})`);
});

test('every surveyed City walk piece is still the topmost surface and no ramp crosses it', () => {
  const { built, ground } = builtWithBuildings();
  const cityWalks = built.sidewalkPieces(built.SIDEWALKS, built.GEO.blocks);
  let checked = 0;
  for (const [id, pieces] of cityWalks) {
    const b = built.BLOCKS[id];
    if (!b || b.area <= 400) continue;
    // Only the island blocks the refinement touches (a source-confirmed verge edge) are in scope; mainland City walks
    // are unchanged by this pass.
    if (!built.islandVergeFlags(built.offsetPolygonInward(b.poly, 0.25))) continue;
    for (const piece of pieces) {
      // An interior point of the surveyed piece: its ring centroid, or a vertex pulled toward it for a concave ring.
      const cx = piece.outer.reduce((s, p) => s + p.x, 0) / piece.outer.length;
      const cz = piece.outer.reduce((s, p) => s + p.z, 0) / piece.outer.length;
      const inside = (pts, x, z) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], bb = pts[j]; if ((a.z > z) !== (bb.z > z) && x < ((bb.x - a.x) * (z - a.z)) / (bb.z - a.z) + a.x) c = !c; } return c; };
      let x = cx, z = cz;
      if (!inside(piece.outer, x, z)) { const v = piece.outer[0]; x = v.x + (cx - v.x) * 0.15; z = v.z + (cz - v.z) * 0.15; }
      if (!inside(piece.outer, x, z)) continue;
      const hit = topAt(ground, x, z);
      if (!hit) continue;
      // The surveyed walk is laid at SW_TOP + 0.006 over the yard; it must remain the topmost surface (not a ramp).
      assert.equal(hit.name, 'Walkways', `block ${id}: the surveyed City walk is still the topmost surface (${hit.name})`);
      assert.ok(hit.y >= SW_TOP + 0.005, `block ${id}: the City walk is not buried by a ramp (${hit.y})`);
      // The exact ramp sampler must not report a mid-ramp slope at a surveyed walk point.
      const s = built.islandVergeSurfaceAt(x, z);
      if (s) assert.ok(s.h >= SW_TOP - 1e-6, `block ${id}: the sampler reports a ramp under the City walk (${s.h})`);
      checked++;
    }
  }
  assert.ok(checked >= 10, `${checked} surveyed City walk pieces checked`);
});

test('the known Oneida left-side yard is plot material, not the inherited concrete', () => {
  const { ground } = builtWithBuildings();
  // Block 2918 is Oneida Avenue's left side (the captain's broad concrete yard). Its 26 validated cottage profiles are
  // the evidence; the one unmatched inherited tall row must not pave it. Assert the actual built mesh at the block.
  const hit = topAt(ground, 1038, 2369);
  assert.ok(hit, 'the Oneida left-side yard is rendered');
  assert.equal(hit.name, 'Yards', `Oneida left-side yard is plot material (${hit.name})`);
  // (the plot yard top is SW_TOP - 0.002; the walking floor is SW_TOP, so allow the 2 mm yard offset)
  assert.ok(Math.abs(hit.y - SW_TOP) < 0.003, `Oneida left-side yard is at the walking floor (${hit.y})`);
});
