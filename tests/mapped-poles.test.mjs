import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as CORE from '../vendor/three/three.core.js';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildPoles, miscPoles, SHIPPED, LOOKS, DISTILLERY, MISC_CLASSES, MISC_DRAWN, TRAM_CLASSES } from '../tools/build-poles.mjs';

const context = { window: { CITY: { TSL: {} } }, location: { search: '' } };
for (const file of ['toronto-geodata', 'toronto-traffic-data', 'city-config', 'toronto-poles', 'mapped-poles'])
  vm.runInNewContext(fs.readFileSync(new URL(`../js/${file}.js`, import.meta.url), 'utf8'), context);
const C = context.window.CITY;
const { LIGHT, LIGHT_SIGNAL, SIGNAL, PEDESTRIAN, MISC } = C.POLE_TYPES;

const feature = (OBJECTID, code, desc, [lat, lon]) => ({ type: 'Feature',
  properties: { OBJECTID, SUBTYPE_CODE: code, SUBTYPE_DESC: desc, DERIVED_HEIGHT: 'None' },
  geometry: { type: 'MultiPoint', coordinates: [[lon, lat]] } });

test('the pole build keeps the modelled types, counts the rest and clips to the detail frame', () => {
  const fixture = { features: [
    feature(7, 6006, 'Street Light Pole', [43.6487, -79.3959]),
    feature(3, 6006, 'Street Light Pole', [43.6488, -79.3960]),
    feature(9, 6004, 'Pedestrian Light Pole', [43.6400, -79.3800]),
    feature(11, 6008, 'Traffic Signal Pole', [43.7700, -79.2000]) // Scarborough: outside the frame
  ] };
  const data = buildPoles(fixture, C.GEO.frame, { package: 'x' });
  assert.deepEqual(JSON.parse(JSON.stringify(data.counts)), { 6006: 2, 6004: 1 });
  assert.deepEqual(data.shipped, SHIPPED);
  assert.deepEqual(data.types[6006].ids, [3, 4]); // ascending OBJECTIDs as deltas
  assert.equal(data.types[6006].xz.length, 4);
  assert.deepEqual(data.types[6004].ids, [9]);
  assert.equal(data.types[6008].ids.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(data.looks)), {}, 'no looks without the city to judge them by');
  assert.equal(data.types[MISC].ids.length, 0, 'nor unlit hydro poles');
  assert.equal(data.misc, undefined);
  // with the city: the pedestrian light (Queens Quay & Bay) is a promenade post; two lights alone are steel
  const judged = buildPoles(fixture, C.GEO.frame, { package: 'x' }, C.GEO);
  assert.deepEqual(JSON.parse(JSON.stringify(judged.looks)), { wood: [], lantern: [], promenade: [9], park: [], trolley: [], trolleyCentre: [] });
  assert.throws(() => buildPoles({ features: [fixture.features[0], fixture.features[0]] }, C.GEO.frame, {}), /duplicate/);
  assert.throws(() => buildPoles({ features: [feature(1, 6002, 'Mystery Pole', [43.6487, -79.3959])] }, C.GEO.frame, {}), /Unknown pole subtype/);
  assert.throws(() => buildPoles({ features: [feature(1, 6006, 'Traffic Signal Pole', [43.6487, -79.3959])] }, C.GEO.frame, {}), /Unknown pole subtype/);
});

