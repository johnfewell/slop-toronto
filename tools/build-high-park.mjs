// tools/build-high-park.mjs → js/high-park-data.js
// The High Park terrain pilot (on by default, docs/high-park-terrain.md): the park's real ground (the slope down to
// Grenadier Pond, the plateau, the Spring Creek, Wendigo and western ravines) from the Ontario Elevation Mapping
// Program's GTA 2023 lidar DTM (bare earth, 0.5 m; tiles fetched by `node tools/fetch-don-valley-dtm.mjs --region
// high-park` into DON_VALLEY_DTM, default ~/.cache/slop-toronto/raw/ontario-dtm-gta2023, manifest-high-park.json), on a
// 10 m grid over a bounded box, as heights in the game's frame. The machinery is the Don Valley pilot's
// (tools/terrain-pilot-lib.mjs, js/don-valley.js); the datum and the conditioning are the park's own:
//
//   game height y = DTM elevation (m above CGVD2013) - street datum T(x, z) (m above CGVD2013)
//
// The flat city is one street level, so the 37 m that Bloor Street (113 m) stands over the Queensway (77 m) cannot show:
// both are y = 0. The park is a set of curb islands with streets all round it, so T is the DTM itself everywhere outside
// the park (y = 0 there: every street and house round it unchanged) and, inside it, the smoothest surface that meets
// those streets (a membrane: Laplace's equation with the DTM round the park as its boundary), held level across each
// pond. What the player sees is the park's relief over the streets round it: the plateau standing over the Queensway,
// the slope down to Grenadier Pond, the ravines. Unlike the Don Valley's, the surface may rise over the street level.
//
// The output keeps the grids separately (TE-1, as the Don Valley's): `raw` the DTM as sampled (each node the mean of the
// lidar pixels in its 10 m cell), `datumGrid` T, `unconditioned` DTM - T, and `height` the conditioned surface the game
// uses, with every conditioning rule recorded in `alterations`. Conditioning, in order:
//   1. park: the park's curb islands (GEO.blocks named High Park), the park roads between them and whatever they enclose
//      (a traffic island), with the houses on them (the strip between Ellis Avenue and Grenadier Pond), and Catfish Pond
//      (West Pond) with 40 m round it on Rennie Park's island; 0 outside
//   2. ponds: each pond is level, at its own water level (the DTM's water surface, hydro-flattened in the lidar), and T is
//      held level across it. A pond near the streets round the park takes their lowest level as its T (its water stands
//      as far under the lowest street by it as in reality, so no shore rises higher than it really does); one inside the
//      park floats (T level across it, at whatever height the membrane gives)
//   3. edge: the relief fades in from the park's kerbs: 0 over the sidewalk (8 m), full from 45 m (110 m among the houses,
//      which step up from Ellis Avenue to the top of the bluff over Grenadier Pond)
//   4. shores: the ground round a pond comes down to its water (no steeper than a 35% bank within 30 m) and never under
//      it; the nodes just inside a pond's outline stand at the shore, so the drawn ground meets the water at its outline
//   5. pads: the tennis courts, the rinks and the pool, and the ball diamonds are level (pads side by side at one level),
//      exactly over each and 14.5 m round it, blending out over the next 12 m; the roads leave them as they are
//   6. roads: each park road gets a profile from the 0.5 m lidar along its centreline, over the datum, smoothed along it
//      (a 45 m window); its roadway is level across, blending back to the ground over 12 m beyond its kerbs (the Don
//      Valley's rules 5 and 8)
// Footing: a building in the park stands on the highest ground under its footprint (`buildings`: [x, z, base, lowest] by
// building centre); where the ground falls away under it, the runtime adds a plinth down to its lowest ground.
// Usage: node tools/build-high-park.mjs [--out js/high-park-data.js]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadCity, openDtm, b64, smooth, segDist } from './terrain-pilot-lib.mjs';

const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, 'js/high-park-data.js');

// The pilot: the park from Bloor Street West to the Queensway, Ellis Avenue / Ellis Park Road to Parkside Drive, with
// the streets round it. Aligned to terrain.js's 60 m grid (its cells in the box are left out: the SRTM canopy mounds go).
export const BOX = { x0: -7200, x1: -5760, z0: -2940, z1: -1080, step: 10 };
const PARK = 'High Park';
// rule 3: the relief fades in from the park's kerbs (metres in from the kerb line)
const EDGE = [8, 45], EDGE_RES = 110, BLUFF = 0.7;
// the houses' islands in the strip along Ellis Avenue that are not the park's (a point in each, WGS84)
const STRIP_ISLANDS = [[43.64197, -79.47007]];
// rule 2: a pond whose outline comes within POND_CONTACT m of the streets round the park takes their lowest level
const POND_CONTACT = 80;
// rule 4: the shelf just inside a pond's outline stands SHORE_LIFT over its water (the drawn ground meets the water at
// the outline: the curb island's lawn, 0.22 m over the ground, 0.12 m over the water); the pond's bed (under the water,
// not drawn) POND_BED under it
const SHORE_LIFT = -0.1, POND_BED = 1.5, SHELF = 15, SHORE_SLOPE = 0.35;
// rule 5: pads larger than this are not levelled (m²)
const PAD_MAX = 20000;

const C = loadCity(['js/toronto-tennis.js', 'js/toronto-rinks.js']);
const dtm = openDtm(C, BOX, 'manifest-high-park.json');
const { manifest, demAt, fineAt } = dtm;

const S = BOX.step;
const nx = Math.round((BOX.x1 - BOX.x0) / S) + 1, nz = Math.round((BOX.z1 - BOX.z0) / S) + 1, N = nx * nz;
const xOf = (c) => BOX.x0 + c * S, zOf = (r) => BOX.z0 + r * S;
const inside = (p) => p.x > BOX.x0 && p.x < BOX.x1 && p.z > BOX.z0 && p.z < BOX.z1;
const cellsNear = (minX, maxX, minZ, maxZ, fn) => {
  for (let r = Math.max(0, Math.floor((minZ - BOX.z0) / S)); r <= Math.min(nz - 1, Math.ceil((maxZ - BOX.z0) / S)); r++)
    for (let c = Math.max(0, Math.floor((minX - BOX.x0) / S)); c <= Math.min(nx - 1, Math.ceil((maxX - BOX.x0) / S)); c++) fn(c, r, r * nx + c);
};
const pointInPoly = (poly, x, z) => {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) ins = !ins;
  }
  return ins;
};
const distToRing = (poly, x, z) => {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(x, z, poly[j], poly[i]).d);
  return d;
};

