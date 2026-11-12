#!/usr/bin/env node
// tools/audit-island-widths.mjs — read-only audit of the Oneida/Ojibway lane widths (bead st-sb3r.26).
//
// Reports, without editing anything:
//   1. the two runtime width defaults (GEO.roads from data/toronto-geodata.bin; ISLAND_LANES_DATA.runs[].w);
//   2. the actual visible ground width (gap between the raised curb islands) on the runtime binary;
//   3. the authoritative City of Toronto "Edge of Roadway" footprint width for the two lane polygons, from the local
//      cached build input (~/.cache/slop-toronto/raw/edge-of-roadway-4326.gpkg, NOT in the repo) or a supplied GeoJSON.
//
// usage: node tools/audit-island-widths.mjs [--road-edge <edge-of-roadway.geojson>] [--json]
//
// The City layer is "Topographic Mapping – Edge of Roadway" (OGL – Toronto), the same dataset tools/fetch-roadway.mjs
// uses. Geometry maintenance for these features is 2021-01-01 (not a 2024 survey). See docs/waterfront-island-width-audit.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The expected City Edge-of-Roadway OBJECTIDs for the two lanes (validated, not silently re-picked).
const LANES = [
  { name: 'Oneida Avenue', osmWay: 13541126, runId: 42, cityObjectId: 24202 },
  { name: 'Ojibway Avenue', osmWay: 13541122, runId: 41, cityObjectId: 53745 }
];
const ISLAND_BBOX = [-79.362, 43.626, -79.356, 43.630]; // lon/lat, the Algonquin Island window

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const reIdx = args.indexOf('--road-edge');
const roadEdgeArg = reIdx >= 0 ? args[reIdx + 1] : null;

const readBin = (rel) => {
  let u8 = new Uint8Array(fs.readFileSync(path.join(ROOT, rel)));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  return u8;
};

const { decodeGeo } = await import(new URL('../js/geodata-loader.js', import.meta.url));
const u8 = readBin('data/toronto-geodata.bin');
const { GEO } = decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
const P = GEO.frame.projection;

// --- projection: EPSG:3857 -> lon/lat -> the geodata world frame (tools/geo-base.mjs gridUV, z negated) --------------
const merc2ll = (x, y) => [x / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI];
const toWorld = (lon, lat) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
  const c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s - (P.ox || 0), -(e * s + n * c) - (P.oz || 0)];
};

// --- geometry helpers. pip/rayHit/widthAcross take a FLAT [x,z,x,z,...] ring; ringArea/ringPerim take nested [[x,z]].
const pip = (px, pz, o) => {
  let inside = false;
  for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) {
    const xi = o[i], zi = o[i + 1], xj = o[j], zj = o[j + 1];
    if (((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
};
const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
};
// Width across a flat ring at a point on/near its boundary: step along ±normal until the point leaves the polygon.
const widthAcross = (px, pz, nx, nz, flat) => {
  let pos = null, neg = null;
  for (let d = 0.05; d <= 40; d += 0.05) {
    if (pos === null && !pip(px + nx * d, pz + nz * d, flat)) pos = d;
    if (neg === null && !pip(px - nx * d, pz - nz * d, flat)) neg = d;
    if (pos !== null && neg !== null) break;
  }
  if (pos === null || neg === null) return null;
  return pos + neg - 0.05; // both steps include the 0.05 m start offset
};
const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(a) / 2; };
const ringPerim = (r) => { let p = 0; for (let i = 0; i + 1 < r.length; i++) p += Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]); return p; };
const stats = (vals) => {
  const v = vals.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return { n: v.length, min: +v[0].toFixed(2), median: +v[Math.floor(v.length / 2)].toFixed(2), max: +v[v.length - 1].toFixed(2) };
};

// --- 1. runtime width defaults ---------------------------------------------------------------------------------------
const lanesData = (() => {
  const ctx = { window: { CITY: {} }, Math, Number, Array, Set, Map, Uint8Array, Float32Array };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/waterfront-island-lanes-data.js'), 'utf8'), ctx);
  return ctx.window.CITY.ISLAND_LANES_DATA;
})();