test('the shipped layer is the reviewed 2026-02-20 snapshot with its provenance', () => {
  const P = C.POLES;
  assert.equal(P.source.resourceId, '5504d484-1bd6-4330-b43c-d562b74a175d');
  assert.equal(P.source.sha256, '1b4722aadff160569874c587ce918469850831e86ea72765f119689c4557b8ec');
  assert.equal(P.source.licence, 'open-government-licence-toronto');
  assert.deepEqual(JSON.parse(JSON.stringify(P.counts)), { 6001: 3, 6003: 7171, 6004: 1901, 6005: 1566, 6006: 26375, 6008: 1518 });
  for (const code of SHIPPED) assert.equal(P.types[code].xz.length, 2 * P.types[code].ids.length);
  for (const code of [PEDESTRIAN, LIGHT_SIGNAL, LIGHT, SIGNAL]) assert.equal(P.types[code].ids.length, P.counts[code]);
  // of the miscellaneous poles only the unlit hydro poles; hydro towers have no model: not shipped
  assert.deepEqual(Object.keys(P.types).map(Number).sort(), [MISC, PEDESTRIAN, LIGHT_SIGNAL, LIGHT, SIGNAL].sort());
  assert.deepEqual(Object.keys(P.misc), MISC_CLASSES);
  assert.equal(Object.values(P.misc).reduce((a, b) => a + b, 0), P.counts[MISC], 'every miscellaneous pole classed once');
  assert.equal(P.types[MISC].ids.length, MISC_DRAWN.reduce((n, k) => n + P.misc[k], 0), 'the unlit hydro poles and the streetcar streets\' poles');
  assert.equal(P.tram.reduce((n, d) => n + (d > 0), 0), TRAM_CLASSES.reduce((n, k) => n + P.misc[k], 0), 'the poles holding up the overhead listed');
});

test('mapped poles stand on the curb islands, off the flyovers, their arms towards the road', () => {
  const { sites, rejected, nudged } = C.mappedPoleSites(C.POLES, C);
  const shipped = SHIPPED.reduce((n, c) => n + C.POLES.types[c].ids.length, 0);
  assert.equal(sites.length + rejected.roadway + rejected.deck, shipped);
  assert.ok(sites.length > shipped * 0.9, `${sites.length} of ${shipped} placed`);
  assert.ok(nudged < shipped * 0.12);
  assert.equal(new Set(sites.map((s) => `${s.type}:${s.id}`)).size, sites.length);
  for (const s of sites) {
    assert.ok(C.blockAt(s.x, s.z), `pole ${s.id} off the curb`);
    assert.ok(C.deckHeightAt(s.x, s.z, 1000) <= 1);
    assert.ok(Math.abs(Math.hypot(s.ax, s.az) - 1) < 1e-6);
    if (s.road && !s.median && !s.tram && s.toRoad > 0.3 && !(s.type === MISC && s.toRoad > 12)) assert.ok((s.road.px - s.x) * s.ax + (s.road.pz - s.z) * s.az > 0);
  }
  // Queen & Spadina (aerial-checked 2025): the combined light & signal poles on its corners
  const qs = C.worldFromLatLon(43.64867, -79.39592);
  const corner = sites.filter((s) => s.type === LIGHT_SIGNAL && Math.hypot(s.x - qs.x, s.z - qs.z) < 35);
  assert.ok(corner.length >= 3, `${corner.length} light & signal poles at Queen & Spadina`);
});

