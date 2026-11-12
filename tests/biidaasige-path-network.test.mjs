// Biidaasige Park full path network (js/biidaasige-path-network-data.js, bead st-bmyv.7) — source/product tests.
//
// These pin the honest contract of the NEW full-network layer (the three-named-path runtime is separate):
//   - the checked-in fixture is a real OSM Overpass geometry extract with ODbL attribution;
//   - the generator clips every way to the committed park polygon at SEGMENT/BOUNDARY intersections (not a
//     centroid filter), keeps the native bridge lines, and densifies long segments to a safe gap;
//   - every non-bridge line vertex is inside or on the park polygon; bridge ways are the only exception;
//   - gates/fitness/playEquipment keep their actual source positions (no moved or guessed point);
//   - steps record their source step_count but never assert a riser height (no y=0 illusion);
//   - the world view is a pure projection through the ACTIVE C.worldFromLatLon and returns null without it;
//   - the generated file is deterministic and in sync with the generator.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(ROOT + p, 'utf8');
const FIXTURE = JSON.parse(read('tools/fixtures/biidaasige-path-network.json'));

function city({ withPark = true, withNetwork = true } = {}) {
  const ctx = { window: { CITY: {} }, console: { info() {}, warn() {}, log() {}, error() {} }, performance };
  vm.createContext(ctx);
  vm.runInContext(read('js/toronto-geodata.js'), ctx, { filename: 'toronto-geodata.js' });
  const C = ctx.window.CITY;
  const P = C.GEO.frame.projection;
  C.CITY_BOUNDS = { minX: -7900, maxX: 3700, minZ: -3000, maxZ: 3600, sidewalkHeight: 0.22, waterLevel: -0.7 };
  C.worldFromLatLon = (lat, lon) => {
    const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
    const c = Math.cos(P.theta), s = Math.sin(P.theta);
    return { x: e * c - n * s - P.ox, z: -(e * s + n * c) - P.oz };
  };
  if (withPark) vm.runInContext(read('js/biidaasige-park-data.js'), ctx, { filename: 'biidaasige-park-data.js' });
  if (withNetwork) vm.runInContext(read('js/biidaasige-path-network-data.js'), ctx, { filename: 'biidaasige-path-network-data.js' });
  return C;
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1], zi = ring[i][0], xj = ring[j][1], zj = ring[j][0];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function onBoundary(x, z, ring, eps = 1e-7) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const ax = a[1], az = a[0], bx = b[1], bz = b[0];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < eps) return true;
  }
  return false;
}
function insideOrBoundary(lat, lon, ring) {
  return pointInRing(lon, lat, ring) || onBoundary(lon, lat, ring);
}
function segmentCrossesRing(latLon, ring) {
  const pts = latLon.map(([lat, lon]) => ({ x: lon, y: lat }));
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
      const p = pts[i], q = pts[i + 1], a = { x: ring[j][1], y: ring[j][0] }, b = { x: ring[k][1], y: ring[k][0] };
      const rx = q.x - p.x, ry = q.y - p.y, sx = b.x - a.x, sy = b.y - a.y;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-16) continue;
      const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / den;
      const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / den;
      if (t >= -1e-12 && t <= 1 + 1e-12 && u >= -1e-12 && u <= 1 + 1e-12) return true;
    }
  }
  return false;
}
function metres(a, b) {
  const mid = (a[0] + b[0]) / 2;
  const dx = (b[1] - a[1]) * Math.cos((mid * Math.PI) / 180) * 111320;
  const dy = (b[0] - a[0]) * 111320;
  return Math.hypot(dx, dy);
}
function maxGap(latLon) {
  let max = 0;
  for (let i = 1; i < latLon.length; i++) max = Math.max(max, metres(latLon[i - 1], latLon[i]));
  return max;
}

