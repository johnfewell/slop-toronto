// Harbourfront Centre Concert Stage (js/waterfront-concert-stage.js): the open-sided, membrane-roofed stage on the
// south-west campus, replacing the generic pitched-roof houses on the mapped "Concert Stage" row. The tests check the
// REAL loaded row/identity, actual three geometry (canopy, ring, masts, seats with backs, deck + graded ramp), the
// walkable surface sampler (top height vs rendered geometry, reachable-step gating, no invisible bounding rectangle),
// and the success-gated exclusion bound to the GEO it was built from.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';

const read = (file) => fs.readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const makeContext = () => {
  const context = vm.createContext({
    window: { CITY: { THREE } }, console: { info() {}, log() {}, warn() {}, error() {} },
    location: { search: '' }, URLSearchParams, Buffer, performance,
    atob: (s) => Buffer.from(s, 'base64').toString('binary')
  });
  for (const file of ['toronto-geodata.js', 'city-config.js', 'waterfront-concert-stage.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  return context.window.CITY;
};
const C = makeContext();
const ROW = C.concertStageRow(C.GEO);
const scene = { added: [], add(object) { this.added.push(object); } };
const built = C.createWaterfrontConcertStage(THREE, scene);
const LAYOUT = built.layout;
const FRAME = LAYOUT.frame;
const world = (u, v) => C.concertStageLocalToWorld(FRAME, u, v);

// The exact rendered deck/ramp top under a local point, derived from the module layout (independent of the sampler).
function renderedTopAt(u, v) {
  const d = LAYOUT.deck, r = LAYOUT.ramp;
  if (u >= r.u0 && u <= r.u1 && v >= r.vBottom && v <= r.vTop) {
    const t = (v - r.vBottom) / (r.vTop - r.vBottom);
    return r.bottomY + (r.topY - r.bottomY) * t;
  }
  if (u >= d.u0 && u <= d.u1 && v >= d.v0 && v <= d.v1) return d.lift;
  return null;
}

test('the Concert Stage row resolves by stable identity (name + centre + height + angle), not by index', () => {
  assert.ok(ROW >= 0, 'the mapped Concert Stage row resolves');
  const b = C.GEO.buildings[ROW];
  assert.equal(b[9], 'Concert Stage');
  assert.ok(Math.abs(b[0] - (-451.5)) < 0.01 && Math.abs(b[1] - 710.7) < 0.01, 'mapped centre preserved');
  assert.ok(Math.abs(b[4] - 7.1) < 0.01, 'the 7.1 m mapped massing height is kept');
  assert.ok(Math.abs(b[2] - (-0.026)) < 0.01, 'the mapped yaw is kept');
  // (compare as JSON: the row comes from the vm realm, so its arrays have a different prototype)
  assert.equal(JSON.stringify(b[3]),
    JSON.stringify([[-4.9, 18.6, -13.5, 10], [-13.4, -4.9, -17, 0], [5.6, 18.6, 10, 16], [-1.4, 13.6, -18, -13.5]]),
    'the exact mapped part rectangle is preserved');
});

test('builds one culling root with the documented open-canopy components, all instanced/merged and bounded', () => {
  assert.equal(scene.added.length, 1);
  assert.equal(built.group.name, 'WaterfrontConcertStage');
  assert.equal(built.root, built.group);
  assert.equal(built.stats.meshes, built.group.children.length);
  for (const name of ['RoofMembrane', 'RingMembrane', 'Masts', 'Truss', 'Seats', 'Deck', 'Ramp', 'Wall', 'Guardrail', 'Cables']) {
    const mesh = built.group.getObjectByName(`WaterfrontConcertStage-${name}`);
    assert.ok(mesh, `${name} exists`);
    assert.ok(mesh.userData.cullDistance > 0 && mesh.userData.cullCell > 0, `${name} has culling metadata`);
  }
  assert.ok(built.stats.triangles < 20000, `${built.stats.triangles} triangles (bounded shared build)`);
  // repeated parts are instanced, not one object per chair/mast/strut
  assert.ok(built.group.getObjectByName('WaterfrontConcertStage-Seats').isInstancedMesh);
  assert.ok(built.group.getObjectByName('WaterfrontConcertStage-Masts').isInstancedMesh);
  assert.ok(built.group.getObjectByName('WaterfrontConcertStage-Truss').isInstancedMesh);
});

test('the whole structure stays inside the mapped footprint (plan-space containment, no invented geometry)', () => {
  const f = FRAME;
  // the mapped union rectangle in the row frame; every rendered vertex must fall inside it (a small pad for the proud
  // roof edge, which is still well inside the mapped parts)
  const pad = 0.5;
  const inside = (x, z) => {
    const [u, v] = C.concertStageWorldToLocal(f, x, z);
    return u >= f.u0 - pad && u <= f.u1 + pad && v >= f.v0 - pad && v <= f.v1 + pad;
  };
  let checked = 0;
  built.group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 7) {
      assert.ok(inside(p.getX(i), p.getZ(i)), `${o.name} vertex inside the mapped footprint`);
      checked++;
    }
  });
  assert.ok(checked > 200, `${checked} merged vertices checked`);
});

