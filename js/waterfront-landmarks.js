(function () {
// js/waterfront-landmarks.js
// The two Waterfront BIA landmarks whose distinctive silhouettes the generic City massing flattens into anonymous
// boxes (epic st-sb3r, beads .4 and .6):
//
//   1. Queen's Quay Terminal (207 Queen's Quay W): the 1926-27 Toronto Terminal Warehouse, a poured-concrete dry/cold
//      storage warehouse by Moores & Dunford, 420 x 200 ft (128 x 61 m), eight storeys, one of Canada's largest
//      buildings; the southwest cold-storage wing was demolished (it is Canada Square now) and in 1983 Zeidler Roberts
//      added four residential floors on top of the original eight, a garden/pool deck and Art Deco entrances, the whole
//      reclad with a green-patina metal roof (like Union Station and the Royal York) and its old clock tower.
//      Source: https://en.wikipedia.org/wiki/Queen%27s_Quay_Terminal ; Waterfront BIA listing
//      https://www.waterfrontbia.com/listing/queens-quay-terminal . The main eight-storey block is the committed City
//      3D Massing / OSM building "Queen's Quay Terminal" (row 33202, 140 x 61.4 m, mapped height 31 m, its long axis on
//      the water); the stone-and-glass residential addition is the small named rows around it (33204 at 43 m, plus the
//      rooftop cores), and the clock tower sits on the north-front rooftop structure (row 33203, a photo/map inference).
//      The warehouse's strongest read is its long lakefront face along the harbour; the
//      captain's Zeidler-photo read is a CREAM frame way with strong GREEN / dark multi-pane glazing, PALE-GREEN projecting
//      balcony/glazing banks at the four upper residential levels and a FLAT GREEN roof edge (bead .4 refinement:
//      docs/waterfront-terminal-refinement.md). Every colour/bay/projection figure is an estimate.
//
//   2. Redpath Sugar Refinery (Queens Quay at Jarvis St, opened 1958): Building 1 (eight floors, the refining plant), a
//      chimney stack, Building 2 (five floors, the museum) and the Raw Sugar Shed that stockpiles each fall's cane, whose
//      north face carries the Wyland whale mural; the surviving "REDPATH SUGAR" sign is on the west side of the tall
//      plant, a one-line red block-capital inscription on pale brick (captain's photo inspection); raw sugar arrives by
//      freighter alongside the quay. It is the industrial landmark that gives Canada's Sugar Beach its identity —
//      Sugar Beach stands EAST of the refinery across the mapped "Jarvis Slip" water polygon, so the refinery reads from
//      the beach across that slip.
//      Source: https://en.wikipedia.org/wiki/Redpath_Sugar_Refinery ; Waterfront Toronto Canada's Sugar Beach
//      https://www.waterfrontoronto.ca/our-projects/canadas-sugar-beach . The complex stands on the committed geodata
//      zone "zone:industrial Redpath Sugar Refinery". The module claims EVERY large mapped structure inside that zone
//      (the long hall 34614, the L-plan raw-sugar shed 34623, the tall plants 34619/34622 and the annexes 34615/34617/
//      34618/34620/34621) and gives them pale-grey brick material segmentation (a TSL running-bond course/head-joint/
//      weathering colorNode on base 0xa7aaa4, so the wall never washes to featureless white under the midday sun),
//      pilaster bays, sparse lower windows and gray
//      hoods, parapets, a pipe/rack assembly, corrugated cladding, a large pitched raw-store roof on the long hall (the
//      mapped 16 m height kept as the ridge; the function is a photo/geospatial inference) and a light-grey pitched shed
//      roof, so the whole refinery reads instead of the generic tan boxes the wave-3 capture showed. The quay tower rows
//      34612/34613 are claimed and given an industrial shaft (function unresolved), and the ship unloader is anchored to
//      the zone edge that actually abuts the mapped Jarvis Slip. The mapped turns put the tall plant's west face at
//      local -u and the shed's north face at local -u, so the sign and mural both sit on -u faces of their own parts
//      (the wave-3 build had the shed faces transposed and the sign on a maroon board, both corrected). The barrel-silo
//      battery and chimney stack have NO mapped footprint, so they are reported unresolved rather than invented.
//
// Geometry fidelity rules
// -----------------------
// - Every wall, roof and detail is placed inside the exact mapped footprint of the building (or the mapped refinery
//   zone) that the City already stands on. The module never moves a building off its surveyed outline and never
//   invents a placement; where the source gives no measured size for a detail (unloader reach, the mural's band) the
//   module records the figure it used as an explicit estimate.
// - Components are keyed by their STABLE identity (mapped name + world centre + mapped height), never by row index: the
//   default desktop frame is eglinton, whose building table is a different size and order (QQT sits at rows 131069.. there
//   vs 33202.. in the detail map) but the same world centres. resolveComponents() finds the active frame's rows, so the
//   module never suppresses an unrelated building.
// - To avoid drawing a generic City box *under* the silhouette, the module exposes `window.CITY.waterfrontLandmark-
//   ExcludesBuilding(rowIndex)` (and the set `window.CITY.waterfrontLandmarkExcludedRows`), resolved for the active frame.
//   main.js/buildings.js is the captain's file: it calls the predicate to skip those rows. This module owns only itself.
// - The city-grid extruded-polygon helper returns a Mesh; merge() takes its geometry and normalises indexed/non-indexed
//   parts, so the merge never receives a Mesh (the integrated-runtime failure this guards against).
// - Shared geometry only: one merged warehouse shell, one merged refinery shell, one instanced/merged unloader, a single
//   culling-friendly root group; collision boxes for the solids. Image URLs are references, not inputs the module reads.

const C = window.CITY;
const SW = C?.CITY_BOUNDS?.sidewalkHeight ?? 0.22;

// ---------------------------------------------------------------------------------------------------------------------
// Source-backed landmark records (measured extents in world metres, GEO.frame.projection). All placements derive from
// the committed geodata (GEO.buildings / GEO.areas); the rows and zone below are the ones this module was built against.
// ---------------------------------------------------------------------------------------------------------------------

// The mapped "Queen's Quay Terminal" complex (rows 33202-33212, every one named "Queen's Quay Terminal" in the
// committed geodata):
//   33202  the eight-storey warehouse block, 140 x 61.4 m, mapped height 31 m (the source says 420 x 200 ft = 128 x
//          61 m, 8 storeys: the committed footprint is a simplified rectangle of the same size, ROTATED 90 deg in the
//          massing — the 140 m axis runs N-S here; this module stands on the committed footprint, it does not reorient
//          the mapped building). Its yaw is ~-pi/2, so in the box's own frame: +u axis = +z (south), -u = -z (NORTH, the
//          SHORT face on Queens Quay), +v = -x (WEST, the LONG harbour/industrial face), -v = +x (east).
//   33204  the 1983 Zeidler Roberts addition: its three mapped parts are exactly TWO long perimeter bands ~120 x 10 m
//          plus a short end band, all at 43 m, enclosing an OPEN courtyard/lightwell between them (no solid middle) —
//          matching the CMHC case study's "FOUR added levels in two perimeter blocks, stepping back, open courtyards"
//   33203  the north-front rooftop structure at the warehouse's north edge (centre -207.2, 626.2, 43.4 m; footprint
//          ~6.8 x 6.2 m). The captain's photo/map comparison puts the actual NORTH-CENTRED CLOCK SHAFT here, not on
//          33212. This is a PHOTO/MAP INFERENCE (no OSM clock tag), so it is labelled that way, not asserted as mapped.
//   33205/33206/33207/33208/33209/33210/33211/33212  small ~2-12 m mapped rooftop structures at the addition's corners
//          and edges, 41-46 m: modelled as the addition's stepped penthouse/stair cores (their exact mapped centres).
//          33212 in particular is an EAST MID-ROOF core, NOT the north clock shaft — it is kept as a penthouse row.
const QQT = {
  id: 'queensQuayTerminal',
  name: "Queen's Quay Terminal",
  short: 'QQ Terminal',
  address: '207 Queens Quay W',
  // The committed components, keyed by their stable identity (name + world centre + mapped height), NOT by row index:
  // the same building sits at the same world position in every frame (detail and the default eglinton map share the
  // projection and centres) but at a different row index (e.g. row 33202 in detail = row 131069 in eglinton). The
  // resolver below finds the active frame's row from these keys, so the module never suppresses an unrelated building.
  keys: {
    warehouse: { name: "Queen's Quay Terminal", cx: -206.4, cz: 692.4, h: 31 },   // the 8-storey block (the long mass)
    addition: { name: "Queen's Quay Terminal", cx: -203.2, cz: 694.3, h: 43 },    // the +4-storey addition (3 mapped parts)
    // the genuine QQT clock tower: the north-front rooftop row 33203 (photo/map inference — no OSM clock tag; see the
    // header note). This row sits at the warehouse's NORTH edge (z ~626 is the north/short face), NOT mid-roof.
    clock: { name: "Queen's Quay Terminal", cx: -207.2, cz: 626.2, h: 43.4 },
    penthouses: [
      { name: "Queen's Quay Terminal", cx: -208.2, cz: 652.9, h: 45 },
      { name: "Queen's Quay Terminal", cx: -203.7, cz: 652.4, h: 43 },
      // the two thin 24 x 2 m QQT-named rooftop slivers along the water side (rows 33207/33208): these were the
      // "generic unexcluded narrow building on the quay" — part of the terminal, so claimed here (drawn + excluded)
      { name: "Queen's Quay Terminal", cx: -203.4, cz: 683.4, h: 41 },
      { name: "Queen's Quay Terminal", cx: -203.0, cz: 713.4, h: 41 },
      { name: "Queen's Quay Terminal", cx: -217.8, cz: 687.4, h: 46 },
      { name: "Queen's Quay Terminal", cx: -217.5, cz: 717.4, h: 46 },
      { name: "Queen's Quay Terminal", cx: -188.6, cz: 709.4, h: 46 },
      // the former clock row 33212 is an EAST MID-ROOF core, kept here as a penthouse/stair core (all 11 rows retained)
      { name: "Queen's Quay Terminal", cx: -188.9, cz: 679.4, h: 46 }
    ]
  },
  // the clock tower: the north-centred shaft on row 33203 (photo/map inference). Form from the Zeidler image: a cream
  // shaft of narrow Art Deco vertical ribs, a flat stepped parapet, and TWO black round clock faces (north + west, the
  // two faces the northwest-shot photo can see) with restrained ticks/hands — no pyramidal cap. clockTop is the mapped
  // 43.4 m, not a forced 46.
  clockTop: 43.4,             // mapped row-33203 rooftop top (photo does not justify forcing it higher)
  // which tower faces carry a clock: the photo looks SE from the northwest, so only the NORTH (world -z) and WEST (world
  // -x) faces show a dial. Rendering four would invent two unseen faces, so only these two. Stored as world-space outward
  // normal components [nx, nz] the builder projects a black disc + tick/hand detail onto.
  clockFaces: [[0, -1], [-1, 0]],
  // ---- Green frame + glass typology (captain's inspection of the historical Zeidler photograph, TSA page
  // https://torontosocietyofarchitects.ca/buildings/queen-quay-terminal/, credits ZeidlerArchitecture; photo date
  // unknown). The captain described: a CREAM warehouse frame with STRONG GREEN / DARK multi-pane GLAZING; PALE-GREEN
  // projecting residential glazing/balconies at the four upper levels with a FLAT GREEN roof edge. The actual 1983
  // building is therefore a green-frame-and-glass building on a cream structural frame — NOT a plain cream massing box and
  // NOT a blanket green solid tower. Every colour and fit number below is an ESTIMATE from that photo (no site survey /
  // measured paint schedule); see docs/waterfront-terminal-refinement.md.
  frame: {
    cream: 0xcfc6b0,        // EST: the structural piers / spandrels read cream in the photo
    frameGreen: 0x3f7a5c,   // EST: the green mullion / transom frame over the dark glazing (blue-green, not grass)
    glass: 0x1d3730,        // EST: the strong dark green-tinted multi-pane glass
    resGreen: 0x8fb59a,     // EST: the pale sea-green of the upper residential glazing / balcony soffits
    roofEdge: 0x3f7a5c,     // EST: the flat green roof-edge / parapet (same green family as the frame)
    // warehouse window bay (source-typology, estimated): a broad punched bay with a dense green mullion grid over dark
    // glass, split by cream structural piers. Numbers are fit to the photo's proportion, not surveyed.
    bayWindowW: 3.6, bayFloorH: 3.9, bayWindowRY: 0.78, // broad window in the bay (3.6 m wide of ~4.6 m pitch)
    frameBarT: 0.11,        // EST: green mullion thickness (m)
    frameSillT: 0.14,       // EST: green sill / head curb thickness (m)
    // upper residential levels: 4 glazed/balcony levels over the warehouse roof, each set slightly proud (the source's
    // projecting glazing). The mapped additionParts stay the solid volumes; the projecting band is bounded decoration
    // on their outward faces.
    resLevels: 4,           // source text says four added residential floors; the photo shows the projecting banks
    resProud: 0.55,         // EST: how far the glazing/balcony bank projects past the addition face (m)
    resGlassH: 2.05,        // EST: glazed band height per residential level (m)
    resSoffitH: 0.32        // EST: pale balcony slab / soffit at each level's foot (m)
  },
  // source cross-checks (not placement): 420 x 200 ft, 8 then +4 storeys, 43 m, green-patina roof
  source: 'Toronto Terminal Warehouse 1926-27, Moores & Dunford; the main storage building 420 x 200 ft, eight storeys; the 1983 Zeidler Roberts rebuild added four residential levels as two stepped perimeter blocks around an open courtyard under a green-patina roof, with a ribbed clock tower on the north face (CMHC case study NH17-253/1997)',
  sourceUrls: [
    'https://en.wikipedia.org/wiki/Queen%27s_Quay_Terminal',
    'https://publications.gc.ca/collections/collection_2022/schl-cmhc/NH17-253-1997-eng.pdf',
    'https://www.waterfrontbia.com/listing/queens-quay-terminal',
    'https://commons.wikimedia.org/wiki/Category:Queen%27s_Quay_Terminal'
  ]
};

const REDPATH = {
  id: 'redpathSugar',
  name: 'Redpath Sugar Refinery',
  short: 'Redpath',
  zoneName: 'Redpath Sugar Refinery',  // GEO.areas zone:industrial with this name
  // Halls keyed by stable identity (world centre + mapped height); the rows are unnamed in the geodata, so the centre
  // and height are the stable key across frames. The resolver finds each in the active frame's building table.
  keys: {
    longHall: { cx: 811.4, cz: 523.1, h: 16 },   // the long 166.8 x 47.4 m hall
    shed: { cx: 751.6, cz: 560.0, h: 8 },        // the big low shed (two mapped parts)
    plant: [                                     // Building 1 / tall refining blocks (~25-28 m mapped)
      { cx: 679.7, cz: 481.6, h: 25.5 },
      { cx: 758.1, cz: 507.9, h: 28 }
    ],
    // The rest of the mapped refinery plant inside the zone: real annexes / process blocks the generic city would
    // otherwise draw as blank tan boxes (the wave-3 capture read them as anonymous massing). Claiming them by the same
    // stable centre+height key lets the module give the WHOLE refinery a material/bay/parapet language without moving a
    // single footprint. Sizes are the committed row bounding boxes, not estimates.
    support: [
      { cx: 656.8, cz: 550.7, h: 8 },    // 94.5 x 57.0 m low west annex shed (mapped row 34615)
      { cx: 631.1, cz: 479.2, h: 11.8 }, // 44.2 x 18.4 m west hall (34617)
      { cx: 668.6, cz: 491.3, h: 16 },   // 27.4 x 19.8 m north hall (34618)
      { cx: 701.0, cz: 522.4, h: 19 },   // 50.0 x 21.5 m mid plant block (34620)
      { cx: 658.7, cz: 523.1, h: 17 }    // 21.8 x 20.0 m south plant block (34621)
    ],
    // The last mapped structure in the zone: two stacked 7.0 x 6.2 m rows at the same centre (34612 h22.5 / 34613
    // h21.5), which the GPU capture showed as a thin white "condo" tower on the quay. It is zone-confirmed industrial;
    // its function is unresolved, so it is modelled as an industrial utility/connector tower (no windows, no chimney
    // identity) on the mapped footprint rather than left to the generic residential shader.
    tower: { cx: 783.8, cz: 608.3, h: 22.5 },
    towerBase: { cx: 783.8, cz: 608.3, h: 21.5 }
  },
  longHallRow: null, shedRow: null, plantRows: [], // (resolved per frame; see resolveComponents)
  // The barrel-silo battery and the chimney stack are described in the source but have NO mapped footprint in the
  // committed geodata and no verifiable position from a photo this text model can read; per the realism rule they are
  // NOT invented in open space. They are reported as unresolved (see docs/waterfront-landmarks.md) unless a mapped
  // structure anchors them. Only the mapped halls, the two source-attested face features and the ship unloader (anchored
  // to the zone edge that actually abuts the mapped Jarvis Slip water polygon) are built.
  silo: null,
  chimney: null,
  // Ship unloader: a bright-green articulated hydraulic material handler (Sennebogen-type) on the dock that fronts
  // Jarvis Slip — cab, counterweight, white grille box, dark A-frame wheel gantry — reaching out over the slip to the
  // freighter. Dimensions ESTIMATED from the manufacturer photos (src: cab ~30 ft above dock, reaches ~19 ft from the
  // swing centre, dock ~30 ft wide, 20 ft² hopper); the position is the real water-fronting zone edge.
  unloader: {
    reach: 6.5, boomUp: 9.4, stickDown: 2.4,   // boom tip height and stick tip (over the water) — estimates
    chassis: [5.0, 1.3, 4.6],                  // wheeled undercarriage (w across, h, d along heading)
    pedestalR: 0.95, pedestalH: 4.0,           // black cylindrical pedestal from the A-frame to the machinery deck
    bodyW: 2.8, bodyH: 2.4, bodyD: 3.6,        // white grille machinery box
    cabAboveDock: 9.1                          // source: cab ~30 ft (9.1 m) above the dock
  },
  // Orientation (derived from the mapped row's own turn, not a guessed azimuth): the tall plant's local -u normal
  // points west (-x), so the surviving west "Redpath Sugar" sign goes on that plant's -u face; the shed's local -u
  // normal points north (-z), so the Wyland whale mural goes on the shed's -u face. Source for which faces carry them:
  // https://en.wikipedia.org/wiki/Redpath_Sugar_Refinery ("signage on the west side ... is still intact"; the whale
  // mural is on the north-facing wall of the Raw Sugar Shed). The sign's actual form is from the captain's photo
  // inspection of acotoronto.ca RedpathSugarRefinery4.jpg: ONE LINE, red/burgundy raised sans-serif block capitals
  // "REDPATH SUGAR" set directly on a pale-brick tall wall near the top, no maroon board, no cream lettering, no rule.
  signage: {
    signFace: 'west', signLocalFace: '-u', signText: 'REDPATH SUGAR', signInk: '#9e1b1b',
    muralFace: 'north', muralLocalFace: '-u',
    // A second BIA photo shows a red cursive underlined "Redpath" logo on a pale wall with sparse gray hoods; the
    // facade for it is not confidently identified, so it is reported unresolved rather than placed by guess.
    unresolvedSign: 'cursive underlined "Redpath" logo facade (BIA photo; row not confidently matched)'
  },
  source: 'Redpath Sugar, opened 1958: Building 1 (8 floors), a chimney stack, Building 2 (5 floors), and the Raw Sugar Shed with the Wyland whale mural (north face) and the "Redpath Sugar" sign (west); raw sugar freighters unload at the quay',
  sourceUrls: [
    'https://en.wikipedia.org/wiki/Redpath_Sugar_Refinery',
    'https://commons.wikimedia.org/wiki/File:Waterfront_view_of_the_Redpath_Sugar_Refinery.jpg',
    'https://commons.wikimedia.org/wiki/File:RedpathSugarRefinery3.JPG',
    'https://www.waterfrontoronto.ca/our-projects/canadas-sugar-beach'
  ]
};

const WATERFRONT_LANDMARKS = [
  { id: QQT.id, name: QQT.name, short: QQT.short, address: QQT.address, source: QQT.source, sourceUrls: QQT.sourceUrls },
  { id: REDPATH.id, name: REDPATH.name, short: REDPATH.short, address: 'Queens Quay E at Jarvis St', source: REDPATH.source, sourceUrls: REDPATH.sourceUrls }
];

// ---------------------------------------------------------------------------------------------------------------------
// Pure geometry math (shared with tests; no THREE)
// ---------------------------------------------------------------------------------------------------------------------
function ringOf(areas, kind, name) {
  if (!Array.isArray(areas)) return null;
  for (const a of areas) {
    if (!Array.isArray(a) || a[0] !== kind || a[1] !== name) continue;
    const ring = [];
    for (let i = 0; i + 1 < a[2].length; i += 2) ring.push([a[2][i], a[2][i + 1]]);
    if (ring.length >= 3) return ring;
  }
  return null;
}
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distanceToRing(ring, x, z) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}
function ringBox(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

// A mapped building row -> { cx, cz, ang, halfW, halfD, h, name } (outer bounding box of its parts), or null.
function buildingBox(buildings, bi) {
  const b = buildings?.[bi];
  if (!Array.isArray(b)) return null;
  const [cx, cz, ang, parts, h, , , , , name] = b;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of parts) { u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[1]); v0 = Math.min(v0, p[2]); v1 = Math.max(v1, p[3]); }
  if (!(u1 > u0 && v1 > v0)) return null;
  return { cx, cz, ang, halfW: (u1 - u0) / 2, halfD: (v1 - v0) / 2, h, name: name || '' };
}

