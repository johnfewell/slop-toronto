// tools/shots/make-toronto-sidewalks.mjs — writes tools/shots/toronto-sidewalks.json, the before/after review shots of
// the Toronto sidewalk look and the asphalt cracks (bead st-ut3): a residential street (Euclid Avenue), an off-grid one
// (Dundas Street West at Roncesvalles), a downtown walk (King Street West), a stamp close-up, Queen Street West's
// roadway with its streetcar tracks and the CaféTO patio aerial, at midday and golden hour.
// usage: node tools/shots/make-toronto-sidewalks.mjs
import fs from 'node:fs';

// The camera aimed off the nearest named road to (X, Z), on its SX/SZ side (as tools/shots/pave-wear.json does)
const aim = (X, Z, SX, SZ, KIND) => `(() => {
  const C = window.CITY, app = window.__CITY_APP;
  const X = ${X}, Z = ${Z}, SX = ${SX}, SZ = ${SZ}, KIND = '${KIND}';
  let best = null, bd = 1e9;
  for (const r of C.ROADS) { if (!r.name) continue; for (let i = 0; i + 1 < r.pts.length; i++) { const a = r.pts[i], b = r.pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((X - a.x) * dx + (Z - a.z) * dz) / L2));
    const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(X - px, Z - pz); if (d < bd) { bd = d; best = { r, px, pz, dx, dz, L: Math.sqrt(L2) }; } } }
  const ux = best.dx / best.L, uz = best.dz / best.L; let nx = -uz, nz = ux; if (nx * SX + nz * SZ < 0) { nx = -nx; nz = -nz; }
  const h = best.r.w / 2, cx = best.px, cz = best.pz;
  const P = (o, a, y) => [cx + nx * o + ux * a, y, cz + nz * o + uz * a];
  let cam;
  if (KIND === 'close') cam = { pos: P(h + 1.7, -1, 1.65), look: P(h + 1.3, 7, 0.1), fov: 55 };
  else if (KIND === 'medium') cam = { pos: P(h + 0.4, -6, 6.5), look: P(h + 2.0, 16, 0), fov: 50 };
  else if (KIND === 'aerial') cam = { pos: P(h - 3, -14, 14), look: P(h + 2.5, 8, 0), fov: 50 };
  else if (KIND === 'road') cam = { pos: P(h - 2.2, -2, 1.5), look: P(0, 22, 0), fov: 55 };
  else cam = { pos: P(h - 3.5, -8, 5.5), look: P(0, 18, 0), fov: 55 };
  app.teleportTo(cx - nx * (h + 2) - ux * 25, cz - nz * (h + 2) - uz * 25, Math.atan2(ux, uz));
  app.cameraSystem.cinema = () => cam;
  console.log('[ride-check] aim ' + KIND + ' ' + best.r.name + ' w' + best.r.w + ' ' + JSON.stringify(cam));
})()`;

// A camera 0.75 m above a contractor's stamp, looking down at it from the walk (its frame: a point & the walk's direction)
const stamp = ([X, Z, UX, UZ]) => `(() => {
  const app = window.__CITY_APP;
  const X = ${X}, Z = ${Z}, UX = ${UX}, UZ = ${UZ};
  app.teleportTo(X - UX * 20, Z - UZ * 20, Math.atan2(UX, UZ));
  const cam = { pos: [X - UX * 0.55, 0.22 + 0.75, Z - UZ * 0.55], look: [X, 0.22, Z], fov: 50 };
  app.cameraSystem.cinema = () => cam;
  console.log('[ride-check] stamp ' + JSON.stringify(cam));
})()`;

// The CaféTO patio aerial (tools/shots/ped-detours.json's patio-aerial-0, without its pedestrian logging)
const patio = `(() => {
  const app = window.__CITY_APP, C = window.CITY;
  const all = C.patioStats.sites.filter((s) => s.kind === 'sidewalk' && s.outerLine !== null && s.outerLine !== undefined);
  const s = all.find((p) => /OSSINGTON/.test(p.address)) || all.find((p) => /COLLEGE/.test(p.address)) || all[0];
  const x = s.cx + s.tx * 14 - s.nx * 1.2, z = s.cz + s.tz * 14 - s.nz * 1.2;
  app.teleportTo(x, z, Math.atan2(-s.tx, -s.tz));
  const cam = [s.cx - s.nx * 9 + s.tx * 6, 9, s.cz - s.nz * 9 + s.tz * 6];
  app.cameraSystem.cinema = () => ({ pos: cam, look: [s.cx - s.nx * 1.5, 0.3, s.cz - s.nz * 1.5], fov: 55 });
  console.log('[ride-check] patio ' + s.address);
})()`;

// Two stamps found with window.CITY.findSidewalkStamp on the high tier: Euclid Avenue's west walk (1991, the City's
// rounded rectangle) and Dundas Street West's north walk near Roncesvalles (1977, an oval)
const stamps = [['euclid', [-2042.6, -2303.314, 0, -1]], ['dundas', [-5164.613, -2453.718, 0.6616, 0.7498]]];

const sites = [
  ['residential', -2047, -2306.9, 1, 0, ['close', 'medium']],
  ['offgrid', -5160, -2460, -1, 1, ['close', 'medium', 'aerial']],
  ['downtown', -820, -348.8, 0, -1, ['close', 'medium']],
  ['queen-tracks', -1000, -730, 0, 1, ['road', 'roadhigh']]
];
const shots = [{ name: 'hud', mode: 'person', time: 'midday', wait: 300, js: "document.getElementById('btn-toggle-hud')?.click()" }];
for (const time of ['midday', 'golden']) {
  for (const [site, X, Z, SX, SZ, kinds] of sites) {
    for (const k of kinds) shots.push({ name: `${site}-${k}-${time}`, mode: 'person', time, wait: 3500, js: aim(X, Z, SX, SZ, k) });
  }
  for (const [site, at] of stamps) shots.push({ name: `stamp-${site}-${time}`, mode: 'person', time, wait: 3500, js: stamp(at) });
  shots.push({ name: `patio-aerial-${time}`, mode: 'person', time, wait: 6000, js: patio });
}
fs.writeFileSync(new URL('./toronto-sidewalks.json', import.meta.url), JSON.stringify(shots, null, 1) + '\n');
console.log(`${shots.length} shots`);
