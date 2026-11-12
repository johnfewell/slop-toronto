// Complete the camera review under one Mini lock. The phone layout is emulated;
// timings remain functional evidence unless a separate idle protocol qualifies them.
import { spawnSync } from 'node:child_process';
if (process.env.GPU2 !== '1') throw new Error('Run camera rendering checks through gpu2 on the Mac mini');
const selected = (process.env.CAMERA_RUNS || 'high,portrait,bridge,ab').split(',');
for (const run of selected) {
  if (!['high', 'portrait', 'ab', 'bridge'].includes(run)) throw new Error(`Unknown camera run: ${run}`);
  const portrait = run === 'portrait', ab = run === 'ab', bridge = run === 'bridge';
  const child = spawnSync(process.execPath, ['tools/capture.mjs', ab ? 'tools/shots/camera-rig-ab.json' : bridge ? 'tools/shots/camera-rig-bridge.json' : 'tools/shots/camera-rig-functional.json'], {
    stdio: 'inherit', env: { ...process.env, CAPTURE_ROOT: 'dist', CAPTURE_PORT: '8897',
      CAPTURE_QUERY: `?quality=${portrait ? 'low' : 'high'}&autoscale=0&transit=timetable&cloudSpeed=0&cameraMetrics=1&metrics=1&time=midday&sound=0`,
      CAPTURE_VIEWPORT: portrait ? '412x915' : '1600x900', CAPTURE_MOBILE: portrait ? '1' : '',
      CAPTURE_SEED: '6711', CAPTURE_CDN_CACHE: '1', CAPTURE_IDLE_CHECK: '1', CAPTURE_PROGRESS: '1',
      CAPTURE_METRICS_MS: ab ? '1000' : '0', CAPTURE_LOAD_TIMEOUT_MS: '120000', CAPTURE_TAG: `camera-${run}` }
  });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status || 1);
}
