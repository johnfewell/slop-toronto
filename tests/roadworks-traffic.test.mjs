// node --test: traffic and road works (jf-dqj): the hours a record is at work, the lanes its barrels close on the traffic's edges,
// what a driver in a closed lane does about it (merge before the taper, wait to be let in, crawl where no lane is open), the
// edges a barricade row ends, and the TTC's routes taken round a closed road. Pure functions of js/roadworks-layout.js; the
// vehicles' own use of them is in js/traffic.js (checked on the Mac mini's captures, docs/road-works.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = { window: { CITY: { TSL: {} } }, location: { search: '' } };
vm.runInNewContext(fs.readFileSync(new URL('../js/roadworks-layout.js', import.meta.url), 'utf8'), context);
const R = context.window.CITY.roadworks;

// ---------------------------------------------------------------------------------------------------------------------
test('hours: a weekday window shows its records for those hours of the scene clock, on those days', () => {
  const week = ['', '07:00-19:00', '07:00-19:00', '07:00-19:00', '07:00-19:00', '07:00-19:00', ''];
  const rec = { sc: week };
  assert.deepEqual(JSON.parse(JSON.stringify(R.hourWindow('07:00-19:00'))), { from: 420, to: 1140 });
  assert.equal(R.hourWindow(''), null);
  assert.equal(R.hourWindow('all day'), null);
  assert.equal(R.activeAtHour(rec, 3, 6.9), false, 'before 07:00');
  assert.equal(R.activeAtHour(rec, 3, 7), true);
  assert.equal(R.activeAtHour(rec, 3, 12), true);
  assert.equal(R.activeAtHour(rec, 3, 18.99), true);
  assert.equal(R.activeAtHour(rec, 3, 19.01), false, 'after 19:00');
  assert.equal(R.activeAtHour(rec, 3, 0), false, 'midnight preset');
  assert.equal(R.activeAtHour(rec, 6, 12), false, 'Saturday has no work');
  assert.equal(R.activeAtHour({ sc: null }, 6, 3), true, 'no schedule: always');
  const continuous = { sc: Array(7).fill('00:00-23:59') };
  for (const h of [0, 6, 12, 23.9]) assert.equal(R.activeAtHour(continuous, 2, h), true, `continuous at ${h}`);
  // a window past midnight carries into the next morning
  const night = { sc: Array(7).fill('21:00-05:00') };
  assert.equal(R.activeAtHour(night, 2, 22), true);
  assert.equal(R.activeAtHour(night, 3, 2), true, 'the small hours of the next day');
  assert.equal(R.activeAtHour(night, 3, 12), false);
  assert.equal(R.activeAtHour({ sc: ['', '', '21:00-05:00', '', '', '', ''] }, 3, 2), true, 'Tuesday night runs into Wednesday');
  assert.equal(R.activeAtHour({ sc: ['', '', '21:00-05:00', '', '', '', ''] }, 4, 2), false, 'and no further');
  assert.equal(R.activeAtHour(rec, 3, 31), true, 'an hour is taken modulo a day (7 a.m.)');
});

// ---------------------------------------------------------------------------------------------------------------------
// a straight two-way street along x (z = 0): the east-bound edge heads +x, its right is +z; the west-bound edge heads -x
const edge = (sx, dx, lanes, len = 200) => ({ sx, sz: 0, dx, dz: 0, rx: -0, rz: dx, len, lanes, moves: [], busOnly: false });
function street(lanesEach) {
  const east = edge(0, 1, lanesEach === 1 ? [1.8] : [1.8, 5.3]);
  const west = edge(200, -1, lanesEach === 1 ? [1.8] : [1.8, 5.3]);
  return { network: { edges: [east, west] }, east, west };
}
// the barrels of a closed kerb lane for the east-bound traffic (the stretch heads +x: its right, side +1, is +z): on the
// inner edge of the kerb lane, z = 3.9 on a street with two lanes each way, z = 0.4 with one
const barrels = (z, from = 80, to = 120, rec = 0) => {
  const list = [];
  for (let x = from; x <= to; x += 8) list.push({ x, z, rec, side: 1, fx: 1, fz: 0 });
  return list;
};

