(function () {
// js/tsl-materials.js
// Photorealistic TSL (Three.js Shading Language) procedural shaders for Three.js r186 WebGPURenderer
// Incorporating techniques from three.js webgpu_generator_city.html:
// - Mikkelsen Surface-Gradient Hardware Derivative Bump Mapping (bumpNormal)
// - Filter-Width Anti-Aliased Procedural Markings & Mortar (lineAA & gridLine via fwidth)
// - True 3D Slab Ray-Marched Room & Retail Storefront Interiors (walls, ceiling lamps, floors, rugs, doors, art, shelves, curtains)
// - Window Air-Conditioner Units with Louver Relief & Grimy Soda-Lime Window Glazing
// - Crown-Sphere Foliage Normal Relief, Radial Interior Canopy AO & Cast-Iron Tree Grate Shading
// - Occlusion-Aware Urban Canyon Global Illumination (aoNode + Warm Terracotta/Limestone Bounce)

const { THREE } = window.CITY;
const {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  color,
  uniform,
  attribute,
  varying,
  positionGeometry,
  positionLocal,
  positionWorld,
  positionView,
  positionViewDirection,
  normalLocal,
  normalWorld,
  normalWorldGeometry,
  normalGeometry,
  normalView,
  normalViewGeometry,
  modelNormalMatrix,
  frontFacing,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  screenSize,
  uv,
  time,
  sin,
  cos,
  abs,
  floor,
  fract,
  mod,
  min,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  dot,
  length,
  normalize,
  reflect,
  pow,
  log2,
  exp2,
  sign,
  fwidth,
  texture,
  rotateUV,
  mrt,
  If
} = window.CITY.TSL;

// Shared live uniforms controlled by lighting / time-of-day presets
const cityUniforms = {
  uSunColor: uniform(new THREE.Color(0xffca92)),
  uSkyTopColor: uniform(new THREE.Color(0x2c568c)),
  uSkyHorizonColor: uniform(new THREE.Color(0xebd1b5)),
  uSkySunDir: uniform(new THREE.Vector3(-0.66, 0.34, -0.67).normalize()),
  uSunIntensity: uniform(6.0),
  uWaterGlitter: uniform(0.0), // sun-glitter strength (web-ocean's slope-distribution glitter): off, mrdoob's GGX path reads better (A/B 2026-10-23)
  uWaterGlow: uniform(1.0), // backlit crest glow strength
  uWaterTilt: uniform(1.0), // visible-facet tilt at grazing angles
  uInteriorGlow: uniform(0.78),
  uRoadWetness: uniform(0.38),
  uCanyonBounce: uniform(0.52)
};

// How much wear the asphalt & sidewalk shaders draw (quality.js `surfaceWear`): 2 everything, 1 the cheap part, 0 none
const SURFACE_WEAR = window.CITY.QUALITY?.surfaceWear ?? 2;

// Fast deterministic 2D -> 1D hash in TSL
const hash2D = Fn(([p]) => {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

// Smooth 2D value noise in TSL
const noise2D = Fn(([p]) => {
  const pv = vec2(p).toVar();
  const i = floor(pv).toVar();
  const f = fract(pv).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
  const a = hash2D(i);
  const b = hash2D(i.add(vec2(1.0, 0.0)));
  const c = hash2D(i.add(vec2(0.0, 1.0)));
  const d = hash2D(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

/**
 * Mikkelsen's Surface-Gradient Hardware Derivative Bump Mapping (ported from CityGeneratorUtils.js)
 * Wrapped in Fn() so `height` is evaluated once into a scalar parameter before dFdx/dFdy!
 */
const bumpNormal = Fn(([height]) => {
  const h = float(height).toVar();
  const dpdx = positionView.dFdx();
  const dpdy = positionView.dFdy();
  const r1 = dpdy.cross(normalView);
  const r2 = normalView.cross(dpdx);
  const det = dpdx.dot(r1);
  const grad = det.sign().mul(h.dFdx().mul(r1).add(h.dFdy().mul(r2)));
  return det.abs().mul(normalView).sub(grad).normalize();
});

/**
 * Filter-Width Anti-Aliased Filled Band (ported from CityGenerator.js)
 * Wrapped in Fn() so NodeBuilder emits a single WGSL function instead of inlining fwidth trees.
 */
const lineAA = Fn(([coord, halfWidth]) => {
  const c = float(coord).toVar();
  const hw = float(halfWidth).toVar();
  const aa = fwidth(c).max(0.0001).toVar();
  const effHw = max(hw, aa.mul(0.5)).toVar();
  const cov = smoothstep(effHw.add(aa), effHw.sub(aa), abs(c));
  return cov.mul(min(float(1.0), hw.div(effHw)));
});

/**
 * Filter-Width Anti-Aliased Repeating Grid Line (ported from CityGenerator.js & SidewalkGenerator.js)
 */
const gridLine = Fn(([coord, period, halfWidth]) => {
  const p = float(period).toVar();
  const g = float(coord).div(p).toVar();
  const d = float(0.5).sub(abs(fract(g).sub(0.5))).toVar();
  const aa = fwidth(g).max(0.0001).toVar();
  const hw = float(halfWidth).div(p).toVar();
  const effHw = max(hw, aa.mul(0.5)).toVar();
  const cov = smoothstep(effHw.add(aa), effHw.sub(aa), d);
  return cov.mul(min(float(1.0), hw.div(effHw)));
});

/**
 * Box-Filtered Periodic Pulse: fraction of a footprint `w` wide around `x` where fract() lies in [a, b].
 * Exact anti-aliasing that settles to the mean coverage (b - a) once a period shrinks below a pixel, so facade grids
 * don't shimmer or moiré at distance & grazing angles. Pass the in-cell coordinate (fract) for precision.
 */
const filteredPulse = Fn(([x, a, b, w]) => {
  const p = float(x).toVar();
  const lo = float(a).toVar();
  const hi = float(b).toVar();
  const hw = max(float(w), 0.0001).mul(0.5).toVar();
  const integral = (t) => floor(t).mul(hi.sub(lo)).add(clamp(fract(t), lo, hi).sub(lo));
  return integral(p.add(hw)).sub(integral(p.sub(hw))).div(hw.mul(2.0));
});

// Keep distant lit windows in 1–2 pixel clusters. Adjacent world-anchored scales cross-fade, and
// the half-width inset leaves room for filtering at cell edges while preserving mean brightness.
const distantWindowLight = Fn(([grid, fw, probability, seed, lod]) => {
  const light = float(probability).toVar();
  If(cityUniforms.uInteriorGlow.greaterThan(0.5).and(lod.greaterThan(0.0)), () => {
    const level = log2(max(max(fw.x, fw.y).mul(4.0), 2.0)).toVar();
    const scale = exp2(floor(level)).toVar();
    const cluster = (size) => {
      const p = grid.div(size).toVar();
      const width = fw.div(size).toVar();
      const lit = step(float(1.0).sub(probability), hash2D(floor(p).add(vec2(seed, 73.1))));
      const coverage = filteredPulse(fract(p.x), 0.25, 0.75, width.x)
        .mul(filteredPulse(fract(p.y), 0.25, 0.75, width.y));
      return lit.mul(coverage).mul(4.0);
    };
    const clustered = mix(cluster(scale), cluster(scale.mul(2.0)), smoothstep(0.0, 1.0, fract(level)));
    light.assign(mix(probability, clustered, smoothstep(0.5, 1.2, cityUniforms.uInteriorGlow)));
  });
  return light;
});

/**
 * Occlusion-Aware Street Sky Visibility (aoNode)
 * Abuja is an open, low-rise city of wide roads and set-back compounds: the sky is only partly hidden near the ground
 * (walls, trees, the neighbouring buildings) and wholly open up the towers of the Central Business District.
 */
const canyonSkyAONode = Fn(() => {
  const wp = positionWorld;
  const heightOpenness = smoothstep(0.0, 30.0, wp.y);
  const streetCrevice = smoothstep(0.0, 4.0, wp.y).mul(0.12).add(0.88);
  return mix(float(0.7), float(1.0), heightOpenness).mul(streetCrevice);
});

// Material caches to prevent duplicate WebGPU WGSL shader compilation across blocks & landmarks
const _curtainWallCache = new Map();
const _preWarCache = new Map();

// Camera-independent facade frame: the view/world normal round trip can change the dominant axis on 45-degree
// walls. Resolve near-ties in the vertex shader and keep that choice flat across each face.
const facadeNormalVertex = normalize(modelNormalMatrix.mul(normalLocal));
const facadeWorldNormal = varying(facadeNormalVertex, 'vFacadeWorldNormal').normalize();
const facadeAlongZ = varying(
  step(abs(facadeNormalVertex.z).sub(0.0001), abs(facadeNormalVertex.x)),
  'vFacadeAlongZ'
).setInterpolation(THREE.InterpolationSamplingType.FLAT, THREE.InterpolationSamplingMode.EITHER);

/**
 * Lightweight, Fast-Compiling 3D Parallax Apartment Interior Mapping (Upper Floors Only)
 * Modelled directly after `interior()` in `three/addons/generators/city/SkyscraperGenerator.js`:
 * - Evaluates `origin`, `dir`, `boxMin`, and `boxMax` in true world meters (isotropic 1:1:1 scale)
 *   so 3D room perspective is accurate from all viewing angles.
 * - Each apartment room spans 2.5 window bays wide (~6.8m) × 1 story tall (~3.5m) × ~5.2m deep,
 *   set back behind the facade so neighbouring windows look into the same full-sized room.
 * - Includes left & right fabric drapes hung just inside the window frame (`winUV`) from a 6-swatch
 *   domestic palette that block interior glow (`emit = 0.20`) so drapes silhouette against lit rooms.
 * - Once windows shrink to a pixel or two (`fwNode`: pixel footprint in cells), lit rooms merge into filtered
 *   clusters, drapes settle to their mean coverage & lamps fade out, so distant towers don't twinkle in motion.
 * - Returns `vec4(roomColor, litEmit)`.
 */
const evaluateApartmentInterior = Fn(([uCoord, vCoord, winUV, cellId, winWNode, floorHNode, seedNode, warmthNode, litProbNode, fwNode]) => {
  const u = float(uCoord).toVar();
  const v = float(vCoord).toVar();
  const wUV = vec2(winUV).toVar();
  const cid = vec2(cellId).toVar();
  const wW = float(winWNode).toVar();
  const fH = float(floorHNode).toVar();

  // Room module (SkyscraperGenerator.js lines 959-975):
  // Each room spans an INTEGER 2 or 3 window bays wide (~5.4m - 8.1m) and an INTEGER bay phase
  // offset per floor so partition walls ALWAYS land behind masonry piers/mullions, never mid-window!
  const floorIdx = floor(v.div(fH)).toVar();
  const fHash1 = fract(sin(floorIdx.mul(41.3).add(seedNode)).mul(43758.5453));
  const fHash2 = fract(sin(floorIdx.mul(73.7).add(seedNode.mul(1.7))).mul(43758.5453));
  const roomBays = mix(float(2.0), float(3.0), step(0.5, fHash1)).toVar();
  const roomPhase = floor(fHash2.mul(roomBays)).toVar();

  const gridU = u.div(wW);
  const roomU = gridU.add(roomPhase).div(roomBays).toVar();
  const roomIdx = floor(roomU).toVar();
  const roomId = vec2(roomIdx, floorIdx).toVar();

  const roomW = wW.mul(roomBays).toVar();
  const roomH = fH.mul(0.92).toVar();
  const setback = float(0.12);
  const depth = roomH.mul(1.55).toVar();

  // Pixel entry position `origin` in world meters relative to the multi-bay room center:
  // Window sill (wUV.y=0) sits ~0.75m above the room floor; window lintel (wUV.y=1) sits ~0.58m below the ceiling
  const originX = fract(roomU).sub(0.5).mul(roomW).toVar();
  const originY = wUV.y.sub(0.46).mul(roomH.mul(0.62)).toVar();

  // View ray `dir` in world meters in the room's (across, up, depth) frame. `across` runs along the wall's tangent
  // (+x on walls facing ±z, +z on walls facing ±x, turning with walls that follow a non-grid street)
  const rayWorld = normalize(positionWorld.sub(cameraPosition)).toVar();
  const tSign = mix(sign(facadeWorldNormal.z).negate(), sign(facadeWorldNormal.x), facadeAlongZ);
  const dirX = dot(rayWorld, vec3(facadeWorldNormal.z.negate(), 0.0, facadeWorldNormal.x).mul(tSign)).toVar();
  const dirY = rayWorld.y.toVar();
  const dirZ = max(abs(dot(rayWorld, facadeWorldNormal)), 0.05).toVar();

  // Slab intersection with the far planes of the room box:
  // [-halfW .. +halfW] x [-halfH .. +halfH] x [setback .. setback + depth]
  const halfW = roomW.mul(0.5).toVar();
  const halfH = roomH.mul(0.5).toVar();
  const tFarX = halfW.sub(originX.mul(sign(dirX))).div(max(abs(dirX), 0.0001)).toVar();
  const tFarY = halfH.sub(originY.mul(sign(dirY))).div(max(abs(dirY), 0.0001)).toVar();
  const tFarZ = setback.add(depth).div(dirZ).toVar();
  const t = min(min(tFarX, tFarY), tFarZ).toVar();
  const hit = vec3(originX.add(dirX.mul(t)), originY.add(dirY.mul(t)), dirZ.mul(t)).toVar();

  // Normalized 0..1 coordinates inside the room box (SkyscraperGenerator.js line 1150)
  const q = clamp(
    vec3(
      hit.x.div(roomW).add(0.5),
      hit.y.div(roomH).add(0.5),
      hit.z.sub(setback).div(depth)
    ),
    vec3(0.0),
    vec3(1.0)
  ).toVar();

  const onBack = step(tFarZ, tFarX).mul(step(tFarZ, tFarY)).toVar();
  const isYPlane = step(tFarY, tFarX).mul(step(tFarY, tFarZ)).toVar();
  const onCeil = isYPlane.mul(step(0.0, dirY)).toVar();
  const onFloor = isYPlane.mul(float(1.0).sub(step(0.0, dirY))).toVar();

  // Per-room hashes & bulb temperature (SkyscraperGenerator.js lines 1162-1171)
  const seed1 = hash2D(roomId.add(vec2(seedNode, 19.4))).toVar();
  const seed2 = hash2D(roomId.add(vec2(seedNode.mul(1.9), 83.1))).toVar();
  const seed3 = hash2D(roomId.add(vec2(63.2, seedNode.mul(0.7)))).toVar();
  const lod = smoothstep(0.3, 0.8, max(fwNode.x, fwNode.y)).toVar();
  const litRoom = step(float(1.0).sub(litProbNode), seed3).toVar();
  const lit = mix(litRoom, 1.0, lod).toVar();

  const warmLight = mix(color(0xffb845), color(0xffe49c), seed1);
  const coolLight = mix(color(0xdfe8ff), color(0x9fb6ff), seed2);
  const lightCol = mix(coolLight, warmLight, step(float(1.0).sub(warmthNode), seed2)).toVar();

  // Room shell: muted plaster walls with skirting board, wood floorboards + rug, ceiling lamp, back-wall door & art
  const wallBase = mix(mix(color(0x9a8b73), color(0x6f7a82), seed1), color(0xb9ad97), seed2.mul(0.6)).toVar();
  const wallCol = mix(wallBase, wallBase.mul(0.5), smoothstep(0.06, 0.04, q.y)).toVar();

  const seam = step(0.92, fract(q.x.mul(7.0)));
  const boards = mix(color(0x4a3320), color(0x6a4c30), seed1).mul(float(1.0).sub(seam.mul(0.3)));
  const rug = mix(color(0x7a3b32), color(0x3a5760), seed2);
  const inRug = step(abs(q.x.sub(0.5)), 0.28).mul(step(abs(q.z.sub(0.58)), 0.25));
  const floorCol = mix(boards, rug, inRug.mul(0.88)).toVar();

  const lamp = smoothstep(0.18, 0.11, length(vec2(q.x.sub(0.5), q.z.sub(0.5)))).mul(float(1.0).sub(lod));
  const ceilBase = mix(wallBase, color(0xe8e2d5), 0.28);
  const ceilCol = mix(ceilBase, lightCol.mul(mix(float(0.85), float(3.8), lit)), lamp).toVar();

  const doorX = mix(float(0.24), float(0.76), seed1);
  const doorCol = mix(color(0x5a4631), color(0x39383c), step(0.5, seed2));
  const inDoor = step(abs(q.x.sub(doorX)), 0.09).mul(step(abs(q.y.sub(0.34)), 0.34));
  const picX = mix(float(0.72), float(0.28), step(0.5, seed1));
  const inPicFrame = step(abs(q.x.sub(picX)), 0.085).mul(step(abs(q.y.sub(0.56)), 0.095));
  const inPicCanvas = step(abs(q.x.sub(picX)), 0.065).mul(step(abs(q.y.sub(0.56)), 0.075));
  const picCol = mix(color(0x2c3a4a), color(0x7a5a3a), fract(seed1.add(seed2)));
  const backWithDoor = mix(wallCol, doorCol, inDoor);
  const backWithFrame = mix(backWithDoor, color(0x141210), inPicFrame);
  const backCol = mix(backWithFrame, picCol, inPicCanvas).toVar();

  const shellCol = mix(mix(mix(wallCol, floorCol, onFloor), ceilCol, onCeil), backCol, onBack).toVar();

  // Soft 3D corner ambient occlusion & depth falloff (SkyscraperGenerator.js lines 1176 & 1213-1216)
  const aoX = smoothstep(0.0, 0.16, q.x).mul(smoothstep(0.0, 0.16, float(1.0).sub(q.x))).toVar();
  const aoY = smoothstep(0.0, 0.16, q.y).mul(smoothstep(0.0, 0.16, float(1.0).sub(q.y))).toVar();
  const aoZ = smoothstep(0.0, 0.16, q.z).mul(smoothstep(0.0, 0.16, float(1.0).sub(q.z))).toVar();
  const edgeAO = mix(mix(aoY.mul(aoZ), aoX.mul(aoZ), isYPlane), aoX.mul(aoY), onBack);
  const shellAO = mix(float(0.66), float(1.0), edgeAO);
  const falloff = mix(float(1.0), float(0.42), q.z);
  const shadedRoom = shellCol.mul(shellAO).mul(falloff).toVar();

  // Curtains hung just inside the glass of each window opening (SkyscraperGenerator.js lines 1274-1302)
  // Parallax shift onto the curtain plane behind the glass
  const cUVx = clamp(wUV.x.add(dirX.div(dirZ).mul(0.06)), 0.0, 1.0).toVar();
  const wSeed1 = hash2D(cid.add(vec2(seedNode.mul(0.8), 41.2))).toVar();
  const wSeed2 = hash2D(cid.add(vec2(17.9, seedNode.mul(1.3)))).toVar();

  const sL = smoothstep(0.18, 1.0, wSeed1);
  const sR = smoothstep(0.18, 1.0, wSeed2);
  const lw = sL.mul(sL).mul(0.48); // Left drape width (0..48% of window width)
  const rw = sR.mul(sR).mul(0.48); // Right drape width (0..48% of window width)
  // Drape edges widen to the pixel footprint & pleats fade to their mean shade once they'd shrink below a few pixels
  const cFw = fwidth(cUVx).toVar();
  const drapeAA = cFw.add(0.015).toVar();
  const inLeftDrape = smoothstep(lw.add(drapeAA), lw.sub(drapeAA), cUVx).mul(step(0.03, lw));
  const inRightDrape = smoothstep(float(1.0).sub(rw).sub(drapeAA), float(1.0).sub(rw).add(drapeAA), cUVx).mul(step(0.03, rw));
  const inDrape = mix(clamp(max(inLeftDrape, inRightDrape), 0.0, 1.0), 0.29, lod).toVar(); // 0.29: mean drape coverage

  // Domestic curtain fabric palette (cream, taupe, warm grey, dusty blue, sage green, faded terracotta)
  const pick = fract(seed1.mul(5.7)).mul(5.0);
  const sw0 = mix(color(0xcabfa6), color(0xd8cdb8), seed2);
  const sw1 = mix(color(0x8a7a64), color(0x9b8c72), seed2);
  const sw2 = mix(color(0x5f7079), color(0x6f818b), seed2);
  const sw3 = mix(color(0x6c7558), color(0x79835f), seed2);
  const sw4 = mix(color(0x8c5a44), color(0x9a6a52), seed2);
  const fabric = mix(
    mix(mix(mix(sw0, sw1, step(1.0, pick)), sw2, step(2.0, pick)), sw3, step(3.0, pick)),
    sw4,
    step(4.0, pick)
  );
  const pleatWave = sin(cUVx.mul(48.0).add(wSeed1.mul(6.28))).mul(float(1.0).sub(smoothstep(0.6, 1.6, cFw.mul(48.0))));
  const pleat = pleatWave.mul(0.205).add(0.945);
  const drapeCol = fabric.mul(pleat).mul(0.92).toVar();

  // A drape only transmits a little of the room's glow (0.20), never out-glowing the interior!
  const bestCol = mix(shadedRoom, drapeCol, inDrape);
  const bestEmit = mix(float(1.0), float(0.20), inDrape);
  const roomWarmth = mix(vec3(1.0), lightCol, lit.mul(0.85));
  const finalRoomCol = bestCol.mul(roomWarmth).mul(mix(float(0.85), float(1.35), lit));

  const distantLit = distantWindowLight(vec2(gridU, v.div(fH)), fwNode, litProbNode, seedNode, lod);
  return vec4(finalRoomCol, mix(litRoom, distantLit, lod).mul(bestEmit));
});

/**
 * Treatment of each wall of a box-local facade box (createFacadeBoxes `faces`, read by facadeCell). shop: street front
 * with storefronts on the ground floor; entry: residential street front, windows down to the ground floor and one
 * entrance door; rear: yard, court & air-shaft walls, plain common brick with windows on every floor; lotLine:
 * windowless lot-line (party) wall, common brick or grey parging; blankStone: windowless wall in the facade's stone.
 */
const WALL_KINDS = { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4 };

/**
 * Facade cell coordinates shared by the curtain-wall & pre-war materials: wall UV (u runs along whichever horizontal
 * axis the wall faces, v is world height), window cell id/UV, bay width, pixel footprint in cells (`fw`, for
 * filtering) and roof/ground-floor masks.
 * World-space by default. With `boxLocal` the mesh must come from createFacadeBoxes: u then starts at each wall's
 * corner and every wall fits a whole number of bays, so no window straddles a corner. `cornerPier` (m, box-local only)
 * keeps a solid band of wall at both ends of every wall (masonry corners): the bays fill the width between the piers
 * and `solid` is 1 inside the piers above the ground floor, where callers suppress windows, sills & AC units.
 * Box-local walls also read their treatment from the per-instance `faces` attribute (see WALL_KINDS / createFacadeBoxes):
 * `isGroundFloor` is 1 only on storefront ground floors, `door` marks the entrance bay of residential fronts, `back`
 * the plain common-brick rear & lot-line walls (tinted by the building's `tone`) and `blank` the windowless ones
 * (folded into `solid`); `wallS`, `wallW`, `wallH`, `fromTop` & `boxSeed` place things on the wall (painted signs).
 * Plain JS (not Fn) so it inlines into each node graph exactly like hand-written code.
 */
function facadeCell(windowWidth, floorHeight, boxLocal, cornerPier = 0) {
  // Box-local walls are told apart by the box's own normals (createFacadeBoxes instances may be turned about +y to
  // follow a non-grid street); world-space walls by the world normal
  const nWall = boxLocal ? normalGeometry : facadeWorldNormal;
  const nW = abs(nWall);
  const isRoof = step(0.75, nW.y);
  const alongZ = boxLocal ? step(nW.z, nW.x) : facadeAlongZ;
  let uCoord = mix(positionWorld.x, positionWorld.z, alongZ);
  let bayWidth = float(windowWidth);
  let gridU = uCoord.div(bayWidth);
  let inPier = float(0.0);
  let kind = float(WALL_KINDS.shop);
  let tone = float(0.5);
  let bayIdx = float(0.0); // bay index along the wall (0 at its corner; -1 / bays inside the corner piers)
  let bays = float(1.0);
  // Box-local wall frame: metres along the wall (from its left end, seen facing it), its width & height, metres
  // below the box's top
  let wallS = float(0.0);
  let wallW = float(1.0);
  let wallH = float(1.0);
  let fromTop = float(0.0);
  let boxSeed = float(0.0);

  if (boxLocal) {
    const box = attribute('box', 'vec4'); // width, height, depth, seed (+ the building's tone in its fraction)
    const faces = attribute('faces', 'vec4'); // WALL_KINDS of the -x, +x, -z & +z walls
    const wallWidth = mix(box.x, box.z, alongZ);
    // The box-local normal's sign tells which wall this is
    kind = mix(
      mix(faces.z, faces.w, step(0.0, nWall.z)),
      mix(faces.x, faces.y, step(0.0, nWall.x)),
      alongZ
    );
    // The seed's fraction (0.1..0.9, never near an integer so floor() is stable on inexact varyings) is the tone
    tone = fract(box.w).sub(0.1).div(0.8);
    boxSeed = floor(box.w);
    // Whole-bay offset per wall so walls don't repeat each other's windows
    const wallSeed = floor(box.w.add(dot(nWall, vec3(17.0, 0.0, 37.0))));
    const along = mix(positionGeometry.x, positionGeometry.z, alongZ).add(0.5); // 0..1 from the wall's corner
    wallW = wallWidth;
    // Reading left to right for someone facing the wall
    const flip = mix(step(nWall.z, 0.0), step(0.0, nWall.x), alongZ);
    wallS = mix(along, float(1.0).sub(along), flip).mul(wallWidth);
    wallH = box.y;
    fromTop = float(0.5).sub(positionGeometry.y).mul(box.y);
    if (cornerPier > 0) {
      const pier = min(float(cornerPier), wallWidth.mul(0.2));
      const inner = wallWidth.sub(pier.mul(2.0));
      bays = max(floor(inner.div(windowWidth).add(0.5)), 1.0);
      const s = along.mul(wallWidth); // metres from the wall's corner
      bayWidth = inner.div(bays);
      bayIdx = floor(s.sub(pier).div(bayWidth));
      gridU = s.sub(pier).div(bayWidth).add(wallSeed);
      inPier = float(1.0).sub(step(pier, s).mul(step(s, wallWidth.sub(pier))));
    } else {
      bays = max(floor(wallWidth.div(windowWidth).add(0.5)), 1.0);
      bayWidth = wallWidth.div(bays);
      bayIdx = floor(along.mul(bays));
      gridU = along.mul(bays).add(wallSeed);
    }
    uCoord = gridU.mul(bayWidth);
  }

  const vCoord = positionWorld.y;
  const gridV = vCoord.div(floorHeight);
  const cellId = vec2(floor(gridU), floor(gridV));
  const cellUV = vec2(fract(gridU), fract(gridV));
  const fw = vec2(fwidth(gridU), fwidth(gridV));

  // Ground floor is strictly floor index 0 (gridV < 1.0) so floor 1 is never sliced in half!
  const floor0 = float(1.0).sub(step(1.0, gridV));
  const wall = float(1.0).sub(isRoof);
  const isGroundFloor = floor0.mul(float(1.0).sub(step(WALL_KINDS.shop + 0.5, kind)));
  const blank = step(WALL_KINDS.lotLine - 0.5, kind).mul(wall);
  const back = step(WALL_KINDS.rear - 0.5, kind).mul(float(1.0).sub(step(WALL_KINDS.blankStone - 0.5, kind))).mul(wall);
  // One entrance per residential front, in a bay picked by the building's tone
  const isEntry = step(WALL_KINDS.entry - 0.5, kind).mul(float(1.0).sub(step(WALL_KINDS.entry + 0.5, kind)));
  const door = floor0.mul(isEntry).mul(wall).mul(step(abs(bayIdx.sub(min(floor(tone.mul(bays)), bays.sub(1.0)))), 0.5));
  // A box that isn't a whole number of storeys (landmark tiers) ends in a solid parapet instead of slicing a row of
  // windows, and starts with one above the roof it stands on; every wall is capped by a coping at its top
  let partial = float(0.0);
  let coping = float(0.0);
  if (boxLocal) {
    const top = vCoord.add(fromTop);
    const floorBase = floor(gridV).mul(floorHeight);
    const whole = step(top.sub(wallH).sub(0.05), floorBase).mul(step(floorBase.add(floorHeight), top.add(0.05)));
    partial = float(1.0).sub(whole).mul(wall);
    coping = float(1.0).sub(step(0.32, fromTop)).mul(wall);
  }
  const solid = max(max(inPier.mul(float(1.0).sub(isGroundFloor)), blank), partial);
  return {
    isRoof, uCoord, vCoord, gridV, cellId, cellUV, fw, bayWidth, isGroundFloor, solid, floor0, back, blank, door, tone,
    wallS, wallW, wallH, fromTop, boxSeed, partial, coping
  };
}

/**
 * Curtain-Wall Glass Skyscraper TSL Material
 * Features:
 * - Mikkelsen `bumpNormal` 3D Mullion Relief & Per-Pane Thermal Glass Warble
 * - Fast 3D Apartment/Upper-Level Interior Mapping (2D Glazing on Ground-Floor Shops)
 * - Urban Canyon Global Illumination (`aoNode` + warm bounce)
 */
function createCurtainWallMaterial(opts = {}) {
  const {
    glassTint = 0x162c42,
    frameTint = 0x26323e,
    windowWidth = 2.8,
    floorHeight = 3.8,
    mullionThickness = 0.075,
    spandrelRatio = 0.20,
    litProbability = 0.36,
    warmth = 0.62,
    reflectivity = 0.92,
    seed = 1.0,
    boxLocal = false
  } = opts;

  const cacheKey = `${glassTint}_${frameTint}_${windowWidth}_${floorHeight}_${litProbability}_${warmth}_${reflectivity}_${seed}_${boxLocal}`;
  if (_curtainWallCache.has(cacheKey)) {
    return _curtainWallCache.get(cacheKey);
  }

  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.72,
    roughness: 0.12
  });

  // The style's parameters are uniforms (not baked-in constants), so every curtain-wall style compiles to one shader
  const cGlass = uniform(new THREE.Color(glassTint));
  const cFrame = uniform(new THREE.Color(frameTint));
  const uWindowWidth = uniform(windowWidth);
  const uFloorHeight = uniform(floorHeight);
  const uLitProbability = uniform(litProbability);
  const uWarmth = uniform(warmth);
  const uReflectivity = uniform(reflectivity);
  const uSeed = uniform(seed);
  const cWarmLight = color(0xffe1a6);
  const cCanyonBounce = color(0xe89c68);

  mat.aoNode = canyonSkyAONode();

  // The facade cell and the apartment behind each pane are built once and shared by every output below, so the
  // shader carries a single copy of them (and evaluates the interior mapping once per pixel)
  const facade = facadeCell(uWindowWidth, uFloorHeight, boxLocal);
  const { isRoof, uCoord, vCoord, gridV, cellId, cellUV, fw, bayWidth, isGroundFloor, blank, tone, partial, coping } = facade;
  // Pane UV inside the mullions & spandrel, the 3D apartment behind it and whether the ground-floor shop is lit
  const winUV = clamp(
    vec2(
      cellUV.x.sub(mullionThickness).div(max(0.01, 1.0 - 2.0 * mullionThickness)),
      cellUV.y.sub(spandrelRatio).div(max(0.01, 1.0 - spandrelRatio - mullionThickness))
    ),
    vec2(0.0),
    vec2(1.0)
  );
  const aptRoom = evaluateApartmentInterior(uCoord, vCoord, winUV, cellId, bayWidth, uFloorHeight, uSeed, uWarmth, uLitProbability.mul(0.65), fw);
  const shopLit = step(0.24, hash2D(cellId.add(vec2(uSeed, 19.4))));
  const floorIdx = floor(gridV);
  const isMechFloor = float(1.0).sub(step(1.0, mod(floorIdx.add(uSeed), 16.0))).mul(step(4.0, floorIdx));

  mat.colorNode = Fn(() => {
    // No glass in a storey the box cuts short (solid spandrel instead) nor behind the coping
    const isGlassPane = filteredPulse(cellUV.x, mullionThickness * 0.5, 1.0 - mullionThickness * 0.5, fw.x)
      .mul(filteredPulse(cellUV.y, spandrelRatio + 0.015, 1.0 - mullionThickness * 0.5, fw.y))
      .mul(float(1.0).sub(isRoof)).mul(float(1.0).sub(partial)).mul(float(1.0).sub(coping));

    const louverStripes = sin(vCoord.mul(22.0)).mul(0.5).add(0.5);

    // Per-Pane Thermal/Wind Glass Warble & Pillow Distortion
    const paneRandX = hash2D(cellId.add(vec2(uSeed, 3.7))).sub(0.5);
    const paneRandY = hash2D(cellId.add(vec2(11.3, uSeed))).sub(0.5);
    const pillowBowX = cellUV.x.sub(0.5).mul(0.11).add(paneRandX.mul(0.09));
    const pillowBowY = cellUV.y.sub(0.55).mul(0.11).add(paneRandY.mul(0.09));

    const sunDir = normalize(cityUniforms.uSkySunDir);
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const nPane = normalize(normalWorldGeometry.add(vec3(pillowBowX, pillowBowY, pillowBowX.negate())));
    const reflectDir = reflect(viewDir.negate(), nPane);

    const fresnel = pow(clamp(float(1.0).sub(abs(dot(viewDir, nPane))), 0.0, 1.0), 2.1);
    const reflectElev = clamp(reflectDir.y.mul(0.65).add(0.38), 0.0, 1.0);

    // Reflected neighbouring buildings' silhouette, its edge & window grid filtered by their screen footprint
    const refAzimuth = uCoord.mul(0.045).add(reflectDir.x.mul(3.8)).add(reflectDir.z.mul(3.8));
    const neighborTowerH = hash2D(vec2(floor(refAzimuth.mul(2.4)), uSeed)).mul(0.46).add(0.16);
    const elevAA = fwidth(reflectElev).add(0.004);
    const inReflectedTower = smoothstep(neighborTowerH.add(elevAA), neighborTowerH.sub(elevAA), reflectElev);
    const refCols = refAzimuth.mul(15.0);
    const refRows = reflectElev.mul(30.0);
    const refWinGrid = filteredPulse(fract(refCols), 0.32, 1.0, fwidth(refCols))
      .mul(filteredPulse(fract(refRows), 0.32, 1.0, fwidth(refRows)));
    const reflectedBuildingCol = mix(
      color(0x0c1420),
      color(0xffd494),
      refWinGrid.mul(0.42).mul(cityUniforms.uInteriorGlow)
    );

    const skyReflect = mix(cityUniforms.uSkyHorizonColor, cityUniforms.uSkyTopColor, clamp(reflectElev.mul(1.4), 0.0, 1.0));
    const envReflection = mix(skyReflect, reflectedBuildingCol, inReflectedTower.mul(0.62));
    const sunSpec = pow(max(dot(reflectDir, sunDir), 0.0), 48.0).mul(1.25);

    // Upper levels use 3D apartment interior mapping; ground-floor shops use 2D glass
    const pooledDirt = float(1.0).sub(smoothstep(spandrelRatio, spandrelRatio + 0.22, cellUV.y)).mul(0.32);
    const grime = float(0.56).add(pooledDirt).clamp(0.0, 0.92);
    const shopShelves = float(1.0).sub(step(0.78, fract(winUV.y.mul(3.0))).mul(0.35));
    const shopTransomGlow = step(0.76, winUV.y).mul(0.35).add(0.65);
    const shopInterior = cWarmLight.mul(shopShelves).mul(shopTransomGlow).mul(mix(float(0.28), float(0.88), shopLit));
    const shopBase = mix(cGlass, shopInterior, float(0.56).mul(float(1.0).sub(pooledDirt)));
    const upperGlazed = mix(aptRoom.xyz.mul(color(0xb6c6bf)), cGlass, grime);
    const glazedBase = mix(upperGlazed, shopBase, isGroundFloor);

    const glassColor = mix(glazedBase, envReflection, fresnel.mul(uReflectivity).add(0.18))
      .add(cityUniforms.uSunColor.mul(sunSpec));

    const spandrelDark = cFrame.mul(0.52);
    const frameBase = mix(cFrame, spandrelDark, filteredPulse(cellUV.y, 0.0, spandrelRatio, fw.y));

    const canyonBand = smoothstep(0.0, 14.0, vCoord).mul(float(1.0).sub(smoothstep(22.0, 75.0, vCoord)));
    const canyonGlow = cCanyonBounce.mul(canyonBand.mul(cityUniforms.uCanyonBounce).mul(0.16));

    const roofNoise = noise2D(positionWorld.xz.mul(0.35));
    const roofColor = mix(color(0x202429), color(0x3b4149), roofNoise);

    const facadeCol = mix(frameBase, glassColor, isGlassPane.mul(float(1.0).sub(isMechFloor))).add(canyonGlow);
    const mechCol = mix(cFrame.mul(0.36), cFrame.mul(0.76), louverStripes);
    const finalWall = mix(facadeCol, mechCol, isMechFloor.mul(float(1.0).sub(isRoof)));

    // Windowless lot-line walls: weathered precast concrete panels, a panel per bay & storey
    const panelJoint = max(filteredPulse(cellUV.x, 0.0, 0.025, fw.x), filteredPulse(cellUV.y, 0.0, 0.03, fw.y));
    const panelStain = noise2D(vec2(uCoord.mul(0.9), vCoord.mul(0.04))).mul(float(1.0).sub(smoothstep(0.4, 1.2, fwidth(uCoord))));
    const panelCol = mix(color(0x8a867e), color(0xaaa59b), tone).mul(panelStain.mul(0.16).add(0.9)).mul(float(1.0).sub(panelJoint.mul(0.3)));
    const withBlank = mix(finalWall, panelCol.add(canyonGlow), blank);
    // Brushed-aluminium coping capping every wall
    const withCap = mix(withBlank, mix(cFrame, color(0xc9ced3), 0.45), coping);

    return mix(withCap, roofColor, isRoof);
  })();

  mat.roughnessNode = Fn(() => {
    const isFrame = float(1.0).sub(
      filteredPulse(cellUV.x, mullionThickness, 1.0 - mullionThickness, fw.x).mul(filteredPulse(cellUV.y, spandrelRatio, 1.0, fw.y))
    );
    const sillDirt = float(1.0).sub(smoothstep(spandrelRatio, spandrelRatio + 0.18, cellUV.y)).mul(0.18);
    const glassOrFrame = mix(float(0.05).add(sillDirt), float(0.54), max(max(isFrame, isRoof), partial));
    return mix(mix(glassOrFrame, float(0.36), coping), float(0.88), blank);
  })();

  // Glass & metal, but the concrete lot-line walls aren't
  mat.metalnessNode = mix(float(0.72), float(0.0), blank);

  // Hardware derivative bumpNormal for raised curtain-wall mullions & spandrel channels (ramps >= 2px, see pre-war)
  mat.normalNode = Fn(() => {
    const camDist = length(positionWorld.sub(cameraPosition));
    const detailFade = float(1.0).sub(smoothstep(18.0, 140.0, camDist)).mul(float(1.0).sub(isRoof))
      .mul(float(1.0).sub(smoothstep(0.03, 0.1, max(fw.x, fw.y))));

    const ramp = fw.mul(2.0).max(0.02);
    const inPane = filteredPulse(cellUV.x, mullionThickness + 0.01, 0.99 - mullionThickness, ramp.x)
      .mul(filteredPulse(cellUV.y, spandrelRatio + 0.01, 0.99 - mullionThickness, ramp.y))
      .mul(float(1.0).sub(partial)).mul(float(1.0).sub(coping));
    const mullionRelief = float(1.0).sub(inPane).mul(0.014).mul(float(1.0).sub(blank)).add(coping.mul(0.01));

    return bumpNormal(mullionRelief.mul(detailFade));
  })();

  mat.emissiveNode = Fn(() => {
    const inPane = filteredPulse(cellUV.x, mullionThickness + 0.015, 1.0 - mullionThickness - 0.015, fw.x)
      .mul(filteredPulse(cellUV.y, spandrelRatio + 0.02, 1.0 - mullionThickness * 0.5, fw.y));
    const paneMask = inPane.mul(float(1.0).sub(isRoof)).mul(float(1.0).sub(isMechFloor)).mul(float(1.0).sub(blank))
      .mul(float(1.0).sub(partial)).mul(float(1.0).sub(coping));

    const shopShelves = float(1.0).sub(step(0.78, fract(winUV.y.mul(3.0))).mul(0.32));
    const shopEmit = cWarmLight.mul(shopLit).mul(shopShelves).mul(0.62);
    const emitCol = mix(aptRoom.xyz.mul(aptRoom.w), shopEmit, isGroundFloor);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(clamp(float(1.0).sub(abs(dot(viewDir, normalWorldGeometry))), 0.0, 1.0), 2.0);
    const transmission = float(1.0).sub(fresnel.mul(0.75));

    return emitCol
      .mul(transmission)
      .mul(paneMask)
      .mul(cityUniforms.uInteriorGlow)
      .mul(0.72);
  })();

  _curtainWallCache.set(cacheKey, mat);
  return mat;
}

/**
 * Pre-War Limestone, Terra Cotta, Running-Bond Brick & Brownstone TSL Material
 * Features (ported from SkyscraperGenerator.js):
 * - Anti-Aliased Running-Bond Brickwork with Domed Brick Face Relief (`bumpNormal`)
 * - Fast 3D Apartment Interior Mapping on Upper Floors (2D Glazing on Ground-Floor Shops)
 * - Protruding Window Air-Conditioner Units (`acUnits`) with Louver Relief & Condensate Grime
 * - Grimy Soda-Lime Window Glazing (pooled sill dirt + vertical rain streaks)
 * - Urban Canyon Global Illumination (`aoNode` + warm terracotta bounce)
 */
function createPreWarBuildingMaterial(opts = {}) {
  const {
    stoneColor = 0xd8ceb8,
    trimColor = 0x9e937f,
    windowGlassColor = 0x162432,
    windowWidth = 2.7,
    floorHeight = 3.8,
    windowRatioX = 0.50,
    windowRatioY = 0.58,
    litProbability = 0.36,
    warmth = 0.82,
    crownGlowHeight = 9999.0,
    crownGlowColor = 0xffe0a3,
    seed = 42.0,
    boxLocal = false,
    cornerPier = 1.2 // solid masonry at both ends of every wall above the shopfronts (box-local mode)
  } = opts;

  const cacheKey = `${stoneColor}_${trimColor}_${windowWidth}_${floorHeight}_${litProbability}_${warmth}_${crownGlowHeight}_${seed}_${boxLocal}_${cornerPier}`;
  if (_preWarCache.has(cacheKey)) {
    return _preWarCache.get(cacheKey);
  }

  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.06,
    roughness: 0.76
  });

  // The style's parameters are uniforms (not baked-in constants), so every masonry style compiles to one shader
  const cStone = uniform(new THREE.Color(stoneColor));
  const cTrim = uniform(new THREE.Color(trimColor));
  const cGlass = uniform(new THREE.Color(windowGlassColor));
  const cCrown = uniform(new THREE.Color(crownGlowColor));
  const uWindowWidth = uniform(windowWidth);
  const uFloorHeight = uniform(floorHeight);
  const uLitProbability = uniform(litProbability);
  const uWarmth = uniform(warmth);
  const uCrownGlowHeight = uniform(crownGlowHeight);
  const uSeed = uniform(seed);
  const cSoot = color(0x4a4236);
  const cWarmWindow = color(0xffcf86);
  const cCoolWindow = color(0xcfe2ff);
  const cCanyonBounce = color(0xe89c68);

  const halfWinX = (1.0 - windowRatioX) * 0.5;
  const halfWinY = (1.0 - windowRatioY) * 0.5;

  mat.aoNode = canyonSkyAONode();

  // The facade cell, the window opening and the apartment behind it are built once and shared by every output below,
  // so the shader carries a single copy of them (and evaluates the interior mapping once per pixel)
  const facade = facadeCell(uWindowWidth, uFloorHeight, boxLocal, cornerPier);
  const { isRoof, uCoord, vCoord, gridV, cellId, cellUV, fw, bayWidth, isGroundFloor, solid, back, blank, door, tone } = facade;
  const { wallS, wallW, wallH, fromTop, boxSeed, coping } = facade;
  const open = float(1.0).sub(solid).mul(float(1.0).sub(door)); // 0 in the corner piers, blank walls & doorways
  const front = float(1.0).sub(back).sub(blank).max(0.0); // street fronts (band courses, sills under the band...)
  const effHalfX = mix(float(halfWinX), float(0.11), isGroundFloor);
  const effHalfY = mix(float(halfWinY), float(0.10), isGroundFloor);
  // Glazing UV inside the window opening, the 3D apartment behind it and the storefront lighting
  const winUV = clamp(
    vec2(
      cellUV.x.sub(effHalfX).div(max(0.01, float(1.0).sub(effHalfX.mul(2.0)))),
      cellUV.y.sub(effHalfY).div(max(0.01, float(1.0).sub(effHalfY.mul(2.0))))
    ),
    vec2(0.0),
    vec2(1.0)
  );
  const aptRoom = evaluateApartmentInterior(uCoord, vCoord, winUV, cellId, bayWidth, uFloorHeight, uSeed, uWarmth, uLitProbability.mul(0.62), fw);
  const shopLit = step(0.24, hash2D(cellId.add(vec2(uSeed, 19.4))));
  const bulbCol = mix(cCoolWindow, cWarmWindow, step(float(1.0).sub(uWarmth), hash2D(cellId.add(vec2(uSeed.mul(1.9), 83.1)))));
  // Window AC units (~12% of upper-floor windows), none in the floor the band course covers
  const beltFloor = step(5.0, mod(floor(gridV), 6.0)).mul(front);
  const acRand = hash2D(cellId.add(vec2(uSeed.mul(1.3).add(7.1), 91.7)));
  const hasAC = step(0.88, acRand).mul(float(1.0).sub(isGroundFloor)).mul(float(1.0).sub(isRoof)).mul(open).mul(float(1.0).sub(beltFloor));

  mat.colorNode = Fn(() => {
    const oneMinusEffX = float(1.0).sub(effHalfX);
    const oneMinusEffY = float(1.0).sub(effHalfY);

    const inX = filteredPulse(cellUV.x, effHalfX, oneMinusEffX, fw.x).mul(open);
    const inY = filteredPulse(cellUV.y, effHalfY, oneMinusEffY, fw.y);

    // Horizontal cornice belt every 6 floors (street fronts only) + ground floor storefront fascia at top of floor 0
    const cornicePhase = fract(gridV.div(6.0));
    const isCornice = max(
      filteredPulse(cornicePhase, 0.86, 1.0, fw.y.div(6.0)).mul(front),
      isGroundFloor.mul(filteredPulse(cellUV.y, 0.86, 1.0, fw.y))
    );

    // Double-hung meeting rail on upper floors + storefront transom & mullions on ground floor
    const sashBarY = lineAA(cellUV.y.sub(0.52), 0.012).mul(float(1.0).sub(isGroundFloor));
    const sashBarX = lineAA(cellUV.x.sub(0.50), 0.009).mul(float(1.0).sub(isGroundFloor)).mul(0.55);
    const storeTransom = lineAA(cellUV.y.sub(0.70), 0.015).mul(isGroundFloor);
    const storeMullion = lineAA(fract(cellUV.x.mul(2.0)).sub(0.5), 0.018).mul(isGroundFloor);
    const sashMask = clamp(max(max(sashBarY, sashBarX), max(storeTransom, storeMullion)), 0.0, 1.0);

    // Protruding Window Air-Conditioner Unit, sitting on the sill (see hasAC)
    const acMinX = float(0.31);
    const acMaxX = float(0.69);
    const acMinY = effHalfY;
    const acMaxY = effHalfY.add(0.22);
    const inACBox = filteredPulse(cellUV.x, acMinX, acMaxX, fw.x)
      .mul(filteredPulse(cellUV.y, acMinY, acMaxY, fw.y))
      .mul(hasAC);
    const acUV = clamp(
      vec2(cellUV.x.sub(acMinX).div(0.38), cellUV.y.sub(acMinY).div(0.22)),
      vec2(0.0),
      vec2(1.0)
    );
    const acGrille = smoothstep(0.08, 0.16, acUV.x).mul(float(1.0).sub(smoothstep(0.84, 0.92, acUV.x)))
      .mul(smoothstep(0.14, 0.22, acUV.y)).mul(float(1.0).sub(smoothstep(0.84, 0.92, acUV.y)));
    const acSlats = fract(acUV.y.mul(6.0));
    const acPlastic = mix(color(0xf0eee8), color(0xcac6bc), fract(acRand.mul(7.3)));
    const acColor = acPlastic.mul(mix(float(1.0), mix(float(0.38), float(0.75), acSlats), acGrille));
    const acUnderShadow = filteredPulse(cellUV.x, acMinX.sub(0.02), acMaxX.add(0.02), fw.x)
      .mul(filteredPulse(cellUV.y, effHalfY.sub(0.09), effHalfY, fw.y))
      .mul(hasAC).mul(0.42);

    const isWindowOpening = inX.mul(inY).mul(float(1.0).sub(isRoof)).mul(float(1.0).sub(isCornice));
    const isWindowGlass = isWindowOpening.mul(float(1.0).sub(sashMask)).mul(float(1.0).sub(inACBox));

    // Anti-Aliased Running-Bond Brickwork & Ashlar Stone Coursing
    const brickH = 0.24;
    const brickL = 0.56;
    const rowCoord = vCoord.div(brickH);
    const courseRow = floor(rowCoord);
    const colCoord = uCoord.div(brickL).add(mod(courseRow, 2.0).mul(0.5));
    // Rear, court & lot-line walls are plain common brick (red-brown or buff by building); lot-line walls weather in
    // patches of grey parging (worked out on those walls only), some are parged all over
    const backBrick = mix(
      mix(color(0x6c3d30), color(0x8a503e), fract(tone.mul(7.31))),
      mix(color(0x9a8669), color(0xb09a7a), fract(tone.mul(5.17))),
      step(0.58, tone)
    );
    const parged = float(0.0).toVar();
    If(blank.mul(back).greaterThan(0.5), () => {
      const pargePatch = smoothstep(0.6, 0.76, noise2D(vec2(uCoord.mul(0.11), vCoord.mul(0.07)).add(tone.mul(37.0))));
      parged.assign(max(step(0.74, fract(tone.mul(3.7))), pargePatch.mul(0.85)));
    });
    const backTint = mix(backBrick, color(0x8f8b84), parged);
    const mortarJoint = max(
      gridLine(colCoord.mul(brickL), brickL, 0.016),
      gridLine(vCoord, brickH, 0.016)
    ).mul(float(1.0).sub(isRoof)).mul(float(1.0).sub(parged)).mul(float(1.0).sub(coping));

    // Per-brick tint fades out once bricks shrink to a pixel (and soot streaks once they do), so neither can shimmer
    const uFw = fwidth(uCoord);
    const brickVar = float(1.0).sub(smoothstep(0.5, 1.0, max(uFw.div(brickL), fwidth(rowCoord))));
    const brickCell = vec2(floor(colCoord), courseRow);
    const brickRnd = hash2D(brickCell.add(vec2(uSeed, 5.3))).sub(0.5).mul(brickVar);
    const brickWarmShift = hash2D(brickCell.add(vec2(17.1, uSeed))).sub(0.5).mul(0.12).mul(brickVar);
    const brickShiftVec = vec3(float(1.0).add(brickWarmShift), float(1.0), float(1.0).sub(brickWarmShift));

    const streakNoise = mix(float(0.5), noise2D(vec2(uCoord.mul(1.4), vCoord.mul(0.05))), float(1.0).sub(smoothstep(0.5, 1.0, uFw.mul(1.4))));
    const sootDirt = smoothstep(0.25, 0.78, streakNoise).mul(float(1.0).sub(smoothstep(0.0, 180.0, vCoord))).mul(0.36);

    const lintelShadow = smoothstep(oneMinusEffY.sub(0.14), oneMinusEffY, cellUV.y).mul(0.58);
    const jambShadow = float(1.0).sub(smoothstep(effHalfX, effHalfX.add(0.08), cellUV.x)).mul(0.42);
    // No sills in the floor the band course covers
    const sillSpan = filteredPulse(cellUV.x, effHalfX.sub(0.045), oneMinusEffX.add(0.045), fw.x).mul(open).mul(float(1.0).sub(beltFloor));
    const isSillTop = filteredPulse(cellUV.y, effHalfY.sub(0.032), effHalfY, fw.y).mul(sillSpan);
    const isSillUnderShadow = filteredPulse(cellUV.y, effHalfY.sub(0.075), effHalfY.sub(0.032), fw.y).mul(sillSpan);

    const corniceShadow = smoothstep(0.76, 0.86, cornicePhase).mul(0.32).mul(front);

    const canyonBand = smoothstep(0.0, 14.0, vCoord).mul(float(1.0).sub(smoothstep(22.0, 75.0, vCoord)));
    const canyonGlow = cCanyonBounce.mul(canyonBand.mul(cityUniforms.uCanyonBounce).mul(0.22));

    // Faded painted advertisement ("ghost sign") high on some lot-line walls: a panel with a line of tall block letters
    // over a smaller one, flaking off the brick. The lettering is only worked out inside the panel.
    const signW = min(wallW.sub(3.0), 18.0);
    const signH = min(min(wallH.mul(0.3), signW.mul(0.42)), 6.5);
    const hasSign = blank.mul(back).mul(float(1.0).sub(step(0.74, fract(tone.mul(3.7)))))
      .mul(step(0.8, fract(tone.mul(13.7).add(boxSeed.mul(0.618)))))
      .mul(step(5.0, signW)).mul(step(2.6, signH));
    const su = wallS.sub(wallW.sub(signW).mul(0.5)).div(signW); // 0..1 across the panel
    const sv = fromTop.sub(1.2).div(signH); // 0..1 down the panel
    const signFw = vec2(fwidth(su), fwidth(sv));
    const signPaint = vec4(0.0).toVar();
    If(hasSign.mul(step(0.0, su)).mul(step(su, 1.0)).mul(step(0.0, sv)).mul(step(sv, 1.0)).greaterThan(0.5), () => {
      const pal = fract(tone.mul(29.3));
      const ground = mix(mix(color(0xd3c9ae), color(0x86392b), step(0.5, pal)), color(0x2b3340), step(0.8, pal));
      const ink = mix(mix(color(0x6b2a20), color(0xddd2b6), step(0.5, pal)), color(0xd5c086), step(0.8, pal));
      const border = float(1.0).sub(filteredPulse(su, 0.02, 0.98, signFw.x).mul(filteredPulse(sv, 0.045, 0.955, signFw.y)));
      // Block letters: a vertical at the left (or middle) and maybe the right, bars at the top / middle / bottom
      const lettering = (v0, v1, line) => {
        const glyphW = signH.mul((v1 - v0) * 0.64);
        const n = floor(signW.mul(0.86).div(glyphW));
        const gx = su.mul(signW).sub(signW.sub(n.mul(glyphW)).mul(0.5)).div(glyphW);
        const fy = sv.sub(v0).div(v1 - v0);
        const wx = signFw.x.mul(signW).div(glyphW);
        const wy = signFw.y.div(v1 - v0);
        const fx = fract(gx);
        const h1 = hash2D(vec2(floor(gx).add(line * 31.0), tone.mul(91.0)));
        const h2 = hash2D(vec2(floor(gx).add(line * 31.0 + 7.0), tone.mul(53.0)));
        const verticals = max(
          max(filteredPulse(fx, 0.1, 0.28, wx).mul(step(0.22, h1)), filteredPulse(fx, 0.41, 0.59, wx).mul(step(h1, 0.22))),
          filteredPulse(fx, 0.72, 0.9, wx).mul(step(0.45, h2))
        );
        const bars = max(
          max(filteredPulse(fy, 0.0, 0.17, wy).mul(step(0.35, fract(h1.mul(7.0)))), filteredPulse(fy, 0.42, 0.58, wy).mul(step(0.5, fract(h2.mul(5.0))))),
          filteredPulse(fy, 0.83, 1.0, wy).mul(step(0.4, fract(h1.mul(3.0))))
        ).mul(filteredPulse(fx, 0.1, 0.9, wx));
        const inText = step(0.0, gx).mul(step(gx, n)).mul(step(0.0, fy)).mul(step(fy, 1.0)).mul(step(0.1, fract(h2.mul(11.0))));
        return max(verticals, bars).mul(inText);
      };
      const letters = max(lettering(0.14, 0.56, 0), lettering(0.66, 0.86, 1));
      const flake = smoothstep(0.5, 0.74, noise2D(vec2(wallS.mul(0.7), fromTop.mul(1.1)).add(tone.mul(31.0))));
      const cover = mix(float(0.34), float(0.66), fract(tone.mul(7.7))).mul(float(1.0).sub(flake.mul(0.9)));
      signPaint.assign(vec4(mix(ground, ink, max(letters, border)), cover));
    });

    const wallTint = mix(mix(cStone, backTint, back), signPaint.xyz, signPaint.w);
    // Trim stone on the band courses, the storefront fascia and the coping capping every wall
    const trimMix = max(isCornice.mul(0.62).add(isGroundFloor.mul(0.28)), coping.mul(0.8));
    const masonryTint = mix(wallTint, cTrim, trimMix)
      .mul(brickRnd.mul(0.14).add(1.0))
      .mul(brickShiftVec);
    const masonryWithMortar = mix(masonryTint, masonryTint.mul(0.62), mortarJoint);
    const masonryWeathered = mix(masonryWithMortar, cSoot, sootDirt)
      .mul(float(1.0).sub(corniceShadow))
      .mul(float(1.0).sub(isSillUnderShadow.mul(0.42)))
      .mul(float(1.0).sub(acUnderShadow))
      .add(cityUniforms.uSunColor.mul(isSillTop.mul(0.24)))
      .add(canyonGlow);

    // Upper apartment floors use 3D interior mapping behind grimy soda-lime glazing;
    // ground-floor shops use 2D reflective storefront glass
    const pooledDirt = float(1.0).sub(smoothstep(0.0, 0.32, winUV.y)).mul(0.36);
    // Grimy soda-lime glazing film (SkyscraperGenerator.js line 1688): baseline haze so panes read as glass, not open holes
    const upperGrime = float(0.52).add(sootDirt.mul(0.35)).add(pooledDirt).clamp(0.0, 0.90);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(clamp(float(1.0).sub(abs(dot(viewDir, normalWorldGeometry))), 0.0, 1.0), 2.0);
    const recessShade = float(1.0).sub(max(lintelShadow, jambShadow));

    const upperGlassBase = mix(aptRoom.xyz.mul(color(0xb6c6bf)), cGlass, upperGrime);
    const shopShelves = float(1.0).sub(step(0.76, fract(winUV.y.mul(3.0))).mul(0.34));
    const shopInterior = bulbCol.mul(smoothstep(0.05, 0.92, winUV.y).mul(0.48).add(0.24)).mul(shopShelves).mul(shopLit);
    const shopGlassBase = mix(cGlass, shopInterior, float(0.62).mul(float(1.0).sub(pooledDirt)));
    const glassBase = mix(upperGlassBase, shopGlassBase, isGroundFloor);
    const glassCol = mix(glassBase, cityUniforms.uSkyHorizonColor, fresnel.mul(0.52).add(0.08)).mul(recessShade);

    const frameCol = masonryTint.mul(0.46).mul(recessShade);
    const roofNoise = noise2D(positionWorld.xz.mul(0.35));
    const roofCol = mix(cTrim.mul(0.42), cTrim.mul(0.62), roofNoise);

    const wallOrRoof = mix(masonryWeathered, roofCol, isRoof);
    const withFrames = mix(wallOrRoof, frameCol, isWindowOpening.mul(sashMask));
    const withGlass = mix(withFrames, glassCol, isWindowGlass);
    const withAC = mix(withGlass, acColor, inACBox);

    // Entrance of a residential front: painted panel door under a glazed transom, in a stone surround (door bay only)
    const finalCol = withAC.toVar();
    If(door.greaterThan(0.5), () => {
      const inDoorway = filteredPulse(cellUV.x, 0.27, 0.73, fw.x).mul(filteredPulse(cellUV.y, 0.065, 0.8, fw.y));
      const surround = filteredPulse(cellUV.x, 0.21, 0.79, fw.x).mul(filteredPulse(cellUV.y, 0.0, 0.86, fw.y));
      const transom = filteredPulse(cellUV.y, 0.67, 0.78, fw.y);
      const doorRnd = fract(tone.mul(11.3));
      const doorPaint = mix(
        mix(color(0x1c1b1a), color(0x4c2018), step(0.35, doorRnd)),
        mix(color(0x203528), color(0x6a4628), step(0.8, doorRnd)),
        step(0.6, doorRnd)
      );
      // Meeting stiles & lock rail (box-filtered with the cell footprint: no derivatives in this branch)
      const doorPanels = max(filteredPulse(cellUV.x, 0.494, 0.506, fw.x), filteredPulse(cellUV.y, 0.39, 0.41, fw.y));
      const doorCol = mix(doorPaint.mul(float(1.0).sub(doorPanels.mul(0.5))), mix(cGlass, cityUniforms.uSkyHorizonColor, 0.18), transom);
      finalCol.assign(mix(mix(withAC, cTrim.mul(0.85), surround), doorCol, inDoorway));
    });
    return finalCol;
  })();

  mat.roughnessNode = Fn(() => {
    const belt = filteredPulse(gridV.div(6.0), 0.86, 1.0, fw.y.div(6.0)).mul(front);
    const inX = filteredPulse(cellUV.x, halfWinX, 1.0 - halfWinX, fw.x).mul(open).mul(float(1.0).sub(belt));
    const inY = filteredPulse(cellUV.y, halfWinY, 1.0 - halfWinY, fw.y);
    const isWindow = inX.mul(inY).mul(float(1.0).sub(isRoof));

    const winY = clamp(cellUV.y.sub(halfWinY).div(max(0.01, 1.0 - 2.0 * halfWinY)), 0.0, 1.0);
    const pooledRough = float(1.0).sub(smoothstep(0.0, 0.32, winY)).mul(0.38);
    const glassRough = float(0.14).add(pooledRough);

    const stoneGrain = noise2D(vec2(uCoord.mul(8.0), vCoord.mul(8.0))).mul(0.12);
    return mix(float(0.78).add(stoneGrain), glassRough, isWindow);
  })();

  // Hardware derivative bumpNormal for domed brickwork, stone courses, recessed windows & AC louvers. Edges ramp over
  // >= 2px and the fine brick & louver relief fades before it shrinks to pixels: sharper height steps turn into
  // derivative sparkles that crawl along every mortar joint & sill as the camera moves
  mat.normalNode = Fn(() => {
    const camDist = length(positionWorld.sub(cameraPosition));
    const detailFade = float(1.0).sub(smoothstep(16.0, 150.0, camDist)).mul(float(1.0).sub(isRoof))
      .mul(float(1.0).sub(smoothstep(0.03, 0.1, max(fw.x, fw.y))));
    const ramp = fw.mul(2.0);
    const footprint = max(fwidth(uCoord), fwidth(vCoord)); // Meters per pixel

    // Stone band course every 6 floors on street fronts: no window recesses, sills or AC units in it
    const belt = filteredPulse(gridV.div(6.0), 0.86, 1.0, ramp.y.div(6.0)).mul(front);
    const inX = filteredPulse(cellUV.x, effHalfX, float(1.0).sub(effHalfX), ramp.x).mul(open).mul(float(1.0).sub(belt));
    const inY = filteredPulse(cellUV.y, effHalfY, float(1.0).sub(effHalfY), ramp.y);
    const isWindow = inX.mul(inY);

    const brickH = 0.24;
    const brickL = 0.56;
    const rowCoord = vCoord.div(brickH);
    const courseRow = floor(rowCoord);
    const colCoord = uCoord.div(brickL).add(mod(courseRow, 2.0).mul(0.5));
    const distU = float(0.5).sub(abs(fract(colCoord).sub(0.5))).mul(brickL);
    const distV = float(0.5).sub(abs(fract(rowCoord).sub(0.5))).mul(brickH);
    const brickDome = smoothstep(0.0, 0.018, distU).mul(smoothstep(0.0, 0.018, distV)).mul(0.0045)
      .mul(float(1.0).sub(smoothstep(0.006, 0.012, footprint)));

    const sillLedge = filteredPulse(cellUV.y, effHalfY.sub(0.032), effHalfY, ramp.y).mul(inX).mul(0.016);
    const corniceLedge = belt.mul(0.022);

    const inACBox = filteredPulse(cellUV.x, 0.31, 0.69, ramp.x)
      .mul(filteredPulse(cellUV.y, effHalfY, effHalfY.add(0.22), ramp.y))
      .mul(hasAC);
    const acLouverHeight = fract(cellUV.y.sub(effHalfY).div(0.22).mul(6.0)).mul(0.012)
      .mul(float(1.0).sub(smoothstep(0.012, 0.025, footprint)));

    const wallHeight = brickDome.mul(float(1.0).sub(coping)).add(sillLedge).add(corniceLedge).add(coping.mul(0.024));
    const totalHeight = mix(wallHeight, acLouverHeight.mul(inACBox), isWindow);

    return bumpNormal(totalHeight.mul(detailFade));
  })();

  mat.emissiveNode = Fn(() => {
    // The glow stays a hair inside the glazing
    const glowHalfX = mix(float(halfWinX + 0.015), float(0.12), isGroundFloor);
    const glowHalfY = mix(float(halfWinY + 0.015), float(0.11), isGroundFloor);

    const inX = filteredPulse(cellUV.x, glowHalfX, float(1.0).sub(glowHalfX), fw.x).mul(open);
    const inY = filteredPulse(cellUV.y, glowHalfY, float(1.0).sub(glowHalfY), fw.y);
    const isCornice = max(
      filteredPulse(fract(gridV.div(6.0)), 0.86, 1.0, fw.y.div(6.0)).mul(front),
      isGroundFloor.mul(filteredPulse(cellUV.y, 0.86, 1.0, fw.y))
    );

    const sashBarY = lineAA(cellUV.y.sub(0.52), 0.014).mul(float(1.0).sub(isGroundFloor));
    const sashBarX = lineAA(cellUV.x.sub(0.50), 0.010).mul(float(1.0).sub(isGroundFloor)).mul(0.55);
    const storeTransom = lineAA(cellUV.y.sub(0.70), 0.016).mul(isGroundFloor);
    const storeMullion = lineAA(fract(cellUV.x.mul(2.0)).sub(0.5), 0.020).mul(isGroundFloor);
    const sashMask = clamp(max(max(sashBarY, sashBarX), max(storeTransom, storeMullion)), 0.0, 1.0);

    const inACBox = filteredPulse(cellUV.x, 0.31, 0.69, fw.x)
      .mul(filteredPulse(cellUV.y, glowHalfY, glowHalfY.add(0.22), fw.y))
      .mul(hasAC);

    const isWindow = inX.mul(inY)
      .mul(float(1.0).sub(isRoof))
      .mul(float(1.0).sub(isCornice))
      .mul(float(1.0).sub(sashMask))
      .mul(float(1.0).sub(inACBox));

    const shopShelves = float(1.0).sub(step(0.76, fract(winUV.y.mul(3.0))).mul(0.32));
    const vertGrad = smoothstep(0.08, 0.92, winUV.y).mul(0.62).add(0.28);
    const shopEmit = bulbCol.mul(shopLit).mul(vertGrad).mul(shopShelves).mul(0.58);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(clamp(float(1.0).sub(abs(dot(viewDir, normalWorldGeometry))), 0.0, 1.0), 1.8);
    const transmission = float(1.0).sub(fresnel.mul(0.82));

    const winEmit = mix(aptRoom.xyz.mul(aptRoom.w).mul(0.76), shopEmit, isGroundFloor)
      .mul(transmission)
      .mul(isWindow)
      .mul(cityUniforms.uInteriorGlow);

    const crownMask = smoothstep(uCrownGlowHeight, uCrownGlowHeight.add(26.0), vCoord).mul(float(1.0).sub(isRoof.mul(0.5)));
    const crownFlood = cCrown.mul(crownMask).mul(cityUniforms.uInteriorGlow).mul(0.55);

    // Lit hallway behind the entrance transom
    const transomGlow = door.mul(filteredPulse(cellUV.x, 0.27, 0.73, fw.x)).mul(filteredPulse(cellUV.y, 0.67, 0.78, fw.y));
    const doorEmit = cWarmWindow.mul(transomGlow).mul(cityUniforms.uInteriorGlow).mul(0.32);

    return winEmit.add(crownFlood).add(doorEmit);
  })();

  _preWarCache.set(cacheKey, mat);
  return mat;
}

/**
 * Abuja's Rendered & Painted Concrete Facade TSL Material (box-local, createFacadeBoxes with `paint`)
 * Most of the city is reinforced-concrete frame and sandcrete block, plastered and painted: cream, off-white, beige,
 * sand, peach, pale yellow & grey, often with a contrasting band at every floor slab. Windows are aluminium-framed
 * casements & sliders in tinted glass (bronze, blue-green or dark), with steel burglary bars on the ground floor of
 * houses; commercial buildings have a glazed ground floor. Red laterite dust splashes the foot of every wall. Per
 * instance `paint` attribute: rgb = the building's paint (linear), w = glass style 0..1.
 */
const _renderedCache = new Map();
function createRenderedFacadeMaterial(opts = {}) {
  const {
    windowWidth = 3.1,
    floorHeight = 3.4,
    windowRatioX = 0.46,
    windowRatioY = 0.5,
    litProbability = 0.42,
    warmth = 0.86,
    seed = 13.0,
    cornerPier = 0.7
  } = opts;
  const cacheKey = `${windowWidth}_${floorHeight}_${windowRatioX}_${windowRatioY}_${litProbability}_${warmth}_${seed}_${cornerPier}`;
  if (_renderedCache.has(cacheKey)) return _renderedCache.get(cacheKey);

  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.85 });
  const uWindowWidth = uniform(windowWidth);
  const uFloorHeight = uniform(floorHeight);
  const uLitProbability = uniform(litProbability);
  const uWarmth = uniform(warmth);
  const uSeed = uniform(seed);
  const cWarmWindow = color(0xffcf86);
  const cCoolWindow = color(0xd8e8ff);
  const halfWinX = (1.0 - windowRatioX) * 0.5;
  const halfWinY = (1.0 - windowRatioY) * 0.5;

  mat.aoNode = canyonSkyAONode();
  const facade = facadeCell(uWindowWidth, uFloorHeight, true, cornerPier);
  const { isRoof, uCoord, vCoord, gridV, cellId, cellUV, fw, bayWidth, isGroundFloor, solid, door, tone, floor0, coping } = facade;
  const paintAttr = attribute('paint', 'vec4');
  const paint = paintAttr.xyz;
  // --- Toronto layer: paint.w >= 2 marks a brick building (its glass style in the fraction), the brick & stone colours
  // measured from Wikimedia Commons photos (buildings.js TORONTO_MASONRY, after aalghooneh/slop-toronto) ---
  const isBrick = step(1.5, paintAttr.w);
  const glassStyle = fract(paintAttr.w);
  // --- end Toronto layer ---
  const open = float(1.0).sub(solid).mul(float(1.0).sub(door));
  const effHalfX = mix(float(halfWinX), float(0.07), isGroundFloor);
  const effHalfY = mix(float(halfWinY), float(0.1), isGroundFloor);
  const winUV = clamp(
    vec2(
      cellUV.x.sub(effHalfX).div(max(0.01, float(1.0).sub(effHalfX.mul(2.0)))),
      cellUV.y.sub(effHalfY).div(max(0.01, float(1.0).sub(effHalfY.mul(2.0))))
    ),
    vec2(0.0),
    vec2(1.0)
  );
  const aptRoom = evaluateApartmentInterior(uCoord, vCoord, winUV, cellId, bayWidth, uFloorHeight, uSeed, uWarmth, uLitProbability.mul(0.62), fw);
  const shopLit = step(0.3, hash2D(cellId.add(vec2(uSeed, 19.4))));
  const bulbCol = mix(cCoolWindow, cWarmWindow, step(float(1.0).sub(uWarmth), hash2D(cellId.add(vec2(uSeed.mul(1.9), 83.1)))));
  // tinted glass: bronze, blue-green reflective, near-black
  const cGlass = mix(mix(color(0x3b2d22), color(0x24413f), step(0.36, glassStyle)), color(0x161b20), step(0.74, glassStyle));
  // floor-slab bands: white trim on most buildings, a darker shade of the paint on the rest
  const bandCol = mix(color(0xf0ece4), paint.mul(0.72), step(0.55, fract(tone.mul(5.3))));
  const hasBands = step(0.35, fract(tone.mul(3.1))).mul(float(1.0).sub(isBrick)); // (no slab bands on brick)

  // Shared masks
  const masks = () => {
    const inX = filteredPulse(cellUV.x, effHalfX, float(1.0).sub(effHalfX), fw.x).mul(open);
    const inY = filteredPulse(cellUV.y, effHalfY, float(1.0).sub(effHalfY), fw.y);
    const band = filteredPulse(cellUV.y, 0.0, 0.075, fw.y).mul(hasBands).mul(float(1.0).sub(isRoof)).mul(step(0.5, gridV));
    // aluminium frames: a mullion & a transom (sliders), the storefront's mullions on the ground floor
    const frames = clamp(max(
      max(lineAA(winUV.x.sub(0.5), 0.02), lineAA(winUV.y.sub(0.68), 0.02)).mul(float(1.0).sub(isGroundFloor)),
      max(lineAA(fract(winUV.x.mul(3.0)).sub(0.5), 0.03), lineAA(winUV.y.sub(0.78), 0.02)).mul(isGroundFloor)
    ), 0.0, 1.0);
    // burglary bars on the ground-floor windows of the residential walls
    const bars = lineAA(fract(winUV.x.mul(7.0)).sub(0.5), 0.07).mul(floor0).mul(float(1.0).sub(isGroundFloor)).mul(float(1.0).sub(isBrick));
    const opening = inX.mul(inY).mul(float(1.0).sub(isRoof)).mul(float(1.0).sub(band));
    return { opening, band, frames, bars };
  };

  mat.colorNode = Fn(() => {
    const { opening, band, frames, bars } = masks();
    const wp = positionWorld;
    // Paint: mottled, a little chalky; rain streaks under the sills; red laterite dust up the first metre
    const mottle = noise2D(vec2(uCoord.mul(0.6), vCoord.mul(0.6))).mul(0.08).add(0.96);
    const underSill = filteredPulse(cellUV.x, effHalfX.add(0.04), float(1.0).sub(effHalfX).sub(0.04), fw.x)
      .mul(step(cellUV.y, effHalfY)).mul(open).mul(float(1.0).sub(isGroundFloor))
      .mul(smoothstep(0.35, 0.75, noise2D(vec2(uCoord.mul(3.0), 2.7)))).mul(0.16);
    const dust = smoothstep(1.1, 0.0, vCoord).mul(noise2D(vec2(uCoord.mul(0.9), 1.3)).mul(0.5).add(0.5)).mul(0.5);
    let wall = paint.mul(mottle).mul(float(1.0).sub(underSill));
    // --- Toronto layer: running-bond brickwork (stylised 0.26 x 0.1 m courses, faded out once a course is under a
    // few pixels so it never shimmers), each brick a shade off the building's colour, in pale lime mortar; street grime
    // at the foot of the wall instead of Abuja's red laterite dust ---
    const rowC = vCoord.div(0.1);
    const row = floor(rowC);
    const colC = uCoord.div(0.26).add(mod(row, 2.0).mul(0.5));
    const brickFade = float(1.0).sub(smoothstep(0.3, 0.7, max(fwidth(rowC), fwidth(colC)))).mul(isBrick);
    const mortar = max(gridLine(colC.mul(0.26), 0.26, 0.012), gridLine(vCoord, 0.1, 0.012)).mul(brickFade).mul(float(1.0).sub(coping));
    const brickTone = hash2D(vec2(floor(colC), row).add(vec2(uSeed, 3.1))).sub(0.5).mul(0.18).mul(brickFade).add(1.0);
    wall = mix(wall, wall.mul(brickTone), isBrick);
    wall = mix(wall, paint.mul(0.5).add(color(0x9a958c).mul(0.5)), mortar.mul(0.65));
    wall = mix(wall, color(0x4a443d), dust.mul(0.6));
    // --- end Toronto layer ---
    wall = mix(wall, bandCol, band);
    wall = mix(wall, paint.mul(0.9), coping);
    // Roof slabs: weathered concrete & waterproofing
    const roofCol = mix(color(0x7d7a74), color(0x9b978f), noise2D(wp.xz.mul(0.3)));
    // Glass: the room behind tinted, reflective panes
    const viewDir = normalize(cameraPosition.sub(wp));
    const fresnel = pow(clamp(float(1.0).sub(abs(dot(viewDir, normalWorldGeometry))), 0.0, 1.0), 2.0);
    const shopInterior = bulbCol.mul(smoothstep(0.05, 0.92, winUV.y).mul(0.45).add(0.25)).mul(shopLit);
    const inside = mix(aptRoom.xyz.mul(0.55), shopInterior, isGroundFloor);
    const glass = mix(mix(inside, cGlass, 0.7), cityUniforms.uSkyHorizonColor, fresnel.mul(0.55).add(0.07));
    const frameCol = mix(color(0xb9bcbf), color(0x3a3530), step(0.5, fract(tone.mul(9.1)))); // silver or bronze aluminium
    let c = mix(wall, roofCol, isRoof);
    c = mix(c, glass, opening);
    c = mix(c, frameCol, opening.mul(frames));
    c = mix(c, color(0x2a2b2d), opening.mul(bars));
    // Entrance: a steel panel door
    const finalCol = c.toVar();
    If(door.greaterThan(0.5), () => {
      const inDoorway = filteredPulse(cellUV.x, 0.28, 0.72, fw.x).mul(filteredPulse(cellUV.y, 0.0, 0.72, fw.y));
      const doorRnd = fract(tone.mul(11.3));
      const doorPaint = mix(mix(color(0x2a2522), color(0x5a3a22), step(0.4, doorRnd)), color(0x6e6e6a), step(0.8, doorRnd));
      const panels = max(filteredPulse(cellUV.x, 0.495, 0.505, fw.x), filteredPulse(cellUV.y, 0.35, 0.37, fw.y));
      finalCol.assign(mix(c, doorPaint.mul(float(1.0).sub(panels.mul(0.45))), inDoorway));
    });
    return finalCol;
  })();

  mat.roughnessNode = Fn(() => {
    const { opening } = masks();
    return mix(float(0.86).add(noise2D(vec2(uCoord.mul(4.0), vCoord.mul(4.0))).mul(0.08)), float(0.12), opening);
  })();

  mat.normalNode = Fn(() => {
    const camDist = length(positionWorld.sub(cameraPosition));
    const fade = float(1.0).sub(smoothstep(14.0, 120.0, camDist)).mul(float(1.0).sub(isRoof))
      .mul(float(1.0).sub(smoothstep(0.03, 0.1, max(fw.x, fw.y))));
    const ramp = fw.mul(2.0);
    const inX = filteredPulse(cellUV.x, effHalfX, float(1.0).sub(effHalfX), ramp.x).mul(open);
    const inY = filteredPulse(cellUV.y, effHalfY, float(1.0).sub(effHalfY), ramp.y);
    const band = filteredPulse(cellUV.y, 0.0, 0.075, ramp.y).mul(hasBands);
    return bumpNormal(inX.mul(inY).mul(-0.07).add(band.mul(0.03)).mul(fade));
  })();

  mat.emissiveNode = Fn(() => {
    const { opening, frames, bars } = masks();
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(clamp(float(1.0).sub(abs(dot(viewDir, normalWorldGeometry))), 0.0, 1.0), 1.8);
    const shopEmit = bulbCol.mul(shopLit).mul(smoothstep(0.08, 0.92, winUV.y).mul(0.6).add(0.3)).mul(0.6);
    const glassOnly = opening.mul(float(1.0).sub(frames)).mul(float(1.0).sub(bars));
    return mix(aptRoom.xyz.mul(aptRoom.w).mul(0.7), shopEmit, isGroundFloor)
      .mul(float(1.0).sub(fresnel.mul(0.8)))
      .mul(glassOnly)
      .mul(cityUniforms.uInteriorGlow);
  })();

  _renderedCache.set(cacheKey, mat);
  return mat;
}

/**
 * Instanced unit boxes for the facade materials' `boxLocal` mode, one per { x, y, z, w, h, d, faces?, tone?, ry? }
 * (y = centre; ry: turn about +y, for blocks laid out along a non-grid street), with the per-instance `box` attribute
 * (size + a spread seed carrying the building's tone in its fraction) that lays each wall out in whole window bays,
 * and `faces`: the WALL_KINDS of the box's -x, +x, -z & +z walls (storefront fronts all round when omitted).
 */
function createFacadeBoxes(material, boxes) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const box = new THREE.InstancedBufferAttribute(new Float32Array(boxes.length * 4), 4);
  const faces = new THREE.InstancedBufferAttribute(new Float32Array(boxes.length * 4), 4);
  geometry.setAttribute('box', box);
  geometry.setAttribute('faces', faces);
  // Optional per-instance paint (createRenderedFacadeMaterial): linear rgb + glass style
  const paint = boxes.some((b) => b.paint) ? new THREE.InstancedBufferAttribute(new Float32Array(boxes.length * 4), 4) : null;
  if (paint) geometry.setAttribute('paint', paint);

  const mesh = new THREE.InstancedMesh(geometry, material, boxes.length);
  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  boxes.forEach((b, i) => {
    if (b.ry) mesh.setMatrixAt(i, matrix.compose(pos.set(b.x, b.y, b.z), quat.setFromAxisAngle(up, b.ry), scale.set(b.w, b.h, b.d)));
    else mesh.setMatrixAt(i, matrix.makeScale(b.w, b.h, b.d).setPosition(b.x, b.y, b.z));
    box.setXYZW(i, b.w, b.h, b.d, ((i * 29) % 1000) + 0.1 + 0.8 * (b.tone ?? 0.5));
    if (b.faces) faces.setXYZW(i, b.faces[0], b.faces[1], b.faces[2], b.faces[3]);
    if (paint && b.paint) paint.setXYZW(i, b.paint[0], b.paint[1], b.paint[2], b.paint[3]);
  });
  return mesh;
}

