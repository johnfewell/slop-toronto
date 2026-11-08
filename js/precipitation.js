(function () {
// js/precipitation.js
// Falling rain or snow for the live sky (live-sky.js, docs/live-sky.md), in a box that travels with the camera; every
// drop is moved on the GPU (its seed, the shader clock and the camera position; nothing is updated per drop on the CPU).
// Built the first time a live reading calls for it, so a dry sky costs nothing: no mesh, no draw, no shader. One draw
// call, no shadow, no depth write; hidden indoors (subway, a seat inside a streetcar).
// Rain is one-pixel line segments (the cheapest primitive a GPU draws): a streak, the drop's blur over a short exposure,
// bright at its head and fading out to nothing at its tail, each drop at its own speed, slanted by the wind. Its colour
// comes from the sky: the fog's colour (the light a drop refracts), a little darker, and near a streetlight at night
// the lamp's light. Snow is soft camera-facing discs.

const { THREE, TSL } = window.CITY;
const { Fn, attribute, uniform, renderGroup, varying, vec2, vec3, vec4, float, mod, normalize, cross, length, smoothstep, time, cameraPosition, sin, max } = TSL;

const KINDS = {
  // streaks: ~8.5 m/s give or take a third (drop sizes), the streak as long as a 1/18 s exposure; 60,000 in a box of 40 x 20 x 40 m
  // and fades from 12 m out, so a drop never pops as it wraps. Line segments are one pixel wide at any distance
  rain: { lines: true, count: 60000, box: 40, height: 20, speed: 8.5, spread: 0.35, exposure: 0.055, near: [1.0, 3.0], alpha: 0.55 },
  // flakes: ~1 m/s, swaying; round, a couple of pixels at least
  snow: { count: 4500, box: 28, height: 14, speed: 1.1, len: 0.014, width: 0.014, px: 0.0021, near: [0.6, 1.6], alpha: 0.9, tint: [0.96, 0.97, 1.0], drift: 0.35 }
};
// The wind the rain leans in, m/s (x east, z south). live-sky.js reads no wind yet (st-cxgv), so a modest westerly
// breeze: about 12 degrees off vertical at the rain's speed. set(look) takes look.wind = [x, z] when a reading has one
const DEFAULT_WIND = [1.6, 0.8];
const LAMPS = 4; // the nearest streetlights whose light the drops catch at night (street-details.js's spot pool)

function createPrecipitation(scene, { quality = window.CITY.QUALITY } = {}) {
  const meshes = {};
  const uAmount = uniform(0).setGroup(renderGroup);
  const uBright = uniform(1).setGroup(renderGroup);
  const uWind = uniform(new THREE.Vector3(DEFAULT_WIND[0], 0, DEFAULT_WIND[1])).setGroup(renderGroup);
  // the sky's colour the drops refract: the fog's (lighting.js updates that Color in place, so this follows it)
  const uSky = uniform(scene.fog && scene.fog.color ? scene.fog.color : new THREE.Color(0x9aa3ad)).setGroup(renderGroup);
  const uLamps = Array.from({ length: LAMPS }, () => uniform(new THREE.Vector4(0, -1000, 0, 0)).setGroup(renderGroup));
  const tierScale = quality && quality.tier === 'low' ? 0.35 : quality && quality.tier === 'medium' ? 0.6 : 1;
  let current = null, spots = null;

  // the drop's place in the box that follows the camera: its seed, plus its fall since the clock started, wrapped
  const wrap = (p, box) => cameraPosition.add(mod(p.sub(cameraPosition).add(box.mul(0.5)), box).sub(box.mul(0.5)));

  function buildLines(kind) {
    const K = KINDS[kind];
    const n = Math.round(K.count * tierScale);
    // two vertices per drop: the head (end 0) and the tail (end 1), the same seed on both
    const seeds = new Float32Array(n * 2 * 4), ends = new Float32Array(n * 2), pos = new Float32Array(n * 2 * 3), normals = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      seeds.set(s, i * 8); seeds.set(s, i * 8 + 4);
      ends[i * 2 + 1] = 1;
      normals[i * 6 + 2] = 1; normals[i * 6 + 5] = 1; // (the scene pass's MRT reads a normal)
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

    const mat = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
    const seed = attribute('aSeed', 'vec4');
    const end = attribute('aEnd', 'float');
    const box = vec3(K.box, K.height, K.box);
    // each drop's own speed (a drizzle's small drops fall slower), and its own share of the wind
    const speed = float(K.speed).mul(float(1 - K.spread).add(seed.w.mul(2 * K.spread))).mul(uAmount.mul(0.45).add(0.55));
    const gust = seed.x.mul(0.3).add(0.85);
    const velocity = vec3(uWind.x.mul(gust), speed.negate(), uWind.z.mul(gust));
    const head = wrap(seed.xyz.mul(box).add(velocity.mul(time)), box);
    // the tail trails the head back along the drop's path, the exposure's worth
    const point = head.sub(velocity.mul(end.mul(K.exposure)));
    mat.positionNode = point;
    // (all per drop, in the vertex stage) the box edge & the lens fades, drizzle's fewer drops, the head-to-tail fade
    const dist = length(head.sub(cameraPosition));
    const keep = seed.w.lessThan(uAmount).select(1, 0);
    const fade = smoothstep(K.box * 0.5, K.box * 0.3, dist).mul(smoothstep(K.near[0], K.near[1], dist));
    // the streetlights' light on the drops near them, mostly below the lamp
    const lampLight = Fn(() => {
      let sum = float(0);
      for (const L of uLamps) {
        const d = length(head.sub(L.xyz));
        const below = smoothstep(1.5, -2.0, head.y.sub(L.y));
        sum = sum.add(L.w.mul(smoothstep(10.0, 0.0, d)).mul(below.mul(0.7).add(0.3)));
      }
      return sum;
    })();
    const lit = varying(lampLight);
    const alpha = varying(fade.mul(keep).mul(float(1).sub(end)));
    // the sky's colour, a little darker in daylight (uBright: the light the drops catch); at night the lit city's
    // glow (uInteriorGlow, the presets' night lift) and a nearby lamp's warm white
    const glow = window.CITY.cityUniforms ? window.CITY.cityUniforms.uInteriorGlow : float(0.5);
    const night = smoothstep(0.5, 1.4, glow);
    // (a bright grey noon sky, against pale walls: a little darker still and a little denser, so the streaks still read)
    const noon = smoothstep(0.58, 0.7, uSky.r.mul(0.2126).add(uSky.g.mul(0.7152)).add(uSky.b.mul(0.0722)));
    const sky = uSky.mul(uBright.mul(0.2).add(0.4).sub(noon.mul(0.32))).add(vec3(0.05, 0.047, 0.042).mul(night));
    mat.colorNode = vec4(sky.add(vec3(1.0, 0.93, 0.82).mul(lit.mul(1.4))), 1);
    mat.opacityNode = alpha.mul(K.alpha).mul(lit.mul(0.8).add(1).min(1.8)).mul(noon.mul(0.3).add(1));
    const mesh = new THREE.LineSegments(geo, mat);
    return finish(mesh, kind, n);
  }

  // snow: camera-facing quads, each a soft disc
  function buildQuads(kind) {
    const K = KINDS[kind];
    const n = Math.round(K.count * tierScale);
    const seeds = new Float32Array(n * 4 * 4), corners = new Float32Array(n * 4 * 2), pos = new Float32Array(n * 4 * 3);
    const index = new Uint32Array(n * 6);
    const C = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
    for (let i = 0; i < n; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let c = 0; c < 4; c++) {
        seeds.set(s, (i * 4 + c) * 4);
        corners.set(C[c], (i * 4 + c) * 2);
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const normals = new Float32Array(n * 4 * 3);
    for (let j = 2; j < normals.length; j += 3) normals[j] = 1; // (the scene pass's MRT reads a normal)
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const seed = attribute('aSeed', 'vec4');
    const corner = attribute('aCorner', 'vec2');
    const box = vec3(K.box, K.height, K.box);
    const centre = Fn(() => {
      const t = time.mul(float(0.8).add(seed.w.mul(0.4)));
      const sway = vec3(sin(t.mul(0.9).add(seed.w.mul(40))).mul(0.4), 0, sin(t.mul(0.7).add(seed.x.mul(40))).mul(0.4));
      const p = seed.xyz.mul(box).add(vec3(t.mul(K.drift), t.mul(-K.speed), t.mul(K.drift * 0.5))).add(sway);
      return wrap(p, box);
    })();
    mat.positionNode = Fn(() => {
      const c = centre.toVar();
      const toCam = cameraPosition.sub(c);
      const up = normalize(cross(toCam, normalize(cross(vec3(0, 1, 0), toCam))));
      const right = normalize(cross(up, toCam));
      const d = length(toCam);
      const w = max(d.mul(K.px), K.width);
      return c.add(right.mul(corner.x.mul(w))).add(up.mul(corner.y.mul(2).sub(1).mul(w)));
    })();
    // fade at the box's edge (no popping as drops wrap) and right in front of the lens; fewer drops in a drizzle
    const dist = length(centre.sub(cameraPosition));
    const keep = seed.w.lessThan(uAmount).select(1, 0);
    const fade = smoothstep(K.box * 0.5, K.box * 0.3, dist).mul(smoothstep(K.near[0], K.near[1], dist));
    const shape = smoothstep(1, 0.45, length(vec2(corner.x, corner.y.mul(2).sub(1))));
    mat.colorNode = vec4(vec3(...K.tint).mul(uBright), 1);
    mat.opacityNode = fade.mul(keep).mul(K.alpha).mul(shape);
    return finish(new THREE.Mesh(geo, mat), kind, n);
  }

  function finish(mesh, kind, n) {
    mesh.name = `Precipitation (${kind})`;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 10;
    mesh.visible = false;
    scene.add(mesh);
    console.info(`[precipitation] ${kind}: ${n} drops, one draw`);
    return mesh;
  }

  return {
    // look: a live-sky WEATHER_LOOKS entry, or null for none. brightness: the light the drops catch (0..1)
    set(look, brightness = 1) {
      const kind = look && look.precip && KINDS[look.precip] ? look.precip : null;
      current = kind;
      if (kind && !meshes[kind]) meshes[kind] = KINDS[kind].lines ? buildLines(kind) : buildQuads(kind);
      for (const k of Object.keys(meshes)) meshes[k].visible = k === kind;
      uAmount.value = kind ? Math.min(1, Math.max(0.1, look.amount ?? 1)) : 0;
      uBright.value = brightness;
      const wind = look && Array.isArray(look.wind) ? look.wind : DEFAULT_WIND;
      uWind.value.set(wind[0], 0, wind[1]);
    },
    // indoors (the subway, a seat inside a streetcar): nothing falls. At night the streetlights nearest the camera
    // (street-details.js sorts its spot pool nearest first) lend the rain their light
    update(sheltered) {
      if (!current || !meshes[current]) return;
      meshes[current].visible = !sheltered;
      if (current !== 'rain' || sheltered) return;
      if (spots === null) {
        const group = scene.getObjectByName('StreetClusteredLights');
        spots = group ? group.children.filter((o) => o.isSpotLight) : [];
      }
      for (let i = 0; i < LAMPS; i++) {
        const s = spots[i], v = uLamps[i].value;
        if (s && s.intensity > 0) v.set(s.position.x, s.position.y, s.position.z, Math.min(1.5, s.intensity / 92));
        else v.set(0, -1000, 0, 0);
      }
    },
    get kind() { return current; },
    get built() { return Object.keys(meshes); }
  };
}

Object.assign(window.CITY, { createPrecipitation });
})();
