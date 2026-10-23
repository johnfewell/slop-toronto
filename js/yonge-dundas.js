(function () {
// js/yonge-dundas.js
// Yonge & Dundas, Toronto's Times Square: big animated screens on every building wall that faces the intersection
// along Yonge or Dundas, one or two tiers above the shopfronts, each in a dark bezel. The content is procedural (TSL):
// slides of colour fields, a hero shape, headline bars and a running ticker, changing every seven seconds, each screen
// on its own clock. One merged mesh, unlit, so the screens glow by day and bloom at night.

const { THREE, TSL } = window.CITY;
const { GEO } = window.CITY;

// the intersection (world frame: Yonge runs along z at x ~326, Dundas along x at z ~-1178)
const IX = 326, IZ = -1178;
const REACH = 120; // metres along each street
const FRONT = 40; // how far back from the street centre line a wall may stand

function hash(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function createScreenMaterial() {
  const { Fn, attribute, uv, time, vec2, vec3, float, mix, step, smoothstep, fract, floor, sin, cos, length, max, hash: h } = TSL;
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const S = attribute('aScreen', 'vec3'); // seed, aspect (w / h), bezel
    const u = uv();
    const t = time.add(S.x.mul(13.0));
    const slide = floor(t.div(7.0));
    const k = fract(t.div(7.0));
    const h1 = h(slide.add(S.x.mul(31.7)));
    const h2 = h(slide.mul(1.37).add(S.x.mul(17.1)).add(3.0));
    const h3 = h(slide.mul(2.11).add(S.x.mul(5.3)).add(9.0));
    const pal = (c) => vec3(0.5).add(vec3(0.5).mul(cos(vec3(c).add(vec3(0.0, 0.33, 0.67)).mul(6.2832))));
    const p = vec2(u.x.mul(S.y), u.y);
    // a colour field drifting between two hues of the slide's palette
    const bg = mix(pal(h1.add(0.35)), pal(h1), u.y.add(sin(u.x.mul(3.0).add(t.mul(0.6))).mul(0.15)));
    // the hero: a drifting disc, or bold stripes sweeping across
    const centre = vec2(S.y.mul(mix(0.3, 0.72, h2)).add(sin(t.mul(0.5)).mul(0.06).mul(S.y)), 0.56);
    const disc = smoothstep(0.31, 0.29, length(p.sub(centre)));
    const stripes = step(0.5, fract(p.x.mul(1.1).add(u.y.mul(0.7)).sub(t.mul(0.3)))).mul(step(0.22, u.y));
    const hero = mix(disc, stripes.mul(0.55), step(0.55, h3));
    // headline bars, top left
    const bar1 = step(0.78, u.y).mul(step(u.y, 0.86)).mul(step(u.x, mix(0.32, 0.62, h2))).mul(step(0.05, u.x));
    const bar2 = step(0.67, u.y).mul(step(u.y, 0.72)).mul(step(u.x, mix(0.22, 0.45, h1))).mul(step(0.05, u.x));
    // the ticker along the bottom
    const band = step(u.y, 0.17);
    const ticks = step(fract(p.x.mul(1.7).sub(t.mul(0.9))), 0.55).mul(step(0.055, u.y)).mul(step(u.y, 0.115));
    let col = mix(bg.mul(bg), pal(h1.add(0.5)), hero);
    col = mix(col, vec3(1.0), max(bar1, bar2.mul(0.85)));
    col = mix(col, vec3(0.05, 0.05, 0.07), band);
    col = mix(col, vec3(1.0, 0.86, 0.35), ticks.mul(band));
    // each slide comes up out of black
    col = col.mul(mix(float(0.1), float(1.0), smoothstep(0.0, 0.035, k)));
    return mix(col.mul(1.35), vec3(0.025, 0.026, 0.03), S.z);
  })();
  return mat;
}

function buildYongeDundas(scene) {
  const pos = [], uvs = [], scr = [];
  const quad = (cx, cy, cz, tx, tz, nx, nz, w, hgt, out, seed, bezel) => {
    const x = cx + nx * out, z = cz + nz * out;
    const L = [x - tx * w / 2, z - tz * w / 2], R = [x + tx * w / 2, z + tz * w / 2];
    const v = [[L[0], cy, L[1]], [R[0], cy, R[1]], [R[0], cy + hgt, R[1]], [L[0], cy + hgt, L[1]]];
    const uv4 = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...v[i]);
      uvs.push(...uv4[i]);
      scr.push(seed, w / hgt, bezel);
    }
  };
  let n = 0;
  for (const [cx, cz, ang, parts, h] of GEO.buildings) {
    if (h < 10 || Math.hypot(cx - IX, cz - IZ) > REACH + 60) continue;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    for (const [u0, u1, v0, v1] of parts) {
      for (const [nu, nv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const faceW = nu ? v1 - v0 : u1 - u0;
        if (faceW < 6) continue;
        const fu = nu ? (nu > 0 ? u1 : u0) : (u0 + u1) / 2;
        const fv = nv ? (nv > 0 ? v1 : v0) : (v0 + v1) / 2;
        // world: x = cx + u cs + v sn, z = cz - u sn + v cs (as signage.js)
        const fx = cx + fu * cs + fv * sn, fz = cz - fu * sn + fv * cs;
        const nx = nu * cs + nv * sn, nz = -nu * sn + nv * cs;
        const onYonge = Math.abs(nx) > 0.85 && (IX - fx) * nx > 0 && Math.abs(fx - IX) < FRONT && Math.abs(fz - IZ) < REACH;
        const onDundas = Math.abs(nz) > 0.85 && (IZ - fz) * nz > 0 && Math.abs(fz - IZ) < FRONT && Math.abs(fx - IX) < REACH;
        if (!onYonge && !onDundas) continue;
        const tx = nz, tz = -nx; // along the wall, left to right seen from the street
        const w = Math.min(faceW * 0.85, 28);
        let y = 4.6;
        // the first tier over the shopfronts, a taller one above it where the wall rises far enough
        for (const [ratio, cap] of [[0.56, 13], [0.75, 20]]) {
          const hgt = Math.min(w * ratio, cap, h - y - 1.2);
          if (hgt < 3.2) break;
          const seed = hash(fx + y, fz - y);
          quad(fx, y - 0.25, fz, tx, tz, nx, nz, w + 0.5, hgt + 0.5, 0.18, seed, 1);
          quad(fx, y, fz, tx, tz, nx, nz, w, hgt, 0.3, seed, 0);
          n++;
          y += hgt + 1.8;
        }
      }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aScreen', new THREE.Float32BufferAttribute(scr, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, createScreenMaterial());
  mesh.name = 'YongeDundasScreens';
  scene.add(mesh);
  console.info(`[yongeDundas] ${n} screens`);
  return mesh;
}

Object.assign(window.CITY, { buildYongeDundas });
})();
