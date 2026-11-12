// Landmark lookups on both shipped maps (st-bz1o.8): every landmark tools/landmark-defs.mjs lists is in the city data
// of today's (detail) map and the Eglinton map, and the places the landing page and the search send people to land in
// front of them: on a street, at or in the place, facing it. Before st-bz1o.8 Ontario Place, Sugar Beach, Centre Island
// and Kensington Market were missing from both ("landmark not found" in tools/geo-features.mjs), and the search fell
// back to a street, a place row or a district, or found nothing ("Canada's Sugar Beach").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { unpackGeo } from '../js/geodata-loader.js';
import { LANDMARK_DEFS } from '../tools/landmark-defs.mjs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url));
// the landing page's links into the map (explore.html#place=...)
const LINKS = [...read('index.html').toString().matchAll(/explore\.html#place=([^"&]+)"/g)].map((m) => decodeURIComponent(m[1]));

async function city(bin) {
  const window = { CITY: { ...(await unpackGeo(read(bin))), DEBUG_ROADS: false } };
  const context = vm.createContext({ window, console: { log() {}, info() {}, warn() {} }, performance, Math, location: { search: '' }, URLSearchParams, Buffer });
  for (const f of ['js/high-park-data.js', 'js/don-valley.js', 'js/city-config.js', 'js/navigation.js']) vm.runInContext(read(f).toString(), context, { filename: f });
  return window.CITY;
}
// where a search's first answer arrives (js/tour-guide.js teleportToPlace), searched from the first visit's start
function arrive(C, query) {
  const start = C.TELEPORT_LOCATIONS.start;
  const p = C.Navigation.searchPlaces(query, { near: { x: start.x, z: start.z } })[0];
  if (!p) return { p };
  const key = p.landmarkId && Object.keys(C.TELEPORT_LOCATIONS).find((k) => k.toLowerCase() === p.landmarkId.toLowerCase());
  return { p, a: key ? C.TELEPORT_LOCATIONS[key] : C.streetArrival(p.x, p.z) };
}
// the distance from a point to an outline (0 inside it), and the outline's nearest point
function nearOutline(x, z, ring, nearest = {}) {
  let inside = false, d = Infinity;
  for (let i = 0, n = ring.length / 2, j = n - 1; i < n; j = i++) {
    const ax = ring[2 * j], az = ring[2 * j + 1], bx = ring[2 * i], bz = ring[2 * i + 1];
    if ((bz > z) !== (az > z) && x < ((ax - bx) * (z - bz)) / (az - bz) + bx) inside = !inside;
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    const e = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (e < d) { d = e; nearest.x = ax + dx * t; nearest.z = az + dz * t; }
  }
  return inside ? 0 : d;
}
function onStreetFacing(C, { p, a }, what, target = p) {
  assert.ok(a && Number.isFinite(a.x) && Number.isFinite(a.heading), `${what}: an arrival with a heading`);
  assert.equal(C.blockAt(a.x, a.z), null, `${what}: off the curb islands`);
  assert.ok(C.nearestRoads(a.x, a.z, 20).some(({ road, dist }) => dist < road.w / 2 + 0.5), `${what}: on a street`);
  const t = Math.hypot(target.x - a.x, target.z - a.z);
  if (t > 5) assert.ok(((target.x - a.x) * Math.sin(a.heading) + (target.z - a.z) * Math.cos(a.heading)) / t > 0.999, `${what}: facing it`);
  return Math.hypot(p.x - a.x, p.z - a.z);
}

for (const [frame, bin] of [['detail', 'data/toronto-geodata.bin'], ['Eglinton', 'data/frames/eglinton/toronto-geodata.bin']]) {
  test(`${frame} map: every landmark is found, and none has gone`, async () => {
    const { GEO } = await unpackGeo(read(bin));
    for (const [name, id] of LANDMARK_DEFS) assert.ok(GEO.landmarks[id], `${name} (${id}) is in the ${frame} map's data`);
  });

  test(`${frame} map: Ontario Place, Sugar Beach, Centre Island and Kensington Market land in front of them`, async () => {
    const C = await city(bin);
    const S = C.LANDMARK_SITES;
    for (const [query, id] of [['Ontario Place', 'ontarioPlace'], ['Sugar Beach', 'sugarBeach'], ["Canada's Sugar Beach", 'sugarBeach'],
      ['Centre Island', 'centreIsland'], ['Kensington Market', 'kensington']]) {
      const hit = arrive(C, query);
      assert.equal(hit.p?.landmarkId, id, `${query}: the landmark is the first answer (${hit.p ? `${hit.p.kind} ${hit.p.name}` : 'nothing'})`);
      const s = S[id], island = {};
      // (Centre Island is pinned at its ferry dock, off OSM's island: it faces the island's nearest shore instead)
      if (id === 'centreIsland') assert.ok(nearOutline(hit.a.x, hit.a.z, s.ring, island) > 0 && island.x !== undefined);
      const d = onStreetFacing(C, hit, query, id === 'centreIsland' ? island : hit.p);
      const { a } = hit;
      if (id === 'ontarioPlace') {
        // (no outline mapped while it is rebuilt: its node; the nearest street, across Lake Shore, looks at it)
        assert.ok(!s.ring && d < 300, `${query}: ${d.toFixed(0)} m from its node`);
      } else if (id === 'centreIsland') {
        // (at its ferry dock, the node named Centre Island, labelled so)
        assert.ok(d < 120, `${query}: ${d.toFixed(0)} m from its dock`);
        assert.match(C.getLocationLabel(a.x, a.z), /^Centre Island · /);
      } else {
        // the beach's edge, the market's own street
        assert.ok(nearOutline(a.x, a.z, s.ring) < 40, `${query}: ${nearOutline(a.x, a.z, s.ring).toFixed(0)} m from its outline`);
        assert.match(C.getLocationLabel(a.x, a.z), new RegExp(`^${C.CITY_LANDMARKS.find((l) => l.id === id).name} · `));
      }
    }
  });

  test(`${frame} map: every place the landing page links to is a landmark, arrived at in front of it`, async () => {
    const C = await city(bin);
    assert.ok(LINKS.length >= 10, `${LINKS.length} links`);
    for (const q of LINKS) {
      const hit = arrive(C, q);
      assert.equal(hit.p?.kind, 'landmark', `${q}: ${hit.p ? `${hit.p.kind} ${hit.p.name}` : 'nothing'}`);
      const d = onStreetFacing(C, hit, q);
      assert.ok(d < 600, `${q}: ${d.toFixed(0)} m away`);
    }
  });

  test(`${frame} map: an area's name labels its own ground, not its circle's`, async () => {
    const C = await city(bin);
    // Centre Island's circle (2.4 km) would take in the Financial District, Exhibition Place's Ontario Place
    for (const id of ['unionStation', 'stLawrence', 'sugarBeach']) {
      const s = C.LANDMARK_SITES[id];
      assert.doesNotMatch(C.getLocationLabel(s.ax ?? s.x, s.az ?? s.z), /^Centre Island/, id);
    }
    const op = C.LANDMARK_SITES.ontarioPlace;
    assert.match(C.getLocationLabel(op.x, op.z), /^Ontario Place/);
    const hp = C.LANDMARK_SITES.highPark;
    assert.match(C.getLocationLabel(hp.x, hp.z), /^High Park/);
  });
}
