(function () {
// js/freedom-arches.js
// The Freedom Arches: the three concrete arches that span the reflecting pool at Nathan Phillips Square, part of Viljo Revell's
// original 1965 design (docs/freedom-arches.md). They stand all year; holiday.js lights them for the Cavalcade of Lights.
//
// Size and place are read from the City of Toronto's 3D Massing 2025 multipatch (Open Government Licence – Toronto), where the
// three arches are one separate feature (1,195 faces; tools/measure-freedom-arches.mjs re-derives the numbers below): each
// arch is a 1.55 m wide band running across the pool's short side, an almost exact half ellipse, 38.56 m between its outer
// feet and 9.14 m high at the crown, 0.50 m deep at the crown and about 1.2 m thick at the feet. The three stand 8.4 m apart
// (centres 12.18, 20.67 and 29.06 m east of the world origin, spanning z -823.2 to -784.6, centre z -803.92). The City's 2025
// orthophoto agrees: three plain concrete arches on small footing blocks, their feet on the paving just beyond the pool's coping.
// Pure helpers first (loaded by tests in node), then the builder: one merged concrete mesh, six leg colliders.
const C = window.CITY;

// World metres (x east, z south of the origin), heights above the paving at the feet
const SPEC = Object.freeze({
  xs: Object.freeze([12.18, 20.67, 29.06]), // centre line of each arch
  zc: -803.92, // the middle of the span
  width: 1.55, // across the arch (x)
  outer: Object.freeze({ a: 19.28, b: 9.14 }), // half span and rise of the top surface
  inner: Object.freeze({ a: 18.08, b: 8.64 }), // the underside (soffit)
  plinth: Object.freeze({ w: 1.9, d: 1.9, h: 0.35 }), // a footing block at each foot
  headroom: 2.3, // below this soffit height an arch's legs block the way; above it people walk under
  segments: 48
});

// A point on an ellipse of half span a and rise b, from phi 0 (the foot at the lowest z) to PI (the foot at the highest z): [z, y]
const onEllipse = (e, phi, dz = 0, dy = 0) => [SPEC.zc - (e.a + dz) * Math.cos(phi), (e.b + dy) * Math.sin(phi)];
// Where the soffit climbs through height y on the low-z side: its offset from the span's middle
const soffitZAt = (y) => SPEC.zc - SPEC.inner.a * Math.sqrt(1 - Math.min(1, (y / SPEC.inner.b) ** 2));

// Evenly spaced points (every `spacing` m of arc) along a line hugging the top of an arch ('top') or its underside ('under'):
// [y above the feet, z]; x is the arch's centre line. Used for the Cavalcade's bulb lines.
function archLinePoints(side, spacing = 0.9) {
  const e = side === 'under' ? SPEC.inner : SPEC.outer, off = side === 'under' ? -0.13 : 0.13;
  const fine = [];
  for (let i = 0; i <= 600; i++) { const [z, y] = onEllipse(e, (i / 600) * Math.PI, off, off); fine.push([y, z]); }
  const out = [];
  let run = 0, next = spacing * 0.5;
  for (let i = 1; i < fine.length; i++) {
    run += Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]);
    if (run >= next) { out.push(fine[i]); next += spacing; }
  }
  return out.filter(([y]) => y > 0.3);
}

// The leg blocks: where an arch's soffit is lower than a person walks under, from its foot to that point. x/z boxes, heights
// above the feet (the builder adds the paving height)
function legBoxes() {
  const zIn = soffitZAt(SPEC.headroom), half = SPEC.width / 2 + 0.05, foot = SPEC.zc - SPEC.outer.a - 0.3;
  const top = SPEC.outer.b * Math.sqrt(1 - ((SPEC.zc - zIn) / SPEC.outer.a) ** 2);
  const lo = { minZ: foot, maxZ: zIn }, hi = { minZ: 2 * SPEC.zc - zIn, maxZ: 2 * SPEC.zc - foot };
  const boxes = [];
  for (const x of SPEC.xs) for (const l of [lo, hi]) boxes.push({ minX: x - half, maxX: x + half, minZ: l.minZ, maxZ: l.maxZ, minY: 0, maxY: top });
  return boxes;
}

