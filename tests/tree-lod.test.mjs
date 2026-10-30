// Level-of-detail updates of both tree fields: the default EZ-Tree field (js/ez-trees.js) and mrdoob's procedural trees
// (js/trees.js: ?trees=slop, and the fallback when the EZ-Tree models don't load). Both now resolve whole cells of trees
// at once (after upstream e35c06c); these check them tree for tree against the per-tree rules they replaced.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as CORE from '../vendor/three/three.core.js';
import { buildField, snapshot, torontoTrees, QUALITY_TIERS } from '../tools/tree-lod-harness.mjs';

const ezSource = readFileSync(new URL('../js/ez-trees.js', import.meta.url), 'utf8');
const treesSource = readFileSync(new URL('../js/trees.js', import.meta.url), 'utf8');

// A city-sized spread of trees: dense rows (so cells straddle every hand-over edge) out to 8 km, every model
function syntheticTrees(treeModels) {
  const streetTrees = [];
  for (let i = 0; i < 2600; i++) {
    const row = Math.floor(i / 40), col = i % 40;
    const x = (col - 20) * 23 + ((i * 37) % 11) + (row % 7) * 900 - 2700;
    const z = (row - 32) * 61 + ((i * 53) % 13);
    streetTrees.push(x, z, i % treeModels.length, 60 + (i % 9) * 20);
  }
  const generated = [];
  for (let i = 0; i < 900; i++) {
    generated.push({ x: -3500 + (i % 30) * 31 + Math.floor(i / 300) * 2500, y: 0.15, z: -1800 + Math.floor((i % 300) / 30) * 47, scale: 0.6 + (i % 5) * 0.12, species: i % 3, tier: i % 2 ? 0 : 2 });
  }
  return { streetTrees, generated };
}

