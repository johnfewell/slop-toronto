// tools/audit-biidaasige-ground.mjs — a NEUTRAL, read-only CPU inventory of what the committed Toronto geodata carries
// over Biidaasige Park (Ookwemin Minising / the Lower Don Lands). It records FACTS and their uncertainty; it does NOT
// decide "stale", "obsolete", "blocker" or "suppress". Water inside the park, buildings inside the park and zone:* land
// cover are all recorded as raw counts/polygons for a human to interpret against sources and photos. Bead st-bmyv.2,
// docs/biidaasige-terrain.md. It decodes the SAME packed files the page loads — data/toronto-geodata.bin (the "detail"
// frame) and data/frames/eglinton/toronto-geodata.bin (the default desktop frame) — with the page's own decoder
// (js/geodata-loader.js), never a guessed source file, and cross-checks against the raw Overpass cache
// (~/.cache/slop-toronto/osm/osm_land.json) when it is present.
//
// It records, per frame, WITHOUT changing any shared runtime:
//   1. Does the frame's box contain the park at all? (frame coverage)
//   2. Does the committed GEO carry a `park` area named "Biidaasige Park", and does its ring match current OSM?
//   3. What other land cover overlaps the park's footprint — recorded by kind and area, NOT judged industrial/stale.
//   4. What buildings (City 3D Massing rows) sit inside the park footprint, listed as CANDIDATES to identify individually
//      (source identity + a 2025/2026 photo) — NOT assumed old sheds. Some are native to the park (e.g. the Fire Hall)
//      or a crane base; the height alone proves nothing.
//   5. Where the Don River / Keating Channel centrelines and the water polygons are — recorded, not labelled stale.
//   6. What the game's own water mask reports over the footprint — a fraction of samples, NOT a defect count.
//
// The native world is FLAT (street datum y = 0), but the REAL park has a west promontory (~9 m, MVVA) and badland levels
// and ramps; flat native ground is not evidence the real park is flat, nor that no height work will ever be needed.
//
// Output: a JSON summary, printed to stdout, plus a small text table to stderr. Exit code 0 always: this is an audit,
// not a gate. usage: node tools/audit-biidaasige-ground.mjs [--json] [--emit-data]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodeGeo } from '../js/geodata-loader.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JSON_ONLY = process.argv.includes('--json');
const EMIT = process.argv.includes('--emit-data');
const note = (...a) => { if (!JSON_ONLY && !EMIT) console.error(...a); };

// The park's own name, as the City of Toronto and OpenStreetMap carry it (opening day 2025-07-19, way/813717630).
const PARK_NAME = 'Biidaasige Park';
// The world box we audit (a generous frame around the park; the park's true ring is read from the data, not this box).
// Park OSM ring (2026-11-10) projects to world x 1700..2963, z 303..944; pad it so the water and neighbours are seen.
const AUDIT_BOX = { x0: 1500, x1: 3150, z0: 150, z1: 1150 };

async function loadBin(rel) {
  let u8 = new Uint8Array(fs.readFileSync(path.join(ROOT, rel)));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
}

