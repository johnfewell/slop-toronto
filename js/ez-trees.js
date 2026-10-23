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

const NEAR = 55; // full EZ-Tree mesh within (m)
const MID = 320; // decimated mesh within; whole-crown cards beyond
// ?lodfade=0: the old hard swap (no masks, no bands), for A/B
const FADE = new URLSearchParams(location.search).get('lodfade') !== '0';
// hand-over bands, centred on the edge (m): near <-> mid, mid <-> far, the last level -> nothing
const BAND = FADE ? [14, 50, 80] : [0, 0, 0];
// the levels are regrouped every 4 m of camera travel: a tree joins a level this much before its band starts
const MARGIN = FADE ? 6 : 0;
const MAX_DIST = [3000, 1600, 950]; // by tier (0 park, 1 street, 2 yard), as trees.js
const LOW_CUTOFF = 1150; // at street level everything further is behind the buildings
const PINE_FAR = Number(new URLSearchParams(location.search).get('pinefar') ?? 600); // pines keep their mid mesh far out (mrdoob's species are all broadleaf)

// model family -> mrdoob's far crown species (0 London plane, 1 honey locust, 2 elm); -1: no far crown (pines)
const FAR_SPECIES = (id) => (id.includes('pine') ? -1 : id.includes('ash') ? 1 : id.includes('aspen') ? 2 : 0);
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
const viewer = (() => {
  const { uniform } = window.CITY.TSL;
  return uniform(new THREE.Vector3());
})();
const lodKeep = (() => {
  const { attribute, screenCoordinate, fract, dot, vec2, float, clamp, distance } = window.CITY.TSL;
  const origin = attribute('aLodOrigin', 'vec3');
  const fade = attribute('aLodFade', 'vec4');
  const d = distance(origin, viewer);
  // interleaved-gradient noise on the pixel grid
  const h = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
  const share = (edge, band) => clamp(d.sub(edge.sub(band.mul(0.5))).div(band), 0.0, 1.0);
  return h.lessThan(share(fade.x, fade.y)).and(h.greaterThanEqual(share(fade.z, fade.w)));
})();
const ALL_IN = -1e6, ALL_OUT = 1e9;

