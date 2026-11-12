#!/usr/bin/env node
// tools/build-island-garden-cover.mjs
//
// Phase 1 of bead st-sb3r.37: build a BOUNDED, source-constrained candidate garden-cover dataset on the two photographed
// Oneida / Ojibway cottage corridors on Algonquin Island, and render an ortho-preview image plus its georeferenced JSON so
// the captain can review the candidates against real primary imagery BEFORE any runtime planting is enabled.
//
// Inputs (all local, primary, rights-clear):
//   - Ontario GTA 2023 lidar DSM (first return) / DTM (bare earth), 0.5 m, via tools/terrain-pilot-lib.mjs openDtm
//     (re-checks each tile's manifest SHA-256). Cache dir: $DON_VALLEY_DTM (here $WATERFRONT_RESEARCH/vegetation-cache).
//   - The .35 low-vegetation audit's rules and helpers (tools/audit-island-low-vegetation.mjs), reused read-only.
//   - The accepted yard-block eligibility (js/waterfront-island-yard-materials.js: blocks 2914/2916/2918) and the
//     committed building rows (js/waterfront-island-buildings-data.js, the rendered footprints) — loaded read-only.
//   - The saved OSM building polygons ($WATERFRONT_RESEARCH/research/island-cottages/b.json, ODbL) for the +1 m buffer.
//   - The City of Toronto 2024 8 cm colour orthophoto (basemap/cot_ortho_2024_color_8cm/MapServer), fetched ONLY when
//     --ortho is given; the source URL and ground metres per pixel are recorded in the preview JSON.
//
// What it does — DATA ONLY, NOT A PLAINTING PASS:
//   1. Candidate support = a coarse 2x2 cluster (1 m, four 0.5 m sub-samples) whose WHOLE footprint passes every gate:
//      corridor, eligible block, exclusion and the 1-5 m band. The band rule is strict: >= 3 of 4 sub-samples low AND no
//      tall and no nodata sub-sample, so 2-of-4 can never pass and a hidden-understory cell is rejected, never inferred.
//   2. Every candidate footprint (all four sub-samples) is excluded when any lies inside an actual OSM building polygon /
//      a rendered building footprint (+1 m), on a mapped pavement/path (+clearance), or under committed water.
//   3. Candidates are grouped into patches (a 3 m link radius) and each patch gets a coarse shape/height hint.
//   4. NO tall-return (>= 5 m) understory is extrapolated: a cluster whose returns are mostly tall is left bare, not
//      planted from canopy. The data records this so a renderer can never invent understory from canopy.
//   5. The output is byte-reproducible from the same tiles: the JS data file has fixed ordering and rounded values.
//
// Usage:
//   DON_VALLEY_DTM=$WATERFRONT_RESEARCH/vegetation-cache \
//   node tools/build-island-garden-cover.mjs \
//     [--buildings $WATERFRONT_RESEARCH/research/island-cottages/b.json] \
//     [--ortho] [--ortho-out $WATERFRONT_RESEARCH/island-garden-cover-ortho-preview.png] \
//     [--preview $WATERFRONT_RESEARCH/island-garden-cover-preview.json] \
//     [--out js/waterfront-island-garden-cover-data.js] [--check]
//
// Exit 0 wrote or checked the data; 1 on a missing source, gate, geometry or fetch error.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, loadCity, openDtm, DTM_DIR } from './terrain-pilot-lib.mjs';
import {
  DEFAULTS as AUDIT_DEFAULTS, corridorDistance, ringDistance, pointInRing, inWater, classifySample
} from './audit-island-low-vegetation.mjs';
import os from 'node:os';
// Private research cache (reference downloads that never ship): set WATERFRONT_RESEARCH to its folder.
const WATERFRONT_RESEARCH = process.env.WATERFRONT_RESEARCH || path.join(os.tmpdir(), 'waterfront-research');
const researchLabel = (p) => (p.startsWith(WATERFRONT_RESEARCH) ? '$WATERFRONT_RESEARCH' + p.slice(WATERFRONT_RESEARCH.length) : path.basename(p));

const argv = process.argv.slice(2);
const arg = (n, f) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : f; };
const has = (n) => argv.includes(n);

const BUILDINGS = arg('--buildings', path.join(WATERFRONT_RESEARCH, 'research/island-cottages/b.json'));
const OUT = arg('--out', path.join(ROOT, 'js/waterfront-island-garden-cover-data.js'));
const PREVIEW = arg('--preview', path.join(WATERFRONT_RESEARCH, 'island-garden-cover-preview.json'));
const ORTHO_OUT = arg('--ortho-out', path.join(WATERFRONT_RESEARCH, 'island-garden-cover-ortho-preview.png'));
const WANT_ORTHO = has('--ortho');
const CHECK = has('--check');