const inBox = (b, x, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
const toPts = (flat) => { const o = []; for (let i = 0; i < flat.length; i += 2) o.push([flat[i], flat[i + 1]]); return o; };
const ringBox = (pts) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { x0, x1, z0, z1 };
};
const ringArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; a += x1 * z2 - x2 * z1; } return Math.abs(a / 2); };
// point-in-ring (even-odd); rings are flat world metres
function pointInRing(px, pz, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const boxOverlap = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;

// The same projection the page uses (GEO.frame.projection), so world <-> WGS84 is not re-derived by guesswork.
function makeProjection(P) {
  const c = Math.cos(P.theta), s = Math.sin(P.theta);
  return {
    worldFromLatLon(lat, lon) {
      const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
      return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
    },
    latLonFromWorld(x, z) {
      const u = x + P.ox, v = z + P.oz;
      return { lat: P.lat0 + (-u * s - v * c) / P.ky, lon: P.lon0 + (u * c - v * s) / P.kx };
    }
  };
}

// The raw Overpass land cache, if this machine has it: the pre-filter source the build read. Optional, never required.
function readRawLand() {
  const file = path.join(os.homedir(), '.cache', 'slop-toronto', 'osm', 'osm_land.json');
  if (!fs.existsSync(file)) return null;
  try {
    const els = JSON.parse(fs.readFileSync(file, 'utf8')).elements || [];
    return els.filter((e) => Array.isArray(e.geometry) && e.geometry.length >= 3);
  } catch { return null; }
}
// The build's own land-cover classifier (tools/geo-land.mjs `classify`), copied verbatim so the audit says exactly what
// the build would say, not an approximation.
function classify(t) {
  if (t.natural === 'water' || /^(reservoir|basin)$/.test(t.landuse || '') || t.water) return 'water';
  if (/^(forest)$/.test(t.landuse || '') || t.natural === 'wood') return 'wood';
  if (/^(scrub|grassland|heath)$/.test(t.natural || '') || /^(meadow|greenfield)$/.test(t.landuse || '')) return 'scrub';
  if (t.leisure === 'golf_course') return 'golf';
  if (/^(pitch|track|stadium|sports_centre)$/.test(t.leisure || '')) return 'pitch';
  if (/^(park|garden|recreation_ground|nature_reserve|playground)$/.test(t.leisure || '') || /^(recreation_ground|grass|village_green)$/.test(t.landuse || '')) return 'park';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (/^(residential|commercial|retail|industrial|military|religious|construction|brownfield|institutional|education)$/.test(t.landuse || '')) return `zone:${t.landuse}`;
  return null;
}

const detail = await loadBin('data/toronto-geodata.bin');
const eglinton = await loadBin('data/frames/eglinton/toronto-geodata.bin');
const report = { generatedFrom: 'data/toronto-geodata.bin + data/frames/eglinton/toronto-geodata.bin (page decoder)', frames: {} };

for (const [tag, { GEO }] of [['detail', detail], ['eglinton', eglinton]]) {
  const F = GEO.frame;
  const proj = makeProjection(F.projection);
  const out = { frame: { detail: F.detail, projection: F.projection } };
  out.frameCoversAuditBox = boxOverlap({ x0: F.detail.x0, x1: F.detail.x1, z0: F.detail.z0, z1: F.detail.z1 }, AUDIT_BOX);

  // (2) the named park area the committed GEO carries
  const parkArea = GEO.areas.find((a) => a[0] === 'park' && a[1] === PARK_NAME);
  const parkPts = parkArea ? toPts(parkArea[2]) : null;
  out.park = parkArea ? {
    present: true, points: parkPts.length, areaM2: Math.round(ringArea(parkPts)), acres: +(ringArea(parkPts) / 4046.86).toFixed(1),
    box: ringBox(parkPts), wgsBbox: (() => { const b = ringBox(parkPts); const sw = proj.latLonFromWorld(b.x0, b.z1), ne = proj.latLonFromWorld(b.x1, b.z0); return [+sw.lat.toFixed(5), +sw.lon.toFixed(5), +ne.lat.toFixed(5), +ne.lon.toFixed(5)]; })()
  } : { present: false };

  // (3) what land cover overlaps the park's own footprint — recorded by kind/area, NOT judged. zone:* areas here may map
  // to real ground the park really has (badlands, working yards) or to land north of the ring; only the renderer can say.
  const overlaps = [];
  for (const a of GEO.areas) {
    if (a[1] === PARK_NAME) continue;
    const pts = toPts(a[2]);
    if (!boxOverlap(ringBox(pts), out.park.box || AUDIT_BOX)) continue;
    // does any vertex of a fall inside the park ring, or vice versa at the centroid?
    const inside = parkPts && pts.some(([x, z]) => pointInRing(x, z, parkPts));
    overlaps.push({ kind: a[0], name: a[1] || '', insidePark: inside, areaM2: Math.round(ringArea(pts)) });
  }
  out.landOverPark = overlaps.filter((o) => o.insidePark).sort((a, b) => b.areaM2 - a.areaM2);

  // (4) buildings (City 3D Massing rows) inside the park footprint — CANDIDATES, not assumed-obsolete. A building here
  // may be native to the park (the Fire Hall, a crane base) or a real keep; each needs its own source identity and a
  // 2025/2026 photo before any judgement. Kind and height are recorded, not interpreted.
  const bldg = [];
  for (const b of GEO.buildings) {
    const [cx, cz, , , h, kind] = b;
    if (!parkPts || !pointInRing(cx, cz, parkPts)) continue;
    bldg.push({ x: +cx.toFixed(0), z: +cz.toFixed(0), h: +h.toFixed(1), kind, name: b[10] || '' });
  }
  out.buildingsInPark = bldg.sort((a, b) => b.h - a.h);

  // (5) rivers/streams through the box
  out.rivers = GEO.streams.filter((s) => s[3] && toPts(s[3]).some(([x, z]) => inBox(AUDIT_BOX, x, z))).map((s) => {
    const pts = toPts(s[3]);
    return { name: s[0] || '(unnamed)', width: s[1], kind: s[2], points: pts.length, crossesPark: parkPts ? pts.some(([x, z]) => pointInRing(x, z, parkPts)) : false };
  });

  // (6) the game's own water mask, decoded exactly as js/city-grid.js `maskedByWater` does (4 m cells, row runs
  // alternating dry/wet from dry, base64 Uint16 lengths), then sampled over the park footprint. This is a SAMPLE
  // FRACTION, not a defect count: wet samples over the park are expected where the new river and wetlands are park
  // features. Individual prop placements still need their own water-clearance check; a high fraction proves nothing.
  out.waterSampling = (() => {
    const W = GEO.waterMask;
    if (!W || !parkPts) return null;
    const bin = Buffer.from(W.runs, 'base64');
    const runs = new Uint16Array(bin.length / 2);
    for (let i = 0; i < runs.length; i++) runs[i] = bin[2 * i] | (bin[2 * i + 1] << 8);
    const data = new Uint8Array(W.w * W.h);
    let k = 0;
    for (let j = 0; j < W.h; j++) {
      let i = 0, v = 0;
      while (i < W.w) {
        const n = runs[k++];
        if (v) data.fill(1, j * W.w + i, j * W.w + i + n);
        i += n; v ^= 1;
      }
      if (v === 0 && runs[k] === 0) k++;
    }
    const wetAt = (x, z) => {
      const ix = Math.floor((x - W.x0) / W.res), iz = Math.floor((z - W.z0) / W.res);
      return ix >= 0 && ix < W.w && iz >= 0 && iz < W.h && data[iz * W.w + ix] === 1;
    };
    let wet = 0, total = 0;
    for (let z = Math.ceil(out.park.box.z0); z <= out.park.box.z1; z += 8) {
      for (let x = Math.ceil(out.park.box.x0); x <= out.park.box.x1; x += 8) {
        if (!pointInRing(x, z, parkPts)) continue;
        total++; if (wetAt(x, z)) wet++;
      }
    }
    return { wetCells: wet, dryCells: total - wet, total, wetFraction: +(wet / Math.max(1, total)).toFixed(3) };
  })();

  report.frames[tag] = out;
}

// Raw OSM cross-check (optional): does the committed park ring match current OSM way/813717630, and what land the
// pre-filter source tags zone:* near the park. The zone:* list is an INVENTORY, not a "stale" verdict — the polygons may
// cover land outside the park or real working areas; nothing here implies deletion.
report.osmCrossCheck = (() => {
  const els = readRawLand();
  if (!els) return { available: false, note: 'raw Overpass cache not on this machine (~/.cache/slop-toronto/osm/osm_land.json)' };
  const parkEl = els.find((e) => (e.tags || {}).name === PARK_NAME);
  const P = detail.GEO.frame.projection, proj = makeProjection(P);
  if (!parkEl) return { available: true, parkWay: null };
  const osmPts = parkEl.geometry.map((p) => proj.worldFromLatLon(p.lat, p.lon));
  const osmBox = ringBox(osmPts), osmArea = ringArea(osmPts);
  const geoPts = (() => { const a = detail.GEO.areas.find((x) => x[0] === 'park' && x[1] === PARK_NAME); return a ? toPts(a[2]) : null; })();
  // max deviation of an OSM vertex from the committed ring (rough: nearest segment distance)
  const segDist = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(px - (ax + t * dx), pz - (az + t * dz)); };
  const polyDist = (px, pz, poly) => { let m = Infinity; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; m = Math.min(m, segDist(px, pz, a[0], a[1], b[0], b[1])); } return m; };
  const dev = geoPts ? osmPts.map((p) => polyDist(p[0], p[1], geoPts)) : [];
  // zone:* land the raw source carries near the park — an inventory, not a verdict (see the header)
  const zoneNear = els.filter((e) => {
    const k = classify(e.tags || {}); if (!k || !k.startsWith('zone:')) return false;
    const pts = e.geometry.map((p) => proj.worldFromLatLon(p.lat, p.lon));
    return boxOverlap(ringBox(pts), osmBox) && polyDist(pts[0][0], pts[0][1], osmPts) < 300;
  }).map((e) => ({ id: `way/${e.id}`, kind: classify(e.tags), name: e.tags.name || '' }));
  return {
    available: true,
    parkWay: { id: `way/${parkEl.id}`, tags: parkEl.tags, osmPoints: osmPts.length, osmAreaM2: Math.round(osmArea), osmAcres: +(osmArea / 4046.86).toFixed(1), osmBox },
    ringMatch: dev.length ? { meanDeviationM: +(dev.reduce((a, b) => a + b, 0) / dev.length).toFixed(2), maxDeviationM: +Math.max(...dev).toFixed(2) } : null,
    zoneAreasNearPark: zoneNear
  };
})();

