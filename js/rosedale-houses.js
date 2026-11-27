// js/rosedale-houses.js (jf-abm, docs/rosedale-pilot.md): Rosedale-Moore Park's houses from their own outlines with roofs from the 2023 lidar.
//
// data/frames/eglinton/rosedale-houses.bin (tools/build-rosedale-houses.mjs) holds, per house, the outline with the wall classification the
// massing sidecar carries (party, hidden and street edges), a slimmed lidar roof (planes merged, tiny planes absorbed, boundaries
// simplified: a few dozen triangles), the eave, an era and a style code, and the lidar top and mean heights for the roof planner where the
// lidar fit is poor. mergeRosedaleHouses puts each house in `massing.rows` as a footprint record of its box row (js/buildings.js then draws it as
// it draws every outline: walls with the facade shader, a collider of its polygon, a far tier of its boxes); the roof comes from
// lidarRoofPlan/pushLidarRoof below instead of the roof planner, the colours from LOOKS. The rows' other boxes are skipped.
// Only the bigger (Eglinton) map has these rows; the file is refused for any other geodata, and ?rosedalePilot=0 keeps the boxes.
//
// File: the TGB1 container, one layer ROSEDALE_HOUSES (columns per house, in ascending first-row order; coordinates in decimetres):
//   fid, part        the City 3D Massing id (`to-3dmassing-2025:<fid>[.<part - 1>]`)
//   row, extraN, extraRow   the first box row (delta coded) and the other rows whose centre lies inside the outline
//   corners, start, step    the outline (counter-clockwise in x, z), as the massing sidecar: first corner, then each corner from the one before
//   partyN/partyEdge/partyCover, hiddenN/hiddenEdge, streetN/streetEdge   as js/massing-data.js
//   eave, maxH, avgH   the wall height (the roof stands on it), the lidar roof top and its mean height
//   chimN, chimX/Z/Top/Base/W   (jf-bya) the chimneys the lidar shows over the roof: per house their count, then each one's world x and z, its top and the roof under it (above the ground) and its width, decimetres
//   lotW, park         (jf-bya) the lot's frontage (its short side, decimetres) and the front-yard parking the City licenses (0 none, 1 front yard, 2 widened driveway, 3 boulevard)
//   era, style         derived codes (ERA_NAMES, STYLE_NAMES); fit: 0 roof planner on maxH and avgH, 1 lidar roof, 2 flat by the lidar
//   polyN, polyKind, polyVerts, vx, vz, vy   the roof: polygons (kind 0 a roof facet, 1 a gable wall above the eave), their corners in x, z and height above the ground
import { unpackGeo } from './geodata-loader.js';
import { earClip, area2 } from './roof-skeleton.js';

export const ROSEDALE_HOUSES_URL = './data/frames/eglinton/rosedale-houses.bin?v=6d4d887602d1'; // (tools/build-rosedale-houses.mjs sets the hash)
export const ROSEDALE_HOUSES_SCHEMA = 1;
const FAR_FACET_M2 = 10;
export const ERA_NAMES = ['before 1900', '1900 to 1916', '1917 to 1929', '1930 to 1945', '1946 to 1967', '1968 on'];
export const STYLE_NAMES = { 0: 'plain', 1: 'Edwardian', 2: 'revival', 3: 'Georgian', 5: 'Victorian', 10: 'Moderne', 11: 'post-war', 12: 'infill' };

/** FNV-1a over each listed row's index and centre (decimetres): the rows the file was built for */
export function rowsCheck(buildings, rows) {
  let h = 0x811c9dc5;
  const mix = (v) => { for (let s = 0; s < 32; s += 8) { h ^= (v >>> s) & 255; h = Math.imul(h, 0x01000193); } };
  mix(buildings.length);
  for (const row of rows) { const b = buildings[row]; mix(row); mix(b ? Math.round(b[0] * 10) | 0 : 0); mix(b ? Math.round(b[1] * 10) | 0 : 0); }
  return h >>> 0;
}

