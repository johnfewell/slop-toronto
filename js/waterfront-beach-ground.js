(function () {
// js/waterfront-beach-ground.js
// The real sand ground of Toronto's two harbourfront beaches, Canada's Sugar Beach and HTO Park. The furniture module
// (js/waterfront-details.js) already places the pink umbrellas and white chairs on the verified OSM sand polygons, but
// the ground under them is the generic park lawn, so the GPU captures showed grey pavement and grass strips across the
// sand. This module draws the actual sand surface on those same OSM `natural=beach` polygons and masks the generic lawn
// beneath them, so the beach reads as sand, not a park with chairs on it. It does not move, add or remove furniture,
// trees or paths.
//
// Mapped paths are preserved. Park paths (GEO.parkPaths) are drawn by js/city-grid.js in the FORECOURT material at
// SW_TOP + 0.008 (2 mm above this sand) and are a DIFFERENT material from the lawn, so they are never masked. On top of
// that, the mask exempts every mapped path that crosses a sand ring (point-in-sand AND NOT within a path corridor), so
// the paths survive even if the mask is applied to the path material by mistake. The sand mesh itself is built with the
// path corridors cut out as holes (the same corridor the path fills), so the boardwalk sits in the sand, not buried.
//
// There is NO existing sand anywhere in the city: the two beaches are GEO.areas `kind === 'park'` (HTO Park, Sugar
// Beach) drawn as the generic park lawn; js/city-grid.js has no beach/sand material. That is the missing piece this
// module adds.
//
// Sources (recorded 2026-11-10):
// - OpenStreetMap `natural=beach` ways 172728993 (Sugar Beach, surface=sand, ~3,190 m²) and 189306980 (HTO Beach,
//   ~1,330 m²). These are the exact rings the furniture module uses (window.CITY.WATERFRONT_SAND_RINGS), converted to
//   world metres by the committed GEO projection. No sand polygon is invented and the whole park is never filled.
// - Waterfront Toronto, Canada's Sugar Beach <https://www.waterfrontoronto.ca/our-projects/canadas-sugar-beach> —
//   8,500 m², 225 m shoreline; "brightly coloured pink beach umbrellas", candy-striped granite paving beside the sand.
// - Landscape Architecture Foundation, HTO Park <https://www.landscapeperformance.org/case-study-briefs/hto-park> —
//   fine white sand, 25 mounds, boardwalk.
// - docs/waterfront-details.md and docs/waterfront-realism.md for the established placement, levels and integration.
//
// Geometry conventions (as the rest of the city): 1 unit = 1 m, world x east, z south; the beaches are flat at the
// harbour shore, so the sand surface is the park lawn level, CITY_BOUNDS.sidewalkHeight + 0.004 (0.224 m), where the
// furniture's own grounding already puts umbrella and chair feet. Keeping the sand at exactly that height means the
// chairs stand on the sand, not above or below it. The sand mesh is drawn 2 mm above the lawn and the lawn under the
// sand ring is masked away, so the two never z-fight and no grass shows through the sand.
//
// Frame guard: the sand rings are built when the active GEO frame really covers them. The committed Eglinton frame
// (tools/frames/eglinton.json, world x -7900..9600, z -7300..3600) and the default detail frame (x -7900..3700,
// z -3000..3600) BOTH contain the two beaches, so both build them — Eglinton shares the detail projection and is a
// superset of it, not a separate area. A frame that does not cover a ring (verified against the decoded GEO, not a
// guessed box) skips that beach. No hardcoded row indices: the sand rings come from the shared export and a site is
// skipped, never faked, when its ring is out of frame.

const C = window.CITY;
const SAND_LIFT = 0.002; // the sand mesh sits this far above the lawn it covers (2 mm), so no z-fight after masking

// The two beaches, keyed by the same ids the furniture module and the shared sand-ring export use. Only the OSM sand
// polygon is carried here; the surrounding park/grass/promenade stays the city's own geometry.
const BEACH_SPECS = [
  { id: 'sugarBeach', name: 'Sugar Beach', osm: 'way/172728993', sourceArea: 3190 },
  { id: 'htoPark', name: 'HTO Park', osm: 'way/189306980', sourceArea: 1330 }
];

function ringBox(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function polygonSignedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

// The active frame covers a ring (detail frame, the same one supportedCityFrame-style guards use elsewhere).
function frameCovers(frame, box) {
  if (!frame) return false;
  const f = frame.detail || frame;
  return box.minX >= f.x0 && box.maxX <= f.x1 && box.minZ >= f.z0 && box.maxZ <= f.z1;
}

const SW = () => (C?.CITY_BOUNDS?.sidewalkHeight ?? 0.22);
const SAND_Y = () => SW() + 0.004; // the park lawn's own level: where the furniture stands

// The sand ring for a site id, from the shared export (so this module and the furniture always use the same polygon).
function sandRingFor(id) {
  const rings = C?.WATERFRONT_SAND_RINGS;
  const ring = rings && rings[id];
  return Array.isArray(ring) && ring.length >= 3 ? ring : null;
}

function segIntersectsRing(ring, ax, az, bx, bz) {
  const bounds = ringBox(ring);
  if (Math.max(ax, bx) < bounds.minX || Math.min(ax, bx) > bounds.maxX || Math.max(az, bz) < bounds.minZ || Math.min(az, bz) > bounds.maxZ) return false;
  if (pointInRing(ring, ax, az) || pointInRing(ring, bx, bz)) return true;
  const cross = (cx, cz, dx, dz, ex, ez) => (dx - cx) * (ez - cz) - (dz - cz) * (ex - cx);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cx = ring[j][0], cz = ring[j][1], dx = ring[i][0], dz = ring[i][1];
    const d1 = cross(ax, az, bx, bz, cx, cz), d2 = cross(ax, az, bx, bz, dx, dz);
    const d3 = cross(cx, cz, dx, dz, ax, az), d4 = cross(cx, cz, dx, dz, bx, bz);
    if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
  }
  return false;
}

// The mapped park paths (GEO.parkPaths rows: [fullWidth, x0,z0, x1,z1, ...]) whose segments cross or enter the ring.
// Returned as { ax, az, bx, bz, half } segments so the mask can exempt them and the sand mesh can cut them out. js/
// city-grid.js lays these paths in the forecourt material at SW_TOP+0.008; keeping the exact centre lines and widths
// here means the boardwalk shows in the sand, never buried and never erased.
function mappedPathsOnSand(ring, parkPaths = C?.GEO?.parkPaths) {
  const out = [];
  if (!Array.isArray(parkPaths)) return out;
  for (const row of parkPaths) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const w = row[0], half = (w > 0 ? w : 1.8) / 2;
    for (let i = 2; i + 1 < row.length; i += 2) {
      const ax = row[i - 2], az = row[i - 1], bx = row[i], bz = row[i + 1];
      if (segIntersectsRing(ring, ax, az, bx, bz)) out.push({ ax, az, bx, bz, half });
    }
  }
  return out;
}

// The built layout: which beaches have sand in the active frame, its exact ring, level and area, and the mapped path
// corridors that cross it. Pure; reads the shared sand-ring export, the active GEO frame and GEO.parkPaths, never a
// hardcoded row index.
function waterfrontBeachGroundLayout({ sands = C?.WATERFRONT_SAND_RINGS, frame = C?.GEO?.frame, parkPaths = C?.GEO?.parkPaths, specs = BEACH_SPECS } = {}) {
  const sites = [], skipped = [];
  const y = SAND_Y();
  for (const spec of specs) {
    const ring = (sands && sands[spec.id]) || sandRingFor(spec.id);
    if (!ring) { skipped.push({ id: spec.id, reason: 'no sand ring exported' }); continue; }
    const box = ringBox(ring);
    if (!frameCovers(frame, box)) { skipped.push({ id: spec.id, reason: 'sand not in the active GEO frame' }); continue; }
    const paths = mappedPathsOnSand(ring, parkPaths);
    sites.push({
      id: spec.id, name: spec.name, osm: spec.osm, sourceArea: spec.sourceArea,
      sandRing: ring, sandBox: box, sandY: y, sandMeshY: y + SAND_LIFT, paths,
      area: Math.round(Math.abs(polygonSignedArea(ring)) * 10) / 10
    });
  }
  return { sites, skipped };
}

// The distance from (x, z) to the nearest mapped path corridor of a site (0 inside a corridor): the mask exempts a
// point within a corridor so a path is never discarded.
function pathCorridorHit(site, x, z) {
  for (const s of site.paths) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
    const px = s.ax + dx * t, pz = s.az + dz * t;
    if (Math.hypot(x - px, z - pz) <= s.half + 0.05) return true;
  }
  return false;
}

