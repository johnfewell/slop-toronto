import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { cafeto, addressStreet } from '../tools/build-cafeto.mjs';
import { loadPatioWorld } from '../tools/cafeto-world.mjs';
import { loadReplayWorld, replayPatios } from '../tools/patio-replay.mjs';
import { buildPatios, sourceHashes, PATIOS_JS, PATIO_INPUTS } from '../tools/build-patios.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const geo = { window: { CITY: {} } };
vm.runInNewContext(read('js/toronto-geodata.js'), geo);
const frame = geo.window.CITY.GEO.frame;
const snapshotFile = fs.readdirSync(new URL('../tools/data', import.meta.url)).filter((f) => /^cafeto-\d{8}\.json$/.test(f)).sort().pop();
const snapshot = JSON.parse(read(`tools/data/${snapshotFile}`));
const layout = { window: { CITY: {} }, console };
vm.runInNewContext(read('js/patio-layout.js'), layout);
const { patioSites, PATIO_RULES } = layout.window.CITY;
const runtime = { window: { CITY: { THREE: {}, CITY_BOUNDS: { sidewalkHeight: 0.22 } } }, console };
vm.runInNewContext(read('js/cafeto-patios.js'), runtime);
const { patioSeason, patioFingerprint, patioInputs, builtPatioSites, patioSiteRow, PATIO_SITE_FIELDS } = runtime.window.CITY;

test('the CaféTO snapshot keeps its provenance and every intervention type, clipped to the detailed city', () => {
  assert.match(snapshot.source.page, /open\.toronto\.ca\/dataset\/cafeto-curb-lane-parklet-cafe-locations/);
  assert.ok(snapshot.source.resourceId && snapshot.source.sha256 && snapshot.source.fetchedAt && snapshot.source.licence);
  const data = cafeto(snapshot, frame);
  assert.deepEqual(data.counts, { total: 1636, outside: 695, private: 364, sidewalk: 386, curb: 191 });
  assert.equal(data.records.length, 386 + 191);
  assert.ok(data.records.every((r) => r.type === 'sidewalk' || r.type === 'curb'), 'private property patios are never records');
  assert.equal(new Set(data.records.map((r) => r.id)).size, data.records.length);
  assert.ok(data.records.every((r) => r.street && Number.isFinite(r.x) && Number.isFinite(r.z)));
  // the committed layer is this build, byte for byte
  const out = {};
  vm.runInNewContext(read('js/toronto-cafeto.js'), { window: out });
  assert.deepEqual(JSON.parse(JSON.stringify(out.CITY.CAFETO)), JSON.parse(JSON.stringify(data)));
});

test('incomplete, duplicate or unknown records cannot produce patios', () => {
  assert.throws(() => cafeto({ ...snapshot, features: [] }, frame), /Incomplete/);
  const dup = structuredClone(snapshot);
  dup.features[1].properties.LICENCE_NUMBER = dup.features[0].properties.LICENCE_NUMBER;
  assert.throws(() => cafeto(dup, frame), /duplicate/);
  const odd = structuredClone(snapshot);
  odd.features[0].properties.INTERVENTION_TYPE = 'Parklet';
  assert.throws(() => cafeto(odd, frame), /Unknown/);
});

test('addresses name their street', () => {
  assert.equal(addressStreet('660 COLLEGE ST'), 'COLLEGE ST');
  assert.equal(addressStreet('101-103 RONCESVALLES AVE'), 'RONCESVALLES AVE');
  assert.equal(addressStreet('1008 - 1010 QUEEN ST E'), 'QUEEN ST E');
  assert.equal(addressStreet('3 & 3A WESTMORELAND AVE'), 'WESTMORELAND AVE');
  assert.equal(addressStreet('10-12 COLLEGE ST (CONFIRMED ADDRESS: 450 YONGE ST)'), 'COLLEGE ST');
  assert.equal(addressStreet('300 SIMCOE ST, MAIN'), 'SIMCOE ST');
});

test('the CaféTO season holds the scene date (22 August) and not the winter', () => {
  assert.equal(patioSeason({ month: 8, day: 22 }), true);
  assert.equal(patioSeason({ month: 6, day: 1 }), true);
  assert.equal(patioSeason({ month: 10, day: 1 }), false);
  assert.equal(patioSeason({ month: 1, day: 15 }), false);
});

