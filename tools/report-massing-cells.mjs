// tools/report-massing-cells.mjs — what the ?massing=1 cell meshes cost (st-2nl.3, docs/massing-buildings.md), measured
// deterministically in node: no GPU, no timing that the shared Mac mini could spoil.
// usage: node tools/report-massing-cells.mjs [--json out.json] [--runs 3]
// - the vertex format: bytes per vertex, and every tier's vertices, triangles and bytes (vertex + index), against the
//   pilot's 17-float format (tools/massing-legacy-format.mjs, main's createFootprintFacades) on the same records
// - meshes (the pilot: one per facade style per 1 km cell; now one per facade material per tier per block, and a twin), and per shot of tools/shots/massing-citywide.json the building meshes the camera's frustum draws and their
//   triangles, desktop (1600x900, high tier limits) and phone (412x915, low tier limits): the pilot's 1 km cells drew
//   whole; the cells now draw their tier cells' index runs
// - JS build time in node (median of --runs), the pilot's merge against buildMassingCells: an indication only (laptop,
//   another engine than the page's), never a budget
// The records are buildings.js's own (buildCityBlocks run with stand-in materials, as tests/massing.test.mjs does).
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as CORE from '../vendor/three/three.core.js';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import * as MC from '../js/massing-cells.js';
import { legacyFootprintFacades } from './massing-legacy-format.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => fs.readFileSync(ROOT + p, 'utf8');
const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const RUNS = Number(arg('--runs', 3));
const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };

// buildings.js's records, captured from its packInput call
async function cityRecords() {
  const anyNode = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : anyNode), apply: () => anyNode });
  class MeshStandardNodeMaterial extends CORE.MeshStandardMaterial {}
  const win = { CITY: { THREE: { ...CORE, MeshStandardNodeMaterial }, Addons: { mergeGeometries: () => new CORE.BufferGeometry() }, DEBUG_ROADS: false } };
  win.CITY.TSL = Object.fromEntries(['Fn', 'float', 'color', 'uv', 'attribute', 'fract', 'smoothstep', 'mix', 'abs'].map((n) => [n, anyNode]));
  const c = vm.createContext({ window: win, Math, JSON, Object, Array, Number, Map, Set, Float32Array, Float64Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, WeakMap, Infinity, NaN, console: { ...console, info() {} }, performance, Promise, URLSearchParams });
  for (const f of ['js/toronto-geodata.js', 'js/city-config.js']) vm.runInContext(read(f), c);
  const { MASSING } = await unpackGeo(fs.readFileSync(ROOT + 'data/toronto-massing.bin'));
  win.CITY.MASSING = massingRows(MASSING, win.CITY.GEO);
  let records = null;
  win.CITY.MassingCells = { ...MC, packInput: (r) => { records = r; return MC.packInput(r); } };
  Object.assign(win.CITY, {
    WALL_KINDS: { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4 }, setFootprintTable() {},
    createRenderedFacadeMaterial: () => new CORE.MeshBasicMaterial(), createCurtainWallMaterial: () => new CORE.MeshBasicMaterial(),
    createFacadeBoxes: (m, boxes) => new CORE.InstancedMesh(new CORE.BoxGeometry(1, 1, 1), m, boxes.length),
    createFireEscapes: () => ({ begin() {}, add() {}, end() {} })
  });
  vm.runInContext(read('js/buildings.js'), c);
  const out = win.CITY.buildCityBlocks(new CORE.Scene());
  await out.massingReady;
  return records;
}