test('central canopy stands upright in world Y/Z (xyz order), is broad and shallow, above a lower ring with an OPEN GAP', () => {
  assert.ok(built.stats.roofTop > built.stats.ringTop + 1.5,
    `open gap roof ${built.stats.roofTop.toFixed(1)} vs ring ${built.stats.ringTop.toFixed(1)}`);
  const roof = built.group.getObjectByName('WaterfrontConcertStage-RoofMembrane');
  const p = roof.geometry.attributes.position;
  // world axis check: x/z span the plan (horizontal), y is a thin overhead band (NOT a sky-stretched curtain)
  let xmin = 1e9, xmax = -1e9, ymin = 1e9, ymax = -1e9, zmin = 1e9, zmax = -1e9;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  const f = FRAME, planW = (f.u1 - f.u0), planD = (f.v1 - f.v0);
  assert.ok((xmax - xmin) > planW * 0.6, 'canopy spans most of the plan in world x');
  assert.ok((zmax - zmin) > planD * 0.6, 'canopy spans most of the plan in world z');
  assert.ok(ymin > LAYOUT.deck.lift + 5 && ymax < LAYOUT.height.mastTop, 'roof is an overhead band, not in the sky');
  assert.ok((ymax - ymin) < 2.0, `shallow arch ${(ymax - ymin).toFixed(2)} m, not a barrel vault`);
});

test('the scalloped ring is a BROAD almost-horizontal band (several metres wide, shallow sag), not a full-height curtain', () => {
  const b = LAYOUT.ringBand;
  assert.ok(b.width >= 2.5, `band is ${b.width.toFixed(2)} m wide, not a thin curtain`);
  assert.ok(b.rise <= 0.8, `band sag ${b.rise.toFixed(2)} m is shallow`);
  assert.ok(b.width > b.rise * 3, 'the band is wide relative to its rise (open sightlines beneath)');
  // the rendered ring membrane is a low band in world Y (never a full-height vertical wall reaching the roof)
  const ring = built.group.getObjectByName('WaterfrontConcertStage-RingMembrane');
  const p = ring.geometry.attributes.position;
  let ymin = 1e9, ymax = -1e9;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  assert.ok(ymax < built.stats.roofTop - 1, `ring top ${ymax.toFixed(1)} stays below the roof ${built.stats.roofTop.toFixed(1)}`);
  assert.ok((ymax - ymin) < 4.0, `ring is a shallow band (${(ymax - ymin).toFixed(2)} m tall)`);
});

test('masts follow the primary photos: six front masts fanned across the open side plus two back supports', () => {
  const masts = LAYOUT.masts;
  assert.equal(masts.length, LAYOUT.estimates.frontMasts + LAYOUT.estimates.backMasts);
  assert.equal(LAYOUT.estimates.frontMasts, 6, 'six legible front masts (captain photo); total is representative');
  const front = masts.filter((m) => m.front);
  assert.equal(front.length, 6);
  // the six front masts sit along the front (+v) edge and are fanned in u
  const us = front.map((m) => C.concertStageWorldToLocal(FRAME, m.x, m.z)[0]).sort((a, b) => a - b);
  assert.ok(us[us.length - 1] - us[0] > 8, 'the front masts are fanned across the open side, not crowded together');
  for (const m of front) {
    const [, v] = C.concertStageWorldToLocal(FRAME, m.x, m.z);
    assert.ok(v > FRAME.vc, 'front masts are on the waterward front half');
  }
});