test('a closed kerb lane: the lanes beyond the barrels close for that way only, from the taper to just past the last barrel', () => {
  const { network, east, west } = street(2);
  const t = R.laneZoneTable(network, barrels(3.9));
  assert.equal(t.zones.length, 1, 'the other way of the street has none');
  const z = t.zones[0];
  assert.equal(z.edge, east);
  assert.deepEqual(z.closed, [false, true], 'the kerb lane closes, the inner lane is open');
  assert.deepEqual(z.open, [0]);
  assert.equal(z.a, 80 - R.LANE_TAPER, 'the taper starts before the first barrel');
  assert.equal(z.b, 125, 'and the zone ends just after the last');
  assert.equal(z.cap, R.ZONE_SPEED);
  assert.equal(t.apply(() => true), 1);
  assert.equal(east.laneZones.length, 1);
  assert.equal(west.laneZones, undefined);
  assert.equal(t.apply((rec) => rec !== 0), 0, 'the hours switch it off with the barrels');
  assert.equal(east.laneZones, undefined);
});

test('barrels on the other kerb close the other way\'s lane, and records keep their own zones', () => {
  const { network, west } = street(2);
  // the stretch heads -x (fx = -1): its right is -z, so side +1 is z = -3.9 and the west-bound edge (right +z... its own lane at +5.3 is z = -5.3)
  const list = [];
  for (let x = 80; x <= 120; x += 8) list.push({ x, z: -3.9, rec: 7, side: 1, fx: -1, fz: 0 });
  const t = R.laneZoneTable(network, [...list, ...barrels(3.9, 80, 120, 2)]);
  assert.equal(t.zones.length, 2);
  const w = t.zones.find((z) => z.edge === west);
  assert.ok(w, 'the west-bound kerb lane is closed by its own record');
  assert.deepEqual(w.closed, [false, true]);
  assert.equal(w.rec, 7);
  assert.equal(t.apply((rec) => rec === 2), 1, 'only the east-bound record is at work');
  assert.equal(west.laneZones, undefined);
});

test('one lane each way: the barrels leave no open lane, and the zone is a crawl', () => {
  const { network } = street(1);
  const t = R.laneZoneTable(network, barrels(0.4));
  assert.equal(t.zones.length, 1);
  assert.deepEqual(t.zones[0].open, []);
  assert.equal(t.zones[0].cap, R.CRAWL_SPEED);
  assert.equal(R.mergeStep(t.zones[0], 0), -1, 'there is nowhere to merge to');
  assert.equal(R.laneDecision(t.zones[0], 0, 60).merge, -1);
  assert.equal(R.laneDecision(t.zones[0], 0, 60).stop, Infinity, 'and nobody waits at the taper: they pass slowly');
  assert.ok(R.zoneSpeedCap(t.zones[0], 40, 36) < 12 && R.zoneSpeedCap(t.zones[0], 40, 36) > R.CRAWL_SPEED, 'a driver arriving is already slowing');
  assert.equal(R.zoneSpeedCap(t.zones[0], 100, 96), R.CRAWL_SPEED, 'beside the barrels it is at the crawl');
  assert.equal(R.zoneSpeedCap(t.zones[0], 140, 136), Infinity, 'past the works it is free again');
});

