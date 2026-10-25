(function () {
// js/park-signs.js
// The City's park name signs ("A CITY WITHIN A PARK"), one at the main entrance of every named City park
// (GEO.props.parkSign, tools/geo-parksigns.mjs), each printed with its own park's name and address.
// One instanced mesh for all of them (assets/props/park-sign.glb, tools/blender/bake_props.py park-sign: blue posts,
// the arched panel & its silver trim, an aluminium back, the printed face; its parts merged, one material). The face is
// the blank face template (assets/props/park-sign-face.webp, from John's photo of Ritchie Avenue Parkette) with each
// park's lettering on top: the names & addresses are drawn once into a mask atlas (one park per colour channel of a
// cell, four to a cell) and each instance reads its own cell & channel (per-instance attributes), so every sign is
// still one draw call. Each sign gets a collider (the rider can't pass through it); scene-culling.js chunks & culls them.

const { THREE, GEO, CITY_BOUNDS, blockAt } = window.CITY;

// The face template's frame (px, 2048 x 1072, y down; the model's face UVs run 0..1 over it): where the name & the
// address go, and the atlas cell they're drawn into at a quarter of that size
const TPL_W = 2048, TPL_H = 1072;
const NAME = { x0: 0, x1: 2048, y0: 200, y1: 648 };   // the silver between the tagline and the mosaic
const ADDR = { x0: 0, x1: 768, y0: 840, y1: 1032 };   // the blue band's left end
const K = 0.25;                                        // atlas px per face px
const CELL_W = 512, NAME_H = (NAME.y1 - NAME.y0) * K, CELL_H = NAME_H + (ADDR.y1 - ADDR.y0) * K; // 512 x 160
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const INK = 0x0a417f;   // the name's royal blue (John's photo, against the template's own band blue)
const PAPER = 0xf4f6f8; // the address's white
const CULL = 220;       // m

// Measured off John's photo (face-rectified.jpg): name caps 190 px, two lines on baselines 408 & 620, "Ritchie Avenue"
// 1244 px wide (a condensed bold: Helvetica Bold drawn narrower to match); the address's number 145 px tall from x 84,
// baseline 1009, and its street name in two lines (caps 56 px, baselines 923 & 1006) 43 px to the number's right
function layoutName(ctx, name) {
  const cap = 190, size = cap / 0.72, maxW = 1780;
  ctx.font = `bold ${size}px ${FONT}`;
  const k = Math.min(1, Math.max(0.7, 1244 / ctx.measureText('Ritchie Avenue').width));
  const w = (s) => ctx.measureText(s).width * k;
  const words = name.split(/\s+/);
  let lines = [name];
  if (w(name) > 1700 && words.length > 1) {
    let best = Infinity;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      const m = Math.max(w(a), w(b)) + (w(a) < w(b) ? 1 : 0); // a tie: the longer line on top, as on the real signs
      if (m < best) { best = m; lines = [a, b]; }
    }
  }
  const s = Math.min(1, maxW / Math.max(...lines.map(w)));
  const centre = 419;
  const base = lines.length === 2 ? [centre - 11 * s, centre - 11 * s + 212 * s] : [centre + 95 * s];
  return { font: `bold ${size * s}px ${FONT}`, k, lines: lines.map((t, i) => [t, TPL_W / 2, base[i]]) };
}
function layoutAddress(ctx, number, street) {
  const out = [];
  if (!street) return out;
  ctx.font = `bold ${145 / 0.72}px ${FONT}`;
  const k = Math.min(1, Math.max(0.7, 147 / ctx.measureText('77').width));
  let x = 84;
  if (number) {
    out.push({ font: ctx.font, k, text: number, x, y: 1009 });
    x += ctx.measureText(number).width * k + 43;
  }
  const words = street.split(/\s+/);
  const tail = words.length > 2 && /^(east|west|north|south|e|w|n|s)$/i.test(words[words.length - 1]) ? 2 : 1;
  const lines = words.length > 1 ? [words.slice(0, -tail).join(' '), words.slice(-tail).join(' ')] : [street];
  const sf = `bold ${56 / 0.72}px ${FONT}`;
  ctx.font = sf;
  const widest = Math.max(...lines.map((t) => ctx.measureText(t).width * k));
  const fit = Math.min(1, (ADDR.x1 - 20 - x) / widest); // a long street name is drawn narrower
  lines.forEach((t, i) => out.push({ font: sf, k: k * fit, text: t, x, y: lines.length === 2 ? [923, 1006][i] : 965 }));
  return out;
}

// The lettering of every sign, one park per channel of a CELL_W x CELL_H cell: the name in the cell's top NAME_H rows,
// the address under it (both a quarter of the face's size). White-on-clear text drawn on a scratch canvas, its coverage
// copied into the cell's channel.
function buildAtlas(signs) {
  const cols = 4, perRow = cols * 4;
  const rows = Math.ceil(signs.length / perRow);
  const W = cols * CELL_W, H = Math.max(1, rows) * CELL_H;
  const data = new Uint8Array(W * H * 4);
  const scratch = document.createElement('canvas');
  scratch.width = CELL_W; scratch.height = CELL_H;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  const cells = [];
  signs.forEach(([, , , name, number, street], i) => {
    const ch = i % 4, cell = Math.floor(i / 4), cx = (cell % cols) * CELL_W, cy = Math.floor(cell / cols) * CELL_H;
    cells.push([cx / W, cy / H, ch]);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CELL_W, CELL_H);
    // the name: face px -> the cell's top
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, CELL_W, NAME_H); ctx.clip();
    const L = layoutName(ctx, name);
    ctx.font = L.font;
    ctx.textAlign = 'center';
    for (const [t, x, y] of L.lines) {
      ctx.setTransform(K * L.k, 0, 0, K, (x - NAME.x0) * K, (y - NAME.y0) * K);
      ctx.fillText(t, 0, 0);
    }
    ctx.restore();
    // the address: face px -> under the name
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath(); ctx.rect(0, NAME_H, (ADDR.x1 - ADDR.x0) * K, CELL_H - NAME_H); ctx.clip();
    ctx.textAlign = 'left';
    for (const a of layoutAddress(ctx, number, street)) {
      ctx.font = a.font;
      ctx.setTransform(K * a.k, 0, 0, K, (a.x - ADDR.x0) * K, NAME_H + (a.y - ADDR.y0) * K);
      ctx.fillText(a.text, 0, 0);
    }
    ctx.restore();
    const px = ctx.getImageData(0, 0, CELL_W, CELL_H).data;
    for (let y = 0; y < CELL_H; y++) {
      let o = ((cy + y) * W + cx) * 4 + ch, p = y * CELL_W * 4 + 3;
      for (let x = 0; x < CELL_W; x++, o += 4, p += 4) data[o] = px[p];
    }
  });
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { tex, cells, W, H };
}

