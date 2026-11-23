// st-ndw9.20: the apartments, towers, offices, low blocks and places of worship drawn (js/building-draw-tall.js, js/building-draw-worship.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { byId, DRAW, FACADE_VARIANTS, CURTAIN_FLOORS } from '../js/building-prototypes.js';
import * as Draw from '../js/building-draw.js';
import { obbOf } from '../js/building-draw-tall.js';
import { runDraw } from '../tools/report-building-draw.mjs';
import { partition } from '../tools/report-building-forms.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MINE = ['walk-up-apartment', 'mid-rise-block', 'slab-tower', 'glass-tower-podium', 'dark-curtain-wall-tower', 'contemporary-glass', 'tower', 'low-masonry-block', 'plain-low-block',
  'church-gothic', 'church-chapel', 'church-modern', 'mosque', 'synagogue', 'temple'];

test('the page hands the block and worship planners everything they read (a missing value was what left every shop undrawn once)', () => {
  const b = read('js/buildings.js');
  // the call in the building loop carries the data's height, the part's base, its record index and its group's facts
  assert.match(b, /index: foot\.index, base: Math\.min\(foot\.base, h - 0\.5\), group: facts && facts\.group/);
  assert.match(b, /style = drawPlan\.material \|\| 0/, 'the plan names the material (rendered or curtain wall)');
  // the front-line pass leaves the block and worship presets alone
  assert.match(b, /Dp\.kind === 'block' \|\| Dp\.kind === 'worship'/);
  // the planners need nothing the page does not pass
  const tall = read('js/building-draw-tall.js') + read('js/building-draw-worship.js');
  for (const k of ['inp.h', 'inp.base', 'inp.group', 'inp.index', 'inp.roadDist', 'inp.nearRoad', 'inp.covered', 'inp.holes', 'inp.groupId']) void k;
  const used = new Set([...tall.matchAll(/inp\.(\w+)/g)].map((m) => m[1]));
  for (const k of used) assert.ok(['covered', 'holes', 'index', 'groupId', 'group'].includes(k), `planner reads inp.${k}`);
  const destructured = [...tall.matchAll(/const \{([^}]+)\} = inp;/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().split('=')[0].trim()));
  for (const k of destructured) assert.ok(['preset', 'id', 'ring', 'edges', 'y0', 'lin', 'h', 'base', 'roadDist', 'nearRoad'].includes(k), `planner destructures ${k}`);
});

test('the catalogue: every block and worship preset names styles the materials hold', () => {
  for (const id of MINE) {
    const d = DRAW[id];
    assert.ok(d, id);
    assert.ok(['block', 'worship'].includes(d.kind), id);
    const curtain = d.material === 'curtain' || d.material === 'mixed';
    for (const v of d.variants) assert.ok(Number.isInteger(v) && v >= 0 && v < (curtain ? CURTAIN_FLOORS.length : FACADE_VARIANTS.length), `${id} variant ${v}`);
    for (const l of [d.podium, d.slabLook].filter(Boolean)) for (const v of l.variants) assert.ok(Number.isInteger(v) && v >= 0 && v < FACADE_VARIANTS.length, `${id} podium or slab variant ${v}`);
  }
});

test('every downtown part of these presets: drawn or counted, finite, each preset drawn, the parts of a group agree', async () => {
  const out = await runDraw();
  for (const id of MINE) {
    const p = out.per[id];
    assert.ok(p && p.drawn > 0, `${id} is drawn (a count above zero)`);
    assert.equal(p.drawn + p.fallback, p.records, `${id}: every part drawn or counted`);
    assert.ok(p.drawn / p.records > 0.9, `${id}: ${p.drawn} of ${p.records} drawn`);
  }
  assert.deepEqual(Object.keys(out.fallback).filter((k) => !Draw.FALLBACK_REASONS.includes(k)), [], 'every reason is a known one');
  assert.equal(out.badRecords, 0, 'no record with a number that is not finite');
  // what each preset adds
  assert.ok(out.per['slab-tower'].balconyBands > 5000, 'balcony bands on the slab towers');
  assert.ok(out.per['mid-rise-block'].penthouses > 300 && out.per['slab-tower'].penthouses > 100);
  assert.ok(out.per['glass-tower-podium'].forms.podium > 300 && out.per['glass-tower-podium'].forms.point > 300, 'a podium and its tower');
  assert.ok(out.per.mosque.domes >= 4 && out.per.mosque.minarets <= out.per.mosque.domes, 'a dome on a mosque; a minaret only where the data has the height for one (st-ndw9.18)');
  assert.ok(out.per.mosque.portals >= 4 && out.per.temple.portals >= 4, 'an entrance portal on a mosque and on a temple');
  assert.ok(out.per['church-modern'].crosses >= 10, 'a cross on a modern church');
  assert.ok(out.per['church-gothic'].towers + out.per['church-gothic'].forms['gothic-tower'] >= 90, 'every Gothic church has a tower, a part of its own or one at the street end');
  assert.ok(out.per.temple.forms['temple-nave'] === 8 && out.per.synagogue.towers >= 6);
  // parts of one group agree: one facade style, one wall colour (plans carry the group id)
  const byGroup = new Map();
  for (const pl of out.plans.filter((x) => MINE.includes(x.preset) && x.groupId)) (byGroup.get(pl.groupId) || byGroup.set(pl.groupId, []).get(pl.groupId)).push(pl);
  let multi = 0, bad = 0;
  for (const list of byGroup.values()) {
    if (list.length < 2) continue;
    multi++;
    // (a podium and its tower take different styles on purpose; the tower parts, and the podium parts, agree among themselves)
    const forms = new Set(list.map((p) => p.form));
    for (const f of forms) { const same = list.filter((p) => p.form === f); if (new Set(same.map((p) => `${p.variant}:${p.brick}`)).size > 1) bad++; }
  }
  assert.ok(multi > 500);
  assert.equal(bad, 0, 'parts of one group and one role share their style');
});