// The levels each tree drew before the cells (ez-trees.js as of 35e8e84, one tree at a time)
function ezOracle(quality, treeModels, streetTrees, generated) {
  const ids = treeModels.map(([id]) => id);
  const FAR = quality.treeFar, NEAR = quality.treeNear, MID = quality.treeMid, MID_SHADOW = quality.treeMidShadow;
  const BAND = [14, 50, 80], MARGIN = 6, MAX_DIST = [3000 * FAR, 1600 * FAR, 950 * FAR], LOW_CUTOFF = 1150 * FAR, PINE_FAR = 600 * FAR;
  const FAR_SPECIES = (id) => (id.includes('pine') ? -1 : id.includes('ash') ? 1 : id.includes('aspen') ? 2 : 0);
  const genModel = (sp, h) => {
    const big = h > 15 ? 2 : h > 9 ? 1 : 0;
    if (sp === 1) return ids.indexOf(['ez-ash-small', 'ez-ash-medium', 'ez-ash-large'][big]);
    if (sp === 2) return ids.indexOf(big ? 'ez-aspen-large' : 'ez-aspen-medium');
    return ids.indexOf(['ez-oak-small', 'ez-oak-medium', 'ez-oak-large'][big]);
  };
  const trees = [];
  for (let i = 0; i < streetTrees.length; i += 4) trees.push({ x: streetTrees[i], y: 0, z: streetTrees[i + 1], model: streetTrees[i + 2], height: streetTrees[i + 3] / 10, tier: 1 });
  for (const t of generated) { const h = t.scale * 12; trees.push({ x: t.x, y: t.y, z: t.z, model: genModel(t.species, h), height: h, tier: t.tier }); }
  for (const t of trees) {
    const id = ids[Math.max(0, t.model)], sp = FAR_SPECIES(id);
    Object.assign(t, { id, sp, pine: sp < 0, origin: [t.x, t.y + t.height * 0.5, t.z].map(Math.fround) });
  }
  return (cam) => {
    const low = cam.y < 40, rows = new Map();
    const add = (name, row) => { if (!rows.has(name)) rows.set(name, []); rows.get(name).push(row); };
    for (const t of trees) {
      const [x, y, z] = t.origin;
      const d = Math.sqrt((x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2);
      let maxD = low ? Math.min(MAX_DIST[t.tier], LOW_CUTOFF) : MAX_DIST[t.tier];
      if (t.pine) maxD = Math.min(maxD, PINE_FAR);
      const f = Float32Array.from(t.pine
        ? [-1e6, 1, NEAR, BAND[0], NEAR, BAND[0], maxD, BAND[2], 1e9, 1, 1e9, 1]
        : [-1e6, 1, NEAR, BAND[0], NEAR, BAND[0], MID, BAND[1], MID, BAND[1], maxD, BAND[2]]);
      for (let l = 0; l < 3; l++) {
        const lo = f[l * 4] - f[l * 4 + 1] * 0.5 - MARGIN, hi = f[l * 4 + 2] + f[l * 4 + 3] * 0.5 + MARGIN;
        if (!(d >= lo && d < hi)) continue;
        const name = l === 0 ? `Trees_${t.id}_near` : l === 1 || t.pine ? `Trees_${t.id}_mid${l === 1 && d > MID_SHADOW ? '_noshadow' : ''}` : `Trees_far_species${t.sp}`;
        add(name, [...t.origin, ...f.subarray(l * 4, l * 4 + 4)].join('|'));
      }
    }
    for (const r of rows.values()) r.sort();
    return rows;
  };
}

// origin and hand-over bands of every drawn instance, per mesh (the harness snapshot rows end with those 7 numbers)
const drawn = (field) => {
  const out = new Map();
  for (const [name, { rows }] of snapshot(field)) {
    // (a mesh no tree has used yet holds one instance buried 500 m down, for the start-up shader warm-up)
    const live = rows.map((r) => r.split('|').slice(-2).join('|').split(',').join('|')).filter((r) => r !== '0|0|0|-1000000|1|1000000000|1');
    if (live.length) out.set(name, live.sort());
  }
  return out;
};

const PATH = [
  [0, 1.7, 0], [3, 1.7, 1], [0, 1.7, 40], [0, 1.7, 52], [0, 1.7, 61], [0, 1.7, 75], [0, 1.7, 140], [0, 1.7, 300], [0, 1.7, 330],
  [-1200, 1.7, -400], [-1200, 39, -400], [-1200, 41, -400], [-1200, 260, -400], [-1200, 2, -400], [2400, 1.7, 1800], [-9000, 80, 9000],
  [-9010, 80, 9010], [-2700, 1.7, 0], ...Array.from({ length: 40 }, (_, k) => [-2700 + k * 37, k % 11 === 5 ? 60 : 1.7, -k * 29])
];

for (const [tierName, quality] of Object.entries(QUALITY_TIERS)) {
  test(`EZ-Tree cells draw exactly the per-tree levels and hand-over bands (${tierName} tier)`, async () => {
    const { treeModels } = torontoTrees();
    const { streetTrees, generated } = syntheticTrees(treeModels);
    const { field, THREE } = await buildField({ source: ezSource, quality, streetTrees, treeModels, generated });
    const oracle = ezOracle(quality, treeModels, streetTrees, generated);
    const last = { x: Infinity, y: Infinity, z: Infinity };
    let moves = 0;
    for (const [x, y, z] of PATH) {
      const cam = { x, y, z };
      const moved = (x - last.x) ** 2 + (y - last.y) ** 2 + (z - last.z) ** 2 >= 16;
      field.update(new THREE.Vector3(x, y, z));
      if (!moved) continue; // (under 4 m the levels are left as they were)
      Object.assign(last, cam);
      moves++;
      assert.deepEqual(drawn(field), oracle(cam), `drawn instances at (${x}, ${y}, ${z})`);
    }
    assert.ok(moves > 50);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// trees.js: mrdoob's trees, as the fallback field street-details.js builds (Toronto keeps its scene.onBeforeRender hook)
function loadTreeField() {
  const buffer = new Uint8ClampedArray(1024 * 1024 * 4);
  const noop = () => {};
  const ctx = new Proxy({ getImageData: () => ({ data: buffer }) }, { get: (t, k) => (k in t ? t[k] : noop), set: () => true });
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  const window = { CITY: { THREE: CORE, createTreeMaterial: () => ({ name: 'TreeMaterial' }) } };
  new Function('window', 'document', treesSource)(window, document);
  return window.CITY.createTreeField;
}

// The per-tree rule trees.js used before e35c06c: 3D distance to mid-crown, hysteresis at every boundary
function slopOracle(sites) {
  const hashPos = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
  const MAX_DIST = [3000, 1600, 950], LOW_CUTOFF = 1150, NEAR = 105, MID = 420, H = 6;
  const trees = sites.map((t) => {
    const s = t.scale * (0.9 + hashPos(t.x, 1.3, t.z) * 0.2);
    return { x: Math.fround(t.x), y: Math.fround((t.y || 0) + 6 * s), z: Math.fround(t.z), tier: Math.min(2, t.tier || 0), lod: 255 };
  });
  const last = { x: Infinity, y: Infinity, z: Infinity };
  return (cam) => {
    if ((cam.x - last.x) ** 2 + (cam.y - last.y) ** 2 + (cam.z - last.z) ** 2 >= 16) {
      Object.assign(last, { x: cam.x, y: cam.y, z: cam.z });
      const low = cam.y < 40;
      for (const t of trees) {
        const d = Math.sqrt((t.x - cam.x) ** 2 + (t.y - cam.y) ** 2 + (t.z - cam.z) ** 2);
        const maxD = low ? Math.min(MAX_DIST[t.tier], LOW_CUTOFF) : MAX_DIST[t.tier];
        const cur = t.lod === 255 ? 3 : t.lod;
        let next = d < NEAR ? 0 : d < MID ? 1 : d < maxD ? 2 : 3;
        if (Math.abs(next - cur) === 1 && Math.abs(d - [NEAR, MID, maxD][Math.min(next, cur)]) < H) next = cur;
        t.lod = next === 3 ? 255 : next;
      }
    }
    const totals = [0, 0, 0];
    for (const t of trees) if (t.lod !== 255) totals[t.lod]++;
    return totals;
  };
}

test('fallback trees (trees.js) follow the view camera through scene.onBeforeRender, matching the per-tree rule', () => {
  const createTreeField = loadTreeField();
  const sites = [];
  for (let i = 0; i < 2400; i++) {
    sites.push({ x: ((i % 15) - 7) * 165 + ((i * 37) % 29), y: i % 7 === 0 ? 3.5 : 0.2, z: (Math.floor(i / 15) - 80) * 72 + ((i * 53) % 31), scale: 0.85 + (i % 5) * 0.08, species: i % 3, tier: i % 3 });
  }
  let previousCalls = 0;
  const scene = { onBeforeRender() { previousCalls++; } };
  const field = createTreeField(scene, sites, []);
  assert.equal(field.stats.trees, sites.length);
  assert.notEqual(scene.onBeforeRender, undefined);
  const oracle = slopOracle(sites);
  oracle({ x: 0, y: 10, z: 140 }); // (the start-up levels)
  const totals = () => {
    const out = [0, 0, 0];
    for (const m of field.meshes) if (m.visible) out[Number(/_lod([012])_/.exec(m.name)[1])] += m.count;
    return out;
  };
  const camera = new CORE.PerspectiveCamera();
  const render = (x, y, z, cam = camera) => {
    cam.position.set(x, y, z);
    cam.updateMatrixWorld();
    scene.onBeforeRender({}, scene, cam, null);
  };
  const path = [[1, 10, 141], [0, 3.2, 130], [0, 3.2, 100], [0, 3.2, 94], [0, 3.2, 104], [0, 3.2, 112], [180, 3.2, -320], [180, 38, -320],
    [180, 44, -320], [180, 210, -320], [-750, 2.5, 4200], [-4000, 120, 14000], [-4020, 120, 14020], [0, 12, -2400],
    ...Array.from({ length: 30 }, (_, k) => [Math.sin(k * 0.4) * 350, k % 9 === 0 ? 65 : 3.5, -2400 + k * 85])];
  let changes = 0;
  for (const [x, y, z] of path) {
    const before = JSON.stringify(totals());
    render(x, y, z);
    const want = oracle({ x, y, z });
    assert.deepEqual(totals(), want, `levels at (${x}, ${y}, ${z})`);
    if (JSON.stringify(want) !== before) changes++;
  }
  assert.ok(changes > 10, 'the walk changed the levels');
  assert.equal(previousCalls, path.length, 'the previous scene hook still runs');
  // the shadow cascades (orthographic) keep the view's levels
  const held = JSON.stringify(totals());
  render(-4000, 120, 14000, new CORE.OrthographicCamera());
  assert.equal(JSON.stringify(totals()), held);
});
