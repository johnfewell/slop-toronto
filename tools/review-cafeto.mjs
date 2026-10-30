// tools/review-cafeto.mjs: the CaféTO placement audit, and its review against the City's 2025 aerial imagery.
// Runs js/patio-layout.js in node (tools/cafeto-world.mjs), writes <out>/audit.json (every record: placed or the reason
// it was rejected) and, for the records picked, a crop of the City's 2025 8 cm orthophoto around each address with the
// game's curbs (yellow), building parts (magenta), the address point (cyan), and the patio placed (green: sidewalk café,
// orange: curb lane platform) or the rejection reason (red). Aerial crops are cached in ~/.cache/slop-toronto/raw/cafeto
// and never committed. Needs ImageMagick (`magick`).
// usage: node tools/review-cafeto.mjs <outDir> [--street "OSSINGTON AVE"]... [--type sidewalk|curb] [--placed|--rejected] [--sample N]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadPatioWorld, worldToLonLat } from './cafeto-world.mjs';

const args = process.argv.slice(2);
const OUT = path.resolve(args[0] || 'cafeto-review');
const streets = args.flatMap((a, i) => (args[i - 1] === '--street' ? [a.toUpperCase()] : []));
const sample = Number(args[args.indexOf('--sample') + 1]) || 0;
const CACHE = path.join(os.homedir(), '.cache/slop-toronto/raw/cafeto/aerial');
const SERVICE = 'https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2025_color_8cm/MapServer/export';
const HALF = 30, SIZE = 720; // metres either side of the address, pixels
const FONT = process.env.REVIEW_FONT || ['/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find((f) => fs.existsSync(f));

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });
const { CITY, deps, records } = loadPatioWorld();
const result = CITY.patioSites(records, deps);
const byId = new Map(result.sites.map((s) => [s.id, s]));
const audit = records.map((r) => {
  const s = byId.get(r.id);
  return s ? { ...r, placed: s.kind, length: s.length, depth: +s.depth.toFixed(2), along: s.along, x: +s.cx.toFixed(2), z: +s.cz.toFixed(2), yaw: +s.yaw.toFixed(4), road: s.roadName }
    : { ...r, rejected: result.reasons[r.id] };
});
fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify({ source: CITY.CAFETO.source, counts: CITY.CAFETO.counts, rejected: result.rejected, blockers: result.blockers, records: audit }, null, 1));
console.log(`[review] ${result.sites.length} placed of ${records.length}; rejected ${JSON.stringify(result.rejected)}; blockers ${JSON.stringify(result.blockers)}`);

