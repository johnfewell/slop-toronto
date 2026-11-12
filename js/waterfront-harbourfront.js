(function () {
// js/waterfront-harbourfront.js
// Harbourfront Centre, 235 Queens Quay West: Toronto's 10-acre waterfront community campus for arts, culture, learning
// and recreation (founded 1972 as a federal Crown corporation; a registered charitable not-for-profit since 1991;
// about 6.3 million annual visitors). The campus runs between the Queens Quay frontage and the inner harbour, split by
// the marina slips into York Quay and John Quay.
//
// This pass adds only source-backed public-realm structure, and deliberately does not invent furniture or piers:
//   - the campus footprint and the three named public squares (Canada Square, Ontario Square, Ann Tindal Park), read
//     from the loaded landmark ring and the mapped park polygons, exposed as identity data and membership predicates.
//     The squares are already drawn as park lawn by the city's own park layer, so this module does not re-draw them and
//     does not lay any grid of benches, trees or lights over them (a mapped polygon alone does not justify a planting
//     layout; a primary designer plan would be needed for that).
//   - The Power Plant's chimney: The Power Plant (231 Queens Quay West) is the 1926 powerhouse for the Toronto Terminal
//     Warehouse, opened as a gallery in 1987 and "easily recognized by its smokestack". The stack is a mapped OSM
//     man_made=chimney node (historic=yes) at 43.6383998, -79.3818476, adjacent to the mapped Power Plant block; this
//     module places the brick stack at that mapped point (not at a building centroid) rising from the ground, with an
//     estimated height. The mapped building massing carries no chimney, so this is the only stack geometry.
//   - the John Quay boardwalk: a documented linear boardwalk on the Inner Harbour just outside Marina Four (Harbourfront
//     Centre Marine). It follows the campus ring's mapped waterline on the west harbour front. No marina slips or boats
//     are drawn: no Marina Four floating pier is mapped in OSM (the two mapped "West Pier"/"East Pier" lines are
//     outer-harbour docks outside the campus ring), so none is invented.
//
// It does not draw the campus boundary as a fence: the ring is a placement outline, not a physical enclosure.
//
// Sources (retrieved 2026-11-09):
// - Harbourfront Centre, About Us (10-acre campus; 235 Queens Quay W; 6.3M annual visitors; 1972 / 1991):
//   https://harbourfrontcentre.com/about-us/
// - Harbourfront Centre, Marine/Marinas (John Quay is a linear boardwalk on the Inner Harbour just outside Marina Four;
//   Marina Four at historic Pier 4 under the City of Amsterdam pedestrian bridge beside the Concert Stage; York Quay /
//   John Quay; berth #248): https://harbourfrontcentre.com/program/harbourfront-centre-marine/
// - The Power Plant (1926 powerhouse for the Toronto Terminal Warehouse; "easily recognized by its smokestack"; opened
//   1987; 231 Queens Quay W): https://en.wikipedia.org/wiki/The_Power_Plant, https://www.thepowerplant.org/
// - Waterfront Toronto, central waterfront (a Harbourfront Centre parking lot became new public squares and a new
//   promenade stretch): https://www.waterfrontoronto.ca/our-projects/scope-scale/central-waterfront
// - Campus landmark ring and the square park polygons: the loaded City geodata from OpenStreetMap contributors, ODbL.
// - The chimney node: OpenStreetMap node 555405453, man_made=chimney, historic=yes (Natural Resources Canada CanVec),
//   at 43.6383998, -79.3818476 (read from the Ontario extract). The two mapped piers (OSM ways 26594650 "West Pier",
//   26594651 "East Pier") are outer-harbour docks outside the campus and are intentionally not used.
//
// Geometry conventions (as the rest of the city): 1 unit = 1 m, world x is grid east, z is grid south, ground y = 0,
// the lake at SETTING.waterLevel. A mapped building block's part centre uses the same convention as js/buildings.js /
// js/city-grid.js: world = (cx + u*cos + v*sin, cz - u*sin + v*cos) for a part centre (u, v) in the block's angle frame
// (see buildingPartWorldCentre). Call createWaterfrontHarbourfront(THREE, scene); it returns { group, colliders, stats }
// and only builds when the active frame covers the mapped campus (see waterfrontHarbourfrontSupported). The group is one
// culling root, repeated parts are instanced, and meshes carry scene-culling.js's cullDistance/cullCell.

const C = window.CITY;
const SETTING = C?.CITY_BOUNDS || {};
const GROUND = 0; // the city's ground plane (y = 0)
const WATER = SETTING.waterLevel ?? -0.7;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const hash = (x, z) => {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

// --------------------------------------------------------------------------------------------------------------------
// The named public squares, each anchored to its real mapped park polygon (found in GEO.areas by name at build time).
// These are identity data only: their outlines are the placement source for any future, source-backed layout, and the
// membership predicate identifies them. The city's park layer already draws the lawn; this module adds no furniture.
// --------------------------------------------------------------------------------------------------------------------
const HARBOURFRONT_SQUARES = [
  { id: 'canadaSquare', name: 'Canada Square', character: 'civic', note: 'The long main public square along the campus spine, Queens Quay to the harbour edge.' },
  { id: 'ontarioSquare', name: 'Ontario Square', character: 'courtyard', note: 'The smaller stone courtyard square beside the main building.' },
  { id: 'annTindalPark', name: 'Ann Tindal Park', character: 'lawn', note: 'The west lawn square at the York Quay corner, near Lower Simcoe.' }
];

// The Power Plant chimney, from the mapped OSM man_made=chimney node (see the sources above). It is positioned at the
// mapped point, not at a building centroid. Its height is not published; ESTIMATES.chimneyHeight is an explicit
// estimate and the report records it as unverified.
const POWER_PLANT_CHIMNEY = {
  lat: 43.6383998,
  lon: -79.3818476,
  osmId: '555405453',
  tags: 'man_made=chimney, historic=yes',
  // fallback world position (the same node, converted) if worldFromLatLon is unavailable
  fallback: { x: -315.3, z: 706.0 }
};

// Estimated dimensions where no official measured figure is published (metres). The report records these.
const ESTIMATES = {
  boardwalkWidth: 4.5, // the John Quay / Martin Goodman boardwalk deck
  chimneyHeight: 30.0, // The Power Plant's brick stack, above the ground; unmeasured, estimated from photographs
  chimneyRadius: 1.5,
  chimneyTaper: 0.74 // top radius / base radius
};

// --------------------------------------------------------------------------------------------------------------------
// The Power Plant complex: the eight committed "The Power Plant" rows (detail 33256-33263, eglinton 131123-131130).
// They are keyed by stable identity (name + world centre + mapped height), never by row index, because the two shipped
// frames have different building tables. Each row's overlapping mapped component is given a source-classified role (see
// ROLE below) rather than blanket brick: the south gallery is the photographed red-brown-brick low volume with the
// industrial windows, glazed entry and signs; the north theatre (the tallest rows) is the photographed tall grey/dark
// metal volume; the connectors and low annexes are brick. Facade parts that overlap a taller stacked row are never
// given guessed low decorative details — those are drawn only where they are actually exposed.
//
// Source photo (captain's inspection, 2026-11-10): south/waterfront red-brown brick low gallery; tall industrial
// green/dark multipane windows; centre glazed entry with a pyramidal metal roof; horizontal grey metal rooftop
// clerestory; small brick shaft with a blue-grey hip roof; tall brick stack; red rectangular "THE POWER PLANT" signs on
// the south and west facades in white uppercase. The harbourfront-centre.jpg aerial (captain-viewed) shows the NORTH
// theatre as a tall grey metal volume over a sloped glazed atrium. Dated exhibition banners are deliberately not copied.
// --------------------------------------------------------------------------------------------------------------------
const PP_ROLE = { BRICK: 'brick', THEATRE: 'theatre' };
const POWER_PLANT = {
  id: 'powerPlant',
  name: 'The Power Plant',
  address: '231 Queens Quay W',
  // every mapped row with its source-classified role
  rows: [
    { cx: -318.0, cz: 707.4, h: 5.4, role: PP_ROLE.BRICK },  // low south/east brick annex beside the gallery
    { cx: -317.2, cz: 696.0, h: 6.2, role: PP_ROLE.BRICK },  // low brick service wing
    { cx: -340.2, cz: 696.1, h: 6.3, role: PP_ROLE.BRICK },  // low brick west annex
    { cx: -331.6, cz: 722.5, h: 8.7, role: PP_ROLE.BRICK },  // south gallery (source-known larger volume)
    { cx: -330.2, cz: 702.3, h: 9.2, role: PP_ROLE.BRICK },  // brick gallery-to-theatre connector
    { cx: -327.6, cz: 677.2, h: 10.9, role: PP_ROLE.THEATRE }, // north theatre lower wing (grey metal volume)
    { cx: -330.0, cz: 694.2, h: 11.7, role: PP_ROLE.THEATRE }, // north theatre body
    { cx: -327.4, cz: 677.3, h: 16.5, role: PP_ROLE.THEATRE }  // north theatre tallest volume
  ],
  southGallery: { cx: -331.6, cz: 722.5, h: 8.7 },
  theatreTallest: { cx: -327.4, cz: 677.3, h: 16.5 }
};

// Photo-informed estimates. None is a published measurement; the report labels every one.
const POWER_PLANT_ESTIMATES = {
  clerestoryDepth: 2.0,   // photo-estimated shallow rooftop box depth, metres
  galleryWallTop: 6.9,     // the south gallery's brick wall top (the mapped 8.7 m includes the rooftop clerestory)
  wallTop: 0.9,            // the other rows' solid wall top as a fraction of their mapped height
  minWallTopAbove: 2.0,
  parapet: 0.22,           // parapet band height, metres
  windowWidth: 3.2,
  windowHeight: 3.4,
  windowSill: 1.1,
  windowMargin: 2.2,
  entryWidth: 6.0,
  entryHeight: 4.4,
  entryDepth: 1.2,
  entryRoof: 1.4,
  atriumDepth: 2.4,        // north theatre sloped glazed atrium depth below the metal body
  atriumHeight: 3.2,
  signWidth: 9.0,
  signHeight: 1.3,
  signY: 6.0
};

// --------------------------------------------------------------------------------------------------------------------
// The campus frame, from the loaded landmark: centroid, long-axis angle and the u/v extent of the ring.
// --------------------------------------------------------------------------------------------------------------------
function campusFrame() {
  const m = C?.GEO?.landmarks?.harbourfront;
  if (!m || !Array.isArray(m.ring) || m.ring.length < 6) return null;
  const ring = [];
  for (let i = 0; i < m.ring.length; i += 2) ring.push([m.ring[i], m.ring[i + 1]]);
  let cx = 0, cz = 0;
  for (const p of ring) { cx += p[0]; cz += p[1]; }
  cx /= ring.length; cz /= ring.length;
  const ang = m.ang || 0;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  const local = ring.map(([x, z]) => {
    const dx = x - cx, dz = z - cz;
    const u = dx * ca + dz * sa;
    const v = -dx * sa + dz * ca;
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
    return [u, v];
  });
  return { ring, local, cx, cz, ang, ca, sa, u0, u1, v0, v1, area: m.area || 0 };
}

function localToWorld(frame, u, v) {
  return [frame.cx + u * frame.ca - v * frame.sa, frame.cz + u * frame.sa + v * frame.ca];
}
function worldToLocal(frame, x, z) {
  const dx = x - frame.cx, dz = z - frame.cz;
  return [dx * frame.ca + dz * frame.sa, -dx * frame.sa + dz * frame.ca];
}

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Shoelace area of a flat [x0,z0,x1,z1,...] ring.
function ringArea(flat) {
  const n = flat.length / 2;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += flat[2 * i] * flat[2 * j + 1] - flat[2 * j] * flat[2 * i + 1];
  }
  return Math.abs(a) / 2;
}

// A mapped building block's part centre in world space. Uses the same frame convention as js/buildings.js (pushHipRoof
// and friends) and js/city-grid.js (clearOfHouses): world = (cx + u*cos + v*sin, cz - u*sin + v*cos) for a local part
// centre (u, v). `block` is a GEO.buildings row [cx, cz, ang, parts, h, ...]. The union centre of all parts is returned.
function buildingPartWorldCentre(block) {
  const cx = block[0], cz = block[1], ang = block[2] || 0, parts = block[3] || [];
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const [u0, u1, v0, v1] of parts) {
    uMin = Math.min(uMin, u0); uMax = Math.max(uMax, u1);
    vMin = Math.min(vMin, v0); vMax = Math.max(vMax, v1);
  }
  const u = (uMin + uMax) / 2, v = (vMin + vMax) / 2;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  return { x: cx + u * cs + v * sn, z: cz - u * sn + v * cs, ang, h: block[4] || 0 };
}

// A mapped part [u0,u1,v0,v1] as a world-space box. The city's convention is a three.js Y rotation by `ang`
// (world = (cx + u*cos + v*sin, cz - u*sin + v*cos)), so a BoxGeometry(du, h, dv) rotated by ry=ang and translated to
// the part centre lands exactly on the mapped footprint.
function partWorldBox(row, part) {
  const [cx, cz, ang] = row;
  const [u0, u1, v0, v1] = part;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const u = (u0 + u1) / 2, v = (v0 + v1) / 2;
  return {
    x: cx + u * cs + v * sn,
    z: cz - u * sn + v * cs,
    du: u1 - u0,
    dv: v1 - v0,
    ang, cs, sn, u0, u1, v0, v1
  };
}

// Resolve the eight committed "The Power Plant" rows for the ACTIVE frame by stable identity. Returns null unless every
// key resolves, so the module never draws a partial complex or suppresses an unrelated building.
function powerPlantRows(G = C?.GEO) {
  if (!G || !Array.isArray(G.buildings)) return null;
  const out = [];
  for (const key of POWER_PLANT.rows) {
    let index = -1;
    for (let i = 0; i < G.buildings.length; i++) {
      const b = G.buildings[i];
      if (b[9] !== POWER_PLANT.name) continue;
      if (Math.abs(b[0] - key.cx) > 0.5 || Math.abs(b[1] - key.cz) > 0.5 || Math.abs(b[4] - key.h) > 0.05) continue;
      index = i;
      break;
    }
    if (index < 0) return null;
    out.push({ index, row: G.buildings[index], key, role: key.role });
  }
  return out;
}

// The complex layout: every mapped part as a world box, plus the south gallery's derived facade features. All positions
// are derived from the mapped row; the only projection beyond the footprint is the small entry (recorded as an
// estimate), and no new building mass is invented.
function powerPlantLayout() {
  const rows = powerPlantRows();
  if (!rows) return null;
  const parts = [];
  for (const r of rows) for (const p of r.row[3] || []) parts.push({ row: r, key: r.key, role: r.role, part: p, box: partWorldBox(r.row, p) });
  const gallery = rows.find((r) => Math.abs(r.key.cx - POWER_PLANT.southGallery.cx) < 0.5 &&
    Math.abs(r.key.cz - POWER_PLANT.southGallery.cz) < 0.5 && Math.abs(r.key.h - POWER_PLANT.southGallery.h) < 0.05);
  let south = null;
  if (gallery) {
    const g = gallery.row;
    const [cx, cz, ang, gparts] = g;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [a0, a1, b0, b1] of gparts) {
      u0 = Math.min(u0, a0); u1 = Math.max(u1, a1);
      v0 = Math.min(v0, b0); v1 = Math.max(v1, b1);
    }
    const local = (u, v) => ({ x: cx + u * cs + v * sn, z: cz - u * sn + v * cs });
    south = {
      row: gallery, cx, cz, ang, cs, sn, u0, u1, v0, v1,
      entry: local(0, v1 + POWER_PLANT_ESTIMATES.entryDepth - 0.1),
      entryRoof: local(0, v1 + POWER_PLANT_ESTIMATES.entryDepth / 2 - 0.1),
      signSouth: local(0, v1 + 0.08),
      signWest: local(u0 - 0.08, 0)
    };
    // Candidate rooftop detail volumes are admitted ONLY where the exposure test says they rise above every overlapping
    // row; otherwise they are recorded as buried and not drawn (never a decorative part hidden inside a volume).
    const gTop = gallery.row[4];
    // the gallery's south band is the exposed part of its roof (the north band is under the taller connector row)
    south.clerestory = admitDetail(parts, gallery, () => exposedTop(parts, gallery, local(0, v1 - 4.0), gTop));
    south.clerestoryAt = local(0, v1 - 4.0);
    // The photo places the hip-roof shaft near the chimney, but the mapped overlapping
    // volumes do not establish its roof height. Do not relocate it to a visible corner.
    south.shaft = { exposed: false, reason: 'near-chimney roof placement unresolved' };
    south.shaftAt = local(u1 - 4.0, v1 - 2.0);
  }
  const theatre = theatreFromRows(rows, parts);
  return { rows, parts, south, theatre, estimates: POWER_PLANT_ESTIMATES };
}