test('a driver in the closed lane merges before the taper: asks for more room as the taper nears, waits at it, and goes free once out', () => {
  const { network } = street(2);
  const z = R.laneZoneTable(network, barrels(3.9)).zones[0]; // a = 69, b = 125
  assert.equal(R.closedZoneAhead({ laneZones: [z] }, 1, 20), null, 'far from the zone: nothing yet');
  assert.equal(R.closedZoneAhead({ laneZones: [z] }, 1, 40), z, 'within the lead of it, in the closed lane');
  assert.equal(R.closedZoneAhead({ laneZones: [z] }, 0, 40), null, 'the inner lane is not closed');
  assert.equal(R.closedZoneAhead({ laneZones: [z] }, 1, 130), null, 'past it');
  const far = R.laneDecision(z, 1, 30), mid = R.laneDecision(z, 1, 52), near = R.laneDecision(z, 1, 64);
  assert.equal(far.merge, 0);
  assert.equal(mid.merge, 0);
  assert.equal(R.laneDecision(z, 1, 10).merge, -1, 'beyond the merge lead, no move yet');
  assert.ok(far.bSafe > mid.bSafe && mid.bSafe > near.bSafe, 'a closer taper is a harder squeeze');
  assert.equal(far.stop, Infinity, 'still flowing');
  assert.ok(near.stop > 0 && near.stop < 6, `at the taper it stops short of it: ${near.stop}`);
  const waited = R.laneDecision(z, 1, 64, 9);
  assert.ok(waited.bSafe < near.bSafe && waited.minGap < near.minGap, 'and is let in as it waits');
  assert.equal(R.laneDecision(z, 1, 64, R.STOP_PATIENCE + 1).stop, Infinity, 'after a very long wait it goes on slowly rather than hold the road for ever');
  // a zone that starts at the edge's mouth: a driver just out of the junction stops short of the first barrel, not on the spot
  const mouth = { closed: [false, true], open: [0], a: 0, b: 60, cap: R.ZONE_SPEED };
  const entering = R.laneDecision(mouth, 1, 2.5);
  assert.equal(entering.merge, 0);
  assert.ok(entering.stop > 3 && entering.stop < 12, `inside the taper it stops short of the barrels: ${entering.stop}`);
  assert.equal(R.laneDecision(z, 0, 64).merge, -1, 'a driver already in the open lane has no move');
  assert.equal(R.laneDecision(z, 0, 64).stop, Infinity);
  assert.equal(R.laneDecision(z, 1, 130).merge, -1, 'past the works: free, and it may merge back by the ordinary rules');
  assert.ok(R.zoneSpeedCap(z, 50, 46) < 14 && R.zoneSpeedCap(z, 50, 46) > R.ZONE_SPEED, 'the zone speed is reached by the taper, not at once');
  assert.equal(R.zoneSpeedCap(z, 100, 96), R.ZONE_SPEED);
});

test('three lanes: a driver two lanes from the open one steps one lane at a time', () => {
  const z = { closed: [false, true, true], open: [0], a: 50, b: 150 };
  assert.equal(R.mergeStep(z, 2), 1);
  assert.equal(R.mergeStep(z, 1), 0);
  assert.equal(R.mergeStep(z, 0), -1);
  const z2 = { closed: [true, false, false], open: [1, 2], a: 50, b: 150 };
  assert.equal(R.mergeStep(z2, 0), 1, 'a closed inner lane: out to the right');
});

// ---------------------------------------------------------------------------------------------------------------------
test('a barricade row ends the road there too: nobody drives up to it and waits for ever', () => {
  const mk = (sx, len) => ({ sx, sz: 0, dx: 1, dz: 0, rx: 0, rz: 1, len, lanes: [1.8], moves: [], busOnly: false });
  const a = mk(0, 100), b = mk(100, 300), c = mk(400, 100);
  a.moves = [{ to: b }]; b.moves = [{ to: c }];
  const net = { edges: [a, b, c] };
  // a closed stretch of 40 m along b: no edge lies wholly along it, but its row stands on b
  const line = { pts: [{ x: 250, z: 0 }, { x: 290, z: 0 }], half: 7 };
  assert.equal(R.closeEdges(net, [line]).closed, 0, 'by the lines alone, b stays open');
  const r = R.closeEdges(net, [line], { rows: [{ x: 250, z: 1.8 }, { x: 290, z: 1.8 }] });
  assert.equal(r.closed, 1);
  assert.equal(b.busOnly && b.roadClosed && b.worksClosed, true);
  assert.equal(r.edges.includes(b), true);
  R.openEdges(r.edges);
  assert.equal(b.busOnly || b.roadClosed || b.worksClosed, false, 'the hours open it again');
  const other = { ...mk(0, 50), busOnly: true };
  assert.equal(R.closeEdges({ edges: [other] }, [{ pts: [{ x: 0, z: 0 }, { x: 50, z: 0 }], half: 7 }]).closed, 0, 'a road already shut for another reason is not claimed');
});

