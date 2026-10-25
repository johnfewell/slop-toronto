(function () {
// js/scene-culling.js
// Spatial culling for the city-wide static geometry. Most of the city's street furniture and building massing is
// built as a handful of instanced meshes spanning the whole city (bounding spheres ~13 km across), which three.js can
// never cull: every frame the GPU transformed every lamp post, signal and facade box of the city three times (the
// view and both sun shadow cascades). This module, run once after the city is built (main.js):
// 1. Splits the instanced meshes of small props into spatial chunks, each culled by the view frustum and hidden beyond
//    the distance where its props shrink below a pixel or two (updateSceneCulling, every frame).
// 2. Gives the big static shadow casters (facade boxes, piers, viaducts...) position-only stand-ins cut into cells, on
//    a layer only the shadow cascade cameras render (they cull the cells outside the ~300 m the cascades cover); the
//    originals stop casting. The stand-ins share one material per face side, so a cell costs one draw.

const { THREE } = window.CITY;
const Q = window.CITY.QUALITY; // the tier's cull distances (x Q.cull) & the safety net's (x Q.dist), quality.js

const SHADOW_PROXY_LAYER = 3;
// Distance at which an instance of typical size s (m) is culled: about s / d * 1100 px tall on a 1300 px viewport
const CULL_PER_METRE = 1100;
const CULL_MIN = 300; // never closer: the shadow cascades reach ~300 m at street level
const CULL_MAX = 2000; // beyond this the props are kept at any distance
const PROXY_CELL = 500;
const STATIC_CELL = 1000; // cells of the big batches kept at any distance, for the view frustum (mrdoob's 539289a) // the far cascade spans ~400 m at street level: a cascade sees a few cells

const _m = new THREE.Matrix4();
const _wm = new THREE.Matrix4();
const _size = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

const triangleCount = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;

// Typical size of an instance: sqrt(middle x largest of its extents), so thin poles count by their length and flat
// decals by their area. The 90th percentile, so the larger instances of a mesh set its cull distance.
function instanceSize(mesh) {
  const geo = mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  geo.boundingBox.getSize(_size);
  const e = mesh.instanceMatrix.array;
  const n = mesh.count;
  const step = Math.max(1, Math.floor(n / 1024));
  const sizes = [];
  for (let i = 0; i < n; i += step) {
    const o = i * 16;
    const d = [
      Math.hypot(e[o], e[o + 1], e[o + 2]) * _size.x,
      Math.hypot(e[o + 4], e[o + 5], e[o + 6]) * _size.y,
      Math.hypot(e[o + 8], e[o + 9], e[o + 10]) * _size.z
    ].sort((p, q) => p - q);
    sizes.push(Math.sqrt(d[1] * d[2]));
  }
  sizes.sort((p, q) => p - q);
  return sizes[Math.floor(sizes.length * 0.9)] || 0;
}

function isStaticMesh(o) {
  return o.isMesh && !o.isSkinnedMesh && o.visible && o.frustumCulled !== false && !o.morphTargetInfluences;
}

function copyObjectState(dst, src) {
  dst.name = src.name;
  dst.castShadow = src.castShadow;
  dst.receiveShadow = src.receiveShadow;
  dst.renderOrder = src.renderOrder;
  dst.layers.mask = src.layers.mask;
  dst.visible = src.visible;
  dst.userData = { ...src.userData };
  dst.position.copy(src.position);
  dst.quaternion.copy(src.quaternion);
  dst.scale.copy(src.scale);
  dst.matrixAutoUpdate = src.matrixAutoUpdate;
  dst.matrix.copy(src.matrix);
  if (Object.prototype.hasOwnProperty.call(src, 'onBeforeRender')) dst.onBeforeRender = src.onBeforeRender;
  if (Object.prototype.hasOwnProperty.call(src, 'onAfterRender')) dst.onAfterRender = src.onAfterRender;
}

// One InstancedMesh per `cell` x `cell` m square of the instances' positions, sharing the source's vertex data and
// material (so the same shader pipeline) with its per-instance data split up
function chunkInstancedMesh(mesh, cell) {
  const n = mesh.count;
  const src = mesh.instanceMatrix.array;
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.floor(src[i * 16 + 12] / cell) + ',' + Math.floor(src[i * 16 + 14] / cell);
    let ids = cells.get(key);
    if (!ids) cells.set(key, (ids = []));
    ids.push(i);
  }
  const geo0 = mesh.geometry;
  if (!geo0.boundingSphere) geo0.computeBoundingSphere();
  if (!geo0.boundingBox) geo0.computeBoundingBox();
  const attrs = Object.entries(geo0.attributes);
  const chunks = [];
  for (const ids of cells.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setIndex(geo0.index);
    for (const [name, a] of attrs) {
      if (!a.isInstancedBufferAttribute) {
        geo.setAttribute(name, a);
        continue;
      }
      const s = a.itemSize;
      const arr = new a.array.constructor(ids.length * s);
      ids.forEach((id, j) => arr.set(a.array.subarray(id * s, id * s + s), j * s));
      geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, s, a.normalized, a.meshPerAttribute));
    }
    for (const g of geo0.groups) geo.addGroup(g.start, g.count, g.materialIndex);
    geo.setDrawRange(geo0.drawRange.start, geo0.drawRange.count);
    geo.boundingSphere = geo0.boundingSphere;
    geo.boundingBox = geo0.boundingBox;

    const chunk = new THREE.InstancedMesh(geo, mesh.material, ids.length);
    ids.forEach((id, j) => chunk.instanceMatrix.array.set(src.subarray(id * 16, id * 16 + 16), j * 16));
    if (mesh.instanceColor) {
      const c = mesh.instanceColor.array;
      const arr = new Float32Array(ids.length * 3);
      ids.forEach((id, j) => arr.set(c.subarray(id * 3, id * 3 + 3), j * 3));
      chunk.instanceColor = new THREE.InstancedBufferAttribute(arr, 3);
    }
    copyObjectState(chunk, mesh);
    chunk.computeBoundingSphere();
    chunks.push(chunk);
  }
  return chunks;
}