// A straight two-way street along +x (z = 0), 12 m curb to curb, sidewalks 5 m deep to the building faces, an
// island running x = -80..80 between cross streets 16 m wide
function street({ sidewalk = 5, width = 12, roadName = 'Test Street', extra = {} } = {}) {
  const half = width / 2, north = { id: 1 }, south = { id: 2 };
  const road = { name: roadName, w: width, dir: 0, rank: 2, raised: false };
  return {
    nearestRoads: (x, z) => [{ road, dist: Math.abs(z), dx: 1, dz: 0, px: x, pz: 0 }],
    blockAt: (x, z) => (Math.abs(x) > 80 && Math.abs(x) < 96 ? null : z > half && z < 60 ? north : z < -half && z > -60 ? south : null),
    buildingAt: (x, z) => Math.abs(z) >= half + sidewalk && Math.abs(z) < 60 && Math.abs(x) < 80,
    onSidewalk: () => null,
    ...extra
  };
}
const rec = (type, x, z, street = 'TEST ST', id = `${type}-${x}-${z}`) => ({ id, type, street, x, z });

test('a sidewalk café stands against the building face on its frontage, leaving the clearway to the curb', () => {
  const out = patioSites([rec('sidewalk', 0, 20)], street());
  assert.equal(out.sites.length, 1);
  const s = out.sites[0];
  assert.equal(s.kind, 'sidewalk');
  const wallSide = s.cz + s.depth / 2, roadSide = s.cz - s.depth / 2;
  assert.ok(Math.abs(wallSide - (11 - 0.3)) < 0.11, 'against the face');
  assert.ok(roadSide - 6 >= PATIO_RULES.clearway + PATIO_RULES.curbSetback - 1e-6, 'the clearway and the curb setback stay open');
  assert.ok(s.depth >= PATIO_RULES.sidewalkDepthMin && s.depth <= PATIO_RULES.sidewalkDepthMax);
  // a 3 m sidewalk cannot keep a 2.1 m clearway: rejected, never squeezed
  assert.deepEqual(patioSites([rec('sidewalk', 0, 20)], street({ sidewalk: 3 })).rejected.narrow, 1);
  // a hydrant in the clearway's furniture zone pushes it, a tree in the footprint rejects it
  const tree = patioSites([rec('sidewalk', 0, 20)], street({ extra: { obstacles: [{ x: 0, z: 10.2, kind: 'tree', size: 0.6, curbClear: 0 }] } }));
  assert.ok(tree.sites.length === 0 || Math.abs(tree.sites[0].cx) >= 1.5, 'slides along the frontage or gives up');
});

test('records are placed only on their own street, and private property patios never', () => {
  const out = patioSites([rec('sidewalk', 0, 20, 'OTHER AVE'), rec('private', 0, 20)], street());
  assert.equal(out.sites.length, 0);
  assert.equal(out.rejected.frontage, 1);
  assert.equal(out.rejected.unsupported, 1);
});

test('a curb lane café is a platform in the curb lane, clear of the traffic lanes, the curb and the bikeway', () => {
  const out = patioSites([rec('curb', 0, 20)], street({ width: 15 }));
  assert.equal(out.sites.length, 1);
  const s = out.sites[0];
  assert.equal(s.kind, 'curb');
  assert.ok(s.cz + s.depth / 2 <= 7.5 - PATIO_RULES.curbGap + 0.02, 'on the roadway, the gutter open');
  assert.ok(s.cz - s.depth / 2 >= 1.8 + PATIO_RULES.carClear - 1e-6, "clear of the game's lane");
  // a 10 m street has no room beside its lanes
  assert.equal(patioSites([rec('curb', 0, 20)], street({ width: 10 })).rejected.lane, 1);
  assert.equal(patioSites([rec('curb', 0, 20)], street({ width: 15, extra: { bikewayAt: (x, z) => z > 5.5 } })).rejected.bikeway, 1);
  assert.equal(patioSites([rec('curb', 0, 20)], street({ width: 15, extra: { railDist: (x, z) => Math.abs(z - 4) } })).rejected.streetcar, 1);
});

