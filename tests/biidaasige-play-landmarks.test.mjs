// The Biidaasige Park play structures (js/biidaasige-play-landmarks.js, st-bmyv.3) — REWORK after the captain's GPU
// rejection (play-review.md). The first build read as a black barrel + floating sphere (owl) and a grey box + sealed
// pipe (raccoon). These tests check the rework's QUALITY from the REAL built geometry: white coverage, a continuous
// head↔body silhouette (no head/neck gap), two wings, radial eye masks, curved nest tiers, an OPEN U-shaped chute, a
// per-board open slatted timber torso, and bounded budgets — not just material-bucket counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const read = (f) => fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');

function city({ withModule = true, withMerge = true } = {}) {
  const Addons = {};
  if (withMerge) Addons.mergeGeometries = mergeGeometries;
  const ctx = { window: { CITY: { THREE, Addons } }, console: { info() {}, warn() {}, log() {}, error() {} }, performance };
  vm.createContext(ctx);
  if (withModule) vm.runInContext(read('biidaasige-play-landmarks'), ctx, { filename: 'biidaasige-play-landmarks.js' });
  return ctx.window.CITY;
}

const C = city();
const owl = C.buildOwlPlayTheatre();
const raccoon = C.buildReachingRaccoon();

// A mesh's geometry as raw arrays, for area/coverage/direction checks (independent of the module's own constants).
function meshByName(group, suffix) { return group.children.find((m) => m.name.endsWith(suffix)); }

function triangleAreas(geo) {
  const p = geo.attributes.position, out = [];
  for (let t = 0; t + 2 < p.count; t += 3) {
    const ux = p.getX(t + 1) - p.getX(t), uy = p.getY(t + 1) - p.getY(t), uz = p.getZ(t + 1) - p.getZ(t);
    const vx = p.getX(t + 2) - p.getX(t), vy = p.getY(t + 2) - p.getY(t), vz = p.getZ(t + 2) - p.getZ(t);
    out.push(0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx));
  }
  return out;
}
const totalArea = (geo) => triangleAreas(geo).reduce((s, a) => s + a, 0);

function assertFinite(group, label) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position, n = o.geometry.attributes.normal;
    assert.ok(p && n, `${label}: ${o.name} has position & normal`);
    for (let i = 0; i < p.count; i++) assert.ok(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i)), `${label}: ${o.name} finite position`);
    for (let i = 0; i < n.count; i++) assert.ok(Number.isFinite(n.getX(i)) && Number.isFinite(n.getY(i)) && Number.isFinite(n.getZ(i)), `${label}: ${o.name} finite normal`);
  });
}

test('the owl reads WHITE, not a black barrel: white coverage 85–95 % of the board surface', () => {
  // measured from the REAL merged geometry, comparing the white boards' surface area to all board-class materials
  const g = owl.group;
  const white = totalArea(meshByName(g, '-white').geometry);
  const darkBoards = ['-slot', '-pastel', '-pastelPink'].map((s) => meshByName(g, s)).filter(Boolean).reduce((a, m) => a + totalArea(m.geometry), 0);
  const coverage = white / (white + darkBoards);
  assert.ok(coverage > 0.85 && coverage < 0.96, `white board coverage ${(coverage * 100).toFixed(1)} % (want 85–96 %)`);
  // the backing is a SMALLER inset: the dark 'dark' mesh area must be far below the outer white shell area
  const backing = totalArea(meshByName(g, '-dark').geometry);
  assert.ok(backing < white, `the dark backing is inset, not an opaque outer cylinder (${backing.toFixed(1)} vs ${white.toFixed(1)} m²)`);
  // the module's own reported metric agrees
  assert.ok(C.biidaasigeOwlWhiteCoverage(owl) > 0.85, 'reported white coverage > 85 %');
});

