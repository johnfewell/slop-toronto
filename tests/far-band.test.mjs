// A bigger map's far band (st-bz1o: ?map=eglinton; city-config.js FAR_BAND, scene-culling.js splitFarBand /
// setupFarBand / updateFarBand): the city beyond today's detailed city is cut at its edge into 1.2 km cells hidden beyond
// FAR_BAND.distance of the camera, with the far city's stand-ins shown exactly where a cell is hidden; today's part of
// a city-wide mesh stays whole and drawn, and today's map has no band at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as CORE from '../vendor/three/three.core.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const CORE_FRAME = { x0: -7900, x1: 3700, z0: -3000, z1: 3600 };
const EGLINTON = JSON.parse(read('tools/frames/eglinton.json')).world;

// city-config.js's FAR_BAND for a frame (its definition, evaluated on its own)
function farBand(detail, search = '') {
  const src = read('js/city-config.js');
  const def = src.slice(src.indexOf('const CORE_FRAME = '), src.indexOf('})();', src.indexOf('const FAR_BAND = ')) + 5);
  return vm.runInNewContext(`${def}; FAR_BAND`, { DETAIL: detail, location: { search }, Number, Math });
}

test('today\'s map has no band; the Eglinton frame does, outside today\'s city only; ?band=0 turns it off', () => {
  assert.equal(farBand(CORE_FRAME), null);
  const B = farBand(EGLINTON);
  assert.ok(B && B.distance === 2000 && B.cell === 1200);
  assert.ok(B.inBand(568, -6937), 'Yonge & Eglinton');
  assert.ok(B.inBand(8000, -1000), 'east of the Don');
  assert.ok(!B.inBand(386, -344), 'King & Bay');
  assert.ok(!B.inBand(20000, -1000), 'beyond the frame');
  assert.equal(farBand(EGLINTON, '?band=0'), null);
  assert.equal(farBand(EGLINTON, '?map=eglinton&band=1500').distance, 1500);
});

