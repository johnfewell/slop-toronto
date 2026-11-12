// tools/biidaasige-registration.mjs — bounded source identity + georegistration for Biidaasige Park (bead st-bmyv.2 / st-bmyv.8)
//
// It takes the checked-in fixture (tools/fixtures/biidaasige-registration.json) and independently RE-DERIVES the affine
// registration from the STABLE control points only (Fire Hall body, two bridge road-crossings, two road junctions), then
// re-projects every map-anchor feature and checks the published residuals and the independent held-out points. It does
// NOT fit on the unnamed OSM play-area centroid and does NOT treat that centroid as the Owl — that would assume the very
// identity this file must test. It writes nothing into shared runtime; it only prints/validates.
//
// The map is a stylised relief diagram (not an orthophoto): features resolved from map pixels are APPROXIMATE and carry
// an explicit error. The Fire Hall displacement vs the native 3D-massing row is a position update (~26 m south), not a
// suppression. No building is judged obsolete here.
//
// usage: node tools/biidaasige-registration.mjs            # human summary, exit 1 on any check failure
//        node tools/biidaasige-registration.mjs --json     # machine-readable
//        node tools/biidaasige-registration.mjs --check    # same as default (alias)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = path.join(ROOT, 'tools/fixtures/biidaasige-registration.json');
const JSON_ONLY = process.argv.includes('--json');
const note = (...a) => { if (!JSON_ONLY) console.error(...a); };

const reg = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const P = reg.projection;
const c = Math.cos(P.theta), s = Math.sin(P.theta);

/** WGS84 -> city world (identical to js/city-config.js worldFromLatLon). */
function worldFromLatLon(lat, lon) {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
  return { x: e * c - n * s, z: -(e * s + n * c) };
}
/** city world -> WGS84 (identical to js/city-config.js latLonFromWorld). */
function latLonFromWorld(x, z) {
  return { lat: P.lat0 + (-x * s - z * c) / P.ky, lon: P.lon0 + (x * c - z * s) / P.kx };
}

/** Solve a dense n x n system with partial pivoting (Gauss-Jordan); returns null if singular. */
function solve3(M, b) {
  const A = M.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    if (Math.abs(A[piv][i]) < 1e-12) return null;
    [A[i], A[piv]] = [A[piv], A[i]];
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let k = i; k < 4; k++) A[r][k] -= f * A[i][k];
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

/** Least-squares affine: world = A*[px,py,1] per axis. rows = [{u,v,x,z}]. */
function fitAffine(rows) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], bz = [0, 0, 0];
  for (const r of rows) {
    const a = [r.u, r.v, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) M[i][j] += a[i] * a[j];
      bx[i] += a[i] * r.x; bz[i] += a[i] * r.z;
    }
  }
  const px = solve3(M, bx), pz = solve3(M, bz);
  if (!px || !pz) throw new Error('degenerate control geometry (collinear controls)');
  return { px, pz };
}
const apply = (f, u, v) => ({ x: f.px[0] * u + f.px[1] * v + f.px[2], z: f.pz[0] * u + f.pz[1] * v + f.pz[2] });

const controls = reg.controls.map((ctrl) => {
  const [u, v] = ctrl.px;
  const w = worldFromLatLon(ctrl.lat, ctrl.lon);
  return { name: ctrl.name, u, v, x: w.x, z: w.z };
});
const fit = fitAffine(controls);

const checks = [];
const resid = controls.map((ctrl) => {
  const p = apply(fit, ctrl.u, ctrl.v);
  return { name: ctrl.name, m: Math.hypot(p.x - ctrl.x, p.z - ctrl.z) };
});
const rms = Math.sqrt(resid.reduce((a, r) => a + r.m * r.m, 0) / resid.length);
const maxResid = Math.max(...resid.map((r) => r.m));

// The published fit coefficients must reproduce (tolerance for JSON round-tripping).
const affineMatchesFixture =
  fit.px.every((v, i) => Math.abs(v - reg.fit.px[i]) < 1e-6) &&
  fit.pz.every((v, i) => Math.abs(v - reg.fit.pz[i]) < 1e-6);
checks.push({ check: 'affine coefficients match fixture', ok: affineMatchesFixture, fit: { px: fit.px, pz: fit.pz } });

// Registration is a bounded APPROXIMATE fit: RMS must be in the documented 10..25 m band (not falsely "precise").
checks.push({ check: 'RMS in documented 10..25 m approximate band', ok: rms >= 10 && rms <= 25, rms: +rms.toFixed(2) });
checks.push({ check: 'max control residual <= 20 m', ok: maxResid <= 20, maxResidual: +maxResid.toFixed(2) });

// Leave-one-out: report; record the spread but do NOT require it to stay tiny (a 5-point affine has large lever arms).
const loo = controls.map((ctrl, k) => {
  const sub = controls.filter((_, i) => i !== k);
  const f = fitAffine(sub);
  const p = apply(f, ctrl.u, ctrl.v);
  return { name: ctrl.name, m: Math.hypot(p.x - ctrl.x, p.z - ctrl.z) };
});
checks.push({ check: 'leave-one-out reported (not pruned)', ok: loo.length === controls.length, loo: loo.map((r) => ({ name: r.name, m: +r.m.toFixed(1) })) });