// --- the DTM's cell means over the box
const RAW = new Float32Array(N);
for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) RAW[r * nx + c] = demAt(xOf(c), zOf(r));

// --- 1. the park: its curb islands on a 2 m raster, closed over 12 m (the park roads between them), and each pixel's
// distance in from the park's edge (a squared Euclidean distance transform, Felzenszwalb & Huttenlocher)
const PR = 2, pw = Math.round((BOX.x1 - BOX.x0) / PR) + 1, ph = Math.round((BOX.z1 - BOX.z0) / PR) + 1;
const islands = new Set(C.BLOCKS.filter((b) => b.parkName === PARK && b.cx > BOX.x0 && b.cx < BOX.x1 && b.cz > BOX.z0 && b.cz < BOX.z1));
// (and the houses' own island in the strip between Ellis Avenue and Grenadier Pond, inside the loop of Grenadier Heights:
// it is not the park's, but it stands on the same ridge over the pond)
for (const [lat, lon] of STRIP_ISLANDS) { const w = C.worldFromLatLon(lat, lon), b = C.blockAt(w.x, w.z); if (b) islands.add(b); }
function edt(on) { // squared distance from each pixel to the nearest pixel where on() is false, in pixels²
  const INF = 1e12, f = new Float64Array(Math.max(pw, ph)), d = new Float64Array(pw * ph), v = new Int32Array(Math.max(pw, ph)), zz = new Float64Array(Math.max(pw, ph) + 1);
  const pass = (n, get, set) => {
    for (let q = 0; q < n; q++) f[q] = get(q);
    let k = 0; v[0] = 0; zz[0] = -INF; zz[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= zz[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; zz[k] = s; zz[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (zz[k + 1] < q) k++; set(q, (q - v[k]) ** 2 + f[v[k]]); }
  };
  for (let i = 0; i < pw * ph; i++) d[i] = on(i) ? INF : 0;
  for (let x = 0; x < pw; x++) pass(ph, (q) => d[q * pw + x], (q, val) => { d[q * pw + x] = val; });
  for (let y = 0; y < ph; y++) pass(pw, (q) => d[y * pw + q], (q, val) => { d[y * pw + q] = val; });
  return d;
}
const pix0 = (x, z) => { const i = Math.round((x - BOX.x0) / PR), j = Math.round((z - BOX.z0) / PR); return i < 0 || j < 0 || i >= pw || j >= ph ? -1 : j * pw + i; };
const isl = new Uint8Array(pw * ph);
for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) { const b = C.blockAt(BOX.x0 + i * PR, BOX.z0 + j * PR); if (b && islands.has(b)) isl[j * pw + i] = 1; }
const CLOSE = 12 / PR;
const outD = edt((i) => !isl[i]); // (distance from the islands, for pixels off them)
const dil = new Uint8Array(pw * ph);
for (let i = 0; i < pw * ph; i++) dil[i] = isl[i] || outD[i] <= CLOSE * CLOSE ? 1 : 0;
const backD = edt((i) => dil[i]);
const park = new Uint8Array(pw * ph);
for (let i = 0; i < pw * ph; i++) park[i] = dil[i] && backD[i] > CLOSE * CLOSE ? 1 : 0;
// (and whatever the park encloses: a traffic island in Colborne Lodge Drive, a building's own lot, is the park's; only
// what reaches the box's edge off the park, the streets round it and the neighbourhoods, is not)
let holes = 0;
{
  const seen = new Uint8Array(pw * ph), stack = [];
  for (let i = 0; i < pw; i++) for (const j of [0, ph - 1]) if (!park[j * pw + i]) { seen[j * pw + i] = 1; stack.push(j * pw + i); }
  for (let j = 0; j < ph; j++) for (const i of [0, pw - 1]) if (!park[j * pw + i] && !seen[j * pw + i]) { seen[j * pw + i] = 1; stack.push(j * pw + i); }
  while (stack.length) {
    const k = stack.pop(), i = k % pw, j = (k - i) / pw;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj, q = jj * pw + ii;
      if (ii < 0 || jj < 0 || ii >= pw || jj >= ph || seen[q] || park[q]) continue;
      seen[q] = 1; stack.push(q);
    }
  }
  for (let i = 0; i < pw * ph; i++) if (!park[i] && !seen[i]) { park[i] = 1; holes++; }
}
// (the houses on the park's islands, OpenStreetMap's residential land: the strip between Ellis Avenue and Grenadier
// Pond, the houses along Ellis Park Road, the flats by Bloor Street, are on the terrain too, stepping down to the pond on
// their plinths; RES marks them, and the relief fades in more gently from the street there, rule 3)
const RES = new Uint8Array(pw * ph);
let residential = 0;
{
  const zones = C.GEO.areas.filter(([kind]) => kind === 'zone:residential').map(([, , flat]) => {
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i], z: flat[i + 1] });
    return { pts, minX: Math.min(...pts.map((q) => q.x)), maxX: Math.max(...pts.map((q) => q.x)), minZ: Math.min(...pts.map((q) => q.z)), maxZ: Math.max(...pts.map((q) => q.z)) };
  }).filter((zn) => zn.maxX > BOX.x0 && zn.minX < BOX.x1 && zn.maxZ > BOX.z0 && zn.minZ < BOX.z1);
  for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) {
    const k = j * pw + i;
    if (!park[k]) continue;
    const x = BOX.x0 + i * PR, z = BOX.z0 + j * PR;
    if (zones.some((zn) => x > zn.minX && x < zn.maxX && z > zn.minZ && z < zn.maxZ && pointInPoly(zn.pts, x, z))) { RES[k] = 1; residential++; }
  }
}
// (Catfish Pond, OpenStreetMap's West Pond, in its two parts: on Rennie Park's island across Ellis Avenue from the park;
// the pond and 40 m round it on that island, so it stands at its own level and the island's streets stay at the street's)
let westPond = 0;
for (const w of C.POND_BODIES.filter((q) => q.name === 'West Pond')) {
  const cx = w.pts.reduce((t, q) => t + q.x, 0) / w.pts.length, cz = w.pts.reduce((t, q) => t + q.z, 0) / w.pts.length, home = C.blockAt(cx, cz);
  if (!inside({ x: cx, z: cz }) || !home) continue;
  for (let x = Math.ceil((w.minX - 40 - BOX.x0) / PR) * PR + BOX.x0; x <= w.maxX + 40; x += PR) for (let z = Math.ceil((w.minZ - 40 - BOX.z0) / PR) * PR + BOX.z0; z <= w.maxZ + 40; z += PR) {
    const k = pix0(x, z);
    if (k < 0 || park[k] || C.blockAt(x, z) !== home) continue;
    if (pointInPoly(w.pts, x, z) || distToRing(w.pts, x, z) <= 40) { park[k] = 1; westPond++; }
  }
}
const inD = edt((i) => park[i]); // (distance in from the park's edge)
const pix = (x, z) => { const i = Math.round((x - BOX.x0) / PR), j = Math.round((z - BOX.z0) / PR); return i < 0 || j < 0 || i >= pw || j >= ph ? -1 : j * pw + i; };
const parkAt = (x, z) => { const k = pix(x, z); return k >= 0 && park[k] === 1; };
const depthIn = (x, z) => { const k = pix(x, z); return k >= 0 && park[k] ? Math.sqrt(inD[k]) * PR : 0; };
const MASK = new Uint8Array(N), DIN = new Float32Array(N), FULL = new Float32Array(N), RESW = new Float32Array(N);
for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) { const k = r * nx + c; MASK[k] = parkAt(xOf(c), zOf(r)) ? 1 : 0; DIN[k] = depthIn(xOf(c), zOf(r)); }
// (rule 3's band: full relief EDGE[1] m in from the kerb, EDGE_RES m among the houses, by the share of houses within 60 m)
{
  const R60 = 30;
  for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) {
    const k = r * nx + c;
    if (!MASK[k]) continue;
    let n = 0, h = 0;
    const i0 = Math.round((xOf(c) - BOX.x0) / PR), j0 = Math.round((zOf(r) - BOX.z0) / PR);
    for (let dj = -R60; dj <= R60; dj += 3) for (let di = -R60; di <= R60; di += 3) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= pw || j >= ph) continue;
      n++; h += RES[j * pw + i];
    }
    RESW[k] = Math.min(1, (2 * h) / n);
    FULL[k] = EDGE[1] + (EDGE_RES - EDGE[1]) * RESW[k];
  }
}
const fullAt = (x, z) => { const c = Math.max(0, Math.min(nx - 1, Math.round((x - BOX.x0) / S))), r = Math.max(0, Math.min(nz - 1, Math.round((z - BOX.z0) / S))); return FULL[r * nx + c] || EDGE[1]; };
let parkPx = 0;
for (let i = 0; i < pw * ph; i++) parkPx += park[i];
const alterations = { park: { islands: [...islands].map((b) => b.id).sort((a, b) => a - b), areaHa: +((parkPx * PR * PR) / 1e4).toFixed(1), closeM: 12, enclosedM2: holes * PR * PR, residentialM2: residential * PR * PR, westPondM2: westPond * PR * PR } };