// --emit-data: rewrite js/biidaasige-ground-data.js with the EXACT world polygons the committed geodata currently
// carries over the park (the park ring, the water polygons whose vertices fall inside it, the zone:* land that overlaps
// it, the Don's channel and Keating Channel). This is a READ-ONLY export of the current features for inspection and for
// individual footprint checks — NOT approved replacement data, and NOT a suppression list. Never a guessed rectangle;
// the park ring is verified against current OSM below.
if (EMIT) {
  const { GEO } = detail;
  const parkPts = (() => { const a = GEO.areas.find((x) => x[0] === 'park' && x[1] === PARK_NAME); return a ? toPts(a[2]) : null; })();
  if (!parkPts) throw new Error('Biidaasige park ring not in the detail frame; cannot emit data');
  const q1 = (v) => Math.round(v * 10) / 10;
  const toPts1 = (flat) => { const o = []; for (let i = 0; i < flat.length; i += 2) o.push([q1(flat[i]), q1(flat[i + 1])]); return o; };
  const pbox = ringBox(parkPts);
  const waters = [];
  for (const a of GEO.areas) {
    if (a[0] !== 'water') continue;
    const pts = toPts1(a[2]);
    if (pts.length === 0 || pts.length > 3000) continue; // skip the lake (thousands of points)
    if (pts.some(([x, z]) => pointInRing(x, z, parkPts))) waters.push({ areaM2: Math.round(ringArea(pts)), ring: pts });
  }
  const zoneOverlap = [];
  for (const a of GEO.areas) {
    if (!/^zone:(brownfield|construction|industrial)$/.test(a[0])) continue;
    const pts = toPts1(a[2]);
    if (!boxOverlap(ringBox(pts), pbox)) continue;
    if (pts.some(([x, z]) => pointInRing(x, z, parkPts)) || parkPts.some(([x, z]) => pointInRing(x, z, pts))) zoneOverlap.push({ kind: a[0].slice(5), name: a[1] || '', areaM2: Math.round(ringArea(pts)), ring: pts });
  }
  // candidate buildings: centroids inside the ring, labelled CANDIDATES (identity/photo needed before any judgement)
  const bldgCandidates = [];
  for (const b of GEO.buildings) {
    const [cx, cz, , , h, kind] = b;
    if (!pointInRing(cx, cz, parkPts)) continue;
    bldgCandidates.push({ x: +cx.toFixed(1), z: +cz.toFixed(1), h: +h.toFixed(1), kind, name: b[10] || '' });
  }
  const don = toPts1(GEO.streams.find((s) => s[0] === 'Don River' && s[2] === 'river')[3]);
  const keating = toPts1(GEO.streams.find((s) => s[0] === 'Keating Channel')[3]);
  const flat = (pts) => pts.flatMap(([x, z]) => [x, z]);
  const data = {
    version: 1,
    kind: 'read-only inventory of current committed features (not replacement data, not a suppression list)',
    source: {
      name: 'Biidaasige Park ground inventory (audit st-bmyv.2)', park: { osm: 'way/813717630', opened: '2025-07-19', ringAcres: +(ringArea(parkPts) / 4046.86).toFixed(1), ringAreaM2: Math.round(ringArea(parkPts)), openedAcres2026: 60, futureAcres: 5 },
      note: 'A neutral, read-only copy of the rings the committed Toronto geodata (data/toronto-geodata.bin via js/geodata-loader.js) currently carries over the park, not a guessed rectangle and not approved replacement geometry: the park ring matches current OSM way/813717630 to under 1 m, and the water/zone rings are exactly the current features (water inside the park is expected — the new river and wetlands are park features, not a defect). candidates* are CANDIDATES needing source identity and a photo, not obsolete features. Read by tools/audit-biidaasige-ground.mjs; nothing in the runtime loads it, and no shared-runtime change is approved.',
      projection: GEO.frame.projection
    },
    parkRing: flat(parkPts),
    waterRingsInPark: waters.map((w) => ({ areaM2: w.areaM2, ring: flat(w.ring) })),
    zoneAreasOverlappingPark: zoneOverlap.map((o) => ({ kind: o.kind, name: o.name, areaM2: o.areaM2, ring: flat(o.ring) })),
    buildingCandidatesInPark: bldgCandidates,
    rivers: { donRiver: flat(don), keatingChannel: flat(keating) }
  };
  const header = `// js/biidaasige-ground-data.js — GENERATED by tools/audit-biidaasige-ground.mjs --emit-data, do not edit by hand.
// A neutral, READ-ONLY inventory of the rings the committed Toronto geodata currently carries over Biidaasige Park
// (Ookwemin Minising / the Lower Don Lands), audited by bead st-bmyv.2 (docs/biidaasige-terrain.md). Each ring is copied
// verbatim from the page's decoded data/toronto-geodata.bin (js/geodata-loader.js) — the park ring matches current
// OpenStreetMap way/813717630 (2025-07-19) to within 1 m — never a guessed rectangle.
// It is NOT approved replacement data and NOT a suppression list: water inside the park is expected (the new river and
// wetlands are park features); buildings inside it are CANDIDATES to identify individually (some are native, e.g. the
// Fire Hall); zone:* overlap is recorded, not judged. Nothing in the runtime loads it; no shared-runtime change approved.
// 1 unit = 1 m, world x east, z south; rings are flat [x0, z0, x1, z1, ...] arrays (as the rest of the city).
(function () {
window.CITY = window.CITY || {};
window.CITY.BIIDAASIGE_GROUND_DATA = ${JSON.stringify(data)};
})();
`;
  fs.writeFileSync(path.join(ROOT, 'js/biidaasige-ground-data.js'), header);
  note(`wrote js/biidaasige-ground-data.js (${header.length} bytes)`);
  process.exit(0);
}

