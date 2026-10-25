(function () {
// js/subway.js
// The TTC subway where you can see it from the street (window.CITY.GEO_SUBWAY, js/toronto-subway.js from
// tools/build-subway.mjs; the tunnels, stations & platforms underground are not built):
// - Line 2 on the Prince Edward Viaduct: Bloor Street's deck over the Don (city-grid.js, a flyover deck) gets the
//   lower deck the subway runs on, an open steel truss hung under the road with its tracks, carried on tall concrete
//   piers and steel arches in place of the flyover's plain T piers (city-grid.js asks subwayKeepsClear()), and solid
//   abutments at either end, where the tracks run into their tunnel portals (Castle Frank in the west, Broadview in the
//   east). Toronto Rocket trains (six stainless cars, black window band, red accents) cross it both ways, coming out
//   of one portal and gone into the other.
// - Every station's street entrances (OpenStreetMap railway=subway_entrance, or the station's node where none is
//   mapped): a stairway going down, set along the street on its sidewalk (beyond the sidewalk where the node lies in
//   open ground; else against the building line, clear of the inner walking line), its low walls & rail round it, and
//   the TTC's insignia pylon at the curb abreast of its open end (js/ttc-pylons.js draws them: the insignia, the entry
//   ID sign with the station's name & lines). An entrance in a building gets the pylon alone, at the curb. The stairs are a flat decal at the sidewalk drawn as a pit
//   (the view ray traced through the stairwell in the shader): the sidewalk itself stays whole.
// - Colliders for the player (the piers & abutments, the stair walls & the pylons); the trains sound like the
//   streetcars (window.CITY.Audio.addStreetcars: whine, rolling, joint clacks).
// - Cost: a few merged static meshes, three instanced meshes for the cars; quality.js `subway` (x trains per hour).

const { THREE, GEO, QUALITY, blockAt, deckHeightAt, waterAt, nearestRoads, CITY_BOUNDS, cityUniforms } = window.CITY;
const { Fn, color, mix, step, smoothstep, abs, fract, floor, positionWorld, positionGeometry, normalGeometry, float, vec2, vec3, sin, dot, attribute, cameraPosition, select, min, max, exp, uv, texture } = window.CITY.TSL;
const S = window.CITY.GEO_SUBWAY || { ways: [], stations: [], entrances: [] };

// Viaduct
const ABUT = 30; // an abutment's length along the line, past the viaduct's end
const TUNNEL = ABUT - 1.5; // how far its tunnel lining runs in (a black end beyond: the cars are hidden past it)
const DECK_SLAB = 1.25; // the road deck's slab (city-grid.js: its soffit 1.25 m under the road)
const BOX_HALF = 4.8; // the lower deck's trusses, centre to side
const TRACK_HALF = 2.0; // track centres 4 m apart
const SPAN = 66; // the arches' target span
const EXT = 260; // the routes run on this far into the tunnels (out of sight)
// Toronto Rocket
const CAR_LEN = 23.0, CAR_W = 3.1, CAR_H = 3.65, CAR_GAP = 0.6, CARS = 6;
const TRAIN_LEN = CARS * CAR_LEN + (CARS - 1) * CAR_GAP;
const SPEED = 16; // m/s over the viaduct (~58 km/h)
const HEADWAY = 110; // s between trains each way (x quality.js `subway`)
// Entrances
const ST_HALF = 1.2; // a stairway's walls, centre to outer face (2 m clear between them)
const ST_IN = 1.0;
const ST_LEN = 6.4; // the open stairwell
const WALL_T = 0.2, WALL_H = 0.95;
const PYLON_CURB = 0.75; // a pylon's pole, in from the curb
const RISE = 0.17, TREAD = 0.28, SLOPE = RISE / TREAD;

const toPts = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
};
const lenOf = (P) => P.reduce((t, p, i) => (i ? t + Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z) : 0), 0);
function at(P, s) {
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= L || i === P.length - 1) {
      const t = L ? s / L : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: (b.x - a.x) / (L || 1), tz: (b.z - a.z) / (L || 1) };
    }
    s -= L;
  }
  return { x: P[0].x, z: P[0].z, tx: 1, tz: 0 };
}
function segDist(x, z, a, b) {
  const ex = b.x - a.x, ez = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
}

// ---------------------------------------------------------------------------------------------------------------------
// The viaducts (OpenStreetMap bridge=viaduct): each pair of tracks' centre line, the road deck over it, the heights
// ---------------------------------------------------------------------------------------------------------------------
const VIADUCTS = (() => {
  const ways = S.ways.filter((w) => w[1] & 8).map((w) => toPts(w[4])).filter((P) => P.length > 1);
  const groups = [];
  for (const P of ways) {
    const g = groups.find((q) => q.some((o) => [P[0], P[P.length - 1]].some((p) => [o[0], o[o.length - 1]].some((e) => Math.hypot(e.x - p.x, e.z - p.z) < 20))));
    if (g) g.push(P);
    else groups.push([P]);
  }
  const out = [];
  for (const g of groups) {
    // every way the same way round as the first, then their mean, resampled every ~10 m
    const ref = g[0];
    const ws = g.map((P) => (Math.hypot(P[0].x - ref[0].x, P[0].z - ref[0].z) > Math.hypot(P[P.length - 1].x - ref[0].x, P[P.length - 1].z - ref[0].z) ? P.slice().reverse() : P));
    const L = Math.max(...ws.map(lenOf));
    const n = Math.max(1, Math.round(L / 10));
    const pts = [];
    for (let k = 0; k <= n; k++) {
      let x = 0, z = 0;
      for (const P of ws) {
        const p = at(P, (lenOf(P) * k) / n);
        x += p.x / ws.length;
        z += p.z / ws.length;
      }
      pts.push({ x, z });
    }
    const len = lenOf(pts);
    // the road deck over it (Bloor's: 22.5 m) and the heights hung from it
    let deck = 0;
    for (let k = 0; k <= 8; k++) {
      const p = at(pts, (len * k) / 8);
      deck = Math.max(deck, deckHeightAt(p.x, p.z, 200, 200));
    }
    if (deck < 12) continue; // (no deck to hang from: not one of ours)
    const soffit = deck - DECK_SLAB;
    const railY = soffit - 4.95;
    const a = at(pts, 0), b = at(pts, len);
    // the line from the far end of one abutment to the far end of the other
    const ends = [{ x: a.x - a.tx * ABUT, z: a.z - a.tz * ABUT }, ...pts, { x: b.x + b.tx * ABUT, z: b.z + b.tz * ABUT }];
    out.push({ pts, len, deck, soffit, railY, floorTop: railY - 0.2, floorBot: railY - 0.9, ends });
  }
  return out;
})();

