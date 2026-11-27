// jf-ugq (docs/front-yards.md): the front yards: the lidar's hedges and shrubs decode where they stand, every Rosedale house plans a yard of finite triangles, the lidar's hedges are drawn
// where the lidar found them, the rule's fences differ from house to house and are the same on every plan, and the vertex layout matches what js/front-yard-material.js reads
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import { mergeRosedaleHouses, decodeHouses } from '../js/rosedale-houses.js';
import { planYard, rosedaleYardStyle, KIND, YARD_STYLES } from '../js/front-yards.js';
import { makeFrame, stream } from '../js/building-draw-kit.js';
import * as Draw from '../js/building-draw.js';

const file = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
const lin = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const load = async () => {
  const { GEO } = await unpackGeo(file('data/frames/eglinton/toronto-geodata.bin'));
  const { ROSEDALE_HOUSES: H } = await unpackGeo(file('data/frames/eglinton/rosedale-houses.bin'));
  const { MASSING } = await unpackGeo(file('data/toronto-massing.bin'));
  const massing = massingRows(MASSING, GEO);
  const out = mergeRosedaleHouses(massing, GEO.buildings, H);
  return { GEO, H, out, recs: [...massing.rows.values()].filter((r) => r.rosedale) };
};
const newA = () => ({ pos: [], nor: [], uv: [], col: [], aux: [] });

test('the lidar hedges and shrubs decode: points, widths, heights, canopy', async () => {
  const { GEO, H } = await load();
  const d = decodeHouses(H, GEO.buildings).houses;
  const withHedges = d.filter((h) => h.veg && h.veg.hedges.length);
  assert.ok(withHedges.length > 1500, `${withHedges.length} houses with a hedge`);
  const metres = withHedges.reduce((s, h) => s + h.veg.hedges.reduce((t, q) => t + q.pts.slice(1).reduce((u, p, i) => u + Math.hypot(p[0] - q.pts[i][0], p[1] - q.pts[i][1]), 0), 0), 0);
  assert.ok(metres > 10000, `${Math.round(metres)} m of hedge`);
  for (const h of withHedges) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of h.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (const q of h.veg.hedges) {
      assert.ok(q.pts.length >= 2 && q.w >= 0.5 && q.w <= 3.3 && q.h >= 0.6 && q.h <= 4.3, JSON.stringify(q));
      // in the lot: within 110 m of the house
      for (const [x, z] of q.pts) assert.ok(x > x0 - 110 && x < x1 + 110 && z > z0 - 110 && z < z1 + 110, `${h.fid}: ${x}, ${z}`);
    }
    for (const s of h.veg.shrubs) assert.ok(s.r > 0.2 && s.r <= 2.6 && s.h >= 0.5 && s.h <= 4.3, JSON.stringify(s));
    assert.ok(h.veg.canopy === -1 || (h.veg.canopy >= 0 && h.veg.canopy <= 1));
  }
  assert.ok(d.reduce((s, h) => s + (h.veg ? h.veg.shrubs.length : 0), 0) > 8000, 'shrub masses');
});

