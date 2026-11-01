(function () {
// js/landmarks.js
// Abuja's landmarks on their real OpenStreetMap outlines (city-config.js LANDMARK_SITES):
// - Abuja National Mosque (1984): the prayer hall under its gilded main dome, four minarets at the corners
// - National Christian Centre (2005): the white hall with tall pointed (neo-Gothic) windows
// - Millennium Tower: three cylindrical concrete pillars of differing heights (roof 170 m) joined by the disc of the
//   observation deck near the first peak, three stainless-steel wings fanning out from the base
// - National Assembly: the white building under its green dome, in the Three Arms Zone
// - Eagle Square: the paved parade square with the national flag
// - Unity Fountain, the World Trade Center towers, the Central Bank, Transcorp Hilton and the other mapped buildings,
//   extruded from their outlines to their mapped heights
// Where the record gives no dimension (the mosque's minarets & dome, the Millennium Tower's lower pillars & disc, the
// Assembly's dome) the model's proportions are estimates; see the README.

const { THREE } = window.CITY;
const { mergeGeometries } = window.CITY.Addons;
const { Fn, float, color, positionWorld, positionGeometry, smoothstep, step, abs, fract, mix, max, min, sin, normalWorldGeometry } = window.CITY.TSL;
const { GEO, LANDMARK_SITES, CITY_BOUNDS, createExtrudedPolygonMesh, createFlatPolygonMesh } = window.CITY;
const { createCurtainWallMaterial, createRenderedFacadeMaterial, createFacadeBoxes, WALL_KINDS, createWaterMaterial } = window.CITY;

const ringPts = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
};
const linear = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

// White render with tall pointed-arch windows every 4 m (the Christian Centre's neo-Gothic hall)
function createGothicHallMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.7 });
  mat.colorNode = Fn(() => {
    const p = positionWorld;
    const u = fract(p.x.add(p.z).div(4.0)).sub(0.5).abs(); // across each bay
    const y = p.y;
    const shaft = step(u, 0.13).mul(step(2.5, y)).mul(step(y, 15.0));
    // pointed arch: the window narrows over its top 2.5 m
    const arch = step(u, float(0.13).mul(smoothstep(17.5, 15.0, y))).mul(step(15.0, y)).mul(step(y, 17.5));
    const win = max(shaft, arch).mul(step(normalWorldGeometry.y, 0.5));
    const wall = mix(color(0xf3f1ea), color(0xe6e2d8), smoothstep(0.0, 1.5, y).oneMinus().mul(0.5));
    return mix(wall, color(0x2a3a52), win);
  })();
  return mat;
}

// =====================================================================================================================
// UNION STATION'S TRAIN SHED: an override for the south half of the Union Station massing. The City's 3D Massing models
// the shed (a 1930 Bush shed over the platforms, with a glass atrium over its middle since 2018) as one solid 9 m block
// down to the street, which buried the platforms and the GO trains up on the embankment. Its triangles are dropped from
// the massing (unionShedKeep) and the shed is built open instead (buildUnionTrainShed): low roof bays running along the
// tracks, each sloping up to a smoke slot over a track, on slim steel columns standing on platforms between the tracks,
// open along the sides and at both ends; a pitched glass atrium across the middle, on the Great Hall's axis. It is laid
// out from the tracks themselves (GEO.rails), so no column or platform ever stands on a track.
// =====================================================================================================================
const UNION_SHED = {
  x0: -120, x1: 120, // between the York St and Bay St rail bridges (the streets & their abutments stay open)
  z0: 40.8, z1: 127, // from the head house's south wall to past the last track
  atrium: 24, // the atrium's half width, about x = 0
  bed: 6.2, // the track bed up on the embankment (city-config.js railLiftAt: Union's fill)
  low: 13.4, high: 14.5, deck: 0.3, // a bay's valley (over a platform) & its slot edges (over a track), roof thickness
  slot: 0.7, // the smoke slot's half width over each track
  platform: 0.75, edge: 1.85, // platform top above the track bed; its edge from a track's centre line
  ridge: 20 // the atrium's ridge
};

// The massing's triangles to keep: everything but the shed (wholly south of the head house's south wall, under 11.5 m)
function unionShedKeep(pos, idx) {
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    let shed = true, far = false;
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k] * 3, y = pos[v + 1], z = pos[v + 2];
      if (y > 11.5 || z < 36) shed = false;
      if (z > 40.6) far = true;
    }
    if (!(shed && far)) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  return new Uint32Array(keep);
}

