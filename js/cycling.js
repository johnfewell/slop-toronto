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
// The paint goes into road-paint.js's cells (bikePaint), the separator curbs into city-grid.js's kerb batch
// (bikeSeparatorGeometries) and the posts are one instanced mesh scene-culling.js chunks. road-network.js keeps every
// traffic lane clear of the bikeways (bikeLaneShift), so the paint and the traffic agree and no car drives in them.
// Round a CaféTO curb lane platform (js/toronto-patios.js, prebuilt, so known before this runs) that stands at the curb
// in a bikeway's place, as on the Danforth and Bloor, the bikeway is routed out round its road side: the band's curb
// line bends out past the platform's barrier with smooth tapers, the paint, separator curb, flexi-posts and the reserve
// traffic keeps clear of all following it (routeRoundPatios). A cycle track narrows there where the platform's site
// says the traffic lane needs it (never under CaféTO's 1.2 m for cyclists). bikewayIntrusion answers for the bikeways as
// mapped (the patio layout's input); routedBikewayIntrusion for the bikeways as built round the platforms.

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
    // (a level given, a trail's over the paving: on the Don Valley pilot's ground too, js/don-valley.js)
    P.push({ x, z, y: y === null ? cutY(x, z) : y + (window.CITY.DON_VALLEY ? window.CITY.DON_VALLEY.heightAt(x, z) : 0) });
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
    tx: tx / L, tz: tz / L, nx: P.nRight ? -tz / L : tz / L, nz: P.nRight ? tx / L : -tx / L, m: 1,
    sq: (a.sq || 0) + ((b.sq || 0) - (a.sq || 0)) * t
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
    kind, P, mapped: P, cross: !!(flags & 2), contra: !!(flags & 4),
    startJ: crossEnds.has(`${flat[0]},${flat[1]}`), endJ: crossEnds.has(`${flat[flat.length - 2]},${flat[flat.length - 1]}`)
  });
}
// A track's own width beside point p (narrowed through a detour: p.sq)
const trackW = (kind, p) => (kind === K.track2 ? TRACK2_W : TRACK_W) - (p.sq || 0);
// An offset o from the curb line, less each point's squeeze (a list for road-paint.js's ribbon), or o where none is
const squeezed = (P, o) => (P.some((p) => p.sq) ? P.map((p) => o - (p.sq || 0)) : o);

