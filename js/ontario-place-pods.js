(function () {
// js/ontario-place-pods.js — where Ontario Place's pods and their bridges are, from the City's 3D massing.
// The massing (js/toronto-landmarks.js 'cinesphere') draws the pods, their bridges and the Cinesphere's ramps as one
// outline (719 corners) with only a floor at street level and a roof at 18.4 m: its walls lay outside the Cinesphere's
// OSM outline, which tools/fetch-landmark-massing.mjs keeps faces by, so up close they were flat floating slabs.
// This finds in that outline the five square pods (88 ft, ~27 m a side, turned ~45° to the grid), cuts them and the
// Cinesphere's disc out of it, and sorts what is left into the bridges between the pods (and out to the shore, the
// West Island and the fire stairs) and the Cinesphere's narrow ramps; landmarks.js (buildOntarioPods) models them.
// Pure geometry (no three.js): tests/ontario-place-pods.test.mjs runs it on the real massing.

const CELL = 1; // the raster's cell (m)
const CORE = 7; // a pod's core: cells at least this far inside the outline (bridges are under 6 m wide)
const DISC_R = 20.3; // the Cinesphere's cylinder (landmarks.js cinesphereKeep)
const RAMP_W = 2.6; // a strip narrower than this by the Cinesphere is one of its ramps
const SLIVER_W = 1.5, SLIVER_NEAR = 2.5; // the outline's slivers along a pod's sides (narrower, within this of it)
const MIN_STRIP = 3; // (m²) a strip smaller than this is a scrap

const cross = (ax, az, bx, bz) => ax * bz - az * bx;
function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += cross(pts[j][0], pts[j][1], pts[i][0], pts[i][1]);
  return a / 2;
}
function centroid(pts) {
  let a = 0, x = 0, z = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const c = cross(pts[j][0], pts[j][1], pts[i][0], pts[i][1]);
    a += c; x += (pts[j][0] + pts[i][0]) * c; z += (pts[j][1] + pts[i][1]) * c;
  }
  if (Math.abs(a) < 1e-9) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  return [x / (3 * a), z / (3 * a)];
}
// a convex polygon (counter-clockwise or not) kept on one side of the line through a with normal n: n . (p - a) >= 0
function clipHalf(pts, ax, az, nx, nz) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const dp = (p[0] - ax) * nx + (p[1] - az) * nz, dq = (q[0] - ax) * nx + (q[1] - az) * nz;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}
// A convex polygon minus a convex shape (its edges as [ax, az, outward nx, nz]): disjoint convex pieces outside it
function subtractConvex(pts, edges) {
  const pieces = [];
  let rest = pts;
  for (const [ax, az, nx, nz] of edges) {
    if (rest.length < 3) break;
    const outside = clipHalf(rest, ax, az, nx, nz);
    if (outside.length >= 3 && Math.abs(polyArea(outside)) > 1e-4) pieces.push(outside);
    rest = clipHalf(rest, ax, az, -nx, -nz);
  }
  return pieces;
}
// a segment's parts outside a convex shape (Cyrus-Beck)
function segmentOutside(a, b, edges) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  for (const [ax, az, nx, nz] of edges) {
    const num = (a[0] - ax) * nx + (a[1] - az) * nz, den = dx * nx + dz * nz;
    if (Math.abs(den) < 1e-12) { if (num > 0) return [[a, b]]; continue; }
    const t = -num / den;
    if (den < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 >= t1) return [[a, b]];
  }
  const at = (t) => [a[0] + dx * t, a[1] + dz * t];
  const out = [];
  if (t0 > 1e-6) out.push([a, at(t0)]);
  if (t1 < 1 - 1e-6) out.push([at(t1), b]);
  return out;
}
const squareEdges = (p, grow = 0) => {
  const h = p.half + grow, cs = Math.cos(p.ang), sn = Math.sin(p.ang);
  // the pod's frame: u = (cs, -sn), v = (sn, cs) (landmarks.js `at`)
  return [[cs, -sn], [-cs, sn], [sn, cs], [-sn, -cs]].map(([nx, nz]) => [p.x + nx * h, p.z + nz * h, nx, nz]);
};
const discEdges = (x, z, r, n = 32) => {
  const R = r / Math.cos(Math.PI / n); // (circumscribed)
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
    out.push([x + nx * R * Math.cos(Math.PI / n), z + nz * R * Math.cos(Math.PI / n), nx, nz]);
  }
  return out;
};
const insideConvex = (x, z, edges, pad = 0) => edges.every(([ax, az, nx, nz]) => (x - ax) * nx + (z - az) * nz <= pad);

