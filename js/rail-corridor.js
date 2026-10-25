(function () {
// js/rail-corridor.js
// The Union Station Rail Corridor and the lines running out of it (OpenStreetMap's heavy-rail tracks, GEO.rails from
// tools/geo-rails.mjs: the Lakeshore West & East, Kitchener, Barrie & Richmond Hill lines, the yards and crossovers),
// after aalghooneh/slop-toronto's rail corridor (MIT), and GO Transit trains running on it.
// - Track: every track as a ballast bed with its sleepers (one strip each, the stones & sleepers worked out in the
//   shader), two steel rails on top; flush with the asphalt only at the few real level crossings (yard roads).
// - Grade separations, as mapped (tools/geo-rails.mjs; the city itself is flat): where the streets bridge the corridor
//   (Spadina, Bathurst, Strachan, Dufferin...) they ride flyover decks (tools/geo-roads.mjs, city-grid.js) and the
//   tracks stay down; where the railway bridges the streets (York, Bay & Yonge under Union Station, Jarvis to Cherry,
//   King & Queen St W, Bloor St W, the Kingston line's streets east of the Don...) the tracks climb at 2% onto an
//   embankment (city-config.js railLiftAt: one height field, so parallel tracks & crossovers agree) and cross each
//   street on a concrete deck with parapets between abutments, the street under it in shade. The embankment's top runs
//   across to the neighbouring tracks; only its outer edges get retaining walls (and colliders for the player). The
//   raised tracks are decks too (city-config.js DECK_GRID): the player can walk up the embankment where it starts.
// - Trains: GO Transit consists (an MP40 locomotive and bilevel coaches, green & white) on the main lines, cruising
//   out in the city, slowing through the corridor and stopping at Union Station (up on the embankment over York & Bay).
//   They push the player aside when level with them, and the traffic (traffic.js setObstacles, which skips anything
//   2.5 m above or below) keeps clear of them at a level crossing; over or under a bridge nobody waits.
// - Cost: track tiles (ballast, rails, concrete) hidden beyond ~1.4 km, trains drawn within ~1.8 km, train count by
//   quality tier (`trains`).

const { THREE, GEO, QUALITY, blockAt, railLiftAt, railSpanAt, RAIL_LIFTS, waterAt, cutAt, CITY_BOUNDS } = window.CITY;
const { Fn, color, mix, step, smoothstep, abs, fract, floor, uv, positionWorld, positionGeometry, normalGeometry, float, vec2, sin, dot } = window.CITY.TSL;
const { cityUniforms, createParkLawnMaterial } = window.CITY;
const { mrt, vec4 } = window.CITY.TSL;

const TILE = 700;
const TRACK_DRAW = 1400;
const DRAW_RADIUS = 1800;
const NEAR = 500; // trains within this of the camera are obstacles to the traffic & push the player
const RAIL_GAUGE = 1.435;
const BED_HALF = 1.7; // ballast shoulder to shoulder 3.4 m
const EMB_HALF = 2.6; // a raised track's embankment or deck, centre to an outer edge
const NEIGHBOUR = 9.5; // a track this near abreast shares the embankment (its top runs across, no wall between)
const DECK_DEPTH = 1.3; // a rail bridge's deck, top to soffit
const PARAPET = 1.1;
const SLOPE = 1.6; // an embankment's grassed side: 1.6 m out per metre up, where it has the room (else a wall)
const LOCO_LEN = 21.4; // MP40PH-3C
const COACH_LEN = 25.9; // Bombardier BiLevel
const COUPLER = 0.9;
const CRUISE = 22; // m/s out in the city (~80 km/h)
const CORRIDOR_SPEED = 9; // through the corridor near Union
const ACCEL = 0.45;
const DECEL = 0.6;
const DWELL = 40;
const UNION = { x: 0, z: 95 }; // the platforms, south of the station's Front St facade (world origin)

const toPts = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
};

// ---------------------------------------------------------------------------------------------------------------------
// Track geometry
// ---------------------------------------------------------------------------------------------------------------------
// At-grade street carriageways in 40 m cells: where a track crosses one it lies flush, with no ballast
function buildRoadTest() {
  const cells = new Map();
  for (const r of window.CITY.ROADS) {
    if (r.raised) continue;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      for (let ix = Math.floor(Math.min(a.x, b.x) / 40); ix <= Math.floor(Math.max(a.x, b.x) / 40); ix++) {
        for (let iz = Math.floor(Math.min(a.z, b.z) / 40); iz <= Math.floor(Math.max(a.z, b.z) / 40); iz++) {
          const k = ix * 100000 + iz;
          (cells.get(k) || cells.set(k, []).get(k)).push([a, b, r.w / 2]);
        }
      }
    }
  }
  return (x, z, m) => {
    for (const [a, b, hw] of cells.get(Math.floor(x / 40) * 100000 + Math.floor(z / 40)) || []) {
      const ex = b.x - a.x, ez = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
      if (Math.hypot(a.x + ex * t - x, a.z + ez * t - z) < hw + m) return true;
    }
    return false;
  };
}

