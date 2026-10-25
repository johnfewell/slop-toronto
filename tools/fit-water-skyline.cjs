// tools/fit-water-skyline.cjs: fits the night city that js/pbr-water.js reflects in Lake Ontario & the harbour.
// usage: node tools/fit-water-skyline.cjs [cell m = 500]   (prints the SKYLINE array to paste into js/pbr-water.js)
//
// The way mrdoob's slop-newyork inscribes Manhattan in boxes, fitted to Toronto's waterfront from the real massing
// (GEO.buildings, City of Toronto 3D Massing): every building that can see the water (within 300 m + 8 x its height
// of the lake, so the downtown towers count from well back) goes into a cell of `cell` metres; each cell keeps the
// bounds of its buildings, a skyline height (footprint-weighted 90th percentile) and how lit it reads at night (its
// built-up share; the Islands' few clubhouses & the airport much dimmer). Humber Bay Shores' condo towers stand
// beyond the detailed city, so they come from surroundings.js' cluster (lon, lat, radius, heights) instead.
const fs = require('node:fs');
const path = require('node:path');
const window = { CITY: {} };
eval(fs.readFileSync(path.join(__dirname, '../js/toronto-geodata.js'), 'utf8'));
const G = window.CITY.GEO;
const CELL = Number(process.argv[2]) || 500;
const P = G.frame.projection;
const world = (lat, lon) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky, c = Math.cos(P.theta), s = Math.sin(P.theta);
  return { x: e * c - n * s - (P.ox || 0), z: -(e * s + n * c) - (P.oz || 0) };
};

// Lake Ontario (its islands as holes) on a 20 m raster, then the distance to it (two-pass chamfer)
const lake = G.areas.find((a) => a[0] === 'water' && a[1] === 'Lake Ontario');
const R = 20, X0 = -9500, X1 = 5000, Z0 = -3200, Z1 = 6000, NX = (X1 - X0) / R, NZ = (Z1 - Z0) / R;
const wet = new Uint8Array(NX * NZ);
const fill = (flat) => {
  for (let j = 0; j < NZ; j++) {
    const z = Z0 + (j + 0.5) * R, xs = [];
    for (let i = 0, k = flat.length - 2; i < flat.length; k = i, i += 2) {
      const ax = flat[i], az = flat[i + 1], bx = flat[k], bz = flat[k + 1];
      if ((az > z) !== (bz > z)) xs.push(ax + ((z - az) * (bx - ax)) / (bz - az));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const a = Math.max(0, Math.ceil((xs[q] - X0) / R - 0.5)), b = Math.min(NX - 1, Math.floor((xs[q + 1] - X0) / R - 0.5));
      for (let i = a; i <= b; i++) wet[j * NX + i] ^= 1;
    }
  }
};
fill(lake[2]);
for (const h of lake[3]) fill(h);
const D = new Float32Array(NX * NZ).fill(1e9);
for (let i = 0; i < wet.length; i++) if (wet[i]) D[i] = 0;
const relax = (k, k2, d) => { if (D[k2] + d < D[k]) D[k] = D[k2] + d; };
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
  const k = j * NX + i;
  if (i) relax(k, k - 1, 1);
  if (j) relax(k, k - NX, 1);
  if (i && j) relax(k, k - NX - 1, 1.414);
  if (j && i < NX - 1) relax(k, k - NX + 1, 1.414);
}
for (let j = NZ - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) {
  const k = j * NX + i;
  if (i < NX - 1) relax(k, k + 1, 1);
  if (j < NZ - 1) relax(k, k + NX, 1);
  if (i < NX - 1 && j < NZ - 1) relax(k, k + NX + 1, 1.414);
  if (j < NZ - 1 && i) relax(k, k + NX - 1, 1.414);
}
const cellOf = (x, z) => { const i = Math.floor((x - X0) / R), j = Math.floor((z - Z0) / R); return i < 0 || j < 0 || i >= NX || j >= NZ ? -1 : j * NX + i; };
const distToLake = (x, z) => { const k = cellOf(x, z); return k < 0 ? 1e9 : D[k] * R; };
// on one of the Islands: inside a hole of the lake, south of the mainland shore
const onIsland = (x, z) => z > 800 && lake[3].some((h) => {
  let inside = false;
  for (let i = 0, k = h.length - 2; i < h.length; k = i, i += 2) {
    const ax = h[i], az = h[i + 1], bx = h[k], bz = h[k + 1];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
});

// [x, z, footprint radius, height, footprint area]
const blds = [];
for (const [x, z, , parts, h] of G.buildings) {
  if (h < 6) continue;
  let area = 0, r = 0;
  for (const p of parts) { area += (p[1] - p[0]) * (p[3] - p[2]); r = Math.max(r, Math.hypot(p[0], p[2]), Math.hypot(p[1], p[3])); }
  blds.push([x, z, Math.min(r, 60), h, area]);
}
// Humber Bay Shores (surroundings.js: lon -79.4760, lat 43.6240, 650 m, towers 80-220 m on 3 blocks in 4), on dry land
{
  const c = world(43.624, -79.476);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let gx = -650; gx <= 650; gx += 45) for (let gz = -650; gz <= 650; gz += 45) {
    const x = c.x + gx, z = c.z + gz, k = cellOf(x, z);
    if (Math.hypot(gx, gz) > 650 || k < 0 || wet[k] || D[k] * R < 30 || rand() > 0.75) continue;
    blds.push([x, z, 18, 80 + rand() * 140, 900]);
  }
}