function buildUnionTrainShed(group, colliders) {
  const U = UNION_SHED;
  // the heavy-rail tracks' centre lines across the shed: sorted z at a given x
  const segs = [];
  for (const [kind, , , , flat] of GEO.rails || []) {
    if (kind !== 1) continue;
    for (let i = 2; i < flat.length; i += 2) {
      const ax = flat[i - 2], az = flat[i - 1], bx = flat[i], bz = flat[i + 1];
      if (Math.max(ax, bx) < U.x0 - 10 || Math.min(ax, bx) > U.x1 + 10 || Math.max(az, bz) < U.z0 || Math.min(az, bz) > U.z1) continue;
      segs.push([ax, az, bx, bz]);
    }
  }
  const tracksAt = (x) => {
    const zs = [];
    for (const [ax, az, bx, bz] of segs) {
      if ((ax - x) * (bx - x) > 0 || ax === bx) continue;
      const z = az + ((x - ax) / (bx - ax)) * (bz - az);
      if (z > U.z0 + 2 && z < U.z1 - 2 && !zs.some((q) => Math.abs(q - z) < 1)) zs.push(z);
    }
    return zs.sort((a, b) => a - b);
  };
  const n = tracksAt(0).length;
  if (!n) return;
  // stations along the shed every 8 m (and at the atrium's edges); where a crossover muddles the count, the last good one
  const xs = [];
  for (let x = U.x0; x < U.x1; x += 8) xs.push(x);
  xs.push(U.x1, -U.atrium, U.atrium);
  xs.sort((a, b) => a - b);
  let last = tracksAt(0);
  const st = xs.filter((x, i) => i === 0 || x - xs[i - 1] > 0.5).map((x) => {
    const t = tracksAt(x);
    if (t.length === n) last = t;
    return { x, t: last };
  });

  // the roof's cross-section at a station: runs of (z, y) between the slots, the bays low over the platforms
  const profile = (t) => {
    const runs = [];
    runs.push([[U.z0, U.low], [t[0] - U.slot, U.high]]); // the north bay hangs off the head house
    for (let i = 0; i + 1 < n; i++) {
      const a = t[i] + U.slot, b = t[i + 1] - U.slot;
      if (b - a < 0.5) continue;
      runs.push([[a, U.high], [(a + b) / 2, b - a > 4 ? U.low : U.high - 0.3], [b, U.high]]);
    }
    runs.push([[t[n - 1] + U.slot, U.high], [U.z1, U.low]]); // the south eave
    return runs;
  };
  const roof = [], under = [], steelParts = [], slabs = [];
  const quad = (out, a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  const D = U.deck;
  for (let s = 0; s + 1 < st.length; s++) {
    const A = st[s], B = st[s + 1];
    if (A.x >= -U.atrium && B.x <= U.atrium) continue; // the atrium's span
    const pa = profile(A.t), pb = profile(B.t);
    for (let r = 0; r < pa.length; r++) {
      const ra = pa[r], rb = pb[r];
      for (let k = 0; k + 1 < ra.length; k++) {
        const [za0, ya0] = ra[k], [za1, ya1] = ra[k + 1], [zb0, yb0] = rb[k], [zb1, yb1] = rb[k + 1];
        quad(roof, [A.x, ya0, za0], [A.x, ya1, za1], [B.x, yb1, zb1], [B.x, yb0, zb0]); // top, facing up
        quad(under, [A.x, ya0 - D, za0], [B.x, yb0 - D, zb0], [B.x, yb1 - D, zb1], [A.x, ya1 - D, za1]); // soffit
      }
      // the slot's (and the eaves') edges
      for (const [k, sgn] of [[0, -1], [ra.length - 1, 1]]) {
        const [za, ya] = ra[k], [zb, yb] = rb[k];
        if (sgn < 0) quad(roof, [A.x, ya, za], [B.x, yb, zb], [B.x, yb - D, zb], [A.x, ya - D, za]);
        else quad(roof, [A.x, ya, za], [A.x, ya - D, za], [B.x, yb - D, zb], [B.x, yb, zb]);
      }
    }
    // the fascia where the roof ends (the shed's open ends, the atrium's sides)
    for (const [E, p, sgn] of [[A, pa, -1], [B, pb, 1]]) {
      if (!(E.x === U.x0 || E.x === U.x1 || Math.abs(E.x) === U.atrium)) continue;
      for (const run of p) {
        for (let k = 0; k + 1 < run.length; k++) {
          const [z0, y0] = run[k], [z1, y1] = run[k + 1];
          if (sgn > 0) quad(roof, [E.x, y0, z0], [E.x, y0 - D, z0], [E.x, y1 - D, z1], [E.x, y1, z1]);
          else quad(roof, [E.x, y0, z0], [E.x, y1, z1], [E.x, y1 - D, z1], [E.x, y0 - D, z0]);
        }
      }
    }
  }

  // steel: a column on each platform every 16 m (& a transverse girder across the shed above the trains); the atrium's
  // ribs every 8 m
  const box = (out, x, y, z, hx, hy, hz, rot = 0) => {
    const g = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    if (rot) g.rotateX(rot);
    g.translate(x, y, z);
    out.push(g);
  };
  const girderY = U.low - D - 0.3;
  for (const S of st) {
    if (Math.round(S.x - U.x0) % 16 !== 0 || Math.abs(S.x) < U.atrium) continue; // (the atrium is clear inside)
    const t = S.t;
    const cols = [];
    for (let i = 0; i + 1 < n; i++) if (t[i + 1] - t[i] > 2 * U.edge + 2.5) cols.push((t[i] + t[i + 1]) / 2);
    cols.push(Math.min(U.z1 - 0.6, t[n - 1] + 3.2));
    const top = U.low - D;
    for (const z of cols) box(steelParts, S.x, (U.bed + top) / 2, z, 0.18, (top - U.bed) / 2, 0.18);
    box(steelParts, S.x, girderY, (U.z0 + U.z1) / 2, 0.16, 0.3, (U.z1 - U.z0) / 2); // the girder
  }
  // the atrium: two glass slopes from the bays' slot height up to the ridge, on steel ribs
  const glass = [];
  const eave = U.high, rise = U.ridge - eave, half = U.atrium;
  quad(glass, [-half, eave, U.z0], [0, U.ridge, U.z0], [0, U.ridge, U.z1], [-half, eave, U.z1]);
  quad(glass, [half, eave, U.z0], [half, eave, U.z1], [0, U.ridge, U.z1], [0, U.ridge, U.z0]);
  const slope = Math.atan2(rise, half), rafter = Math.hypot(half, rise) / 2;
  for (let z = U.z0 + 2; z <= U.z1; z += 8) {
    for (const sgn of [-1, 1]) {
      const g = new THREE.BoxGeometry(rafter * 2, 0.45, 0.25);
      g.rotateZ(sgn * -slope);
      g.translate((sgn * half) / 2, eave + rise / 2 - 0.25, z);
      steelParts.push(g);
    }
  }
  box(steelParts, 0, U.ridge - 0.3, (U.z0 + U.z1) / 2, 0.2, 0.3, (U.z1 - U.z0) / 2); // the ridge beam
  for (const x of [-half, half]) box(steelParts, x, eave - 0.3, (U.z0 + U.z1) / 2, 0.2, 0.3, (U.z1 - U.z0) / 2);

  // the platforms between the tracks: concrete, a yellow safety strip along each edge
  const slabCol = [];
  const yTop = U.bed + U.platform;
  const pushSlab = (xa, xb, za0, za1, zb0, zb1) => {
    const strip = 0.6;
    const bands = [[0, strip, 1], [strip, -strip, 0], [-strip, 0, 1]];
    for (const [o0, o1, yellow] of bands) {
      const z0a = o0 >= 0 ? za0 + o0 : za1 + o0, z1a = o1 > 0 ? za0 + o1 : za1 + o1;
      const z0b = o0 >= 0 ? zb0 + o0 : zb1 + o0, z1b = o1 > 0 ? zb0 + o1 : zb1 + o1;
      quad(slabs, [xa, yTop, z0a], [xa, yTop, z1a], [xb, yTop, z1b], [xb, yTop, z0b]);
      const c = yellow ? [0.8, 0.5, 0.02] : [0.17, 0.165, 0.15]; // (linear)
      for (let k = 0; k < 6; k++) slabCol.push(...c);
    }
    const dark = [0.07, 0.07, 0.065];
    quad(slabs, [xa, yTop, za0], [xb, yTop, zb0], [xb, U.bed, zb0], [xa, U.bed, za0]); // the platform faces
    quad(slabs, [xa, yTop, za1], [xa, U.bed, za1], [xb, U.bed, zb1], [xb, yTop, zb1]);
    for (let k = 0; k < 12; k++) slabCol.push(...dark);
  };
  for (let i = 0; i + 1 < n; i++) {
    for (let s = 0; s + 1 < st.length; s++) {
      const A = st[s], B = st[s + 1];
      const za0 = A.t[i] + U.edge, za1 = A.t[i + 1] - U.edge, zb0 = B.t[i] + U.edge, zb1 = B.t[i + 1] - U.edge;
      if (za1 - za0 < 2.5 || zb1 - zb0 < 2.5) continue;
      pushSlab(A.x, B.x, za0, za1, zb0, zb1);
    }
    // up on the embankment the platform is a low wall to the player (rather than something to sink into)
    const a = st[0].t, b = st[st.length - 1].t;
    if (a[i + 1] - a[i] - 2 * U.edge >= 2.5) {
      colliders.push({ minX: U.x0, maxX: U.x1, minZ: Math.min(a[i], b[i]) + U.edge, maxZ: Math.max(a[i + 1], b[i + 1]) - U.edge, minY: U.bed - 0.5, maxY: yTop });
    }
  }

  const geo = (arr) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    return g;
  };
  // the roof: weathered warm grey (against the atrium's cool glass), darker seams across it every 2.4 m; its soffit a paler concrete (it's always in shade)
  const roofMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, side: THREE.DoubleSide });
  roofMat.colorNode = Fn(() => {
    const seam = step(0.94, fract(positionWorld.x.div(2.4)));
    const top = mix(color(0x6b665e), color(0x524e48), seam.mul(0.7));
    return mix(color(0x8c8d8b), top, step(0.0, normalWorldGeometry.y));
  })();
  const roofGeo = mergeGeometries([geo(roof), geo(under)]);
  const roofMesh = new THREE.Mesh(roofGeo, roofMat);
  roofMesh.name = 'UnionTrainShed_roof';
  roofMesh.castShadow = true;
  const steelMat = new THREE.MeshStandardNodeMaterial({ color: 0x3e4449, roughness: 0.55, metalness: 0.6 });
  const steelMesh = new THREE.Mesh(mergeGeometries(steelParts.map((g) => g.toNonIndexed())), steelMat);
  steelMesh.name = 'UnionTrainShed_steel';
  steelMesh.castShadow = true;
  // the atrium's glass: pale, half see-through, in a grid of glazing bars (no shadow: the platforms under it are sunlit)
  const glassMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0.3, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const bars = Fn(() => {
    const p = positionWorld;
    const across = step(0.9, fract(p.z.div(2.0)));
    const along = step(0.95, fract(p.x.abs().div(3.0)));
    return max(across, along);
  });
  glassMat.colorNode = mix(color(0xcfe0e8), color(0xe8eaea), bars());
  glassMat.opacityNode = mix(float(0.35), float(1.0), bars());
  const glassMesh = new THREE.Mesh(geo(glass), glassMat);
  glassMesh.name = 'UnionTrainShed_atrium';
  const slabGeo = geo(slabs);
  slabGeo.setAttribute('color', new THREE.Float32BufferAttribute(slabCol, 3));
  const slabMesh = new THREE.Mesh(slabGeo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9 }));
  slabMesh.name = 'UnionTrainShed_platforms';
  slabMesh.castShadow = true;
  for (const m of [roofMesh, steelMesh, glassMesh, slabMesh]) {
    m.receiveShadow = true;
    group.add(m);
  }
  console.info(`[landmarks] Union train shed: ${n} tracks, ${st.length} stations, ${steelParts.length} steel members`);
  return steelMat;
}

