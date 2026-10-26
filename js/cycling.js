(function () {
// js/cycling.js
// Toronto's cycling network on the street (GEO.cycling: the City of Toronto's "Cycling Network", the side of the street
// each bikeway is on from OpenStreetMap; tools/geo-cycling.mjs). Each on-street bikeway is a curb line in the direction
// bikes ride it; from it, measured into the road:
// - bike lanes: a solid white line 1.6 m out, the bicycle & diamond after each junction and every ~75 m, the line
//   dashed over green paint on the approach to a junction where turning traffic crosses it; buffered lanes add a second
//   line and a hatched buffer; contra-flow lanes a yellow line (they run against the traffic) & arrows
// - cycle tracks (Bloor, Richmond & Adelaide, Sherbourne, University...): a low concrete curb with white flexi-posts
//   between the track and the traffic, the bicycle & arrow; bi-directional ones (Queens Quay W, Richmond's west end)
//   wider, with a dashed yellow centre line
// - through the junctions: green crossrides with elephant's feet (dashed white edges); sharrows: the bicycle & chevrons
// - the multi-use trails over the parks & promenades: their asphalt (the Martin Goodman Trail's red, with its dashed
//   yellow centre line), elephant's feet where they cross a road
// The paint goes into road-paint.js's one mesh (bikePaint), the separator curbs into city-grid.js's kerb batch
// (bikeSeparatorGeometries) and the posts are one instanced mesh scene-culling.js chunks. road-network.js keeps every
// traffic lane clear of the bikeways (bikeLaneShift), so the paint and the traffic agree and no car drives in them.

const { THREE, GEO, CITY_BOUNDS, blockAt } = window.CITY;
const DATA = GEO.cycling || { kinds: [], bands: [], trails: [], map: [] };
const K = Object.fromEntries(DATA.kinds.map((k, i) => [k, i]));
const SW_TOP = CITY_BOUNDS.sidewalkHeight;

// From the curb into the road (m): the bikeway's own width, and the reserve traffic keeps clear of
const LINE_AT = 1.6; // a bike lane's line (its centre)
const TRACK_W = 1.85; // a cycle track, to its separator
const TRACK2_W = 3.0; // a bi-directional track
const SEP_W = 0.45; // the separator curb
const RESERVE = {
  [K.lane]: LINE_AT + 0.15,
  [K.buffered]: 2.6,
  [K.contraflow]: LINE_AT + 0.15,
  [K.track]: TRACK_W + SEP_W + 0.1,
  [K.track2]: TRACK2_W + SEP_W + 0.1
};
const CAR_CLEAR = 1.5; // a lane's centre keeps this far from a bikeway's edge: a bus's half width & a little

const cutY = (x, z) => (window.CITY.cutAt ? Math.min(0, window.CITY.cutAt(x, z)) : 0);

// A polyline [x, z, ...] as points with their tangent, the normal into the road (n), the mitre factor at the joints
// (m), the distance along (s) and the street level (y)
function prepare(flat, nRight, y = null) {
  const P = [];
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i], z = flat[i + 1];
    if (P.length && Math.hypot(x - P[P.length - 1].x, z - P[P.length - 1].z) < 0.05) continue;
    P.push({ x, z, y: y === null ? cutY(x, z) : y });
  }
  // (a sharp kink on a short piece, where a line ends at a slant, would fan a wide band out: straightened)
  for (let i = 1; i + 1 < P.length; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const ux = b.x - a.x, uz = b.z - a.z, vx = c.x - b.x, vz = c.z - b.z;
    const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
    if ((ux * vx + uz * vz) / (lu * lv) < 0.6 && Math.min(lu, lv) < 3) { P.splice(i, 1); i = Math.max(0, i - 2); }
  }
  if (P.length < 2) return null;
  const seg = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const dx = P[i + 1].x - P[i].x, dz = P[i + 1].z - P[i].z, L = Math.hypot(dx, dz);
    seg.push({ tx: dx / L, tz: dz / L, L });
  }
  let s = 0;
  for (let i = 0; i < P.length; i++) {
    const a = seg[Math.max(0, i - 1)], b = seg[Math.min(seg.length - 1, i)];
    let tx = a.tx + b.tx, tz = a.tz + b.tz;
    const L = Math.hypot(tx, tz) || 1;
    tx /= L; tz /= L;
    const p = P[i];
    p.tx = tx; p.tz = tz;
    // the right normal (-tz, tx), or the left
    p.nx = nRight ? -tz : tz;
    p.nz = nRight ? tx : -tx;
    p.m = 1 / Math.max(0.5, tx * b.tx + tz * b.tz); // (the joint's mitre: offsets keep their distance from both pieces)
    p.s = s;
    if (i < seg.length) s += seg[i].L;
  }
  P.len = s;
  P.nRight = nRight;
  return P;
}
// The piece of P between distances s0 & s1
function slice(P, s0, s1) {
  s0 = Math.max(0, s0);
  s1 = Math.min(P.len, s1);
  if (s1 - s0 < 0.05) return null;
  const out = [at(P, s0)];
  for (const p of P) if (p.s > s0 && p.s < s1) out.push(p);
  out.push(at(P, s1));
  out.len = P.len;
  out.nRight = P.nRight;
  return out;
}
// The point at distance s along P (interpolated)
function at(P, s) {
  let i = 0;
  while (i + 2 < P.length && P[i + 1].s < s) i++;
  const a = P[i], b = P[i + 1];
  const t = Math.max(0, Math.min(1, (s - a.s) / ((b.s - a.s) || 1)));
  const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1;
  return {
    x: a.x + tx * t, z: a.z + tz * t, y: a.y + (b.y - a.y) * t, s,
    tx: tx / L, tz: tz / L, nx: P.nRight ? -tz / L : tz / L, nz: P.nRight ? tx / L : -tx / L, m: 1
  };
}