const fail = (m) => { console.error(`build-island-garden-cover: ${m}`); process.exit(1); };

// ---- constants (documented in docs/waterfront-island-garden-cover.md) ----
const CELL = 0.5; // lidar-native sample (m)
const CLUSTER = 2; // 2x2 coarse cluster = 1.0 m (m)
const LOW_SUBS_OF_4 = 3; // 3 of 4 sub-samples low; never 2-of-4, and any tall/nodata sub-sample rejects the cell
const LINK_M = 3.0; // patch grouping radius
const CORRIDOR_M = AUDIT_DEFAULTS.corridorM; // 12 m photographed frontage only
const BUILDING_PAD = 1.0; // OSM + rendered footprint buffer
const PAVED_CLEARANCE = 0.6; // path/pavement clearance beyond the mapped strip edge
const ELIGIBLE_BLOCKS = [2914, 2916, 2918]; // the accepted source-validated yard blocks
const ORTHO_SERVICE = 'https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2024_color_8cm/MapServer/export';

// The captain's IMMUTABLE source review (committed fixture tools/data/island-garden-review.json): the reviewed cell-set
// sha256, the 8 accepted candidate patch indices and the expected 263 selected cells. The builder NEVER writes or updates
// this fixture. It compares the freshly built candidate cell hash against the fixture's EXACT hash: if the candidate set
// differs (a regenerated/changed dataset), it THROWS and asks for a new review, and never silently re-approves. On a match
// it copies the FROZEN review into the generated JS data so the committed runtime can verify the same hash.
const REVIEW_FIXTURE = arg('--review', path.join(ROOT, 'tools/data/island-garden-review.json'));
function cellsHash(cells) {
  const rows = cells.map((c) => `${c[3]}:${c[0]}:${c[1]}`).join('\n');
  return crypto.createHash('sha256').update(rows).digest('hex');
}
function loadReviewFixture() {
  if (!fs.existsSync(REVIEW_FIXTURE)) fail(`review fixture not found: ${REVIEW_FIXTURE} (the trial needs the captain's committed review)`);
  let f; try { f = JSON.parse(fs.readFileSync(REVIEW_FIXTURE, 'utf8')); } catch (e) { fail(`could not parse review fixture ${REVIEW_FIXTURE}: ${e.message}`); }
  if (!Array.isArray(f.acceptedPatches) || typeof f.dataCellsHash !== 'string' || !Number.isInteger(f.expectedCells)) fail('review fixture is missing acceptedPatches/dataCellsHash/expectedCells');
  return f;
}

// ---- read the committed geodata (detail frame), the yard eligibility and buildings, all read-only ----
let u8 = new Uint8Array(fs.readFileSync(path.join(ROOT, 'data/toronto-geodata.bin')));
if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
const { decodeGeo } = await import(pathToFileURL(path.join(ROOT, 'js/geodata-loader.js')));
const { GEO } = decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
const PROJ = GEO.frame.projection, DETAIL = GEO.frame.detail;

// (the yard module derives eligible blocks from the committed GEO.buildings + the OSM-matched building profiles, so the
// buildings module must be loaded for its source-identity guard, exactly as js/city-grid.js does in the browser)
const C = loadCity([
  'js/waterfront-island-lanes-data.js',
  'js/waterfront-island-buildings-data.js',
  'js/waterfront-island-buildings.js',
  'js/waterfront-island-yard-materials.js'
]);
const LANES = C.ISLAND_LANES_DATA;
const corridorLanes = (LANES.runs || []).filter((r) => (r.names || []).some((n) => /oneida|ojibway/i.test(n)));
if (corridorLanes.length !== 2) fail(`expected Oneida and Ojibway lane runs, found ${corridorLanes.length}`);

// The accepted yard blocks, straight from the yard module's own eligibility (the same source test the material pass
// uses). If the module cannot derive them we stop rather than guess.
const yardLayout = C.islandYardMaterialLayout?.();
if (!yardLayout || !yardLayout.supported) fail(`yard eligibility unavailable: ${yardLayout && yardLayout.reason}`);
const yardBlocks = yardLayout.eligible.map((e) => e.id).sort((a, b) => a - b);
if (JSON.stringify(yardBlocks) !== JSON.stringify(ELIGIBLE_BLOCKS)) {
  fail(`yard eligibility is ${JSON.stringify(yardBlocks)}, expected ${JSON.stringify(ELIGIBLE_BLOCKS)} (scope drift; review the source)`);
}

