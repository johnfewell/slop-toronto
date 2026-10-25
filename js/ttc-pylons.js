(function () {
// js/ttc-pylons.js
// The TTC's subway insignia pylon at every station entrance (the "Insignia Pylon, w/ Entry ID Sign" the TTC adopted;
// as at King & Yonge in 2026 Street View): a slim dark pole on a base plate, topped by the TTC insignia (a thick lit
// sign cut to the logo's own outline, printed with assets/props/ttc-logo.webp, the TTC's artwork as John supplied it)
// and, lower on the same pole on its collar, the black entry ID sign: the station's name in white, the numbered discs
// of the lines it serves (yellow 1, green 2, as on the stations' own ID signs) and the accessibility symbol for an
// accessible station (OpenStreetMap wheelchair=yes), with the line colour along its top edge (split for two lines).
// assets/props/ttc-pylon.glb from tools/blender/bake_props.py ttc-pylon. Where they stand: subway.js (one per entrance,
// at the curb abreast of its stairway, the ID sign reaching out over the sidewalk; its colliders too). Every station's
// ID face is drawn once into a canvas atlas and each pylon reads its own cell (a per-instance attribute): all the
// pylons are one instanced mesh, one draw call. The insignia & the ID sign are lit: they glow after dark.
// The older sign, where Street View shows it still stands (tools/geo-subway.mjs LANTERNS, the entrance's `sign`): the
// square lit TTC lantern, on its pole's top or hung from an arm off it (assets/props/ttc-lantern.glb, bake_props.py
// ttc-lantern), its four sides printed with the logo, no name (the real ones carry none). The lanterns share the pylons'
// mesh & material: the merged geometry holds all three signs, each vertex tagged with its sign, each instance with the
// one it shows, and the vertex stage folds the other two away (still one draw call, no new material). The poles are
// brushed stainless (as the real pylon at King & Yonge), the subway stairs' rail metal.

const { THREE, cityUniforms } = window.CITY;
const S = window.CITY.GEO_SUBWAY || { ways: [], stations: [] };

// The entry ID sign's face (1.30 x 0.30 m), as fractions of its width & height (the model's UVs run 0..1 over it, v
// down from the top): the line colour along the top, the name from the left, the line discs & the symbol at the right
const CELL_W = 512, CELL_H = 118;
const ID = { stripe: 0.06, pad: 0.04, nameSize: 0.5, baseline: 0.72, disc: 0.2, discGap: 0.05, symbol: 0.42 };
const LINE = { 1: ['#ffc72c', '#111111'], 2: ['#00923f', '#ffffff'], 4: ['#a21a68', '#ffffff'], 5: ['#f58025', '#111111'], 6: ['#959595', '#ffffff'] };
const COLOUR_LINE = { yellow: 1, green: 2, purple: 4, orange: 5, grey: 6 };
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
// A lantern side's printed panel (its UVs 0..1 over the panel unfolded) to the logo's UVs: the panel's width & height
// over the printed logo's (tools/blender/bake_props.py ttc-lantern prints them as LANTERN_LOGO)
const LANTERN_LOGO = { sx: 0.4261, sy: 1.1 };
// The stainless: the stair rails' (subway.js SubwayEntranceMetal), brushed along the pole
const STAINLESS = { color: 0x9aa0a5, roughness: 0.3, metalness: 0.85 };

function segDist(x, z, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(ax + ex * t - x, az + ez * t - z);
}
// The lines a station serves: every numbered line passing within 150 m of it (Bloor-Yonge, St George & Spadina: both)
function linesAt(x, z) {
  const out = new Set();
  for (const [name, , , , f] of S.ways) {
    const m = /Line (\d)/.exec(name);
    if (!m || out.has(+m[1])) continue;
    for (let i = 2; i < f.length; i += 2) if (segDist(x, z, f[i - 2], f[i - 1], f[i], f[i + 1]) < 150) { out.add(+m[1]); break; }
  }
  return [...out].sort();
}

// The wheelchair symbol, white on black inside a white rounded square (x, y the square's top left, s its side)
function accessSymbol(g, x, y, s) {
  g.fillStyle = '#ffffff';
  const r = s * 0.14;
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + s, y, x + s, y + s, r); g.arcTo(x + s, y + s, x, y + s, r); g.arcTo(x, y + s, x, y, r); g.arcTo(x, y, x + s, y, r);
  g.fill();
  g.strokeStyle = g.fillStyle = '#111111';
  g.lineWidth = s * 0.075;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const P = (u, v) => [x + u * s, y + v * s];
  g.beginPath(); g.arc(...P(0.52, 0.17), s * 0.075, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(...P(0.5, 0.3)); g.lineTo(...P(0.5, 0.6)); g.lineTo(...P(0.72, 0.6)); g.lineTo(...P(0.8, 0.84)); g.stroke();
  g.beginPath(); g.moveTo(...P(0.5, 0.42)); g.lineTo(...P(0.7, 0.42)); g.stroke();
  g.beginPath(); g.arc(...P(0.44, 0.66), s * 0.21, -0.55 * Math.PI, 0.25 * Math.PI, true); g.stroke();
}

function drawFace(g, ox, oy, { name, lines, access }) {
  const W = CELL_W, H = CELL_H;
  g.fillStyle = '#141414';
  g.fillRect(ox, oy, W, H);
  const st = ID.stripe * H;
  lines.forEach((l, i) => {
    g.fillStyle = (LINE[l] || LINE[1])[0];
    g.fillRect(ox + (i * W) / lines.length, oy, W / lines.length + 0.5, st);
  });
  // from the right: the symbol, then the line discs
  let x = ox + W - ID.pad * W;
  const cy = oy + st + (H - st) / 2;
  if (access) {
    const s = ID.symbol * H;
    accessSymbol(g, x - s, cy - s / 2, s);
    x -= s + ID.discGap * H;
  }
  const r = ID.disc * H;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const l of [...lines].reverse()) {
    const [bg, fg] = LINE[l] || LINE[1];
    g.fillStyle = bg;
    g.beginPath(); g.arc(x - r, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = fg;
    g.font = `bold ${r * 1.35}px ${FONT}`;
    g.fillText(String(l), x - r, cy + r * 0.06);
    x -= 2 * r + ID.discGap * H;
  }
  // the name, in capitals as on the stations' own signs, fitted to the room left
  const text = name.toUpperCase();
  const room = x - ox - 2 * ID.pad * W;
  let size = ID.nameSize * H;
  g.font = `bold ${size}px ${FONT}`;
  const w = g.measureText(text).width;
  if (w > room) size *= room / w;
  g.font = `bold ${size}px ${FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffffff';
  g.fillText(text, ox + ID.pad * W, oy + st + (ID.baseline - ID.stripe) * H + (ID.nameSize * H - size) * -0.35);
}

// The models' parts (one primitive per material) as one geometry, with each vertex's part: 0 the insignia's faces,
// 1 the ID sign's faces, 2 the insignia's edge, 3 the metal (poles, bases, collars, the ID sign's frame, the arm), 4 a
// lantern's printed sides, 5 its painted frame; and its sign (0 the insignia pylon, 1 the lantern on its pole, 2 on
// an arm). Each model's pole stands at its origin (the instance's point: its collider's centre)
const PARTS = ['logo', 'id', 'edge', 'metal', 'face', 'frame'];
function mergedSigns(pylon, lantern) {
  const geos = [], colours = [];
  const add = (gltf, signOf) => {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      // (the sign: the first of the mesh & its parents whose name says which)
      let sign = 0;
      for (let a = o; a; a = a.parent) {
        const s = signOf(a.name || '');
        if (s !== null) { sign = s; break; }
      }
      const part = Math.max(0, PARTS.findIndex((p) => (o.material.name || '').endsWith(p)));
      const src = o.geometry, n = src.attributes.position.count;
      const geo = new THREE.BufferGeometry();
      // (meshopt quantisation stores normalised integers: back to floats before the transform)
      for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
        const a = src.attributes[name], f = new Float32Array(n * size);
        if (a) for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) f[i * size + c] = a.getComponent(i, c);
        geo.setAttribute(name, new THREE.BufferAttribute(f, size));
      }
      geo.setAttribute('pylonPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
      geo.setAttribute('signKind', new THREE.BufferAttribute(new Float32Array(n).fill(sign), 1));
      geo.setIndex(src.index ? Array.from(src.index.array) : null);
      geo.applyMatrix4(o.matrixWorld);
      geos.push(geo);
      if (!colours[part]) colours[part] = o.material.color ? o.material.color.clone() : new THREE.Color(0x3a3c3f);
    });
  };
  add(pylon, () => 0);
  if (lantern) add(lantern, (name) => (/lantern-arm/.test(name) ? 2 : /lantern-top/.test(name) ? 1 : null));
  const geo = window.CITY.Addons.mergeGeometries(geos);
  // (the poles on the origin: the models are built so; only their bases go down to y = 0)
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0);
  geo.computeBoundingBox();
  return { geo, colours };
}

function pylonMaterial(logoTex, atlas, colours) {
  const { texture, uv, attribute, vec2, vec3, float, mix, step, smoothstep, abs, fract, sin, floor, atan, positionGeometry, positionLocal, select } = window.CITY.TSL;
  const part = attribute('pylonPart', 'float');
  const cell = attribute('pylonCell', 'vec2');
  const is = (k) => float(1).sub(step(0.5, abs(part.sub(k))));
  const isLogo = is(0), isId = is(1), isEdge = is(2), isFace = is(4), isFrame = is(5);
  // a lantern's side: the logo over its white panel (the panel's UVs to the logo's, and nothing beyond the logo)
  const luv = uv().sub(0.5).mul(vec2(LANTERN_LOGO.sx, LANTERN_LOGO.sy)).add(0.5);
  const inLogo = step(0.0, luv.x).mul(step(luv.x, 1.0)).mul(step(0.0, luv.y)).mul(step(luv.y, 1.0));
  const logo = texture(logoTex, mix(uv(), luv, isFace));
  const id = texture(atlas.tex, cell.add(uv().mul(vec2(CELL_W / atlas.W, CELL_H / atlas.H)))).rgb;
  const col = (c) => vec3(c.r, c.g, c.b);
  // brushed stainless: fine streaks along the pole (bands round it), the insignia's edge & the lanterns' paint
  const steel = new THREE.Color(STAINLESS.color);
  const streak = fract(sin(floor(atan(positionGeometry.z, positionGeometry.x).mul(24.0)).mul(91.7)).mul(437.5));
  const brushed = col(steel).mul(streak.mul(0.12).add(0.92));
  const metal = mix(mix(brushed, col(colours[2] || steel), isEdge), col(colours[5] || new THREE.Color(0xd6d2c6)), isFrame);
  // (the lanterns' panels a warm cream, as their frames in Street View, not paper white)
  const panel = col(new THREE.Color(0xe9e2cf));
  const face = mix(panel, logo.rgb, logo.a.mul(inLogo));
  const printed = mix(mix(logo.rgb, id, isId), face, isFace);
  const lit = isLogo.add(isId).add(isFace);
  const isSteel = float(1).sub(lit).sub(isEdge).sub(isFrame);
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = 'ttc-pylon';
  mat.colorNode = mix(metal, printed, lit);
  // (the insignia's faces cut to the logo: its outline was traced a little outside it)
  mat.opacityNode = mix(float(1), logo.a, isLogo);
  mat.alphaTest = 0.5;
  mat.roughnessNode = mix(mix(float(0.5), float(STAINLESS.roughness).add(streak.mul(0.08)), isSteel), float(0.3), lit);
  mat.metalnessNode = mix(mix(float(0.2).mul(isEdge), float(STAINLESS.metalness), isSteel), float(0.0), lit);
  // lit acrylic: lit by day too (it reads in a shaded street), glowing after dark
  const night = smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow);
  // (the lanterns' panels a little less by day: they read lit, not blank white)
  mat.emissiveNode = printed.mul(lit).mul(night.mul(0.8).add(float(0.18).sub(isFace.mul(0.1))));
  // each instance shows one sign: the others' vertices fold to a point (no triangles left)
  const shown = float(1).sub(step(0.5, abs(attribute('signKind', 'float').sub(attribute('pylonKind', 'float')))));
  mat.positionNode = select(shown.greaterThan(0.5), positionLocal, vec3(0.0));
  return mat;
}

async function buildTtcPylons(scene, pylons) {
  const group = new THREE.Group();
  group.name = 'TtcPylons';
  const { GLTFLoader, MeshoptDecoder } = window.CITY.Addons;
  if (!pylons || !pylons.length || !GLTFLoader || !MeshoptDecoder) return { group, count: 0 };
  let gltf, lantern, logoTex;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  try {
    [gltf, logoTex] = await Promise.all([
      loader.loadAsync('./assets/props/ttc-pylon.glb'),
      new THREE.TextureLoader().loadAsync('./assets/props/ttc-logo.webp')
    ]);
  } catch (e) {
    console.warn('[ttcPylons] the pylon model or the logo did not load:', e);
    return { group, count: 0 };
  }
  try {
    lantern = await loader.loadAsync('./assets/props/ttc-lantern.glb');
  } catch (e) {
    console.warn('[ttcPylons] the lantern model did not load (insignia pylons everywhere):', e);
  }
  // Each station's face, once: its name, lines & accessibility
  const faces = new Map();
  const faceOf = (p) => {
    const st = S.stations.find((s) => s[2] === p.station);
    let lines = st ? linesAt(st[0], st[1]) : [];
    if (!lines.length) lines = [COLOUR_LINE[p.colour] || 1];
    const f = { name: p.station, lines, access: !!(st && st[4]) };
    const key = `${f.name}|${f.lines.join(',')}|${f.access ? 1 : 0}`;
    if (!faces.has(key)) faces.set(key, { ...f, i: faces.size });
    return faces.get(key).i;
  };
  const idx = pylons.map(faceOf);
  logoTex.colorSpace = THREE.SRGBColorSpace;
  logoTex.flipY = false; // (glTF UVs: v down from the logo's top)
  logoTex.anisotropy = 8;
  logoTex.needsUpdate = true;
  const cols = 4, rows = Math.ceil(faces.size / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * CELL_W;
  canvas.height = rows * CELL_H;
  const g = canvas.getContext('2d');
  for (const f of faces.values()) drawFace(g, (f.i % cols) * CELL_W, Math.floor(f.i / cols) * CELL_H, f);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false; // (glTF UVs: v down from the face's top, as the canvas)
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const atlas = { tex, W: canvas.width, H: canvas.height };

  const { geo, colours } = mergedSigns(gltf, lantern);
  const n = pylons.length;
  const cellAttr = new Float32Array(n * 2), kindAttr = new Float32Array(n);
  const mesh = new THREE.InstancedMesh(geo, pylonMaterial(logoTex, atlas, colours), n);
  mesh.name = 'TtcPylons';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  pylons.forEach((pl, i) => {
    p.set(pl.x, pl.y, pl.z);
    q.setFromAxisAngle(up, pl.yaw);
    m.compose(p, q, sc);
    mesh.setMatrixAt(i, m);
    cellAttr[2 * i] = ((idx[i] % cols) * CELL_W) / atlas.W;
    cellAttr[2 * i + 1] = (Math.floor(idx[i] / cols) * CELL_H) / atlas.H;
    kindAttr[i] = lantern ? pl.sign || 0 : 0;
  });
  geo.setAttribute('pylonCell', new THREE.InstancedBufferAttribute(cellAttr, 2));
  geo.setAttribute('pylonKind', new THREE.InstancedBufferAttribute(kindAttr, 1));
  mesh.instanceMatrix.needsUpdate = true;
  // (no shadows: one city-wide instanced mesh can't be culled by the shadow cascades, and drawing all 86 alpha-cut
  // pylons into both of them cost ~3-4 ms a frame on the M4 mini; a thin pole's shadow hardly reads)
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
  scene.add(group);
  const nl = [...kindAttr].filter((k) => k > 0).length;
  console.info(`[ttcPylons] ${n - nl} insignia pylons & ${nl} lanterns (${[...kindAttr].filter((k) => k === 2).length} on arms), ${faces.size} station faces (atlas ${atlas.W} x ${atlas.H})`);
  return { group, count: n, faces: [...faces.values()] };
}

Object.assign(window.CITY, { buildTtcPylons });
})();