test('every transformed instance (truss + cables) has its endpoints in the roof band, not the sky or below ground', () => {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const lo = LAYOUT.deck.lift + 6, hi = LAYOUT.height.mastTop + 0.5;
  const check = (mesh, axis, where) => {
    let bad = 0;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); m.decompose(p, q, s);
      const half = new THREE.Vector3(axis === 'y' ? 0 : 1, axis === 'y' ? 1 : 0, 0).applyQuaternion(q)
        .multiplyScalar((axis === 'y' ? s.y : s.x) / 2);
      const e1 = p.clone().add(half), e2 = p.clone().sub(half);
      if (e1.y < lo || e2.y < lo || e1.y > hi || e2.y > hi) bad++;
    }
    assert.equal(bad, 0, `${where}: all ${mesh.count} instances ${where === 'truss' ? 'in the roof band' : 'from masts to roof'}`);
  };
  // truss struts: length is along local +Y (matching basisFromDir), endpoints must sit in the roof band
  check(built.group.getObjectByName('WaterfrontConcertStage-Truss'), 'y', 'truss');
  // cables: length along local +Y too, endpoints from mast tip (~mastTop) down to the roof/ring
  const cab = built.group.getObjectByName('WaterfrontConcertStage-Cables');
  assert.ok(cab.count > 0);
  let bad = 0;
  for (let i = 0; i < cab.count; i++) {
    cab.getMatrixAt(i, m); m.decompose(p, q, s);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(s.y / 2);
    const e1 = p.clone().add(up), e2 = p.clone().sub(up);
    if (e1.y < LAYOUT.ringTop - 0.5 || e1.y > LAYOUT.height.mastTop + 0.1 || e2.y < LAYOUT.ringTop - 0.5 || e2.y > LAYOUT.height.mastTop + 0.1) bad++;
  }
  assert.equal(bad, 0, 'every cable spans mast tip to roof/ring, not the sky');
});

test('fixed dark seats: real chair geometry (pan + back), clear row pitch, every chair rests on the deck top', () => {
  const seats = built.group.getObjectByName('WaterfrontConcertStage-Seats');
  assert.ok(seats.isInstancedMesh && seats.count === LAYOUT.seats.length);
  assert.ok(seats.count > 100, `${seats.count} fixed seats`);
  seats.geometry.computeBoundingBox();
  const bb = seats.geometry.boundingBox;
  // pan (low) + back (tall): the unit is a chair profile with a raised back, base at y≈0 (rests on the floor)
  assert.ok(bb.max.y - bb.min.y > 0.4 && bb.max.y - bb.min.y < 1.0, `chair profile ${(bb.max.y - bb.min.y).toFixed(2)} m`);
  assert.ok(Math.abs(bb.min.y) < 0.02, 'seat base sits at its own y=0 so an instance on the deck rests on the floor');
  // no floating: every seat instance's base is the deck top
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < seats.count; i++) {
    seats.getMatrixAt(i, m); m.decompose(p, q, s);
    assert.ok(Math.abs(p.y - LAYOUT.deck.lift) < 1e-6, 'seat rests on the deck top (not floating)');
  }
  // row pitch exceeds the seat depth so chairs in successive rows do not intersect
  assert.ok(LAYOUT.estimates.rowPitch > LAYOUT.estimates.seatDepth,
    `row pitch ${LAYOUT.estimates.rowPitch} > seat depth ${LAYOUT.estimates.seatDepth}`);
  const vs = [...new Set(LAYOUT.seats.map((x) => +x.v.toFixed(3)))].sort((a, b) => a - b);
  for (let i = 1; i < vs.length; i++) assert.ok(vs[i] - vs[i - 1] >= LAYOUT.estimates.seatDepth, 'no intersecting rows');
  assert.ok(built.stats.seatRows >= 6, `${built.stats.seatRows} fixed seat rows`);
});

test('the raised deck and the rear ramp are the exact walkable surface, returning the rendered top (no invisible box)', () => {
  assert.ok(typeof C.concertStageSurfaceAt === 'function');
  // the deck centre: from the deck it is walkable at its rendered top; from the ground it is not a single step
  const d = LAYOUT.deck;
  const [dcx, dcz] = world((d.u0 + d.u1) / 2, (d.v0 + d.v1) / 2);
  const onDeck = C.concertStageSurfaceAt(dcx, dcz, { baseY: d.lift });
  assert.ok(onDeck && Math.abs(onDeck.h - d.lift) < 1e-6, 'deck top sampled at its rendered height');
  assert.equal(C.concertStageSurfaceAt(dcx, dcz, { baseY: 0, maxRise: 0.2 }), null, 'respects the requested step limit');
  // outside the deck and ramp (a side walk / the rear court / a corner of the bounding rectangle) is null => ground
  for (const [u, v] of [[FRAME.u0 + 1, FRAME.vc], [FRAME.u1 - 1, FRAME.v0 + 1], [FRAME.uc, FRAME.v1 - 1]]) {
    const [x, z] = world(u, v);
    assert.equal(C.concertStageSurfaceAt(x, z, { baseY: d.lift }), null, `no invisible surface at (${u.toFixed(1)}, ${v.toFixed(1)})`);
  }
  assert.equal(C.concertStageSurfaceAt(0, 0, {}), null, 'far away is not the stage');
});

