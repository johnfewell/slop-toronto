// jf-bya (docs/rosedale-walls.md): the Rosedale pilot's houses drawn as houses: no curtain walls or shop fronts, a preset per style, the lidar's roof form,
// chimneys, porches and a front yard
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import { mergeRosedaleHouses, roofHint, presetOfHouse, isHouse, decodeHouses, STYLE_NAMES } from '../js/rosedale-houses.js';
import { PROTOTYPES, DRAW, ROSEDALE_DRAW, FACADE_VARIANTS, FIRST_DRAW_VARIANT, drawOf, isHousePreset } from '../js/building-prototypes.js';
import * as Draw from '../js/building-draw.js';

const file = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
const lin = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const load = async () => {
  const { GEO } = await unpackGeo(file('data/frames/eglinton/toronto-geodata.bin'));
  const { ROSEDALE_HOUSES: H } = await unpackGeo(file('data/frames/eglinton/rosedale-houses.bin'));
  const { MASSING } = await unpackGeo(file('data/toronto-massing.bin'));
  const massing = massingRows(MASSING, GEO);
  const out = mergeRosedaleHouses(massing, GEO.buildings, H);
  return { GEO, H, massing, out, recs: [...massing.rows.values()].filter((r) => r.rosedale) };
};

test('house presets: the downtown house presets and the Rosedale ones are houses, nothing else is', () => {
  for (const p of PROTOTYPES) assert.equal(isHousePreset(p.id), p.family === 'house', p.id);
  for (const id of Object.keys(ROSEDALE_DRAW)) { assert.ok(isHousePreset(id), id); assert.equal(drawOf(id), ROSEDALE_DRAW[id]); assert.ok(!DRAW[id], `${id} is not a catalogue entry`); }
  assert.equal(isHousePreset('main-street-shop-early'), false);
  assert.equal(isHousePreset(undefined), false);
  for (const D of Object.values(ROSEDALE_DRAW)) for (const v of D.variants) assert.ok(FACADE_VARIANTS[v] && FIRST_DRAW_VARIANT + v < 16, 'a facade style the material holds');
});

test('the pilot has houses and the City kind column does not make glass of them', async () => {
  const { GEO, H, out, recs } = await load();
  assert.equal(out.error, null);
  const houses = recs.filter((r) => r.rosedale.house);
  assert.ok(houses.length > 3000, `${houses.length} houses`);
  assert.equal(out.houseRows, houses.length);
  // most of the City's mid-rise and tall kinds in the pilot are houses
  const wrongKind = houses.filter((r) => { const k = GEO.buildings[r.rosedale.rows[0]][5]; return k === 2 || k === 3; });
  assert.ok(wrongKind.length > 1300, `${wrongKind.length} houses the City calls mid-rise or tall`);
  for (const r of houses) {
    assert.ok(r.rosedale.maxH <= 16 && isHouse(r.rosedale, GEO.buildings[r.rosedale.rows[0]][5]));
    assert.ok(r.preset && drawOf(r.preset), `${r.id}: ${r.preset}`);
    assert.equal(r.drawFacts.dwellings, r.covered.size ? 2 : 1);
  }
  // apartments and the like keep the page's look
  assert.ok(recs.some((r) => !r.rosedale.house && !r.preset));
  void H;
});

test('a house takes the preset of its style, the same on every load', async () => {
  const { GEO, H } = await load();
  const d = decodeHouses(H, GEO.buildings).houses;
  const by = {};
  for (const h of d) { const id = presetOfHouse(h); assert.equal(presetOfHouse(h), id); (by[STYLE_NAMES[h.style]] ||= {})[id] = (by[STYLE_NAMES[h.style]][id] || 0) + 1; assert.ok(drawOf(id), id); }
  assert.ok(by.Georgian['rosedale-georgian'] > 0 && !by.Georgian['rosedale-tudor']);
  assert.ok(by.revival['rosedale-tudor'] > by.revival['rosedale-georgian']);
  assert.ok(by.Victorian['rosedale-queen-anne'] > 0 && by.Victorian['victorian-detached'] > 0);
  assert.ok(by.Edwardian['rosedale-annex'] > 0 && by.Edwardian['rosedale-arts-crafts'] > 0 && by.Edwardian['edwardian-detached'] > by.Edwardian['rosedale-annex']);
  for (const h of d.filter((x) => x.covered.size)) assert.match(presetOfHouse(h), /-semi$/);
});

