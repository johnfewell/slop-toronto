// The Don Valley terrain pilot (?donvalley=1; docs/don-valley-terrain.md): its datum and data, one surface for drawing
// and sampling, the decks and cuts that read it, nothing changed without the flag, and the viaduct ride's stations at
// their depth below the street
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DON_VALLEY_EVIDENCE } from '../tools/subway-station-facts.mjs';

const read = (f) => fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
function city(pilot) {
  const context = vm.createContext({ window: { CITY: { THREE, Addons: { mergeGeometries } } }, console: { info() {}, warn() {}, log() {} }, atob });
  for (const f of ['toronto-geodata', 'toronto-subway', 'toronto-subway-topology', ...(pilot ? ['don-valley-data', 'don-valley'] : []), 'city-config']) {
    vm.runInContext(read(f), context);
  }
  return context.window.CITY;
}
const ON = city(true), OFF = city(false);
const DV = ON.DON_VALLEY, D = ON.DON_VALLEY_DATA;
const grid = (b64, scale) => { const b = Buffer.from(b64, 'base64'); return [...new Int16Array(b.buffer, b.byteOffset, b.length / 2)].map((v) => v / scale); };
const BW = D.box.x1 - D.box.x0, BD = D.box.z1 - D.box.z0; // (the box's width and depth)
const node = (arr, x, z) => arr[Math.round((z - D.box.z0) / D.box.step) * D.nx + Math.round((x - D.box.x0) / D.box.step)];
// a little pseudo-random sequence (repeatable)
const rand = (() => { let s = 6711; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

test('the pilot declares its source, frame and datum, and keeps raw, datum and conditioned heights apart (TE-1)', () => {
  assert.match(D.source.dataset, /Ontario Elevation Mapping Program, GTA 2023 lidar, Digital Terrain Model \(bare earth\)/);
  assert.match(D.source.licence, /Open Government Licence – Ontario/);
  assert.equal(D.source.resolutionM, 0.5);
  assert.ok(D.source.tiles.length >= 4 && D.source.tiles.every((t) => /^[0-9a-f]{64}$/.test(t.sha256)), 'each tile named with its checksum');
  assert.match(D.crs.horizontal, /Union Station/);
  assert.match(D.crs.horizontal, /EPSG:2958/);
  assert.match(D.crs.vertical, /CGVD2013/);
  assert.match(D.datum, /y = DTM - T/);
  assert.equal(D.box.step, 10);
  for (const k of ['height', 'raw', 'datumGrid', 'unconditioned']) assert.equal(grid(D[k], 1).length, D.nx * D.nz, k);
  for (const rule of ['bridge', 'cover', 'ravine', 'roads', 'portals', 'boundary', 'footing']) assert.ok(D.alterations[rule], `alteration ${rule} recorded`);
  // (bare earth: nothing to take out under the viaduct)
  assert.equal(D.alterations.bridge.samples, 0);
  // (aligned with js/terrain.js's 60 m grid, so its cells are either the pilot's or its own)
  for (const v of [D.box.x0, D.box.x1, D.box.z0, D.box.z1]) assert.equal((v + 26000) % 60, 0);
});

test('datum mapping: the Don under the viaduct lies ~39 m below a street datum ~114 m above CGVD2013', () => {
  const raw = grid(D.raw, 10), datum = grid(D.datumGrid, 10), unc = grid(D.unconditioned, 100);
  // the river under the viaduct (the lidar's ground: no deck in it)
  const [x, z] = [2280, -2800];
  const r = node(raw, x, z), t = node(datum, x, z), u = node(unc, x, z);
  assert.ok(r > 74 && r < 77, `the Don's floor ${r} m above CGVD2013`);
  assert.ok(t > 112 && t < 116, `the street datum there ${t} m`);
  assert.ok(Math.abs(u - (r - t)) < 0.1, `game height ${u} = DTM ${r} - datum ${t}`); // (decimetres and centimetres)
  assert.ok(Math.abs(DV.heightAt(x, z) - u) < 1.5, 'unconditioned on the valley floor');
  // the tableland at both of the viaduct's ends: the datum sits on it (within the 1 m the shallow knee flattens and the
  // smoothing's ~1.5 m), and the raw lidar there is the street the TTC's stations stand on
  for (const v of D.diagnostics.datumAtViaductEnds) assert.ok(v > 112 && v < 116, `datum at the viaduct's ends: ${v}`);
  assert.ok(Math.abs(node(raw, 1990, -2810) - 113.5) < 0.6 && Math.abs(node(raw, 2490, -2800) - 113.6) < 0.6, 'the street at the viaduct\'s ends');
  assert.ok(D.diagnostics.deepestM < -36 && D.diagnostics.deepestM > -42);
});

test('the deck stands ~39 m over the Don: the lidar\'s, and the game\'s within 1 m of it', () => {
  const raw = grid(D.raw, 10), V = D.diagnostics.viaduct;
  // surveyed: the road deck's surface (the lidar surface model, DON_VALLEY_EVIDENCE) over the lowest bare earth under it
  let river = Infinity;
  for (let t = 0.05; t <= 0.95; t += 0.01) river = Math.min(river, node(raw, V.from[0] + (V.to[0] - V.from[0]) * t, V.from[1] + (V.to[1] - V.from[1]) * t));
  const surveyed = DON_VALLEY_EVIDENCE.roadDeck.middle - river;
  assert.ok(surveyed > 38 && surveyed < 40, `surveyed ${surveyed.toFixed(1)} m (Taylor 1919: 130 ft, 39.6 m, "above the river")`);
  // in the game: the deck's top over the deepest ground under it
  assert.ok(Math.abs(V.deckOverFloorM - surveyed) < 1, `game ${V.deckOverFloorM} m vs surveyed ${surveyed.toFixed(1)} m`);
  assert.ok(V.deckOverFloorM > 38 && V.deckOverFloorM < 41, 'near the commonly cited 40 m');
  // (the SRTM build had it at 35.1 m)
});

test('the surface: grid nodes, continuity, the tableland and the box edges at the street level (TE-4)', () => {
  const H = grid(D.height, 100);
  for (let i = 0; i < 400; i++) {
    const c = Math.floor(rand() * D.nx), r = Math.floor(rand() * D.nz);
    assert.ok(Math.abs(DV.heightAt(D.box.x0 + c * 10, D.box.z0 + r * 10) - H[r * D.nx + c]) < 1e-5); // (Float32)
  }
  // continuous: no step across any cell edge or diagonal
  for (let i = 0; i < 2000; i++) {
    const x = D.box.x0 + rand() * (D.box.x1 - D.box.x0), z = D.box.z0 + rand() * (D.box.z1 - D.box.z0);
    assert.ok(Math.abs(DV.heightAt(x + 0.01, z + 0.01) - DV.heightAt(x, z)) < 0.02);
  }
  // the edges (and beyond): the street level
  for (let s = 0; s <= 1; s += 0.01) {
    for (const [x, z] of [[D.box.x0, D.box.z0 + s * BD], [D.box.x1, D.box.z0 + s * BD], [D.box.x0 + s * BW, D.box.z0], [D.box.x0 + s * BW, D.box.z1]]) {
      assert.ok(Math.abs(DV.heightAt(x, z)) < 0.01, `edge (${x}, ${z})`);
      assert.equal(DV.heightAt(x + (x === D.box.x1 ? 5 : x === D.box.x0 ? -5 : 0), z + (z === D.box.z1 ? 5 : z === D.box.z0 ? -5 : 0)), 0);
    }
  }
  // the stations and the streets at the viaduct's ends stay at the street level
  for (const n of ['Castle Frank', 'Broadview']) {
    const s = ON.GEO_SUBWAY.stations.find((q) => q[2] === n);
    assert.ok(Math.abs(DV.heightAt(s[0], s[1])) < 0.05, n);
  }
  assert.equal(DV.heightAt(1550, -2750), 0);
  // the south transition: the valley floor climbs back to the city's plane, no step
  let prev = -Infinity;
  for (let z = -2600; z <= -1880; z += 10) {
    let floor = 0;
    for (let x = 2100; x <= 2600; x += 10) floor = Math.min(floor, DV.heightAt(x, z));
    assert.ok(floor >= prev - 1.2, `no dip at z ${z}`);
    prev = floor;
  }
});

// a raised road's own surface: its ramp's profile, or the viaduct's deck (js/don-valley.js)
const deckY = (x, z) => DV.rampAt(x, z) ?? DV.deckHeight(x, z, 1);
test('max grades: the lidar\'s roads, the ramps on their profiles, and Rosedale Valley Road down its ravine (TE-3)', () => {
  // the steepest 20 m of a road (its own surface: cutAt on the ground, its deck for a raised road), in the playable city
  // unless `everywhere`
  const steepest = (name, raised, from = null, everywhere = false) => {
    let worst = 0;
    for (const r of ON.ROADS) {
      if (r.name !== name || !!r.raised !== raised) continue;
      const st = [];
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const a = r.pts[i], b = r.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 5));
        for (let j = i ? 1 : 0; j <= n; j++) st.push({ x: a.x + ((b.x - a.x) * j) / n, z: a.z + ((b.z - a.z) * j) / n });
      }
      const h = (p) => (raised ? deckY(p.x, p.z) : ON.cutAt(p.x, p.z));
      for (let i = 4; i < st.length; i++) {
        const a = st[i - 4], b = st[i];
        if (![a, b].every((p) => DV.inBox(p.x, p.z) && (everywhere || p.z > -3000) && !DV.onViaductLine(p.x, p.z, 20))) continue;
        if (from && Math.min(...[a, b].map((p) => Math.hypot(p.x - from.x, p.z - from.z))) < from.r) continue;
        if (Math.min(DV.heightAt(a.x, a.z), DV.heightAt(b.x, b.z)) > -0.5) continue;
        worst = Math.max(worst, Math.abs(h(b) - h(a)) / Math.hypot(b.x - a.x, b.z - a.z));
      }
    }
    return worst;
  };
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  // Rosedale Valley Road: 15% at the SRTM build's west taper; now under 10% where the flat city's cut hands over to the
  // ravine, and about the ravine rule's 5% on the way down from 150 m past the bridge (6.4% where the rule fades out
  // 300-450 m from it, 6.1% on the south transition's climb back to the flat city)
  const [A, B] = D.alterations.ravine.bridge, mid = { x: (A[0] + B[0]) / 2, z: (A[1] + B[1]) / 2 };
  assert.ok(steepest('Rosedale Valley Road', false) < 0.10, `Rosedale Valley Road ${pct(steepest('Rosedale Valley Road', false))}`);
  assert.ok(steepest('Rosedale Valley Road', false, { ...mid, r: 150 }) < 0.07, 'down the ravine');
  // the ramps on their lidar profiles (st-wt0.21.2): the SRTM build's 38% (Bayview-Bloor) and 14% (Royal Drive, which
  // hugged the ground's shallow knee) within the 8-10% of real ramps, in the playable city and beyond its edge
  for (const n of ['Bayview-Bloor Ramp', 'Royal Drive']) {
    assert.ok(steepest(n, true) < 0.10, `${n} ${pct(steepest(n, true))}`);
    assert.ok(steepest(n, true, null, true) < (n === 'Royal Drive' ? 0.10 : 0.145), `${n} everywhere ${pct(steepest(n, true, null, true))}`);
  }
  assert.ok(steepest('Drumsnab Road', true) < 0.12);
  for (const n of ['Bayview Avenue', 'Don Valley Parkway']) assert.ok(steepest(n, false) < 0.08, n);
  // what is still over 12% is recorded with its resolution: in the playable city only a service lane down the ravine's
  // side, whose lidar slope is the same (17%, John: leave the real slopes); beyond the city's edge, one ramp junction
  // where OpenStreetMap's ground way goes on over the ramp's bridge (the 10 m grid's ground road lies under it)
  const review = D.diagnostics.roads.filter((r) => r.review);
  assert.ok(review.every((r) => r.maxGradePct > 12));
  assert.deepEqual([...new Set(review.filter((r) => r.playableMaxPct > 12).map((r) => r.name))], ['(unnamed)']);
  for (const r of review) {
    if (r.raised) assert.ok(r.junction && r.at[1] < -3000, `${r.name}: a recorded junction, outside the playable city`);
    else assert.ok(r.lidarPct >= r.maxGradePct - 1.5, `${r.name}: ${r.maxGradePct}% in the game, ${r.lidarPct}% in the lidar`);
  }
  // the north stubs (42% on the SRTM-era ramps) on their profiles: no deck in the box steeper than that junction
  for (const r of D.diagnostics.roads.filter((q) => q.raised)) assert.ok(r.maxGradePct <= 14.5, `${r.name} at ${r.at}: ${r.maxGradePct}%`);
});

