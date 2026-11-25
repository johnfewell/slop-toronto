(function () {
'use strict';
// js/portlands-bridges.js — the white steel shell arches of the three Port Lands road bridges (bead jf-li1).
//
// The Port Lands road bridges (Grimshaw / Entuitive / schlaich bergermann, 2022-2024) are one family: a continuous white
// steel plate "shell" that rises and falls over the deck like a ribbon, white outside and one strong colour on the
// underside of its inner edge. The shapes below come from the Canoe Cove rowing world (a sister project cut from this
// map; shape and arch layout only, drawn here in this map's lit materials, no toon or outline pipeline).
//   Commissioners Street — orange and white, two humps in a row (a 12 m one over the west half, an 8 m one over the east);
//   Cherry Street South — yellow and white, one arch;  Cherry Street North — red and white, one arch.
// Sources: Waterfront Toronto, "Port Lands Road and Bridges Backgrounder" (January 2024) for the colours and lengths;
// the arch rises, lean and hump split are the rowing world's own choices, read from the owner's photographs.
//
// What is NOT replaced: this map's road bridges (js/city-config.js ROAD_BRIDGES, js/city-grid.js) already carry the deck,
// kerbs, sidewalks and the driving / walking over them, and stay exactly as they are. The shell is added on top of each
// deck, along the roadway's kerb lines, leaning in over the lanes. Rises scale with how much of the real bridge this
// map's deck covers (the real Commissioners Street bridge is 152 m; this map's deck is the water crossing, ~50 m).
const C = window.CITY;
const K = C.PORTLANDS_KIT;

const WHITE = '#ece9e2', SOFFIT = '#cdc9d2';
// Plan (Canoe Cove) bridge midpoints, as world metres, and the family's colours
const DESIGNS = Object.freeze([
  { id: 'commissioners', road: 'Commissioners Street', mid: [2768.9, 488.6], accent: '#df6a2c', lengthM: 152,
    humps: [{ share: 83 / 152, rise: 12 }, { share: 69 / 152, rise: 8 }] },
  { id: 'cherry-south', road: 'Cherry Street', mid: [2151.5, 796.0], accent: '#f2b400', lengthM: 76, humps: [{ share: 1, rise: 11.5 }] },
  { id: 'cherry-north', road: 'Cherry Street', mid: [1993.6, 387.7], accent: '#cf4a40', lengthM: 55, humps: [{ share: 1, rise: 8.5 }] }
]);
const GROUND_END_M = 12; // the shell runs this far past each bank on the street's own level
const DECK_TOP_Y = 0.24; // the sidewalk top: this map's roadway sits at street level (0.03), its bridge sidewalks at 0.24

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Chains of ROAD_BRIDGES pieces that share ends (a bridge is mapped as several ways): [{ name, w, sidewalks, pts }]. */
function bridgeChains(bridges = C.ROAD_BRIDGES || []) {
  const pieces = bridges.map((b) => ({ b, pts: b.pts.map((p) => ({ x: p.x, z: p.z })), used: false }));
  const chains = [];
  for (const start of pieces) {
    if (start.used) continue;
    start.used = true;
    let pts = start.pts.slice();
    const parts = [start.b];
    for (let grew = true; grew;) {
      grew = false;
      for (const p of pieces) {
        if (p.used || p.b.name !== start.b.name) continue;
        const h = pts[0], t = pts[pts.length - 1], a = p.pts[0], z = p.pts[p.pts.length - 1];
        if (dist(t, a) < 0.6) pts = pts.concat(p.pts.slice(1));
        else if (dist(t, z) < 0.6) pts = pts.concat(p.pts.slice(0, -1).reverse());
        else if (dist(h, z) < 0.6) pts = p.pts.slice(0, -1).concat(pts);
        else if (dist(h, a) < 0.6) pts = p.pts.slice(1).reverse().concat(pts);
        else continue;
        p.used = true; parts.push(p.b); grew = true;
      }
    }
    const b = start.b;
    chains.push({ name: b.name, w: b.w, sidewalks: b.sidewalks || [0, 0], pts, pieces: parts.length });
  }
  return chains;
}

const nearestOnLine = (pts, x, z) => {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], ex = b.x - a.x, ez = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(a.x + ex * t - x, a.z + ez * t - z));
  }
  return best;
};

/** Pad the chain's two ends with straight road continuing on land (the shell runs on past the banks). */
function extend(pts, m) {
  const out = pts.slice();
  const head = pts[0], h2 = pts[1], tail = pts[pts.length - 1], t2 = pts[pts.length - 2];
  const hl = dist(head, h2) || 1, tl = dist(tail, t2) || 1;
  out.unshift({ x: head.x + ((head.x - h2.x) / hl) * m, z: head.z + ((head.z - h2.z) / hl) * m });
  out.push({ x: tail.x + ((tail.x - t2.x) / tl) * m, z: tail.z + ((tail.z - t2.z) / tl) * m });
  return out;
}