// The sand surface height at (x, z): the beach level inside a built sand ring, else null. This is the height the
// furniture's feet use; call it to confirm a chair/umbrella is standing on sand, not floating or sunk.
let layoutCacheFrame = null, layoutCache = null;
function currentLayout() {
  if (layoutCacheFrame !== C?.GEO || !layoutCache) { layoutCacheFrame = C?.GEO; layoutCache = waterfrontBeachGroundLayout(); }
  return layoutCache;
}
function waterfrontSandHeightAt(x, z) {
  const { sites } = currentLayout();
  for (const s of sites) {
    const b = s.sandBox;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if (pointInRing(s.sandRing, x, z)) return s.sandY;
  }
  return null;
}
// Is (x, z) open sand (a point keep-out for anything that must not stand on the sand), excluding the mapped path
// corridors that cross it? `margin` grows the ring test outward for clearance checks.
function waterfrontBeachKeepoutAt(x, z, margin = 0) {
  const { sites } = currentLayout();
  for (const s of sites) {
    const b = s.sandBox;
    if (x < b.minX - margin || x > b.maxX + margin || z < b.minZ - margin || z > b.maxZ + margin) continue;
    if (pointInRing(s.sandRing, x, z) && !pathCorridorHit(s, x, z)) return true;
  }
  return false;
}