// The on-street bikeways, with whether each end meets a junction (a crossing piece starts or ends there)
const crossEnds = new Set();
for (const [, flags, flat] of DATA.bands) {
  if (!(flags & 2)) continue;
  crossEnds.add(`${flat[0]},${flat[1]}`);
  crossEnds.add(`${flat[flat.length - 2]},${flat[flat.length - 1]}`);
}
const BANDS = [];
for (const [kind, flags, flat] of DATA.bands) {
  // the curb on the riders' left: the road on their right
  const P = prepare(flat, !!(flags & 1));
  if (!P) continue;
  BANDS.push({
    kind, P, cross: !!(flags & 2), contra: !!(flags & 4),
    startJ: crossEnds.has(`${flat[0]},${flat[1]}`), endJ: crossEnds.has(`${flat[flat.length - 2]},${flat[flat.length - 1]}`)
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Paint (road-paint.js's mesh): `api` = { strip, ribbon, WHITE, YELLOW } (see road-paint.js)
// ---------------------------------------------------------------------------------------------------------------------
const GREEN = new THREE.Color(0x2e9a52); // Toronto's conflict-zone green
const TRAIL_RED = new THREE.Color(0x70281f); // the Martin Goodman Trail's red-brown asphalt
const TRAIL_GREY = new THREE.Color(0x353534); // the other trails' asphalt

// Pavement symbols in their own frame: x to the riders' right, y ahead (m before stretching along the lane), as
// polylines; a circle is a closed polygon
const circle = (cx, cy, r, n = 8) => Array.from({ length: n + 1 }, (_, k) => [cx + Math.cos((k / n) * Math.PI * 2) * r, cy + Math.sin((k / n) * Math.PI * 2) * r]);
const BICYCLE = [
  circle(-0.3, 0.2, 0.19), circle(0.3, 0.2, 0.19),
  [[-0.3, 0.2], [-0.02, 0.2], [0.19, 0.46], [-0.1, 0.46], [-0.3, 0.2]], // chain stay, down tube, top tube, seat stay
  [[-0.02, 0.2], [-0.12, 0.52]], // seat tube & post
  [[-0.2, 0.53], [-0.05, 0.53]], // saddle
  [[0.3, 0.2], [0.2, 0.5], [0.16, 0.56], [0.26, 0.57]] // fork, stem & bars
];
const DIAMOND = [[[0, 0], [0.28, 0.5], [0, 1], [-0.28, 0.5], [0, 0]]];
const ARROW = [[[0, 0], [0, 0.75]], [[-0.2, 0.52], [0, 0.82], [0.2, 0.52]]];
const CHEVRONS = [[[-0.32, 0], [0, 0.22], [0.32, 0]], [[-0.32, 0.3], [0, 0.52], [0.32, 0.3]]];

// The pavement symbols are many small strips: they go into meshes of their own, one per kilometre cell (the view frustum
// skips the far ones), in road-paint.js's material (`material`), the lines & surfaces into its one mesh (strip, ribbon)
function bikePaint({ strip, ribbon, WHITE, YELLOW, material, scene, height }) {
  const cells = new Map();
  const symbolStrip = (ax, ay, az, bx, by, bz, w, col) => {
    const k = Math.floor(ax / 1000) * 1000 + Math.floor(az / 1000);
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { position: [], side: [], paint: [], colors: [], index: [] }));
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.02) return;
    const sx = ((az - bz) / len) * w * 0.5, sz = ((bx - ax) / len) * w * 0.5;
    const i = c.position.length / 3;
    for (const [x, y, z, sg, u] of [[ax, ay, az, -1, 0], [ax, ay, az, 1, 0], [bx, by, bz, 1, len], [bx, by, bz, -1, len]]) {
      c.position.push(x + sx * sg, y + height, z + sz * sg);
      c.side.push(sx * sg, sz * sg);
      c.paint.push(u, 1, 1);
      c.colors.push(col.r, col.g, col.b);
    }
    c.index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  // a symbol at distance s along P, centred v from the curb, stretched sy along the lane (flip: facing back)
  const symbol = (P, s, v, lines, w, sy, flip = false) => {
    const q = at(P, s);
    const f = flip ? -1 : 1;
    const tx = q.tx * f, tz = q.tz * f, rx = -tz, rz = tx; // ahead & the riders' right
    const ox = q.x + q.nx * v, oz = q.z + q.nz * v;
    const W = (ix, iy) => [ox + rx * ix + tx * iy * sy, q.y, oz + rz * ix + tz * iy * sy];
    for (const line of lines) {
      for (let k = 0; k + 1 < line.length; k++) symbolStrip(...W(...line[k]), ...W(...line[k + 1]), w, WHITE);
    }
  };
  let symbols = 0;
  for (const b of BANDS) {
    const { P, kind } = b;
    const len = P.len;
    if (b.cross) {
      // through the junction: a green crossride with elephant's feet (cycle tracks), green skips & dashed edges (lanes)
      if (kind === K.sharrow) continue;
      const W = kind === K.track ? TRACK_W : kind === K.track2 ? TRACK2_W : LINE_AT + 0.08;
      if (kind === K.track || kind === K.track2) ribbon(P, 0.05, W, GREEN);
      else ribbon(P, 0.15, W - 0.1, GREEN, 2.4, 0.6);
      ribbon(P, 0, 0.42, WHITE, 0.9, 0.5);
      ribbon(P, W - 0.42, W, WHITE, 0.9, 0.5);
      continue;
    }
    if (kind === K.sharrow) {
      for (let s = 12; s < len - 8; s += 80) {
        symbol(P, s, 1.9, BICYCLE, 0.07, 1.9);
        symbol(P, s + 1.6, 1.9, CHEVRONS, 0.1, 1.6);
        symbols++;
      }
      continue;
    }
    // into a junction: the last stretch where turning traffic crosses (green), out of one: a little green
    const lane = kind === K.lane || kind === K.buffered || kind === K.contraflow;
    const tail = b.endJ ? Math.min(lane ? 12 : 4, len * 0.3) : 0;
    const head = b.startJ ? Math.min(lane ? 0 : 2.5, len * 0.2) : 0;
    if (lane) {
      const col = kind === K.contraflow ? YELLOW : WHITE;
      const solid = slice(P, head, len - tail);
      if (solid) ribbon(solid, LINE_AT - 0.075, LINE_AT + 0.075, col);
      if (kind === K.buffered && solid) {
        ribbon(solid, 2.425, 2.575, WHITE);
        for (let s = head + 2; s < len - tail - 1.5; s += 4) {
          const a = at(P, s), c = at(P, s + 1.4);
          strip(a.x + a.nx * LINE_AT, a.y, a.z + a.nz * LINE_AT, c.x + c.nx * 2.5, c.y, c.z + c.nz * 2.5, 0.14, WHITE);
        }
      }
      const end = tail ? slice(P, len - tail, len) : null;
      if (end) {
        ribbon(end, LINE_AT - 0.075, LINE_AT + 0.075, col, 1.2, 0.5);
        ribbon(end, 0.25, LINE_AT - 0.15, GREEN);
      }
    } else {
      // cycle tracks: green at the corners; a bi-directional one's dashed yellow centre line
      if (tail) ribbon(slice(P, len - tail, len), 0.05, kind === K.track2 ? TRACK2_W : TRACK_W, GREEN);
      if (head) ribbon(slice(P, 0, head), 0.05, kind === K.track2 ? TRACK2_W : TRACK_W, GREEN);
      if (kind === K.track2) {
        const mid = slice(P, head, len - tail);
        if (mid) ribbon(mid, TRACK2_W / 2 - 0.06, TRACK2_W / 2 + 0.06, YELLOW, 6, 0.5);
      }
    }
    // the bicycle after each junction and every ~110 m, with a diamond (lanes) or an arrow (tracks, contra-flow lanes)
    const step = 110;
    for (let s = head + 7; s < len - tail - 5; s += step) {
      if (kind === K.track2) {
        symbol(P, s, TRACK2_W * 0.27, BICYCLE, 0.07, 1.8);
        symbol(P, s + 2.6, TRACK2_W * 0.27, ARROW, 0.1, 1.6);
        symbol(P, s + 4.2, TRACK2_W * 0.73, BICYCLE, 0.07, 1.8, true);
        symbol(P, s + 1.6, TRACK2_W * 0.73, ARROW, 0.1, 1.6, true);
      } else {
        const v = kind === K.track ? TRACK_W / 2 : LINE_AT / 2;
        symbol(P, s, v, BICYCLE, 0.07, 1.8);
        symbol(P, s + 2.6, v, kind === K.lane || kind === K.buffered ? DIAMOND : ARROW, 0.1, 1.6);
      }
      symbols++;
    }
  }
  // Multi-use trails: their asphalt over the parks & promenades (solid, a little above the paving), and their crossings
  let trailKm = 0;
  for (const [w, surface, level, flat] of DATA.trails) {
    const P = prepare(flat, true, level ? SW_TOP : null);
    if (!P) continue;
    if (level) {
      // kept to the curb island it runs over (where it runs along a curb, or meets one at a slant)
      const onIsland = (p, o) => {
        for (let k = 0; Math.abs(o) > 0.3 && k < 12; k++, o -= Math.sign(o) * 0.25) {
          if (blockAt(p.x + p.nx * o * p.m, p.z + p.nz * o * p.m)) return o;
        }
        return Math.sign(o) * 0.3;
      };
      ribbon(P, P.map((p) => onIsland(p, -w / 2)), P.map((p) => onIsland(p, w / 2)), surface ? TRAIL_RED : TRAIL_GREY, 1, 2);
      if (surface) ribbon(P, -0.06, 0.06, YELLOW, 5, 0.5);
      trailKm += P.len / 1000;
    } else {
      ribbon(P, -w / 2, -w / 2 + 0.42, WHITE, 0.9, 0.5);
      ribbon(P, w / 2 - 0.42, w / 2, WHITE, 0.9, 0.5);
    }
  }
  let verts = 0;
  for (const c of cells.values()) {
    const g = new THREE.BufferGeometry();
    const normal = new Float32Array(c.position.length);
    for (let i = 1; i < normal.length; i += 3) normal[i] = 1;
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c.colors, 3));
    g.setAttribute('side', new THREE.Float32BufferAttribute(c.side, 2));
    g.setAttribute('paint', new THREE.Float32BufferAttribute(c.paint, 3));
    g.setIndex(c.index);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'BikeSymbols';
    mesh.receiveShadow = true;
    mesh.renderOrder = -1;
    scene.add(mesh);
    verts += c.position.length / 3;
  }
  console.info(`[cycling] ${BANDS.length} bikeway pieces painted, ${symbols} symbols (${verts} vertices in ${cells.size} cells), ${trailKm.toFixed(1)} km of trail surface`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Separators (city-grid.js's kerb batch) & flexi-posts
// ---------------------------------------------------------------------------------------------------------------------
const SEP_H = 0.13; // the separator curb's height
const POST_EVERY = 6;
const separatorRuns = () => {
  const runs = [];
  for (const b of BANDS) {
    if (b.cross || (b.kind !== K.track && b.kind !== K.track2)) continue;
    // (clear of the junctions: turning traffic & bikes mix there)
    const run = slice(b.P, b.startJ ? 4 : 1, b.P.len - (b.endJ ? 8 : 1));
    if (run && run[run.length - 1].s - run[0].s > 3) runs.push({ P: run, a: (b.kind === K.track2 ? TRACK2_W : TRACK_W), b: (b.kind === K.track2 ? TRACK2_W : TRACK_W) + SEP_W });
  }
  return runs;
};
// The separator curbs as kerb geometry (position, normal & uv, like the curb islands'), one geometry per 500 m cell so
// the view frustum skips the far ones
function bikeSeparatorGeometries() {
  const cells = new Map();
  let pos, nor, uv;
  // a quad facing n (wound counter-clockwise seen from that side)
  const quad = (p0, p1, p2, p3, n) => {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const facing = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    const order = facing >= 0 ? [p0, p1, p2, p0, p2, p3] : [p0, p2, p1, p0, p3, p2];
    for (const p of order) { pos.push(...p); nor.push(...n); uv.push(p[0], p[2]); }
  };
  for (const { P, a, b } of separatorRuns()) {
    const mid = P[P.length >> 1], key = Math.floor(mid.x / 500) * 1000 + Math.floor(mid.z / 500);
    if (!cells.has(key)) cells.set(key, { pos: [], nor: [], uv: [] });
    ({ pos, nor, uv } = cells.get(key));
    const off = (p, o, h) => [p.x + p.nx * o * p.m, p.y + h, p.z + p.nz * o * p.m];
    for (let i = 0; i + 1 < P.length; i++) {
      const p = P[i], q = P[i + 1];
      const nx = (p.nx + q.nx) / 2, nz = (p.nz + q.nz) / 2;
      quad(off(p, a, SEP_H), off(p, b, SEP_H), off(q, b, SEP_H), off(q, a, SEP_H), [0, 1, 0]);
      quad(off(p, b, 0), off(q, b, 0), off(q, b, SEP_H), off(p, b, SEP_H), [nx, 0, nz]);
      quad(off(p, a, 0), off(q, a, 0), off(q, a, SEP_H), off(p, a, SEP_H), [-nx, 0, -nz]);
    }
    for (const [p, dir] of [[P[0], -1], [P[P.length - 1], 1]]) {
      quad(off(p, a, 0), off(p, b, 0), off(p, b, SEP_H), off(p, a, SEP_H), [p.tx * dir, 0, p.tz * dir]);
    }
  }
  return [...cells.values()].map((c) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(c.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(c.uv, 2));
    g.computeBoundingSphere();
    return g;
  });
}
// White flexi-posts on the separators, one instanced mesh (scene-culling.js chunks it and hides it with distance)
function buildBikePosts(scene) {
  const spots = [];
  for (const { P, a, b } of separatorRuns()) {
    const len = P[P.length - 1].s - P[0].s;
    const n = Math.max(1, Math.floor(len / POST_EVERY));
    for (let k = 0; k <= n; k++) {
      const p = at(P, P[0].s + (len * k) / n);
      spots.push(p.x + p.nx * (a + b) / 2, p.y + SEP_H, p.z + p.nz * (a + b) / 2);
    }
  }
  if (!spots.length) return null;
  const geo = new THREE.CylinderGeometry(0.05, 0.06, 0.8, 7, 1);
  geo.translate(0, 0.4, 0);
  // white, with the grey reflective band near the top
  const { positionLocal, mix, step, color } = window.CITY.TSL || {};
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0xeeeeea, roughness: 0.55 });
  if (positionLocal) mat.colorNode = mix(color(0xeeeeea), color(0x8d9394), step(0.6, positionLocal.y).mul(step(positionLocal.y, 0.7)));
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length / 3);
  const m = new THREE.Matrix4();
  for (let i = 0; i < spots.length; i += 3) mesh.setMatrixAt(i / 3, m.makeTranslation(spots[i], spots[i + 1], spots[i + 2]));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = 'BikePosts';
  mesh.castShadow = false; // (a thin post's shadow barely reads: street-props.js's bike rings cast none either)
  mesh.receiveShadow = true;
  mesh.userData.cullDistance = 110;
  mesh.userData.cullCell = 60;
  mesh.computeBoundingSphere();
  scene.add(mesh);
  console.info(`[cycling] ${spots.length / 3} flexi-posts on the cycle tracks' separators`);
  return mesh;
}

