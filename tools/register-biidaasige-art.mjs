// tools/register-biidaasige-art.mjs
// Bounded registration of the official Lassonde Art Trail Fall 2026 map (rendered 1800x1273 PNG)
// onto the city world frame, using Captain-read control pixels matched BY NAME to the verified
// WGS84 controls in tools/fixtures/biidaasige-registration.json.
//
//   node tools/register-biidaasige-art.mjs
//
// Primary fit: 5 controls (the original 4 + the Commissioners Street Bridge road-crossing centre).
// Comparison: the original 4-control fit is retained unchanged.
// Holdout:    Atlas Crane [458,553] is never used in either fit.
//
// Reads (read-only):
//   tools/fixtures/biidaasige-registration.json        verified control lat/lon by name
//   tools/fixtures/biidaasige-placekeeping-source.json  art label anchors (PDF points)
//   tools/fixtures/biidaasige/osm-verified.json         Atlas Crane actual OSM point (holdout)
//   js/toronto-geodata.js                               city projection (same as js/city-config.js)
//
// Writes:
//   tools/fixtures/biidaasige-art-registration.json
//
// The map is a stylised illustration, not an orthophoto and not a geographic datum. The affine
// is a 2D map-pixel -> world-metre fit, not a WGS84 datum transform. No feature is snapped.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const geodata = (() => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(read('js/toronto-geodata.js'), context);
  return context.window.CITY.GEO.frame.projection;
})();

const worldFromLatLon = (lat, lon) => {
  const e = (lon - geodata.lon0) * geodata.kx;
  const n = (lat - geodata.lat0) * geodata.ky;
  const c = Math.cos(geodata.theta), s = Math.sin(geodata.theta);
  return [e * c - n * s - geodata.ox, -(e * s + n * c) - geodata.oz];
};
const latLonFromWorld = (x, z) => {
  const u = x + geodata.ox, v = z + geodata.oz;
  const c = Math.cos(geodata.theta), s = Math.sin(geodata.theta);
  return [geodata.lat0 + (-u * s - v * c) / geodata.ky, geodata.lon0 + (u * c - v * s) / geodata.kx];
};

const registration = readJson('tools/fixtures/biidaasige-registration.json');
const source = readJson('tools/fixtures/biidaasige-placekeeping-source.json');
const osm = readJson('tools/fixtures/biidaasige/osm-verified.json');

const controlByName = Object.fromEntries(registration.controls.map((c) => [c.name, c]));

// Captain-read pixels on the rendered 1800x1273 Fall 2026 PNG, matched by name.
const ORIGINAL_4 = [
  { name: 'firehall_body', px: [1015, 484] },
  { name: 'cherry_south_bridge', px: [655, 620] },
  { name: 'cherry_commissioners_jct', px: [616, 451] },
  { name: 'polson_cherry_jct', px: [766, 824] },
];
// Fifth control: combined ROAD crossing centre of the paired Commissioners arches (not one arch head).
const COMMISSIONERS = { name: 'commissioners_bridge', px: [1507, 445] };

const buildControls = (list) =>
  list.map(({ name, px }) => {
    const c = controlByName[name];
    if (!c) throw new Error(`control ${name} not found in biidaasige-registration.json`);
    return {
      name,
      renderedPx: px,
      lat: c.lat,
      lon: c.lon,
      world: worldFromLatLon(c.lat, c.lon),
      osmRef: c.osmRef,
      kind: c.kind,
    };
  });

const controls4 = buildControls(ORIGINAL_4);
const controls5 = buildControls([...ORIGINAL_4, COMMISSIONERS]);

// Least-squares affine: world = A * [px, py, 1], separate coefficients per axis.
function fitAffine(rows) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const bx = [0, 0, 0], bz = [0, 0, 0];
  for (const r of rows) {
    const v = [r.renderedPx[0], r.renderedPx[1], 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) M[i][j] += v[i] * v[j];
      bx[i] += v[i] * r.world[0];
      bz[i] += v[i] * r.world[1];
    }
  }
  const solve = (A, b) => {
    A = A.map((row, i) => [...row, b[i]]);
    for (let i = 0; i < 3; i++) {
      let p = i;
      for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
      [A[i], A[p]] = [A[p], A[i]];
      const d = A[i][i];
      for (let j = i; j < 4; j++) A[i][j] /= d;
      for (let k = 0; k < 3; k++) {
        if (k === i) continue;
        const f = A[k][i];
        for (let j = i; j < 4; j++) A[k][j] -= f * A[i][j];
      }
    }
    return A.map((row) => row[3]);
  };
  return { ax: solve(M.map((r) => [...r]), bx), az: solve(M.map((r) => [...r]), bz) };
}

