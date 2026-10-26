// Part 8: Toronto's cycling network, from the City of Toronto's "Cycling Network" (Open Government Licence – Toronto,
// tools/fetch-cycling.mjs), with OpenStreetMap's cycleway tags for the side of the street a bikeway is on (the City
// classifies each segment, its higher & lower class of bikeway, but not which side carries which).
// - bands: the on-street bikeways (bike lanes, buffered & contra-flow lanes, cycle tracks, sharrows) as the curb line
//   they run along, found on the real road surface (the curb islands, tools/geo-blocks.mjs), in the direction bikes
//   ride it, broken at the junctions (a crossing piece carries the bikeway through one)
// - trails: the multi-use trails as their centre lines, with a width & surface
// - map: every segment (signed routes too) for the minimap & the map, by kind
// CYCLE_DEBUG=1 logs the segments whose side was decided by rule; CYCLE_DEBUG=<regex of a street> its curb samples.
import fs from 'node:fs';
import path from 'node:path';
import { toWorld, rdp, log, osmRoads } from './geo-base.mjs';
import { DETAIL } from './geo-roads.mjs';
import { blocks } from './geo-blocks.mjs';

const RAW = process.env.PROPS_DATA || path.join(process.env.HOME, '.cache/slop-toronto/raw');
const FILE = path.join(RAW, 'cycling-network-4326.geojson');
const q = (v) => Math.round(v * 10) / 10;
const q2 = (v) => Math.round(v * 100) / 100;

// Kinds (js/road-paint.js & js/city-map.js read them by index)
export const CYCLE_KINDS = ['lane', 'buffered', 'contraflow', 'track', 'track2', 'sharrow', 'trail', 'parkRoad', 'signed'];
const K = Object.fromEntries(CYCLE_KINDS.map((k, i) => [k, i]));
function kindOf(s) {
  s = (s || '').trim();
  if (s === 'Bike Lane') return K.lane;
  if (s === 'Bike Lane - Buffered') return K.buffered;
  if (s === 'Bike Lane - Contraflow') return K.contraflow;
  if (s === 'Cycle Track' || s === 'Cycle Track - Contraflow') return K.track;
  if (s === 'Bi-Directional Cycle Track') return K.track2;
  if (/^Sharrows/.test(s)) return K.sharrow;
  if (/^Multi-Use Trail/.test(s)) return K.trail;
  if (s === 'Park Road') return K.parkRoad;
  if (/^Signed Route/.test(s)) return K.signed;
  return -1;
}
const contra = (s) => /Contraflow/.test(s || '');
const ON_STREET = new Set([K.lane, K.buffered, K.contraflow, K.track, K.track2, K.sharrow]);

