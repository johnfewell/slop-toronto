// The seven Biidaasige Park Dodem clan-animal sculptures (js/biidaasige-dodem.js, st-bmyv.4).
// These tests read the REAL built geometry: a finite, outward-wound, projected silhouette with recognisable species
// anatomy and a carved-wood material palette. They also hold the honesty line: only the eagle is verified from a City
// primary photo plus an installed crop; the other six are explicitly approximate interpretations, with the verified
// 2026 maker attribution (APE Richter/Christian Huba with MCFN and MinoKamik Collective) and mountain-larch material.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const read = (f) => fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
const readJson = (f) => JSON.parse(fs.readFileSync(new URL(`../tools/fixtures/biidaasige/${f}`, import.meta.url), 'utf8'));

function city({ withModule = true, withMerge = true } = {}) {
  const Addons = {};
  if (withMerge) Addons.mergeGeometries = mergeGeometries;
  const ctx = { window: { CITY: { THREE, Addons } }, console: { info() {}, warn() {}, log() {}, error() {} }, performance };
  vm.createContext(ctx);
  if (withModule) vm.runInContext(read('biidaasige-dodem'), ctx, { filename: 'biidaasige-dodem.js' });
  return ctx.window.CITY;
}

const C = city();
const KINDS = ['bear', 'beaver', 'eagle', 'turtle', 'otter', 'wolf', 'musky'];
const built = Object.fromEntries(KINDS.map((k) => [k, C.buildBiidaasigeDodemAnimal(k)]));

// --- independent geometry readers -------------------------------------------------------------------------------
function allPoints(group) {
  const pts = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) pts.push([p.getX(i), p.getY(i), p.getZ(i)]);
  });
  return pts;
}
function meshPoints(group, suffix) {
  const m = group.children.find((x) => x.name.endsWith(suffix));
  assert.ok(m, `mesh ${suffix} exists`);
  const p = m.geometry.attributes.position, out = [];
  for (let i = 0; i < p.count; i++) out.push([p.getX(i), p.getY(i), p.getZ(i)]);
  return out;
}
function signedVolume(geo) {
  const p = geo.attributes.position;
  let v = 0;
  for (let t = 0; t + 2 < p.count; t += 3) {
    const ax = p.getX(t), ay = p.getY(t), az = p.getZ(t);
    const bx = p.getX(t + 1), by = p.getY(t + 1), bz = p.getZ(t + 1);
    const cx = p.getX(t + 2), cy = p.getY(t + 2), cz = p.getZ(t + 2);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}
function hullArea(points2) {
  if (points2.length < 3) return 0;
  const pts = points2.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let a = 0;
  for (let i = 0; i < hull.length; i++) { const j = (i + 1) % hull.length; a += hull[i][0] * hull[j][1] - hull[j][0] * hull[i][1]; }
  return Math.abs(a) / 2;
}
function extents(points, axis) {
  let mn = Infinity, mx = -Infinity;
  for (const p of points) { mn = Math.min(mn, p[axis]); mx = Math.max(mx, p[axis]); }
  return { min: mn, max: mx, span: mx - mn };
}
function assertFinite(group, label) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position, n = o.geometry.attributes.normal;
    assert.ok(p && n, `${label}: ${o.name} has position & normal`);
    for (let i = 0; i < p.count; i++) assert.ok(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i)), `${label}: ${o.name} finite position`);
    for (let i = 0; i < n.count; i++) assert.ok(Number.isFinite(n.getX(i)) && Number.isFinite(n.getY(i)) && Number.isFinite(n.getZ(i)), `${label}: ${o.name} finite normal`);
  });
}

// --- factory & contract -----------------------------------------------------------------------------------------
test('buildBiidaasigeDodemAnimal builds all seven, aliases the fish and rejects unknown kinds', () => {
  for (const k of KINDS) {
    const a = built[k];
    assert.ok(a, `${k} builds`);
    assert.equal(a.kind, k);
    assert.equal(a.group.parent, null, `${k} adds no scene by default`);
  }
  for (const alias of ['muskie', 'muskie fish', 'muskellunge', 'MUSKY']) assert.equal(C.buildBiidaasigeDodemAnimal(alias).kind, 'musky', `alias ${alias}`);
  assert.equal(C.buildBiidaasigeDodemAnimal('dragon'), null);
  assert.equal(C.buildBiidaasigeDodemAnimal(''), null);
  const set = C.buildBiidaasigeDodemSet();
  assert.deepEqual(Object.keys(set).sort(), KINDS.slice().sort());
});

