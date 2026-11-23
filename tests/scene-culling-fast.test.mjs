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
