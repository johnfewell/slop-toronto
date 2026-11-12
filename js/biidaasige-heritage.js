(function () {
// js/biidaasige-heritage.js
// Biidaasige Park's retained heritage and placekeeping structures (bead st-bmyv.6, child of the st-bmyv epic):
//
//   1. FIRE HALL 30 — ERA Architects, relocated 24 m south and restored as the park's community facility.
//   2. TH? ATLAS CRANE — the preserved 1961 300-ton marine cargo crane (heritage-designated machinery).
//   3. THE DRUM — Tawaw Architecture Collective's 2026 13-moons shade/gathering structure (NORTH picnic play lawn).
//   4. Marine Terminal 35 retained heritage fragments + interpretive signage factories (unplaced; used once a site
//      is source-verified).
//
// Every builder is a pure, LOCAL-ORIGIN geometry factory: origin at the ground-contact centre of the footprint,
// +Y up, 1 unit = 1 m, the "front" (the entrance/plaque face) pointing +Z. Builders never read a scene, a network
// or a texture, never guess a park coordinate and never invent an Indigenous motif, moon graphic, student proposal
// or future amenity. The layout helpers below are the ONLY thing that places anything: they ask the verified
// current-OSM data helpers (js/biidaasige-park-data.js: C.biidaasigeParkRingWorld / C.biidaasigeParkWorld) and they
// return null ("fail closed") when the frame is absent or the feature is not source-verified.
//
// Sourcing (all read and cross-checked 2026-11-10; the Captain's photo/source review in
// $WATERFRONT_RESEARCH/biidaasige/heritage-photo-review.md is authoritative for the visual facts):
//
//   FIRE HALL 30: https://www.eraarch.ca/projects/biidaasige-park-firehall-30/ (ERA lead design, heritage
//     architectural + heritage planning; "Originally constructed in 1922 ... relocated 24 metres south ... the
//     building was relocated ... the two-storey interior was also adapted ... new public washrooms ... ground floor,
//     directly accessed from the exterior. The historic masonry exterior was repaired, and the building enclosure
//     was renewed by replacing the failed windows and roofing."). Edwardian Classical, red brick.
//     Mapped footprint: OSM way/494886782, 21.5 x 13.5 m, 247 m2 (js/biidaasige-park-data.js 'old-fire-hall-30').
//     Photos (© Mina Markovic, credited, NOT copied into the repository): the 10 project photos linked from the
//     ERA page, e.g. 01_Fire-Hall-30_MG_5529_Mina-Markovic.jpg.
//   ATLAS CRANE: https://www.waterfrontoronto.ca/news/meet-atlas-crane-unusual-park-feature-port-lands —
//     "The 300-ton Atlas Crane ... Installed in 1961 ... one of the last cranes of its kind on the Great Lakes ...
//     designated heritage structure ... being painted white to match its original colour ... new feature lighting."
//     The CISC-ICCA project page that surfaces with a search for the crane is a TMU STUDENT proposal (Jake Levy,
//     faculty sponsor Vincent Hui) for an observation platform; it is NOT evidence of what was built and its stairs/
//     platform are deliberately NOT modelled. The Waterfront Toronto page's "around 20 levels of scaffolding,
//     reaching 40 metres (140 ft) high" describes the RESTORATION scaffolding, not the crane's own dimensions, so the
//     crane's height here is an explicit photo-estimate, not a measurement. "300-ton" is the structure mass label the
//     source publishes; NO lifting capacity is published, so none is claimed. The Captain's read of the actual
//     Waterfront Toronto restoration photo (captain/atlas-wt.jpg) is authoritative for the FORM: a white gantry /
//     A-frame of four lattice columns in two leaning pairs, a top crossbeam and one long lattice boom sloping to the
//     ground out front — not a turret crane. Photo: Waterfront Toronto news photo (credited, not copied).
//   THE DRUM: https://www.tawarc.com/all-projects/the-drum-at-biidaasige-park — 2026, architect of record Tawaw
//     Architecture Collective Inc., 2,164 ft2 / 201 m2, "Positioned at the North Picnic Play Lawn area ... the 13
//     moons theme ... a Shade Structure". The Captain's read of the built photos: a circular OPEN central oculus; a
//     salmon-red triangulated roof annulus with WHITE perimeter + radial trusses; a ring of paired cream diagonal
//     V-timber struts on grey concrete feet; red-orange curved panel walls at some intervals; generous open-gap
//     entrances; a grey circular ground apron. No moon or cultural graphics are invented here.
//
// Height policy: the only height labels written to data are SOURCE labels. The Fire Hall is "building:levels = 2"
// (two storeys, ERA) plus an explicit representative height for rendering (SOURCE_REPRESENTATIVE_HEIGHT below);
// the Drum is a representative photo-estimate; the crane is a photo-estimate range. `heights` records each label and
// where it came from so the Captain can render the label without turning an estimate into a survey.
//
// Contract: `climbable` is always false; every built structure returns its own `colliders` (opaque boxes / OBBs
// tagged with its id) and a merged-by-material, bounded-frustum-culled `group`; no hidden generic house collision,
// no empty stand-in box is ever returned as "finished".

const C = (typeof window !== 'undefined' && (window.CITY || (window.CITY = {}))) || {};
const THREE = C.THREE;

// -------------------------------------------------------------------------------------------------------------------
// Source constants. Anything the sources do NOT state stays out of here.
// -------------------------------------------------------------------------------------------------------------------
const SOURCES = Object.freeze({
  fireHall: 'https://www.eraarch.ca/projects/biidaasige-park-firehall-30/',
  fireHallPhotos: 'https://www.eraarch.ca/projects/biidaasige-park-firehall-30/ (photos © Mina Markovic)',
  atlas: 'https://www.waterfrontoronto.ca/news/meet-atlas-crane-unusual-park-feature-port-lands',
  atlasPhoto: 'Waterfront Toronto news photos (credited, not copied)',
  drum: 'https://www.tawarc.com/all-projects/the-drum-at-biidaasige-park',
  drumPhoto: 'Tawâw Architecture Collective built photos (credited, not copied)',
  marineTerminal:
    'https://www.waterfrontoronto.ca/news/torontos-largest-park-in-a-generation-just-got-bigger (MT35 retained elements)'
});

const ATTRIBUTION = Object.freeze({
  fireHall: 'Fire Hall 30 — ERA Architects with Waterfront Toronto and MVVA; photography © Mina Markovic. Procedural reconstruction for Slop Toronto.',
  atlas: 'Atlas Crane — Waterfront Toronto (heritage restoration). Procedural reconstruction for Slop Toronto.',
  drum: 'The Drum — Tawâw Architecture Collective Inc. Procedural reconstruction for Slop Toronto.',
  heritageFragments: 'Marine Terminal 35 retained heritage elements — Waterfront Toronto. Procedural reconstruction for Slop Toronto.',
  interpretive: 'Biidaasige Park interpretive signage — procedural reconstruction for Slop Toronto.'
});

// The Fire Hall's height LABELS. "building:levels = 2" is the source label; 6.5 m is an explicit REPRESENTATIVE
// height for rendering at two storeys (the Captain renders the label, not a survey). No guessed clamp.
const FIREHALL_HEIGHTS = Object.freeze({
  levels: 2,
  levelsSource: 'building:levels=2 (two storeys, ERA Architects)',
  representativeM: 6.5,
  representativeSource: 'explicit representative height for a two-storey building (NOT measured, NOT a plan dimension)'
});

// The Drum's footprint area is a source fact (201 m2); the radius below is the geometric equivalent circle used
// only to lay out a recognisable footprint, and every height is an explicit photo-estimate.
const DRUM_SOURCE = Object.freeze({
  floorAreaM2: 201,
  completed: 2026,
  name: 'The Drum',
  architect: 'Tawaw Architecture Collective Inc.'
});
const DRUM_RADIUS = Math.sqrt(DRUM_SOURCE.floorAreaM2 / Math.PI); // ~8.0 m -> 16 m diameter (photo-estimate layout)

// The crane's dimensions are photo-estimates (the WT '40 m/140 ft' is restoration scaffolding, a different property).
// '300-ton' is the structure MASS label the source publishes; no lifting capacity is published, so none is claimed.
const ATLAS_ESTIMATE = Object.freeze({
  heightM: [35, 38],
  defaultHeightM: 36,
  heightSource: 'photo estimate (NOT measured; WT 40 m/140 ft is restoration scaffolding, a different property)',
  massLabelTons: 300,
  installed: 1961
});

// -------------------------------------------------------------------------------------------------------------------
// Geometry helpers (pure; all return THREE.BufferGeometry, already positioned/rotated in local coords).
// -------------------------------------------------------------------------------------------------------------------
const TAU = Math.PI * 2;

function boxGeo(THREE, cx, cy, cz, w, h, d, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(cx, cy, cz);
  return g;
}
// A box whose BOTTOM sits on y0 (so a wall/panel is placed by its base, never by its centre).
function boxFromBase(THREE, cx, y0, cz, w, h, d, ry = 0) {
  return boxGeo(THREE, cx, y0 + h / 2, cz, w, h, d, ry);
}
function cylGeo(THREE, cx, cy, cz, rTop, rBottom, h, seg, axis = 'y', openEnded = false) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, openEnded);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(cx, cy, cz);
  return g;
}
// A straight member (truss chord / strut) between two local points: a 6-side prism.
function beamGeo(THREE, a, b, radius = 0.09, sides = 6) {
  const A = new THREE.Vector3(a[0], a[1], a[2]);
  const B = new THREE.Vector3(b[0], b[1], b[2]);
  const dir = new THREE.Vector3().subVectors(B, A);
  const len = dir.length();
  if (len < 1e-6) return new THREE.BufferGeometry();
  const g = new THREE.CylinderGeometry(radius, radius, len, sides, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  g.translate(A.x + dir.x / 2, A.y + dir.y / 2, A.z + dir.z / 2);
  return g;
}
// An open annular prism (roof annulus / ground apron): an extruded ring. Not a solid disk.
function annulusGeo(THREE, inner, outer, y0, h, seg = 48) {
  const geos = [outer, inner].map((r) => {
    const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
    g.translate(0, y0 + h / 2, 0);
    return g;
  });
  // top + bottom faces (flats) as a ring of quads
  for (const y of [y0 + h, y0]) {
    const pos = [], nor = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      const o0 = [Math.sin(a0) * outer, y, Math.cos(a0) * outer];
      const o1 = [Math.sin(a1) * outer, y, Math.cos(a1) * outer];
      const i0 = [Math.sin(a0) * inner, y, Math.cos(a0) * inner];
      const i1 = [Math.sin(a1) * inner, y, Math.cos(a1) * inner];
      const ny = y === y0 ? -1 : 1;
      for (const tri of [[o0, o1, i1], [o0, i1, i0]]) for (const v of tri) { pos.push(...v); nor.push(0, ny, 0); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geos.push(g);
  }
  const merged = mergeGeos(THREE, geos);
  return merged;
}
// A curved (single-sweep) wall panel between two angles at a radius: a thin arc wall of given height.
function arcPanelGeo(THREE, radius, a0, a1, y0, h, thickness = 0.12, seg = 14) {
  const pos = [], nor = [];
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    pts.push({ a });
  }
  for (let i = 0; i < seg; i++) {
    const aA = pts[i].a, aB = pts[i + 1].a;
    const rIn = radius - thickness / 2, rOut = radius + thickness / 2;
    const P = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
    // outer face
    quad(pos, nor, P(aA, rOut, y0), P(aB, rOut, y0), P(aB, rOut, y0 + h), P(aA, rOut, y0 + h), [Math.sin((aA + aB) / 2), 0, Math.cos((aA + aB) / 2)]);
    // inner face
    quad(pos, nor, P(aB, rIn, y0), P(aA, rIn, y0), P(aA, rIn, y0 + h), P(aB, rIn, y0 + h), [-Math.sin((aA + aB) / 2), 0, -Math.cos((aA + aB) / 2)]);
    // top
    quad(pos, nor, P(aA, rOut, y0 + h), P(aB, rOut, y0 + h), P(aB, rIn, y0 + h), P(aA, rIn, y0 + h), [0, 1, 0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
function quad(pos, nor, a, b, c, d, n) {
  for (const v of [a, b, c, a, c, d]) pos.push(...v);
  for (let i = 0; i < 6; i++) nor.push(...n);
}
// The outward face normal of a triangle (a, b, c) — used for sloped roof quads.
function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

// Normalise every geometry to the SAME attribute set (position + normal, non-indexed) so the addon's
// mergeGeometries never fails on a cylinder that also carries uv while a hand-built quad does not.
function normaliseGeo(g) {
  const nb = g.index ? g.toNonIndexed() : g;
  const p = nb.attributes.position;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.array.subarray(0, p.count * 3)), 3));
  if (nb.attributes.normal) {
    const n = nb.attributes.normal;
    out.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n.array.subarray(0, n.count * 3)), 3));
  } else {
    out.computeVertexNormals();
  }
  return out;
}

