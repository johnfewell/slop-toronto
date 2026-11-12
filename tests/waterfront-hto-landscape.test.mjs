// HTO Park East landscape (js/waterfront-hto-landscape.js): exact four-corner plan registration, pure pre-build ground
// masks, the pale plaza with the OSM sand and boardwalk cut out, the 16 sodded berms, an exact barycentric surface
// sampler matched by real Three raycasts, the mapped shore-footway timber boardwalk, five source-count benches, and
// both supported real frames. Focused: no full suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function city({ geodata = 'js/toronto-geodata.js', geo = null, bounds = { sidewalkHeight: 0.22 } } = {}) {
  const C = { THREE, TSL, Addons: { mergeGeometries }, CITY_BOUNDS: bounds };
  if (geo) C.GEO = geo;
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {} }, performance };
  if (geodata) vm.runInNewContext(read(geodata), ctx);
  vm.runInNewContext(read('js/waterfront-hto-landscape.js'), ctx);
  return ctx.window.CITY;
}

const inRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const distRing = (ring, x, z) => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
};
const distSeg = (x, z, s) => {
  const dx = s.bx - s.ax, dz = s.bz - s.az, L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L)) : 0;
  return Math.hypot(s.ax + dx * t - x, s.az + dz * t - z) - s.half;
};
const pathClear = (paths, x, z) => {
  let best = Infinity;
  for (const s of paths) best = Math.min(best, distSeg(x, z, s));
  return best;
};
const buildingHit = (parts, x, z, margin = 0) => parts.some((p) => {
  const dx = x - p.x, dz = z - p.z;
  return Math.abs(dx * p.cs - dz * p.sn) <= p.hx + margin && Math.abs(dx * p.sn + dz * p.cs) <= p.hz + margin;
});

const centroid = (ring) => {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return [x / ring.length, z / ring.length];
};

test('the four source plan corners keep their own normalized V (no rectangle approximation)', () => {
  const C = city();
  const P = C.HTO_LANDSCAPE_PLAN.park;
  assert.equal(P.nw.u, 0.512); assert.equal(P.nw.v, 0.437);
  assert.equal(P.ne.u, 0.812); assert.equal(P.ne.v, 0.416);
  assert.equal(P.se.u, 0.812); assert.equal(P.se.v, 0.894);
  assert.equal(P.sw.u, 0.512); assert.equal(P.sw.v, 0.827);
  assert.notEqual(P.ne.v, P.nw.v, 'slanted north plan edge is preserved');
  assert.notEqual(P.sw.v, P.se.v, 'slanted south plan edge is preserved');
  const L = C.htoLandscapeLayout();
  assert.equal(L.supported, true);
  assert.ok(L.frame.residual < 0.05, `corner registration residual ${L.frame.residual} m`);
  for (const key of ['nw', 'ne', 'se', 'sw']) {
    const [x, z] = L.frame.transform(P[key].u, P[key].v);
    const [ex, ez] = L.frame.corners[key];
    assert.ok(Math.hypot(x - ex, z - ez) < 0.05, `${key} maps to the mapped ring corner`);
  }
  assert.ok(L.frame.buildingResidual === null || (L.frame.buildingResidual > 0 && L.frame.buildingResidual < 15),
    `mapped building is a validation control (${L.frame.buildingResidual} m, plan is an earlier design)`);
  const W = C.HTO_LANDSCAPE_PLAN.west;
  assert.equal(W.nw.u, 0.245); assert.equal(W.nw.v, 0.430);
  assert.equal(W.ne.u, 0.373); assert.equal(W.ne.v, 0.430);
  assert.equal(W.se.u, 0.373); assert.equal(W.se.v, 0.765);
  assert.equal(W.sw.u, 0.116); assert.equal(W.sw.v, 0.697);
  assert.equal(L.west.supported, true);
  assert.ok(L.west.residual < 0.05, `West corner registration residual ${L.west.residual} m`);
  for (const key of ['nw', 'ne', 'se', 'sw']) {
    const [x, z] = L.westFrame.transform(W[key].u, W[key].v);
    const [ex, ez] = L.west.corners[key];
    assert.ok(Math.hypot(x - ex, z - ez) < 0.05, `West ${key} maps to the mapped ring corner`);
  }
  assert.equal(L.west.namedAdjacentBuilding, null);
  assert.match(L.west.adjacentBuildingNote, /condominium/i);
});

test('the pure layout yields 16 East berms and a derived whole-West native-face count, plus the mapped boardwalk', () => {
  const C = city();
  const L = C.htoLandscapeLayout();
  assert.equal(L.berms.length, 16);
  assert.equal(L.westBerms.length, L.westFaces.length, 'West count is derived from native path faces, not forced to 10');
  assert.ok(L.westBerms.length >= 8 && L.westBerms.length <= 14, `derived West count ${L.westBerms.length}`);
  assert.ok(L.westBerms.every((b) => b.face && b.gridFace), 'all West berms are native path-enclosed faces');
  assert.ok(L.berms.every((b) => !b.face && b.shift <= 2.0), 'East remains the accepted plan ellipses; no large relocation');
  assert.equal(L.skipped.filter((s) => /berm/.test(s.id)).map((s) => s.id).join(','), 'hto-east-berm-11');
  assert.ok(L.westPaths.length > 0 && L.westPaths.length < 200, `West paths filtered to the West frame (${L.westPaths.length})`);
  assert.ok(L.paths.length > 0 && L.paths.length < 400, `paths filtered to the HTO frame (${L.paths.length})`);
  assert.ok(L.boardwalk, 'the mapped shoreline footway is the boardwalk source, not a blocker');
  assert.equal(L.boardwalk.benches.length, 5);
  assert.equal(L.boardwalk.sourceBenchCount, 5);
  assert.ok(L.boardwalk.length >= 100 && L.boardwalk.length <= 140, `mapped south segment ${L.boardwalk.length} m`);
  assert.equal(L.boardwalk.planks.length > 300, true);
  assert.equal(L.boardwalk.planks.length < 1200, true);
  for (const b of L.berms) {
    assert.ok(b.height >= 0.7 && b.height <= 1.5, `${b.id} height ${b.height}`);
    assert.ok(b.shift >= 0 && b.shift <= 2.0, `${b.id} fit shift ${b.shift}`);
  }
});