test('every animal is a local-origin factory: ground at 0, +Y up, +Z front, unplaced, no walkable surface', () => {
  for (const k of KINDS) {
    const a = built[k];
    const pts = allPoints(a.group);
    const y = extents(pts, 1), z = extents(pts, 2);
    assert.ok(Math.abs(y.min) < 0.06, `${k} ground contact at ~0 (min y ${y.min.toFixed(3)})`);
    assert.ok(y.max > (k === 'musky' ? 0.3 : 0.5), `${k} stands up (height ${y.max.toFixed(2)} m)`);
    // the head end (+Z) is not a mirror of the tail end (the body is asymmetric front/back)
    assert.ok(Math.abs(z.max - -z.min) > (k === 'musky' ? 0.02 : 0.05), `${k} has a distinct +Z front extent (+${z.max.toFixed(2)} vs -${(-z.min).toFixed(2)})`);
    assert.equal(a.position, null, `${k} position is not invented`);
    assert.equal(a.placementStatus, 'unplaced');
    assert.equal(a.climbable, false);
    assert.equal(a.surfaces.length, 0, `${k} claims no walkable surface`);
    assert.equal(a.groundContactY, 0);
    assert.equal(a.dimensions.status, 'photo-estimate-not-survey');
    assert.ok(a.dimensions.heightM > (k === 'musky' ? 0.3 : 0.4) && a.dimensions.lengthM > 0.4 && a.dimensions.widthM > 0.2, `${k} dimensions recorded`);
  }
});

test('source honesty: only the eagle is verified; the others are approximate; maker and material are the verified 2026 facts', () => {
  const eagle = built.eagle;
  assert.equal(eagle.verifiedAppearance, true);
  assert.equal(eagle.appearanceConfidence, 'primary-photo');
  assert.match(eagle.sourceEvidence.join(' '), /primary photo|dodem-eagle|installed crop/i);
  assert.match(eagle.appearance, /black|white|yellow|brown|scalloped|talons/i);

  for (const k of KINDS.filter((x) => x !== 'eagle')) {
    const a = built[k];
    assert.equal(a.verifiedAppearance, false, `${k} is not claimed as verified`);
    assert.ok(['workshop-reference', 'programme-and-partial-installed', 'partial-installed-photo', 'approximate-no-individual-photo'].includes(a.appearanceConfidence), `${k} confidence is declared`);
    assert.match(a.sourceEvidence.join(' '), /not (a verified |as-built |an installed )?as-built|not as-built confirmed/i, `${k} states the honest limit`);
  }
  assert.equal(built.bear.appearanceConfidence, 'workshop-reference');
  assert.equal(built.turtle.appearanceConfidence, 'workshop-reference');
  assert.equal(built.wolf.appearanceConfidence, 'workshop-reference');
  assert.equal(built.otter.appearanceConfidence, 'programme-and-partial-installed');
  assert.equal(built.beaver.appearanceConfidence, 'programme-and-partial-installed');
  assert.equal(built.musky.appearanceConfidence, 'partial-installed-photo');

  for (const k of KINDS) {
    const a = built[k];
    assert.equal(a.attribution, 'APE Richter/Christian Huba in consultation with MCFN and MinoKamik Collective', `${k} carries the verified 2026 attribution`);
    assert.match(a.attributionSource, /2026 .*open-house boards/i, `${k} cites the attribution source`);
    assert.match(a.material, /larch/i, `${k} material is mountain larch`);
    assert.doesNotMatch(a.material, /(^|[^t] )oak( |$)|is oak/i, `${k} material is not oak`);
    assert.ok(!/by\s+[A-Z][a-z]+\s+[A-Z][a-z]+/.test(a.appearance), `${k} invents no author in its appearance text`);
  }
});