function mergeGeos(THREE, list) {
  const geos = list.filter((g) => g && g.attributes && g.attributes.position && g.attributes.position.count);
  if (!geos.length) return null;
  const flat = geos.map(normaliseGeo);
  const merge = C && C.Addons && C.Addons.mergeGeometries;
  if (merge) {
    const out = merge(flat, false);
    for (const g of geos) if (!flat.includes(g)) g.dispose && g.dispose();
    return out;
  }
  // Fallback for the CPU test path without the addon: concatenate position+normal manually.
  let total = 0;
  for (const g of flat) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of flat) {
    const p = g.attributes.position, n = g.attributes.normal;
    pos.set(p.array.subarray(0, p.count * 3), o * 3);
    if (n) nor.set(n.array.subarray(0, n.count * 3), o * 3);
    o += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (!flat.some((g) => g.attributes.normal)) out.computeVertexNormals();
  return out;
}

function material(THREE, color, roughness = 0.85, metalness = 0.0) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat({ color, roughness, metalness });
}

// Assemble {key: [geo...]} into one Mesh per material bucket, bounded-culled, and count triangles.
function assemble(THREE, buckets, materials, name, opts = {}) {
  const group = new THREE.Group();
  group.name = name;
  const drawCalls = [];
  const cullDistance = opts.cullDistance || 800;
  const cullCell = opts.cullCell || 120;
  let triangles = 0;
  for (const key of Object.keys(buckets)) {
    const geo = mergeGeos(THREE, buckets[key]);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, materials[key] || materials.base || material(THREE, 0x999999));
    mesh.name = `${name}-${key}`;
    mesh.castShadow = opts.castShadow !== false && key !== 'glass' && key !== 'sign';
    mesh.receiveShadow = true;
    mesh.userData.role = key;
    mesh.userData.cullDistance = cullDistance;
    mesh.userData.cullCell = cullCell;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    group.add(mesh);
    const n = geo.attributes.position.count / 3;
    triangles += n;
    drawCalls.push({ key, triangles: n });
  }
  return { group, triangles, drawCalls };
}

function extent(THREE, group) {
  const b = new THREE.Box3();
  group.updateWorldMatrix(true, true);
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return b;
}

// The four ground-contact footprint corners of an OBB footprint (w along x, d along z, centred at x,z, rotated deg).
function obbCorners(x, z, w, d, rotDeg = 0) {
  const c = Math.cos((rotDeg * Math.PI) / 180), s = Math.sin((rotDeg * Math.PI) / 180);
  const hw = w / 2, hd = d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => ({ x: x + u * c + v * s, z: z - u * s + v * c }));
}

