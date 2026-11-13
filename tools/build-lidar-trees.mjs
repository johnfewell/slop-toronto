// tools/build-lidar-trees.mjs — the lidar-only trees of the shared Toronto data repo's `trees/2` dataset, baked into this
// city's world frame for js/lidar-trees.js (docs/lidar-trees.md; ?lidarTrees=1). Writes js/lidar-trees-data.js (the
// detail map) or, with --frame eglinton, the Eglinton map's cell files and their index (data/frames/eglinton/lidar-trees/),
// and its frame's entry in the pin data/shared-toronto-data-pin.json.
//
//   TORONTO_DATA_CACHE=<the shared repo's cache root> node tools/build-lidar-trees.mjs [--frame eglinton]
//   node tools/build-lidar-trees.mjs --trees2 <the trees/2 folder> [--frame eglinton] [--out <file or folder>] [--pin <file>]
//   --drop-yard-under <m>: leave out the yard trees (not on a park island) under <m> m. Off by default, and off in what
//   ships: a switch for measuring the small-tree question (John, 2026-11-12: nothing dropped by height until he decides)
//
// The public snapshot never needs this: the app only reads the committed files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { ROOT, loadCity, utm17 } from './terrain-pilot-lib.mjs';
import { worldFromUtm, modelFor, woodsTest, nearIndex, pack, packBytes, unpack, dropReason, yardHeights, cellOf, CELL_M, RULES, MODELS, Q } from './lidar-trees-lib.mjs';
import { unpackGeo } from '../js/geodata-loader.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const DIR = arg('--trees2') || (process.env.TORONTO_DATA_CACHE ? path.join(process.env.TORONTO_DATA_CACHE, 'derived/trees/2') : null);
const FRAME = arg('--frame') || 'detail';
if (!['detail', 'eglinton'].includes(FRAME)) { console.error(`build-lidar-trees: --frame detail | eglinton, not ${FRAME}`); process.exit(1); }
const DEFAULT_OUT = FRAME === 'eglinton' ? 'data/frames/eglinton/lidar-trees' : 'js/lidar-trees-data.js';
const OUT = path.resolve(ROOT, arg('--out') || DEFAULT_OUT);
const DROP_YARD_UNDER = arg('--drop-yard-under') === null ? null : Number(arg('--drop-yard-under'));
if (DROP_YARD_UNDER !== null && !(DROP_YARD_UNDER > 0)) { console.error('build-lidar-trees: --drop-yard-under <metres>'); process.exit(1); }
const PIN = path.resolve(ROOT, arg('--pin') || 'data/shared-toronto-data-pin.json');
if (!DIR || !fs.existsSync(path.join(DIR, 'manifest.json'))) {
  console.error('build-lidar-trees: needs the shared Toronto data repo\'s trees/2 dataset: set TORONTO_DATA_CACHE to its cache root (the folder holding derived/trees/2) or pass --trees2 <folder>. The app does not need it: js/lidar-trees-data.js is committed.');
  process.exit(1);
}

// Constants (docs/lidar-trees.md)
const NEAR_STREET_TREE_M = 4; // a crown this close to a tree the city already draws is that tree (trees/2's match radius)
const BUILDING_PAD_M = 1; // a trunk this close to a building box would stand in its wall
const DECK_PAD_M = 1;
const SALT = 'lidar-trees/1';

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
if (manifest.dataset !== 'trees/2') throw new Error(`build-lidar-trees: ${DIR} holds ${manifest.dataset}, not trees/2`);
if (manifest.parameters?.cityDatum !== 'nad83csrs-as-wgs84') throw new Error('build-lidar-trees: trees/2 was built with another datum for City layers');

// (the Eglinton map: its own geodata, sidewalks and subway, as explore.html loads them; everything else is shared)
const CITY_FILES = ['js/toronto-sidewalks.js', 'js/sidewalk-polygons.js', 'js/high-park-woods-data.js', 'js/toronto-island-woods-data.js',
  'js/waterfront-island-residential-canopy-data.js'];