test('fixture: real OSM geometry, ODbL attribution, committed park polygon, documented bbox query', () => {
  assert.equal(FIXTURE.license, 'ODbL-1.0');
  assert.match(FIXTURE.attribution, /OpenStreetMap contributors/);
  assert.match(FIXTURE.sourceUrl, /overpass-api\.de/);
  assert.match(FIXTURE.query, /43\.642\s*,\s*-79\.359\s*,\s*43\.650\s*,\s*-79\.341/);
  assert.deepEqual(FIXTURE.bbox, { minLat: 43.642, minLon: -79.359, maxLat: 43.65, maxLon: -79.341 });
  assert.equal(FIXTURE.park.ref, 'way/813717630');
  assert.ok(FIXTURE.ways.length >= 300, 'the broad ways fetch is checked in');
  assert.equal(FIXTURE.gates.length, 9, '9 barrier=gate nodes');
  assert.equal(FIXTURE.playgrounds.length, 2, '2 playground areas');
  assert.equal(FIXTURE.fitness.length, 0, 'no OSM fitness station in this extract');
  // The fixture polygon is exactly the committed park polygon, so the clip source is not a second polygon.
  const C = city();
  assert.equal(JSON.stringify(FIXTURE.park.polygon), JSON.stringify(C.BIIDAASIGE_PARK.park.polygon));
  for (const w of FIXTURE.ways) {
    assert.match(w.id, /^way\/\d+$/);
    assert.ok(Array.isArray(w.geometry) && w.geometry.length >= 2, `${w.id} has geometry`);
    assert.ok(w.geometry.every((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])), `${w.id} finite source points`);
  }
});

