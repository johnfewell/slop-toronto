// The City's furniture and amenities of one frame, in the files ?map=<frame> loads in place of the detail map's
// (js/frames/<frame>/): benches, wayfinding, poster/publication structures, parking pay stations, CaféTO cafés, washrooms
// and other facilities, public art, the heritage register and Bike Share stations. Each is the same build tool as the detail
// map's, run on the frame's own database (data/frames/<frame>/toronto-geodata.bin) with `--frame`.
// usage: node tools/build-frame-city-data.mjs --frame eglinton --ids <toronto-geodata-ids.js> --ids-geo <toronto-geodata.js>
//   (the two are what `node tools/frames/build-frame.mjs --frame tools/frames/eglinton.json --out <dir> --skip sidewalks,traffic,
//   transit,signal-plan,subway,subway-topology,massing-bin,poles,pack` writes: they give the art and heritage records their
//   durable building and place IDs; the CaféTO layout is then recorded again, docs/cafeto-patios.md)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { frameArgs } from './frame-geo.mjs';

const { frame, ids, idsGeo } = frameArgs();
if (frame === 'detail') throw new Error('--frame <name>: the detail map\'s files are built by the tools themselves');
const tools = fileURLToPath(new URL('.', import.meta.url));
const steps = [
  ['build-open-data.mjs', []],
  ['build-parking-meters.mjs', ['--frame', frame]],
  ['build-cafeto.mjs', ['--frame', frame]],
  ['build-city-facilities.mjs', ['--frame', frame]],
  ['build-art-heritage.mjs', ['--frame', frame, ...(ids ? ['--ids', ids] : []), ...(idsGeo ? ['--ids-geo', idsGeo] : [])]],
  ['geo-bikeshare.mjs', ['--frame', frame]]
];
for (const [tool, args] of steps) {
  const r = spawnSync(process.execPath, [tools + tool, ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${tool} failed (${r.status})`);
}