/** True where the flyover decks' plain piers (city-grid.js) must not stand: under a subway viaduct or its abutments */
function subwayKeepsClear(x, z) {
  for (const V of VIADUCTS) {
    const P = V.ends;
    for (let i = 1; i < P.length; i++) if (segDist(x, z, P[i - 1], P[i]) < 11.5) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry & materials
// ---------------------------------------------------------------------------------------------------------------------
// A quad p0 p1 p2 p3 (in order round its edge) facing (fx, fy, fz)
function quad(pos, p0, p1, p2, p3, fx, fy, fz) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const flip = (uy * vz - uz * vy) * fx + (uz * vx - ux * vz) * fy + (ux * vy - uy * vx) * fz < 0;
  const P = flip ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
  for (const i of [0, 1, 2, 0, 2, 3]) pos.push(P[i][0], P[i][1], P[i][2]);
}
// A box in a local frame: origin (ox, oz), along (tx, tz), across (-tz, tx); a0..a1 along, c0..c1 across, y0..y1 up.
// `faces`: which to emit (default all six)
function obox(pos, ox, oz, tx, tz, a0, a1, c0, c1, y0, y1, faces = 63) {
  const nx = -tz, nz = tx;
  const P = (a, c, y) => [ox + tx * a + nx * c, y, oz + tz * a + nz * c];
  if (faces & 1) quad(pos, P(a0, c0, y1), P(a1, c0, y1), P(a1, c1, y1), P(a0, c1, y1), 0, 1, 0);
  if (faces & 2) quad(pos, P(a0, c0, y0), P(a1, c0, y0), P(a1, c1, y0), P(a0, c1, y0), 0, -1, 0);
  if (faces & 4) quad(pos, P(a0, c0, y0), P(a1, c0, y0), P(a1, c0, y1), P(a0, c0, y1), -nx, 0, -nz);
  if (faces & 8) quad(pos, P(a0, c1, y0), P(a1, c1, y0), P(a1, c1, y1), P(a0, c1, y1), nx, 0, nz);
  if (faces & 16) quad(pos, P(a0, c0, y0), P(a0, c1, y0), P(a0, c1, y1), P(a0, c0, y1), -tx, 0, -tz);
  if (faces & 32) quad(pos, P(a1, c0, y0), P(a1, c1, y0), P(a1, c1, y1), P(a1, c0, y1), tx, 0, tz);
}
// A beam of square section `w` from point A to point B ([x, y, z]), its sides turned with the frame (tx, tz)
function beam(pos, A, B, w, tx, tz) {
  const h = w / 2;
  const nx = -tz, nz = tx;
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
  const L = Math.hypot(dx, dy, dz) || 1;
  // a side vector across the frame, and one perpendicular to both
  const s = [nx * h, 0, nz * h];
  const ux = (dy * s[2] - dz * s[1]) / L, uy = (dz * s[0] - dx * s[2]) / L, uz = (dx * s[1] - dy * s[0]) / L;
  const c = (p, a, b) => [p[0] + s[0] * a + ux * b, p[1] + s[1] * a + uy * b, p[2] + s[2] * a + uz * b];
  for (const [a0, b0, a1, b1] of [[1, 1, 1, -1], [1, -1, -1, -1], [-1, -1, -1, 1], [-1, 1, 1, 1]]) {
    const fa = (a0 + a1) / 2, fb = (b0 + b1) / 2;
    quad(pos, c(A, a0, b0), c(A, a1, b1), c(B, a1, b1), c(B, a0, b0), s[0] * fa + ux * fb, s[1] * fa + uy * fb, s[2] * fa + uz * fb);
  }
}
function meshOf(pos, mat, name, { cast = true, receive = true, extra = null } = {}) {
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (extra) for (const [k, [arr, size]] of Object.entries(extra)) g.setAttribute(k, new THREE.Float32BufferAttribute(arr, size));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
const hash2 = (p, k) => fract(sin(dot(floor(p), vec2(12.9898 * k, 78.233))).mul(43758.5453));

// The piers & abutments: pale poured concrete in 1.5 m lifts, darker toward the ground
function createConcreteMaterial(base = 0xb7b0a4) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  mat.colorNode = Fn(() => {
    const p = positionWorld;
    const n = hash2(p.xz.mul(1.3).add(p.y.mul(0.7)), 1);
    const lift = smoothstep(0.0, 0.03, fract(p.y.div(1.5)));
    const grime = smoothstep(0.0, 5.0, p.y);
    const streak = fract(sin(floor(p.x.add(p.z).mul(1.1)).mul(91.7)).mul(437.5)).mul(0.08);
    return color(base).mul(mix(float(0.7), float(1.0), grime)).mul(n.mul(0.06).add(0.94)).mul(lift.mul(0.12).add(0.88)).sub(streak.mul(float(1).sub(grime)));
  })();
  return mat;
}
// The lower deck's steelwork: painted, weathered grey-green
function createSteelMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0.35 });
  mat.colorNode = Fn(() => {
    const p = positionWorld;
    const n = hash2(p.xz.mul(0.9).add(p.y), 2);
    return mix(color(0x4d5753), color(0x5f6a65), n);
  })();
  return mat;
}
// Track bed: dark concrete with the sleepers every 0.6 m (uv.y metres along, uv.x across)
function createBedMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  mat.colorNode = Fn(() => {
    const u = abs(uv().x.sub(0.5));
    const sleeper = step(fract(uv().y.div(0.6)), 0.4).mul(step(u, 0.4));
    return mix(color(0x3f3b37), color(0x2a2724), sleeper);
  })();
  return mat;
}

// The Toronto Rocket's car: a stainless body over its dark skirt & bogies (origin at the rail top, +z ahead); a cab
// car's front slopes back above the anticlimber
function carGeometry(cab) {
  const g = new THREE.BoxGeometry(CAR_W, CAR_H - 0.35, CAR_LEN, 1, 5, cab ? 8 : 1).translate(0, 0.35 + (CAR_H - 0.35) / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i), x = p.getX(i);
    // the roof's curve
    if (y > CAR_H - 0.5) p.setX(i, x * 0.9);
    if (cab && z > CAR_LEN / 2 - 0.01) {
      if (y > 1.6) p.setZ(i, z - Math.min(1, (y - 1.6) / 2.0) * 0.55);
      p.setX(i, x * 0.97);
    }
  }
  g.computeVertexNormals();
  return g;
}
function createCarMaterial(cab) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.34, metalness: 0.55 });
  const y = positionGeometry.y, z = positionGeometry.z;
  const side = step(0.5, abs(normalGeometry.x));
  const front = step(0.35, normalGeometry.z).mul(cab ? 1 : 0);
  const roof = step(0.6, normalGeometry.y);
  const skirt = float(1.0).sub(smoothstep(1.02, 1.06, y));
  // the black window band down each side, broken by the doors (four a side, 1.6 m wide); the door leaves stainless
  // below their windows with a red edge
  const band = smoothstep(1.86, 1.9, y).mul(float(1.0).sub(smoothstep(2.82, 2.86, y)));
  const dz = fract(z.div(CAR_LEN / 4)).sub(0.5).mul(CAR_LEN / 4); // metres from the nearest door's centre
  const door = step(abs(dz), 0.8);
  const doorEdge = step(abs(abs(dz).sub(0.8)), 0.06).mul(step(y, 2.9)).mul(step(1.05, y));
  const doorWin = door.mul(smoothstep(1.5, 1.54, y)).mul(float(1.0).sub(smoothstep(2.6, 2.64, y))).mul(step(abs(abs(dz).sub(0.4)), 0.3));
  const stripe = smoothstep(1.62, 1.65, y).mul(float(1.0).sub(smoothstep(1.74, 1.77, y))).mul(float(1.0).sub(door));
  const glass = band.mul(float(1.0).sub(door)).max(doorWin).mul(side);
  // the cab's front: a black mask round the windscreen, a red apron under it, the headlights
  const lx = abs(positionGeometry.x);
  const mask = front.mul(smoothstep(1.55, 1.6, y)).mul(float(1.0).sub(smoothstep(3.2, 3.25, y)));
  const apron = front.mul(smoothstep(1.05, 1.1, y)).mul(float(1.0).sub(smoothstep(1.5, 1.55, y)));
  const lamp = front.mul(smoothstep(1.25, 1.28, y)).mul(float(1.0).sub(smoothstep(1.42, 1.45, y))).mul(smoothstep(0.95, 1.0, lx)).mul(float(1.0).sub(smoothstep(1.3, 1.35, lx)));
  const red = color(0xc8102e);
  let c = mix(color(0xd6dadd), color(0xb8bdc2), roof);
  c = mix(c, red, stripe.mul(side).max(doorEdge.mul(side)).max(apron));
  c = mix(c, color(0x0e1013), glass.max(mask));
  c = mix(c, color(0x2a2c2e), skirt);
  mat.colorNode = c;
  mat.roughnessNode = mix(float(0.34), float(0.08), glass.max(mask));
  mat.metalnessNode = mix(float(0.4), float(0.1), glass.max(mask).max(skirt));
  const night = smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow);
  mat.emissiveNode = color(0xeef3ff).mul(glass).mul(night.mul(0.55).add(0.05)).add(color(0xfff4dc).mul(lamp).mul(night.mul(2.5).add(0.4)));
  return mat;
}