// Which of two mapped rows is taller.
function tallerRowRow(a, b) { return (a.row[4] || 0) >= (b.row[4] || 0) ? a : b; }

// A point is inside a drawn mapped part (world XZ). Used so guessed low detail is never placed inside a taller
// overlapping row's volume.
function partContains(part, x, z, margin = 0) {
  const b = part.box;
  const dx = x - b.x, dz = z - b.z;
  const u = dx * b.cs - dz * b.sn;
  const v = dx * b.sn + dz * b.cs;
  return u >= b.u0 - margin && u <= b.u1 + margin && v >= b.v0 - margin && v <= b.v1 + margin;
}

// Exposure test (captain-required): the height a candidate detail reaches above the tallest OTHER mapped part covering
// its footprint. A detail is admitted only if its own top clears that ceiling by a margin; <= 0 means it would be buried.
function exposedTop(parts, ownRow, point, candidateTop) {
  let ceiling = 0;
  for (const p of parts) {
    if (p.row === ownRow) continue;
    if (partContains(p, point.x, point.z, 0.2)) ceiling = Math.max(ceiling, p.row.row[4] || 0);
  }
  return { clearance: candidateTop - ceiling, ceiling };
}

function admitDetail(parts, ownRow, measure) {
  const m = measure();
  return m.clearance > 0.4 ? { exposed: true, ceiling: m.ceiling, top: (ownRow.row[4] || 0) + m.clearance } : { exposed: false, ceiling: m.ceiling };
}

