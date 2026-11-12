// Biidaasige source-located lighting, wayfinding and bollards (js/biidaasige-lighting.js, bead st-bmyv.10). Focused CPU
// checks that load the ACTUAL module into a small CITY and prove, from the REAL built THREE geometry and the committed
// park polygon:
//
//   1. The factories are pure, finite, base on y=0, and match the recorded photo estimates (the distinctive timber
//      luminaire: ~5.5 m post, ~.14 m diameter, ~.7 m arm, ~.3 m of timber above the arm; a blank guidepost; a bollard).
//   2. The luminaire's head is EMISSIVE and there is NO point light anywhere (no per-pole light).
//   3. Merged geometry is bounded: <5 material parts per pole factory, one InstancedMesh per material per kind.
//   4. The layout adapter places ONLY the 3 mapped guideposts inside the park polygon, projects through
//      worldFromLatLon, and gives each a small radius-only pole collider (never a path-blocking box).
//   5. No lamp and no bollard is placed: 0 mapped inside the park; the 47 lamps and 1 bollard the bbox query returns
//      are OUTSIDE and are never repurposed. The factories remain exported.
//   6. renderedSites spatial dedupe skips a same-kind site within 1.5 m and keeps a different kind / a far site.
//   7. Degrades honestly: missing park data or projection builds nothing (and returns null without THREE).
//   8. The checked-in fixture is the provenance: ODbL, a timestamp, the 3 in-park guideposts, 0 in-park lamps/bollards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PROJ = (() => {
  const ctx = { window: { CITY: {} } };
  vm.runInNewContext(read('js/toronto-geodata.js'), ctx);
  return ctx.window.CITY.GEO.frame.projection;
})();
function worldFromLatLon(lat, lon) {
  const e = (lon - PROJ.lon0) * PROJ.kx, n = (lat - PROJ.lat0) * PROJ.ky;
  const c = Math.cos(PROJ.theta), s = Math.sin(PROJ.theta);
  return { x: e * c - n * s - PROJ.ox, z: -(e * s + n * c) - PROJ.oz };
}

function city({ park = true, lighting = true, projection = true } = {}) {
  const CITY = { THREE, Addons: { mergeGeometries }, CITY_BOUNDS: { sidewalkHeight: 0.22 }, worldFromLatLon };
  if (!projection) delete CITY.worldFromLatLon;
  const ctx = { window: { CITY }, console: { info() {}, warn() {}, log() {}, error() {} } };
  if (park) vm.runInNewContext(read('js/biidaasige-park-data.js'), ctx);
  if (lighting) vm.runInNewContext(read('js/biidaasige-lighting.js'), ctx);
  return CITY;
}

const S = (C) => C.BIIDAASIGE_LIGHTING_SIZES;
const F = (C) => C.biidaasigeLightingFactories;

function measure(group) {
  const box = new THREE.Box3();
  group.updateWorldMatrix(true, true);
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  return { box, size, center };
}
function assertFinite(group, label) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) assert.ok(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)), `${label}: finite vertex ${i}`);
  });
}
function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

test('factories: pure, finite, base on y=0, sizes match the recorded photo estimates', () => {
  const C = city();
  const f = F(C), size = S(C);
  const cases = [
    ['buildTimberLuminaire', { h: size.luminaire.postH, postDia: size.luminaire.postDia }],
    ['buildWayfindingGuidepost', { h: size.guidepost.postH }],
    ['buildBollard', { h: size.bollard.h }]
  ];
  for (const [name, want] of cases) {
    const g = f[name](THREE);
    assert.ok(g && g.isGroup, `${name} returns a Group`);
    assertFinite(g, name);
    const { box, size: dim } = measure(g);
    assert.ok(Math.abs(box.min.y) < 0.02, `${name}: base at y=0 (${box.min.y.toFixed(3)})`);
    assert.ok(Math.abs(dim.y - want.h) < 0.12, `${name}: height ${dim.y.toFixed(2)} vs ${want.h}`);
  }
  // The luminaire's post is slim and round, the arm is ~.7 m, and the timber continues ~.3 m above the arm.
  const lum = f.buildTimberLuminaire(THREE);
  const post = lum.children.find((o) => o.isMesh && o.geometry.type === 'CylinderGeometry');
  assert.ok(post, 'luminaire has a cylindrical post');
  post.geometry.computeBoundingBox();
  const pb = post.geometry.boundingBox;
  assert.ok(Math.abs((pb.max.x - pb.min.x) - size.luminaire.postDia) < 0.02, `post diameter ${(pb.max.x - pb.min.x).toFixed(3)} vs ${size.luminaire.postDia}`);
  assert.ok(Math.abs(pb.max.y - size.luminaire.postH) < 0.02, 'post top at the recorded height');
  assert.ok(Math.abs((size.luminaire.postH - size.luminaire.armY) - size.luminaire.topAboveArm) < 0.02, 'timber continues .3 m above the arm');
  const lm = measure(lum);
  assert.ok(lm.size.z > size.luminaire.armLen, 'the arm overhangs the post (+z)');
});