// The head house's south wall: once the shed stood open (above) it showed as a blank 230 m face over the trains, and
// at Bay St the massing has no east end at all (it ran on into the shed), so from the street one looked into the
// building at the backs of its walls & roof. Both are dressed as the station is: the same Indiana limestone as the
// Front St front, pilasters between window bays and a cornice along the top. The south wall: a tall window to the
// platforms under the shed roof, a storey of windows above it, a ledge where the roof meets the wall; the Great Hall's
// south face above it: tall clerestory windows. The east end: a wall closing the building with three storeys of
// windows over a plinth. ~1,600 triangles in the massing's own limestone and the shed's dark steel for the glass (no new
// material), laid on the wall the massing actually has (its south faces, sampled per bay).
function buildUnionSouthFace(group, pos, idx, stone, glass, baseY) {
  // the massing's south-facing triangles round the head house's south wall, for "how far south is the wall at (x, y)"
  const faces = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    const zc = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    if (L < 1e-6 || Math.abs(nz) / L < 0.95 || zc < 24 || zc > 41.5) continue;
    faces.push([pos[a], pos[a + 1], pos[b], pos[b + 1], pos[c], pos[c + 1], zc]);
  }
  const wallZ = (x, y) => {
    let best = -Infinity;
    for (const [ax, ay, bx, by, cx, cy, z] of faces) {
      if (z <= best) continue;
      const d1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax), d2 = (cx - bx) * (y - by) - (cy - by) * (x - bx), d3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
      if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) best = z;
    }
    return best;
  };
  const S = [], G = [];
  // a wall's own frame: u along it, y up, w out of it; `map` turns (u, y, w) into the world (a rotation, so the faces
  // keep their winding: fronts face +w)
  const face = (map, wallAt, x0, x1, bay, sampleY, windows, py0, py1, cornice, ledges = [], minFront = -Infinity) => {
    const quad = (out, a, b, c, d) => { for (const p of [a, b, c, a, c, d]) out.push(...map(...p)); };
    const proud = (u0, u1, y0, y1, wb, wf) => {
      quad(S, [u0, y0, wf], [u1, y0, wf], [u1, y1, wf], [u0, y1, wf]);
      quad(S, [u0, y0, wb], [u0, y0, wf], [u0, y1, wf], [u0, y1, wb]);
      quad(S, [u1, y0, wf], [u1, y0, wb], [u1, y1, wb], [u1, y1, wf]);
      quad(S, [u0, y1, wf], [u1, y1, wf], [u1, y1, wb], [u0, y1, wb]);
      quad(S, [u0, y0, wb], [u1, y0, wb], [u1, y0, wf], [u0, y0, wf]); // (the underside: a cornice's, from below)
    };
    const n = Math.max(1, Math.round((x1 - x0) / bay)), w = (x1 - x0) / n;
    const clampU = (u) => Math.min(x1 - 0.3, Math.max(x0 + 0.3, u));
    let wMax = -Infinity;
    for (let i = 0; i <= n; i++) wMax = Math.max(wMax, wallAt(clampU(x0 + i * w), sampleY));
    if (!isFinite(wMax)) return;
    for (let i = 0; i < n; i++) {
      const cu = x0 + (i + 0.5) * w;
      for (const [y0, y1, ww] of windows) {
        const z = wallAt(cu, (y0 + y1) / 2);
        if (!isFinite(z)) continue;
        quad(G, [cu - ww / 2, y0, z + 0.04], [cu + ww / 2, y0, z + 0.04], [cu + ww / 2, y1, z + 0.04], [cu - ww / 2, y1, z + 0.04]);
        // its stone mullion & transom (fronts only): the window in four lights, not a dark hole
        const ym = y0 + (y1 - y0) * 0.62, zf = z + 0.09;
        quad(S, [cu - 0.07, y0, zf], [cu + 0.07, y0, zf], [cu + 0.07, y1, zf], [cu - 0.07, y1, zf]);
        quad(S, [cu - ww / 2, ym - 0.07, zf], [cu + ww / 2, ym - 0.07, zf], [cu + ww / 2, ym + 0.07, zf], [cu - ww / 2, ym + 0.07, zf]);
        quad(S, [cu - ww / 2 - 0.12, y0 - 0.16, zf], [cu + ww / 2 + 0.12, y0 - 0.16, zf], [cu + ww / 2 + 0.12, y0, zf], [cu - ww / 2 - 0.12, y0, zf]); // the sill
      }
    }
    for (let i = 0; i <= n; i++) {
      const pu = x0 + i * w, hw = i === 0 || i === n ? 0.6 : 0.45;
      const z = wallAt(clampU(pu), (py0 + py1) / 2);
      if (isFinite(z)) proud(Math.max(x0, pu - hw), Math.min(x1, pu + hw), py0, py1, z - 0.05, z + 0.28);
    }
    proud(x0 - 0.3, x1 + 0.3, cornice[0], cornice[1], wMax - 0.05, wMax + cornice[2]);
    for (const [y0, y1, d] of ledges) proud(x0, x1, y0, y1, wMax - 0.05, Math.max(wMax + d, minFront));
    return quad;
  };
  const south = (u, y, w) => [u, y, w];
  // the head house's south wall (to the top of its office floors, 18.5 m), over the shed: its ends where the massing's are
  let wx0 = Infinity, wx1 = -Infinity;
  for (let x = -130; x <= 130; x += 0.5) if (wallZ(x, 16.5) > 36) { wx0 = Math.min(wx0, x); wx1 = Math.max(wx1, x); }
  if (!isFinite(wx0)) return;
  face(south, wallZ, wx0 + 0.5, wx1 - 0.5, 5.2, 16.5,
    [[8.0, 12.6, 2.4], [14.9, 17.2, 2.8]], // the tall window to the platforms; the office storey over the shed roof
    6.2, 17.7, [17.7, 18.55, 0.6], [[13.25, 13.75, 0.5]], UNION_SHED.z0 + 0.15); // pilasters from the track bed; the ledge closes the gap to the roof
  // the Great Hall's south face, up over the head house's roof (x -40..39, 18.6 to 29.2 m)
  face(south, wallZ, -39.5, 38.5, 6.5, 24, [[20.0, 27.3, 3.2]], 18.6, 28.3, [28.3, 29.25, 0.7]);
  // the east end on Bay St, from the Front St front (z -10.5) to the south wall: u runs north along it (u = -z), w east
  const ex = wx1 + 0.5, zs = wallZ(wx1 - 1, 9), zn = -10.5;
  const east = (u, y, w) => [ex + w, y, -u];
  const quadE = face(east, () => 0, -zs + 0.3, -zn - 0.3, 5.0, 9,
    [[1.6, 4.8, 2.2], [7.2, 10.6, 2.0], [12.4, 15.8, 2.0]], 1.0, 17.7, [17.7, 18.55, 0.6], [[0, 1.0, 0.2], [6.0, 6.4, 0.18]]);
  if (quadE) quadE(S, [-zs, 0, 0], [-zn, 0, 0], [-zn, 19.4, 0], [-zs, 19.4, 0]); // the wall itself (two-sided stone)
  const mk = (arr, mat, name) => {
    if (!arr.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.position.y = baseY;
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  mk(S, stone, 'UnionSouthFace_stone');
  mk(G, glass, 'UnionSouthFace_windows');
  console.info(`[landmarks] Union's south wall x ${wx0} to ${wx1} & its Bay St end at x ${ex}: ${(S.length + G.length) / 9} triangles`);
}

// =====================================================================================================================
// THE CINESPHERE (Ontario Place, 1971): the world's first permanent IMAX theatre, a triangulated geodesic dome of
// aluminium struts & panels (Eberhard Zeidler) on a deck that stands on concrete columns in the West Island's lagoon.
// The City's massing has it as a plain cylinder (0 to 18.4 m) joined to the pods' walkways; its triangles are dropped
// (cinesphereKeep: the walkways stay) and it is built here: the dome a geodesic sphere (an icosahedron's faces
// subdivided 6 to an edge, a vertex at the top) cut a little below its equator, each facet flat-shaded with its strut
// lines drawn on it in the shader (one draw call, ~600 triangles), and the deck, the stair core under it and its ring
// of columns down into the water in concrete (one more). Its height to the top is the mapped 25 m; the dome's span
// fills the mapped outline (37 m).
// =====================================================================================================================
const CINESPHERE = {
  R: 17.6, // the dome's radius
  top: 25, // its top above the street level (the outline's mapped height)
  deck: 4.2, // the deck the dome stands on, above the street level
  deckR: 19.4,
  columns: 12, columnR: 0.55, columnAt: 14.5,
  core: 6.5 // the stair core under the deck
};
// The massing's triangles to keep: all but the Cinesphere's cylinder (every corner within 20.3 m of its centre, or
// 23.5 m for a wall: the cylinder's seam with the walkways)
function cinesphereKeep(pos, idx, s) {
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    let far = 0, level = true;
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k] * 3;
      far = Math.max(far, Math.hypot(pos[v] - s.x, pos[v + 2] - s.z));
      if (Math.abs(pos[v + 1] - pos[idx[t] * 3 + 1]) > 0.1) level = false;
    }
    if (far > (level ? 20.3 : 23.5)) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  return new Uint32Array(keep);
}
function buildCinesphere(group, s, baseY) {
  const C = CINESPHERE;
  const cy = C.top - C.R; // the sphere's centre, above the street level
  // the geodesic sphere, turned so one of the icosahedron's vertices is at the top
  let g = new THREE.IcosahedronGeometry(C.R, 5);
  const t = (1 + Math.sqrt(5)) / 2;
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, t).normalize(), new THREE.Vector3(0, 1, 0)));
  // the facets above the cut; the corners below it brought up onto the cut's circle (a level base ring)
  const cut = C.deck - cy, baseR = Math.sqrt(C.R * C.R - cut * cut);
  const src = g.attributes.position.array, out = [];
  for (let i = 0; i < src.length; i += 9) {
    if ((src[i + 1] + src[i + 4] + src[i + 7]) / 3 < cut - 0.5) continue;
    for (let k = 0; k < 9; k += 3) {
      let x = src[i + k], y = src[i + k + 1], z = src[i + k + 2];
      if (y < cut) {
        const f = baseR / (Math.hypot(x, z) || 1);
        x *= f; z *= f; y = cut;
      }
      out.push(s.x + x, baseY + cy + y, s.z + z);
    }
  }
  g.dispose();
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.computeVertexNormals(); // (non-indexed: each facet flat)
  // each corner's barycentric weight (the strut lines) and the facet's own slight shade (panels never quite match)
  const n = out.length / 3, bary = new Float32Array(n * 3), shade = new Float32Array(n);
  for (let v = 0; v < n; v += 3) {
    const h = Math.sin(out[v * 3] * 12.9898 + out[v * 3 + 2] * 78.233 + out[v * 3 + 1] * 37.719) * 43758.5453;
    const sh = 0.9 + 0.1 * (h - Math.floor(h));
    for (let k = 0; k < 3; k++) { bary[(v + k) * 3 + k] = 1; shade[v + k] = sh; }
  }
  g.setAttribute('bary', new THREE.BufferAttribute(bary, 3));
  g.setAttribute('shade', new THREE.BufferAttribute(shade, 1));
  const { attribute, fwidth } = window.CITY.TSL;
  const domeMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.38, metalness: 0.55 });
  domeMat.name = 'CinesphereDome';
  domeMat.colorNode = Fn(() => {
    const b = attribute('bary', 'vec3');
    const e = min(min(b.x, b.y), b.z);
    const w = fwidth(e).mul(1.2);
    const strut = smoothstep(float(0.045).add(w), float(0.045), e); // ~0.15 m struts (a facet is ~3 m tall)
    const panel = color(0xe4e8ea).mul(attribute('shade', 'float'));
    return mix(panel, color(0x7f888f), strut);
  })();
  const dome = new THREE.Mesh(g, domeMat);
  dome.name = 'Cinesphere_dome';
  // the deck, the stair core under it and its columns into the lagoon, in concrete
  const parts = [];
  const cyl = (r0, r1, y0, y1, x, z, seg) => {
    const c = new THREE.CylinderGeometry(r0, r1, y1 - y0, seg);
    c.translate(x, baseY + (y0 + y1) / 2, z);
    parts.push(c.toNonIndexed());
  };
  const water = CITY_BOUNDS.waterLevel - baseY - 0.3;
  cyl(C.deckR, C.deckR - 0.4, C.deck - 1.1, C.deck + 0.05, s.x, s.z, 48);
  cyl(C.core, C.core, water, C.deck - 1.1, s.x, s.z, 24);
  for (let i = 0; i < C.columns; i++) {
    const a = (i / C.columns) * Math.PI * 2 + 0.2;
    cyl(C.columnR, C.columnR, water, C.deck - 1.1, s.x + Math.cos(a) * C.columnAt, s.z + Math.sin(a) * C.columnAt, 10);
  }
  const base = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardNodeMaterial({ color: 0xc9c5bc, roughness: 0.85 }));
  base.name = 'Cinesphere_base';
  for (const m of [dome, base]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  console.info(`[landmarks] Cinesphere: geodesic dome ${out.length / 9} facets, base ${baseR.toFixed(1)} m, top ${C.top} m`);
  return [dome, base];
}