// The model's parts (one primitive per material) as one geometry in metres, base on the ground, centred, with each
// vertex's part: 0 face, 1 post, 2 trim, 3 back
const PARTS = ['face', 'post', 'trim', 'back'];
function mergedSign(gltf) {
  const geos = [], colours = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const part = Math.max(0, PARTS.findIndex((p) => (o.material.name || '').endsWith(p)));
    const src = o.geometry, n = src.attributes.position.count;
    const geo = new THREE.BufferGeometry();
    // (meshopt quantisation stores normalised integers: back to floats before the transform, see street-props.js)
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
      const a = src.attributes[name], f = new Float32Array(n * size);
      if (a) for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) f[i * size + c] = a.getComponent(i, c);
      geo.setAttribute(name, new THREE.BufferAttribute(f, size));
    }
    geo.setAttribute('signPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
    geo.setIndex(src.index ? Array.from(src.index.array) : null);
    geo.applyMatrix4(o.matrixWorld);
    geos.push(geo);
    colours[part] = o.material.color ? o.material.color.clone() : new THREE.Color(0xcccccc);
  });
  const geo = window.CITY.Addons.mergeGeometries(geos);
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.computeBoundingBox();
  return { geo, colours };
}

function signMaterial(template, atlas, colours) {
  const { texture, uv, attribute, vec2, vec3, float, mix, step, clamp, dot, color } = window.CITY.TSL;
  const part = attribute('signPart', 'float');
  const cell = attribute('signCell', 'vec2');
  const chan = attribute('signChannel', 'vec4');
  const f = uv();
  const px = f.x.mul(TPL_W), py = f.y.mul(TPL_H);
  // the name & address regions of this sign's cell
  const nl = clamp(vec2(px.sub(NAME.x0).div(NAME.x1 - NAME.x0), py.sub(NAME.y0).div(NAME.y1 - NAME.y0)), 0, 1);
  const al = clamp(vec2(px.sub(ADDR.x0).div(ADDR.x1 - ADDR.x0), py.sub(ADDR.y0).div(ADDR.y1 - ADDR.y0)), 0, 1);
  const nUv = cell.add(nl.mul(vec2(CELL_W / atlas.W, NAME_H / atlas.H)));
  const aUv = cell.add(vec2(0, NAME_H / atlas.H)).add(al.mul(vec2(((ADDR.x1 - ADDR.x0) * K) / atlas.W, (CELL_H - NAME_H) / atlas.H)));
  const inName = step(NAME.y0, py).mul(step(py, NAME.y1));
  const inAddr = step(ADDR.y0, py).mul(step(py, ADDR.y1)).mul(step(px, ADDR.x1));
  const mName = dot(texture(atlas.tex, nUv), chan).mul(inName);
  const mAddr = dot(texture(atlas.tex, aUv), chan).mul(inAddr);
  const printed = mix(mix(texture(template, f).rgb, color(INK), mName), color(PAPER), mAddr);
  const isPost = step(0.5, part), isTrim = step(1.5, part), isBack = step(2.5, part);
  const col = (c) => vec3(c.r, c.g, c.b);
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = 'park-sign';
  mat.colorNode = mix(mix(mix(printed, col(colours[1]), isPost), col(colours[2]), isTrim), col(colours[3]), isBack);
  // printed vinyl, painted posts, the brushed aluminium trim & back
  mat.roughnessNode = mix(mix(mix(float(0.55), float(0.5), isPost), float(0.35), isTrim), float(0.5), isBack);
  mat.metalnessNode = mix(mix(mix(float(0.0), float(0.0), isPost), float(0.6), isTrim), float(0.4), isBack);
  return mat;
}

