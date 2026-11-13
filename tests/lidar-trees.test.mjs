// The lidar-only trees (docs/lidar-trees.md, ?lidarTrees=1): the frame conversion from the lidar's grid, the model each
// tree gets, the packed data and its runtime decoder, the committed data against the city's keep-outs, the runtime's
// replacement of the invented park & yard trees, and the bake on a small fixture (its drop rules, its determinism, its
// pin). None of it needs the shared Toronto data repo: the fixture is written here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCity, utm17, utm17ToLatLon } from '../tools/terrain-pilot-lib.mjs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { worldFromUtm, modelFor, MODELS, pack, packBytes, unpack, dropReason, RULES, nearIndex, woodsTest, hashPos, yardHeights, cellOf, CELL_M } from '../tools/lidar-trees-lib.mjs';
import { unpackGeo } from '../js/geodata-loader.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const C = loadCity(['js/toronto-sidewalks.js', 'js/sidewalk-polygons.js', 'js/high-park-woods-data.js', 'js/toronto-island-woods-data.js']);
const F = C.GEO.frame.detail;

test('the lidar grid to the world frame agrees with the shared repo\'s coordinate module to a millimetre', () => {
  // (UTM 17N with no datum shift, then the shipped projection; the expected values are that module's, for the same points)
  for (const [E, N, x, z] of [[630000, 4834000, -501.9149, -420.1712], [622500, 4833000, -7952.9948, -1743.765], [633200, 4837100, 3491.1664, -2399.6468]]) {
    const w = worldFromUtm(C, E, N);
    assert.ok(Math.hypot(w.x - x, w.z - z) < 0.001, `${E} ${N}: ${w.x} ${w.z}`);
  }
  for (let lat = 43.6; lat < 43.86; lat += 0.05) for (let lon = -79.62; lon < -79.12; lon += 0.05) {
    const [E, N] = utm17(lat, lon), [la, lo] = utm17ToLatLon(E, N);
    const [E2, N2] = utm17(la, lo);
    assert.ok(Math.hypot(E2 - E, N2 - N) < 0.001);
  }
});

test('each tree\'s model follows its height and crown, the same on every rebuild', () => {
  const models = new Set(C.GEO.treeModels.map(([id]) => id));
  for (const m of MODELS) assert.ok(models.has(m), m);
  assert.equal(MODELS[modelFor(6, 3, 10, 20)].split('-')[2], 'small');
  assert.match(MODELS[modelFor(12, 4, 10, 20)], /medium/);
  assert.match(MODELS[modelFor(22, 7, 10, 20)], /large/);
  for (let i = 0; i < 200; i++) assert.match(MODELS[modelFor(20, 2, i * 3.7, i * 1.3)], /pine|aspen/); // (a narrow crown)
  for (let i = 0; i < 200; i++) assert.equal(modelFor(11, 5, i * 2.25, -i), modelFor(11, 5, i * 2.25, -i));
  assert.equal(hashPos(10.01, 20.02), hashPos(10.0, 20.0)); // (positions quantised to 0.25 m)
  let oaks = 0;
  for (let i = 0; i < 2000; i++) if (/oak/.test(MODELS[modelFor(12, 5, i * 7.5, i * 3.25)])) oaks++;
  assert.ok(oaks > 1350 && oaks < 1650, `${oaks} oaks of 2000`);
});

test('the packed trees round-trip, and the runtime decodes them as the bake wrote them', () => {
  const trees = [{ x: F.x0 + 0.25, z: F.z0 + 0.5, h: 3.2, r: 1.5, model: 0, woods: false, park: false },
    { x: F.x1 - 0.25, z: F.z1 - 0.25, h: 44.2, r: 12, model: 10, woods: true, park: true }];
  const b64 = pack(trees, F.x0, F.z0), back = unpack(b64, 2, F.x0, F.z0);
  assert.deepEqual(back.map((t) => [t.x, t.z, t.h, t.r, t.model, t.woods, t.park]), [[F.x0 + 0.25, F.z0 + 0.5, 3.2, 1.5, 0, false, false], [F.x1 - 0.25, F.z1 - 0.25, 44.2, 12, 10, true, true]]);
  const ctx = vm.createContext({ window: { CITY: {} }, console: { info() {}, warn() {} }, atob });
  vm.runInContext(read('js/lidar-trees.js'), ctx);
  const rt = ctx.window.CITY.lidarTreesDecode({ trees: b64, count: 2, quantum: { xz: 0.25, h: 0.2, r: 0.1 }, origin: { x0: F.x0, z0: F.z0 }, models: MODELS });
  assert.deepEqual(JSON.parse(JSON.stringify(rt.map((t) => [t.x, t.z, t.h, t.r, t.model, t.woods, t.park]))), back.map((t) => [t.x, t.z, t.h, t.r, MODELS[t.model], t.woods, t.park]));
});