// ---------------------------------------------------------------------------------------------------------------------
// The viaduct's lower deck, piers, arches & abutments
// ---------------------------------------------------------------------------------------------------------------------
function buildViaduct(V, group, colliders) {
  const concrete = [], steel = [], bed = [], bedUv = [], rails = [], lining = [], dark = [];
  const { pts, len, soffit, railY, floorTop, floorBot } = V;
  // ground under it: streets, tracks & water must stay clear of a pier
  // (only what lies within 80 m of it)
  const near = (a, b) => V.ends.some((p, i) => i && Math.min(segDist(a.x, a.z, V.ends[i - 1], p), segDist(b.x, b.z, V.ends[i - 1], p)) < 80 + Math.hypot(b.x - a.x, b.z - a.z));
  const groundSegs = [];
  for (const r of window.CITY.ROADS) {
    if (r.raised) continue;
    for (let i = 0; i + 1 < r.pts.length; i++) if (near(r.pts[i], r.pts[i + 1])) groundSegs.push([r.pts[i], r.pts[i + 1], r.w / 2]);
  }
  for (const r of GEO.rails || []) {
    if (r[0] !== 1 || r[3] & 2) continue;
    const P = toPts(r[4]);
    for (let i = 1; i < P.length; i++) if (near(P[i - 1], P[i])) groundSegs.push([P[i - 1], P[i], 5.5]); // (room for a train's width & the arch over it)
  }
  const clearOf = (x, z, m) => {
    for (const [a, b, hw] of groundSegs) if (segDist(x, z, a, b) < hw + m) return false;
    return !waterAt(x, z);
  };
  const pierClear = (s) => {
    const p = at(pts, s);
    for (const a of [-2.5, 0, 2.5]) for (const c of [-11, -8.25, -5.5, -2.75, 0, 2.75, 5.5, 8.25, 11]) if (!clearOf(p.x + p.tx * a - p.tz * c, p.z + p.tz * a + p.tx * c, 1.0)) return false;
    return true;
  };
  // Piers: about every SPAN, each moved up to 14 m along to stand clear of what's under it (or left out)
  const n = Math.max(1, Math.round(len / SPAN));
  const supports = [0];
  for (let i = 1; i < n; i++) {
    const s0 = (len * i) / n;
    let s = null;
    for (const d of [0, 3, -3, 6, -6, 9, -9, 12, -12, 14, -14]) if (pierClear(s0 + d)) { s = s0 + d; break; }
    if (s !== null) supports.push(s);
  }
  supports.push(len);
  const PIER_HALF = 2.0; // along
  for (let k = 1; k < supports.length - 1; k++) {
    const s = supports[k];
    const p = at(pts, s);
    // the shaft (wider at its foot), and its two heads either side of the lower deck, up to the road's slab
    const foot = 11.2, top = 10.4;
    const nx = -p.tz, nz = p.tx;
    for (const [a0, a1] of [[-PIER_HALF, PIER_HALF]]) {
      // a tapered block: quads by hand
      const P = (a, c, y) => [p.x + p.tx * a + nx * c, y, p.z + p.tz * a + nz * c];
      const w = (y) => foot + ((top - foot) * y) / floorBot;
      const y0 = -0.5, y1 = floorBot;
      quad(concrete, P(a0, -w(y0), y0), P(a1, -w(y0), y0), P(a1, -w(y1), y1), P(a0, -w(y1), y1), -nx, 0, -nz);
      quad(concrete, P(a0, w(y0), y0), P(a1, w(y0), y0), P(a1, w(y1), y1), P(a0, w(y1), y1), nx, 0, nz);
      quad(concrete, P(a0, -w(y0), y0), P(a0, w(y0), y0), P(a0, w(y1), y1), P(a0, -w(y1), y1), -p.tx, 0, -p.tz);
      quad(concrete, P(a1, -w(y0), y0), P(a1, w(y0), y0), P(a1, w(y1), y1), P(a1, -w(y1), y1), p.tx, 0, p.tz);
      // its cap (a cornice band) and the heads
      obox(concrete, p.x, p.z, p.tx, p.tz, a0 - 0.3, a1 + 0.3, -top - 0.3, top + 0.3, floorBot - 0.6, floorBot, 63);
      obox(concrete, p.x, p.z, p.tx, p.tz, a0, a1, -top, -BOX_HALF - 0.3, floorBot, soffit, 63);
      obox(concrete, p.x, p.z, p.tx, p.tz, a0, a1, BOX_HALF + 0.3, top, floorBot, soffit, 63);
    }
    const hx = foot, hz = PIER_HALF, cs = p.tz, sn = p.tx;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: p.x - ex, maxX: p.x + ex, minZ: p.z - ez, maxZ: p.z + ez, maxY: soffit, obb: { cx: p.x, cz: p.z, hx, hz, cs, sn } });
  }
  // Arches: two steel ribs under the lower deck's trusses in every span, their spandrel posts up to the floor
  for (let k = 0; k + 1 < supports.length; k++) {
    const sA = supports[k] + (k === 0 ? 0 : PIER_HALF), sB = supports[k + 1] - (k + 1 === supports.length - 1 ? 0 : PIER_HALF);
    const L = sB - sA;
    const rise = Math.min(L * 0.19, floorBot - 6.5); // (springing 6.5 m up: clear of the trucks & trains under it)
    const spring = floorBot - rise;
    const yAt = (t) => spring + rise * 4 * t * (1 - t);
    const N = Math.max(8, Math.round(L / 3));
    for (const c of [-BOX_HALF + 0.2, BOX_HALF - 0.2]) {
      for (let i = 0; i < N; i++) {
        const t0 = i / N, t1 = (i + 1) / N;
        const p0 = at(pts, sA + L * t0), p1 = at(pts, sA + L * t1);
        // the rib: 0.9 m deep, 0.7 m wide
        const A = (p, t, dy) => [p.x - p.tz * c, yAt(t) + dy, p.z + p.tx * c];
        const nx = -p0.tz * 0.35, nz = p0.tx * 0.35;
        const a0 = A(p0, t0, -0.45), a1 = A(p0, t0, 0.45), b0 = A(p1, t1, -0.45), b1 = A(p1, t1, 0.45);
        const off = (q, sg) => [q[0] + nx * sg, q[1], q[2] + nz * sg];
        quad(steel, off(a1, -1), off(b1, -1), off(b1, 1), off(a1, 1), 0, 1, 0);
        quad(steel, off(a0, -1), off(b0, -1), off(b0, 1), off(a0, 1), 0, -1, 0);
        quad(steel, off(a0, 1), off(b0, 1), off(b1, 1), off(a1, 1), nx, 0, nz);
        quad(steel, off(a0, -1), off(b0, -1), off(b1, -1), off(a1, -1), -nx, 0, -nz);
      }
      // spandrel posts every ~5.5 m
      const m = Math.max(2, Math.round(L / 5.5));
      for (let i = 1; i < m; i++) {
        const t = i / m;
        const y = yAt(t) + 0.45;
        if (floorBot - y < 0.4) continue;
        const p = at(pts, sA + L * t);
        beam(steel, [p.x - p.tz * c, y, p.z + p.tx * c], [p.x - p.tz * c, floorBot, p.z + p.tx * c], 0.4, p.tx, p.tz);
      }
    }
    // a brace across between the two ribs at each quarter
    for (const t of [0.25, 0.5, 0.75]) {
      const p = at(pts, sA + L * t);
      const y = yAt(t);
      beam(steel, [p.x + p.tz * (BOX_HALF - 0.2), y, p.z - p.tx * (BOX_HALF - 0.2)], [p.x - p.tz * (BOX_HALF - 0.2), y, p.z + p.tx * (BOX_HALF - 0.2)], 0.35, p.tz, -p.tx);
    }
  }
  // The lower deck: floor slab, plate girders along its edges, Warren trusses up to the road's slab, track beds & rails
  const PANEL = 5.5;
  const nPanels = Math.max(1, Math.round(len / PANEL));
  for (let i = 0; i < nPanels; i++) {
    const s0 = (len * i) / nPanels, s1 = (len * (i + 1)) / nPanels;
    const p0 = at(pts, s0), p1 = at(pts, s1);
    const C = (p, c, y) => [p.x - p.tz * c, y, p.z + p.tx * c];
    // floor slab (its top hidden under the beds) & its soffit
    quad(concrete, C(p0, -BOX_HALF, floorBot), C(p1, -BOX_HALF, floorBot), C(p1, BOX_HALF, floorBot), C(p0, BOX_HALF, floorBot), 0, -1, 0);
    quad(concrete, C(p0, -BOX_HALF, floorTop), C(p1, -BOX_HALF, floorTop), C(p1, BOX_HALF, floorTop), C(p0, BOX_HALF, floorTop), 0, 1, 0);
    for (const sg of [-1, 1]) {
      const c = BOX_HALF * sg, ci = (BOX_HALF - 0.25) * sg;
      // the plate girder: outer & inner faces, its top
      quad(steel, C(p0, c, floorBot), C(p1, c, floorBot), C(p1, c, railY + 0.75), C(p0, c, railY + 0.75), -p0.tz * sg, 0, p0.tx * sg);
      quad(steel, C(p0, ci, floorTop), C(p1, ci, floorTop), C(p1, ci, railY + 0.75), C(p0, ci, railY + 0.75), p0.tz * sg, 0, -p0.tx * sg);
      quad(steel, C(p0, ci, railY + 0.75), C(p1, ci, railY + 0.75), C(p1, c, railY + 0.75), C(p0, c, railY + 0.75), 0, 1, 0);
      // the truss: top chord under the road slab, a vertical at each panel point, one diagonal per panel (a Warren
      // truss: alternating)
      const cm = (BOX_HALF - 0.12) * sg;
      const top = soffit - 0.25;
      beam(steel, C(p0, cm, top), C(p1, cm, top), 0.36, p0.tx, p0.tz);
      beam(steel, C(p0, cm, railY + 0.75), C(p0, cm, top), 0.3, p0.tx, p0.tz);
      if (i % 2) beam(steel, C(p0, cm, railY + 0.75), C(p1, cm, top), 0.26, p0.tx, p0.tz);
      else beam(steel, C(p0, cm, top), C(p1, cm, railY + 0.75), 0.26, p0.tx, p0.tz);
    }
  }
  // the tracks, on through the abutments' tunnels
  const trackRun = [{ x: V.ends[0].x, z: V.ends[0].z }, ...pts, V.ends[V.ends.length - 1]];
  const TL = lenOf(trackRun);
  for (const o of [-TRACK_HALF, TRACK_HALF]) {
    const m = Math.max(1, Math.ceil(TL / 3));
    for (let i = 0; i < m; i++) {
      const p0 = at(trackRun, (TL * i) / m), p1 = at(trackRun, (TL * (i + 1)) / m);
      const C = (p, c, y) => [p.x - p.tz * (o + c), y, p.z + p.tx * (o + c)];
      const s0 = (TL * i) / m, s1 = (TL * (i + 1)) / m;
      bed.push(...C(p0, -1.4, floorTop + 0.08), ...C(p1, 1.4, floorTop + 0.08), ...C(p1, -1.4, floorTop + 0.08), ...C(p0, -1.4, floorTop + 0.08), ...C(p0, 1.4, floorTop + 0.08), ...C(p1, 1.4, floorTop + 0.08));
      bedUv.push(0, s0, 1, s1, 0, s1, 0, s0, 1, s0, 1, s1);
      for (const g of [-0.7175, 0.7175]) {
        const a = C(p0, g, railY), b = C(p1, g, railY);
        quad(rails, [a[0], railY - 0.15, a[2]], [b[0], railY - 0.15, b[2]], [b[0], railY, b[2]], [a[0], railY, a[2]], -p0.tz, 0, p0.tx);
        quad(rails, [a[0] - p0.tz * 0.035, railY, a[2] + p0.tx * 0.035], [b[0] - p0.tz * 0.035, railY, b[2] + p0.tx * 0.035], [b[0] + p0.tz * 0.035, railY, b[2] - p0.tx * 0.035], [a[0] + p0.tz * 0.035, railY, a[2] - p0.tx * 0.035], 0, 1, 0);
      }
    }
  }
  // Abutments: a solid block under the road from the ground to its slab, ABUT m along, its portal facing the valley
  const HOLE = { c: BOX_HALF - 0.3, y0: floorTop, y1: railY + 4.45 };
  for (const end of [0, 1]) {
    const e = at(pts, end ? len : 0);
    const dir = end ? 1 : -1; // outward, away from the valley
    const tx = e.tx * dir, tz = e.tz * dir;
    const W = 10.6;
    const roadAt = (a) => deckHeightAt(e.x + tx * a, e.z + tz * a, 200, 200) - DECK_SLAB;
    const nA = 6;
    const nx = -tz, nz = tx;
    const P = (a, c, y) => [e.x + tx * a + nx * c, y, e.z + tz * a + nz * c];
    for (let i = 0; i < nA; i++) {
      const a0 = (ABUT * i) / nA, a1 = (ABUT * (i + 1)) / nA;
      const h0 = Math.min(soffit, roadAt(a0)), h1 = Math.min(soffit, roadAt(a1));
      for (const c of [-W, W]) quad(concrete, P(a0, c, -0.5), P(a1, c, -0.5), P(a1, c, h1), P(a0, c, h0), nx * Math.sign(c), 0, nz * Math.sign(c));
      quad(concrete, P(a0, -W, h0), P(a1, -W, h1), P(a1, W, h1), P(a0, W, h0), 0, 1, 0);
      // the tunnel lining inside
      if (a0 < TUNNEL) {
        const b1 = Math.min(a1, TUNNEL);
        for (const sg of [-1, 1]) quad(lining, P(a0, HOLE.c * sg, HOLE.y0), P(b1, HOLE.c * sg, HOLE.y0), P(b1, HOLE.c * sg, HOLE.y1), P(a0, HOLE.c * sg, HOLE.y1), -nx * sg, 0, -nz * sg);
        quad(lining, P(a0, -HOLE.c, HOLE.y1), P(b1, -HOLE.c, HOLE.y1), P(b1, HOLE.c, HOLE.y1), P(a0, HOLE.c, HOLE.y1), 0, -1, 0);
        quad(lining, P(a0, -HOLE.c, HOLE.y0), P(b1, -HOLE.c, HOLE.y0), P(b1, HOLE.c, HOLE.y0), P(a0, HOLE.c, HOLE.y0), 0, 1, 0);
      }
    }
    // its back face (under the road ramp) and the tunnel's dark end
    const hb = Math.min(soffit, roadAt(ABUT));
    quad(concrete, P(ABUT, -W, -0.5), P(ABUT, W, -0.5), P(ABUT, W, hb), P(ABUT, -W, hb), tx, 0, tz);
    quad(dark, P(TUNNEL, -HOLE.c, HOLE.y0), P(TUNNEL, HOLE.c, HOLE.y0), P(TUNNEL, HOLE.c, HOLE.y1), P(TUNNEL, -HOLE.c, HOLE.y1), -tx, 0, -tz);
    // the valley face, round the portal (its top at the road's slab)
    const hf = soffit;
    quad(concrete, P(0, -W, -0.5), P(0, W, -0.5), P(0, W, HOLE.y0), P(0, -W, HOLE.y0), -tx, 0, -tz);
    quad(concrete, P(0, -W, HOLE.y0), P(0, -HOLE.c, HOLE.y0), P(0, -HOLE.c, hf), P(0, -W, hf), -tx, 0, -tz);
    quad(concrete, P(0, HOLE.c, HOLE.y0), P(0, W, HOLE.y0), P(0, W, hf), P(0, HOLE.c, hf), -tx, 0, -tz);
    quad(concrete, P(0, -HOLE.c, HOLE.y1), P(0, HOLE.c, HOLE.y1), P(0, HOLE.c, hf), P(0, -HOLE.c, hf), -tx, 0, -tz);
    // a portal frame standing proud of the face, and a cornice under the road
    obox(concrete, e.x, e.z, tx, tz, -0.5, 0, -HOLE.c - 0.9, -HOLE.c, HOLE.y0, HOLE.y1 + 0.9, 63 - 32);
    obox(concrete, e.x, e.z, tx, tz, -0.5, 0, HOLE.c, HOLE.c + 0.9, HOLE.y0, HOLE.y1 + 0.9, 63 - 32);
    obox(concrete, e.x, e.z, tx, tz, -0.5, 0, -HOLE.c, HOLE.c, HOLE.y1, HOLE.y1 + 0.9, 63 - 32);
    obox(concrete, e.x, e.z, tx, tz, -0.4, ABUT, -W - 0.4, W + 0.4, hf - 0.7, hf, 1 | 2 | 4 | 8 | 16);
    // the player's collider (the whole block; its top under the road)
    const cx = e.x + (tx * ABUT) / 2, cz = e.z + (tz * ABUT) / 2;
    const hx = W, hz = ABUT / 2, cs = tz, sn = tx;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY: Math.min(hb, soffit) - 0.5, obb: { cx, cz, hx, hz, cs, sn } });
  }

  const mats = { concrete: createConcreteMaterial(), steel: createSteelMaterial(), bed: createBedMaterial(), rails: new THREE.MeshStandardNodeMaterial({ color: 0x8e8a84, roughness: 0.35, metalness: 0.85 }), lining: new THREE.MeshStandardNodeMaterial({ color: 0x1d1e20, roughness: 0.96 }), dark: new THREE.MeshBasicNodeMaterial({ color: 0x000000 }) };
  const out = [
    meshOf(concrete, mats.concrete, 'SubwayViaductConcrete'),
    meshOf(steel, mats.steel, 'SubwayViaductSteel'),
    meshOf(bed, mats.bed, 'SubwayTrackBed', { cast: false, extra: { uv: [bedUv, 2] } }),
    meshOf(rails, mats.rails, 'SubwayRails', { cast: false }),
    meshOf(lining, mats.lining, 'SubwayTunnelLining', { cast: false }),
    meshOf(dark, mats.dark, 'SubwayTunnelEnd', { cast: false, receive: false })
  ].filter(Boolean);
  for (const m of out) group.add(m);
  return { supports: supports.length - 2 };
}