// ---------------------------------------------------------------------------------------------------------------------
// Traffic lanes (road-network.js): each lane's centre keeps CAR_CLEAR from the edge of any bikeway along its road
// ---------------------------------------------------------------------------------------------------------------------
const GRID = 24;
const reserveGrid = new Map(); // 24 m cells -> [ax, az, bx, bz, nx, nz (into the road), reserve]
for (const b of BANDS) {
  const res = RESERVE[b.kind];
  if (!res) continue; // (sharrows share the lane)
  const P = b.P;
  for (let i = 0; i + 1 < P.length; i++) {
    const p = P[i], q = P[i + 1];
    const sg = [p.x, p.z, q.x, q.z, (p.nx + q.nx) / 2, (p.nz + q.nz) / 2, res];
    for (let ix = Math.floor(Math.min(p.x, q.x) / GRID); ix <= Math.floor(Math.max(p.x, q.x) / GRID); ix++) {
      for (let iz = Math.floor(Math.min(p.z, q.z) / GRID); iz <= Math.floor(Math.max(p.z, q.z) / GRID); iz++) {
        const k = ix * 100003 + iz;
        (reserveGrid.get(k) || reserveGrid.set(k, []).get(k)).push(sg);
      }
    }
  }
}
// Shift (or, where the road is too narrow, drop) the lanes of each edge that would run in a bikeway. An edge's lanes
// are offsets to the right of its line, sorted; the bikeways along it bound them from the right (a curb on the right
// of the traffic) or the left (a one-way street's left curb, Adelaide's track). Returns the edges changed.
function bikeLaneShift(edges) {
  let shifted = 0, dropped = 0;
  for (const e of edges) {
    if (!e.lanes.length || Math.min(e.h0 || 0, e.h1 || 0) > 2) continue;
    let hi = Infinity, lo = -Infinity;
    const reach = Math.max(e.half, 5) + 5;
    for (let t = 6; t <= e.span - 6; t += 3) {
      const x = e.x0 + e.dx * t, z = e.z0 + e.dz * t;
      for (const [ax, az, bx, bz, nx, nz, res] of reserveGrid.get(Math.floor(x / GRID) * 100003 + Math.floor(z / GRID)) || []) {
        const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
        if (L2 < 1e-6) continue;
        if (Math.abs(ex * e.dx + ez * e.dz) < 0.9 * Math.sqrt(L2)) continue; // along this road, not across it
        const u = ((x - ax) * ex + (z - az) * ez) / L2;
        if (u < 0 || u > 1) continue;
        const cx = ax + ex * u, cz = az + ez * u; // the curb beside this point
        const curb = (cx - e.x0) * e.rx + (cz - e.z0) * e.rz; // its offset to the right of the edge's line
        if (Math.abs(curb) > reach) continue;
        const into = nx * e.rx + nz * e.rz; // the road lies this way from the curb (+: to the right)
        const edge = curb + Math.sign(into) * res;
        if (into < 0) hi = Math.min(hi, edge - CAR_CLEAR);
        else lo = Math.max(lo, edge + CAR_CLEAR);
      }
    }
    if (hi === Infinity && lo === -Infinity) continue;
    const before = e.lanes.slice();
    // the other bounds: a two-way road's lanes stay right of its centre line, a one-way's inside its left curb
    const twoWay = before[0] > 0;
    const floor = twoWay ? Math.min(1.35, before[0]) : -e.half + 1.1;
    const ceil = twoWay ? Infinity : e.half - 1.1;
    lo = Math.max(lo, floor);
    hi = Math.min(hi, Math.max(ceil, before[before.length - 1]));
    const SP = 3.0; // the narrowest lane
    let lanes = before.slice();
    // fit as many as there's room for, each as near where it was as it can be: drop lanes from the bikeway's side
    const fromRight = hi < Infinity && (lo === -Infinity || before[before.length - 1] - hi > lo - before[0]);
    while (lanes.length > 1 && hi - lo < (lanes.length - 1) * SP) {
      if (fromRight) lanes.pop(); else lanes.shift();
      dropped++;
    }
    const n = lanes.length;
    if (hi - lo < 0) {
      lanes = [(lo + hi) / 2];
    } else {
      for (let k = n - 1; k >= 0; k--) lanes[k] = Math.min(lanes[k], hi - (n - 1 - k) * SP, k + 1 < n ? lanes[k + 1] - SP : Infinity);
      for (let k = 0; k < n; k++) lanes[k] = Math.max(lanes[k], lo + k * SP, k > 0 ? lanes[k - 1] + SP : -Infinity);
    }
    lanes = lanes.map((o) => Math.round(o * 100) / 100);
    if (lanes.length !== before.length || lanes.some((o, k) => Math.abs(o - before[k]) > 0.01)) {
      e.lanes = lanes;
      e.bikeway = true;
      shifted++;
    }
  }
  console.info(`[cycling] traffic lanes kept clear of the bikeways on ${shifted} edges (${dropped} lanes given up)`);
  return shifted;
}