test('every berm triangle stays on the mapped lawn, off sand/buildings/paths, and is bounded/finite', () => {
  const C = city();
  const L = C.htoLandscapeLayout();
  const sand = L.sandRing;
  let triangles = 0;
  for (const b of L.berms) {
    const p = b.mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `${b.id} finite vertex`);
      assert.ok(y >= C.CITY_BOUNDS.sidewalkHeight + 0.004, `${b.id} above lawn`);
      assert.ok(inRing(L.frame.ring, x, z), `${b.id} vertex inside mapped park`);
      assert.ok(!inRing(sand, x, z), `${b.id} vertex off OSM sand`);
      assert.ok(pathClear(L.paths, x, z) >= -0.26, `${b.id} vertex clear of mapped paths`);
      assert.ok(!buildingHit(L.buildings, x, z, 0.3), `${b.id} vertex clear of mapped buildings`);
    }
    for (const t of b.mesh.tris) {
      assert.ok(t.every((i) => Number.isInteger(i) && i >= 0 && i < p.length / 3), `${b.id} valid index`);
    }
    triangles += b.mesh.tris.length;
  }
  assert.ok(triangles > 17 * 100 && triangles < 17 * 2000, `${triangles} East berm triangles bounded`);
  for (const b of L.westBerms) {
    const p = b.mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `${b.id} finite vertex`);
      assert.ok(y >= C.CITY_BOUNDS.sidewalkHeight + 0.004, `${b.id} above lawn`);
      assert.ok(inRing(L.west.ring, x, z), `${b.id} vertex inside mapped West park`);
      assert.ok(pathClear(L.westPaths, x, z) >= -0.26, `${b.id} vertex clear of West paths`);
      assert.ok(!buildingHit(L.westBuildings, x, z, 0.3), `${b.id} vertex clear of West buildings`);
    }
  }
});

test('whole-West native path faces are grass, covering every reviewed white-space point without duplicate mounds', () => {
  const C = city();
  const L = C.htoLandscapeLayout();
  assert.ok(L.westFaces.length >= 8, `derived West faces ${L.westFaces.length}`);
  const centroids = L.westFaces.map((f) => `${f.cx.toFixed(1)},${f.cz.toFixed(1)}`);
  assert.equal(new Set(centroids).size, L.westFaces.length, 'faces are distinct, not duplicate geometry');
  for (const face of L.westFaces) {
    assert.ok(face.area >= 120, `face area ${face.area} m² at/above the explicit threshold`);
    assert.ok(face.maxDist >= 2, 'face has a usable interior distance');
  }
  assert.equal(L.westBerms.length, L.westFaces.length, 'one mound per derived face, no extra count invented');
  const faces = L.westBerms.filter((b) => b.face && b.gridFace);
  assert.equal(faces.length, L.westBerms.length);
  for (const b of faces) {
    assert.ok(b.faceArea >= 120);
    for (let i = 0; i < b.mesh.positions.length; i += 3) {
      const x = b.mesh.positions[i], z = b.mesh.positions[i + 2];
      assert.ok(inRing(L.west.ring, x, z), `${b.id} face vertex inside mapped West park`);
      assert.ok(pathClear(L.westPaths, x, z) >= -0.25, `${b.id} face vertex clear of the 2 m mapped paths`);
      assert.ok(!buildingHit(L.westBuildings, x, z, 0.2), `${b.id} face vertex clear of mapped buildings`);
    }
  }
  const scene = new THREE.Scene();
  const out = C.createWaterfrontHtoLandscape(THREE, scene);
  assert.equal(out.stats.westEnclosedFaces, L.westFaces.length);
  const reviewed = [[-991, 629], [-980, 598], [-1008, 641], [-987, 600], [-1005, 615]];
  for (const [x, z] of reviewed) {
    // The smoothed West edge may recede a few centimetres at a boundary node, but the point stays inside the derived
    // grass footprint and is never paved: the earlier white-hole regression is still guarded.
    assert.equal(C.htoLandscapePavedAt(x, z), false, `reviewed whitespace ${x},${z} is not paving`);
    assert.equal(C.htoLandscapeFootprintAt(x, z, 0), true, `reviewed whitespace ${x},${z} is grass footprint`);
    const s = C.htoLandscapeSurfaceAt(x, z);
    assert.ok(s === null || s.kind === 'berm', `reviewed whitespace ${x},${z} surface is grass or the rounded edge`);
  }
  // The exact reviewed path node is allowed to stay a mapped path; the enclosures on both sides are grass.
  const pathPoint = C.htoLandscapeSurfaceAt(-993, 615);
  assert.ok(pathPoint === null || pathPoint.kind === 'berm');
});

