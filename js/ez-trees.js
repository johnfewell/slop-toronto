(function () {
// js/ez-trees.js
// Toronto's trees in John's EZ-Tree models (assets/trees: @dgreenheck/ez-tree 1.1.0, MIT, baked by ride-anywhere's
// tools/assets/ez-tree-kit.mjs: a full `near` mesh & a decimated `mid` one over one cutout atlas per model):
// - every City street tree (GEO.streetTrees: where it stands, its model by genus & trunk size, its height from the trunk)
// - the parkland & yard trees street-details.js invents where the City keeps no inventory
// Drawn like mrdoob's tree field (trees.js): each tree's level follows the view camera (near mesh within NEAR, mid mesh
// within MID, beyond that mrdoob's whole-crown cards for the nearest of his species, or the mid mesh for pines), and the
// trees of one model & level are regrouped into one instanced mesh whenever the levels change.
// No pops: across a band round each hand-over a tree is drawn at both levels, each through a screen-door dither with
// the same threshold and opposite roles (concept-3d's LOD crossfade), so every pixel is drawn by exactly one of them, in
// colour and in the shadow maps; the threshold follows the tree's distance from the viewer, so a parked camera holds
// the dissolve and a moving one runs it. The last level dissolves to nothing the same way.

const { THREE } = window.CITY;
const V3 = THREE.Vector3;

// (the distances by quality tier, quality.js: 55, 320 & 130 m on desktops)
const NEAR = window.CITY.QUALITY.treeNear; // full EZ-Tree mesh within (m)
const MID = window.CITY.QUALITY.treeMid; // decimated mesh within; whole-crown cards beyond
// ...nearer from street level (the camera under 40 m): there the parks' far trees mostly stand behind the buildings,
// and at Queen St W by Trinity Bellwoods the mid meshes out to 320 m were 3.9M triangles and ~2.5 ms of an M4 mini's
// frame for trees nobody saw (st-z51b). ?treemidstreet=<m> for A/B (the woods keep their own share of MID)
const MID_STREET = Math.min(MID, Number(new URLSearchParams(location.search).get('treemidstreet') ?? window.CITY.QUALITY.treeMidStreet ?? MID));
// mid trees further than this cast no shadow (a twin mesh that skips the shadow maps): drawing the ~500 mid trees of a
// 320 m circle into both cascades cost 2.2 ms a frame on the M4 mini, for shadows a few pixels long
const MID_SHADOW = Number(new URLSearchParams(location.search).get('treeshadow') ?? window.CITY.QUALITY.treeMidShadow); // ?treeshadow=320: all of them, for A/B
// The wooded parks' woods (park-woods.js: High Park, Toronto Island): their trees stand 50-70 to the hectare and hide each other, so they are a class
// of their own (WOODS_CLASS) handing over to the coarser levels nearer, at these shares of the distances above
const WOODS_CLASS = 6, IMP_CLASS = 7, CLASSES = 8;
const WOODS_SHARE = { near: 0.55, mid: 0.42, shadow: 0.5 };
// The High Park pilot's woods trees (IMP_CLASS: docs/park-cover.md, st-annt.4) hand over from the mid mesh to a baked,
// lit impostor (tree-impostors.js) at IMP_MID instead of to the crown cards at the woods' mid distance: one quad a tree
// from there out. ?treeimp=0: the woods as before; ?treeimp=all: every park's woods (the Island's too); ?treeimpmid=<m>
const IMP_PARAM = new URLSearchParams(location.search).get('treeimp');
// (2026-11-06: their leaf-fall had broken into squares in autumn, off for a day; fixed with a smooth leaf key, checked in
// every season: tools/shots/park-seasons.json)
const IMP_ON = IMP_PARAM !== '0' && !!window.CITY.treeImpostors;
const IMP_ALL = IMP_PARAM === 'all';
const IMP_MID = Number(new URLSearchParams(location.search).get('treeimpmid') ?? window.CITY.QUALITY.treeImpMid ?? 45);
// (the rollout, as water-edges.js's: the pilot's box, High Park's woods [x0, z0, x1, z1])
const IMP_ROLLOUT = { 'high-park': [-7200, -2940, -5760, -1080] };
const inImpRollout = (x, z) => IMP_ALL || Object.values(IMP_ROLLOUT).some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
const isWoods = (c) => c === WOODS_CLASS || c === IMP_CLASS;
// The pilot's canopy (docs/park-cover.md, John 2026-11-06): the park's trees in a deeper summer yellow-green than the
// models' mint (their leaf texels only, by where the tree stands: on High Park's islands, read off the woods' ground
// cover in the vertex stage; the street trees on the sidewalks round it, the Island's and every other tree keep
// theirs), and the woods' lidar trees a little less even: a stem up to 1.2 m off its crown's top, a lean of up to 4
// degrees, 10% more spread in height. ?canopy=0 / ?treevary=0: as before
const CANOPY_ON = new URLSearchParams(location.search).get('canopy') !== '0';
const VARY_ON = new URLSearchParams(location.search).get('treevary') !== '0';
const PILOT_BOX = IMP_ROLLOUT['high-park'];
const inPilot = (x, z) => x > PILOT_BOX[0] && x < PILOT_BOX[2] && z > PILOT_BOX[1] && z < PILOT_BOX[3];
/**
 * The pilot's summer grade of a leaf colour (TSL vec3): the models' mint turned to a deep summer green, closer to the
 * park's photos, and each tree its own: `treeRnd` (0..1, the tree's hash of where it stands, the same on its meshes and
 * its impostor) moves its value (0.62-1.12) and its hue between a yellower and a bluer green, so the woods from the air
 * keep the tree-to-tree variation the crown cards had
 */
function canopyGrade(c, treeRnd) {
  const { vec3, dot, mix, fract, float } = window.CITY.TSL;
  const r2 = fract(treeRnd.mul(7.31)), r3 = fract(treeRnd.mul(13.7));
  const hue = mix(vec3(0.82, 0.86, 0.46), vec3(0.6, 0.78, 0.64), r2); // (yellower .. bluer)
  const g = c.mul(hue).mul(mix(float(0.62), float(1.12), r3.mul(r3).oneMinus())).mul(0.82); // (a few dark trees, most mid)
  return mix(vec3(dot(g, vec3(0.3, 0.59, 0.11))), g, 1.15).max(0);
}
/** A tree's hash from where it stands (its aLodOrigin): the seasons' and the canopy grade's per-tree random */
function treeRndNode() {
  const { attribute, fract, sin, dot, vec2 } = window.CITY.TSL;
  return fract(sin(dot(attribute('aLodOrigin', 'vec3').xz, vec2(12.9898, 78.233))).mul(43758.5453));
}
// (per vertex: 1 for a tree on High Park's islands, by its middle, 0 elsewhere; the woods' ground cover's alpha is 1 on
// the park's islands)
let pilotNode = null;
function inPilotNode() {
  if (pilotNode) return pilotNode;
  const T = window.CITY.TSL, PWx = window.CITY.parkWoods;
  const { attribute, texture, vec2, varying, float, select } = T;
  if (!CANOPY_ON || !PWx || !PWx.parks.length) return (pilotNode = float(0));
  const hp = PWx.parks[0], b = hp.box;
  const o = attribute('aLodOrigin', 'vec3');
  const uv = o.xz.sub(vec2(b.x0, b.z0)).div(vec2(b.x1 - b.x0, b.z1 - b.z0));
  const inBox = uv.x.greaterThan(0).and(uv.x.lessThan(1)).and(uv.y.greaterThan(0)).and(uv.y.lessThan(1));
  pilotNode = varying(select(inBox, texture(hp.groundCover().texture, uv).a, float(0)), 'vPilotCanopy');
  return pilotNode;
}
const nearOf = (c) => (isWoods(c) ? NEAR * WOODS_SHARE.near : NEAR);
// (the mid level and its shadows nearer still on the lighter tiers, by their treeFar: a phone's woods hand over to the
// cards at 53 m, where 50-70 trees to the hectare had made the woods 25% more triangles than the parkland grid's trees)
const midOf = (c, low = false) => (c === IMP_CLASS ? IMP_MID : c === WOODS_CLASS ? MID * WOODS_SHARE.mid * Math.min(1, FAR) : low ? MID_STREET : MID);
const shadowOf = (c) => (isWoods(c) ? MID_SHADOW * WOODS_SHARE.shadow * Math.min(1, FAR) : MID_SHADOW);
// (the mid mesh's shadow dissolves across this band centred on shadowOf; ?treeshadowband=0: the old hard swap)
const SHADOW_BAND_K = Number(new URLSearchParams(location.search).get('treeshadowband') ?? 1);
const shadowBand = (c) => (FADE ? (isWoods(c) ? 10 : 15) * SHADOW_BAND_K : 0);
// (the band's middle: by default the band ends the regroup margin short of shadowOf, so the mid meshes cast no further
// out than before the band: a band centred on shadowOf drew 14 m more of the woods' mid meshes into both cascades, 3 fps
// of the autumn woods walk on the M4 mini. ?treeshadowshift=<m>: the middle at shadowOf + m, for A/B)
const SHIFT_PARAM = new URLSearchParams(location.search).get('treeshadowshift');
const shadowMid = (c) => shadowOf(c) + (shadowBand(c) > 0 ? (SHIFT_PARAM != null ? Number(SHIFT_PARAM) : -MARGIN - shadowBand(c) * 0.5) : 0);
// (where the mid level hands over to its twin that casts nothing: past the band, by the regroup margin)
// The pilot's woods trees (IMP_CLASS) hand their shadow over, across that band, to a shadow-only stand-in: their
// impostor's quad facing the sun (tree-impostors.js shadowProxy), cast out to PROXY_FAR, dissolving out over
// PROXY_BAND; the mid mesh's shadow and the stand-in's share one threshold, so the shadow map's texels are each cast by
// one of them (st-annt.9: one quad a tree in the shadow pass in place of the mid mesh, and the woods across the pond
// cast shadows). Off by default: on the M4 mini's woods walk the stand-ins' big alpha-tested quads cost 2.7 fps in
// autumn and 4.2 at golden hour (the low sun), where the mid meshes' band alone costs ~0.2. ?treeshadowproxy=1: on
const PROXY = new URLSearchParams(location.search).get('lodfade') !== '0' && new URLSearchParams(location.search).get('treeshadowproxy') === '1';
const PROXY_FAR = Number(new URLSearchParams(location.search).get('treeshadowproxyfar') ?? 110), PROXY_BAND = 20;
const shadowOut = (c) => shadowMid(c) + shadowBand(c) * 0.5 + (shadowBand(c) > 0 ? MARGIN : 0);
// ?lodfade=0: the old hard swap (no masks, no bands), for A/B
const FADE = new URLSearchParams(location.search).get('lodfade') !== '0';
// hand-over bands, centred on the edge (m): near <-> mid, mid <-> far, the last level -> nothing
// (narrowed from 14 / 50 / 80 m, st-z51b: a tree inside a band draws at both levels, and at Queen St W the bands
// cost ~2.9 ms of an M4 mini's frame; ?lodbands=14,50,80 for A/B)
const BAND_PARAM = new URLSearchParams(location.search).get('lodbands');
const BAND = FADE ? (BAND_PARAM ? BAND_PARAM.split(',').map(Number) : [8, 24, 40]) : [0, 0, 0];
// the levels are regrouped every 4 m of camera travel: a tree joins a level this much before its band starts
const MARGIN = FADE ? 6 : 0;
const FAR = window.CITY.QUALITY.treeFar; // (x the furthest distances below: nearer on the phone tiers, quality.js)
const MAX_DIST = [3000 * FAR, 1600 * FAR, 950 * FAR]; // by tier (0 park, 1 street, 2 yard), as trees.js
const LOW_CUTOFF = 1150 * FAR; // at street level everything further is behind the buildings
const PINE_FAR = Number(new URLSearchParams(location.search).get('pinefar') ?? 600 * FAR); // pines keep their mid mesh far out (mrdoob's species are all broadleaf)

// model family -> mrdoob's far crown species (0 London plane, 1 honey locust, 2 elm); -1: no far crown (pines)
const FAR_SPECIES = (id) => (id.includes('pine') ? -1 : id.includes('ash') ? 1 : /aspen|cottonwood/.test(id) ? 2 : 0);
const hashPos = (x, y, z) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

// A glTF mesh's geometry in model space, positions as floats (meshopt quantisation stores them as normalised ints)
function bakedGeometry(mesh) {
  mesh.updateWorldMatrix(true, false);
  const geo = mesh.geometry.clone();
  for (const name of ['position', 'normal']) {
    const a = geo.attributes[name];
    if (a && (!(a.array instanceof Float32Array) || a.normalized)) {
      const f = new Float32Array(a.count * 3);
      for (let i = 0; i < a.count; i++) { f[3 * i] = a.getX(i); f[3 * i + 1] = a.getY(i); f[3 * i + 2] = a.getZ(i); }
      geo.setAttribute(name, new THREE.BufferAttribute(f, 3));
    }
  }
  geo.applyMatrix4(mesh.matrixWorld);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// The hand-over dissolve. Per instance: aLodOrigin, the tree's middle; aLodFade = (edge in, band in, edge out, band
// out), the distances where this level takes over from the finer one and hands over to the coarser one (or to nothing).
// Across a band the share t runs 0 -> 1 with the distance; the coarser level keeps the pixels whose hash is under t, the
// finer one the rest. The distance is from `viewer` (set from the view camera before every render): in the shadow
// passes TSL's cameraPosition is the light's.
// (renderGroup: one value per render, uploaded once rather than per tree mesh; set in scene.onBeforeRender, before any
// object of the render draws)
const viewer = (() => {
  const { uniform, renderGroup } = window.CITY.TSL;
  return uniform(new THREE.Vector3()).setGroup(renderGroup);
})();
// (the dissolves' threshold, 0..1 per pixel: tsl-materials.js's blue noise, shifted per tree; interleaved-gradient noise
// where that isn't loaded, as in the tests' harness)
const lodDither = window.CITY.lodDither || (() => {
  const { screenCoordinate, fract, dot, vec2, float } = window.CITY.TSL;
  return fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
});
// (per tree, so in the vertex stage: its distance's shares and its dither's shift, as varyings; the fragment does one
// lookup and the compares. The mask runs on every leaf fragment of every tree, in the view and in both shadow cascades)
const lodNodes = (() => {
  const { attribute, fract, sin, dot, vec2, vec4, clamp, distance, varying } = window.CITY.TSL;
  const origin = attribute('aLodOrigin', 'vec3');
  const fade = attribute('aLodFade', 'vec4');
  const sh = attribute('aLodShadow', 'vec2');
  const d = distance(origin, viewer);
  const share = (edge, band) => clamp(d.sub(edge.sub(band.mul(0.5))).div(band), 0.0, 1.0);
  // (x share in, y share out, z the shadow's share out, w the tree's hash)
  const v = varying(vec4(share(fade.x, fade.y), share(fade.z, fade.w), clamp(d.sub(sh.x).mul(sh.y), 0.0, 1.0),
    fract(sin(dot(origin.xz, vec2(12.9898, 78.233))).mul(43758.5453))), 'vLodShares');
  // (blue noise on the pixel grid, shifted per tree by where it stands: tsl-materials.js lodDither)
  const h = lodDither(v.w);
  return { v, h };
})();
const lodKeep = lodNodes.h.lessThan(lodNodes.v.x).and(lodNodes.h.greaterThanEqual(lodNodes.v.y));
// The mid mesh's shadow dissolves out across a band round its shadow distance (shadowBand) before the tree hands over
// to its twin that casts none (st-annt.9: the hard swap had whole dappled patches of the woods' shadows vanish from the
// trail in one frame). Per instance aLodShadow = (where the band starts, 1 / its width); (0, 0), the default: always
// casts. Only in the shadow pass, the same blue-noise threshold as lodKeep, on the shadow map's own texels
const shadowKeep = lodNodes.h.greaterThanEqual(lodNodes.v.z);
const ALL_IN = -1e6, ALL_OUT = 1e9;
// The levels that cast no shadow (the mid mesh beyond its shadow distance, the crown cards) draw only the cells in a cone
// round the view: the camera's frustum (the cone round its corners) widened by VIEW_MARGIN, so the cone is re-cut only
// after the camera has turned by most of the margin (RECUT). A cell's sphere round its trees' middles is grown by
// CROWN_PAD for their crowns. Every tree that can be in the frame still draws, and every shadow caster draws all round,
// so the frame is the same; the GPU stops transforming the woods behind the camera (st-usbd: High Park's woods walk
// drew ~480 mid trees and ~12,000 cards all round). ?treecull=0 draws them all round, for A/B
const VIEW_CULL = new URLSearchParams(location.search).get('treecull') !== '0';
const VIEW_MARGIN = 0.5, RECUT = 0.3, CROWN_PAD = 25; // (rad, rad, m)
// Trees are binned into square cells this wide for the level updates (cell-hierarchical, after mrdoob's trees.js in
// upstream e35c06c): a cell lying wholly between two hand-over edges takes one level set per tree class without
// per-tree distances; only the cells straddling an edge evaluate their trees one by one
const LOD_CELL = 200;

// Seasons on a broadleaf model (docs/live-sky.md, Seasons; tsl-materials.js cityUniforms uLeaf, uAutumn, uSpring). Its
// atlas has the leaf spray on the left (u < 0.8) and the bark on the right: on the spray, the leaves are the green texels
// and the stalks & twigs the brown ones. Leaves turn (autumnLeaf) and fall (leafStays) by a per-leaf key, smooth noise
// over the spray plus a per-tree share, so a crown thins leaf by leaf, one tree ahead of the next; the twigs stay, the
// bare crown's fine tracery. Shadows lose the fallen leaves too. At the summer values this is the glTF material exactly.
// Returns { color, keep } for the material's colour & mask nodes.
function seasonNodes(map) {
  const { texture, uv, vec2, vec4, max, mix, smoothstep, fract, sin, dot, attribute, materialColor } = window.CITY.TSL;
  const { autumnLeaf, leafStays } = window.CITY;
  const tex = texture(map, uv());
  const spray = uv().x.lessThan(0.7995);
  // relative greenness: leaves ~0.25-0.65, stalks & twigs under 0.1
  const green = tex.g.sub(max(tex.r, tex.b)).div(max(tex.g, 0.001));
  const leafness = smoothstep(0.12, 0.22, green).mul(spray.select(1.0, 0.0));
  // per tree: a hash of where it stands (aLodOrigin, its middle); per leaf: noise over the spray
  const origin = attribute('aLodOrigin', 'vec3');
  const treeRnd = fract(sin(dot(origin.xz, vec2(12.9898, 78.233))).mul(43758.5453));
  const p = uv().mul(vec2(26.0, 21.0)).add(treeRnd.mul(41.0));
  const i = p.floor(), f = p.fract();
  const h = (o) => fract(sin(dot(i.add(o), vec2(127.1, 311.7))).mul(43758.5453));
  const s = f.mul(f).mul(f.mul(-2.0).add(3.0));
  const leafRnd = mix(mix(h(vec2(0, 0)), h(vec2(1, 0)), s.x), mix(h(vec2(0, 1)), h(vec2(1, 1)), s.x), s.y);
  const keep = leafness.lessThan(0.5).or(leafStays(leafRnd.mul(0.75).add(treeRnd.mul(0.25))));
  const base = materialColor;
  // (the pilot's canopy grade on the leaves only, before the autumn's)
  const summer = CANOPY_ON ? mix(base.rgb, canopyGrade(base.rgb, treeRnd), leafness.mul(inPilotNode())) : base.rgb;
  const color = vec4(mix(summer, autumnLeaf(summer, treeRnd, leafRnd), leafness), base.a); // (TSL's a.mix(b, t) is mix(b, t, a): the function form)
  return { color, keep };
}

// The EZ-Tree glTF material as a node material wearing the dissolve; the cutout as nodes, as createTreeMaterial does
// (an `alphaTest` on a shadow caster churns the shared shadow material's version). Broadleaf models (`seasonal`) follow
// the season; the pines stay green.
function fadeMaterial(src, seasonal = false) {
  const { texture, uv, float } = window.CITY.TSL;
  const mat = new THREE.MeshStandardNodeMaterial({
    map: src.map, color: src.color, roughness: src.roughness ?? 0.9, metalness: src.metalness ?? 0, side: THREE.DoubleSide
  });
  mat.name = `${src.name || 'tree'}_lodfade`;
  mat.alphaTestNode = float(0.5);
  let cutout = src.map ? texture(src.map, uv()).a.greaterThan(0.5) : null;
  let mask = FADE ? lodKeep : null;
  if (seasonal && src.map) {
    const season = seasonNodes(src.map);
    mat.colorNode = season.color;
    mask = mask ? mask.and(season.keep) : season.keep;
    cutout = cutout.and(season.keep);
  }
  if (mask) mat.maskNode = mask;
  if (cutout) mat.maskShadowNode = FADE ? cutout.and(lodKeep).and(shadowKeep) : cutout;
  else if (FADE) mat.maskShadowNode = lodKeep.and(shadowKeep);
  return mat;
}

// Toronto Island's cottonwoods (park-woods-parks.mjs): the aspen's form, in an old cottonwood's bark, grey-brown and
// deeply furrowed, in place of the aspen's white. The bark is the ash model's own (the same atlas layout: the bark from
// u 0.8, round the trunk), greyed, paled and warmed a little, its furrows deepened; the leaves are the aspen's
function cottonwoodBark(mat, barkMap) {
  const { uv, vec3, vec4, mix, dot, texture, materialColor } = window.CITY.TSL;
  const base = mat.colorNode || materialColor, t = uv();
  const ash = texture(barkMap, t).rgb, lum = dot(ash, vec3(0.299, 0.587, 0.114));
  // (greyer, paler and a little warmer than the ash's, its furrows deepened: an old cottonwood's grey-brown ridges)
  const bark = mix(vec3(lum), ash, 0.75).mul(vec3(1.15, 1.07, 0.94)).mul(lum.mul(3.0).add(0.75));
  mat.colorNode = vec4(t.x.greaterThanEqual(0.8).select(bark, base.rgb), base.a);
  mat.roughness = 1;
  mat.name = mat.name.replace('_lodfade', '_cottonwood_lodfade');
  return mat;
}
// (variants: [id, the model whose geometry and leaves it takes, the model whose bark, the bark's treatment])
const VARIANTS = [['ez-cottonwood-medium', 'ez-aspen-medium', 'ez-ash-medium', cottonwoodBark], ['ez-cottonwood-large', 'ez-aspen-large', 'ez-ash-large', cottonwoodBark]];

/**
 * Loads the EZ-Tree models and builds the field for the City's street trees plus `generated` ({ x, y, z, scale,
 * species, tier } from street-details.js, in mrdoob's species & scales). Returns { group, update } or null when the
 * models can't load (street-details.js then falls back to mrdoob's trees).
 */
async function buildEzTrees(scene, generated) {
  const { GEO, CITY_BOUNDS, blockAt, createLeafAtlas, buildTreeGeometries, TREE_SPECIES, createTreeMaterial } = window.CITY;
  const { GLTFLoader, MeshoptDecoder } = window.CITY.Addons;
  const ids = (GEO.treeModels || []).map(([id]) => id);
  const heights = (GEO.treeModels || []).map(([, h]) => h);
  if (!ids.length || !GLTFLoader || !MeshoptDecoder) return null;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let models;
  try {
    models = await Promise.all(ids.map(async (id) => {
      const gltf = await loader.loadAsync(`./assets/trees/${id}.glb`);
      let near = null, mid = null;
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (o.name.startsWith('mid') || (o.parent && o.parent.name.startsWith('mid'))) mid = o;
        else if (!near) near = o;
      });
      mid = mid || near;
      return { id, near: bakedGeometry(near), mid: bakedGeometry(mid), material: fadeMaterial(near.material, !id.includes('pine')), src: near.material };
    }));
    // (variants: a model's geometry in another bark, for the parks that name them: park-woods-parks.mjs modelNames)
    for (const [id, base, barkOf, bark] of VARIANTS) {
      const b = ids.indexOf(base), k = ids.indexOf(barkOf);
      if (b < 0 || k < 0 || !models[k].src.map) continue;
      ids.push(id); heights.push(heights[b]);
      models.push({ id, near: models[b].near, mid: models[b].mid, material: bark(fadeMaterial(models[b].src, true), models[k].src.map), src: models[b].src });
    }
  } catch (e) {
    console.warn('[ezTrees] models did not load, mrdoob\'s trees stay:', e);
    return null;
  }
  // the broadleaf models' impostors (tree-impostors.js), baked by main.js once the renderer can draw (bakeImpostors)
  const impostors = IMP_ON ? window.CITY.treeImpostors.createImpostors(models.filter((m) => !m.id.includes('pine')), CANOPY_ON ? canopyGrade : null, treeRndNode) : null;
  const impOf = impostors ? models.map((m) => impostors.models.indexOf(m)) : models.map(() => -1);
  const impMaterial = impostors ? impostors.material(viewer, FADE ? lodKeep : null) : null;
  const impGeometry = impostors ? impostors.geometry() : null;
  // (the shadow-only stand-in: the impostor's quad facing the sun, in the shadow maps only; PROXY)
  const impShadowMaterial = impostors && PROXY ? impostors.material(viewer, lodKeep, { shadowProxy: true }) : null;

  // mrdoob's whole-crown cards for the far level, one per species, scaled to each tree's height
  const atlas = createLeafAtlas();
  const farMaterial = createTreeMaterial(atlas.texture);
  if (FADE) {
    farMaterial.maskNode = lodKeep;
    farMaterial.maskShadowNode = farMaterial.maskShadowNode ? farMaterial.maskShadowNode.and(lodKeep) : lodKeep;
  }
  const farGeos = TREE_SPECIES.map((_, s) => buildTreeGeometries(s, 0, atlas.tileMeters)[2]);
  const farHeight = farGeos.map((g) => { g.computeBoundingBox(); return g.boundingBox.max.y - g.boundingBox.min.y; });
  // mrdoob's tree at scale 1 is as tall as his near mesh: generated trees keep the height they would have had
  const slopHeight = (() => {
    const g = buildTreeGeometries(0, 0, atlas.tileMeters)[0];
    g.computeBoundingBox();
    return g.boundingBox.max.y - g.boundingBox.min.y;
  })();

  // Sites: the City's street trees, then the invented ones as the nearest EZ-Tree model
  const sites = [];
  // (a tree on a road cut's grassed bank, city-config.js treeOffRail lets it stand there: down on the slope, never over the
  // street level; on High Park's relief, which rises over it, on the ground: js/don-valley.js clearsTerrainAt marks its box)
  const cutDown = (x, z) => {
    const c = window.CITY.cutAt ? window.CITY.cutAt(x, z) : 0, P = window.CITY.DON_VALLEY;
    return P && P.clearsTerrainAt && P.clearsTerrainAt(x, z) ? c : Math.min(0, c);
  };
  const ST = GEO.streetTrees || [];
  let offRail = 0;
  for (let i = 0; i < ST.length; i += 4) {
    const x = ST[i], z = ST[i + 1];
    if (window.CITY.biidaasigeParkExcludesTree?.(x,z,ST[i+2],ST[i+3])) continue;
    // (none in the rail corridor, on its embankments or under its bridges: city-config.js treeOffRail)
    if (!window.CITY.treeOffRail(x, z)) { offRail++; continue; }
    if (window.CITY.bikeShareAt && window.CITY.bikeShareAt(x, z)) continue; // (none in a Bike Share station: bike-share.js)
    if (window.CITY.highParkBuildingAt?.(x, z, 1.5)) continue; // (none in Colborne Lodge: high-park-features.js)
    sites.push({ x, y: (blockAt(x, z) ? CITY_BOUNDS.sidewalkHeight : 0) + cutDown(x, z), z, model: ST[i + 2], height: ST[i + 3] / 10, tier: 1 });
  }
  const genModel = (sp, h) => {
    const big = h > 15 ? 2 : h > 9 ? 1 : 0;
    if (sp === 1) return ids.indexOf(['ez-ash-small', 'ez-ash-medium', 'ez-ash-large'][big]);
    if (sp === 2) return ids.indexOf(big ? 'ez-aspen-large' : 'ez-aspen-medium');
    return ids.indexOf(['ez-oak-small', 'ez-oak-medium', 'ez-oak-large'][big]);
  };
  let inWoods = 0;
  const generatedStart = sites.length;
  // Source tree points replace only nearby generic scatter. Reconcile before converting
  // raw sites: after conversion every site has a model, losing that distinction.
  const residential = window.CITY.islandResidentialCanopySites?.(generated) || [];
  // The QCYC marina scope (st-sb3r.36): City Tree Points inside the OSM marina polygon. Deduped against the same
  // preserved mapped trees AND the residential source sites, so a tree in both scopes is drawn once. Absent data or a
  // mismatched frame yields an empty list (a no-op), exactly like the residential source.
  const marinaCanopy = window.CITY.islandMarinaCanopySites?.(generated, residential) || [];
  const mappedCanopy = [...residential, ...marinaCanopy];
  if (mappedCanopy.length) {
    const reconciled = window.CITY.islandResidentialCanopyReconcile(mappedCanopy, generated);
    generated = [...reconciled.kept, ...mappedCanopy];
    window.CITY.islandResidentialCanopyEzStats = {
      added: mappedCanopy.length,
      residential: residential.length,
      marina: marinaCanopy.length,
      generatedReconciled: reconciled.removedCount,
      sourceIds: mappedCanopy.map(t => t.oid),
      sites: mappedCanopy.map(t => ({ x: t.x, z: t.z, height: t.height, oid: t.oid }))
    };
  }
  // st-sb3r.38: for accepted dinghy placements, drop only GENERIC scatter whose trunk intrudes a placed hull's exact oriented
  // footprint (plus 0.25 m) — the sapling intersecting a hull. Mapped/source trees (which carry a model, height, oid/
  // sourceId or htoPlan, or are the residential/marina canopy, or the wooded parks' lidar trees naming their model) are
  // preserved; a mapped trunk over a hull is reported as a conflict, never erased. The keep-out is a pure, frame-safe test
  // (no-op on a mismatched frame), and ?dinghies=0 disables both hulls and reconciliation.
  const dinghyKeepoutOn = window.CITY.waterfrontDinghiesEnabled?.() === true;
  const isMappedOrSource = window.CITY.waterfrontDinghyIsMappedTree || ((t) => !!(t && (t.model || Number.isFinite(t.height) || t.oid != null || t.sourceId != null || t.htoPlan || t.residentialCanopy || t.woods)));
  let dinghyScatterDropped = 0, dinghyMappedConflicts = 0;
  for (const t of generated) {
    if (window.CITY.bikeShareAt && window.CITY.bikeShareAt(t.x, t.z)) continue;
    if (dinghyKeepoutOn) {
      const keep = window.CITY.waterfrontDinghyKeepout?.(t.x, t.z, 0.25);
      if (keep && keep.inside) {
        if (isMappedOrSource(t)) { dinghyMappedConflicts++; }
        else { dinghyScatterDropped++; continue; }
      }
    }
    // (the wooded parks' lidar trees name their model, height and crown radius: park-woods.js)
    const h = t.height || t.scale * slopHeight, named = t.model ? ids.indexOf(t.model) : -1;
    sites.push({ x: t.x, y: (t.y || 0) + cutDown(t.x, t.z), z: t.z, model: named >= 0 ? named : genModel(t.species || 0, h), height: h, tier: t.tier || 0, width: t.width || 0, woods: !!t.woods });
    if (t.woods) inWoods++;
  }
  // HTO: the captain-digitized ASLA plan tree symbols, already registered with the module's plan homographies and
  // clipped to the rendered berms there. They join the same shared EZ instancing field as every other tree. Generated
  // scatter within 2.5 m of an explicit plan tree is reconciled away; mapped City trunks are never removed.
  const htoPlanSites = window.CITY.htoLandscapePlanTreeSites?.() || [];
  if (htoPlanSites.length) {
    const generatedSlice = sites.slice(generatedStart);
    const reconcile = window.CITY.htoPlanTreeReconcileGenerated
      ? window.CITY.htoPlanTreeReconcileGenerated(htoPlanSites, generatedSlice, 2.5)
      : { kept: generatedSlice, removed: [], removedCount: 0 };
    if (reconcile.removedCount) {
      sites.length = generatedStart;
      for (const t of reconcile.kept) sites.push(t);
    }
    for (const t of htoPlanSites) {
      const m = ids.indexOf(t.model);
      sites.push({ x: t.x, y: t.y, z: t.z, model: m >= 0 ? m : genModel(0, t.height), height: t.height, tier: 0, htoPlan: true, sourceId: t.sourceId });
    }
    window.CITY.htoPlanTreeEzStats = {
      added: htoPlanSites.length, generatedReconciled: reconcile.removedCount,
      candidates: window.CITY.htoLandscapePlanTrees?.counts?.candidate ?? null,
      accepted: window.CITY.htoLandscapePlanTrees?.counts?.accepted ?? null,
      rejected: window.CITY.htoLandscapePlanTrees?.counts?.rejected ?? null
    };
  }
  // Mapped and generated trees share this exclusion: a trunk cannot stand inside
  // a new timber deck. The helper checks the active frame before using its footprint.
  if (window.CITY.waterfrontDeckFootprintAt || window.CITY.gardenStructureKeepoutAt) {
    for (let i = sites.length - 1; i >= 0; i--) {
      const { x, z } = sites[i];
      if (window.CITY.waterfrontDeckFootprintAt?.(x, z, 0.25)
        || window.CITY.gardenStructureKeepoutAt?.(x, z, 0.25)) sites.splice(i, 1);
    }
  }
  // Keep mapped trunks rooted on the rendered waterfront landforms.
  if (window.CITY.waterfrontBeachLandscapeEnabled || window.CITY.waterfrontHtoLandscapeEnabled) {
    for (const site of sites) {
      const h = window.CITY.waterfrontBeachLandscapeHeightAt?.(site.x, site.z);
      if (Number.isFinite(h)) site.y = Math.max(site.y, h);
      const hto = window.CITY.htoLandscapeSurfaceAt?.(site.x, site.z);
      if (hto && Number.isFinite(hto.h)) site.y = Math.max(site.y, hto.h);
    }
  }
  // (High Park: the City's trees piled on one address point, all but one, its lidar crowns standing for them)
  const piled = window.CITY.parkWoods ? window.CITY.parkWoods.dropPiledCityTrees(sites) : 0;
  // a few on the road cuts' grassed banks (Rosedale Valley Road: the ravine's wooded sides), every ~11 m where a bank is
  // over 6 m wide, partway up it (11 m or more from the road's middle)
  let onBanks = 0;
  for (const c of window.CITY.ROAD_CUTS || []) {
    if (!c.bankSt) continue;
    for (let s = 6; s < c.len; s += 11) {
      for (const sg of [1, -1]) {
        const bk = window.CITY.cutBankAt(c, s, sg);
        if (!bk || bk.w < 6) continue;
        const r = Math.abs(Math.sin(s * 12.9898 + sg * 78.233) * 43758.5453) % 1;
        const q = window.CITY.cutAxisAt(c, s + (r - 0.5) * 4), o = c.half + 0.3 + bk.w * (0.35 + 0.35 * r);
        const x = q.x + q.nx * sg * o, z = q.z + q.nz * sg * o;
        if (!window.CITY.treeOffRail(x, z)) continue;
        const height = 9 + 6 * r;
        sites.push({ x, y: (blockAt(x, z) ? CITY_BOUNDS.sidewalkHeight : 0) + cutDown(x, z), z, model: genModel(onBanks % 3, height), height, tier: 0 });
        onBanks++;
      }
    }
  }

  // each model's crown radius at its own height (half its near mesh's mean width), for the trees that name a width
  const crownR = models.map((m) => { const b = m.near.boundingBox; return (b.max.x - b.min.x + b.max.z - b.min.z) / 4; });
  const group = new THREE.Group();
  group.name = 'Trees';
  const N = sites.length;
  const matsNear = new Float32Array(N * 16); // EZ-Tree meshes (near & mid)
  const matsFar = new Float32Array(N * 16); // the far crown, scaled to the same height
  const farData = new Float32Array(N * 4);
  const tints = new Float32Array(N * 3);
  const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  const meshOf = new Int16Array(N * 3);
  const treeModel = new Int16Array(N); // (each tree's model: its shadow stand-in's mesh)
  const midFarOf = new Int16Array(N);
  const tier = new Uint8Array(N);
  const isPine = new Uint8Array(N);
  const cls = new Uint8Array(N); // tree class: tier * 2 + pine, WOODS_CLASS or IMP_CLASS (the hand-over edges are the same within a class)
  const impData = new Float32Array(N * 4); // (IMP_CLASS: the impostor's frame width and height (m), its model, a random)
  const levels = new Uint8Array(N); // bit L: drawn at level L (both levels inside a hand-over band)
  const meshes = [];
  const make = (geo, material, name, attrs, noShadow, imp = false) => { meshes.push({ geo, material, name, capacity: 0, attrs, noShadow, imp }); return meshes.length - 1; };
  const idxNear = models.map((m) => make(m.near, m.material, `Trees_${m.id}_near`));
  const idxMid = models.map((m) => make(m.mid, m.material, `Trees_${m.id}_mid`));
  const idxMidFar = models.map((m) => make(m.mid, m.material, `Trees_${m.id}_mid_noshadow`, false, true));
  const idxFar = farGeos.map((g, s) => make(g, farMaterial, `Trees_far_${TREE_SPECIES[s].name}`, true));
  const idxImp = models.map((m, k) => (impOf[k] >= 0 ? make(impGeometry, impMaterial, `Trees_${m.id}_impostor`, false, true, true) : -1));
  const idxImpShadow = models.map((m, k) => (impOf[k] >= 0 && impShadowMaterial ? make(impGeometry, impShadowMaterial, `Trees_${m.id}_impostor_shadow`, false, false, true) : -1));
  let impTrees = 0;
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  sites.forEach((t, i) => {
    const m = Math.max(0, t.model);
    treeModel[i] = m;
    const r1 = hashPos(t.x, 1.3, t.z), r2 = hashPos(t.z, 7.1, t.x), r3 = hashPos(t.x + t.z, 3.3, 0.7);
    const yaw = r2 * Math.PI * 2;
    // (the pilot's lidar trees a little less even: VARY_ON)
    const vary = VARY_ON && t.width > 0 && inPilot(t.x, t.z);
    if (vary) {
      const r4 = hashPos(t.z, 5.9, t.x), r5 = hashPos(t.x, 9.1, t.z), off = Math.min(1.2, 0.25 * t.width) * r4, a = r5 * Math.PI * 2;
      const nx = t.x + Math.cos(a) * off, nz = t.z + Math.sin(a) * off;
      if (!(window.CITY.highParkFeatureAt && window.CITY.highParkFeatureAt(nx, nz, 1.5))) { t.x = nx; t.z = nz; }
    }
    const s = (t.height / heights[m]) * (vary ? 0.86 + r1 * 0.28 : 0.92 + r1 * 0.16);
    // (a tree with its crown's width, from the lidar: the crown spread to it, within reason)
    const wf = t.width ? Math.max(0.75, Math.min(1.35, t.width / (crownR[m] * s))) : 1;
    dummy.position.set(t.x, t.y, t.z);
    // (a lean of up to 4 degrees, for the pilot's varied trees)
    if (vary) dummy.rotation.set((hashPos(t.x, 2.1, t.z) - 0.5) * 0.14, yaw, (hashPos(t.z, 4.3, t.x) - 0.5) * 0.14, 'YXZ');
    else dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(s * wf * (0.93 + r3 * 0.14), s, s * wf * (0.93 + r1 * 0.14));
    dummy.updateMatrix();
    dummy.matrix.toArray(matsNear, i * 16);
    const sp = FAR_SPECIES(models[m].id);
    isPine[i] = sp < 0 ? 1 : 0;
    if (sp >= 0) {
      const fs = t.height / farHeight[sp];
      dummy.scale.set(fs * wf, fs, fs * wf);
      dummy.updateMatrix();
      dummy.matrix.toArray(matsFar, i * 16);
      // (the woods' cards a little darker: closed canopy, and they stand beside the woods' mid meshes from nearer)
      tint.setHex(TREE_SPECIES[sp].tints[Math.floor(r3 * 2.999)]).multiplyScalar((0.82 + r1 * 0.36) * (t.woods ? 0.85 : 1));
      farData.set([tint.r, tint.g, tint.b, sp + r2 * 0.999], i * 4);
    }
    // a little colour between trees of one model, so a street doesn't read as copies
    tints.set([0.86 + r1 * 0.2, 0.88 + r3 * 0.16, 0.86 + r2 * 0.18], i * 3);
    px[i] = t.x; py[i] = t.y + t.height * 0.5; pz[i] = t.z;
    tier[i] = Math.min(2, t.tier);
    const imp = t.woods && !isPine[i] && idxImp[m] >= 0 && inImpRollout(t.x, t.z);
    cls[i] = imp ? IMP_CLASS : t.woods && !isPine[i] ? WOODS_CLASS : tier[i] * 2 + isPine[i];
    meshOf[i * 3] = idxNear[m];
    meshOf[i * 3 + 1] = idxMid[m];
    meshOf[i * 3 + 2] = imp ? idxImp[m] : sp >= 0 ? idxFar[sp] : idxMid[m];
    meshes[idxNear[m]].capacity++;
    meshes[idxMid[m]].capacity++;
    midFarOf[i] = idxMidFar[m];
    meshes[idxMidFar[m]].capacity++;
    if (imp) {
      // (the impostor's frame at the tree's size: its model's frame by the height scale, widened as the crown is)
      const f = impostors.frames[impOf[m]];
      impData.set([f.w * s * wf, f.h * s, impOf[m], r2], i * 4);
      meshes[idxImp[m]].capacity++;
      if (idxImpShadow[m] >= 0) meshes[idxImpShadow[m]].capacity++;
      impTrees++;
    } else if (sp >= 0) meshes[idxFar[sp]].capacity++;
  });
  const instanced = meshes.map((m) => {
    const geo = new THREE.BufferGeometry();
    for (const name of Object.keys(m.geo.attributes)) geo.setAttribute(name, m.geo.attributes[name]);
    geo.setIndex(m.geo.index);
    geo.boundingSphere = m.geo.boundingSphere;
    const cap = Math.max(1, m.capacity);
    if (m.attrs) geo.setAttribute('aTreeData', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    if (m.imp) geo.setAttribute('aImp', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('aLodOrigin', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    geo.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('aLodShadow', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
    const mesh = new THREE.InstancedMesh(geo, m.material, cap);
    if (!m.attrs) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.name = m.name;
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false; // instances surround the camera: the per-tree levels do the culling
    mesh.castShadow = !m.attrs && !m.noShadow; // the far crowns stand past the shadow cascades
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  });
  // The hand-over edges per tree class, at street level (index 1) and aloft (0): per level [edge in, band in, edge
  // out, band out] as float32s (what aLodFade carries), and the distances where a class's level set changes
  const classFades = [new Float32Array(CLASSES * 12), new Float32Array(CLASSES * 12)];
  const classEdges = [[], []];
  for (let lowIdx = 0; lowIdx < 2; lowIdx++) {
    const low = lowIdx === 1;
    for (let c = 0; c < CLASSES; c++) {
      const tr = isWoods(c) ? 0 : c >> 1, pine = isWoods(c) ? 0 : c & 1;
      const near = nearOf(c), mid = midOf(c, low);
      let maxD = low ? Math.min(MAX_DIST[tr], LOW_CUTOFF) : MAX_DIST[tr];
      if (pine) maxD = Math.min(maxD, PINE_FAR);
      // [edge in, band in, edge out, band out] per level; pines have no far level (their mid mesh goes out to maxD)
      const f = classFades[lowIdx];
      const o = c * 12;
      f[o] = ALL_IN; f[o + 1] = 1; f[o + 2] = near; f[o + 3] = BAND[0];
      f[o + 4] = near; f[o + 5] = BAND[0];
      if (pine) { f[o + 6] = maxD; f[o + 7] = BAND[2]; f[o + 8] = ALL_OUT; f[o + 9] = 1; f[o + 10] = ALL_OUT; f[o + 11] = 1; }
      // (the pilot's impostors match their mesh in colour and form: a narrow hand-over, 6 m, so fewer trees stand
      // half-dissolved in the screen-door dither at once; the cards' 24 m band stays for the other classes)
      else { const bm = c === IMP_CLASS && FADE ? 6 : BAND[1]; f[o + 6] = mid; f[o + 7] = bm; f[o + 8] = mid; f[o + 9] = bm; f[o + 10] = maxD; f[o + 11] = BAND[2]; }
      const edges = [shadowOut(c)];
      for (let l = 0; l < 3; l++) edges.push(f[o + l * 4] - f[o + l * 4 + 1] * 0.5 - MARGIN, f[o + l * 4 + 2] + f[o + l * 4 + 3] * 0.5 + MARGIN);
      classEdges[lowIdx][c] = edges;
    }
  }
  // The levels a tree of class c draws at distance d (bit 3: the mid level without a shadow)
  function levelBits(f, c, d) {
    const o = c * 12;
    let bits = 0;
    for (let l = 0; l < 3; l++) {
      const lo = f[o + l * 4] - f[o + l * 4 + 1] * 0.5 - MARGIN, hi = f[o + l * 4 + 2] + f[o + l * 4 + 3] * 0.5 + MARGIN;
      if (d >= lo && d < hi) bits |= 1 << l;
    }
    if (bits & 2 && d > shadowOut(c)) bits |= 8;
    return bits;
  }

  // The cells: their trees, a sphere round their trees' middles, their classes and the sorted edges of those classes
  const cellMap = new Map();
  for (let i = 0; i < N; i++) {
    const key = (Math.floor(px[i] / LOD_CELL) + 32768) * 65536 + (Math.floor(pz[i] / LOD_CELL) + 32768);
    let list = cellMap.get(key);
    if (!list) cellMap.set(key, list = []);
    list.push(i);
  }
  const cells = Array.from(cellMap.values(), (list) => {
    const trees = Int32Array.from(list);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, mask = 0;
    for (const i of trees) {
      x0 = Math.min(x0, px[i]); x1 = Math.max(x1, px[i]);
      y0 = Math.min(y0, py[i]); y1 = Math.max(y1, py[i]);
      z0 = Math.min(z0, pz[i]); z1 = Math.max(z1, pz[i]);
      mask |= 1 << cls[i];
    }
    const x = (x0 + x1) * 0.5, y = (y0 + y1) * 0.5, z = (z0 + z1) * 0.5;
    let r2 = 0;
    for (const i of trees) r2 = Math.max(r2, (px[i] - x) ** 2 + (py[i] - y) ** 2 + (pz[i] - z) ** 2);
    const classes = Array.from({ length: CLASSES }, (_, c) => c).filter((c) => mask & (1 << c));
    const edges = [0, 1].map((lowIdx) => Float64Array.from(new Set(classes.flatMap((c) => classEdges[lowIdx][c]))).sort());
    // sig: the cell's level bits, 4 per class (bits 4c..4c+3), while every tree of a class shares them; -1 otherwise
    return { trees, x, y, z, r: Math.sqrt(r2) + 1e-3, classes, edges, sig: 0, inView: true };
  });

  const cellOf = new Array(N); // (each tree's cell)
  for (const cell of cells) for (const i of cell.trees) cellOf[i] = cell;
  const counts = new Int32Array(instanced.length);
  let fadesNow = classFades[0];
  // (for captures: how often the instances were regrouped, the view cone re-cut, and the last regroup's CPU time)
  const stats = { rebuilds: 0, recuts: 0, lastRebuildMs: 0, viewCull: VIEW_CULL, sorted: null };
  // Each level's instances go to its mesh nearest first when SORT is on: the trees are drawn front to back, so the leaves
  // of the trees behind fail the depth test before their (alpha-tested) shading instead of after it (st-usbd). The
  // image is the same. ?treesort=0 keeps the cells' order, for A/B
  const SORT = new URLSearchParams(location.search).get('treesort') !== '0';
  // (a counting sort on the distance in 4 m steps: linear in the trees drawn, ~20,000 of them from the woods)
  const BUCKET = 4, BUCKETS = 1024;
  let order = new Int32Array(1024), sorted = new Int32Array(1024);
  const key = new Uint16Array(N), bucketStart = new Int32Array(BUCKETS + 1);
  function put(i, l, bits, F) {
    const mi = l === 1 && bits & 8 ? midFarOf[i] : meshOf[i * 3 + l];
    const mesh = instanced[mi];
    const c = counts[mi]++;
    const far = meshes[mi].attrs;
    const a = mesh.geometry.attributes;
    const src = far ? matsFar : matsNear, dst = mesh.instanceMatrix.array;
    for (let j = 0; j < 16; j++) dst[c * 16 + j] = src[i * 16 + j];
    if (far) { const t = a.aTreeData.array; t[c * 4] = farData[i * 4]; t[c * 4 + 1] = farData[i * 4 + 1]; t[c * 4 + 2] = farData[i * 4 + 2]; t[c * 4 + 3] = farData[i * 4 + 3]; }
    else { const t = mesh.instanceColor.array; t[c * 3] = tints[i * 3]; t[c * 3 + 1] = tints[i * 3 + 1]; t[c * 3 + 2] = tints[i * 3 + 2]; }
    if (meshes[mi].imp) a.aImp.array.set(impData.subarray(i * 4, i * 4 + 4), c * 4);
    const og = a.aLodOrigin.array;
    og[c * 3] = px[i]; og[c * 3 + 1] = py[i]; og[c * 3 + 2] = pz[i];
    const fd = a.aLodFade.array, fl = cls[i] * 12 + l * 4;
    fd[c * 4] = F[fl]; fd[c * 4 + 1] = F[fl + 1]; fd[c * 4 + 2] = F[fl + 2]; fd[c * 4 + 3] = F[fl + 3];
    if (a.aLodShadow) {
      // (the mid level that casts: its shadow's band; the near level and the twin: (0, 0))
      const b = l === 1 && !(bits & 8) ? shadowBand(cls[i]) : 0, sh = a.aLodShadow.array;
      sh[c * 2] = b > 0 ? shadowMid(cls[i]) - b * 0.5 : 0; sh[c * 2 + 1] = b > 0 ? 1 / b : 0;
    }
  }
  // the shadow stand-in of tree i (IMP_CLASS, PROXY): in from the mid mesh's shadow band, out at PROXY_FAR
  function putProxy(i) {
    const mi = idxImpShadow[Math.max(0, treeModel[i])];
    if (mi < 0) return;
    const mesh = instanced[mi], c = counts[mi]++, a = mesh.geometry.attributes;
    mesh.instanceMatrix.array.set(matsNear.subarray(i * 16, i * 16 + 16), c * 16);
    mesh.instanceColor.array.set(tints.subarray(i * 3, i * 3 + 3), c * 3);
    a.aImp.array.set(impData.subarray(i * 4, i * 4 + 4), c * 4);
    a.aLodOrigin.array.set([px[i], py[i], pz[i]], c * 3);
    a.aLodFade.array.set([shadowMid(cls[i]), shadowBand(cls[i]), PROXY_FAR, PROXY_BAND], c * 4);
    a.aLodShadow.array.set([0, 0], c * 2);
  }
  const PROXY_REACH = PROXY_FAR + PROXY_BAND * 0.5 + 40;
  function rebuild() {
    const t0 = performance.now();
    counts.fill(0);
    const F = fadesNow;
    let n = 0;
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      if (cell.sig === 0) continue; // (nothing drawn)
      const outOfView = !cell.inView;
      const trees = cell.trees;
      for (let k = 0; k < trees.length; k++) {
        const i = trees[k];
        const bits = levels[i];
        if (!bits) continue;
        // (a level that casts no shadow out of the view cone can't be in the frame: the mid mesh beyond its shadow
        // distance, the cards)
        const proxy = PROXY && cls[i] === IMP_CLASS && bits & 6;
        if (outOfView && !proxy && !(bits & 1) && (!(bits & 2) || bits & 8)) continue;
        if (n === order.length) { const o = new Int32Array(n * 2); o.set(order); order = o; sorted = new Int32Array(n * 2); }
        order[n++] = i;
        if (SORT) {
          const dx = px[i] - cam.x, dy = py[i] - cam.y, dz = pz[i] - cam.z;
          key[i] = Math.min(BUCKETS - 1, Math.sqrt(dx * dx + dy * dy + dz * dz) / BUCKET) | 0;
        }
      }
    }
    let list = order;
    if (SORT) {
      bucketStart.fill(0);
      for (let k = 0; k < n; k++) bucketStart[key[order[k]] + 1]++;
      for (let b = 0; b < BUCKETS; b++) bucketStart[b + 1] += bucketStart[b];
      for (let k = 0; k < n; k++) { const i = order[k]; sorted[bucketStart[key[i]]++] = i; }
      list = sorted;
    }
    for (let k = 0; k < n; k++) {
      const i = list[k];
      const bits = levels[i];
      const outOfView = !cellOf[i].inView;
      for (let l = 0; l < 3; l++) {
        if (!(bits & (1 << l))) continue;
        if (outOfView && (l === 2 || (l === 1 && bits & 8))) continue; // (casts no shadow, can't be in the frame)
        put(i, l, bits, F);
      }
      if (PROXY && cls[i] === IMP_CLASS && bits & 6) {
        const dx = px[i] - cam.x, dz = pz[i] - cam.z;
        if (dx * dx + dz * dz < PROXY_REACH * PROXY_REACH) putProxy(i);
      }
    }
    instanced.forEach((mesh, mi) => {
      const n = counts[mi];
      if (n > 0) {
        const a = mesh.geometry.attributes;
        const extra = meshes[mi].attrs ? a.aTreeData : mesh.instanceColor;
        for (const attr of [mesh.instanceMatrix, extra, a.aLodOrigin, a.aLodFade, ...(meshes[mi].imp ? [a.aImp] : []), ...(a.aLodShadow ? [a.aLodShadow] : [])]) {
          attr.clearUpdateRanges();
          attr.addUpdateRange(0, n * attr.itemSize);
          attr.needsUpdate = true;
        }
      }
      mesh.count = n;
      mesh.visible = n > 0;
    });
    stats.rebuilds++;
    stats.sorted = SORT;
    stats.lastRebuildMs = performance.now() - t0;
  }
  const last = new V3(Infinity, Infinity, Infinity);
  const cam = new V3();
  let lastLow = null;
  // The view cone (VIEW_CULL): its axis, the cosine of the camera's turn since it was cut, its half angle
  const fwd = new V3(), cutFwd = new V3(), cutAt = new V3(Infinity, Infinity, Infinity);
  let cutFov = 0, cutAspect = 0;
  const cosRecut = Math.cos(RECUT);
  // Re-cuts the cone when the camera has turned by RECUT, moved, or zoomed: true when a cell's view changed
  function cutView(camera) {
    camera.getWorldDirection(fwd);
    if (fwd.dot(cutFwd) >= cosRecut && camera.fov === cutFov && camera.aspect === cutAspect && cam.distanceToSquared(cutAt) < 16) return false;
    cutFwd.copy(fwd); cutAt.copy(cam); cutFov = camera.fov; cutAspect = camera.aspect;
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const half = Math.atan(Math.hypot(tanV, tanV * camera.aspect)) + VIEW_MARGIN;
    let viewChanged = false;
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      const ex = cell.x - cam.x, ey = cell.y - cam.y, ez = cell.z - cam.z;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez), pad = cell.r + CROWN_PAD;
      const inView = half >= Math.PI || d <= pad ||
        Math.acos(Math.max(-1, Math.min(1, (ex * fwd.x + ey * fwd.y + ez * fwd.z) / d))) <= half + Math.asin(pad / d);
      if (inView !== cell.inView) {
        cell.inView = inView;
        if (cell.sig !== 0) viewChanged = true;
      }
    }
    if (viewChanged) stats.recuts++;
    return viewChanged;
  }
  function update(position, camera = null) {
    cam.copy(position);
    const viewChanged = VIEW_CULL && camera ? cutView(camera) : false;
    if (cam.distanceToSquared(last) < 16) {
      if (viewChanged) rebuild();
      return viewChanged;
    }
    last.copy(cam);
    const low = cam.y < 40;
    let changed = low !== lastLow; // the far edges move with the camera's height: every tree's bands change
    lastLow = low;
    const lowIdx = low ? 1 : 0;
    const F = fadesNow = classFades[lowIdx];
    const cx = cam.x, cy = cam.y, cz = cam.z;
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      const ex = cell.x - cx, ey = cell.y - cy, ez = cell.z - cz;
      const dc = Math.sqrt(ex * ex + ey * ey + ez * ez);
      const dMin = dc - cell.r, dMax = dc + cell.r;
      const edges = cell.edges[lowIdx];
      let straddles = false;
      for (let k = 0; k < edges.length; k++) {
        const e = edges[k];
        if (e > dMax) break;
        if (e >= dMin) { straddles = true; break; }
      }
      if (!straddles) {
        // no edge between the cell's nearest and furthest tree: each class has one level set throughout
        let sig = 0;
        for (let k = 0; k < cell.classes.length; k++) sig |= levelBits(F, cell.classes[k], dc) << (cell.classes[k] * 4);
        if (sig === cell.sig) continue;
        cell.sig = sig;
        const trees = cell.trees;
        for (let k = 0; k < trees.length; k++) {
          const i = trees[k];
          const bits = (sig >> (cls[i] * 4)) & 15;
          if (bits !== levels[i]) { levels[i] = bits; changed = true; }
        }
        continue;
      }
      cell.sig = -1;
      const trees = cell.trees;
      for (let k = 0; k < trees.length; k++) {
        const i = trees[k];
        const dx = px[i] - cx, dy = py[i] - cy, dz = pz[i] - cz;
        const bits = levelBits(F, cls[i], Math.sqrt(dx * dx + dy * dy + dz * dz));
        if (bits !== levels[i]) { levels[i] = bits; changed = true; }
      }
    }
    if (changed || viewChanged) rebuild();
    return changed || viewChanged;
  }
  // follow the view camera of every scene render (the shadow cascades keep the view's levels)
  const viewPos = new V3();
  const prevBeforeRender = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, scn, camera, target) {
    prevBeforeRender.call(this, renderer, scn, camera, target);
    if (camera.isOrthographicCamera === true || camera.isArrayCamera === true) return;
    viewPos.setFromMatrixPosition(camera.matrixWorld);
    viewer.value.copy(viewPos);
    update(viewPos, camera.isPerspectiveCamera ? camera : null);
  };
  // levels for the start view, so the shader warm-up sees the tree meshes
  const start = (window.CITY.TELEPORT_LOCATIONS || {}).start || { x: 0, z: 0 };
  update(new V3(start.x, 10, start.z));
  // every tree mesh shows one instance deep underground until its first real use, so the start-up shader warm-up
  // (main.js) compiles all of them: a mesh seen for the first time mid-ride stalls the frame while it compiles
  const buried = new THREE.Matrix4().makeTranslation(0, -500, 0);
  instanced.forEach((mesh, mi) => {
    if (mesh.count > 0) return;
    mesh.setMatrixAt(0, buried);
    if (meshes[mi].attrs) mesh.geometry.attributes.aTreeData.array.set([1, 1, 1, 0], 0);
    else mesh.instanceColor.array.set([1, 1, 1], 0);
    mesh.geometry.attributes.aLodFade.array.set([ALL_IN, 1, ALL_OUT, 1], 0);
    mesh.geometry.attributes.aLodFade.needsUpdate = true;
    mesh.count = 1;
    mesh.visible = true;
    mesh.instanceMatrix.needsUpdate = true;
  });
  scene.add(group);
  if (impostors) {
    // (main.js: once the renderer can draw, before the shader warm-up)
    window.CITY.bakeTreeImpostors = (renderer) => impostors.bake(renderer);
    window.CITY.treeImpostorAtlases = impostors.atlases; // (captures: the baked atlases)
    stats.impostors = { trees: impTrees, models: impostors.models.length, state: impostors.state, mid: IMP_MID };
  }
  window.CITY.ezTreeDinghyStats = { enabled: dinghyKeepoutOn, scatterDropped: dinghyScatterDropped, mappedConflicts: dinghyMappedConflicts };
  console.info(`[ezTrees] ${N} trees (${ST.length / 4 - offRail} from the City's inventory, ${offRail} left out of the rail corridor, ${generated.length} in parks & yards (${inWoods} in the wooded parks' woods; ${piled} of the City's piled on one point in those parks left out), ${onBanks} on road cuts' banks), ${ids.length} models${impostors ? `; ${impTrees} woods trees with impostors beyond ${IMP_MID} m` : ''}`);
  window.CITY.treeStats = stats;
  return { group, update, stats };
}

Object.assign(window.CITY, { buildEzTrees, ezTreeMaterial: fadeMaterial }); // (the material: tests/seasons.test.mjs builds it)
})();
