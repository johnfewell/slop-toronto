// Exact cottage-footprint overlap geometry (tools/build-island-cottage-footprint-pilot.mjs, bead st-sb3r.32).
//
// The pilot's source-correct effective rectangle must not intersect any other committed building. The first probe sampled
// a 0.25 m point grid inside each other part, which can step over a thin crossing and report "0 conflicts" falsely. The
// tool now uses an exact separating-axis test on the transformed rectangle pairs (obbOverlap / partsOverlapParts). These
// tests pin that geometry down on the cases a grid sample misses — a thin crossing, containment — plus disjoint rotated
// rectangles and boundary-only touching, then verify on the COMMITTED geodata + committed footprint sidecar that the
// effective rectangle meets no other row's drawn parts. The captain's builder dry-run stays manual evidence, not a test
// dependency (these tests read only checked-in files, so they run on a clean checkout without the private /tmp cache).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import zlib from 'node:zlib';

import { rowPartObb, obbOverlap, partsOverlapParts } from '../tools/build-island-cottage-footprint-pilot.mjs';

const readBin = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url));
const readText = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// Decode the committed geodata exactly as the runtime does (js/geodata-loader.js).
async function committedGeo() {
  let u8 = new Uint8Array(readBin('data/toronto-geodata.bin'));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  const { decodeGeo } = await import('../js/geodata-loader.js');
  return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)).GEO;
}

// The committed pilot sidecar (js/waterfront-island-cottage-footprint-data.js): the one effective rectangle.
function committedSidecarRecord() {
  const m = readText('js/waterfront-island-cottage-footprint-data.js').match(/ISLAND_COTTAGE_FOOTPRINT_DATA = (\{[\s\S]*\});\s*\}\)\(\);\s*$/);
  assert.ok(m, 'the committed footprint sidecar parses');
  const data = JSON.parse(m[1]);
  assert.equal(data.records.length, 1, 'exactly one pilot record');
  return data.records[0];
}

// The committed row's identity signature, the same one the builder binds and guards on.
const footprintSignature = (r) => JSON.stringify([Math.round(r[2] * 1000) / 1000, r[3].map((p) => p.map((v) => Math.round(v * 10) / 10))]);

const EPS = 1e-9;

// An oriented box from a row-local part [a0,a1,b0,b1] at a world centre + yaw — the same placement the tool and
// js/buildings.js use (X = cx + lu·cos + lv·sin, Z = cz − lu·sin + lv·cos).
const part = (cx, cz, yaw, a0, a1, b0, b1) => rowPartObb(cx, cz, yaw, a0, a1, b0, b1);

test('rowPartObb places a part centre and axes in world exactly as js/buildings.js', () => {
  const yaw = 0.6, cx = 12, cz = -4;
  const box = part(cx, cz, yaw, 1, 5, -2, 2); // local centre (3, 0), half 2 x 2
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  assert.ok(Math.abs(box.x - (cx + 3 * cs)) < EPS, 'centre x');
  assert.ok(Math.abs(box.z - (cz - 3 * sn)) < EPS, 'centre z');
  assert.ok(Math.abs(box.ux - cs) < EPS && Math.abs(box.uz + sn) < EPS, 'u axis');
  assert.ok(Math.abs(box.vx - sn) < EPS && Math.abs(box.vz - cs) < EPS, 'v axis');
  assert.equal(box.hu, 2);
  assert.equal(box.hv, 2);
});

// The old probe: sample a rectangle's interior on a 0.25 m grid and test strict containment in `host`.
function gridSamplesInside(host, probe) {
  const nu = Math.max(2, Math.ceil((probe.hu * 2) / 0.25)), nv = Math.max(2, Math.ceil((probe.hv * 2) / 0.25));
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const lu = -probe.hu + (probe.hu * 2) * i / nu, lv = -probe.hv + (probe.hv * 2) * j / nv;
    const X = probe.x + lu * probe.ux + lv * probe.vx, Z = probe.z + lu * probe.uz + lv * probe.vz;
    const du = X - host.x, dz = Z - host.z;
    if (Math.abs(du * host.ux + dz * host.uz) < host.hu && Math.abs(du * host.vx + dz * host.vz) < host.hv) return true;
  }
  return false;
}

test('a thin crossing that the 0.25 m grid sample misses is caught exactly', () => {
  // Two thin perpendicular slivers crossing in a small lens. The old probe samples only the thin part's own three rows
  // (spacing floor ~0.06 m), and the crossing falls between them, so the grid reports "no hit" while the parts really do
  // overlap. The exact SAT test catches it.
  const h = part(0, 0.15, 0, -5, 5, -0.03, 0.03);        // horizontal sliver, off the vertical one's sampled rows
  const v = part(0, 0, Math.PI / 2, -5, 5, -0.03, 0.03);  // vertical sliver
  assert.equal(gridSamplesInside(h, v), false, 'the 0.25 m grid steps over the thin perpendicular crossing (the bug)');
  assert.equal(obbOverlap(h, v), true, 'the exact SAT test catches the thin crossing');
  // A wider perpendicular pair that a coarse grid DOES sample still agrees — no false negatives from SAT.
  const h2 = part(0, 0.02, 0, -5, 5, -0.3, 0.3);
  const v2 = part(0, 0, Math.PI / 2, -5, 5, -0.3, 0.3);
  assert.equal(gridSamplesInside(h2, v2), true, 'a fat crossing is sampled by the grid');
  assert.equal(obbOverlap(h2, v2), true, 'SAT agrees');
});