const records = await cityRecords();
// the pilot's format: one merge per facade style (buildings.js's five buckets before: the rendered styles are now
// material 0's variants 0 and 1, the curtain walls material 1's 0 to 2), each record's seed as it was
const legacyStyle = (r) => (r.style === 0 ? r.variant : 2 + r.variant);
const legacyBuild = () => {
  const t = performance.now(), meshes = [];
  for (let s = 0; s < 5; s++) {
    const items = records.filter((r) => legacyStyle(r) === s);
    if (items.length) meshes.push(...legacyFootprintFacades(CORE, new CORE.MeshBasicMaterial(), items).meshes);
  }
  return { meshes, ms: performance.now() - t };
};
const newBuild = () => {
  const t = performance.now();
  const out = MC.buildMassingCells(MC.packInput(records));
  return { out, ms: performance.now() - t };
};
const legacyRuns = [], newRuns = [];
let legacy, cells;
for (let i = 0; i < RUNS; i++) {
  legacy = legacyBuild(); legacyRuns.push(legacy.ms);
  cells = newBuild(); newRuns.push(cells.ms);
}
const out = cells.out;

// sizes
const bytesOf = (g) => Object.values(g.attributes).reduce((s, a) => s + a.array.length * 4, 0) + g.index.array.byteLength;
const legacyStats = legacy.meshes.reduce((s, m) => {
  const g = m.geometry;
  s.vertices += g.attributes.position.count; s.triangles += g.index.count / 3;
  s.vertexBytes += g.attributes.position.count * 17 * 4; s.indexBytes += g.index.array.byteLength;
  return s;
}, { meshes: legacy.meshes.length, vertices: 0, triangles: 0, vertexBytes: 0, indexBytes: 0 });
void bytesOf;
const tierStats = out.stats.tiers.map((t, k) => {
  let vertexBytes = 0, indexBytes = 0, meshes = 0;
  for (const b of out.blocks) {
    const T = b.tiers[k];
    if (!T.index.length) continue;
    meshes++; vertexBytes += T.position.byteLength + T.normal.byteLength; indexBytes += T.index.byteLength;
  }
  return { name: t.name, vertices: t.vertices, triangles: t.triangles, walls: t.walls, vertexBytes, indexBytes, meshes, bytesPerVertex: vertexBytes / t.vertices };
});

// per shot: the meshes in the frustum and their triangles
const shots = JSON.parse(read('tools/shots/massing-citywide.json')).map((s) => {
  const m = s.js.match(/pos: \[([^\]]+)\], look: \[([^\]]+)\], fov: (\d+)/);
  return { name: s.name, pos: m[1].split(',').map(Number), look: m[2].split(',').map(Number), fov: Number(m[3]) };
});
const frustumOf = (shot, aspect) => {
  const cam = new CORE.PerspectiveCamera(shot.fov, aspect, 0.35, 60000);
  cam.position.set(...shot.pos); cam.lookAt(...shot.look); cam.updateMatrixWorld(true);
  return new CORE.Frustum().setFromProjectionMatrix(new CORE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
};
const legacySpheres = legacy.meshes.map((m) => ({ sphere: m.geometry.boundingSphere, triangles: m.geometry.index.count / 3 }));
const LIMITS = { high: [600, 1600], low: [300, 1000] }; // (js/quality.js massingLimits)
function shotCost(shot, aspect, limits) {
  const F = frustumOf(shot, aspect);
  const before = { draws: 0, triangles: 0 };
  for (const m of legacySpheres) if (F.intersectsSphere(m.sphere)) { before.draws++; before.triangles += m.triangles; }
  // the tiers as the page settles them for a camera standing there
  const tierOf = new Map(out.cells.map((c) => [`${c.sx},${c.sz}`, MC.nextTier(-1, MC.cellDistance(c, ...shot.pos), limits, 40)]));
  const after = { draws: 0, triangles: 0, byTier: [0, 0, 0] };
  for (const b of out.blocks) {
    const subs = [0, 1, 2, 3].map((s) => { const k = MC.TIER_ORDER.indexOf(s); return tierOf.get(`${b.bx * 2 + (k & 1)},${b.bz * 2 + (k >> 1)}`) ?? -1; });
    b.tiers.forEach((T, t) => {
      if (!T.index.length) return;
      const [x, y, z, r] = T.sphere;
      if (!F.intersectsSphere(new CORE.Sphere(new CORE.Vector3(x, y, z), r))) return;
      for (const [, count] of MC.tierRuns(T.ranges, subs, t)) { after.draws++; after.triangles += count / 3; after.byTier[t] += count / 3; }
    });
  }
  return { before, after };
}
const perShot = shots.map((s) => ({ shot: s.name, desktop: shotCost(s, 1600 / 900, LIMITS.high), phone: shotCost(s, 412 / 915, LIMITS.low) }));

const report = {
  records: records.length,
  format: { legacyBytesPerVertex: 68, bytesPerVertex: MC.BYTES_PER_VERTEX, tableBytes: out.table.byteLength, yUnit: out.yUnit },
  legacy: legacyStats, tiers: tierStats,
  totals: {
    legacyBytes: legacyStats.vertexBytes + legacyStats.indexBytes,
    nearBytes: tierStats[0].vertexBytes + tierStats[0].indexBytes,
    allTiersBytes: tierStats.reduce((s, t) => s + t.vertexBytes + t.indexBytes, 0) + out.table.byteLength,
    meshes: tierStats.reduce((s, t) => s + t.meshes, 0) * 2, // (each with its twin for a second index run)
    cells: out.cells.length, blocks: new Set(out.blocks.map((b) => `${b.bx},${b.bz}`)).size, blockStyles: out.blocks.length
  },
  mid: { simplified: out.stats.simplified, keptWhole: out.stats.midKept, coveredWallsDropped: out.stats.coveredDropped },
  buildMs: { runs: RUNS, legacy: legacyRuns.map(Math.round), cells: newRuns.map(Math.round), legacyMedian: Math.round(median(legacyRuns)), cellsMedian: Math.round(median(newRuns)), node: process.version },
  perShot
};
if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(report, null, 2) + '\n');

