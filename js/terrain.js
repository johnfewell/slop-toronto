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

function buildTerrain(scene) {
  const group = new THREE.Group();
  group.name = 'Terrain';
  const mat = createTerrainMaterial();
  const T = GEO.terrain;
  const tx1 = T.x0 + (T.n - 1) * T.step, tz1 = T.z0 + (T.n - 1) * T.step;
  const inDetail = (x, z) => x > CITY_BOUNDS.minX && x < CITY_BOUNDS.maxX && z > CITY_BOUNDS.minZ && z < CITY_BOUNDS.maxZ;
  const SUNK = -3.0;
  const LAKE_BED = -25.0;
  const heightAt = (x, z) => {
    const h = terrainRawAt(x, z);
    // Lake Ontario & the other water: the build marks its cells -30 m. The bed lies 25 m down, so the stylized water
    // reads deep offshore; the 60 m grid shelves it from the shore (its shallow colour shows only near the banks)
    if (h < -1) return LAKE_BED;
    if (inDetail(x, z)) return h > 0.05 ? h : SUNK;
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
