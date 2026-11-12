#!/usr/bin/env node
// tools/build-waterfront-dinghies.mjs
//
// Traces the small stored-dinghy group the 2024 City of Toronto orthophoto shows beside the reviewed QCYC shed
// (st-sb3r.38), converts each bright hull cluster to world coordinates, measures its extent, and writes:
//   - js/waterfront-dinghies-data.js  (source-attributed placement plan)
//   - assets/models/waterfront-dinghies/placement-preview.svg/.png  (top-view preview for the captain)
//
// Source (reference only; nothing is traced into shipped textures)
//   Orthophoto: https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2024_color_8cm/MapServer
//   The captain's georeferenced export: $WATERFRONT_RESEARCH/width-audit/nottawa-outliers-ortho2024.{png,json}
//   2024 leaf-on colour, 8 cm native; the export is 140 m × 140 m at 1200 px (~0.0845 ground m/px), square extent.
//   OGL – Toronto. It is a 2024 SEASONAL STORAGE snapshot, not a current fleet map; no exact boat identity is claimed.
//
// Method
//   The bright (white-ish) hull tops form clusters in the storage yard east/southeast of the reviewed shed. The builder
//   scans the pixel band the captain identified (around the shed's south-east apron), clusters bright pixels, measures
//   each cluster's ground extent from the image's own ground scale, and rejects clusters that are not open-hull sized or
//   that fall on water / a building / a mapped lane / the OSM marina water. Rejected clusters are DROPPED, never moved.
//
// Usage
//   node tools/build-waterfront-dinghies.mjs \
//        [--ortho $WATERFRONT_RESEARCH/width-audit/nottawa-outliers-ortho2024.png] \
//        [--ortho-json $WATERFRONT_RESEARCH/width-audit/nottawa-outliers-ortho2024.json] \
//        [--out js/waterfront-dinghies-data.js] [--preview assets/models/waterfront-dinghies/placement-preview] [--check]
//
// Exit: 0 wrote/verified, 1 a missing source or parse error. Offline: no fetch.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { decodeGeo } from '../js/geodata-loader.js';
import os from 'node:os';
// Private research cache (reference downloads that never ship): set WATERFRONT_RESEARCH to its folder.
const WATERFRONT_RESEARCH = process.env.WATERFRONT_RESEARCH || path.join(os.tmpdir(), 'waterfront-research');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, f) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : f; };
const CHECK = argv.includes('--check');
const fail = (m) => { console.error(`build-waterfront-dinghies: ${m}`); process.exit(1); };

const ORTHO = arg('--ortho', path.join(WATERFRONT_RESEARCH, 'width-audit/nottawa-outliers-ortho2024.png'));
const ORTHO_JSON = arg('--ortho-json', path.join(WATERFRONT_RESEARCH, 'width-audit/nottawa-outliers-ortho2024.json'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'js/waterfront-dinghies-data.js')));
// The placement preview embeds the source orthophoto for captain review only. It must NOT live in the repo at all (the
// site build copies assets/, and a copyrighted ortho must never ship or be committed), so it defaults OUTSIDE the repo.
const PREVIEW = path.resolve(arg('--preview', path.join(WATERFRONT_RESEARCH, 'dinghy-preview/placement')));
const BIN = path.join(ROOT, 'data/toronto-geodata.bin');

// The captain-identified storage band (source pixels): east/south-east of the reviewed shed (shed centre ~807,368).
const BAND = { x0: 828, x1: 978, y0: 382, y1: 500 };
// Open-hull size gates (metres), NOT a boat identity claim: the source hulls are small open dinghies.
const MIN_HULL_M = 1.6;
const MAX_HULL_M = 5.2;
const MAX_HULL_W = 2.4;      // an open dinghy is ~1.4-1.8 m wide; >~2.4 m is not a single hull
// A stored-dinghy ROW reads as a dense white blob, not an isolated 2:1 hull: adjacent hulls and racks merge, so the
// cluster extent is roughly square (measured aspect ~1.05-1.3). We therefore do NOT gate on aspect; each cluster is a
// small stored group, and the generic hull is placed at its centre, sized from the cluster. A boat identity is never
// claimed.
// The marina polygon (OSM Way 193043084) and the reviewed-shed building; a stored hull must not be on open water, a
// building footprint, a mapped lane, or outside the dry storage area.
const MARINA_WAY = 193043084;

