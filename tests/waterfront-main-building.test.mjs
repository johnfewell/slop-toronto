// Harbourfront Centre Main Building (js/waterfront-main-building.js): the institutional envelope of the ten mapped City
// 3D Massing rows named "Harbourfront Centre Main Building" (detail-frame rows 33246-33255). The tests check the real
// THREE geometry against the committed mapped footprints: every volume stays inside its mapped part, the colliders are
// the native mapped parts, the exclusion hook covers only the rows actually drawn, and the east face is the mapped
// east face (the face whose outward normal points +x). The face-panel yaw is derived from the face's own along vector,
// so a projected-bounds check catches the Terminal face-alignment bug (one yaw for all four faces).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function city() {
  const ctx = {
    window: { CITY: { THREE, Addons: { mergeGeometries }, CITY_BOUNDS: { sidewalkHeight: 0.22, waterLevel: -0.7 } } },
    document: { createElement: (t) => (t === 'canvas' ? fakeCanvas(256, 96) : {}) },
    console: { info() {}, warn() {}, error() {} }, performance
  };
  vm.runInNewContext(read('js/toronto-geodata.js'), ctx);
  vm.runInNewContext(read('js/waterfront-main-building.js'), ctx);
  return ctx.window.CITY;
}

// world -> a part's local frame (the city's u*cos+v*sin, -u*sin+v*cos convention)
function localOf(part, x, z) {
  const cs = Math.cos(part.ang), sn = Math.sin(part.ang);
  const dx = x - part.cx, dz = z - part.cz;
  return [dx * cs - dz * sn, dx * sn + dz * cs];
}
function insideParts(parts, x, z, pad = 0) {
  for (const p of parts) {
    const [u, v] = localOf(p, x, z);
    if (Math.abs(u) <= p.halfW + pad && Math.abs(v) <= p.halfD + pad) return true;
  }
  return false;
}

const C = city();
const LAYOUT = C.waterfrontMainBuildingLayout();
const ALL_PARTS = LAYOUT.rows.flatMap((r) => r.parts);

// A VM context here shares its own crossing of arrays into the test realm, so deep equality uses plain copies.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('nothing is built on load; the API and a fail-closed exclusion hook are exported', () => {
  assert.equal(typeof C.createWaterfrontMainBuilding, 'function');
  assert.equal(C.waterfrontMainBuilding, undefined);
  assert.equal(typeof C.waterfrontMainBuildingExcludesBuilding, 'function');
  assert.equal(C.waterfrontMainBuildingExcludesBuilding(33252), false, 'the hook excludes nothing before a build');
  assert.equal(C.waterfrontMainBuilding, undefined);
  assert.equal(C.MAIN_BUILDING_ROWS.length, 10);
  assert.equal(C.MAIN_BUILDING_ROWS.filter((r) => r.role === 'main-volume').length, 1);
});

test('all ten mapped rows resolve by name + centre + height, and the main volume is the 14 m block', () => {
  assert.equal(LAYOUT.supported, true);
  assert.equal(LAYOUT.rows.length, 10);
  assert.equal(LAYOUT.unresolved, 0);
  assert.equal(LAYOUT.mainVolume.h, 14);
  assert.ok(Math.abs(LAYOUT.mainVolume.part.cx + 376.4) < 0.01 && Math.abs(LAYOUT.mainVolume.part.cz - 627.2) < 0.01);
  // every resolved row is the named Main Building row
  for (const r of LAYOUT.rows) assert.equal(C.GEO.buildings[r.row][9], 'Harbourfront Centre Main Building');
});

test('the east face is the mapped face whose outward normal points +x (grid east)', () => {
  const east = LAYOUT.mainVolume.east;
  assert.ok(east, 'the main volume has an east face');
  assert.ok(east.normal[0] > 0.5, `east normal x ${east.normal[0]}`);
  // the east face is the max-x face of the main volume: its centre is the part centre + halfW along +x
  const part = LAYOUT.mainVolume.part;
  assert.ok(east.cx > part.cx, 'the east face centre is east of the part centre');
  // the face along vector is the u axis, and the panel yaw is atan2(-along.z, along.x)
  const yaw = Math.atan2(-east.along[1], east.along[0]);
  assert.ok(Math.abs(yaw - east.yaw) < 1e-9, 'the face yaw derives from its own along vector');
});

