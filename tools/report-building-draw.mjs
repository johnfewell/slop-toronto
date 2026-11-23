// tools/report-building-draw.mjs — st-ndw9.13: runs the house presets' drawing rule (js/building-draw.js) over every
// downtown building the way js/buildings.js does (the same footprintEdges, the same shop-front rule, the same inputs from
// the committed presets and groups files), counts what it draws and what falls back and why, and what it adds to the cell
// meshes (near-tier triangles per 500 m cell) and to the roof batch. Reads committed data only.
//
// usage: node tools/report-building-draw.mjs [--json <path>]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { partition } from './report-building-forms.mjs';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import { drawFactsFrom } from '../js/building-presets.js';
import * as BP from '../js/building-prototypes.js';
import * as Draw from '../js/building-draw.js';
import * as MC from '../js/massing-cells.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WALL_KINDS = Draw.WALL;
const lin = (hex) => { // sRGB hex -> linear rgb, as THREE.Color does
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
};

function loadBuildingsJs(GEO, nearestRoads) {
  const stub = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/toronto-storefronts.js'), 'utf8'), { window: stub });
  const window = { CITY: { THREE: {}, Addons: {}, TSL: {}, GEO, CITY_BOUNDS: {}, nearestRoads, STOREFRONTS: stub.CITY.STOREFRONTS, WALL_KINDS } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/buildings.js'), 'utf8'), { window, console });
  return window.CITY;
}

const quantile = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };

