// js/facade-edges.js (st-2nl.6, docs/massing-buildings.md §4 "Facades on the real polygon edges"):
// the pure helpers that hang things on a drawn building's real footprint edges.
//
// - `EDGE_CLASS`: the four things an outer edge can be (plus `hidden`), as js/buildings.js footprintEdges names them:
//   street (looks onto a street within 15 m of its kerb), party (a neighbour's mass covers it), exposed-party (a neighbour
//   stands against it but is lower, so the wall shows above its roof) and rear.
// - `ghostKinds(...)`: which exposed party walls carry a painted ghost sign, picked from the building's ID, so the same walls
//   every load. A wall that shows at least 4.4 m above the neighbour (8.5 m long panel) or 6.8 m (14.4 m long panel) and is long
//   enough takes WALL_KINDS.ghost / ghostLarge in place of lotLine; the shader (tsl-materials.js) paints the sign on it.
// - `resolveFaceEdge(...)`: the hook for records keyed to a building face (the storefront signs, js/storefront-signs.js; a
//   licensed facade photo later): the polygon edge a record's wall point and normal stand on, within a tolerance in metres
//   and degrees, or null (the record then keeps the position it was compiled with).
//
// Nothing here reads the page; every function is pure and never throws.

/** The classes footprintEdges gives an outer edge */
export const EDGE_CLASS = { street: 'street', party: 'party', exposedParty: 'exposed-party', rear: 'rear', hidden: 'hidden' };

/** The wall kinds a ghost sign takes (the same numbers as tsl-materials.js WALL_KINDS.ghost and .ghostLarge) */
export const GHOST_KIND = { small: 5, large: 6 };
/** Lot-line kind (WALL_KINDS.lotLine) */
const LOT_LINE = 3;

/**
 * The two panel sizes, metres. The shader draws the panel `top` m under the wall's top, `height` m tall and `width` m wide
 * (the drawn panel of an atlas cell, 3.28 : 1), centred on the wall with a hashed offset; `minExposed` is the wall height above the neighbour
 * that fits it with 0.8 m of brick under it, `minLength` the wall length that fits it with 1 m of brick each side.
 */
export const GHOST_PANEL = {
  small: { height: 2.6, top: 1.0, width: 8.5, minExposed: 4.4, minLength: 10.5 },
  large: { height: 4.4, top: 1.2, width: 14.4, minExposed: 6.8, minLength: 16.4 }
};

/** How many of the qualifying walls take a sign, by the street the building stands on: the older main streets most, the rest rarely */
const OLD_MAIN = /^(queen|dundas|king|college|spadina|bathurst|yonge)\b/i;
const OLD_SIDE = /^(church|parliament|front|adelaide|richmond|gerrard|carlton|augusta|kensington|baldwin|oxford|nassau|wellington|bloor|danforth|broadview|ossington|dufferin|roncesvalles|st\.? clair)\b/i;
export const GHOST_CHANCE = { oldMain: 0.45, oldSide: 0.22, other: 0.06 };

export function ghostChanceFor(roadName) {
  const n = String(roadName || '').trim();
  if (OLD_MAIN.test(n)) return GHOST_CHANCE.oldMain;
  if (OLD_SIDE.test(n)) return GHOST_CHANCE.oldSide;
  return GHOST_CHANCE.other;
}

