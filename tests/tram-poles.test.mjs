// The poles on the streetcar streets (bead st-625): tools/build-poles.mjs miscPoles' trolley classes, their placement
// and models (js/mapped-poles.js), the span wires' pairing (tramSpans) and stringing to the contact wire
// (js/streetcars.js stringTramSpans), and the tiers they are drawn on
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as CORE from '../vendor/three/three.core.js';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { miscPoles, MISC_TRAM, MISC_CENTRE, TROLLEY_WOOD, TRAM_CLASSES } from '../tools/build-poles.mjs';

const context = { window: { CITY: { TSL: {} } }, location: { search: '' } };
for (const file of ['toronto-geodata', 'toronto-traffic-data', 'city-config', 'toronto-poles', 'mapped-poles'])
  vm.runInNewContext(fs.readFileSync(new URL(`../js/${file}.js`, import.meta.url), 'utf8'), context);
const C = context.window.CITY;
const { LIGHT, LIGHT_SIGNAL, MISC } = C.POLE_TYPES;
const PM = C.poleModels;
const streetcarsSource = fs.readFileSync(new URL('../js/streetcars.js', import.meta.url), 'utf8');
const stringTramSpans = new Function(`${streetcarsSource.slice(streetcarsSource.indexOf('const SPAN_HANG'), streetcarsSource.indexOf('function buildTrackwork'))}; return stringTramSpans;`)();

const { sites } = C.mappedPoleSites(C.POLES, C);
const tram = sites.filter((s) => s.tram);
const hoods = C.GEO.districtBounds.filter(([name]) => TROLLEY_WOOD.includes(name))
  .map(([, flat]) => Array.from({ length: flat.length / 2 }, (_, i) => ({ x: flat[2 * i], z: flat[2 * i + 1] })));
const eastOfTheDon = (s) => hoods.some((poly) => C.pointInPoly(poly, s.x, s.z));
// the contact wire as streetcars.js hangs it: over the main tracks and loops, 5.6 m up
const contact = [];
for (const [kind, service, name, flags, flat] of C.GEO.rails) {
  if (kind !== 0 || (service && !/Loop/i.test(name)) || flags & 2) continue;
  for (let i = 0; i + 3 < flat.length; i += 2) contact.push([flat[i], 5.6, flat[i + 1], flat[i + 2], 5.6, flat[i + 3]]);
}

test('the poles by the streetcar tracks: steel span poles, centre poles, wooden poles east of the Don, the yards\'', () => {
  // the reviewed 2026-02-20 snapshot: 1,026 within 9 m of a track (City 2025 aerials: King & Spadina, Queen & Broadview,
  // Gerrard & Broadview, Broadview at Riverdale Park, The Queensway, Roncesvalles, the Roncesvalles carhouse)
  const P = C.POLES.misc;
  assert.deepEqual([P.trolley, P.trolleyWood, P.trolleyCentre, P.trolleyYard], [780, 48, 28, 170]);
  assert.equal(P.trolley + P.trolleyWood + P.trolleyCentre + P.trolleyYard, 1026, 'the 1,026 PR #39 left out');
  // each rule on its own: one pole a time, rows [OBJECTID, x dm, z dm]
  const row = (id, lat, lon) => { const p = C.worldFromLatLon(lat, lon); return [id, Math.round(p.x * 10), Math.round(p.z * 10)]; };
  const cases = {
    1: [43.635680, -79.473300, 'trolleyCentre'], // between The Queensway's tracks
    2: [43.640185, -79.392852, 'trolleyCentre'], // Spadina's right-of-way south of Front
    3: [43.658993, -79.349570, 'trolleyWood'], // Queen St E at Broadview, the south side
    4: [43.665442, -79.352324, 'trolleyWood'], // Gerrard St E at Broadview
    5: [43.669100, -79.352904, 'trolleyWood'], // Broadview Ave
    6: [43.644370, -79.400540, 'trolley'], // King St W
    7: [43.640052, -79.448366, 'trolleyYard'], // the Roncesvalles carhouse
    8: [43.676552, -79.358825, 'trolleyYard'] // Broadview station's loop
  };
  for (const [id, [lat, lon, want]] of Object.entries(cases)) {
    const { class: cls } = miscPoles({ [MISC]: [row(Number(id), lat, lon)] }, C.GEO);
    assert.equal(cls.get(Number(id)), want, `case ${id}`);
  }
  assert.ok(MISC_CENTRE < MISC_TRAM);
});

