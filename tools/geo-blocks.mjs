// Part 4: Abuja's blocks ("curb islands") from the street network, by rasterising every at-grade carriageway at its
// width over the land of the detailed city (minus lakes & reservoirs), then labelling what's left. Each block: its curb
// outline, axis-aligned lot rects inside its property line (the curb less the sidewalk / verge), metadata.
import { Raster, rdpRing, ringArea, log, load, toWorld } from './geo-base.mjs';
import { DETAIL, rasterRoads } from './geo-roads.mjs';
import { waterRings, islandRings, lake } from './geo-land.mjs';

export const SIDEWALK = 4.6; // property line in from the curb: walkway & planted verge with its drain
const RES = 1;

// --- 1 m raster of the detailed city: land minus water, roadways stamped as capsules ---------------------------------
const R = new Raster(DETAIL.x0, DETAIL.z0, DETAIL.x1, DETAIL.z1, RES);
R.d.fill(1);
// the lake first, its islands back to land, then the other water (the Islands' lagoons among it)
if (lake) R.fillRing(lake.ring, 0);
for (const ring of islandRings) R.fillRing(ring, 1);
for (const ring of waterRings) if (!lake || ring !== lake.ring) R.fillRing(ring, 0);
const W = R.w, H = R.h, D = R.d;
// Toronto: the City's own road surface (city_roadway.json, tools/fetch-roadway.mjs) is the roadway; the OSM centre lines
// only carve a thin connector (2 m either side, inside any real street) where the City maps no surface
let cityRoadway = null;
try { cityRoadway = process.env.NO_CITY_ROADWAY ? null : load('city_roadway.json').polygons; } catch { cityRoadway = null; }
const CONNECTOR = 2.0;
for (const s0 of rasterRoads) {
  const s = cityRoadway ? { ...s0, r: Math.min(s0.r, CONNECTOR) } : s0;
  const ix0 = Math.max(0, Math.floor((Math.min(s.x0, s.x1) - s.r - R.x0) / RES));
  const ix1 = Math.min(W - 1, Math.ceil((Math.max(s.x0, s.x1) + s.r - R.x0) / RES));
  const iz0 = Math.max(0, Math.floor((Math.min(s.z0, s.z1) - s.r - R.z0) / RES));
  const iz1 = Math.min(H - 1, Math.ceil((Math.max(s.z0, s.z1) + s.r - R.z0) / RES));
  if (ix0 > ix1 || iz0 > iz1) continue;
  const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
  const L2 = dx * dx + dz * dz || 1e-9;
  const r2 = s.r * s.r;
  for (let j = iz0; j <= iz1; j++) {
    const pz = R.z0 + (j + 0.5) * RES;
    for (let i = ix0; i <= ix1; i++) {
      const k = j * W + i;
      if (!D[k]) continue;
      const px = R.x0 + (i + 0.5) * RES;
      let t = ((px - s.x0) * dx + (pz - s.z0) * dz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = s.x0 + t * dx - px, ez = s.z0 + t * dz - pz;
      if (ex * ex + ez * ez <= r2) D[k] = 0;
    }
  }
}
if (cityRoadway) {
  for (const [, ring] of cityRoadway) R.fillRing(ring.map(([lon, lat]) => toWorld(lon, lat)), 0);
  log(`City road surface: ${cityRoadway.length} polygons drawn as roadway`);
}
// the raster's rim: no block runs off the detailed area (they'd have no streets on that side)
for (let i = 0; i < W; i++) { D[i] = 0; D[(H - 1) * W + i] = 0; }
for (let j = 0; j < H; j++) { D[j * W] = 0; D[j * W + W - 1] = 0; }
log(`block raster ${W} x ${H} (${(W * H / 1e6).toFixed(0)}M cells), ${rasterRoads.length} roadway pieces stamped`);

// --- Label curb islands (4-connected) --------------------------------------------------------------------------------
const lab = new Int32Array(W * H);
const comps = [];
{
  const stack = new Int32Array(Math.min(W * H, 1.2e8));
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!D[s0] || lab[s0]) continue;
    const id = comps.length + 1;
    let sp = 0, n = 0, i0 = W, i1 = -1, j0 = H, j1 = -1;
    stack[sp++] = s0;
    lab[s0] = id;
    while (sp) {
      const p = stack[--sp];
      n++;
      const i = p % W, j = (p - i) / W;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
      if (i > 0 && D[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (i < W - 1 && D[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (j > 0 && D[p - W] && !lab[p - W]) { lab[p - W] = id; stack[sp++] = p - W; }
      if (j < H - 1 && D[p + W] && !lab[p + W]) { lab[p + W] = id; stack[sp++] = p + W; }
    }
    comps.push({ id, n, i0, i1, j0, j1, start: s0 });
  }
}
log(`${comps.length} curb islands labelled`);

// --- Contour of one component (corner walk keeping the component on the right, as Raster.traceOuter) ---------------
function traceComponent(c) {
  const at = (i, j) => (i >= 0 && j >= 0 && i < W && j < H && lab[j * W + i] === c.id ? 1 : 0);
  const si = c.start % W, sj = (c.start - si) / W;
  const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
  let cx = si, cz = sj, dir = 0;
  const pts = [];
  const start = cx + ',' + cz + ',' + dir;
  let guard = 0;
  do {
    pts.push([R.x0 + cx * RES, R.z0 + cz * RES]);
    cx += DX[dir];
    cz += DZ[dir];
    let left, right;
    if (dir === 0) { left = at(cx, cz - 1); right = at(cx, cz); }
    else if (dir === 1) { left = at(cx, cz); right = at(cx - 1, cz); }
    else if (dir === 2) { left = at(cx - 1, cz); right = at(cx - 1, cz - 1); }
    else { left = at(cx - 1, cz - 1); right = at(cx, cz - 1); }
    if (left && right) dir = (dir + 3) % 4;
    else if (!right) dir = (dir + 1) % 4;
    if (++guard > 4e6) break;
  } while (cx + ',' + cz + ',' + dir !== start);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i + pts.length - 1) % pts.length], q = pts[i], n = pts[(i + 1) % pts.length];
    if ((q[0] - p[0]) * (n[1] - q[1]) - (q[1] - p[1]) * (n[0] - q[0]) !== 0) out.push(q);
  }
  return destair(out, RES * 1.5);
}

