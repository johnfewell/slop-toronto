// CPU benchmark of the EZ-Tree level updates (js/ez-trees.js) over the City's 57,120 street trees plus stand-in park
// and yard trees, and, given a baseline revision of ez-trees.js, a check that both draw exactly the same instances.
// Run:   node tools/benchmark-tree-lod.mjs [baseline-ez-trees.js]
//   e.g. git show 35e8e84:js/ez-trees.js > /tmp/ez-trees-base.js && node tools/benchmark-tree-lod.mjs /tmp/ez-trees-base.js
// Reports milliseconds per update() call (the per-tree level pass plus the regrouping it triggers), walking and driving
// at street level and flying aloft, every step past the 4 m regroup threshold. A desk CPU figure, not frame time.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildField, torontoTrees, inventedTrees, snapshot, levelTotals, QUALITY_TIERS } from './tree-lod-harness.mjs';

const baselinePath = process.argv[2];
const current = readFileSync(new URL('../js/ez-trees.js', import.meta.url), 'utf8');
const baseline = baselinePath ? readFileSync(baselinePath, 'utf8') : null;
const { streetTrees, treeModels } = torontoTrees();
const generated = inventedTrees(streetTrees);

// Named spots (world metres): Union Station, High Park, Spadina & Queen, Lake Shore by Ontario Place, the east end
const SPOTS = {
  union: [0, 1.7, 0], highPark: [-6387.6, 1.7, -2041.8], spadinaQueen: [-1083, 1.7, -716.7],
  lakeShore: [-2959.1, 1.7, 579.3], leslieville: [2600, 1.7, -400], highParkAloft: [-6200, 260, -2100], downtownAloft: [-500, 420, -300]
};
// Paths: [start, heading (rad), step (m), steps]
const PATHS = {
  'walk Spadina (5 m steps)': [SPOTS.spadinaQueen, Math.PI / 2 + 0.28, 5, 120],
  'drive Lake Shore (12 m steps)': [SPOTS.lakeShore, 0.05, 12, 150],
  'ride through High Park (6 m steps)': [SPOTS.highPark, 1.1, 6, 150],
  'fly over downtown (25 m steps, 420 m up)': [SPOTS.downtownAloft, 0.4, 25, 120]
};
const pathPoints = ([[x, y, z], h, step, n]) => Array.from({ length: n }, (_, k) => ({ x: x + Math.sin(h) * step * k, y, z: z + Math.cos(h) * step * k }));

async function make(source, quality) {
  const { field, THREE } = await buildField({ source, quality, streetTrees, treeModels, generated });
  return { field, V: (p) => new THREE.Vector3(p.x, p.y, p.z) };
}

// 1. Same instances, tree for tree, at every spot and along every path, on every quality tier
if (baseline) {
  let checks = 0;
  for (const [tierName, quality] of Object.entries(QUALITY_TIERS)) {
    const a = await make(baseline, quality), b = await make(current, quality);
    const visit = (p, label) => {
      const ca = a.field.update(a.V(p)), cb = b.field.update(b.V(p));
      assert.equal(cb, ca, `${tierName} ${label}: changed flag`);
      assert.deepEqual(snapshot(b.field), snapshot(a.field), `${tierName} ${label}: drawn instances differ`);
      checks++;
    };
    for (const [name, [x, y, z]] of Object.entries(SPOTS)) visit({ x, y, z }, name);
    for (const [name, path] of Object.entries(PATHS)) pathPoints(path).forEach((p, k) => k % 3 === 0 && visit(p, `${name} #${k}`));
    // crossing the 40 m street-level / aloft switch in place, and a climb out of a park
    for (const y of [1.7, 39, 41, 39, 120, 2]) visit({ x: -6300, y, z: -2050 }, `climb ${y}`);
  }
  console.log(`identical drawn instances (matrix, colour, origin, hand-over bands per instance) at ${checks} camera positions over 3 quality tiers`);
}

// 2. Time per update
const time = (field, V, points, reps = 3) => {
  // warm-up pass, then alternate directions so every update moves past the 4 m threshold
  for (const p of points) field.update(V(p));
  let n = 0;
  const t0 = performance.now();
  for (let r = 0; r < reps; r++) for (const p of (r % 2 ? points : [...points].reverse())) { field.update(V(p)); n++; }
  return (performance.now() - t0) / n;
};
const rows = [];
for (const [label, source] of [['baseline', baseline], ['current', current]]) {
  if (!source) continue;
  const { field, V } = await make(source, QUALITY_TIERS.high);
  const row = { label };
  for (const [name, path] of Object.entries(PATHS)) row[name] = time(field, V, pathPoints(path));
  rows.push(row);
}
console.log(`trees: ${streetTrees.length / 4} street + ${generated.length} stand-in park & yard trees; ms per update() (high tier), mean of 3 passes:`);
for (const name of Object.keys(PATHS)) console.log(`  ${name.padEnd(44)} ${rows.map((r) => `${r.label} ${r[name].toFixed(3)}`).join('   ')}${rows.length === 2 ? `   (${(rows[0][name] / rows[1][name]).toFixed(1)}x)` : ''}`);
{
  const { field, V } = await make(current, QUALITY_TIERS.high);
  for (const [name, p] of Object.entries(SPOTS)) {
    field.update(V({ x: p[0], y: p[1], z: p[2] }));
    console.log(`  drawn at ${name.padEnd(14)} ${JSON.stringify(levelTotals(field))}`);
  }
}
