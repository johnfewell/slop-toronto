// tools/build-transit.mjs — writes js/toronto-transit.js (window.CITY.GEO_TRANSIT): the TTC's routes through the
// detailed city, from its timetable (tools/fetch-gtfs.mjs: Merged GTFS, City of Toronto Open Data, Open Government
// Licence – Toronto). Not the timetable itself, only what the city runs on:
// - patterns: each route's main stopping patterns (GTFS shapes) through the detailed city, clipped to it and simplified,
//   with their stops (in order) and how many trips pass per hour on a weekday (a Wednesday's services), counted at the
//   pattern's middle stop in the city: the headway by time of day (3600 / trips that hour);
// - the scheduled speed through the city (stop to stop, dwell included) for spacing the vehicles at the start;
// - stops: position & name, shared between patterns.
// usage: node tools/build-transit.mjs [gtfs feed dir] [out.js]     (default ~/.cache/slop-toronto/gtfs/feed)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const FEED = process.argv[2] || path.join(process.env.HOME, '.cache/slop-toronto/gtfs/feed');
const OUT = process.argv[3] || fileURLToPath(new URL('../js/toronto-transit.js', import.meta.url));
const SOURCE = (() => { try { return JSON.parse(fs.readFileSync(path.join(FEED, '../SOURCE.json'), 'utf8')); } catch { return {}; } })();
const log = (...a) => console.log('[transit]', ...a);

// The world frame the city was built in (js/toronto-geodata.js GEO.frame: projection & the detailed area)
const geoSrc = fs.readFileSync(fileURLToPath(new URL('../js/toronto-geodata.js', import.meta.url)), 'utf8');
const frame = { projection: JSON.parse(geoSrc.match(/"projection":(\{[^}]*\})/)[1]), detail: JSON.parse(geoSrc.match(/"detail":(\{[^}]*\})/)[1]) };
const P = frame.projection;
const toWorld = (lat, lon) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
  const c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
};
const INSET = 60; // m in from the detailed area's edge
const B = { x0: frame.detail.x0 + INSET, x1: frame.detail.x1 - INSET, z0: frame.detail.z0 + INSET, z1: frame.detail.z1 - INSET };
const inside = ([x, z]) => x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1;
const MIN_PIECE = 500; // m: shorter stretches through the city are left out
const MIN_TRIPS = 8; // trips a weekday: rarer patterns (short turns, garage trips) are left out

// --- CSV (TTC's files have no quoted commas in the columns read here)
async function eachRow(file, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(FEED, file)), crlfDelay: Infinity });
  let head = null;
  for await (const line of rl) {
    if (!line) continue;
    const cols = line.split(',');
    if (!head) { head = Object.fromEntries(cols.map((c, i) => [c.replace(/^﻿/, '').trim(), i])); continue; }
    fn(cols, head);
  }
}
const hms = (t) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };

// --- a Wednesday's services
const services = new Set();
await eachRow('calendar.txt', (c, h) => { if (c[h.wednesday] === '1') services.add(c[h.service_id]); });
const routes = new Map();
await eachRow('routes.txt', (c, h) => {
  const type = +c[h.route_type];
  if (type === 0 || type === 1 || type === 3) routes.set(c[h.route_id], { id: c[h.route_id], num: c[h.route_short_name], name: c[h.route_long_name], type, color: c[h.route_color] });
});
const trips = new Map(); // trip -> { route, dir, shape, sign }
const shapeTrips = new Map();
// (headsigns may hold commas: re-joined from the columns between route/service and direction)
await eachRow('trips.txt', (c, h) => {
  if (!services.has(c[h.service_id]) || !routes.has(c[h.route_id])) return;
  const extra = c.length - Object.keys(h).length;
  const sign = c.slice(h.trip_headsign, h.trip_headsign + 1 + extra).join(',').replace(/^"|"$/g, '');
  const j = (k) => c[h[k] + (h[k] > h.trip_headsign ? extra : 0)];
  const t = { route: c[h.route_id], dir: +j('direction_id'), shape: j('shape_id'), sign };
  trips.set(c[h.trip_id], t);
  shapeTrips.set(t.shape, (shapeTrips.get(t.shape) || 0) + 1);
});
log(`${services.size} Wednesday services, ${trips.size} trips on ${routes.size} routes`);