const _carPaintCache = new Map();

/**
 * GTA 6-Style Metallic Clearcoat Vehicle Paint TSL Material
 */
function createCarPaintMaterial(baseHex = 0xffc218) {
  if (_carPaintCache.has(baseHex)) return _carPaintCache.get(baseHex);
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.56,
    roughness: 0.11
  });

  const cBase = color(baseHex);

  mat.colorNode = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const sunDir = normalize(cityUniforms.uSkySunDir);
    const reflectDir = reflect(viewDir.negate(), normalWorld);
    const fresnel = pow(clamp(float(1.0).sub(abs(dot(viewDir, normalWorld))), 0.0, 1.0), 2.2);
    const envCol = mix(cityUniforms.uSkyHorizonColor, color(0xffffff), clamp(reflectDir.y.mul(0.55).add(0.5), 0.0, 1.0));
    const clearcoatSpec = pow(max(dot(reflectDir, sunDir), 0.0), 36.0).mul(0.55);
    return mix(cBase, envCol, fresnel.mul(0.48)).add(cityUniforms.uSunColor.mul(clearcoatSpec));
  })();

  _carPaintCache.set(baseHex, mat);
  return mat;
}

/**
 * Lush Organic Street & Park Tree Foliage TSL Material (ported from StreetTreeGenerator.js)
 * Features:
 * - Works with Crown-Sphere Blended Vertex Normals (`aCrownDist` attribute for radial interior canopy AO)
 * - Sky-Facing Lift (`normalWorldGeometry.y * 0.5 + 0.5`) & Per-Tree Species Hue Drift
 * - Hardware Derivative `bumpNormal` Leaf-Tuft Relief with Grazing-Angle Fade
 * - Gentle Per-Tree Phase-Shifted Breeze Flutter
 */
function createFoliageMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.82
  });

  mat.aoNode = canyonSkyAONode();

  // Gentle breeze flutter + subtle tuft silhouette displacement
  mat.positionNode = Fn(() => {
    const wp = positionWorld;
    const tuft = noise2D(wp.xz.mul(2.2).add(vec2(wp.y.mul(1.6), 0.0))).sub(0.5).mul(0.18);
    const phase = wp.x.mul(0.31).add(wp.z.mul(0.23));
    const breezeX = sin(time.mul(0.95).add(phase)).mul(0.055);
    const breezeZ = cos(time.mul(0.82).add(phase.mul(1.3))).mul(0.045);
    const flutter = sin(time.mul(2.8).add(wp.x.mul(1.8)).add(wp.y.mul(2.2))).mul(0.018);
    return positionLocal.add(normalLocal.mul(tuft.add(flutter))).add(vec3(breezeX, float(0.0), breezeZ));
  })();

  const cGreenDeep = color(0x2c4a1b);
  const cGreenSun = color(0x5d7e32);
  const cOlivePatch = color(0x75822e);
  const cAutumnGold = color(0x9a7b2c);

  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const crownDist = attribute('aCrownDist', 'float');

    // Radial interior canopy self-shadowing (from StreetTreeGenerator.js):
    // leaves darken toward the crown core where a real canopy swallows light, and brighten at the rim
    const radialAO = smoothstep(0.08, 1.02, crownDist).mul(0.48).add(0.52);

    // Multi-scale leaf tuft & sparkle field
    const patch = noise2D(wp.xz.mul(0.45).add(vec2(wp.y.mul(0.35), 0.0)));
    const tufts = noise2D(wp.xz.mul(2.4).add(vec2(wp.y.mul(2.1), 7.3)))
      .mul(0.65)
      .add(noise2D(wp.xy.mul(5.2)).mul(0.35));
    const sparkle = noise2D(wp.yz.mul(9.5));

    // Per-tree species variation (London Plane emerald, Honey Locust olive, early Autumn gold)
    const treeSpecies = noise2D(wp.xz.mul(0.06));
    const autumnTint = smoothstep(0.66, 0.88, treeSpecies).mul(0.55);

    // Sky-facing lift (from StreetTreeGenerator.js)
    const skyLift = clamp(normalWorldGeometry.y.mul(0.5).add(0.5), 0.0, 1.0);
    const leafBase = mix(cGreenDeep, cGreenSun, skyLift);
    const leafVaried = mix(leafBase, cOlivePatch, patch.mul(0.52));
    const leafTinted = mix(leafVaried, cAutumnGold, autumnTint);

    const leafLit = leafTinted
      .mul(tufts.mul(0.36).add(0.74))
      .mul(sparkle.mul(0.22).add(0.88));

    return leafLit.mul(radialAO);
  })();

  mat.roughnessNode = Fn(() => {
    const wp = positionWorld;
    const sparkle = noise2D(wp.yz.mul(9.5));
    return float(0.78).add(sparkle.mul(0.14));
  })();

  // Screen-space derivative bumpNormal on leaf tufts with grazing-angle fade (from StreetTreeGenerator.js)
  mat.normalNode = Fn(() => {
    const wp = positionWorld;
    const tufts = noise2D(wp.xz.mul(2.4).add(vec2(wp.y.mul(2.1), 7.3)))
      .mul(0.65)
      .add(noise2D(wp.xy.mul(5.2)).mul(0.35));
    const grazingFade = smoothstep(0.08, 0.35, abs(dot(normalView, positionViewDirection)));
    return bumpNormal(tufts.mul(0.065).mul(grazingFade));
  })();

  return mat;
}