test('the ramps: profiles from the lidar, standing clear of the ground they cross, and the Rosedale section level (st-wt0.21.2)', () => {
  const rampDecks = ON.DECKS.filter((d) => DV.rampProfile(OFF.DECKS[ON.DECKS.indexOf(d)].pts));
  assert.equal(rampDecks.length, D.decks.ramps.length);
  assert.ok(rampDecks.length > 15);
  for (const d of rampDecks) {
    // every few metres (the profile, not the OpenStreetMap vertices 100 m apart)
    for (let i = 1; i < d.pts.length; i++) assert.ok(Math.hypot(d.pts[i].x - d.pts[i - 1].x, d.pts[i].z - d.pts[i - 1].z) <= 4.01, `${d.name}: a piece ${i}`);
    // over the drawn ground by the deck's own height or more: never buried in it
    for (const p of d.pts) if (DV.inBox(p.x, p.z)) assert.ok(p.h - DV.heightAt(p.x, p.z) > D.decks.hug - 0.02, `${d.name} at (${p.x}, ${p.z}): ${p.h} over ${DV.heightAt(p.x, p.z)}`);
    // the road graph's raised nodes on it take its height there
    const p = d.pts[d.pts.length >> 1];
    assert.ok(Math.abs(DV.roadHeight(p.x, p.z, 7) - p.h) < 0.05, `${d.name}: road graph height`);
  }
  // the Royal Drive ramp runs down from Danforth Avenue's street level to the valley's ground road
  const royal = rampDecks.find((d) => d.name === 'Royal Drive');
  assert.ok(Math.abs(royal.pts[0].h) < 0.05 && royal.pts.at(-1).h < -15, 'from the street to the valley');
  // the Prince Edward Viaduct's Rosedale section: Bloor Street level with the street over the ravine (the flat city had a
  // 7.5 m flyover there, the SRTM-era pilot let it sag 9 m into the ravine), its approaches from outside the box back at
  // the street: no step at the box's west edge
  const [rs, re] = [D.decks.sections[1].from, D.decks.sections[1].to];
  assert.equal(D.decks.sections[1].name, 'Rosedale');
  const mid = { x: (rs[0] + re[0]) / 2, z: (rs[1] + re[1]) / 2 };
  assert.ok(DV.heightAt(mid.x, mid.z) < -4, 'the ravine under it');
  assert.equal(ON.deckHeightAt(mid.x, mid.z, 0.4, 0.6), D.deckTop, 'on the Rosedale section');
  assert.equal(ON.deckHeightAt(mid.x, mid.z, DV.heightAt(mid.x, mid.z) + 0.2, 0.6), 0, 'nothing in reach under it');
  const bloor = (C) => C.DECKS.filter((d) => /^(Bloor Street East|Parliament Street|)$/.test(d.name) && d.pts.some((p) => p.x > 1480 && p.x < 1760 && p.z > -2720 && p.z < -2500));
  assert.ok(Math.max(...bloor(OFF).flatMap((d) => d.pts.map((p) => p.h))) > 7, 'the flat city\'s flyover');
  assert.ok(Math.max(...bloor(ON).flatMap((d) => d.pts.map((p) => p.h))) <= D.deckTop + 1e-9, 'level with the street in the pilot');
  assert.ok(D.decks.flattened.length >= 3 && D.decks.flattened.every((f) => DV.flattenedAt(f.pts[0], f.pts[1])));
  // the build records its ramp rule and the junctions it could not meet the lidar at
  assert.ok(D.alterations.ramps.ramps === D.decks.ramps.length && D.alterations.ramps.cutSamples > 0);
});

