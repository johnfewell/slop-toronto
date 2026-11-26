// What the medians are made of (docs/road-medians.md, jf-4v9): the classifier's pure parts on made-up pixels, the fixture
// lookup, and the committed city's medians by material and its painted gores.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { GREENER, PLANTED_SHARE, cropStats, decodePng, materialOf, medianMaterial } from '../tools/median-material.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** A truecolour PNG of w x h from a pixel function, filter 0 on every row */
function png(w, h, px) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3); }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), body])));
    return Buffer.concat([len, Buffer.from(type), body, crc]);
  };
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('decodePng reads a truecolour PNG back', () => {
  const img = decodePng(png(4, 3, (x, y) => [x * 10, y * 20, 7]));
  assert.equal(img.w, 4);
  assert.equal(img.h, 3);
  assert.deepEqual([...img.rgb.slice((2 * 4 + 3) * 3, (2 * 4 + 3) * 3 + 3)], [30, 40, 7]);
});

/** A 100 x 100 crop at 0.25 m a pixel: an island in the middle (x 30..70) in `isle`, road `road` round it */
const crop = (isle, road) => {
  const img = decodePng(png(100, 100, (x, y) => (x >= 30 && x < 70 && y >= 40 && y < 60 ? isle : road)));
  const ring = [[30, 40], [70, 40], [70, 60], [30, 60]];
  return cropStats(img, ring, 0.25, 0.5);
};
const ASPHALT = [118, 118, 120], GRASS = [70, 105, 55], DARK_GRASS = [30, 48, 28], CONCRETE = [196, 194, 188];

test('cropStats: a green island is planted even in shade, a grey one is not', () => {
  assert.ok(crop(GRASS, ASPHALT).vf > 0.9);
  assert.ok(crop(DARK_GRASS, ASPHALT).vf > 0.9, 'shaded grass is dark green, not grey');
  assert.ok(crop(ASPHALT, ASPHALT).vf < 0.05);
  assert.ok(crop(CONCRETE, ASPHALT).greener < GREENER);
});

test('materialOf: lawn, concrete and paint', () => {
  const same = crop(ASPHALT, ASPHALT), pale = crop(CONCRETE, ASPHALT), dark = crop([60, 60, 62], ASPHALT), green = crop(GRASS, ASPHALT);
  assert.equal(materialOf(green, 3), 'lawn');
  assert.equal(materialOf(same, 3), 'paint', 'a sliver of the road\'s own grey');
  assert.equal(materialOf(same, 6), 'paint', 'a wider gore of the road\'s own grey');
  assert.equal(materialOf(same, 12), 'concrete', 'too wide for paint');
  assert.equal(materialOf(pale, 3), 'concrete', 'a sliver clearly paler than the asphalt');
  assert.equal(materialOf(dark, 3), 'concrete', 'or clearly darker (brick, other paving)');
  assert.equal(materialOf({ ...same, n: 3 }, 3), 'lawn', 'too few pixels to judge: left as it was');
  assert.ok(PLANTED_SHARE > 0);
});

test('medianMaterial: the entry inside the outline decides, lawn when there is none', () => {
  const toWorld = (lon, lat) => [lon, lat];
  const ring = [[0, 0], [10, 0], [10, 4], [0, 4]];
  const entries = [{ pt: [5, 2], kind: 'concrete' }, { pt: [50, 50], kind: 'paint' }];
  assert.equal(medianMaterial(entries, ring, toWorld), 'concrete');
  assert.equal(medianMaterial(entries.slice(1), ring, toWorld), 'lawn');
  assert.equal(medianMaterial([], ring, toWorld), 'lawn');
});

// ---- the committed city ---------------------------------------------------------------------------------------------------

const GEO = (() => {
  const c = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/toronto-geodata.js'), 'utf8'), c);
  return c.window.CITY.GEO;
})();
const flatIn = (f, x, z) => {
  let ins = false;
  for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
    const xi = f[i], zi = f[i + 1], xj = f[j], zj = f[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
};
const blockAt = (x, z) => GEO.blocks.find((b) => flatIn(b[0], x, z));

test('the committed city: a median is 0 (not one), 1 (planted lawn) or 2 (concrete), and there are painted gores', () => {
  const kinds = { 0: 0, 1: 0, 2: 0 };
  for (const b of GEO.blocks) { assert.ok([0, 1, 2].includes(b[5]), `median code ${b[5]}`); kinds[b[5]]++; }
  assert.ok(kinds[1] > 100 && kinds[2] > 20, JSON.stringify(kinds));
  assert.ok(GEO.gores.length > 50, `${GEO.gores.length} painted gores`);
  for (const g of GEO.gores) assert.ok(g.length >= 6 && g.length % 2 === 0);
});

test('the painted gores are road: no island stands on one, and the outline sits on the road', () => {
  for (const g of GEO.gores) {
    let x = 0, z = 0;
    for (let i = 0; i < g.length; i += 2) { x += g[i]; z += g[i + 1]; }
    x /= g.length / 2; z /= g.length / 2;
    if (!flatIn(g, x, z)) continue; // (a bent outline's average can be outside it)
    assert.ok(!blockAt(x, z), `a gore at ${x.toFixed(0)}, ${z.toFixed(0)} has no island on it`);
  }
});