// Train routes over a viaduct: each track (on the right, as the TTC runs) from EXT m inside one tunnel to EXT m inside
// the other, and the stretch out in the open (between the tunnel linings' ends)
function viaductRoutes(V) {
  const a = at(V.pts, 0), b = at(V.pts, V.len);
  const line = [{ x: a.x - a.tx * EXT, z: a.z - a.tz * EXT }, ...V.pts, { x: b.x + b.tx * EXT, z: b.z + b.tz * EXT }];
  const routes = [];
  for (const dirn of [1, -1]) {
    const P = dirn > 0 ? line : line.slice().reverse();
    const off = P.map((p, i) => {
      const q0 = P[Math.max(0, i - 1)], q1 = P[Math.min(P.length - 1, i + 1)];
      const L = Math.hypot(q1.x - q0.x, q1.z - q0.z) || 1;
      const tx = (q1.x - q0.x) / L, tz = (q1.z - q0.z) / L;
      return { x: p.x - tz * TRACK_HALF, z: p.z + tx * TRACK_HALF }; // the right-hand track
    });
    const cum = [0];
    for (let i = 1; i < off.length; i++) cum.push(cum[i - 1] + Math.hypot(off[i].x - off[i - 1].x, off[i].z - off[i - 1].z));
    const len = cum[cum.length - 1];
    routes.push({ pts: off, cum, len, y: V.railY, show0: EXT - TUNNEL + 0.5, show1: len - EXT + TUNNEL - 0.5, phase: dirn > 0 ? 0 : 0.47 });
  }
  return routes;
}
function sample(route, s, out) {
  const { pts, cum } = route;
  s = Math.max(0, Math.min(route.len, s));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = pts[lo], b = pts[hi];
  const t = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Station entrances
// ---------------------------------------------------------------------------------------------------------------------
// The stairwell, traced in the shader: from the decal's point at the sidewalk the view ray runs down into a box
// ST_IN wide either side & ST_LEN long whose floor is the flight of stairs (RISE / TREAD) and whose far wall opens into
// the dark passage to the station. Treads & risers, the yellow nosings, tiled walls with their handrails
function createStairwellMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  const frame = attribute('stairFrame', 'vec4'); // the opening's middle (x, z) & the way down (tx, tz)
  const albedo = Fn(() => {
    const tx = frame.z, tz = frame.w;
    const rel = positionWorld.xz.sub(frame.xy);
    const u0 = rel.y.mul(tx).sub(rel.x.mul(tz));
    const v0 = rel.x.mul(tx).add(rel.y.mul(tz));
    const d = positionWorld.sub(cameraPosition).normalize();
    const du0 = d.z.mul(tx).sub(d.x.mul(tz));
    const dv0 = d.x.mul(tx).add(d.z.mul(tz));
    const du = select(abs(du0).lessThan(1e-4), float(1e-4), du0);
    const dv = select(abs(dv0).lessThan(1e-4), float(1e-4), dv0);
    const dy = min(d.y, float(-1e-4));
    const tS = select(du.greaterThan(0), float(ST_IN), float(-ST_IN)).sub(u0).div(du).max(0);
    const tV = select(dv.greaterThan(0), float(ST_LEN), float(0)).sub(v0).div(dv).max(0);
    const den = dy.add(dv.mul(SLOPE));
    const tF = select(den.lessThan(-1e-4), v0.mul(SLOPE).div(den.negate()), float(1e4));
    const t = min(min(tS, tV), tF);
    const hu = u0.add(du.mul(t)), hv = v0.add(dv.mul(t)), hy = dy.mul(t);
    const isFloor = step(tF, min(tS, tV).add(1e-3));
    const isEnd = float(1).sub(isFloor).mul(step(tV, tS));
    // the stairs
    const k = fract(hv.div(TREAD));
    const stairs = mix(mix(color(0x8a8780), color(0x5c5a55), step(0.72, k)), color(0xd9b000), step(k, 0.07));
    // tiled walls (TTC cream), the grout every 0.3 m, the handrail 0.9 m over the stairs
    const along = select(isEnd.greaterThan(0.5), hu, hv);
    const grout = step(0.94, fract(along.div(0.3))).max(step(0.92, fract(hy.div(0.15))));
    const rail = step(abs(hy.add(hv.mul(SLOPE)).sub(0.9)), 0.04).mul(float(1).sub(isEnd));
    let walls = mix(mix(color(0xb9b09a), color(0x8a8474), grout), color(0x8d9398), rail);
    // the far wall opens into the dark below 2.3 m over the bottom step
    const depthEnd = float(ST_LEN * SLOPE);
    walls = mix(walls, color(0x050505), isEnd.mul(step(hy, depthEnd.negate().add(2.3))));
    const c = mix(walls, stairs, isFloor);
    // darker going down, out of the daylight
    return c.mul(exp(hy.mul(0.62)).mul(0.78).add(0.06));
  })();
  mat.colorNode = albedo;
  const night = smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow);
  mat.emissiveNode = albedo.mul(night.mul(0.7));
  return mat;
}
function buildEntrances(group, colliders) {
  const SW = (GEO.frame && GEO.frame.sidewalk) || 4.6;
  const SWH = CITY_BOUNDS.sidewalkHeight;
  const inCity = (x, z) => x > CITY_BOUNDS.minX && x < CITY_BOUNDS.maxX && z > CITY_BOUNDS.minZ && z < CITY_BOUNDS.maxZ;
  // what a stairway must keep clear of: buildings, the street trees & the City's street furniture
  const bGrid = new Map();
  (GEO.buildings || []).forEach((b, i) => {
    const k = Math.floor(b[0] / 50) * 100000 + Math.floor(b[1] / 50);
    (bGrid.get(k) || bGrid.set(k, []).get(k)).push(b);
  });
  const inBuilding = (x, z, m) => {
    const cx0 = Math.floor(x / 50), cz0 = Math.floor(z / 50);
    for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) {
      for (const [bx, bz, ang, parts] of bGrid.get((cx0 + a) * 100000 + cz0 + c) || []) {
        const cs = Math.cos(ang), sn = Math.sin(ang), dx = x - bx, dz = z - bz;
        const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
        for (const [u0, u1, v0, v1] of parts) if (u > u0 - m && u < u1 + m && v > v0 - m && v < v1 + m) return true;
      }
    }
    return false;
  };
  const pGrid = new Map();
  const addP = (x, z, r) => {
    const k = Math.floor(x / 8) * 100000 + Math.floor(z / 8);
    (pGrid.get(k) || pGrid.set(k, []).get(k)).push(x, z, r);
  };
  const ST = GEO.streetTrees || [];
  for (let i = 0; i < ST.length; i += 4) addP(ST[i], ST[i + 1], 1.0);
  for (const [key, list] of Object.entries(GEO.props || {})) {
    if (!Array.isArray(list)) continue;
    const r = key === 'shelter' ? 2.2 : 0.6;
    for (let i = 0; i + 1 < list.length; i += 2) addP(list[i], list[i + 1], r);
  }
  const nearProp = (x, z, m) => {
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
      const L = pGrid.get((Math.floor(x / 8) + a) * 100000 + Math.floor(z / 8) + c);
      for (let i = 0; L && i < L.length; i += 3) if (Math.hypot(L[i] - x, L[i + 1] - z) < L[i + 2] + m) return true;
    }
    return false;
  };
  const placed = [];
  // A stairway centred at (cx, cz), along (tx, tz): wholly on one curb island, clear of buildings, trees, furniture &
  // the other entrances
  const fits = (cx, cz, tx, tz) => {
    const blk = blockAt(cx, cz);
    if (!blk) return false;
    const nx = -tz, nz = tx;
    for (const a of [-0.5, -0.25, 0, 0.25, 0.5]) {
      for (const c of [-1, 0, 1]) {
        const x = cx + tx * a * (ST_LEN + 0.6) + nx * c * (ST_HALF + 0.1), z = cz + tz * a * (ST_LEN + 0.6) + nz * c * (ST_HALF + 0.1);
        if (blockAt(x, z) !== blk || inBuilding(x, z, 0.3)) return false;
        if (c === 0 && nearProp(x, z, 1.4)) return false;
      }
    }
    for (const p of placed) if (Math.hypot(p.x - cx, p.z - cz) < ST_LEN + 1) return false;
    return true;
  };
  const stations = S.stations.filter(([x, z]) => inCity(x, z));
  const stationOf = (x, z) => {
    let best = null, bd = 450;
    for (const s of stations) {
      const d = Math.hypot(s[0] - x, s[1] - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  // The street an entrance belongs to: the nearest named at-grade one, its direction, where its curb is on this side
  const streetOf = (x, z) => {
    for (const r of nearestRoads(x, z, 45)) {
      if (r.road.raised) continue;
      let dx = r.dx, dz = r.dz;
      const side = Math.sign((x - r.px) * -dz + (z - r.pz) * dx) || 1;
      const nx = -dz * side, nz = dx * side; // toward the entrance
      let curb = null;
      for (let t = 0; t <= 30; t += 0.25) if (blockAt(r.px + nx * t, r.pz + nz * t)) { curb = t; break; }
      if (curb === null) continue;
      return { ...r, nx, nz, curb, lat: r.dist };
    }
    return null;
  };
  const sites = [];
  const todo = S.entrances.filter(([x, z]) => inCity(x, z)).map(([x, z, st, colour, name]) => ({ x, z, st, colour, name }));
  for (const s of stations) {
    if (!todo.some((e) => e.st === s[2] && Math.hypot(e.x - s[0], e.z - s[1]) < 400)) todo.push({ x: s[0], z: s[1], st: s[2], colour: s[3], name: '', fromStation: true });
  }
  let stairs = 0, signs = 0, skipped = 0;
  for (const e of todo) {
    const st = e.st ? stations.find((s) => s[2] === e.st) || stationOf(e.x, e.z) : stationOf(e.x, e.z);
    const name = (st && st[2]) || e.st;
    if (!name) { skipped++; continue; }
    const colour = e.colour || (st && st[3]) || 'yellow';
    const R = streetOf(e.x, e.z);
    if (!R) { skipped++; continue; }
    // the way down: toward the station along the street
    let tx = R.dx, tz = R.dz;
    if (st && (st[0] - e.x) * tx + (st[1] - e.z) * tz < 0) { tx = -tx; tz = -tz; }
    const insideBuilding = !e.fromStation && inBuilding(e.x, e.z, -0.6); // (well inside: one on its outline may be stairs on the sidewalk)
    const beyond = R.curb + SW + 0.25 + ST_HALF;
    const onWalk = R.curb + SW - ST_HALF - 0.05;
    const lats = insideBuilding ? [] : R.lat > R.curb + SW + 0.3 ? [Math.max(beyond, Math.min(R.lat, beyond + 6)), beyond, onWalk] : [onWalk, beyond];
    let site = null;
    for (const lat of lats) {
      for (const d of [0, 2, -2, 4, -4, 6, -6, 9, -9, 12, -12]) {
        const cx = R.px + R.nx * lat + tx * d, cz = R.pz + R.nz * lat + tz * d;
        if (fits(cx, cz, tx, tz)) { site = { x: cx, z: cz, tx, tz, kind: 'stair' }; break; }
      }
      if (site) break;
    }
    if (!site) {
      // the sign alone, at the curb in front (an entrance in a building, or no room for the stairs)
      const lat = R.curb + 0.65;
      for (const d of [0, 1.5, -1.5, 3, -3, 5, -5]) {
        const x = R.px + R.nx * lat + tx * d, z = R.pz + R.nz * lat + tz * d;
        if (blockAt(x, z) && !nearProp(x, z, 0.4) && !inBuilding(x, z, 0.3) && !placed.some((p) => Math.hypot(p.x - x, p.z - z) < 3)) { site = { x, z, tx, tz, kind: 'sign' }; break; }
      }
    }
    if (!site) { skipped++; continue; }
    // the pylon: at the curb abreast of the stairway's open end (a sign-only site's own spot), clear of the street's
    // furniture & the other pylons; else beside the opening
    if (site.kind === 'stair') {
      const a0 = (site.x - R.px) * tx + (site.z - R.pz) * tz - ST_LEN / 2 - 0.4, lat = R.curb + PYLON_CURB;
      for (const d of [0, -1, 1, -2, 2, -3, 3]) {
        const x = R.px + R.nx * lat + tx * (a0 + d), z = R.pz + R.nz * lat + tz * (a0 + d);
        if (blockAt(x, z) && !nearProp(x, z, 0.5) && !inBuilding(x, z, 0.4) && !placed.some((p) => p.pylon && Math.hypot(p.pylon.x - x, p.pylon.z - z) < 2.5)) { site.pylon = { x, z }; break; }
      }
      if (!site.pylon) {
        const sd = Math.sign(-R.nx * -tz + -R.nz * tx) || 1; // (the stairway's curb side)
        site.pylon = { x: site.x - tx * (ST_LEN / 2 + 0.35) - tz * sd * (ST_HALF + 0.4), z: site.z - tz * (ST_LEN / 2 + 0.35) + tx * sd * (ST_HALF + 0.4) };
      }
    } else site.pylon = { x: site.x, z: site.z };
    site.y = blockAt(site.x, site.z) ? SWH : 0;
    site.name = name;
    site.colour = colour;
    site.curbSide = { x: -R.nx, z: -R.nz };
    placed.push(site);
    if (site.kind === 'stair') stairs++;
    else signs++;
  }

  // Geometry
  const walls = [], metal = [], pit = [], pitFrame = [];
  const pylons = [];
  for (const p of placed) {
    const { tx, tz, y } = p;
    const nx = -tz, nz = tx;
    if (p.kind === 'stair') {
      const ox = p.x - tx * (ST_LEN / 2), oz = p.z - tz * (ST_LEN / 2); // the opening's middle
      // the stairwell decal
      const P = (a, c) => [ox + tx * a + nx * c, y + 0.012, oz + tz * a + nz * c];
      quad(pit, P(0, -ST_IN), P(ST_LEN, -ST_IN), P(ST_LEN, ST_IN), P(0, ST_IN), 0, 1, 0);
      for (let i = 0; i < 6; i++) pitFrame.push(ox, oz, tx, tz);
      // its walls (both sides & the far end) with their stainless rail on short posts
      obox(walls, ox, oz, tx, tz, 0, ST_LEN + WALL_T, -ST_HALF, -ST_IN, y - 0.05, y + WALL_H);
      obox(walls, ox, oz, tx, tz, 0, ST_LEN + WALL_T, ST_IN, ST_HALF, y - 0.05, y + WALL_H);
      obox(walls, ox, oz, tx, tz, ST_LEN, ST_LEN + WALL_T, -ST_IN, ST_IN, y - 0.05, y + WALL_H);
      for (const c of [-(ST_IN + WALL_T / 2), ST_IN + WALL_T / 2]) {
        obox(metal, ox, oz, tx, tz, 0.05, ST_LEN + WALL_T - 0.05, c - 0.03, c + 0.03, y + WALL_H + 0.2, y + WALL_H + 0.26);
        for (let a = 0.1; a < ST_LEN + 0.1; a += 1.6) obox(metal, ox, oz, tx, tz, a, a + 0.05, c - 0.025, c + 0.025, y + WALL_H, y + WALL_H + 0.2, 4 | 8 | 16 | 32);
      }
      obox(metal, ox, oz, tx, tz, ST_LEN + WALL_T / 2 - 0.03, ST_LEN + WALL_T / 2 + 0.03, -ST_HALF + 0.1, ST_HALF - 0.1, y + WALL_H + 0.2, y + WALL_H + 0.26);
      const hx = ST_HALF, hz = (ST_LEN + WALL_T) / 2, cx = ox + tx * hz, cz = oz + tz * hz, cs = tz, sn = tx;
      const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
      colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY: y + WALL_H + 0.26, obb: { cx, cz, hx, hz, cs, sn } });
    }
    // the pylon (js/ttc-pylons.js), its faces along the street, its entry ID sign (the model's +x) reaching away from
    // the curb over the sidewalk; its pole & base the rider's collider (the signs overhead clear a rider)
    const { x: px, z: pz } = p.pylon;
    const py = blockAt(px, pz) ? SWH : 0;
    let yaw = Math.atan2(tx, tz);
    if (Math.cos(yaw) * -p.curbSide.x - Math.sin(yaw) * -p.curbSide.z < 0) yaw += Math.PI;
    pylons.push({ x: px, y: py, z: pz, yaw, station: p.name, colour: p.colour });
    colliders.push({ minX: px - 0.3, maxX: px + 0.3, minZ: pz - 0.3, maxZ: pz + 0.3, maxY: py + 4.0 });
  }
  const wallMat = createConcreteMaterial(0x8f8a83);
  const metalMat = new THREE.MeshStandardNodeMaterial({ color: 0x9aa0a5, roughness: 0.3, metalness: 0.85 });
  const out = [
    meshOf(walls, wallMat, 'SubwayEntranceWalls'),
    meshOf(metal, metalMat, 'SubwayEntranceMetal'),
    meshOf(pit, createStairwellMaterial(), 'SubwayStairwells', { cast: false, extra: { stairFrame: [pitFrame, 4] } })
  ].filter(Boolean);
  for (const m of out) group.add(m);
  return { stairs, signs, skipped, sites: placed, pylons };
}

