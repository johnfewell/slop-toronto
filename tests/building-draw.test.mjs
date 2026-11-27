// st-ndw9.13: the first three house presets drawn (js/building-draw.js), the gallery page (js/building-gallery.js) and what
// the flags load. The geometry tests run on synthetic lots; the data test runs the rule over every downtown building.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROTOTYPES, byId, DRAW, FACADE_VARIANTS, CURTAIN_FLOORS, FIRST_DRAW_VARIANT } from '../js/building-prototypes.js';
import * as Draw from '../js/building-draw.js';
import * as Gallery from '../js/building-gallery.js';
import * as MC from '../js/massing-cells.js';
import { runDraw } from '../tools/report-building-draw.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lin = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

// a synthetic house: width x depth, the front toward +z with the street edge flagged, as the gallery stands them
function lotInput(preset, id, w, d, extra = {}) {
  const foot = Draw.syntheticLot(id, 0, 0, w, d, preset);
  const ring = foot.rings[0], n = ring.length;
  const edges = ring.map((a, i) => {
    const b = ring[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: i === 1 ? Draw.WALL.entry : Draw.WALL.rear, street: i === 1 };
  });
  return { preset, id, groupId: id, dwellings: 1, ring, edges, covered: new Map(), y0: 0, lin, roadDist: () => Infinity, nearRoad: null, ...extra };
}
const SIZES = {
  'victorian-semi': [11, 16.2, 2], 'edwardian-detached': [7.3, 14.9, 1], 'victorian-row': [24.6, 13.4, 5],
  'victorian-detached': [7.3, 14.5, 1], 'edwardian-semi': [10.4, 15, 2], 'edwardian-row': [18, 13.5, 4], 'interwar-detached': [7.8, 14.5, 1], 'interwar-semi': [10.2, 15.5, 2],
  'postwar-detached': [9, 14, 1], 'postwar-semi': [10.4, 14.5, 2], 'recent-detached': [8, 14, 1], 'recent-semi': [10.5, 15, 2], 'modern-townhouse-row': [19.2, 13.5, 4]
};

test('the catalogue: the three drawn presets carry parameters, every other preset has none', () => {
  assert.deepEqual(Draw.DRAWN_PRESETS.sort(), ['church-chapel', 'church-gothic', 'church-modern', 'contemporary-glass', 'dark-curtain-wall-tower', 'edwardian-detached', 'edwardian-row', 'edwardian-semi', 'glass-tower-podium',
    'interwar-detached', 'interwar-semi', 'low-masonry-block', 'main-street-shop-early', 'main-street-shop-later', 'mid-rise-block', 'modern-townhouse-row', 'mosque', 'plain-low-block', 'postwar-detached', 'postwar-semi',
    'recent-detached', 'recent-semi', 'slab-tower', 'synagogue', 'temple', 'tower', 'victorian-detached', 'victorian-row', 'victorian-semi', 'walk-up-apartment']);
  for (const p of PROTOTYPES) assert.equal(!!p.draw, Draw.DRAWN_PRESETS.includes(p.id), p.id);
  for (const [id, d] of Object.entries(DRAW)) {
    assert.ok(byId[id], id);
    if (d.kind === 'block' || d.kind === 'worship') { // (st-ndw9.20: the apartments, towers, offices, low blocks and places of worship)
      const curtain = d.material === 'curtain' || d.material === 'mixed';
      const limit = curtain ? CURTAIN_FLOORS.length : FACADE_VARIANTS.length;
      const looks = [d, d.podium, d.slabLook].filter(Boolean);
      for (const l of looks) assert.ok(l.variants.every((v) => Number.isInteger(v) && v >= 0 && v < (l === d ? limit : FACADE_VARIANTS.length)) || l === d && curtain, `${id}: variants`);
      for (const l of looks) for (const t of [l.wall || l.stone, ...(l.roof && Array.isArray(l.roof) ? [l.roof] : [])]) assert.ok(t.length && t.every(([, w]) => w > 0), `${id}: weighted tables`);
      continue;
    }
    if (d.kind !== 'shop') assert.ok(d.variants.every((v) => Number.isInteger(v) && v >= 0 && v < FACADE_VARIANTS.length), `${id}: facade variants`);
    for (const t of [d.wall, d.trim, d.roof.colors, d.roof.forms]) assert.ok(t.length && t.every(([, w]) => w > 0), `${id}: weighted tables`);
    for (const r of [d.roof.pitch, d.roof.eave]) assert.ok(r[0] <= r[1]);
  }
  // the merged materials take sixteen styles (js/massing-cells.js MAX_VARIANTS, raised from eight in st-ndw9.20: no material or draw call
  // is added, each style adds one uniform and one select to the shader); the rendered one's two plain styles come first
  assert.ok(FIRST_DRAW_VARIANT + FACADE_VARIANTS.length <= 16, 'within the rendered material variant limit');
  assert.ok(CURTAIN_FLOORS.length <= 16, 'within the curtain-wall material variant limit');
  assert.equal(FIRST_DRAW_VARIANT, 2);
  assert.equal(FIRST_DRAW_VARIANT + FACADE_VARIANTS.length, 16, 'st-ndw9.20 adds five, jf-bya three (the Rosedale Georgian, Tudor and Edwardian sash facades)');
});

test('a house is the same every time and is a pure function of its inputs', () => {
  for (const [preset, [w, d, n]] of Object.entries(SIZES)) {
    const run = () => { const p = Draw.planHouse(lotInput(preset, `t:${preset}:1`, w, d, { dwellings: n })); const A = { pos: [], nor: [], uv: [], col: [] }; p.pushRoof(A); return JSON.stringify([p.ring, p.kinds, p.variant, p.brickHex, p.eaveH, p.form, p.records, A]); };
    assert.equal(run(), run(), preset);
  }
});

test('the choices come from the building id: other ids differ, and one preset reshuffles no other', () => {
  const seen = new Set();
  for (let i = 0; i < 24; i++) {
    const p = Draw.planHouse(lotInput('edwardian-detached', `t:ed:${i}`, 7.3, 14.9));
    assert.ok(p.ok);
    seen.add(`${p.brickHex}|${p.variant}|${p.form}|${p.stats.porches}|${p.stats.dormers}`);
  }
  assert.ok(seen.size >= 8, `24 houses, ${seen.size} different`);
  // the same id under another preset draws from another stream (the preset is part of the label)
  assert.notEqual(Draw.stream('x', 'victorian-semi:group')(), Draw.stream('x', 'victorian-row:group')());
});

test('the halves of a semi, and the houses of a row, share one brick, roof, trim and facade style', () => {
  // two single-dwelling halves of one group: the same group id, different record ids
  const a = Draw.planHouse(lotInput('victorian-semi', 'rec:1', 5.5, 16, { groupId: 'g:9', dwellings: 1 }));
  const b = Draw.planHouse(lotInput('victorian-semi', 'rec:2', 5.5, 16, { groupId: 'g:9', dwellings: 1 }));
  assert.ok(a.ok && b.ok);
  for (const k of ['brickHex', 'variant', 'eaveH', 'form', 'glass']) assert.equal(a[k], b[k], k);
  const A = { pos: [], nor: [], uv: [], col: [] }, B = { pos: [], nor: [], uv: [], col: [] };
  a.pushRoof(A); b.pushRoof(B);
  assert.deepEqual(A.col.slice(0, 3), B.col.slice(0, 3), 'one roof colour');
});

