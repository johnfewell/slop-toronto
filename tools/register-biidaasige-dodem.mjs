// tools/register-biidaasige-dodem.mjs
// Bounded registration of the Captain-matched MVVA finished-site photograph onto the 2025 City
// orthophoto and the existing city world frame, for the seven Dodem animals on the timber
// islands: the original four (fit-only) plus the three adjacent island animals (source-validated).
//
//   node tools/register-biidaasige-dodem.mjs
//
// Reads (read-only):
//   tools/fixtures/biidaasige-dodem-photo-controls.json  Captain ground-control pairs + original 4 animal pixels
//   tools/fixtures/biidaasige-dodem-photo-extra.json     original 4800x3600 pixels + crop/rotate/resize affine + extra 3
//   tools/fixtures/biidaasige-woodchip-island.json       first-island ortho extent + ring
//   tools/fixtures/biidaasige-dodem-three-island.json    three-animal-island ortho extent + ring
//   js/toronto-geodata.js                                city projection (same as js/city-config.js)
//
// Writes:
//   tools/fixtures/biidaasige-dodem-registration.json
//
// Method: 8-DOF homography from oriented photo pixels -> ortho image pixels, then
// ortho pixel -> EPSG:3857 Mercator -> WGS84 -> existing world (x, z).
// The 2025 ortho is used ONLY for ground registration. It shows a construction ladder at the
// north neck, not animals; no aerial object is used to identify an animal.
// No pixels are copied into the repo.

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

const controls = readJson('tools/fixtures/biidaasige-dodem-photo-controls.json');
const extra = readJson('tools/fixtures/biidaasige-dodem-photo-extra.json');
const island1 = readJson('tools/fixtures/biidaasige-woodchip-island.json');
const island2 = readJson('tools/fixtures/biidaasige-dodem-three-island.json');

// --- ortho georeference (EPSG:3857 -> WGS84 -> world) -------------------------------------
const R = 6378137;
const georef = (island) => {
  const E = island.sourceExport.extent;
  const W = island.sourceExport.width;
  const H = island.sourceExport.height;
  const toLatLon = (px, py) => {
    const mx = E.xmin + (px / W) * (E.xmax - E.xmin);
    const my = E.ymax - (py / H) * (E.ymax - E.ymin);
    return [(2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) * 180 / Math.PI, (mx / R) * 180 / Math.PI];
  };
  const toWorld = (px, py) => {
    const [lat, lon] = toLatLon(px, py);
    return worldFromLatLon(lat, lon);
  };
  return { E, W, H, toLatLon, toWorld };
};
const ortho1 = georef(island1);
const ortho2 = georef(island2);

