// tools/geo-ids.mjs — the durable identities of the city's sourced features (tools/build-geodata.mjs writes them to
// js/toronto-geodata-ids.js beside the geodata, row for row). docs/geodata-ids.md is the contract.
//
// A durable ID is a source ID, never a position in an array, a display name or a runtime slot:
//   osm:node/123 · osm:way/123 · osm:relation/123   an OpenStreetMap element (POIs, the footprints, landmarks)
//   to-3dmassing-2025:4567 (· :4567.1)              a City of Toronto 3D Massing record (and which of its polygons)
//   <building ID>:n|e|s|w                            a building's face (see faceOf)
// The rows stay positional in js/toronto-geodata.js (its format is unchanged); the sidecar maps each row to its ID.
// Unmatched features get no ID ('') and so can't carry persisted records. Two rows with one ID fail the build.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The element's true OSM type: tools/fetch-osm.mjs shapes a closed way cut by the box edge as a relation (osmType: 'way')
export const osmType = (e) => e.osmType || e.type;
export const osmKey = (e) => `osm:${osmType(e)}/${e.id}`;
// The order of an extract (nodes, relations, ways, each by ID): sorting by it makes the build independent of the order
// the elements arrive in, and leaves an extract that is already in it as it is
const RANK = { node: 0, relation: 1, way: 2 };
export const byOsmKey = (a, b) => RANK[osmType(a)] - RANK[osmType(b)] || a.id - b.id;

// 3D Massing editions read by the build -> the dataset part of their IDs. A record number holds only within its edition
// (the shapefile has no feature ID column): a new edition is a new dataset, its IDs reached through aliases.
const MASSING_EDITIONS = { '3DMassingShapefile_2025_WGS84': 'to-3dmassing-2025' };
export function massingDataset(massing) {
  const ds = MASSING_EDITIONS[massing.edition];
  if (!ds) throw new Error(`massing.json edition ${JSON.stringify(massing.edition)} has no ID dataset: re-run tools/fetch-massing.mjs, or add the edition to MASSING_EDITIONS`);
  return ds;
}
export const massingKey = (ds, p) => `${ds}:${p.fid}${p.k !== undefined ? '.' + p.k : ''}`;
export const byMassingRecord = (a, b) => a.fid - b.fid || (a.k || 0) - (b.k || 0);

// A face: the side of a building's plan facing grid north (-z), east (+x), south (+z) or west (-x). The plan's frame is
// its minimum-area rectangle (local +u = (cos yaw, -sin yaw), +v = (sin yaw, cos yaw)); its four outward normals each
// take the nearest compass side. A plan turned 45° ± 5° from the grid has no reliable side: no face IDs.
export const FACE_SIDES = ['n', 'e', 's', 'w'];
const SIDE_DIR = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const AMBIGUOUS = Math.cos((40 * Math.PI) / 180);
// -> { a, b (the wall's ends in world x, z, left to right as seen from outside), normal, width, height } or null
export function faceOf(building, side) {
  const [cx, cz, yaw, parts, h] = building;
  if (!parts.length || !SIDE_DIR[side]) return null;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const U = [cs, -sn], V = [sn, cs];
  const [dx, dz] = SIDE_DIR[side];
  const du = dx * U[0] + dz * U[1], dv = dx * V[0] + dz * V[1];
  if (Math.max(Math.abs(du), Math.abs(dv)) < AMBIGUOUS) return null;
  const u0 = Math.min(...parts.map((p) => p[0])), u1 = Math.max(...parts.map((p) => p[1]));
  const v0 = Math.min(...parts.map((p) => p[2])), v1 = Math.max(...parts.map((p) => p[3]));
  const at = (u, v) => [cx + u * U[0] + v * V[0], cz + u * U[1] + v * V[1]];
  let a, b, normal;
  if (Math.abs(du) >= Math.abs(dv)) {
    const s = Math.sign(du), u = s > 0 ? u1 : u0;
    normal = [s * U[0], s * U[1]];
    [a, b] = [at(u, v0), at(u, v1)];
  } else {
    const s = Math.sign(dv), v = s > 0 ? v1 : v0;
    normal = [s * V[0], s * V[1]];
    [a, b] = [at(u0, v), at(u1, v)];
  }
  // left to right seen from outside (facing -normal, the viewer's right is (normal z, -normal x))
  if ((b[0] - a[0]) * normal[1] - (b[1] - a[1]) * normal[0] < 0) [a, b] = [b, a];
  return { a, b, normal, width: Math.hypot(b[0] - a[0], b[1] - a[1]), height: h };
}
// 'to-3dmassing-2025:4567:s' -> { building: 'to-3dmassing-2025:4567', side: 's' } (null when it isn't a face ID)
export function parseFaceId(id) {
  const m = /^(.+):([nesw])$/.exec(id || '');
  return m ? { building: m[1], side: m[2] } : null;
}

// Authored aliases (tools/data/geo-id-aliases.json): { "aliases": { "<old ID>": "<live ID>" } } for features whose source
// ID changed (a new massing edition, an OSM feature re-mapped). An alias may not shadow a live ID nor chain.
const ALIASES = fileURLToPath(new URL('data/geo-id-aliases.json', import.meta.url));
export function loadAliases(file = ALIASES) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).aliases || {} : {};
}
export function checkAliases(aliases, live) {
  for (const [from, to] of Object.entries(aliases)) {
    if (live.has(from)) throw new Error(`alias ${from} -> ${to}: ${from} is a live ID`);
    if (!live.has(to)) throw new Error(`alias ${from} -> ${to}: ${to} is not a live ID`);
  }
}
// Every non-empty ID of a list once (the build fails on two rows with one ID)
export function assertUnique(what, ids) {
  const seen = new Map();
  ids.forEach((id, i) => {
    if (!id) return;
    if (seen.has(id)) throw new Error(`duplicate ${what} ID ${id} (rows ${seen.get(id)} and ${i})`);
    seen.set(id, i);
  });
  return seen;
}

// For the compilers of persisted records (storefront, facade, passport manifests): an ID -> its row now, through the
// duplicate-place and authored aliases. An ID that resolves to nothing stays unresolved (null): its record is dropped
// from the build, never moved to a nearby feature or a row with the same position.
export function idResolver(IDS) {
  const rows = new Map();
  IDS.pois.forEach((id, i) => id && rows.set(id, { kind: 'poi', row: i }));
  IDS.buildings.forEach((id, i) => id && rows.set(id, { kind: 'building', row: i }));
  const alias = { ...IDS.poiAliases, ...IDS.aliases };
  return (id) => {
    const face = parseFaceId(id);
    if (face) {
      const b = rows.get(alias[face.building] || face.building);
      return b && b.kind === 'building' ? { kind: 'face', row: b.row, side: face.side } : null;
    }
    return rows.get(alias[id] || id) || null;
  };
}
