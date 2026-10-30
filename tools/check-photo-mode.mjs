// Run both photo tiers under one gpu2 lock/sync. Functional evidence, not an idle benchmark.
import { spawnSync } from 'node:child_process';
if (process.env.GPU2 !== '1') throw new Error('Photo integration checks must run through gpu2');
const tiers = (process.env.PHOTO_TIERS || 'high,low').split(',');
if (tiers.some((tier) => !['high', 'low'].includes(tier))) throw new Error('Invalid PHOTO_TIERS');
for (const tier of tiers) {
  const result = spawnSync(process.execPath, ['tools/capture.mjs', 'tools/shots/photo-resize.json', 'tools/shots/photo-convergence.json', 'tools/shots/photo-draft.json'], {
    stdio: 'inherit', env: { ...process.env, CAPTURE_ROOT: 'dist', CAPTURE_QUERY: `?quality=${tier}&autoscale=0&photo=1&transit=timetable&bikes=static&sound=0`,
      CAPTURE_VIEWPORT: tier === 'high' ? '1600x900' : '412x915', CAPTURE_MOBILE: tier === 'low' ? '1' : '',
      CAPTURE_INIT_SCRIPT: 'tools/photo-fixtures.js', CAPTURE_LOAD_TIMEOUT_MS: '120000', CAPTURE_PROGRESS: '1',
      CAPTURE_TAG: `${process.env.PHOTO_TAG || 'photo'}-${tier}` }
  });
  if (result.error || result.status !== 0) { if (result.error) console.error(result.error.message); process.exit(result.status || 1); }
}