test('every Rosedale house plans a yard of finite triangles in the layout the material reads, the same on every plan', async () => {
  const { recs } = await load();
  const total = { houses: 0, yards: 0, tris: 0, lidarHedges: 0, lidarShrubs: 0, fences: {}, beds: 0, lawn: 0, trees: 0, lamps: 0, kinds: new Set(), maxTris: 0 };
  const show = () => JSON.stringify({ ...total, kinds: [...total.kinds] });
  for (const rec of recs.filter((r) => r.rosedale.house)) {
    const ring = rec.rings[0], n = ring.length;
    let best = -1, bl = 0;
    const edges = ring.map((a, i) => {
      const b = ring[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), street = rec.street.has(i);
      if (street && len > bl) { bl = len; best = i; }
      return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: rec.hidden.has(i) ? -1 : rec.covered.has(i) ? Draw.WALL.lotLine : Draw.WALL.rear, street };
    });
    if (best < 0) continue;
    edges[best].kind = Draw.WALL.entry;
    total.houses++;
    const inp = { preset: rec.preset, id: rec.id, groupId: rec.id, dwellings: rec.drawFacts.dwellings, ring, edges, covered: rec.covered, y0: 0, lin, roadDist: () => 14, nearRoad: null, hint: rec.rosedale.hint,
      yard: { lotW: rec.rosedale.lotW, park: rec.rosedale.park, style: rosedaleYardStyle(rec.rosedale), canopy: rec.rosedale.veg ? rec.rosedale.veg.canopy : -1, veg: rec.rosedale.veg } };
    const plan = Draw.planHouse(inp);
    if (!plan.ok || !plan.pushYard) continue;
    total.yards++;
    const A = newA();
    const tris = plan.pushYard(A);
    assert.ok(A.pos.length === tris * 9 && A.nor.length === tris * 9 && A.col.length === tris * 9 && A.uv.length === tris * 6 && A.aux.length === tris * 6, `${rec.id}: layout`);
    assert.ok(A.pos.every(Number.isFinite) && A.nor.every(Number.isFinite) && A.col.every(Number.isFinite) && A.aux.every(Number.isFinite), `${rec.id}: finite`);
    for (let i = 0; i < A.uv.length; i += 2) { total.kinds.add(A.uv[i]); assert.ok(Number.isInteger(A.uv[i]) && A.uv[i] >= 0 && A.uv[i] <= 11 && A.uv[i + 1] >= 0 && A.uv[i + 1] <= 1, `${rec.id}: kind ${A.uv[i]} rnd ${A.uv[i + 1]}`); }
    // the same on every plan
    const B = newA(); Draw.planHouse(inp).pushYard(B);
    assert.deepEqual(B.pos, A.pos, `${rec.id}: a yard is the same on every load`);
    const st = plan.yardStats;
    total.tris += tris; total.maxTris = Math.max(total.maxTris, tris);
    for (const k of ['lidarHedges', 'lidarShrubs', 'beds', 'lawn', 'trees', 'lamps']) total[k] += st[k];
    if (st.fence) total.fences[st.fence] = (total.fences[st.fence] || 0) + 1;
  }
  assert.ok(total.yards > total.houses * 0.9, show());
  assert.ok(total.lidarHedges > 300 && total.lidarShrubs > 1500, `the lidar's hedges and shrubs are drawn: ${show()}`);
  for (const f of ['stone', 'iron', 'picket', 'brick', 'hedge']) assert.ok(total.fences[f] > 20, `${f}: ${JSON.stringify(total.fences)}`);
  assert.ok(total.beds > total.yards * 0.4 && total.lawn > total.yards * 0.6 && total.trees > 20 && total.lamps > 20, show());
  for (const k of [KIND.solid, KIND.evergreen, KIND.deciduous, KIND.lawn, KIND.bed, KIND.iron, KIND.picket, KIND.cardEv, KIND.cardDec, KIND.twig, KIND.needle]) assert.ok(total.kinds.has(k), `kind ${k} is drawn`);
  console.log(`yard triangles: ${(total.tris / total.yards).toFixed(0)} a yard, at most ${total.maxTris}`);
  assert.ok(total.tris / total.yards < 700 && total.maxTris < 3200, `${(total.tris / total.yards).toFixed(0)} triangles a yard, at most ${total.maxTris}`);
});

// a plain yard on a flat lot, in the house's frame
const frame = () => makeFrame([0, 0], [12, 0]); // (the front edge runs along +x; out is -z... the frame's `out` is what the street is on)
const ctxFor = (id, over = {}) => ({ F: frame(), id, y0: 0, u0: 0, u1: 10, partyL: false, partyR: false, yd: 7, lotW: 14, gap: [4.3, 5.7], avoid: [[4.2, 5.8]], drive: null, style: 'rosedale', canopy: 0.1, veg: null, lin, ...over });

test('the lidar hedge along the lot line is drawn there and replaces the rule, cut at the walk', () => {
  const F = frame();
  // a hedge along the lot line, 1.1 m wide, 1.8 m high, from one side of the lot to the other, in world coordinates
  const worldPts = [[-2, -7], [12, -7]].map(([u, v]) => { const p = F.xz(u, v); return p; });
  const veg = { hedges: [{ w: 1.1, h: 1.8, pts: worldPts }], shrubs: [] };
  const p = planYard(ctxFor('to-3dmassing-2025:1', { veg }));
  const A = newA(); p.push(A);
  assert.equal(p.stats.lidarHedges, 1);
  assert.ok(p.stats.fence === null || p.stats.fence === 'iron', `the lidar's hedge is the lot line: ${p.stats.fence}`);
  // foliage vertices of kind 1 or 2 reach 1.8 m, and none stands in the walk's gap (u 4.3 to 5.7) along the lot line
  let top = 0, inGap = 0;
  for (let i = 0; i < A.uv.length / 2; i++) {
    const k = A.uv[i * 2];
    if (k !== KIND.evergreen && k !== KIND.deciduous) continue;
    const y = A.pos[i * 3 + 1]; top = Math.max(top, y);
    const [u, v] = F.uv(A.pos[i * 3], A.pos[i * 3 + 2]);
    if (Math.abs(v + 7) < 0.3 && u > 4.5 && u < 5.5) inGap++;
  }
  assert.ok(Math.abs(top - 1.8 * 1.0) < 0.2 && top <= 1.8 * 1.04 + 1e-6, `top ${top}`);
  assert.equal(inGap, 0, 'the hedge stops at the walk');
});