const C = FRAME === 'eglinton'
  ? loadCity(CITY_FILES, { frame: 'eglinton', geo: (await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/frames/eglinton/toronto-geodata.bin')))).GEO })
  : loadCity(CITY_FILES);
const GEO = C.GEO, F = GEO.frame.detail, SW = GEO.frame.sidewalk;

// the cells of trees/2 over the detail frame (its corners and edges in UTM, 50 m spare)
const edge = [];
for (let s = 0; s <= 1; s += 0.05) edge.push([F.x0 + s * (F.x1 - F.x0), F.z0], [F.x0 + s * (F.x1 - F.x0), F.z1], [F.x0, F.z0 + s * (F.z1 - F.z0)], [F.x1, F.z0 + s * (F.z1 - F.z0)]);
const U = edge.map(([x, z]) => { const q = C.latLonFromWorld(x, z); return utm17(q.lat, q.lon); });
const [E0, E1, N0, N1] = [Math.min(...U.map((u) => u[0])) - 50, Math.max(...U.map((u) => u[0])) + 50, Math.min(...U.map((u) => u[1])) - 50, Math.max(...U.map((u) => u[1])) + 50];
const cells = Object.keys(index.cells).filter((id) => { const [e, n] = id.split('_').map(Number); return e + 500 > E0 && e < E1 && n + 500 > N0 && n < N1; }).sort();

// every crown of those cells in world (x, z); lidar crowns (src 1 and 2) also feed the woods test
const crowns = [];
for (const id of cells) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, 'cells', `${id}.json`), 'utf8'));
  for (let i = 0; i < d.count; i++) {
    const src = d.src[i];
    const E = src === 1 ? d.lE[i] : d.E[i], N = src === 1 ? d.lN[i] : d.N[i];
    const w = worldFromUtm(C, E, N);
    // (on the packed grid already, so the rules judge the position that ships: 0.25 m can cross a curb)
    const x = F.x0 + Math.round((w.x - F.x0) / Q.xz) * Q.xz, z = F.z0 + Math.round((w.z - F.z0) / Q.xz) * Q.xz;
    crowns.push({ x, z, src, h: d.h[i], r: d.r[i], moved: d.moved[i] });
  }
}

// the keep-outs (each the city's own test where it has one)
const inFrame = (x, z) => x >= F.x0 && x < F.x1 && z >= F.z0 && z < F.z1;
const WOODS = Object.keys(C).filter((k) => /_WOODS_DATA$/.test(k)).map((k) => C[k]).map((D) => ({ names: D.parkNames || ['High Park'], box: D.box }));
// (the woods layers' areas: the parks' islands they draw, js/park-woods.js replacesBlock)
const woodsBlock = (b) => !!b && WOODS.some(({ names, box }) => names.includes(b.parkName) && b.cx > box.x0 && b.cx < box.x1 && b.cz > box.z0 && b.cz < box.z1);
const RC = C.ISLAND_RESIDENTIAL_CANOPY_DATA;
const canopyPts = RC ? [...(RC.rows || []), ...((RC.marina && RC.marina.rows) || [])].map((r) => [r[1] / 10, r[2] / 10]) : [];
const nearCanopy = nearIndex(canopyPts, NEAR_STREET_TREE_M);
const ST = GEO.streetTrees || [];
const streetPts = [];
for (let i = 0; i < ST.length; i += 4) streetPts.push([ST[i], ST[i + 1]]);
const nearStreet = nearIndex(streetPts, NEAR_STREET_TREE_M);
const walk = C.sidewalkWalkIndex(C.sidewalkPieces(C.SIDEWALKS, GEO.blocks));
const segDist = (x, z, a, b) => { const ex = b.x - a.x, ez = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1))); return Math.hypot(a.x + ex * t - x, a.z + ez * t - z); };
const onSidewalk = (x, z) => {
  const b = C.blockAt(x, z);
  if (!b) return false;
  const m = walk && walk.inside(b.id, x, z);
  if (m !== null && m !== undefined) return m;
  // (an island without mapped sidewalks keeps the fixed band, GEO.frame.sidewalk in from the curb, as city-grid.js lays it)
  if (b.park > 0.6 || b.wild > 0.5) return false;
  const P = b.poly;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) if (segDist(x, z, P[j], P[i]) < SW) return true;
  return false;
};
// (the parks' paths: no trunk on one, js/park-woods.js's rule: within half the path's width + 0.8 m; GEO.parkPaths
// [width, x0, z0, x1, z1, ...]; and the sports pitches, GEO.areas 'pitch')
const pathSegs = [];
for (const [w, ...f] of GEO.parkPaths || []) for (let i = 0; i + 3 < f.length; i += 2) pathSegs.push([f[i], f[i + 1], f[i + 2], f[i + 3], w / 2 + 0.8]);
const PATH_CELL = 16, pathGrid = new Map();
for (const s of pathSegs) {
  for (let i = Math.floor((Math.min(s[0], s[2]) - s[4]) / PATH_CELL); i <= Math.floor((Math.max(s[0], s[2]) + s[4]) / PATH_CELL); i++) {
    for (let j = Math.floor((Math.min(s[1], s[3]) - s[4]) / PATH_CELL); j <= Math.floor((Math.max(s[1], s[3]) + s[4]) / PATH_CELL); j++) {
      const k = i * 100000 + j;
      (pathGrid.get(k) || pathGrid.set(k, []).get(k)).push(s);
    }
  }
}
const onParkPath = (x, z) => (pathGrid.get(Math.floor(x / PATH_CELL) * 100000 + Math.floor(z / PATH_CELL)) || [])
  .some(([ax, az, bx, bz, r]) => segDist(x, z, { x: ax, z: az }, { x: bx, z: bz }) < r);