// A corner of a turned box (centre, yaw, half widths): the local (u, v) offsets u in [-halfW, halfW].
function boxCorner(box, su, sv) {
  const cs = Math.cos(box.ang), sn = Math.sin(box.ang);
  const u = su * box.halfW, v = sv * box.halfD;
  return [box.cx + u * cs + v * sn, box.cz - u * sn + v * cs];
}

// Resolve the stable component keys to the ACTIVE frame's building-row indices. The default desktop frame is eglinton,
// whose building table is a different size and order (QQT sits at rows 131069..131079 there vs 33202..33212 in detail)
// but the same world centres; so rows are found by name (where present) + centre + mapped height, never assumed by
// index. Cached per GEO so the scan runs once. Rows that do not resolve stay -1 and are simply not built or excluded —
// this can never suppress an unrelated building.
const RESOLVE_CACHE = new WeakMap();
function resolveComponents(G = C?.GEO) {
  if (!G || !Array.isArray(G.buildings)) return null;
  if (RESOLVE_CACHE.has(G)) return RESOLVE_CACHE.get(G);
  const plan = [
    ['warehouse', QQT.keys.warehouse], ['addition', QQT.keys.addition], ['clock', QQT.keys.clock],
    ['longHall', REDPATH.keys.longHall], ['shed', REDPATH.keys.shed]
  ];
  QQT.keys.penthouses.forEach((k, i) => plan.push([`penthouse${i}`, k]));
  REDPATH.keys.plant.forEach((k, i) => plan.push([`plant${i}`, k]));
  REDPATH.keys.support.forEach((k, i) => plan.push([`support${i}`, k]));
  plan.push(['tower', REDPATH.keys.tower], ['towerBase', REDPATH.keys.towerBase]);
  const found = Object.fromEntries(plan.map(([id]) => [id, null]));
  const tol = 1.0, tolH = 0.6;
  for (let bi = 0; bi < G.buildings.length; bi++) {
    const b = G.buildings[bi];
    if (!Array.isArray(b)) continue;
    for (const [id, k] of plan) {
      if (found[id] !== null) continue;
      if (k.name !== undefined && b[9] !== k.name) continue;
      if (Math.hypot(b[0] - k.cx, b[1] - k.cz) <= tol && Math.abs(b[4] - k.h) <= tolH) found[id] = bi;
    }
  }
  const resolved = {
    warehouse: found.warehouse, addition: found.addition, clock: found.clock,
    penthouses: QQT.keys.penthouses.map((_, i) => found[`penthouse${i}`]).filter((i) => i !== null),
    longHall: found.longHall, shed: found.shed,
    plants: REDPATH.keys.plant.map((_, i) => found[`plant${i}`]).filter((i) => i !== null),
    supports: REDPATH.keys.support.map((_, i) => found[`support${i}`]).filter((i) => i !== null),
    tower: found.tower, towerBase: found.towerBase
  };
  RESOLVE_CACHE.set(G, resolved);
  return resolved;
}

// Is a building row the named landmark (its mapped name), or one of the rows this module claims?

// The frame capability guard the siblings use: the active map really covers the mapped rows/zone, and has the city
// predicates the placement checks rely on.
function supportedCityFrame(G = C?.GEO, city = C) {
  if (!G || !G.frame || !G.frame.detail || !city?.CITY_BOUNDS) return false;
  if (!Array.isArray(G.buildings) || !G.buildings.length || !Array.isArray(G.areas) || !G.areas.length) return false;
  const R = resolveComponents(G);
  if (!R || R.warehouse === null) return false;   // the mapped QQT warehouse must resolve in this frame
  const d = G.frame.detail;
  const inFrame = (x, z) => x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1;
  const qqt = buildingBox(G.buildings, R.warehouse);
  if (!qqt || !inFrame(qqt.cx, qqt.cz)) return false;
  const zone = ringOf(G.areas, 'zone:industrial', REDPATH.zoneName);
  if (!zone) return false;
  const zb = ringBox(zone);
  return inFrame((zb.minX + zb.maxX) / 2, (zb.minZ + zb.maxZ) / 2);
}

// ---------------------------------------------------------------------------------------------------------------------
// Layout (pure; testable without a renderer)
// ---------------------------------------------------------------------------------------------------------------------
// Every mapped part of a row as independent world-space rects ({ cx, cz, ang, halfW, halfD, h, row }), so a
// multi-part row (the addition's perimeter bands, an L plan) is kept exactly as the geodata splits it. This is the
// honest inside-the-footprint primitive: the parts ARE the committed footprint pieces.
function rowParts(buildings, bi) {
  const b = buildings?.[bi];
  if (!Array.isArray(b)) return [];
  const [cx, cz, ang, parts, h] = b;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const out = [];
  for (const p of parts) {
    const uc = (p[0] + p[1]) / 2, vc = (p[2] + p[3]) / 2;
    const halfW = (p[1] - p[0]) / 2, halfD = (p[3] - p[2]) / 2;
    if (!(halfW > 0 && halfD > 0)) continue;
    out.push({ row: bi, cx: cx + uc * cs + vc * sn, cz: cz - uc * sn + vc * cs, ang, halfW, halfD, h });
  }
  return out;
}

