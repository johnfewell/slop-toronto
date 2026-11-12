// Canada's Sugar Beach landscape (js/waterfront-beach-landscape.js): the two source-positioned candy-striped bedrock
// outcrops, the current-supported grass mounds, the maple-leaf fountain, the source plaza apron and its ground mask.
// Positions are checked against the real committed GEO anchors; rendered surfaces are checked with a real Three
// Raycaster (not a re-implementation of the sampler equation).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { unpackGeo } from '../js/geodata-loader.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function city({ geodata = 'js/toronto-geodata.js' } = {}) {
  const ctx = {
    window: { CITY: { THREE, TSL, CITY_BOUNDS: { sidewalkHeight: 0.22 } } },
    console: { info() {}, log() {}, warn() {} }, performance, URLSearchParams, Buffer,
    atob: (s) => Buffer.from(s, 'base64').toString('binary')
  };
  if (geodata) vm.runInNewContext(read(geodata), ctx);
  vm.runInNewContext(read('js/waterfront-details.js'), ctx);
  vm.runInNewContext(read('js/waterfront-beach-landscape.js'), ctx);
  return ctx.window.CITY;
}
const pointInRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const distanceToRing = (ring, x, z) => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
};
const byId = (layout) => Object.fromEntries(layout.features.map((f) => [f.id, f]));

const C = city();
const LAYOUT = C.waterfrontBeachLandscapeLayout();
const F = byId(LAYOUT);

test('source features: two outcrops, two current-supported mounds (of three historical), one fountain', () => {
  assert.equal(LAYOUT.site.id, 'sugarBeach');
  assert.equal(LAYOUT.features.filter((f) => f.kind === 'outcrop').length, 2);
  assert.equal(LAYOUT.features.filter((f) => f.kind === 'mound' && f.built).length, 2);
  assert.equal(LAYOUT.features.filter((f) => f.kind === 'mound').length, 3);
  assert.equal(LAYOUT.features.filter((f) => f.kind === 'splash').length, 1);
  // the historical north mound is source-proven but its plan point is now the mapped Waterfront Innovation Centre
  assert.equal(F.northMound.built, false);
  assert.equal(F.northMound.blockedReason, 'building');
  const skip = LAYOUT.skipped.find((s) => s.id === 'northMound');
  assert.ok(skip && /Waterfront Innovation Centre/.test(skip.reason), skip && skip.reason);
  assert.ok(/2 are current-supported/.test(skip.reason));
  // HTO is delegated elsewhere and the existing mapped boardwalk is not duplicated
  assert.ok(LAYOUT.skipped.some((s) => s.id === 'htoPark' && /waterfront-hto-landscape/.test(s.reason)));
  assert.ok(LAYOUT.skipped.some((s) => s.id === 'sugarBoardwalk'));
});

test('georeference uses the real mapped park and Corus footprint (not hardcoded world positions)', () => {
  const g = LAYOUT.georeference;
  const ring = LAYOUT.site.parkRing;
  // the anchors are the park's min-x (top of the west seawall) and max-z (SW seawall) vertices
  const north = ring.reduce((a, b) => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? a : b));
  const sw = ring.reduce((a, b) => (a[1] > b[1] || (a[1] === b[1] && a[0] > b[0]) ? a : b));
  assert.deepEqual(g.anchors.north, north.slice());
  assert.deepEqual(g.anchors.sw, sw.slice());
  // the Corus anchor is the real westmost footprint corner of the named Corus Quay building row
  const corus = C.GEO.buildings.find((row) => row[9] === 'Corus Quay');
  assert.ok(corus);
  assert.ok(Math.abs(g.anchors.corus[0] - 980.6) < 0.6, `corus westmost x ${g.anchors.corus[0]}`);
  assert.ok(Math.abs(g.anchors.corus[1] - 473.3) < 0.6, `corus westmost z ${g.anchors.corus[1]}`);
  assert.match(g.note, /not to scale/i);
});