test('the luminaire head is emissive and there is NO point light (no per-pole light)', () => {
  const C = city();
  const lum = F(C).buildTimberLuminaire(THREE);
  let emissive = 0, pointLights = 0;
  lum.traverse((o) => {
    if (o.isPointLight || o.isSpotLight || o.isDirectionalLight) pointLights++;
    if (o.isMesh && o.material && o.material.emissive) {
      const e = o.material.emissive;
      if ((e.r || 0) + (e.g || 0) + (e.b || 0) > 0.01) emissive++;
    }
  });
  assert.equal(pointLights, 0, 'no light object is added per pole');
  assert.ok(emissive >= 1, 'the head has an emissive material for night');
});

test('merged geometry is bounded: <5 material parts per pole factory, one InstancedMesh per material per kind', () => {
  const C = city();
  const f = F(C);
  for (const [name, factory] of [
    ['luminaire', () => f.buildTimberLuminaire(THREE)],
    ['guidepost', () => f.buildWayfindingGuidepost(THREE)],
    ['bollard', () => f.buildBollard(THREE)]
  ]) {
    const parts = f.flatten(THREE, factory);
    assert.ok(parts.length > 0 && parts.length < 5, `${name}: ${parts.length} material parts (<5)`);
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      const tris = p.geometry.index ? p.geometry.index.count / 3 : p.geometry.attributes.position.count / 3;
      assert.ok(Number.isFinite(tris) && tris > 0, `${name}: each part has real geometry`);
    }
  }
  const out = C.buildBiidaasigeLighting(new THREE.Scene(), []);
  for (const [kind, n] of Object.entries(out.stats.materials)) assert.ok(n < 5, `${kind}: ${n} material parts (bounded)`);
  for (const mesh of out.group.children) {
    if (!mesh.isInstancedMesh) continue;
    assert.ok(mesh.userData.cullCell === 60, 'bounded 60 m cull cell');
    assert.ok(mesh.userData.cullDistance > 0, 'bounded cull distance');
  }
});

test('layout: places ONLY the 3 mapped guideposts inside the park, each with a radius-only pole collider', () => {
  const C = city();
  const out = C.buildBiidaasigeLighting(new THREE.Scene(), []);
  assert.ok(out && out.stats.projected, 'projects through window.worldFromLatLon');
  assert.equal(out.stats.counts.wayfinding, 3, 'the 3 mapped guideposts are placed');
  assert.equal(out.stats.counts.streetLamp || 0, 0, 'no lamp is placed');
  assert.equal(out.stats.counts.bollard || 0, 0, 'no bollard is placed');
  assert.equal(out.colliders.length, 3, 'one collider per placed guidepost');
  // Every placed instance lands inside its own small circle collider, and the collider is a pole, not a path block.
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  for (const mesh of out.group.children) {
    if (!mesh.isInstancedMesh) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      const c = out.colliders.find((c) => c.circle && Math.hypot(c.circle.x - p.x, c.circle.z - p.z) < 0.01);
      assert.ok(c, `instance ${i} has a circle collider at its base`);
      assert.ok(c.circle.r <= 0.12, `collider radius ${c.circle.r} is a pole, not a path block`);
      assert.ok(c.prop === true, 'a prop collider');
    }
  }
  // Every source site is inside the committed park polygon (the same test the fixture build uses).
  const poly = C.BIIDAASIGE_PARK.park.polygon;
  for (const s of out.sourceSites) assert.ok(pointInRing(s.lat, s.lon, poly), `${s.id} is inside the park polygon`);
});

test('no invented lamps or bollards: the 47 lamps and 1 bollard are OUTSIDE the park and never repurposed', () => {
  const C = city();
  const out = C.buildBiidaasigeLighting(new THREE.Scene(), []);
  assert.ok(out.stats.unplaced.some((u) => /streetLamps/.test(u)), 'lamps are recorded unplaced');
  assert.ok(out.stats.unplaced.some((u) => /bollards/.test(u)), 'bollards are recorded unplaced');
  assert.equal(out.stats.source.lampsInside, 0, '0 mapped lamps inside the park');
  assert.equal(out.stats.source.bollardsInside, 0, '0 mapped bollards inside the park');
  assert.equal(out.stats.source.lampsOutside, 47, 'the 47 bbox lamps are context, outside the park');
  assert.equal(out.stats.source.bollardsOutside, 1, 'the 1 bbox bollard is context, outside the park');
  // The factories still exist and are usable even though nothing is placed.
  assert.equal(typeof F(C).buildTimberLuminaire, 'function');
  assert.equal(typeof F(C).buildBollard, 'function');
  assert.ok(!out.group.children.some((o) => /streetLamp|bollard/.test(o.name)), 'no lamp/bollard instance is built');
});

