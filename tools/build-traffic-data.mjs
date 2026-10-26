// tools/build-traffic-data.mjs: the City of Toronto's own signals, crosswalks & traffic counts for the street life,
// written to js/toronto-traffic-data.js (window.CITY.TRAFFIC_DATA). Open Government Licence - Toronto (CREDITS.md).
// usage: node tools/fetch-opendata.mjs && node tools/build-traffic-data.mjs   (OPENDATA=<folder> as for the fetch)
// then:  node tools/build-signal-plan.mjs   (the junctions change with the signals: their green-wave offsets)
//
// - signals: every City traffic signal in the detail area (Traffic Signals Tabular), with its PX number, its mode of
//   control (fixed time, semi-actuated, mid-block pedestrian signal, intersection pedestrian signal...), the walking
//   speed its pedestrian clearance is timed for, which crosswalks have a leading pedestrian interval, and its 8 peak
//   hour vehicle & pedestrian volumes (Traffic Signal Vehicle and Pedestrian Volumes)
// - crosswalks: the crossings of the Pedestrian Network, each a line across the road (centre, direction, length) with
//   the PX of the signal or crossover it belongs to
// - pxo: the pedestrian crossovers (Traffic Signals Tabular), each on its crossing's line where the network has it
// - links: a daily two-way vehicle volume for every street of the road graph (GEO.roadGraph.links): the midblock counts
//   (Speed, Volume & Classification) and the intersection counts' approach volumes (Turning Movement Counts) on the
//   streets they were counted on, carried along the same street to the next count, else the median count of streets of
//   its class
// - turns: the share turning left, going straight & turning right on each counted approach (TMC raw 15-minute data)
// - hours: the share of a day's vehicles & pedestrians in each hour (TMC raw for 6-20 h, the midblock counts' 15-minute
//   volumes round the clock)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RAW = process.env.OPENDATA || path.join(os.homedir(), '.cache/slop-toronto/opendata');
const OUT = process.env.TRAFFIC_DATA_OUT || path.join(ROOT, 'js/toronto-traffic-data.js');
const t0 = Date.now();
const log = (...a) => console.log('[traffic-data]', ...a);

const ctx = vm.createContext({ window: { CITY: {} }, console });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata.js'), 'utf8'), ctx);
const GEO = ctx.window.CITY.GEO;
const P = GEO.frame.projection;
function world(lat, lon) {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
  const c = Math.cos(P.theta), s = Math.sin(P.theta);
  return { x: e * c - n * s - P.ox, z: -(e * s + n * c) - P.oz };
}
const D = GEO.frame.detail, MARGIN = 150;
const inArea = (p) => p.x > D.x0 - MARGIN && p.x < D.x1 + MARGIN && p.z > D.z0 - MARGIN && p.z < D.z1 + MARGIN;
const q = (v) => Math.round(v * 10) / 10;
const RG = GEO.roadGraph;