test('fitted positions: beach rock in the real sand notch; fountain at the beach/promenade boundary', () => {
  // These are estimates from the not-to-scale plan, validated against mapped features, not survey coordinates.
  const near = (f, x, z, tol = 2.5) => Math.hypot(f.x - x, f.z - z) <= tol;
  assert.ok(near(F.beachOutcrop, 934.0, 504.4), `${F.beachOutcrop.x},${F.beachOutcrop.z}`);
  assert.ok(near(F.plazaOutcrop, 967.8, 516.6), `${F.plazaOutcrop.x},${F.plazaOutcrop.z}`);
  assert.ok(near(F.middleMound, 956.4, 480.0), `${F.middleMound.x},${F.middleMound.z}`);
  assert.ok(near(F.southMound, 962.3, 498.4), `${F.southMound.x},${F.southMound.z}`);
  assert.ok(near(F.splashPad, 964.0, 555.8), `${F.splashPad.x},${F.splashPad.z}`);
  // the beach rock sits in the notch the sand polygon is carved around (not on open sand)
  assert.equal(pointInRing(LAYOUT.site.sandRing, F.beachOutcrop.x, F.beachOutcrop.z), false);
  assert.ok(distanceToRing(LAYOUT.site.sandRing, F.beachOutcrop.x, F.beachOutcrop.z) < 2.5);
  // the fountain is just outside / on the sand boundary, at the south promenade edge, far from the rocks
  assert.ok(LAYOUT.checks.fountainDistanceToSand < 4, `fountain-sand ${LAYOUT.checks.fountainDistanceToSand}`);
  assert.ok(LAYOUT.checks.rocksToFountain > 40, `rock-fountain ${LAYOUT.checks.rocksToFountain}`);
});

test('pre-build furniture keepout uses the exact outcrop and leaf footprints', () => {
  // callable before createWaterfrontBeachLandscape (scripts loaded, builder not run)
  assert.equal(C.waterfrontBeachLandscapeEnabled, undefined);
  assert.equal(C.waterfrontBeachLandscapeKeepoutAt(F.beachOutcrop.x, F.beachOutcrop.z, 0.4), true);
  assert.equal(C.waterfrontBeachLandscapeKeepoutAt(F.plazaOutcrop.x, F.plazaOutcrop.z, 0.4), true);
  assert.equal(C.waterfrontBeachLandscapeKeepoutAt(F.splashPad.x, F.splashPad.z, 0.4), true);
  assert.equal(C.waterfrontBeachLandscapeKeepoutAt(0, 0, 0.4), false);
  // the outcrop footprint is a rotated ellipse-ish ring, not just a centre point
  const edge = F.beachOutcrop.x + (F.beachOutcrop.length / 2) * Math.cos(F.beachOutcrop.yaw) * 0.7;
  const edgeZ = F.beachOutcrop.z - (F.beachOutcrop.length / 2) * Math.sin(F.beachOutcrop.yaw) * 0.7;
  assert.equal(C.waterfrontBeachLandscapeKeepoutAt(edge, edgeZ, 0), true);
});

test('the built group is finite instanced geometry with no duplicated boardwalk or HTO work', () => {
  const scene = { added: [], add(o) { this.added.push(o); } };
  const r = C.createWaterfrontBeachLandscape(THREE, scene);
  assert.ok(r, 'builds in the detail frame');
  assert.equal(scene.added.length, 1);
  assert.equal(r.group.name, 'WaterfrontBeachLandscape');
  assert.equal(r.stats.rocks, 2);
  assert.equal(r.stats.mounds, 2);
  assert.equal(r.stats.moundsHistorical, 3);
  assert.equal(r.stats.colliders, 2);
  const names = r.group.children.map((c) => c.name);
  assert.ok(names.includes('WaterfrontBeachLandscape-PlazaApron'));
  assert.equal(names.filter((n) => /Mounds/.test(n)).length, 1);
  assert.equal(names.filter((n) => /Rocks/.test(n)).length, 1);
  assert.equal(names.filter((n) => /boardwalk|HTO/i.test(n)).length, 0);
  // the mound draw has exactly the two current-supported instances; no per-stone object explosion
  const mounds = r.group.children.find((c) => c.name === 'WaterfrontBeachLandscape-Mounds');
  assert.ok(mounds.isInstancedMesh);
  assert.equal(mounds.count, 2);
  assert.ok(r.stats.meshes <= 12, `${r.stats.meshes} meshes`);
  assert.ok(r.stats.instances < 40, `${r.stats.instances} instances`);
  assert.ok(r.stats.triangles > 500 && r.stats.triangles < 12000, `${r.stats.triangles} triangles`);
});