/** Every drawn-preset building through planHouse, as the page does it; and the cell-mesh triangles with and without. */
export async function runDraw({ partitioned, cells = true, snap = true, snapArgs = [] } = {}) {
  const P = partitioned || await partition();
  const { GEO, nearestRoads } = P;
  const { MASSING } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
  const rows = massingRows(MASSING, GEO);
  const { PRESETS } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-building-presets.bin')));
  const { DEBUG } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-building-presets-debug.bin')));
  for (const rec of rows.rows.values()) rec.preset = PRESETS.ids[PRESETS.preset[rec.index]];
  const F = drawFactsFrom(DEBUG, rows, GEO, PRESETS);
  const C = loadBuildingsJs(GEO, nearestRoads);
  const retail = C.storefrontSelection(GEO.pois), signWalls = C.signedWalls();
  const per = {}, fallback = {}, parts = { bays: 0, porches: 0, dormers: 0, gables: 0, bargeboards: 0, wings: 0, vestibules: 0, stoops: 0, garages: 0, pictureWindows: 0, timbered: 0, crossGables: 0, parapets: 0, cornices: 0 , balconyBands: 0, penthouses: 0, crowns: 0, towers: 0, spires: 0, domes: 0, minarets: 0, portals: 0, crosses: 0, pointed: 0, signs: 0, sills: 0, lintels: 0, columns: 0, detailTris: 0, bandsHidden: 0 };
  const base = [], drawn = [], plans = [], fallbackIds = {}, fallbackDetail = {};
  let roofTris = 0, extras = 0, viaRoad = 0, out_far = null;
  const out_far2 = {}; // (roof triangles by form: the full roof and the far one, st-ndw9.21)
  // first pass (as js/buildings.js does): every drawn house of a group planned with no shift, the runs' median front lines from it
  let shifts = null, snapStats = null;
  if (snap) {
    const first = [];
    for (const [bi, foot] of rows.rows) {
      if (!BP.byId[foot.preset] || !BP.byId[foot.preset].draw || ['shop', 'block', 'worship'].includes(BP.byId[foot.preset].draw.kind)) continue;
      const facts = F.facts.get(foot.index);
      if (!facts) continue;
      const b = GEO.buildings[bi], h = b[4], kind = b[5], signed = signWalls.get(bi);
      const { front, near } = C.buildingFront(b[0], b[1], b[2], signed, nearestRoads);
      const shop = C.shopFrontRule({ signed, own: retail.own.has(bi), kind, front, parts: b[3], cx: b[0], cz: b[1], ang: b[2], near, retail, nearestRoads });
      const fr = C.footprintEdges(foot.rings[0], foot.covered, foot.hidden, foot.street, shop.shopFront ? WALL_KINDS.shop : WALL_KINDS.entry, shop.shopFront, Math.min(foot.base, h - 0.5), h);
      const plan = Draw.planHouse({ preset: foot.preset, id: foot.id, groupId: facts.groupId, dwellings: facts.dwellings, ring: foot.rings[0], edges: fr.edges, covered: foot.covered, y0: 0, lin,
        roadDist: (x, z) => { const r = nearestRoads(x, z, 40)[0]; return r ? r.dist : Infinity; }, nearRoad: near.length ? { x: near[0].px, z: near[0].pz } : null, frameOnly: process.env.FRAME_ONLY === '1' });
      if (plan.ok && plan.frame) first.push({ id: foot.id, groupId: facts.groupId, A: plan.frame.A, t: plan.frame.t, u0: plan.frame.u0, u1: plan.frame.u1, z1: plan.frame.z1, edge: plan.frame.edge });
    }
    const sn = Draw.snapFronts(first, ...snapArgs);
    shifts = sn.shifts; snapStats = { runs: sn.runs, snapped: sn.snapped, steps: sn.steps, depthSet: sn.depthSet, depthRuns: sn.depthRuns, depthSteps: sn.depthSteps, cuts: sn.cuts, carried: sn.carried };
    if (process.env.FRAME_DUMP) fs.writeFileSync(process.env.FRAME_DUMP, JSON.stringify({ first, shifts: [...shifts] }));
  }
  for (const [bi, foot] of rows.rows) {
    const b = GEO.buildings[bi];
    const h = b[4], kind = b[5];
    const signed = signWalls.get(bi);
    const { front, near } = C.buildingFront(b[0], b[1], b[2], signed, nearestRoads);
    const shop = C.shopFrontRule({ signed, own: retail.own.has(bi), kind, front, parts: b[3], cx: b[0], cz: b[1], ang: b[2], near, retail, nearestRoads });
    const shopFront = shop.shopFront;
    const fr = C.footprintEdges(foot.rings[0], foot.covered, foot.hidden, foot.street, shopFront ? WALL_KINDS.shop : WALL_KINDS.entry, shopFront, Math.min(foot.base, h - 0.5), h);
    const rec0 = {
      cx: b[0], cz: b[1], style: 0, variant: 0, rings: foot.rings, base: Math.min(foot.base, h - 0.5), h, kinds: fr.kinds,
      cover: foot.rings[0].map((_, i) => (foot.covered.has(i) ? foot.covered.get(i) : NaN)), capY: h - 0.05, tone: 0.5, seed: 0, paint: [0.5, 0.4, 0.3, 2.5], boxes: []
    };
    base.push(rec0);
    const preset = foot.preset;
    if (!BP.byId[preset] || !BP.byId[preset].draw) { drawn.push(rec0); continue; }
    const facts = F.facts.get(foot.index);
    const plan = Draw.planHouse({
      preset, id: foot.id, groupId: facts && facts.groupId, dwellings: facts ? facts.dwellings : 1, ring: foot.rings[0], edges: fr.edges, covered: foot.covered, y0: 0, lin,
      holes: foot.rings.length - 1, frontShift: shifts ? shifts.get(foot.id) : undefined,
      h, style: 0, variant: kind === 2 ? 1 : 0, // (the curtain-wall styles a mid-rise may draw are not modelled here: a few shops more drawn than the page draws)
      index: foot.index, base: Math.min(foot.base, h - 0.5), group: facts && facts.group,
      roadDist: (x, z) => { const r = nearestRoads(x, z, 40)[0]; return r ? r.dist : Infinity; },
      nearRoad: near.length ? { x: near[0].px, z: near[0].pz } : null
    });
    const p = per[preset] || (per[preset] = { records: 0, drawn: 0, fallback: 0, N: {}, forms: {}, ...Object.fromEntries(Object.keys(parts).map((k) => [k, 0])) });
    const fbId = (fallbackIds[preset] ||= []);
    p.records++;
    if (!plan.ok) { fbId.push(foot.id); (fallbackDetail[preset] ||= []).push({ id: foot.id, reason: plan.reason, detail: plan.detail }); p.fallback++; fallback[plan.reason] = (fallback[plan.reason] || 0) + 1; (p.reasons ||= {})[plan.reason] = (p.reasons[plan.reason] || 0) + 1; drawn.push(rec0); continue; }
    p.drawn++;
    p.N[plan.stats.N] = (p.N[plan.stats.N] || 0) + 1;
    p.forms[plan.form] = (p.forms[plan.form] || 0) + 1;
    const A = { pos: [], nor: [], uv: [], col: [] };
    const fullN = plan.pushRoof(A);
    roofTris += fullN;
    { const far = plan.pushRoof({ pos: [], nor: [], uv: [], col: [] }, !!plan.lodRoof); const e = (out_far2[plan.form] ||= { n: 0, full: 0, far: 0 }); e.n++; e.full += fullN; e.far += far; }
    for (const k of Object.keys(parts)) { parts[k] += plan.stats[k] || 0; p[k] += plan.stats[k] || 0; }
    if (plan.stats.viaRoad) viaRoad++;
    plans.push({ roofForm: plan.stats.roofForm, fitsGable: plan.stats.fitsGable, cx: b[0], cz: b[1], id: foot.id, groupId: facts && facts.groupId, preset, form: plan.form, N: plan.stats.N, variant: plan.variant, brick: plan.brickHex, tris: A.pos.length / 9, frame: plan.frame || null, w: plan.frame ? plan.frame.u1 - plan.frame.u0 : 0, d: plan.frame ? plan.frame.z1 : 0, storeys: plan.stats.storeys, h: b[4], wings: plan.stats.wings || 0, stats: plan.stats, roof: plan.stats.roofInfo || null, detail: plan.stats.detailTris || 0, sills: plan.stats.sills || 0, columns: plan.stats.columns || 0 });
    drawn.push({ ...rec0, rings: plan.keep ? foot.rings : [plan.ring, ...foot.rings.slice(1)], kinds: plan.kinds, cover: plan.cover, variant: plan.variant, h: plan.eaveH, capY: plan.eaveH - 0.05 });
    for (const r of plan.records.concat([{ rings: [plan.ring], kind: 'main' }])) {
      if (process.env.DRAW_SKIP && process.env.DRAW_SKIP.split(',').includes(r.kind)) continue;
      for (const [x, z] of r.rings[0]) { const dd = Math.hypot(x - b[0], z - b[1]); if (dd > 60) (out_far ||= []).push({ id: foot.id, preset, kind: r.kind, dd }); }
      if (r.kind === 'main') continue;
      drawn.push({ cx: b[0], cz: b[1], style: 0, variant: r.variant, rings: r.rings, base: r.base, h: r.h, kinds: r.kinds, cover: r.cover, capY: r.capY, tone: 0.5, seed: 0, paint: [0.5, 0.4, 0.3, 2.5], boxes: [], nearOnly: r.nearOnly !== false });
      extras++;
    }
  }
  const out = { roofByForm: out_far2, snap: snapStats, far: out_far, fallbackIds, fallbackDetail, records: rows.rows.size, drawnRecords: Object.values(per).reduce((s, p) => s + p.drawn, 0), per, fallback, parts, roofTris, extras, viaRoad, plans };
  if (cells) {
    const near = (recs) => {
      const built = MC.buildMassingCells(MC.packInput(recs));
      const byCell = new Map();
      for (const blk of built.blocks) {
        const t = blk.tiers[0];
        for (let s = 0; s < 4; s++) {
          const k = MC.TIER_ORDER.indexOf(s);
          const key = `${blk.bx * 2 + (k & 1)},${blk.bz * 2 + (k >> 1)}`;
          byCell.set(key, (byCell.get(key) || 0) + t.ranges[s * 2 + 1] / 3);
        }
      }
      return { byCell, stats: built.stats, blocks: built.blocks.length, meshes: built.blocks.length };
    };
    const badRec = drawn.filter((r) => ![r.h, r.capY, r.base, r.cx, r.cz].every(Number.isFinite) || r.rings[0].some(([x, z]) => !Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x - r.cx, z - r.cz) > 400) || (r.cover && r.cover.length !== r.rings[0].length) || r.kinds.length !== r.rings[0].length);
    out.badRecords = badRec.length; out.badSample = badRec.slice(0, 3).map((r) => ({ cx: r.cx, cz: r.cz, h: r.h, capY: r.capY, n: r.rings[0].length, k: r.kinds.length, c: r.cover && r.cover.length }));
    const a = near(base), b = near(drawn);
    const ratios = [], added = [];
    let worst = null;
    for (const [k, v] of a.byCell) { const w = b.byCell.get(k) || 0; if (v > 0) ratios.push(w / v); added.push(w - v); if (v > 0 && (!worst || w / v > worst.ratio)) worst = { cell: k, base: v, drawn: w, ratio: w / v }; }
    out.cells = {
      baseTriangles: [...a.byCell.values()].reduce((s, v) => s + v, 0), drawnTriangles: [...b.byCell.values()].reduce((s, v) => s + v, 0),
      cellCount: a.byCell.size, addedMedian: quantile(added, 0.5), addedP90: quantile(added, 0.9), addedMax: Math.max(...added), ratioMedian: quantile(ratios, 0.5), ratioMax: Math.max(...ratios), ratioMaxBig: Math.max(...[...a.byCell].filter(([, v]) => v >= 100).map(([k, v]) => (b.byCell.get(k) || 0) / v)), worst, cellBase: [...a.byCell.values()], cellDrawn: [...a.byCell.keys()].map((k) => b.byCell.get(k) || 0),
      tiers: { base: a.stats.tiers.map((t) => ({ name: t.name, triangles: t.triangles })), drawn: b.stats.tiers.map((t) => ({ name: t.name, triangles: t.triangles })) },
      blocksBase: a.blocks, blocksDrawn: b.blocks
    };
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { json: { type: 'string' } } });
  const out = await runDraw();
  const { plans, fallbackIds, fallbackDetail, ...rest } = out;
  console.log(JSON.stringify(rest, null, 1));
  if (values.json) fs.writeFileSync(values.json, JSON.stringify(out));
}
