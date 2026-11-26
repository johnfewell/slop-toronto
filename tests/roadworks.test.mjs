// node --test: the City of Toronto's Road Restrictions as road works (worker/roadworks.js parsing, js/roadworks-layout.js dates,
// placement and traffic closures, worker/live.js /live/roadworks). tests/fixtures/road-restrictions-20261125.json holds
// thirteen real records of the City's feed as fetched 2026-11-25 (no network here).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parsePolyline, workType, schedule, compact, parseRestrictions, BOUNDS } from '../worker/roadworks.js';
import worker from '../worker/live.js';

const FEED = JSON.parse(fs.readFileSync(new URL('./fixtures/road-restrictions-20261125.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-26T03:00:00Z'); // Wednesday 25 November, 22:00 in Toronto
const byId = (id) => FEED.Closure.find((r) => r.id === id);

const context = { window: { CITY: { TSL: {} } }, location: { search: '' } };
for (const file of ['toronto-geodata', 'toronto-traffic-data', 'city-config', 'roadworks-layout'])
  vm.runInNewContext(fs.readFileSync(new URL(`../js/${file}.js`, import.meta.url), 'utf8'), context);
const C = context.window.CITY;
const B = C.CITY_BOUNDS;
const deps = {
  toWorld: (la, lo) => C.worldFromLatLon(la, lo), inFrame: (x, z) => x > B.minX && x < B.maxX && z > B.minZ && z < B.maxZ,
  nearestRoads: C.nearestRoads, blockAt: C.blockAt, isOnLand: C.isOnLand, blocked: () => false, parkedAt: () => false, tramNear: (x, z, r) => !!C.nearestTram?.(x, z, r) && false,
  crossings: [...C.SIGNAL_CROSSINGS, ...C.PXOS]
};
const parsed = parseRestrictions(FEED, { now: NOW });
const lay = (records, opts = {}) => C.roadworksSites(records, deps, { now: NOW, siteDate: { month: 11, day: 25, source: 'live' }, ...opts });

// ---------------------------------------------------------------------------------------------------------------------
test('the feed parses: polylines, work type, schedule, kinds, with what was dropped counted', () => {
  assert.deepEqual(parsePolyline('[-79.380900,43.656270],[-79.380920,43.656310],[-79.380920,43.656310]'), [[43.65627, -79.3809], [43.65631, -79.38092]], 'doubled vertices dropped, lat/lon swapped to lat first');
  assert.deepEqual(parsePolyline('[0,0],[1,1]'), [], 'not Toronto');
  assert.deepEqual(parsePolyline(null), []);
  assert.equal(workType({ workEventType: '{"tabledata":[{"Option":"Toronto Water","x":1}]}' }), 'Toronto Water');
  assert.equal(workType({ workEventType: 'Metrolinx' }), 'Metrolinx');
  assert.equal(workType({ workEventType: null, source: 'Toronto Hydro' }), 'Toronto Hydro');
  const weekdays = schedule({ scheduleMonday: '07:00-16:30', scheduleTuesday: '07:00-16:30', scheduleWednesday: '07:00-16:30', scheduleThursday: '07:00-16:30', scheduleFriday: '07:00-16:30' });
  assert.deepEqual(weekdays, ['', '07:00-16:30', '07:00-16:30', '07:00-16:30', '07:00-16:30', '07:00-16:30', ''], 'Sunday first');
  assert.deepEqual(schedule({ scheduleEveryday: '21:00-05:00' }), Array(7).fill('21:00-05:00'));
  assert.equal(schedule({}), null);
  const c = parsed.counts;
  assert.equal(c.feed, 13);
  assert.equal(c.outside, 1, 'the Scarborough record is outside every frame');
  assert.equal(c['no-dates'], 1, 'a record with no dates cannot be dated');
  assert.equal(parsed.records.length, c.kept);
  assert.equal(c.kept, 11);
  const closed = parsed.records.find((r) => r.i === 'Tor-RD52026-7692');
  assert.equal(closed.t, 'R');
  assert.equal(closed.r, 'Durie St');
  assert.equal(closed.d, 2);
  assert.equal(parsed.records.find((r) => r.i === 'Tor-RD1H2026-2267-3').d, 1, 'ONE_DIRECTION is kept');
  assert.ok(!/^Toronto-TMC/.test(closed.de), 'the City\'s routing prefix is removed from its description');
  assert.ok(closed.de.length <= 300);
  assert.throws(() => parseRestrictions({}), /no Closure list/);
  assert.throws(() => parseRestrictions(null), /no Closure list/);
  assert.equal(compact({ ...byId('Tor-RD52026-7692'), type: 'EVENT' }).why, 'type');
  assert.equal(BOUNDS.lat0 < 43.59 && BOUNDS.lat1 > 43.71 && BOUNDS.lon0 < -79.49 && BOUNDS.lon1 > -79.3, true, 'the box holds both playable frames');
});

test('only records in effect on the scene\'s day: the City\'s dates and its weekday schedule', () => {
  const R = C.roadworks;
  const wed = R.dayRange({ year: 2026, month: 11, day: 25 }), sun = R.dayRange({ year: 2026, month: 11, day: 29 });
  assert.equal(wed.dow, 3);
  assert.equal(sun.dow, 0);
  assert.equal(wed.to - wed.from, 86400000, 'a November day is 24 hours');
  assert.equal(wed.from, Date.parse('2026-11-25T05:00:00Z'), 'Toronto midnight is 05:00 UTC in November');
  assert.equal(R.dayRange({ year: 2026, month: 8, day: 22 }).from, Date.parse('2026-08-22T04:00:00Z'), 'and 04:00 UTC in August');
  const week = ['', '07:00-16:30', '07:00-16:30', '07:00-16:30', '07:00-16:30', '07:00-16:30', ''];
  const rec = { s: Date.parse('2026-11-20T12:00:00Z'), e: Date.parse('2026-12-04T12:00:00Z'), sc: week };
  assert.equal(R.activeOn(rec, wed), true);
  assert.equal(R.activeOn(rec, sun), false, 'weekdays only: not on a Sunday');
  assert.equal(R.activeOn({ ...rec, sc: null }, sun), true, 'no schedule: any day it spans');
  assert.equal(R.activeOn(rec, R.dayRange({ year: 2026, month: 11, day: 19 })), false, 'not yet begun');
  assert.equal(R.activeOn(rec, R.dayRange({ year: 2026, month: 12, day: 7 })), false, 'ended');
  assert.equal(R.activeOn({ ...rec, e: wed.from }, wed), true, 'ending at midnight starting the day still counts');
  assert.equal(R.activeOn({ ...rec, s: wed.to }, wed), false, 'starting at the next midnight does not');
  // the scene's day: a real day (live, ?liveDate=, ?liveClock=) is that day; a preset's stand-in summer day is today
  assert.deepEqual(JSON.parse(JSON.stringify(R.sceneDay({ month: 11, day: 25, source: 'liveDate' }, NOW))), { year: 2026, month: 11, day: 25, source: 'liveDate' });
  assert.deepEqual(JSON.parse(JSON.stringify(R.sceneDay({ month: 8, day: 22, source: 'preset' }, NOW))), { year: 2026, month: 11, day: 25, source: 'today' });
  assert.equal(R.sceneDay(undefined, NOW).source, 'today');
  assert.deepEqual(JSON.parse(JSON.stringify(R.torontoDayOf(Date.parse('2026-11-26T04:30:00Z')))), { year: 2026, month: 11, day: 25 }, 'after 23:00 in Toronto is still the 25th');
});

test('names: the City\'s abbreviations are the road\'s OpenStreetMap name', () => {
  const k = C.roadworks.nameKey;
  assert.equal(k('Yonge St'), k('Yonge Street'));
  assert.equal(k('King St W'), k('King Street West'));
  assert.equal(k('St Clair Ave W'), k('Saint Clair Avenue West'));
  assert.equal(k('Lake Shore Blvd W'), k('Lake Shore Boulevard West'));
  assert.notEqual(k('King St W'), k('Queen St W'));
  assert.equal(k(''), '');
});

// ---------------------------------------------------------------------------------------------------------------------
test('placement: closures stand on the roadway of the road they are reported on, with counts and reasons', () => {
  const records = parsed.records;
  const r = lay(records);
  assert.equal(r.counts.records, 11);
  assert.ok(r.counts.inFrame >= 8 && r.counts.inFrame <= 10, `in the frame: ${r.counts.inFrame}`);
  assert.equal(r.counts.active + r.counts.notActive, r.counts.inFrame);
  assert.ok(r.counts.placed >= 5, `placed ${r.counts.placed}`);
  assert.equal(r.counts.placed, r.counts.placedClosed + r.counts.placedLane);
  assert.ok(r.counts.placed <= r.counts.active);
  assert.ok(r.sites.length > 20);
  for (const s of r.sites) {
    assert.ok(deps.inFrame(s.x, s.z));
    assert.equal(!!C.blockAt(s.x, s.z), false, `${s.kind} at ${s.x.toFixed(1)}, ${s.z.toFixed(1)} is on a sidewalk, median or lot`);
    assert.ok(C.isOnLand(s.x, s.z, 0));
    const rec = records[s.rec];
    const road = C.nearestRoads(s.x, s.z, 30).find((n) => C.roadworks.nameKey(n.road.name) === C.roadworks.nameKey(rec.r));
    assert.ok(road, `${s.kind} stands near its own road, ${rec.r}`);
    assert.ok(road.dist < 16, `${s.kind} is ${road.dist.toFixed(1)} m from the centre line of ${rec.r}`);
  }
  const kinds = new Set(r.sites.map((s) => s.kind));
  for (const k of ['barrel', 'cone']) assert.ok(kinds.has(k), k);
  assert.ok(kinds.has('signWork') || kinds.has('signLane'), 'a lane closure has its sign');
  assert.ok(kinds.has('barricade') || kinds.has('barrier'), 'a closed road has its barricades');
  assert.ok(kinds.has('signClosed'), 'and its ROAD CLOSED sign');
  // every closed-road record's rows cross the roadway kerb to kerb (a row's pieces cover its width)
  for (const pl of r.plans.filter((p) => p.placed && records[p.rec].t === 'R' && p.full)) {
    const rows = r.sites.filter((s) => s.rec === pl.rec && (s.kind === 'barricade' || s.kind === 'barrier'));
    assert.ok(rows.length >= 1);
    const span = rows.reduce((t, s) => t + s.w, 0);
    assert.ok(span >= 3 && span <= 60, `a closure row spans ${span.toFixed(1)} m`);
  }
  // a lane closure's barrels run along the road, a metre or more inside the kerb
  const lane = r.plans.find((p) => p.placed && records[p.rec].t === 'C');
  const barrels = r.sites.filter((s) => s.rec === lane.rec && s.kind === 'barrel');
  assert.ok(barrels.length >= 1);
  assert.ok(Object.keys(r.rejected).length > 0 && Object.values(r.rejected).every((n) => n > 0), 'reasons are counted');
});

test('nothing is placed for what is not in effect, off the road network, in a laneway the map lacks, or twice', () => {
  const rec = parsed.records.find((x) => x.i === 'Tor-RD52026-7692');
  const farFuture = lay([rec], { siteDate: { month: 11, day: 25, source: 'live' }, day: { year: 2031, month: 5, day: 4 } });
  assert.equal(farFuture.sites.length, 0);
  assert.equal(farFuture.counts.active, 0);
  const noName = lay([{ ...rec, r: '' }]);
  assert.equal(noName.sites.length, 0);
  assert.equal(noName.rejected['no-road-name'], 1);
  const wrong = lay([{ ...rec, r: 'Some Other Boulevard' }]);
  assert.equal(wrong.sites.length, 0);
  assert.equal(wrong.rejected['no-road-match'], 1, 'a record whose road is not the one under its points is not guessed at');
  const lane = parsed.records.find((x) => /^Ln /.test(x.r));
  assert.equal(lay([lane]).sites.length, 0, 'the City\'s unnamed laneways are not on the map');
  const twice = lay([rec, { ...rec, i: 'copy' }]);
  const once = lay([rec]);
  assert.ok(twice.sites.length <= once.sites.length + 2, 'a duplicate record adds no second pile');
  const solid = lay([rec], { }); // (everything solid: nothing may be laid)
  const blockedDeps = { ...deps, blocked: () => true };
  const none = C.roadworksSites([rec], blockedDeps, { now: NOW, siteDate: { month: 11, day: 25, source: 'live' } });
  assert.equal(none.sites.length, 0);
  assert.ok(solid.sites.length > 0);
  const parked = C.roadworksSites([rec], { ...deps, parkedAt: () => true }, { now: NOW, siteDate: { month: 11, day: 25, source: 'live' } });
  assert.equal(parked.sites.length, 0, 'parked cars keep the barrels off');
  const tram = C.roadworksSites([rec], { ...deps, tramNear: () => true }, { now: NOW, siteDate: { month: 11, day: 25, source: 'live' } });
  assert.equal(tram.sites.length, 0, 'streetcar tracks keep them off');
  const crossings = C.roadworksSites([rec], { ...deps, crossings: Array.from({ length: 1 }, () => ({ x: 0, z: 0, len: 1 })) }, { now: NOW, siteDate: { month: 11, day: 25, source: 'live' } });
  assert.ok(crossings.sites.length > 0);
});

test('a closed road closes to cars the edges it covers whole, and the stubs it leaves', () => {
  // a road along x (z = 0), f -> a -> b -> c -> g, a side street d off b's end, and a closure along b only
  const edge = (sx, len, moves = []) => ({ sx, sz: 0, dx: 1, dz: 0, len, moves, busOnly: false });
  const f = edge(-400, 400), a = edge(0, 100), b = edge(100, 100), c = edge(200, 100), g = edge(600, 100);
  const d = { sx: 200, sz: 0, dx: 0, dz: 1, len: 30, moves: [], busOnly: false };
  f.moves = [{ to: a }]; a.moves = [{ to: b }]; b.moves = [{ to: c }, { to: d }]; c.moves = [{ to: g }];
  const net = { edges: [f, a, b, c, g, d] };
  const line = { pts: [{ x: 95, z: 0 }, { x: 205, z: 0 }], half: 7 };
  const r = C.roadworks.closeEdges(net, [line], { reach: 150 });
  assert.equal(r.closed, 1);
  assert.equal(b.busOnly && b.roadClosed, true, 'b lies wholly along the closure');
    assert.equal(f.busOnly || g.busOnly, false, 'the road beyond the region is untouched');
  assert.equal(d.busOnly, true, 'the side street, only reachable through b, is a stub');
  assert.ok(r.stubs >= 1);
  assert.equal(JSON.stringify(C.roadworks.closeEdges({ edges: [] }, [line])), '{"closed":0,"stubs":0}');
  assert.equal(JSON.stringify(C.roadworks.closeEdges(null, [line])), '{"closed":0,"stubs":0}');
});

// ---------------------------------------------------------------------------------------------------------------------
// the Worker route
const request = (path) => new Request('https://sloptoronto.ca' + path);
function withCaches(fn) {
  const store = new Map();
  globalThis.caches = { default: { match: async (k) => store.get(k.url)?.clone(), put: async (k, v) => { store.set(k.url, v); } } };
  return fn().finally(() => { delete globalThis.caches; });
}
const env = { ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } };
const ctx = { waitUntil: (p) => p };

test('/live/roadworks serves the compact records, and fails safe with a 502 when the City\'s feed is down', async () => {
  const real = globalThis.fetch, realNow = Date.now;
  let hours = 0; // (the Worker keeps the feed 15 minutes: each case is a later hour)
  const later = () => { hours += 1; Date.now = () => realNow() + hours * 3600000; };
  try {
    later();
    await withCaches(async () => {
      globalThis.fetch = async () => new Response(JSON.stringify(FEED), { status: 200 });
      const ok = await worker.fetch(request('/live/roadworks'), env, ctx);
      assert.equal(ok.status, 200);
      assert.match(ok.headers.get('content-type'), /json/);
      assert.match(ok.headers.get('x-data-source'), /Road Restrictions/);
      const body = await ok.json();
      assert.ok(Number.isFinite(body.t));
      assert.equal(body.counts.feed, 13);
      assert.ok(body.records.length > 0 && body.records.every((r) => Array.isArray(r.ll) && r.ll.length >= 1));
    });
    later();
    await withCaches(async () => {
      globalThis.fetch = async () => new Response('down', { status: 503 });
      const bad = await worker.fetch(request('/live/roadworks'), env, ctx);
      assert.equal(bad.status, 502);
      assert.equal(bad.headers.get('cache-control'), 'no-store');
    });
    later();
    await withCaches(async () => {
      globalThis.fetch = async () => new Response('{"nope":1}', { status: 200 });
      const malformed = await worker.fetch(request('/live/roadworks'), env, ctx);
      assert.equal(malformed.status, 502, 'a feed with no Closure list is an error, not an empty city');
    });
  } finally { globalThis.fetch = real; Date.now = realNow; }
});
