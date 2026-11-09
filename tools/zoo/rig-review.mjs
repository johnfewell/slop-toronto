// Review renders of the zoo animals' rig (tools/zoo/rig.mjs): for each species a row of small software renders: the
// weights (neck red, head yellow, tail blue, legs green by leg, ears magenta), at rest, grazing (or pecking), looking
// round, and a walk cycle's quarters, the ground as a line; the hinges marked.
//   node tools/zoo/rig-review.mjs <out.png> [species,...]
import sharp from 'sharp';
import { loadTris } from './load-tris.mjs';
import { computeRig, pose, GAIT } from './rig.mjs';

const out = process.argv[2];
const names = (process.argv[3] || 'bison,yak,highland,llama,reindeer,mouflon,barbary,capybara,emu,peafowl').split(',');
const toS = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const PW = 420, PH = 330;
const LEGC = { 1: [0.1, 0.8, 0.1], 2: [0.1, 0.45, 0.1], 3: [0.5, 0.9, 0.3], 4: [0.3, 0.6, 0.2] };
function weightColour(a) {
  const code = Math.floor(a[3] * 8 + 0.02), wl = code ? Math.max(0, (a[3] * 8 - code) / 0.9) : 0;
  let c = [0.55, 0.55, 0.55];
  const mixc = (to, t) => { c = c.map((v, i) => v + (to[i] - v) * t); };
  if (code >= 1 && code <= 4) mixc(LEGC[code], wl);
  if (code >= 5) mixc([0.9, 0.1, 0.9], wl);
  mixc([0.9, 0.1, 0.1], a[0]);
  mixc([1, 0.9, 0.1], a[1]);
  mixc([0.1, 0.2, 0.9], a[2]);
  return c;
}
function panel(tris, attr, P, S, view, colourBy, scale, label) {
  const img = new Float32Array(PW * PH * 3).fill(0.82), zb = new Float32Array(PW * PH).fill(Infinity);
  const yaw = view === 'side' ? -Math.PI / 2 : view === 'front' ? 0 : view === 'back' ? Math.PI : -Math.PI / 2 + 0.75;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const proj = ([x, y, z]) => { const rx = x * cy + z * sy, rz = -x * sy + z * cy; return [PW / 2 + rx * scale, PH - 30 - y * scale, -rz]; };
  // ground
  for (let x = 0; x < PW; x++) for (let y = PH - 30; y < PH; y++) img.set([0.45, 0.55, 0.35], (y * PW + x) * 3);
  const sun = [0.35, 0.8, 0.48];
  tris.forEach((t, ti) => {
    const posed = t.p.map((p, k) => pose(p, [0, 1, 0], attr[ti][k], P, S).p);
    const [a, b, c] = posed;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    const d = Math.abs((nx * sun[0] + ny * sun[1] + nz * sun[2]) / l);
    const base = colourBy ? weightColour(attr[ti][0]) : t.c;
    const shade = base.map((v) => v * (0.35 + 0.75 * d));
    const q = posed.map(proj);
    const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
    if (Math.abs(area) < 1e-9) return;
    const minx = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))), maxx = Math.min(PW - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])));
    const miny = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))), maxy = Math.min(PH - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])));
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((q[1][0] - px) * (q[2][1] - py) - (q[2][0] - px) * (q[1][1] - py)) / area;
      const w1 = ((q[2][0] - px) * (q[0][1] - py) - (q[0][0] - px) * (q[2][1] - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], i = y * PW + x;
      if (z < zb[i]) { zb[i] = z; img.set(shade, i * 3); }
    }
  });
  const buf = Buffer.alloc(PW * PH * 3);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.round(255 * toS(Math.min(1, img[i])));
  const marks = [];
  if (view === 'side' && colourBy) for (const [y, z] of [P.neck, P.head, P.tail, P.hipF, P.hipB]) { if (!y && !z) continue; const [x, yy] = proj([0, y, z]); marks.push(`<circle cx="${x}" cy="${yy}" r="3" fill="none" stroke="#000"/>`); }
  const svg = `<svg width="${PW}" height="${PH}" xmlns="http://www.w3.org/2000/svg">${marks.join('')}<text x="4" y="14" style="font:12px sans-serif">${label}</text></svg>`;
  return sharp(buf, { raw: { width: PW, height: PH, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}
const report = {};
for (const n of names) {
  const { tris } = await loadTris(n);
  const { attr, params: P, stats } = computeRig(tris, n);
  report[n] = stats;
  const scale = Math.min((PW - 20) / Math.max(P.length, 0.5) / 1.15, (PH - 50) / P.height / 1.1);
  const rest = { g: 0, look: 0, stride: 0, amp: 0, t: 0, seed: 0 };
  const graze = { ...rest, g: 1 };
  const stride = (ph) => (ph * 2 * P.exc) / GAIT.duty;
  const panels = await Promise.all([
    panel(tris, attr, P, rest, 'side', true, scale, `${n} weights`),
    panel(tris, attr, P, rest, 'back', true, scale, 'weights, back'),
    panel(tris, attr, P, rest, 'three', false, scale, 'rest'),
    panel(tris, attr, P, graze, 'side', false, scale, `graze (reach ${P.reach.toFixed(2)} m)`),
    panel(tris, attr, P, graze, 'three', false, scale, 'graze 3/4'),
    panel(tris, attr, P, { ...rest, look: 0.6, g: -0.12 }, 'three', false, scale, 'look round'),
    ...[0, 0.25, 0.5, 0.75].map((ph) => panel(tris, attr, P, { ...rest, stride: stride(ph), amp: 1, t: 1.3 }, 'side', false, scale, `walk ${ph}`))
  ]);
  await sharp({ create: { width: PW * 5, height: PH * 2, channels: 3, background: '#000' } }).composite(panels.map((p, i) => ({ input: p, left: (i % 5) * PW, top: Math.floor(i / 5) * PH }))).png().toFile(out.replace(/\.png$/, `-${n}.png`));
}
console.log(JSON.stringify(report));