test('drawn and sampled agree: a draped mesh lies on heightAt to well under 3 cm everywhere (TE-2, TE-3)', () => {
  const root = new THREE.Group();
  // a plane over the whole city (as the street level: two triangles), an indexed island top 0.22 m up, a kerb, a far quad
  const mesh = (name, geo) => { const m = new THREE.Mesh(geo); m.name = name; root.add(m); return m; };
  const plane = mesh('plane', new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2));
  mesh('island', new THREE.CircleGeometry(130, 24).rotateX(-Math.PI / 2).translate(2240, 0.22, -2700));
  mesh('kerb', new THREE.BoxGeometry(300, 0.22, 0.3).translate(2240, 0.11, -2650));
  const far = mesh('far', new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2));
  const before = [...far.geometry.attributes.position.array];
  const stats = DV.drape(root);
  assert.equal(stats.meshes, 3, 'the far quad is not touched');
  assert.deepEqual([...far.geometry.attributes.position.array], before);
  assert.equal(plane.geometry.index.count, 0, 'both of the plane\'s triangles reach the box: re-made, not drawn twice');
  const check = (name, lift, faces) => {
    const o = root.getObjectByName(`${name}_DonValley`), P = o.geometry.attributes.position, N = o.geometry.attributes.normal;
    let worst = 0, n = 0;
    for (let i = 0; i < P.count; i += 3) {
      if (!faces(N.getY(i))) continue;
      let w0 = rand(), w1 = rand();
      if (w0 + w1 > 1) { w0 = 1 - w0; w1 = 1 - w1; }
      const w2 = 1 - w0 - w1, f = (get) => get(i) * w0 + get(i + 1) * w1 + get(i + 2) * w2;
      const x = f((k) => P.getX(k)), y = f((k) => P.getY(k)), z = f((k) => P.getZ(k));
      worst = Math.max(worst, Math.abs(y - lift - DV.heightAt(x, z))); n++;
    }
    return { worst, n };
  };
  const a = check('plane', 0, () => true), b = check('island', 0.22, (ny) => ny > 0.5);
  assert.ok(a.n > 30000 && b.n > 500, `${a.n} + ${b.n} samples`);
  assert.ok(a.worst < 0.001 && b.worst < 0.001, `worst disagreement ${a.worst}, ${b.worst} m`);
  // the kerb: its top 0.22 m over the valley, its faces between that and the valley
  const c = check('kerb', 0.22, (ny) => ny > 0.5);
  assert.ok(c.n > 50 && c.worst < 0.001, `kerb top ${c.worst}`);
  const k = root.getObjectByName('kerb_DonValley').geometry.attributes.position;
  for (let i = 0; i < k.count; i++) {
    const dy = k.getY(i) - DV.heightAt(k.getX(i), k.getZ(i));
    assert.ok(dy > -1e-4 && dy < 0.22 + 1e-4, `kerb vertex ${dy}`);
  }
  // a slope's normal tilts with it
  const n = root.getObjectByName('plane_DonValley').geometry.attributes.normal;
  let tilted = 0;
  for (let i = 0; i < n.count; i++) if (n.getY(i) < 0.95) tilted++;
  assert.ok(tilted > 1000, 'the valley sides\' normals lean');
});