// ---------------------------------------------------------------------------------------------------------------------
// The curb islands (exact outlines), to find a street's curbs: a point is on the roadway when it is in no island
// ---------------------------------------------------------------------------------------------------------------------
const CELL = 50;
const grid = new Map();
for (const b of blocks) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of b.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  b._bb = [x0, x1, z0, z1];
  for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
    for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
      const k = i * 100003 + j;
      (grid.get(k) || grid.set(k, []).get(k)).push(b);
    }
  }
}
function blockAt(x, z) {
  for (const b of grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) || []) {
    const [x0, x1, z0, z1] = b._bb;
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    let inside = false;
    const r = b.poly;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i], [xj, zj] = r[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    if (inside) return b;
  }
  return null;
}
const outside = (x, z) => x < DETAIL.x0 + 5 || x > DETAIL.x1 - 5 || z < DETAIL.z0 + 5 || z > DETAIL.z1 - 5;
// Distance from (px, pz) along (nx, nz) to the curb of the roadway it stands on (through any median), or null: starting
// on a curb island that is no median, or no curb within reach
const REACH = 24;
function curbAt(px, pz, nx, nz) {
  const STEP = 0.25;
  let s = 0;
  let b = blockAt(px, pz);
  if (b && !b.median) return null;
  let road = !b;
  for (s = STEP; s <= REACH; s += STEP) {
    const x = px + nx * s, z = pz + nz * s;
    if (outside(x, z)) return null;
    b = blockAt(x, z);
    if (!b) { road = true; continue; }
    if (b.median || !road) continue; // across a median (University Ave's), or still leaving the one it started on
    // refine between the last roadway sample and this one
    let lo = s - STEP, hi = s;
    for (let k = 0; k < 6; k++) {
      const m = (lo + hi) / 2;
      const c = blockAt(px + nx * m, pz + nz * m);
      if (c && !c.median) hi = m; else lo = m;
    }
    return (lo + hi) / 2;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// OpenStreetMap: which side of each street carries its bikeway (cycleway:left / right / both), the street's one-way,
// and the separately drawn cycle tracks (highway=cycleway beside a street)
// ---------------------------------------------------------------------------------------------------------------------
const ROADS = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|primary_link|secondary_link|tertiary_link)$/;
const HAS = /^(lane|track|separate|shared_lane|share_busway|opposite_lane|opposite_track|buffered_lane|opposite)$/;
const osmSegs = new Map(); // 20 m cells -> [ax, az, bx, bz, info]
const SC = 20;
function addSeg(ax, az, bx, bz, info) {
  for (let i = Math.floor(Math.min(ax, bx) / SC); i <= Math.floor(Math.max(ax, bx) / SC); i++) {
    for (let j = Math.floor(Math.min(az, bz) / SC); j <= Math.floor(Math.max(az, bz) / SC); j++) {
      const k = i * 100003 + j;
      (osmSegs.get(k) || osmSegs.set(k, []).get(k)).push([ax, az, bx, bz, info]);
    }
  }
}
for (const e of osmRoads.elements) {
  const t = e.tags || {};
  if (!e.geometry || e.geometry.length < 2) continue;
  const cycleway = t.highway === 'cycleway';
  if (!cycleway && !ROADS.test(t.highway || '')) continue;
  const side = (s) => {
    const v = t[`cycleway:${s}`] ?? t['cycleway:both'] ?? (t.cycleway && (s === 'right' || !/^(yes|-1)$/.test(t.oneway || '')) ? t.cycleway : undefined);
    return HAS.test(v || '') ? 1 : 0;
  };
  const info = cycleway ? { cycleway: true } : {
    left: side('left'), right: side('right'),
    oneway: /^(yes|true|1)$/.test(t.oneway || '') ? 1 : t.oneway === '-1' ? -1 : 0,
    bridge: !!t.bridge && t.bridge !== 'no'
  };
  const pts = e.geometry.map((g) => toWorld(g.lon, g.lat));
  for (let i = 0; i + 1 < pts.length; i++) addSeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], info);
}
// The OSM street under (x, z) running along (dx, dz) (within 7 m, within 20°), with the side of it (x, z) is on, and
// the separate cycleways beside it within 15 m
function osmAt(x, z, dx, dz) {
  let road = null, rd = 7;
  const tracks = [];
  for (let i = Math.floor((x - 15) / SC); i <= Math.floor((x + 15) / SC); i++) {
    for (let j = Math.floor((z - 15) / SC); j <= Math.floor((z + 15) / SC); j++) {
      for (const sg of osmSegs.get(i * 100003 + j) || []) {
        const [ax, az, bx, bz, info] = sg;
        const ex = bx - ax, ez = bz - az, L = Math.hypot(ex, ez);
        if (L < 0.5) continue;
        const cos = (ex * dx + ez * dz) / L;
        if (Math.abs(cos) < 0.94) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (L * L)));
        const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
        // which side of the City's line the OSM line lies on (+1: its right, (rx, rz) = (-dz, dx))
        const side = Math.sign((ax + ex * t - x) * -dz + (az + ez * t - z) * dx);
        if (info.cycleway) { if (d > 2.5 && d < 15) tracks.push(side); continue; }
        if (d < rd) { rd = d; road = { info, same: cos > 0 }; }
      }
    }
  }
  return { road, tracks };
}