// The rendered building footprints (the same rows the renderer draws) as rotated rects: [cx, cz, ang, [[u0,u1,v0,v1]...]].
// The renderer places a local (u, v) at x = cx + u*cos(ang) + v*sin(ang), z = cz - u*sin(ang) + v*cos(ang). We test the
// inverse: u = dx*cos + dz*sin… wait, the canonical inverse used by build-island-residential-canopy.mjs is
// u = dx*cos(ang) - dz*sin(ang), v = dx*sin(ang) + dz*cos(ang).
function renderedFootprints() {
  const D = C.ISLAND_BUILDINGS_DATA;
  if (!D || !Array.isArray(D.records)) fail('ISLAND_BUILDINGS_DATA absent/unexpected');
  const out = [];
  for (const r of D.records) {
    if (!Number.isFinite(r.cx) || !Number.isFinite(r.cz) || typeof r.fp !== 'string') continue;
    let fp; try { fp = JSON.parse(r.fp); } catch { fail(`bad fp on record ${r.row}`); }
    if (!Array.isArray(fp) || !Array.isArray(fp[1])) fail(`bad fp shape on record ${r.row}`);
    out.push({ cx: r.cx, cz: r.cz, ang: fp[0], rects: fp[1], id: r.osm?.id ?? null });
  }
  return out;
}
const rendered = renderedFootprints();
function inRendered(x, z, pad) {
  for (const b of rendered) {
    const dx = x - b.cx, dz = z - b.cz;
    const c = Math.cos(b.ang), s = Math.sin(b.ang);
    const u = dx * c - dz * s, v = dx * s + dz * c;
    for (const r of b.rects) if (u >= r[0] - pad && u <= r[1] + pad && v >= r[2] - pad && v <= r[3] + pad) return true;
  }
  return false;
}

// The saved OSM building polygons, in world metres (b.json geometry is lat/lon).
function worldFromLatLon(lat, lon) {
  const e = (lon - PROJ.lon0) * PROJ.kx, n = (lat - PROJ.lat0) * PROJ.ky;
  const c = Math.cos(PROJ.theta), s = Math.sin(PROJ.theta);
  return { x: e * c - n * s - PROJ.ox, z: -(e * s + n * c) - PROJ.oz };
}
function osmBuildings() {
  const j = JSON.parse(fs.readFileSync(BUILDINGS, 'utf8'));
  const rings = [];
  for (const e of j.elements || []) {
    if (!Array.isArray(e.geometry) || e.geometry.length < 4) continue;
    const flat = [];
    for (const p of e.geometry) { const w = worldFromLatLon(p.lat, p.lon); flat.push(w.x, w.z); }
    if (flat.length >= 6) rings.push({ id: e.id, flat });
  }
  return rings;
}
const osm = osmBuildings();

// Committed water polygons (lake land holes respected).
const waters = (GEO.areas || []).filter((a) => a[0] === 'water' && a[2]).map((a) => ({ flat: a[2], holes: (a[3] || []).filter((h) => Array.isArray(h) && h.length >= 6) }));

// Every mapped island lane's paved half-width (narrowed Oneida/Ojibway), plus PAVED_CLEARANCE.
function onPavement(x, z) {
  for (const r of LANES.runs || []) {
    const name = (r.names || [])[0];
    const w = AUDIT_DEFAULTS.pavedWidth[name] ?? (Number.isFinite(r.w) ? r.w : AUDIT_DEFAULTS.defaultPavedWidthM);
    const limit = w / 2 + PAVED_CLEARANCE;
    const p = r.points;
    for (let i = 0; i + 1 < p.length; i++) {
      const dx = p[i + 1][0] - p[i][0], dz = p[i + 1][1] - p[i][1], L = dx * dx + dz * dz;
      const t = L > 0 ? Math.max(0, Math.min(1, ((x - p[i][0]) * dx + (z - p[i][1]) * dz) / L)) : 0;
      if (Math.hypot(p[i][0] + dx * t - x, p[i][1] + dz * t - z) <= limit) return true;
    }
  }
  return false;
}

// ---- the sampling box: the corridor envelope bounding box, inside the detail frame ----
let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (const r of corridorLanes) for (const p of r.points) {
  if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
  if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
}
const pad = CORRIDOR_M + CELL;
const BOX = {
  x0: Math.max(DETAIL.x0, x0 - pad), x1: Math.min(DETAIL.x1, x1 + pad),
  z0: Math.max(DETAIL.z0, z0 - pad), z1: Math.min(DETAIL.z1, z1 + pad)
};

const dsm = openDtm(C, BOX, 'manifest-toronto-island-dsm.json', { allowMissing: true });
const dtm = openDtm(C, BOX, 'manifest-toronto-island.json', { allowMissing: true });