const pitches = (GEO.areas || []).filter(([kind]) => kind === 'pitch').map(([, , flat]) => flat).map((flat) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < flat.length; i += 2) { x0 = Math.min(x0, flat[i]); x1 = Math.max(x1, flat[i]); z0 = Math.min(z0, flat[i + 1]); z1 = Math.max(z1, flat[i + 1]); }
  const pts = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: flat[i], z: flat[i + 1] });
  return { pts, x0, x1, z0, z1 };
});
const onPitch = (x, z) => pitches.some(({ pts, x0, x1, z0, z1 }) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && C.pointInPoly(pts, x, z));
const keep = {
  inFrame,
  woodsLayer: (x, z) => woodsBlock(C.blockAt(x, z)),
  islandCanopy: nearCanopy,
  nearStreetTree: nearStreet,
  water: (x, z) => C.waterAt(x, z),
  roadway: (x, z) => !C.blockAt(x, z),
  sidewalk: onSidewalk,
  building: (x, z) => C.buildingBoxAt(x, z, BUILDING_PAD_M),
  offRail: (x, z) => !C.treeOffRail(x, z),
  roadDeck: (x, z) => C.bridgeAt(x, z, DECK_PAD_M),
  parkPath: onParkPath,
  pitch: onPitch
};

const counts = Object.fromEntries(RULES.map((r) => [r, 0]));
const streetKinds = { streetOnly: 0, streetMatched: 0, movedToCrown: 0, movedToBoulevard: 0 };
const isWoods = woodsTest(crowns.filter((c) => c.src >= 1));
const kept = [];
let smallYard = 0;
for (const t of crowns) {
  const why = dropReason(t, keep);
  if (why === 'notLidarOnly' && inFrame(t.x, t.z)) {
    if (t.moved === 1) streetKinds.movedToCrown++; else if (t.moved === 2) streetKinds.movedToBoulevard++;
    else if (t.src === 1) streetKinds.streetMatched++; else streetKinds.streetOnly++;
  }
  if (why) { if (why !== 'notLidarOnly' || inFrame(t.x, t.z)) counts[why]++; continue; }
  const b = C.blockAt(t.x, t.z);
  const park = b.park > 0.6;
  if (DROP_YARD_UNDER !== null && !park && t.h < DROP_YARD_UNDER) { smallYard++; continue; }
  kept.push({ x: t.x, z: t.z, h: t.h, r: t.r, model: modelFor(t.h, t.r, t.x, t.z), woods: park && isWoods(t.x, t.z), park });
}
// (the street trees and the crowns outside the frame are not drops of this layer: counted apart)
const lidarInFrame = crowns.filter((t) => t.src === 2 && inFrame(t.x, t.z)).length;
kept.sort((a, b) => Math.round(a.z / Q.xz) - Math.round(b.z / Q.xz) || Math.round(a.x / Q.xz) - Math.round(b.x / Q.xz));