// Raster stairs -> lines: short edges (stair steps) are replaced by their midpoints, vertices between two long edges
// (true corners) are kept
export function destair(out, short) {
  const n = out.length;
  const len = (i) => { const a = out[i], b = out[(i + 1) % n]; return Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]); };
  const res = [];
  for (let i = 0; i < n; i++) {
    const prevLong = len((i + n - 1) % n) > short;
    const nextLong = len(i) > short;
    if (prevLong && nextLong) res.push(out[i]);
    if (!nextLong) { const a = out[i], b = out[(i + 1) % n]; res.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }
  }
  return res;
}

// --- Property line: square erosion of each island by the sidewalk width (keeps grid blocks rectangular) -------------
const ER = Math.round(SIDEWALK / RES);
const prop = new Uint8Array(W * H);
{
  // erosion along x then z with running counts of non-matching cells (same label required)
  const tmp = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const row = j * W;
    let run = 0; // consecutive same-label cells ending at i
    const left = new Int32Array(W), right = new Int32Array(W);
    for (let i = 0; i < W; i++) {
      const L = lab[row + i];
      run = L && i > 0 && lab[row + i - 1] === L ? run + 1 : L ? 1 : 0;
      left[i] = run;
    }
    run = 0;
    for (let i = W - 1; i >= 0; i--) {
      const L = lab[row + i];
      run = L && i < W - 1 && lab[row + i + 1] === L ? run + 1 : L ? 1 : 0;
      right[i] = run;
    }
    for (let i = 0; i < W; i++) tmp[row + i] = lab[row + i] && left[i] > ER && right[i] > ER ? 1 : 0;
  }
  const up = new Int32Array(H), dn = new Int32Array(H);
  for (let i = 0; i < W; i++) {
    let run = 0;
    for (let j = 0; j < H; j++) {
      const k = j * W + i, L = lab[k];
      run = L && j > 0 && lab[k - W] === L ? run + 1 : L ? 1 : 0;
      up[j] = run;
    }
    run = 0;
    for (let j = H - 1; j >= 0; j--) {
      const k = j * W + i, L = lab[k];
      run = L && j < H - 1 && lab[k + W] === L ? run + 1 : L ? 1 : 0;
      dn[j] = run;
    }
    for (let j = 0; j < H; j++) prop[j * W + i] = tmp[j * W + i] && up[j] > ER && dn[j] > ER ? 1 : 0;
  }
}