// The north theatre (source: tall grey/dark metal volume over a sloped glazed atrium). The taller mapped rows; the
// atrium band is admitted only where it actually stands above its neighbours.
function theatreFromRows(rows, parts) {
  const tall = rows.filter((r) => r.role === PP_ROLE.THEATRE);
  if (!tall.length) return null;
  let tallest = tall[0];
  for (const r of tall) if (tallerRowRow(r, tallest) === r) tallest = r;
  const g = tallest.row;
  const [cx, cz, ang, gparts] = g;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [a0, a1, b0, b1] of gparts) { u0 = Math.min(u0, a0); u1 = Math.max(u1, a1); v0 = Math.min(v0, b0); v1 = Math.max(v1, b1); }
  const local = (u, v) => ({ x: cx + u * cs + v * sn, z: cz - u * sn + v * cs });
  const face = local(0, v1 - 0.05);
  const atrium = admitDetail(parts, tallest, () => exposedTop(parts, tallest, face, tallest.row[4]));
  return { rows: tall, tallest, face, u0, u1, v0, v1, atrium };
}

// Find the mapped park polygons on the campus for each named square, by name (the geodata carries the names). Returns
// the world ring for each; the ring is the identity/placement source. A square is only kept if it lies on the campus.
function squareRings() {
  const frame = campusFrame();
  if (!frame) return [];
  const out = [];
  for (const sq of HARBOURFRONT_SQUARES) {
    const a = (C?.GEO?.areas || []).find((ar) => ar[0] === 'park' && ar[1] === sq.name && Array.isArray(ar[2]) && ar[2].length >= 6);
    if (!a) continue;
    const flat = a[2];
    let cx = 0, cz = 0; const n = flat.length / 2;
    for (let i = 0; i < flat.length; i += 2) { cx += flat[i]; cz += flat[i + 1]; }
    cx /= n; cz /= n;
    if (!pointInRing(frame.ring, cx, cz)) continue; // only campus squares
    const ring = [];
    for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
    out.push({ id: sq.id, name: sq.name, character: sq.character, note: sq.note, ring, area: ringArea(flat), cx, cz });
  }
  return out;
}

// Is a world point on one of the campus public squares? Informational: use it to identify a square, not to strip the
// city's generic trees or lawn off it (no source-backed replacement layout is supplied here).
function campusSquareAt(x, z) {
  for (const sq of squareRings()) if (pointInRing(sq.ring, x, z)) return sq;
  return null;
}

// Is a world point on the campus footprint (inside the landmark ring)? Informational: the outline scopes the campus for
// placement and identity; it is not a fence, and it is not a licence to remove the city's trees across the campus.
function campusFootprintAt(x, z, margin = 0) {
  const frame = campusFrame();
  if (!frame) return false;
  if (pointInRing(frame.ring, x, z)) return true;
  if (margin <= 0) return false;
  for (let i = 0, j = frame.ring.length - 1; i < frame.ring.length; j = i++) {
    const [ax, az] = frame.ring[j], [bx, bz] = frame.ring[i];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / len2);
    if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) <= margin) return true;
  }
  return false;
}

// --------------------------------------------------------------------------------------------------------------------
// The Power Plant chimney at its mapped OSM node. Base at the ground, rising to an estimated height; the nearest mapped
// Power Plant block is recorded for provenance (the stack stands beside its actual roof, not at a building centroid).
// --------------------------------------------------------------------------------------------------------------------
function powerPlantChimney() {
  const frame = campusFrame();
  if (!frame) return null;
  let pos;
  if (typeof C?.worldFromLatLon === 'function') {
    pos = C.worldFromLatLon(POWER_PLANT_CHIMNEY.lat, POWER_PLANT_CHIMNEY.lon);
  } else {
    pos = { x: POWER_PLANT_CHIMNEY.fallback.x, z: POWER_PLANT_CHIMNEY.fallback.z };
  }
  if (!pointInRing(frame.ring, pos.x, pos.z)) return null;
  // the nearest mapped Power Plant block, by its part centre (provenance: the mapped stack stands beside this roof)
  let nearest = null, best = Infinity;
  for (const b of C?.GEO?.buildings || []) {
    if (b[9] !== 'The Power Plant') continue;
    const c = buildingPartWorldCentre(b);
    const d = Math.hypot(c.x - pos.x, c.z - pos.z);
    if (d < best) { best = d; nearest = { x: c.x, z: c.z, h: c.h, dist: d }; }
  }
  return {
    x: pos.x, z: pos.z, baseY: GROUND, height: ESTIMATES.chimneyHeight,
    topY: GROUND + ESTIMATES.chimneyHeight,
    adjacentBlock: nearest, source: POWER_PLANT_CHIMNEY
  };
}

