(function () {
// js/waterfront-bathurst.js
// The western BIA gateway the central/eastern wave did not cover: the Canada Malting Complex at 5 Eireann Quay (1
// Eireann Quay / Bathurst Quay Common), the round 1929 "south" silos and the flat-walled 1944 "north" silos with their
// headhouses and marine leg (epic st-sb3r, bead .12).
//
// Source hierarchy (the module is text-and-geodata sourced; the author of this file cannot read images):
//   1. City of Toronto staff report, "5 Eireann Quay - Intention to Designate under Part IV, Section 29 of the Ontario
//      Heritage Act", 2009-03-10 (https://www.toronto.ca/legdocs/mmis/2009/pb/bgrd/backgroundfile-19569.pdf), the
//      Reasons for Designation: the SOUTH 1929 silos rise 100 ft (30.48 m) and hold 15 circular bins in three rows
//      visible on the exterior plus square/irregular bins, adjoined by the 1929 headhouse; the NORTH 1944 silos (T.
//      Pringle and Son with E.C. Miller) stand 125 ft (38.1 m) high, hold 14 circular bins in two rows concealed by
//      flat exterior walls (more than twice the south capacity), and carry the lettering "Canada Malting Co. Limited"
//      on the east side. Both batteries are reinforced concrete on timber piles / concrete pads, with headhouses and a
//      marine leg.
//   2. ERA Architects, "Canada Malting Silo" (https://www.eraarch.ca/projects/canada-malting-silo/), the 2020-2024
//      restoration: two rare surviving grain elevators (1929 and 1944), reinforcement-concrete exteriors conserved and
//      the iconic signage lettering restored on the EAST and WEST facades; the site is now Bathurst Quay Common.
//   3. City of Toronto news release, 2024-10-04, "City of Toronto unveils Bathurst Quay Common"
//      (https://www.toronto.ca/news/city-of-toronto-unveils-bathurst-quay-common-a-new-waterfront-oasis/): the opened
//      park, the restored heritage buildings and Ireland Park, the silos lit at night.
//   4. The committed geodata (js/toronto-geodata.js / data/frames/eglinton/toronto-geodata.bin): seven rows named
//      "Canada Malting Silos" whose City of Toronto 3D Massing footprints the module stands on and replaces. Their
//      LIDAR heights (50.6-65.6 m) are the massing maxima (marine leg / headhouses included), NOT the silo-bin heights
//      the heritage report measures, so the bins are raised to the measured 30.48 / 38.1 m.
//   5. OpenStreetMap relation 21646938 "Canada Malting Silos" (© OpenStreetMap contributors, ODbL), ways 43806399 and
//      1568011088: the two real outer rings of the batteries, fetched 2026-11-09. The round south ring's eastern edge
//      is a chain of arcs; the outermost point of each arc is one exposed bin. The module derives the bin grid from
//      those measured arcs and the documented bin counts, never from invented free-yard cylinders.
//
// The photo-form review of the restored silos (view east across Portland Slip) was made by the captain, not this
// module's author: south five exposed cylinders under a flat connecting roof; a narrow tall headhouse with small
// vertical windows; the flat 38.1 m north block with a thin top clerestory row of dark rectangular windows and the
// "CANADA MALTING CO. LIMITED" lettering just below; a very narrow marine leg (~55 m, 3 square dark windows). The
// concrete is pale greige with faint horizontal formwork, not pure white and not corrugated. Those are the forms
// below; every height taken from the review is labelled an estimate.
//
// Geometry fidelity rules
// -----------------------
// - Every solid sits on a committed footprint: the two batteries on their OSM relation rings, the headhouses and the
//   marine leg on the mapped "Canada Malting Silos" rows. No part is scattered in open space.
// - The north bins are CONCEALED: the north block is a single flat-walled extrusion; no north cylinders are drawn.
//   Only the mapped count (14 = 2 rows x 7) is reported. The south bins are drawn as 15 cylinders (3 rows x 5).
// - Components are keyed by stable identity (mapped name + world centre + mapped height), not by row index: detail
//   rows 33097..33103 = eglinton rows 130964..130970, so the module resolves the active frame's rows every time.
// - The city-grid createExtrudedPolygonMesh helper returns a MESH; the module takes its .geometry before merging, so
//   the integrated-runtime failure (a Mesh handed to mergeGeometries) cannot recur.
// - The replacement is optional and gated: window.CITY.waterfrontBathurstEnabled (default true) and ?bathurst=0 both
//   disable it; the exclusion predicate then answers false and the builder returns an empty group.
// - A neighbouring building (the Corleck Building, rows 32974/32976) is deliberately NOT claimed.

const C = window.CITY;
const BASE = 0.04;                 // the silos stand on park ground, just clear of the ground plane

// ---------------------------------------------------------------------------------------------------------------------
// Source-backed shapes (measured dimensions; estimates called out where the source does not give a figure)
// ---------------------------------------------------------------------------------------------------------------------
const SOUTH_SILO_H = 30.48;        // heritage: south 1929 silos, 100 ft
const NORTH_SILO_H = 38.1;         // heritage: north 1944 silos, 125 ft
const SOUTH_HEADHOUSE_H = 44.0;    // ESTIMATE (photo): the 1929 headhouse rises above the 30.48 m bins
const NORTH_HEADHOUSE_H = 48.0;    // ESTIMATE (photo): the 1944 headhouse is taller than the 38.1 m block
const MARINE_LEG_H = 55.0;         // ESTIMATE (photo): the marine leg ~55 m at the north block's water edge
const SOUTH_BIN_ROWS = 3, SOUTH_BIN_COLS = 5;   // heritage: 15 circular bins in three rows
const NORTH_BIN_ROWS = 2, NORTH_BIN_COLS = 7;   // heritage: 14 circular bins in two rows (concealed)
const LETTERING = 'CANADA MALTING CO. LIMITED';

const CANADA_MALTING = {
  id: 'canadaMaltingSilos',
  name: 'Canada Malting Complex (Silos)',
  short: 'Canada Malting',
  address: '5 Eireann Quay (Bathurst Quay Common)',
  source: 'Canada Malting Complex: the 1929 south silos (100 ft / 30.48 m, 15 circular bins in three rows, exposed) ' +
    'with the 1929 headhouse, and the 1944 north silos (125 ft / 38.1 m, 14 circular bins in two rows concealed by ' +
    'flat walls, "Canada Malting Co. Limited" lettering) with the headhouse and marine leg; reinforced concrete, ' +
    'restored 2020-2024 within Bathurst Quay Common',
  sourceUrls: [
    'https://www.toronto.ca/legdocs/mmis/2009/pb/bgrd/backgroundfile-19569.pdf',
    'https://www.eraarch.ca/projects/canada-malting-silo/',
    'https://www.toronto.ca/news/city-of-toronto-unveils-bathurst-quay-common-a-new-waterfront-oasis/',
    'https://www.openstreetmap.org/relation/21646938'
  ]
};

// The two battery outer rings, world metres (GEO.frame.projection), from OSM relation 21646938 (ODbL). These are the
// real mapped outlines; the south ring's east edge is the chain of bin arcs.
const SOUTH_RING = [
  [-1519.1, 719.9], [-1517.9, 724.6], [-1516.6, 729.4], [-1515.1, 729.7], [-1514, 730.7], [-1513.3, 732],
  [-1513, 733.4], [-1513.1, 734.9], [-1513.7, 736.2], [-1514.6, 737.2], [-1514.5, 737.5], [-1513.7, 737.5],
  [-1512.5, 738.1], [-1511.6, 739.1], [-1511, 740.3], [-1510.9, 741.7], [-1511.3, 743], [-1512.1, 744.1],
  [-1512.6, 744.6], [-1512.5, 745.1], [-1511.9, 745.1], [-1510.7, 745.5], [-1509.8, 746.3], [-1509.1, 747.3],
  [-1508.7, 748.5], [-1508.8, 749.7], [-1509.2, 750.8], [-1510, 751.8], [-1510.6, 752.2], [-1510.5, 752.7],
  [-1509, 753.2], [-1507.9, 753.9], [-1507.2, 755], [-1506.8, 756.1], [-1506.8, 757.4], [-1507.2, 758.6],
  [-1508, 759.6], [-1508.5, 759.9], [-1508.3, 760.5], [-1507.3, 760.6], [-1506.1, 761.5], [-1505.2, 762.7],
  [-1504.8, 764.1], [-1504.8, 765.6], [-1505.4, 767], [-1507.1, 768.3], [-1509.6, 768.9], [-1520.5, 771.9],
  [-1523.4, 772.7], [-1524.8, 772.7], [-1526.1, 772.3], [-1527.2, 771.5], [-1527.9, 770.4], [-1528.3, 769.1],
  [-1528.2, 767.8], [-1527.7, 766.5], [-1526.9, 765.5], [-1525.7, 764.8], [-1527, 764.7], [-1528.2, 764.3],
  [-1529.2, 763.5], [-1529.9, 762.5], [-1530.2, 761.2], [-1530.2, 760], [-1529.7, 758.8], [-1528.9, 757.8],
  [-1527.9, 757.1], [-1529.2, 757.1], [-1530.3, 756.7], [-1531.3, 755.9], [-1532.1, 754.9], [-1532.4, 753.7],
  [-1532.4, 752.4], [-1531.9, 751.3], [-1531.1, 750.3], [-1530, 749.6], [-1531.4, 749.5], [-1532.7, 748.9],
  [-1533.8, 747.9], [-1534.4, 746.7], [-1534.6, 745.3], [-1534.4, 743.9], [-1533.7, 742.7], [-1532.3, 741.6],
  [-1533.4, 741.6], [-1534.7, 741.1], [-1535.8, 740.1], [-1536.5, 738.8], [-1536.7, 737.4], [-1536.4, 735.9],
  [-1535.7, 734.7], [-1534.2, 733.7], [-1535, 731.1], [-1538.5, 732], [-1540.2, 725.2], [-1536.6, 724.3],
  [-1532.3, 723.1], [-1531.6, 722.9], [-1522.6, 720.8]
];
const NORTH_RING = [
  [-1530, 717.8], [-1530.4, 716.1], [-1542.6, 669.5], [-1542.3, 668.6], [-1541.7, 667.9], [-1540.9, 667.4],
  [-1540, 667.2], [-1539.1, 667.2], [-1538.2, 667.5], [-1536.1, 666.9], [-1535.3, 666.2], [-1534.4, 665.7],
  [-1533.3, 665.7], [-1532.2, 665.9], [-1531.3, 666.5], [-1518.7, 714.7]
];
// The outermost point of each of the five exposed south bins (the OSM east-edge arcs), world metres.
const SOUTH_EAST_PEAKS = [
  [-1513.0, 733.4], [-1510.9, 741.7], [-1508.7, 748.5], [-1506.8, 756.1], [-1504.8, 764.1]
];

// The seven committed rows to replace, keyed by stable identity (mapped name + centre + mapped height). The rows are
// the same world centres in every frame but different indices (detail 33097..33103, eglinton 130964..130970).
const ROW_KEYS = {
  northBlock:      { name: 'Canada Malting Silos', cx: -1531.9, cz: 687.4, h: 50.6 }, // the 1944 north block massing
  marineLeg:       { name: 'Canada Malting Silos', cx: -1524.0, cz: 710.1, h: 65.6 }, // tall narrow marine leg
  northHeadhouse:  { name: 'Canada Malting Silos', cx: -1528.8, cz: 714.4, h: 64.0 }, // 1944 headhouse
  southHeadhouse:  { name: 'Canada Malting Silos', cx: -1527.3, cz: 726.3, h: 59.9 }, // 1929 headhouse
  southBatteryA:   { name: 'Canada Malting Silos', cx: -1530.6, cz: 752.3, h: 53.2 },
  southBatteryB:   { name: 'Canada Malting Silos', cx: -1513.6, cz: 747.6, h: 56.9 },
  southBatteryC:   { name: 'Canada Malting Silos', cx: -1523.5, cz: 746.7, h: 57.3 }
};

// ---------------------------------------------------------------------------------------------------------------------
// Pure geometry math (shared with tests; no THREE)
// ---------------------------------------------------------------------------------------------------------------------
function bathurstPointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function bathurstRingDistance(ring, x, z) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}
function bathurstPolygonArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a / 2);
}
// Oriented frame of a ring: centroid + major axis (PCA), with world <-> local (u along the length, v across it).
function bathurstRingFrame(ring) {
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  cx /= ring.length; cz /= ring.length;
  let sxx = 0, sxz = 0, szz = 0;
  for (const [x, z] of ring) { const dx = x - cx, dz = z - cz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const c = Math.cos(ang), s = Math.sin(ang);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of ring) {
    const dx = x - cx, dz = z - cz, u = dx * c + dz * s, v = -dx * s + dz * c;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  return {
    cx, cz, ang, c, s, u0, u1, v0, v1, uMid: (u0 + u1) / 2, vMid: (v0 + v1) / 2,
    length: u1 - u0, depth: v1 - v0,
    toLocal: (x, z) => { const dx = x - cx, dz = z - cz; return { u: dx * c + dz * s, v: -dx * s + dz * c }; },
    toWorld: (u, v) => [cx + u * c - v * s, cz + u * s + v * c]
  };
}
// The five exposed south bins: their arc outermost points in the ring frame, then the 3 x 5 touching-cylinder grid
// stepped inward (toward the ring centroid). Diameter = the measured mean arc spacing. No guessed cylinders.
function bathurstSouthBinGrid(ring = SOUTH_RING, peaks = SOUTH_EAST_PEAKS) {
  const frame = bathurstRingFrame(ring);
  const local = peaks.map(([x, z]) => frame.toLocal(x, z)).sort((a, b) => a.u - b.u);
  let sum = 0;
  for (let i = 1; i < local.length; i++) sum += local[i].u - local[i - 1].u;
  const spacing = sum / (local.length - 1);          // measured bin diameter (touching bins)
  const radius = spacing / 2;
  const vFace = local.reduce((a, p) => a + p.v, 0) / local.length;
  const inward = frame.vMid >= vFace ? 1 : -1;       // from the exposed face toward the ring centre
  const rows = SOUTH_BIN_ROWS, cols = local.length;
  const centers = [];
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const u = local[col].u, v = vFace + inward * (radius + r * spacing);
      const [x, z] = frame.toWorld(u, v);
      centers.push({ row: r, col, u, v: Math.abs(v), x, z, inside: bathurstPointInRing(ring, x, z) });
    }
  }
  // the u-extent the round bins occupy (for splitting the shell from the bins)
  const uMin = local[0].u - radius, uMax = local[local.length - 1].u + radius;
  return { frame, spacing, radius, rows, cols, centers, uMin, uMax, vFace, inward };
}
// The north block's concealed bins: only their documented 2 x 7 count and OSM-derived spacing are reported.
function bathurstNorthBinSpec(ring = NORTH_RING) {
  const frame = bathurstRingFrame(ring);
  const diameter = frame.length / NORTH_BIN_COLS;
  return { frame, rows: NORTH_BIN_ROWS, cols: NORTH_BIN_COLS, count: NORTH_BIN_ROWS * NORTH_BIN_COLS, diameter, concealed: true };
}
// Sutherland-Hodgman clip of a local-frame [{u,v}] polygon to a half-plane (axis-aligned), used to split the south
// shell (headhouse / square-bin ends) off the round-bin bays.
function bathurstClipLocal(pts, axis, bound, keepGreater) {
  const out = [];
  const val = (p) => (axis === 'u' ? p.u : p.v);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const da = val(a) - bound, db = val(b) - bound;
    const ia = keepGreater ? da >= 0 : da <= 0, ib = keepGreater ? db >= 0 : db <= 0;
    if (ia) out.push(a);
    if (ia !== ib) { const t = da / (da - db); out.push({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t }); }
  }
  return out;
}
function bathurstRingToLocal(ring, frame) { return ring.map(([x, z]) => frame.toLocal(x, z)); }
function bathurstLocalToRing(pts, frame) { return pts.map((p) => frame.toWorld(p.u, p.v)); }