// A raster of triangles (flat [x0, z0, x1, z1, x2, z2] each): cell (i, j) centre at (x0 + (i + .5) c, z0 + (j + .5) c)
function rasterize(tris, box, c) {
  const nx = Math.ceil((box[2] - box[0]) / c) + 1, nz = Math.ceil((box[3] - box[1]) / c) + 1;
  const g = new Uint8Array(nx * nz);
  for (const t of tris) {
    const [ax, az, bx, bz, cx, cz] = t;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - box[0]) / c)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - box[0]) / c));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - box[1]) / c)), j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - box[1]) / c));
    const s = cross(bx - ax, bz - az, cx - ax, cz - az);
    if (Math.abs(s) < 1e-9) continue;
    for (let j = j0; j <= j1; j++) {
      const z = box[1] + (j + 0.5) * c;
      for (let i = i0; i <= i1; i++) {
        const x = box[0] + (i + 0.5) * c;
        const w0 = cross(bx - ax, bz - az, x - ax, z - az), w1 = cross(cx - bx, cz - bz, x - bx, z - bz), w2 = cross(ax - cx, az - cz, x - cx, z - cz);
        if (s > 0 ? (w0 >= 0 && w1 >= 0 && w2 >= 0) : (w0 <= 0 && w1 <= 0 && w2 <= 0)) g[j * nx + i] = 1;
      }
    }
  }
  return { g, nx, nz, c, x0: box[0], z0: box[1] };
}
// chamfer distance (cells) to the outside
function distance(R) {
  const { g, nx, nz } = R, d = new Float32Array(nx * nz), D = Math.SQRT2;
  for (let k = 0; k < d.length; k++) d[k] = g[k] ? 1e9 : 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!d[k]) continue;
    let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + 1); else v = Math.min(v, 1);
    if (j > 0) v = Math.min(v, d[k - nx] + 1, i > 0 ? d[k - nx - 1] + D : 1, i < nx - 1 ? d[k - nx + 1] + D : 1); else v = Math.min(v, 1);
    d[k] = v;
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i;
    if (!d[k]) continue;
    let v = d[k];
    if (i < nx - 1) v = Math.min(v, d[k + 1] + 1); else v = Math.min(v, 1);
    if (j < nz - 1) v = Math.min(v, d[k + nx] + 1, i < nx - 1 ? d[k + nx + 1] + D : 1, i > 0 ? d[k + nx - 1] + D : 1); else v = Math.min(v, 1);
    d[k] = v;
  }
  return d;
}
// connected components (8-neighbour) of the cells where keep(k): a label per cell (-1 none) and each one's cells
function components(nx, nz, keep) {
  const label = new Int32Array(nx * nz).fill(-1), comps = [];
  for (let k0 = 0; k0 < label.length; k0++) {
    if (label[k0] >= 0 || !keep(k0)) continue;
    const cells = [k0], id = comps.length;
    label[k0] = id;
    for (let q = 0; q < cells.length; q++) {
      const k = cells[q], i = k % nx, j = (k - i) / nx;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const n = b * nx + a;
        if (label[n] < 0 && keep(n)) { label[n] = id; cells.push(n); }
      }
    }
    comps.push(cells);
  }
  return { label, comps };
}