/**
 * Tree Trunk & Flared Root Collar Bark TSL Material with Vertical Ridge `bumpNormal`
 * (Ported from StreetTreeGenerator.js)
 */
function createTreeBarkMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.88
  });

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const ridge = float(1.0).sub(abs(noise2D(vec2(wp.x.add(wp.z).mul(8.5), wp.y.mul(1.5))).sub(0.5).mul(2.0)));
    return mix(color(0x463627), color(0x6c5b44), smoothstep(0.45, 0.95, ridge).mul(0.72));
  })();

  mat.normalNode = Fn(() => {
    const wp = positionWorld;
    const ridge = float(1.0).sub(abs(noise2D(vec2(wp.x.add(wp.z).mul(8.5), wp.y.mul(1.5))).sub(0.5).mul(2.0)));
    const grazingFade = smoothstep(0.08, 0.35, abs(dot(normalView, positionViewDirection)));
    return bumpNormal(ridge.mul(0.018).mul(grazingFade));
  })();

  return mat;
}

// Sunlight shining through leaves (Barré-Brisebois & Bouchard's fast translucency approximation): looking against
// the light, a leaf glows with the light it lets through. It takes the direct light's colour, so shadows (the crown's
// own included) dim it like the sunlit side. Materials set `translucencyNode` (vec3, 0 where nothing shines through).
class FoliageLightingModel extends THREE.PhysicalLightingModel {
  direct(lightData, builder) {
    const { lightDirection, lightColor, reflectedLight } = lightData;
    const translucency = builder.material.translucencyNode;
    if (translucency) {
      const scatter = normalize(lightDirection.add(normalView.mul(0.3)));
      const through = pow(clamp(dot(positionViewDirection, scatter.negate()), 0.0, 1.0), 3.0);
      reflectedLight.directDiffuse.addAssign(lightColor.mul(translucency).mul(through));
    }
    super.direct(lightData, builder);
  }
}

class TreeNodeMaterial extends THREE.MeshStandardNodeMaterial {
  static get type() {
    return 'TreeNodeMaterial';
  }

  constructor(parameters) {
    super(parameters);
    this.translucencyNode = null;
  }

  setupLightingModel() {
    return new FoliageLightingModel();
  }
}

// Prevailing wind (xz): the south-westerly monsoon of Abuja's rainy season (April-October), blowing toward true
// north-east, i.e. 77.2° from grid north in the world frame
const TREE_WIND = vec2(0.975, -0.221);

