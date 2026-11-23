(function () {
// js/school-fences.js
// The schoolyard fences (docs/school-fences.md, bead st-ndw9.14): a plain galvanised chain-link fence along each school
// grounds boundary on the yard sides, open in front of the school's street entrance.
//
// On by default (John, 2026-11-17), on a desktop only: loaded after js/school-fences-data.js has set
// window.CITY.SCHOOL_FENCES. ?schoolFences=0 loads neither file and fetches nothing (main.js's call is guarded), and
// neither does a phone or a low tier.
//
// The fence (st-ndw9.17): a galvanised chain-link schoolyard fence, 1.8 m of 5 cm-diamond mesh on 6 cm line posts 2.4 m
// apart with a top rail, a bottom tension wire, post caps, and thicker terminal and corner posts. One instance per bay
// (post to post); one geometry (post, cap, rail, wire, mesh) and ONE material for all of it, so a chunk of fence is one
// draw call. The vertex shader stretches a bay to its length; the fragment shader draws the diamonds, filtered so that
// they fade to an even grey veil beyond a few metres. Each post stands on the terrain height at its position; the rail
// and mesh follow the posts' ground. scene-culling.js chunks and distance-culls them (userData.cullDistance/cullCell;
// the group is in main.js's culling roots). No collision: walkers, bikes and cars pass through.
//
// window.CITY.schoolFencesProbe(x, z, radius) reports the numeric proof the coordinator asks for: the instances within
// radius of (x, z), the nearest post's position, base height and the terrain under it, each mesh's visibility and
// material opacity, and the build's stats.

const params = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
const loader = typeof cityAppScripts !== 'undefined' ? cityAppScripts : null;

const POST_SPACING = 2.4;   // m between line posts
const FENCE_H = 1.8;        // m of mesh (the brief: schoolyard height; no data says where a taller ball-diamond or court fence stands)
const POST_SIZE = 0.06;     // m square line post
const TERMINAL_SCALE = 1.7; // terminal and corner posts: 10 cm
const CORNER_DEG = 25;      // a bend over this turns the post at a run's vertex into a corner post
const RAIL_SIZE = 0.042;    // m top rail
const MESH_PITCH = 0.05;    // m between parallel wires: the 5 cm diamond
const WIRE_HALF = 0.0026;   // m: half the drawn wire width (a 5 mm wire; a 3.8 mm one is too thin to resolve at street distance)
const VEIL = 0.5;           // the opacity the mesh settles to once its diamonds are smaller than a pixel, close by
const VEIL_FAR = 0.84;      // and from 60 m on: the fence then reads as a thin dark line from the air (smoothstep from 12 m)
const CULL_M = 300;         // m: fences read from nearby; beyond this a 1.8 m fence is a few pixels (see the document)
const CULL_CELL_M = 200;    // m: scene-culling.js chunks them in squares of this size (400 m cells measured worse: more bays drawn in both shadow cascades)
const SHADOW_VEIL = 0.7;   // the share of the mesh's shadow that lands: the sun's shadow of the mesh is a stipple the shadow filter averages
const BAY_MAX_M = 4;        // m: no bay is longer than this (the bounding sphere allows for it)

// The bays of one fence: for every run, a post at each sampled point (a post every POST_SPACING and at each vertex of the
// run) and the bay between two posts. Pure: the caller gives the ground height. Each bay is { ax, ay, az, dx, dy, dz, post }
// (origin, the vector to the next post, the post's width scale: 1 for a line post, TERMINAL_SCALE at a run's end and at a
// corner). The last post of a run is a bay of length 0.001 m pointing the way the run was going.
function planBays(schools, groundAt) {
  const bays = [];
  for (const school of schools) {
    for (const run of school.runs) {
      const chain = [];
      for (let i = 0; i + 3 < run.length; i += 2) {
        const ax = run[i], az = run[i + 1], bx = run[i + 2], bz = run[i + 3];
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / POST_SPACING));
        for (let k = i === 0 ? 0 : 1; k <= n; k++) { const t = k / n; chain.push([ax + (bx - ax) * t, az + (bz - az) * t]); }
      }
      const pts = chain.filter((p, i) => i === 0 || Math.hypot(p[0] - chain[i - 1][0], p[1] - chain[i - 1][1]) > 1e-3);
      if (pts.length < 2) continue;
      const ys = pts.map(([x, z]) => groundAt(x, z));
      const dirOf = (i) => { const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dz); return [dx / l, dz / l]; };
      for (let i = 0; i < pts.length - 1; i++) {
        let post = 1;
        if (i === 0) post = TERMINAL_SCALE;
        else { const a = dirOf(i - 1), b = dirOf(i); if (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180 / Math.PI > CORNER_DEG) post = TERMINAL_SCALE; }
        bays.push({ ax: pts[i][0], ay: ys[i], az: pts[i][1], dx: pts[i + 1][0] - pts[i][0], dy: ys[i + 1] - ys[i], dz: pts[i + 1][1] - pts[i][1], post });
      }
      const k = pts.length - 1, u = dirOf(k - 1);
      bays.push({ ax: pts[k][0], ay: ys[k], az: pts[k][1], dx: u[0] * 0.001, dy: 0, dz: u[1] * 0.001, post: TERMINAL_SCALE });
    }
  }
  return bays;
}

