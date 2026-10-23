// tools/build-loader-art.mjs — prints the loading screen's scenery symbols (explore.html, #loading-overlay): the far &
// near skylines, the tree line and the lake's sparkles, each a 360 × 170 tile that wraps seamlessly, so a layer of two
// side by side can slide one tile's width forever. Seeded, so a rerun gives the same skyline.
// usage: node tools/build-loader-art.mjs > /tmp/loader-symbols.html   (then paste over the <symbol>s in explore.html)
let seed = 20261023;
const rnd = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r1 = (v) => Math.round(v * 10) / 10;
const W = 360;
// a shape crossing a tile edge is drawn again one tile over, so the tile wraps
const wrap = (x0, x1, draw) => [draw(0), x0 < 0 ? draw(W) : '', x1 > W ? draw(-W) : ''].join('');

// Far skyline: a hazy band of towers behind everything
let far = '';
for (let x = -6; x < W; ) {
  const w = 7 + rnd() * 14, top = 80 + rnd() * 34;
  const step = rnd() < 0.35 ? 3 + rnd() * 6 : 0;
  far += wrap(x, x + w, (o) => `<path d="M${r1(x + o)} 126V${r1(top + step)}h${r1(w * 0.2)}V${r1(top)}h${r1(w * 0.6)}V${r1(top + step)}h${r1(w * 0.2)}V126z"/>`);
  x += w + rnd() * 3;
}

// Near skyline: the Financial District, the CN Tower, the Rogers Centre's dome, then the waterfront condos
let near = '', lights = '';
const tower = (x, w, top, lit = 0.5) => {
  near += wrap(x, x + w, (o) => `<rect x="${r1(x + o)}" y="${r1(top)}" width="${r1(w)}" height="${r1(126 - top)}"/>`);
  for (let y = top + 4; y < 118; y += 4) {
    for (let wx = x + 1.8; wx < x + w - 2; wx += 3) {
      if (rnd() < 0.16 * lit) lights += wrap(wx, wx + 1.2, (o) => `<rect x="${r1(wx + o)}" y="${r1(y)}" width="1.2" height="1.8"/>`);
    }
  }
};
[[2, 12, 92], [16, 9, 100], [30, 14, 84], [47, 10, 96]].forEach(([x, w, t]) => tower(x, w, t, 0.4));
// the core: tall glass towers stepping up towards the tower
[[62, 13, 58], [77, 10, 70], [89, 15, 44], [106, 11, 52], [119, 9, 66], [130, 12, 74]].forEach(([x, w, t]) => tower(x, w, t, 1));
// the CN Tower (its base hidden by the trees) and the dome beside it
near += `<path d="M144.5 126 148.9 52h2.2l4.4 74z"/><ellipse cx="150" cy="51" rx="8.2" ry="3.4"/><rect x="146.4" y="47.2" width="7.2" height="3.6" rx="1.2"/><path d="M149 47.4 149.3 33h1.4l.3 14.4z"/><ellipse cx="150" cy="33.4" rx="2.8" ry="1.4"/><path d="M149.55 32.6 149.7 12h.6l.15 20.6z"/>`;
near += `<path d="M164 126c2-13 12-21 24-21s22 8 24 21z"/><path d="M162 126v-6h52v6z"/>`;
[[218, 10, 86], [230, 13, 74], [245, 9, 92], [256, 14, 80], [272, 10, 98], [284, 12, 88], [298, 9, 104], [309, 14, 94], [325, 10, 100], [337, 13, 90], [352, 12, 92]].forEach(([x, w, t]) => tower(x, w, t, 0.55));

// Tree line: round crowns along the park, trunks under them
let trees = '';
for (let x = 2; x < W; ) {
  const r = 4.5 + rnd() * 5, cy = 124 - r * 0.55 + rnd() * 3;
  const shade = rnd() < 0.5 ? '#14463a' : '#1d5a44';
  trees += wrap(x - r, x + r, (o) => `<circle fill="${shade}" cx="${r1(x + o)}" cy="${r1(cy)}" r="${r1(r)}"/>`);
  if (rnd() < 0.55) trees += wrap(x - 1, x + 1, (o) => `<rect fill="#0f2f2a" x="${r1(x + o - 0.6)}" y="${r1(cy + r * 0.6)}" width="1.2" height="${r1(134 - cy - r * 0.6)}"/>`);
  x += r * (0.9 + rnd() * 1.1);
}

// Lake sparkles: short golden strokes, fewer and longer towards the front
const sparkles = (n) => {
  let s = '';
  for (let i = 0; i < n; i++) {
    const y = 149 + rnd() * 19, len = 3 + ((y - 149) / 19) * 9 * rnd() + 2, x = rnd() * W;
    s += wrap(x, x + len, (o) => `<path d="M${r1(x + o)} ${r1(y)}h${r1(len)}" opacity="${r1(0.35 + rnd() * 0.6)}"/>`);
  }
  return s;
};

const vb = 'viewBox="0 0 360 170"';
// (the far skyline's haze is opaque: see-through towers turn grey over the sun's glow)
console.log(`<linearGradient id="ld-haze" x1="0" y1="80" x2="0" y2="126" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6a8bb8"/><stop offset="1" stop-color="#c7a98c"/></linearGradient>
<symbol id="ld-far" ${vb}><g fill="url(#ld-haze)">${far}</g></symbol>
<symbol id="ld-near" ${vb}><g fill="#0d2238">${near}</g><g fill="#ffd28a" opacity="0.75">${lights}</g></symbol>
<symbol id="ld-trees" ${vb}>${trees}</symbol>
<symbol id="ld-dashes" ${vb}><path d="M0 140.2H360" stroke="#f6d27a" stroke-width="1.1" stroke-dasharray="7 11"/></symbol>
<symbol id="ld-sparkle-a" ${vb}><g stroke="#f6c77a" stroke-width="1.1" stroke-linecap="round">${sparkles(26)}</g></symbol>
<symbol id="ld-sparkle-b" ${vb}><g stroke="#fff1cf" stroke-width="0.9" stroke-linecap="round">${sparkles(18)}</g></symbol>`);