const stops = new Map();
await eachRow('stops.txt', (c, h) => {
  const w = toWorld(+c[h.stop_lat], +c[h.stop_lon]);
  stops.set(c[h.stop_id], { id: c[h.stop_id], name: c[h.stop_name], w, in: inside(w) });
});

// --- stop_times: per shape, a representative trip's stops & times, and per (shape, stop in the city) trips per hour
const rep = new Map(); // shape -> { trip, stops: [{ stop, t, d }] }
const counts = new Map(); // shape|stop -> Int16Array(24)
let rows = 0;
await eachRow('stop_times.txt', (c, h) => {
  rows++;
  const t = trips.get(c[h.trip_id]);
  if (!t) return;
  const st = stops.get(c[h.stop_id]);
  if (!st) return;
  let r = rep.get(t.shape);
  if (!r) rep.set(t.shape, (r = { trip: c[h.trip_id], stops: [] }));
  if (r.trip === c[h.trip_id]) r.stops.push({ stop: st.id, seq: +c[h.stop_sequence], t: hms(c[h.departure_time]), d: +c[h.shape_dist_traveled] || 0 });
  if (!st.in) return;
  const k = t.shape + '|' + st.id;
  let a = counts.get(k);
  if (!a) counts.set(k, (a = new Int16Array(24)));
  a[Math.floor(hms(c[h.departure_time]) / 3600) % 24]++;
});
log(`${rows} stop times read; ${rep.size} shapes run on a Wednesday`);

// --- shapes
const shapePts = new Map();
await eachRow('shapes.txt', (c, h) => {
  const id = c[h.shape_id];
  if (!rep.has(id)) return;
  let a = shapePts.get(id);
  if (!a) shapePts.set(id, (a = []));
  a.push({ q: +c[h.shape_pt_sequence], w: toWorld(+c[h.shape_pt_lat], +c[h.shape_pt_lon]), d: +c[h.shape_dist_traveled] || 0 });
});

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const L = Math.hypot(bx - ax, bz - az) || 1e-9;
    let best = -1, bd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * (bz - az) - (pts[i][1] - az) * (bx - ax)) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r1 = (x) => Math.round(x * 10) / 10;