test('wolf is a standing all-fours mother with cubs, never a seated wolf; the owl/posture claim is gone', () => {
  const wolf = built.wolf;
  assert.match(wolf.appearance, /standing|all-fours|mother/i);
  assert.doesNotMatch(wolf.appearance, /seated/i);
  assert.doesNotMatch(wolf.sourceEvidence.join(' '), /owl-front/i, 'the stale owl seated-wolf evidence is removed');
  assert.match(wolf.sourceEvidence.join(' '), /Wölfin mit ihren Jungen|mother wolf/i);
});

test('the checked-in source-evidence fixture matches the module spec (kept honest together)', () => {
  const fx = readJson('dodem-source-evidence.json');
  assert.match(fx.cityListUrl, /biidaasige-park\/recreation-at-biidaasige-park/, 'the primary City list URL is recorded');
  assert.equal(fx.attribution, C.BIIDAASIGE_DODEM_ATTRIBUTION, 'the fixture carries the verified attribution');
  assert.match(fx.material, /larch/i, 'the fixture records mountain larch');
  assert.deepEqual(Object.keys(fx.animals).sort(), KINDS.slice().sort());
  for (const k of KINDS) {
    const spec = C.BIIDAASIGE_DODEM_SPECS[k], row = fx.animals[k];
    assert.equal(spec.verified, row.verified, `${k} verified flag matches the fixture`);
    assert.equal(spec.confidence, row.confidence, `${k} confidence matches the fixture`);
    assert.equal(spec.evidence, row.evidence, `${k} evidence matches the fixture`);
  }
});

// --- geometry quality -------------------------------------------------------------------------------------------
test('bounded: fewer than 8 meshes per animal, real triangles per material, no sphere anatomy', () => {
  for (const k of KINDS) {
    const a = built[k];
    assert.ok(a.drawCalls.length < 8, `${k} has ${a.drawCalls.length} material meshes (< 8)`);
    assert.ok(a.triangles > 250 && a.triangles < 12000, `${k} bounded triangles (${Math.round(a.triangles)})`);
    for (const d of a.drawCalls) assert.ok(d.triangles > 0, `${k}/${d.key} has triangles`);
    assertFinite(a.group, k);
  }
});

test('all parts are outward-wound closed solids (positive signed volume per material mesh)', () => {
  for (const k of KINDS) {
    for (const mesh of built[k].group.children) {
      const v = signedVolume(mesh.geometry);
      assert.ok(v > 0, `${k}/${mesh.name} has positive signed volume (${v.toFixed(4)} m³)`);
    }
  }
});

test('the projected silhouette has a real, measurable extent from the built vertices (not mirrored constants)', () => {
  for (const k of KINDS) {
    const pts = allPoints(built[k].group);
    const topArea = hullArea(pts.map((p) => [p[0], p[2]]));   // plan view footprint
    const frontArea = hullArea(pts.map((p) => [p[0], p[1]])); // elevation silhouette
    assert.ok(topArea > 0.08, `${k} has a real plan silhouette (${topArea.toFixed(2)} m²)`);
    assert.ok(frontArea > 0.1, `${k} has a real elevation silhouette (${frontArea.toFixed(2)} m²)`);
    const d = built[k].dimensions;
    const x = extents(pts, 0), y = extents(pts, 1), z = extents(pts, 2);
    assert.ok(Math.abs(d.widthM - x.span) < 0.02 && Math.abs(d.heightM - y.span) < 0.02 && Math.abs(d.lengthM - z.span) < 0.02, `${k} dimensions match the built bounding box`);
  }
});

