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
    for (const [x, z] of [[D.box.x0, D.box.z0 + s * 1620], [D.box.x1, D.box.z0 + s * 1620], [D.box.x0 + s * 1020, D.box.z0], [D.box.x0 + s * 1020, D.box.z1]]) {
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

test('max grades: the lidar\'s roads and ramps, and Rosedale Valley Road down its ravine (TE-3)', () => {
  // the steepest 20 m of a road in the playable city (its own surface: cutAt on the ground, the ground a ramp hugs)
  const steepest = (name, raised, from = null) => {
    let worst = 0;
    for (const r of ON.ROADS) {
      if (r.name !== name || !!r.raised !== raised) continue;
      const st = [];
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const a = r.pts[i], b = r.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 5));
        for (let j = i ? 1 : 0; j <= n; j++) st.push({ x: a.x + ((b.x - a.x) * j) / n, z: a.z + ((b.z - a.z) * j) / n });
      }
      const h = (p) => (raised ? DV.heightAt(p.x, p.z) : ON.cutAt(p.x, p.z));
      for (let i = 4; i < st.length; i++) {
        const a = st[i - 4], b = st[i];
        if (![a, b].every((p) => DV.inBox(p.x, p.z) && p.z > -3000 && !DV.onViaductLine(p.x, p.z, 20))) continue;
        if (from && Math.min(...[a, b].map((p) => Math.hypot(p.x - from.x, p.z - from.z))) < from.r) continue;
        if (Math.min(h(a), h(b)) > -0.5) continue;
        worst = Math.max(worst, Math.abs(h(b) - h(a)) / Math.hypot(b.x - a.x, b.z - a.z));
      }
    }
    return worst;
  };
  // Rosedale Valley Road: 15% at the SRTM build's west taper; now under 10% where the flat city's cut hands over to the
  // ravine, and about the ravine rule's 5% on the way down from 150 m past the bridge (6.4% where the rule fades out
  // 300-450 m from it, 6.1% on the south transition's climb back to the flat city)
  const [A, B] = D.alterations.ravine.bridge, mid = { x: (A[0] + B[0]) / 2, z: (A[1] + B[1]) / 2 };
  assert.ok(steepest('Rosedale Valley Road', false) < 0.10, `Rosedale Valley Road ${(steepest('Rosedale Valley Road', false) * 100).toFixed(1)}%`);
  assert.ok(steepest('Rosedale Valley Road', false, { ...mid, r: 150 }) < 0.07, 'down the ravine');
  // the ramps the SRTM build reported at 38% and 22% now lie on the lidar's own embankments
  assert.ok(steepest('Bayview-Bloor Ramp', true) < 0.12, `Bayview-Bloor Ramp ${(steepest('Bayview-Bloor Ramp', true) * 100).toFixed(1)}%`);
  assert.ok(steepest('Drumsnab Road', true) < 0.12);
  for (const n of ['Bayview Avenue', 'Don Valley Parkway']) assert.ok(steepest(n, false) < 0.08, n);
  // what is still over 12% in the playable city is recorded for review: Royal Drive's ramp and service lanes down the
  // ravine's sides (st-wt0.21.2)
  const review = D.diagnostics.roads.filter((r) => r.review && r.at[1] > -3000);
  assert.ok(review.every((r) => r.maxGradePct > 12));
  assert.deepEqual([...new Set(review.map((r) => r.name))].sort(), ['(unnamed)', 'Royal Drive']);
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
    const x = D.box.x0 + rand() * 1020, z = D.box.z0 + rand() * 1620;
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
  // the ramps down the valley's sides hug their own ground
  const ramp = ON.DECKS.filter((d) => d.name === 'Bayview-Bloor Ramp').flatMap((d) => d.pts).find((p) => DV.inBox(p.x, p.z) && (p.g ?? 0) < -10);
  assert.ok(ramp && Math.abs(ramp.h - ramp.g - 0.35) < 1e-9, 'a ramp 0.35 m over its ground');
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