// --- 2. ponds: those in the park, their water level, their nodes
const ponds = C.POND_BODIES.filter((p) => {
  const cx = p.pts.reduce((t, q) => t + q.x, 0) / p.pts.length, cz = p.pts.reduce((t, q) => t + q.z, 0) / p.pts.length;
  return inside({ x: cx, z: cz }) && p.pts.filter((q) => parkAt(q.x, q.z)).length >= p.pts.length * 0.6;
}).map((p, i) => {
  // the water level: the median of the 0.5 m DTM on a 2 m lattice inside the outline (the lidar's water surface)
  const v = [];
  for (let x = Math.ceil(p.minX / 2) * 2; x <= p.maxX; x += 2) for (let z = Math.ceil(p.minZ / 2) * 2; z <= p.maxZ; z += 2) if (pointInPoly(p.pts, x, z)) v.push(fineAt(x, z));
  if (!v.length) for (const q of p.pts) v.push(fineAt(q.x, q.z));
  v.sort((a, b) => a - b);
  const area = Math.abs(p.pts.reduce((t, a, k) => { const b = p.pts[(k + 1) % p.pts.length]; return t + a.x * b.z - b.x * a.z; }, 0)) / 2;
  const cx = p.pts.reduce((t, q) => t + q.x, 0) / p.pts.length, cz = p.pts.reduce((t, q) => t + q.z, 0) / p.pts.length;
  return { i, body: p, name: p.name || '', cx, cz, area, water: v[v.length >> 1], spread: v[Math.floor(v.length * 0.9)] - v[Math.floor(v.length * 0.1)], nodes: [] };
});
const pondOf = new Int32Array(N).fill(-1);
for (const pd of ponds) cellsNear(pd.body.minX, pd.body.maxX, pd.body.minZ, pd.body.maxZ, (c, r, k) => { if (MASK[k] && pointInPoly(pd.body.pts, xOf(c), zOf(r))) { pondOf[k] = pd.i; pd.nodes.push(k); } });

