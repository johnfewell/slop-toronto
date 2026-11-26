(function () {
// js/toronto-sign.js
// The 3D TORONTO sign at Nathan Phillips Square (docs/toronto-sign.md): seven lit letters on a low plinth along the north
// coping of the reflecting pool, facing south across the water. The City replaced the 2015 original with a more durable
// copy in September 2020 and still lights it (City of Toronto, "Toronto Sign", read 2026-11-26: 3 m tall, illuminated).
// Slop draws the word only: no maple leaf, no medicine wheel, no vinyl wrap, no other mark.
//
// Place and size are measured from the City's 2025 orthophoto (cot_ortho_2025_color_8cm, read 2026-11-26), where the
// sign's pastel tops and its long shadow lie along the pool's north edge: letters from x -19.7 to 1.9 (21.6 m; the
// published length is 22 m), centre line z -821.7, 2.9 m north of the pool polygon's edge (z -818.8), and a wikimedia
// photograph from the pool side (3DTorontoSignSept2020.jpg) gives the letters' order, pastel colours and that the face
// looks south, reading west to east. Pure helpers first (loaded by tests in node), then the builder.
const C = window.CITY;

// World metres (x east, z south of the origin)
const SPEC = Object.freeze({
  word: 'TORONTO',
  x0: -19.7, // west end of the first letter's slot
  pitch: 3.1, // one letter's slot
  zc: -821.7, // the middle of the letters' depth
  height: 2.6, // the letters (the plinth adds 0.45: 3.05 m in all, "three metres tall")
  depth: 0.9,
  stroke: 0.55,
  plinth: Object.freeze({ x0: -20.2, x1: 2.4, depth: 1.5, h: 0.45 }),
  // pastel faces seen in the 2020 photograph: T blue, O green, R pink, O lilac, N green, T pink, O blue
  colors: Object.freeze([0xaebeff, 0xdde8a4, 0xf4a6c6, 0xb3b9ff, 0xe4eeaa, 0xf4a6c6, 0xaebfff]),
  widths: Object.freeze({ T: 2.7, O: 2.7, R: 2.4, N: 2.5 })
});

// Each letter as flat pieces [{ outer: [[u, v]...], holes: [[[u, v]...]] }] in a box u 0..w, v 0..h (u east when the
// letter faces south). A piece is a polygon, an arc is sampled; pieces of one letter may overlap (they are merged as solids).
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
      return [{ outer: arcPts(w / 2, h / 2, r, 0, Math.PI * 2, 48).slice(0, -1), holes: [arcPts(w / 2, h / 2, r - s, 0, Math.PI * 2, 48).slice(0, -1).reverse()] }];
    }
    case 'R': {
      const r = h * 0.27, cu = w - r, cv = h - r;
      return [
        { outer: [[0, 0], [s, 0], [s, h], [0, h]], holes: [] },
        { outer: [[0, h - 2 * r], [cu, h - 2 * r], ...arcPts(cu, cv, r, -Math.PI / 2, Math.PI / 2), [0, h]], holes: [[[s, h - 2 * r + s], [s, h - s], ...arcPts(cu, cv, r - s, Math.PI / 2, -Math.PI / 2), [cu, h - 2 * r + s]]] },
        { outer: [[w * 0.3, h - 2 * r + 0.05], [w * 0.3 + s * 1.15, h - 2 * r + 0.05], [w, 0], [w - s * 1.15, 0]], holes: [] }
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

// Where each letter stands: [{ ch, x (its slot's west edge + the centring), w, color }]
function letterSlots() {
  return [...SPEC.word].map((ch, i) => {
    const w = SPEC.widths[ch];
    return { ch, x: SPEC.x0 + i * SPEC.pitch + (SPEC.pitch - w) / 2, w, color: SPEC.colors[i] };
  });
}

// The solid footprint people walk around (x/z box, heights above the paving)
function collider() {
  const p = SPEC.plinth;
  return { minX: p.x0, maxX: p.x1, minZ: SPEC.zc - p.depth / 2, maxZ: SPEC.zc + p.depth / 2, minY: 0, maxY: p.h + SPEC.height };
}

function buildTorontoSign(scene) {
  const { THREE, TSL, Addons } = C;
  if (!THREE || !Addons?.mergeGeometries) return null;
  const groundAt = (x, z) => (C.blockAt?.(x, z) ? C.CITY_BOUNDS.sidewalkHeight : 0) + (C.cutAt?.(x, z) || 0);
  const shadowOn = C.QUALITY?.kerbShadows !== false;
  const y0 = groundAt(SPEC.plinth.x0 + 11, SPEC.zc);
  const geos = [];
  for (const L of letterSlots()) {
    for (const piece of letterPieces(L.ch)) {
      const shape = new THREE.Shape(piece.outer.map(([u, v]) => new THREE.Vector2(u, v)));
      for (const hole of piece.holes) shape.holes.push(new THREE.Path(hole.map(([u, v]) => new THREE.Vector2(u, v))));
      const g = new THREE.ExtrudeGeometry(shape, { depth: SPEC.depth, bevelEnabled: false, curveSegments: 12 });
      g.translate(L.x, y0 + SPEC.plinth.h, SPEC.zc - SPEC.depth / 2); // front face (+z) looks south
      const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color(L.color);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.deleteAttribute('uv');
      geos.push(g.index ? g.toNonIndexed() : g);
    }
  }
  const letters = Addons.mergeGeometries(geos, false);
  letters.computeBoundingSphere();
  const { float, smoothstep, vertexColor } = TSL;
  const night = C.cityUniforms?.uInteriorGlow ? smoothstep(float(0.7), float(1.45), C.cityUniforms.uInteriorGlow) : float(0);
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55 });
  // lit from inside: a quiet glow by day, the full pastel at night (on the windows' night ramp)
  mat.emissiveNode = vertexColor().mul(night.mul(0.85).add(0.1));
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
  const b = collider();
  const colliders = [{ ...b, minY: y0, maxY: y0 + b.maxY }];
  C.torontoSignStats = { letters: SPEC.word.length, y0: +y0.toFixed(3), triangles: letters.attributes.position.count / 3, colliders: colliders.length };
  console.info('[toronto-sign] ' + JSON.stringify(C.torontoSignStats));
  return { group, colliders, y0 };
}

Object.assign(C, { TORONTO_SIGN: { SPEC, letterPieces, letterSlots, collider }, buildTorontoSign });
})();
