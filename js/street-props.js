(function () {
// js/street-props.js
// John's street props where the City says they stand (GEO.props, tools/geo-props.mjs): his fire hydrant at every
// City hydrant, his post-and-ring bike stand at every City bike ring, his transit shelter at every City shelter, his
// three-chamber litter & recycling bin at every City litter receptacle and his Canada Post box at every OpenStreetMap post
// box. One instanced mesh per model (assets/props/*.glb: his Meshy models, textures cut to 512 px, meshopt), each prop on
// the sidewalk and turned to face its nearest street; scene-culling.js chunks them and hides them by distance.

const { THREE } = window.CITY;
const { GEO, CITY_BOUNDS, nearestRoads, blockAt } = window.CITY;

// [GEO.props key, model, how it faces the street: 'front' (the model's +z toward the road), 'back' (its -z), 'along'
// (its +z across the curb, so a bike stand's ring runs with the street), cull distance (m), casts shadows, height (m)
// when the model isn't to scale]. Thousands of bike rings line downtown's streets: they go soonest and cast none (a thin
// post's shadow barely reads).
const KINDS = [
  ['hydrant', 'hydrant', 'front', 120, true],
  ['bikeRing', 'bike-ring', 'along', 90, false],
  ['postBox', 'mailbox', 'front', 150, true],
  ['shelter', 'transit-shelter', 'front', 260, true, 2.5],
  ['litterBin', 'litter-bin', 'back', 80, true]
];

function hash(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// The City lists double shelters at busy stops as two points a metre or three apart: a pair closer than a shelter's
// length stands end to end along the street instead, about its middle
function spreadAlongStreet(pts, len) {
  const out = Array.from(pts);
  for (let i = 0; i < out.length; i += 2) {
    for (let j = i + 2; j < out.length; j += 2) {
      const dx = out[j] - out[i], dz = out[j + 1] - out[i + 1], d = Math.hypot(dx, dz);
      if (d >= len) continue;
      const mx = (out[i] + out[j]) / 2, mz = (out[i + 1] + out[j + 1]) / 2;
      const road = nearestRoads(mx, mz, 30)[0];
      let ux = road ? road.dx : dx / (d || 1), uz = road ? road.dz : dz / (d || 1);
      if (ux * dx + uz * dz < 0) { ux = -ux; uz = -uz; }
      const h = (len + 0.3) / 2;
      out[i] = mx - ux * h; out[i + 1] = mz - uz * h;
      out[j] = mx + ux * h; out[j + 1] = mz + uz * h;
    }
  }
  return out;
}

async function buildStreetProps(scene) {
  const group = new THREE.Group();
  group.name = 'CityStreetProps';
  const props = GEO.props || {};
  const { GLTFLoader, MeshoptDecoder } = window.CITY.Addons;
  if (!GLTFLoader || !MeshoptDecoder) return { group, counts: {} };
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const counts = {};
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  await Promise.all(KINDS.map(async ([key, file, facing, cullDistance, shadows, height]) => {
    let pts = props[key];
    if (!pts || !pts.length) return;
    let gltf;
    try {
      gltf = await loader.loadAsync(`./assets/props/${file}.glb`);
    } catch (e) {
      console.warn(`[streetProps] ${file}.glb did not load:`, e);
      return;
    }
    const srcs = [];
    gltf.scene.traverse((o) => { if (o.isMesh) srcs.push(o); });
    if (!srcs.length) return;
    // every part of the model (the shelter's frame & its clear glass) in one frame: the base on the ground, centred on
    // its footprint. Meshopt quantisation stores positions as normalised 16-bit integers (-1..1, the node's transform
    // scaling them): back to floats first, or baking the transform in clips everything past a metre (the post box lost
    // its top half)
    const geos = srcs.map((src) => {
      const geo = src.geometry.clone();
      const pos = geo.attributes.position;
      if (!(pos.array instanceof Float32Array) || pos.normalized) {
        const f = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) { f[3 * i] = pos.getX(i); f[3 * i + 1] = pos.getY(i); f[3 * i + 2] = pos.getZ(i); }
        geo.setAttribute('position', new THREE.BufferAttribute(f, 3));
      }
      src.updateWorldMatrix(true, false);
      geo.applyMatrix4(src.matrixWorld);
      geo.computeBoundingBox();
      return geo;
    });
    const b = new THREE.Box3();
    geos.forEach((g) => b.union(g.boundingBox));
    const k = height ? height / (b.max.y - b.min.y) : 1;
    for (const geo of geos) {
      geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
      if (k !== 1) geo.scale(k, k, k);
    }
    if (key === 'shelter') pts = spreadAlongStreet(pts, (b.max.x - b.min.x) * k);
    const n = pts.length / 2;
    const meshes = srcs.map((src, j) => {
      const mesh = new THREE.InstancedMesh(geos[j], src.material, n);
      mesh.name = `StreetProps_${key}${j ? `_${src.material.name || j}` : ''}`;
      return mesh;
    });
    let nudged = 0;
    for (let i = 0; i < n; i++) {
      let x = pts[2 * i], z = pts[2 * i + 1];
      const road = nearestRoads(x, z, 30)[0];
      // a prop the data puts on the curb line (a metre of raster & outline simplification) steps back onto the sidewalk
      if (road && !blockAt(x, z)) {
        const ax = x - road.px, az = z - road.pz, L = Math.hypot(ax, az) || 1;
        for (let t = 0.25; t <= 3; t += 0.25) {
          if (blockAt(x + (ax / L) * t, z + (az / L) * t)) { x += (ax / L) * (t + 0.3); z += (az / L) * (t + 0.3); nudged++; break; }
        }
      }
      let yaw;
      if (road) {
        // toward the road (front) or across the curb (along), with a little hand-placed wobble
        const tx = road.px - x, tz = road.pz - z;
        yaw = facing === 'along' ? Math.atan2(-road.dz, road.dx) : Math.atan2(tx, tz) + (facing === 'back' ? Math.PI : 0);
        if (key !== 'shelter') yaw += (hash(x, z) - 0.5) * 0.12; // (a shelter stays square to the curb)
      } else yaw = hash(x, z) * Math.PI * 2;
      p.set(x, blockAt(x, z) ? CITY_BOUNDS.sidewalkHeight : 0, z);
      q.setFromAxisAngle(up, yaw);
      m.compose(p, q, sc);
      for (const mesh of meshes) mesh.setMatrixAt(i, m);
    }
    for (const mesh of meshes) {
      const clear = mesh.material.transparent;
      if (clear) mesh.material.depthWrite = false; // glass: the frame behind it still shows
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = shadows && !clear;
      mesh.receiveShadow = true;
      mesh.userData.cullDistance = cullDistance;
      mesh.userData.cullCell = 60;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    counts[key] = n;
    if (nudged) console.info(`[streetProps] ${key}: ${nudged} stepped back onto the sidewalk`);
  }));
  scene.add(group);
  console.info(`[streetProps] ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  return { group, counts };
}

Object.assign(window.CITY, { buildStreetProps });
})();