test('the drop rules apply in order, and the neighbour and woods tests measure what they say', () => {
  const no = () => false, yes = () => true;
  const k = { inFrame: yes, woodsLayer: no, islandCanopy: no, nearStreetTree: no, water: no, roadway: no, sidewalk: no, building: no, offRail: no, roadDeck: no, parkPath: no, pitch: no };
  assert.equal(dropReason({ x: 0, z: 0, src: 1 }, k), 'notLidarOnly');
  assert.equal(dropReason({ x: 0, z: 0, src: 2 }, k), null);
  assert.equal(dropReason({ x: 0, z: 0, src: 2 }, { ...k, roadway: yes, building: yes }), 'roadway');
  assert.equal(dropReason({ x: 0, z: 0, src: 2 }, { ...k, inFrame: no, woodsLayer: yes }), 'outsideFrame');
  assert.deepEqual(RULES.slice(0, 2), ['notLidarOnly', 'outsideFrame']);
  const near = nearIndex([[0, 0], [100, 100]], 4);
  assert.ok(near(3.9, 0) && !near(4.1, 0) && near(100, 103));
  // (a closed stand: crowns of 4 m every 6 m; one tree alone)
  const stand = [];
  for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) stand.push({ x: i * 6, z: j * 6, r: 4 });
  assert.ok(woodsTest(stand)(0, 0));
  assert.ok(!woodsTest([{ x: 0, z: 0, r: 4 }])(0, 0));
});

test('the committed data: baked for this frame, inside it, off the roads, buildings, water and other trees layers', () => {
  const ctx = vm.createContext({ window: { CITY: {} } });
  vm.runInContext(read('js/lidar-trees-data.js'), ctx);
  const D = ctx.window.CITY.LIDAR_TREES_DATA;
  assert.equal(D.kind, 'lidar-trees');
  assert.deepEqual({ ...D.frame.projection }, { ...C.GEO.frame.projection });
  assert.deepEqual({ ...D.frame.detail }, { ...F });
  assert.match(D.source.licence, /Open Government Licence – Ontario/);
  assert.match(D.source.licence, /Open Government Licence – Toronto/);
  assert.ok(D.count > 40000 && D.count < 150000, `${D.count} trees`);
  const pin = JSON.parse(read('data/shared-toronto-data-pin.json')).datasets['trees/2'];
  assert.equal(pin.manifestCommit, D.source.manifestCommit);
  assert.equal(pin.tilesDigest, D.source.tilesDigest);
  const trees = unpack(D.trees, D.count, D.origin.x0, D.origin.z0);
  const ST = C.GEO.streetTrees, pts = [];
  for (let i = 0; i < ST.length; i += 4) pts.push([ST[i], ST[i + 1]]);
  const nearStreet = nearIndex(pts, 3.9);
  for (let i = 0; i < trees.length; i += 37) {
    const t = trees[i];
    assert.ok(t.x >= F.x0 && t.x < F.x1 && t.z >= F.z0 && t.z < F.z1);
    const b = C.blockAt(t.x, t.z);
    assert.ok(b, `a tree on the roadway at ${t.x}, ${t.z}`);
    assert.ok(!C.waterAt(t.x, t.z) && !C.buildingBoxAt(t.x, t.z, 0.9) && C.treeOffRail(t.x, t.z), `${t.x}, ${t.z}`);
    assert.ok(!nearStreet(t.x, t.z), `a tree beside a street tree at ${t.x}, ${t.z}`);
    assert.ok(t.h >= 3 && t.h <= 45.2 && t.r > 0 && t.r <= 12);
    assert.equal(t.park, b.park > 0.6);
    if (t.woods) assert.ok(t.park);
  }
});

