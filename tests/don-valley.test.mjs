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
  assert.match(D.source.dataset, /AWS Terrain Tiles/);
  assert.match(D.crs.horizontal, /Union Station/);
  assert.match(D.crs.vertical, /sea level/);
  assert.match(D.datum, /y = DEM - T/);
  assert.equal(D.box.step, 10);
  for (const k of ['height', 'raw', 'datumGrid', 'unconditioned']) assert.equal(grid(D[k], 1).length, D.nx * D.nz, k);
  for (const rule of ['bridge', 'cover', 'roads', 'portals', 'boundary', 'footing']) assert.ok(D.alterations[rule], `alteration ${rule} recorded`);
  // (aligned with js/terrain.js's 60 m grid, so its cells are either the pilot's or its own)
  for (const v of [D.box.x0, D.box.x1, D.box.z0, D.box.z1]) assert.equal((v + 26000) % 60, 0);
});

test('datum mapping: the Don under the viaduct lies ~35 m below a street datum ~112 m above sea level', () => {
  const raw = grid(D.raw, 10), datum = grid(D.datumGrid, 10), unc = grid(D.unconditioned, 100);
  // the river under the viaduct, south of the bridge's own deck in the DEM
  const [x, z] = [2280, -2880];
  const r = node(raw, x, z), t = node(datum, x, z), u = node(unc, x, z);
  assert.ok(r > 72 && r < 80, `the Don's floor ${r} m above sea level`);
  assert.ok(t > 106 && t < 118, `the street datum there ${t} m`);
  assert.ok(Math.abs(u - (r - t)) < 2.5, `game height ${u} = DEM ${r} - datum ${t}`);
  assert.ok(Math.abs(DV.heightAt(x, z) - u) < 1.5, 'unconditioned on the valley floor');
  // the viaduct's ends meet the datum on the tableland (Castle Frank 111.7 m, Broadview 113.4 m in the build)
  for (const v of D.diagnostics.datumAtViaductEnds) assert.ok(v > 106 && v < 118, `datum at the viaduct's ends: ${v}`);
  // the road deck stands ~35 m over the Don (the real viaduct: about 40 m)
  assert.ok(D.diagnostics.viaduct.deckOverFloorM > 30 && D.diagnostics.viaduct.deckOverFloorM < 42);
  assert.ok(D.diagnostics.deepestM < -30 && D.diagnostics.deepestM > -42);
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
  assert.equal(DV.heightAt(1700, -2750), 0);
  // the south transition: the valley floor climbs back to the city's plane, no step
  let prev = -Infinity;
  for (let z = -2600; z <= -1880; z += 10) {
    let floor = 0;
    for (let x = 2100; x <= 2600; x += 10) floor = Math.min(floor, DV.heightAt(x, z));
    assert.ok(floor >= prev - 1.2, `no dip at z ${z}`);
    prev = floor;
  }
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

test('the build is reproducible from the DEM cache', { skip: !fs.existsSync(path.join(process.env.GEO_DATA || path.join(os.homedir(), '.cache/slop-toronto/osm-ids'), 'dem.i16')) && 'no DEM cache (GEO_DATA)' }, () => {
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

test('Castle Frank and Broadview: platforms 9 m below the street, a climb within 4% to the viaduct 5.8 m down', () => {
  const st = (id) => ON.SUBWAY_TOPOLOGY.stations.find((s) => s.id === id);
  for (const id of ['castle-frank', 'broadview']) {
    const d = st(id).facts.depth;
    assert.equal(d.worldDatum, 'viaduct', 'the flat city keeps the viaduct datum');
    assert.equal(d.donValley.platformFloor.value, -9);
    assert.equal(d.donValley.platformFloor.basis, 'assumed');
    assert.equal(DV.platformFloor(id), -9);
  }
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
    assert.ok(grade <= 0.04, `${r.id}: steepest grade ${(grade * 100).toFixed(1)}%`);
    assert.equal(ride.pairs[0].routes[0].profile[2][1], D.railY);
    // on the viaduct the rails are on the lower deck; at both platforms 10.1 m down
    const mid = (r.open0 + r.open1) / 2;
    assert.equal(ON_SAMPLE(r, mid), D.railY);
    for (const call of r.calls) assert.equal(ON_SAMPLE(r, call - 70.5), -10.1);
  }
  // the platform cells stand at their depth, and a passenger alights onto the floor
  for (const s of pair.stations) assert.ok(Math.abs(s.group.position.y - -10.1) < 1e-9, `${s.id} platform cell`);
  assert.equal(ride.enterStation('castle-frank', 0), true);
  assert.ok(Math.abs(person.position.y - -9) < 1e-9, `on Castle Frank's platform at ${person.position.y}`);
  assert.ok(controller.interiorSpace);
  assert.equal(ride.exit({ cancel: true }), true);
  // the ride: seated at Castle Frank, the train climbs onto the viaduct and down again into Broadview
  assert.equal(ride.featured(), true);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 3000 && !(ride.car.stopIndex === 1 && ride.car.doorState === 'open'); i++) {
    ride.update(0.1);
    lo = Math.min(lo, ride.car.sections[0].y); hi = Math.max(hi, ride.car.sections[0].y);
  }
  assert.equal(ride.car.track.destination.id, 'broadview');
  assert.ok(Math.abs(hi - D.railY) < 1e-6 && Math.abs(lo - -10.1) < 0.2, `rails from ${lo} to ${hi}`);
});
function ON_SAMPLE(route, s) { return +ON_SAMPLE.f(route, s).toFixed(6); }
ON_SAMPLE.f = (route, s) => {
  const P = route.profile;
  if (s <= P[0][0]) return P[0][1];
  for (let i = 1; i < P.length; i++) if (s <= P[i][0]) { const [s0, y0] = P[i - 1], [s1, y1] = P[i]; return y0 + (y1 - y0) * ((s - s0) / ((s1 - s0) || 1)); }
  return P.at(-1)[1];
};
