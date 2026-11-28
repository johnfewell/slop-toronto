// tools/check-tier-shaders.mjs: fails on any WebGPU shader or pipeline error at any quality tier
//
// A shader that only breaks on one tier (the medium tier's ShoreShallows water: an empty WGSL struct, so its render
// pipeline was invalid and the shore went missing) passes `npm test` and every high-tier capture. This loads the built
// page on the Mac mini at each tier, visits three views (downtown, the Island beach shore, High Park) and fails when
// the console shows a WebGPU shader or pipeline error.
//
//   npm run build
//   gpu2-local <name> -- env CAPTURE_ROOT=dist CAPTURE_PORT=<port> CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 \
//     node tools/check-tier-shaders.mjs [--tiers high,medium,low,phone] [--out <folder>]
//
// Tiers: high, medium and low are ?quality=<tier> at 1600x900; phone is ?quality=low in a 412x915 touch viewport at
// device pixel ratio 2.625 (the headless mini's GPU is not a mobile one, so the phone tier cannot be detected there).
// Each tier is one capture.mjs run (tools/shots/tier-shader-check.json), about 1 minute: the whole check is 4 to 5 min.
// The console of each run is kept as <out>/<tier>-console.log with a frame of each view beside it. Known noise is
// ignored: a 404 (the capture server has no /live/roadworks or /live/vehicles) and Three.js deprecation warnings.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TIERS = {
  high: { query: '?quality=high', env: {} },
  medium: { query: '?quality=medium', env: {} },
  low: { query: '?quality=low', env: {} },
  phone: { query: '?quality=low', env: { CAPTURE_VIEWPORT: '412x915', CAPTURE_DPR: '2.625', CAPTURE_MOBILE: '1' } }
};

// An error that is a WebGPU shader or pipeline failure (Three.js reports them as console errors, Chrome as warnings)
const GPU_ERROR = [
  /THREE\.WebGPURenderer.*(pipeline creation failed|Uncaptured WebGPU|fragment error|vertex error|compute error|shader)/i,
  /GPUValidationError/, /Error while parsing WGSL/i, /\bWGSL\b.*\berror\b/i,
  /Invalid (RenderPipeline|ComputePipeline|ShaderModule|BindGroup|CommandBuffer|BindGroupLayout|PipelineLayout)/,
  /pipeline creation failed/i, /\[pageerror\]/
];
const IGNORED = [/\b404\b/, /Failed to load resource/, /THREE\.TempNode: This module has been deprecated/, /^\[http (4|5)\d\d error\] .*\/live\//];

/** The console lines (one run's log) that are WebGPU shader or pipeline errors. */
export function gpuErrors(logText) {
  return logText.split('\n').filter((l) => l && GPU_ERROR.some((re) => re.test(l)) && !IGNORED.some((re) => re.test(l)));
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const tiers = opt('--tiers', 'high,medium,low,phone').split(',');
  const out = path.resolve(opt('--out', process.env.GPU2_OUT || 'tier-check-out'));
  const unknown = tiers.filter((t) => !TIERS[t]);
  if (unknown.length) { console.error(`unknown tier(s): ${unknown.join(', ')}`); process.exit(2); }
  const here = fileURLToPath(new URL('.', import.meta.url));
  fs.mkdirSync(out, { recursive: true });
  const basePort = Number(process.env.CAPTURE_PORT || 8768);
  let failed = 0;
  tiers.forEach((tier, i) => {
    const env = { ...process.env, ...TIERS[tier].env, GPU2_OUT: out, CAPTURE_TAG: tier, CAPTURE_PORT: String(basePort + i),
      CAPTURE_QUERY: TIERS[tier].query + (process.env.TIER_CHECK_QUERY || '') };
    const run = spawnSync('node', [path.join(here, 'capture.mjs'), path.join(here, 'shots', 'tier-shader-check.json')], { env, encoding: 'utf8' });
    const logFile = path.join(out, `${tier}-console.log`);
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    const errors = gpuErrors(log);
    const frames = ['downtown', 'shoreline', 'high-park'].filter((v) => fs.existsSync(path.join(out, `${tier}-view-${v}.png`))).length;
    if (run.status !== 0 || frames < 3 || errors.length) {
      failed++;
      console.log(`FAIL ${tier}: ${errors.length} WebGPU error line(s), ${frames}/3 frames${run.status !== 0 ? `, the capture exited ${run.status}` : ''}`);
      for (const e of errors.slice(0, 6)) console.log(`  ${e.slice(0, 240)}`);
      if (run.status !== 0 && !errors.length) console.log(`  ${(run.stdout + run.stderr).split('\n').filter(Boolean).slice(-4).join('\n  ')}`);
    } else console.log(`ok   ${tier}: no WebGPU shader or pipeline errors, 3/3 frames`);
  });
  console.log(failed ? `${failed} of ${tiers.length} tiers FAILED (logs and frames in ${out})` : `all ${tiers.length} tiers clean (logs and frames in ${out})`);
  process.exit(failed ? 1 : 0);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