// A browser page has a `document` and three's `CanvasTexture`, so `letteringTexture` runs there. Forge a canvas document
// in the test realm (before the lazy build) so the canvas path — the real browser path — is what these tests exercise,
// not only the plain-panel fallback.
function fakeCanvas(width, height) {
  return {
    width, height,
    getContext() {
      return {
        fillStyle: '', font: '', textAlign: '', textBaseline: '',
        fillRect() {}, fillText() {}, measureText(t) { return { width: 0.6 * (t || '').length * parseInt(this.font.match(/(\d+)px/)?.[1] || '0', 10) }; }
      };
    }
  };
}
globalThis.document = { createElement: (t) => (t === 'canvas' ? fakeCanvas(256, 96) : {}) };

// (built lazily so the "nothing built on load" test sees the module as loaded)
let _built = null;
const builtOf = () => (_built ||= C.createWaterfrontMainBuilding(THREE));

test('the builder returns the documented API and one culling root named WaterfrontMainBuilding', () => {
  assert.ok(builtOf().group && builtOf().group.name === 'WaterfrontMainBuilding');
  assert.ok(Array.isArray(builtOf().colliders));
  assert.ok(builtOf().stats && builtOf().stats.rows === 10 && builtOf().stats.parts === ALL_PARTS.length);
  assert.ok(builtOf().stats.meshes > 0 && builtOf().stats.triangles > 0);
  assert.equal(builtOf().group.userData.waterfrontMainBuilding, builtOf().stats);
});

test('the colliders are the native mapped parts (centre, half extents, angle, mapped height)', () => {
  const body = builtOf().colliders.filter((k) => k.kind === 'main-building');
  assert.equal(body.length, ALL_PARTS.length);
  for (const part of ALL_PARTS) {
    const c = body.find((k) => Math.abs(k.obb.cx - part.cx) < 1e-6 && Math.abs(k.obb.cz - part.cz) < 1e-6);
    assert.ok(c, `a collider at the mapped part (${part.cx.toFixed(1)}, ${part.cz.toFixed(1)})`);
    assert.ok(Math.abs(c.obb.hx - part.halfW) < 1e-6 && Math.abs(c.obb.hz - part.halfD) < 1e-6);
    assert.ok(Math.abs(c.obb.cs - Math.cos(part.ang)) < 1e-6 && Math.abs(c.obb.sn - Math.sin(part.ang)) < 1e-6);
    assert.equal(c.minY, 0);
    assert.ok(Math.abs(c.maxY - part.h) < 1e-6, `collider top is the mapped height ${part.h}`);
  }
  // no full-height body collider stands on the entrance strip (that would block the walkway); the strip's only
  // colliders are the thin posts and the overhead roof plane.
  const strip = LAYOUT.entranceCanopy;
  for (const c of builtOf().colliders) {
    if (c.kind !== 'main-building') continue;
    const insideStrip = Math.abs(c.obb.cx - strip.part.cx) < 0.6 && Math.abs(c.obb.cz - strip.part.cz) < 0.6;
    assert.ok(!insideStrip, 'no full-height body collider on the entrance canopy strip');
  }
});

