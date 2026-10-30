// Coarse shadow stand-ins (scene-culling.js userData.shadowStandIn, after mrdoob's c4ab18f & 0630114): an opted-in
// instanced prop casts its sun shadow through the position-only stand-ins with the coarser geometry it names, at its
// own instances' transforms; a prop culled within the shadows' reach keeps casting by itself (UP-2).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as CORE from '../vendor/three/three.core.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function load(quality = {}) {
  class MeshBasicNodeMaterial extends CORE.MeshBasicMaterial {}
  const window = { CITY: { THREE: { ...CORE, MeshBasicNodeMaterial }, QUALITY: { cull: 1, dist: 1, shadowFar: 1, staticCell: 1, ...quality },
    Addons: { mergeGeometries: () => null } } };
  vm.runInNewContext(read('js/scene-culling.js'), { window, Math, console, Map, Set, Object, Array, Number, Float32Array, Infinity });
  return window.CITY;
}

const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
// n thin poles (the street-details.js way: a unit cylinder scaled to r x h) over a 4 km square
function poles(n, standIn, { cullDistance = 0 } = {}) {
  const mesh = new CORE.InstancedMesh(new CORE.CylinderGeometry(1, 1, 1, 10), new CORE.MeshStandardMaterial(), n);
  const m = new CORE.Matrix4(), q = new CORE.Quaternion();
  for (let i = 0; i < n; i++) {
    const x = -2000 + (i % 64) * 62.5, z = -2000 + Math.floor(i / 64) * (4000 / Math.ceil(n / 64));
    m.compose(new CORE.Vector3(x, 0.22 + 4.5, z), q, new CORE.Vector3(0.1, 9, 0.1));
    mesh.setMatrixAt(i, m);
  }
  mesh.castShadow = mesh.receiveShadow = true;
  if (standIn) mesh.userData.shadowStandIn = standIn;
  if (cullDistance) mesh.userData.cullDistance = cullDistance;
  return mesh;
}
function setup(meshes, quality) {
  const C = load(quality);
  const scene = new CORE.Scene(), root = new CORE.Group();
  root.name = 'CityStreetDetails';
  root.add(...meshes);
  scene.add(root);
  const cams = [new CORE.OrthographicCamera(), new CORE.OrthographicCamera()];
  const stats = C.setupSceneCulling(scene, [root], { getViewportCount: () => 2, getCamera: (i) => cams[i] });
  const proxies = [];
  scene.getObjectByName('ShadowProxies')?.traverse((o) => { if (o.isMesh) proxies.push(o); });
  return { C, scene, root, cams, stats, proxies };
}
const translations = (meshes) => meshes.flatMap((o) => Array.from({ length: o.count }, (_, i) => {
  const e = o.instanceMatrix.array, k = i * 16;
  return [e[k + 12], e[k + 13], e[k + 14], Math.hypot(e[k], e[k + 1], e[k + 2]), Math.hypot(e[k + 4], e[k + 5], e[k + 6])].map((v) => v.toFixed(3)).join(',');
})).sort();

test('opted-in poles cast through 8-triangle stand-ins at their own transforms, on the shadow cascades only', () => {
  const standIn = new CORE.CylinderGeometry(1.11, 1.11, 1, 4, 1, true);
  const n = 4096;
  const { C, root, cams, stats, proxies } = setup([poles(n, standIn)]);
  const chunks = [];
  root.traverse((o) => { if (o.isInstancedMesh) chunks.push(o); });
  assert.ok(chunks.length > 1, 'the poles were chunked for distance culling');
  assert.ok(chunks.every((o) => !o.castShadow && o.userData.shadowStandIn === standIn), 'the chunks no longer cast');
  assert.equal(stats.proxiedMeshes, chunks.length);
  assert.equal(stats.proxyTriangles, 8 * n, '8 triangles a pole in the shadow maps, not 40');
  assert.ok(proxies.length && proxies.every((o) => o.isInstancedMesh && tris(o.geometry) === 8 && o.castShadow));
  assert.ok(proxies.every((o) => o.layers.mask === 1 << C.SHADOW_PROXY_LAYER), 'never drawn in the view');
  assert.ok(cams.every((c) => c.layers.isEnabled(C.SHADOW_PROXY_LAYER)));
  assert.deepEqual(translations(proxies), translations(chunks), 'every pole casts, where it stands, at its own size');
});

