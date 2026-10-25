(function () {
// js/streetcars.js
// The TTC's streetcars on the real network (OpenStreetMap's tram tracks, GEO.rails from tools/geo-rails.mjs): 501
// Queen out to the Humber Loop, 504 King, 505 Dundas, 506 College, 509 Harbourfront & 510 Spadina on their rights-of-way
// (down into the Union Station loop's tunnel), 511 Bathurst, Cherry St... Ported from aalghooneh/slop-toronto's
// js/streetcars.js (MIT) to this city's classic scripts, geodata, decks, quality tiers & culling.
// - Tracks: every main track's ways chained into continuous runs, going straight on through the junctions; each run is
//   driven the way right-hand traffic uses it (the side of the street it lies on). The rails are set into the road in
//   a concrete track bed (on the raised rights-of-way of Spadina & Queens Quay), ride the bridges' decks (the Queen St
//   & Dundas St bridges over the Don) and dip into the tunnels; the overhead contact wire hangs above them.
// - Cars: 30 m, five-section Flexity Outlook streetcars in TTC red, articulated along the curves. They dwell at the
//   real stops, wait at red lights, queue behind the traffic (traffic.js) and the player, and shove the player aside on
//   contact; traffic.js in turn keeps behind them (setObstacles).
// - Cost: the trackwork is cut into 700 m tiles hidden beyond ~1.2 km; only the cars within DRAW_RADIUS are drawn (all
//   of them run). Fleet size by quality tier (quality.js `streetcarSpacing`).

const { THREE, GEO, QUALITY, blockAt, deckHeightAt, signalPhase, ROADS, cityUniforms } = window.CITY;
const { Fn, color, mix, step, smoothstep, abs, uv, positionGeometry, normalGeometry, float } = window.CITY.TSL;
const { mergeGeometries } = window.CITY.Addons;

const GAUGE = 1.495; // TTC broad gauge (4 ft 10 7/8 in)
const SECTIONS = [6.6, 5.7, 5.4, 5.7, 6.6]; // module lengths, nose to tail (30.2 m with the gangways)
const DOORS = [-1.2, 0, null, 0, 1.2]; // a double door per module (local z of its centre; the cab modules behind the cab)
const GANGWAY = 0.55;
const CAR_LEN = SECTIONS.reduce((t, l) => t + l, 0) + GANGWAY * (SECTIONS.length - 1);
const HALF_W = 1.27;
const HEIGHT = 3.84;
const MAX_SPEED = 13; // m/s (~47 km/h, downtown)
const ACCEL = 1.1;
const DECEL = 1.4;
const DWELL = 9;
const WIRE_Y = 5.6;
const TILE = 700; // trackwork tiles (m)
const TRACK_DRAW = 1200; // trackwork drawn within (m, x the tier's cull)
const DRAW_RADIUS = 1100; // cars drawn within (m, x the tier's cull)
const NEAR = 450; // cars within this of the camera see the traffic & are obstacles to it

const toPts = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
};

// ---------------------------------------------------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------------------------------------------------
// The main tracks (and the loops) chained into continuous runs: at each end, on into the way going most nearly
// straight on (within 60°). Every point keeps the flags of the way it came from (1 bridge, 2 tunnel).
function chainWays(ways) {
  const key = (p) => `${Math.round(p.x * 2)},${Math.round(p.z * 2)}`;
  const ends = new Map();
  const addEnd = (k, w, atStart) => {
    if (!ends.has(k)) ends.set(k, []);
    ends.get(k).push({ w, atStart });
  };
  ways.forEach((w, i) => {
    addEnd(key(w[0]), i, true);
    addEnd(key(w[w.length - 1]), i, false);
  });
  const used = new Set();
  const dir = (a, b) => {
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return [(b.x - a.x) / L, (b.z - a.z) / L];
  };
  function extend(chain) {
    for (;;) {
      const last = chain[chain.length - 1];
      const d = dir(chain[chain.length - 2], last);
      let best = null;
      let bd = 0.5;
      for (const c of ends.get(key(last)) || []) {
        if (used.has(c.w)) continue;
        const pts = c.atStart ? ways[c.w] : ways[c.w].slice().reverse();
        const nd = dir(pts[0], pts[1]);
        const dot = d[0] * nd[0] + d[1] * nd[1];
        if (dot > bd) {
          bd = dot;
          best = { c, pts };
        }
      }
      if (!best) return;
      used.add(best.c.w);
      chain.push(...best.pts.slice(1));
    }
  }
  const order = ways.map((w, i) => i).sort((a, b) => ways[b].length - ways[a].length);
  const chains = [];
  for (const i of order) {
    if (used.has(i) || ways[i].length < 2) continue;
    used.add(i);
    const chain = ways[i].slice();
    extend(chain);
    chain.reverse();
    extend(chain);
    chain.reverse();
    chains.push(chain);
  }
  return chains;
}

// A polyline resampled every ~2 m with arc lengths and heights: the road deck under it followed like a vehicle would
// (deckHeightAt, stepping at most 0.45 m every 2 m (the decks start 0.3 m up): up a bridge's approach ramp, never onto a flyover passing overhead), the raised
// right-of-way (a curb island), and in a tunnel a 9% dive to 7.5 m down
function makeTrack(src) {
  const pts = [{ x: src[0].x, z: src[0].z, f: src[0].f || 0, y: 0 }];
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1];
    const b = src[i];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(L / 2));
    for (let k = 1; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n, f: b.f || 0, y: 0 });
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  let deck = 0;
  for (const p of pts) {
    deck = deckHeightAt(p.x, p.z, deck, 0.45);
    p.y = Math.max(deck, blockAt(p.x, p.z) ? 0.22 : 0);
  }
  // tunnels: depth by the distance from the nearest portal along the track
  const into = pts.map(() => Infinity);
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    d = pts[i].f & 2 ? d + (i ? cum[i] - cum[i - 1] : 0) : 0;
    into[i] = d;
  }
  d = Infinity;
  for (let i = pts.length - 1; i >= 0; i--) {
    d = pts[i].f & 2 ? d + (i < pts.length - 1 ? cum[i + 1] - cum[i] : 0) : 0;
    into[i] = Math.min(into[i], d);
  }
  pts.forEach((p, i) => {
    if (p.f & 2) p.y = -Math.min(7.5, (Number.isFinite(into[i]) ? into[i] : 1e3) * 0.09);
  });
  return { pts, cum, len: cum[cum.length - 1], stops: [], signals: [] };
}