test('a semi in one outline is two mirrored halves: a gable and a bay each, the doors paired at the party wall', () => {
  let drawn = 0;
  for (let i = 0; i < 40; i++) {
    const p = Draw.planHouse(lotInput('victorian-semi', `t:semi:${i}`, 11, 16.2, { dwellings: 2 }));
    assert.ok(p.ok, p.reason);
    assert.equal(p.stats.N, 2);
    const A = { pos: [], nor: [], uv: [], col: [] }; p.pushRoof(A);
    assert.equal(p.stats.gables, 2);
    const bays = p.records.filter((r) => r.kind === 'bay');
    if (bays.length === 2) {
      drawn++;
      // mirrored about the middle of the front: the two bays' centres sit equally far either side
      const mid = (r) => r.rings[0].reduce((s, q) => s + q[0], 0) / 4;
      assert.ok(Math.abs(mid(bays[0]) + mid(bays[1])) < 0.05, 'bays mirror about the party wall');
    }
    // the front: window stretch, door, door, window stretch (the two entries side by side in the middle)
    const entries = p.kinds.reduce((c, k) => c + (k === Draw.WALL.entry ? 1 : 0), 0);
    assert.equal(entries, 2, 'one door per dwelling');
  }
  assert.ok(drawn >= 35, `bays on most (${drawn} of 40)`);
});

test('a row splits its frontage into one bay of gable or mansard per dwelling and keeps one cornice line', () => {
  for (let i = 0; i < 12; i++) {
    const p = Draw.planHouse(lotInput('victorian-row', `t:row:${i}`, 24.6, 13.4, { dwellings: 5 }));
    assert.ok(p.ok);
    assert.equal(p.stats.N, 5);
    assert.equal(p.eaveH, 2 * FACADE_VARIANTS[p.variant - FIRST_DRAW_VARIANT].floorHeight, 'whole storeys to the shared eave');
    const doors = p.kinds.filter((k) => k === Draw.WALL.entry).length;
    assert.equal(doors, 5, 'a door each');
    const A = { pos: [], nor: [], uv: [], col: [] };
    p.pushRoof(A);
    if (p.form === 'frontGable') assert.equal(p.stats.gables, 5);
    else { assert.equal(p.form, 'mansard'); assert.equal(p.stats.dormers, 5); }
  }
});

test('the edwardian detached: a full-width porch on piers, a hip or a front gable, a dormer on some hips', () => {
  const forms = new Set();
  let porches = 0, dormers = 0;
  for (let i = 0; i < 60; i++) {
    const p = Draw.planHouse(lotInput('edwardian-detached', `t:edw:${i}`, 7.3, 14.9));
    assert.ok(p.ok);
    forms.add(p.form);
    const A = { pos: [], nor: [], uv: [], col: [] }; p.pushRoof(A);
    dormers += p.stats.dormers;
    if (p.stats.porches) {
      porches++;
      const kinds = p.records.map((r) => r.kind);
      assert.ok(kinds.includes('porch-slab') && kinds.filter((k) => k === 'porch-pier').length >= 2);
    }
  }
  assert.deepEqual([...forms].sort(), ['frontGable', 'hip']);
  assert.ok(porches > 35, `porches ${porches} of 60`);
  assert.ok(dormers > 0, 'some dormers');
});

test('the roof batch: finite numbers, unit normals, a length per vertex, and an upward slope', () => {
  for (const [preset, [w, d, n]] of Object.entries(SIZES)) {
    for (let i = 0; i < 12; i++) {
      const p = Draw.planHouse(lotInput(preset, `t:roof:${preset}:${i}`, w, d, { dwellings: n }));
      const A = { pos: [], nor: [], uv: [], col: [] };
      const tris = p.pushRoof(A);
      assert.equal(A.pos.length, tris * 9); assert.equal(A.nor.length, tris * 9); assert.equal(A.col.length, tris * 9); assert.equal(A.uv.length, tris * 6);
      for (const v of [...A.pos, ...A.nor, ...A.uv, ...A.col]) assert.ok(Number.isFinite(v));
      for (let t = 0; t < A.nor.length; t += 3) assert.ok(Math.abs(Math.hypot(A.nor[t], A.nor[t + 1], A.nor[t + 2]) - 1) < 1e-6);
      assert.ok(tris >= 2 && tris < 400, `${preset}: ${tris} triangles`);
      // nothing under the ground
      for (let t = 1; t < A.pos.length; t += 3) assert.ok(A.pos[t] >= 0);
    }
  }
});

test('a house the rule cannot fit keeps today’s look, and says why', () => {
  const tiny = Draw.planHouse(lotInput('edwardian-detached', 't:tiny', 3, 3));
  assert.deepEqual([tiny.ok, tiny.reason], [false, 'too-small']);
  const tri = lotInput('victorian-semi', 't:U', 11, 16.2, { dwellings: 2 });
  tri.ring = [[5.5, -8.1], [5.5, 8.1], [-5.5, 8.1], [-5.5, -8.1], [-3, -8.1], [-3, 3.9], [3, 3.9], [3, -8.1]]; // a U: a deep court, no rectangle fits it
  tri.edges = tri.ring.map((a, i) => { const b = tri.ring[(i + 1) % tri.ring.length], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: i === 1 ? 1 : 2, street: i === 1 }; });
  assert.equal(Draw.planHouse(tri).reason, 'too-irregular');
  const shop = lotInput('victorian-row', 't:shop', 24, 13);
  shop.edges[1].kind = Draw.WALL.shop;
  assert.equal(Draw.planHouse(shop).reason, 'shop-front');
  const none = lotInput('victorian-row', 't:none', 24, 13);
  none.edges.forEach((e) => { e.street = false; });
  assert.equal(Draw.planHouse(none).reason, 'no-front');
  assert.equal(Draw.planHouse(lotInput('garage', 't:g', 6, 6)).reason, 'not-drawn');
  // no street edge, but a road to face: the edge that faces it is the front
  const road = lotInput('victorian-row', 't:road', 24, 13);
  road.edges.forEach((e) => { e.street = false; });
  road.nearRoad = { x: 0, z: 30 };
  const planned = Draw.planHouse(road);
  assert.ok(planned.ok && planned.stats.viaRoad);
  // a porch or bay that would stand in the street is left out
  const near = Draw.planHouse(lotInput('edwardian-detached', 't:e', 7.3, 14.9, { roadDist: () => 3 }));
  assert.equal(near.stats.porches, 0);
});