test('exact surface API is the rendered barycentric mesh surface; real Three downward raycasts agree', () => {
  const C = city();
  const scene = new THREE.Scene();
  const out = C.createWaterfrontHtoLandscape(THREE, scene);
  assert.ok(out);
  const base = C.CITY_BOUNDS.sidewalkHeight + 0.0045 + 0.0015;
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  for (const b of out.berms) {
    const p = b.mesh.positions;
    const tris = b.mesh.tris;
    // sample the centre triangle, an off-centre triangle and a near-edge triangle (real mesh, not an analytic mirror)
    const picks = [0, Math.floor(tris.length / 2), tris.length - 1];
    for (const ti of picks) {
      const [i0, i1, i2] = tris[ti];
      const x = (p[i0 * 3] + p[i1 * 3] + p[i2 * 3]) / 3;
      const z = (p[i0 * 3 + 2] + p[i1 * 3 + 2] + p[i2 * 3 + 2]) / 3;
      const got = C.htoLandscapeSurfaceAt(x, z);
      assert.ok(got && got.kind === 'berm', `${b.id} surface sample exists`);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p.slice(), 3));
      geo.setIndex(tris.flat());
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      ray.set(origin.set(x, 20, z), down);
      const hits = ray.intersectObject(mesh, false);
      assert.ok(hits.length >= 1, `${b.id} raycast hits rendered mesh`);
      assert.ok(Math.abs(hits[0].point.y - got.h) < 1e-4, `${b.id} API ${got.h} vs raycast ${hits[0].point.y}`);
      const idx = geo.index.array;
      const pos = geo.attributes.position.array;
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i] * 3, c = idx[i + 1] * 3, d = idx[i + 2] * 3;
        const ny = (pos[c + 2] - pos[a + 2]) * (pos[d] - pos[a]) - (pos[d + 2] - pos[a + 2]) * (pos[c] - pos[a]);
        assert.ok(ny > 0, `${b.id} upward triangle winding`);
      }
    }
    // East radial berms peak at the recorded centre height; whole-face grids peak somewhere inside the face mesh.
    const centre = C.htoLandscapeSurfaceAt(b.cx, b.cz);
    assert.ok(centre, `${b.id} has a sampled surface at its centre`);
    if (!b.gridFace) {
      assert.ok(Math.abs(centre.h - (base + b.height)) < 0.03, `${b.id} centre near recorded peak`);
    } else {
      let maxY = 0;
      for (let i = 1; i < b.mesh.positions.length; i += 3) maxY = Math.max(maxY, b.mesh.positions[i]);
      assert.ok(maxY > base + b.height * 0.6 && maxY <= base + b.height + 1e-6, `${b.id} grid face crest matches the rendered height`);
    }
  }
  // off every berm and deck, no ghost surface
  assert.equal(C.htoLandscapeSurfaceAt(0, 0), null);
});

test('plaza replaces the generic lawn, cuts out the sand and boardwalk, and the boardwalk deck is visible', () => {
  const C = city();
  const L = C.htoLandscapeLayout();
  // pure mask exists before the builder runs
  assert.equal(C.waterfrontHtoLandscapeEnabled, undefined);
  const masks = C.htoLandscapeGroundMaskPolygons();
  assert.equal(masks.length, 2);
  const eastMask = masks.find((m) => m.id === 'hto-east-paved-apron');
  const westMask = masks.find((m) => m.id === 'hto-west-paved-apron');
  assert.equal(JSON.stringify(eastMask.rings[0]), JSON.stringify(L.frame.ring));
  assert.equal(JSON.stringify(eastMask.rings[1]), JSON.stringify(L.sandRing));
  assert.equal(JSON.stringify(westMask.rings[0]), JSON.stringify(L.west.ring));
  const bwMask = C.htoLandscapeBoardwalkMaskPolygon();
  assert.ok(bwMask && bwMask.length >= 4 && bwMask.length <= 20, `bounded ${bwMask.length}-vertex boardwalk mask`);
  // applying the masks does not need the runtime result (city-grid is built first)
  const lawn = new THREE.MeshStandardNodeMaterial();
  C.applyWaterfrontHtoLandscapeGroundMask(lawn);
  assert.ok(lawn.maskNode && lawn.userData.waterfrontHtoLandscapeMask, 'plaza lawn mask applied pre-build');
  const pathMat = new THREE.MeshStandardNodeMaterial();
  C.applyWaterfrontHtoBoardwalkGroundMask(pathMat);
  assert.ok(pathMat.maskNode && pathMat.userData.waterfrontHtoBoardwalkMask, 'separate exact boardwalk mask applied pre-build');
  // the boardwalk is on the mapped shore path alignment; the deck is lower than the promenade and its exact-footprint
  // mask is what keeps it visible over the mapped city ground.
  assert.ok(L.boardwalk.planks.length > 300);
  const timberTop = C.CITY_BOUNDS.sidewalkHeight - 0.06;
  assert.ok(timberTop < C.CITY_BOUNDS.sidewalkHeight + 0.008, 'timber deck is the lower step');
  const scene = new THREE.Scene();
  const out = C.createWaterfrontHtoLandscape(THREE, scene);
  assert.ok(Math.abs(out.berms[0].mesh.positions[1] -
    (C.CITY_BOUNDS.sidewalkHeight + 0.0045 + 0.0015 + L.berms[0].height)) < 1e-6);
  // the paving mesh exists and a visible plaza point is paved, while sand/berm/boardwalk are not
  assert.ok(out.group.children.some((m) => m.userData.role === 'paved-apron'));
  const [sx, sz] = centroid(L.sandRing);
  assert.equal(C.htoLandscapePavedAt(sx, sz), false, 'sand is never paved');
  const b = L.berms[0];
  assert.equal(C.htoLandscapePavedAt(b.cx, b.cz), false, 'berm grass is not paved');
  const plank = L.boardwalk.planks[Math.floor(L.boardwalk.planks.length / 2)];
  assert.equal(C.htoLandscapePavedAt(plank.x, plank.z), false, 'boardwalk deck is not paved');
  let paved = null;
  for (let x = L.frame.box.minX + 2; x < L.frame.box.maxX - 2 && !paved; x += 1) {
    for (let z = L.frame.box.minZ + 2; z < L.frame.box.maxZ - 2; z += 1) {
      if (C.htoLandscapePavedAt(x, z)) { paved = [x, z]; break; }
    }
  }
  assert.ok(paved, 'the East plaza has exposed pale-concrete paving between berms');
  let westPaved = null;
  for (let x = L.west.box.minX + 2; x < L.west.box.maxX - 2 && !westPaved; x += 1) {
    for (let z = L.west.box.minZ + 2; z < L.west.box.maxZ - 2; z += 1) {
      if (C.htoLandscapePavedAt(x, z)) { westPaved = [x, z]; break; }
    }
  }
  assert.ok(westPaved, 'the West plaza has exposed pale-concrete paving between mounds');
  assert.ok(out.stats.pavingTriangles > 20);
});

