// The waterfront beaches' source-backed detail (js/waterfront-details.js): Sugar Beach's 36 pink umbrellas and 150
// white chairs, HTO Park's 38 yellow umbrellas (108-inch perforated aluminium) and multicolour rounded-slat chairs.
// Placement is clipped to the verified OSM sand polygons, the module no-ops when the active GEO frame does not include
// them, and the embedded park-ring fallback is only available through an explicit fixtures opt-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function city({ withGeo = true, geodata } = {}) {
  const ctx = { window: { CITY: { THREE, Addons: { mergeGeometries }, CITY_BOUNDS: { sidewalkHeight: 0.22 } } }, console, performance };
  if (withGeo) vm.runInNewContext(geodata ? read(geodata) : read('js/toronto-geodata.js'), ctx);
  vm.runInNewContext(read('js/waterfront-details.js'), ctx);
  return ctx.window.CITY;
}

const inRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const distRing = (ring, x, z) => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
};
const distSeg = (x, z, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
};
const nearestTree = (trees, x, z) => {
  let best = Infinity;
  for (let i = 0; i + 3 < trees.length; i += 4) best = Math.min(best, Math.hypot(trees[i] - x, trees[i + 1] - z));
  return best;
};

test('nothing is built on load, and the sand rings are the verified OSM beach polygons', () => {
  const C = city();
  assert.equal(typeof C.createWaterfrontDetails, 'function');
  assert.equal(C.waterfrontDetails, undefined);
  assert.deepEqual(C.WATERFRONT_SAND_RINGS.sugarBeach, C.WATERFRONT_SITE_SPECS[0].sandRing);
  assert.deepEqual(C.WATERFRONT_SAND_RINGS.htoPark, C.WATERFRONT_SITE_SPECS[1].sandRing);
  assert.equal(C.WATERFRONT_SITE_SPECS[0].sandSource.includes('172728993'), true);
  assert.equal(C.WATERFRONT_SITE_SPECS[1].sandSource.includes('189306980'), true);
});

test('published counts fit the real sand polygons', () => {
  const C = city();
  const layout = C.waterfrontLayout();
  const sugar = layout.sites.find((s) => s.id === 'sugarBeach');
  const hto = layout.sites.find((s) => s.id === 'htoPark');
  assert.equal(sugar.counts.umbrellas, 36); assert.equal(sugar.counts.chairs, 150);
  assert.equal(hto.counts.umbrellas, 38); assert.equal(hto.counts.chairs, 76);
  assert.equal(layout.counts.umbrellas, 74); assert.equal(layout.counts.chairs, 226);
});

test('every umbrella and chair centre and clearance footprint is inside the sand, not the park', () => {
  const C = city();
  for (const site of C.waterfrontLayout().sites) {
    const spec = C.WATERFRONT_SITE_SPECS.find((s) => s.id === site.id);
    const umbrellaMargin = spec.canopyRadius + spec.edgeMargin;
    for (const u of site.umbrellas) {
      assert.ok(inRing(site.sandRing, u.x, u.z), `${site.id} umbrella centre on sand`);
      assert.ok(distRing(site.sandRing, u.x, u.z) >= umbrellaMargin - 1e-9, `${site.id} umbrella canopy footprint on sand`);
    }
    for (const c of site.chairs) {
      assert.ok(inRing(site.sandRing, c.x, c.z), `${site.id} chair centre on sand`);
      assert.ok(distRing(site.sandRing, c.x, c.z) >= 0.62 - 1e-9, `${site.id} chair footprint on sand`);
    }
    for (let i = 0; i < site.chairs.length; i++) {
      for (let j = i + 1; j < site.chairs.length; j++) {
        assert.ok(Math.hypot(site.chairs[i].x - site.chairs[j].x, site.chairs[i].z - site.chairs[j].z) >= 0.99, `${site.id} chair spacing`);
      }
    }
  }
});

test('chairs face the water; mapped trees and the real nested parkSign schema are respected', () => {
  const C = city();
  const layout = C.waterfrontLayout();
  for (const site of layout.sites) {
    for (const c of site.chairs) {
      const dot = Math.sin(c.yaw) * site.water[0] + Math.cos(c.yaw) * site.water[1];
      assert.ok(dot > 0.9, `${site.id} chair faces water`);
    }
    for (const u of site.umbrellas) assert.ok(nearestTree(C.GEO.streetTrees, u.x, u.z) >= 0.9, `${site.id} umbrella clear of trees`);
    for (const c of site.chairs) assert.ok(nearestTree(C.GEO.streetTrees, c.x, c.z) >= 0.7, `${site.id} chair clear of trees`);
  }
  // the committed parkSign layer is nested [x, z, angle, name, number, street], not a flat pair list
  assert.ok(Array.isArray(C.GEO.props.parkSign[0]) && C.GEO.props.parkSign[0].length >= 6);
  const nested = C.waterfrontLayout({ props: { ...C.GEO.props, parkSign: [[940, 520, 0, 'Test Park', '1', 'Test Street']] } });
  for (const site of nested.sites) {
    for (const u of [...site.umbrellas, ...site.chairs]) assert.ok(Math.hypot(u.x - 940, u.z - 520) > 1.0, 'clears the nested sign');
  }
});