// The EZ-Tree glTF material as a node material wearing the dissolve; the cutout as nodes, as createTreeMaterial does
// (an `alphaTest` on a shadow caster churns the shared shadow material's version)
function fadeMaterial(src) {
  const { texture, uv, float } = window.CITY.TSL;
  const mat = new THREE.MeshStandardNodeMaterial({
    map: src.map, color: src.color, roughness: src.roughness ?? 0.9, metalness: src.metalness ?? 0, side: THREE.DoubleSide
  });
  mat.name = `${src.name || 'tree'}_lodfade`;
  mat.alphaTestNode = float(0.5);
  const cutout = src.map ? texture(src.map, uv()).a.greaterThan(0.5) : null;
  if (FADE) mat.maskNode = lodKeep;
  if (cutout) mat.maskShadowNode = FADE ? cutout.and(lodKeep) : cutout;
  else if (FADE) mat.maskShadowNode = lodKeep;
  return mat;
}

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
      return { id, near: bakedGeometry(near), mid: bakedGeometry(mid), material: fadeMaterial(near.material) };
    }));
  } catch (e) {
    console.warn('[ezTrees] models did not load, mrdoob\'s trees stay:', e);
    return null;
  }

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
  const ST = GEO.streetTrees || [];
  for (let i = 0; i < ST.length; i += 4) {
    const x = ST[i], z = ST[i + 1];
    sites.push({ x, y: blockAt(x, z) ? CITY_BOUNDS.sidewalkHeight : 0, z, model: ST[i + 2], height: ST[i + 3] / 10, tier: 1 });
  }
  const genModel = (sp, h) => {
    const big = h > 15 ? 2 : h > 9 ? 1 : 0;
    if (sp === 1) return ids.indexOf(['ez-ash-small', 'ez-ash-medium', 'ez-ash-large'][big]);
    if (sp === 2) return ids.indexOf(big ? 'ez-aspen-large' : 'ez-aspen-medium');
    return ids.indexOf(['ez-oak-small', 'ez-oak-medium', 'ez-oak-large'][big]);
  };
  for (const t of generated) {
    const h = t.scale * slopHeight;
    sites.push({ x: t.x, y: t.y || 0, z: t.z, model: genModel(t.species || 0, h), height: h, tier: t.tier || 0 });
  }

  const group = new THREE.Group();
  group.name = 'Trees';
  const N = sites.length;
  const matsNear = new Float32Array(N * 16); // EZ-Tree meshes (near & mid)
  const matsFar = new Float32Array(N * 16); // the far crown, scaled to the same height
  const farData = new Float32Array(N * 4);
  const tints = new Float32Array(N * 3);
  const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  const meshOf = new Int16Array(N * 3);
  const tier = new Uint8Array(N);
  const isPine = new Uint8Array(N);
  const levels = new Uint8Array(N); // bit L: drawn at level L (both levels inside a hand-over band)
  const fades = new Float32Array(N * 12); // per level: edge in, band in, edge out, band out
  const meshes = [];
  const make = (geo, material, name, attrs) => { meshes.push({ geo, material, name, capacity: 0, attrs }); return meshes.length - 1; };
  const idxNear = models.map((m) => make(m.near, m.material, `Trees_${m.id}_near`));
  const idxMid = models.map((m) => make(m.mid, m.material, `Trees_${m.id}_mid`));
  const idxFar = farGeos.map((g, s) => make(g, farMaterial, `Trees_far_${TREE_SPECIES[s].name}`, true));
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  sites.forEach((t, i) => {
    const m = Math.max(0, t.model);
    const r1 = hashPos(t.x, 1.3, t.z), r2 = hashPos(t.z, 7.1, t.x), r3 = hashPos(t.x + t.z, 3.3, 0.7);
    const yaw = r2 * Math.PI * 2;
    const s = (t.height / heights[m]) * (0.92 + r1 * 0.16);
    dummy.position.set(t.x, t.y, t.z);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(s * (0.93 + r3 * 0.14), s, s * (0.93 + r1 * 0.14));
    dummy.updateMatrix();
    dummy.matrix.toArray(matsNear, i * 16);
    const sp = FAR_SPECIES(models[m].id);
    isPine[i] = sp < 0 ? 1 : 0;
    if (sp >= 0) {
      const fs = t.height / farHeight[sp];
      dummy.scale.set(fs, fs, fs);
      dummy.updateMatrix();
      dummy.matrix.toArray(matsFar, i * 16);
      tint.setHex(TREE_SPECIES[sp].tints[Math.floor(r3 * 2.999)]).multiplyScalar(0.82 + r1 * 0.36);
      farData.set([tint.r, tint.g, tint.b, sp + r2 * 0.999], i * 4);
    }
    // a little colour between trees of one model, so a street doesn't read as copies
    tints.set([0.86 + r1 * 0.2, 0.88 + r3 * 0.16, 0.86 + r2 * 0.18], i * 3);
    px[i] = t.x; py[i] = t.y + t.height * 0.5; pz[i] = t.z;
    tier[i] = Math.min(2, t.tier);
    meshOf[i * 3] = idxNear[m];
    meshOf[i * 3 + 1] = idxMid[m];
    meshOf[i * 3 + 2] = sp >= 0 ? idxFar[sp] : idxMid[m];
    meshes[idxNear[m]].capacity++;
    meshes[idxMid[m]].capacity++;
    if (sp >= 0) meshes[idxFar[sp]].capacity++;
  });
  const instanced = meshes.map((m) => {
    const geo = new THREE.BufferGeometry();
    for (const name of Object.keys(m.geo.attributes)) geo.setAttribute(name, m.geo.attributes[name]);
    geo.setIndex(m.geo.index);
    geo.boundingSphere = m.geo.boundingSphere;
    const cap = Math.max(1, m.capacity);
    if (m.attrs) geo.setAttribute('aTreeData', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('aLodOrigin', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    geo.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    const mesh = new THREE.InstancedMesh(geo, m.material, cap);
    if (!m.attrs) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.name = m.name;
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false; // instances surround the camera: the per-tree levels do the culling
    mesh.castShadow = !m.attrs; // the far crowns stand past the shadow cascades
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  });
  const counts = new Int32Array(instanced.length);
  function rebuild() {
    counts.fill(0);
    for (let i = 0; i < N; i++) {
      const bits = levels[i];
      if (!bits) continue;
      for (let l = 0; l < 3; l++) {
        if (!(bits & (1 << l))) continue;
        const mi = meshOf[i * 3 + l];
        const mesh = instanced[mi];
        const c = counts[mi]++;
        const far = meshes[mi].attrs;
        const a = mesh.geometry.attributes;
        mesh.instanceMatrix.array.set((far ? matsFar : matsNear).subarray(i * 16, i * 16 + 16), c * 16);
        if (far) a.aTreeData.array.set(farData.subarray(i * 4, i * 4 + 4), c * 4);
        else mesh.instanceColor.array.set(tints.subarray(i * 3, i * 3 + 3), c * 3);
        a.aLodOrigin.array.set([px[i], py[i], pz[i]], c * 3);
        a.aLodFade.array.set(fades.subarray(i * 12 + l * 4, i * 12 + l * 4 + 4), c * 4);
      }
    }
    instanced.forEach((mesh, mi) => {
      const n = counts[mi];
      if (n > 0) {
        const a = mesh.geometry.attributes;
        const extra = meshes[mi].attrs ? a.aTreeData : mesh.instanceColor;
        for (const attr of [mesh.instanceMatrix, extra, a.aLodOrigin, a.aLodFade]) {
          attr.clearUpdateRanges();
          attr.addUpdateRange(0, n * attr.itemSize);
          attr.needsUpdate = true;
        }
      }
      mesh.count = n;
      mesh.visible = n > 0;
    });
  }
  const last = new V3(Infinity, Infinity, Infinity);
  const cam = new V3();
  let lastLow = null;
  function update(position) {
    cam.copy(position);
    if (cam.distanceToSquared(last) < 16) return false;
    last.copy(cam);
    const low = cam.y < 40;
    let changed = low !== lastLow; // the far edges move with the camera's height: every tree's bands change
    lastLow = low;
    for (let i = 0; i < N; i++) {
      const dx = px[i] - cam.x, dy = py[i] - cam.y, dz = pz[i] - cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let maxD = low ? Math.min(MAX_DIST[tier[i]], LOW_CUTOFF) : MAX_DIST[tier[i]];
      if (isPine[i]) maxD = Math.min(maxD, PINE_FAR);
      // [edge in, band in, edge out, band out] per level; pines have no far level (their mid mesh goes out to maxD)
      const f = fades;
      const o = i * 12;
      f[o] = ALL_IN; f[o + 1] = 1; f[o + 2] = NEAR; f[o + 3] = BAND[0];
      f[o + 4] = NEAR; f[o + 5] = BAND[0];
      if (isPine[i]) { f[o + 6] = maxD; f[o + 7] = BAND[2]; f[o + 8] = ALL_OUT; f[o + 9] = 1; f[o + 10] = ALL_OUT; f[o + 11] = 1; }
      else { f[o + 6] = MID; f[o + 7] = BAND[1]; f[o + 8] = MID; f[o + 9] = BAND[1]; f[o + 10] = maxD; f[o + 11] = BAND[2]; }
      let bits = 0;
      for (let l = 0; l < 3; l++) {
        const lo = f[o + l * 4] - f[o + l * 4 + 1] * 0.5 - MARGIN, hi = f[o + l * 4 + 2] + f[o + l * 4 + 3] * 0.5 + MARGIN;
        if (d >= lo && d < hi) bits |= 1 << l;
      }
      if (bits !== levels[i]) { levels[i] = bits; changed = true; }
    }
    if (changed) rebuild();
    return changed;
  }
  // follow the view camera of every scene render (the shadow cascades keep the view's levels)
  const viewPos = new V3();
  const prevBeforeRender = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, scn, camera, target) {
    prevBeforeRender.call(this, renderer, scn, camera, target);
    if (camera.isOrthographicCamera === true || camera.isArrayCamera === true) return;
    viewPos.setFromMatrixPosition(camera.matrixWorld);
    viewer.value.copy(viewPos);
    update(viewPos);
  };
  // levels for the start view, so the shader warm-up sees the tree meshes
  const start = (window.CITY.TELEPORT_LOCATIONS || {}).yongeDundas || { x: 0, z: 0 };
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
  console.info(`[ezTrees] ${N} trees (${ST.length / 4} from the City's inventory, ${generated.length} in parks & yards), ${ids.length} models`);
  return { group, update };
}

Object.assign(window.CITY, { buildEzTrees });
})();