test('the entrance canopy strip row is resolved by exact mapped identity, never by row index', () => {
  const strip = LAYOUT.entranceCanopy;
  assert.ok(strip, 'the entrance canopy strip resolved');
  const b = C.GEO.buildings[strip.row];
  // exact mapped identity: the unnamed strip row at its committed centre and mapped height
  assert.ok(Math.abs(b[0] + 359.7) < 1e-9 && Math.abs(b[1] - 591.6) < 1e-9, 'centre (-359.7, 591.6)');
  assert.ok(Math.abs(b[4] - 4.3) < 1e-9, 'mapped height 4.3 m');
  assert.equal(b[9], '', 'the strip is the unnamed row');
  // a single 15.8 m x 3.6 m rectangular part
  assert.equal(b[3].length, 1);
  assert.ok(Math.abs((b[3][0][1] - b[3][0][0]) - 15.8) < 0.3 && Math.abs((b[3][0][3] - b[3][0][2]) - 3.6) < 0.3);
  // the resolver is centre+height keyed and returns the same row for the same GEO
  assert.equal(C.waterfrontEntranceCanopyRow()?.row, strip.row);
  // and the identity is the row's own mapped centre/height, not an index: a shifted clone does not resolve
  const clone = { frame: C.GEO.frame, buildings: C.GEO.buildings.map((r) => r.slice()) };
  clone.buildings[strip.row] = clone.buildings[strip.row].slice();
  clone.buildings[strip.row][4] = 9.9;
  assert.equal(C.waterfrontEntranceCanopyRow(clone), null, 'the wrong height does not resolve');
});

test('the canopy roof spans the mapped strip footprint only, and the centre stays open', () => {
  const strip = LAYOUT.entranceCanopy;
  const roof = builtOf().group.getObjectByName('WaterfrontMainBuilding-canopyRoof');
  assert.ok(roof, 'the canopy roof mesh exists');
  const box = new THREE.Box3().setFromObject(roof);
  const b = strip.bounds;
  assert.ok(box.min.x >= b.minX - 0.05 && box.max.x <= b.maxX + 0.05, `roof x [${box.min.x.toFixed(2)}, ${box.max.x.toFixed(2)}] inside strip [${b.minX.toFixed(2)}, ${b.maxX.toFixed(2)}]`);
  assert.ok(box.min.z >= b.minZ - 0.05 && box.max.z <= b.maxZ + 0.05, `roof z [${box.min.z.toFixed(2)}, ${box.max.z.toFixed(2)}] inside strip [${b.minZ.toFixed(2)}, ${b.maxZ.toFixed(2)}]`);
  // roof sits at the mapped 4.3 m height, within a build tolerance
  assert.ok(box.max.y <= strip.h + 0.05 && box.min.y >= strip.h - 1.0, `roof at ~${strip.h} m (got ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)})`);
  // the OPEN CENTRE: a point at the strip's centre column must have nothing solid at or below the roof underside
  const posts = builtOf().stats.canopyPosts;
  const cx = strip.part.cx, cz = strip.part.cz;
  for (const p of posts) {
    const d = Math.hypot(p.x - cx, p.z - cz);
    assert.ok(d > 1.0, `post ${d.toFixed(2)} m from the open centre`);
  }
  // only the thin posts + one overhead roof plane collide on the strip (never full house walls)
  const stripColliders = builtOf().colliders.filter((k) => k.kind.startsWith('main-building-canopy'));
  assert.equal(stripColliders.filter((k) => k.kind === 'main-building-canopy-roof').length, 1);
  assert.equal(stripColliders.filter((k) => k.kind === 'main-building-canopy-post').length, posts.length);
  for (const c of stripColliders.filter((k) => k.kind === 'main-building-canopy-post')) {
    assert.ok(c.minY === 0 && c.maxY <= 4.3, 'a post collider is a thin ground-to-roof column');
    assert.ok(c.maxX - c.minX < 0.5 && c.maxZ - c.minZ < 0.5, 'a post collider is thin');
  }
  // the roof collider is overhead only: minY > 0, so a pedestrian walks under it
  const roofCol = stripColliders.find((k) => k.kind === 'main-building-canopy-roof');
  assert.ok(roofCol.minY >= 3.0 && roofCol.maxY <= 4.3, `the roof collider is overhead (minY ${roofCol.minY})`);
});