test('the wall kinds line up with the outline: one kind per edge, the front cut at the doors', () => {
  for (const [preset, [w, d, n]] of Object.entries(SIZES)) {
    const p = Draw.planHouse(lotInput(preset, `t:kinds:${preset}`, w, d, { dwellings: n }));
    assert.equal(p.kinds.length, p.ring.length);
    assert.equal(p.cover.length, p.ring.length);
    // counter-clockwise, as the cell builder wants for an outer ring (it orients anyway)
    let a = 0; for (let i = 0, j = p.ring.length - 1; i < p.ring.length; j = i++) a += p.ring[j][0] * p.ring[i][1] - p.ring[i][0] * p.ring[j][1];
    assert.ok(a > 0, 'counter-clockwise');
    for (const r of p.records) {
      assert.equal(r.kinds.length, r.rings[0].length, r.kind);
      assert.ok(r.h > r.base, r.kind);
    }
  }
});

test('the extras are near-tier only: a near-only record is in the near tier and in neither of the others', () => {
  const rect = (x, z, w, d) => [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]];
  const rec = (o) => ({ cx: o.x, cz: o.z, style: 0, variant: 2, rings: [rect(o.x, o.z, o.w, o.d)], base: 0, h: o.h, kinds: [2, 2, 2, 2], capY: o.h, tone: 0.5, seed: 0, paint: [0.5, 0.4, 0.3, 2.5], boxes: [[o.x, o.z, o.w, o.d, 0]], faces: [2, 2, 2, 2], ...o.extra });
  const whole = (list) => MC.buildMassingCells(MC.packInput(list));
  const tri = (out) => out.stats.tiers.map((t) => t.triangles);
  const base = tri(whole([rec({ x: 10, z: 10, w: 8, d: 12, h: 7 })]));
  const withBay = tri(whole([rec({ x: 10, z: 10, w: 8, d: 12, h: 7 }), rec({ x: 10, z: 4, w: 2, d: 1, h: 6, extra: { nearOnly: true, boxes: [] } })]));
  assert.ok(withBay[0] > base[0], 'near gains the bay');
  assert.equal(withBay[1], base[1], 'mid does not');
  assert.equal(withBay[2], base[2], 'far does not');
  assert.equal(MC.packInput([rec({ x: 0, z: 0, w: 2, d: 2, h: 2 })]).nearOnly[0], 0);
  assert.equal(MC.packInput([rec({ x: 0, z: 0, w: 2, d: 2, h: 2, extra: { nearOnly: true } })]).nearOnly[0], 1);
});

test('the gallery: every preset in a row of six, the drawn ones first, nothing overlapping, labelled by the page', () => {
  const ids = PROTOTYPES.map((p) => p.id);
  const drawn = new Set(Draw.DRAWN_PRESETS);
  const counts = Object.fromEntries(ids.map((id, i) => [id, 100 + i]));
  const L = Gallery.galleryLayout(ids, counts, drawn, Gallery.makeGalleryLot(Draw.syntheticLot));
  assert.equal(L.rows.length, ids.length - 1, 'every preset but the unassigned fallback');
  assert.equal(L.lots.length, L.rows.length * Gallery.LOTS_PER_ROW + L.lots.filter((l) => /:(podium|tower)$/.test(l.foot.id)).length, 'six lots a row, and a podium or a church tower part as one more row of its lot');
  const nDrawn = Draw.DRAWN_PRESETS.length;
  assert.deepEqual(L.rows.slice(0, nDrawn).map((r) => r.preset).sort(), Draw.DRAWN_PRESETS.slice().sort());
  assert.ok(L.rows.slice(0, nDrawn).every((r) => r.drawn) && L.rows.slice(nDrawn).every((r) => !r.drawn));
  assert.ok(L.rows.every((r) => r.count === counts[r.preset]));
  const boxes = L.lots.map((l) => [l.x - l.w / 2, l.x + l.w / 2, l.z - l.d / 2, l.z + l.d / 2]);
  for (let i = 0; i < boxes.length; i++) {
    const [a0, a1, b0, b1] = boxes[i];
    assert.ok(a0 >= L.rect.x0 && a1 <= L.rect.x1 && b0 >= L.rect.z0 && b1 <= L.rect.z1, 'inside the rect');
    for (let j = i + 1; j < boxes.length; j++) {
      const [c0, c1, d0, d1] = boxes[j];
      const group = (id) => id.replace(/:(podium|tower)$/, '');
      if (group(L.lots[i].foot.id) === group(L.lots[j].foot.id)) continue; // (a podium and its tower, a church and its tower part: one building)
      assert.ok(a1 <= c0 || c1 <= a0 || b1 <= d0 || d1 <= b0, `lots ${i} and ${j} apart`);
    }
  }
  // the right dwelling count and the docs' median size for the houses
  const semi = L.lots.find((l) => l.preset === 'victorian-semi');
  assert.equal(semi.foot.drawFacts.dwellings, 2);
  assert.deepEqual([semi.w, semi.d], [11, 16.2]);
  assert.ok(L.lots.find((l) => l.preset === 'victorian-row').foot.drawFacts.dwellings >= 3);
  // a lot is a counter-clockwise rectangle whose +z edge (edge 1) is the street front
  const ring = semi.foot.rings[0];
  let a = 0; for (let i = 0, j = 3; i < 4; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  assert.ok(a > 0);
  assert.ok(semi.foot.street.has(1));
  // six lots of a preset have six different ids, so six different houses
  const six = L.lots.filter((l) => l.preset === 'edwardian-detached').map((l) => l.foot.id);
  assert.equal(new Set(six).size, 6);
  // the lot is one box part of the preset's size in the building list, turned 0
  assert.deepEqual(semi.building[3], [[-5.5, 5.5, -8.1, 8.1]]);
  assert.ok(Number.isFinite(L.start.x) && L.start.z > L.rows[0].z);
});

test('a gallery lot goes through the same rule as the city: planHouse on its record draws it', () => {
  const ids = PROTOTYPES.map((p) => p.id);
  const L = Gallery.galleryLayout(ids, {}, new Set(Draw.DRAWN_PRESETS), Gallery.makeGalleryLot(Draw.syntheticLot));
  for (const lot of L.lots.filter((l) => byId[l.preset].draw)) {
    const ring = lot.foot.rings[0], n = ring.length;
    const edges = ring.map((p, i) => { const q = ring[(i + 1) % n], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz); return { ax: p[0], az: p[1], bx: q[0], bz: q[1], nx: dz / len, nz: -dx / len, len, kind: lot.foot.street.has(i) ? 1 : 2, street: lot.foot.street.has(i) }; });
    const plan = Draw.planHouse({ preset: lot.preset, id: lot.foot.id, groupId: lot.foot.drawFacts.groupId, dwellings: lot.foot.drawFacts.dwellings, ring, edges, covered: lot.foot.covered, lin,
      h: lot.building[4], base: lot.foot.base, index: lot.foot.index, group: lot.foot.drawFacts.group, style: 0, variant: 0 });
    assert.ok(plan.ok, `${lot.foot.id}: ${plan.reason}`);
  }
});

