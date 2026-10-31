// Public art & heritage discovery captures (docs/public-art-heritage.md): desktop, then an explicit low-tier phone, of
// the same shot list, under one gpu2 lock. Run from the worktree after `npm run build`:
//   gpu2 <name> -- env CAPTURE_ROOT=dist CAPTURE_PORT=… CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 node tools/check-art-heritage.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const shots = JSON.parse(fs.readFileSync('tools/shots/art-heritage.json', 'utf8'));
const file = path.join(process.env.GPU2_OUT || 'gpu2-out', 'art-heritage-shots.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(shots));
for (const phone of [false, true]) {
  const result = spawnSync(process.execPath, ['tools/capture.mjs', file], { stdio: 'inherit', env: { ...process.env,
    CAPTURE_TAG: phone ? 'art-heritage-phone' : 'art-heritage-desktop', CAPTURE_QUERY: phone ? '?quality=low' : '', CAPTURE_PROGRESS: '1',
    ...(phone ? { CAPTURE_VIEWPORT: '412x915', CAPTURE_MOBILE: '1' } : {}) } });
  if (result.status !== 0) process.exit(result.status || 1);
}