// A caster can stand in as bare positions only if its material neither moves its vertices nor cuts holes in it
function proxyableMaterial(mat) {
  return !!mat && !Array.isArray(mat) && !mat.transparent && !(mat.alphaTest > 0) && !mat.alphaMap &&
    !mat.positionNode && !mat.castShadowPositionNode && !mat.castShadowNode && !mat.alphaTestNode &&
    !mat.maskNode && !mat.maskShadowNode && !mat.depthNode && !mat.displacementMap;
}

// Splits an instanced mesh into cells in place of the original (the first chunk compiles the pipeline every chunk of
// the mesh shares, main.js)
function replaceWithChunks(mesh, cell) {
  const parent = mesh.parent;
  const chunks = chunkInstancedMesh(mesh, cell);
  parent.remove(mesh);
  chunks.forEach((chunk, k) => {
    parent.add(chunk);
    if (k > 0) chunk.userData.sharesPipelineWith = chunks[0];
    chunk.updateMatrixWorld(true);
  });
  return chunks;
}

/**
 * Sets up the culling of the static city under `roots` (Object3Ds). `shadow` is the SunLightShadow whose cascade
 * cameras render the shadow stand-ins (none are made without it). Returns stats; the culling itself runs in
 * updateSceneCulling().
 */
function setupSceneCulling(scene, roots, shadow = null) {
  scene.updateMatrixWorld(true);
  const stats = { chunkedMeshes: 0, chunks: 0, proxiedMeshes: 0, proxies: 0, proxyTriangles: 0 };
  const culled = [];

  // 1. Small props: chunked & distance culled
  const chunkable = [];
  const largeMeshes = []; // kept at any distance: cut into cells for the view frustum alone (see the end)
  for (const root of roots) {
    root.traverse((o) => {
      if (!o.isInstancedMesh || !isStaticMesh(o) || o.count < 64 || o.count !== o.instanceMatrix.count) return;
      if (o.count * triangleCount(o.geometry) < 40000) return;
      if (!o.boundingSphere) o.computeBoundingSphere();
      if (o.boundingSphere.radius < 1500) return;
      chunkable.push(o);
    });
  }
  for (const mesh of chunkable) {
    // unlit (glowing) props, like signal lenses & lamp bulbs, read from much further away at night
    const glow = mesh.material.isMeshBasicNodeMaterial || mesh.material.type === 'MeshBasicNodeMaterial' ? 3 : 1;
    let cullDist = Math.max(CULL_MIN, instanceSize(mesh) * CULL_PER_METRE * glow);
    cullDist = cullDist > CULL_MAX ? Infinity : cullDist * Q.cull;
    let cell = Number.isFinite(cullDist) ? Math.min(600, Math.max(250, cullDist * 0.5)) : 0;
    // a mesh may set its own (street-props.js: John's dense, detailed props go much sooner, in small cells)
    if (mesh.userData.cullDistance) {
      cullDist = mesh.userData.cullDistance * Q.cull;
      cell = mesh.userData.cullCell || Math.max(40, cullDist * 0.5);
    }
    if (!cell) { // big things (sidewalk slabs, light pools...) are never distance culled
      largeMeshes.push(mesh);
      continue;
    }
    const chunks = replaceWithChunks(mesh, cell);
    for (const chunk of chunks) {
      const sphere = chunk.boundingSphere.clone().applyMatrix4(chunk.matrixWorld);
      culled.push({ mesh: chunk, x: sphere.center.x, y: sphere.center.y, z: sphere.center.z, r: sphere.radius, d: cullDist });
    }
    stats.chunkedMeshes++;
    stats.chunks += chunks.length;
  }

  // 2. Shadow stand-ins for the big static casters
  const cams = [];
  if (shadow && typeof shadow.getCamera === 'function') {
    const count = typeof shadow.getViewportCount === 'function' ? shadow.getViewportCount() : 2;
    for (let i = 0; i < count; i++) {
      const cam = shadow.getCamera(i);
      if (cam && cam.layers) cams.push(cam);
    }
  }
  if (cams.length) {
    const instancedBySig = new Map(); // geometry signature + face side -> { geometry, material, cells: Map(key -> [matrices]) }
    const triCells = new Map(); // face side -> Map(key -> number[] world positions)
    const proxyMaterials = new Map();
    const proxyMaterial = (side) => {
      let m = proxyMaterials.get(side);
      if (!m) {
        m = new THREE.MeshBasicNodeMaterial({ side: side.side, color: 0x000000 });
        m.shadowSide = side.shadowSide;
        m.name = 'ShadowProxy';
        proxyMaterials.set(side, m);
      }
      return m;
    };
    const sideKeys = new Map();
    const sideOf = (mat) => {
      const k = mat.side + ',' + mat.shadowSide;
      let s = sideKeys.get(k);
      if (!s) sideKeys.set(k, (s = { side: mat.side, shadowSide: mat.shadowSide }));
      return s;
    };
    const cellKey = (x, z) => Math.floor(x / PROXY_CELL) + ',' + Math.floor(z / PROXY_CELL);

    const sources = [];
    for (const root of roots) {
      root.traverse((o) => {
        if (!o.castShadow || !isStaticMesh(o) || !proxyableMaterial(o.material)) return;
        if (o.isInstancedMesh && o.count !== o.instanceMatrix.count) return;
        const tris = triangleCount(o.geometry) * (o.isInstancedMesh ? o.count : 1);
        if (tris < 20000) return;
        let radius;
        if (o.isInstancedMesh) {
          if (!o.boundingSphere) o.computeBoundingSphere();
          radius = o.boundingSphere.radius;
        } else {
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
          radius = o.geometry.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis();
        }
        if (radius > 600) sources.push(o);
      });
    }

    for (const o of sources) {
      const side = sideOf(o.material);
      const geo = o.geometry;
      if (o.isInstancedMesh) {
        const pos = geo.attributes.position;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const sig = [pos.count, geo.index ? geo.index.count : -1, bb.min.toArray().map((v) => v.toFixed(3)), bb.max.toArray().map((v) => v.toFixed(3)), side.side, side.shadowSide].join('|');
        let entry = instancedBySig.get(sig);
        if (!entry) {
          const g = new THREE.BufferGeometry();
          g.setIndex(geo.index);
          g.setAttribute('position', pos);
          entry = { geometry: g, material: proxyMaterial(side), cells: new Map() };
          instancedBySig.set(sig, entry);
        }
        const e = o.instanceMatrix.array;
        for (let i = 0; i < o.count; i++) {
          _wm.multiplyMatrices(o.matrixWorld, _m.fromArray(e, i * 16));
          const key = cellKey(_wm.elements[12], _wm.elements[14]);
          let list = entry.cells.get(key);
          if (!list) entry.cells.set(key, (list = []));
          list.push(..._wm.elements);
        }
      } else {
        let bySide = triCells.get(side);
        if (!bySide) triCells.set(side, (bySide = new Map()));
        const pos = geo.attributes.position;
        const idx = geo.index;
        const start = geo.drawRange.start;
        const end = Math.min(idx ? idx.count : pos.count, start + geo.drawRange.count);
        for (let t = start; t + 2 < end; t += 3) {
          const i0 = idx ? idx.getX(t) : t;
          const i1 = idx ? idx.getX(t + 1) : t + 1;
          const i2 = idx ? idx.getX(t + 2) : t + 2;
          _a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
          _b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
          _c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
          const key = cellKey((_a.x + _b.x + _c.x) / 3, (_a.z + _b.z + _c.z) / 3);
          let list = bySide.get(key);
          if (!list) bySide.set(key, (list = []));
          list.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z);
        }
      }
      o.castShadow = false;
      stats.proxiedMeshes++;
    }

    // The stand-ins live in one group: hidden while the view renders (they only draw in the shadow cascades, so
    // three's walk of the view's scene skips ~1,400 of them) and never touched by the per-frame matrix walk
    const proxyGroup = new THREE.Group();
    proxyGroup.name = 'ShadowProxies';
    const firstProxy = new Map(); // material + kind -> the stand-in that compiles their shared pipeline
    const addProxy = (mesh, tris) => {
      mesh.name = 'ShadowProxy';
      mesh.layers.set(SHADOW_PROXY_LAYER);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      mesh.userData.shadowProxy = true;
      const kind = mesh.material.uuid + (mesh.isInstancedMesh ? ':i' : ':m');
      if (firstProxy.has(kind)) mesh.userData.sharesPipelineWith = firstProxy.get(kind);
      else firstProxy.set(kind, mesh);
      proxyGroup.add(mesh);
      stats.proxies++;
      stats.proxyTriangles += tris;
    };
    for (const entry of instancedBySig.values()) {
      const tris = triangleCount(entry.geometry);
      for (const list of entry.cells.values()) {
        const n = list.length / 16;
        const mesh = new THREE.InstancedMesh(entry.geometry, entry.material, n);
        mesh.instanceMatrix.array.set(list);
        mesh.computeBoundingSphere();
        addProxy(mesh, tris * n);
      }
    }
    for (const [side, bySide] of triCells) {
      for (const list of bySide.values()) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
        g.computeBoundingSphere();
        addProxy(new THREE.Mesh(g, proxyMaterial(side)), list.length / 9);
      }
    }
    for (const cam of cams) cam.layers.enable(SHADOW_PROXY_LAYER);
    scene.add(proxyGroup);
    proxyGroup.updateMatrixWorld(true);
    proxyGroup.updateMatrixWorld = () => {};
    const shadowCams = new Set(cams);
    const before = scene.onBeforeRender;
    scene.onBeforeRender = function (renderer, s, camera, ...rest) {
      proxyGroup.visible = shadowCams.has(camera);
      return before.call(this, renderer, s, camera, ...rest);
    };
  }

  // 3. The big batches kept at any distance that cast no shadow (the casters have their stand-ins above): cells of a
  //    kilometre the view frustum can skip, with no per-frame distance checks (mrdoob's 539289a)
  for (const mesh of largeMeshes) {
    if (mesh.castShadow) continue;
    const chunks = replaceWithChunks(mesh, STATIC_CELL);
    stats.chunkedMeshes++;
    stats.chunks += chunks.length;
  }

  state.culled = culled;
  state.buckets = bucketCulled(culled);
  stats.buckets = state.buckets.length;
  return stats;
}