// Resolve the stable row keys to the ACTIVE frame's building rows (name + centre + mapped height). Cached per GEO, so
// the exclusion predicate can answer before the builder runs. A row that does not resolve stays null.
const ROW_CACHE = new WeakMap();
function bathurstResolveRows(G = C?.GEO) {
  if (!G || !Array.isArray(G.buildings)) return null;
  if (ROW_CACHE.has(G)) return ROW_CACHE.get(G);
  const ids = Object.keys(ROW_KEYS);
  const found = Object.fromEntries(ids.map((id) => [id, null]));
  const tol = 1.0, tolH = 0.6;
  for (let bi = 0; bi < G.buildings.length; bi++) {
    const b = G.buildings[bi];
    if (!Array.isArray(b)) continue;
    for (const id of ids) {
      if (found[id] !== null) continue;
      const k = ROW_KEYS[id];
      if (b[9] !== k.name) continue;
      if (Math.hypot(b[0] - k.cx, b[1] - k.cz) <= tol && Math.abs(b[4] - k.h) <= tolH) found[id] = bi;
    }
  }
  ROW_CACHE.set(G, found);
  return found;
}

// The frame capability guard: the active city really covers the mapped silos (detail or eglinton) and the two OSM
// rings stand in it. Distinct name from the sibling modules' local supportedCityFrame so nothing is shadowed.
function bathurstSupported(G = C?.GEO) {
  if (!G || !G.frame || !G.frame.detail) return false;
  if (!Array.isArray(G.buildings) || !G.buildings.length) return false;
  const R = bathurstResolveRows(G);
  if (!R || R.northBlock === null || R.southHeadhouse === null) return false;
  const d = G.frame.detail, inFrame = (x, z) => x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1;
  const nf = bathurstRingFrame(NORTH_RING), sf = bathurstRingFrame(SOUTH_RING);
  return inFrame(nf.cx, nf.cz) && inFrame(sf.cx, sf.cz);
}

