// tools/landing-stills-encode.mjs: turns chosen captures into the landing page's stills in assets/site/*.webp, each with
// its provenance JSON beside it (assets/site/<name>.webp.json: where the picture came from, as the older ones have).
// usage: node tools/landing-stills-encode.mjs <manifest.json>
// manifest: [{ "out": "assets/site/park-pond.webp", "src": "<capture>.png", "width": 1600, "what": "Grenadier Pond ...",
//              "shot": "tools/shots/landing-chosen.json grenadier-pond-180", "when": "26 Nov 2026 15:50 (real date, live sky)", "note": "…" }]
// Needs cwebp and ImageMagick (magick) on the PATH. Every picture is an in-app capture; nothing is generated or stock.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const m of manifest) {
  const tmp = `${m.out}.tmp.png`;
  fs.mkdirSync(path.dirname(m.out), { recursive: true });
  execFileSync('magick', [m.src, '-resize', `${m.width}x`, tmp]);
  execFileSync('cwebp', ['-quiet', '-q', String(m.quality || 82), '-m', '6', tmp, '-o', m.out]);
  fs.rmSync(tmp);
  const prompt = `ORIGIN (not generated, not stock): in-app capture of the Slop Toronto city, ${m.what}, rendered by tools/capture.mjs from ${m.shot} on the Mac mini via gpu2, ${m.when}.${m.note ? ' ' + m.note : ''} Shown on the home page (index.html).`;
  fs.writeFileSync(`${m.out}.json`, JSON.stringify({ prompt, createdAt: new Date().toISOString() }, null, 2));
  console.log(m.out, fs.statSync(m.out).size, 'B');
}