// --- readers ---
function csv(file) {
  const text = fs.readFileSync(path.join(RAW, file), 'utf8').replace(/^﻿/, '');
  const rows = [];
  let row = [], cur = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
}
// a streamed CSV (the raw counts are big): calls fn(row) per line, columns by header
function csvLines(file, fn) {
  const text = fs.readFileSync(path.join(RAW, file), 'utf8').replace(/^﻿/, '');
  let start = text.indexOf('\n');
  const head = text.slice(0, start).replace(/\r$/, '').split(',').map((h) => h.replace(/^"|"$/g, ''));
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  for (start++; start < text.length;) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end).replace(/\r$/, '');
    start = end + 1;
    if (!line) continue;
    fn(line.indexOf('"') < 0 ? line.split(',') : splitQuoted(line), col);
  }
}
function splitQuoted(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false; } else cur += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
// the first sheet of an .xlsx as rows of cells (by column letter)
function xlsx(file) {
  const buf = fs.readFileSync(path.join(RAW, file));
  const entries = new Map();
  // central directory
  let eocd = buf.length - 22;
  while (eocd > 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(off + 26), lxlen = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    entries.set(name, () => (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8'));
    p += 46 + nlen + xlen + clen;
  }
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const shared = [...(entries.get('xl/sharedStrings.xml')?.() || '').matchAll(/<si>([^]*?)<\/si>/g)]
    .map((m) => unesc([...m[1].matchAll(/<t[^>]*>([^]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const sheet = entries.get('xl/worksheets/sheet1.xml')();
  return [...sheet.matchAll(/<row[^>]*>([^]*?)<\/row>/g)].map((r) => {
    const cells = {};
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([^]*?)<\/c>)/g)) {
      const v = (c[3] || '').match(/<v>([^]*?)<\/v>/);
      let val = v ? v[1] : '';
      if (/t="s"/.test(c[2]) && val) val = shared[+val];
      cells[c[1]] = unesc(val);
    }
    return cells;
  });
}

// --- street names: the City's ("KING ST W", "King St W") and OpenStreetMap's ("King Street West") alike ---
const ABBR = { STREET: 'ST', AVENUE: 'AVE', AV: 'AVE', BOULEVARD: 'BLVD', ROAD: 'RD', DRIVE: 'DR', CRESCENT: 'CRES', COURT: 'CRT', PLACE: 'PL', PARKWAY: 'PKWY', GARDENS: 'GDNS', SQUARE: 'SQ', TERRACE: 'TER', CIRCLE: 'CIR', TRAIL: 'TRL', GROVE: 'GRV', HEIGHTS: 'HTS', EXPRESSWAY: 'XY', QUAY: 'QUAY', WEST: 'W', EAST: 'E', NORTH: 'N', SOUTH: 'S', SAINT: 'ST' };
function norm(s) {
  const t = String(s || '').toUpperCase().replace(/[.']/g, '').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map((w) => ABBR[w] || w);
  while (t.length > 1 && /^(E|W|N|S)$/.test(t[t.length - 1])) t.pop(); // the street, not its east or west half
  return t.join(' ');
}

// --- the road graph: nodes, their links, each link's midpoint & direction ---
const NN = RG.nodes.length / 2;
const nodeLinks = Array.from({ length: NN }, () => []);
RG.links.forEach((l, i) => { nodeLinks[l[0]].push(i); nodeLinks[l[1]].push(i); });
const linkInfo = RG.links.map((l, i) => {
  const pts = [RG.nodes[2 * l[0]], RG.nodes[2 * l[0] + 1], ...l[6], RG.nodes[2 * l[1]], RG.nodes[2 * l[1] + 1]];
  let len = 0;
  for (let k = 0; k + 2 < pts.length; k += 2) len += Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
  // midpoint along the polyline
  let half = len / 2, mx = pts[0], mz = pts[1];
  for (let k = 0; k + 2 < pts.length; k += 2) {
    const sl = Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
    if (half <= sl) { mx = pts[k] + (pts[k + 2] - pts[k]) * half / (sl || 1); mz = pts[k + 1] + (pts[k + 3] - pts[k + 1]) * half / (sl || 1); break; }
    half -= sl;
  }
  return { i, pts, len, mx, mz, name: norm(RG.names[l[2]]), rank: l[7] || 0, dir: l[5], raised: !!l[8] };
});
// segments in 50 m cells, for the nearest link to a point
const CELL = 50;
const segCells = new Map();
for (const L of linkInfo) {
  for (let k = 0; k + 2 < L.pts.length; k += 2) {
    const key = Math.floor((L.pts[k] + L.pts[k + 2]) / 2 / CELL) * 100000 + Math.floor((L.pts[k + 1] + L.pts[k + 3]) / 2 / CELL);
    (segCells.get(key) || segCells.set(key, []).get(key)).push([L.pts[k], L.pts[k + 1], L.pts[k + 2], L.pts[k + 3], L.i]);
  }
}
// links within r of (x, z), nearest first: [{ i, d, ux, uz }] (ux, uz: the segment's direction)
function linksNear(x, z, r) {
  const best = new Map();
  const c = Math.ceil(r / CELL);
  for (let a = -c; a <= c; a++) for (let b = -c; b <= c; b++) {
    for (const [x0, z0, x1, z1, i] of segCells.get((Math.floor(x / CELL) + a) * 100000 + Math.floor(z / CELL) + b) || []) {
      const ex = x1 - x0, ez = z1 - z0, L2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - x0) * ex + (z - z0) * ez) / L2));
      const d = Math.hypot(x0 + ex * t - x, z0 + ez * t - z);
      if (d <= r && (!best.has(i) || d < best.get(i).d)) {
        const L = Math.sqrt(L2);
        best.set(i, { i, d, ux: ex / L, uz: ez / L, px: x0 + ex * t, pz: z0 + ez * t });
      }
    }
  }
  return [...best.values()].sort((p, q2) => p.d - q2.d);
}
// junction nodes (3 or more links) near a point
const junctionNodes = [];
for (let n = 0; n < NN; n++) if (nodeLinks[n].length >= 3) junctionNodes.push(n);
const nodeCells = new Map();
for (const n of junctionNodes) {
  const key = Math.floor(RG.nodes[2 * n] / CELL) * 100000 + Math.floor(RG.nodes[2 * n + 1] / CELL);
  (nodeCells.get(key) || nodeCells.set(key, []).get(key)).push(n);
}
function nearestJunction(x, z, r) {
  let best = -1, bd = r;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    for (const n of nodeCells.get((Math.floor(x / CELL) + a) * 100000 + Math.floor(z / CELL) + b) || []) {
      const d = Math.hypot(RG.nodes[2 * n] - x, RG.nodes[2 * n + 1] - z);
      if (d < bd) { bd = d; best = n; }
    }
  }
  return best;
}
// a node's arms: [{ link, ux, uz }] pointing away from it
function armsOf(n) {
  const x = RG.nodes[2 * n], z = RG.nodes[2 * n + 1];
  return nodeLinks[n].map((li) => {
    const L = linkInfo[li];
    const atA = RG.links[li][0] === n;
    const ox = atA ? L.pts[2] : L.pts[L.pts.length - 4], oz = atA ? L.pts[3] : L.pts[L.pts.length - 3];
    const d = Math.hypot(ox - x, oz - z) || 1;
    return { link: li, ux: (ox - x) / d, uz: (oz - z) / d, atA };
  });
}
// grid compass (the street grid's north is world -z): north, east, south, west unit vectors
const COMPASS = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

// =====================================================================================================================
// 1. Signals, crossovers & beacons (Traffic Signals Tabular)
// =====================================================================================================================
const MODES = { FT: 0, SAP: 1, SA1: 2, SA2: 3, SAV: 4, FA: 5, 'PA - MPS': 6, 'PA - IPS': 7 };
const MODE_NAMES = ['fixed', 'semi-actuated (no extensions)', 'semi-actuated', 'semi-actuated (ped buttons)', 'semi-actuated (no peds)', 'fully actuated', 'midblock pedestrian', 'intersection pedestrian'];
const SYSTEMS = { TransSuite: 0, SCOOT: 1, SCATS: 2 };
const sigGeo = JSON.parse(fs.readFileSync(path.join(RAW, 'traffic-signal-4326.geojson'), 'utf8'));
const pxNum = (s) => parseInt(String(s).replace(/^0+/, '') || '0', 10);
const signals = [];
for (const f of sigGeo.features) {
  const pr = f.properties;
  const [lon, lat] = f.geometry.coordinates[0];
  const p = world(lat, lon);
  if (!inArea(p)) continue;
  const lpi = ['NORTH', 'SOUTH', 'EAST', 'WEST'].reduce((m, d, k) => m | (pr[`LPI_${d}_IMPLEMENTATION_DATE`] && pr[`LPI_${d}_IMPLEMENTATION_DATE`] !== 'None' && !/removed/i.test(pr.LPI_COMMENT || '') ? 1 << k : 0), 0);
  const speed = parseFloat(String(pr.PEDWALKSPEED || '').match(/^([\d.]+) m\/s/)?.[1] || '1.0');
  const fdwAt = parseFloat(String(pr.PEDWALKSPEED || '').match(/@ ?([\d.]+) ?m\/s/)?.[1] || '1.2');
  signals.push({
    x: q(p.x), z: q(p.z), px: pxNum(pr.PX), mode: MODES[pr.CONTROL_MODE] ?? 2, sys: SYSTEMS[pr.SIGNALSYSTEM] ?? 0,
    lpi, speed, fdwAt, main: pr.MAIN_STREET, side: pr.SIDE1_STREET, midblock: pr.MIDBLOCK_ROUTE !== 'None' ? pr.MIDBLOCK_ROUTE : '',
    approaches: parseInt(pr.NUMBEROFAPPROACHES, 10) || 0, transit: pr.TRANSIT_PREEMPT ? 1 : 0, bike: pr.BICYCLE_SIGNAL ? 1 : 0, aps: pr.AUDIBLEPEDSIGNAL === '1.0' ? 1 : 0
  });
}
const byPx = new Map(signals.map((s) => [s.px, s]));
// the road graph's junction nodes each signal controls: within 12 m of where the City puts it, or within 32 m on the
// streets it names (both carriageways of a divided road); else the nearest junction within 45 m. A node two signals
// would both take goes to the nearer. (A midblock pedestrian signal controls no junction.)
const pinOf = new Map();
for (const s of signals) {
  if (s.mode === 6) { s.pins = []; continue; }
  const names = new Set([norm(s.main), norm(s.side)]);
  const cand = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    for (const n of nodeCells.get((Math.floor(s.x / CELL) + a) * 100000 + Math.floor(s.z / CELL) + b) || []) {
      const d = Math.hypot(RG.nodes[2 * n] - s.x, RG.nodes[2 * n + 1] - s.z);
      const named = nodeLinks[n].some((li) => names.has(linkInfo[li].name));
      if (d < 12 || (named && d < 32)) cand.push({ n, d });
    }
  }
  if (!cand.length) {
    const n = nearestJunction(s.x, s.z, 45);
    if (n >= 0) cand.push({ n, d: Math.hypot(RG.nodes[2 * n] - s.x, RG.nodes[2 * n + 1] - s.z) });
  }
  s.pins = cand;
  for (const c of cand) if (!pinOf.has(c.n) || pinOf.get(c.n).d > c.d) pinOf.set(c.n, { s, d: c.d });
}
for (const s of signals) s.pins = s.pins.filter((c) => pinOf.get(c.n).s === s).map((c) => c.n);
log(`${signals.filter((s) => s.pins.length).length} signals on road graph junctions (${signals.filter((s) => s.mode !== 6 && !s.pins.length).length} with none near: crossings)`);
// 8 peak hour volumes (the City's signal volume counts, by TCS = PX)
const volRows = xlsx('traffic-signal-vehicle-and-pedestrian-volumes.xlsx');
let volMatched = 0;
for (const r of volRows.slice(1)) {
  const s = byPx.get(parseInt(r.A, 10));
  if (!s) continue;
  s.veh8 = parseInt(r.J, 10) || 0;
  s.ped8 = parseInt(r.K, 10) || 0;
  volMatched++;
}
log(`${signals.length} City signals in the area (${volMatched} with 8 peak hour volumes): ${Object.entries(signals.reduce((a, s) => ((a[MODE_NAMES[s.mode]] = (a[MODE_NAMES[s.mode]] || 0) + 1), a), {})).map(([k, v]) => `${v} ${k}`).join(', ')}`);