test('at runtime the lidar trees replace the invented park & yard trees of the frame, and only those', () => {
  const ctx = vm.createContext({ window: { CITY: { GEO: C.GEO } }, console: { info() {}, warn() {} }, atob });
  vm.runInContext(read('js/lidar-trees-data.js'), ctx);
  vm.runInContext(read('js/lidar-trees.js'), ctx);
  const L = ctx.window.CITY.lidarTrees;
  const sites = [
    { x: 0, z: 0, tier: 0, scale: 1 }, { x: 10, z: 10, tier: 2, scale: 1 }, // invented, in the frame: replaced
    { x: F.x1 + 50, z: 0, tier: 0, scale: 1 }, // invented, outside the frame: kept
    { x: 5, z: 5, tier: 1, scale: 1 }, { x: 6, z: 6, tier: 0, model: 'ez-oak-large', height: 20 } // street tier, named: kept
  ];
  L.replaceTrees(sites, 0.15);
  assert.equal(L.stats.inventedReplaced, 2);
  assert.equal(sites.length, 3 + L.stats.drawn);
  assert.equal(L.stats.drawn, ctx.window.CITY.LIDAR_TREES_DATA.count);
  const lidar = sites.filter((t) => t.lidar);
  assert.ok(lidar.every((t) => t.model && t.height > 0 && t.width > 0 && (t.tier === 0 || t.tier === 2) && t.y === 0.15));
  // (another map's frame: nothing changes)
  const other = vm.createContext({ window: { CITY: { GEO: { ...C.GEO, frame: { ...C.GEO.frame, detail: { ...F, x1: F.x1 + 1 } } } } }, console: { info() {}, warn() {} }, atob });
  vm.runInContext(read('js/lidar-trees-data.js'), other);
  vm.runInContext(read('js/lidar-trees.js'), other);
  assert.equal(other.window.CITY.lidarTrees, undefined);
});

test('explore.html loads the lidar trees only with ?lidarTrees=1 on a desktop: the detail map\'s file, or the Eglinton map\'s cells', () => {
  const html = read('explore.html');
  assert.match(html, /params\.get\('lidarTrees'\) === '1' \? \[\.\.\.\(desktop && !eglinton \? \['\.\/js\/lidar-trees-data\.js'\] : \[\]\), '\.\/js\/lidar-trees\.js'\] : \[\]/);
  assert.match(html, /cityLidarCells: params\.get\('lidarTrees'\) === '1' && desktop && eglinton \}/);
  // the cells: fetched only when the loader says so, awaited with the geodata before any city script runs
  assert.match(html, /const cityLidarCells = cityAppScripts\.cityLidarCells\s*\? import\('\.\/js\/lidar-trees-cells\.js'\)/);
  const mod = html.slice(html.indexOf('Object.assign(window.CITY, await cityGeo);'));
  assert.ok(mod.indexOf('window.CITY.LIDAR_TREES_CELLS = await cityLidarCells') < mod.indexOf('for (const src of cityAppScripts)'));
  // the index by its hash, as the bake wrote it
  const v = html.match(/lidar-trees\/', 'index\.json\?v=([0-9a-f]{12})'/)[1];
  assert.equal(v, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'data/frames/eglinton/lidar-trees/index.json'))).digest('hex').slice(0, 12));
});

test('a default visit draws the trees main draws: nothing of this layer runs without the flag', () => {
  // (explore.html loads neither script without ?lidarTrees=1: tests/boot.test.cjs. Then CITY.lidarTrees is never set,
  // street-details.js's one call is guarded by it, and the new city-config.js buildingBoxAt is called by no runtime script)
  const sd = read('js/street-details.js');
  assert.deepEqual(sd.split('\n').filter((l) => l.includes('lidarTrees') && !l.trim().startsWith('//')).map((l) => l.trim()),
    ['if (window.CITY.lidarTrees) window.CITY.lidarTrees.replaceTrees(treePositions, SW_Y);']);
  assert.match(sd, /if \(window\.CITY\.lidarTrees\) window\.CITY\.lidarTrees\.replaceTrees\(treePositions, SW_Y\);/);
  for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js') && f !== 'city-config.js')) {
    assert.ok(!read(`js/${f}`).includes('buildingBoxAt'), f);
  }
});