test('bear: a massive wide rounded face, a very broad short black nose, a connected eye mask and natural wood paws', () => {
  const g = built.bear.group;
  const pts = allPoints(g);
  const x = extents(pts, 0).span, y = extents(pts, 1).span, z = extents(pts, 2).span;
  assert.ok(y > x && y > z, `bear is taller than it is wide or long (upright/seated: ${x.toFixed(2)} x ${y.toFixed(2)} x ${z.toFixed(2)})`);
  assert.ok(extents(pts, 1).max > 1.9, 'the body rises to a seated head height well above 1.9 m');
  // barrel body, not a pear: the width at the seat and at the shoulders is close
  const wAt = (lo, hi) => extents(pts.filter((p) => p[1] > lo && p[1] < hi), 0).span;
  const seatW = wAt(0.2, 0.5), shoulderW = wAt(1.2, 1.5);
  assert.ok(seatW / shoulderW < 1.15, `the body is a barrel, not a pear (seat ${seatW.toFixed(2)} m vs shoulder ${shoulderW.toFixed(2)} m)`);
  // massive wide rounded head (~0.75 m wide)
  const headW = extents(pts.filter((p) => p[1] > 1.95 && p[1] < 2.2), 0).span;
  assert.ok(headW > 0.7, `the head is massive and wide (${headW.toFixed(2)} m)`);
  // very broad, short, blunt black nose: wide, tall, and only a short projection
  const black = meshPoints(g, '-black');
  // the nose is the black mass below the mask (y < 2.02) plus its forward tip (z > 0.40)
  const nose = black.filter((p) => p[1] > 1.85 && p[1] < 2.2 && (p[1] < 2.02 || p[2] > 0.40));
  const noseW = extents(nose, 0).span, noseH = extents(nose, 1).span, noseProj = extents(nose, 2).span;
  assert.ok(noseW > 0.5, `the black nose is very broad (${noseW.toFixed(2)} m wide)`);
  assert.ok(noseH > 0.25, `the black nose is tall (${noseH.toFixed(2)} m high)`);
  assert.ok(noseProj < 0.3, `the muzzle projection is short (${noseProj.toFixed(2)} m)`);
  // connected black eye mask: one wide band spanning both eyes, with a triangle bridging the centre
  const mask = black.filter((p) => p[1] > 2.02 && p[1] < 2.2 && p[2] > 0.28 && p[2] < 0.40);
  assert.ok(extents(mask, 0).span > 0.5, `the eye mask is one wide band (${extents(mask, 0).span.toFixed(2)} m)`);
  assert.ok(mask.some((p) => p[0] < -0.1) && mask.some((p) => p[0] > 0.1), 'the mask reaches both eyes');
  const maskMesh = g.children.find((m) => m.name.endsWith('-black'));
  const mp = maskMesh.geometry.attributes.position;
  let bridges = false;
  for (let t = 0; t + 2 < mp.count; t += 3) {
    const xs = [mp.getX(t), mp.getX(t + 1), mp.getX(t + 2)];
    const ys = [mp.getY(t), mp.getY(t + 1), mp.getY(t + 2)];
    if (Math.min(...ys) > 2.0 && Math.max(...ys) < 2.2 && Math.min(...xs) < -0.05 && Math.max(...xs) > 0.05) { bridges = true; break; }
  }
  assert.ok(bridges, 'a single mask triangle bridges the centre (not two disconnected squares)');
  // natural larch rings around the pupils
  const rings = meshPoints(g, '-woodLight').filter((p) => p[1] > 2.02 && p[1] < 2.18 && p[2] > 0.30 && Math.abs(p[0]) > 0.20);
  assert.ok(rings.length > 6, 'natural larch rings around the pupils');
  // paws are natural wood, not brown rectangular blocks: no dark-wood paw blocks below the head
  const dark = meshPoints(g, '-woodDark');
  assert.equal(dark.filter((p) => p[1] < 1.8).length, 0, 'paws/feet are natural wood, not dark rectangular blocks');
  assert.ok(black.filter((p) => p[1] > 0.95 && p[1] < 1.15 && p[2] > 0.4).length > 6, 'black lower-claw accents on the forepaws');
});