const pointsOf = (file) => {
  if (!fs.existsSync(path.join(RAW, file))) return [];
  const text = fs.readFileSync(path.join(RAW, file), 'utf8');
  if (text.trimStart().startsWith('{')) return JSON.parse(text).features.map((f) => ({ ...f.properties, coords: f.geometry.coordinates[0] }));
  return csv(file).map((r) => ({ ...r, coords: JSON.parse(r.geometry).coordinates[0] }));
};
const pxos = pointsOf('pedestrian-crossover-4326.csv').map((r) => ({ ...world(r.coords[1], r.coords[0]), px: pxNum(r.PX), main: r.MAIN_STREET, side: r.SIDE1_STREET, midblock: r.MIDBLOCK_ROUTE !== 'None' ? r.MIDBLOCK_ROUTE : '' })).filter(inArea);
const beacons = pointsOf('traffic-beacon-4326.csv').map((r) => ({ ...world(r.coords[1], r.coords[0]), px: pxNum(r.PX), main: r.MAIN_STREET, info: r.ADDITIONAL_INFO })).filter(inArea);
log(`${pxos.length} pedestrian crossovers, ${beacons.length} flashing beacons in the area`);

// =====================================================================================================================
// 2. Crosswalks (Pedestrian Network): each a line across a road, with its PX where it belongs to a signal or crossover
// =====================================================================================================================
const pedNet = JSON.parse(fs.readFileSync(path.join(RAW, 'pedestrian-network-4326.geojson'), 'utf8'));
const crosswalks = []; // { cx, cz, ux, uz, len, type: 'ts' | 'pc' | 'ns', px }
for (const f of pedNet.features) {
  const pr = f.properties;
  if (pr.CROSSWALK !== 1 && pr.CROSSWALK !== '1') continue;
  const line = f.geometry.coordinates[0];
  const a = world(line[0][1], line[0][0]), b = world(line[line.length - 1][1], line[line.length - 1][0]);
  const c = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  if (!inArea(c)) continue;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 2) continue;
  crosswalks.push({ cx: q(c.x), cz: q(c.z), ux: (b.x - a.x) / len, uz: (b.z - a.z) / len, len: q(len), type: String(pr.CROSSWALK_TYPE || '').trim() || 'ns', px: pxNum(pr.PX || '0') });
}
log(`${crosswalks.length} crosswalks (${['ts', 'pc', 'ns'].map((t) => `${crosswalks.filter((c) => c.type === t).length} ${t}`).join(', ')})`);
// each crossover on its crossing's line (else where the City puts the device, across the nearest road)
let pxoLined = 0;
for (const o of pxos) {
  const c = crosswalks.filter((w) => w.px === o.px).sort((p, r) => Math.hypot(p.cx - o.x, p.cz - o.z) - Math.hypot(r.cx - o.x, r.cz - o.z))[0];
  if (c && Math.hypot(c.cx - o.x, c.cz - o.z) < 60) {
    Object.assign(o, { x: c.cx, z: c.cz, ux: c.ux, uz: c.uz, len: c.len });
    pxoLined++;
  } else {
    const l = linksNear(o.x, o.z, 30)[0];
    Object.assign(o, l ? { x: l.px, z: l.pz, ux: -l.uz, uz: l.ux, len: 0 } : { ux: 0, uz: 0, len: 0 });
  }
}
// midblock pedestrian signals (and signals with no junction of the road graph near, like Yonge & Queen with Queen
// closed) likewise on a crossing of theirs across the road there, else across the nearest road
for (const s of signals) {
  if (s.pins.length) continue;
  const road = linksNear(s.x, s.z, 40).find((l) => !linkInfo[l.i].raised);
  const across = (w) => !road || Math.abs(w.ux * road.ux + w.uz * road.uz) < 0.5;
  const c = crosswalks.filter((w) => w.px === s.px && across(w)).sort((p, r) => Math.hypot(p.cx - s.x, p.cz - s.z) - Math.hypot(r.cx - s.x, r.cz - s.z))[0];
  if (c && Math.hypot(c.cx - s.x, c.cz - s.z) < 60) Object.assign(s, { x: c.cx, z: c.cz, ux: +c.ux.toFixed(3), uz: +c.uz.toFixed(3), len: c.len });
  else if (road) Object.assign(s, { x: q(road.px), z: q(road.pz), ux: +(-road.uz).toFixed(3), uz: +road.ux.toFixed(3), len: 0 });
}
log(`${pxoLined} of ${pxos.length} crossovers on their mapped crossing`);