test('with the flag on a phone, or with no bake or failed cells, the runtime changes nothing and says why', () => {
  for (const [cityAppScripts, extra, want] of [[{ cityDesktop: false }, {}, /desktop only/], [{ cityDesktop: true }, {}, /no lidar trees baked for this map/],
    [{ cityDesktop: true }, { LIDAR_TREES_CELLS: { error: '3_-2.bin: HTTP 404' } }, /cells did not load \(3_-2\.bin: HTTP 404\)/]]) {
    const said = [];
    const ctx = vm.createContext({ window: { CITY: { GEO: C.GEO, ...extra } }, console: { info: (m) => said.push(m), warn: (m) => said.push(m) }, atob, cityAppScripts });
    vm.runInContext(read('js/lidar-trees.js'), ctx);
    assert.equal(ctx.window.CITY.lidarTrees, undefined);
    assert.equal(said.length, 1);
    assert.match(said[0], want);
  }
});

// --- the bake on a fixture: one crown of each kind, written as the shared repo's trees/2 cells
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lidar-trees-'));
  const t2 = path.join(dir, 'trees2');
  fs.mkdirSync(path.join(t2, 'cells'), { recursive: true });
  const utmOf = (x, z) => { const q = C.latLonFromWorld(x, z); return utm17(q.lat, q.lon); };
  // (points of each kind, found in the committed city)
  const scan = (pred) => { for (let x = -3000; x < 3000; x += 7.3) for (let z = -2500; z < 3000; z += 11.1) if (pred(x, z)) return [x, z]; throw new Error('no point'); };
  const ST = C.GEO.streetTrees, sx = ST[400], sz = ST[401];
  const pts = [];
  for (let i = 0; i < ST.length; i += 4) pts.push([ST[i], ST[i + 1]]);
  const nearStreet = nearIndex(pts, 12);
  const yard = scan((x, z) => { const b = C.blockAt(x, z); if (!b || b.park > 0.1 || b.median || b.area < 8000) return false;
    const P = b.poly; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[j], c = P[i], ex = c.x - a.x, ez = c.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1))); if (Math.hypot(a.x + ex * t - x, a.z + ez * t - z) < 15) return false; }
    return !C.buildingBoxAt(x, z, 6) && !nearStreet(x, z) && !C.waterAt(x, z) && C.treeOffRail(x, z) && !C.bridgeAt(x, z, 2); });
  const road = scan((x, z) => !C.blockAt(x, z) && !C.waterAt(x, z) && !nearStreet(x, z) && C.treeOffRail(x, z) && !C.bridgeAt(x, z, 2));
  const woods = (() => { const D = C.HIGH_PARK_WOODS_DATA; const b = C.BLOCKS.find((q) => q.parkName === 'High Park' && q.cx > D.box.x0 && q.cx < D.box.x1 && q.cz > D.box.z0 && q.cz < D.box.z1 && q.area > 100000); return [b.cx, b.cz]; })();
  const bldg = (() => { for (const [cx, cz] of C.GEO.buildings) { if (cx > -3000 && cx < 3000 && C.blockAt(cx, cz) && C.buildingBoxAt(cx, cz, 0) && !nearStreet(cx, cz) && !C.waterAt(cx, cz) && C.treeOffRail(cx, cz)) return [cx, cz]; } throw new Error('no building'); })();
  const crowns = [
    ['kept', yard, 2, 14, 5], ['nearStreetTree', [sx + 1.5, sz], 2, 9, 3], ['roadway', road, 2, 8, 3], ['woodsLayer', woods, 2, 20, 6],
    ['building', bldg, 2, 10, 4], ['outsideFrame', [F.x1 + 200, 0], 2, 10, 4], ['notLidarOnly', [yard[0] + 30, yard[1]], 1, 12, 4]
  ];
  const cells = {};
  for (const [, [x, z], src, h, r] of crowns) {
    const [E, N] = utmOf(x, z), id = `${630250 + Math.floor((E - 630250) / 500) * 500}_${4833750 + Math.floor((N - 4833750) / 500) * 500}`;
    const c = cells[id] || (cells[id] = { count: 0, E: [], N: [], src: [], h: [], r: [], lE: [], lN: [], moved: [] });
    c.count++; c.E.push(E); c.N.push(N); c.src.push(src); c.h.push(h); c.r.push(r); c.lE.push(src === 1 ? E : null); c.lN.push(src === 1 ? N : null); c.moved.push(src === 2 ? null : 0);
  }
  for (const [id, c] of Object.entries(cells)) fs.writeFileSync(path.join(t2, 'cells', `${id}.json`), JSON.stringify(c));
  fs.writeFileSync(path.join(t2, 'index.json'), JSON.stringify({ cells: Object.fromEntries(Object.keys(cells).map((id) => [id, {}])) }));
  fs.writeFileSync(path.join(t2, 'manifest.json'), JSON.stringify({ dataset: 'trees/2', generatedAt: '2026-11-12T00:00:00Z', parameters: { cityDatum: 'nad83csrs-as-wgs84' },
    builder: { commit: '0123456789abcdef' }, inputs: { lidar: { tilesDigest: 'feedface' } }, files: { 'index.json': 'beef' } }));
  return { dir, t2, crowns };
}

