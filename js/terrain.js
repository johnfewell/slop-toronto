(function () {
// js/terrain.js
// The land around and inside Abuja at true 1:1 scale, from the SRTM-derived terrain in GEO.terrain (heights above the
// local plain, see tools/geo-terrain.mjs): Aso Rock's granite dome over the Three Arms Zone, the Katampe & Mpape
// ridges, the hills closing every horizon, and the savanna plains between them.
// - Near: a 60 m grid over the detailed city and 3 km around it. Inside the detailed city the street level (asphalt,
//   city-grid.js) is the ground: only the hills rising above it show (the rest of the grid sinks out of sight under it).
// - Far: a 240 m grid out to ±26 km (a hole where the near grid lies), then a flat plain to the fogged horizon.

const { THREE } = window.CITY;
const { GEO, CITY_BOUNDS, terrainRawAt } = window.CITY;
const { createTerrainMaterial } = window.CITY;

// GEO.waterMask (row runs of 4 m cells, dry / wet from dry: city-grid.js maskedByWater) as a coarse grid of `C` m cells
// that hold any water, and every water body's outline & inside (the mask leaves out some of the narrow rivers' cells)
// but the lake's (its bed is the terrain's own, LAKE_BED); near(x, z, r): any such cell within r of (x, z)
function wetGrid(M, C, bodies = []) {
  const bin = atob(M.runs);
  const f = Math.max(1, Math.round(C / M.res)), w = Math.ceil(M.w / f), h = Math.ceil(M.h / f), cells = new Uint8Array(w * h);
  let k = 0;
  for (let j = 0; j < M.h; j++) {
    let i = 0, v = 0;
    while (i < M.w) {
      const n = bin.charCodeAt(2 * k) | (bin.charCodeAt(2 * k + 1) << 8);
      k++;
      if (v && n) for (let c = Math.floor(i / f); c <= Math.floor((i + n - 1) / f); c++) cells[Math.floor(j / f) * w + c] = 1;
      i += n;
      v ^= 1;
    }
    if (v === 0 && k < bin.length / 2 && (bin.charCodeAt(2 * k) | (bin.charCodeAt(2 * k + 1) << 8)) === 0) k++;
  }
  const cs = f * M.res;
  const mark = (x, z) => {
    const c = Math.floor((x - M.x0) / cs), r = Math.floor((z - M.z0) / cs);
    if (c >= 0 && r >= 0 && c < w && r < h) cells[r * w + c] = 1;
  };
  for (const b of bodies) {
    if ((b.maxX - b.minX) * (b.maxZ - b.minZ) > 4e8) continue; // (the lake)
    for (const P of [b.pts]) {
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const a = P[j], e = P[i], n = Math.ceil(Math.hypot(e.x - a.x, e.z - a.z) / (cs / 2)) || 1;
        for (let k = 0; k <= n; k++) mark(a.x + ((e.x - a.x) * k) / n, a.z + ((e.z - a.z) * k) / n);
      }
    }
    for (let x = Math.floor(b.minX / cs) * cs + cs / 2; x < b.maxX; x += cs) {
      for (let z = Math.floor(b.minZ / cs) * cs + cs / 2; z < b.maxZ; z += cs) if (window.CITY.pointInPoly(b.pts, x, z)) mark(x, z);
    }
  }
  return {
    near(x, z, r) {
      const c0 = Math.max(0, Math.floor((x - r - M.x0) / cs)), c1 = Math.min(w - 1, Math.floor((x + r - M.x0) / cs));
      const r0 = Math.max(0, Math.floor((z - r - M.z0) / cs)), r1 = Math.min(h - 1, Math.floor((z + r - M.z0) / cs));
      for (let rr = r0; rr <= r1; rr++) for (let c = c0; c <= c1; c++) if (cells[rr * w + c]) return true;
      return false;
    }
  };
}

function buildTerrain(scene) {
  const group = new THREE.Group();
  group.name = 'Terrain';
  const mat = createTerrainMaterial();
  const T = GEO.terrain;
  const tx1 = T.x0 + (T.n - 1) * T.step, tz1 = T.z0 + (T.n - 1) * T.step;
  const inDetail = (x, z) => x > CITY_BOUNDS.minX && x < CITY_BOUNDS.maxX && z > CITY_BOUNDS.minZ && z < CITY_BOUNDS.maxZ;
  const SUNK = -3.0;
  const BAND = window.CITY.FAR_BAND, BAND_FLOOR = -0.6;
  // (within 60 m of the band's water the floor stands just under the water's level, not over it: a pond or river there
  // was drawn under it, st-bz1o.13. Only a little under, so the far city's painted ground beyond the band's reach keeps
  // its level and the water shows in its own outline; the relief's low swells by the water are flattened to it too)
  const bandWet = BAND && GEO.waterMask ? wetGrid(GEO.waterMask, 20, window.CITY.WATER_BODIES || []) : null;
  const BAND_WET_FLOOR = CITY_BOUNDS.waterLevel - 0.15;
  // the terrain pilots' boxes (js/don-valley.js builds the Don Valley's own terrain there, on its finer grid; in High
  // Park's the city's ground is the terrain, and the 60 m SRTM grid's canopy mounds no longer poke through its lawn)
  const PILOT = window.CITY.DON_VALLEY || null, DVB = PILOT ? (PILOT.boxes || [PILOT.box]) : null;
  const LAKE_BED = -25.0;
  const heightAt = (x, z) => {
    const h = terrainRawAt(x, z);
    // Lake Ontario & the other water: the build marks its cells -30 m. The bed lies 25 m down, so the stylized water
    // reads deep offshore; the 60 m grid shelves it from the shore (its shallow colour shows only near the banks)
    if (h < -1) return LAKE_BED;
    // (a bigger map's far band, city-config.js FAR_BAND: the ground just under the street level, painted with the far
    // city like the land beyond, for when scene-culling.js hides the band's own ground in the distance)
    if (BAND && BAND.inBand(x, z)) {
      // (by the water the 60 m relief's low swells, under 3 m, go too: the valleys' rivers lie in it, st-bz1o.13)
      if (h < 3 && bandWet && bandWet.near(x, z, 60)) return BAND_WET_FLOOR;
      if (!(h > 0.05)) return BAND_FLOOR;
    }
    if (inDetail(x, z)) return h > 0.05 && !(PILOT && PILOT.clearsTerrainAt && PILOT.clearsTerrainAt(x, z)) ? h : SUNK;
    return Math.max(0, h);
  };

  // A regular grid mesh over [x0, x1] x [z0, z1]; `skip(x, z)` cells (all four corners) are left out
  function gridMesh(x0, z0, x1, z1, step, yAt, skip = null) {
    const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
    const pos = new Float32Array(nx * nz * 3);
    for (let r = 0; r < nz; r++) {
      for (let c = 0; c < nx; c++) {
        const x = x0 + c * step, z = z0 + r * step;
        const k = (r * nx + c) * 3;
        pos[k] = x;
        pos[k + 1] = yAt(x, z);
        pos[k + 2] = z;
      }
    }
    const idx = [];
    for (let r = 0; r + 1 < nz; r++) {
      for (let c = 0; c + 1 < nx; c++) {
        const a = r * nx + c, b = a + 1, d = a + nx, e = d + 1;
        if (skip) {
          const xa = x0 + c * step, za = z0 + r * step;
          if (skip(xa, za) && skip(xa + step, za) && skip(xa, za + step) && skip(xa + step, za + step)) continue;
        }
        // the terrain pilots' boxes (above)
        if (DVB) {
          const xa = x0 + c * step, za = z0 + r * step;
          if (DVB.some((B) => xa >= B.x0 && xa + step <= B.x1 && za >= B.z0 && za + step <= B.z1)) continue;
        }
        // all corners sunk under the street level: nothing to see
        if (pos[a * 3 + 1] === SUNK && pos[b * 3 + 1] === SUNK && pos[d * 3 + 1] === SUNK && pos[e * 3 + 1] === SUNK) continue;
        idx.push(a, d, b, b, d, e);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nx * nz * 2), 2));
    g.setIndex(nx * nz > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
  }

  // Near grid: the detailed city + 3 km
  const M = 3000;
  const nx0 = Math.max(T.x0, Math.floor((CITY_BOUNDS.minX - M) / 60) * 60), nx1 = Math.min(tx1, Math.ceil((CITY_BOUNDS.maxX + M) / 60) * 60);
  const nz0 = Math.max(T.z0, Math.floor((CITY_BOUNDS.minZ - M) / 60) * 60), nz1 = Math.min(tz1, Math.ceil((CITY_BOUNDS.maxZ + M) / 60) * 60);
  const near = new THREE.Mesh(gridMesh(nx0, nz0, nx1, nz1, 60, heightAt), mat);
  near.name = 'TerrainNear';
  near.receiveShadow = true;
  near.castShadow = true;
  group.add(near);
  // The near grid's drawn height at (x, z): its triangles (a, d, b) and (b, d, e) interpolate the 60 m corners, which is
  // not terrainHeightAt's finer lookup. Prepared surfaces cut into it (rinks.js) wall their edge up to this height
  window.CITY.terrainNearHeightAt = (x, z) => {
    const fc = (x - nx0) / 60, fr = (z - nz0) / 60;
    const c = Math.min(Math.max(Math.floor(fc), 0), Math.round((nx1 - nx0) / 60) - 1), r = Math.min(Math.max(Math.floor(fr), 0), Math.round((nz1 - nz0) / 60) - 1);
    const tx = fc - c, tz = fr - r, xa = nx0 + c * 60, za = nz0 + r * 60;
    const ha = heightAt(xa, za), hb = heightAt(xa + 60, za), hd = heightAt(xa, za + 60), he = heightAt(xa + 60, za + 60);
    return tx + tz <= 1 ? ha + (hb - ha) * tx + (hd - ha) * tz : he + (hd - he) * (1 - tx) + (hb - he) * (1 - tz);
  };

  // Far grid: everything else the terrain data covers (sunk a little under the near grid where they overlap)
  const inNear = (x, z) => x >= nx0 && x <= nx1 && z >= nz0 && z <= nz1;
  const far = new THREE.Mesh(gridMesh(T.x0, T.z0, tx1, tz1, 240, (x, z) => (inNear(x, z) ? -6 : heightAt(x, z) - 0.5), inNear), mat);
  far.name = 'TerrainFar';
  far.receiveShadow = true;
  group.add(far);

  // The plain beyond, to the horizon (the camera's far plane is 60 km)
  {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 70000, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.moveTo(T.x0 + 200, -(T.z0 + 200));
    hole.lineTo(tx1 - 200, -(T.z0 + 200));
    hole.lineTo(tx1 - 200, -(tz1 - 200));
    hole.lineTo(T.x0 + 200, -(tz1 - 200));
    hole.closePath();
    shape.holes.push(hole);
    const g = new THREE.ShapeGeometry(shape, 48);
    g.rotateX(-Math.PI / 2);
    g.translate(0, -1.0, 0);
    const plain = new THREE.Mesh(g, mat);
    plain.name = 'TerrainPlain';
    plain.receiveShadow = true;
    group.add(plain);
  }

  scene.add(group);
  return { group, colliders: [], update: null };
}

Object.assign(window.CITY, { buildTerrain });
})();