test('a prop culled within the shadows\' reach keeps its own shadow (no shadow without its prop)', () => {
  const standIn = new CORE.CylinderGeometry(1.11, 1.11, 1, 4, 1, true);
  for (const quality of [{}, { cull: 0.6, shadowFar: 0.5 }]) {
    const { root, stats, proxies } = setup([poles(4096, standIn, { cullDistance: 150 })], quality);
    const chunks = [];
    root.traverse((o) => { if (o.isInstancedMesh) chunks.push(o); });
    assert.ok(chunks.length > 1 && chunks.every((o) => o.castShadow), 'culled at 150 m: the chunks cast by themselves');
    assert.equal(stats.proxyTriangles, 0);
    assert.equal(proxies.length, 0);
  }
  // the low tier's poles (culled at 0.6 x their distance) still reach past its shorter shadows (0.5 x)
  const { stats } = setup([poles(4096, standIn)], { cull: 0.6, shadowFar: 0.5 });
  assert.equal(stats.proxyTriangles, 8 * 4096);
});

// The quality net (quality.js) lowers Q.dist at runtime, pulling every chunk's cull distance in, while the stand-ins,
// chosen once, are never distance culled: a chunk must stay shown out to the shadows' reach at the lowest scale too
// (the cascades' far plane shrinks with Q.dist, a long golden-hour shadow does not)
test('a lowered runtime distance scale (Q.dist) never hides a pole inside the shadows\' reach while its stand-in casts', () => {
  const standIn = new CORE.CylinderGeometry(1.11, 1.11, 1, 4, 1, true);
  const reach = (q, k) => (720 * k + 100) * (q.shadowFar ?? 1);
  // culled at 850 m: past the 820 m reach at full distance, inside it (425 m < 460 m) at the net's last rung (x0.5)
  for (const quality of [{ minDist: 0.5 }, { dist: 0.5 }, { dist: 0.5, minDist: 0.5 }]) {
    const { C, root, stats, proxies } = setup([poles(4096, standIn, { cullDistance: 850 })], quality);
    const chunks = [];
    root.traverse((o) => { if (o.isInstancedMesh) chunks.push(o); });
    assert.ok(chunks.length > 1 && chunks.every((o) => o.castShadow), `${JSON.stringify(quality)}: the chunks cast by themselves`);
    assert.equal(stats.proxyTriangles, 0);
    assert.equal(proxies.length, 0);
    assert.ok(C.QUALITY.dist <= 1);
  }
  // the invariant at runtime, from the camera's point of view: with Q.dist lowered after setup, no chunk hidden within
  // the shadows' reach has handed its shadow to a stand-in
  const hiddenInReach = (quality, cullDistance) => {
    const { C, root, proxies } = setup([poles(4096, standIn, cullDistance ? { cullDistance } : {})], quality);
    const Q = C.QUALITY;
    let bad = 0, hidden = 0;
    for (const k of [1, 0.8, 0.65, 0.5]) {
      Q.dist = k;
      for (const cam of [[0, 0], [700, -300], [-1500, 1200]]) {
        C.updateSceneCulling(new CORE.Vector3(cam[0], 2, cam[1]));
        root.traverse((o) => {
          if (!o.isInstancedMesh) return;
          let on = true;
          for (let p = o; p; p = p.parent) on = on && p.visible;
          if (on) return;
          hidden++;
          const s = o.boundingSphere.clone().applyMatrix4(o.matrixWorld);
          if (!o.castShadow && Math.hypot(s.center.x - cam[0], s.center.z - cam[1]) - s.radius < reach(Q, k)) bad++;
        });
      }
    }
    return { bad, hidden, proxies: proxies.length };
  };
  const r850 = hiddenInReach({ minDist: 0.5 }, 850);
  assert.ok(r850.hidden > 0, 'positive control: the lowered scale hides chunks');
  assert.equal(r850.bad, 0);
  // the tiers' own poles (street-details.js: never given a cull distance, ~1.5 km at full quality) keep their stand-ins
  // down to the net's last rung, and stay clear of the reach there
  for (const quality of [{}, { cull: 0.8, shadowFar: 0.75, minDist: 0.5 }, { cull: 0.6, shadowFar: 0.5, minDist: 0.5 }]) {
    const { stats } = setup([poles(4096, standIn)], quality);
    assert.equal(stats.proxyTriangles, 8 * 4096, `${JSON.stringify(quality)}: poles keep their stand-ins`);
    const r = hiddenInReach(quality);
    assert.ok(r.proxies > 0 && r.hidden > 0, 'positive control: stand-ins made and chunks culled');
    assert.equal(r.bad, 0, `${JSON.stringify(quality)}: no hidden pole within reach casts through a stand-in`);
  }
});