// --------------------------------------------------------------------------------------------------------------------
// The John Quay boardwalk: follows the campus ring's mapped waterline on the west harbour front. No marina slips or boats
// are drawn (no Marina Four floating pier is mapped); only the documented linear boardwalk.
// --------------------------------------------------------------------------------------------------------------------
function marinaEdge() {
  const frame = campusFrame();
  if (!frame) return null;
  const wetAt = (x, z) => (typeof C?.waterAt === 'function' ? !!C.waterAt(x, z) : false);
  const ring = frame.ring;
  const zSouth = Math.max(...ring.map((p) => p[1]));
  const band = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.round(len / 2));
    for (let k = 0; k < steps; k++) {
      const x = a[0] + ((b[0] - a[0]) * (k + 0.5)) / steps;
      const z = a[1] + ((b[1] - a[1]) * (k + 0.5)) / steps;
      if (x < -713 || x > -380) continue; // the west campus harbour front (John Quay / Pier 4)
      if (z < zSouth - 95) continue; // only the south-facing harbour edge
      if (wetAt(x, z)) continue; // the deck is on land
      if (!(wetAt(x, z + 6) || wetAt(x, z + 10))) continue; // it must front water to the south
      band.push({ x, z });
    }
  }
  if (band.length < 6) return null;
  const johnQuay = typeof C?.worldFromLatLon === 'function'
    ? C.worldFromLatLon(43 + 38.251 / 60, -(79 + 23.115 / 60)) : null;
  return { band, wetAt, johnQuay };
}

// --------------------------------------------------------------------------------------------------------------------
// Build
// --------------------------------------------------------------------------------------------------------------------
function standardMaterial(THREE, params) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat(params);
}

function makeInstanced(THREE, geometry, material, items, name, opts = {}) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  mesh.name = name;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    e.set(it.rx || 0, it.ry || 0, it.rz || 0);
    q.setFromEuler(e);
    p.set(it.x, it.y, it.z);
    s.set(it.sx, it.sy, it.sz);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (it.color !== undefined) mesh.setColorAt(i, col.setHex(it.color));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = opts.castShadow !== false;
  mesh.receiveShadow = opts.receiveShadow !== false;
  mesh.userData.cullDistance = opts.cullDistance ?? 700;
  mesh.userData.cullCell = opts.cullCell ?? 120;
  if (opts.role) mesh.userData.role = opts.role;
  if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
  return mesh;
}

// The John Quay boardwalk deck: short slabs chained along the mapped waterline band (nearest-neighbour ordering keeps
// the polyline continuous through the ring's corner). No slab is laid over water.
function addBoardwalk(lists, stats) {
  const edge = marinaEdge();
  if (!edge) return;
  const band = edge.band.slice();
  const ordered = [];
  let cur = band.reduce((m, p) => (m === null || p.x < m.x ? p : m), null);
  while (band.length) {
    const i = band.indexOf(cur);
    if (i < 0) { cur = band[0]; continue; }
    ordered.push(band[i]);
    band.splice(i, 1);
    let best = -1, bd = Infinity;
    for (let k = 0; k < band.length; k++) {
      const d = Math.hypot(band[k].x - cur.x, band[k].z - cur.z);
      if (d < bd) { bd = d; best = k; }
    }
    if (best < 0) break;
    cur = band[best];
  }
  let seg = 0;
  for (let i = 1; i < ordered.length; i++) {
    const { x: x0, z: z0 } = ordered[i - 1], { x: x1, z: z1 } = ordered[i];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len > 12) continue; // a gap between disjoint perimeter runs: do not bridge it
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    if (edge.wetAt(mx, mz)) continue;
    lists.boardwalk.push({
      x: mx, y: GROUND + 0.06, z: mz,
      sx: ESTIMATES.boardwalkWidth, sy: 0.12, sz: len + 0.06, ry: Math.atan2(dx, dz), color: 0x8a6f4e
    });
    seg++;
  }
  stats.boardwalkSlabs = seg;
  stats.johnQuay = edge.johnQuay ? { x: edge.johnQuay.x, z: edge.johnQuay.z } : null;
}

// The Power Plant chimney at its mapped node: a tapered brick shaft with a flared, horizontally ringed brick crown,
// rising from the ground beside the mapped Power Plant roof. The source photos show no steel balcony; the crown is
// brick with a dark rim and small fittings above it. Solid to the player (one collider at the base radius).
function addChimney(THREE, lists, stats) {
  const ch = powerPlantChimney();
  if (!ch) return null;
  const H = ch.height;
  const R0 = ESTIMATES.chimneyRadius;
  const R1 = R0 * ESTIMATES.chimneyTaper;
  const shaftTop = H - 1.0;
  lists.chimneyShaft.push({ x: ch.x, y: GROUND + shaftTop / 2, z: ch.z, sx: R0, sy: shaftTop, sz: R0, color: 0xffffff });
  lists.chimneyCrown.push({ x: ch.x, y: GROUND + shaftTop + 0.5, z: ch.z, sx: R1, sy: 1.0, sz: R1, color: 0xffffff });
  for (let i = 0; i < 3; i++) {
    lists.chimneyRing.push({ x: ch.x, y: GROUND + H - 0.18 - i * 0.22, z: ch.z, sx: R1 * 1.22, sy: 0.08, sz: R1 * 1.22, color: 0xffffff });
  }
  lists.chimneyRim.push({ x: ch.x, y: GROUND + H - 0.03, z: ch.z, sx: R1 * 1.2, sy: 0.06, sz: R1 * 1.2, color: 0xffffff });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    lists.chimneyRod.push({ x: ch.x + Math.cos(a) * R1 * 0.55, y: GROUND + H + 0.3, z: ch.z + Math.sin(a) * R1 * 0.55, sx: 0.04, sy: 0.6, sz: 0.04, color: 0xffffff });
  }
  stats.chimney = { x: ch.x, z: ch.z, baseY: ch.baseY, height: ch.height, topY: ch.topY, adjacentBlock: ch.adjacentBlock, crown: 'flared brick rings' };
  return stats.chimney;
}