// -------------------------------------------------------------------------------------------------------------------
// 1. FIRE HALL 30 factory. Local origin = footprint centre at ground, front facade (+Z) is the Commissioners Street
//    face with the adapted former engine bay and the two ground-floor windows.
//
//    Source-backed parts (ERA text + Captain photo read): two storeys of red brick (Edwardian Classical); a captured
//    hip roof in dark asphalt grey with a cream heavy deep cornice/gutter; a cream stone belt course between floors; a
//    broad main volume with a slight narrower side bay (~2/3 + 1/3); the upper front has two groups of three tall
//    rectangular window openings (narrow/wide/narrow) with burgundy-red frames, cream stone flat lintels and sills,
//    alternating brick voussoirs and a cream keystone; a broad former engine bay (now a glazed black-framed entry) on
//    the ground floor's left with a cream stone surround and canopy, and three tall windows to its right; a brick
//    chimney on the rear hip step; a simpler, blank-brick rear. Washrooms open directly from the exterior (ERA), so the
//    ground-floor entry is a real opening. No invented colonnade, no copy of a copyrighted photo.
//
//    The front facade is symmetric in its window GROUPS only; here the +Z face carries the left bay (glazed bay +
//    right windows) so a viewer approaching from +Z reads the same left/right relationship as the ERA front photo.
// -------------------------------------------------------------------------------------------------------------------
function buildFireHall30(spec = {}) {
  if (!THREE) throw new Error('biidaasige-heritage: CITY.THREE is required');
  const W = Number.isFinite(spec.width) ? spec.width : (Number.isFinite(spec.widthM) ? spec.widthM : 21.5);
  const D = Number.isFinite(spec.depth) ? spec.depth : (Number.isFinite(spec.depthM) ? spec.depthM : 13.5);
  const H = Number.isFinite(spec.height) ? spec.height : FIREHALL_HEIGHTS.representativeM;
  const storey = H / 2;
  const sideBays = Array.isArray(spec.sideBays) ? spec.sideBays.length : 0; // informational only; geometry below is fixed
  // main volume = the broad ~2/3 volume; side bay = the narrower ~1/3 (ERA front photo: slight offset side bay)
  const mainW = W * 0.66, bayW = W - mainW - 0.4;
  const mainX = -W / 2 + mainW / 2 + 1.6, bayX = W / 2 - bayW / 2 - 0.2;
  const g = (list, key) => { (buckets[key] = buckets[key] || []).push(...list); };
  const buckets = {};

  // Walls: two storeys of red brick, each a solid panel from ground to its storey top, set back slightly at the
  // upper storey under the cornice (an Edwardian Classical detail, not a guess about dimension).
  const inset = 0.06;
  g([boxFromBase(THREE, 0, 0, 0, W, storey, D)], 'brick');
  g([boxFromBase(THREE, 0, storey, 0, W - 0.2, storey, D - 0.2)], 'brickUpper');
  // belt course (cream stone) between floors
  g([boxFromBase(THREE, 0, storey - 0.09, 0, W + 0.10, 0.18, D + 0.10)], 'stone');
  // heavy deep cornice + cream gutter under the roof edge
  g([boxFromBase(THREE, 0, H - 0.42, 0, W + 0.26, 0.42, D + 0.26)], 'stone');
  g([boxFromBase(THREE, 0, H - 0.06, 0, W + 0.34, 0.10, D + 0.34)], 'stone');

  // Hip roof: four sloping quads to a short ridge, dark asphalt grey, standing height above the cornice.
  const roofH = spec.roofHeight || 2.1;
  const eaveW = W + 0.42, eaveD = D + 0.42;
  const ridgeLen = Math.max(1.2, eaveW * 0.42);
  const r0 = H + 0.02;
  const roofGeos = [];
  const eave = [[-eaveW / 2, r0, -eaveD / 2], [eaveW / 2, r0, -eaveD / 2], [eaveW / 2, r0, eaveD / 2], [-eaveW / 2, r0, eaveD / 2]];
  const ridge = [[-ridgeLen / 2, r0 + roofH, 0], [ridgeLen / 2, r0 + roofH, 0]];
  const q = (a, b, c, d) => { const p = [], n = []; quad(p, n, a, b, c, d, faceNormal(a, b, c)); const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3)); roofGeos.push(geo); };
  q(eave[3], eave[2], ridge[1], ridge[0]); // +Z hip
  q(eave[1], eave[0], ridge[0], ridge[1]); // -Z hip
  q(eave[2], eave[1], ridge[1], ridge[1]); // +X hip (tri)
  q(eave[0], eave[3], ridge[0], ridge[0]); // -X hip (tri)
  g(roofGeos, 'roof');

  // Chimney on the rear hip step (Captain's back photo), brick with a cream cap.
  g([boxFromBase(THREE, mainX + 0.4, r0 + roofH * 0.4, -D * 0.28, 0.9, roofH * 0.9, 0.9)], 'brick');
  g([boxFromBase(THREE, mainX + 0.4, r0 + roofH * 1.3, -D * 0.28, 1.05, 0.12, 1.05)], 'stone');

  // Front (+Z) facade details. Façade plane z = D/2 (lower) and z = D/2 - 0.1 (upper).
  const zL = D / 2 + 0.015, zU = D / 2 - 0.1 + 0.015;
  // Burgundy-red frames, glass, cream lintels/sills/keystones and the black-framed glazed entry use distinct buckets.
  const winFront = (cx, y0, w, h, z, key = 'glass') => {
    // frame
    g([boxFromBase(THREE, cx, y0, z, w + 0.16, h + 0.16, 0.10)], 'frame');
    // glass inside (slightly recessed)
    g([boxFromBase(THREE, cx, y0 + 0.08, z + 0.03, w, h, 0.04)], key);
    // cream stone flat lintel + sill
    g([boxFromBase(THREE, cx, y0 + h + 0.08, z + 0.02, w + 0.34, 0.22, 0.16)], 'stone');
    g([boxFromBase(THREE, cx, y0 - 0.16, z + 0.02, w + 0.30, 0.18, 0.16)], 'stone');
    // cream keystone
    g([boxFromBase(THREE, cx, y0 + h + 0.16, z + 0.05, 0.30, 0.34, 0.18)], 'stone');
  };
  // Upper front: TRIADS of tall openings arranged narrow / wide / narrow (Captain's ERA front read), centred with
  // equal gaps, one over the main volume and one over the offset side bay.
  const triad = (cx) => {
    const narrow = 0.62, wide = 1.10, gap = 0.42;
    const total = narrow * 2 + wide + gap * 2;
    const y0 = storey + 0.55, h = storey - 0.95;
    const xNarrowL = cx - total / 2 + narrow / 2;
    const xWide = cx;
    const xNarrowR = cx + total / 2 - narrow / 2;
    winFront(xNarrowL, y0, narrow, h, zU);
    winFront(xWide, y0, wide, h, zU);
    winFront(xNarrowR, y0, narrow, h, zU);
  };
  triad(mainX + mainW * 0.08);
  triad(bayX - bayW * 0.02);

  // Ground floor: broad glazed former engine bay on the left (now the accessible entry) with a cream stone surround
  // and canopy; three tall rectangular windows to its right.
  const entryW = Math.min(bayW * 0.92, 5.6);
  g([boxFromBase(THREE, bayX, 0.0, zL - 0.02, entryW + 0.5, storey - 0.35, 0.22)], 'stone'); // stone surround mass
  g([boxFromBase(THREE, bayX, 0.18, zL + 0.05, entryW, storey - 0.7, 0.10)], 'glassEntry'); // glazed entry (direct access)
  g([boxFromBase(THREE, bayX, storey - 0.62, zL + 0.10, entryW + 0.7, 0.28, 0.55)], 'stone'); // stone canopy
  // sign band "Old Fire Hall 30" — cream stone with a dark inset, no made-up lettering texture (a real opening plate)
  g([boxFromBase(THREE, bayX, storey - 1.16, zL + 0.10, entryW * 0.7, 0.40, 0.06)], 'sign');
  // three tall ground-floor windows on the main volume
  const gw = 0.95, gh = storey - 0.85, gz = zL;
  for (const dx of [-1, 0, 1]) winFront(mainX - 0.0 + dx * 2.0, 0.55, gw, gh, gz);
  // ground-floor washroom openings accessed from the exterior side (ERA): narrow openings on the +X side
  for (let i = 0; i < 2; i++) {
    const zz = D * 0.16 - i * 2.1;
    g([boxFromBase(THREE, W / 2 + 0.015, 0.25, zz, 0.12, 1.15, 0.95)], 'frame');
    g([boxFromBase(THREE, W / 2 + 0.055, 0.33, zz, 0.04, 0.99, 0.79)], 'glass');
  }
  // ERA rear photograph: smaller burgundy framed openings on the simpler rear wall.
  // Counts/spacing are conservative photo estimates, not repeated front engine bays.
  for(const px of [-W*.30,-W*.12,W*.22]) {
    const z=-D/2-.07;
    g([boxFromBase(THREE,px,storey+.65,z,.80,1.5,.12)],'frame');
    g([boxFromBase(THREE,px,storey+.73,z-.07,.64,1.34,.04)],'glass');
    g([boxFromBase(THREE,px,storey+.48,z,.96,.15,.16)],'stone');
  }
  void sideBays;

  const mats = {
    brick: material(THREE, 0x8e3f34, 0.92),
    brickUpper: material(THREE, 0x94473b, 0.92),
    stone: material(THREE, 0xe7ddc3, 0.78),
    roof: material(THREE, 0x3c3f42, 0.95),
    frame: material(THREE, 0x6d1f2c, 0.66),
    glass: material(THREE, 0x40505a, 0.22, 0.34),
    glassEntry: material(THREE, 0x1d2529, 0.18, 0.45),
    sign: material(THREE, 0x2d3236, 0.55, 0.2)
  };
  const built = assemble(THREE, buckets, mats, 'BiidaasigeFireHall30', { cullDistance: 700, cullCell: 120 });
  if (!built.group.children.length) throw new Error('biidaasige-heritage: Fire Hall 30 produced no meshes');

  const box = extent(THREE, built.group);
  const colliders = [{
    minX: Math.min(box.min.x, -W / 2), maxX: Math.max(box.max.x, W / 2),
    minZ: Math.min(box.min.z, -D / 2), maxZ: Math.max(box.max.z, D / 2),
    minY: 0, maxY: H + roofH, prop: true, kind: 'firehall30', id: 'old-fire-hall-30',
    obb: { cx: 0, cz: 0, hx: W / 2, hz: D / 2, cs: 1, sn: 0 }
  }];
  return {
    id: 'old-fire-hall-30',
    name: 'Fire Hall 30 (Community Recreation Centre)',
    group: built.group, colliders, surfaces: [], climbable: false,
    triangles: built.triangles, drawCalls: built.drawCalls,
    footprint: { widthM: W, depthM: D, areaM2: Math.round(W * D), source: 'OSM way/494886782 (21.5 x 13.5 m, 247 m2)' },
    heights: {
      levels: FIREHALL_HEIGHTS.levels, levelsSource: FIREHALL_HEIGHTS.levelsSource,
      representativeM: H, representativeSource: FIREHALL_HEIGHTS.representativeSource,
      roofM: H + roofH, roofSource: 'explicit photo-estimate hip roof height above the two-storey height',
      label: `${FIREHALL_HEIGHTS.levels} storeys`
    },
    front: '+Z', placement: 'local-origin factory; place from fireHall30Placement() (current OSM footprint)',
    faceDirection: '+Z (the Commissioners Street facade: former engine bay entry left, three windows right)',
    source: SOURCES.fireHall, photos: SOURCES.fireHallPhotos, attribution: ATTRIBUTION.fireHall
  };
}

