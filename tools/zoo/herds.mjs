import fs from 'node:fs'; import vm from 'node:vm';
import * as THREE from 'three/webgpu'; import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const R = process.argv[2];
const read = (f) => fs.readFileSync(`${R}/js/${f}.js`, 'utf8');
const context = vm.createContext({ window: { CITY: { THREE, TSL, Addons: { mergeGeometries }, DEBUG_ROADS: false, QUALITY: { surfaceWear: 2, storefronts: 2 } }, addEventListener() {} },
  document: { addEventListener() {}, hidden: false }, location: { search: '' }, URLSearchParams, Intl, performance, console: { info() {}, warn() {}, log() {} }, atob });
for (const f of ['toronto-geodata', 'toronto-subway', 'toronto-subway-topology', 'high-park-data', 'don-valley', 'city-config', 'tsl-materials', 'high-park-features-data', 'high-park-features']) vm.runInContext(read(f), context);
const C = context.window.CITY;
const built = C.buildHighParkFeatures(new THREE.Scene());
const out = {};
built.group.traverse((o) => { if (o.isInstancedMesh && /^HighParkZoo_/.test(o.name)) { const m = new THREE.Matrix4(), p = new THREE.Vector3(); const pts = []; for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); p.setFromMatrixPosition(m); pts.push([+p.x.toFixed(1), +p.y.toFixed(2), +p.z.toFixed(1)]); } out[o.name.slice(12)] = pts; } });
console.log(JSON.stringify(out));
const zoo = C.HIGH_PARK_FEATURES.areas.find((a) => a[0] === 'zoo');
const f = zoo.slice(2).filter((v) => typeof v === 'number'); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i + 1 < f.length; i += 2) { x0 = Math.min(x0, f[i]); x1 = Math.max(x1, f[i]); z0 = Math.min(z0, f[i + 1]); z1 = Math.max(z1, f[i + 1]); }
console.log('zoo box', x0, x1, z0, z1, 'zoo state', built.zoo && built.zoo.state);