test('the streetcar streets\' poles stand on the curb islands, the wooden ones east of the Don, facing the tracks', () => {
  const shipped = TRAM_CLASSES.reduce((n, k) => n + C.POLES.misc[k], 0);
  assert.ok(tram.length >= shipped * 0.97, `${tram.length} of ${shipped} placed`);
  const by = (look) => tram.filter((s) => s.look === look);
  assert.ok(by('trolley').length >= 760 && by('trolleyCentre').length >= 25 && by('wood').length >= 45);
  for (const s of tram) {
    assert.ok(C.blockAt(s.x, s.z) && C.deckHeightAt(s.x, s.z, 1000) <= 1);
    assert.equal(s.type, MISC);
    const t = C.nearestTram(s.x, s.z);
    assert.ok(t && t.dist < MISC_TRAM + 1.6, `pole ${s.id} by a track`);
    if (s.look === 'trolleyCentre') {
      assert.ok(t.dist < MISC_CENTRE + 1, `centre pole ${s.id} between the tracks`);
      assert.ok(Math.abs(s.ax * t.dx + s.az * t.dz) < 1e-6, 'its bracket arms across the track');
    } else if (t.dist > 0.3) assert.ok((t.px - s.x) * s.ax + (t.pz - s.z) * s.az > 0, `pole ${s.id} faces the track`);
  }
  // the wooden ones only east of the Don (Queen East, Gerrard, Broadview), the steel ones not there
  assert.ok(by('wood').every(eastOfTheDon));
  assert.equal(by('trolley').filter(eastOfTheDon).length, 0);
  assert.ok(by('wood').filter((s) => s.road && /^(Queen Street East|Gerrard Street East|Broadview Avenue)$/.test(s.road.road.name)).length >= 30);
  // King West's span poles are steel, and The Queensway's right-of-way has its centre poles
  assert.ok(by('trolley').filter((s) => s.road?.road.name === 'King Street West').length >= 50);
  assert.ok(by('trolleyCentre').filter((s) => s.road?.road.name === 'The Queensway').length >= 5);
});