test('a walker rises from the ground up the rear ramp onto the deck with no gap and no drop', () => {
  const r = LAYOUT.ramp;
  const uc = (r.u0 + r.u1) / 2;
  let y = 0, ok = true, sampled = 0, climbedTo = 0;
  for (let v = r.vBottom - 0.3; v <= LAYOUT.deck.v0; v += 0.2) {
    const [x, z] = world(uc, v);
    const s = C.concertStageSurfaceAt(x, z, { baseY: y });
    if (!s) { if (y > 0.001) { ok = false; break; } continue; } // ground outside the raised plan, then the ramp
    if (Math.abs(s.h - y) > 0.3 && sampled > 0) { ok = false; break; } // a discontinuity would be a step or a drop
    y = s.h; climbedTo = Math.max(climbedTo, y); sampled++;
  }
  assert.ok(ok, 'continuous walk up the ramp');
  assert.ok(sampled > 10, `${sampled} ramp/deck samples`);
  assert.ok(Math.abs(climbedTo - LAYOUT.deck.lift) < 0.15, `reached the deck top (${climbedTo.toFixed(2)} m)`);
});

test('the rear ramp is a gentle, honest representative grade (not a steep guessed "accessible" ramp)', () => {
  const r = LAYOUT.ramp;
  assert.ok(r.run > 3, `ramp run ${r.run.toFixed(2)} m`);
  assert.ok(r.grade < 1 / 12, `the representative approach remains shallow (1:${(1 / r.grade).toFixed(1)})`);
  assert.ok(r.grade > 0.05, 'still a real rise, not flat');
  assert.ok(/photo-informed estimates/i.test(built.stats.rampGrade), 'dimensions are labelled estimates');
  // the ramp stays inside the mapped footprint (its foot is not beyond the rear edge)
  assert.ok(r.vBottom >= FRAME.v0, 'ramp foot inside the mapped footprint');
});

test('the surface top matches the rendered ramp/deck height at sampled points (sampler == geometry)', () => {
  const d = LAYOUT.deck;
  let n = 0;
  for (let i = 1; i < 6; i++) {
    for (let j = 1; j < 4; j++) {
      const u = d.u0 + (d.u1 - d.u0) * (i / 6), v = d.v0 + (d.v1 - d.v0) * (j / 4);
      const [x, z] = world(u, v);
      const s = C.concertStageSurfaceAt(x, z, { baseY: d.lift + 0.5 });
      const rendered = renderedTopAt(u, v);
      assert.ok(s && rendered !== null && Math.abs(s.h - rendered) < 1e-6, `deck ${u.toFixed(1)},${v.toFixed(1)}`);
      n++;
    }
  }
  assert.ok(n >= 15);
});

test('the deck is not a solid collider, but masts and the low wall are (walk beneath, mast posts are solid)', () => {
  const kinds = {};
  for (const c of built.colliders) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
  assert.equal(kinds['concert-stage-mast'], LAYOUT.masts.length, 'one slim post collider per mast');
  assert.ok(kinds['concert-stage-wall'] >= 1, 'low perimeter wall colliders');
  assert.equal(kinds['concert-stage-deck'], undefined, 'the deck is a walkable surface, not a solid collider');
  const roof = built.colliders.find((c) => c.kind === 'concert-stage-roof');
  assert.ok(roof && roof.minY > LAYOUT.deck.lift + 2 && roof.maxY >= LAYOUT.roof.top + LAYOUT.roof.rise,
    'the canopy blocks cameras at roof height without blocking a standing pedestrian');
  for (const c of built.colliders) {
    assert.ok(c.minY >= 0 && c.maxY <= LAYOUT.height.mastTop + 0.01, `${c.kind} height bounded`);
    assert.ok(c.obb, `${c.kind} has an obb`);
  }
});

