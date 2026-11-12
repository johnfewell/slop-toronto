(function () {
// js/biidaasige-dodem-three-island.js
// Biidaasige Park — SECOND SOURCE-TRACED WOODCHIP ISLAND (bead st-bmyv.4.2). Owns only this file, its test, its docs
// and the builder tools/build-biidaasige-dodem-three-island.mjs. The Captain owns the fixture
// tools/fixtures/biidaasige-dodem-three-island.json (READONLY here), the cyan-overlay check image and all integration.
//
// WHAT IS BUILT — the adjacent pale-curbed woodchip island that contains the turtle, musky and eagle. The Captain's
// independently source-photograph-matched aerial trace (65 vertices, traceErrorM 0.6, placementUncertaintyM 3) is
// projected through the city's own C.worldFromLatLon at call time and earcut concave-safe. The woodchip top is
// y = .232 m (source ground .224 + the same explicit 8 mm finish choice as the first island); a pale concrete curb
// strip follows the same concave ring: 0.12 m wide, 0.06 m rise, built as bounded per-segment quads.
//
// RELATION TO THE FIRST ISLAND — this module SHARES the first island's helpers and ACTUAL materials
// (C.biidaasigeWoodchipIslandHelpers: triangulateFaces, refineTriangles, surfaceGeometry, curbGeometry,
// collectTriangles, buildIndex, queryAt, woodchipMaterial, curbMaterial) but keeps a DISTINCT record, query and state:
// C.biidaasigeDodemThreeIsland / C.biidaasigeDodemThreeIslandAt. It never reads or mutates the first island's record.
//
// WHAT THIS MODULE IS NOT — it places no animal, trunk, tree, sign or furniture and no absolute pose. The turtle,
// musky and eagle are named by the source photo, not placed here. It reads no network, image or texture, edits no
// other module, and adds no terrain system. The Captain owns integration.
//
// CONTRACT
//   - C.buildBiidaasigeDodemThreeIsland(scene?, opts?) -> { group, colliders, surfaces, ringWorld, footprint, source,
//     finish, stats, skipped } | null (null only when C.THREE is absent).
//   - `surfaces` is [{ triangle: [9 world numbers, y-up, upward-wound], kind }] copied from the ACTUAL rendered mesh
//     triangles ('woodchip' top and 'curb' top), so an independent THREE downward raycast hits the same top.
//   - C.biidaasigeDodemThreeIslandAt(x, z) -> { onIsland, kind, surfaceY } | null. It reads a 4 m cell index built from
//     THIS build's published triangles, so it returns the actual physical surface (never a floating name-only answer),
//     never scans the full triangle set per frame, and never answers from a stale build.
//   - `colliders` is [] by default (a 6 cm curb is a step). opts.curbColliders === true emits finite, bounded
//     per-segment AABBs for the curb only.
//   - ONE bounded root group (cullDistance/cullCell) with TWO meshes: woodchip + curb.
//   - WGS84 -> world ONLY through C.worldFromLatLon at call time, so both packed GEO frames work. A missing source,
//     missing projection, missing shared helpers, degenerate ring or failed triangulation builds nothing and says why.
//
// Attribution: City of Toronto 2025 ortho (aerial trace by the Captain, 2026-11-11); City of Toronto / Waterfront
// Toronto; MVVA finished-site photograph identifies the animals. Documentation-only: docs/biidaasige-dodem-three-island.md.
const C = (typeof window !== 'undefined' && (window.CITY || (window.CITY = {}))) || null;

// >>> DODEM_THREE_ISLAND_DATA
const DATA = {"schema":"biidaasige-woodchip-island/1","bead":"st-bmyv.4.2","featureId":"dodem-three-animal-island","sourceUrl":"https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2025_color_8cm/MapServer","sourceDate":"2025 aerial acquisition Apr9–July12","captainViewed":"2026-11-11","sourceExport":{"href":"https://gis.toronto.ca/arcgis/rest/directories/arcgisoutput/basemap/cot_ortho_2025_color_8cm_MapServer/_ags_map4adf528efd71412db62b56856ff6e6e9.png","width":2500,"height":1726,"extent":{"xmin":-8833462.09959753,"ymin":5410671.299744126,"xmax":-8833144.136046192,"ymax":5410890.821779971,"spatialReference":{"wkid":102100,"latestWkid":3857}},"scale":480.6998406223511},"imageSize":[2500,1726],"tracePixels":[[1435.2,876.8],[1446,878.4],[1459.2,884.4],[1471.6,892.4],[1481.2,903.6],[1488.8,915.6],[1494.4,925.6],[1502,935.2],[1502.8,945.6],[1498.8,954.4],[1490,962.4],[1484,973.2],[1488,985.2],[1498.8,994],[1510,1002.4],[1521.2,1014.8],[1528.4,1028.8],[1530.4,1040.8],[1524.4,1051.2],[1513.2,1054],[1501.2,1048.4],[1491.2,1038.8],[1482.8,1027.6],[1474.4,1019.6],[1464.8,1013.6],[1453.2,1011.6],[1443.2,1014.4],[1432.4,1022],[1422,1030.8],[1413.6,1036],[1405.2,1035.6],[1394.8,1031.2],[1388,1022],[1383.6,1012],[1373.6,1009.2],[1364,1010.4],[1354.4,1008.8],[1344,1007.6],[1334,1009.2],[1323.2,1012.8],[1312.4,1014],[1300.8,1010.8],[1293.6,1004.4],[1288,996],[1285.2,986],[1284.8,977.6],[1287.2,969.2],[1293.6,963.6],[1304,958.4],[1314.8,954.8],[1326.4,950.8],[1333.6,945.2],[1336.8,936],[1339.6,928],[1345.2,921.6],[1353.6,918],[1363.2,918],[1372.8,921.2],[1380.8,925.2],[1387.2,923.6],[1393.6,915.6],[1401.6,908],[1410.8,899.2],[1419.6,889.2],[1427.6,882]],"ringLatLon":[[43.64572049667499,-79.3507004041715],[43.645719173865,-79.35068806488992],[43.64571421332724,-79.35067298354578],[43.64570759927628,-79.35065881622248],[43.6456983396037,-79.35064784797218],[43.64568841852434,-79.35063916477404],[43.645680150956984,-79.35063276662804],[43.64567221409122,-79.3506240834299],[43.645663615818805,-79.35062316940903],[43.64565634035658,-79.35062773951333],[43.64564972629923,-79.35063779374275],[43.64564079732068,-79.35064464889919],[43.64563087623183,-79.35064007879491],[43.64562360076561,-79.35062773951333],[43.645616656001614,-79.35061494322133],[43.645606404205665,-79.35060214692932],[43.64559482959519,-79.3505939207416],[43.645584908498755,-79.35059163568944],[43.64557631021384,-79.3505984908459],[43.64557399529078,-79.3506112871379],[43.64557862513683,-79.35062499745075],[43.645586562014934,-79.35063642271147],[43.64559582170477,-79.35064601993048],[43.64560243576805,-79.35065561714949],[43.645607396315015,-79.35066658539978],[43.64560904983059,-79.35067983870219],[43.645606734908775,-79.35069126396291],[43.645600451549136,-79.3507036032445],[43.64559317607923,-79.35071548551565],[43.645588876937545,-79.35072508273466],[43.645589207640754,-79.35073467995363],[43.64559284537605,-79.3507465622248],[43.645600451549136,-79.35075433140209],[43.64560871912745,-79.35075935851681],[43.645611034049196,-79.35077078377752],[43.64561004193989,-79.3507817520278],[43.645611364752305,-79.3507927202781],[43.64561235686158,-79.35080460254925],[43.645611034049196,-79.35081602780997],[43.64560805772123,-79.35082836709154],[43.645607065611884,-79.35084070637312],[43.64560971123681,-79.35085395967555],[43.64561500248625,-79.35086218586326],[43.64562194725045,-79.35086858400928],[43.645630214825836,-79.35087178308227],[43.64563715958828,-79.3508722400927],[43.64564410434994,-79.35086949803014],[43.645648734190566,-79.35086218586326],[43.64565303332801,-79.35085030359211],[43.64565600965373,-79.35083796431054],[43.64565931668215,-79.3508247110081],[43.64566394652163,-79.3508164848204],[43.64567155268569,-79.35081282873696],[43.645678166740645,-79.35080962966397],[43.645683457984056,-79.35080323151796],[43.645686434308274,-79.35079363429897],[43.645686434308274,-79.35078266604867],[43.64568378868676,-79.35077169779838],[43.64568048165969,-79.3507625575898],[43.64568180447055,-79.35075524542293],[43.64568841852434,-79.35074793325607],[43.64569470187479,-79.3507387930475],[43.64570197733237,-79.35072828180765],[43.64571024489675,-79.35071822757821],[43.645716197542406,-79.35070908736965]],"traceErrorM":0.6,"placementUncertaintyM":3,"interpretation":"Visible pale-curbed woodchip island containing turtle, musky and eagle, independently matched in MVVA finished-site overhead photograph. Island traces actual2025curb; sourcephoto identifies animals, not construction objects. Positionuncertainty3m, notsurvey.","finishChoices":{"groundY":0.224,"woodchipY":0.232,"curbWidthM":0.12,"curbRiseM":0.06,"dimensionsStatus":"explicit rendering estimates, not surveyed elevations/curb dimensions"}};
// <<< DODEM_THREE_ISLAND_DATA

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const CELL_M = 4;
const MAX_REFINE_EDGE = 2.0;
const MAX_TRIS = 2000;

function shared() {
  return (C && C.biidaasigeWoodchipIslandHelpers) || null;
}
function finish() {
  const f = (C && C.BIIDAASIGE_WOODCHIP_ISLAND_FINISH) || null;
  if (f && isNum(f.groundY) && isNum(f.woodchipY) && isNum(f.curbWidthM) && isNum(f.curbRiseM) && isNum(f.curbTopY)) {
    return { groundY: f.groundY, woodchipY: f.woodchipY, curbWidthM: f.curbWidthM, curbRiseM: f.curbRiseM, curbTopY: f.curbTopY };
  }
  const d = DATA.finishChoices || {};
  const groundY = isNum(d.groundY) ? d.groundY : 0.224;
  const rise = isNum(d.curbRiseM) ? d.curbRiseM : 0.06;
  return {
    groundY, woodchipY: isNum(d.woodchipY) ? d.woodchipY : 0.232,
    curbWidthM: isNum(d.curbWidthM) ? d.curbWidthM : 0.12, curbRiseM: rise,
    curbTopY: Math.round((groundY + rise) * 1e6) / 1e6
  };
}

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

// Small deterministic CPU colour fallback, matched to the shared woodchip material's warm brown range.
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function woodColor(x, z) {
  const n = hash2(x * 3.1, z * 3.1) * 0.55 + hash2(x * 11.7, z * 11.7) * 0.30 + hash2(x * 29.3, z * 29.3) * 0.15;
  return {
    r: 0x4a / 255 + (0x8a / 255 - 0x4a / 255) * n,
    g: 0x32 / 255 + (0x6a / 255 - 0x32 / 255) * n,
    b: 0x20 / 255 + (0x45 / 255 - 0x20 / 255) * n
  };
}

// ---------------------------------------------------------------------------------------------------------------
// LAYOUT ADAPTER — C.buildBiidaasigeDodemThreeIsland(scene?, opts?).
function buildBiidaasigeDodemThreeIsland(scene = null, opts = {}) {
  const THREE = (C && C.THREE) || null;
  if (!THREE) return null;
  const H = shared();
  const FIN = finish();

  // Idempotent: drop the previous root from its scene before building a new one.
  const prev = C && C.biidaasigeDodemThreeIsland;
  if (prev && prev.group && prev.group.parent && typeof prev.group.parent.remove === 'function') {
    prev.group.parent.remove(prev.group);
  }

  const group = new THREE.Group();
  group.name = 'BiidaasigeDodemThreeIsland';
  group.userData.cullDistance = isNum(opts.cullDistance) ? opts.cullDistance : 500;
  group.userData.cullCell = isNum(opts.cullCell) ? opts.cullCell : 60;

  const surfaces = [];
  const skipped = [];
  const stats = {
    meshes: 0, triangles: 0, woodchipTriangles: 0, curbTriangles: 0,
    groundY: FIN.groundY, finishY: FIN.woodchipY, curbTopY: FIN.curbTopY,
    curbWidthM: FIN.curbWidthM, curbRiseM: FIN.curbRiseM,
    colliders: 0, cellM: CELL_M, estimates: true, sharedHelpers: !!H,
    source: 'Captain aerial trace (2025 City ortho), projected at call time; animals named by source photo, not placed'
  };
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
      source, finish: { groundY: FIN.groundY, woodchipY: FIN.woodchipY, curbWidthM: FIN.curbWidthM, curbRiseM: FIN.curbRiseM }, stats, skipped, cells: H ? H.buildIndex(surfaces, CELL_M) : new Map(), cellM: CELL_M
    };
    group.userData.biidaasigeDodemThreeIsland = stats;
    if (scene && scene.add) scene.add(group);
    if (C) {
      C.biidaasigeDodemThreeIsland = record;
      C.biidaasigeDodemThreeIslandAt = (x, z) => (H ? H.queryAt(record.cells, CELL_M, x, z) : null);
    }
    return { group, colliders: record.colliders, surfaces, ringWorld: record.ringWorld, footprint: record.footprint, source, finish: record.finish, stats, skipped };
  };

  if (!H) {
    stats.reason = 'shared helpers missing (load js/biidaasige-woodchip-island.js first)';
    return publish([]);
  }
  if (!projectionAvailable()) {
    stats.reason = 'projection unavailable (C.worldFromLatLon missing)';
    return publish([]);
  }
  const raw = tracedRingWorld();
  if (!raw) {
    stats.reason = 'source trace missing or outside the active projection';
    return publish([]);
  }
  const ring = H.dedupeRing(raw);
  if (!ring || ring.length < 3) {
    stats.reason = 'degenerate source ring';
    return publish([]);
  }
  const areaM2 = H.ringArea(ring);
  if (!(areaM2 > 1)) {
    stats.reason = 'source ring has no area';
    return publish([]);
  }

  const faces = H.triangulateFaces(THREE, ring);
  if (!faces) {
    stats.reason = 'triangulation produced no faces';
    return publish(ring);
  }
  const refined = H.refineTriangles(faces, isNum(opts.maxEdge) ? opts.maxEdge : MAX_REFINE_EDGE,
    isNum(opts.maxTris) ? opts.maxTris : MAX_TRIS);

  const woodGeo = H.surfaceGeometry(THREE, refined, FIN.woodchipY, woodColor);
  if (!woodGeo) {
    stats.reason = 'woodchip surface produced no triangles';
    return publish(ring);
  }
  const woodMesh = new THREE.Mesh(woodGeo, H.woodchipMaterial(THREE));
  woodMesh.name = 'BiidaasigeDodemThreeIsland_woodchip';
  woodMesh.receiveShadow = true;
  woodMesh.castShadow = false;
  woodMesh.userData.cullDistance = group.userData.cullDistance;
  woodMesh.userData.cullCell = group.userData.cullCell;
  group.add(woodMesh);
  stats.meshes++;
  const woodTris = Math.floor(woodGeo.attributes.position.count / 3);
  stats.woodchipTriangles = woodTris;
  stats.triangles += woodTris;
  H.collectTriangles(woodGeo.attributes.position, 'woodchip', surfaces);

  const curb = H.curbGeometry(THREE, ring, FIN.curbWidthM / 2, FIN.curbTopY, FIN.groundY, FIN.woodchipY);
  if (curb) {
    const curbMesh = new THREE.Mesh(curb.geo, H.curbMaterial(THREE));
    curbMesh.name = 'BiidaasigeDodemThreeIsland_curb';
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

  const colliders = opts.curbColliders === true ? H.curbColliders(ring, FIN.curbWidthM / 2, FIN.curbTopY) : [];
  stats.colliders = colliders.length;
  stats.areaM2 = Math.round(areaM2 * 10) / 10;
  stats.vertices = ring.length;
  stats.surfaceEntries = surfaces.length;

  const record = {
    group, colliders, surfaces, ringWorld: ring, footprint: ring,
    source, finish: { groundY: FIN.groundY, woodchipY: FIN.woodchipY, curbWidthM: FIN.curbWidthM, curbRiseM: FIN.curbRiseM },
    stats, skipped, cells: H.buildIndex(surfaces, CELL_M), cellM: CELL_M
  };
  group.userData.biidaasigeDodemThreeIsland = stats;
  if (scene && scene.add) scene.add(group);
  if (C) {
    C.biidaasigeDodemThreeIsland = record;
    C.biidaasigeDodemThreeIslandAt = (x, z) => H.queryAt(record.cells, CELL_M, x, z);
  }
  if (typeof console !== 'undefined' && console.info) {
    console.info(`[biidaasigeDodemThreeIsland] ${stats.vertices}-vertex traced ring, ${stats.areaM2} m2, ` +
      `${stats.meshes} meshes (${stats.woodchipTriangles} woodchip + ${stats.curbTriangles} curb tris), ` +
      `woodchip y=${FIN.woodchipY}, curb top y=${FIN.curbTopY}`);
  }
  return { group, colliders, surfaces, ringWorld: ring, footprint: ring, source, finish: record.finish, stats, skipped };
}

// ---------------------------------------------------------------------------------------------------------------
// Exports (the repo module convention: Object.assign(window.CITY, {...})).
if (C) {
  Object.assign(C, {
    BIIDAASIGE_DODEM_THREE_ISLAND_DATA: DATA,
    buildBiidaasigeDodemThreeIsland,
    biidaasigeDodemThreeIslandHelpers: { shared, finish, tracedRingWorld, woodColor }
  });
}
})();
