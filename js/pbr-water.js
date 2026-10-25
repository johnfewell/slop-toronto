(function () {
// js/pbr-water.js
// ?water=pbr spike: Lake Ontario & the harbour in mrdoob's "Physically Based Estuary Water" (slop-newyork's
// js/tsl-materials.js createWaterMaterial, MIT; also carried by unable12's slop-sanfrancisco), fitted to Toronto:
// - Waves: the LEAN-mapped wind-wave texture (tsl-materials.js getWaterWaveTexture) in 4 rotated, drifting layers
//   whose energy follows drifting gusts; the slope variance under each pixel becomes GGX roughness, so near chop
//   turns into a soft glitter path towards the horizon without shimmer. With this city's visible-facet tilt, sun
//   glitter & backlit crests (web-ocean ideas, the cityUniforms uWaterTilt / uWaterGlitter / uWaterGlow).
// - Metalness carries the water's Fresnel (F0 = 0.02): it hands the transmitted share to a diffuse body colour and
//   weights the pipeline's SSR. The body colour is a candidate John picks: ?waterColour=a|b|c (or ny, the estuary
//   original), live in ?waterTune. They are uniforms, so switching never compiles another material.
// - Night: the lit skyline sits beyond SSR's reach, so an analytic city is reflected through the same wave normals &
//   Fresnel, blurred by the unresolved slopes into vertical light streaks: lots, lit windows, storefronts & promenade
//   lamps on boxes fitted to Toronto's real waterfront massing (tools/fit-water-skyline.cjs: the Financial District,
//   CityPlace, Harbourfront, Liberty Village, Ontario Place, the Islands' few lights, Humber Bay Shores), and the
//   CN Tower's pod, SkyPod & beacons.
// The water is opaque & writes depth, so takram's aerial perspective & the grade (main.js) sit over it unchanged;
// it reads no depth itself, so the reversed depth buffer needs nothing here. Ponds & streams keep tsl-materials.js.

const { THREE, TSL, cityUniforms } = window.CITY;
const {
  Fn, If, Loop, float, int, vec2, vec3, vec4, color, uniform, uniformArray, texture, time,
  positionWorld, normalWorldGeometry, cameraPosition, cameraViewMatrix,
  normalize, mix, clamp, smoothstep, step, pow, dot, max, min, abs, floor, fract, sin, sqrt, exp, length, reflect,
  fwidth, select
} = TSL;

// Body colour candidates (sRGB): deep & lighter silt / plankton patches, drifting across the lake
const WATER_COLOURS = {
  a: { name: 'clear blue-green', deep: '#0e3236', light: '#17474a' },
  b: { name: 'deeper blue', deep: '#0b2338', light: '#123552' },
  c: { name: 'greener harbour', deep: '#15302a', light: '#24432f' },
  ny: { name: "mrdoob's estuary (reference)", deep: '#162d2c', light: '#2e3f36' }
};

// 66 boxes, 500 m cells (tools/fit-water-skyline.cjs): [minX, minZ, maxX, maxZ, skyline height S (m), lit]
const SKYLINE = [
  [-8675, -372, -8504, -21, 190, 0.86],
  [-8675, 0, -8504, 474, 189, 0.93],
  [-8495, -500, -8009, -21, 188, 0.94],
  [-8495, 0, -8009, 474, 189, 0.86],
  [-8450, 500, -8099, 699, 168, 0.95],
  [-8270, -552, -8009, -516, 187, 1],
  [-8000, -853, -7533, -500, 141, 0.58],
  [-8000, -500, -7739, -246, 196, 0.78],
  [-7910, 78, -7604, 339, 183, 0.74],
  [-7496, -1483, -7006, -1006, 82, 0.53],
  [-7101, -1000, -7000, -963, 109, 1],
  [-7000, -1227, -6844, -1000, 104, 0.79],
  [-5849, -1227, -5500, -1002, 44, 0.79],
  [-5500, -1080, -5271, -1000, 41, 0.83],
  [-5500, -992, -5000, -546, 22, 0.67],
  [-5000, -723, -4548, -500, 36, 0.65],
  [-4972, -500, -4500, -46, 30, 0.72],
  [-4496, -168, -4000, 0, 68, 0.56],
  [-4427, 0, -4042, 357, 19, 0.57],
  [-4000, 250, -3500, 500, 34, 0.84],
  [-3746, 500, -3500, 914, 23, 0.75],
  [-3026, -110, -3000, -68, 91, 1],
  [-2992, -152, -2526, 0, 104, 0.71],
  [-2939, 500, -2616, 991, 27, 0.85],
  [-2897, 0, -2544, 367, 29, 1],
  [-2500, -107, -2366, 0, 109, 0.73],
  [-2492, 0, -2000, 489, 96, 0.65],
  [-2245, 583, -2009, 970, 14, 0.58],
  [-2000, 111, -1500, 500, 90, 0.99],
  [-2000, 500, -1500, 909, 84, 0.74],
  [-1953, 1040, -1565, 1179, 23, 0.25],
  [-1747, -93, -1620, -1, 63, 1],
  [-1500, -411, -1000, 0, 153, 0.59],
  [-1500, 113, -1000, 500, 129, 0.77],
  [-1337, 3070, -1080, 3414, 20, 0.25],
  [-1298, 500, -1000, 650, 60, 0.91],
  [-1000, 0, -500, 500, 76, 0.66],
  [-1000, 500, -508, 721, 78, 0.9],
  [-987, -492, -500, 0, 143, 0.86],
  [-935, -682, -701, -500, 139, 0.75],
  [-500, -610, 0, -502, 190, 0.69],
  [-497, -494, 0, 0, 198, 0.71],
  [-476, 500, 0, 769, 85, 0.93],
  [-466, 0, 0, 500, 143, 0.9],
  [0, -497, 500, 0, 231, 0.86],
  [0, 0, 496, 500, 186, 0.87],
  [0, 500, 500, 689, 97, 0.95],
  [27, -857, 500, -500, 229, 0.63],
  [500, -500, 1000, 0, 75, 0.49],
  [500, 0, 1000, 500, 58, 1],
  [500, 500, 871, 648, 38, 1],
  [576, -777, 737, -500, 149, 0.59],
  [1000, 0, 1496, 500, 44, 0.83],
  [1000, 500, 1162, 572, 34, 1],
  [1000, 2082, 1500, 2499, 27, 0.25],
  [1054, -451, 1471, 0, 94, 0.62],
  [1370, -555, 1392, -532, 77, 1],
  [1500, -429, 1982, 0, 51, 0.64],
  [1500, 0, 1926, 329, 114, 0.56],
  [1529, -549, 1627, -514, 71, 0.84],
  [1721, 698, 1841, 818, 12, 1],
  [1806, 1000, 2000, 1278, 13, 0.86],
  [2000, 1303, 2499, 1500, 39, 0.75],
  [2042, 1541, 2500, 1891, 17, 0.62],
  [3311, 578, 3500, 785, 55, 0.48],
  [3573, 817, 3693, 937, 50, 1]
];

// Share of the window [x - s, x + s] covered by the interval [a, b]: an exact box filter for bands & points of light
const waterBoxCover = Fn(([x, a, b, s]) => {
  const xv = float(x).toVar();
  const sv = max(float(s), 0.001).toVar();
  return clamp(min(xv.add(sv), b).sub(max(xv.sub(sv), a)).div(sv.mul(2.0)), 0.0, 1.0);
});
// (tsl-materials.js keeps these to itself: the same hash, value noise & box-filtered pulse)
const hash2D = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
const noise2D = Fn(([p]) => {
  const pv = vec2(p).toVar();
  const i = floor(pv).toVar();
  const f = fract(pv).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
  const a = hash2D(i), b = hash2D(i.add(vec2(1.0, 0.0))), c = hash2D(i.add(vec2(0.0, 1.0))), d = hash2D(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});
const filteredPulse = Fn(([x, a, b, w]) => {
  const p = float(x).toVar();
  const lo = float(a).toVar();
  const hi = float(b).toVar();
  const hw = max(float(w), 0.0001).mul(0.5).toVar();
  const integral = (t) => floor(t).mul(hi.sub(lo)).add(clamp(fract(t), lo, hi).sub(lo));
  return integral(p.add(hw)).sub(integral(p.sub(hw))).div(hw.mul(2.0));
});

function createPBRLakeWater(colourKey) {
  const pick = WATER_COLOURS[colourKey] || WATER_COLOURS.a;
  const U = {
    deep: uniform(new THREE.Color(pick.deep)),
    light: uniform(new THREE.Color(pick.light)),
    nightCity: uniform(2.5), // the reflected night city's brightness (1 = mrdoob's; 2.5 reads at Toronto's window glow)
    // the night sky's glow along the reflected horizon: the baked environment the IBL reflects is all but black at
    // 23:00 (envIntensity 0.3, the classic sky at its night exposure), while takram's drawn sky stays a deep navy
    nightSky: uniform(new THREE.Color('#1c2c4c')),
    skylineScale: uniform(1.0) // its skyline heights
  };
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.25 });
  mat.name = 'LakeOntarioPBR';
  const waveTex = window.CITY.getWaterWaveTexture();

  // [tile size (m), rotation (rad), RMS slope]: incommensurate scales & angles so no pattern repeats
  const LAYERS = [
    [61.0, 0.0, 0.052],
    [23.3, 1.93, 0.06],
    [8.7, 4.07, 0.064],
    [3.3, 2.71, 0.064]
  ];
  // vec4(mean slope x, mean slope z, unresolved slope variance, crest height)
  const waves = Fn(() => {
    const p = positionWorld.xz;
    const t = time;
    // Wind patches drifting with the breeze: large-scale wave energy that reads from the air and hides tiling
    const gustA = noise2D(p.mul(0.0047).add(vec2(t.mul(0.011), t.mul(-0.007))));
    const gustB = noise2D(p.mul(0.0135).add(vec2(t.mul(-0.009), t.mul(0.013))).add(31.7));
    const gust = smoothstep(0.18, 0.82, gustA.mul(0.62).add(gustB.mul(0.38)));
    const energy = mix(float(0.45), float(1.3), gust).toVar();
    const slope = vec2(0.0, 0.0).toVar();
    const variance = energy.mul(energy).mul(0.0022).toVar(); // capillary ripples, always below a pixel
    const crest = float(0.0).toVar();
    for (const [L, rot, sigma] of LAYERS) {
      const c = Math.cos(rot), s = Math.sin(rot);
      const speed = (0.8 * Math.sqrt(L / 9)) / L; // ~phase speed of the tile's dominant waves, in tiles per second
      const uv = vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c))).div(L)
        .add(vec2(Math.cos(0.3) * speed, Math.sin(0.3) * speed).mul(t));
      const smp = texture(waveTex, uv);
      const amp = energy.mul(sigma);
      slope.addAssign(vec2(smp.x.mul(c).add(smp.y.mul(s)), smp.y.mul(c).sub(smp.x.mul(s))).mul(amp));
      variance.addAssign(max(smp.z.sub(dot(smp.xy, smp.xy)), 0.0).mul(amp.mul(amp)));
      crest.addAssign(smp.w.mul(sigma));
    }
    return vec4(slope, variance, crest.mul(4.0));
  })();

  const variance = waves.z;
  const sigmaSlope = sqrt(variance);
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const cosView = clamp(viewDir.y, 0.02, 1.0);
  // Visible-facet tilt: lean the mean slope toward the viewer, up to the unresolved RMS slope at grazing angles
  const towardEye = normalize(vec2(viewDir.x, viewDir.z).add(vec2(1e-5, 0.0)));
  const grazing = pow(float(1.0).sub(cosView), 3.0);
  const slope = waves.xy.sub(towardEye.mul(min(sigmaSlope.mul(grazing).mul(1.2), 0.35).mul(cityUniforms.uWaterTilt)));
  const flatTop = smoothstep(0.5, 0.9, normalWorldGeometry.y);
  const waterNormal = normalize(mix(normalWorldGeometry, vec3(slope.x.negate(), 1.0, slope.y.negate()), flatTop));
  mat.normalNode = cameraViewMatrix.transformDirection(waterNormal);
  // GGX alpha ≈ RMS slope of the unresolved waves (Beckmann m), roughness = sqrt(alpha)
  mat.roughnessNode = clamp(pow(variance, 0.25), 0.08, 0.65);
  const fresnel = pow(float(1.0).sub(clamp(dot(waterNormal, viewDir), 0.0, 1.0)), 5.0).mul(0.98).add(0.02);
  mat.metalnessNode = clamp(fresnel.mul(1.6), 0.0, 0.9);

  // Body colour: the candidate's deep tone & lighter drifting patches; thin sunlit crests transmit a brighter tint
  const bodyColor = Fn(() => {
    const silt = noise2D(positionWorld.xz.mul(0.0031).add(7.3));
    return mix(U.deep, U.light, smoothstep(0.25, 0.85, silt));
  })();
  mat.colorNode = bodyColor.mul(smoothstep(0.6, 2.4, waves.w).mul(0.35).add(1.0));

  // The night skyline's boxes, as uniforms (one loop in the shader, not 66 unrolled tests)
  const boxBounds = uniformArray(SKYLINE.map(([x0, z0, x1, z1]) => new THREE.Vector4(x0, z0, x1, z1)), 'vec4');
  const boxInfo = uniformArray(SKYLINE.map(([, , , , S, lit]) => new THREE.Vector4(S, lit, 0, 0)), 'vec4');
  const NBOX = SKYLINE.length;
  const cn = window.CITY.GEO.points.cnTower;

  mat.emissiveNode = Fn(() => {
    const C = cityUniforms;
    const L = normalize(C.uSkySunDir);
    const sunUp = smoothstep(-0.02, 0.06, L.y);
    const sunRad = C.uSunColor.mul(C.uSunIntensity).mul(sunUp);
    // sun glitter from the slope distribution (off by default: uWaterGlitter 0, mrdoob's GGX path reads better)
    const H = normalize(L.add(viewDir));
    const hy = max(H.y, 0.05);
    const d = vec2(H.x.negate(), H.z.negate()).div(hy).sub(waves.xy);
    const s2 = variance.add(0.00003);
    const p = exp(dot(d, d).negate().div(s2.mul(2.0))).div(s2.mul(6.2832));
    const fH = pow(float(1.0).sub(clamp(dot(H, viewDir), 0.0, 1.0)), 5.0).mul(0.98).add(0.02);
    const glitter = min(fH.mul(p).div(hy.mul(hy).mul(hy).mul(hy).mul(4.0).mul(cosView)), 60.0).mul(C.uWaterGlitter);
    // backlit crests: the sun low and behind the waves, light through their thin tops
    const back = pow(clamp(dot(L, viewDir.negate()), 0.0, 1.0), 4.0).mul(smoothstep(0.35, 0.05, L.y));
    const crests = smoothstep(0.8, 2.6, waves.w).mul(back).mul(0.06).mul(C.uWaterGlow);
    const out = sunRad.mul(glitter.mul(flatTop)).add(sunRad.mul(bodyColor).mul(crests).mul(4.0)).toVar();

    // Night: the lit city along the reflected ray (only once windows light up: a uniform branch, skipped by day)
    const night = smoothstep(0.55, 1.35, C.uInteriorGlow).mul(U.nightCity);
    If(night.greaterThan(0.001), () => {
      const P = positionWorld.xz;
      const R = reflect(viewDir.negate(), waterNormal);
      const horiz = max(length(R.xz), 0.001);
      const dir = R.xz.div(horiz);
      const tanEl = R.y.div(horiz);
      const sgn = vec2(select(dir.x.greaterThanEqual(0.0), 1.0, -1.0), select(dir.y.greaterThanEqual(0.0), 1.0, -1.0));
      const inv = sgn.div(max(abs(dir), vec2(0.0001))).toVar();

      // The first box face the rising ray meets below that box's skyline (its tallest lots, 1.3 S): towers behind a
      // low waterfront show over it, as in a heightfield
      const tHit = float(1e5).toVar();
      const sHit = float(0.0).toVar();
      const litHit = float(0.0).toVar();
      Loop(NBOX, ({ i }) => {
        const b = boxBounds.element(i);
        const info = boxInfo.element(i);
        const ta = b.xy.sub(P).mul(inv);
        const tb = b.zw.sub(P).mul(inv);
        const tn = max(min(ta.x, tb.x), min(ta.y, tb.y));
        const tf = min(max(ta.x, tb.x), max(ta.y, tb.y));
        const S = info.x.mul(U.skylineScale);
        const hit = tn.greaterThanEqual(0.0).and(tn.lessThanEqual(tf)).and(tn.lessThan(tHit)).and(tn.mul(tanEl).lessThan(S.mul(1.3)));
        tHit.assign(select(hit, tn, tHit));
        sHit.assign(select(hit, S, sHit));
        litHit.assign(select(hit, info.y, litHit));
      });
      const anyHit = step(tHit, 9e4);
      const tH = min(tHit, 9e4);
      const hit = P.add(dir.mul(tH));
      const hRefl = tH.mul(tanEl); // height up the facades that this reflection sees
      const u = hit.x.add(hit.y); // runs along whichever face was hit

      // Footprint on the facades (m): unresolved slopes tilt the reflection ±2σ, laterally foreshortened when grazing
      const sigma2 = sigmaSlope.mul(2.0);
      const sV = tH.mul(sigma2).add(fwidth(hRefl)).add(0.5);
      const sU = tH.mul(sigma2).mul(max(viewDir.y, 0.05)).add(fwidth(u)).add(0.3);

      // Lots 24 m wide with heights 0.3–1.3× the box's skyline (averaged once a footprint spans several lots)
      const lot = floor(u.div(24.0));
      const r1 = hash2D(vec2(lot, 5.1));
      const r2 = hash2D(vec2(lot, 9.7));
      const r3 = hash2D(vec2(lot, 13.3));
      const lotMix = smoothstep(5.0, 20.0, sU);
      const upper = mix(waterBoxCover(hRefl, 4.5, sHit.mul(r1.mul(r1).add(0.3)), sV), waterBoxCover(hRefl, 4.5, sHit.mul(0.63), sV), lotMix);
      const ground = waterBoxCover(hRefl, 0.0, 4.5, sV);
      // Lit windows (3.2 m bays × 3.6 m floors), resolving to each lot's mean occupancy, then the street's
      const dens = mix(float(0.2), float(0.6), r2);
      const bayF = u.div(3.2);
      const floorF = hRefl.div(3.6);
      const litWin = step(hash2D(floor(vec2(bayF, floorF)).add(lot.mul(0.731))), dens);
      const pane = filteredPulse(fract(bayF), 0.16, 0.84, sU.div(3.2)).mul(filteredPulse(fract(floorF), 0.3, 0.88, sV.div(3.6)));
      const winDetail = float(1.0).sub(smoothstep(0.7, 1.8, max(sU.div(3.2), sV.div(3.6))));
      const windows = mix(mix(dens.mul(0.394), litWin.mul(pane), winDetail), float(0.4 * 0.394), lotMix);
      const tint = mix(mix(color(0xffc58a), color(0xdde6ff), step(0.62, r3)), color(0xf6d3aa), lotMix);
      const shopLit = mix(mix(float(0.1), float(1.0), step(0.35, r3)), float(0.7), lotMix);
      // Promenade lamps (Queens Quay, the Martin Goodman Trail) every 30 m, heads at ~8.5 m
      const lampDist = abs(fract(u.div(30.0)).sub(0.5)).mul(30.0);
      const lampU = mix(waterBoxCover(lampDist, -0.45, 0.45, sU), float(0.9 / 30.0), smoothstep(5.0, 14.0, sU));
      const lamps = lampU.mul(waterBoxCover(hRefl, 8.2, 8.8, sV)).mul(70.0);
      const city = tint.mul(windows.mul(upper).mul(0.95))
        .add(color(0xffcf9a).mul(ground.mul(shopLit).mul(0.4)))
        .add(color(0xffd9b0).mul(lamps))
        .mul(litHit.mul(anyHit));

      // The CN Tower: where the reflected ray passes closest to its axis, the lit main pod, the SkyPod & the beacons
      const rel = vec2(cn[0], cn[1]).sub(P);
      const tc = max(dot(rel, dir), 1.0);
      const lateral = rel.x.mul(dir.y).sub(rel.y.mul(dir.x));
      const hT = tc.mul(tanEl);
      const sVt = tc.mul(sigma2).add(fwidth(hT)).add(0.5);
      const sUt = tc.mul(sigma2).mul(max(viewDir.y, 0.05)).add(fwidth(lateral)).add(0.3);
      const front = step(0.0, dot(rel, dir)).mul(step(tc, tHit.add(400.0))); // not behind the eye, nor hidden by a nearer box
      const pod = waterBoxCover(lateral, -25.0, 25.0, sUt).mul(waterBoxCover(hT, 339.0, 346.0, sVt));
      const skyPod = waterBoxCover(lateral, -11.0, 11.0, sUt).mul(waterBoxCover(hT, 445.0, 451.0, sVt));
      const beacon = waterBoxCover(lateral, -1.5, 1.5, sUt).mul(waterBoxCover(hT, 548.0, 552.0, sVt));
      const tower = color(0xffd2a0).mul(pod.mul(1.6).add(skyPod.mul(1.2))).add(color(0xff2a14).mul(beacon.mul(25.0))).mul(front);

      // the night sky's navy where the reflection looks up at it, only once the sun is well down (23:00, not sunset)
      const skyGlow = U.nightSky.mul(smoothstep(1.3, 1.5, C.uInteriorGlow)).mul(mix(float(1.0), float(0.45), clamp(tanEl, 0.0, 1.0)));
      out.addAssign(city.add(tower).mul(night).add(skyGlow).mul(fresnel));
    });
    return out;
  })();

  return { material: mat, uniforms: U, colours: WATER_COLOURS };
}

