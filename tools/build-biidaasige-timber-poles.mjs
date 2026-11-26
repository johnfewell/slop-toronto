#!/usr/bin/env node
// tools/build-biidaasige-timber-poles.mjs (bead st-bmyv.10)
// Classifies the City of Toronto "Topographic Mapping - Poles" light poles that stand inside Biidaasige Park, and
// writes the source record tools/fixtures/biidaasige-timber-poles.json. The dataset (js/toronto-poles.js, fetched
// 2026-10-29, digitised from aerial imagery, +-30 cm) is the only source of park light positions: the OSM extract has
// no lamp inside the park (docs/biidaasige-lighting.md).
//
// RESULT (2026-11-26): none of the 36 is a usable park luminaire. The City's 2025 8 cm orthophoto
// (basemap/cot_ortho_2025_color_8cm) shows the poles it was possible to check standing in the river and its basins, on
// bare ground, or on the Cherry Street bridge deck; the dataset predates the park's built form. The rule below is
// kept as the record of what passes a position test alone, NOT as a placement list.
//
// Rule (no position is invented, none is moved):
//   - the pole is a Street Light Pole (6006) or Pedestrian Light Pole (6004): a pole that also carries a signal
//     (6005, 6008) is a road fixture and stays generic;
//   - it lies inside the committed park polygon (BIIDAASIGE_PARK.park.polygon, OSM way 813717630);
//   - it is at least ROAD_MIN metres from every at-grade named road's centre line (the repository's own "by a street"
//     distance, tools/build-poles.mjs MISC_STREET), so a roadside light on the park's rim stays a generic street light.
// The ones that pass are the park's timber luminaires; every other pole inside the polygon is listed as roadside or
// signal with its reason.
//
//   node tools/build-biidaasige-timber-poles.mjs          # rewrite the fixture
//   node tools/build-biidaasige-timber-poles.mjs --check  # exit 1 if the committed fixture is stale
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = 'tools/fixtures/biidaasige-timber-poles.json';
const ROAD_MIN = 12;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ctx = { window: { CITY: {} } };
for (const f of ['js/toronto-geodata.js', 'js/biidaasige-park-data.js', 'js/toronto-poles.js']) vm.runInNewContext(read(f), ctx);
const C = ctx.window.CITY, P = C.GEO.frame.projection;
const world = (lat, lon) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky, c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
};
const poly = C.BIIDAASIGE_PARK.park.polygon.map(([a, b]) => world(a, b));
const inside = (x, z) => {
  let i = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, za] = poly[a], [xb, zb] = poly[b];
    if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) i = !i;
  }
  return i;
};
const segD = (ax, az, bx, bz, x, z) => {
  const ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(ax + ex * t - x, az + ez * t - z);
};
const roads = [];
for (const r of C.GEO.roads) {
  if (!r[0] || r[5]) continue; // named, at grade
  const f = r[6];
  for (let i = 0; i + 3 < f.length; i += 2) roads.push([f[i], f[i + 1], f[i + 2], f[i + 3], r[0]]);
}
const nearestRoad = (x, z) => {
  let m = Infinity, name = '';
  for (const r of roads) {
    if (Math.abs((r[0] + r[2]) / 2 - x) > 600 || Math.abs((r[1] + r[3]) / 2 - z) > 600) continue;
    const d = segD(r[0], r[1], r[2], r[3], x, z);
    if (d < m) { m = d; name = r[4]; }
  }
  return [m, name];
};

// Read off the 2025 orthophoto by eye on 2026-11-26 (poles drawn on the photograph, 8 cm): the ids covered, and what is there.
const ORTHO_CHECKED = {
  inWater: [142451, 142452, 142453, 142461, 142462, 142490, 142599, 142600, 142601, 142616, 142618],
  bareGroundOrVegetation: [142458, 142463, 142464, 142483, 142485, 142486, 142488, 142489],
  bridgeDeckRoadLight: [142449, 142487, 142596, 142597, 142598, 142602, 142603, 142617, 142619],
  notChecked: [142190, 142448, 142559]
};
const rows = [];
for (const code of ['6004', '6005', '6006', '6008']) {
  const t = C.POLES.types[code];
  if (!t) continue;
  let id = 0;
  for (let i = 0; i < t.ids.length; i++) {
    id += t.ids[i];
    const x = t.xz[2 * i] / 10, z = t.xz[2 * i + 1] / 10;
    if (!inside(x, z)) continue;
    const [rd, rn] = nearestRoad(x, z);
    const klass = code === '6005' || code === '6008' ? 'signal' : rd < ROAD_MIN ? 'roadside' : 'positionTestOnly';
    rows.push({ id, type: Number(code), typeName: t.name, x, z, roadDist: Math.round(rd * 10) / 10, road: rn, class: klass });
  }
}
const counts = {};
for (const r of rows) counts[r.class] = (counts[r.class] || 0) + 1;
const fixture = {
  version: 1,
  source: C.POLES.source,
  parkRef: 'OSM way/813717630 (js/biidaasige-park-data.js)',
  rule: `Street Light Pole or Pedestrian Light Pole inside the park polygon and at least ${ROAD_MIN} m from every at-grade named road centre line; poles carrying a signal (6005, 6008) and roadside lights stay generic`,
  roadMin: ROAD_MIN,
  counts: { inPark: rows.length, ...counts },
  verdict: 'no City pole inside the park is corroborated by the 2025 orthophoto; none is placed',
  orthoCheck: { imagery: 'City of Toronto 2025 aerial imagery, 8 cm', ...ORTHO_CHECKED },
  poles: rows
};
const text = JSON.stringify(fixture, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(path.join(ROOT, OUT)) ? read(OUT) : '';
  if (cur !== text) { console.error(`${OUT} is stale: rerun node tools/build-biidaasige-timber-poles.mjs`); process.exit(1); }
  console.log(`${OUT} current: ${JSON.stringify(fixture.counts)}`);
} else {
  fs.writeFileSync(path.join(ROOT, OUT), text);
  console.log(`wrote ${OUT}: ${JSON.stringify(fixture.counts)}`);
}