// ---- per 0.5 m cell: corridor gate, exclusions, coarse cluster majority, and the review flags ----
const counts = {
  cells: 0, corridor: 0, inEligibleBlock: 0,
  excludedBuilding: 0, excludedPavement: 0, excludedWater: 0,
  lowCluster: 0, belowCluster: 0, tallCluster: 0, noLidarCluster: 0
};
// Candidate centres on the coarse 1 m grid.
const candidates = [];

// The band membership of one 0.5 m sub-sample: 0 below, 1 low (the 1-5 m support band), 2 tall, -1 no lidar.
function subClass(x, z) {
  const cls = classifySample(dsm.fineAt(x, z), dtm.fineAt(x, z));
  return cls === 'low' ? 1 : cls === 'below' ? 0 : cls === 'tall' ? 2 : -1;
}

// THE PLANT FOOTPRINT (= the coarse 1 m cluster) must satisfy EVERY gate, not just its centre: the eligible-block
// corridor coverage at all four sub-samples, every building/pavement/water exclusion at all four, and the low band at
// >= LOW_SUBS_OF_4 of the four sub-samples with NOT ONE tall or nodata sub-sample. A tall or unknown sub-sample means the
// cluster may hide understory (or nothing known), so it is rejected for phase 1 — never inferred.
const clearFx = [0.25, 0.75]; // the four sub-sample centres inside a 1 m cluster
const nx = Math.floor((BOX.x1 - BOX.x0) / CELL), nz = Math.floor((BOX.z1 - BOX.z0) / CELL);
let cov01 = C.islandYardCoverageAt; // (never mutated; absence means the yard module is unusable)
if (typeof cov01 !== 'function') fail('islandYardCoverageAt missing (yard module not loaded)');

for (let jz = 0; jz + CLUSTER - 1 < nz; jz += CLUSTER) {
  for (let ix = 0; ix + CLUSTER - 1 < nx; ix += CLUSTER) {
    const cx = BOX.x0 + (ix + CLUSTER / 2) * CELL;
    const cz = BOX.z0 + (jz + CLUSTER / 2) * CELL;
    counts.cells++;
    // build the footprint sub-samples once
    const subPts = [];
    for (let sj = 0; sj < CLUSTER; sj++) for (let si = 0; si < CLUSTER; si++) {
      subPts.push([BOX.x0 + (ix + si + clearFx[0]) * CELL, BOX.z0 + (jz + sj + clearFx[0]) * CELL]);
    }
    // corridor at every sub-sample (the footprint is wholly in the photographed frontage)
    if (!subPts.every(([x, z]) => corridorDistance(corridorLanes, x, z).d <= CORRIDOR_M)) continue;
    counts.corridor++;
    // eligible yard block at every sub-sample (the whole footprint is accepted yard)
    const covs = subPts.map(([x, z]) => cov01(x, z));
    if (!covs.every((c) => c > 0)) continue;
    counts.inEligibleBlock++;
    // exclusions at every sub-sample: rendered + OSM footprints (+pad), mapped pavement (+clearance), water
    let excluded = null;
    for (const [x, z] of subPts) {
      if (inRendered(x, z, BUILDING_PAD) || osm.some((b) => ringDistance(b.flat, x, z) <= BUILDING_PAD)) { excluded = 'building'; break; }
      if (onPavement(x, z)) { excluded = 'pavement'; break; }
      if (inWater(waters, x, z)) { excluded = 'water'; break; }
    }
    if (excluded === 'building') { counts.excludedBuilding++; continue; }
    if (excluded === 'pavement') { counts.excludedPavement++; continue; }
    if (excluded === 'water') { counts.excludedWater++; continue; }
    // the low band across the four sub-samples: >=3 low, and NOT ONE tall or nodata
    let low = 0, tall = 0, noLidar = 0;
    for (const [x, z] of subPts) {
      const cls = subClass(x, z);
      if (cls === 1) low++; else if (cls === 2) tall++; else if (cls < 0) noLidar++;
    }
    if (tall > 0 || noLidar > 0) { if (tall > 0) counts.tallCluster++; else counts.noLidarCluster++; continue; }
    if (low >= LOW_SUBS_OF_4) {
      counts.lowCluster++;
      const cov = Math.min(...covs);
      candidates.push({ x: +cx.toFixed(1), z: +cz.toFixed(1), lane: corridorDistance(corridorLanes, cx, cz).lane === 'Oneida Avenue' ? 'oneida' : 'ojibway', cov: +cov.toFixed(2) });
    } else counts.belowCluster++;
  }
}