async function buildParkSigns(scene) {
  const signs = (GEO.props && GEO.props.parkSign) || [];
  const group = new THREE.Group();
  group.name = 'CityParkSigns';
  const colliders = [];
  const { GLTFLoader, MeshoptDecoder } = window.CITY.Addons;
  if (!signs.length || !GLTFLoader || !MeshoptDecoder) return { group, colliders, count: 0 };
  let gltf, template;
  try {
    [gltf, template] = await Promise.all([
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('./assets/props/park-sign.glb'),
      new THREE.TextureLoader().loadAsync('./assets/props/park-sign-face.webp')
    ]);
  } catch (e) {
    console.warn('[parkSigns] the sign model or its face did not load:', e);
    return { group, colliders, count: 0 };
  }
  template.colorSpace = THREE.SRGBColorSpace;
  template.flipY = false; // the model's UVs are glTF's (v down from the template's top)
  template.anisotropy = 4;
  template.needsUpdate = true;
  const { geo, colours } = mergedSign(gltf);
  const atlas = buildAtlas(signs);
  const n = signs.length;
  const cellAttr = new Float32Array(n * 2), chanAttr = new Float32Array(n * 4);
  const mesh = new THREE.InstancedMesh(geo, signMaterial(template, atlas, colours), n);
  mesh.name = 'ParkSigns';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const hx = (geo.boundingBox.max.x - geo.boundingBox.min.x) / 2, hz = (geo.boundingBox.max.z - geo.boundingBox.min.z) / 2;
  const top = geo.boundingBox.max.y;
  const sites = [];
  signs.forEach(([x, z, yaw, name], i) => {
    const y = blockAt(x, z) ? CITY_BOUNDS.sidewalkHeight : 0;
    p.set(x, y, z);
    q.setFromAxisAngle(up, yaw);
    m.compose(p, q, sc);
    mesh.setMatrixAt(i, m);
    const [u, v, ch] = atlas.cells[i];
    cellAttr[2 * i] = u; cellAttr[2 * i + 1] = v;
    chanAttr[4 * i + ch] = 1;
    // the sign's turned footprint (buildingContact's oriented box: local x along the panel)
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, maxY: y + top, obb: { cx: x, cz: z, hx, hz, cs, sn } });
    sites.push({ x, z, yaw, name });
  });
  geo.setAttribute('signCell', new THREE.InstancedBufferAttribute(cellAttr, 2));
  geo.setAttribute('signChannel', new THREE.InstancedBufferAttribute(chanAttr, 4));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.cullDistance = CULL;
  mesh.userData.cullCell = 60;
  mesh.computeBoundingSphere();
  group.add(mesh);
  scene.add(group);
  window.CITY.parkSignSites = sites;
  console.info(`[parkSigns] ${n} park signs (atlas ${atlas.W} x ${atlas.H})`);
  return { group, colliders, count: n, textures: [atlas.tex] };
}

// The invented parkland & yard trees (street-details.js; the City's own street trees stay) keep out of a sign's way:
// none within CLEAR m of one, so no trunk stands in it and no low bough hangs across its face. Runs before the trees
// are built (main.js); removes in place and returns how many went.
const CLEAR = 5;
function clearParkSignTrees(trees) {
  const signs = (GEO.props && GEO.props.parkSign) || [];
  if (!signs.length || !trees) return 0;
  const grid = new Set();
  for (const [x, z] of signs) grid.add(Math.floor(x / 10) * 100003 + Math.floor(z / 10));
  const near = (t) => {
    const ix = Math.floor(t.x / 10), iz = Math.floor(t.z / 10);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      if (!grid.has((ix + a) * 100003 + iz + b)) continue;
      for (const [x, z] of signs) if (Math.abs(x - t.x) < CLEAR && Math.abs(z - t.z) < CLEAR && Math.hypot(x - t.x, z - t.z) < CLEAR) return true;
    }
    return false;
  };
  let w = 0;
  for (const t of trees) if (t.tier === 1 || !near(t)) trees[w++] = t;
  const removed = trees.length - w;
  trees.length = w;
  return removed;
}

Object.assign(window.CITY, { buildParkSigns, clearParkSignTrees });
})();
