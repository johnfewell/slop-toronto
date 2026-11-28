// tools/make-leaf-season-shots.mjs: writes tools/shots/leaf-season.json, the four same-camera views (Island, Biidaasige,
// Harbourfront, a Rosedale street) for the leaf-season proof. No `time` preset on purpose: a preset is the classic
// 22 August summer whatever ?liveDate= says, and the date only matters while live (js/seasons.js siteDay).
import fs from 'node:fs';
const cam = (pos, look, fov = 62) => `a.teleportTo(${pos[0]},${pos[2]},0);await new Promise(r=>setTimeout(r,2500));const c={pos:[${pos}],look:[${look}],fov:${fov}};a.cameraSystem.cinema=()=>c;`;
const wrap = (body) => `(async()=>{const a=window.__CITY_APP,C=CITY;${body}})();`;
const biid = wrap(`const a0=C.biidaasigeMapAnchor('inverted-timber-cluster');a.teleportTo(a0.x+14,a0.z+14,0);for(let i=0;i<300&&!(C.biidaasigePlayFenceRuns&&C.biidaasigePlayFenceRuns.runs.length);i++)await new Promise(r=>setTimeout(r,200));const r=C.biidaasigePlayFenceRuns.runs[0],p=r.pose;a.teleportTo(p.x+14,p.z+14,0);await new Promise(r=>setTimeout(r,2500));const c={pos:[p.x+9,1.7,p.z+9],look:[p.x,.7,p.z],fov:62};a.cameraSystem.cinema=()=>c;`);
const island = wrap(`const g=C.DON_VALLEY?C.DON_VALLEY.heightAt(1116.4,2405.3):0;${cam(['1116.4','g+1.8','2405.3'], [1103.8, 0.15, 2388.0])}`);
const harbour = wrap(cam([-236, 2.4, 604], [-300, 1.2, 700]));
const street = wrap(`const q=C.worldFromLatLon(43.675356,-79.3822634);const r=C.nearestRoads(q.x,q.z,70)[0];const dx=q.x-r.px,dz=q.z-r.pz,d=Math.hypot(dx,dz)||1;const p={x:r.px-(dx/d)*9+r.dx*10,z:r.pz-(dz/d)*9+r.dz*10};a.teleportTo(p.x,p.z,0);await new Promise(r=>setTimeout(r,2500));a.cameraSystem.cinema=()=>({pos:[p.x,1.8,p.z],look:[q.x,2.6,q.z],fov:62});`);
const beach = wrap(`const g=C.DON_VALLEY?C.DON_VALLEY.heightAt(-608.4,3375.8):0;${cam(['-608.4','g+1.95','3375.8'], [-649.4, -0.7, 3408])}`);
const music = wrap(cam([-1287, 2.2, 590], [-1287, 1.8, 564], 60));
const views = { beach, music, island, biidaasige: biid, harbourfront: harbour, street };
const out = Object.entries(views).map(([name, js]) => ({ name, mode: 'person', wait: 12000, js }));
fs.writeFileSync(new URL('./shots/leaf-season.json', import.meta.url), JSON.stringify(out, null, 1));
