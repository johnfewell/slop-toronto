// Locks what PersonRig draws. 16 rigs (mixed sizes, builds and seeds) run 600 frames through walking, turning, running,
// sprinting, standing idle, jumps (positive and negative `air`), a dive, backward steps, uneven ground, uneven frame
// times, a relocation and a rider. Each frame's whole pose buffer and gait state is folded into one weighted sum; per rig
// the table keeps the total and 12 checkpoints (every 50th frame) rounded to 1e-9, and an exact hash of the Float32 bits.
// The test accepts 1e-6; with PED_FP_STRICT=1 it also demands the identical hash. PED_FP_PRINT=1 prints a fresh table.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three/three.core.js';

const source = fs.readFileSync(new URL('../js/pedestrians.js', import.meta.url), 'utf8');
const window = { CITY: { THREE, TSL: {}, Addons: {} } };
vm.runInNewContext(source, { window, Math });
const { PersonRig } = window.CITY;

const FRAMES = 600;
const bumpy = (_o, x, z) => 0.12 * Math.sin(x * 0.7) * Math.cos(z * 0.5) + (x % 20 < 8 ? 0.15 : 0);
const flat = () => 0;
const SCALES = [1, 0.86, 1.12, 1.2, 0.95, 1.05, 1, 0.9, 1.1, 1, 1.02, 0.98, 1.15, 0.88, 1, 1.07];
const MODES = ['walk', 'turn', 'run', 'sprint', 'idle', 'jumpMove', 'jumpCrouch', 'jumpStand', 'dive', 'ride', 'backward', 'bumpy', 'turnSpot', 'relocate', 'stopGo', 'unevenDt'];

function makeRig(k) {
  return new PersonRig({ seed: 0.37 + k * 1.91, scale: SCALES[k], female: k % 2 === 1, girth: 0.92 + (k % 5) * 0.05, hair: (k % 4) * 0.3, armSwing: 0.9 + (k % 3) * 0.1, stride: 0.95 + (k % 4) * 0.05 });
}

// Position and heading at frame f for each mode (a smooth, deterministic path)
function drive(mode, f) {
  const t = f / 60;
  switch (mode) {
    case 'walk': return { x: 0, z: t * 1.4, h: 0 };
    case 'turn': return { x: Math.sin(t * 0.5) * 6, z: Math.cos(t * 0.5) * 6, h: Math.PI / 2 - t * 0.5 };
    case 'run': return { x: 0, z: t * 4, h: 0 };
    case 'sprint': return { x: t * 8, z: 0, h: Math.PI / 2 };
    case 'idle': return { x: 3, z: 4, h: 0.4 };
    case 'jumpMove': return { x: 0, z: t * 1.6, h: 0.2 };
    case 'jumpCrouch': return { x: 1, z: t * 3.4, h: 0 };
    case 'jumpStand': return { x: -2, z: 2, h: 1 };
    case 'dive': return { x: 0, z: f < 90 ? t * 1.2 : 1.8 + (f - 90) * 0.001, h: 0.3 };
    case 'backward': return { x: 0, z: -t * 1.1, h: 0 };
    case 'bumpy': return { x: t * 1.5, z: Math.sin(t) * 2, h: Math.PI / 2 };
    case 'turnSpot': return { x: 0, z: 0, h: f < 100 ? 0 : f < 300 ? Math.PI * 0.9 : f < 450 ? -1.6 : -1.6 + (f - 450) * 0.02 };
    case 'relocate': return { x: f < 300 ? t * 1.3 : 40 + t * 1.3, z: 0, h: Math.PI / 2 };
    case 'stopGo': return { x: 0, z: f < 120 ? t * 1.5 : f < 300 ? 3 : f < 420 ? 3 + (f - 300) / 60 * 2.2 : 7.4, h: 0 };
    case 'unevenDt': return { x: 0, z: t * 2.6, h: 0 };
    default: return { x: 0, z: 0, h: 0 };
  }
}
function airAt(mode, f) {
  const arc = (a, b, peak) => (f >= a && f < b ? peak * Math.sin((f - a) / (b - a) * Math.PI) : 0);
  if (mode === 'jumpMove') return arc(100, 140, 0.8) + arc(300, 336, 0.5);
  if (mode === 'jumpStand') return arc(60, 100, 0.9) + arc(240, 280, 0.35);
  if (mode === 'jumpCrouch') return f >= 80 && f < 100 ? -(f - 80) / 20 : f >= 100 && f < 106 ? -1 : arc(106, 146, 0.7);
  return 0;
}

