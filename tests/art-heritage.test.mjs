import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE0 from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { publicArt, heritageRegister, facadeShortlist, addressLabel } from '../tools/build-art-heritage.mjs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));
const base = { window: { CITY: {} } };
for (const f of ['toronto-geodata', 'toronto-geodata-ids', 'toronto-public-art', 'toronto-heritage']) vm.runInNewContext(read(`js/${f}.js`), base);
const { GEO, GEO_IDS, PUBLIC_ART, HERITAGE } = base.window.CITY;
const artSnap = json('tools/data/public-art-20261029.json'), review = json('tools/data/public-art-review-20261029.json');
const herSnap = json('tools/data/heritage-register-20261029.json');
const plain = (o) => JSON.parse(JSON.stringify(o));
const art = (title) => PUBLIC_ART.records.find((r) => r.title === title);

test('public art: generated layer matches the builder, keys are durable and unique, provenance kept', () => {
  const data = publicArt(artSnap, review, GEO, GEO_IDS);
  assert.deepEqual(plain(data), plain(PUBLIC_ART), 'js/toronto-public-art.js is the builder\'s output');
  assert.equal(data.records.length, 308);
  assert.equal(new Set(data.records.map((r) => r.id)).size, 308);
  assert.equal(data.geodata, GEO_IDS.geodata, 'built against the committed geodata');
  assert.equal(data.source.licence, 'open-government-licence-toronto');
  assert.match(data.source.sha256, /^[0-9a-f]{64}$/);
  // SOURCE_ID is shared by a development's works (98069 has 19): the key adds the title, so these stay distinct
  assert.ok(data.records.filter((r) => r.sourceId === '98069').length >= 19);
  // no image URLs are carried into the game
  assert.ok(!JSON.stringify(data).includes('/ext/pln/publicart/'), 'artwork photographs are not referenced');
  for (const r of data.records) assert.ok(r.title && r.address !== undefined && ['model', 'marker', 'landmark', 'none'].includes(r.show), r.id);
});

test('public art: duplicates, conflicts, missing reviews and incomplete snapshots are caught', () => {
  const twice = { ...artSnap, features: [...artSnap.features, { ...artSnap.features[0], properties: { ...artSnap.features[0].properties, _id: 9999 } }] };
  twice.total = twice.features.length;
  const d = publicArt(twice, review, GEO, GEO_IDS);
  assert.equal(d.audit.duplicate.length, 1, 'an exact repeat (other row id) is suppressed and audited');
  const conflict = structuredClone(twice);
  conflict.features.at(-1).properties.ARTIST = 'Someone Else';
  assert.throws(() => publicArt(conflict, review, GEO, GEO_IDS), /Conflicting/);
  assert.throws(() => publicArt({ ...artSnap, total: artSnap.total + 1 }, review, GEO, GEO_IDS), /Incomplete/);
  assert.throws(() => publicArt(artSnap, { ...review, modelled: [...review.modelled, { key: 'none:not-a-work', model: 'obelisk', position: 'osm:node/1', yaw: 0 }] }, GEO, GEO_IDS), /not in the snapshot/);
  const moved = structuredClone(review);
  moved.modelled[0].position = 'osm:node/1';
  assert.throws(() => publicArt(artSnap, moved, GEO, GEO_IDS), /reviewed position/);
});

test('public art: modelled works, landmark link, visibility classes and OSM merges', () => {
  const cenotaph = art('Cenotaph, Toronto'), fort = art('Fort Rouille Monument');
  assert.equal(cenotaph.model, 'cenotaph');
  assert.equal(cenotaph.place.basis, 'osm:node/555437359');
  // the City's point is in the Queen & Bay intersection; the reviewed spot is on the plaza in front of Old City Hall
  const ocH = GEO.buildings[GEO_IDS.buildings.indexOf('to-3dmassing-2025:141973')];
  assert.ok(cenotaph.place.z > ocH[1] + 44 && cenotaph.place.z < -728, `between the building (${ocH[1] + 44}) and Queen St`);
  assert.equal(fort.model, 'obelisk');
  assert.equal(art('Princes\' Gates').show, 'landmark');
  assert.equal(art('Princes\' Gates').landmarkId, 'princesGates');
  assert.ok(GEO.landmarks.princesGates, 'the landmark data is untouched');
  assert.equal(PUBLIC_ART.records.filter((r) => r.show === 'model').length, 2);
  // a modern work in copyright gets the marker, at OSM's point on the work
  const archer = art('Three Way Disk No. 2 (The Archer)');
  assert.equal(archer.show, 'marker');
  assert.equal(archer.osm.name, 'The Archer');
  assert.equal(archer.place.basis, archer.osm.id);
  // a work whose point is inside a building is search-only and says so
  const pixel = art('Pixel Cube');
  assert.equal(pixel.access, 'in-building');
  assert.equal(pixel.show, 'none');
  assert.equal(pixel.building.id, GEO_IDS.buildings[pixel.building.row]);
  // parks and streets named after a work's subject are not merged into it
  for (const r of PUBLIC_ART.records.filter((x) => x.osm)) assert.doesNotMatch(r.osm.name, /\b(Park|Square|St|Station|House)\b/, r.id);
  for (const r of PUBLIC_ART.records.filter((x) => x.place)) {
    assert.ok(r.place.x > GEO.frame.detail.x0 && r.place.x < GEO.frame.detail.x1 && r.place.z > GEO.frame.detail.z0 && r.place.z < GEO.frame.detail.z1, r.id);
  }
});

