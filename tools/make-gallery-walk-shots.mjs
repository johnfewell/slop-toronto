// tools/make-gallery-walk-shots.mjs — st-ndw9.15: the shot list that proves ?gallery=presets can be walked and flown: the start on foot,
// the length of the first three rows, across all the rows to the far side, and one flight over them. Keys are held through each
// shot's wait (tools/capture.mjs `hold`); the player's position is logged every 2 s as `[walkpos] <mode> x z`.
import fs from 'node:fs';
import { PROTOTYPES } from '../js/building-prototypes.js';
import { DRAWN_PRESETS, syntheticLot } from '../js/building-draw.js';
import * as G from '../js/building-gallery.js';

const layout = G.galleryLayout(PROTOTYPES.map((p) => p.id), {}, new Set(DRAWN_PRESETS), G.makeGalleryLot(syntheticLot));
const r1 = (v) => Math.round(v * 10) / 10;
const log = '{ if (window.__wp) clearInterval(window.__wp); const app = window.__CITY_APP; const cm = app.controllerManager; const f = () => { const e = cm.entities[cm.activeMode]; console.log("[walkpos] " + cm.activeMode + " " + e.position.x.toFixed(1) + " " + e.position.y.toFixed(2) + " " + e.position.z.toFixed(1)); }; f(); window.__wp = setInterval(f, 2000); }';
const tp = (mode, x, z, h) => `(() => { const app = window.__CITY_APP; app.selectMode("${mode}"); app.controllerManager.teleportActiveTo(${r1(x)}, ${r1(z)}, ${h}); ${log} })()`;
const shots = [{ name: 'walk-start', mode: 'person', time: 'midday', wait: 4000, js: `(() => { ${log} })()` }];
layout.rows.slice(0, 3).forEach((row, k) => {
  shots.push({ name: `walk-row${k + 1}-0`, time: 'midday', wait: 1500, js: tp('person', row.x - 6, row.front + 7, r1(Math.PI / 2)) });
  for (const s of ['a', 'b']) shots.push({ name: `walk-row${k + 1}-${s}`, time: 'midday', wait: 12000, hold: 'KeyW' });
});
const r0 = layout.rows[0];
// across to the far side: the gaps between the lots (9 m) line up from row to row only roughly, and the walker drifts about 2 degrees
// east, so the walk is four legs of two rows each, each started in the middle of the gap windows of its two rows, a little to the west
const gapStart = [10.5, 11, 12, 13];
for (let leg = 0; leg < 4; leg++) {
  const row = layout.rows[leg * 2];
  shots.push({ name: `walk-across-${leg}-0`, time: 'midday', wait: 1500, js: tp('person', r0.x + gapStart[leg], row.front + 12, r1(Math.PI)) });
  shots.push({ name: `walk-across-${leg}-a`, time: 'midday', wait: 9000, hold: 'KeyW' });
  shots.push({ name: `walk-across-${leg}-b`, time: 'midday', wait: 9500, hold: 'KeyW' });
}
shots.push({ name: 'fly-0', time: 'midday', wait: 3000, js: tp('helicopter', r0.x + r0.w / 2, r0.front + 80, r1(Math.PI)) });
for (let i = 1; i <= 3; i++) shots.push({ name: `fly-${i}`, time: 'midday', wait: 12000, hold: 'KeyW' });
fs.writeFileSync(new URL('./shots/building-presets-houses-walk.json', import.meta.url), JSON.stringify(shots, null, 1) + '\n');
console.log(shots.length, 'shots; start', JSON.stringify(layout.start), 'rect', JSON.stringify(layout.rect));