const apply = (px, coef) => coef[0] * px[0] + coef[1] * px[1] + coef[2];
const predict = (px, fit) => [apply(px, fit.ax), apply(px, fit.az)];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function summarize(rows) {
  const fit = fitAffine(rows);
  const residuals = rows.map((c) => ({
    name: c.name,
    m: +dist(predict(c.renderedPx, fit), c.world).toFixed(2),
  }));
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r.m * r.m, 0) / residuals.length);
  const maxResidual = Math.max(...residuals.map((r) => r.m));
  const leaveOneOut = rows.map((c, i) => {
    const sub = rows.filter((_, j) => j !== i);
    const f = fitAffine(sub);
    return { name: c.name, m: +dist(predict(c.renderedPx, f), c.world).toFixed(2) };
  });
  return {
    fit,
    residuals,
    rms: +rms.toFixed(2),
    maxResidual: +maxResidual.toFixed(2),
    leaveOneOut,
    looMax: +Math.max(...leaveOneOut.map((r) => r.m)).toFixed(2),
  };
}

const s4 = summarize(controls4);
const s5 = summarize(controls5);

// Conditioning of the non-firehall controls for each set.
const angleAt = (a, b, c) => {
  const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - a[0], c[1] - a[1]];
  const sin = Math.abs(u[0] * v[1] - u[1] * v[0]) / (Math.hypot(...u) * Math.hypot(...v));
  return Math.asin(Math.min(1, sin)) * 180 / Math.PI;
};
const conditioning = (rows) => {
  const pts = rows.filter((c) => c.name !== 'firehall_body').map((c) => c.renderedPx);
  let minAngle = Infinity, minArea = Infinity, worst = null;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      for (let k = j + 1; k < pts.length; k++) {
        const tri = [pts[i], pts[j], pts[k]];
        const v1 = [tri[1][0] - tri[0][0], tri[1][1] - tri[0][1]];
        const v2 = [tri[2][0] - tri[0][0], tri[2][1] - tri[0][1]];
        const area = Math.abs(v1[0] * v2[1] - v1[1] * v2[0]);
        const angles = [
          angleAt(tri[0], tri[1], tri[2]),
          angleAt(tri[1], tri[0], tri[2]),
          angleAt(tri[2], tri[0], tri[1]),
        ];
        const a = Math.min(...angles);
        if (a < minAngle) { minAngle = a; minArea = area; worst = angles.map((x) => +x.toFixed(1)); }
      }
    }
  }
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    const v = [p[0], p[1], 1];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += v[i] * v[j];
  }
  const det =
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  return { areaPx2: +minArea.toFixed(1), anglesDeg: worst, minAngleDeg: +minAngle.toFixed(1), normalMatrixDet: +det.toFixed(0) };
};
const cond4 = conditioning(controls4);
const cond5 = conditioning(controls5);

// Held-out Atlas Crane: Captain pixel vs the actual OSM point in the park data.
const atlas = (() => {
  const found = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      if (o.id === 'atlas-crane' && typeof o.lat === 'number') found.push(o);
      Object.values(o).forEach(walk);
    }
  };
  walk(osm);
  if (!found.length) throw new Error('atlas-crane not found in osm-verified.json');
  return found[0];
})();
const atlasWorld = worldFromLatLon(atlas.lat, atlas.lon);
const holdoutFor = (fit) => {
  const pred = predict([458, 553], fit);
  return {
    predictedWorld: pred.map((v) => +v.toFixed(1)),
    errorM: +dist(pred, atlasWorld).toFixed(2),
  };
};
const hold4 = holdoutFor(s4.fit);
const hold5 = holdoutFor(s5.fit);

const RMS_LIMIT = 30;
const HOLDOUT_LIMIT = 50;
const rmsPass = s5.rms <= RMS_LIMIT;
const holdoutPass = hold5.errorM <= HOLDOUT_LIMIT;
const gatePass = rmsPass && holdoutPass;
const looUnstable = s5.looMax > HOLDOUT_LIMIT;

