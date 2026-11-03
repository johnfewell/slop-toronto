// Ponds on the curb islands (st-ejsz, st-us0w): city-grid.js cuts every pond out of the island it lies on (the kerb's
// top, the yard, the small parks), so the water it draws under them shows. High Park is one island, and its lawn hid
// Grenadier Pond and the rest of the park's ponds.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
const context = vm.createContext({ window: { CITY: {} } });
for (const path of ['js/toronto-geodata.js', 'js/city-config.js']) vm.runInContext(read(path), context);
const { BLOCKS, POND_BODIES, CITY_BOUNDS: B, pondOnPolygon, pondsOnIsland, subtractConvexXZ, blockAt, pointInPoly } = context.window.CITY;

test('st-us0w: High Park\'s ponds are drawn ponds, each wholly inside the park\'s island, which cuts them out', () => {
  const names = ['Grenadier Pond', 'Wendigo Pond', 'Upper Duck Pond', 'Lower Duck Pond', 'Howard Pond', 'Ridout Pond'];
  for (const name of names) {
    const pond = POND_BODIES.find((w) => w.name === name);
    assert.ok(pond, `${name} is drawn as a pond`);
    const c = pond.pts.reduce((s, p) => ({ x: s.x + p.x / pond.pts.length, z: s.z + p.z / pond.pts.length }), { x: 0, z: 0 });
    // (a point inside the pond: its outline's first vertex nudged toward the centre until inside)
    let x = c.x, z = c.z;
    for (let t = 0; t <= 1 && !pointInPoly(pond.pts, x, z); t += 0.05) { x = pond.pts[0].x + (c.x - pond.pts[0].x) * t; z = pond.pts[0].z + (c.z - pond.pts[0].z) * t; }
    const b = blockAt(x, z);
    assert.ok(b && b.park > 0.5, `${name} lies on a park island`);
    const on = pondsOnIsland(b).find((p) => p.pond === pond);
    assert.ok(on, `the island cuts ${name} out`);
    assert.equal(on.on, 'inside', `${name} is a hole in the island`);
  }
  // Grenadier Pond is big: about 18 ha in the 4 m sampling
  const g = POND_BODIES.find((w) => w.name === 'Grenadier Pond');
  let wet = 0;
  for (let x = g.minX; x <= g.maxX; x += 4) for (let z = g.minZ; z <= g.maxZ; z += 4) if (pointInPoly(g.pts, x, z)) wet++;
  assert.ok(wet * 16 > 150000, `Grenadier Pond ${(wet * 16 / 1e4).toFixed(1)} ha`);
});

test('st-ejsz: every point of a drawn pond that lies on a curb island is cut out of that island', () => {
  const missed = [];
  let onIslands = 0;
  const cut = new Map(); // island -> its ponds
  const pondsOf = (b) => cut.get(b) || cut.set(b, pondsOnIsland(b).map((p) => p.pond)).get(b);
  for (const pond of POND_BODIES) {
    const step = Math.max(2, Math.min(8, Math.sqrt((pond.maxX - pond.minX) * (pond.maxZ - pond.minZ)) / 12));
    for (let x = pond.minX + step / 2; x < pond.maxX; x += step) {
      for (let z = pond.minZ + step / 2; z < pond.maxZ; z += step) {
        if (!pointInPoly(pond.pts, x, z)) continue;
        const b = blockAt(x, z);
        if (!b) continue;
        onIslands++;
        if (!pondsOf(b).includes(pond)) missed.push(`${pond.name || 'pond'} ${x.toFixed(0)},${z.toFixed(0)}`);
      }
    }
  }
  assert.ok(onIslands > 5000, `sampled ${onIslands} pond points on islands`);
  assert.deepEqual(missed.slice(0, 10), [], `${missed.length} pond points on an island that keeps them covered`);
});

test('st-ejsz: a pond is inside, across or apart from a polygon', () => {
  const sq = (x0, z0, s) => [{ x: x0, z: z0 }, { x: x0 + s, z: z0 }, { x: x0 + s, z: z0 + s }, { x: x0, z: z0 + s }];
  const pond = (x0, z0, s) => { const pts = sq(x0, z0, s); return { pts, minX: x0, maxX: x0 + s, minZ: z0, maxZ: z0 + s }; };
  assert.equal(pondOnPolygon(sq(0, 0, 100), pond(10, 10, 20)), 'inside');
  assert.equal(pondOnPolygon(sq(0, 0, 100), pond(90, 10, 20)), 'cross');
  assert.equal(pondOnPolygon(sq(0, 0, 100), pond(-10, -10, 200)), 'cross'); // (the pond holds the polygon whole)
  assert.equal(pondOnPolygon(sq(0, 0, 100), pond(150, 10, 20)), null);
  assert.ok(POND_BODIES.every((w) => w.pts.every((p) => p.x > B.minX && p.x < B.maxX && p.z > B.minZ && p.z < B.maxZ)));
  assert.ok(BLOCKS.length > 1000);
});

test('st-ejsz: a convex piece less a convex pond triangle keeps exactly the area outside it', () => {
  const area = (q) => { let s = 0; for (let i = 0; i < q.length; i++) { const r = q[(i + 1) % q.length]; s += q[i][0] * r[1] - r[0] * q[i][1]; } return s / 2; };
  const clip = (a, b) => { // a ∩ b, both convex & positive
    let out = a;
    for (let e = 0; e < b.length && out.length; e++) {
      const [px, pz] = b[e], [qx, qz] = b[(e + 1) % b.length], side = (p) => (qx - px) * (p[1] - pz) - (qz - pz) * (p[0] - px);
      const inp = out; out = [];
      for (let i = 0; i < inp.length; i++) {
        const u = inp[i], v = inp[(i + 1) % inp.length], su = side(u), sv = side(v);
        if (su >= 0) out.push(u);
        if ((su >= 0) !== (sv >= 0)) { const t = su / (su - sv); out.push([u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t]); }
      }
    }
    return out.length >= 3 ? out : [];
  };
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 40 - 20;
  for (let k = 0; k < 200; k++) {
    let a = [[rnd(), rnd()], [rnd(), rnd()], [rnd(), rnd()]], b = [[rnd(), rnd()], [rnd(), rnd()], [rnd(), rnd()]];
    if (area(a) < 0) a = a.reverse();
    if (area(b) < 0) b = b.reverse();
    if (area(a) < 1 || area(b) < 1) continue;
    const pieces = subtractConvexXZ(a, b);
    const kept = pieces.reduce((s, p) => s + area(p), 0);
    assert.ok(pieces.every((p) => area(p) > 0), 'pieces keep the winding');
    assert.ok(Math.abs(kept + area(clip(a, b)) - area(a)) < 1e-6 * Math.max(1, area(a)), `case ${k}: ${kept} + ${area(clip(a, b))} = ${area(a)}`);
  }
});
