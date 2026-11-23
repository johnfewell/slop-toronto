// tools/make-polish-shots.mjs — st-ndw9.18: assembles the capture shot lists of the house-polish task from the lists the houses, shops,
// towers and worship tasks already made (same cameras, so a before and an after frame are of the same view). usage: node tools/make-polish-shots.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/shots', f), 'utf8'));
const pick = (list, names) => names.map((n) => { const s = list.find((x) => x.name === n); if (!s) throw new Error(`no shot ${n}`); return s; });
const w = (f, a) => fs.writeFileSync(path.join(ROOT, 'tools/shots', f), JSON.stringify(a, null, 1) + '\n');

const hg = read('building-presets-houses-gallery.json'), hc = read('building-presets-houses-city.json'), hs = read('building-presets-houses-shops.json');
const hgold = read('building-presets-houses-golden.json');
const tg = read('building-presets-tall-gallery.json'), tc = read('building-presets-tall-city.json'), tw = read('building-presets-tall-worship.json');
const tgold = read('building-presets-tall-golden.json'), tgw = read('building-presets-tall-gallery-worship.json');

// the gallery: one frame set per changed preset (street, a second street view, the air, the back or the cornice)
w('house-polish-gallery.json', pick(hg, [
  'victorian-detached-street', 'victorian-detached-street2', 'victorian-detached-air', 'victorian-semi-street', 'victorian-semi-air',
  'victorian-row-street', 'victorian-row-street2', 'victorian-row-air', 'edwardian-detached-street', 'edwardian-detached-street2', 'edwardian-detached-air',
  'edwardian-semi-street', 'edwardian-semi-street2', 'edwardian-semi-air', 'edwardian-row-street', 'edwardian-row-street2', 'edwardian-row-air',
  'interwar-detached-street', 'interwar-semi-street', 'postwar-detached-street', 'recent-semi-street', 'modern-townhouse-row-street',
  'main-street-shop-early-street', 'main-street-shop-early-street2', 'main-street-shop-early-cornice', 'main-street-shop-early-air',
  'main-street-shop-later-street', 'main-street-shop-later-street2', 'main-street-shop-later-cornice', 'main-street-shop-later-air'
]));
// the worship gallery: all thirty frames
w('house-polish-worship-gallery.json', tgw);
// the towers' gallery frames (balcony and parapet trim)
w('house-polish-tower-gallery.json', pick(tg, ['slab-tower-street', 'slab-tower-street2', 'slab-tower-air', 'slab-tower-corner', 'mid-rise-block-street', 'mid-rise-block-air', 'walk-up-apartment-street', 'walk-up-apartment-air', 'glass-tower-podium-street', 'glass-tower-podium-air']));
// the city: rows and houses on streets, the shops, the churches
w('house-polish-city.json', [
  ...pick(hc, ['edwardian-row-p1-street', 'edwardian-row-p1-air', 'edwardian-row-p2-street', 'edwardian-row-p2-air', 'edwardian-semi-p1-street', 'edwardian-semi-p1-air', 'edwardian-semi-p2-street',
    'edwardian-detached-p1-street', 'edwardian-detached-p1-air', 'edwardian-detached-p2-street', 'victorian-row-p1-street', 'victorian-row-p1-air', 'victorian-semi-p1-street', 'victorian-semi-p1-air', 'victorian-detached-p1-street', 'victorian-detached-p2-street', 'interwar-semi-p1-street']),
  ...hs
]);
w('house-polish-towers.json', pick(tc, ['stjames-town-ground0', 'stjames-town-ground1', 'stjames-town-far2', 'stjames-town-far3', 'fd-far0', 'fd-high1', 'cityplace-far0', 'cityplace-ground1', 'annex-walkup-ground0', 'annex-walkup-high1', 'annex-midrise-ground0']));
w('house-polish-worship.json', tw);
w('house-polish-golden.json', [
  ...pick(hgold, ['edwardian-row-p1g-street', 'edwardian-row-p1g-air', 'edwardian-semi-p1g-street', 'edwardian-semi-p1g-air', 'victorian-row-p1g-street', 'victorian-row-p1g-air', 'victorian-detached-p1g-street', 'edwardian-detached-p1g-street']),
  ...pick(tgold, ['stjames-town-far2', 'stjames-cathedral-high2', 'stmichaels-high1', 'jami-mosque-high1', 'modern-church-high1', 'modern-church-ground0'])
]);
console.log('written');