test('the span wires pair the poles across the street, else run to a wall or a bracket; a centre pole\'s arms either way', () => {
  const spans = C.tramSpans(sites, { buildingAt: C.buildingIndex(C.GEO) });
  const { across, skew, wall, arm, bracket } = PM.TRAM_SPAN;
  const byId = new Map(sites.map((s) => [`${s.type}:${s.id}`, s]));
  const used = new Map();
  const kinds = { pole: 0, building: 0, bracket: 0, arm: 0 };
  for (const sp of spans) {
    kinds[sp.kind]++;
    const a = tram.find((s) => s.id === sp.pole);
    assert.ok(a, 'from a streetcar street\'s pole');
    assert.ok(Math.abs(sp.a.y - (a.y0 + PM.TROLLEY.spanY)) < 1e-9 && sp.a.x === a.x && sp.a.z === a.z, 'at its span clamp');
    const dx = sp.b.x - sp.a.x, dz = sp.b.z - sp.a.z, d = Math.hypot(dx, dz);
    const acr = dx * a.ax + dz * a.az, along = Math.abs(dx * -a.az + dz * a.ax);
    if (sp.kind === 'pole') {
      assert.ok(acr >= across[0] && acr <= across[1] && along <= skew, `${a.id}: ${acr.toFixed(1)} across, ${along.toFixed(1)} along`);
      const b = byId.get(`${MISC}:${sp.to}`) || byId.get(`${LIGHT}:${sp.to}`) || byId.get(`${LIGHT_SIGNAL}:${sp.to}`);
      assert.ok(b && (b.tram || ((b.type === LIGHT || b.type === LIGHT_SIGNAL) && !b.median)), 'to a span pole or a lit pole off the medians');
      for (const id of [sp.pole, sp.to]) used.set(id, (used.get(id) || 0) + 1);
    } else if (sp.kind === 'building') {
      assert.ok(acr >= across[0] && acr <= across[1] && along < 1e-6);
      assert.ok(C.buildingIndex(C.GEO)(sp.b.x, sp.b.z, wall), 'on a wall high enough');
    } else if (sp.kind === 'bracket') {
      assert.ok(sp.trim && Math.abs(d - bracket) < 1e-6);
    } else {
      assert.ok(a.look === 'trolleyCentre' && sp.trim && Math.abs(d - arm) < 1e-6);
    }
  }
  assert.ok([...used.values()].every((n) => n === 1), 'each pole strung across the street once');
  assert.ok(kinds.pole > 400 && kinds.building > 100 && kinds.bracket > 100, JSON.stringify(kinds));
  assert.equal(kinds.arm, 2 * tram.filter((s) => s.look === 'trolleyCentre').length, 'a centre pole\'s two arms');
  // every side pole has its span (or is the far end of one)
  const strung = new Set(spans.flatMap((sp) => [sp.pole, sp.to]));
  assert.equal(tram.filter((s) => !strung.has(s.id)).length, 0);
  // most of them hold up a contact wire; the rest stand by the non-revenue tracks (McCaul, Church, Ossington...) whose
  // rails and wire the city does not draw
  let segments = 0;
  const st = stringTramSpans(spans, contact, () => segments++);
  assert.ok(st.spans > 600 && st.dropped < 200 && st.hangers >= st.spans, JSON.stringify(st));
  assert.ok(segments < 4000, `${segments} line segments: cheap enough for every tier`);
});

test('a span wire is pulled down over each contact wire it crosses, a hanger to it; an arm ends at its last', () => {
  // two tracks along x, 3.4 m apart, their wire 5.6 m up
  const wires = [[-20, 5.6, 0, 20, 5.6, 0], [-20, 5.6, 3.4, 20, 5.6, 3.4]];
  const segs = [];
  const push = (x, z, ...s) => segs.push(s);
  let st = stringTramSpans([{ a: { x: 0, y: 6.52, z: -6 }, b: { x: 0, y: 6.52, z: 9.4 }, trim: false }], wires, push);
  assert.deepEqual(st, { spans: 1, hangers: 2, dropped: 0 });
  assert.equal(segs.length, 5, 'three lengths of span wire and two hangers');
  const hangers = segs.filter((s) => s[0] === s[3] && s[2] === s[5]);
  assert.deepEqual(hangers.map((s) => [s[1], s[4]].map((v) => +v.toFixed(3))), [[5.9, 5.6], [5.9, 5.6]]);
  assert.deepEqual(segs[0].slice(0, 3), [0, 6.52, -6]);
  assert.deepEqual(segs[2].slice(3), [0, 6.52, 9.4], 'to the far pole');
  // a centre pole's arm between the tracks: to the one wire on its side, no further
  segs.length = 0;
  st = stringTramSpans([{ a: { x: 0, y: 6.52, z: 1.7 }, b: { x: 0, y: 6.52, z: -2.8 }, trim: true }], wires, push);
  assert.equal(st.hangers, 1);
  assert.equal(segs.length, 2);
  assert.ok(Math.abs(segs[0][5]) < 1e-9, 'the arm\'s wire ends over the contact wire');
  // a span over no contact wire is not strung
  segs.length = 0;
  st = stringTramSpans([{ a: { x: 0, y: 6.5, z: 10 }, b: { x: 0, y: 6.5, z: 25 }, trim: false }], wires, push);
  assert.deepEqual(st, { spans: 0, hangers: 0, dropped: 1 });
  assert.equal(segs.length, 0);
});

