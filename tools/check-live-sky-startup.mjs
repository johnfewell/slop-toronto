// tools/check-live-sky-startup.mjs — bead st-eyy2's regression check: the live sky's weather landing mid-startup.
// Run on the Mac mini, after `npm run build`:
//   gpu2 <name> -- env CAPTURE_ROOT=dist CAPTURE_PORT=… CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 node tools/check-live-sky-startup.mjs
// On a real open, Pearson's reading has usually arrived by the time the city is built, so its handler runs at the
// startup's first await: inside the shader precompile. A capture fixture with ?liveReading=1 hands its condition to that
// same handler, already resolved, so it lands at the same point every time. Three runs: desktop and a phone-sized
// touch viewport on the high tier (SSR: the scene pass's MRT, which the bug needs; the mini's GPU keeps the phone
// viewport on high), and the phone tier itself (?quality=low). Each fails on any WebGPU validation error in the
// console, or if the reading never landed (the sky must end up live, under the fixture's condition).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const out = process.env.GPU2_OUT || 'capture-out'; // (where tools/capture.mjs writes)
const fixture = '?liveClock=2026-10-31T20:28:00-04:00&liveWeather=Mainly%20Clear&liveReading=1';
const runs = [
  { tag: 'live-sky-startup-desktop', query: fixture },
  { tag: 'live-sky-startup-phone', query: fixture, phone: true },
  { tag: 'live-sky-startup-phone-low', query: `${fixture}&quality=low`, phone: true }
];
const GPU_ERROR = /GPUValidationError|Error while parsing WGSL|Invalid (CommandBuffer|RenderPipeline|ShaderModule|BindGroup)|\/ (fragment|vertex) error\]|pipeline creation failed/;
let failed = false;
for (const run of runs) {
  const result = spawnSync(process.execPath, ['tools/capture.mjs', 'tools/shots/live-sky-startup.json'], { stdio: 'inherit', env: {
    ...process.env, CAPTURE_CDN_CACHE: '1', CAPTURE_PROGRESS: '1', CAPTURE_TAG: run.tag, CAPTURE_QUERY: run.query,
    ...(run.phone ? { CAPTURE_VIEWPORT: '412x915', CAPTURE_MOBILE: '1' } : {})
  } });
  if (result.status !== 0) process.exit(result.status || 1);
  const log = fs.readFileSync(path.join(out, `${run.tag}-console.log`), 'utf8').split('\n');
  const errors = log.filter((line) => GPU_ERROR.test(line));
  const state = JSON.parse(fs.readFileSync(path.join(out, `${run.tag}-00-reading-landed.json`), 'utf8'));
  const landed = state.active === true && state.condition === 'Mainly Clear' && state.weather === 'mainlyClear';
  console.log(`[live-sky-startup] ${run.tag}: ${errors.length} WebGPU error line(s); reading ${landed ? 'landed' : 'MISSING'} (${state.weather}, ${state.clock})`);
  for (const line of errors.slice(0, 8)) console.log(`  ${line}`);
  if (errors.length || !landed) failed = true;
}
process.exit(failed ? 1 : 0);