// -------------------------------------------------------------------------------------------------------------------
// 2. ATLAS CRANE factory. The ACTUAL primary-photo structure (Captain's read of the Waterfront Toronto 2024
//    restoration photo, captain/atlas-wt.jpg): a HUGE white GANTRY / A-frame, NOT a turret crane.
//
//    What the photo shows (authoritative): four TALL near-vertical lattice columns at the corners of a rectangular
//    portal (each column a square-section lattice tower ~1.4 m across), reaching ~35-38 m (photo estimate); the four
//    columns stand as TWO PAIRS of towers, each pair leaning gently toward its partner; the pairs are joined at the
//    TOP by a heavy horizontal crossbeam (with black cable/hoist tracks) spanning the ~10 m portal top; a small white
//    anti-climb SLEEVE (~4 m high) stands individually around each foot, not one solid plinth; and one giant long
//    square-section (1.5 m) lattice BOOM runs from the TOP of the structure (near a back corner, ~35 m up) all the way
//    DOWN to the GROUND ~25 m out front, with a pair of black cables parallel along the boom — this long downward
//    diagonal is the iconic silhouette.
//
//    Deliberately ABSENT (this is the correction): no rotating turret, no mid-height operator cab, no upward jib and
//    no hook hanging from an imaginary jib tip, no invented counterweight block, and no TMU student observation
//    platform/stairs. WT describes the Atlas as a "300-ton" crane (the structure's mass label); no lifting capacity is
//    published, so no capacity claim is made here. WT's "40 m / 140 ft" is the verification scaffolding, a different
//    property; the structure's own height here is an explicit photo estimate (default 36 m).
function buildAtlasCrane(spec = {}) {
  if (!THREE) throw new Error('biidaasige-heritage: CITY.THREE is required');
  const H = Number.isFinite(spec.height) ? spec.height : ATLAS_ESTIMATE.defaultHeightM; // default 36 m photo estimate
  const baseSpan = Number.isFinite(spec.baseSpan) ? spec.baseSpan : 8.0;   // portal footprint across the pairs (~8 m deep)
  const topSpan = Number.isFinite(spec.topSpan) ? spec.topSpan : 10.0;     // crossbeam length along +X (~10 m)
  const towerSide = 1.4;            // square-section lattice column
  const sleeveH = 4.0;              // the individual white anti-climb sleeve at each foot
  const lean = 0.9;                 // each pair leans gently toward its partner (metres at the top)
  const boomOut = Number.isFinite(spec.boomOut) ? spec.boomOut : 25;       // boom reaches ~25 m out front (+Z)
  const boomSide = 1.5;             // the boom is a square-section lattice
  const buckets = {};
  const g = (list, key) => { (buckets[key] = buckets[key] || []).push(...list); };

  // The four column feet. Pairs along +X are the "two V paired towers"; each pair leans together toward each other in
  // the X direction (the gentle inward convergence the photo shows), so the tops are slightly closer than the feet.
  const feet = [
    { x: -topSpan / 2, z: -baseSpan / 2, sx: +1 }, // back-left
    { x: +topSpan / 2, z: -baseSpan / 2, sx: -1 }, // back-right
    { x: -topSpan / 2, z: +baseSpan / 2, sx: +1 }, // front-left
    { x: +topSpan / 2, z: +baseSpan / 2, sx: -1 }  // front-right
  ];
  const columnTop = (f) => [f.x + f.sx * lean, H, f.z];

  // A square-section lattice column: four corner chords + ring bracing + zig-zag diagonals (a real tower, not a box).
  function latticeTower(ax, az, bx, by, bz, side, chordR = 0.10, bays = Math.max(6, Math.round(by / 4))) {
    const half = side / 2;
    // the four chords run at (+-half, +-half) around the column axis; interpolate from base to top
    const chordCorner = (t, ux, uz) => {
      const x = ax + (bx - ax) * t + ux * half;
      const y = 0 + by * t;
      const z = az + (bz - az) * t + uz * half;
      return [x, y, z];
    };
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [ux, uz] of corners) g([beamGeo(THREE, chordCorner(0, ux, uz), chordCorner(1, ux, uz), chordR, 4)], 'steel');
    for (let k = 0; k <= bays; k++) {
      const t = k / bays;
      const ringPts = corners.map(([ux, uz]) => chordCorner(t, ux, uz));
      for (let i = 0; i < 4; i++) g([beamGeo(THREE, ringPts[i], ringPts[(i + 1) % 4], chordR * 0.5, 4)], 'steel');
      if (k < bays) {
        const t2 = (k + 1) / bays;
        const r2 = corners.map(([ux, uz]) => chordCorner(t2, ux, uz));
        for (let i = 0; i < 4; i++) g([beamGeo(THREE, ringPts[i], r2[(i + 1) % 4], chordR * 0.4, 4)], 'steel');
      }
    }
  }
  // A light horizontal lattice beam: four parallel chords (top pair + bottom pair) + zig-zag diagonals on two faces.
  function latticeBeam(ax, ay, az, bx, by, bz, side, chordR = 0.09, bays = 6) {
    const half = side / 2;
    const pt = (t, oy, oz) => [ax + (bx - ax) * t + 0, ay + (by - ay) * t + oy, az + (bz - az) * t + oz];
    const corners = [[-half, -half], [half, -half], [half, half], [-half, half]]; // (y, z) offsets around the axis
    for (const [oy, oz] of corners) g([beamGeo(THREE, pt(0, oy, oz), pt(1, oy, oz), chordR, 4)], 'steel');
    for (let k = 0; k < bays; k++) {
      const t = k / bays, t2 = (k + 1) / bays;
      for (const [oy, oz] of corners) {
        const other = corners[(corners.findIndex((c) => c[0] === oy && c[1] === oz) + 1) % 4];
        g([beamGeo(THREE, pt(t, oy, oz), pt(t2, other[0], other[1]), chordR * 0.45, 4)], 'steel');
      }
      g([beamGeo(THREE, pt(t, half, -half), pt(t, half, half), chordR * 0.45, 4)], 'steel'); // top-face tie
    }
  }
  for (const f of feet) {
    const top = columnTop(f);
    latticeTower(f.x, f.z, top[0], H, top[2], towerSide, 0.11, Math.max(6, Math.round(H / 7)));
    // individual white anti-climb sleeve around this foot (not one solid plinth across the portal)
    g([boxFromBase(THREE, f.x, 0, f.z, towerSide + 0.5, sleeveH, towerSide + 0.5)], 'sleeve');
  }

  // Heavy horizontal crossbeam across each PAIR of tower heads along +X (with a black cable/hoist track along it).
  for (const z of [-baseSpan / 2, +baseSpan / 2]) {
    const xL = -topSpan / 2 + lean, xR = +topSpan / 2 - lean;
    // beam: a lattice box girder from head to head
    latticeBeam(xL, H, z, xR, H, z, 1.1, 0.10, 5);
    g([boxFromBase(THREE, 0, H + 0.55, z, (xR - xL), 0.35, 0.5)], 'track');           // black track along the beam top
    g([beamGeo(THREE, [-topSpan / 2 + lean, H + 0.2, z], [topSpan / 2 - lean, H + 0.2, z], 0.16, 8)], 'steel');
  }
  // Two cross beams tie the front pair's head to the back pair's head (front/back, along -Z), giving the A-frame top.
  for (const x of [-topSpan / 2 + lean, +topSpan / 2 - lean]) {
    latticeBeam(x, H, -baseSpan / 2, x, H, +baseSpan / 2, 1.1, 0.09, 3);
  }

  // The giant long lattice BOOM: a square-section (1.5 m) truss from the TOP near a back corner down to the ground
  // ~25 m out front (+Z). Two black cables run parallel along the boom.
  const boomTop = [-topSpan / 2 + lean, H - 0.3, -baseSpan / 2];   // top near a back corner
  const boomFoot = [-topSpan / 2 + lean, 0.15, -baseSpan / 2 + boomOut];
  latticeTower(boomTop[0], boomTop[2], boomFoot[0], boomFoot[1], boomFoot[2], boomSide, 0.13, 8);
  // the pair of black cables parallel along the boom (slightly offset either side of the boom axis)
  for (const off of [-0.45, 0.45]) {
    g([beamGeo(THREE, [boomTop[0] + off, boomTop[1], boomTop[2]], [boomFoot[0] + off, boomFoot[1] + 0.2, boomFoot[2]], 0.035, 4)], 'cable');
  }
  // A short footing pad under the boom's ground end (it truly lands on the ground in front)
  g([boxFromBase(THREE, boomFoot[0], 0, boomFoot[2], boomSide + 1.0, 0.16, boomSide + 1.0)], 'footing');

  const mats = {
    steel: material(THREE, 0xf2f4f6, 0.55, 0.30),
    sleeve: material(THREE, 0xfbfbfc, 0.7, 0.05),
    track: material(THREE, 0x1d2328, 0.6, 0.25),
    cable: material(THREE, 0x25292d, 0.5, 0.35),
    footing: material(THREE, 0x9ea1a3, 0.95)
  };
  const built = assemble(THREE, buckets, mats, 'BiidaasigeAtlasCrane', { cullDistance: 900, cullCell: 140 });
  if (!built.group.children.length) throw new Error('biidaasige-heritage: Atlas Crane produced no meshes');
  const b = extent(THREE, built.group);
  // Four INDIVIDUAL foot colliders (one per column) + the boom's ground footing.
  const colliders = feet.map((f, i) => ({
    minX: f.x - (towerSide + 0.5) / 2, maxX: f.x + (towerSide + 0.5) / 2,
    minZ: f.z - (towerSide + 0.5) / 2, maxZ: f.z + (towerSide + 0.5) / 2,
    minY: 0, maxY: H, prop: true, kind: `atlascrane-foot-${i + 1}`, id: 'atlas-crane'
  }));
  colliders.push({
    minX: boomFoot[0] - (boomSide + 1) / 2, maxX: boomFoot[0] + (boomSide + 1) / 2,
    minZ: boomFoot[2] - (boomSide + 1) / 2, maxZ: boomFoot[2] + (boomSide + 1) / 2,
    minY: 0, maxY: 0.16, prop: true, kind: 'atlascrane-boom-footing', id: 'atlas-crane'
  });
  return {
    id: 'atlas-crane',
    name: 'Atlas Crane',
    group: built.group, colliders, surfaces: [], climbable: false,
    triangles: built.triangles, drawCalls: built.drawCalls,
    footprint: {
      widthM: Math.round((b.max.x - b.min.x) * 10) / 10, depthM: Math.round((b.max.z - b.min.z) * 10) / 10,
      source: 'gantry portal ~10 m top span x ~8 m deep + a ~25 m boom reaching out front (photo estimates)'
    },
    heights: {
      representativeM: H, representativeRangeM: ATLAS_ESTIMATE.heightM,
      source: ATLAS_ESTIMATE.heightSource, installed: ATLAS_ESTIMATE.installed,
      massLabel: '300-ton (the structure mass label Waterfront Toronto publishes; NOT a lifting capacity)'
    },
    form: 'white gantry / A-frame: four lattice columns in two leaning pairs, a top crossbeam with hoist tracks, and one long square-section lattice boom running down to the ground out front',
    front: '+Z', placement: 'local-origin factory; place from atlasCranePlacement() (current OSM node)',
    faceDirection: '+Z (the boom reaches out front +Z; the crossbeam runs across +X)',
    source: SOURCES.atlas, photos: SOURCES.atlasPhoto, attribution: ATTRIBUTION.atlas
  };
}