test('cutAt, the decks and the road graph read the valley; without the flag nothing changes', () => {
  // cutAt = the road cuts + the valley; the road cuts alone stay roadCutAt (trees, rail bridges)
  for (let i = 0; i < 300; i++) {
    const x = D.box.x0 + rand() * BW, z = D.box.z0 + rand() * BD;
    assert.ok(Math.abs(ON.cutAt(x, z) - ON.roadCutAt(x, z) - DV.heightAt(x, z)) < 1e-9);
    assert.equal(OFF.cutAt(x, z), OFF.roadCutAt(x, z));
  }
  assert.ok(ON.cutAt(2280, -2880) < -30);
  assert.equal(OFF.cutAt(2280, -2880), 0);
  assert.equal(OFF.DON_VALLEY, undefined);
  // Bloor Street's deck: level with the street over the valley (in reach from the deck, not from the floor under it)
  for (const x of [2020, 2120, 2240, 2360, 2460]) {
    assert.equal(ON.deckHeightAt(x, -2803, 0.4, 0.6), D.deckTop, `on the deck at ${x}`);
    assert.equal(ON.deckHeightAt(x, -2803, DV.heightAt(x, -2803) + 0.2, 0.6), 0, `nothing in reach under it at ${x}`);
    assert.ok(OFF.deckHeightAt(x, -2803, 30, 0.6) > 20, 'the flat city\'s 22.5 m deck without the flag');
  }
  // the ramps down the valley's sides on their own profiles, over their ground
  const ramp = ON.DECKS.filter((d) => d.name === 'Bayview-Bloor Ramp').flatMap((d) => d.pts).find((p) => DV.inBox(p.x, p.z) && (p.g ?? 0) < -10);
  assert.ok(ramp && ramp.h - ramp.g >= D.decks.hug - 0.02, 'a ramp over its ground');
  // decks elsewhere are untouched
  const gardiner = ON.DECKS.find((d) => d.pts.some((p) => p.h > 10 && !DV.inBox(p.x, p.z)));
  const twin = OFF.DECKS.find((d) => d.name === gardiner.name && d.pts[0].x === gardiner.pts[0].x);
  assert.equal(JSON.stringify(gardiner.pts.map((p) => p.h)), JSON.stringify(twin.pts.map((p) => p.h)));
  // a street graph node in the valley is on the ground; one on the viaduct on the deck; one elsewhere unchanged
  assert.ok(Math.abs(DV.roadHeight(2205, -2650, 0) - DV.heightAt(2205, -2650)) < 1e-9);
  assert.equal(DV.roadHeight(2240, -2803, 22.5), D.deckTop);
  assert.equal(DV.roadHeight(0, 0, 3.1), 3.1);
});

test('parked cars keep off the valley and hydro wires reach the next pole, only with the flag', () => {
  const parkedStats = (pilot) => {
    const spec = { zFront: 2.2, zRear: -2.2, halfWidth: [[0, 0.9]], archFlare: 0 };
    const geometry = () => new THREE.BoxGeometry(1.8, 1.5, 4.4), material = () => new THREE.MeshBasicNodeMaterial();
    const CITY = { THREE, QUALITY: { parkedCars: 12000 }, BODY_SPECS: Object.fromEntries(['sedan', 'suv', 'minivan', 'pickup', 'van'].map((k) => [k, spec])),
      buildCarGeometry: geometry, buildCarProxyGeometry: geometry, createLoftedCarMaterial: material, createContactShadowMaterial: material,
      carStyleCode: () => 0, WorldCollision: { boxCollider: () => ({}) }, ...(pilot ? { DON_VALLEY: DV } : {}) };
    const c = vm.createContext({ window: { CITY }, location: { search: '' }, URLSearchParams, performance, console: { info() {}, warn() {}, log() {} } });
    vm.runInContext(read('toronto-parked-cars'), c);
    vm.runInContext(read('parked-cars'), c);
    return { stats: CITY.buildParkedCars({ add() {} }, { edges: [] }).stats, rows: CITY.parkedCarCodec.decodeParkedCars(CITY.PARKED_CARS) };
  };
  const on = parkedStats(true).stats, { stats: off, rows } = parkedStats(false);
  assert.equal(off.valleyDropped, undefined);
  assert.equal(off.kept, rows.length, 'nothing left out without the flag');
  assert.ok(on.valleyDropped > 0 && on.valleyDropped < 30, `${on.valleyDropped} on the slopes`);
  assert.equal(on.kept, off.kept - on.valleyDropped);

  const span = (pilot) => {
    const CITY = { ...(pilot ? { DON_VALLEY: DV } : {}) }, c = vm.createContext({ window: { CITY } });
    vm.runInContext(read('mapped-poles'), c);
    const a = { x: 2000, z: -2300, y0: -4 }, b = { x: 2030, z: -2280, y0: -1.5 };
    const end = new THREE.Vector3(0, 7, 1).applyMatrix4(CITY.poleModels.wireSpanMatrix(new THREE.Object3D(), a, b));
    assert.ok(Math.abs(end.x - b.x) < 1e-3 && Math.abs(end.z - b.z) < 1e-3, 'reaches the far pole');
    return end.y;
  };
  assert.ok(Math.abs(span(true) - 5.5) < 1e-6, 'at the far pole\'s height with the flag');
  assert.ok(Math.abs(span(false) - 3) < 1e-6, 'level without it');
});

test('the build is reproducible from the lidar tiles', { skip: !fs.existsSync(path.join(process.env.DON_VALLEY_DTM || path.join(os.homedir(), '.cache/slop-toronto/raw/ontario-dtm-gta2023'), 'manifest.json')) && 'no lidar tiles (node tools/fetch-don-valley-dtm.mjs)' }, () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'don-valley-')), 'data.js');
  execFileSync(process.execPath, [fileURLToPathLocal('../tools/build-don-valley.mjs'), '--out', out], { stdio: 'pipe' });
  assert.equal(fs.readFileSync(out, 'utf8'), read('don-valley-data'));
});
function fileURLToPathLocal(rel) { return new URL(rel, import.meta.url).pathname; }