test('the pole index answers the nearest pole of the wanted types, honouring the filter', () => {
  const idx = C.poleIndex([{ id: 1, type: LIGHT, x: 0, z: 0 }, { id: 2, type: SIGNAL, x: 3, z: 0 }, { id: 3, type: SIGNAL, x: -2, z: 0 }]);
  assert.equal(idx.nearest(0.5, 0, 5).id, 1);
  assert.equal(idx.nearest(0.5, 0, 5, [SIGNAL]).id, 3);
  assert.equal(idx.nearest(0.5, 0, 5, [SIGNAL], (s) => s.x > 0).id, 2);
  assert.equal(idx.nearest(40, 0, 5), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// The looks (st-er2 wooden hydro poles, st-m3t pedestrian lamp posts): tools/build-poles.mjs poleLooks
const undelta = (d) => { let id = 0; return d.map((v) => (id += v)); };
const idsOf = (code) => new Set(undelta(C.POLES.types[code].ids));
const { sites } = C.mappedPoleSites(C.POLES, C);
const near = (lat, lon, r) => { const p = C.worldFromLatLon(lat, lon); return sites.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) < r); };
const share = (list, look) => list.filter((s) => s.look === look).length / Math.max(1, list.length);
const onStreet = (name, r = 14) => sites.filter((s) => s.type === LIGHT && s.road && s.road.road.name === name && s.toRoad < r);

test('every pole has one look, of its type: wooden & lantern street lights, three pedestrian lamp posts', () => {
  const L = C.POLES.looks;
  assert.deepEqual(Object.keys(L), LOOKS);
  const looks = Object.fromEntries(LOOKS.map((k) => [k, undelta(L[k])]));
  // the reviewed 2026-02-20 snapshot's split
  assert.deepEqual(Object.fromEntries(LOOKS.map((k) => [k, looks[k].length])), { wood: 5505, lantern: 814, promenade: 366, park: 746, trolley: 780, trolleyCentre: 28 });
  const lights = idsOf(LIGHT), peds = idsOf(PEDESTRIAN);
  assert.ok(looks.wood.every((id) => lights.has(id)), 'only street light poles are wooden');
  assert.ok([...looks.promenade, ...looks.park].every((id) => peds.has(id)));
  const misc = idsOf(MISC);
  assert.ok([...looks.trolley, ...looks.trolleyCentre].every((id) => misc.has(id)), 'the steel span poles are miscellaneous poles');
  assert.equal(looks.lantern.filter((id) => lights.has(id)).length, 25, 'the Distillery\'s lights are lantern posts');
  const all = Object.values(looks).flat();
  assert.equal(new Set(all).size, all.length, 'no pole has two looks');
  assert.equal([...peds].filter((id) => !all.includes(id)).length, 0, 'every pedestrian light has its post');
});

test('wooden poles stand on the one-sided residential streets, not the downtown core or the boulevards', () => {
  // the hydro line down one side (aerial-checked 2025: Euclid, Manning, Montrose, Clinton lit from one side)
  for (const name of ['Euclid Avenue', 'Manning Avenue', 'Montrose Avenue', 'Clinton Street', 'Logan Avenue'])
    assert.ok(share(onStreet(name), 'wood') > 0.6, `${name}: ${share(onStreet(name), 'wood').toFixed(2)} wooden`);
  // ornamental standards both sides (Palmerston Blvd), the rebuilt waterfront and core, the arterials
  for (const name of ['Palmerston Boulevard', 'Queens Quay West', 'The Esplanade', 'Bathurst Street', 'Harbord Street', 'Bay Street', 'Front Street West'])
    assert.equal(onStreet(name).filter((s) => s.look === 'wood').length, 0, `${name} has no wooden poles`);
  assert.equal(near(43.6487, -79.3812, 500).filter((s) => s.look === 'wood').length, 0, 'none in the Financial District');
  // a wooden pole's light is a single arm, never a median's pair; the other wooden poles are the unlit hydro poles
  const wood = sites.filter((s) => s.look === 'wood');
  assert.ok(wood.filter((s) => s.type === LIGHT).length > 5000 && wood.every((s) => s.type === LIGHT || s.type === MISC));
});

test('the pedestrian lamp posts are placed on the curb islands, each look where it belongs', () => {
  const peds = sites.filter((s) => s.type === PEDESTRIAN);
  assert.ok(peds.length >= 1850 && peds.length <= 1901, `${peds.length} of 1,901 pedestrian lights placed`);
  for (const s of peds) assert.ok(C.blockAt(s.x, s.z) && C.deckHeightAt(s.x, s.z, 1000) <= 1);
  // the waterfront promenade (Queens Quay at Spadina & Bay), the parks (Riverdale, Withrow, Allan Gardens), the
  // heritage lanterns (St. James Town, Cabbagetown, Old Town)
  assert.ok(share(near(43.6385, -79.3925, 300).filter((s) => s.type === PEDESTRIAN), 'promenade') > 0.9);
  for (const name of ['Riverdale Park West', 'Withrow Park', 'Allan Gardens', 'Moss Park']) {
    const [, , poly] = C.GEO.areas.find((a) => a[0] === 'park' && a[1] === name);
    const inPark = sites.filter((s) => s.type === PEDESTRIAN && C.pointInPoly(Array.from({ length: poly.length / 2 }, (_, i) => ({ x: poly[2 * i], z: poly[2 * i + 1] })), s.x, s.z));
    assert.ok(inPark.length >= 5 && share(inPark, 'park') === 1, `${name}: ${inPark.length} park lamps`);
  }
  assert.ok(share(near(43.6690, -79.3730, 300).filter((s) => s.type === PEDESTRIAN), 'lantern') > 0.8, 'St. James Town lanterns');
  // the Distillery: its lanes' lights are lantern posts, Mill Street's stay steel
  const distillery = DISTILLERY.map(([lat, lon]) => C.worldFromLatLon(lat, lon));
  const lanterns = sites.filter((s) => s.type === LIGHT && s.look === 'lantern');
  assert.ok(lanterns.length >= 20);
  const [w, e] = [Math.min(...distillery.map((p) => p.x)), Math.max(...distillery.map((p) => p.x))];
  assert.ok(lanterns.every((s) => s.x > w - 5 && s.x < e + 5));
  assert.equal(onStreet('Mill Street', 7).filter((s) => s.look !== 'steel').length, 0);
});

test('the overhead lines run pole to pole down each side of the street, through the unlit poles', () => {
  const spans = C.woodSpans(sites);
  const wood = sites.filter((s) => s.look === 'wood' && !s.median);
  assert.ok(spans.length > wood.length * 0.6 && spans.length <= wood.length, `${spans.length} spans for ${wood.length} poles`);
  const seen = new Set(), ends = new Map();
  for (const { a, b } of spans) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    assert.ok(d >= C.poleModels.SPAN.min && d < C.poleModels.SPAN.max);
    assert.ok(a.look === 'wood' && b.look === 'wood' && a !== b);
    // the same side of the street, or the next pole standing right in the line's way
    const along = ((b.x - a.x) * -a.az + (b.z - a.z) * a.ax) / d;
    assert.ok(a.ax * b.ax + a.az * b.az > 0.8 || d * Math.sqrt(1 - along * along) < C.poleModels.SPAN.inLine);
    const key = [a.id, b.id].sort().join();
    assert.ok(!seen.has(key), 'each span once');
    seen.add(key);
    for (const s of [a, b]) ends.set(s, (ends.get(s) || 0) + 1);
  }
  const euclid = onStreet('Euclid Avenue').filter((s) => s.look === 'wood');
  assert.ok(spans.filter(({ a }) => euclid.includes(a)).length >= euclid.length * 0.75, 'Euclid\'s line runs pole to pole');
  // the lines go through the unlit poles: most are strung (the rest stand alone, down a back lane or by a steel-lit
  // arterial); spans lit to unlit and unlit to unlit
  const unlit = wood.filter((s) => s.type === MISC);
  assert.ok(unlit.filter((s) => ends.has(s)).length > unlit.length * 0.6, `${unlit.filter((s) => ends.has(s)).length} of ${unlit.length} unlit poles strung`);
  assert.ok(spans.filter(({ a, b }) => (a.type === MISC) !== (b.type === MISC)).length > 500);
  assert.ok(spans.filter(({ a, b }) => a.type === MISC && b.type === MISC).length > 1000);
  // and no wire runs past a wooden pole it isn't strung on (within 1.5 m of its middle): a few close pairs at most
  const idx = C.poleIndex(wood, 24);
  const past = spans.filter(({ a, b }) => {
    const L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    for (let t = 2; t < L - 2; t += 1) if (idx.nearest(a.x + ux * t, a.z + uz * t, 1.5, null, (o) => o !== a && o !== b)) return true;
    return false;
  });
  assert.ok(past.length < spans.length * 0.015, `${past.length} of ${spans.length} spans run past a pole`);
  // Indian Road (aerial-checked 2025): the lights on the west side's line, the unlit poles on the east side's own line
  const indian = wood.filter((s) => s.road && s.road.road.name === 'Indian Road' && s.toRoad < 14);
  const east = indian.filter((s) => s.type === MISC), west = indian.filter((s) => s.type === LIGHT);
  assert.ok(east.length >= 20 && west.length >= 40, `${east.length} unlit, ${west.length} lit`);
  assert.ok(spans.filter(({ a, b }) => east.includes(a) && east.includes(b)).length >= 10, 'the east side strung pole to pole');
});

