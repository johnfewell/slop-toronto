// tools/vendor-three.mjs — copies three 0.186.1's builds (node_modules/three) into vendor/three/ for the page's import map,
// with the struct adapter John's clouds need: the published @takram builds (three-atmosphere 0.19.1, three-geospatial
// 0.9.1) read `struct().layout`, which three removed in r185 (three-geospatial#111). Same patch as one-minute-ride's and
// concept-3d's scripts/patch-three-clouds.mjs (from three-clouds-webgpu patches/three.patch). Delete when takram ships it.
// usage: node tools/vendor-three.mjs
import fs from 'node:fs';

const SUPPORTED = '0.186.1';
const MARKER = '// slop-toronto: Takram legacy struct layout';
const { version } = JSON.parse(fs.readFileSync('node_modules/three/package.json', 'utf8'));
if (version !== SUPPORTED) throw new Error(`Review the clouds struct adapter before upgrading three (${version}).`);
fs.mkdirSync('vendor/three', { recursive: true });
for (const f of ['three.core.js', 'three.webgpu.js', 'three.tsl.js']) fs.copyFileSync(`node_modules/three/build/${f}`, `vendor/three/${f}`);
fs.copyFileSync('node_modules/three/LICENSE', 'vendor/three/LICENSE');
const path = 'vendor/three/three.webgpu.js';
const source = fs.readFileSync(path, 'utf8');
const original = '\treturn nodeProxyConstructor( struct, structType );';
if (source.split(original).length !== 2) throw new Error('three struct implementation changed; refusing to patch.');
fs.writeFileSync(path, source.replace(original, `${MARKER}
\treturn new Proxy( struct, {
\t\tget( target, prop, receiver ) {
\t\t\tif ( prop === 'layout' ) return structType;
\t\t\tif ( prop === 'isStruct' ) return true;
\t\t\treturn Reflect.get( structType, prop, receiver );
\t\t},
\t\tset( target, prop, value ) { return Reflect.set( structType, prop, value ); },
\t\thas( target, prop ) {
\t\t\tif ( prop === 'layout' || prop === 'isStruct' ) return true;
\t\t\treturn Reflect.has( structType, prop );
\t\t}
\t} );`));
console.log(`[three] vendor/three: three ${version} with the takram struct adapter`);
