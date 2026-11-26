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

test('the word is TORONTO, 7 letters about 22 m long and 3 m tall, between a medicine wheel and a maple leaf', () => {
  const slots = TS.letterSlots();
  assert.equal(slots.map((s) => s.ch).join(''), 'TORONTO');
  const west = slots[0].x, east = slots.at(-1).x + slots.at(-1).w;
  assert.ok(Math.abs(east - west - 22) < 0.8, `letters span ${east - west}`);
  assert.ok(Math.abs(TS.SPEC.height - 3) < 0.15, 'the City: three metres tall');
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i].x > slots[i - 1].x + slots[i - 1].w, 'letters do not touch');
  const els = TS.signElements();
  assert.equal(els[0].kind, 'wheel'); assert.equal(els.at(-1).kind, 'leaf');
  assert.ok(els[0].x + els[0].w <= slots[0].x && els.at(-1).x >= east, 'the wheel is west of the T and the leaf east of the last O');
  // the whole sign runs the orthophoto's 31 m (x -22.3 to 8.5)
  assert.ok(Math.abs(els[0].x - -22.3) < 0.3 && Math.abs(els.at(-1).x + els.at(-1).w - 8.5) < 0.5);
  assert.ok(Math.abs(els[0].h - TS.SPEC.height) < 0.3, 'the wheel is about the letters\' height');
});

test('the lit colours are the photograph\'s: T cyan, O violet, R magenta, O red, N orange, T yellow, O white', () => {
  const hue = (hex) => { const r = (hex >> 16) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return -1; const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60; };
  const h = TS.SPEC.colors.map(hue);
  const near = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) < 25;
  assert.ok(near(h[0], 190) && near(h[1], 270) && near(h[2], 310) && near(h[3], 3) && near(h[4], 30) && near(h[5], 55) && h[6] === -1);
});

test('the medicine wheel has four quarters in the white, yellow, red, black order and a rim; the leaf has 11 points and a silver rim', () => {
  const wp = TS.wheelPieces();
  assert.equal(wp.map((p) => p.kind).join(), 'rim,white,yellow,red,black');
  const r = TS.SPEC.wheel.d / 2;
  const centroid = (p) => { const n = p.outer.length; return [p.outer.reduce((s, q) => s + q[0], 0) / n - r, p.outer.reduce((s, q) => s + q[1], 0) / n - r]; };
  const quad = Object.fromEntries(wp.slice(1).map((p) => [p.kind, centroid(p)]));
  assert.ok(quad.white[0] < 0 && quad.white[1] > 0 && quad.yellow[0] > 0 && quad.yellow[1] > 0 && quad.red[0] > 0 && quad.red[1] < 0 && quad.black[0] < 0 && quad.black[1] < 0, 'top left white, top right yellow, bottom right red, bottom left black');
  assert.equal(wp[0].holes.length, 1);
  // 11 points: the outline's sharp tips (interior angle under 80 degrees, not the stem's two square corners at about 86)
  const ol = TS.leafOutline(), n = ol.length; let tips = 0;
  for (let i = 0; i < n; i++) {
    const a = ol[(i + n - 1) % n], b = ol[i], c = ol[(i + 1) % n];
    const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const ang = Math.acos((v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2))) * 180 / Math.PI;
    if (ang < 80) tips++;
  }
  assert.equal(tips, 11);
  const us = TS.LEAF_OUTLINE.map((p) => p[0]);
  assert.ok(Math.abs(Math.min(...us)) < 1e-6 && Math.abs(Math.max(...us) - 1) < 1e-6, 'normalised');
  const [rim, face] = TS.leafPieces();
  assert.equal(rim.kind, 'rim'); assert.equal(face.kind, 'leaf');
  const w = (o) => Math.max(...o.map((q) => q[0])) - Math.min(...o.map((q) => q[0]));
  assert.ok(w(rim.outer) > w(face.outer) && w(rim.outer) < w(face.outer) * 1.12, 'a thin silver rim all round');
});

