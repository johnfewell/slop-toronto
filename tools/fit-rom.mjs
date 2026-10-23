// tools/fit-rom.mjs — places John's ROM model (assets/landmarks/rom.glb, exported from rom-heist's ROM_scene.blend, the
// SketchUp shell only) on the museum's real footprint: the City's 3D Massing parts inside its OpenStreetMap outline
// (the Crystal on Bloor Street, the 1914 & 1933 wings) rasterised at 1 m, and the turn & offset at 1:1 (the model is in
// metres) that land the most of the model's ground-level walls on them. Writes assets/landmarks/rom-fit.json.
// usage: node tools/fit-rom.mjs   (after tools/build-geodata.mjs)
import fs from 'node:fs';

const info = JSON.parse(fs.readFileSync('assets/landmarks/rom-info.json', 'utf8'));
const src = fs.readFileSync('js/toronto-geodata.js', 'utf8');
const GEO = JSON.parse(src.slice(src.indexOf('window.CITY.GEO = ') + 18, src.lastIndexOf(';\n})();')));
const site = GEO.landmarks.rom;
const ring = site.ring;
const inRing = (x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
// The real footprint: massing parts whose centre is inside the OSM outline, filled into a 1 m raster round the site
const P = GEO.frame.projection, pc = Math.cos(P.theta), ps = Math.sin(P.theta);
const toWorld = (lon, lat) => { const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky; return [e * pc - n * ps - P.ox, -(e * ps + n * pc) - P.oz]; };
const parts = JSON.parse(fs.readFileSync(`${process.env.GEO_DATA || `${process.env.HOME}/.cache/slop-toronto/osm`}/massing.json`, 'utf8')).parts
  .map((p) => p.ring.map(([lon, lat]) => toWorld(lon, lat)))
  .filter((r) => { const cx = r.reduce((t, p) => t + p[0], 0) / r.length, cz = r.reduce((t, p) => t + p[1], 0) / r.length; return inRing(cx, cz); });
const RX0 = site.x - 160, RZ0 = site.z - 160, RN = 320;
const foot = new Uint8Array(RN * RN);
for (const r of parts) {
  for (let j = 0; j < RN; j++) {
    const z = RZ0 + j + 0.5, xs = [];
    for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
      const [xa, za] = r[k], [xb, zb] = r[i];
      if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
    }
    xs.sort((p, q) => p - q);
    for (let n = 0; n + 1 < xs.length; n += 2) for (let i = Math.max(0, Math.ceil(xs[n] - RX0 - 0.5)); i <= Math.min(RN - 1, Math.floor(xs[n + 1] - RX0 - 0.5)); i++) foot[j * RN + i] = 1;
  }
}
// Blender plan (x, y) -> the glTF's local plan (x, z = -y), centred
const plan0 = info.plan.map(([x, y]) => [x, -y]);
const cx = plan0.reduce((t, p) => t + p[0], 0) / plan0.length, cz = plan0.reduce((t, p) => t + p[1], 0) / plan0.length;
const plan = plan0.map(([x, z]) => [x - cx, z - cz]);
const score = (t, dx, dz) => {
  const c = Math.cos(t), s = Math.sin(t);
  let hit = 0;
  for (const [x, z] of plan) {
    // three's rotation.y: x' = x cos + z sin, z' = -x sin + z cos
    const i = Math.floor(site.x + dx + x * c + z * s - RX0), j = Math.floor(site.z + dz - x * s + z * c - RZ0);
    if (i >= 0 && j >= 0 && i < RN && j < RN && foot[j * RN + i]) hit++;
  }
  return hit;
};
let best = { score: -1 };
for (let deg = 0; deg < 360; deg += 2) for (let dx = -70; dx <= 70; dx += 4) for (let dz = -70; dz <= 70; dz += 4) {
  const v = score((deg * Math.PI) / 180, dx, dz);
  if (v > best.score) best = { score: v, deg, dx, dz };
}
const coarse = { ...best };
for (let deg = coarse.deg - 2; deg <= coarse.deg + 2; deg += 0.25) for (let dx = coarse.dx - 4; dx <= coarse.dx + 4; dx += 0.5) for (let dz = coarse.dz - 4; dz <= coarse.dz + 4; dz += 0.5) {
  const v = score((deg * Math.PI) / 180, dx, dz);
  if (v > best.score) best = { score: v, deg, dx, dz };
}
const t = (best.deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
// the model's origin: where its plan centre (cx, cz) lands, less the turned centre
const X = site.x + best.dx, Z = site.z + best.dz;
const fit = { rotationY: Math.round(t * 1e4) / 1e4, x: Math.round((X - (cx * c + cz * s)) * 100) / 100, z: Math.round((Z - (-cx * s + cz * c)) * 100) / 100, y: 0,
  share: Math.round((best.score / plan.length) * 1000) / 1000 };
fs.writeFileSync('assets/landmarks/rom-fit.json', JSON.stringify(fit));
console.log(`[rom] ${parts.length} massing parts; turned ${best.deg}°, offset (${best.dx}, ${best.dz}) m: ${(fit.share * 100).toFixed(1)}% of the model's ground-level walls on the City's footprint`, fit);
// where the Crystal lands (rom-heist: its footprint is Blender x -78..-6, y 20..88)
const cc = [-42 - cx, -54 - cz];
console.log(`[rom] Crystal centre at world (${(X + cc[0] * c + cc[1] * s).toFixed(0)}, ${(Z - cc[0] * s + cc[1] * c).toFixed(0)}); OSM outline z ${site.z.toFixed(0)}, Bloor ~ -2804`);