// ---------------------------------------------------------------------------------------------------------------------
// Round the CaféTO curb lane platforms in the bikeways' place (patio-layout.js: a site's `bikeway` is the reserve the
// bikeway may take beside it, m; 0: not in a bikeway)
// ---------------------------------------------------------------------------------------------------------------------
// (the bend at each end: about 5.5 m, as the 2025 aerial of 494 Danforth shows; a smooth S, for a 2 m shift 1 in 2.75 on
// average and 1 in 1.8 at its steepest)
const DETOUR_TAPER = 5.5, DETOUR_MARGIN = 0.6;
const DETOUR = Object.freeze({
  gap: 0.2, // m between the platform's barrier and the bikeway's curb-side edge (patio-layout.js RULES.detourGap)
  margin: DETOUR_MARGIN, // m past each end of the platform the bikeway runs fully out (clear of the barrier's corner posts)
  taper: DETOUR_TAPER, // m over which it bends out and back (above)
  // m: platforms closer than this end to end share one detour rather than dipping part way back between them: each
  // end's margin and bend, so a pair further apart has room to bend back to the curb and out again (12.2 m)
  bridge: 2 * (DETOUR_MARGIN + DETOUR_TAPER),
  step: 0.5 // m between the bent line's points in a detour and its tapers
});
// A smooth 0..1 profile, f(e) of the distance e beyond a detour's full stretch
const easeOut = (e) => (e <= 0 ? 1 : e >= DETOUR.taper ? 0 : ((t) => t * t * (3 - 2 * t))(1 - e / DETOUR.taper));
const detourStats = { platforms: 0, detours: 0, bands: 0, narrowed: 0 };
// The prebuilt patio layout's rows (js/toronto-patios.js) as sites
function patioRows(PATIOS) {
  const F = PATIOS?.fields || [];
  return (PATIOS?.sites || []).map((row) => Object.fromEntries(F.map((k, i) => [k, row[i]])));
}
// Bend the bands out round the curb lane platforms standing in a bikeway's place. Platforms on one curb closer than
// DETOUR.bridge end to end make one detour. Each bent band is resampled through its detours and prepared again (its
// normals, mitres, distances and street levels), its points carrying `sq`, how much narrower than mapped its bikeway is
// there. Idempotent: always bent from the mapped line. Returns the stats.
function routeRoundPatios(sites) {
  const list = (sites || []).filter((s) => s.kind === 'curb' && s.bikeway > 0);
  Object.assign(detourStats, { platforms: list.length, detours: 0, bands: 0, narrowed: 0 });
  // detours: runs of platforms along one curb, in the first one's frame (along t, out of the road n)
  const runs = [];
  for (const s of list.slice().sort((a, b) => a.cx - b.cx || a.cz - b.cz)) {
    const hl = s.length / 2;
    let run = runs.find((r) => r.tx * s.tx + r.tz * s.tz > 0.98 && Math.abs((s.cx - r.cx) * r.nx + (s.cz - r.cz) * r.nz) < 1 &&
      (((u) => u - hl - r.u1 < DETOUR.bridge && r.u0 - (u + hl) < DETOUR.bridge))((s.cx - r.cx) * r.tx + (s.cz - r.cz) * r.tz));
    const u = run ? (s.cx - run.cx) * run.tx + (s.cz - run.cz) * run.tz : 0;
    if (!run) runs.push((run = { cx: s.cx, cz: s.cz, tx: s.tx, tz: s.tz, nx: s.nx, nz: s.nz, u0: Infinity, u1: -Infinity, sites: [] }));
    run.u0 = Math.min(run.u0, u - hl);
    run.u1 = Math.max(run.u1, u + hl);
    run.sites.push(s);
  }
  detourStats.detours = runs.length;
  // (each run's box, to pass over the bands far from all of them quickly)
  for (const r of runs) {
    const reach = Math.max(-r.u0, r.u1) + DETOUR.margin + DETOUR.taper + 8;
    Object.assign(r, { x0: r.cx - reach, x1: r.cx + reach, z0: r.cz - reach, z1: r.cz + reach });
  }
  // how far a run's detour reaches (x, z): 0..1 (full beside the platforms), null out of its reach
  const reachOf = (r, x, z) => {
    const u = (x - r.cx) * r.tx + (z - r.cz) * r.tz, v = (x - r.cx) * r.nx + (z - r.cz) * r.nz;
    if (v > 2 || v < -6) return null; // (this curb's bikeway, not the far side's)
    const e = Math.max(r.u0 - DETOUR.margin - u, u - r.u1 - DETOUR.margin);
    return e >= DETOUR.taper ? null : easeOut(e);
  };
  for (const b of BANDS) {
    const M = b.mapped;
    b.P = M;
    if (b.cross || !RESERVE[b.kind] || !runs.length) continue;
    // the runs beside this band (parallel, on its curb), with the shift out that clears their platforms: the barrier's
    // road side + the gap, from the band's own curb line; and the squeeze its reserve takes there
    const mine = [];
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const p of M) { bx0 = Math.min(bx0, p.x); bx1 = Math.max(bx1, p.x); bz0 = Math.min(bz0, p.z); bz1 = Math.max(bz1, p.z); }
    for (const r of runs) {
      if (r.x0 > bx1 || r.x1 < bx0 || r.z0 > bz1 || r.z1 < bz0) continue;
      // (a piece of the band running along the run's curb within its reach)
      const touches = M.some((p, i) => {
        if (!i) return false;
        const q = M[i - 1], L = Math.hypot(p.x - q.x, p.z - q.z);
        if (Math.abs(((p.x - q.x) * r.tx + (p.z - q.z) * r.tz) / (L || 1)) < 0.9) return false;
        for (let k = 0, n = Math.ceil(L / 2); k <= n; k++) {
          if (reachOf(r, q.x + ((p.x - q.x) * k) / n, q.z + ((p.z - q.z) * k) / n) !== null) return true;
        }
        return false;
      });
      if (!touches) continue;
      let D = 0, res = RESERVE[b.kind];
      for (const s of r.sites) {
        // the band's curb line beside the platform, and the platform's road-side edge from it
        let best = null;
        for (let i = 0; i + 1 < M.length; i++) {
          const p = M[i], q = M[i + 1], ex = q.x - p.x, ez = q.z - p.z, L2 = ex * ex + ez * ez || 1e-9;
          const t = Math.max(0, Math.min(1, ((s.cx - p.x) * ex + (s.cz - p.z) * ez) / L2));
          const x = p.x + ex * t, z = p.z + ez * t, d = Math.hypot(s.cx - x, s.cz - z);
          if (!best || d < best.d) best = { d, x, z };
        }
        if (!best || best.d > 6) continue;
        D = Math.max(D, (best.x - s.cx) * s.nx + (best.z - s.cz) * s.nz + s.depth / 2 + DETOUR.gap);
        res = Math.min(res, s.bikeway);
      }
      // (a reserve a few cm under the mapped one is the curb's offset from the band's line, not a squeeze)
      if (D > 0) mine.push({ r, D, sq: RESERVE[b.kind] - res > 0.05 ? RESERVE[b.kind] - res : 0 });
    }
    if (!mine.length) continue;
    const shape = (x, z) => {
      let D = 0, sq = 0;
      for (const { r, D: d, sq: q } of mine) {
        const f = reachOf(r, x, z);
        if (f === null) continue;
        D = Math.max(D, d * f);
        sq = Math.max(sq, q * f);
      }
      return { D, sq };
    };
    // resample the stretches a detour reaches every DETOUR.step, and shift each point out
    const flat = [];
    for (let i = 0; i < M.length; i++) {
      const p = M[i];
      const put = (x, z, nx, nz) => { const { D } = shape(x, z); flat.push(x + nx * D, z + nz * D); };
      put(p.x, p.z, p.nx, p.nz);
      if (i + 1 === M.length) break;
      const q = M[i + 1], L = Math.hypot(q.x - p.x, q.z - p.z), n = Math.ceil(L / DETOUR.step);
      // (the piece's own normal: the shift is square to the mapped curb)
      const nx = (M.nRight ? -(q.z - p.z) : q.z - p.z) / (L || 1), nz = (M.nRight ? q.x - p.x : -(q.x - p.x)) / (L || 1);
      // (bracketed by a sample either side, unshifted, so the coarse line runs straight to where the taper begins)
      const inReach = (k) => { const t = k / n; return mine.some(({ r }) => reachOf(r, p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t) !== null); };
      for (let k = 1; k < n; k++) {
        const t = k / n, x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t;
        if (inReach(k) || inReach(k - 1) || inReach(k + 1)) put(x, z, nx, nz);
      }
    }
    const P = prepare(flat, M.nRight);
    if (!P) continue;
    // each point's squeeze, from where it lies along the detour (the shift out leaves that unchanged)
    let narrowed = false;
    for (const p of P) {
      const { sq } = shape(p.x, p.z);
      p.sq = sq > 0.005 ? sq : 0;
      if (p.sq) narrowed = true;
    }
    b.P = P;
    detourStats.bands++;
    if (narrowed) detourStats.narrowed++;
  }
  ROUTED_GRID = reserveGridOf(BANDS);
  return { ...detourStats };
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