// A muted medium red-brown running-bond brick skin for the Power Plant (the source is NOT dark saturated burgundy).
// The course/head-joint pattern is derived from WORLD metres (positionWorld + the face normal choosing the running
// axis), not the unit-box UV: an InstancedMesh scales one unit BoxGeometry to tens of metres, so a UV-based period would
// stretch each course enormously. fwidth keeps the same metre-scale anti-aliasing at any instance scale. The material
// colour carries the brick; the per-instance tint stays white (and makeInstanced's default colour is white) so it is not
// multiplied twice. Without the node API it falls back to a flat brick colour, so the Node tests and WebGL2 still build.
function brickMaterial(THREE, { base = 0x9a6350, brickH = 0.075, brickL = 0.24, jointW = 0.008, jointDark = 0.16, roughness = 0.92 } = {}) {
  const color = new THREE.Color(base);
  const params = { color, roughness, metalness: 0.0 };
  const Mat = THREE.MeshStandardNodeMaterial;
  const T = C?.TSL;
  if (!Mat) return new (THREE.MeshStandardMaterial || function () {})(params);
  const mat = new Mat(params);
  if (!T || !T.Fn || !T.positionWorld || !T.normalWorld || !T.fwidth || !T.select) return mat;
  try {
    const { Fn, vec3, float, positionWorld, normalWorld, fract, floor, max, min, smoothstep, fwidth, abs, select } = T;
    const gridLine = Fn(([coord, period, hw]) => {
      const g = float(coord).div(period).toVar();
      const d = float(0.5).sub(abs(fract(g).sub(0.5))).toVar();
      const aa = fwidth(g).max(0.0001).toVar();
      const effHw = max(float(hw).div(period), aa.mul(0.5)).toVar();
      const cov = smoothstep(effHw.add(aa), effHw.sub(aa), d);
      return cov.mul(min(float(1.0), float(hw).div(period).div(effHw)));
    });
    mat.colorNode = Fn(() => {
      // the running axis is the horizontal one: world z for an x-facing wall, world x otherwise
      const along = select(abs(normalWorld.x).greaterThan(abs(normalWorld.z)), positionWorld.z, positionWorld.x);
      const rowCoord = positionWorld.y.div(brickH);
      const courseRow = floor(rowCoord);
      const colCoord = along.div(brickL).add(fract(courseRow.mul(0.5)));   // running bond: every course staggered
      const course = gridLine(positionWorld.y, brickH, jointW);
      const head = gridLine(colCoord.mul(brickL), brickL, jointW);
      const mortar = max(course, head);
      const streak = fract(positionWorld.x.add(positionWorld.z).add(positionWorld.y).mul(0.11)).sub(0.6).max(0.0).mul(0.03);
      const shade = float(1.0).sub(mortar.mul(jointDark)).sub(streak);
      return vec3(color.r, color.g, color.b).mul(shade);
    })();
  } catch (e) {
    return mat;
  }
  return mat;
}

// The red "THE POWER PLANT" sign face, drawn once into a bounded canvas (white uppercase on red). No DOM canvas (the
// Node tests) returns null and the caller uses a plain red panel. No source image pixels are used.
let _ppSignTexture = null;
function powerPlantSignTexture(THREE) {
  if (_ppSignTexture) return _ppSignTexture;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  // the canvas aspect matches the sign plane (9.0 x 1.3 m = 6.92:1), so the lettering is not compressed
  const W = 1024, H = 148;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#b3202a';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 78px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  ctx.fillText('THE POWER PLANT', W / 2, H / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  _ppSignTexture = tex;
  return tex;
}

// One tall industrial window: a dark green glass panel plus a dark frame grid (three vertical, two horizontal bars).
function addWindow(lists, x, y, z, w, h, ry) {
  // the glass/frame materials carry their own colour; the instance tint stays white so it is not multiplied twice
  lists.ppWindow.push({ x, y, z, sx: w, sy: h, sz: 0.12, ry, color: 0xffffff });
  const bar = 0.08;
  for (const off of [-w / 4, 0, w / 4]) {
    lists.ppMullion.push({ x: x + Math.cos(ry) * off, y, z: z - Math.sin(ry) * off, sx: bar, sy: h, sz: 0.16, ry, color: 0xffffff });
  }
  for (const off of [-h / 4, h / 4]) {
    lists.ppMullion.push({ x, y: y + off, z, sx: w, sy: bar, sz: 0.16, ry, color: 0xffffff });
  }
}