test('the exclusion hook covers exactly the ten named rows plus the one canopy strip, and nothing else', () => {
  const rows = builtOf().stats.excludedRows;
  assert.equal(rows.length, 11, 'ten named rows + the entrance canopy strip');
  for (const r of rows) assert.equal(C.waterfrontMainBuildingExcludesBuilding(r), true);
  // every unnamed row other than the canopy strip is left on the generic path (no broad unnamed-row deletion)
  const strip = LAYOUT.entranceCanopy;
  for (let i = 0; i < C.GEO.buildings.length; i++) {
    const b = C.GEO.buildings[i];
    if (b[9] === 'Harbourfront Centre Main Building') continue;
    if (i === strip.row) continue;
    assert.equal(C.waterfrontMainBuildingExcludesBuilding(i), false, `unnamed row ${i} stays generic`);
  }
  assert.deepEqual(plain([...C.waterfrontMainBuildingExcludedRows].sort((a, b) => a - b)), plain(rows));
});

test('every wall/roof/glazing/canopy vertex projects inside its mapped part (the face-yaw bug would stick out)', () => {
  const v = new THREE.Vector3();
  // The canopy parts are their own mapped strip, so the union of the named parts alone does not contain them; include
  // the strip part in the containment test. boxGeo is axis-aligned before rotateY, so a panel with the wrong yaw shows
  // up here as vertices projecting outside the part at +/-45 deg of the wall. The black leading fascia is a thin relief
  // that deliberately stands a few centimetres proud of the strip's east edge, so it is checked against the strip with a
  // small pad; every other part must stay inside the mapped footprints.
  const parts = ALL_PARTS.concat([LAYOUT.entranceCanopy.part]);
  builtOf().group.updateMatrixWorld(true);
  let checked = 0;
  for (const mesh of builtOf().group.children) {
    if (mesh.isGroup) continue;
    const isFascia = mesh.name === 'WaterfrontMainBuilding-canopyFascia';
    const pad = isFascia ? 0.35 : 0.5;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      assert.ok(insideParts(parts, v.x, v.z, pad), `${mesh.name}: vertex (${v.x.toFixed(1)}, ${v.z.toFixed(1)}) is outside the mapped footprints`);
      checked++;
    }
  }
  assert.ok(checked > 1000, `${checked} panel vertices checked`);
});

test('the volumes reach the mapped heights and the roof caps sit on them', () => {
  const maxH = Math.max(...ALL_PARTS.map((p) => p.h));
  const roof = builtOf().group.getObjectByName('WaterfrontMainBuilding-roof');
  assert.ok(roof, 'a merged roof mesh exists');
  const box = new THREE.Box3().setFromObject(roof);
  assert.ok(box.max.y >= maxH && box.max.y <= maxH + 0.2, `roof top ${box.max.y.toFixed(2)} m vs mapped ${maxH} m`);
  // the main volume is the dark charcoal envelope
  const charcoal = builtOf().group.getObjectByName('WaterfrontMainBuilding-charcoal');
  assert.ok(charcoal, 'the main volume has the dark charcoal envelope');
  const cb = new THREE.Box3().setFromObject(charcoal);
  assert.ok(cb.max.y >= 13.9 && cb.max.y <= 14.1, `charcoal top ${cb.max.y.toFixed(2)} m is the 14 m main volume`);
});

test('the east face carries the ground glazing, two window ribbons and the fascia, and NO invented canopy', () => {
  assert.ok(builtOf().stats.groundMullions >= 3, `${builtOf().stats.groundMullions} ground mullions`);
  assert.equal(builtOf().stats.ribbons >= 2, true, `${builtOf().stats.ribbons} window ribbons`);
  assert.ok(builtOf().group.getObjectByName('WaterfrontMainBuilding-fascia'), 'the black top fascia exists');
  // OLD INVENTED CANOPY GONE: the previous pass projected a black canopy off the middle of the main-volume east face.
  // No mesh named ...-canopy exists any more, and no canopy geometry hangs anywhere on the east face plane.
  assert.equal(builtOf().group.getObjectByName('WaterfrontMainBuilding-canopy'), undefined, 'the old east-face canopy mesh is gone');
  assert.equal(builtOf().stats.canopy, undefined, 'the old east-face canopy stat is gone');
  const east = LAYOUT.mainVolume.east;
  // the new canopy (its roof) is the strip to the NORTH of the main volume's north edge, not on the east face
  const roof = builtOf().group.getObjectByName('WaterfrontMainBuilding-canopyRoof');
  const rb = new THREE.Box3().setFromObject(roof);
  const strip = LAYOUT.entranceCanopy;
  assert.ok(rb.max.z <= strip.bounds.maxZ + 0.1 && rb.min.z >= strip.bounds.minZ - 0.1, 'the canopy roof is on the strip, north of the main volume');
  // and it is entirely north of the east face (the main volume's north end z is the east face's lower-z end)
  const eastNorthZ = Math.min(
    east.cz + east.along[1] * east.length / 2,
    east.cz - east.along[1] * east.length / 2
  );
  assert.ok(rb.min.z < eastNorthZ, `canopy roof (z ${rb.min.z.toFixed(1)}..${rb.max.z.toFixed(1)}) reaches north of the east face north end (${eastNorthZ.toFixed(1)})`);
});