function setup({ strips = 1, cut = false } = {}) {
  class MeshBasicNodeMaterial extends CORE.MeshBasicMaterial {}
  const B = farBand(EGLINTON);
  const window = { CITY: { THREE: { ...CORE, MeshBasicNodeMaterial }, QUALITY: { cull: 1, dist: 1, shadowFar: 1, staticCell: 1 },
    Addons: { mergeGeometries: () => null }, FAR_BAND: B } };
  vm.runInNewContext(read('js/scene-culling.js'), { window, Math, console, Map, Set, Object, Array, Number, Float32Array, Infinity });
  const scene = new CORE.Scene(), root = new CORE.Group();
  root.name = 'CityGround';
  scene.add(root);
  // a city-wide ground mesh: one quad (two triangles) every 250 m over the whole frame
  const pos = [];
  for (let x = EGLINTON.x0; x < EGLINTON.x1; x += 250) for (let z = EGLINTON.z0; z < EGLINTON.z1; z += 250) {
    const a = [x + 10, 0, z + 10], b = [x + 200, 0, z + 10], c = [x + 10, 0, z + 200], d = [x + 200, 0, z + 200];
    pos.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  // (in `strips` meshes of one material, as city-grid.js batches its islands: 18 numbers a quad)
  const mat = new CORE.MeshStandardMaterial();
  const per = Math.ceil(pos.length / 18 / strips) * 18;
  let total = 0;
  for (let k = 0; k < pos.length; k += per) {
    const g = new CORE.BufferGeometry();
    g.setAttribute('position', new CORE.Float32BufferAttribute(pos.slice(k, k + per), 3));
    total += g.attributes.position.count / 3;
    const ground = new CORE.Mesh(g, mat);
    ground.name = 'Walkways';
    root.add(ground);
  }
  // an open cut north of Bloor (subway.js: a group outside the culling roots that asks for the band)
  let cutGroup = null;
  if (cut) {
    cutGroup = new CORE.Group();
    cutGroup.userData.farBandGroup = true;
    const wall = new CORE.Mesh(new CORE.BoxGeometry(20, 6, 400), new CORE.MeshStandardMaterial());
    wall.position.set(390, -3, -5800);
    cutGroup.add(wall);
    scene.add(cutGroup);
  }
  // the far city's stand-ins in two band cells (surroundings.js userData.bandStandIn)
  const standIns = [[0, -6], [7, -2]].map(([i, j]) => {
    const m = new CORE.Mesh(new CORE.BoxGeometry(10, 10, 10), new CORE.MeshStandardMaterial());
    m.position.set((i + 0.5) * B.cell, 5, (j + 0.5) * B.cell);
    m.userData.bandStandIn = { i, j };
    scene.add(m);
    return m;
  });
  scene.updateMatrixWorld(true);
  const stats = window.CITY.setupSceneCulling(scene, [root]);
  return { C: window.CITY, scene, root, stats, standIns, total, B, cutGroup };
}
const meshesUnder = (o) => { const out = []; o.traverse((x) => { if (x.isMesh) out.push(x); }); return out; };
const tris = (m) => m.geometry.attributes.position.count / 3;

test('a city-wide mesh is cut into today\'s part, whole, and the band\'s cells; no triangle is lost or doubled', () => {
  const { root, stats, total, B } = setup();
  const pieces = meshesUnder(root);
  assert.equal(pieces.reduce((s, m) => s + tris(m), 0), total);
  const core = pieces.filter((m) => m.userData.farBand === false);
  assert.equal(core.length, 1, 'today\'s part in one piece');
  const band = pieces.filter((m) => m.userData.farBand === true);
  assert.ok(band.length > 50 && stats.bandCells >= band.length - 1, `${band.length} band pieces in ${stats.bandCells} cells`);
  // every core triangle has its centre in today's city, every band triangle outside it
  const centres = (m) => { const p = m.geometry.attributes.position.array, out = []; for (let i = 0; i < p.length; i += 9) out.push([(p[i] + p[i + 3] + p[i + 6]) / 3, (p[i + 2] + p[i + 5] + p[i + 8]) / 3]); return out; };
  assert.ok(centres(core[0]).every(([x, z]) => B.inCore(x, z)));
  assert.ok(band.every((m) => centres(m).every(([x, z]) => !B.inCore(x, z))));
});

test('from downtown the band is hidden and its stand-ins shown; from Yonge & Eglinton the reverse nearby', () => {
  const { C, root, standIns } = setup();
  const visibleBand = () => meshesUnder(root).filter((m) => m.userData.farBand === true && (() => { let o = m; while (o) { if (!o.visible) return false; o = o.parent; } return true; })());
  const core = meshesUnder(root).find((m) => m.userData.farBand === false);
  C.updateSceneCulling(new CORE.Vector3(386, 1.7, -344)); // King & Bay
  assert.equal(visibleBand().length, 0, 'no band cell within reach of King & Bay');
  assert.ok(core.visible, 'today\'s city drawn');
  assert.deepEqual(standIns.map((s) => s.visible), [true, true], 'the far city stands in');
  C.updateSceneCulling(new CORE.Vector3(568, 1.7, -6937)); // Yonge & Eglinton
  assert.ok(visibleBand().length > 0, 'the band\'s city around Yonge & Eglinton');
  assert.deepEqual(standIns.map((s) => s.visible), [false, true], 'its stand-in hidden there; the far one (east of the Don) shown');
});

test('a batch built in strips is cut as one: today\'s part one piece, one piece per band cell', () => {
  const { root, stats, total } = setup({ strips: 7 });
  const pieces = meshesUnder(root);
  assert.equal(pieces.reduce((s, m) => s + tris(m), 0), total, 'no triangle lost or doubled');
  assert.equal(pieces.filter((m) => m.userData.farBand === false).length, 1, 'today\'s part in one piece, not one per strip');
  const band = pieces.filter((m) => m.userData.farBand === true);
  const cells = new Set(band.map((m) => m.userData.bandCell.join(',')));
  assert.equal(band.length, cells.size, 'one piece per band cell');
  assert.equal(stats.bandFamilies, 1);
});

test('a group that asks for the band (an open cut north of Bloor) is hidden from downtown and shown nearby', () => {
  const { C, cutGroup, stats } = setup({ cut: true });
  assert.equal(stats.bandGroups, 1);
  C.updateSceneCulling(new CORE.Vector3(386, 1.7, -344)); // King & Bay
  assert.equal(cutGroup.visible, false);
  C.updateSceneCulling(new CORE.Vector3(330, 1.7, -4800)); // Yonge & St Clair
  assert.equal(cutGroup.visible, true);
});

test('within reach is the cell\'s nearest point within FAR_BAND.distance', () => {
  const { C, root, B } = setup();
  const shown = () => new Set(meshesUnder(root).filter((m) => m.userData.farBand === true && m.parent.visible).map((m) => m.userData.bandCell.join(',')));
  C.updateSceneCulling(new CORE.Vector3(330, 1.7, -2400)); // Yonge & Bloor, 600 m south of the band
  for (const k of shown()) {
    const [i, j] = k.split(',').map(Number);
    const dx = Math.max(i * B.cell - 330, 0, 330 - (i + 1) * B.cell), dz = Math.max(j * B.cell + 2400, 0, -2400 - (j + 1) * B.cell);
    assert.ok(Math.hypot(dx, dz) < B.distance, `cell ${k} within reach`);
  }
  assert.ok(shown().size > 0);
});
