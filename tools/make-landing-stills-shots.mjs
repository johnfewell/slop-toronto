// tools/make-landing-stills-shots.mjs: writes a tools/capture.mjs shot list that looks at each landing-page candidate
// place from four compass sides (the "scout" list, to choose a framing), or one chosen framing per shot (see CHOSEN).
// usage: node tools/make-landing-stills-shots.mjs scout tools/shots/landing-scout.json [site,site]
//        node tools/make-landing-stills-shots.mjs chosen tools/shots/landing-stills.json [name,name]
// A framing is { site: [x, z] (world metres, what the camera looks at), d (m from it), deg (compass side the camera stands
// on: 0 south of it, 90 east, 180 north, 270 west), h (camera height above ground), lh (look-at height above ground), fov }.
// The camera is free (cameraSystem.cinema) and the player's cyclist is put under it, so nothing of the rider is in frame.
import fs from 'node:fs';

const SITES = {
  'sugar-beach': { site: [954, 550], d: 120, h: 22, lh: 4 },
  'ferry-terminal': { site: [260, 673], d: 130, h: 22, lh: 8 },
  'music-garden': { site: [-1330, 569], d: 140, h: 28, lh: 2 },
  'queens-quay-terminal': { site: [-199, 667], d: 130, h: 24, lh: 8 },
  'harbourfront': { site: [-431, 676], d: 160, h: 30, lh: 6 },
  'biidaasige': { site: [2141, 730], d: 220, h: 45, lh: 0 },
  'biidaasige-west': { site: [1873, 767], d: 200, h: 40, lh: 0 },
  'centre-island': { site: [-285, 3030], d: 200, h: 40, lh: 2 },
  'cinesphere': { site: [-3462, 1003], d: 150, h: 26, lh: 12 },
  'zoo': { site: [-6417, -1695], d: 110, h: 14, lh: 1.5 },
  'grenadier-pond': { site: [-6831, -1206], d: 260, h: 40, lh: 0 },
  'city-hall': { site: [-13, -900], d: 180, h: 30, lh: 8 },
  'casa-loma': { site: [-1176, -4258], d: 220, h: 38, lh: 18 },
  'yonge-eglinton': { site: [500, -6818], d: 220, h: 45, lh: 5 },
  'kensington': { site: [-1360, -1554], d: 140, h: 22, lh: 4 }
};

const shot = (name, f, time = undefined, wait = 6500) => {
  const cx = f.site[0] + f.d * Math.sin((f.deg * Math.PI) / 180), cz = f.site[1] + f.d * Math.cos((f.deg * Math.PI) / 180);
  const js = `(() => { const a = window.__CITY_APP, cm = a.controllerManager; const g = (x, z) => Math.max(cm.getGroundHeight(x, z, 'person') || 0, 0);
    a.selectMode('cyclist'); a.selectCamera('chase', true); a.teleportTo(${cx.toFixed(1)}, ${cz.toFixed(1)}, 0);
    const y0 = g(${cx.toFixed(1)}, ${cz.toFixed(1)}), y1 = g(${f.site[0]}, ${f.site[1]});
    a.cameraSystem.cinema = () => ({ pos: [${cx.toFixed(1)}, y0 + ${f.h}, ${cz.toFixed(1)}], look: [${f.site[0]}, y1 + ${f.lh}, ${f.site[1]}], fov: ${f.fov || 50} }); })()`.replace(/\s+/g, ' ');
  return { name, time, js, wait };
};

const [mode, out, only] = process.argv.slice(2);
const shots = [{ name: 't00-hud', js: "document.getElementById('btn-toggle-hud').click(); document.body.classList.add('film')", wait: 1500 }];
if (mode === 'scout') {
  for (const [k, f] of Object.entries(SITES)) {
    if (only && !only.split(',').includes(k)) continue;
    for (const deg of [0, 90, 180, 270]) shots.push(shot(`${k}-${deg}`, { ...f, deg }));
  }
}
// the chosen framings (site key, compass side), plus any extra { site, d, h, lh, fov, deg } by name
const CHOSEN = [
  ['sugar-beach', 0], ['ferry-terminal', 0], ['ferry-terminal', 90], ['music-garden', 0], ['music-garden', 270],
  ['harbourfront', 0], ['biidaasige', 0], ['biidaasige', 90], ['cinesphere', 0], ['cinesphere', 180], ['centre-island', 0],
  ['grenadier-pond', 180], ['city-hall', 0], ['kensington', 180], ['kensington', 270]
];
const EXTRA = {
  'eglinton-yonge-s': { site: [500, -6818], d: 90, h: 14, lh: 6, deg: 0, fov: 55 },
  'eglinton-yonge-n': { site: [500, -6818], d: 90, h: 14, lh: 6, deg: 180, fov: 55 },
  'eglinton-yonge-e': { site: [500, -6818], d: 90, h: 14, lh: 6, deg: 90, fov: 55 },
  'eglinton-yonge-w': { site: [500, -6818], d: 90, h: 14, lh: 6, deg: 270, fov: 55 },
  'eglinton-yonge-hi': { site: [500, -6818], d: 260, h: 70, lh: 0, deg: 200, fov: 50 }
};
if (mode === 'chosen') {
  for (const [k, deg] of CHOSEN) shots.push(shot(`${k}-${deg}`, { ...SITES[k], deg }));
  for (const [k, f] of Object.entries(EXTRA)) shots.push(shot(k, f));
}
if (mode === 'scout2') {
  const add = (k, f, degs) => { for (const deg of degs) shots.push(shot(`${k}-${deg}`, { ...f, deg })); };
  add('rom', { site: [-378, -2716], d: 170, h: 50, lh: 12 }, [0, 90, 270]);
  add('queens-park', { site: [-308, -2101], d: 150, h: 35, lh: 18 }, [0, 90, 270]);
  add('woods-a', { site: [-6700, -1500], d: 45, h: 4, lh: 3 }, [0, 90, 180, 270]);
  add('woods-b', { site: [-6550, -1350], d: 45, h: 4, lh: 3 }, [0, 90, 180, 270]);
  add('woods-c', { site: [-6300, -1900], d: 45, h: 4, lh: 3 }, [0, 90, 180, 270]);
  add('eglinton-yonge-far', { site: [500, -6818], d: 380, h: 95, lh: 0, fov: 50 }, [0, 180, 90]);
}
if (mode === 'cityhall') {
  const f = { site: [-13, -900], d: 180, h: 30, lh: 8 };
  for (const deg of [0, 30, 330, 60]) shots.push(shot(`city-hall-${deg}`, { ...f, deg }));
  shots.push(shot('city-hall-low', { site: [-13, -900], d: 120, h: 10, lh: 4, deg: 20 }));
  shots.push(shot('city-hall-high', { site: [-13, -900], d: 260, h: 70, lh: 0, deg: 10 }));
}
fs.writeFileSync(out, JSON.stringify(shots, null, 1) + '\n');
console.log(shots.length - 1, 'shots');
