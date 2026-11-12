// tools/build-biidaasige-park-data.mjs
// Builds js/biidaasige-park-data.js for Biidaasige Park (Port Lands, Toronto) from CHECKED-IN fixtures:
//
//   tools/fixtures/biidaasige/osm-verified.json     the park polygon, the verified feature subset, water rings
//   tools/fixtures/biidaasige/osm-supplement.json    broader OSM re-filtered to the park (benches, bins, fountains, fire pit)
//   tools/fixtures/biidaasige/osm-equipment.json     current playground=* structures/equipment raw extract (audit trail)
//   tools/fixtures/biidaasige/official-catalog.json  official-source features with no mapped geometry (lat/lon null)
//   tools/fixtures/biidaasige/coverage.json          request-to-status coverage for every requested category
//
// The OSM fixtures are current OpenStreetMap extracts (2026-11-10) already clipped to the park; no guess is added at
// build time. Every built position is a current OSM node/way with its ref and raw lat/lon ring. Official-source
// features without such geometry stay lat=null/lon=null. See docs/biidaasige-park.md.
//
//   node tools/build-biidaasige-park-data.mjs          # write js/biidaasige-park-data.js
//   node tools/build-biidaasige-park-data.mjs --check  # exit 1 if the committed file is stale
//
// Data © OpenStreetMap contributors (ODbL); City of Toronto; Waterfront Toronto. No map or photo images embedded.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const fixture = (name) => JSON.parse(read(`tools/fixtures/biidaasige/${name}`));

// The city projection, read from the committed geodata exactly as js/city-config.js does.
const geodata = (() => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(read('js/toronto-geodata.js'), context);
  return context.window.CITY.GEO.frame.projection;
})();

const BUNDLE = fixture('osm-verified.json');
const SUPPLEMENT = fixture('osm-supplement.json');
const EQUIPMENT = fixture('osm-equipment.json');
const UNVERIFIED = fixture('official-catalog.json');
const COVERAGE = fixture('coverage.json');

const PHASES = new Set(['2025', '2026', 'future']);
const GEOMETRY_TYPES = new Set(['point', 'polygon', 'line']);
const ORIENTATION_SOURCES = new Set(['osm-footprint-long-axis', 'osm-line-endpoints']);

// Haversine metres, used only to sanity-check a two-endpoint cableway length.
function haversineM(a, b) {
  const R = 6371008.8, rad = Math.PI / 180;
  const la1 = a[0] * rad, lo1 = a[1] * rad, la2 = b[0] * rad, lo2 = b[1] * rad;
  const d = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(d));
}

function ringClosed(ring) {
  const a = ring[0], b = ring[ring.length - 1];
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}
function insideBBox(lat, lon, b, pad = 0.0002) {
  return lat > b.minLat - pad && lat < b.maxLat + pad && lon > b.minLon - pad && lon < b.maxLon + pad;
}

const seen = new Set();
function claim(id) {
  if (seen.has(id)) throw new Error(`duplicate feature id ${id}`);
  seen.add(id);
}

// ---- verified features (park geometry) ----
const parkBBox = BUNDLE.park.boundingBox;
for (const f of BUNDLE.features.concat(BUNDLE.context)) {
  if (!f || typeof f.id !== 'string' || !f.id) throw new Error('verified: feature without id');
  claim(f.id);
  if (!PHASES.has(f.phase)) throw new Error(`${f.id}: bad phase ${f.phase}`);
  if (!/^(node|way)\/\d+$/.test(f.ref || '')) throw new Error(`${f.id}: missing OSM ref`);
  if (typeof f.lat !== 'number' || typeof f.lon !== 'number' || !Number.isFinite(f.lat) || !Number.isFinite(f.lon)) {
    throw new Error(`${f.id}: verified feature without lat/lon`);
  }
  if (f.geometryType === 'point') {
    if (f.ring !== null) throw new Error(`${f.id}: a point must carry ring=null`);
  } else if (f.geometryType === 'polygon') {
    if (!Array.isArray(f.ring) || f.ring.length < 3) throw new Error(`${f.id}: missing ring`);
    if (!ringClosed(f.ring)) throw new Error(`${f.id}: polygon ring not closed`);
  } else if (f.geometryType === 'line') {
    if (!Array.isArray(f.ring) || f.ring.length < 2) throw new Error(`${f.id}: missing line`);
  } else {
    throw new Error(`${f.id}: unsupported geometryType ${f.geometryType}`);
  }
  if (f.spatialStatus === 'in-park' && !insideBBox(f.lat, f.lon, parkBBox)) throw new Error(`${f.id}: outside the park bounding box`);
  // A cableway is a two-endpoint line; the measured map length must agree with its endpoints and stay labelled separately
  // from the published City length. It is never used as a surveyed length.
  if (f.kind === 'cableway') {
    if (f.geometryType !== 'line' || !Array.isArray(f.ring) || f.ring.length !== 2) throw new Error(`${f.id}: a cableway must be a 2-endpoint line`);
    if (!Number.isFinite(f.mapLineLengthM)) throw new Error(`${f.id}: a cableway must carry mapLineLengthM`);
    const measured = haversineM(f.ring[0], f.ring[1]);
    if (Math.abs(measured - f.mapLineLengthM) > 0.5) throw new Error(`${f.id}: mapLineLengthM disagrees with its endpoints`);
  }
  if (f.orientationSource !== null && !ORIENTATION_SOURCES.has(f.orientationSource)) throw new Error(`${f.id}: bad orientationSource ${f.orientationSource}`);
  if (!GEOMETRY_TYPES.has(f.geometryType)) throw new Error(`${f.id}: unsupported geometryType ${f.geometryType}`);
}

