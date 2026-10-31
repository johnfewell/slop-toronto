(function () {
// js/don-valley.js — the Don Valley terrain pilot (?donvalley=1; docs/don-valley-terrain.md)
// The real valley under the Prince Edward Viaduct in place of the flat street level, from js/don-valley-data.js
// (tools/build-don-valley.mjs). Loaded, with its data, only with the flag (explore.html), before city-config.js.
//
// One surface authority: heightAt(x, z), the conditioned valley's height above the street datum (0 outside the box
// and on the tableland), interpolated on the grid's triangles (each 10 m cell split along its b-d diagonal, as
// js/terrain.js splits its own). Everything that stands on the ground reads it:
// - city-config.js folds it into cutAt (so the walking floor, the street furniture, trees, pedestrians and every other
//   cutAt reader follow it), remaps the decks and keeps the old road cuts as roadCutAt;
// - road-network.js gives the street graph's nodes their ground (or deck) height;
// - drape() splits the static ground meshes (street level, curb islands, lawns, walks, streams, road markings, track
//   beds) along the same grid lines and diagonals and lowers each vertex by heightAt, so what is drawn is exactly what
//   is sampled (TE-2), and tilts their normals with the surface;
// - the viaduct (subway.js) stands its piers and abutments on it, the subway ride (subway-ride.js) puts Castle Frank's
//   and Broadview's platforms at their depth below the street.
// Outside the playable city (north of its edge) a terrain patch on the same grid carries the valley on.
const C = window.CITY;
const D = C.DON_VALLEY_DATA;
if (!D) return;
const { box, nx, nz } = D;
const S = box.step;
const grid = (b64, scale) => {
  const bin = typeof atob === 'function' ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(b64, 'base64'));
  const q = new Int16Array(bin.buffer, 0, bin.length >> 1), out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] / scale;
  return out;
};
const H = grid(D.height, 100);
const inBox = (x, z) => x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1;

// The cell and triangle under (x, z): corners a (c, r), b (c+1, r), d (c, r+1), e (c+1, r+1); the lower triangle
// (a, d, b) where tx + tz <= 1, else (b, d, e)
function cellOf(x, z) {
  const fc = (x - box.x0) / S, fr = (z - box.z0) / S;
  const c = Math.min(Math.max(Math.floor(fc), 0), nx - 2), r = Math.min(Math.max(Math.floor(fr), 0), nz - 2);
  return { c, r, tx: fc - c, tz: fr - r };
}
/** The valley's height above the street datum at (x, z) (<= 0; 0 outside the pilot box) */
function heightAt(x, z) {
  if (!inBox(x, z)) return 0;
  const { c, r, tx, tz } = cellOf(x, z), k = r * nx + c;
  const ha = H[k], hb = H[k + 1], hd = H[k + nx], he = H[k + nx + 1];
  return tx + tz <= 1 ? ha + (hb - ha) * tx + (hd - ha) * tz : he + (hd - he) * (1 - tx) + (hb - he) * (1 - tz);
}
/** The surface's slope at (x, z): [dh/dx, dh/dz] (its triangle's) */
function gradientAt(x, z) {
  if (!inBox(x, z)) return [0, 0];
  const { c, r, tx, tz } = cellOf(x, z), k = r * nx + c;
  const ha = H[k], hb = H[k + 1], hd = H[k + nx], he = H[k + nx + 1];
  return tx + tz <= 1 ? [(hb - ha) / S, (hd - ha) / S] : [(he - hd) / S, (he - hb) / S];
}
/** The lowest ground within `r` of (x, z) (a footing's foot) */
function lowestAround(x, z, r) {
  let lo = heightAt(x, z);
  for (let a = 0; a < 12; a++) for (const f of [0.5, 1]) lo = Math.min(lo, heightAt(x + Math.cos(a * Math.PI / 6) * r * f, z + Math.sin(a * Math.PI / 6) * r * f));
  return lo;
}