// ---------------------------------------------------------------------------------------------------------------------
test('a TTC route goes round a closed road by the shortest open way, and is cut or left where there is none', () => {
  // a grid: the route runs along y = 0 through a, b, c, d; a block round b is p, q, r
  const L = (name, len = 100, tram = false) => ({ name, len, moves: [], worksClosed: false, tram });
  const a = L('a'), b = L('b'), c = L('c'), d = L('d'), p = L('p', 60), q = L('q', 100), r = L('r', 60);
  const go = (from, ...to) => { from.moves = to.map((t) => ({ to: t })); };
  go(a, b, p); go(b, c); go(c, d); go(p, q); go(q, r); go(r, c);
  const names = (r) => Array.from(r.links, (e) => e.name);
  const base = [a, b, c, d];
  const open = R.detourRoute(base);
  assert.equal(open.links, base, 'nothing closed: the route itself');
  b.worksClosed = true;
  const way = R.detourRoute(base);
  assert.deepEqual(names(way), ['a', 'p', 'q', 'r', 'c', 'd'], 'round the block');
  assert.equal(way.detoured, 1);
  assert.equal(way.left, 0);
  // no way round: the closed link in the middle stays on the route, and is counted
  p.worksClosed = true;
  const stuck = R.detourRoute(base);
  assert.deepEqual(names(stuck), ['a', 'b', 'c', 'd']);
  assert.equal(stuck.left, 1);
  // a long detour (more than three times the closed stretch and 400 m more) is not taken
  p.worksClosed = false; q.len = 2000;
  assert.equal(R.detourRoute(base).left, 1, 'the block is too far round');
  q.len = 100;
  // streetcar links are not driven by buses
  q.tram = true;
  assert.equal(R.detourRoute(base).left, 1);
  q.tram = false;
  // a closure at the route's start or end shortens the route
  a.worksClosed = true; b.worksClosed = false;
  const head = R.detourRoute(base);
  assert.deepEqual(names(head), ['b', 'c', 'd']);
  assert.equal(head.cut, 1);
  a.worksClosed = false; d.worksClosed = true;
  assert.deepEqual(names(R.detourRoute(base)), ['a', 'b', 'c']);
});

