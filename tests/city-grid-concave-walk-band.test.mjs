// city-grid.js fixed sidewalk band on a concave curb island (st-sb3r.17 / st-sb3r.16 follow-up).
//
// Ward's Island Park (GEO block 2880) is one large concave island with no City sidewalk polygons. city-grid's fallback
// band was an ExtrudeGeometry of the island outline with its inward offset (prop) as a hole. For this island the offset
// self-intersects, so THREE's hole triangulation flooded the whole park with the walkway at SW_TOP — the GPU saw
// Walkways at 0.22 over Lawns at 0.218. The fix builds the band as per-edge quads when the annulus is not a simple,
// contained ring. This test uses the real committed block outline and proves both the defect and the fix.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const city = (() => {
  const C = { THREE, TSL, Addons: { mergeGeometries } };
  const ctx = {
    window: { CITY: C },
    console: { info() {}, log() {}, warn() {}, error() {} },
    performance, Date, Math, Buffer,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    URLSearchParams, location: { search: '' }
  };
  vm.createContext(ctx);
  for (const f of ['js/toronto-geodata.js', 'js/city-config.js', 'js/city-grid.js']) vm.runInContext(read(f), ctx, { filename: f });
  return ctx.window.CITY;
})();

const BLOCK = 2880;
const SW = city.GEO.frame.sidewalk;               // the fixed band width (4.6 m)
const SW_TOP = city.GEO.frame.sidewalkHeight ?? 0.22; // CITY_BOUNDS.sidewalkHeight (0.22 m: the walk top)
const pts = (() => {
  const flat = city.GEO.blocks[BLOCK][0];
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
})();
const inner = city.offsetPolygonInward(pts, 0.25);
const prop = city.offsetPolygonInward(pts, SW);

// A flat x/z point test against a geometry's upward-facing triangles near a given height.
function topGeometryCovers(g, x, z, y = SW_TOP) {
  let geo = g.index ? g.toNonIndexed() : g;
  const p = geo.attributes.position.array, n = geo.attributes.normal ? geo.attributes.normal.array : null;
  for (let i = 0; i < p.length; i += 9) {
    const ny = n ? (n[i + 1] + n[i + 4] + n[i + 7]) / 3 : 1;
    if (ny < 0.9) continue;
    if (Math.abs((p[i + 1] + p[i + 4] + p[i + 7]) / 3 - y) > 0.03) continue;
    const ax = p[i], az = p[i + 2], bx = p[i + 3], bz = p[i + 5], cx = p[i + 6], cz = p[i + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    if (u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9) return true;
  }
  return false;
}

function oldExtrudedBand() {
  const shape = city.createWorldXZShape(inner);
  shape.holes.push(new THREE.Path(prop.map((p) => new THREE.Vector2(p.x, -p.z))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: SW_TOP - 0.03, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.03, 0);
  return g;
}

test('the real Ward\'s Island Park block (2880) is the concave case: its inward offset self-intersects', () => {
  assert.ok(inner && prop, 'both offsets exist');
  assert.equal(prop.length, inner.length);
  assert.equal(city.ringSelfIntersects(prop), true, 'the prop outline crosses itself');
  assert.equal(city.annulusSafeXZ(inner, prop), false, 'the extruded-hole annulus is not safe here');
});

test('the old extruded hole floods the park with walkway; the edge-quad band does not', () => {
  const park = [[1750, 2250], [1700, 2200], [1800, 2200], [1600, 2250]];
  const old = oldExtrudedBand();
  for (const [x, z] of park) assert.equal(topGeometryCovers(old, x, z), true, `old band floods ${x},${z}`);

  const band = city.walkBandGeometryXZ(inner, prop, 0.03, SW_TOP);
  assert.ok(band && band.attributes.position.count > 0);
  for (const [x, z] of park) assert.equal(topGeometryCovers(band, x, z), false, `new band leaves ${x},${z} as lawn`);

  // The curb band itself is preserved: the midpoint between the inner outline and its offset is covered all round.
  let covered = 0;
  for (let i = 0; i < inner.length; i++) {
    const x = (inner[i].x + prop[i].x) / 2, z = (inner[i].z + prop[i].z) / 2;
    if (topGeometryCovers(band, x, z)) covered++;
  }
  assert.ok(covered >= inner.length - 2, `${covered}/${inner.length} band edge midpoints covered`);
});

test('a simple rectangular island keeps the original safe path (guarded fix, not a blanket rewrite)', () => {
  const sq = (s) => [{ x: 0, z: 0 }, { x: s, z: 0 }, { x: s, z: s }, { x: 0, z: s }];
  const i2 = city.offsetPolygonInward(sq(40), 0.25);
  const p2 = city.offsetPolygonInward(sq(40), SW);
  assert.equal(city.ringSelfIntersects(p2), false);
  assert.equal(city.annulusSafeXZ(i2, p2), true, 'an ordinary rectangular block still uses the extruded annulus');
});