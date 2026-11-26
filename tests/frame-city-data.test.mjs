// The City's furniture and amenities across the whole Eglinton frame (jf-e8y): every layer that stopped at the detail
// map's boundary has a file of its own for ?map=eglinton (js/frames/eglinton/), built from the same dated snapshots by the
// same tools (--frame eglinton); the detail map's files, and so its download, are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { frames, audit } from '../tools/audit-frame-coverage.mjs';
import { furniture } from '../tools/build-open-data.mjs';
import { parkingMeters } from '../tools/build-parking-meters.mjs';
import { cafeto } from '../tools/build-cafeto.mjs';
import { unpackGeo } from '../js/geodata-loader.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const json = (f) => JSON.parse(read(f));
// (through JSON: the layer is built in the script's own realm)
const load = (file) => { const c = { window: { CITY: {} } }; vm.runInNewContext(read(file), c); return JSON.parse(JSON.stringify(c.window.CITY)); };
const boxes = frames();
const inBox = (b, r) => r.x > b.detail.x0 && r.x < b.detail.x1 && r.z > b.detail.z0 && r.z < b.detail.z1;
const LAYERS = [['BENCHES', 'toronto-benches.js'], ['WAYFINDING', 'toronto-wayfinding.js'], ['PARKING_METERS', 'toronto-parking-meters.js'],
  ['CAFETO', 'toronto-cafeto.js'], ['CITY_FACILITIES', 'toronto-city-facilities.js'], ['PUBLIC_ART', 'toronto-public-art.js']];
const detail = Object.fromEntries(LAYERS.map(([k, f]) => [k, load(`js/${f}`)[k]]));
const egl = Object.fromEntries(LAYERS.map(([k, f]) => [k, load(`js/frames/eglinton/${f}`)[k]]));

test('the audit counts the layers\' source records in both frames, and the Eglinton frame never holds fewer', () => {
  const rows = audit();
  assert.ok(rows.length >= 15);
  for (const r of rows) assert.ok(r.eglinton >= r.detail && r.detail > 0, `${r.layer}: ${r.detail} -> ${r.eglinton}`);
});

test('benches and wayfinding: the Eglinton file holds every Existing record of the frame, the detail map\'s files are unchanged', () => {
  for (const [key, name] of [['BENCHES', 'benches'], ['WAYFINDING', 'wayfinding']]) {
    const snapshot = json(`tools/data/${name}-20261028.json`);
    assert.deepEqual(detail[key].records, furniture(snapshot, boxes.detail).records, `${name}: the detail map's file`);
    assert.deepEqual(egl[key].records, furniture(snapshot, boxes.eglinton).records, `${name}: the Eglinton map's file`);
  }
  assert.equal(egl.BENCHES.records.length, 860);
  assert.equal(egl.WAYFINDING.records.length, 330);
});

test('parking pay stations: the same TPA snapshot clipped to each frame', () => {
  const snapshot = json('tools/data/parking-meters-20261028.json');
  assert.deepEqual(detail.PARKING_METERS.records, parkingMeters(snapshot, boxes.detail).records);
  assert.deepEqual(egl.PARKING_METERS.records, parkingMeters(snapshot, boxes.eglinton).records);
  assert.equal(egl.PARKING_METERS.records.length, 1007);
  assert.equal(egl.PARKING_METERS.rejected.outside, 7, 'only seven machines lie beyond the Eglinton frame');
});

test('CaféTO cafés: the Eglinton file holds the sidewalk and curb cafés of the whole frame, private patios counted', () => {
  const snapshot = json('tools/data/cafeto-20261029.json');
  assert.deepEqual(detail.CAFETO.records, cafeto(snapshot, boxes.detail).records);
  const e = cafeto(snapshot, boxes.eglinton);
  assert.deepEqual(egl.CAFETO.records, e.records);
  assert.deepEqual(egl.CAFETO.counts, { total: 1636, outside: 273, private: 488, sidewalk: 590, curb: 285 });
  assert.equal(egl.CAFETO.records.length, 875);
});

test('every layer\'s Eglinton file holds the detail file\'s records, at the same places', () => {
  for (const [key] of LAYERS) {
    const ids = new Map(egl[key].records.map((r) => [r.id, r]));
    assert.equal(ids.size, egl[key].records.length, `${key}: unique ids`);
    for (const r of detail[key].records) {
      const o = ids.get(r.id);
      assert.ok(o, `${key}: ${r.id} is in the larger frame`);
      assert.ok(Math.abs(o.x - r.x) < 0.011 && Math.abs(o.z - r.z) < 0.011, `${key}: ${r.id} stands where it did`);
    }
    assert.ok(egl[key].records.every((r) => inBox(boxes.eglinton, r)), `${key}: inside the frame`);
    assert.ok(egl[key].records.length > detail[key].records.length, `${key}: more of the City than the detail map`);
  }
});