const state = { culled: [], buckets: null };

// The culled chunks gathered into groups of BUCKET x BUCKET m under their parent, so
// a far group hides whole and three's scene walk skips it. CityStreetProps alone holds ~8,400 chunks, nearly all hidden,
// which every scene render (the view & the two shadow cascades) otherwise visits one by one
const BUCKET = 600;
function bucketCulled(culled) {
  const byKey = new Map();
  for (const c of culled) {
    const parent = c.mesh.parent;
    if (!parent) continue;
    const key = parent.uuid + ':' + Math.floor(c.x / BUCKET) + ',' + Math.floor(c.z / BUCKET);
    let b = byKey.get(key);
    if (!b) byKey.set(key, (b = { parent, entries: [] }));
    b.entries.push(c);
  }
  const moved = new Map(); // parent -> Set of moved chunks
  const buckets = [];
  for (const b of byKey.values()) {
    const group = new THREE.Group();
    group.name = (b.parent.name || 'Chunks') + 'Bucket';
    let cx = 0, cz = 0;
    for (const c of b.entries) { cx += c.x; cz += c.z; }
    cx /= b.entries.length;
    cz /= b.entries.length;
    let r = 0, dMax = 0;
    for (const c of b.entries) {
      r = Math.max(r, Math.hypot(c.x - cx, c.z - cz) + c.r);
      dMax = Math.max(dMax, c.d);
      // (a plain move, not remove() & add(): removing 8,400 children one by one from one array is quadratic)
      let set = moved.get(b.parent);
      if (!set) moved.set(b.parent, (set = new Set()));
      set.add(c.mesh);
      c.mesh.parent = group;
      group.children.push(c.mesh);
    }
    group.parent = b.parent;
    buckets.push({ group, parent: b.parent, x: cx, z: cz, r, dMax, entries: b.entries });
  }
  for (const [parent, set] of moved) parent.children = parent.children.filter((o) => !set.has(o));
  for (const b of buckets) b.parent.children.push(b.group);
  return buckets;
}