// -------------------------------------------------------------------------------------------------------------------
// 3. THE DRUM factory. An OPEN circular shade structure: a salmon-red triangulated roof ANNULUS with a white perimeter
//    edge and radial white trusses, an open central oculus (~half the overall diameter), a ring of paired cream
//    diagonal V-timber struts on grey concrete feet, red-orange curved panel walls at some intervals, generous open
//    gaps between them (entrances), and a grey circular ground apron. No moon/cultural graphics are invented.
//    Footprint area: 201 m2 (source). Origin = centre at ground. The "front" (+Z) is one open entrance bay.
// -------------------------------------------------------------------------------------------------------------------
function buildTheDrum(spec = {}) {
  if (!THREE) throw new Error('biidaasige-heritage: CITY.THREE is required');
  const R = Number.isFinite(spec.radius) ? spec.radius : DRUM_RADIUS;      // ~8.0 m
  const roofY = Number.isFinite(spec.roofHeight) ? spec.roofHeight : 4.6;    // photo-estimate eave height
  const oculus = Number.isFinite(spec.oculusRadius) ? spec.oculusRadius : R * 0.5; // open centre ~half diameter
  const postCount = Number.isFinite(spec.posts) ? spec.posts : 16;
  const panelArcs = Number.isFinite(spec.panelArcs) ? spec.panelArcs : 5;    // red-orange curved panel walls at intervals
  const buckets = {};
  const g = (list, key) => { (buckets[key] = buckets[key] || []).push(...list); };

  // (1) grey circular ground apron (a low, flat, NON-walkable-climbable pad; the ground surface stays the captain's).
  g([cylGeo(THREE, 0, .06, 0, R + 1.2, R + 1.2, .12, 64)], 'apron');
  // (2) ring of paired cream diagonal V timber struts on grey concrete feet.
  for (let i = 0; i < postCount; i++) {
    const a = (i / postCount) * TAU;
    const sx = Math.sin(a) * R, sz = Math.cos(a) * R;
    // concrete foot
    g([cylGeo(THREE, sx, 0.14, sz, 0.26, 0.3, 0.28, 8)], 'foot');
    // a V: two struts from the foot to the ring, leaning inward and meeting near the top ring
    const inner = R * 0.9;
    const ax = Math.sin(a + 0.16) * inner, az = Math.cos(a + 0.16) * inner;
    const bx = Math.sin(a - 0.16) * inner, bz = Math.cos(a - 0.16) * inner;
    g([beamGeo(THREE, [sx, 0.28, sz], [ax, roofY, az], 0.07, 5)], 'timber');
    g([beamGeo(THREE, [sx, 0.28, sz], [bx, roofY, bz], 0.07, 5)], 'timber');
    // paired struts (a second, slightly outboard pair) — the built photo shows pairs
    const ox = Math.sin(a) * (R + 0.35), oz = Math.cos(a) * (R + 0.35);
    g([beamGeo(THREE, [ox, 0.28, oz], [ax, roofY * 0.92, az], 0.05, 5)], 'timber');
  }
  // (3) salmon-red triangulated roof annulus with white perimeter edge and radial white trusses over the oculus.
  const bandOuter = R * 0.9, bandInner = oculus;
  const annulus = annulusGeo(THREE, bandInner, bandOuter, roofY, 0.24, 64);
  if (annulus) g([annulus], 'roof');
  // sloped outer skirt from the annulus edge to the eave perimeter (the visible pitched ring)
  {
    const pos = [], nor = [];
    const N = 64;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU;
      const inR = bandOuter, outR = R;
      const p = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
      quad(pos, nor, p(a0, outR, roofY - 0.10), p(a1, outR, roofY - 0.10), p(a1, inR, roofY), p(a0, inR, roofY), [Math.sin((a0 + a1) / 2) * 0.5, 0.6, Math.cos((a0 + a1) / 2) * 0.5]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g([geo], 'roof');
  }
  // white perimeter edge ring (a torus-ish band at the eave)
  g([annulusGeo(THREE, R - 0.16, R + 0.16, roofY - 0.108, 0.16, 64)], 'white');
  // radial white trusses spanning from the inner oculus ring to the outer band — the triangulated top
  const radials = 12;
  for (let i = 0; i < radials; i++) {
    const a = (i / radials) * TAU;
    const p0 = [Math.sin(a) * bandInner, roofY + 0.30, Math.cos(a) * bandInner];
    const p1 = [Math.sin(a) * R, roofY + 0.18, Math.cos(a) * R];
    g([beamGeo(THREE, p0, p1, 0.06, 4)], 'white');
    // a diagonal brace to the next radial gives the triangulation
    const b = ((i + 1) / radials) * TAU;
    const p2 = [Math.sin(b) * bandOuter, roofY + 0.30, Math.cos(b) * bandOuter];
    g([beamGeo(THREE, p0, p2, 0.045, 4)], 'white');
  }
  // centre oculus ring (white)
  g([cylGeo(THREE, 0, roofY + 0.1, 0, oculus + 0.14, oculus + 0.14, 0.2, 48, 'y', true)], 'white');
  // (4) red-orange curved panel walls at some intervals, leaving generous open gaps (entrances)
  const arcSpan = (TAU / panelArcs) * 0.55;
  for (let i = 0; i < panelArcs; i++) {
    const a0 = (i + 0.12) * (TAU / panelArcs);
    const a1 = a0 + arcSpan;
    g([arcPanelGeo(THREE, R - 0.6, a0, a1, 0.14, roofY - 1.0, 0.14, 12)], 'wall');
  }

  const mats = {
    apron: material(THREE, 0x8e9094, 0.95),
    foot: material(THREE, 0x9a9c9e, 0.95),
    timber: material(THREE, 0xe4d7bd, 0.9),
    roof: material(THREE, 0xc4553f, 0.85),
    white: material(THREE, 0xf2f0ea, 0.75, 0.05),
    wall: material(THREE, 0xb8462f, 0.88)
  };
  const built = assemble(THREE, buckets, mats, 'BiidaasigeTheDrum', { cullDistance: 500, cullCell: 90 });
  if (!built.group.children.length) throw new Error('biidaasige-heritage: The Drum produced no meshes');
  const box = extent(THREE, built.group);
  // Only the actual panel walls and individual feet are solid. A box filling the
  // whole pavilion would block every open entrance and the ceremonial interior.
  const colliders=[];
  for(let i=0;i<postCount;i++){
    const a=i/postCount*TAU,x=Math.sin(a)*R,z=Math.cos(a)*R;
    colliders.push({minX:x-.3,maxX:x+.3,minZ:z-.3,maxZ:z+.3,minY:0,maxY:roofY,prop:true,kind:'drum-foot'});
  }
  for(let i=0;i<panelArcs;i++)for(let j=0;j<12;j++){
    const start=(i+.12)*(TAU/panelArcs),a=start+arcSpan*(j+.5)/12;
    const radius=R-.6,cx=Math.sin(a)*radius,cz=Math.cos(a)*radius;
    const hx=radius*Math.sin(arcSpan/24),hz=.09,cs=Math.cos(a),sn=Math.sin(a);
    const ex=Math.abs(cs)*hx+Math.abs(sn)*hz,ez=Math.abs(sn)*hx+Math.abs(cs)*hz;
    colliders.push({minX:cx-ex,maxX:cx+ex,minZ:cz-ez,maxZ:cz+ez,minY:.14,maxY:roofY-.86,
      obb:{cx,cz,hx,hz,cs,sn},prop:true,kind:'drum-wall'});
  }
  const surfaces=[];
  const apron=built.group.children.find(m=>m.name.endsWith('-apron'));
  if(apron){const p=apron.geometry.attributes.position,n=apron.geometry.attributes.normal;
    for(let i=0;i<p.count;i+=3)if(n.getY(i)>.5){const triangle=[];
      for(let k=0;k<3;k++)triangle.push(p.getX(i+k),p.getY(i+k),p.getZ(i+k));
      surfaces.push({kind:'drum-apron',triangle});}
  }
  return {
    id: 'the-drum',
    name: DRUM_SOURCE.name,
    group: built.group, colliders, surfaces, climbable: false,
    triangles: built.triangles, drawCalls: built.drawCalls,
    footprint: { radiusM: R, diameterM: R * 2, areaM2: DRUM_SOURCE.floorAreaM2, areaSource: 'Tawâw Architecture Collective: 2,164 ft2 / 201 m2' },
    heights: {
      representativeM: roofY, source: 'explicit photo-estimate eave height (no architect dimension published)',
      oculusRadiusM: oculus, oculusSource: 'photo-estimate: the central open oculus is about half the overall diameter'
    },
    front: '+Z is one open entrance bay (the structure is radially open)',
    placement: 'local-origin factory; the source publishes NO point, so it stays unplaced (drumPlacement() is null)',
    completed: DRUM_SOURCE.completed,
    source: SOURCES.drum, photos: SOURCES.drumPhoto, attribution: ATTRIBUTION.drum
  };
}

// -------------------------------------------------------------------------------------------------------------------
// 4. Marine Terminal 35 retained heritage fragments + interpretive signage. These are small, honest, local-origin
//    factories for the sorts of retained industrial fragments the Waterfront Toronto 2026 release describes
//    ("surviving Marine Terminal 35 heritage elements are incorporated into the western section"). They carry NO
//    position of their own; the layout never places them until a site is source-verified. They are deliberately
//    plain (bollard, rail section, plaque plinth, interpretive reader) rather than invented artwork.
// -------------------------------------------------------------------------------------------------------------------
function buildHeritageFragments(spec = {}) {
  if (!THREE) throw new Error('biidaasige-heritage: CITY.THREE is required');
  const buckets = {};
  const g = (list, key) => { (buckets[key] = buckets[key] || []).push(...list); };
  // a) a marine bollard on a small concrete pad (a real harbour-edge fragment)
  g([boxFromBase(THREE, -3.0, 0, 0, 1.1, 0.22, 1.1)], 'concrete');
  g([cylGeo(THREE, -3.0, 0.22 + 0.55, 0, 0.24, 0.28, 1.1, 10)], 'castIron');
  g([cylGeo(THREE, -3.0, 0.22 + 1.16, 0, 0.34, 0.34, 0.14, 10)], 'castIron');
  // b) a short retained rail section on sleepers (a port railway fragment)
  g([boxFromBase(THREE, 0.4, 0, 0, 2.6, 0.16, 0.34)], 'concrete'); // sleeper bed
  for (const z of [-0.10, 0.10]) g([boxFromBase(THREE, 0.4, 0.16, z, 2.6, 0.10, 0.06)], 'rail');
  // c) an interpretive reader: a low tilted panel on two posts (matches the amenities convention)
  g([boxFromBase(THREE, 2.9, 0, 0, 0.10, 0.62, 0.10)], 'castIron');
  g([boxFromBase(THREE, 3.5, 0, 0, 0.10, 0.62, 0.10)], 'castIron');
  g([boxFromBase(THREE, 3.2, 0.6, 0.0, 1.0, 0.6, 0.05)], 'panel');
  // d) a plaque plinth
  g([boxFromBase(THREE, 0, 0, 2.2, 0.7, 0.9, 0.4)], 'concrete');
  g([boxFromBase(THREE, 0, 0.9, 2.22, 0.6, 0.16, 0.03)], 'panel');

  const mats = {
    concrete: material(THREE, 0xb8b6b0, 0.96),
    castIron: material(THREE, 0x3c3f42, 0.6, 0.35),
    rail: material(THREE, 0x6b5b4c, 0.7, 0.4),
    panel: material(THREE, 0x4b5a52, 0.7, 0.1)
  };
  const built = assemble(THREE, buckets, mats, 'BiidaasigeHeritageFragments', { cullDistance: 400, cullCell: 60 });
  const box = extent(THREE, built.group);
  const colliders = [{
    minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, minY: 0, maxY: box.max.y,
    prop: true, kind: 'mt35-heritage'
  }];
  return {
    id: 'marine-terminal-35-heritage',
    name: 'Marine Terminal 35 heritage fragments + interpretive reader',
    group: built.group, colliders, surfaces: [], climbable: false,
    triangles: built.triangles, drawCalls: built.drawCalls,
    footprint: null, heights: { source: 'fragment sizes are explicit representative estimates, not surveyed' },
    placement: 'unverified — do NOT place until a site is source-verified (official-catalog marine-terminal-35-heritage)',
    source: SOURCES.marineTerminal, attribution: ATTRIBUTION.heritageFragments
  };
}

// -------------------------------------------------------------------------------------------------------------------
// 5. Interpretive sign for the heritage features (unplaced factory; the park's own signage is a separate adoption).
// -------------------------------------------------------------------------------------------------------------------
function buildInterpretiveSign(spec = {}) {
  if (!THREE) throw new Error('biidaasige-heritage: CITY.THREE is required');
  const buckets = {};
  const g = (list, key) => { (buckets[key] = buckets[key] || []).push(...list); };
  const postH = Number.isFinite(spec.postH) ? spec.postH : 0.42;
  const w = Number.isFinite(spec.width) ? spec.width : 0.9;
  const h = Number.isFinite(spec.height) ? spec.height : 0.78;
  g([boxFromBase(THREE, -w * 0.32, 0, 0, 0.08, postH, 0.08)], 'frame');
  g([boxFromBase(THREE, w * 0.32, 0, 0, 0.08, postH, 0.08)], 'frame');
  g([boxFromBase(THREE, 0, postH, 0, w, h, 0.05)], 'frame');
  g([boxFromBase(THREE, 0, postH + 0.05, 0.03, w - 0.08, h - 0.10, 0.02)], 'panel');
  const mats = { frame: material(THREE, 0x40474b, 0.7, 0.3), panel: material(THREE, 0x38484a, 0.7, 0.05) };
  const built = assemble(THREE, buckets, mats, 'BiidaasigeHeritageSign', { cullDistance: 350, cullCell: 50 });
  const box = extent(THREE, built.group);
  return {
    id: 'interpretive-signage',
    name: 'Heritage interpretive sign',
    group: built.group,
    colliders: [{ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, minY: 0, maxY: box.max.y, prop: true, kind: 'interpretive-sign' }],
    surfaces: [], climbable: false, triangles: built.triangles, drawCalls: built.drawCalls,
    footprint: { widthM: w, heightM: postH + h, source: 'representative estimate (matches the amenities sign convention)' },
    placement: 'unverified — the park interpretive-signage position is not published',
    source: SOURCES.marineTerminal, attribution: ATTRIBUTION.interpretive
  };
}

// -------------------------------------------------------------------------------------------------------------------
// VERIFIED LAYOUT — the ONLY placement path. Everything is asked from js/biidaasige-park-data.js.
// -------------------------------------------------------------------------------------------------------------------
function projectionAvailable() {
  return !!(C && typeof C.biidaasigeParkProjectionAvailable === 'function' && C.biidaasigeParkProjectionAvailable());
}

// Fire Hall 30: current OSM footprint (way/494886782) as a world ring through the data helper. Returns
// { x, z, ring, widthM, depthM, orientationDeg } or null when the frame is absent / the feature is not verified.
function fireHall30Placement() {
  if (!projectionAvailable()) return null;
  const feat = C.biidaasigeParkFeature ? C.biidaasigeParkFeature('old-fire-hall-30') : null;
  const ring = C.biidaasigeParkRingWorld ? C.biidaasigeParkRingWorld('old-fire-hall-30') : null;
  if (!feat || !Array.isArray(ring) || ring.length < 3) return null;
  let sx = 0, sz = 0;
  for (const p of ring) { sx += p.x; sz += p.z; }
  const centre = { x: sx / ring.length, z: sz / ring.length };
  const fp = Array.isArray(feat.footprintM) ? feat.footprintM : [null, null];
  // the ring is ordered; take the longest edge as the footprint's long axis to set the yaw for the model
  let longest = { len: 0, yaw: 0 };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len > longest.len) longest = { len, yaw: (Math.atan2(dx, dz) * 180) / Math.PI };
  }
  return {
    id: 'old-fire-hall-30', x: centre.x, z: centre.z, ring, yaw: longest.yaw,
    widthM: fp[0], depthM: fp[1], orientationDeg: feat.orientationDeg,
    sourceRef: feat.ref, sourceEvidence: feat.evidence, positionConfidence: feat.positionConfidence
  };
}

