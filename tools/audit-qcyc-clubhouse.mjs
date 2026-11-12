// Queen City Yacht Club clubhouse row-identity source audit (st-sb3r.39, phase 1).
//
// The accepted marina captures still show a generic brown "clubhouse" envelope beside the reviewed white QCYC service
// shed (st-sb3r.33/.34). Before any runtime edit, this audit answers the captain's first question — WHICH rendered row is
// that building, and does its source identity hold? — from committed data, not from pixels.
//
// What it DOES prove (each claim is checked against the committed fixture):
//   * OSM Way 43805118 really is tagged `building=yes` + name "Queen City Yacht Club clubhouse" + `building:levels=2`,
//     imported from NRCan CanVec (NOT a QCYC survey), and its outline lies inside the mapped QCYC marina (Way 193043084);
//   * exactly ONE committed island row carries that OSM id (row 32139), and that row's committed profile is the
//     generic named-service profile (6.5 m from OSM levels, no roof shape, no siding, no appearance) — i.e. the
//     rendered "generic brown box";
//   * the committed native footprint (`nativeFp`) re-projects onto that OSM outline: same centre within sub-metre,
//     comparable extent. This is a consistency check of the committed binding, not a re-run of the builder's matcher.
//
// What it does NOT prove (stated so it cannot be read as more than it is):
//   * it does NOT re-run the builder's native row<->OSM matching; the committed `osm.id` binding is taken as given and
//     only cross-checked (id + centroid vs. the OSM ring + extent), so this is a consistency audit, not a strict
//     identity proof;
//   * the committed OSM fixture holds only the cluster's ways, so `nearestOtherOsmWay` is the nearest way IN THAT FIXTURE
//     and is NOT a "no other OSM way anywhere ties" proof.
//
// It is read-only: it never writes the data file, never runs the dev server and never touches the renderer. Run it as a
// source audit (node tools/audit-qcyc-clubhouse.mjs) or through the committed test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

export const CLUBHOUSE_OSM_WAY = 43805118;
export const MARINA_OSM_WAY = 193043084;
export const CLUBHOUSE_NAME = 'Queen City Yacht Club clubhouse';

// The builder's matcher constants (tools/build-island-buildings.mjs), kept as literals so the audit fails loudly if the
// builder's thresholds move without the audit being revisited.
export const MAX_MATCH = 6;
export const MAX_SIZE_RATIO = 2.0;
export const MIN_OVERLAP = 0.25;

// Area-preserving local frame, identical to the committed `projection`: x = kx * dlon, z = ky * dlat, rotated by theta,
// with z negated to the renderer's world frame (the frame the committed building centres are reported in).
export function projectXY(projection, lon, lat) {
  const x0 = (lon - projection.lon0) * projection.kx;
  const z0 = (lat - projection.lat0) * projection.ky;
  const th = projection.theta;
  const c = Math.cos(th);
  const s = Math.sin(th);
  return { x: x0 * c - z0 * s, z: -(x0 * s + z0 * c) };
}

export function projectRing(projection, ring) {
  return ring.map((p) => {
    const q = projectXY(projection, p[0], p[1]);
    return [q.x, q.z];
  });
}

// Footprint parts (the committed `fp` "yaw,[[u0,u1,v0,v1],...]" string) -> 4 corners per part in the world frame. The
// renderer places a part corner (u,v) at cx + u*cos + v*sin, cz - u*sin + v*cos, exactly as js/buildings.js does.
export function footprintCorners(fp, cx, cz) {
  const comma = fp.indexOf(',');
  const yaw = Number(fp.slice(1, comma));
  // Trim exactly the enclosing brackets of the parts list: "[[..],[..]]]" -> "[[..],[..]]".
  const body = fp.slice(comma + 1).trim().replace(/\]$/, '');
  const parts = JSON.parse(body);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const corners = [];
  for (const [u0, u1, v0, v1] of parts) {
    for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) corners.push([cx + u * c + v * s, cz - u * s + v * c]);
  }
  return { yaw, parts, corners };
}

// Axis-aligned bounds of a world-frame point set, plus its mean centre.
export function ringBox(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, sx = 0, sz = 0;
  for (const [x, z] of ring) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    sx += x; sz += z;
  }
  return {
    minX, maxX, minZ, maxZ,
    cx: sx / ring.length, cz: sz / ring.length,
    bx: (minX + maxX) / 2, bz: (minZ + maxZ) / 2,
    w: maxX - minX, d: maxZ - minZ
  };
}

// The builder's three matcher tests, reproduced. Returns null when a pair is not a legal match, else its score inputs.
export function matchScore(a, b) {
  const centre = Math.hypot(a.cx - b.cx, a.cz - b.cz);
  if (centre > MAX_MATCH) return null;
  const ratio = Math.max(a.w / b.w, b.w / a.w, a.d / b.d, b.d / a.d);
  if (ratio > MAX_SIZE_RATIO) return null;
  const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  if (ox <= 0 || oz <= 0) return null;
  const overlap = (ox * oz) / Math.min(a.w * a.d, b.w * b.d);
  if (overlap < MIN_OVERLAP) return null;
  return { centre, ratio, overlap };
}

