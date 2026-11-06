// tools/make-water-edges-shots.mjs: writes the naturalistic water-edges shot lists (st-de3g) from readable views.
// usage: node tools/make-water-edges-shots.mjs <out.json> [survey|pilot|night|pilot-all] [times, comma-separated]
// (pilot-all: the pilot's views at midday & golden hour, its night views at twilight & midnight)
// A view's camera is fixed (cinema), its height over the ground read in the page (DON_VALLEY.heightAt: High Park's
// relief), so the same frame repeats before and after a change. Render on the Mac mini via gpu2 (tools/capture.mjs).
import fs from 'node:fs';

const [out, set = 'survey', timesArg] = process.argv.slice(2);
if (!out) { console.error('usage: node tools/make-water-edges-shots.mjs <out.json> [survey|pilot] [times]'); process.exit(2); }

// [name, pos [x, y, z], look [x, y, z], fov, ground]: ground true = y over the ground at pos (a person's eye)
const VIEWS = {
  'gren-aerial': [[-6600, 80, -1290], [-6850, -1.6, -1800], 55],
  'gren-east': [[-6618.1, 1.75, -1533.6], [-6660.8, -1.61, -1545.1], 62, true],
  'gren-dock': [[-6723, 1.75, -1640], [-6860, -1.6, -1500], 60, true],
  'gren-south': [[-6750, 1.75, -1236], [-6830, -1.6, -1520], 60, true],
  'island-aerial': [[-150, 110, 2420], [-450, -0.7, 2860], 55],
  'island-lagoon': [[-400, 1.95, 2994], [-300, -0.7, 2930], 60, true],
  'island-lagoon2': [[-200, 1.95, 2749], [-60, -0.7, 2722], 60, true],
  'island-beach-aerial': [[-380, 45, 3560], [-640, -0.7, 3380], 55],
  'island-beach': [[-608.4, 1.95, 3375.8], [-649.4, -0.7, 3408], 62, true],
  'wards-beach': [[988.2, 1.95, 2700.3], [958.5, -0.7, 2740.6], 62, true],
  'island-breakwall': [[396, 1.95, 3020], [560, -0.7, 2960], 60, true],
  'cherry-aerial': [[2750, 70, 2150], [2650, -0.7, 1720], 55],
  'cherry-beach': [[2700, 1.95, 1681], [2900, -0.7, 1640], 60, true],
  'humber-aerial': [[-7300, 90, -400], [-7600, -0.7, -800], 55],
  'don-mouth-aerial': [[2600, 70, 1000], [2400, -0.7, 650], 55],
  'harbourfront-wall': [[-400, 30, 950], [-450, -0.7, 640], 55],
  // the downtown control at street level: Yonge Street looking north from below King
  'downtown-yonge': [[132, 1.7, -450], [132, 6, -1100], 60],
  // batch A, the east waterfront
  'wards-east': [[1703.8, 1.95, 2286.6], [1655.4, -0.7, 2288.8], 62, true],
  'spit-marsh': [[3471.3, 1.95, 2864], [3479.1, -0.7, 2826.3], 62, true],
  'spit-aerial': [[3200, 70, 3300], [3500, -0.7, 2850], 55],
  'don-mouth': [[2432.8, 1.95, 652.8], [2401.8, -0.7, 683], 62, true],
  'woodbine-beach': [[6379, 1.95, -76.9], [6367.8, -0.7, -19.3], 62, true],
  'kew-beach': [[7335.5, 1.95, -288.9], [7314.6, -0.7, -235.5], 62, true],
  'woodbine-aerial': [[6650, 50, 250], [6350, -0.7, -80], 55],
  // batch B, the west: the Humber's mouth & banks, Humber Bay Park, Sunnyside
  'sunnyside-beach': [[-5664, 1.95, -680.8], [-5718.9, -0.7, -673], 62, true],
  'sunnyside-aerial': [[-5480, 50, -330], [-5700, -0.7, -660], 55],
  'humber-bay-beach': [[-7781.3, 1.95, -438.3], [-7810.6, -0.7, -403.3], 62, true],
  'humber-mouth-bank': [[-7423, 1.95, -757.6], [-7386.3, -0.7, -743.3], 62, true],
  'humber-river-bank': [[-7661.1, 1.95, -1107.2], [-7673.5, -0.7, -1143.5], 62, true]
};
const SETS = {
  survey: Object.keys(VIEWS),
  pilot: ['gren-aerial', 'gren-east', 'gren-south', 'island-aerial', 'island-lagoon', 'island-lagoon2', 'island-beach-aerial', 'island-beach', 'wards-beach', 'harbourfront-wall'],
  batchA: ['cherry-aerial', 'cherry-beach', 'wards-east', 'spit-marsh', 'spit-aerial', 'don-mouth-aerial', 'don-mouth', 'woodbine-beach', 'kew-beach', 'woodbine-aerial', 'harbourfront-wall', 'downtown-yonge'],
  batchB: ['humber-aerial', 'humber-mouth-bank', 'humber-river-bank', 'humber-bay-beach', 'sunnyside-beach', 'sunnyside-aerial', 'harbourfront-wall', 'downtown-yonge'],
  // (the pilot's views by night: twilight & midnight)
  night: ['gren-south', 'island-lagoon', 'island-beach', 'island-beach-aerial']
};
const times = (timesArg || 'midday,golden').split(',');
const hud = "(() => { const b = document.getElementById('btn-toggle-hud'); if (b && !document.body.classList.contains('film')) { b.click(); document.body.classList.add('film'); } })();";
const plan = set === 'pilot-all'
  ? [...['midday', 'golden'].map((t) => [t, SETS.pilot]), ...['twilight', 'midnight'].map((t) => [t, SETS.night])]
  : times.map((t) => [t, SETS[set]]);
// (the first shot also waits for the water edges, built a few milliseconds a turn after the city is on screen)
const shots = [{ name: 't00-hud', time: plan[0][0], js: `(async () => { ${hud} await (window.CITY.waterEdgesReady || null); })()`, wait: 2000 }];
for (const [time, names] of plan) {
  for (const name of names) {
    const [pos, look, fov, ground] = VIEWS[name];
    const cam = ground
      ? `(() => { const C = window.CITY, D = C.DON_VALLEY, g = D ? D.heightAt(${pos[0]}, ${pos[2]}) : 0; return { pos: [${pos[0]}, g + ${pos[1]}, ${pos[2]}], look: [${look.join(', ')}], fov: ${fov} }; })`
      : `(() => ({ pos: [${pos.join(', ')}], look: [${look.join(', ')}], fov: ${fov} }))`;
    shots.push({ name: `${name}-${time}`, time, js: `${hud}(() => { const a = window.__CITY_APP; a.cameraSystem.cinema = ${cam}; })()`, wait: 5000 });
  }
}
fs.writeFileSync(out, JSON.stringify(shots, null, 1) + '\n');
console.log(`${out}: ${shots.length} shots`);
