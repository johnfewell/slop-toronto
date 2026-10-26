(function () {
// js/pedestrian-signals.js
// What people crossing see, on the crossings the pedestrians really use (traffic.js & pedestrian-routes.js), from the
// City of Toronto's own signals & crossovers (js/toronto-traffic-data.js):
// - A pedestrian head at both ends of every crosswalk of a signalised junction, facing the far kerb, Toronto's: the
//   white walking person on the WALK, the orange hand flashing through the flashing don't walk, steady after it; each
//   in step with its junction's phase (signal-plan.js: the shifts the actuated lights move, as the signal heads read)
// - The midblock pedestrian signals: a pole on either kerb with a traffic head over the road and a pedestrian head
// - The pedestrian crossovers: a pole on either kerb, its mast arm out over the road with the yellow crossover sign and
//   two amber lights that flash while someone waits at it or walks on it (window.CITY.PXO_ACTIVE, traffic.js), and the
//   "Stop for pedestrians" sign on the pole
// All instanced: a handful of draws.

const { THREE, SIGNALS, SIGNAL_TIMING, PXOS = [], blockAt } = window.CITY;
const { Fn, float, color, uniformArray, instancedBufferAttribute, int, mod, step, mix, uv, texture, fract, positionWorld } = window.CITY.TSL;
const { mergeGeometries } = window.CITY.Addons;

// The aspects' symbols, white on transparent: the hand (left half), the walking person (right half)
function symbolTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  // hand: palm, four fingers, thumb
  g.save();
  g.translate(64, 70);
  g.beginPath();
  g.roundRect(-24, -10, 48, 46, 10);
  g.fill();
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    g.roundRect(-24 + k * 12.5, -46 + (k === 0 || k === 3 ? 8 : 0), 10, 44, 5);
    g.fill();
  }
  g.rotate(-0.6);
  g.beginPath();
  g.roundRect(-44, 4, 12, 30, 6);
  g.fill();
  g.restore();
  // walking person: head, body, arms & legs in stride
  g.save();
  g.translate(192, 64);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineWidth = 11;
  g.beginPath();
  g.arc(2, -40, 10, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(0, -26); g.lineTo(-4, 8); // body
  g.moveTo(-4, 8); g.lineTo(-18, 42); // back leg
  g.moveTo(-4, 8); g.lineTo(10, 24); g.lineTo(12, 44); // front leg
  g.moveTo(-1, -18); g.lineTo(-18, -2); // back arm
  g.moveTo(-1, -18); g.lineTo(16, -4); // front arm
  g.stroke();
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The crossover sign: fluorescent yellow-green, the black X, a pedestrian
function crossoverTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d7f20f';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#111';
  g.lineWidth = 8;
  g.strokeRect(8, 8, 240, 240);
  g.lineWidth = 26;
  g.lineCap = 'butt';
  g.beginPath();
  g.moveTo(44, 44); g.lineTo(212, 212);
  g.moveTo(212, 44); g.lineTo(44, 212);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// "Stop for pedestrians": white, the black words over a red STOP
function stopForTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f0';
  g.fillRect(0, 0, 128, 192);
  g.strokeStyle = '#111';
  g.lineWidth = 5;
  g.strokeRect(4, 4, 120, 184);
  g.textAlign = 'center';
  g.fillStyle = '#c8102e';
  g.font = '800 40px Arial, sans-serif';
  g.fillText('STOP', 64, 58);
  g.fillStyle = '#111';
  g.font = '700 22px Arial, sans-serif';
  g.fillText('FOR', 64, 98);
  g.fillText('PEDES-', 64, 130);
  g.fillText('TRIANS', 64, 160);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildPedestrianSignals(scene, traffic, signalClock) {
  const group = new THREE.Group();
  group.name = 'PedestrianSignals';
  const { network, pedRoutes } = traffic;
  const dummy = new THREE.Object3D();
  const SW_Y = 0.22;
  const CYCLE = SIGNAL_TIMING.cycle;
  const shifts = uniformArray(SIGNALS.shifts, 'float');
  const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0x8e9396, roughness: 0.42, metalness: 0.75 });
  const housingMat = new THREE.MeshStandardNodeMaterial({ color: 0x17191b, roughness: 0.5, metalness: 0.3 });
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 8);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const poles = [], arms = [];
  const pedHeads = [], pedSig = [];
  const carHeads = [], carSig = [];
  const sitePoles = []; // (where poles stand, to keep them apart)
  const clearOf = (x, z, r) => sitePoles.every((p) => Math.hypot(p.x - x, p.z - z) >= r);
  function pole(x, z, h, r = 0.07) {
    dummy.position.set(x, SW_Y + h / 2, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(r, h, r);
    dummy.updateMatrix();
    poles.push(dummy.matrix.clone());
    sitePoles.push({ x, z });
  }
  // a kerb spot for a pole near (x, z): on a block, clear of the others, stepping back along (bx, bz) & sideways
  function kerbSpot(x, z, bx, bz, sx, sz) {
    for (const back of [0.4, 0.9, 1.5, 2.2]) {
      for (const side of [0, 0.6, -0.6, 1.2, -1.2]) {
        const px = x + bx * back + sx * side, pz = z + bz * back + sz * side;
        if (blockAt(px, pz) && clearOf(px, pz, 0.9)) return { x: px, z: pz };
      }
    }
    return null;
  }
  function pedHead(x, z, fx, fz, k, p) {
    const w = SIGNALS.walkWindows(k)[p];
    if (!w) return;
    dummy.position.set(x, SW_Y + 2.75, z);
    dummy.rotation.set(0, Math.atan2(fx, fz), 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    pedHeads.push(dummy.matrix.clone());
    pedSig.push(k, w[0], w[1], w[2]);
  }

  // 1. Junction crosswalks: a head at both ends of each side's crossing, beside it (the junction side of it)
  let crosswalkHeads = 0;
  for (const n of network.nodes) {
    if (!n.signal || !n.walkP) continue;
    const bySide = new Map();
    for (const t of pedRoutes.across(n)) (bySide.get(t.side) || bySide.set(t.side, []).get(t.side)).push(t);
    for (const [side, tracks] of bySide) {
      // the crossing's centre line & its ends
      const ax = tracks.reduce((s, t) => s + t.ax, 0) / tracks.length, az = tracks.reduce((s, t) => s + t.az, 0) / tracks.length;
      const { ux, uz, len } = tracks[0];
      const bx = ax + ux * len, bz = az + uz * len;
      // beside it, towards the junction (the corner), clear of its lines
      let sx = -uz, sz = ux;
      if ((n.x - (ax + bx) / 2) * sx + (n.z - (az + bz) / 2) * sz < 0) { sx = -sx; sz = -sz; }
      const p = n.walkP[side];
      for (const [ex, ez, ox, oz] of [[ax, az, -ux, -uz], [bx, bz, ux, uz]]) {
        const spot = kerbSpot(ex + sx * 1.6, ez + sz * 1.6, ox, oz, sx, sz);
        if (!spot) continue;
        pole(spot.x, spot.z, 3.1);
        pedHead(spot.x - sx * 0.12, spot.z - sz * 0.12, -ox, -oz, n.sigJ, p);
        crosswalkHeads++;
      }
    }
  }

  // 2. Midblock signals: either kerb, a pole with the traffic head over the road (both faces) and the people's head
  // 3. Crossovers: either kerb, a pole and mast arm with the sign & amber lights over the road
  const signTex = crossoverTexture(), stopTex = stopForTexture();
  const signs = [], stopSigns = [], lamps = [], lampInfo = [];
  let midHeads = 0, crossovers = 0;
  for (const c of network.midCrossings) {
    const tracks = pedRoutes.acrossMid(c);
    const ux = c.ux, uz = c.uz, L = c.half + 2;
    const dx = -uz, dz = ux; // along the road
    for (const sgn of [-1, 1]) {
      const ex = c.x + ux * L * sgn, ez = c.z + uz * L * sgn;
      const spot = kerbSpot(ex + dx * 1.7, ez + dz * 1.7, ux * sgn, uz * sgn, dx, dz);
      if (!spot) continue;
      const fx = -ux * sgn, fz = -uz * sgn; // facing the road (& the far kerb)
      if (c.kind === 'signal') {
        const k = SIGNALS.crossingIndex(c.i);
        pole(spot.x, spot.z, 6.2, 0.09);
        // the traffic head at the end of a short arm over the kerb lane, lenses both ways along the road
        const reach = Math.min(3, Math.max(1, c.half - 1));
        dummy.position.set(spot.x + fx * reach / 2, 6.25, spot.z + fz * reach / 2);
        dummy.rotation.set(0, Math.atan2(fx, fz), 0);
        dummy.scale.set(0.12, 0.12, reach);
        dummy.updateMatrix();
        arms.push(dummy.matrix.clone());
        dummy.position.set(spot.x + fx * reach, 5.42, spot.z + fz * reach);
        dummy.rotation.set(0, Math.atan2(dx, dz), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        carHeads.push(dummy.matrix.clone());
        const g = SIGNALS.windows(k)[0];
        carSig.push(k, g[0], g[1]);
        if (tracks.length) pedHead(spot.x, spot.z, fx, fz, k, 1);
        midHeads++;
      } else {
        // crossover: pole, arm out to the middle of the road's half, the sign hanging there, its lamps either side
        pole(spot.x, spot.z, 5.8, 0.08);
        const reach = Math.max(2, Math.min(c.half + 1.2, 7.5));
        dummy.position.set(spot.x + fx * reach / 2, 5.95, spot.z + fz * reach / 2);
        dummy.rotation.set(0, Math.atan2(fx, fz), 0);
        dummy.scale.set(0.1, 0.1, reach);
        dummy.updateMatrix();
        arms.push(dummy.matrix.clone());
        const sx = spot.x + fx * reach * 0.85, sz = spot.z + fz * reach * 0.85;
        dummy.position.set(sx, 5.2, sz);
        dummy.rotation.set(0, Math.atan2(dx, dz), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        signs.push(dummy.matrix.clone());
        for (const side of [-1, 1]) {
          dummy.position.set(sx + fx * side * 0.75, 5.95, sz + fz * side * 0.75);
          dummy.rotation.set(0, Math.atan2(dx, dz), 0);
          dummy.updateMatrix();
          lamps.push(dummy.matrix.clone());
          lampInfo.push(c.i, side);
        }
        // the ground-mounted sign facing the traffic on this side
        dummy.position.set(spot.x, SW_Y + 2.3, spot.z);
        dummy.rotation.set(0, Math.atan2(dx * -sgn, dz * -sgn), 0);
        dummy.updateMatrix();
        stopSigns.push(dummy.matrix.clone());
        crossovers += sgn > 0 ? 1 : 0;
      }
    }
  }

  // --- materials ---
  const symbols = symbolTexture();
  // pedestrian lens: per instance (light, WALK start, flashing don't walk start, its end); the hand on the left half
  // of the texture (top aspect), the walking person on the right (bottom)
  const pedAttr = new THREE.InstancedBufferAttribute(new Float32Array(pedSig.length ? pedSig : [0, 0, 0, 0]), 4);
  const pedLensMat = new THREE.MeshBasicNodeMaterial({ transparent: false });
  pedLensMat.colorNode = Fn(() => {
    const sig = instancedBufferAttribute(pedAttr, 'vec4');
    const t = mod(signalClock.sub(shifts.element(int(sig.x))), CYCLE);
    const walk = step(sig.y, t).mul(float(1).sub(step(sig.z, t)));
    const flash = step(sig.z, t).mul(float(1).sub(step(sig.w, t)));
    const blink = step(0.5, fract(signalClock));
    const isHand = float(1).sub(step(0.5, uv().x));
    const handOn = float(1).sub(walk).sub(flash.mul(float(1).sub(blink)));
    const on = mix(walk, handOn, isHand);
    const mask = texture(symbols, uv()).a;
    const lit = mix(color(0xf4f4f0), color(0xff7a12), isHand).mul(1.6);
    const dark = color(0x0b0c0e).add(mix(color(0x1a1a1a), color(0x24160c), isHand).mul(mask));
    return mix(dark, lit, on.mul(mask));
  })();
  // traffic lens (the midblock signals' heads): as street-details.js, green in the window, amber after it
  const carAttr = new THREE.InstancedBufferAttribute(new Float32Array(carSig.length ? carSig : [0, 0, 0]), 3);
  const carLensMat = new THREE.MeshBasicNodeMaterial();
  carLensMat.colorNode = Fn(() => {
    const sig = instancedBufferAttribute(carAttr, 'vec3');
    const t = mod(signalClock.sub(shifts.element(int(sig.x))), CYCLE);
    const wy = positionWorld.y;
    const isTopRed = step(5.60, wy);
    const isBottomGreen = float(1.0).sub(step(5.24, wy));
    const isMidAmber = float(1.0).sub(isTopRed).mul(float(1.0).sub(isBottomGreen));
    const greenActive = step(sig.y, t).mul(float(1.0).sub(step(sig.z, t)));
    const amberActive = step(sig.z, t).mul(float(1.0).sub(step(sig.z.add(SIGNAL_TIMING.amber), t)));
    const redActive = float(1.0).sub(greenActive).sub(amberActive);
    const activeMask = isTopRed.mul(redActive).add(isMidAmber.mul(amberActive)).add(isBottomGreen.mul(greenActive));
    const hue = mix(mix(color(0x18ff68), color(0xffaa10), isMidAmber), color(0xff2424), isTopRed);
    return mix(color(0x14181e), hue.mul(1.35), activeMask);
  })();
  // crossover lamps: amber, flashing in turn (left, right) while the crossover is active
  const active = uniformArray(window.CITY.PXO_ACTIVE.length ? window.CITY.PXO_ACTIVE : [0], 'float');
  const lampAttr = new THREE.InstancedBufferAttribute(new Float32Array(lampInfo.length ? lampInfo : [0, 1]), 2);
  const lampMat = new THREE.MeshBasicNodeMaterial();
  lampMat.colorNode = Fn(() => {
    const info = instancedBufferAttribute(lampAttr, 'vec2');
    const on = active.element(int(info.x));
    const phase = step(0.5, fract(signalClock.mul(0.9).add(info.y.mul(0.25).add(0.25))));
    return mix(color(0x2a1c08), color(0xffae1a).mul(2.2), on.mul(phase));
  })();
  const signMat = new THREE.MeshStandardNodeMaterial({ map: signTex, roughness: 0.6, side: THREE.DoubleSide });
  const stopMat = new THREE.MeshStandardNodeMaterial({ map: stopTex, roughness: 0.6, side: THREE.DoubleSide });

  // --- geometry ---
  const bothFaces = (geo) => [geo, geo.clone().rotateY(Math.PI)];
  const pedHousingGeo = new THREE.BoxGeometry(0.36, 0.72, 0.2).toNonIndexed();
  // two aspects, the hand over the walking person, each half of the symbol texture
  const aspect = (u0, y) => {
    const g = new THREE.PlaneGeometry(0.28, 0.28);
    const a = g.attributes.uv;
    for (let i = 0; i < a.count; i++) a.setX(i, u0 + a.getX(i) * 0.5);
    return g.translate(0, y, 0.104);
  };
  const pedLensGeo = mergeGeometries([aspect(0, 0.17), aspect(0.5, -0.17)]);
  const HEAD_W = 0.4, HEAD_H = 1.12, HEAD_D = 0.28, LENS_R = 0.145, LENS_Y = [0.36, 0, -0.36];
  const carHousingGeo = new THREE.BoxGeometry(HEAD_W, HEAD_H, HEAD_D).toNonIndexed();
  const carLensGeo = mergeGeometries(LENS_Y.flatMap((ly) => bothFaces(new THREE.CircleGeometry(LENS_R, 16).translate(0, ly, HEAD_D / 2 + 0.004))));
  const signGeo = new THREE.PlaneGeometry(1.2, 1.2);
  const lampGeo = mergeGeometries(bothFaces(new THREE.CircleGeometry(0.15, 14).translate(0, 0, 0.06)));
  const lampHousingGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 12).rotateX(Math.PI / 2);
  const stopGeo = new THREE.PlaneGeometry(0.45, 0.68);

  function instanced(geo, mat, matrices, shadow = true) {
    if (!matrices.length) return;
    const m = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.instanceMatrix.needsUpdate = true;
    if (shadow && !mat.isMeshBasicNodeMaterial) m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  instanced(unitCyl, poleMat, poles);
  instanced(unitBox, poleMat, arms);
  instanced(pedHousingGeo, housingMat, pedHeads);
  instanced(pedLensGeo, pedLensMat, pedHeads, false);
  instanced(carHousingGeo, housingMat, carHeads);
  instanced(carLensGeo, carLensMat, carHeads, false);
  instanced(signGeo, signMat, signs);
  instanced(lampHousingGeo, housingMat, lamps);
  instanced(lampGeo, lampMat, lamps, false);
  instanced(stopGeo, stopMat, stopSigns);
  scene.add(group);
  console.info(`[pedestrianSignals] ${crosswalkHeads} pedestrian heads at junction crosswalks, ${midHeads} midblock signal poles, ${crossovers} pedestrian crossovers (${PXOS.length} in the City's list)`);
  return { group };
}

Object.assign(window.CITY, { buildPedestrianSignals });
})();