// The ballast & sleepers: grey-brown crushed stone (in world space, so overlapping beds at the crossovers agree),
// sleepers every 0.6 m across the middle 2.6 m (uv.x across, uv.y metres along)
function createBallastMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0.0 });
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const n1 = fract(sin(dot(floor(p.mul(9.0)), vec2(12.9898, 78.233))).mul(43758.5453));
    const n2 = fract(sin(dot(floor(p.mul(2.3)), vec2(39.346, 11.135))).mul(24634.6345));
    const stone = mix(color(0x4a4540), color(0x6b645b), n1.mul(0.7).add(n2.mul(0.3)));
    const u = abs(uv().x.sub(0.5));
    const sleeper = step(fract(uv().y.div(0.6)), 0.42).mul(step(u, 0.38));
    const shoulder = smoothstep(0.42, 0.5, u);
    return mix(mix(stone, color(0x2e2925), sleeper), stone.mul(0.85), shoulder);
  })();
  return mat;
}

// The bridges, abutments & retaining walls: poured concrete, weathered darker toward the ground
function createConcreteMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0.0 });
  mat.colorNode = Fn(() => {
    const p = positionWorld;
    const n = fract(sin(dot(floor(p.xz.mul(1.7).add(p.y.mul(0.9))), vec2(12.9898, 78.233))).mul(43758.5453));
    const grime = smoothstep(0.0, 2.4, p.y);
    // the pour's panel joints every 4 m, and its lifts every 1.5 m up
    const along = fract(p.x.add(p.z).div(4.0));
    const joint = smoothstep(0.0, 0.015, along).mul(float(1.0).sub(smoothstep(0.985, 1.0, along)));
    const lift = smoothstep(0.0, 0.02, fract(p.y.div(1.5)));
    return mix(color(0x4a463f), color(0x8c877d), grime).mul(n.mul(0.08).add(0.94)).mul(joint.mul(lift).mul(0.18).add(0.82));
  })();
  return mat;
}

// The embankments' grassed sides: the parks' turf (its bump & soft specular, js/tsl-materials.js), rougher and drier
// (railway verges are cut twice a year), greener and darker toward the foot of the slope
function createEmbankmentGrassMaterial() {
  const mat = createParkLawnMaterial(false);
  mat.roughness = 0.95;
  mat.colorNode = Fn(() => {
    const p = positionWorld;
    const wave = sin(p.x.mul(0.37).add(sin(p.z.mul(0.21)).mul(2.0))).mul(sin(p.z.mul(0.29).add(sin(p.x.mul(0.17)).mul(2.0)))).mul(0.5).add(0.5);
    const grain = fract(sin(dot(floor(p.xz.mul(3.3)), vec2(12.9898, 78.233))).mul(43758.5453));
    const turf = mix(color(0x26341a), color(0x3b4a22), wave.mul(0.7).add(grain.mul(0.3)));
    const dry = mix(turf, color(0x5b5734), smoothstep(0.62, 0.95, wave).mul(0.55));
    return mix(color(0x1f2b16), dry, smoothstep(0.0, 1.6, p.y));
  })();
  return mat;
}