test('the flags: the draw module, the gallery and the groups load only behind their flags', () => {
  const main = read('js/main.js');
  assert.match(main, /presetsFlag === 'draw' && !p\.error/, 'the drawing waits for ?presets=draw');
  assert.match(main, /import\('\.\/building-draw\.js'\)/);
  assert.match(main, /if \(galleryPage\) \{[\s\S]*?import\('\.\/building-gallery\.js'\)/, 'the gallery module only for ?gallery=presets');
  // the draw module is loaded by nothing else
  for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter((n) => n.endsWith('.js'))) {
    const src = read(`js/${f}`);
    if (['main.js', 'building-gallery.js', 'building-draw.js', 'building-draw-tall.js', 'building-draw-worship.js'].includes(f)) continue; // (the two new files are building-draw.js's own parts)
    assert.ok(!/building-draw\.js|building-gallery\.js/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), `${f} does not load them`);
  }
  // the page reads the flag: without it the buildings code takes no new branch
  const b = read('js/buildings.js');
  assert.match(b, /const presetDraw = !!massing && !!window\.CITY\.BuildingDraw/);
  assert.match(b, /if \(presetDraw && !victorian && foot\.preset/);
  assert.match(b, /m === 0 \? drawStyles : m === 2 \? drawCurtain : \[\]/, 'the extra facade styles join the materials only when drawing');
  assert.match(main, /loadBuildingDrawFacts\(window\.CITY\.MASSING, window\.CITY\.GEO, p, DEBUG_URL\)/, 'the groups file is the debug file, named by its module');
});

test('every downtown building: most house presets are drawn, the rest fall back and are counted by reason', async () => {
  const out = await runDraw();
  assert.equal(out.records, 35259);
  for (const id of Draw.DRAWN_PRESETS.filter((x) => ['house', 'main-street'].includes(byId[x].family))) {
    const p = out.per[id];
    assert.ok(p.records > 200, id);
    assert.equal(p.drawn + p.fallback, p.records, `${id}: every record is drawn or falls back`);
    assert.ok(p.drawn / p.records > 0.7, `${id}: ${p.drawn} of ${p.records} drawn`);
  }
  assert.deepEqual(Object.keys(out.fallback).filter((k) => !Draw.FALLBACK_REASONS.includes(k)), [], 'every reason is a known one');
  assert.ok(out.parts.bays > 3000 && out.parts.porches > 1000 && out.parts.dormers > 500 && out.parts.gables > 3000);
  assert.ok(out.parts.wings > 5000 && out.parts.vestibules > 500 && out.parts.stoops > 300 && out.parts.parapets > 3000, 'the rear wings and the later presets parts');
  // the cell meshes: the extras make the near tier heavier, never the mid or far; a 500 m cell stays under double
  assert.ok(out.cells.ratioMaxBig < 2, `the worst cell of 100 triangles or more is ${out.cells.ratioMaxBig.toFixed(2)}x its buildings' triangles`);
  assert.equal(out.cells.tiers.drawn[1].triangles <= out.cells.tiers.base[1].triangles * 1.5, true);
  assert.equal(out.cells.blocksDrawn, out.cells.blocksBase, 'no block (so no mesh and no draw call) is added');
  // a second run is the same
  const again = await runDraw({ cells: false });
  assert.deepEqual(again.plans, out.plans, 'the same buildings come out the same');
});


// ---- st-ndw9.15: the real back, one roof per row, the later presets, the shops --------------------------------------------
const maxY = (A) => { let m = 0; for (let t = 1; t < A.pos.length; t += 3) m = Math.max(m, A.pos[t]); return m; };
const ringOf = (pts) => pts;
const withRing = (preset, id, ring, extra = {}) => {
  const n = ring.length;
  const edges = ring.map((a, i) => {
    const b = ring[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: i === 1 ? Draw.WALL.entry : Draw.WALL.rear, street: i === 1 };
  });
  return { preset, id, groupId: id, dwellings: 1, ring, edges, covered: new Map(), y0: 0, lin, roadDist: () => Infinity, nearRoad: null, ...extra };
};

test('clean front, real back: an L-shaped outline is a composed front block and a lower rear wing that follows the outline', () => {
  // a 7.4 m wide house, 9 m deep, with a 4.4 m wide wing 6 m further back (the front edge is edge 1, at z = +7.5)
  const ring = [[3.7, -7.5], [3.7, 7.5], [-3.7, 7.5], [-3.7, -1.5], [-0.7, -1.5], [-0.7, -7.5]];
  const plan = Draw.planHouse(withRing('edwardian-detached', 't:wing', ring));
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.stats.wings, 1);
  const wing = plan.records.find((r) => r.kind === 'wing');
  assert.ok(wing && wing.nearOnly === false, 'the wing is a record of its own in every tier');
  assert.ok(wing.h < plan.eaveH, 'one storey lower');
  assert.equal(wing.kinds.length, wing.rings[0].length);
  assert.equal(wing.cover.length, wing.rings[0].length);
  // the wing's cut against the block's rear wall is hidden, its other walls are not
  assert.ok(wing.kinds.includes(-1) && wing.kinds.some((k) => k >= 0));
  // the block is a rectangle (four corners plus the cut front stretches), 9 m deep: the front is composed, the wing is not in it
  const zs = plan.ring.map((q) => q[1]);
  assert.ok(Math.max(...zs) - Math.min(...zs) < 10 && Math.max(...zs) - Math.min(...zs) > 8, 'the block ends where the outline narrows');
  const wingXs = wing.rings[0].map((q) => q[0]);
  assert.ok(Math.max(...wingXs) - Math.min(...wingXs) < 5 && Math.max(...wingXs) - Math.min(...wingXs) > 3.5, 'the wing keeps the outline width');
  // the same outline is a plain rectangle when it has no wing
  const plain = Draw.planHouse(withRing('edwardian-detached', 't:wing', [[3.7, -7.5], [3.7, 7.5], [-3.7, 7.5], [-3.7, -7.5]]));
  assert.equal(plain.stats.wings, 0);
});

test('clean front: what the real outline has in front of the front line (an old porch) is dropped, and a ragged front edge is tried against the others', () => {
  const ring = [[5, -7.5], [5, 7.5], [1.25, 7.5], [1.25, 9], [-1.25, 9], [-1.25, 7.5], [-5, 7.5], [-5, -7.5]]; // a 2.5 m porch bump in a 10 m front
  const edges = ring.map((a, i) => { const b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: 2, street: false }; });
  edges[1].kind = Draw.WALL.entry; edges[1].street = true; // the short front edge beside the porch
  const plan = Draw.planHouse({ ...withRing('edwardian-detached', 't:porch', ring), edges });
  assert.ok(plan.ok, plan.reason);
  assert.ok(plan.ring.every(([, z]) => z <= 7.51), 'nothing stands in front of the front line');
});