// --- the viaduct ride with the pilot on: its stations at their depth (tests/subway-ride.test.mjs's harness)
function rideHarness() {
  const el = () => ({ hidden: true, disabled: false, textContent: '', classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} });
  const els = {};
  const document = { getElementById: (id) => (els[id] ||= el()), createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }) };
  const window = { CITY: { THREE: { ...THREE, CanvasTexture: class extends THREE.Texture {} }, TSL, Addons: { mergeGeometries } } };
  const context = vm.createContext({ window, document, console: { info() {}, warn() {} }, setTimeout, clearTimeout, atob });
  for (const f of ['toronto-subway', 'toronto-subway-topology', 'toronto-transit', 'transit', 'transit-riding', 'subway-service', 'don-valley-data', 'don-valley']) {
    vm.runInContext(read(f), context);
  }
  const C = window.CITY;
  Object.assign(C, { SUBWAY_VIADUCTS: [{ pts: [{ x: 2006.6, z: -2806.3 }, { x: 2240, z: -2800 }, { x: 2474.7, z: -2800.9 }], railY: D.railY, pilot: true }],
    createSubwayCarGeometry: () => new THREE.BoxGeometry(3, 3, 23), createSubwayCarMaterial: () => new THREE.MeshBasicNodeMaterial() });
  vm.runInContext(read('subway-ride'), context);
  const sites = [{ kind: 'stair', name: 'Castle Frank', x: 1846.2, z: -2765.1, tx: 1, tz: 0, pylon: { x: 1846, z: -2768 } },
    { kind: 'stair', name: 'Broadview', x: 2691, z: -2841.1, tx: 1, tz: 0, pylon: { x: 2691, z: -2844 } }];
  const person = { position: new THREE.Vector3(), heading: 0, speed: 0, mesh: new THREE.Group() };
  const controller = { activeMode: 'person', interiorSpace: null, suspended: false, entities: { person }, colliders: [],
    getActiveEntity: () => person, isPointOnSidewalk: () => true, setMode(m) { this.activeMode = m; }, resetInput() {},
    findTeleportPosition(x, z, h, y) { return this.interiorSpace ? this.interiorSpace.constrain({ x, z, y }, 0.5) : { x, z }; },
    getGroundHeight(x, z) { return this.interiorSpace ? (this.interiorSpace.floorAt ? this.interiorSpace.floorAt(x, z) : this.interiorSpace.floor) : 0.22; },
    teleportActiveTo(x, z, heading, y) {
      const d = this.findTeleportPosition(x, z, heading, y);
      person.position.set(d.x, this.getGroundHeight(d.x, d.z, 'person', y ?? person.position.y), d.z); person.heading = heading;
    } };
  const camera = { camera: new THREE.PerspectiveCamera(), activePresetId: 'chase', followOverride: null, resetForTeleport() {},
    setCameraPreset(id) { this.activePresetId = id; } };
  const session = C.createTransitRideSession({ controllerManager: controller, cameraSystem: camera });
  const ride = C.createSubwayRide({ scene: new THREE.Scene(), subway: { entrances: { sites }, passengerRoutes: new Set() }, controllerManager: controller,
    cameraSystem: camera, session, selectCamera: (id) => { camera.activePresetId = id; } });
  return { C, ride, controller, person };
}

test('station depths: derived from the lidar and the viaduct\'s drawing, within the TTC\'s 3.5% to the lower deck', () => {
  const E = DON_VALLEY_EVIDENCE, raw = grid(D.raw, 10);
  const st = (id) => ON.SUBWAY_TOPOLOGY.stations.find((s) => s.id === id);
  const want = { 'castle-frank': { floor: -8.8, confidence: 'medium' }, broadview: { floor: -7.5, confidence: 'low' } };
  for (const [id, w] of Object.entries(want)) {
    const d = st(id).facts.depth, f = d.donValley.platformFloor;
    assert.equal(d.worldDatum, 'viaduct', 'the flat city keeps the viaduct datum');
    assert.equal(f.value, w.floor);
    assert.equal(f.basis, 'derived');
    assert.equal(f.confidence, w.confidence);
    assert.ok(f.range[0] <= f.value && f.value <= f.range[1]);
    assert.equal(d.donValley.railTop, +(w.floor - E.platformHeight).toFixed(2));
    assert.equal(DV.platformFloor(id), w.floor);
    // the street the derivation used is the shipped lidar's at the station
    const s = ON.GEO_SUBWAY.stations.find((q) => q[2] === st(id).name);
    assert.ok(Math.abs(node(raw, s[0], s[1]) - E.street[id]) < 0.3, `${id}: street ${node(raw, s[0], s[1])} m`);
  }
  // Castle Frank: rail level with the covered Rosedale Valley bridge's (its lidar roof less the roof-to-rail allowance)
  const cfRail = E.rosedaleBridgeRoof - E.roofToRail.value;
  assert.ok(Math.abs(cfRail - E.street['castle-frank'] - st('castle-frank').facts.depth.donValley.railTop) < 0.1);
  // ... and the real climb from it to the viaduct's lower deck (the road deck less Taylor's 6.57 m) over the ~150 m from
  // the platform's east end to the west abutment is within the TTC's 3.5%, at either end of the allowance's range
  const viaductRail = { west: E.roadDeck.west - E.viaductRailBelowRoad, east: E.roadDeck.east - E.viaductRailBelowRoad };
  for (const r2r of E.roofToRail.range) assert.ok((viaductRail.west - (E.rosedaleBridgeRoof - r2r)) / 150 <= E.ttcMaxGrade, `roof to rail ${r2r} m`);
  // Broadview: within 3.5% of the east abutment's rail over the ~185 m to its platform
  const bvRail = E.street.broadview + st('broadview').facts.depth.donValley.railTop;
  assert.ok(Math.abs(viaductRail.east - bvRail) / 185 <= E.ttcMaxGrade);
});