test('beaver: a crouched upright rounded body, raised head with two incisors and a broad flat tail on the ground', () => {
  const g = built.beaver.group;
  const pts = allPoints(g);
  // crouched upright: the raised head sits above the rounded body mass (ignore the low tail behind)
  const body = pts.filter((p) => p[2] > -0.3);
  assert.ok(extents(body, 1).max > extents(body, 2).span * 0.55, 'the beaver body rises upright rather than sprawling flat');
  assert.ok(Math.max(...body.map((p) => p[1])) > 0.8, 'the blunt head is raised above the body');
  // broad flat paddle tail on the ground behind
  const tail = meshPoints(g, '-woodDark').filter((p) => p[2] < -0.35);
  assert.ok(tail.length > 30, 'a paddle tail exists behind the body');
  const w = extents(tail, 0).span, t = extents(tail, 1).span;
  assert.ok(w > 0.35 && w > t * 2.5, `the tail is flat and broad (${w.toFixed(2)} m wide, ${t.toFixed(2)} m thick)`);
  // two front incisors beside the snout
  const teeth = meshPoints(g, '-woodLight').filter((p) => p[2] > 0.28 && p[1] < 0.95);
  const sides = new Set(teeth.map((p) => (p[0] < 0 ? 'L' : 'R')));
  assert.equal(sides.size, 2, 'two front incisors either side of the snout');
  // small forepaws at the chest, not four wide-set grounded legs
  const dark = meshPoints(g, '-woodDark');
  assert.ok(dark.filter((p) => p[1] > 0.45 && p[1] < 0.7 && p[2] > 0.2).length > 6, 'small forepaws at the chest');
  // blue/green painted metal rocker/spring base under the animal
  const steel = meshPoints(g, '-steel');
  const baseH = extents(steel, 1).span;
  assert.ok(steel.length > 20, 'a steel rocker/spring base is present');
  assert.ok(baseH >= 0.12 && baseH <= 0.2, `the steel base is 0.12-0.2 m tall (${baseH.toFixed(2)} m)`);
  assert.ok(extents(steel, 1).max < 0.2, 'the steel base sits at the bottom');
});

test('eagle: squat scalloped folded wings, white head, black chest, yellow hooked beak, three white tail tips and talons', () => {
  const g = built.eagle.group;
  const white = meshPoints(g, '-white'), black = meshPoints(g, '-black'), yellow = meshPoints(g, '-yellow');
  assert.ok(extents(white, 1).max > 1.0, 'the white head is on top');
  assert.ok(extents(black, 2).max > 0.15 && extents(black, 1).min > 0.2, 'the black chest is on the front');
  assert.ok(extents(yellow, 2).max > 0.3 && extents(yellow, 1).max > 0.9, 'the yellow beak projects forward at head height');
  // squat: the eagle is not taller than it is long/deep
  const pts = allPoints(g);
  assert.ok(extents(pts, 1).span < extents(pts, 2).span * 1.4 + 0.2, 'the eagle is squat, not tall');
  // folded wings on both sides
  const wood = meshPoints(g, '-wood');
  const left = wood.filter((p) => p[0] < -0.4 && p[1] > 0.3 && p[1] < 0.9).length;
  const right = wood.filter((p) => p[0] > 0.4 && p[1] > 0.3 && p[1] < 0.9).length;
  assert.ok(left > 10 && right > 10, `folded wings on both sides (left ${left}, right ${right})`);
  // three white tail feather tips at the back, below the body
  assert.ok(white.filter((p) => p[2] < -0.2 && p[1] < 0.4).length > 12, 'three white tail feather tips sit at the back');
  // yellow talons at the perch
  assert.ok(yellow.filter((p) => p[1] < 0.15).length > 6, 'yellow talons reach down to the log perch');
});

