// Road markings in cells (js/road-paint.js, after upstream 997185d) and their distance culling (js/scene-culling.js)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as CORE from '../vendor/three/three.core.js';

const paintSource = readFileSync(new URL('../js/road-paint.js', import.meta.url), 'utf8');
const cullingSource = readFileSync(new URL('../js/scene-culling.js', import.meta.url), 'utf8');

// Two signalised junctions 2.6 km apart (a multi-lane street with a crossover and a midblock signal), a ramp up onto a
// deck and on round a bend; and the bikeways' paint: a green lane and its dashed edge crossing three cells, a trail's
// surface with its centre line, a short strip and a run of pavement symbols
function network() {
  const node = (id, x, z, extra = {}) => ({ id, x, z, shape: false, signal: false, ...extra });
  const A = node(0, 0, 0, { signal: true }), B = node(1, 2600, 300, { signal: true }), C = node(2, 2600, -2000, { shape: true });
  const D = node(3, 2650, -2400);
  const edge = (from, to, lanes, half, h = {}) => {
    const L = Math.hypot(to.x - from.x, to.z - from.z), dx = (to.x - from.x) / L, dz = (to.z - from.z) / L;
    const a = from.shape ? 0 : 6, b = to.shape ? 0 : 6;
    return { from, to, x0: from.x, z0: from.z, sx: from.x + dx * a, sz: from.z + dz * a, dx, dz, rx: -dz, rz: dx, span: L, len: L - a - b,
      half, lanes, outSide: 0, inSide: 1, ...h };
  };
  const ab = edge(A, B, [1.8, 5.4], 7.2), ba = edge(B, A, [1.8, 5.4], 7.2);
  const edges = [ab, ba, edge(B, C, [1.8], 3.6, { h0: 0, h1: 12 }), edge(C, B, [1.8], 3.6, { h0: 12, h1: 0 }), edge(C, D, [1.8], 3.6), edge(D, C, [1.8], 3.6)];
  return { edges, midCrossings: [{ stops: [{ e: ab, s: 700 }, { e: ba, s: ab.len - 700 }], half: 7.2, kind: 'pxo' },
    { stops: [{ e: ab, s: 1500 }, { e: ba, s: ab.len - 1500 }], half: 7.2, kind: 'signal' }] };
}
const polyline = (x0, z0, x1, z1, step) => {
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / step), tx = (x1 - x0) / L, tz = (z1 - z0) / L;
  const P = Array.from({ length: n + 1 }, (_, k) => ({ x: x0 + tx * L * k / n, y: 0.15, z: z0 + tz * L * k / n, nx: -tz, nz: tx, m: 1, s: L * k / n }));
  P.nRight = true;
  return P;
};
function bikePaint({ strip, ribbon, symbolStrip, WHITE, YELLOW }) {
  const GREEN = new CORE.Color(0x2a8a4e);
  ribbon(polyline(100, 50, 3100, 60, 25), 0.15, 1.6, GREEN, 2.4, 0.6);
  ribbon(polyline(100, 50, 3100, 60, 25), 0, 0.42, WHITE, 0.9, 0.5);
  const trail = polyline(-500, -80, 2900, -95, 30);
  ribbon(trail, -2, 2, new CORE.Color(0x9a3a32), 1, 2);
  ribbon(trail, -0.06, 0.06, YELLOW, 5, 0.5);
  strip(1150, 0.2, 500, 1250, 0.2, 520, 0.14, WHITE);
  for (let k = 0; k < 400; k++) symbolStrip(1100 + k * 0.5, 0.15, 700, 1100.03 + k * 0.5 + (k % 5) * 0.2, 0.15, 700.1, 0.07, WHITE);
}

function buildPaint(quality = { cull: 1 }) {
  const materials = [];
  const CITY = {
    THREE: CORE, CROSSWALK: 2.5, QUALITY: quality, bikePaint,
    createRoadPaintMaterial: (fadeEnd) => { const m = new CORE.MeshBasicMaterial({ transparent: true }); m.fadeEnd = fadeEnd; materials.push(m); return m; },
    edgeY: (e, s) => (!e.h0 && !e.h1 ? 0 : e.h0 + (e.h1 - e.h0) * Math.min(1, Math.max(0, s / e.span)))
  };
  new Function('window', 'console', paintSource)({ CITY }, { info() {} });
  const scene = new CORE.Scene();
  const group = CITY.buildRoadPaint(scene, network());
  return { scene, group, materials };
}