const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
test('the steel span pole is cheap enough to instance by the thousand, at its true size, its shadow coarse', () => {
  const pole = PM.trolleyPoleGeometry(CORE, mergeGeometries), centre = PM.trolleyPoleGeometry(CORE, mergeGeometries, { centre: true });
  assert.ok(tris(pole) <= 72 && tris(centre) <= 110, `span pole ${tris(pole)}, centre pole ${tris(centre)} triangles`);
  pole.computeBoundingBox();
  centre.computeBoundingBox();
  assert.ok(Math.abs(pole.boundingBox.max.y - PM.TROLLEY.h) < 0.01 && Math.abs(pole.boundingBox.min.y) < 1e-6, `${pole.boundingBox.max.y} m tall`);
  assert.ok(pole.boundingBox.max.x < 0.3 && pole.boundingBox.min.x > -0.3, 'a slim pole, its eye bolts close in');
  assert.ok(centre.boundingBox.max.x >= PM.TROLLEY.arm && centre.boundingBox.min.x <= -PM.TROLLEY.arm, 'its bracket arms either side');
  // tapered: its shaft 0.34 m across at the foot, half that under the cap
  const pos = pole.attributes.position;
  let foot = 0, head = 0;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i)), y = pos.getY(i);
    if (Math.abs(y) < 1e-6 && r < 0.19) foot = Math.max(foot, r); // (the base collar is wider)
    if (y > 9 && y < 9.36) head = Math.max(head, r);
  }
  assert.ok(foot > 0.16 && head < 0.12 && foot > head * 1.4, `${foot.toFixed(3)} at the foot, ${head.toFixed(3)} at the top`);
  assert.ok(Array.from(pole.attributes.glow.array).every((g) => g === 0), 'no lamp');
  assert.ok(tris(PM.shadowStandIn(CORE, mergeGeometries, 'trolley')) <= 8);
  assert.ok(tris(PM.shadowStandIn(CORE, mergeGeometries, 'trolleyCentre')) <= 10);
});

test('the poles on every tier, their span wires too (in the contact wire\'s own draws), with an A/B switch', () => {
  const source = fs.readFileSync(new URL('../js/quality.js', import.meta.url), 'utf8');
  const quality = (search) => {
    const window = { CITY: {}, matchMedia: () => ({ matches: false }) };
    vm.runInNewContext(source, { window, location: { search }, URLSearchParams, console: { info() {} },
      navigator: { maxTouchPoints: 0, hardwareConcurrency: 8 }, screen: { width: 1600, height: 900 } });
    return window.CITY.QUALITY;
  };
  for (const tier of ['high', 'medium', 'low']) assert.equal(quality(`?quality=${tier}`).tramSpans, true, tier);
  assert.equal(quality('?quality=low&q.tramSpans=false').tramSpans, false, 'an A/B switch');
  const details = fs.readFileSync(new URL('../js/street-details.js', import.meta.url), 'utf8');
  assert.match(details, /if \(window\.CITY\.QUALITY\.tramSpans && window\.CITY\.tramSpans\)/);
  // the steel poles: a collider, a footprint and the model, on every tier
  const steel = details.slice(details.indexOf("(s.look !== 'trolley' && s.look !== 'trolleyCentre')"), details.indexOf('// their span wires'));
  assert.ok(steel.length > 0);
  assert.match(steel, /addPole\(s\.x, s\.z, PM\.TROLLEY\.r/);
  assert.match(steel, /addFootprint/);
  assert.match(steel, /placeModel\(s\.look/);
  assert.doesNotMatch(steel, /QUALITY/);
  assert.match(details, /trolley: \(\) => PM\.trolleyPoleGeometry/);
  // streetcars.js strings them into the contact wire's tiles: no draws of their own
  assert.match(streetcarsSource, /stringTramSpans\(window\.CITY\.tramSpanSites \|\| \[\], contact, \(x, z, \.\.\.seg\) => tileOf\(x, z\)\.wire\.push\(\.\.\.seg\)\)/);
});
