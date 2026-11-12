// QCYC stored-dinghy runtime trial (js/waterfront-dinghies.js + -data, st-sb3r.38 phase 2).
//
// The 2024 City orthophoto shows eight open dinghies stored on the QCYC marina apron. The captain viewed the corrected
// PCA placement and approved these exact 8 placements for a runtime trial. The runtime draws the real, CC0 prepared
// hull (assets/models/waterfront-dinghies/boat-row-large-white.glb — white open hull, paddles removed) as ONE InstancedMesh
// (one shared geometry + one shared material) at the measured placements, with real oriented-footprint colliders.
//
// These tests are PORTABLE (no /tmp, no network, no silent skip): they load the committed GLB through the real three.js
// GLTFLoader and prove:
//   - the data names the CC0 Kenney pack, the prepared white GLB and the 2024 City orthophoto (reference only), with the
//     8 PCA-measured placements (length 3.6-4.3 m, width 1.7-1.8 m, diagonal pixel axis) and no boat-identity claim;
//   - buildWaterfrontDinghies builds a single InstancedMesh (8 instances) with one shared geometry/material, real bounds,
//     and 8 oriented-footprint colliders whose maxY is within the visual hull height;
//   - the transformed instance geometry sits inside each collider and on the ground;
//   - a missing asset / loader / data / frame yields ready:false with an EMPTY group, NO colliders and NO invented fallback;
//   - phase 2 does not edit main.js / explore.html (the captain wires the call).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const exists = (p) => fs.existsSync(new URL(`../${p}`, import.meta.url));
const ROOT = new URL('..', import.meta.url).pathname;

const loadBin = async (rel) => {
  let u8 = new Uint8Array(fs.readFileSync(new URL(`../${rel}`, import.meta.url)));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  const { decodeGeo } = await import('../js/geodata-loader.js');
  return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
};
const detail = await loadBin('data/toronto-geodata.bin');

const DATA_MODULE = 'js/waterfront-dinghies-data.js';
const RUNTIME = 'js/waterfront-dinghies.js';
const MODEL = 'assets/models/waterfront-dinghies/boat-row-large-white.glb';

class LocalLoader {
  loadAsync(url) {
    const buf = fs.readFileSync(path.resolve(ROOT, url));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  }
}

function city({ loader = LocalLoader, withData = true, withRuntime = true, geo = detail.GEO } = {}) {
  const Addons = { mergeGeometries };
  if (loader) Addons.GLTFLoader = loader;
  const CITY = { THREE, Addons, GEO: geo, CITY_BOUNDS: { sidewalkHeight: 0.22 } };
  const ctx = { window: { CITY }, console: { info() {}, log() {}, warn() {}, error() {} }, performance, setTimeout, Promise };
  vm.createContext(ctx);
  if (withData) vm.runInContext(read(DATA_MODULE), ctx, { filename: DATA_MODULE });
  if (withRuntime) vm.runInContext(read(RUNTIME), ctx, { filename: RUNTIME });
  return ctx.window.CITY;
}

const glbJson = (file) => {
  const buf = fs.readFileSync(new URL(`../${file}`, import.meta.url));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 12, json = null;
  while (off < buf.byteLength) { const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true); off += 8; if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(buf.subarray(off, off + len))); off += len; }
  return json;
};
const data = (() => { const C = city({ withRuntime: false }); return C.WATERFRONT_DINGHIES_DATA; })();

// transform world -> local within a collider obb for an inside test
function inObb(col, x, z, pad = 0) {
  const { cx, cz, hx, hz, cs, sn } = col.obb;
  const dx = x - cx, dz = z - cz;
  const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
  return Math.abs(u) <= hx + pad && Math.abs(v) <= hz + pad;
}

test('the data names the CC0 Kenney pack, the prepared white GLB, and the 2024 City orthophoto reference', () => {
  assert.equal(data.kind, 'waterfront-dinghies-qcyc');
  assert.equal(data.asset.licence, 'CC0 1.0 Universal');
  assert.match(data.asset.pack, /Kenney Watercraft Kit 2\.1/);
  assert.match(data.asset.file, /assets\/models\/waterfront-dinghies\/boat-row-large-white\.glb$/);
  assert.match(data.source.service, /cot_ortho_2024_color_8cm\/MapServer/);
  assert.match(data.source.licence, /Open Government Licence – Toronto/);
  assert.match(data.source.note, /not a current fleet|seasonal storage/i);
  assert.equal(data.marina.osmWay, 193043084);
  assert.equal(data.rows.length, 8, 'the 8 approved placements');
});

