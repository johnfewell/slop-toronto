#!/usr/bin/env node
// tools/build-biidaasige-path-network.mjs
// Builds js/biidaasige-path-network-data.js from the CHECKED-IN source fixture
//   tools/fixtures/biidaasige-path-network.json
//
// That fixture is a current OpenStreetMap Overpass geometry extract (fetched 2026-11-10) for the Biidaasige
// Park bbox: every way with highway=footway|path|cycleway|steps, every barrier=gate node, and every
// leisure=fitness_station|playground feature. The generator clips the ways to the committed park polygon
// (segment/boundary intersections, NOT a centroid filter), preserves the native bridge tags, densifies long
// source segments so no rendered line jumps a large gap, and records the source point counts.
//
// It does NOT render, place a mesh, invent a width, or invent a step height. Widths are copied from an OSM
// width tag when present; otherwise widthM is null. Steps keep their source step_count (or null) and a
// riser profile that is explicitly unknown — a flat y=0 is never asserted to be the real stair.
//
//   node tools/build-biidaasige-path-network.mjs          # write js/biidaasige-path-network-data.js
//   node tools/build-biidaasige-path-network.mjs --check  # exit 1 if the committed file is stale
//
// Data © OpenStreetMap contributors (ODbL 1.0). See docs/biidaasige-path-network.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_PATH = 'tools/fixtures/biidaasige-path-network.json';
const OUTPUT_PATH = 'js/biidaasige-path-network-data.js';

// A source line is sampled at most every 20 m. This is a sampling step along the SOURCE segment (new points
// lie exactly on the source line); it is not a surveyed or guessed position.
const MAX_GAP_M = 20;
// Coarse east/west label for the park's 2025 (eastern) and 2026 (western expansion) phases. The official
// maps do not publish the phase boundary as coordinates; this meridian falls between the westernmost 2025
// mapped park path and the easternmost 2026 west-expansion path. It is an ESTIMATE, reported as such.
const PHASE_WEST_BOUNDARY_LON = -79.3525;
// A gate farther than this from the park polygon is reported as bbox context, not as a park gate.
const GATE_ADJACENT_M = 30;

const M_PER_DEG_LAT = 111320;
const DEG = Math.PI / 180;

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const fixture = JSON.parse(read(FIXTURE_PATH));

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

// ---------------------------------------------------------------------------------------------------------------
// Planar lon/lat helpers. At this scale lon/lat is an affine plane; intersections are invariant under the
// affine scale, so the crossover parameters are correct. Distances use metres via the local cos(lat) scale.
function ringXY(polygon) {
  return polygon.map(([lat, lon]) => ({ x: lon, y: lat }));
}
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointOnBoundary(x, y, ring, eps = 1e-9) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    if (Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)) < eps) return true;
  }
  return false;
}
function insidePark(x, y, ring) {
  return pointInRing(x, y, ring) || pointOnBoundary(x, y, ring);
}
function segmentIntersectionT(p, q, a, b) {
  const rx = q.x - p.x, ry = q.y - p.y, sx = b.x - a.x, sy = b.y - a.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-16) return null;
  const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / den;
  const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / den;
  if (t < -1e-12 || t > 1 + 1e-12 || u < -1e-12 || u > 1 + 1e-12) return null;
  return Math.max(0, Math.min(1, t));
}
function cumulativeDistances(points) {
  const c = [0];
  for (let i = 0; i < points.length - 1; i++) c.push(c[i] + Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y));
  return c;
}
function pointAtFraction(points, cum, t) {
  const total = cum[cum.length - 1];
  if (total === 0) return { x: points[0].x, y: points[0].y };
  const target = t * total;
  for (let i = 0; i < points.length - 1; i++) {
    if (target <= cum[i + 1] || i === points.length - 2) {
      const span = cum[i + 1] - cum[i];
      const f = span === 0 ? 0 : (target - cum[i]) / span;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * f,
        y: points[i].y + (points[i + 1].y - points[i].y) * f
      };
    }
  }
  return points[points.length - 1];
}