// PDF label anchors -> rendered pixels. The task fixes the scale at 1800/1190.55 for both axes.
const SCALE = 1800 / 1190.55;
const artAnchors = source.artTrail.works.map((w) => {
  const pt = w.mapPagePointPt;
  const renderedPx = [+(pt.x * SCALE).toFixed(2), +(pt.y * SCALE).toFixed(2)];
  const world5 = predict(renderedPx, s5.fit);
  const world4 = predict(renderedPx, s4.fit);
  const [lat5, lon5] = latLonFromWorld(world5[0], world5[1]);
  const [lat4, lon4] = latLonFromWorld(world4[0], world4[1]);
  return {
    featureId: w.featureId,
    mapNumber: w.mapNumber,
    name: w.name,
    artist: w.artist,
    installedPhase: w.installedPhase,
    pdfAnchorPt: { x: pt.x, y: pt.y },
    renderedPx,
    world5: [+world5[0].toFixed(1), +world5[1].toFixed(1)],
    lat5: +lat5.toFixed(7),
    lon5: +lon5.toFixed(7),
    world4: [+world4[0].toFixed(1), +world4[1].toFixed(1)],
    lat4: +lat4.toFixed(7),
    lon4: +lon4.toFixed(7),
    provisional: true,
    withheldFromRuntime: !gatePass || looUnstable,
    note: 'PDF text anchor of the printed marker number, not the actual sculpture dot centre; Captain must verify. World/latlon are affine-derived and provisional.',
  };
});

const verdict = !gatePass
  ? 'NOT-SUITABLE'
  : looUnstable
    ? 'MARGINAL-NOT-FOR-RUNTIME'
    : 'SUITABLE-WITH-CAVEAT';