test('the miscellaneous poles: the unlit hydro poles drawn, the others told apart by where they stand', () => {
  const P = C.POLES;
  // the reviewed 2026-02-20 snapshot's split (City 2025 aerials: Indian Rd, Shannon St, the Roncesvalles carhouse,
  // Fort York, Phoebe St, the Canary District, Huron-Sussex, Broadview at Riverdale Park, Dufferin, Ward's Island)
  assert.deepEqual(JSON.parse(JSON.stringify(P.misc)), { hydro: 4318, dup: 205, post: 194, double: 138, trolley: 780, trolleyWood: 48,
    trolleyCentre: 28, trolleyYard: 170, rail: 284, park: 268, core: 712, median: 11, building: 15 });
  // each rule on its own: rows [OBJECTID, x dm, z dm] round a light at Queen & Spadina, on Euclid Ave, on King St's
  // tracks, in the Financial District
  const dm = (p, dx = 0, dz = 0) => [Math.round((p.x + dx) * 10), Math.round((p.z + dz) * 10)];
  const light = sites.find((s) => s.type === LIGHT && s.look === 'steel' && s.road?.road.name === 'Spadina Avenue');
  const euclidPole = onStreet('Euclid Avenue').find((s) => s.look === 'wood');
  const along = [-euclidPole.az, euclidPole.ax];
  const king = C.worldFromLatLon(43.64437, -79.40054), fin = C.worldFromLatLon(43.64866, -79.38114);
  const byType = { [LIGHT]: [[1, ...dm(light)], [2, ...dm(euclidPole)]], [MISC]: [
    [10, ...dm(light, 0.6)], // the same pole mapped twice
    [11, ...dm(euclidPole, along[0] * 15, along[1] * 15)], // the next pole down Euclid's line
    [12, ...dm(euclidPole, along[0] * 15 + 2, along[1] * 15)], // a stub beside it
    [20, ...dm(euclidPole, along[0] * -15, along[1] * -15)], [21, ...dm(euclidPole, along[0] * -20, along[1] * -20)],
    [22, ...dm(euclidPole, along[0] * -25, along[1] * -25)], // a row of posts
    [30, ...dm(king)], [40, ...dm(fin)]
  ] };
  const { class: cls, counts } = miscPoles(byType, C.GEO);
  assert.deepEqual(Object.fromEntries(cls), { 10: 'dup', 11: 'hydro', 12: 'double', 20: 'post', 21: 'post', 22: 'post', 30: 'trolley', 40: 'core' });
  assert.equal(counts.hydro, 1);
  // drawn: on the curb islands (or back lanes and lots), never down a median; most placed
  const unlit = sites.filter((s) => s.type === MISC && !s.tram);
  assert.ok(unlit.length >= P.misc.hydro * 0.9 && unlit.every((s) => s.look === 'wood' && C.blockAt(s.x, s.z)), `${unlit.length} of ${P.misc.hydro} placed`);
  // none on a pole drawn already, nor in the core's rebuilt streets
  const drawn = C.poleIndex(sites.filter((s) => s.type !== MISC));
  assert.equal(unlit.filter((s) => drawn.nearest(s.x, s.z, 1)).length, 0);
  assert.equal(near(43.6487, -79.3812, 500).filter((s) => s.type === MISC && !s.tram).length, 0, 'none in the Financial District (but the streetcar streets\' span poles)');
  // a back lane's pole faces its line: its crossarm square to its nearest wooden neighbour
  const back = unlit.filter((s) => !s.road || s.toRoad > 12);
  const wood = C.poleIndex(sites.filter((s) => s.look === 'wood' && !s.median), 24);
  let square = 0;
  for (const s of back) {
    const n = wood.nearest(s.x, s.z, C.poleModels.SPAN.max, null, (o) => o !== s && Math.hypot(o.x - s.x, o.z - s.z) >= C.poleModels.SPAN.min);
    if (n && Math.abs(((n.x - s.x) * s.ax + (n.z - s.z) * s.az) / Math.hypot(n.x - s.x, n.z - s.z)) < 1e-6) square++;
  }
  assert.ok(back.length > 1000 && square > back.length * 0.7, `${square} of ${back.length} back-lane poles square to their line`);
});