test('exact overlap handles containment, disjoint rotated parts, and ignores boundary-only contact', () => {
  const outer = part(0, 0, 0.2, -5, 5, -5, 5);
  const inner = part(1, 1, 0.9, -0.8, 0.8, -0.8, 0.8); // fully inside, different yaw
  assert.equal(obbOverlap(outer, inner), true, 'a contained part overlaps');

  const a = part(0, 0, 0, -2, 2, -2, 2);
  const b = part(9, 0, 0.7, -2, 2, -2, 2); // rotated, far apart
  assert.equal(obbOverlap(a, b), false, 'disjoint rotated parts do not overlap');

  const left = part(0, 0, 0, -2, 2, -2, 2);
  const right = part(4, 0, 0, -2, 2, -2, 2); // shares the x = 2 edge only
  assert.equal(obbOverlap(left, right), false, 'edge-touching parts are not a real overlap');

  const corner = part(4, 4, 0, -2, 2, -2, 2); // touches the corner (2,2) only
  assert.equal(obbOverlap(left, corner), false, 'corner-touching parts are not a real overlap');
});

test('partsOverlapParts respects the >= 1 m drawn-part filter and multi-part rows', () => {
  const rowOn = [[-3, 3, -3, 3]];                 // a single valid part
  const rowOff = [[10, 10.5, 10, 10.5]];          // a sub-metre part the renderer never draws
  const pilot = [[-6, 6, -4, 4]];
  assert.equal(partsOverlapParts(pilot, 0, 0, 0, rowOn, 0, 0, 0), true, 'overlapping 12 x 8 vs 6 x 6');
  assert.equal(partsOverlapParts(pilot, 0, 0, 0, rowOn, 0, 20, 0), false, 'same row 20 m away is clear');
  // The tiny part overlaps the pilot in world space, but it is under 1 m so it is never drawn and never a conflict.
  assert.equal(partsOverlapParts(pilot, 0, 0, 0, rowOff, 0, 0.25, 0.25), false, 'sub-metre parts are ignored like the renderer');
  // A multi-part row conflicts if ANY valid part does.
  const multi = [[-6, -4, -4, 4], [20, 22, -4, 4], [0, 1, 0, 1]];
  assert.equal(partsOverlapParts(pilot, 0, 0, 0, multi, 0, 0, 0), true, 'the central [0,1]x[0,1] part overlaps');
});

test('the exact overlap test is symmetric and rotation-invariant', () => {
  const a = part(0, 0, 0.3, -3, 4, -2, 2.5);
  const b = part(1.2, -0.7, -0.8, -1.5, 2.5, -2, 1);
  assert.equal(obbOverlap(a, b), obbOverlap(b, a), 'symmetric');
  for (const yaw of [0, 0.4, -1.1, 2.7]) {
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    const rot = (p) => ({ ...p, x: p.x * ca - p.z * sa, z: p.x * sa + p.z * ca, ux: p.ux * ca - p.uz * sa, uz: p.ux * sa + p.uz * ca, vx: p.vx * ca - p.vz * sa, vz: p.vx * sa + p.vz * ca });
    assert.equal(obbOverlap(rot(a), rot(b)), obbOverlap(a, b), `invariant under a ${yaw} rad world rotation`);
  }
});

// Committed-data proof (no private /tmp cache): decode the committed geodata, read the committed pilot sidecar, bind the
// sidecar to its row by the identity signature, then run the exact SAT test of the effective rectangle against EVERY
// other committed row's drawn parts. This is what the builder dry-run proves, but from checked-in inputs only — so it
// runs on a clean checkout. The captain's builder dry-run stays manual evidence, not a test dependency.
test('the committed effective rectangle overlaps no other committed row\'s drawn parts (exact SAT)', async () => {
  const GEO = await committedGeo();
  const rec = committedSidecarRecord();
  assert.equal(rec.typology, 'cottage', 'the sidecar record is the cottage pilot');
  const key = `${(+rec.cx).toFixed(1)},${(+rec.cz).toFixed(1)}`;
  const rowIndex = GEO.buildings.findIndex((r) => `${r[0].toFixed(1)},${r[1].toFixed(1)}` === key);
  assert.ok(rowIndex >= 0, `the committed row exists at ${key}`);
  const row = GEO.buildings[rowIndex];
  assert.equal(footprintSignature(row), rec.nativeFp, 'the committed row still carries the sidecar\'s native footprint signature');
  assert.ok(Array.isArray(rec.parts) && rec.parts.length, 'the sidecar carries the effective parts');

  // Independent exact sweep of the effective rectangle against every other committed row's drawn parts.
  const [ecx, ecz, eyaw] = [rec.cx, rec.cz, rec.yaw];
  const conflicts = [];
  for (let i = 0; i < GEO.buildings.length; i++) {
    if (i === rowIndex) continue;
    const r = GEO.buildings[i];
    if (!Array.isArray(r[3]) || !r[3].length) continue;
    if (partsOverlapParts(rec.parts, eyaw, ecx, ecz, r[3], r[2], r[0], r[1])) {
      conflicts.push({ row: i, cx: r[0], cz: r[1] });
    }
  }
  assert.deepEqual(conflicts, [], `the effective rectangle intersects ${conflicts.length} other committed building(s)`);
});