test('boardwalk planks are perpendicular to the shore, benches are exactly five, and the deck clears sand/buildings', () => {
  const C = city();
  const L = C.htoLandscapeLayout();
  const bw = L.boardwalk;
  const route = bw.planks;
  for (let i = 1; i < route.length; i += 37) {
    const a = route[i - 1], b = route[i];
    const tx = b.x - a.x, tz = b.z - a.z, len = Math.hypot(tx, tz);
    // plank long axis (local z) is perpendicular to the local shore tangent
    const nx = Math.sin(b.ry), nz = Math.cos(b.ry);
    const dot = Math.abs((tx / len) * nx + (tz / len) * nz);
    assert.ok(dot < 0.2, `plank perpendicular to shore (${dot.toFixed(3)})`);
  }
  assert.equal(bw.benches.length, 5, 'source count ceiling is five, never one every 8.5 m');
  for (const bench of bw.benches) {
    assert.ok(pathClear(L.paths, bench.x, bench.z) <= 1.1, 'bench sits on the mapped promenade apron');
    assert.ok(!inRing(L.sandRing, bench.x, bench.z), 'bench off sand');
  }
  for (const pl of bw.planks) {
    assert.ok(!inRing(L.sandRing, pl.x, pl.z), 'no plank on the OSM sand');
    assert.ok(inRing(L.frame.ring, pl.x, pl.z), 'plank inside the mapped park');
  }
  assert.equal(bw.maskRing.length <= 20, true);
});

test('native tree inventory is untouched; paved/keepout predicates let the captain root trees without broad erasure', () => {
  const C = city();
  const before = C.GEO.streetTrees.length;
  const parksBefore = C.GEO.parkPaths.length;
  const out = C.createWaterfrontHtoLandscape(THREE, new THREE.Scene());
  assert.equal(C.GEO.streetTrees.length, before);
  assert.equal(C.GEO.parkPaths.length, parksBefore);
  const b = out.berms[0];
  assert.ok(C.htoLandscapeBermAt(b.cx, b.cz), 'tree roots can sample the exact East berm surface');
  const w = out.westBerms[0];
  assert.ok(C.htoLandscapeBermAt(w.cx, w.cz), 'tree roots can sample the exact West berm surface');
  assert.equal(C.htoLandscapeKeepoutAt(b.cx, b.cz), false, 'berms are not a broad keepout');
  const plank = out.boardwalk.planks[Math.floor(out.boardwalk.planks.length / 2)];
  assert.equal(C.htoLandscapeKeepoutAt(plank.x, plank.z), true, 'deck is a hard keepout/paved surface');
});

