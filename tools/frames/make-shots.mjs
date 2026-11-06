// tools/frames/make-shots.mjs — writes tools/shots/map-scale.json, the views measured in every frame
// (docs/map-scale-measurements.md): a downtown street, an aerial over the core, a street in the new area (Yonge &
// Eglinton), the highest aerial the helicopter reaches, and (`--city`) Borough Drive at Scarborough Town Centre, looking east. Each view is two shots:
// the view itself (capture.mjs's frame-time window when CAPTURE_METRICS_MS is set, and the screenshot), then its
// record, tools/frames/probe.js (triangles, systems' CPU, counts, heap).
// usage: node tools/frames/make-shots.mjs [--city] [--out tools/shots/map-scale.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const probe = fs.readFileSync(path.join(ROOT, 'tools/frames/probe.js'), 'utf8').replace(/^\/\/.*\n/gm, '').trim();
const city = process.argv.includes('--city');
const outIdx = process.argv.indexOf('--out');
const out = path.resolve(outIdx > 0 ? process.argv[outIdx + 1] : path.join(ROOT, city ? 'tools/shots/map-scale-city.json' : 'tools/shots/map-scale.json'));
// Positions set in the shot's own script: the helicopter's altitude needs teleportActiveTo (main.js teleportTo drops it
// in the air), and a walker after the helicopter is set straight into its mode (switchMode looks for ground under the
// helicopter's altitude and can refuse)
const heli = (x, z, y) => `(() => { const a = window.__CITY_APP, cm = a.controllerManager; a.selectMode('helicopter');
  a.teleportTo(${x}, ${z}, Math.PI); cm.teleportActiveTo(${x}, ${z}, Math.PI, ${y}); a.selectCamera('chase', true); return cm.getActiveEntity().position.y; })()`;
const walk = (x, z, h = 'Math.PI') => `(() => { const a = window.__CITY_APP, cm = a.controllerManager; if (cm.activeMode !== 'person') cm.setMode('person');
  a.teleportTo(${x}, ${z}, ${h}); a.selectCamera('pov', true); const p = cm.getActiveEntity().position; return [cm.activeMode, p.x, p.z]; })()`;
const views = [
  // King St W at Bay, looking north up Bay (the adoption baseline's street)
  { name: 'street-downtown', time: 'golden', js: walk(386.5, -343.6) },
  // over the harbour, 220 m up, looking north over the core
  { name: 'aerial-core', time: 'golden', js: heli(300, 1800, 220) },
  // Yonge & Eglinton, looking north up Yonge (outside the detail frame: there the player stops at its edge)
  { name: 'street-yonge-eglinton', time: 'golden', js: walk(568, -6937) },
  // the helicopter's ceiling (380 m), out over the lake, looking north at the whole city
  { name: 'aerial-high', time: 'golden', js: heli(500, 3300, 380) },
  ...(city ? [{ name: 'street-stc', time: 'golden', js: walk(13362, -11057, 'Math.PI / 2') }] : [])
];
const shots = views.flatMap((v) => [{ ...v, record: true, wait: 6000 }, { name: `${v.name}-record`, js: probe, record: true, wait: 300 }]);
fs.writeFileSync(out, JSON.stringify(shots, null, 1) + '\n');
console.log(`wrote ${path.relative(ROOT, out)} (${shots.length} shots)`);