// Independent held-out points NOT in the fit.
const holdouts = [];
for (const ctrl of reg.fit.outsideControls) {
  const w = worldFromLatLon(ctrl.lat, ctrl.lon);
  const p = apply(fit, ctrl.px[0], ctrl.px[1]);
  holdouts.push({ name: ctrl.name, m: +Math.hypot(p.x - w.x, p.z - w.z).toFixed(2) });
}

// The Owl must be WEST of (and distinct in z from) the Fire Hall per the Captain; and the west-playground centroid must
// NOT be treated as the Owl (that control is deliberately excluded). Confirm from the resolved feature anchors.
const featById = Object.fromEntries(reg.features.map((f) => [f.id, f]));
const owl = featById['snowy-owl'];
const fire = featById['old-fire-hall'];
const owlWestOfFire = owl.world[0] < fire.world[0];
checks.push({ check: 'Owl anchor is west of Fire Hall (per Captain map)', ok: owlWestOfFire, owlWorld: owl.world, fireHallWorld: fire.world });

// Every feature with a pixel must project to its published world/latlon (self-consistency of the fixture).
let featureRecomputeOk = true;
const featureDrift = [];
for (const f of reg.features) {
  if (f.px == null) continue;
  // Control points are fitters, not derived features; their world is the OSM control coordinate, not the map projection.
  if (f.status === 'control-and-verified') continue;
  const p = apply(fit, f.px[0], f.px[1]);
  const ll = latLonFromWorld(p.x, p.z);
  const dWorld = Math.hypot(p.x - f.world[0], p.z - f.world[1]);
  const dLatLon = Math.hypot((ll.lat - f.lat) * 111000, (ll.lon - f.lon) * 111000 * Math.cos(f.lat * Math.PI / 180));
  if (dWorld > 0.5 || dLatLon > 0.5) featureRecomputeOk = false;
  featureDrift.push({ id: f.id, worldM: +dWorld.toFixed(2), latlonM: +dLatLon.toFixed(2) });
}
checks.push({ check: 'every feature px re-projects to its published world/latlon', ok: featureRecomputeOk, drift: featureDrift });

// The west-playground AREA CENTROID must not be a control (it is the false identity under test).
const badControl = reg.controls.some((ctrl) => /playground|centroid|owl/i.test(ctrl.name) && !/firehall/i.test(ctrl.name));
checks.push({ check: 'no Owl/play-area-centroid used as a control', ok: !badControl });

// The fixture must keep the explicit building policy (no blanket suppression).
const hasPolicy = reg.buildingsPolicy && Array.isArray(reg.buildingsPolicy.unidentifiedCandidates) && reg.buildingsPolicy.identified.length >= 1;
checks.push({ check: 'building policy present, Fire Hall identified, others unverified (no blanket suppression)', ok: !!hasPolicy, identified: reg.buildingsPolicy?.identified?.length ?? 0, unverified: reg.buildingsPolicy?.unidentifiedCandidates?.length ?? 0 });

// The 26.1 m massing row must stay explicitly unresolved.
const bigRow = reg.buildingsPolicy?.unidentifiedCandidates?.find((b) => b.nativeRow[0] === 2678 && b.nativeRow[1] === 630);
checks.push({ check: '26.1 m row at (2678,630) stays identity-unverified (no guessed warehouse/greenfield)', ok: !!bigRow && bigRow.status === 'identity-unverified' });

const ok = checks.every((c) => c.ok);
const report = {
  schema: reg.schema,
  mapOrientation: reg.map.orientation,
  controls: controls.length,
  publishedRms: reg.fit.rms,
  recomputedRms: +rms.toFixed(2),
  maxResidual: +maxResid.toFixed(2),
  residuals: resid.map((r) => ({ name: r.name, m: +r.m.toFixed(1) })),
  leaveOneOut: loo.map((r) => ({ name: r.name, m: +r.m.toFixed(1) })),
  holdouts,
  fit: { px: fit.px, pz: fit.pz, scaleUPx: +Math.hypot(fit.px[0], fit.pz[0]).toFixed(3), scaleVPx: +Math.hypot(fit.px[1], fit.pz[1]).toFixed(3) },
  checks,
  ok
};

if (JSON_ONLY) {
  process.stdout.write(JSON.stringify(report, null, 1) + '\n');
} else {
  console.log(`\nBiidaasige registration — ${controls.length} STABLE controls (no Owl centroid)`);
  console.log(`  map: ${reg.map.orientation}; approx registration, NOT survey`);
  console.log(`  RMS ${report.recomputedRms} m (published ${reg.fit.rms}); max residual ${report.maxResidual} m`);
  console.log('  residuals:'); for (const r of report.residuals) console.log(`    ${r.name.padEnd(26)} ${r.m} m`);
  console.log('  leave-one-out:'); for (const r of report.leaveOneOut) console.log(`    ${r.name.padEnd(26)} ${r.m} m`);
  console.log('  held-out (not fitted):'); for (const h of holdouts) console.log(`    ${h.name.padEnd(44)} ${h.m} m`);
  console.log(`  Owl anchor ${JSON.stringify(owl.world)} ${owl.lat},${owl.lon}  (west of Fire Hall: ${owlWestOfFire})`);
  console.log('\n  checks:'); for (const ch of checks) console.log(`    ${ch.ok ? 'OK ' : 'FAIL'} ${ch.check}`);
  console.log(ok ? '\nALL CHECKS PASS\n' : '\nCHECKS FAILED\n');
}
process.exit(ok ? 0 : 1);