test('road markings are cells: the paint culled at its fade-out distance, the trail surfaces first and kept', () => {
  const { scene, group, materials } = buildPaint();
  assert.equal(scene.getObjectByName('RoadMarkings'), group);
  assert.equal(materials.length, 1, 'one material for every cell');
  assert.equal(materials[0].fadeEnd, 1650);
  const kinds = group.children.map((m) => m.name);
  const surfaces = kinds.filter((n) => n === 'RoadMarkingsSurfaces').length;
  assert.ok(surfaces >= 2 && kinds.length - surfaces >= 6, `cells: ${kinds}`);
  assert.deepEqual(kinds.slice(0, surfaces), Array(surfaces).fill('RoadMarkingsSurfaces'), 'the surfaces draw first');
  for (const mesh of group.children) {
    const g = mesh.geometry, pos = g.attributes.position, side = g.attributes.side, paint = g.attributes.paint;
    assert.equal(mesh.material, materials[0]);
    assert.equal(mesh.renderOrder, -1);
    if (mesh.name === 'RoadMarkingsSurfaces') assert.equal(mesh.userData.cullDistance, undefined);
    else assert.deepEqual([mesh.userData.cullDistance, mesh.userData.cullFixed], [1650, true]);
    assert.equal(g.index.array.constructor, pos.count > 65535 ? Uint32Array : Uint16Array);
    // every vertex lies in the bounds even widened 16x on screen (createRoadPaintMaterial), and the surfaces' cells hold
    // only surfaces (a duty over 1.5) and the paint's none
    const s = g.boundingSphere, p = new CORE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      p.x += side.getX(i) * 15;
      p.z += side.getY(i) * 15;
      assert.ok(p.distanceTo(s.center) <= s.radius + 1e-3, `${mesh.name} vertex ${i} outside its bounds`);
      assert.equal(paint.getZ(i) > 1.5, mesh.name === 'RoadMarkingsSurfaces');
    }
    // no strip longer than 200 m (a cell's bounds stay near its square)
    for (let t = 0; t < g.index.count; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => new CORE.Vector3().fromBufferAttribute(pos, g.index.getX(t + k)));
      assert.ok(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) < 210);
    }
  }
  // the phone tiers fade & cull sooner (x QUALITY.cull)
  const low = buildPaint({ cull: 0.6 });
  assert.equal(low.materials[0].fadeEnd, 990);
  assert.ok(low.group.children.every((m) => m.name === 'RoadMarkingsSurfaces' || m.userData.cullDistance === 990));
});

test('scene culling hides the paint cells beyond their distance, ignoring the quality net, and keeps the surfaces', () => {
  const { scene, group } = buildPaint();
  const quality = { cull: 1, dist: 0.5 };
  const CITY = { THREE: CORE, QUALITY: quality, Addons: {} };
  new Function('window', cullingSource)({ CITY });
  CITY.setupSceneCulling(scene, [group]);
  const cells = [];
  group.traverse((o) => { if (o.isMesh) cells.push(o); });
  assert.ok(cells.length >= 8);
  const visibleAt = (x, y, z) => {
    CITY.updateSceneCulling({ x, y, z });
    const shown = [];
    for (const m of cells) {
      let on = m.visible;
      for (let o = m.parent; o && o !== group; o = o.parent) on = on && o.visible;
      if (on) shown.push(m);
    }
    return shown;
  };
  const near = (m, x, y, z) => {
    const s = m.geometry.boundingSphere;
    return Math.hypot(s.center.x - x, s.center.y - y, s.center.z - z) - s.radius;
  };
  for (const [x, y, z] of [[0, 1.7, 0], [2600, 1.7, 300], [9000, 1.7, 9000], [1300, 400, -800]]) {
    const shown = new Set(visibleAt(x, y, z));
    for (const m of cells) {
      // (with the net at 0.5 an ordinary chunk would go at 825 m; the paint keeps its full 1,650)
      const want = m.name === 'RoadMarkingsSurfaces' || near(m, x, y, z) < 1650;
      assert.equal(shown.has(m), want, `${m.name} at ${near(m, x, y, z).toFixed(0)} m from (${x}, ${y}, ${z})`);
    }
  }
  assert.ok(visibleAt(9000, 1.7, 9000).every((m) => m.name === 'RoadMarkingsSurfaces'), 'nothing of the paint 9 km away');
});
