// Part 8b: the City's piled trees (st-unco). The street tree inventory geocodes many trees to one address point: a
// park's (519 at High Park's Bloor gate, 254 in Marilyn Bell Park, 100 in Moss Park), a school's, an apartment
// tower's, a pair at one house. Drawn where the data puts them, they are one fan of crowns. Where they really stand is
// not in the data (a park's records carry position 9999), so each pile is spread along its own address's frontage, as
// the City plants: on the boulevard of the curb island the point is on, OFF in from the curb, the nearest spots to the
// point first (on the addressed street's side before another's), GAP or more from any other City tree, clear of the
// buildings, water and roadway, within REACH of the point. What does not fit there is left out: the frontage holds as
// many trees as it plausibly can, and a park's interior has its own trees (street-details.js plants the parkland).
// High Park's islands are left as they are: the lidar has their trees (high-park-woods.js keeps one of each pile there).
// The numbers: OFF is about the inventory's median tree's distance from the curb (3.4 m; a quarter stand within 2.2 m),
// GAP its trees' median distance to the nearest other (7.0 m).
// spreadPiles(trees, city) moves each piled tree's x, z in place and returns { kept: the trees kept, in their order,
// stats: the counts, each: [x, z, trees, kept] per pile spread }.
//   trees: [{ x, z, street, pos }] (x, z rounded to 0.1 m: a pile is the trees on one such point)
//   city: { blockAt(x, z) -> block | null, labelAt(x, z) -> raster label, buildingNear(x, z, r), isWater(x, z),
//           streetAt(x, z) -> the nearest street's name | '' }; a block: { _lab, poly [[x, z]...], parkName }
export const PILE = { OFF: 3, GAP: 7, REACH: 100, CLEAR: 1.5, BUILDING: 1.5, STEP: 1, OTHER_STREET: 30, SEARCH: 20 };

const q = (v) => Math.round(v * 10) / 10;
const pointKey = (x, z) => `${q(x)},${q(z)}`;
// a street's name to compare: the words before its type (LAKE SHORE BLVD W TORONTO, Lake Shore Boulevard West: LAKE SHORE)
const TYPES = new Set(['ST', 'STREET', 'AVE', 'AVENUE', 'AV', 'RD', 'ROAD', 'BLVD', 'BOULEVARD', 'DR', 'DRIVE', 'CRES', 'CRESCENT',
  'PL', 'PLACE', 'TER', 'TERRACE', 'CRT', 'COURT', 'CT', 'GDNS', 'GARDENS', 'SQ', 'SQUARE', 'PKWY', 'PARKWAY', 'TRL', 'TRAIL',
  'HTS', 'HEIGHTS', 'GRV', 'GROVE', 'LANE', 'LN', 'WAY', 'CIR', 'CIRCLE', 'CRCL', 'QUAY', 'PK', 'PARK', 'WALK', 'MEWS', 'GATE', 'PATH', 'HILL', 'LINE', 'EXPY', 'EXPRESSWAY']);