// ---- equipment source audit trail: every playground=* structure this pass adds must trace to the raw extract ----
const rawEquipment = new Map(EQUIPMENT.elements.map((e) => [`${e.type}/${e.id}`, e]));
const equipmentRefs = new Set(BUNDLE.features.filter((f) => f.sourceUrl === 'https://www.openstreetmap.org/copyright').map((f) => f.ref));
for (const ref of equipmentRefs) {
  const el = rawEquipment.get(ref);
  if (!el) throw new Error(`equipment: ${ref} is not in the current raw playground extract`);
  // The named/zipwire/sandpit/swing/structure features must carry the same geometry the raw extract has.
  const f = BUNDLE.features.find((x) => x.ref === ref);
  if (el.geometry) {
    const raw = el.geometry.map((p) => [p.lat, p.lon]);
    if (raw.length !== f.ring.length) throw new Error(`equipment: ${ref} ring length differs from the raw extract`);
    for (let i = 0; i < raw.length; i++) {
      if (Math.abs(raw[i][0] - f.ring[i][0]) > 1e-9 || Math.abs(raw[i][1] - f.ring[i][1]) > 1e-9) throw new Error(`equipment: ${ref} ring differs from the raw extract at vertex ${i}`);
    }
  } else {
    if (Math.abs(el.lat - f.lat) > 1e-9 || Math.abs(el.lon - f.lon) > 1e-9) throw new Error(`equipment: ${ref} node differs from the raw extract`);
  }
  const tags = el.tags || {};
  if (f.id === 'snowy-owl-theatre' && tags.name !== 'Snowy Owl Theatre') throw new Error('equipment: the Owl area must be the named OSM structure');
  if (f.id === 'cableway-20' && tags.playground !== 'zipwire') throw new Error('equipment: cableway-20 must be a zipwire');
  if (f.id === 'cableway-40' && tags.playground !== 'zipwire') throw new Error('equipment: cableway-40 must be a zipwire');
  if (f.id.startsWith('sandpit-') && tags.playground !== 'sandpit') throw new Error(`${f.id}: must be a sandpit`);
  if (f.id === 'swing-hill-node' && tags.playground !== 'swing') throw new Error('equipment: the swing node must be a swing');
  if (f.id === 'unnamed-playground-structure' && tags.playground !== 'structure') throw new Error('equipment: the unnamed node must be a structure');
}

