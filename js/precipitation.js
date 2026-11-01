(function () {
// js/precipitation.js
// Falling rain or snow for the live sky (live-sky.js, docs/live-sky.md): one mesh of camera-facing quads in a box that
// travels with the camera, every drop moved on the GPU (its seed, the shader clock and the camera position; nothing is
// updated per drop on the CPU). Built the first time a live reading calls for it, so a dry sky costs nothing: no mesh,
// no draw, no shader. One draw call, no shadow, no depth write; hidden indoors (subway, a seat inside a streetcar).

const { THREE, TSL } = window.CITY;
const { Fn, attribute, uniform, renderGroup, vec2, vec3, vec4, float, mod, normalize, cross, length, smoothstep, time, cameraPosition, mix, sin } = TSL;

const KINDS = {
  // streaks: a raindrop's blur over a short exposure, falling ~8 m/s. Sizes are half-extents in metres; the width grows
  // with distance (px: metres per metre of distance) so a streak stays a hairline (about 1.3 px at 900 px tall) near or far
  rain: { box: 34, height: 18, speed: 8.5, len: 0.2, width: 0.0015, px: 0.0009, near: [1.5, 4], alpha: 0.22, tint: [0.8, 0.84, 0.9], drift: 0.6 },
  // flakes: ~1 m/s, swaying; round, a couple of pixels at least
  snow: { box: 28, height: 14, speed: 1.1, len: 0.014, width: 0.014, px: 0.0021, near: [0.6, 1.6], alpha: 0.9, tint: [0.96, 0.97, 1.0], drift: 0.35 }
};

function createPrecipitation(scene, { quality = window.CITY.QUALITY } = {}) {
  const meshes = {};
  const uAmount = uniform(0).setGroup(renderGroup);
  const uBright = uniform(1).setGroup(renderGroup);
  let current = null;

  function build(kind) {
    const K = KINDS[kind];
    // (fewer on the phone tiers: quality.js low/medium)
    const full = kind === 'rain' ? 7000 : 4500;
    const n = Math.round(full * (quality && quality.tier === 'low' ? 0.35 : quality && quality.tier === 'medium' ? 0.6 : 1));
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
    // the drop's place in the box that follows the camera: its seed, minus the fall (and a slow drift), wrapped
    const centre = Fn(() => {
      const t = time.mul(float(0.8).add(seed.w.mul(0.4)));
      const sway = kind === 'snow' ? vec3(sin(t.mul(0.9).add(seed.w.mul(40))).mul(0.4), 0, sin(t.mul(0.7).add(seed.x.mul(40))).mul(0.4)) : vec3(0);
      const p = seed.xyz.mul(box).add(vec3(t.mul(K.drift), t.mul(-K.speed), t.mul(K.drift * 0.5))).add(sway);
      const rel = mod(p.sub(cameraPosition).add(box.mul(0.5)), box).sub(box.mul(0.5));
      return cameraPosition.add(rel);
    })();
    mat.positionNode = Fn(() => {
      const c = centre.toVar();
      const toCam = cameraPosition.sub(c);
      const up = kind === 'rain' ? normalize(vec3(K.drift / K.speed, 1, K.drift * 0.5 / K.speed)) : normalize(cross(toCam, normalize(cross(vec3(0, 1, 0), toCam))));
      const right = normalize(cross(up, toCam));
      const d = length(toCam);
      const w = d.mul(K.px).max(K.width);
      const h = kind === 'rain' ? float(K.len) : w;
      return c.add(right.mul(corner.x.mul(w))).add(up.mul(corner.y.mul(2).sub(1).mul(h)));
    })();
    // fade at the box's edge (no popping as drops wrap) and right in front of the lens; fewer drops in a drizzle
    const dist = length(centre.sub(cameraPosition));
    const keep = seed.w.lessThan(uAmount).select(1, 0);
    const fade = smoothstep(K.box * 0.5, K.box * 0.3, dist).mul(smoothstep(K.near[0], K.near[1], dist));
    // (a streak thins toward its tail; a flake is a soft disc)
    const shape = kind === 'rain' ? mix(0.55, 1, corner.y) : smoothstep(1, 0.45, length(vec2(corner.x, corner.y.mul(2).sub(1))));
    const tint = vec3(...K.tint).mul(uBright);
    mat.colorNode = vec4(tint, 1);
    mat.opacityNode = fade.mul(keep).mul(K.alpha).mul(shape);
    const mesh = new THREE.Mesh(geo, mat);
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
      if (kind && !meshes[kind]) meshes[kind] = build(kind);
      for (const k of Object.keys(meshes)) meshes[k].visible = k === kind;
      uAmount.value = kind ? Math.min(1, Math.max(0.1, look.amount ?? 1)) : 0;
      uBright.value = brightness;
    },
    // indoors (the subway, a seat inside a streetcar): nothing falls
    update(sheltered) {
      if (current && meshes[current]) meshes[current].visible = !sheltered;
    },
    get kind() { return current; },
    get built() { return Object.keys(meshes); }
  };
}

Object.assign(window.CITY, { createPrecipitation });
})();
