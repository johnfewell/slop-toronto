// tools/frames/boot-cost.mjs — the CPU side of a frame's boot, without a browser: decodes a geodata binary
// (js/geodata-loader.js) and runs js/city-config.js on it in a node vm, reporting the time and the heap each takes, and
// the sizes of city-config's dense per-cell grids (docs/map-scale-measurements.md). Node, not the browser's V8 tiering
// or a phone: a comparison between frames on one machine, not a load-time budget.
// usage: node --expose-gc tools/frames/boot-cost.mjs <toronto-geodata.bin> [--json]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const bin = path.resolve(process.argv[2] || path.join(ROOT, 'data/toronto-geodata.bin'));
const gc = () => globalThis.gc && (globalThis.gc(), globalThis.gc());
const heapMB = () => { gc(); return +(process.memoryUsage().heapUsed / 1048576).toFixed(1); };
const out = { bin, binBytes: fs.statSync(bin).size };

const h0 = heapMB();
let t = performance.now();
const { loadGeo } = await import(pathToFileURL(path.join(ROOT, 'js/geodata-loader.js')).href);
const bytes = fs.readFileSync(bin);
const res = new Response(bytes);
const window = { CITY: {} };
globalThis.window = window;
Object.assign(window.CITY, await loadGeo(Promise.resolve(res)));
out.decodeMs = Math.round(performance.now() - t);
const GEO = window.CITY.GEO;
if (!GEO) throw new Error('loadGeo did not set window.CITY.GEO');
out.heapAfterDecodeMB = +(heapMB() - h0).toFixed(1);
out.frame = GEO.frame.detail;
out.counts = { buildings: GEO.buildings.length, blocks: GEO.blocks.length, roads: GEO.roads.length, streetTrees: GEO.streetTrees.length / 4,
  signals: GEO.signals.length, areas: GEO.areas.length, pois: GEO.pois.length, roadGraphNodes: GEO.roadGraph.nodes?.length,
  roadGraphLinks: GEO.roadGraph.links?.length, rails: GEO.rails.length, tramStops: GEO.tramStops.length, hydrants: GEO.props?.hydrant?.length, poles: window.CITY.POLES?.counts };

// city-config.js in a vm context sharing this window (as the tests run it)
const ctx = vm.createContext({ window, console, performance, Math, location: { search: '' } });
t = performance.now();
try {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/city-config.js'), 'utf8'), ctx, { filename: 'city-config.js' });
  out.cityConfigMs = Math.round(performance.now() - t);
} catch (e) {
  out.cityConfigMs = Math.round(performance.now() - t);
  out.cityConfigError = e.stack.split('\n').slice(0, 4).join(' | ');
}
out.heapAfterCityConfigMB = +(heapMB() - h0).toFixed(1);
const C = window.CITY;
const typed = [];
for (const [k, v] of Object.entries(C)) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [kk, vv] of Object.entries(v)) if (ArrayBuffer.isView(vv) && vv.byteLength > 1 << 20) typed.push([`${k}.${kk}`, +(vv.byteLength / 1048576).toFixed(1)]);
  }
}
out.largeTypedArraysMB = Object.fromEntries(typed);
out.waterMaskTexels = GEO.waterMask ? [GEO.waterMask.w, GEO.waterMask.h] : null;
if (process.argv.includes('--json')) console.log(JSON.stringify(out));
else console.log(out);