function buildFreedomArches(scene) {
  const { THREE, Addons } = C;
  const groundAt = (x, z) => (C.blockAt?.(x, z) ? C.CITY_BOUNDS.sidewalkHeight : 0) + (C.cutAt?.(x, z) || 0);
  const N = SPEC.segments, shadowOn = C.QUALITY?.kerbShadows !== false;
  const geos = [];
  const colliders = [];
  const y0s = [];
  for (const x of SPEC.xs) {
    const y0 = groundAt(x, SPEC.zc);
    y0s.push(+y0.toFixed(3));
    const xa = x - SPEC.width / 2, xb = x + SPEC.width / 2;
    const O = [], I = [];
    for (let k = 0; k <= N; k++) { const phi = (k / N) * Math.PI; O.push(onEllipse(SPEC.outer, phi)); I.push(onEllipse(SPEC.inner, phi)); }
    const pos = [];
    const tri = (p, q, r) => pos.push(...p, ...q, ...r);
    const quad = (p, q, r, s) => { tri(p, q, r); tri(p, r, s); };
    for (let k = 0; k < N; k++) {
      const o0 = O[k], o1 = O[k + 1], i0 = I[k], i1 = I[k + 1];
      quad([xa, o0[1], o0[0]], [xa, o1[1], o1[0]], [xb, o1[1], o1[0]], [xb, o0[1], o0[0]]); // top
      quad([xa, i0[1], i0[0]], [xb, i0[1], i0[0]], [xb, i1[1], i1[0]], [xa, i1[1], i1[0]]); // underside
      quad([xa, o0[1], o0[0]], [xa, i0[1], i0[0]], [xa, i1[1], i1[0]], [xa, o1[1], o1[0]]); // west side
      quad([xb, o0[1], o0[0]], [xb, o1[1], o1[0]], [xb, i1[1], i1[0]], [xb, i0[1], i0[0]]); // east side
    }
    for (const [o, i] of [[O[0], I[0]], [O[N], I[N]]]) { // the feet's flat ends
      const zo = o[0], zi = i[0];
      quad([xa, 0.02, zo], [xb, 0.02, zo], [xb, 0.02, zi], [xa, 0.02, zi]);
    }
    for (const sign of [-1, 1]) { // footing blocks
      const zz = SPEC.zc + sign * (SPEC.outer.a + SPEC.inner.a) / 2, { w, d, h } = SPEC.plinth;
      const b = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      b.deleteAttribute('uv'); b.deleteAttribute('normal');
      b.translate(x, h / 2 - 0.02, zz);
      const p = b.attributes.position.array;
      for (let i = 0; i < p.length; i++) pos.push(p[i]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.translate(0, y0, 0);
    geos.push(g);
  }
  const merged = Addons.mergeGeometries(geos, false);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0xd4d0c6, roughness: 0.88 });
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = 'FreedomArches';
  mesh.castShadow = shadowOn; mesh.receiveShadow = true;
  const group = new THREE.Group(); group.name = 'FreedomArchesGroup'; group.add(mesh); scene.add(group);
  const boxes = legBoxes();
  boxes.forEach((b, i) => { const y0 = y0s[Math.floor(i / 2)]; colliders.push({ ...b, minY: y0 + b.minY - 0.3, maxY: y0 + b.maxY }); });
  C.freedomArchStats = { arches: SPEC.xs.length, y0: y0s, triangles: merged.attributes.position.count / 3, colliders: colliders.length };
  console.info('[freedom-arches] ' + JSON.stringify(C.freedomArchStats));
  return { group, colliders, y0s };
}

Object.assign(C, { FREEDOM_ARCHES: { SPEC, onEllipse, soffitZAt, archLinePoints, legBoxes }, buildFreedomArches });
})();