// Atlas Crane: verified current OSM node as a world point. Returns { x, z } or null.
function atlasCranePlacement() {
  if (!projectionAvailable()) return null;
  const feat = C.biidaasigeParkFeature ? C.biidaasigeParkFeature('atlas-crane') : null;
  const w = C.biidaasigeParkWorld ? C.biidaasigeParkWorld('atlas-crane') : null;
  if (!feat || !w) return null;
  return { id: 'atlas-crane', x: w.x, z: w.z, sourceRef: feat.ref, sourceEvidence: feat.evidence, positionConfidence: feat.positionConfidence };
}

// The Drum: no published point -> ALWAYS null (build it at local origin until a site is source-verified).
function drumPlacement() {
  return null;
}

// Compose a full heritage assembly WITHOUT placing anything: returns the factories and the placements that exist.
// `place` in the result is honest: { fireHall: pose|null, atlas: pose|null, drum: null }.
function buildBiidaasigeHeritage(scene = null, opts = {}) {
  const out = {
    fireHall: buildFireHall30(opts.fireHall || {}),
    atlas: buildAtlasCrane(opts.atlas || {}),
    drum: buildTheDrum(opts.drum || {}),
    heritageFragments: buildHeritageFragments(opts.fragments || {}),
    interpretive: buildInterpretiveSign(opts.sign || {})
  };
  const group = new THREE.Group();
  group.name = 'BiidaasigeHeritage';
  const colliders = [];
  for (const key of ['fireHall', 'atlas', 'drum', 'heritageFragments', 'interpretive']) {
    const r = out[key];
    group.add(r.group);
    colliders.push(...r.colliders);
  }
  const place = {
    fireHall: fireHall30Placement(),
    atlas: atlasCranePlacement(),
    drum: drumPlacement()
  };
  const result = {
    group, colliders, parts: out, place,
    triangles: out.fireHall.triangles + out.atlas.triangles + out.drum.triangles + out.heritageFragments.triangles + out.interpretive.triangles,
    climbable: false,
    placementsVerified: { fireHall: place.fireHall ? 'osm-way/494886782' : null, atlas: place.atlas ? 'osm-node/9521067431' : null, drum: null }
  };
  if (scene && scene.add) scene.add(group);
  if (C) C.biidaasigeHeritage = result;
  return result;
}