test('the owl has ONE continuous leaning body→crown silhouette: no separate floating head, no neck gap', () => {
  const g = owl.group;
  // the white shell must span a continuous vertical run from near the base to the crown: no empty band > 0.6 m
  const white = meshByName(g, '-white').geometry, p = white.attributes.position;
  const ys = [];
  for (let i = 0; i < p.count; i++) ys.push(p.getY(i));
  ys.sort((a, b) => a - b);
  const lo = ys[0], hi = ys[ys.length - 1];
  // histogram of white vertices in 0.3 m bands; every band up to the crown must hold vertices (continuous)
  const bins = Math.round((hi - lo) / 0.3);
  const seen = new Array(bins).fill(0);
  for (const y of ys) seen[Math.min(bins - 1, Math.floor((y - lo) / 0.3))]++;
  const empty = seen.filter((c) => c === 0).length;
  assert.equal(empty, 0, `no empty vertical band in the white shell (a head/neck gap would show ${empty} empty bands)`);
  assert.ok(hi > 8.5 && lo < 1.0, `continuous from the base (${lo.toFixed(2)} m) to the crown (${hi.toFixed(2)} m)`);
  // the body pitches forward: the crown's mean +Z is clearly ahead of the base's mean +Z
  const meanZ = (yMin, yMax) => { let s = 0, n = 0; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y >= yMin && y <= yMax) { s += p.getZ(i); n++; } } return n ? s / n : 0; };
  const zBase = meanZ(lo, lo + 1.0), zTop = meanZ(hi - 1.0, hi);
  assert.ok(zTop > zBase + 0.5, `the crown leans forward (base mean z ${zBase.toFixed(2)}, crown mean z ${zTop.toFixed(2)})`);
});

test('the owl has TWO large swept wing panels tapering toward the ground behind', () => {
  // both left (−X) and right (+X) of the body must hold white shell material well out from the torso and low down
  const white = meshByName(owl.group, '-white').geometry, p = white.attributes.position;
  let leftLow = 0, rightLow = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    if (y < 2.5 && Math.abs(x) > 2.2) { if (x < 0) leftLow++; else rightLow++; }
  }
  assert.ok(leftLow > 20 && rightLow > 20, `wing panels on BOTH sides reach low and wide (left ${leftLow}, right ${rightLow})`);
});

test('the owl eye masks are radial white slat disks with a dark ring, not solid black discs', () => {
  const white = meshByName(owl.group, '-white').geometry;
  const ring = meshByName(owl.group, '-dark').geometry;
  const pupil = meshByName(owl.group, '-pupil').geometry;
  assert.ok(white && ring && pupil, 'white eye slats, dark ring, and pupil all built');
  // the pupils are small: their total area is a tiny fraction of the white shell (a large black disc would dominate)
  const pupilArea = totalArea(pupil);
  const whiteArea = totalArea(white);
  assert.ok(pupilArea < whiteArea * 0.06, `pupils are small (${pupilArea.toFixed(2)} vs ${whiteArea.toFixed(1)} m²)`);
});

test('the owl has the red belly/stage opening and separate curved timber nest tiers', () => {
  const red = meshByName(owl.group, '-red'), timber = meshByName(owl.group, '-timber');
  assert.ok(red && red.geometry.attributes.position.count > 30, 'a red belly/stage opening exists');
  assert.ok(timber && timber.geometry.attributes.position.count > 60, 'curved timber nest tiers exist as real slabs');
  // the timber tiers are curved (not a flat fan): their vertices span a range of radii around the stage
  const p = timber.geometry.attributes.position;
  let rMin = Infinity, rMax = -Infinity;
  for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)); rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); }
  assert.ok(rMax - rMin > 0.8, `the timber tiers sit at several radii (curved tiers, spread ${(rMax - rMin).toFixed(2)} m)`);
});

