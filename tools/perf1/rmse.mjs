import sharp from 'sharp';
const dir = process.argv[2];
async function px(f) { const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; }
async function rm(a, b) { const A = await px(dir + a), B = await px(dir + b); let s = 0, big = 0; const n = A.w * A.h; for (let i = 0; i < n; i++) { let m = 0; for (let c = 0; c < 3; c++) { const d = A.data[i * 3 + c] - B.data[i * 3 + c]; s += d * d; m = Math.max(m, Math.abs(d)); } if (m > 24) big++; } return [+Math.sqrt(s / (n * 3)).toFixed(2), +(big / n * 100).toFixed(3)]; }
for (const [t, pls] of [[process.argv[3], process.argv.slice(4)]]) for (const pl of pls) {
  console.log(pl, 'main r1-r2 (noise)', await rm(`${t}-main-r1-visit-${pl}.png`, `${t}-main-r2-visit-${pl}.png`), 'main r1-pr r1', await rm(`${t}-main-r1-visit-${pl}.png`, `${t}-pr-r1-visit-${pl}.png`), 'pr r1-r2', await rm(`${t}-pr-r1-visit-${pl}.png`, `${t}-pr-r2-visit-${pl}.png`));
}
