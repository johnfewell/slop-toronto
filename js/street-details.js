(function () {
// js/street-details.js
// Abuja's street furniture & greenery, on the real streets & blocks (city-config.js):
// - Traffic signals where OpenStreetMap maps them (city-config.js SIGNAL_JUNCTIONS): a pole on the near-right corner of
//   every approach, three-aspect heads facing the traffic, a mast arm over the wide roads, their phases shared with
//   js/traffic.js (the major road's group 0 first); and at the signalised pedestrian crossings (SIGNAL_CROSSINGS), a
//   red / green man pole on either kerb
// - Streetlights: the tall double-arm poles down the medians of the dual carriageways, single-arm poles along the
//   other roads (some with a solar panel on top), their light pooled around the camera at night
// - Trees: neem, Indian almond & mango on the verges and in the wide medians, royal palms down the medians of the
//   ceremonial roads, parkland & savanna trees, and the mango & neem trees in the compound yards

const { THREE } = window.CITY;
const { Fn, float, color, positionWorld, uniform, mod, step, mix, smoothstep, uv, texture, abs, fract } = window.CITY.TSL;
const { mergeGeometries } = window.CITY.Addons;
const { GEO, BLOCKS, ROADS, SIGNAL_TIMING, SIGNAL_JUNCTIONS, SIGNAL_CROSSINGS, nearestRoads, blockAt, pointInPoly, cityUniforms, offsetPolygonInward } = window.CITY;
const { createTreeField } = window.CITY;


/**
 * TSL 3-Aspect Traffic Signal Lens Material (Red y=5.78, Amber y=5.42, Green y=5.06)
 * Driven by the shared signal clock and SIGNAL_TIMING (city-config.js), which js/traffic.js obeys.
 */
function createTrafficSignalLensMaterial(isAvenueHead, clock) {
  const { cycle, avenueAmber, avenueRed, streetAmber } = SIGNAL_TIMING;
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const t = mod(clock, cycle);
    const wy = positionWorld.y;
    const isTopRed = step(5.60, wy);
    const isBottomGreen = float(1.0).sub(step(5.24, wy));
    const isMidAmber = float(1.0).sub(isTopRed).mul(float(1.0).sub(isBottomGreen));

    // Avenue phase: Green, then Amber from avenueAmber, Red from avenueRed
    // Street phase: Red until avenueRed, then Green, Amber from streetAmber
    const greenActive = isAvenueHead
      ? float(1.0).sub(step(avenueAmber, t))
      : step(avenueRed, t).mul(float(1.0).sub(step(streetAmber, t)));
    const amberActive = isAvenueHead
      ? step(avenueAmber, t).mul(float(1.0).sub(step(avenueRed, t)))
      : step(streetAmber, t);
    const redActive = isAvenueHead
      ? step(avenueRed, t)
      : float(1.0).sub(step(avenueRed, t));

    const activeMask = isTopRed.mul(redActive)
      .add(isMidAmber.mul(amberActive))
      .add(isBottomGreen.mul(greenActive));

    const lensHue = mix(
      mix(color(0x18ff68), color(0xffaa10), isMidAmber),
      color(0xff2424),
      isTopRed
    );
    return mix(color(0x14181e), lensHue.mul(1.35), activeMask);
  })();
  return mat;
}