// Queen's Quay Terminal: the eight-storey warehouse block (row 33202, mapped 31 m) and the 1983 addition (row 33204) as
// its own mapped parts — two long perimeter bands and an end band at 43 m enclosing an OPEN courtyard — plus the small
// mapped rooftop structures (penthouses/cores, 43-46 m). Nothing is a single invented "inset box": every piece is a
// mapped footprint part. The warehouse shell is the committed row, described as a simplified rectangle (not a survey
// drawing). The green-patina cornice and Art Deco entrance piers are period details, not placement.
function layoutQQT(G = C?.GEO, qqtSpec = QQT) {
  const R = resolveComponents(G);
  if (!R || R.warehouse === null) return null;
  const box = buildingBox(G?.buildings, R.warehouse);
  if (!box) return null;
  const warehouseH = box.h;               // mapped 31 m (8 storeys; the source's 43 m is the post-1983 total)
  const additionParts = R.addition !== null ? rowParts(G?.buildings, R.addition).filter((p) => p.h > warehouseH) : [];
  const topH = additionParts.length ? additionParts.reduce((m, p) => Math.max(m, p.h), warehouseH) : warehouseH + 12;
  // the small mapped rooftop structures (penthouses / stair cores) at 43-46 m
  const penthouses = [];
  for (const bi of R.penthouses) {
    for (const p of rowParts(G?.buildings, bi)) if (p.h > warehouseH) penthouses.push(p);
  }
  // the clock tower sits on the mapped north-front rooftop structure (row 33203) — a PHOTO/MAP INFERENCE (see the spec).
  let clockTower = null;
  const clockParts = R.clock !== null ? rowParts(G?.buildings, R.clock) : [];
  if (clockParts.length) {
    const cp = clockParts[0];
    clockTower = {
      cx: cp.cx, cz: cp.cz, ang: cp.ang,
      halfW: cp.halfW, halfD: cp.halfD,        // the mapped structure's plan (the tower's base)
      baseH: warehouseH,                      // the clock is part of the facade, not a new tower above the roof
      topH: Math.max(cp.h, qqtSpec.clockTop ?? cp.h), // the mapped 43.4 m height (not forced higher)
      ribs: 9,                                 // cream narrow Art Deco vertical ribs on the tower faces (source photo)
      faces: (qqtSpec.clockFaces || [[0, -1], [-1, 0]]).slice() // world-space outward normals that carry a dial
    };
  }
  return {
    id: qqtSpec.id, name: qqtSpec.name, address: qqtSpec.address,
    box: { ...box },
    warehouseH, topH,
    // Queens Quay frontage is the -v side, the harbour/lakefront the +v side (the harbour lies at +z here)
    faces: { quay: boxCorner(box, 0, -1), lake: boxCorner(box, 0, 1) },
    additionParts,        // the two perimeter bands + the end band, from row 33204 (open courtyard between them)
    penthouses,           // small mapped rooftop structures at their real centres
    clockTower,           // the genuine QQT clock tower on the mapped rooftop structure nearest the north face
    frame: { ...(qqtSpec.frame || {}) }, // green frame + glass + cream palette (all estimates; see the spec)
    cornice: { h: 0.55, overhang: 0.35, color: 0x5f8c78 }, // green-patina roof (source)
    entrances: 3,         // Art Deco entrance piers on the Queens Quay face (period detail, source)
    source: qqtSpec.source, sourceUrls: qqtSpec.sourceUrls,
    // honest labels the docs/tests read back
    basis: 'committed geodata rows 33202 (warehouse), 33204 (two-band + end-band addition, open courtyard), the small mapped rooftop rows, and the clock tower on the north-front rooftop structure (row 33203, a photo/map inference)'
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Camera verification (pure CPU; shared with the capture list and the tests). The wave-6 west-sign capture was blank:
// the camera stood inside / behind an unmapped building and could not see the sign. A camera is only trustworthy if it
// is OUTSIDE every landmark solid (oriented bounding box, OBB) and has direct line-of-sight (LOS) to the target point
// that no other landmark solid blocks. `layoutOBBs` is the CPU occupancy model: one OBB per built landmark solid
// (halls to their eaves, the tower, the QQT warehouse/addition/penthouses/clock, the unloader chassis) in world metres.
function layoutOBBs(layout) {
  const base = SW + 0.004;
  const out = [];
  const put = (name, p, y0, y1) => out.push({ name, cx: p.cx, cz: p.cz, ang: p.ang, halfW: p.halfW, halfD: p.halfD, y0, y1 });
  const rp = layout?.redpath;
  if (rp) {
    for (const h of rp.halls) put(`hall${h.row}:${h.kind}`, h, base, base + (h.pitch?.eaveH ?? Math.max(4, h.h - base)));
    if (rp.tower) put('tower', rp.tower, base, base + Math.max(4, rp.tower.h - base));
    if (rp.unloader) {
      const un = rp.unloader;
      put('unloader', { cx: un.x, cz: un.z, ang: un.ang, halfW: un.chassis[0] / 2, halfD: un.chassis[2] / 2 },
        base, base + un.chassis[1] + un.pedestalH + un.bodyH);
    }
  }
  const qqt = layout?.qqt;
  if (qqt) {
    put('qqtWarehouse', qqt.box, base, base + qqt.warehouseH);
    for (const p of qqt.additionParts) put('qqtAddition', p, base, base + p.h);
    for (const p of qqt.penthouses) put('qqtPenthouse', p, base, base + p.h);
    if (qqt.clockTower) put('qqtClock', qqt.clockTower, base, base + qqt.clockTower.topH);
  }
  return out;
}

// World (x, z) -> a box's local (u, v). The box is the same turned rectangle the builder extrudes.
function boxLocal(o, x, z) {
  const cs = Math.cos(o.ang), sn = Math.sin(o.ang);
  const dx = x - o.cx, dz = z - o.cz;
  return [dx * cs - dz * sn, dx * sn + dz * cs];
}
// Is a world point inside a box (its OBB), padded on every face?
function pointInOBB(o, x, y, z, pad = 0) {
  if (y < o.y0 - pad || y > o.y1 + pad) return false;
  const [u, v] = boxLocal(o, x, z);
  return Math.abs(u) <= o.halfW + pad && Math.abs(v) <= o.halfD + pad;
}
// Does the segment a->b pass through a box? A slab test in the box's local frame (u, v, y).
function segmentHitsOBB(o, a, b, pad = 0) {
  const A = boxLocal(o, a[0], a[2]), B = boxLocal(o, b[0], b[2]);
  let t0 = 0, t1 = 1;
  const axes = [
    [A[0], B[0] - A[0], -o.halfW - pad, o.halfW + pad],
    [A[1], B[1] - A[1], -o.halfD - pad, o.halfD + pad],
    [a[1], b[1] - a[1], o.y0 - pad, o.y1 + pad]
  ];
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let ta = (lo - p) / d, tb = (hi - p) / d;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}
// Clear line-of-sight from `pos` to the target, ignoring the surfaces closer than `ignoreDist` to the target (the sign
// plane itself, the mural plane).
function lineOfSight(obbs, pos, target, { ignoreDist = 0.35, pad = 0.02 } = {}) {
  const T = Array.isArray(target) ? target : [target.x, target.y, target.z];
  const dx = pos[0] - T[0], dy = pos[1] - T[1], dz = pos[2] - T[2];
  const L = Math.hypot(dx, dy, dz) || 1;
  const stop = [T[0] + dx * (ignoreDist / L), T[1] + dy * (ignoreDist / L), T[2] + dz * (ignoreDist / L)];
  for (const o of obbs) if (segmentHitsOBB(o, pos, stop, pad)) return { clear: false, blockedBy: o.name };
  return { clear: true, blockedBy: null };
}
// Verify a proposed camera: it must be OUTSIDE every landmark solid, and have direct LOS to the target. Returns the
// blocking solids so a rejected camera names why. Pure; no THREE, so the capture list and tests can both use it.
function verifyCamera(layout, camera, target, { ignoreDist = 0.35, pad = 0.02 } = {}) {
  const obbs = layoutOBBs(layout);
  const pos = [camera.x, camera.y, camera.z];
  const tgt = Array.isArray(target) ? target : [target.x, target.y, target.z];
  const inside = obbs.filter((o) => pointInOBB(o, pos[0], pos[1], pos[2], 0.05)).map((o) => o.name);
  const los = lineOfSight(obbs, pos, tgt, { ignoreDist, pad });
  return {
    ok: inside.length === 0 && los.clear,
    inside, clear: los.clear, blockedBy: los.blockedBy,
    pos, target: tgt, dist: +Math.hypot(pos[0] - tgt[0], pos[1] - tgt[1], pos[2] - tgt[2]).toFixed(2)
  };
}

// "REDPATH SUGAR" sign geometry, derived ONLY from source-photo PROPORTIONS (not measured), shared by the layout, the
// builder and the LOS helper so they can never drift. The source photo (research/redpath-west-sign.jpg) shows short,
// WIDE letters ~29 px high on a ~320 px visible wall, near the roof (~30 px below it): letter height ≈ 0.09 of the wall,
// so a ~28 m wall gives ~2.0-2.3 m caps — NOT the oversized ~4.4 m (0.16 of the wall) that stretched the text tall.
// The caps are broad capitals with a natural aspect, so the height is capped by the letter proportions (no condensed
// stretch), the 15-17 m one-line span is preserved (word block kept, wide font), and the top margin is ~1.5-2 m of roof.
function signDim(a, s) {
  const base = SW + 0.004;
  const wallH = Math.max(4, a.h - base);
  const height = Math.max(1.9, Math.min(wallH * 0.09, 2.3));    // ~2.0-2.3 m block capitals
  const topMargin = Math.min(2.0, Math.max(1.5, height * 0.8)); // ~1.5-2 m of brick under the roof line
  const width = s?.width || 15.6;                               // preserved 15-17 m one-line span (with the word gap)
  const y = base + wallH - topMargin - height / 2;
  return { base, wallH, width, height, topMargin, y };
}
// The world-space centre of the "REDPATH SUGAR" inscription: on the tall plant's west (-u) face, proud of the wall by
// the panel half-thickness (0.15 m), at the same height the builder places it. This is the LOS target for the sign views.
function signCenter(layout) {
  const s = layout?.redpath?.sign;
  if (!s || !s.anchor) return null;
  const a = s.anchor;
  const y = signDim(a, s).y;
  return [a.cx + s.normal[0] * (a.halfW + 0.15), y, a.cz + s.normal[1] * (a.halfW + 0.15)];
}
function muralCenter(layout) {
  const m = layout?.redpath?.mural;
  if (!m || !m.anchor) return null;
  const a = m.anchor, base = SW + 0.004;
  const wallH = Math.max(4, a.h - base);
  const y = base + Math.min(wallH * 0.54, wallH - m.height / 2 - 0.7);
  return [a.cx + m.normal[0] * (a.halfW + 0.15), y, a.cz + m.normal[1] * (a.halfW + 0.15)];
}

// Redpath Sugar: the mapped halls (their own mapped parts) inside the zone, the ship unloader anchored to the zone edge
// that fronts the mapped Jarvis Slip, and the numbered source-attested face features on the shed. The barrel silos and
// chimney stack have no mapped footprint and are not invented (reported unresolved). Returns null in an unrelated frame.
function layoutRedpath(G = C?.GEO, spec = REDPATH) {
  const zone = ringOf(G?.areas, 'zone:industrial', spec.zoneName);
  if (!zone) return null;
  const R = resolveComponents(G);
  if (!R) return null;
  const zb = ringBox(zone);
  // The mapped halls (rows resolved for the active frame), each as its own mapped part(s), inside the zone. Each part
  // carries a `kind` so the builder can give the raw-sugar shed, the long hall and the tall plants the right language
  // while still standing on the committed footprint. The annexes are claimed too: the wave-3 capture showed them as the
  // "huge blank tan generic boxes" the user rejected, and they are real refinery structures inside this zone.
  const halls = [];
  const addRow = (bi, kind) => {
    if (bi === null || bi === undefined) return;
    for (const p of rowParts(G?.buildings, bi)) {
      if (!pointInRing(zone, p.cx, p.cz)) continue;
      halls.push({ ...p, kind });
    }
  };
  addRow(R.longHall, 'rawstore');   // the major 166.8 x 47.4 m raw-store: big steep pitched roof in the photos
  addRow(R.shed, 'shed');
  for (const bi of R.plants) addRow(bi, 'plant');
  for (const bi of R.supports || []) addRow(bi, 'support');
  if (!halls.length) return null;
  // Pure pitch estimate per hall (shared by the builder and the tests): the mapped total height stays the RIDGE; the
  // eaves sit lower so the gable fits under the known height. Rise = ESTIMATE from the photo width proportion.
  const baseY = (C?.CITY_BOUNDS?.sidewalkHeight ?? SW) + 0.004;
  for (const h of halls) {
    const pitched = h.kind === 'shed' || h.kind === 'rawstore';
    const totalH = Math.max(4, h.h - baseY);
    let rise = 0, eaveH = totalH;
    if (pitched) {
      rise = Math.min(h.halfD * 0.42, totalH * 0.62);
      eaveH = Math.max(2.5, totalH - rise);
      rise = totalH - eaveH;
    }
    h.pitch = { pitched, totalH, rise, eaveH, ridgeH: totalH };
  }
  // the mapped quay-side utility/connector tower (two stacked rows at one centre), claimed so the generic residential
  // shader cannot draw it as a thin condo. Function unresolved. Model one shaft on the mapped 7.0 x 6.2 m footprint.
  let tower = null;
  const towerRow = R.tower !== null && R.tower !== undefined ? R.tower : R.towerBase;
  if (towerRow !== null && towerRow !== undefined) {
    const tp = rowParts(G?.buildings, towerRow);
    if (tp.length) {
      tower = tp.reduce((m, p) => (!m || p.halfW * p.halfD > m.halfW * m.halfD ? p : m), null);
      tower = { ...tower, row: towerRow };
    }
  }
  // the tallest mapped part is the plant (Building 1, eight floors); the low long part is the shed/hall
  const tallest = halls.reduce((m, h) => (h.h > m.h ? h : m), halls[0]);
  const shedParts = halls.filter((h) => h.kind === 'shed');
  const plantParts = halls.filter((h) => h.kind === 'plant');
  // Face features (wave-6 source correction):
  //  - The surviving west "REDPATH SUGAR" sign is a one-line red block-capital inscription on a pale-brick TALL PLANT
  //    wall (captain's photo inspection of acotoronto.ca RedpathSugarRefinery4.jpg), NOT on the shed and NOT a
  //    maroon/cream board. It is anchored to the tallest mapped plant part, whose local -u normal points west.
  //  - The Wyland whale mural is on the Raw Sugar Shed's north wall (Wikipedia), i.e. the shed's -u face.
  // Faces come from the mapped turn; the sign's size/ink are estimates (see docs/waterfront-landmarks.md §7).
  const plantAnchor = plantParts.reduce((m, h) => (!m || h.h > m.h ? h : m), null);
  const shedAnchor = shedParts.reduce((m, h) => (!m || h.halfW * h.halfD > m.halfW * m.halfD ? h : m), null);
  let sign = null, mural = null;
  if (plantAnchor) {
    const pCS = Math.cos(plantAnchor.ang), pSN = Math.sin(plantAnchor.ang);
    // 15-17 m one-line span on the mapped west face (source photo proportion), NOT a 30 m stretch.
    const signW = Math.max(15, Math.min(plantAnchor.halfD * 2 * 0.82, 17));
    const dims = signDim(plantAnchor, { width: signW });
    sign = {
      face: 'west', localFace: '-u',
      normal: [-pCS, pSN],                     // -u world normal (≈ west / -x for this mapped turn)
      offset: plantAnchor.halfW, width: signW, height: dims.height,
      y: dims.y, topMargin: dims.topMargin,    // placement shared with signCenter/builder (photo-proportional)
      text: spec.signage?.signText || 'REDPATH SUGAR',
      ink: spec.signage?.signInk || '#9e1b1b',
      seams: 3,                                // three vertical shallow seams on the pale sign wall (photo)
      anchor: { cx: plantAnchor.cx, cz: plantAnchor.cz, ang: plantAnchor.ang, halfW: plantAnchor.halfW, halfD: plantAnchor.halfD, h: plantAnchor.h }
    };
  }
  if (shedAnchor) {
    const sCS = Math.cos(shedAnchor.ang), sSN = Math.sin(shedAnchor.ang);
    const wallH = Math.max(4, shedAnchor.h - (C?.CITY_BOUNDS?.sidewalkHeight ?? SW));
    const muralW = Math.min(shedAnchor.halfD * 1.6, 42);
    const muralH = Math.min(wallH * 0.72, 6.4);
    mural = {
      face: 'north', localFace: '-u',
      normal: [-sCS, sSN],                     // -u world normal (≈ north / -z for this mapped turn)
      offset: shedAnchor.halfW, width: muralW, height: muralH,
      anchor: { cx: shedAnchor.cx, cz: shedAnchor.cz, ang: shedAnchor.ang, halfW: shedAnchor.halfW, halfD: shedAnchor.halfD, h: shedAnchor.h }
    };
  }
  const initial = {
    id: spec.id, name: spec.name, address: 'Queens Quay E at Jarvis St', zone, zoneBox: zb,
    halls, plant: tallest, plantAnchor, shed: shedAnchor, shedParts, sign, mural, tower,

    signage: spec.signage
  };

  // ---- ship unloader + wharf: anchored to the zone edge that actually abuts the mapped "Jarvis Slip" water polygon
  // (the slip the refinery fronts, with Canada's Sugar Beach on its far shore). The boom heads out over that water. The
  // base position is a real zone/water boundary from the committed geodata, never a heuristic scattered point.
  let unloader = null, wharf = null;
  const slip = ringOf(G?.areas, 'water', 'Jarvis Slip');
  {
    // score every zone edge by how closely it runs along the Jarvis Slip ring (the edge that shares the boundary)
    let best = null, bestScore = Infinity;
    for (let i = 0, j = zone.length - 1; i < zone.length; j = i++) {
      const a = zone[j], b = zone[i];
      // sample the edge; the edge hugging the slip has its samples close to the slip ring
      let dsum = 0, n = 0;
      for (let t = 0.1; t <= 0.9; t += 0.1) {
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        dsum += slip ? distanceToRing(slip, x, z) : Infinity; n++;
      }
      const score = dsum / n;
      if (score < bestScore) { bestScore = score; best = { a, b, score }; }
    }
    // a zone edge within ~6 m of the mapped slip is a genuine water frontage; otherwise there is no verifiable berth
    if (best && bestScore < 6) {
      const a = best.a, b = best.b, dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      let nx = dz / L, nz = -dx / L; // edge normal
      const zcx = (zb.minX + zb.maxX) / 2, zcz = (zb.minZ + zb.maxZ) / 2;
      if ((zcx - mx) * nx + (zcz - mz) * nz > 0) { nx = -nx; nz = -nz; } // outward, toward the slip
      // the material handler sits on the dock ~2 m inside the quay edge; its boom reaches out over the slip
      unloader = { x: mx - nx * 2, z: mz - nz * 2, ang: Math.atan2(nx, nz), ...spec.unloader };
      wharf = { x: mx, z: mz, len: L, ang: Math.atan2(dx, dz), slip: true, gapM: +bestScore.toFixed(1) };
    }
  }
  // ---- the Raw Sugar Shed face features (north whale mural, west "Redpath Sugar" sign) are placed on the mapped shed
  // in buildRedpath; the barrel silos and chimney stack are NOT modelled here because the committed geodata has no
  // footprint for them and no verifiable position (reported as unresolved in docs/waterfront-landmarks.md).
  return {
    ...initial, unloader, wharf,
    supports: (R.supports || []).length,
    unresolved: ['barrel-silo battery (no mapped footprint)', 'chimney stack (no mapped footprint)'],
    // Photo/geospatial INFERENCE, not a text-confirmed building-function record:
    inferences: {
      longHall: 'row 34614 (166.8 x 47.4 m) is inferred from the large steep pitched roof behind the green unloader on the Jarvis Slip to be the major raw-sugar store; no text source names the function',
      tower: 'rows 34612/34613 are a zone-confirmed industrial structure; its function (connector/elevator/utility) is unresolved'
    },
    source: spec.source, sourceUrls: spec.sourceUrls
  };
}

// The rows this module replaces (for the captain's exclusion hook), resolved for the ACTIVE frame. Only the rows the
// module actually draws over are claimed — the QQT warehouse/addition/penthouses/clock and the Redpath halls. Because
// these are resolved by name+centre+height, the set is correct in detail AND in the default eglinton frame, and can
// never suppress an unrelated building.
function excludedRows(G = C?.GEO) {
  const rows = new Set();
  const R = resolveComponents(G);
  if (!R) return rows;
  for (const bi of [R.warehouse, R.addition, R.clock, R.longHall, R.shed, ...R.plants, ...(R.supports || []), R.tower, R.towerBase, ...R.penthouses]) {
    if (bi !== null && bi !== undefined) rows.add(bi);
  }
  return rows;
}

function waterfrontLandmarksLayout({ geo = C?.GEO } = {}) {
  if (!supportedCityFrame(geo)) return { landmarks: [], qqt: null, redpath: null, supported: false };
  const qqt = layoutQQT(geo);
  const redpath = layoutRedpath(geo);
  const landmarks = [];
  if (qqt) landmarks.push(qqt);
  if (redpath) landmarks.push(redpath);
  return { landmarks, qqt, redpath, supported: true, excludedRows: [...excludedRows(geo)] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry (THREE). Shared materials/geometry; one merged shell per landmark plus instanced repeated parts (silo,
// chimney, warehouse bays), all parented to one culling-friendly root.
// ---------------------------------------------------------------------------------------------------------------------
function boxGeo(THREE, w, h, d, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  return g.translate(x, y, z);
}
// mergeGeometries needs a uniform, non-indexed, same-attribute set: our parts mix ExtrudeGeometry (non-indexed) with
// BoxGeometry / CylinderGeometry (indexed), so each is converted to non-indexed and reduced to position/normal/uv
// before merging. This is the fix for the integrated-runtime failure ("Cannot convert undefined or null to object":
// the extruded helper returns a Mesh, so `.geometry` is taken at the call site and the parts are true geometries here).
function merge(THREE, geos) {
  const mergeGeometries = C?.Addons?.mergeGeometries;
  if (!mergeGeometries) throw new Error('waterfront-landmarks: CITY.Addons.mergeGeometries is required');
  const norm = [];
  for (const g of geos) {
    if (!g || !g.attributes) throw new Error('waterfront-landmarks: a non-geometry reached merge (take .geometry)');
    const n = g.index ? g.toNonIndexed() : g;
    for (const key of Object.keys(n.attributes)) if (key !== 'position' && key !== 'normal' && key !== 'uv') n.deleteAttribute(key);
    if (!n.attributes.normal) n.computeVertexNormals();
    if (!n.attributes.uv) {
      const count = n.attributes.position.count;
      n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    norm.push(n);
    if (n !== g) g.dispose?.();
  }
  const out = mergeGeometries(norm, false);
  for (const n of norm) n.dispose?.();
  return out;
}
function standardMaterial(THREE, params) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat(params);
}
// The Redpath plant skin is real pale-grey BRICK, not a flat cream shell that the sun washes to featureless white. The
// base colour `base` (≈ 0xa7aaa4, the captain's target; well below the near-white 0xd6cfc0 that blew out) is modulated
// by a TSL node graph keyed to the extruded wall's own metre-scale UVs (u: metres along the wall, v: metres up from its
// foot — the ExtrudeGeometry uv contract): running-bond COURSE beds, staggered vertical head joints, and vertical
// weathering streaks. The joint lines are filter-width anti-aliased with fwidth (the same technique the repo's
// pre-war brick uses), so they never shimmer at grazing angles or blend into a flat white in the distance. All shading
// is a bounded multiplicative darkening of the base, so the wall reads as pale grey brick and cannot be driven to white.
// The TSL node functions live on `window.CITY.TSL` (the imported `three/tsl` module), NOT on THREE. When that (or the
// node material class) is absent — plain WebGL fallback or Node tests — it returns a flat MeshStandardMaterial at the
// darker brick base; no canvas is created and nothing is fetched.
// Course/head sizes are the photo-based TYPOLOGY (captain's source inspection): fine, subtle brick, a course ~0.08-0.10 m
// high and ~0.24-0.30 m long with a ~8 mm mortar joint — NOT oversized 0.28 x 0.62 cinder blocks. The joint contrast is
// likewise SUBTLE (~0.08 darkening, not 0.30) so the wall reads as pale brick from across the slip with the coursing
// only just visible up close. fwidth AA in gridLine already fades that fine pattern out where a course sub-tends less
// than a pixel (distance / grazing), so the far wall stays smooth instead of aliasing into a grid.
const BRICK_TYPOLOGY = { base: 0xa7aaa4, brickH: 0.095, brickL: 0.27, jointW: 0.008, jointDark: 0.08 };
function brickMaterial(THREE, { base = BRICK_TYPOLOGY.base, brickH = BRICK_TYPOLOGY.brickH, brickL = BRICK_TYPOLOGY.brickL, jointW = BRICK_TYPOLOGY.jointW, jointDark = BRICK_TYPOLOGY.jointDark, roughness = 0.93 } = {}) {
  const color = new THREE.Color(base);
  const params = { color, roughness, metalness: 0.0 };
  const Mat = THREE.MeshStandardNodeMaterial;
  const T = C?.TSL;
  if (!Mat) return new (THREE.MeshStandardMaterial || function () {})(params);
  const mat = new Mat(params);
  if (!T || !T.Fn || !T.attribute || !T.positionWorld || !T.fwidth) return mat;   // node API absent: flat darker base
  try {
    const { Fn, vec2, vec3, float, attribute, positionWorld, fract, floor, mod, mix, max, min, smoothstep, fwidth, abs } = T;
    // one anti-aliased repeating line: ~1 on the joint, ~0 on the brick face (float-period over [0,1])
    const gridLine = Fn(([coord, period, hw]) => {
      const g = float(coord).div(period).toVar();
      const d = float(0.5).sub(abs(fract(g).sub(0.5))).toVar();
      const aa = fwidth(g).max(0.0001).toVar();
      const effHw = max(float(hw).div(period), aa.mul(0.5)).toVar();
      const cov = smoothstep(effHw.add(aa), effHw.sub(aa), d);
      return cov.mul(min(float(1.0), float(hw).div(period).div(effHw)));
    });
    mat.colorNode = Fn(() => {
      const uv = attribute('uv', 'vec2');      // extruded wall: x = metres along, y = metres up
      const rowCoord = uv.y.div(brickH);
      const courseRow = floor(rowCoord);
      const colCoord = uv.x.div(brickL).add(mod(courseRow, 2.0).mul(0.5));   // running bond: every course staggered
      const course = gridLine(rowCoord.mul(brickH), brickH, jointW);
      const head = gridLine(colCoord.mul(brickL), brickL, jointW);
      const mortar = max(course, head);
      // vertical weathering: faint darker streaks that calm down where the wall turns (use world XZ)
      const wxz = positionWorld.xz;
      const streak = fract(wxz.x.add(wxz.y).mul(0.18)).sub(0.6).max(0.0).mul(0.04);
      const grime = fract(wxz.x.mul(0.4).add(wxz.y.mul(0.11))).sub(0.65).max(0.0).mul(0.03);
      const shade = float(1.0).sub(mortar.mul(jointDark)).sub(streak).sub(grime);   // bounded: subtle joint, no > 1
      return vec3(color.r, color.g, color.b).mul(shade);
    })();
  } catch (e) {
    return mat; // any TSL mismatch falls back to the flat base rather than throwing
  }
  return mat;
}
// three.js Color -> linear rgb array (the createFacadeBoxes paint attribute wants linear rgb + a style w)
function linear(THREE, hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
// An extruded solid from a turned-rect footprint, as a GEOMETRY in world space. Takes .geometry when the city-grid
// helper is present (its contract returns a Mesh), else builds a box geometry. Never returns a Mesh, so the merge above
// always receives geometries — the integrated-runtime bug the tests must cover with the real (Mesh-returning) helper.
function extrudeRect(THREE, p, y0, h, inset = 0.05) {
  const pts = turnedRectPts({ cx: p.cx, cz: p.cz, ang: p.ang, halfW: p.halfW, halfD: p.halfD }, inset);
  if (typeof C?.createExtrudedPolygonMesh === 'function') {
    const made = C.createExtrudedPolygonMesh(pts, y0, h, null, true, true);
    const geo = made && made.isMesh ? made.geometry : made;
    if (geo && geo.attributes && geo.attributes.position) return geo;
    throw new Error('waterfront-landmarks: createExtrudedPolygonMesh returned no geometry');
  }
  return boxGeo(THREE, p.halfW * 2, h, p.halfD * 2, p.cx, y0 + h / 2, p.cz, p.ang);
}

// A turned box outline as a flat polygon for an extruded solid (keeps the surveyed footprint exactly).
function turnedRectPts(box, inset = 0) {
  const cs = Math.cos(box.ang), sn = Math.sin(box.ang);
  const hw = box.halfW - inset, hd = box.halfD - inset;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  return corners.map(([u, v]) => ({ x: box.cx + u * cs + v * sn, z: box.cz - u * sn + v * cs }));
}

// A square-section strut from world point a to b (steel members: A-frame legs, crane boom/stick, rams). Returns a
// geometry in world space; merged with the rest.
function strut(THREE, a, b, t) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz) || 1e-6;
  const g = new THREE.BoxGeometry(t, t, len);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx / len, dy / len, dz / len));
  g.applyQuaternion(q);
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

// A steep gable roof over a turned-rect footprint part `p`, ridge along its long (u) axis, eaves at the wall top y0,
// ridge at y0+rise. Built in world space, non-indexed triangles with positions/normals/uv (merge-safe). This gives the
// raw-sugar shed its big pitched silhouette; the geodata roof code is flat (0), so the pitch is estimated from the photo.
function gableRoofGeometry(THREE, p, y0, rise, inset = 0.1) {
  const cs = Math.cos(p.ang), sn = Math.sin(p.ang);
  const hw = p.halfW - inset, hd = p.halfD - inset, yR = y0 + rise;
  const W = (u, v, y) => [p.cx + u * cs + v * sn, y, p.cz - u * sn + v * cs];
  // eave corners (v = ±hd) and ridge ends (v = 0)
  const nA = W(-hw, -hd, y0), nB = W(hw, -hd, y0);   // north eave (local -v)
  const sA = W(-hw, hd, y0), sB = W(hw, hd, y0);     // south eave (local +v)
  const rA = W(-hw, 0, yR), rB = W(hw, 0, yR);       // ridge ends (local ±u)
  const tri = [];
  const push = (...vs) => { for (const v of vs) tri.push(v[0], v[1], v[2]); };
  // WINDING (was inverted: both slopes faced DOWN — y < 0 in the cross product — so the roof rendered inside-out
  // and the shader backface/stipple read as a blue moiré). The order below was proven by the triangle cross products:
  //   north slope (nA,rA,rB)+(nA,rB,nB) -> normal ~(-35, +100, -114): points UP and toward local -v (north)
  //   south slope (sA,sB,rB)+(sA,rB,rA) -> normal ~(+35, +100, +114): points UP and toward local +v (south)
  //   gable -u end (nA,sA,rA) -> outward local -u; gable +u end (nB,rB,sB) -> outward local +u
  // Two sloped planes (up-facing) as quads -> triangles:
  push(nA, rA, rB); push(nA, rB, nB);
  push(sA, sB, rB); push(sA, rB, rA);
  // Two gable-end triangles (closed ends, facing out of the roof):
  push(nA, sA, rA); push(nB, rB, sB);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  // Planar UVs in the footprint's own metre frame so any wall/roof texture (and the plane orientation) maps sanely:
  // u along the ridge, v across the slope. The seam ribs are separate struts, but a real uv avoids degenerate mapping.
  const uv = [];
  for (let i = 0; i < tri.length; i += 3) {
    const x = tri[i], z = tri[i + 1];
    const lu = (x - p.cx) * cs - (z - p.cz) * sn;   // local u (along ridge)
    const lv = (x - p.cx) * sn + (z - p.cz) * cs;   // local v (across, toward ±eave)
    uv.push(lu, lv);
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// The "REDPATH SUGAR" inscription as a THREE texture, when a browser canvas is available. Returns null in Node (tests)
// so the caller falls back to a plain ink-coloured panel — never throws. Form from the captain's photo inspection of
// acotoronto.ca RedpathSugarRefinery4.jpg: ONE LINE, red/burgundy raised sans-serif block capitals set directly on the
// pale-brick wall, no signboard, no border. The source letters are BROAD capitals with a natural aspect, so the font is
// a normal-width bold sans (never a condensed/narrow face that reads tall and stretched). The exact typeface is an
// approximation; the wording, the ink family and the short-wide proportions are sourced, the letterforms are not measured.
function makeSignTexture(THREE, text, { w = 1024, h = 192, ink = '#9e1b1b' } = {}) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  try {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, w, h);                 // transparent ink: the pale brick shows between/around the letters
    const upper = String(text).trim().toUpperCase();
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = Math.round(h * 0.82);
    do { ctx.font = `700 ${size}px Arial, Helvetica, sans-serif`; size -= 2; }
    while (size > 10 && ctx.measureText(upper).width > w * 0.90);
    ctx.fillText(upper, w / 2, h * 0.5);
    const tex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  } catch { return null; }
}

// The sign material: a transparent lettering plane (letters only, raised a few cm off the wall) when a canvas texture is
// available, else a plain ink-coloured panel. `transparent` uses the repo's ferry-label convention (MeshBasicMaterial
// with a transparent map) so the lettering stays legible regardless of the sun.
function signMaterial(THREE, tex, { ink = 0x9e1b1b, transparent = false } = {}) {
  if (tex && transparent && THREE.MeshBasicMaterial) {
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.FrontSide ?? 0 });
    return m;
  }
  const TSL = C?.TSL;
  if (tex && TSL && TSL.texture && TSL.uv) {
    const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
    const m = new Mat({ roughness: 0.6 });
    m.colorNode = TSL.texture(tex, TSL.uv());
    return m;
  }
  return standardMaterial(THREE, { color: ink, roughness: 0.62, metalness: 0.02 });
}

function addBoxCollider(colliders, cx, cz, hw, hd, ang, minY, maxY, kind) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const ex = Math.abs(cs) * hw + Math.abs(sn) * hd, ez = Math.abs(sn) * hw + Math.abs(cs) * hd;
  colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY, prop: false, kind, obb: { cx, cz, hx: hw, hz: hd, cs, sn } });
}

