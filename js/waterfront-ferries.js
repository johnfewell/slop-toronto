(function () {
// js/waterfront-ferries.js
// Jack Layton Ferry Terminal, 9 Queens Quay West — the City of Toronto's mainland ferry slip at the foot of Bay Street
// and the gateway to the Toronto Islands. Three routes run from here (mid-April to mid-October): Centre Island,
// Hanlan's Point and Ward's Island; winter service continues to Ward's Island only. This module models only what the
// sources actually establish, and it deliberately does NOT invent a slip-to-route assignment or per-slip canopies,
// because no source reviewed gives that physical layout (see the uncertainty register in docs/waterfront-ferries.md):
//
//   * The terminal BUILDING, from its exact OpenStreetMap footprint (a three-part plan, cx 230.7, cz 624.3,
//     angle -0.549 rad, height 4.5 m) and a roof band. This is the measured baseline.
//   * The two mapped LAND FINGERS that project south from the quay into the harbour between water channels, read from
//     the OSM harbour water outline (x ≈ 287–296 and x ≈ 318–328), modelled as low concrete quay fingers with a kerb.
//     These are mapped land, not a guessed pier count.
//   * The TICKET BLOCK north of the terminal's original entrance, partially under a canopy — the one piece of
//     terminal furniture the sources describe (Wikipedia, "minor upgrades … newer and larger [booths] situated north
//     of the original entrance, partially covered by a canopy"). The coordinator inspected the City's 2025 terminal
//     plan (backgroundfile-254999.pdf, p.10) and research/ferry-access-10.png: it shows FOUR paired-counter booths with
//     the counter labels 8, 6, 4, 3, 2 (pairs 8/7, 6/5, 4/3, 2/1 inferred), round/polygonal cabin fronts, saturated
//     civic-blue upper fascia and lower panels, clear glass from waist to head height, silver curbs/frames — NOT the
//     sixteen solid boxes a plain frontage division computed. The notation below draws that block as glass booths.
//   * A single ROUTE DIRECTORY sign near the entrance naming the three island routes and their colours — wayfinding,
//     the way a real terminal directory works, without claiming which physical berth each route uses. The names are
//     drawn legibly (CanvasTexture) on each panel; the panel's physical placement is an estimate.
//   * The reusable ROUTE ENDPOINT table for the islands followup (st-sb3r.9): the three route names and the actual
//     mapped island dock positions. The disputed Ward's endpoint is reconciled below.
//
// Sources (retrieved 2026-11-09):
// - City of Toronto, Jack Layton Ferry Terminal access plan (2025), background file 254999, p.10 — the four
//   paired-counter ticket booths and the shallow canopy with the raised terminal name:
//   https://www.toronto.ca/legdocs/mmis/2025/di/bgrd/backgroundfile-254999.pdf (local copy: research/ferry-access-10.png)
// - City of Toronto, Island Ferries (the three routes; the express online-ticket line; 9 Queens Quay W):
//   https://www.toronto.ca/explore-enjoy/toronto-island-ferries/ferry-routes-schedules/
// - City of Toronto, Getting Around the Island (three island docks; Centre–Ward's 2.9 km, Centre–Hanlan's 3.9 km,
//   Ward's–Hanlan's 5.4 km): https://www.toronto.ca/explore-enjoy/toronto-island-ferries/getting-around/
// - Waterfront BIA listing (the three destinations named to riders):
//   https://www.waterfrontbia.com/listing/jack-layton-ferry-terminal
// - Wikipedia, "Jack Layton Ferry Terminal" (feet of Bay St / 9 Queens Quay W; "main passenger gates"; ticket booths
//   north of the original entrance partially under a canopy; renamed 2012/2013):
//   https://en.wikipedia.org/wiki/Jack_Layton_Ferry_Terminal
// - OpenStreetMap contributors, ODbL — the mapped "Jack Layton Ferry Terminal" building (three-part footprint, height
//   4.5 m); the harbour water outline (the finger piers and channels); and the three island ferry terminals: Ward's
//   Island way 251286976, Centre Island way 1175136270 and Hanlan's Point node 56794382 (data fetched by the islands
//   wave into js/waterfront-island-arrivals-data.js).
//
// Island endpoints (corrected in this wave): the earlier draft carried bike-share-station coordinates for Centre (and
//   narrated a non-existent "inland duplicate" for Ward). The endpoints now come from the actual OSM terminal geometry:
//   each way's vertex centroid (matching js/waterfront-island-arrivals.js's `centroid`) and the node's point, tagged
//   with osmType/osmId. They are static, so the mainland module does not depend on island-data load order; a focused
//   test cross-checks them against js/waterfront-island-arrivals-data.js.
//
// Geometry conventions (as in the rest of the city): 1 unit = 1 m; world x is grid east, z is grid south; ground
// y = 0; Lake Ontario's surface is CITY_BOUNDS.waterLevel (-0.7 m). Geodata building records are [cx, cz, ang, parts,
// h, …] with each part [u0, u1, v0, v1] in local metres; a local point maps to world x = cx + u*cos + v*sin,
// z = cz - u*sin + v*cos (buildings.js's convention).
//
// Call createWaterfrontFerries(THREE, scene); it returns { group, colliders, stats } and only builds when the active
// frame really covers the mapped terminal (see supportedCityFrame). The group is one culling root, repeated parts are
// instanced, and meshes carry scene-culling.js's cullDistance/cullCell. buildingReplacedAt(x, z) lets the captain
// suppress the generic geodata massing where this module draws the measured terminal building.

const C = window.CITY;
const SETTING = C?.CITY_BOUNDS || {};
const GROUND = 0; // the city's ground plane (y = 0)
const WATER = SETTING.waterLevel ?? -0.7;

// --------------------------------------------------------------------------------------------------------------------
// The three island routes. Names are sourced (City + BIA). Island endpoints are the ACTUAL OSM island ferry-terminal
// footprints (not the old bike-share station POIs the draft had guessed): Ward's Island way 251286976 and Centre Island
// way 1175136270 (each polygon's vertex centroid, matching js/waterfront-island-arrivals.js's `centroid`), and Hanlan's
// Point node 56794382 (its point). The ids/types let the islands module cross-check the contract. This table is the
// reusable contract for the islands wave: it carries only name/colour/endpoint, never a mainland slip assignment (no
// source supports one). The values are static so the mainland module never depends on the island-data load order; a
// test cross-checks them against js/waterfront-island-arrivals-data.js.
// --------------------------------------------------------------------------------------------------------------------
const FERRY_ROUTES = [
  {
    id: 'ward', name: "Ward's Island", short: "Ward's", color: 0x2f6f4f,
    endpoint: { x: 1318.936, z: 2005.305, osmType: 'way', osmId: 251286976, source: "OSM way 251286976 'Ward's Island Ferry Dock' (ferry_terminal), polygon vertex centroid" }
  },
  {
    id: 'centre', name: 'Centre Island', short: 'Centre', color: 0xb3352f,
    endpoint: { x: -542.688, z: 2496.308, osmType: 'way', osmId: 1175136270, source: "OSM way 1175136270 'Centre Island Ferry Terminal' (ferry_terminal), polygon vertex centroid" }
  },
  {
    id: 'hanlans', name: "Hanlan's Point", short: "Hanlan's", color: 0x2c5f9e,
    endpoint: { x: -1207, z: 1659.2, osmType: 'node', osmId: 56794382, source: "OSM node 56794382 'Hanlan's Point' ferry terminal" }
  }
];

// Estimated dimensions (metres) where no measured figure was found; docs/waterfront-ferries.md records each.
// The ticket block is read from the coordinator-inspected City 2025 terminal plan (backgroundfile-254999.pdf, p.10)
// and research/ferry-access-10.png: FOUR paired-counter booths (labels 8/7, 6/5, 4/3, 2/1), not the sixteen a plain
// frontage division computed. Booth fronts are compact, round/polygonal; every dimension below is photo-estimated,
// not surveyed.
const ESTIMATES = {
  roofBandHeight: 0.7,      // a dark band under the parapet, not a measured cornice
  boothPairs: 4,            // the four paired-counter booths the plan shows
  boothWidth: 2.5,          // one booth's frontage: a paired counter shares its cabin with its neighbour
  boothDepth: 2.2,
  boothHeight: 2.7,
  boothPanelHeight: 0.75,   // the civic-blue lower panel, to counter height
  boothSill: 0.12,          // the silver sill under the glazing and the head rail over it
  boothCounter: 0.14,       // the silver counter lip, flush with the lower panel's top
  boothFascia: 0.36,        // the civic-blue fascia band above the glazing
  boothFrames: 0.12,        // the silver frame members between the glazing bays
  canopyDepth: 5.6,         // the canopy partially covering the booths
  canopyHeight: 3.4,        // underside of the roof at the columns (its low edge)
  canopyRise: 0.55,         // the shallow fall across the canopy's depth (it slopes toward the harbour apron)
  canopyPost: 0.16,         // the silver round columns
  canopyBeam: 0.22,         // the dark-blue steel beams under the roof
  canopyFascia: 0.42,       // the cream fascia band that carries the terminal name
  canopyRootDepth: 0.9,     // the roof's depth over the column line (behind the booths) — the rest cantilevers
  directoryWidth: 3.4,      // the single route-directory sign
  directoryHeight: 2.2,
  directoryPostHeight: 2.8,
  kerbWidth: 0.4,
  fingerKerbHeight: 0.35
};

// The terminal's real name, as raised letters on the canopy's beam (City 2025 plan p.10). Cream lettering.
const TERMINAL_NAME = 'JACK LAYTON FERRY TERMINAL';

// True type used to title the canopy and letter the directory; the rest of the city draws with Arial, so this does too.
const SIGN_FONT = 'Arial, "Helvetica Neue", Helvetica, sans-serif';

// PROVISIONAL estimate for where the ticket block stands, in the terminal building's local (u, v) frame. The source
// puts the booths north of the original entrance; the merged geodata cannot pin the exact entrance, and the whole
// north front beside the old anchor is occupied by other buildings — the Westin Harbour Castle podium/tower rows — so
// four booths + their canopy do not fit there without overlapping them (tested). The only clear north-court pocket
// that fits the block is at the west end, and these numbers were placed there by a documented search of the real
// geodata parts (not the merged bounding box). This is an estimate, not a survey: see docs §2.4 and the register.
const BOOTH_ANCHOR = { u: -52.0, v: -28.0 };

// The two mapped land fingers projecting south from the terminal quay into the harbour, read from the OSM water
// outline (at z ≈ 686–700 the water mask is land at x ≈ 287–296 and x ≈ 318–328, water either side). z1 is the
// finger tip south of which the outline is open water. These are measured land features, not guessed piers.
const FINGER_PIERS = [
  { id: 'west-finger', x0: 288, x1: 295, z0: 676, z1: 694 },
  { id: 'east-finger', x0: 319, x1: 327, z0: 676, z1: 696 }
];

// --------------------------------------------------------------------------------------------------------------------
// Frame helpers
// --------------------------------------------------------------------------------------------------------------------
function terminalBuilding() {
  const G = C?.GEO;
  if (!G || !Array.isArray(G.buildings)) return null;
  for (const b of G.buildings) {
    if (b[b.length - 1] === 'Jack Layton Ferry Terminal') return b;
  }
  return null;
}

// The terminal building as a local frame: centre, sine/cosine of its angle, its parts, height, and world corners.
function terminalFrame() {
  const b = terminalBuilding();
  if (!b) return null;
  const [cx, cz, ang, parts, h] = b;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const localToWorld = (u, v) => [cx + u * cs + v * sn, cz - u * sn + v * cs];
  const worldToLocal = (x, z) => {
    const dx = x - cx, dz = z - cz;
    return [dx * cs - dz * sn, dx * sn + dz * cs];
  };
  const corners = [];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [a0, a1, b0, b1] of parts) {
    for (const [u, v] of [[a0, b0], [a1, b0], [a1, b1], [a0, b1]]) {
      corners.push(localToWorld(u, v));
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
  }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of corners) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { cx, cz, ang, cs, sn, parts, height: h, corners, bbox: { x0, x1, z0, z1 }, localU: [u0, u1], localV: [v0, v1], localToWorld, worldToLocal };
}

function pointInRotRect(x, z, cx, cz, cs, sn, u0, u1, v0, v1) {
  const dx = x - cx, dz = z - cz;
  const u = dx * cs - dz * sn;
  const v = dx * sn + dz * cs;
  return u >= u0 && u <= u1 && v >= v0 && v <= v1;
}

// True where the modelled terminal building stands, so the captain can drop the generic massing there. Optional
// margin (metres) widens the replaced area for the terminal apron.
function buildingReplacedAt(x, z, margin = 0) {
  const f = terminalFrame();
  if (!f) return false;
  for (const [a0, a1, b0, b1] of f.parts) {
    if (pointInRotRect(x, z, f.cx, f.cz, f.cs, f.sn, a0 - margin, a1 + margin, b0 - margin, b1 + margin)) return true;
  }
  return false;
}

// The harbour's landward water edge looking south from a quay x. Returns the first z where water begins, or null.
function waterEdgeSouth(x, zStart = 640, span = 60) {
  if (!C?.waterAt) return null;
  for (let z = zStart; z <= zStart + span; z += 0.5) if (C.waterAt(x, z)) return z;
  return null;
}

// --------------------------------------------------------------------------------------------------------------------
// Layout in world space. Exposes the measured terminal, the mapped finger piers, the computed water channels (berths,
// deliberately unassigned to routes), and the route endpoint table. The islands wave reuses routes/berths/endpoints.
// --------------------------------------------------------------------------------------------------------------------
function ferryLayout() {
  const f = terminalFrame();
  if (!f) return null;
  const frontZ = f.bbox.z1; // the building's south edge (toward the lake)
  // The water channels between/around the mapped fingers, sampled from the actual water mask at a mid-finger z.
  const sampleZ = 684;
  const channels = [];
  if (C?.waterAt) {
    let inWater = false, start = 0;
    for (let x = 230; x <= 332; x += 1) {
      const w = C.waterAt(x, sampleZ);
      if (w && !inWater) { start = x; inWater = true; }
      if (!w && inWater) { channels.push([start, x - 1]); inWater = false; }
    }
    if (inWater) channels.push([start, 332]);
  }
  const fingers = FINGER_PIERS.map((p) => ({ ...p }));
  return {
    building: { x: f.cx, z: f.cz, ang: f.ang, height: f.height, bbox: f.bbox },
    frontZ,
    fingers,
    // water channels south of the terminal; NOT assigned to routes (no source supports a berth→route mapping)
    berths: channels.map(([x0, x1], i) => ({
      id: ['west-basin', 'central-slip', 'east-slip'][i] || `channel-${i}`,
      x0, x1, width: x1 - x0, sampleZ, route: null
    })),
    routes: FERRY_ROUTES.map((r) => ({
      id: r.id, name: r.name, short: r.short, color: r.color, endpoint: r.endpoint
    })),
    estimates: ESTIMATES
  };
}

// Look up a route by id or name (case-insensitive; accepts "Ward's", "Wards", "ward", etc.).
function routeByName(name) {
  if (!name) return null;
  const key = String(name).toLowerCase().replace(/[^a-z]/g, '');
  for (const r of FERRY_ROUTES) {
    const cand = [r.id, r.name, r.short, r.name + ' Island']
      .map((s) => String(s).toLowerCase().replace(/[^a-z]/g, ''));
    if (cand.includes(key)) return r;
  }
  return null;
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

// The measured terminal building: its three real footprint parts at the real height, plus a roof band under the
// parapet. No internal layout is invented.
function addTerminalBuilding(f, lists) {
  let boxes = 0;
  for (const [u0, u1, v0, v1] of f.parts) {
    if (u1 - u0 < 1 || v1 - v0 < 1) continue;
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
    const [x, z] = f.localToWorld(uc, vc);
    const w = u1 - u0, d = v1 - v0;
    lists.walls.push({ x, y: GROUND + f.height / 2, z, sx: w, sy: f.height, sz: d, ry: f.ang, color: 0xd9d4c8 });
    lists.roofs.push({
      x, y: GROUND + f.height + ESTIMATES.roofBandHeight / 2, z, sx: w + 0.4, sy: ESTIMATES.roofBandHeight, sz: d + 0.4,
      ry: f.ang, color: 0x5b5750
    });
    boxes++;
  }
  return boxes;
}

// The ticket block NORTH of the terminal's original entrance: FOUR paired-counter booths in a row under a shallow
// canopy, as the City's 2025 plan shows. Each cabin reads as a compact, rounded/polygonal front: a silver curb and
// plinth, a saturated civic-blue lower panel to counter height, a silver counter lip, then clear glass from waist to
// head height between slim silver mullions, a silver head rail, and a civic-blue fascia above. A paired counter is two
// glazing bays in one cabin. The plan's counter labels (8, 6, 4, 3, 2 visible; the pairs 8/7, 6/5, 4/3, 2/1 inferred)
// are recorded per cabin; no fares or live information are invented. Counts, sizes and spacing are photo-estimated.
function addTicketHall(f, lists) {
  // The block stands north of the building (facades facing north, toward the entrance/Queens Quay), at the provisional
  // anchor in the only clear north courtyard (the rest of the north front overlaps other geodata buildings; see
  // BOOTH_ANCHOR). ry = f.ang puts a box's local +x along the building's local u.
  const ry = f.ang;
  const N = ESTIMATES.boothPairs;
  const W = ESTIMATES.boothWidth, D = ESTIMATES.boothDepth, H = ESTIMATES.boothHeight;
  const v = BOOTH_ANCHOR.v;      // booth-centre local v (north of the building's north edge)
  const uC = BOOTH_ANCHOR.u;     // booth-row-centre local u
  const gap = 0.9; // the walkway between one paired-counter cabin and the next (estimated)
  const total = N * W + (N - 1) * gap;
  const cx = Math.cos(ry), cz = Math.sin(ry); // a cabin point (lx, lz) -> world (+lx*cx +lz*cz, -lx*cz +lz*cx)
  let booths = 0;
  const placed = [];
  const panel = ESTIMATES.boothPanelHeight;
  for (let i = 0; i < N; i++) {
    const u = uC - total / 2 + W / 2 + i * (W + gap);
    const [x, z] = f.localToWorld(u, v);
    if (C?.waterAt && C.waterAt(x, z)) continue;
    const left = 8 - i * 2, right = left - 1;
    lists.boothMeta.push({ x, z, u, counters: [left, right] });
    const base = GROUND + 0.12; // the cabin's own base, clear of the silver curb below it
    // cabin slab: silver curb, civic-blue lower panel, silver counter lip, glass, head rail, civic-blue fascia
    lists.boothBases.push({ x, y: GROUND + 0.06, z, sx: W + 0.24, sy: 0.12, sz: D + 0.24, ry, color: 0xb8bcc0 });
    lists.boothBases.push({ x, y: base + panel / 2, z, sx: W, sy: panel, sz: D, ry, color: 0x1f4f8f });
    lists.boothCounter.push({ x, y: base + panel + ESTIMATES.boothCounter / 2, z, sx: W + 0.06, sy: ESTIMATES.boothCounter, sz: D + 0.06, ry, color: 0xc5c9cd });
    const glassY0 = base + panel + ESTIMATES.boothCounter;
    const glassH = 1.02; // waist (1.01 m) to head height (2.03 m): the clear glazing band
    lists.boothGlass.push({ x, y: glassY0 + glassH / 2, z, sx: W - ESTIMATES.boothFrames * 2, sy: glassH, sz: D - ESTIMATES.boothFrames * 2, ry, color: 0xbfd6e2 });
    lists.boothFrames.push({ x, y: glassY0 + glassH + ESTIMATES.boothSill / 2, z, sx: W + 0.04, sy: ESTIMATES.boothSill, sz: D + 0.04, ry, color: 0xc5c9cd });
    // the four corner mullions (slim silver posts at the cabin's corners)
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      const lx = su * (W / 2 - ESTIMATES.boothFrames / 2), lz = sv * (D / 2 - ESTIMATES.boothFrames / 2);
      lists.boothFrames.push({ x: x + lx * cx + lz * cz, y: glassY0 + glassH / 2, z: z - lx * cz + lz * cx, sx: ESTIMATES.boothFrames, sy: glassH, sz: ESTIMATES.boothFrames, ry, color: 0xc5c9cd });
    }
    // a central mullion between the paired counters, and the civic-blue fascia above, capped with a dark roof plate
    lists.boothFrames.push({ x, y: glassY0 + glassH / 2, z, sx: ESTIMATES.boothFrames, sy: glassH, sz: D - ESTIMATES.boothFrames * 2, ry, color: 0xc5c9cd });
    // the civic-blue fascia above the glass (its own band) and the cabin's dark roof plate just over it; both are
    // measured from the cabin's base so the cabin's top edge is exactly at boothHeight
    const glassTop = glassY0 + glassH;
    const fasciaTop = glassTop + ESTIMATES.boothSill;
    lists.boothFasciaBand.push({ x, y: fasciaTop + ESTIMATES.boothFascia / 2, z, sx: W, sy: ESTIMATES.boothFascia, sz: D, ry, color: 0x1f4f8f });
    lists.boothCap.push({ x, y: fasciaTop + ESTIMATES.boothFascia + 0.05, z, sx: W + 0.3, sy: 0.1, sz: D + 0.3, ry, color: 0x25282c });
    placed.push({ x, z });
    booths++;
  }
  // The canopy over the booth row (its whole span runs along the building's local u, its depth along local v). Its roof
  // is a shallow corrugated sheet falling toward the street/entrance (north), carried on dark-blue steel beams, with a
  // cream fascia beam on the street side and four silver round columns.
  if (placed.length >= 1) {
    const along = N * W + (N - 1) * gap + 1.6;
    const depth = ESTIMATES.canopyDepth;
    const Hc = ESTIMATES.canopyHeight, rise = ESTIMATES.canopyRise, th = 0.16;
    const slope = Math.atan2(rise, depth);
    const [rx, rz] = f.localToWorld(uC, v + 0.4); // the roof over the middle of the booth row
    // a unit box (sx along local u, sz along local v) with Euler (rx about x, then ry about y) — whose local +z is
    // the cabin's +v axis when ry is a pure yaw — tilts its far (north/street) edge down by rise
    lists.canopy.push({ x: rx, y: GROUND + Hc + rise / 2 + th / 2, z: rz, sx: along, sy: th, sz: depth, ry, rx: -slope, rz: 0, color: 0xcfd2d4 });
    // corrugation: shallow light-grey ribs across the fall (they read as the sheet's ridges at street distance)
    const ribs = Math.max(4, Math.round(depth / 0.9));
    for (let i = 0; i < ribs; i++) {
      const lv = (i + 0.5) / ribs - 0.5, dz = lv * depth;
      const yy = GROUND + Hc + rise / 2 + th + rise * lv + 0.02;
      lists.canopyRibs.push({ x: rx + dz * cz, y: yy, z: rz + dz * cx, sx: along, sy: 0.05, sz: 0.09, ry, color: 0xdadde0 });
    }
    // the cream fascia on the street (north) edge carries the raised terminal title; its lettering sits 7 cm proud of
    // the fascia's north face, facing the entrance
    const fasciaY = GROUND + Hc - ESTIMATES.canopyFascia / 2 + 0.06;
    const [fx, fz] = f.localToWorld(uC, v + 0.4 - depth / 2);
    lists.canopyFascia.push({ x: fx, y: fasciaY, z: fz, sx: along, sy: ESTIMATES.canopyFascia, sz: 0.12, ry, color: 0xf0ece0 });
    const [tx, tz] = f.localToWorld(uC, v + 0.4 - depth / 2 - 0.07);
    lists.canopyTitle = { text: TERMINAL_NAME, x: tx, y: fasciaY, z: tz, w: along * 0.92, h: ESTIMATES.canopyFascia * 0.74 };
    // dark-blue steel beams under the roof: one cross-beam at each bay and two long purlins at the roof's edges
    const beamY = GROUND + Hc - ESTIMATES.canopyFascia - ESTIMATES.canopyBeam / 2 - 0.06;
    for (let i = 0; i <= N; i++) {
      const [bxx, bzz] = f.localToWorld(uC - total / 2 - 0.8 + i * (W + gap), v + 0.4);
      lists.canopyBeams.push({ x: bxx, y: beamY, z: bzz, sx: ESTIMATES.canopyBeam, sy: ESTIMATES.canopyBeam, sz: depth - 0.3, ry, color: 0x1c3a6b });
    }
    for (const su of [-1, 1]) {
      const [bxx, bzz] = f.localToWorld(uC + su * (along / 2 - 0.4), v + 0.4);
      lists.canopyBeams.push({ x: bxx, y: beamY, z: bzz, sx: ESTIMATES.canopyBeam, sy: ESTIMATES.canopyBeam, sz: depth - 0.3, ry, color: 0x1c3a6b });
      for (const sgn of [-1, 1]) {
        const [pxx, pzz] = f.localToWorld(uC + su * (along / 2 - 0.9), v + 0.4 - sgn * (depth / 2 - 0.5));
        lists.posts.push({ x: pxx, y: GROUND + Hc / 2, z: pzz, sx: ESTIMATES.canopyPost, sy: Hc, sz: ESTIMATES.canopyPost, color: 0xb9bdc1, shape: 'round' });
      }
    }
    // the roof's collar at the building wall (a short sloped plate hiding the joint behind the booths), on the
    // south (building) edge so it does not z-fight with the main sheet
    const [rootX, rootZ] = f.localToWorld(uC, v + 0.4 + depth / 2 - ESTIMATES.canopyRootDepth / 2);
    lists.canopyRoot.push({ x: rootX, y: GROUND + Hc + rise / 2 + th / 2 - 0.02, z: rootZ, sx: along, sy: th, sz: ESTIMATES.canopyRootDepth, ry, rx: -slope, rz: 0, color: 0xbcc0c3 });
  }
  return { booths, canopy: lists.canopy.length ? 1 : 0, counters: placed.length * 2 };
}

// A single route-directory sign near the entrance: a post and a board carrying the three route names/colours. It is a
// terminal directory (three panels), not a per-slip gate sign.
function addRouteDirectory(f, lists) {
  // In the same north courtyard, beside the ticket block (its exact spot is an estimate; the route names are sourced).
  const u = BOOTH_ANCHOR.u + 12;
  const [x, z] = f.localToWorld(u, BOOTH_ANCHOR.v - 4);
  if (C?.waterAt && C.waterAt(x, z)) return 0;
  const H = ESTIMATES.directoryPostHeight;
  lists.signPosts.push({ x, y: GROUND + H / 2, z, sx: 0.14, sy: H, sz: 0.14, color: 0x55595e });
  const boardY = GROUND + H - ESTIMATES.directoryHeight / 2;
  const panelH = ESTIMATES.directoryHeight / FERRY_ROUTES.length;
  const points = [];
  const [lx, lz] = f.localToWorld(u, BOOTH_ANCHOR.v - 4 - 0.07); // the lettering is 7 cm proud of the panel's north face
  FERRY_ROUTES.forEach((r, i) => {
    const py = boardY + ESTIMATES.directoryHeight / 2 - panelH / 2 - i * panelH;
    // a board broad along the entrance frontage (local u) and thin through its depth, facing the street (north)
    lists.directory.push({
      x, y: py, z, sx: ESTIMATES.directoryWidth, sy: panelH * 0.9, sz: 0.1, ry: f.ang, color: r.color
    });
    // its route name, drawn from atlas row i + 1
    lists.directoryLabels.push({ x: lx, y: py, z: lz, w: ESTIMATES.directoryWidth * 0.9, h: panelH * 0.68, routeId: r.id, index: i });
    points.push({ routeId: r.id, name: r.name, x, z, y: py });
  });
  lists.signPoints = points;
  return FERRY_ROUTES.length;
}

// The mapped land fingers projecting into the harbour, as low concrete quay fingers with a kerb along each water edge.
// These are the OSM water outline's land features, not an invented pier count. Only dry-run vertices are used.
function addFingerPiers(f, lists) {
  let pieces = 0;
  for (const p of FINGER_PIERS) {
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    const w = p.x1 - p.x0, d = p.z1 - p.z0;
    if (C?.waterAt && C.waterAt(cx, cz)) continue; // the finger must be mapped land
    lists.fingers.push({ x: cx, y: GROUND + 0.12, z: cz, sx: w, sy: 0.24, sz: d, color: 0x9d9990 });
    // kerb strips just inside the two long (water) edges, landward of the waterline
    for (const sx of [p.x0 + ESTIMATES.kerbWidth / 2, p.x1 - ESTIMATES.kerbWidth / 2]) {
      lists.kerbs.push({
        x: sx, y: GROUND + ESTIMATES.fingerKerbHeight / 2, z: cz,
        sx: ESTIMATES.kerbWidth, sy: ESTIMATES.fingerKerbHeight, sz: d, color: 0x77736b
      });
    }
    pieces++;
  }
  return pieces;
}

// The terminal is downtown-world geometry: build only when the frame really covers the mapped building, the building
// is on dry land, there is harbour water just south of it, and the mapped fingers are land.
function supportedCityFrame() {
  const G = C?.GEO;
  if (!G || !G.frame || !G.frame.detail || !C?.CITY_BOUNDS || !C?.waterAt) return false;
  const f = terminalFrame();
  if (!f) return false;
  const d = G.frame.detail;
  for (const [x, z] of f.corners) {
    if (!(x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1)) return false;
  }
  let wet = 0, n = 0;
  for (let x = f.bbox.x0 + 2; x < f.bbox.x1 - 2; x += 6) {
    for (let z = f.bbox.z0 + 2; z < f.bbox.z1 - 2; z += 6) { n++; if (C.waterAt(x, z)) wet++; }
  }
  if (!(n > 4 && wet === 0)) return false;
  // harbour water must begin within ~40 m south of the quay front
  let southWater = false;
  for (let x = 240; x <= 320; x += 10) { if (waterEdgeSouth(x, f.bbox.z1, 40) !== null) { southWater = true; break; } }
  if (!southWater) return false;
  // the mapped fingers must be land
  for (const p of FINGER_PIERS) {
    if (C.waterAt((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2)) return false;
  }
  return true;
}

// --------------------------------------------------------------------------------------------------------------------
// Lettering. The terminal's name and the three route names are real words: a menu that claims names but shows blank
// colour boxes is not wayfinding. One bounded CanvasTexture atlas carries the four strings in four horizontal rows
// (row 0 = the raised canopy title, rows 1..3 = the directory panels); a label plane's UVs are remapped to its row, so
// one texture and one cheap material serve all four boards. The atlas is built once, is never updated per frame, and
// uses no document listeners.
//
// Headless-safe: with no `document`/2D context (tests, workers) the atlas is null and no label plane is created — the
// coloured boards still stand, nothing throws, and stats.textTextures reports 0. The physical placement of the
// directory is estimated; the route names it shows are the sourced ones.
const LABEL_ROWS = 4, LABEL_W = 1024, LABEL_H = 128, LABEL_INK = '#f5f1e6'; // cream, like the plaza's raised title

function atlas2d() {
  if (typeof document === 'undefined' || !document.createElement) return null;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext && canvas.getContext('2d');
    return ctx ? { canvas, ctx } : null;
  } catch { return null; }
}

function buildLabelAtlas(THREE) {
  const made = atlas2d();
  if (!made || !THREE?.CanvasTexture) return null;
  const { canvas, ctx } = made;
  canvas.width = LABEL_W; canvas.height = LABEL_H * LABEL_ROWS;
  ctx.clearRect(0, 0, canvas.width, canvas.height); // transparent ink: the panel's colour shows through between letters
  ctx.fillStyle = LABEL_INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  [TERMINAL_NAME, ...FERRY_ROUTES.map((r) => r.name)].forEach((text, row) => {
    let size = Math.round(LABEL_H * 0.6);
    do { ctx.font = `700 ${size}px ${SIGN_FONT}`; size -= 2; } while (size > 8 && ctx.measureText(text).width > LABEL_W * 0.92);
    ctx.fillText(text, LABEL_W / 2, row * LABEL_H + LABEL_H / 2, LABEL_W * 0.92);
  });
  const tex = new THREE.CanvasTexture(canvas);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { tex, rows: LABEL_ROWS, width: LABEL_W, height: LABEL_H * LABEL_ROWS };
}

// The atlas row band for a plane's uv (v = 0 at the plane's bottom): the CanvasTexture is flipY, so row 0 is the
// top band; remap every vertex so the plane shows its row upright.
function remapUvToRow(geometry, row, rows) {
  const uv = geometry.attributes.uv;
  const v0 = 1 - (row + 1) / rows, dv = 1 / rows;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * dv);
  uv.needsUpdate = true;
}