// --- 8-DOF homography oriented-photo -> ortho, least squares -------------------------------
function fitHomography(rows) {
  const A = [], b = [];
  for (const { photoPixel: [x, y], orthoPixel: [u, v] } of rows) {
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  const M = Array.from({ length: n }, () => Array(n).fill(0));
  const rhs = Array(n).fill(0);
  for (let r = 0; r < A.length; r++) {
    for (let i = 0; i < n; i++) {
      rhs[i] += A[r][i] * b[r];
      for (let j = 0; j < n; j++) M[i][j] += A[r][i] * A[r][j];
    }
  }
  const aug = M.map((row, i) => [...row, rhs[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(aug[k][i]) > Math.abs(aug[p][i])) p = k;
    [aug[i], aug[p]] = [aug[p], aug[i]];
    const d = aug[i][i];
    for (let j = i; j <= n; j++) aug[i][j] /= d;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = aug[k][i];
      for (let j = i; j <= n; j++) aug[k][j] -= f * aug[i][j];
    }
  }
  return aug.map((row) => row[n]);
}
const applyHomography = (h, [x, y]) => {
  const d = h[6] * x + h[7] * y + 1;
  return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
};

const rows = controls.controls.map((c) => ({ id: c.id, photoPixel: c.photoPixel, orthoPixel: c.orthoPixel }));
const h = fitHomography(rows);

const residualFor = (hh, row) => {
  const pred = applyHomography(hh, row.photoPixel);
  const a = ortho1.toWorld(...pred);
  const b = ortho1.toWorld(...row.orthoPixel);
  return { predictedOrthoPixel: pred.map((v) => +v.toFixed(2)), errorM: +Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(2) };
};
const residuals = rows.map((r) => ({ id: r.id, ...residualFor(h, r) }));
const rms = Math.sqrt(residuals.reduce((s, r) => s + r.errorM * r.errorM, 0) / residuals.length);
const maxResidual = Math.max(...residuals.map((r) => r.errorM));
const leaveOneOut = rows.map((r, i) => {
  const hh = fitHomography(rows.filter((_, j) => j !== i));
  return { id: r.id, ...residualFor(hh, r) };
});
const heldoutRow = rows.find((r) => r.id === 'round-bench-center');
const heldout = residualFor(fitHomography(rows.filter((r) => r.id !== 'round-bench-center')), heldoutRow);
heldout.id = heldoutRow.id;
const RMS_LIMIT = 3, HOLDOUT_LIMIT = 5;
const rmsPass = rms <= RMS_LIMIT;
const heldoutPass = heldout.errorM <= HOLDOUT_LIMIT;
const fitPass = rmsPass && heldoutPass;

// --- exact crop/rotate/fit affine: original 4800x3600 -> oriented 1076x1000 ----------------
const T = extra.cropTransform;
const theta = (T.rotationClockwiseDeg * Math.PI) / 180;
const cosT = Math.cos(theta), sinT = Math.sin(theta);
const cropScale = 1000 / (Math.abs(Math.sin(theta)) * 2000 + Math.abs(Math.cos(theta)) * 1450);
const toOriented = ([x, y]) => {
  const dx = x - T.inputCenter[0], dy = y - T.inputCenter[1];
  const rx = dx * cosT - dy * sinT;
  const ry = dx * sinT + dy * cosT;
  return [rx * cropScale + T.outputCenter[0], ry * cropScale + T.outputCenter[1]];
};
const ringFor = (island) => island.ringLatLon;
const insideRing = (ring, lat, lon) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lonI] = ring[i], [latJ, lonJ] = ring[j];
    if ((lonI > lon) !== (lonJ > lon) && lat < ((latJ - latI) * (lon - lonI)) / (lonJ - lonI) + latI) inside = !inside;
  }
  return inside;
};

const buildAnimal = ({ id, kind, bodyOriented, headOriented, sourceMeta, island, uncertaintyM, validation, headingUncertaintyDeg, note }) => {
  const bodyOrthoPixel = applyHomography(h, bodyOriented);
  const headOrthoPixel = applyHomography(h, headOriented);
  const bodyWorld = island.toWorld(...bodyOrthoPixel);
  const headWorld = island.toWorld(...headOrthoPixel);
  const [lat, lon] = island.toLatLon(...bodyOrthoPixel);
  const dx = headWorld[0] - bodyWorld[0];
  const dz = headWorld[1] - bodyWorld[1];
  const heading = (Math.atan2(dx, dz) * 180) / Math.PI;
  const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  return {
    id,
    kind,
    ...sourceMeta,
    orientedBodyPixel: bodyOriented.map((v) => +v.toFixed(2)),
    orientedHeadPixel: headOriented.map((v) => +v.toFixed(2)),
    bodyOrthoPixel: bodyOrthoPixel.map((v) => +v.toFixed(2)),
    headOrthoPixel: headOrthoPixel.map((v) => +v.toFixed(2)),
    bodyWorld: bodyWorld.map((v) => +v.toFixed(1)),
    headWorld: headWorld.map((v) => +v.toFixed(1)),
    bodyLat: +lat.toFixed(7),
    bodyLon: +lon.toFixed(7),
    headingDegFromPlusZ: +heading.toFixed(1),
    bearingDegFromNorth: +bearing.toFixed(1),
    headingUncertaintyDeg: headingUncertaintyDeg ?? null,
    positionUncertaintyM: uncertaintyM,
    islandFeatureId: island.featureId,
    insideIslandRing: insideRing(ringFor(island), lat, lon),
    validation,
    provisional: true,
    autoPlace: false,
    note,
  };
};

const original4 = controls.animals.map((a) =>
  buildAnimal({
    id: a.id,
    kind: a.kind,
    bodyOriented: a.photoPixel,
    headOriented: a.headPixel,
    sourceMeta: { sourceSet: 'original4', photoBodyPixel: a.photoPixel, photoHeadPixel: a.headPixel },
    island: { ...ortho1, featureId: island1.featureId, ringLatLon: island1.ringLatLon },
    uncertaintyM: 3,
    validation: 'fit-only',
    headingUncertaintyDeg: null,
    note: 'Body/foot location from the MVVA finished-site photo via the ground homography. Fit-only: no independent aerial validation. Height parallax and photo interpretation give at least 3 m uncertainty; not surveyed.',
  }),
);