function sample(track, s, out) {
  const { pts, cum } = track;
  s = Math.max(0, Math.min(track.len, s));
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const t = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.yaw = Math.atan2(b.x - a.x, b.z - a.z);
  return out;
}

// A grid of points (stops, signalised junctions) and, per track, the nearest along it of those within `reach` m
function pointGrid(items, cell) {
  const grid = new Map();
  for (const it of items) {
    const k = Math.floor(it.x / cell) * 100000 + Math.floor(it.z / cell);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(it);
  }
  return { grid, cell };
}
function nearAlong(track, G, reach) {
  const best = new Map(); // item -> { s, d }
  const { pts, cum } = track;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const ix = Math.floor(p.x / G.cell);
    const iz = Math.floor(p.z / G.cell);
    for (let a = -1; a <= 1; a++) {
      for (let c = -1; c <= 1; c++) {
        for (const it of G.grid.get((ix + a) * 100000 + iz + c) || []) {
          const d = Math.hypot(it.x - p.x, it.z - p.z);
          if (d > reach) continue;
          const b = best.get(it);
          if (!b || d < b.d) best.set(it, { s: cum[i], d });
        }
      }
    }
  }
  return best;
}

// The traffic's roads the streetcars run along get e.tram (John: "there shouldn't be buses on streetcar routes": the
// TTC runs streetcars there, not buses; traffic.js keeps its buses off them): most of the road's length, from 20% to 80%
// along its middle, within its half-width (+1.5 m) of a track
function markStreetcarStreets(network, tracks) {
  const pts = [];
  for (const t of tracks) for (let i = 0; i < t.pts.length; i += 2) if (t.pts[i].y > -1) pts.push(t.pts[i]);
  const G = pointGrid(pts, 20);
  const nearTrack = (x, z, reach) => {
    const ix = Math.floor(x / G.cell), iz = Math.floor(z / G.cell);
    for (let a = -1; a <= 1; a++) {
      for (let c = -1; c <= 1; c++) {
        for (const p of G.grid.get((ix + a) * 100000 + iz + c) || []) if (Math.hypot(p.x - x, p.z - z) < reach) return true;
      }
    }
    return false;
  };
  let marked = 0;
  for (const e of (network && network.edges) || []) {
    if (!(e.len > 0)) continue;
    const reach = (e.half || 6) + 1.5;
    let hits = 0;
    for (let k = 1; k <= 5; k++) {
      const s = e.len * (0.1 + 0.15 * k);
      if (nearTrack(e.sx + e.dx * s, e.sz + e.dz * s, reach)) hits++;
    }
    e.tram = hits >= 3;
    if (e.tram) marked++;
  }
  console.info(`[streetcars] ${marked} road links carry streetcars (no buses on them)`);
}