// =====================================================================================================================
// 3. Vehicle volumes on every street (daily: both ways on a two-way street, its way on a one-way one or carriageway)
// =====================================================================================================================
const obs = linkInfo.map(() => []);
const dailyOf = (dur) => (String(dur).startsWith('14') ? 1.18 : 1.9); // a 14 h count is ~85% of the day, an 8 h one ~53%
// 3a. midblock counts: on the link of that name nearest the count (else the nearest link)
let svcUsed = 0;
for (const r of csv('svc_most_recent_summary_data.csv')) {
  const p = world(+r.latitude, +r.longitude);
  if (!inArea(p) || +String(r.latest_count_date_start).slice(0, 4) < 2012) continue;
  const vol = parseFloat(r.avg_weekday_daily_vol) || parseFloat(r.avg_daily_vol);
  if (!vol) continue;
  const name = norm(String(r.location_name).split(':')[0]);
  const near = linksNear(p.x, p.z, 40);
  const hit = near.find((l) => linkInfo[l.i].name === name && !linkInfo[l.i].raised) || (near[0] && near[0].d < 12 && !linkInfo[near[0].i].raised ? near[0] : null);
  if (!hit) continue;
  // (a count across both carriageways of a divided road, on one of them: half of it each way)
  const L = linkInfo[hit.i];
  const divided = L.dir !== 0 && near.some((l) => l.i !== hit.i && linkInfo[l.i].name === L.name && linkInfo[l.i].dir !== 0 && l.d < 45 && Math.abs(l.ux * hit.ux + l.uz * hit.uz) > 0.9);
  obs[hit.i].push(divided ? vol / 2 : vol);
  svcUsed++;
}
// 3b. intersection counts: each approach's volume, both ways (twice the approach), on the arm of the counted junction
// pointing that way
const tmcSummary = csv('tmc_most_recent_summary_data.csv');
let tmcUsed = 0;
const tmcAt = new Map(); // count id -> { node, x, z }
for (const r of tmcSummary) {
  const p = world(+r.latitude, +r.longitude);
  if (!inArea(p) || +String(r.latest_count_date).slice(0, 4) < 2012) continue;
  const n = nearestJunction(p.x, p.z, 30);
  if (n < 0) continue;
  tmcAt.set(r.latest_count_id, { node: n, x: p.x, z: p.z, px: pxNum(r.px || '0'), ped: +r.total_pedestrian || 0, veh: +r.total_vehicle || 0, dur: r.count_duration, name: r.location_name });
  const arms = armsOf(n);
  let used = false;
  for (const [d, [cx, cz]] of Object.entries(COMPASS)) {
    const v = parseFloat(r[`${d}_appr_vehicle`]);
    if (!(v > 0)) continue;
    let best = null, bd = 0.82; // within ~35 degrees of the compass direction
    for (const a of arms) {
      const dot = a.ux * cx + a.uz * cz;
      if (dot > bd) { bd = dot; best = a; }
    }
    if (!best || linkInfo[best.link].raised) continue;
    obs[best.link].push((linkInfo[best.link].dir !== 0 ? 1 : 2) * v * dailyOf(r.count_duration)); // (a one-way street's: its way)
    used = true;
  }
  if (used) tmcUsed++;
}
// 3c. one volume per counted link (the median of its counts), then carried along the same street
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const vol = new Float64Array(linkInfo.length);
const counted = new Uint8Array(linkInfo.length);
linkInfo.forEach((L, i) => { if (obs[i].length) { vol[i] = median(obs[i]); counted[i] = 1; } });
// class medians (OpenStreetMap rank) of the counted streets, for streets of a class no count reaches
const byRank = new Map();
linkInfo.forEach((L, i) => { if (counted[i]) (byRank.get(L.rank) || byRank.set(L.rank, []).get(L.rank)).push(vol[i]); });
const RANK_DEFAULT = { 0: 400, 1: 1500, 2: 5000, 3: 9000, 4: 16000, 5: 30000, 6: 60000 };
const classVol = (rank) => { const a = byRank.get(rank); return a && a.length >= 5 ? median(a) : RANK_DEFAULT[rank] ?? 1500; };
// along each street: the inverse-distance mean of the two nearest counts on it within 1.2 km (residential & service
// streets no further than 400 m: a side street's count says little about the next block's)
const byName = new Map();
linkInfo.forEach((L, i) => { if (L.name) (byName.get(L.name) || byName.set(L.name, []).get(L.name)).push(i); });
let carried = 0, classed = 0;
const filled = new Float64Array(vol);
linkInfo.forEach((L, i) => {
  if (counted[i]) return;
  const reach = L.rank <= 1 ? 400 : 1200;
  const near = (byName.get(L.name) || []).filter((k) => counted[k]).map((k) => ({ k, d: Math.hypot(linkInfo[k].mx - L.mx, linkInfo[k].mz - L.mz) })).filter((o) => o.d < reach).sort((a, b) => a.d - b.d).slice(0, 2);
  if (L.name && near.length) {
    let w = 0, s = 0;
    for (const o of near) { const wi = 1 / Math.max(30, o.d); w += wi; s += wi * vol[o.k]; }
    filled[i] = s / w;
    carried++;
  } else {
    filled[i] = classVol(L.rank);
    classed++;
  }
});
log(`volumes: ${svcUsed} midblock & ${tmcUsed} intersection counts on ${counted.reduce((a, b) => a + b, 0)} streets, carried along ${carried} more, class medians for ${classed} (${[...byRank.keys()].sort().map((r) => `rank ${r}: ${Math.round(classVol(r))}/day`).join(', ')})`);