test('Castle Frank and Broadview in the ride: platforms at their depths, climbs within 3.5% to the viaduct 5.8 m down', () => {
  const rail = { 'castle-frank': -9.9, broadview: -8.6 };
  const { ride, controller, person } = rideHarness();
  const pair = ride.pairs[0];
  assert.equal(pair.id, 'l2-castle-frank-broadview');
  for (const r of pair.routes) {
    assert.ok(r.profile, `${r.id}: a depth profile`);
    let grade = 0;
    for (let i = 1; i < r.profile.length; i++) {
      const [s0, y0] = r.profile[i - 1], [s1, y1] = r.profile[i];
      assert.ok(s1 >= s0, 'in order');
      grade = Math.max(grade, Math.abs(y1 - y0) / Math.max(1e-9, s1 - s0));
    }
    // (the TTC Design Manual's maximum on running structure)
    assert.ok(grade <= DON_VALLEY_EVIDENCE.ttcMaxGrade, `${r.id}: steepest grade ${(grade * 100).toFixed(2)}%`);
    assert.equal(r.profile[2][1], D.railY);
    // on the viaduct the rails are on the lower deck; at each platform its own depth
    const mid = (r.open0 + r.open1) / 2;
    assert.equal(ON_SAMPLE(r, mid), D.railY);
    assert.equal(ON_SAMPLE(r, r.calls[0] - 70.5), rail[r.origin.id]);
    assert.equal(ON_SAMPLE(r, r.calls[1] - 70.5), rail[r.destination.id]);
  }
  // the platform cells stand at their depth, and a passenger alights onto the floor
  for (const s of pair.stations) assert.ok(Math.abs(s.group.position.y - rail[s.id]) < 1e-9, `${s.id} platform cell at ${s.group.position.y}`);
  assert.equal(ride.enterStation('castle-frank', 0), true);
  assert.ok(Math.abs(person.position.y - -8.8) < 1e-9, `on Castle Frank's platform at ${person.position.y}`);
  assert.ok(controller.interiorSpace);
  assert.equal(ride.exit({ cancel: true }), true);
  assert.equal(ride.enterStation('broadview', 0), true);
  assert.ok(Math.abs(person.position.y - -7.5) < 1e-9, `on Broadview's platform at ${person.position.y}`);
  assert.equal(ride.exit({ cancel: true }), true);
  // the ride: seated at Castle Frank, the train climbs onto the viaduct and down again into Broadview
  assert.equal(ride.featured(), true);
  let lo = Infinity, hi = -Infinity, end = null;
  for (let i = 0; i < 3000 && !(ride.car.stopIndex === 1 && ride.car.doorState === 'open'); i++) {
    ride.update(0.1);
    lo = Math.min(lo, ride.car.sections[0].y); hi = Math.max(hi, ride.car.sections[0].y); end = ride.car.sections[0].y;
  }
  assert.equal(ride.car.track.destination.id, 'broadview');
  assert.ok(Math.abs(hi - D.railY) < 1e-6 && Math.abs(lo - -9.9) < 0.2, `rails from ${lo} to ${hi}`);
  assert.ok(Math.abs(end - -8.6) < 0.2, `into Broadview at ${end}`);
});
function ON_SAMPLE(route, s) { return +ON_SAMPLE.f(route, s).toFixed(6); }
ON_SAMPLE.f = (route, s) => {
  const P = route.profile;
  if (s <= P[0][0]) return P[0][1];
  for (let i = 1; i < P.length; i++) if (s <= P[i][0]) { const [s0, y0] = P[i - 1], [s1, y1] = P[i]; return y0 + (y1 - y0) * ((s - s0) / ((s1 - s0) || 1)); }
  return P.at(-1)[1];
};

// --- arrivals (st-wt0.21.1): a teleport, a search result or a route arrives on the surface it means
function pilotWith(files) {
  const context = vm.createContext({ window: { CITY: { THREE, Addons: { mergeGeometries }, DEBUG_ROADS: false }, addEventListener() {} }, document: { addEventListener() {}, hidden: false },
    console: { info() {}, warn() {}, log() {} }, atob });
  for (const f of ['toronto-geodata', 'toronto-subway', 'toronto-subway-topology', 'don-valley-data', 'don-valley', 'city-config', ...files]) vm.runInContext(read(f), context);
  return context.window.CITY;
}
test('arrivals: on the viaduct\'s decks without a y, on the valley floor under them with one, and search results say which (st-wt0.21.1)', () => {
  const C = pilotWith(['world-collision', 'controllers']);
  const cm = Object.create(C.ThirdPersonControllerManager.prototype);
  cm.interiorSpace = null;
  const ground = (x, z, y = null, mode = 'person') => cm.getGroundHeight(x, z, mode, y);
  const [rs, re] = [D.decks.sections[1].from, D.decks.sections[1].to], rosedale = { x: (rs[0] + re[0]) / 2, z: (rs[1] + re[1]) / 2 };
  for (const mode of ['person', 'cyclist', 'car']) {
    // a teleport (no y) onto either section of the Prince Edward Viaduct: its deck, not the floor 40 m (or 9 m) under it
    assert.equal(ground(2240, -2803, null, mode), D.deckTop, `${mode} onto the Don's deck`);
    assert.equal(ground(rosedale.x, rosedale.z, null, mode), D.deckTop, `${mode} onto the Rosedale section`);
    // an arrival that knows it is under the deck (a route along Bayview Avenue, a saved place): the floor
    const floor = C.cutAt(2240, -2803);
    assert.ok(floor < -30 && Math.abs(ground(2240, -2803, floor, mode) - floor) < 0.25, `${mode} under the Don's deck`);
  }
  // a ramp's deck (no y): the ramp, not the slope beside it under it; the valley floor away from any deck: the floor
  const royal = C.DECKS.find((d) => d.name === 'Royal Drive' && d.pts.length > 30), p = royal.pts[royal.pts.length >> 1];
  assert.ok(Math.abs(ground(p.x, p.z, null, 'car') - p.h) < 0.4 && p.h < -5, `onto Royal Drive's ramp at ${p.h}`);
  assert.ok(Math.abs(ground(2205, -2650) - (C.cutAt(2205, -2650) + (C.blockAt(2205, -2650) ? 0.22 : 0))) < 1e-9 && C.cutAt(2205, -2650) < -30, 'the valley floor');
  // without the flag: unchanged (the street level, a deck only in reach of it)
  const F = (() => { const context = vm.createContext({ window: { CITY: { DEBUG_ROADS: false }, addEventListener() {} }, document: { addEventListener() {} }, console: { info() {}, warn() {}, log() {} }, atob });
    for (const f of ['toronto-geodata', 'toronto-subway', 'city-config', 'world-collision', 'controllers']) vm.runInContext(read(f), context); return context.window.CITY; })();
  const off = Object.create(F.ThirdPersonControllerManager.prototype);
  off.interiorSpace = null;
  assert.equal(off.getGroundHeight(2240, -2803, 'person', null), 0, 'the flat city: the street under the 22.5 m flyover');

  // search results and map spots (tour-guide.js teleportToPlace -> streetArrival): on the viaduct, Bloor Street's deck;
  // down in the valley, Bayview Avenue's floor; and the y they carry lands there
  const onDeck = C.streetArrival(2240, -2805);
  assert.ok(Math.abs(onDeck.z - -2803) < 12 && Math.abs(onDeck.y - D.deckTop) < 0.01, `a spot on the viaduct: ${JSON.stringify(onDeck)}`);
  assert.equal(ground(onDeck.x, onDeck.z, onDeck.y), D.deckTop);
  const inValley = C.streetArrival(2190, -2600);
  assert.ok(inValley.y < -30 && Math.abs(ground(inValley.x, inValley.z, inValley.y) - inValley.y) < 0.25, `a spot in the valley: ${JSON.stringify(inValley)}`);
  const onRosedale = C.streetArrival(rosedale.x, rosedale.z);
  assert.ok(Math.abs(onRosedale.y - D.deckTop) < 0.01, `a spot on the Rosedale section: ${JSON.stringify(onRosedale)}`);
  // without the flag: the old arrival on a road at grade, no y
  assert.equal(OFF.streetArrival(2240, -2805).y, null);
  assert.equal(OFF.streetArrival(2240, -2805).x, OFF.nearestRoads(2240, -2805, 400).find((n) => !n.road.raised && n.road.cls !== 'motorway' && !OFF.blockAt(n.px, n.pz)).px);
});

