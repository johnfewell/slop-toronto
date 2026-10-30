// The skinned crowds' shading, LODs and culling (js/pedestrians.js, js/controllers.js poseCharacters), ported with
// mrdoob's 1fe128d (its tests/pedestrians.test.cjs, adapted to the classic-script loader): a small numeric TSL evaluates
// the person material on the CPU, so the per-part branching and the far LOD's vertex-stage shading can be checked
// against the geometry without a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as CORE from '../vendor/three/three.core.js';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const shaderState = {
  attrs: { position: [0, 1.3, 0.08], normal: [0, 0, 1], skin: [0, 0, 0, 0], extra: [0, 0, 0], femaleDelta: [0, 0, 0], hairDelta: [0, 0, 0] },
  instanceIndex: 0,
  stage: 'fragment',
  sinCallsInFragment: 0,
  ifCallsInFragment: 0,
  vertexStageEvaluations: 0,
  varyingSnapshots: new Map()
};

const arr = (v) => (v instanceof TNode ? v.eval() : typeof v === 'number' ? [v] : v);
const broadcast = (a, b, fn) => {
  const va = arr(a), vb = arr(b);
  const n = Math.max(va.length, vb.length);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(va[i % va.length], vb[i % vb.length]);
  return out;
};
const smoothstepScalar = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const hexToLinear = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
  .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));

class TNode {
  constructor(fn) { this._fn = typeof fn === 'function' ? fn : () => fn; }
  eval() { return this._fn(); }
  get x() { return new TNode(() => [this.eval()[0]]); }
  get y() { return new TNode(() => [this.eval()[1]]); }
  get z() { return new TNode(() => [this.eval()[2]]); }
  get w() { return new TNode(() => [this.eval()[3]]); }
  get xyz() { return new TNode(() => this.eval().slice(0, 3)); }
  add(b) { return new TNode(() => broadcast(this, b, (x, y) => x + y)); }
  sub(b) { return new TNode(() => broadcast(this, b, (x, y) => x - y)); }
  mul(b) { return new TNode(() => broadcast(this, b, (x, y) => x * y)); }
  div(b) { return new TNode(() => broadcast(this, b, (x, y) => x / y)); }
  lessThan(b) { return new TNode(() => broadcast(this, b, (x, y) => (x < y ? 1 : 0))); }
  greaterThan(b) { return new TNode(() => broadcast(this, b, (x, y) => (x > y ? 1 : 0))); }
  toVar() {
    let slot = null;
    const variable = new TNode(() => (slot ?? this.eval()));
    variable.assign = (rhs) => { slot = arr(rhs).slice(); };
    return variable;
  }
  assign() {}
}
const wrap = (v) => (v instanceof TNode ? v : new TNode(Array.isArray(v) ? v : [v]));
const vecN = (n) => (...args) => new TNode(() => {
  const flat = args.flatMap((a) => arr(a));
  return flat.length === 1 ? new Array(n).fill(flat[0]) : flat.slice(0, n);
});