test('one roof per joined row: houses of one group share the cornice height and the ridge, whatever each outline measures', () => {
  const lots = [[5.2, 12.4], [4.6, 13.6], [5.9, 11.8], [4.9, 14.2]];
  for (const preset of ['victorian-row', 'edwardian-row']) {
    for (let g = 0; g < 16; g++) {
      const tops = [], eaves = [], forms = new Set();
      for (const [w, d] of lots) {
        const ring = [[w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]];
        const edges = ring.map((a, i) => { const b = ring[(i + 1) % 4], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: i === 1 ? 1 : (i % 2 === 0 ? 3 : 2), street: i === 1 }; });
        const plan = Draw.planHouse({ preset, id: `t:${g}:${w}`, groupId: `g:${preset}:${g}`, dwellings: 1, ring, edges, covered: new Map([[0, 9], [2, 9]]), y0: 0, lin, roadDist: () => Infinity, nearRoad: null });
        assert.ok(plan.ok, plan.reason);
        const A = { pos: [], nor: [], uv: [], col: [] }; plan.pushRoof(A);
        tops.push(Math.round(maxY(A) * 100) / 100); eaves.push(plan.eaveH); forms.add(plan.form);
      }
      assert.equal(new Set(eaves).size, 1, `${preset}: one cornice height`);
      assert.equal(forms.size, 1, `${preset}: one roof form`);
      // (a pitch clamp may move a very wide or narrow house's gable a little: the ridge of a run is level within 0.35 m)
      assert.ok(Math.max(...tops) - Math.min(...tops) < 0.35, `${preset}: ridge heights ${tops.join(', ')}`);
    }
  }
});

test('a hip does not stand against a party wall: joined houses carry the group’s roof on as a side gable', () => {
  let joined = 0;
  for (let i = 0; i < 40; i++) {
    const ring = [[2.9, -7], [2.9, 7], [-2.9, 7], [-2.9, -7]];
    const edges = ring.map((a, k) => { const b = ring[(k + 1) % 4], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: k === 1 ? 1 : (k % 2 === 0 ? 3 : 2), street: k === 1 }; });
    const p = Draw.planHouse({ preset: 'edwardian-semi', id: `t:e:${i}`, groupId: `g:e:${i}`, dwellings: 1, ring, edges, covered: new Map([[0, 9], [2, 9]]), y0: 0, lin, roadDist: () => Infinity, nearRoad: null });
    assert.ok(p.ok && p.form !== 'hip', p.form);
    joined++;
  }
  assert.equal(joined, 40);
});

test('the later house presets draw their own parts: a vestibule, half-timber, a stoop and picture window, a garage and a parapet', () => {
  const seen = {};
  for (const [preset, [w, d, n]] of Object.entries(SIZES)) {
    for (let i = 0; i < 60; i++) {
      const p = Draw.planHouse(lotInput(preset, `t:parts:${preset}:${i}`, w, d, { dwellings: n }));
      assert.ok(p.ok, `${preset}: ${p.reason}`);
      const A = { pos: [], nor: [], uv: [], col: [] }; p.pushRoof(A);
      for (const k of ['vestibules', 'timbered', 'stoops', 'pictureWindows', 'garages', 'parapets', 'crossGables', 'dormers']) if (p.stats[k]) ((seen[preset] ||= {})[k] = (seen[preset][k] || 0) + 1);
      // the later presets' storeys are whole, and the shared facade variants stay inside the material's eight
      assert.ok(p.variant >= FIRST_DRAW_VARIANT && p.variant < 8);
      assert.equal(Math.abs(p.eaveH / FACADE_VARIANTS[p.variant - FIRST_DRAW_VARIANT].floorHeight - Math.round(p.eaveH / FACADE_VARIANTS[p.variant - FIRST_DRAW_VARIANT].floorHeight)) < 1e-9, true);
    }
  }
  assert.ok(seen['interwar-detached'].vestibules > 20 && seen['interwar-detached'].timbered > 5 && seen['interwar-detached'].crossGables > 10);
  assert.ok(seen['postwar-detached'].stoops > 30 && seen['postwar-detached'].pictureWindows > 20);
  assert.ok(seen['recent-detached'].garages > 10 && seen['recent-detached'].parapets === 60);
  assert.ok(seen['modern-townhouse-row'].parapets === 60);
});

test('the shops: the outline, the wall kinds and the covers are the page’s own; the storeys, cornice and parapet are drawn around them', () => {
  const ring = [[3.2, -11], [3.2, 11], [-3.2, 11], [-3.2, -11]];
  const edges = ring.map((a, i) => { const b = ring[(i + 1) % 4], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: i === 1 ? Draw.WALL.shop : (i % 2 === 0 ? Draw.WALL.lotLine : Draw.WALL.rear), street: i === 1 }; });
  const covered = new Map([[0, 10], [2, 10]]);
  for (const preset of ['main-street-shop-early', 'main-street-shop-later']) {
    for (const h of [8.1, 10.5, 13.4]) {
      const p = Draw.planHouse({ preset, id: `t:${preset}:${h}`, ring, edges, covered, y0: 0, lin, h, style: 0, variant: 0 });
      assert.ok(p.ok, p.reason);
      assert.deepEqual(p.kinds, edges.map((e) => e.kind), 'the wall kinds are the page’s');
      assert.deepEqual(p.ring, ring, 'the outline is kept');
      assert.ok(p.keep);
      assert.ok(p.stats.storeys >= 2 && p.stats.storeys <= 4);
      const A = { pos: [], nor: [], uv: [], col: [] }; p.pushRoof(A);
      // the parapet and cornice are near-tier records above the eave; the roof is a tar slab just under the parapet's foot
      assert.ok(p.records.length >= 1 && p.records.every((r) => r.nearOnly === true && r.h > p.eaveH - 0.001), 'near-only parapet or cornice records');
      assert.ok(A.pos.length > 0 && maxY(A) < p.eaveH, 'a flat slab under the parapet');
      if (preset.endsWith('early')) assert.equal(p.variant, FIRST_DRAW_VARIANT + 4, 'the tall narrow upper windows');
      else assert.equal(p.variant, 0, 'the later shops keep the page’s plain style');
    }
    assert.equal(Draw.planHouse({ preset, id: 't:low', ring, edges, covered, y0: 0, lin, h: 4.5, style: 0, variant: 0 }).reason, 'one-storey');
    assert.equal(Draw.planHouse({ preset, id: 't:tall', ring, edges, covered, y0: 0, lin, h: 22, style: 0, variant: 0 }).reason, 'too-tall');
    assert.equal(Draw.planHouse({ preset, id: 't:glass', ring, edges, covered, y0: 0, lin, h: 9, style: 2, variant: 0 }).reason, 'other-facade');
  }
  // the early shop's variant has the plain style 0's storey, seed and corner pier, so the ground-floor shop front is the same
  const tall = FACADE_VARIANTS[4];
  assert.deepEqual([tall.floorHeight, tall.seed, tall.cornerPier], [3.4, 13.0, 1.2]);
});