function buildTrackwork(group) {
  const onRoad = buildRoadTest();
  const tiles = new Map();
  const tileOf = (x, z) => {
    const k = Math.floor(x / TILE) * 100000 + Math.floor(z / TILE);
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = { bed: [], bedUv: [], rail: [], wall: [], grass: [], x: (Math.floor(x / TILE) + 0.5) * TILE, z: (Math.floor(z / TILE) + 0.5) * TILE }));
    return t;
  };
  // a flat strip, wound counter-clockwise from above; uv.x 0..1 across, uv.y metres along (s0..s1)
  const strip = (pos, uvs, ax, ay, az, bx, by, bz, half, s0, s1) => {
    const L = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (-(bz - az) / L) * half;
    const nz = ((bx - ax) / L) * half;
    pos.push(ax - nx, ay, az - nz, bx + nx, by, bz + nz, bx - nx, by, bz - nz, ax - nx, ay, az - nz, ax + nx, ay, az + nz, bx + nx, by, bz + nz);
    if (uvs) uvs.push(0, s0, 1, s1, 0, s1, 0, s0, 1, s0, 1, s1);
  };
  // a rail: its head (0.07 m) on top of a web `h` tall, both sides
  const rail = (pos, ax, ay, az, bx, by, bz, h) => {
    strip(pos, null, ax, ay + h, az, bx, by + h, bz, 0.036);
    if (h <= 0.01) return;
    const L = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (-(bz - az) / L) * 0.036, nz = ((bx - ax) / L) * 0.036;
    for (const s of [-1, 1]) {
      const ex = ax + nx * s, ez = az + nz * s, fx = bx + nx * s, fz = bz + nz * s;
      if (s > 0) pos.push(ex, ay, ez, fx, by + h, fz, fx, by, fz, ex, ay, ez, ex, ay + h, ez, fx, by + h, fz);
      else pos.push(ex, ay, ez, fx, by, fz, fx, by + h, fz, ex, ay, ez, fx, by + h, fz, ex, ay + h, ez);
    }
  };
  // a quad p0 p1 p2 p3 (in order round its edge) facing (fx, fy, fz)
  const quad = (pos, p0, p1, p2, p3, fx, fy, fz) => {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const flip = (uy * vz - uz * vy) * fx + (uz * vx - ux * vz) * fy + (ux * vy - uy * vx) * fz < 0;
    const P = flip ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
    for (const i of [0, 1, 2, 0, 2, 3]) pos.push(P[i][0], P[i][1], P[i][2]);
  };
  // Where each track's neighbours run: every track sampled every 3 m in 10 m cells, to find the nearest one abreast
  // on either side (the embankment's top runs across to it, with no wall in between)
  const samples = new Map();
  const railCells = new Set(); // (50 m cells with track in them)
  const heavy = (GEO.rails || []).filter((r) => r[0] === 1);
  heavy.forEach(([, , , , flat], w) => {
    for (let i = 2; i < flat.length; i += 2) {
      const ax = flat[i - 2], az = flat[i - 1], bx = flat[i], bz = flat[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        const key = Math.floor(x / 10) * 100000 + Math.floor(z / 10);
        (samples.get(key) || samples.set(key, []).get(key)).push(x, z, w);
        railCells.add(Math.floor(x / 50) * 100000 + Math.floor(z / 50));
      }
    }
  });
  const reach = (mx, mz, tx, tz, w, side) => {
    let best = NEIGHBOUR;
    for (let ix = Math.floor((mx - NEIGHBOUR) / 10); ix <= Math.floor((mx + NEIGHBOUR) / 10); ix++) {
      for (let iz = Math.floor((mz - NEIGHBOUR) / 10); iz <= Math.floor((mz + NEIGHBOUR) / 10); iz++) {
        const L = samples.get(ix * 100000 + iz);
        if (!L) continue;
        for (let i = 0; i < L.length; i += 3) {
          if (L[i + 2] === w) continue;
          const dx = L[i] - mx, dz = L[i + 1] - mz;
          if (Math.abs(dx * tx + dz * tz) > 2.2) continue;
          const o = (-dx * tz + dz * tx) * side;
          if (o > 1 && o < best) best = o;
        }
      }
    }
    return best < NEIGHBOUR ? best / 2 + 0.15 : 0; // half way across to it, or 0: none (an outer edge)
  };
  // Room for a grassed side: no street (or its sidewalk), building, other track or water where the slope would run.
  // The buildings near the tracks, rasterised into 4 m cells
  const built = new Set();
  for (const [cx, cz, ang, parts] of GEO.buildings || []) {
    const c50x = Math.floor(cx / 50), c50z = Math.floor(cz / 50);
    let near = false;
    for (let a = -1; a <= 1 && !near; a++) for (let b = -1; b <= 1 && !near; b++) near = railCells.has((c50x + a) * 100000 + c50z + b);
    if (!near) continue;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    for (const [u0, u1, v0, v1] of parts) {
      for (let u = u0 - 1; u <= u1 + 1; u += 2) {
        for (let v = v0 - 1; v <= v1 + 1; v += 2) built.add(Math.floor((cx + u * cs + v * sn) / 4) * 100000 + Math.floor((cz - u * sn + v * cs) / 4));
      }
    }
  }
  const otherTrack = (x, z, w, r) => {
    const L = samples.get(Math.floor(x / 10) * 100000 + Math.floor(z / 10));
    for (let i = 0; L && i < L.length; i += 3) if (L[i + 2] !== w && Math.hypot(L[i] - x, L[i + 1] - z) < r) return true;
    return false;
  };
  const room = (x, z, w) => !onRoad(x, z, 4.5) && !built.has(Math.floor(x / 4) * 100000 + Math.floor(z / 4)) && !otherTrack(x, z, w, 3) && !waterAt(x, z);
  const colliders = [];
  const shade = [];
  let km = 0;
  heavy.forEach(([, , , flags, flat], w) => {
    if (flags & 2) return;
    const P = toPts(flat);
    let s = 0;
    let wasSpan = null; // the previous piece: on a bridge span (true), on the embankment (false), at grade (null)
    let col = null; // the collider being grown along the embankment
    const sloped = { 1: false, '-1': false }; // the previous piece's sides: grassed (true) or walled
    let edge = null; // the previous raised piece's half widths & height (for a deck's end)
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i], b = P[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 0.01) continue;
      const tx = (b.x - a.x) / L, tz = (b.z - a.z) / L;
      const nx = -tz, nz = tx; // left
      const n = Math.max(1, Math.ceil(L / 3));
      const seg = L / n;
      for (let k = 0; k < n; k++) {
        const ax = a.x + tx * seg * k, az = a.z + tz * seg * k;
        const bx = ax + tx * seg, bz = az + tz * seg;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const block = blockAt(mx, mz) ? CITY_BOUNDS.sidewalkHeight : 0;
        const ya = Math.max(railLiftAt(ax, az), block), yb = Math.max(railLiftAt(bx, bz), block);
        const T = tileOf(mx, mz);
        // (a bridge at grade over a road cut, city-config.js cutAt, counts as raised: a deck on its own)
        const overCut = cutAt(mx, mz) < -0.5;
        const raised = Math.max(ya, yb) > 0.4 || overCut;
        const street = !raised && onRoad(mx, mz, 1.0);
        if (!street) strip(T.bed, T.bedUv, ax, ya + 0.02, az, bx, yb + 0.02, bz, BED_HALF, s, s + seg);
        const y = street ? 0.012 : 0.04;
        for (const o of [-RAIL_GAUGE / 2, RAIL_GAUGE / 2]) rail(T.rail, ax + nx * o, ya + y, az + nz * o, bx + nx * o, yb + y, bz + nz * o, street ? 0 : 0.14);
        // the end of a deck that comes down to the ground (a bridge at grade over a road cut)
        if (!raised && wasSpan === true && edge) {
          const E = (o, yy) => [ax + nx * o, yy, az + nz * o];
          quad(T.wall, E(-edge.hr, edge.y - DECK_DEPTH), E(edge.hl, edge.y - DECK_DEPTH), E(edge.hl, edge.y), E(-edge.hr, edge.y), tx, 0, tz);
        }
        if (!raised) {
          wasSpan = null;
          col = null;
          sloped[1] = sloped[-1] = false;
          s += seg;
          continue;
        }
        // Raised: the embankment (or bridge deck) across to the neighbouring tracks, walled where it's an outer edge
        const rl = reach(mx, mz, tx, tz, w, 1), rr = reach(mx, mz, tx, tz, w, -1);
        const hl = rl || EMB_HALF, hr = rr || EMB_HALF;
        // a span over the street (and where a skewed crossing's embankment would stand in its sidewalk, with the
        // headroom to bridge it: the skewed bridge runs longer), or over water
        const span = overCut || !!(railSpanAt(mx, mz) || waterAt(mx, mz)) || (Math.min(ya, yb) > 5.2 &&
          (onRoad(mx + nx * hl, mz + nz * hl, 4.8) || onRoad(mx - nx * hr, mz - nz * hr, 4.8)));
        const A = (o, yy) => [ax + nx * o, yy, az + nz * o];
        const B = (o, yy) => [bx + nx * o, yy, bz + nz * o];
        // the top (ballast-coloured, its uv.x 0: no sleepers; fills meeting from neighbouring tracks agree)
        T.bed.push(...A(-hr, ya), ...B(hl, yb), ...B(-hr, yb), ...A(-hr, ya), ...A(hl, ya), ...B(hl, yb));
        T.bedUv.push(0, s, 0, s, 0, s, 0, s, 0, s, 0, s);
        const base = (yy) => (span ? yy - DECK_DEPTH : 0);
        const ext = { 1: hl, '-1': hr }; // how far the embankment reaches either side (its slopes too), for the collider
        for (const [o, outer, sg] of [[hl, !rl, 1], [-hr, !rr, -1]]) {
          if (!outer) {
            sloped[sg] = false;
            continue;
          }
          // a grassed slope where there's room for it (tested half way down and at its toe)
          const wa = ya * SLOPE, wb = yb * SLOPE, wm = (wa + wb) / 2;
          const grass = !span && ya > 0.6 && yb > 0.6 && [0.5, 1].every((f) => room(mx + nx * sg * (Math.abs(o) + wm * f + 0.5), mz + nz * sg * (Math.abs(o) + wm * f + 0.5), w));
          if (grass) {
            quad(T.grass, A(o, ya), B(o, yb), B(o + sg * wb, 0), A(o + sg * wa, 0), nx * sg, 1, nz * sg);
            if (!sloped[sg]) for (const f of [-1, 1]) quad(T.grass, A(o, 0), A(o, ya), A(o + sg * wa, 0), A(o, 0), tx * f, 0, tz * f);
            ext[sg] = Math.abs(o) + wm;
          } else if (sloped[sg]) for (const f of [-1, 1]) quad(T.grass, A(o, 0), A(o, ya), A(o + sg * wa, 0), A(o, 0), tx * f, 0, tz * f);
          sloped[sg] = grass;
          if (grass) continue;
          // the retaining wall (embankment) or the deck's edge beam (span), and on a span its parapet
          quad(T.wall, A(o, base(ya)), B(o, base(yb)), B(o, yb), A(o, ya), nx * sg, 0, nz * sg);
          if (span) {
            const i0 = o - 0.3 * sg;
            quad(T.wall, A(o, ya), B(o, yb), B(o, yb + PARAPET), A(o, ya + PARAPET), nx * sg, 0, nz * sg);
            quad(T.wall, A(i0, ya), B(i0, yb), B(i0, yb + PARAPET), A(i0, ya + PARAPET), -nx * sg, 0, -nz * sg);
            quad(T.wall, A(i0, ya + PARAPET), B(i0, yb + PARAPET), B(o, yb + PARAPET), A(o, ya + PARAPET), 0, 1, 0);
          }
        }
        if (span) {
          // the soffit
          quad(T.wall, A(-hr, ya - DECK_DEPTH), B(-hr, yb - DECK_DEPTH), B(hl, yb - DECK_DEPTH), A(hl, ya - DECK_DEPTH), 0, -1, 0);
        }
        // the abutment where the embankment meets a span: its face toward the street, from the ground to the deck
        if (wasSpan !== null && wasSpan !== span) {
          const f = span ? 1 : -1;
          quad(T.wall, A(-hr, 0), A(hl, 0), A(hl, ya), A(-hr, ya), tx * f, 0, tz * f);
        }
        if (wasSpan === null && span) quad(T.wall, A(-hr, ya - DECK_DEPTH), A(hl, ya - DECK_DEPTH), A(hl, ya), A(-hr, ya), -tx, 0, -tz);
        wasSpan = span;
        edge = { hl, hr, y: yb };
        // the player's collider: the embankment's body, in pieces of up to 12 m (none under a span or where it's low
        // enough to step onto)
        if (span || Math.min(ya, yb) < 0.6) col = null;
        else {
          const off = (ext[1] - ext[-1]) / 2, hx = (ext[1] + ext[-1]) / 2;
          // (its top a little under the surface: whoever walks up the ramp stands above it)
          const top = Math.min(ya, yb) - 0.25;
          if (col && col.i === i && col.len + seg <= 12.01 && Math.abs(col.hx - hx) < 0.3) {
            col.len += seg;
            col.maxY = Math.min(col.maxY, top);
            col.hx = Math.max(col.hx, hx);
          } else colliders.push((col = { i, x0: ax + nx * off, z0: az + nz * off, len: seg, hx, tx, tz, maxY: top }));
        }
        s += seg;
      }
      km += L;
    }
  });
  // colliders as the player's turned rectangles (js/world-collision.js)
  const boxes = colliders.map((c) => {
    c.cx = c.x0 + (c.tx * c.len) / 2;
    c.cz = c.z0 + (c.tz * c.len) / 2;
    const hz = c.len / 2 + 0.05, cs = c.tz, sn = c.tx;
    const ex = Math.abs(cs) * c.hx + Math.abs(sn) * hz, ez = Math.abs(sn) * c.hx + Math.abs(cs) * hz;
    return { minX: c.cx - ex, maxX: c.cx + ex, minZ: c.cz - ez, maxZ: c.cz + ez, maxY: c.maxY, obb: { cx: c.cx, cz: c.cz, hx: c.hx, hz, cs, sn } };
  });
  // The shade under the bridges: a dark veil over each street the tracks cross, its sidewalks & under the decks' edges
  for (const l of RAIL_LIFTS) {
    const L = Math.hypot(l.x1 - l.x0, l.z1 - l.z0) || 1;
    const ux = (l.x1 - l.x0) / L, uz = (l.z1 - l.z0) / L;
    const ex = 3, half = l.hw + 5;
    const y = l.road + CITY_BOUNDS.sidewalkHeight + 0.04; // (the street's height under it: below 0 in a road cut)
    const ax = l.x0 - ux * ex, az = l.z0 - uz * ex, bx = l.x1 + ux * ex, bz = l.z1 + uz * ex;
    quad(shade, [ax - uz * half, y, az + ux * half], [bx - uz * half, y, bz + ux * half], [bx + uz * half, y, bz - ux * half], [ax + uz * half, y, az - ux * half], 0, 1, 0);
  }
  const bedMat = createBallastMaterial();
  const railMat = new THREE.MeshStandardNodeMaterial({ color: 0x8e8a84, roughness: 0.35, metalness: 0.85 });
  const wallMat = createConcreteMaterial();
  const grassMat = createEmbankmentGrassMaterial();
  const first = {};
  const out = [];
  const mesh = (pos, uvs, mat, name, cast) => {
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    else g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.receiveShadow = true;
    m.castShadow = !!cast;
    if (first[name]) m.userData.sharesPipelineWith = first[name];
    else first[name] = m;
    group.add(m);
    return m;
  };
  for (const T of tiles.values()) {
    out.push({ x: T.x, z: T.z, meshes: [mesh(T.bed, T.bedUv, bedMat, 'RailBallast'), mesh(T.rail, null, railMat, 'RailRails'), mesh(T.wall, null, wallMat, 'RailBridges', true), mesh(T.grass, null, grassMat, 'RailEmbankments')].filter(Boolean) });
  }
  if (shade.length) {
    const veilMat = new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
    // (no sky to reflect under a bridge: the wet-road reflections fade there, as under a car, js/tsl-materials.js)
    veilMat.mrtNode = mrt({ normal: vec4(0.0, 0.0, 0.0, 0.0), metalRough: vec4(0.0, 1.0, 0.0, 0.7) });
    const veil = mesh(shade, null, veilMat, 'RailBridgeShade');
    veil.receiveShadow = false;
    veil.renderOrder = 1;
  }
  return { tiles: out, km: km / 1000, colliders: boxes };
}