const TSL = {
  Fn: (builder) => () => new TNode(() => arr(builder())),
  If: (cond, body) => {
    if (shaderState.stage === 'fragment') shaderState.ifCallsInFragment++;
    let matched = arr(cond)[0] > 0;
    if (matched) body();
    const api = {
      ElseIf(c, b) {
        if (shaderState.stage === 'fragment') shaderState.ifCallsInFragment++;
        if (!matched && arr(c)[0] > 0) { matched = true; b(); }
        return api;
      },
      Else(b) { if (!matched) { matched = true; b(); } return api; }
    };
    return api;
  },
  float: (v) => wrap(v),
  int: (v) => new TNode(() => arr(v).map((x) => x | 0)),
  vec2: vecN(2), vec3: vecN(3), vec4: vecN(4),
  color: (hex) => new TNode(hexToLinear(hex)),
  attribute: (name) => new TNode(() => shaderState.attrs[name]),
  instanceIndex: new TNode(() => [shaderState.instanceIndex]),
  attributeArray: (count) => {
    const array = new Float32Array(count * 4);
    let uploads = 0;
    const value = {
      array,
      get uploads() { return uploads; },
      clearUpdateRanges() {},
      addUpdateRange() {},
      set needsUpdate(v) { if (v) uploads++; }
    };
    const storage = {
      value,
      toReadOnly() { return storage; },
      element(idxNode) {
        return new TNode(() => {
          const i = (arr(idxNode)[0] | 0) * 4;
          return [array[i], array[i + 1], array[i + 2], array[i + 3]];
        });
      }
    };
    return storage;
  },
  normalLocal: new TNode([0, 0, 1]),
  varying: (node, name) => {
    const key = name || Symbol('varying');
    return new TNode(() => {
      if (shaderState.varyingSnapshots.has(key)) return shaderState.varyingSnapshots.get(key);
      const prev = shaderState.stage;
      shaderState.stage = 'vertex';
      const val = arr(node).slice();
      shaderState.stage = prev;
      shaderState.varyingSnapshots.set(key, val);
      return val;
    });
  },
  vertexStage: (node) => new TNode(() => {
    shaderState.vertexStageEvaluations++;
    const prev = shaderState.stage;
    shaderState.stage = 'vertex';
    const val = arr(node).slice();
    shaderState.stage = prev;
    return val;
  }),
  cross: (a, b) => new TNode(() => {
    const u = arr(a), v = arr(b);
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  }),
  normalize: (a) => new TNode(() => {
    const u = arr(a);
    const len = Math.hypot(...u) || 1;
    return u.map((x) => x / len);
  }),
  sin: (a) => new TNode(() => {
    if (shaderState.stage === 'fragment') shaderState.sinCallsInFragment++;
    return arr(a).map(Math.sin);
  }),
  abs: (a) => new TNode(() => arr(a).map(Math.abs)),
  fract: (a) => new TNode(() => arr(a).map((x) => x - Math.floor(x))),
  min: (a, b) => new TNode(() => broadcast(a, b, Math.min)),
  max: (a, b) => new TNode(() => broadcast(a, b, Math.max)),
  clamp: (x, lo, hi) => new TNode(() => {
    const vx = arr(x), vlo = arr(lo), vhi = arr(hi);
    return vx.map((val, i) => Math.max(vlo[i % vlo.length], Math.min(vhi[i % vhi.length], val)));
  }),
  mix: (a, b, t) => new TNode(() => {
    const va = arr(a), vb = arr(b), vt = arr(t);
    const n = Math.max(va.length, vb.length, vt.length);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const k = vt[i % vt.length];
      out[i] = va[i % va.length] * (1 - k) + vb[i % vb.length] * k;
    }
    return out;
  }),
  step: (edge, x) => new TNode(() => broadcast(edge, x, (e, v) => (v < e ? 0 : 1))),
  smoothstep: (e0, e1, x) => new TNode(() => {
    const v0 = arr(e0), v1 = arr(e1), vx = arr(x);
    const n = Math.max(v0.length, v1.length, vx.length);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = smoothstepScalar(v0[i % v0.length], v1[i % v1.length], vx[i % vx.length]);
    return out;
  }),
  length: (a) => new TNode(() => [Math.hypot(...arr(a))])
};

class MeshStandardNodeMaterial { constructor(opts = {}) { Object.assign(this, opts); } }
const THREE = { ...CORE, MeshStandardNodeMaterial };
const window = { CITY: { THREE, TSL, Addons: { mergeGeometries } } };
vm.runInNewContext(read('js/pedestrians.js'), { window, Math, console, Float32Array, Uint32Array, Uint16Array, Array, Number, Object, Map, Set, Symbol, Infinity, NaN });
const { PersonCrowd, PersonRig, buildPersonGeometry, createPersonMaterial } = window.CITY;
const STRIDE = 31; // vec4s per person in a crowd's pose buffer (15 bones x 2 + the person's info)

