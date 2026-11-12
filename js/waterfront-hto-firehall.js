(function () {
// js/waterfront-hto-firehall.js
// Replacement mass for the mapped HTO East firehall. The committed GEO building row named "Toronto Fire and Marine
// Station 334 EMS station 36" carries a generic 28.5 m tower height, while the primary contractor confirms a TWO STOREY,
// 13,000 sq ft harbourfront fire station. This module draws the low, correct mass at the mapped part footprint and
// exposes an exclusion predicate so the captain can skip that one named row in js/buildings.js. It never mutates GEO,
// never deletes another building and never places boats or invented props.
//
// Primary sources (recorded 2026-11-10):
// - MJ Dixon, Harbourfront Fire Station, Toronto: "two storey", 13,000 sq ft:
//   https://mjdixon.ca/project/harbourfront-fire-station-toronto/
//   Photo: https://mjdixon.ca/wp-content/uploads/2019/09/Harbourfront-Fire-Station_1.jpg
//   Local copies: $WATERFRONT_RESEARCH/research/hto-firehall.jpg and hto-firehall-side.jpg.
// - Captain's photo read: pale gray large-panel facade, tall glazed garage-bay doors, dark blue-gray lettering
//   "TORONTO Fire & Marine Station 334 / EMS Station 36", corrugated upper strip; side view shows a lower ~5 m flat
//   volume with a roof terrace and dark horizontal rail, and a recessed upper block to ~8.5 m. ASLA aerial
//   hto-photo-2.webp shows a rectangular white flat roof. The 8.5 m upper height is an explicit photo estimate; two
//   storeys is the primary fact.
// - Mapped footprint: the named GEO.buildings row (five parts, angle 1.568) is used unchanged for the mass and
//   colliders. No part is moved to fit the module.
//
// Geometry conventions: 1 unit = 1 m, world x east, z south, ground y = 0. Call
// createWaterfrontHtoFirehall(THREE, scene); it returns { group, root, colliders, stats, layout, replacedRow }.
// The group is a culling root with shared bounded materials. The original row remains in GEO until the captain's
// buildings.js skips it using htoFirehallReplacesBuilding(row) / htoFirehallExclusionAt(x, z).

const C = window.CITY;
const NAME = /Toronto Fire and Marine Station 334/i;
const LOWER_HEIGHT = 5.0;
const UPPER_HEIGHT = 8.5;
const UPPER_INSET = 1.4;
const GARAGE_BAYS = 3;
const SOURCE_FLOOR_AREA_SQFT = 13000;

function ringBoxOfParts(block) {
  const [cx, cz, ang, parts] = block;
  const cs = Math.cos(ang || 0), sn = Math.sin(ang || 0);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [u0, u1, v0, v1] of parts) {
    for (const u of [u0, u1]) for (const v of [v0, v1]) {
      const x = cx + u * cs + v * sn, z = cz - u * sn + v * cs;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  return { minX, maxX, minZ, maxZ };
}

function findRow(geo) {
  if (!geo || !Array.isArray(geo.buildings)) return null;
  for (const row of geo.buildings) {
    if (!Array.isArray(row) || row.length < 5) continue;
    if (!NAME.test(row[9] || '')) continue;
    if (!Array.isArray(row[3]) || !row[3].length) continue;
    return row;
  }
  return null;
}

function frameCovers(frame, box) {
  if (!frame) return false;
  const f = frame.detail || frame;
  return box.minX >= f.x0 && box.maxX <= f.x1 && box.minZ >= f.z0 && box.maxZ <= f.z1;
}

function firehallLayout({ buildings = C?.GEO?.buildings, frame = C?.GEO?.frame } = {}) {
  const row = findRow({ buildings });
  if (!row) return { supported: false, reason: 'named Toronto Fire and Marine Station 334 row not found' };
  const box = ringBoxOfParts(row);
  if (!frameCovers(frame, box)) return { supported: false, reason: 'firehall is not in the active GEO frame' };
  const [cx, cz, ang] = row;
  const parts = row[3].map(([u0, u1, v0, v1]) => {
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
    return {
      u0, u1, v0, v1,
      cx: cx + uc * Math.cos(ang) + vc * Math.sin(ang),
      cz: cz - uc * Math.sin(ang) + vc * Math.cos(ang),
      w: u1 - u0, d: v1 - v0
    };
  });
  const main = parts.slice().sort((a, b) => b.w * b.d - a.w * a.d)[0];
  return {
    supported: true, row, block: { cx, cz, ang, cs: Math.cos(ang), sn: Math.sin(ang) },
    parts, main, bounds: box, source: { storeys: 2, floorAreaSqFt: SOURCE_FLOOR_AREA_SQFT },
    heights: { lower: LOWER_HEIGHT, upper: UPPER_HEIGHT, upperSource: 'photo estimate' }
  };
}

function standardMaterial(THREE, params) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat(params);
}

function merge(THREE, geos) {
  const list = geos.filter(Boolean);
  if (!list.length) return null;
  const mergeGeometries = C?.Addons?.mergeGeometries;
  if (!mergeGeometries) throw new Error('waterfront-hto-firehall: CITY.Addons.mergeGeometries is required');
  const out = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return out;
}

// A local part box: x is the block local u axis, z the block local v axis, exactly as GEO.buildings is drawn.
function localBox(THREE, layout, u0, u1, v0, v1, y0, y1) {
  const { cx, cz, ang } = layout.block;
  const w = u1 - u0, d = v1 - v0, h = y1 - y0;
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  const x = cx + uc * Math.cos(ang) + vc * Math.sin(ang);
  const z = cz - uc * Math.sin(ang) + vc * Math.cos(ang);
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(ang);
  return g.translate(x, y0 + h / 2, z);
}

function localPanel(THREE, layout, u0, u1, v, depth, y0, y1) {
  return localBox(THREE, layout, u0, u1, v - depth / 2, v + depth / 2, y0, y1);
}

function createWaterfrontHtoFirehall(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-hto-firehall: THREE is required');
  const layout = firehallLayout();
  if (!layout.supported) {
    if (C) {
      C.waterfrontHtoFirehallEnabled = false;
      C.waterfrontHtoFirehallError = layout.reason;
    }
    console.info(`[waterfrontHtoFirehall] skipped: ${layout.reason}`);
    return null;
  }
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const group = new THREE.Group();
  group.name = 'WaterfrontHtoFirehall';
  const meshes = [], colliders = [];
  const add = (mesh, role) => {
    if (!mesh) return;
    mesh.userData.role = role;
    mesh.userData.cullDistance = 700;
    mesh.userData.cullCell = 120;
    if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
    meshes.push(mesh);
    group.add(mesh);
  };

  const panel = standardMaterial(THREE, { color: 0xc9c7c1, roughness: 0.86, metalness: 0.04 });
  const upperPanel = standardMaterial(THREE, { color: 0xb9b7b1, roughness: 0.82, metalness: 0.05 });
  const roof = standardMaterial(THREE, { color: 0xdcdad4, roughness: 0.94, metalness: 0.0 });
  const glass = standardMaterial(THREE, { color: 0x26323a, roughness: 0.22, metalness: 0.38 });
  const signMat = standardMaterial(THREE, { color: 0x2f3d4d, roughness: 0.6, metalness: 0.12 });
  const railMat = standardMaterial(THREE, { color: 0x2b2e30, roughness: 0.45, metalness: 0.55 });
  const ribMat = standardMaterial(THREE, { color: 0xbfbdb6, roughness: 0.78, metalness: 0.1 });

  const lowerGeos = [], roofGeos = [], upperGeos = [], doorGeos = [], signGeos = [], glassGeos = [], railGeos = [], ribGeos = [];
  for (const part of layout.parts) {
    lowerGeos.push(localBox(THREE, layout, part.u0, part.u1, part.v0, part.v1, 0, LOWER_HEIGHT));
    roofGeos.push(localBox(THREE, layout, part.u0, part.u1, part.v0, part.v1, LOWER_HEIGHT, LOWER_HEIGHT + 0.08));
    colliders.push({
      minX: part.cx - Math.abs(Math.cos(layout.block.ang)) * part.w / 2 - Math.abs(Math.sin(layout.block.ang)) * part.d / 2,
      maxX: part.cx + Math.abs(Math.cos(layout.block.ang)) * part.w / 2 + Math.abs(Math.sin(layout.block.ang)) * part.d / 2,
      minZ: part.cz - Math.abs(Math.sin(layout.block.ang)) * part.w / 2 - Math.abs(Math.cos(layout.block.ang)) * part.d / 2,
      maxZ: part.cz + Math.abs(Math.sin(layout.block.ang)) * part.w / 2 + Math.abs(Math.cos(layout.block.ang)) * part.d / 2,
      minY: 0, maxY: LOWER_HEIGHT, prop: true, kind: 'firehall',
      obb: { cx: part.cx, cz: part.cz, hx: part.w / 2, hz: part.d / 2, cs: Math.cos(layout.block.ang), sn: Math.sin(layout.block.ang) }
    });
  }
  // Recessed upper storey on the main (largest) mapped part, inset from the lower roof.
  const m = layout.main;
  const u0 = m.u0 + UPPER_INSET, u1 = m.u1 - UPPER_INSET, v0 = m.v0 + UPPER_INSET, v1 = m.v1 - UPPER_INSET;
  if (u1 - u0 > 3 && v1 - v0 > 3) {
    upperGeos.push(localBox(THREE, layout, u0, u1, v0, v1, LOWER_HEIGHT, UPPER_HEIGHT));
    // narrow vertical glazing on the recessed upper east facade
    for (let u = u0 + 1.2; u < u1 - 0.8; u += 2.2) {
      glassGeos.push(localPanel(THREE, layout, u, u + 0.32, v1 + 0.03, 0.05, LOWER_HEIGHT + 0.45, UPPER_HEIGHT - 0.55));
    }
    // corrugated upper strip: vertical ribs across the east face near the parapet
    for (let u = u0 + 0.35; u < u1 - 0.2; u += 0.32) {
      ribGeos.push(localPanel(THREE, layout, u, u + 0.055, v1 + 0.05, 0.05, UPPER_HEIGHT - 0.85, UPPER_HEIGHT - 0.2));
    }
  }
  // Tall glazed garage-bay doors and the dark blue-gray sign band on the east facade of the main part.
  const baySpan = Math.min(3.8, ((m.u1 - m.u0) - 1.2) / GARAGE_BAYS);
  const totalBays = baySpan * GARAGE_BAYS;
  const startU = m.u0 + (m.u1 - m.u0 - totalBays) / 2;
  for (let i = 0; i < GARAGE_BAYS; i++) {
    const a = startU + i * baySpan + 0.18;
    const b = startU + (i + 1) * baySpan - 0.18;
    doorGeos.push(localPanel(THREE, layout, a, b, m.v1 + 0.035, 0.06, 0.15, 4.15));
    signGeos.push(localPanel(THREE, layout, a, b, m.v1 + 0.045, 0.05, 4.28, 4.78));
  }
  // Roof-terrace rail on the east edge of the lower flat volume (dark horizontal rail, photo-confirmed).
  const railU0 = m.u0 + 0.35, railU1 = m.u1 - 0.35, railV = m.v1 + 0.09;
  for (const y of [LOWER_HEIGHT + 0.45, LOWER_HEIGHT + 0.95]) {
    railGeos.push(localPanel(THREE, layout, railU0, railU1, railV, 0.05, y, y + 0.055));
  }
  for (let u = railU0; u <= railU1; u += 2.4) {
    railGeos.push(localPanel(THREE, layout, u, u + 0.07, railV, 0.06, LOWER_HEIGHT, LOWER_HEIGHT + 1.0));
  }

  add(new THREE.Mesh(merge(THREE, lowerGeos), panel), 'firehall-lower-mass');
  add(new THREE.Mesh(merge(THREE, roofGeos), roof), 'firehall-flat-roof');
  add(new THREE.Mesh(merge(THREE, upperGeos), upperPanel), 'firehall-recessed-upper');
  add(new THREE.Mesh(merge(THREE, doorGeos), glass), 'firehall-garage-bays');
  add(new THREE.Mesh(merge(THREE, signGeos), signMat), 'firehall-sign-band');
  add(new THREE.Mesh(merge(THREE, glassGeos), glass), 'firehall-vertical-glazing');
  add(new THREE.Mesh(merge(THREE, railGeos), railMat), 'firehall-roof-rail');
  add(new THREE.Mesh(merge(THREE, ribGeos), ribMat), 'firehall-corrugated-strip');

  let triangles = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    triangles += n;
  }
  const stats = {
    replacedName: layout.row[9], sourceStoreys: 2, sourceFloorAreaSqFt: SOURCE_FLOOR_AREA_SQFT,
    lowerHeight: LOWER_HEIGHT, upperHeight: UPPER_HEIGHT, upperHeightSource: 'photo estimate',
    parts: layout.parts.length, garageBays: GARAGE_BAYS, meshes: meshes.length,
    triangles: Math.round(triangles), colliders: colliders.length,
    ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10
  };
  group.userData.waterfrontHtoFirehall = stats;
  if (scene && scene.add) scene.add(group);
  const result = {
    group, root: group, colliders, stats, layout, replacedRow: layout.row,
    replacedName: layout.row[9]
  };
  C.waterfrontHtoFirehall = result;
  C.waterfrontHtoFirehallEnabled = true;
  C.waterfrontHtoFirehallError = null;
  console.info(`[waterfrontHtoFirehall] replaced the named mapped row at ${layout.parts.length} parts: ` +
    `two storeys, ${LOWER_HEIGHT} m lower volume + recessed upper to ${UPPER_HEIGHT} m (photo estimate), ` +
    `${GARAGE_BAYS} glazed garage bays, ${stats.triangles} triangles`);
  return result;
}

// True only after this module successfully built its replacement and only inside that named row's mapped part
// footprints. Before the builder runs, in an unsupported frame, or if the named row is missing, it is false, so the
// captain's buildings.js keeps the original row rather than deleting or hiding the wrong building.
function htoFirehallExclusionAt(x, z, margin = 0) {
  const R = C?.waterfrontHtoFirehall;
  if (!C?.waterfrontHtoFirehallEnabled || !R) return false;
  const { cx, cz, cs, sn } = R.layout.block;
  for (const p of R.layout.parts) {
    const dx = x - p.cx, dz = z - p.cz;
    if (Math.abs(dx * cs - dz * sn) <= p.w / 2 + margin && Math.abs(dx * sn + dz * cs) <= p.d / 2 + margin) return true;
  }
  return false;
}

function htoFirehallReplacesBuilding(row) {
  const R = C?.waterfrontHtoFirehall;
  if (!C?.waterfrontHtoFirehallEnabled || !R || !row) return false;
  return row === R.replacedRow;
}

function htoFirehallSupported() {
  return firehallLayout().supported;
}

Object.assign(C || (window.CITY = {}), {
  HTO_FIREHALL: { name: NAME.source, sourceStoreys: 2, sourceFloorAreaSqFt: SOURCE_FLOOR_AREA_SQFT, lowerHeight: LOWER_HEIGHT, upperHeight: UPPER_HEIGHT, garageBays: GARAGE_BAYS },
  htoFirehallLayout: firehallLayout,
  htoFirehallExclusionAt,
  htoFirehallReplacesBuilding,
  htoFirehallSupported,
  createWaterfrontHtoFirehall,
  buildWaterfrontHtoFirehall: createWaterfrontHtoFirehall
});
})();