// ---------------------------------------------------------------------------------------------------------------------
// The City's segments
// ---------------------------------------------------------------------------------------------------------------------
const features = JSON.parse(fs.readFileSync(FILE, 'utf8')).features;
const inBox = (x, z, m = 0) => x > DETAIL.x0 + m && x < DETAIL.x1 - m && z > DETAIL.z0 + m && z < DETAIL.z1 - m;
// Each line resampled every `step` m: [{ x, z, dx, dz }]
function resample(pts, step) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    const n = Math.max(1, Math.round(L / step));
    for (let k = 0; k < n; k++) out.push({ x: ax + (bx - ax) * (k / n), z: az + (bz - az) * (k / n), dx, dz });
    if (i + 2 === pts.length) out.push({ x: bx, z: bz, dx, dz });
  }
  // directions smoothed over the neighbours (a polyline's corners)
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 2)], b = out[Math.min(out.length - 1, i + 2)];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L > 0.5) { out[i].dx = (b.x - a.x) / L; out[i].dz = (b.z - a.z) / L; }
  }
  return out;
}
const lineLen = (pts) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

const STEP = 2;
const bands = []; // [kind, flags, flat x, z ...]: the curb line in the direction bikes ride; flags: 1 the curb is on the
// riders' left (else their right), 2 a crossing (through a junction, no curb), 4 contra-flow (against the traffic)
const trails = []; // [width, surface (0 asphalt, 1 the Martin Goodman's red), level (1 on a curb island, 0 across a
// road), flat x, z ...]
const mapLines = []; // [kind, flat x, z ...]
const km = {};
const sideStats = { osm: 0, fallback: 0 };
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };

function emitBand(kind, flags, pts) {
  const flat = rdp(pts, 0.06).flatMap(([x, z]) => [q2(x), q2(z)]);
  if (flat.length >= 4) bands.push([kind, flags, flat]);
}
// One side of a City line: its curb, sampled, cleaned and broken at the junctions; `sign` +1 the line's right side
function curbSide(S, sign, kind, withLine, isContra, label = '') {
  const d = S.map((p) => curbAt(p.x, p.z, -p.dz * sign, p.dx * sign));
  if (process.env.CYCLE_DEBUG && label && new RegExp(process.env.CYCLE_DEBUG).test(label)) log(`  ${label} side ${sign}: ${d.map((v) => (v === null ? '-' : v.toFixed(1))).join(' ')}`);
  // outliers (driveways, lay-bys, bulb-outs, a corner's radius): off the median of their neighbours by over 1.2 m
  const clean = d.map((v, i) => {
    if (v === null) return null;
    const near = d.slice(Math.max(0, i - 5), i + 6).filter((w) => w !== null);
    return near.length >= 3 && Math.abs(v - median(near)) > 1.2 ? null : v;
  });
  // runs of curb; a gap up to 12 m between two runs at about the same offset is a driveway or a laneway's mouth (the
  // bikeway runs straight on), a longer one up to 50 m a junction (a crossing piece); anything else breaks it
  const runs = [];
  let run = null;
  clean.forEach((v, i) => {
    if (v === null) { run = null; return; }
    if (!run) runs.push((run = { i0: i, i1: i }));
    run.i1 = i;
  });
  const pieces = []; // { i0, i1, cross }
  for (const r of runs) {
    if (r.i1 - r.i0 < 2) continue; // (a stray hit)
    const last = pieces[pieces.length - 1];
    if (last && !last.cross) {
      const gap = (r.i0 - last.i1) * STEP;
      const dv = Math.abs(clean[r.i0] - clean[last.i1]);
      if (gap <= 12 && dv < 1.0) {
        for (let i = last.i1 + 1; i < r.i0; i++) clean[i] = clean[last.i1] + (clean[r.i0] - clean[last.i1]) * (i - last.i1) / (r.i0 - last.i1);
        last.i1 = r.i1;
        continue;
      }
      if (gap <= 50 && dv < 2.5) {
        for (let i = last.i1 + 1; i < r.i0; i++) clean[i] = clean[last.i1] + (clean[r.i0] - clean[last.i1]) * (i - last.i1) / (r.i0 - last.i1);
        pieces.push({ i0: last.i1, i1: r.i0, cross: true });
      }
    }
    pieces.push({ i0: r.i0, i1: r.i1, cross: false });
  }
  // smoothed offsets, the curb line in the riding direction (`rev`: against the City line's)
  const sm = clean.map((v, i) => {
    if (v === null) return null;
    let s = 0, n = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(clean.length - 1, i + 3); k++) if (clean[k] !== null) { s += clean[k]; n++; }
    return s / n;
  });
  const rev = !withLine;
  for (const pc of pieces) {
    if (pc.i1 - pc.i0 < 2) continue;
    const pts = [];
    for (let i = pc.i0; i <= pc.i1; i++) {
      const p = S[i];
      pts.push([p.x - p.dz * sign * sm[i], p.z + p.dx * sign * sm[i]]);
    }
    if (rev) pts.reverse();
    // the curb on the riders' left: the right side ridden against the line, or the left ridden along it
    const left = (sign > 0) === rev;
    emitBand(kind, (left ? 1 : 0) | (pc.cross ? 2 : 0) | (isContra ? 4 : 0), pts);
  }
}