// One bay's geometry in its own frame (x along the bay from 0 to 1, stretched to the bay's length by the vertex shader;
// y up; z across), in one BufferGeometry so a chunk of fence is one draw. fenceKind: 0 post and cap (not stretched,
// widened at terminal and corner posts), 1 top rail and bottom wire (stretched), 2 the mesh panel (stretched).
function bayGeometry() {
  const THREE = window.CITY.THREE;
  const { mergeGeometries } = window.CITY.Addons;
  const piece = (geo, kind, keepEnds = true, noBottom = false) => {
    // (BoxGeometry draws +x, -x, +y, -y, +z, -z, six indices a face: the ends hide in the posts; the underside is never seen)
    if (!keepEnds) geo.setIndex(Array.from(geo.index.array).slice(12));
    else if (noBottom) geo.setIndex(Array.from(geo.index.array).filter((_, i) => Math.floor(i / 6) !== 3));
    geo.deleteAttribute('uv');
    geo.setAttribute('fenceKind', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(kind), 1));
    return geo;
  };
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const postTop = FENCE_H + 0.06;
  const parts = [
    piece(box(POST_SIZE, postTop, POST_SIZE, 0, postTop / 2, 0), 0, true, true),                     // post (no underside)
    piece(box(POST_SIZE + 0.03, 0.035, POST_SIZE + 0.03, 0, postTop + 0.0175, 0), 0, true, true),     // post cap (no underside)
    piece(box(1, RAIL_SIZE, RAIL_SIZE, 0.5, FENCE_H + 0.02, 0), 1, false),                          // top rail
    piece(new THREE.PlaneGeometry(1, 0.03).translate(0.5, 0.05, 0), 1),                              // bottom tension wire: a strip
    piece(new THREE.PlaneGeometry(1, FENCE_H - 0.07).translate(0.5, 0.05 + (FENCE_H - 0.07) / 2, 0), 2) // the mesh
  ];
  const geo = mergeGeometries(parts);
  // the vertex shader stretches a bay to 4 m at most: the culling spheres must reach that far
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(-0.15, -0.1, -0.1), new THREE.Vector3(BAY_MAX_M + 0.15, postTop + 0.04, 0.1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(BAY_MAX_M / 2, 0.9, 0), BAY_MAX_M / 2 + 1.1);
  return geo;
}