test('curb lane cafés keep the City setbacks from intersections, transit stops and hydrants, by direction of travel', () => {
  const w = { width: 15 };
  // +z is the right of +x here (road-network.js's right normal), so the z > 0 curb lane runs toward +x: x = 80 is the
  // junction it approaches, x = -80 the one it has passed
  assert.equal(patioSites([rec('curb', 60, 20)], street(w)).sites.length, 1, '16 m short of an unsignalised junction');
  const signal = { junctions: [{ x: 88, z: 0 }] };
  assert.equal(patioSites([rec('curb', 60, 20)], street({ ...w, extra: signal })).rejected.junction, 1, 'within 30.5 m of a signal ahead');
  assert.equal(patioSites([rec('curb', -60, 20)], street({ ...w, extra: signal })).sites.length, 1, 'beyond the far junction by 9 m+');
  assert.equal(patioSites([rec('curb', -76, 20)], street(w)).rejected.junction, 1, 'within 9 m beyond a junction, even slid along');
  // a stop 20 m ahead (toward +x) is too close; 20 m behind is fine
  assert.equal(patioSites([rec('curb', 0, 20)], street({ ...w, extra: { stops: [{ x: 24, z: 8 }] } })).rejected.stop, 1);
  assert.equal(patioSites([rec('curb', 0, 20)], street({ ...w, extra: { stops: [{ x: -24, z: 8 }] } })).sites.length, 1);
  // a hydrant at the curb needs 1.2 m from the platform: it slides along or gives up
  const hydrant = { obstacles: [{ x: 0, z: 8, kind: 'hydrant', size: 0.25, curbClear: 1.2 }] };
  const h = patioSites([rec('curb', 0, 20)], street({ ...w, extra: hydrant }));
  assert.ok(h.sites.every((s) => Math.abs(s.cx) - s.length / 2 >= 1.2 + 0.25 - 1e-6));
});

test('neighbouring curb lane platforms may run end to end; sidewalk cafés never overlap', () => {
  const out = patioSites([rec('curb', 0, 20, 'TEST ST', 'a'), rec('curb', 6, 20, 'TEST ST', 'b')], street({ width: 15 }));
  assert.equal(out.sites.length, 2);
  const [a, b] = out.sites;
  assert.ok(Math.abs(a.cx - b.cx) >= (a.length + b.length) / 2 - 0.05);
  const side = patioSites([rec('sidewalk', 0, 20, 'TEST ST', 'a'), rec('sidewalk', 1, 20, 'TEST ST', 'b')], street());
  for (const s of side.sites.slice(1)) assert.ok(Math.abs(s.cx - side.sites[0].cx) >= (s.length + side.sites[0].length) / 2 + 0.4 - 1e-6);
});

test('on the real city: every placed patio keeps its footprint rules and clears furniture, stops and each other', () => {
  const { CITY, deps, records } = loadPatioWorld();
  const out = CITY.patioSites(records, deps);
  const kinds = (k) => out.sites.filter((s) => s.kind === k).length;
  // (the counts are this snapshot's; a rule or data change must update them knowingly)
  assert.deepEqual({ sidewalk: kinds('sidewalk'), curb: kinds('curb') }, { sidewalk: 71, curb: 118 });
  assert.equal(Object.values(out.rejected).reduce((a, b) => a + b, 0) + out.sites.length, records.length);
  const corners = (s) => [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([a, b]) => [s.cx + s.tx * a * s.length / 2 + s.nx * b * s.depth / 2, s.cz + s.tz * a * s.length / 2 + s.nz * b * s.depth / 2]);
  for (const s of out.sites) {
    const pts = corners(s);
    if (s.kind === 'curb') assert.ok(pts.every(([x, z]) => !deps.blockAt(x, z)), `${s.id} on the roadway`);
    else {
      const block = deps.blockAt(s.cx, s.cz);
      assert.ok(block && pts.every(([x, z]) => deps.blockAt(x, z) === block && !deps.buildingAt(x, z)), `${s.id} on one island, off the buildings`);
      assert.ok(s.inner - s.curb >= PATIO_RULES.clearway + PATIO_RULES.curbSetback - 1e-6, `${s.id} keeps the clearway`);
    }
    for (const o of deps.obstacles) {
      const d = Math.hypot(o.x - s.cx, o.z - s.cz);
      if (d > 12) continue;
      if (o.kind === 'hydrant') assert.ok(d > 0.8, `${s.id} clear of hydrant`);
      if (['bench', 'parkingMeter', 'wayfinding', 'infoPillar', 'shelter'].includes(o.kind)) {
        const dx = o.x - s.cx, dz = o.z - s.cz;
        const inside = Math.abs(dx * s.tx + dz * s.tz) < s.length / 2 + o.size && Math.abs(dx * s.nx + dz * s.nz) < s.depth / 2 + o.size;
        assert.ok(!inside, `${s.id} clear of ${o.kind}`);
      }
    }
  }
  // the aerial-checked Ossington platforms (2025 City orthophoto, docs/cafeto-patios.md)
  const byAddress = (a) => out.sites.find((s) => s.address === a);
  for (const a of ['146 OSSINGTON AVE', '188 OSSINGTON AVE', '72 OSSINGTON AVE', '225 OSSINGTON AVE']) assert.equal(byAddress(a)?.kind, 'curb', a);
});