test('height sampler matches the actual rendered triangles (real Three raycast) and is disabled off-build', () => {
  const r = C.waterfrontBeachLandscape;
  r.group.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const rayHeight = (x, z) => {
    raycaster.set(new THREE.Vector3(x, 40, z), down);
    const hits = raycaster.intersectObjects(r.group.children, true);
    const hit = hits.find((h) => /Mounds|MapleLeaf/.test(h.object.name));
    return hit ? hit.point.y : null;
  };
  // mound centres and several off-centre points
  for (const m of r.layout.features.filter((f) => f.kind === 'mound' && f.built)) {
    for (const [dx, dz] of [[0, 0], [3, 0], [0, 3], [-2.5, 2], [4, -1.5], [-4, -3]]) {
      const x = m.x + dx, z = m.z + dz;
      const sampled = C.waterfrontBeachLandscapeHeightAt(x, z);
      const ray = rayHeight(x, z);
      if (ray == null) { assert.equal(sampled, null, `${m.id} off-surface ${dx},${dz}`); continue; }
      assert.ok(Math.abs(sampled - ray) < 1e-4, `${m.id} ${dx},${dz}: sampler ${sampled} ray ${ray}`);
      assert.ok(sampled > 0.225 + 0.02, `${m.id} ${dx},${dz} is raised (${sampled})`);
    }
  }
  // the leaf is a flat ~0.12 m step over the ground, sampled equally by both
  const s = r.layout.features.find((f) => f.kind === 'splash');
  for (const [lx, lz] of [[0, 0], [0.6, 0.1], [-0.5, 0.35], [0.65, -0.1], [0.3, 0.75]]) {
    if (!C.pointInLeafLocal(lx, lz)) continue;
    const [x, z] = C.leafToWorld(s, lx, lz);
    const sampled = C.waterfrontBeachLandscapeHeightAt(x, z);
    const ray = rayHeight(x, z);
    assert.ok(Math.abs(sampled - ray) < 1e-4, `leaf ${lx},${lz}: sampler ${sampled} ray ${ray}`);
    assert.ok(Math.abs(sampled - (s.y + s.height)) < 1e-3, `leaf top ${sampled}`);
  }
  // disabled/unsupported must return null even though the built triangles still exist
  C.waterfrontBeachLandscapeEnabled = false;
  assert.equal(C.waterfrontBeachLandscapeHeightAt(F.middleMound.x, F.middleMound.z), null);
  C.waterfrontBeachLandscapeEnabled = true;
});

test('rock tops are upward-facing and visible from above at the expected height', () => {
  const r = C.waterfrontBeachLandscape;
  r.group.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  for (const f of r.layout.features.filter((x) => x.kind === 'outcrop')) {
    raycaster.set(new THREE.Vector3(f.x, 20, f.z), down);
    const hits = raycaster.intersectObjects(r.group.children, true);
    const rock = hits.find((h) => h.object.name === 'WaterfrontBeachLandscape-Rocks');
    assert.ok(rock, `${f.id} has a top hit from above`);
    assert.ok(Math.abs(rock.point.y - (f.y + f.height)) < 0.08, `${f.id} top ${rock.point.y} ~ ${f.y + f.height}`);
    // the hit normal points up (a real top face, not an inward side/back face)
    assert.ok(rock.face && rock.face.normal.y > 0.5, `${f.id} top face normal.y ${rock.face && rock.face.normal.y}`);
  }
});

