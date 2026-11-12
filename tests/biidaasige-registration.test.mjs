// tests/biidaasige-registration.test.mjs — honesty checks for the bounded source-identity/georegistration pass
// (bead st-bmyv.2 / st-bmyv.8, docs/biidaasige-registration.md). It asserts the fixture does NOT fit on the Owl/play-area
// centroid, that the map is treated as north-up approximate (not survey), that the Owl is a west-of-Fire-Hall candidate,
// that the Atlas Crane holdout is within tolerance, and that no building is blanket-suppressed. Pure CPU; no GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/biidaasige-registration.json'), 'utf8'));

test('map is north-up and explicitly a diagram (not an orthophoto)', () => {
  assert.match(reg.map.orientation, /NORTH-UP/);
  assert.equal(reg.map.isDiagram, true);
  assert.ok(reg.map.approxErrorNote, 'must carry an explicit approximate-error note');
});

test('controls are only stable identities (Fire Hall, bridges, junctions) — never the Owl or play-area centroid', () => {
  assert.equal(reg.controls.length, 5);
  const names = reg.controls.map((c) => c.name).join(' ').toLowerCase();
  assert.match(names, /firehall/);
  assert.match(names, /bridge/);
  assert.match(names, /jct|junction/);
  assert.doesNotMatch(names, /owl/);
  assert.doesNotMatch(names, /playground/);
  // The excluded list must name both the Owl graphic and the west-playground centroid.
  const excluded = reg.controlPolicy.excludedAsControl.map((e) => e.name).join(' ').toLowerCase();
  assert.match(excluded, /owl/);
  assert.match(excluded, /centroid|playground/);
});

test('fit is a bounded approximate registration: RMS 10..25 m, controls not pruned', () => {
  assert.ok(reg.fit.rms >= 10 && reg.fit.rms <= 25, `RMS ${reg.fit.rms} outside the approximate band`);
  assert.ok(reg.fit.maxResidual <= 20, `max residual ${reg.fit.maxResidual} too high`);
  assert.equal(reg.fit.leaveOneOut.length, reg.controls.length, 'leave-one-out must cover every control (no pruning)');
  assert.ok(reg.fit.leaveOneOut.some((r) => r.m > 25), 'LOO spread must be reported honestly, not hidden');
});

test('Atlas Crane is an independent held-out point within tolerance', () => {
  const atlas = reg.fit.outsideControls.find((c) => /atlas/i.test(c.name));
  assert.ok(atlas, 'Atlas Crane holdout required');
  assert.ok(atlas.holdoutErrorM <= 15, `Atlas holdout ${atlas.holdoutErrorM} m too large`);
});

test('Owl is a west-of-Fire-Hall map candidate with an explicit error, not a precise placement', () => {
  const owl = reg.features.find((f) => f.id === 'snowy-owl');
  const fire = reg.features.find((f) => f.id === 'old-fire-hall');
  assert.ok(owl && fire);
  assert.ok(owl.world[0] < fire.world[0], 'Owl anchor must be west of the Fire Hall');
  assert.ok(owl.approxErrorM >= 15, 'Owl anchor must carry an explicit approximate error');
  assert.notEqual(owl.positionConfidence, 'high');
  assert.equal(owl.occupancy, 'unverified-within-approx-anchor');
  // The Owl anchor must NOT equal the OSM west-playground centroid (the false identity under test).
  const witness = owl.witnessFalseControl;
  assert.ok(witness && witness.holdoutErrorM > 50, 'Owl must be distinct from the west-playground centroid');
});

test('Outdoor Fitness stays unplaced (no coordinate derived from a label)', () => {
  const fit = reg.features.find((f) => f.id === 'outdoor-fitness');
  assert.ok(fit);
  assert.equal(fit.lat, null);
  assert.equal(fit.lon, null);
  assert.equal(fit.status, 'unplaced');
});

test('every placed feature carries an approximate error and a pixel provenance', () => {
  for (const f of reg.features) {
    if (f.px == null) continue;
    assert.ok(Array.isArray(f.px) && f.px.length === 2, `${f.id} missing px`);
    assert.ok(f.pxBasis, `${f.id} missing pxBasis provenance`);
    if (f.status !== 'control-and-verified') {
      assert.ok(Number.isFinite(f.approxErrorM) && f.approxErrorM > 0, `${f.id} missing approxErrorM`);
    }
  }
});

test('building policy identifies only the Fire Hall and leaves others unverified (no blanket suppression)', () => {
  const ids = reg.buildingsPolicy.identified;
  assert.equal(ids.length, 1);
  assert.match(ids[0].identity, /Fire Hall/);
  assert.ok(reg.buildingsPolicy.unidentifiedCandidates.length >= 7);
  for (const b of reg.buildingsPolicy.unidentifiedCandidates) {
    if (b.nativeRow[0] === 2384 && b.nativeRow[1] === 622) assert.fail('Fire Hall row must not be in the unidentified list');
  }
  const big = reg.buildingsPolicy.unidentifiedCandidates.find((b) => b.nativeRow[0] === 2678 && b.nativeRow[1] === 630);
  assert.ok(big, '26.1 m row must be present');
  assert.equal(big.status, 'identity-unverified');
});

test('the registration tool passes its own checks', () => {
  // Import-safe: run the tool and assert exit 0.
  const out = execFileSync(process.execPath, [path.join(ROOT, 'tools/biidaasige-registration.mjs'), '--json'], { encoding: 'utf8' });
  const report = JSON.parse(out);
  assert.equal(report.ok, true);
});