// --- the viaduct's road deck: Bloor Street & Danforth Avenue over the valley stand DECK_TOP above the datum, level
// with the streets either side (the real deck meets the tableland at both ends); off the valley (the ramps' old climbs
// to the flat city's 22.5 m deck) they are the street again. The other decks in the box (the ramps down the valley's
// sides) hug the ground 0.35 m up, a road on its own surface over the parkland islands.
const V = D.diagnostics.viaduct;
const VA = { x: V.from[0], z: V.from[1] }, VB = { x: V.to[0], z: V.to[1] };
const VL = Math.hypot(VB.x - VA.x, VB.z - VA.z), VU = { x: (VB.x - VA.x) / VL, z: (VB.z - VA.z) / VL };
function onViaductLine(x, z, reach = 16) {
  const a = (x - VA.x) * VU.x + (z - VA.z) * VU.z, l = -(x - VA.x) * VU.z + (z - VA.z) * VU.x;
  return a > -140 && a < VL + 140 && Math.abs(l) < reach;
}
const HUG = 0.35;
/** A deck or raised road's height at (x, z), given its height `h` in the flat city (> 0) */
function deckHeight(x, z, h) {
  if (!inBox(x, z)) return h;
  const g = heightAt(x, z);
  if (onViaductLine(x, z)) {
    // over the valley: the road deck; within ~10 m of where the ground comes up to the street: ramped to it
    const low = Math.min(g, lowestAround(x, z, 10));
    return low < -0.3 ? D.deckTop * Math.min(1, -low / 1.5) : 0;
  }
  return g < -0.3 ? g + HUG : 0;
}
/** A street graph node's height (road-network.js): its deck's, or the ground's */
function roadHeight(x, z, h) {
  if (!inBox(x, z)) return h;
  return h > 0 ? deckHeight(x, z, h) : h + heightAt(x, z);
}

