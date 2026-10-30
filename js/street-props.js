(function () {
// js/street-props.js
// John's street props where the City says they stand (GEO.props, tools/geo-props.mjs): his fire hydrant at every
// City hydrant, his post-and-ring bike stand at every City bike ring, his transit shelter at every City shelter, his
// three-chamber litter & recycling bin at every City litter receptacle and his Canada Post box at every OpenStreetMap post
// box. One instanced mesh per model (assets/props/*.glb: his Meshy models, textures cut to 512 px, meshopt), each prop on
// the sidewalk and turned to face its nearest street; scene-culling.js chunks them and hides them by distance. Each is
// solid (world-collision.js prop colliders): the hydrant a circle, the rest their model's footprint as a turned box, the
// Open Data furniture (parking pay stations, benches, TO360 signs & pillars) its own measured footprint.

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
  ['litterBin', 'litter-bin', 'back', 80, true],
  ['parkingMeter', 'parking-meter', 'front', 120, true],
  ['bench', 'plaza-bench', 'front', 140, true],
  ['wayfinding', 'wayfinding', 'front', 150, true],
  ['infoPillar', 'info-pillar', 'front', 150, true]
];

// the round ones (a circle a little inside the model's widest reach: a hydrant's nozzles stick out)
const ROUND = { hydrant: 0.85 };
// The Open Data furniture placed by its own layout (parking-meters.js parkingMeterSites, benchSites: already clear of the
// roadway, buildings and other furniture), with its own collider below; the rest gets its model's footprint
const LAID_OUT = ['parkingMeter', 'bench', 'wayfinding', 'infoPillar'];

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

async function buildStreetProps(scene, staticColliders = []) {
  const group = new THREE.Group();
  group.name = 'CityStreetProps';
  const props = { ...(GEO.props || {}) };
  const colliders = [];
  const sourceMeters = window.CITY.PARKING_METERS?.records || [];
  const W = window.CITY.WorldCollision;
  // Broad-phase checks keep the new cabinets clear of buildings/landmarks, other
  // furniture and boarding shelters. These run once at startup, never per frame.
  const obstruction = (x,z,height=1.8288) => {
    const shape = W.circleShape(x,z,0.35);
    const ground = CITY_BOUNDS.sidewalkHeight+(window.CITY.cutAt?.(x,z)||0);
    if (staticColliders.some((c) => (c.maxY ?? Infinity)>ground+0.05 && (c.minY ?? -Infinity)<ground+height && W.contact(shape,c))) return true;
    for (const key of ['hydrant','bikeRing','postBox','shelter','litterBin']) {
      const radius = key === 'shelter' ? 3 : 0.8;
      const points = props[key] || [];
      for (let i=0; i<points.length; i+=2) if (Math.hypot(points[i]-x,points[i+1]-z) < radius) return true;
    }
    return false;
  };
  const meterLayout = sourceMeters.length && W && window.CITY.parkingMeterSites
    ? window.CITY.parkingMeterSites(sourceMeters, { nearestRoads, blockAt, blocked: obstruction, bikeShareAt: window.CITY.bikeShareAt })
    : { sites: [], rejected: {} };
  props.parkingMeter = meterLayout.sites.flatMap((s) => [s.x,s.z]);
  window.CITY.parkingMeterStats = { sourceCount: sourceMeters.length, accepted: meterLayout.sites.length, placed: 0, rejected: meterLayout.rejected, sites: meterLayout.sites };
  const sourceBenches = window.CITY.BENCHES?.records || [];
  const benchLayout = W && window.CITY.benchSites
    ? window.CITY.benchSites(sourceBenches, { nearestRoads, blockAt, bikeShareAt:window.CITY.bikeShareAt,
      blocked:(x,z)=>obstruction(x,z)||meterLayout.sites.some((s)=>Math.hypot(s.x-x,s.z-z)<.75) })
    : {sites:[],rejected:{}};
  props.bench = benchLayout.sites.flatMap((s)=>[s.x,s.z]);
  window.CITY.benchStats = {sourceCount:sourceBenches.length, accepted:benchLayout.sites.length, placed:0, rejected:benchLayout.rejected, sites:benchLayout.sites};
  const sourceSigns = window.CITY.WAYFINDING?.records || [];
  const signLayout = W && window.CITY.benchSites
    ? window.CITY.benchSites(sourceSigns.filter((r)=>r.type==='TO360'),{nearestRoads,blockAt,bikeShareAt:window.CITY.bikeShareAt,halfWidth:.28,halfDepth:.18,clearBehind:1.2,
      // John's photographed legend says the reader faces East. The sign's +Z
      // front therefore points West in the rotated game frame.
      headingFor:(record,road,yaw)=>record.id==='IP-00839'?(GEO.frame.bearingDeg-90)*Math.PI/180:yaw,
      blocked:(x,z)=>obstruction(x,z,2.7)||meterLayout.sites.some((s)=>Math.hypot(s.x-x,s.z-z)<.75)||benchLayout.sites.some((s)=>Math.hypot(s.x-x,s.z-z)<1.3)})
    : {sites:[],rejected:{}};
  props.wayfinding=signLayout.sites.flatMap((s)=>[s.x,s.z]);
  window.CITY.wayfindingStats={sourceCount:sourceSigns.length,unsupported:sourceSigns.filter((r)=>r.type!=='TO360').length,accepted:signLayout.sites.length,placed:0,rejected:signLayout.rejected,sites:signLayout.sites};
  const infoLayout=W&&window.CITY.benchSites
    ?window.CITY.benchSites(sourceSigns.filter((r)=>r.type==='Info Pillar'),{nearestRoads,blockAt,bikeShareAt:window.CITY.bikeShareAt,halfWidth:.73,halfDepth:.32,clearBehind:1.2,
      blocked:(x,z)=>obstruction(x,z,3)||meterLayout.sites.some((s)=>Math.hypot(s.x-x,s.z-z)<.75)||benchLayout.sites.some((s)=>Math.hypot(s.x-x,s.z-z)<1.3)||signLayout.sites.some((s)=>Math.hypot(s.x-x,s.z-z)<.7)})
    :{sites:[],rejected:{}};
  // Long advertising wing follows the street; the narrow walking map addresses
  // pedestrians approaching along it. The City source does not supply yaw.
  infoLayout.sites.forEach((s)=>s.yaw+=Math.PI/2);
  props.infoPillar=infoLayout.sites.flatMap((s)=>[s.x,s.z]);
  window.CITY.infoPillarStats={sourceCount:sourceSigns.filter((r)=>r.type==='Info Pillar').length,accepted:infoLayout.sites.length,placed:0,rejected:infoLayout.rejected,sites:infoLayout.sites};
  window.CITY.wayfindingStats.unsupported=sourceSigns.filter((r)=>!['TO360','Info Pillar'].includes(r.type)).length;
  const { GLTFLoader, MeshoptDecoder } = window.CITY.Addons;
  if (!GLTFLoader || !MeshoptDecoder) return { group, counts: {}, colliders };
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
    const hx = ((b.max.x - b.min.x) / 2) * k, hz = ((b.max.z - b.min.z) / 2) * k, top = (b.max.y - b.min.y) * k;
    const { circleCollider, boxCollider } = window.CITY.WorldCollision;
    for (const geo of geos) {
      geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
      if (k !== 1) geo.scale(k, k, k);
    }
    if (key === 'shelter') pts = spreadAlongStreet(pts, (b.max.x - b.min.x) * k);
    // (none standing in a Bike Share station's docks or bikes, bike-share.js; a shelter stays where the City has it)
    if (!['shelter','parkingMeter','bench','wayfinding','infoPillar'].includes(key) && window.CITY.bikeShareAt) {
      const kept = [];
      for (let i = 0; i < pts.length; i += 2) if (!window.CITY.bikeShareAt(pts[i], pts[i + 1], 'prop')) kept.push(pts[i], pts[i + 1]);
      pts = kept;
    }
    // a prop the data puts on the curb line (a metre of raster & outline simplification) steps back onto the sidewalk;
    // one still out in a roadway (a few dozen: bike rings down King St E's middle, a post box in Bloor's) isn't placed:
    // solid there, it would stop a car or a rider dead in its lane
    const sites = [];
    let nudged = 0, inRoad = 0;
    for (let i = 0; i < pts.length; i += 2) {
      let x = pts[i], z = pts[i + 1];
      const road = nearestRoads(x, z, 30)[0];
      if (road && !['bench','wayfinding','infoPillar'].includes(key) && !blockAt(x, z)) {
        const ax = x - road.px, az = z - road.pz, L = Math.hypot(ax, az) || 1;
        for (let t = 0.25; t <= 3; t += 0.25) {
          if (blockAt(x + (ax / L) * t, z + (az / L) * t)) { x += (ax / L) * (t + 0.3); z += (az / L) * (t + 0.3); nudged++; break; }
        }
        if (!LAID_OUT.includes(key) && !blockAt(x, z)) {
          const grade = nearestRoads(x, z, 30).find((r) => !r.road.raised);
          if (grade && grade.dist < (grade.road.w || 7) / 2 - 0.5) { inRoad++; continue; }
        }
      }
      sites.push({ x, z, road });
    }
    const n = sites.length;
    const meshes = srcs.map((src, j) => {
      const mesh = new THREE.InstancedMesh(geos[j], src.material, n);
      mesh.name = `StreetProps_${key}${j ? `_${src.material.name || j}` : ''}`;
      return mesh;
    });
    for (let i = 0; i < n; i++) {
      const { x, z, road } = sites[i];
      let yaw;
      if (road) {
        // toward the road (front) or across the curb (along), with a little hand-placed wobble
        const tx = road.px - x, tz = road.pz - z;
        yaw = facing === 'along' ? Math.atan2(-road.dz, road.dx) : Math.atan2(tx, tz) + (facing === 'back' ? Math.PI : 0);
        if (!['shelter','parkingMeter','bench','wayfinding','infoPillar'].includes(key)) yaw += (hash(x, z) - 0.5) * 0.12;
      } else yaw = hash(x, z) * Math.PI * 2;
      if (key === 'bench') yaw = benchLayout.sites[i].yaw;
      if (key === 'wayfinding') yaw = signLayout.sites[i].yaw;
      if (key === 'infoPillar') yaw = infoLayout.sites[i].yaw;
      // (down a road cut's sidewalks too: city-config.js cutAt, Strachan Ave under the railway)
      p.set(x, (blockAt(x, z) ? CITY_BOUNDS.sidewalkHeight : 0) + (window.CITY.cutAt ? window.CITY.cutAt(x, z) : 0), z);
      if (!LAID_OUT.includes(key)) colliders.push(ROUND[key] ? circleCollider(x, z, Math.max(hx, hz) * ROUND[key], p.y, top, key) : boxCollider(x, z, hx, hz, yaw, p.y, top, key));
      q.setFromAxisAngle(up, yaw);
      m.compose(p, q, sc);
      for (const mesh of meshes) mesh.setMatrixAt(i, m);
      // (street furniture too: `prop`, met with the slim bodies, world-collision.js)
      if (key === 'parkingMeter') colliders.push({ minX:x-0.28, maxX:x+0.28, minZ:z-0.28, maxZ:z+0.28, minY:p.y, maxY:p.y+1.8288, prop:true, kind:key, openData:true });
      if (key === 'wayfinding') colliders.push({minX:x-.27,maxX:x+.27,minZ:z-.27,maxZ:z+.27,minY:p.y,maxY:p.y+2.7,prop:true,kind:key,openData:true});
      if (key === 'bench'||key === 'infoPillar') {
        const cs = Math.cos(yaw), sn = Math.sin(yaw), hx = key==='bench' ? .9 : .28, hz = key==='bench' ? .4 : .674;
        const rx = Math.abs(cs)*hx+Math.abs(sn)*hz, rz = Math.abs(sn)*hx+Math.abs(cs)*hz;
        colliders.push({minX:x-rx,maxX:x+rx,minZ:z-rz,maxZ:z+rz,minY:p.y,maxY:p.y+(key==='bench'?.96:3),obb:{cx:x,cz:z,hx,hz,cs,sn},prop:true,kind:key,openData:true});
      }
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
    if (key === 'parkingMeter') window.CITY.parkingMeterStats.placed = n;
    if (key === 'bench') window.CITY.benchStats.placed = n;
    if (key === 'wayfinding') window.CITY.wayfindingStats.placed = n;
    if (key === 'infoPillar') window.CITY.infoPillarStats.placed = n;
    if (nudged || inRoad) console.info(`[streetProps] ${key}: ${nudged} stepped back onto the sidewalk, ${inRoad} left out of the roadway`);
  }));
  scene.add(group);
  console.info(`[streetProps] ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  return { group, counts, colliders };
}

Object.assign(window.CITY, { buildStreetProps });
})();