const byModel = Object.fromEntries(MODELS.map((m) => [m, 0]));
for (const t of kept) byModel[MODELS[t.model]]++;
const hs = kept.map((t) => t.h).sort((a, b) => a - b);
const pct = (p) => hs[Math.min(hs.length - 1, Math.floor(p * hs.length))];
const data = {
  version: 1,
  kind: 'lidar-trees',
  frame: { name: FRAME, detail: F, projection: GEO.frame.projection },
  origin: { x0: F.x0, z0: F.z0 },
  quantum: Q,
  models: MODELS,
  source: {
    dataset: 'trees/2 of the shared Toronto data repo (lidar-only trees, src 2)',
    from: 'Ontario Elevation Mapping Program, GTA 2023 lidar, 1 m Digital Surface Model over Digital Terrain Model; City of Toronto layers for its masks',
    licence: 'Open Government Licence – Ontario (the lidar); Open Government Licence – Toronto (the City layers); see CREDITS.md',
    attribution: 'Contains information licensed under the Open Government Licence – Ontario. Contains information licensed under the Open Government Licence – Toronto.',
    manifestCommit: manifest.builder.commit,
    tilesDigest: manifest.inputs.lidar.tilesDigest
  },
  rules: {
    frame: 'UTM 17N to lat/lon with no datum shift (tools/terrain-pilot-lib.mjs utm17ToLatLon), then the shipped projection (city-config.js worldFromLatLon)',
    nearStreetTreeM: NEAR_STREET_TREE_M, buildingPadM: BUILDING_PAD_M, deckPadM: DECK_PAD_M,
    model: 'tools/lidar-trees-lib.mjs modelFor: by height and crown, seeded by position',
    woods: 'on a park island, with crowns covering 60% or more of the ground within 12 m (tools/lidar-trees-lib.mjs woodsTest); trees.js draws them with the woods\' nearer hand-overs. Yard trees are never woods: trees/2\'s crown radii merge in closed canopy, so the test reads most yards as woods',
    park: 'on a park island (GEO.blocks park share over 0.6): drawn to the parks\' distances, else the yards\'',
    ...(DROP_YARD_UNDER !== null ? { dropYardUnderM: DROP_YARD_UNDER } : {})
  },
  counts: {
    lidarOnlyInFrame: lidarInFrame, kept: kept.length, dropped: Object.fromEntries(RULES.filter((r) => r !== 'notLidarOnly' && r !== 'outsideFrame').map((r) => [r, counts[r]])),
    streetTreesNotDrawnHere: streetKinds, woods: kept.filter((t) => t.woods).length, park: kept.filter((t) => t.park).length,
    byModel, heightM: { p10: pct(0.1), median: pct(0.5), p90: pct(0.9), max: hs[hs.length - 1] },
    yardHeightsM: yardHeights(kept), ...(DROP_YARD_UNDER !== null ? { smallYardDropped: smallYard } : {})
  },
};

// The pin: one entry per frame under trees/2, each bake rewriting its own (no paths)
const pinFor = (frameEntry) => {
  let old = null;
  try { old = JSON.parse(fs.readFileSync(PIN, 'utf8')); } catch { /* none yet */ }
  const prev = old?.datasets?.['trees/2'];
  const same = prev && prev.manifestCommit === manifest.builder.commit && prev.tilesDigest === manifest.inputs.lidar.tilesDigest;
  const t2 = {
    manifestCommit: manifest.builder.commit,
    manifestGenerated: manifest.generatedAt,
    tilesDigest: manifest.inputs.lidar.tilesDigest,
    indexSha256: manifest.files['index.json'],
    bakedInto: same ? prev.bakedInto : [],
    dataSha256: same ? prev.dataSha256 : undefined,
    ...(same && prev.eglinton ? { eglinton: prev.eglinton } : {})
  };
  Object.assign(t2, frameEntry);
  const pin = { what: 'The shared Toronto data repo datasets this city bakes from (docs/lidar-trees.md). No paths: set TORONTO_DATA_CACHE to rebuild.', datasets: { ...(old?.datasets || {}), 'trees/2': t2 } }; // (the pin's other datasets, e.g. the TTC schedule's, kept)
  fs.mkdirSync(path.dirname(PIN), { recursive: true });
  fs.writeFileSync(PIN, `${JSON.stringify(pin, null, 2)}\n`);
};