export function streetStem(name) {
  const w = String(name || '').toUpperCase().replace(/\bSAINT\b/g, 'ST').replace(/[^A-Z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  // (ST first is Saint: St. Clair, St. James)
  const at = w.findIndex((t, i) => i > 0 && TYPES.has(t));
  return (at > 0 ? w.slice(0, at) : w.slice(0, 2)).join(' ');
}

export function spreadPiles(trees, city, opt = {}) {
  const P = { ...PILE, ...opt };
  const groups = new Map();
  trees.forEach((t, i) => { const k = pointKey(t.x, t.z); (groups.get(k) || groups.set(k, []).get(k)).push(i); });
  // every tree standing alone, and each placed one: none within GAP of another
  const CELL = 16, grid = new Map(), gk = (x, z) => Math.floor(x / CELL) * 100000 + Math.floor(z / CELL);
  const put = (x, z) => { const k = gk(x, z); (grid.get(k) || grid.set(k, []).get(k)).push(x, z); };
  const clearOfTrees = (x, z) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const c = grid.get(gk(x, z) + a * 100000 + b);
      if (c) for (let i = 0; i < c.length; i += 2) if (Math.hypot(c[i] - x, c[i + 1] - z) < P.GAP) return false;
    }
    return true;
  };
  const piles = [];
  for (const [k, ix] of groups) {
    if (ix.length === 1) put(trees[ix[0]].x, trees[ix[0]].z);
    else piles.push({ k, ix, x: trees[ix[0]].x, z: trees[ix[0]].z });
  }
  // the small piles first (a pair takes the two spots by its house), then by place, so a build is reproducible
  piles.sort((a, b) => a.ix.length - b.ix.length || a.x - b.x || a.z - b.z);
  const keep = new Uint8Array(trees.length).fill(1);
  const stats = { piles: piles.length, trees: 0, stayed: 0, moved: 0, dropped: 0, left: 0, leftTrees: 0, noBlock: 0, each: [] };
  // a spot on block b for a tree: in b, CLEAR or more from its curb (the raster's other labels), off the water, clear of
  // the buildings
  const spotOk = (b, x, z) => {
    const r = Math.ceil(P.CLEAR);
    for (let a = -r; a <= r; a++) for (let c = -r; c <= r; c++) {
      if (a * a + c * c > P.CLEAR * P.CLEAR + 0.01) continue;
      if (city.labelAt(x + a, z + c) !== b._lab) return false;
    }
    return !city.isWater(x, z) && !city.buildingNear(x, z, P.BUILDING);
  };
  for (const pile of piles) {
    const n = pile.ix.length;
    stats.trees += n;
    let b = city.blockAt(pile.x, pile.z);
    // (a point on the roadway: the island nearest it, within SEARCH)
    if (!b) {
      let bd = Infinity;
      for (let r = 1; r <= P.SEARCH && !b; r++) for (let s = 0; s < 8 * r; s++) {
        const t = (s / (8 * r)) * Math.PI * 2, c = city.blockAt(pile.x + Math.cos(t) * r, pile.z + Math.sin(t) * r);
        if (c && r < bd) { b = c; bd = r; }
      }
    }
    if (b && b.parkName === 'High Park') { stats.left++; stats.leftTrees += n; continue; }
    const spots = [];
    if (b) {
      const counts = new Map();
      for (const i of pile.ix) { const s = streetStem(trees[i].street); counts.set(s, (counts.get(s) || 0) + 1); }
      const street = [...counts].sort((a, c) => c[1] - a[1] || (a[0] < c[0] ? -1 : 1))[0][0];
      const cost = (x, z) => Math.hypot(x - pile.x, z - pile.z) + (street && streetStem(city.streetAt(x, z)) === street ? 0 : P.OTHER_STREET);
      // the point itself, if a tree can stand there
      if (city.blockAt(pile.x, pile.z) === b && spotOk(b, pile.x, pile.z)) spots.push([pile.x, pile.z, -1]);
      // the boulevard: OFF in from each edge of the island's curb, every STEP
      const poly = b.poly;
      for (let e = 0; e < poly.length; e++) {
        const [ax, az] = poly[e], [cx, cz] = poly[(e + 1) % poly.length];
        const len = Math.hypot(cx - ax, cz - az);
        if (len < 1e-6) continue;
        const ux = (cx - ax) / len, uz = (cz - az) / len;
        for (let s = P.STEP / 2; s < len; s += P.STEP) {
          const px = ax + ux * s, pz = az + uz * s;
          if (Math.hypot(px - pile.x, pz - pile.z) > P.REACH + P.OFF) continue;
          for (const side of [1, -1]) {
            const x = px - uz * side * P.OFF, z = pz + ux * side * P.OFF;
            if (Math.hypot(x - pile.x, z - pile.z) > P.REACH || city.labelAt(x, z) !== b._lab) continue;
            if (spotOk(b, x, z)) spots.push([x, z, cost(x, z)]);
            break;
          }
        }
      }
    } else stats.noBlock++;
    spots.sort((a, c) => a[2] - c[2] || a[0] - c[0] || a[1] - c[1]);
    const placed = [];
    for (const [x, z] of spots) {
      if (placed.length === n) break;
      if (!clearOfTrees(x, z)) continue;
      placed.push([q(x), q(z)]);
      put(x, z);
    }
    // the trees in their inventory order (by their position on the frontage); when the frontage holds fewer, an even
    // pick of them (the species mix stays)
    const order = pile.ix.slice().sort((a, c) => (+trees[a].pos || 0) - (+trees[c].pos || 0) || a - c);
    const m = placed.length, chosen = new Set();
    stats.each.push([pile.x, pile.z, n, m]);
    for (let j = 0; j < m; j++) chosen.add(order[Math.floor(((j + 0.5) * n) / m)]);
    let j = 0;
    for (const i of order) {
      if (!chosen.has(i)) { keep[i] = 0; stats.dropped++; continue; }
      const [x, z] = placed[j++];
      if (x === trees[i].x && z === trees[i].z) stats.stayed++;
      else stats.moved++;
      trees[i].x = x;
      trees[i].z = z;
    }
  }
  return { kept: trees.filter((_, i) => keep[i]), stats };
}