// -------------------------------------------------------------------------------------------------------------------
// FIRE HALL IDENTITY PREDICATE (the seam the Captain's integration needs).
//
// The native city carries a 1920s fire hall as a GENERIC building at world (2384, 622) (see
// docs/biidaasige-terrain.md buildingCandidatesInPark h 8.4). ERA states the building was "relocated 24 metres
// south, ... as part of the broader Port Lands Flood Protection Project", and the current OSM footprint centre is
// ~24 m south of that native spot — so the OLD native row is the SAME building and must be replaced, not duplicated.
//
// This predicate is deliberately conservative and FAILS CLOSED: it is true ONLY when (a) a replacement result was
// built successfully, (b) the native row is within the documented relocation footprint of the current OSM anchor,
// and (c) the row is not one of the already-identified park features. It does not touch js/buildings.js and does
// not delete anything: the Captain decides where to apply it.
// -------------------------------------------------------------------------------------------------------------------
// PROVEN identity: the native GEO row at (2383.9, 622.4), angle -1.308, is a single ~21.6 x 13.2 m, 8.4 m-high part
// whose eight-edge footprint matches the current OSM Fire Hall ring edge-for-edge (8.78/4.00/20.98/7.02/3.38/3.33/
// 2.43/17.61 m) with a max ~3.9 m vertex residual after a pure translation. The OSM centre (2390.5, 648.7) is ~26.9 m
// SOUTH of it, exactly ERA's "relocated 24 metres south". Same building: the native row must be REPLACED, not doubled.
const NATIVE_FIREHALL = Object.freeze({
  x: 2383.9, z: 622.4, angle: -1.308, longM: 21.6, shortM: 13.2, heightM: 8.4,
  documentedRelocationM: 24, toleranceM: 14
});
const OTHER_PARK_BUILDINGS = Object.freeze([
  { x: 2887, z: 755.6 }, { x: 2422.4, z: 608.3 }, { x: 2486.6, z: 687.1 }, { x: 2848.2, z: 624.4 },
  { x: 2677.7, z: 630.1 }, { x: 1780.9, z: 757.5 }, { x: 2189, z: 884.9 }, { x: 1998.2, z: 782.4 }
]);