/**
 * Instanced street & park tree material (js/trees.js): bark tubes and alpha-tested leaf cards in ONE draw per mesh.
 * Geometry attributes:
 * - uv: leaf-atlas coordinates on the cards; on the bark (metres round the stem, metres along it)
 * - normal: on the cards, crown-shell normals (out from the crown centre, blended with the card face), so a crown
 *   shades as one leafy volume and both sides of a card light alike (the back faces keep them unflipped)
 * - aTree (vec4): x = 1 on leaf cards / 0 on bark, y = crown occlusion (0 deep inside .. 1 on the outer shell),
 *   z = sway weight (0 on the trunk .. 1 at the twig tips & cards), w = per-card random (leaf flutter phase)
 * - aTreeData (instanced vec4): rgb = per-tree linear foliage tint, w = species index + per-tree random fraction
 *   (species 0 London plane: flaking camouflage bark, 1 honey locust & 2 elm: dark furrowed bark)
 * Leaf atlas texels: r = leaf brightness, g = per-leaf hue jitter, b = twig / stalk mask, a = coverage (its mipmaps
 * keep the coverage, so distant crowns stay full).
 * Shading: per-tree tint with sun-yellowed & cooler leaves, deep leaves darker and occluded from the sky, sunlight
 * shining through the leaves toward the camera (FoliageLightingModel), alpha-to-coverage leaf edges on the MSAA scene
 * pass (alpha-tested in the shadow maps: dappled shadows). Wind: gusts rolling across the city sway the crowns
 * (shadows follow), branches bob and leaves flutter.
 */
function createTreeMaterial(leafAtlas) {
  // The alpha test is given as nodes (alphaTestNode on the scene pass, maskShadowNode in the shadow maps) rather than
  // `alphaTest`: the shadow passes copy each caster's `alphaTest` onto one shared shadow material, and every switch
  // between 0 and > 0 bumps its version, which made three.js re-hash the node graphs of all the casters' shadow render
  // objects every frame (~10 ms of CPU). The trees were the only alpha-tested casters.
  const mat = new TreeNodeMaterial({
    side: THREE.DoubleSide,
    alphaToCoverage: true,
    metalness: 0.0,
    roughness: 0.8
  });

  const aTree = attribute('aTree', 'vec4');
  const aData = attribute('aTreeData', 'vec4');
  const isLeaf = aTree.x;
  const crownAO = aTree.y;
  const rnd = fract(aData.w);
  const species = floor(aData.w);
  const leaf = texture(leafAtlas, uv());

  // Wind. positionLocal is already instanced (world space); positionGeometry is the tree's own frame (metres)
  mat.positionNode = Fn(() => {
    const p = positionLocal;
    const g = positionGeometry;
    const phase = rnd.mul(6.2832);
    // gusts rolling downwind across the city
    const gust = sin(time.mul(0.5).sub(dot(p.xz, TREE_WIND).mul(0.045))).mul(0.5).add(0.5);
    const strength = gust.mul(gust).mul(0.7).add(0.3);
    // the whole tree bends with height, leaning downwind and rocking across it
    const h = g.y.div(11.0);
    const bend = h.mul(h);
    const lean = sin(time.mul(0.85).add(phase)).mul(0.45).add(0.55).mul(strength).mul(0.2);
    const rock = sin(time.mul(0.67).add(phase.mul(1.7))).mul(0.06).mul(strength);
    const sway = vec3(TREE_WIND.x.mul(lean).sub(TREE_WIND.y.mul(rock)), 0.0, TREE_WIND.y.mul(lean).add(TREE_WIND.x.mul(rock))).mul(bend);
    // branches bob, the phase flowing smoothly through the crown so joints stay together
    const bob = sin(time.mul(2.1).add(g.x.mul(0.9)).add(g.z.mul(0.7)).add(phase)).mul(0.05).mul(aTree.z).mul(strength);
    // leaves flutter, every card on its own
    const flutter = sin(time.mul(8.0).add(aTree.w.mul(37.0)).add(g.y.mul(2.0))).mul(0.03).mul(isLeaf).mul(aTree.z).mul(strength.add(0.25));
    return p.add(sway).add(vec3(0.0, bob, 0.0)).add(normalLocal.mul(flutter));
  })();

  // Coverage: leaf cards from the atlas; bark is opaque from outside (its back faces are dropped)
  const alpha = mix(float(frontFacing), leaf.a, isLeaf);
  mat.alphaTestNode = float(0.5);
  mat.maskShadowNode = alpha.greaterThan(0.5);

  mat.colorNode = Fn(() => {
    // Leaves: per-tree tint x atlas brightness, a share of sun-yellowed and of cooler leaves, brown twigs & stalks,
    // darker deep in the crown
    const tint = aData.xyz;
    const base = tint.mul(leaf.r.mul(1.4));
    const warm = smoothstep(0.62, 1.0, leaf.g).mul(0.55);
    const cool = smoothstep(0.38, 0.0, leaf.g).mul(0.45);
    const leafCol = mix(mix(base, base.mul(vec3(1.25, 1.08, 0.5)), warm), base.mul(vec3(0.8, 0.92, 1.05)), cool);
    const foliage = mix(leafCol, color(0x4a3b2c), leaf.b).mul(crownAO.mul(0.45).add(0.55));

    // Bark (uv in metres): furrowed grey-brown ridges, or the London plane's olive bark flaking to cream & tan
    const bu = uv();
    const n1 = noise2D(vec2(bu.x.mul(5.0), bu.y.mul(1.1)).add(rnd.mul(17.0)));
    const n2 = noise2D(bu.mul(vec2(3.2, 1.9)).add(rnd.mul(31.0)));
    const ridge = float(1.0).sub(abs(n1.sub(0.5).mul(2.0)));
    const furrowed = mix(color(0x2e261f), color(0x5c5043), smoothstep(0.35, 0.9, ridge));
    const planeBark = mix(mix(color(0x645e4b), color(0x948c73), smoothstep(0.56, 0.66, n2)), color(0x4a3f31), smoothstep(0.3, 0.22, n2));
    const bark = mix(furrowed, planeBark, step(species, 0.5)).mul(crownAO.mul(0.4).add(0.6));

    return vec4(mix(bark, foliage, isLeaf), alpha);
  })();

  mat.roughnessNode = mix(float(0.93), float(0.72).sub(leaf.r.mul(0.1)), isLeaf);

  // Card normals are crown-shell normals on both faces: no back-face flip
  mat.normalNode = normalViewGeometry;

  // Sky light: street-canyon occlusion, deep inside the crown far less
  mat.aoNode = canyonSkyAONode().mul(crownAO.mul(0.75).add(0.25));

  // Light through the leaves: yellow-green, strongest out on the thin shell
  mat.translucencyNode = aData.xyz.mul(vec3(1.0, 1.2, 0.45)).mul(leaf.r.mul(1.5)).mul(crownAO.mul(0.8).add(0.2)).mul(isLeaf);

  return mat;
}

// Post-rain puddle field (organic standing rainwater pools) shared by every road surface channel
function roadPuddleField(wx, wz) {
  const nMacro = noise2D(vec2(wx.mul(0.095), wz.mul(0.075)));
  const nMid = noise2D(vec2(wx.mul(0.25).add(19.4), wz.mul(0.22).add(11.8)));
  const nDetail = noise2D(vec2(wx.mul(0.68).sub(7.3), wz.mul(0.68).add(29.1)));
  const spawnPool = smoothstep(4.2, 1.4, length(vec2(wx.sub(1.6), wz.sub(122.8)))).mul(0.10);
  return nMacro.mul(0.52).add(nMid.mul(0.34)).add(nDetail.mul(0.14)).add(spawnPool);
}

/**
 * Wetness masks over a puddle field, driven by cityUniforms.uRoadWetness (0 = bone dry … 1 = right after a downpour):
 * x = damp stains (darker, satin), y = standing water (mirror-smooth; none on a dry day), z = wet film over everything.
 * Water collects in the field's highest (lowest-lying) spots first, so pools appear, grow & merge as wetness rises;
 * `drainage` raises the water line for better-drained surfaces such as the crowned sidewalk flags.
 */
function roadWetMasks(field, drainage = 0.0) {
  const w = cityUniforms.uRoadWetness;
  const level = mix(float(0.86), float(0.56), clamp(w.sub(0.1).div(0.55), 0.0, 1.0)).add(drainage);
  const damp = smoothstep(level.sub(0.09), level.sub(0.015), field);
  const puddle = smoothstep(level, level.add(0.022), field).mul(smoothstep(0.1, 0.22, w));
  const film = smoothstep(0.2, 0.8, w);
  return vec3(damp, puddle, film);
}

/**
 * Which way the roads run, for the cracks (surfaceWear 2): a texture over the detailed city, 8 m a texel, holding
 * (cos 2θ, sin 2θ) of the nearest street's bearing θ within its width (an orientation: the sign of the direction doesn't
 * matter), filtered linearly so it turns smoothly through the junctions. From the street centre lines (CITY.ROADS; not
 * the raised decks). Built once, ~1.2 M texels (2.4 MB).
 */
let _roadDirField = null;
function roadDirectionField() {
  if (_roadDirField) return _roadDirField;
  const B = window.CITY.CITY_BOUNDS, CELL = 8;
  const W = Math.ceil((B.maxX - B.minX) / CELL), H = Math.ceil((B.maxZ - B.minZ) / CELL);
  const data = new Uint8Array(W * H * 2).fill(128);
  const best = new Float32Array(W * H).fill(Infinity);
  for (const r of window.CITY.ROADS || []) {
    if (r.raised) continue;
    const reach = r.w / 2 + CELL;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
      if (L2 < 1e-4) continue;
      const th = Math.atan2(dz, dx), c2 = Math.round((Math.cos(2 * th) * 0.5 + 0.5) * 255), s2 = Math.round((Math.sin(2 * th) * 0.5 + 0.5) * 255);
      const ix0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - B.minX) / CELL)), ix1 = Math.min(W - 1, Math.floor((Math.max(a.x, b.x) + reach - B.minX) / CELL));
      const iz0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach - B.minZ) / CELL)), iz1 = Math.min(H - 1, Math.floor((Math.max(a.z, b.z) + reach - B.minZ) / CELL));
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = B.minZ + (iz + 0.5) * CELL;
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = B.minX + (ix + 0.5) * CELL;
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
          const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
          const o = iz * W + ix;
          if (d > reach || d >= best[o]) continue;
          best[o] = d;
          data[o * 2] = c2;
          data[o * 2 + 1] = s2;
        }
      }
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGFormat, THREE.UnsignedByteType);
  tex.flipY = false;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _roadDirField = { tex, x0: B.minX, z0: B.minZ, w: W * CELL, h: H * CELL };
  return _roadDirField;
}

/**
 * Wear & repairs of the asphalt at world xz, `px` metres a pixel (the patches & potholes ported from mrdoob/slop-newyork
 * dcb453f): x = how worn the stretch is (0 .. 1), y = signed distance to the edge of a rectangular utility-cut patch
 * (m, < 0 inside), z = pothole depth (0 .. 1 at the bottom of the bowl), w = 1 where the 11 m cell has a patch.
 */
const roadWear = Fn(([wxz, px]) => {
  // Worn stretches: about a fifth of the roadway, in patches a block or so across
  const worn = smoothstep(0.55, 0.82, noise2D(wxz.mul(0.045).add(71.0))).toVar();

  // Rectangular utility-cut patches (Toronto Hydro, Enbridge gas, Toronto Water & sewer trenches): a bit over one 11 m
  // cell in three, kept inside its cell. Some are squarish cuts, others long narrow trenches along the street or across it
  const pCell = floor(wxz.div(11.0));
  const hasPatch = step(0.62, hash2D(pCell.add(vec2(3.7, 8.1))));
  const trench = step(0.6, hash2D(pCell.add(vec2(2.9, 6.3))));
  const alongX = step(0.5, hash2D(pCell.add(vec2(5.5, 9.9))));
  const pCentre = pCell.add(0.5).add(vec2(hash2D(pCell.add(vec2(1.3, 5.9))), hash2D(pCell.add(vec2(9.2, 2.4)))).sub(0.5)
    .mul(mix(float(0.4), float(0.08), trench))).mul(11.0);
  const cutHalf = vec2(hash2D(pCell.add(vec2(4.4, 0.6))).mul(1.8).add(0.6), hash2D(pCell.add(vec2(7.8, 3.1))).mul(1.4).add(0.5));
  const trenchLong = hash2D(pCell.add(vec2(0.7, 4.8))).mul(2.0).add(2.4);
  const trenchNarrow = hash2D(pCell.add(vec2(6.6, 7.2))).mul(0.25).add(0.3);
  const trenchHalf = mix(vec2(trenchNarrow, trenchLong), vec2(trenchLong, trenchNarrow), alongX);
  const pHalf = mix(cutHalf, trenchHalf, trench);
  const pq = abs(wxz.sub(pCentre)).sub(pHalf);
  const patchDist = max(pq.x, pq.y);

  // Potholes, mostly in the worn stretches (spring after a Toronto winter): a ragged bowl a hand or two across
  const hCell = floor(wxz.div(7.0));
  const hCentre = hCell.add(vec2(hash2D(hCell.add(vec2(2.2, 7.7))), hash2D(hCell.add(vec2(6.1, 1.9)))).mul(0.6).add(0.2)).mul(7.0);
  const hRadius = hash2D(hCell.add(vec2(5.3, 4.2))).mul(0.24).add(0.12);
  const hDist = length(wxz.sub(hCentre)).mul(noise2D(wxz.mul(6.0)).sub(0.5).mul(0.5).add(1.0));
  const hasHole = step(float(0.975).sub(worn.mul(0.12)), hash2D(hCell.add(vec2(8.8, 0.3))));
  const pothole = smoothstep(hRadius.add(px), hRadius.mul(0.35), hDist).mul(hasHole);

  return vec4(worn, patchDist, pothole, hasPatch);
});

/**
 * Toronto's asphalt cracks at world xz, `px` metres a pixel, along the road's direction `dir` (a unit vector; see
 * roadDirectionField), in a stretch `worn` (0 .. 1) (surfaceWear 2): x = hairline cracks, y = sealed cracks. Not the
 * block & alligator network New York's port drew: in Ontario's cold the asphalt cracks ACROSS the road (thermal cracks,
 * every several metres in older pavement) and ALONG it, at the paving lanes' joints and in the wheel paths; the City
 * routes & seals the minor ones (TS 3.90: hot-poured rubberized asphalt, OPSS 1212), leaving a meandering black band a
 * few centimetres wide over some of them. Thin and broken into runs; the hairlines are only traced near the camera,
 * the sealant further out.
 */
const roadCracks = Fn(([wxz, px, dir, worn]) => {
  const hair = float(0.0).toVar();
  const seal = float(0.0).toVar();
  If(px.lessThan(0.14), () => {
    const a = dot(wxz, dir); // along the road
    const b = dot(wxz, vec2(dir.y.negate(), dir.x)); // across it
    // along: a crack in about three 3.4 m lane cells in five, at a wheel path or a lane joint, wandering a little, in
    // runs a dozen metres long (longer in the worn stretches)
    const ib = floor(b.div(3.4));
    const hb = hash2D(vec2(ib, 17.3));
    const bc = ib.add(hb.mul(0.7).add(0.15)).mul(3.4).add(noise2D(vec2(a.mul(0.18), ib.mul(3.1))).sub(0.5).mul(0.5))
      .add(noise2D(vec2(a.mul(2.3), ib)).sub(0.5).mul(0.04));
    const runL = smoothstep(float(0.5).sub(worn.mul(0.1)), float(0.58).sub(worn.mul(0.1)), noise2D(vec2(a.mul(0.07), ib.mul(7.3).add(2.0)))).mul(step(0.4, hb));
    const dL = abs(b.sub(bc));
    // across: a thermal crack in about two 9 m cells in five, partway or right across, wandering
    const ia = floor(a.div(9.0));
    const ha = hash2D(vec2(ia, 5.9));
    const ac = ia.add(ha.mul(0.6).add(0.2)).mul(9.0).add(noise2D(vec2(b.mul(0.35), ia.mul(1.7))).sub(0.5).mul(0.45));
    const runT = smoothstep(0.38, 0.46, noise2D(vec2(b.mul(0.16), ia.mul(3.1).add(9.0)))).mul(step(0.6, ha));
    const dT = abs(a.sub(ac));
    // some of them sealed: a 4-6 cm band of sealant over the crack (by run: whole cracks, not dashes)
    const sealL = step(0.62, hash2D(vec2(ib, floor(a.div(14.0)).add(41.0))));
    const sealT = step(0.55, hash2D(vec2(ia, 23.0)));
    const crackAt = (d, hw) => {
      const eff = max(hw, px.mul(0.5));
      return float(1.0).sub(smoothstep(eff, eff.add(px), d)).mul(hw.div(eff));
    };
    // a hairline: a 3-6 mm dark core in a 1.5 cm ravelled, dirty margin (what makes a real one read from a few metres)
    const hw = float(0.0015).add(worn.mul(0.0015));
    const hairAt = (d) => max(crackAt(d, hw), float(1.0).sub(smoothstep(hw, hw.add(0.015).add(px), d)).mul(0.3));
    const hairFade = smoothstep(0.05, 0.015, px);
    hair.assign(max(hairAt(dL).mul(runL).mul(float(1.0).sub(sealL)), hairAt(dT).mul(runT).mul(float(1.0).sub(sealT))).mul(worn.mul(0.4).add(0.6)).mul(hairFade));
    // the sealant's overband, 5-7 cm of black rubberized asphalt
    const sw = noise2D(wxz.mul(1.3).add(9.0)).mul(0.01).add(0.025);
    seal.assign(max(crackAt(dL, sw).mul(runL).mul(sealL), crackAt(dT, sw).mul(runT).mul(sealT)).mul(smoothstep(0.14, 0.07, px)));
  });
  return vec2(hair, seal);
});

/**
 * Unified City Roadway Asphalt, Footprint-Filtered Aggregate `bumpNormal`, Scattered Manholes, Wear & Repairs
 * (quality.js `surfaceWear`; ported from mrdoob/slop-newyork dcb453f: tar-sealed utility-cut patches & trenches and
 * potholes from 1; at 2 oil drips, exposed stone chips & a gentle swell of the paving, and Toronto's own thin cracks
 * along & across the road, some routed & sealed, in place of New York's block cracking & tar snakes; see roadWear &
 * roadCracks) & Post-Rain Wetness (upgraded with techniques from CityGenerator.js `createRoadMaterial`).
 * cityUniforms.uRoadWetness drives damp stains, a glossy wet film & standing puddles (roadWetMasks): bone dry at
 * midday, a few small pools at golden hour, slick & mirroring the lights at night. Water's Fresnel rides on metalness
 * (as for the rivers), so puddles reflect the street through SSR at grazing angles yet only darken seen from above.
 * Lane markings are separate geometry built from the road network (js/road-paint.js); the streetcar track bed is laid
 * over the asphalt as its own strip (js/streetcars.js).
 */
function createRoadSurfaceMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.24,
    roughness: 0.48
  });

  const wearLite = SURFACE_WEAR >= 1;
  const wearFull = SURFACE_WEAR >= 2;
  const zero = float(0.0);

  // Weathered, oxidised asphalt: a neutral, slightly warm mid grey (the binder bleached by the sun, the limestone & granite
  // aggregate showing), lighter than the near-black, bluish grey this used to be; fresh blacktop only in the new patches.
  // Checked against John's Dundas West & Roncesvalles photos (overcast: the roadway about 0.8 of the old concrete walk)
  const cAsphaltDark = color(0x474542);
  const cAsphaltLight = color(0x716f6b);
  const cManhole = color(0x4a433c);
  const cOldPatch = color(0x77756f);

  // World size of a pixel: fine texture settles to its mean before it can alias at grazing angles or from the air
  const pixelSize = length(fwidth(positionWorld.xz));
  // Utility-cut patches, potholes & the worn stretches, shared by every channel below (see roadWear)
  const wear = wearLite ? roadWear(positionWorld.xz, pixelSize) : null;
  const worn = wearLite ? wear.x : zero;
  const patchDist = wearLite ? wear.y : float(1.0);
  const pothole = wearLite ? wear.z : zero;
  const hasPatch = wearLite ? wear.w : zero;
  const patchCover = wearLite ? smoothstep(pixelSize, pixelSize.negate(), patchDist).mul(hasPatch) : zero;
  // The tar sealing the saw-cut edge of each patch, a few centimetres wide
  const sealWidth = max(float(0.022), pixelSize.mul(0.75));
  const patchSeal = wearLite ? float(1.0).sub(smoothstep(sealWidth, sealWidth.add(pixelSize), abs(patchDist))).mul(float(0.022).div(sealWidth)).mul(hasPatch) : zero;
  // Fresh patches are darker & tighter than the roadway, old ones paler & greyer
  const patchFresh = wearLite ? step(0.55, hash2D(floor(positionWorld.xz.div(11.0)).add(vec2(12.9, 6.6)))) : zero;
  // Exposed light stone chips in the worn surface, settling to their average where they shrink below a pixel
  const chips = wearFull ? mix(float(0.035), smoothstep(0.72, 0.8, noise2D(positionWorld.xz.mul(30.0))), smoothstep(0.03, 0.012, pixelSize)) : zero;
  // Cracks along & across the road and the sealant over some of them (none over the newer patches); the road's
  // direction from roadDirectionField
  const cracks = wearFull ? (() => {
    const F = roadDirectionField();
    const o = texture(F.tex, positionWorld.xz.sub(vec2(F.x0, F.z0)).div(vec2(F.w, F.h))).rg.mul(2.0).sub(1.0);
    const o2 = o.div(max(length(o), 0.001)); // (cos 2θ, sin 2θ)
    const dir = vec2(clamp(o2.x.add(1.0).mul(0.5), 0.0, 1.0).sqrt(), clamp(float(1.0).sub(o2.x).mul(0.5), 0.0, 1.0).sqrt().mul(mix(float(-1.0), float(1.0), step(0.0, o2.y))));
    return roadCracks(positionWorld.xz, pixelSize, dir, worn).mul(float(1.0).sub(patchCover));
  })() : null;
  const crack = wearFull ? cracks.x : zero;
  const tarSnake = wearFull ? cracks.y : zero;
  // Oil & coolant drips from parked & idling cars: ragged dark blots a hand or two across, one 2.5 m cell in four
  const oilDrip = wearFull ? (() => {
    const oilCell = floor(positionWorld.xz.div(2.5));
    const oilCentre = oilCell.add(vec2(hash2D(oilCell.add(vec2(4.1, 2.2))), hash2D(oilCell.add(vec2(8.3, 6.7)))).mul(0.6).add(0.2)).mul(2.5);
    const oilDist = length(positionWorld.xz.sub(oilCentre)).mul(noise2D(positionWorld.xz.mul(5.0)).sub(0.5).mul(0.8).add(1.0));
    const oilRadius = hash2D(oilCell.add(vec2(1.9, 9.4))).mul(0.25).add(0.1);
    return smoothstep(oilRadius.add(pixelSize), oilRadius.mul(0.3), oilDist).mul(step(0.75, hash2D(oilCell.add(vec2(7.7, 3.3)))))
      .mul(hash2D(oilCell.add(vec2(2.6, 5.1))).mul(0.6).add(0.4));
  })() : zero;

  // Circular cast-iron manhole covers scattered over the roadway (one 14 m cell in three)
  const mhCell = floor(positionWorld.xz.div(14.0));
  const mhCentre = mhCell.add(vec2(hash2D(mhCell.add(13.7)), hash2D(mhCell.add(29.1))).mul(0.6).add(0.2)).mul(14.0);
  const mhDist = length(positionWorld.xz.sub(mhCentre));
  const hasManhole = step(0.66, hash2D(mhCell));

  // Puddle field & wetness masks shared by every channel below (each node is generated once per fragment); potholes
  // hold water first
  const puddleField = wearLite ? roadPuddleField(positionWorld.x, positionWorld.z).add(pothole.mul(0.45)) : roadPuddleField(positionWorld.x, positionWorld.z);
  const wet = roadWetMasks(puddleField);
  const damp = wet.x;
  const puddle = wet.y;
  const film = wet.z;
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const waterFresnel = pow(float(1.0).sub(clamp(viewDir.y, 0.0, 1.0)), 5.0).mul(0.98).add(0.02);

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(240.0, 22.0, camDist);

    // Two-scale aggregate grit, patchwork pours & oily wear stains
    const microAggregate = mix(float(0.5), noise2D(vec2(wx.mul(16.0), wz.mul(16.0))), smoothstep(0.06, 0.02, pixelSize));
    const fineGrain = mix(float(0.5), noise2D(vec2(wx.mul(3.2), wz.mul(3.2))), smoothstep(0.4, 0.12, pixelSize));
    const patchNoise = noise2D(vec2(wx.mul(0.18), wz.mul(0.18)));
    const oilyStain = smoothstep(0.52, 0.84, noise2D(vec2(wx.mul(0.42), wz.mul(0.42)))).mul(detail);
    // (no 'tar seams' along the noise's contour lines: they drew big dark loops no Toronto street has)
    // Binder-rich (dark) & ravelled, aggregate-exposed (pale) mottling a stride or so across
    const mottle = wearFull
      ? smoothstep(0.3, 0.7, noise2D(vec2(wx.mul(0.9), wz.mul(0.9)).add(41.0)).mul(0.65).add(noise2D(vec2(wx.mul(2.3), wz.mul(2.3)).add(7.0)).mul(0.35))).mul(0.26).sub(0.13)
      : zero;

    const baseAsphalt = mix(
      cAsphaltDark,
      cAsphaltLight,
      fineGrain.mul(0.33).add(microAggregate.mul(0.22)).add(patchNoise.mul(0.24)).add(mottle)
    )
      .mul(float(1.0).sub(oilyStain.mul(0.32)));

    // Utility-cut patches with their tar-sealed edges, stone chips, tar snakes, oil drips, cracks & potholes
    let surface = baseAsphalt;
    if (wearLite) {
      const patchCol = mix(mix(baseAsphalt, cOldPatch, 0.45).mul(1.06), color(0x2e2d2c).mul(0.85), patchFresh);
      surface = mix(baseAsphalt, patchCol, patchCover)
        .mul(float(1.0).sub(patchSeal.mul(0.5)))
        .mul(float(1.0).sub(pothole.mul(0.4)));
    }
    if (wearFull) {
      surface = surface
        .add(chips.mul(0.08).mul(float(1.0).sub(patchCover.mul(patchFresh))))
        .mul(float(1.0).sub(tarSnake.mul(0.6)))
        .mul(float(1.0).sub(oilDrip.mul(0.45)))
        .mul(float(1.0).sub(crack.mul(0.3)));
    }

    const isManhole = float(1.0).sub(smoothstep(0.52, 0.60, mhDist)).mul(hasManhole).mul(detail);
    const mhRings = sin(mhDist.mul(36.0)).mul(0.15).add(0.85);

    // Water filling the pores darkens the surface: damp stains & pools most, the overall wet film a little
    const wetDarkening = mix(mix(float(1.0), float(0.72), damp), float(0.6), puddle).mul(mix(float(1.0), float(0.8), film));
    return mix(surface, cManhole.mul(mhRings), isManhole).mul(wetDarkening);
  })();

  mat.roughnessNode = Fn(() => {
    const microRough = mix(float(0.04), noise2D(positionWorld.xz.mul(12.0)).mul(0.08), smoothstep(0.08, 0.03, pixelSize));
    // Tar sealant is glossier, oil satin, fresh patches a little tighter, potholes & cracks rougher
    let dry = float(0.90).add(microRough);
    if (wearLite) dry = dry.sub(patchSeal.mul(0.3)).sub(patchCover.mul(patchFresh).mul(0.06)).add(pothole.mul(0.06));
    if (wearFull) dry = dry.sub(tarSnake.mul(0.38)).sub(oilDrip.mul(0.18));
    // (the wet film & damp-stain gloss are left as they were: wet surfaces are st-wt0.11's)
    const wetRough = mix(dry, float(0.38), max(film.mul(0.9), damp.mul(0.8)));
    return mix(wetRough, float(0.1), puddle);
  })();

  // Water's Fresnel (F0 = 0.02): weights SSR & trades diffuse for reflection in pools (fully) and the wet film (partly)
  mat.metalnessNode = clamp(waterFresnel.mul(1.6), 0.0, 0.85).mul(max(puddle, film.mul(0.6)));

  // Footprint-gated asphalt relief via bumpNormal (from CityGenerator.js): 6 mm ravelled coarse texture + 1.6 mm fine
  // aggregate grit; with wear, raised patches with their tar seals and pothole bowls, and at full wear a gentle swell &
  // sag of the paving, shallow ruts & ripples, 2.2 mm mid grit, stone chips, hairline cracks, tar-snake beads and the
  // manhole covers' rims & rings (dcb453f). Steps ramp over >= 2 px so no edge sparkles; the finest relief fades before
  // it shrinks to a pixel. Flattens to mirror-smooth 0.0 inside standing rainwater puddles so SSR reflections stay crisp!
  mat.normalNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const coarseFade = wearLite ? smoothstep(0.12, 0.035, pixelSize) : smoothstep(0.08, 0.025, pixelSize);
    const fineFade = smoothstep(0.02, 0.006, pixelSize).mul(float(1.0).sub(film.mul(0.6)));
    const ramp = max(float(0.012), pixelSize.mul(2.0));

    const coarseGrit = noise2D(vec2(wx.mul(8.5), wz.mul(8.5))).sub(0.5).mul(wearLite ? 0.006 : 0.0032).mul(coarseFade);
    const fineGrit = noise2D(vec2(wx.mul(36.0), wz.mul(36.0))).sub(0.5).mul(0.0016).mul(fineFade);
    let height = coarseGrit.add(fineGrit);
    if (wearLite) {
      const patchStep = smoothstep(ramp, ramp.negate(), patchDist).mul(hasPatch).mul(0.004);
      const sealBead = float(1.0).sub(smoothstep(0.0, max(float(0.03), ramp), abs(patchDist))).mul(hasPatch).mul(0.0015);
      height = height.add(patchStep).add(sealBead).sub(pothole.mul(0.03));
    }
    if (wearFull) {
      const midFade = smoothstep(0.035, 0.012, pixelSize);
      const swell = noise2D(vec2(wx.mul(0.55), wz.mul(0.55)).add(23.0)).sub(0.5).mul(0.02)
        .add(noise2D(vec2(wx.mul(1.9), wz.mul(1.9))).sub(0.5).mul(0.005));
      const ripples = noise2D(vec2(wx.mul(3.6), wz.mul(3.6)).add(61.0)).sub(0.5).mul(0.004).mul(smoothstep(0.3, 0.1, pixelSize));
      const midGrit = noise2D(vec2(wx.mul(19.0), wz.mul(19.0)).add(3.0)).sub(0.5).mul(0.0022).mul(midFade);
      const chipRelief = chips.mul(0.0015).mul(midFade);
      const snakeBead = tarSnake.mul(0.0018);
      const crackGroove = crack.mul(0.0015).mul(smoothstep(0.008, 0.003, pixelSize));
      const mhRim = float(1.0).sub(smoothstep(0.0, max(float(0.02), ramp), abs(mhDist.sub(0.58)))).mul(0.004);
      const mhPattern = sin(mhDist.mul(36.0)).mul(0.0008).mul(step(mhDist, 0.54)).mul(smoothstep(0.01, 0.004, pixelSize));
      const manhole = mhPattern.sub(mhRim).mul(hasManhole).mul(coarseFade);
      height = height.add(swell).add(ripples).add(midGrit).add(chipRelief).add(snakeBead).sub(crackGroove).add(manhole);
    }
    return bumpNormal(height.mul(float(1.0).sub(puddle)));
  })();

  mat.emissiveNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;

    const roadFresnel = pow(clamp(float(1.0).sub(abs(viewDir.y)), 0.0, 1.0), 2.3);

    const skyMirror = mix(cityUniforms.uSkyHorizonColor, cityUniforms.uSkyTopColor, 0.40).mul(0.10);

    const tsDist = clamp(float(1.0).sub(length(vec2(wx.add(212.0), wz.add(45.0))).div(145.0)), 0.0, 1.0);
    const neonPatch = noise2D(vec2(wx.mul(0.15), wz.mul(0.15)));
    const neonCol = mix(color(0xff2a85), color(0x2ad4ff), neonPatch).mul(0.32);
    const reflectCol = mix(skyMirror, neonCol, tsDist.mul(0.65));

    return reflectCol.mul(max(puddle, film.mul(0.35))).mul(roadFresnel).mul(cityUniforms.uInteriorGlow).mul(0.07);
  })();

  return mat;
}

/**
 * Road markings built from the road network (js/road-paint.js): vertex-coloured strips whose `paint` attribute
 * holds (metres along the strip, pattern period, duty cycle) and `side` the offset from the strip's centre line.
 * Strips thinner than ~1.5 px are widened on screen and faded to match (phone-wire AA) and dashes are box-filtered,
 * so distant markings fade out smoothly instead of breaking up and flickering. Worn, and dark & glossy in puddles.
 * `fadeEnd` (m): the paint fades out over the last fifth before it (road-paint.js culls its cells there; upstream
 * 997185d's 1,300 -> 1,650 m); the surfaces (a duty over 1) never fade. 0: no fade.
 */
function createRoadPaintMaterial(fadeEnd = 0) {
  const mat = new THREE.MeshStandardNodeMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    metalness: 0.0
  });
  mat.mrtNode = _transparentEffectMRT; // SSR keeps seeing the asphalt (and its puddles) underneath

  const paint = attribute('paint', 'vec3');
  const side = attribute('side', 'vec2');
  const sideOffset = vec3(side.x, 0.0, side.y);

  // How much to widen the strip so it is at least 1.5 px wide on screen (1 when it already is)
  const widen = Fn(() => {
    // (two matrix-vector products a point instead of a matrix product: mrdoob's 997185d)
    const toClip = (p) => cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1.0)));
    const edge = toClip(positionGeometry).toVar();
    const centre = toClip(positionGeometry.sub(sideOffset)).toVar();
    const halfWidthPx = length(edge.xy.div(edge.w).sub(centre.xy.div(centre.w)).mul(screenSize).mul(0.5));
    const inFront = step(0.05, min(edge.w, centre.w));
    return clamp(float(0.75).div(max(halfWidthPx, 0.001)), 1.0, 16.0).mul(inFront).max(1.0);
  })();
  mat.positionNode = positionGeometry.add(sideOffset.mul(widen.sub(1.0)));

  // Exact box filter of the dashes (on for `duty` of each period) over the pixel footprint. A duty over 1 marks a
  // surface instead of paint (cycling.js: a trail's asphalt): solid, unworn, with a little grain
  const t = paint.x.div(paint.y);
  const footprint = max(fwidth(t), 0.0001);
  const surface = step(1.5, paint.z);
  const duty = min(paint.z, 1.0);
  const onSoFar = (x) => floor(x).mul(duty).add(clamp(fract(x).sub(float(1.0).sub(duty).mul(0.5)), 0.0, duty));
  const dashes = onSoFar(t.add(footprint.mul(0.5))).sub(onSoFar(t.sub(footprint.mul(0.5)))).div(footprint);

  const xz = positionWorld.xz;
  const camDist = length(positionWorld.sub(cameraPosition));
  const detail = smoothstep(70.0, 15.0, camDist);
  // the wear's noise only where it shows (within 70 m: beyond, the mix below is 0.5 anyway; mrdoob's 997185d)
  const wear = Fn(() => {
    const w = float(0.5).toVar();
    If(detail.greaterThan(0.0), () => {
      w.assign(mix(float(0.5), noise2D(xz.mul(0.8)).mul(0.6).add(noise2D(xz.mul(2.3)).mul(0.4)), detail));
    });
    return w;
  })();
  const fade = fadeEnd > 0 ? smoothstep(float(fadeEnd), float(fadeEnd * 0.79), camDist) : float(1.0);
  mat.opacityNode = mix(dashes.mul(varying(float(1.0).div(widen))).mul(smoothstep(0.1, 0.6, wear).mul(0.4).add(0.55)).mul(fade), float(1.0), surface);

  // Same pools & film as the asphalt. The standing water is none at all on a dry day (uRoadWetness up to 0.1): its
  // noise field is skipped then (mrdoob's 997185d); the film doesn't depend on the field
  const puddle = Fn(() => {
    const p = float(0.0).toVar();
    If(cityUniforms.uRoadWetness.greaterThan(0.1), () => {
      p.assign(roadWetMasks(roadPuddleField(positionWorld.x, positionWorld.z)).y);
    });
    return p;
  })();
  const film = roadWetMasks(float(0.0)).z;
  const grain = mix(float(1.0), wear.mul(0.22).add(0.86), surface);
  mat.colorNode = vec3(mix(float(1.0), float(0.72), puddle).mul(mix(float(1.0), float(0.86), film)).mul(grain));
  mat.roughnessNode = mix(mix(float(0.62), float(0.42), film), float(0.2), puddle);
  mat.aoNode = canyonSkyAONode();

  return mat;
}

/**
 * Flattened chewing gum on the sidewalk at world xz, `px` metres a pixel, `density` the share of 0.32 m cells with a
 * blob (ported from mrdoob/slop-newyork 4a921f0): x = coverage, y = age (0 a dark fresh blob .. 1 a grey ghost). Only
 * traced near the camera, where a blob is still bigger than a pixel.
 */
const sidewalkGum = Fn(([wxz, px, density]) => {
  const cover = float(0.0).toVar();
  const age = float(0.0).toVar();
  If(px.lessThan(0.04).and(density.greaterThan(0.001)), () => {
    const gumCell = 0.32;
    const gumCoord = wxz.div(gumCell);
    const gumId = floor(gumCoord);
    const gumCentre = vec2(hash2D(gumId.add(vec2(11.3, 2.9))), hash2D(gumId.add(vec2(23.9, 17.4)))).mul(0.6).add(0.2);
    const gumRadius = hash2D(gumId.add(vec2(4.1, 31.7))).mul(0.011).add(0.006);
    const gumWobble = noise2D(gumCoord.mul(9.0)).sub(0.5).mul(0.35).add(1.0);
    const gumDist = length(fract(gumCoord).sub(gumCentre)).mul(gumCell).mul(gumWobble);
    const gumAA = max(px, 0.001);
    cover.assign(smoothstep(gumRadius.add(gumAA), gumRadius.sub(gumAA.mul(0.5)), gumDist)
      .mul(step(float(1.0).sub(density), hash2D(gumId.add(vec2(7.7, 3.3)))))
      .mul(smoothstep(0.04, 0.015, px)));
    age.assign(hash2D(gumId.add(vec2(19.1, 0.7))));
  });
  return vec2(cover, age);
});

/**
 * The section hash of js/sidewalk-sections.js (sectionHash) in TSL, integer for integer, so the shader's repairs, years &
 * stamps are where the CPU rule says: a, b float nodes holding integers, `salt` a JS integer (the CPU's table index)
 */
const _sectionHashNode = Fn(([a, b, salt]) => {
  const { uint, int } = window.CITY.TSL;
  const h = uint(int(a)).mul(uint(0x8da6b343)).bitXor(uint(int(b)).mul(uint(0xd8163841))).bitXor(salt).toVar();
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  h.assign(h.mul(uint(0x7feb352d)));
  h.assign(h.bitXor(h.shiftRight(uint(15))));
  h.assign(h.mul(uint(0x846ca68b)));
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  return float(h.shiftRight(uint(8))).div(16777216.0);
});
const sectionHashNode = (a, b, c) => _sectionHashNode(a, b, window.CITY.TSL.uint(Math.imul(c, 0xcb1ab31f) >>> 0));

/**
 * The contractors' stamps, one atlas cell a year from 1950 to 2025 (8 x 10 cells, 192 x 112 px for 225 x 130 mm: about
 * 1.2 mm a texel), drawn once on a canvas: white where the stamp is pressed in. The City's drawing T-310.010-7: a
 * rounded rectangle outlined by a 3 mm groove, the contractor's name arcing across the top in 25 mm Gothic letters, the
 * year in 40 mm digits in the middle and a word along the bottom; the older stamps here are ovals. The contractors'
 * names are clearly fictional (Slop Toronto's own; John's choice): no real company's name is reproduced.
 */
