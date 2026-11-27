// tools/perf1/strips-pixels.mjs <dir> <cell> <place> [<place> ...]: how far the fitted strips' frames differ from the quad's (jf-baa), on the screenshots
// strips.sh saved (<cell>-<arm>-r<round>-visit-<place>.png). The noise is the quad against itself in another round (moving traffic, people, the
// clouds' drift, the hand-over dissolve's dither). Only the lower 60% of the frame is compared: the woods, not the sky. Prints RMSE (0-255) and the
// share of pixels differing by more than 24 in some channel.
import sharp from 'sharp';
const [dir, cell, ...places] = process.argv.slice(2);
const px = async (f) => { const { data, info } = await sharp(`${dir}/${f}`).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
async function cmp(a, b) {
  const A = await px(a), B = await px(b), y0 = Math.floor(A.h * 0.4);
  let s = 0, big = 0, n = 0;
  for (let i = y0 * A.w; i < A.w * A.h; i++, n++) { let m = 0; for (let c = 0; c < 3; c++) { const d = A.data[i * 3 + c] - B.data[i * 3 + c]; s += d * d; m = Math.max(m, Math.abs(d)); } if (m > 24) big++; }
  return `${Math.sqrt(s / (n * 3)).toFixed(2)} rmse, ${(big / n * 100).toFixed(3)}% over 24`;
}
for (const p of places) {
  console.log(`${cell} ${p}: noise (quad r1 vs quad r2) ${await cmp(`${cell}-off-r1-visit-${p}.png`, `${cell}-off-r2-visit-${p}.png`)}`);
  for (const a of ['s1', 's2', 's4', 's8', 's16']) {
    try { console.log(`   quad vs ${a} (round 1): ${await cmp(`${cell}-off-r1-visit-${p}.png`, `${cell}-${a}-r1-visit-${p}.png`)}`); } catch { /* arm not run in this cell */ }
  }
}