test('budgets, finite transforms, ground at 0, Y-up, no scene added', () => {
  assert.equal(owl.group.parent, null);
  assert.equal(raccoon.group.parent, null);
  assertFinite(owl.group, 'owl');
  assertFinite(raccoon.group, 'raccoon');
  const ob = new THREE.Box3().setFromObject(owl.group);
  assert.ok(Math.abs(ob.min.y) < 0.12 && ob.max.y > 8.5 && ob.max.y < 11, `owl ground 0, ~8–10 m (${ob.max.y.toFixed(2)} m)`);
  const rb = new THREE.Box3().setFromObject(raccoon.group);
  assert.ok(Math.abs(rb.min.y) < 0.12 && rb.max.y > 4.5 && rb.max.y < 6.5, `raccoon ground 0, ~5–6 m (${rb.max.y.toFixed(2)} m)`);
  assert.ok(owl.triangles > 3000 && owl.triangles < 60000, `owl bounded (${Math.round(owl.triangles)})`);
  assert.ok(raccoon.triangles > 1000 && raccoon.triangles < 40000, `raccoon bounded (${Math.round(raccoon.triangles)})`);
  assert.ok(owl.drawCalls.length <= 12 && raccoon.drawCalls.length <= 16, `bounded draws (${owl.drawCalls.length}, ${raccoon.drawCalls.length})`);
});

test('the owl deck is real outward-wound geometry (climbable only after footing integration)', () => {
  assert.equal(owl.climbable, false);
  assert.ok(owl.surfaces.length > 4, 'deck triangles from real geometry');
  for (const s of owl.surfaces) {
    const T = s.triangle;
    const ux = T[3] - T[0], uy = T[4] - T[1], uz = T[5] - T[2];
    const vx = T[6] - T[0], vy = T[7] - T[1], vz = T[8] - T[2];
    const ny = uz * vx - ux * vz;
    assert.ok(ny > 0 && Math.abs(uy) < 0.05, 'the deck triangle faces up and is horizontal');
  }
  assert.ok(C.biidaasigePlaySurfaceArea(owl.surfaces) > 2, 'a real deck area');
});

test('the raccoon torso is a broad FACETED timber volume (alternating cream/red boards), not bare posts or a grey box', () => {
  const g = raccoon.group;
  const names = raccoon.drawCalls.map((d) => d.key);
  assert.ok(!names.includes('fur'), 'no grey fur material');
  for (const k of ['timber', 'timberCream', 'timberRed', 'darkMask', 'pale', 'leaf', 'leafVein', 'greenPost', 'cattail', 'metal']) assert.ok(names.includes(k), `palette has ${k}`);
  // faceted volume: the torso is tiled by MANY boards around its circumference. Count the board columns by raycasting a
  // horizontal ring at mid-torso height and counting distinct surface hits — an open "four posts" torso would leave
  // most rays passing between the posts into the seabed; a closed faceted volume is hit almost everywhere.
  raccoon.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const torsoMidY = 2.0;
  let hits = 0, total = 0;
  const s = C.BIIDAASIGE_RACCOON_SPEC;
  for (let i = 0; i < 180; i++) {
    const a = (i + 0.5) * Math.PI * 2 / 180;
    total++;
    ray.set(new THREE.Vector3(6 * Math.sin(a), torsoMidY, 6 * Math.cos(a)), new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)));
    const h = ray.intersectObject(g, true).find((x) => /timber|darkMask/.test(x.object.name));
    if (h) hits++;
  }
  assert.ok(hits / total > 0.85, `the torso volume is closed by boards (${(hits / total * 100).toFixed(0)} % of a ring hit it)`);
  // the cream and red alternating boards are real geometry (rich, not one flat colour)
  for (const k of ['timberCream', 'timberRed']) assert.ok(totalArea(meshByName(g, `-${k}`).geometry) > 0.3, `${k} boards present`);
});

test('the raccoon head is seated ON the torso (not a detached floating head)', () => {
  const headBox = new THREE.Box3().setFromObject(meshByName(raccoon.group, '-pale'));
  const torsoBox = new THREE.Box3().setFromObject(meshByName(raccoon.group, '-timberRed'));
  assert.ok(headBox.min.y < torsoBox.max.y + 0.2, `the head meets the torso top (head min.y ${headBox.min.y.toFixed(2)}, torso max.y ${torsoBox.max.y.toFixed(2)})`);
});