// ---------------------------------------------------------------------------------------------------------------------
function createSubway(scene) {
  const group = new THREE.Group();
  group.name = 'Subway';
  const colliders = [];
  let piers = 0;
  for (const V of VIADUCTS) piers += buildViaduct(V, group, colliders).supports;
  const ent = buildEntrances(group, colliders);
  scene.add(group);

  // The trains
  const routes = VIADUCTS.flatMap(viaductRoutes);
  const k = QUALITY.subway ?? 1;
  const headway = HEADWAY / Math.max(0.1, k);
  const cabs = new THREE.InstancedMesh(carGeometry(true), createCarMaterial(true), Math.max(1, routes.length * 4));
  const mids = new THREE.InstancedMesh(carGeometry(false), createCarMaterial(false), Math.max(1, routes.length * 8));
  for (const m of [cabs, mids]) {
    m.name = 'SubwayTrains';
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    group.add(m);
  }
  const dummy = new THREE.Object3D();
  const tmpA = { x: 0, z: 0 }, tmpB = { x: 0, z: 0 };
  const sounding = []; // the trains in the open, for the audio (streetcar-like voices)
  const trains = routes.map(() => [0, 1].map(() => ({ speed: SPEED, y: 0, sections: Array.from({ length: CARS }, () => ({ x: 0, z: 0, yaw: 0 })) })));
  let shift = 0, last = 0, held = null;
  // (for screenshots: route `ri`'s train with its middle `frac` of the way over the viaduct, held there if `hold`)
  const placeTrain = (ri, frac, hold = true) => {
    const r = routes[ri], cycle = headway * SPEED;
    const target = EXT + frac * (r.len - 2 * EXT) + TRAIN_LEN / 2;
    shift = ((((target - (last * SPEED + r.phase * cycle)) / SPEED) % headway) + headway) % headway;
    held = hold ? last + shift : null;
  };
  const api = { group, colliders, cars: sounding, update, routes, entrances: ent, placeTrain };

  function update(time, camera) {
    last = time;
    const elapsed = held ?? time + shift;
    let nc = 0, nm = 0;
    sounding.length = 0;
    const camX = camera ? camera.position.x : 0, camZ = camera ? camera.position.z : 0;
    routes.forEach((r, ri) => {
      // far away: nothing to draw
      if (Math.hypot(r.pts[r.pts.length >> 1].x - camX, r.pts[r.pts.length >> 1].z - camZ) > 3000) return;
      const cycle = headway * SPEED;
      // up to two trains on a route at once (a cycle shorter than the route)
      for (let j = 0; j < 2; j++) {
        const head = ((elapsed * SPEED + r.phase * cycle) % cycle) + j * cycle;
        if (head - TRAIN_LEN > r.len || head < 0) continue;
        if (head - TRAIN_LEN > r.show1 || head < r.show0) continue; // wholly in a tunnel
        const t = trains[ri][j];
        t.y = r.y;
        let shown = false;
        for (let i = 0; i < CARS; i++) {
          const front = head - i * (CAR_LEN + CAR_GAP), back = front - CAR_LEN;
          sample(r, front, tmpA);
          sample(r, back, tmpB);
          const sec = t.sections[i];
          sec.x = (tmpA.x + tmpB.x) / 2;
          sec.z = (tmpA.z + tmpB.z) / 2;
          sec.yaw = Math.atan2(tmpA.x - tmpB.x, tmpA.z - tmpB.z);
          if (front < r.show0 || back > r.show1) continue;
          shown = true;
          const cab = i === 0 || i === CARS - 1;
          dummy.position.set(sec.x, r.y, sec.z);
          dummy.rotation.set(0, sec.yaw + (i === CARS - 1 ? Math.PI : 0), 0);
          dummy.updateMatrix();
          if (cab) cabs.setMatrixAt(nc++, dummy.matrix);
          else mids.setMatrixAt(nm++, dummy.matrix);
        }
        if (shown) sounding.push(t);
      }
    });
    cabs.count = nc;
    mids.count = nm;
    for (const m of [cabs, mids]) {
      if (!m.count) continue;
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, m.count * 16);
      m.instanceMatrix.needsUpdate = true;
    }
  }

  console.info(`[subway] ${VIADUCTS.length} viaduct (${VIADUCTS.map((V) => `${Math.round(V.len)} m, lower deck at ${Math.round(V.railY * 10) / 10} m, ${piers} piers`).join('; ')}), ${routes.length} train routes; ${ent.stairs} stair entrances & ${ent.signs} pylons alone at ${new Set(ent.sites.map((s) => s.name)).size} stations (${ent.skipped} left out)`);
  return api;
}

Object.assign(window.CITY, { createSubway, subwayKeepsClear, SUBWAY_VIADUCTS: VIADUCTS });
})();