// ---------------------------------------------------------------------------------------------------------------------
// Train routes: the main lines chained into runs (as the streetcars' tracks, js/streetcars.js)
// ---------------------------------------------------------------------------------------------------------------------
function chain(ways) {
  const key = (p) => `${Math.round(p.x * 2)},${Math.round(p.z * 2)}`;
  const ends = new Map();
  ways.forEach((w, i) => {
    for (const [k, atStart] of [[key(w[0]), true], [key(w[w.length - 1]), false]]) {
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push({ w: i, atStart });
    }
  });
  const used = new Set();
  const dir = (a, b) => {
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return [(b.x - a.x) / L, (b.z - a.z) / L];
  };
  const extend = (c) => {
    for (;;) {
      const last = c[c.length - 1];
      const d = dir(c[c.length - 2], last);
      let best = null;
      let bd = 0.8; // trains go straight on: within ~37°
      for (const e of ends.get(key(last)) || []) {
        if (used.has(e.w)) continue;
        const pts = e.atStart ? ways[e.w] : ways[e.w].slice().reverse();
        const nd = dir(pts[0], pts[1]);
        const dt = d[0] * nd[0] + d[1] * nd[1];
        if (dt > bd) {
          bd = dt;
          best = { e, pts };
        }
      }
      if (!best) return;
      used.add(best.e.w);
      c.push(...best.pts.slice(1));
    }
  };
  const order = ways.map((w, i) => i).sort((a, b) => ways[b].length - ways[a].length);
  const out = [];
  for (const i of order) {
    if (used.has(i) || ways[i].length < 2) continue;
    used.add(i);
    const c = ways[i].slice();
    extend(c);
    c.reverse();
    extend(c);
    c.reverse();
    out.push(c);
  }
  return out;
}