const stopIndex = new Map();
const stopOut = [];
const stopNames = [];
const routeIndex = new Map();
const routeOut = [];
const patterns = [];
for (const [shape, r] of rep) {
  const n = shapeTrips.get(shape) || 0;
  if (n < MIN_TRIPS) continue;
  const anyTrip = [...trips.values()].find((t) => t.shape === shape); // (one lookup per shape)
  const route = routes.get(anyTrip.route);
  const raw = (shapePts.get(shape) || []).sort((a, b) => a.q - b.q);
  // the longest stretch inside the city
  let best = null, cur = null;
  for (const p of raw) {
    if (inside(p.w)) {
      if (!cur) cur = [];
      cur.push(p);
    } else if (cur) {
      if (!best || cur.at(-1).d - cur[0].d > best.at(-1).d - best[0].d) best = cur;
      cur = null;
    }
  }
  if (cur && (!best || cur.at(-1).d - cur[0].d > best.at(-1).d - best[0].d)) best = cur;
  if (!best || best.length < 2) continue;
  let len = 0;
  for (let i = 1; i < best.length; i++) len += Math.hypot(best[i].w[0] - best[i - 1].w[0], best[i].w[1] - best[i - 1].w[1]);
  if (len < MIN_PIECE) continue;
  const d0 = best[0].d, d1 = best.at(-1).d;
  // its stops on that stretch, in order
  r.stops.sort((a, b) => a.seq - b.seq);
  const on = r.stops.filter((s) => stops.get(s.stop).in && s.d >= d0 - 30 && s.d <= d1 + 30);
  if (on.length < 2) continue;
  // trips per hour at its middle stop in the city
  const mid = on[on.length >> 1];
  const perHour = Array.from(counts.get(shape + '|' + mid.stop) || new Int16Array(24));
  if (!perHour.some((x) => x > 0)) continue;
  // the scheduled speed over the stretch (m/s, stops included); (shape_dist_traveled is in metres in TTC's feed)
  const dt = on.at(-1).t - on[0].t, dd = on.at(-1).d - on[0].d;
  const v = dt > 60 && dd > 100 ? r1(dd / dt) : route.type === 1 ? 9 : 5;
  if (!routeIndex.has(route.id)) {
    routeIndex.set(route.id, routeOut.length);
    routeOut.push([route.num, route.name, route.type, route.color]);
  }
  const eps = route.type === 1 ? 3 : 1.0;
  const pts = rdp(best.map((p) => p.w), eps).flatMap(([x, z]) => [r1(x), r1(z)]);
  const sIdx = on.map((s) => {
    if (!stopIndex.has(s.stop)) {
      const st = stops.get(s.stop);
      stopIndex.set(s.stop, stopOut.length / 2);
      stopOut.push(r1(st.w[0]), r1(st.w[1]));
      stopNames.push(st.name);
    }
    return stopIndex.get(s.stop);
  });
  // what it runs as: a streetcar route's replacement buses are buses
  const t = route.type === 0 && /Replacement Bus/i.test(anyTrip.sign) ? 3 : route.type;
  // the destination sign: "East - 504B King towards Broadview Station" -> ["504B KING", "BROADVIEW STN"]
  const m = anyTrip.sign.replace(/^(East|West|North|South)\s*-\s*/i, '').split(/\s+towards\s+/i);
  const label = /^\d/.test(m[0]) ? m[0].replace(/\s*(Short Turn|Replacement Bus)\b/gi, '') : `${route.num} ${route.name}`;
  const dest = (m[1] || '').replace(/\s+via\s+.*$/i, '').replace(/\bStation\b/i, 'Stn');
  patterns.push({ r: routeIndex.get(route.id), d: anyTrip.dir, t, sign: anyTrip.sign, label: [label.toUpperCase(), dest.toUpperCase()], n, v, perHour, pts, stops: sIdx, len: Math.round(len) });
}
// The TTC gives the same stopping pattern a shape per time band: one pattern per route, direction and first & last stop in
// the city, its trips summed (the longest shape kept)
const merged = new Map();
for (const p of patterns) {
  const k = `${p.r}|${p.d}|${p.stops[0]}|${p.stops.at(-1)}|${p.t}`;
  const m = merged.get(k);
  if (!m) { merged.set(k, p); continue; }
  if (p.len > m.len) Object.assign(m, { pts: p.pts, stops: p.stops, len: p.len, sign: m.n >= p.n ? m.sign : p.sign, v: m.n >= p.n ? m.v : p.v });
  m.n += p.n;
  m.perHour = m.perHour.map((x, i) => x + p.perHour[i]);
}
patterns.length = 0;
patterns.push(...merged.values());
patterns.sort((a, b) => a.r - b.r || a.d - b.d || b.n - a.n);
const byType = (ty) => patterns.filter((p) => p.t === ty);
log(`${patterns.length} patterns on ${routeOut.length} routes (${byType(0).length} streetcar, ${byType(3).length} bus, ${byType(1).length} subway), ${stopOut.length / 2} stops`);
for (const p of patterns) {
  const [num, name] = routeOut[p.r], ty = p.t;
  log(`  ${ty === 0 ? 'streetcar' : ty === 1 ? 'subway' : 'bus'} ${num} ${name} d${p.d} "${p.label.join(' / ')}" ${p.len} m, ${p.stops.length} stops, ${p.n}/day, ${p.v} m/s, per hour ${p.perHour.join(' ')}`);
}

const data = {
  source: { dataset: SOURCE.title || 'Merged GTFS - TTC Routes and Schedules', modified: SOURCE.modified, day: 'Wednesday' },
  routes: routeOut,
  stops: stopOut,
  stopNames,
  // (the subway's only its trips per hour: js/subway.js runs it on OpenStreetMap's lines)
  patterns: patterns.map(({ r, d, t, label, n, v, perHour, pts, stops: s }) => (t === 1 ? { r, d, t, sign: label, n, h: perHour } : { r, d, t, sign: label, n, v, h: perHour, pts, stops: s }))
};
fs.writeFileSync(OUT, `// js/toronto-transit.js — GENERATED by tools/build-transit.mjs, do not edit by hand.
// The TTC's routes through the detailed city (stopping patterns, stops, trips per hour on a weekday), in the world
// frame of js/toronto-geodata.js. From the TTC's GTFS on City of Toronto Open Data ("${data.source.dataset}",
// ${data.source.modified || ''}). Contains information licensed under the Open Government Licence – Toronto.
(function () {
window.CITY = window.CITY || {};
window.CITY.GEO_TRANSIT = ${JSON.stringify(data)};
})();
`);
log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
