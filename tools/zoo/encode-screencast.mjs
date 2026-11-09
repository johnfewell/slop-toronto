// tools/zoo/encode-screencast.mjs: a tools/capture.mjs screencast (<name>-frames/: JPEG frames and frames.json, each
// frame's timestamp) to a 30 fps H.264 video at the frames' own timing (ffmpeg).
//   node tools/zoo/encode-screencast.mjs <frames-dir> <out.mp4>
//   node tools/zoo/encode-screencast.mjs --all <dir> [--rm]: every *-frames folder in dir to <name>.mp4 beside it (--rm:
//   the frames removed after, so a gpu2 run copies back only the videos)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function encode(dir, out) {
  const ts = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8'));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort((a, b) => parseInt(a) - parseInt(b));
  const T = (i) => (typeof ts[i] === 'number' ? ts[i] : ts[i].t);
  // (the concat demuxer: each frame shown until the next one's timestamp)
  const lines = [];
  for (let i = 0; i < files.length; i++) {
    const d = i + 1 < files.length ? Math.max(0.001, T(i + 1) - T(i)) : 1 / 30;
    lines.push(`file '${path.resolve(dir, files[i])}'`, `duration ${d.toFixed(4)}`);
  }
  lines.push(`file '${path.resolve(dir, files.at(-1))}'`);
  const list = path.join(dir, 'concat.txt');
  fs.writeFileSync(list, lines.join('\n') + '\n');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', out]);
  console.log(`${out}: ${files.length} frames, ${(T(files.length - 1) - T(0)).toFixed(1)} s`);
}

const args = process.argv.slice(2);
if (args[0] === '--all') {
  for (const f of fs.readdirSync(args[1]).filter((n) => n.endsWith('-frames'))) {
    const dir = path.join(args[1], f);
    if (!fs.existsSync(path.join(dir, 'frames.json'))) continue;
    encode(dir, path.join(args[1], f.replace(/-frames$/, '.mp4')));
    if (args.includes('--rm')) fs.rmSync(dir, { recursive: true });
  }
} else encode(args[0], args[1]);
