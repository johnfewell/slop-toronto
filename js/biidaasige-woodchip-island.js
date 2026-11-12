(function () {
// js/biidaasige-woodchip-island.js
// Biidaasige Park — SOURCE-TRACED WOODCHIP ISLAND (bead st-bmyv.4.1). Owns only this file, its test, its docs and the
// optional builder tools/build-biidaasige-woodchip-island.mjs. The Captain owns the fixture
// tools/fixtures/biidaasige-woodchip-island.json (READONLY here) and all integration.
//
// WHAT IS BUILT — the actual visible pale-curbed woodchip island around the six inverted White Oak trunks, currently
// rendered as grass. The boundary is the Captain's aerial trace (58 vertices, traceErrorM 0.6, placementUncertaintyM 3)
// projected through the city's own C.worldFromLatLon at call time. The concave polygon is earcut by
// THREE.ShapeUtils.triangulateShape (no handmade ellipse/rectangle, no fan fill). The woodchip top is y = .232 m
// (source ground .224 + an explicit 8 mm finish choice). A pale concrete curb strip follows the same concave ring:
// 0.12 m wide, 0.06 m rise, built as bounded per-segment quads (top + outer wall + inner wall), never one box wall.
//
// WHAT THIS MODULE IS NOT — it places no animal, trunk, tree, sign or furniture. The six inverted White Oak trunks are
// another worker's model (C.buildBiidaasigeInvertedTrees); this module only supplies the ground they stand on. It reads
// no network, image or texture, edits no other module, and adds no terrain system.
//
// CONTRACT
//   - C.buildBiidaasigeWoodchipIsland(scene?, opts?) -> { group, colliders, surfaces, ringWorld, footprint, source,
//     finish, stats, skipped } | null (null only when C.THREE is absent).
//   - `surfaces` is [{ triangle: [9 world numbers, y-up, upward-wound], kind }] copied from the ACTUAL rendered mesh
//     triangles ('woodchip' top and 'curb' top), so an independent THREE downward raycast hits the same top.
//   - `ringWorld` / `footprint` is the projected traced ring [[x,z],...] plus the source uncertainty metadata.
//   - `colliders` is [] by default: a 6 cm curb is a step, not a wall. opts.curbColliders === true emits finite,
//     bounded per-segment AABBs for the curb only.
//   - C.biidaasigeWoodchipIslandAt(x, z) -> { onIsland, kind, surfaceY } | null. It reads a 4 m cell index built from
//     THIS build's published triangles, so it never scans the full triangle set per frame and never answers from a
//     stale build. An invalid rebuild clears the record and the query.
//   - ONE bounded root group (cullDistance/cullCell) with TWO meshes: woodchip + curb. No per-chip scatter, no draw
//     call per triangle.
//   - WGS84 -> world ONLY through C.worldFromLatLon at call time, so both packed GEO frames work. A missing source,
//     missing projection, degenerate ring or failed triangulation builds nothing and reports why.
//
// Attribution: City of Toronto 2025 ortho (aerial trace by the Captain, 2026-11-11); City of Toronto / Waterfront
// Toronto. Documentation-only: docs/biidaasige-woodchip-island.md.
const C = (typeof window !== 'undefined' && (window.CITY || (window.CITY = {}))) || null;

// >>> WOODCHIP_ISLAND_DATA
const DATA = {"schema":"biidaasige-woodchip-island/1","bead":"st-bmyv.4.1","featureId":"inverted-oak-woodchip-island","sourceUrl":"https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2025_color_8cm/MapServer","sourceDate":"2025 aerial acquisition Apr9–July12","captainViewed":"2026-11-11","sourceExport":{"href":"https://gis.toronto.ca/arcgis/rest/directories/arcgisoutput/basemap/cot_ortho_2025_color_8cm_MapServer/_ags_map4adf528efd71412db62b56856ff6e6e9.png","width":2500,"height":1726,"extent":{"xmin":-8833462.09959753,"ymin":5410671.299744126,"xmax":-8833144.136046192,"ymax":5410890.821779971,"spatialReference":{"wkid":102100,"latestWkid":3857}},"scale":480.6998406223511},"imageSize":[2500,1726],"tracePixels":[[1282.5,1032.5],[1277.0833333333335,1047.0833333333333],[1269.1666666666667,1061.6666666666667],[1253.75,1071.25],[1239.5833333333335,1075.4166666666667],[1225,1077.9166666666667],[1208.75,1077.0833333333333],[1197.5,1080],[1192.0833333333333,1088.75],[1187.9166666666667,1103.75],[1180.4166666666667,1112.9166666666667],[1166.25,1119.1666666666667],[1152.9166666666667,1125.8333333333333],[1146.6666666666667,1135],[1140.8333333333333,1147.9166666666667],[1142.5,1158.75],[1149.5833333333333,1170],[1155.8333333333333,1183.3333333333333],[1154.1666666666667,1198.3333333333333],[1146.6666666666667,1211.25],[1136.6666666666667,1222.0833333333333],[1126.25,1237.9166666666667],[1119.5833333333333,1255],[1114.1666666666667,1271.6666666666667],[1117.9166666666667,1289.1666666666667],[1128.75,1306.6666666666667],[1142.9166666666667,1312.9166666666667],[1156.6666666666667,1309.1666666666667],[1167.9166666666667,1299.1666666666667],[1178.3333333333333,1284.5833333333335],[1185.4166666666667,1273.75],[1194.1666666666667,1267.9166666666667],[1209.1666666666667,1266.25],[1223.3333333333333,1262.9166666666667],[1237.0833333333335,1259.5833333333335],[1246.25,1260.4166666666667],[1254.1666666666667,1265.4166666666667],[1264.5833333333335,1274.1666666666667],[1277.5,1280.8333333333335],[1292.5,1286.6666666666667],[1305.8333333333335,1285.8333333333335],[1314.1666666666667,1274.5833333333335],[1318.75,1262.5],[1315.4166666666667,1249.5833333333335],[1310.4166666666667,1237.9166666666667],[1297.9166666666667,1229.1666666666667],[1289.5833333333335,1216.6666666666667],[1285.8333333333335,1200.8333333333333],[1286.25,1184.5833333333333],[1288.75,1169.1666666666667],[1289.1666666666667,1153.75],[1287.0833333333335,1137.5],[1287.5,1122.5],[1295,1108.3333333333333],[1303.75,1092.5],[1310,1075],[1310.4166666666667,1059.5833333333333],[1305.4166666666667,1047.5]],"ringLatLon":[[43.64559177059064,-79.35087486790268],[43.64557971370177,-79.35088105658555],[43.64556765681048,-79.35089010158363],[43.645559733709185,-79.35090771552723],[43.64555628888219,-79.35092390131324],[43.64555422198593,-79.3509405631518],[43.645554910951354,-79.35095912920046],[43.6455524995723,-79.35097198261877],[43.64554526543454,-79.35097817130166],[43.64553286405348,-79.35098293182696],[43.64552528543048,-79.3509915007725],[43.645520118187,-79.35100768655852],[43.64551460646008,-79.35102292023947],[43.64550702783477,-79.35103006102742],[43.64549634886111,-79.35103672576285],[43.64548739230109,-79.35103482155273],[43.64547809125659,-79.35102672865972],[43.64546706779459,-79.35101958787176],[43.6454546663974,-79.35102149208188],[43.645443987414424,-79.35103006102742],[43.64543503084662,-79.35104148628812],[43.64542194047586,-79.3510533876014],[43.6454078166516,-79.35106100444187],[43.64539403730764,-79.35106719312476],[43.64537956899307,-79.351062908652],[43.645365100675036,-79.3510505312862],[43.64535993341774,-79.35103434550018],[43.64536303377216,-79.3510186357667],[43.6453713013832,-79.3510057823484],[43.64538335831388,-79.35099388103514],[43.6453923148894,-79.35098578814215],[43.64539713766028,-79.350975791039],[43.64539851559476,-79.35095865314794],[43.64540127146359,-79.35094246736192],[43.64540402733231,-79.35092675762843],[43.64540333836514,-79.35091628447277],[43.64539920456199,-79.3509072394747],[43.64539197040576,-79.35089533816145],[43.64538645866711,-79.35088058053302],[43.64538163589536,-79.35086344264195],[43.645382324862766,-79.35084820896098],[43.64539162592212,-79.35083868791038],[43.6454016159472,-79.35083345133256],[43.64541229493768,-79.35083725975278],[43.64542194047586,-79.35084297238315],[43.645429174628454,-79.35085725395905],[43.64543950913069,-79.35086677500965],[43.6454525994976,-79.35087105948243],[43.64546603434492,-79.35087058342988],[43.6454787802229,-79.35086772711472],[43.64549152609818,-79.35086725106218],[43.645504960936776,-79.35086963132484],[43.64551736232359,-79.3508691552723],[43.64552907474211,-79.35086058632677],[43.6455421650895,-79.35085058922365],[43.64555663336489,-79.3508434484357],[43.64556937922369,-79.35084297238315],[43.6455793692192,-79.35084868501353]],"traceErrorM":0.6,"placementUncertaintyM":3,"interpretation":"Visible pale-curbed woodchip island containing six inverted oak trunks; material confirmed by City2026 installed Dodem photograph. Boundary traced from aerial. This does not identify individual animal points. Northeast construction edge less certain; whole trace carries3m positional uncertainty.","finishChoices":{"groundY":0.224,"woodchipY":0.232,"curbWidthM":0.12,"curbRiseM":0.06,"dimensionsStatus":"explicit rendering estimates, not surveyed elevations/curb dimensions"}};
// <<< WOODCHIP_ISLAND_DATA

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Recorded datum and explicit finish choices (1 unit = 1 m). The fixture is the source of truth; these are read from
// it so the builder and the runtime cannot drift.
const GROUND_Y = DATA.finishChoices ? DATA.finishChoices.groundY : 0.224;
const FINISH_Y = DATA.finishChoices ? DATA.finishChoices.woodchipY : 0.232;
const CURB_W = DATA.finishChoices ? DATA.finishChoices.curbWidthM : 0.12;
const CURB_RISE = DATA.finishChoices ? DATA.finishChoices.curbRiseM : 0.06;
const CURB_TOP_Y = Math.round((GROUND_Y + CURB_RISE) * 1e6) / 1e6;
const CELL_M = 4;
const MAX_REFINE_EDGE = 2.0;
const MAX_TRIS = 2000;

// ---------------------------------------------------------------------------------------------------------------
// Projection and source geometry (C.worldFromLatLon at call time; null when absent).
function projectionAvailable() {
  return !!(C && typeof C.worldFromLatLon === 'function');
}
function project(lat, lon) {
  if (!projectionAvailable() || !isNum(lat) || !isNum(lon)) return null;
  const p = C.worldFromLatLon(lat, lon);
  return p && isNum(p.x) && isNum(p.z) ? { x: p.x, z: p.z } : null;
}
function tracedRingWorld() {
  if (!Array.isArray(DATA.ringLatLon) || DATA.ringLatLon.length < 3) return null;
  if (!projectionAvailable()) return null;
  const out = [];
  for (const pt of DATA.ringLatLon) {
    const p = project(pt[0], pt[1]);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Pure polygon helpers (world x/z).
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, zi = ring[i].z, xj = ring[j].x, zj = ring[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j].x * ring[i].z - ring[i].x * ring[j].z;
  return a / 2;
}
function ringArea(ring) {
  return Math.abs(signedArea(ring));
}
function dedupeRing(ring) {
  const out = [];
  for (const p of ring) {
    if (!isNum(p.x) || !isNum(p.z)) return null;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.z - p.z) < 1e-9) continue;
    out.push({ x: p.x, z: p.z });
  }
  if (out.length >= 2) {
    const f = out[0], l = out[out.length - 1];
    if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.z - l.z) < 1e-9) out.pop();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Concave-safe triangulation. THREE.ShapeUtils.triangulateShape returns index triples into the ring; we keep the
// actual ring vertices (no simplification) and then optionally refine long triangles for a finer CPU colour grain.
function triangulateFaces(THREE, ring) {
  if (!ring || ring.length < 3) return null;
  const contour = ring.map((p) => new THREE.Vector2(p.x, p.z));
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { return null; }
  if (!Array.isArray(faces) || !faces.length) return null;
  const out = [];
  for (const [i, j, k] of faces) {
    const a = ring[i], b = ring[j], c = ring[k];
    if (!a || !b || !c) continue;
    out.push({ a, b, c });
  }
  return out.length ? out : null;
}
function edgeLen(a, b) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}
function refineTriangles(tris, maxEdge, maxTris) {
  const out = [];
  const queue = tris.slice();
  let head = 0;
  while (head < queue.length) {
    const t = queue[head++];
    if (out.length + (queue.length - head) >= maxTris) { out.push(t); continue; }
    const edges = [[t.a, t.b], [t.b, t.c], [t.c, t.a]];
    let longest = -1, li = -1;
    for (let i = 0; i < 3; i++) {
      const d = edgeLen(edges[i][0], edges[i][1]);
      if (d > longest) { longest = d; li = i; }
    }
    if (longest <= maxEdge) { out.push(t); continue; }
    const [p, q] = edges[li];
    const m = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
    const opp = [t.a, t.b, t.c].find((v) => v !== p && v !== q);
    if (!opp) { out.push(t); continue; }
    queue.push({ a: p, b: m, c: opp });
    queue.push({ a: m, b: q, c: opp });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry builders. Every triangle is wound so its +Y normal faces up (the front face a downward ray sees).
function orderedTri(a, b, c, nx, ny, nz) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  const dot = cx * nx + cy * ny + cz * nz;
  if (Math.abs(dot) < 1e-12) return null;
  return dot > 0 ? [a, b, c] : [a, c, b];
}
function surfaceGeometry(THREE, tris, y, colorFn) {
  const pos = [], col = [];
  for (const t of tris) {
    const ny = (t.b.z - t.a.z) * (t.c.x - t.a.x) - (t.b.x - t.a.x) * (t.c.z - t.a.z);
    if (Math.abs(ny) < 1e-12) continue;
    const order = ny > 0 ? [t.a, t.b, t.c] : [t.a, t.c, t.b];
    for (const p of order) {
      pos.push(p.x, y, p.z);
      if (colorFn) { const c = colorFn(p.x, p.z); col.push(c.r, c.g, c.b); }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// A pale concrete curb strip that follows the concave ring. The strip is centred on the traced edge (half inside,
// half outside), so the visible island matches the trace within its 0.6 m error. Each edge is a bounded quad set:
// top face + outer wall + inner wall. Miter offsets are clamped finite; degenerate quads are skipped.
function curbGeometry(THREE, ring, halfW, topY, outerBaseY, innerBaseY) {
  const n = ring.length;
  if (n < 3) return null;
  const ccw = signedArea(ring) > 0;
  const edgeNormals = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    let dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    edgeNormals.push({ x: ccw ? dz : -dz, z: ccw ? -dx : dx });
  }
  const outer = [], inner = [];
  for (let i = 0; i < n; i++) {
    const prev = edgeNormals[(i - 1 + n) % n], next = edgeNormals[i];
    let mx = prev.x + next.x, mz = prev.z + next.z;
    let ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { mx = next.x; mz = next.z; ml = 1; }
    mx /= ml; mz /= ml;
    const dot = mx * next.x + mz * next.z;
    let scale = dot > 1e-6 ? 1 / dot : 1;
    if (!Number.isFinite(scale) || scale > 2.5) scale = 2.5;
    if (scale < 1) scale = 1;
    const off = halfW * scale;
    outer.push({ x: ring[i].x + mx * off, z: ring[i].z + mz * off });
    inner.push({ x: ring[i].x - mx * off, z: ring[i].z - mz * off });
  }
  const pos = [], topTriangles = [];
  const push = (tri) => { for (const p of tri) pos.push(p.x, p.y, p.z); };
  const addTop = (a, b, c) => {
    const tri = orderedTri(a, b, c, 0, 1, 0);
    if (!tri) return;
    push(tri);
    topTriangles.push([tri[0].x, tri[0].y, tri[0].z, tri[1].x, tri[1].y, tri[1].z, tri[2].x, tri[2].y, tri[2].z]);
  };
  const addWall = (a, b, c, nx, ny, nz) => {
    const tri = orderedTri(a, b, c, nx, ny, nz);
    if (tri) push(tri);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const oi = { x: outer[i].x, y: topY, z: outer[i].z };
    const oj = { x: outer[j].x, y: topY, z: outer[j].z };
    const ii = { x: inner[i].x, y: topY, z: inner[i].z };
    const ij = { x: inner[j].x, y: topY, z: inner[j].z };
    addTop(ii, oi, oj);
    addTop(ii, oj, ij);
    const en = edgeNormals[i];
    const obi = { x: outer[i].x, y: outerBaseY, z: outer[i].z };
    const obj = { x: outer[j].x, y: outerBaseY, z: outer[j].z };
    addWall(obi, obj, oj, en.x, 0, en.z);
    addWall(obi, oj, oi, en.x, 0, en.z);
    const ibi = { x: inner[i].x, y: innerBaseY, z: inner[i].z };
    const ibj = { x: inner[j].x, y: innerBaseY, z: inner[j].z };
    addWall(ibi, ibj, ij, -en.x, 0, -en.z);
    addWall(ibi, ij, ii, -en.x, 0, -en.z);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return { geo: g, topTriangles };
}

// Copy the ACTUAL rendered triangles into the repo `surfaces` format, rewound upward. Pure.
function collectTriangles(p, kind, out) {
  for (let t = 0; t + 2 < p.count; t += 3) {
    const ax = p.getX(t), ay = p.getY(t), az = p.getZ(t);
    const bx = p.getX(t + 1), by = p.getY(t + 1), bz = p.getZ(t + 1);
    const cx = p.getX(t + 2), cy = p.getY(t + 2), cz = p.getZ(t + 2);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (Math.abs(ny) < 1e-12) continue;
    if (ny > 0) out.push({ triangle: [ax, ay, az, bx, by, bz, cx, cy, cz], kind });
    else out.push({ triangle: [ax, ay, az, cx, cy, cz, bx, by, bz], kind });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Materials. Warm brown woodchip with fine irregular grain: reuse the resident TSL noise when available, otherwise a
// deterministic per-vertex CPU colour fallback. No image, no copied texture, no large repeated flat blobs.
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function woodColor(x, z) {
  const n = hash2(x * 3.1, z * 3.1) * 0.55 + hash2(x * 11.7, z * 11.7) * 0.30 + hash2(x * 29.3, z * 29.3) * 0.15;
  const r = 0x4a / 255 + (0x8a / 255 - 0x4a / 255) * n;
  const g = 0x32 / 255 + (0x6a / 255 - 0x32 / 255) * n;
  const b = 0x20 / 255 + (0x45 / 255 - 0x20 / 255) * n;
  return { r, g, b };
}
function woodchipMaterial(THREE) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  const mat = new Mat({ color: 0x6b4a2f, roughness: 0.97, metalness: 0.0 });
  if (C && C.TSL && C.waterEdgeNoise && mat.isNodeMaterial) {
    const T = C.TSL, p = T.positionWorld.xz;
    const fine = C.waterEdgeNoise(p.mul(42.0));
    const mid = C.waterEdgeNoise(p.mul(9.0).add(13.7));
    const patch = C.waterEdgeNoise(p.mul(0.8).add(3.1));
    const base = T.mix(T.color(0x4a3220), T.color(0x7a5636), T.smoothstep(0.15, 0.85, fine));
    const warm = T.mix(base, T.color(0x8a6a45), T.smoothstep(0.55, 0.9, mid).mul(0.35));
    mat.colorNode = warm.mul(patch.mul(0.12).add(0.94));
  } else {
    mat.vertexColors = true;
  }
  return mat;
}
function curbMaterial(THREE) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  const mat = new Mat({ color: 0xb8b3a6, roughness: 0.9, metalness: 0.0 });
  if (C && C.TSL && C.waterEdgeNoise && mat.isNodeMaterial) {
    const T = C.TSL, p = T.positionWorld.xz;
    const grain = C.waterEdgeNoise(p.mul(24.0));
    mat.colorNode = T.mix(T.color(0xa8a396), T.color(0xc9c4b7), T.smoothstep(0.2, 0.8, grain));
  }
  return mat;
}

// ---------------------------------------------------------------------------------------------------------------
// 4 m cell index over the published triangles. The query never scans the full triangle set per frame.
function buildIndex(surfaces, cellM) {
  const cells = new Map();
  for (const s of surfaces) {
    const T = s.triangle;
    if (!Array.isArray(T) || T.length !== 9) continue;
    const minX = Math.floor(Math.min(T[0], T[3], T[6]) / cellM);
    const maxX = Math.floor(Math.max(T[0], T[3], T[6]) / cellM);
    const minZ = Math.floor(Math.min(T[2], T[5], T[8]) / cellM);
    const maxZ = Math.floor(Math.max(T[2], T[5], T[8]) / cellM);
    for (let ix = minX; ix <= maxX; ix++) for (let iz = minZ; iz <= maxZ; iz++) {
      const k = ix + ',' + iz;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(s);
    }
  }
  return cells;
}
function queryAt(cells, cellM, x, z) {
  if (!isNum(x) || !isNum(z)) return null;
  const list = cells.get(Math.floor(x / cellM) + ',' + Math.floor(z / cellM));
  if (!list) return null;
  let best = null;
  for (const s of list) {
    const T = s.triangle;
    const x0 = T[0], y0 = T[1], z0 = T[2], x1 = T[3], y1 = T[4], z1 = T[5], x2 = T[6], y2 = T[7], z2 = T[8];
    const den = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(den) < 1e-12) continue;
    const a = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / den;
    const b = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / den;
    const c = 1 - a - b;
    if (a < -1e-7 || b < -1e-7 || c < -1e-7) continue;
    const h = a * y0 + b * y1 + c * y2;
    if (!best || h > best.surfaceY) best = { onIsland: true, kind: s.kind, surfaceY: h };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Bounded per-segment curb colliders (opt-in only; a 6 cm curb is a step, not a wall).
function curbColliders(ring, halfW, topY) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    out.push({
      minX: Math.min(a.x, b.x) - halfW, maxX: Math.max(a.x, b.x) + halfW,
      minZ: Math.min(a.z, b.z) - halfW, maxZ: Math.max(a.z, b.z) + halfW,
      minY: GROUND_Y, maxY: topY, kind: 'curb', prop: false
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// LAYOUT ADAPTER — C.buildBiidaasigeWoodchipIsland(scene?, opts?).
function buildBiidaasigeWoodchipIsland(scene = null, opts = {}) {
  const THREE = (C && C.THREE) || null;
  if (!THREE) return null;

  // Idempotent: drop the previous root from its scene before building a new one.
  const prev = C && C.biidaasigeWoodchipIsland;
  if (prev && prev.group && prev.group.parent && typeof prev.group.parent.remove === 'function') {
    prev.group.parent.remove(prev.group);
  }

  const group = new THREE.Group();
  group.name = 'BiidaasigeWoodchipIsland';
  group.userData.cullDistance = isNum(opts.cullDistance) ? opts.cullDistance : 500;
  group.userData.cullCell = isNum(opts.cullCell) ? opts.cullCell : 60;

  const surfaces = [];
  const skipped = [];
  const stats = {
    meshes: 0, triangles: 0, woodchipTriangles: 0, curbTriangles: 0,
    groundY: GROUND_Y, finishY: FINISH_Y, curbTopY: CURB_TOP_Y,
    curbWidthM: CURB_W, curbRiseM: CURB_RISE,
    colliders: 0, cellM: CELL_M, estimates: true,
    source: 'Captain aerial trace (2025 City ortho), projected at call time'
  };
  const finish = { groundY: GROUND_Y, woodchipY: FINISH_Y, curbWidthM: CURB_W, curbRiseM: CURB_RISE };
  const source = {
    schema: DATA.schema, bead: DATA.bead, featureId: DATA.featureId,
    sourceUrl: DATA.sourceUrl, sourceDate: DATA.sourceDate, sourceExport: DATA.sourceExport,
    traceErrorM: DATA.traceErrorM, placementUncertaintyM: DATA.placementUncertaintyM,
    interpretation: DATA.interpretation, finishChoices: DATA.finishChoices,
    ringLatLon: DATA.ringLatLon
  };

  const publish = (ringWorld) => {
    const record = {
      group, colliders: [], surfaces, ringWorld: ringWorld || [], footprint: ringWorld || [],
      source, finish, stats, skipped, cells: buildIndex(surfaces, CELL_M), cellM: CELL_M
    };
    group.userData.biidaasigeWoodchipIsland = stats;
    if (scene && scene.add) scene.add(group);
    if (C) {
      C.biidaasigeWoodchipIsland = record;
      C.biidaasigeWoodchipIslandAt = (x, z) => queryAt(record.cells, CELL_M, x, z);
    }
    return { group, colliders: record.colliders, surfaces, ringWorld: record.ringWorld, footprint: record.footprint, source, finish, stats, skipped };
  };

  if (!projectionAvailable()) {
    stats.reason = 'projection unavailable (C.worldFromLatLon missing)';
    return publish([]);
  }
  const raw = tracedRingWorld();
  if (!raw) {
    stats.reason = 'source trace missing or outside the active projection';
    return publish([]);
  }
  const ring = dedupeRing(raw);
  if (!ring || ring.length < 3) {
    stats.reason = 'degenerate source ring';
    return publish([]);
  }
  const areaM2 = ringArea(ring);
  if (!(areaM2 > 1)) {
    stats.reason = 'source ring has no area';
    return publish([]);
  }

  const faces = triangulateFaces(THREE, ring);
  if (!faces) {
    stats.reason = 'triangulation produced no faces';
    return publish(ring);
  }
  const refined = refineTriangles(faces, isNum(opts.maxEdge) ? opts.maxEdge : MAX_REFINE_EDGE,
    isNum(opts.maxTris) ? opts.maxTris : MAX_TRIS);

  const woodGeo = surfaceGeometry(THREE, refined, FINISH_Y, woodColor);
  if (!woodGeo) {
    stats.reason = 'woodchip surface produced no triangles';
    return publish(ring);
  }
  const woodMesh = new THREE.Mesh(woodGeo, woodchipMaterial(THREE));
  woodMesh.name = 'BiidaasigeWoodchipIsland_woodchip';
  woodMesh.receiveShadow = true;
  woodMesh.castShadow = false;
  woodMesh.userData.cullDistance = group.userData.cullDistance;
  woodMesh.userData.cullCell = group.userData.cullCell;
  group.add(woodMesh);
  stats.meshes++;
  const woodTris = Math.floor(woodGeo.attributes.position.count / 3);
  stats.woodchipTriangles = woodTris;
  stats.triangles += woodTris;
  collectTriangles(woodGeo.attributes.position, 'woodchip', surfaces);

  const curb = curbGeometry(THREE, ring, CURB_W / 2, CURB_TOP_Y, GROUND_Y, FINISH_Y);
  if (curb) {
    const curbMesh = new THREE.Mesh(curb.geo, curbMaterial(THREE));
    curbMesh.name = 'BiidaasigeWoodchipIsland_curb';
    curbMesh.receiveShadow = true;
    curbMesh.castShadow = false;
    curbMesh.userData.cullDistance = group.userData.cullDistance;
    curbMesh.userData.cullCell = group.userData.cullCell;
    group.add(curbMesh);
    stats.meshes++;
    const curbTris = Math.floor(curb.geo.attributes.position.count / 3);
    stats.curbTriangles = curbTris;
    stats.triangles += curbTris;
    for (const t of curb.topTriangles) surfaces.push({ triangle: t, kind: 'curb' });
  }

  const colliders = opts.curbColliders === true ? curbColliders(ring, CURB_W / 2, CURB_TOP_Y) : [];
  stats.colliders = colliders.length;
  stats.areaM2 = Math.round(areaM2 * 10) / 10;
  stats.vertices = ring.length;
  stats.surfaceEntries = surfaces.length;

  const record = {
    group, colliders, surfaces, ringWorld: ring, footprint: ring,
    source, finish, stats, skipped, cells: buildIndex(surfaces, CELL_M), cellM: CELL_M
  };
  group.userData.biidaasigeWoodchipIsland = stats;
  if (scene && scene.add) scene.add(group);
  if (C) {
    C.biidaasigeWoodchipIsland = record;
    C.biidaasigeWoodchipIslandAt = (x, z) => queryAt(record.cells, CELL_M, x, z);
  }
  if (typeof console !== 'undefined' && console.info) {
    console.info(`[biidaasigeWoodchipIsland] ${stats.vertices}-vertex traced ring, ${stats.areaM2} m2, ` +
      `${stats.meshes} meshes (${stats.woodchipTriangles} woodchip + ${stats.curbTriangles} curb tris), ` +
      `woodchip y=${FINISH_Y}, curb top y=${CURB_TOP_Y}`);
  }
  return { group, colliders, surfaces, ringWorld: ring, footprint: ring, source, finish, stats, skipped };
}

// ---------------------------------------------------------------------------------------------------------------
// Exports (the repo module convention: Object.assign(window.CITY, {...})).
if (C) {
  Object.assign(C, {
    BIIDAASIGE_WOODCHIP_ISLAND_DATA: DATA,
    BIIDAASIGE_WOODCHIP_ISLAND_FINISH: Object.freeze({ groundY: GROUND_Y, woodchipY: FINISH_Y, curbWidthM: CURB_W, curbRiseM: CURB_RISE, curbTopY: CURB_TOP_Y }),
    buildBiidaasigeWoodchipIsland,
    biidaasigeWoodchipIslandHelpers: {
      pointInRing, signedArea, ringArea, dedupeRing, triangulateFaces, refineTriangles,
      surfaceGeometry, curbGeometry, collectTriangles, buildIndex, queryAt, curbColliders,
      // Shared material factories so a sibling island shares the actual woodchip/curb surface rather than a copy.
      woodchipMaterial, curbMaterial
    }
  });
}
})();