// The Power Plant complex: a coherent industrial skin over the eight mapped rows, source-classified by role. The south
// gallery (row 33259) gets the source-photographed red-brown brick, tall multipane windows, centre glazed entry with a
// pyramidal metal roof and the two red signs; its guessed rooftop clerestory/shaft are drawn only where the exposure
// test admits them. The north theatre rows (the tallest) are the photographed grey/dark metal volume over a sloped
// glazed atrium (atrium admitted where exposed). The low annexes are brick. Every mapped part keeps its own footprint
// and mapped height; no furniture, piers or unmapped mass is added.
function addPowerPlant(THREE, lists, stats) {
  const layout = powerPlantLayout();
  if (!layout) return null;
  const E = POWER_PLANT_ESTIMATES;
  const gallery = layout.south;
  const WHITE = 0xffffff;

  for (const p of layout.parts) {
    // The gallery's wall top is set by its own (source-photographed) band; the other rows keep the mapped height. The
    // theatre rows are the grey metal volume in the source photo; the low annexes and connector are brick.
    const isTheatre = p.role === PP_ROLE.THEATRE;
    const isGallery = gallery && p.row === gallery.row;
    const top = p.row.row[4] || 2.0;
    const wallTop = isGallery ? E.galleryWallTop : (isTheatre ? Math.max(E.minWallTopAbove, top * E.wallTop) : Math.max(E.minWallTopAbove, top - E.parapet));
    const b = p.box;
    // brick walls use the brick material's own colour (white instance tint, so it is not multiplied twice); theatre
    // walls use the grey-metal material and tint white for the same reason
    const wallList = isTheatre ? lists.ppMetalWall : lists.ppBrick;
    const parList = isTheatre ? lists.ppMetalParapet : lists.ppParapet;
    wallList.push({ x: b.x, y: wallTop / 2, z: b.z, sx: b.du, sy: wallTop, sz: b.dv, ry: b.ang, color: WHITE });
    parList.push({ x: b.x, y: wallTop + E.parapet / 2, z: b.z, sx: b.du + 0.3, sy: E.parapet, sz: b.dv + 0.3, ry: b.ang, color: WHITE });
    lists.ppRoof.push({ x: b.x, y: wallTop + E.parapet + 0.02, z: b.z, sx: Math.max(0.5, b.du - 0.2), sy: 0.08, sz: Math.max(0.5, b.dv - 0.2), ry: b.ang, color: 0xffffff });
    if (isTheatre && top - wallTop > 0.2) {
      // the screened metal volume from the projected wall top to the mapped height (never above it); the metal material
      // carries the grey colour, so its tint stays white
      lists.ppTheatreBand.push({ x: b.x, y: (wallTop + top) / 2, z: b.z, sx: b.du - 0.2, sy: top - wallTop, sz: b.dv - 0.2, ry: b.ang, color: WHITE });
      for (let i = 1; i < 4; i++) {
        lists.ppTheatreBandBar.push({ x: b.x, y: wallTop + (top - wallTop) * i / 4, z: b.z, sx: b.du - 0.1, sy: 0.05, sz: b.dv - 0.1, ry: b.ang, color: 0xffffff });
      }
    }
  }

  let windows = 0;
  if (gallery) {
    const g = gallery;
    const ppTop = g.row.row[4];
    const winY = E.windowSill + E.windowHeight / 2;
    const southBays = 5, westBays = 4;
    const spanU = (g.u1 - g.u0) - 2 * E.windowMargin;
    for (let i = 0; i < southBays; i++) {
      const u = g.u0 + E.windowMargin + spanU * (i + 0.5) / southBays;
      const x = g.cx + u * g.cs + (g.v1 + 0.06) * g.sn;
      const z = g.cz - u * g.sn + (g.v1 + 0.06) * g.cs;
      addWindow(lists, x, winY, z, E.windowWidth, E.windowHeight, g.ang);
      windows++;
    }
    const spanV = (g.v1 - g.v0) - 2 * E.windowMargin;
    for (let i = 0; i < westBays; i++) {
      const v = g.v0 + E.windowMargin + spanV * (i + 0.5) / westBays;
      const x = g.cx + (g.u0 - 0.06) * g.cs + v * g.sn;
      const z = g.cz - (g.u0 - 0.06) * g.sn + v * g.cs;
      addWindow(lists, x, winY, z, E.windowWidth, E.windowHeight, g.ang + Math.PI / 2);
      windows++;
    }

    // Centre glazed entry with a pyramidal metal roof.
    const e = g.entry;
    lists.ppEntryGlass.push({ x: e.x, y: E.entryHeight / 2, z: e.z, sx: E.entryWidth - 0.5, sy: E.entryHeight - 0.4, sz: 0.12, ry: g.ang, color: 0xffffff });
    const fw = 0.18;
    for (const off of [-E.entryWidth / 2, E.entryWidth / 2]) {
      lists.ppEntryFrame.push({ x: e.x + Math.cos(g.ang) * off, y: E.entryHeight / 2, z: e.z - Math.sin(g.ang) * off, sx: fw, sy: E.entryHeight, sz: 0.2, ry: g.ang, color: 0xffffff });
    }
    lists.ppEntryFrame.push({ x: e.x, y: E.entryHeight - fw / 2, z: e.z, sx: E.entryWidth, sy: fw, sz: 0.2, ry: g.ang, color: 0xffffff });
    lists.ppEntryFrame.push({ x: e.x, y: fw / 2, z: e.z, sx: E.entryWidth, sy: fw, sz: 0.2, ry: g.ang, color: 0xffffff });
    lists.ppEntryFrame.push({ x: e.x, y: E.entryHeight / 2, z: e.z, sx: fw, sy: E.entryHeight, sz: 0.2, ry: g.ang, color: 0xffffff });
    const er = g.entryRoof;
    lists.ppEntryRoof.push({ x: er.x, y: E.entryHeight + E.entryRoof / 2, z: er.z, sx: E.entryWidth / Math.SQRT2, sy: E.entryRoof, sz: E.entryWidth / Math.SQRT2, ry: g.ang + Math.PI / 4, color: 0xffffff });

    // Guessed rooftop detail is drawn only where the exposure test says it rises above its neighbours.
    if (g.clerestory.exposed) {
      const c = g.clerestoryAt;
      const h = ppTop - E.galleryWallTop;
      lists.ppClerestory.push({ x: c.x, y: E.galleryWallTop + h / 2, z: c.z, sx: Math.min(14.0, spanU), sy: h, sz: E.clerestoryDepth, ry: g.ang, color: WHITE });
      for (let i = 1; i < 4; i++) {
        lists.ppClerestoryBar.push({ x: c.x, y: E.galleryWallTop + h * i / 4, z: c.z, sx: Math.min(14.0, spanU) + 0.1, sy: 0.05, sz: E.clerestoryDepth + 0.1, ry: g.ang, color: WHITE });
      }
    }
    if (g.shaft.exposed) {
      const sh = g.shaftAt;
      const shH = ppTop - E.galleryWallTop - 0.5;
      lists.ppShaft.push({ x: sh.x, y: E.galleryWallTop + shH / 2, z: sh.z, sx: 3.0, sy: shH, sz: 3.0, ry: g.ang, color: WHITE });
      lists.ppHip.push({ x: sh.x, y: ppTop - 0.25, z: sh.z, sx: 3.0 / Math.SQRT2, sy: 0.5, sz: 3.0 / Math.SQRT2, ry: g.ang + Math.PI / 4, color: WHITE });
    }

    // Red rectangular signs on the south and west facades. The plane keeps the canvas aspect (broad caps, ~7:1).
    lists.ppSignSouth.push({ x: g.signSouth.x, y: E.signY, z: g.signSouth.z, ry: g.ang, w: E.signWidth, h: E.signHeight });
    lists.ppSignWest.push({ x: g.signWest.x, y: E.signY, z: g.signWest.z, ry: g.ang - Math.PI / 2, w: E.signWidth, h: E.signHeight });
  }

  // North theatre: the sloped glazed atrium where it is exposed above its neighbours.
  const th = layout.theatre;
  if (th && th.atrium.exposed) {
    const r = th.tallest.row;
    const lenU = th.u1 - th.u0;
    const atH = Math.min(E.atriumHeight, r[4]);
    lists.ppEntryGlass.push({ x: th.face.x, y: atH / 2, z: th.face.z, sx: lenU - 1.0, sy: atH, sz: E.atriumDepth, ry: r[2], color: 0xffffff });
  }

  stats.powerPlant = {
    rows: layout.rows.map((ri) => ri.index),
    roles: layout.rows.map((ri) => ri.role),
    parts: layout.parts.length,
    southGallery: gallery ? { x: gallery.cx, z: gallery.cz, h: gallery.row.row[4] } : null,
    windows,
    entry: !!gallery,
    clerestory: !!(gallery && gallery.clerestory.exposed),
    shaft: !!(gallery && gallery.shaft.exposed),
    signAspect: +(E.signWidth / E.signHeight).toFixed(2),
    signs: gallery ? 2 : 0,
    theatre: th ? { tallest: th.tallest.index, h: th.tallest.row[4], atrium: th.atrium.exposed, ceiling: th.atrium.ceiling } : null,
    estimates: E
  };
  return stats.powerPlant;
}

function campusLayout() {
  const frame = campusFrame();
  if (!frame) return null;
  const squares = squareRings().map((sq) => ({
    id: sq.id, name: sq.name, character: sq.character, note: sq.note, x: sq.cx, z: sq.cz, area: Math.round(sq.area),
    ring: sq.ring
  }));
  const ch = powerPlantChimney();
  const me = marinaEdge();
  const pp = powerPlantLayout();
  return {
    frame: { x: frame.cx, z: frame.cz, ang: frame.ang, u0: frame.u0, u1: frame.u1, v0: frame.v0, v1: frame.v1, area: frame.area },
    squares,
    powerPlant: ch ? { x: ch.x, z: ch.z, topY: ch.topY, adjacentBlock: ch.adjacentBlock } : null,
    powerPlantComplex: pp ? {
      rows: pp.rows.map((r) => r.index),
      parts: pp.parts.length,
      southGallery: pp.south ? { x: pp.south.cx, z: pp.south.cz, h: pp.south.row.row[4] } : null,
      estimates: pp.estimates
    } : null,
    marina: me ? { boardwalkPoints: me.band.length, johnQuay: me.johnQuay ? { x: me.johnQuay.x, z: me.johnQuay.z } : null } : null,
    estimates: ESTIMATES
  };
}

// The campus is downtown-world geometry: build only when the frame really covers the mapped ring (a guard against
// drawing fixed coordinates in an unrelated frame), and confirm the campus interior reads as dry land, not water.
function waterfrontHarbourfrontSupported() {
  const G = C?.GEO;
  if (!G || !G.frame || !G.frame.detail || !C?.CITY_BOUNDS) return false;
  if (!Array.isArray(G.areas) || !G.areas.length) return false;
  const frame = campusFrame();
  if (!frame) return false;
  const d = G.frame.detail;
  for (const [x, z] of frame.ring) {
    if (!(x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1)) return false;
  }
  let n = 0, dry = 0;
  for (let i = 0; i < 80; i++) {
    const [px, pz] = localToWorld(frame,
      frame.u0 + (frame.u1 - frame.u0) * hash(i, 1.3),
      frame.v0 + (frame.v1 - frame.v0) * hash(i, 2.7));
    if (!pointInRing(frame.ring, px, pz)) continue;
    n++;
    if (typeof C?.waterAt === 'function' && !C.waterAt(px, pz)) dry++;
  }
  return n > 12 && dry / n >= 0.85;
}