// ---- group candidates into patches (3 m link) ----
// A patch is ONLY its member cells. It carries no bounding rectangle for planting: a patch's accepted cells are the exact
// set a renderer may plant on, and every excluded cell inside the bbox (a gap, hole, path, building or water cut) stays
// bare because the renderer never fills the rectangle. The bbox/extent is review metadata only, never a plant area.
const COARSE = CLUSTER * CELL; // 1.0 m
const patches = [];
const used = new Array(candidates.length).fill(false);
for (let i = 0; i < candidates.length; i++) {
  if (used[i]) continue;
  const stack = [i]; used[i] = true; const members = [];
  while (stack.length) {
    const a = candidates[stack.pop()]; members.push(a);
    for (let j = 0; j < candidates.length; j++) {
      if (used[j]) continue; const b = candidates[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) <= LINK_M) { used[j] = true; stack.push(j); }
    }
  }
  let mx = 0, mz = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, nOneida = 0;
  for (const m of members) {
    mx += m.x; mz += m.z;
    if (m.x < minX) minX = m.x; if (m.x > maxX) maxX = m.x;
    if (m.z < minZ) minZ = m.z; if (m.z > maxZ) maxZ = m.z;
    if (m.lane === 'oneida') nOneida++;
  }
  patches.push({
    members, // the exact accepted cells (the only plantable area)
    memberCount: members.length,
    areaM2: +(members.length * COARSE * COARSE).toFixed(1), // m2, coarse cells only
    cx: +(mx / members.length).toFixed(1),
    cz: +(mz / members.length).toFixed(1),
    extentX: +(maxX - minX + COARSE).toFixed(1), // review bbox only
    extentZ: +(maxZ - minZ + COARSE).toFixed(1),
    lane: nOneida >= members.length - nOneida ? 'oneida' : 'ojibway'
  });
}
// keep only meaningful patches: MIN_PATCH_CELLS coarse cells x 1.0 m2 each = MIN_PATCH_CELLS m2. A lone speck is not
// planting evidence.
const MIN_PATCH_CELLS = 4; // >= 4 coarse cells = >= 4 m2 of candidate support
const kept = patches.filter((p) => p.memberCount >= MIN_PATCH_CELLS);
const candidateAreaM2 = +(kept.reduce((s, p) => s + p.areaM2, 0)).toFixed(1);

// ---- determinism: a compact, ordered payload ----
// Patches are ordered by their (rounded) centroid, then cells are numbered by that SAME sorted patch order, and cells
// are sorted by (x, z, patch). So the patch index in `patches` is exactly the patch id every cell carries.
const sortedKept = kept.slice().sort((a, b) => (a.cx - b.cx) || (a.cz - b.cz));
const keptMembers = [];
sortedKept.forEach((p, idx) => { for (const m of p.members) keptMembers.push({ ...m, patch: idx }); });
const sortedCandidates = keptMembers.slice().sort((a, b) => (a.x - b.x) || (a.z - b.z) || (a.patch - b.patch));