let _stampAtlas = null;
const STAMP_NAMES = [['SLOP CONCRETE', 'LIMITED'], ['SLOP PAVING', 'COMPANY'], ['SLOP & SONS', 'CONTRACTORS'], ['SLOP CEMENT WORKS', 'LIMITED'], ['SLOPWAY CURB', 'COMPANY']];
function sidewalkStampAtlas() {
  if (_stampAtlas) return _stampAtlas;
  const S = window.CITY.SIDEWALK.stamp;
  const CW = 192, CH = 112, COLS = 8, ROWS = 10;
  const cv = document.createElement('canvas');
  cv.width = CW * COLS;
  cv.height = CH * ROWS;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = g.strokeStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const font = (px) => `bold ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  for (let year = S.firstYear; year <= S.lastYear; year++) {
    const i = year - S.firstYear, x0 = (i % COLS) * CW, y0 = Math.floor(i / COLS) * CH;
    const cx = x0 + CW / 2, cy = y0 + CH / 2;
    const oval = year < S.ovalBefore;
    const [name, word] = STAMP_NAMES[(year * 7 + 3) % STAMP_NAMES.length];
    g.save();
    g.lineWidth = 3;
    g.beginPath();
    if (oval) g.ellipse(cx, cy, CW / 2 - 4, CH / 2 - 4, 0, 0, Math.PI * 2);
    else g.roundRect(x0 + 4, y0 + 4, CW - 8, CH - 8, 16);
    g.stroke();
    g.clip();
    // the year, large in the middle (40 mm: 34 px)
    g.font = font(34);
    g.fillText(String(year), cx, cy + (word ? 4 : 10));
    // the name arcing across the top (25 mm letters: 21 px, a little smaller for the long names)
    const px = name.length > 12 ? 15 : 18;
    g.font = font(px);
    const R = oval ? 150 : 190, arc = Math.min(1.0, (name.length * px * 0.66) / R);
    for (let c = 0; c < name.length; c++) {
      const a = -arc / 2 + (arc * (c + 0.5)) / name.length;
      g.save();
      g.translate(cx + Math.sin(a) * R, y0 + 22 + R - Math.cos(a) * R);
      g.rotate(a);
      g.fillText(name[c], 0, 0);
      g.restore();
    }
    // the word along the bottom
    if (word) {
      g.font = font(13);
      g.fillText(word, cx, y0 + CH - 18);
    }
    g.restore();
  }
  const img = g.getImageData(0, 0, cv.width, cv.height).data;
  const data = new Uint8Array(cv.width * cv.height);
  for (let p = 0; p < data.length; p++) data[p] = img[p * 4];
  const tex = new THREE.DataTexture(data, cv.width, cv.height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.flipY = false; // (row 0 is the canvas' top)
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  _stampAtlas = { tex, cols: COLS, rows: ROWS, texel: S.across / CW };
  return _stampAtlas;
}

/**
 * Toronto's poured-in-place concrete sidewalks (js/sidewalk-sections.js: the rule & its sources; City of Toronto
 * TS 3.70 and drawings T-310.010-1, -6 & -7). Each walk is one ribbon of concrete along its curb, scored ACROSS the walk
 * every 1.5 m (a 12 mm expansion joint every 6 m; one lengthwise joint 1.5 m from the curb only on slabs 3 m or wider),
 * so it reads as stripes, not New York's grid of flags. city-grid.js gives every triangle the frame of the run of curb it
 * lies along (`walkFrame`: direction, curb line, seed; `walkSpan`: where the walk runs across), so the joints follow
 * the walk on every street. A repair replaces whole sections, curb side to property side: a run of one to three newer,
 * paler strips across the walk. The concrete's shade follows its year: the original pour (one year along a side of a
 * block: 1952-1991 among the houses, 1976-2013 downtown) darker & dirtier, the repairs (1998-2025) paler. Post-Rain Damp
 * Patches follow cityUniforms.uRoadWetness like the roadway's. Wear by quality.js `surfaceWear`:
 * - 1: the transverse & expansion joints, the full-width repairs, the smooth tooled margins along the walk's formed edges
 *   (and either side of the joints on sections older than 2000, which were tooled; newer ones are saw-cut), sections
 *   heaved a little out of true by frost & roots, weathering stains;
 * - 2: also the contractors' date stamps (one at each end of the work and every tenth bay, 50 mm from a joint, centred
 *   across the walk; legible up close, gone by a centimetre a pixel), the light broom finish across the walk, hairline
 *   cracks, salt scaling, flattened chewing gum (mostly downtown), trowel mottling, fine aggregate & pores;
 * - 0: plain concrete with its transverse joints.
 */
function createSidewalkMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.88
  });
  const { round } = window.CITY.TSL;
  const SW = window.CITY.SIDEWALK;
  const BAY = SW.bay;

  const wearLite = SURFACE_WEAR >= 1;
  const wearFull = SURFACE_WEAR >= 2;
  const zero = float(0.0);

  // Weathered broom-finished concrete, warm grey with age (John's Queen East & Roncesvalles photos); new repairs much paler
  const cOldA = color(0x9d9b95);
  const cOldB = color(0x86847e);
  const cFresh = color(0xc6c5bf);
  const cExpansion = color(0x2b2824); // the bituminous fibre of the expansion joints
  const cGumOld = color(0x77756f);
  const cGumNew = color(0x34332f);

  // Damp patches & pools on the walk, shared by every channel below (own field; drains better than the roadway)
  const swField = noise2D(vec2(positionWorld.x.mul(0.14).add(7.4), positionWorld.z.mul(0.14).sub(13.1))).mul(0.65)
    .add(noise2D(vec2(positionWorld.x.mul(0.38), positionWorld.z.mul(0.38))).mul(0.35));
  const swWet = roadWetMasks(swField, 0.06);
  const topFace = smoothstep(0.5, 0.9, normalWorldGeometry.y); // (the slab's 4 cm sides keep plain concrete)
  const swPuddle = swWet.y.mul(topFace);
  const swFresnel = pow(float(1.0).sub(clamp(normalize(cameraPosition.sub(positionWorld)).y, 0.0, 1.0)), 5.0).mul(0.98).add(0.02);
  const pixelSize = length(fwidth(positionWorld.xz));
  const wxz = positionWorld.xz;

  // The walk's frame (js/sidewalk-sections.js): s along the run of curb, t in from its curb line, the walk from t0 to t1
  const frame = attribute('walkFrame', 'vec4');
  const span = attribute('walkSpan', 'vec2');
  // per run, in the vertex stage: the joints' phase, the original pour's year, which bay of ten is stamped, seed*2+downtown
  const run = varying(Fn(() => {
    const w = round(frame.w);
    const seed = floor(w.mul(0.5));
    const down = w.sub(seed.mul(2.0));
    const [[yr, spr], [yd, spd]] = SW.originalYears;
    const yOrig = mix(float(yr), float(yd), down).add(floor(sectionHashNode(seed, 0.0, 5).mul(mix(float(spr), float(spd), down))));
    return vec4(sectionHashNode(seed, 0.0, 10).mul(BAY), yOrig, floor(sectionHashNode(seed, 0.0, 6).mul(SW.stampEvery)), w);
  })(), 'vWalkRun');
  const wr = round(run.w);
  const seed = floor(wr.mul(0.5));
  const downtown = wr.sub(seed.mul(2.0));
  const u = frame.xy;
  const sAlong = dot(wxz, u);
  const tIn = dot(wxz, vec2(u.y.negate(), u.x)).sub(frame.z);
  const t0 = span.x, t1 = span.y, width = t1.sub(t0);
  const sp = sAlong.sub(run.x).div(BAY);
  const k = floor(sp);
  const inBay = fract(sp).mul(BAY); // 0 .. BAY from the section's start joint
  const toJoint = min(inBay, float(BAY).sub(inBay));
  const toEdge = max(min(tIn.sub(t0), t1.sub(tIn)), 0.0);
  // the joint at hand: every 4th (6 m) an expansion joint
  const jn = floor(sp.add(0.5));
  const expansion = step(jn.sub(floor(jn.div(SW.expansionEvery)).mul(SW.expansionEvery)), 0.5);
  // a slab 3 m or wider: one lengthwise joint 1.5 m from the curb
  const toLong = abs(tIn.sub(t0).sub(SW.longitudinalAt)).add(step(width, SW.longitudinalMin).mul(100.0));
  const aa = max(pixelSize, 0.0005);
  const line = (d, hw) => {
    const eff = max(float(hw), aa.mul(0.5));
    return float(1.0).sub(smoothstep(eff, eff.add(aa), d)).mul(float(hw).div(eff));
  };

  // The section (sidewalkSection in js/sidewalk-sections.js, hash for hash): a repair is a run of 1-3 whole sections in a
  // group of 4; its year; the original pour's year is the run's
  let repair = zero, year = run.y, fresh = zero, tooled = float(1.0), sectionTone = zero;
  let g = null, j = null, start = null;
  if (wearLite) {
    g = floor(k.div(SW.repairGroup));
    j = k.sub(g.mul(SW.repairGroup));
    start = floor(sectionHashNode(g, seed, 2).mul(SW.repairGroup));
    const len = floor(sectionHashNode(g, seed, 3).mul(3.0)).add(1.0);
    const chance = mix(float(SW.repairChance[0]), float(SW.repairChance[1]), downtown);
    repair = float(1.0).sub(step(chance, sectionHashNode(g, seed, 1))).mul(step(start, j)).mul(float(1.0).sub(step(start.add(len), j)));
    year = mix(run.y, floor(sectionHashNode(g, seed, 4).mul(SW.repairYears[1])).add(SW.repairYears[0]), repair);
    // how new: 0 up to 1985, 1 for this year's pour
    fresh = clamp(year.sub(1985.0).div(40.0), 0.0, 1.0);
    tooled = float(1.0).sub(step(SW.sawCutFrom, year));
    sectionTone = sectionHashNode(k, seed, 12).sub(0.5);
  }

  // Joints: 5 mm saw cuts (tooled & rounded on the older sections, with their smooth margins), the expansion joints'
  // 12 mm of dark fibre, the lengthwise joint; the walk's formed edges get the smooth tooled band (TS 3.70: up to 50 mm)
  const jointHalf = wearLite ? mix(float(0.0025), float(0.004), tooled) : float(0.005);
  const joint = max(line(toJoint, jointHalf).mul(float(1.0).sub(expansion)), line(toLong, 0.003));
  const expJoint = line(toJoint, 0.006).mul(expansion);
  const margin = wearLite
    ? max(float(1.0).sub(smoothstep(SW.margin - 0.008, SW.margin, toEdge)), float(1.0).sub(smoothstep(0.035, 0.045, toJoint)).mul(tooled)).mul(topFace)
    : zero;

  // Sections heaved a little out of true by frost & tree roots (one end up, older sections only), hairline cracks
  let heave = zero, crack = zero;
  if (wearLite) {
    const lift = step(0.62, sectionHashNode(k, seed, 13)).mul(sectionHashNode(k, seed, 14).sub(0.5)).mul(0.016).mul(float(1.0).sub(fresh));
    heave = inBay.sub(BAY / 2).mul(lift).mul(smoothstep(0.0, max(float(0.05), pixelSize.mul(3.0)), toJoint));
  }
  if (wearFull) {
    // a settlement crack across about one older section in six, a little askew & wandering
    const at = sectionHashNode(k, seed, 15).mul(BAY - 0.5).add(0.25);
    const skew = sectionHashNode(k, seed, 16).sub(0.5).mul(0.7);
    const wander = noise2D(wxz.mul(7.0)).sub(0.5).mul(0.02).add(noise2D(wxz.mul(1.7).add(3.7)).sub(0.5).mul(0.06));
    const has = step(0.83, sectionHashNode(k, seed, 17)).mul(float(1.0).sub(fresh));
    crack = line(abs(inBay.sub(at).sub(tIn.sub(t0).mul(skew)).add(wander)), 0.0008).mul(has).mul(smoothstep(0.01, 0.03, min(toJoint, toEdge))).mul(topFace);
  }

  // The contractor's stamp: on the section the rule stamps, 50 mm from its joint, centred across the walk; legible up
  // close, faded out by a centimetre a pixel (its letters are 25-40 mm)
  let stamp = zero;
  if (wearFull) {
    const atlas = sidewalkStampAtlas();
    const st = SW.stamp;
    const pressed = Fn(() => {
      const s = float(0.0).toVar();
      If(pixelSize.lessThan(0.014).and(width.greaterThanEqual(st.minWidth)), () => {
        const k10 = k.sub(run.z);
        const tenth = step(abs(k10.sub(floor(k10.div(SW.stampEvery)).mul(SW.stampEvery))), 0.5);
        const first = step(abs(j.sub(start)), 0.5).mul(float(1.0).sub(step(0.85, sectionHashNode(g, seed, 7))));
        const has = mix(tenth, first, repair);
        const atEnd = step(0.5, sectionHashNode(k, seed, 8)).mul(float(1.0).sub(repair));
        const drift = sectionHashNode(k, seed, 9).sub(0.5).mul(max(width.sub(st.across + 0.1), 0.0)).mul(0.8).mul(float(1.0).sub(step(1975.0, year)));
        const inset = st.fromJoint + st.along / 2;
        // the stamp's frame: its top towards its joint (it reads from the section, the joint beyond it), its text along
        // the joint; q runs -0.5 .. 0.5 over it (x to the reader's right, y up the stamp)
        const up = mix(float(inset).sub(inBay), inBay.sub(BAY - inset), atEnd);
        const across = tIn.sub(t0.add(t1).mul(0.5).add(drift)).mul(mix(float(-1.0), float(1.0), atEnd));
        const q = vec2(across.div(st.across), up.div(st.along));
        If(has.greaterThan(0.5).and(abs(q.x).lessThan(0.5)).and(abs(q.y).lessThan(0.5)), () => {
          const cell = clamp(year.sub(st.firstYear), 0.0, st.lastYear - st.firstYear);
          const col = cell.sub(floor(cell.div(atlas.cols)).mul(atlas.cols));
          const row = floor(cell.div(atlas.cols));
          const uvA = vec2(col.add(q.x.add(0.5)).div(atlas.cols), row.add(float(0.5).sub(q.y)).div(atlas.rows));
          const lod = log2(max(pixelSize.mul(0.7).div(atlas.texel), 1.0));
          s.assign(texture(atlas.tex, uvA).level(lod).r);
        });
      });
      return s;
    })();
    // older stamps are worn down to faint relief
    stamp = pressed.mul(mix(float(0.45), float(1.0), fresh)).mul(smoothstep(0.014, 0.006, pixelSize)).mul(topFace);
  }

  let scaling = zero, gum = zero, gumAge = zero, brush = zero;
  if (wearFull) {
    // The light broom finish: fine striations across the walk (parallel to the joints), none on the smooth margins
    brush = noise2D(vec2(sAlong.mul(110.0), tIn.mul(2.2))).sub(0.5).mul(float(1.0).sub(margin)).mul(smoothstep(0.012, 0.004, pixelSize));
    // Salt scaling: de-icing salt & freeze-thaw flake the paste off about one older section in five, in patches, down
    // to the coarse aggregate
    const scaled = step(0.8, sectionHashNode(k, seed, 18)).mul(float(1.0).sub(fresh));
    const scaleField = noise2D(wxz.mul(1.4).add(seed.mul(0.013))).mul(0.7).add(noise2D(wxz.mul(4.3)).mul(0.3));
    scaling = smoothstep(0.5, 0.58, scaleField).mul(scaled).mul(smoothstep(0.02, 0.08, min(toJoint, toEdge))).mul(topFace);
    // Flattened chewing gum: thickest on busy stretches downtown (Spadina to Parliament, the lake to Bloor), a little
    // elsewhere, hardly any on the new repairs
    const outside = max(max(float(-1150.0).sub(positionWorld.x), positionWorld.x.sub(1500.0)), max(float(-2750.0).sub(positionWorld.z), positionWorld.z.sub(650.0)));
    const density = smoothstep(0.3, 0.8, noise2D(wxz.mul(0.07).add(5.3))).mul(0.2).add(0.05)
      .mul(mix(float(0.2), float(1.0), smoothstep(400.0, 0.0, outside)))
      .mul(float(1.0).sub(fresh.mul(0.8))).mul(topFace);
    const gm = sidewalkGum(wxz, pixelSize, density);
    gum = gm.x;
    gumAge = gm.y;
  }

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(190.0, 16.0, camDist);

    const tone = noise2D(vec2(wx.mul(0.48), wz.mul(0.48)));
    const grit = noise2D(vec2(wx.mul(14.0), wz.mul(14.0))).sub(0.5).mul(0.07).mul(detail).mul(smoothstep(0.07, 0.02, pixelSize));
    let concrete = mix(cOldB, cOldA, tone).add(grit);

    if (wearLite) {
      // Each pour's shade by its age (the repairs paler, stripes across the walk), weathering stains & the grime that
      // collects along the curb side of the older walks, and the smooth margins a touch lighter
      const stainField = noise2D(vec2(wx.mul(0.8), wz.mul(0.8)).add(17.0)).mul(0.65).add(noise2D(vec2(wx.mul(2.6), wz.mul(2.6))).mul(0.35));
      const old = float(1.0).sub(fresh);
      const stain = smoothstep(0.52, 0.86, stainField).mul(mix(float(0.05), float(0.2), old));
      const curbGrime = smoothstep(0.6, 0.0, tIn.sub(t0)).mul(0.08).mul(old);
      concrete = mix(concrete, cFresh.mul(sectionTone.mul(0.05).add(1.0)), fresh.mul(fresh).mul(0.9).add(fresh.mul(0.1)))
        .mul(sectionTone.mul(0.05).add(1.0))
        .mul(float(1.0).sub(stain).sub(curbGrime))
        .mul(margin.mul(0.05).add(1.0));
    }
    if (wearFull) {
      // Cloudy trowel & curing mottling a hand or two across, the broom's streaks, fine exposed aggregate, salt-scaled
      // patches, the stamp's impression (dirt in the old ones), gum
      const mottle = noise2D(vec2(wx.mul(3.1), wz.mul(3.1)).add(41.0)).mul(0.6).add(noise2D(vec2(wx.mul(7.3), wz.mul(7.3))).mul(0.4))
        .sub(0.5).mul(0.08).mul(smoothstep(0.15, 0.05, pixelSize));
      const aggregate = noise2D(vec2(wx.mul(55.0), wz.mul(55.0))).sub(0.5).mul(smoothstep(0.02, 0.006, pixelSize));
      concrete = concrete.mul(mottle.add(1.0)).mul(brush.mul(0.06).add(1.0)).add(aggregate.mul(mix(float(0.05), float(0.16), scaling)))
        .mul(float(1.0).sub(scaling.mul(0.12)))
        .mul(float(1.0).sub(stamp.mul(mix(float(0.22), float(0.1), fresh))))
        .mul(float(1.0).sub(crack.mul(0.45)));
      concrete = mix(concrete, mix(cGumNew, cGumOld, gumAge), gum.mul(mix(float(0.9), float(0.45), gumAge)));
    }

    const jointShade = wearLite ? mix(float(0.42), float(0.55), tooled) : float(0.45);
    const withJoints = mix(concrete.mul(float(1.0).sub(joint.mul(jointShade).mul(detail))), cExpansion, expJoint.mul(detail).mul(topFace));

    // Post-rain damp patches, pools & the overall wet film darken the walk
    return withJoints
      .mul(mix(float(1.0), float(0.72), max(swWet.x, swPuddle)))
      .mul(mix(float(1.0), float(0.8), swWet.z));
  })();

  mat.roughnessNode = Fn(() => {
    let dry = float(0.9);
    if (wearLite) dry = dry.sub(margin.mul(0.1)).sub(fresh.mul(0.03)).sub(expJoint.mul(0.25));
    if (wearFull) dry = dry.sub(gum.mul(0.25)).add(scaling.mul(0.05));
    const wetRough = mix(dry, float(0.55), max(swWet.z, swWet.x.mul(0.7)));
    return mix(wetRough, float(0.2), swPuddle);
  })();

  // Water's Fresnel (F0 = 0.02) on pools & the wet film, as for the roadway
  mat.metalnessNode = clamp(swFresnel.mul(1.6), 0.0, 0.85).mul(max(swPuddle, swWet.z.mul(0.3)));

  // Joint grooves (rounded on the tooled ones), the rounded formed edges, concrete grain and, with wear, the heaved
  // sections; at full wear the broom finish, hairline cracks, the stamp pressed in, salt-scaled hollows, gum & pores via
  // bumpNormal. Edges ramp over >= 2 px so nothing sparkles along the joints.
  mat.normalNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(140.0, 14.0, camDist);

    const grain = noise2D(vec2(wx.mul(4.5), wz.mul(4.5))).sub(0.5).mul(0.003);
    let height;
    if (wearLite) {
      const rampPx = max(float(0.012), pixelSize.mul(2.0));
      const grooveW = mix(float(0.0025), float(0.006), tooled);
      const groove = float(1.0).sub(smoothstep(grooveW, grooveW.add(rampPx), min(toJoint, toLong))).mul(0.006).mul(smoothstep(0.02, 0.006, pixelSize));
      const edgeRound = float(1.0).sub(smoothstep(0.0, max(float(0.008), rampPx), toEdge)).mul(0.003);
      height = grain.add(heave).sub(groove).sub(edgeRound);
      if (wearFull) {
        const pores = noise2D(vec2(wx.mul(38.0), wz.mul(38.0))).sub(0.5).mul(mix(float(0.0008), float(0.0025), scaling))
          .mul(smoothstep(0.012, 0.004, pixelSize));
        height = height.add(pores).add(brush.mul(0.0007)).sub(crack.mul(0.0015)).sub(stamp.mul(0.004))
          .sub(scaling.mul(0.0015)).add(gum.mul(0.0008));
      }
    } else {
      height = grain.sub(joint.mul(0.008));
    }
    return bumpNormal(height.mul(detail).mul(float(1.0).sub(swPuddle)));
  })();

  return mat;
}

/**
 * Dressed Kerbstone TSL Material (ported from SidewalkGenerator.js `createCurbMaterial`)
 * Dense cool grey flamed granite with 1.5m segment joints, grimier road-facing vertical face,
 * and `bumpNormal` granite grain.
 */
function createCurbMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.06,
    roughness: 0.72
  });

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(180.0, 16.0, camDist);

    const tone = noise2D(vec2(wx.mul(0.6), wz.mul(0.6)));
    const speckle = noise2D(vec2(wx.mul(18.0), wz.mul(18.0))).sub(0.5).mul(0.06).mul(detail);
    const stone = mix(color(0x4c4c45), color(0x63635a), tone).add(speckle);

    const joints = max(gridLine(wx, 1.5, 0.005), gridLine(wz, 1.5, 0.005)).mul(detail); // fine, close joints (4a921f0)
    const topFace = smoothstep(0.5, 0.85, normalWorldGeometry.y);
    const wetFilm = smoothstep(0.2, 0.8, cityUniforms.uRoadWetness); // rain-darkened granite, like the roadway's film
    return mix(stone.mul(0.68), stone, topFace).mul(float(1.0).sub(joints.mul(0.42))).mul(mix(float(1.0), float(0.78), wetFilm));
  })();

  mat.roughnessNode = mix(float(0.72), float(0.5), smoothstep(0.2, 0.8, cityUniforms.uRoadWetness));

  mat.normalNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(120.0, 12.0, camDist);
    const grain = noise2D(vec2(wx.mul(5.5), wz.mul(5.5))).sub(0.5).mul(0.0022);
    return bumpNormal(grain.mul(detail));
  })();

  return mat;
}

/**
 * Tileable wind-wave texture shared by every water surface, synthesised once on the CPU: a random-phase directional
 * wind-sea spectrum (k^-4 saturation range above a spectral peak, cos² spreading) inverse-FFT'd to height & slopes.
 * RGBA half-float: R,G = slope (dh/du, dh/dv in tile units, unit RMS), B = squared slope, A = height (unit RMS).
 * The box-filtered mip chain is averaged in float, so trilinear / anisotropic sampling returns the mean slope AND the
 * mean squared slope over each pixel footprint: their difference is the slope variance of waves too small to resolve,
 * which createWaterMaterial turns into GGX roughness (LEAN mapping) instead of letting them shimmer.
 */
let _waterWaveTexture = null;

// In-place 2D inverse FFT (unnormalised, n = power of two) on separate real / imaginary arrays
function fft2DInverse(re, im, n) {
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const fft1D = () => {
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = ar[i]; ar[i] = ar[j]; ar[j] = t;
        t = ai[i]; ai[i] = ai[j]; ai[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const wr = Math.cos((2 * Math.PI) / len);
      const wi = Math.sin((2 * Math.PI) / len);
      for (let i = 0; i < n; i += len) {
        let cr = 1;
        let ci = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k;
          const b = a + half;
          const tr = ar[b] * cr - ai[b] * ci;
          const ti = ar[b] * ci + ai[b] * cr;
          ar[b] = ar[a] - tr; ai[b] = ai[a] - ti;
          ar[a] += tr; ai[a] += ti;
          const nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = nr;
        }
      }
    }
  };
  for (let pass = 0; pass < 2; pass++) { // rows, then columns
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) { const idx = pass === 0 ? r * n + c : c * n + r; ar[c] = re[idx]; ai[c] = im[idx]; }
      fft1D();
      for (let c = 0; c < n; c++) { const idx = pass === 0 ? r * n + c : c * n + r; re[idx] = ar[c]; im[idx] = ai[c]; }
    }
  }
}

function getWaterWaveTexture() {
  if (_waterWaveTexture) return _waterWaveTexture;
  const N = 256;
  const size = N * N;
  let seed = 0x2f6b9d1;
  const rand = () => { // mulberry32
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gRe = new Float64Array(size);
  const gIm = new Float64Array(size);
  for (let i = 0; i < size; i++) { // complex Gaussian white noise (Box-Muller)
    const r = Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9)));
    const a = 2 * Math.PI * rand();
    gRe[i] = r * Math.cos(a);
    gIm[i] = r * Math.sin(a);
  }

  const sRe = new Float64Array(size); // slope field packed as dh/du + i dh/dv
  const sIm = new Float64Array(size);
  const hRe = new Float64Array(size); // height field
  const hIm = new Float64Array(size);
  const kPeak = 5.0; // spectral peak (cycles per tile)
  const kCut = 56.0; // soft high cut, well inside Nyquist so slopes stay resolved at mip 0
  const windU = Math.cos(0.3);
  const windV = Math.sin(0.3);
  for (let y = 0; y < N; y++) {
    const ky = y < N / 2 ? y : y - N;
    for (let x = 0; x < N; x++) {
      const kx = x < N / 2 ? x : x - N;
      const k = Math.hypot(kx, ky);
      if (k < 1 || k > N / 2 - 2) continue;
      const c = (kx * windU + ky * windV) / k;
      const spread = 0.22 + c * c; // mostly along the wind axis, with some cross-sea
      const amp = Math.sqrt(spread * Math.exp(-1.25 * (kPeak / k) ** 2 - (k / kCut) ** 2)) / (k * k);
      const i = y * N + x;
      const m = ((N - y) % N) * N + ((N - x) % N); // index of -k: H(-k) = conj(H(k)) keeps both fields real
      const aRe = (gRe[i] + gRe[m]) * amp;
      const aIm = (gIm[i] - gIm[m]) * amp;
      hRe[i] = aRe;
      hIm[i] = aIm;
      sRe[i] = -kx * aIm - ky * aRe; // FFT⁻¹(i·kx·H − ky·H) = dh/du + i·dh/dv (up to 2π, normalised below)
      sIm[i] = kx * aRe - ky * aIm;
    }
  }
  fft2DInverse(sRe, sIm, N);
  fft2DInverse(hRe, hIm, N);

  let s2 = 0;
  let h2 = 0;
  for (let i = 0; i < size; i++) {
    s2 += sRe[i] * sRe[i] + sIm[i] * sIm[i];
    h2 += hRe[i] * hRe[i];
  }
  const sNorm = 1 / Math.sqrt(s2 / size);
  const hNorm = 1 / Math.sqrt(h2 / size);

  let w = N;
  let level = new Float32Array(size * 4);
  for (let i = 0; i < size; i++) {
    const sx = sRe[i] * sNorm;
    const sy = sIm[i] * sNorm;
    level[i * 4] = sx;
    level[i * 4 + 1] = sy;
    level[i * 4 + 2] = sx * sx + sy * sy;
    level[i * 4 + 3] = hRe[i] * hNorm;
  }
  const toHalf = THREE.DataUtils.toHalfFloat;
  const mipmaps = [];
  for (;;) {
    const data = new Uint16Array(level.length);
    for (let i = 0; i < level.length; i++) data[i] = toHalf(level[i]);
    mipmaps.push({ data, width: w, height: w });
    if (w === 1) break;
    const h = w >> 1;
    const next = new Float32Array(h * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < h; x++) {
        for (let c = 0; c < 4; c++) {
          const a = (2 * y * w + 2 * x) * 4 + c;
          next[(y * h + x) * 4 + c] = 0.25 * (level[a] + level[a + 4] + level[a + w * 4] + level[a + w * 4 + 4]);
        }
      }
    }
    level = next;
    w = h;
  }

  const tex = new THREE.DataTexture(mipmaps[0].data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mipmaps = mipmaps;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  _waterWaveTexture = tex;
  return tex;
}
window.CITY.getWaterWaveTexture = getWaterWaveTexture; // (pbr-water.js)

/**
 * Lake Ontario, the harbour, ponds & streams: Physically Based Fresh Water TSL Material
 * - Wave normals (normalNode) from 4 rotated, scaled & drifting samples of the LEAN wave texture whose energy follows
 *   slowly drifting wind patches; the slope variance below each pixel footprint (plus always-unresolved capillary
 *   ripples) becomes GGX roughness, so crisp chop near the shore turns into a soft glitter path towards the far bank
 *   and from the air, without shimmer or visible tiling.
 * - `pond: 0` is open water (Lake Ontario & the harbour: mrdoob's harbour waves & body colour); `pond: 1` the
 *   sheltered ponds & streams (finer, calmer ripples, a greener, duller body).
 * - Three ideas from web-ocean (github.com/Noniv/web-ocean, MIT), on top of mrdoob's shading:
 *   1. Visible-facet tilt: at grazing angles the viewer mostly sees the wave faces turned toward them, so the mean
 *      normal leans toward the camera by the unresolved slope; the far water reflects the bright sky near the horizon
 *      instead of going dark.
 *   2. Sun glitter from the slope distribution: a Gaussian of the facet slopes (resolved mean, unresolved variance,
 *      widened by the sun's disc) that reflect the sun to the eye, so the glitter path is sharp sparkles close by and
 *      widens into a sheen with distance, at the sun's real brightness.
 *   3. Backlit crests: thin wave tops between the eye and a low sun glow with the water's own body colour.
 * - Metalness carries the water's Fresnel (F0 = 0.02): it hands the transmitted share to the body colour and weights
 *   the pipeline's SSR, so reflections come from the sky IBL, the sun's GGX specular, SSR and the glitter above.
 */
function createWaterMaterial({ pond: pondValue = 1.0 } = {}) {
  const { sqrt, exp } = window.CITY.TSL;
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.25
  });

  const waveTex = getWaterWaveTexture();
  const pond = float(pondValue);

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
    const q = p.mul(mix(float(1.0), float(2.6), pond)); // sheltered ponds: finer ripples

    // Wind patches drifting with the breeze: large-scale wave energy that reads from the air and hides tiling
    const gustA = noise2D(p.mul(0.0047).add(vec2(t.mul(0.011), t.mul(-0.007))));
    const gustB = noise2D(p.mul(0.0135).add(vec2(t.mul(-0.009), t.mul(0.013))).add(31.7));
    const gust = smoothstep(0.18, 0.82, gustA.mul(0.62).add(gustB.mul(0.38)));
    const energy = mix(float(0.45), float(1.3), gust).mul(mix(float(1.0), float(0.42), pond)).toVar();

    const slope = vec2(0.0, 0.0).toVar();
    const variance = energy.mul(energy).mul(0.0022).toVar(); // capillary ripples, always below a pixel
    const crest = float(0.0).toVar();
    for (const [L, rot, sigma] of LAYERS) {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const speed = (0.8 * Math.sqrt(L / 9)) / L; // ~phase speed of the tile's dominant waves, in tiles per second
      const uv = vec2(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c))).div(L)
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

  // 1. Visible-facet tilt: lean the mean slope toward the viewer, up to the unresolved RMS slope at grazing angles
  const towardEye = normalize(vec2(viewDir.x, viewDir.z).add(vec2(1e-5, 0.0)));
  const grazing = pow(float(1.0).sub(cosView), 3.0);
  const slope = waves.xy.sub(towardEye.mul(min(sigmaSlope.mul(grazing).mul(1.2), 0.35).mul(cityUniforms.uWaterTilt)));

  // Fountain rims & other non-horizontal faces keep their own normal
  const flatTop = smoothstep(0.5, 0.9, normalWorldGeometry.y);
  const waterNormal = normalize(mix(normalWorldGeometry, vec3(slope.x.negate(), 1.0, slope.y.negate()), flatTop));
  mat.normalNode = cameraViewMatrix.transformDirection(waterNormal);

  // GGX alpha ≈ RMS slope of the unresolved waves (Beckmann m), roughness = sqrt(alpha); murkier ponds a touch duller
  mat.roughnessNode = clamp(pow(variance, 0.25).add(pond.mul(0.05)), 0.08, 0.65);

  const fresnel = pow(float(1.0).sub(clamp(dot(waterNormal, viewDir), 0.0, 1.0)), 5.0).mul(0.98).add(0.02);
  mat.metalnessNode = clamp(fresnel.mul(1.6), 0.0, 0.9);

  // Fresh water: blue-green grey on the open lake, olive in the ponds, with drifting silt (mrdoob's two body colours)
  const bodyColor = Fn(() => {
    const silt = noise2D(positionWorld.xz.mul(0.0031).add(7.3));
    const body = mix(color(0x162d2c), color(0x2e3f36), smoothstep(0.25, 0.85, silt));
    const lake = mix(color(0x24321f), color(0x33402a), silt);
    return mix(body, lake, pond);
  })();
  mat.colorNode = Fn(() => {
    const crestTint = smoothstep(0.6, 2.4, waves.w).mul(0.35).add(1.0);
    return bodyColor.mul(crestTint);
  })();

  // 2 & 3: sun glitter & backlit crests, added as emitted light (both vanish with the sun below the horizon)
  const U = cityUniforms;
  mat.emissiveNode = Fn(() => {
    const L = normalize(U.uSkySunDir);
    const sunUp = smoothstep(-0.02, 0.06, L.y);
    const sunRad = U.uSunColor.mul(U.uSunIntensity).mul(sunUp);

    // the facet slope that mirrors the sun into the eye, against the slopes the pixel holds
    const H = normalize(L.add(viewDir));
    const hy = max(H.y, 0.05);
    const sH = vec2(H.x.negate(), H.z.negate()).div(hy);
    const d = sH.sub(waves.xy);
    const s2 = variance.add(0.00003); // + the sun's disc (~0.27° radius) so the far sheen never collapses to a point
    const p = exp(dot(d, d).negate().div(s2.mul(2.0))).div(s2.mul(6.2832));
    const cosH4 = hy.mul(hy).mul(hy).mul(hy);
    const fH = pow(float(1.0).sub(clamp(dot(H, viewDir), 0.0, 1.0)), 5.0).mul(0.98).add(0.02);
    const glitter = min(fH.mul(p).div(cosH4.mul(4.0).mul(cosView)), 60.0).mul(U.uWaterGlitter);

    // backlit crests: the sun low and behind the waves, light through their thin tops
    const back = pow(clamp(dot(L, viewDir.negate()), 0.0, 1.0), 4.0).mul(smoothstep(0.35, 0.05, L.y));
    const crests = smoothstep(0.8, 2.6, waves.w).mul(back).mul(0.06).mul(U.uWaterGlow);

    return sunRad.mul(glitter.mul(flatTop)).add(sunRad.mul(bodyColor).mul(crests).mul(4.0));
  })();

  return mat;
}

/**
 * Park, Lawn & Median Lush Multi-Octave Turf, Clover & Mowing Stripes TSL Material
 */
function createParkLawnMaterial(isMeadow = false) {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.86
  });

  const cGrassDeep = color(isMeadow ? 0x2c5c28 : 0x224c20);
  const cGrassMid = color(isMeadow ? 0x457d36 : 0x36682c);
  const cGrassSun = color(0x6b9c3e);

  mat.colorNode = Fn(() => {
    const wp = positionWorld.xz;
    const macroPatch = noise2D(wp.mul(0.06));
    const midClover = noise2D(wp.mul(0.35));
    const microBlade = noise2D(wp.mul(3.8));
    const mowStripe = sin(wp.x.mul(0.55).add(wp.y.mul(0.25))).mul(0.5).add(0.5);

    const baseLawn = mix(
      cGrassDeep,
      cGrassMid,
      macroPatch.mul(0.45).add(midClover.mul(0.35)).add(mowStripe.mul(0.20))
    );
    return mix(baseLawn, cGrassSun, microBlade.mul(0.38));
  })();

  mat.normalNode = Fn(() => {
    const wp = positionWorld.xz;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(85.0, 10.0, camDist);
    const turf = noise2D(wp.mul(7.5)).sub(0.5).mul(0.008);
    return bumpNormal(turf.mul(detail));
  })();

  // Grass is a canopy of blades that shadow each other, not a flat dielectric: at grazing angles a plain F0 = 0.04 /
  // F90 = 1 Fresnel mirrors the sky and turns lawns teal, so weaken the specular and cap its grazing rise
  const { specularColor, specularColorBlended, specularF90 } = window.CITY.TSL;
  mat.setupSpecular = function () {
    specularColor.assign(vec3(0.025));
    specularColorBlended.assign(vec3(0.025));
    specularF90.assign(0.3);
  };

  return mat;
}

// Transparent decal/effect planes & sprites preserve the underlying road/scene G-buffer in MRT (zero RGB & zero alpha on normal & metalRough)
const _transparentEffectMRT = mrt({
  normal: vec4(0.0, 0.0, 0.0, 0.0),
  metalRough: vec4(0.0, 0.0, 0.0, 0.0)
});

/**
 * Soft Rounded-Rectangle Under-Vehicle Contact Shadow (Ambient Occlusion) TSL Material
 */
function createContactShadowMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: false
  });

  const shadowOpacity = Fn(() => {
    const uvCentered = uv().sub(vec2(0.5, 0.5)).mul(2.0);
    const p = abs(uvCentered);
    // Rounded-box SDF in normalized [-1, 1]^2 quad coords with smooth falloff to 0 before quad edges
    const q = p.sub(vec2(0.64, 0.70));
    const d = length(max(q, vec2(0.0, 0.0))).add(min(max(q.x, q.y), 0.0));
    const chassisAO = smoothstep(0.30, -0.14, d);
    const coreAO = smoothstep(0.76, 0.12, p.x).mul(smoothstep(0.82, 0.16, p.y));
    // Extra contact darkening directly under the 4 tires
    const wheelPatch = smoothstep(0.22, 0.0, length(p.sub(vec2(0.68, 0.56)).mul(vec2(1.4, 1.0))));
    return clamp(chassisAO.mul(0.72).add(coreAO.mul(0.18)).add(wheelPatch.mul(0.18)), 0.0, 0.88);
  })();

  mat.colorNode = Fn(() => color(0x020305))();
  mat.opacityNode = shadowOpacity;
  // Smoothly occlude wet-road SSR under the vehicle footprint proportional to shadow opacity (0 at quad edges)
  mat.mrtNode = mrt({
    normal: vec4(0.0, 0.0, 0.0, 0.0),
    metalRough: vec4(0.0, 1.0, 0.0, shadowOpacity.mul(0.88))
  });

  return mat;
}

/**
 * Projected Dual-Lobe LED Headlight Road Cone TSL Material
 */
function createHeadlightBeamMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending
  });
  mat.mrtNode = _transparentEffectMRT;

  mat.colorNode = Fn(() => color(0xfff5dc))();

  mat.opacityNode = Fn(() => {
    const p = vec2(1.0, 1.0).sub(uv());
    // p.y = 0 right under the front bumper headlamps, p.y = 1 at far end of road cone
    const distFade = smoothstep(0.0, 0.035, p.y).mul(pow(clamp(float(1.0).sub(p.y), 0.0, 1.0), 1.65));
    const edgeFadeX = smoothstep(0.0, 0.14, p.x).mul(smoothstep(1.0, 0.86, p.x));

    // Dual headlamp cones originating at x = 0.5 +- 0.185 (~+-0.63m) and fanning outward
    const fanOffset = float(0.185).add(p.y.mul(0.045));
    const beamHalfWidth = float(0.065).add(p.y.mul(0.20));

    const leftDist = abs(p.x.sub(float(0.5).sub(fanOffset)));
    const rightDist = abs(p.x.sub(float(0.5).add(fanOffset)));

    const leftBeam = pow(smoothstep(beamHalfWidth, 0.0, leftDist), 1.25);
    const rightBeam = pow(smoothstep(beamHalfWidth, 0.0, rightDist), 1.25);
    // Soft merged mid-field cone fill where the two beams overlap ahead of the vehicle
    const centerFill = smoothstep(0.10, 0.38, p.y).mul(
      pow(smoothstep(float(0.18).add(p.y.mul(0.22)), 0.0, abs(p.x.sub(0.5))), 1.4)
    ).mul(0.45);

    const combinedCone = clamp(max(leftBeam, rightBeam).add(centerFill), 0.0, 1.0);
    const nightBoost = clamp(cityUniforms.uInteriorGlow.mul(0.65), 0.10, 0.88);
    return combinedCone.mul(distFade).mul(edgeFadeX).mul(nightBoost).mul(0.30);
  })();

  return mat;
}

/**
 * Car lamp flares for distant traffic (instanced sprites on a unit quad): a soft round glow with a hot core per lamp,
 * placed and sized per instance (`flarePos` = x, y, z, world size) and tinted (`flareCol` = rgb (+ an unused w, so
 * the attribute needs no padding on upload), already including the lamp's visibility from the camera), lit only at
 * dusk & night. Additive, so no fog (it would add fog colour).
 */
function createCarFlareMaterial() {
  const mat = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending
  });
  mat.mrtNode = _transparentEffectMRT;
  const p = attribute('flarePos', 'vec4');
  mat.positionNode = p.xyz;
  mat.scaleNode = vec2(p.w, p.w);
  mat.colorNode = Fn(() => {
    const night = smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow);
    const r = length(uv().sub(0.5)).mul(2.0);
    const halo = pow(smoothstep(1.0, 0.0, r), 1.5);
    const core = smoothstep(0.5, 0.0, r);
    return attribute('flareCol', 'vec4').rgb.mul(halo.add(core.mul(2.0))).mul(night);
  })();
  mat.opacityNode = float(1.0);
  return mat;
}

// =====================================================================================================================
// ABUJA GROUND: the savanna & granite terrain, compound yards, rendered compound walls
// =====================================================================================================================

// Multi-octave value noise (0..1)
const fbm2 = (p) => noise2D(p).mul(0.5).add(noise2D(p.mul(2.03).add(17.1)).mul(0.3)).add(noise2D(p.mul(4.11).add(41.7)).mul(0.2));

/**
 * Terrain: the hills & inselbergs around the city (Aso Rock, the Katampe & Mpape ridges). Bare granite domes on the
 * steep flanks (grey with dark weathering streaks running down the slope and pale exfoliation sheets), Guinea savanna
 * on the gentle ground: tall grass going from green to straw, laterite (red earth) showing through, darker shrub & tree
 * clumps. Steepness from the geometric normal; the streaks follow the height so they run downhill.
 */
let _terrainMat = null;
function createTerrainMaterial() {
  if (_terrainMat) return _terrainMat;
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.92 });
  const steep = () => smoothstep(0.86, 0.62, normalWorldGeometry.y); // 0 flat .. 1 steeper than ~50°
  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const p = wp.xz;
    const grassMix = fbm2(p.mul(0.011));
    const dry = smoothstep(0.35, 0.75, fbm2(p.mul(0.0042).add(3.1)));
    const grass = mix(color(0x5d6b31), color(0xa08f55), dry.mul(0.75).add(grassMix.mul(0.25)));
    const laterite = mix(color(0x8a4f30), color(0xa86c44), noise2D(p.mul(0.09)));
    const bare = smoothstep(0.62, 0.8, fbm2(p.mul(0.023).add(9.4)));
    const shrubs = smoothstep(0.58, 0.74, fbm2(p.mul(0.045).add(27.3)));
    let ground = mix(grass, laterite, bare.mul(0.7));
    ground = mix(ground, color(0x334322), shrubs.mul(0.75));
    // Granite: grey-pink with dark lichen & water streaks down the slope, pale fresh exfoliation sheets
    const streaks = smoothstep(0.55, 0.8, noise2D(vec2(p.x.mul(0.35).add(p.y.mul(0.2)), wp.y.mul(0.02))));
    const sheets = smoothstep(0.6, 0.85, fbm2(p.mul(0.03).add(5.7)));
    let rock = mix(color(0x8c8279), color(0x6d665f), fbm2(p.mul(0.08)));
    rock = mix(rock, color(0x3b3833), streaks.mul(0.55));
    rock = mix(rock, color(0xb5aa9c), sheets.mul(0.35));
    // high ground: more rock between the grass even where it's not steep (the domes' shoulders)
    const high = smoothstep(120.0, 260.0, wp.y);
    return mix(ground, rock, max(steep(), high.mul(0.6)));
  })();
  mat.roughnessNode = mix(float(0.94), float(0.72), smoothstep(0.86, 0.62, normalWorldGeometry.y));
  mat.normalNode = Fn(() => {
    const p = positionWorld.xz;
    const detail = smoothstep(400.0, 30.0, length(positionWorld.sub(cameraPosition)));
    return bumpNormal(noise2D(p.mul(0.6)).mul(0.25).add(noise2D(p.mul(2.5)).mul(0.06)).mul(detail));
  })();
  _terrainMat = mat;
  return mat;
}

/**
 * Compound yards & open plots inside the blocks: laterite (red earth) worn bare where people walk and park, patchy
 * lawns & tall grass, concrete paving & interlocking pavers in front of the buildings
 */
// Downtown forecourts & plazas: poured concrete in 1.5 m flags, a few slabs a shade off, the joints only up close. Plain
// on purpose: it covers whole blocks, where the sidewalk's wet-weather shading cost frames for no visible gain
let _forecourtMat = null;
function createForecourtMaterial() {
  if (_forecourtMat) return _forecourtMat;
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.86 });
  // Plain weathered concrete, a shade darker than the City's walks beside it: the private frontage between the walk & the
  // building face. (It was a 1.5 m grid of flags square to the world axes, which read as New York's sidewalks next to
  // Toronto's poured ones and ran askew on the off-grid streets.)
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const near = smoothstep(60.0, 10.0, length(positionWorld.sub(cameraPosition)));
    const tone = mix(color(0x83817b), color(0x96948d), noise2D(p.mul(0.09)));
    const mottle = noise2D(p.mul(0.7).add(13.0)).sub(0.5).mul(0.06).mul(near);
    return tone.mul(mottle.add(1.0));
  })();
  _forecourtMat = mat;
  return mat;
}

let _plotGroundMat = null;
function createPlotGroundMaterial() {
  if (_plotGroundMat) return _plotGroundMat;
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.9 });
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    // Toronto's front & back yards in late summer: lawn, darker mulched beds, concrete driveways & walks
    const mulch = mix(color(0x4a3524), color(0x5c4430), noise2D(p.mul(0.21)));
    const grass = mix(color(0x4f7a2c), color(0x6f8a38), fbm2(p.mul(0.031).add(5.0)));
    const paving = mix(color(0x8d8a84), color(0xa8a49b), noise2D(p.mul(0.7)));
    const g = smoothstep(0.12, 0.26, fbm2(p.mul(0.05).add(1.3)));
    const paved = smoothstep(0.7, 0.76, fbm2(p.mul(0.024).add(71.0)));
    // interlocking pavers: a fine 0.2 x 0.1 m running bond, only up close
    const near = smoothstep(40.0, 8.0, length(positionWorld.sub(cameraPosition)));
    const bx = fract(p.x.mul(5.0).add(step(0.5, fract(p.y.mul(5.0))).mul(0.5)));
    const joint = max(smoothstep(0.06, 0.0, bx), smoothstep(0.12, 0.0, fract(p.y.mul(10.0)))).mul(near).mul(0.35);
    const ground = mix(mulch, grass, g);
    return mix(ground, paving.mul(float(1.0).sub(joint)), paved);
  })();
  mat.normalNode = Fn(() => {
    const p = positionWorld.xz;
    const detail = smoothstep(60.0, 6.0, length(positionWorld.sub(cameraPosition)));
    return bumpNormal(noise2D(p.mul(3.0)).mul(0.012).mul(detail));
  })();
  _plotGroundMat = mat;
  return mat;
}

/**
 * Rendered & painted block walls (compound walls & gate piers): the paint colour per vertex (`color` attribute), a
 * coping shadow line at the top, rain streaks and the red laterite dust splashed up the bottom half-metre
 */
let _wallMat = null;
function createRenderedWallMaterial() {
  if (_wallMat) return _wallMat;
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.88 });
  mat.colorNode = Fn(() => {
    const paint = attribute('color', 'vec3');
    const wp = positionWorld;
    const local = attribute('uv', 'vec2'); // u: metres along the wall, v: metres up from its foot
    const top = attribute('wallTop', 'float');
    const dust = smoothstep(0.75, 0.05, local.y).mul(noise2D(vec2(local.x.mul(1.3), 0.5)).mul(0.5).add(0.5));
    const streak = smoothstep(0.65, 0.9, noise2D(vec2(local.x.mul(2.1), wp.y.mul(0.15)))).mul(smoothstep(top.sub(0.1), top.sub(1.2), local.y)).mul(0.18);
    const coping = smoothstep(top.sub(0.18), top.sub(0.12), local.y);
    let c = mix(paint, paint.mul(0.8), noise2D(wp.xz.mul(0.4)).mul(0.25));
    c = c.mul(float(1.0).sub(streak));
    c = mix(c, color(0x9a5a38), dust.mul(0.55));
    return mix(c, paint.mul(0.92), coping);
  })();
  _wallMat = mat;
  return mat;
}

Object.assign(window.CITY, { filteredPulse, cityUniforms, WALL_KINDS, createCurtainWallMaterial, createPreWarBuildingMaterial, createFacadeBoxes, createCarPaintMaterial, createFoliageMaterial, createTreeBarkMaterial, createTreeMaterial, createRoadSurfaceMaterial, createRoadPaintMaterial, createSidewalkMaterial, createCurbMaterial, createWaterMaterial, createParkLawnMaterial, createContactShadowMaterial, createHeadlightBeamMaterial, createCarFlareMaterial, createTerrainMaterial, createPlotGroundMaterial, createForecourtMaterial, createRenderedWallMaterial, createRenderedFacadeMaterial });
})();