test('PersonCrowd makes a far LOD only for a finite farDistance, and the far LOD casts no shadow', () => {
  const street = new PersonCrowd(16, { farDistance: 34, castShadow: true });
  assert.deepEqual([...street.meshes].map((m) => m.name), ['PeopleNear', 'PeopleFar']);
  assert.deepEqual([...street.meshes].map((m) => m.castShadow), [true, false]);
  assert.ok(street.meshes.every((m) => m.matrixAutoUpdate === false && m.frustumCulled === false));
  const player = new PersonCrowd(1, { farDistance: Infinity });
  assert.deepEqual([...player.meshes].map((m) => m.name), ['PeopleNear'], 'the player and the rider need no far LOD');
  const noShadow = new PersonCrowd(4, { farDistance: 34, castShadow: false });
  assert.ok(noShadow.meshes.every((m) => !m.castShadow));
});

test('an empty LOD keeps one degenerate person through the warm-up updates, then hides without uploads', () => {
  const crowd = new PersonCrowd(8, { farDistance: 34 });
  const rig = new PersonRig({ seed: 2.5 });
  rig.reset(0, 0, 0, () => 0, null);
  for (const frame of [1, 2]) {
    crowd.begin();
    crowd.end();
    assert.ok(crowd.meshes.every((m) => m.visible && m.count === 1), `warm-up update ${frame} still draws (compiles) both LODs`);
  }
  const uploads = crowd.lods.map((l) => l.pose.value.uploads);
  crowd.begin();
  crowd.end();
  assert.ok(crowd.meshes.every((m) => !m.visible && m.count === 0));
  assert.deepEqual([...crowd.lods].map((l) => l.pose.value.uploads), [...uploads], 'an empty crowd uploads nothing');
  crowd.begin();
  crowd.add(rig, 12);
  crowd.end();
  assert.equal(crowd.meshes[0].visible, true);
  assert.equal(crowd.meshes[0].count, 1);
  assert.equal(crowd.meshes[1].visible, false);
});

test('every triangle of the person belongs to one body part, so per-part varyings never blend across parts', () => {
  for (const detail of [1, 0]) {
    const geo = buildPersonGeometry(detail);
    const skin = geo.getAttribute('skin').array, idx = geo.getIndex().array;
    for (let i = 0; i < idx.length; i += 3) {
      const p0 = skin[idx[i] * 4 + 3];
      assert.ok(p0 === skin[idx[i + 1] * 4 + 3] && p0 === skin[idx[i + 2] * 4 + 3], `triangle ${i / 3} of LOD ${detail}`);
    }
  }
});