// Wall and roof colours by style, from the page's own palettes (js/buildings.js TORONTO_MASONRY, TORONTO_RENDER and ROOF_PAINT): brick, [hex, weight]
// pairs; `render` is the share of houses of the style in stucco or painted render instead of brick; roof, [hex, weight] pairs.
const SLATE = [[0x2c2d30, 4], [0x3b3b3d, 3], [0x4b4e52, 2]];
const ASPHALT = [[0x3b3b3d, 5], [0x2c2d30, 3], [0x3f3a35, 3], [0x5a5753, 1]]; // (greys and a dark brown: a brown lit by the low sun turns salmon)
const CEDAR = [[0x3f372f, 4], [0x4a403a, 2], [0x3b3b3d, 2]];
export const LOOKS = {
  0: { brick: [[0x7c6154, 37], [0x5a463f, 26], [0x9c7a62, 21], [0xae987e, 14]], render: 0.1, roof: ASPHALT },
  1: { brick: [[0x7c6154, 5], [0x9c7a62, 3], [0x8a5a48, 3], [0xc07e55, 1]], render: 0.05, roof: ASPHALT }, // Edwardian: red and red-brown brick
  2: { brick: [[0x5a463f, 3], [0x7c6154, 3], [0x6e473c, 2]], render: 0.45, roof: [...SLATE, ...CEDAR] }, // revival: brick and stucco, slate or cedar
  3: { brick: [[0x8a5a48, 4], [0x7c5044, 3], [0x7c6154, 3]], render: 0.05, roof: SLATE }, // Georgian: red brick, slate
  5: { brick: [[0x5a463f, 4], [0x6e473c, 3], [0x7c5044, 2]], render: 0, roof: SLATE }, // Victorian: dark red brick, slate
  10: { brick: [[0xae987e, 4], [0xb9a98a, 2], [0x9c7a62, 1]], render: 0.2, roof: ASPHALT }, // Moderne: buff brick
  11: { brick: [[0xae987e, 4], [0xb9a98a, 3], [0x9c7a62, 2], [0x7c6154, 1]], render: 0.1, roof: ASPHALT }, // post-war
  12: { brick: [[0x7c6154, 3], [0xae987e, 3], [0x5a463f, 2]], render: 0.25, roof: ASPHALT } // infill
};
const RENDER = [[0xcfccc4, 4], [0xe6e1d6, 3], [0xb9b4aa, 2], [0xae987e, 1]];

/** The columns -> the houses (each with its first row, other rows, outline, edge classes and roof polygons), or { error } */
export function decodeHouses(H, buildings) {
  if (!H || H.schema !== ROSEDALE_HOUSES_SCHEMA) return { error: `schema ${H && H.schema}, not ${ROSEDALE_HOUSES_SCHEMA}` };
  const g = H.grid || 10, n = H.houses;
  const houses = [], all = [];
  let row = 0, er = 0, st = 0, pe = 0, he = 0, se = 0, pn = 0, pv = 0, v = 0, ch = 0;
  for (let i = 0; i < n; i++) {
    row += H.row[i];
    const rows = [row];
    for (let k = 0; k < H.extraN[i]; k++) rows.push(H.extraRow[er++]);
    all.push(...rows);
    const ring = new Array(H.corners[i]);
    let X = H.start[i * 2], Z = H.start[i * 2 + 1];
    ring[0] = [X / g, Z / g];
    for (let k = 1; k < ring.length; k++, st += 2) { X += H.step[st]; Z += H.step[st + 1]; ring[k] = [X / g, Z / g]; }
    const covered = new Map(), hidden = new Set(), street = new Map();
    for (let k = 0; k < H.partyN[i]; k++, pe++) covered.set(H.partyEdge[pe], H.partyCover[pe] / g);
    for (let k = 0; k < H.hiddenN[i]; k++, he++) hidden.add(H.hiddenEdge[he]);
    for (let k = 0; k < H.streetN[i]; k++, se++) street.set(H.streetEdge[se] >> 1, (H.streetEdge[se] & 1) === 1);
    const chim = [];
    for (let k = 0; H.chimN && k < H.chimN[i]; k++, ch++) chim.push({ x: H.chimX[ch] / g, z: H.chimZ[ch] / g, top: H.chimTop[ch] / g, base: H.chimBase[ch] / g, w: H.chimW[ch] / g });
    const polys = [];
    for (let k = 0; k < H.polyN[i]; k++, pn++) {
      const verts = [];
      for (let q = 0; q < H.polyVerts[pn]; q++, v++) verts.push([H.vx[v] / g, H.vz[v] / g, H.vy[v] / g]);
      polys.push({ kind: H.polyKind[pn], v: verts });
      void pv;
    }
    houses.push({ fid: H.fid[i], part: H.part[i], rows, ring, covered, hidden, street, eave: H.eave[i] / g, maxH: H.maxH[i] / g, avgH: H.avgH[i] / g, era: H.era[i], style: H.style[i], fit: H.fit[i], lotW: H.lotW ? H.lotW[i] / g : 0, park: H.park ? H.park[i] : 0, chim, polys });
  }
  if (rowsCheck(buildings, all) !== H.check) return { error: 'built for other geodata' };
  return { houses };
}