// The exclusion hook for the captain's js/buildings.js. It appears ONLY after a successful build, ONLY for rows actually
// drawn, and it is keyed by STABLE IDENTITY (name + world centre + mapped height), resolved against the current GEO at
// call time — never by stored row indices, so the same indices in another frame are not wrongly excluded. Any unsupported
// frame, missing key or rebuild that no longer matches clears the state first, so a stale hook can never exclude a
// building. Data only; this module edits no other file.
function matchesKey(b, keys) {
  if (!Array.isArray(b) || b[9] !== POWER_PLANT.name) return false;
  for (const k of keys) if (Math.abs(b[0] - k.cx) <= 0.5 && Math.abs(b[1] - k.cz) <= 0.5 && Math.abs(b[4] - k.h) <= 0.05) return true;
  return false;
}
function clearPowerPlantExclusion() {
  if (!C) return;
  C.waterfrontHarbourfrontExcludedKeys = null;
  C.waterfrontHarbourfrontExcludedRows = null;
  C.waterfrontHarbourfrontExcludesBuilding = () => false;
}
function installPowerPlantExclusion(layout, ppStats) {
  if (!C) return;
  if (!layout || !ppStats || ppStats.rows.length !== POWER_PLANT.rows.length) { clearPowerPlantExclusion(); return; }
  // only the rows the module actually drew (a part of that row was drawn)
  const drawnKeys = [];
  const seen = new Set();
  for (const p of layout.parts) {
    const k = p.row && p.row.key;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    drawnKeys.push(k);
  }
  if (!drawnKeys.length) { clearPowerPlantExclusion(); return; }
  C.waterfrontHarbourfrontExcludedKeys = drawnKeys;
  C.waterfrontHarbourfrontExcludesBuilding = (bi, G = C?.GEO) => {
    const b = G && G.buildings ? G.buildings[bi] : null;
    return matchesKey(b, drawnKeys);
  };
  // legacy row-index set, informational only, resolved against the frame we just built
  C.waterfrontHarbourfrontExcludedRows = new Set(layout.parts.map((p) => p.row.index));
}