const runtime = LANES.map((lane) => {
  const road = GEO.roads.find((r) => r[0] === lane.name);
  const run = (lanesData?.runs || []).find((r) => r.id === lane.runId && (r.ways || []).includes(lane.osmWay));
  return {
    name: lane.name,
    osmWay: lane.osmWay,
    geoRoadsWidthM: road ? road[1] : null,
    islandLanesWidthM: run ? run.w : null,
    islandLanesWidthSource: run ? run.wSource : null,
    pavingMaskBandM: run && Number.isFinite(run.w) ? +(run.w).toFixed(2) : null
  };
});

// --- 2. visible ground width (gap between raised curb islands) on the runtime binary ---------------------------------
const blockAt = (px, pz) => {
  for (const b of GEO.blocks) {
    const o = b[0]; // flat ring
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < o.length; i += 2) {
      if (o[i] < minx) minx = o[i]; if (o[i] > maxx) maxx = o[i];
      if (o[i + 1] < minz) minz = o[i + 1]; if (o[i + 1] > maxz) maxz = o[i + 1];
    }
    if (px < minx || px > maxx || pz < minz || pz > maxz) continue;
    if (pip(px, pz, o)) return b;
  }
  return null;
};
const ground = LANES.map((lane) => {
  const road = GEO.roads.find((r) => r[0] === lane.name);
  if (!road) return { name: lane.name, corridor: null };
  const flat = road[6];
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const widths = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (!(L > 1e-6)) continue;
    const nx = -dz / L, nz = dx / L;
    for (const t of [0.25, 0.5, 0.75]) {
      const px = ax + dx * t, pz = az + dz * t;
      if (blockAt(px, pz)) continue; // a point on a slab is not a road cross-section
      let lp = null, rp = null;
      for (let d = 0.05; d <= 25; d += 0.05) {
        if (lp === null && blockAt(px + nx * d, pz + nz * d)) lp = d;
        if (rp === null && blockAt(px - nx * d, pz - nz * d)) rp = d;
        if (lp !== null && rp !== null) break;
      }
      if (lp !== null && rp !== null) widths.push(lp + rp);
    }
  }
  return { name: lane.name, corridor: stats(widths) };
});

// --- 3. City Edge of Roadway footprint width -------------------------------------------------------------------------
function loadRoadEdge() {
  if (roadEdgeArg) {
    const d = JSON.parse(fs.readFileSync(roadEdgeArg, 'utf8'));
    return { source: roadEdgeArg, features: d.features || [] };
  }
  const gpkg = path.join(os.homedir(), '.cache/slop-toronto/raw/edge-of-roadway-4326.gpkg');
  if (!fs.existsSync(gpkg)) return { source: null, features: [], note: 'local cached Edge of Roadway GPKG not found; pass --road-edge <geojson>' };
  const tmp = path.join(os.tmpdir(), `island-road-edge-${process.pid}.geojson`);
  try {
    execFileSync('ogr2ogr', ['-f', 'GeoJSON', tmp, gpkg, '-spat', ...ISLAND_BBOX.map(String), '-t_srs', 'EPSG:3857'], { stdio: 'ignore' });
    const d = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    return { source: gpkg, features: d.features || [] };
  } catch (e) {
    return { source: gpkg, features: [], note: `ogr2ogr failed: ${e.message}` };
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}
const edge = loadRoadEdge();
const edgeRings = edge.features.map((f) => {
  const g = f.geometry;
  const rings = g.rings || (g.type === 'MultiPolygon' ? g.coordinates.flat(1) : g.coordinates);
  const props = f.properties || f.attributes || {};
  const ring = rings[0].map(([x, y]) => { const [lo, la] = merc2ll(x, y); return toWorld(lo, la); }); // nested [[x,z]]
  const flat = ring.flat(); // flat [x,z,x,z,...] for pip/widthAcross
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  return { objectId: props.OBJECTID, subtype: props.SUBTYPE_DESC, maint: props.LAST_GEOMETRY_MAINT, ring, flat, cx: cx / ring.length, cz: cz / ring.length, perim: ringPerim(ring) };
}).filter((r) => r.subtype === 'Road Edge');

const city = LANES.map((lane) => {
  const road = GEO.roads.find((r) => r[0] === lane.name);
  const flat = road ? road[6] : null;
  const pts = [];
  if (flat) for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  // Bind the expected OBJECTID. If the source changes and it is absent, fall back to the long Road Edge ring whose
  // centroid is nearest the lane midpoint, and flag the mismatch (never silently claim a different polygon).
  let best = edgeRings.find((r) => r.objectId === lane.cityObjectId) || null;
  let bound = best ? 'expected OBJECTID' : null;
  if (!best) {
    const midX = pts.length ? (pts[0][0] + pts[pts.length - 1][0]) / 2 : 0;
    const midZ = pts.length ? (pts[0][1] + pts[pts.length - 1][1]) / 2 : 0;
    for (const r of edgeRings) {
      if (r.perim < 100) continue;
      const md = Math.hypot(r.cx - midX, r.cz - midZ);
      if (!best || md < best.md) best = { ...r, md };
    }
    bound = best ? 'nearest-centroid fallback (expected OBJECTID absent)' : null;
  }
  if (!best) return { name: lane.name, objectId: null, expectedObjectId: lane.cityObjectId, bound: null };
  const area = ringArea(best.ring), perim = ringPerim(best.ring);
  // cross-sections along the lane where the centre line is inside the polygon (flat ring!)
  const widths = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (!(L > 1e-6)) continue;
    const nx = -dz / L, nz = dx / L;
    for (let t = 0.05; t <= 0.95; t += 0.05) {
      const px = ax + dx * t, pz = az + dz * t;
      if (!pip(px, pz, best.flat)) continue;
      const w = widthAcross(px, pz, nx, nz, best.flat);
      if (w != null) widths.push(w);
    }
  }
  // Fallback (the OSM line is offset from the City polygon, so it can be entirely outside): measure the polygon's own
  // cross-sections, perpendicular to its boundary at each edge midpoint, independent of the OSM line.
  let alongPolygon = null;
  if (!widths.length) {
    const ring = best.ring;
    for (let k = 0; k + 1 < ring.length; k++) {
      const p = ring[k], q = ring[k + 1];
      const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
      if (!(L > 1e-6)) continue;
      const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
      const nx = -dz / L, nz = dx / L;
      const w = widthAcross(mx, mz, nx, nz, best.flat);
      if (w != null && w < 30) widths.push(w);
    }
    alongPolygon = widths.length > 0;
  }
  return {
    name: lane.name,
    objectId: best.objectId,
    expectedObjectId: lane.cityObjectId,
    bound,
    geometryMaintained: best.maint,
    centroidToOsmMidM: best.md != null ? +best.md.toFixed(2) : null,
    areaPerimWidthM: +(2 * area / perim).toFixed(2),
    crossSection: stats(widths),
    crossSectionBasis: alongPolygon ? 'polygon boundary (OSM line offset)' : 'along the OSM centre line'
  };
});

