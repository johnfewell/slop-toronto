// The road-width rule (tools/geo-blocks.mjs, tools/road-surfaces.mjs) and the surveyed Port Lands road surfaces
// (tools/fixtures/road-surfaces.json), docs/road-widths.md: the rule's pieces on made-up data, the fixture's contract,
// and both on the committed city.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  FIXTURE, KINDS, ROADWAY_KINDS, bridgeWidths, loadRoadSurfaces, lonLatArea, retireCityRoadway, surfaceNear, widthProfile,
  cycleTrackIndex, trackClearance
} from '../tools/road-surfaces.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
let GEO = null;
const geo = () => {
  if (!GEO) {
    const c = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/toronto-geodata.js'), 'utf8'), c);
    GEO = c.window.CITY.GEO;
  }
  return GEO;
};
/** lon/lat -> world metres, from the committed geodata's own projection */
function toWorld(lon, lat) {
  const P = geo().frame.projection;
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
  const c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
}
const flatIn = (f, x, z) => {
  let ins = false;
  for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
    const xi = f[i], zi = f[i + 1], xj = f[j], zj = f[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
};

// ---- the rule ---------------------------------------------------------------------------------------------------------

test('widthProfile: own width where nothing is mapped, the connector from TAPER on, a straight taper between', () => {
  const samples = Array.from({ length: 41 }, (_, i) => [i, 0, i]); // 40 m of road, a sample a metre
  const open = samples.map((_, i) => i >= 20); // the second half has no mapped surface
  const r = widthProfile(samples, open, 4, 2, 8);
  assert.equal(r[40], 4);
  assert.equal(r[20], 4);
  assert.equal(r[16], 3); // 4 m from the open stretch: half way down the 8 m taper
  assert.equal(r[12], 2);
  assert.equal(r[0], 2);
  for (let i = 1; i < r.length; i++) assert.ok(r[i] >= r[i - 1], 'monotonic towards the open stretch');
  assert.deepEqual(widthProfile(samples, samples.map(() => false), 4, 2, 8), samples.map(() => 2), 'a mapped road keeps the connector');
  assert.deepEqual(widthProfile(samples, samples.map(() => true), 4, 2, 8), samples.map(() => 4), 'an unmapped road is its own width');
});

test('surfaceNear: a mapped cell inside the reach counts, one beyond it does not', () => {
  const raster = { res: 1, x0: 0, z0: 0, w: 20, h: 20, d: new Uint8Array(400) };
  raster.d[10 * 20 + 15] = 1; // the cell centred on (15.5, 10.5)
  assert.ok(surfaceNear(raster, 15.5, 10.5, 0), 'on the cell');
  assert.ok(surfaceNear(raster, 10.5, 10.5, 5.5));
  assert.ok(!surfaceNear(raster, 10.5, 10.5, 4.5));
  assert.ok(!surfaceNear(raster, 15.5, 2.5, 7.5));
});

test('trackClearance: a cycleway beside a road holds it back to the track\'s near edge; a crossing one does not', () => {
  // a road along +x at z = 0; a one-way cycleway (2 m) along it at z = 6, another crossing it at x = 50
  const idx = cycleTrackIndex([
    { tags: { highway: 'cycleway', oneway: 'yes' }, pts: [[0, 6], [100, 6]] },
    { tags: { highway: 'cycleway' }, pts: [[50, -20], [50, 20]] },
    { tags: { highway: 'footway', footway: 'crossing', bicycle: 'designated' }, pts: [[20, -10], [20, 10]] },
    { tags: { highway: 'footway' }, pts: [[0, 3], [100, 3]] } // (a footway not for bikes: not a track)
  ]);
  assert.equal(idx.segments, 2);
  assert.equal(trackClearance(idx, 30, 0, 1, 0), 5); // 6 m out, less its half width
  assert.equal(trackClearance(idx, 50, 0, 1, 0), 5); // (the crossing one is not alongside)
  assert.equal(trackClearance(idx, 30, 0, 0, 1), Infinity); // (a road running across the track: not alongside)
  assert.equal(trackClearance(idx, 130, 0, 1, 0), Infinity); // (off the track's end)
});

test('the geodata build keeps the connector on decks, service roads and living streets', () => {
  const src = fs.readFileSync(path.join(root, 'tools/geo-blocks.mjs'), 'utf8');
  assert.match(src, /KEEP_CONNECTOR = new Set\(\['service', 'living_street'\]\)/);
  assert.match(src, /segs\[0\]\.deck \|\| own <= CONNECTOR \|\| KEEP_CONNECTOR\.has/);
});

// ---- retiring City polygons ---------------------------------------------------------------------------------------------

test('retireCityRoadway drops exactly the one polygon its point, kind and area name, and refuses anything else', () => {
  const sq = (lon, lat, d) => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
  const polys = [['Road Edge', sq(-79.35, 43.64, 0.001)], ['Intersection', sq(-79.35, 43.64, 0.001)], ['Road Edge', sq(-79.34, 43.64, 0.001)]];
  const area = lonLatArea(polys[0][1]);
  assert.ok(Math.abs(area - 8964) / 8964 < 0.02, `a 0.001° square here is about 80.7 x 111.1 m (${area.toFixed(0)} m²)`);
  const kept = retireCityRoadway(polys, [{ objectId: 1, kind: 'Road Edge', point: [-79.3495, 43.6405], area }]);
  assert.deepEqual(kept.map(([k, r]) => [k, r[0][0]]), [['Intersection', -79.35], ['Road Edge', -79.34]]);
  assert.throws(() => retireCityRoadway(polys, [{ objectId: 2, kind: 'Road Edge', point: [-79.3495, 43.6405], area: area * 1.2 }]), /matches 0/);
  assert.throws(() => retireCityRoadway(polys, [{ objectId: 3, kind: 'Lane Edge', point: [-79.3495, 43.6405], area }]), /matches 0/);
  assert.throws(() => retireCityRoadway([...polys, polys[0]], [{ objectId: 4, kind: 'Road Edge', point: [-79.3495, 43.6405], area }]), /matches 2/);
});

// ---- the fixture -------------------------------------------------------------------------------------------------------

test('the fixture: sources, datum, stations, surfaces, bridges and retired polygons are all stated and consistent', () => {
  assert.match(fixture.datum, /NAD83\(CSRS\)/);
  const sources = new Set(fixture.sources.map((s) => s.id));
  for (const s of fixture.sources) {
    assert.match(s.url, /^https:\/\//, `${s.id} has a URL`);
    assert.ok(s.date && s.use && s.terms, `${s.id} has a date, a use and its terms`);
  }
  const chainWays = new Set(fixture.chains.flatMap((c) => c.ways));
  for (const st of fixture.stations) {
    assert.ok(chainWays.has(st.way), `station ${st.way}@${st.at} is on a chain`);
    assert.ok(st.left < 0 && st.right > 0 && st.right - st.left >= 3 && st.right - st.left <= 20, `${st.way}@${st.at}: ${st.left}..${st.right}`);
    assert.equal(st.width, Math.round((st.right - st.left) * 100) / 100);
    assert.ok(KINDS.has(st.kind));
  }
  assert.ok(fixture.stations.length >= 12, 'at least twelve cross-sections');
  const ids = new Set();
  for (const s of fixture.surfaces) {
    assert.ok(!ids.has(s.id), `${s.id} is unique`);
    ids.add(s.id);
    assert.ok(KINDS.has(s.kind), `${s.id}: kind ${s.kind}`);
    assert.ok(sources.has(s.source), `${s.id}: source ${s.source}`);
    assert.ok(chainWays.has(s.way));
    assert.ok(s.ring.length >= 4);
    for (const [lon, lat] of s.ring) assert.ok(lon > -79.37 && lon < -79.33 && lat > 43.63 && lat < 43.66, `${s.id} lies in the Port Lands`);
    // a ribbon's mean width (area over half its perimeter, less its ends) lies inside its stations' range
    const area = lonLatArea(s.ring);
    const per = s.ring.reduce((a, p, i) => {
      const q = s.ring[(i + 1) % s.ring.length];
      return a + Math.hypot((q[0] - p[0]) * 80682, (q[1] - p[1]) * 111105);
    }, 0);
    const len = (per - 2 * s.width[0]) / 2;
    assert.ok(area / len >= s.width[0] - 0.6 && area / len <= s.width[1] + 0.6, `${s.id}: mean width ${(area / len).toFixed(1)} in ${s.width}`);
  }
  const bw = bridgeWidths(fixture);
  for (const b of fixture.bridges) {
    const sts = fixture.stations.filter((s) => b.ways.includes(s.way));
    assert.ok(sts.length, `${b.id} is measured`);
    const mean = sts.reduce((a, s) => a + s.width, 0) / sts.length;
    assert.equal(b.width, Math.round(mean * 10) / 10);
    for (const id of b.ways) assert.equal(bw.get(id), b.width);
  }
  for (const r of fixture.retire) {
    assert.ok(Number.isInteger(r.objectId) && r.kind && r.point.length === 2 && r.area > 100 && r.reason, `retired ${r.objectId}`);
  }
  for (const u of fixture.unsurveyed) assert.ok(u.street && u.reason);
  for (const g of fixture.ground) {
    assert.ok(g.id && g.street && Number.isInteger(g.objectId) && g.reason && sources.has(g.source), `ground ${g.id}: stated`);
    assert.ok(chainWays.has(g.way) && g.side === 'right' && g.to > g.from && g.depth > 0 && g.depth <= 20, `ground ${g.id}: on a surveyed way`);
    assert.ok(g.edge.length >= 2 && g.edge.every(([at, off]) => at >= g.from - 10 && at <= g.to && off > 0), `ground ${g.id}: kerb measured along it`);
    assert.ok(g.ring.length >= 4 && lonLatArea(g.ring) > 0.8 * (g.to - g.from) * g.depth, `ground ${g.id}: ring of its length and depth`);
  }
  assert.deepEqual([...ROADWAY_KINDS].sort(), ['bridge deck', 'carriageway', 'transit way']);
  assert.equal(loadRoadSurfaces().surfaces.filter((s) => s.roadway).length, fixture.surfaces.filter((s) => ROADWAY_KINDS.has(s.kind)).length);
});

test('the fixture is what tools/build-road-surfaces.mjs makes of its stations', { skip: !process.env.GEO_DATA && 'needs GEO_DATA (the OSM extract and city_roadway.json)' }, () => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools/build-road-surfaces.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

// ---- on the committed city ---------------------------------------------------------------------------------------------

test('the committed city: every surveyed carriageway and bridge deck is roadway, no curb island on it', () => {
  const { blocks } = geo();
  const boxes = blocks.map((b) => {
    const f = b[0];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < f.length; i += 2) { x0 = Math.min(x0, f[i]); x1 = Math.max(x1, f[i]); z0 = Math.min(z0, f[i + 1]); z1 = Math.max(z1, f[i + 1]); }
    return [x0, x1, z0, z1, f];
  });
  let checked = 0;
  for (const s of fixture.surfaces.filter((x) => ROADWAY_KINDS.has(x.kind))) {
    const ring = s.ring.map(([lon, lat]) => toWorld(lon, lat));
    const n = ring.length / 2;
    // points across the ribbon half way between its edges, and a quarter in from each
    for (let i = 1; i < n - 1; i += 3) {
      const a = ring[i], b = ring[ring.length - 1 - i];
      for (const t of [0.25, 0.5, 0.75]) {
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        const hit = boxes.find(([x0, x1, z0, z1, f]) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && flatIn(f, x, z));
        assert.ok(!hit, `${s.id}: a curb island on the roadway at ${x.toFixed(1)}, ${z.toFixed(1)}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 1000, `${checked} points checked`);
});

test('the committed city: where the retired City polygons ran is ground again, not roadway', () => {
  const { blocks } = geo();
  // a point inside each retired polygon that main drew as roadway: old Cherry Street in Biidaasige Park south of the
  // new Commissioners Street, and old Commissioners Street's two carriageways on Villiers Island west of the Don
  const points = { 19174: [-79.352136, 43.645014], 38247: [-79.350829, 43.648274], 38597: [-79.349705, 43.648475] };
  for (const [id, pt] of Object.entries(points)) {
    assert.ok(fixture.retire.some((r) => r.objectId === +id), `polygon ${id} is retired`);
    const [x, z] = toWorld(...pt);
    assert.ok(blocks.some((b) => flatIn(b[0], x, z)), `${id}: a curb island at ${x.toFixed(0)}, ${z.toFixed(0)}`);
  }
});

test('the committed city: a ground strip is ground, the surveyed lane beside it is roadway (Commissioners at the split)', () => {
  const { blocks } = geo();
  for (const g of fixture.ground) {
    const ring = g.ring.map(([lon, lat]) => toWorld(lon, lat));
    const n = ring.length / 2;
    let inside = 0, checked = 0;
    // points a quarter, half and three quarters across the strip, all along it
    for (let i = 1; i < n - 1; i++) {
      const a = ring[i], b = ring[ring.length - 1 - i];
      for (const t of [0.25, 0.5, 0.75]) {
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        checked++;
        if (blocks.some((bl) => flatIn(bl[0], x, z))) inside++;
      }
    }
    assert.equal(inside, checked, `${g.id}: ${checked - inside} of ${checked} points are roadway`);
  }
  // across the eastbound lane, where the City's tail made it 16 m wide, the drawn roadway is about its measured 4.5 m:
  // from the middle of each cross-section of its ribbon out to the first curb island either way (1 m raster)
  const lane = fixture.surfaces.find((s) => s.way === 1418441608).ring.map(([lon, lat]) => toWorld(lon, lat));
  const n = lane.length / 2, widths = [];
  for (let i = 0; i < n; i++) {
    const a = lane[i], b = lane[lane.length - 1 - i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const out = (sgn) => { for (let o = 0; o <= 25; o += 0.25) if (blocks.some((bl) => flatIn(bl[0], mx + ux * o * sgn, mz + uz * o * sgn))) return o; return 25; };
    widths.push(out(1) + out(-1));
  }
  // (its west end runs into the single roadway, its east end into the merge: the middle 60% is the lane alone)
  const mid = widths.slice(Math.floor(n * 0.6), Math.floor(n * 0.95));
  assert.ok(mid.length > 5 && Math.max(...mid) <= 7, `eastbound lane drawn ${Math.min(...mid)}-${Math.max(...mid)} m wide`);
});

test('the committed city: no on-street bikeway in a surveyed carriageway; its cycle tracks are drawn beside it on the ground', () => {
  const { cycling, blocks } = geo();
  const rings = fixture.surfaces.filter((x) => ROADWAY_KINDS.has(x.kind)).map((x) => x.ring.map(([lon, lat]) => toWorld(lon, lat)).flat());
  // every band point of the Port Lands, 1 m into the road from its curb line, is in no surveyed carriageway
  let near = 0;
  for (const b of cycling.bands) {
    const f = Array.isArray(b[2]) ? b[2] : b.slice(2);
    for (let i = 0; i + 3 < f.length; i += 2) {
      const L = Math.hypot(f[i + 2] - f[i], f[i + 3] - f[i + 1]) || 1;
      const x = (f[i] + f[i + 2]) / 2, z = (f[i + 1] + f[i + 3]) / 2;
      if (x < 1900 || x > 3100 || z < 100 || z > 1150) continue;
      // (the road side: the riders' left curb (flag 1) is on their left, so the road is on their right)
      const tx = (f[i + 2] - f[i]) / L, tz = (f[i + 3] - f[i + 1]) / L, sgn = b[1] & 1 ? 1 : -1;
      const px = x - tz * sgn, pz = z + tx * sgn;
      near++;
      assert.ok(!rings.some((r) => flatIn(r, px, pz)), `a bikeway band in a surveyed carriageway at ${x.toFixed(0)}, ${z.toFixed(0)}`);
    }
  }
  // Commissioners' cycle tracks, beside its surveyed carriageway on both kerbs (OSM 1242711091 and 1242949359): drawn as
  // tracks on the ground across from the park's Bike Share dock
  const across = (x, z, nx, nz) => {
    const hits = [];
    for (const t of cycling.trails) {
      if (!t[2]) continue;
      const f = Array.isArray(t[3]) ? t[3] : t.slice(3);
      for (let i = 0; i + 3 < f.length; i += 2) {
        // where the track crosses the line (x, z) + o (nx, nz)
        const ax = f[i], az = f[i + 1], bx = f[i + 2], bz = f[i + 3];
        const den = (bx - ax) * nz - (bz - az) * nx;
        if (Math.abs(den) < 1e-9) continue;
        const u = ((x - ax) * nz - (z - az) * nx) / den;
        if (u < 0 || u > 1) continue;
        const o = ((ax - x) * (bz - az) - (az - z) * (bx - ax)) / -den;
        if (Math.abs(o) < 15) hits.push(o);
      }
    }
    return hits;
  };
  // (a cross-section of Commissioners at 1412502193@40: centre 2416.0, 587.8, the park to the south, +z)
  const hits = across(2416.0, 587.8, 0.239, 0.971);
  assert.ok(hits.some((o) => o > 5) && hits.some((o) => o < -5), `tracks both sides of Commissioners: ${hits.map((o) => o.toFixed(1))}`);
  for (const o of hits) assert.ok(blocks.some((bl) => flatIn(bl[0], 2416.0 + 0.239 * o, 587.8 + 0.971 * o)), `the track at ${o.toFixed(1)} m is on the ground`);
  // the Waterfront Recreational Trail on Cherry's west side at Polson is on the ground (not under the road) at 2232, 884
  assert.ok(blocks.some((bl) => flatIn(bl[0], 2232, 884)));
  assert.ok(near > 20, `${near} band points checked in the Port Lands`);
});

test('the committed city: a road with no mapped surface is drawn at its own width, not as a 4 m strip', () => {
  const { roads, blocks } = geo();
  // The at-grade Gardiner west of the Exhibition has no City Edge of Roadway polygon (the City maps it as Highway Edge,
  // which tools/fetch-roadway.mjs leaves out): main drew it as a 4 m strip, about 2 m clear of its centre line; it is
  // now its own 12 m a carriageway. (Where a City polygon is within reach, at the Jameson ramps, it keeps the connector.)
  const near = (f, x, z) => {
    let m = Infinity;
    for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
      const ax = f[j], az = f[j + 1], dx = f[i] - ax, dz = f[i + 1] - az, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - ax) * dx + (z - az) * dz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      m = Math.min(m, Math.hypot(ax + t * dx - x, az + t * dz - z));
    }
    return flatIn(f, x, z) ? 0 : m;
  };
  let n = 0, wide = 0;
  for (const r of roads.filter((r) => r[0] === 'Gardiner Expressway' && !r[5])) {
    const p = r[6];
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x = (p[i] + p[i + 2]) / 2, z = (p[i + 1] + p[i + 3]) / 2;
      if (x < -7600 || x > -4000) continue;
      n++;
      if (Math.min(...blocks.map((b) => near(b[0], x, z))) >= r[1] / 2 - 1) wide++;
    }
  }
  assert.ok(n >= 40, `${n} Gardiner points`);
  assert.ok(wide / n >= 0.9, `${wide} of ${n} Gardiner points clear by half its width`);
});