function runRig(k) {
  const mode = MODES[k];
  const rig = makeRig(k);
  const ground = mode === 'bumpy' ? bumpy : flat;
  const root = new THREE.Group();
  root.position.set(5, 0, -3);
  const frame = { seat: new THREE.Vector3(0, 0.95, -0.2), bars: new THREE.Vector3(0, 1.05, 0.5), gripHalf: 0.22, bracket: new THREE.Vector3(0, 0.34, -0.145), crankLength: 0.17 };
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  let hash = 2166136261;
  let total = 0;
  const checks = [];
  for (let f = 0; f < FRAMES; f++) {
    const { x, z, h } = drive(mode, f);
    const dt = mode === 'unevenDt' ? [1 / 60, 1 / 30, 1 / 144, 0.05, 1 / 60][f % 5] : 1 / 60;
    if (mode === 'ride') {
      root.position.set(5 + f * 0.04, 0, -3 + Math.sin(f * 0.03));
      root.rotation.y = 0.8 + f * 0.004;
      rig.ride(root, f * 0.2, frame);
    } else if (mode === 'dive') {
      rig.update(dt, x, z, h, ground, null, 0, true, f >= 30 && f < 180 ? (f - 30) / 60 : -1);
    } else {
      rig.update(dt, x, z, h, ground, null, airAt(mode, f));
    }
    // Weighted sum of the pose plus the gait state the next frame reads
    let sum = 0;
    const p = rig.pose;
    for (let i = 0; i < p.length; i++) sum += p[i] * (1 + (i % 7) * 0.13);
    sum += rig.thighSplit * 3.1 + rig.phase * 5.3 + rig.pelvisY * 7.9 + rig.arm * 2.3 + rig.pelvisYaw * 1.7;
    for (const foot of rig.feet) sum += foot.px + foot.py * 1.3 + foot.pz * 0.7 + foot.ax * 0.9 + foot.ay + foot.az * 1.1 + foot.pitch * 0.5;
    total += sum;
    if (f % 50 === 49) checks.push(Math.round(sum * 1e9) / 1e9);
    for (let i = 0; i < p.length; i++) { f32[0] = p[i]; hash = Math.imul(hash ^ u32[0], 16777619) >>> 0; }
    assert.ok(p.every(Number.isFinite), `${mode} frame ${f}: finite pose`);
  }
  return { mode, total: Math.round(total * 1e9) / 1e9, checks, hash: hash.toString(16) };
}

const EXPECTED = JSON.parse(fs.readFileSync(new URL('./fixtures/pedestrian-gait-fingerprint.json', import.meta.url), 'utf8'));

test('PersonRig output over 600 frames of 16 rigs matches the recorded fingerprint', () => {
  const got = MODES.map((_, k) => runRig(k));
  if (process.env.PED_FP_PRINT) { fs.writeFileSync(process.env.PED_FP_PRINT, JSON.stringify(got, null, 1) + '\n'); return; }
  assert.equal(got.length, EXPECTED.length);
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b) * 1e-3), `${msg}: ${a} vs ${b}`);
  got.forEach((g, k) => {
    const e = EXPECTED[k];
    assert.equal(g.mode, e.mode);
    near(g.total, e.total, `${g.mode} total`);
    g.checks.forEach((c, i) => near(c, e.checks[i], `${g.mode} frame ${i * 50 + 49}`));
    if (process.env.PED_FP_STRICT) assert.equal(g.hash, e.hash, `${g.mode}: pose bits`);
  });
});

test('a person whose pose solve is skipped keeps exactly the gait of one who is posed every frame', () => {
  MODES.forEach((mode, k) => {
    if (mode === 'ride' || mode === 'dive') return;
    const posed = makeRig(k);
    const hidden = makeRig(k);
    const ground = mode === 'bumpy' ? bumpy : flat;
    const state = (rig) => JSON.stringify(rig, (key, v) => (key === 'pose' ? undefined : v));
    for (let f = 0; f < FRAMES; f++) {
      const { x, z, h } = drive(mode, f);
      const dt = mode === 'unevenDt' ? [1 / 60, 1 / 30, 1 / 144, 0.05, 1 / 60][f % 5] : 1 / 60;
      const air = airAt(mode, f);
      posed.update(dt, x, z, h, ground, null, air);
      hidden.update(dt, x, z, h, ground, null, air, f % 7 === 0);
      assert.equal(state(hidden), state(posed), `${mode} frame ${f}`);
      if (f % 7 === 0) assert.deepEqual(Array.from(hidden.pose), Array.from(posed.pose), `${mode} frame ${f}: pose when drawn again`);
    }
  });
});