test('renderedSites spatial dedupe: a same-kind site within 1.5 m is skipped, a different kind / a far site is kept', () => {
  const C = city();
  const full = C.buildBiidaasigeLighting(new THREE.Scene(), []);
  const site = full.sourceSites[0];
  const dup = C.buildBiidaasigeLighting(new THREE.Scene(), [], { renderedSites: [{ x: site.x, z: site.z, kind: 'wayfinding' }] });
  assert.equal(dup.stats.counts.wayfinding, 2, 'a rendered same-kind guidepost removes one');
  const otherKind = C.buildBiidaasigeLighting(new THREE.Scene(), [], { renderedSites: [{ x: site.x, z: site.z, kind: 'streetLamp' }] });
  assert.equal(otherKind.stats.counts.wayfinding, 3, 'a different kind does not dedupe the guidepost');
  const far = C.buildBiidaasigeLighting(new THREE.Scene(), [], { renderedSites: [{ x: site.x + 3, z: site.z, kind: 'wayfinding' }] });
  assert.equal(far.stats.counts.wayfinding, 3, 'a guidepost 3 m away is not deduped');
  assert.equal(C.BIIDAASIGE_LIGHTING_DEDUPE_RADIUS, 1.5);
  const dd = C.biidaasigeLightingDedupe({ sourceSites: full.sourceSites, renderedSites: [{ x: site.x, z: site.z, kind: 'wayfinding' }] });
  assert.equal(dd.kept.length, 2, 'dedupe() filters the rendered site');
});

test('extraSites: the parent can register a further image point later without editing the module', () => {
  const C = city();
  const centroid = C.BIIDAASIGE_PARK.park.centroid;
  const out = C.buildBiidaasigeLighting(new THREE.Scene(), [], {
    extraSites: [{ id: 'captain-image-lamp-1', kind: 'streetLamp', lat: centroid[0], lon: centroid[1], placement: 'captain-image', positionConfidence: 'interpreted' }]
  });
  assert.equal(out.stats.counts.streetLamp, 1, 'the caller-registered lamp is placed');
  assert.equal(out.stats.counts.wayfinding, 3, 'the embedded guideposts are still placed');
  assert.ok(out.sourceSites.some((s) => s.id === 'captain-image-lamp-1'), 'the extra site is exposed with its id');
  // An extra site outside the park polygon is refused, never placed.
  const outside = C.buildBiidaasigeLighting(new THREE.Scene(), [], {
    extraSites: [{ id: 'outside-lamp', kind: 'streetLamp', lat: 43.6421, lon: -79.3589 }]
  });
  assert.equal(outside.stats.counts.streetLamp || 0, 0, 'an outside extra site is not placed');
  assert.ok(outside.stats.skipped.some((s) => s.id === 'outside-lamp'), 'the outside extra site is reported skipped');
});

test('degrades honestly: missing park data or projection builds nothing; no THREE returns null', () => {
  const noPark = city({ park: false });
  const a = noPark.buildBiidaasigeLighting(null, null);
  assert.ok(a && a.group && Array.isArray(a.colliders));
  assert.equal(a.stats.projected, false);
  assert.match(a.stats.reason, /BIIDAASIGE_PARK/);
  assert.equal(a.colliders.length, 0);

  const noProj = city({ projection: false });
  const b = noProj.buildBiidaasigeLighting(null, null);
  assert.equal(b.stats.projected, false);
  assert.match(b.stats.reason, /projection/);
  assert.equal(b.colliders.length, 0);

  const noThree = city();
  delete noThree.THREE;
  assert.equal(noThree.buildBiidaasigeLighting(null, null), null);
});

test('fixture provenance: ODbL, a timestamp, the 3 in-park guideposts, 0 in-park lamps/bollards', () => {
  const fixture = JSON.parse(read('tools/fixtures/biidaasige-lighting.json'));
  assert.equal(fixture.license, 'ODbL-1.0');
  assert.ok(fixture.osmBaseTimestamp, 'records the OSM base timestamp');
  assert.ok(fixture.attribution.includes('OpenStreetMap'), 'records the attribution');
  assert.equal(fixture.sourceSites.length, 3, '3 mapped guideposts inside the park');
  assert.ok(fixture.sourceSites.every((s) => s.kind === 'wayfinding'), 'all in-park sites are wayfinding');
  assert.equal(fixture.unplaced.streetLamps, 0, '0 mapped lamps inside the park');
  assert.equal(fixture.unplaced.bollards, 0, '0 mapped bollards inside the park');
  assert.equal(fixture.context.streetLampsOutside, 47, '47 lamps outside the park');
  assert.equal(fixture.context.bollardsOutside, 1, '1 bollard outside the park');
  // The fixture's classification agrees with the committed park polygon.
  const C = city();
  const poly = C.BIIDAASIGE_PARK.park.polygon;
  for (const e of fixture.elements) {
    if (e.type !== 'node') continue;
    assert.equal(e.inPark, pointInRing(e.lat, e.lon, poly), `fixture inPark matches the polygon for ${e.id}`);
  }
});