const extra3 = extra.animals.map((a) =>
  buildAnimal({
    id: a.id,
    kind: a.kind,
    bodyOriented: toOriented(a.originalPhotoBodyPixel),
    headOriented: toOriented(a.originalPhotoHeadPixel),
    sourceMeta: {
      sourceSet: 'extra3',
      originalPhotoBodyPixel: a.originalPhotoBodyPixel,
      originalPhotoHeadPixel: a.originalPhotoHeadPixel,
      fixtureProjectedOrthoBodyPixel: a.projectedOrthoBodyPixel,
      fixtureProjectedOrthoHeadPixel: a.projectedOrthoHeadPixel,
    },
    island: { ...ortho2, featureId: island2.featureId, ringLatLon: island2.ringLatLon },
    uncertaintyM: 4,
    validation: 'source-aerial-validated',
    headingUncertaintyDeg: a.kind === 'eagle' ? 15 : null,
    note: 'Extrapolated 15-25 m beyond the timber-island control region. Source-validated: the Captain overlaid the projected centres on the 2025 aerial photo and confirmed the turtle/musky/eagle forms within about 1 m. 4 m uncertainty remains explicit. Eagle heading is a source head-only estimate (15 deg).',
  }),
);

const animals = [...original4, ...extra3];

const out = {
  schema: 'biidaasige-dodem-registration/1',
  bead: 'st-bmyv.4',
  generated: '2026-11-11',
  owner: 'bounded Dodem photo-registration worker',
  claim:
    'Register the Captain-matched MVVA finished-site photograph to the 2025 City orthophoto and the existing city world frame with an 8-DOF ground homography, then project all seven Dodem body/head pixels: the original four on the first island (fit-only) and three additional animals on the adjacent three-animal island (source-aerial-validated). The 2025 ortho is used only for ground registration; it shows a construction ladder at the north neck, not animals. No aerial object is used to identify an animal. Positions are provisional and not auto-placed.',
  inputs: {
    photoControls: 'tools/fixtures/biidaasige-dodem-photo-controls.json',
    photoExtra: 'tools/fixtures/biidaasige-dodem-photo-extra.json',
    islandFirst: 'tools/fixtures/biidaasige-woodchip-island.json',
    islandThreeAnimal: 'tools/fixtures/biidaasige-dodem-three-island.json',
    projection: 'js/toronto-geodata.js',
    sourcePhoto: controls.sourcePhoto,
    orientedPhoto: controls.orientedPrivatePhoto,
    orientedPhotoDimensions: controls.orientedPhotoDimensions,
    sourceDimensions: extra.sourceDimensions,
    privatePixelsNote: 'Private photo/ortho pixels stay outside the repo; only source facts and control coordinate pairs are recorded.',
  },
  projection: { ...geodata },
  method: {
    homography: '8-DOF projective: orthoPixel = H * orientedPhotoPixel (least squares, normal equations)',
    chain: 'oriented photo pixel -> ortho image pixel -> EPSG:3857 Mercator -> WGS84 -> existing world (x, z)',
    orthoPixelToMercator: 'mx = xmin + (px/W)*(xmax-xmin); my = ymax - (py/H)*(ymax-ymin)',
    mercatorToWgs84: 'lon = mx/R*180/pi; lat = (2*atan(exp(my/R)) - pi/2)*180/pi; R=6378137',
    world: 'js/city-config.js worldFromLatLon (lat0/lon0/kx/ky/theta/ox/oz from js/toronto-geodata.js)',
    cropTransform: 'original 4800x3600 -> oriented 1076x1000: oriented = Rot(+148deg) * (original - inputCenter) * scale + outputCenter',
    note: 'Eight point pairs supply 16 scalar constraints for the homography\u2019s eight unknowns, so this is an overdetermined least-squares fit. In-sample residuals are not independent evidence; leave-one-out and the held-out round bench are the real tests.',
  },
  cropTransform: {
    inputCenter: T.inputCenter,
    outputCenter: T.outputCenter,
    rotationClockwiseDeg: T.rotationClockwiseDeg,
    scaleFormula: T.scaleFormula,
    scale: +cropScale.toPrecision(12),
    outputSize: T.outputSize,
    note: T.note,
  },
  homography: {
    h: h.map((v) => +v.toPrecision(12)),
    order: ['h11', 'h12', 'h13', 'h21', 'h22', 'h23', 'h31', 'h32'],
    groundOnly: true,
  },
  fit: {
    controls: rows.length,
    residuals,
    rmsM: +rms.toFixed(2),
    maxResidualM: +maxResidual.toFixed(2),
    leaveOneOut,
    leaveOneOutMaxM: +Math.max(...leaveOneOut.map((r) => r.errorM)).toFixed(2),
    heldoutRoundBench: heldout,
    gate: { rmsLimitM: RMS_LIMIT, heldoutLimitM: HOLDOUT_LIMIT, rmsPass, heldoutPass, fitPass },
    quality: fitPass ? 'PASS' : 'FLAG-FOR-CAPTAIN-REVIEW',
    caveat:
      'Eight point pairs give 16 scalar constraints for 8 DOF, so the homography is an overdetermined least-squares fit and the low in-sample RMS is expected. The meaningful checks are LOO (max ' +
      Math.max(...leaveOneOut.map((r) => r.errorM)).toFixed(2) +
      ' m) and the held-out round bench (' +
      heldout.errorM.toFixed(2) +
      ' m).',
  },
  islands: [
    {
      featureId: island1.featureId,
      role: 'first island (original 4 animals)',
      ringPoints: island1.ringLatLon.length,
      traceErrorM: island1.traceErrorM,
      placementUncertaintyM: island1.placementUncertaintyM,
      note: island1.interpretation,
    },
    {
      featureId: island2.featureId,
      role: 'adjacent three-animal island (extra 3 animals)',
      ringPoints: island2.ringLatLon.length,
      traceErrorM: island2.traceErrorM,
      placementUncertaintyM: island2.placementUncertaintyM,
      note: island2.interpretation,
    },
  ],
  animals,
  policy: {
    autoPlace: false,
    captainReviewRequired: true,
    positionUncertaintyM: { original4: 3, extra3: 4 },
    heightParallaxNote: 'Animal body pixels can parallax by up to ~2.4 m of height; the 3 m / 4 m floors cover that and photo interpretation. Do not present these as surveyed.',
    identificationNote: 'Identities come from the current MVVA finished-site photo only. The 2025 ortho north-neck construction ladder is not an animal and was not used for identification.',
    validationNote: 'original4 are fit-only (no independent aerial validation). extra3 are source-aerial-validated: the Captain overlaid the projected centres on the 2025 aerial within about 1 m.',
    registrationNote: 'Distinctive curbs give a valid built-site match between the finished photo and the 2025 ortho.',
    headingNote: 'The eagle heading is a source head-only estimate with 15 deg uncertainty; other headings have no stated uncertainty.',
  },
  sources: [
    { id: 'photo-controls', path: 'tools/fixtures/biidaasige-dodem-photo-controls.json', note: 'read-only; Captain ground-control pairs and original 4 animal pixels' },
    { id: 'photo-extra', path: 'tools/fixtures/biidaasige-dodem-photo-extra.json', note: 'read-only; original 4800x3600 pixels, crop affine, extra 3 animals' },
    { id: 'island-first', path: 'tools/fixtures/biidaasige-woodchip-island.json', note: 'read-only; first-island ortho extent and ring' },
    { id: 'island-three', path: 'tools/fixtures/biidaasige-dodem-three-island.json', note: 'read-only; three-animal-island ortho extent and ring' },
    { id: 'projection', path: 'js/toronto-geodata.js', note: 'read-only; city frame projection' },
  ],
};

fs.writeFileSync(path.join(ROOT, 'tools/fixtures/biidaasige-dodem-registration.json'), JSON.stringify(out, null, 1) + '\n');

console.log(`homography RMS ${rms.toFixed(2)} m, max ${maxResidual.toFixed(2)} m`);
console.log(`leave-one-out max ${out.fit.leaveOneOutMaxM} m; held-out round bench ${heldout.errorM.toFixed(2)} m`);
console.log(`fit ${out.fit.quality}`);
console.log(`crop scale ${cropScale}`);
for (const a of animals) {
  console.log(`${a.id} [${a.sourceSet}] world ${a.bodyWorld} latlon ${a.bodyLat},${a.bodyLon} hdg+Z ${a.headingDegFromPlusZ} brg ${a.bearingDegFromNorth} unc ${a.positionUncertaintyM}m inside ${a.insideIslandRing} ${a.validation}`);
}
console.log(`wrote tools/fixtures/biidaasige-dodem-registration.json (${animals.length} animals)`);