// road-paint.js's cells (plain meshes culled at their own userData.cullDistance, cullFixed; mrdoob's 997185d) beside
// the opted-in poles: a culled paint cell never casts, and the poles' stand-in guard is unchanged by the paint's entries
test('culled road-paint cells never cast, and the poles keep their stand-ins beside them', () => {
  const standIn = new CORE.CylinderGeometry(1.11, 1.11, 1, 4, 1, true);
  // a 1.2 km cell's worth of paint: well over the big-caster limits (20k triangles, 600 m radius)
  const paintCell = (castShadow) => {
    const g = new CORE.PlaneGeometry(1700, 1700, 120, 120).rotateX(-Math.PI / 2);
    // as built (see-through, casting nothing), and the worst case: opaque and casting, which would qualify as a big
    // caster but for the guard on distance-culled meshes
    const mat = castShadow ? new CORE.MeshStandardMaterial() : new CORE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const mesh = new CORE.Mesh(g, mat);
    mesh.name = 'RoadMarkingsPaint';
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    Object.assign(mesh.userData, { cullDistance: 1650, cullFixed: true });
    return mesh;
  };
  for (const castShadow of [false, true]) {
    for (const quality of [{}, { cull: 0.6, dist: 0.6, shadowFar: 0.5 }]) {
      const paint = paintCell(castShadow);
      const n = 4096;
      const { C, root, stats, proxies } = setup([poles(n, standIn), paint], quality);
      const chunks = [];
      root.traverse((o) => { if (o.isInstancedMesh) chunks.push(o); });
      assert.equal(stats.proxyTriangles, 8 * n, 'only the poles cast through stand-ins');
      assert.deepEqual(translations(proxies), translations(chunks));
      assert.ok(chunks.every((o) => !o.castShadow));
      assert.equal(paint.castShadow, castShadow, 'the paint keeps its own flag');
      // culled at its fixed distance, whatever the quality net's distance scale
      const shown = (x, z) => {
        C.updateSceneCulling(new CORE.Vector3(x, 2, z));
        let on = true;
        for (let o = paint; o; o = o.parent) on = on && o.visible;
        return on;
      };
      assert.equal(shown(0, 1650 + 1202 + 50), false, 'hidden beyond its cull distance, and no stand-in casts for it');
      assert.equal(shown(0, 0), true);
    }
  }
});

test('street-details.js opts its poles in with an open 4-sided shaft', () => {
  const src = read('js/street-details.js');
  assert.match(src, /const POLE_SHADOW = new THREE\.CylinderGeometry\(1\.11, 1\.11, 1, 4, 1, true\);/);
  assert.match(src, /const poles = addMatrixArrayInstanced\(unitCyl, poleMetalMat, poleMatrices\);/);
  assert.match(src, /poles\.userData\.shadowStandIn = POLE_SHADOW;/);
  // (a square of circumradius 1.11 throws a shadow 1.57..2.22 wide as the sun goes round, 2.0 on average: the unit
  // cylinder's 2)
  const R = 1.11, side = R * Math.SQRT2;
  assert.ok(Math.abs(side * 4 / Math.PI - 2) < 0.01);
});