// ---------------------------------------------------------------------------------------------------------------------
test('one lane each way, with the other way still open: the two directions take turns, and a crawl stays a crawl without an opposite', () => {
  const { network, east, west } = street(1);
  const alone = R.laneZoneTable(network, barrels(0.4));
  const none = R.planAlternations(alone.zones, [{ de: 'curb lane', sc: ['', '09:00-16:00', '09:00-16:00', '09:00-16:00', '09:00-16:00', '09:00-16:00', ''] }]);
  assert.equal(none.posts.length, 0, 'no opposite edge: still a crawl');
  assert.equal(alone.zones[0].cap, R.CRAWL_SPEED);
  east.opposite = west; west.opposite = east;
  const paired = R.laneZoneTable(network, barrels(0.4));
  const recs = [{ de: 'paid duty officer on site', sc: ['', '07:00-19:00', '07:00-19:00', '07:00-19:00', '07:00-19:00', '07:00-19:00', ''] }];
  const alt = R.planAlternations(paired.zones, recs);
  assert.equal(paired.zones[0].alt, true);
  assert.equal(paired.zones[0].cap, R.ALT_SPEED);
  assert.deepEqual(paired.zones[0].hugs, [0]);
  assert.equal(alt.posts.length, 2);
  assert.equal(alt.posts[0].kind, 'officer');
  assert.equal(alt.apply(() => true), 1);
  assert.equal(east.worksAlts.length, 1);
  assert.equal(west.worksAlts.length, 1);
  assert.equal(east.worksAlts[0].role, 'hold');
  assert.equal(west.worksAlts[0].role, 'open');
  assert.ok(east.worksAlts[0].shift < -3, 'the closed direction shifts left into the open lane');
  assert.equal(alt.apply(() => false), 0);
  assert.equal(east.worksAlts, undefined);
  // the live graph's e.opposite is the next block's approach into the same junction, not this block's other direction
  const approach = edge(400, -1, [1.8], 200);
  const nodeEnd = { in: [east, approach] }, nodeStart = { in: [west] };
  east.to = nodeEnd; east.from = nodeStart; west.to = nodeStart; west.from = nodeEnd; approach.to = nodeEnd;
  east.opposite = approach;
  const live = R.laneZoneTable({ edges: [east, west, approach] }, barrels(0.4));
  const fixed = R.planAlternations(live.zones, recs);
  assert.equal(fixed.posts.length, 2, 'the other direction of this block, not the next block');
  assert.equal(fixed.works[0].other, west);
  // both directions barrelled shut: nobody alternates through a lane that is not there
  const both = R.laneZoneTable(network, [...barrels(0.4), ...barrels(-0.4).map((b) => ({ ...b, fx: -1, rec: 1 }))]);
  // the west barrels need to sit on the west edge's lane. west heads -x, its right is -z, lane centre z = -1.8.
  // barrels() at z=-0.4 with fx=-1: side +1, cos of west dx=-1 and fx=-1 is +1, lateral of barrel on west...
  const westBarrels = [];
  for (let x = 80; x <= 120; x += 8) westBarrels.push({ x, z: -0.4, rec: 1, side: 1, fx: -1, fz: 0 });
  const shut = R.laneZoneTable(network, [...barrels(0.4), ...westBarrels]);
  const noShare = R.planAlternations(shut.zones, recs);
  assert.equal(noShare.posts.length, 0, 'both ways closed: no shared lane');
  assert.ok(shut.zones.every((z) => !z.alt && z.cap === R.CRAWL_SPEED));
});

test('the phase and the stop: one direction, then a gap, then the other; a car already inside keeps going', () => {
  assert.equal(R.controlKind({ de: 'PDO at both ends', sc: null }), 'officer');
  assert.equal(R.controlKind({ de: 'flag person', sc: ['', '09:00-15:00', '', '', '', '', ''] }), 'officer');
  assert.equal(R.controlKind({ de: 'portable signal', sc: ['', '09:00-15:00', '', '', '', '', ''] }), 'signal');
  assert.equal(R.controlKind({ de: 'curb lane', sc: Array(7).fill('00:00-23:59') }), 'signal');
  assert.equal(R.controlKind({ de: 'curb lane', sc: ['', '09:00-16:00', '09:00-16:00', '09:00-16:00', '09:00-16:00', '09:00-16:00', ''] }), 'officer');
  const ph = R.alternationPhase(70, 0, 'officer');
  assert.equal(ph.go, 0);
  assert.equal(R.alternationPhase(70, 17.9, 'officer').go, 0);
  assert.equal(R.alternationPhase(70, 18, 'officer').go, -1, 'clearance after the first green');
  const green = 18, clear = R.alternationPhase(70, 0, 'officer').clear;
  assert.equal(R.alternationPhase(70, green + clear + 1, 'officer').go, 1);
  assert.equal(R.alternationPhase(70, 2 * (green + clear) + 1, 'officer').go, 0, 'the next cycle starts with the closed direction again');
  assert.equal(R.alternationPhase(70, 27.9, 'signal').go, 0);
  assert.equal(R.alternationPhase(70, 28, 'signal').go, -1, 'a portable signal holds its green longer than an officer');
  const hold = { role: 'hold', s: -30, half: 2.3, a: 40, b: 80, go: 1, oncoming: false, shift: -3.6 };
  assert.equal(R.alternationDecision(hold), null, 'too far to care');
  const near = R.alternationDecision({ ...hold, s: 30 });
  assert.ok(near.stop < 20 && near.stop > 0, 'not its turn: stop short of the line');
  const mine = R.alternationDecision({ ...hold, s: 28, go: 0 });
  assert.equal(mine.stop, Infinity);
  assert.equal(mine.hug, 0, 'still on the approach: not in the shared lane yet');
  const close = R.alternationDecision({ ...hold, s: 36, go: 0 });
  assert.equal(close.hug, -3.6);
  const blocked = R.alternationDecision({ ...hold, s: 36, go: 0, oncoming: true });
  assert.ok(blocked.stop < Infinity, 'someone is still in the stretch');
  const inside = R.alternationDecision({ ...hold, s: 55, go: 1 });
  assert.equal(inside.stop, Infinity);
  assert.equal(inside.hug, -3.6, 'already inside: finish, in the open lane');
});

