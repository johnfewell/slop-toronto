// Biidaasige Park reusable playground fence factory (js/biidaasige-play-fence.js, bead st-bmyv.4.3).
// These are focused CPU geometry checks. They load the ACTUAL module into a small CITY and prove, from the real
// built THREE objects, that:
//
//   1. A 100 m ring builds as a fresh, unplaced group with <= 3 InstancedMesh draw calls, finite instance matrices,
//      finite indexed triangles, a tight (not island-wide) bounding box and <= 40,000 triangles.
//   2. The run follows the supplied ring perimeter, including its corners, and an open run does not close itself.
//   3. A caller-confirmed gap, including one that wraps the ring seam, contains no pale, post, wire or collider.
//   4. The colliders are slim oriented proxies, not one giant box; a real ray hits the fence outside a gap and an
//      OBB contains a near-wall point outside the gap but not a point inside it.
//   5. The pale silhouette is volumetric and pointed (a single apex, narrowing above the body), not a flat quad.
//   6. Bad input is refused before a huge allocation: too few points, non-finite coordinates, an over-length run and
//      an absurdly small spacing all throw; duplicate points and negative gaps stay finite.
//   7. C.THREE is optional at module load; a missing THREE is a clear error only when the factory is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';

const MODULE = fs.readFileSync(new URL('../js/biidaasige-play-fence.js', import.meta.url), 'utf8');

function city({ withTHREE = true } = {}) {
  const CITY = {};
  if (withTHREE) CITY.THREE = THREE;
  const ctx = { window: { CITY }, console: { info() {}, warn() {}, log() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(MODULE, ctx, { filename: 'biidaasige-play-fence.js' });
  return CITY;
}

function meshesOf(group) {
  const out = [];
  group.traverse((o) => { if (o.isMesh) out.push(o); });
  return out;
}

function assertFiniteGeometry(group) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    assert.ok(p, `${o.name} has positions`);
    for (let i = 0; i < p.count; i++) {
      assert.ok(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i)), `${o.name} finite vertex ${i}`);
    }
    if (o.geometry.index) {
      const idx = o.geometry.index;
      for (let i = 0; i < idx.count; i++) {
        const v = idx.getX(i);
        assert.ok(Number.isInteger(v) && v >= 0 && v < p.count, `${o.name} finite in-range index ${i}`);
      }
      assert.equal(idx.count % 3, 0, `${o.name} index count is whole triangles`);
    }
    if (o.isInstancedMesh) {
      const m = new THREE.Matrix4();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        for (const e of m.elements) assert.ok(Number.isFinite(e), `${o.name} finite instance matrix ${i}`);
      }
    }
  });
}

function instancePositions(mesh) {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const out = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    m.decompose(p, q, s);
    out.push({ x: p.x, y: p.y, z: p.z, sy: s.y });
  }
  return out;
}

function projectToPolyline(pts, closed, x, z) {
  let best = { dist: Infinity, s: 0 };
  let acc = 0;
  const n = pts.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (len * len)));
    const px = a[0] + dx * t, pz = a[1] + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.dist) best = { dist: d, s: acc + t * len };
    acc += len;
  }
  return best;
}

function inGap(s, gaps) {
  return gaps.some((g) => s >= g.startM - 1e-6 && s <= g.endM + 1e-6);
}

function pointInOBB(c, x, z) {
  const dx = x - c.obb.cx, dz = z - c.obb.cz;
  const lx = dx * c.obb.cs + dz * c.obb.sn;
  const lz = -dx * c.obb.sn + dz * c.obb.cs;
  return Math.abs(lx) <= c.obb.hx + 1e-9 && Math.abs(lz) <= c.obb.hz + 1e-9;
}

const RECT_100 = [[0, 0], [30, 0], [30, 20], [0, 20]];