// Royal-palm frond: a rachis with pinnate leaflets drooping either side, drawn once into an alpha-tested texture
// (u: across the frond, v: from its base at v = 0 to its tip)
let _frondTexture = null;
function getFrondTexture() {
  if (_frondTexture) return _frondTexture;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 512);
  for (let i = 0; i < 70; i++) {
    const v = 0.06 + (i / 70) * 0.92;
    const y = 512 - v * 512;
    const len = 58 * Math.sin(Math.PI * Math.min(1, v * 1.05)) + 6;
    for (const side of [-1, 1]) {
      const g = 90 + Math.floor(((i * 37) % 23) * 2.2);
      ctx.strokeStyle = `rgb(${40 + (i % 5) * 3}, ${g}, ${35 + (i % 7) * 2})`;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(64, y);
      ctx.quadraticCurveTo(64 + side * len * 0.6, y - 6, 64 + side * len, y + 14);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#7d8a4a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(64, 512);
  ctx.lineTo(64, 8);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _frondTexture = tex;
  return tex;
}

// One palm: a slightly swollen grey trunk with ring scars, a green crownshaft and 14 arching fronds (two meshes: trunk
// & fronds), height 1 = ~14 m at scale 1
function buildPalmGeometries() {
  const trunkParts = [];
  const H = 11.0;
  const trunk = new THREE.CylinderGeometry(0.2, 0.26, H, 10, 12, true);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i) / H + 0.5; // 0..1 up the trunk
    const swell = 1 + 0.18 * Math.exp(-((y - 0.25) ** 2) / 0.02);
    tp.setX(i, tp.getX(i) * swell);
    tp.setZ(i, tp.getZ(i) * swell);
  }
  trunk.translate(0, H / 2, 0);
  trunkParts.push(trunk.toNonIndexed());
  const shaft = new THREE.CylinderGeometry(0.2, 0.21, 2.0, 10, 1, true).translate(0, H + 1.0, 0);
  trunkParts.push(shaft.toNonIndexed());
  // colour per vertex: grey trunk, green crownshaft
  const trunkGeo = mergeGeometries(trunkParts, false);
  const col = new Float32Array(trunkGeo.attributes.position.count * 3);
  for (let i = 0; i < col.length / 3; i++) {
    const y = trunkGeo.attributes.position.getY(i);
    const c = y > H + 0.05 ? [0.24, 0.36, 0.15] : [0.48, 0.46, 0.42];
    col.set(c, i * 3);
  }
  trunkGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const fronds = [];
  const N = 14;
  for (let k = 0; k < N; k++) {
    const az = (k / N) * Math.PI * 2 + (k % 2) * 0.2;
    const rise = k % 3 === 0 ? 0.55 : k % 3 === 1 ? 0.15 : -0.25; // some up, most arching out & down
    const L = 4.4;
    const SEG = 7;
    const pos = [], uvs = [], nor = [];
    const pts = [];
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const out = L * t;
      const up = rise * L * t - 2.6 * t * t * t; // arching then drooping at the tip
      pts.push([Math.cos(az) * out, H + 2.0 + up, Math.sin(az) * out]);
    }
    const side = [-Math.sin(az), 0, Math.cos(az)];
    for (let s = 0; s < SEG; s++) {
      const w0 = 1.1 * Math.sin(Math.PI * Math.min(1, (s / SEG) * 1.05)) + 0.15;
      const w1 = 1.1 * Math.sin(Math.PI * Math.min(1, ((s + 1) / SEG) * 1.05)) + 0.15;
      const a = pts[s], b = pts[s + 1];
      const quad = [
        [a[0] - side[0] * w0, a[1] - 0.12, a[2] - side[2] * w0, 0, s / SEG],
        [a[0] + side[0] * w0, a[1] - 0.12, a[2] + side[2] * w0, 1, s / SEG],
        [b[0] + side[0] * w1, b[1] - 0.12, b[2] + side[2] * w1, 1, (s + 1) / SEG],
        [b[0] - side[0] * w1, b[1] - 0.12, b[2] - side[2] * w1, 0, (s + 1) / SEG]
      ];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const q = quad[i];
        pos.push(q[0], q[1], q[2]);
        uvs.push(q[3], q[4]);
        nor.push(0, 1, 0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    fronds.push(g);
  }
  return { trunk: trunkGeo, fronds: mergeGeometries(fronds, false) };
}