// ---- OSM supplement: benches, bins, extra fountains, fire pit, re-filtered to the park ----
const suppFeatures = [];
function addSupplement(e, kind, name, note) {
  const lat = e.lat, lon = e.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') throw new Error(`supplement ${e.id}: no lat/lon`);
  const id = `${kind}-${e.id}`;
  claim(id);
  suppFeatures.push({
    id, name, kind, phase: '2025', placement: 'osm-node', spatialStatus: 'in-park', positionConfidence: 'high',
    lat, lon, ref: `${e.type}/${e.id}`, geometryType: 'point', ring: null,
    orientationDeg: null, orientationSource: null, orientationConfidence: null,
    sourceUrl: 'https://www.openstreetmap.org/copyright', evidence: note
  });
}
for (const e of SUPPLEMENT.elements) {
  if (!e.inPark) continue;
  const t = e.tags || {};
  if (t.amenity === 'bench') addSupplement(e, 'bench', t.name || 'Park bench', 'Current OSM bench inside the park polygon (broader re-filtered extract). Official count is not published.');
  else if (t.amenity === 'waste_basket') addSupplement(e, 'bin', t.name || 'Waste basket', 'Current OSM waste basket inside the park polygon (broader re-filtered extract). Official count is not published.');
  else if (t.amenity === 'drinking_water') addSupplement(e, 'fountain', t.name || 'Drinking water fountain', 'Current OSM drinking_water point inside the park (broader re-filtered extract).');
  else if (t.leisure === 'firepit') addSupplement(e, 'firepit', t.name || 'Fire pit', 'Current OSM fire pit inside the park (broader re-filtered extract).');
}
if (!suppFeatures.some((f) => f.kind === 'firepit')) throw new Error('supplement: expected a mapped fire pit');
for (const f of suppFeatures) if (!insideBBox(f.lat, f.lon, parkBBox)) throw new Error(`${f.id}: outside the park bounding box`);

// ---- official-source unplaced catalog ----
for (const f of UNVERIFIED) {
  if (!f || typeof f.id !== 'string' || !f.id) throw new Error('unverified: feature without id');
  claim(f.id);
  if (!PHASES.has(f.phase)) throw new Error(`${f.id}: bad phase ${f.phase}`);
  if (f.lat !== null || f.lon !== null) throw new Error(`${f.id}: an unverified feature must not carry a guessed position`);
  if (f.placement !== 'unverified') throw new Error(`${f.id}: bad placement`);
}

const features = BUNDLE.features.concat(suppFeatures);
const byKind = features.reduce((m, f) => ((m[f.kind] = (m[f.kind] || 0) + 1), m), {});
const byPhase = features.reduce((m, f) => ((m[f.phase] = (m[f.phase] || 0) + 1), m), {});
const byPlacement = features.reduce((m, f) => ((m[f.placement] = (m[f.placement] || 0) + 1), m), {});

// The Owl identity is now resolved by a named OSM structure; the generic area and the maker pin are still retained as
// the historical claims, but the conflict is no longer "unresolved" and the pin is still not a body-base origin.
const owlArea = features.find((f) => f.id === 'snowy-owl-playground');
const owlTheatre = features.find((f) => f.id === 'snowy-owl-theatre');
const owlPin = UNVERIFIED.find((f) => f.id === 'snowy-owl-maker-pin');
if (!owlArea || !owlTheatre || !owlPin) throw new Error('expected the Owl generic area, the named theatre area and the maker-pin records');
// The named theatre must actually sit inside the generic west play area; that containment is the resolution evidence.
function pointInsideArea(ring, lat, lon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
if (owlTheatre.ring.some(([lat, lon]) => !pointInsideArea(owlArea.ring, lat, lon))) {
  throw new Error('the named Owl theatre area must lie inside the unnamed west play area');
}

const parkCentroid = (() => {
  const ring = BUNDLE.parkRing;
  // planar centroid in local metres, then back to lat/lon
  const lat0 = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lon0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const xy = ring.map(([la, lo]) => [(lo - lon0) * kx, (la - lat0) * ky]);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length];
    const cr = x1 * y2 - x2 * y1; a += cr; cx += (x1 + x2) * cr; cy += (y1 + y2) * cr;
  }
  a *= 0.5;
  return [Math.round((lat0 + cy / (6 * a) / ky) * 1e7) / 1e7, Math.round((lon0 + cx / (6 * a) / kx) * 1e7) / 1e7];
})();