// ---- st-ndw9.15 round 3 ----------------------------------------------------------------------------------------------------
test('one front line per run: the median of the run, within 2.6 m; a larger step stays a real step', () => {
  const mk = (id, ox, oz, off) => ({ id, groupId: 'g', A: [ox, oz + off], t: [1, 0], u0: 0, u1: 5, z1: 12, edge: 1 });
  // five houses side by side along +x, fronts at z offsets 0, 0.4, -0.3, 0.5, 3.4 (the last is a real step); outward normal of t=(1,0) is (0,-1)
  const plans = [mk('a', 0, 0, 0), mk('b', 5, 0, 0.4), mk('c', 10, 0, -0.3), mk('d', 15, 0, 0.5), mk('e', 20, 0, 3.4)];
  const r = Draw.snapFronts(plans);
  assert.equal(r.runs, 1);
  assert.equal(r.steps, 1, 'the 3.4 m step stays');
  assert.equal((r.shifts.get('e') || { s: 0 }).s, 0, 'e keeps its own front line');
  // the median offset along the normal (0, -1): offsets are -z: 0, -0.4, 0.3, -0.5, -3.4 -> median -0.4; b stays, a moves
  assert.ok(Math.abs(r.shifts.get('a').s + 0.4) < 1e-9 || Math.abs(r.shifts.get('a').s - -0.4) < 1e-9);
  assert.equal((r.shifts.get('b') || { s: 0 }).s, 0);
  // houses of different groups, or not touching, or turned, are not one run
  assert.equal(Draw.snapFronts([mk('a', 0, 0, 0), { ...mk('b', 5, 0, 0.4), groupId: 'h' }]).runs, 0);
  assert.equal(Draw.snapFronts([mk('a', 0, 0, 0), mk('b', 30, 0, 0.4)]).runs, 0);
  assert.equal(Draw.snapFronts([mk('a', 0, 0, 0), { ...mk('b', 5, 0, 0.4), t: [Math.cos(0.2), Math.sin(0.2)] }]).runs, 0);
});

test('st-ndw9.18: one back line per run, the upper median: a deeper house is cut back to it, a shallower one carried back by at most 2.5 m, one further off keeps its own', () => {
  const mk = (id, ox, z1) => ({ id, groupId: 'g', A: [ox, 0], t: [1, 0], u0: 0, u1: 5, z1, edge: 1 });
  const r = Draw.snapFronts([mk('a', 0, 12), mk('b', 5, 13.5), mk('c', 10, 12), mk('d', 15, 16), mk('e', 20, 7.5)]);
  assert.equal(r.runs, 1);
  assert.equal(r.shifts.get('b').depth, 12, 'a deeper house is cut back to the median');
  assert.equal(r.shifts.get('d').depth, 12);
  assert.ok(!r.shifts.has('a') && !r.shifts.has('c'), 'a house on the line has no entry');
  assert.ok(!r.shifts.has('e'), 'a house 4.5 m too shallow keeps its depth');
  assert.equal(r.depthSet, 2); assert.equal(r.depthRuns, 1); assert.equal(r.depthSteps, 1);
  // the planned house takes it: its block ends on the run's back line, what lies behind it is the wing
  const ring = [[3.7, -7.5], [3.7, 7.5], [-3.7, 7.5], [-3.7, -7.5]];
  const cut = Draw.planHouse({ ...withRing('edwardian-detached', 't:depth', ring), frontShift: { edge: 1, s: 0, depth: 9.5 } });
  assert.ok(cut.ok && Math.abs(cut.frame.z1 - 9.5) < 1e-6, 'the block is 9.5 m deep');
  assert.equal(cut.stats.wings, 1, 'the 5.5 m behind it is the rear wing');
});

test('a shift moves the composed front: the front line of the house is the run’s', () => {
  const ring = [[3.7, -7.5], [3.7, 7.5], [-3.7, 7.5], [-3.7, -7.5]];
  const plain = Draw.planHouse(withRing('edwardian-detached', 't:shift', ring));
  const moved = Draw.planHouse({ ...withRing('edwardian-detached', 't:shift', ring), frontShift: { edge: 1, s: -0.8 } });
  assert.ok(plain.ok && moved.ok);
  const zmax = (p) => Math.max(...p.ring.map((q) => q[1]));
  assert.ok(Math.abs(zmax(plain) - 7.5) < 1e-6 && Math.abs(zmax(moved) - 6.7) < 1e-6, 'the front moved 0.8 m inward');
  assert.equal(plain.frame.shift, 0); assert.equal(moved.frame.shift, -0.8);
  // a shift for another edge is ignored
  assert.equal(Draw.planHouse({ ...withRing('edwardian-detached', 't:shift', ring), frontShift: { edge: 0, s: -0.8 } }).frame.shift, 0);
});

test('flat roofs and rear wings are tar-grey slabs in the roof batch, darker than the cell material’s near-white cap; shaded per building', () => {
  const cols = new Set();
  for (let i = 0; i < 20; i++) {
    const p = Draw.planHouse(lotInput('recent-detached', `t:tar:${i}`, 8, 14));
    const A = { pos: [], nor: [], uv: [], col: [] }; p.pushRoof(A);
    assert.ok(A.col.length >= 18);
    for (let t = 0; t < 18; t += 3) assert.ok(A.col[t] < 1.1 && A.col[t + 1] < 1.1 && A.col[t + 2] < 1.1 && A.col[t] > 0.3, 'a mid grey, not white and not black (the test lin is sRGB/255)');
    cols.add(A.col[0].toFixed(4));
  }
  assert.ok(cols.size >= 8, 'per-building variation');
  const L = Draw.planHouse(withRing('edwardian-detached', 't:wingslab', [[3.7, -7.5], [3.7, 7.5], [-3.7, 7.5], [-3.7, -1.5], [-0.7, -1.5], [-0.7, -7.5]]));
  const A = { pos: [], nor: [], uv: [], col: [] }; L.pushRoof(A);
  const wing = L.records.find((r) => r.kind === 'wing');
  let atWing = 0; for (let t = 1; t < A.pos.length; t += 3) if (Math.abs(A.pos[t] - (wing.h - 0.015)) < 1e-6) atWing++;
  assert.ok(atWing >= 6, 'the wing has a slab');
});

test('the interwar semi is lower and has one shared cross gable, or a hip with one front gable; the Victorian semi keeps its twin gables', () => {
  let shared = 0, hipG = 0, low = 0;
  for (let i = 0; i < 60; i++) {
    const p = Draw.planHouse(lotInput('interwar-semi', `t:iws:${i}`, 10.2, 15.5, { dwellings: 2 }));
    assert.ok(p.ok);
    p.pushRoof({ pos: [], nor: [], uv: [], col: [] });
    if (p.form === 'crossGable') { assert.equal(p.stats.crossGables, 1, 'one shared gable'); shared++; }
    if (p.form === 'hipGable') { assert.ok(p.stats.crossGables <= 1); hipG++; }
    assert.ok(['crossGable', 'hipGable'].includes(p.form));
    if (p.stats.storeys === 1) low++;
  }
  assert.ok(shared > 10 && hipG > 10 && low > 15, `${shared} ${hipG} ${low}`);
  const v = Draw.planHouse(lotInput('victorian-semi', 't:v', 11, 16.2, { dwellings: 2 }));
  v.pushRoof({ pos: [], nor: [], uv: [], col: [] });
  assert.equal(v.stats.gables, 2);
});

