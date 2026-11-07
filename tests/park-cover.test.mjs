// High Park's ground cover and understory (docs/park-cover.md): the lidar's shrub layer, the maps that place the
// plants (nothing on the paths, lawns or ponds; the ponds' margin kept), the shrubs' and willows' sites, the pilot's
// gates, and the build reproducible from the tiles
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const read = (f) => fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
function city(search = '') {
  const context = vm.createContext({ window: { CITY: { THREE, Addons: { mergeGeometries }, DEBUG_ROADS: false }, addEventListener() {} }, document: { addEventListener() {}, hidden: false },
    console: { info() {}, warn() {}, log() {} }, atob, location: { search }, URLSearchParams, performance });
  for (const f of ['toronto-geodata', 'toronto-subway', 'toronto-subway-topology', 'high-park-data', 'don-valley', 'city-config', 'toronto-tennis', 'toronto-rinks',
    'high-park-woods-data', 'park-woods', 'high-park-features-data', 'high-park-features', 'toronto-sidewalks', 'sidewalk-polygons', 'high-park-cover-data', 'park-cover']) vm.runInContext(read(f), context);
  return context.window.CITY;
}
const C = city(), P = C.parkCover, D = C.HIGH_PARK_COVER_DATA;

test('the shrub layer names its source and covers the woods data\'s grid', () => {
  assert.equal(D.kind, 'high-park-cover');
  assert.match(D.source.dataset, /GTA 2023 lidar/);
  assert.match(D.source.licence, /Open Government Licence – Ontario/);
  const G = C.HIGH_PARK_WOODS_DATA.ground;
  assert.deepEqual([D.shrub.cell, D.shrub.w, D.shrub.h], [G.cell, G.w, G.h]);
  const { sparse, shrubs, thicket } = D.diagnostics.ha;
  assert.ok(sparse > 10 && shrubs > 4 && thicket > 2 && thicket < 30, JSON.stringify(D.diagnostics.ha));
});

test('nothing grows on the park\'s paths, lawns or ponds, and the ponds keep their margin', () => {
  const F = C.highParkFeatureShapes;
  assert.ok(F && F.paths.length > 50);
  // (every path's centre line: no clearance)
  let n = 0;
  for (const p of F.paths) for (let k = 1; k < p.pts.length; k++) {
    const [ax, az] = p.pts[k - 1], [bx, bz] = p.pts[k];
    for (const t of [0.25, 0.5, 0.75]) { assert.ok(P.clearanceAt(ax + (bx - ax) * t, az + (bz - az) * t) <= 0.2, `a plant on a path at ${ax}, ${az}`); n++; }
  }
  assert.ok(n > 500);
  // (2 m into a pond and within 2 m of its edge: none)
  const pond = C.GEO.areas.filter(([k]) => k === 'water').map(([, , f]) => f).find((f) => f.some((v, i) => i % 2 === 0 && v > -6900 && v < -6500));
  assert.ok(pond);
  for (let i = 0; i < pond.length; i += 8) assert.ok(P.clearanceAt(pond[i], pond[i + 1]) <= 0);
  // (the City's sidewalks in the park, Centre Road's among them: none on them, nor off the park's islands)
  let sw = 0;
  for (const [, outer] of C.SIDEWALKS.polys) {
    const o = C.decodeSidewalkRing(outer);
    for (const q of o) if (q.x > -7150 && q.x < -5800 && q.z > -2900 && q.z < -1100) { assert.ok(P.clearanceAt(q.x, q.z) <= 0.75, `a plant on a sidewalk's edge at ${q.x}, ${q.z}`); sw++; } // (its outline: within a 1 m cell of it)
  }
  assert.ok(sw > 50, `${sw} sidewalk points`);
  for (let k = 0; k < 4000; k++) {
    const x = -7150 + ((k * 7919) % 1350), z = -2900 + ((k * 104729) % 1800);
    const b = C.blockAt(x, z);
    if (!(b && C.parkWoods.replacesBlock(b))) assert.ok(P.clearanceAt(x, z) <= 0.75, `a plant off the park at ${x}, ${z}`);
  }
  // the woods and the savanna have room; the north lawn none
  assert.ok(P.clearanceAt(-6340, -2340) > 2);
  assert.ok(P.clearanceAt(-6240, -2350) > 2);
});

test('the sites: thousands of shrubs, willows only along Grenadier Pond, all off the paths', () => {
  const sh = P.shrubSites(), wi = P.willowSites();
  assert.ok(sh.length > 10000 && sh.length < 100000, `${sh.length} shrubs`);
  for (const s of sh) {
    assert.ok(P.clearanceAt(s.x, s.z) >= 0.35, `a shrub on a path at ${s.x}, ${s.z}`);
    assert.ok(s.h > 0.8 && s.h < 4, `${s.h} m`);
    assert.ok(C.highParkFeatureAt ? !C.highParkFeatureAt(s.x, s.z, 0) : true);
  }
  assert.ok(wi.length > 20 && wi.length < 200, `${wi.length} willows`);
  for (const w of wi) assert.ok(P.clearanceAt(w.x, w.z) >= 2.5 && w.h >= 10 && w.h <= 15);
});