// The one material of the whole fence (posts, rails, wire and mesh): blended (the mesh is see-through; the posts are
// opaque inside it, a 6 cm post drawn without depth writes is not worth a second draw call). The mesh is two families
// of wires crossing at 90 degrees on a 5 cm pitch, filtered by the pixel's footprint so that beyond a few metres the
// diamonds fade into an even grey veil instead of crawling.
function fenceMaterial() {
  const THREE = window.CITY.THREE;
  const { Fn, float, vec3, attribute, positionGeometry, positionLocal, positionWorld, positionView, screenCoordinate, vec2, vec4, dot, abs, fract, fwidth, mix, smoothstep, clamp, max, min, step, length, normalize } = window.CITY.TSL;
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0.15, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const kind = attribute('fenceKind', 'float');
  const bay = attribute('fenceBay', 'vec4'); // the bay's vector (x, y, z) and its post's width scale (w)

  material.positionNode = Fn(() => {
    const L = max(length(bay.xyz), 0.0001);
    const along = bay.xyz.div(L);
    const across = normalize(vec3(bay.z.negate(), 0, bay.x));
    const stretched = step(0.5, kind);
    const grow = along.mul(positionGeometry.x).mul(L.sub(1)).mul(stretched);
    const wide = along.mul(positionGeometry.x).add(across.mul(positionGeometry.z)).mul(bay.w.sub(1)).mul(float(1).sub(stretched));
    return positionLocal.add(grow).add(wide);
  })();

  // (a vec4: the shadow pass multiplies its alpha in)
  material.colorNode = vec4(mix(vec3(0.24, 0.26, 0.28), vec3(0.10, 0.11, 0.12), step(1.5, kind)), 1);

  material.opacityNode = Fn(() => {
    const dir = normalize(bay.xz);
    const a = dot(positionWorld.xz, dir).toVar();
    const v = positionWorld.y.toVar();
    const s1 = a.add(v).mul(0.70710678).toVar();
    const s2 = a.sub(v).mul(0.70710678).toVar();
    const w1 = fwidth(s1).toVar();
    const w2 = fwidth(s2).toVar();
    const w = max(max(w1, w2), 0.00005).toVar();
    const line = (s) => {
      const d = abs(fract(s.div(MESH_PITCH).add(0.5)).sub(0.5)).mul(MESH_PITCH);
      return clamp(float(WIRE_HALF).add(w.mul(0.5)).sub(d).div(w), 0, 1);
    };
    const c1 = line(s1).toVar();
    const c2 = line(s2).toVar();
    const lattice = c1.add(c2).sub(c1.mul(c2));
    const veil = smoothstep(MESH_PITCH * 0.3, MESH_PITCH * 0.75, w);
    const veilAlpha = mix(float(VEIL), float(VEIL_FAR), smoothstep(12, 60, positionView.z.negate()));
    const mesh = mix(lattice, veilAlpha, veil);
    return mix(float(1), mesh, step(1.5, kind));
  })();
  // the sun's shadow: posts and rails whole, the mesh as a stipple of SHADOW_VEIL (interleaved gradient noise on the shadow map's pixel)
  const noise = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
  material.maskShadowNode = noise.lessThan(SHADOW_VEIL).or(kind.lessThan(1.5));
  return material;
}