const payload = {
  version: 1,
  kind: 'island-garden-cover',
  bead: 'st-sb3r.37',
  status: 'phase-2-reviewed-candidate-data',
  note: 'Generic photo-informed low-cover APPROXIMATION. NOT species, hedge or flowerbed. No understory from tall returns. Only the captain-reviewed patches (reviewSelection) may be planted; the runtime helper is hidden by default.',
  source: {
    lidar: {
      dataset: 'Ontario Elevation Mapping Program, GTA 2023 lidar, DSM (first return) over DTM (bare earth), 0.5 m',
      dsmManifest: 'manifest-toronto-island-dsm.json',
      dtmManifest: 'manifest-toronto-island.json',
      licence: dsm.manifest.licence || 'Open Government Licence – Ontario',
      manifestSha256: {
        dsm: sha256(path.join(DTM_DIR, 'manifest-toronto-island-dsm.json')),
        dtm: sha256(path.join(DTM_DIR, 'manifest-toronto-island.json'))
      }
    },
    buildings: { osm: 'OpenStreetMap contributors, ODbL', file: researchLabel(BUILDINGS), service: 'rendered island building rows (js/waterfront-island-buildings-data.js)' },
    lanes: { file: 'js/waterfront-island-lanes-data.js', corridors: corridorLanes.map((r) => ({ name: r.names[0], way: r.ways[0] })) }
  },
  projection: { lat0: PROJ.lat0, lon0: PROJ.lon0, kx: PROJ.kx, ky: PROJ.ky, theta: PROJ.theta, ox: PROJ.ox, oz: PROJ.oz },
  frame: { x0: DETAIL.x0, x1: DETAIL.x1, z0: DETAIL.z0, z1: DETAIL.z1 },
  rules: {
    corridorM: CORRIDOR_M, cellM: CELL, clusterM: CLUSTER * CELL, lowSubsOf4: LOW_SUBS_OF_4,
    lowBandM: [1, 5], buildingPadM: BUILDING_PAD, pavedClearanceM: PAVED_CLEARANCE, linkM: LINK_M, minPatchCells: MIN_PATCH_CELLS,
    plantHeight: 'explicit photo-informed approximation (this dataset does NOT carry a measured plant height)',
    plantAreaRule: 'renderer plants ONLY on the accepted cells; a patch bbox/extent is review metadata, never a plant area',
    eligibleBlocks: ELIGIBLE_BLOCKS
  },
  counts,
  budget: {
    candidateCells: sortedCandidates.length,
    candidateAreaM2,
    patchCount: sortedKept.length,
    coarseCellAreaM2: CLUSTER * CELL * CLUSTER * CELL
  },
  // Compact candidate rows: [cx10, cz10, laneIndex(0 oneida,1 ojibway), patchIndex] in world metres /10.
  // ONLY accepted cells of kept patches are present; the renderer plants exactly these cells, never a patch rectangle.
  cells: sortedCandidates.map((c) => [Math.round(c.x * 10), Math.round(c.z * 10), c.lane === 'oneida' ? 0 : 1, c.patch]),
  patches: sortedKept.map((p) => [Math.round(p.cx * 10), Math.round(p.cz * 10), Math.round(p.extentX * 10), Math.round(p.extentZ * 10), Math.round(p.areaM2 * 10), p.lane === 'oneida' ? 0 : 1, p.memberCount])
};
// Integrity gate: the candidate cell set MUST be the one the captain reviewed. Compute the hash, compare EXACTLY to the
// immutable fixture; a mismatch is a hard stop that requires a new review — never a silent re-approval of changed cells.
const fixture = loadReviewFixture();
const HASH = cellsHash(payload.cells);
if (HASH !== fixture.dataCellsHash) {
  fail(`candidate cell set hash ${HASH} does not match the reviewed hash ${fixture.dataCellsHash}. `
    + `The dataset changed; a NEW captain review is required before the trial can build. The committed review is never rewritten.`);
}
const selectedCells = payload.cells.filter((c) => fixture.acceptedPatches.includes(c[3])).length;
if (selectedCells !== fixture.expectedCells) {
  fail(`the reviewed patches resolve to ${selectedCells} candidate cells, but the review expects ${fixture.expectedCells}. Re-review required.`);
}
// Copy the FROZEN review (not a fresh approval) into the generated data.
payload.reviewSelection = {
  status: fixture.status,
  review: path.relative(ROOT, REVIEW_FIXTURE),
  acceptedPatches: fixture.acceptedPatches.slice(),
  selectedCells,
  dataCellsHash: fixture.dataCellsHash,
  sourceOrthoExtent3857: fixture.sourceOrthoExtent3857 || null,
  note: 'Representative visual trial only. Copied verbatim from the captain\'s committed review fixture (tools/data/island-garden-review.json). The other candidate patches were withheld as ambiguous/near structures, not classified nonvegetation. Bound by dataCellsHash.'
};

function sha256(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
}

// ---- write the JS data (deterministic from the same tiles) ----
const banner = `// js/waterfront-island-garden-cover-data.js — GENERATED by tools/build-island-garden-cover.mjs, do not edit by hand.
// Phase 2 candidate data for a BOUNDED generic low-cover APPROXIMATION on the photographed Oneida/Ojibway cottage
// frontages (blocks 2914/2916/2918, 12 m corridor, strict 3-of-4 low with no tall/nodata sub-sample, actual OSM + rendered
// footprints +1 m, mapped pavement + clearance and water excluded). NOT species/hedges/flowerbeds; NOT understory inferred
// from tall returns. Only reviewSelection's captain-reviewed patches may be planted; see docs/waterfront-island-garden-cover.md.
(function () {
window.CITY = window.CITY || {};
window.CITY.ISLAND_GARDEN_COVER_DATA = ${JSON.stringify(payload)};
})();
`;

