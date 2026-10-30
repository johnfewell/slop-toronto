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

Object.assign(CITY, { sidewalkBlocksKey, sidewalkPieces, decodeSidewalkRing, encodeSidewalkRing });
})();