// Is (x, z) on a mapped path corridor crossing a sand ring (so a caller knows to keep it clear rather than put sand)?
function waterfrontBeachPathAt(x, z) {
  const { sites } = currentLayout();
  for (const s of sites) {
    const b = s.sandBox;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if (pointInRing(s.sandRing, x, z) && pathCorridorHit(s, x, z)) return true;
  }
  return false;
}

// The polygons whose ground must be hidden: the exact sand rings, each with its mapped path corridors so a CPU caller
// can preserve them too. Exported for a caller that also wants it off the shader.
function waterfrontBeachExclusionPolygons() {
  return currentLayout().sites.map((s) => ({
    id: s.id, plan: s.sandRing.map((p) => [p[0], p[1]]),
    paths: s.paths.map((p) => ({ ax: p.ax, az: p.az, bx: p.bx, bz: p.bz, half: p.half }))
  }));
}

// Reusable TSL ground mask: a fragment whose world XZ point lies inside a sand ring AND NOT within a mapped path
// corridor is discarded, so the generic lawn beneath the deck is removed but the paths survive. Apply it ONLY to the
// material the generic park lawn uses; the paths are a different material (forecourt) and are never touched, and even
// if it is applied to the path material by mistake the corridor exemption keeps the path:
//
//   C.applyWaterfrontBeachGroundMask(lawnMaterial);   // ONLY the park lawn (and, if present, the plot) material
//
// It composes with an existing maskNode rather than replacing it, is idempotent, and is a no-op off-frame or on a
// non-node material (returns the material untouched). Nothing is mutated before the frame is known.
function applyWaterfrontBeachGroundMask(mat, THREE = C?.THREE) {
  if (!mat) return mat;
  if (mat.userData && mat.userData.waterfrontBeachMask) return mat;
  const { sites } = currentLayout();
  if (!sites.length) return mat;
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const { Fn, positionWorld, float } = T;
  try {
    const node = Fn(() => {
      const p = positionWorld.xz;
      let inside = null;
      for (const s of sites) {
        const ring = s.sandRing;
        // distance-to-segment helper, returning the index of the closest path corridor, in TSL, for the exemption
        const shortest = (ax, az, bx, bz) => {
          const dx = bx - ax, dz = bz - az, L2 = float(dx * dx + dz * dz || 1e-9);
          const t = p.x.sub(float(ax)).mul(float(dx)).add(p.y.sub(float(az)).mul(float(dz))).div(L2);
          const tc = T.clamp(t, float(0), float(1));
          const px = float(ax).add(float(dx).mul(tc)), pz = float(az).add(float(dz).mul(tc));
          return p.x.sub(px).mul(p.x.sub(px)).add(p.y.sub(pz).mul(p.y.sub(pz)));
        };
        // ray cast east from the point: odd crossings = inside, exactly the CPU point-in-ring test
        let crossings = float(0);
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
          if (az === bz) continue;
          const inZ = p.y.greaterThanEqual(float(Math.min(az, bz))).and(p.y.lessThan(float(Math.max(az, bz))));
          const tE = p.y.sub(float(az)).div(float(bz - az));
          const xInt = float(ax).add(float(bx - ax).mul(tE));
          const left = p.x.lessThan(xInt);
          crossings = crossings.add(T.select(inZ.and(left), float(1), float(0)));
        }
        // exempt a point within any mapped path corridor of this site (so the path is never discarded)
        let onPath = null;
        for (const seg of s.paths) {
          const d2 = shortest(seg.ax, seg.az, seg.bx, seg.bz);
          const hit = d2.lessThan(float((seg.half + 0.05) * (seg.half + 0.05)));
          onPath = onPath ? onPath.or(hit) : hit;
        }
        const odd = crossings.mod(2).greaterThan(0.5);
        const inSand = onPath ? odd.and(onPath.not()) : odd;
        inside = inside ? inside.or(inSand) : inSand;
      }
      return inside || float(0).greaterThan(float(1));
    })();
    mat.maskNode = mat.maskNode ? mat.maskNode.and(node.not()) : node.not();
    if (!mat.userData) mat.userData = {};
    mat.userData.waterfrontBeachMask = true;
  } catch (err) {
    console.warn('[waterfrontBeachGround] ground mask not applied:', err && err.message);
  }
  return mat;
}