// Clip one source polyline to the park polygon. Keeps the ORIGINAL vertices (not just two boundary hits),
// inserts the exact boundary intersections, and returns zero or more contiguous inside runs.
function clipPolyline(latLon, ring) {
  const pts = latLon.map(([lat, lon]) => ({ x: lon, y: lat }));
  if (pts.length < 2) return [];
  const cum = cumulativeDistances(pts);
  const total = cum[cum.length - 1];
  if (total === 0) return [];
  const params = [0, 1];
  for (let i = 1; i < pts.length - 1; i++) params.push(cum[i] / total);
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
      const t = segmentIntersectionT(pts[i], pts[i + 1], ring[j], ring[k]);
      if (t !== null) params.push((cum[i] + t * (cum[i + 1] - cum[i])) / total);
    }
  }
  params.sort((a, b) => a - b);
  const uniq = [];
  for (const t of params) {
    if (!uniq.length || t - uniq[uniq.length - 1] > 1e-9) uniq.push(t);
  }
  const runs = [];
  let current = null;
  for (let i = 0; i < uniq.length - 1; i++) {
    const t0 = uniq[i], t1 = uniq[i + 1];
    if (t1 - t0 < 1e-12) continue;
    const mid = pointAtFraction(pts, cum, (t0 + t1) / 2);
    if (insidePark(mid.x, mid.y, ring)) {
      const a = pointAtFraction(pts, cum, t0);
      const b = pointAtFraction(pts, cum, t1);
      if (!current) current = [];
      if (!current.length || Math.hypot(current[current.length - 1].x - a.x, current[current.length - 1].y - a.y) > 1e-12) {
        current.push(a);
      }
      current.push(b);
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs.map((run) => run.map((p) => [p.y, p.x]));
}

function segmentIntersectsRing(latLon, ring) {
  const pts = latLon.map(([lat, lon]) => ({ x: lon, y: lat }));
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
      if (segmentIntersectionT(pts[i], pts[i + 1], ring[j], ring[k]) !== null) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Distances + densification. Interpolated points lie on the source segment; they are not guesses.
function metresBetween([lat1, lon1], [lat2, lon2]) {
  const mid = (lat1 + lat2) / 2;
  const dx = (lon2 - lon1) * Math.cos(mid * DEG) * M_PER_DEG_LAT;
  const dy = (lat2 - lat1) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}
function polylineLengthM(latLon) {
  let m = 0;
  for (let i = 1; i < latLon.length; i++) m += metresBetween(latLon[i - 1], latLon[i]);
  return m;
}
function densify(latLon, maxGapM) {
  if (latLon.length < 2) return latLon.slice();
  const out = [latLon[0]];
  for (let i = 1; i < latLon.length; i++) {
    const a = latLon[i - 1], b = latLon[i];
    const length = metresBetween(a, b);
    const n = Math.max(1, Math.ceil(length / maxGapM));
    for (let k = 1; k < n; k++) {
      const f = k / n;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    out.push(b);
  }
  return out;
}
function maxGapM(latLon) {
  let max = 0;
  for (let i = 1; i < latLon.length; i++) max = Math.max(max, metresBetween(latLon[i - 1], latLon[i]));
  return max;
}
function centroidLatLon(latLon) {
  let lat = 0, lon = 0;
  for (const p of latLon) { lat += p[0]; lon += p[1]; }
  return { lat: lat / latLon.length, lon: lon / latLon.length };
}
function distanceToRingM(lat, lon, ring) {
  const px = lon, py = lat;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
    const qx = a.x + dx * t, qy = a.y + dy * t;
    best = Math.min(best, metresBetween([py, px], [qy, qx]));
  }
  return best;
}
function ringAreaM2(latLon) {
  if (latLon.length < 3) return 0;
  const lat0 = latLon[0][0];
  const kx = Math.cos(lat0 * DEG) * M_PER_DEG_LAT;
  let area = 0;
  for (let i = 0, j = latLon.length - 1; i < latLon.length; j = i++) {
    const xi = latLon[i][1] * kx, yi = latLon[i][0] * M_PER_DEG_LAT;
    const xj = latLon[j][1] * kx, yj = latLon[j][0] * M_PER_DEG_LAT;
    area += xj * yi - xi * yj;
  }
  return Math.abs(area / 2);
}

// ---------------------------------------------------------------------------------------------------------------
// Validation of the checked-in fixture.
function fail(message) {
  throw new Error(`biidaasige-path-network: ${message}`);
}
if (!fixture || fixture.version !== 1) fail('fixture version');
if (fixture.license !== 'ODbL-1.0') fail('fixture license must be ODbL-1.0');
if (!fixture.attribution || !/OpenStreetMap/.test(fixture.attribution)) fail('fixture attribution missing');
if (!fixture.query || !/43\.642/.test(fixture.query) || !/-79\.359/.test(fixture.query)) fail('fixture query is not the documented bbox query');
if (!fixture.park || fixture.park.ref !== 'way/813717630' || !Array.isArray(fixture.park.polygon) || fixture.park.polygon.length < 3) {
  fail('fixture park polygon missing');
}
const ring = ringXY(fixture.park.polygon);
if (!fixture.ways.length) fail('fixture has no ways');

const dropped = [];
const bridgeDropped = [];
const ways = [];
let stepWays = 0;
const phases = { 2025: 0, 2026: 0 };

// ---------------------------------------------------------------------------------------------------------------
// Ways: clip (non-bridge) or preserve the full native bridge line, then densify.
for (const raw of fixture.ways.slice().sort((a, b) => Number(a.id.split('/')[1]) - Number(b.id.split('/')[1]))) {
  if (!/^way\/\d+$/.test(raw.id)) fail(`bad way id ${raw.id}`);
  const tags = Object.assign({}, raw.tags || {});
  const latLon = raw.geometry.map(([lat, lon]) => [Number(lat), Number(lon)]);
  if (latLon.some(([lat, lon]) => !isNum(lat) || !isNum(lon))) fail(`${raw.id}: non-finite geometry`);
  const bridge = Boolean(tags.bridge && tags.bridge !== 'no');
  const anyInside = latLon.some(([lat, lon]) => insidePark(lon, lat, ring));

  let runs;
  if (bridge) {
    const reachesPark = anyInside || segmentIntersectsRing(latLon, ring);
    if (!reachesPark) { dropped.push(raw.id); bridgeDropped.push(raw.id); continue; }
    runs = [latLon];
  } else {
    runs = clipPolyline(latLon, ring);
    if (!runs.length) { dropped.push(raw.id); continue; }
  }

  runs.forEach((run, part) => {
    const dense = densify(run, MAX_GAP_M);
    const centroid = centroidLatLon(dense);
    const phase = centroid.lon < PHASE_WEST_BOUNDARY_LON ? '2026' : '2025';
    phases[phase]++;
    const width = Number.parseFloat(tags.width);
    const widthM = Number.isFinite(width) && width > 0 ? width : null;
    const isSteps = tags.highway === 'steps';
    const stepCountTag = Number.parseInt(tags.step_count, 10);
    const stepCount = Number.isFinite(stepCountTag) && stepCountTag > 0 ? stepCountTag : null;
    if (isSteps) stepWays++;
    const id = runs.length > 1 ? `${raw.id}#${part + 1}` : raw.id;
    ways.push({
      id,
      sourceurl: `https://www.openstreetmap.org/${raw.id}`,
      tags,
      name: tags.name || null,
      highway: tags.highway || null,
      surface: tags.surface || null,
      phase,
      phaseConfidence: 'estimated-location',
      phaseBasis: `centroid longitude west of ${PHASE_WEST_BOUNDARY_LON}`,
      bridge,
      layer: tags.layer || null,
      widthM,
      widthSource: widthM === null ? 'not-published' : 'osm-width-tag',
      stepCount,
      stepCountSource: isSteps ? (stepCount === null ? 'not-tagged' : 'osm-step_count') : null,
      riserProfile: isSteps ? null : undefined,
      stepHeightStatus: isSteps ? 'unknown-do-not-assume-zero' : undefined,
      polyline: dense,
      sourcePointCount: run.length,
      pointCount: dense.length,
      lengthM: round(polylineLengthM(dense), 1),
      maxPointGapM: round(maxGapM(dense), 1)
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Gates. Every fetched gate is kept as a real source position; none is invented or moved onto the park.
const gates = fixture.gates.map((gate) => {
  if (!/^node\/\d+$/.test(gate.id)) fail(`bad gate id ${gate.id}`);
  const inPark = insidePark(gate.lon, gate.lat, ring);
  const distance = round(distanceToRingM(gate.lat, gate.lon, ring), 1);
  const phase = gate.lon < PHASE_WEST_BOUNDARY_LON ? '2026' : '2025';
  return {
    id: gate.id,
    sourceurl: `https://www.openstreetmap.org/${gate.id}`,
    lat: gate.lat,
    lon: gate.lon,
    tags: Object.assign({}, gate.tags || {}),
    phase,
    spatialStatus: inPark ? 'in-park' : (distance <= GATE_ADJACENT_M ? 'adjacent' : 'context'),
    insidePark: inPark,
    distanceToParkM: distance
  };
});
const gatesInsidePark = gates.filter((g) => g.insidePark).length;

function polygonFeature(feature) {
  const latLon = (feature.geometry || []).map(([lat, lon]) => [Number(lat), Number(lon)]);
  if (latLon.length < 3) fail(`${feature.id}: polygon geometry missing`);
  const centroid = centroidLatLon(latLon);
  const inPark = latLon.every(([lat, lon]) => insidePark(lon, lat, ring));
  const phase = centroid.lon < PHASE_WEST_BOUNDARY_LON ? '2026' : '2025';
  return {
    id: feature.id,
    sourceurl: `https://www.openstreetmap.org/${feature.id}`,
    tags: Object.assign({}, feature.tags || {}),
    name: (feature.tags && feature.tags.name) || null,
    phase,
    phaseConfidence: 'estimated-location',
    geometryType: 'polygon',
    insidePark: inPark,
    centroid,
    areaM2: round(ringAreaM2(latLon), 1),
    polyline: latLon,
    sourcePointCount: latLon.length
  };
}
const fitness = fixture.fitness.map((f) => {
  if (!/^(node|way)\/\d+$/.test(f.id)) fail(`bad fitness id ${f.id}`);
  return {
    id: f.id,
    sourceurl: `https://www.openstreetmap.org/${f.id}`,
    tags: Object.assign({}, f.tags || {}),
    lat: f.lat,
    lon: f.lon,
    phase: (f.lon ?? 0) < PHASE_WEST_BOUNDARY_LON ? '2026' : '2025',
    geometryType: f.geometry && f.geometry.length ? 'polygon' : 'point',
    polyline: (f.geometry || []).map(([lat, lon]) => [lat, lon])
  };
});
const playEquipment = fixture.playgrounds.map(polygonFeature);

// ---------------------------------------------------------------------------------------------------------------
// Unresolved: things this source extract cannot honestly resolve.
const unresolved = [];
if (bridgeDropped.length) {
  unresolved.push({
    id: 'bridge-ways-outside-park',
    kind: 'bridge',
    ids: bridgeDropped,
    count: bridgeDropped.length,
    reason: 'Bridge-tagged ways in the fetch bbox that do not reach or cross the park polygon are excluded; no bridge deck is invented.'
  });
}
if (dropped.length) {
  unresolved.push({
    id: 'source-ways-outside-park',
    kind: 'clip',
    ids: dropped,
    count: dropped.length,
    reason: `Source ways in the bbox with no segment inside the park polygon were dropped (${dropped.length}); their geometry is preserved in the checked-in fixture. No centroid-only or outside support is kept.`
  });
}
if (fitness.length === 0) {
  unresolved.push({
    id: 'outdoor-fitness-equipment',
    kind: 'fitness',
    count: 0,
    reason: 'The City lists Outdoor Fitness Equipment west of Cableway Canyon, but the 2026-11-10 OSM extract has no leisure=fitness_station feature in the fetch bbox. No position is guessed.',
    source: 'https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/biidaasige-park/recreation-at-biidaasige-park/'
  });
}
if (gates.length && gatesInsidePark === 0) {
  unresolved.push({
    id: 'park-gates',
    kind: 'gate',
    ids: gates.map((g) => g.id),
    count: gates.length,
    reason: 'All barrier=gate nodes in the fetch bbox lie outside the park polygon (73-410 m). They are real OSM positions but are surrounding-street context, not mapped park gates; none is moved onto the park.'
  });
}
if (stepWays) {
  unresolved.push({
    id: 'steps-riser-profile',
    kind: 'steps',
    count: stepWays,
    reason: 'Step ways keep their OSM step_count where tagged (null otherwise). The actual riser/tread profile and elevation change are not published in this source, so no height is asserted and y=0 is never treated as the real stair.'
  });
}
unresolved.push({
  id: 'phase-boundary',
  kind: 'phase',
  reason: `Park phase is an ESTIMATE by location (centroid longitude west of ${PHASE_WEST_BOUNDARY_LON} = 2026 western expansion, else 2025 eastern park). The official maps do not publish the phase boundary as coordinates.`
});

// ---------------------------------------------------------------------------------------------------------------
// Output data.
const DATA = {
  version: 1,
  generatedBy: 'tools/build-biidaasige-path-network.mjs',
  source: fixture.source,
  sourceUrl: fixture.sourceUrl,
  osmBaseTimestamp: fixture.osmBaseTimestamp,
  fetchedOn: fixture.fetchedOn,
  license: fixture.license,
  licenseUrl: fixture.licenseUrl,
  attribution: fixture.attribution,
  bbox: fixture.bbox,
  query: fixture.query,
  park: { ref: fixture.park.ref, polygon: fixture.park.polygon },
  diagnostics: {
    sourceWays: fixture.ways.length,
    keptWays: ways.length,
    droppedWays: dropped.length,
    bridgeWays: ways.filter((w) => w.bridge).length,
    stepWays,
    gates: gates.length,
    gatesInsidePark,
    fitness: fitness.length,
    playEquipment: playEquipment.length,
    phases,
    maxPointGapM: MAX_GAP_M,
    phaseWestBoundaryLon: PHASE_WEST_BOUNDARY_LON
  },
  ways,
  gates,
  fitness,
  playEquipment,
  unresolved
};

const MODULE = `// js/biidaasige-path-network-data.js: generated by tools/build-biidaasige-path-network.mjs from the
// checked-in Overpass geometry fixture. DO NOT EDIT. Data © OpenStreetMap contributors (ODbL 1.0).
// See docs/biidaasige-path-network.md.
//
// C.BIIDAASIGE_PATH_NETWORK is the complete clipped park path source (lat/lon). C.biidaasigePathNetworkWorld()
// is a pure projection through the ACTIVE window.CITY.worldFromLatLon at call time; it returns null when that
// projection is absent. Nothing here renders, places a mesh or asserts a step height.
(function () {
  if (typeof window === 'undefined' || !window.CITY) return;
  var C = window.CITY;
  var DATA = ${JSON.stringify(DATA)};
  var isNum = function (v) { return typeof v === 'number' && Number.isFinite(v); };
  var project = function (lat, lon) {
    if (typeof C.worldFromLatLon !== 'function' || !isNum(lat) || !isNum(lon)) return null;
    var p = C.worldFromLatLon(lat, lon);
    return p && isNum(p.x) && isNum(p.z) ? { x: p.x, z: p.z } : null;
  };
  var copyTags = function (t) { return Object.assign({}, t || {}); };
  C.BIIDAASIGE_PATH_NETWORK = DATA;
  C.biidaasigePathNetworkProjectionAvailable = function () { return typeof C.worldFromLatLon === 'function'; };
  C.biidaasigePathNetworkWorld = function () {
    if (typeof C.worldFromLatLon !== 'function') return null;
    var ways = DATA.ways.map(function (w) {
      var line = [];
      var ok = true;
      for (var i = 0; i < w.polyline.length; i++) {
        var p = project(w.polyline[i][0], w.polyline[i][1]);
        if (!p) { ok = false; break; }
        line.push(p);
      }
      return {
        id: w.id, sourceurl: w.sourceurl, tags: copyTags(w.tags), name: w.name, highway: w.highway,
        surface: w.surface, phase: w.phase, phaseConfidence: w.phaseConfidence, phaseBasis: w.phaseBasis,
        bridge: w.bridge, layer: w.layer, widthM: w.widthM, widthSource: w.widthSource,
        stepCount: w.stepCount, stepCountSource: w.stepCountSource, riserProfile: w.riserProfile,
        stepHeightStatus: w.stepHeightStatus, sourcePointCount: w.sourcePointCount,
        pointCount: w.pointCount, lengthM: w.lengthM, maxPointGapM: w.maxPointGapM,
        projected: ok, polyline: ok ? line : null
      };
    });
    var pointWorld = function (o) {
      var p = project(o.lat, o.lon);
      return Object.assign({}, o, { tags: copyTags(o.tags), x: p ? p.x : null, z: p ? p.z : null, projected: !!p });
    };
    var ringWorld = function (o) {
      var line = [], ok = true;
      for (var i = 0; i < o.polyline.length; i++) {
        var p = project(o.polyline[i][0], o.polyline[i][1]);
        if (!p) { ok = false; break; }
        line.push(p);
      }
      return Object.assign({}, o, { tags: copyTags(o.tags), projected: ok, ring: ok ? line : null });
    };
    return {
      available: true,
      attribution: DATA.attribution,
      license: DATA.license,
      ways: ways,
      gates: DATA.gates.map(pointWorld),
      fitness: DATA.fitness.map(function (f) { return f.polyline && f.polyline.length ? ringWorld(f) : pointWorld(f); }),
      playEquipment: DATA.playEquipment.map(ringWorld),
      unresolved: DATA.unresolved.map(function (u) { return Object.assign({}, u, { ids: u.ids ? u.ids.slice() : undefined }); })
    };
  };
})();
`;

const target = path.join(ROOT, OUTPUT_PATH);
const check = process.argv.includes('--check');
let current = null;
try { current = read(OUTPUT_PATH); } catch { current = null; }
if (check) {
  if (current !== MODULE) {
    console.error(`${OUTPUT_PATH} is stale; run node tools/build-biidaasige-path-network.mjs`);
    process.exit(1);
  }
  console.log(`${OUTPUT_PATH} is current (${ways.length} ways, ${gates.length} gates, ${playEquipment.length} play areas)`);
} else {
  fs.writeFileSync(target, MODULE);
  console.log(`wrote ${OUTPUT_PATH}: ${ways.length} clipped ways (${ways.filter((w) => w.bridge).length} bridges), ` +
    `${gates.length} gates (${gatesInsidePark} in-park), ${fitness.length} fitness, ${playEquipment.length} play areas, ` +
    `${dropped.length} dropped source ways, max gap ${MAX_GAP_M} m`);
}