test('the lidar chimneys decode: where they stand, how high, on a roof that is there', async () => {
  const { GEO, H } = await load();
  const d = decodeHouses(H, GEO.buildings).houses;
  const stacks = d.flatMap((h) => h.chim.map((c) => ({ h, c })));
  assert.ok(d.filter((h) => h.chim.length).length > 1000 && stacks.length > 1500, `${stacks.length} chimneys`);
  for (const { h, c } of stacks) {
    assert.ok(c.base >= 1.9 && c.top - c.base >= 0.75 && c.top - c.base <= 4 && c.w >= 0.3 && c.w <= 1.9, JSON.stringify(c));
    // inside or beside the house's own outline
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of h.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    assert.ok(c.x > x0 - 1 && c.x < x1 + 1 && c.z > z0 - 1 && c.z < z1 + 1, `${h.fid}: chimney at ${c.x}, ${c.z} outside ${x0}..${x1}, ${z0}..${z1}`);
  }
});

test('the lidar roof hint: a gable is two opposite slopes, a hip four, a flat roof none', async () => {
  const { GEO, H } = await load();
  const d = decodeHouses(H, GEO.buildings).houses;
  const forms = {};
  for (const h of d.filter((x) => x.fit === 1 && x.maxH <= 16)) {
    const t = roofHint(h);
    assert.ok(t && ['gable', 'hip', 'cross', 'flat'].includes(t.form), t && t.form);
    assert.ok(Math.abs(Math.hypot(...t.ridge) - 1) < 1e-6);
    if (t.form !== 'flat') assert.ok(t.pitch >= 8 && t.pitch <= 70, `pitch ${t.pitch}`);
    forms[t.form] = (forms[t.form] || 0) + 1;
  }
  assert.ok(forms.gable > 200 && forms.hip > 200 && forms.cross > 100, JSON.stringify(forms));
  // a synthetic gable: two facets sloping away from a ridge along x
  const gable = { fit: 1, eave: 5, polys: [
    { kind: 0, v: [[0, 0, 5], [10, 0, 5], [10, 3, 8], [0, 3, 8]] }, { kind: 0, v: [[0, 6, 5], [0, 3, 8], [10, 3, 8], [10, 6, 5]] }] };
  const g = roofHint(gable);
  assert.equal(g.form, 'gable'); assert.ok(Math.abs(Math.abs(g.ridge[0]) - 1) < 1e-6, `ridge ${g.ridge}`); assert.ok(Math.abs(g.pitch - 45) < 0.5);
  assert.equal(roofHint({ fit: 0, polys: [] }), null);
  assert.equal(roofHint({ fit: 2, eave: 6, polys: [] }).form, 'flat');
});

