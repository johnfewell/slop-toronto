// st-ndw9.21: scene-culling.js builds the shadow stand-ins of the massing cells (snorm16 positions, 1.3 M triangles with the drawn
// presets) straight from the arrays instead of through Vector3.fromBufferAttribute(...).applyMatrix4(...): it must give the very same
// numbers, for any matrix (the cells' own are a translation and a scale), or the shadows would move.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as CORE from '../vendor/three/three.core.js';

const window = { CITY: { THREE: CORE } };
const ctx = vm.createContext({ window, Math, JSON, Object, Array, Number, Map, Set, Float32Array, Float64Array, Int16Array, Uint16Array, Uint32Array, WeakMap, Infinity, NaN, isFinite, location: { search: "" }, performance, URLSearchParams });
vm.runInContext(fs.readFileSync(new URL('../js/scene-culling.js', import.meta.url), 'utf8'), ctx);
const { applySnorm } = window.CITY;

test('applySnorm gives bit-for-bit what fromBufferAttribute + applyMatrix4 give', () => {
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = 5000, P = new Int16Array(n * 4);
  for (let i = 0; i < P.length; i++) P[i] = Math.floor(rnd() * 65536) - 32768; // (including -32768, which denormalizes to -1)
  const attr = new CORE.BufferAttribute(P, 4, true);
  const matrices = [
    new CORE.Matrix4().compose(new CORE.Vector3(-3210.4, 0, 1180.7), new CORE.Quaternion(), new CORE.Vector3(0.0123, 0.0071, 0.0123)),
    new CORE.Matrix4().compose(new CORE.Vector3(5.5, -2, 9), new CORE.Quaternion().setFromAxisAngle(new CORE.Vector3(0.3, 0.8, 0.5).normalize(), 0.7), new CORE.Vector3(2, 3, 4)),
    new CORE.Matrix4().identity()
  ];
  const a = new CORE.Vector3(), b = new CORE.Vector3();
  for (const m of matrices) for (let i = 0; i < n; i++) {
    a.fromBufferAttribute(attr, i).applyMatrix4(m);
    applySnorm(P, i * 4, m.elements, b);
    assert.ok(Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z), `vertex ${i}: ${a.toArray()} vs ${b.toArray()}`);
  }
});

// the bounds the start-up asks of every geometry (releaseCpuCopies, the cells' pieces): read off the float array, the same min, max, centre and radius as three's
test('computeBoundingBoxFast and computeBoundingSphereFast give bit-for-bit what BufferGeometry computes', () => {
  const { computeBoundingBoxFast, computeBoundingSphereFast } = window.CITY;
  let seed = 777; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const make = (n, itemSize = 3, scale = 3000) => {
    const a = new Float32Array(n * itemSize);
    for (let i = 0; i < a.length; i++) a[i] = (rnd() - 0.5) * scale + (i % itemSize === 1 ? 40 : 0);
    const g = new CORE.BufferGeometry();
    g.setAttribute('position', new CORE.BufferAttribute(a, itemSize));
    return g;
  };
  for (const [n, itemSize, scale] of [[1, 3, 10], [2, 3, 1e-3], [5000, 3, 3000], [777, 4, 1e5], [30000, 3, 0.5]]) {
    const g = make(n, itemSize, scale), h = make(0); // (h: an empty geometry below)
    g.computeBoundingBox(); g.computeBoundingSphere();
    const box = g.boundingBox.clone(), sphere = g.boundingSphere.clone();
    g.boundingBox = null; g.boundingSphere = null;
    computeBoundingBoxFast(g); computeBoundingSphereFast(g);
    for (const k of ['x', 'y', 'z']) {
      assert.ok(Object.is(g.boundingBox.min[k], box.min[k]) && Object.is(g.boundingBox.max[k], box.max[k]), `box ${k} for ${n} x ${itemSize}`);
      assert.ok(Object.is(g.boundingSphere.center[k], sphere.center[k]), `centre ${k} for ${n} x ${itemSize}`);
    }
    assert.ok(Object.is(g.boundingSphere.radius, sphere.radius), `radius for ${n} x ${itemSize}`);
    assert.equal(h.attributes.position.count, 0);
  }
  // an empty geometry, a normalized (snorm) position array and an interleaved one: three's own answer
  for (const g of [make(0), (() => { const g = new CORE.BufferGeometry(); g.setAttribute('position', new CORE.BufferAttribute(new Int16Array([1, 2, 3, -4, 5, 6]), 3, true)); return g; })()]) {
    g.computeBoundingBox(); g.computeBoundingSphere();
    const box = g.boundingBox.clone(), sphere = g.boundingSphere.clone();
    g.boundingBox = null; g.boundingSphere = null;
    computeBoundingBoxFast(g); computeBoundingSphereFast(g);
    assert.deepEqual(g.boundingBox.min.toArray(), box.min.toArray());
    assert.deepEqual(g.boundingBox.max.toArray(), box.max.toArray());
    assert.ok(Object.is(g.boundingSphere.radius, sphere.radius));
  }
});