function buildTracks(network) {
  const ways = [];
  for (const [kind, service, name, flags, flat] of GEO.rails || []) {
    if (kind !== 0 || (service && !/Loop/i.test(name))) continue;
    ways.push(toPts(flat).map((p) => ({ x: p.x, z: p.z, f: flags })));
  }
  const tracks = chainWays(ways).map(makeTrack).filter((t) => t.len > 150);

  // Direction of travel on each track: right-hand traffic's. Where the track lies off the middle of its street (two
  // tracks), the side it lies on; on the middle (single track, loops), the way the traffic drives in the lanes it
  // shares; failing both, the real stops along it (a stop stands to the right of the track in the direction of travel)
  const tmp = { x: 0, z: 0, y: 0, yaw: 0 };
  const CELL = 50;
  const cellOf = (x, z) => Math.floor(x / CELL) * 100000 + Math.floor(z / CELL);
  const addTo = (grid, item, x0, x1, z0, z1) => {
    for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
      for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
        const k = ix * 100000 + iz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(item);
      }
    }
  };
  const streetSegs = new Map();
  for (const r of ROADS) {
    if (r.raised) continue;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 1) continue;
      const seg = { ax: a.x, az: a.z, ux: (b.x - a.x) / L, uz: (b.z - a.z) / L, L, oneway: r.dir !== 0 };
      addTo(streetSegs, seg, Math.min(a.x, b.x) - 12, Math.max(a.x, b.x) + 12, Math.min(a.z, b.z) - 12, Math.max(a.z, b.z) + 12);
    }
  }
  const edgeGrid = new Map();
  for (const e of (network && network.edges) || []) {
    const ex = e.sx + e.dx * e.len, ez = e.sz + e.dz * e.len;
    addTo(edgeGrid, e, Math.min(e.sx, ex) - 10, Math.max(e.sx, ex) + 10, Math.min(e.sz, ez) - 10, Math.max(e.sz, ez) + 10);
  }
  const stopList = [];
  const S = GEO.tramStops || [];
  for (let i = 0; i < S.length; i += 3) stopList.push({ x: S[i], z: S[i + 1], name: S[i + 2] });
  const stopGrid = pointGrid(stopList, 20);
  const rightOf = (t, s, x, z) => {
    sample(t, s, tmp);
    return (x - tmp.x) * -Math.cos(tmp.yaw) + (z - tmp.z) * Math.sin(tmp.yaw);
  };
  for (const t of tracks) {
    let side = 0;
    let lanes = 0;
    for (let s = 10; s < t.len - 10; s += 20) {
      sample(t, s, tmp);
      const fx = Math.sin(tmp.yaw), fz = Math.cos(tmp.yaw);
      // the nearest street centre line running alongside
      let best = null, bestD = 12;
      for (const g of streetSegs.get(cellOf(tmp.x, tmp.z)) || []) {
        if (Math.abs(g.ux * fx + g.uz * fz) < 0.9) continue;
        const px = tmp.x - g.ax, pz = tmp.z - g.az;
        const a = px * g.ux + pz * g.uz;
        if (a < 0 || a > g.L) continue;
        const lat = px * -g.uz + pz * g.ux; // right of the street's way (x east, z south)
        if (Math.abs(lat) < bestD) {
          bestD = Math.abs(lat);
          best = { g, lat };
        }
      }
      if (best && !best.g.oneway && Math.abs(best.lat) > 0.8) side += Math.sign(best.lat) * Math.sign(best.g.ux * fx + best.g.uz * fz);
      for (const e of edgeGrid.get(cellOf(tmp.x, tmp.z)) || []) {
        const px = tmp.x - e.sx, pz = tmp.z - e.sz;
        const a = px * e.dx + pz * e.dz;
        if (a < 0 || a > e.len) continue;
        const lat = px * e.rx + pz * e.rz;
        if (e.lanes.some((o) => Math.abs(lat - o) < 1.6)) lanes += Math.sign(fx * e.dx + fz * e.dz);
      }
    }
    let vote = Math.abs(side) >= 3 ? side : lanes;
    if (!vote) for (const [st, { s }] of nearAlong(t, stopGrid, 14)) vote += rightOf(t, s, st.x, st.z) > 0 ? 1 : -1;
    if (vote < 0) {
      t.pts.reverse();
      t.cum = t.cum.map((c) => t.len - c).reverse();
    }
    // stops on its right, within 14 m: dwell positions
    for (const [st, { s }] of nearAlong(t, stopGrid, 14)) {
      if (s < 20 || s > t.len - 10) continue;
      if (rightOf(t, s, st.x, st.z) > 0 && !t.stops.some((q) => Math.abs(q - s) < 40)) t.stops.push(s);
    }
    t.stops.sort((a, b) => a - b);
  }

  // Signals along each track: the junctions of the road network with a signal the track passes through, the major road
  // phase (group 0) or the cross road's by the road the track runs along there
  if (network) {
    const sigGrid = pointGrid(network.nodes.filter((n) => n.signal), 20);
    for (const t of tracks) {
      for (const [n, { s }] of nearAlong(t, sigGrid, 9)) {
        if (s < 15) continue;
        sample(t, s, tmp);
        const fx = Math.sin(tmp.yaw);
        const fz = Math.cos(tmp.yaw);
        let major = true;
        let best = 0.8;
        for (const e of n.in || []) {
          const dot = e.dx * fx + e.dz * fz;
          if (dot > best) {
            best = dot;
            major = e.axisIndex === 0;
          }
        }
        t.signals.push({ s, major, half: Math.max(6, (n.hx || 7) + 3) });
      }
      t.signals.sort((a, b) => a.s - b.s);
    }
  }
  return tracks;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rails, track bed & overhead wire, in TILE x TILE m tiles
