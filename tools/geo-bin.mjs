// tools/geo-bin.mjs — the site's packed city data, data/toronto-geodata.bin: the layers it holds and how they are
// written. js/geodata-loader.js reads it back into window.CITY before the classic scripts run.
//
// Layers (each the very object its generated script holds; those scripts stay the node tools' and tests' copies):
// - GEO: the city database, js/toronto-geodata.js (tools/build-geodata.mjs, from the raw downloads)
// - POLES: the City's mapped streetlight & signal poles, js/toronto-poles.js (tools/build-poles.mjs)
// The file is a function of those two scripts alone: tools/build-geodata.mjs packs its GEO with the committed poles,
// tools/pack-geodata.mjs (and tools/build-poles.mjs after writing the poles) repacks both scripts without the raw
// downloads, and tests/geodata-binary.test.mjs checks the committed file is the scripts packed.
// The ID sidecar (js/toronto-geodata-ids.js, docs/geodata-ids.md) is keyed to the hash of js/toronto-geodata.js, which
// the poles never touch: GEO's rows decode to exactly that script, so its row alignment holds for the binary too.
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { packGeo } from './geo-pack.mjs';

export const LAYERS = ['GEO', 'POLES'];

/** The base64 strings stored as raw values: the terrain raster (2-D prediction over its rows) and the water mask */
export const blobsOf = (GEO) => ({
  'GEO.terrain.data': { type: 'i16', width: GEO.terrain.n },
  'GEO.waterMask.runs': { type: 'u16' }
});

/** { GEO, POLES } -> the packed file (geo-pack.mjs packGeo's result) and its 12-digit hash, the page's ?v= */
export function packCity(layers) {
  for (const name of LAYERS) if (!layers[name]) throw new Error(`geo-bin: the ${name} layer is missing`);
  const packed = packGeo(Object.fromEntries(LAYERS.map((name) => [name, layers[name]])), blobsOf(layers.GEO));
  return { ...packed, hash: crypto.createHash('sha256').update(packed.file).digest('hex').slice(0, 12) };
}

/** window.CITY[name] as a generated script sets it (js/toronto-geodata.js: GEO, js/toronto-poles.js: POLES) */
export function readLayer(file, name) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const layer = context.window.CITY?.[name];
  if (!layer) throw new Error(`geo-bin: ${file} does not set window.CITY.${name}`);
  return layer;
}

/** Points explore.html at the file by its hash (it is cached for good): returns whether the page changed */
export function setPageHash(page, hash) {
  const html = fs.readFileSync(page, 'utf8');
  const next = html.replace(/(\.\/data\/toronto-geodata\.bin\?v=)[0-9a-f]*/, `$1${hash}`);
  if (next === html && !html.includes(hash)) throw new Error(`${page}: no ./data/toronto-geodata.bin?v= to set`);
  if (next !== html) fs.writeFileSync(page, next);
  return next !== html;
}