test('the gates: ?parkcover=0 builds nothing, ?shore=0 no willows; the trees\' pilot switches', () => {
  assert.equal(city('?parkcover=0').buildParkCover, undefined);
  assert.equal(city('?shore=0').parkCover.willowSites().length, 0);
  const ez = read('ez-trees');
  for (const k of ['treeimp', 'canopy', 'treevary']) assert.match(ez, new RegExp(`get\\('${k}'\\)`));
  assert.match(ez, /const IMP_ROLLOUT = \{ 'high-park': \[-7200, -2940, -5760, -1080\] \}/);
  // (the canopy grade only on the park's islands: the woods' ground cover's alpha, read at the tree's middle)
  assert.match(ez, /texture\(hp\.groundCover\(\)\.texture, uv\)\.a/);
});

test('the shrub layer is reproducible from the lidar tiles', { skip: !fs.existsSync(path.join(process.env.DON_VALLEY_DTM || path.join(os.homedir(), '.cache/slop-toronto/raw/ontario-dtm-gta2023'), 'manifest-high-park-dsm.json')) && 'no surface model tiles (node tools/fetch-don-valley-dtm.mjs --region high-park --product dsm)' }, () => {
  const out = path.join(os.tmpdir(), `high-park-cover-data-${process.pid}.js`);
  execFileSync(process.execPath, [new URL('../tools/build-park-cover.mjs', import.meta.url).pathname, '--out', out], { stdio: 'pipe' });
  assert.equal(fs.readFileSync(out, 'utf8'), read('high-park-cover-data'));
  fs.rmSync(out);
});

test('the natural trails: a narrow worn track, the plants growing into the corridor to it, the shrubs kept out of it', () => {
  const F = C.highParkFeatureShapes, TR = F.trail;
  assert.ok(TR && TR.on);
  const fs = [];
  let n = 0;
  for (const p of F.paths) {
    if (p.surf !== 1) continue;
    for (let k = 0; k < p.pts.length; k++) {
      const [x, z] = p.pts[k], f = TR.halfWidth(x, z, p.w) / (p.w / 2), e = TR.earthAt(p, k, 0, x, z);
      assert.ok(f >= TR.earth[0] - 1e-9 && f <= TR.earth[1] + 1e-9, `earth ${f}`);
      assert.ok(e / (p.w / 2) >= TR.earth[0] - 1e-9 && e / (p.w / 2) <= TR.earth[1] + TR.woods + TR.junction + 1e-9);
      const pe = TR.plantEdge(x, z, p.w, e);
      assert.ok(pe - e >= 0.1 - 1e-9 && pe - e <= 0.3 + 1e-9, `plants ${pe - e} past the earth`);
      // the plants reach into the corridor beside the earth; the shrubs keep out of it
      if (k % 4 === 0 && P.clearanceAt(x, z, true) > -10) {
        assert.ok(P.clearanceAt(x, z, true) <= 0.2, 'the shrubs\' field: the centreline is in the corridor');
        n++;
      }
      fs.push(f);
    }
  }
  assert.ok(n > 50);
  for (const s of P.shrubSites()) assert.ok(P.clearanceAt(s.x, s.z, true) >= 0.35, `a shrub in a trail's corridor at ${s.x}, ${s.z}`);
  const mean = fs.reduce((a, b) => a + b, 0) / fs.length, sd = Math.sqrt(fs.reduce((a, b) => a + (b - mean) ** 2, 0) / fs.length);
  assert.ok(sd > 0.05 && Math.min(...fs) < 0.55 && Math.max(...fs) > 0.7, `mean ${mean.toFixed(2)} sd ${sd.toFixed(2)}`);
  assert.equal(city('?trails=0').highParkFeatureShapes.trail.on, false);
  assert.match(read('high-park-features'), /const natural = TRAIL\.on && p\.surf === 1/);
});

test('the seasons: the impostors\' leaf key is smooth (no cells), the shrubs and willows are deciduous', () => {
  const imp = read('tree-impostors');
  // (a floored key turned and dropped whole squares of crown in autumn: John, 2026-11-06)
  assert.doesNotMatch(imp, /dot\(p\.floor\(\)/);
  assert.match(imp, /const leafRnd = vn\(p\)/);
  const pc = read('park-cover');
  assert.equal((pc.match(/deciduous\(s\.rgb,/g) || []).length, 2, 'the shrubs and the willows');
  assert.match(pc, /C\.autumnLeaf\(rgb, plant, leafRnd\)/);
  assert.match(pc, /C\.leafStays\(/);
  // (the season check's shots carry no time preset: ?liveDate= sets the season)
  const shots = JSON.parse(fs.readFileSync(new URL('../tools/shots/park-seasons.json', import.meta.url), 'utf8'));
  assert.ok(shots.length >= 5 && shots.every((s) => s.time === undefined));
});