test('routes carry their surface: across the viaduct on its deck, along Bayview Avenue on the valley floor (st-wt0.21.1)', () => {
  const C = pilotWith(['navigation']), N = C.Navigation;
  const across = N.findRoute({ x: 1975, z: -2803 }, { x: 2520, z: -2797 }, 'car');
  const onDeck = across.points.filter((q) => q[0] > 1995 && q[0] < 2480); // (the viaduct is one link, 470 m)
  assert.ok(onDeck.length >= 2 && onDeck.every((q) => Math.abs(q[1] - D.deckTop) < 0.01), `over the valley: ${onDeck.map((q) => q[1].toFixed(2))}`);
  const along = N.findRoute({ x: 2195, z: -2580 }, { x: 2160, z: -2950 }, 'car');
  const under = along.points.filter((q) => q[2] < -2700 && q[2] > -2900);
  assert.ok(under.length >= 2 && under.every((q) => q[1] < -25), `Bayview under the viaduct: ${under.map((q) => q[1].toFixed(1))}`);
  // each lands on its own surface (tour-guide.js: getGroundHeight with the route's y, as its ribbon and Tour Drive do)
  const G = pilotWith(['world-collision', 'controllers']), cm = Object.create(G.ThirdPersonControllerManager.prototype);
  cm.interiorSpace = null;
  for (const q of [...onDeck, ...under]) assert.ok(Math.abs(cm.getGroundHeight(q[0], q[2], 'car', q[1] + 1) - q[1]) < 0.6, `route point ${q.map((v) => v.toFixed(1))}`);
});

// --- between their points (st-wt0.21.3): traffic, cycling furniture and walkers on the valley's slopes
test('traffic follows the valley between its graph\'s points: lanes and turns within 0.1 m of the surface (st-wt0.21.3)', () => {
  const C = pilotWith(['toronto-traffic-data', 'road-network']), N = C.buildRoadNetwork([], []), T = C.DON_VALLEY;
  let lanes = 0, worst = 0, linearWorst = 0, turns = 0, turnWorst = 0;
  const names = new Set();
  for (const e of N.edges) {
    if (!T.inBox(e.sx, e.sz)) continue;
    for (let s = 0; s <= e.len; s += 1) for (let i = 0; i < e.lanes.length; i++) {
      const x = e.sx + e.dx * s + e.rx * e.lanes[i], z = e.sz + e.dz * s + e.rz * e.lanes[i], y = C.edgeY(e, s, x, z);
      if (!e.dv || e.dv.kind !== 'ground') continue;
      lanes++;
      worst = Math.max(worst, Math.abs(y - C.cutAt(x, z)));
      linearWorst = Math.max(linearWorst, Math.abs(e.h0 + (e.h1 - e.h0) * Math.min(1, ((e.b0 || 0) + s) / e.span) - C.cutAt(x, z)));
    }
    // the turns through the junctions on the slopes
    for (const m of e.moves) for (let i = 0; i < m.out.length; i++) {
      if (!(m.out[i] >= 0) || !e.dv || !m.to.dv || e.dv.kind !== 'ground' || m.to.dv.kind !== 'ground') continue;
      const c = N.connector(e, i, m.to, m.out[i]), p = { x: 0, y: 0, z: 0 };
      for (let s = 0; s <= c.len; s += 1) { N.curvePoint(c, s, p); turns++; turnWorst = Math.max(turnWorst, Math.abs(p.y - C.cutAt(p.x, p.z))); }
    }
  }
  assert.ok(lanes > 5000 && turns > 200, `${lanes} lane and ${turns} turn samples`);
  // (a road cut's depth between two nodes is still interpolated: Rosedale Valley Road's cut, within a few cm)
  assert.ok(worst < 0.1 && turnWorst < 0.1, `lanes within ${worst.toFixed(3)} m, turns within ${turnWorst.toFixed(3)} m of the ground`);
  assert.ok(linearWorst > 1, `a straight line between the nodes would be ${linearWorst.toFixed(1)} m off`);
  // the viaduct's deck is level: its edges keep the straight line at the deck's height
  const deck = N.edges.filter((e) => T.sectionAt(e.sx, e.sz) && Math.abs(e.h0 - D.deckTop) < 1e-9 && Math.abs(e.h1 - D.deckTop) < 1e-9);
  assert.ok(deck.length && deck.every((e) => !e.dv && Math.abs(C.edgeY(e, e.len / 2) - D.deckTop) < 1e-9), 'on the viaduct\'s deck');
  // without the flag edgeY is the straight line it was
  const F = (() => { const context = vm.createContext({ window: { CITY: { DEBUG_ROADS: false } }, console: { info() {}, warn() {}, log() {} }, atob });
    for (const f of ['toronto-geodata', 'city-config', 'road-network']) vm.runInContext(read(f), context); return context.window.CITY; })();
  const e = { h0: 2, h1: 6, b0: 1, span: 41, x0: 2200, z0: -2700, dx: 1, dz: 0 };
  assert.equal(F.edgeY(e, 19.5, 2219, -2700), 4);
  assert.equal(e.dv, undefined);
});