process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (!JSON_ONLY) {
  note('\nBiidaasige ground audit — detail frame:');
  const d = report.frames.detail;
  note(`  park present: ${d.park.present}${d.park.present ? ` (${d.park.acres} acres, ${d.park.areaM2} m², world box ${JSON.stringify(d.park.box)})` : ''}`);
  note(`  land cover overlapping the park footprint (recorded, not judged): ${d.landOverPark.map((o) => `${o.kind}${o.name ? ' "' + o.name + '"' : ''} (${o.areaM2} m²)`).join('; ') || 'none'}`);
  note(`  water-mask sample fraction over the park: ${((d.waterSampling?.wetFraction ?? 0) * 100).toFixed(1)}% wet (a fraction, not a defect — the new river/wetlands are park features)`);
  note(`  building CANDIDATES inside the park (identify individually; some are native): ${d.buildingsInPark.length}${d.buildingsInPark.length ? `, tallest ${d.buildingsInPark[0].h} m` : ''}`);
  note(`  river centrelines through the box: ${d.rivers.map((r) => `${r.name}${r.crossesPark ? ' (inside park)' : ''}`).join('; ') || 'none'}`);
  note(`  eglinton frame covers audit box: ${report.frames.eglinton.frameCoversAuditBox}, park present: ${report.frames.eglinton.park.present}`);
  note(`  OSM cross-check: ${report.osmCrossCheck.available ? `ring max deviation ${report.osmCrossCheck.ringMatch?.maxDeviationM} m; ${report.osmCrossCheck.zoneAreasNearPark.length} zone:* areas near the park (inventory, not a verdict)` : report.osmCrossCheck.note}`);
}