function build(scene) {
  const THREE = window.CITY.THREE;
  const data = window.CITY.SCHOOL_FENCES;
  if (!data || !Array.isArray(data.schools)) {
    console.warn('[schoolFences] the data did not load; no fences');
    return null;
  }
  const groundAt = (x, z) => (window.CITY.terrainHeightAt ? window.CITY.terrainHeightAt(x, z) : 0);
  // (the data covers the bigger map's frame; on ?map=detail the city stops sooner, so a bay outside the active frame is left out)
  const B = window.CITY.CITY_BOUNDS;
  const planned = planBays(data.schools, groundAt);
  const bays = B ? planned.filter((b) => b.ax > B.minX && b.ax < B.maxX && b.az > B.minZ && b.az < B.maxZ) : planned;

  const group = new THREE.Group();
  group.name = 'SchoolFences';
  const geometry = bayGeometry();
  const n = bays.length;
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  geometry.setAttribute('fenceBay', attr);
  const fence = new THREE.InstancedMesh(geometry, fenceMaterial(), n);
  fence.name = 'SchoolFence';
  fence.castShadow = !params || params.get('schoolFenceShadow') !== '0'; // (?schoolFenceShadow=0: no sun shadow, to measure what it costs)
  fence.receiveShadow = true;
  fence.userData.cullDistance = CULL_M;
  fence.userData.cullCell = CULL_CELL_M;
  fence.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const m = new THREE.Matrix4();
  bays.forEach((b, i) => {
    const horiz = Math.hypot(b.dx, b.dz) || 1e-6, ux = b.dx / horiz, uz = b.dz / horiz, l3 = Math.hypot(b.dx, b.dy, b.dz) || 1e-6;
    // x -> along the bay (with the ground's rise), y -> up, z -> the horizontal normal; the vertex shader stretches x to the bay
    m.set(b.dx / l3, 0, -uz, b.ax, b.dy / l3, 1, 0, b.ay, b.dz / l3, 0, ux, b.az, 0, 0, 0, 1);
    fence.setMatrixAt(i, m);
    attr.setXYZW(i, b.dx, b.dy, b.dz, b.post);
  });
  fence.instanceMatrix.needsUpdate = true;
  fence.computeBoundingSphere();
  group.add(fence);
  scene.add(group);
  const stats = { schools: data.schools.length, runs: data.schools.reduce((k, s) => k + s.runs.length, 0), bays: n, draws: 1, metres: data.counts ? data.counts.metres : null, postSizeM: POST_SIZE, meshPitchM: MESH_PITCH, veil: VEIL };
  window.CITY.schoolFencesStats = stats;
  console.info(`[schoolFences] ${stats.schools} schools, ${stats.runs} runs, ${stats.bays} bays, one material${stats.metres ? `, ${stats.metres.toFixed(0)} m of fence` : ''}`);
  return group;
}

// The numeric proof: instances within radius, the nearest instance and its terrain, visibility and material settings.
// scene-culling.js replaces the one mesh with chunk meshes (named ...Bucket/...Band), so the probe walks the whole group.
function probe(x, z, radius = 150) {
  const THREE = window.CITY.THREE;
  const app = typeof window !== 'undefined' ? window.__CITY_APP : null;
  const scene = app && app.scene;
  const group = scene ? scene.getObjectByName('SchoolFences') : null;
  const out = { groupInScene: !!group, sceneHasGroup: !!scene, meshes: 0, meshesVisible: 0, instances: 0, within: 0, nearest: null, materials: [], stats: window.CITY.schoolFencesStats || null };
  if (!group) return out;
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  group.traverse((o) => {
    if (!o.isMesh) return;
    out.meshes++;
    if (o.visible) out.meshesVisible++;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mat && out.materials.length < 2) out.materials.push({ name: o.name, transparent: !!mat.transparent, depthWrite: mat.depthWrite });
    if (!o.isInstancedMesh) return;
    out.instances += o.count;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > radius) continue;
      out.within++;
      if (!out.nearest || d < out.nearest.dist) out.nearest = { name: o.name, x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: +p.y.toFixed(3), dist: +d.toFixed(2), terrain: +(window.CITY.terrainHeightAt ? window.CITY.terrainHeightAt(p.x, p.z) : 0).toFixed(3) };
    }
  });
  return out;
}

if (window.CITY && params && params.get('schoolFences') !== '0' && !(loader && loader.cityDesktop === false)) {
  window.CITY.buildSchoolFences = build;
  window.CITY.schoolFencesPlan = planBays;
  window.CITY.schoolFencesProbe = probe;
} else {
  // (?schoolFences=0, a phone or a low tier: nothing is built or fetched)
  window.CITY.buildSchoolFences = () => null;
  window.CITY.schoolFencesPlan = planBays;
  window.CITY.schoolFencesProbe = probe;
}
})();