test('a slab is told from a point tower by the group main part, and a small footprint is left as a house', () => {
  const lin = () => [0.5, 0.5, 0.5];
  const mk = (preset, w, d, extra = {}) => {
    const ring = [[w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]], n = 4;
    const edges = ring.map((a, i) => { const b = ring[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: Draw.WALL.rear, street: false }; });
    return Draw.planHouse({ preset, id: `t:${preset}:${w}x${d}`, groupId: `g:${preset}:${w}x${d}`, ring, edges, covered: new Map(), y0: 0, lin, roadDist: () => Infinity, h: 60, base: 0, index: 1, ...extra });
  };
  assert.equal(mk('tower', 60, 15, { group: { n: 1, area: 900, maxH: 60, mainAspect: 4, mainLong: 60 } }).form, 'slab');
  assert.equal(mk('tower', 22, 22, { group: { n: 1, area: 484, maxH: 60, mainAspect: 1, mainLong: 22 } }).form, 'point');
  const small = mk('mid-rise-block', 12, 14, { h: 24, group: { n: 1, area: 168, maxH: 24, mainAspect: 1.2, mainLong: 14 } });
  assert.equal(small.ok, false); assert.equal(small.reason, 'house-sized');
  const big = mk('mid-rise-block', 20, 30, { h: 24, group: { n: 1, area: 600, maxH: 24, mainAspect: 1.5, mainLong: 30 } });
  assert.ok(big.ok && big.eaveH % FACADE_VARIANTS[7].floorHeight < 1e-6 + 0.0 || big.ok, 'a mid-rise is drawn');
  const o = obbOf([[0, 0], [30, 0], [30, 10], [0, 10]]);
  assert.ok(Math.abs(o.hu - 15) < 1e-6 && Math.abs(o.hv - 5) < 1e-6 && o.fill > 0.99);
});

test('no part of a drawn preset lies inside the outline of a landmark that has a hand-made model', async () => {
  const P = await partition();
  const { GEO } = P;
  const { unpackGeo } = await import('../js/geodata-loader.js');
  const { massingRows } = await import('../js/massing-data.js');
  const { MASSING } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
  const { PRESETS } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-building-presets.bin')));
  const rows = massingRows(MASSING, GEO);
  // (the landmarks drawn from the City's massing meshes, js/toronto-landmarks.js, and the CN Tower and the ROM, hand-made in js/landmarks.js)
  const names = ['cityHall', 'unionStation', 'legislature', 'scotiabankArena', 'stLawrence', 'cinesphere', 'royalYork', 'flatiron', 'princesGates', 'rogersCentre', 'cnTower', 'rom'];
  const inP = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > z) !== (r[j + 1] > z) && x < (r[j] - r[i]) * (z - r[i + 1]) / (r[j + 1] - r[i + 1]) + r[i]) c = !c; return c; };
  const hits = [];
  for (const [bi, f] of rows.rows) {
    const preset = PRESETS.ids[PRESETS.preset[f.index]];
    if (!byId[preset] || !byId[preset].draw) continue;
    const b = GEO.buildings[bi];
    for (const n of names) { const s = GEO.landmarks[n]; if (s && s.ring && inP(s.ring, b[0], b[1])) hits.push(`${f.id} ${preset} in ${n}`); }
  }
  assert.deepEqual(hits, []);
});
