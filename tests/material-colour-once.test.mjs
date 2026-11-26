// A material's colour must be applied once (jf-xql, after jf-dr1's black roofs).
//
// three r187's node material (node_modules/three/src/materials/nodes/NodeMaterial.js setupDiffuseColor) takes `colorNode` (or, when it is
// null, `color` x `map`) and then multiplies it by the geometry's `color` attribute when `vertexColors` is true, and by `instanceColor`
// whenever the mesh has one. A `colorNode` that reads the `color` attribute itself therefore squares the colour of every vertex-coloured
// material: a charcoal roof (0.025 linear) came out 0.0006, black; the High Park roofs and hedge tops came out far too dark.
// This scans the source of every js/ file for a material that sets `vertexColors: true` and then gives itself a `colorNode` that reads
// the colour attribute (`attribute('color', ...)` or `vertexColor()`), and for colour textures that miss their colour space.
// A `colorNode` that does not read the attribute (a turf grain multiplied on the vertex colour) is the intended use and passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const jsDir = new URL('../js/', import.meta.url).pathname;
const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js') && f !== 'clouds.js' && f !== 'stylized-water.js');

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

// the text of the statement that starts at `from` (to the first `;` or newline-closing bracket at depth 0)
function statementAt(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) { depth--; if (depth < 0) return src.slice(from, i); }
    else if (ch === ';' && depth === 0) return src.slice(from, i);
  }
  return src.slice(from);
}

const READS_COLOUR_ATTRIBUTE = /attribute\(\s*['"]color['"]|\bvertexColor\s*\(|\bvertexColorNode\b/;

// Every { file, name, reads } where a material set up with `vertexColors: true` gets a colorNode reading the colour attribute.
export function findDoubleVertexColours(file, raw) {
  const src = stripComments(raw);
  const found = [];
  const sites = []; // [name, index of its declaration]
  // `name = new X({ ... vertexColors: true ... })`, `name = standardMaterial(THREE, { ... })`, `key: new X({ ... })` (a name is the last word before it)
  for (const m of src.matchAll(/([\w$]+)\s*[:=]\s*(?:new\s+[\w.$]+|[\w$.]*[Mm]aterial|\w+)\(\s*(?:[\w$.]+\s*,\s*)?\{([^{}]*)\}/g)) {
    if (/\bvertexColors\s*:\s*true\b/.test(m[2])) sites.push([m[1], m.index]);
    if (/\bvertexColors\s*:\s*true\b/.test(m[2]) && /\bcolorNode\s*:/.test(m[2])) {
      const at = m.index + m[0].indexOf('colorNode');
      if (READS_COLOUR_ATTRIBUTE.test(statementAt(src, at))) found.push({ file, name: m[1], via: 'constructor' });
    }
  }
  for (const m of src.matchAll(/([\w$.]+)\.vertexColors\s*=\s*true/g)) sites.push([m[1].split('.').pop(), m.index]);
  for (const [name, at] of sites) {
    // (a name is only that material inside its own top-level function: `mat` is every function's material)
    const endFn = src.indexOf('\n}\n', at);
    const scope = src.slice(at, endFn < 0 ? src.length : endFn);
    const esc = name.replace(/\$/g, '\\$');
    for (const m of scope.matchAll(new RegExp(`(?:\\b|\\.)${esc}\\.colorNode\\s*=`, 'g'))) {
      const stmt = statementAt(scope, m.index + m[0].length);
      if (READS_COLOUR_ATTRIBUTE.test(stmt)) found.push({ file, name, via: 'colorNode' });
    }
  }
  return found;
}

test('the scanner flags the roof, snow and palm-trunk pattern and passes a colorNode that does not read the colour attribute', () => {
  const bad = `const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.8 });\nm.colorNode = Fn(() => { const c = attribute('color', 'vec3'); return c.mul(2); })();`;
  assert.equal(findDoubleVertexColours('x.js', bad).length, 1);
  const bad2 = `const m = new Mat({ vertexColors: true });\n m.colorNode = vertexColor().mul(0.5);`;
  assert.equal(findDoubleVertexColours('x.js', bad2).length, 1);
  const good = `const m = standardMaterial(THREE, { color: 0xffffff, vertexColors: true });\nm.colorNode = Fn(() => { return tone.mul(grain); })();`;
  assert.equal(findDoubleVertexColours('x.js', good).length, 0);
  const noFlag = `const m = new THREE.MeshStandardNodeMaterial({ side: 2 });\nm.colorNode = mix(a, attribute('color', 'vec3'), solid);`;
  assert.equal(findDoubleVertexColours('x.js', noFlag).length, 0);
  const emissive = `const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true });\nm.emissiveNode = vertexColor().mul(night);`;
  assert.equal(findDoubleVertexColours('x.js', emissive).length, 0);
});

test('no material sets vertexColors and also reads the colour attribute in its colorNode', () => {
  let seen = 0;
  const hits = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(jsDir, f), 'utf8');
    seen += (stripComments(raw).match(/vertexColors\s*[:=]\s*true/g) || []).length;
    hits.push(...findDoubleVertexColours(f, raw));
  }
  assert.ok(seen > 15, `the scan found only ${seen} vertexColors materials: its pattern has stopped matching`);
  assert.deepEqual(hits, [], `colour applied twice (vertexColors multiplies the colorNode that reads the colour attribute): ${JSON.stringify(hits)}`);
});

test('every canvas texture that holds a colour picture is marked sRGB', () => {
  const missing = [];
  for (const f of files) {
    const src = stripComments(fs.readFileSync(path.join(jsDir, f), 'utf8'));
    for (const m of src.matchAll(/new\s+(?:THREE\.)?CanvasTexture\(/g)) {
      const after = src.slice(m.index, m.index + 900);
      if (!/colorSpace\s*=\s*(?:THREE\.)?(?:SRGBColorSpace|NoColorSpace)|colorSpace\s*:/.test(after)) missing.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(missing, [], `a CanvasTexture without a colorSpace is sampled as linear and drawn too light: ${missing}`);
});

test('colours are converted to linear once: a hex given to THREE.Color is already converted, so no hand conversion follows it', () => {
  const doubled = [];
  for (const f of files) {
    const src = stripComments(fs.readFileSync(path.join(jsDir, f), 'utf8'));
    // new Color(hex) / setHex / color(0x..) is converted by three; convertSRGBToLinear on top of it converts twice
    for (const m of src.matchAll(/(?:new\s+(?:THREE\.)?Color\([^)]*\)|\.setHex\([^)]*\)|\bcolor\(\s*0x[0-9a-f]+\s*\))\s*\.convertSRGBToLinear\(\)/gi)) doubled.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
  }
  assert.deepEqual(doubled, []);
});