function heritageFireHallReplaced(result) {
  const R = result || (C && C.biidaasigeHeritage);
  if (!R || !R.parts || !R.parts.fireHall) return false;
  return !!(R.place && R.place.fireHall && R.place.fireHall.sourceRef === 'way/494886782');
}

// True only inside the CURRENT OSM footprint (so a collider there is the replacement's, not a duplicate's).
function heritageFireHallExclusionAt(x, z, margin = 0, result) {
  if (!heritageFireHallReplaced(result)) return false;
  const p = (result || C.biidaasigeHeritage).place.fireHall;
  if (Array.isArray(p.ring) && p.ring.length > 2) return pointInRing(x, z, p.ring);
  return Math.hypot(x - p.x, z - p.z) <= 12 + margin;
}

// TRUE only for the ONE native row that is the relocated Fire Hall 30: a single-part, low, two-storey mass near the
// documented old spot, with a matching long/short footprint AND the documented ~24 m (14 m tolerated) southward
// displacement from the current OSM anchor. Every other native park building returns false.
function heritageFireHallReplacesNative(x, z, heightM, angle, parts, result) {
  if (!heritageFireHallReplaced(result)) return false;
  if (Number.isFinite(heightM) && heightM > 14) return false;                 // the native row must be low
  if (Math.hypot(x - NATIVE_FIREHALL.x, z - NATIVE_FIREHALL.z) > NATIVE_FIREHALL.toleranceM) return false;
  for (const b of OTHER_PARK_BUILDINGS) if (Math.hypot(x - b.x, z - b.z) <= NATIVE_FIREHALL.toleranceM) return false;
  if (Array.isArray(parts) && parts.length !== 1) return false;               // the fire hall is one part
  if (Array.isArray(parts) && parts.length === 1) {
    const [u0, u1, v0, v1] = parts[0];
    const w = Math.abs(u1 - u0), d = Math.abs(v1 - v0);
    const long = Math.max(w, d), short = Math.min(w, d);
    if (Math.abs(long - NATIVE_FIREHALL.longM) > 2.5 || Math.abs(short - NATIVE_FIREHALL.shortM) > 2.5) return false;
  }
  if (Number.isFinite(angle) && Math.abs(angle - NATIVE_FIREHALL.angle) > 0.35) return false; // same orientation
  const p = (result || C.biidaasigeHeritage).place.fireHall;
  const sep = Math.hypot(x - p.x, z - p.z);
  if (sep < NATIVE_FIREHALL.documentedRelocationM - 14 || sep > NATIVE_FIREHALL.documentedRelocationM + 14) return false;
  return true;
}

// A plain point-in-polygon (even-odd) over a flat [{x, z}] ring.
function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, zi = ring[i].z, xj = ring[j].x, zj = ring[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// -------------------------------------------------------------------------------------------------------------------
// Exports. Factories are on C.biidaasigeHeritageFactories; the source label sets on C.BIIDAASIGE_HERITAGE_*.
// -------------------------------------------------------------------------------------------------------------------
if (C) {
  Object.assign(C, {
    BIIDAASIGE_HERITAGE_SOURCES: SOURCES,
    BIIDAASIGE_HERITAGE_ATTRIBUTION: ATTRIBUTION,
    BIIDAASIGE_FIREHALL30_HEIGHTS: FIREHALL_HEIGHTS,
    BIIDAASIGE_ATLAS_ESTIMATE: ATLAS_ESTIMATE,
    BIIDAASIGE_DRUM_SOURCE: DRUM_SOURCE,
    BIIDAASIGE_HERITAGE_FACTORIES: {
      buildFireHall30, buildAtlasCrane, buildTheDrum, buildHeritageFragments, buildInterpretiveSign,
      fireHall30Placement, atlasCranePlacement, drumPlacement, projectionAvailable,
      obbCorners, pointInRing, extent: (g) => extent(THREE, g)
    },
    buildFireHall30, buildAtlasCrane, buildTheDrum, buildHeritageFragments, buildInterpretiveSign,
    buildBiidaasigeHeritage,
    heritageFireHallExclusionAt, heritageFireHallReplacesNative, heritageFireHallReplaced,
    BIIDAASIGE_HERITAGE_NATIVE: NATIVE_FIREHALL
  });
}
})();