test('the page hands planHouse what a shop needs: the height, the facade style, the holes and the run’s shift', () => {
  const b = fs.readFileSync(path.join(ROOT, 'js/buildings.js'), 'utf8');
  assert.match(b, /h, style: FOOTPRINT_STYLE\[mat\]\[0\], variant: FOOTPRINT_STYLE\[mat\]\[1\], holes: foot\.rings\.length - 1, frontShift: frontShifts/);
  // a shop with no height is a plan with no finite eave: the page's guard would keep today's look for every shop
  const ring = [[3.2, -11], [3.2, 11], [-3.2, 11], [-3.2, -11]];
  const edges = ring.map((a, i) => { const q = ring[(i + 1) % 4], dx = q[0] - a[0], dz = q[1] - a[1], len = Math.hypot(dx, dz); return { ax: a[0], az: a[1], bx: q[0], bz: q[1], nx: dz / len, nz: -dx / len, len, kind: i === 1 ? 0 : 2, street: i === 1 }; });
  const p = Draw.planHouse({ preset: 'main-street-shop-early', id: 't:s', ring, edges, covered: new Map(), y0: 0, lin, h: 9, style: 0, variant: 0 });
  assert.ok(Number.isFinite(p.eaveH));
});

test('st-ndw9.21: the far roof is the roof without what stands on it, the full roof is unchanged, and the frame-only plan has the full plan\'s front line', () => {
  let fewer = 0, same = 0;
  for (const [preset, w, d, n] of [['edwardian-detached', 7.3, 14.9, 1], ['victorian-semi', 11, 16.2, 2], ['victorian-row', 24.6, 13.4, 5], ['interwar-detached', 8, 15, 1], ['victorian-detached', 8.4, 13, 1], ['postwar-semi', 10, 12, 2]]) {
    for (let i = 0; i < 12; i++) {
      const input = lotInput(preset, `t:lod:${preset}:${i}`, w, d, { dwellings: n });
      const p = Draw.planHouse(input);
      if (!p.ok) continue;
      assert.equal(p.lodRoof, true);
      const full = { pos: [], nor: [], uv: [], col: [] }, far = { pos: [], nor: [], uv: [], col: [] }, again = { pos: [], nor: [], uv: [], col: [] };
      const nFull = p.pushRoof(full), nFar = p.pushRoof(far, true), nAgain = p.pushRoof(again);
      assert.equal(nFull, nAgain, 'the full roof does not depend on a far one having been made');
      assert.deepEqual(full, again);
      assert.ok(nFar <= nFull && nFar > 0);
      if (nFar < nFull) fewer++; else same++;
      assert.equal(far.pos.length, nFar * 9);
      const f = Draw.planHouse({ ...input, frameOnly: true });
      assert.equal(f.ok, true);
      assert.deepEqual(f.frame, p.frame, 'the same front line, so the same shifts');
    }
  }
  assert.ok(fewer > 0, 'some roofs have small parts to leave out');
});

// ---- st-ndw9.18: the near details of the houses, the sign band, the worship forms, the towers' trim -------------------------------------------
import { windowOpenings } from '../js/building-draw-detail.js';
import { SHOP_SIGN_BOARDS, SHOP_SIGN } from '../js/building-prototypes.js';

test('st-ndw9.18: window openings follow the facade shader’s grid: piers, whole bays, the opening’s share of the bay and of the storey', () => {
  const st = FACADE_VARIANTS[2]; // edwardian-pair: 2.7 m bays, 0.55 m corner piers, 0.66 x 0.5 openings, 3.1 m storeys
  const ops = windowOpenings([{ a: 0, b: 7.4, kind: Draw.WALL.rear }], st, 2);
  // inner = 7.4 - 1.1 = 6.3 m, 2 bays of 3.15 m (round(6.3 / 2.7) = 2); openings 0.66 x 3.15 = 2.079 m wide, centred in their bays
  assert.equal(ops.length, 4);
  const first = ops.find((o) => o.f === 0 && o.u0 < 3);
  assert.ok(Math.abs((first.u0 + first.u1) / 2 - (0.55 + 1.575)) < 1e-9 && Math.abs(first.u1 - first.u0 - 2.079) < 1e-9);
  assert.ok(Math.abs(first.yb - 3.1 * 0.25) < 1e-9 && Math.abs(first.yt - 3.1 * 0.75) < 1e-9, 'the opening is the middle half of the storey');
  // a door wall has no window on its ground floor (the shader picks the door’s bay); a bay in front hides its windows
  assert.equal(windowOpenings([{ a: 0, b: 7.4, kind: Draw.WALL.entry }], st, 2, { entry: Draw.WALL.entry }).filter((o) => o.f === 0).length, 0);
  assert.equal(windowOpenings([{ a: 0, b: 7.4, kind: Draw.WALL.rear }], st, 2, { skip: [[0.2, 3.4]] }).length, 2);
});

test('st-ndw9.18: sills, lintels and porch columns are in the near roof only, never in the far one; a porch has its columns on lower plinths', () => {
  let withTrim = 0;
  for (const preset of ['victorian-semi', 'victorian-detached', 'edwardian-detached', 'edwardian-semi', 'edwardian-row', 'victorian-row', 'interwar-detached']) {
    const [w, d, n] = SIZES[preset];
    for (let i = 0; i < 6; i++) {
      const input = lotInput(preset, `t:detail:${preset}:${i}`, w, d, { dwellings: n });
      const p = Draw.planHouse(input); assert.ok(p.ok, `${preset} ${p.reason}`);
      const far = { pos: [], nor: [], uv: [], col: [] }, near = { pos: [], nor: [], uv: [], col: [] };
      const q = Draw.planHouse(input); const nFar = q.pushRoof(far, true);
      assert.equal(q.stats.sills, 0); assert.equal(q.stats.columns, 0); assert.equal(q.stats.detailTris, 0, 'the far roof has no near details');
      const nNear = p.pushRoof(near);
      assert.equal(near.pos.length, nNear * 9);
      assert.ok(nNear > nFar);
      if (preset === 'interwar-detached') assert.equal(p.stats.lintels, 0, 'the interwar houses have sills only'); else assert.equal(p.stats.sills, p.stats.lintels, 'a sill and a lintel for each opening');
      if (p.stats.sills > 0) withTrim++;
      if (p.stats.columns) {
        const piers = p.records.filter((r) => r.kind === 'porch-pier');
        assert.ok(piers.length === p.stats.columns, 'a column on each plinth');
        assert.ok(piers.every((r) => Math.abs(r.h - r.base - 0.53) < 1e-6), 'the brick plinth stops at 0.95 m: the column above it is in the near roof');
        assert.ok(piers.every((r) => r.nearOnly === true));
      }
    }
  }
  assert.ok(withTrim >= 30, 'most houses of these presets have sills');
});