const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const PM = C.poleModels;
const glowOf = (g) => Array.from(g.attributes.glow.array);
test('the pole models are cheap enough to instance by the thousand, their glass lit, their shadows coarse', () => {
  const wood = PM.woodPoleGeometry(CORE, mergeGeometries), transformer = PM.woodPoleGeometry(CORE, mergeGeometries, { transformer: true });
  assert.ok(tris(wood) <= 70 && tris(transformer) <= 100, `wood ${tris(wood)}, with a transformer ${tris(transformer)} triangles`);
  wood.computeBoundingBox();
  assert.ok(Math.abs(wood.boundingBox.max.y - PM.WOOD.h) < 0.05 && Math.abs(wood.boundingBox.min.y) < 1e-6);
  assert.ok(wood.boundingBox.max.x >= 1.15 && wood.boundingBox.min.x <= -1.15, 'a 2.4 m crossarm');
  assert.ok(glowOf(wood).every((g) => g === 0), 'the wooden pole\'s light is the LED head\'s lens');
  for (const look of Object.keys(PM.PED_LAMPS)) {
    const g = PM.pedLampGeometry(CORE, mergeGeometries, look);
    g.computeBoundingBox();
    assert.ok(tris(g) <= 120, `${look}: ${tris(g)} triangles`);
    assert.ok(Math.abs(g.boundingBox.max.y - PM.PED_LAMPS[look].h) < 0.06, `${look} is ${PM.PED_LAMPS[look].h} m tall`);
    const glow = glowOf(g), pos = g.attributes.position;
    assert.ok(glow.some((v) => v === 1) && glow.some((v) => v === 0));
    // the glass is round the lamp's height, the post below it dark
    for (let i = 0; i < pos.count; i++) if (glow[i]) assert.ok(Math.abs(pos.getY(i) - PM.PED_LAMPS[look].lampY) < 0.6);
    assert.ok(tris(PM.shadowStandIn(CORE, mergeGeometries, look)) <= 16);
  }
  assert.ok(tris(PM.shadowStandIn(CORE, mergeGeometries, 'wood')) <= 10);
  assert.ok(tris(PM.wireSpanGeometry(CORE)) <= 48);
});