const { GEO } = decodeGeo((() => {
  let u8 = new Uint8Array(fs.readFileSync(BIN));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
})());
const P = GEO.frame.projection;
const toWorld = (lon, lat) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
  const c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
};

if (!fs.existsSync(ORTHO)) fail(`ortho not found: ${ORTHO}`);
if (!fs.existsSync(ORTHO_JSON)) fail(`ortho json not found: ${ORTHO_JSON}`);
const man = JSON.parse(fs.readFileSync(ORTHO_JSON, 'utf8'));
const R = 6378137;
const [mx0, my0, mx1, my1] = man.bbox3857;
const [W, H] = man.size;
const mpp = man.groundMetresPerPixel;
const pixelToWorld = (px, py) => {
  const mx = mx0 + (px / W) * (mx1 - mx0), my = my1 - (py / H) * (my1 - my0); // y down
  const lon = mx / R * 180 / Math.PI, lat = (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) * 180 / Math.PI;
  return toWorld(lon, lat);
};

// --- water mask (GEO.waterMask) and building/lane tests, to reject a hull on the wrong surface ----------------------
const M = GEO.waterMask;
const runs = new Uint16Array(Buffer.from(M.runs, 'base64').buffer.slice(0));
const wet = new Uint8Array(M.w * M.h);
{ let k = 0; for (let j = 0; j < M.h; j++) { let i = 0, v = 0; while (i < M.w) { const n = runs[k++]; if (v) wet.fill(1, j * M.w + i, j * M.w + i + n); i += n; v ^= 1; } if (v === 0 && runs[k] === 0) k++; } }
const isWater = (x, z) => { const i = Math.floor((x - M.x0) / M.res), j = Math.floor((z - M.z0) / M.res); return i >= 0 && j >= 0 && i < M.w && j < M.h && !!wet[j * M.w + i]; };
const bdist = (x, z) => { let best = Infinity; for (const b of GEO.buildings || []) { const [cx, cz, ang, rects] = b; const dx = x - cx, dz = z - cz, c = Math.cos(ang), s = Math.sin(ang); const u = dx * c - dz * s, v = dx * s + dz * c; for (const r of rects) { const du = Math.max(r[0] - u, 0, u - r[1]), dv = Math.max(r[2] - v, 0, v - r[3]); best = Math.min(best, Math.hypot(du, dv)); } } return best; };
const LANES = (() => { const ctx = { window: { CITY: {} }, Math, JSON, Number, Array }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/waterfront-island-lanes-data.js'), 'utf8'), ctx); return ctx.window.CITY.ISLAND_LANES_DATA.runs || []; })();
const seg = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz; let t = L > 0 ? ((px - ax) * dx + (pz - az) * dz) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (ax + dx * t), pz - (az + dz * t)); };
const laneDist = (x, z) => { let best = Infinity; for (const r of LANES) for (let i = 0; i + 1 < r.points.length; i++) best = Math.min(best, seg(x, z, r.points[i][0], r.points[i][1], r.points[i + 1][0], r.points[i + 1][1])); return best; };
const tdist = (x, z) => { let best = Infinity; const ST = GEO.streetTrees || []; for (let i = 0; i < ST.length; i += 4) best = Math.min(best, Math.hypot(x - ST[i], z - ST[i + 1])); return best; };

// --- read the image pixels (raw RGB) --------------------------------------------------------------------------------
const raw = execFileSync('magick', [ORTHO, '-depth', '8', 'rgb:-'], { maxBuffer: 1 << 28 });
const rgb = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return null; const o = (y * W + x) * 3; return [raw[o], raw[o + 1], raw[o + 2]]; };
const bright = (c) => c && c[0] > 200 && c[1] > 200 && c[2] > 200;

// Bright-pixel clusters in the band, 8-connected on a 2 px stride (the hulls are ~1.4–4 m, tens of px).
const pts = new Set();
for (let y = BAND.y0; y <= BAND.y1; y += 2) for (let x = BAND.x0; x <= BAND.x1; x += 2) if (bright(rgb(x, y))) pts.add(x + y * W);
const seen = new Set();
const clusters = [];
for (const key of pts) {
  if (seen.has(key)) continue;
  const stack = [key]; const comp = [];
  while (stack.length) {
    const q = stack.pop(); if (seen.has(q)) continue; seen.add(q); comp.push(q);
    const x = q % W, y = (q - x) / W;
    for (let dx = -2; dx <= 2; dx += 2) for (let dy = -2; dy <= 2; dy += 2) { const n = (x + dx) + (y + dy) * W; if (pts.has(n) && !seen.has(n)) stack.push(n); }
  }
  if (comp.length >= 4) clusters.push(comp);
}

