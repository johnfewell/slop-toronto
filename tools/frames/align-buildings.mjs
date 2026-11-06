// tools/frames/align-buildings.mjs — a frame's buildings look the same as today's where today's map has them.
//
// The colour seed of a building (GEO.buildings[i][7]: wall and roof paint, picked at runtime) comes from its row in the
// 3D Massing download the frame was built from, and a house's pitched or flat roof ([6]) from the same seed, so a frame
// built from a bigger download repaints every building of today's map and re-roofs some houses. This copies both
// from today's geodata onto the frame's building at the same centre with the same plan (only those two fields: the
// geometry, kind and name stay the frame's own). build-frame.mjs --install runs it on the frame's binary.
// usage: node tools/frames/align-buildings.mjs --bin data/frames/<name>/toronto-geodata.bin [--ref data/toronto-geodata.bin]
//          [--page explore.html]   (rewrites the binary in place and sets its ?v= hash in the page)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { unpackGeo } from '../../js/geodata-loader.js';
import { packCity } from '../geo-bin.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Copies roof [6] and colour seed [7] from `ref` onto the frame's buildings with the same centre and plan */
export function alignBuildings(buildings, ref) {
  const key = (b) => `${b[0]},${b[1]},${JSON.stringify(b[3])}`;
  const today = new Map(); // (a plan can stand at one centre more than once, the parts of a stacked building: in order)
  for (const b of ref) (today.get(key(b)) || today.set(key(b), []).get(key(b))).push(b);
  const stats = { buildings: buildings.length, matched: 0, recoloured: 0, reroofed: 0 };
  for (const b of buildings) {
    const t = today.get(key(b))?.shift();
    if (!t) continue;
    stats.matched++;
    if (b[7] !== t[7]) { b[7] = t[7]; stats.recoloured++; }
    if (b[6] !== t[6]) { b[6] = t[6]; stats.reroofed++; }
  }
  return stats;
}

/** Aligns the frame binary `bin` with the reference binary; returns the new file, its hash and the stats */
export async function alignBin(bin, ref = path.join(ROOT, 'data/toronto-geodata.bin')) {
  const frame = await unpackGeo(fs.readFileSync(bin));
  const today = await unpackGeo(fs.readFileSync(ref));
  const stats = alignBuildings(frame.GEO.buildings, today.GEO.buildings);
  const packed = packCity({ GEO: frame.GEO, POLES: frame.POLES, PARKED_CARS: frame.PARKED_CARS });
  const file = Buffer.from(packed.file);
  return { file, hash: crypto.createHash('sha256').update(file).digest('hex').slice(0, 12), stats };
}

/** Points the page's request for data/frames/<name>/toronto-geodata.bin at `hash` */
export function setFrameHash(page, name, hash) {
  const html = fs.readFileSync(page, 'utf8');
  const at = `./data/frames/${name}/toronto-geodata.bin?v=`, i = html.indexOf(at);
  if (i < 0) throw new Error(`${page}: no ${at} to set`);
  const j = i + at.length, k = j + (html.slice(j).match(/^[0-9a-f]*/)[0].length);
  fs.writeFileSync(page, html.slice(0, j) + hash + html.slice(k));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: A } = parseArgs({ options: { bin: { type: 'string' }, ref: { type: 'string' }, page: { type: 'string' } } });
  if (!A.bin) throw new Error('usage: align-buildings.mjs --bin data/frames/<name>/toronto-geodata.bin [--ref <bin>] [--page explore.html]');
  const bin = path.resolve(A.bin);
  const { file, hash, stats } = await alignBin(bin, A.ref ? path.resolve(A.ref) : undefined);
  fs.writeFileSync(bin, file);
  const name = path.basename(path.dirname(bin));
  setFrameHash(path.resolve(A.page || path.join(ROOT, 'explore.html')), name, hash);
  console.log(`[align-buildings] ${path.relative(process.cwd(), bin)}: ${JSON.stringify(stats)}; v=${hash}`);
}