test('heritage: generated layer matches the builder; addresses grouped; buildings keyed by durable ID', () => {
  const data = heritageRegister(herSnap, GEO, GEO_IDS);
  assert.deepEqual(plain(data), plain(HERITAGE), 'js/toronto-heritage.js is the builder\'s output');
  assert.equal(data.geodata, GEO_IDS.geodata);
  assert.equal(new Set(data.records.map((r) => r.id)).size, data.records.length);
  const folders = data.records.flatMap((r) => r.entries.map((e) => e.f));
  assert.equal(new Set(folders).size, folders.length, 'each register entry once');
  assert.equal(folders.length + data.audit.duplicateEntries.length + data.audit.outsideFrame + data.audit.unknownStatus.length, herSnap.total);
  for (const r of data.records) if (r.b !== undefined) assert.equal(r.bid, GEO_IDS.buildings[r.b], r.id);
  assert.ok(data.audit.matches > data.records.length * 0.9, 'most register addresses stand in a City massing building');
  // Exhibition Place's 2 Strachan Ave: 22 structures, one place
  assert.equal(data.records.find((r) => r.id === 'heritage:2-strachan-ave').entries.length, 22);
  // one address mapped at two places far apart stays two places
  assert.ok(data.records.find((r) => r.id === 'heritage:61-front-st-w~2'));
  const stMary = data.records.find((r) => r.id === 'heritage:10-st-mary-st');
  assert.equal(stMary.entries[0].st, 'Part IV');
  assert.match(stMary.entries[0].bl, /353-2015/);
  assert.equal(stMary.bid, 'to-3dmassing-2025:139370');
  assert.equal(addressLabel('17  SALISBURY AVE'), '17 Salisbury Ave');
  assert.equal(addressLabel("1  QUEEN'S PARK CRES E"), "1 Queen's Park Cres E");
  const dup = structuredClone(herSnap);
  dup.rows.push(dup.rows[0]);
  dup.total++;
  assert.throws(() => heritageRegister(dup, GEO, GEO_IDS), /duplicate heritage Folder_Row/i);
  assert.throws(() => heritageRegister({ ...herSnap, total: 1 }, GEO, GEO_IDS), /Incomplete/);
});

test('heritage facade shortlist names durable faces of matched buildings', () => {
  const list = json('tools/data/heritage-facade-shortlist-20261029.json');
  assert.equal(list.geodata, GEO_IDS.geodata);
  assert.deepEqual(list.places, plain(facadeShortlist(HERITAGE, GEO)));
  for (const p of list.places) {
    assert.match(p.face, /^to-3dmassing-2025:\d+(\.\d+)?:[nesw]$/);
    assert.ok(GEO_IDS.buildings.includes(p.building));
    assert.ok(p.status.includes('Part IV') || p.status.includes('Part V'));
  }
});

// The city's own modules in a VM: search, cards and the street placement
function city() {
  const THREE = { ...THREE0, MeshStandardNodeMaterial: THREE0.MeshStandardMaterial };
  const ctx = { window: { CITY: { THREE, Addons: { mergeGeometries } } }, URL, URLSearchParams, location: { search: '' }, console: { info() {}, warn: console.warn, log() {} } };
  for (const f of ['toronto-geodata', 'toronto-public-art', 'city-config', 'world-collision', 'public-art', 'discovery', 'navigation']) vm.runInNewContext(read(`js/${f}.js`), ctx);
  return ctx;
}