// --- the street datum T: the DTM outside the park; inside it the membrane over it (Laplace's equation, solved by
// successive over-relaxation), each pond held level: pinned to the lowest street within POND_CONTACT m of its outline,
// or floating at the mean of its nodes
const T = Float64Array.from(RAW);
// (ponds within POND_GROUP m of each other and within POND_STEP m of each other's level, Grenadier Pond and Wendigo Pond at
// its north end, the Duck Ponds, Howard and Ridout Ponds, share one datum: their real difference in level is kept, so
// water never stands higher downstream. A pool up the slope over them is not one of them)
const POND_GROUP = 250, POND_STEP = 2;
for (const pd of ponds) {
  let lo = Infinity;
  const m = POND_CONTACT;
  cellsNear(pd.body.minX - m, pd.body.maxX + m, pd.body.minZ - m, pd.body.maxZ + m, (c, r, k) => {
    // (the streets round the park: nodes off it within 25 m of its islands)
    if (MASK[k]) return;
    const x = xOf(c), z = zOf(r), i = pix(x, z);
    if (i < 0 || Math.sqrt(outD[i]) * PR > 25) return;
    if (distToRing(pd.body.pts, x, z) <= m) lo = Math.min(lo, RAW[k]);
  });
  pd.contact = Number.isFinite(lo) ? lo : null;
}
const groups = [];
{
  const parent = ponds.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const near = (a, b) => Math.abs(a.water - b.water) < POND_STEP && a.body.maxX + POND_GROUP > b.body.minX && b.body.maxX + POND_GROUP > a.body.minX && a.body.maxZ + POND_GROUP > b.body.minZ && b.body.maxZ + POND_GROUP > a.body.minZ
    && a.body.pts.some((p) => distToRing(b.body.pts, p.x, p.z) < POND_GROUP);
  for (let i = 0; i < ponds.length; i++) for (let j = i + 1; j < ponds.length; j++) if (near(ponds[i], ponds[j])) parent[find(i)] = find(j);
  const by = new Map();
  for (const pd of ponds) { const r = find(pd.i); (by.get(r) || by.set(r, []).get(r)).push(pd); }
  for (const members of by.values()) {
    const contacts = members.filter((p) => p.contact !== null).map((p) => p.contact);
    // pinned: the lowest street by any of them, but every member's water at least 0.3 m under it
    const pin = contacts.length ? Math.max(Math.min(...contacts), Math.max(...members.map((p) => p.water)) + 0.3) : null;
    const g = { members, pin, nodes: members.flatMap((p) => p.nodes) };
    for (const p of members) p.group = g;
    groups.push(g);
  }
}
const groupOf = new Int32Array(N).fill(-1);
groups.forEach((g, i) => { for (const k of g.nodes) groupOf[k] = i; });
{
  // a first guess: the mean of the streets round the park; then successive over-relaxation, each free group of ponds one
  // unknown (the mean of the nodes round it), each pinned group fixed
  let s = 0, n = 0;
  for (let k = 0; k < N; k++) if (!MASK[k]) { s += RAW[k]; n++; }
  for (let k = 0; k < N; k++) if (MASK[k]) T[k] = s / n;
  for (const g of groups) if (g.pin !== null) for (const k of g.nodes) T[k] = g.pin;
  const free = groups.filter((g) => g.pin === null && g.nodes.length).map((g) => {
    const gi = groups.indexOf(g), nb = [];
    for (const k of g.nodes) for (const q of [k - 1, k + 1, k - nx, k + nx]) if (groupOf[q] !== gi) nb.push(q);
    return { g, nb };
  });
  const omega = 1.94;
  let it = 0, worst = Infinity;
  for (; it < 20000 && worst > 1e-4; it++) {
    worst = 0;
    for (let r = 1; r < nz - 1; r++) for (let c = 1; c < nx - 1; c++) {
      const k = r * nx + c;
      if (!MASK[k] || groupOf[k] >= 0) continue;
      const v = (T[k - 1] + T[k + 1] + T[k - nx] + T[k + nx]) / 4, d = omega * (v - T[k]);
      T[k] += d;
      if (Math.abs(d) > worst) worst = Math.abs(d);
    }
    for (const { g, nb } of free) {
      let v = 0;
      for (const q of nb) v += T[q];
      v /= nb.length;
      const d = omega * (v - T[g.nodes[0]]);
      for (const k of g.nodes) T[k] += d;
      if (Math.abs(d) > worst) worst = Math.abs(d);
    }
  }
  alterations.datum = { method: 'membrane (Laplace) over the park, the DTM round it as its boundary, level across each group of ponds', sweeps: it, residualM: +worst.toExponential(1),
    groups: groups.map((g) => ({ ponds: g.members.map((p) => p.name || '(unnamed)'), datumM: g.nodes.length ? +T[g.nodes[0]].toFixed(2) : null, pinned: g.pin !== null })) };
}
// (the bluff: the houses between Ellis Avenue and Grenadier Pond stand on a ridge 20 m over the pond, where Ellis Avenue
// is. Under the membrane alone the datum there rides Ellis Avenue's height, and the bluff came out 5-8 m. Among the
// houses within 220 m of the pond the datum comes down BLUFF of the way to the pond's, so the bluff stands BLUFF of its
// real height over the water and the houses step up to it from the street, over rule 3's wider band)
let bluffNodes = 0;
{
  const big = ponds.filter((p) => p.group.pin !== null && p.area > 20000);
  for (const pd of big) {
    const Tg = pd.group.pin;
    cellsNear(pd.body.minX - 220, pd.body.maxX + 220, pd.body.minZ - 220, pd.body.maxZ + 220, (c, r, k) => {
      if (!MASK[k] || pondOf[k] >= 0 || RESW[k] <= 0 || T[k] <= Tg) return;
      const d = distToRing(pd.body.pts, xOf(c), zOf(r)), w = RESW[k] * (1 - smooth(120, 220, d));
      if (w <= 0) return;
      T[k] += (Tg - T[k]) * BLUFF * w;
      bluffNodes++;
    });
  }
  alterations.datum.bluff = { share: BLUFF, nodes: bluffNodes, note: 'the datum among the houses by Grenadier Pond brought towards the pond\'s' };
}
for (const pd of ponds) {
  const g = pd.group;
  pd.pinned = g.pin;
  pd.datum = g.nodes.length ? T[g.nodes[0]] : null;
  // (a pond too small for a node of the grid: the datum at its centre)
  if (pd.datum === null) {
    const c = Math.round((pd.cx - BOX.x0) / S), r = Math.round((pd.cz - BOX.z0) / S);
    pd.datum = T[r * nx + c];
  }
  pd.level = pd.water - pd.datum;
}