test('the 8 placements are the PCA-measured individual hulls (3.6-4.3 m x 1.7-1.8 m, diagonal), unchanged', () => {
  for (const r of data.rows) {
    assert.equal(r.length, 9, 'row is [x,z,yaw,len,wid,pxX,pxY,axisX,axisY]');
    const len = r[3] / 100, wid = r[4] / 100;
    assert.ok(len >= 3.5 && len <= 4.4, `length ${len}`);
    assert.ok(wid >= 1.6 && wid <= 1.9, `width ${wid}`);
    assert.ok(len > wid + 0.8, 'long-axis, not square');
    assert.ok(Math.abs(r[7] / 1000) > 0.3 && Math.abs(r[8] / 1000) > 0.3, 'diagonal pixel axis');
    assert.ok(Math.abs(Math.hypot(r[7] / 1000, r[8] / 1000) - 1) < 0.02, 'unit pixel axis');
  }
});

test('the prepared GLB is the real white open hull, no paddles, no textures (CC0 adaptation)', () => {
  assert.ok(exists(MODEL), 'the prepared GLB is committed');
  const g = glbJson(MODEL);
  assert.ok(!g.meshes.some((m) => m.name === 'paddles'), 'paddles removed');
  assert.equal(g.textures ? g.textures.length : 0, 0, 'no textures');
  assert.ok((g.images ? g.images.length : 0) === 0, 'no images');
  const bcf = g.materials[0].pbrMetallicRoughness.baseColorFactor;
  assert.ok(bcf[0] > 0.9 && bcf[1] > 0.9 && bcf[2] > 0.85, `white ${bcf}`);
  const p = read('assets/models/waterfront-dinghies/PROVENANCE.md');
  assert.match(p, /CC0 1\.0 Universal/);
  assert.match(p, /kenney\.nl/i);
});

test('buildWaterfrontDinghies builds one InstancedMesh of 8 with shared geometry/material, real bounds and colliders', async () => {
  const C = city();
  const scene = new THREE.Scene();
  const d = await C.buildWaterfrontDinghies(THREE, scene);
  assert.equal(d.ready, true, 'the real asset loaded and built');
  // exactly one hull InstancedMesh with 8 instances, one geometry + one material shared
  const inst = d.group.children.filter((o) => o.isInstancedMesh);
  assert.equal(inst.length, 1, 'one instanced hull mesh');
  assert.equal(inst[0].count, 8, '8 instances');
  assert.equal(inst[0].material === inst[0].material, true);
  assert.ok(d.geometry && d.geometry.attributes.position, 'geometry is the merged real GLB');
  assert.ok(inst[0].boundingBox && inst[0].boundingSphere, 'real bounds computed');
  // 8 oriented colliders, maxY within the visual hull height
  assert.equal(d.colliders.length, 8, '8 colliders');
  for (const c of d.colliders) {
    assert.equal(c.kind, 'dinghy');
    assert.ok(c.maxY - c.minY <= 0.64 + 1e-6, `collider height ${c.maxY - c.minY} within the 0.64 m hull`);
    assert.ok(c.obb && Math.abs(Math.hypot(c.obb.cs, c.obb.sn) - 1) < 1e-6, 'oriented obb');
  }
  assert.equal(d.layout.count, 8);
  assert.equal(d.hulls.length, 8);
});

test('each transformed instance sits on the ground and inside its oriented collider', async () => {
  const C = city();
  const d = await C.buildWaterfrontDinghies(THREE, null);
  const inst = d.group.children.find((o) => o.isInstancedMesh);
  const mat = new THREE.Matrix4();
  const v = new THREE.Vector3();
  inst.geometry.computeBoundingBox();
  const bb = inst.geometry.boundingBox;
  // sample the geometry's bbox corners through each instance matrix; every corner must lie inside that hull's collider.
  const corners = [];
  for (const sx of [bb.min.x, bb.max.x]) for (const sy of [bb.min.y, bb.max.y]) for (const sz of [bb.min.z, bb.max.z]) corners.push(new THREE.Vector3(sx, sy, sz));
  for (let i = 0; i < inst.count; i++) {
    inst.getMatrixAt(i, mat);
    const col = d.colliders[i];
    let minY = Infinity;
    for (const c of corners) {
      v.copy(c).applyMatrix4(mat);
      // inside the collider footprint with a small tolerance for the oriented-box corners
      assert.ok(inObb(col, v.x, v.z, 0.02), `instance ${i} corner ${v.x.toFixed(2)},${v.z.toFixed(2)} inside its collider`);
      minY = Math.min(minY, v.y);
    }
    // base sits on / just above the ground (never below, never floating)
    const y = col.minY;
    assert.ok(Math.abs(minY - y) < 0.05, `instance ${i} base ${minY.toFixed(3)} ~ ground ${y.toFixed(3)}`);
  }
});