test('the lines are strung on the high tier only; the poles, their crossarms and lamps on every tier', () => {
  const source = fs.readFileSync(new URL('../js/quality.js', import.meta.url), 'utf8');
  const quality = (search) => {
    const window = { CITY: {}, matchMedia: () => ({ matches: false }) };
    vm.runInNewContext(source, { window, location: { search }, URLSearchParams, console: { info() {} },
      navigator: { maxTouchPoints: 0, hardwareConcurrency: 8 }, screen: { width: 1600, height: 900 } });
    return window.CITY.QUALITY;
  };
  assert.equal(quality('?quality=high').poleWires, true);
  assert.equal(quality('?quality=medium').poleWires, false);
  assert.equal(quality('?quality=low').poleWires, false);
  assert.equal(quality('?quality=high&q.poleWires=false').poleWires, false, 'an A/B switch');
  // street-details.js reads the flag before stringing them, and the poles' models are not gated
  const details = fs.readFileSync(new URL('../js/street-details.js', import.meta.url), 'utf8');
  assert.match(details, /if \(window\.CITY\.QUALITY\.poleWires && window\.CITY\.woodSpans\)/);
  // the unlit hydro poles: the wooden model (its crossarm, insulators, now and then a transformer), a collider and a
  // footprint, no light; drawn on every tier, as the lit wooden poles are
  const unlit = details.slice(details.indexOf('if (s.type !== MISC'), details.indexOf('poleStats.placed.hydro++'));
  assert.ok(unlit.length > 0);
  assert.match(unlit, /addPole\(s\.x, s\.z, PM\.WOOD\.r/);
  assert.match(unlit, /addFootprint/);
  assert.match(unlit, /placeModel\(hashPos\(s\.x, 8\.1, s\.z\) < PM\.WOOD\.transformerShare \? 'woodTransformer' : 'wood'/);
  assert.doesNotMatch(unlit, /placeLuminaire|placeArm|lampSites|QUALITY/);
});
