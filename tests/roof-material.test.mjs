// The hipped and sheet roofs' material (js/buildings.js createRoofMaterial, jf-dr1): its colorNode reads the vertex colour itself, so the
// material must not also set `vertexColors`: three multiplies the two, squaring every roof (a charcoal roof came out pure black).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
const start = src.indexOf('function createRoofMaterial(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('createRoofMaterial reads the colour attribute in its colorNode and does not also set vertexColors', () => {
  assert.ok(start > 0 && body.length > 200);
  assert.match(body, /attribute\('color', 'vec3'\)/);
  assert.ok(!/vertexColors\s*:\s*true/.test(body.replace(/\/\/[^\n]*/g, '')), 'vertexColors: true would square the roof colour');
});

test('the darkest roof paint is a real charcoal, not near black, once lit as one multiplication', () => {
  const m = /const ROOF_PAINT = \[((?:\[0x[0-9a-f]{6}, \d+\],? ?)+)\]/.exec(src);
  assert.ok(m, 'ROOF_PAINT found');
  const hexes = [...m[1].matchAll(/0x([0-9a-f]{6})/g)].map((x) => parseInt(x[1], 16));
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  for (const h of hexes) {
    const l = 0.2126 * lin(((h >> 16) & 255) / 255) + 0.7152 * lin(((h >> 8) & 255) / 255) + 0.0722 * lin((h & 255) / 255);
    assert.ok(l > 0.02, `roof paint ${h.toString(16)} luminance ${l}`);
  }
});