// =====================================================================================================================
// THE ROGERS CENTRE'S FIELD: the City's massing has the stadium's bowl, its floor 7.4 m below the street, where the
// rail lands' surface (city-grid.js) covered it: a flat dark-grey floor that grew yard trees. The field is laid over
// it at street level: green artificial turf mown in bands, the dirt infield (the skin round the grass diamond, since
// 2016), the mound and the circle round home plate, the bases, chalked foul lines, and the warning track along the
// wall. One flat mesh (a 120-triangle fan out to the floor's outline), its colours in the shader from the diamond's
// frame: home plate at the south end, centre field towards Front St (the hotel). The stands are the massing's own,
// their seats painted blue in its material (rogersCentreMaterial); city-config.js keeps trees out of the bowl.
// =====================================================================================================================
const ROGERS_FIELD = {
  y: 0.3, // (world) over the street level's paving: the island's top is the sidewalk height, 0.22
  home: 57, // home plate south of the floor's centre (m); centre field 122 m (400 ft) north of it
  base: 27.43, // 90 ft between the bases
  rubber: 18.44, // 60 ft 6 in from home plate to the pitcher's rubber
  skin: 28.96, // the infield dirt's arc: 95 ft from the rubber
  track: 4.6 // the warning track along the wall
};
function buildRogersField(group, pos, idx) {
  const F = ROGERS_FIELD;
  // the floor's outline: the massing's level faces under -5 m (the field & the apron round it), as the farthest any of
  // them reaches from its middle every 3 degrees round; the field a fan out to that outline (the faces themselves, as
  // modelled, leave gaps along the wall)
  const edges = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const ny = uz * vx - ux * vz, L = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
    if (L < 1e-6 || Math.abs(ny) / L < 0.95 || (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3 > -5) continue;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) edges.push([pos[p], pos[p + 2], pos[q], pos[q + 2]]);
    for (const v of [a, b, c]) { x0 = Math.min(x0, pos[v]); x1 = Math.max(x1, pos[v]); z0 = Math.min(z0, pos[v + 2]); z1 = Math.max(z1, pos[v + 2]); }
  }
  if (!edges.length || x1 - x0 < 60) return null;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, R = Math.min(x1 - x0, z1 - z0) / 2;
  const N = 120, rim = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const A = ((k + 0.5) / N) * Math.PI * 2, dx = Math.cos(A), dz = Math.sin(A);
    for (const [ax, az, bx, bz] of edges) {
      // the ray from the middle against the edge: t along the ray, s along the edge
      const ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const wx = ax - cx, wz = az - cz;
      const t = (wx * ez - wz * ex) / den, s = (wx * dz - wz * dx) / den;
      if (t > 0 && s >= 0 && s <= 1) rim[k] = Math.max(rim[k], t);
    }
  }
  // (the faces stop short of the wall in places: the field runs out to the farthest reach within 24 degrees, under the
  // lowest rows of the stands, which stand over it)
  const reach = Float32Array.from(rim);
  for (let k = 0; k < N; k++) for (let j = -8; j <= 8; j++) rim[k] = Math.max(rim[k], reach[(k + j + N) % N]);
  const tri = [], toWall = [];
  const at = (k) => { const a = ((k % N) + 0.5) / N * Math.PI * 2, r = rim[k % N]; return [cx + Math.cos(a) * r, F.y, cz + Math.sin(a) * r]; };
  for (let k = 0; k < N; k++) {
    // (wound to face up), each corner's distance to the wall (0 at the rim; the fan's middle as far as the rim is)
    tri.push(cx, F.y, cz, ...at(k + 1), ...at(k));
    toWall.push((rim[k] + rim[(k + 1) % N]) / 2, 0, 0);
  }
  const hx = cx, hz = cz + F.home;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  g.setAttribute('toWall', new THREE.Float32BufferAttribute(toWall, 1));
  g.computeVertexNormals();
  const { vec2, length, clamp, fwidth, attribute } = window.CITY.TSL;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  mat.name = 'RogersCentreField';
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    // the diamond's frame: u across (towards first base, east), v from home plate towards centre field (north)
    const u = p.x.sub(hx), v = float(hz).sub(p.y);
    const d = length(vec2(u, v));
    const aw = fwidth(d).mul(0.75).add(0.02); // (a line's soft edge: about a pixel)
    const line = (dist, half) => smoothstep(half.add(aw), half, dist);
    // fair territory: within 45 degrees of the line to second base
    const fair = step(abs(u), v.add(0.3));
    // the turf: mown-looking bands across the outfield, a little darker in the foul ground
    const band = step(0.5, fract(v.div(7.5)));
    const turf = mix(color(0x3d7a35), color(0x468a3c), band).mul(mix(float(0.88), float(1.0), fair));
    // the infield dirt: the arc round the rubber over the grass diamond, the mound, the circle round home, the cut-outs
    // at the bases, and the warning track round the wall
    const rub = vec2(u, v.sub(F.rubber));
    const toSecond = abs(u).add(abs(v.sub(F.base * Math.SQRT1_2)));
    const grassDiamond = step(toSecond, float(F.base * Math.SQRT1_2 - 1.5)).mul(step(1.0, v));
    const skin = step(length(rub), float(F.skin)).mul(step(abs(u).sub(2.0), v));
    const mound = step(length(rub), float(2.74));
    const plate = step(d, float(3.96));
    const b1 = length(vec2(abs(u).sub(F.base * Math.SQRT1_2), v.sub(F.base * Math.SQRT1_2)));
    const bases = step(b1, float(2.6));
    const track = step(attribute('toWall', 'float'), float(F.track));
    const dirt = max(max(skin.mul(grassDiamond.oneMinus()), max(mound, plate)), max(bases, track));
    const clay = mix(color(0x9a6440), color(0xa8724c), mound);
    // chalk: the foul lines out to the wall, the base paths' lines on the dirt, the bases and home plate
    const foulLine = line(abs(abs(u).sub(v)).mul(Math.SQRT1_2), float(0.06)).mul(step(0.0, v)).mul(step(0.3, attribute('toWall', 'float')));
    const bag = step(max(abs(abs(u).sub(F.base * Math.SQRT1_2)), abs(v.sub(F.base * Math.SQRT1_2))), float(0.25));
    const second = step(max(abs(u), abs(v.sub(F.base * Math.SQRT2))), float(0.25));
    const homePlate = step(max(abs(u), abs(v.sub(0.2))), float(0.22));
    const chalk = clamp(foulLine.add(bag).add(second).add(homePlate), 0.0, 1.0);
    return mix(mix(turf, clay, dirt), color(0xf2f0ea), chalk);
  })();
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'RogersCentre_field';
  mesh.receiveShadow = true;
  group.add(mesh);
  console.info(`[landmarks] Rogers Centre's field: ${tri.length / 9} triangles, ${Math.round(x1 - x0)} x ${Math.round(z1 - z0)} m`);
  return { cx, cz, R };
}