test('every candy-stripe vertex lies on the actual rock footprint and within 1 cm of the rock surface', () => {
  const r = C.waterfrontBeachLandscape;
  r.group.updateMatrixWorld(true);
  const rocks = r.layout.features.filter((f) => f.kind === 'outcrop');
  const rockMesh = r.group.children.find((c) => c.name === 'WaterfrontBeachLandscape-Rocks');
  const raycaster = new THREE.Raycaster();
  let checked = 0;
  for (const name of ['WaterfrontBeachLandscape-StripesRed', 'WaterfrontBeachLandscape-StripesWhite']) {
    const mesh = r.group.children.find((c) => c.name === name);
    assert.ok(mesh && !mesh.isInstancedMesh, `${name} is a bounded merged mesh`);
    const p = mesh.geometry.attributes.position;
    const n = mesh.geometry.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
      // the projected vertex must be inside one of the two actual rock footprints (not a projecting beam)
      const inside = rocks.some((f) => C.outcropContains(f, x, z, 0));
      assert.ok(inside, `${name} vertex ${x.toFixed(2)},${z.toFixed(2)} is inside a rock footprint`);
      // and it must lie within 1 cm of the actual facet surface, checked along its own facet normal
      const origin = new THREE.Vector3(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02);
      raycaster.set(origin, new THREE.Vector3(-nx, -ny, -nz));
      raycaster.far = 0.06;
      const hits = raycaster.intersectObject(rockMesh, true);
      assert.ok(hits.length, `${name} vertex has rock along its facet normal`);
      const gap = hits[0].distance - 0.02; // the ray starts 2 cm out along the normal
      assert.ok(Math.abs(gap) <= 0.01, `${name} vertex surface gap ${gap.toFixed(4)} m`);
      checked++;
    }
  }
  assert.ok(checked > 100, `${checked} stripe vertices checked`);
});

test('ground mask is a composable, idempotent TSL hook and a no-op off-frame', () => {
  const mat = new THREE.MeshStandardNodeMaterial();
  const out = C.applyWaterfrontBeachLandscapeGroundMask(mat);
  assert.equal(out, mat);
  assert.ok(mat.maskNode, 'maskNode composed');
  assert.equal(mat.userData.waterfrontBeachLandscapeMask, true);
  const before = mat.maskNode;
  C.applyWaterfrontBeachLandscapeGroundMask(mat);
  assert.equal(mat.maskNode, before, 'second call is idempotent');
  const plain = new THREE.MeshStandardMaterial();
  assert.equal(C.applyWaterfrontBeachLandscapeGroundMask(plain), plain);
  assert.equal(plain.maskNode, undefined);
  // off-frame: a new GEO identity with a tiny frame is a no-op
  C.GEO = { ...C.GEO, frame: { detail: { x0: 0, x1: 1, z0: 0, z1: 1 } } };
  const off = new THREE.MeshStandardNodeMaterial();
  assert.equal(C.applyWaterfrontBeachLandscapeGroundMask(off), off);
  assert.ok(!off.maskNode, 'off-frame leaves the node unmasked');
});

test('both shipped frames build the landscape; an unrecognized frame is a no-op', async () => {
  const buf = fs.readFileSync(new URL('../data/frames/eglinton/toronto-geodata.bin', import.meta.url));
  const { GEO } = await unpackGeo(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const ctx = {
    window: { CITY: { THREE, TSL, CITY_BOUNDS: { sidewalkHeight: 0.22 } } },
    console: { info() {}, log() {}, warn() {} }, performance, URLSearchParams, Buffer,
    atob: (s) => Buffer.from(s, 'base64').toString('binary')
  };
  vm.runInNewContext(read('js/toronto-geodata.js'), ctx);
  vm.runInNewContext(read('js/waterfront-details.js'), ctx);
  vm.runInNewContext(read('js/waterfront-beach-landscape.js'), ctx);
  const CE = ctx.window.CITY;
  // decode the real Eglinton bin and use its GEO for the frame/anchors
  CE.GEO = GEO;
  const Le = CE.waterfrontBeachLandscapeLayout();
  assert.ok(Le.site, 'Eglinton contains Sugar Beach');
  assert.equal(Le.features.filter((f) => f.kind === 'outcrop').length, 2);
  const scene = { added: [], add(o) { this.added.push(o); } };
  assert.ok(CE.createWaterfrontBeachLandscape(THREE, scene), 'Eglinton builds');

  // unrecognized frame: null builder, no group, no enabled height sampling
  CE.GEO = { ...GEO, frame: { detail: { x0: 0, x1: 1, z0: 0, z1: 1 } } };
  CE.waterfrontBeachLandscapeEnabled = false;
  const none = CE.createWaterfrontBeachLandscape(THREE, { add() {} });
  assert.equal(none, null);
  assert.equal(CE.waterfrontBeachLandscapeEnabled, false);
  assert.equal(CE.waterfrontBeachLandscapeHeightAt(964, 556), null);
});