function makeRoute(src) {
  const pts = [{ x: src[0].x, z: src[0].z, y: 0 }];
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1], b = src[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
    for (let k = 1; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n, y: 0 });
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  for (const p of pts) p.y = Math.max(railLiftAt(p.x, p.z), blockAt(p.x, p.z) ? CITY_BOUNDS.sidewalkHeight : 0) + 0.18; // on the rails
  const route = { pts, cum, len: cum[cum.length - 1], union: -1 };
  // Union Station's platforms: the point of the route nearest them, if it passes within 60 m
  let best = 60;
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - UNION.x, p.z - UNION.z);
    if (d < best) {
      best = d;
      route.union = cum[i];
    }
  });
  return route;
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
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.yaw = Math.atan2(b.x - a.x, b.z - a.z);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// GO Transit rolling stock
// ---------------------------------------------------------------------------------------------------------------------
// A bilevel coach: the lower deck's windows low, the upper deck's under the curved roof; white with GO's green below
function coachGeometry() {
  const W = 3.0, H = 4.84;
  const g = new THREE.BoxGeometry(W, H - 0.9, COACH_LEN, 1, 6, 1).translate(0, 0.9 + (H - 0.9) / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    // the bilevel's tapered upper sides & roof
    if (y > 3.2) p.setX(i, p.getX(i) * (1 - ((y - 3.2) / (H - 3.2)) * 0.18));
  }
  g.computeVertexNormals();
  return g;
}
function locoGeometry() {
  const W = 3.1, H = 4.6;
  const g = new THREE.BoxGeometry(W, H - 1.0, LOCO_LEN, 1, 4, 6).translate(0, 1.0 + (H - 1.0) / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    // the cab at the front (+z): a raked nose below the windscreen; the long hood behind it a little narrower on top
    if (z > LOCO_LEN / 2 - 0.01 && y > 2.0) p.setZ(i, z - Math.min(1, (y - 2.0) / 1.2) * 0.9);
    if (z < LOCO_LEN / 2 - 4 && y > H - 0.1) p.setX(i, p.getX(i) * 0.8);
  }
  g.computeVertexNormals();
  return g;
}
function createCoachMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.42, metalness: 0.2 });
  const y = positionGeometry.y;
  const side = step(0.5, abs(normalGeometry.x));
  const lowWin = smoothstep(1.55, 1.6, y).mul(float(1.0).sub(smoothstep(2.25, 2.3, y)));
  const upWin = smoothstep(2.95, 3.0, y).mul(float(1.0).sub(smoothstep(3.65, 3.7, y)));
  // windows in pairs along the car (uv: BoxGeometry's side faces run 0..1 along the length)
  const along = fract(uv().x.mul(9.0));
  const pane = smoothstep(0.08, 0.12, along).mul(float(1.0).sub(smoothstep(0.88, 0.92, along)));
  const glass = lowWin.max(upWin).mul(pane).mul(side);
  const green = smoothstep(0.92, 0.96, y).mul(float(1.0).sub(smoothstep(1.32, 1.36, y)));
  const roof = step(0.4, normalGeometry.y);
  mat.colorNode = mix(mix(mix(color(0xf1f1ec), color(0x0f6b3a), green), color(0x15191c), glass), color(0x9fa3a6), roof);
  mat.roughnessNode = mix(float(0.42), float(0.1), glass);
  const night = smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow);
  mat.emissiveNode = color(0xfff0d0).mul(glass).mul(night).mul(0.5);
  return mat;
}
function createLocoMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.45, metalness: 0.25 });
  const y = positionGeometry.y;
  const front = step(0.5, normalGeometry.z);
  const lx = abs(positionGeometry.x);
  const green = float(1.0).sub(smoothstep(2.15, 2.2, y));
  const screen = front.mul(smoothstep(2.75, 2.8, y)).mul(float(1.0).sub(smoothstep(3.55, 3.6, y))).mul(step(lx, 1.3));
  const roof = step(0.85, normalGeometry.y); // (not the raked cab front)
  mat.colorNode = mix(mix(mix(color(0xf1f1ec), color(0x0f6b3a), green), color(0x101316), screen), color(0x5d6266), roof);
  const night = smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow);
  const lamp = front.mul(smoothstep(1.6, 1.65, y)).mul(float(1.0).sub(smoothstep(1.85, 1.9, y))).mul(smoothstep(0.8, 0.85, lx)).mul(float(1.0).sub(smoothstep(1.15, 1.2, lx)));
  mat.emissiveNode = color(0xfff3dc).mul(lamp).mul(night.mul(2.5).add(0.3));
  return mat;
}