// =====================================================================================================================
// 4. Turning shares & hourly profiles (TMC raw 15-minute data; midblock raw volumes for the hours round the clock)
// =====================================================================================================================
const turns = []; // [x, z, ux, uz, left, straight, right]: arriving from the arm (ux, uz) at a counted junction
const legPeds = []; // [x, z, ux, uz, share]: the share of the junction's pedestrians crossing the leg (ux, uz)
const vehHours = new Float64Array(24), pedHours = new Float64Array(24), hourCounts = new Float64Array(24);
const tmcRawFile = 'tmc_raw_data_2020_2029.csv';
if (fs.existsSync(path.join(RAW, tmcRawFile))) {
  const acc = new Map(); // count id -> sums
  csvLines(tmcRawFile, (r, c) => {
    const id = r[c.count_id];
    const site = tmcAt.get(id);
    if (!site) return;
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { site, turns: {}, peds: { n: 0, e: 0, s: 0, w: 0 }, hourV: new Float64Array(24), hourP: new Float64Array(24), hourSeen: new Float64Array(24) }));
    const hour = parseInt(String(r[c.start_time]).slice(11, 13), 10);
    let v = 0;
    for (const d of ['n', 'e', 's', 'w']) {
      for (const [m, key] of [['l', 'l'], ['t', 't'], ['r', 'r']]) {
        let x = 0;
        for (const kind of ['cars', 'truck', 'bus']) x += +(r[c[`${d}_appr_${kind}_${m}`]] || 0);
        a.turns[d + key] = (a.turns[d + key] || 0) + x;
        v += x;
      }
      a.peds[d] += +(r[c[`${d}_appr_peds`]] || 0);
    }
    if (hour >= 0 && hour < 24) {
      a.hourV[hour] += v;
      a.hourP[hour] += ['n', 'e', 's', 'w'].reduce((t, d) => t + +(r[c[`${d}_appr_peds`]] || 0), 0);
      a.hourSeen[hour] += 0.25;
    }
  });
  for (const a of acc.values()) {
    const { site } = a;
    const arms = armsOf(site.node);
    const x = RG.nodes[2 * site.node], z = RG.nodes[2 * site.node + 1];
    for (const [d, [cx, cz]] of Object.entries(COMPASS)) {
      const l = a.turns[d + 'l'] || 0, t = a.turns[d + 't'] || 0, r = a.turns[d + 'r'] || 0;
      const arm = arms.reduce((m, o) => (!m || o.ux * cx + o.uz * cz > m.ux * cx + m.uz * cz ? o : m), null);
      if (!arm || arm.ux * cx + arm.uz * cz < 0.82) continue;
      if (l + t + r >= 50) turns.push([q(x), q(z), q(arm.ux * 100) / 100, q(arm.uz * 100) / 100, +(l / (l + t + r)).toFixed(3), +(t / (l + t + r)).toFixed(3), +(r / (l + t + r)).toFixed(3)]);
      const peds = a.peds.n + a.peds.e + a.peds.s + a.peds.w;
      if (peds >= 40) legPeds.push([q(x), q(z), q(arm.ux * 100) / 100, q(arm.uz * 100) / 100, +(a.peds[d] / peds).toFixed(3)]);
    }
    // (the 14-hour counts: every hour from 6 to 20 seen in full)
    if (a.hourSeen.filter((h) => h >= 1).length >= 12) {
      const tv = a.hourV.reduce((s, v) => s + v, 0), tp = a.hourP.reduce((s, v) => s + v, 0);
      for (let h = 0; h < 24; h++) {
        if (a.hourSeen[h] < 1) continue;
        if (tv) vehHours[h] += a.hourV[h] / tv;
        if (tp) pedHours[h] += a.hourP[h] / tp;
        hourCounts[h]++;
      }
    }
  }
  log(`TMC raw: ${acc.size} counts in the area, ${turns.length} approaches with turning shares, ${legPeds.length} legs with pedestrian shares, ${Math.max(...hourCounts)} full-day counts for the hourly profile`);
} else log(`(no ${tmcRawFile}: no turning shares; node tools/fetch-opendata.mjs)`);