test('unsupported frame is a clean no-op with a direct error; the real Eglinton frame still builds', async () => {
  const C = city({ geodata: null });
  C.GEO = { frame: { detail: { x0: -9000, x1: -8000, z0: -9000, z1: -8000 } }, areas: [], buildings: [], parkPaths: [] };
  assert.equal(C.htoLandscapeSupported(), false);
  assert.equal(C.htoLandscapeLayout().supported, false);
  const scene = new THREE.Scene();
  assert.equal(C.createWaterfrontHtoLandscape(THREE, scene), null);
  assert.equal(scene.children.length, 0);
  assert.equal(C.waterfrontHtoLandscapeEnabled, false);
  assert.ok(typeof C.waterfrontHtoLandscapeError === 'string' && C.waterfrontHtoLandscapeError.length > 0);
  assert.equal(C.htoLandscapeSurfaceAt(-800, 600), null);
  assert.equal(C.htoLandscapeGroundMaskPolygons().length, 0);
  assert.deepEqual(C.htoLandscapePavedAt(-800, 600), false);

  const { unpackGeo } = await import('../js/geodata-loader.js');
  const buf = await fs.promises.readFile(new URL('../data/frames/eglinton/toronto-geodata.bin', import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { GEO } = await unpackGeo(ab);
  const E = city({ geodata: null, geo: GEO });
  const L = E.htoLandscapeLayout();
  assert.equal(L.supported, true);
  assert.equal(L.berms.length, 16);
  assert.equal(L.westBerms.length, L.westFaces.length);
  assert.ok(L.westBerms.length >= 8);
  assert.ok(L.boardwalk && L.boardwalk.benches.length === 5);
  const built = E.createWaterfrontHtoLandscape(THREE, new THREE.Scene());
  assert.ok(built && built.stats.berms === 16 + L.westBerms.length && built.stats.eastBerms === 16 && built.stats.westBerms === L.westBerms.length && built.stats.boardwalkPlanks > 300);
});

test('berm grass uses one natural turf base with subtle continuous variation, not a random per-vertex palette', () => {
  const C = city();
  const out = C.createWaterfrontHtoLandscape(THREE, new THREE.Scene());
  const grass = out.group.children.find((m) => m.userData.role === 'sodded-berms');
  assert.ok(grass && grass.geometry.attributes.color, 'grass carries a continuous colour attribute');
  const a = grass.geometry.attributes.color.array;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < a.length; i += 3) { r += a[i]; g += a[i + 1]; b += a[i + 2]; }
  const n = a.length / 3;
  r /= n; g /= n; b /= n;
  assert.ok(g > r && g > b, 'natural green dominant');
  let maxDev = 0;
  for (let i = 0; i < a.length; i += 3) {
    maxDev = Math.max(maxDev, Math.abs(a[i] - r), Math.abs(a[i + 1] - g), Math.abs(a[i + 2] - b));
  }
  assert.ok(maxDev < 0.18, `variation stays subtle (max channel deviation ${maxDev.toFixed(3)})`);
  const unique = new Set();
  for (let i = 0; i < a.length; i += 3) unique.add(`${a[i].toFixed(3)},${a[i + 1].toFixed(3)},${a[i + 2].toFixed(3)}`);
  assert.ok(unique.size > 20, 'continuous variation, not a single flat colour');
  // no high-frequency random fan: adjacent vertices differ only slightly
  let maxAdj = 0;
  for (let i = 3; i < a.length; i += 3) {
    maxAdj = Math.max(maxAdj, Math.abs(a[i] - a[i - 3]), Math.abs(a[i + 1] - a[i - 2]), Math.abs(a[i + 2] - a[i - 1]));
  }
  assert.ok(maxAdj < 0.12, `no random per-vertex colour fan (max adjacent delta ${maxAdj.toFixed(3)})`);
});

test('built scene is bounded shared geometry with culling metadata and finite positions', () => {
  const C = city();
  const scene = new THREE.Scene();
  const out = C.createWaterfrontHtoLandscape(THREE, scene);
  assert.equal(scene.children.filter((o) => o === out.group).length, 1);
  assert.equal(out.stats.meshes, 9);
  assert.ok(out.stats.triangles > 10000 && out.stats.triangles < 80000, `${out.stats.triangles} triangles`);
  assert.equal(out.stats.colliders, out.colliders.length);
  assert.ok(out.stats.colliders >= 50);
  for (const m of out.group.children) {
    assert.ok(m.userData.cullDistance > 0 && m.userData.cullCell > 0, `${m.name} culling metadata`);
    assert.ok(m.geometry.attributes.position, `${m.name} has positions`);
    const a = m.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]), `${m.name} finite positions`);
    if (m.computeBoundingSphere) { m.computeBoundingSphere(); assert.ok(Number.isFinite(m.boundingSphere.radius)); }
  }
  assert.deepEqual(out.group.children.map((m) => m.name || m.userData.role).filter(Boolean).length, out.group.children.length);
});

// The source aerial shows a paved continuous lake-edge apron outside the path.
test('West perimeter quay apron stays paved rather than becoming a narrow grass ridge', () => {
  const C = city();
  C.createWaterfrontHtoLandscape(THREE, new THREE.Scene());
  for (const [x,z] of [[-956.5,657.8],[-970,657],[-1000,652]]) {
    assert.equal(C.htoLandscapeSurfaceAt(x,z), null, `quay apron ${x},${z}`);
  }
});