test('hulls stand on the flat marina ground (no +22 cm sidewalk hover), and prefer the exact verge surface when available', async () => {
  // (a) no verge sampler: the marina is flat, so base y must be 0 (+ cutAt), never the raised sidewalk (.22+.004).
  const C = city();
  const d = await C.buildWaterfrontDinghies(THREE, null);
  assert.equal(d.ready, true);
  for (const h of d.hulls) {
    assert.ok(Number.isFinite(h.y), 'each hull exposes its ground y for the captain probe');
    assert.ok(Math.abs(h.y) < 1e-6, `hull ground y ${h.y} is flat 0, not the raised sidewalk 0.224`);
  }
  for (const c of d.colliders) assert.ok(Math.abs(c.minY) < 1e-6, `collider base ${c.minY} is 0, not hovering`);
});

test('groundAt uses CITY.islandVergeSurfaceAt(x,z).h when present, else the flat marina 0', async () => {
  // Provide a verge sampler that returns a known height; hulls must snap to it (the real rendered surface).
  const C = city();
  C.islandVergeSurfaceAt = (x, z) => ({ h: 0.37, kind: 'ramp' });
  // Rebuild with a fresh context so the cached build does not reuse the first result.
  const C2 = (() => {
    const Addons = { mergeGeometries, GLTFLoader: LocalLoader };
    const CITY = { THREE, Addons, GEO: detail.GEO, CITY_BOUNDS: { sidewalkHeight: 0.22 }, islandVergeSurfaceAt: () => ({ h: 0.37 }) };
    const ctx = { window: { CITY }, console: { info() {}, log() {}, warn() {}, error() {} }, performance, setTimeout, Promise };
    vm.createContext(ctx);
    vm.runInContext(read(DATA_MODULE), ctx, { filename: DATA_MODULE });
    vm.runInContext(read(RUNTIME), ctx, { filename: RUNTIME });
    return ctx.window.CITY;
  })();
  const d = await C2.buildWaterfrontDinghies(THREE, null);
  assert.equal(d.ready, true);
  for (const h of d.hulls) assert.ok(Math.abs(h.y - 0.37) < 1e-6, `hull y ${h.y} follows the verge sampler 0.37`);
});

test('zero valid placements in the active frame is ready:false, no asset load, empty group/no colliders', async () => {
  // A frame whose detail bounds exclude every hull (all placements filtered out) must NOT load the GLB or report ready.
  const shifted = { ...detail.GEO, frame: { ...detail.GEO.frame, detail: { x0: 99990, x1: 100000, z0: 99990, z1: 100000 } } };
  const C = city({ geo: shifted });
  let loads = 0;
  const CountingLoader = class { loadAsync(u) { loads++; return new LocalLoader().loadAsync(u); } };
  const C2 = (() => {
    const Addons = { mergeGeometries, GLTFLoader: CountingLoader };
    const CITY = { THREE, Addons, GEO: shifted, CITY_BOUNDS: { sidewalkHeight: 0.22 } };
    const ctx = { window: { CITY }, console: { info() {}, log() {}, warn() {}, error() {} }, performance, setTimeout, Promise };
    vm.createContext(ctx);
    vm.runInContext(read(DATA_MODULE), ctx, { filename: DATA_MODULE });
    vm.runInContext(read(RUNTIME), ctx, { filename: RUNTIME });
    return ctx.window.CITY;
  })();
  const d = await C2.buildWaterfrontDinghies(THREE, null);
  assert.equal(d.ready, false);
  assert.equal(loads, 0, 'the GLB is not loaded when there are no valid placements');
  assert.equal(d.group.children.length, 0);
  assert.equal(d.colliders.length, 0);
  assert.match(String(d.layout.reason), /no valid placements|projection|frame/i);
});