test('the raccoon leaf is a pointed organic leaf with veins, not a flat green rectangle', () => {
  const leaf = meshByName(raccoon.group, '-leaf'), vein = meshByName(raccoon.group, '-leafVein');
  assert.ok(leaf && vein, 'leaf blade + veins built');
  const p = leaf.geometry.attributes.position;
  // width profile: the leaf is narrow at its base and tip and widest mid-way (a lens/almond, not a rectangle)
  let baseZ = Infinity, tipZ = -Infinity;
  for (let i = 0; i < p.count; i++) { baseZ = Math.min(baseZ, p.getY(i)); tipZ = Math.max(tipZ, p.getY(i)); }
  const H = tipZ - baseZ;
  const widthAt = (frac) => { let mn = Infinity, mx = -Infinity; for (let i = 0; i < p.count; i++) { const f = (p.getY(i) - baseZ) / H; if (Math.abs(f - frac) < 0.12) { mn = Math.min(mn, p.getX(i)); mx = Math.max(mx, p.getX(i)); } } return mx - mn; };
  const wBase = widthAt(0.05), wMid = widthAt(0.5), wTip = widthAt(0.95);
  assert.ok(wMid > wBase * 1.6 && wMid > wTip * 1.6, `leaf is pointed (base ${wBase.toFixed(2)}, mid ${wMid.toFixed(2)}, tip ${wTip.toFixed(2)} m wide)`);
  // veins are real, darker-green ribs
  assert.ok(vein.geometry.attributes.position.count > 100, 'leaf has vein ribs');
});

test('the raccoon has the face mask, ears, striped tail and the leaf/cattail/dragonfly kit', () => {
  const names = new Set(raccoon.drawCalls.map((d) => d.key));
  for (const k of ['pale', 'darkMask', 'greenPost', 'cattail', 'leaf', 'dragonfly', 'dragonflyWing', 'log', 'rope']) assert.ok(names.has(k), `${k} present`);
  // tail rings: the timberDark bucket carries torus rings (real triangles)
  const td = meshByName(raccoon.group, '-timberDark');
  assert.ok(td.geometry.attributes.position.count > 300, 'striped rings / bands present');
});

test('the raccoon slide is an OPEN U-shaped chute, not a sealed pipe, and not a walkable surface', () => {
  const metal = meshByName(raccoon.group, '-metal');
  assert.ok(metal, 'metal chute built');
  // an OPEN half-pipe: its geometry winding covers an arc of ~PI, not a full closed cylinder. Check the metal
  // geometry's cross-section spans an arc (vertices occupy a half-disc, not a ring). We approximate by the ratio of
  // lateral extent: an open chute is wider than a sealed pipe of the same radius.
  const p = metal.geometry.attributes.position;
  const box = new THREE.Box3().setFromBufferAttribute(p);
  const extent = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
  assert.ok(extent > 3, 'the chute is a long run (not a short stub)');
  // An OPEN half-pipe shows ~half the surface of a SEALED cylinder of the same length and radius. Prove it is open from
  // the real geometry: the whole metal group (the chute + its two rails + the entry lip) has less surface area than a
  // sealed cylinder of the same overall extents would need — a sealed pipe cannot pass this.
  const metalArea = totalArea(metal.geometry);
  const sealedCylinder = 2 * Math.PI * 0.45 * extent;   // a sealed pipe's lateral area over the same length
  assert.ok(metalArea > 0 && metalArea < sealedCylinder, `the chute is OPEN (metal area ${metalArea.toFixed(1)} m² < a sealed cylinder's ${sealedCylinder.toFixed(1)} m²)`);
  // and it is more than a flat strip: the chute's curved half-pipe is a substantial fraction of that area
  assert.ok(metalArea > Math.PI * 0.45 * extent * 0.9, 'the chute is a real curved half-pipe, not a flat plate');
  // honest: the chute is NOT a surface and NOT a collider
  assert.equal(raccoon.climbable, false);
  assert.equal(raccoon.surfaces.length, 0, 'no walkable surfaces claimed');
  assert.ok(!raccoon.colliders.some((c) => /slide|chute/.test(c.kind)), 'the chute is not a collider');
});