function buildStreetDetails(scene) {
  const group = new THREE.Group();
  group.name = 'CityStreetDetails';
  const dummy = new THREE.Object3D();
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const SW_Y = 0.22;

  // Ground footprints of street furniture that traffic and pedestrians must keep clear of
  const footprints = [];
  const addFootprint = (x, z, w, d) => footprints.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  const hashPos = (x, y, z) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };

  // Poles already standing (streetlights, signals): nothing else within a few metres
  const poleCells = new Map();
  const poleKey = (x, z) => Math.floor(x / 8) * 100000 + Math.floor(z / 8);
  function isClearOfPoles(x, z, r) {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const p of poleCells.get((Math.floor(x / 8) + a) * 100000 + Math.floor(z / 8) + b) || []) {
        if (Math.hypot(p.x - x, p.z - z) < r) return false;
      }
    }
    return true;
  }
  function addPole(x, z) {
    const k = poleKey(x, z);
    (poleCells.get(k) || poleCells.set(k, []).get(k)).push({ x, z });
  }

  // Every at-grade road, in 40 m cells: what fronts a curb edge (its class, half width)
  const roadCells = new Map();
  for (const r of ROADS) {
    if (r.raised) continue;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      for (let ix = Math.floor(Math.min(a.x, b.x) / 40); ix <= Math.floor(Math.max(a.x, b.x) / 40); ix++) {
        for (let iz = Math.floor(Math.min(a.z, b.z) / 40); iz <= Math.floor(Math.max(a.z, b.z) / 40); iz++) {
          const k = ix * 100000 + iz;
          (roadCells.get(k) || roadCells.set(k, []).get(k)).push([a, b, r]);
        }
      }
    }
  }
  function roadNear(x, z, within) {
    let best = null, bd = within;
    for (const [a, b, r] of roadCells.get(Math.floor(x / 40) * 100000 + Math.floor(z / 40)) || []) {
      const ex = b.x - a.x, ez = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
      const d = Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  // Walk along a block's curb every `step` metres (from `offset`), calling fn(x, z, ux, uz, inx, inz) with the curb's
  // direction and the inward normal (into the block)
  function alongCurb(b, step, offset, fn) {
    const P = b.poly;
    let s = -offset;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], c = P[(i + 1) % P.length];
      const L = Math.hypot(c.x - a.x, c.z - a.z);
      if (L < 0.01) continue;
      const ux = (c.x - a.x) / L, uz = (c.z - a.z) / L;
      const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
      let inx = -uz, inz = ux;
      if (blockAt(mx + inx * 1.2, mz + inz * 1.2) !== b) { inx = uz; inz = -ux; }
      if (blockAt(mx + inx * 1.2, mz + inz * 1.2) !== b) { s += L; continue; }
      let t = s <= 0 ? -s : step - (s % step);
      if (s <= 0) t = -s;
      for (; t < L; t += step) fn(a.x + ux * t, a.z + uz * t, ux, uz, inx, inz, L);
      s += L;
    }
  }

  // Signal clock (seconds), set every frame by main.js
  const signalClock = uniform(0);

  // Shared materials
  const poleMetalMat = new THREE.MeshStandardNodeMaterial({ color: 0x8e9396, roughness: 0.42, metalness: 0.75 }); // galvanised
  const signalHousingMat = new THREE.MeshStandardNodeMaterial({ color: 0x17191b, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
  const aveSignalLensMat = createTrafficSignalLensMaterial(true, signalClock);
  const streetSignalLensMat = createTrafficSignalLensMaterial(false, signalClock);
  const lampLensGlow = new THREE.MeshBasicNodeMaterial();
  lampLensGlow.colorNode = mix(color(0x8f918c), color(0xfff1d6).mul(2.1), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const solarMat = new THREE.MeshStandardNodeMaterial({ color: 0x1b2a44, roughness: 0.18, metalness: 0.6 });

  // =========================================================================
  // 1. TRAFFIC SIGNALS
  // =========================================================================
  // Three-section head (centre at y = 5.42; the lens material picks red / amber / green from each lens's world height:
  // 5.78 / 5.42 / 5.06), lenses on both faces, tunnel visors
  const HEAD_W = 0.4, HEAD_H = 1.12, HEAD_D = 0.28, LENS_R = 0.145, LENS_Y = [0.36, 0, -0.36];
  const bothFaces = (geo) => [geo, geo.clone().rotateY(Math.PI)];
  const signalHousingGeo = mergeGeometries([
    new THREE.BoxGeometry(HEAD_W, HEAD_H, HEAD_D),
    ...LENS_Y.flatMap((ly) => bothFaces(
      new THREE.CylinderGeometry(LENS_R + 0.03, LENS_R + 0.03, 0.24, 14, 1, true, Math.PI / 2, Math.PI)
        .rotateX(Math.PI / 2).translate(0, ly, HEAD_D / 2 + 0.12)
    ))
  ].map((g) => g.toNonIndexed()));
  const signalLensGeo = mergeGeometries(LENS_Y.flatMap((ly) => bothFaces(new THREE.CircleGeometry(LENS_R, 18).translate(0, ly, HEAD_D / 2 + 0.004))));
  // Pedestrian head: two square aspects, red man (y 3.25) over green man (y 2.85); green while the cross traffic holds red
  const pedHousingGeo = new THREE.BoxGeometry(0.34, 0.74, 0.22).toNonIndexed();
  const pedLensGeo = mergeGeometries([0.2, -0.2].flatMap((ly) => bothFaces(new THREE.PlaneGeometry(0.24, 0.24).translate(0, ly, 0.114))));
  const pedLensMat = new THREE.MeshBasicNodeMaterial();
  pedLensMat.colorNode = Fn(() => {
    const t = mod(signalClock, SIGNAL_TIMING.cycle);
    const isRed = step(3.05, positionWorld.y);
    const walk = step(SIGNAL_TIMING.avenueRed + 1, t);
    const on = mix(walk, float(1).sub(walk), isRed);
    return mix(color(0x14181e), mix(color(0x2bff8a), color(0xff3a2a), isRed).mul(1.3), on);
  })();
  const poleMatrices = [], armMatrices = [], headMatrices = [], aveLensMatrices = [], streetLensMatrices = [];
  {
    const RG = GEO.roadGraph;
    const nodeLinks = new Map();
    RG.links.forEach((l) => {
      for (const n of [l[0], l[1]]) (nodeLinks.get(n) || nodeLinks.set(n, []).get(n)).push(l);
    });
    const nodeAt = new Map();
    for (let i = 0; i < RG.nodes.length / 2; i++) nodeAt.set(`${RG.nodes[2 * i]},${RG.nodes[2 * i + 1]}`, i);
    let heads = 0;
    for (const j of SIGNAL_JUNCTIONS) {
      // the arms leaving the junction's nodes: direction, half width, whether traffic arrives along it, its score
      const arms = [];
      const inJunction = new Set(j.pts.map((p) => `${p.x},${p.z}`));
      for (const p of j.pts) {
        const n = nodeAt.get(`${p.x},${p.z}`);
        if (n === undefined) continue;
        const links = nodeLinks.get(n) || [];
        const nodeHalf = Math.max(...links.map((l) => l[3] / 2));
        for (const l of links) {
          const [a, b, , w, lanes, dir, inner, rank] = l;
          const atA = a === n;
          const far = atA ? b : a;
          // a link to another node of the same junction (between the carriageways of a dual road) is not an approach
          if (inJunction.has(`${RG.nodes[2 * far]},${RG.nodes[2 * far + 1]}`)) continue;
          const other = atA ? (inner.length ? [inner[0], inner[1]] : [RG.nodes[2 * b], RG.nodes[2 * b + 1]])
            : (inner.length ? [inner[inner.length - 2], inner[inner.length - 1]] : [RG.nodes[2 * a], RG.nodes[2 * a + 1]]);
          const ux = other[0] - p.x, uz = other[1] - p.z;
          const L = Math.hypot(ux, uz) || 1;
          // traffic arrives at the junction along this arm unless the link only runs away from it
          const arrives = dir === 0 || (dir > 0 ? !atA : atA);
          const ave = w >= 14.5 || lanes >= 3 || rank >= 3;
          arms.push({ ux: ux / L, uz: uz / L, hw: w / 2, arrives, score: (ave ? 100 : 0) + w / 2, x: p.x, z: p.z, back: nodeHalf + 3 });
        }
      }
      if (arms.length < 3) continue;
      // the major road (right of way, group 0): the best-scoring arm and the arm most nearly opposite it
      const lead = arms.reduce((m, a) => (a.score > m.score ? a : m));
      const isMajor = (a) => a.ux * lead.ux + a.uz * lead.uz > 0.82 || a.ux * lead.ux + a.uz * lead.uz < -0.82;
      for (const a of arms) {
        if (!a.arrives) continue;
        // near-right corner of the approach (traffic heading -u: its right is (u.z, -u.x)), before the crossing road
        const rx = a.uz, rz = -a.ux;
        let pole = null;
        for (const back of [a.back, a.back + 3, a.back + 7]) {
          for (let side = a.hw + 1.2; side <= a.hw + 6 && !pole; side += 0.8) {
            const x = a.x + a.ux * back + rx * side;
            const z = a.z + a.uz * back + rz * side;
            if (blockAt(x, z) && isClearOfPoles(x, z, 1.5)) pole = { x, z, side };
          }
          if (pole) break;
        }
        if (!pole) continue;
        addPole(pole.x, pole.z);
        addFootprint(pole.x, pole.z, 0.4, 0.4);
        const yaw = Math.atan2(a.ux, a.uz); // heads face the approaching traffic (lenses on both faces anyway)
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(pole.x, SW_Y + 3.1, pole.z);
        dummy.scale.set(0.09, 6.2, 0.09);
        dummy.updateMatrix();
        poleMatrices.push(dummy.matrix.clone());
        const lens = isMajor(a) ? aveLensMatrices : streetLensMatrices;
        const placeHead = (x, z) => {
          dummy.position.set(x, 5.42, z);
          dummy.rotation.set(0, yaw, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          headMatrices.push(dummy.matrix.clone());
          lens.push(dummy.matrix.clone());
          heads++;
        };
        placeHead(pole.x - rx * 0.32, pole.z - rz * 0.32);
        // a mast arm over the lanes of a wide approach, a second head above them
        if (a.hw >= 4.5) {
          const reach = Math.min(a.hw + pole.side - 1.5, 9);
          dummy.position.set(pole.x - rx * reach / 2, 6.25, pole.z - rz * reach / 2);
          dummy.scale.set(0.12, 0.12, reach);
          dummy.rotation.set(0, Math.atan2(rx, rz), 0);
          dummy.updateMatrix();
          armMatrices.push(dummy.matrix.clone());
          placeHead(pole.x - rx * reach * 0.8, pole.z - rz * reach * 0.8);
        }
      }
    }
    console.info(`[streetDetails] ${heads} signal heads at ${SIGNAL_JUNCTIONS.length} signalised junctions`);
  }

  // Signalised pedestrian crossings: a pole on either kerb, its red / green man facing the far kerb
  const pedHeadMatrices = [];
  {
    for (const c of SIGNAL_CROSSINGS) {
      const near = nearestRoads(c.x, c.z, 25).find((n) => !n.road.raised);
      if (!near) continue;
      const nx = -near.dz, nz = near.dx; // across the road
      for (const sgn of [1, -1]) {
        let pole = null;
        for (let d = near.road.w / 2 + 0.8; d < near.road.w / 2 + 6; d += 0.8) {
          const x = near.px + nx * d * sgn, z = near.pz + nz * d * sgn;
          if (blockAt(x, z) && isClearOfPoles(x, z, 1.2)) { pole = { x, z }; break; }
        }
        if (!pole) continue;
        addPole(pole.x, pole.z);
        addFootprint(pole.x, pole.z, 0.3, 0.3);
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(pole.x, SW_Y + 1.6, pole.z);
        dummy.scale.set(0.06, 3.2, 0.06);
        dummy.updateMatrix();
        poleMatrices.push(dummy.matrix.clone());
        dummy.position.set(pole.x, 3.05, pole.z);
        dummy.rotation.set(0, Math.atan2(-nx * sgn, -nz * sgn), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        pedHeadMatrices.push(dummy.matrix.clone());
      }
    }
    console.info(`[streetDetails] ${pedHeadMatrices.length} pedestrian signals at ${SIGNAL_CROSSINGS.length} crossings`);
  }

  // =========================================================================
  // 2. STREETLIGHTS
  // =========================================================================
  // Galvanised poles with LED luminaires: double-arm 11 m poles down the medians, single-arm 9 m poles on the verges
  const lampHeadGeo = new THREE.BoxGeometry(0.75, 0.16, 0.34);
  const lampLensGeo = new THREE.PlaneGeometry(0.62, 0.26).rotateX(Math.PI / 2).translate(0, -0.085, 0);
  const lampHeadMatrices = [], solarMatrices = [];
  const lampSites = []; // { x, y, z, tx, tz }: spot light positions & targets for the night pools
  const placeLuminaire = (px, pz, hx, hz, y, yaw) => {
    dummy.position.set(hx, y, hz);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    lampHeadMatrices.push(dummy.matrix.clone());
    lampSites.push({ x: hx, y: y - 0.1, z: hz, tx: hx + (hx - px) * 1.2, tz: hz + (hz - pz) * 1.2 });
  };
  const placeArm = (px, pz, dx, dz, len, y) => {
    dummy.position.set(px + dx * len / 2, y, pz + dz * len / 2);
    dummy.rotation.set(0, Math.atan2(dx, dz), 0);
    dummy.scale.set(0.07, 0.07, len);
    dummy.updateMatrix();
    armMatrices.push(dummy.matrix.clone());
  };
  let medianPoles = 0, roadPoles = 0;
  for (const b of BLOCKS) {
    if (b.median) {
      // the median's mean width (2 area / perimeter): a pole down its middle every ~36 m, an arm over each roadway
      let per = 0;
      for (let i = 0; i < b.poly.length; i++) {
        const a = b.poly[i], c = b.poly[(i + 1) % b.poly.length];
        per += Math.hypot(c.x - a.x, c.z - a.z);
      }
      const width = (2 * b.area) / per;
      if (width < 1.2 || b.area < 250) continue;
      alongCurb(b, 36, 12, (x, z, ux, uz, inx, inz) => {
        const px = x + inx * width * 0.5, pz = z + inz * width * 0.5;
        if (blockAt(px, pz) !== b || !isClearOfPoles(px, pz, 28)) return;
        addPole(px, pz);
        addFootprint(px, pz, 0.45, 0.45);
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(px, SW_Y + 5.5, pz);
        dummy.scale.set(0.12, 11, 0.12);
        dummy.updateMatrix();
        poleMatrices.push(dummy.matrix.clone());
        for (const sgn of [1, -1]) {
          const reach = width * 0.5 + 1.6;
          placeArm(px, pz, inx * sgn, inz * sgn, reach, SW_Y + 10.8);
          placeLuminaire(px, pz, px + inx * sgn * reach, pz + inz * sgn * reach, SW_Y + 10.75, Math.atan2(ux, uz));
        }
        medianPoles++;
      });
      continue;
    }
    if (b.park > 0.6 || b.wild > 0.5) continue;
    // roadside poles on the verge, an arm out over the road, unless the road has median lights already
    alongCurb(b, 46, 9, (x, z, ux, uz, inx, inz) => {
      const r = roadNear(x - inx * 3, z - inz * 3, 12);
      if (!r || r.rank < 1 || r.cls === 'service') return;
      const step = r.rank >= 2 ? 1 : hashPos(x, 1.7, z) < 0.65 ? 1 : 0;
      if (!step) return;
      const across = blockAt(x - inx * (r.w + 3.5), z - inz * (r.w + 3.5));
      if (across && across.median) return;
      const px = x + inx * 0.8, pz = z + inz * 0.8;
      if (blockAt(px, pz) !== b || !isClearOfPoles(px, pz, 20)) return;
      addPole(px, pz);
      addFootprint(px, pz, 0.4, 0.4);
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(px, SW_Y + 4.5, pz);
      dummy.scale.set(0.1, 9, 0.1);
      dummy.updateMatrix();
      poleMatrices.push(dummy.matrix.clone());
      const reach = Math.min(2.6, r.w * 0.3 + 1);
      placeArm(px, pz, -inx, -inz, reach, SW_Y + 8.9);
      placeLuminaire(px, pz, px - inx * reach, pz - inz * reach, SW_Y + 8.85, Math.atan2(ux, uz));
      if (hashPos(px, 4.4, pz) < 0.5) {
        // a solar panel tilted on top
        dummy.position.set(px, SW_Y + 9.35, pz);
        dummy.rotation.set(0.35, Math.atan2(inx, inz), 0);
        dummy.scale.set(1.2, 0.05, 0.9);
        dummy.updateMatrix();
        solarMatrices.push(dummy.matrix.clone());
      }
      roadPoles++;
    });
  }
  console.info(`[streetDetails] ${medianPoles} median & ${roadPoles} roadside streetlights`);

  // =========================================================================
  // 3. TREES & PALMS
  // =========================================================================
  // Buildings' rough occupancy (4 m cells), so yard trees stand clear of the houses
  const occupied = new Set();
  for (const bl of GEO.buildings) {
    const [cx, cz, ang, parts] = bl;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    for (const [u0, u1, v0, v1] of parts) {
      for (let u = u0; u <= u1; u += 2) for (let v = v0; v <= v1; v += 2) {
        const x = cx + u * cs + v * sn, z = cz - u * sn + v * cs;
        occupied.add(Math.floor(x / 4) * 100000 + Math.floor(z / 4));
      }
    }
  }
  const clearOfBuildings = (x, z) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (occupied.has((Math.floor(x / 4) + a) * 100000 + Math.floor(z / 4) + b)) return false;
    return true;
  };
  const treePositions = [];
  const palms = [];
  const cityStreetTrees = !!(GEO.streetTrees && GEO.streetTrees.length);
  // neem (feathery pinnate leaves, dense crown), Indian almond (tiered horizontal branches), mango (dense dark dome)
  const broadleaf = (r) => (r < 0.45 ? 0 : r < 0.8 ? 1 : 2);
  const ceremonial = new Set(['Central Business District', 'Three Arms Zone', 'Maitama', 'Asokoro']);
  const SW = GEO.frame.sidewalk;
  for (const b of BLOCKS) {
    if (b.median) {
      let per = 0;
      for (let i = 0; i < b.poly.length; i++) {
        const a = b.poly[i], c = b.poly[(i + 1) % b.poly.length];
        per += Math.hypot(c.x - a.x, c.z - a.z);
      }
      const width = (2 * b.area) / per;
      if (width < 3) continue;
      // Toronto: the City's street tree inventory (GEO.streetTrees, ez-trees.js) has the median & verge trees
      if (cityStreetTrees) continue;
      const usePalms = ceremonial.has(b.district) || width < 5;
      alongCurb(b, usePalms ? 15 : 20, 7, (x, z, ux, uz, inx, inz) => {
        const px = x + inx * width * 0.5, pz = z + inz * width * 0.5;
        if (blockAt(px, pz) !== b || !isClearOfPoles(px, pz, 4) || hashPos(px, 2.3, pz) < 0.15) return;
        addPole(px, pz);
        if (usePalms) palms.push({ x: px, z: pz, s: 0.85 + hashPos(px, 5.1, pz) * 0.3, yaw: hashPos(pz, 1.1, px) * 6.28 });
        else treePositions.push({ x: px, y: SW_Y, z: pz, scale: 0.6 + hashPos(px, 3.3, pz) * 0.25, species: broadleaf(hashPos(px, 7.7, pz)), tier: 1 });
      });
      continue;
    }
    if (b.park > 0.6 || b.wild > 0.5) {
      // parkland: trees every ~18 m (a few palms); open savanna: scattered trees every ~40 m
      const park = b.park > 0.6;
      const spacing = park ? 18 : 40;
      const cap = park ? 700 : 450;
      let n = 0;
      for (let x = b.minX + spacing / 2; x < b.maxX && n < cap; x += spacing) {
        for (let z = b.minZ + spacing / 2; z < b.maxZ && n < cap; z += spacing) {
          const jx = x + (hashPos(x, 1, z) - 0.5) * spacing * 0.8, jz = z + (hashPos(z, 2, x) - 0.5) * spacing * 0.8;
          if (hashPos(jx, 9, jz) < (park ? 0.35 : 0.55)) continue;
          if (!pointInPoly(b.poly, jx, jz) || !clearOfBuildings(jx, jz)) continue;
          if (park && hashPos(jx, 6, jz) < 0.12) palms.push({ x: jx, z: jz, s: 0.8 + hashPos(jx, 5, jz) * 0.35, yaw: hashPos(jz, 1, jx) * 6.28 });
          else treePositions.push({ x: jx, y: SW_Y, z: jz, scale: (park ? 0.75 : 0.55) + hashPos(jx, 3, jz) * 0.4, species: broadleaf(hashPos(jx, 7, jz)), tier: 0 });
          n++;
        }
      }
      continue;
    }
    // verge trees, ~2.6 m in from the kerb, every ~22 m where the road isn't a service lane (Toronto: the City's own)
    if (!cityStreetTrees) alongCurb(b, 22, 6, (x, z, ux, uz, inx, inz) => {
      const px = x + inx * 2.6, pz = z + inz * 2.6;
      if (hashPos(px, 3.1, pz) < 0.3 || blockAt(px, pz) !== b || !isClearOfPoles(px, pz, 5) || !clearOfBuildings(px, pz)) return;
      const r = roadNear(x - inx * 3, z - inz * 3, 12);
      if (!r || r.cls === 'service') return;
      treePositions.push({ x: px, y: SW_Y, z: pz, scale: 0.55 + hashPos(pz, 3.1, px) * 0.3, species: broadleaf(hashPos(px, 8.3, pz)), tier: 1 });
    });
    // compound yards: a mango, neem or palm or two behind the walls, ~one per 1100 m², clear of the houses
    const yard = b.area > 600 ? offsetPolygonInward(b.poly, SW + 1.5) : null;
    if (!yard) continue;
    const want = Math.min(30, Math.floor(b.area / 1100));
    let n = 0;
    for (let k = 0; k < want * 4 && n < want; k++) {
      const x = b.minX + hashPos(b.cx + k, 4.1, b.cz) * (b.maxX - b.minX);
      const z = b.minZ + hashPos(b.cz - k, 5.2, b.cx) * (b.maxZ - b.minZ);
      if (!pointInPoly(yard, x, z) || !clearOfBuildings(x, z)) continue;
      if (hashPos(x, 6.6, z) < 0.18) palms.push({ x, z, s: 0.55 + hashPos(x, 5, z) * 0.3, yaw: hashPos(z, 1, x) * 6.28 });
      else treePositions.push({ x, y: SW_Y, z, scale: 0.5 + hashPos(z, 3.7, x) * 0.35, species: hashPos(x, 2.2, z) < 0.5 ? 2 : 0, tier: 2 });
      n++;
    }
  }
  palms.length = 0; // Toronto: no palms (the Abuja verges' royal palms)
  console.info(`[streetDetails] ${treePositions.length} trees`);

  // Palms: two instanced meshes (trunk, fronds)
  if (palms.length) {
    const { trunk, fronds } = buildPalmGeometries();
    const trunkMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85 });
    trunkMat.colorNode = Fn(() => {
      const c = window.CITY.TSL.attribute('color', 'vec3');
      const rings = smoothstep(0.3, 0.5, abs(fract(positionWorld.y.mul(2.6)).sub(0.5))).mul(0.18).add(0.82);
      return c.mul(rings);
    })();
    const frondMat = new THREE.MeshStandardNodeMaterial({ map: getFrondTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 });
    const trunkInst = new THREE.InstancedMesh(trunk, trunkMat, palms.length);
    const frondInst = new THREE.InstancedMesh(fronds, frondMat, palms.length);
    palms.forEach((p, i) => {
      dummy.position.set(p.x, SW_Y, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.set(p.s, p.s, p.s);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);
      frondInst.setMatrixAt(i, dummy.matrix);
      addFootprint(p.x, p.z, 0.6, 0.6);
    });
    trunkInst.castShadow = trunkInst.receiveShadow = true;
    frondInst.castShadow = frondInst.receiveShadow = true;
    trunkInst.name = 'PalmTrunks';
    frondInst.name = 'PalmFronds';
    group.add(trunkInst, frondInst);
  }

  // Trees: main.js draws these (the parkland & yard trees) with the City's street trees in John's EZ-Tree models
  // (ez-trees.js); mrdoob's procedural trees (js/trees.js) only if those don't load
  const addFallbackTrees = () => group.add(createTreeField(scene, treePositions).group);

  // Instanced poles, arms, luminaires & signal heads
  function addMatrixArrayInstanced(geo, mat, matrices, castShadow = true) {
    if (matrices.length === 0) return;
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    if (castShadow && !mat.isMeshBasicNodeMaterial) {
      inst.castShadow = true;
      inst.receiveShadow = true;
    }
    for (let i = 0; i < matrices.length; i++) inst.setMatrixAt(i, matrices[i]);
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }
  addMatrixArrayInstanced(unitCyl, poleMetalMat, poleMatrices);
  addMatrixArrayInstanced(unitBox, poleMetalMat, armMatrices);
  addMatrixArrayInstanced(signalHousingGeo, signalHousingMat, headMatrices);
  addMatrixArrayInstanced(pedHousingGeo, signalHousingMat, pedHeadMatrices);
  addMatrixArrayInstanced(pedLensGeo, pedLensMat, pedHeadMatrices, false);
  addMatrixArrayInstanced(signalLensGeo, aveSignalLensMat, aveLensMatrices, false);
  addMatrixArrayInstanced(signalLensGeo, streetSignalLensMat, streetLensMatrices, false);
  addMatrixArrayInstanced(lampHeadGeo, poleMetalMat, lampHeadMatrices);
  addMatrixArrayInstanced(lampLensGeo, lampLensGlow, lampHeadMatrices, false);
  addMatrixArrayInstanced(unitBox, solarMat, solarMatrices);

  // =========================================================================
  // 4. STREETLIGHT POOLS AT NIGHT: the nearest luminaires around the camera get a spot light each
  // =========================================================================
  const lampCells = new Map();
  for (const s of lampSites) {
    const k = Math.floor(s.x / 60) * 100000 + Math.floor(s.z / 60);
    (lampCells.get(k) || lampCells.set(k, []).get(k)).push(s);
  }
  const STREETLIGHT_SPOT_POOL = Math.round(40 * window.CITY.QUALITY.lightPool);
  const STREETLIGHT_DIST = 120;
  const streetLightsGroup = new THREE.Group();
  streetLightsGroup.name = 'StreetClusteredLights';
  scene.add(streetLightsGroup);
  const spotPool = [];
  for (let i = 0; i < STREETLIGHT_SPOT_POOL; i++) {
    const spot = new THREE.SpotLight(0xfff0d8, 0, 30, 1.0, 0.8, 1.25); // LED: whiter than the old sodium lamps
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    streetLightsGroup.add(spot, spot.target);
    spotPool.push(spot);
  }
  const active = [];
  const smoothFade = (d, start, end) => {
    const t = Math.min(1, Math.max(0, (end - d) / (end - start)));
    return t * t * (3 - 2 * t);
  };
  function update(camera) {
    if (!camera) return;
    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    const lampScale = Math.min(1.25, Math.max(0.0, (glow - 0.36) * 1.15));
    let used = 0;
    if (lampScale > 0.001) {
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      const me = camera.matrixWorld.elements;
      const fwdX = -me[8], fwdZ = -me[10];
      active.length = 0;
      const R = Math.ceil(STREETLIGHT_DIST / 60);
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
        for (const s of lampCells.get((Math.floor(cx / 60) + a) * 100000 + Math.floor(cz / 60) + b) || []) {
          const dx = s.x - cx, dz = s.z - cz;
          const d = Math.sqrt(dx * dx + dz * dz + (cy - s.y) * (cy - s.y));
          const eff = d + Math.max(0, 6.0 - (dx * fwdX + dz * fwdZ)) * 2.8;
          if (eff >= STREETLIGHT_DIST) continue;
          s._eff = eff;
          active.push(s);
        }
      }
      active.sort((p, q) => p._eff - q._eff);
      const cutoff = active.length > STREETLIGHT_SPOT_POOL ? active[STREETLIGHT_SPOT_POOL]._eff : STREETLIGHT_DIST;
      used = Math.min(active.length, STREETLIGHT_SPOT_POOL);
      for (let i = 0; i < used; i++) {
        const s = active[i];
        const spot = spotPool[i];
        spot.position.set(s.x, s.y, s.z);
        spot.target.position.set(s.tx, 0.0, s.tz);
        spot.target.updateMatrixWorld();
        spot.intensity = 92.0 * lampScale * smoothFade(s._eff, cutoff * 0.62, cutoff);
      }
    }
    for (let i = used; i < STREETLIGHT_SPOT_POOL; i++) {
      spotPool[i].intensity = 0;
      spotPool[i].position.set(0, -1000, 0);
    }
  }

  scene.add(group);
  return { group, footprints, signalClock, update, treePositions, addFallbackTrees };
}

Object.assign(window.CITY, { buildStreetDetails });
})();