// The realism pass is material-only: the source-registered geometry must not move, and the new detail must be real node
// material work with an edging bevel, not a plan-only claim.
test('surface realism is node-material detail on unchanged source geometry', () => {
  const C = city();
  const L = C.htoLandscapeLayout();
  const out = C.createWaterfrontHtoLandscape(THREE, new THREE.Scene());
  const byRole = (role) => out.group.children.find((m) => m.userData.role === role);
  for (const role of ['paved-apron', 'sodded-berms', 'berm-concrete-edging', 'timber-boardwalk']) {
    assert.ok(byRole(role).material.isNodeMaterial, `${role} is a node material`);
    assert.ok(byRole(role).material.colorNode, `${role} carries procedural colour detail`);
  }
  // The measured plan counts and mapped footprint lengths are unchanged by the material pass.
  assert.equal(out.stats.pavingTriangles, 33);
  assert.equal(out.stats.boardwalkPlanks, 798);
  assert.equal(out.stats.boardwalkLength, 128.7);
  assert.equal(out.stats.railPosts, 58);
  assert.equal(out.stats.benches, 5);
  assert.equal(out.stats.berms, 16 + L.westBerms.length);
  assert.equal(byRole('paved-apron').geometry.attributes.position.count, L.east.ring.length + L.sandRing.length + L.boardwalk.maskRing.length + L.west.ring.length);
  // Edging is a shallow bevel with an inner lip above the outer reveal, and an aEdge attribute for the shader.
  const edge = byRole('berm-concrete-edging').geometry;
  assert.ok(edge.attributes.aEdge, 'edging supplies the bevel attribute');
  const e = edge.attributes.aEdge.array;
  let innerMax = -Infinity, outerMin = Infinity;
  for (let i = 0; i < e.length; i++) {
    const y = edge.attributes.position.array[i * 3 + 1];
    if (e[i] >= 0.999) innerMax = Math.max(innerMax, y);
    if (e[i] <= 0.001) outerMin = Math.min(outerMin, y);
  }
  assert.ok(innerMax > outerMin + 0.010, `inner lip ${innerMax} above outer reveal ${outerMin}`);
  // Turf still carries one natural olive-green vertex base with smooth variation.
  const grass = byRole('sodded-berms').geometry.attributes.color.array;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < grass.length; i += 3) { r += grass[i]; g += grass[i + 1]; b += grass[i + 2]; }
  const n = grass.length / 3;
  assert.ok(g / n > r / n && g / n > b / n, 'olive-green turf remains green-dominant');
  // The documented panel/joint approximation is exposed and plausibly sub-6 m.
  assert.ok(C.HTO_PAVING_DETAIL.panelX >= 2 && C.HTO_PAVING_DETAIL.panelX <= 6);
  assert.ok(C.HTO_PAVING_DETAIL.panelZ >= 2 && C.HTO_PAVING_DETAIL.panelZ <= 6);
});

test('planting inventory uses only mapped tree coordinates; densification stays a labelled proposal', () => {
  const C = city();
  const inv = C.htoLandscapePlantingInventory();
  assert.equal(inv.supported, true);
  assert.equal(inv.totalMapped, inv.east.length + inv.west.length);
  assert.ok(inv.totalMapped >= 1 && inv.totalMapped < 20, `mapped HTO trees ${inv.totalMapped}`);
  const ST = C.GEO.streetTrees;
  const mapped = new Set();
  for (let i = 0; i + 3 < ST.length; i += 4) mapped.add(`${ST[i]},${ST[i + 1]}`);
  const L = C.htoLandscapeLayout();
  for (const t of inv.east) {
    assert.ok(mapped.has(`${t.x},${t.z}`), 'East planting point comes from the mapped inventory');
    assert.ok(inRing(L.east.ring, t.x, t.z));
  }
  for (const t of inv.west) {
    assert.ok(mapped.has(`${t.x},${t.z}`), 'West planting point comes from the mapped inventory');
    assert.ok(inRing(L.west.ring, t.x, t.z));
  }
  assert.equal(inv.source.treesBothSections, 106);
  const props = C.htoLandscapePlantingProposals();
  const densify = props.proposals.find((p) => p.id === 'tree-densification');
  assert.ok(densify && densify.implemented === true, 'plan-derived tree densification is now implemented');
  assert.match(densify.basis, /digitized ASLA 2009 plan tree symbols/);
  assert.ok(!('x' in densify) && !('z' in densify), 'the proposal record itself carries no invented coordinate');
  const built = C.createWaterfrontHtoLandscape(THREE, new THREE.Scene());
  assert.equal(built.stats.plantingMappedTrees, inv.totalMapped);
  assert.equal(built.stats.plantingSourceTrees, 106);
});

// West edge rounding: the 0.5 m grid staircase is relaxed inward inside the allowed cells only. Triangulation and the
// exact surface sampler are unchanged (test 5 raycasts these same moved vertices), and no triangle folds.
test('West derived faces round the grid staircase inward without folding or leaving allowed cells', () => {
  const C = city();
  const L = C.htoLandscapeLayout();
  const boundaryLength = (p, idx) => {
    const m = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      for (let e = 0; e < 3; e++) {
        const a = v[e], b = v[(e + 1) % 3];
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        m.set(k, (m.get(k) || 0) + 1);
      }
    }
    let len = 0;
    for (const [k, count] of m) {
      if (count !== 1) continue;
      const [a, b] = k.split(',').map(Number);
      len += Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 2] - p[b * 3 + 2]);
    }
    return len;
  };
  let rounded = 0;
  for (const b of L.westBerms) {
    const m = b.mesh;
    assert.ok(m.rawPositions, `${b.id} keeps its raw cell positions`);
    assert.equal(m.rawPositions.length, m.positions.length);
    let maxMove = 0;
    for (let i = 0; i < m.positions.length; i += 3) {
      const dx = m.positions[i] - m.rawPositions[i];
      const dz = m.positions[i + 2] - m.rawPositions[i + 2];
      assert.ok(Number.isFinite(dx) && Number.isFinite(dz));
      assert.equal(m.positions[i + 1], m.rawPositions[i + 1], 'edge rounding never changes height');
      maxMove = Math.max(maxMove, Math.hypot(dx, dz));
    }
    assert.ok(maxMove <= 0.5, `${b.id} moves at most half a cell (${maxMove.toFixed(3)} m)`);
    assert.ok(maxMove > 0.02, `${b.id} actually rounds its edge (${maxMove.toFixed(3)} m)`);
    // every vertex stays in the mapped West ring and clear of the mapped paths (the allowed-cell clamp)
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i], z = m.positions[i + 2];
      assert.ok(inRing(L.west.ring, x, z), `${b.id} rounded vertex inside the mapped ring`);
      assert.ok(pathClear(L.westPaths, x, z) >= -0.25, `${b.id} rounded vertex clear of mapped paths`);
    }
    // no triangle flips or degenerates
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t] * 3, c = m.indices[t + 1] * 3, d = m.indices[t + 2] * 3;
      const raw = (m.rawPositions[c + 2] - m.rawPositions[a + 2]) * (m.rawPositions[d] - m.rawPositions[a])
        - (m.rawPositions[c] - m.rawPositions[a]) * (m.rawPositions[d + 2] - m.rawPositions[a + 2]);
      const now = (m.positions[c + 2] - m.positions[a + 2]) * (m.positions[d] - m.positions[a])
        - (m.positions[c] - m.positions[a]) * (m.positions[d + 2] - m.positions[a + 2]);
      if (raw === 0) continue;
      assert.equal(Math.sign(now), Math.sign(raw), `${b.id} no folded triangle`);
    }
    assert.ok(boundaryLength(m.positions, m.indices) < boundaryLength(m.rawPositions, m.indices) - 0.5,
      `${b.id} boundary perimeter shortens (staircase tips rounded)`);
    rounded++;
  }
  assert.equal(rounded, L.westBerms.length);
  assert.equal(L.westFaces.length, 8, 'the eight derived faces are preserved');
  const built = C.createWaterfrontHtoLandscape(THREE, new THREE.Scene());
  assert.ok(built.stats.westEdgeVerticesMoved > 100, `edge vertices moved: ${built.stats.westEdgeVerticesMoved}`);
});

