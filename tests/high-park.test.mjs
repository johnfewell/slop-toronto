// The High Park terrain pilot (on by default; docs/high-park-terrain.md): its datum and data, the ground it samples and
// draws, the park's edges held at the street level, each pond at its own level, the controllers, traffic, walkers and
// buildings on it, the SRTM canopy mounds gone, the city round its box the flat city's, and the Don Valley's pilot
// unchanged beside it
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
function city({ highPark = true, donValley = false, files = [] } = {}) {
  const context = vm.createContext({ window: { CITY: { THREE, Addons: { mergeGeometries }, DEBUG_ROADS: false }, addEventListener() {} }, document: { addEventListener() {}, hidden: false },
    console: { info() {}, warn() {}, log() {} }, atob });
  const pilot = [...(donValley ? ['don-valley-data'] : []), ...(highPark ? ['high-park-data'] : []), ...(donValley || highPark ? ['don-valley'] : [])];
  for (const f of ['toronto-geodata', 'toronto-subway', 'toronto-subway-topology', ...pilot, 'city-config', ...files]) vm.runInContext(read(f), context);
  return context.window.CITY;
}
// ON: the city as it loads (High Park on); FLAT: the flat city without the pilot (main before it shipped), the baseline
const ON = city(), FLAT = city({ highPark: false });
const HP = ON.DON_VALLEY, D = ON.HIGH_PARK_DATA;
const grid = (b64, scale) => { const b = Buffer.from(b64, 'base64'); return [...new Int16Array(b.buffer, b.byteOffset, b.length / 2)].map((v) => v / scale); };
const node = (arr, x, z) => arr[Math.round((z - D.box.z0) / D.box.step) * D.nx + Math.round((x - D.box.x0) / D.box.step)];
const at = (lat, lon) => ON.worldFromLatLon(lat, lon);
const rand = (() => { let s = 4111; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const insideBox = (x, z) => x > D.box.x0 && x < D.box.x1 && z > D.box.z0 && z < D.box.z1;
// the park's own roads and the streets round it
const roadPts = (C, name, step = 5) => {
  const out = [];
  for (const r of C.ROADS) {
    if (r.name !== name || r.raised) continue;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1, px = -(b.z - a.z) / L, pz = (b.x - a.x) / L;
      for (let k = 0; k < n; k++) { const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n; if (insideBox(x, z)) out.push({ x, z, px, pz, w: r.w }); }
    }
  }
  return out;
};

test('the pilot declares its source, frame and datum, keeps raw, datum and conditioned heights apart, and records its rules (TE-1)', () => {
  assert.equal(D.kind, 'high-park');
  assert.match(D.source.dataset, /Ontario Elevation Mapping Program, GTA 2023 lidar, Digital Terrain Model \(bare earth\)/);
  assert.match(D.source.licence, /Open Government Licence – Ontario/);
  assert.equal(D.source.resolutionM, 0.5);
  assert.ok(D.source.tiles.length >= 4 && D.source.tiles.every((t) => /^[0-9a-f]{64}$/.test(t.sha256)), 'each tile named with its checksum');
  assert.match(D.crs.vertical, /CGVD2013/);
  assert.match(D.datum, /y = DTM - T/);
  assert.equal(D.box.step, 10);
  for (const k of ['height', 'raw', 'datumGrid', 'unconditioned']) assert.equal(grid(D[k], 1).length, D.nx * D.nz, k);
  for (const rule of ['park', 'datum', 'edge', 'shores', 'pads', 'roads', 'footing']) assert.ok(D.alterations[rule], `alteration ${rule} recorded`);
  // (the membrane converged)
  assert.ok(D.alterations.datum.residualM < 1e-3, `residual ${D.alterations.datum.residualM}`);
  // (aligned with js/terrain.js's near grid, 60 m from a multiple of 60, so its cells are either the pilot's or its own)
  for (const v of [D.box.x0, D.box.x1, D.box.z0, D.box.z1]) assert.equal(((v % 60) + 60) % 60, 0);
  // (the box is the park's, clear of the Don Valley's)
  const dv = ON.DON_VALLEY_DATA || { box: { x0: 1600, x1: 2800 } };
  assert.ok(D.box.x1 < dv.box.x0);
});

test('datum mapping: y = DTM - T in the park, 0 round it; Bloor (~112 m) and the Queensway (~77 m) both at the street level', () => {
  const raw = grid(D.raw, 10), datum = grid(D.datumGrid, 10), unc = grid(D.unconditioned, 100);
  // the real fall: Bloor Street at the park's north gate over the Queensway at its south gate
  const bloor = at(43.6537, -79.4652), queensway = at(43.6393, -79.4598);
  const rb = node(raw, bloor.x, bloor.z), rq = node(raw, queensway.x, queensway.z);
  assert.ok(rb > 109 && rb < 116, `Bloor at the gate ${rb} m above CGVD2013`);
  assert.ok(rq > 75 && rq < 80, `the Queensway at Colborne Lodge Drive ${rq} m`);
  // both are the street level in the game (the flat city): the datum is the DTM there
  for (const p of [bloor, queensway]) {
    assert.equal(HP.heightAt(p.x, p.z), 0);
    assert.ok(Math.abs(node(raw, p.x, p.z) - node(datum, p.x, p.z)) < 0.11, 'T is the DTM off the park');
  }
  // inside the park the game height is the DTM over the datum (decimetres and centimetres): the café on the plateau
  const cafe = at(43.64553, -79.46605), r = node(raw, cafe.x, cafe.z), t = node(datum, cafe.x, cafe.z), u = node(unc, cafe.x, cafe.z);
  assert.ok(r > 100 && r < 110, `the plateau at the café ${r} m`);
  assert.ok(Math.abs(u - (r - t)) < 0.15, `game height ${u} = DTM ${r} - datum ${t}`);
});

test('the park\'s relief: the plateau over the Queensway, the slope down to Grenadier Pond, the Spring Creek ravine', () => {
  const y = (lat, lon) => { const p = at(lat, lon); return HP.heightAt(p.x, p.z); };
  const cafe = y(43.64553, -79.46605), pool = y(43.64949, -79.4653), pond = y(43.643, -79.468), ravine = y(43.6465, -79.4592), colborne = y(43.64043, -79.46);
  assert.ok(cafe > 15 && pool > 10, `the plateau: café ${cafe.toFixed(1)} m, pool ${pool.toFixed(1)} m over the streets round the park`);
  // the slope down to the pond: 20-30 m in reality (the plateau at ~105 m, the pond 75.8 m); here 20 m or more over ~250 m
  assert.ok(cafe - pond > 20, `the café ${(cafe - pond).toFixed(1)} m over Grenadier Pond`);
  assert.ok(pond < -1, `Grenadier Pond under the Queensway: ${pond.toFixed(1)}`);
  // the ravine east of the plateau, its floor well under its rims
  assert.ok(ravine < 0 && pool - ravine > 15, `Spring Creek's ravine floor ${ravine.toFixed(1)} m`);
  // Colborne Lodge Drive climbs from the Queensway (0) towards the lodge on its hill
  assert.ok(colborne > 5, `Colborne Lodge ${colborne.toFixed(1)} m`);
  // the steepest ground: the west slope and the ravines' sides (the lidar's own 10 m cells reach 66% there; the datum's
  // own slope and the park roads' levelled corridors steepen a few cells beside them), not cliffs: under 100% (45°)
  let steepest = 0;
  for (let x = D.box.x0 + 5; x < D.box.x1; x += 10) for (let z = D.box.z0 + 5; z < D.box.z1; z += 10) {
    const [gx, gz] = HP.gradientAt(x, z);
    steepest = Math.max(steepest, Math.hypot(gx, gz));
  }
  assert.ok(steepest > 0.25 && steepest < 1, `steepest ${(steepest * 100).toFixed(0)}%`);
});

test('the edges: Bloor, Parkside, the Queensway and the neighbourhood streets stay at the street level, with a clean transition', () => {
  const ponds = ON.POND_BODIES.filter((w) => HP.pondLevel(w) !== null);
  const segD = (x, z, a, b) => { const ex = b.x - a.x, ez = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1))); return Math.hypot(a.x + ex * t - x, a.z + ez * t - z); };
  const nearPond = (x, z) => ponds.some((w) => x > w.minX - 30 && x < w.maxX + 30 && z > w.minZ - 30 && z < w.maxZ + 30 && w.pts.some((p, i) => segD(x, z, p, w.pts[(i + 1) % w.pts.length]) < 30));
  for (const name of ['Bloor Street West', 'Parkside Drive', 'The Queensway', 'Ellis Avenue', 'Ellis Park Road', 'Keele Street', 'Indian Road']) {
    // (where it runs round the park: a neighbourhood, not the park, on at least one side of it; Ellis Avenue's spur into
    // the houses on the ridge west of Grenadier Pond runs inside the park's island and follows its ground)
    const park = (x, z) => /High Park/.test(ON.blockAt(x, z)?.parkName || '');
    const P = roadPts(ON, name).filter((p) => !park(p.x + p.px * (p.w / 2 + 8), p.z + p.pz * (p.w / 2 + 8)) || !park(p.x - p.px * (p.w / 2 + 8), p.z - p.pz * (p.w / 2 + 8)));
    assert.ok(P.length > 5, `${name} in the box`);
    // the roadway exactly at the street level; its sidewalks (the park's within 4.6 m of its kerb: the relief is 0 for
    // 8 m in, but the 10 m grid's triangles reach a few metres further) within 0.35 m, where the ridge west of Grenadier
    // Pond rises 13 m within 50 m of Ellis Avenue, or where a pond lies just inside the kerb (Lower Duck Pond by the
    // Queensway, 2.2 m under it) within 0.7 m as they slope to it
    const half = Math.min(...ON.ROADS.filter((q) => q.name === name && !q.raised).map((q) => q.w / 2));
    let road = 0, walk = 0, byPond = 0;
    for (const p of P) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let o = 0; o <= half; o += 1) road = Math.max(road, Math.abs(HP.heightAt(p.x + dx * o, p.z + dz * o)));
      for (let o = half; o <= half + 4.6; o += 0.5) {
        const x = p.x + dx * o, z = p.z + dz * o, h = Math.abs(HP.heightAt(x, z));
        walk = Math.max(walk, nearPond(x, z) ? 0 : h);
        byPond = Math.max(byPond, nearPond(x, z) ? h : 0);
      }
    }
    // (within 5 cm: where a pond lies just over the street from its kerb, Catfish Pond by Ellis Avenue, the grid's
    // triangles reach a few centimetres onto the roadway)
    assert.ok(road < 0.05, `${name}: its roadway ${road.toFixed(3)} m off the street level`);
    assert.ok(walk < 0.35 && byPond < 0.7, `${name}: its sidewalks ${walk.toFixed(3)} m (${byPond.toFixed(2)} by a pond) off the street level`);
  }
  // nothing off the park changes: every node outside it is 0
  assert.equal(D.diagnostics.offParkMaxM, 0);
  // the transition: from the kerb the relief comes in over the edge band (8 to 45 m), no step. Where the park's own slopes
  // meet its edge (the ridge west of Grenadier Pond along Ellis Avenue, the Wendigo ravine's head under Bloor Street) the
  // band steepens them (and where the houses on the Wendigo ravine's rim by Bloor Street stay at the street level, the
  // ground falls into the ravine within the band): no more than twice the lidar's own slope there and 40%, never a cliff
  const raw = grid(D.raw, 10), rawSlope = (x, z) => {
    const c = Math.floor((x - D.box.x0) / D.box.step), r = Math.floor((z - D.box.z0) / D.box.step), k = r * D.nx + c;
    return Math.hypot((raw[k + 1] - raw[k]) / D.box.step, (raw[k + D.nx] - raw[k]) / D.box.step);
  };
  let edgeSteep = 0, n = 0, steep = 0, worstRatio = 0;
  for (let x = D.box.x0 + 5; x < D.box.x1; x += 10) for (let z = D.box.z0 + 5; z < D.box.z1; z += 10) {
    const h = HP.heightAt(x, z);
    if (h === 0) continue;
    const near = [[45, 0], [-45, 0], [0, 45], [0, -45]].some(([dx, dz]) => ON.cutAt(x + dx, z + dz) === 0 && HP.heightAt(x + dx, z + dz) === 0);
    if (!near) continue;
    n++;
    const g = Math.hypot(...HP.gradientAt(x, z));
    edgeSteep = Math.max(edgeSteep, g);
    if (g > 0.5) steep++;
    worstRatio = Math.max(worstRatio, g - (2 * rawSlope(x, z) + 0.4));
  }
  assert.ok(n > 300 && edgeSteep < 1, `${n} samples near the edge, steepest ${(edgeSteep * 100).toFixed(0)}%`);
  assert.ok(worstRatio <= 0, `steeper than twice the lidar's slope by ${worstRatio.toFixed(2)}`);
  assert.ok(steep < n * 0.03, `${steep} of ${n} over 50%`);
});

