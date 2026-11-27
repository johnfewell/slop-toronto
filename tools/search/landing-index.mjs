// Compile the small landing search index out of the same committed data Explore opens.
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeGeo } from '../../js/geodata-loader.js';
import { junctions } from '../../js/search-intersections.js';

export const indexPath = (map) => `assets/geocoder/landing-${map}.json`;
export const geoPath = (map) => map === 'detail' ? 'data/toronto-geodata.bin' : 'data/frames/eglinton/toronto-geodata.bin';

export function landingIndex(root, map) {
  const { GEO } = decodeGeo(gunzipSync(fs.readFileSync(path.join(root, geoPath(map)))));
  const { detail, projection } = GEO.frame;
  const bounds = { minX: detail.x0, maxX: detail.x1, minZ: detail.z0, maxZ: detail.z1 };
  const landmarks = Object.entries(GEO.landmarks).map(([id, p]) => ({
    id, kind: 'landmark', name: p.name, x: p.ax ?? p.x, z: p.az ?? p.z, sub: 'Landmark'
  }));
  const districts = GEO.districts.map((p) => ({ ...p, kind: 'district', sub: 'Neighbourhood' }));
  const { names, links, nodes } = GEO.roadGraph;
  const longest = new Map();
  for (const [a, b, street] of links) {
    const name = names[street];
    if (!name || /^(unnamed|service)/i.test(name)) continue;
    const ax = nodes[2 * a], az = nodes[2 * a + 1], bx = nodes[2 * b], bz = nodes[2 * b + 1];
    const length = Math.hypot(bx - ax, bz - az);
    if (length > (longest.get(name)?.length ?? 0)) longest.set(name, { length, x: (ax + bx) / 2, z: (az + bz) / 2 });
  }
  const streets = Array.from(longest, ([name, { x, z }]) => ({ name, x, z, kind: 'street', sub: 'Street' }));
  return { bounds, projection, crossings: junctions(GEO.roadGraph), places: [...landmarks, ...districts, ...streets] };
}