const cells = new Map();
for (const [x, z, r, h, area] of blds) {
  if (distToLake(x, z) > Math.min(1500, 300 + h * 8)) continue;
  const i = Math.floor(x / CELL), j = Math.floor(z / CELL), key = `${i},${j}`;
  let c = cells.get(key);
  if (!c) cells.set(key, (c = { i, j, b: [], x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, area: 0, island: 0 }));
  c.b.push([h, area]);
  c.area += area;
  c.island += onIsland(x, z) ? area : 0;
  c.x0 = Math.min(c.x0, x - r); c.x1 = Math.max(c.x1, x + r); c.z0 = Math.min(c.z0, z - r); c.z1 = Math.max(c.z1, z + r);
}
const out = [];
for (const c of cells.values()) {
  c.b.sort((a, b) => a[0] - b[0]);
  const max = c.b[c.b.length - 1][0];
  if (c.area < 6000 && max < 40) continue;
  const pct = (q) => { let acc = 0; for (const [h, a] of c.b) { acc += a; if (acc >= q * c.area) return h; } return max; };
  const x0 = Math.max(c.x0, c.i * CELL), x1 = Math.min(c.x1, (c.i + 1) * CELL);
  const z0 = Math.max(c.z0, c.j * CELL), z1 = Math.min(c.z1, (c.j + 1) * CELL);
  if (x1 - x0 < 20 || z1 - z0 < 20) continue;
  const builtUp = c.area / ((x1 - x0) * (z1 - z0));
  const island = c.island > c.area / 2;
  // lots span 0.3-1.3 x S in the shader: S from the cell's 90th-percentile height, so its tallest lots reach the towers
  const S = Math.max(12, pct(0.9) / 1.1);
  const lit = island ? 0.25 : Math.min(1, 0.45 + builtUp * 1.6);
  out.push([Math.round(x0), Math.round(z0), Math.round(x1), Math.round(z1), Math.round(S), +lit.toFixed(2)]);
}
out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
console.log(`// ${out.length} boxes, ${CELL} m cells (tools/fit-water-skyline.cjs): [minX, minZ, maxX, maxZ, skyline height S (m), lit]`);
console.log(`const SKYLINE = [\n${out.map((b) => `  [${b.join(', ')}]`).join(',\n')}\n];`);