test('explore.html loads the layer and its prebuilt layout before the builder, not the rules', () => {
  const html = read('explore.html');
  const i = (f) => html.indexOf(`'./js/${f}'`);
  assert.ok(i('toronto-cafeto.js') > 0 && i('toronto-patios.js') > i('toronto-cafeto.js') && i('cafeto-patios.js') > i('toronto-patios.js'));
  assert.ok(i('cafeto-patios.js') > i('city-config.js') && i('cafeto-patios.js') < i('road-network.js'));
  // the rules load only to lay the patios out again (?patios=layout|check, or stale inputs): the builder names them
  assert.equal(i('patio-layout.js'), -1, 'js/patio-layout.js does not run at startup');
  assert.match(read('js/cafeto-patios.js'), /'\.\/js\/patio-layout\.js'/, 'the build ships it, fingerprinted, for the builder to load');
});

// The prebuilt layout (st-cmf): js/toronto-patios.js holds what js/patio-layout.js placed in the browser, and
// tools/data/patio-inputs.json the runtime inputs it met there that node cannot rebuild (docs/cafeto-patios.md)
const PATIOS = (() => { const c = { window: {} }; vm.runInNewContext(read(PATIOS_JS), c); return c.window.CITY.PATIOS; })();
const recorded = JSON.parse(read(PATIO_INPUTS));

test('the prebuilt patio layout is the runtime algorithm\'s: node replays js/patio-layout.js on the committed data to the same sites, counts and reasons', () => {
  const world = loadReplayWorld();
  const replay = replayPatios(world, recorded);
  const sorted = (o) => JSON.stringify(Object.entries(o).sort());
  assert.equal(JSON.stringify(PATIOS.fields), JSON.stringify(PATIO_SITE_FIELDS));
  assert.equal(replay.sites.length, PATIOS.sites.length);
  for (let i = 0; i < replay.sites.length; i++) assert.equal(JSON.stringify(replay.sites[i]), JSON.stringify(PATIOS.sites[i]), `site ${i} (${PATIOS.sites[i][0]})`);
  assert.equal(sorted(replay.rejected), sorted(PATIOS.rejected));
  assert.equal(sorted(replay.blockers), sorted(PATIOS.blockers));
  assert.equal(sorted(replay.reasons), sorted(recorded.reasons));
  assert.equal(Object.values(PATIOS.rejected).reduce((a, b) => a + b, 0) + PATIOS.sites.length, world.records.length);
  // and the generator, given the same record, writes the very files committed (deterministic)
  const dump = { fingerprint: PATIOS.fingerprint, fields: PATIOS.fields, sites: PATIOS.sites, rejected: PATIOS.rejected,
    blockers: PATIOS.blockers, reasons: recorded.reasons, replay: { furniture: recorded.furniture, colliders: recorded.colliders } };
  const built = buildPatios(dump, { world });
  assert.equal(built.js, read(PATIOS_JS));
  assert.equal(built.inputs, read(PATIO_INPUTS));
});

test('the prebuilt patio layout was built from the committed sidewalks, poles, geodata and furniture', () => {
  // a data script the layout reads (directly, or through the colliders & furniture it met) changed: rebuild the layout
  const now = sourceHashes();
  const stale = Object.keys(now).filter((rel) => recorded.sources[rel] !== now[rel]);
  assert.deepEqual(stale, [], `rebuild js/toronto-patios.js (tools/build-patios.mjs): ${stale.join(', ')} changed`);
});