test('the bake: each crown dropped by its rule or kept, the same bytes on a rebuild, a pin with no path, and no run without the dataset', () => {
  const { dir, t2 } = fixture();
  try {
    const run = (out) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'tools/build-lidar-trees.mjs'), '--trees2', t2, '--out', out, '--pin', path.join(dir, 'pin.json')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TORONTO_DATA_CACHE: '' } }));
    const a = run(path.join(dir, 'a.js')), b = run(path.join(dir, 'b.js'));
    assert.equal(a.kept, 1);
    assert.equal(a.lidarOnlyInFrame, 5);
    for (const rule of ['nearStreetTree', 'roadway', 'woodsLayer', 'building']) assert.equal(a.dropped[rule], 1, `${rule}: ${JSON.stringify(a.dropped)}`);
    assert.equal(a.streetTreesNotDrawnHere.streetMatched, 1);
    assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), fs.readFileSync(path.join(dir, 'b.js'), 'utf8'));
    assert.deepEqual({ ...b, out: null }, { ...a, out: null });
    const pin = fs.readFileSync(path.join(dir, 'pin.json'), 'utf8');
    assert.ok(!pin.includes(['', 'Users', ''].join('/')) && !pin.includes(os.homedir()) && !pin.includes(t2));
    assert.equal(JSON.parse(pin).datasets['trees/2'].manifestCommit, '0123456789abcdef');
    const none = spawnSync(process.execPath, [path.join(ROOT, 'tools/build-lidar-trees.mjs')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TORONTO_DATA_CACHE: '' } });
    assert.equal(none.status, 1);
    assert.match(none.stderr, /TORONTO_DATA_CACHE/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- the Eglinton map's cells (tools/build-lidar-trees.mjs --frame eglinton; data/frames/eglinton/lidar-trees/)
const EGL_DIR = path.join(ROOT, 'data/frames/eglinton/lidar-trees');
const eglIndex = () => JSON.parse(fs.readFileSync(path.join(EGL_DIR, 'index.json'), 'utf8'));
const eglCells = () => eglIndex().cells.map((c) => ({ ...c, data: new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(EGL_DIR, c.file)))) }));

test('the Eglinton cells: baked for that map\'s frame, one file per 1,200 m cell, each as the index says, the trees inside it', async () => {
  const I = eglIndex();
  const { GEO } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/frames/eglinton/toronto-geodata.bin')));
  assert.equal(I.frame.name, 'eglinton');
  assert.deepEqual(I.frame.detail, GEO.frame.detail);
  assert.deepEqual(I.frame.projection, GEO.frame.projection);
  assert.equal(I.cell, CELL_M);
  const files = fs.readdirSync(EGL_DIR).filter((f) => f.endsWith('.bin')).sort();
  assert.deepEqual(I.cells.map((c) => c.file).sort(), files, 'no stray cell file, none missing');
  let n = 0;
  const B = I.frame.detail;
  for (const c of I.cells) {
    const gz = fs.readFileSync(path.join(EGL_DIR, c.file));
    assert.equal(crypto.createHash('sha256').update(gz).digest('hex'), c.sha256, c.file);
    assert.equal(gz.length, c.bytes);
    const [i, j] = c.file.replace('.bin', '').split('_').map(Number);
    assert.deepEqual([c.x0, c.z0], [i * CELL_M, j * CELL_M]);
    const trees = unpack(zlib.gunzipSync(gz), c.count, c.x0, c.z0);
    for (const t of trees) {
      assert.deepEqual(cellOf(t.x, t.z), [i, j], c.file);
      assert.ok(t.x >= B.x0 && t.x < B.x1 && t.z >= B.z0 && t.z < B.z1);
    }
    n += c.count;
  }
  assert.equal(n, I.counts.kept);
  assert.ok(n > 200000, `${n} trees`);
  // (the core against the detail map's bake: the same lidar, so all but a few drop decisions agree)
  const k = I.coreAgainstDetailBake;
  assert.ok(k.inBoth / (k.inBoth + k.onlyThisMap + k.onlyDetailMap) > 0.99, JSON.stringify(k));
  const pin = JSON.parse(read('data/shared-toronto-data-pin.json')).datasets['trees/2'];
  assert.equal(pin.eglinton.indexSha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(EGL_DIR, 'index.json'))).digest('hex'));
  assert.equal(pin.eglinton.trees, n);
  assert.equal(I.rules.dropYardUnderM, undefined, 'the small-tree switch is off in what ships');
  assert.equal(JSON.parse(read('js/lidar-trees-data.js').match(/LIDAR_TREES_DATA = (\{.*\});/)[1]).rules.dropYardUnderM, undefined);
});

