// tools/report-massing.mjs — how far today's boxes (GEO.buildings' L/T/U parts) are from the City's 3D Massing outlines
// in data/toronto-massing.bin (tools/build-massing.mjs), city-wide, and which rows the sidecar skips and why
// (docs/massing-buildings.md, "Box fit city-wide"). Needs no raw data.
// Per building: the polygon (outer ring less its courtyards) against the union of the box parts buildings.js draws
// (sides of 1 m or more), integrated over scan lines every 0.1 m: intersection over union, the box area outside the
// polygon (overshoot onto lanes, yards and neighbours) and the polygon area no box covers.
// usage: node tools/report-massing.mjs [--json out.json] [--worst 10]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { values: opt } = parseArgs({ options: { json: { type: 'string' }, worst: { type: 'string', default: '10' } } });
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata.js'), 'utf8'), ctx);
const { GEO } = ctx.window.CITY;
const { MASSING: M } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
const loaded = massingRows(M, GEO);
if (loaded.error) throw new Error(loaded.error);

const DZ = 0.1;
// [x0, x1] spans where the scan line z is inside the rings (even-odd: courtyards are out)
function spans(rings, z) {
  const xs = [];
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, az] = r[j], [bx, bz] = r[i];
    if ((az > z) !== (bz > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}
const union = (list) => {
  list.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const s of list) if (out.length && s[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], s[1]); else out.push(s.slice());
  return out;
};
const len = (list) => list.reduce((s, [a, b]) => s + b - a, 0);
function overlap(A, B) {
  let i = 0, j = 0, s = 0;
  while (i < A.length && j < B.length) {
    const lo = Math.max(A[i][0], B[j][0]), hi = Math.min(A[i][1], B[j][1]);
    if (hi > lo) s += hi - lo;
    if (A[i][1] < B[j][1]) i++; else j++;
  }
  return s;
}
// (GEO.buildings' kind, tools/geo-features.mjs)
const KIND = ['house', 'low-rise', 'mid-rise', 'tower', 'shed', 'construction', 'church', 'civic'];

const per = [];
for (const [row, r] of loaded.rows) {
  const [cx, cz, ang, parts, , kind] = GEO.buildings[row];
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const boxes = parts.filter(([u0, u1, v0, v1]) => u1 - u0 >= 1 && v1 - v0 >= 1).map(([u0, u1, v0, v1]) =>
    [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [cx + u * cs + v * sn, cz - u * sn + v * cs]));
  let z0 = Infinity, z1 = -Infinity;
  for (const ring of [r.rings[0], ...boxes]) for (const [, z] of ring) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  let inter = 0, poly = 0, box = 0;
  for (let z = Math.floor(z0 / DZ) * DZ + DZ / 2; z < z1; z += DZ) {
    const A = spans(r.rings, z), B = union(boxes.flatMap((b) => spans([b], z)));
    const a = len(A), b = len(B), o = overlap(A, B);
    poly += a; box += b; inter += o;
  }
  poly *= DZ; box *= DZ; inter *= DZ;
  per.push({ id: r.id, row, kind: KIND[kind] || String(kind), parts: boxes.length, poly, box, iou: inter / (poly + box - inter), over: box - inter, missed: poly - inter, corners: r.rings[0].length });
}
const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const summary = (list) => ({
  buildings: list.length,
  iou: { p10: +q(list.map((x) => x.iou), 0.1).toFixed(3), median: +q(list.map((x) => x.iou), 0.5).toFixed(3), p90: +q(list.map((x) => x.iou), 0.9).toFixed(3), min: +Math.min(...list.map((x) => x.iou)).toFixed(3) },
  under: { '0.5': list.filter((x) => x.iou < 0.5).length, '0.8': list.filter((x) => x.iou < 0.8).length, '0.9': list.filter((x) => x.iou < 0.9).length },
  areaRatio: { median: +q(list.map((x) => x.box / x.poly - 1), 0.5).toFixed(3), p90: +q(list.map((x) => x.box / x.poly - 1), 0.9).toFixed(3) },
  m2: { polygons: Math.round(sum(list, (x) => x.poly)), boxes: Math.round(sum(list, (x) => x.box)), boxesOutside: Math.round(sum(list, (x) => x.over)), polygonUncovered: Math.round(sum(list, (x) => x.missed)) },
  overshootOver1m2: list.filter((x) => x.over > 1).length,
  corners: { median: q(list.map((x) => x.corners), 0.5), p90: q(list.map((x) => x.corners), 0.9), max: Math.max(...list.map((x) => x.corners)) }
});
const report = {
  all: summary(per),
  byKind: Object.fromEntries([...new Set(per.map((x) => x.kind))].sort().map((k) => [k, summary(per.filter((x) => x.kind === k))])),
  byParts: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, per.filter((x) => (n === 5 ? x.parts >= 5 : x.parts === n))]).filter(([, l]) => l.length).map(([n, l]) => [n, summary(l)])),
  worst: per.filter((x) => x.poly > 50).sort((a, b) => a.iou - b.iou).slice(0, Number(opt.worst)).map((x) => ({ id: x.id, row: x.row, kind: x.kind, iou: +x.iou.toFixed(3), poly: Math.round(x.poly), box: Math.round(x.box), at: GEO.buildings[x.row].slice(0, 2) })),
  skipped: M.skipRow.map((row, i) => ({ row, id: `${M.dataset}:${row}`, why: M.reasons[M.skipWhy[i]], at: GEO.buildings[row].slice(0, 2) })),
  rejectedAtLoad: loaded.rejected
};
// (the skip's durable ID is that of its row)
const ids = (() => { const c = { window: {} }; vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata-ids.js'), 'utf8'), c); return c.window.CITY.GEO_IDS; })();
for (const s of report.skipped) s.id = ids.buildings[s.row];
if (opt.json) fs.writeFileSync(path.resolve(opt.json), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ all: report.all, byKind: Object.fromEntries(Object.entries(report.byKind).map(([k, v]) => [k, { n: v.buildings, iou: v.iou, under: v.under, areaRatio: v.areaRatio }])) }, null, 1));
console.log('by box parts', JSON.stringify(Object.fromEntries(Object.entries(report.byParts).map(([k, v]) => [k, { n: v.buildings, iou: v.iou.median, p10: v.iou.p10 }]))));
console.log('worst', JSON.stringify(report.worst));
console.log('skipped', JSON.stringify(report.skipped.reduce((m, s) => ((m[s.why] = (m[s.why] || 0) + 1), m), {})), 'rejected at load', loaded.rejected);
