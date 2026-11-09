// The High Park Zoo's idle life (docs/high-park-zoo-animals.md, st-gtnq): the herd's wander step keeps every animal on
// its own species' ground (in the paddock, off the fences and paths, 2 m off Deer Pen Road), clear of the others, and
// is the same for a seed however the frames fall; the walk's legs (tools/zoo/rig.mjs, the shader's twin) keep a foot on
// the ground still while the body goes on, and above the ground
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { pose, GAIT } from '../tools/zoo/rig.mjs';

const root = new URL('..', import.meta.url);
const read = (f) => fs.readFileSync(new URL(`js/${f}.js`, root), 'utf8');
function city(search = '') {
  const context = vm.createContext({ window: { CITY: { THREE, TSL, Addons: { mergeGeometries }, DEBUG_ROADS: false, QUALITY: { surfaceWear: 2, storefronts: 2 } }, addEventListener() {} },
    document: { addEventListener() {}, hidden: false }, location: { search }, URLSearchParams, Intl, performance, console: { info() {}, warn() {}, log() {} }, atob });
  for (const f of ['toronto-geodata', 'toronto-subway', 'toronto-subway-topology', 'high-park-data', 'don-valley', 'city-config', 'tsl-materials', 'high-park-features-data', 'high-park-features']) vm.runInContext(read(f), context);
  const C = context.window.CITY;
  return { C, built: C.buildHighParkFeatures(new THREE.Scene()) };
}
// (a model's rig and its vertices as the game reads them: the quantized attributes to floats, the node's transform baked
// into the positions; js/high-park-features.js zooModels)
async function model(species) {
  const buf = fs.readFileSync(new URL(`assets/zoo/${species}.glb`, root));
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  let m; gltf.scene.traverse((o) => { if (o.isMesh) m = o; });
  m.updateWorldMatrix(true, false);
  const pos = m.geometry.attributes.position, A = m.geometry.attributes._zooa, v = new THREE.Vector3(), verts = [];
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m.matrixWorld);
    verts.push({ p: [v.x, v.y, v.z], a: [A.getX(i), A.getY(i), A.getZ(i), A.getW(i)] });
  }
  return { P: m.userData.zooRig, verts };
}
const { C, built } = city();
const Zs = built.zoo.anim;
const { animals, regions, spotOk } = Zs.inputs;
const SECONDS = 1800;
// (a run of the sim stepped by irregular frames, sampled every `every` s of sim time)
function run(seed, every = 0.25, frames = (r) => 0.005 + r() * 0.09) {
  const sim = C.zooHerdSim({ animals, regions, spotOk, seed });
  let r = 0x9e3779b9;
  const rnd = () => { r = (Math.imul(r ^ (r >>> 15), 2246822507) + 1) >>> 0; return r / 4294967296; };
  const out = [];
  let t = 0, next = 0;
  while (next <= SECONDS) {
    t = Math.min(next, t + frames(rnd));
    sim.advance(t);
    if (t === next) { out.push(animals.map((a, i) => sim.state(i, t))); next = +(next + every).toFixed(6); }
  }
  return { sim, out };
}

test('the herd wanders only on its own ground: in the paddock, off the fences and paths, 2 m off the road, clear of the others', () => {
  assert.equal(animals.length, 29);
  const { sim, out } = run(1);
  const n = animals.length;
  const init = animals.map((a) => [a.x, a.z]);
  let moved = 0, walks = 0;
  const travelled = new Array(n).fill(0);
  const checked = animals.map(() => null);
  out.forEach((frame, f) => {
    frame.forEach((S, i) => {
      if (!(Number.isFinite(S.x) && Number.isFinite(S.z) && Number.isFinite(S.yaw) && Number.isFinite(S.g))) assert.fail(`animal ${i} at ${f}`);
      // (the ground checked wherever it stands anew)
      if (checked[i] && checked[i][0] === S.x && checked[i][1] === S.z) return;
      checked[i] = [S.x, S.z];
      assert.ok(spotOk(S.x, S.z), `animal ${i} (${animals[i].species}) on its ground at ${f * 0.25} s`);
      assert.ok(sim.inRegion(i, S.x, S.z), `animal ${i} in its species' stretch at ${f * 0.25} s`);
      // (Deer Pen Road: off the park's islands is the street)
      assert.ok([[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dz]) => C.blockAt(S.x + dx, S.z + dz)), `animal ${i} 2 m off the road`);
    });
    if (f) frame.forEach((S, i) => { const p = out[f - 1][i], d = Math.hypot(S.x - p.x, S.z - p.z); travelled[i] += d; if (d > 0.25 * 0.8 + 1e-9) assert.fail(`animal ${i} amble ${d} m in 0.25 s`); if (S.amp > 0.5 && p.amp <= 0.5 && d > 0) walks++; });
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(frame[i].x - frame[j].x, frame[i].z - frame[j].z), d0 = Math.hypot(init[i][0] - init[j][0], init[i][1] - init[j][1]);
      if (d < Math.min(d0, sim.radius(i) + sim.radius(j)) - 1e-6) assert.fail(`animals ${i} and ${j} ${d.toFixed(2)} m apart at ${f * 0.25} s`);
    }
  });
  moved = travelled.filter((d) => d > 1).length;
  // (they do wander, if rarely: most of them in half an hour; the capybaras least)
  assert.ok(moved >= n * 0.6, `${moved} of ${n} moved`);
  assert.ok(walks >= n, `${walks} walks`);
  const capy = animals.map((a, i) => (a.species === 'capybara' ? travelled[i] : 0)).reduce((s, d) => s + d, 0);
  const bison = animals.map((a, i) => (a.species === 'bison' ? travelled[i] : 0)).reduce((s, d) => s + d, 0);
  assert.ok(capy < bison, `capybaras ${capy.toFixed(1)} m, bison ${bison.toFixed(1)} m`);
});