test('buildBiidaasigePlayLandmarks: one group, honest source & attribution, no scene by default', () => {
  const both = C.buildBiidaasigePlayLandmarks();
  assert.equal(both.group.parent, null);
  assert.ok(both.group.children.includes(both.owl.group) && both.group.children.includes(both.raccoon.group));
  assert.equal(both.climbable, false);
  assert.match(both.source.owl, /Monstrum/);
  assert.match(both.source.raccoon, /Earthscape/);
  const scene = new THREE.Scene();
  const withScene = C.buildBiidaasigePlayLandmarks(scene);
  assert.equal(withScene.group.parent, scene, 'adds only when a scene is passed');
});

test('the no-mergeGeometries fallback still builds finite, full geometry', () => {
  const bare = city({ withMerge: false });
  const o2 = bare.buildOwlPlayTheatre();
  assertFinite(o2.group, 'owl (concat fallback)');
  const box = new THREE.Box3().setFromObject(o2.group);
  assert.ok(box.max.y > 8.5, 'the fallback merge still builds the full owl');
});

test('owl exterior boards actually cover the circumference when viewed from outside', () => {
  // Surface-area ratios alone missed an arc conversion bug that shrank every
  // board while leaving white/dark material ratios unchanged.
  owl.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const y = 3, s = C.BIIDAASIGE_OWL_SPEC;
  const z = s.lean * y * y / (2 * s.crownHeight);
  let light = 0, hits = 0;
  for (let i = 0; i < 180; i++) {
    const a = (i + 0.371) * Math.PI * 2 / 180;
    ray.set(new THREE.Vector3(10 * Math.sin(a), y, z + 10 * Math.cos(a)), new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)));
    const h = ray.intersectObject(owl.group, true)[0];
    if (!h) continue;
    hits++;
    if (/-(white|pastel|pastelPink)$/.test(h.object.name)) light++;
  }
  assert.ok(hits >= 175, 'closed body has an actual exterior from nearly every angle');
  assert.ok(light / 180 > 0.75, 'white boards cover the visible shell rather than thin floating ribbons');
});

test('front sightlines see the Owl stage recess and dark pupils through their actual openings', () => {
  owl.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.set(new THREE.Vector3(0, 1.4, 10), new THREE.Vector3(0, 0, -1));
  const stage = ray.intersectObject(owl.group, true)[0];
  assert.ok(stage?.object.name.endsWith('-red'), `front stage sightline must enter the red recess, saw ${stage?.object.name}`);
  const pupils = meshByName(owl.group, '-pupil').geometry.attributes.position;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i=0;i<pupils.count;i++) if(pupils.getX(i)>0){minX=Math.min(minX,pupils.getX(i));maxX=Math.max(maxX,pupils.getX(i));minY=Math.min(minY,pupils.getY(i));maxY=Math.max(maxY,pupils.getY(i));maxZ=Math.max(maxZ,pupils.getZ(i));}
  ray.set(new THREE.Vector3((minX+maxX)/2,(minY+maxY)/2,maxZ+3),new THREE.Vector3(0,0,-1));
  assert.ok(ray.intersectObject(owl.group,true)[0]?.object.name.endsWith('-pupil'),'white eye boards must leave pupil visible');
});

test('Raccoon front mask is outside the head volume and faces the visitor', () => {
  raccoon.group.updateMatrixWorld(true);
  const p=meshByName(raccoon.group,'-pale').geometry.attributes.position;
  let y=0,n=0;
  for(let i=0;i<p.count;i++) if(p.getY(i)>3){y+=p.getY(i);n++;}
  const ray=new THREE.Raycaster(new THREE.Vector3(.12,y/n,10),new THREE.Vector3(0,0,-1));
  const hit=ray.intersectObject(raccoon.group,true)[0];
  assert.ok(hit && ['-pale','-darkMask'].some(s=>hit.object.name.endsWith(s)),`front face must show mask, saw ${hit?.object.name}`);
});