// pos/idx: the massing (world x, y, z; y 0 = street level); site: the Cinesphere's (x, z)
function ontarioPodLayout(pos, idx, site) {
  // the roof: the outline's triangles at the top, and its ring (the edges only one triangle has)
  const tris = [], edgeUse = new Map(), vtx = new Map();
  const key = (v) => `${Math.round(pos[v] * 100)},${Math.round(pos[v + 2] * 100)}`;
  let top = 0;
  for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i]);
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    if (v.some((a) => pos[a + 1] < top - 0.5)) continue;
    tris.push([pos[v[0]], pos[v[0] + 2], pos[v[1]], pos[v[1] + 2], pos[v[2]], pos[v[2] + 2]]);
    for (let k = 0; k < 3; k++) {
      const a = key(v[k]), b = key(v[(k + 1) % 3]);
      vtx.set(a, [pos[v[k]], pos[v[k] + 2]]);
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeUse.set(e, (edgeUse.get(e) || 0) + 1);
    }
  }
  const ring = [];
  for (const [e, n] of edgeUse) if (n === 1) { const [a, b] = e.split('|'); ring.push([vtx.get(a), vtx.get(b)]); }
  let box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let k = 0; k < 6; k += 2) box = [Math.min(box[0], t[k]), Math.min(box[1], t[k + 1]), Math.max(box[2], t[k]), Math.max(box[3], t[k + 1])];
  box = [box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2];

  // the pods: the outline's thick parts (cores at least CORE m in), each a square; its turn the one whose square
  // round the core is smallest, its size the median of the outline's corners on its sides
  const R = rasterize(tris, box, CELL), d = distance(R);
  const disc = { x: site.x, z: site.z, r: DISC_R }, discE = discEdges(site.x, site.z, DISC_R);
  const cellX = (k) => R.x0 + ((k % R.nx) + 0.5) * R.c, cellZ = (k) => R.z0 + (Math.floor(k / R.nx) + 0.5) * R.c;
  const cores = components(R.nx, R.nz, (k) => d[k] * R.c >= CORE && Math.hypot(cellX(k) - site.x, cellZ(k) - site.z) > DISC_R + CORE);
  const corners = [...vtx.values()].filter((p) => ring.some(([a, b]) => a === p || b === p));
  const pods = [];
  for (const cells of cores.comps) {
    if (cells.length * R.c * R.c < 40) continue;
    let cx = 0, cz = 0;
    for (const k of cells) { cx += cellX(k); cz += cellZ(k); }
    cx /= cells.length; cz /= cells.length;
    let best = { ext: Infinity, ang: 0 };
    for (let a = 0; a < 90; a += 0.5) {
      const ang = (a * Math.PI) / 180, cs = Math.cos(ang), sn = Math.sin(ang);
      let ext = 0;
      for (const k of cells) {
        const x = cellX(k) - cx, z = cellZ(k) - cz;
        ext = Math.max(ext, Math.abs(x * cs - z * sn), Math.abs(x * sn + z * cs));
      }
      if (ext < best.ext) best = { ext, ang };
    }
    // its sides: on each, the outline's corners nearest the centre (the pod's own corners & where its bridges meet
    // it; the bridges' corners lie further out), the centre then moved to the middle of the four
    const cs = Math.cos(best.ang), sn = Math.sin(best.ang), guess = best.ext + CORE + R.c / 2;
    let half = guess;
    for (let pass = 0; pass < 3; pass++) {
      const side = [Infinity, Infinity, Infinity, Infinity]; // +u, -u, +v, -v
      for (const [x, z] of corners) {
        const u = (x - cx) * cs - (z - cz) * sn, v = (x - cx) * sn + (z - cz) * cs, h = Math.max(Math.abs(u), Math.abs(v));
        if (h < half - 5 || h > half + 4) continue;
        const k = Math.abs(u) >= Math.abs(v) ? (u > 0 ? 0 : 1) : (v > 0 ? 2 : 3);
        side[k] = Math.min(side[k], h);
      }
      const s = side.map((h) => (Number.isFinite(h) ? h : half));
      const du = (s[0] - s[1]) / 2, dv = (s[2] - s[3]) / 2;
      cx += du * cs + dv * sn; cz += -du * sn + dv * cs;
      half = (s[0] + s[1] + s[2] + s[3]) / 4;
    }
    pods.push({ x: cx, z: cz, ang: best.ang, half });
  }
  pods.sort((a, b) => a.x - b.x || a.z - b.z);
  const podE = pods.map((p) => squareEdges(p));

  // what is left of the roof once the pods & the Cinesphere's disc are cut out: convex pieces
  const cutters = [...podE, discE];
  let pieces = tris.map((t) => [[t[0], t[1]], [t[2], t[3]], [t[4], t[5]]]);
  for (const E of cutters) pieces = pieces.flatMap((p) => subtractConvex(p, E));
  pieces = pieces.filter((p) => Math.abs(polyArea(p)) > 0.01);
  // ...in strips: the raster of what's left, its connected parts, each piece in the part its centroid lies in
  const W = rasterize(pieces.flatMap((p) => p.slice(1, -1).map((q, i) => [p[0][0], p[0][1], q[0], q[1], p[i + 2][0], p[i + 2][1]])), box, CELL / 2);
  // (the massing's pods aren't quite square: the slivers left along their sides, under 1.5 m wide, are no strip)
  const wd = distance(W);
  const byPod = (k) => podE.some((E) => insideConvex(W.x0 + ((k % W.nx) + 0.5) * W.c, W.z0 + (Math.floor(k / W.nx) + 0.5) * W.c, E, SLIVER_NEAR));
  const parts = components(W.nx, W.nz, (k) => W.g[k] === 1 && (wd[k] * W.c >= SLIVER_W / 2 || !byPod(k)));
  const wx = (k) => W.x0 + ((k % W.nx) + 0.5) * W.c, wz = (k) => W.z0 + (Math.floor(k / W.nx) + 0.5) * W.c;
  const partAt = (x, z) => {
    const i = Math.floor((x - W.x0) / W.c), j = Math.floor((z - W.z0) / W.c);
    let best = -1, bd = Infinity;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= W.nx || b >= W.nz) continue;
      const l = parts.label[b * W.nx + a], dd = di * di + dj * dj;
      if (l >= 0 && dd < bd) { bd = dd; best = l; }
    }
    return best;
  };
  const strips = parts.comps.map((cells, id) => {
    // its axis (principal direction), length and width
    let mx = 0, mz = 0;
    for (const k of cells) { mx += wx(k); mz += wz(k); }
    mx /= cells.length; mz /= cells.length;
    let sxx = 0, szz = 0, sxz = 0;
    for (const k of cells) { const x = wx(k) - mx, z = wz(k) - mz; sxx += x * x; szz += z * z; sxz += x * z; }
    const th = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(th), uz = Math.sin(th);
    let lo = Infinity, hi = -Infinity;
    for (const k of cells) { const t = (wx(k) - mx) * ux + (wz(k) - mz) * uz; lo = Math.min(lo, t); hi = Math.max(hi, t); }
    const area = cells.length * W.c * W.c, length = hi - lo + W.c, width = area / length;
    const nearDisc = (x, z) => Math.hypot(x - site.x, z - site.z) < DISC_R + 4;
    const nearPod = (x, z, pad = 4) => podE.some((E) => insideConvex(x, z, E, pad));
    // its ends: the cells furthest along the axis each way; free when no pod or the Cinesphere is there
    const ends = [lo, hi].map((t, e) => {
      let x = 0, z = 0, n = 0;
      for (const k of cells) {
        const tt = (wx(k) - mx) * ux + (wz(k) - mz) * uz;
        if (Math.abs(tt - t) <= 1.5) { x += wx(k); z += wz(k); n++; }
      }
      x /= n; z /= n;
      const dir = e ? [ux, uz] : [-ux, -uz]; // (outward)
      let pod = -1, gap = Infinity;
      pods.forEach((p, i) => {
        const cs = Math.cos(p.ang), sn = Math.sin(p.ang);
        const u = Math.abs((x - p.x) * cs - (z - p.z) * sn) - p.half, v = Math.abs((x - p.x) * sn + (z - p.z) * cs) - p.half;
        const g = Math.hypot(Math.max(u, 0), Math.max(v, 0));
        if (g < gap) { gap = g; pod = i; }
      });
      return { x, z, dir, pod, gap };
    });
    // an end is free (a stair down: to the shore, an island or a fire stair) unless it meets a pod or the Cinesphere
    for (const e of ends) e.free = !nearDisc(e.x, e.z) && e.gap > 2;
    const kind = area < MIN_STRIP ? 'scrap' : width < RAMP_W && ends.some((e) => nearDisc(e.x, e.z)) ? 'ramp' : 'bridge';
    // piers under a bridge: every ~22 m along it, where its cross-section's middle is on it
    const piers = [];
    if (kind === 'bridge') {
      const n = Math.max(0, Math.round((length - 8) / 22));
      for (let s = 1; s <= n; s++) {
        const t = lo + ((hi - lo) * s) / (n + 1);
        let x = 0, z = 0, c = 0;
        for (const k of cells) {
          const tt = (wx(k) - mx) * ux + (wz(k) - mz) * uz;
          if (Math.abs(tt - t) <= 0.5) { x += wx(k); z += wz(k); c++; }
        }
        if (!c) continue;
        x /= c; z /= c;
        const i = Math.floor((x - W.x0) / W.c), j = Math.floor((z - W.z0) / W.c);
        if (parts.label[j * W.nx + i] === id && !nearPod(x, z) && !nearDisc(x, z)) piers.push([x, z]);
      }
    }
    return { id, kind, axis: [ux, uz], centre: [mx, mz], length, width, area, ends, piers };
  });
  const kept = (part) => part >= 0 && strips[part].kind !== 'scrap';
  const out = pieces.map((pts) => ({ part: partAt(...centroid(pts)), pts })).filter((p) => kept(p.part));
  // its walls: the outline's edges outside the pods & the disc, each in its part
  const walls = [];
  for (const [a, b] of ring) {
    let segs = [[a, b]];
    for (const E of cutters) segs = segs.flatMap(([p, q]) => segmentOutside(p, q, E));
    for (const [p, q] of segs) {
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.05) continue;
      const part = partAt((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      if (kept(part)) walls.push({ part, a: p, b: q });
    }
  }
  return { top, pods, disc, pieces: out, strips, walls };
}

Object.assign(window.CITY, { ontarioPodLayout, OntarioPodGeometry: { polyArea, subtractConvex, segmentOutside, squareEdges } });
})();