function createWaterfrontHarbourfront(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-harbourfront: THREE is required');
  const frame = campusFrame();
  if (!frame || !waterfrontHarbourfrontSupported()) {
    if (C) C.waterfrontHarbourfrontEnabled = false;
    clearPowerPlantExclusion();
    console.info('[waterfrontHarbourfront] skipped: the active city frame does not cover the mapped Harbourfront campus');
    return null;
  }
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const group = new THREE.Group();
  group.name = 'WaterfrontHarbourfront';

  const lists = {
    boardwalk: [],
    chimneyShaft: [], chimneyCrown: [], chimneyRing: [], chimneyRim: [], chimneyRod: [],
    ppBrick: [], ppParapet: [], ppMetalWall: [], ppMetalParapet: [], ppRoof: [], ppWindow: [], ppMullion: [],
    ppClerestory: [], ppClerestoryBar: [], ppTheatreBand: [], ppTheatreBandBar: [], ppShaft: [], ppHip: [],
    ppEntryGlass: [], ppEntryFrame: [], ppEntryRoof: [], ppSignSouth: [], ppSignWest: []
  };
  const stats = {};
  addBoardwalk(lists, stats);
  addChimney(THREE, lists, stats);
  addPowerPlant(THREE, lists, stats);

  const wood = standardMaterial(THREE, { color: 0xffffff, roughness: 0.85, metalness: 0.02 });
  const brick = brickMaterial(THREE, { base: 0x9a6350 });
  const brickDark = brickMaterial(THREE, { base: 0x7a4e40 });
  const roof = standardMaterial(THREE, { color: 0x4a4d50, roughness: 0.85, metalness: 0.1 });
  const glass = standardMaterial(THREE, { color: 0x2f4a44, roughness: 0.35, metalness: 0.25 });
  const frameMat = standardMaterial(THREE, { color: 0x1f2a28, roughness: 0.6, metalness: 0.3 });
  const metal = standardMaterial(THREE, { color: 0x8a8f92, roughness: 0.5, metalness: 0.5 });
  const hip = standardMaterial(THREE, { color: 0x5a6a72, roughness: 0.5, metalness: 0.4 });
  const entryMetal = standardMaterial(THREE, { color: 0x5a5f63, roughness: 0.5, metalness: 0.5 });
  const chimneyBrick = standardMaterial(THREE, { color: 0x9a5a44, roughness: 0.9, metalness: 0.02 });
  const chimneyDark = standardMaterial(THREE, { color: 0x3a2a24, roughness: 0.7, metalness: 0.3 });

  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
  const cylTaper = new THREE.CylinderGeometry(1, ESTIMATES.chimneyTaper, 1, 12);
  const cylCrown = new THREE.CylinderGeometry(1.18, 1.0, 1, 12);
  const cone4 = new THREE.ConeGeometry(1, 1, 4);
  const meshes = [];
  const add = (mesh, role) => { if (mesh) { mesh.userData.role = role; meshes.push(mesh); group.add(mesh); } };

  add(makeInstanced(THREE, box, wood, lists.boardwalk, 'WaterfrontHarbourfront-Boardwalk', { cullDistance: 800, cullCell: 120 }), 'boardwalk');
  add(makeInstanced(THREE, cylTaper, chimneyBrick, lists.chimneyShaft, 'WaterfrontHarbourfront-Chimney', { cullDistance: 900, cullCell: 120 }), 'power-plant-chimney');
  add(makeInstanced(THREE, cylCrown, chimneyBrick, lists.chimneyCrown, 'WaterfrontHarbourfront-ChimneyCrown', { cullDistance: 900, cullCell: 120 }), 'power-plant-crown');
  add(makeInstanced(THREE, cyl, chimneyBrick, lists.chimneyRing, 'WaterfrontHarbourfront-ChimneyRings', { cullDistance: 900, cullCell: 120 }), 'power-plant-rings');
  add(makeInstanced(THREE, cyl, chimneyDark, lists.chimneyRim, 'WaterfrontHarbourfront-ChimneyRim', { cullDistance: 900, cullCell: 120 }), 'power-plant-rim');
  add(makeInstanced(THREE, cyl, chimneyDark, lists.chimneyRod, 'WaterfrontHarbourfront-ChimneyRods', { cullDistance: 900, cullCell: 120 }), 'power-plant-rods');

  add(makeInstanced(THREE, box, brick, lists.ppBrick, 'WaterfrontHarbourfront-PowerPlantBrick', { cullDistance: 900, cullCell: 120 }), 'power-plant-brick');
  add(makeInstanced(THREE, box, brickDark, lists.ppParapet, 'WaterfrontHarbourfront-PowerPlantParapet', { cullDistance: 900, cullCell: 120 }), 'power-plant-parapet');
  add(makeInstanced(THREE, box, metal, lists.ppMetalWall, 'WaterfrontHarbourfront-PowerPlantMetalWall', { cullDistance: 900, cullCell: 120 }), 'power-plant-metal-wall');
  add(makeInstanced(THREE, box, roof, lists.ppMetalParapet, 'WaterfrontHarbourfront-PowerPlantMetalParapet', { cullDistance: 900, cullCell: 120 }), 'power-plant-metal-parapet');
  add(makeInstanced(THREE, box, roof, lists.ppRoof, 'WaterfrontHarbourfront-PowerPlantRoof', { cullDistance: 900, cullCell: 120 }), 'power-plant-roof');
  add(makeInstanced(THREE, box, glass, lists.ppWindow, 'WaterfrontHarbourfront-PowerPlantWindows', { cullDistance: 900, cullCell: 120 }), 'power-plant-windows');
  add(makeInstanced(THREE, box, frameMat, lists.ppMullion, 'WaterfrontHarbourfront-PowerPlantMullions', { cullDistance: 900, cullCell: 120 }), 'power-plant-mullions');
  add(makeInstanced(THREE, box, metal, lists.ppClerestory, 'WaterfrontHarbourfront-PowerPlantClerestory', { cullDistance: 900, cullCell: 120 }), 'power-plant-clerestory');
  add(makeInstanced(THREE, box, roof, lists.ppClerestoryBar, 'WaterfrontHarbourfront-PowerPlantClerestoryBars', { cullDistance: 900, cullCell: 120 }), 'power-plant-clerestory-bars');
  add(makeInstanced(THREE, box, metal, lists.ppTheatreBand, 'WaterfrontHarbourfront-PowerPlantTheatreBand', { cullDistance: 900, cullCell: 120 }), 'power-plant-theatre-band');
  add(makeInstanced(THREE, box, roof, lists.ppTheatreBandBar, 'WaterfrontHarbourfront-PowerPlantTheatreBandBars', { cullDistance: 900, cullCell: 120 }), 'power-plant-theatre-band-bars');
  add(makeInstanced(THREE, box, brick, lists.ppShaft, 'WaterfrontHarbourfront-PowerPlantShaft', { cullDistance: 900, cullCell: 120 }), 'power-plant-shaft');
  add(makeInstanced(THREE, cone4, hip, lists.ppHip, 'WaterfrontHarbourfront-PowerPlantHip', { cullDistance: 900, cullCell: 120 }), 'power-plant-hip');
  add(makeInstanced(THREE, box, glass, lists.ppEntryGlass, 'WaterfrontHarbourfront-PowerPlantEntryGlass', { cullDistance: 900, cullCell: 120 }), 'power-plant-entry-glass');
  add(makeInstanced(THREE, box, frameMat, lists.ppEntryFrame, 'WaterfrontHarbourfront-PowerPlantEntryFrame', { cullDistance: 900, cullCell: 120 }), 'power-plant-entry-frame');
  add(makeInstanced(THREE, cone4, entryMetal, lists.ppEntryRoof, 'WaterfrontHarbourfront-PowerPlantEntryRoof', { cullDistance: 900, cullCell: 120 }), 'power-plant-entry-roof');

  // The two red signs are planes with the bounded canvas texture (plain red when there is no DOM canvas).
  const signTex = powerPlantSignTexture(THREE);
  const signMat = signTex
    ? new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide })
    : new THREE.MeshBasicMaterial({ color: 0xb3202a, side: THREE.DoubleSide });
  const signGeo = new THREE.PlaneGeometry(1, 1);
  for (const [list, name] of [[lists.ppSignSouth, 'South'], [lists.ppSignWest, 'West']]) {
    for (const s of list) {
      const sign = new THREE.Mesh(signGeo, signMat);
      sign.name = `WaterfrontHarbourfront-PowerPlantSign${name}`;
      sign.position.set(s.x, s.y, s.z);
      sign.rotation.y = s.ry;
      sign.scale.set(s.w, s.h, 1);
      sign.userData.cullDistance = 900;
      sign.userData.cullCell = 120;
      sign.userData.role = 'power-plant-sign';
      meshes.push(sign);
      group.add(sign);
    }
  }

  const colliders = [];
  const ch = powerPlantChimney();
  if (ch) {
    const r = ESTIMATES.chimneyRadius;
    colliders.push({
      minX: ch.x - r, maxX: ch.x + r, minZ: ch.z - r, maxZ: ch.z + r,
      minY: ch.baseY, maxY: ch.topY, prop: true, kind: 'chimney',
      obb: { cx: ch.x, cz: ch.z, hx: r, hz: r, cs: 1, sn: 0 }
    });
  }
  // Native part colliders for every replaced Power Plant row: the mapped footprint and full mapped height, so the
  // generic body's collision is not lost when the captain drops it.
  const pp = powerPlantLayout();
  if (pp) {
    for (const p of pp.parts) {
      const b = p.box;
      const h = p.row.row[4];
      const ex = Math.abs(b.du * b.cs) / 2 + Math.abs(b.dv * b.sn) / 2;
      const ez = Math.abs(b.du * b.sn) / 2 + Math.abs(b.dv * b.cs) / 2;
      colliders.push({
        minX: b.x - ex, maxX: b.x + ex, minZ: b.z - ez, maxZ: b.z + ez,
        minY: 0, maxY: h, prop: true, kind: 'power-plant',
        obb: { cx: b.x, cz: b.z, hx: b.du / 2, hz: b.dv / 2, cs: b.cs, sn: b.sn }
      });
    }
  }

  let triangles = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    triangles += tris * (mesh.isInstancedMesh ? mesh.count : 1);
  }
  const layout = campusLayout();
  const statsOut = {
    squares: Object.fromEntries(layout.squares.map((s) => [s.id, { name: s.name, x: s.x, z: s.z, area: s.area }])),
    layout,
    boardwalkSlabs: stats.boardwalkSlabs || 0,
    johnQuay: stats.johnQuay || null,
    chimney: stats.chimney || null,
    powerPlant: stats.powerPlant || null,
    meshes: meshes.length, triangles: Math.round(triangles), colliders: colliders.length,
    ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10
  };
  group.userData.waterfrontHarbourfront = statsOut;
  if (scene && scene.add) scene.add(group);
  const result = { group, root: group, colliders, stats: statsOut, layout };
  if (C) { C.waterfrontHarbourfront = result; C.waterfrontHarbourfrontEnabled = true; }

  installPowerPlantExclusion(pp, stats.powerPlant);

  console.info(`[waterfrontHarbourfront] ${layout.squares.map((s) => s.name).join(', ')}; Power Plant stack at the mapped OSM node ` +
    `(${statsOut.chimney ? Math.round(statsOut.chimney.height) : 0} m est., beside a ${statsOut.chimney?.adjacentBlock ? statsOut.chimney.adjacentBlock.h.toFixed(1) : '?'} m block); ` +
    `Power Plant ${statsOut.powerPlant ? `${statsOut.powerPlant.rows.length} rows / ${statsOut.powerPlant.parts} parts / ${statsOut.powerPlant.windows} windows` : 'not built'}; ` +
    `${statsOut.boardwalkSlabs} John Quay boardwalk slabs; ${statsOut.triangles} triangles, ${statsOut.ms} ms`);
  return result;
}

Object.assign(C || (window.CITY = {}), {
  HARBOURFRONT_SQUARES,
  HARBOURFRONT_ESTIMATES: ESTIMATES,
  POWER_PLANT_CHIMNEY,
  POWER_PLANT,
  POWER_PLANT_ESTIMATES,
  campusFrame,
  campusLayout,
  campusSquareAt,
  campusFootprintAt,
  buildingPartWorldCentre,
  partWorldBox,
  powerPlantRows,
  powerPlantLayout,
  powerPlantChimney,
  marinaEdge,
  waterfrontHarbourfrontSupported,
  createWaterfrontHarbourfront,
  buildWaterfrontHarbourfront: createWaterfrontHarbourfront
});
})();