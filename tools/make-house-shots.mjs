// tools/make-house-shots.mjs — st-ndw9.15: writes the capture shot lists for the house and shop presets (the gallery rows and
// the places in the city) to tools/shots/. The gallery's cameras come from the same layout the page builds (js/building-gallery.js),
// so a row's street, air and back views are in front of, over and behind its lots. usage: node tools/make-house-shots.mjs
import fs from 'node:fs';
import { PROTOTYPES } from '../js/building-prototypes.js';
import { DRAWN_PRESETS, syntheticLot } from '../js/building-draw.js';
import * as G from '../js/building-gallery.js';

const drawn = new Set(DRAWN_PRESETS);
const layout = G.galleryLayout(PROTOTYPES.map((p) => p.id), {}, drawn, G.makeGalleryLot(syntheticLot));
const cam = (pos, look, fov = 60) => `(() => { const app = window.__CITY_APP; app.teleportTo(${pos[0]}, ${pos[2]}, 0); app.cameraSystem.cinema = () => ({ pos: [${pos.join(', ')}], look: [${look.join(', ')}], fov: ${fov} }); })()`;
const r1 = (v) => Math.round(v * 10) / 10;
const shots = [];
for (const row of layout.rows.filter((r) => r.drawn)) {
  const xc = r1(row.x + row.w / 2), f = row.front, d = row.d, shop = row.preset.startsWith('main-street');
  const span = shop ? 0 : 0; void span;
  shots.push({ name: `${row.preset}-street`, mode: 'person', time: 'midday', wait: 3500, js: cam([xc, 1.7, r1(f + (shop ? 11 : 16))], [xc, 4.2, r1(f - 5)]) });
  // a second street view from one lot over (the first may stand behind a tree), and for the shops one that looks up at the cornice
  shots.push({ name: `${row.preset}-street2`, mode: 'person', time: 'midday', wait: 3000, js: cam([r1(xc + (shop ? 14 : 24)), 1.7, r1(f + (shop ? 12 : 15))], [r1(xc + (shop ? 8 : 18)), 4.5, r1(f - 5)], 65) });
  if (shop) shots.push({ name: `${row.preset}-cornice`, mode: 'person', time: 'midday', wait: 3000, js: cam([xc, 1.7, r1(f + 7)], [r1(xc + 6), 9.5, r1(f)], 75) });
  shots.push({ name: `${row.preset}-air`, mode: 'person', time: 'midday', wait: 3500, js: cam([xc, shop ? 28 : 36, r1(f + (shop ? 26 : 32))], [xc, 0, r1(f - d * 0.5)]) });
  shots.push({ name: `${row.preset}-back`, mode: 'person', time: 'midday', wait: 3500, js: cam([xc, 3.2, r1(f - d - 12)], [xc, 4, r1(f - d * 0.5)]) });
}
fs.writeFileSync(new URL('./shots/building-presets-houses-gallery.json', import.meta.url), JSON.stringify(shots, null, 1) + '\n');
console.log(layout.rows.filter((r) => r.drawn).length, 'rows', shots.length, 'shots');