test('ponds: each at its own level, under every street by it, ponds side by side in their real order, shores down to the water', () => {
  const named = Object.fromEntries(D.ponds.filter((p) => p.name).map((p) => [p.name, p]));
  for (const n of ['Grenadier Pond', 'Wendigo Pond', 'Howard Pond', 'Ridout Pond', 'Upper Duck Pond', 'Lower Duck Pond']) assert.ok(named[n], `${n}`);
  const lv = (n) => named[n].level, water = (n) => D.diagnostics.ponds.find((p) => p.name === n).waterM;
  // their real levels (the lidar's hydro-flattened water): Grenadier ~75.8 m, the Duck Ponds ~76, Howard & Ridout ~86
  assert.ok(Math.abs(water('Grenadier Pond') - 75.8) < 0.6 && water('Howard Pond') > 84);
  // ponds side by side keep their real difference (water never higher downstream)
  for (const [up, down] of [['Wendigo Pond', 'Grenadier Pond'], ['Upper Duck Pond', 'Lower Duck Pond'], ['Howard Pond', 'Ridout Pond']]) {
    assert.ok(Math.abs((lv(up) - lv(down)) - (water(up) - water(down))) < 0.02, `${up} over ${down}`);
    assert.ok(lv(up) > lv(down));
  }
  // under the street level beside them (Grenadier Pond 0.7 m under the Queensway in reality, here at most a few metres)
  assert.ok(lv('Grenadier Pond') < -0.3 && lv('Grenadier Pond') > -4, `Grenadier Pond at ${lv('Grenadier Pond')}`);
  // every pond: the city's water body matched by pondLevel, its ground at its outline over its water (the lawn 0.22 m
  // over the ground: within a few cm to a metre or so), never under it
  for (const w of ON.POND_BODIES) {
    const l = HP.pondLevel(w);
    if (l === null) continue;
    let lo = Infinity, sum = 0, n = 0;
    for (const p of w.pts) { const g = HP.heightAt(p.x, p.z) + 0.22; lo = Math.min(lo, g); sum += g - l; n++; }
    assert.ok(lo >= l - 0.02, `${w.name || 'a pond'}: its shore ${lo.toFixed(2)} not under its water ${l.toFixed(2)}`);
    assert.ok(sum / n < 2.5, `${w.name || 'a pond'}: the shore on average ${(sum / n).toFixed(2)} m over the water`);
  }
  // the ponds off the pilot's box keep the flat city's level
  assert.equal(FLAT.DON_VALLEY, undefined);
  assert.ok(ON.POND_BODIES.filter((w) => !w.pts.some((p) => insideBox(p.x, p.z))).every((w) => HP.pondLevel(w) === null));
  assert.equal(ON.POND_BODIES.filter((w) => HP.pondLevel(w) !== null).length, D.ponds.length);
});