test('a 100 m ring is a fresh unplaced group with <= 3 instanced draw calls, finite geometry and a tight box', () => {
  const C = city();
  const f = C.buildBiidaasigePlayFence(RECT_100);
  assert.ok(f.group && f.group.isGroup, 'returns a Group');
  assert.equal(f.group.parent, null, 'never added to a scene');
  assert.equal(f.placementStatus, 'unplaced');

  const meshes = meshesOf(f.group);
  assert.ok(meshes.length >= 1 && meshes.length <= 3, `<= 3 draw calls (got ${meshes.length})`);
  for (const m of meshes) assert.ok(m.isInstancedMesh, `${m.name} is an InstancedMesh, not one mesh per picket`);
  assert.equal(f.stats.meshes, meshes.length);
  assert.equal(f.stats.drawCalls, meshes.length);

  assertFiniteGeometry(f.group);
  assert.ok(f.stats.instanceCount > 0);
  assert.equal(f.stats.instanceCount, meshes.reduce((n, m) => n + m.count, 0), 'reported count is the actual instance count');
  assert.ok(f.stats.triangles > 0 && f.stats.triangles <= 40000, `100 m ring <= 40,000 tris (got ${f.stats.triangles})`);
  assert.equal(f.triangles, f.stats.triangles);

  const b = f.stats.bounds;
  assert.ok(b.maxX - b.minX <= 31, `tight X box (${(b.maxX - b.minX).toFixed(2)} m)`);
  assert.ok(b.maxZ - b.minZ <= 21, `tight Z box (${(b.maxZ - b.minZ).toFixed(2)} m)`);
  assert.ok(b.minY >= -0.01 && b.maxY <= 1.2, `fence height is a fence, not a tower (${b.minY.toFixed(2)}..${b.maxY.toFixed(2)})`);

  assert.match(f.sourceConfidence.physicalDimensions, /photo-estimate/i);
  assert.match(f.sourceConfidence.maker, /unknown/i);
  assert.match(f.sourceConfidence.gaps, /caller-confirmed/i);
  assert.match(f.sourceConfidence.dogFenceRelationship, /distinct/i);
});

test('the run follows the ring perimeter and its corners, with no instance in the interior', () => {
  const C = city();
  const pts = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const f = C.buildBiidaasigePlayFence(pts);
  const all = meshesOf(f.group).flatMap(instancePositions);
  assert.ok(all.length > 0);
  for (const p of all) {
    const near = projectToPolyline(pts, true, p.x, p.z);
    assert.ok(near.dist < 0.03, `instance sits on the perimeter (${near.dist.toFixed(3)} m off)`);
  }
  const posts = instancePositions(meshesOf(f.group).find((m) => /posts/.test(m.name)));
  for (const corner of pts) {
    const d = Math.min(...posts.map((p) => Math.hypot(p.x - corner[0], p.z - corner[1])));
    assert.ok(d < 0.05, `a post stands at corner ${corner.join(',')} (${d.toFixed(3)} m)`);
  }
});

test('an open run does not close itself', () => {
  const C = city();
  const pts = [[0, 0], [10, 0], [10, 5]];
  const f = C.buildBiidaasigePlayFence(pts, { closed: false });
  assert.equal(f.stats.closed, false);
  const all = meshesOf(f.group).flatMap(instancePositions);
  for (const p of all) {
    assert.ok(p.x >= -0.01 && p.x <= 10.01 && p.z >= -0.01 && p.z <= 5.01, 'inside the open run bounds');
    const near = projectToPolyline(pts, false, p.x, p.z);
    assert.ok(near.dist < 0.03, 'on the open run, not on a closing segment');
  }
  const diagonalMid = all.filter((p) => Math.hypot(p.x - 5, p.z - 2.5) < 0.5);
  assert.equal(diagonalMid.length, 0, 'no fence on the unrequested closing diagonal');
});