// The mapped path ribbons belong to city-grid; this module only offers a composable tone node for the captain to wire.
test('path-tone hook exists for the mapped path material and never touches geometry', () => {
  const C = city();
  const polys = C.htoLandscapePathMaskPolygons();
  assert.equal(polys.length, 2);
  assert.equal(polys.map((p) => p.id).join(','), 'hto-east-paths,hto-west-paths');
  const mat = new THREE.MeshStandardNodeMaterial();
  const returned = C.applyWaterfrontHtoLandscapePathTone(mat);
  assert.equal(returned, mat);
  assert.ok(mat.colorNode, 'path material gains a tone node');
  assert.equal(mat.userData.waterfrontHtoPathTone, true);
  assert.equal(C.applyWaterfrontHtoLandscapePathTone(mat), mat, 'idempotent');
  const plain = { isNodeMaterial: false };
  assert.equal(C.applyWaterfrontHtoLandscapePathTone(plain), plain, 'no-op on non-node material');
  const built = C.createWaterfrontHtoLandscape(THREE, new THREE.Scene());
  assert.equal(built.stats.pavingTriangles, 33, 'path tone changes no geometry');
});

// st-sb3r.21: the captain-digitized ASLA 2009 plan tree symbols. Historical design reconstruction, registered by the
// module's existing homographies, clipped to the exact rendered berm triangles, deduped against City inventory and each
// other. Conflicts are rejected, never moved; the gate is off until the supported builder runs.
test('plan tree symbols register to rendered berms and reject conflicts without moving them', () => {
  const C = city();
  const P = C.HTO_PLAN_TREE_POINTS;
  assert.equal(P.imageSize[0], 1600); assert.equal(P.imageSize[1], 1014);
  assert.equal(P.eastPixels.length, 62, 'captain-digitized East symbols');
  assert.equal(P.westPixels.length, 29, 'captain-digitized West symbols');
  const L = C.htoLandscapeLayout();
  assert.equal(C.waterfrontHtoLandscapePlanTreesEnabled, undefined, 'gate is off before the builder runs');
  assert.equal(C.htoLandscapePlanTreeSites().length, 0, 'no sites before the supported builder');
  const plan = C.htoLandscapePlanTreeLayout();
  assert.equal(plan.supported, true);
  // one raycast mesh per berm (Mesh.raycast scans every triangle, so reusing them keeps this focused test fast)
  const bermById = new Map();
  for (const b of L.berms.concat(L.westBerms)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.mesh.positions.slice(), 3));
    g.setIndex(b.mesh.tris.flat());
    bermById.set(b.id, new THREE.Mesh(g, new THREE.MeshBasicMaterial()));
  }
  assert.equal(plan.counts.candidate, 91, 'every digitized symbol is accounted for');
  assert.equal(plan.counts.accepted + plan.counts.rejected, plan.counts.candidate);
  assert.ok(plan.counts.accepted > 40 && plan.counts.accepted < 91, `plausible plan density (${plan.counts.accepted})`);
  assert.ok(plan.counts.byReason.path > 0 && plan.counts.byReason['not-on-west-berm'] > 0, 'rejections are reasoned');
  for (const a of plan.accepted) {
    assert.match(a.sourceId, /^plan(East|West)\d{2}$/);
    assert.ok(Array.isArray(a.pixel) && Number.isFinite(a.pixel[0]) && Number.isFinite(a.pixel[1]));
    assert.ok(Math.abs(a.u - a.pixel[0] / 1600) < 1e-9 && Math.abs(a.v - a.pixel[1] / 1014) < 1e-9, 'pixel provenance');
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(a.y));
    const berm = L.berms.concat(L.westBerms).find((b) => b.id === a.bermId);
    assert.ok(berm, `${a.sourceId} names its rendered berm`);
    // the registered point lies on the actual rendered berm triangle, off paving/beach/building/water
    assert.ok(berm.contains ? berm.contains(a.x, a.z, 0) : false, `${a.sourceId} stands on a berm footprint`);
    assert.equal(C.htoLandscapePavedAt(a.x, a.z), false, `${a.sourceId} is not on paving`);
    const ray = new THREE.Raycaster(new THREE.Vector3(a.x, 20, a.z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(bermById.get(a.bermId), false);
    assert.ok(hits.length >= 1, `${a.sourceId} raycast hits its berm`);
    assert.ok(Math.abs(hits[0].point.y - a.y) < 1e-3, `${a.sourceId} registered height matches the rendered berm`);
    assert.equal(a.model, 'ez-oak-medium');
    assert.ok(a.typology.includes('not a species identification'));
  }
  // rejected points keep their transformed coordinate and are never relocated
  for (const r of plan.rejected) {
    assert.equal(r.accepted, false);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
    if (Number.isFinite(r.x) && Number.isFinite(r.z)) {
      const [sx, sz] = plan.points.find((p) => p.sourceId === r.sourceId).pixel;
      const side = r.side === 'east' ? L.frame : L.westFrame;
      const [ex, ez] = side.transform(sx / 1600, sz / 1014);
      assert.ok(Math.hypot(r.x - ex, r.z - ez) <= Math.SQRT2 * 0.0005 + 1e-9, `${r.sourceId} retains its registered coordinate within millimetre serialization rounding`);
    }
  }
  // dedupe: no accepted point duplicates a mapped City trunk or another accepted plan point
  const nearTrees = C.htoLandscapePlantingInventory();
  const cityNear = nearTrees.east.concat(nearTrees.west).map((t) => [t.x, t.z]);
  for (const a of plan.accepted) {
    for (const [tx, tz] of cityNear) {
      assert.ok(Math.hypot(tx - a.x, tz - a.z) >= 5.5 - 1e-6, `${a.sourceId} clear of a City trunk`);
    }
    for (const b of plan.accepted) {
      if (b.sourceId === a.sourceId) continue;
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 2.0 - 1e-6, `${a.sourceId} clear of ${b.sourceId}`);
    }
  }
  // the active builder gate exposes the accepted sites, and the mapped inventory is untouched
  const before = C.GEO.streetTrees.length;
  const out = C.createWaterfrontHtoLandscape(THREE, new THREE.Scene());
  const sites = C.htoLandscapePlanTreeSites();
  assert.equal(sites.length, plan.counts.accepted);
  assert.equal(C.waterfrontHtoLandscapePlanTreesEnabled, true);
  assert.equal(C.GEO.streetTrees.length, before);
  assert.equal(out.stats.planTreesAccepted, plan.counts.accepted);
  assert.equal(out.stats.planTreeCandidates, 91);
});