// QQT: the merged cream shell = the mapped warehouse block (31 m) + the mapped addition parts (two perimeter bands + end
// band, 43 m, open courtyard between them) + the small mapped rooftop structures + the clock tower + Art Deco entrance
// piers. On top, as bounded merged meshes: the GREEN mullion/transom frame + dark multi-pane glazing over the cream
// warehouse skin, the PALE-GREEN projecting balcony/glazing banks on the addition bands, and the flat GREEN roof edge
// (captain's Zeidler-photo reading; see docs/waterfront-terminal-refinement.md). Every solid is a mapped footprint part.
function buildQQT(THREE, layout, group, colliders, stats) {
  const box = layout.box;
  const base = SW + 0.004;
  const hWare = layout.warehouseH - base;
  const cs = Math.cos(box.ang), sn = Math.sin(box.ang);
  const toWorld = (u, v) => [box.cx + u * cs + v * sn, box.cz - u * sn + v * cs];
  // extrudeRect always returns a GEOMETRY (takes .geometry from the city-grid Mesh helper) so merge() is safe
  const extrude = (p, y0, h) => extrudeRect(THREE, p, y0, h);

  const parts = [];
  // the eight-storey warehouse block (mapped 140 x 61.4 m, 31 m)
  parts.push(extrude(box, base, hWare));
  // the 1983 addition: each mapped perimeter band from row 33204, from the warehouse roof to its mapped 43 m, leaving
  // the open courtyard between the bands (no solid middle — matching the source's open lightwells)
  for (const p of layout.additionParts) {
    const h = Math.max(0.5, p.h - base - hWare);
    parts.push(extrude(p, base + hWare, h));
  }
  // the small mapped rooftop structures (penthouses / stair cores, 43-46 m) at their mapped centres
  for (const p of layout.penthouses) {
    const h = Math.max(0.5, p.h - base - hWare);
    parts.push(extrude(p, base + hWare, h));
  }
  // The flat GREEN roof edge at the warehouse eaves (captain's photo: "flat green roof edge"). A projecting green band
  // with its OWN material (WaterfrontLandmarks_QQT_Cornice), not chained into the cream shell: the old build merged a green
  // box into the cream shell, so the green read was lost to the shell's cream colour. This is the flat parapet / roof-edge
  // band, not a sloped green-patina cap (the 1983 reclad does not show a pitched cap at this line).
  const cH = layout.cornice.h, cOver = layout.cornice.overhang;
  // Art Deco entrance piers on the Queens Quay (NORTH) face. The warehouse yaw is ~-pi/2, so north is the short -u face
  // (world -z), NOT the -v face (which is world +x, east). We spread the piers along the SHORT north face's width (2*halfD)
  // and stand them off the -u wall. (period detail, merged into the cream shell — cream, not green.)
  const entrances = layout.entrances || 3;
  for (let i = 0; i < entrances; i++) {
    const along = (-0.5 + (i + 0.5) / entrances) * (box.halfD * 2);   // spread across the short north face
    const [ex, ez] = toWorld(-box.halfW - 0.35, along);               // -u face (north), offset outward
    parts.push(boxGeo(THREE, 1.0, 4.2, 1.4, ex, base + 2.1, ez, box.ang));
    parts.push(boxGeo(THREE, 1.1, 0.5, 2.2, ex, base + 4.35, ez, box.ang));
  }
  // the QQT clock tower (source photo: cream narrow Art Deco vertical ribs, flat stepped parapet, two black clock
  // faces near the top, a flagpole; no pyramidal cap), rising above the mapped rooftop structure on the north face
  const clock = layout.clockTower;
  if (clock) {
    const ch = clock.topH - clock.baseH;
    const ccs = Math.cos(clock.ang), csn = Math.sin(clock.ang);
    const cToW = (u, v) => [clock.cx + u * ccs + v * csn, clock.cz - u * csn + v * ccs];
    // the ribbed shaft: a slim square tower with fine vertical piers on all four faces
    const shaftH = ch * 0.82;
    parts.push(boxGeo(THREE, clock.halfW * 2, shaftH, clock.halfD * 2, clock.cx, base + clock.baseH + shaftH / 2, clock.cz, clock.ang));
    // the ribs (thin cream piers proud of each face) — narrow Art Deco verticals
    const ribT = 0.18, ribOut = 0.14;
    for (let f = 0; f < 4; f++) {
      const along = f < 2; // ribs run up the long faces
      const n = clock.ribs;
      for (let k = 0; k < n; k++) {
        const t = (-0.5 + (k + 0.5) / n);
        const [rx, rz] = along
          ? cToW(t * clock.halfW * 2, (f === 0 ? -1 : 1) * (clock.halfD + ribOut))
          : cToW((f === 2 ? -1 : 1) * (clock.halfW + ribOut), t * clock.halfD * 2);
        parts.push(boxGeo(THREE, along ? ribT : 0.1, shaftH, along ? 0.1 : ribT, rx, base + clock.baseH + shaftH / 2, rz, clock.ang));
      }
    }
    // a flat stepped parapet (two shallow setbacks at the top; NO pyramid)
    parts.push(boxGeo(THREE, clock.halfW * 2 + 0.5, 0.7, clock.halfD * 2 + 0.5, clock.cx, base + clock.baseH + shaftH + 0.35, clock.cz, clock.ang));
    parts.push(boxGeo(THREE, clock.halfW * 1.5, 0.5, clock.halfD * 1.5, clock.cx, base + clock.baseH + shaftH + 0.9, clock.cz, clock.ang));
    // NOTE: the black clock faces and their white ticks/hands are built as their OWN dark/white meshes AFTER the shell
    // merge (below), so they are genuinely black — the first drafts merged them into the cream shell and they never read.
    // the cresting + flagpole above
    parts.push(boxGeo(THREE, 0.16, 3.2, 0.16, clock.cx, base + clock.topH + 1.6, clock.cz, clock.ang));
    parts.push(boxGeo(THREE, 1.4, 0.9, 0.08, clock.cx + 0.7 * ccs, base + clock.topH + 2.6, clock.cz - 0.7 * csn, clock.ang)); // pennant
  }

  const shell = new THREE.Mesh(merge(THREE, parts), standardMaterial(THREE, { color: 0xc9bea8, roughness: 0.86, metalness: 0.02 }));
  shell.castShadow = true; shell.receiveShadow = true;
  shell.userData.cullDistance = 1400; shell.userData.cullCell = 200;
  if (shell.geometry.computeBoundingSphere) shell.geometry.computeBoundingSphere();
  shell.name = 'WaterfrontLandmarks_QQT_Shell';
  group.add(shell);
  stats.meshes++;

  // ---------------- the clock DIALS: their own BLACK faces + WHITE ticks/hands (never merged into the cream shell) -----
  // The captain's photo (shot SE from the NW) shows dials on the NORTH (world -z) and WEST (world -x) faces only. For each
  // such face we build a black disc standing proud of that wall, a white minute ring, twelve white hour ticks and two hands,
  // as two merged meshes (dial = dark; detail = white). Restrained sizes; the clock dial is a documented estimate.
  const clockDetail = { dial: [], white: [] };
  if (clock && clock.faces && clock.faces.length) {
    const rDial = Math.min(clock.halfW, clock.halfD) * 0.38;  // photo-proportional estimate, below the shaft parapet
    const yDial = base + clock.baseH + (clock.topH - clock.baseH) * 0.72;
    for (const [nx, nz] of clock.faces) {
      // the dial centre, standing just proud of the shaft wall in the face's outward normal direction
      const wallDepth = Math.abs(nx) > 0.5 ? clock.halfW : clock.halfD;    // how far the wall is out along the face normal
      const proud = wallDepth + 0.30; // clear the projecting cream ribs instead of drawing a striped dial
      const dx = clock.cx + nx * proud;
      const dz = clock.cz + nz * proud;
      // in-plane basis on the wall: `ax` runs across the face (perpendicular to the normal, horizontal), `ay` is world up.
      // Rotating a disc about Y by `faceYaw` (= atan2(nx,nz)) turns its +z face toward the outward normal.
      const faceYaw = Math.atan2(nx, nz);
      const ax = [Math.cos(faceYaw), -Math.sin(faceYaw)];  // across-face unit vector in world XZ
      // black disc, its flat face toward the outward normal
      const disc = new THREE.CylinderGeometry(rDial, rDial, 0.10, 24);
      disc.rotateX(Math.PI / 2);          // axis along local +z (disc faces ±z), then turned by faceYaw below
      disc.rotateY(faceYaw);
      clockDetail.dial.push(disc.translate(dx, yDial, dz));
      const off = 0.09;                    // white detail sits just proud of the black disc along the normal
      const wx = dx + nx * off, wz = dz + nz * off;
      // twelve white hour ticks on the dial plane (across-face a, up h)
      for (let hk = 0; hk < 12; hk++) {
        const th = (hk / 12) * Math.PI * 2;
        const a = Math.cos(th) * rDial * 0.82, h = Math.sin(th) * rDial * 0.82;
        clockDetail.white.push(boxGeo(THREE, 0.10, 0.10, 0.03, wx + ax[0] * a, yDial + h, wz + ax[1] * a, faceYaw));
      }
      // hour hand (up, short) and minute hand (~2 o'clock), thin boxes on the dial plane
      clockDetail.white.push(boxGeo(THREE, 0.09, rDial * 0.5, 0.03, wx, yDial + rDial * 0.25, wz, faceYaw));
      const mAng = Math.PI / 3, ma = Math.cos(mAng) * rDial * 0.42, mh = Math.sin(mAng) * rDial * 0.42;
      const minute = new THREE.BoxGeometry(0.07, rDial * 0.84, 0.03);
      minute.rotateZ(-Math.PI / 6).rotateY(faceYaw);
      clockDetail.white.push(minute.translate(wx + ax[0] * ma, yDial + mh, wz + ax[1] * ma));
    }
  }
  if (clockDetail.dial.length) {
    const dial = new THREE.Mesh(merge(THREE, clockDetail.dial), standardMaterial(THREE, { color: 0x0d0f10, roughness: 0.45, metalness: 0.05 }));
    dial.name = 'WaterfrontLandmarks_QQT_ClockDial';
    dial.castShadow = false; dial.receiveShadow = true;
    dial.userData.cullDistance = 1400; dial.userData.cullCell = 200;
    if (dial.geometry.computeBoundingSphere) dial.geometry.computeBoundingSphere();
    group.add(dial); stats.meshes++;
  }
  if (clockDetail.white.length) {
    const hands = new THREE.Mesh(merge(THREE, clockDetail.white), standardMaterial(THREE, { color: 0xf2efe6, roughness: 0.6, metalness: 0.0 }));
    hands.name = 'WaterfrontLandmarks_QQT_ClockHands';
    hands.castShadow = false; hands.receiveShadow = true;
    hands.userData.cullDistance = 1400; hands.userData.cullCell = 200;
    if (hands.geometry.computeBoundingSphere) hands.geometry.computeBoundingSphere();
    group.add(hands); stats.meshes++;
  }

  // ---------------- QQT facade: explicit green frame + dark glass cells + cream spandrels/piers ----------------
  // The captain rejected BOTH the old shared punched-window shader (a bland white grid) AND the first green draft
  // (full-height continuous glass panels that overlaid the shader and read as doubled, inconsistent floors, with fins on
  // the short faces). The real warehouse bays are HORIZONTAL CREAM SPANDRELS between DARK GLAZING FLOOR CELLS in a GREEN
  // frame, so we build that explicitly, bounded and merged (no per-window objects, no shared shader grid):
  //   - dark glass CELLS, one per bay per storey (~8 storeys), recessed just proud of the cream wall;
  //   - GREEN vertical mullions at each bay edge + a green transom at each cell head/sill;
  //   - CREAM spandrel bands between the storeys and CREAM piers between the bays, in their OWN merged cream mesh so they
  //     are actually in the scene (the first draft pushed piers into `parts` AFTER the shell merge, so they never rendered).
  // Every panel is rotated to its OWN face (yaw from the face's along vector), so nothing crosses the wall as a fin.
  // Bay width, storey height, spandrel/mullion/pier sizes and the glass tint are ESTIMATES (see the refinement doc).
  const F = layout.frame || {};
  const bayWinW = F.bayWindowW ?? 3.6, bayFloorH = F.bayFloorH ?? 3.9;
  const barT = F.frameBarT ?? 0.11, pierW = F.pierW ?? 1.0, spandrelH = F.spandrelH ?? 1.15;
  const glassProud = 0.05, frameProud = 0.13, creamProud = 0.10;
  const FACE_DEFS = [
    { face: '-v', len: box.halfW * 2, half: box.halfD, along: [cs, -sn], nrm: [sn, cs] },   // north (Queens Quay)
    { face: '+v', len: box.halfW * 2, half: box.halfD, along: [cs, -sn], nrm: [-sn, -cs] },  // south (harbour)
    { face: '-u', len: box.halfD * 2, half: box.halfW, along: [sn, cs], nrm: [-cs, sn] },    // west
    { face: '+u', len: box.halfD * 2, half: box.halfW, along: [sn, cs], nrm: [cs, -sn] }     // east
  ];
  // The box yaw that aligns a panel's WIDTH (local +x) with the face's along vector. For the ±v faces this equals box.ang;
  // for the ±u faces it is box.ang ∓ 90° — the fix for the perpendicular "fins" the captain saw on the short faces.
  const faceYaw = (fd) => Math.atan2(-fd.along[1], fd.along[0]);
  const faceAt = (fd, along, off) => [box.cx + fd.along[0] * along + fd.nrm[0] * off, box.cz + fd.along[1] * along + fd.nrm[1] * off];
  const panel = (fd, along, y, w, h, proud, th) => {
    const [px, pz] = faceAt(fd, along, fd.half + proud);
    return boxGeo(THREE, w, h, th, px, y, pz, faceYaw(fd));
  };
  const whGlass = [], whFrame = [], whCream = [];
  let greenBays = 0, greenCells = 0;
  const floors = Math.max(1, Math.round((hWare - 0.8) / bayFloorH));   // ~8 storeys over the mapped 31 m
  const storeyPitch = (hWare - 1.0) / floors; // fit all eight levels rather than silently dropping the top row
  for (const fd of FACE_DEFS) {
    const usable = fd.len - 2 * pierW;                       // cream piers at both ends
    const nBays = Math.max(1, Math.round(usable / (bayWinW + pierW)));
    const bayPitch = usable / nBays;
    const winW = Math.max(1.2, bayPitch - pierW);            // glass bay width inside the piers
    const cellH = Math.max(1.0, storeyPitch - spandrelH);   // dark glazing cell height (spandrel above it)
    for (let b = 0; b < nBays; b++) {
      const uBay = -usable / 2 + (b + 0.5) * bayPitch;       // bay centre along the wall
      greenBays++;
      for (let f = 0; f < floors; f++) {
        const yCell = base + 0.5 + f * storeyPitch + cellH / 2;
        if (yCell + cellH / 2 > base + hWare - 0.3) break;
        greenCells++;
        // dark glass cell (recessed just proud of the cream wall)
        whGlass.push(panel(fd, uBay, yCell, winW, cellH, glassProud, 0.10));
        // green head transom at the cell top (the sill curb is shared with the cream spandrel below, so no second bar)
        whFrame.push(panel(fd, uBay, yCell + cellH / 2, winW, barT, frameProud, 0.16));
        // cream spandrel band between this storey and the next (the horizontal cream read)
        whCream.push(panel(fd, uBay, yCell + cellH / 2 + spandrelH / 2, winW, spandrelH, creamProud, 0.18));
      }
      // green vertical mullions at the bay edges (full height)
      for (const s of [-1, 1]) whFrame.push(panel(fd, uBay + s * (winW / 2 - barT / 2), base + hWare / 2, barT, hWare - 0.6, frameProud, 0.16));
    }
    // cream piers between/around the bays (structural frame) — own merged cream geometry, actually in the scene
    for (let k = 0; k <= nBays; k++) {
      const up = -usable / 2 + k * bayPitch;
      whCream.push(panel(fd, up, base + hWare / 2, pierW, hWare - 0.4, creamProud, 0.20));
    }
  }
  const addQQTMesh = (name, geomList, matParams, cast = false) => {
    if (!geomList || !geomList.length) return null;
    const m = new THREE.Mesh(merge(THREE, geomList), standardMaterial(THREE, matParams));
    m.name = name; m.castShadow = cast; m.receiveShadow = true;
    m.userData.cullDistance = 1400; m.userData.cullCell = 200;
    if (m.geometry.computeBoundingSphere) m.geometry.computeBoundingSphere();
    group.add(m); stats.meshes++;
    return m;
  };
  addQQTMesh('WaterfrontLandmarks_QQT_Glazing', whGlass, { color: F.glass ?? 0x1d3730, roughness: 0.14, metalness: 0.6 });
  addQQTMesh('WaterfrontLandmarks_QQT_GreenFrame', whFrame, { color: F.frameGreen ?? 0x3f7a5c, roughness: 0.5, metalness: 0.35 });
  addQQTMesh('WaterfrontLandmarks_QQT_Cream', whCream, { color: F.cream ?? 0xcfc6b0, roughness: 0.86, metalness: 0.02 });

  // ---------------- the 1983 addition: framed glass + balcony rails in pale green (not a solid mint billboard) ----------
  // Within the exact mapped additionParts (never synthesised), on each band's OUTWARD faces, four residential levels, each
  // built as: a pale-green soffit/slab, DARKER glass window panels between pale-green vertical mullions, and a pale-green
  // balcony rail — so it reads as framed glazing + balcony rails with cream structure, not a solid pale-green panel. The
  // projection stays at the documented estimate (resProud); the band solids and the open courtyard/lightwell are unchanged.
  // Every panel is rotated to its OWN face (yaw from the face's along vector), so the end-face panels are not perpendicular.
  const resLevels = F.resLevels ?? 4, resProud = F.resProud ?? 0.55, resGlassH = F.resGlassH ?? 2.05, resSoffitH = F.resSoffitH ?? 0.32;
  const resGlass = [], resFrame = [], resRail = [];
  let resBanks = 0;
  for (const p of layout.additionParts) {
    const h = p.h - base - hWare;
    if (h <= resGlassH + resSoffitH) continue;
    const pcs = Math.cos(p.ang), psn = Math.sin(p.ang);
    // four outward faces of the band (local u along, v outward), reusing the Redpath-style face frame maths
    const defs = [
      { along: [pcs, -psn], nrm: [psn, pcs], half: p.halfD, len: p.halfW * 2 },
      { along: [pcs, -psn], nrm: [-psn, -pcs], half: p.halfD, len: p.halfW * 2 },
      { along: [psn, pcs], nrm: [-pcs, psn], half: p.halfW, len: p.halfD * 2 },
      { along: [psn, pcs], nrm: [pcs, -psn], half: p.halfW, len: p.halfD * 2 }
    ];
    const levelH = h / resLevels;                            // spread the four glazed levels over the band's height
    for (const fd of defs) {
      const yaw = Math.atan2(-fd.along[1], fd.along[0]);     // per-face yaw (fixes the perpendicular end-face panels)
      const at = (along, off) => [p.cx + fd.along[0] * along + fd.nrm[0] * off, p.cz + fd.along[1] * along + fd.nrm[1] * off];
      const span = fd.len - 0.8;                             // leave ~0.4 m of cream at each band corner
      const nMull = Math.max(2, Math.round(span / 4.0));     // ~4 m glazing bays (estimate; keeps the merged budget tight)
      const mullW = 0.14, bayW = span / nMull;
      for (let lv = 0; lv < resLevels; lv++) {
        const yBase = base + hWare + lv * levelH;
        const yGlaze = yBase + resSoffitH + resGlassH / 2;
        const proj = fd.half + resProud;
        // pale-green soffit / balcony slab (projects to the documented estimate)
        resFrame.push(boxGeo(THREE, span + 0.3, resSoffitH, resProud + 0.2, at(0, fd.half + (resProud + 0.2) / 2)[0], yBase + resSoffitH / 2, at(0, fd.half + (resProud + 0.2) / 2)[1], yaw));
        // darker glass window panels between pale-green mullions (reads as glazing, not a solid mint panel)
        for (let m = 0; m < nMull; m++) {
          const uM = -span / 2 + (m + 0.5) * bayW;
          resGlass.push(boxGeo(THREE, Math.max(0.4, bayW - mullW), resGlassH, 0.10, at(uM, proj)[0], yGlaze, at(uM, proj)[1], yaw));
        }
        for (let m = 0; m <= nMull; m++) {
          const uM = -span / 2 + m * bayW;
          resFrame.push(boxGeo(THREE, mullW, resGlassH, 0.14, at(uM, proj)[0], yGlaze, at(uM, proj)[1], yaw));
        }
        // pale-green balcony rail at the top of the glazing
        resRail.push(boxGeo(THREE, span + 0.1, 0.14, 0.12, at(0, proj)[0], yGlaze + resGlassH / 2 - 0.07, at(0, proj)[1], yaw));
        resBanks++;
      }
    }
  }
  addQQTMesh('WaterfrontLandmarks_QQT_ResGlazing', resGlass, { color: F.glass ?? 0x1d3730, roughness: 0.2, metalness: 0.4 });
  addQQTMesh('WaterfrontLandmarks_QQT_ResFrame', resFrame, { color: F.resGreen ?? 0x8fb59a, roughness: 0.55, metalness: 0.08 });
  addQQTMesh('WaterfrontLandmarks_QQT_ResRail', resRail, { color: F.roofEdge ?? 0x3f7a5c, roughness: 0.5, metalness: 0.3 });

  // ---------------- colliders: the warehouse + each addition band + each penthouse + the clock tower ----------------
  addBoxCollider(colliders, box.cx, box.cz, box.halfW, box.halfD, box.ang, base, base + hWare, 'landmark');
  for (const p of layout.additionParts) addBoxCollider(colliders, p.cx, p.cz, p.halfW, p.halfD, p.ang, base + hWare, p.h, 'landmark');
  for (const p of layout.penthouses) addBoxCollider(colliders, p.cx, p.cz, p.halfW, p.halfD, p.ang, base + hWare, p.h, 'landmark');
  if (layout.clockTower) {
    const c = layout.clockTower;
    addBoxCollider(colliders, c.cx, c.cz, c.halfW, c.halfD, c.ang, base + c.baseH, base + c.topH, 'landmark');
  }

  // the flat GREEN roof edge, its own material (see the note above `const cH`), added last as a separate mesh
  const cornice = new THREE.Mesh(
    boxGeo(THREE, (box.halfW + cOver) * 2, cH, (box.halfD + cOver) * 2, box.cx, base + hWare - cH / 2, box.cz, box.ang),
    standardMaterial(THREE, { color: F.roofEdge ?? 0x3f7a5c, roughness: 0.55, metalness: 0.3 })
  );
  cornice.name = 'WaterfrontLandmarks_QQT_Cornice';
  cornice.castShadow = false; cornice.receiveShadow = true;
  cornice.userData.cullDistance = 1400; cornice.userData.cullCell = 200;
  if (cornice.geometry.computeBoundingSphere) cornice.geometry.computeBoundingSphere();
  group.add(cornice); stats.meshes++;

  stats.qqq = {
    warehouseH: layout.warehouseH, topH: layout.topH, additionParts: layout.additionParts.length,
    penthouses: layout.penthouses.length, clockTower: !!layout.clockTower, openCourtyard: true,
    greenFrameBays: greenBays, greenFrameCells: greenCells,
    resBanks, resLevels, resProjecting: resProud
  };
  return shell;
}