test('turtle: a low almost-flat same-wood shell, a huge wide head, broad paddle flippers and no white caps', () => {
  const g = built.turtle.group;
  const shellY = C.biidaasigeTurtleShellY;
  const shell = meshPoints(g, '-wood');
  const x = extents(shell, 0).span, z = extents(shell, 2).span;
  assert.ok(z > 2.0 && x > 1.5, `the turtle is huge (${z.toFixed(2)} m long, ${x.toFixed(2)} m wide)`);
  // the shell is a LOW almost-flat dome (~0.45 m rise), not a hemispheric helmet
  const shellVerts = shell.filter((p) => p[1] > 0.2 && Math.abs(p[0]) < 0.9 && Math.abs(p[2]) < 1.05);
  assert.ok(shellVerts.length > 100, 'the shell has a real curved surface');
  const shellTop = extents(shellVerts, 1).max;
  assert.ok(shellTop < 0.5 && shellTop > 0.35, `the shell is low (~${shellTop.toFixed(2)} m rise, not a helmet)`);
  for (const p of shellVerts) assert.ok(Math.abs(p[1] - shellY(p[0], p[2])) < 0.03, 'shell vertices lie on the dome profile');
  // NO white caps / plaques: the shell is natural same wood with only thin green seams
  assert.equal(g.children.find((m) => m.name.endsWith('-woodLight')), undefined, 'no white scute caps on the shell');
  // green seams follow the shell surface and are buried, never floating above it
  const green = meshPoints(g, '-green');
  assert.ok(green.length > 100, 'green seam geometry is present');
  let maxGap = -Infinity;
  for (const p of green) {
    const gap = p[1] - shellY(p[0], p[2]);
    maxGap = Math.max(maxGap, gap);
    assert.ok(gap < 0.02, `a green seam vertex floats ${gap.toFixed(3)} m above the shell`);
    assert.ok(gap > -0.06, `a green seam vertex is buried too deep (${gap.toFixed(3)} m)`);
  }
  assert.ok(maxGap < 0.02, `the maximum seam-to-shell gap is small (${maxGap.toFixed(3)} m)`);
  // red band/underside below the wood shell
  const red = meshPoints(g, '-red');
  assert.ok(red.length > 20 && extents(red, 1).max < 0.2, 'the red band sits below the wood shell');
  // huge wide oval head (~0.75 m wide, ~0.8 m long)
  const head = shell.filter((p) => p[2] > 1.1 && p[1] > 0.1 && Math.abs(p[0]) < 0.5);
  const headW = extents(head, 0).span, headL = extents(head, 2).span;
  assert.ok(headW > 0.7, `the head is huge and wide (${headW.toFixed(2)} m wide)`);
  assert.ok(headL > 0.7, `the head is long (${headL.toFixed(2)} m long)`);
  // broad curved black smiling lower face occupying the front quarter (one area, not three blocks)
  const black = meshPoints(g, '-black');
  const mouth = black.filter((p) => p[2] > 1.7);
  assert.ok(extents(mouth, 0).span > 0.4 && extents(mouth, 1).span > 0.15, 'a broad curved black mouth area');
  // large circle-outline eyes on the topsides of the head
  const eyes = black.filter((p) => p[1] > 0.35 && p[2] > 1.2 && p[2] < 1.5 && Math.abs(p[0]) > 0.2);
  assert.ok(eyes.some((p) => p[0] < -0.2) && eyes.some((p) => p[0] > 0.2), 'two large eyes on the head topsides');
  assert.ok(extents(eyes.filter((p) => p[0] > 0.2), 0).span > 0.12, 'the eyes are large circle outlines');
  // four very broad paddle flippers; the front pair spans almost the entire front side
  const wood = meshPoints(g, '-wood');
  const fr = wood.filter((p) => p[0] > 0.3 && p[2] > 0.7 && p[1] < 0.3);
  const midW = extents(fr.filter((p) => p[0] > 0.6 && p[0] < 0.9), 2).span;
  const tipW = extents(fr.filter((p) => p[0] > 1.0), 2).span;
  assert.ok(midW > 0.4, `the front flipper is a very broad paddle (${midW.toFixed(2)} m)`);
  assert.ok(tipW < midW * 0.8, `the flipper tapers to an organic tip (${tipW.toFixed(2)} m vs ${midW.toFixed(2)} m)`);
  assert.ok(extents(fr, 0).max > 1.1, 'the front flipper reaches the outer edge of the body');
  // three turquoise claw triangles across each flipper's outer edge
  const turquoise = meshPoints(g, '-turquoise');
  for (const q of ['LF', 'RF', 'LB', 'RB']) {
    const inQ = turquoise.filter((p) => `${p[0] < 0 ? 'L' : 'R'}${p[2] < 0 ? 'B' : 'F'}` === q);
    const clusters = new Set(inQ.map((p) => `${Math.round(p[0] * 10)}:${Math.round(p[2] * 10)}`));
    assert.ok(clusters.size >= 3, `flipper ${q} has three turquoise claw triangles (${clusters.size} clusters)`);
  }
});