test('buildWaterfrontDinghies is idempotent: repeated calls share one build (one GLB load)', async () => {
  let loads = 0;
  const CountingLoader = class { loadAsync(u) { loads++; return new LocalLoader().loadAsync(u); } };
  const Addons = { mergeGeometries, GLTFLoader: CountingLoader };
  const CITY = { THREE, Addons, GEO: detail.GEO, CITY_BOUNDS: { sidewalkHeight: 0.22 } };
  const ctx = { window: { CITY }, console: { info() {}, log() {}, warn() {}, error() {} }, performance, setTimeout, Promise };
  vm.createContext(ctx);
  vm.runInContext(read(DATA_MODULE), ctx, { filename: DATA_MODULE });
  vm.runInContext(read(RUNTIME), ctx, { filename: RUNTIME });
  const C = ctx.window.CITY;
  const a = await C.buildWaterfrontDinghies(THREE, null);
  const b = await C.buildWaterfrontDinghies(THREE, null);
  assert.equal(a, b, 'the same result object');
  assert.equal(loads, 1, 'the GLB loaded exactly once');
});

test('a missing asset resolves ready:false with an empty group, no colliders and no invented fallback', async () => {
  const C = city({ loader: null }); // no GLTFLoader -> the model cannot load
  const scene = new THREE.Scene();
  const d = await C.buildWaterfrontDinghies(THREE, scene);
  assert.equal(d.ready, false);
  assert.equal(d.colliders.length, 0, 'no colliders without the asset');
  assert.equal(d.group.children.length, 0, 'the group is empty (no invented fallback)');
  assert.match(String(d.layout.reason), /did not load|no loader|unavailable/i);
});

test('a mismatched frame projection is a ready:false no-op', async () => {
  const bad = { ...detail.GEO, frame: { ...detail.GEO.frame, projection: { ...detail.GEO.frame.projection, kx: detail.GEO.frame.projection.kx * 1.5 } } };
  const C = city({ geo: bad });
  const d = await C.buildWaterfrontDinghies(THREE, null);
  assert.equal(d.ready, false);
  assert.equal(d.colliders.length, 0);
  assert.equal(d.group.children.length, 0);
  assert.match(String(d.layout.reason), /projection|frame|rows/i);
});


// --- st-sb3r.38 tree keep-out helper ----------------------------------------------------------------

test('waterfrontDinghyKeepout: exact oriented footprint with rotated corners (world yaw), +0.25 m margin', () => {
  const C = city({ withRuntime: true });
  const h = C.WATERFRONT_DINGHIES_DATA.rows[0];
  const cx = h[0] / 10, cz = h[1] / 10, yaw = h[2] / 1000, len = h[3] / 100, wid = h[4] / 100;
  // centre is inside (dist 0)
  assert.equal(C.waterfrontDinghyKeepout(cx, cz).inside, true);
  // a point just OUTSIDE the long end but within the 0.25 m margin is a keep-out
  const ux = Math.sin(yaw), uz = Math.cos(yaw); // world long axis
  const beyond = C.waterfrontDinghyKeepout(cx + ux * (len / 2 + 0.15), cz + uz * (len / 2 + 0.15));
  assert.equal(beyond.inside, true, 'within margin past the end');
  // well beyond (margin exceeded) is free
  const far = C.waterfrontDinghyKeepout(cx + ux * (len / 2 + 1.0), cz + uz * (len / 2 + 1.0));
  assert.equal(far.inside, false, 'beyond the margin');
  // the four rotated corners are inside the footprint, and a diagonal just outside the corner (by > margin) is free
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const wx = cs, wz = -sn; // across
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const px = cx + su * ux * (len / 2 - 0.01) + sv * wx * (wid / 2 - 0.01);
    const pz = cz + su * uz * (len / 2 - 0.01) + sv * wz * (wid / 2 - 0.01);
    assert.equal(C.waterfrontDinghyKeepout(px, pz).inside, true, `corner ${su},${sv} inside`);
  }
  // a point that is close in axis-aligned terms but outside the ROTATED footprint must NOT be claimed (proves orientation)
  const diagonal = C.waterfrontDinghyKeepout(cx + wx * (wid / 2 + 0.4), cz + wz * (wid / 2 + 0.4));
  assert.equal(diagonal.inside, false, 'rotated footprint, not an axis-aligned box');
});

test('waterfrontDinghyKeepout is frame-safe: a mismatched projection claims no keep-out', () => {
  const bad = { ...detail.GEO, frame: { ...detail.GEO.frame, projection: { ...detail.GEO.frame.projection, kx: detail.GEO.frame.projection.kx * 1.5 } } };
  const Addons = { mergeGeometries, GLTFLoader: LocalLoader };
  const CITY = { THREE, Addons, GEO: bad, CITY_BOUNDS: { sidewalkHeight: 0.22 } };
  const ctx = { window: { CITY }, console: { info() {}, log() {}, warn() {}, error() {} }, performance, setTimeout, Promise };
  vm.createContext(ctx);
  vm.runInContext(read(DATA_MODULE), ctx, { filename: DATA_MODULE });
  vm.runInContext(read(RUNTIME), ctx, { filename: RUNTIME });
  const C = ctx.window.CITY;
  const h = C.WATERFRONT_DINGHIES_DATA.rows[0];
  assert.equal(C.waterfrontDinghyKeepout(h[0] / 10, h[1] / 10).inside, false, 'wrong frame -> no keep-out');
});

