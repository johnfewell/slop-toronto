(function () {
// js/sidewalk-polygons.js
// The City of Toronto's physical sidewalks per curb island (js/toronto-sidewalks.js, written by
// tools/build-sidewalks.mjs). The build clips the City's polygons to each island's raised slab, so they only re-surface
// ground the city already has: no height, collision or walking surface changes. city-grid.js lays them in concrete over
// the island's yard; an island they don't cover keeps the former fixed band (GEO.frame.sidewalk in from the curb).
// tools/build-sidewalks.mjs loads this file too, so the build and the browser agree on the islands' key.
const CITY = (window.CITY = window.CITY || {});

// The islands' key: their count and an FNV-1a hash of their outlines at 1 dm. The sidewalks name the islands they were
// clipped to by index, so they only apply to the geodata that has these exact islands (a rebuilt js/toronto-geodata.js,
// or a binary copy of the same one, keeps it; a changed outline doesn't).
function sidewalkBlocksKey(blocks) {
  let h = 0x811c9dc5;
  const mix = (v) => {
    for (let k = 0; k < 4; k++) {
      h ^= (v >>> (k * 8)) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  mix(blocks.length);
  for (const b of blocks) {
    const flat = b[0];
    mix(flat.length);
    for (let i = 0; i < flat.length; i++) mix(Math.round(flat[i] * 10) | 0);
  }
  return `${blocks.length}:${h.toString(16).padStart(8, '0')}`;
}

// A ring as stored: decimetres, the first point absolute and each next one relative to the one before
function decodeSidewalkRing(enc) {
  const out = [];
  let x = 0, z = 0;
  for (let i = 0; i + 1 < enc.length; i += 2) {
    x += enc[i];
    z += enc[i + 1];
    out.push({ x: x / 10, z: z / 10 });
  }
  return out;
}
function encodeSidewalkRing(pts) {
  const out = [];
  let px = 0, pz = 0;
  for (const [x, z] of pts) {
    const ix = Math.round(x * 10), iz = Math.round(z * 10);
    if (out.length && ix === px && iz === pz) continue;
    out.push(ix - px, iz - pz);
    px = ix;
    pz = iz;
  }
  return out;
}

// island index -> [{ outer: [{x, z}], holes: [[{x, z}], ...] }], or null: no sidewalk data, or data for other islands
function sidewalkPieces(data, blocks) {
  if (!data || !Array.isArray(data.polys) || !blocks) return null;
  const key = sidewalkBlocksKey(blocks);
  if (data.blocks !== key) {
    console.warn(`[sidewalks] js/toronto-sidewalks.js was clipped to islands ${data.blocks}, the geodata has ${key}: keeping the fixed band`);
    return null;
  }
  const map = new Map();
  for (const [bid, outer, ...holes] of data.polys) {
    if (!(bid >= 0 && bid < blocks.length)) continue;
    const piece = { outer: decodeSidewalkRing(outer), holes: holes.map(decodeSidewalkRing) };
    if (piece.outer.length < 3) continue;
    if (!map.has(bid)) map.set(bid, []);
    map.get(bid).push(piece);
  }
  return map;
}

// A point test over sidewalkPieces' map, for the pedestrians' walking lines (pedestrian-routes.js): each island's
// pieces' edges (outers & holes alike) bucketed in rows 1 m deep, so (x, z) counts the edges of its own row it lies
// left of (even-odd: inside a piece and outside its holes). Islands are tested separately; a point with no island, or
// on an island without pieces, is `null` (nothing mapped), never false.
const WALK_ROW = 1;
function sidewalkWalkIndex(map) {
  if (!map) return null;
  // (each island's rows laid out the first time it's asked about: the walkers only ever reach the islands near the
  // player)
  const islands = new Map(); // island index -> { r0, starts (row -> first edge), edges: [ax, az, bx, bz, ...], bounds }
  function build(bid) {
    const pieces = map.get(bid);
    let minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity;
    for (const { outer } of pieces) for (const p of outer) {
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
    const r0 = Math.floor(minZ / WALK_ROW), n = Math.floor(maxZ / WALK_ROW) - r0 + 1;
    // (twice over the rings: count each row's edges, then lay them out row by row in one array)
    const starts = new Uint32Array(n + 1);
    const each = (fn) => {
      for (const { outer, holes } of pieces) {
        for (const ring of [outer, ...holes]) {
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const a = ring[j], b = ring[i];
            if (a.z === b.z) continue; // (a level edge never crosses a row's ray)
            const lo = Math.max(0, Math.floor(Math.min(a.z, b.z) / WALK_ROW) - r0), hi = Math.min(n - 1, Math.floor(Math.max(a.z, b.z) / WALK_ROW) - r0);
            for (let r = lo; r <= hi; r++) fn(r, a, b);
          }
        }
      }
    };
    each((r) => starts[r + 1]++);
    for (let r = 0; r < n; r++) starts[r + 1] += starts[r];
    const fill = starts.slice(0, n), edges = new Float64Array(starts[n] * 4);
    each((r, a, b) => {
      const k = fill[r]++ * 4;
      edges[k] = a.x; edges[k + 1] = a.z; edges[k + 2] = b.x; edges[k + 3] = b.z;
    });
    const s = { r0, n, starts, edges, minX, maxX, minZ, maxZ };
    islands.set(bid, s);
    return s;
  }
  // true on the mapped walk, false off it on an island that has one, null for an island without
  function inside(bid, x, z) {
    const s = islands.get(bid) || (map.has(bid) ? build(bid) : null);
    if (!s) return null;
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) return false;
    const r = Math.floor(z / WALK_ROW) - s.r0;
    if (r < 0 || r >= s.n) return false;
    const E = s.edges;
    let c = false;
    for (let i = s.starts[r] * 4, end = s.starts[r + 1] * 4; i < end; i += 4) {
      const ax = E[i], az = E[i + 1], bx = E[i + 2], bz = E[i + 3];
      if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) c = !c;
    }
    return c;
  }
  return { has: (bid) => map.has(bid), inside, size: map.size };
}

Object.assign(CITY, { sidewalkBlocksKey, sidewalkPieces, sidewalkWalkIndex, decodeSidewalkRing, encodeSidewalkRing });
})();