const data = {
  version: 3,
  generatedBy: 'tools/build-biidaasige-park-data.mjs',
  fixtures: BUNDLE.source + ' + ' + SUPPLEMENT.source,
  attribution: 'Data © OpenStreetMap contributors (ODbL); City of Toronto; Waterfront Toronto. No images reproduced.',
  sources: BUNDLE.sources,
  projection: { lat0: geodata.lat0, lon0: geodata.lon0, kx: geodata.kx, ky: geodata.ky, theta: geodata.theta, ox: geodata.ox, oz: geodata.oz },
  positionPolicy: 'A built position exists only where a current OpenStreetMap node/way gives it (placement starts "osm"). Official-source features without such geometry are in unverifiedFeatures with lat=null, lon=null, placement="unverified" and no fallback coordinate. The Owl theatre area is placed from a named current OSM structure; the maker pin is documented but never used as a body origin, and the generic west play area stays a generic AREA.',
  park: Object.assign({}, BUNDLE.park, { centroid: parkCentroid, polygon: BUNDLE.parkRing }),
  features,
  contextFeatures: BUNDLE.context,
  waterGeometry: BUNDLE.waterGeometry,
  unverifiedFeatures: UNVERIFIED,
  coverage: COVERAGE,
  sourceConflicts: [{
    id: 'snowy-owl-identity',
    feature: 'The Snowy Owl Play Theatre',
    status: 'resolved-by-named-osm-structure',
    claims: [
      { source: 'Monstrum maker KML (public MyMaps pins)', lat: owlPin.makerPin.lat, lon: owlPin.makerPin.lon,
        quality: 'approximate manufacturer point; not a survey', note: owlPin.evidence },
      { source: 'OpenStreetMap way/1418127159', lat: owlArea.lat, lon: owlArea.lon,
        quality: 'unnamed leisure=playground AREA centroid; generic area only, not a body footprint', note: owlArea.evidence },
      { source: 'OpenStreetMap way/1418541992', lat: owlTheatre.lat, lon: owlTheatre.lon,
        quality: 'named Snowy Owl Theatre AREA (playground=structure); the theatre area is exact, its centroid is not the body origin', note: owlTheatre.evidence }
    ],
    separationM: owlPin.makerPin.distanceToOsmAreaM,
    resolution: 'Resolved by the named OSM structure way/1418541992 ("Snowy Owl Theatre", playground=structure): every vertex lies inside the unnamed west play area (way/1418127159), so the Owl is proven to be in that play area, west of Old Fire Hall 30. The earlier area-centroid vs approximate-pin disagreement was unnecessary. The theatre AREA is exact and now placed; its centroid is NOT the body-base origin because the polygon covers stage and nest. The maker pin stays approximate/wrong for the body origin, and the generic play area stays a generic AREA (never moved).'
  }],
  diagnostics: {
    verifiedFeatures: features.length,
    parkGeometryFeatures: BUNDLE.features.length,
    supplementFeatures: suppFeatures.length,
    contextFeatures: BUNDLE.context.length,
    unverifiedFeatures: UNVERIFIED.length,
    waterGeometries: BUNDLE.waterGeometry.length,
    parkPolygonVertices: BUNDLE.parkRing.length,
    byKind,
    byPhase,
    byPlacement,
    coverageEntries: COVERAGE.length,
    resolvedConflicts: 1,
    unresolvedConflicts: 0,
    equipmentSourceRefs: equipmentRefs.size
  }
};

const header = `// js/biidaasige-park-data.js: generated by tools/build-biidaasige-park-data.mjs from checked-in OSM fixtures plus
// the official-source catalog. DO NOT EDIT. Data © OpenStreetMap contributors (ODbL); City of Toronto;
// Waterfront Toronto. See docs/biidaasige-park.md.
//
// Positions: only current OSM nodes/ways are placed; every other named feature is in unverifiedFeatures with
// lat=null/lon=null. Helpers use window.CITY.worldFromLatLon at call time and return null when the frame is absent.
// Unverified features are excluded unless {includeUnverified:true} is passed. The Owl theatre AREA is placed from the
// named current OSM structure way/1418541992; the maker pin stays approximate (not a body origin) and the identity
// conflict is recorded as resolved in sourceConflicts.
`;