// ---------------------------------------------------------------------------------------------------------------------
// The rails: a flat steel strip each with the dark flangeway groove on its inner side (uv.x across the strip)
function createRailMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.32, metalness: 0.85 });
  const groove = smoothstep(0.52, 0.6, uv().x);
  mat.colorNode = mix(color(0xa6a29b), color(0x1c1b1a), groove);
  mat.metalnessNode = mix(float(0.85), float(0.1), groove);
  mat.roughnessNode = mix(float(0.3), float(0.9), groove);
  return mat;
}
// The track bed: the concrete slab the rails are cast in, a little lighter than the asphalt, its edges worn
function createTrackBedMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0.0 });
  const edge = smoothstep(0.0, 0.08, uv().x).mul(smoothstep(1.0, 0.92, uv().x));
  mat.colorNode = mix(color(0x3a3937), color(0x5a5854), edge);
  return mat;
}

function buildTrackwork(group, tracks) {
  const tiles = new Map(); // key -> { rail: [], bed: [], wire: [] }
  const tileOf = (x, z) => {
    const k = Math.floor(x / TILE) * 100000 + Math.floor(z / TILE);
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = { rail: [], railUv: [], bed: [], bedUv: [], wire: [], x: (Math.floor(x / TILE) + 0.5) * TILE, z: (Math.floor(z / TILE) + 0.5) * TILE }));
    return t;
  };
  // a flat strip from a to b, `half` wide either side, uv.x 0..1 across (flipped: uv.x 1 on the left)
  const strip = (pos, uvs, ax, ay, az, bx, by, bz, half, flip) => {
    const L = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (-(bz - az) / L) * half;
    const nz = ((bx - ax) / L) * half;
    const u0 = flip ? 1 : 0, u1 = flip ? 0 : 1;
    // (wound counter-clockwise seen from above)
    pos.push(ax - nx, ay, az - nz, bx + nx, by, bz + nz, bx - nx, by, bz - nz, ax - nx, ay, az - nz, ax + nx, ay, az + nz, bx + nx, by, bz + nz);
    uvs.push(u0, 0, u1, 1, u0, 1, u0, 0, u1, 0, u1, 1);
  };
  for (const t of tracks) {
    const P = t.pts;
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i];
      const b = P[i + 1];
      if ((a.f & 2) && (b.f & 2)) continue; // in the tunnel
      const T = tileOf((a.x + b.x) / 2, (a.z + b.z) / 2);
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const rx = -(b.z - a.z) / L;
      const rz = (b.x - a.x) / L;
      strip(T.bed, T.bedUv, a.x, a.y + 0.006, a.z, b.x, b.y + 0.006, b.z, 1.3, false);
      // grooves on the inner side of each rail
      for (const [o, flip] of [[-GAUGE / 2, true], [GAUGE / 2, false]]) {
        strip(T.rail, T.railUv, a.x + rx * o, a.y + 0.016, a.z + rz * o, b.x + rx * o, b.y + 0.016, b.z + rz * o, 0.06, flip);
      }
      if (i % 4 === 0) {
        const c = P[Math.min(P.length - 1, i + 4)];
        T.wire.push(a.x, a.y + WIRE_Y, a.z, c.x, c.y + WIRE_Y, c.z);
      }
    }
  }
  const railMat = createRailMaterial();
  const bedMat = createTrackBedMaterial();
  const wireMat = new THREE.LineBasicNodeMaterial({ color: 0x1a1a1a });
  const first = {};
  const out = [];
  const mesh = (Kind, pos, uvs, mat, name) => {
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (uvs) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const nor = new Float32Array(pos.length);
      for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    }
    g.computeBoundingSphere();
    const m = new Kind(g, mat);
    m.name = name;
    m.receiveShadow = true;
    // shader precompile: the first tile compiles the pipeline every tile shares (main.js)
    if (first[name]) m.userData.sharesPipelineWith = first[name];
    else first[name] = m;
    group.add(m);
    return m;
  };
  for (const T of tiles.values()) {
    const meshes = [
      mesh(THREE.Mesh, T.bed, T.bedUv, bedMat, 'StreetcarTrackBed'),
      mesh(THREE.Mesh, T.rail, T.railUv, railMat, 'StreetcarRails'),
      mesh(THREE.LineSegments, T.wire, null, wireMat, 'StreetcarWire')
    ].filter(Boolean);
    out.push({ x: T.x, z: T.z, meshes });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The Flexity Outlook: five modules (the end ones with the raked cab), TTC red with the black window band
// ---------------------------------------------------------------------------------------------------------------------
// uv: x = local z from the module's door centre (far off: no door), y = height
function moduleGeometry(len, nose, door) {
  const g = new THREE.BoxGeometry(HALF_W * 2, HEIGHT - 0.32, len, 1, 4, 4).translate(0, 0.32 + (HEIGHT - 0.32) / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    const y = p.getY(i);
    let z = p.getZ(i);
    // rounded roof edges
    if (y > HEIGHT - 0.05) x *= 0.86;
    if (nose && z > len / 2 - 0.01) {
      // the cab: a raked windscreen and a rounded nose in plan
      const k = Math.max(0, (y - 1.0) / (HEIGHT - 1.0));
      z -= k * k * 1.05;
      x *= 1 - 0.12 * Math.min(1, Math.max(0, (y - 0.3) / 3.5));
    }
    p.setXYZ(i, x, y, z);
  }
  const u = g.attributes.uv;
  for (let i = 0; i < p.count; i++) u.setXY(i, door === null ? 50 : p.getZ(i) - door, p.getY(i));
  g.computeVertexNormals();
  return g;
}
// `lamp`: the cab end's lamps, white headlamps (the leading cab) or red tail lamps (the trailing one, turned round)
function createStreetcarMaterial(lamp = 0xfff1d6) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.38, metalness: 0.25 });
  const y = positionGeometry.y;
  const dz = abs(uv().x);
  const side = step(0.6, abs(normalGeometry.x));
  const roof = step(0.6, normalGeometry.y);
  const front = step(0.55, normalGeometry.z); // the cab's end (the gangways hide the inner modules' ends)
  const band = smoothstep(1.02, 1.06, y).mul(float(1.0).sub(smoothstep(2.6, 2.64, y)));
  const whiteLine = smoothstep(0.92, 0.94, y).mul(float(1.0).sub(smoothstep(0.98, 1.0, y)));
  const skirt = float(1.0).sub(smoothstep(0.42, 0.46, y));
  // the double door: dark seams round the leaves & between them, glazed down to the waist
  const doorZone = step(dz, 0.72).mul(step(0.36, y)).mul(float(1.0).sub(step(2.62, y))).mul(side);
  const seams = doorZone.mul(float(1.0).sub(smoothstep(0.02, 0.035, dz)).add(smoothstep(0.66, 0.68, dz))).min(1.0);
  const doorGlass = doorZone.mul(smoothstep(1.0, 1.04, y));
  // the cab end: the black windscreen, the destination sign over it, the lamps low at both corners
  const lx = abs(positionGeometry.x);
  const screen = front.mul(smoothstep(1.22, 1.28, y)).mul(float(1.0).sub(smoothstep(3.0, 3.04, y))).mul(float(1.0).sub(smoothstep(0.98, 1.03, lx)));
  const sign = front.mul(smoothstep(3.1, 3.13, y)).mul(float(1.0).sub(smoothstep(3.47, 3.5, y))).mul(step(lx, 0.8));
  const col = Fn(() => {
    let c = mix(color(0xc81f27), color(0x101215), band);
    c = mix(c, color(0xf2f2ee), whiteLine.mul(float(1.0).sub(doorZone)));
    c = mix(c, color(0x0f1012), doorGlass);
    c = mix(c, color(0x2a0b0d), seams);
    c = mix(c, color(0x1d1e20), skirt);
    c = mix(c, color(0xc9cbcc), roof);
    c = mix(c, color(0x0d0f12), screen.max(sign).mul(float(1.0).sub(roof)));
    return c;
  })();
  mat.colorNode = col;
  const glassy = band.max(doorGlass).max(screen);
  mat.roughnessNode = mix(float(0.38), float(0.08), glassy);
  mat.metalnessNode = mix(float(0.25), float(0.7), glassy);
  // lit saloon after dusk, the cab end's lamps (always on, brighter at night)
  const night = smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow); // (as the vehicles' lamps, actor-models.js)
  const lampMask = smoothstep(0.6, 0.63, y).mul(float(1.0).sub(smoothstep(0.76, 0.79, y))).mul(front).mul(smoothstep(0.8, 0.84, lx)).mul(float(1.0).sub(smoothstep(1.06, 1.1, lx)));
  // the sign: an amber LED line of route & destination
  const led = sign.mul(smoothstep(3.22, 3.25, y)).mul(float(1.0).sub(smoothstep(3.36, 3.39, y))).mul(step(lx, 0.62));
  mat.emissiveNode = color(0xffe2b0).mul(band.max(doorGlass).mul(float(1.0).sub(front)).mul(0.55).mul(night))
    .add(color(lamp).mul(lampMask).mul(night.mul(2.2).add(0.25)))
    .add(color(0xffa020).mul(led).mul(night.mul(1.2).add(0.6)));
  return mat;
}

