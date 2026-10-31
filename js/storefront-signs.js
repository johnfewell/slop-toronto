(function () {
// js/storefront-signs.js
// Source-keyed storefront signs (bead st-wt0.15, docs/storefronts.md): the reviewed records of js/toronto-storefronts.js
// (tools/build-storefront-signs.mjs from tools/data/storefront-signs.json) as fascia boards over their shops' fronts.
// Each record is keyed by its OpenStreetMap place and its building face; the board stands on the face's real wall,
// over its own stretch of frontage, at the storefront's fascia (tsl-materials.js createStorefront). Plain lettering in a
// few Toronto main-street styles: painted fascias in sans or serif, backlit light boxes, coloured boards. No logos:
// those are the businesses' trademarks.
// Cheap at every distance: one instanced mesh of thin boxes (one draw), and one shared, mipmapped atlas that packs four
// boards' lettering into each cell, one per colour channel (the board and ink colours are per-instance), within the
// adoption spec's sign-atlas ceilings (ID-4: 24 MiB high, 8 MiB low, mips included). Names are only ever drawn with
// fillText: source names are data, never markup. ?storefronts=0 leaves them out (the procedural fronts stay).

const { THREE } = window.CITY;
const { Fn, texture, uv, attribute, mix, smoothstep, step, vec2, vec3, float, dot, abs, min, max, fwidth, normalGeometry } = window.CITY.TSL;

const CW = 1024, CH = 128; // an atlas cell: one board's lettering (in one colour channel), at full resolution
const BOARD_H = 0.55; // m: a fascia board
const MIN_W = 1.6, MAX_W = 7.2, PAD = 0.2; // m
const ATLAS_CEILING = { high: 24 * 1048576, medium: 24 * 1048576, low: 8 * 1048576 }; // bytes, mips included

// Board [colours], ink [colours] and lettering per style (sRGB); a hash of the source ID picks within a style
const STYLES = {
  fascia: { boards: [0x1d1d1f, 0x23302b, 0x2a2f3a, 0x3b2a24], inks: [0xf2efe6, 0xe8d9a8], font: '600 {px}px "Helvetica Neue", Helvetica, Arial, sans-serif', glow: 0.3, frame: 0 },
  fasciaSerif: { boards: [0x20372c, 0x4a1c1c, 0x1b1b1b, 0x233147], inks: [0xd9b863, 0xefe6cc], font: '700 {px}px Georgia, "Times New Roman", serif', glow: 0.3, frame: 1 },
  lightbox: { boards: [0xf3f1ea, 0xfbfaf6, 0xf5e9c9], inks: [0x1d1d1d, 0x8f1f1f, 0x1e3a6b], font: '800 {px}px "Helvetica Neue", Helvetica, Arial, sans-serif', glow: 0, frame: 2 },
  colour: { boards: [0x8c2a22, 0x1f5a5a, 0xb8862b, 0x2f5d3a, 0x5d2a6e], inks: [0xfaf7f0], font: '700 {px}px "Avenir Next", "Helvetica Neue", Arial, sans-serif', glow: 0.25, frame: 0 }
};

function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/**
 * Lettering layout for one board, in the cell's pixels and the board's metres. `measure(text, px)` gives a line's width
 * at a font size. One line if it fits the frontage (squeezed by at most 18%); else two lines, split at the word break
 * that balances them; else the smaller of either. The real spelling is kept: no truncation, no case change.
 * -> { lines, px, cellW (px used), textW (m), boardW (m), squeeze }
 */
function layoutSign(name, maxW, measure) {
  const avail = Math.max(MIN_W, maxW) - 2 * PAD; // m of lettering the frontage allows
  const mPerPx = BOARD_H / CH; // the cell's height is the board's
  const words = name.split(/\s+/).filter(Boolean);
  const options = [[name]];
  for (let k = 1; k < words.length; k++) options.push([words.slice(0, k).join(' '), words.slice(k).join(' ')]);
  let best = null;
  for (const lines of options) {
    const px = Math.round(CH * (lines.length === 1 ? 0.66 : 0.4));
    const widest = Math.max(...lines.map((l) => measure(l, px)));
    const fitCell = Math.min(1, (CW - 8) / widest); // the line must fit the cell
    const ratio = Math.min(1, avail / (widest * fitCell * mPerPx)); // and the frontage
    // squeezed sideways (fillText's maxWidth) down to 82%, then smaller letters
    const fontPx = px * fitCell * (ratio >= 0.82 ? 1 : ratio / 0.82);
    const score = fontPx * (lines.length === 1 ? 1 : 0.97); // (one line wins near-ties)
    if (!best || score > best.score) best = { lines, px: Math.max(8, Math.floor(fontPx)), drawn: widest * fitCell * ratio, score, squeeze: Math.max(ratio, 0.82) };
  }
  const cellW = Math.min(CW, Math.ceil(best.drawn) + 8);
  const textW = cellW * mPerPx;
  const boardW = Math.min(Math.max(MIN_W, maxW), Math.max(MIN_W, textW + 2 * PAD));
  return { lines: best.lines, px: best.px, cellW, textW: Math.min(textW, boardW - 0.04), boardW, squeeze: best.squeeze };
}

// The per-tier atlas: two cells across, four boards per cell (RGBA), only as many rows as needed
function atlasSize(count, res) {
  const rows = Math.max(1, Math.ceil(count / 8));
  const w = 2 * CW * res, h = rows * CH * res;
  return { w, h, rows, bytes: Math.round(w * h * 4 * 4 / 3) };
}

function buildStorefrontSigns(scene, { facadeOf = () => null } = {}) {
  const CITY = window.CITY;
  const data = CITY.STOREFRONTS;
  const QUALITY = CITY.QUALITY || { tier: 'high' };
  const stats = { records: data?.signs?.length || 0, placed: 0, skipped: {}, atlas: null, attribution: data?.attribution || null };
  CITY.storefrontStats = stats;
  const off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('storefronts') === '0';
  if (!data || !data.signs?.length || off) {
    console.info(`[storefronts] no signs: ${off ? '?storefronts=0' : 'no records'}`);
    return { group: null, texture: null, gpuBytes: 0, cpuBytes: 0, signs: [] };
  }
  const skip = (why) => { stats.skipped[why] = (stats.skipped[why] || 0) + 1; };
  // re-check every record against the city as built: the building row must still be the building it was compiled for
  const signs = [];
  for (const s of data.signs) {
    const b = CITY.GEO.buildings[s.b];
    if (!b || Math.abs(b[0] - s.bc[0]) > 0.05 || Math.abs(b[1] - s.bc[1]) > 0.05) { skip('building moved'); continue; }
    const fh = facadeOf(s.b)?.floorHeight || 3.6;
    const top = fh - 0.12; // the fascia's top, under the first-floor sills
    if (s.h < top + 0.3) { skip('too low'); continue; }
    signs.push({ ...s, y: top - BOARD_H / 2 });
  }
  // the atlas at this tier's resolution, halved until it fits its ceiling
  let res = (QUALITY.signRes ?? 1) < 1 ? 0.5 : 1;
  const ceiling = ATLAS_CEILING[QUALITY.tier] || ATLAS_CEILING.high;
  while (atlasSize(signs.length, res).bytes > ceiling && res > 0.25) res /= 2;
  const size = atlasSize(signs.length, res);
  if (size.bytes > ceiling) {
    console.warn(`[storefronts] ${signs.length} signs need ${size.bytes} B of atlas, over the ${ceiling} B ceiling: none drawn`);
    return { group: null, texture: null, gpuBytes: 0, cpuBytes: 0, signs: [] };
  }
  const atlas = new Uint8Array(size.w * size.h * 4);
  const canvas = document.createElement('canvas');
  canvas.width = CW * res;
  canvas.height = CH * res;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const measure = (style) => (text, px) => {
    ctx.font = style.font.replace('{px}', String(px));
    return ctx.measureText(text).width;
  };

  const n = signs.length;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const attr = (k) => new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const rect = attr(), channel = attr(), board = attr(), ink = attr();
  geometry.setAttribute('signRect', rect);
  geometry.setAttribute('signChannel', channel);
  geometry.setAttribute('signBoard', board);
  geometry.setAttribute('signInk', ink);
  const lin = (hex) => new THREE.Color(hex); // (THREE.Color stores linear values from a hex)
  const mesh = new THREE.InstancedMesh(geometry, null, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const DEPTH = 0.07;

  signs.forEach((s, i) => {
    const style = STYLES[s.style] || STYLES.fascia;
    const h = hashId(s.id);
    const lay = layoutSign(s.name, Math.min(MAX_W, s.width - 0.3), measure(style));
    // the lettering, white on black in a scratch cell, copied into its atlas cell's channel (rows flipped: v = 0 at the
    // bottom of the board)
    ctx.setTransform(res, 0, 0, res, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = style.font.replace('{px}', String(lay.px));
    const cx = lay.cellW / 2;
    // (the font was sized for its widest line; fillText's maxWidth applies the squeeze)
    if (lay.lines.length === 1) ctx.fillText(lay.lines[0], cx, CH * 0.53, lay.cellW - 8);
    else lay.lines.forEach((l, k) => ctx.fillText(l, cx, CH * (0.29 + 0.45 * k), lay.cellW - 8));
    const cell = Math.floor(i / 4), ch = i % 4;
    const ox = (cell % 2) * CW * res, oy = Math.floor(cell / 2) * CH * res;
    const cw = Math.ceil(lay.cellW * res), chh = CH * res;
    const img = ctx.getImageData(0, 0, cw, chh).data;
    for (let r = 0; r < chh; r++) {
      const dst = ((oy + chh - 1 - r) * size.w + ox) * 4 + ch;
      const src = r * cw * 4;
      for (let c = 0; c < cw; c++) atlas[dst + c * 4] = img[src + c * 4];
    }
    // the board's atlas rect, channel, colours & style
    rect.setXYZW(i, ox / size.w, oy / size.h, (ox + cw) / size.w, (oy + chh) / size.h);
    channel.setXYZW(i, ch === 0 ? 1 : 0, ch === 1 ? 1 : 0, ch === 2 ? 1 : 0, ch === 3 ? 1 : 0);
    const bc = lin(style.boards[h % style.boards.length]), ic = lin(style.inks[(h >>> 8) % style.inks.length]);
    board.setXYZW(i, bc.r, bc.g, bc.b, style.frame);
    ink.setXYZW(i, ic.r, ic.g, ic.b, lay.textW / lay.boardW);
    // stood on the wall, its lettering facing out of it (the box's +z), over the middle of its frontage
    q.setFromAxisAngle(up, Math.atan2(s.nx, s.nz));
    m4.compose(new THREE.Vector3(s.x + s.nx * (DEPTH / 2 + 0.02), s.y, s.z + s.nz * (DEPTH / 2 + 0.02)), q,
      new THREE.Vector3(lay.boardW, BOARD_H, DEPTH));
    mesh.setMatrixAt(i, m4);
    s.boardW = lay.boardW;
    s.glow = style.glow;
  });
  // glow after dark, board width (m)
  geometry.setAttribute('signMeta', new THREE.InstancedBufferAttribute(new Float32Array(signs.flatMap((s) => [s.glow, s.boardW])), 2));

  const tex = new THREE.DataTexture(atlas, size.w, size.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  mesh.material = createSignMaterial(tex);
  mesh.name = 'StorefrontSigns';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
  stats.placed = signs.length;
  stats.atlas = { width: size.w, height: size.h, resolution: res, gpuBytes: size.bytes, ceiling };
  CITY.storefrontSigns = signs.map((s) => ({ id: s.id, name: s.name, poi: s.poi, x: s.x, z: s.z, y: s.y, width: s.boardW, confidence: s.confidence, reviewed: s.reviewed }));
  console.info(`[storefronts] ${signs.length} source-keyed signs; atlas ${size.w}x${size.h} (${(size.bytes / 1048576).toFixed(1)} MiB with mips)${Object.keys(stats.skipped).length ? `; skipped ${JSON.stringify(stats.skipped)}` : ''}`);
  return { group: mesh, texture: tex, gpuBytes: size.bytes, cpuBytes: atlas.byteLength, signs };
}

// The board: its colour, the lettering's ink where the atlas cell's channel says so (front face only), a frame for the
// serif fascias (a gilt line) and the light boxes (a metal edge); after dark the light boxes glow through and the other
// boards' lettering catches a gooseneck lamp
function createSignMaterial(tex) {
  const { cityUniforms } = window.CITY;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.05 });
  const rect = attribute('signRect', 'vec4');
  const channel = attribute('signChannel', 'vec4');
  const board = attribute('signBoard', 'vec4');
  const ink = attribute('signInk', 'vec4');
  const meta = attribute('signMeta', 'vec2');
  const glow = meta.x;
  const st = uv();
  const front = step(0.5, normalGeometry.z);
  const letters = Fn(() => {
    const tu = st.x.sub(0.5).div(ink.w).add(0.5);
    const inside = step(0.0, tu).mul(step(tu, 1.0));
    const auv = vec2(mix(rect.x, rect.z, tu.clamp(0.0, 1.0)), mix(rect.y, rect.w, st.y));
    return dot(texture(tex, auv), channel).mul(inside).mul(front);
  })();
  // the frame: a gilt line 5 cm in (serif fascias), a 3 cm metal edge (light boxes); e = metres to the board's edge
  const frameLine = Fn(() => {
    const e = min(min(st.y, float(1).sub(st.y)).mul(BOARD_H), min(st.x, float(1).sub(st.x)).mul(meta.y));
    const w = fwidth(e).max(1e-4);
    const gilt = smoothstep(w.negate(), w, float(0.012).sub(abs(e.sub(0.05))));
    const edge = smoothstep(w.negate(), w, float(0.03).sub(e));
    return vec2(gilt, edge);
  })();
  const isSerif = step(0.5, board.w).mul(step(board.w, 1.5));
  const isBox = step(1.5, board.w);
  const baseBoard = mix(board.xyz, vec3(0.32, 0.33, 0.34), isBox.mul(frameLine.y).mul(front));
  const lettered = mix(baseBoard, ink.xyz, letters);
  mat.colorNode = mix(lettered, ink.xyz, isSerif.mul(frameLine.x).mul(front).mul(0.8));
  mat.roughnessNode = mix(float(0.62), float(0.55), isBox); // (a glossier light box mirrors the sky over its lettering by day)
  const night = smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow);
  // light boxes: the panel glows (the lettering blocks it); others: the lettering lit from above
  mat.emissiveNode = mix(
    ink.xyz.mul(letters).mul(glow),
    board.xyz.mul(float(1).sub(letters.mul(0.85))).mul(0.85).mul(float(1).sub(frameLine.y)),
    isBox
  ).mul(front).mul(night);
  return mat;
}

Object.assign(window.CITY, { buildStorefrontSigns, createStorefrontSignMaterial: createSignMaterial, layoutSign, storefrontAtlasSize: atlasSize, STOREFRONT_SIGN_STYLES: STYLES, STOREFRONT_ATLAS_CEILING: ATLAS_CEILING });
})();