export function insideRing(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1];
    const xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

export function auditClubhouse() {
  const fixture = readJson('tools/data/island-outliers.json');
  const projection = fixture.projection;
  const marinaRing = projectRing(projection, fixture.marinaWay.ring);

  // Both committed fixtures are SUBSETS of the captain-local primary cache b.json: island-outliers.json trims to four
  // neighbours, and qcyc-clubhouse-osm.json is a hand-selected six-way cluster. Their `sources.osmBuildings.sha256` is
  // the hash of the ORIGINAL b.json (provenance for where the ways came from), NOT a hash of either subset.
  const osm = readJson('tools/data/qcyc-clubhouse-osm.json');
  const buildings = osm.elements.map((e) => {
    const ring = projectRing(projection, e.geometry.map((p) => [p.lon, p.lat]));
    return { id: e.id, tags: e.tags, ring, box: ringBox(ring) };
  });
  const club = buildings.find((b) => b.id === CLUBHOUSE_OSM_WAY);
  if (!club) throw new Error(`archived OSM does not contain the clubhouse way ${CLUBHOUSE_OSM_WAY}`);
  if (!new RegExp(CLUBHOUSE_NAME, 'i').test(club.tags.name || '')) {
    throw new Error(`OSM way ${CLUBHOUSE_OSM_WAY} is not tagged "${CLUBHOUSE_NAME}" (got ${JSON.stringify(club.tags.name)})`);
  }

  // The committed data the renderer reads (evaluated in a minimal window sandbox, exactly as the runtime does).
  const dataSrc = fs.readFileSync(path.join(ROOT, 'js/waterfront-island-buildings-data.js'), 'utf8');
  const window = {};
  new Function('window', dataSrc)(window);
  const dataset = window.CITY?.ISLAND_BUILDINGS_DATA || null;
  const clubRows = (dataset?.records || []).filter((r) => r.osm && r.osm.id === CLUBHOUSE_OSM_WAY);
  const row = clubRows[0] || null;

  // Native footprint consistency: re-project the committed parts and compare to the OSM outline. The committed fp is
  // the matched two-part L; the OSM outline is the raw nine-vertex ring.
  const fp = row ? footprintCorners(row.fp, row.cx, row.cz) : null;
  const fpBox = fp ? ringBox(fp.corners) : null;
  const osmBox = club.box;

  // The nearest OTHER way IN THIS FIXTURE (not a global tie claim — see the header).
  const nearest = buildings
    .filter((b) => b.id !== CLUBHOUSE_OSM_WAY)
    .map((b) => ({ id: b.id, name: b.tags.name || null, centre: Math.hypot(club.box.cx - b.box.cx, club.box.cz - b.box.cz) }))
    .sort((a, b) => a.centre - b.centre)[0] || null;

  return {
    clubhouseOsmWay: CLUBHOUSE_OSM_WAY,
    clubhouseName: CLUBHOUSE_NAME,
    osmBase: osm.sources?.osmBuildings?.timestamp_osm_base || null,
    footprint: { cx: osmBox.bx, cz: osmBox.bz, w: osmBox.w, d: osmBox.d, vertices: club.ring.length },
    tags: club.tags,
    insideMarina: insideRing(marinaRing, osmBox.bx, osmBox.bz),
    marinaWay: MARINA_OSM_WAY,
    committedRowsClaimingWay: clubRows.length,
    committedRow: row && {
      row: row.row, cx: row.cx, cz: row.cz, fp: row.fp,
      height: row.height, heightSource: row.heightSource, typology: row.typology, category: row.category,
      roof: row.roof, roofType: row.roofType, siding: row.siding, appearance: row.appearance || null
    },
    nativeFootprintConsistency: fp && {
      committedCentre: [row.cx, row.cz],
      osmCentre: [Number(osmBox.bx.toFixed(2)), Number(osmBox.bz.toFixed(2))],
      centreOffsetM: Number(Math.hypot(row.cx - osmBox.bx, row.cz - osmBox.bz).toFixed(2)),
      committedExtent: [Number(fpBox.w.toFixed(1)), Number(fpBox.d.toFixed(1))],
      osmExtent: [Number(osmBox.w.toFixed(1)), Number(osmBox.d.toFixed(1))]
    },
    nearestOtherOsmWayInFixture: nearest,
    proven: 'OSM name/levels/use + inside marina + one committed row + native footprint re-projects onto the OSM outline (consistency, not a matcher re-run)',
    notProven: 're-run of the builder matcher; global absence of another OSM way; any measured QCYC height, bay count or roof pitch'
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(auditClubhouse(), null, 2));
}
