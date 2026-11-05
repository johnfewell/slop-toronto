// The street furniture's placement checks look things up in grids (js/street-props.js boundsGrid, st-bz1o.2) instead of
// scanning every collider and prop of the map. The grid must answer exactly what the scan answers: for random colliders
// (circles and turned boxes, some huge, some without bounds) and random candidates, and for random points and sites.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = (f) => fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
const context = vm.createContext({ window: { CITY: { THREE: {}, GEO: {}, CITY_BOUNDS: { sidewalkHeight: 0.22 }, nearestRoads: () => [], blockAt: () => null } }, console });
for (const f of ['world-collision', 'street-props']) vm.runInContext(read(f), context);
const { WorldCollision: W, streetPropGrid: G } = context.window.CITY;

let seed = 6711;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const span = (a) => -a + 2 * a * rand();

test('the collider grid finds a contact exactly when a scan of every collider does', () => {
  const colliders = [];
  for (let i = 0; i < 4000; i++) {
    const x = span(600), z = span(600), k = rand();
    if (k < 0.45) colliders.push(W.circleCollider(x, z, 0.1 + rand() * 1.5, 0, 1 + rand() * 3));
    else if (k < 0.97) colliders.push(W.boxCollider(x, z, 0.2 + rand() * 30, 0.2 + rand() * 8, rand() * Math.PI, rand() < 0.2 ? 1 : 0, 2 + rand() * 20));
    else colliders.push(W.boxCollider(x, z, 900 + rand() * 900, 1 + rand() * 4, rand() * Math.PI, 0, 5)); // spans thousands of cells
  }
  colliders.push({ ...W.circleCollider(5, 5, 1, 0, 2), minX: undefined }); // no usable bounds: every query tests it
  const grid = G.boundsGrid(colliders, (c) => [c.minX, c.maxX, c.minZ, c.maxZ]);
  let hits = 0;
  for (let n = 0; n < 20000; n++) {
    const x = span(650), z = span(650), shape = W.circleShape(x, z, 0.35), ground = 0.22, height = rand() < 0.5 ? 1.8288 : 2.7;
    const test = (c) => (c.maxY ?? Infinity) > ground + 0.05 && (c.minY ?? -Infinity) < ground + height && !!W.contact(shape, c);
    const scan = colliders.some(test), fast = grid.some(shape.minX, shape.maxX, shape.minZ, shape.maxZ, test);
    assert.equal(fast, scan, `candidate ${x}, ${z}`);
    if (scan) hits++;
  }
  assert.ok(hits > 1000 && hits < 19000, `${hits} of 20000 candidates touch a collider: both answers exercised`);
});

test('the point and site grids find a neighbour within r exactly when a scan does', () => {
  const pts = [];
  for (let i = 0; i < 6000; i++) pts.push(span(300), span(300));
  pts.push(16, 16, -16, 0, 0, -32); // on cell edges
  const sites = Array.from({ length: 3000 }, () => ({ x: span(300), z: span(300) }));
  const pg = G.pointGrid(pts), sg = G.siteGrid(sites);
  for (let n = 0; n < 20000; n++) {
    const x = n < 6 ? [16, -16, 0, 15.9, 16.01, -31.99][n] : span(310), z = n < 6 ? [16.5, 0.2, -31.5, 16, 15.99, 0] : span(310);
    const r = [0.8, 3, 0.75, 1.3, 0.7][n % 5];
    let scan = false;
    for (let i = 0; i < pts.length && !scan; i += 2) scan = Math.hypot(pts[i] - x, pts[i + 1] - z) < r;
    assert.equal(pg.some(x - r, x + r, z - r, z + r, (i) => Math.hypot(pts[i] - x, pts[i + 1] - z) < r), scan, `point ${x}, ${z}, r ${r}`);
    assert.equal(G.nearSite(sg, x, z, r), sites.some((s) => Math.hypot(s.x - x, s.z - z) < r), `site ${x}, ${z}, r ${r}`);
  }
});
