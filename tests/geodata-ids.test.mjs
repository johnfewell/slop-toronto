import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { osmKey, byOsmKey, massingKey, byMassingRecord, faceOf, parseFaceId, checkAliases, assertUnique, idResolver } from '../tools/geo-ids.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const loadCity = (file) => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  return context.window.CITY;
};

test('the committed identity sidecar is aligned with the committed geodata, row for row', () => {
  const { GEO } = loadCity('js/toronto-geodata.js');
  const { GEO_IDS: IDS } = loadCity('js/toronto-geodata-ids.js');
  const hash = createHash('sha256').update(fs.readFileSync(path.join(root, 'js/toronto-geodata.js'))).digest('hex').slice(0, 16);
  assert.equal(IDS.geodata, hash, 'sidecar names the geodata it was built with');
  assert.equal(IDS.schema, 1);
  assert.equal(IDS.pois.length, GEO.pois.length);
  assert.equal(IDS.buildings.length, GEO.buildings.length);
  assert.equal(IDS.buildingOsm.length, GEO.buildings.length);
  const places = assertUnique('place', IDS.pois), buildings = assertUnique('building', IDS.buildings);
  assert.ok(IDS.pois.every((id) => /^osm:(node|way|relation)\/\d+$/.test(id)));
  assert.ok(IDS.buildings.every((id) => /^to-3dmassing-2025:\d+(\.\d+)?$/.test(id)));
  assert.ok(IDS.buildingOsm.every((id) => id === '' || /^osm:(way|relation)\/\d+$/.test(id)));
  for (const [dup, kept] of Object.entries(IDS.poiAliases)) {
    assert.ok(!places.has(dup), `${dup} is left out, not a row`);
    assert.ok(places.has(kept), `${dup} resolves to a live place`);
  }
  assert.deepEqual(Object.keys(IDS.landmarks).sort(), Object.keys(GEO.landmarks).sort());
  assert.ok(Object.values(IDS.landmarks).every((id) => /^osm:(node|way|relation)\/\d+$/.test(id)));
  checkAliases(IDS.aliases, new Set([...places.keys(), ...buildings.keys()]));
});

test('committed transit patterns carry unique source identities', () => {
  const T = loadCity('js/toronto-transit.js').GEO_TRANSIT;
  const ids = T.patterns.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of T.patterns) {
    const [, rid, d, t] = /^ttc:([^:]+):([01]):([013]):[0-9a-f]{10}(?::[\w-]+)?$/.exec(p.id) || [];
    assert.ok(rid, `${p.id} has the documented form`);
    assert.equal(+d, p.d);
    assert.equal(+t, p.t);
    assert.equal(T.routes[p.r][0], rid, 'TTC route IDs are their route numbers in this feed');
  }
});

test('source order sorts are total and independent of the order elements arrive in', () => {
  const els = [{ type: 'way', id: 5 }, { type: 'node', id: 9 }, { type: 'relation', id: 3, osmType: 'way' }, { type: 'relation', id: 7 }, { type: 'node', id: 2 }];
  const want = ['osm:node/2', 'osm:node/9', 'osm:relation/7', 'osm:way/3', 'osm:way/5'];
  for (let k = 0; k < 20; k++) {
    const shuffled = [...els].sort(() => Math.random() - 0.5);
    assert.deepEqual(shuffled.sort(byOsmKey).map(osmKey), want);
  }
  const parts = [{ fid: 9 }, { fid: 4, k: 1 }, { fid: 4, k: 0 }, { fid: 1 }];
  assert.deepEqual(parts.sort(byMassingRecord).map((p) => massingKey('to-3dmassing-2025', p)),
    ['to-3dmassing-2025:1', 'to-3dmassing-2025:4.0', 'to-3dmassing-2025:4.1', 'to-3dmassing-2025:9']);
});

test('face IDs resolve to the wall on that side, left to right as seen from outside', () => {
  // 20 m (x) by 10 m (z) at (100, 50), unrotated: local u = +x, v = +z
  const b = [100, 50, 0, [[-10, 10, -5, 5]], 12];
  const n = faceOf(b, 'n'), e = faceOf(b, 'e'), s = faceOf(b, 's'), w = faceOf(b, 'w');
  const close = (p, q) => assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9, `${p} ~ ${q}`);
  // (standing north of it facing south, west is on the right)
  close(n.normal, [0, -1]); close(n.a, [110, 45]); close(n.b, [90, 45]);
  close(s.normal, [0, 1]); close(s.a, [90, 55]); close(s.b, [110, 55]);
  close(e.normal, [1, 0]); close(e.a, [110, 55]); close(e.b, [110, 45]);
  close(w.normal, [-1, 0]); close(w.a, [90, 45]); close(w.b, [90, 55]);
  assert.equal(n.width, 20); assert.equal(e.width, 10); assert.equal(n.height, 12);
  // multi-part plans: the face spans the plan's extent on that side
  assert.equal(faceOf([0, 0, 0, [[-10, 0, -5, 5], [0, 4, -2, 2]], 6], 'e').width, 10);
  // turned 30°: each side still has one wall; turned 45° ± 5°: no reliable compass side
  const turned = [0, 0, Math.PI / 6, [[-10, 10, -5, 5]], 6];
  assert.deepEqual(new Set(['n', 'e', 's', 'w'].map((k) => faceOf(turned, k).normal.map((v) => v.toFixed(6)).join())).size, 4);
  for (const yaw of [Math.PI / 4, Math.PI / 4 + 0.07, -Math.PI / 4]) assert.equal(faceOf([0, 0, yaw, [[-10, 10, -5, 5]], 6], 'n'), null);
  assert.equal(faceOf(b, 'x'), null);
  assert.deepEqual(parseFaceId('to-3dmassing-2025:4567.1:s'), { building: 'to-3dmassing-2025:4567.1', side: 's' });
  assert.equal(parseFaceId('to-3dmassing-2025:4567'), null);
});