// One label plane, placed at world (x, y, z) with a yaw so its printed face looks down the given world normal. The
// plane stands 5-7 cm proud of its board; MeshBasicMaterial keeps the lettering legible regardless of the sun.
function addLabelPlane(THREE, label, atlas, row, yaw, role, name) {
  if (!atlas || !label) return null;
  const Mat = THREE.MeshBasicMaterial;
  if (!Mat || !THREE.PlaneGeometry) return null;
  const geo = new THREE.PlaneGeometry(label.w, label.h);
  remapUvToRow(geo, row, atlas.rows);
  const mat = new Mat({ map: atlas.tex, transparent: true, depthWrite: false, side: THREE.FrontSide ?? 0 });
  mat.name = name + '-material';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.position.set(label.x, label.y, label.z);
  mesh.rotation.y = yaw;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.role = role;
  mesh.userData.cullDistance = 700;
  mesh.userData.cullCell = 120;
  return mesh;
}


function createWaterfrontFerries(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-ferries: THREE is required');
  const f = terminalFrame();
  if (!f || !supportedCityFrame()) {
    if (C) C.waterfrontFerriesEnabled = false;
    console.info('[waterfrontFerries] skipped: the active city frame does not cover the mapped Jack Layton Ferry Terminal');
    return null;
  }
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const group = new THREE.Group();
  group.name = 'WaterfrontFerries';

  const lists = {
    walls: [], roofs: [], posts: [], canopy: [], canopyRoot: [], canopyRibs: [], canopyBeams: [], canopyFascia: [],
    boothMeta: [], boothBases: [], boothCounter: [], boothGlass: [], boothFrames: [], boothFascia: [], boothFasciaBand: [], boothCap: [],
    directory: [], directoryLabels: [], signPosts: [], signPoints: [], canopyTitle: null,
    fingers: [], kerbs: []
  };

  const boxes = addTerminalBuilding(f, lists);
  const hall = addTicketHall(f, lists);
  const directoryPanels = addRouteDirectory(f, lists);
  const fingerPieces = addFingerPiers(f, lists);
  const layout = ferryLayout();

  const wallMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.9, metalness: 0.0 });
  const roofMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.85, metalness: 0.05 });
  const silverMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.4, metalness: 0.7 });  // curb, counter, mullions, columns
  // waist-to-head glazing: a tinted, see-through pane so the booths read as glass cabins, not solid wall boxes
  const glassMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.34, depthWrite: false });
  const blueBeamMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.55, metalness: 0.45 });
  const fasciaMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.85, metalness: 0.0 });
  const concrete = standardMaterial(THREE, { color: 0xffffff, roughness: 0.95, metalness: 0.02 });

  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  const meshes = [];
  const add = (mesh, role) => { if (mesh) { mesh.userData.role = role; meshes.push(mesh); group.add(mesh); } };

  add(makeInstanced(THREE, box, wallMat, lists.walls, 'WaterfrontFerries-Terminal', { cullDistance: 900, cullCell: 120 }), 'terminal-building');
  add(makeInstanced(THREE, box, roofMat, lists.roofs, 'WaterfrontFerries-Roof', { cullDistance: 900, cullCell: 120 }), 'terminal-roof');
  // the booth block: silver curb/panel/counter, blue lower panels, clear glass, blue fascia above
  add(makeInstanced(THREE, box, silverMat, lists.boothBases.filter((it) => it.color === 0xb8bcc0), 'WaterfrontFerries-BoothCurbs', { cullDistance: 800, cullCell: 120 }), 'ticket-booth-curbs');
  add(makeInstanced(THREE, box, fasciaMat, lists.boothBases.filter((it) => it.color === 0x1f4f8f), 'WaterfrontFerries-BoothPanels', { cullDistance: 800, cullCell: 120 }), 'ticket-booth-panels');
  add(makeInstanced(THREE, box, silverMat, lists.boothCounter, 'WaterfrontFerries-BoothCounters', { cullDistance: 800, cullCell: 120 }), 'ticket-booth-counters');
  add(makeInstanced(THREE, box, glassMat, lists.boothGlass, 'WaterfrontFerries-BoothGlass', { cullDistance: 800, cullCell: 120, castShadow: false, receiveShadow: false }), 'ticket-booth-glass');
  add(makeInstanced(THREE, box, silverMat, lists.boothFrames, 'WaterfrontFerries-BoothFrames', { cullDistance: 800, cullCell: 120 }), 'ticket-booth-frames');
  add(makeInstanced(THREE, box, fasciaMat, lists.boothFasciaBand, 'WaterfrontFerries-BoothFascia', { cullDistance: 800, cullCell: 120 }), 'ticket-booth-fascia');
  add(makeInstanced(THREE, box, roofMat, lists.boothCap, 'WaterfrontFerries-BoothCaps', { cullDistance: 800, cullCell: 120 }), 'ticket-booth-caps');
  // canopy: light-grey corrugated shallow roof, its ribs, dark-blue beams, silver columns, cream fascia beam
  add(makeInstanced(THREE, box, roofMat, lists.canopy, 'WaterfrontFerries-Canopy', { cullDistance: 800, cullCell: 120 }), 'ticket-canopy');
  add(makeInstanced(THREE, box, roofMat, lists.canopyRoot, 'WaterfrontFerries-CanopyRoot', { cullDistance: 800, cullCell: 120 }), 'ticket-canopy-root');
  add(makeInstanced(THREE, box, roofMat, lists.canopyRibs, 'WaterfrontFerries-CanopyRibs', { cullDistance: 800, cullCell: 120 }), 'ticket-canopy-rib');
  add(makeInstanced(THREE, cyl, silverMat, lists.posts, 'WaterfrontFerries-CanopyPosts', { cullDistance: 700, cullCell: 120 }), 'canopy-posts');
  add(makeInstanced(THREE, box, blueBeamMat, lists.canopyBeams, 'WaterfrontFerries-CanopyBeams', { cullDistance: 800, cullCell: 120 }), 'ticket-canopy-beam');
  add(makeInstanced(THREE, box, fasciaMat, lists.canopyFascia, 'WaterfrontFerries-CanopyFascia', { cullDistance: 800, cullCell: 120 }), 'ticket-canopy-fascia');
  add(makeInstanced(THREE, box, silverMat, lists.signPosts, 'WaterfrontFerries-SignPosts', { cullDistance: 700, cullCell: 120 }), 'directory-post');
  add(makeInstanced(THREE, box, fasciaMat, lists.directory, 'WaterfrontFerries-RouteDirectory', { cullDistance: 700, cullCell: 120 }), 'route-directory');
  add(makeInstanced(THREE, box, concrete, lists.fingers, 'WaterfrontFerries-Fingers', { cullDistance: 800, cullCell: 120 }), 'finger-piers');
  add(makeInstanced(THREE, box, concrete, lists.kerbs, 'WaterfrontFerries-FingerKerbs', { cullDistance: 800, cullCell: 120 }), 'finger-kerbs');

  // The lettering: the terminal's name on the canopy's cream beam, and a name on each of the three directory panels.
  // One bounded CanvasTexture atlas (built once, headless-safe) supplies the ink; each label plane samples its row.
  // With no `document` the atlas is null: the coloured boards still stand, no label plane is created, nothing throws.
  const atlas = buildLabelAtlas(THREE);
  const labelYaw = f.ang + Math.PI; // a plane's +z normal turned down the building's north (street) axis
  let textPlanes = 0;
  const titleMesh = addLabelPlane(THREE, lists.canopyTitle, atlas, 0, labelYaw, 'canopy-title', 'WaterfrontFerries-CanopyTitle');
  if (titleMesh) { meshes.push(titleMesh); group.add(titleMesh); textPlanes++; }
  for (const label of lists.directoryLabels) {
    const mesh = addLabelPlane(THREE, label, atlas, label.index + 1, labelYaw, 'directory-label:' + label.routeId, 'WaterfrontFerries-DirectoryLabel-' + label.routeId);
    if (mesh) { meshes.push(mesh); group.add(mesh); textPlanes++; }
  }
  const textTextures = atlas ? 1 : 0;

  // Colliders: the measured terminal footprint and the finger-pier kerbs are solid; booths, canopy posts and the
  // directory are not (the player may queue and walk under the canopy).
  const colliders = [];
  for (const part of f.parts) {
    const [u0, u1, v0, v1] = part;
    if (u1 - u0 < 1 || v1 - v0 < 1) continue;
    const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => {
      const [x, z] = f.localToWorld(u, v);
      return { x, z };
    });
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of corners) { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z); }
    colliders.push({ minX, maxX, minZ, maxZ, minY: GROUND, maxY: GROUND + f.height, polygon: corners, kind: 'ferryterminal' });
  }

  let triangles = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    triangles += tris * mesh.count;
  }
  const stats = {
    layout,
    terminalBoxes: boxes,
    ticketBooths: hall.booths, ticketCanopies: hall.canopy, ticketCounters: hall.counters,
    counterLabels: lists.boothMeta.flatMap((b) => b.counters), boothPairs: lists.boothMeta.map((b) => b.counters),
    directoryPanels, routeSignPoints: lists.signPoints,
    terminalName: TERMINAL_NAME, textTextures,
    boothAnchor: (() => { const [ax, az] = f.localToWorld(BOOTH_ANCHOR.u, BOOTH_ANCHOR.v); return { u: BOOTH_ANCHOR.u, v: BOOTH_ANCHOR.v, x: ax, z: az }; })(),
    fingerPiers: fingerPieces, fingerKerbs: lists.kerbs.length,
    routes: layout.routes.map((r) => r.name),
    berths: layout.berths.length,
    meshes: meshes.length, triangles: Math.round(triangles), colliders: colliders.length,
    ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10
  };
  group.userData.waterfrontFerries = stats;
  if (scene && scene.add) scene.add(group);
  const result = { group, root: group, colliders, stats, layout, routeByName, buildingReplacedAt };
  if (C) { C.waterfrontFerries = result; C.waterfrontFerriesEnabled = true; }
  console.info(`[waterfrontFerries] Jack Layton Ferry Terminal: ${boxes} measured terminal boxes, ` +
    `${hall.booths} ticket booths under ${hall.canopy} canopy, ${fingerPieces} mapped finger piers, ` +
    `${directoryPanels}-panel route directory, ${layout.berths.length} mapped water channels, ${stats.triangles} triangles, ${stats.ms} ms`);
  return result;
}

Object.assign(C || (window.CITY = {}), {
  FERRY_ROUTES,
  FERRY_ESTIMATES: ESTIMATES,
  FERRY_BOOTH_ANCHOR: BOOTH_ANCHOR,
  FERRY_FINGER_PIERS: FINGER_PIERS,
  terminalFrame,
  ferryLayout,
  routeByName,
  buildingReplacedAt,
  waterEdgeSouth,
  supportedFerriesCityFrame: supportedCityFrame,
  createWaterfrontFerries,
  buildWaterfrontFerries: createWaterfrontFerries
});
})();