test('generated HTO scatter reconciles against plan trees; mapped City trunks are never removed', () => {
  const C = city();
  C.createWaterfrontHtoLandscape(THREE, new THREE.Scene());
  const sites = C.htoLandscapePlanTreeSites();
  const p = sites[0];
  const generated = [
    { x: p.x + 0.6, z: p.z + 0.4, height: 8, species: 0, tier: 0 },     // inside the reconcile radius
    { x: p.x + 40, z: p.z + 40, height: 8, species: 0, tier: 0 }        // far away
  ];
  const rec = C.htoPlanTreeReconcileGenerated(sites, generated, 2.5);
  assert.equal(rec.removedCount, 1);
  assert.equal(rec.kept.length, 1);
  assert.equal(rec.kept[0].x, p.x + 40);
  assert.equal(rec.removed[0].sourceId, p.sourceId);
});

// Both shipped frames must produce the same accepted plan positions (positions stable), and an unsupported frame is a
// clean no-op with no plan sites.
test('plan tree positions are stable across the detail and Eglinton frames; unsupported frame builds none', async () => {
  const D = city();
  const { unpackGeo } = await import('../js/geodata-loader.js');
  const buf = await fs.promises.readFile(new URL('../data/frames/eglinton/toronto-geodata.bin', import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { GEO } = await unpackGeo(ab);
  const E = city({ geodata: null, geo: GEO });
  const d = D.htoLandscapePlanTreeLayout();
  const e = E.htoLandscapePlanTreeLayout();
  assert.equal(d.counts.accepted, e.counts.accepted);
  assert.equal(d.counts.rejected, e.counts.rejected);
  assert.equal(JSON.stringify(d.accepted.map((a) => [a.sourceId, a.x, a.z])), JSON.stringify(e.accepted.map((a) => [a.sourceId, a.x, a.z])));

  const U = city({ geodata: null });
  U.GEO = { frame: { detail: { x0: -9000, x1: -8000, z0: -9000, z1: -8000 } }, areas: [], buildings: [], parkPaths: [] };
  assert.equal(U.htoLandscapePlanTreeLayout().supported, false);
  assert.equal(U.htoLandscapePlanTreeLayout().counts.accepted, 0);
  const scene = new THREE.Scene();
  assert.equal(U.createWaterfrontHtoLandscape(THREE, scene), null);
  assert.equal(U.waterfrontHtoLandscapePlanTreesEnabled, false);
  assert.equal(U.htoLandscapePlanTreeSites().length, 0);
});
