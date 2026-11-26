// node tools/perf1/diffimg.mjs a.png b.png out.png: a | b | difference (x4) side by side, for judging a "no visible change" claim
import sharp from 'sharp';
const [a, b, out] = process.argv.slice(2);
const A = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true }), B = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = A.info, D = Buffer.alloc(w * h * 3);
for (let i = 0; i < w * h * 3; i++) D[i] = Math.min(255, Math.abs(A.data[i] - B.data[i]) * 4);
const sheet = await sharp({ create: { width: w * 3, height: h, channels: 3, background: '#000' } })
  .composite([{ input: A.data, raw: { width: w, height: h, channels: 3 }, left: 0, top: 0 }, { input: B.data, raw: { width: w, height: h, channels: 3 }, left: w, top: 0 }, { input: D, raw: { width: w, height: h, channels: 3 }, left: 2 * w, top: 0 }])
  .png().toBuffer();
await sharp(sheet).resize(2400).png().toFile(out);
