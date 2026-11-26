// tools/make-landing-links-shots.mjs: writes a capture.mjs shot list that follows every explore.html#place=... link on the
// landing page the way main.js's openDeepLink does (search, arrive, show the place) and records what each one found, with a
// frame of where it lands. Run once on the desktop frame (the default) and once on a phone (CAPTURE_MOBILE=1), st-mcqm.
// usage: node tools/make-landing-links-shots.mjs tools/shots/landing-links.json
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const places = [...new Set([...html.matchAll(/explore\.html#place=([^"&]+)"/g)].map((m) => decodeURIComponent(m[1])))];
const shots = [{ name: 't00-hud', js: "document.getElementById('btn-toggle-hud').click(); document.body.classList.add('film')", wait: 1500 }];
places.forEach((q, i) => shots.push({
  name: `link-${String(i).padStart(2, '0')}-${q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, record: true, wait: 3500,
  js: `(() => { const a = window.__CITY_APP, tg = a.tourGuide; a.cameraSystem.cinema = null; a.selectMode('cyclist'); a.selectCamera('chase', true);
    const r = tg.search(${JSON.stringify(q)}); const p = r[0]; if (!p) return { query: ${JSON.stringify(q)}, found: null, frame: window.CITY.GEO.frame.detail };
    tg.teleportToPlace(p); tg.showPlace(p, { fly: false });
    const e = a.controllerManager.getActiveEntity && a.controllerManager.getActiveEntity();
    return { query: ${JSON.stringify(q)}, found: [p.name, p.kind, Math.round(p.x), Math.round(p.z)], at: e ? [Math.round(e.position.x), Math.round(e.position.z)] : null, label: window.CITY.getLocationLabel && e ? window.CITY.getLocationLabel(e.position.x, e.position.z) : null, frame: [window.CITY.GEO.frame.detail.x0, window.CITY.GEO.frame.detail.x1, window.CITY.GEO.frame.detail.z0, window.CITY.GEO.frame.detail.z1] }; })()`.replace(/\s+/g, ' ')
}));
shots.push({ name: 'ride-504', record: true, wait: 6000, js: "(() => { try { window.__CITY_APP.rideFeatured('504'); return { ok: true }; } catch (e) { return { error: String(e) }; } })()" });
shots.push({ name: 'ride-subway', record: true, wait: 6000, js: "(() => { try { window.__CITY_APP.rideFeatured('subway'); return { ok: true }; } catch (e) { return { error: String(e) }; } })()" });
fs.writeFileSync(process.argv[2], JSON.stringify(shots, null, 1) + '\n');
console.log(places.length, 'places');