test('drawn and sampled agree: a draped mesh lies on heightAt to well under 3 cm, rising and falling (TE-2, TE-3)', () => {
  const root = new THREE.Group();
  const mesh = (name, geo) => { const m = new THREE.Mesh(geo); m.name = name; root.add(m); return m; };
  const plane = mesh('plane', new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2));
  const cafe = at(43.64553, -79.46605);
  mesh('island', new THREE.CircleGeometry(160, 24).rotateX(-Math.PI / 2).translate(cafe.x, 0.22, cafe.z));
  mesh('kerb', new THREE.BoxGeometry(400, 0.22, 0.3).translate(cafe.x, 0.11, cafe.z + 30));
  const stats = HP.drape(root);
  assert.equal(stats.meshes, 3);
  const check = (name, lift, faces) => {
    const o = root.getObjectByName(`${name}_HighPark`), P = o.geometry.attributes.position, N = o.geometry.attributes.normal;
    let worst = 0, n = 0, up = 0;
    // (its triangles, through its index: each piece's vertices once)
    const I = o.geometry.index, at = (j) => (I ? I.getX(j) : j), count = I ? I.count : P.count;
    for (let j = 0; j < count; j += 3) {
      const i0 = at(j), i1 = at(j + 1), i2 = at(j + 2);
      if (!faces(N.getY(i0))) continue;
      let w0 = rand(), w1 = rand();
      if (w0 + w1 > 1) { w0 = 1 - w0; w1 = 1 - w1; }
      const w2 = 1 - w0 - w1, f = (get) => get(i0) * w0 + get(i1) * w1 + get(i2) * w2;
      const x = f((k) => P.getX(k)), y = f((k) => P.getY(k)), z = f((k) => P.getZ(k));
      worst = Math.max(worst, Math.abs(y - lift - HP.heightAt(x, z))); n++;
      if (y > lift + 5) up++;
    }
    return { worst, n, up };
  };
  const a = check('plane', 0, () => true), b = check('island', 0.22, (ny) => ny > 0.5), c = check('kerb', 0.22, (ny) => ny > 0.5);
  assert.ok(a.n > 30000 && b.n > 500 && c.n > 50, `${a.n} + ${b.n} + ${c.n} samples`);
  assert.ok(a.worst < 0.001 && b.worst < 0.001 && c.worst < 0.001, `worst disagreement ${a.worst}, ${b.worst}, ${c.worst} m`);
  assert.ok(a.up > 1000 && b.up > 100, 'the plateau is drawn over the street level');
  // a wholly re-made mesh: the source drawn no more, its pieces drawn
  assert.equal(root.getObjectByName('island').visible, false);
  assert.equal(root.getObjectByName('island_HighPark').visible, true);
  // indexed: each piece's vertices once (a third fewer than a triangle soup)
  const pl = root.getObjectByName('plane_HighPark').geometry;
  assert.ok(pl.index && pl.attributes.position.count < pl.index.count * 0.8, `${pl.attributes.position.count} vertices for ${pl.index.count / 3} triangles`);
});