// --- the surface: DTM - T in the park
const H0 = new Float32Array(N), H = new Float32Array(N), DATUM = Float32Array.from(T);
for (let k = 0; k < N; k++) H0[k] = MASK[k] ? RAW[k] - T[k] : 0;
H.set(H0);
// 3. edge
for (let k = 0; k < N; k++) H[k] *= MASK[k] ? smooth(EDGE[0], FULL[k], DIN[k]) : 0;
alterations.edge = { fromM: EDGE[0], fullM: EDGE[1], fullAmongHousesM: EDGE_RES, note: 'the relief fades in from the park’s kerbs: 0 over the sidewalk and verge; among the houses (the strip along Ellis Avenue) over a wider band, so they step up from the street' };
// 4. shores: each pond's nodes (and the shelf just inside its outline) and the ground round it
{
  let filled = 0, fillMax = 0, cut = 0, cutMax = 0;
  const need = new Float32Array(N).fill(-Infinity);
  for (const pd of ponds) {
    for (const k of pd.nodes) {
      const x = xOf(k % nx), z = zOf(Math.floor(k / nx));
      H[k] = distToRing(pd.body.pts, x, z) < SHELF ? pd.level + SHORE_LIFT : pd.level - POND_BED;
    }
    // the ground round it: never under its water within 60 m of its outline (fading out to 100 m)
    const m = 100;
    cellsNear(pd.body.minX - m, pd.body.maxX + m, pd.body.minZ - m, pd.body.maxZ + m, (c, r, k) => {
      if (!MASK[k] || pondOf[k] === pd.i) return;
      const d = distToRing(pd.body.pts, xOf(c), zOf(r)), w = 1 - smooth(60, 100, d);
      const floor = pd.level + SHORE_LIFT;
      // (another pond's shelf by this one, Ridout Pond's by Howard Pond: not under this one's water either)
      if (pondOf[k] >= 0) { if (d < SHELF && H[k] < floor && H[k] >= ponds[pondOf[k]].level + SHORE_LIFT - 1e-6) H[k] = floor; return; }
      if (w > 0 && H[k] < floor) { const v = H[k] + (floor - H[k]) * w; if (v - H[k] > 0.05) { filled++; fillMax = Math.max(fillMax, v - H[k]); } H[k] = v; }
      if (w > 0) need[k] = Math.max(need[k], floor);
    });
  }
  // (and no higher than a 35% bank up from the water: the ground runs down into it, no earth wall over it; never under
  // another pond's water near it, nor in the edge band, where the street level holds)
  for (const pd of ponds) cellsNear(pd.body.minX - 30, pd.body.maxX + 30, pd.body.minZ - 30, pd.body.maxZ + 30, (c, r, k) => {
    if (pondOf[k] >= 0 || !MASK[k] || DIN[k] < 25) return;
    const d = distToRing(pd.body.pts, xOf(c), zOf(r)), cap = Math.max(need[k], pd.level + SHORE_LIFT + SHORE_SLOPE * d);
    if (d < 30 && H[k] > cap) { if (H[k] - cap > 0.05) { cut++; cutMax = Math.max(cutMax, H[k] - cap); } H[k] = cap; }
  });
  alterations.shores = { ponds: ponds.length, shoreLiftM: SHORE_LIFT, shelfM: SHELF, filledSamples: filled, fillMaxM: +fillMax.toFixed(1), bankSlope: SHORE_SLOPE, cutSamples: cut, cutMaxM: +cutMax.toFixed(1) };
}
const sampleH = (x, z) => {
  const fc = Math.max(0, Math.min(nx - 1.0001, (x - BOX.x0) / S)), fr = Math.max(0, Math.min(nz - 1.0001, (z - BOX.z0) / S));
  const c = Math.floor(fc), r = Math.floor(fr), tx = fc - c, tz = fr - r, k = r * nx + c;
  return tx + tz <= 1 ? H[k] + (H[k + 1] - H[k]) * tx + (H[k + nx] - H[k]) * tz
    : H[k + nx + 1] + (H[k + nx] - H[k + nx + 1]) * (1 - tx) + (H[k + 1] - H[k + nx + 1]) * (1 - tz);
};
// 5. pads: the facilities level (PADNODE: the nodes a pad holds level, which the roads leave as they are)
const padReport = [], PADNODE = new Uint8Array(N);
{
  const pads = [];
  const ringPts = (ring) => ring.map(([x, z]) => ({ x, z }));
  for (const t of C.TENNIS.records) {
    const cs = Math.cos(t.yaw), sn = Math.sin(t.yaw), hu = t.width / 2 + 3, hv = t.length / 2 + 4;
    // (the court's frame as tennis.js onCourt: u = dx cos - dz sin across the net, v = dx sin + dz cos along the court)
    const corner = (u, v) => ({ x: t.x + u * cs + v * sn, z: t.z - u * sn + v * cs });
    pads.push({ kind: 'tennis', id: t.id, poly: [corner(-hu, -hv), corner(hu, -hv), corner(hu, hv), corner(-hu, hv)] });
  }
  for (const p of C.TENNIS.pads || []) pads.push({ kind: 'tennis pad', id: p.id, poly: ringPts(p.ring) });
  for (const r of C.RINKS.records) for (const p of r.polygons) pads.push({ kind: 'rink', id: r.assetId, name: r.name, poly: ringPts(p.outer) });
  for (const [kind, name, flat] of C.GEO.areas) {
    if (kind !== 'pitch') continue;
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i], z: flat[i + 1] });
    pads.push({ kind: 'pitch', id: name || 'pitch', poly: pts });
  }
  // pads side by side (the High Park rink's two pads and its pool, a club's courts) are one level: within 15 m of each other
  const live = pads.map((p) => {
    const bb = { minX: Math.min(...p.poly.map((q) => q.x)), maxX: Math.max(...p.poly.map((q) => q.x)), minZ: Math.min(...p.poly.map((q) => q.z)), maxZ: Math.max(...p.poly.map((q) => q.z)) };
    const area = Math.abs(p.poly.reduce((t, a, k) => { const b = p.poly[(k + 1) % p.poly.length]; return t + a.x * b.z - b.x * a.z; }, 0)) / 2;
    return { ...p, bb, area };
  }).filter((p) => parkAt((p.bb.minX + p.bb.maxX) / 2, (p.bb.minZ + p.bb.maxZ) / 2) && p.area <= PAD_MAX);
  const parent = live.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    if (a.bb.maxX + 15 < b.bb.minX || b.bb.maxX + 15 < a.bb.minX || a.bb.maxZ + 15 < b.bb.minZ || b.bb.maxZ + 15 < a.bb.minZ) continue;
    if (a.poly.some((q) => distToRing(b.poly, q.x, q.z) < 15) || b.poly.some((q) => distToRing(a.poly, q.x, q.z) < 15)) parent[find(i)] = find(j);
  }
  const groupsOf = new Map();
  live.forEach((p, i) => { const r = find(i); (groupsOf.get(r) || groupsOf.set(r, []).get(r)).push(p); });
  // each group's level: the mean of the surface over its pads (2 m lattice). Every node within PAD_FLAT m of a pad takes
  // it (any grid triangle reaching into a pad has its three nodes within 14.2 m of it, so the pad is exactly level),
  // blending back to the ground over the next 12 m
  const PAD_FLAT = 14.5;
  const target = new Float32Array(N).fill(NaN), weight = new Float32Array(N);
  for (const members of groupsOf.values()) {
    let s = 0, n = 0, lo = Infinity, hi = -Infinity;
    for (const p of members) for (let x = p.bb.minX; x <= p.bb.maxX; x += 2) for (let z = p.bb.minZ; z <= p.bb.maxZ; z += 2) if (pointInPoly(p.poly, x, z)) { const h = sampleH(x, z); s += h; n++; lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (!n || hi - lo < 0.1) continue;
    const level = s / n;
    for (const p of members) {
      cellsNear(p.bb.minX - PAD_FLAT - 12, p.bb.maxX + PAD_FLAT + 12, p.bb.minZ - PAD_FLAT - 12, p.bb.maxZ + PAD_FLAT + 12, (c, r, k) => {
        if (!MASK[k] || pondOf[k] >= 0) return;
        const x = xOf(c), z = zOf(r), d = pointInPoly(p.poly, x, z) ? 0 : distToRing(p.poly, x, z), w = 1 - smooth(PAD_FLAT, PAD_FLAT + 12, d);
        if (w > weight[k]) { weight[k] = w; target[k] = level; }
      });
      padReport.push({ kind: p.kind, id: p.id, level: +level.toFixed(2), reliefM: +(hi - lo).toFixed(1), group: members.length });
    }
  }
  let changed = 0, maxM = 0;
  for (let k = 0; k < N; k++) if (weight[k] > 0) { const v = H[k] + (target[k] - H[k]) * weight[k]; if (Math.abs(v - H[k]) > 0.05) { changed++; maxM = Math.max(maxM, Math.abs(v - H[k])); } H[k] = v; }
  for (let k = 0; k < N; k++) if (weight[k] >= 1) PADNODE[k] = 1;
  alterations.pads = { pads: padReport.length, samples: changed, maxM: +maxM.toFixed(1), list: padReport };
}
// 6. roads: profiles from the lidar along them, smoothed, level across (only where the park has relief)
const datumAt = (x, z) => {
  const fc = Math.max(0, Math.min(nx - 1.0001, (x - BOX.x0) / S)), fr = Math.max(0, Math.min(nz - 1.0001, (z - BOX.z0) / S));
  const c = Math.floor(fc), r = Math.floor(fr), tx = fc - c, tz = fr - r, k = r * nx + c;
  return (T[k] * (1 - tx) + T[k + 1] * tx) * (1 - tz) + (T[k + nx] * (1 - tx) + T[k + nx + 1] * tx) * tz;
};
const roadReport = [];
{
  const target = new Float32Array(N).fill(NaN), weight = new Float32Array(N), sumW = new Float64Array(N);
  for (const road of C.ROADS) {
    const P = road.pts;
    if (road.raised || !P.some((p) => inside(p) && parkAt(p.x, p.z))) continue;
    const st = [];
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i], b = P[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 5));
      for (let k = i ? 1 : 0; k <= n; k++) st.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    }
    // (on the park's relief at all: the 10 m grid's)
    if (!st.some((p) => inside(p) && Math.abs(sampleH(p.x, p.z)) > 0.3)) continue;
    // the lidar's road under each station (the median of three 0.5 m pixels across it) over the datum, faded in from the
    // park's edge as the ground is; 0 off the park. (The 10 m grid's cell means take in the banks beside a road cut into
    // a hillside: along Colborne Lodge Drive they made a 20% grade of the lidar's 7%)
    const h = st.map((p, i) => {
      if (!inside(p) || !parkAt(p.x, p.z) || depthIn(p.x, p.z) < EDGE[0]) return 0;
      const a = st[Math.max(0, i - 1)], b = st[Math.min(st.length - 1, i + 1)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, nX = -(b.z - a.z) / L, nZ = (b.x - a.x) / L;
      const v = [-1, 0, 1].map((o) => fineAt(p.x + nX * o, p.z + nZ * o)).sort((u, w) => u - w)[1];
      return (v - datumAt(p.x, p.z)) * smooth(EDGE[0], fullAt(p.x, p.z), depthIn(p.x, p.z));
    });
    const sm = h.map((_, i) => { let t = 0, n = 0; for (let j = Math.max(0, i - 4); j <= Math.min(h.length - 1, i + 4); j++) { t += h[j]; n++; } return t / n; });
    const half = road.w / 2;
    for (let i = 0; i + 1 < st.length; i++) {
      const a = st[i], b = st[i + 1];
      cellsNear(Math.min(a.x, b.x) - half - 14, Math.max(a.x, b.x) + half + 14, Math.min(a.z, b.z) - half - 14, Math.max(a.z, b.z) + half + 14, (c, r, k) => {
        if (!MASK[k] || pondOf[k] >= 0 || PADNODE[k]) return;
        const q = segDist(xOf(c), zOf(r), a, b), w = 1 - smooth(half + 2, half + 14, q.d);
        if (w <= 0) return;
        const wt = w ** 4;
        weight[k] = Math.max(weight[k], w);
        target[k] = (Number.isFinite(target[k]) ? target[k] * sumW[k] : 0) + (sm[i] + (sm[i + 1] - sm[i]) * q.t) * wt;
        sumW[k] += wt; target[k] /= sumW[k];
      });
    }
    roadReport.push({ name: road.name || '(unnamed)', w: road.w, pts: st, prof: sm });
  }
  let changed = 0, maxM = 0;
  for (let k = 0; k < N; k++) if (weight[k] > 0 && Number.isFinite(target[k])) {
    const v = H[k] + (target[k] - H[k]) * weight[k];
    if (Math.abs(v - H[k]) > 0.05) { changed++; maxM = Math.max(maxM, Math.abs(v - H[k])); }
    H[k] = v;
  }
  // (the 10 m grid's triangles reach past a narrow road's corridor: wherever the surface under a station still stands off
  // its profile, its triangle's three nodes move by the difference, a few times over, so the drawn road is the profile)
  // (only away from the edge band and the junctions, where two roads' profiles meet, and by 2 m at most a node)
  const fitStart = Float32Array.from(H), FIT_MAX = 2;
  const nearOther = (rd, p) => roadReport.some((o) => o !== rd && o.pts.some((q) => Math.abs(q.x - p.x) < 20 && Math.abs(q.z - p.z) < 20));
  const fitting = roadReport.map((rd) => rd.pts.map((p) => inside(p) && parkAt(p.x, p.z) && depthIn(p.x, p.z) >= EDGE[0] + 15 && !nearOther(rd, p)));
  let fitWorst = 0, fitAt = null;
  for (let it = 0; it < 40; it++) {
    fitWorst = 0;
    roadReport.forEach((rd, ri) => rd.pts.forEach((p, i) => {
      if (!fitting[ri][i]) return;
      const e = sampleH(p.x, p.z) - rd.prof[i];
      if (Math.abs(e) <= 0.02) return;
      const fc = (p.x - BOX.x0) / S, fr = (p.z - BOX.z0) / S, c = Math.min(nx - 2, Math.floor(fc)), r = Math.min(nz - 2, Math.floor(fr)), k = r * nx + c;
      const tri = fc - c + fr - r <= 1 ? [k, k + 1, k + nx] : [k + 1, k + nx, k + nx + 1];
      if (!tri.every((q) => MASK[q] && pondOf[q] < 0 && !PADNODE[q] && DIN[q] >= EDGE[0])) return;
      if (Math.abs(e) > fitWorst) { fitWorst = Math.abs(e); fitAt = [Math.round(p.x), Math.round(p.z), rd.name]; }
      for (const q of tri) H[q] = Math.max(fitStart[q] - FIT_MAX, Math.min(fitStart[q] + FIT_MAX, H[q] - e * 0.5));
    }));
    if (fitWorst <= 0.05) break;
  }
  alterations.roads = { roads: roadReport.length, samples: changed, maxM: +maxM.toFixed(1), fitWorstM: +fitWorst.toFixed(2), fitWorstAt: fitAt };
}
// (the edge again: nothing the later rules did reaches the sidewalk round the park)
for (let k = 0; k < N; k++) if (!MASK[k] || DIN[k] < EDGE[0]) H[k] = 0;

