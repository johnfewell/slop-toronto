// tools/pack-geodata.mjs — repacks data/toronto-geodata.bin from the committed scripts, without the raw downloads:
// js/toronto-geodata.js (GEO) and js/toronto-poles.js (POLES), the layers of tools/geo-bin.mjs. Sets the file's hash
// in explore.html. tools/build-poles.mjs runs it after writing the poles; tools/build-geodata.mjs packs the same way.
// usage: node tools/pack-geodata.mjs [--geo js/toronto-geodata.js] [--poles js/toronto-poles.js] [--bin out.bin]
//   (--bin elsewhere leaves explore.html alone)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { packCity, readLayer, setPageHash } from './geo-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Packs the two scripts into `bin`; points explore.html at it when it is the committed file. Returns packCity's result */
export function packGeodata({ geo = path.join(ROOT, 'js/toronto-geodata.js'), poles = path.join(ROOT, 'js/toronto-poles.js'),
  bin = path.join(ROOT, 'data/toronto-geodata.bin'), page = path.join(ROOT, 'explore.html') } = {}) {
  const packed = packCity({ GEO: readLayer(geo, 'GEO'), POLES: readLayer(poles, 'POLES') });
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, packed.file);
  if (page && path.resolve(bin) === path.join(ROOT, 'data/toronto-geodata.bin') && fs.existsSync(page)) setPageHash(page, packed.hash);
  return packed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { geo: { type: 'string' }, poles: { type: 'string' }, bin: { type: 'string' } } });
  const opts = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, path.resolve(v)]));
  const packed = packGeodata(opts);
  console.log(`[pack-geodata] wrote ${path.relative(process.cwd(), opts.bin || path.join(ROOT, 'data/toronto-geodata.bin'))} ` +
    `(${packed.file.length} bytes gzip, ${packed.raw.length} inflated, hash ${packed.hash})`);
}