test('the canopy is not placed by any guessed offset: every piece sits inside the mapped strip', () => {
  const strip = LAYOUT.entranceCanopy;
  const E = C.MAIN_BUILDING_ESTIMATES;
  const v = new THREE.Vector3();
  // no guessed canopy dimensions remain in the estimate table
  assert.equal(E.canopyWidth, undefined);
  assert.equal(E.canopyDepth, undefined);
  assert.equal(E.canopyFromNorthEnd, undefined);
  const part = strip.part;
  for (const name of ['WaterfrontMainBuilding-canopyRoof', 'WaterfrontMainBuilding-canopyBeam', 'WaterfrontMainBuilding-canopyPost']) {
    const mesh = builtOf().group.getObjectByName(name);
    assert.ok(mesh, `${name} exists`);
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const [u, vv] = localOf(part, v.x, v.z);
      assert.ok(Math.abs(u) <= part.halfW + 0.02 && Math.abs(vv) <= part.halfD + 0.02,
        `${name} vertex (${v.x.toFixed(2)}, ${v.z.toFixed(2)}) stays inside the mapped strip`);
    }
  }
});

test('the black fascias carry white source lettering planes when a canvas exists, plain panels otherwise', () => {
  const g = builtOf().group;
  // the fascia and the canopy leading fascia are black base geometry regardless of runtime
  assert.ok(g.getObjectByName('WaterfrontMainBuilding-fascia'), 'the black top fascia panel exists');
  assert.ok(g.getObjectByName('WaterfrontMainBuilding-canopyFascia'), 'the black canopy leading fascia exists');
  assert.equal(C.MAIN_BUILDING_ESTIMATES.fasciaText, 'Harbourfront Centre');
  assert.equal(C.MAIN_BUILDING_ESTIMATES.canopySignText, '235');
  const hasCanvas = typeof document !== 'undefined';
  if (hasCanvas) {
    const ft = g.getObjectByName('WaterfrontMainBuilding-FasciaText');
    const ct = g.getObjectByName('WaterfrontMainBuilding-CanopyText');
    assert.ok(ft && ct, 'both lettering planes exist in a DOM runtime');
    assert.ok(ft.material.map && ct.material.map, 'each lettering plane samples its canvas texture');
    assert.equal(builtOf().stats.lettering.fascia, true);
    assert.equal(builtOf().stats.lettering.canopy, true);
    // natural aspect: the plane's own geometry is sized from the canvas aspect, not stretched to a square
    assert.ok(Math.abs(ft.geometry.parameters.width / ft.geometry.parameters.height - ft.material.map.image.width / ft.material.map.image.height) < 0.2);
  } else {
    assert.equal(g.getObjectByName('WaterfrontMainBuilding-FasciaText'), undefined);
    assert.equal(g.getObjectByName('WaterfrontMainBuilding-CanopyText'), undefined);
    assert.equal(builtOf().stats.lettering.fascia, false);
    assert.equal(builtOf().stats.lettering.canopy, false);
  }
});