// The stadium's white shell, its stands' seats blue: the massing's sloped faces round the field below the roof's ring
// (36 m) and inside the outer wall, in rows (a darker line every 0.85 m up), split by aisles every ~9 m round the bowl
function rogersCentreMaterial({ cx, cz, R }) {
  const { vec2, length, atan, normalGeometry, clamp } = window.CITY.TSL;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, side: THREE.DoubleSide });
  mat.name = 'RogersCentre';
  mat.colorNode = Fn(() => {
    const rel = vec2(positionWorld.x.sub(cx), positionWorld.z.sub(cz));
    const r = length(rel), y = positionWorld.y;
    const ny = abs(normalGeometry.y);
    const sloped = step(0.15, ny).mul(step(ny, 0.97));
    const inBowl = step(r, float(R + 22)).mul(step(y, 36.0)).mul(step(0.4, y));
    const seats = sloped.mul(inBowl);
    const row = smoothstep(0.75, 0.9, fract(y.div(0.85)));
    const aisle = step(0.94, fract(atan(rel.y, rel.x).mul(r).div(9.0)));
    const seat = mix(mix(color(0x1f4f8f), color(0x163a6a), row), color(0x9a9a96), aisle);
    return mix(color(0xf1efe9), seat, clamp(seats, 0.0, 1.0));
  })();
  return mat;
}