/** FNV-1a of a string, 0..2^32 */
export function hashId(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/**
 * The kinds of a building's outer edges with its ghost-sign wall (at most one) set.
 *   id        the building's durable ID (the choice is a hash of it, so it never moves)
 *   ring      the outer ring [[x, z], ...] the kinds and cover belong to
 *   kinds     WALL_KINDS per edge (-1: no wall)
 *   cover     per edge, the neighbour's roof height above the ground (NaN: no neighbour)
 *   top       the wall's top above the same ground
 *   chance    0..1, the share of qualifying buildings that take a sign (ghostChanceFor of the street); or a function that gives it,
 *             called only when a wall qualifies (so the street lookup is not made for the many buildings with none)
 * -> { kinds, edge } (edge: the index that took the sign, or -1; kinds is the input when none did)
 */
export function ghostKinds({ id, ring, kinds, cover, top, chance }) {
  const out = { kinds, edge: -1 };
  if (!Array.isArray(ring) || !kinds || !cover || !(typeof chance === 'function' || chance > 0) || !Number.isFinite(top)) return out;
  const n = ring.length;
  let best = -1, bestScore = 0, bestKind = 0;
  for (let i = 0; i < n; i++) {
    if (kinds[i] !== LOT_LINE || !Number.isFinite(cover[i])) continue;
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n];
    const len = Math.hypot(bx - ax, bz - az), exposed = top - cover[i];
    const large = exposed >= GHOST_PANEL.large.minExposed && len >= GHOST_PANEL.large.minLength;
    const small = exposed >= GHOST_PANEL.small.minExposed && len >= GHOST_PANEL.small.minLength;
    if (!large && !small) continue;
    const score = exposed * len;
    if (score > bestScore) { bestScore = score; best = i; bestKind = large ? GHOST_KIND.large : GHOST_KIND.small; }
  }
  if (best < 0) return out;
  const share = typeof chance === 'function' ? chance() : chance;
  if (!(share > 0) || hashId(`${id}|ghost`) / 4294967296 >= share) return out;
  const next = Array.from(kinds);
  next[best] = bestKind;
  return { kinds: next, edge: best };
}

/**
 * A record's outer ring as the edge list resolveFaceEdge reads: { ax, az, bx, bz, nx, nz, len, kind }, the outward normal
 * (dz, -dx) / len of a counter-clockwise ring as the sidecar stores it; the edges in `hidden` (a Set) have no wall (kind -1).
 */
export function edgesOfRing(ring, hidden) {
  const n = Array.isArray(ring) ? ring.length : 0, out = [];
  for (let i = 0; i < n; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    out.push({ ax, az, bx, bz, nx: len > 0 ? dz / len : 0, nz: len > 0 ? -dx / len : 0, len, kind: hidden && hidden.has(i) ? -1 : 2 });
  }
  return out;
}

/**
 * The polygon edge a face record stands on: `face` is { x, z (a point on the wall, m), nx, nz (its outward normal) }, `edges`
 * footprintEdges' list ({ ax, az, bx, bz, nx, nz, len, kind }). The edge must face within `maxDeg` of the record's normal,
 * and the point must lie within `maxDist` m of the edge's segment (the box face the record was compiled on is up to a metre
 * off the real wall). Walls with no wall (kind -1) and slivers under 1 m are not candidates.
 * -> { index, edge, s (m along the edge from its first corner, the point's foot clamped to it), dist (m off the wall) } or null
 */
export function resolveFaceEdge(edges, face, { maxDist = 1.5, maxDeg = 15 } = {}) {
  if (!Array.isArray(edges) || !face || ![face.x, face.z, face.nx, face.nz].every(Number.isFinite)) return null;
  const fl = Math.hypot(face.nx, face.nz);
  if (!(fl > 1e-9)) return null;
  const cosMin = Math.cos((maxDeg * Math.PI) / 180);
  let best = null;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!e || e.kind < 0 || !(e.len >= 1)) continue;
    if ((e.nx * face.nx + e.nz * face.nz) / fl < cosMin) continue;
    const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len;
    const t = (face.x - e.ax) * dx + (face.z - e.az) * dz;
    const s = Math.max(0, Math.min(e.len, t));
    const dist = Math.hypot(face.x - (e.ax + dx * s), face.z - (e.az + dz * s));
    if (dist <= maxDist && (!best || dist < best.dist)) best = { index: i, edge: e, s, dist };
  }
  return best;
}

/**
 * Where a board of `width` m stands on a resolved edge: its centre kept over the record's own stretch of the wall, moved
 * along the edge only as far as needed to stay inside it, and put on the wall line. -> { x, z, nx, nz, width }
 */
export function placeOnEdge(hit, face, width, margin = 0.15) {
  const e = hit.edge;
  const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len;
  const w = Math.max(0.5, Math.min(width, e.len - 2 * margin));
  const s = Math.max(margin + w / 2, Math.min(e.len - margin - w / 2, hit.s));
  return { x: e.ax + dx * s, z: e.az + dz * s, nx: e.nx, nz: e.nz, width: w };
}