test('cycling separators, flexi-posts and trails, and walkers, follow the valley between their points (st-wt0.21.3)', () => {
  // cycling.js in the pilot: the multi-use trails down the valley and the cycle tracks at its rims, every point and
  // everything between them on the surface
  const C = pilotWith([]);
  Object.assign(C, { THREE, TSL: {}, WorldCollision: { circleCollider: (x, z, r, y, h) => ({ x, z, y, h }), boxCollider: (x, z, a, b, ang, y, h) => ({ x, z, y, h }) } });
  const context = vm.createContext({ window: { CITY: C }, console: { info() {}, warn() {}, log() {} } });
  vm.runInContext(read('cycling'), context);
  // trails: the paving's level over the ground; sampled every metre between their points
  let trail = 0, trailWorst = 0;
  const T = C.DON_VALLEY;
  const trails = C.GEO.cycling.trails.filter(([, , , flat]) => { for (let i = 0; i < flat.length; i += 2) if (T.heightAt(flat[i], flat[i + 1]) < -1) return true; return false; });
  assert.ok(trails.length > 5, 'the trails down the valley');
  // (cycling.js keeps its prepared lines private: the posts, the separators and the paint come from them; here the
  // geometry it emits is checked against the surface under each vertex)
  // (a bikeway's surface: the road's, the viaduct's deck where Bloor Street's deck is level with the street)
  const surface = (x, z) => { const g = Math.min(0, C.cutAt(x, z)), d = C.deckHeightAt(x, z, 0, 0.6); return d !== 0 && d > g ? d : g; };
  const geos = C.bikeSeparatorGeometries();
  let sep = 0, sepWorst = 0;
  for (const g of geos) {
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      if (!T.inBox(x, z) || T.heightAt(x, z) > -0.2) continue;
      const base = surface(x, z), d = Math.min(Math.abs(y - base), Math.abs(y - base - 0.13));
      sep++; sepWorst = Math.max(sepWorst, d);
    }
  }
  const posts = C.buildBikePosts({ add() {} });
  let post = 0, postWorst = 0;
  for (const c of posts.colliders) if (c.h > 0.5 && T.inBox(c.x, c.z) && T.heightAt(c.x, c.z) < -0.2) { post++; postWorst = Math.max(postWorst, Math.abs(c.y - surface(c.x, c.z))); }
  assert.ok(sepWorst < 0.1 && postWorst < 0.1, `separators within ${sepWorst.toFixed(3)} m (${sep}), posts within ${postWorst.toFixed(3)} m (${post})`);
  // the trails' paint (road-paint.js ribbons) through cycling.js bikePaint: every vertex on the surface
  let rib = 0;
  const api = { WHITE: 0, YELLOW: 0, strip() {}, ribbon(P) {
    for (let k = 0; k < P.length; k++) {
      const p = P[k];
      if (!T.inBox(p.x, p.z) || T.heightAt(p.x, p.z) > -1) continue;
      rib++; trailWorst = Math.max(trailWorst, Math.min(Math.abs(p.y - (C.CITY_BOUNDS.sidewalkHeight + T.heightAt(p.x, p.z))), Math.abs(p.y - surface(p.x, p.z))));
      if (k) { const q = P[k - 1]; trail++; assert.ok(Math.hypot(p.x - q.x, p.z - q.z) <= 2.01 || T.heightAt((p.x + q.x) / 2, (p.z + q.z) / 2) > -0.05 || !T.reliefUnder(Math.min(p.x, q.x), Math.max(p.x, q.x), Math.min(p.z, q.z), Math.max(p.z, q.z)), `a trail piece ${Math.hypot(p.x - q.x, p.z - q.z).toFixed(1)} m over relief at (${p.x}, ${p.z})`); }
    }
  } };
  C.bikePaint(new Proxy(api, { get: (t, k) => (k in t ? t[k] : () => {}) }));
  assert.ok(rib > 500 && trail > 400, `${rib} trail points`);
  assert.ok(trailWorst < 0.01, `trail points within ${trailWorst.toFixed(3)} m of their surface`);
  // walkers: traffic.js's people stand on cutAt (+ the sidewalk) wherever each foot and the body are, not between
  // points (pedGround), so they follow the surface exactly; the source says so
  const src = read('traffic');
  assert.match(src, /return \(t > 2 && t < p\.len - 2 \? CROSSWALK_Y : SIDEWALK_Y\) \+ cutAt\(x, z\);/);
  assert.match(src, /if \(!p\.node\) return SIDEWALK_Y \+ cutAt\(x, z\);/);
});

// --- the river (st-051)
test('the river: level across, never falling going south, under its banks, and the flat city\'s water at the box\'s edge (st-051)', () => {
  const R = D.river, wl = ON.CITY_BOUNDS.waterLevel;
  assert.ok(R && R.level.length > 100 && R.step === 10);
  // one level across each row of the water patch: every water vertex in a row at the same height
  const C = pilotWith([]);
  const scene = { add(g) { this.g = g; } };
  Object.assign(ON, { createTerrainMaterial: () => new THREE.MeshBasicNodeMaterial(), createWaterMaterial: () => new THREE.MeshBasicNodeMaterial() });
  DV.buildPatches(scene);
  const river = scene.g.children.find((m) => m.name === 'DonValleyRiver'), P = river.geometry.attributes.position;
  const rows = new Map();
  for (let i = 0; i < P.count; i++) { const z = Math.round(P.getZ(i)); (rows.get(z) || rows.set(z, []).get(z)).push(P.getY(i)); }
  for (const [z, ys] of rows) assert.ok(Math.max(...ys) - Math.min(...ys) < 1e-4, `level across at z ${z}: ${Math.min(...ys)}..${Math.max(...ys)}`);
  // along the river: from the city's edge south, flat pools that never fall (the frame's datum falls towards the lake;
  // the taper lifts the floor), rising at most 8% where the transition lifts the floor
  const zs = [...rows.keys()].sort((a, b) => a - b), lv = zs.map((z) => rows.get(z)[0]);
  for (let i = 1; i < lv.length; i++) {
    assert.ok(lv[i] >= lv[i - 1] - 1e-6, `no fall at z ${zs[i]}`);
    assert.ok((lv[i] - lv[i - 1]) / (zs[i] - zs[i - 1]) < 0.08, `a gentle rise at z ${zs[i]}`);
  }
  // under the viaduct, the Don ~40 m down, nearly level (the real river is; the datum over it falls 1 m towards the lake)
  const under = zs.filter((z) => z > -2950 && z < -2650).map((z) => rows.get(z)[0]);
  assert.ok(Math.max(...under) - Math.min(...under) < 1.2 && Math.max(...under) < -39, `under the viaduct: ${Math.min(...under).toFixed(2)}..${Math.max(...under).toFixed(2)}`);
  // never above the ground of its own channel (no water standing over its banks), 0.7 m under its lowest
  for (let i = 0; i < R.level.length; i++) {
    const z = R.z0 + i * R.step;
    for (let x = D.box.x0; x <= D.box.x1; x += 2.5) if (C.waterAt(x, z)) assert.ok(R.level[i] / 100 <= DV.heightAt(x, z) + wl + 0.011, `under the ground at (${x}, ${z})`);
  }
  // the south edge: the flat city's water, at the flat city's level (no step, no dam)
  assert.equal(R.level.at(-1) / 100, wl);
  assert.ok(Math.abs(DV.riverLevelAt(2500, D.box.z1) - wl) < 1e-9 && Math.abs(lv.at(-1) - wl) < 0.05);
  // banks close the gap from the ground round the open cells down to the water
  assert.ok(scene.g.children.some((m) => m.name === 'DonValleyRiverBanks'));
  // the build records the rule
  assert.ok(D.alterations.river.steepestRisePct < 8);
});