test('lawns are drawn by the grid\'s half cells, lit smoothly: a fan of thin triangles makes no more pieces than the cells it covers', () => {
  // an island's top as city-grid.js makes it: a many-sided polygon triangulated as a fan of long thin triangles
  const cafe = at(43.64553, -79.46605), root = new THREE.Group();
  const shape = new THREE.Shape();
  for (let i = 0; i < 120; i++) { const a = (i / 120) * Math.PI * 2, r = 260 + 40 * Math.sin(5 * a); (i ? shape.lineTo.bind(shape) : shape.moveTo.bind(shape))(cafe.x + Math.cos(a) * r, -(cafe.z + Math.sin(a) * r)); }
  const geo = new THREE.ShapeGeometry(shape, 1).rotateX(-Math.PI / 2).translate(0, 0.22, 0);
  const m = new THREE.Mesh(geo); m.name = 'lawn'; root.add(m);
  const stats = HP.drape(root);
  const o = root.getObjectByName('lawn_HighPark').geometry, P = o.attributes.position, N = o.attributes.normal, I = o.index;
  const area = Math.PI * (260 ** 2 + 40 ** 2 / 2), cells = area / 50;
  // whole half cells inside, pieces only along the outline: one triangle per half cell inside, not the fan's several
  // (this lawn: 6,956 triangles and 7,820 vertices, against 12,646 and 24,263 cut piece by piece)
  assert.ok(stats.merged > cells * 0.9, `${stats.merged} whole half cells of ~${Math.round(cells)}`);
  assert.ok(I.count / 3 < cells * 1.75, `${I.count / 3} triangles for ~${Math.round(cells)} half cells`);
  assert.ok(P.count < I.count / 3 * 1.2, `${P.count} vertices: the half cells share their corners`);
  // still exactly on heightAt (0.22 over it)
  let worst = 0;
  for (let j = 0; j < I.count; j += 3) {
    const [a, b, c] = [I.getX(j), I.getX(j + 1), I.getX(j + 2)], x = (P.getX(a) + P.getX(b) + P.getX(c)) / 3, z = (P.getZ(a) + P.getZ(b) + P.getZ(c)) / 3, y = (P.getY(a) + P.getY(b) + P.getY(c)) / 3;
    worst = Math.max(worst, Math.abs(y - 0.22 - HP.heightAt(x, z)));
  }
  assert.ok(worst < 1e-3, `on the surface within ${worst}`);
  // smooth light: every vertex's normal is the surface's smooth slope where it stands, the same for every vertex at one
  // place (no facets: a 10 m triangle's own slope would differ from its neighbour's)
  const at2 = new Map();
  let off = 0, seams = 0;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), z = P.getZ(i);
    const k = `${x.toFixed(2)},${z.toFixed(2)}`, prev = at2.get(k);
    if (prev) seams = Math.max(seams, Math.abs(prev[0] - N.getX(i)) + Math.abs(prev[1] - N.getZ(i))); else at2.set(k, [N.getX(i), N.getZ(i)]);
    const l = Math.hypot(N.getX(i), N.getY(i), N.getZ(i));
    off = Math.max(off, Math.abs(l - 1));
  }
  assert.ok(seams < 1e-3 && off < 1e-4, `normals one per place (${seams}), unit (${off})`);
  // a layer under it (the street level under a curb island's lawn, 0.22 m down) is not drawn where the lawn covers it
  const root2 = new THREE.Group(), lawn = new THREE.Mesh(new THREE.ShapeGeometry(shape, 1).rotateX(-Math.PI / 2).translate(0, 0.22, 0)), street = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2).translate(cafe.x, 0, cafe.z));
  lawn.name = 'lawn'; street.name = 'street'; root2.add(street, lawn);
  const st2 = HP.drape(root2), sp = root2.getObjectByName('street_HighPark').geometry;
  assert.ok(st2.hidden > cells * 0.9, `${st2.hidden} half cells of the street level under the lawn left out`);
  let under = 0;
  for (let j = 0; j < sp.index.count; j += 3) {
    const [a, b, c] = [sp.index.getX(j), sp.index.getX(j + 1), sp.index.getX(j + 2)], x = (sp.attributes.position.getX(a) + sp.attributes.position.getX(b) + sp.attributes.position.getX(c)) / 3, z = (sp.attributes.position.getZ(a) + sp.attributes.position.getZ(b) + sp.attributes.position.getZ(c)) / 3;
    if (Math.hypot(x - cafe.x, z - cafe.z) < 180) under++;
  }
  assert.equal(under, 0, 'nothing of the street level drawn well inside the lawn');
});

