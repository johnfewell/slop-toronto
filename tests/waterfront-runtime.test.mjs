// Build the waterfront against both shipped map databases and the real city-grid
// geometry helpers. This catches integration failures hidden by isolated fallbacks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { unpackGeo } from '../js/geodata-loader.js';

for (const frame of ['detail', 'eglinton']) test('waterfront runtime builds with real helpers on ' + frame, async () => {
  const file = frame === 'detail' ? 'data/toronto-geodata.bin' : 'data/frames/eglinton/toronto-geodata.bin';
  const layers = await unpackGeo(fs.readFileSync(new URL('../' + file, import.meta.url)));
  const ctx = vm.createContext({
    window: { CITY: { ...layers, THREE, TSL, Addons: { mergeGeometries } } },
    console: { info() {}, log() {}, warn() {} }, location: { search: '?map=' + frame },
    URLSearchParams, performance, Buffer, atob: s => Buffer.from(s, 'base64').toString('binary')
  });
  for (const name of ['high-park-data', 'don-valley', 'city-config', 'city-grid', 'waterfront-details',
    'waterfront-beach-ground', 'waterfront-public-realm', 'waterfront-landmarks', 'waterfront-music-garden', 'waterfront-harbourfront', 'waterfront-main-building', 'waterfront-concert-stage', 'waterfront-ferries', 'waterfront-island-arrivals-data', 'waterfront-island-arrivals', 'waterfront-sherbourne', 'waterfront-bathurst', 'waterfront-beach-landscape', 'waterfront-hto-landscape', 'waterfront-hto-firehall', 'waterfront-island-access-data', 'waterfront-island-access', 'waterfront-island-buildings-data', 'waterfront-island-buildings']) {
    vm.runInContext(fs.readFileSync(new URL('../js/' + name + '.js', import.meta.url), 'utf8'), ctx, { filename: name });
  }
  const C = ctx.window.CITY;
  assert.ok(C.GEO.buildings.filter((b, i) => C.islandBuildingProfile(b, i)).length > 200, 'source-matched island profiles available in real frame');
  C.applyWaterfrontDeckGroundMask(new THREE.MeshStandardNodeMaterial());
  let islandMaskTexture = null;
  class ObservedDataTexture extends THREE.DataTexture {
    constructor(...args) { super(...args); islandMaskTexture = this; }
  }
  const islandLawnMaterial = new THREE.MeshStandardNodeMaterial();
  C.applyWaterfrontIslandAccessGroundMask(islandLawnMaterial, { ...THREE, DataTexture: ObservedDataTexture });
  assert.ok(islandLawnMaterial.maskNode, 'island lawn mask is installed before the runtime builder');
  assert.ok(islandMaskTexture?.image.data.some(v => v > 127),
    'normalized unsigned-byte mask contains pixels above the shader discard threshold');
  const scene = new THREE.Scene();
  for (const name of ['Details', 'BeachGround', 'PublicRealm', 'Landmarks', 'MusicGarden', 'Harbourfront', 'MainBuilding', 'ConcertStage', 'Ferries', 'IslandArrivals', 'Sherbourne', 'Bathurst', 'BeachLandscape', 'HtoLandscape', 'HtoFirehall', 'IslandAccess']) {
    const result = C['createWaterfront' + name](THREE, scene);
    assert.ok(result?.group, name + ' must build in the shipped ' + frame + ' frame');
    let meshCount = 0;
    result.group.traverse(o => {
      if (!o.isMesh) return;
      meshCount++;
      assert.ok(o.geometry?.attributes?.position, name + ': geometry contract');
      assert.ok(o.geometry.attributes.position.array.every(Number.isFinite), name + ': finite geometry in ' + o.name);
      if (o.isInstancedMesh) assert.ok(o.instanceMatrix.array.every(Number.isFinite), name + ': finite transforms in ' + o.name);
    });
    assert.ok(meshCount > 0, name + ' must render geometry');
  }
  for (const feature of C.waterfrontBeachLandscape.layout.features.filter(f => f.kind === 'mound' && f.built !== false)) {
    const h = C.waterfrontBeachLandscapeHeightAt(feature.x, feature.z);
    assert.ok(Number.isFinite(h), feature.id + ': rendered mound has footing');
    assert.equal(C.deckHeightAt(feature.x, feature.z, h), h, feature.id + ': integrated mound footing');
  }
  const sugarFurniture = C.waterfrontDetails.layout.sites.find(s => s.id === 'sugarBeach');
  assert.equal(sugarFurniture.chairs.length, 150, 'landscape keepouts retain the sourced chair count');
  assert.equal(sugarFurniture.umbrellas.length, 36, 'landscape keepouts retain the sourced umbrella count');
  for (const chair of sugarFurniture.chairs) {
    assert.equal(C.waterfrontBeachLandscapeKeepoutAt(chair.x, chair.z, 0.62), false,
      'chairs remain clear of the newly rendered rock and fountain footprints');
  }
  assert.equal(C.waterfrontLandmarks.stats.landmarks.length, 2);
  assert.equal(C.waterfrontFerries.stats.terminalBoxes, 3);
  const terrace = C.waterfrontMusicGarden.surfaces.find(s => !s.disc && s.topY > 0.2);
  assert.ok(terrace, 'the garden exposes its rendered raised terraces');
  const surface = C.waterfrontMusicGardenSurfaceAt(terrace.cx, terrace.cz);
  assert.ok(surface?.h >= terrace.topY);
  assert.equal(C.deckHeightAt(terrace.cx, terrace.cz, surface.h), surface.h);
  assert.equal(C.deckStoodOn(terrace.cx, terrace.cz, surface.h).deck.pedestrianOnly, true);
  C.waterfrontMusicGardenEnabled = false;
  assert.equal(C.waterfrontMusicGardenSurfaceAt(terrace.cx, terrace.cz), null);
  for (const dock of Object.values(C.waterfrontIslandArrivals.layout.docks)) {
    const [x, z] = dock.deckAnchor;
    const arrival = C.islandArrivalSurfaceAt(x, z);
    assert.ok(arrival, dock.id + ': mapped arrival has a rendered surface');
    assert.equal(C.deckHeightAt(x, z, arrival.h), arrival.h, dock.id + ': integrated ground height');
    assert.equal(C.deckStoodOn(x, z, arrival.h).deck.pedestrianOnly, true);
  }
  C.waterfrontIslandArrivalsEnabled = false;
  const anchor = C.waterfrontIslandArrivals.layout.docks.centre.deckAnchor;
  assert.equal(C.islandArrivalSurfaceAt(...anchor), null, 'disabled arrival cannot create invisible footing');
  const rows = C.waterfrontLandmarkExcludedRows;
  assert.ok(rows.size > 0);
  for (const row of rows) {
    const b = C.GEO.buildings[row];
    assert.ok(b && b[0] > -300 && b[0] < 900 && b[1] > 400 && b[1] < 800,
      'replacement must not suppress an unrelated building at row ' + row);
  }
});