// ---- walls (jf-bya, docs/rosedale-walls.md): which parts are houses, what roof the lidar says, which drawn preset each house takes ------------------
const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(a / 2); };
// The pilot holds the neighbourhood's low-rise buildings: the City's kind column calls 1,457 of them mid-rise and 86 tall (a third of those
// came out as curtain wall, with storefront ground floors beside a shop on the street), but they are houses. A house stands at most 16 m
// to the lidar roof top on at most 450 m2, and is not a building the City calls industrial or worship (kinds 4, 6).
export const HOUSE_MAX_TOP_M = 16, HOUSE_MAX_AREA_M2 = 450;
// the share of the main block's rectangle the outline must fill for the house to be drawn as a preset (the catalogue's is 0.8): a Rosedale house with a notch or
// an L is drawn as its own outline with the lidar roof instead of the rectangle the preset composes
export const ROSEDALE_FILL_MIN = 0.86;
export function isHouse(h, kind) {
  return h.maxH <= HOUSE_MAX_TOP_M && ringArea(h.ring) <= HOUSE_MAX_AREA_M2 && kind !== 4 && kind !== 6;
}

/**
 * What the lidar's roof facets say about the roof: { form: 'gable' | 'hip' | 'cross' | 'flat', ridge: [x, z] (unit, the ridge's direction), pitch (degrees,
 * the pitched facets' mean slope), eave }, or null where the lidar fit was poor (the roof planner's houses). `coherence` near 1 is two opposite slopes
 * (a gable), near 0 four slopes round a point (a hip), between a gable with a cross gable or a hip with a gable.
 */
export function roofHint(h) {
  if (h.fit === 2) return { form: 'flat', ridge: [1, 0], pitch: 0, eave: h.eave };
  if (h.fit !== 1) return null;
  let wTot = 0, wFlat = 0, c2 = 0, s2 = 0, wP = 0, slopeSum = 0, pitched = 0;
  for (const poly of h.polys) {
    if (poly.kind !== 0 || poly.v.length < 3) continue;
    // the facet's Newell normal (the vertices are [x, z, height]): its length is twice the facet's area
    let nx = 0, ny = 0, nz = 0;
    const V = poly.v;
    for (let i = 0; i < V.length; i++) {
      const [x1, z1, y1] = V[i], [x2, z2, y2] = V[(i + 1) % V.length];
      nx += (y1 - y2) * (z1 + z2);
      ny += (z1 - z2) * (x1 + x2);
      nz += (x1 - x2) * (y1 + y2);
    }
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-6)) continue;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const w = l / 2, slope = Math.acos(Math.min(1, ny / l)) * 180 / Math.PI;
    wTot += w;
    if (slope < 8) { wFlat += w; continue; }
    const th = Math.atan2(nz, nx);
    c2 += w * Math.cos(2 * th); s2 += w * Math.sin(2 * th); wP += w; slopeSum += w * slope; pitched++;
  }
  if (!(wTot > 0) || wP < wTot * 0.3 || !pitched) return { form: 'flat', ridge: [1, 0], pitch: 0, eave: h.eave };
  const coherence = Math.hypot(c2, s2) / wP;
  const phi = 0.5 * Math.atan2(s2, c2); // the slopes' common axis (the normals' direction); the ridge runs across it
  const ridge = [-Math.sin(phi), Math.cos(phi)];
  const form = coherence > 0.78 ? 'gable' : coherence < 0.4 ? 'hip' : 'cross';
  return { form, ridge, pitch: slopeSum / wP, eave: h.eave, coherence };
}