// A trail in pieces: where it runs over the curb islands (parks, the waterfront's promenades) and where it crosses a
// road between them (up to 30 m). A trail the City draws down a street's centre line (a boulevard trail beside Bayview
// Ave, the Island's car-free avenues the street level carries as roads) leaves that stretch to the street.
function trailPieces(pts, w, surface) {
  const S = resample(pts, 2);
  const runs = [];
  for (let i = 0; i < S.length; i++) {
    const on = blockAt(S[i].x, S[i].z) ? 1 : 0;
    const r = runs[runs.length - 1];
    if (r && r.on === on) r.i1 = i; else runs.push({ on, i0: i, i1: i });
  }
  // where the trail meets the curb between samples i (on one side) & j (on the other)
  const curbBetween = (i, j) => {
    let a = S[i], b = S[j];
    const on = !!blockAt(a.x, a.z);
    for (let k = 0; k < 8; k++) {
      const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      if (!!blockAt(m.x, m.z) === on) a = m; else b = m;
    }
    return [(a.x + b.x) / 2, (a.z + b.z) / 2];
  };
  runs.forEach((r, k) => {
    if (!r.on) {
      const len = (r.i1 - r.i0 + 2) * 2;
      if (len > 30 || k === 0 || k === runs.length - 1) return;
    }
    // (each piece runs on to the curb, so the pieces meet there)
    const seg = [];
    if (r.i0 > 0) seg.push(curbBetween(r.i0 - 1, r.i0));
    for (let i = r.i0; i <= r.i1; i++) seg.push([S[i].x, S[i].z]);
    if (r.i1 < S.length - 1) seg.push(curbBetween(r.i1, r.i1 + 1));
    if (seg.length < 2 || lineLen(seg) < 1) return;
    trails.push([w, surface, r.on, rdp(seg, 0.15).flatMap(([x, z]) => [q2(x), q2(z)])]);
  });
}