test('the page builds the prebuilt sites over their CaféTO records, the fields it reads intact', () => {
  const records = vm.runInNewContext(`${read('js/toronto-cafeto.js')}; window.CITY.CAFETO.records`, { window: {} });
  const sites = builtPatioSites(PATIOS, records);
  assert.equal(sites.length, PATIOS.sites.length);
  sites.forEach((s, i) => assert.equal(JSON.stringify(patioSiteRow(s)), JSON.stringify(PATIOS.sites[i])));
  for (const s of sites) {
    const rec = records.find((r) => r.id === s.id);
    assert.equal(s.address, rec.address);
    assert.ok(s.kind === 'curb' || s.kind === 'sidewalk');
    assert.ok([s.cx, s.cz, s.tx, s.tz, s.nx, s.nz, s.length, s.depth, s.entrance].every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(s.tx, s.tz) - 1) < 1e-9 && Math.abs(s.tx * s.nx + s.tz * s.nz) < 1e-9);
  }
  // the aerial-checked Ossington platforms (docs/cafeto-patios.md) and the capture fixtures' cafés
  for (const a of ['146 OSSINGTON AVE', '188 OSSINGTON AVE', '72 OSSINGTON AVE', '225 OSSINGTON AVE', '874 QUEEN ST W', '611 COLLEGE ST']) {
    assert.equal(sites.find((s) => s.address === a)?.kind, 'curb', a);
  }
  for (const a of ['660 COLLEGE ST', '309 KING ST W', '494 DANFORTH AVE']) assert.equal(sites.find((s) => s.address === a)?.kind, 'sidewalk', a);
  assert.throws(() => builtPatioSites({ sites: [['no-such-licence', ...PATIOS.sites[0].slice(1)]] }, records), /no CaféTO record/);
});

test('the runtime inputs fingerprint is order-free and sees a 0.1 mm move, near the cafés only', () => {
  const a = [[1, 2, 'pole'], [3, 4.5]], b = [[3, 4.5], [1, 2, 'pole']];
  assert.equal(patioFingerprint(a), patioFingerprint(b));
  assert.notEqual(patioFingerprint(a), patioFingerprint([[1, 2.0001, 'pole'], [3, 4.5]]));
  assert.notEqual(patioFingerprint(a), patioFingerprint([[1, 2, 'post'], [3, 4.5]]));
  assert.match(patioFingerprint(a), /^2:[0-9a-f]{16}$/);
  const records = [{ x: 0, z: 0 }];
  const box = (x, z, extra = {}) => ({ minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2, maxY: 9, ...extra });
  const CITY = { sidewalkPieceMap: new Map([[1, [{ outer: [{ x: 1, z: 1 }, { x: 2, z: 1 }, { x: 2, z: 2 }], holes: [] }]]]) };
  const base = patioInputs(CITY, records, [box(10, 10), box(500, 500), box(12, 0, { maxY: 0.5 })], [{ x: 5, z: 5, kind: 'bench' }, { x: 900, z: 0, kind: 'bench' }]);
  assert.equal(base.colliders.length, 1, 'far colliders and low ones (kerbs) are not inputs');
  assert.equal(base.furniture.length, 1);
  assert.match(base.fingerprint.sidewalks, /^1:/);
  const moved = patioInputs(CITY, records, [box(10, 10.001), box(500, 500)], [{ x: 5, z: 5, kind: 'bench' }]);
  assert.notEqual(moved.fingerprint.colliders, base.fingerprint.colliders);
  assert.equal(moved.fingerprint.furniture, base.fingerprint.furniture);
  const far = patioInputs(CITY, records, [box(10, 10), box(600, 500)], [{ x: 5, z: 5, kind: 'bench' }, { x: 990, z: 0, kind: 'bench' }]);
  assert.deepEqual(far.fingerprint, base.fingerprint, 'what changes far from every café leaves the layout valid');
});

test('every café gets its tables, clear of the door', () => {
  const ctx = { window: { CITY: { THREE: {}, CITY_BOUNDS: { sidewalkHeight: 0.22 } } }, console };
  vm.runInNewContext(read('js/cafeto-patios.js'), ctx);
  const spots = ctx.window.CITY.patioTableSpots;
  assert.deepEqual([...spots(-3.18, 3.18, 0)], [-1.75, 1.75]);
  // a 4.5 m café with its door in the middle: one set beside the door, inside the railing
  const short = spots(-1.95, 1.95, 0);
  assert.equal(short.length, 1);
  assert.ok(Math.abs(short[0]) >= 0.95 && Math.abs(short[0]) <= 1.95 - 0.6 + 1e-9);
  for (const door of [-2, -1, 0, 0.5, 1.7]) assert.ok(spots(-1.95, 1.95, door).length >= 1, `door at ${door}`);
});
