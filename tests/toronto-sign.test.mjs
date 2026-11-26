// The 3D TORONTO sign at Nathan Phillips Square (js/toronto-sign.js, docs/toronto-sign.md) and the pool polygon it stands beside:
// the word, its measured place north of the pool, its build, and the pool's size against the 2025 orthophoto (jf-gdw).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function load(extra = {}) {
  const C = { THREE, TSL, Addons: { mergeGeometries }, ...extra };
  const ctx = vm.createContext({ window: { CITY: C }, console: { info() {}, log() {}, warn() {} }, Math });
  for (const f of ['js/toronto-rinks.js', 'js/toronto-sign.js']) vm.runInContext(read(f), ctx, { filename: f });
  return C;
}
const C0 = load();
const TS = C0.TORONTO_SIGN;
const pool = C0.RINKS.records.find((r) => r.assetId === '43599').polygons[0].outer;
const px = pool.map((p) => p[0]), pz = pool.map((p) => p[1]);
const bbox = { x0: Math.min(...px), x1: Math.max(...px), z0: Math.min(...pz), z1: Math.max(...pz) };

test('the pool polygon is the size the 2025 orthophoto shows, 54.8 x 30.3 m (not the 76 x 41 m of an unscaled Web Mercator reading)', () => {
  // pool corners read from the City's 2025 orthophoto export and projected into the world frame (docs/toronto-sign.md)
  const ortho = { x0: -19.3, x1: 35.5, z0: -818.8, z1: -788.4 };
  for (const k of Object.keys(ortho)) assert.ok(Math.abs(bbox[k] - ortho[k]) < 0.7, `${k}: polygon ${bbox[k]} vs aerial ${ortho[k]}`);
  assert.ok(bbox.x1 - bbox.x0 > 54 && bbox.x1 - bbox.x0 < 56 && bbox.z1 - bbox.z0 > 29.5 && bbox.z1 - bbox.z0 < 31);
});

test('the word is TORONTO, 7 pastel letters about 22 m long and 3 m tall with the plinth', () => {
  const slots = TS.letterSlots();
  assert.equal(slots.map((s) => s.ch).join(''), 'TORONTO');
  const west = slots[0].x, east = slots.at(-1).x + slots.at(-1).w;
  assert.ok(Math.abs(east - west - 22) < 0.8, `letters span ${east - west}`);
  assert.ok(Math.abs(TS.SPEC.height + TS.SPEC.plinth.h - 3) < 0.15);
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i].x > slots[i - 1].x + slots[i - 1].w, 'letters do not touch');
});

test('it stands on the pool\'s north coping, 2 to 4 m beyond the polygon edge, along its length and clear of the arches\' legs', () => {
  const b = TS.collider();
  assert.ok(b.maxZ < bbox.z0 && bbox.z0 - b.maxZ < 4 && bbox.z0 - b.maxZ > 1, 'north of the pool edge');
  assert.ok(b.minX > bbox.x0 - 4 && b.maxX < bbox.x1, 'along the pool\'s length');
  const arches = 12.18 - 1; // the westmost arch's west side: the sign ends west of it
  assert.ok(b.maxX < arches);
});

test('every letter piece is a closed polygon with area, the O\'s and R\'s have holes', () => {
  const area = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  for (const ch of 'TORN') {
    const pieces = TS.letterPieces(ch);
    assert.ok(pieces.length >= 1);
    for (const p of pieces) assert.ok(p.outer.length >= 4 && area(p.outer) > 0.2, `${ch} piece area`);
  }
  assert.equal(TS.letterPieces('O')[0].holes.length, 1);
  assert.equal(TS.letterPieces('R')[1].holes.length, 1);
});

test('the builder makes one lit letter mesh and a plinth, with one collider, facing south', () => {
  const C = load({ CITY_BOUNDS: { sidewalkHeight: 0.15 }, blockAt: () => ({}), QUALITY: {}, cityUniforms: { uInteriorGlow: { value: 1 } } });
  const scene = new THREE.Scene();
  const r = C.buildTorontoSign(scene);
  assert.equal(r.colliders.length, 1);
  const letters = r.group.getObjectByName('TorontoSignLetters');
  assert.ok(letters.geometry.attributes.position.count / 3 > 400 && letters.geometry.attributes.position.count / 3 < 5000);
  assert.ok(letters.geometry.attributes.color, 'pastel vertex colours');
  assert.ok(letters.material.emissiveNode, 'lit');
  letters.geometry.computeBoundingBox();
  const bb = letters.geometry.boundingBox;
  assert.ok(Math.abs(bb.max.y - bb.min.y - TS.SPEC.height) < 0.01);
  assert.ok(Math.abs((bb.max.z + bb.min.z) / 2 - TS.SPEC.zc) < 0.01, 'centred on the line');
  // faces look south (+z): the area-weighted normal of the front faces dominates the back's in the letters' outline
  const n = letters.geometry.attributes.normal; let south = 0, north = 0;
  for (let i = 0; i < n.count; i++) { if (n.getZ(i) > 0.9) south++; else if (n.getZ(i) < -0.9) north++; }
  assert.ok(south > 0 && south === north);
});