test('the Ellis Avenue bluff: the houses step up from the street to its top, 10-20 m over Grenadier Pond; Catfish Pond at its own level', () => {
  const grenadier = D.ponds.find((p) => p.name === 'Grenadier Pond').level;
  // the bluff's top along the strip (the lidar: the houses' ridge 96-100 m, the pond 75.8 m) stands 10-20 m over the water
  for (const [x, z] of [[-7000, -2100], [-7000, -1900], [-6960, -1700]]) {
    const top = Math.max(...[-30, -20, -10, 0, 10, 20, 30].map((dx) => HP.heightAt(x + dx, z)));
    assert.ok(top - grenadier > 10 && top - grenadier < 21, `the bluff at z ${z}: ${(top - grenadier).toFixed(1)} m over the pond`);
  }
  // its houses on it, on plinths where the ground falls away
  const houses = D.buildings.filter(([x, z]) => x < -6900 && z > -2200 && z < -1600);
  assert.ok(houses.length > 30 && houses.some(([, , base]) => base > 8), `${houses.length} houses on the strip`);
  // Ellis Avenue itself and the streets west of it: the street level (the edges test holds the roadway)
  const ellis = roadPts(ON, 'Ellis Avenue').concat(roadPts(ON, 'Ellis Park Road')).filter((p) => p.z > -2300 && p.z < -1300);
  assert.ok(ellis.length > 20 && ellis.every((p) => Math.abs(HP.heightAt(p.x, p.z)) < 0.05), 'Ellis Avenue at the street level beside them');
  // Catfish Pond (OpenStreetMap's West Pond, two parts) at its own level, as far over Grenadier Pond as in reality
  const west = D.ponds.filter((p) => p.name === 'West Pond');
  assert.equal(west.length, 2);
  for (const p of west) {
    const real = D.diagnostics.ponds.find((q) => q.name === 'West Pond' && Math.abs(q.level - p.level) < 1e-6).waterM - D.diagnostics.ponds.find((q) => q.name === 'Grenadier Pond').waterM;
    assert.ok(Math.abs(p.level - grenadier - real) < 0.02 && p.level < 0, `West Pond at ${p.level}`);
  }
  assert.equal(ON.POND_BODIES.filter((w) => w.name === 'West Pond' && HP.pondLevel(w) !== null).length, 2);
});

test('both pilots at once: one runtime, each surface in its own box, the Don Valley\'s unchanged', () => {
  const BOTH = city({ donValley: true }), DVONLY = city({ highPark: false, donValley: true });
  const T = BOTH.DON_VALLEY;
  assert.deepEqual([...T.regions], ['don-valley', 'high-park']);
  const cafe = at(43.64553, -79.46605);
  assert.equal(T.heightAt(cafe.x, cafe.z), HP.heightAt(cafe.x, cafe.z));
  for (const [x, z] of [[2280, -2800], [2205, -2650], [2240, -2803], [1700, -2600]]) {
    assert.equal(T.heightAt(x, z), DVONLY.DON_VALLEY.heightAt(x, z));
    assert.equal(T.deckHeight(x, z, 22.5), DVONLY.DON_VALLEY.deckHeight(x, z, 22.5));
    assert.equal(BOTH.cutAt(x, z), DVONLY.cutAt(x, z));
  }
  assert.equal(T.data, BOTH.DON_VALLEY_DATA, 'DON_VALLEY.data is the Don Valley\'s');
  // the decks: the Don Valley's remapped as before; High Park's box has none of its own (the Gardiner keeps its height)
  assert.equal(BOTH.DECKS.length, DVONLY.DECKS.length);
  BOTH.DECKS.forEach((d, i) => d.pts.forEach((p, k) => assert.equal(p.h, DVONLY.DECKS[i].pts[k].h)));
  const gardiner = ON.DECKS.find((d) => d.name === 'Gardiner Expressway' && d.pts.some((p) => insideBox(p.x, p.z)));
  const flat = FLAT.DECKS.find((d) => d.name === 'Gardiner Expressway' && d.pts.some((p) => insideBox(p.x, p.z)));
  assert.equal(JSON.stringify(gardiner.pts.map((p) => p.h)), JSON.stringify(flat.pts.map((p) => p.h)));
  assert.equal(HP.decksAt(cafe.x, cafe.z), false);
  // one plane draped by both: its pieces in either box, each on its own surface
  const root = new THREE.Group(), m = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2)); m.name = 'plane'; root.add(m);
  const stats = T.drape(root);
  assert.equal(stats.meshes, 2);
  for (const [suffix, ok] of [['DonValley', (x) => x > 1500], ['HighPark', (x) => x < -5000]]) {
    // (the Don Valley drapes the plane first; High Park then the Don Valley's pieces that reach its box)
    let o = null;
    root.traverse((q) => { if (q.isMesh && q.name.endsWith(`_${suffix}`)) o = q; });
    const P = o.geometry.attributes.position;
    let worst = 0, n = 0;
    for (let i = 0; i < P.count; i++) { if (!ok(P.getX(i))) continue; n++; worst = Math.max(worst, Math.abs(P.getY(i) - T.heightAt(P.getX(i), P.getZ(i)))); }
    assert.ok(n > 1000 && worst < 1e-3, `${suffix}: ${n} vertices within ${worst}`);
  }
});

