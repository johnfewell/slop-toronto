(function () {
// js/toronto-sign.js
// The 3D TORONTO sign at Nathan Phillips Square (docs/toronto-sign.md): the First Nations medicine wheel, seven lit letters
// and a maple leaf on a low plinth along the north coping of the reflecting pool, facing south across the water. The City
// replaced the 2015 original with a more durable copy in September 2020 and still lights it (City of Toronto, "Toronto
// Sign", read 2026-11-26: 3 m tall, illuminated). In the pool's water season (spring to autumn) a row of 40 lit water jets
// stands in front of it and the sign's colours run down the water; in the ice season (the rink) both are gone.
//
// Place and size: the City's 2025 orthophoto (cot_ortho_2025_color_8cm, read 2026-11-26) shows the sign's pastel tops and
// its long shadow along the pool's north edge, the whole sign from x -22.3 to 8.5 (31 m), centre line z -821.7, 2.9 m north
// of the pool polygon's edge (z -818.8). A night photograph from the pool's south side (John's, 2026-11-26) gives the
// order and proportions: the wheel (about the letters' height) at the west end, the letters (T wider than R, O nearly
// round, 0.4 m gaps, 22 m long), the leaf at the east end (a little taller than the letters), and the colours the lit sign
// shows at night. Pure helpers first (loaded by tests in node), then the builder.
const C = window.CITY;

// World metres (x east, z south of the origin)
const SPEC = Object.freeze({
  word: 'TORONTO',
  x0: -18.6, // the first letter's west edge (the wheel stands west of it, the leaf east of the last O)
  gap: 0.4, // between neighbours
  zc: -821.7, // the middle of the letters' depth
  height: 3.0, // the letters ("three metres tall", City page), on a 0.45 m plinth
  depth: 0.9,
  stroke: 0.58,
  strokeO: 0.7, // the O's ring is a little thicker than the stems (photograph)
  plinth: Object.freeze({ x0: -22.6, x1: 8.8, depth: 1.5, h: 0.45 }),
  widths: Object.freeze({ T: 2.5, O: 3.1, R: 2.3, N: 2.8 }),
  wheel: Object.freeze({ x: -22.3, d: 3.2, depth: 0.6, rim: 0.12 }),
  leaf: Object.freeze({ x: 4.2, w: 3.9, h: 3.3, depth: 0.7 }),
  // the lit colours of the night photograph (the City's sign changes colour; this is its default): T cyan, O violet, R magenta,
  // O red, N orange, T yellow, O white
  colors: Object.freeze([0x14d6ff, 0x9a2bff, 0xff1fc8, 0xff2418, 0xff8a14, 0xffe414, 0xffffff]),
  leafColor: 0xff2030,
  wheelColors: Object.freeze({ white: 0xfff1d8, yellow: 0xffbd1a, red: 0xff1c1c, black: 0x060606 }),
  rimColor: 0xc9ced4, // the silver edge of the leaf and the wheel's thin rim
  fountain: Object.freeze({ count: 40, x0: -18.5, x1: 7.0, dz: 9, hMin: 1.8, hMax: 3.0, width: 0.8 }), // dz: the row's distance from the pool's north edge (in the photograph the jets stand well out in the pool, the letters' reflections between)
  reflectionLength: 8, // how far the sign's colours run out over the water (m)
  waterMonths: Object.freeze([4, 10]) // the fountain's months (assumption, below)
});

// Each element as flat pieces [{ outer, holes, kind, tint?, depth?, dz? }] in a box u 0..w, v 0..h (u east when the element
// faces south). A piece is a polygon, an arc is sampled; pieces of one letter may overlap (they are merged as solids).
function arcPts(cu, cv, r, a0, a1, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([cu + r * Math.cos(a), cv + r * Math.sin(a)]); }
  return out;
}
function letterPieces(ch, w = SPEC.widths[ch], h = SPEC.height, s = SPEC.stroke) {
  switch (ch) {
    case 'T': return [{ outer: [[0, h - s], [w, h - s], [w, h], [0, h]], holes: [] }, { outer: [[w / 2 - s / 2, 0], [w / 2 + s / 2, 0], [w / 2 + s / 2, h - s + 0.01], [w / 2 - s / 2, h - s + 0.01]], holes: [] }];
    case 'O': {
      const r = Math.min(w, h) / 2;
      const so = SPEC.strokeO;
      return [{ outer: arcPts(w / 2, h / 2, r, 0, Math.PI * 2, 48).slice(0, -1), holes: [arcPts(w / 2, h / 2, r - so, 0, Math.PI * 2, 48).slice(0, -1).reverse()] }];
    }
    case 'R': {
      // the photograph's R: a big round bowl over the top 58% with a round-ended counter (the stroke the O's, thinner than
      // the stem would make a slot), a stem, and a straight diagonal leg from where the bowl meets the stem to the bottom right
      const bs = 0.42, r = h * 0.3, cu = w - r, cv = h - r, hb = h - 2 * r;
      return [
        { outer: [[0, 0], [s, 0], [s, h], [0, h]], holes: [] },
        { outer: [[0, hb], [cu, hb], ...arcPts(cu, cv, r, -Math.PI / 2, Math.PI / 2), [0, h]], holes: [[[s, hb + bs], [s, h - bs], ...arcPts(cu, cv, r - bs, Math.PI / 2, -Math.PI / 2), [cu, hb + bs]]] },
        { outer: [[w * 0.36, hb + 0.2], [w * 0.36 + s * 1.2, hb + 0.2], [w, 0], [w - s * 1.2, 0]], holes: [] }
      ];
    }
    case 'N': return [
      { outer: [[0, 0], [s, 0], [s, h], [0, h]], holes: [] },
      { outer: [[w - s, 0], [w, 0], [w, h], [w - s, h]], holes: [] },
      { outer: [[0, h], [s * 1.3, h], [w, 0], [w - s * 1.3, 0]], holes: [] }
    ];
    default: throw new Error('no letter ' + ch);
  }
}

// The Canadian maple leaf, 11 points: the outline of the leaf on the flag of Canada (Wikimedia Commons, "Flag of Canada
// (Pantone).svg", public domain; its path's 37 vertices, the small rounded corners kept as their end points), normalised to
// a box u 0..1 across and v 0..1 from the stem's foot to the top point.
const LEAF_OUTLINE = Object.freeze([
  [0.5242, 0.0], [0.5121, 0.2141], [0.5419, 0.2385], [0.7728, 0.201], [0.7417, 0.2804], [0.747, 0.2985],
  [1.0, 0.4876], [0.943, 0.5122], [0.9339, 0.5318], [0.9839, 0.6737], [0.8382, 0.6452], [0.8185, 0.6546],
  [0.7903, 0.7159], [0.6766, 0.6032], [0.6468, 0.6174], [0.7016, 0.8784], [0.6137, 0.8315], [0.5892, 0.8382],
  [0.5, 1.0], [0.4108, 0.8382], [0.3863, 0.8315], [0.2984, 0.8784], [0.3532, 0.6174], [0.3234, 0.6032],
  [0.2097, 0.7159], [0.1815, 0.6546], [0.1618, 0.6452], [0.0161, 0.6737], [0.0661, 0.5318], [0.057, 0.5122],
  [0.0, 0.4876], [0.253, 0.2985], [0.2583, 0.2804], [0.2272, 0.201], [0.4581, 0.2385], [0.4879, 0.2141],
  [0.4758, 0.0]
]);
// The outline in a box u 0..w, v 0..h (the sign's leaf is drawn a little wider than the flag's), scaled about its middle by `grow`
function leafOutline(w = SPEC.leaf.w, h = SPEC.leaf.h, grow = 1) {
  const cu = w / 2, cv = h * 0.52;
  return LEAF_OUTLINE.map(([x, y]) => [cu + (x * w - cu) * grow, cv + (y * h - cv) * grow]);
}
function leafPieces() {
  return [
    { outer: leafOutline(SPEC.leaf.w, SPEC.leaf.h, 1.03), holes: [], kind: 'rim', depth: SPEC.leaf.depth },
    { outer: leafOutline(SPEC.leaf.w, SPEC.leaf.h, 0.935), holes: [], kind: 'leaf', depth: SPEC.leaf.depth + 0.04 }
  ];
}
// The medicine wheel: a silver rim and four quarters (white top left, yellow top right, red bottom right, black bottom left)
function wheelPieces(d = SPEC.wheel.d) {
  const r = d / 2, ri = r - SPEC.wheel.rim, cut = 0.04;
  const quarter = (a0, a1, kind) => {
    const arc = arcPts(r, r, ri, a0, a1, 24);
    return { outer: [[r + cut * Math.cos((a0 + a1) / 2), r + cut * Math.sin((a0 + a1) / 2)], ...arc], holes: [], kind, depth: SPEC.wheel.depth + 0.03 };
  };
  const q = Math.PI / 2, e = Math.PI / 4; // an X, not a +: white at the top, yellow right, red bottom, black left
  return [
    { outer: arcPts(r, r, r, 0, Math.PI * 2, 48).slice(0, -1), holes: [arcPts(r, r, ri - 0.02, 0, Math.PI * 2, 48).slice(0, -1).reverse()], kind: 'rim', depth: SPEC.wheel.depth },
    quarter(e, e + q, 'white'), quarter(-e, e, 'yellow'), quarter(-e - q, -e, 'red'), quarter(e + q, e + 2 * q, 'black')
  ];
}

// Everything on the plinth, west to east: [{ kind, ch?, x (west edge), w, h, color, pieces }]
function signElements() {
  const out = [{ kind: 'wheel', x: SPEC.wheel.x, w: SPEC.wheel.d, h: SPEC.wheel.d, color: SPEC.wheelColors.yellow }];
  let x = SPEC.x0;
  [...SPEC.word].forEach((ch, i) => {
    const w = SPEC.widths[ch];
    out.push({ kind: 'letter', ch, x, w, h: SPEC.height, color: SPEC.colors[i] });
    x += w + SPEC.gap;
  });
  out.push({ kind: 'leaf', x: SPEC.leaf.x, w: SPEC.leaf.w, h: SPEC.leaf.h, color: SPEC.leafColor });
  return out;
}
// The letters alone (the word's slots), as before
function letterSlots() { return signElements().filter((e) => e.kind === 'letter'); }

// The solid footprint people walk around (x/z box, heights above the paving): plinth, wheel, letters and leaf in one
function collider() {
  const p = SPEC.plinth;
  return { minX: p.x0, maxX: p.x1, minZ: SPEC.zc - p.depth / 2, maxZ: SPEC.zc + p.depth / 2, minY: 0, maxY: p.h + Math.max(SPEC.height, SPEC.leaf.h) };
}

// The sign's lit colour at x (the nearest element's): the fountain's lights and the water's glow follow it
function colorAt(x) {
  let best = null, bd = Infinity;
  for (const e of signElements()) {
    if (e.kind === 'wheel') continue;
    const d = x < e.x ? e.x - x : x > e.x + e.w ? x - (e.x + e.w) : 0;
    if (d < bd) { bd = d; best = e; }
  }
  return best.color;
}

// The pool is water, not ice, and it is the fountain's season. The City: "During the Spring, Summer and Fall, Nathan
// Phillips Square features a fountain. In the winter, the water fountain turns into an outdoor artificial ice rink"
// (toronto.ca parks facility 1089). No operating dates are published, so the months April to October are an assumption;
// ?rinks=off (a forced water preview) shows it in any month.
function fountainOn({ season, forced = false, month }) {
  if (season === 'ice') return false;
  if (forced) return true;
  return month >= SPEC.waterMonths[0] && month <= SPEC.waterMonths[1];
}
// The jets' places and heights along the sign (deterministic): [{ x, z, h, phase, color }] with z relative to the pool's north edge
function jetSites(zEdge = -818.8) {
  const F = SPEC.fountain, out = [];
  for (let i = 0; i < F.count; i++) {
    const t = i / (F.count - 1), r1 = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1, r2 = Math.abs(Math.sin(i * 78.233) * 12345.6789) % 1;
    const x = F.x0 + t * (F.x1 - F.x0);
    out.push({ x, z: zEdge + F.dz + (r2 - 0.5) * 0.7, h: F.hMin + r1 * (F.hMax - F.hMin), phase: r2, color: colorAt(x) });
  }
  return out;
}

const pale = (hex, k, THREE) => { const c = new THREE.Color(hex); return c.lerp(new THREE.Color(1, 1, 1), k); };

function buildTorontoSign(scene) {
  const { THREE, TSL, Addons } = C;
  if (!THREE || !Addons?.mergeGeometries) return null;
  const groundAt = (x, z) => (C.blockAt?.(x, z) ? C.CITY_BOUNDS.sidewalkHeight : 0) + (C.cutAt?.(x, z) || 0);
  const shadowOn = C.QUALITY?.kerbShadows !== false;
  const y0 = groundAt(SPEC.plinth.x0 + 11, SPEC.zc);
  const yTop = y0 + SPEC.plinth.h;
  const geos = [];
  const addPiece = (el, piece, zStart) => {
    const shape = new THREE.Shape(piece.outer.map(([u, v]) => new THREE.Vector2(u, v)));
    for (const hole of piece.holes) shape.holes.push(new THREE.Path(hole.map(([u, v]) => new THREE.Vector2(u, v))));
    const depth = piece.depth ?? SPEC.depth;
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
    g.translate(el.x, yTop, zStart); // the front face (+z) looks south
    // the face glows in the lit colour and reads pale by day; the side returns are a paler, dimmer white-tinted edge
    const kind = piece.kind;
    const glowHex = kind === 'rim' ? (el.kind === 'leaf' ? SPEC.rimColor : SPEC.rimColor) : kind === 'leaf' ? SPEC.leafColor : SPEC.wheelColors[kind] ?? el.color;
    const glowK = kind === 'rim' ? 0.45 : kind === 'black' ? 0 : 1;
    const dayK = kind === 'black' ? 0 : kind === 'rim' ? 0 : kind === 'white' || kind === 'yellow' || kind === 'red' ? 0.2 : 0.4;
    g.deleteAttribute('uv');
    const ng = g.index ? g.toNonIndexed() : g;
    const n = ng.attributes.position.count, nrm = ng.attributes.normal, col = new Float32Array(n * 3), glow = new Float32Array(n * 3);
    const gc = new THREE.Color(glowHex), dc = kind === 'rim' ? new THREE.Color(glowHex) : pale(glowHex, dayK, THREE);
    for (let i = 0; i < n; i++) {
      const side = Math.abs(nrm.getZ(i)) < 0.5;
      const k = side ? 0.42 : 1;
      col[i * 3] = dc.r * (side ? 0.92 : 1); col[i * 3 + 1] = dc.g * (side ? 0.92 : 1); col[i * 3 + 2] = dc.b * (side ? 0.92 : 1);
      glow[i * 3] = gc.r * glowK * k; glow[i * 3 + 1] = gc.g * glowK * k; glow[i * 3 + 2] = gc.b * glowK * k;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
    ng.setAttribute('glow', new THREE.BufferAttribute(glow, 3));
    geos.push(ng);
  };
  const zFront = SPEC.zc + SPEC.depth / 2;
  for (const el of signElements()) {
    const pieces = el.kind === 'letter' ? letterPieces(el.ch).map((p) => ({ ...p, kind: 'letter' })) : el.kind === 'wheel' ? wheelPieces() : leafPieces();
    // every element's front face is flush with the letters' (a face piece stands 3 to 4 cm proud of its rim)
    const elDepth = el.kind === 'wheel' ? SPEC.wheel.depth : el.kind === 'leaf' ? SPEC.leaf.depth : SPEC.depth;
    for (const p of pieces) addPiece(el, p, zFront - elDepth);
  }
  const letters = Addons.mergeGeometries(geos, false);
  letters.computeBoundingSphere();
  const { float, smoothstep, attribute, vec3, mix, uv, sin, time, abs, positionLocal, vertexColor, color: tslColor } = TSL;
  const night = C.cityUniforms?.uInteriorGlow ? smoothstep(float(0.7), float(1.45), C.cityUniforms.uInteriorGlow) : float(0);
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.55 });
  // the colour is read once, here (no vertexColors flag: the guard in tests/material-colour-once.test.mjs); the lit sign's own
  // colour takes over from the pale daytime face as the night comes on
  mat.colorNode = attribute('color', 'vec3').mul(float(1).sub(night.mul(0.85)));
  // lit from inside: a quiet glow by day, the full colour at night (on the windows' night ramp), bright enough for the bloom
  mat.emissiveNode = attribute('glow', 'vec3').mul(night.mul(1.1).add(0.08));
  const lettersMesh = new THREE.Mesh(letters, mat);
  lettersMesh.name = 'TorontoSignLetters';
  lettersMesh.castShadow = shadowOn; lettersMesh.receiveShadow = true;

  const p = SPEC.plinth;
  const base = new THREE.BoxGeometry(p.x1 - p.x0, p.h, p.depth);
  base.translate((p.x0 + p.x1) / 2, y0 + p.h / 2, SPEC.zc);
  const baseMesh = new THREE.Mesh(base, new THREE.MeshStandardNodeMaterial({ color: 0xb9b4aa, roughness: 0.9 }));
  baseMesh.name = 'TorontoSignPlinth';
  baseMesh.castShadow = shadowOn; baseMesh.receiveShadow = true;

  const group = new THREE.Group(); group.name = 'TorontoSign'; group.add(lettersMesh, baseMesh); scene.add(group);

  // ---- the water: reflected colour and the fountain, only when the pool is water (not the rink's ice)
  const sceneDate = C.SITE_DATE || C.SCENE_DATE || { month: 8, day: 22 };
  const rs = C.rinkStats?.season ? { season: C.rinkStats.season, forced: !!C.rinkStats.forced } : C.sceneSeason ? C.sceneSeason(typeof location !== 'undefined' ? location.search : '', sceneDate) : { season: 'off', forced: false };
  const poolRec = C.RINKS?.records?.find((r) => r.assetId === '43599');
  const ring = poolRec?.polygons?.[0]?.outer;
  const pool = ring ? { x0: Math.min(...ring.map((q) => q[0])), x1: Math.max(...ring.map((q) => q[0])), z0: Math.min(...ring.map((q) => q[1])) } : { x0: -19.3, x1: 35.5, z0: -818.8 };
  // the pool's surface: the rink site's own height (rinks.js) plus its lift, else the ground there
  const poolSite = C.rinkStats?.sites?.find((q) => q.assetId === '43599');
  const poolY = (Number.isFinite(poolSite?.y) ? poolSite.y : groundAt(pool.x0 + 11, pool.z0 + 6)) + 0.024;
  const water = rs.season !== 'ice';
  const fountain = fountainOn({ season: rs.season, forced: rs.forced, month: sceneDate.month });
  let jets = 0, waterTriangles = 0;
  if (water) {
    // the sign's lit colours run out over the water in front of each element (a soft, streaked glow: no real reflection pass)
    const pos = [], uvs = [], cols = [];
    const lit = (hex) => { const c = new THREE.Color(hex); return c; };
    for (const e of signElements()) {
      if (e.kind === 'wheel') continue;
      const xa = Math.max(e.x, pool.x0), xb = Math.min(e.x + e.w, pool.x1);
      if (xb <= xa) continue;
      const c = lit(e.color), z0 = pool.z0 + 0.02, z1 = pool.z0 + SPEC.reflectionLength;
      const y = poolY + 0.02;
      pos.push(xa, y, z0, xb, y, z0, xb, y, z1, xa, y, z0, xb, y, z1, xa, y, z1);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
      for (let i = 0; i < 6; i++) cols.push(c.r, c.g, c.b);
      waterTriangles += 2;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    rg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    rg.computeBoundingSphere();
    const rm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }); // (the quads wind face-down: both sides draw)
    const fade = float(1).sub(uv().y).pow(1.5).mul(smoothstep(float(0), float(0.12), uv().y)).mul(smoothstep(float(0), float(0.12), uv().x)).mul(smoothstep(float(0), float(0.12), float(1).sub(uv().x))); // soft all round, strongest at the coping, gone 8 m out
    const ripple = sin(uv().y.mul(38).sub(time.mul(0.8)).add(uv().x.mul(11))).mul(0.12).add(0.88);
    rm.colorNode = vertexColor().mul(fade).mul(ripple).mul(night).mul(1.5);
    rm.opacityNode = float(1);
    const reflection = new THREE.Mesh(rg, rm); reflection.name = 'TorontoSignReflection'; reflection.renderOrder = 3;
    group.add(reflection);
  }
  if (fountain) {
    const F = SPEC.fountain, sites = jetSites(pool.z0);
    const pos = [], uvs = [], attr = [], cols = [], bpos = [], buv = [], bcols = [];
    for (const s of sites) {
      const c = new THREE.Color(s.color), hw = F.width / 2;
      for (const [dx, dz] of [[1, 0], [0.5, 0.866], [-0.5, 0.866]]) { // three crossed quads: a round, misty column from any side
        const a = [s.x - dx * hw, 0, s.z - dz * hw], b = [s.x + dx * hw, 0, s.z + dz * hw];
        const t = [b[0], s.h, b[2]], u = [a[0], s.h, a[2]];
        pos.push(...a, ...b, ...t, ...a, ...t, ...u);
        uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
        for (let i = 0; i < 6; i++) { attr.push(s.x, s.z, s.phase, s.h); cols.push(c.r, c.g, c.b); }
      }
      // the lit base: a soft flat glow disc on the water
      const R = 0.8, y = 0.045;
      bpos.push(s.x - R, y, s.z - R, s.x + R, y, s.z - R, s.x + R, y, s.z + R, s.x - R, y, s.z - R, s.x + R, y, s.z + R, s.x - R, y, s.z + R);
      buv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
      for (let i = 0; i < 6; i++) bcols.push(c.r, c.g, c.b);
    }
    for (let i = 1; i < pos.length; i += 3) pos[i] += poolY + 0.02; // lift the jets onto the water
    for (let i = 1; i < bpos.length; i += 3) bpos[i] += poolY;
    const jg = new THREE.BufferGeometry();
    jg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    jg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    jg.setAttribute('jet', new THREE.Float32BufferAttribute(attr, 4));
    jg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    jg.computeBoundingSphere();
    const jm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const jet = attribute('jet', 'vec4'), ph = jet.z, hgt = jet.w;
    const pulse = sin(time.mul(2.1).add(ph.mul(6.2832))).mul(0.12).add(0.88); // each jet breathes a little
    const v = uv().y, u = uv().x;
    // a jet is a narrow column that flares into spray at its top; the quad's width grows with height
    const flare = smoothstep(float(0.3), float(1), v).mul(0.9).add(0.45); // slim at the nozzle, a soft plume above
    jm.positionNode = vec3(jet.x.add(positionLocal.x.sub(jet.x).mul(flare)), positionLocal.y.sub(poolY + 0.02).mul(pulse).add(poolY + 0.02), jet.y.add(positionLocal.z.sub(jet.y).mul(flare)));
    // water by day (white spray, a little shaded blue); at night the jet is lit from its base in the sign's colour
    jm.colorNode = mix(vec3(0.86, 0.9, 0.95), mix(vec3(0.8, 0.62, 1), vertexColor(), 0.3).mul(1.5), night); // lavender at night, a little of the letter's colour in it
    const edge = float(1).sub(abs(u.mul(2).sub(1)));
    const column = smoothstep(float(0), float(1), edge).pow(1.4); // soft gaussian-like body
    const strands = sin(u.mul(31).add(ph.mul(50)).add(v.mul(hgt).mul(3)).sub(time.mul(6))).mul(0.25).add(0.75).mul(sin(v.mul(hgt).mul(6).sub(time.mul(8)).add(ph.mul(40))).mul(0.2).add(0.8)); // spray running up it
    jm.opacityNode = column.mul(strands).mul(smoothstep(float(0), float(0.05), v)).mul(float(1).sub(smoothstep(float(0.8), float(1), v))).mul(0.62);
    const jetMesh = new THREE.Mesh(jg, jm); jetMesh.name = 'TorontoSignFountainJets'; jetMesh.renderOrder = 4;
    group.add(jetMesh);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(bcols, 3));
    bg.computeBoundingSphere();
    const bm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const rr = uv().sub(0.5).length().mul(2);
    bm.colorNode = vertexColor().mul(float(1).sub(rr).max(0).pow(2.2)).mul(night).mul(1.8);
    bm.opacityNode = float(1);
    const baseGlow = new THREE.Mesh(bg, bm); baseGlow.name = 'TorontoSignFountainLights'; baseGlow.renderOrder = 3;
    group.add(baseGlow);
    jets = sites.length; waterTriangles += pos.length / 9 + bpos.length / 9;
  }

  const b = collider();
  const colliders = [{ ...b, minY: y0, maxY: y0 + b.maxY }];
  C.torontoSignStats = { elements: signElements().length, letters: SPEC.word.length, y0: +y0.toFixed(3), triangles: letters.attributes.position.count / 3, water, fountain, jets, waterTriangles, colliders: colliders.length };
  console.info('[toronto-sign] ' + JSON.stringify(C.torontoSignStats));
  return { group, colliders, y0 };
}

Object.assign(C, { TORONTO_SIGN: { SPEC, letterPieces, letterSlots, signElements, leafOutline, LEAF_OUTLINE, leafPieces, wheelPieces, colorAt, fountainOn, jetSites, collider }, buildTorontoSign });
})();