test('records resolve through aliases, and unmatched IDs stay unresolved rather than moving to another feature', () => {
  const IDS = { pois: ['osm:node/1', 'osm:way/2'], buildings: ['to-3dmassing-2025:7', 'to-3dmassing-2025:8.1'],
    poiAliases: { 'osm:node/3': 'osm:node/1' }, aliases: { 'to-3dmassing-2024:7': 'to-3dmassing-2025:7' } };
  const resolve = idResolver(IDS);
  assert.deepEqual(resolve('osm:way/2'), { kind: 'poi', row: 1 });
  assert.deepEqual(resolve('osm:node/3'), { kind: 'poi', row: 0 }, 'a left-out duplicate resolves to the place kept');
  assert.deepEqual(resolve('to-3dmassing-2024:7'), { kind: 'building', row: 0 }, 'an authored alias');
  assert.deepEqual(resolve('to-3dmassing-2025:8.1:e'), { kind: 'face', row: 1, side: 'e' });
  assert.deepEqual(resolve('to-3dmassing-2024:7:n'), { kind: 'face', row: 0, side: 'n' });
  for (const id of ['osm:node/99', 'to-3dmassing-2025:9', 'osm:node/1:n', '0', '', undefined]) assert.equal(resolve(id), null, String(id));
  // against the committed sidecar
  const { GEO_IDS } = loadCity('js/toronto-geodata-ids.js');
  const real = idResolver(GEO_IDS);
  assert.deepEqual({ ...real(GEO_IDS.buildings[123]) }, { kind: 'building', row: 123 });
  const [dup, kept] = Object.entries(GEO_IDS.poiAliases)[0];
  assert.equal(real(dup).row, GEO_IDS.pois.indexOf(kept));
});

test('duplicate IDs and bad aliases fail', () => {
  assert.throws(() => assertUnique('building', ['a', '', 'b', 'a']), /duplicate building ID a \(rows 0 and 3\)/);
  assert.doesNotThrow(() => assertUnique('building', ['a', '', '']));
  const live = new Set(['osm:node/1', 'osm:node/2']);
  assert.doesNotThrow(() => checkAliases({ 'osm:node/9': 'osm:node/1' }, live));
  assert.throws(() => checkAliases({ 'osm:node/2': 'osm:node/1' }, live), /is a live ID/);
  assert.throws(() => checkAliases({ 'osm:node/9': 'osm:node/8' }, live), /not a live ID/);
});