test('the houses plan as presets: the hint decides the roof, the parts show from the street, the yard is finite', async () => {
  const { recs } = await load();
  const stats = { ok: 0, n: 0, lidarChimneys: 0, chimneys: 0, porticoes: 0, shutters: 0, turrets: 0, yards: 0, tris: 0, hintFront: 0, hintSide: 0, hintMatch: 0, hintTotal: 0 };
  const fails = {};
  for (const rec of recs.filter((r) => r.rosedale.house)) {
    const ring = rec.rings[0], n = ring.length;
    let best = -1, bl = 0;
    const edges = ring.map((a, i) => {
      const b = ring[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), street = rec.street.has(i);
      if (street && len > bl) { bl = len; best = i; }
      return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: rec.hidden.has(i) ? -1 : rec.covered.has(i) ? Draw.WALL.lotLine : Draw.WALL.rear, street };
    });
    if (best < 0) continue;
    edges[best].kind = Draw.WALL.entry;
    stats.n++;
    const plan = Draw.planHouse({ preset: rec.preset, id: rec.id, groupId: rec.id, dwellings: rec.drawFacts.dwellings, ring, edges, covered: rec.covered, y0: 0, lin, roadDist: () => 14, nearRoad: null, hint: rec.rosedale.hint, yard: { lotW: rec.rosedale.lotW, park: rec.rosedale.park }, chimneys: rec.rosedale.chim, variants: rec.variants, roofHex: rec.roofHex, fillMin: rec.fillMin });
    if (!plan.ok) { fails[plan.reason] = (fails[plan.reason] || 0) + 1; continue; }
    stats.ok++;
    const A = { pos: [], nor: [], uv: [], col: [] };
    const tris = plan.pushRoof(A);
    assert.ok(A.pos.every(Number.isFinite) && A.nor.every(Number.isFinite), rec.id);
    assert.equal(A.pos.length, tris * 9);
    stats.tris += tris;
    for (const k of ['chimneys', 'lidarChimneys', 'porticoes', 'shutters', 'turrets', 'yards']) stats[k] += plan.stats[k] || 0;
    const hint = rec.rosedale.hint;
    if (hint && hint.form === 'hip') { stats.hintTotal++; if (plan.form === 'hip' || plan.form === 'sideGable' || plan.form === 'crossGable') stats.hintMatch++; }
    if (hint && hint.form === 'gable' && plan.form !== 'hip') {
      const t = [edges[best].bx - edges[best].ax, edges[best].bz - edges[best].az], L = Math.hypot(...t), across = Math.abs((hint.ridge[0] * t[0] + hint.ridge[1] * t[1]) / L) > 0.7;
      stats.hintTotal++; if (across ? plan.form === 'sideGable' : plan.form === 'frontGable') stats.hintMatch++;
      if (across) stats.hintSide++; else stats.hintFront++;
    }
  }
  assert.ok(stats.ok / stats.n > 0.9, `${stats.ok} of ${stats.n} planned: ${JSON.stringify(fails)}`);
  assert.ok(stats.hintMatch / stats.hintTotal > 0.95, `${stats.hintMatch} of ${stats.hintTotal} roofs follow the lidar`);
  assert.ok(stats.hintSide > 100 && stats.hintFront > 100, 'gables face the street and run along it');
  assert.ok(stats.chimneys > stats.ok * 0.5 && stats.porticoes > 100 && stats.shutters > 500 && stats.turrets > 10 && stats.yards > stats.ok * 0.5, JSON.stringify(stats));
  assert.ok(stats.lidarChimneys > 600, `${stats.lidarChimneys} chimneys the lidar shows are drawn`);
  assert.ok(stats.tris / stats.ok < 130, `${(stats.tris / stats.ok).toFixed(1)} roof triangles a house`);
});

test('the Georgian door is in the middle and its portico stands over it', () => {
  const ring = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const edges = ring.map((a, i) => { const b = ring[(i + 1) % 4], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: i === 0 ? Draw.WALL.entry : Draw.WALL.rear, street: i === 0 }; });
  let found = 0;
  for (let k = 0; k < 40; k++) {
    const id = `to-3dmassing-2025:${900 + k}`;
    const plan = Draw.planHouse({ preset: 'rosedale-georgian', id, groupId: id, dwellings: 1, ring, edges, covered: new Map(), y0: 0, lin, roadDist: () => 20, nearRoad: null });
    assert.ok(plan.ok, plan.reason);
    const entry = plan.kinds.findIndex((q) => q === Draw.WALL.entry);
    assert.ok(entry >= 0);
    const a = plan.ring[entry], b = plan.ring[(entry + 1) % plan.ring.length], mid = (a[0] + b[0]) / 2;
    assert.ok(Math.abs(mid - 5) < 0.6, `door at ${mid}`);
    if (plan.stats.porticoes) found++;
  }
  assert.ok(found > 25, `${found} of 40 have a portico`);
});
