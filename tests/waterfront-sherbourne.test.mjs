// Sherbourne Common (js/waterfront-sherbourne.js): 'Light Showers' (three squared-shepherd-hook cantilever arms — a
// concrete upper beam at 8.9 m, a rounded metal lower spout beam at ~6 m, suspension cables and a water curtain) and
// Rafael Lozano-Hemmer's 'Unfinished Arch' (a 2 m x 0.4 m silver ribbon, apex 9 m, ~2.4 m reachable free edge, single
// ground contact). The tests check the placements against the loaded park polygons and channel water, the corrected
// curved profiles and bounds, that all geometry is finite, and that the module does not duplicate the rink / channel /
// (unmapped) pavilion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';

const read = (file) => fs.readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const makeContext = () => {
  const context = vm.createContext({
    window: { CITY: { THREE } }, console: { info() {}, log() {}, warn() {} },
    location: { search: '' }, URLSearchParams, Buffer, performance,
    atob: (s) => Buffer.from(s, 'base64').toString('binary')
  });
  for (const file of ['toronto-geodata.js', 'high-park-data.js', 'don-valley.js', 'city-config.js', 'waterfront-sherbourne.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  return context.window.CITY;
};
const C = makeContext();
const PARKS = C.sherbourneParks();
const SHOWERS = C.lightShowersPositions();
const ARCH = C.archSpec();

const pointInRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
};

const scene = { added: [], add(object) { this.added.push(object); } };
const built = C.createWaterfrontSherbourne(THREE, scene);
const mesh = (name) => built.group.getObjectByName(`WaterfrontSherbourne-${name}`);

test('the two Sherbourne Common park polygons resolve by name (north = lower z), never by index', () => {
  assert.ok(PARKS, 'both park rings resolve');
  assert.ok(PARKS.north.ring.length >= 6 && PARKS.south.ring.length >= 4, 'rings have vertices');
  assert.ok(PARKS.north.cz < PARKS.south.cz, 'the north park has the lower z centroid');
  assert.ok(ringArea(PARKS.north.ring) > 4000 && ringArea(PARKS.north.ring) < 7000, `north ${Math.round(ringArea(PARKS.north.ring))} m²`);
  assert.ok(ringArea(PARKS.south.ring) > 9000 && ringArea(PARKS.south.ring) < 14000, `south ${Math.round(ringArea(PARKS.south.ring))} m²`);
});

test('THREE Light Showers: two mapped OSM nodes + equal-spacing midpoint (the fact sheet says three, not eight)', () => {
  assert.equal(SHOWERS.length, 3, 'three sculptural elements (correcting the "eight" typo)');
  assert.equal(SHOWERS.map((p) => p.id).join(','), 'lightShowersA,lightShowersB,lightShowersC');
  assert.ok(Math.abs(SHOWERS[0].node.x - 1205.7) < 0.01 && Math.abs(SHOWERS[0].node.z - 335.3) < 0.01, 'node A is the OSM point');
  assert.equal(SHOWERS[0].osm, '3049761651', 'node A records the public-art OSM id');
  assert.ok(Math.abs(SHOWERS[2].node.x - 1191.5) < 0.01 && Math.abs(SHOWERS[2].node.z - 246.9) < 0.01, 'node C is the second OSM point');
  assert.ok(Math.abs(SHOWERS[1].node.x - (SHOWERS[0].node.x + SHOWERS[2].node.x) / 2) < 0.01, 'B is the midpoint node x');
  assert.ok(Math.abs(SHOWERS[1].node.z - (SHOWERS[0].node.z + SHOWERS[2].node.z) / 2) < 0.01, 'B is the midpoint node z');
  const sp = C.lightShowerSpacing();
  assert.ok(Math.abs(sp.ab - sp.bc) < 0.1, `equal spacing (${sp.ab.toFixed(1)} vs ${sp.bc.toFixed(1)} m)`);
  for (const p of SHOWERS) assert.ok(pointInRing(PARKS.north.ring, p.node.x, p.node.z), `${p.id} node is inside the north park`);
});

test('each Light Showers base is on the SIDE of the raised pool (channel west edge), not mid-water, offset recorded', () => {
  for (const p of SHOWERS) {
    assert.ok(p.offsetWest > 1 && p.offsetWest < 8, `${p.id}: recorded west offset ${p.offsetWest.toFixed(2)} m`);
    assert.ok(p.base.x < p.node.x, `${p.id}: the base is west of the mapped POI node`);
    // the leg base itself is on the deck side (dry), while the node may sit over the channel water
    assert.equal(!!C.waterAt(p.base.x, p.base.z), false, `${p.id}: the base is on dry deck`);
  }
});

test('Light Showers silhouette is two cantilever arms (upper 8.9 m, lower ~6 m), not an upright glass rectangle', () => {
  const upper = C.showerUpperProfile();
  const lower = C.showerLowerProfile();
  // upper concrete arm: a leaning leg bending into a horizontal beam whose TOP is 8.9 m
  const upperTop = Math.max(...upper.map((p) => p[1])) + C.SHOWER_PROFILE.upperThickness / 2;
  assert.ok(Math.abs(upperTop - 8.9) < 0.05, `upper beam top ${upperTop.toFixed(2)} m = 8.9 m`);
  // the beam is horizontal: the last >=2 points share the top height and reach east
  assert.ok(upper[upper.length - 1][0] > upper[1][0], 'the upper beam cantilevers east');
  assert.ok(Math.abs(upper[upper.length - 1][1] - upper[1][1]) < 1e-6, 'the upper beam is horizontal');
  // lower metal arm: a genuinely curved profile (many points) with its beam top ~6 m
  assert.ok(lower.length >= 10, `the lower arm is a curved profile (${lower.length} points)`);
  const lowerTop = Math.max(...lower.map((p) => p[1])) + C.SHOWER_PROFILE.lowerThickness / 2;
  assert.ok(Math.abs(lowerTop - 6.0) < 0.15, `lower beam top ${lowerTop.toFixed(2)} m = ~6 m`);
  // it is NOT the old full-height opaque rectangle: the built meshes are arms/cables/curtains, not Scrim+Glass
  assert.ok(mesh('UpperArms') && mesh('LowerArms'), 'upper and lower arms are built');
  assert.equal(mesh('Scrims'), undefined, 'no old upright scrim rectangle');
  assert.equal(mesh('Glass'), undefined, 'no old glass rectangle');
  // three elements' worth of parts
  assert.equal(mesh('UpperArms').count, 3 * (upper.length - 1), 'upper arm segments for three elements');
  assert.equal(mesh('Cables').count, 3 * C.SHOWER_PROFILE.cables, 'suspension cables for three elements');
  assert.equal(mesh('Curtains').count, 3, 'a water curtain per element');
  assert.equal(mesh('Footings').count, 3, 'a footing per element');
  // the water curtain is a broad thin sheet, not an opaque panel to the ground, and its broad face is visible from the
  // oblique side view (broad along X, thin along Z)
  const P = C.SHOWER_PROFILE;
  assert.ok(P.curtainWidth > 0.6 && P.curtainThickness < 0.3, 'the water curtain is broad and thin');
  const cm = new THREE.Matrix4(), cp = new THREE.Vector3(), cq = new THREE.Quaternion(), cs = new THREE.Vector3();
  mesh('Curtains').getMatrixAt(0, cm); cm.decompose(cp, cq, cs);
  assert.ok(cs.x > cs.z * 5, `the curtain is broad along X (${cs.x.toFixed(2)}) and thin along Z (${cs.z.toFixed(2)})`);
});

test('Unfinished Arch is a broad flat silver ribbon (2 m x 0.4 m) with a ~2.4 m reachable free edge and single foot', () => {
  assert.ok(ARCH, 'the arch resolves');
  assert.equal(ARCH.height, 9.0, '9 m high (construction notice)');
  assert.equal(ARCH.cantilever, 14.0, '14 m cantilever (construction notice)');
  assert.equal(ARCH.ribbonWidth, 2.0, 'a 2 m-wide ribbon (photo)');
  assert.equal(ARCH.ribbonThickness, 0.4, 'a 0.4 m-thick ribbon (photo)');
  // base on dry land in the south park (single ground contact)
  assert.ok(pointInRing(PARKS.south.ring, ARCH.base.x, ARCH.base.z), 'the foot is inside the south park');
  assert.equal(!!C.waterAt(ARCH.base.x, ARCH.base.z), false, 'the foot is on dry land');
  // a genuinely curved, smooth profile (many points; apex in the middle, not the tip)
  assert.ok(ARCH.points.length >= 15, `smooth segmented ribbon (${ARCH.points.length} points)`);
  assert.ok(ARCH.apex.y > ARCH.points[0].y + 5 && ARCH.apex.y > ARCH.tip.y + 4, 'the apex is above both the foot and the tip');
  const apexIndex = ARCH.points.indexOf(ARCH.points.reduce((m, p) => (p.y > m.y ? p : m), ARCH.points[0]));
  assert.ok(apexIndex > 0 && apexIndex < ARCH.points.length - 1, 'the apex is mid-span (the ribbon rises then descends)');
  // the free tip is the reachable ~2.4 m edge, well above ground (not 3.5 m, and not touching)
  assert.ok(Math.abs(ARCH.tip.y - 2.4) < 0.2, `free edge ${ARCH.tip.y.toFixed(2)} m above ground`);
  const reach = Math.hypot(ARCH.tip.x - ARCH.base.x, ARCH.tip.z - ARCH.base.z);
  assert.ok(Math.abs(reach - 14.0) < 0.4, `horizontal reach ${reach.toFixed(2)} m`);
  // exactly one ground contact: only the first point is at ground, every other floats
  assert.ok(Math.abs(ARCH.points[0].y) < 1e-6, 'the first point is the ground foot');
  assert.equal(ARCH.points.slice(1).filter((p) => Math.abs(p.y) < 1e-6).length, 0, 'no second ground contact');
  // a narrower hanging touch piece ~1.8 m under the free edge
  assert.ok(ARCH.touchPieceHeight === 1.8, 'the touch piece is at 1.8 m');
  assert.equal(mesh('ArchTouchPiece').count, 1, 'the hanging touch piece is built');
  // the ribbon body is ONE continuous indexed mesh (no per-segment gaps / air seams)
  const ribbon = mesh('UnfinishedArch');
  assert.ok(ribbon && ribbon.isMesh && !ribbon.isInstancedMesh, 'the ribbon is a single continuous mesh, not instanced segments');
  assert.ok(ribbon.geometry.index, 'the ribbon is indexed (shared vertices, closed)');
  assert.equal(ribbon.geometry.userData.continuous, true, 'the ribbon is marked continuous');
  assert.equal(ribbon.geometry.attributes.position.count, 4 * (ARCH.points.length), 'four shared cross-section corners per station');
  assert.equal(ribbon.geometry.userData.segments, ARCH.points.length - 1, 'stations join with no gaps');
  // no vertex dips below the ground (the single contact is the foot)
  const pos = ribbon.geometry.attributes.position.array;
  let minY = Infinity;
  for (let i = 1; i < pos.length; i += 3) minY = Math.min(minY, pos[i]);
  assert.ok(minY >= -1e-6, `the ribbon does not dip below ground (min y ${minY.toFixed(2)})`);
});

test('all built geometry is finite (no NaN / Infinity vertices or matrices)', () => {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const obj of built.group.children) {
    assert.ok(obj.isInstancedMesh || obj.isMesh, `${obj.name} is a mesh`);
    if (obj.isInstancedMesh) {
      for (let i = 0; i < obj.count; i++) {
        obj.getMatrixAt(i, m);
        m.decompose(p, q, s);
        for (const v of [p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]) {
          assert.ok(Number.isFinite(v), `${obj.name}[${i}] has a finite component`);
        }
      }
    } else {
      const pos = obj.geometry.attributes.position.array;
      for (const v of pos) assert.ok(Number.isFinite(v), `${obj.name} has a finite vertex`);
    }
  }
});