// --- Greedy axis-aligned lot rects in a component's property region (largest rectangle in a histogram) ---------------
// maskRects: on a w x h 0/1 mask (cleared as it goes), up to maxRects rects [i0, i1, j0, j1] (cells, inclusive) of at
// least minSide x minSide cells and 120 cells, until 93% of the mask is covered
export function maskRects(m, w, h, maxRects = 8, minSide = 8) {
  let total = 0;
  for (let k = 0; k < w * h; k++) total += m[k];
  const rects = [];
  const hist = new Int32Array(w);
  const stack = new Int32Array(w + 1);
  let covered = 0;
  for (let it = 0; it < maxRects; it++) {
    hist.fill(0);
    let best = 0, bi0 = 0, bi1 = 0, bj0 = 0, bj1 = 0;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) hist[i] = m[j * w + i] ? hist[i] + 1 : 0;
      let sp = 0;
      for (let i = 0; i <= w; i++) {
        const hh = i < w ? hist[i] : 0;
        while (sp && hist[stack[sp - 1]] >= hh) {
          const top = stack[--sp];
          const height = hist[top];
          const left = sp ? stack[sp - 1] + 1 : 0;
          const width = i - left;
          // lots need some depth both ways: penalise slivers
          if (height >= minSide && width >= minSide) {
            const area = height * width;
            if (area > best) { best = area; bi0 = left; bi1 = i - 1; bj0 = j - height + 1; bj1 = j; }
          }
        }
        stack[sp++] = i;
      }
    }
    if (best < 120 || (rects.length && best < total * 0.06)) break;
    rects.push([bi0, bi1, bj0, bj1]);
    covered += best;
    for (let j = bj0; j <= bj1; j++) for (let i = bi0; i <= bi1; i++) m[j * w + i] = 0;
    if (covered > total * 0.93) break;
  }
  return { rects, total, covered };
}
function lotRects(c, maxRects = 8) {
  const w = c.i1 - c.i0 + 1, h = c.j1 - c.j0 + 1;
  const m = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = (c.j0 + j) * W + c.i0 + i;
    if (prop[k] && lab[k] === c.id) m[j * w + i] = 1;
  }
  const { rects, total, covered } = maskRects(m, w, h, maxRects);
  return {
    rects: rects.map(([i0, i1, j0, j1]) => [R.x0 + (c.i0 + i0) * RES, R.x0 + (c.i0 + i1 + 1) * RES, R.z0 + (c.j0 + j0) * RES, R.z0 + (c.j0 + j1 + 1) * RES]),
    propArea: total,
    covered
  };
}

// --- Assemble blocks ---------------------------------------------------------------------------------------------------
// A median: a long thin island between the two carriageways of a dual road (its mean width, 2·area / perimeter, under 9 m)
const blocks = [];
let small = 0;
for (const c of comps) {
  const area = c.n * RES * RES;
  if (area < 40) { small++; continue; }
  let poly = traceComponent(c);
  poly = rdpRing(poly, 0.5);
  if (poly.length < 3) continue;
  if (ringArea(poly) > 0) poly.reverse();
  let per = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    per += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const median = (2 * area) / per < 9 && area < 60000;
  const bw = (c.i1 - c.i0 + 1) * RES, bd = (c.j1 - c.j0 + 1) * RES;
  const rectness = area / (bw * bd);
  const { rects } = area >= 300 && !median ? lotRects(c, area > 200000 ? 16 : 8) : { rects: [] };
  blocks.push({
    id: blocks.length,
    poly,
    area: Math.round(area),
    bbox: [R.x0 + c.i0 * RES, R.x0 + (c.i1 + 1) * RES, R.z0 + c.j0 * RES, R.z0 + (c.j1 + 1) * RES],
    rect: rectness > 0.985,
    rects,
    median,
    _lab: c.id
  });
}
log(`${blocks.length} blocks (${blocks.filter((b) => b.rect).length} rectangular, ${blocks.filter((b) => b.median).length} medians); ${small} specks dropped`);

export { blocks, R as blockRaster, lab as blockLabels };