// How far a body of half width hw at (x, z) reaches into a bikeway beside its road (m; 0: clear), for checks
function bikewayIntrusion(x, z, hw = 0.95) {
  let worst = 0;
  for (const [ax, az, bx, bz, nx, nz, res] of reserveGrid.get(Math.floor(x / GRID) * 100003 + Math.floor(z / GRID)) || []) {
    const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
    if (L2 < 1e-6) continue;
    const u = ((x - ax) * ex + (z - az) * ez) / L2;
    if (u < 0 || u > 1) continue;
    const d = (x - ax - ex * u) * nx + (z - az - ez * u) * nz; // into the road from the curb
    if (d < -0.5 || d > res + hw + 1) continue;
    worst = Math.max(worst, res - (d - hw));
  }
  return worst;
}

// ---------------------------------------------------------------------------------------------------------------------
// The maps (city-map.js): the network by kind, coloured like the City's cycling map
// ---------------------------------------------------------------------------------------------------------------------
const MAP_STYLE = {
  [K.track]: ['#22b35e', 1.0, null],
  [K.track2]: ['#22b35e', 1.0, null],
  [K.lane]: ['#8fd16a', 0.85, null],
  [K.buffered]: ['#8fd16a', 0.85, null],
  [K.contraflow]: ['#8fd16a', 0.75, [4, 3]],
  [K.trail]: ['#c4844a', 0.9, null],
  [K.parkRoad]: ['#c4844a', 0.7, [4, 3]],
  [K.sharrow]: ['#f2a33a', 0.7, null],
  [K.signed]: ['#9c6fc0', 0.6, [2, 3]]
};
// Map lines in drawing order (the minor first, the cycle tracks on top): { kind, flat, style: [colour, width, dash] }
const MAP_ORDER = [K.signed, K.sharrow, K.parkRoad, K.contraflow, K.lane, K.buffered, K.trail, K.track2, K.track];
const MAP_LINES = (DATA.map || []).map(([kind, flat]) => ({ kind, flat, style: MAP_STYLE[kind] || ['#3fae49', 0.7, null] }))
  .sort((a, b) => MAP_ORDER.indexOf(a.kind) - MAP_ORDER.indexOf(b.kind));

Object.assign(window.CITY, { bikePaint, bikeSeparatorGeometries, buildBikePosts, bikeLaneShift, bikewayIntrusion, BIKE_MAP_LINES: MAP_LINES, CYCLING_BANDS: BANDS });
})();
