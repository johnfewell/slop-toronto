// tools/perf1/strips-orbit.mjs <dir> <tagA> <tagB> <out dir>: the slow orbit's two arms compared (jf-baa; tools/perf1/make.mjs job `orbit`).
// <dir>/<tag>-orbit-NNN.png are the stills of each arm (A: the quad, B: the strips). Prints, per frame, how far B is from A
// (RMSE over the lower 70% of the frame, the woods; share of pixels differing by more than 24), and for each arm the change from one frame to the
// next: a pop (an elevation cross-fade jumping, a crown clipped on one side) shows as a spike in one arm's series that the other doesn't have.
// Writes <out>/orbit-sheet.png (every 12th frame: A | B | difference x6) and the numbers to <out>/orbit-stats.json.
import sharp from 'sharp';
import fs from 'node:fs';
const [dir, tagA, tagB, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const N = fs.readdirSync(dir).filter((f) => f.startsWith(`${tagA}-orbit-`) && /-orbit-\d{3}\.png$/.test(f)).length;
const load = async (tag, i) => { const { data, info } = await sharp(`${dir}/${tag}-orbit-${String(i).padStart(3, '0')}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
const cmp = (A, B) => {
  const y0 = Math.floor(A.h * 0.3); let s = 0, big = 0, n = 0;
  for (let i = y0 * A.w; i < A.w * A.h; i++, n++) { let m = 0; for (let c = 0; c < 3; c++) { const d = A.data[i * 3 + c] - B.data[i * 3 + c]; s += d * d; m = Math.max(m, Math.abs(d)); } if (m > 24) big++; }
  return [Math.sqrt(s / (n * 3)), big / n * 100];
};
const rows = [], tiles = [];
let pa = null, pb = null;
for (let i = 0; i < N; i++) {
  const A = await load(tagA, i), B = await load(tagB, i);
  const [rm, big] = cmp(A, B);
  const stepA = pa ? cmp(pa, A) : [0, 0], stepB = pb ? cmp(pb, B) : [0, 0];
  rows.push({ i, rmse: +rm.toFixed(2), over24: +big.toFixed(3), stepA: +stepA[0].toFixed(2), stepB: +stepB[0].toFixed(2) });
  if (i % 12 === 0) {
    const D = Buffer.alloc(A.data.length); for (let k = 0; k < D.length; k++) D[k] = Math.min(255, Math.abs(A.data[k] - B.data[k]) * 6);
    const w = 800, h = Math.round(A.h * w / A.w), t = (buf) => sharp(buf, { raw: { width: A.w, height: A.h, channels: 3 } }).resize(w, h).png().toBuffer();
    tiles.push([await t(A.data), await t(B.data), await t(D), h]);
  }
  pa = A; pb = B;
}
const h = tiles[0][3];
await sharp({ create: { width: 2400, height: h * tiles.length, channels: 3, background: '#000' } })
  .composite(tiles.flatMap(([a, b, d], k) => [{ input: a, left: 0, top: k * h }, { input: b, left: 800, top: k * h }, { input: d, left: 1600, top: k * h }])).png().toFile(`${out}/orbit-sheet.png`);
const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
const stats = { frames: N, meanRmse: +mean('rmse').toFixed(2), maxRmse: Math.max(...rows.map((r) => r.rmse)), meanOver24: +mean('over24').toFixed(3), maxOver24: Math.max(...rows.map((r) => r.over24)),
  stepMeanA: +mean('stepA').toFixed(2), stepMaxA: Math.max(...rows.map((r) => r.stepA)), stepMeanB: +mean('stepB').toFixed(2), stepMaxB: Math.max(...rows.map((r) => r.stepB)), rows };
fs.writeFileSync(`${out}/orbit-stats.json`, JSON.stringify(stats, null, 1) + '\n');
console.log({ ...stats, rows: undefined });
console.log('worst frames (B from A):', rows.slice().sort((a, b) => b.rmse - a.rmse).slice(0, 5).map((r) => `${r.i}: ${r.rmse} rmse, ${r.over24}%`).join('; '));
console.log('biggest steps A:', rows.slice().sort((a, b) => b.stepA - a.stepA).slice(0, 4).map((r) => `${r.i}: ${r.stepA}`).join('; '), ' B:', rows.slice().sort((a, b) => b.stepB - a.stepB).slice(0, 4).map((r) => `${r.i}: ${r.stepB}`).join('; '));
