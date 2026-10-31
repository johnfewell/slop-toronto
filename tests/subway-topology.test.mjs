import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildSubwayTopology, trackChains } from '../tools/subway-topology.mjs';
import { readInputs, renderTopology } from '../tools/build-subway-topology.mjs';

const inputs = readInputs();
const transitSource = `${inputs.transit.source.dataset} ${inputs.transit.source.modified}`;
const committed = fs.readFileSync(new URL('../js/toronto-subway-topology.js', import.meta.url), 'utf8');

// A deterministic shuffle (the same every run)
function shuffle(list, seed) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

test('the committed topology is exactly what its committed inputs build', () => {
  const built = renderTopology(buildSubwayTopology(inputs), transitSource);
  assert.equal(built, committed, 'run node tools/build-subway-topology.mjs');
  assert.equal(renderTopology(buildSubwayTopology(inputs), transitSource), built, 'a second build is identical');
});

test('identities do not depend on the order of the source records', () => {
  const reference = buildSubwayTopology(inputs);
  for (const seed of [1, 7, 42]) {
    const subway = { ways: shuffle(inputs.subway.ways, seed), stations: shuffle(inputs.subway.stations, seed + 1),
      entrances: shuffle(inputs.subway.entrances, seed + 2) };
    // the GTFS patterns in another order (stop indices and names untouched)
    const transit = { ...inputs.transit, patterns: shuffle(inputs.transit.patterns, seed + 3) };
    assert.deepEqual(buildSubwayTopology({ ...inputs, subway, transit }), reference, `shuffle ${seed}`);
  }
});

test('stations, platforms, directions and segments carry stable source-derived ids', () => {
  const T = buildSubwayTopology(inputs);
  const station = (id) => T.stations.find((s) => s.id === id);
  const platform = (id) => T.platforms.find((p) => p.id === id);
  assert.deepEqual(T.lines.map((l) => [l.id, l.directions]), [['L1', ['L1-0', 'L1-1']], ['L2', ['L2-0', 'L2-1']]]);
  assert.equal(station('queen').osm, 34710077); assert.equal(station('king').osm, 34710076);
  assert.notEqual(station('queens-park'), undefined, "Queen's Park is its own station, never Queen");
  assert.deepEqual(station('bloor-yonge').lines, ['L1', 'L2'], 'GTFS Bloor and Yonge are one interchange');
  assert.deepEqual(station('st-george').lines, ['L1', 'L2']);
  // GTFS stop ids and the TTC's own platform names
  assert.deepEqual([platform('queen/L1-0').gtfsStopId, platform('queen/L1-0').compass], ['13811', 'Southbound']);
  assert.deepEqual([platform('king/L1-1').gtfsStopId, platform('king/L1-1').compass], ['13813', 'Northbound']);
  assert.deepEqual([platform('castle-frank/L2-0').gtfsStopId, platform('broadview/L2-1').gtfsStopId], ['13752', '13750']);
  for (const p of T.platforms) assert.match(p.id, /^[a-z0-9-]+\/L\d-[01]$/);
  for (const e of T.stations.flatMap((s) => s.entrances)) assert.match(e.id, /^osm-node\/\d+$/);
  // every segment joins consecutive calls of one direction
  for (const d of T.directions) for (let k = 0; k + 1 < d.calls.length; k++) {
    const id = `${d.id}:${d.calls[k].split('/')[0]}>${d.calls[k + 1].split('/')[0]}`;
    assert.ok(T.segments.some((s) => s.id === id), id);
  }
});

test('track connectivity: right-hand running checked, the gaps reported rather than bridged', () => {
  const T = buildSubwayTopology(inputs);
  for (const p of T.platforms) assert.ok(p.x !== null, `${p.id} lies on its line's track`);
  // every platform but Bay's (Lower Bay's tracks overlap there) is on the right-hand track, 3-12 m from the other
  assert.deepEqual(T.platforms.filter((p) => p.running !== 'right-hand').map((p) => p.id), ['bay/L2-0', 'bay/L2-1']);
  assert.deepEqual(T.segments.filter((s) => !s.continuous).map((s) => s.id).sort(),
    ['L2-0:bay>bloor-yonge', 'L2-1:bay>st-george', 'L2-1:bloor-yonge>bay']);
  for (const s of T.segments.filter((x) => x.continuous)) {
    assert.ok(s.length > 300 && s.length < 1000, `${s.id} ${s.length} m`);
    assert.ok(s.osmWays.length > 0);
  }
  // sidings, crossovers and the yard never join a passenger chain
  const passenger = new Set(trackChains(inputs.subway.ways).flatMap((c) => c.ways));
  for (const w of inputs.subway.ways) if (w[3]) assert.equal(passenger.has(w[5]), false, `${w[3]} ${w[5]}`);
});

test('supported rides: both directions, consecutive stations, depth profiles within the game\'s grade limit', () => {
  const T = buildSubwayTopology(inputs);
  assert.deepEqual(T.summary.rides, ['l2-castle-frank-broadview', 'l1-queen-king']);
  assert.deepEqual(T.summary.problems, []);
  const viaduct = T.rides.find((r) => r.id === 'l2-castle-frank-broadview');
  assert.deepEqual(viaduct.directions.map((d) => d.segment), ['L2-0:castle-frank>broadview', 'L2-1:broadview>castle-frank']);
  const ride = T.rides.find((r) => r.id === 'l1-queen-king');
  assert.deepEqual(ride.directions.map((d) => [d.segment, d.compass]), [['L1-0:queen>king', 'Southbound'], ['L1-1:king>queen', 'Northbound']]);
  for (const d of ride.directions) {
    assert.ok(d.calls[1] - d.calls[0] > 440 && d.calls[1] - d.calls[0] < 480, 'Queen to King is about 461 m');
    assert.ok(d.calls[0] >= 400 && d.length - d.calls[1] >= 200, 'room to approach and to run out');
    assert.ok(d.grade <= 0.04);
    for (const sag of d.platformSag) assert.ok(sag < 0.6, 'the platforms are straight');
    for (const [, y] of d.profile) assert.equal(y, -10.6, 'rail top 10.6 m under the street (assumed, docs/subway-topology.md)');
  }
  const king = T.stations.find((s) => s.id === 'king');
  assert.equal(king.facts.depth.platformFloor.basis, 'assumed', 'no published depth: flagged as an assumption');
  assert.ok(king.facts.sources.some((u) => u.includes('ttc.ca/subway-stations/king-station')));
});

test('a ride whose facts are missing or whose stations are not consecutive is refused, not guessed', () => {
  const rides = [{ id: 'l1-queen-union', line: 'L1', stations: ['queen', 'union'], geometry: 'track' },
    { id: 'l1-king-union', line: 'L1', stations: ['king', 'union'], geometry: 'track' }];
  const T = buildSubwayTopology({ ...inputs, rides });
  const [skip, noDepth] = T.rides;
  assert.equal(skip.supported, false); assert.ok(skip.problems.some((p) => /not consecutive/.test(p)));
  assert.equal(noDepth.supported, false); assert.ok(noDepth.problems.includes('union: no station facts'));
});