const MiB = (b) => (b / 1048576).toFixed(1);
console.log(`# ?massing=1 cell meshes, ${report.records} buildings (node ${process.version}; deterministic except the build times)\n`);
console.log('| | Vertices | Triangles | Bytes/vertex | Vertex MiB | Index MiB | Meshes |');
console.log('|---|---:|---:|---:|---:|---:|---:|');
console.log(`| pilot format (17 floats, 1 km cells) | ${legacyStats.vertices} | ${legacyStats.triangles} | 68 | ${MiB(legacyStats.vertexBytes)} | ${MiB(legacyStats.indexBytes)} | ${legacyStats.meshes} |`);
for (const t of tierStats) console.log(`| ${t.name} tier | ${t.vertices} | ${t.triangles} | ${t.bytesPerVertex} | ${MiB(t.vertexBytes)} | ${MiB(t.indexBytes)} | ${t.meshes} (+${t.meshes} twins) |`);
console.log(`\nBuilding table: ${MiB(out.table.byteLength)} MiB. All tiers resident: ${MiB(report.totals.allTiersBytes)} MiB, against ${MiB(report.totals.legacyBytes)} MiB; the near tier alone ${MiB(report.totals.nearBytes)} MiB.`);
console.log(`Mid tier: ${report.mid.simplified} outlines simplified, ${report.mid.keptWhole} kept whole, ${report.mid.coveredWallsDropped} covered party walls dropped.`);
console.log(`JS build (node, median of ${RUNS}): pilot merge ${report.buildMs.legacyMedian} ms, buildMassingCells ${report.buildMs.cellsMedian} ms (all three tiers; in the page it runs in a worker).\n`);
console.log('| Shot | Desktop draws | Desktop triangles | Phone draws | Phone triangles |');
console.log('|---|---|---|---|---|');
for (const r of perShot) {
  const f = (c) => `${c.before.draws} → ${c.after.draws}`, g = (c) => `${c.before.triangles} → ${c.after.triangles}`;
  console.log(`| ${r.shot} | ${f(r.desktop)} | ${g(r.desktop)} | ${f(r.phone)} | ${g(r.phone)} |`);
}
