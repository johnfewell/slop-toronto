// The city database of the frame a layer is built for, so one build tool serves every map the page can open
// (explore.html ?map=): `--frame detail` (the default) reads js/toronto-geodata.js, another frame its packed binary,
// data/frames/<name>/toronto-geodata.bin, whose rows are the ones the page decodes. GEO.frame.detail is that frame's box.
// A layer for another frame is written to js/frames/<name>/<file>, loaded in place of the detail frame's.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { unpackGeo } from '../js/geodata-loader.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** `--frame <name>` and `--ids <file>` out of an argv, and what is left of it */
export function frameArgs(argv = process.argv.slice(2)) {
  const rest = [], out = { frame: 'detail', ids: null, idsGeo: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--frame') out.frame = argv[++i];
    else if (argv[i] === '--ids') out.ids = path.resolve(argv[++i]);
    else if (argv[i] === '--ids-geo') out.idsGeo = path.resolve(argv[++i]);
    else rest.push(argv[i]);
  }
  if (!/^[a-z0-9-]+$/.test(out.frame)) throw new Error(`frame name ${out.frame}: lower-case letters, digits and hyphens only`);
  return { ...out, rest };
}
/** Where a layer's script goes: the detail frame's own file, or the frame's folder */
export const layerFile = (frame, file) => path.join(ROOT, frame === 'detail' ? `js/${file}` : `js/frames/${frame}/${file}`);
const cache = new Map();
const run = (file) => { const ctx = { window: { CITY: {} } }; vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx); return ctx.window.CITY; };
/** The ID sidecar of a geodata script (`ids`, built beside `idsGeo` by tools/frames/build-frame.mjs) for another geodata with the
 * same buildings and places in other rows, the packed binary's (it was installed after later edits): each row takes the ID of the
 * row that holds the same building (centre and plan) or place (point and name); a row the script lacks gets '' (no durable ID) */
export function alignIds(GEO, { ids, idsGeo }) {
  const src = run(idsGeo).GEO, side = run(ids).GEO_IDS;
  if (side.counts.buildings !== src.buildings.length || side.counts.pois !== src.pois.length) throw new Error('the ID sidecar does not describe that geodata');
  const bKey = (b) => `${b[0]},${b[1]},${JSON.stringify(b[3])}`, pKey = (p) => `${p[0]},${p[1]},${p[2]}`;
  const queue = (rows, key, list) => { const m = new Map(); rows.forEach((r, i) => { const k = key(r); (m.get(k) || m.set(k, []).get(k)).push(list[i]); }); return m; };
  const bq = queue(src.buildings, bKey, side.buildings), pq = queue(src.pois, pKey, side.pois);
  const buildings = GEO.buildings.map((b) => bq.get(bKey(b))?.shift() ?? '');
  const pois = GEO.pois.map((p) => pq.get(pKey(p))?.shift() ?? '');
  return { schema: side.schema, geodata: side.geodata, counts: { buildings: buildings.length, pois: pois.length }, buildings, pois,
    unmatched: { buildings: buildings.filter((x) => !x).length, pois: pois.filter((x) => !x).length } };
}
/** { GEO, GEO_IDS? } of a frame. GEO_IDS (docs/geodata-ids.md) is the detail frame's sidecar, or `ids` for another frame (built
 * by tools/frames/build-frame.mjs beside the geodata the binary came from; checked against the binary's rows) */
export async function loadFrameGeo(frame = 'detail', { ids = null, idsGeo = null, needIds = false } = {}) {
  let GEO, GEO_IDS;
  if (frame === 'detail') {
    const ctx = { window: { CITY: {} } };
    for (const f of needIds ? ['toronto-geodata', 'toronto-geodata-ids'] : ['toronto-geodata']) vm.runInNewContext(fs.readFileSync(path.join(ROOT, `js/${f}.js`), 'utf8'), ctx);
    ({ GEO, GEO_IDS } = ctx.window.CITY);
  } else {
    ({ GEO } = await unpackGeo(fs.readFileSync(path.join(ROOT, `data/frames/${frame}/toronto-geodata.bin`))));
    if (needIds) {
      if (!ids || !idsGeo) throw new Error(`--ids <toronto-geodata-ids.js> and --ids-geo <toronto-geodata.js>, built with the ${frame} geodata (tools/frames/build-frame.mjs), are needed`);
      GEO_IDS = alignIds(GEO, { ids, idsGeo });
    }
  }
  return { GEO, GEO_IDS, world: GEO.frame.detail };
}