function createStreetcars(scene, trafficSystem) {
  const group = new THREE.Group();
  group.name = 'Streetcars';
  const network = trafficSystem && trafficSystem.network;
  const tracks = buildTracks(network);
  const trackGroup = new THREE.Group();
  trackGroup.name = 'StreetcarTracks';
  const trackTiles = buildTrackwork(trackGroup, tracks);
  group.add(trackGroup);
  markStreetcarStreets(network, tracks);

  // The fleet: one car per `streetcarSpacing` m of track (quality.js), spread out along it
  const spacing = QUALITY.streetcarSpacing || 500;
  const cars = [];
  for (const t of tracks) {
    const n = Math.max(1, Math.round(t.len / spacing));
    for (let k = 0; k < n; k++) {
      cars.push({ track: t, s: ((k + 0.5) / n) * t.len, speed: MAX_SPEED * 0.6, dwell: 0, lastStop: -1, sections: SECTIONS.map(() => ({ x: 0, y: 0, z: 0, yaw: 0 })) });
    }
  }

  const bodyMat = createStreetcarMaterial(0xfff1d6);
  const tailMat = createStreetcarMaterial(0xff2a1c);
  const noseGeo = moduleGeometry(SECTIONS[0], true, DOORS[0]);
  const midGeos = SECTIONS.map((l, k) => moduleGeometry(l, false, DOORS[k]));
  const gangwayGeo = new THREE.BoxGeometry(HALF_W * 1.9, HEIGHT - 0.6, GANGWAY + 0.2).translate(0, 0.4 + (HEIGHT - 0.6) / 2, 0);
  // the pantograph & its roof pod on the middle module
  const pantoGeo = mergeGeometries([
    new THREE.BoxGeometry(1.4, 0.25, 1.6).translate(0, 0.12, 0),
    new THREE.BoxGeometry(0.06, 1.3, 0.06).rotateX(0.5).translate(0, 0.85, 0.3),
    new THREE.BoxGeometry(1.5, 0.05, 0.08).translate(0, 1.5, 0.62)
  ].map((g) => g.toNonIndexed()));
  const count = Math.max(1, cars.length);
  const head = new THREE.InstancedMesh(noseGeo, bodyMat, count);
  const tail = new THREE.InstancedMesh(noseGeo, tailMat, count);
  const mids = midGeos.slice(1, 4).map((g) => new THREE.InstancedMesh(g, bodyMat, count));
  const gangways = new THREE.InstancedMesh(gangwayGeo, new THREE.MeshStandardNodeMaterial({ color: 0x1b1c1e, roughness: 0.9 }), count * 4);
  const pantos = new THREE.InstancedMesh(pantoGeo, new THREE.MeshStandardNodeMaterial({ color: 0x2a2b2d, roughness: 0.5, metalness: 0.6 }), count);
  const bodies = [head, tail, ...mids, gangways, pantos];
  for (const m of bodies) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    group.add(m);
  }
  scene.add(group);

  // Obstacles handed to traffic.js: one box per module of every car near the camera
  const obstacles = [];
  const dummy = new THREE.Object3D();
  const tmp = { x: 0, z: 0, y: 0, yaw: 0 };

  function phaseAhead(car, elapsed) {
    for (const sg of car.track.signals) {
      const d = sg.s - sg.half - car.s;
      if (d < -1 || d > 60) continue;
      const ph = signalPhase(elapsed, sg.major);
      if (ph === 'red' || (ph === 'amber' && d > 12)) return d;
    }
    return Infinity;
  }
  // Distance to the nearest thing standing in the way within `reach` m ahead of the nose: traffic, the player
  function blockedAhead(car, reach, others, playerEnt) {
    const t = car.track;
    sample(t, car.s, tmp);
    let best = Infinity;
    const fx = Math.sin(tmp.yaw);
    const fz = Math.cos(tmp.yaw);
    const y = tmp.y;
    const test = (x, z, half, halfW) => {
      const dx = x - tmp.x;
      const dz = z - tmp.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < -1 || ahead > reach + half) return;
      const side = Math.abs(dz * fx - dx * fz);
      if (side > HALF_W + halfW + 0.35) return;
      best = Math.min(best, ahead - half);
    };
    for (const v of others) if (v.edge && Math.abs((v.y || 0) - y) < 2.5) test(v.x, v.z, v.half || 2.3, v.halfWidth || 0.9);
    for (const o of cars) {
      if (o === car || o.track !== t) continue;
      const d = o.s - CAR_LEN - car.s;
      if (d > -1 && d < reach) best = Math.min(best, d);
    }
    if (playerEnt && Math.abs(playerEnt.position.y - y) < 2.6) test(playerEnt.position.x, playerEnt.position.z, 2.3, 1.0);
    return best;
  }

  const cull = QUALITY.cull || 1;
  function update(dt, elapsed, camera, playerEnt, activeMode) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    const others = trafficSystem ? [...(trafficSystem.cars || []), ...(trafficSystem.buses || [])] : [];
    const ground = playerEnt && activeMode !== 'helicopter' ? playerEnt : null;
    const camX = camera ? camera.position.x : 0;
    const camZ = camera ? camera.position.z : 0;
    const drawR = DRAW_RADIUS * cull;
    obstacles.length = 0;
    let n = 0;
    for (const car of cars) {
      const t = car.track;
      // where the car must stop: a stop to dwell at, a red light, whatever stands ahead
      let target = MAX_SPEED;
      let stopD = Infinity;
      sample(t, car.s, tmp);
      const near = Math.abs(tmp.x - camX) < NEAR + 50 && Math.abs(tmp.z - camZ) < NEAR + 50;
      if (car.dwell > 0) {
        car.dwell -= dt;
        target = 0;
      } else {
        const next = t.stops.find((q) => q > car.s - 0.5 && q !== car.lastStop);
        if (next !== undefined) {
          const d = next - car.s;
          if (d < 0.6 && car.speed < 1.0) {
            car.dwell = DWELL * (0.7 + Math.random() * 0.6);
            car.lastStop = next;
            car.speed = 0;
          } else stopD = Math.min(stopD, d);
        }
        stopD = Math.min(stopD, phaseAhead(car, elapsed));
        if (near) stopD = Math.min(stopD, blockedAhead(car, 75, others, ground) - 4);
      }
      if (stopD < Infinity) target = Math.min(target, Math.sqrt(Math.max(0, 2 * DECEL * Math.max(0, stopD))));
      if (car.speed < target) car.speed = Math.min(target, car.speed + ACCEL * dt);
      else car.speed = Math.max(target, car.speed - (stopD < 3 ? DECEL * 3 : DECEL * 1.6) * dt);
      car.s += car.speed * dt;
      if (car.s > t.len) {
        // off the end of the run: back in at its start
        car.s = CAR_LEN;
        car.lastStop = -1;
      }
      // the modules follow the track behind the nose
      let back = car.s;
      for (let k = 0; k < SECTIONS.length; k++) {
        const sec = car.sections[k];
        sample(t, back, tmp);
        const ax = tmp.x, ay = tmp.y, az = tmp.z;
        sample(t, Math.max(0, back - SECTIONS[k]), tmp);
        sec.x = (ax + tmp.x) / 2;
        sec.y = (ay + tmp.y) / 2;
        sec.z = (az + tmp.z) / 2;
        sec.yaw = Math.atan2(ax - tmp.x, az - tmp.z);
        sec.pitch = Math.atan2(ay - tmp.y, SECTIONS[k]);
        back -= SECTIONS[k] + GANGWAY;
      }
      const mid = car.sections[2];
      const dCam = Math.hypot(mid.x - camX, mid.z - camZ);
      // obstacles for the traffic & contact with the player
      if (dCam < NEAR) {
        for (let k = 0; k < SECTIONS.length; k++) {
          const sec = car.sections[k];
          obstacles.push({ x: sec.x, y: sec.y, z: sec.z, yaw: sec.yaw, halfW: HALF_W, halfL: SECTIONS[k] / 2 + GANGWAY / 2, speed: car.speed });
        }
        if (ground) pushPlayer(car, ground, activeMode);
      }
      // draw: the cab modules (the tail one turned round), the inner ones, the gangways, the pantograph mid-roof;
      // only near the camera, and not deep in a tunnel
      if (dCam > drawR || mid.y < -HEIGHT - 0.5) continue;
      car.sections.forEach((sec, k) => {
        dummy.position.set(sec.x, sec.y, sec.z);
        dummy.rotation.set(0, sec.yaw + (k === SECTIONS.length - 1 ? Math.PI : 0), 0, 'YXZ');
        dummy.rotateX(k === SECTIONS.length - 1 ? sec.pitch : -sec.pitch);
        dummy.updateMatrix();
        if (k === 0) head.setMatrixAt(n, dummy.matrix);
        else if (k === SECTIONS.length - 1) tail.setMatrixAt(n, dummy.matrix);
        else mids[k - 1].setMatrixAt(n, dummy.matrix);
        if (k === 2) {
          dummy.position.y = sec.y + HEIGHT;
          dummy.updateMatrix();
          pantos.setMatrixAt(n, dummy.matrix);
        }
        if (k < SECTIONS.length - 1) {
          const nx = car.sections[k + 1];
          dummy.position.set((sec.x + nx.x) / 2, (sec.y + nx.y) / 2, (sec.z + nx.z) / 2);
          dummy.rotation.set(0, (sec.yaw + nx.yaw) / 2, 0);
          dummy.updateMatrix();
          gangways.setMatrixAt(n * 4 + k, dummy.matrix);
        }
      });
      n++;
    }
    for (const m of [head, tail, ...mids, pantos]) m.count = n;
    gangways.count = n * 4;
    for (const m of bodies) {
      if (!m.count) continue;
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, m.count * 16);
      m.instanceMatrix.needsUpdate = true;
    }
    if (trafficSystem && trafficSystem.setObstacles) trafficSystem.setObstacles(obstacles);
    // the trackwork within reach
    const trackR = TRACK_DRAW * cull + TILE * 0.7;
    for (const T of trackTiles) {
      const vis = Math.hypot(T.x - camX, T.z - camZ) < trackR;
      for (const m of T.meshes) m.visible = vis;
    }
  }

  // A streetcar shoves the player (on foot, by bike or car) out of its modules along the shallower side
  function pushPlayer(car, ground, activeMode) {
    const r = activeMode === 'car' ? 1.6 : activeMode === 'cyclist' ? 0.8 : 0.45;
    for (let k = 0; k < SECTIONS.length; k++) {
      const sec = car.sections[k];
      if (Math.abs(ground.position.y - sec.y) > 2.6) continue;
      const dx = ground.position.x - sec.x;
      const dz = ground.position.z - sec.z;
      const c = Math.cos(sec.yaw), sn = Math.sin(sec.yaw);
      const lx = dx * c - dz * sn; // across
      const lz = dx * sn + dz * c; // along
      const px = HALF_W + r - Math.abs(lx);
      const pz = SECTIONS[k] / 2 + r - Math.abs(lz);
      if (px <= 0 || pz <= 0) continue;
      if (px < pz) {
        const s = Math.sign(lx) || 1;
        ground.position.x += c * px * s;
        ground.position.z -= sn * px * s;
      } else {
        const s = Math.sign(lz) || 1;
        ground.position.x += sn * pz * s;
        ground.position.z += c * pz * s;
      }
      if (ground.speed) ground.speed *= 0.3;
    }
  }

  const km = Math.round(tracks.reduce((t, k) => t + k.len, 0) / 100) / 10;
  console.info(`[streetcars] ${tracks.length} track runs, ${km} km, ${cars.length} streetcars, ${tracks.reduce((t, k) => t + k.stops.length, 0)} stops, ${tracks.reduce((t, k) => t + k.signals.length, 0)} signals, ${trackTiles.length} track tiles`);
  return { group, update, cars, tracks, sample };
}

Object.assign(window.CITY, { createStreetcars });
})();
