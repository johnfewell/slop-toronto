// Mapped City poles (st-26p.9): one GPU2 lock, sequential desktop and low-tier phone captures of the same shots.
// gpu2 <name> -- env CAPTURE_PORT=... node tools/check-poles.mjs [tag-prefix] [shots.json]
// (the pole looks, st-er2 & st-m3t: node tools/check-poles.mjs looks tools/shots/pole-looks.json)
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const prefix = process.argv[2] || 'poles';
const shots = process.argv[3] || path.join('tools/shots/mapped-poles.json');
for (const phone of [false, true]) {
  const result = spawnSync(process.execPath, ['tools/capture.mjs', shots], { stdio: 'inherit', env: { ...process.env, GPU2_OUT: process.env.GPU2_OUT || "gpu2-out",
    CAPTURE_TAG: `${prefix}-${phone ? "phone" : "desktop"}`, CAPTURE_QUERY: phone ? '?quality=low' : '', CAPTURE_PROGRESS: '1',
    ...(phone ? { CAPTURE_VIEWPORT: '412x915', CAPTURE_MOBILE: '1' } : {}) } });
  if (result.status !== 0) process.exit(result.status || 1);
}