// Redpath: the mapped halls (each mapped part extruded to its mapped height) + the ship unloader on the zone edge that
// fronts Jarvis Slip + the one-line west "REDPATH SUGAR" sign on the tall plant + the whale mural on the shed north face
// + the mapped quay utility tower. The long 34614 hall is the major pitched raw store (photo/geospatial inference). The
// barrel silos and chimney stack are not modelled: the committed geodata has no footprint for them (reported unresolved).
function buildRedpath(THREE, layout, group, colliders, stats) {
  const base = SW + 0.004;

  // ---------------- mapped halls: material segmentation, structural bays, parapets, cladding, pitched shed roof ----
  // Every geometry below is a flat panel on a mapped face of a mapped part; panels are centred on the face and thick
  // enough to intersect the wall by ~6 cm, so nothing hovers and no coplanar surface z-fights. The raw-sugar shed keeps
  // the big steep gable (estimated from the photos; the geodata roof code is flat), the tall plants keep flat caps.
  const shedWalls = [], solidWalls = [], roofParts = [], trimParts = [], plinthParts = [], glassParts = [], claddingParts = [], hoodParts = [], pipeParts = [];
  let sheds = 0, corrugatedHalls = 0, corrugatedRibs = 0, pilasterBays = 0, windowBands = 0, hoods = 0;

  const faceGeom = (p, face, { w, h, y, along = 0, proud = 0.1, t } = {}) => {
    const cs = Math.cos(p.ang), sn = Math.sin(p.ang);
    const U = [cs, -sn], V = [sn, cs];
    let nx, nz, ry, off, ax;
    if (face === '+v') { nx = V[0]; nz = V[1]; ry = p.ang; off = p.halfD; ax = U; }
    else if (face === '-v') { nx = -V[0]; nz = -V[1]; ry = p.ang; off = p.halfD; ax = U; }
    else if (face === '+u') { nx = U[0]; nz = U[1]; ry = p.ang + Math.PI / 2; off = p.halfW; ax = V; }
    else { nx = -U[0]; nz = -U[1]; ry = p.ang + Math.PI / 2; off = p.halfW; ax = V; }
    const th = t ?? (2 * (proud + 0.06));       // inner face sits 6 cm INSIDE the wall face (no hover)
    return boxGeo(THREE, w, h, th, p.cx + ax[0] * along + nx * (off + proud), y, p.cz + ax[1] * along + nz * (off + proud), ry);
  };
  const faceLen = (p, face) => (face.includes('u') ? p.halfD * 2 : p.halfW * 2);
  const FACES = ['+u', '-u', '+v', '-v'];
  const addMerged = (name, parts, material, { cast = true } = {}) => {
    if (!parts.length) return null;
    const mesh = new THREE.Mesh(merge(THREE, parts), material);
    mesh.castShadow = cast; mesh.receiveShadow = true;
    mesh.userData.cullDistance = 1400; mesh.userData.cullCell = 200;
    if (mesh.geometry.computeBoundingSphere) mesh.geometry.computeBoundingSphere();
    mesh.name = name; group.add(mesh); stats.meshes++;
    return mesh;
  };

  for (const h of layout.halls) {
    const totalH = Math.max(4, h.h - base);
    const pitched = h.kind === 'shed' || h.kind === 'rawstore';
    const lowFlat = h.kind === 'support' && h.h <= 10;
    // Pitched roofs keep the MAPPED TOTAL height as the ridge: the walls rise only to the eaves (totalH - rise) and the
    // gable rises to the mapped height, so no roof is stacked above the known height. The rise is an ESTIMATE from the
    // photo width proportion (see layout h.pitch).
    const rise = h.pitch?.rise ?? 0;
    const wallH = h.pitch?.eaveH ?? totalH;
    (pitched ? shedWalls : solidWalls).push(extrudeRect(THREE, h, base, wallH));

    if (pitched) {
      // big gable ridge along the long (u) axis + light-metal ridge cap and eave fascias + seam ribs up both slopes
      roofParts.push(gableRoofGeometry(THREE, h, base + wallH, rise));
      roofParts.push(boxGeo(THREE, h.halfW * 2 - 0.2, 0.32, 0.58, h.cx, base + totalH + 0.16, h.cz, h.ang));
      const cs = Math.cos(h.ang), sn = Math.sin(h.ang);
      for (const sgn of [-1, 1]) {
        const ex = h.cx + sgn * h.halfD * sn, ez = h.cz + sgn * h.halfD * cs;
        roofParts.push(boxGeo(THREE, h.halfW * 2, 0.28, 0.24, ex, base + wallH + 0.12, ez, h.ang));
      }
      // Standing-seam ribs up both slopes: RESTRAINED and photo-grounded (the crane photo shows a weathered light-grey
      // metal roof with widely-spaced seams, not a bright dense comb). Sparse ~8 m pitch, thin 0.045 m flat strips laid
      // only 3 cm proud of the slope (so they never read as bright tubes), sharing the roof mesh/material — no new draw.
      // The old 0.09 m tubes at 4 m pitch (84 struts) caught light on every facet and moiré'd at distance.
      const seamPitch = 8.0;
      const nRib = Math.max(2, Math.round((h.halfW * 2) / seamPitch));
      const L = Math.hypot(h.halfD, rise) || 1;
      const nv = rise / L, ny = h.halfD / L;
      const ribT = 0.045, lift = 0.03;
      for (let i = 0; i < nRib; i++) {
        const u = (-0.5 + (i + 0.5) / nRib) * (h.halfW * 2);
        for (const sgn of [-1, 1]) {
          const pe = [h.cx + u * cs + sgn * h.halfD * sn, base + wallH, h.cz - u * sn + sgn * h.halfD * cs];
          const pr = [h.cx + u * cs, base + totalH, h.cz - u * sn];
          const ox = sgn * nv * sn, oz = sgn * nv * cs, oy = ny;
          roofParts.push(strut(THREE,
            [pe[0] + ox * lift, pe[1] + oy * lift, pe[2] + oz * lift],
            [pr[0] + ox * lift, pr[1] + oy * lift, pr[2] + oz * lift], ribT));
        }
      }
      addBoxCollider(colliders, h.cx, h.cz, h.halfW, h.halfD, h.ang, base, base + totalH, 'landmark');
      sheds++;
    } else {
      roofParts.push(boxGeo(THREE, h.halfW * 2 - 0.6, 0.3, h.halfD * 2 - 0.6, h.cx, base + wallH + 0.15, h.cz, h.ang));
      addBoxCollider(colliders, h.cx, h.cz, h.halfW, h.halfD, h.ang, base, base + wallH, 'landmark');
    }

    // dark weathered plinth + pale parapet/cornice on every mapped face (segments the wall into base / field / cap)
    const plinthH = Math.min(2.0, wallH * 0.22);
    const cornH = Math.min(0.9, Math.max(0.5, wallH * 0.06));
    for (const f of FACES) {
      const fl = faceLen(h, f);
      if (fl < 2) continue;
      plinthParts.push(faceGeom(h, f, { w: fl - 0.3, h: plinthH, y: base + plinthH / 2, proud: 0.10 }));
      trimParts.push(faceGeom(h, f, { w: fl + 0.2, h: cornH, y: base + wallH - cornH / 2, proud: 0.16 }));
    }

    if (pitched || lowFlat) {
      // light-grey corrugated cladding: vertical ribs at ~3 m pitch on all mapped faces
      corrugatedHalls++;
      for (const f of FACES) {
        const fl = faceLen(h, f);
        const n = Math.max(2, Math.floor(fl / 3.0));
        for (let i = 0; i < n; i++) {
          const along = (-0.5 + (i + 0.5) / n) * fl;
          claddingParts.push(faceGeom(h, f, { w: 0.28, h: wallH * 0.8, y: base + wallH * 0.52, along, proud: 0.08 }));
          corrugatedRibs++;
        }
      }
    }

    if (!pitched && !lowFlat) {
      // structural pilaster bays on the long ±v faces (the faces that read from the harbour / slip)
      for (const f of ['+v', '-v']) {
        const fl = faceLen(h, f);
        const n = Math.max(2, Math.round(fl / 9.5));
        for (let i = 0; i < n; i++) {
          const along = (-0.5 + (i + 0.5) / n) * fl;
          trimParts.push(faceGeom(h, f, { w: 0.6, h: wallH - cornH - 0.4, y: base + (wallH - cornH) / 2, along, proud: 0.16 }));
          pilasterBays++;
        }
      }
      // Sparse industrial openings, not a regular office window grid (captain's photo reading): windows only on the
      // lower two storeys, plus a few projecting gray metal hoods/vents higher up. The tall fields stay blank pale brick.
      for (let i = 0; i < 2; i++) {
        const y = base + 3.4 + i * 4.2;
        if (y + 0.7 > base + wallH - cornH - 0.2) break;
        for (const f of FACES) {
          const fl = faceLen(h, f);
          if (fl < 6) continue;
          glassParts.push(faceGeom(h, f, { w: fl * 0.8, h: 1.4, y, proud: 0.05 }));
          windowBands++;
        }
      }
      for (const f of ['+v', '-v']) {
        const fl = faceLen(h, f);
        if (fl < 8) continue;
        const n = Math.min(5, Math.max(2, Math.round(fl / 22)));
        for (let i = 0; i < n; i++) {
          const along = (-0.5 + (i + 0.5) / n) * fl;
          hoodParts.push(faceGeom(h, f, { w: 1.4, h: 1.0, y: base + wallH * 0.66, along, proud: 0.22 }));
          hoods++;
        }
      }
    }
  }

  // ---- mapped quay-side utility/connector tower (rows 34612/34613): industrial, not a residential condo ----
  // Zone-confirmed mapped structure at 7.0 x 6.2 m, h 22.5; its function is unresolved, so it is modelled as a plain
  // concrete/metal industrial shaft: no window grid, dark vertical seams, pale banding and a dark metal cap. This keeps
  // the native footprint and height while removing the generic white "condo" read. It is NOT labelled a chimney/silo.
  if (layout.tower) {
    const t = layout.tower;
    const th = Math.max(4, t.h - base);
    solidWalls.push(extrudeRect(THREE, t, base, th));
    for (const f of FACES) {
      const fl = faceLen(t, f);
      if (fl < 2) continue;
      for (const at of [-0.28, 0.28]) {
        plinthParts.push(faceGeom(t, f, { w: 0.14, h: th - 0.6, y: base + th / 2, along: at * fl, proud: 0.03 }));
      }
      trimParts.push(faceGeom(t, f, { w: fl + 0.1, h: 0.4, y: base + th * 0.36, proud: 0.08 }));
      trimParts.push(faceGeom(t, f, { w: fl + 0.1, h: 0.4, y: base + th * 0.7, proud: 0.08 }));
    }
    roofParts.push(boxGeo(THREE, t.halfW * 2 + 0.4, 0.9, t.halfD * 2 + 0.4, t.cx, base + th + 0.45, t.cz, t.ang));
    addBoxCollider(colliders, t.cx, t.cz, t.halfW, t.halfD, t.ang, base, base + th + 0.9, 'landmark');
  }

  // ---- prominent pipe/rack assembly between the tall process blocks (captain's BIA photo) ----
  // Modelled as a facade-attached rack (posts on the ground, pipes proud of the wall) on the tall plant's north face,
  // which is the mapped face between the tall blocks. It stands on the ground and intersects the wall, so it never
  // hovers. Bounded: 3 posts + 3 pipe runs, one merged mesh.
  let pipeRacks = 0;
  if (layout.plantAnchor) {
    const a = layout.plantAnchor;
    const hh = Math.max(4, a.h - base);
    const len = Math.min(a.halfD * 2 * 0.6, 14);
    const rackH = Math.min(hh * 0.5, 12);
    for (let i = 0; i < 3; i++) {
      const along = (-0.5 + (i + 0.5) / 3) * len;
      pipeParts.push(faceGeom(a, '-v', { w: 0.3, h: rackH, y: base + rackH / 2, along, proud: 0.2 }));
    }
    for (const t of [0.42, 0.66, 0.9]) {
      pipeParts.push(faceGeom(a, '-v', { w: len, h: 0.26, y: base + rackH * t, proud: 0.2 }));
    }
    pipeRacks = 1;
  }

  // ---- three vertical shallow seams on the pale sign wall (photo) ----
  if (layout.sign && layout.sign.anchor) {
    const a = layout.sign.anchor;
    const hh = Math.max(4, a.h - base);
    const seams = layout.sign.seams || 3;
    for (let i = 0; i < seams; i++) {
      const along = (-0.5 + (i + 1) / (seams + 1)) * (a.halfD * 2);
      plinthParts.push(faceGeom(a, '-u', { w: 0.14, h: hh - 0.6, y: base + hh / 2, along, proud: 0.03 }));
    }
  }

  // ---- the merged surfaces, split by material so the silhouette reads at distance (not one flat tan shell) ----
  // The plant skin is real pale-grey BRICK (0xa7aaa4 base + course/head-joint/weathering shading), not the near-white
  // 0xd6cfc0 that the midday sun washed to a featureless white wall. See brickMaterial.
  const hallWallMaterial = brickMaterial(THREE, { base: 0xa7aaa4 });
  addMerged('WaterfrontLandmarks_Redpath_Halls', solidWalls, hallWallMaterial);
  addMerged('WaterfrontLandmarks_Redpath_ShedWalls', shedWalls,
    standardMaterial(THREE, { color: 0xb7b8b6, roughness: 0.72, metalness: 0.22 }));
  addMerged('WaterfrontLandmarks_Redpath_Roof', roofParts,
    standardMaterial(THREE, { color: 0xb9b8b3, roughness: 0.86, metalness: 0.06 }));   // weathered light metal, not blue
  addMerged('WaterfrontLandmarks_Redpath_Trim', trimParts,
    standardMaterial(THREE, { color: 0xc0bdb2, roughness: 0.85, metalness: 0.04 }), { cast: false });
  addMerged('WaterfrontLandmarks_Redpath_Plinth', plinthParts,
    standardMaterial(THREE, { color: 0x6f716d, roughness: 0.95, metalness: 0.02 }), { cast: false });
  addMerged('WaterfrontLandmarks_Redpath_Cladding', claddingParts,
    standardMaterial(THREE, { color: 0xc7c9c8, roughness: 0.55, metalness: 0.30 }), { cast: false });
  addMerged('WaterfrontLandmarks_Redpath_Windows', glassParts,
    standardMaterial(THREE, { color: 0x223039, roughness: 0.22, metalness: 0.5 }), { cast: false });
  addMerged('WaterfrontLandmarks_Redpath_Hoods', hoodParts,
    standardMaterial(THREE, { color: 0x8b8f92, roughness: 0.6, metalness: 0.35 }), { cast: false });
  addMerged('WaterfrontLandmarks_Redpath_PipeRack', pipeParts,
    standardMaterial(THREE, { color: 0x9a9ea1, roughness: 0.55, metalness: 0.4 }), { cast: false });

  // ---------------- signage: one-line "REDPATH SUGAR" on the tall plant's west face; whale mural on the shed north ----
  // The west inscription is anchored to the tall plant part (not the shed): ONE LINE of red/burgundy raised block
  // capitals, transparent ink so the pale brick shows through, near the top of the wall. The mural is a plain muted
  // blue plate at its sourced location (north shed wall); the artwork itself is not reproduced.
  if (layout.sign && layout.sign.anchor) {
    const a = layout.sign.anchor;
    const si = layout.sign;
    const dims = signDim(a, si);
    const signW = dims.width, signH = dims.height;
    const signY = dims.y;
    // Canvas aspect follows the panel aspect (15.6 m x ~2.2 m) so the broad capitals are never stretched tall; the
    // texture height is derived from the sign height, not a fixed 192 px block.
    const texW = 1024, texH = Math.max(96, Math.round(texW * signH / signW));
    const signTex = makeSignTexture(THREE, si.text, { w: texW, h: texH, ink: si.ink, width: signW, height: signH });
    const sign = new THREE.Mesh(
      faceGeom(a, si.localFace, { w: signW, h: signH, y: signY, proud: 0.12, t: 0.30 }),
      signMaterial(THREE, signTex, { ink: 0x9e1b1b, transparent: true })
    );
    sign.castShadow = false; sign.receiveShadow = false;
    sign.userData.cullDistance = 1100; sign.userData.cullCell = 200;
    sign.userData.signText = si.text;
    sign.userData.signFace = 'west (-u)';
    sign.userData.signSize = [signW, signH];
    sign.userData.legible = !!signTex;
    sign.userData.raised = true;
    if (sign.geometry.computeBoundingSphere) sign.geometry.computeBoundingSphere();
    sign.name = 'WaterfrontLandmarks_Redpath_Sign';
    group.add(sign); stats.meshes++;
  }
  if (layout.mural && layout.mural.anchor) {
    const a = layout.mural.anchor;
    const wallH = Math.max(4, a.h - base);
    const mi = layout.mural;
    const muralW = mi.width, muralH = mi.height;
    const muralY = base + Math.min(wallH * 0.54, wallH - muralH / 2 - 0.7);
    const mural = new THREE.Mesh(
      faceGeom(a, mi.localFace, { w: muralW, h: muralH, y: muralY, proud: 0.12 }),
      signMaterial(THREE, null, { ink: 0x2f5e8f })
    );
    mural.castShadow = false; mural.receiveShadow = true;
    mural.userData.cullDistance = 1100; mural.userData.cullCell = 200;
    mural.userData.muralFace = 'north (-u)';
    mural.userData.abstract = false;   // location only; the artwork is not reproduced
    if (mural.geometry.computeBoundingSphere) mural.geometry.computeBoundingSphere();
    mural.name = 'WaterfrontLandmarks_Redpath_WhaleMural';
    group.add(mural); stats.meshes++;
  }

  // No generic facade shader on the refinery: the captain's photo reading is sparse industrial openings, not a regular
  // office window grid. The explicit pale-brick fields, lower two-storey window bands, gray metal hoods, pilaster bays
  // and pipe rack above carry the facade. (The QQT still uses the shared facade shader in buildQQT.)

  // ---------------- ship unloader: a green articulated material handler on the dock ----------------
  // Identity from the manufacturer photos (Sennebogen): a bright-green articulated hydraulic boom + stick, a
  // counterweight opposite the boom, a white grille machinery box, a projecting tinted-glass cab, all on a black
  // cylindrical pedestal above a dark-grey A-frame wheel gantry. It stands on the dock at the quay edge and reaches out
  // over Jarvis Slip. Proportions are ESTIMATES (source: cab ~9.1 m above dock, reach ~5.8 m from swing, dock ~9.1 m
  // wide, 20 ft² hopper). Built as a few merged meshes by material, one culling root.
  if (layout.unloader) {
    const un = layout.unloader;
    const A = base;
    const Fx = Math.sin(un.ang), Fz = Math.cos(un.ang);   // toward the water
    const Rx = Math.cos(un.ang), Rz = -Math.sin(un.ang);  // to the machine's right
    const at = (f, r) => [un.x + Fx * f + Rx * r, un.z + Fz * f + Rz * r]; // world (x,z) at local (forward, right)
    const P = (f, r, y) => { const [x, z] = at(f, r); return [x, A + y, z]; };
    const [cw, chh, cd] = un.chassis;
    const chassisTop = chh;

    // --- dark-grey A-frame wheel gantry (undercarriage, wheels, A-legs, black pedestal) ---
    const gantry = [];
    gantry.push(boxGeo(THREE, cw, chh, cd, un.x, A + chh / 2, un.z, un.ang));
    // four wheel bogies ("five-wheel races" simplified to a wide dark cylinder at each corner)
    for (const r of [-cw / 2 + 0.5, cw / 2 - 0.5]) {
      for (const f of [-cd / 2 + 0.6, cd / 2 - 0.6]) {
        const [x, z] = at(f, r);
        const wheel = new THREE.CylinderGeometry(0.72, 0.72, 1.2, 12);
        wheel.rotateZ(Math.PI / 2);
        wheel.rotateY(un.ang + Math.PI / 2); // axle across the machine (along right)
        gantry.push(wheel.translate(x, A + 0.72, z));
      }
    }
    // A-frame legs from the four chassis corners up to the pedestal foot
    const pedFoot = P(0, 0, chassisTop + 0.4);
    for (const r of [-cw / 2 + 0.4, cw / 2 - 0.4]) {
      for (const f of [-cd / 2 + 0.4, cd / 2 - 0.4]) gantry.push(strut(THREE, P(f, r, chassisTop), pedFoot, 0.34));
    }
    // the black cylindrical pedestal
    gantry.push(new THREE.CylinderGeometry(un.pedestalR, un.pedestalR * 1.15, un.pedestalH, 16).translate(un.x, A + chassisTop + 0.4 + un.pedestalH / 2, un.z));
    const gantryMesh = new THREE.Mesh(merge(THREE, gantry), standardMaterial(THREE, { color: 0x33383d, roughness: 0.7, metalness: 0.35 }));
    gantryMesh.castShadow = true; gantryMesh.receiveShadow = true;
    gantryMesh.userData.cullDistance = 1600; gantryMesh.userData.cullCell = 200;
    if (gantryMesh.geometry.computeBoundingSphere) gantryMesh.geometry.computeBoundingSphere();
    gantryMesh.name = 'WaterfrontLandmarks_Redpath_Unloader_Gantry';
    group.add(gantryMesh); stats.meshes++;

    // --- machinery deck: white grille box + dark counterweight (boom foot at the deck front) ---
    const deckY = A + chassisTop + 0.4 + un.pedestalH + un.bodyH / 2;
    const [bx, bz] = at(0.4, 0); // body slightly forward of the swing centre
    const bodyWhite = [];
    bodyWhite.push(boxGeo(THREE, un.bodyW, un.bodyH, un.bodyD, bx, deckY, bz, un.ang));
    // white grille: a few proud ridges on the body's rear face
    for (let i = 0; i < 4; i++) {
      const [gx, gz] = at(0.4 - un.bodyD / 2 - 0.03, 0);
      bodyWhite.push(boxGeo(THREE, un.bodyW * 0.8, 0.12, 0.06, gx, deckY - 0.6 + i * 0.4, gz, un.ang));
    }
    const whiteMesh = new THREE.Mesh(merge(THREE, bodyWhite), standardMaterial(THREE, { color: 0xe8e9ea, roughness: 0.55, metalness: 0.1 }));
    whiteMesh.castShadow = true; whiteMesh.receiveShadow = true;
    whiteMesh.userData.cullDistance = 1600; whiteMesh.userData.cullCell = 200;
    if (whiteMesh.geometry.computeBoundingSphere) whiteMesh.geometry.computeBoundingSphere();
    whiteMesh.name = 'WaterfrontLandmarks_Redpath_Unloader_Body';
    group.add(whiteMesh); stats.meshes++;
    // the dark counterweight opposite the boom (rear)
    const [kwx, kwz] = at(0.4 - un.bodyD / 2 - 0.5, 0);
    const cwMesh = new THREE.Mesh(boxGeo(THREE, un.bodyW * 0.95, un.bodyH * 0.9, 1.0, kwx, deckY, kwz, un.ang),
      standardMaterial(THREE, { color: 0x2a2e33, roughness: 0.8, metalness: 0.3 }));
    cwMesh.castShadow = true; cwMesh.receiveShadow = true;
    cwMesh.userData.cullDistance = 1600; cwMesh.userData.cullCell = 200;
    if (cwMesh.geometry.computeBoundingSphere) cwMesh.geometry.computeBoundingSphere();
    cwMesh.name = 'WaterfrontLandmarks_Redpath_Unloader_Counterweight';
    group.add(cwMesh); stats.meshes++;

    // --- projecting tinted-glass cab on the machine's right side ---
    const cabY = A + un.cabAboveDock; // ~9.1 m above the dock (source), top of the cab
    const [cax, caz] = at(0.8, un.bodyW / 2 + 0.75);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.0, 1.7),
      standardMaterial(THREE, { color: 0x1d2b34, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.82 }));
    cab.position.set(cax, cabY - 1.0, caz);
    cab.rotation.y = un.ang;
    cab.castShadow = true; cab.receiveShadow = false;
    cab.userData.cullDistance = 1600; cab.userData.cullCell = 200;
    if (cab.geometry.computeBoundingSphere) cab.geometry.computeBoundingSphere();
    cab.name = 'WaterfrontLandmarks_Redpath_Unloader_Cab';
    group.add(cab); stats.meshes++;

    // --- the bright-green articulated boom + stick + clamshell reaching over the water ---
    const boomFoot = P(0.4 + un.bodyD / 2, 0, chh + 0.4 + un.pedestalH + 0.2); // boom pivot at the deck front
    const boomTip = P(un.reach * 0.62, 0, un.boomUp);                          // main boom up and out
    const stickTip = P(un.reach, 0, un.stickDown);                             // stick down to the water
    const green = [];
    green.push(strut(THREE, boomFoot, boomTip, 0.55));        // main boom (green)
    green.push(strut(THREE, boomTip, stickTip, 0.42));        // stick/dipper (green)
    // a hydraulic ram from the boom root to the boom (green-adjacent, darker to read as a ram)
    const ramFoot = P(0.4 + un.bodyD / 2 - 1.2, 0, chh + 0.4 + un.pedestalH + 0.2);
    green.push(strut(THREE, ramFoot, [boomTip[0], (boomFoot[1] + boomTip[1]) / 2, boomTip[2]], 0.22));
    // the clamshell grab just under the stick tip
    const [clx, clz] = [stickTip[0], stickTip[2]];
    green.push(boxGeo(THREE, 0.9, 0.7, 0.9, clx, stickTip[1] - 0.5, clz, un.ang));
    const greenMesh = new THREE.Mesh(merge(THREE, green), standardMaterial(THREE, { color: 0x2fbf3a, roughness: 0.5, metalness: 0.25 }));
    greenMesh.castShadow = true; greenMesh.receiveShadow = true;
    greenMesh.userData.cullDistance = 1600; greenMesh.userData.cullCell = 200;
    if (greenMesh.geometry.computeBoundingSphere) greenMesh.geometry.computeBoundingSphere();
    greenMesh.name = 'WaterfrontLandmarks_Redpath_Unloader_Boom';
    group.add(greenMesh); stats.meshes++;

    // collider: the machine body (not the over-water boom)
    addBoxCollider(colliders, un.x, un.z, cw / 2, cd / 2, un.ang, base, base + chh + 0.4 + un.pedestalH + un.bodyH, 'landmark');
    stats.unloaderKind = 'articulated-green-material-handler';
  }

  stats.redpath = {
    halls: layout.halls.length, supports: layout.supports || 0, unloader: !!layout.unloader, tower: !!layout.tower,
    pitchedSheds: sheds, corrugatedHalls, corrugatedRibs, pilasterBays, windowBands, hoods, pipeRacks,
    signFace: layout.sign?.face, signLocalFace: layout.sign?.localFace, signText: layout.sign?.text, signInk: layout.sign?.ink,
    muralFace: layout.mural?.face,
    unresolved: layout.unresolved
  };
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Builder: returns { group, colliders, stats }
// ---------------------------------------------------------------------------------------------------------------------
function createWaterfrontLandmarks(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-landmarks: THREE is required');
  const layout = waterfrontLandmarksLayout();
  const group = new THREE.Group();
  group.name = 'WaterfrontLandmarks';
  const colliders = [];
  const stats = { landmarks: [], meshes: 0, colliders: 0, supported: layout.supported, excludedRows: layout.excludedRows || [] };

  if (layout.supported) {
    if (layout.qqt) { buildQQT(THREE, layout.qqt, group, colliders, stats); stats.landmarks.push('queensQuayTerminal'); }
    if (layout.redpath) { buildRedpath(THREE, layout.redpath, group, colliders, stats); stats.landmarks.push('redpathSugar'); }
  }

  stats.colliders = colliders.length;
  group.userData.waterfrontLandmarks = stats;
  if (scene && scene.add) scene.add(group);

  // The exclusion hook for main.js/buildings.js (captain's files): the generic City boxes under these footprints are
  // dropped so the landmark stands on its own surveyed outline. Data only; the module edits no other file.
  const rows = new Set(stats.excludedRows);
  C.waterfrontLandmarkExcludedRows = rows;
  C.waterfrontLandmarkExcludesBuilding = (bi) => rows.has(bi);

  const result = { group, colliders, stats, layout, landmarks: WATERFRONT_LANDMARKS };
  window.CITY.waterfrontLandmarks = result;
  if (layout.supported) {
    console.info(`[waterfrontLandmarks] ${stats.landmarks.join(' + ') || 'none'}: ${stats.meshes} meshes, ${stats.colliders} colliders; ` +
      `excluding building rows [${[...rows].join(', ')}] from the generic city`);
  } else {
    console.info('[waterfrontLandmarks] skipped: the active city frame does not cover the mapped Queen\'s Quay Terminal / Redpath zone');
  }
  return result;
}

