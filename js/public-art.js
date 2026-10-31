(function () {
// js/public-art.js
// The City's Public Art inventory in the street (CITY.PUBLIC_ART, tools/build-art-heritage.mjs; see
// docs/public-art-heritage.md):
// - two reviewed public-domain monuments as simplified procedural massing: the Old City Hall Cenotaph (Ferguson &
//   Pomphrey, 1925) and the Fort Rouillé obelisk at Exhibition Place (Langley & Burke, 1887). Plain stepped stone
//   forms; no inscriptions, carving or figurative detail are reproduced.
// - everywhere else the City's point is outdoors: a small neutral marker post with a reading plate, standing in for
//   the work, never an imitation of it (most are in copyright). Its card (search) says who made the work and where.
// One instanced mesh for every marker and one mesh per monument, vertex coloured, no textures; scene-culling.js chunks
// and culls them. Markers are solid but slim; a point on the roadway, in the water or crowded by something solid
// tries a few spots up to 2 m away, else stays search-only (CITY.publicArtStats counts why).

const { THREE, CITY_BOUNDS, blockAt, nearestRoads } = window.CITY;

// a box from y0 to y1, its top optionally narrowed by `taper` (a slightly tapered shaft), in one colour
function block(w, y0, y1, d, colour, { taper = 1, x = 0, z = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, y1 - y0, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setXYZ(i, p.getX(i) * (top ? taper : 1) + x, p.getY(i) + (y0 + y1) / 2, p.getZ(i) * (top ? taper : 1) + z);
  }
  if (taper !== 1) g.computeVertexNormals();
  return paint(g, colour);
}
function paint(g, colour) {
  const c = new THREE.Color(colour), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[3 * i] = c.r; a[3 * i + 1] = c.g; a[3 * i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (!g.index) g.setIndex([...Array(n).keys()]);
  return g;
}
function merge(parts) {
  const geo = window.CITY.Addons.mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g; }));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// Old City Hall Cenotaph: three steps, plinth, a slightly tapered shaft, cornice and capping block, a wreath ring on its
// Queen Street (+z) and Old City Hall faces. ~9.5 m: "about the size of the one in London" (Whitehall's is 10.7 m)
const GRANITE = 0x87847e, GRANITE_DARK = 0x726f69; // (grey granite: lighter values blow out white in the midday sun)
function cenotaphGeometry() {
  const parts = [
    block(5.6, 0, 0.3, 4.4, GRANITE_DARK), block(4.8, 0.3, 0.6, 3.6, GRANITE), block(4.0, 0.6, 0.9, 2.8, GRANITE_DARK),
    block(2.8, 0.9, 2.2, 1.95, GRANITE),
    block(2.2, 2.2, 8.4, 1.5, GRANITE, { taper: 0.86 }),
    block(2.25, 8.4, 8.75, 1.6, GRANITE_DARK),
    block(1.75, 8.75, 9.5, 1.2, GRANITE, { taper: 0.8 })
  ];
  for (const s of [1, -1]) {
    const w = new THREE.TorusGeometry(0.5, 0.09, 6, 18);
    w.translate(0, 6.4, s * 0.68);
    parts.push(paint(w, GRANITE_DARK));
  }
  return { geo: merge(parts), hx: 2.8, hz: 2.2, h: 9.5 };
}
// Fort Rouillé: a stepped pedestal and a plain granite obelisk with its pyramidion, ~7.5 m; a dark plaque on the die
function obeliskGeometry() {
  const parts = [
    block(3.4, 0, 0.25, 3.4, GRANITE_DARK), block(2.8, 0.25, 0.5, 2.8, GRANITE),
    block(1.9, 0.5, 2.1, 1.9, GRANITE), block(2.2, 2.1, 2.35, 2.2, GRANITE_DARK), block(1.45, 2.35, 2.75, 1.45, GRANITE),
    block(1.1, 2.75, 7.0, 1.1, GRANITE, { taper: 0.6 }),
    block(0.9, 0.95, 1.55, 0.04, 0x3d3226, { z: 0.97 })
  ];
  // (a four-sided cone turned 45 degrees: a square base, half as wide as its radius times root 2: the shaft's top)
  const tip = new THREE.ConeGeometry(0.33 * Math.SQRT2, 0.55, 4);
  tip.rotateY(Math.PI / 4);
  tip.translate(0, 7.0 + 0.275, 0);
  parts.push(paint(tip, GRANITE));
  return { geo: merge(parts), hx: 1.7, hz: 1.7, h: 7.55 };
}
// The stand-in marker: a dark post on a small foot plate, a thin warm band, and a bronze reading plate tilted toward
// its front (+z). 1.15 m, 22 boxes' worth of triangles in all
function markerGeometry() {
  const plate = block(0.4, -0.02, 0.02, 0.28, 0x8c6c3c);
  plate.rotateX(-0.55);
  plate.translate(0, 1.1, 0.02);
  return merge([
    block(0.42, 0, 0.05, 0.42, 0x2c2e31), block(0.11, 0.05, 1.05, 0.11, 0x35383c), block(0.13, 0.82, 0.88, 0.13, 0xb4643a),
    block(0.3, 1.0, 1.08, 0.12, 0x35383c, { z: 0.02 }), plate
  ]);
}
const MODELS = { cenotaph: cenotaphGeometry, obelisk: obeliskGeometry };

function hash(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
const groundAt = (x, z) => (blockAt(x, z) ? CITY_BOUNDS.sidewalkHeight : 0) + (window.CITY.cutAt ? window.CITY.cutAt(x, z) : 0);

/** The marker spots: on a curb island (sidewalk, plaza or park), clear of anything solid; one per 1.5 m */
function markerSites(records, colliders, W) {
  const sites = [], rejected = { roadOrWater: 0, obstructed: 0, shared: 0 };
  // only the colliders near some artwork (20 m cells): the city's tens of thousands are checked once, not per try
  const C = 20, cells = new Set();
  for (const r of records) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) cells.add((Math.floor(r.place.x / C) + i) * 100000 + Math.floor(r.place.z / C) + j);
  const nearArt = (c) => {
    const i0 = Math.floor((c.minX - 1) / C), i1 = Math.floor((c.maxX + 1) / C), j0 = Math.floor((c.minZ - 1) / C), j1 = Math.floor((c.maxZ + 1) / C);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) return true;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (cells.has(i * 100000 + j)) return true;
    return false;
  };
  const solid = colliders.filter((c) => !c.curb && Number.isFinite(c.minX) && nearArt(c));
  const blocked = (x, z) => {
    const shape = W.circleShape(x, z, 0.4), y = groundAt(x, z);
    for (const c of solid) {
      if (x < c.minX - 1 || x > c.maxX + 1 || z < c.minZ - 1 || z > c.maxZ + 1) continue;
      if ((c.maxY ?? Infinity) > y + 0.05 && (c.minY ?? -Infinity) < y + 1.2 && W.contact(shape, c)) return true;
    }
    return sites.some((s) => Math.hypot(s.x - x, s.z - z) < 0.9);
  };
  const OFFSETS = [[0, 0]];
  for (const r of [0.6, 1.2, 2]) for (let k = 0; k < 8; k++) OFFSETS.push([r * Math.cos((k * Math.PI) / 4), r * Math.sin((k * Math.PI) / 4)]);
  for (const r of records) {
    const { x, z } = r.place;
    const near = sites.find((s) => Math.hypot(s.x - x, s.z - z) < 1.5);
    if (near) { near.records.push(r.id); rejected.shared++; continue; }
    let spot = null, onLand = false;
    for (const [dx, dz] of OFFSETS) {
      const px = x + dx, pz = z + dz;
      if (!blockAt(px, pz)) continue;
      onLand = true;
      if (!blocked(px, pz)) { spot = [px, pz]; break; }
    }
    if (!spot) { rejected[onLand ? 'obstructed' : 'roadOrWater']++; continue; }
    const road = nearestRoads(spot[0], spot[1], 40)[0];
    // the plate faces the nearest street (readers on the sidewalk); in a park or a square, a steady hashed heading
    const yaw = road ? Math.atan2(road.px - spot[0], road.pz - spot[1]) : hash(spot[0], spot[1]) * Math.PI * 2;
    sites.push({ x: spot[0], z: spot[1], yaw, records: [r.id], moved: Math.hypot(spot[0] - x, spot[1] - z) });
  }
  return { sites, rejected };
}

