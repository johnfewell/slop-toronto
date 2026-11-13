// tools/cafeto-world.mjs: the city's placement inputs in node (no WebGPU scene), for tests/cafeto.test.mjs and
// tools/review-cafeto.mjs. Loads the same scripts the browser runs for patio placement. The browser checks the placed
// benches/pay stations/wayfinding sites and the landmarks' colliders too; here the source points of those layers stand in.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodeGeo } from '../js/geodata-loader.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// (cycling.js builds its paint colours at load: any THREE object will do here)
class Any { constructor() { return new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => new Any()) }); } }
const THREE = new Proxy({}, { get: () => Any });

// The maps the page can open (explore.html ?map=): the detail frame's city data is the default files; another frame
// (tools/frames/build-frame.mjs --install) swaps in its own scripts and its own geodata binary, which the page decodes
// into CITY.GEO and CITY.POLES (js/geodata-loader.js) where node runs js/toronto-geodata.js
export const PATIO_FRAMES = {
  detail: { name: 'detail', bin: null, scripts: {} },
  eglinton: { name: 'eglinton', bin: 'data/frames/eglinton/toronto-geodata.bin',
    scripts: Object.fromEntries(['toronto-sidewalks.js', 'toronto-traffic-data.js', 'toronto-transit.js', 'toronto-subway.js']
      .map((f) => [`js/${f}`, `js/frames/eglinton/${f}`])) }
};
/** A frame's file for one of the detail frame's (its own script, its binary for the geodata and the poles) */
export const frameFile = (frame, rel) => (frame.bin && (rel === 'js/toronto-geodata.js' || rel === 'js/toronto-poles.js')
  ? frame.bin : frame.scripts[rel] || rel);

export function loadPatioWorld(root = ROOT, frame = PATIO_FRAMES.detail) {
  const context = vm.createContext({ window: { CITY: { THREE } }, console: { ...console, info() {}, warn() {} } });
  if (frame.bin) {
    // (what the page assigns from the binary before main.js runs: { GEO, POLES, PARKED_CARS })
    const u8 = zlib.gunzipSync(fs.readFileSync(path.join(root, frame.bin)));
    Object.assign(context.window.CITY, decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)));
  }
  for (const rel of ['js/toronto-geodata.js', 'js/toronto-traffic-data.js', 'js/toronto-transit.js', 'js/toronto-subway.js',
    'js/toronto-sidewalks.js', 'js/toronto-benches.js', 'js/toronto-parking-meters.js', 'js/toronto-wayfinding.js',
    'js/toronto-cafeto.js', 'js/city-config.js', 'js/sidewalk-polygons.js', 'js/cycling.js', 'js/patio-layout.js']) {
    const file = frameFile(frame, rel);
    if (file.endsWith('.bin')) continue;
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
  return { CITY, deps, records: CITY.CAFETO?.records || [], frame };
}

// world (x, z) -> [lon, lat], the inverse of the build's projection
export function worldToLonLat(frame, x, z) {
  const p = frame.projection;
  const X = x + p.ox, Z = -(z + p.oz), c = Math.cos(p.theta), s = Math.sin(p.theta);
  const e = X * c + Z * s, n = -X * s + Z * c;
  return [p.lon0 + e / p.kx, p.lat0 + n / p.ky];
}