Object.assign(window.CITY, {
  WATERFRONT_LANDMARKS,
  QQT_LANDMARK: QQT,
  REDPATH_LANDMARK: REDPATH,
  waterfrontLandmarksLayout,
  // CPU camera verification (wave 7): the capture list and the tests use these to prove a proposed camera stands outside
  // every landmark solid and has direct line-of-sight to the sign/mural before a GPU run is spent on it.
  waterfrontLandmarkOBBs: (layout) => layoutOBBs(layout || waterfrontLandmarksLayout()),
  waterfrontLandmarkVerifyCamera: (camera, target, opts) => verifyCamera(waterfrontLandmarksLayout(), camera, target, opts),
  waterfrontLandmarkSignCenter: (layout) => signCenter(layout || waterfrontLandmarksLayout()),
  waterfrontLandmarkMuralCenter: (layout) => muralCenter(layout || waterfrontLandmarksLayout()),
  // Source-photo brick TYPOLOGY (course/head size, mortar width, joint contrast) used by brickMaterial; exposed so the
  // proportions can be asserted without compiling the GPU shader (a Node test can only build the node graph).
  REDPATH_BRICK_TYPOLOGY: BRICK_TYPOLOGY,
  waterfrontLandmarksSupported: () => supportedCityFrame(),
  waterfrontLandmarkResolveComponents: (G = C?.GEO) => resolveComponents(G),
  // The exclusion predicate is called from buildings.js's building loop, which runs BEFORE createWaterfrontLandmarks in
  // main.js. It must answer from the active GEO on its own (built lazily and cached), never depend on the builder having
  // run. resolveComponents is cached per GEO, so this is cheap after the first call.
  waterfrontLandmarkExcludesBuilding: (bi) => {
    if (C.waterfrontLandmarkExcludedRows) return C.waterfrontLandmarkExcludedRows.has(bi);
    if (!supportedCityFrame()) return false;
    const rows = excludedRows();
    C.waterfrontLandmarkExcludedRows = rows;
    return rows.has(bi);
  },
  createWaterfrontLandmarks
});
})();