test('neighbours differ: the rule gives each house its own line, and the neighbourhood sets the odds', () => {
  const lines = {};
  for (let i = 0; i < 400; i++) {
    const p = planYard(ctxFor(`to-3dmassing-2025:${100000 + i}`));
    const A = newA(); p.push(A);
    const k = p.stats.fence || 'none'; lines[k] = (lines[k] || 0) + 1;
  }
  for (const f of ['hedge', 'stone', 'iron', 'none']) assert.ok(lines[f] > 20, JSON.stringify(lines));
  // Annex-style yards are more often wrought iron than Rosedale's
  const share = (style, kind) => { let c = 0; for (let i = 0; i < 400; i++) { const p = planYard(ctxFor(`to-3dmassing-2025:${200000 + i}`, { style, lotW: 8 })); p.push(newA()); if (p.stats.fence === kind) c++; } return c; };
  assert.ok(share('annex', 'iron') > share('rosedale', 'iron'), 'the Annex has more wrought iron');
  assert.ok(share('eastEnd', 'picket') > share('rosedale', 'picket') * 3, 'Leslieville and Riverdale have more pickets');
  assert.ok(share('rosedale', 'stone') > share('eastEnd', 'stone') * 3, 'Rosedale has more stone walls');
  for (const s of Object.values(YARD_STYLES)) assert.equal(s.line.length, 7);
});

test('a yard too shallow for a fence has none, and a house with no room has no lawn', () => {
  const p = planYard(ctxFor('to-3dmassing-2025:7', { yd: 1.9 }));
  const A = newA(); p.push(A);
  assert.equal(p.stats.fence, null);
  assert.equal(p.stats.lawn, 0);
  assert.ok(stream('x', 'y')() >= 0);
});

test('winter, summer: the material reads the layout the writer makes (kinds 0 to 7, aux, color)', () => {
  const src = fs.readFileSync(new URL('../js/front-yard-material.js', import.meta.url), 'utf8');
  for (const w of ["attribute('uv', 'vec2')", "attribute('aux', 'vec2')", "attribute('color', 'vec3')", 'uSnow', 'uLeaf', 'uAutumn', 'uSpring', 'seasonalGrass', 'leafStays']) assert.ok(src.includes(w), w);
});

test('a neighbourhood name picks its yard style', async () => {
  const { yardStyleOfPlace } = await import('../js/front-yards.js');
  assert.equal(yardStyleOfPlace('Rosedale-Moore Park'), 'rosedale');
  assert.equal(yardStyleOfPlace('The Annex'), 'annex');
  assert.equal(yardStyleOfPlace('Cabbagetown'), 'cabbagetown');
  assert.equal(yardStyleOfPlace('Leslieville'), 'eastEnd');
  assert.equal(yardStyleOfPlace('North Riverdale'), 'eastEnd');
  assert.equal(yardStyleOfPlace('The Beaches'), 'beaches');
  assert.equal(yardStyleOfPlace('Leaside'), 'postwar');
  assert.equal(yardStyleOfPlace('Liberty Village'), 'city');
  assert.equal(yardStyleOfPlace(undefined), 'city');
});

// jf-aru: the lawn and bed rectangles carry their half sizes in color and the metres from their centre in aux (the material feathers the edge from them); normals are unit length;
// a bare-able shrub has stems, a hedge has leaf cards, a small tree is cards on branches (no cone)
test('lawn and bed rectangles, leafy hedges and shrubs, small trees: the layout the polished material reads', () => {
  const kindsOf = (A) => { const m = {}; for (let i = 0; i < A.uv.length; i += 2) m[A.uv[i]] = (m[A.uv[i]] || 0) + 1; return m; };
  let sawLawn = 0, sawBed = 0, sawCard = 0, sawTwig = 0, sawNeedle = 0;
  for (let n = 0; n < 60; n++) {
    const p = planYard(ctxFor(`to-3dmassing-2025:${900 + n}`, { yd: 8, style: 'rosedale' }));
    const A = newA(); const tris = p.push(A);
    for (let t = 0; t < tris; t++) {
      for (let v = 0; v < 3; v++) { const i = t * 3 + v, nx = A.nor[i * 3], ny = A.nor[i * 3 + 1], nz = A.nor[i * 3 + 2]; assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-3, 'unit normal'); }
      const k = A.uv[t * 6];
      if (k === KIND.lawn || k === KIND.bed) {
        const hw = A.col[t * 9], hh = A.col[t * 9 + 1];
        assert.ok(hw > 0.1 && hh > 0.1, 'half sizes in color');
        for (let v = 0; v < 3; v++) assert.ok(Math.abs(A.aux[t * 6 + v * 2]) <= hw + 1e-6 && Math.abs(A.aux[t * 6 + v * 2 + 1]) <= hh + 1e-6, 'aux within the rectangle');
        if (k === KIND.lawn) sawLawn++; else sawBed++;
      }
      if (k === KIND.cardEv || k === KIND.cardDec) { sawCard++; for (let v = 0; v < 3; v++) { const s = A.aux[t * 6 + v * 2], u = A.aux[t * 6 + v * 2 + 1]; assert.ok(s >= 0 && s <= 1 && u >= 0 && u <= 1, 'card st in 0..1'); } }
      if (k === KIND.twig) sawTwig++;
      if (k === KIND.needle) sawNeedle++;
    }
    void kindsOf;
  }
  assert.ok(sawLawn > 0 && sawBed > 0 && sawCard > 0 && sawTwig > 0, JSON.stringify({ sawLawn, sawBed, sawCard, sawTwig, sawNeedle }));
});