if (FRAME === 'detail') {
  Object.assign(data, { count: kept.length, trees: pack(kept, F.x0, F.z0) });
  const header = `// js/lidar-trees-data.js — GENERATED by tools/build-lidar-trees.mjs, do not edit by hand.
// The lidar-only trees of the detail frame, from the shared Toronto data repo's trees/2 (Ontario GTA 2023 lidar, Open
// Government Licence – Ontario; City of Toronto masks, Open Government Licence – Toronto; docs/lidar-trees.md). Loaded
// only with ?lidarTrees=1 (explore.html); js/lidar-trees.js draws them through the city's own tree field.
`;
  const body = `${header}(function () {\nwindow.CITY = window.CITY || {};\nwindow.CITY.LIDAR_TREES_DATA = ${JSON.stringify(data)};\n})();\n`;
  fs.writeFileSync(OUT, body);
  pinFor({ bakedInto: ['js/lidar-trees-data.js'], dataSha256: crypto.createHash('sha256').update(body).digest('hex') });
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT), bytes: body.length, cells: cells.length, ...data.counts }, null, 1));
} else {
  // The Eglinton map: one gzip'd file of packed trees per 1,200 m cell of the far band's grid that has any (each from its
  // cell's corner, so 0.25 m steps fit a Uint16), and an index naming them with their counts and SHA-256. explore.html
  // fetches the index by its hash (?v=), then every cell by its own, before the city's scripts run.
  const byCell = new Map();
  for (const t of kept) {
    const [i, j] = cellOf(t.x, t.z), k = `${i}_${j}`;
    (byCell.get(k) || byCell.set(k, { i, j, trees: [] }).get(k)).trees.push(t);
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (/^-?\d+_-?\d+\.bin$/.test(f)) fs.unlinkSync(path.join(OUT, f)); // (cells a rebuild no longer has)
  const list = [];
  let raw = 0, packed = 0;
  for (const c of [...byCell.values()].sort((a, b) => a.j - b.j || a.i - b.i)) {
    const x0 = c.i * CELL_M, z0 = c.j * CELL_M, bytes = packBytes(c.trees, x0, z0);
    const gz = zlib.gzipSync(bytes, { level: 9 });
    const file = `${c.i}_${c.j}.bin`, sha256 = crypto.createHash('sha256').update(gz).digest('hex');
    fs.writeFileSync(path.join(OUT, file), gz);
    raw += bytes.length; packed += gz.length;
    list.push({ file, x0, z0, count: c.trees.length, bytes: gz.length, sha256 });
  }
  // (the core, the detail box, against the detail map's committed bake: the same lidar, judged against each map's own
  // layers, so only the drop decisions can differ)
  const core = (() => {
    const file = path.join(ROOT, 'js/lidar-trees-data.js');
    if (!fs.existsSync(file)) return null;
    const ctx = vm.createContext({ window: { CITY: {} } });
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
    const D = ctx.window.CITY.LIDAR_TREES_DATA, B = D.frame.detail;
    const key = (t) => `${Math.round(t.x / Q.xz)},${Math.round(t.z / Q.xz)}`;
    const detail = new Set(unpack(D.trees, D.count, D.origin.x0, D.origin.z0).map(key));
    const here = new Set(kept.filter((t) => t.x >= B.x0 && t.x < B.x1 && t.z >= B.z0 && t.z < B.z1).map(key));
    let both = 0;
    for (const k of here) if (detail.has(k)) both++;
    return { detailBox: B, inBoth: both, onlyThisMap: here.size - both, onlyDetailMap: detail.size - both };
  })();
  const index = { ...data, cell: CELL_M, coreAgainstDetailBake: core, bytes: { raw, gzip: packed }, cells: list };
  const indexBody = `${JSON.stringify(index)}\n`;
  fs.writeFileSync(path.join(OUT, 'index.json'), indexBody);
  const indexSha256 = crypto.createHash('sha256').update(indexBody).digest('hex');
  // (the page asks for the index by its hash, as it does the geodata: only when writing the shipped folder)
  if (OUT === path.resolve(ROOT, DEFAULT_OUT)) {
    const html = path.join(ROOT, 'explore.html'), src = fs.readFileSync(html, 'utf8');
    const next = src.replace(/(data\/frames\/eglinton\/lidar-trees\/index\.json\?v=)[0-9a-f]+/, `$1${indexSha256.slice(0, 12)}`);
    if (next !== src) fs.writeFileSync(html, next);
  }
  pinFor({ eglinton: { bakedInto: [`${DEFAULT_OUT}/`], indexSha256, cells: list.length, trees: kept.length } });
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT), cells: list.length, bytes: index.bytes, sourceCells: cells.length, coreAgainstDetailBake: core, ...data.counts }, null, 1));
}