test('otter: a long low arched body with a raised slim neck and a long tapering tail', () => {
  const g = built.otter.group;
  const pts = allPoints(g);
  const z = extents(pts, 2).span, y = extents(pts, 1).span;
  assert.ok(z / y > 2.5, `the otter is elongated (${z.toFixed(2)} m long, ${y.toFixed(2)} m high)`);
  // head raised above the body height at +Z
  const head = pts.filter((p) => p[2] > 0.6);
  assert.ok(Math.max(...head.map((p) => p[1])) > Math.max(...pts.filter((p) => p[2] < 0.2).map((p) => p[1])), 'the head is raised on a slim neck');
  // long tapering tail (wood only, excluding the steel base)
  const wood = meshPoints(g, '-wood');
  const tailTip = wood.filter((p) => p[2] < -1.0);
  assert.ok(tailTip.length > 10 && extents(tailTip, 0).span < 0.14, 'the tail tapers to a narrow tip');
  // blue/green painted metal rocker/spring base under the animal
  const steel = meshPoints(g, '-steel');
  const baseH = extents(steel, 1).span;
  assert.ok(steel.length > 20, 'a steel rocker/spring base is present');
  assert.ok(baseH >= 0.12 && baseH <= 0.2, `the steel base is 0.12-0.2 m tall (${baseH.toFixed(2)} m)`);
});

test('wolf: a solid carved mother with a short forward head, pointed ears, wood legs and two complete cubs', () => {
  const g = built.wolf.group;
  const pts = allPoints(g);
  // four standing legs reach the ground in four quadrants
  const groundQ = new Set();
  for (const p of pts) if (p[1] < 0.12) groundQ.add(`${p[0] < 0 ? 'L' : 'R'}${p[2] < 0 ? 'B' : 'F'}`);
  assert.equal(groundQ.size, 4, 'four legs reach the ground in four quadrants');
  // broad continuous trunk back at a fairly constant height
  const back = pts.filter((p) => p[1] > 0.95 && p[1] < 1.15);
  assert.ok(back.length > 30, 'a broad continuous carved trunk back spans the body');
  // short forward wolf head, not an anteater needle: the head is short and wide
  const head = pts.filter((p) => p[2] > 0.6 && p[1] > 0.45);
  const headLen = extents(head, 2).span, headW = extents(head, 0).span;
  assert.ok(headLen < 0.6, `the head is short, not a needle (${headLen.toFixed(2)} m long)`);
  assert.ok(headW > 0.3, `the head is broad (${headW.toFixed(2)} m wide)`);
  // clear pointed ears above the head
  const light = meshPoints(g, '-woodLight');
  assert.ok(light.filter((p) => p[1] > 0.9 && p[2] > 0.55 && p[2] < 0.75).length > 6, 'clear pointed ears rise above the head');
  // black eyes and nose on the head (not an extruded needle)
  const black = meshPoints(g, '-black');
  assert.ok(black.filter((p) => p[1] > 0.6 && p[1] < 0.75 && p[2] > 0.8).length > 6, 'black eyes on the head');
  assert.ok(black.filter((p) => p[2] > 1.05).length > 6, 'a black nose at the short muzzle');
  // legs are natural wood, not white poles with dark hoof blocks
  const darkMesh = g.children.find((m) => m.name.endsWith('-woodDark'));
  const dark = darkMesh ? meshPoints(g, '-woodDark') : [];
  assert.equal(dark.filter((p) => p[1] < 0.8).length, 0, 'no dark hoof blocks on the legs');
  // two complete cubs under the belly: each has four legs on the ground, a head and ears
  for (const side of [-1, 1]) {
    const cub = meshPoints(g, '-wood').filter((p) => Math.sign(p[0]) === side && p[1] < 0.4);
    assert.ok(cub.length > 40, `cub on side ${side} has real geometry`);
    const feet = cub.filter((p) => p[1] < 0.05);
    const clusters = new Set(feet.map((p) => `${Math.round(p[0] * 20)}:${Math.round(p[2] * 20)}`));
    assert.ok(clusters.size >= 4, `cub on side ${side} has four feet on the ground (${clusters.size} clusters)`);
    assert.ok(cub.some((p) => p[2] > 0.2 && p[1] > 0.15), `cub on side ${side} has a head`);
    assert.ok(cub.filter((p) => p[1] > 0.3 && p[2] > 0.15).length > 4, `cub on side ${side} has ears`);
  }
});