for (const f of features) {
  const p = f.properties;
  const hi = kindOf(p.INFRA_HIGHORDER), loRaw = (p.INFRA_LOWORDER || '').trim();
  const lo = loRaw && !/Null/.test(loRaw) ? kindOf(loRaw) : -1;
  if (hi < 0 || !f.geometry) continue;
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const coords of lines) {
    // the line inside the detailed city (its pieces there)
    const all = coords.map(([lon, lat]) => toWorld(lon, lat));
    const parts = [];
    let cur = [];
    for (const pt of all) {
      if (inBox(pt[0], pt[1], 10)) cur.push(pt);
      else { if (cur.length >= 2) parts.push(cur); cur = []; }
    }
    if (cur.length >= 2) parts.push(cur);
    for (const pts of parts) {
      const L = lineLen(pts);
      km[CYCLE_KINDS[hi]] = (km[CYCLE_KINDS[hi]] || 0) + L / 1000;
      mapLines.push([hi, rdp(pts, 1.0).flatMap(([x, z]) => [q(x), q(z)])]);
      if (hi === K.trail) {
        const mgt = /Martin Goodman|Waterfront Tr/i.test(p.STREET_NAME || '');
        const sub = p.INFRA_HIGHORDER;
        const w = mgt ? 4.0 : /Entrance|Connector/.test(sub) ? 2.5 : 3.0;
        trailPieces(pts, w, mgt ? 1 : 0);
        continue;
      }
      if (!ON_STREET.has(hi)) continue;
      const S = resample(pts, STEP);
      // the sides: OSM's votes along the line (+1 its right, -1 its left) for a bikeway there, and its traffic's way
      let vR = 0, vL = 0, n = 0, along = 0, bridges = 0;
      for (let i = 0; i < S.length; i += 3) {
        const { road, tracks } = osmAt(S[i].x, S[i].z, S[i].dx, S[i].dz);
        for (const s of tracks) { if (s > 0) vR++; else vL++; }
        if (!road) continue;
        n++;
        const { left, right, oneway, bridge } = road.info;
        if (bridge) bridges++;
        const r = road.same ? right : left, l = road.same ? left : right;
        vR += r; vL += l;
        along += oneway * (road.same ? 1 : -1);
      }
      // (a bikeway on a bridge, the Bloor Viaduct's, has no curb islands under it to find its curbs by: the map only)
      if (n && bridges > n * 0.5) continue;
      const traffic = n && Math.abs(along) > n * 0.5 ? Math.sign(along) : 0; // one-way: +1 along the line, -1 against
      let right = -1, left = -1;
      const both = lo === hi || (lo >= 0 && hi === K.sharrow);
      if (both) { right = left = hi; } else {
        // the higher-class bikeway on one side, the lower (if any) on the other
        let onRight;
        if (vR !== vL && (vR > 2 || vL > 2)) { onRight = vR > vL; sideStats.osm++; } else {
          // no telling from the map: a contra-flow bikeway runs on the left of the traffic, any other on its right
          const trafficRight = traffic >= 0;
          onRight = contra(p.INFRA_HIGHORDER) ? !trafficRight : trafficRight;
          sideStats.fallback++;
          if (process.env.CYCLE_DEBUG) log(`  side by rule: ${p.STREET_NAME} (${p.FROM_STREET} - ${p.TO_STREET}) ${p.INFRA_HIGHORDER}/${loRaw} votes R${vR} L${vL} n${n} traffic ${traffic}`);
        }
        if (onRight) { right = hi; left = lo; } else { left = hi; right = lo; }
      }
      for (const [sign, kind] of [[1, right], [-1, left]]) {
        if (kind < 0 || kind === K.signed || kind === K.trail || kind === K.parkRoad) continue;
        // which way bikes ride it: a two-way street's right side along the line, its left against it; on a one-way
        // street with the traffic, a contra-flow bikeway against it (a bi-directional track: along the line)
        const isContra = kind === K.contraflow || (kind === hi && contra(p.INFRA_HIGHORDER));
        const withLine = kind === K.track2 ? true : traffic === 0 ? sign > 0 : (traffic > 0) !== isContra;
        curbSide(S, sign, kind, withLine, isContra && traffic !== 0, `${p.STREET_NAME} (${p.FROM_STREET} - ${p.TO_STREET})`);
      }
    }
  }
}
log(`cycling network (City of Toronto) in the detailed city: ${Object.entries(km).map(([k, v]) => `${k} ${v.toFixed(1)} km`).join(', ')}`);
log(`cycling: ${bands.length} on-street band pieces (${bands.filter((b) => b[1] & 2).length} through junctions), sides from OSM ${sideStats.osm}, by rule ${sideStats.fallback}; ${trails.length} trail pieces (${trails.filter((t) => !t[2]).length} road crossings); ${mapLines.length} map lines`);

export const cycling = { kinds: CYCLE_KINDS, bands, trails, map: mapLines };