/** One shell arch (a hump) on one side of the roadway. */
function buildArch(parts, frame, arch, side, zBase, accent, wScale, joinsStart, joinsEnd) {
  const T = C.THREE;
  const length = arch.x1 - arch.x0, segments = Math.max(4, Math.ceil(length / 0.75));
  // a rounded plate section; the underside strip from 0.93 to 0.62 (edge 7) carries the family colour, and so does the inner
  // rolled lip above it (edges 5 and 6), so the colour shows as a band along the shell's inner rim from beside and across the bridge,
  // not only from under it (the rowing world paints edge 7 alone)
  const profile = [[0, 0], [0.025, 0.42], [0.15, 0.55], [0.68, 0.52], [0.975, 0.34], [1, 0], [0.98, -0.38], [0.93, -0.48], [0.62, -0.52], [0.12, -0.5], [0.025, -0.38]];
  const point = (s, across, thickness) => {
    const x = arch.x0 + length * s, sine = Math.sin(Math.PI * s);
    // the last metre rounds down to a horizontal tangent at the saddle
    const h = arch.rise * (Math.hypot(sine, 0.045) - 0.045) / (Math.hypot(1, 0.045) - 0.045);
    const width = (4.25 + 0.65 * (1 - sine)) * wScale, tilt = 0.57 * Math.min(1, h / 2);
    const [wx, wz] = frame.toWorld(x, zBase + side * (0.4 * wScale - width * across - h * 0.055 * wScale));
    // (the plate's underside rests 1 cm above the sidewalk top at the saddles, where the arch comes down to the deck)
    return new T.Vector3(wx, DECK_TOP_Y + 0.35 + h + across * width * tilt + thickness * 0.65, wz);
  };
  const rings = [];
  for (let i = 0; i <= segments; i++) rings.push(profile.map(([u, d]) => point(i / segments, u, d)));
  K.loft(parts, rings, (edge) => (edge >= 5 && edge <= 7 ? accent : edge === 8 ? SOFFIT : WHITE), { capStart: !joinsStart, capEnd: !joinsEnd });
  // fin-plate hangers from the deck to the plate's underside, every ~7.5 m
  const count = Math.max(2, Math.round(length / 7.5));
  for (let i = 1; i < count; i++) {
    const top = point(i / count, 0.15, -0.5);
    parts.push(K.bar([top.x, DECK_TOP_Y + 0.1, top.z], [top.x, top.y, top.z], 0.11, WHITE));
  }
}

/**
 * Builds the shells for every Port Lands road bridge found in the deck data. Returns
 * { group, bridges: [{ id, name, lengthM, arches }], triangles } — group is null when no matching deck exists
 * (another frame, or ?portlands=0), so nothing is drawn where this map has no deck to stand on.
 */
function buildPortLandsBridges(options = {}) {
  const T = C.THREE;
  const chains = options.chains || bridgeChains();
  const north = options.north || [0.2855, -0.9584];
  const east = [-north[1], north[0]];
  const parts = new K.Parts();
  const built = [];
  for (const design of DESIGNS) {
    // the chain of this road whose centre line passes within 30 m of the design's midpoint
    let chain = null, bestD = 30;
    for (const c of chains) {
      if (c.name !== design.road || c.pts.length < 2) continue;
      const d = nearestOnLine(c.pts, design.mid[0], design.mid[1]);
      if (d < bestD) { bestD = d; chain = c; }
    }
    if (!chain) continue;
    const frame = K.polylineFrame(extend(chain.pts, GROUND_END_M));
    const len = frame.length;
    // which end of the line is west: the first hump (the larger) goes there, as on the rowing world's frame
    const first = frame.at(0), ux = frame.at(len / 2).ux, uz = frame.at(len / 2).uz;
    const westFirst = ux * east[0] + uz * east[1] > 0; // the line runs west to east when it follows the east vector
    void first;
    const scale = Math.max(0.55, Math.min(1, (len - 3) / design.lengthM));
    const x0 = 1.5, x1 = len - 1.5;
    const avail = x1 - x0;
    let humps = design.humps.slice();
    if (!westFirst && humps.length > 1) humps = humps.slice().reverse();
    const arches = [];
    let cursor = x0;
    for (const h of humps) {
      const span = avail * h.share;
      arches.push({ x0: cursor, x1: cursor + span, rise: h.rise * scale });
      cursor += span;
    }
    const hwRoad = chain.w / 2;
    const wScale = Math.max(0.4, Math.min(1, (hwRoad - 0.3) / 6));
    for (const side of [-1, 1]) {
      const sw = chain.sidewalks[side < 0 ? 1 : 0] || 0;
      const zBase = side * (hwRoad + Math.min(0.3, sw * 0.1) + 0.15);
      arches.forEach((arch, i) => buildArch(parts, frame, arch, side, zBase, design.accent, wScale, i > 0, i < arches.length - 1));
    }
    built.push({ id: design.id, name: design.road, lengthM: Math.round(len), arches: arches.map((a) => ({ x0: Math.round(a.x0), x1: Math.round(a.x1), rise: Math.round(a.rise * 10) / 10 })), accent: design.accent });
  }
  const triangles = parts.triangles;
  const geo = parts.merged();
  let group = null;
  if (geo) {
    group = new T.Group();
    group.name = 'PortLandsBridgeShells';
    group.add(K.meshOf(geo, 'steel', 'PortLandsBridgeShells-steel', { cullDistance: 900, cullCell: 220 }));
  }
  return { group, bridges: built, triangles, colliders: [] };
}

Object.assign(C, { buildPortLandsBridges, portLandsBridgeChains: bridgeChains });
})();