// ---------------------------------------------------------------------------------------------------------------------
// drape(mesh): the static ground meshes split along the grid and lowered onto the valley
// ---------------------------------------------------------------------------------------------------------------------
// A polygon is [{ x, z, w: [w0, w1, w2] }] (barycentric weights in its source triangle); clip keeps the side where
// nx * x + nz * z >= c
function clip(poly, nxv, nzv, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = nxv * a.x + nzv * a.z - c, db = nxv * b.x + nzv * b.z - c;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, w: [0, 1, 2].map((i) => a.w[i] + (b.w[i] - a.w[i]) * t) });
    }
  }
  return out;
}
const area2 = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.z - b.x * a.z; } return s; };
// Splits polygon `poly` (inside the box) into pieces on which heightAt is linear: by column, row and diagonal
function gridPieces(poly, emit) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const c0 = Math.max(0, Math.floor((minX - box.x0) / S)), c1 = Math.min(nx - 2, Math.floor((maxX - box.x0) / S - 1e-9));
  const r0 = Math.max(0, Math.floor((minZ - box.z0) / S)), r1 = Math.min(nz - 2, Math.floor((maxZ - box.z0) / S - 1e-9));
  for (let c = c0; c <= c1; c++) {
    const xa = box.x0 + c * S;
    let strip = poly;
    if (c > c0) strip = clip(strip, 1, 0, xa);
    if (c < c1) strip = clip(strip, -1, 0, -(xa + S));
    if (strip.length < 3) continue;
    for (let r = r0; r <= r1; r++) {
      const za = box.z0 + r * S;
      let cell = strip;
      if (r > r0) cell = clip(cell, 0, 1, za);
      if (r < r1) cell = clip(cell, 0, -1, -(za + S));
      if (cell.length < 3) continue;
      // the diagonal: (x - xa) + (z - za) = S
      const lower = clip(cell, -1, -1, -(xa + za + S)), upper = clip(cell, 1, 1, xa + za + S);
      if (lower.length >= 3 && Math.abs(area2(lower)) > 1e-6) emit(lower);
      if (upper.length >= 3 && Math.abs(area2(upper)) > 1e-6) emit(upper);
    }
  }
}
function drapeMesh(mesh, stats) {
  const g = mesh.geometry;
  if (!g || mesh.isInstancedMesh || mesh.isSkinnedMesh || g.userData.donValley || g.morphAttributes?.position) return null;
  // (one material: its geometry's groups, if any, are moot)
  if (Array.isArray(mesh.material)) { stats.skipped.push(`${mesh.name || '(mesh)'}: several materials`); return null; }
  mesh.updateMatrixWorld(true);
  const e = mesh.matrixWorld.elements;
  // (ground meshes are built in world coordinates: an identity transform, or one that only moves them)
  if (Math.abs(e[0] - 1) + Math.abs(e[5] - 1) + Math.abs(e[10] - 1) + Math.abs(e[1]) + Math.abs(e[2]) + Math.abs(e[4]) + Math.abs(e[6]) + Math.abs(e[8]) + Math.abs(e[9]) > 1e-6) {
    stats.skipped.push(`${mesh.name || '(mesh)'}: turned or scaled`); return null;
  }
  const ox = e[12], oy = e[13], oz = e[14];
  const pos = g.attributes.position, idx = g.index;
  const nTri = (idx ? idx.count : pos.count) / 3;
  const vi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  const keep = [], hit = [];
  for (let t = 0; t < nTri; t++) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < 3; k++) { const i = vi(t, k), x = pos.getX(i) + ox, z = pos.getZ(i) + oz; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    if (maxX <= box.x0 || minX >= box.x1 || maxZ <= box.z0 || minZ >= box.z1) keep.push(vi(t, 0), vi(t, 1), vi(t, 2));
    else hit.push(t);
  }
  if (!hit.length) return null;
  // the pieces' vertices, every attribute interpolated
  const names = Object.keys(g.attributes);
  const out = Object.fromEntries(names.map((n) => [n, []]));
  const normal = g.attributes.normal;
  const push = (t, p) => {
    for (const n of names) {
      const A = g.attributes[n], s = A.itemSize;
      for (let j = 0; j < s; j++) {
        let v = 0;
        for (let k = 0; k < 3; k++) if (p.w[k]) v += A.getComponent(vi(t, k), j) * p.w[k];
        out[n].push(v);
      }
    }
    const P = out.position, base = P.length - 3, wx = P[base] + ox, wz = P[base + 2] + oz;
    const h = inBox(wx, wz) ? heightAt(wx, wz) : 0;
    P[base + 1] += h;
    if (normal) {
      // the vertical shear y += h(x, z) carries a normal n to (nx - gx ny, ny, nz - gz ny)
      const N = out.normal, b = N.length - 3, [gx, gz] = p.grad;
      const x = N[b] - gx * N[b + 1], y = N[b + 1], z = N[b + 2] - gz * N[b + 1], l = Math.hypot(x, y, z) || 1;
      N[b] = x / l; N[b + 1] = y / l; N[b + 2] = z / l;
    }
  };
  let pieces = 0;
  for (const t of hit) {
    let poly = [0, 1, 2].map((k) => { const i = vi(t, k); return { x: pos.getX(i) + ox, z: pos.getZ(i) + oz, w: [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0] }; });
    // a vertical face (a kerb, a wall): its vertices share x and z in pairs; split it by the grid lines all the same
    const flat = Math.abs(area2(poly)) < 1e-6;
    const emit = (piece) => {
      const cx = piece.reduce((s, p) => s + p.x, 0) / piece.length, cz = piece.reduce((s, p) => s + p.z, 0) / piece.length;
      const grad = inBox(cx, cz) ? gradientAt(cx, cz) : [0, 0];
      for (let i = 1; i + 1 < piece.length; i++) for (const p of [piece[0], piece[i], piece[i + 1]]) { p.grad = grad; push(t, p); }
      pieces++;
    };
    if (flat) {
      // split along its length at every grid line it crosses (x, z and diagonal), each part a quad of the original
      // triangle's (s, t) parameters: interpolate in the triangle's own plane by its two distinct (x, z) ends
      verticalPieces(poly, emit);
      continue;
    }
    // inside the box: by the grid; the parts outside it stay as they are (flat: no height there)
    let rest = poly;
    for (const [a, b, c] of [[1, 0, box.x0], [-1, 0, -box.x1], [0, 1, box.z0], [0, -1, -box.z1]]) {
      const outside = clip(rest, -a, -b, -c);
      if (outside.length >= 3 && Math.abs(area2(outside)) > 1e-6) emit(outside);
      rest = clip(rest, a, b, c);
      if (rest.length < 3) break;
    }
    if (rest.length >= 3) gridPieces(rest, emit);
  }
  const geo = new C.THREE.BufferGeometry();
  for (const n of names) {
    const A = g.attributes[n];
    const arr = new (A.array.constructor === Float64Array ? Float64Array : A.array.constructor === Float32Array ? Float32Array : A.array.constructor)(out[n]);
    geo.setAttribute(n, new C.THREE.BufferAttribute(arr, A.itemSize, A.normalized));
  }
  geo.userData.donValley = true;
  // the source keeps its other triangles
  g.setIndex(keep);
  g.clearGroups();
  if (!keep.length) mesh.visible = false; // (wholly re-made: nothing left to draw)
  g.userData.donValley = true;
  const m = new C.THREE.Mesh(geo, mesh.material);
  m.name = `${mesh.name || 'Ground'}_DonValley`;
  m.position.copy(mesh.position); m.quaternion.copy(mesh.quaternion); m.scale.copy(mesh.scale);
  m.castShadow = mesh.castShadow; m.receiveShadow = mesh.receiveShadow; m.renderOrder = mesh.renderOrder;
  m.layers.mask = mesh.layers.mask; m.frustumCulled = mesh.frustumCulled; m.visible = mesh.visible;
  Object.assign(m.userData, mesh.userData);
  mesh.parent.add(m);
  stats.meshes++; stats.triangles += hit.length; stats.pieces += pieces;
  return m;
}
// A vertical triangle (a wall face): its (x, z) footprint is a segment; split it where the segment crosses the grid's
// lines and diagonals. Each part is the triangle clipped by planes across the segment (a clip in "along" only).
function verticalPieces(tri, emit) {
  // the footprint's two ends
  let a = tri[0], b = tri[0], best = -1;
  for (const p of tri) for (const q of tri) { const d = Math.hypot(p.x - q.x, p.z - q.z); if (d > best) { best = d; a = p; b = q; } }
  if (best < 1e-6 || !(Math.max(a.x, b.x) > box.x0 && Math.min(a.x, b.x) < box.x1 && Math.max(a.z, b.z) > box.z0 && Math.min(a.z, b.z) < box.z1)) { emit(tri); return; }
  const ux = (b.x - a.x) / best, uz = (b.z - a.z) / best;
  // the parameters along the segment where it crosses a grid line or diagonal
  const cuts = [];
  const cross = (f0, f1, step, off) => { // f linear along the segment: crossings of f = off + k step
    if (Math.abs(f1 - f0) < 1e-9) return;
    for (let k = Math.ceil((Math.min(f0, f1) - off) / step); off + k * step < Math.max(f0, f1); k++) cuts.push(((off + k * step) - f0) / (f1 - f0) * best);
  };
  cross(a.x, b.x, S, box.x0); cross(a.z, b.z, S, box.z0); cross(a.x + a.z, b.x + b.z, S, box.x0 + box.z0);
  cuts.sort((p, q) => p - q);
  let rest = tri;
  for (const s of cuts) {
    const c = a.x * ux + a.z * uz + s;
    const piece = clip(rest, -ux, -uz, -c); // along <= s
    if (piece.length >= 3) emit(piece);
    rest = clip(rest, ux, uz, c);
    if (rest.length < 3) return;
  }
  if (rest.length >= 3) emit(rest);
}
/** Drapes every static mesh under `root` (skipping names matching `except`) over the valley */
function drape(root, { except = null } = {}) {
  const stats = { meshes: 0, triangles: 0, pieces: 0, skipped: [] };
  if (!root) return stats;
  const list = [];
  root.traverse((o) => { if (o.isMesh && !(except && except.test(o.name || ''))) list.push(o); });
  for (const m of list) drapeMesh(m, stats);
  return stats;
}