test('at runtime on the Eglinton map the cells replace the invented trees there, and a detail-frame bake changes nothing', async () => {
  const { GEO } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/frames/eglinton/toronto-geodata.bin')));
  const I = eglIndex(), cells = eglCells();
  const said = [];
  const ctx = vm.createContext({ window: { CITY: { GEO, LIDAR_TREES_CELLS: { ...I, cells, load: { ms: 5, bytes: 1, files: cells.length + 1 } } } }, console: { info: (m) => said.push(m), warn: (m) => said.push(m) }, atob });
  vm.runInContext(read('js/lidar-trees.js'), ctx);
  const L = ctx.window.CITY.lidarTrees;
  const sites = [{ x: 500, z: -6000, tier: 2, scale: 1 }, { x: 9700, z: 0, tier: 0, scale: 1 }];
  L.replaceTrees(sites, 0.2);
  assert.equal(L.stats.baked, I.counts.kept);
  assert.equal(L.stats.drawn, I.counts.kept); // (no hand-built areas or sports grounds loaded in this context)
  assert.equal(L.stats.inventedReplaced, 1);
  assert.equal(L.stats.cells, I.cells.length);
  assert.match(said.at(-1), new RegExp(`${I.counts.kept} lidar trees of ${I.counts.kept} baked \\(${I.cells.length} cells`));
  // (the detail map's frame: the Eglinton cells stay off, and the detail bake stays off on the Eglinton map)
  const a = vm.createContext({ window: { CITY: { GEO: C.GEO, LIDAR_TREES_CELLS: { ...I, cells } } }, console: { info() {}, warn() {} }, atob });
  vm.runInContext(read('js/lidar-trees.js'), a);
  assert.equal(a.window.CITY.lidarTrees, undefined);
  const b = vm.createContext({ window: { CITY: { GEO } }, console: { info() {}, warn() {} }, atob });
  vm.runInContext(read('js/lidar-trees-data.js'), b);
  vm.runInContext(read('js/lidar-trees.js'), b);
  assert.equal(b.window.CITY.lidarTrees, undefined);
});

test('the cell loader fetches the index, then every cell by its hash; any failure is reported, never thrown', async () => {
  const { loadCells } = await import('../js/lidar-trees-cells.js');
  const real = globalThis.fetch, asked = [];
  const serve = (missing) => async (url) => {
    asked.push(url);
    const f = url.replace('./data/frames/eglinton/lidar-trees/', '').replace(/\?v=.*$/, '');
    if (f === missing) return new Response('no', { status: 404 });
    return new Response(fs.readFileSync(path.join(EGL_DIR, f)));
  };
  try {
    globalThis.fetch = serve(null);
    const I = eglIndex();
    const got = await loadCells('./data/frames/eglinton/lidar-trees/', 'index.json?v=abc');
    assert.equal(got.error, undefined);
    assert.equal(got.cells.length, I.cells.length);
    assert.equal(got.load.files, I.cells.length + 1);
    assert.equal(asked.length, I.cells.length + 1);
    for (const [k, c] of got.cells.entries()) {
      assert.equal(c.data.length, I.cells[k].count * 7);
      assert.ok(asked.includes(`./data/frames/eglinton/lidar-trees/${c.file}?v=${c.sha256.slice(0, 12)}`));
    }
    globalThis.fetch = serve(I.cells[3].file);
    const bad = await loadCells('./data/frames/eglinton/lidar-trees/', 'index.json?v=abc');
    assert.match(bad.error, new RegExp(`${I.cells[3].file}: HTTP 404`));
  } finally {
    globalThis.fetch = real;
  }
});

