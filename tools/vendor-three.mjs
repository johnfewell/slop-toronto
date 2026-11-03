// tools/vendor-three.mjs — copies stock three 0.187.0's builds (node_modules/three) into vendor/three/, for the tests
// and tools that import three by path and for tools/clouds-probe.html's default import map. They are the same bytes
// the city loads from jsDelivr (explore.html pins the r187 release commit; the npm 0.187.0 build matches it file for
// file), unpatched: the struct adapter the npm @takram builds needed on r185+ is gone, because the clouds' vendored
// fork builds (atmosphere 0.19.1+fork.8, geospatial 0.9.1+fork.8) read either struct shape themselves.
// usage: node tools/vendor-three.mjs
import fs from 'node:fs';

const SUPPORTED = '0.187.0';
const { version } = JSON.parse(fs.readFileSync('node_modules/three/package.json', 'utf8'));
if (version !== SUPPORTED) throw new Error(`vendor/three is stock three ${SUPPORTED}; review the tests before moving it to ${version}.`);
fs.mkdirSync('vendor/three', { recursive: true });
for (const f of ['three.core.js', 'three.webgpu.js', 'three.tsl.js']) fs.copyFileSync(`node_modules/three/build/${f}`, `vendor/three/${f}`);
fs.copyFileSync('node_modules/three/LICENSE', 'vendor/three/LICENSE');
console.log(`[three] vendor/three: stock three ${version}`);