test('st-ndw9.18: the sign band: a board and a name plate over each storefront of a drawn shop, in the page’s own sign colours, no lettering', () => {
  const src = fs.readFileSync(new URL('../js/storefront-signs.js', import.meta.url), 'utf8');
  const boardsInSource = new Set([...src.matchAll(/0x([0-9a-f]{6})/g)].map((m) => parseInt(m[1], 16)));
  for (const [b, ink] of SHOP_SIGN_BOARDS) assert.ok(boardsInSource.has(b) && boardsInSource.has(ink), `${b.toString(16)} and ${ink.toString(16)} are colours of js/storefront-signs.js`);
  assert.equal(SHOP_SIGN.boardH, 0.55); assert.match(src, /BOARD_H = 0\.55/);
  const ring = [[10, 0], [10, 20], [-10, 20], [-10, 0]]; // a 20 m frontage along x at z = 20 (edge 1 runs from x = 10 to -10)
  const edges = ring.map((a, i) => { const b = ring[(i + 1) % 4], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: i === 1 ? Draw.WALL.shop : Draw.WALL.rear, street: i === 1 }; });
  let signed = 0;
  for (let i = 0; i < 12; i++) {
    const p = Draw.planHouse({ preset: 'main-street-shop-early', id: `t:sign:${i}`, groupId: `t:sign:${i}`, ring, edges, covered: new Map(), y0: 0, lin, h: 11, style: 0, variant: 0 });
    assert.ok(p.ok);
    const A = { pos: [], nor: [], uv: [], col: [] }, n = p.pushRoof(A);
    if (p.stats.signs) { signed++; assert.equal(p.stats.signs, 3, 'a 20 m frontage is three storefronts of 6.7 m'); assert.ok(n >= 12 + 3 * 4 - 12); }
    // every sign quad stands at the fascia: between 2.7 and 3.3 m
    const ys = []; for (let t = 1; t < A.pos.length; t += 3) ys.push(A.pos[t]);
    if (p.stats.signs) assert.ok(ys.some((y) => Math.abs(y - (3.4 - 0.12)) < 1e-6) && ys.some((y) => Math.abs(y - (3.4 - 0.12 - 0.55)) < 1e-6));
  }
  assert.ok(signed >= 10, 'nearly every shop is signed');
});

test('st-ndw9.18: a modern church is never a flat box: a steep roof, a cross on the street end and on its tower; a Gothic tower has pointed openings', async () => {
  const out = await runDraw({ cells: false });
  const m = out.plans.filter((p) => p.preset === 'church-modern' && p.stats.form === 'modern-nave');
  assert.ok(m.length >= 12);
  const flat = m.filter((p) => p.stats.gables === 0 && p.stats.crosses === 0);
  assert.ok(flat.length <= m.length * 0.2, `${flat.length} of ${m.length} modern naves have neither a roof form nor a cross`);
  assert.ok(m.filter((p) => p.stats.crosses > 0).length >= m.length * 0.8, 'a cross on nearly every modern church');
  const g = out.plans.filter((p) => p.preset === 'church-gothic');
  assert.ok(g.reduce((s, p) => s + p.stats.towers, 0) >= 90 && g.filter((p) => p.stats.form === 'gothic-nave' && p.stats.towers > 0).length >= 60);
  // a spire only where the data has the height for one: fewer spires than towers
  assert.ok(g.reduce((s, p) => s + p.stats.spires, 0) < g.reduce((s, p) => s + p.stats.towers, 0) * 2, 'spires are not on every tower');
});

test('st-ndw9.18: the tall roofs’ trim: balcony slab tops below the top floors and the parapets’ tops are left out, and a floor under a neighbour’s roof has no band', async () => {
  const Tall = await import('../js/building-draw-tall.js');
  assert.equal(Tall.TRIM.balconyTops, true); assert.equal(Tall.TRIM.parapetTops, true);
  const out = await runDraw({ cells: false });
  const slab = out.plans.filter((p) => p.preset === 'slab-tower' && p.stats.balconyBands > 0);
  assert.ok(slab.length > 300);
  // (runDraw makes two roofs a building: the counts are doubled)
  const bands = slab.reduce((s, p) => s + p.stats.balconyBands / 2, 0), hidden = out.plans.reduce((s, p) => s + (p.stats.bandsHidden || 0) / 2, 0);
  assert.ok(bands > 5000);
  assert.ok(hidden >= 0);
});

test('st-ndw9.18: a building with a real source-keyed sign gets no blank board', () => {
  const ring = [[10, 0], [10, 20], [-10, 20], [-10, 0]];
  const edges = ring.map((a, i) => { const b = ring[(i + 1) % 4], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: i === 1 ? Draw.WALL.shop : Draw.WALL.rear, street: i === 1 }; });
  const plan = (id) => Draw.planHouse({ preset: 'main-street-shop-early', id, groupId: id, ring, edges, covered: new Map(), y0: 0, lin, h: 11, style: 0, variant: 0 });
  let blank = 0; for (let i = 0; i < 10; i++) blank += plan(`to-3dmassing-2025:9${i}`).stats.signs;
  assert.ok(blank > 0);
  // (st-ndw9.24: only the stretch a real sign stands in front of loses its board, not the building's other storefronts)
  let full = null; for (let i = 0; i < 10 && !full; i++) { const p = plan(`to-3dmassing-2025:7${i}`); if (p.stats.signs === 3) full = `to-3dmassing-2025:7${i}`; }
  assert.ok(full, 'a three-board building exists');
  globalThis.window = { CITY: { STOREFRONTS: { signs: [{ face: 'to-3dmassing-2025:90:n', x: 0, z: 20, nx: 0, nz: 1, width: 7 }, { face: `${full}:n`, x: 0, z: 20, nx: 0, nz: 1, width: 7 }] } } };
  try {
    assert.equal(plan(full).stats.signs, 2, 'the middle storefront has the real sign; the two beside it keep theirs');
    assert.ok(plan('to-3dmassing-2025:90').stats.signs < 3, 'the signed storefront has no blank board');
    assert.ok(plan('to-3dmassing-2025:91').stats.signs > 0 || plan('to-3dmassing-2025:92').stats.signs > 0, 'its neighbours keep theirs');
  } finally { delete globalThis.window; }
});

test('st-ndw9.24: a gap of a few tenths between neighbouring outlines is closed by carrying each party-side roof half of it', () => {
  const mk = (id, ox) => ({ id, groupId: 'g', A: [ox, 0], t: [1, 0], u0: 0, u1: 5, z1: 12, edge: 1 });
  const r = Draw.snapFronts([mk('a', 0), mk('b', 5.3), mk('c', 10.3), mk('d', 20)]); // a|b 0.3 m apart, b|c touching, d is 4.7 m away
  assert.ok(Math.abs(r.shifts.get('a').carryR - 0.16) < 1e-9 && r.shifts.get('a').carryL === 0);
  assert.ok(Math.abs(r.shifts.get('b').carryL - 0.16) < 1e-9 && r.shifts.get('b').carryR === 0, 'a touching side carries nothing');
  assert.equal(r.shifts.get('c'), undefined, 'c touches b and has no other neighbour');
  assert.equal(r.shifts.get('d'), undefined);
});