const helpers = `(function () {
  const C = (typeof window !== 'undefined') ? (window.CITY = window.CITY || {}) : null;
  if (!C) return;
  const D = C.BIIDAASIGE_PARK;
  if (!D) return;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const hasPos = (f) => !!f && isNum(f.lat) && isNum(f.lon);
  const pinPos = (f) => (f && f.makerPin && isNum(f.makerPin.lat) && isNum(f.makerPin.lon)) ? f.makerPin : null;
  const isVerified = (f) => !!f && typeof f.placement === 'string' && f.placement.indexOf('osm') === 0 && hasPos(f);
  const project = (lat, lon) => {
    if (typeof C.worldFromLatLon !== 'function') return null;
    const p = C.worldFromLatLon(lat, lon);
    return (p && isNum(p.x) && isNum(p.z)) ? { x: p.x, z: p.z } : null;
  };
  const copy = (f) => Object.assign({}, f);
  const all = () => D.features.concat(D.contextFeatures || []).concat(D.unverifiedFeatures || []);
  const find = (id) => all().find((f) => f.id === id) || null;
  const select = (opts) => {
    opts = opts || {};
    const includeUnverified = opts.includeUnverified === true;
    const includeContext = opts.includeContext === true;
    return D.features
      .concat(includeContext ? (D.contextFeatures || []) : [])
      .concat(includeUnverified ? (D.unverifiedFeatures || []) : [])
      .filter((f) => {
        if (!includeContext && f.spatialStatus === 'context') return false;
        if (!includeUnverified && !isVerified(f)) return false;
        return true;
      })
      .map(copy);
  };
  C.biidaasigeParkFeatures = (opts) => select(opts);
  C.biidaasigeParkCatalog = () => all().map(copy);
  C.biidaasigeParkFeature = (id) => { const f = find(id); return f ? copy(f) : null; };
  C.biidaasigeParkWorld = (idOrFeature, opts) => {
    const f = typeof idOrFeature === 'string' ? find(idOrFeature) : idOrFeature;
    if (!f) return null;
    const unverifiedOk = !!(opts && opts.includeUnverified === true);
    let lat = f.lat, lon = f.lon, source = 'feature';
    if (!hasPos(f)) {
      // a document-only maker pin is not a placement: it needs the explicit unverified opt-in
      const pin = pinPos(f);
      if (!pin || !unverifiedOk) return null;
      lat = pin.lat; lon = pin.lon; source = 'maker-pin';
    } else if (!unverifiedOk && !isVerified(f)) return null;
    const p = project(lat, lon);
    return p ? { id: f.id, lat, lon, x: p.x, z: p.z, placement: source } : null;
  };
  C.biidaasigeParkRingWorld = (idOrFeature, opts) => {
    const f = typeof idOrFeature === 'string' ? find(idOrFeature) : idOrFeature;
    if (!f || !Array.isArray(f.ring) || f.ring.length < 2) return null;
    if (!(opts && opts.includeUnverified === true) && !isVerified(f)) return null;
    const out = [];
    for (const pt of f.ring) {
      const lat = Array.isArray(pt) ? pt[0] : pt.lat;
      const lon = Array.isArray(pt) ? pt[1] : pt.lon;
      if (!isNum(lat) || !isNum(lon)) return null;
      const p = project(lat, lon);
      if (!p) return null;
      out.push({ x: p.x, z: p.z });
    }
    return out;
  };
  C.biidaasigeParkPose = (idOrFeature, opts) => {
    const f = typeof idOrFeature === 'string' ? find(idOrFeature) : idOrFeature;
    const w = C.biidaasigeParkWorld(f, opts);
    if (!w) return null;
    return Object.assign({}, w, {
      orientationDeg: f.orientationDeg,
      orientationSource: f.orientationSource,
      orientationConfidence: f.orientationConfidence,
      placement: f.placement,
      positionConfidence: f.positionConfidence,
      spatialStatus: f.spatialStatus
    });
  };
  C.biidaasigeParkProjectionAvailable = () => typeof C.worldFromLatLon === 'function';
  C.biidaasigeParkDiagnostics = () => D.diagnostics;
  C.biidaasigeParkSourceConflicts = () => (D.sourceConflicts || []).map(copy);
  C.biidaasigeParkMakerPin = (id) => { const f = find(id); const pin = pinPos(f); return pin ? copy(pin) : null; };
})();
`;

const body = `${header}window.CITY = window.CITY || {};\nwindow.CITY.BIIDAASIGE_PARK = ${JSON.stringify(data)};\n${helpers}`;
const outPath = path.join(ROOT, 'js/biidaasige-park-data.js');

if (process.argv.includes('--check')) {
  const committed = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  if (committed !== body) { console.error('[biidaasige-park] js/biidaasige-park-data.js is stale; run node tools/build-biidaasige-park-data.mjs'); process.exit(1); }
  console.log(`[biidaasige-park] up to date: ${data.diagnostics.verifiedFeatures} verified (${data.diagnostics.supplementFeatures} supplement), ${data.diagnostics.unverifiedFeatures} unverified, ${data.diagnostics.contextFeatures} context, ${data.diagnostics.resolvedConflicts} resolved, ${data.diagnostics.unresolvedConflicts} unresolved`);
} else {
  fs.writeFileSync(outPath, body);
  console.log(`[biidaasige-park] wrote js/biidaasige-park-data.js: ${data.diagnostics.verifiedFeatures} verified (${data.diagnostics.supplementFeatures} supplement), ${data.diagnostics.unverifiedFeatures} unverified, ${data.diagnostics.contextFeatures} context, ${data.diagnostics.resolvedConflicts} resolved, ${data.diagnostics.unresolvedConflicts} unresolved`);
}