test('a caller-confirmed gap, including a seam-wrapping gap, contains no instance or collider', () => {
  const C = city();
  const pts = [[0, 0], [20, 0], [20, 10], [0, 10]]; // perimeter 60
  const f = C.buildBiidaasigePlayFence(pts, { gaps: [{ startM: 50, endM: 10 }] }); // wraps 50..60 and 0..10
  assert.ok(Math.abs(f.stats.gapLengthM - 20) < 0.01, `wrapped gap is 20 m (got ${f.stats.gapLengthM})`);
  assert.equal(f.stats.gaps.length, 2, 'the wrapped gap is reported as two linear intervals');

  const all = meshesOf(f.group).flatMap(instancePositions);
  assert.ok(all.length > 0);
  for (const p of all) {
    const s = projectToPolyline(pts, true, p.x, p.z).s;
    assert.equal(inGap(s, f.stats.gaps), false, `instance at ${s.toFixed(2)} m is outside the gap`);
  }
  for (const c of f.colliders) {
    const s = projectToPolyline(pts, true, c.obb.cx, c.obb.cz).s;
    assert.equal(inGap(s, f.stats.gaps), false, `collider at ${s.toFixed(2)} m is outside the gap`);
  }
  assert.ok(f.colliders.length > 0);
});

test('colliders are slim oriented proxies; a real ray hits outside a gap and the OBB excludes the gap', () => {
  const C = city();
  const pts = [[0, 0], [20, 0], [20, 20], [0, 20]]; // perimeter 80
  const f = C.buildBiidaasigePlayFence(pts, { gaps: [{ startM: 15, endM: 25 }] });
  for (const c of f.colliders) {
    assert.equal(c.prop, true);
    assert.equal(c.proxy, true);
    assert.equal(c.claimsExactPicketGaps, false);
    assert.ok(c.maxX - c.minX <= 2.5 && c.maxZ - c.minZ <= 2.5, 'each proxy is a short segment, not an island box');
    assert.ok(c.maxY - c.minY > 0.8 && c.maxY - c.minY < 1.1, 'proxy top is fence height');
  }

  // West side (s = 50) is outside the gap. A horizontal ray from outside must hit the built fence.
  f.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(-2, 0.5, 10), new THREE.Vector3(1, 0, 0), 0, 10);
  const hits = ray.intersectObject(f.group, true);
  assert.ok(hits.length > 0, 'a real ray hits the fence outside the gap');

  const west = f.colliders.find((c) => Math.abs(c.obb.cx) < 0.2 && Math.abs(c.obb.cz - 10) < 1.2);
  assert.ok(west, 'a west-side proxy exists');
  assert.equal(pointInOBB(west, 0.02, 10), true, 'near-wall point outside the gap is inside the proxy');
  assert.equal(pointInOBB(west, 0.2, 10), false, 'the proxy is slim, not a wide box');

  // (18, 0) is inside the caller-confirmed gap; no proxy may contain it.
  for (const c of f.colliders) assert.equal(pointInOBB(c, 18, 0), false, 'no proxy covers the gap');
});

test('the pale silhouette is volumetric and pointed, not a flat quad', () => {
  const C = city();
  const f = C.buildBiidaasigePlayFence([[0, 0], [5, 0], [5, 5], [0, 5]]);
  const pales = meshesOf(f.group).find((m) => /pales/.test(m.name));
  assert.ok(pales, 'pales mesh exists');
  const g = pales.geometry;
  assert.equal(g.attributes.position.count % 3, 0, 'triangles are whole');
  const p = g.attributes.position;
  let maxY = -Infinity;
  for (let i = 0; i < p.count; i++) maxY = Math.max(maxY, p.getY(i));
  const apex = [];
  for (let i = 0; i < p.count; i++) if (p.getY(i) > maxY - 1e-6) apex.push([p.getX(i), p.getZ(i)]);
  assert.ok(apex.length >= 1, 'the point has apex vertices');
  for (const a of apex) assert.ok(Math.abs(a[0]) < 1e-6 && Math.abs(a[1]) < 1e-6, 'every apex vertex is the same centred point');

  const bodyR = (() => { let r = 0; for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.5) r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i))); return r; })();
  assert.ok(bodyR > 0.01, `the body has real width (${bodyR.toFixed(3)} m)`);
  assert.ok(bodyR < 0.05, 'the body is a narrow pale, not a board');
  for (const a of apex) assert.ok(bodyR > 0, 'the apex sits above a real body section');
});