// A synthetic GTFS feed in the city's frame: route 900 along King Street's line (z = 0) through the detailed area
function writeFeed(dir, shapes) {
  const P = loadCity('js/toronto-geodata.js').GEO.frame.projection;
  const lonLat = (x, z) => {
    const u = x + P.ox, v = z + P.oz, c = Math.cos(P.theta), s = Math.sin(P.theta);
    return [P.lon0 + (u * c - v * s) / P.kx, P.lat0 + (-u * s - v * c) / P.ky];
  };
  const STOPS = { S1: [-700, 0], S2: [-300, 0], S3: [300, 0], S4: [700, 0], S5: [0, 0] };
  const rows = { shapes: ['shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled'],
    trips: ['route_id,service_id,trip_id,trip_headsign,direction_id,shape_id'],
    stop_times: ['trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled'] };
  const hhmmss = (t) => [t / 3600, (t / 60) % 60, t % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');
  for (const [shape, { pts, stops }] of Object.entries(shapes)) {
    let d = 0;
    pts.forEach(([x, z], i) => {
      if (i) d += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      const [lon, lat] = lonLat(x, z);
      rows.shapes.push(`${shape},${lat},${lon},${i + 1},${d.toFixed(1)}`);
    });
    for (let k = 0; k < 10; k++) {
      const trip = `${shape}-${k}`;
      rows.trips.push(`900,WED,${trip},East - 900 Test towards Somewhere,0,${shape}`);
      stops.forEach((id, i) => {
        const sd = STOPS[id][0] + 800; // along the line from x = -800
        const t = 6 * 3600 + k * 1800 + Math.round(sd / 6);
        rows.stop_times.push(`${trip},${hhmmss(t)},${hhmmss(t)},${id},${i + 1},${sd.toFixed(1)}`);
      });
    }
  }
  const files = {
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWED,0,0,1,0,0,0,0,20260101,20261231',
    'routes.txt': 'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color\n900,1,900,Test,,3,,ED1C24,FFFFFF',
    'stops.txt': ['stop_id,stop_name,stop_lat,stop_lon', ...Object.entries(STOPS).map(([id, [x, z]]) => { const [lon, lat] = lonLat(x, z); return `${id},${id} Stop,${lat},${lon}`; })].join('\n'),
    'trips.txt': rows.trips.join('\n'), 'stop_times.txt': rows.stop_times.join('\n'), 'shapes.txt': rows.shapes.join('\n')
  };
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text + '\n');
}
function buildTransit(shapes, variants) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transit-ids-'));
  try {
    fs.mkdirSync(path.join(dir, 'tools/data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'js'));
    fs.copyFileSync(path.join(root, 'tools/build-transit.mjs'), path.join(dir, 'tools/build-transit.mjs'));
    fs.symlinkSync(path.join(root, 'js/toronto-geodata.js'), path.join(dir, 'js/toronto-geodata.js'));
    fs.writeFileSync(path.join(dir, 'tools/data/transit-variants.json'), JSON.stringify({ version: 1, variants: [], reviewed: [], aliases: {}, ...variants }));
    writeFeed(path.join(dir, 'feed'), shapes);
    const out = path.join(dir, 'transit.js');
    const r = spawnSync(process.execPath, [path.join(dir, 'tools/build-transit.mjs'), path.join(dir, 'feed'), out], { encoding: 'utf8' });
    if (r.status !== 0) return { error: r.stderr + r.stdout };
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(out, 'utf8'), context);
    return { T: context.window.CITY.GEO_TRANSIT };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const LINE = [[-800, 0], [0, 0], [800, 0]];
const DETOUR = [[-800, 0], [-200, 0], [0, 200], [200, 0], [800, 0]];

test('patterns sharing first and last stops but not the stops between keep distinct identities', () => {
  const { T, error } = buildTransit({ A: { pts: LINE, stops: ['S1', 'S2', 'S3', 'S4'] }, B: { pts: LINE, stops: ['S1', 'S5', 'S4'] } });
  assert.ifError(error);
  assert.equal(T.patterns.length, 2, 'the branch is not merged into the main pattern by its end stops');
  const [a, b] = T.patterns;
  assert.notEqual(a.id, b.id);
  assert.notDeepEqual(a.stops, b.stops);
  // same stops, same streets, several shapes (the TTC's time bands): still one pattern, trips summed
  const merged = buildTransit({ A: { pts: LINE, stops: ['S1', 'S2', 'S3', 'S4'] }, A2: { pts: LINE, stops: ['S1', 'S2', 'S3', 'S4'] } });
  assert.ifError(merged.error);
  assert.equal(merged.T.patterns.length, 1);
  assert.equal(merged.T.patterns[0].n, 20);
  assert.equal(merged.T.patterns[0].id, a.stops.length === 4 ? a.id : b.id, 'identity is the source route, direction, type and stops');
});

test('shapes calling at the same stops by different streets need a reviewed variant key', () => {
  const shapes = { A: { pts: LINE, stops: ['S1', 'S2', 'S3', 'S4'] }, C: { pts: DETOUR, stops: ['S1', 'S2', 'S3', 'S4'] } };
  const unreviewed = buildTransit(shapes);
  assert.match(unreviewed.error, /take different paths/);
  const base = buildTransit({ A: shapes.A }).T.patterns[0].id;
  const { T, error } = buildTransit(shapes, { variants: [{ pattern: base, key: 'via-north', near: [0, 200], r: 25 }] });
  assert.ifError(error);
  assert.deepEqual([...T.patterns].map((p) => p.id).sort(), [base, `${base}:via-north`]);
  // a reviewed "one path" decision accepts a bounded difference, never more
  assert.ifError(buildTransit(shapes, { reviewed: [{ pattern: base, same: true, maxStray: 250 }] }).error);
  assert.match(buildTransit(shapes, { reviewed: [{ pattern: base, same: true, maxStray: 60 }] }).error, /take different paths/);
});

test('a pattern alias may not shadow a live pattern', () => {
  const shapes = { A: { pts: LINE, stops: ['S1', 'S2', 'S3', 'S4'] } };
  const id = buildTransit(shapes).T.patterns[0].id;
  assert.match(buildTransit(shapes, { aliases: { [id]: id } }).error, /is a live pattern ID/);
  assert.match(buildTransit(shapes, { aliases: { 'ttc:900:0:3:0000000000': 'ttc:900:0:3:ffffffffff' } }).error, /no such pattern/);
  assert.equal(JSON.stringify(buildTransit(shapes, { aliases: { 'ttc:900:0:3:0000000000': id } }).T.patternAliases), JSON.stringify({ 'ttc:900:0:3:0000000000': id }));
});