function createRailCorridor(scene, trafficSystem) {
  const group = new THREE.Group();
  group.name = 'RailCorridor';
  const trackGroup = new THREE.Group();
  trackGroup.name = 'RailTracks';
  const { tiles, km, colliders } = buildTrackwork(trackGroup);
  group.add(trackGroup);

  // Routes: the main lines (no yard, siding or crossover), at least 1.5 km long
  const ways = [];
  for (const [kind, service, , , flat] of GEO.rails || []) if (kind === 1 && !service) ways.push(toPts(flat));
  const routes = chain(ways).map(makeRoute).filter((r) => r.len > 1500);

  // The trains: on the long runs, more on the longest (x the tier's `trains`)
  const COACHES = 8;
  const trainLen = LOCO_LEN + COACHES * (COACH_LEN + COUPLER);
  const trains = [];
  const k = QUALITY.trains ?? 1;
  for (const r of routes) {
    const n = Math.round((r.len / 6000) * k + (r.union >= 0 ? 0.6 : 0.2));
    for (let i = 0; i < n; i++) {
      trains.push({ route: r, s: trainLen + ((i + 0.3) / n) * (r.len - trainLen), speed: CRUISE * 0.6, dwell: 0, stopped: false, wait: 0, cars: Array.from({ length: COACHES + 1 }, () => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 })) });
    }
  }
  const nT = Math.max(1, trains.length);
  const locos = new THREE.InstancedMesh(locoGeometry(), createLocoMaterial(), nT);
  const coaches = new THREE.InstancedMesh(coachGeometry(), createCoachMaterial(), nT * COACHES);
  for (const m of [locos, coaches]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    group.add(m);
  }
  scene.add(group);

  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';
  const tmp = { x: 0, y: 0, z: 0, yaw: 0 };
  const obstacles = [];
  const cull = QUALITY.cull || 1;
  // speed limit at s along a route: slow through the corridor round Union Station
  const limit = (r, s) => {
    sample(r, s, tmp);
    return Math.abs(tmp.x - UNION.x) < 1600 && Math.abs(tmp.z - UNION.z) < 500 ? CORRIDOR_SPEED : CRUISE;
  };

  function update(dt, camera, playerEnt, activeMode) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    const camX = camera ? camera.position.x : 0;
    const camZ = camera ? camera.position.z : 0;
    const ground = playerEnt && activeMode !== 'helicopter' ? playerEnt : null;
    obstacles.length = 0;
    let nl = 0, nc = 0;
    for (const t of trains) {
      const r = t.route;
      if (t.wait > 0) {
        // gone from the end of its run, waiting to come round again at its start, out of sight
        t.wait -= dt;
        if (t.wait <= 0 && Math.hypot(r.pts[0].x - camX, r.pts[0].z - camZ) < 700) t.wait = 5;
        if (t.wait <= 0) {
          t.s = trainLen;
          t.speed = limit(r, t.s) * 0.7;
          t.stopped = false;
        }
        continue;
      }
      let target = Math.min(limit(r, t.s), limit(r, t.s + 120));
      // the end of the run: draw up there (a run ending in the corridor: laid over), leave once nobody is near
      target = Math.min(target, Math.sqrt(Math.max(0, 2 * DECEL * (r.len - t.s))));
      if (t.s > r.len - 2 && t.speed < 0.5) {
        const end = r.pts[r.pts.length - 1];
        if (Math.hypot(end.x - camX, end.z - camZ) > 700 + trainLen) {
          t.wait = 30 + Math.random() * 90;
          continue;
        }
      }
      if (t.dwell > 0) {
        t.dwell -= dt;
        target = 0;
      } else if (r.union >= 0 && !t.stopped) {
        // stop with the train's middle at the platforms
        const d = r.union + trainLen / 2 - t.s;
        if (d > -1 && d < 400) {
          target = Math.min(target, Math.sqrt(Math.max(0, 2 * DECEL * d)));
          if (d < 1 && t.speed < 0.8) {
            t.dwell = DWELL;
            t.stopped = true;
            t.speed = 0;
          }
        }
      }
      if (t.speed < target) t.speed = Math.min(target, t.speed + ACCEL * dt);
      else t.speed = Math.max(target, t.speed - DECEL * 1.5 * dt);
      t.s = Math.min(r.len, t.s + t.speed * dt);
      // the cars follow the track behind the locomotive
      let back = t.s;
      for (let i = 0; i < t.cars.length; i++) {
        const L = i === 0 ? LOCO_LEN : COACH_LEN;
        const c = t.cars[i];
        sample(r, back, tmp);
        const ax = tmp.x, ay = tmp.y, az = tmp.z;
        sample(r, back - L, tmp);
        c.x = (ax + tmp.x) / 2;
        c.y = (ay + tmp.y) / 2;
        c.z = (az + tmp.z) / 2;
        c.yaw = Math.atan2(ax - tmp.x, az - tmp.z);
        c.pitch = Math.atan2(ay - tmp.y, L);
        c.on = back - L > 0; // still on the route (off its start: not drawn)
        back -= L + COUPLER;
      }
      const head = t.cars[0];
      const dCam = Math.hypot(head.x - camX, head.z - camZ);
      if (dCam < NEAR + trainLen) {
        t.cars.forEach((c, i) => {
          if (!c.on) return;
          const halfL = (i === 0 ? LOCO_LEN : COACH_LEN) / 2 + COUPLER / 2;
          obstacles.push({ x: c.x, y: c.y, z: c.z, yaw: c.yaw, halfW: 1.55, halfL, speed: t.speed });
          if (ground) push(c, halfL, ground, activeMode);
        });
      }
      if (dCam > DRAW_RADIUS * cull + trainLen) continue;
      t.cars.forEach((c, i) => {
        if (!c.on) return;
        dummy.position.set(c.x, c.y, c.z);
        dummy.rotation.set(-c.pitch, c.yaw, 0);
        dummy.updateMatrix();
        if (i === 0) locos.setMatrixAt(nl++, dummy.matrix);
        else coaches.setMatrixAt(nc++, dummy.matrix);
      });
    }
    locos.count = nl;
    coaches.count = nc;
    for (const m of [locos, coaches]) {
      if (!m.count) continue;
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, m.count * 16);
      m.instanceMatrix.needsUpdate = true;
    }
    if (trafficSystem && trafficSystem.setObstacles) trafficSystem.setObstacles(obstacles, 'trains');
    const trackR = TRACK_DRAW * cull + TILE * 0.7;
    for (const T of tiles) {
      const vis = Math.hypot(T.x - camX, T.z - camZ) < trackR;
      for (const m of T.meshes) m.visible = vis;
    }
  }

  // A rail car shoves the player out of its box along the shallower side
  function push(c, halfL, ground, activeMode) {
    if (Math.abs(ground.position.y - c.y) > 3) return;
    const r = activeMode === 'car' ? 1.6 : activeMode === 'cyclist' ? 0.8 : 0.45;
    const dx = ground.position.x - c.x;
    const dz = ground.position.z - c.z;
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const lx = dx * cs - dz * sn;
    const lz = dx * sn + dz * cs;
    const px = 1.55 + r - Math.abs(lx);
    const pz = halfL + r - Math.abs(lz);
    if (px <= 0 || pz <= 0) return;
    if (px < pz) {
      const s = Math.sign(lx) || 1;
      ground.position.x += cs * px * s;
      ground.position.z -= sn * px * s;
    } else {
      const s = Math.sign(lz) || 1;
      ground.position.x += sn * pz * s;
      ground.position.z += cs * pz * s;
    }
    if (ground.speed) ground.speed *= 0.3;
  }

  console.info(`[rail] ${Math.round(km * 10) / 10} km of track in ${tiles.length} tiles, ${RAIL_LIFTS.length} streets bridged, ${colliders.length} embankment colliders, ${routes.length} train routes, ${trains.length} GO trains`);
  return { group, update, trains, routes, colliders };
}

Object.assign(window.CITY, { createRailCorridor, createConcreteMaterial, createBallastMaterial, createEmbankmentGrassMaterial });
})();
