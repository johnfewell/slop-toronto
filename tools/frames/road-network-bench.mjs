// tools/frames/road-network-bench.mjs — times js/road-network.js buildRoadNetwork on today's map or a frame's data
// (no sidewalks or obstacles: the graph, its lanes and turns), for working on its boot cost off the GPU machine.
// usage: node tools/frames/road-network-bench.mjs [--frame eglinton] [--runs 3]
import fs from 'node:fs';
import vm from 'node:vm';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as THREE from '../../vendor/three/three.core.js';
import { unpackGeo } from '../../js/geodata-loader.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const { values: A } = parseArgs({ options: { frame: { type: 'string' }, runs: { type: 'string' }, hash: { type: 'boolean' } } });
import crypto from 'node:crypto';
const read = (f) => fs.readFileSync(ROOT + f, 'utf8');

export async function loadCity(frame) {
  const CITY = { THREE, Addons: {}, DEBUG_ROADS: false };
  const context = vm.createContext({ window: { CITY }, document: { addEventListener() {}, hidden: false }, addEventListener() {},
    location: { search: frame ? `?map=${frame}` : '' }, console: { info() {}, warn() {}, log() {}, error() {} }, atob, URLSearchParams });
  if (frame) {
    const { GEO, POLES } = await unpackGeo(fs.readFileSync(`${ROOT}data/frames/${frame}/toronto-geodata.bin`));
    Object.assign(CITY, { GEO, POLES });
  } else vm.runInContext(read('js/toronto-geodata.js'), context);
  const js = (f) => (frame && fs.existsSync(`${ROOT}js/frames/${frame}/${f}.js`) ? `js/frames/${frame}/${f}.js` : `js/${f}.js`);
  for (const f of ['toronto-subway', 'toronto-subway-topology', 'don-valley-data', 'don-valley', 'city-config', 'toronto-traffic-data',
    'toronto-signal-plan', 'road-network']) {
    if (fs.existsSync(ROOT + js(f))) vm.runInContext(read(js(f)), context, { filename: js(f) });
  }
  return CITY;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const C = await loadCity(A.frame);
  const runs = Number(A.runs || 3);
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    const N = C.buildRoadNetwork([], []);
    console.log(`${A.frame || 'today'}: ${N.nodes.length} nodes, ${N.edges.length} edges in ${(performance.now() - t0).toFixed(0)} ms`);
    if (A.hash && r === 0) {
      // the graph as traffic.js sees it: nodes (signals, sides), edges (lanes, moves out), crosswalks
      const id = new Map(N.nodes.map((n, i) => [n, i])), eid = new Map(N.edges.map((e, i) => [e, i]));
      const sig = JSON.stringify({
        nodes: N.nodes.map((n) => [n.x, n.z, !!n.signal, n.sigJ ?? -1, n.sideCount, n.groupCount]),
        edges: N.edges.map((e) => [id.get(e.from), id.get(e.to), e.lanes, e.moves.map((m) => [eid.get(m.to), m.turn, m.out])]),
        mid: N.midCrossings.length
      });
      console.log('graph hash', crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16));
    }
  }
}