function buildPublicArt(scene, colliders = []) {
  const ART = window.CITY.PUBLIC_ART;
  const group = new THREE.Group();
  group.name = 'PublicArt';
  const out = { group, colliders: [], markers: 0, models: 0 };
  const W = window.CITY.WorldCollision;
  if (!ART || !W || new URLSearchParams(location.search).get('publicart') === '0') return out;
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.82 });
  const stats = { sourceCount: ART.records.length, models: [], markers: 0, rejected: {}, sites: [] };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);

  for (const r of ART.records.filter((rec) => rec.show === 'model')) {
    const { geo, hx, hz, h } = MODELS[r.model]();
    const { x, z, yaw } = r.place, y = groundAt(x, z);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `PublicArt_${r.model}`;
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = 700;
    mesh.userData.artId = r.id;
    group.add(mesh);
    out.colliders.push({ ...W.boxCollider(x, z, hx, hz, yaw, y, h, 'artwork'), openData: true });
    stats.models.push({ id: r.id, model: r.model, x, z, yaw });
  }
  out.models = stats.models.length;

  const { sites, rejected } = markerSites(ART.records.filter((rec) => rec.show === 'marker'), colliders, W);
  stats.rejected = rejected;
  stats.sites = sites;
  if (sites.length) {
    const mesh = new THREE.InstancedMesh(markerGeometry(), material, sites.length);
    mesh.name = 'PublicArt_markers';
    sites.forEach((s, i) => {
      p.set(s.x, groundAt(s.x, s.z), s.z);
      q.setFromAxisAngle(up, s.yaw);
      m.compose(p, q, one);
      mesh.setMatrixAt(i, m);
      out.colliders.push({ ...W.circleCollider(s.x, s.z, 0.17, p.y, 1.15, 'artMarker'), openData: true });
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false; // (a thin post's shadow barely reads)
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = 130;
    mesh.userData.cullCell = 60;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  out.markers = stats.markers = sites.length;
  scene.add(group);
  window.CITY.publicArtStats = stats;
  console.info(`[publicArt] ${out.models} modelled works, ${out.markers} markers (${JSON.stringify(rejected)})`);
  return out;
}

/** Where the 3D city shows an artwork: { kind: 'model'|'marker'|'landmark', x, z } or null (search only) */
function publicArtSite(id) {
  const stats = window.CITY.publicArtStats;
  const r = (window.CITY.PUBLIC_ART?.records || []).find((rec) => rec.id === id);
  if (!r) return null;
  if (r.show === 'landmark') return { kind: 'landmark', landmarkId: r.landmarkId };
  const model = stats?.models.find((s) => s.id === id);
  if (model) return { kind: 'model', x: model.x, z: model.z };
  const site = stats?.sites.find((s) => s.records.includes(id));
  return site ? { kind: 'marker', x: site.x, z: site.z, moved: site.moved } : null;
}

Object.assign(window.CITY, { buildPublicArt, publicArtSite, publicArtModelGeometry: (name) => (name === 'marker' ? markerGeometry() : MODELS[name]?.().geo) });
})();
