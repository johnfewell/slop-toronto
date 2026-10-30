// tools/cafeto-world.mjs: the city's placement inputs in node (no WebGPU scene), for tests/cafeto.test.mjs and
// tools/review-cafeto.mjs. Loads the same scripts the browser runs for patio placement. The browser checks the placed
// benches/pay stations/wayfinding sites and the landmarks' colliders too; here the source points of those layers stand in.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// (cycling.js builds its paint colours at load: any THREE object will do here)
class Any { constructor() { return new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => new Any()) }); } }
const THREE = new Proxy({}, { get: () => Any });

export function loadPatioWorld(root = ROOT) {
  const context = vm.createContext({ window: { CITY: { THREE } }, console: { ...console, info() {}, warn() {} } });
  for (const file of ['js/toronto-geodata.js', 'js/toronto-traffic-data.js', 'js/toronto-transit.js', 'js/toronto-subway.js',
    'js/toronto-sidewalks.js', 'js/toronto-benches.js', 'js/toronto-parking-meters.js', 'js/toronto-wayfinding.js',
    'js/toronto-cafeto.js', 'js/city-config.js', 'js/sidewalk-polygons.js', 'js/cycling.js', 'js/patio-layout.js']) {
    const p = path.join(root, file);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), context, { filename: file });
  }
  const CITY = context.window.CITY;
  const furniture = [
    ...(CITY.BENCHES?.records || []).map((r) => ({ x: r.x, z: r.z, kind: 'bench' })),
    ...(CITY.PARKING_METERS?.records || []).map((r) => ({ x: r.x, z: r.z, kind: 'parkingMeter' })),
    ...(CITY.WAYFINDING?.records || []).map((r) => ({ x: r.x, z: r.z, kind: r.type === 'Info Pillar' ? 'infoPillar' : 'wayfinding' }))
  ];
  const deps = CITY.patioDeps(CITY, { furniture });
  return { CITY, deps, records: CITY.CAFETO?.records || [] };
}

// world (x, z) -> [lon, lat], the inverse of the build's projection
export function worldToLonLat(frame, x, z) {
  const p = frame.projection;
  const X = x + p.ox, Z = -(z + p.oz), c = Math.cos(p.theta), s = Math.sin(p.theta);
  const e = X * c + Z * s, n = -X * s + Z * c;
  return [p.lon0 + e / p.kx, p.lat0 + n / p.ky];
}