function buildLandmarks(scene) {
  const group = new THREE.Group();
  group.name = 'CityLandmarks';
  const colliders = [];
  const SW_Y = CITY_BOUNDS.sidewalkHeight;
  const S = LANDMARK_SITES;

  const white = new THREE.MeshStandardNodeMaterial({ color: 0xf1eee6, roughness: 0.72 });
  const cream = new THREE.MeshStandardNodeMaterial({ color: 0xe9e0cc, roughness: 0.75 });
  const concrete = new THREE.MeshStandardNodeMaterial({ color: 0xb9b5ad, roughness: 0.82 });
  const gold = new THREE.MeshStandardNodeMaterial({ color: 0xd8a83a, roughness: 0.28, metalness: 0.95 });
  const green = new THREE.MeshStandardNodeMaterial({ color: 0x2e7d4f, roughness: 0.4, metalness: 0.35 });
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0xc9ced3, roughness: 0.22, metalness: 0.95 });
  const glassDark = new THREE.MeshStandardNodeMaterial({ color: 0x1e3546, roughness: 0.1, metalness: 0.8 });

  // Player collider for a turned rectangle (centre, half sizes, yaw) up to maxY
  function boxCollider(cx, cz, hw, hd, ang, maxY) {
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const ex = Math.abs(cs) * hw + Math.abs(sn) * hd, ez = Math.abs(sn) * hw + Math.abs(cs) * hd;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY, obb: { cx, cz, hx: hw, hz: hd, cs, sn } });
  }
  // A landmark's colliders from what is drawn (js/world-collision.js footprintColliders): its outline where the riders
  // are, convex bands above; its site's turned rectangle if the mesh gives none
  const WC = window.CITY.WorldCollision;
  function meshColliders(objects, s, maxY, options) {
    const t = performance.now();
    const out = WC ? WC.footprintColliders(objects, options) : [];
    if (!out.some((c) => c.minY === undefined)) {
      boxCollider(s.x, s.z, s.w / 2, s.d / 2, s.ang || 0, maxY);
      return colliders.slice(-1);
    }
    colliders.push(...out);
    footprintMs += performance.now() - t;
    return out;
  }
  let footprintMs = 0;
  // Point in the site's frame (u along its width, v along its depth) -> world
  const at = (s, u, v) => {
    const cs = Math.cos(s.ang || 0), sn = Math.sin(s.ang || 0);
    return { x: s.x + u * cs + v * sn, z: s.z - u * sn + v * cs };
  };
  const extrude = (s, h, mat, y0 = 0) => {
    const m = createExtrudedPolygonMesh(ringPts(s.ring), y0, h, mat, true, true);
    group.add(m);
    boxCollider(s.x, s.z, s.w / 2, s.d / 2, s.ang || 0, y0 + h);
    return m;
  };
  const done = new Set();

  // =========================================================================
  // CN TOWER (1976, 553.3 m): C.J..Goldman's model (Sketchfab, CC BY 4.0; tools/blender/export_cn_tower.py made
  // assets/landmarks/cn-tower.glb from it). Until it has loaded (or if it can't) a stand-in: the tapering shaft as a
  // lathe, the main pod with its glass band, the SkyPod and the antenna mast (main pod ~342-352 m, SkyPod 447 m; the
  // lathe profile is one-minute-ride's).
  // =========================================================================
  {
    const p = GEO.points.cnTower;
    const s = S.cnTower || { x: p[0], z: p[1] };
    const prof = [
      [0, 0], [32, 0], [28, 20], [12, 300], [11, 330], [24, 338], [26, 346], [24, 352], [14, 360], [9, 368],
      [8, 440], [11, 444], [11, 452], [6, 456], [3, 470], [2, 520], [0.6, 553], [0, 553]
    ];
    // At night (ramping in with the city's windows, the gate pbr-water.js's reflection of the tower uses): the shaft
    // washed cool white by its LEDs from below, the main pod's and SkyPod's glass glowing warm & the red aviation
    // beacons up the mast, in the reflection's colours & heights. Emissive only: no lights, no passes.
    const { cityUniforms } = window.CITY;
    const cnH = positionWorld.y.sub(SW_Y);
    const cnNight = smoothstep(0.55, 1.35, cityUniforms.uInteriorGlow);
    const CN_GLOW = {
      wash: color(0xdde6ff).mul(mix(float(0.36), float(0.1), smoothstep(10.0, 330.0, cnH))).mul(cnNight),
      glass: color(0xffd2a0).mul(mix(float(1.4), float(1.6), step(cnH, 400.0))).mul(cnNight), // SkyPod 1.4, main pod 1.6
      beacon: color(0xff2a14).mul(mix(float(0.35), float(5.0), step(470.0, cnH))).mul(cnNight) // (below: the pod's red band)
    };
    const towerMat = new THREE.MeshStandardNodeMaterial({ color: 0xd9d4ca, roughness: 0.78 });
    // (the lathe's tip stands in for the beacons)
    towerMat.emissiveNode = mix(CN_GLOW.wash, color(0xff2a14).mul(5.0).mul(cnNight), step(546.0, cnH));
    const standGlass = glassDark.clone();
    standGlass.emissiveNode = CN_GLOW.glass;
    const shaft = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 48), towerMat);
    shaft.position.set(s.x, SW_Y, s.z);
    shaft.castShadow = true;
    group.add(shaft);
    // the main pod's windows and the SkyPod's, dark glass bands
    const band = (r0, r1, y0, h) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 48, 1, true), standGlass);
      m.position.set(s.x, SW_Y + y0 + h / 2, s.z);
      group.add(m);
      return m;
    };
    const stand = [shaft, band(24.2, 26.2, 339, 6.5), band(11.2, 11.2, 445, 6)];
    let standColliders = meshColliders(stand, { x: s.x, z: s.z, w: 48, d: 48 }, 553);
    if (window.CITY.Addons.GLTFLoader) {
      const loader = new window.CITY.Addons.GLTFLoader();
      if (window.CITY.Addons.MeshoptDecoder) loader.setMeshoptDecoder(window.CITY.Addons.MeshoptDecoder);
      loader.loadAsync('./assets/landmarks/cn-tower.glb').then((gltf) => {
        const tower = gltf.scene;
        tower.name = 'Landmark_cnTower';
        tower.position.set(s.x, SW_Y, s.z);
        // its night lighting by material (tools/blender/export_cn_tower.py): 'Glass' is the main pod's (326-352 m) and
        // SkyPod's (440-444 m) windows, 'Material.008' the red lamps (beacons on the mast above 470 m); the rest
        // ('base', 'Base_dark', 'Striations', 'base_lightest') is the concrete & steel the LEDs wash
        const nightOf = (name) => (name === 'Glass' ? CN_GLOW.glass : name.startsWith('Material.008') ? CN_GLOW.beacon : CN_GLOW.wash);
        const lit = new Map();
        tower.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const m = o.material;
            if (!lit.has(m)) {
              const n = new THREE.MeshStandardNodeMaterial({
                name: m.name, color: m.color, roughness: m.roughness, metalness: m.metalness, side: m.side
              });
              n.emissiveNode = nightOf(m.name || '');
              lit.set(m, n);
              m.dispose();
            }
            o.material = lit.get(m);
          }
        });
        for (const m of stand) group.remove(m);
        group.add(tower);
        tower.updateMatrixWorld(true); // (the static city's matrices are frozen once built: main.js)
        // its colliders: the model's own outline, in place of the stand-in's
        const next = WC ? WC.footprintColliders(tower) : [];
        if (next.length) { WC.swap(standColliders, next); standColliders = next; }
        console.info('[landmarks] CN Tower model placed');
      }).catch((e) => console.warn('[landmarks] CN Tower model did not load:', e));
    }
    done.add('cnTower');
  }

  // =========================================================================
  // ROGERS CENTRE (1989): the drum of the stands and the white retractable roof, a shallow dome over a ~205 m circle
  // =========================================================================
  if (S.rogersCentre && !(window.CITY.LANDMARK_MESHES || {}).rogersCentre) {
    const s = S.rogersCentre;
    const R = Math.min(s.w, s.d) / 2 * 0.98;
    const drumH = 46;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.02, drumH, 64), concrete);
    drum.position.set(s.x, SW_Y + drumH / 2, s.z);
    drum.castShadow = true;
    group.add(drum);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), white);
    dome.scale.y = 40 / R;
    dome.position.set(s.x, SW_Y + drumH, s.z);
    dome.castShadow = true;
    group.add(dome);
    boxCollider(s.x, s.z, R * 0.75, R * 0.75, 0, drumH + 40);
    done.add('rogersCentre');
  }

  // =========================================================================
  // THE CITY'S 3D MASSING: City Hall's two curved towers & council saucer, Union Station, Queen's Park, the Royal York,
  // the Gooderham (Flatiron) Building, the Princes' Gates, St. Lawrence Market, the Cinesphere, Scotiabank Arena and the
  // Rogers Centre, from the multipatch faces in toronto-landmarks.js (tools/fetch-landmark-massing.mjs), in stone,
  // concrete or brick by what each is built of
  // =========================================================================
  {
    const LOOKS = {
      concrete: new THREE.MeshStandardNodeMaterial({ color: 0xdcd9d1, roughness: 0.8 }),
      limestone: new THREE.MeshStandardNodeMaterial({ color: 0xd9cdb2, roughness: 0.78 }),
      sandstone: new THREE.MeshStandardNodeMaterial({ color: 0xc28a6c, roughness: 0.82 }),
      brick: new THREE.MeshStandardNodeMaterial({ color: 0x9a5a43, roughness: 0.86 }),
      white: new THREE.MeshStandardNodeMaterial({ color: 0xf1efe9, roughness: 0.6 })
    };
    // the multipatch faces don't keep one winding (the Rogers Centre's roof faced inward: from above its dome vanished)
    for (const m of Object.values(LOOKS)) m.side = THREE.DoubleSide;
    const decode = (b64, Type) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Type(bytes.buffer);
    };
    for (const [id, m] of Object.entries(window.CITY.LANDMARK_MESHES || {})) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(decode(m.positions, Float32Array), 3));
      let idx = decode(m.indices, Uint32Array);
      if (id === 'unionStation') idx = unionShedKeep(g.attributes.position.array, idx); // (the shed: built open below)
      if (id === 'cinesphere' && S.cinesphere) idx = cinesphereKeep(g.attributes.position.array, idx, S.cinesphere); // (the dome: built below)
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeVertexNormals(); // every face has its own vertices: flat-shaded facets
      const mesh = new THREE.Mesh(g, LOOKS[m.look] || LOOKS.limestone);
      mesh.position.y = SW_Y;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `Landmark_${id}`;
      group.add(mesh);
      const s = S[id];
      if (id === 'unionStation') {
        // the head house only (one box over the whole site walled off York St & Bay St under the tracks): its main
        // block, the west wing beyond York St, and the bridge over York St (open beneath)
        colliders.push({ minX: -119, maxX: 114.5, minZ: -22, maxZ: 41, maxY: 34.3 }); // (to the Bay St end buildUnionSouthFace closes)
        colliders.push({ minX: -180.5, maxX: -154.5, minZ: 24, maxZ: 42, maxY: 18 });
        colliders.push({ minX: -154.5, maxX: -119, minZ: 28, maxZ: 41, minY: 4.7, maxY: 14.1 });
        const shedSteel = buildUnionTrainShed(group, colliders);
        buildUnionSouthFace(group, g.attributes.position.array, idx, mesh.material, shedSteel || glassDark, SW_Y);
      } else if (s && s.w) {
        if (id === 'rogersCentre') {
          const field = buildRogersField(group, g.attributes.position.array, idx);
          if (field) mesh.material = rogersCentreMaterial(field);
        }
        g.computeBoundingBox();
        // (the pods stand on columns: their roofs are overhead, not walls)
        meshColliders(mesh, s, g.boundingBox.max.y + SW_Y, { roof: id !== 'cinesphere' });
        if (id === 'cinesphere') meshColliders(buildCinesphere(group, s, SW_Y), s, CINESPHERE.top + SW_Y);
      }
      done.add(id);
    }
  }

  // =========================================================================
  // ROYAL ONTARIO MUSEUM: John's model (rom-heist's SketchUp shell: the 1914 & 1933 wings and Libeskind's Crystal,
  // exported to assets/landmarks/rom.glb), turned & placed on the museum's OSM outline by tools/fit-rom.mjs
  // =========================================================================
  if (S.rom && window.CITY.Addons.GLTFLoader) {
    const s = S.rom;
    boxCollider(s.x, s.z, s.w / 2, s.d / 2, s.ang || 0, 36);
    const romBox = colliders.slice(-1);
    Promise.all([
      fetch('./assets/landmarks/rom-fit.json').then((r) => r.json()),
      new window.CITY.Addons.GLTFLoader().loadAsync('./assets/landmarks/rom.glb')
    ]).then(([fit, gltf]) => {
      const rom = gltf.scene;
      rom.name = 'Landmark_rom';
      rom.rotation.y = fit.rotationY;
      rom.position.set(fit.x, SW_Y + fit.y, fit.z);
      rom.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      group.add(rom);
      rom.updateMatrixWorld(true); // (the static city's matrices are frozen once built: main.js)
      const next = WC ? WC.footprintColliders(rom) : [];
      if (next.length) WC.swap(romBox, next); // (the model's outline in place of the site's rectangle)
      console.info('[landmarks] ROM model placed');
    }).catch((e) => console.warn('[landmarks] ROM model did not load:', e));
    done.add('rom');
  }

  // =========================================================================
  // ABUJA NATIONAL MOSQUE
  // =========================================================================
  if (S.mosque) {
    const s = S.mosque;
    const hallH = 16;
    extrude(s, hallH, cream);
    // the gilded main dome on a drum at the centre of the hall
    const R = Math.min(s.w, s.d) * 0.29;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.05, 5, 40), cream);
    drum.position.set(s.x, hallH + 2.5, s.z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    dome.scale.set(1, 1.08, 1);
    dome.position.set(s.x, hallH + 5, s.z);
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.6, 6, 10), gold);
    finial.position.set(s.x, hallH + 5 + R * 1.08 + 3, s.z);
    group.add(drum, dome, finial);
    // four minarets at the corners (height estimated: no surveyed figure)
    const H = 76;
    const shaft = new THREE.CylinderGeometry(1.7, 2.3, H, 8);
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = at(s, su * (s.w / 2 - 4), sv * (s.d / 2 - 4));
      const m = new THREE.Mesh(shaft, cream);
      m.position.set(p.x, H / 2, p.z);
      group.add(m);
      for (const f of [0.42, 0.66, 0.88]) {
        const balcony = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 2.4, 1.6, 12), cream);
        balcony.position.set(p.x, H * f, p.z);
        group.add(balcony);
      }
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.0, 9, 8), gold);
      cap.position.set(p.x, H + 4.5, p.z);
      group.add(cap);
      colliders.push({ minX: p.x - 2.4, maxX: p.x + 2.4, minZ: p.z - 2.4, maxZ: p.z + 2.4, maxY: H });
    }
    for (const o of group.children) o.castShadow = o.receiveShadow = true;
    done.add('mosque');
  }

  // =========================================================================
  // NATIONAL CHRISTIAN CENTRE (its tower is mapped as its own part and stands with the other buildings)
  // =========================================================================
  if (S.church) {
    extrude(S.church, S.church.h || 25, createGothicHallMaterial());
    done.add('church');
  }

  // =========================================================================
  // MILLENNIUM TOWER: three concrete cylinders (roof 170 m, top floor 110 m), the observation disc, steel wings
  // =========================================================================
  if (S.millennium) {
    const s = S.millennium;
    const top = s.h || 170;
    const R = Math.min(s.w, s.d) * 0.14;
    const heights = [top, top * 0.86, top * 0.74];
    heights.forEach((h, k) => {
      const a = (s.ang || 0) + (k * Math.PI * 2) / 3;
      const px = s.x + Math.cos(a) * R * 1.25, pz = s.z - Math.sin(a) * R * 1.25;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.82, R, h, 28), concrete);
      c.position.set(px, h / 2, pz);
      c.castShadow = c.receiveShadow = true;
      group.add(c);
      colliders.push({ minX: px - R, maxX: px + R, minZ: pz - R, maxZ: pz + R, maxY: h });
      // a steel wing fanning out & up from the base, away from the core
      const wing = new THREE.Shape();
      wing.moveTo(0, 0);
      wing.lineTo(R * 3.2, 0);
      wing.quadraticCurveTo(R * 3.4, 22, R * 1.2, 48);
      wing.lineTo(0, 40);
      wing.closePath();
      const g = new THREE.ExtrudeGeometry(wing, { depth: 0.4, bevelEnabled: false });
      g.translate(R * 1.4, 0, -0.2);
      const w = new THREE.Mesh(g, steel);
      w.position.set(s.x, 0, s.z);
      w.rotation.y = a;
      w.castShadow = true;
      group.add(w);
    });
    // the two-floor disc of the observation deck & restaurant, near the first peak
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(R * 3.3, R * 2.9, 7, 40), glassDark);
    disc.position.set(s.x, 110 - 3.5, s.z);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 3.4, R * 3.4, 1.0, 40), concrete);
    rim.position.set(s.x, 110 + 0.4, s.z);
    disc.castShadow = rim.castShadow = true;
    group.add(disc, rim);
    done.add('millennium');
  }

  // =========================================================================
  // NATIONAL ASSEMBLY: the white building under its green dome
  // =========================================================================
  if (S.assembly) {
    const s = S.assembly;
    const H = 15;
    extrude(s, H, white);
    const R = Math.min(s.d * 0.42, 18);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.05, R * 1.08, 6, 40), white);
    drum.position.set(s.x, H + 3, s.z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), green);
    dome.position.set(s.x, H + 6, s.z);
    drum.castShadow = dome.castShadow = true;
    group.add(drum, dome);
    done.add('assembly');
  }

  // =========================================================================
  // EAGLE SQUARE: granite paving & the national flag (green, white, green)
  // =========================================================================
  if (S.eagleSquare) {
    const s = S.eagleSquare;
    const paving = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
    paving.colorNode = Fn(() => {
      const p = positionWorld.xz;
      const joints = max(smoothstep(0.04, 0.0, abs(fract(p.x.div(1.2)).sub(0.5)).sub(0.46)), smoothstep(0.04, 0.0, abs(fract(p.y.div(1.2)).sub(0.5)).sub(0.46)));
      return mix(color(0xc9c4ba), color(0x9d988e), joints);
    })();
    group.add(createFlatPolygonMesh(ringPts(s.ring), SW_Y + 0.01, paving, true));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 30, 10), steel);
    pole.position.set(s.x, 15, s.z);
    const flag = new THREE.Group();
    const stripe = (hex, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.8), new THREE.MeshStandardNodeMaterial({ color: hex, side: THREE.DoubleSide, roughness: 0.8 }));
      m.position.set(1.2 + k * 2.4, 0, 0);
      return m;
    };
    flag.add(stripe(0x008751, 0), stripe(0xffffff, 1), stripe(0x008751, 2));
    flag.position.set(s.x, 27.4, s.z);
    group.add(pole, flag);
    colliders.push({ minX: s.x - 0.3, maxX: s.x + 0.3, minZ: s.z - 0.3, maxZ: s.z + 0.3, maxY: 30 });
    done.add('eagleSquare');
  }

  // =========================================================================
  // UNITY FOUNTAIN: the basin & its water
  // =========================================================================
  if (S.unityFountain) {
    const s = S.unityFountain;
    const r = Math.min(s.w, s.d) / 2;
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.9, 48, 1, true), white);
    basin.position.set(s.x, SW_Y + 0.45, s.z);
    const water = new THREE.Mesh(new THREE.CircleGeometry(r - 0.2, 48).rotateX(-Math.PI / 2), createWaterMaterial());
    water.position.set(s.x, SW_Y + 0.7, s.z);
    basin.material.side = THREE.DoubleSide;
    group.add(basin, water);
    done.add('unityFountain');
  }

  // =========================================================================
  // THE OTHER MAPPED LANDMARK BUILDINGS, extruded from their outlines to their mapped heights (an estimate of four
  // storeys where none is mapped): glass for the towers, white render for the rest. Parks, the lake, the Villa grounds
  // & the like are areas, not buildings (city-grid.js draws them).
  // =========================================================================
  const AREAS = new Set(['millenniumPark', 'shagariPark', 'centralPark', 'arboretum', 'jabiLake', 'villa', 'wtc', 'golf', 'shipHouse', 'fedSecretariat', 'nnpc']);
  const glassTower = createCurtainWallMaterial({ glassTint: 0x22465a, frameTint: 0x9aa4ab, windowWidth: 1.6, floorHeight: 4.0, litProbability: 0.5, warmth: 0.55, reflectivity: 0.93, seed: 101.0, boxLocal: true });
  const rendered = createRenderedFacadeMaterial({ windowWidth: 2.6, floorHeight: 3.8, windowRatioX: 0.55, windowRatioY: 0.55, seed: 211.0 });
  const glassBoxes = [], renderedBoxes = [];
  // Toronto: only the landmarks left out of the 3D Massing (tools/geo-features.mjs MODELLED) would need this; the
  // others stand in the massing already
  const EXTRUDED = new Set();
  for (const [id, s] of Object.entries(S)) {
    if (!EXTRUDED.has(id) || done.has(id) || AREAS.has(id) || !s.ring || !s.w) continue;
    const h = s.h || (s.levels ? s.levels * 3.8 + 1 : 15);
    const rectish = s.area / (s.w * s.d) > 0.88;
    const tower = h >= 40;
    if (rectish) {
      // a facade box on the minimum rectangle
      const box = { x: s.x, y: h / 2, z: s.z, w: s.w, h, d: s.d, ry: s.ang || 0, tone: 0.5, faces: [WALL_KINDS.entry, WALL_KINDS.rear, WALL_KINDS.rear, WALL_KINDS.rear], paint: [...linear(0xefebe3), 0.8] };
      (tower ? glassBoxes : renderedBoxes).push(box);
      boxCollider(s.x, s.z, s.w / 2, s.d / 2, s.ang || 0, h);
    } else {
      extrude(s, h, tower ? glassDark : white);
    }
    done.add(id);
  }
  if (glassBoxes.length) group.add(createFacadeBoxes(glassTower, glassBoxes));
  if (renderedBoxes.length) group.add(createFacadeBoxes(rendered, renderedBoxes));

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.castShadow || false;
      o.receiveShadow = true;
    }
  });
  scene.add(group);
  console.info(`[landmarks] ${done.size} landmarks built: ${[...done].join(', ')}`);
  if (footprintMs) console.info(`[landmarks] colliders from the drawn outlines: ${colliders.filter((c) => c.polygon).length} in ${Math.round(footprintMs)} ms`);
  return { group, colliders };
}

Object.assign(window.CITY, { buildLandmarks });
})();
