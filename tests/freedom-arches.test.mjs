// The Freedom Arches (js/freedom-arches.js, docs/freedom-arches.md): their size and place against the City's massing numbers,
// their position over the rink and pool polygon, the build (one merged mesh, six leg colliders) and the Cavalcade lights.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function load(extra = {}, search = '') {
  const C = { THREE, TSL, Addons: { mergeGeometries }, ...extra };
  const ctx = vm.createContext({ window: { CITY: C }, URLSearchParams, location: { search }, console: { info() {}, log() {}, warn() {} }, Math, atob: (s) => Buffer.from(s, 'base64').toString('binary') });
  for (const f of ['js/toronto-geodata.js', 'js/toronto-holiday.js', 'js/toronto-rinks.js', 'js/world-collision.js', 'js/sports-terrain.js', 'js/rinks.js', 'js/freedom-arches.js', 'js/holiday.js']) vm.runInContext(read(f), ctx, { filename: f });
  return C;
}
const C0 = load();
const FA = C0.FREEDOM_ARCHES;
const stub = { blockAt: () => ({}), CITY_BOUNDS: { sidewalkHeight: 0.15 }, QUALITY: {}, cityUniforms: { uInteriorGlow: { value: 1 } } };

test('size and place match the City massing: 3 arches 38.56 m between feet, 9.14 m high, 1.55 m wide, 8.4 m apart', () => {
  const { SPEC } = FA;
  assert.equal(SPEC.xs.length, 3);
  assert.ok(Math.abs(2 * SPEC.outer.a - 38.56) < 0.01 && Math.abs(SPEC.outer.b - 9.14) < 0.01 && Math.abs(SPEC.width - 1.55) < 0.01);
  assert.ok(Math.abs(SPEC.xs[1] - SPEC.xs[0] - 8.49) < 0.1 && Math.abs(SPEC.xs[2] - SPEC.xs[1] - 8.4) < 0.1);
  const [zLow] = FA.onEllipse(SPEC.outer, 0), [zHigh] = FA.onEllipse(SPEC.outer, Math.PI), [, crown] = FA.onEllipse(SPEC.outer, Math.PI / 2);
  assert.ok(Math.abs(zLow - -823.2) < 0.05 && Math.abs(zHigh - -784.64) < 0.05 && Math.abs(crown - 9.14) < 1e-9);
  const [, soffit] = FA.onEllipse(SPEC.inner, Math.PI / 2);
  assert.ok(Math.abs(crown - soffit - 0.5) < 0.01, 'crown 0.5 m deep');
});

test('over the pool: each arch spans the rink polygon across its short side and stands inside its length, clear of the boards', () => {
  const rec = C0.RINKS.records.find((r) => r.assetId === '43599');
  const ring = rec.polygons[0].outer, xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const { SPEC } = FA;
  for (const x of SPEC.xs) assert.ok(x - SPEC.width / 2 > x0 && x + SPEC.width / 2 < x1, `arch at ${x} inside the polygon's length`);
  assert.ok(SPEC.zc > z0 && SPEC.zc < z1, 'centred over the polygon');
  // the feet stand on the paving beyond the polygon's long edges, so nothing touches the boards that run along them
  const boxes = FA.legBoxes();
  for (const b of boxes) assert.ok(b.maxZ < z0 - 1.5 || b.minZ > z1 + 1.5, 'leg beyond the boards');
  // and the span clears the pool's rink: 4.5+ m of headroom over the polygon's edge
  const edge = Math.abs(z0 - SPEC.zc), h = SPEC.inner.b * Math.sqrt(1 - (edge / SPEC.inner.a) ** 2);
  assert.ok(h > 4.5, `soffit ${h.toFixed(1)} m over the polygon's edge`);
});

test('build: one merged concrete mesh (a few thousand triangles at most) and six leg colliders; walkable between the legs', () => {
  const C = load(stub), scene = new THREE.Scene();
  const out = C.buildFreedomArches(scene);
  assert.equal(scene.children.length, 1);
  assert.deepEqual(out.group.children.map((m) => m.name), ['FreedomArches']);
  assert.ok(C.freedomArchStats.triangles > 800 && C.freedomArchStats.triangles < 3000, JSON.stringify(C.freedomArchStats));
  assert.equal(out.colliders.length, 6);
  for (const c of out.colliders) {
    assert.ok(c.maxX - c.minX < 2.2 && c.maxZ - c.minZ < 3 && c.maxY > 3 && c.maxY < 6);
    // not across the middle of the span: a person walks under the crown
    assert.ok(c.maxZ < -803.92 - 15 || c.minZ > -803.92 + 15);
  }
  const bb = new THREE.Box3().setFromObject(out.group);
  assert.ok(Math.abs(bb.max.y - (9.14 + 0.15)) < 0.05, `crown at ${bb.max.y}`);
});

test('Cavalcade lights: bulb lines along each arch inside the window, none outside; the arches themselves are the same either way', () => {
  const make = (date, search = '') => {
    const C = load({ ...stub, SITE_DATE: date }, search), scene = new THREE.Scene();
    C.buildFreedomArches(scene);
    const out = C.buildHoliday(scene, []);
    return { C, scene, out };
  };
  const summer = make({ month: 8, day: 22 });
  assert.equal(summer.out, null);
  assert.equal(summer.scene.children.length, 1, 'arches only, no lights');
  const win = make({ month: 11, day: 28 });
  assert.equal(win.scene.children.length, 2);
  const st = win.C.holidayStats.sites.nathanPhillips;
  assert.equal(st.arches, 3);
  assert.ok(st.archBulbs > 250 && st.archBulbs < 450, JSON.stringify(st));
  assert.ok(!win.out.group.children[0].children.some((m) => /hoop/i.test(m.name)));
  // every bulb sits on an arch: within 0.3 m of its top or its underside, none hang in the air over the pool
  const { SPEC } = FA, surf = [];
  for (let k = 0; k <= 800; k++) for (const e of [SPEC.outer, SPEC.inner]) surf.push(FA.onEllipse(e, (k / 800) * Math.PI));
  for (const side of ['top', 'under']) for (const [y, z] of FA.archLinePoints(side, 0.9)) {
    const d = Math.min(...surf.map(([sz, sy]) => Math.hypot(sz - z, sy - y)));
    assert.ok(d < 0.3, `${side} bulb at z ${z.toFixed(1)}, y ${y.toFixed(2)} is ${d.toFixed(2)} m off the arch`);
  }
});

test('the evergreen has its own night glow: a separate body mesh with an emissive material, in both holiday trees', () => {
  const C = load({ ...stub, SITE_DATE: { month: 12, day: 10 } }), scene = new THREE.Scene();
  C.buildFreedomArches(scene);
  const out = C.buildHoliday(scene, []);
  for (const g of out.group.children) {
    const body = g.children.find((m) => /Evergreen$/.test(m.name));
    assert.ok(body, `${g.name} has an evergreen body`);
    assert.ok(body.material.emissiveNode, 'emissive term');
  }
});

test('wiring: explore.html loads the module before holiday.js, main.js builds it with its colliders', () => {
  const html = read('explore.html'), pos = (n) => html.indexOf(n);
  assert.ok(pos('./js/freedom-arches.js') > pos('./js/rinks.js') && pos('./js/freedom-arches.js') < pos('./js/holiday.js'));
  assert.match(read('js/main.js'), /buildFreedomArches\?\.\(scene\)/);
});