test('success-gated exclusion: bound to the built GEO, cleared on an unsupported rebuild, never suppresses another frame', () => {
  assert.equal(typeof C.waterfrontConcertStageExcludesBuilding, 'function');
  assert.equal(C.waterfrontConcertStageExcludesBuilding(ROW, C.GEO), true, 'the built row is excluded for the built GEO');
  assert.equal(C.waterfrontConcertStageExcludesBuilding(ROW, { buildings: [] }), false, 'a different GEO is never suppressed');
  // rebuilding on an unsupported frame clears the success (exclusion + surface) from the prior build
  const realGeo = C.GEO;
  C.GEO = { buildings: [], frame: { detail: { x0: 0, x1: 1, z0: 0, z1: 1 } }, landmarks: {} };
  const again = C.createWaterfrontConcertStage(THREE, { add() {} });
  assert.equal(again, null);
  assert.equal(C.waterfrontConcertStageExcludesBuilding(ROW, C.GEO), false, 'cleared after an unsupported rebuild');
  const [sx, sz] = world(LAYOUT.deck.u0 + 1, LAYOUT.deck.v0 + 1);
  assert.equal(C.concertStageSurfaceAt(sx, sz, { baseY: 10 }), null, 'surface inactive after rebuild');
  C.GEO = realGeo;
});

test('the surface is bound to the built GEO: a stale/other frame reports no footing', () => {
  // rebuild on the real GEO (a prior test may have cleared the success / disabled the gate on an unsupported frame)
  C.waterfrontConcertStageEnabled = true;
  const fresh = C.createWaterfrontConcertStage(THREE, { add() {} });
  assert.ok(fresh && fresh.active);
  const [dx, dz] = world((LAYOUT.deck.u0 + LAYOUT.deck.u1) / 2, (LAYOUT.deck.v0 + LAYOUT.deck.v1) / 2);
  assert.ok(C.concertStageSurfaceAt(dx, dz, { baseY: LAYOUT.deck.lift }), 'active on the built GEO');
  const realGeo = C.GEO;
  C.GEO = { buildings: [], frame: { detail: { x0: 0, x1: 1, z0: 0, z1: 1 } } }; // a different frame, no rebuild
  assert.equal(C.concertStageSurfaceAt(dx, dz, { baseY: LAYOUT.deck.lift }), null, 'stale frame reports no footing');
  C.GEO = realGeo;
  assert.ok(C.concertStageSurfaceAt(dx, dz, { baseY: LAYOUT.deck.lift }), 'restored GEO works again');
});

test('a deterministic rebuild of the same GEO is a stable no-op: identical layout and counts', () => {
  const C2 = makeContext();
  const r2 = C2.createWaterfrontConcertStage(THREE, { add() {} });
  assert.ok(r2 && r2.active);
  assert.equal(r2.stats.seats, built.stats.seats);
  assert.equal(r2.stats.mastCount, built.stats.mastCount);
  assert.equal(r2.stats.triangles, built.stats.triangles);
  assert.equal(r2.stats.rowIndex, built.stats.rowIndex);
  assert.ok(Math.abs(r2.layout.deck.lift - LAYOUT.deck.lift) < 1e-9);
  assert.ok(Math.abs(r2.layout.ramp.run - LAYOUT.ramp.run) < 1e-9);
});

test('the frame guard skips the fixed-coordinate stage in an unrelated map frame', () => {
  const guard = makeContext();
  guard.GEO.frame.detail = { x0: 0, x1: 20, z0: 0, z1: 20 };
  const fake = { added: [], add(o) { this.added.push(o); } };
  assert.equal(guard.createWaterfrontConcertStage(THREE, fake), null);
  assert.equal(fake.added.length, 0);
  assert.equal(guard.waterfrontConcertStageEnabled, false);
});

test('unique, non-colliding export names and recorded sources', () => {
  const source = read('waterfront-concert-stage.js');
  for (const fn of ['concertStageRow', 'concertStageLayout', 'concertStageSurfaceAt', 'createWaterfrontConcertStage']) {
    assert.equal(typeof C[fn], 'function', `${fn} exported`);
  }
  // must not clobber the sibling modules' generic helper names via Object.assign
  for (const bad of ['footprintUnion', 'partWorldBox', 'rowToWorld', 'supportedCityFrame']) {
    assert.equal(source.includes(`${bad},`), false, `does not export the generic name ${bad}`);
  }
  for (const needle of ['blackwell.ca/portfolio/project/harbourfront-centre-stage',
    'castconnex.com/projects/harbourfront-centre-stage', 'Athos Zaghi', 'membrane']) {
    assert.ok(source.includes(needle), `records ${needle}`);
  }
  assert.equal(/Math\.random\s*\(/.test(source), false, 'no random placement');
});