// A warm, slightly varied sand material (fine white sand per the HTO sources; Sugar Beach's is a paler beige). One
// shared material per beach, procedural so no texture dependency is added; it is a node material, so it can also carry
// a mask if ever needed.
function sandMaterial(THREE, tint) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  const base = new Mat({ color: tint, roughness: 1.0, metalness: 0.0 });
  const T = C?.TSL;
  if (!T || !base.isNodeMaterial) return base;
  const { Fn, positionWorld, color, float, mix, sin, fract, floor } = T;
  try {
    const c0 = color(tint), c1 = color(0xd9cbb0), c2 = color(0xcbb894);
    base.colorNode = Fn(() => {
      const wp = positionWorld.xz;
      // gentle large-scale tone drift plus a fine grain, never a procedural "bleed" towards white
      const drift = sin(wp.x.mul(0.11)).mul(0.5).add(0.5).mul(sin(wp.y.mul(0.09)).mul(0.5).add(0.5));
      const grain = fract(sin(wp.x.mul(12.9898).add(wp.y.mul(78.233))).mul(43758.5453));
      const grainAmt = grain.mul(0.6).add(0.2);
      const sanded = mix(c1, c2, drift);
      const toned = mix(c0, sanded, float(0.55)).mul(grainAmt.mul(0.22).add(0.9));
      return toned;
    })();
  } catch (err) {
    console.warn('[waterfrontBeachGround] sand colour node skipped:', err && err.message);
  }
  return base;
}