test('the palette hashes run in the vertex stage; the far LOD has no fragment branches; the shadow pass skips the dress', () => {
  const pose = TSL.attributeArray(2 * STRIDE);
  pose.value.array.set([7.3, 1.0, 1.02, 0.65], (STRIDE - 1) * 4);
  const near = createPersonMaterial(pose, 1), far = createPersonMaterial(pose, 0);

  shaderState.vertexStageEvaluations = 0;
  shaderState.varyingSnapshots.clear();
  near.positionNode.eval();
  assert.equal(shaderState.vertexStageEvaluations, 0, 'positionNode (the shadow pass) evaluates none of the clothing');

  for (const [partId, pos, extra] of [
    [0, [0.02, 1.35, 0.09], [0, 0, 0.5]], [1, [0.09, 0.6, 0.04], [0, 0, 0.4]], [2, [0.09, 0.02, 0.05], [0, 0, 0.3]],
    [3, [0.18, 1.1, 0], [0, 0, 0.95]], [4, [0.22, 0.85, 0], [0, 0, 0.5]], [5, [0.02, 1.62, 0.09], [0, 0, 0.5]]
  ]) {
    Object.assign(shaderState.attrs, { skin: [0, 0, 0, partId], position: pos, extra });
    shaderState.varyingSnapshots.clear();
    shaderState.sinCallsInFragment = 0;
    shaderState.stage = 'fragment';
    const col = near.colorNode.eval(), rough = near.roughnessNode.eval();
    assert.equal(shaderState.sinCallsInFragment, 0, `part ${partId}: no hash sin() per fragment`);
    assert.ok(col.length === 3 && col.every((c) => Number.isFinite(c) && c >= 0 && c <= 1.5));
    assert.ok(rough[0] >= 0.35 && rough[0] <= 0.9);
  }
  for (let partId = 0; partId < 8; partId++) {
    shaderState.attrs.skin = [0, 0, 0, partId];
    shaderState.varyingSnapshots.clear();
    shaderState.sinCallsInFragment = shaderState.ifCallsInFragment = 0;
    shaderState.stage = 'fragment';
    const col = far.colorNode.eval(), rough = far.roughnessNode.eval();
    assert.equal(shaderState.ifCallsInFragment, 0, 'PeopleFar: no fragment branches');
    assert.equal(shaderState.sinCallsInFragment, 0, 'PeopleFar: no fragment sin()');
    assert.ok(col.length === 3 && col.every((c) => Number.isFinite(c) && c >= 0 && c <= 1.5));
    assert.ok(rough[0] >= 0.35 && rough[0] <= 0.9);
  }
});

test('the near LOD hoisted to varyings shades exactly as evaluated per fragment, Toronto skin palette included', () => {
  const geo = buildPersonGeometry(1);
  const P = geo.getAttribute('position').array, S = geo.getAttribute('skin').array, E = geo.getAttribute('extra').array;
  const idx = geo.getIndex().array;
  const pose = TSL.attributeArray(STRIDE);
  const near = createPersonMaterial(pose, 1);
  const bary = [0.23, 0.41, 0.36];
  // (seeds hashing to Toronto's two added skin tones, the lightest & deepest, and a bald man)
  for (const [seed, female, girth, hair] of [[1.1, 0, 1.0, 0.2], [4.2, 1, 0.96, 0.85], [9.7, 0, 1.06, 0.05], [0.37, 1, 1, 0.5]]) {
    pose.value.array.set([seed, female, girth, hair], (STRIDE - 1) * 4);
    for (let t = 0; t < idx.length; t += 33) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      const snaps = v.map((vi) => {
        Object.assign(shaderState.attrs, {
          position: [P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]],
          skin: [S[vi * 4], S[vi * 4 + 1], S[vi * 4 + 2], S[vi * 4 + 3]],
          extra: [E[vi * 3], E[vi * 3 + 1], E[vi * 3 + 2]]
        });
        shaderState.varyingSnapshots = new Map();
        near.colorNode.eval();
        near.roughnessNode.eval();
        return shaderState.varyingSnapshots;
      });
      const interp = new Map();
      for (const [key, a] of snaps[0]) interp.set(key, a.map((_, c) => a[c] * bary[0] + snaps[1].get(key)[c] * bary[1] + snaps[2].get(key)[c] * bary[2]));
      shaderState.varyingSnapshots = interp;
      const col = near.colorNode.eval(), rough = near.roughnessNode.eval();
      const lerp3 = (A, n) => [0, 1, 2].slice(0, n).map((c) => A[v[0] * n + c] * bary[0] + A[v[1] * n + c] * bary[1] + A[v[2] * n + c] * bary[2]);
      Object.assign(shaderState.attrs, { position: lerp3(P, 3), skin: [0, 0, 0, S[v[0] * 4 + 3]], extra: lerp3(E, 3) });
      shaderState.varyingSnapshots = new Map();
      const direct = near.colorNode.eval(), directRough = near.roughnessNode.eval();
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(col[c] - direct[c]) < 1e-12, `colour at triangle ${t / 3}`);
      assert.ok(Math.abs(rough[0] - directRough[0]) < 1e-12, `roughness at triangle ${t / 3}`);
    }
  }
});

