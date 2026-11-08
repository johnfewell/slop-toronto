(function () {
// js/tree-impostors.js — lit impostors of the EZ-Tree models for the woods' far trees (docs/park-cover.md, bead st-annt.4)
// A woods tree past its mid level is one camera-facing quad (2 triangles) instead of its decimated mesh (~3,300) or
// mrdoob's crown card. Each broadleaf model is baked once at start-up (bake(), main.js, after the trees are built):
// the model's mid mesh seen from four elevations (0, 30, 60 and 90 degrees), into two atlases of 128 x 256 tiles:
// - albedo: the model's unlit colour (its glTF map and colour), alpha = coverage (4x MSAA: soft cut-out edges);
// - normals: the model-space normal (x 0.5 + 0.5), and in w how much of the texel is leaf (the seasons: leaves turn and
//   fall on the impostors as on the meshes, ez-trees.js seasonNodes).
// At runtime each quad faces the viewer, cross-fades between the two baked elevations nearest the view, and is lit by
// the scene's own lights with its baked normals turned to the view, so it matches the real tree from every side, in
// every light and under every sky. The trees' hand-over dissolve (ez-trees.js lodKeep) fades it in and out.
//
// After the impostors of threejs-nanites by Victor Zakharov (MIT, src/nanite-lib/impostors/atlas.ts and
// gpu/billboards.ts: the elevation tiles and their cross-fade, the frame round the trunk axis, the lit normal atlas;
// see CREDITS.md). Rewritten for this engine's instanced trees; no code of its GPU-driven culling.
const C = window.CITY;
const { THREE } = C;

const ELEV = [0, 30, 60, 90]; // (degrees; evenly spaced from 0)
const STEP = ELEV[1] - ELEV[0];
const TILE_W = 128, TILE_H = 256;
const COLS = 16;

/**
 * An atlas for `models` ({ id, mid: geometry, src: the glTF material }); `byId` maps each model's id to its tile
 * column block. Returns { models, frames, bake(renderer), material(fade, keepShadow), geometry(), baked }
 */
function createImpostors(models, grade = null, treeRndNode = null) {
  const n = models.length;
  const tiles = ELEV.length * n, rows = Math.ceil(tiles / COLS);
  const W = TILE_W * COLS, H = TILE_H * rows;
  const makeRT = (type) => new THREE.RenderTarget(W, H, {
    type, samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true
  });
  const albedoRT = makeRT(THREE.HalfFloatType), normalRT = makeRT(THREE.UnsignedByteType);
  albedoRT.texture.name = 'TreeImpostorAlbedo';
  normalRT.texture.name = 'TreeImpostorNormals';
  // each model's frame (m, at the model's own size): its width (twice its widest reach from the trunk axis, or half its
  // height) and height (twice that): the tile's quad, the tree's base at its bottom middle
  const frames = models.map((m) => {
    const p = m.mid.attributes.position;
    let r = 0, h = 0;
    for (let i = 0; i < p.count; i++) { r = Math.max(r, Math.abs(p.getX(i)), Math.abs(p.getZ(i))); h = Math.max(h, p.getY(i)); }
    const fw = Math.max(2 * r, h / 2) * 1.04;
    return { w: fw, h: fw * 2, treeH: h };
  });
  const state = { baked: false, ms: 0 };

  function bake(renderer) {
    if (state.baked) return;
    const t0 = performance.now();
    const { texture, uv, vec4, max, smoothstep, normalLocal, Fn, If, Discard, materialColor, float } = C.TSL;
    const prevTarget = renderer.getRenderTarget(), prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear, prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    for (const rt of [albedoRT, normalRT]) { renderer.setRenderTarget(rt); renderer.clear(); }
    renderer.autoClear = false;
    models.forEach((m, k) => {
      const src = m.src;
      const map = src.map;
      const tex = map ? texture(map, uv()) : vec4(1, 1, 1, 1);
      // (the leafness, as ez-trees.js seasonNodes reads it off the atlas: the green texels of the spray on the left)
      const green = tex.g.sub(max(tex.r, tex.b)).div(max(tex.g, 0.001));
      const leaf = smoothstep(0.12, 0.22, green).mul(uv().x.lessThan(0.7995).select(1.0, 0.0));
      const cut = (out) => Fn(() => { If(tex.a.lessThan(0.5), () => Discard()); return out; })();
      const albedo = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
      albedo.colorNode = cut(vec4(tex.rgb.mul(materialColor.rgb), 1));
      albedo.color.copy(src.color || new THREE.Color(1, 1, 1));
      const normal = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
      normal.colorNode = cut(vec4(normalLocal.normalize().mul(0.5).add(0.5), leaf));
      const geo = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv']) if (m.mid.attributes[name]) geo.setAttribute(name, m.mid.attributes[name]);
      geo.setIndex(m.mid.index);
      const scenes = [albedo, normal].map((mat) => { const s = new THREE.Scene(); s.add(new THREE.Mesh(geo, mat)); return s; });
      const { w: fw, h: fh } = frames[k];
      ELEV.forEach((deg, e) => {
        const a = THREE.MathUtils.degToRad(deg);
        const cam = new THREE.OrthographicCamera(-fw / 2, fw / 2, fh / 2, -fh / 2, 0, 400);
        // centred on the trunk axis at half the frame's height, from +z tilted up by the elevation: screen right = +x,
        // screen up = (0, cos e, -sin e)
        cam.position.set(0, fh / 2 + 200 * Math.sin(a), 200 * Math.cos(a));
        cam.up.set(0, Math.cos(a), -Math.sin(a));
        cam.lookAt(0, fh / 2, 0);
        cam.updateMatrixWorld();
        const t = e * n + k, col = t % COLS, row = Math.floor(t / COLS);
        [albedoRT, normalRT].forEach((rt, j) => {
          renderer.setRenderTarget(rt);
          rt.viewport.set(col * TILE_W, row * TILE_H, TILE_W, TILE_H);
          rt.scissor.set(col * TILE_W, row * TILE_H, TILE_W, TILE_H);
          rt.scissorTest = true;
          renderer.clearDepth();
          renderer.render(scenes[j], cam);
        });
      });
      albedo.dispose(); normal.dispose();
    });
    for (const rt of [albedoRT, normalRT]) { rt.scissorTest = false; rt.viewport.set(0, 0, W, H); }
    renderer.autoClear = prevAuto;
    renderer.toneMapping = prevTone;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    state.baked = true;
    state.ms = performance.now() - t0;
    console.info(`[treeImpostors] ${n} models baked at ${ELEV.join(', ')} degrees into ${W} x ${H} atlases in ${Math.round(state.ms)} ms`);
  }

  // The quad: 4 corners (aCorner: 0/1, 0/1) at the instance's origin (the instance matrix moves (0, 0, 0) to the tree's
  // base); the material spreads them
  function geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    return g;
  }

  /**
   * The impostors' material. Per instance: aImp = (frame width (m), frame height (m), model index, the tree's own
   * random 0..1); instanceColor its tint; `viewer` the view camera's position (ez-trees.js), `lodKeep` the hand-over
   * dissolve's mask
   */
  function material(viewer, lodKeep, { shadowProxy = false } = {}) {
    const T = C.TSL;
    const { attribute, positionLocal, vec2, vec3, vec4, float, normalize, cross, asin, clamp, smoothstep, mix, texture, varying,
      cameraViewMatrix, uniform, fract, sin, dot, max, abs, dFdx, dFdy, log2, select } = T;
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    mat.name = 'TreeImpostor';
    const imp = attribute('aImp', 'vec4'), corner = attribute('aCorner', 'vec2');
    const vUv = varying(vec2(0), 'vImpUv'), vBand = varying(vec2(0), 'vImpBand'), vModel = varying(float(0), 'vImpModel');
    const vRight = varying(vec3(1, 0, 0), 'vImpRight'), vDir = varying(vec3(0, 0, 1), 'vImpDir'), vRnd = varying(float(0), 'vImpRnd');
    // (the tree's own random as its meshes read it, ez-trees.js treeRndNode: the canopy grade and the seasons match at the hand-over)
    const vTree = varying(float(0), 'vImpTree');
    const nModels = float(n), cols = float(COLS), tileSize = vec2(TILE_W / W, TILE_H / H);
    // (the quad faces `eye`: the view camera's position for the impostor; for the shadow proxy, the direction to the sun
    // (the cascades are orthographic, along it): its elevation picks the bake's view, so the shadow is the crown as the
    // sun sees it)
    const place = (eye, isDir = false) => T.Fn(() => {
      const base = positionLocal; // (the instance matrix applied to (0, 0, 0): the tree's base)
      const fw = imp.x, fh = imp.y;
      const pivot = base.add(vec3(0, fh.mul(0.5), 0));
      const toV = isDir ? eye : eye.sub(pivot);
      const dir = normalize(toV);
      // (straight down: any right will do)
      const flat = vec3(dir.z, 0, dir.x.negate());
      const right = normalize(select(dot(flat, flat).greaterThan(1e-6), cross(vec3(0, 1, 0), dir), vec3(1, 0, 0)));
      const up = cross(dir, right);
      const elev = asin(clamp(dir.y, -1, 1)).mul(180 / Math.PI);
      const j = clamp(elev.sub(STEP / 2).div(STEP).round(), 0, ELEV.length - 2);
      const blend = smoothstep(STEP / 2 - 7.5, STEP / 2 + 7.5, elev.sub(j.mul(STEP)));
      vBand.assign(vec2(j, blend));
      vModel.assign(imp.z);
      vRnd.assign(imp.w);
      if (treeRndNode) vTree.assign(treeRndNode());
      // (a mirrored picture for half the trees, so neighbours don't read as copies)
      const flip = imp.w.greaterThan(0.5);
      const cx = select(flip, float(1).sub(corner.x), corner.x);
      vUv.assign(vec2(cx, corner.y));
      vRight.assign(select(flip, right.negate(), right));
      vDir.assign(dir);
      return pivot.add(right.mul(corner.x.sub(0.5).mul(fw))).add(up.mul(corner.y.sub(0.5).mul(fh)));
    })();
    if (shadowProxy) {
      // a shadow-only stand-in (ez-trees.js, st-annt.9): nothing in the view (the quad collapsed under the ground: no
      // fragments), the crown's picture facing the sun in the shadow maps
      mat.name = 'TreeImpostorShadow';
      mat.positionNode = vec3(0, -1e4, 0);
      mat.castShadowPositionNode = place(normalize(C.cityUniforms.uSkySunDir), true);
    } else mat.positionNode = place(viewer);
    // the two tiles' uv in the atlases (tile t = elevation * models + model, rows of COLS from the top; within a tile
    // the bake's up is towards v 0, as the render target's texture is sampled)
    const tileUv = (e) => {
      const t = e.mul(nModels).add(vModel);
      const col = t.mod(cols), row = t.div(cols).floor();
      return vec2(col.add(vUv.x), row.add(float(1).sub(vUv.y))).mul(tileSize);
    };
    const albedoTex = albedoRT.texture, normalTex = normalRT.texture;
    const uv0 = tileUv(vBand.x), uv1 = tileUv(vBand.x.add(1));
    const a0 = texture(albedoTex, uv0), a1 = texture(albedoTex, uv1);
    const n0 = texture(normalTex, uv0), n1 = texture(normalTex, uv1);
    const albedo = mix(a0, a1, vBand.y), nrm = mix(n0, n1, vBand.y);
    // coverage kept with distance: the mips average the leaves' cut-outs into a thin haze the alpha test would drop,
    // so the far trees thinned out; the alpha is scaled up by the mip level the pixel samples
    const lod = log2(max(max(abs(dFdx(vUv.x)), abs(dFdy(vUv.x))).mul(TILE_W), max(abs(dFdx(vUv.y)), abs(dFdy(vUv.y))).mul(TILE_H)).max(1e-4)).max(0);
    const alpha = albedo.a.mul(lod.mul(0.45).add(1));
    // the seasons, as on the meshes: a leaf texel turns and falls by a per-tree and per-patch key
    const { autumnLeaf, leafStays } = C;
    const leafness = smoothstep(0.35, 0.65, nrm.a.div(max(albedo.a, 1e-3)));
    // the per-leaf key, as ez-trees.js seasonNodes': smooth value noise at about a leaf's size on the crown (~0.15 m: 96
    // x 192 over the frame), not cells: a floored key turned and dropped whole 0.7 m squares of the crown in autumn
    // (John's report, 2026-11-06)
    const vn = (q) => {
      const i = q.floor(), f = q.fract(), w = f.mul(f).mul(f.mul(-2.0).add(3.0));
      const h = (o) => fract(sin(dot(i.add(o), vec2(127.1, 311.7))).mul(43758.5453));
      return mix(mix(h(vec2(0, 0)), h(vec2(1, 0)), w.x), mix(h(vec2(0, 1)), h(vec2(1, 1)), w.x), w.y);
    };
    const p = vUv.mul(vec2(96, 192)).add(vRnd.mul(37));
    const col = albedo.rgb.div(max(albedo.a, 1e-3));
    // (the pilot's canopy grade on the leaf texels, ez-trees.js canopyGrade: every impostor stands in the pilot)
    const summer = grade ? mix(col, grade(col, vTree), leafness) : col;
    // (seen from above a crown's top is all sunlit leaves on the impostor, where the mesh shades itself deep inside: the
    // higher views a little darker, so the woods from the air match the meshes round them)
    const topShade = mix(float(1), float(0.74), smoothstep(0.3, 1.0, vBand.x.add(vBand.y).div(ELEV.length - 1)));
    // the seasons only off full summer (uLeaf 1, no autumn or spring), behind a uniform branch: in summer every impostor
    // fragment skips the noise (it cost ~0.4 ms of the woods walk, 2026-11-06). Off summer: the leaves turn by the key,
    // fall leaf by leaf, and about a third of the fallen ones stay as the dead tan-brown leaves the oaks hold through
    // winter, and the twigs (a 128 px bake can't hold the bare crown's twigs; without them a winter woods was bare
    // ground with trunks from the air)
    const U = C.cityUniforms;
    const inSeason = U ? U.uLeaf.lessThan(0.999).or(U.uAutumn.greaterThan(0.001)).or(U.uSpring.greaterThan(0.001)) : null;
    const seasonBranch = (colorOut, keepOut) => {
      const leafRnd = vn(p);
      const seasonal = autumnLeaf ? mix(summer, autumnLeaf(summer, vTree, leafRnd), leafness) : summer;
      if (!leafStays) { colorOut.assign(seasonal); return; }
      const stays = leafStays(leafRnd.mul(0.75).add(vTree.mul(0.25)));
      // (the haze kept per fine cell, a cheap hash: the noise's own contours made rings)
      const haze = fract(sin(dot(p.mul(2.0).floor(), vec2(12.9898, 78.233))).mul(43758.5453)).lessThan(0.36);
      const twig = mix(vec3(0.075, 0.045, 0.022), vec3(0.15, 0.095, 0.05), leafRnd); // (linear: dead tan-brown leaves, twigs)
      const fallen = leafness.greaterThan(0.5).and(stays.not());
      colorOut.assign(T.select(fallen, twig, seasonal));
      keepOut.assign(T.select(fallen.and(haze.not()), float(0), float(1)));
    };
    const shade = T.Fn(() => {
      const colorOut = vec3(summer).toVar(), keepOut = float(1).toVar(); // (inside the Fn: the branch's writes land)
      if (inSeason) T.If(inSeason, () => seasonBranch(colorOut, keepOut));
      return vec4(colorOut.mul(topShade), keepOut);
    })();
    mat.colorNode = vec4(shade.rgb, 1);
    const shape = alpha.greaterThan(0.5);
    let mask = shape.and(shade.a.greaterThan(0.5));
    if (lodKeep) mask = mask.and(lodKeep);
    mat.maskNode = mask;
    if (shadowProxy) {
      // (the shadow pass needs only the cut-out: one albedo tile, no mip-level coverage boost, no normals, no colour;
      // the fallen leaves' gaps off summer, behind the same uniform branch)
      const cut = texture(albedoTex, mix(uv0, uv1, vBand.y.round())).a.greaterThan(0.5);
      const keep = T.Fn(() => {
        const k = float(1).toVar();
        if (inSeason && leafStays) T.If(inSeason, () => {
          const a = texture(albedoTex, uv0), nr = texture(normalTex, uv0);
          const leafy = smoothstep(0.35, 0.65, nr.a.div(max(a.a, 1e-3))).greaterThan(0.5);
          const stays = leafStays(vn(p).mul(0.75).add(vTree.mul(0.25)));
          k.assign(T.select(leafy.and(stays.not()), float(0), float(1)));
        });
        return k;
      })();
      mat.colorNode = vec4(1);
      mat.maskShadowNode = cut.and(keep.greaterThan(0.5)).and(lodKeep || T.bool(true));
      return mat;
    }
    // the baked model-space normal turned to the view (the bake looked from +z): x along the quad's right, z towards the
    // viewer, level; into view space
    const nb = nrm.xyz.div(max(albedo.a, 1e-3)).mul(2).sub(1);
    const dirH = normalize(vec3(vDir.x, 0, vDir.z).add(vec3(0, 0, 1e-5)));
    const rightH = normalize(vec3(vRight.x, 0, vRight.z).add(vec3(1e-5, 0, 0)));
    const nWorld = normalize(rightH.mul(nb.x).add(vec3(0, 1, 0).mul(nb.y)).add(dirH.mul(nb.z)));
    mat.normalNode = normalize(cameraViewMatrix.mul(vec4(nWorld, 0)).xyz);
    return mat;
  }

  return { models, frames, bake, geometry, material, state, atlases: [albedoRT, normalRT] };
}

C.treeImpostors = { createImpostors, ELEV, TILE_W, TILE_H };
})();