// Optional replacement gate: default on, off via window.CITY.waterfrontBathurstEnabled = false or ?bathurst=0.
function bathurstEnabled() {
  if (C && C.waterfrontBathurstEnabled === false) return false;
  try {
    if (typeof location !== 'undefined' && location && location.search && typeof URLSearchParams !== 'undefined') {
      if (new URLSearchParams(location.search).get('bathurst') === '0') return false;
    }
  } catch { /* no location (tests) */ }
  return true;
}

// The exact rows this module replaces, resolved for the active frame. Never an unrelated building.
function bathurstExcludedRows(G = C?.GEO) {
  const rows = new Set();
  const R = bathurstResolveRows(G);
  if (R) for (const id of Object.keys(R)) if (R[id] !== null) rows.add(R[id]);
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pure layout (testable without a renderer)
// ---------------------------------------------------------------------------------------------------------------------
function waterfrontBathurstLayout({ geo = C?.GEO } = {}) {
  if (!bathurstSupported(geo)) return { supported: false, enabled: bathurstEnabled() };
  const R = bathurstResolveRows(geo);
  const south = bathurstSouthBinGrid();
  const north = bathurstNorthBinSpec();
  const rowPart = (bi) => {
    const b = geo.buildings[bi];
    if (!Array.isArray(b) || !b[3] || !b[3].length) return null;
    const [cx, cz, ang, parts, h] = b;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const out = [];
    for (const p of parts) {
      const uc = (p[0] + p[1]) / 2, vc = (p[2] + p[3]) / 2;
      const halfW = (p[1] - p[0]) / 2, halfD = (p[3] - p[2]) / 2;
      if (!(halfW > 0 && halfD > 0)) continue;
      out.push({ row: bi, cx: cx + uc * cs + vc * sn, cz: cz - uc * sn + vc * cs, ang, halfW, halfD, mappedH: h });
    }
    return out;
  };
  const structures = {
    northBlock: { ring: NORTH_RING.map((p) => p.slice()), height: NORTH_SILO_H, bins: north, concealed: true },
    southBattery: {
      height: SOUTH_SILO_H, bins: { rows: south.rows, cols: south.cols, count: south.rows * south.cols, diameter: south.spacing, exposed: true },
      radius: south.radius, centers: south.centers, frame: south.frame, uMin: south.uMin, uMax: south.uMax,
      ring: SOUTH_RING.map((p) => p.slice())
    },
    headhouses: [],
    marineLeg: null
  };
  for (const p of rowPart(R.southHeadhouse) || []) structures.headhouses.push({
    role: 'southHeadhouse1929', height: SOUTH_HEADHOUSE_H, heightBasis: 'photo estimate', ...p
  });
  for (const p of rowPart(R.northHeadhouse) || []) structures.headhouses.push({
    role: 'northHeadhouse1944', height: NORTH_HEADHOUSE_H, heightBasis: 'photo estimate', ...p
  });
  const ml = rowPart(R.marineLeg) || [];
  if (ml.length) structures.marineLeg = { role: 'marineLeg', height: MARINE_LEG_H, heightBasis: 'photo estimate', ...ml[0] };

  return {
    supported: true, enabled: bathurstEnabled(),
    landmark: CANADA_MALTING,
    heights: {
      southSilo: SOUTH_SILO_H, northSilo: NORTH_SILO_H,
      southHeadhouse: SOUTH_HEADHOUSE_H, northHeadhouse: NORTH_HEADHOUSE_H, marineLeg: MARINE_LEG_H,
      mappedRowHeights: [50.6, 53.2, 56.9, 57.3, 59.9, 64.0, 65.6],
      note: 'silo-bin heights are the heritage-measured 30.48 / 38.1 m; headhouse and marine-leg heights are photo estimates'
    },
    lettering: { text: LETTERING, faces: ['east', 'west'] },
    structures,
    bins: {
      south: { rows: SOUTH_BIN_ROWS, cols: SOUTH_BIN_COLS, count: SOUTH_BIN_ROWS * SOUTH_BIN_COLS, exposed: true, diameter: +south.spacing.toFixed(3) },
      north: { rows: NORTH_BIN_ROWS, cols: NORTH_BIN_COLS, count: NORTH_BIN_ROWS * NORTH_BIN_COLS, exposed: false, concealed: true, diameter: +north.diameter.toFixed(3) }
    },
    excludedRows: [...bathurstExcludedRows(geo)],
    rows: R,
    source: {
      heritage: CANADA_MALTING.sourceUrls[0],
      era: CANADA_MALTING.sourceUrls[1],
      city: CANADA_MALTING.sourceUrls[2],
      osmRelation: 21646938,
      osmWays: [43806399, 1568011088],   // south ring, north ring
      osmAttribution: '© OpenStreetMap contributors (ODbL)'
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry (THREE). Shared, culling-friendly geometry under one root.
// ---------------------------------------------------------------------------------------------------------------------
function boxGeo(THREE, w, h, d, x, y, z, ry) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  return g.translate(x, y, z);
}
function bathurstMerge(THREE, geos) {
  const mergeGeometries = C?.Addons?.mergeGeometries;
  if (!mergeGeometries) throw new Error('waterfront-bathurst: CITY.Addons.mergeGeometries is required');
  const norm = [];
  for (const g of geos) {
    if (!g || !g.attributes) throw new Error('waterfront-bathurst: a non-geometry reached merge (take .geometry)');
    const n = g.index ? g.toNonIndexed() : g;
    for (const key of Object.keys(n.attributes)) if (key !== 'position' && key !== 'normal' && key !== 'uv') n.deleteAttribute(key);
    if (!n.attributes.normal) n.computeVertexNormals();
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    norm.push(n);
    if (n !== g) g.dispose?.();
  }
  const out = mergeGeometries(norm, false);
  for (const n of norm) n.dispose?.();
  return out;
}
// A ring wound consistently (the OSM/clipped contours may arrive either way; ExtrudeGeometry normals follow winding).
function bathurstEnsureCCW(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a >= 0 ? ring : ring.slice().reverse();
}
// An extruded solid from a world [x,z] ring, as a GEOMETRY. Takes .geometry when the city-grid helper returns a Mesh.
function bathurstExtrude(THREE, ring, y0, h) {
  if (!(ring.length >= 3) || bathurstPolygonArea(ring) < 0.5) return null;
  const pts = bathurstEnsureCCW(ring);
  if (typeof C?.createExtrudedPolygonMesh === 'function') {
    const made = C.createExtrudedPolygonMesh(pts.map(([x, z]) => ({ x, z })), y0, h, null, true, true);
    const geo = made && made.isMesh ? made.geometry : made;
    if (geo && geo.attributes && geo.attributes.position) return geo;
    throw new Error('waterfront-bathurst: createExtrudedPolygonMesh returned no geometry');
  }
  const shape = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return g;
}
function standardMaterial(THREE, params) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat(params);
}
// A faint horizontal-formwork / weathering texture (browser canvas), applied as a near-white multiplier over the pale
// greige material colour. Returns null in Node, where the plain colour stands in.
function bathurstConcreteTexture(THREE, repeatY = 0.12) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  try {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#f7f5f1'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(150,143,131,0.55)'; ctx.lineWidth = 1.4;
    for (let y = 10; y < 256; y += 42) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
    for (let i = 0; i < 900; i++) {
      const a = 0.015 + Math.random() * 0.05;
      ctx.fillStyle = `rgba(${120 + (Math.random() * 60) | 0},${116 + (Math.random() * 60) | 0},${108 + (Math.random() * 60) | 0},${a.toFixed(3)})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 6, 1.2);
    }
    const tex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(0.08, repeatY);
    tex.anisotropy = 4;
    return tex;
  } catch { return null; }
}
// Lettering: dark charcoal on the concrete colour, drawn into a canvas texture. A plain band is never used as the
// letters themselves; without a canvas the panel reports legible:false.
function bathurstLetterTexture(THREE, text) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  try {
    const w = 1024, h = 128;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'); if (!ctx) return null;
    ctx.fillStyle = '#bdb7a9'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2b2f33';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(h * 0.5)}px "Arial Narrow", Arial, Helvetica, sans-serif`;
    ctx.fillText(text, w / 2, h * 0.54, w - 40);
    const tex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  } catch { return null; }
}
function bathurstAddCollider(colliders, cx, cz, hw, hd, ang, minY, maxY, kind) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const ex = Math.abs(cs) * hw + Math.abs(sn) * hd, ez = Math.abs(sn) * hw + Math.abs(cs) * hd;
  colliders.push({
    minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY, prop: false, kind,
    obb: { cx, cz, hx: hw, hz: hd, cs, sn }
  });
}
// The east-most face of a mapped row part: the outward normal with the greatest +x component (the water side here).
function bathurstEastFace(part) {
  const { cx, cz, ang, halfW, halfD } = part;
  const c = Math.cos(ang), s = Math.sin(ang);
  const faces = [
    { nx: c, nz: -s, tx: s, tz: c, len: halfD * 2, ox: c * halfW, oz: -s * halfW },     // +u
    { nx: -c, nz: s, tx: -s, tz: -c, len: halfD * 2, ox: -c * halfW, oz: s * halfW },   // -u
    { nx: s, nz: c, tx: -c, tz: s, len: halfW * 2, ox: s * halfD, oz: c * halfD },      // +v
    { nx: -s, nz: -c, tx: c, tz: -s, len: halfW * 2, ox: -s * halfD, oz: -c * halfD }   // -v
  ];
  faces.sort((a, b) => b.nx - a.nx);
  const f = faces[0];
  return { cx: cx + f.ox, cz: cz + f.oz, nx: f.nx, nz: f.nz, tx: f.tx, tz: f.tz, len: f.len, yaw: Math.atan2(-f.tz, f.tx) };
}
function addWindowStrip(THREE, out, face, { y, count, gap = 0.4, w = 0.8, h = 1.6, thickness = 0.16 }) {
  const total = count * w + (count - 1) * gap;
  for (let i = 0; i < count; i++) {
    const along = -total / 2 + w / 2 + i * (w + gap);
    const x = face.cx + face.tx * along + face.nx * thickness * 0.5;
    const z = face.cz + face.tz * along + face.nz * thickness * 0.5;
    out.push(boxGeo(THREE, w, h, thickness, x, y, z, face.yaw));
  }
}

// The two long facades (min-v east, max-v west) of an oriented frame. Local +v is west, so the min-v wall is east.
function bathurstLongFacade(frame, side) {
  const east = side === 'east';
  const v = east ? frame.v0 : frame.v1;
  const nx = east ? frame.s : -frame.s;
  const nz = east ? -frame.c : frame.c;
  const [mx, mz] = frame.toWorld(frame.uMid, v + (east ? -0.12 : 0.12));
  return { cx: mx, cz: mz, nx, nz, tx: frame.c, tz: frame.s, yaw: Math.atan2(nx, nz), len: frame.length - 1.2 };
}

function buildBathurst(THREE, layout, group, colliders, stats) {
  const concreteTex = bathurstConcreteTexture(THREE, 0.12);
  const concreteMat = standardMaterial(THREE, { color: 0xbdb7a9, roughness: 0.92, metalness: 0.02 });
  if (concreteTex) concreteMat.map = concreteTex;
  const roofMat = standardMaterial(THREE, { color: 0x8f8b83, roughness: 0.8, metalness: 0.06 });
  const windowMat = standardMaterial(THREE, { color: 0x23272b, roughness: 0.35, metalness: 0.1 });
  const dark = [];
  const shellParts = [];

  const tagMesh = (mesh, name, cullDistance = 1500, cullCell = 220) => {
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.cullDistance = cullDistance; mesh.userData.cullCell = cullCell;
    if (mesh.geometry.computeBoundingSphere) mesh.geometry.computeBoundingSphere();
    mesh.name = name;
    group.add(mesh); stats.meshes++;
    return mesh;
  };

  // ---- north silos (1944): the flat-walled block conceals the 2 x 7 bins --------------------------------
  const nb = layout.structures.northBlock;
  {
    const shell = bathurstExtrude(THREE, nb.ring, BASE, nb.height - BASE);
    if (shell) tagMesh(new THREE.Mesh(shell, concreteMat), 'WaterfrontBathurst_NorthBlock_Shell');
    const cap = bathurstExtrude(THREE, nb.ring, nb.height, 0.4);
    if (cap) tagMesh(new THREE.Mesh(cap, roofMat), 'WaterfrontBathurst_NorthBlock_Roof');
    // the thin top clerestory row of dark rectangular windows on the long east and west facades
    const nf = bathurstRingFrame(nb.ring);
    for (const side of ['east', 'west']) addWindowStrip(THREE, dark, bathurstLongFacade(nf, side), { y: nb.height - 2.2, count: 9, w: 1.6, h: 1.3, gap: 0.9 });
    bathurstAddCollider(colliders, nf.cx, nf.cz, nf.length / 2, nf.depth / 2, nf.ang, BASE, BASE + nb.height, 'landmark');
    stats.north = { height: nb.height, bins: nb.bins.count, concealed: true, diameter: +nb.bins.diameter.toFixed(3) };
  }

  // ---- south silos (1929): 15 exposed cylinders (3 rows x 5) + the square-bin / headhouse shell ends -----
  const sb = layout.structures.southBattery;
  {
    const height = sb.height - BASE;
    const cyls = [];
    const shared = new THREE.CylinderGeometry(sb.radius, sb.radius, height, 18, 1, false);
    for (const ctr of sb.centers) {
      const g = shared.clone();
      g.translate(ctr.x, BASE + height / 2, ctr.z);
      cyls.push(g);
    }
    shared.dispose();
    const cylinders = bathurstMerge(THREE, cyls);
    tagMesh(new THREE.Mesh(cylinders, concreteMat), 'WaterfrontBathurst_SouthSilos_Bins');
    // the shell ends not occupied by the round bins: the north headhouse / square-bin end, and any south end
    const frame = sb.frame;
    const local = bathurstRingToLocal(sb.ring, frame);
    for (const [axis, bound, keepGreater] of [['u', sb.uMin, false], ['u', sb.uMax, true]]) {
      const clipped = bathurstClipLocal(local, axis, bound, keepGreater);
      const ring = bathurstLocalToRing(clipped, frame);
      const g = bathurstExtrude(THREE, ring, BASE, height);
      if (g) shellParts.push(g);
    }
    if (shellParts.length) tagMesh(new THREE.Mesh(bathurstMerge(THREE, shellParts), concreteMat), 'WaterfrontBathurst_SouthSilos_Shell');
    // the flat connecting roof over the whole battery
    const roof = bathurstExtrude(THREE, sb.ring, sb.height, 0.4);
    if (roof) tagMesh(new THREE.Mesh(roof, roofMat), 'WaterfrontBathurst_SouthSilos_Roof');
    const sf = bathurstRingFrame(sb.ring);
    bathurstAddCollider(colliders, sf.cx, sf.cz, sf.length / 2, sf.depth / 2, sf.ang, BASE, BASE + sb.height, 'landmark');
    stats.south = { height: sb.height, bins: sb.centers.length, rows: sb.bins.rows, cols: sb.bins.cols, exposed: true, radius: +sb.radius.toFixed(3), diameter: +sb.bins.diameter.toFixed(3), allInsideRing: sb.centers.every((c) => c.inside) };
  }

  // ---- headhouses (1929 south, 1944 north) and the marine leg ------------------------------------------
  const wallFor = (s) => ({ role: s.role, height: s.height, heightBasis: s.heightBasis, cx: s.cx, cz: s.cz, ang: s.ang, halfW: s.halfW, halfD: s.halfD });
  for (const s of layout.structures.headhouses) {
    const wall = wallFor(s);
    const g = bathurstExtrude(THREE, turnedRectRing(THREE, wall), BASE, wall.height - BASE);
    if (!g) continue;
    tagMesh(new THREE.Mesh(g, concreteMat), `WaterfrontBathurst_${s.role}_Shell`);
    tagMesh(new THREE.Mesh(boxGeo(THREE, wall.halfW * 2 + 0.3, 0.35, wall.halfD * 2 + 0.3, wall.cx, wall.height + 0.18, wall.cz, wall.ang), roofMat),
      `WaterfrontBathurst_${s.role}_Roof`);
    const face = bathurstEastFace(wall);
    addWindowStrip(THREE, dark, face, { y: wall.height - 4.0, count: 4, w: 0.8, h: 2.2, gap: 1.1 });
    bathurstAddCollider(colliders, wall.cx, wall.cz, wall.halfW, wall.halfD, wall.ang, BASE, BASE + wall.height, 'landmark');
  }
  const ml = layout.structures.marineLeg;
  if (ml) {
    const wall = wallFor(ml);
    const g = bathurstExtrude(THREE, turnedRectRing(THREE, wall), BASE, wall.height - BASE);
    if (g) tagMesh(new THREE.Mesh(g, concreteMat), 'WaterfrontBathurst_MarineLeg_Shell');
    const face = bathurstEastFace(wall);
    // three square dark windows stacked on the water face
    for (let i = 0; i < 3; i++) {
      const along = 0;
      const x = face.cx + face.tx * along + face.nx * 0.09;
      const z = face.cz + face.tz * along + face.nz * 0.09;
      dark.push(boxGeo(THREE, 0.9, 1.1, 0.18, x, wall.height - 3 - i * 2.2, z, face.yaw));
    }
    bathurstAddCollider(colliders, wall.cx, wall.cz, wall.halfW, wall.halfD, wall.ang, BASE, BASE + wall.height, 'landmark');
    stats.marineLeg = { height: wall.height, heightBasis: wall.heightBasis };
  }

  // ---- the "CANADA MALTING CO. LIMITED" lettering on the north block's east and west facades -----------
  const nframe = bathurstRingFrame(NORTH_RING);
  const letterTex = bathurstLetterTexture(THREE, LETTERING);
  const signs = [];
  for (const side of ['east', 'west']) {
    const face = bathurstLongFacade(nframe, side);
    const len = Math.min(26, face.len), h = 2.3;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, h), standardMaterial(THREE, { color: 0xbdb7a9, roughness: 0.9, metalness: 0.0 }));
    if (letterTex) {
      const tex = letterTex.clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      mesh.material.map = tex;
      mesh.material.color.set(0xffffff);
    }
    mesh.position.set(face.cx, NORTH_SILO_H - 4.6, face.cz);
    mesh.rotation.y = Math.atan2(face.nx, face.nz);
    mesh.userData.signText = LETTERING;
    mesh.userData.legible = !!letterTex;
    mesh.userData.face = side;
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.userData.cullDistance = 1600; mesh.userData.cullCell = 220;
    if (mesh.geometry.computeBoundingSphere) mesh.geometry.computeBoundingSphere();
    mesh.name = `WaterfrontBathurst_Lettering_${side}`;
    group.add(mesh); stats.meshes++;
    signs.push(mesh);
  }
  stats.lettering = { text: LETTERING, faces: ['east', 'west'], legible: !!letterTex };
  stats.signText = LETTERING;

  // ---- the dark windows as one merged, shared mesh ------------------------------------------------------
  if (dark.length) tagMesh(new THREE.Mesh(bathurstMerge(THREE, dark), windowMat), 'WaterfrontBathurst_Windows');

  stats.surfaceTexture = !!concreteTex;
  stats.concreteColor = '#bdb7a9';
  return true;
}