// Flat upward-facing geometry of a simple ring at height y (triangulated). The sand rings are simple polygons. Triangles
// wholly inside a mapped path corridor are dropped, so the boardwalk (drawn above by city-grid.js) is not buried under
// sand geometry; edge triangles are kept (the path quad covers the seam), so the beach is never eaten away.
function pointInCorridor(seg, x, z, pad = 0.05) {
  const dx = seg.bx - seg.ax, dz = seg.bz - seg.az, L2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - seg.ax) * dx + (z - seg.az) * dz) / L2));
  const px = seg.ax + dx * t, pz = seg.az + dz * t;
  return Math.hypot(x - px, z - pz) <= seg.half + pad;
}
function ringGeometry(THREE, ring, y, pathSegs = []) {
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = [], uv = [];
  for (const [i, j, k] of faces) {
    const a = ring[i], b = ring[j], c = ring[k];
    // drop only triangles whose every vertex is inside a path corridor (wholly under the boardwalk)
    if (pathSegs.length) {
      const under = pathSegs.some((s) => pointInCorridor(s, a[0], a[1]) && pointInCorridor(s, b[0], b[1]) && pointInCorridor(s, c[0], c[1]));
      if (under) continue;
    }
    // The +Y component of (b-a)x(c-a) is (b.z-a.z)(c.x-a.x) - (b.x-a.x)(c.z-a.z). Wind the triangle so that is
    // positive (counter-clockwise seen from above): a downward-wound top is back-face culled and the sand disappears.
    const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    const order = up >= 0 ? [a, b, c] : [a, c, b];
    pos.push(order[0][0], y, order[0][1], order[1][0], y, order[1][1], order[2][0], y, order[2][1]);
    for (const p of order) uv.push(p[0], -p[1]);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  const norr = new Float32Array((pos.length / 3) * 3);
  for (let i = 0; i < norr.length; i += 3) norr[i + 1] = 1;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(norr, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function createWaterfrontBeachGround(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-beach-ground: THREE is required');
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const layout = waterfrontBeachGroundLayout();
  if (!layout.sites.length) {
    if (C) C.waterfrontBeachGroundEnabled = false;
    console.info('[waterfrontBeachGround] none in this map: ' + (layout.skipped.map((s) => `${s.id} (${s.reason})`).join('; ') || 'no sand rings'));
    return null;
  }
  const group = new THREE.Group();
  group.name = 'WaterfrontBeachGround';
  const stats = { sites: {}, meshes: 0, triangles: 0, triangles_total: 0, skipped: layout.skipped };

  // One shared sand material (both beaches are the same fine sand; a small tint difference keeps them distinguishable).
  const sugarMat = sandMaterial(THREE, 0xe4dccb);
  const htoMat = sandMaterial(THREE, 0xefe9dc);

  for (const site of layout.sites) {
    const geo = ringGeometry(THREE, site.sandRing, site.sandMeshY, site.paths);
    if (!geo) { stats.sites[site.id] = { built: false }; continue; }
    const mat = site.id === 'htoPark' ? htoMat : sugarMat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `WaterfrontBeachGround_${site.id}_Sand`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.cullDistance = 700;
    mesh.userData.cullCell = 120;
    mesh.userData.role = 'beach-sand';
    if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
    group.add(mesh);
    const tris = geo.attributes.position.count / 3;
    stats.sites[site.id] = {
      built: true, triangles: tris, area: site.area, sandY: site.sandY, sandMeshY: site.sandMeshY,
      osm: site.osm, name: site.name
    };
    stats.meshes++;
    stats.triangles_total += tris;
  }
  stats.triangles = stats.triangles_total;
  stats.ms = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10;
  group.userData.waterfrontBeachGround = stats;
  if (scene && scene.add) scene.add(group);
  const result = { group, colliders: [], stats, layout };
  if (C) { C.waterfrontBeachGround = result; C.waterfrontBeachGroundEnabled = true; }
  console.info(`[waterfrontBeachGround] ${layout.sites.map((s) => `${s.name} ${s.area} m² sand`).join(', ')}: ` +
    `${stats.meshes} sand meshes, ${stats.triangles} triangles, ${stats.ms} ms`);
  return result;
}

Object.assign(C || (window.CITY = {}), {
  WATERFRONT_BEACH_SPECS: BEACH_SPECS,
  waterfrontBeachGroundLayout,
  waterfrontSandHeightAt,
  waterfrontBeachKeepoutAt,
  waterfrontBeachPathAt,
  waterfrontBeachExclusionPolygons,
  applyWaterfrontBeachGroundMask,
  createWaterfrontBeachGround,
  buildWaterfrontBeachGround: createWaterfrontBeachGround
});
})();