// ?waterTune with ?water=pbr: the body colour candidates & both tones, the night city's brightness & skyline heights
async function openPBRTunePanel(w, colourKey) {
  const { default: GUI } = await import('https://cdn.jsdelivr.net/npm/lil-gui@0.21.0/+esm');
  const gui = new GUI({ title: 'Lake Ontario PBR water (?waterTune)', width: 320 });
  const U = w.uniforms;
  const state = {
    candidate: WATER_COLOURS[colourKey] ? colourKey : 'a',
    deep: '#' + U.deep.value.getHexString(),
    light: '#' + U.light.value.getHexString(),
    nightCity: U.nightCity.value,
    skylineScale: U.skylineScale.value
  };
  const deepCtl = gui.addColor(state, 'deep').onChange((v) => U.deep.value.set(v));
  const lightCtl = gui.addColor(state, 'light').onChange((v) => U.light.value.set(v));
  gui.add(state, 'candidate', Object.fromEntries(Object.entries(WATER_COLOURS).map(([k, c]) => [`${k}: ${c.name}`, k]))).onChange((k) => {
    state.deep = WATER_COLOURS[k].deep;
    state.light = WATER_COLOURS[k].light;
    U.deep.value.set(state.deep);
    U.light.value.set(state.light);
    deepCtl.updateDisplay();
    lightCtl.updateDisplay();
  });
  gui.add(state, 'nightCity', 0, 3, 0.01).name('night city ×').onChange((v) => { U.nightCity.value = v; });
  state.nightSky = '#' + U.nightSky.value.getHexString();
  gui.addColor(state, 'nightSky').name('night sky glow').onChange((v) => U.nightSky.value.set(v));
  gui.add(state, 'skylineScale', 0.3, 2, 0.01).name('skyline heights ×').onChange((v) => { U.skylineScale.value = v; });
  const out = document.createElement('textarea');
  out.style.cssText = 'width:100%;height:60px;font:11px monospace;box-sizing:border-box';
  gui.add({ copy: () => { out.value = JSON.stringify(state); navigator.clipboard?.writeText(out.value).catch(() => {}); } }, 'copy').name('Copy JSON');
  gui.domElement.appendChild(out);
}

Object.assign(window.CITY, { createPBRLakeWater, openPBRTunePanel, PBR_WATER_COLOURS: WATER_COLOURS });
})();