// A turned-rect footprint part -> world ring (for the headhouses / marine leg, which stand on mapped rows).
function turnedRectRing(THREE, part, inset = 0.05) {
  const cs = Math.cos(part.ang), sn = Math.sin(part.ang);
  const hw = part.halfW - inset, hd = part.halfD - inset;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [part.cx + u * cs + v * sn, part.cz - u * sn + v * cs]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Builder: returns { group, colliders, stats }
// ---------------------------------------------------------------------------------------------------------------------
function createWaterfrontBathurst(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-bathurst: THREE is required');
  const group = new THREE.Group();
  group.name = 'WaterfrontBathurst';
  const colliders = [];
  const enabled = bathurstEnabled();
  const layout = waterfrontBathurstLayout();
  const stats = {
    supported: layout.supported, enabled, meshes: 0, colliders: 0,
    southBinCount: layout.bins?.south?.count ?? 0, northBinCount: layout.bins?.north?.count ?? 0,
    excludedRows: layout.excludedRows || [], surfaceTexture: false
  };

  if (layout.supported && enabled) {
    try {
      buildBathurst(THREE, layout, group, colliders, stats);
    } catch (err) {
      console.error('[waterfrontBathurst] build failed:', err && err.message ? err.message : err);
      group.clear();
      colliders.length = 0;
      stats.meshes = 0;
      stats.buildError = err && err.message ? err.message : String(err);
    }
  }

  stats.colliders = colliders.length;
  group.userData.waterfrontBathurst = stats;
  if (scene && scene.add) scene.add(group);

  const rows = new Set(stats.excludedRows);
  C.waterfrontBathurstExcludedRows = rows;
  C.waterfrontBathurstExcludesBuilding = (bi) => enabled && rows.has(bi);

  const result = { group, colliders, stats, layout, landmark: CANADA_MALTING };
  window.CITY.waterfrontBathurst = result;
  if (!layout.supported) {
    console.info('[waterfrontBathurst] skipped: the active city frame does not cover the mapped Canada Malting silos');
  } else if (!enabled) {
    console.info('[waterfrontBathurst] disabled (window.CITY.waterfrontBathurstEnabled=false or ?bathurst=0)');
  } else {
    console.info(`[waterfrontBathurst] Canada Malting Silos: ${stats.meshes} meshes, ${stats.colliders} colliders, ` +
      `south ${stats.southBinCount} exposed bins, north ${stats.northBinCount} concealed bins; excluding rows [${[...rows].join(', ')}]`);
  }
  return result;
}

Object.assign(window.CITY, {
  WATERFRONT_BATHURST: CANADA_MALTING,
  CANADA_MALTING_SILOS: CANADA_MALTING,
  waterfrontBathurstLayout,
  waterfrontBathurstSupported: (G = C?.GEO) => bathurstSupported(G),
  waterfrontBathurstResolveRows: (G = C?.GEO) => bathurstResolveRows(G),
  waterfrontBathurstExcludedRowsFor: (G = C?.GEO) => [...bathurstExcludedRows(G)],
  setWaterfrontBathurstEnabled: (v) => { C.waterfrontBathurstEnabled = v !== false; return C.waterfrontBathurstEnabled; },
  // Called from the captain's buildings.js loop BEFORE the builder runs (like the sibling landmark hook); it answers
  // from the active GEO on its own and honours the runtime gate.
  waterfrontBathurstExcludesBuilding: (bi) => {
    if (!bathurstEnabled()) return false;
    if (C.waterfrontBathurstExcludedRows) return C.waterfrontBathurstExcludedRows.has(bi);
    if (!bathurstSupported()) return false;
    C.waterfrontBathurstExcludedRows = bathurstExcludedRows();
    return C.waterfrontBathurstExcludedRows.has(bi);
  },
  createWaterfrontBathurst
});
})();