test('search finds artworks by title, artist and short name, and heritage once loaded', () => {
  const ctx = city(), C = ctx.window.CITY, N = C.Navigation;
  assert.equal(N.searchPlaces('cenotaph')[0].discovery.record.title, 'Cenotaph, Toronto');
  assert.equal(N.searchPlaces('henry moore')[0].discovery.record.artist, 'Moore, Henry');
  assert.ok(N.searchPlaces('the archer').some((p) => p.discovery?.record.title.includes('The Archer')));
  assert.ok(N.searchPlaces('sculpture', { limit: 20 }).filter((p) => p.cat === 'art').length >= 10);
  // the OSM place a City record stands in for is not a second result
  assert.equal(N.buildIndex().filter((p) => p.name === 'The Archer').length, 0);
  assert.equal(N.buildIndex().filter((p) => p.cat === 'art').length, 308);
  assert.equal(N.buildIndex().filter((p) => p.cat === 'heritage').length, 0, 'heritage waits for the lazy layer');
  vm.runInNewContext(read('js/toronto-heritage.js'), ctx);
  N.resetIndex();
  assert.equal(N.searchPlaces('10 st mary street')[0].discovery.record.id, 'heritage:10-st-mary-st');
  assert.equal(N.buildIndex().filter((p) => p.cat === 'heritage').length, C.HERITAGE.records.length);
  assert.equal(N.searchPlaces('CN Tower')[0].kind, 'landmark', 'the existing city still answers first');
  const card = C.Discovery.discoveryCard(N.searchPlaces('10 st mary street')[0]);
  assert.ok(card.facts.some(([k, v]) => k === 'By-law' && v.includes('353-2015')));
  assert.ok(card.notes[0].includes('Not a legal status determination'));
  assert.ok(card.links.length === 2 && card.links.every((l) => l.href.startsWith('https://') && /toronto\.ca$/.test(new URL(l.href).hostname)));
});

test('placement: monuments and markers stand on land, clear of solid things, with honest cards', () => {
  const ctx = city(), C = ctx.window.CITY;
  const scene = { add() {} };
  const fort = art('Fort Rouille Monument');
  // something solid where a marker wants to stand: it moves, or is left out, never overlaps
  const archer = art('Three Way Disk No. 2 (The Archer)');
  const W = C.WorldCollision;
  const block = W.boxCollider(archer.place.x, archer.place.z, 0.5, 0.5, 0, 0, 3, 'box');
  const out = C.buildPublicArt(scene, [block]);
  const stats = C.publicArtStats;
  assert.equal(out.models, 2);
  assert.ok(out.markers > 150, `${out.markers} markers`);
  assert.ok(stats.models.some((m) => m.model === 'obelisk' && m.x === fort.place.x));
  for (const s of stats.sites) {
    assert.ok(C.blockAt(s.x, s.z), `marker ${s.records[0]} on a curb island, plaza or park`);
    assert.ok(s.moved <= 2.01);
    assert.ok(!(Math.abs(s.x - archer.place.x) < 0.5 + 0.4 && Math.abs(s.z - archer.place.z) < 0.5 + 0.4), 'clear of the box');
  }
  for (let i = 0; i < stats.sites.length; i++) for (let j = i + 1; j < stats.sites.length; j++) {
    assert.ok(Math.hypot(stats.sites[i].x - stats.sites[j].x, stats.sites[i].z - stats.sites[j].z) >= 0.9);
  }
  const placed = stats.sites.reduce((n, s) => n + s.records.length, 0);
  const r = stats.rejected;
  assert.equal(placed + r.roadOrWater + r.obstructed, PUBLIC_ART.records.filter((x) => x.show === 'marker').length);
  assert.equal(out.colliders.length, 2 + stats.sites.length);
  // cards say what the city shows
  const cards = C.Discovery;
  const item = (rec) => C.Navigation.buildIndex().find((p) => p.discovery?.record.id === rec.id);
  const shown = (rec) => cards.discoveryCard(item(rec)).facts.find(([k]) => k === 'In the 3D city')[1];
  assert.match(shown(art('Cenotaph, Toronto')), /simplified massing/);
  assert.match(shown(art('Princes\' Gates')), /landmark/);
  assert.match(shown(art('Pixel Cube')), /Not marked/);
  const marked = PUBLIC_ART.records.find((x) => C.publicArtSite(x.id)?.kind === 'marker');
  assert.match(shown(marked), /stand-in marker/);
  // geometry budgets: markers stay tiny, monuments small
  const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  assert.ok(tris(C.publicArtModelGeometry('marker')) <= 80);
  assert.ok(tris(C.publicArtModelGeometry('cenotaph')) <= 600 && tris(C.publicArtModelGeometry('obelisk')) <= 200);
});

test('the heritage layer is not a startup script; discovery loads it on demand', () => {
  const html = read('explore.html');
  assert.ok(!html.includes('toronto-heritage.js'));
  assert.ok(html.includes("'./js/toronto-public-art.js'") && html.includes("'./js/discovery.js'") && html.includes("'./js/public-art.js'"));
  assert.match(read('js/discovery.js'), /'\.\/js\/toronto-heritage\.js'/, 'a page-relative path, followed and fingerprinted by tools/build-site.mjs');
});