test('cutAt, the walking floor, arrivals and routes read the park; the SRTM canopy mounds are gone (they were in the flat city)', () => {
  // cutAt = the road cuts + the park's ground (which rises over the street level on the plateau)
  for (let i = 0; i < 300; i++) {
    const x = D.box.x0 + rand() * (D.box.x1 - D.box.x0), z = D.box.z0 + rand() * (D.box.z1 - D.box.z0);
    assert.equal(ON.cutAt(x, z), ON.roadCutAt(x, z) + HP.heightAt(x, z));
    assert.equal(FLAT.cutAt(x, z), FLAT.roadCutAt(x, z));
  }
  // the canopy mounds (the 60 m SRTM grid's 3-21 m bumps over the lawn) are gone from the walking floor
  const mounds = [];
  for (let x = D.box.x0 + 30; x < D.box.x1; x += 60) for (let z = D.box.z0 + 30; z < D.box.z1; z += 60) if (FLAT.terrainHeightAt(x, z) > 2) mounds.push([x, z]);
  assert.ok(mounds.length > 3, `${mounds.length} mounds in the flat city's box`);
  assert.ok(mounds.every(([x, z]) => ON.terrainHeightAt(x, z) === 0));
  // the walking floor: the island's lawn 0.22 m over the park's ground, in every mode, with or without a y
  const C = city({ files: ['world-collision', 'controllers'] }), cm = Object.create(C.ThirdPersonControllerManager.prototype);
  cm.interiorSpace = null;
  const cafe = at(43.64553, -79.46605), pond = at(43.6445, -79.4668), ravine = at(43.6465, -79.4592);
  for (const p of [cafe, pond, ravine, ...mounds.map(([x, z]) => ({ x, z }))]) for (const mode of ['person', 'cyclist', 'car']) {
    const want = C.cutAt(p.x, p.z) + ((mode !== 'car' && C.blockAt(p.x, p.z)) ? 0.22 : 0);
    assert.ok(Math.abs(cm.getGroundHeight(p.x, p.z, mode, null) - want) < 1e-9, `${mode} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
    assert.ok(Math.abs(cm.getGroundHeight(p.x, p.z, mode, want + 1) - want) < 1e-9);
  }
  assert.ok(cm.getGroundHeight(cafe.x, cafe.z, 'person', null) > 15, 'up on the plateau');
  // the Gardiner over the box's south edge: still its deck, in reach of a driver on it
  const g = C.DECKS.find((d) => d.name === 'Gardiner Expressway' && d.pts.some((p) => insideBox(p.x, p.z))), q = g.pts[g.pts.length >> 1];
  assert.ok(Math.abs(cm.getGroundHeight(q.x, q.z, 'car', q.h) - q.h) < 0.5);
  // search results and map spots in the park land on its roads at their ground (streetArrival's y)
  const spot = C.streetArrival(cafe.x, cafe.z);
  assert.ok(spot.y !== null && Math.abs(spot.y - C.cutAt(spot.x, spot.z)) < 1e-9 && spot.y > 10, `a spot by the café: ${JSON.stringify(spot)}`);
  // routes through the park (by bicycle: its roads are closed to through traffic): their points on its roads' ground
  const R = city({ files: ['navigation'] }), route = R.Navigation.findRoute({ x: -6280, z: -2800 }, { x: -6300, z: -1230 }, 'cycle');
  const inPark = route.points.filter((p) => R.DON_VALLEY.heightAt(p[0], p[2]) !== 0);
  assert.ok(inPark.length > 3 && inPark.every((p) => Math.abs(p[1] - R.cutAt(p[0], p[2])) < 0.5), `route points ${inPark.map((p) => p[1].toFixed(1))}`);
  assert.ok(Math.max(...inPark.map((p) => p[1])) > 10, 'over the plateau');
  // the flat city (before the pilot): the mounds and all
  const F = city({ highPark: false, files: ['world-collision', 'controllers'] }), off = Object.create(F.ThirdPersonControllerManager.prototype);
  off.interiorSpace = null;
  assert.equal(off.getGroundHeight(cafe.x, cafe.z, 'person', null), 0.22);
  assert.ok(mounds.some(([x, z]) => off.getGroundHeight(x, z, 'person', null) > 2));
});

test('outside High Park\'s box the city is the flat city: ground, cuts, decks, the walking floor, arrivals, traffic and poles', () => {
  // (High Park is on by default: everywhere else every reader must take the flat city's path, to the bit)
  const extra = ['toronto-traffic-data', 'road-network', 'world-collision', 'controllers', 'toronto-poles', 'mapped-poles'];
  const A = city({ highPark: false, files: extra }), B = city({ files: extra }), Dt = A.GEO.frame.detail;
  const out = (x, z) => !insideBox(x, z) && !(x === D.box.x0 || x === D.box.x1 || z === D.box.z0 || z === D.box.z1);
  const cmA = Object.create(A.ThirdPersonControllerManager.prototype), cmB = Object.create(B.ThirdPersonControllerManager.prototype);
  cmA.interiorSpace = cmB.interiorSpace = null;
  let n = 0;
  while (n < 3000) {
    const x = Dt.x0 + rand() * (Dt.x1 - Dt.x0), z = Dt.z0 + rand() * (Dt.z1 - Dt.z0);
    if (!out(x, z)) continue;
    n++;
    const at = `(${x.toFixed(1)}, ${z.toFixed(1)})`;
    for (const f of ['cutAt', 'roadCutAt', 'terrainHeightAt']) assert.equal(B[f](x, z), A[f](x, z), `${f} at ${at}`);
    for (const y of [0, 5, 30]) assert.equal(B.deckHeightAt(x, z, y), A.deckHeightAt(x, z, y), `deckHeightAt at ${at}`);
    for (const mode of ['person', 'cyclist', 'car']) for (const y of [null, 8]) assert.equal(cmB.getGroundHeight(x, z, mode, y), cmA.getGroundHeight(x, z, mode, y), `${mode} floor at ${at}`);
    if (n % 10 === 0) assert.equal(JSON.stringify(B.streetArrival(x, z)), JSON.stringify(A.streetArrival(x, z)), `arrival at ${at}`); // (two realms)
  }
  const deckSig = (C) => JSON.stringify(C.DECKS.map((d) => d.pts.filter((p) => out(p.x, p.z)).map((p) => [p.x, p.z, p.h, p.g ?? null])));
  assert.equal(deckSig(B), deckSig(A));
  assert.equal(JSON.stringify(B.EDGE_WATERS.map((e) => [e.pts, e.open])), JSON.stringify(A.EDGE_WATERS.map((e) => [e.pts, e.open])));
  // the traffic's edges wholly outside the box: the same edges, the same heights along them
  const NA = A.buildRoadNetwork([], []), NB = B.buildRoadNetwork([], []);
  const ends = (e) => [e.x0, e.z0, e.x0 + e.dx * e.span, e.z0 + e.dz * e.span];
  const outside = (e) => { const [ax, az, bx, bz] = ends(e); return out(ax, az) && out(bx, bz) && out((ax + bx) / 2, (az + bz) / 2); };
  const key = (e) => `${ends(e).map((v) => v.toFixed(3)).join(',')},${e.lanes.join(':')}`;
  const byKey = new Map(NB.edges.filter(outside).map((f) => [key(f), f]));
  const edges = NA.edges.filter(outside);
  assert.ok(edges.length > 9000 && byKey.size === edges.length, `${edges.length} edges outside, ${byKey.size} in the default city`);
  for (const e of edges) {
    const f = byKey.get(key(e));
    assert.ok(f && f.h0 === e.h0 && f.h1 === e.h1, `edge at (${e.x0.toFixed(0)}, ${e.z0.toFixed(0)})`);
    for (const t of [0, 0.5, 1]) assert.equal(B.edgeY(f, f.len * t), A.edgeY(e, e.len * t));
  }
  // the City's poles where mapped-poles.js stands them
  const poles = (C) => JSON.stringify(C.mappedPoleSites(C.POLES, { blockAt: C.blockAt, nearestRoads: C.nearestRoads, deckHeightAt: C.deckHeightAt, cutAt: C.cutAt,
    SW_Y: C.CITY_BOUNDS.sidewalkHeight }).sites.filter((p) => out(p.x, p.z)).map((p) => [p.id, p.x, p.z, p.y0, p.ax, p.az]));
  assert.equal(poles(B), poles(A));
  // (the wires between two poles shear to the second's foot only in the box, or city-wide with ?donvalley=1)
  assert.match(read('mapped-poles'), /P && \(P\.donValley \|\| P\.inBox\(a\.x, a\.z\) \|\| P\.inBox\(b\.x, b\.z\)\)/);
  // (a bikeway follows the surface between its points, its posts and separators at their own spots, only where it reaches
  // the box, or everywhere with ?donvalley=1)
  assert.match(read('cycling'), /if \(DV && \(DV\.donValley \|\| \(DV\.boxes \|\| \[DV\.box\]\)\.some\(reaches\)\)\)/);
});

test('traffic and walkers on the park\'s roads and paths: lanes and turns within 0.1 m of the ground, up and down', () => {
  const C = city({ files: ['toronto-traffic-data', 'road-network'] }), N = C.buildRoadNetwork([], []), T = C.DON_VALLEY;
  let lanes = 0, worst = 0, turns = 0, turnWorst = 0, hi = 0, lo = 0;
  for (const e of N.edges) {
    if (!T.inBox(e.sx, e.sz)) continue;
    for (let s = 0; s <= e.len; s += 1) for (let i = 0; i < e.lanes.length; i++) {
      const x = e.sx + e.dx * s + e.rx * e.lanes[i], z = e.sz + e.dz * s + e.rz * e.lanes[i], y = C.edgeY(e, s, x, z);
      if (!e.dv || e.dv.kind !== 'ground' || T.heightAt(x, z) === 0) continue;
      lanes++; hi = Math.max(hi, y); lo = Math.min(lo, y);
      worst = Math.max(worst, Math.abs(y - C.cutAt(x, z)));
    }
    for (const m of e.moves) for (let i = 0; i < m.out.length; i++) {
      if (!(m.out[i] >= 0) || !e.dv || !m.to.dv || e.dv.kind !== 'ground' || m.to.dv.kind !== 'ground') continue;
      const c = N.connector(e, i, m.to, m.out[i]), p = { x: 0, y: 0, z: 0 };
      for (let s = 0; s <= c.len; s += 1) { N.curvePoint(c, s, p); if (T.heightAt(p.x, p.z) === 0) continue; turns++; turnWorst = Math.max(turnWorst, Math.abs(p.y - C.cutAt(p.x, p.z))); }
    }
  }
  assert.ok(lanes > 3000 && turns > 50, `${lanes} lane and ${turns} turn samples`);
  assert.ok(worst < 0.1 && turnWorst < 0.1, `lanes within ${worst.toFixed(3)} m, turns within ${turnWorst.toFixed(3)} m of the ground`);
  assert.ok(hi > 15 && lo < -3, `from ${lo.toFixed(1)} m to ${hi.toFixed(1)} m`);
  // the park roads named in the brief all follow the ground
  for (const name of ['Colborne Lodge Drive', 'West Road', 'Centre Road', 'Spring Road']) {
    const P = roadPts(C, name);
    assert.ok(P.some((p) => Math.abs(T.heightAt(p.x, p.z)) > 2), `${name} on the park's relief`);
  }
  // walkers stand on cutAt per foot (traffic.js pedGround), so on the park's ground too
  const src = read('traffic');
  assert.match(src, /if \(!p\.node\) return SIDEWALK_Y \+ cutAt\(x, z\);/);
});

test('trees, cycling and props stand on the ground over the street level too; parked cars keep off the relief', () => {
  // (ez-trees.js and cycling.js take min(0, cutAt), a road cut's bank never over the street, except in High Park's box,
  // whose relief rises over it; outside it exactly as before)
  for (const f of ['ez-trees', 'cycling']) assert.match(read(f), /P && P\.clearsTerrainAt && P\.clearsTerrainAt\(x, z\) \? c : Math\.min\(0, c\)/);
  assert.match(read('parked-cars'), /DV\.highestAround\(cx, cz, hl\) > 0\.05/);
  const cafe = at(43.64553, -79.46605);
  assert.ok(HP.highestAround(cafe.x, cafe.z, 5) > 15 && HP.lowestAround(cafe.x, cafe.z, 5) > 15);
});

test('buildings on the park stand on the highest ground under them, with plinths down to the lowest', () => {
  const B = D.buildings;
  assert.ok(B.length > 20, `${B.length} buildings on the relief`);
  const byCentre = new Map(ON.GEO.buildings.map((b) => [`${b[0]},${b[1]}`, b]));
  for (const [x, z, base, lowest] of B) {
    const b = byCentre.get(`${x},${z}`);
    assert.ok(b, 'a real building');
    assert.equal(HP.buildingBase(x, z), base);
    assert.ok(lowest <= base);
    // nothing under its footprint stands over its floor
    const [, , ang, parts] = b, cs = Math.cos(ang), sn = Math.sin(ang);
    for (const [u0, u1, v0, v1] of parts) for (const [u, v] of [[u0, v0], [u1, v1], [(u0 + u1) / 2, (v0 + v1) / 2]]) {
      assert.ok(HP.heightAt(x + u * cs + v * sn, z - u * sn + v * cs) <= base + 0.02, `under (${x}, ${z})`);
    }
  }
  // the café on the plateau, lifted with it; a building off the park at 0
  const cafe = ON.GEO.buildings.find((b) => b[9] === 'Grenadier Cafe');
  assert.ok(HP.buildingBase(cafe[0], cafe[1]) > 15);
  const off = ON.GEO.buildings.find((b) => !insideBox(b[0], b[1]));
  assert.equal(HP.buildingBase(off[0], off[1]), 0);
  // buildings.js and storefront-signs.js stand them on it
  assert.match(read('buildings'), /buckets\[mat\]\.push\(\{ x, y: y0 \+ h \/ 2/);
  assert.match(read('buildings'), /maxY: y0 \+ h, obb/);
  // the plinths and the ponds' banks (buildPatches)
  Object.assign(ON, { createTerrainMaterial: () => new THREE.MeshBasicNodeMaterial(), createWaterMaterial: () => new THREE.MeshBasicNodeMaterial() });
  const scene = { add(g) { this.g = g; } };
  const out = HP.buildPatches(scene);
  assert.ok(out.plinths > 20 && out.ponds === D.ponds.length, `${out.plinths} plinths, ${out.ponds} ponds`);
  const banks = scene.g.children.find((m) => m.name === 'HighParkPondBanks').geometry.attributes.position;
  // the banks' tops on the ground at the outline (the lawn's edge), their feet under the water
  let top = 0;
  for (let i = 0; i < banks.count; i++) {
    const y = banks.getY(i), g = HP.heightAt(banks.getX(i), banks.getZ(i));
    if (Math.abs(y - g) < 1e-4 || Math.abs(y - g - 0.22) < 1e-4) top++;
  }
  assert.ok(top > banks.count / 3, `${top} of ${banks.count} bank vertices on the ground`);
});

test('the park roads\' grades are recorded; the steep ones are reviewed against the lidar', () => {
  const R = D.diagnostics.roads;
  for (const name of ['Colborne Lodge Drive', 'West Road', 'Centre Road', 'Spring Road']) assert.ok(R.some((r) => r.name === name), name);
  for (const r of R.filter((q) => q.review)) assert.ok(Number.isFinite(r.lidarPct), `${r.name}: its own slope in the lidar recorded`);
});

test('the park roads\' kerbs run straight on the relief: no wave along a kerb that the roadway does not have (st-eki4)', () => {
  // (along each kerb, every 1 m: its 5 m second difference less the centreline's, so the road's own crests and dips
  // cancel; away from junctions, where two roads' profiles meet. Before the roads rule held every grid triangle reaching
  // the kerbs, Colborne Lodge Drive's climb from the Queensway waved by 1.5-1.9 m over 10 m, its kerb 0.8 m off the
  // centreline's level)
  const segNear = (o, x, z, r) => o.pts.some((p, j) => {
    if (!j) return false;
    const q = o.pts[j - 1], dx = p.x - q.x, dz = p.z - q.z, t = Math.max(0, Math.min(1, ((x - q.x) * dx + (z - q.z) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(q.x + dx * t - x, q.z + dz * t - z) < r;
  });
  // (and away from the pads, which the roads rule leaves level: the rink and pool's pads beside Colborne Lodge Drive's
  // service drive on the plateau stand 1.4 m under it)
  const P = city({ files: ['toronto-tennis', 'toronto-rinks'] }), pads = [];
  for (const t of P.TENNIS.records) pads.push([t.x, t.z]);
  for (const r of P.RINKS.records) for (const g of r.polygons) for (const [x, z] of g.outer) pads.push([x, z]);
  const nearPad = (x, z) => pads.some(([px, pz]) => Math.hypot(px - x, pz - z) < 40);
  for (const name of ['Colborne Lodge Drive', 'West Road', 'Centre Road', 'Spring Road', 'Deer Pen Road']) {
    let worst = 0, at = null, n = 0;
    for (const r of ON.ROADS) {
      if (r.name !== name || r.raised) continue;
      const others = ON.ROADS.filter((o) => o !== r && !o.raised && o.pts.some((p) => insideBox(p.x, p.z)));
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const a = r.pts[i], b = r.pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), px = -(b.z - a.z) / L, pz = (b.x - a.x) / L, o = r.w / 2 + 0.2;
        for (let s = 15; s <= L - 15; s += 1) {
          const x = a.x + ((b.x - a.x) * s) / L, z = a.z + ((b.z - a.z) * s) / L;
          if (!insideBox(x, z) || Math.abs(HP.heightAt(x, z)) < 0.05 || nearPad(x, z) || others.some((q) => segNear(q, x, z, 30))) continue;
          const h = (u, off) => HP.heightAt(x + ((b.x - a.x) * u) / L + px * off, z + ((b.z - a.z) * u) / L + pz * off);
          const d2 = (off) => h(-5, off) - 2 * h(0, off) + h(5, off);
          for (const side of [-1, 1]) {
            const e = Math.abs(d2(side * o) - d2(0));
            n++;
            if (e > worst) { worst = e; at = [Math.round(x), Math.round(z)]; }
          }
        }
      }
    }
    assert.ok(n > 10, `${name}: ${n} kerb samples`);
    assert.ok(worst < 0.3, `${name}: its kerb waves ${worst.toFixed(2)} m over 10 m at ${at}`);
  }
});

test('the build is reproducible from the lidar tiles', { skip: !fs.existsSync(path.join(process.env.DON_VALLEY_DTM || path.join(os.homedir(), '.cache/slop-toronto/raw/ontario-dtm-gta2023'), 'manifest-high-park.json')) && 'no lidar tiles (node tools/fetch-don-valley-dtm.mjs --region high-park)' }, () => {
  const out = path.join(os.tmpdir(), `high-park-data-${process.pid}.js`);
  execFileSync(process.execPath, [new URL('../tools/build-high-park.mjs', import.meta.url).pathname, '--out', out], { stdio: 'pipe' });
  assert.equal(fs.readFileSync(out, 'utf8'), read('high-park-data'));
  fs.rmSync(out);
});