test('the fountain: 40 jets along the sign, on in the water season only (spring to autumn), never on the ice', () => {
  const jets = TS.jetSites();
  assert.equal(jets.length, 40);
  assert.ok(jets[0].x < -17 && jets.at(-1).x > 6 && jets.every((j) => j.z > bbox.z0 + 7 && j.z < bbox.z0 + 11 && j.h > 0.8 && j.h < 2.1));
  for (let i = 1; i < jets.length; i++) assert.ok(jets[i].x > jets[i - 1].x);
  assert.equal(TS.colorAt(jets[0].x), TS.SPEC.colors[0], 'a jet takes the lit colour of the letter behind it');
  for (const m of [4, 5, 7, 8, 10]) assert.equal(TS.fountainOn({ season: 'off', month: m }), true, 'month ' + m);
  for (const m of [1, 2, 3, 11, 12]) assert.equal(TS.fountainOn({ season: 'off', month: m }), false, 'month ' + m);
  for (const m of [1, 7, 12]) assert.equal(TS.fountainOn({ season: 'ice', month: m, forced: true }), false);
  assert.equal(TS.fountainOn({ season: 'off', month: 1, forced: true }), true, 'a forced water preview shows it');
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

test('the builder makes one lit sign mesh and a plinth, with one collider covering the wheel and the leaf, facing south', () => {
  const C = load({ CITY_BOUNDS: { sidewalkHeight: 0.15 }, blockAt: () => ({}), QUALITY: {}, cityUniforms: { uInteriorGlow: { value: 1 } }, rinkStats: { season: 'ice', forced: false } });
  const scene = new THREE.Scene();
  const r = C.buildTorontoSign(scene);
  assert.equal(r.colliders.length, 1);
  assert.ok(r.colliders[0].minX <= -22.3 && r.colliders[0].maxX >= 8.4 && r.colliders[0].maxY - r.colliders[0].minY >= 3.3 + 0.4, 'solid from the wheel to the leaf');
  assert.ok(!r.group.getObjectByName('TorontoSignFountainJets') && !r.group.getObjectByName('TorontoSignReflection'), 'no fountain or reflection on the ice');
  const letters = r.group.getObjectByName('TorontoSignLetters');
  assert.ok(letters.geometry.attributes.position.count / 3 > 600 && letters.geometry.attributes.position.count / 3 < 9000);
  assert.ok(letters.geometry.attributes.color && letters.geometry.attributes.glow, 'pale day colours and the lit glow');
  assert.ok(letters.material.emissiveNode, 'lit');
  letters.geometry.computeBoundingBox();
  const bb = letters.geometry.boundingBox;
  assert.ok(bb.max.y - bb.min.y >= TS.SPEC.height && bb.max.y - bb.min.y < TS.SPEC.leaf.h + 0.3, 'the leaf stands a little above the letters');
  assert.ok(Math.abs(bb.max.z - (TS.SPEC.zc + TS.SPEC.depth / 2)) < 0.06, 'the front faces are flush');
  // faces look south (+z): the area-weighted normal of the front faces dominates the back's in the letters' outline
  const n = letters.geometry.attributes.normal; let south = 0, north = 0;
  for (let i = 0; i < n.count; i++) { if (n.getZ(i) > 0.9) south++; else if (n.getZ(i) < -0.9) north++; }
  assert.ok(south > 0 && south >= north);
});

test('in the water season the builder adds the reflected colour, the jets and their lit bases (cheap: a few hundred triangles); in a cold forced preview the jets are gone', () => {
  const env = { CITY_BOUNDS: { sidewalkHeight: 0.15 }, blockAt: () => ({}), QUALITY: {}, cityUniforms: { uInteriorGlow: { value: 1 } } };
  const C = load({ ...env, rinkStats: { season: 'off', forced: false }, SITE_DATE: { month: 8, day: 22 } });
  const r = C.buildTorontoSign(new THREE.Scene());
  for (const n of ['TorontoSignReflection', 'TorontoSignFountainJets', 'TorontoSignFountainLights']) assert.ok(r.group.getObjectByName(n), n);
  assert.equal(C.torontoSignStats.jets, 40);
  assert.ok(C.torontoSignStats.waterTriangles < 700);
  const winterWater = load({ ...env, rinkStats: { season: 'off', forced: false }, SITE_DATE: { month: 11, day: 26 } });
  const w = winterWater.buildTorontoSign(new THREE.Scene());
  assert.ok(w.group.getObjectByName('TorontoSignReflection') && !w.group.getObjectByName('TorontoSignFountainJets'), 'late November: still water, the fountain is off');
});