const report = {
  source: 'docs/waterfront-island-width-audit.md',
  runtime,
  visibleGround: ground,
  cityEdgeOfRoadway: { source: edge.source, note: edge.note || null, lanes: city }
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('Oneida / Ojibway lane-width audit (read-only)\n');
  console.log('Runtime width defaults:');
  for (const r of runtime) console.log(`  ${r.name}: GEO.roads ${r.geoRoadsWidthM} m | ISLAND_LANES_DATA ${r.islandLanesWidthM} m (${r.islandLanesWidthSource}) | paving band ${r.pavingMaskBandM} m`);
  console.log('\nVisible ground width (gap between raised curb islands, runtime binary):');
  for (const g of ground) console.log(`  ${g.name}: ${g.corridor ? `${g.corridor.min}–${g.corridor.max} m, median ${g.corridor.median} m (n=${g.corridor.n})` : 'no finite cross-section'}`);
  console.log('\nCity Edge of Roadway footprint:');
  if (!edge.source) console.log(`  ${edge.note}`);
  else {
    console.log(`  source: ${edge.source} (local cached build input, not in the repo)`);
    for (const c of city) {
      if (c.objectId == null) { console.log(`  ${c.name}: no Road Edge polygon found (expected OBJECTID ${c.expectedObjectId})`); continue; }
      const ok = c.objectId === c.expectedObjectId ? 'OK' : `MISMATCH (expected ${c.expectedObjectId})`;
      console.log(`  ${c.name}: OBJECTID ${c.objectId} [${ok}] (maint ${c.geometryMaintained}) | area/perimeter ${c.areaPerimWidthM} m | cross-section ${c.crossSection ? `${c.crossSection.min}–${c.crossSection.max} m, median ${c.crossSection.median} m (n=${c.crossSection.n})` : 'none'} | basis: ${c.crossSectionBasis}`);
    }
  }
  console.log('\nNote: City geometry metadata records maintenance in 2021; acquisition date is unverified. OSM-to-City alignment remains unresolved.');
}