// hourly vehicle shares round the clock from the midblock counts' 15-minute volumes (where downloaded); the TMC
// profile covers 6-20 h, scaled to meet it
const svcHours = new Float64Array(24);
const svcRawFile = 'svc_raw_data_volume_2020_2024.csv';
if (fs.existsSync(path.join(RAW, svcRawFile))) {
  const sums = new Map();
  csvLines(svcRawFile, (r, c) => {
    const p = world(+r[c.latitude], +r[c.longitude]);
    if (c.latitude !== undefined && !inArea(p)) return;
    const id = r[c.count_id];
    const hour = parseInt(String(r[c.time_start] || r[c.datetime_bin] || '').slice(11, 13), 10);
    const v = +(r[c.volume] || r[c.volume_15min] || 0);
    if (!(hour >= 0)) return;
    let s = sums.get(id);
    if (!s) sums.set(id, (s = new Float64Array(25)));
    s[hour] += v;
    s[24] += v;
  });
  let n = 0;
  for (const s of sums.values()) {
    if (s.slice(0, 24).filter((v) => v > 0).length < 20 || !s[24]) continue;
    for (let h = 0; h < 24; h++) svcHours[h] += s[h] / s[24];
    n++;
  }
  if (n) for (let h = 0; h < 24; h++) svcHours[h] /= n;
  log(`midblock raw: ${n} round-the-clock counts for the night hours`);
}
// the profile: TMC's share per hour where it has full days (its 14 h share of the day: what the midblock profile gives
// those hours, else 85%), the midblock profile (else a typical urban one) for the others
const URBAN = [0.012, 0.007, 0.005, 0.004, 0.006, 0.014, 0.034, 0.058, 0.066, 0.058, 0.054, 0.057, 0.06, 0.06, 0.062, 0.067, 0.072, 0.074, 0.065, 0.051, 0.042, 0.036, 0.029, 0.019];
const night = svcHours.some((v) => v > 0) ? Array.from(svcHours) : URBAN;
const dayShare = (h) => hourCounts[h] > 0;
const dayTotal = night.reduce((s, v, h) => s + (dayShare(h) ? v : 0), 0) || 0.85;
const hourly = (src) => {
  const sum = src.reduce((s, v, h) => s + (dayShare(h) ? v / hourCounts[h] : 0), 0);
  return night.map((v, h) => +(dayShare(h) && sum ? (src[h] / hourCounts[h] / sum) * dayTotal : v).toFixed(4));
};
const vehHourly = hourCounts.some((v) => v) ? hourly(vehHours) : URBAN;
// pedestrians: the TMC profile for 6-20 h; the evening & night after it fall away like the traffic (scaled to meet it)
const pedHourly = hourCounts.some((v) => v) ? hourly(pedHours) : URBAN;