// Rosedale presets by derived style code (STYLE_NAMES), as [preset, share] tables drawn by the house's own hash: the catalogue's presets where it has
// them (js/building-prototypes.js DRAW) and the Rosedale ones (ROSEDALE_DRAW) it lacks, in the order of how many houses each covers (docs/rosedale-spike.md section 6).
const DETACHED = {
  0: [['edwardian-detached', 5], ['rosedale-annex', 2], ['rosedale-arts-crafts', 2]],
  1: [['edwardian-detached', 5], ['rosedale-annex', 3], ['rosedale-arts-crafts', 2]], // Edwardian (1,552)
  11: [['postwar-detached', 1]], // post-war (534)
  3: [['rosedale-georgian', 1]], // Georgian and Colonial revival (488)
  12: [['rosedale-georgian', 4], ['rosedale-tudor', 4], ['recent-detached', 1]], // revival infill (329)
  2: [['rosedale-tudor', 7], ['rosedale-georgian', 1], ['rosedale-arts-crafts', 2]], // Tudor, English cottage, Jacobethan (310)
  5: [['rosedale-queen-anne', 7], ['victorian-detached', 3]], // Victorian and Queen Anne (258)
  10: [['interwar-detached', 1]] // Moderne
};
const SEMI = { 0: 'edwardian-semi', 1: 'edwardian-semi', 2: 'interwar-semi', 3: 'interwar-semi', 5: 'victorian-semi', 10: 'interwar-semi', 11: 'postwar-semi', 12: 'interwar-semi' };
const hashOf = (fid, part) => { let x = (Math.imul(fid | 0, 2654435761) ^ Math.imul((part | 0) + 1, 40503)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };
// the Edwardian presets' windows are an office's width (1.8 m): a Rosedale house of them takes the sash window instead
const EDWARDIAN_PRESETS = new Set(['edwardian-detached', 'edwardian-semi']);
export const variantsOfPreset = (id) => (EDWARDIAN_PRESETS.has(id) ? [13, 3] : undefined);
/** The drawn preset id of a house (deterministic from its City id) */
export function presetOfHouse(h) {
  if (h.covered.size > 0) return SEMI[h.style] || 'edwardian-semi';
  const T = DETACHED[h.style] || DETACHED[1];
  let t = hashOf(h.fid, h.part) * T.reduce((s, [, w]) => s + w, 0);
  for (const [id, w] of T) { t -= w; if (t < 0) return id; }
  return T[T.length - 1][0];
}

/**
 * Adds each house to `massing.rows` (its first box row, a footprint record like the sidecar's) and returns { skip: Set of the other rows, merged, error }.
 * A row the sidecar already draws is never replaced.
 */
export function mergeRosedaleHouses(massing, buildings, H) {
  const out = { merged: 0, skip: new Set(), error: null, houses: 0, houseRows: 0, lidar: 0, planner: 0, flat: 0, roofTriangles: 0 };
  if (!massing || !(massing.rows instanceof Map) || massing.error) { out.error = 'no massing sidecar is loaded'; return out; }
  const d = decodeHouses(H, buildings);
  if (d.error) { out.error = d.error; return out; }
  const first = new Set(d.houses.map((h) => h.rows[0])); // (a row inside one outline can be the first row of the house next to it: that one stays drawn)
  for (const h of d.houses) {
    if (h.rows.some((r) => massing.rows.has(r))) continue;
    const id = `to-3dmassing-2025:${h.fid}${h.part ? '.' + (h.part - 1) : ''}`;
    const b = buildings[h.rows[0]];
    h.house = isHouse(h, b ? b[5] : 0);
    const rec = { id, index: -1, base: 0, rings: [h.ring], covered: h.covered, hidden: h.hidden, street: h.street, maxH: h.maxH, avgH: h.avgH, rosedale: h };
    if (h.house) {
      // (jf-bya: the house is drawn as a preset, js/building-draw.js planHouse, from its style and its lidar roof; the facts the downtown rows take from the sidecar's groups are its own)
      h.hint = roofHint(h);
      rec.preset = presetOfHouse(h);
      rec.variants = variantsOfPreset(rec.preset);
      rec.roofHex = lookOf(h.style, hashOf(h.fid + 1, h.part), hashOf(h.fid + 2, h.part), hashOf(h.fid + 3, h.part)).roof;
      rec.fillMin = ROSEDALE_FILL_MIN;
      rec.drawFacts = { groupId: id, dwellings: h.covered.size > 0 ? 2 : 1, group: null };
      out.houseRows++;
    }
    massing.rows.set(h.rows[0], rec);
    for (const r of h.rows.slice(1)) if (!first.has(r)) out.skip.add(r);
    out.merged++;
    if (h.fit === 1) { out.lidar++; for (const p of h.polys) out.roofTriangles += p.v.length - 2; } else if (h.fit === 2) out.flat++; else out.planner++;
  }
  out.houses = d.houses.length;
  return out;
}

/** A lidar house's roof as a plan for buildings.js: { ok: true, lidar: true, eave, polys }, or { ok: false, reason: 'flat' } (the cap stays the roof); null for a house the planner draws */
export function lidarRoofPlan(h) {
  if (h.fit === 2) return { ok: false, reason: 'flat (lidar)' };
  if (h.fit !== 1 || !h.polys.length) return null;
  return { ok: true, lidar: true, eave: h.eave, polys: h.polys };
}

/**
 * The roof's triangles into the hipped roofs' accumulator A { pos, nor, uv, col } at base height y0: returns the triangle count.
 * rgb: the roof's colour (linear); wallRgb: the gable walls' (linear). uv: metres along the eave, metres up the slope (as js/roof-skeleton.js).
 * far: the version beyond ROOF_NEAR, the big facets only (no gable walls, no facet under FAR_FACET_M2).
 */
export function pushLidarRoof(A, plan, y0, rgb, wallRgb, far = false) {
  let count = 0;
  const y = y0 + plan.eave;
  const emit = (a, b, c, up, uvFlat) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-6)) return;
    nx /= l; ny /= l; nz /= l;
    if (up && ny < 0) { nx = -nx; ny = -ny; nz = -nz; [b, c] = [c, b]; }
    const col = up ? rgb : wallRgb;
    const sin = Math.max(0.2, Math.sqrt(Math.max(0, 1 - ny * ny))), hl = Math.hypot(nx, nz) || 1;
    for (const p of [a, b, c]) {
      A.pos.push(p[0], p[1], p[2]); A.nor.push(nx, ny, nz);
      if (uvFlat || sin < 0.1) A.uv.push(0, 0.3); else A.uv.push((p[0] * -nz + p[2] * nx) / hl, (p[1] - y) / sin);
      A.col.push(col[0], col[1], col[2]);
    }
    count++;
  };
  for (const poly of plan.polys) {
    const V = poly.v;
    if (far && (poly.kind === 1 || Math.abs(area2(V.map((p) => [p[0], p[1]]))) / 2 < FAR_FACET_M2)) continue;
    if (poly.kind === 1) { // a gable wall: wound outward by the builder; a fan
      for (let i = 1; i + 1 < V.length; i++) emit([V[0][0], y0 + V[0][2], V[0][1]], [V[i][0], y0 + V[i][2], V[i][1]], [V[i + 1][0], y0 + V[i + 1][2], V[i + 1][1]], false, true);
      continue;
    }
    let flat = V.map((p) => [p[0], p[1]]);
    let order = V.map((_, i) => i);
    if (area2(flat) < 0) { flat = flat.slice().reverse(); order = order.slice().reverse(); }
    for (const [a, b, c] of earClip(flat)) {
      const P = (k) => { const p = V[order[k]]; return [p[0], y0 + p[2], p[1]]; };
      emit(P(a), P(b), P(c), true, false);
    }
  }
  return count;
}

/** The wall and roof colours (hex) of a house, from its style and a random draw in [0, 1): { wall, roof, render } */
export function lookOf(style, r1, r2, r3) {
  const L = LOOKS[style] || LOOKS[0];
  const pick = (table, r) => { let t = r * table.reduce((s, [, w]) => s + w, 0); for (const [v, w] of table) { t -= w; if (t < 0) return v; } return table[table.length - 1][0]; };
  const render = r1 < L.render;
  return { wall: pick(render ? RENDER : L.brick, r2), roof: pick(L.roof, r3), render };
}

/** Reads the fetched file (a Response) -> its layer, or null */
export async function readRosedaleHouses(res) {
  if (!res || !res.ok) return null;
  const { ROSEDALE_HOUSES } = await unpackGeo(await res.arrayBuffer());
  return ROSEDALE_HOUSES || null;
}
