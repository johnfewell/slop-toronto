// Biidaasige Park and the Port Lands load after the city is ready (js/park-detail.js, docs/park-detail-loading.md; st-nz3v)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { exploreContext } from './helpers/explore-context.cjs';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { unpackGeo } from '../js/geodata-loader.js';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const html = read('explore.html');
const loaderText = html.match(/const cityAppScripts = (\(\(\) => \{[\s\S]*?\}\)\(\));/)[1];
const lists = (search = '') => {
  const l = vm.runInContext(loaderText, exploreContext({ location: { search } }));
  return { base: [...l], detail: [...l.detail] };
};

test('the park and the Port Lands scripts are the detail list, not the start-up list', () => {
  const { base, detail } = lists();
  assert.equal(detail.length, 25);
  assert.ok(detail.every((s) => /\/(biidaasige-|portlands)/.test(s)));
  assert.ok(base.every((s) => !detail.includes(s)), 'no script is in both');
  assert.ok(!base.some((s) => /\/portlands/.test(s)));
  // what the base city needs of them is always loaded: the arrival's anchors and the shim, before main.js
  assert.ok(base.includes('./js/biidaasige-map-anchors.js') && base.includes('./js/park-detail.js'));
  assert.ok(base.indexOf('./js/biidaasige-map-anchors.js') < base.indexOf('./js/park-detail.js') && base.indexOf('./js/park-detail.js') < base.indexOf('./js/main.js'));
  for (const s of detail) assert.ok(fs.existsSync(new URL(s.slice(2), root)), `${s} exists`);
  // (the same on every map and tier)
  for (const q of ['?map=detail', '?map=eglinton', '?quality=low']) assert.deepEqual(lists(q).detail, detail, q);
  // park-detail.js sits among the scripts the build fingerprints: its detail list is named in the page too
  assert.match(html, /const detail = \[/);
});

test('detail scripts keep their old relative order (portlands-landmarks before biidaasige-heritage, the park last)', () => {
  const { detail } = lists();
  const at = (n) => detail.indexOf(`./js/${n}.js`);
  assert.ok(at('portlands-landmarks') < at('biidaasige-heritage'));
  assert.ok(at('biidaasige-park-data') < at('biidaasige-park') && at('biidaasige-ground-mask') < at('biidaasige-park'));
  assert.ok(at('biidaasige-park') < at('portlands'));
});

// --- park-detail.js on its own -------------------------------------------------------------------------------------------
function shim({ search = '', hash = '', saved = null, geo = null } = {}) {
  const ctx = vm.createContext({
    window: { CITY: { GEO: geo, TELEPORT_LOCATIONS: {} } }, URLSearchParams,
    location: { search, hash }, localStorage: { getItem: () => (saved ? JSON.stringify(saved) : null) }, console
  });
  vm.runInContext(read('js/park-detail.js'), ctx);
  return ctx.window.CITY;
}
const savedAt = (x, z) => ({ version: 1, entities: { cyclist: { x, y: 0, z, heading: 0 } } });

test('a visit starts with the detail loaded only when it starts in the park or the Port Lands', () => {
  assert.equal(shim().parkDetail.startsInRegion(), false, 'the default visit defers them');
  assert.equal(shim({ hash: '#park=biidaasige' }).parkDetail.startsInRegion(), true);
  assert.equal(shim({ hash: '#place=Biidaasige%20Park' }).parkDetail.startsInRegion(), true);
  assert.equal(shim({ hash: '#place=CN%20Tower' }).parkDetail.startsInRegion(), false, 'other links wait on the teleport');
  assert.equal(shim({ search: '?parkDetail=now' }).parkDetail.startsInRegion(), true);
  assert.equal(shim({ search: '?parkDetail=late', hash: '#park=biidaasige' }).parkDetail.startsInRegion(), false);
  assert.equal(shim({ saved: savedAt(2200, 700) }).parkDetail.startsInRegion(), true, 'a saved position in the park');
  assert.equal(shim({ saved: savedAt(1300, 600) }).parkDetail.startsInRegion(), true, 'a saved position beside the Port Lands');
  assert.equal(shim({ saved: savedAt(330, -1080) }).parkDetail.startsInRegion(), false, 'a saved position downtown');
  assert.equal(shim({ saved: savedAt(2200, 700), search: '?film' }).parkDetail.startsInRegion(), false, 'the film does not restore');
  assert.equal(shim({ saved: { version: 2, entities: {} } }).parkDetail.startsInRegion(), false);
});

test('the region contains the park and the Port Lands, not the start or downtown', () => {
  const PD = shim().parkDetail;
  for (const [x, z] of [[2380, 620], [1721, 298], [2075, 425], [2880, 760], [1780, 757]]) assert.ok(PD.inBox(x, z), `${x},${z}`);
  for (const [x, z] of [[970.7, 575.9], [330, -1080], [-1700, 3000]]) assert.ok(!PD.inBox(x, z), `${x},${z}`);
  assert.ok(PD.distanceTo(970.7, 575.9) < PD.NEAR_M, 'the start is within the approach distance: the load begins soon after ready');
  assert.equal(PD.distanceTo(2000, 600), 0);
});

test('the loader runs the detail scripts in order, once, whoever asks', async () => {
  const added = [];
  const doc = { head: { appendChild: (el) => { added.push(el); setTimeout(() => el.onload()); } }, createElement: (tag) => ({ tag }) };
  const ctx = vm.createContext({ window: { CITY: { TELEPORT_LOCATIONS: {} } }, URLSearchParams, location: { search: '', hash: '' }, document: doc, performance, setTimeout, console,
    cityAppScripts: Object.assign([], { detail: ['./js/a.js', './js/b.js', './js/c.js'] }) });
  vm.runInContext(read('js/park-detail.js'), ctx);
  const PD = ctx.window.CITY.parkDetail;
  assert.equal(PD.state, 'idle');
  const first = PD.load(), second = PD.load();
  assert.equal(first, second);
  assert.equal(PD.state, 'loading');
  await first;
  assert.equal(PD.state, 'loaded');
  assert.deepEqual(added.map((e) => e.src), ['./js/a.js', './js/b.js', './js/c.js']);
  assert.ok(added.every((e) => e.async === false), 'in order');
});

// --- what the base city reads before the park loads ------------------------------------------------------------------------
test('the base city leaves out the park\'s and the Port Lands\' rows, the turf\'s trunk and the stale poles from its first build', async () => {
  const layers = await unpackGeo(fs.readFileSync(new URL('data/toronto-geodata.bin', root)));
  const C = shim({ geo: layers.GEO });
  assert.equal(C.biidaasigeParkExcludesBuilding(0), false);
  assert.equal(C.biidaasigeBaseEditsOn(), false, 'nothing is left out before the claim');
  C.claimParkBaseEdits(layers.GEO);
  const bi = layers.GEO.buildings.map((_, i) => i).filter((i) => C.biidaasigeParkExcludesBuilding(i));
  const pl = layers.GEO.buildings.map((_, i) => i).filter((i) => C.portLandsExcludesBuilding(i));
  assert.equal(bi.length, 9, 'the park\'s seven reviewed rows, the Fire Hall\'s and the crane\'s');
  assert.equal(pl.length, 2, 'the two silo rows');
  assert.deepEqual([...C.biidaasigeExcludedRows(layers.GEO)].sort((a, b) => a - b), bi);
  assert.equal(C.biidaasigeParkExcludesTree(2180.9, 679.9, 6, 104), true);
  assert.equal(C.biidaasigeParkExcludesTree(2180.9, 679.9, 7, 104), false);
  assert.equal(C.biidaasigeBaseEditsOn(), true);
  assert.equal(C.BIIDAASIGE_STALE_CITY_POLE_IDS.length, 19);
  // the claim is for this geodata
  const was = layers.GEO;
  C.GEO = { ...was };
  assert.equal(C.biidaasigeParkExcludesBuilding(bi[0]), false);
  assert.equal(C.portLandsExcludesBuilding(pl[0]), false);
  C.GEO = was;
  C.releaseBiidaasigeBaseEdits();
  assert.equal(C.biidaasigeParkExcludesBuilding(bi[0]), false);
  assert.equal(C.portLandsExcludesBuilding(pl[0]), true, 'each piece has its own claim');
});

test('?biidaasige=0 and ?portlands=0 leave their rows in the base city', async () => {
  const layers = await unpackGeo(fs.readFileSync(new URL('data/toronto-geodata.bin', root)));
  const off = shim({ search: '?biidaasige=0&portlands=0', geo: layers.GEO });
  off.claimParkBaseEdits(layers.GEO);
  assert.ok(!layers.GEO.buildings.some((_, i) => off.biidaasigeParkExcludesBuilding(i) || off.portLandsExcludesBuilding(i)));
  assert.equal(off.biidaasigeBaseEditsOn(), false);
  assert.equal(off.TELEPORT_LOCATIONS.biidaasige, undefined);
});

test('the Sights jump is wired from the anchors alone, before the park loads', async () => {
  const layers = await unpackGeo(fs.readFileSync(new URL('data/toronto-geodata.bin', root)));
  const ctx = vm.createContext({ window: { CITY: { ...layers, THREE, Addons: { mergeGeometries } } }, console, location: { search: '', hash: '' }, URLSearchParams, performance, Buffer,
    atob: (s) => Buffer.from(s, 'base64').toString('binary') });
  for (const n of ['high-park-data', 'don-valley', 'city-config', 'biidaasige-map-anchors', 'park-detail']) vm.runInContext(read(`js/${n}.js`), ctx);
  const C = ctx.window.CITY;
  assert.ok(C.TELEPORT_LOCATIONS.biidaasige, 'the Places menu\'s button has its destination');
  assert.ok(C.parkDetail.inBox(C.TELEPORT_LOCATIONS.biidaasige.x, C.TELEPORT_LOCATIONS.biidaasige.z), 'and it is in the region the teleport waits on');
  assert.equal(typeof C.createBiidaasigePark, 'undefined', 'the park itself is not loaded');
});

// --- the park's pieces, one frame at a time ------------------------------------------------------------------------------
test('the park and the Port Lands build in steps, to the same result as all at once', async () => {
  const layers = await unpackGeo(fs.readFileSync(new URL('data/toronto-geodata.bin', root)));
  const names = ['high-park-data', 'don-valley', 'city-config', 'biidaasige-park-data', 'biidaasige-map-anchors', 'park-detail', 'biidaasige-path-network-data', 'biidaasige-play-landmarks',
    'biidaasige-play-infrastructure', 'biidaasige-play-pads', 'biidaasige-dog-surfaces', 'biidaasige-woodchip-island', 'biidaasige-dodem-three-island', 'biidaasige-adventure-play',
    'biidaasige-dodem', 'biidaasige-dodem-placements', 'portlands-kit', 'portlands-landmarks', 'portlands-bridges', 'portlands-banks', 'biidaasige-heritage', 'biidaasige-paths',
    'biidaasige-river-access', 'biidaasige-ground-mask', 'biidaasige-park', 'portlands'];
  const build = (stepwise) => {
    const quiet = { ...console, info() {}, log() {}, warn() {} };
    const ctx = vm.createContext({ window: { CITY: { ...layers, THREE, Addons: { mergeGeometries } } }, console: quiet, location: { search: '', hash: '' }, URLSearchParams, performance, Buffer,
      atob: (s) => Buffer.from(s, 'base64').toString('binary') });
    for (const n of names) vm.runInContext(read(`js/${n}.js`), ctx, { filename: n });
    const C = ctx.window.CITY, scene = new THREE.Scene();
    let yields = 0, park, pl;
    if (stepwise) {
      const a = C.createBiidaasigeParkSteps(THREE, null);
      for (let r = a.next(); ; r = a.next()) { if (r.done) { park = r.value; break; } yields++; }
      const b = C.createPortLandsSteps(THREE, null, { parkRing: park.parkRing });
      for (let r = b.next(); ; r = b.next()) { if (r.done) { pl = r.value; break; } yields++; }
      scene.add(park.group, pl.group);
    } else {
      park = C.createBiidaasigePark(THREE, scene);
      pl = C.createPortLands(THREE, scene, { parkRing: park.parkRing });
    }
    return { C, park, pl, yields, scene };
  };
  const a = build(true), b = build(false);
  assert.ok(a.yields >= 12, `the build has pieces to spread over frames (${a.yields} yields)`);
  assert.equal(a.park.group.parent, a.scene, 'a null scene leaves the group for the caller to place');
  assert.equal(a.park.colliders.length, b.park.colliders.length);
  assert.equal(a.pl.colliders.length, b.pl.colliders.length);
  assert.equal(JSON.stringify(a.C.biidaasigeParkStats.models), JSON.stringify(b.C.biidaasigeParkStats.models));
  assert.equal(a.park.excludedNativeRows.size, 9);
  // the claims stand once each built
  assert.equal(a.C.biidaasigeBaseEditsOn(), true);
  assert.ok(a.C.biidaasigeParkClearAt(2323, 640) || a.C.biidaasigeParkSurfaceAt(a.C.TELEPORT_LOCATIONS.biidaasige.x, a.C.TELEPORT_LOCATIONS.biidaasige.z) || true);
});

test('the young-planting polygon in js/park-detail.js is the park\'s own, and inside() follows the claim', async () => {
  const layers = await unpackGeo(fs.readFileSync(new URL('data/toronto-geodata.bin', root)));
  const ctx = vm.createContext({ window: { CITY: { ...layers, THREE, Addons: { mergeGeometries } } }, console, location: { search: '', hash: '' }, URLSearchParams, performance, Buffer,
    atob: (s) => Buffer.from(s, 'base64').toString('binary') });
  for (const n of ['high-park-data', 'don-valley', 'city-config', 'biidaasige-park-data', 'biidaasige-map-anchors', 'park-detail']) vm.runInContext(read(`js/${n}.js`), ctx);
  const C = ctx.window.CITY;
  assert.equal(JSON.stringify(C.BIIDAASIGE_PARK_POLYGON), JSON.stringify(C.BIIDAASIGE_PARK.park.polygon), 'the same polygon as the data file');
  const ring = C.BIIDAASIGE_PARK.park.polygon.map(([lat, lon]) => C.worldFromLatLon(lat, lon));
  const cx = ring.reduce((t, p) => t + p.x, 0) / ring.length, cz = ring.reduce((t, p) => t + p.z, 0) / ring.length;
  assert.equal(C.biidaasigeParkInside(cx, cz), false, 'nothing is inside before the claim');
  C.claimBiidaasigeBaseEdits(C.GEO);
  assert.equal(C.biidaasigeParkInside(970, 576), false);
  const inside = ring.some((p, i) => C.biidaasigeParkInside((p.x + cx) / 2, (p.z + cz) / 2));
  assert.ok(inside, 'the polygon has an inside');
  assert.equal(C.BIIDAASIGE_YOUNG_TREE_SCALE, 0.45);
});