// ---------------------------------------------------------------------------------------------------------------------
// Beyond the city's edge, the valley's terrain; in it, the river's water where the street level opens over it; the
// buildings' plinths where the valley falls away from them
// ---------------------------------------------------------------------------------------------------------------------
function patchGeometry(x0, z0, x1, z1, yAt, keepCell = null) {
  const cx = Math.round((x1 - x0) / S), cz = Math.round((z1 - z0) / S);
  const pos = [], nrm = [], uvs = [];
  const P = (x, z) => [x, yAt(x, z), z];
  for (let r = 0; r < cz; r++) for (let c = 0; c < cx; c++) {
    const xa = x0 + c * S, za = z0 + r * S;
    if (keepCell && !keepCell(xa, za)) continue;
    const a = P(xa, za), b = P(xa + S, za), d = P(xa, za + S), e = P(xa + S, za + S);
    for (const tri of [[a, d, b], [b, d, e]]) {
      const [p, q, s] = tri;
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = s[0] - p[0], vy = s[1] - p[1], vz = s[2] - p[2];
      let nx_ = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz_ = ux * vy - uy * vx;
      const l = Math.hypot(nx_, ny, nz_) || 1;
      if (ny < 0) { nx_ = -nx_; ny = -ny; nz_ = -nz_; }
      for (const v of tri) { pos.push(...v); nrm.push(nx_ / l, ny / l, nz_ / l); uvs.push(v[0] / 8, v[2] / 8); }
    }
  }
  if (!pos.length) return null;
  const g = new C.THREE.BufferGeometry();
  g.setAttribute('position', new C.THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new C.THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new C.THREE.Float32BufferAttribute(uvs, 2));
  return g;
}
function buildPatches(scene) {
  const { THREE, CITY_BOUNDS: B } = C;
  const group = new THREE.Group(); group.name = 'DonValley';
  // north of the city's edge: the terrain (terrain.js leaves its cells in the box out), the valley cut into it
  const zEdge = Math.min(box.z1, B.minZ);
  if (box.z0 < zEdge) {
    const g = patchGeometry(box.x0, box.z0, box.x1, zEdge, (x, z) => Math.max(0, C.terrainRawAt(x, z)) + heightAt(x, z));
    if (g) {
      const m = new THREE.Mesh(g, C.createTerrainMaterial()); m.name = 'DonValleyTerrain'; m.receiveShadow = true; m.castShadow = true;
      group.add(m);
    }
  }
  // the Don itself: water 0.7 m under the valley floor wherever the street level opens over it (its water mask)
  const water = patchGeometry(box.x0, Math.max(box.z0, B.minZ), box.x1, box.z1, (x, z) => heightAt(x, z) + B.waterLevel,
    (x, z) => [[0, 0], [S, 0], [0, S], [S, S], [S / 2, S / 2]].some(([dx, dz]) => C.waterAt(x + dx, z + dz)));
  if (water) {
    const m = new THREE.Mesh(water, C.createWaterMaterial()); m.name = 'DonValleyRiver'; m.receiveShadow = true;
    group.add(m);
  }
  // plinths: concrete foundation walls from the lowest ground under a building up to its street-level base
  const concrete = [];
  const byCentre = new Map((C.GEO.buildings || []).map((b) => [`${b[0]},${b[1]}`, b]));
  let plinths = 0;
  for (const [bx, bz, y0] of D.plinths || []) {
    const b = byCentre.get(`${bx},${bz}`);
    if (!b) continue;
    const [, , ang, parts] = b;
    for (const [u0, u1, v0, v1] of parts) {
      const geo = new THREE.BoxGeometry(u1 - u0, 0.05 - (y0 - 0.4), v1 - v0);
      // (local u, v as city-config.js: u = dx cos - dz sin, v = dx sin + dz cos; so a box turned by -ang about y)
      geo.translate((u0 + u1) / 2, (0.05 + y0 - 0.4) / 2, (v0 + v1) / 2);
      geo.rotateY(ang);
      geo.translate(bx, 0, bz);
      concrete.push(geo.toNonIndexed());
    }
    plinths++;
  }
  if (concrete.length) {
    const m = new THREE.Mesh(C.Addons.mergeGeometries(concrete), new THREE.MeshStandardNodeMaterial({ color: 0x9d968a, roughness: 0.9 }));
    m.name = 'DonValleyPlinths'; m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  scene.add(group);
  return { group, plinths };
}

/** The pilot's platform depths (js/toronto-subway-topology.js facts, depth.donValley), by station id */
function platformFloor(id) {
  const st = C.SUBWAY_TOPOLOGY?.stations?.find((s) => s.id === id);
  return st?.facts?.depth?.donValley?.platformFloor?.value ?? null;
}

C.DON_VALLEY = { data: D, box, step: S, heightAt, gradientAt, lowestAround, inBox, deckHeight, roadHeight, onViaductLine,
  drape, drapeMesh, buildPatches, platformFloor, deckTop: D.deckTop, railY: D.railY };
console.info(`[don-valley] pilot on: ${nx} x ${nz} at ${S} m over x ${box.x0}..${box.x1}, z ${box.z0}..${box.z1}; deepest ${D.diagnostics.deepestM} m`);
})();