// controllers.js poseCharacters, lifted out of the class with what it uses
const controllersSource = read('js/controllers.js');
const method = controllersSource.match(/  poseCharacters\(dt, focusPos = null\) \{[^]*?\n  \}\n/)?.[0];
const POSE_RANGE = Number(controllersSource.match(/const POSE_RANGE = (\d+);/)?.[1]);
function poser() {
  const ctx = { POSE_RANGE, personGround: () => 0.22 };
  vm.createContext(ctx);
  return vm.runInContext(`(class Poser { ${method} })`, ctx);
}
const mockCrowd = () => ({ updates: 0, adds: 0, ends: 0, begin() {}, add() { this.adds++; }, end() { this.updates++; this.ends++; } });

test('the parked bike is posed once while still; walker and rider stop and hide beyond 320 m; nothing else is shown', () => {
  assert.ok(method && POSE_RANGE === 320);
  const Poser = poser();
  const c = new Poser();
  c.activeMode = 'car';
  c.getGroundHeight = () => 0.22;
  c.getActiveEntity = () => c.entities[c.activeMode];
  let walks = 0, rides = 0;
  const person = { position: { x: -11.6, y: 0.22, z: 0 }, heading: 0, mesh: { visible: true },
    rig: { placed: true, update() { walks++; this.placed = true; } }, crowd: mockCrowd() };
  const vec = { set() { return this; }, applyQuaternion() { return this; }, add() { return this; } };
  const cyclist = { position: { x: 8.15, y: 0, z: 0 }, heading: 0, leanAngle: 0, pedalPhase: 0, mesh: { visible: true },
    helmet: { visible: true, quaternion: { copy() {} }, position: vec },
    riderRig: { headQuaternion: {}, headPosition: {}, ride() { rides++; } }, riderCrowd: mockCrowd() };
  c.entities = { person, cyclist, car: { position: { x: 3.6, y: 0, z: 0 } } };

  for (let i = 0; i < 5; i++) c.poseCharacters(1 / 60, { x: 0, y: 2, z: 0 });
  assert.equal(walks, 5, 'the walker in range keeps its gait');
  assert.equal(rides, 1, 'the still parked rider is solved once');
  cyclist.pedalPhase = 0.3; // (pushed, turned, moved: posed again)
  c.poseCharacters(1 / 60, { x: 0, y: 2, z: 0 });
  assert.equal(rides, 2);

  for (let i = 0; i < 6; i++) c.poseCharacters(1 / 60, { x: 0, y: 2, z: 4000 });
  assert.equal(person.rig.placed, false, 'the walker stands afresh when it comes back');
  assert.equal(cyclist.helmet.visible, false, 'no helmet floating over an empty saddle');
  assert.equal(person.mesh.visible, true, "the root is transit-riding.js's to hide");
  assert.equal(cyclist.mesh.visible, true, 'the bike (and its lamp) stays');
  const ends = person.crowd.ends + cyclist.riderCrowd.ends;
  for (let i = 0; i < 10; i++) c.poseCharacters(1 / 60, { x: 0, y: 2, z: 4000 });
  assert.equal(person.crowd.ends + cyclist.riderCrowd.ends, ends, 'no crowd work at all while hidden');
  assert.equal(walks, 6);

  c.activeMode = 'cyclist'; // getting on far from the camera (a teleport) poses at once
  c.poseCharacters(1 / 60, { x: 0, y: 2, z: 4000 });
  assert.equal(cyclist.helmet.visible, true);
  assert.equal(rides, 3);

  c.activeMode = 'car';
  person.mesh.visible = false; // (transit-riding.js hid the player)
  c.poseCharacters(1 / 60, { x: 0, y: 2, z: 10 });
  assert.equal(walks, 7, 'back in range, the walker walks again');
  assert.equal(person.mesh.visible, false, 'and a hidden player root stays hidden');
});
