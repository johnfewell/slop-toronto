// jf-abm: the Rosedale-Moore Park pilot's houses (js/rosedale-houses.js, tools/build-rosedale-houses.mjs, data/frames/eglinton/rosedale-houses.bin)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import { ROSEDALE_HOUSES_URL, decodeHouses, mergeRosedaleHouses, lidarRoofPlan, pushLidarRoof, lookOf, LOOKS, ERA_NAMES, STYLE_NAMES } from '../js/rosedale-houses.js';

const file = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
const load = async () => {
  const { GEO } = await unpackGeo(file('data/frames/eglinton/toronto-geodata.bin'));
  const { ROSEDALE_HOUSES: H } = await unpackGeo(file('data/frames/eglinton/rosedale-houses.bin'));
  const { MASSING } = await unpackGeo(file('data/toronto-massing.bin'));
  return { GEO, H, MASSING };
};

test('the page asks for the file by its hash, and the file is for this geodata', async () => {
  const hash = createHash('sha256').update(file('data/frames/eglinton/rosedale-houses.bin')).digest('hex').slice(0, 12);
  assert.ok(ROSEDALE_HOUSES_URL.endsWith(`rosedale-houses.bin?v=${hash}`), ROSEDALE_HOUSES_URL);
  const { GEO, H } = await load();
  assert.equal(H.geodata, createHash('sha256').update(file('data/frames/eglinton/toronto-geodata.bin')).digest('hex').slice(0, 16));
  assert.equal(decodeHouses(H, GEO.buildings).error, undefined);
  const other = (await unpackGeo(file('data/toronto-geodata.bin'))).GEO;
  assert.ok(decodeHouses(H, other.buildings).error, 'the detail map refuses it');
});

test('the houses merge into the massing rows without touching a drawn row', async () => {
  const { GEO, H, MASSING } = await load();
  const massing = massingRows(MASSING, GEO);
  const drawnBefore = new Map(massing.rows);
  const out = mergeRosedaleHouses(massing, GEO.buildings, H);
  assert.equal(out.error, null);
  assert.ok(out.merged > 3000 && out.merged <= out.houses, `${out.merged} of ${out.houses}`);
  assert.equal(out.lidar + out.planner + out.flat, out.merged);
  for (const [row, rec] of drawnBefore) assert.equal(massing.rows.get(row), rec, `drawn row ${row} replaced`);
  for (const r of out.skip) assert.ok(!massing.rows.has(r) && !drawnBefore.has(r), `skipped row ${r} is drawn`);
  for (const rec of [...massing.rows.values()].filter((x) => x.rosedale).slice(0, 400)) {
    assert.equal(rec.rings.length, 1);
    assert.ok(rec.rings[0].length >= 3 && rec.rings[0].every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])));
    for (const e of rec.covered.keys()) assert.ok(e < rec.rings[0].length);
    assert.ok(rec.maxH > 1 && rec.avgH > 0 && rec.avgH <= rec.maxH + 0.5);
    assert.match(rec.id, /^to-3dmassing-2025:\d+(\.\d+)?$/);
  }
  // a second merge adds nothing (the rows are drawn now)
  assert.equal(mergeRosedaleHouses(massing, GEO.buildings, H).merged, 0);
});

test('the lidar roofs are slim, whole and face the right way', async () => {
  const { GEO, H, MASSING } = await load();
  const d = decodeHouses(H, GEO.buildings);
  const lidar = d.houses.filter((h) => h.fit === 1);
  assert.ok(lidar.length > 2000);
  let tris = 0;
  for (const h of lidar) {
    const plan = lidarRoofPlan(h);
    assert.ok(plan.ok && plan.lidar && plan.eave >= 2.5 && plan.eave <= h.maxH + 0.01, `eave ${plan.eave} top ${h.maxH}`);
    const A = { pos: [], nor: [], uv: [], col: [] };
    const n = pushLidarRoof(A, plan, 0, [0.3, 0.3, 0.3], [0.6, 0.4, 0.3]);
    assert.equal(A.pos.length, n * 9); assert.equal(A.nor.length, n * 9); assert.equal(A.uv.length, n * 6); assert.equal(A.col.length, n * 9);
    assert.ok(A.pos.every(Number.isFinite) && A.uv.every(Number.isFinite));
    assert.ok(A.pos.filter((_, i) => i % 3 === 1).every((y) => y >= -0.5 && y < 150), 'heights sane');
    tris += n;
    // the far version is lighter
    const F = { pos: [], nor: [], uv: [], col: [] };
    assert.ok(pushLidarRoof(F, plan, 0, [0.3, 0.3, 0.3], [0.6, 0.4, 0.3], true) <= n);
  }
  const per = tris / lidar.length;
  assert.ok(per < 70, `${per.toFixed(1)} triangles a lidar house (target: close to the planner's 57)`);
  // up-facing roof facets: every roof triangle's normal points up
  const h = lidar[0], A = { pos: [], nor: [], uv: [], col: [] };
  pushLidarRoof(A, lidarRoofPlan(h), 0, [1, 0, 0], [0, 1, 0]);
  for (let i = 0; i < A.col.length; i += 9) if (A.col[i] === 1) assert.ok(A.nor[i + 1] > 0, 'a roof triangle faces down');
});

test('every house has an era and a style with a look; the heritage lists are not in the file', async () => {
  const { H } = await load();
  assert.ok(H.era.every((e) => e >= 0 && e < ERA_NAMES.length));
  assert.ok(H.style.every((s) => STYLE_NAMES[s] !== undefined && LOOKS[s]));
  assert.ok(new Set(H.style).size >= 5, 'styles vary');
  const keys = Object.keys(H);
  for (const bad of ['rating', 'year', 'architect', 'address', 'addresses', 'hcd']) assert.ok(!keys.includes(bad), `column ${bad}`);
  const a = lookOf(1, 0.9, 0.2, 0.2), b = lookOf(1, 0.9, 0.2, 0.2);
  assert.deepEqual(a, b);
  assert.equal(lookOf(2, 0.1, 0.5, 0.5).render, true);
});