test('no duplication: the rink, the channel water and the (unmapped) pavilion are not rebuilt', () => {
  for (const bad of ['rink', 'channel', 'pavilion', 'ice', 'splash']) {
    for (const m of built.group.children) assert.ok(!new RegExp(bad, 'i').test(m.name), `no ${bad} mesh is built`);
  }
  assert.equal(built.stats.existing.rink.id, 'city-rink:43569');
  assert.equal(built.stats.existing.pavilion.mapped, false);
  const rinkData = fs.readFileSync(new URL('../js/toronto-rinks.js', import.meta.url), 'utf8');
  assert.ok(rinkData.includes('Paul Quarrington'), 'the rink already exists in js/toronto-rinks.js');
});

test('the built park art: one culling root, shared instanced geometry, bounded triangles', () => {
  assert.equal(scene.added.length, 1);
  assert.equal(built.group.name, 'WaterfrontSherbourne');
  assert.equal(built.root, built.group);
  assert.equal(built.group.userData.waterfrontSherbourne, built.stats);
  assert.equal(built.stats.meshes, built.group.children.length);
  for (const name of ['UpperArms', 'LowerArms', 'Footings', 'Cables', 'Curtains']) {
    const m = mesh(name);
    assert.ok(m && m.isInstancedMesh, `${name} is instanced`);
    assert.ok(m.userData.cullDistance > 0 && m.userData.cullCell > 0, `${name} has culling metadata`);
  }
  // the arch ribbon is a single continuous mesh, and the touch piece is instanced (one)
  const ribbon = mesh('UnfinishedArch');
  assert.ok(ribbon && ribbon.isMesh, 'the ribbon is a mesh');
  assert.ok(ribbon.userData.cullDistance > 0 && ribbon.userData.cullCell > 0, 'the ribbon has culling metadata');
  assert.equal(mesh('ArchTouchPiece').count, 1, 'the touch piece is one instance');
  assert.ok(ribbon.geometry.index.count / 3 > 100, 'the ribbon has many smooth triangles');
  assert.ok(built.stats.triangles > 100 && built.stats.triangles < 4000, `${built.stats.triangles} triangles`);
  assert.equal(built.colliders.length, 4, 'three shower footings + one arch foot');
});