// ---- the georeferenced preview JSON: candidate locations + extents + source dates ----
const preview = {
  kind: 'island-garden-cover-preview',
  bead: 'st-sb3r.37',
  generatedFor: 'captain source-support review BEFORE runtime enable',
  box: BOX,
  projection: payload.projection,
  counts,
  budget: payload.budget,
  reviewSelection: payload.reviewSelection,
  sourceDates: {
    lidar: 'Ontario GTA 2023 lidar (GTA 2023 acquisition; exact flight date per the province\'s elevation program)',
    ortho: WANT_ORTHO ? 'City of Toronto 2024 8 cm colour orthophoto (acquisition 26 Apr-30 May 2024, horizontal accuracy 0.16 m)' : 'not fetched (pass --ortho)',
    osm: 'OpenStreetMap 2026-11-10 snapshot (b.json)'
  },
  // nearest building distance over candidate cells, and the ortho preview extent, so a reviewer knows what to expect
  ortho: WANT_ORTHO ? { service: ORTHO_SERVICE, out: ORTHO_OUT } : null,
  patchList: sortedKept.map((p, i) => { const orig = kept.indexOf(p); return { index: i, cx: p.cx, cz: p.cz, extentX: p.extentX, extentZ: p.extentZ, areaM2: p.areaM2, lane: p.lane, memberCount: p.memberCount, origIndex: orig }; })
};

// ---- the ortho preview: request f=json, honour the RETURNED extent/href, overlay candidate cells + patch IDs ----
//
// ArcGIS export silently EXPANDS the returned extent when the requested bbox is not square for the requested pixel size:
// asking for a 1024x1024 PNG over a non-square bbox returned an extent about 15 m wider/taller on each side than the
// request. The audit must therefore never assume the requested bbox is what the image covers: it requests f=json, reads
// `extent` (the server's TRUTH) and `width`/`height`, downloads the returned `href`, and maps every world point through
// the ACTUAL extent. A square f=image is fine; the georeference that matters comes from the returned extent.
const R = 6378137;
const merc = (lat, lon) => [R * (lon * Math.PI / 180), R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))];
const latLonFromMerc = (x, y) => {
  const lon = (x / R) * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
  return { lat, lon };
};

async function fetchOrthoJson(requestBBox) {
  const [xmin, ymin, xmax, ymax] = requestBBox;
  const size = 1024;
  const url = `${ORTHO_SERVICE}?bbox=${xmin},${ymin},${xmax},${ymax}&bboxSR=3857&imageSR=3857&size=${size},${size}&format=png&transparent=false&f=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ortho export (json) ${res.status} ${res.statusText}`);
  const j = await res.json();
  if (!j.href || !j.extent) throw new Error('ortho export json has no href/extent');
  return { url, size, j };
}