test('the same seed gives the same herd however the frames fall; another seed another', () => {
  const a = run(7, 1, () => 0.016).out, b = run(7, 1, (r) => 0.001 + r() * 0.099).out, c = run(8, 1, () => 0.016).out;
  assert.deepEqual(b, a);
  assert.notDeepEqual(c, a);
});

test('the poses change smoothly: no jumps between acts', () => {
  const sim = C.zooHerdSim({ animals, regions, spotOk, seed: 3 });
  let prev = null;
  for (let t = 0; t <= 600; t += 0.01) {
    sim.advance(t);
    const now = animals.map((a, i) => sim.state(i, t));
    if (prev) now.forEach((S, i) => {
      const p = prev[i];
      if (!(Math.abs(S.g - p.g) < 0.12 && Math.abs(S.look - p.look) < 0.06 && Math.abs(S.yaw - p.yaw) < 0.02 && Math.abs(S.amp - p.amp) < 0.03)) assert.fail(`animal ${i} at ${t.toFixed(2)} s: ${JSON.stringify(p)} -> ${JSON.stringify(S)}`);
    });
    prev = now;
  }
});

test('walking: a foot on the ground stays put while the body goes on, and no foot goes under the ground', async () => {
  for (const species of ['bison', 'llama', 'mouflon', 'emu', 'peafowl', 'capybara']) {
    const { P, verts } = await model(species);
    // each leg's lowest point (the hoof's sole)
    const feet = {};
    for (const vx of verts) {
      const code = Math.floor(vx.a[3] * 8 + 0.02);
      if (code < 1 || code > 4) continue;
      if (!feet[code] || vx.p[1] < feet[code].p[1]) feet[code] = vx;
    }
    assert.equal(Object.keys(feet).length, P.bird ? 2 : 4, `${species}: its legs`);
    // a walk along +z: the body at s(t), the stride e(t), the swing min(1, v / v0)
    const prof = C.zooWalkProfile(5, 0.5);
    let slip = 0, stance = 0, low = Infinity;
    for (const [code, f] of Object.entries(feet)) {
      let prev = null, settle = 0;
      for (let t = 0; t <= prof.d; t += 0.02) {
        const S = { g: 0, look: 0, stride: prof.e(t), amp: Math.min(1, prof.v(t) / prof.v0), t, seed: 0 };
        const q = pose(f.p, [0, 1, 0], f.a, P, S).p, z = q[2] + prof.s(t);
        low = Math.min(low, q[1]);
        const u = ((((S.stride * GAIT.duty) / (2 * P.exc) + GAIT.offset[code]) % 1) + 1) % 1;
        if (prev && u < GAIT.duty - 0.02 && prev.u < u) {
          // (at full swing: the slide against the way gone; while the swing grows or dies away, the settling of the feet)
          if (S.amp === 1 && prev.amp === 1) { slip += Math.abs(z - prev.z); stance += prof.s(t) - prof.s(t - 0.02); } else settle += Math.abs(z - prev.z);
        }
        prev = { z, u, amp: S.amp };
      }
      assert.ok(settle < 1.5 * P.exc, `${species} leg ${code}: ${settle.toFixed(3)} m of settling for a ${P.exc} m stride`);
    }
    // (at walking pace the hoof on the ground slides less than 3 % of the way the body goes; nothing below the ground)
    assert.ok(stance > 1 && slip < 0.03 * stance, `${species}: ${slip.toFixed(3)} m slip over ${stance.toFixed(2)} m of stance`);
    // (a toe tips at most 3 cm into the ground at the ends of a stride: the ground cover hides it)
    assert.ok(low > -0.03, `${species}: a foot ${low.toFixed(3)} m under the ground`);
  }
});

test('grazing: the grazers\' muzzles reach the grass (within 3 cm of the ground), the peafowl\'s beak pecks well ahead of its feet (0.38 m before st-gtnq\'s ease)', async () => {
  for (const species of ['bison', 'yak', 'highland', 'reindeer', 'mouflon', 'barbary', 'peafowl']) {
    const { P, verts } = await model(species);
    // (the head: the vertices fully on the neck; fully grazed, and at the sim's deepest nibble, g 1.04)
    for (const g of [1, 1.04]) {
      let low = Infinity, z = 0;
      for (const vx of verts) {
        if (vx.a[0] < 0.98) continue;
        const q = pose(vx.p, [0, 1, 0], vx.a, P, { g, look: 0, stride: 0, amp: 0, t: 0, seed: 0 }).p;
        if (q[1] < low) { low = q[1]; z = q[2]; }
      }
      if (species === 'peafowl') {
        assert.ok(low < 0.08 && low > -0.03, `peafowl: beak ${low.toFixed(3)} m over the ground at g ${g}`);
        assert.ok(z > 0.39, `peafowl: the peck ${z.toFixed(2)} m ahead of its feet`);
      } else assert.ok(Math.abs(low) <= 0.03, `${species}: muzzle ${low.toFixed(3)} m from the ground at g ${g}`);
    }
  }
});