// The paint goes into road-paint.js's cells: the lines & surfaces (strip, ribbon) and the pavement symbols' many small
// strips (symbolStrip: solid, down to 2 cm long)
function bikePaint({ strip, ribbon, symbolStrip, WHITE, YELLOW }) {
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
      if (solid) ribbon(solid, squeezed(solid, LINE_AT - 0.075), squeezed(solid, LINE_AT + 0.075), col);
      if (kind === K.buffered && solid) {
        ribbon(solid, squeezed(solid, 2.425), squeezed(solid, 2.575), WHITE);
        for (let s = head + 2; s < len - tail - 1.5; s += 4) {
          const a = at(P, s), c = at(P, s + 1.4);
          strip(a.x + a.nx * LINE_AT, a.y, a.z + a.nz * LINE_AT, c.x + c.nx * 2.5, c.y, c.z + c.nz * 2.5, 0.14, WHITE);
        }
      }
      const end = tail ? slice(P, len - tail, len) : null;
      if (end) {
        ribbon(end, squeezed(end, LINE_AT - 0.075), squeezed(end, LINE_AT + 0.075), col, 1.2, 0.5);
        ribbon(end, 0.25, squeezed(end, LINE_AT - 0.15), GREEN);
      }
    } else {
      // cycle tracks: green at the corners; a bi-directional one's dashed yellow centre line
      const green = (Q) => Q && ribbon(Q, 0.05, Q.map((p) => trackW(kind, p)), GREEN);
      if (tail) green(slice(P, len - tail, len));
      if (head) green(slice(P, 0, head));
      if (kind === K.track2) {
        const mid = slice(P, head, len - tail);
        if (mid) ribbon(mid, mid.map((p) => trackW(kind, p) / 2 - 0.06), mid.map((p) => trackW(kind, p) / 2 + 0.06), YELLOW, 6, 0.5);
      }
    }
    // the bicycle after each junction and every ~110 m, with a diamond (lanes) or an arrow (tracks, contra-flow lanes)
    const step = 110;
    for (let s = head + 7; s < len - tail - 5; s += step) {
      // (a track's symbols in the middle of its width there, narrowed or not)
      const W = trackW(kind, at(P, s));
      if (kind === K.track2) {
        symbol(P, s, W * 0.27, BICYCLE, 0.07, 1.8);
        symbol(P, s + 2.6, W * 0.27, ARROW, 0.1, 1.6);
        symbol(P, s + 4.2, W * 0.73, BICYCLE, 0.07, 1.8, true);
        symbol(P, s + 1.6, W * 0.73, ARROW, 0.1, 1.6, true);
      } else {
        const v = kind === K.track ? W / 2 : LINE_AT / 2 - at(P, s).sq / 2;
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
  console.info(`[cycling] ${BANDS.length} bikeway pieces painted, ${symbols} symbols, ${trailKm.toFixed(1)} km of trail surface`);
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
    // (a and b: the separator's inner and outer offsets at a point, the track narrowed or not)
    const run = slice(b.P, b.startJ ? 4 : 1, b.P.len - (b.endJ ? 8 : 1));
    if (run && run[run.length - 1].s - run[0].s > 3) runs.push({ P: run, a: (p) => trackW(b.kind, p), b: (p) => trackW(b.kind, p) + SEP_W });
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
      const pa = a(p), pb = b(p), qa = a(q), qb = b(q);
      quad(off(p, pa, SEP_H), off(p, pb, SEP_H), off(q, qb, SEP_H), off(q, qa, SEP_H), [0, 1, 0]);
      quad(off(p, pb, 0), off(q, qb, 0), off(q, qb, SEP_H), off(p, pb, SEP_H), [nx, 0, nz]);
      quad(off(p, pa, 0), off(q, qa, 0), off(q, qa, SEP_H), off(p, pa, SEP_H), [-nx, 0, -nz]);
    }
    for (const [p, dir] of [[P[0], -1], [P[P.length - 1], 1]]) {
      quad(off(p, a(p), 0), off(p, b(p), 0), off(p, b(p), SEP_H), off(p, a(p), SEP_H), [p.tx * dir, 0, p.tz * dir]);
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
// White flexi-posts on the separators, one instanced mesh (scene-culling.js chunks it and hides it with distance), and
// the separators' & posts' colliders (world-collision.js): each post solid, the curb a low wall, piece by piece, that
// stops a car and that a bicycle crosses only steeply (controllers.js CURB_CROSS)
const POST_R = 0.06;
function buildBikePosts(scene) {
  const spots = [], colliders = [];
  const { circleCollider, boxCollider } = window.CITY.WorldCollision;
  for (const { P, a, b } of separatorRuns()) {
    const len = P[P.length - 1].s - P[0].s;
    const n = Math.max(1, Math.floor(len / POST_EVERY));
    for (let k = 0; k <= n; k++) {
      const p = at(P, P[0].s + (len * k) / n), o = (a(p) + b(p)) / 2;
      const x = p.x + p.nx * o, z = p.z + p.nz * o;
      spots.push(x, p.y + SEP_H, z);
      colliders.push(circleCollider(x, z, POST_R, p.y, SEP_H + 0.8, 'post'));
    }
    for (let i = 0; i + 1 < P.length; i++) {
      // (each piece between the line's points, its ends a few cm long so the joints leave no gap)
      const p = P[i], q = P[i + 1], op = (a(p) + b(p)) / 2, oq = (a(q) + b(q)) / 2;
      const ax = p.x + p.nx * op * p.m, az = p.z + p.nz * op * p.m, bx = q.x + q.nx * oq * q.m, bz = q.z + q.nz * oq * q.m;
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      colliders.push(boxCollider((ax + bx) / 2, (az + bz) / 2, SEP_W / 2, L / 2 + 0.05, Math.atan2(bx - ax, bz - az), Math.min(p.y, q.y), SEP_H, 'curb'));
    }
  }
  if (!spots.length) return { mesh: null, colliders };
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
  console.info(`[cycling] ${spots.length / 3} flexi-posts on the cycle tracks' separators (${colliders.length} colliders with the curbs)`);
  return { mesh, colliders };
}

// ---------------------------------------------------------------------------------------------------------------------
// Traffic lanes (road-network.js): each lane's centre keeps CAR_CLEAR from the edge of any bikeway along its road
// ---------------------------------------------------------------------------------------------------------------------
const GRID = 24;
// 24 m cells -> [ax, az, bx, bz, nx, nz (into the road), reserve, kind]: the bands' curb lines as the bands give them
function reserveGridOf(bands, mapped = false) {
  const grid = new Map();
  for (const b of bands) {
    const res = RESERVE[b.kind];
    if (!res) continue; // (sharrows share the lane)
    const P = mapped ? b.mapped : b.P;
    for (let i = 0; i + 1 < P.length; i++) {
      const p = P[i], q = P[i + 1];
      const sg = [p.x, p.z, q.x, q.z, (p.nx + q.nx) / 2, (p.nz + q.nz) / 2, res - Math.min(p.sq || 0, q.sq || 0), b.kind];
      for (let ix = Math.floor(Math.min(p.x, q.x) / GRID); ix <= Math.floor(Math.max(p.x, q.x) / GRID); ix++) {
        for (let iz = Math.floor(Math.min(p.z, q.z) / GRID); iz <= Math.floor(Math.max(p.z, q.z) / GRID); iz++) {
          const k = ix * 100003 + iz;
          (grid.get(k) || grid.set(k, []).get(k)).push(sg);
        }
      }
    }
  }
  return grid;
}
// the bikeways as mapped (the CaféTO layout's input), and as built round the platforms (routeRoundPatios)
const reserveGrid = reserveGridOf(BANDS, true);
let ROUTED_GRID = reserveGrid;
// Shift (or, where the road is too narrow, drop) the lanes of each edge that would run in a bikeway. An edge's lanes
// are offsets to the right of its line, sorted; the bikeways along it bound them from the right (a curb on the right
// of the traffic) or the left (a one-way street's left curb, Adelaide's track). Returns the edges changed.
function bikeLaneShift(edges) {
  let shifted = 0, dropped = 0, detoured = [];
  // the bounds the bikeways (as built: grid) set an edge's lanes, from the right (hi) and the left (lo)
  const bounds = (e, grid) => {
    let hi = Infinity, lo = -Infinity;
    const reach = Math.max(e.half, 5) + 5;
    for (let t = 6; t <= e.span - 6; t += 3) {
      const x = e.x0 + e.dx * t, z = e.z0 + e.dz * t;
      for (const [ax, az, bx, bz, nx, nz, res] of grid.get(Math.floor(x / GRID) * 100003 + Math.floor(z / GRID)) || []) {
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
    return [hi, lo];
  };
  for (const e of edges) {
    if (!e.lanes.length || Math.min(e.h0 || 0, e.h1 || 0) > 2) continue;
    let [hi, lo] = bounds(e, ROUTED_GRID);
    if (hi === Infinity && lo === -Infinity) continue;
    // (an edge whose lanes a detour round a CaféTO platform bounds more tightly than the mapped bikeway: counted)
    if (ROUTED_GRID !== reserveGrid) {
      const [h0, l0] = bounds(e, reserveGrid);
      if (Math.min(hi, e.lanes[e.lanes.length - 1]) < Math.min(h0, e.lanes[e.lanes.length - 1]) - 0.01 ||
          Math.max(lo, e.lanes[0]) > Math.max(l0, e.lanes[0]) + 0.01) detoured = [...detoured, e];
    }
    const before = e.lanes.slice();
    if (detoured[detoured.length - 1] === e) e.lanesMapped = before;
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
  // (where, and the lanes before and after: the edge's middle, its lanes as the road gave them and as they are now)
  detourStats.laneEdges = detoured.length;
  detourStats.laneEdgesAt = detoured.map((e) => ({ x: Math.round(e.x0 + e.dx * e.span / 2), z: Math.round(e.z0 + e.dz * e.span / 2),
    span: Math.round(e.span), lanes: e.lanes, before: e.lanesMapped || null }));
  console.info(`[cycling] traffic lanes kept clear of the bikeways on ${shifted} edges (${dropped} lanes given up; ` +
    `${detoured.length} bounded more by a detour round a CaféTO platform)`);
  return shifted;
}

// How far a body of half width hw at (x, z) reaches into a bikeway beside its road (m; 0: clear), for checks: the
// bikeways as mapped (the CaféTO layout reads this: it decides where they bend)
function intrusionIn(grid, x, z, hw, tracks) {
  let worst = 0;
  for (const [ax, az, bx, bz, nx, nz, res, kind] of grid.get(Math.floor(x / GRID) * 100003 + Math.floor(z / GRID)) || []) {
    if (tracks && kind !== K.track && kind !== K.track2) continue;
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
const bikewayIntrusion = (x, z, hw = 0.95) => intrusionIn(reserveGrid, x, z, hw, false);
// ... and as built, routed round the CaféTO platforms (parked cars keep out of these); `tracks`: cycle tracks only
const routedBikewayIntrusion = (x, z, hw = 0.95, tracks = false) => intrusionIn(ROUTED_GRID, x, z, hw, tracks);

// The bands bend round the prebuilt platforms now, if the page will build them (the CaféTO season against the scene's
// day, cafeto-patios.js patioSeason; not ?patios=0). Node's tools call routeRoundPatios themselves once they have them.
{
  const C = window.CITY, d = C.SCENE_DATE || { month: 8, day: 22 }, md = d.month * 100 + d.day;
  const off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('patios') === '0';
  if (C.PATIOS && !off && md >= 601 && md <= 930) {
    const t0 = Date.now(), st = routeRoundPatios(patioRows(C.PATIOS));
    detourStats.ms = Date.now() - t0;
    if (st.platforms) console.info(`[cycling] bikeways routed round ${st.platforms} CaféTO platforms (${st.detours} detours, ${st.bands} pieces bent, ${st.narrowed} narrowed, ${detourStats.ms} ms)`);
  }
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

Object.assign(window.CITY, { bikePaint, bikeSeparatorGeometries, buildBikePosts, bikeLaneShift, bikewayIntrusion,
  routedBikewayIntrusion, routeRoundPatios, patioRows, bikeSeparatorRuns: separatorRuns, BIKE_DETOUR: DETOUR, bikeDetourStats: detourStats,
  BIKE_WIDTHS: { LINE_AT, TRACK_W, TRACK2_W, SEP_W, RESERVE }, BIKE_MAP_LINES: MAP_LINES, CYCLING_BANDS: BANDS });
})();