test('a published via-street is preferred, and a long parallel beside the closure is taken only when the links have geometry', () => {
  const G = (name, x, z, dx, dz, len) => ({ name, sx: x, sz: z, dx, dz, rx: -dz, rz: dx, len, lanes: [1.8], moves: [], worksClosed: false, tram: false });
  const a = G('a', -40, 0, 1, 0, 40);
  const b = G('b', 0, 0, 1, 0, 100); b.worksClosed = true;
  const c = G('c', 100, 0, 1, 0, 40);
  const up = G('up', -150, 0, 0, 1, 180);
  const par = G('Harbord Street', -150, 180, 1, 0, 400);
  const down = G('down', 250, 180, 0, -1, 180);
  const side = G('Side Street', 0, 40, 1, 0, 100);
  const sideDown = G('side down', 100, 40, 0, -1, 40);
  const link = (from, ...to) => { from.moves = to.map((t) => ({ to: t })); };
  link(a, b, up); link(up, par); link(par, down); link(down, c); link(b, c);
  // 180+400+180 = 760 m, over the no-geometry cap (700) and inside the band of the closed stretch
  const way = R.detourRoute([a, b, c]);
  assert.equal(way.links.map((e) => e.name).join('|'), 'a|up|Harbord Street|down|c');
  assert.equal(way.detoured, 1);
  const saved = [a, b, c, up, par, down].map((e) => ({ sx: e.sx, sz: e.sz, dx: e.dx, dz: e.dz }));
  for (const e of [a, b, c, up, par, down]) delete e.sx;
  assert.equal(R.detourRoute([a, b, c]).left, 1, 'no geometry: 760 m is over the old cap');
  [a, b, c, up, par, down].forEach((e, i) => Object.assign(e, saved[i]));
  link(a, b, up, side); link(side, sideDown); link(sideDown, c);
  const named = R.detourRoute([a, b, c], { name: (e) => e.name, viaFor: () => ['harbord street'] });
  assert.ok(named.links.some((e) => e.name === 'Harbord Street'), 'the published street is the one taken');
  assert.equal(named.links.includes(side), false);
  const stops = R.placeDetourStops([{ name: 'Queen at Soho' }], [par]);
  assert.equal(stops.length, 1);
  assert.equal(stops[0].name, 'Queen at Soho');
  assert.ok(stops[0].s > 18 && stops[0].s < par.len - 18);
  assert.ok(Math.abs(stops[0].z - (180 + 1.8 + 2.3)) < 0.01, 'on the kerb side of the detour');
  assert.equal(R.placeDetourStops([{ name: 'x' }], [{ len: 10, name: 'short' }]).length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
test('the layout gives each barrel the side and the direction the traffic code needs', () => {
  const src = fs.readFileSync(new URL('../js/roadworks-layout.js', import.meta.url), 'utf8');
  assert.match(src, /emit\('barrel', x, z, [^;]*\{ side, fx: r\.dx, fz: r\.dz \}\)/);
});