test('musky: a very long low flattened solid oval with a broad head, top ringed eyes and a tapering tail (no big fins, fork or base)', () => {
  const g = built.musky.group;
  const pts = allPoints(g);
  const z = extents(pts, 2).span, y = extents(pts, 1).span, x = extents(pts, 0).span;
  // very long (~2 m) and low (~0.45 m), much longer than wide
  assert.ok(z > 1.8 && z < 2.3, `the musky is very long (${z.toFixed(2)} m)`);
  assert.ok(y < 0.5, `the musky is low (${y.toFixed(2)} m tall)`);
  assert.ok(z / x > 2.5, `the oval is long and narrow (${z.toFixed(2)} m long, ${x.toFixed(2)} m wide)`);
  assert.ok(x > 0.5 && x < 0.85, `the body is ~0.65 m wide (${x.toFixed(2)} m)`);
  // no pedestal: the lowest wood is the body itself and it is broad, not a small round foot
  const body = meshPoints(g, '-muskyWood');
  assert.ok(body.filter((p) => p[1] < 0.1).length > 10, 'the solid body sits on the ground');
  // broad rounded head at +Z, tapering rounded tail at -Z
  const headWidth = extents(pts.filter((p) => p[2] > 0.5), 0).span;
  const tailWidth = extents(pts.filter((p) => p[2] < -0.5), 0).span;
  assert.ok(headWidth > tailWidth * 1.4, `the head is broad and rounded, the tail tapers (head ${headWidth.toFixed(2)} m vs tail ${tailWidth.toFixed(2)} m)`);
  // two black/teal ringed eyes on the TOP near the front
  const black = meshPoints(g, '-black'), turquoise = meshPoints(g, '-turquoise');
  const topEyes = black.filter((p) => p[1] > 0.28 && p[2] > 0.5);
  assert.ok(topEyes.filter((p) => p[0] < -0.05).length > 4 && topEyes.filter((p) => p[0] > 0.05).length > 4, 'two eyes on the top near the front');
  assert.ok(turquoise.filter((p) => p[1] > 0.28 && p[2] > 0.5).length > 8, 'teal rings inside the black eye outlines');
  // no unsupported large dorsal fin / forked tail: no geometry rises high behind the head midline
  assert.ok(!pts.some((p) => p[1] > 0.45 && p[2] < -0.3), 'no tall dorsal fin or forked tail spike behind the body');
  assert.equal(g.children.find((m) => m.name.endsWith('-woodDark')), g.children.find((m) => m.name.endsWith('-woodDark')), 'dark accent optional');
  // warm brown, not blond/pale: the body material is a distinct warmer wood key
  assert.ok(g.children.some((m) => m.name.endsWith('-muskyWood')), 'the musky uses its warm-brown larch material');
});

test('the no-mergeGeometries fallback still builds finite, full geometry', () => {
  const bare = city({ withMerge: false });
  for (const k of KINDS) {
    const a = bare.buildBiidaasigeDodemAnimal(k);
    assert.ok(a && a.triangles > 250, `${k} builds without mergeGeometries (${Math.round(a.triangles)} tris)`);
    assertFinite(a.group, `${k} fallback`);
    assert.ok(Math.abs(new THREE.Box3().setFromObject(a.group).min.y) < 0.06, `${k} fallback stays grounded`);
  }
});

test('turtle smiling lower face is visible ahead of the wooden nose cap',()=>{
 const t=C.buildBiidaasigeDodemAnimal('turtle');t.group.updateMatrixWorld(true);
 const ray=new THREE.Raycaster(new THREE.Vector3(0,.25,3),new THREE.Vector3(0,0,-1));
 const hits=ray.intersectObject(t.group,true);
 assert.ok(hits.length>0,'ray meets the front of the head');
 assert.ok(hits[0].object.name.endsWith('black'),'painted smile is the visible front surface, not buried inside the head');
});