// =====================================================================================================================
// 5. Write
// =====================================================================================================================
const crosswalkOut = crosswalks.map((c) => [c.cx, c.cz, +c.ux.toFixed(3), +c.uz.toFixed(3), c.len, ['ts', 'pc', 'ns'].indexOf(c.type), c.px]);
const signalOut = signals.map((s) => [s.x, s.z, s.px, s.mode, s.sys, s.lpi, s.speed, s.fdwAt, s.veh8 || 0, s.ped8 || 0, s.approaches, s.ux || 0, s.uz || 0, s.len || 0, `${s.main}${s.midblock ? ` ${s.midblock}` : ' /'} ${s.side}`, s.pins]);
const data = {
  source: 'City of Toronto Open Data (Open Government Licence - Toronto): Traffic Signals Tabular, Pedestrian Network, Traffic Volumes (Turning Movement Counts; Midblock Speed, Volume & Classification Counts), Traffic Signal Vehicle and Pedestrian Volumes',
  modes: MODE_NAMES,
  // [x, z, px, mode, system (0 TransSuite, 1 SCOOT, 2 SCATS), LPI crosswalks (1 N, 2 S, 4 E, 8 W), walking speed (m/s),
  //  clearance speed (m/s, the flashing don't walk over the full crossing), 8 peak hour vehicles, 8 peak hour pedestrians,
  //  approaches, crossing direction x, z & length (midblock signals), "main / side", the road graph junction nodes it
  //  controls]
  signals: signalOut,
  // [x, z, px, across x, z, length]
  pxo: pxos.map((o) => [q(o.x), q(o.z), o.px, +(o.ux || 0).toFixed(3), +(o.uz || 0).toFixed(3), q(o.len || 0), `${o.main} ${o.midblock || '/'} ${o.side}`]),
  beacons: beacons.map((b) => [q(b.x), q(b.z), b.px]),
  // [centre x, z, direction x, z, length, type (0 signal, 1 crossover, 2 unsignalised), px]
  crosswalks: crosswalkOut,
  // daily vehicles per road graph link (GEO.roadGraph.links order: both ways on a two-way street, its way on a one-way
  // one), and which were counted (1)
  linkVolume: Array.from(filled, (v) => Math.round(v / 10) * 10),
  linkCounted: Array.from(counted).join(''),
  turns,
  legPeds,
  // share of the day's vehicles & pedestrians in each hour
  hourly: { vehicles: vehHourly, pedestrians: pedHourly }
};
const out = `// js/toronto-traffic-data.js — GENERATED by tools/build-traffic-data.mjs from City of Toronto Open Data
// (Open Government Licence - Toronto; see CREDITS.md), do not edit by hand. The City's traffic signals, pedestrian
// crossovers & crosswalks in the detail area, and the vehicle volume of every street, for js/city-config.js,
// js/signal-plan.js & js/traffic.js.
(function () {
window.CITY.TRAFFIC_DATA = ${JSON.stringify(data)};
})();
`;
fs.writeFileSync(OUT, out);
log(`-> ${path.relative(ROOT, OUT)} (${(out.length / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
log(`hourly vehicle share: golden 18 h ${vehHourly[18]}, midday 13 h ${vehHourly[13]}, sunset 19 h ${vehHourly[19]}, night 23 h ${vehHourly[23]}; pedestrians ${pedHourly[18]}, ${pedHourly[13]}, ${pedHourly[19]}, ${pedHourly[23]}`);