// --- footing: each building on the park's relief stands on the highest ground under it, a plinth down to its lowest
const buildings = [];
{
  let lifted = 0, sunk = 0, plinths = 0, deepest = 0;
  for (const b of C.GEO.buildings) {
    const [bx, bz, ang, parts] = b;
    if (!inside({ x: bx, z: bz })) continue;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    let lo = Infinity, hi = -Infinity;
    for (const [u0, u1, v0, v1] of parts) {
      for (let u = u0; u <= u1 + 1e-6; u += Math.max(0.5, (u1 - u0) / Math.ceil((u1 - u0) / 3))) for (let v = v0; v <= v1 + 1e-6; v += Math.max(0.5, (v1 - v0) / Math.ceil((v1 - v0) / 3))) {
        const h = sampleH(bx + u * cs + v * sn, bz - u * sn + v * cs);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
    }
    if (Math.abs(hi) < 0.05 && lo > -0.3) continue;
    buildings.push([bx, bz, +hi.toFixed(2), +lo.toFixed(2)]);
    if (hi > 0.05) lifted++; else if (hi < -0.05) sunk++;
    if (lo < hi - 0.3) { plinths++; deepest = Math.max(deepest, hi - lo); }
  }
  alterations.footing = { policy: 'the building stands on the highest ground under it; foundation walls down to its lowest', buildings: buildings.length, lifted, sunk, plinths, deepestPlinthM: +deepest.toFixed(1) };
}

// --- diagnostics: the park roads' grades, the pond levels, the edge, the places the captures look at
const diagnostics = { gradeBaseM: 20, roads: [] };
function lidarGrade(pts, at) {
  const st = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    for (let k = i ? 1 : 0; k <= n; k++) st.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  const y = st.map((p) => fineAt(p.x, p.z));
  let s = 0, worst = 0;
  const cum = st.map((p, i) => (s += i ? Math.hypot(p.x - st[i - 1].x, p.z - st[i - 1].z) : 0));
  for (let i = 0, j = 0; i < st.length; i++) {
    while (j < st.length && cum[j] - cum[i] < 20) j++;
    if (j >= st.length) break;
    if (Math.min(Math.hypot(st[i].x - at[0], st[i].z - at[1]), Math.hypot(st[j].x - at[0], st[j].z - at[1])) > 30) continue;
    worst = Math.max(worst, Math.abs(y[j] - y[i]) / (cum[j] - cum[i]));
  }
  return worst;
}
for (const rd of roadReport) {
  let maxGrade = 0, at = null, lo = Infinity, hi = -Infinity;
  const y = rd.pts.map((p) => (inside(p) ? sampleH(p.x, p.z) : 0));
  for (let i = 4; i < rd.pts.length; i++) {
    let L = 0;
    for (let k = i - 3; k <= i; k++) L += Math.hypot(rd.pts[k].x - rd.pts[k - 1].x, rd.pts[k].z - rd.pts[k - 1].z);
    if (L < 1) continue;
    const g = Math.abs(y[i] - y[i - 4]) / L;
    if (g > maxGrade) { maxGrade = g; at = [Math.round(rd.pts[i - 4].x), Math.round(rd.pts[i - 4].z)]; }
  }
  for (const v of y) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const e = { name: rd.name, lowestM: +lo.toFixed(1), highestM: +hi.toFixed(1), maxGradePct: +(maxGrade * 100).toFixed(1), at, review: maxGrade > 0.12 };
  // a review's recorded resolution: the road's own slope in the lidar (the steepest 20 m of the 0.5 m DTM along its
  // centreline within 30 m of the spot)
  if (e.review) e.lidarPct = +(100 * lidarGrade(rd.pts, at)).toFixed(1);
  diagnostics.roads.push(e);
}
diagnostics.roads.sort((a, b) => b.maxGradePct - a.maxGradePct);
{
  let lo = Infinity, hi = -Infinity, loAt = null, hiAt = null, edge = 0;
  for (let k = 0; k < N; k++) {
    if (H[k] < lo) { lo = H[k]; loAt = [xOf(k % nx), zOf(Math.floor(k / nx))]; }
    if (H[k] > hi) { hi = H[k]; hiAt = [xOf(k % nx), zOf(Math.floor(k / nx))]; }
    if (!MASK[k]) edge = Math.max(edge, Math.abs(H[k]));
  }
  diagnostics.lowestM = +lo.toFixed(1); diagnostics.lowestAt = loAt; diagnostics.highestM = +hi.toFixed(1); diagnostics.highestAt = hiAt;
  diagnostics.offParkMaxM = edge;
  diagnostics.ponds = ponds.map((p) => ({ name: p.name, waterM: +p.water.toFixed(2), spreadM: +p.spread.toFixed(2), datumM: +p.datum.toFixed(1), level: +p.level.toFixed(2), pinned: p.pinned !== null, areaM2: Math.round(p.area) }));
  const at = (lat, lon) => { const w = C.worldFromLatLon(lat, lon); return { x: +w.x.toFixed(0), z: +w.z.toFixed(0), y: +sampleH(w.x, w.z).toFixed(1), dtm: +demAt(w.x, w.z).toFixed(1) }; };
  diagnostics.places = {
    bloorGate: at(43.6534, -79.4652), cafe: at(43.64553, -79.46605), pool: at(43.64949, -79.4653), dogHill: at(43.64681, -79.46366),
    grenadierEastSlope: at(43.6445, -79.4668), grenadierPond: at(43.643, -79.468), springCreekRavine: at(43.6465, -79.4592),
    colborneLodge: at(43.64043, -79.46), queenswayGate: at(43.6393, -79.4598), wendigoPond: at(43.6492, -79.4706)
  };
}

// --- write
const out = {
  version: 1, kind: 'high-park', name: PARK,
  source: { dataset: manifest.dataset, file: `${manifest.tiles.length} tiles (tools/fetch-don-valley-dtm.mjs --region high-park; manifest-high-park.json)`, resolutionM: manifest.tiles[0].pixelM,
    retrieved: manifest.retrieved, tiles: manifest.tiles.map((t) => ({ tile: t.tile, sha256: t.sha256 })),
    licence: `${manifest.licence} (${manifest.licenceUrl}); see CREDITS.md`, attribution: manifest.attribution },
  crs: { horizontal: 'js/toronto-geodata.js world frame: WGS84 lat/lon on a tangent plane at Union Station, turned -16.59 deg (GEO.frame.projection); the DTM: NAD83(CSRS) / UTM zone 17N (EPSG:2958)',
    vertical: 'DTM: metres above CGVD2013 (EPSG:6647); game: metres above the local street datum T' },
  datum: 'y = DTM - T(x, z); T = the DTM outside the park, the membrane (Laplace) over it inside, level across each pond',
  box: BOX, nx, nz, edge: EDGE,
  units: { raw: 'decimetres above CGVD2013 (the cell mean)', datum: 'decimetres above CGVD2013', height: 'centimetres above the street datum', unconditioned: 'centimetres above the street datum', ponds: 'level: metres above the street datum', buildings: '[x, z, base, lowest]: metres above the street datum' },
  alterations, diagnostics,
  ponds: ponds.map((p) => ({ name: p.name, cx: +p.cx.toFixed(1), cz: +p.cz.toFixed(1), level: +p.level.toFixed(2) })),
  buildings,
  height: b64(H, 100), raw: b64(RAW, 10), datumGrid: b64(DATUM, 10), unconditioned: b64(H0, 100)
};
const js = `// js/high-park-data.js — GENERATED by tools/build-high-park.mjs, do not edit by hand.
// The High Park terrain pilot's surface (on by default; docs/high-park-terrain.md): heights on a ${S} m grid over the
// box, from the Ontario GTA 2023 lidar DTM (Open Government Licence – Ontario). Always loaded (explore.html).
(function () {
window.CITY = window.CITY || {};
window.CITY.HIGH_PARK_DATA = ${JSON.stringify(out)};
})();
`;
fs.writeFileSync(OUT, js);
console.log(`[high-park] ${nx} x ${nz} at ${S} m; park ${alterations.park.areaHa} ha; lowest ${diagnostics.lowestM} m at ${diagnostics.lowestAt}, highest ${diagnostics.highestM} m at ${diagnostics.highestAt}`);
console.log(`[high-park] ${JSON.stringify({ ...alterations, pads: { ...alterations.pads, list: undefined } })}`);
for (const p of diagnostics.ponds) console.log(`[high-park]   pond ${p.name.padEnd(18)} water ${p.waterM} m (spread ${p.spreadM}), datum ${p.datumM} ${p.pinned ? 'pinned' : 'floating'}, level ${p.level} m`);
for (const [k, v] of Object.entries(diagnostics.places)) console.log(`[high-park]   ${k.padEnd(20)} ${JSON.stringify(v)}`);
for (const r of diagnostics.roads) console.log(`[high-park]   ${r.name.padEnd(26)} ${String(r.lowestM).padStart(6)}..${String(r.highestM).padStart(6)} m, max grade ${String(r.maxGradePct).padStart(5)} % at ${r.at}${r.review ? `  REVIEW (> 12 %; the lidar's own ${r.lidarPct} %)` : ''}`);
console.log(`[high-park] wrote ${path.relative(ROOT, OUT)} (${(js.length / 1024).toFixed(0)} KB)`);