// Principal-axis (PCA) oriented bounds of one bright component, in PIXELS. The stored hulls lie diagonally, so an
// axis-aligned bounding box both inflates the width and destroys the length/width split; the principal eigenvector of
// the pixel scatter gives the true long axis, and the extents along it / across it give an oriented length and width.
function orientedBounds(comp) {
  const n = comp.length;
  let sx = 0, sy = 0;
  for (const k of comp) { sx += k % W; sy += (k - (k % W)) / W; }
  const mx = sx / n, my = sy / n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (const k of comp) { const dx = (k % W) - mx, dy = (k - (k % W)) / W - my; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; }
  cxx /= n; cyy /= n; cxy /= n;
  // principal eigenvector of the 2×2 covariance (largest eigenvalue)
  const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
  // eigenvector for l1
  let ex, ey;
  if (Math.abs(cxy) > 1e-9) { ex = l1 - cyy; ey = cxy; }
  else { ex = (cxx >= cyy) ? 1 : 0; ey = (cxx >= cyy) ? 0 : 1; }
  const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
  // project every point on (ex,ey) and its perpendicular; oriented half-extents
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const k of comp) { const px = k % W, py = (k - (k % W)) / W; const rx = px - mx, ry = py - my; const u = rx * ex + ry * ey, v = -rx * ey + ry * ex; if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v; }
  // centre of the oriented box (mid of the u,v extents, back to pixels)
  const uc = (minU + maxU) / 2, vc = (minV + maxV) / 2;
  const cxp = mx + uc * ex - vc * ey, cyp = my + uc * ey + vc * ex;
  return { cx: cxp, cy: cyp, ex, ey, lenPx: maxU - minU, widPx: maxV - minV };
}

// Full oriented-hull clearance: sample the hull's four oriented-rectangle edges (and centre) and return the MINIMUM
// distance from any of them to a building / mapped lane / water cell, so a hull that overhangs a lane or water is
// rejected rather than accepted on its centre alone. `footprint` is in metres: half-length × half-width, yaw.
function footprintSamples(cx, cz, halfLen, halfWid, yaw, n = 6) {
  const ux = Math.sin(yaw), uz = Math.cos(yaw);   // world long axis (matches the data yaw convention below)
  const wx = Math.cos(yaw), wz = -Math.sin(yaw);  // across
  const pts2 = [[cx, cz]];
  for (const su of [-1, 1]) for (const sv of [-1, 1]) pts2.push([cx + su * halfLen * ux + sv * halfWid * wx, cz + su * halfLen * uz + sv * halfWid * wz]);
  for (let i = 1; i < n; i++) { const t = -1 + 2 * i / n; pts2.push([cx + t * halfLen * ux + halfLen * wx, cz + t * halfLen * uz + halfLen * wz]); pts2.push([cx + t * halfLen * ux - halfLen * wx, cz + t * halfLen * uz - halfLen * wz]); }
  return pts2;
}

