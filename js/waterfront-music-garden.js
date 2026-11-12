(function () {
// js/waterfront-music-garden.js
// Toronto Music Garden, 479 Queens Quay West: the waterfront's signature cultural garden, inspired by the six
// movements of Bach's Cello Suite No. 1 in G Major (BWV 1007), conceived with cellist Yo-Yo Ma and realized by
// landscape architect Julie Moir Messervy (opened 1999). Curving paths move visitors through six garden "movements"
// — Prelude, Allemande, Courante, Sarabande, Menuett, Gigue — each a distinct room with its own planting and mood.
//
// GEOREFERENCE (this is the important part): the room positions are NOT a guessed or equally spaced sequence. The
// committed OpenStreetMap data (js/toronto-geodata.js) already carries the garden's six labelled movement nodes as
// `place` POIs with real world coordinates inside/near the measured landmark. This module reads those nodes from
// GEO.pois and anchors each room on its real node; rooms tile the mapped park footprint as nearest-node (Voronoi)
// cells, so they follow the actual plan geometry and the mapped paths rather than an invented order. The physical
// west-to-east order from those nodes is Allemande, Prelude, Courante, Sarabande, Gigue, Menuett — NOT the suite's
// movement order (Prelude first). The designer's labelled plan (Harbourfront Centre "Summer Music in the Garden"
// brochure 2024, pages 2-3) shows the same order and confirms the grass amphitheatre (Gigue) sits west of the
// pavilion (Menuett), which is at the extreme east near the north boundary.
//
// Real movement nodes (world x, z), read from GEO.pois at runtime:
//   I  Prelude    (-1391.9, 572.3)
//   II Allemande  (-1429.3, 569.3)
//   III Courante  (-1351.0, 562.8)
//   IV Sarabande  (-1322.7, 561.4)
//   V  Menuett    (-1286.7, 564.0)
//   VI Gigue      (-1312.8, 600.1)   (south of the park edge: the grass steps run down the slope to the harbour)
//
// Documented room character (primary design sources):
//   Prelude   — a curving entry path, glacier-tumbled granite boulders, a hackberry grove; an "eddy" is the
//               threshold into the Allemande.
//   Allemande — a birch forest whose "squirrel trails" spiral in and out.
//   Courante  — a wildflower meadow with a Maypole at the meeting of two spiraling paths (coneflowers, Russian sage,
//               butterfly bush, asters).
//   Sarabande — a shady conifer corner with a water-filled granite stone and pink anemones.
//   Menuett   — the Music Pavilion, a wrought-iron arch by blacksmith Tom Tollefson, spanning a concert stage.
//   Gigue     — "wide grass steps dance down the hillside into an amphitheatre-like space" under a willow, with
//               yellow-flowered perennials on either side. The steps are GRASS, not granite.
// Granite: glacier-tumbled boulders from the Canadian Shield are placed throughout the movements.
//
// Sources (retrieved 2026-11-09):
// - Julie Moir Messervy Design Studio, "The Toronto Music Garden": https://jmmds.com/portfolio/the-toronto-music-garden/
//   (six movements; squirrel trails; Maypole at two spiraling paths; Pavilion arching over a concert stage; wide grass
//   steps down the hillside; Tom Tollefson ironwork; glacier-tumbled granite throughout)
// - Harbourfront Centre "Summer Music in the Garden" brochure 2024 (labelled plan, pages 2-3):
//   https://harbourfrontcentre.com/wp-content/uploads/2024/07/HC-Summer-Music-in-the-Garden-Brochure-2024.pdf
// - City of Toronto public gardens (479 Queens Quay W; native/ornamental perennials, grasses, flowering shrubs,
//   wrought iron): https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/gardens-and-horticulture/public-gardens/
// - Waterfront Toronto central waterfront: https://www.waterfrontoronto.ca/our-projects/scope-scale/central-waterfront
// - Measured footprint (City geodata landmark from OSM leisure=park): x -1330.3, z 569.4, w 262, d 47.9, ang -0.161,
//   area 10,524 m²; OSM outline 10,462 m². Movement nodes from OSM contributors, ODbL.
//
// Geometry conventions (as in the rest of the city): 1 unit = 1 m, world x is grid east, z is grid south, ground
// y = 0. The landmark ring, its centre line and its long-axis angle come from the loaded geodata, so the rooms sit
// inside the real outline. Call createWaterfrontMusicGarden(THREE, scene); it returns { group, colliders, stats } and
// only builds when the active frame covers the mapped garden (waterfrontMusicGardenSupported). The group is one
// culling root, repeated parts are instanced, and meshes carry scene-culling.js's cullDistance/cullCell.

const C = window.CITY;
const SETTING = C?.CITY_BOUNDS || {};
const GROUND = 0; // the city's ground plane (y = 0); the garden sits on it
const WATER = SETTING.waterLevel ?? -0.7;

// The six rooms keyed by the OSM movement node they are anchored on. `order` is the PHYSICAL west-to-east order the
// nodes and the labelled plan give; `movement` is the Bach movement number (which is not that order).
const MUSIC_GARDEN_ROOMS = [
  {
    id: 'allemande', anchor: 'Allemande', name: 'Allemande', movement: 'II', order: 1,
    character: 'grove', ground: 'mulch', planting: 'birch',
    note: 'A birch forest whose "squirrel trails" spiral in and out (JMMDS).'
  },
  {
    id: 'prelude', anchor: 'Prelude', name: 'Prelude', movement: 'I', order: 2,
    character: 'entry', ground: 'pathstone', planting: 'hackberry',
    note: 'The curving entry: granite boulders, a hackberry grove, and an "eddy" into the Allemande.'
  },
  {
    id: 'courante', anchor: 'Courante', name: 'Courante', movement: 'III', order: 3,
    character: 'meadow', ground: 'meadow', planting: 'wildflower',
    note: 'A wildflower meadow with a Maypole at the meeting of two spiraling paths (JMMDS).'
  },
  {
    id: 'sarabande', anchor: 'Sarabande', name: 'Sarabande', movement: 'IV', order: 4,
    character: 'still', ground: 'moss', planting: 'conifer', feature: 'waterStone',
    note: 'A shady conifer corner with a water-filled granite stone and pink anemones.'
  },
  {
    id: 'gigue', anchor: 'Gigue', name: 'Gigue', movement: 'VI', order: 5,
    character: 'amphitheatre', ground: 'grass', planting: 'willow', feature: 'amphitheatre',
    note: 'Wide grass steps dance down the hillside into an amphitheatre-like space under a willow (JMMDS).'
  },
  {
    id: 'menuett', anchor: 'Menuett', name: 'Menuett', movement: 'V', order: 6,
    character: 'pavilion', ground: 'paving', planting: 'mixed', feature: 'pavilion',
    note: 'The Music Pavilion, whose wrought-iron arch spans a concert stage (Tom Tollefson).'
  }
];

// Estimated dimensions where the design does not publish a measured figure (metres). The report records these.
const ESTIMATES = {
  pathWidth: 2.4, // the connecting walk between the movement nodes
  pavilionRadius: 3.4, // the Music Pavilion is a small open shelter, ~7 m across
  pavilionHeight: 3.3,
  amphitheatreRadius: 9.0, // the grass amphitheatre bowl, ~18 m across
  amphitheatreStepRise: 0.35,
  amphitheatreStepRun: 1.1,
  amphitheatreRows: 4,
  waterStoneRadius: 1.5,
  boulderSize: 1.1,
  cellGrid: 3.0, // the sampling grid (m) used to tile the footprint into room cells
  roomMaxDist: 46, // a cell belongs to a room only within this many metres of its movement node (else generic park)
  treeClearance: 5 // no new grove crown within this many metres of an existing City street tree (source inventory)
};

// Granite palette for the boulders (varied neutral greys, no white default). The garden does NOT render its own tree
// crowns: it exports supplemental tree SITES for the shared realistic tree pipeline (js/ez-trees.js), keyed to the
// real model ids in the committed manifest (GEO.treeModels: ez-oak-*, ez-ash-*, ez-aspen-*, ez-pine-*-a).
const GRANITE_PALETTE = [0x76736d, 0x6a6761, 0x807d77, 0x5f5c57, 0x7c7a74];

// The planting of each movement room mapped to a real available tree model, a generic species fallback (0 oak, 1 ash,
// 2 aspen) and a target height (m). Birch reads best as the slender aspen, the conifer room as a pine, the broadleaf
// rooms as oak/ash. No unsupported model names are invented; every `model` is one of GEO.treeModels' ids.
const TREE_MODEL_BY_PLANTING = {
  birch: { model: 'ez-aspen-medium', species: 2, height: 8.0 },
  conifer: { model: 'ez-pine-medium-a', species: 0, height: 8.0 },
  hackberry: { model: 'ez-oak-medium', species: 0, height: 8.0 },
  willow: { model: 'ez-oak-medium', species: 0, height: 9.0 },
  wildflower: { model: 'ez-ash-medium', species: 1, height: 7.0 },
  mixed: { model: 'ez-ash-medium', species: 1, height: 7.5 }
};

// The mrdoob procedural tree's height at scale 1 (ez-trees.js slopHeight), so a site's fallback `scale` renders at its
// target height when the EZ-Tree models are unavailable. Computed from the shared geometry when present; an honest
// estimate otherwise (this is the value ez-trees itself derives the same way).
function slopTreeHeight() {
  try {
    const atlas = C.createLeafAtlas ? C.createLeafAtlas() : null;
    const g = C.buildTreeGeometries ? C.buildTreeGeometries(0, 0, atlas ? atlas.tileMeters : 1)[0] : null;
    if (g) {
      g.computeBoundingBox();
      const h = g.boundingBox.max.y - g.boundingBox.min.y;
      if (Number.isFinite(h) && h > 2) return h;
    }
  } catch (e) { /* no canvas in the test harness: fall through to the estimate */ }
  return 11; // ez-trees' own tree at scale 1 is ~11 m; existing procedural trees use scale 0.5-1.15
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (x, z) => {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

// Is a world point inside a ring given as [x0,z0, x1,z1, ...] or [[x,z], ...]?
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// The measured landmark as a local frame: centroid, long-axis unit vectors, the ring, and the ring's local extents.
function gardenFrame() {
  const m = C?.GEO?.landmarks?.musicGarden;
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
  // local centroid (mean of the ring's vertices), used to pull an off-park anchor (the Gigue) into the footprint
  let lu = 0, lv = 0;
  for (const [u, v] of local) { lu += u; lv += v; }
  lu /= local.length; lv /= local.length;
  return { ring, local, cx, cz, ang, ca, sa, u0, u1, v0, v1, lu, lv, area: m.area || 0 };
}

function localToWorld(frame, u, v) {
  return [frame.cx + u * frame.ca - v * frame.sa, frame.cz + u * frame.sa + v * frame.ca];
}
function worldToLocal(frame, x, z) {
  const dx = x - frame.cx, dz = z - frame.cz;
  return [dx * frame.ca + dz * frame.sa, -dx * frame.sa + dz * frame.ca];
}

// The real six movement nodes, read from the committed OSM POIs (GEO.pois entries [x, z, name, kind, ...]).
// Returns { Allemande:{x,z}, Prelude:{...}, ... }, empty when absent.
function musicGardenAnchors() {
  const out = {};
  const pois = C?.GEO?.pois;
  if (!Array.isArray(pois)) return out;
  const re = /\b(Allemande|Prelude|Courante|Sarabande|Menuett|Gigue)\b/;
  for (const p of pois) {
    if (!Array.isArray(p) || p.length < 3) continue;
    const name = p[2];
    if (typeof name !== 'string') continue;
    const m = re.exec(name);
    if (!m) continue;
    const x = p[0], z = p[1];
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    if (!out[m[1]]) out[m[1]] = { x, z, name };
  }
  return out;
}

// Pull a local (u, v) that lies outside the ring back inside, along the line to the ring's local centroid.
function clampIntoRing(frame, u, v) {
  const [wx, wz] = localToWorld(frame, u, v);
  if (pointInRing(frame.ring, wx, wz)) return [u, v];
  let best = null;
  for (let t = 0.02; t <= 1.0001; t += 0.02) {
    const uu = lerp(u, frame.lu, t), vv = lerp(v, frame.lv, t);
    const [x, z] = localToWorld(frame, uu, vv);
    if (pointInRing(frame.ring, x, z)) { best = [uu, vv]; break; }
  }
  return best || [frame.lu, frame.lv];
}

// Each room's anchor in local metres, clamped into the park footprint (the Gigue node sits just south of the edge).
function roomAnchorLocal(frame, room, anchors = musicGardenAnchors()) {
  const a = anchors[room.anchor];
  if (a) {
    const [u, v] = worldToLocal(frame, a.x, a.z);
    return clampIntoRing(frame, u, v);
  }
  // no geodata: fall back to an even span along the long axis in physical order (only for a frame without POIs)
  const i = MUSIC_GARDEN_ROOMS.indexOf(room);
  const frac = 0.1 + (0.8 * (i + 0.5)) / MUSIC_GARDEN_ROOMS.length;
  return clampIntoRing(frame, frame.u0 + (frame.u1 - frame.u0) * frac, 0);
}

// A deterministic sampling grid over the ring: each cell's centre, its local (u, v), and the nearest room by node
// distance. These cells tile the mapped footprint into the six rooms (a Voronoi diagram of the real movement nodes,
// clipped to the park), so room extents follow the plan, not equal slices.
function roomCells(frame, anchors = musicGardenAnchors()) {
  const anchorPts = MUSIC_GARDEN_ROOMS.map((room) => ({ room, ...(() => { const [u, v] = roomAnchorLocal(frame, room, anchors); return { u, v }; })() }));
  const g = ESTIMATES.cellGrid;
  const cells = [];
  for (let x = frame.u0; x <= frame.u1; x += g) {
    for (let v = frame.v0; v <= frame.v1; v += g) {
      const [wx, wz] = localToWorld(frame, x, v);
      if (!pointInRing(frame.ring, wx, wz)) continue;
      let best = null, bestD = Infinity;
      for (const ap of anchorPts) {
        const d = (ap.u - x) * (ap.u - x) + (ap.v - v) * (ap.v - v);
        if (d < bestD) { bestD = d; best = ap; }
      }
      // only the part of the park near a movement node is one of its rooms; the far edge stays generic park
      if (bestD > ESTIMATES.roomMaxDist * ESTIMATES.roomMaxDist) { best = null; }
      cells.push({ u: x, v, x: wx, z: wz, room: best ? best.room : null, au: best ? best.u : x, av: best ? best.v : v });
    }
  }
  return cells;
}

// The room whose cell contains a world point (inside the ring), or null.
function gardenRoomAt(x, z) {
  const frame = gardenFrame();
  if (!frame) return null;
  if (!pointInRing(frame.ring, x, z)) return null;
  const anchors = musicGardenAnchors();
  const [u, v] = worldToLocal(frame, x, z);
  let best = null, bestD = Infinity;
  for (const room of MUSIC_GARDEN_ROOMS) {
    const [au, av] = roomAnchorLocal(frame, room, anchors);
    const d = (au - u) * (au - u) + (av - v) * (av - v);
    if (d < bestD) { bestD = d; best = { room, u, v, frame }; }
  }
  return best;
}

// Predicate for vegetation / lawn placement: true inside the garden's mapped footprint, where the rooms' own beds
// and planting replace the generic park treatment. Optional margin (metres) is ignored beyond the ring test.
function gardenFootprintAt(x, z) {
  // (main.js asks this for every street tree: the mapped ring's box rejects before gardenFrame() rebuilds the ring)
  const m = C?.GEO?.landmarks?.musicGarden;
  if (m && Array.isArray(m.ring) && m.ring.length >= 6) {
    const b = surfaceBounds(m, (add) => { for (let i = 0; i + 1 < m.ring.length; i += 2) add(m.ring[i], m.ring[i + 1]); });
    if (outsideBounds(b, x, z)) return false;
  }
  const frame = gardenFrame();
  if (!frame) return false;
  return pointInRing(frame.ring, x, z);
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

// The connecting walk: a smooth curve through the six movement anchors in physical order, sampled densely and
// clamped inside the park. It is drawn as short paving slabs, so the room sequence reads on foot along the mapped
// garden (the real OSM paths remain the city's own geometry and are not duplicated here).
function gardenPath(frame) {
  const anchors = musicGardenAnchors();
  const pts = MUSIC_GARDEN_ROOMS.map((room) => {
    const [u, v] = roomAnchorLocal(frame, room, anchors);
    return [u, v];
  });
  // Catmull-Rom interpolation through the anchors, dense samples
  const out = [];
  const N = 24;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < N; k++) {
      const t = k / N, t2 = t * t, t3 = t2 * t;
      const u = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const v = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([u, v]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out.map(([u, v]) => localToWorld(frame, u, v));
}

// The path visits every room (within its cell), in physical order.
function gardenPathPassesRooms() {
  const frame = gardenFrame();
  if (!frame) return [];
  const path = gardenPath(frame);
  const anchors = musicGardenAnchors();
  return MUSIC_GARDEN_ROOMS.map((room) => {
    const [au, av] = roomAnchorLocal(frame, room, anchors);
    const hit = path.some(([x, z]) => {
      const [u, v] = worldToLocal(frame, x, z);
      return (u - au) * (u - au) + (v - av) * (v - av) < 36; // within 6 m of the room's real node
    });
    return { id: room.id, passed: hit };
  });
}

function gardenLayout() {
  const frame = gardenFrame();
  if (!frame) return null;
  const anchors = musicGardenAnchors();
  const cells = roomCells(frame, anchors);
  const rooms = MUSIC_GARDEN_ROOMS.map((room) => {
    const [au, av] = roomAnchorLocal(frame, room, anchors);
    const [wx, wz] = localToWorld(frame, au, av);
    const a = anchors[room.anchor];
    const mine = cells.filter((c) => c.room === room);
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const c of mine) {
      if (c.u < uMin) uMin = c.u;
      if (c.u > uMax) uMax = c.u;
      if (c.v < vMin) vMin = c.v;
      if (c.v > vMax) vMax = c.v;
    }
    if (!mine.length) { uMin = uMax = au; vMin = vMax = av; }
    return {
      id: room.id, name: room.name, movement: room.movement, order: room.order, character: room.character,
      planting: room.planting, feature: room.feature || null, note: room.note,
      anchorName: a?.name || room.anchor, anchorX: a?.x ?? wx, anchorZ: a?.z ?? wz,
      x: wx, z: wz, uMid: au, vMid: av,
      cell: { uMin, uMax, vMin, vMax, uHalf: (uMax - uMin) / 2, vHalf: (vMax - vMin) / 2, count: mine.length }
    };
  });
  const path = gardenPath(frame);
  const pathLength = path.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) : 0), 0);
  return {
    frame: { x: frame.cx, z: frame.cz, ang: frame.ang, u0: frame.u0, u1: frame.u1, v0: frame.v0, v1: frame.v1, area: frame.area },
    anchors, rooms, path, pathLength, estimates: ESTIMATES
  };
}

// Existing City street-tree positions (GEO.streetTrees, stride 4: [x, z, model, height*10]) near the garden, so the
// module keeps the source tree inventory and never drops a random grove crown on top of a mapped tree.
function existingTreePositions(frame) {
  const ST = C?.GEO?.streetTrees;
  if (!Array.isArray(ST)) return [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of frame.ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const pad = 8;
  const out = [];
  for (let i = 0; i + 1 < ST.length; i += 4) {
    const x = ST[i], z = ST[i + 1];
    if (x >= x0 - pad && x <= x1 + pad && z >= z0 - pad && z <= z1 + pad) out.push([x, z]);
  }
  return out;
}

function nearAnyTree(trees, x, z, r) {
  const r2 = r * r;
  for (const [tx, tz] of trees) {
    const dx = tx - x, dz = tz - z;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

// The walking/structure contract, derived from the exact instance boxes so the sampler and the keepout agree with
// what is rendered. A point in the box's rotated local frame (rotate the world offset by -ry about Y) is inside when
// |lx| <= hx and |lz| <= hz; the walking height is the rendered instance top (y + sy/2).
//   surfaces  — raised walkable tops (the grass terraces, and any apron raised above the ground)
//   structures — footprints to keep random foliage/paths off (terraces, apron discs, pavilion columns, path slabs)
function buildSurfaceContract(lists) {
  const surfaces = [];
  const structures = [];
  const addBox = (it, isSurface) => {
    const rec = { cx: it.x, cz: it.z, hx: it.sx / 2, hz: it.sz / 2, ry: it.ry || 0, topY: it.y + it.sy / 2 };
    structures.push(rec);
    if (isSurface) surfaces.push(rec);
  };
  for (const t of lists.terraces) addBox(t, true);
  for (const a of lists.aprons) {
    const disc = { cx: a.x, cz: a.z, r: a.sx, topY: a.y + a.sy / 2, disc: true };
    structures.push(disc);
    // a flat stage/pavilion apron sits on the ground; only a genuinely raised apron is a walking surface
    if (disc.topY > GROUND + 0.15) surfaces.push(disc);
  }
  for (const c of lists.iron) {
    if (c.sy >= 1.5) structures.push({ cx: c.x, cz: c.z, hx: c.sx / 2, hz: c.sz / 2, ry: c.ry || 0, topY: c.y + c.sy / 2 });
  }
  for (const p of lists.path) structures.push({ cx: p.x, cz: p.z, hx: p.sx / 2, hz: p.sz / 2, ry: p.ry || 0, topY: p.y + p.sy / 2 });
  return { surfaces, structures };
}

function surfaceHit(rec, x, z, margin) {
  if (rec.disc) return Math.hypot(x - rec.cx, z - rec.cz) <= rec.r + margin;
  const dx = x - rec.cx, dz = z - rec.cz;
  const c = Math.cos(rec.ry), sn = Math.sin(rec.ry);
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
  return Math.abs(lx) <= rec.hx + margin && Math.abs(lz) <= rec.hz + margin;
}

function surfaceHitAny(list, x, z, margin) {
  for (const rec of list) if (surfaceHit(rec, x, z, margin)) return true;
  return false;
}

// Walkable surface under a point (terraces / raised aprons). Max rendered top where several overlap. Returns null when
// nothing raised is there, or when the garden has not been built in this frame (no ghost floor).
// A conservative plan box for a built layout, computed once and cached on the layout object: a query away from the
// feature returns at the box test instead of walking every piece (deckHeightAt and deckStoodOn ask every frame, for
// every body, anywhere in the city; st-s1y8). An empty layout gets an empty box (nothing can hit it).
const SURFACE_BOUNDS = new WeakMap();
function surfaceBounds(layout, fill) {
  let b = SURFACE_BOUNDS.get(layout);
  if (!b) {
    b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    fill((x, z, r = 0) => {
      if (x - r < b.minX) b.minX = x - r; if (x + r > b.maxX) b.maxX = x + r;
      if (z - r < b.minZ) b.minZ = z - r; if (z + r > b.maxZ) b.maxZ = z + r;
    });
    SURFACE_BOUNDS.set(layout, b);
  }
  return b;
}
const outsideBounds = (b, x, z) => x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ;

function waterfrontMusicGardenSurfaceAt(x, z) {
  const R = C?.waterfrontMusicGarden;
  if (!C?.waterfrontMusicGardenEnabled || !R || !Array.isArray(R.surfaces)) return null;
  if (outsideBounds(surfaceBounds(R.surfaces, (add) => {
    for (const s of R.surfaces) add(s.cx, s.cz, s.disc ? s.r : Math.hypot(s.hx, s.hz));
  }), x, z)) return null;
  let h = -Infinity;
  for (const s of R.surfaces) if (s.topY > h && surfaceHit(s, x, z, 0)) h = s.topY;
  if (h === -Infinity) return null;
  return { h, id: 'music-garden-gigue', pedestrianOnly: true };
}

// Precise keep-out for the garden's actual hard footprints and path slabs only (not the whole park): the pavilion
// apron/columns, the amphitheatre stage disc and grass terraces, and the connecting path slabs.
function gardenStructureKeepoutAt(x, z, margin = 0) {
  const R = C?.waterfrontMusicGarden;
  if (!C?.waterfrontMusicGardenEnabled || !R || !Array.isArray(R.structures)) return false;
  // (ez-trees.js asks this for every tree site in the city: the structures' box, grown by the margin, rejects first)
  const b = surfaceBounds(R.structures, (add) => {
    for (const s of R.structures) add(s.cx, s.cz, s.disc ? s.r : Math.hypot(s.hx, s.hz));
  });
  // (a rotated rectangle grown by the margin along its own axes reaches margin * sqrt(2) further along a world axis)
  const m = margin > 0 ? margin * Math.SQRT2 : 0;
  if (x < b.minX - m || x > b.maxX + m || z < b.minZ - m || z > b.maxZ + m) return false;
  for (const s of R.structures) if (surfaceHit(s, x, z, margin)) return true;
  return false;
}

// One room's floor, planting, trees and boulders, inside its Voronoi cell.
function addRoomFill(frame, room, cells, lists, stats, keepTrees) {
  const mine = cells.filter((c) => c.room === room);
  if (!mine.length) return stats;
  const bedColor = {
    pathstone: 0x9a9186, mulch: 0x4a3a2c, meadow: 0x8a9a4a, moss: 0x3f5a3a, paving: 0xa7a29a, grass: 0x6f8f4a
  }[room.ground] || 0x5a6b3a;
  const plantColor = {
    hackberry: 0x5b6f3a, birch: 0x8fae6a, wildflower: 0xb9a23c, conifer: 0x2f4a34, mixed: 0x557a44, willow: 0x6f8f4a
  }[room.planting] || 0x5b6f3a;
  const rotY = -Math.atan2(frame.sa, frame.ca);

  // room floor: one low slab per sampling cell, in the room's ground colour
  for (const c of mine) {
    lists.beds.push({ x: c.x, y: GROUND + 0.02, z: c.z, sx: ESTIMATES.cellGrid * 1.02, sy: 0.04, sz: ESTIMATES.cellGrid * 1.02, ry: rotY, color: bedColor });
  }
  stats.beds++;

  // planting: low clumps on a subset of the room's cells, clear of the room's own path spine
  const density = room.character === 'pavilion' || room.character === 'amphitheatre' ? 0.12
    : room.character === 'meadow' ? 0.8 : 0.55;
  const target = Math.min(150, Math.round(mine.length * density));
  for (let i = 0; i < target; i++) {
    const c = mine[Math.floor(hash(i * 3.1, room.order) * mine.length)];
    const jx = (hash(i * 1.7, c.u) - 0.5) * ESTIMATES.cellGrid * 0.8;
    const jz = (hash(i * 2.3, c.v) - 0.5) * ESTIMATES.cellGrid * 0.8;
    const px = c.x + jx, pz = c.z + jz;
    if (!pointInRing(frame.ring, px, pz) && room.character !== 'amphitheatre') continue;
    const h = 0.28 + hash(c.u, c.v) * 0.5;
    const w = 0.5 + hash(c.v, c.u) * 0.5;
    lists.plants.push({ x: px, y: GROUND + h / 2 + 0.02, z: pz, sx: w, sy: h, sz: w, color: plantColor, ry: hash(px, pz) * Math.PI });
    stats.plants++;
  }

  // A handful of trees per grove / still / entry / amphitheatre room, emitted as SITES for the shared ez-trees
  // pipeline (no crown or trunk geometry is rendered here). Each site names a real manifest model, a species
  // fallback and a target height (6-10 m), and is cleared of the source tree inventory and the structure keep-outs.
  if (room.character === 'grove' || room.character === 'still' || room.character === 'entry' || room.character === 'amphitheatre') {
    const treeN = room.character === 'grove' ? 16 : room.character === 'still' ? 12 : room.character === 'amphitheatre' ? 3 : 6;
    const [au, av] = roomAnchorLocal(frame, room);
    const spec = TREE_MODEL_BY_PLANTING[room.planting] || TREE_MODEL_BY_PLANTING.mixed;
    for (let i = 0; i < treeN; i++) {
      const c = mine[Math.floor(hash(i * 7.3 + 1.1, room.order * 2.9) * mine.length)];
      if (!c) continue;
      if (room.feature === 'amphitheatre') {
        const [wx, wz] = localToWorld(frame, au, av);
        if (Math.hypot(c.x - wx, c.z - wz) < ESTIMATES.amphitheatreRadius + 1) continue;
      }
      // keep the source tree inventory: never drop a grove tree on or beside a mapped City street tree
      if (keepTrees.length && nearAnyTree(keepTrees, c.x, c.z, ESTIMATES.treeClearance)) continue;
      const height = spec.height * (0.85 + hash(c.u, c.v) * 0.3); // 6-10 m, varied
      const width = height * 0.32 * (0.85 + hash(c.v, c.u) * 0.3); // crown radius estimate
      lists.treeSites.push({ x: c.x, z: c.z, y: 0, height, width, species: spec.species, model: spec.model, room: room.id });
      stats.trees++;
    }
  }

  // glacier-tumbled granite boulders scattered through the room (documented throughout the garden)
  const boulderN = room.character === 'entry' ? 10 : 5;
  for (let i = 0; i < boulderN; i++) {
    const c = mine[Math.floor(hash(i * 5.1 + 2.2, room.order * 8.7) * mine.length)];
    if (!c) continue;
    const s = ESTIMATES.boulderSize * (0.6 + hash(c.u, c.v) * 0.7);
    const boulderColor = GRANITE_PALETTE[Math.floor(hash(c.v * 2.3, c.u * 4.1) * GRANITE_PALETTE.length) % GRANITE_PALETTE.length];
    lists.boulders.push({ x: c.x, y: GROUND + s * 0.35, z: c.z, sx: s, sy: s * 0.7, sz: s, ry: hash(c.x, c.z) * Math.PI, color: boulderColor });
    stats.boulders++;
  }
  return stats;
}

function roomAnchorWorld(frame, room) {
  const [u, v] = roomAnchorLocal(frame, room);
  return localToWorld(frame, u, v);
}

// The Music Pavilion: a small open wrought-iron shelter on a paved apron (eight iron columns, an octagonal roof, a
// low iron balustrade). The arch/roof and the stage are the design's; dimensions are estimated.
function addPavilion(frame, room, lists, stats) {
  const [cx, cz] = roomAnchorWorld(frame, room);
  const R = ESTIMATES.pavilionRadius;
  const H = ESTIMATES.pavilionHeight;
  lists.aprons.push({ x: cx, y: GROUND + 0.02, z: cz, sx: R * 1.5, sy: 0.05, sz: R * 1.5, color: 0x9c968c });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = cx + Math.cos(a) * (R - 0.4), pz = cz + Math.sin(a) * (R - 0.4);
    lists.iron.push({ x: px, y: GROUND + H / 2, z: pz, sx: 0.12, sy: H, sz: 0.12, color: 0x45443f });
    stats.pavilionParts++;
  }
  lists.pavilionRoofs.push({ x: cx, y: GROUND + H + 0.5, z: cz, sx: R, sy: 1.0, sz: R, color: 0x4c4c47 });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const px = cx + Math.cos(a) * R, pz = cz + Math.sin(a) * R;
    lists.iron.push({ x: px, y: GROUND + 0.5, z: pz, sx: 0.06, sy: 1.0, sz: (Math.PI * 2 * R) / 24, color: 0x45443f, ry: a });
    stats.pavilionParts++;
  }
  lists.features.push({ id: 'pavilion', type: 'MusicPavilion', x: cx, z: cz, radius: R, height: H });
}

// The Gigue: "wide grass steps dance down the hillside into an amphitheatre-like space" under a willow (JMMDS). The
// treads are GRASS; granite is only a low rim at the stage and the boulders scattered through the garden. The bowl
// opens toward the harbour (south, +v) with the grass terraces rising on the uphill (north) side, matching the
// designer's overhead and the node that sits just south of the park edge.
function addAmphitheatre(frame, room, lists, stats) {
  const [au, av] = roomAnchorLocal(frame, room);
  const [cx, cz] = localToWorld(frame, au, av);
  const Rstage = ESTIMATES.amphitheatreRadius * 0.4;
  const rise = ESTIMATES.amphitheatreStepRise;
  const run = ESTIMATES.amphitheatreStepRun;
  const rows = ESTIMATES.amphitheatreRows;
  // flat lawn stage disc at the anchor (the bottom of the steps, toward the harbour)
  lists.aprons.push({ x: cx, y: GROUND + 0.03, z: cz, sx: Rstage * 2, sy: 0.06, sz: Rstage * 2, color: 0x6f8f4a });
  let y = GROUND;
  for (let row = 0; row < rows; row++) {
    y += rise;
    const rMid = Rstage + (row + 0.5) * run;
    const blocks = 28;
    for (let i = 0; i < blocks; i++) {
      const a = (i / blocks) * Math.PI * 2;
      const bu = au + Math.cos(a) * rMid, bv = av + Math.sin(a) * rMid;
      // open the bowl toward the harbour (+v = south): keep the uphill half only
      if (bv > av + 0.5) continue;
      const [px, pz] = localToWorld(frame, bu, bv);
      const seg = (Math.PI * 2 * rMid) / blocks;
      lists.terraces.push({ x: px, y: y - rise / 2, z: pz, sx: seg * 0.94, sy: rise, sz: run * 0.94, color: 0x6f8f4a, ry: a });
      if (row === 0) lists.granite.push({ x: px, y: y - rise - 0.02, z: pz, sx: seg * 0.96, sy: 0.06, sz: 0.12, color: 0x8d8a83, ry: a });
      stats.amphitheatreTerraces++;
    }
  }
  lists.features.push({ id: 'amphitheatre', type: 'GigueAmphitheatre', x: cx, z: cz, radius: Rstage + rows * run, rows });
}

// The Sarabande water-filled stone: a granite block with a still (dark, water-level) inset pool.
function addWaterStone(frame, room, lists, stats) {
  const [cx, cz] = roomAnchorWorld(frame, room);
  const R = ESTIMATES.waterStoneRadius;
  lists.boulders.push({ x: cx, y: GROUND + R * 0.5, z: cz, sx: R * 2, sy: R, sz: R * 2, color: 0x7f7d78 });
  lists.pools.push({ x: cx, y: GROUND + R * 0.92, z: cz, sx: R * 1.5, sy: 0.03, sz: R * 1.5, color: 0x2f4a52 });
  stats.waterStones++;
  lists.features.push({ id: 'waterStone', type: 'WaterStone', x: cx, z: cz, radius: R });
}

// The connecting walk, drawn as short paving slabs following gardenPath (world points).
function addPath(frame, lists) {
  const path = gardenPath(frame);
  for (let i = 1; i < path.length; i++) {
    const [x0, z0] = path[i - 1], [x1, z1] = path[i];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) continue;
    const ang = Math.atan2(dx, dz);
    lists.path.push({ x: (x0 + x1) / 2, y: GROUND + 0.015, z: (z0 + z1) / 2, sx: ESTIMATES.pathWidth, sy: 0.03, sz: len + 0.02, ry: ang, color: 0xa39a8a });
  }
}

// Build only when the frame really covers the mapped garden (a guard against drawing fixed coordinates in an
// unrelated frame), the six movement nodes are present, and the footprint reads as dry park land.
function waterfrontMusicGardenSupported() {
  const G = C?.GEO;
  if (!G || !G.frame || !G.frame.detail || !C?.CITY_BOUNDS) return false;
  if (!Array.isArray(G.areas) || G.areas.length === 0) return false;
  const frame = gardenFrame();
  if (!frame) return false;
  const anchors = musicGardenAnchors();
  if (Object.keys(anchors).length < 6) return false;
  const d = G.frame.detail;
  for (const [x, z] of frame.ring) {
    if (!(x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1)) return false;
  }
  let n = 0, dry = 0;
  for (let i = 0; i < 60; i++) {
    const [px, pz] = localToWorld(frame,
      lerp(frame.u0 + 5, frame.u1 - 5, hash(i, 1.3)),
      lerp(frame.v0 + 5, frame.v1 - 5, hash(i, 2.7)));
    if (!pointInRing(frame.ring, px, pz)) continue;
    n++;
    if (!C.waterAt(px, pz)) dry++;
  }
  return n > 8 && dry / n >= 0.9;
}

function createWaterfrontMusicGarden(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-music-garden: THREE is required');
  const frame = gardenFrame();
  if (!frame || !waterfrontMusicGardenSupported()) {
    if (C) C.waterfrontMusicGardenEnabled = false;
    console.info('[waterfrontMusicGarden] skipped: the active city frame does not cover the mapped Music Garden');
    return null;
  }
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const group = new THREE.Group();
  group.name = 'WaterfrontMusicGarden';

  const lists = {
    beds: [], plants: [], treeSites: [], boulders: [], path: [], aprons: [], iron: [], pavilionRoofs: [],
    granite: [], terraces: [], pools: [], features: []
  };
  const cells = roomCells(frame);
  const keepTrees = existingTreePositions(frame);
  const roomStats = {};
  for (const room of MUSIC_GARDEN_ROOMS) {
    roomStats[room.id] = { beds: 0, plants: 0, boulders: 0, trees: 0, pavilionParts: 0, amphitheatreTerraces: 0, waterStones: 0 };
    addRoomFill(frame, room, cells, lists, roomStats[room.id], keepTrees);
    if (room.feature === 'pavilion') addPavilion(frame, room, lists, roomStats[room.id]);
    else if (room.feature === 'amphitheatre') addAmphitheatre(frame, room, lists, roomStats[room.id]);
    else if (room.feature === 'waterStone') addWaterStone(frame, room, lists, roomStats[room.id]);
  }
  addPath(frame, lists);

  const soil = standardMaterial(THREE, { color: 0xffffff, roughness: 0.95, metalness: 0.0 });
  const leaf = standardMaterial(THREE, { color: 0xffffff, roughness: 0.9, metalness: 0.0 });
  const stone = standardMaterial(THREE, { color: 0xffffff, roughness: 0.86, metalness: 0.03 });
  const graniteMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.7, metalness: 0.06 });
  const grassMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.95, metalness: 0.0 });
  const iron = standardMaterial(THREE, { color: 0xffffff, roughness: 0.64, metalness: 0.22 });
  const pave = standardMaterial(THREE, { color: 0xffffff, roughness: 0.9, metalness: 0.02 });
  const waterMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.2, metalness: 0.1 });

  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  const cone = new THREE.ConeGeometry(1, 1, 8);
  const blob = new THREE.IcosahedronGeometry(1, 1);
  const meshes = [];
  const add = (mesh, role) => { if (mesh) { mesh.userData.role = role; meshes.push(mesh); group.add(mesh); } };

  add(makeInstanced(THREE, box, soil, lists.beds, 'WaterfrontMusicGarden-Beds', { castShadow: false, cullDistance: 900, cullCell: 120 }), 'room-beds');
  add(makeInstanced(THREE, box, leaf, lists.plants, 'WaterfrontMusicGarden-Plants', { castShadow: true, cullDistance: 500, cullCell: 80 }), 'planting');
  // (no tree crowns or trunks: the groves are exported as sites for the shared ez-trees pipeline, see treeSites)
  add(makeInstanced(THREE, blob, stone, lists.boulders, 'WaterfrontMusicGarden-Boulders', { cullDistance: 500, cullCell: 120 }), 'granite-boulders');
  add(makeInstanced(THREE, box, pave, lists.path, 'WaterfrontMusicGarden-Path', { castShadow: false, cullDistance: 700, cullCell: 120 }), 'winding-path');
  add(makeInstanced(THREE, cyl, pave, lists.aprons, 'WaterfrontMusicGarden-Aprons', { castShadow: false, cullDistance: 700, cullCell: 120 }), 'paving-aprons');
  add(makeInstanced(THREE, box, iron, lists.iron, 'WaterfrontMusicGarden-Ironwork', { cullDistance: 600, cullCell: 120 }), 'pavilion-ironwork');
  add(makeInstanced(THREE, cone, iron, lists.pavilionRoofs, 'WaterfrontMusicGarden-PavilionRoof', { cullDistance: 600, cullCell: 120 }), 'pavilion-roof');
  add(makeInstanced(THREE, box, grassMat, lists.terraces, 'WaterfrontMusicGarden-GrassSteps', { cullDistance: 700, cullCell: 120 }), 'amphitheatre-grass-steps');
  add(makeInstanced(THREE, box, graniteMat, lists.granite, 'WaterfrontMusicGarden-GraniteRim', { castShadow: false, cullDistance: 600, cullCell: 120 }), 'amphitheatre-granite-rim');
  add(makeInstanced(THREE, box, waterMat, lists.pools, 'WaterfrontMusicGarden-WaterStone', { castShadow: false, cullDistance: 500, cullCell: 120 }), 'water-stone');

  // Colliders: the full-height pavilion columns are solid; the grass steps, beds and planting are walkable.
  const colliders = [];
  for (const c of lists.iron) {
    if (c.sy < 1.5) continue;
    colliders.push({
      minX: c.x - 0.12, maxX: c.x + 0.12, minZ: c.z - 0.12, maxZ: c.z + 0.12,
      minY: c.y - c.sy / 2, maxY: c.y + c.sy / 2, prop: true, kind: 'pavilioncolumn',
      obb: { cx: c.x, cz: c.z, hx: 0.12, hz: 0.12, cs: 1, sn: 0 }
    });
  }

  let triangles = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    triangles += tris * mesh.count;
  }
  const layout = gardenLayout();
  const contract = buildSurfaceContract(lists);
  // Supplemental tree sites: unique, finite, 6-10 m, clear of the structure keep-outs and (for the tree engine) the
  // mapped City trees. Each carries model + height + species + width for ez-trees and a `scale` for the fallback.
  const slop = slopTreeHeight();
  const treeSites = [];
  const seen = [];
  for (const s of lists.treeSites) {
    if (!Number.isFinite(s.x) || !Number.isFinite(s.z) || !Number.isFinite(s.height)) continue;
    if (s.height < 6 || s.height > 10) continue;
    if (contract.structures.length && surfaceHitAny(contract.structures, s.x, s.z, 0.25)) continue; // no tree in a structure
    let dup = false;
    for (const [sx, sz] of seen) { if (Math.hypot(sx - s.x, sz - s.z) < 2) { dup = true; break; } }
    if (dup) continue;
    seen.push([s.x, s.z]);
    treeSites.push({
      x: s.x, z: s.z, y: 0, height: s.height, width: s.width,
      species: s.species, model: s.model, scale: s.height / slop, tier: 0, room: s.room
    });
  }
  const stats = {
    rooms: roomStats, layout,
    beds: lists.beds.length, plants: lists.plants.length, treeSites: treeSites.length,
    boulders: lists.boulders.length, pathSlabs: lists.path.length, aprons: lists.aprons.length,
    ironwork: lists.iron.length, amphitheatreTerraces: lists.terraces.length, granitePieces: lists.granite.length,
    waterStones: lists.pools.length,
    surfaces: contract.surfaces.length, structures: contract.structures.length,
    features: lists.features, meshes: meshes.length, triangles: Math.round(triangles),
    colliders: colliders.length,
    ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10
  };
  group.userData.waterfrontMusicGarden = stats;
  if (scene && scene.add) scene.add(group);
  const result = {
    group, root: group, colliders, stats, layout, treeSites,
    surfaces: contract.surfaces, structures: contract.structures
  };
  if (C) {
    C.waterfrontMusicGarden = result;
    C.waterfrontMusicGardenTreeSites = treeSites; // the captain appends these to streetDetails.treePositions
    C.waterfrontMusicGardenEnabled = true;
  }
  console.info(`[waterfrontMusicGarden] ${layout.rooms.map((r) => `${r.name} (${r.character})`).join(', ')}: ` +
    `${stats.plants} plants, ${stats.treeSites} supplemental tree sites (ez-trees), ` +
    `${stats.amphitheatreTerraces} grass amphitheatre terraces, ${stats.triangles} triangles, ${stats.ms} ms`);
  return result;
}

Object.assign(C || (window.CITY = {}), {
  MUSIC_GARDEN_ROOMS,
  MUSIC_GARDEN_ESTIMATES: ESTIMATES,
  gardenFrame,
  gardenLayout,
  gardenRoomAt,
  gardenFootprintAt,
  gardenPathPassesRooms,
  musicGardenAnchors,
  roomCells,
  existingTreePositions,
  TREE_MODEL_BY_PLANTING,
  slopTreeHeight,
  waterfrontMusicGardenSurfaceAt,
  gardenStructureKeepoutAt,
  waterfrontMusicGardenSupported,
  createWaterfrontMusicGarden,
  buildWaterfrontMusicGarden: createWaterfrontMusicGarden
});
})();