test('the accepted dinghy gate defaults on and supports explicit opt-out', () => {
  const off = city({ withRuntime: true });
  assert.equal(off.waterfrontDinghiesEnabled(), true, 'default enabled');
  for (const q of ['?dinghies=1', '?foo=2&dinghies=1', '?dinghies=1&bar=3', '?xdinghies=1']) {
    const CITY = { THREE, Addons: { mergeGeometries, GLTFLoader: LocalLoader }, GEO: detail.GEO, CITY_BOUNDS: { sidewalkHeight: 0.22 } };
    const ctx = { window: { CITY, location: { search: q } }, console: { info() {}, log() {}, warn() {}, error() {} }, performance, setTimeout, Promise };
    vm.createContext(ctx);
    vm.runInContext(read(DATA_MODULE), ctx, { filename: DATA_MODULE });
    vm.runInContext(read(RUNTIME), ctx, { filename: RUNTIME });
    assert.equal(ctx.window.CITY.waterfrontDinghiesEnabled(), true, `enabled for ${q}`);
  }
  for (const q of ['?dinghies=0', '?dinghies=1x']) {
    const CITY = { THREE, Addons: { mergeGeometries, GLTFLoader: LocalLoader }, GEO: detail.GEO, CITY_BOUNDS: { sidewalkHeight: 0.22 } };
    const ctx = { window: { CITY, location: { search: q } }, console: { info() {}, log() {}, warn() {}, error() {} }, performance, setTimeout, Promise };
    vm.createContext(ctx);
    vm.runInContext(read(DATA_MODULE), ctx, { filename: DATA_MODULE });
    vm.runInContext(read(RUNTIME), ctx, { filename: RUNTIME });
    assert.equal(ctx.window.CITY.waterfrontDinghiesEnabled(), false, `disabled for ${q}`);
  }
});

test('the mapped/generic classifier: generic scatter is removable, mapped/source trees are preserved', () => {
  const C = city({ withRuntime: true });
  const isMapped = C.waterfrontDinghyIsMappedTree;
  // street-details.js generic scatter: only x,y,z,scale,species,tier
  assert.equal(isMapped({ x: 1, y: 0.2, z: 1, scale: 0.7, species: 1, tier: 0 }), false, 'generic scatter');
  // mapped / source trees carry a model/height/oid/sourceId/htoPlan/residentialCanopy/woods
  assert.equal(isMapped({ x: 0, z: 0, model: 3, height: 12 }), true, 'park-woods / street model');
  assert.equal(isMapped({ x: 0, z: 0, oid: 1108596, height: 24 }), true, 'mapped residential/marina canopy (oid)');
  assert.equal(isMapped({ x: 0, z: 0, residentialCanopy: true }), true);
  assert.equal(isMapped({ x: 0, z: 0, htoPlan: true, sourceId: 5 }), true);
  assert.equal(isMapped({ x: 0, z: 0, woods: true }), true, 'wooded park lidar tree');
  assert.equal(isMapped(null), false);
});

test('ez-trees drops ONLY generic scatter inside a hull (gated), preserves mapped with a conflict report', () => {
  const src = read('js/ez-trees.js');
  // the surgical loop is gated on the flag and uses the shared classifier + keep-out helper
  assert.match(src, /waterfrontDinghiesEnabled\?\.\(\) === true/);
  assert.match(src, /waterfrontDinghyKeepout\?\.\(t\.x, t\.z, 0\.25\)/);
  assert.match(src, /waterfrontDinghyIsMappedTree/);
  // mapped over a hull is counted as a conflict, not spliced; generic is dropped with `continue`
  assert.match(src, /dinghyMappedConflicts\+\+/);
  assert.match(src, /dinghyScatterDropped\+\+; continue;/);
  // the trial-disabled path removes nothing (the whole block is inside `if (dinghyKeepoutOn)`)
  assert.match(src, /if \(dinghyKeepoutOn\) \{/);
  // it must NOT reuse the deck/garden splice that removes ANY site
  assert.ok(!/waterfrontDinghyKeepout[\s\S]{0,200}sites\.splice/.test(src), 'the hull keep-out never splices mapped sites');
});