const rejected = { tooSmall: 0, tooLarge: 0, tooWide: 0, building: 0, water: 0, lane: 0, tree: 0 };
const hulls = [];
for (const comp of clusters) {
  const ob = orientedBounds(comp);
  // +1 px on each dimensional extent for the 2-px sampling stride
  const length = (ob.lenPx + 2) * mpp, width = (ob.widPx + 2) * mpp;
  if (length < MIN_HULL_M) { rejected.tooSmall++; continue; }
  if (length > MAX_HULL_M) { rejected.tooLarge++; continue; }
  if (width > MAX_HULL_W) { rejected.tooWide++; continue; }
  const [x, z] = pixelToWorld(ob.cx, ob.cy);
  // world orientation: project a point along the PIXEL principal axis into world, then measure the world axis
  const [wx2, wz2] = pixelToWorld(ob.cx + ob.ex * 20, ob.cy + ob.ey * 20);
  const yaw = Math.atan2(wx2 - x, wz2 - z); // world long-axis heading (atan2(dx, dz)); data stores this
  // Full oriented-hull clearance (not the centre alone).
  const halfLen = length / 2, halfWid = width / 2;
  const samples = footprintSamples(x, z, halfLen, halfWid, yaw);
  let bMin = Infinity, lMin = Infinity, tMin = Infinity, wet = false;
  for (const [sx2, sz2] of samples) { bMin = Math.min(bMin, bdist(sx2, sz2)); lMin = Math.min(lMin, laneDist(sx2, sz2)); tMin = Math.min(tMin, tdist(sx2, sz2)); if (isWater(sx2, sz2)) wet = true; }
  if (bMin < 0.3) { rejected.building++; continue; }
  if (wet) { rejected.water++; continue; }
  if (lMin < 1.2) { rejected.lane++; continue; }
  if (tMin < 0.8) { rejected.tree++; continue; }
  hulls.push({
    px: Math.round(ob.cx), py: Math.round(ob.cy),
    x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100,
    lengthM: Math.round(length * 100) / 100, widthM: Math.round(width * 100) / 100,
    yaw: Math.round(yaw * 1000) / 1000,
    ex: ob.ex, ey: ob.ey, // pixel principal axis (for the preview rotation)
    buildingM: Math.round(bMin * 10) / 10,
    laneM: Math.round(lMin * 10) / 10,
    treeM: Math.round(tMin * 10) / 10
  });
}
hulls.sort((a, b) => a.px - b.px || a.py - b.py);

// The source hull the asset stands in for Average measured (for a representative scale, not per-boat identity).
const lengths = hulls.map((h) => h.lengthM).sort((a, b) => a - b);
const medianLen = lengths.length ? lengths[Math.floor(lengths.length / 2)] : null;
const hullSize = { sourceLengthM: medianLen, genericModelPlan: { x: 1.428, z: 2.852 }, asset: 'assets/models/waterfront-dinghies/boat-row-large-white.glb' };

const payload = {
  version: 1,
  kind: 'waterfront-dinghies-qcyc',
  source: {
    name: 'City of Toronto 2024 orthophoto (QCYC dory/dry-sail storage cluster)',
    service: 'https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2024_color_8cm/MapServer',
    licence: 'Open Government Licence – Toronto',
    acquisition: 'Apr 26 – May 30, 2024',
    note: '2024 seasonal storage snapshot, not a current fleet; no exact boat identity. Orthophoto is reference only; nothing ships its pixels.',
    export: { bbox3857: man.bbox3857, size: man.size, groundMetresPerPixel: mpp, square: true }
  },
  asset: {
    file: 'assets/models/waterfront-dinghies/boat-row-large-white.glb',
    pack: 'Kenney Watercraft Kit 2.1 (2024-04-19)',
    licence: 'CC0 1.0 Universal',
    provenance: 'assets/models/waterfront-dinghies/PROVENANCE.md',
    modifications: ['paddles removed', 'flat white material, no texture'],
    plan: { x: 1.428, z: 2.852 }, heightM: 0.64
  },
  marina: { osmWay: MARINA_WAY },
  band: BAND,
  gates: { minHullM: MIN_HULL_M, maxHullM: MAX_HULL_M, maxHullWidthM: MAX_HULL_W, buildingClearM: 0.3, laneClearM: 1.2, treeClearM: 0.8 },
  counts: { clusters: clusters.length, placed: hulls.length, rejected },
  hullSize,
  projection: { lat0: P.lat0, lon0: P.lon0, kx: P.kx, ky: P.ky, theta: P.theta, ox: P.ox, oz: P.oz },
  // rows: [x(dm), z(dm), yaw(mrad, world long-axis heading), length(cm), width(cm), sourcePx-X, sourcePx-Y, pixelAxisX, pixelAxisY]
  // The last two are the pixel-space principal axis (for the reference preview only); yaw is the world heading.
  rows: hulls.map((h) => [Math.round(h.x * 10), Math.round(h.z * 10), Math.round(h.yaw * 1000), Math.round(h.lengthM * 100), Math.round(h.widthM * 100), h.px, h.py, Math.round(h.ex * 1000), Math.round(h.ey * 1000)])
};