test('generator: deterministic and the committed data file is in sync (--check)', () => {
  const out = execFileSync(process.execPath, ['tools/build-biidaasige-path-network.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /is current/);
});

test('network: full clipped park network, phases, source URLs and attribution', () => {
  const C = city();
  const D = C.BIIDAASIGE_PATH_NETWORK;
  assert.equal(D.license, 'ODbL-1.0');
  assert.match(D.attribution, /OpenStreetMap contributors/);
  assert.equal(D.diagnostics.sourceWays, FIXTURE.ways.length);
  assert.equal(D.diagnostics.keptWays + D.diagnostics.droppedWays, D.diagnostics.sourceWays, 'every source way is accounted for');
  assert.ok(D.ways.length >= 150, `keeps the full network, not just 3 named paths (${D.ways.length})`);
  assert.ok(D.ways.filter((w) => w.bridge).length === 13, '13 bridge ways reach the park');
  assert.ok(D.ways.filter((w) => w.highway === 'steps').length === 14, '14 step ways');
  assert.equal(D.diagnostics.phases['2025'] + D.diagnostics.phases['2026'], D.ways.length);
  for (const w of D.ways) {
    assert.match(w.id, /^way\/\d+(#\d+)?$/);
    assert.equal(w.sourceurl, `https://www.openstreetmap.org/${w.id.split('#')[0]}`);
    assert.ok(['2025', '2026'].includes(w.phase), `${w.id} phase`);
    assert.equal(w.phaseConfidence, 'estimated-location');
    assert.ok(Array.isArray(w.polyline) && w.polyline.length >= 2, `${w.id} polyline`);
    assert.ok(w.polyline.every((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])), `${w.id} lat/lon only`);
    assert.ok(w.widthM === null || (typeof w.widthM === 'number' && w.widthM > 0), `${w.id} width is explicit or null`);
    assert.ok(['osm-width-tag', 'not-published'].includes(w.widthSource));
  }
});

test('clip: every NON-BRIDGE line is inside or on the park polygon; bridges are the only exception', () => {
  const C = city();
  const D = C.BIIDAASIGE_PATH_NETWORK;
  const ring = C.BIIDAASIGE_PARK.park.polygon;
  let clippedPartials = 0;
  for (const w of D.ways) {
    const source = FIXTURE.ways.find((f) => f.id === w.id.split('#')[0]);
    assert.ok(source, `${w.id} has a source way`);
    if (w.bridge) {
      assert.ok(w.tags.bridge && w.tags.bridge !== 'no', `${w.id} bridge tag preserved`);
      assert.ok(
        w.polyline.some(([lat, lon]) => insideOrBoundary(lat, lon, ring)) || segmentCrossesRing(w.polyline, ring),
        `${w.id} bridge reaches or crosses the park`
      );
      continue;
    }
    for (const [lat, lon] of w.polyline) {
      assert.ok(insideOrBoundary(lat, lon, ring), `${w.id} vertex ${lat},${lon} is inside/on the park`);
    }
    if (w.sourcePointCount < source.geometry.length) clippedPartials++;
  }
  assert.ok(clippedPartials > 0, 'at least one way was actually clipped at a boundary (not a centroid filter)');
});

test('clip: max point gap is safe after source-line densification', () => {
  const C = city();
  const D = C.BIIDAASIGE_PATH_NETWORK;
  const limit = D.diagnostics.maxPointGapM + 0.05;
  let densified = 0;
  for (const w of D.ways) {
    const gap = maxGap(w.polyline);
    assert.ok(gap <= limit, `${w.id} max gap ${gap.toFixed(2)} m <= ${limit} m`);
    assert.ok(w.maxPointGapM <= limit, `${w.id} recorded max gap`);
    if (w.pointCount > w.sourcePointCount) densified++;
  }
  assert.ok(densified > 0, 'long source segments were sampled (interpolated on the source line)');
});

test('clip: no extra out-of-park support — a dropped way is not represented by its centroid or a fragment', () => {
  const C = city();
  const D = C.BIIDAASIGE_PATH_NETWORK;
  const ring = C.BIIDAASIGE_PARK.park.polygon;
  const keptIds = new Set(D.ways.map((w) => w.id.split('#')[0]));
  const dropped = FIXTURE.ways.filter((w) => !keptIds.has(w.id));
  assert.equal(dropped.length, D.diagnostics.droppedWays);
  for (const w of dropped) {
    assert.ok(
      !w.geometry.some(([lat, lon]) => pointInRing(lon, lat, ring) && !onBoundary(lon, lat, ring, 1e-9)) || w.tags.bridge,
      `${w.id} was dropped only because it has no in-park interior support`
    );
  }
  const droppedIds = new Set(dropped.map((w) => w.id));
  const report = D.unresolved.find((u) => u.id === 'source-ways-outside-park');
  assert.ok(report && report.count === dropped.length, 'the drop count is reported, not hidden');
  for (const id of (report.ids || [])) assert.ok(droppedIds.has(id), `${id} is a real dropped way`);
});

test('positions: gates, fitness and playgrounds are the actual source positions, never moved onto the park', () => {
  const C = city();
  const D = C.BIIDAASIGE_PATH_NETWORK;
  const ring = C.BIIDAASIGE_PARK.park.polygon;
  assert.equal(D.gates.length, FIXTURE.gates.length);
  for (const g of D.gates) {
    const src = FIXTURE.gates.find((f) => f.id === g.id);
    assert.ok(src, `${g.id} is a fetched node`);
    assert.equal(g.lat, src.lat);
    assert.equal(g.lon, src.lon);
    assert.equal(g.sourceurl, `https://www.openstreetmap.org/${g.id}`);
    assert.equal(typeof g.insidePark, 'boolean');
    assert.ok(typeof g.distanceToParkM === 'number' && g.distanceToParkM >= 0);
    assert.equal(g.insidePark, insideOrBoundary(g.lat, g.lon, ring));
  }
  assert.equal(D.fitness.length, 0, 'OSM has no fitness station here; none is invented');
  assert.ok(D.unresolved.some((u) => u.id === 'outdoor-fitness-equipment'), 'the official-but-unplaced fitness is recorded');
  assert.equal(D.playEquipment.length, 2);
  for (const p of D.playEquipment) {
    assert.ok(p.insidePark, `${p.id} is inside the park polygon`);
    for (const [lat, lon] of p.polyline) assert.ok(insideOrBoundary(lat, lon, ring), `${p.id} source ring on the park`);
  }
  assert.ok(D.playEquipment.some((p) => p.name === 'Reaching Raccoon'));
});

test('steps: source step_count is kept where tagged, but no riser height or y=0 profile is asserted', () => {
  const C = city();
  const D = C.BIIDAASIGE_PATH_NETWORK;
  const steps = D.ways.filter((w) => w.highway === 'steps');
  assert.ok(steps.length > 0);
  let tagged = 0;
  for (const w of steps) {
    assert.equal(w.riserProfile, null, `${w.id} riser profile unknown`);
    assert.equal(w.stepHeightStatus, 'unknown-do-not-assume-zero');
    assert.ok(['osm-step_count', 'not-tagged'].includes(w.stepCountSource));
    if (w.stepCountSource === 'osm-step_count') {
      assert.ok(Number.isInteger(w.stepCount) && w.stepCount > 0, `${w.id} positive source step_count`);
      tagged++;
    } else {
      assert.equal(w.stepCount, null);
    }
    assert.ok(w.polyline.every((p) => p.length === 2), `${w.id} has no invented elevation ordinate`);
  }
  assert.ok(tagged > 0, 'at least one step way keeps its real OSM step_count');
  assert.ok(D.unresolved.some((u) => u.id === 'steps-riser-profile'));
});

test('phase is an explicit location estimate, not a fabricated opening fact', () => {
  const C = city();
  const D = C.BIIDAASIGE_PATH_NETWORK;
  for (const w of D.ways) {
    assert.ok(['2025', '2026'].includes(w.phase));
    assert.match(w.phaseBasis, /centroid longitude/);
  }
  const u = D.unresolved.find((x) => x.id === 'phase-boundary');
  assert.ok(u && /ESTIMATE/.test(u.reason));
});

test('world view: pure projection through the ACTIVE C.worldFromLatLon; null when projection is absent', () => {
  const C = city();
  const before = JSON.stringify(C.BIIDAASIGE_PATH_NETWORK);
  const world = C.biidaasigePathNetworkWorld();
  assert.ok(world && world.available === true);
  assert.equal(world.ways.length, C.BIIDAASIGE_PATH_NETWORK.ways.length);
  assert.equal(world.gates.length, 9);
  assert.equal(world.playEquipment.length, 2);
  const first = C.BIIDAASIGE_PATH_NETWORK.ways[0];
  const p = C.worldFromLatLon(first.polyline[0][0], first.polyline[0][1]);
  assert.equal(JSON.stringify(world.ways[0].polyline[0]), JSON.stringify(p));
  for (const g of world.gates) {
    const q = C.worldFromLatLon(g.lat, g.lon);
    assert.equal(JSON.stringify({ x: g.x, z: g.z }), JSON.stringify(q));
  }
  // pure: the source is not mutated, and the returned objects are new
  assert.equal(JSON.stringify(C.BIIDAASIGE_PATH_NETWORK), before);
  assert.notEqual(world.ways[0], C.BIIDAASIGE_PATH_NETWORK.ways[0]);
  assert.notEqual(world.ways[0].polyline, C.BIIDAASIGE_PATH_NETWORK.ways[0].polyline);
  // absent projection -> null, never fabricated coordinates
  delete C.worldFromLatLon;
  assert.equal(C.biidaasigePathNetworkWorld(), null);
});

test('the data module never throws without park data and leaves all unrelated CITY keys untouched', () => {
  const C = city({ withPark: false });
  assert.ok(C.BIIDAASIGE_PATH_NETWORK, 'network data still loads without the park catalog');
  assert.ok(Array.isArray(C.BIIDAASIGE_PATH_NETWORK.ways));
  const keys = Object.keys(C);
  assert.ok(keys.includes('GEO'), 'shared geodata untouched');
  assert.ok(!keys.includes('BIIDAASIGE_PATHS'), 'the three-path module was not executed or edited here');
});