test('exports a unique guard: waterfrontSherbourneSupported, never the shared supportedCityFrame', () => {
  assert.equal(typeof C.waterfrontSherbourneSupported, 'function');
  const src = read('waterfront-sherbourne.js');
  assert.equal(/\bfunction\s+supportedCityFrame\b/.test(src), false, 'does not define supportedCityFrame');
  assert.equal(/supportedCityFrame\s*,/.test(src), false, 'does not export supportedCityFrame');
  assert.ok(src.includes('waterfrontSherbourneSupported'));
});

test('frame guard: the fixed-coordinate art is not built in an unsupported map frame', () => {
  const guard = makeContext();
  assert.equal(guard.waterfrontSherbourneSupported(), true, 'the Toronto detail frame is supported');
  const fake = { added: [], add(object) { this.added.push(object); } };
  guard.GEO.frame.detail = { x0: 0, x1: 20, z0: 0, z1: 20 };
  const result = guard.createWaterfrontSherbourne(THREE, fake);
  assert.equal(result, null);
  assert.equal(fake.added.length, 0);
  assert.equal(guard.waterfrontSherbourneEnabled, false);
});

test('sources are recorded and the build is deterministic', () => {
  const source = read('waterfront-sherbourne.js');
  for (const needle of ['Sherbourne Common', 'Light Showers', 'Jill Anholt', 'Unfinished Arch', 'Lozano-Hemmer',
    'sherbourne-common', 'sherbourne-common-fact-sheet-1.pdf', 'jillanholt.ca/Light-Showers',
    'construction-notice-4-unfinished-arch-sherbourne-common', 'DSC_5872', 'Media%20Launch', 'Site%20Map',
    'equally spaced']) {
    assert.ok(source.includes(needle), `records ${needle}`);
  }
  // the doc comment must not repeat the "eight" typo
  assert.equal(/\beight\b/i.test(source), false, 'records THREE, not eight');
  assert.equal(/Math\.random\s*\(/.test(source), false, 'no random placement');
  assert.equal(typeof C.createWaterfrontSherbourne, 'function');
  assert.equal(C.buildWaterfrontSherbourne, C.createWaterfrontSherbourne);
  assert.equal(C.waterfrontSherbourneEnabled, true);
  const again = makeContext().lightShowersPositions();
  assert.ok(Math.abs(again[1].base.x - SHOWERS[1].base.x) < 0.01 && Math.abs(again[1].base.z - SHOWERS[1].base.z) < 0.01, 'base is deterministic');
});