// js/rosedale-heights.js (jf-boq, docs/rosedale-spike.md phase 0): the lidar heights of Rosedale-Moore Park's boxes.
//
// The City's MAX_HEIGHT includes tree canopy, so half of Rosedale's houses stood as flat boxes a median 8.1 m too tall (the "mid-rise"
// look). data/frames/eglinton/rosedale-heights.bin (tools/build-rosedale-heights.mjs, from the 2023 lidar roofs) holds the roof top
// (flat boxes) or eave (pitched boxes) of each box row outside the downtown frame; applyRosedaleHeights puts them in
// GEO.buildings[row][4] before the buildings are built. Data only: the same boxes, no extra triangles, nothing new to draw.
// Only the bigger (Eglinton) map has these rows; the file is refused for any other geodata (rows moved, a height changed).
//
// File: the TGB1 container, one layer ROSEDALE_HEIGHTS { schema, dataset, geodata, rows, rowDelta, dm, check }: the ascending
// box rows delta coded, their new heights in decimetres, and `check`, rosedaleCheck of those rows in the geodata the file was built for.
import { unpackGeo } from './geodata-loader.js';

export const ROSEDALE_HEIGHTS_URL = './data/frames/eglinton/rosedale-heights.bin?v=6e1648fe42b3'; // (tools/build-rosedale-heights.mjs sets the hash)
export const ROSEDALE_HEIGHTS_SCHEMA = 1;

/** FNV-1a over each listed row's index, centre and height (decimetres): the rows the file was built for, as they are before it is applied */
export function rosedaleCheck(buildings, rows) {
  let h = 0x811c9dc5;
  const mix = (v) => { for (let s = 0; s < 32; s += 8) { h ^= (v >>> s) & 255; h = Math.imul(h, 0x01000193); } };
  mix(buildings.length);
  for (const row of rows) {
    const b = buildings[row];
    mix(row); mix(b ? Math.round(b[0] * 10) | 0 : 0); mix(b ? Math.round(b[1] * 10) | 0 : 0); mix(b ? Math.round(b[4] * 10) | 0 : 0);
  }
  return h >>> 0;
}

/**
 * Puts the file's heights on `buildings` (GEO.buildings): { applied, lowered, raised, error }. Nothing is changed (error set)
 * unless the file was built for exactly these rows. Applying twice is refused by the same check (the heights have moved).
 */
export function applyRosedaleHeights(buildings, H) {
  const out = { applied: 0, lowered: 0, raised: 0, error: null };
  if (!H || H.schema !== ROSEDALE_HEIGHTS_SCHEMA) { out.error = `schema ${H && H.schema}, not ${ROSEDALE_HEIGHTS_SCHEMA}`; return out; }
  const rows = new Array(H.rows);
  let r = 0;
  for (let i = 0; i < H.rows; i++) rows[i] = (r += H.rowDelta[i]);
  if (rosedaleCheck(buildings, rows) !== H.check) { out.error = 'built for other geodata (or already applied)'; return out; }
  for (let i = 0; i < H.rows; i++) {
    const b = buildings[rows[i]], h = H.dm[i] / 10;
    if (h < b[4]) out.lowered++; else if (h > b[4]) out.raised++;
    b[4] = h;
    out.applied++;
  }
  return out;
}

/** Reads the fetched file (a Response) -> its layer, or null */
export async function readRosedaleHeights(res) {
  if (!res || !res.ok) return null;
  const { ROSEDALE_HEIGHTS } = await unpackGeo(await res.arrayBuffer());
  return ROSEDALE_HEIGHTS || null;
}