async function writeOrthoPreview() {
  // The corridor box in Web Mercator.
  const corners = [[BOX.x0, BOX.z0], [BOX.x1, BOX.z0], [BOX.x0, BOX.z1], [BOX.x1, BOX.z1]]
    .map(([x, z]) => { const q = C.latLonFromWorld(x, z); return merc(q.lat, q.lon); });
  const reqMinX = Math.min(...corners.map((c) => c[0])), reqMaxX = Math.max(...corners.map((c) => c[0]));
  const reqMinY = Math.min(...corners.map((c) => c[1])), reqMaxY = Math.max(...corners.map((c) => c[1]));

  const { url, size, j } = await fetchOrthoJson([reqMinX, reqMinY, reqMaxX, reqMaxY]);
  const ext = j.extent, W = j.width || size, H = j.height || size;
  // Download the server's returned image (not a 2nd differing request).
  const imgRes = await fetch(j.href);
  if (!imgRes.ok) throw new Error(`ortho href ${imgRes.status} ${imgRes.statusText}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  fs.writeFileSync(ORTHO_OUT, buf);

  // World (CITY) -> Mercator -> pixel, through the ACTUAL returned extent. Web Mercator y increases UP, image y down.
  const toPixel = (x, z) => {
    const q = C.latLonFromWorld(x, z); const [mx, my] = merc(q.lat, q.lon);
    const px = ((mx - ext.xmin) / (ext.xmax - ext.xmin)) * W;
    const py = ((ext.ymax - my) / (ext.ymax - ext.ymin)) * H;
    return [px, py];
  };
  // True ground metres per pixel at this latitude: Mercator metres are inflated by 1/cos(lat). The image's own cell is
  // (extent width / W) Mercator metres; the real ground size is that times cos(latitude at the centre).
  const centreLat = latLonFromMerc((ext.xmin + ext.xmax) / 2, (ext.ymin + ext.ymax) / 2).lat;
  const cosLat = Math.cos(centreLat * Math.PI / 180);
  const mercXPerPx = (ext.xmax - ext.xmin) / W, mercYPerPx = (ext.ymax - ext.ymin) / H;
  const groundXPerPx = mercXPerPx * cosLat, groundYPerPx = mercYPerPx * cosLat;

  // Build the annotated overlay SVG (the ortho PNG as the background, cells and patch IDs drawn on top, in pixel space
  // of the actual returned extent). Bounded: one <rect> per accepted cell (<= ~500) plus a label per patch.
  const cellsInImg = [];
  for (const c of sortedCandidates) {
    const [px, py] = toPixel(c.x, c.z);
    if (px >= 0 && px <= W && py >= 0 && py <= H) cellsInImg.push({ px, py, lane: c.lane, patch: c.patch, x: c.x, z: c.z });
  }
  const cellHalf = Math.max(2, (0.5 / Math.max(groundXPerPx, 1e-6)) / 2); // ~0.5 m half-cell in px
  const svg = [];
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  svg.push(`<image href="${path.basename(ORTHO_OUT)}" x="0" y="0" width="${W}" height="${H}"/>`);
  for (const c of cellsInImg) {
    const fill = c.lane === 'oneida' ? '#00e0ff' : '#ffcc00'; // Oneida cyan, Ojibway amber
    svg.push(`<rect x="${(c.px - cellHalf).toFixed(1)}" y="${(c.py - cellHalf).toFixed(1)}" width="${(2 * cellHalf).toFixed(1)}" height="${(2 * cellHalf).toFixed(1)}" fill="${fill}" fill-opacity="0.5" stroke="#000" stroke-opacity="0.35" stroke-width="0.4"/>`);
  }
  sortedKept.forEach((p, i) => {
    const [px, py] = toPixel(p.cx, p.cz);
    if (px < 0 || px > W || py < 0 || py > H) return;
    svg.push(`<text x="${(px + 4).toFixed(1)}" y="${(py - 4).toFixed(1)}" font-family="monospace" font-size="14" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke">P${i}</text>`);
  });
  svg.push('</svg>');
  const svgOut = ORTHO_OUT.replace(/\.png$/, '.svg');
  fs.writeFileSync(svgOut, svg.join(''));

  preview.ortho = {
    service: ORTHO_SERVICE,
    requestUrl: url,
    requestedExtent3857: [reqMinX, reqMinY, reqMaxX, reqMaxY],
    returnedHref: j.href,
    actualExtent3857: ext, // the server's truth: this is what the image covers
    returnedSize: [W, H],
    out: ORTHO_OUT, overlaySvg: svgOut, bytes: buf.length,
    groundMetresPerPixel: +((groundXPerPx + groundYPerPx) / 2).toFixed(4),
    mercatorMetresPerPixel: +((mercXPerPx + mercYPerPx) / 2).toFixed(4),
    centreLatitudeDeg: +centreLat.toFixed(6),
    expandedBeyondRequestM: +((((ext.xmax - ext.xmin) - (reqMaxX - reqMinX)) / 2) * cosLat).toFixed(2),
    note: 'The server expanded the returned extent beyond the requested bbox; every world->pixel mapping uses the ACTUAL returned extent. groundMetresPerPixel is true ground metres (Mercator metres x cos(lat)) at the image centre.'
  };
  // Cells whose (px, py) fall outside the actual returned image are NOT drawn; count them so a reviewer knows.
  preview.ortho.cellsInImage = cellsInImg.length;
  preview.ortho.cellsOutsideImage = sortedCandidates.length - cellsInImg.length;
  const cellPx = cellsInImg.map((c) => ({ patch: c.patch, x: +toPixel(c.x, c.z)[0].toFixed(1), y: +toPixel(c.x, c.z)[1].toFixed(1), sx: c.x, sz: c.z }));
  preview.ortho.cellPixels = cellPx; // explicit georeferenced pixel coordinates for each accepted cell
  console.error(`wrote ${ORTHO_OUT} (${buf.length} B) + ${svgOut}`);
}

if (CHECK) {
  if (fs.existsSync(OUT)) {
    const existing = fs.readFileSync(OUT, 'utf8');
    if (existing === banner) { console.log(`up to date: ${path.relative(ROOT, OUT)}`); process.exit(0); }
    console.error(`drift: ${path.relative(ROOT, OUT)} is not this builder's output`);
    process.exit(1);
  }
  console.error(`missing: ${path.relative(ROOT, OUT)}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(PREVIEW), { recursive: true });
if (WANT_ORTHO) {
  try { await writeOrthoPreview(); } catch (e) { fail(e.message); }
}
fs.writeFileSync(PREVIEW, JSON.stringify(preview, null, 2) + '\n');
fs.writeFileSync(OUT, banner);
console.log(`[garden-cover] counts ${JSON.stringify(counts)}`);
console.log(`[garden-cover] budget ${JSON.stringify(payload.budget)}`);
console.log(`[garden-cover] wrote ${path.relative(ROOT, OUT)} (${(banner.length / 1024).toFixed(1)} KB)`);
console.log(`[garden-cover] wrote ${PREVIEW}`);