const banner = `// js/waterfront-dinghies-data.js — GENERATED by tools/build-waterfront-dinghies.mjs, do not edit by hand.
// QCYC marina stored-dinghy placement from the captain's georeferenced 2024 City of Toronto orthophoto export
// (reference only; OGL – Toronto). A 2024 seasonal storage snapshot, NOT a current fleet; no exact boat identity.
// The generic hull asset is the CC0 Kenney Watercraft Kit "boat-row-large" (white, paddles removed); each group is sized
// from the measured source extent. Phase 1: placement plan only — the runtime is not wired until captain review.
(function () {
window.CITY = window.CITY || {};
window.CITY.WATERFRONT_DINGHIES_DATA = ${JSON.stringify(payload)};
})();
`;

if (CHECK) { console.log(JSON.stringify({ counts: payload.counts, hullSize, rows: payload.rows.length }, null, 2)); process.exit(0); }
fs.writeFileSync(OUT, banner);

// --- placement preview (top view) for the captain -------------------------------------------------------------------
// A plan-view SVG/PNG: the source orthophoto dimmed as the reference, the marina polygon, and each placed hull footprint
// as a white rotated ellipse at its measured centre/yaw/size. Reference only; it is NOT shipped into the scene.
fs.mkdirSync(path.dirname(PREVIEW), { recursive: true });
// Image pixel <-> preview pixel: reuse the source export so the captain can eyeball the hulls on the photo.
const size = man.size, mpp2 = man.groundMetresPerPixel;
const worldToPixel = (x, z) => {
  // inverse of pixelToWorld: world -> lonlat -> mercator -> pixel
  const E = x + P.ox, N = -(z + P.oz), c = Math.cos(P.theta), s = Math.sin(P.theta);
  const e = E * c + N * s, n = -E * s + N * c;
  const lon = e / P.kx + P.lon0, lat = n / P.ky + P.lat0;
  const mx = R * lon * Math.PI / 180, my = R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  return [((mx - mx0) / (mx1 - mx0)) * W, ((my1 - my) / (my1 - my0)) * H];
};
const ellipses = hulls.map((h) => {
  const [px, py] = worldToPixel(h.x, h.z);
  const rx = (h.widthM / mpp2) / 2, ry = (h.lengthM / mpp2) / 2;
  // The ellipse is drawn in IMAGE space: its long axis (ry) is the PIXEL principal axis (h.ex, h.ey), not the world yaw.
  // Image y points down, so atan2(ey, ex) gives the screen rotation of the pixel principal axis directly.
  const deg = (Math.atan2(h.ey, h.ex) * 180 / Math.PI).toFixed(1);
  // OUTLINE only (no fill) so the source hull stays visible inside.
  return `<g transform="rotate(${deg} ${px.toFixed(1)} ${py.toFixed(1)})"><ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${ry.toFixed(1)}" ry="${rx.toFixed(1)}" fill="none" stroke="#c0392b" stroke-width="1.6"/></g><text x="${(px + rx + 3).toFixed(0)}" y="${py.toFixed(0)}" font-family="Helvetica" font-size="11" fill="#c0392b">${h.lengthM.toFixed(1)}×${h.widthM.toFixed(1)}m</text>`;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="100%" height="100%" fill="#ffffff"/>
<image href="data:image/png;base64,${fs.readFileSync(ORTHO).toString('base64')}" x="0" y="0" width="${W}" height="${H}" opacity="0.55"/>
${ellipses}
<text x="12" y="22" font-family="Helvetica" font-size="15" fill="#111">QCYC stored-dinghy placement (2024 City ortho, reference only)</text>
<text x="12" y="40" font-family="Helvetica" font-size="12" fill="#444">${hulls.length} placed hulls · median ${medianLen} m · ${mpp2.toFixed(4)} m/px · CC0 Kenney hull</text>
</svg>`;
const svgPath = PREVIEW + '.svg';
fs.writeFileSync(svgPath, svg);
// rsvg-convert renders SVG rotations correctly; ImageMagick's SVG renderer mis-rotates ellipses. Use rsvg-convert.
try { execFileSync('rsvg-convert', ['-o', PREVIEW + '.png', svgPath]); } catch (e) { throw new Error(`preview PNG needs rsvg-convert (requested by review): ${e.message}`); }
console.log(`wrote ${path.relative(ROOT, svgPath)} (+ .png) and a copy of the source ortho for the preview`);