test('the 235 sign rides the canopy leading fascia on the strip east edge, not a floating east-face canopy', () => {
  const E = C.MAIN_BUILDING_ESTIMATES;
  const strip = LAYOUT.entranceCanopy;
  const sign = builtOf().group.getObjectByName('WaterfrontMainBuilding-CanopyText');
  if (!sign) { // DOM-less runtime: the plain black leading fascia still stands on the strip east edge
    const fascia = builtOf().group.getObjectByName('WaterfrontMainBuilding-canopyFascia');
    const fb = new THREE.Box3().setFromObject(fascia);
    assert.ok(fb.max.x >= strip.bounds.maxX - 0.3 && fb.max.x <= strip.bounds.maxX + 0.3, 'the 235 fascia is on the strip east edge');
    return;
  }
  const sb = new THREE.Box3().setFromObject(sign);
  const c = sb.getCenter(new THREE.Vector3());
  // the sign is on the strip (its centre inside the strip plan) and near its east edge (the leading fascia)
  const [u, vv] = localOf(strip.part, c.x, c.z);
  assert.ok(Math.abs(u) <= strip.part.halfW + 0.2 && Math.abs(vv) <= strip.part.halfD + 0.25, 'the 235 sign sits within 25 cm relief of the strip edge');
  assert.ok(c.x > (strip.bounds.minX + strip.bounds.maxX) / 2, 'the sign is on the leading (east) fascia');
  // and its width/height stay within the fascia band
  const fasciaH = E.canopyFasciaHeight;
  assert.ok(sb.max.y - sb.min.y <= fasciaH, `the 235 sign height ${(sb.max.y - sb.min.y).toFixed(2)} fits the fascia ${fasciaH}`);
});

test('the build is deterministic: a second build produces the same counts and triangles', () => {
  const again = C.createWaterfrontMainBuilding(THREE, { add() {} });
  assert.equal(again.stats.rows, builtOf().stats.rows);
  assert.equal(again.stats.parts, builtOf().stats.parts);
  assert.equal(again.stats.meshes, builtOf().stats.meshes);
  assert.equal(again.stats.triangles, builtOf().stats.triangles);
  assert.deepEqual(plain(again.stats.excludedRows), plain(builtOf().stats.excludedRows));
  // the rebuild left the exclusion state consistent (same GEO as this build)
  assert.equal(C.waterfrontMainBuildingExcludesBuilding(33252), true);
});

// Run LAST: it mutates C.GEO to prove the predicate goes stale-safe, then restores it.
test('a frame swap to an unrelated/reordered GEO suppresses nothing', () => {
  const builtGEO = C.GEO;
  // confirm the built frame excludes its rows
  assert.equal(C.waterfrontMainBuildingExcludesBuilding(33252), true);
  // swap C.GEO to a small, reordered frame where row indices 33246.. don't exist / mean nothing
  const unrelated = {
    frame: { detail: { x0: -1, x1: 1, z0: -1, z1: 1 } },
    buildings: [[0, 0, 0, [[-5, 5, -5, 5]], 10, 0, 0, 1, 0, 'Unrelated Building']]
  };
  C.GEO = unrelated;
  // the predicate must not suppress any row of a GEO it was not built against
  assert.equal(C.waterfrontMainBuildingExcludesBuilding(0), false);
  assert.equal(C.waterfrontMainBuildingExcludesBuilding(33252), false, 'the stale row index no longer excludes');
  for (let bi = 0; bi < unrelated.buildings.length; bi++) assert.equal(C.waterfrontMainBuildingExcludesBuilding(bi), false);
  // an unsupported rebuild clears the state entirely
  const rebuilt = C.createWaterfrontMainBuilding(THREE, { add() {} });
  assert.equal(rebuilt.stats.supported, false);
  assert.equal(C.waterfrontMainBuildingExcludedRows.size, 0, 'the unsupported path clears the excluded rows');
  assert.equal(C.waterfrontMainBuildingBuiltGEO, null);
  assert.equal(C.waterfrontMainBuildingExcludesBuilding(0), false);
  // restore the real frame and rebuild so any later test sees the supported state
  C.GEO = builtGEO;
  C.createWaterfrontMainBuilding(THREE, { add() {} });
  assert.equal(C.waterfrontMainBuildingExcludesBuilding(33252), true);
});