test('instance matrices are real: bases sit on groundY, heights vary, and the group is not placed', () => {
  const C = city();
  const f = C.buildBiidaasigePlayFence(RECT_100, { groundY: 2.5 });
  const pales = meshesOf(f.group).find((m) => /pales/.test(m.name));
  const posts = meshesOf(f.group).find((m) => /posts/.test(m.name));
  const palePos = instancePositions(pales);
  const postPos = instancePositions(posts);
  for (const p of palePos) assert.ok(Math.abs(p.y - 2.5) < 1e-6, 'pale base is at groundY');
  for (const p of postPos) assert.ok(Math.abs((p.y - p.sy / 2) - 2.5) < 2e-3, 'post base is at groundY');
  const heights = palePos.map((p) => p.sy);
  assert.ok(Math.max(...heights) - Math.min(...heights) > 1e-4, 'deterministic height irregularity is visible');
  for (const c of f.colliders) {
    assert.ok(Math.abs(c.minY - 2.5) < 1e-6, 'collider minY is groundY');
    assert.ok(c.maxY > c.minY + 0.8 && c.maxY < c.minY + 1.1, 'collider maxY is fence height');
  }
  assert.equal(f.group.parent, null);
});

test('bad input is refused before a huge allocation; duplicates and negative gaps stay finite', () => {
  const C = city();
  const throws = (fn, name) => {
    try { fn(); return false; } catch (e) { return e && e.name === name; }
  };
  assert.equal(throws(() => C.buildBiidaasigePlayFence([[0, 0], [1, 0]]), 'RangeError'), true, 'closed ring needs 3 vertices');
  assert.equal(throws(() => C.buildBiidaasigePlayFence([[0, 0]], { closed: false }), 'RangeError'), true, 'open run needs 2 vertices');
  assert.equal(throws(() => C.buildBiidaasigePlayFence([[0, 0], [1, NaN], [1, 1]]), 'TypeError'), true, 'non-finite coordinate');
  assert.equal(throws(() => C.buildBiidaasigePlayFence([[0, 0], [200, 0], [200, 100], [0, 100]]), 'RangeError'), true, 'over-length run');
  assert.equal(throws(() => C.buildBiidaasigePlayFence(RECT_100, { paleSpacingM: 0.001 }), 'RangeError'), true, 'absurd spacing is refused, not expanded');

  const dup = C.buildBiidaasigePlayFence([[0, 0], [0, 0], [10, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  assertFiniteGeometry(dup.group);
  assert.ok(dup.stats.instanceCount > 0);

  const neg = C.buildBiidaasigePlayFence(RECT_100, { gaps: [{ startM: -5, endM: 5 }] });
  assertFiniteGeometry(neg.group);
  for (const g of neg.stats.gaps) {
    assert.ok(Number.isFinite(g.startM) && Number.isFinite(g.endM));
    assert.ok(g.startM >= 0 && g.endM <= neg.stats.lengthM + 1e-9);
  }
  const negOpen = C.buildBiidaasigePlayFence([[0, 0], [10, 0]], { closed: false, gaps: [{ startM: -5, endM: 5 }] });
  assertFiniteGeometry(negOpen.group);
  assert.ok(negOpen.stats.gaps.every((g) => g.startM >= 0 && g.endM <= 10 + 1e-9));
});

test('C.THREE is optional at load; a missing THREE is a clear error only when called', () => {
  const C = city({ withTHREE: false });
  assert.equal(typeof C.buildBiidaasigePlayFence, 'function', 'module loads without THREE');
  try {
    C.buildBiidaasigePlayFence(RECT_100);
    assert.fail('should have thrown');
  } catch (e) {
    assert.match(String(e.message), /THREE/);
  }
});
