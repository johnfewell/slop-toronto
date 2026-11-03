(function () {
// js/parked-cars.js
// The cars parked at Toronto's curbs (docs/parked-cars.md): window.CITY.PARKED_CARS (tools/build-parked-cars.mjs, from
// js/parking-layout.js's legal stalls; packed in data/toronto-geodata.bin) built as static instanced vehicles with the
// traffic's bodies, plates and paint (actor-models.js; their lamps off), each a solid box for the player and the walkers,
// and kept out of the traffic's way:
// - the cars are audited against the lanes road-network.js actually built (a lane's centre keeps LANE_CLEAR from a car's
//   body, LOCAL_LANE_CLEAR on a local street; a car too close is left out and counted) and against the CaféTO platforms
//   the page built
// - the traffic's swerves round the player test parkedAt (traffic.js wayRound), as they test the curbs
// - on a terrain pilot's relief (High Park's; the Don Valley's with ?donvalley=1) a car where the ground leaves the street level is left out: the stalls were
//   laid out on the flat city, and these stand at y 0
// - the quality tier caps how many (a seeded share, the same on every visit) and sets the distances: the full model with
//   its wheels within Q.parkedNear (casting shadows on the tiers that allow it), the ~250-triangle stand-in out to
//   Q.parkedFar; nothing further. The instances are re-picked from 64 m cells when the camera has moved or turned.
// ?parked=0 leaves them out (for before/after captures). Nothing here touches multiplayer: every client places the same.
//
// The cars come packed in data/toronto-geodata.bin (window.CITY.PARKED_CARS, the layer of js/toronto-parked-cars.js:
// tools/geo-bin.mjs). It holds their stalls, not the cars: everything a stall's seed decides (the body, the paint, the
// jitter on the stall, the tier order) is drawn again here by drawParkedCar, the very function
// tools/build-parked-cars.mjs placed them with, so only what no seed gives is stored (docs/parked-cars.md#packed), in
// integer columns with one value per car:
// - cat; heading (the curb's, 1e-4 rad); side (which way the curb lies from it)
// - major, minor: the stall's position in cm as a step from the stall before, along the axis the heading (nearly) runs
//   along and across it, less what the heading predicts for it (curbFrame)
// - cx, cz, cy: the placed x, z (cm) and yaw (1e-4 rad) less decodeParkedCars' prediction of them from those (the stall's
//   metres and direction are rounded here), small corrections
// Everything here is + - * / Math.round & Math.imul, never Math.sin or Math.atan2 (which may differ by an ulp between
// browsers), so every browser gets the very rows the node build wrote.

const KINDS = ['sedan', 'suv', 'minivan', 'pickup', 'van'];
const CATS = ['paid', 'restricted', 'permit', 'local'];
const FIELDS = ['x', 'z', 'yaw', 'kind', 'paint', 'style', 'cat', 'order']; // (a decoded car's row)
// The parked fleet: of every 100 cars (no taxis or police here; vans more likely on the paid, commercial curbs)
const MIX = { sedan: 36, suv: 38, minivan: 12, pickup: 7, van: 7 };
// paint [hex, metallic, trim, wheel, weight]: Canada's car colours (white, black, grey & silver about three in four)
const PAINT = [
  [0xeef0f2, 0, 0, 0, 16], [0xf0f3f7, 1, 1, 0, 6], [0x1c2026, 1, 1, 1, 14], [0x16191e, 1, 2, 3, 6],
  [0x5a5f66, 1, 0, 2, 11], [0x3a434d, 1, 0, 2, 5], [0xc8ced4, 1, 1, 0, 9], [0xaab2bb, 1, 0, 1, 5],
  [0x1d3557, 1, 1, 1, 6], [0x2b3b4f, 1, 0, 1, 3], [0x6e1f24, 1, 0, 0, 4], [0x8f1c22, 1, 2, 2, 4],
  [0xb59a6a, 1, 1, 0, 2], [0x2f4a35, 1, 0, 1, 2], [0x7a7f86, 0, 0, 3, 3], [0xd9d2c3, 0, 1, 0, 2], [0x24406e, 1, 1, 0, 2]
];
const VAN_PAINT = [[0xf4f5f6, 0, 2, 0, 6], [0xf0f1f2, 0, 2, 3, 3], [0xb9c0c7, 1, 2, 0, 2], [0x15181c, 1, 2, 3, 1]];
// half widths of the bodies (actor-models.js BODY_SPECS, with the arches' flare): where the car's side is
const HALF_WIDTH = { sedan: 0.95, suv: 0.97, minivan: 0.97, pickup: 1.0, van: 0.98 };

// FNV-1a over the four bytes of n
function fnv(h, n) {
  for (let b = 0; b < 4; b++) { h ^= n & 255; h = Math.imul(h, 16777619); n >>= 8; }
  return h;
}
const stallHash = (X, Z) => fnv(fnv(2166136261, X | 0), Z | 0);
// seed k of a stall's hash, in [0, 1): finished by a murmur mix
function seedOf(hash, k) {
  let h = fnv(hash, k * 100);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** Seed k of the stall at (X, Z) cm */
const stallSeed = (X, Z, k) => seedOf(stallHash(X, Z), k);
// the entry r in [0, 1) lands on, by the weights
function weighted(weights, total, r) {
  let t = r * total;
  for (let i = 0; i < weights.length; i++) { t -= weights[i]; if (t < 0) return i; }
  return weights.length - 1;
}
const sum = (list) => list.reduce((t, w) => t + w, 0);
const KIND_WEIGHT = KINDS.map((k) => MIX[k]), PAID_KIND_WEIGHT = KINDS.map((k) => MIX[k] * (k === 'van' ? 2 : 1));
const PAINT_WEIGHT = PAINT.map((p) => p[4]), VAN_PAINT_WEIGHT = VAN_PAINT.map((p) => p[4]);
const VAN = KINDS.indexOf('van'), PAID = CATS.indexOf('paid'), RESTRICTED = CATS.indexOf('restricted');
const TOTALS = { kind: sum(KIND_WEIGHT), paid: sum(PAID_KIND_WEIGHT), paint: sum(PAINT_WEIGHT), van: sum(VAN_PAINT_WEIGHT) };
const HALF_WIDTHS = KINDS.map((k) => HALF_WIDTH[k]);

/** What the seeds of the stall at (X, Z) cm, of category `cat` (index), decide: the car, and where on the stall it stands */
function drawParkedCar(X, Z, cat) {
  const hash = stallHash(X, Z);
  // vans on the paid & restricted curbs (deliveries) twice as often
  const paid = cat === PAID || cat === RESTRICTED;
  const kind = paid ? weighted(PAID_KIND_WEIGHT, TOTALS.paid, seedOf(hash, 2)) : weighted(KIND_WEIGHT, TOTALS.kind, seedOf(hash, 2));
  const p = kind === VAN ? VAN_PAINT[weighted(VAN_PAINT_WEIGHT, TOTALS.van, seedOf(hash, 3))] : PAINT[weighted(PAINT_WEIGHT, TOTALS.paint, seedOf(hash, 3))];
  // a hair of variety in the paint (and so in the plate, which the material picks from it)
  const shade = 0.94 + 0.12 * seedOf(hash, 4), hex = p[0];
  const r = Math.min(255, Math.round((hex >> 16) * shade)), g = Math.min(255, Math.round(((hex >> 8) & 255) * shade)), b = Math.min(255, Math.round((hex & 255) * shade));
  return {
    kind, paint: (r << 16) | (g << 8) | b,
    style: (p[1] << 3) + (p[2] << 4) + (p[3] << 6), // (actor-models.js carStyleCode: no livery)
    // on the stall: against the curb (its side 0.15-0.35 m off it; the stall's centre line is 1.2 m off), a little forward
    // or back, a degree or two askew
    across: 1.05 - 0.2 * seedOf(hash, 5) - HALF_WIDTHS[kind],
    along: (seedOf(hash, 6) - 0.5) * 0.5,
    skew: (seedOf(hash, 7) - 0.5) * 0.05,
    order: Math.floor(seedOf(hash, 8) * 65536) // (the tiers keep the lowest)
  };
}

const QUARTER = Math.PI / 2;
/**
 * A curb's heading (1e-4 rad): its direction (tx, tz) and, for the steps from stall to stall, whether the step's major
 * axis is z and the slope that predicts the other axis from it. As polynomials: the same doubles in every engine.
 */
function curbFrame(heading) {
  const y = heading / 10000, q = Math.round(y / QUARTER), d = y - q * QUARTER, d2 = d * d;
  const sn = d * (1 - (d2 / 6) * (1 - (d2 / 20) * (1 - (d2 / 42) * (1 - d2 / 72))));
  const cs = 1 - (d2 / 2) * (1 - (d2 / 12) * (1 - (d2 / 30) * (1 - (d2 / 56) * (1 - d2 / 90))));
  const odd = q & 1, neg = q & 2; // (q = 0, 1, 2, 3 quarter turns, by its two low bits, negatives too)
  const tx = odd ? cs : sn, tz = odd ? -sn : cs;
  return { y, tx: neg ? -tx : tx, tz: neg ? -tz : tz, zMajor: !odd, slope: (odd ? -sn : sn) / cs };
}
/** A car on its stall from the rounded stall: x, z in cm and yaw in 1e-4 rad before their corrections */
const placedX = (X, c, frame, side) => Math.round(X + ((side ? -frame.tz : frame.tz) * c.across + frame.tx * c.along) * 100);
const placedZ = (Z, c, frame, side) => Math.round(Z + ((side ? frame.tx : -frame.tx) * c.across + frame.tz * c.along) * 100);
const placedYaw = (c, frame) => Math.round((frame.y + c.skew) * 10000);

/** window.CITY.PARKED_CARS (the packed columns) -> the rows [x, z, yaw, kind, paint, style, cat, order] */
function decodeParkedCars(P) {
  const n = P.cat.length, rows = new Array(n);
  let X = 0, Z = 0, frame = null, heading = NaN;
  for (let i = 0; i < n; i++) {
    if (P.heading[i] !== heading) frame = curbFrame((heading = P.heading[i]));
    const major = P.major[i], minor = P.minor[i] + Math.round(major * frame.slope);
    if (frame.zMajor) { Z += major; X += minor; } else { X += major; Z += minor; }
    const side = P.side[i], c = drawParkedCar(X, Z, P.cat[i]);
    rows[i] = [(placedX(X, c, frame, side) + P.cx[i]) / 100, (placedZ(Z, c, frame, side) + P.cz[i]) / 100,
      (placedYaw(c, frame) + P.cy[i]) / 10000, c.kind, c.paint, c.style, P.cat[i], c.order];
  }
  return rows;
}
Object.assign(window.CITY, { parkedCarCodec: { KINDS, CATS, FIELDS, stallSeed, drawParkedCar, curbFrame, placedX, placedZ, placedYaw, decodeParkedCars } });

const { THREE, BODY_SPECS, buildCarGeometry, buildCarProxyGeometry, createLoftedCarMaterial, createContactShadowMaterial, carStyleCode } = window.CITY;
const Q = window.CITY.QUALITY;
// m from a traffic lane's centre to a parked car's body: a bus's half width (1.28 m) & a little on the main roads (rank 2
// and up, where the buses run), a van's (0.98 m) & a little on the local streets
const LANE_CLEAR = 1.35, LOCAL_LANE_CLEAR = 1.15;
const CELL = 64;
const HEIGHT = { sedan: 1.45, suv: 1.75, minivan: 1.75, pickup: 1.9, van: 2.4 }; // collider heights (m)

// distance from the segment (ax, az)-(bx, bz) to the box centred (cx, cz), along (tx, tz), half sizes hl along & hw across
function segDistToBox(ax, az, bx, bz, cx, cz, tx, tz, hl, hw) {
  const toU = (x, z) => (x - cx) * tx + (z - cz) * tz, toV = (x, z) => (x - cx) * tz - (z - cz) * tx;
  const u0 = toU(ax, az), v0 = toV(ax, az), du = toU(bx, bz) - u0, dv = toV(bx, bz) - v0;
  let t0 = 0, t1 = 1, cross = true; // (crossing it: 0)
  for (const [p, q] of [[-du, u0 + hl], [du, hl - u0], [-dv, v0 + hw], [dv, hw - v0]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) { cross = false; break; } continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) { cross = false; break; }
  }
  if (cross) return 0;
  const box = (u, v) => Math.hypot(Math.max(0, Math.abs(u) - hl), Math.max(0, Math.abs(v) - hw));
  const L2 = du * du + dv * dv || 1e-12;
  const toSeg = (u, v) => { const t = Math.max(0, Math.min(1, ((u - u0) * du + (v - v0) * dv) / L2)); return Math.hypot(u0 + du * t - u, v0 + dv * t - v); };
  return Math.min(box(u0, v0), box(u0 + du, v0 + dv), toSeg(-hl, -hw), toSeg(hl, -hw), toSeg(hl, hw), toSeg(-hl, hw));
}

/**
 * Builds the parked cars. `network`: road-network.js's (edges & lanes, for the audit); `patioColliders`: the CaféTO
 * patios' colliders (a car on one is left out). Returns { group, colliders, update(camera), parkedAt(x, z, pad), stats }.
 */
function buildParkedCars(scene, network, { patioColliders = [] } = {}) {
  const t0 = performance.now();
  const DATA = window.CITY.PARKED_CARS;
  const off = new URLSearchParams(location.search).get('parked') === '0';
  const stats = { enabled: !off && !!DATA, tier: Q.tier, source: DATA?.counts || null, cap: Q.parkedCars, kept: 0, laneDropped: 0, laneDroppedBy: {}, laneDrops: [],
    patioDropped: 0, colliders: 0, near: 0, far: 0, ms: 0 };
  window.CITY.parkedStats = stats;
  const empty = { group: null, colliders: [], update() {}, parkedAt: () => false, stats };
  if (off || !DATA) return empty;
  const F = Object.fromEntries(FIELDS.map((k, i) => [k, i]));
  const DV = window.CITY.DON_VALLEY; // (the pilot: js/don-valley.js)

  // 0. the rows, from the packed stalls
  const td = performance.now();
  let rows = decodeParkedCars(DATA);
  stats.decodeMs = Math.round((performance.now() - td) * 10) / 10;

  // 1. the tier's share: the cars with the lowest seeded order
  if (rows.length > Q.parkedCars) rows = rows.slice().sort((a, b) => a[F.order] - b[F.order]).slice(0, Q.parkedCars);

  // 2. the audit: the lanes the traffic actually drives (road-network.js edges), the patios actually built
  const LG = 24, laneGrid = new Map();
  for (const e of network?.edges || []) {
    // (the lane lines from a little before the stop line back to the far end's: where a car could ever be)
    for (const o of e.lanes) {
      const ax = e.x0 + e.rx * o, az = e.z0 + e.rz * o, bx = ax + e.dx * e.span, bz = az + e.dz * e.span;
      const seg = [ax, az, bx, bz, e.bikeway ? 'bikeway' : e.divided ? 'divided' : e.general ? 'street' : 'grid',
        e.general && (e.rank || 0) <= 1 && !e.busOnly ? LOCAL_LANE_CLEAR : LANE_CLEAR];
      for (let i = Math.floor((Math.min(ax, bx) - 4) / LG); i <= Math.floor((Math.max(ax, bx) + 4) / LG); i++) {
        for (let j = Math.floor((Math.min(az, bz) - 4) / LG); j <= Math.floor((Math.max(az, bz) + 4) / LG); j++) {
          const k = i * 100003 + j;
          (laneGrid.get(k) || laneGrid.set(k, []).get(k)).push(seg);
        }
      }
    }
  }
  const patioBoxes = patioColliders.filter((c) => c.obb);
  const cars = [];
  for (const r of rows) {
    const kind = KINDS[r[F.kind]];
    const spec = BODY_SPECS[kind];
    if (!spec) continue;
    const yaw = r[F.yaw], tx = Math.sin(yaw), tz = Math.cos(yaw);
    const hl = (spec.zFront - spec.zRear) / 2, hw = Math.max(...spec.halfWidth.map((p) => p[1])) + spec.archFlare;
    const zc = (spec.zFront + spec.zRear) / 2; // (the body's centre along it, from the model's origin)
    const cx = r[F.x] + tx * zc, cz = r[F.z] + tz * zc;
    if (DV && (DV.lowestAround(cx, cz, hl) < -0.05 || (DV.highestAround && DV.highestAround(cx, cz, hl) > 0.05))) { stats.valleyDropped = (stats.valleyDropped || 0) + 1; continue; }
    let clash = null;
    const seen = new Set();
    for (const [qx, qz] of [[cx, cz], [cx + tx * hl, cz + tz * hl], [cx - tx * hl, cz - tz * hl]]) {
      for (const s of laneGrid.get(Math.floor(qx / LG) * 100003 + Math.floor(qz / LG)) || []) {
        if (seen.has(s)) continue;
        seen.add(s);
        if (segDistToBox(s[0], s[1], s[2], s[3], cx, cz, tx, tz, hl, hw) < s[5]) { clash = s[4]; break; }
      }
      if (clash) break;
    }
    if (clash) {
      // (counted by the kind of road whose lane it is: one whose lanes moved off a bikeway, a divided road's, a street's)
      stats.laneDropped++;
      stats.laneDroppedBy[clash] = (stats.laneDroppedBy[clash] || 0) + 1;
      if (stats.laneDrops.length < 40) stats.laneDrops.push([Math.round(cx), Math.round(cz), clash]);
      continue;
    }
    if (patioBoxes.some((c) => cx + 4 > c.minX && cx - 4 < c.maxX && cz + 4 > c.minZ && cz - 4 < c.maxZ &&
      Math.abs((cx - c.obb.cx) * c.obb.cs - (cz - c.obb.cz) * c.obb.sn) < c.obb.hx + hw + 0.3 &&
      Math.abs((cx - c.obb.cx) * c.obb.sn + (cz - c.obb.cz) * c.obb.cs) < c.obb.hz + hl + 0.3)) { stats.patioDropped++; continue; }
    const paint = new THREE.Color(r[F.paint]);
    cars.push({ kind, x: r[F.x], z: r[F.z], yaw, tx, tz, cx, cz, hl, hw, paint: [paint.r, paint.g, paint.b],
      style: r[F.style] | carStyleCode({ parked: true }), cat: CATS[r[F.cat]] });
  }
  stats.kept = cars.length;

  // 3. colliders: a turned box each, as tall as the body (the walkers & riders meet it, the car is stopped by it)
  const { boxCollider } = window.CITY.WorldCollision;
  const colliders = cars.map((c) => {
    const col = boxCollider(c.cx, c.cz, c.hw, c.hl, c.yaw, 0, HEIGHT[c.kind] || 1.6, 'parkedCar');
    c.collider = col;
    return col;
  });
  stats.colliders = colliders.length;

  // 4. cells, for the instance picking and parkedAt
  const cells = new Map();
  cars.forEach((c, i) => {
    const k = Math.floor(c.cx / CELL) * 100003 + Math.floor(c.cz / CELL);
    let cell = cells.get(k);
    if (!cell) cells.set(k, (cell = { x: (Math.floor(c.cx / CELL) + 0.5) * CELL, z: (Math.floor(c.cz / CELL) + 0.5) * CELL, ids: [] }));
    cell.ids.push(i);
  });
  // is (x, z) on a parked car (within pad)? (traffic.js: a swerve never goes there)
  function parkedAt(x, z, pad = 0.2) {
    for (let i = Math.floor((x - 6) / CELL); i <= Math.floor((x + 6) / CELL); i++) {
      for (let j = Math.floor((z - 6) / CELL); j <= Math.floor((z + 6) / CELL); j++) {
        const cell = cells.get(i * 100003 + j);
        if (!cell) continue;
        for (const id of cell.ids) {
          const c = cars[id], dx = x - c.cx, dz = z - c.cz;
          if (Math.abs(dx * c.tx + dz * c.tz) <= c.hl + pad && Math.abs(dx * c.tz - dz * c.tx) <= c.hw + pad) return true;
        }
      }
    }
    return false;
  }

  // 5. the meshes: per body kind, the full model (wheels and all, lamps off) and the stand-in; and the contact shadows
  const group = new THREE.Group();
  group.name = 'ParkedCars';
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const c of cars) counts[c.kind]++;
  const meshes = {};
  const shadowSize = {};
  for (const kind of KINDS) {
    const spec = BODY_SPECS[kind];
    if (!spec || !counts[kind]) continue;
    const n = counts[kind];
    const mat = createLoftedCarMaterial(spec);
    const lod = (geo, shadows) => {
      geo.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = 0;
      m.frustumCulled = false; // (picked per cell below)
      m.castShadow = shadows;
      m.receiveShadow = true;
      m.name = `ParkedCars:${kind}`;
      group.add(m);
      return m;
    };
    meshes[kind] = { near: lod(buildCarGeometry(spec, true), !!Q.parkedShadows), far: lod(buildCarProxyGeometry(spec), false) };
    const hw = Math.max(...spec.halfWidth.map((p) => p[1])) + spec.archFlare;
    shadowSize[kind] = [2 * hw + 0.33, spec.zFront - spec.zRear + 0.55, (spec.zFront + spec.zRear) / 2];
  }
  const unitPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadowMesh = new THREE.InstancedMesh(unitPlane, createContactShadowMaterial(), Math.max(1, cars.length));
  shadowMesh.count = 0;
  shadowMesh.frustumCulled = false;
  shadowMesh.renderOrder = 998;
  shadowMesh.name = 'ParkedCars:contactShadow';
  group.add(shadowMesh);
  scene.add(group);

  // each car's matrices, once
  const dummy = new THREE.Object3D();
  for (const c of cars) {
    dummy.position.set(c.x, 0, c.z);
    dummy.rotation.set(0, c.yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    c.matrix = dummy.matrix.toArray(new Float32Array(16));
    const [w, l, zc] = shadowSize[c.kind];
    dummy.position.set(c.x + c.tx * zc, 0.018, c.z + c.tz * zc);
    dummy.scale.set(w, 1, l);
    dummy.updateMatrix();
    c.shadow = dummy.matrix.toArray(new Float32Array(16));
  }

  // 6. picking: the cells in view within the far distance, re-picked when the camera has moved 2 m or turned
  const frustum = new THREE.Frustum(), projView = new THREE.Matrix4(), sphere = new THREE.Sphere();
  const last = { x: Infinity, z: Infinity, y: Infinity, fx: 0, fy: 0, fz: 0, dist: 0 };
  const fwd = new THREE.Vector3();
  const CELL_R = CELL * Math.SQRT1_2 + 4;
  function write(mesh, c) {
    const i = mesh.count++;
    mesh.instanceMatrix.array.set(c.matrix, i * 16);
    const a = mesh.geometry.attributes;
    a.paintColor.array.set(c.paint, i * 3);
    const s = a.carState.array;
    s[i * 4] = 0; s[i * 4 + 1] = 0; s[i * 4 + 2] = 0; s[i * 4 + 3] = c.style;
  }
  function update(camera, force = false) {
    const p = camera.position;
    camera.getWorldDirection(fwd);
    const dist = Q.dist || 1;
    if (!force && Math.hypot(p.x - last.x, p.z - last.z) < 2 && Math.abs(p.y - last.y) < 2 &&
        fwd.x * last.fx + fwd.y * last.fy + fwd.z * last.fz > 0.9995 && dist === last.dist) return;
    Object.assign(last, { x: p.x, y: p.y, z: p.z, fx: fwd.x, fy: fwd.y, fz: fwd.z, dist });
    camera.updateMatrixWorld();
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    const nearD = Q.parkedNear * dist, farD = Q.parkedFar * dist;
    for (const m of Object.values(meshes)) { m.near.count = 0; m.far.count = 0; }
    shadowMesh.count = 0;
    const r = farD + CELL_R;
    for (let i = Math.floor((p.x - r) / CELL); i <= Math.floor((p.x + r) / CELL); i++) {
      for (let j = Math.floor((p.z - r) / CELL); j <= Math.floor((p.z + r) / CELL); j++) {
        const cell = cells.get(i * 100003 + j);
        if (!cell) continue;
        const dc = Math.hypot(cell.x - p.x, cell.z - p.z);
        if (dc - CELL_R > farD) continue;
        sphere.center.set(cell.x, 1, cell.z);
        sphere.radius = CELL_R;
        if (!frustum.intersectsSphere(sphere)) continue;
        for (const id of cell.ids) {
          const c = cars[id];
          const d = Math.hypot(c.cx - p.x, c.cz - p.z, p.y);
          if (d > farD) continue;
          sphere.center.set(c.cx, 1, c.cz);
          sphere.radius = c.hl + 1;
          if (!frustum.intersectsSphere(sphere)) continue;
          write(d < nearD ? meshes[c.kind].near : meshes[c.kind].far, c);
          if (d < farD * 0.6) {
            shadowMesh.instanceMatrix.array.set(c.shadow, shadowMesh.count * 16);
            shadowMesh.count++;
          }
        }
      }
    }
    stats.near = stats.far = 0;
    for (const m of Object.values(meshes)) {
      stats.near += m.near.count;
      stats.far += m.far.count;
      for (const mesh of [m.near, m.far]) {
        if (!mesh.count) continue;
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
        mesh.instanceMatrix.needsUpdate = true;
        for (const [name, size] of [['paintColor', 3], ['carState', 4]]) {
          const a = mesh.geometry.attributes[name];
          a.clearUpdateRanges();
          a.addUpdateRange(0, mesh.count * size);
          a.needsUpdate = true;
        }
      }
    }
    if (shadowMesh.count) {
      shadowMesh.instanceMatrix.clearUpdateRanges();
      shadowMesh.instanceMatrix.addUpdateRange(0, shadowMesh.count * 16);
      shadowMesh.instanceMatrix.needsUpdate = true;
    }
  }

  stats.ms = Math.round((performance.now() - t0) * 10) / 10;
  stats.kinds = counts;
  stats.cats = cars.reduce((m, c) => ((m[c.cat] = (m[c.cat] || 0) + 1), m), {});
  // (for the captures: every car's body box, and where a point lies against them)
  window.CITY.parkedCarsList = () => cars.map((c) => ({ kind: c.kind, x: c.cx, z: c.cz, yaw: c.yaw, hl: c.hl, hw: c.hw, cat: c.cat }));
  console.info(`[parked] ${cars.length} parked cars (${Q.tier}: cap ${Q.parkedCars}; ${stats.laneDropped} off the built lanes' way, ` +
    `${stats.patioDropped} on a patio left out) in ${stats.ms} ms (decoded in ${stats.decodeMs} ms)`);
  return { group, colliders, update, parkedAt, stats, cars };
}

Object.assign(window.CITY, { buildParkedCars });
})();