const out = {
  schema: 'biidaasige-art-registration/1',
  generatedFor: ['st-bmyv.6'],
  owner: 'bounded art-registration worker',
  claim:
    'Register the rendered official Lassonde Art Trail Fall 2026 map (1800x1273) onto the city world frame with Captain-read control pixels matched by name to verified WGS84 controls, report residuals and leave-one-out, and hold out the Atlas Crane. The primary fit adds the Commissioners Street Bridge road-crossing centre to break the near-collinearity of the original four. The map is a stylised illustration; the affine is map-pixel -> world-metre, not a WGS84 datum transform. Art label anchors are text anchors, not sculpture centres.',
  map: {
    source: 'Lassonde Art Trail, Fall 2026 map PDF (LAT_MAP_DOWNLOAD-Fall2026.pdf)',
    sourceUrl: 'https://assets.lassondearttrail.org/wp-content/uploads/2026/03/21132201/LAT_MAP_DOWNLOAD-Fall2026.pdf',
    renderedImage: '$WATERFRONT_RESEARCH/biidaasige/captain/lat-map-fall2026.png',
    renderedPixels: [1800, 1273],
    pdfPagePt: [1190.55, 841.89],
    pdfCreationDate: '2026-09-21',
    scaleUsed: +SCALE.toFixed(7),
    scaleNote: 'Task-fixed 1800/1190.55 for both axes; the rendered height ratio (1273/841.89) differs by ~0.01%, ignored.',
    isDiagram: true,
    orientationNote: 'Stylised trail illustration; do not assume north-up or a geographic datum.',
    datumNote:
      'MAP-PDF SPACE is a printed illustration in PDF points. WORLD SPACE is the city tangent-plane projection (js/city-config.js worldFromLatLon). The affine below is a 2D pixel->metre fit between them, NOT a WGS84 datum transform.',
  },
  projection: { ...geodata },
  controls: controls5.map((c) => ({
    name: c.name,
    renderedPx: c.renderedPx,
    lat: c.lat,
    lon: c.lon,
    world: c.world.map((v) => +v.toFixed(1)),
    osmRef: c.osmRef,
    kind: c.kind,
    inOriginal4: ORIGINAL_4.some((o) => o.name === c.name),
  })),
  fit5: {
    label: 'PRIMARY: 5 controls (original 4 + Commissioners bridge road-crossing centre)',
    model: 'affine: world = A * [px, py, 1] (least squares, dense normal equations); separate coefficients per axis',
    ax: s5.fit.ax,
    az: s5.fit.az,
    residuals: s5.residuals,
    rms: s5.rms,
    maxResidual: s5.maxResidual,
    leaveOneOut: s5.leaveOneOut,
    conditioning: {
      nonFirehallTriangleAreaPx2: cond5.areaPx2,
      nonFirehallTriangleAnglesDeg: cond5.anglesDeg,
      nonFirehallMinAngleDeg: cond5.minAngleDeg,
      normalMatrixDet: cond5.normalMatrixDet,
      note:
        'The original three non-firehall controls remain nearly collinear (min angle 6.6 deg), but the added Commissioners bridge supplies an off-line constraint: the normal-matrix determinant rises and the leave-one-out max falls from 321.74 m to 58.36 m. Residuals and leave-one-out are reported unmodified; no control was pruned.',
    },
    gate: {
      rmsLimitM: RMS_LIMIT,
      holdoutLimitM: HOLDOUT_LIMIT,
      rmsPass,
      holdoutPass,
      gatePass,
      looMaxM: s5.looMax,
      looUnstable,
    },
  },
  fit4Comparison: {
    label: 'ORIGINAL: 4 controls (retained unchanged for comparison)',
    ax: s4.fit.ax,
    az: s4.fit.az,
    residuals: s4.residuals,
    rms: s4.rms,
    maxResidual: s4.maxResidual,
    leaveOneOut: s4.leaveOneOut,
    conditioning: {
      nonFirehallTriangleAreaPx2: cond4.areaPx2,
      nonFirehallTriangleAnglesDeg: cond4.anglesDeg,
      nonFirehallMinAngleDeg: cond4.minAngleDeg,
      normalMatrixDet: cond4.normalMatrixDet,
    },
    holdout: { ...hold4, pass: hold4.errorM <= HOLDOUT_LIMIT },
  },
  holdout: {
    name: 'atlas_crane',
    renderedPx: [458, 553],
    actualLat: atlas.lat,
    actualLon: atlas.lon,
    actualWorld: atlasWorld.map((v) => +v.toFixed(1)),
    predictedWorld: hold5.predictedWorld,
    errorM: hold5.errorM,
    pass: holdoutPass,
    note: 'Held out from both fits; compared against the actual OSM node/9521067431 point in osm-verified.json.',
  },
  suitability: {
    verdict,
    runtimeUse: gatePass && !looUnstable ? 'provisional-only' : 'withheld',
    reasons: [
      `5-control RMS ${s5.rms.toFixed(2)} m (limit ${RMS_LIMIT} m) -> ${rmsPass ? 'pass' : 'FAIL'}`,
      `5-control Atlas Crane holdout ${hold5.errorM.toFixed(2)} m (limit ${HOLDOUT_LIMIT} m) -> ${holdoutPass ? 'pass' : 'FAIL'}`,
      `5-control leave-one-out max ${s5.looMax.toFixed(2)} m -> ${looUnstable ? 'UNSTABLE' : 'stable'}`,
      `4-control comparison: RMS ${s4.rms.toFixed(2)} m, holdout ${hold4.errorM.toFixed(2)} m, LOO max ${s4.looMax.toFixed(2)} m`,
    ],
    instruction:
      'Do not snap features. Do not treat these world/latlon values as surveyed. If used at all, use only as provisional anchors and keep the source map-space positions authoritative.',
  },
  artAnchors,
  corrections: {
    target: 'docs/biidaasige-placekeeping-source.md',
    oldClaim: 'The Fall 2026 map proves the works are installed on site.',
    correctedClaim:
      'The Fall 2026 map is a published current/planned trail route. It does not independently prove on-site installation. The First Sun artist page still says the work is currently installed at Doris C. Freedman Plaza, NYC (run ended 2026-08-03), so the Toronto installation is not independently verified by a dated primary opening source in this pass. Map markers are approximate source positions only.',
    action: 'Recorded here; the old source doc was not edited because this pass owns only the three new files.',
  },
  sources: [
    { id: 'registration-controls', path: 'tools/fixtures/biidaasige-registration.json', note: 'read-only; verified WGS84 controls by name' },
    { id: 'art-source', path: 'tools/fixtures/biidaasige-placekeeping-source.json', note: 'read-only; PDF label anchors' },
    { id: 'osm-verified', path: 'tools/fixtures/biidaasige/osm-verified.json', note: 'read-only; Atlas Crane actual OSM point' },
    { id: 'projection', path: 'js/toronto-geodata.js', note: 'read-only; city frame projection' },
  ],
};

fs.writeFileSync(
  path.join(ROOT, 'tools/fixtures/biidaasige-art-registration.json'),
  JSON.stringify(out, null, 1) + '\n',
);

console.log(`5-control fit RMS ${s5.rms.toFixed(2)} m, max ${s5.maxResidual.toFixed(2)} m`);
console.log('5-control residuals', s5.residuals);
console.log('5-control leave-one-out', s5.leaveOneOut);
console.log(`5-control Atlas Crane holdout ${hold5.errorM.toFixed(2)} m`);
console.log(`5-control non-firehall min angle ${cond5.minAngleDeg} deg`);
console.log(`4-control comparison: RMS ${s4.rms.toFixed(2)} m, holdout ${hold4.errorM.toFixed(2)} m, LOO max ${s4.looMax.toFixed(2)} m`);
console.log(`verdict ${verdict}; runtimeUse ${out.suitability.runtimeUse}`);
console.log(`wrote tools/fixtures/biidaasige-art-registration.json (${artAnchors.length} art anchors)`);