test('City facilities: washrooms, parks and recreation centres, drinking water, rink and tennis cards of the whole frame', () => {
  const by = (c) => Object.fromEntries(['washroom', 'facility', 'water', 'rink', 'tennis'].map((k) => [k, c.records.filter((r) => r.kind === k).length]));
  assert.deepEqual(by(detail.CITY_FACILITIES), { washroom: 78, facility: 276, water: 248, rink: 17, tennis: 11 });
  assert.deepEqual(by(egl.CITY_FACILITIES), { washroom: 161, facility: 660, water: 468, rink: 37, tennis: 39 });
  assert.equal(egl.CITY_FACILITIES.audit.duplicate.length, detail.CITY_FACILITIES.audit.duplicate.length + 0);
});

test('facility, art and heritage rows are the Eglinton geodata\'s own (not the detail map\'s)', async () => {
  const { GEO } = await unpackGeo(fs.readFileSync(new URL('../data/frames/eglinton/toronto-geodata.bin', import.meta.url)));
  // a facility matched to a building or park stands inside / by that row of the frame's own database
  let checked = 0;
  for (const r of egl.CITY_FACILITIES.records) {
    if (r.match?.kind === 'building') {
      const b = GEO.buildings[r.match.index];
      assert.ok(b && Math.hypot(b[0] - r.x, b[1] - r.z) < 400, `${r.id}: building row ${r.match.index}`);
      checked++;
    } else if (r.match?.kind === 'park') {
      assert.equal(GEO.areas[r.match.index][1], r.match.name, `${r.id}: park row`);
      checked++;
    }
  }
  assert.ok(checked > 300, `${checked} facilities matched to the frame's geometry`);
  // art merged with an OpenStreetMap place: that place's row in this frame's pois
  const merged = egl.PUBLIC_ART.records.filter((r) => r.osm);
  assert.ok(merged.length >= 60);
  for (const r of merged) {
    const p = GEO.pois[r.osm.row];
    assert.ok(p && Math.hypot(p[0] - r.osm.x, p[1] - r.osm.z) < 0.2 && p[2] === r.osm.name, `${r.id}: place row ${r.osm.row}`);
  }
  for (const r of egl.PUBLIC_ART.records.filter((q) => q.building)) {
    const b = GEO.buildings[r.building.row];
    assert.ok(b && Math.hypot(b[0] - r.x, b[1] - r.z) < 400, `${r.id}: building row`);
  }
});

test('the heritage register of the Eglinton frame is its own file, rows of its own geodata', async () => {
  const H = load('js/frames/eglinton/toronto-heritage.js').HERITAGE, D = load('js/toronto-heritage.js').HERITAGE;
  const { GEO } = await unpackGeo(fs.readFileSync(new URL('../data/frames/eglinton/toronto-geodata.bin', import.meta.url)));
  const ids = new Map(H.records.map((p) => [p.id, p]));
  assert.equal(ids.size, H.records.length);
  assert.ok(H.records.length > D.records.length);
  for (const p of D.records) assert.ok(ids.has(p.id), `${p.id} stays`);
  for (const p of H.records.filter((q) => q.b != null).slice(0, 4000)) {
    const b = GEO.buildings[p.b];
    assert.ok(b && Math.hypot(b[0] - p.x, b[1] - p.z) < 400, `${p.id}: building row ${p.b}`);
  }
  assert.ok(H.records.every((p) => inBox(boxes.eglinton, p)));
});

test('Bike Share: every station of the system inside each frame, from the committed snapshot', () => {
  const snapshot = json('tools/data/bike-share-stations-20261026.json');
  assert.equal(snapshot.stationInformation.data.stations.length, 1071);
  const stations = (file) => load(file).BIKE_SHARE.stations;
  const d = stations('js/bike-share-stations.js'), e = stations('js/frames/eglinton/bike-share-stations.js');
  assert.equal(d.length, 481);
  assert.equal(e.length, 772);
  const ids = new Set(e.map((s) => s[0]));
  assert.ok(d.every((s) => ids.has(s[0])));
  assert.equal(load('js/frames/eglinton/bike-share-stations.js').BIKE_SHARE.feed, load('js/bike-share-stations.js').BIKE_SHARE.feed, 'one dated feed for both frames');
});

test('explore.html loads the detail map\'s files by default and the frame\'s files under ?map=eglinton, discovery.js its register', () => {
  const html = read('explore.html');
  for (const f of ['toronto-parking-meters', 'toronto-benches', 'toronto-city-facilities', 'toronto-wayfinding', 'toronto-public-art', 'toronto-cafeto', 'bike-share-stations']) {
    assert.ok(html.includes(`eglinton ? './js/frames/eglinton/${f}.js' : './js/${f}.js'`), f);
  }
  assert.match(read('js/discovery.js'), /cityAppScripts\.cityMap === 'eglinton' \? '\.\/js\/frames\/eglinton\/toronto-heritage\.js' : '\.\/js\/toronto-heritage\.js'/);
});
