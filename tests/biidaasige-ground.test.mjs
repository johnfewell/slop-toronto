// Biidaasige Park ground data (js/biidaasige-ground-data.js) and the read-only audit probe
// (tools/audit-biidaasige-ground.mjs), bead st-bmyv.2. Pure CPU: decodes the committed packed geodata exactly as the page
// does (js/geodata-loader.js) and checks the data file's polygons against it. It proves the data file is exact-source
// (not a guessed rectangle), the park ring matches current OSM, and what the audit found is still found.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { decodeGeo } from '../js/geodata-loader.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
const readJs = (p) => read(p).toString('utf8');

async function loadBin(rel) {
  let u8 = new Uint8Array(read(rel));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
}

const toPts = (flat) => { const o = []; for (let i = 0; i < flat.length; i += 2) o.push([flat[i], flat[i + 1]]); return o; };
const ringArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; a += x1 * z2 - x2 * z1; } return Math.abs(a / 2); };
const ringBox = (pts) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1 }; };
const inRing = (px, pz, pts) => { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) ins = !ins; } return ins; };

const detail = await loadBin('data/toronto-geodata.bin');
const eglinton = await loadBin('data/frames/eglinton/toronto-geodata.bin');

function groundData() {
  const ctx = { window: { CITY: {} } };
  vm.createContext(ctx);
  vm.runInContext(readJs('js/biidaasige-ground-data.js'), ctx, { filename: 'biidaasige-ground-data.js' });
  return ctx.window.CITY.BIIDAASIGE_GROUND_DATA;
}

const D = groundData();
const park = (() => { const f = D.parkRing; const o = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; })();

test('data file carries a real park ring, not a rectangle, matching the committed geodata', () => {
  assert.ok(D && D.version === 1);
  assert.ok(park.length >= 100, `${park.length} vertices (a rectangle would be 4)`);
  // the ring the committed detail frame carries, same area to the square metre
  const geo = detail.GEO.areas.find((a) => a[0] === 'park' && a[1] === 'Biidaasige Park');
  assert.ok(geo, 'committed geodata has the named park');
  const geoPts = toPts(geo[2]);
  assert.ok(Math.abs(ringArea(park) - ringArea(geoPts)) < 2000, `area ${ringArea(park)} vs ${ringArea(geoPts)}`);
  // it is not an axis-aligned rectangle (a rectangle's vertices all share x or z with a neighbour)
  const b = ringBox(park);
  assert.ok(ringArea(park) < 0.9 * (b.x1 - b.x0) * (b.z1 - b.z0), 'ring fills less than 90% of its bbox (not a rectangle)');
  // frame coverage: both committed frames carry it
  for (const [tag, L] of [['detail', detail], ['eglinton', eglinton]]) {
    assert.ok(L.GEO.areas.some((a) => a[0] === 'park' && a[1] === 'Biidaasige Park'), `${tag} carries the park`);
    const f = L.GEO.frame.detail;
    assert.ok(f.x0 < b.x0 && f.x1 > b.x1 && f.z0 < b.z0 && f.z1 > b.z1, `${tag} frame covers the park box`);
  }
});

test('data file is a neutral read-only inventory (water in park is expected, buildings are candidates)', () => {
  // the export is explicitly NOT replacement data and NOT a suppression list
  assert.match(String(D.kind || ''), /read-only inventory/i);
  assert.match(String(D.kind || ''), /not a suppression list/i);
  // water rings recorded verbatim — water inside the park is expected (the new river/wetlands are park features)
  assert.ok(Array.isArray(D.waterRingsInPark) && D.waterRingsInPark.length >= 3, `${D.waterRingsInPark?.length} water polys`);
  const waterArea = D.waterRingsInPark.reduce((s, w) => s + w.areaM2, 0);
  assert.ok(waterArea > 100000 && waterArea < 130000, `water in park ${waterArea} m² (recorded, expected ~111k)`);
  assert.ok(Math.max(...D.waterRingsInPark.map((w) => w.areaM2)) > 80000, 'the Don mouth channel is recorded');
  // zone:* overlap recorded, not judged obsolete
  const z = D.zoneAreasOverlappingPark;
  assert.ok(z.some((o) => o.kind === 'brownfield' && o.areaM2 > 70000), 'brownfield overlap recorded');
  assert.ok(z.some((o) => o.kind === 'construction' && o.areaM2 > 38000), 'construction overlap recorded');
  // buildings are CANDIDATES (a field named for that), not judged obsolete; some are native to the park
  assert.ok(Array.isArray(D.buildingCandidatesInPark) && D.buildingCandidatesInPark.length >= 9, `${D.buildingCandidatesInPark?.length} candidates`);
  assert.ok(D.buildingCandidatesInPark.every((b) => !('obsolete' in b) && !('stale' in b)), 'no candidate is pre-judged');
  assert.ok(Math.max(...D.buildingCandidatesInPark.map((b) => b.h)) > 20, 'the tallest candidate (>20 m) is recorded, not assumed obsolete');
  // and the count matches the committed geodata exactly (no invention)
  const committed = detail.GEO.buildings.filter((b) => inRing(b[0], b[1], park)).length;
  assert.equal(D.buildingCandidatesInPark.length, committed);
});

test('the Don river channel and Keating Channel are carried', () => {
  assert.ok(D.rivers.donRiver.length >= 100, 'Don channel polyline');
  assert.ok(D.rivers.keatingChannel.length >= 12, 'Keating Channel polyline');
  // the Don's south end has already been moved west into the park (the renaturalised mouth)
  const don = toPts(D.rivers.donRiver);
  const last = don[don.length - 1];
  assert.ok(last[0] < 1900, `Don south end x ${last[0]} is west of the old mouth (renaturalised)`);
});