const mercator = ([lon, lat]) => [lon * Math.PI / 180 * 6378137, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 6378137];
const frame = CITY.GEO.frame;
let picked = records.filter((r) => !streets.length || streets.some((s) => r.street.toUpperCase().replace(/STREET/, 'ST').replace(/AVENUE/, 'AVE').startsWith(s)));
const onlyType = args[args.indexOf('--type') + 1];
if (args.includes('--type')) picked = picked.filter((r) => r.type === onlyType);
if (args.includes('--placed')) picked = picked.filter((r) => byId.has(r.id));
if (args.includes('--rejected')) picked = picked.filter((r) => !byId.has(r.id));
if (sample) { // a fixed, spread sample (every k-th by licence number)
  const k = Math.max(1, Math.floor(picked.length / sample));
  picked = picked.filter((_, i) => i % k === 0).slice(0, sample);
}
if (!args.includes('--crops') && !streets.length && !sample) process.exit(0);
const tag = [...streets, onlyType && args.includes('--type') ? onlyType : '', args.includes('--placed') ? 'placed' : '', args.includes('--rejected') ? 'rejected' : ''].filter(Boolean);
const tiles = [];
for (const r of picked) {
  const centre = mercator(worldToLonLat(frame, r.x, r.z));
  const scale = 1 / Math.cos(worldToLonLat(frame, r.x, r.z)[1] * Math.PI / 180), d = HALF * scale;
  const file = path.join(CACHE, `${r.id.replace(/[^\w-]/g, '_')}.jpg`);
  if (!fs.existsSync(file)) {
    const url = `${SERVICE}?bbox=${centre[0] - d},${centre[1] - d},${centre[0] + d},${centre[1] + d}&bboxSR=3857&imageSR=3857&size=${SIZE},${SIZE}&format=jpg&f=image`;
    const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) { console.warn(`[review] ${r.id}: HTTP ${res.status}`); continue; }
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    fs.writeFileSync(file + '.url', url);
  }
  const px = (x, z) => {
    const [mx, my] = mercator(worldToLonLat(frame, x, z));
    return [((mx - (centre[0] - d)) / (2 * d)) * SIZE, (((centre[1] + d) - my) / (2 * d)) * SIZE].map((v) => v.toFixed(1)).join(',');
  };
  const draw = [];
  const within = (x, z) => Math.abs(x - r.x) < HALF * 1.6 && Math.abs(z - r.z) < HALF * 1.6;
  for (const b of CITY.BLOCKS) {
    if (b.maxX < r.x - HALF * 1.5 || b.minX > r.x + HALF * 1.5 || b.maxZ < r.z - HALF * 1.5 || b.minZ > r.z + HALF * 1.5) continue;
    draw.push('-fill', 'none', '-stroke', 'yellow', '-strokewidth', '2', '-draw', `polygon ${b.poly.map((p) => px(p.x, p.z)).join(' ')}`);
  }
  for (const [cx, cz, ang, parts, h] of CITY.GEO.buildings) {
    if (!within(cx, cz) || !(h > 2)) continue;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    for (const [u0, u1, v0, v1] of parts) {
      const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => px(cx + u * cs + v * sn, cz - u * sn + v * cs));
      draw.push('-fill', 'none', '-stroke', 'magenta', '-strokewidth', '1', '-draw', `polygon ${corners.join(' ')}`);
    }
  }
  const s = byId.get(r.id);
  if (s) {
    const q = s.rect, corner = (a, b) => px(q.cx + q.tx * a * q.hl + q.nx * b * q.hd, q.cz + q.tz * a * q.hl + q.nz * b * q.hd);
    draw.push('-fill', s.kind === 'curb' ? '#ff8c0080' : '#00ff4080', '-stroke', s.kind === 'curb' ? '#ff8c00' : '#00ff40', '-strokewidth', '2',
      '-draw', `polygon ${corner(-1, -1)} ${corner(1, -1)} ${corner(1, 1)} ${corner(-1, 1)}`);
  }
  const [ax, ay] = px(r.x, r.z).split(',');
  draw.push('-fill', 'cyan', '-stroke', 'black', '-strokewidth', '1', '-draw', `circle ${ax},${ay} ${+ax + 5},${ay}`);
  const label = `${r.address} (${r.type})\\n${s ? `placed ${s.kind} ${s.length}x${s.depth.toFixed(1)} m` : `rejected: ${result.reasons[r.id]}`}`;
  draw.push(...(FONT ? ['-font', FONT] : []), '-stroke', 'none', '-fill', s ? 'white' : '#ff4040', '-undercolor', '#000000a0', '-pointsize', '18', '-annotate', '+8+24', label);
  const tile = path.join(OUT, `${r.id.replace(/[^\w-]/g, '_')}.jpg`);
  execFileSync('magick', [file, ...draw, '-quality', '82', tile]);
  tiles.push(tile);
}
if (tiles.length) {
  const name = [...tag, sample ? `sample-${sample}` : ''].filter(Boolean).join('_').replace(/[^\w]+/g, '-').toLowerCase();
  for (let i = 0; i < tiles.length; i += 12) {
    const sheet = path.join(OUT, `sheet-${name}-${i / 12 + 1}.jpg`);
    execFileSync('magick', ['montage', ...(FONT ? ['-font', FONT] : []), ...tiles.slice(i, i + 12), '-tile', '4x3', '-geometry', '480x480+4+4', '-background', '#222', sheet]);
    console.log(`[review] ${sheet}`);
  }
}