// Per frame (after the warm-up frame, which must see everything): hide the chunks beyond their cull distance
function updateSceneCulling(cameraPosition) {
  const { x, y, z } = cameraPosition;
  const k = Q.dist;
  const cull = (c) => {
    const dx = c.x - x;
    const dy = c.y - y;
    const dz = c.z - z;
    return (c.mesh.visible = Math.sqrt(dx * dx + dy * dy + dz * dz) - c.r < c.d * k);
  };
  if (!state.buckets) {
    for (const c of state.culled) cull(c);
    return;
  }
  for (const b of state.buckets) {
    if (Math.hypot(b.x - x, b.z - z) - b.r >= b.dMax * k) {
      b.group.visible = false;
      continue;
    }
    let any = false;
    for (const c of b.entries) if (cull(c)) any = true;
    b.group.visible = any;
  }
}

// The phone tiers (quality.js lean): once the GPU holds a static vertex or index array, its CPU copy only costs memory
// (three keeps it for re-uploads that never come). Only plain attributes not updated since they were built (version 0,
// or 1 after computeVertexNormals; not instanced, not storage, static usage) that the WebGPU backend has already uploaded; the array becomes an empty one
// of the same type (the pipelines read its type, the draws its count). Bounds are computed first (frustum culling
// computes them lazily from the array). Canvases & data textures already uploaded shrink the same way. Returns MB freed
function releaseCpuCopies(renderer, roots, textures = []) {
  const backend = renderer.backend;
  if (!backend.isWebGPUBackend) return 0;
  let bytes = 0;
  const done = new Set();
  const release = (attr) => {
    if (!attr || done.has(attr) || attr.isInterleavedBufferAttribute || attr.isInstancedBufferAttribute ||
      attr.isStorageBufferAttribute || attr.isStorageInstancedBufferAttribute || attr.version > 1 ||
      attr.usage !== THREE.StaticDrawUsage || !attr.array || attr.array.length === 0) return;
    done.add(attr);
    if (backend.get(attr).buffer === undefined) return; // not on the GPU yet: it still needs its data
    bytes += attr.array.byteLength;
    attr.array = new attr.array.constructor(0);
  };
  // bounds first, for every geometry: chunks share their source's attributes (scene-culling's chunkInstancedMesh)
  const geos = [];
  for (const root of roots) {
    if (!root) continue;
    root.traverse((o) => {
      const g = o.geometry;
      if (!g || !g.isBufferGeometry || g.morphAttributes.position) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (!g.boundingBox) g.computeBoundingBox();
      if (o.isInstancedMesh && !o.boundingSphere) o.computeBoundingSphere();
      geos.push(g);
    });
  }
  for (const g of geos) {
    for (const name in g.attributes) release(g.attributes[name]);
    release(g.index);
  }
  for (const t of textures) {
    const img = t && t.image;
    if (!img || t.version === 0 || !backend.get(t).texture) continue;
    if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement && img.width > 1) {
      bytes += img.width * img.height * 4;
      img.width = img.height = 1; // (the texture keeps its size: three only reads the image to upload it)
    } else if (img.data && img.data.byteLength) {
      bytes += img.data.byteLength;
      img.data = null;
    }
  }
  return Math.round(bytes / 1048576);
}

Object.assign(window.CITY, { setupSceneCulling, updateSceneCulling, SHADOW_PROXY_LAYER, releaseCpuCopies });
})();