test('yard heights count the kept trees off the park islands, by height band', () => {
  const y = yardHeights([{ h: 3, park: false }, { h: 4.5, park: false }, { h: 6, park: false }, { h: 12, park: false }, { h: 2, park: true }]);
  assert.deepEqual(y, { under4: 1, from4to5: 1, from5to7: 1, from7: 1, yards: 4, shareUnder5: 0.5 });
  const t = [{ x: 1.25, z: -2.5, h: 9.2, r: 3.1, model: 4, woods: false, park: true }];
  assert.deepEqual(unpack(packBytes(t, 0, -1200), 1, 0, -1200), unpack(pack(t, 0, -1200), 1, 0, -1200));
});

test('the Eglinton bake on the fixture: cell files and index, the same bytes on a rebuild, its pin entry beside the detail one; the small-tree switch', () => {
  const { dir, t2, crowns } = fixture();
  try {
    const pin = path.join(dir, 'pin.json');
    const run = (out, ...more) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'tools/build-lidar-trees.mjs'), '--trees2', t2, '--out', out, '--pin', pin, ...more], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TORONTO_DATA_CACHE: '' } }));
    const d = run(path.join(dir, 'd.js'));
    const a = run(path.join(dir, 'a'), '--frame', 'eglinton'), b = run(path.join(dir, 'b'), '--frame', 'eglinton');
    // (the detail frame's outside crown, east of it, is inside the Eglinton frame: 6 lidar-only crowns there, not 5)
    assert.equal(d.lidarOnlyInFrame, 5);
    assert.equal(a.lidarOnlyInFrame, 6);
    assert.equal(a.dropped.woodsLayer, 1);
    const yard = crowns.find(([k]) => k === 'kept')[1];
    const files = (o) => fs.readdirSync(path.join(dir, o)).sort();
    assert.deepEqual(files('a'), files('b'));
    for (const f of files('a')) assert.ok(fs.readFileSync(path.join(dir, 'a', f)).equals(fs.readFileSync(path.join(dir, 'b', f))), f);
    const I = JSON.parse(fs.readFileSync(path.join(dir, 'a', 'index.json'), 'utf8'));
    assert.equal(I.cells.reduce((n, c) => n + c.count, 0), a.kept);
    const all = I.cells.flatMap((c) => unpack(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'a', c.file))), c.count, c.x0, c.z0));
    assert.ok(all.some((t) => Math.hypot(t.x - yard[0], t.z - yard[1]) < 0.3), 'the yard crown is in its cell');
    assert.equal(I.counts.yardHeightsM.yards, all.filter((t) => !t.park).length);
    // (one pin, both frames: the Eglinton bake kept the detail entry it found)
    const p = JSON.parse(fs.readFileSync(pin, 'utf8')).datasets['trees/2'];
    assert.deepEqual(p.bakedInto, ['js/lidar-trees-data.js']);
    assert.ok(p.dataSha256 && p.eglinton.indexSha256 && p.eglinton.cells === I.cells.length);
    assert.ok(!fs.readFileSync(pin, 'utf8').includes(os.homedir()));
    // (the switch: off unless given; with it, the 14 m yard crown goes under 15 m, and the run says so)
    assert.equal(I.rules.dropYardUnderM, undefined);
    const s = run(path.join(dir, 's'), '--frame', 'eglinton', '--drop-yard-under', '15');
    assert.equal(s.smallYardDropped, a.yardHeightsM.yards - s.yardHeightsM.yards);
    assert.ok(s.smallYardDropped >= 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 's', 'index.json'), 'utf8')).rules.dropYardUnderM, 15);
    const bad = spawnSync(process.execPath, [path.join(ROOT, 'tools/build-lidar-trees.mjs'), '--trees2', t2, '--frame', 'york'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(bad.status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
