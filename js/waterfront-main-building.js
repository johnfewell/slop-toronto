(function () {
// js/waterfront-main-building.js
// Harbourfront Centre Main Building (235 Queens Quay West), the "Artport Building": the institutional envelope of the
// ten mapped City 3D Massing rows named "Harbourfront Centre Main Building" (detail-frame rows 33246-33255). The generic
// city facade gives these rows anonymous residential windows; this module replaces them with the source-grounded
// institutional envelope and leaves every unresolved row on the generic path.
//
// Source evidence (retrieved 2026-11-10; the captain inspected the official photographs, this module's author cannot
// read images and works from the captain's written observations plus the official text):
// - Harbourfront Centre, Venue and Accessibility Guide 2025 (official PDF, downloaded to
//   .cache/waterfront-mainland-review/captain/access-2025.pdf; page 4 is the east entrance photograph, page 10 the
//   entrance ramp/stairs text):
//     "Harbourfront Centre's Main Building is located at 235 Queens Quay West, on the south side of Queens Quay West,
//      where Lower Simcoe Street ends."
//     "There is a wheelchair-accessible entrance at the northeast corner of the Main Building, which you can see from
//      the street. There is a set of stairs (3 steps) and a ramp with railings on both sides. The entry doors are
//      automatic."
//     "The entrance to the main building is through the North East doors."
//   https://harbourfrontcentre.com/wp-content/uploads/2025/04/04142025_hc_accessibility_guide_2025-compressed.pdf
// - Harbourfront Centre, Accessibility (primary): https://harbourfrontcentre.com/accessibility/
// - Harbourfront Centre, Plan your visit (primary): https://harbourfrontcentre.com/plan-your-visit/
// - Harbourfront Centre, Fall 2025 site map (official PDF):
//   https://harbourfrontcentre.com/wp-content/uploads/2025/10/Fall_2025_hc_site_map_v1.0.0.pdf
// - Commons aerial reference .cache/waterfront-mainland-review/harbourfront/harbourfront-centre.jpg is a DATED
//   historical photograph (surface parking and a pond that no longer exist); it is used only for the broad roof/hall
//   reading, never as a site plan. The obsolete parking/pond is NOT replicated.
//
// Captain's verified photograph reading (east entrance face, page 4):
//   - THREE-STOREY DARK CHARCOAL smooth horizontal panel spandrels. The real building has a rounded corner; this module
//     keeps the mapped footprint RECTANGLE (a committed massing part is a rectangle and cutting the corner would leave
//     the surveyed outline), so the rounded corner is documented as simplified, not modelled.
//   - Wide WHITE/SILVER framed multipane horizontal rectangular window groups at the upper two levels.
//   - Full-height ground glazing.
//   - A BLACK top fascia carrying WHITE "Harbourfront Centre" lettering, and a BLACK entrance canopy with a small WHITE
//     "235". These letters are drawn as simple canvas lettering planes (white source wording on black, no copied photo
//     pixels), not plain panels.
//   - NOT brick and NOT uniform white corrugation.
//   Adjacent larger main hall (Commons aerial): a gray broad flat roof and lighter-gray long side cladding with a wide
//   window ribbon. The dark three-storey east face is therefore distinguished from the broad gray hall; hidden walls
//   are kept conservative.
//
// Fidelity rules
// --------------
// - Every volume is a committed mapped footprint part (the row's own parts), at the mapped height. Nothing is moved off
//   its surveyed outline and no roof mast, furniture or site change is invented.
// - The east face is inferred from the official caption ("east side ... what you will see from the street") and the
//   mapped orientation: the main volume's face whose outward normal points most nearly +x (grid east). The exact
//   correspondence of mapped parts to the photograph is not measured; the panel/window counts, the lettering size and the
//   canopy dimensions are explicit estimates (MAIN_BUILDING_ESTIMATES).
// - Face panels derive their yaw from the face's own along vector, atan2(-along.z, along.x), never one yaw for all four
//   faces (the Terminal face-alignment bug).
// - Components are keyed by mapped name + block centre + mapped height, never by row index, so the same rows resolve in
//   any frame. Rows that do not resolve are not built and are not excluded.
// - The exclusion hook is exported ONLY after a successful build, and only for rows actually drawn; unresolved rows stay
//   on the generic city path. The predicate captures the GEO it was built against, so a later frame swap can never
//   suppress an unrelated building; an unsupported rebuild clears the predicate and the excluded rows first.
//   main.js/buildings.js is the captain's file and is not edited here.
// - One merged mesh per material (bounded draw calls), one culling root, deterministic (no random draws). The lettering
//   planes share two bounded CanvasTextures (one per sign) and are built only where a canvas exists (the browser); in a
//   DOM-less runtime the black fascias/canopy are still drawn, plain.

const C = window.CITY;
const SW = C?.CITY_BOUNDS?.sidewalkHeight ?? 0.22;

// The ten mapped rows named "Harbourfront Centre Main Building" in the detail frame (rows 33246-33255), keyed by block
// centre + mapped height. `role` selects the envelope treatment; only the main volume carries the photographed east
// face. Heights are the committed mapped heights (metres).
const MAIN_BUILDING_ROWS = [
  { cx: -407.0, cz: 590.4, h: 5.3, role: 'low-wing' },
  { cx: -387.9, cz: 632.5, h: 6.8, role: 'long-hall' },
  { cx: -386.5, cz: 669.8, h: 7.1, role: 'north-wing' },
  { cx: -374.8, cz: 593.3, h: 7.3, role: 'low-wing' },
  { cx: -371.4, cz: 666.8, h: 10.0, role: 'north-wing' },
  { cx: -378.3, cz: 589.7, h: 11.6, role: 'south-wing' },
  { cx: -376.4, cz: 627.2, h: 14.0, role: 'main-volume' },
  { cx: -370.5, cz: 657.7, h: 14.5, role: 'roof-core' },
  { cx: -377.8, cz: 623.9, h: 14.5, role: 'roof-core' },
  { cx: -373.2, cz: 598.1, h: 15.1, role: 'roof-core' }
];
const MAIN_BUILDING_NAME = 'Harbourfront Centre Main Building';

// The unnamed mapped canopy/strip row the captain inspected: the northeast entrance forecourt, detail-frame
// `[-359.7, 591.6, 1.567, [[-7.9, 7.9, -1.8, 1.8]], 4.3, 0, 1, 29, 0, ""]` — a 15.8 m × 3.6 m strip at 4.3 m mapped
// height whose south edge abuts the main volume's north edge (z ≈ 599.4) at its east end. It resolves by block centre +
// mapped height ONLY (never row index), and it fails closed if the parent complex is missing.
const ENTRANCE_CANOPY_ROW = { cx: -359.7, cz: 591.6, h: 4.3 };
const ENTRANCE_CANOPY_NAME = '';
// The strip's own coordinate frame (from the mapped row): the long axis runs north-south (world z) and the thin axis
// runs east-west (world x). `halfLong` is the 7.9 m half-length, `halfThin` the 1.8 m half-width.
const ENTRANCE_CANOPY_FRAME = { halfLong: 7.9, halfThin: 1.8, longAxis: 'z', thinAxis: 'x' };

// Explicit estimates where the source gives no measured figure. The report records these as unverified.
const MAIN_BUILDING_ESTIMATES = {
  storeys: 3,                 // the photographed east face is three storeys
  storeyHeight: 4.6,          // 14 m / 3, the mapped main-volume height
  groundGlazingTop: 4.1,      // full-height ground glazing, metres above the ground
  ribbonHeight: 1.8,          // the wide horizontal window group, metres
  ribbonInset: 1.6,           // metres from each end of the east face
  mullionSpacing: 3.2,        // metres between the white/silver vertical mullions (estimate)
  fasciaHeight: 0.8,          // the black branding fascia at the top of the east face
  fasciaText: 'Harbourfront Centre', // white source lettering on the black fascia
  fasciaTextBandWidth: 14.0,         // the lettering band along the fascia, metres (a bounded sign, not the whole face)
  fasciaTextCapFraction: 0.6,        // letter cap height as a fraction of the band height (estimate)
  // The NE entrance canopy (the unnamed strip row): a thin white/silver roof on the 4.3 m mapped strip, an open
  // pedestrian approach beneath it, a black leading fascia carrying white "235", restrained support posts. Everything
  // in this group is PHOTO/MAP INFERENCE from the captain's photograph reading and the strip's own footprint.
  canopyRoofThickness: 0.35,    // the thin roof slab at the mapped strip top
  canopyBeamDepth: 0.22,        // the white underside transverse beams
  canopyBeamSpacing: 2.6,       // metres between the underside beams (estimate)
  canopyFasciaHeight: 0.65,     // the black 235 leading (east) fascia
  canopyFasciaTextCapFraction: 0.62,
  canopyFasciaTextBandFraction: 0.6, // the white "235" occupies this fraction of the fascia length
  canopySignText: '235',        // white source lettering on the black leading fascia
  canopyPostEdgeInset: 0.25,    // posts stand this far inside the strip's north/south ends (estimate)
  canopyPostSize: 0.24,         // square post section, metres (estimate)
  canopyPostColliderPad: 0.06,  // collider half-extent for a post = half section + this pad
  canopyRoofMinY: 3.5,          // the underside of the roof for overhead collision (mapped height 4.3 − roof − beams)
  roofCapInset: 0.3,          // the flat gray roof cap is inset this far from the mapped edge
  roundedCorner: 'simplified (not modelled): a committed massing part is a rectangle and cutting the corner would leave the surveyed footprint',
  entranceApproach: 'simplified (not modelled): the 3-step stair and railed ramp of the NE approach are not surveyed in the mapped massing; the approach stays open, walkable ground beneath the canopy with no invented raised slab'
};

// --------------------------------------------------------------------------------------------------------------------
// Row resolution (name + block centre + mapped height; never row index)
// --------------------------------------------------------------------------------------------------------------------
const RESOLVE_CACHE = new WeakMap();
function resolveRows(G = C?.GEO) {
  if (!G || !Array.isArray(G.buildings)) return null;
  if (RESOLVE_CACHE.has(G)) return RESOLVE_CACHE.get(G);
  const tol = 1.5, tolH = 0.6;
  const found = MAIN_BUILDING_ROWS.map(() => null);
  for (let bi = 0; bi < G.buildings.length; bi++) {
    const b = G.buildings[bi];
    if (!Array.isArray(b) || b[9] !== MAIN_BUILDING_NAME) continue;
    for (let k = 0; k < MAIN_BUILDING_ROWS.length; k++) {
      if (found[k] !== null) continue;
      const spec = MAIN_BUILDING_ROWS[k];
      if (Math.hypot(b[0] - spec.cx, b[1] - spec.cz) <= tol && Math.abs(b[4] - spec.h) <= tolH) found[k] = bi;
    }
  }
  const resolved = MAIN_BUILDING_ROWS.map((spec, k) => ({ spec, row: found[k] }));
  RESOLVE_CACHE.set(G, resolved);
  return resolved;
}

// The NE entrance canopy row: resolved by block centre + mapped height only (it is unnamed, and its attributes match
// several other unnamed rows in the frame). It must be a single rectangular part on the strip's own frame; anything else
// returns null, so the caller fails closed. The row index is never used: no broad unnamed-row deletion is possible.
const CANOPY_ROW_CACHE = new WeakMap();
function resolveEntranceCanopyRow(G = C?.GEO) {
  if (!G || !Array.isArray(G.buildings)) return null;
  if (CANOPY_ROW_CACHE.has(G)) return CANOPY_ROW_CACHE.get(G);
  let found = -1;
  let ambiguous = false;
  for (let bi = 0; bi < G.buildings.length; bi++) {
    const b = G.buildings[bi];
    if (!Array.isArray(b)) continue;
    if (Math.hypot(b[0] - ENTRANCE_CANOPY_ROW.cx, b[1] - ENTRANCE_CANOPY_ROW.cz) > 0.5) continue;
    if (Math.abs(b[4] - ENTRANCE_CANOPY_ROW.h) > 0.2) continue;
    if (found !== -1) { ambiguous = true; break; }
    found = bi;
  }
  let out = null;
  if (!ambiguous && found !== -1) {
    const b = G.buildings[found];
    const parts = b[3];
    if (!Array.isArray(parts) || parts.length !== 1) out = null;
    else {
      const [u0, u1, v0, v1] = parts[0];
      // The mapped part is [u0,u1,v0,v1]: local u is the LONG axis (15.8 m, along world z because |sin ang| ≈ 1) and
      // local v the THIN axis (3.6 m, along world x). Confirm the exact strip and reject anything else.
      const lenU = Math.abs(u1 - u0), lenV = Math.abs(v1 - v0);
      const longAxisZ = Math.abs(Math.sin(b[2])) > 0.9;
      if (!(Math.abs(lenU - 2 * ENTRANCE_CANOPY_FRAME.halfLong) < 0.3 &&
            Math.abs(lenV - 2 * ENTRANCE_CANOPY_FRAME.halfThin) < 0.3 && longAxisZ)) out = null;
      else out = { row: found, kind: 'entrance-canopy' };
    }
  }
  CANOPY_ROW_CACHE.set(G, out);
  return out;
}

// The frame capability guard the siblings use: the active map really covers the resolved rows.
function supportedCityFrame(G = C?.GEO, city = C) {
  if (!G || !G.frame || !G.frame.detail || !city?.CITY_BOUNDS) return false;
  if (!Array.isArray(G.buildings) || !G.buildings.length) return false;
  const rows = resolveRows(G);
  // Fail closed: an unresolved parent complex (fewer than the campus block) means the canopy strip cannot be trusted
  // to belong to the Main Building, so nothing is built.
  if (!rows || rows.filter((r) => r.row !== null).length < 6) return false;
  const d = G.frame.detail;
  const inFrame = (x, z) => x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1;
  let covered = 0;
  for (const r of rows) {
    if (r.row === null) continue;
    const b = G.buildings[r.row];
    if (inFrame(b[0], b[1])) covered++;
  }
  if (covered < 6) return false; // the campus block must really be in this frame
  // Fail closed on the canopy strip too: if it resolves ambiguously or is off-frame, build nothing rather than guess.
  const canopy = resolveEntranceCanopyRow(G);
  if (!canopy) return false;
  const cb = G.buildings[canopy.row];
  return inFrame(cb[0], cb[1]);
}

// --------------------------------------------------------------------------------------------------------------------
// Layout (pure; testable without a renderer)
// --------------------------------------------------------------------------------------------------------------------
// Every mapped part of a row as an independent world-space rect, so a multi-part row keeps the geodata's own pieces.
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

// The four world-space corners of one part (for the canopy's open-centre and roof-bounds checks).
function partCorners(part) {
  const { cx, cz, ang, halfW, halfD } = part;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const out = [];
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const u = su * halfW, v = sv * halfD;
    out.push({ x: cx + u * cs + v * sn, z: cz - u * sn + v * cs });
  }
  return out;
}

// The four faces of a part in world space. `along` is the face's own direction; `normal` points outward. The panel yaw
// is atan2(-along.z, along.x) so a box's local x lies along the face (the Terminal face-alignment bug).
function partFaces(part) {
  const { cx, cz, ang, halfW, halfD } = part;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const ux = cs, uz = -sn;   // local +u in world
  const vx = sn, vz = cs;    // local +v in world
  const yawU = Math.atan2(-vz, vx); // faces whose along is the v axis
  const yawV = Math.atan2(-uz, ux); // faces whose along is the u axis
  return [
    { id: '+u', cx: cx + ux * halfW, cz: cz + uz * halfW, along: [vx, vz], normal: [ux, uz], length: 2 * halfD, yaw: yawU },
    { id: '-u', cx: cx - ux * halfW, cz: cz - uz * halfW, along: [vx, vz], normal: [-ux, -uz], length: 2 * halfD, yaw: yawU },
    { id: '+v', cx: cx + vx * halfD, cz: cz + vz * halfD, along: [ux, uz], normal: [vx, vz], length: 2 * halfW, yaw: yawV },
    { id: '-v', cx: cx - vx * halfD, cz: cz - vz * halfD, along: [ux, uz], normal: [-vx, -vz], length: 2 * halfW, yaw: yawV }
  ];
}

// The east face: the face whose outward normal points most nearly +x (grid east). The official caption places the
// entrance on the east side; the mapped orientation supplies which face that is.
function eastFace(part) {
  const faces = partFaces(part);
  let best = faces[0];
  for (const f of faces) if (f.normal[0] > best.normal[0]) best = f;
  return best.normal[0] > 0.5 ? best : null;
}

// A panel on a face: `width` along the face, `y0..y1` vertical, `offset` outward from the wall, `alongOffset` along the
// face from its centre. Returns a world box record for boxGeo.
function facePanel(face, { y0, y1, width, offset = 0.02, thickness = 0.12, alongOffset = 0 }) {
  const nx = face.normal[0], nz = face.normal[1];
  const ax = face.along[0], az = face.along[1];
  return {
    x: face.cx + nx * (thickness / 2 + offset) + ax * alongOffset,
    y: (y0 + y1) / 2,
    z: face.cz + nz * (thickness / 2 + offset) + az * alongOffset,
    w: width, h: y1 - y0, d: thickness, ry: face.yaw
  };
}

// The layout: resolved rows, their mapped parts, and the east face of the main volume. Pure data.
function mainBuildingLayout(G = C?.GEO) {
  const rows = resolveRows(G);
  if (!rows) return { supported: false, rows: [], unresolved: MAIN_BUILDING_ROWS.length };
  const out = [];
  const unresolved = [];
  for (const { spec, row } of rows) {
    if (row === null) { unresolved.push(spec); continue; }
    const parts = rowParts(G.buildings, row);
    if (!parts.length) { unresolved.push(spec); continue; }
    out.push({ row, role: spec.role, h: spec.h, parts });
  }
  const main = out.find((r) => r.role === 'main-volume') || null;
  const east = main ? eastFace(main.parts[0]) : null;
  // The NE entrance canopy strip (unnamed row, its own footprint and height); resolved by centre + height, never row
  // index. `props` carries the strip's real world corners so the tests can check the open centre and the roof bounds.
  const canopyRow = resolveEntranceCanopyRow(G);
  let entranceCanopy = null;
  if (canopyRow) {
    const b = G.buildings[canopyRow.row];
    const part = rowParts(G.buildings, canopyRow.row)[0];
    if (part) {
      const corners = partCorners(part);
      const xs = corners.map((c) => c.x), zs = corners.map((c) => c.z);
      entranceCanopy = {
        row: canopyRow.row, h: part.h, part, corners,
        bounds: {
          minX: Math.min(...xs), maxX: Math.max(...xs),
          minZ: Math.min(...zs), maxZ: Math.max(...zs)
        },
        mappedRow: { cx: b[0], cz: b[1], ang: b[2], parts: b[3], h: b[4] }
      };
    }
  }
  return {
    supported: supportedCityFrame(G),
    rows: out,
    unresolved: unresolved.length,
    mainVolume: main ? { row: main.row, h: main.h, part: main.parts[0], east } : null,
    entranceCanopy,
    estimates: MAIN_BUILDING_ESTIMATES
  };
}

// --------------------------------------------------------------------------------------------------------------------
// Geometry (THREE)
// --------------------------------------------------------------------------------------------------------------------
function boxGeo(THREE, b) {
  const g = new THREE.BoxGeometry(b.w, b.h, b.d);
  if (b.ry) g.rotateY(b.ry);
  return g.translate(b.x, b.y, b.z);
}

function merge(THREE, geos) {
  const mergeGeometries = C?.Addons?.mergeGeometries;
  if (!mergeGeometries) throw new Error('waterfront-main-building: CITY.Addons.mergeGeometries is required');
  const norm = [];
  for (const g of geos) {
    if (!g || !g.attributes) throw new Error('waterfront-main-building: a non-geometry reached merge');
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

// A source-wording lettering plane: white text on a black field, drawn once into a bounded canvas (no copied photo
// pixels), returned as a THREE.CanvasTexture. `widthRatio` is the text budget (text width / plane width). A DOM-less
// runtime (Node tests) returns null; the caller then keeps the plain black panel. The canvas is sized to the plane's
// aspect so letters are natural, not stretched.
function letteringTexture(THREE, text, { planeWidth, planeHeight, widthRatio = 0.8, capFraction = 0.55, weight = 'bold', fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' } = {}) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  if (!THREE || !THREE.CanvasTexture) return null;
  const aspect = Math.max(0.2, planeWidth / Math.max(0.05, planeHeight));
  // Size the canvas from a fixed target height (the lettering is a thin band), then set the width from the plane's real
  // aspect so letters are never stretched. The long side is capped so a wide fascia stays bounded.
  const MAX_PX = 1024; // bounded per-sign canvas (the lettering is one thin band; 1 K on the long side is ample)
  let H = 96, W = Math.round(H * aspect);
  if (W > MAX_PX) { W = MAX_PX; H = Math.max(32, Math.round(W / aspect)); }
  else if (W < 64) { W = 64; H = Math.max(32, Math.round(W / aspect)); }
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#0a0b0d'; // black fascia/canopy field
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // letter cap height as a fraction of the plane height, converted to pixels; shrink to fit the width budget
  let size = Math.max(8, Math.round(H * capFraction));
  ctx.font = `${weight} ${size}px ${fontFamily}`;
  const budget = W * widthRatio;
  while (ctx.measureText(text).width > budget && size > 6) {
    size -= Math.max(1, Math.round(size * 0.06));
    ctx.font = `${weight} ${size}px ${fontFamily}`;
  }
  ctx.fillText(text, W / 2, H * 0.52);
  const tex = new THREE.CanvasTexture(canvas);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A lettering mesh: a thin plane set just proud of a face, sampling the lettering texture. MeshBasicMaterial keeps the
// lettering legible regardless of the sun (the repo's ferry/sign convention) and needs no UV node graph, so it is the
// safe path on both WebGPU and WebGL2.
function letteringPlane(THREE, tex, { cx, cy, cz, w, h, yaw, name }) {
  if (!tex || !THREE.PlaneGeometry) return null;
  const Mat = THREE.MeshBasicMaterial;
  if (!Mat) return null;
  const geo = new THREE.PlaneGeometry(w, h);
  const mat = new Mat({ map: tex, side: THREE.DoubleSide, toneMapped: false });
  mat.name = `${name}-material`;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.position.set(cx, cy, cz);
  mesh.rotation.y = yaw;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.role = name;
  mesh.userData.cullDistance = 900;
  mesh.userData.cullCell = 120;
  return mesh;
}

function addBoxCollider(colliders, cx, cz, hw, hd, ang, minY, maxY, kind) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const ex = Math.abs(cs) * hw + Math.abs(sn) * hd, ez = Math.abs(sn) * hw + Math.abs(cs) * hd;
  colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY, prop: false, kind, obb: { cx, cz, hx: hw, hz: hd, cs, sn } });
}

// The main volume's photographed east face: dark charcoal spandrels, full-height ground glazing, two wide white/silver
// framed window ribbons, and a BLACK top fascia carrying WHITE "Harbourfront Centre" lettering. There is NO canopy on
// this face: the real NE entrance canopy is the separate unnamed strip row (addEntranceCanopy below). Returns the
// fascia lettering-plane spec.
function addEastFace(THREE, geos, part, face, stats) {
  const E = MAIN_BUILDING_ESTIMATES;
  const H = part.h;
  const storey = (H - SW) / E.storeys;
  const W = face.length;
  const add = (mat, b) => geos[mat].push(boxGeo(THREE, b));
  const inset = E.ribbonInset;

  // full-height ground glazing, with white/silver vertical mullions
  const gTop = Math.min(E.groundGlazingTop, storey - 0.4);
  add('glass', facePanel(face, { y0: SW + 0.3, y1: gTop, width: W - 2 * inset, offset: 0.03 }));
  const mullions = Math.max(2, Math.round((W - 2 * inset) / E.mullionSpacing));
  for (let i = 0; i <= mullions; i++) {
    const along = -(W - 2 * inset) / 2 + (i * (W - 2 * inset)) / mullions;
    add('frame', facePanel(face, { y0: SW + 0.3, y1: gTop, width: 0.12, offset: 0.06, alongOffset: along }));
  }
  stats.groundMullions = mullions + 1;

  // the two upper window ribbons, each in a white/silver frame
  for (let level = 1; level <= 2; level++) {
    const y0 = SW + level * storey + 0.9;
    const y1 = Math.min(SW + (level + 1) * storey - 0.9, H - (level === 2 ? E.fasciaHeight + 0.2 : 0.4));
    if (y1 - y0 < 0.6) continue;
    add('frame', facePanel(face, { y0: y0 - 0.25, y1: y1 + 0.25, width: W - 2 * inset + 0.4, offset: 0.02 }));
    add('glass', facePanel(face, { y0, y1, width: W - 2 * inset, offset: 0.05 }));
    const n = Math.max(2, Math.round((W - 2 * inset) / E.mullionSpacing));
    for (let i = 0; i <= n; i++) {
      const along = -(W - 2 * inset) / 2 + (i * (W - 2 * inset)) / n;
      add('frame', facePanel(face, { y0, y1, width: 0.1, offset: 0.08, alongOffset: along }));
    }
    stats.ribbons = (stats.ribbons || 0) + 1;
  }

  // the BLACK branding fascia at the top of the east face; a WHITE-lettered band rides its outward face, centred on the
  // face and bounded (E.fasciaTextBandWidth, never the whole 45 m face) so the letters read at a natural size.
  const fasciaY0 = H - E.fasciaHeight, fasciaY1 = H - 0.1;
  add('fascia', facePanel(face, { y0: fasciaY0, y1: fasciaY1, width: W, offset: 0.04, thickness: 0.16 }));
  const bandW = Math.min(W * 0.9, E.fasciaTextBandWidth);
  const bandH = (fasciaY1 - fasciaY0) * 0.92;
  const fasciaPanel = facePanel(face, { y0: fasciaY1 - bandH, y1: fasciaY1, width: bandW, offset: 0.25, thickness: 0.04 });
  const fasciaSign = {
    text: E.fasciaText,
    cx: fasciaPanel.x, cy: fasciaPanel.y, cz: fasciaPanel.z,
    w: bandW, h: bandH, yaw: face.yaw,
    widthRatio: 0.9, capFraction: E.fasciaTextCapFraction, name: 'WaterfrontMainBuilding-FasciaText'
  };
  return { fasciaSign };
}

// The northeast entrance canopy: the real unnamed 15.8 m × 3.6 m strip row north of the three-storey block
// (PHOTO/MAP INFERENCE — the captain's photograph reading of the 2025 access guide p.4/p.10 plus the strip's own mapped
// footprint and 4.3 m height; NOT an explicit OSM canopy tag). It is a thin white/silver roof with white underside beams,
// a black leading (east) fascia carrying white "235", and restrained support posts at the corners and mid edges. The
// middle stays OPEN: the approach under it is walkable ground, with no house walls and no collider blocking the walkway.
// Only the thin posts get colliders, plus one overhead roof-plane collider at canopyRoofMinY (so a pedestrian walks under).
// Returns { postCount, roofMinY, fasciaSign }.
function addEntranceCanopy(THREE, geos, part, stats) {
  const E = MAIN_BUILDING_ESTIMATES;
  const add = (mat, b) => geos[mat].push(boxGeo(THREE, b));
  const { cx, cz, ang, halfW, halfD } = part;
  const H = part.h;
  // The strip's long axis is its local u axis (along world z); its thin axis is local v (along world x). Rotated boxes take
  // the same `ang` the mapped row carries, so every piece lands exactly inside the mapped strip.
  const ry = ang;
  const roofY0 = H - E.canopyRoofThickness;
  // thin roof slab spanning the whole mapped strip footprint, at the mapped height
  add('canopyRoof', { x: cx, y: roofY0 + E.canopyRoofThickness / 2, z: cz, w: 2 * halfW, h: E.canopyRoofThickness, d: 2 * halfD, ry });
  // white underside transverse beams: each spans the thin (east-west) depth and they are spaced along the long axis
  const longLen = 2 * halfW;   // the long axis (local u, along world z)
  const thinLen = 2 * halfD;   // the thin axis (local v, along world x)
  const beams = Math.max(2, Math.round(longLen / E.canopyBeamSpacing));
  const ux = Math.cos(ang), uz = -Math.sin(ang); // local +u in world (long axis)
  // keep the end beams a beam thickness inside the long ends so a corner vertex cannot cross the mapped strip edge
  const beamHalf = 0.07, endInset = 2 * beamHalf + 0.02;
  for (let i = 0; i <= beams; i++) {
    const along = -(halfW - endInset) + (i * 2 * (halfW - endInset)) / beams;
    add('canopyBeam', { x: cx + ux * along, y: roofY0 - E.canopyBeamDepth / 2, z: cz + uz * along, w: 0.14, h: E.canopyBeamDepth, d: thinLen - 0.3, ry });
  }
  stats.canopyBeams = beams + 1;
  // the black leading fascia on the east (thin +x) edge, carrying the white "235"
  const east = partFaces(part).reduce((a, f) => (f.normal[0] > a.normal[0] ? f : a));
  const fasciaH = E.canopyFasciaHeight;
  add('canopyFascia', facePanel(east, { y0: roofY0 - fasciaH, y1: roofY0 + 0.02, width: longLen - 0.2, offset: 0.02, thickness: 0.12 }));
  const bandW = (longLen - 0.2) * E.canopyFasciaTextBandFraction;
  const bandH = fasciaH * 0.86;
  const signPanel = facePanel(east, { y0: roofY0 - fasciaH + (fasciaH - bandH) / 2, y1: roofY0 - fasciaH + (fasciaH + bandH) / 2, width: bandW, offset: 0.20, thickness: 0.04 });
  const fasciaSign = {
    text: E.canopySignText,
    cx: signPanel.x, cy: signPanel.y, cz: signPanel.z,
    w: bandW, h: bandH, yaw: east.yaw,
    widthRatio: 0.7, capFraction: E.canopyFasciaTextCapFraction, name: 'WaterfrontMainBuilding-CanopyText'
  };

  // restrained support posts: the four corners plus the mid-point of each long (north/south) edge. They are thin, they
  // leave the centre open, and they are the only canopy colliders besides the overhead roof plane.
  const vx = Math.sin(ang), vz = Math.cos(ang);  // local +v in world (thin axis)
  const uEdge = halfW - E.canopyPostEdgeInset;
  const vEdge = halfD - E.canopyPostEdgeInset;
  const postSpots = [
    [uEdge, vEdge], [uEdge, -vEdge], [-uEdge, vEdge], [-uEdge, -vEdge], [uEdge, 0], [-uEdge, 0]
  ];
  const posts = [];
  for (const [u, v] of postSpots) {
    const x = cx + u * ux + v * vx, z = cz + u * uz + v * vz;
    add('canopyPost', { x, y: roofY0 / 2, z, w: E.canopyPostSize, h: roofY0, d: E.canopyPostSize, ry });
    posts.push({ x, z, u, v });
  }
  stats.canopyPosts = posts.map((p) => ({ x: p.x, z: p.z }));
  stats.canopyRoofMinY = roofY0 - E.canopyBeamDepth;
  stats.canopyRoofBounds = { cx, cz, halfW: 2 * halfW, halfD: 2 * halfD };
  return { fasciaSign, posts, roofMinY: roofY0 };
}

// A conservative institutional envelope for the other volumes: light-gray cladding, a wide window ribbon on each long
// face, and a flat gray roof. Roof cores get no windows (hidden mechanical/stair volumes).
function addConservativeVolume(THREE, geos, part, role, stats) {
  const add = (mat, b) => geos[mat].push(boxGeo(THREE, b));
  const H = part.h;
  const faces = partFaces(part);
  // the two long faces (the ±v faces when the part is longer in u, else the ±u faces)
  const longFaces = part.halfW >= part.halfD ? faces.filter((f) => f.id === '+v' || f.id === '-v') : faces.filter((f) => f.id === '+u' || f.id === '-u');
  if (role !== 'roof-core') {
    for (const face of longFaces) {
      const W = face.length;
      if (W < 4) continue;
      const y0 = Math.max(SW + 0.6, H * 0.42);
      const y1 = Math.min(H - 0.6, y0 + Math.min(1.8, H * 0.28));
      if (y1 - y0 < 0.5) continue;
      add('frame', facePanel(face, { y0: y0 - 0.2, y1: y1 + 0.2, width: W - 1.6, offset: 0.02 }));
      add('glass', facePanel(face, { y0, y1, width: W - 2.0, offset: 0.05 }));
      stats.ribbons = (stats.ribbons || 0) + 1;
    }
  }
}

// --------------------------------------------------------------------------------------------------------------------
// Builder: returns { group, colliders, stats }
// --------------------------------------------------------------------------------------------------------------------
function createWaterfrontMainBuilding(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-main-building: THREE is required');
  const layout = mainBuildingLayout();
  const group = new THREE.Group();
  group.name = 'WaterfrontMainBuilding';
  const colliders = [];
  const stats = {
    supported: layout.supported, rows: 0, parts: 0, meshes: 0, triangles: 0, colliders: 0,
    excludedRows: [], unresolved: layout.unresolved, ribbons: 0, groundMullions: 0,
    estimates: MAIN_BUILDING_ESTIMATES
  };

  if (!layout.supported || !layout.rows.length) {
    // An unsupported / rebuild path must clear any exclusion state from a PREVIOUS successful build in another frame, or
    // buildings.js would keep suppressing this frame's (different, now-unrelated) rows. Reset both the row set and the
    // predicate to the fail-closed default before returning.
    C.waterfrontMainBuildingExcludedRows = new Set();
    C.waterfrontMainBuildingBuiltGEO = null;
    C.waterfrontMainBuildingExcludesBuilding = () => false;
    group.userData.waterfrontMainBuilding = stats;
    if (scene && scene.add) scene.add(group);
    console.info('[waterfrontMainBuilding] skipped: the active city frame does not cover the mapped Main Building rows');
    return { group, colliders, stats, layout };
  }

  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const geos = {
    charcoal: [], cladding: [], glass: [], frame: [], roof: [], fascia: [],
    canopyRoof: [], canopyBeam: [], canopyFascia: [], canopyPost: []
  };
  const add = (mat, b) => geos[mat].push(boxGeo(THREE, b));

  for (const item of layout.rows) {
    for (const part of item.parts) {
      const H = part.h;
      const isMain = item.role === 'main-volume';
      // the volume: one box per mapped part, from the ground to the mapped height
      add(isMain ? 'charcoal' : 'cladding', { x: part.cx, y: H / 2, z: part.cz, w: 2 * part.halfW, h: H, d: 2 * part.halfD, ry: part.ang });
      // the flat gray roof cap, slightly inset
      add('roof', { x: part.cx, y: H + 0.06, z: part.cz, w: 2 * part.halfW - MAIN_BUILDING_ESTIMATES.roofCapInset, h: 0.12, d: 2 * part.halfD - MAIN_BUILDING_ESTIMATES.roofCapInset, ry: part.ang });
      // the native part collider (the mapped footprint, the mapped height)
      addBoxCollider(colliders, part.cx, part.cz, part.halfW, part.halfD, part.ang, 0, H, 'main-building');
      stats.parts++;
    }
    stats.rows++;
  }

  // the photographed east face of the main volume; its fascia lettering spec is attached after the merged meshes exist
  let signSpecs = null;
  if (layout.mainVolume && layout.mainVolume.east) {
    signSpecs = addEastFace(THREE, geos, layout.mainVolume.part, layout.mainVolume.east, stats);
  }
  // the conservative envelope for every other volume
  for (const item of layout.rows) {
    if (item.role === 'main-volume') continue;
    for (const part of item.parts) addConservativeVolume(THREE, geos, part, item.role, stats);
  }

  // the real northeast entrance canopy: the unnamed strip row north of the three-storey block. It is NOT one of the ten
  // named Main Building rows, so it is drawn (and collided) here, and its row is added to the exclusion set so the
  // generic "brick house" massing that stood on the strip is not drawn underneath it. `layout.supported` already fails
  // closed when the strip is missing/ambiguous.
  let canopyResult = null;
  if (layout.entranceCanopy) {
    const cp = layout.entranceCanopy.part;
    canopyResult = addEntranceCanopy(THREE, geos, cp, stats);
    // thin post colliders only (the walkway between them stays open) and one overhead roof plane at the roof underside
    for (const post of canopyResult.posts) {
      const s = MAIN_BUILDING_ESTIMATES.canopyPostSize / 2 + MAIN_BUILDING_ESTIMATES.canopyPostColliderPad;
      addBoxCollider(colliders, post.x, post.z, s, s, cp.ang, 0, canopyResult.roofMinY, 'main-building-canopy-post');
    }
    // overhead roof plane: minY at the roof underside, so the space under the canopy is walkable but the roof is solid
    addBoxCollider(colliders, cp.cx, cp.cz, cp.halfW, cp.halfD, cp.ang, canopyResult.roofMinY, cp.h, 'main-building-canopy-roof');
    stats.canopyRow = layout.entranceCanopy.row;
  }

  const materials = {
    charcoal: standardMaterial(THREE, { color: 0x3a3d40, roughness: 0.68, metalness: 0.18 }),
    cladding: standardMaterial(THREE, { color: 0xb8bcc0, roughness: 0.82, metalness: 0.08 }),
    glass: standardMaterial(THREE, { color: 0x2a3744, roughness: 0.18, metalness: 0.55 }),
    frame: standardMaterial(THREE, { color: 0xd8dadd, roughness: 0.42, metalness: 0.45 }),
    roof: standardMaterial(THREE, { color: 0x8a8d90, roughness: 0.9, metalness: 0.05 }),
    // the top fascia and the canopy leading fascia are BLACK (white source lettering rides them); the canopy roof is
    // WHITE/SILVER (the photograph's long light-coloured awning) whose underside beams and posts are the same light metal.
    // WHITE/SILVER (the photograph's long light-coloured awning) whose underside beams and posts are the same light metal.
    fascia: standardMaterial(THREE, { color: 0x121316, roughness: 0.55, metalness: 0.15 }),
    canopyRoof: standardMaterial(THREE, { color: 0xe4e6e8, roughness: 0.5, metalness: 0.25 }),
    canopyBeam: standardMaterial(THREE, { color: 0xd8dadd, roughness: 0.42, metalness: 0.4 }),
    canopyFascia: standardMaterial(THREE, { color: 0x121316, roughness: 0.55, metalness: 0.15 }),
    canopyPost: standardMaterial(THREE, { color: 0xc8ccd0, roughness: 0.4, metalness: 0.5 })
  };

  let triangles = 0;
  for (const key of Object.keys(geos)) {
    const list = geos[key];
    if (!list.length) continue;
    const geo = merge(THREE, list);
    const mesh = new THREE.Mesh(geo, materials[key]);
    mesh.name = `WaterfrontMainBuilding-${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = 900;
    mesh.userData.cullCell = 120;
    mesh.userData.role = `main-building-${key}`;
    group.add(mesh);
    stats.meshes++;
    triangles += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
  }

  // White source lettering planes on the black fascia and canopy: one shared canvas texture per sign (bounded, no copied
  // photo pixels). In a DOM-less runtime (Node tests) letteringTexture returns null and the black panels stand plain.
  stats.lettering = { fascia: false, canopy: false };
  const signList = [];
  if (signSpecs && signSpecs.fasciaSign) signList.push(signSpecs.fasciaSign);
  if (canopyResult && canopyResult.fasciaSign) signList.push(canopyResult.fasciaSign);
  if (signList.length) {
    for (const spec of signList) {
      const tex = letteringTexture(THREE, spec.text, {
        planeWidth: spec.w, planeHeight: spec.h, widthRatio: spec.widthRatio, capFraction: spec.capFraction
      });
      const plane = letteringPlane(THREE, tex, spec);
      if (plane) {
        group.add(plane);
        stats.meshes++;
        const g = plane.geometry;
        triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
        if (spec.name.endsWith('FasciaText')) stats.lettering.fascia = true;
        if (spec.name.endsWith('CanopyText')) stats.lettering.canopy = true;
      }
    }
  }

  stats.triangles = Math.round(triangles);
  stats.colliders = colliders.length;
  // the exclusion set covers the ten named Main Building rows PLUS the entrance-canopy strip row (unnamed), so the
  // generic massing on the strip is not drawn under the real canopy. No other unnamed row is ever added.
  stats.excludedRows = layout.rows.map((r) => r.row);
  if (layout.entranceCanopy) stats.excludedRows.push(layout.entranceCanopy.row);
  stats.excludedRows.sort((a, b) => a - b);
  stats.ms = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10;
  group.userData.waterfrontMainBuilding = stats;
  if (scene && scene.add) scene.add(group);

  // The exclusion hook: exported ONLY after a successful build, and only for rows actually drawn. It captures the GEO it
  // was built against: if the active frame is later swapped for an unrelated/reordered GEO, these row indices now name
  // different buildings, so the predicate returns false and suppresses nothing. buildings.js calls this before
  // buildCityBlocks, after the waterfront builders run.
  const builtGEO = C?.GEO || null;
  const rows = new Set(stats.excludedRows);
  C.waterfrontMainBuildingExcludedRows = rows;
  C.waterfrontMainBuildingBuiltGEO = builtGEO;
  C.waterfrontMainBuildingExcludesBuilding = (bi) => {
    if (C?.GEO !== builtGEO) return false;        // the active frame is not the one this build described
    if (!Number.isInteger(bi) || bi < 0) return false;
    return rows.has(bi);
  };

  const result = { group, colliders, stats, layout };
  C.waterfrontMainBuilding = result;
  console.info(`[waterfrontMainBuilding] ${stats.rows} rows / ${stats.parts} mapped parts, ${stats.meshes} merged meshes, ` +
    `${stats.triangles} triangles, ${stats.colliders} colliders; excluding building rows [${stats.excludedRows.join(', ')}]`);
  return result;
}

// The predicate exists from load (so buildings.js always has a callable) but excludes nothing until a successful build.
if (C && typeof C.waterfrontMainBuildingExcludesBuilding !== 'function') {
  C.waterfrontMainBuildingExcludesBuilding = () => false;
}
if (C && C.waterfrontMainBuildingBuiltGEO === undefined) C.waterfrontMainBuildingBuiltGEO = null;

Object.assign(C || (window.CITY = {}), {
  MAIN_BUILDING_ROWS,
  MAIN_BUILDING_ESTIMATES,
  ENTRANCE_CANOPY_ROW,
  ENTRANCE_CANOPY_FRAME,
  waterfrontMainBuildingLayout: (G = C?.GEO) => mainBuildingLayout(G),
  waterfrontMainBuildingSupported: (G = C?.GEO) => supportedCityFrame(G),
  waterfrontMainBuildingResolveRows: (G = C?.GEO) => resolveRows(G),
  waterfrontEntranceCanopyRow: (G = C?.GEO) => resolveEntranceCanopyRow(G),
  createWaterfrontMainBuilding,
  buildWaterfrontMainBuilding: createWaterfrontMainBuilding
});
})();