test('a synthetic promenade path and shrub patch keep the furniture off them; counts can reduce, never pad grass', () => {
  const C = city();
  const base = { areas: C.GEO.areas, trees: C.GEO.streetTrees, props: C.GEO.props, frame: C.GEO.frame, cycling: C.GEO.cycling };
  const crossed = C.waterfrontLayout({ ...base, parkPaths: [[3, 900, 520, 1000, 520]] });
  assert.ok(crossed.sites[0].counts.umbrellas <= 36, 'path can reduce the Sugar Beach count');
  for (const site of crossed.sites) {
    for (const u of site.umbrellas) assert.ok(distSeg(u.x, u.z, 900, 520, 1000, 520) >= 2.3, 'umbrella clear of the path');
    for (const c of site.chairs) assert.ok(distSeg(c.x, c.z, 900, 520, 1000, 520) >= 2.1, 'chair clear of the path');
  }
  const shrubs = C.waterfrontLayout({ ...base, shrubs: [{ x: 940, z: 520, r: 3 }] });
  for (const site of shrubs.sites) for (const p of [...site.umbrellas, ...site.chairs]) assert.ok(Math.hypot(p.x - 940, p.z - 520) >= 3.3, 'clear of the shrub');
});

test('an unsupported frame or missing areas yields nothing at runtime; fixtures are explicit opt-in only', () => {
  const C = city();
  const bad = C.waterfrontLayout({ frame: { detail: { x0: 0, x1: 1, z0: 0, z1: 1 } } });
  assert.equal(bad.counts.umbrellas + bad.counts.chairs, 0);
  assert.equal(bad.sites.length, 0);
  assert.equal(bad.skipped.length, 2);
  const missing = C.waterfrontLayout({ areas: [], frame: null });
  assert.equal(missing.counts.umbrellas + missing.counts.chairs, 0);
  const fixture = C.waterfrontLayout({ areas: [], trees: [], props: {}, parkPaths: [], cycling: null, frame: null, fixtures: true });
  assert.equal(fixture.counts.umbrellas, 74);
  assert.equal(fixture.counts.chairs, 226);
  // the builder itself is a no-op in a map with no matching areas
  const C2 = city();
  C2.GEO.areas = [];
  const out = C2.createWaterfrontDetails(THREE, new THREE.Scene());
  assert.equal(out.group.children.length, 0);
  assert.equal(out.colliders.length, 0);
  assert.equal(out.layout.sites.length, 0);
});

test('the built scene is six instanced meshes, anchored on the park lawn, with culling metadata and colliders', () => {
  const C = city();
  const scene = new THREE.Scene();
  const out = C.createWaterfrontDetails(THREE, scene);
  assert.equal(scene.children.filter((o) => o === out.group).length, 1);
  assert.deepEqual(out.group.children.map((m) => m.name), [
    'WaterfrontDetails_sugarBeach_UmbrellaPoles', 'WaterfrontDetails_sugarBeach_UmbrellaCanopies',
    'WaterfrontDetails_htoPark_UmbrellaPoles', 'WaterfrontDetails_htoPark_UmbrellaCanopies',
    'WaterfrontDetails_sugarBeach_Chairs', 'WaterfrontDetails_htoPark_Chairs'
  ]);
  assert.deepEqual(out.group.children.map((m) => m.count), [36, 36, 38, 38, 150, 76]);
  for (const m of out.group.children) {
    assert.ok(m.isInstancedMesh && m.userData.cullDistance > 0 && m.userData.cullCell > 0);
    assert.ok(m.boundingSphere && Number.isFinite(m.boundingSphere.radius));
    for (let i = 0; i < m.count; i++) assert.ok(Math.abs(m.instanceMatrix.array[i * 16 + 13] - 0.224) < 1e-6, `${m.name} on the lawn`);
  }
  assert.equal(out.colliders.length, 74 + 226);
  assert.ok(out.colliders.every((c) => c.prop && c.maxY > c.minY));
});

test('HTO uses the 108-inch (2.7432 m) canopy, rounded vertical chair slats and multicolour chairs; Sugar stays pink/white', () => {
  const C = city();
  const out = C.createWaterfrontDetails(THREE, new THREE.Scene());
  const byName = new Map(out.group.children.map((m) => [m.name, m]));
  byName.get('WaterfrontDetails_htoPark_UmbrellaCanopies').geometry.computeBoundingBox();
  const bb = byName.get('WaterfrontDetails_htoPark_UmbrellaCanopies').geometry.boundingBox;
  assert.ok(Math.abs((bb.max.x - bb.min.x) - 2.7432) < 0.02, `HTO canopy diameter ${(bb.max.x - bb.min.x).toFixed(3)} m`);
  assert.equal(C.WATERFRONT_SITE_SPECS[1].poleRadius, 0.0381);
  const sugarChair = byName.get('WaterfrontDetails_sugarBeach_Chairs');
  const htoChair = byName.get('WaterfrontDetails_htoPark_Chairs');
  assert.notEqual(sugarChair.geometry, htoChair.geometry);
  assert.ok(htoChair.geometry.attributes.position.count > sugarChair.geometry.attributes.position.count, 'rounded vertical slats add geometry');
  const htoColours = new Set();
  for (let i = 0; i < htoChair.count; i++) htoColours.add(htoChair.instanceColor.array.slice(i * 3, i * 3 + 3).join(','));
  assert.equal(htoColours.size, 4, 'HTO chairs are red/yellow/blue/green, not blanket yellow');
  const sugar = byName.get('WaterfrontDetails_sugarBeach_UmbrellaCanopies').instanceColor.array;
  assert.ok(sugar[0] > sugar[1] && sugar[0] > sugar[2], 'Sugar canopies pink');
  const hto = byName.get('WaterfrontDetails_htoPark_UmbrellaCanopies').instanceColor.array;
  assert.ok(hto[0] > 0.5 && hto[1] > 0.3 && hto[2] < 0.1, 'HTO canopies yellow');
  const sc = byName.get('WaterfrontDetails_sugarBeach_Chairs').instanceColor.array;
  assert.ok(sc[0] >= sc[1] && sc[1] >= sc[2] && sc[0] - sc[2] < 0.15, 'Sugar chairs warm white');
});
