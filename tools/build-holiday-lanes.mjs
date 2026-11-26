// tools/build-holiday-lanes.mjs: where the Distillery Winter Village's overhead light strings, stalls and tree go.
// Reads the mapped building footprints inside the district's outline (LANDMARK_SITES.distillery) and finds the open lanes
// between them: a string spans an open gap of 6-18 m whose two ends are walls at least 5.5 m high; stalls hug the walls of
// wide lanes with the middle left clear; the tree stands at the open spot with 7 m clear all round nearest the district's centre. The result is js/toronto-holiday.js
// (a game layout derived from footprints, not a survey of the village; docs/holiday-installations.md).
// Run: node tools/build-holiday-lanes.mjs
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const ctx = { window: {}, atob: (s) => Buffer.from(s, 'base64').toString('binary') };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('js/toronto-geodata.js', root), 'utf8'), ctx);
const G = ctx.window.CITY.GEO, site = G.landmarks.distillery, ring = site.ring;

const inRing = (x, z) => {
  let ins = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2)
    if ((ring[i + 1] > z) !== (ring[j + 1] > z) && x < ((ring[j] - ring[i]) * (z - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]) ins = !ins;
  return ins;
};
let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
x0 = Math.floor(x0) - 10; z0 = Math.floor(z0) - 10; x1 = Math.ceil(x1) + 10; z1 = Math.ceil(z1) + 10;
const W = x1 - x0, H = z1 - z0, h = new Float32Array(W * H); // building height per 1 m cell (0 = open)
for (const [bx, bz, ang, boxes, bh] of G.buildings) {
  if (bx < x0 - 80 || bx > x1 + 80 || bz < z0 - 80 || bz > z1 + 80) continue;
  const c = Math.cos(ang), s = Math.sin(ang);
  for (const [a, b, c0, c1] of boxes) for (let lx = a; lx <= b; lx += 0.5) for (let lz = c0; lz <= c1; lz += 0.5) {
    const i = Math.floor(bx + lx * c - lz * s - x0), j = Math.floor(bz + lx * s + lz * c - z0);
    if (i >= 0 && i < W && j >= 0 && j < H) h[j * W + i] = Math.max(h[j * W + i], bh || 3);
  }
}
const open = (i, j) => i >= 0 && i < W && j >= 0 && j < H && h[j * W + i] === 0 && inRing(x0 + i + 0.5, z0 + j + 0.5);
const wall = (i, j, min = 5.5) => i >= 0 && i < W && j >= 0 && j < H && h[j * W + i] >= min;

const strings = [];
const near = (x, z, d) => strings.some((s) => Math.hypot((s[0] + s[2]) / 2 - x, (s[1] + s[3]) / 2 - z) < d);
for (const dir of ['x', 'z']) for (let a = 0; a < (dir === 'x' ? H : W); a++) {
  const n = dir === 'x' ? W : H, at = (k) => (dir === 'x' ? [k, a] : [a, k]);
  let k = 0;
  while (k < n) {
    if (!open(...at(k))) { k++; continue; }
    let e = k; while (e < n && open(...at(e))) e++;
    const len = e - k, [li, lj] = at(k - 1), [ri, rj] = at(e);
    if (len >= 6 && len <= 18 && wall(li, lj) && wall(ri, rj)) {
      const ya = Math.min(h[lj * W + li], h[rj * W + ri]), y = Math.min(4.8, ya - 0.7);
      const p0 = dir === 'x' ? [x0 + k, z0 + a + 0.5] : [x0 + a + 0.5, z0 + k], p1 = dir === 'x' ? [x0 + e, z0 + a + 0.5] : [x0 + a + 0.5, z0 + e];
      if (!near((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 13)) strings.push([p0[0], p0[1], p1[0], p1[1], +y.toFixed(1)]);
    }
    k = e;
  }
}
// clearance (m) at a cell: the distance to the nearest wall or outside, up to 12
const clear = (i, j) => { for (let r = 1; r <= 12; r++) for (let a = 0; a < 16; a++) { const t = a / 16 * Math.PI * 2; if (!open(Math.round(i + Math.cos(t) * r), Math.round(j + Math.sin(t) * r))) return r - 1; } return 12; };
let tree = null, best = Infinity; // the open spot with at least 7 m clear all round that is nearest the district's centre
for (let j = 0; j < H; j += 2) for (let i = 0; i < W; i += 2) if (open(i, j)) { const d = Math.hypot(x0 + i - site.x, z0 + j - site.z); if (d < best) { const c = clear(i, j); if (c >= 7) { best = d; tree = [x0 + i + 0.5, z0 + j + 0.5, c]; } } }
// stalls: along each string, a pair hugging the walls of lanes 8 m or wider, 6 m along the lane from the string
const stalls = [];
const free = (x, z, r) => { for (let dx = -r; dx <= r; dx += 1) for (let dz = -r; dz <= r; dz += 1) if (!open(Math.floor(x + dx - x0), Math.floor(z + dz - z0))) return false; return true; };
for (const s of strings) {
  const dx = s[2] - s[0], dz = s[3] - s[1], len = Math.hypot(dx, dz); if (len < 8) continue;
  const ux = dx / len, uz = dz / len, ax = -uz, az = ux; // across the lane = along the string; along the lane = perpendicular
  for (const along of [-6, 6]) for (const side of [-1, 1]) {
    const x = (s[0] + s[2]) / 2 + ax * along + ux * side * (len / 2 - 1.9), z = (s[1] + s[3]) / 2 + az * along + uz * side * (len / 2 - 1.9);
    if (free(x, z, 1.5) && !stalls.some((t) => Math.hypot(t[0] - x, t[1] - z) < 5) && Math.hypot(x - tree[0], z - tree[1]) > 8) stalls.push([+x.toFixed(1), +z.toFixed(1), +Math.atan2(-uz, ux).toFixed(3)]);
  }
}
const data = { source: 'derived from the mapped building footprints', strings, stalls: stalls.slice(0, 32), tree: [+tree[0].toFixed(1), +tree[1].toFixed(1)], treeClear: tree[2] };
fs.writeFileSync(new URL('js/toronto-holiday.js', root), '// GENERATED by tools/build-holiday-lanes.mjs: the Distillery Winter Village layout (overhead light strings, stalls, tree), derived from the\n// mapped building footprints inside the district outline. Game layout, not a survey (docs/holiday-installations.md).\n(function(){window.CITY=window.CITY||{};window.CITY.HOLIDAY_LANES=' + JSON.stringify(data) + ';})();\n');
console.log(`[holiday-lanes] ${strings.length} strings, ${data.stalls.length} stalls, tree at ${data.tree} (clear ${tree[2]} m)`);
