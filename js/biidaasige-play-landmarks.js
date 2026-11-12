(function () {
// js/biidaasige-play-landmarks.js
// The two signature play structures of Biidaasige Park (Port Lands, st-bmyv epic):
//
//   1. Snowy Owl Play Theatre — Monstrum (monstrum.dk/en/playground/snowy-owl-play-theatre).
//   2. Reaching Raccoon — Earthscape (earthscapeplay.com/fr/projects/biidaasige-park-raccoon-playground/).
//
// This is a REWORK after the captain's GPU review of the first build (play-review.md): the first owl read as a
// black prison barrel with a separate floating sphere head, and the raccoon as a tiny grey box with a sealed pipe.
// The rebuild follows the captain's corrected source observations, which are authoritative here:
//
// OWL  — the body is ~85–95 % WHITE (broad fitted slat surfaces, not thin rods), with sparse long BLACK slots and
//        rare pastel accents. NO separate ball head or neck gap: one continuous body→shoulder→rounded-crown silhouette
//        that pitches forward; eye masks sit on the continuous front upper body; two large swept slatted wing panels
//        taper to the ground behind; a red belly/stage opening at the lower front with curved timber nest tiers.
//
// RAC — the whole body is OPEN faceted natural cream/red-brown TIMBER slats (no smooth grey fur box); a broad
//        triangular white/black face mask, pointed ears, wide curved wooden striped arms, a hollow striped tail den;
//        a huge lime-green leaf over green cattail posts with brown capsules and blue/white dragonfly accents; logs and
//        net pegs around; the metal slide is an OPEN U-shaped polished chute, not a sealed pipe. Overall ~5–6 m.
//
// Contract (unchanged): reusable, LOCAL-ORIGIN model. Each builder returns a fresh THREE.Group whose origin is the
// ground contact, +Y up, 1 unit = 1 m, ground at y = 0, the structure facing +Z. Constructors NEVER touch a scene
// unless the captain passes one. `climbable` stays false until the captain integrates movement/footing. Dimensions are
// explicit PHOTO ESTIMATES (`estimates`). No hidden generic house collision. No external image or network is read.
//
// Attribution: Snowy Owl Play Theatre by Monstrum; Reaching Raccoon by Earthscape. This is a recognisable scaled
// reconstruction for Slop Toronto, not the makers' production model. See docs/biidaasige-play-landmarks.md.

const C = (typeof window !== 'undefined' && (window.CITY || (window.CITY = {}))) || {};
const THREE = C.THREE;

// -------------------------------------------------------------------------------------------------------------------
// Photo-estimate specifications (recognisable over precise: dimensions are estimates)
// -------------------------------------------------------------------------------------------------------------------

// Snowy Owl. Origin at the base's ground contact; the owl faces +Z (stage/belly to +Z).
const OWL_SPEC = {
  baseRadius: 3.0,
  crownHeight: 9.0,          // base top edge to the rounded crown (official ~9 m)
  lean: 0.30,                // forward (+Z) pitch of the whole body, radians
  profileSteps: 34,          // height steps of the continuous profile
  angularSegments: 72,       // degrees around the body per slat course
  boardGap: 0.035,           // fraction gap between neighbouring boards (glue-line)
  slotChance: 0.055,         // fraction of boards that are a deliberate long black slot
  pastelChance: 0.055,       // fraction of boards that are a pastel accent
  slotDepth: 0.22,           // how far the dark backing sits behind the board surface (clearly inset)
  shoulderY: 6.4,            // where the body bulges to the broad shoulder
  shoulderBulge: 0.30,       // extra radius at the shoulder (fraction of base radius)
  crownStart: 7.6,           // where the profile turns into the rounded crown
  crownRadius: 1.55,         // the rounded crown's radius
  headForward: 0.95,         // the crown's forward (+Z) lead over the torso axis
  eyeY: 8.15,                // eye mask centres
  eyeForward: 0.12,          // eye mask sits flush on the body's front (not protruding discs)
  eyeHalfWidth: 1.16,        // half the -X..+X span of one eye mask
  eyeHalfHeight: 0.92,
  eyeSlats: 20,              // radial white slats per eye
  pupilRadius: 0.30,
  beakLength: 0.55,
  wingSpan: 3.4,             // how far a swept wing panel reaches out/back
  wingFeathers: 9,
  stageRadius: 2.35,         // the red belly/stage opening's half width
  stageTop: 2.55,
  stageBase: 0.55,
  stageDepth: 0.5,           // how far the red stage recess is set back (an OPEN recess, not a black door)
  portalHalfWidth: 1.0,      // the accessible front opening
  nestTiers: 4,              // natural curved timber nest tiers in front
  nestOuter: 3.9,
  distance: 0.55,
};

// Reaching Raccoon. Origin at the raccoon's feet; the raccoon faces +Z (cattail held to its +X side).
const RACCOON_SPEC = {
  totalHeight: 5.7,          // feet to the leaf top (the brief says ~5–6 m overall; explicit estimate)
  bodyHeight: 3.9,           // feet to the crown of the head
  legHeight: 1.05,
  torsoRadius0: 0.72,        // lower torso
  torsoRadius1: 0.58,        // chest
  torsoLean: 0.22,
  boardCount: 30,            // vertical faceted timber boards forming the closed torso volume
  boardWidth0: 0.40,         // wider at the base
  boardWidth1: 0.30,
  openGapFrac: 0.04,         // a thin seam between boards (faceted, not bare posts)
  facetDepth: 0.10,          // how far alternating boards step proud (faceted volume, not a smooth cylinder)
  armCount: 2,
  armLength: 2.0,
  faceWidth: 2.0,           // broad triangular face mask
  faceHeight: 1.55,
  earHeight: 0.5,
  tailRadius0: 0.42,
  tailRadius1: 0.16,
  tailRings: 6,
  tailSweep: 2.6,
  cattailPosts: 2,           // green cattail posts
  cattailHeight: 4.2,        // post top (the pointed leaf crowns it at ~5.7)
  leafHeight: 1.75,          // the huge lime leaf above the posts (pointed organic outline)
  leafWidth: 2.8,
  leafVeins: 7,              // vein ribs across the leaf
  cactusHeadLength: 0.85,    // brown capsule heads on the posts
  slideTopY: 2.65,
  slideLength: 4.6,
  slideWidth: 0.9,           // the open chute's half-open width
  stepperCount: 6,
  logCount: 5,
  ropeCount: 4,
  dragonflies: 3,            // blue/white flat dragonfly accents
  distance: 0.55,
};

// -------------------------------------------------------------------------------------------------------------------
// Geometry helpers
// -------------------------------------------------------------------------------------------------------------------

// A continuous surface of revolution with a fitted width, built from real quad boards (fitted, not rods). `profile(y)`
// returns the radius; `boardMat(y, angle, u)` returns a colour key per board column. Built as concentric rings of
// trapezoid boards that follow the taper, leaving a narrow glue gap, with occasional long dark slots and pastels.
function fittedShell(profileY, y0, y1, steps, segments, opts) {
  const { gap = 0.03, slotAt = () => false, pastelAt = () => false, heightAt = (y) => y, omitAt = () => false } = opts || {};
  const boards = []; // { geo, key }
  const rows = [];
  for (let s = 0; s <= steps; s++) {
    const y = y0 + ((y1 - y0) * s) / steps;
    const r = profileY(y);
    rows.push({ y, r });
  }
  for (let s = 0; s < steps; s++) {
    const A = rows[s], B = rows[s + 1];
    const yA = A.y, yB = B.y, rA = A.r, rB = B.r;
    const yMid = (yA + yB) / 2, rHalf = (rA + rB) / 2;
    const circum = 2 * Math.PI * rHalf;
    const cell = circum / segments;                 // the angular pitch on this ring
    const w = cell * (1 - gap);                      // the board's real fitted width (leaves the glue gap)
    for (let i = 0; i < segments; i++) {
      const aMid = ((i + 0.5) / segments) * Math.PI * 2;
      if (omitAt(yMid, aMid)) continue;
      const inSlot = slotAt(yMid, i, s);
      const pastel = !inSlot && pastelAt(yMid, i, s);
      // 4 corners of the board quad (bottom-left, bottom-right, top-right, top-left) at (angle, y, r)
      const corner = (daFrac, y, r) => {
        const a = aMid + daFrac / r;   // convert an arc-width to angle at radius r
        return [Math.sin(a) * r, y, Math.cos(a) * r];
      };
      const dF = w / 2;
      const bl = corner(-dF, yA, rA), br = corner(dF, yA, rA), tr = corner(dF, yB, rB), tl = corner(-dF, yB, rB);
      const pos = [bl, br, tr, bl, tr, tl].flat();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      // uv: u = angular position, v = height (a long dark slot is chosen from `u` in the shader/material logic)
      const u0 = i / segments, u1 = (i + 1) / segments;
      g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, yA, u1, yA, u1, yB, u0, yA, u1, yB, u0, yB], 2));
      g.computeVertexNormals();
      boards.push({ geo: g, key: inSlot ? 'slot' : pastel ? (i % 2 ? 'pastel' : 'pastelPink') : 'white' });
    }
  }
  return boards;
}

// A dark backing wall just inside a fitted shell, so the sparse slots and the board gaps read as shadow, not through-
// holes. Inset (smaller radius), NOT an opaque outer cylinder.
function backingShell(profileY, y0, y1, steps, seg, inset, key = 'dark', omitAt = () => false) {
  const pos = [], nor = [], uv = [];
  const v = (a, y, r) => [Math.sin(a) * r, y, Math.cos(a) * r];
  const rows = [];
  for (let s = 0; s <= steps; s++) { const y = y0 + ((y1 - y0) * s) / steps; rows.push({ y, r: Math.max(0.02, profileY(y) - inset) }); }
  for (let s = 0; s < steps; s++) {
    const A = rows[s], B = rows[s + 1];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      if (omitAt((A.y+B.y)/2, (a0+a1)/2)) continue;
      const bl = v(a0, A.y, A.r), br = v(a1, A.y, A.r), tr = v(a1, B.y, B.r), tl = v(a0, B.y, B.r);
      for (const q of [bl, br, tr, bl, tr, tl]) pos.push(...q);
      for (let k = 0; k < 6; k++) { nor.push(0, 0, 0); uv.push(0, 0); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return { geo: g, key };
}

// An upright flat annulus (deck / stage floor), wound to face +Y.
function flatRing(r0, r1, y, seg) {
  const pos = [], nor = [], uv = [];
  const p = (a, r) => [Math.sin(a) * r, y, Math.cos(a) * r];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const A = p(a0, r0), B = p(a1, r0), Cp = p(a1, r1), D = p(a0, r1);
    const ux = A[0], uz = A[2];
    if (Math.hypot(B[0] - A[0], B[2] - A[2]) < 1e-6) continue;
    for (const q of [A, D, Cp, A, Cp, B]) { pos.push(...q); nor.push(0, 1, 0); }
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  }
  return buffer(pos, nor, uv);
}

// A fitted closed body of revolution (outer faces only) from a radius profile — the continuous owl body and the
// raccoon torso. Real quads, fitted, with uvs; normals computed.
function bodyOfRevolution(profileY, y0, y1, steps, seg) {
  const pos = [], uv = [];
  const v = (a, y, r) => [Math.sin(a) * r, y, Math.cos(a) * r];
  const rows = [];
  for (let s = 0; s <= steps; s++) { const y = y0 + ((y1 - y0) * s) / steps; rows.push({ y, r: profileY(y) }); }
  for (let s = 0; s < steps; s++) {
    const A = rows[s], B = rows[s + 1];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const bl = v(a0, A.y, A.r), br = v(a1, A.y, A.r), tr = v(a1, B.y, B.r), tl = v(a0, B.y, B.r);
      for (const q of [bl, br, tr, bl, tr, tl]) pos.push(...q);
      uv.push(i / seg, s / steps, (i + 1) / seg, s / steps, (i + 1) / seg, (s + 1) / steps, i / seg, s / steps, (i + 1) / seg, (s + 1) / steps, i / seg, (s + 1) / steps);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// A partial body of revolution (an arc span a0..a1) — the raccoon's OPEN slatted torso shell.
function arcShell(profileY, y0, y1, steps, seg, a0, a1, inset) {
  const pos = [], uv = [];
  const v = (a, y, r) => [Math.sin(a) * r, y, Math.cos(a) * r];
  const rows = [];
  for (let s = 0; s <= steps; s++) { const y = y0 + ((y1 - y0) * s) / steps; rows.push({ y, r: Math.max(0.02, profileY(y) - inset) }); }
  for (let s = 0; s < steps; s++) {
    const A = rows[s], B = rows[s + 1];
    for (let i = 0; i < seg; i++) {
      const aa = a0 + ((a1 - a0) * i) / seg, ab = a0 + ((a1 - a0) * (i + 1)) / seg;
      const bl = v(aa, A.y, A.r), br = v(ab, A.y, A.r), tr = v(ab, B.y, B.r), tl = v(aa, B.y, B.r);
      for (const q of [bl, br, tr, bl, tr, tl]) pos.push(...q);
      uv.push(i / seg, s / steps, (i + 1) / seg, s / steps, (i + 1) / seg, (s + 1) / steps, i / seg, s / steps, (i + 1) / seg, (s + 1) / steps, i / seg, (s + 1) / steps);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// A trapezoid board wrapped onto a torso of revolution: spans an angular pitch at (base, mid, top) radii, tapering with
// the torso and stepping `proud` outward from the shell. Used for the raccoon's faceted timber volume.
function boardFrustumBoard(aMid, pitch, bw, rBase, rMid, rTop, yBase, h, proud, zOff) {
  const halfAng = (bw / 2) / Math.max(0.2, rMid);   // the board's angular half-width at its own radius
  const rows = [
    { y: yBase, r: rBase + proud },
    { y: yBase + h * 0.5, r: rMid + proud },
    { y: yBase + h, r: rTop + proud },
  ];
  const pos = [], uv = [];
  const P = (a, y, r) => [Math.sin(a) * r, y, Math.cos(a) * r + zOff(y)];
  for (let s = 0; s + 1 < rows.length; s++) {
    const A = rows[s], B = rows[s + 1];
    const bl = P(aMid - halfAng, A.y, A.r), br = P(aMid + halfAng, A.y, A.r);
    const tr = P(aMid + halfAng, B.y, B.r), tl = P(aMid - halfAng, B.y, B.r);
    for (const q of [bl, br, tr, bl, tr, tl]) { pos.push(...q); uv.push(0, 0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// A flat swept panel (the owl wings, the raccoon face mask): a quad with thickness along the surface normal.
function slab(c, u, v, thick, n) {
  const N = n ? n.clone().normalize() : new THREE.Vector3().crossVectors(u, v).normalize();
  const h = thick / 2;
  const P = (su, sv, so) => new THREE.Vector3(c.x + u.x * su + v.x * sv, c.y + u.y * su + v.y * sv, c.z + u.z * su + v.z * sv).addScaledVector(N, so * h);
  const corners = [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
  const pos = [], nor = [], uv = [];
  const push = (p, nn) => { pos.push(p.x, p.y, p.z); nor.push(nn.x, nn.y, nn.z); uv.push(p.x, p.y); };
  for (const tri of [[0, 1, 2], [0, 2, 3]]) for (const k of tri) push(corners[k], N);
  for (const tri of [[3, 2, 1], [3, 1, 0]]) for (const k of tri) push(corners[k], N.clone().negate());
  return buffer(pos, nor, uv);
}

// A tipped cone (beak / ears / cattail capsule), flat-shaded.
function cone(base, apex, r, seg = 4) {
  const dir = new THREE.Vector3().subVectors(new THREE.Vector3(...apex), new THREE.Vector3(...base));
  const len = dir.length();
  const g = new THREE.ConeGeometry(r, len, seg, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  g.translate(base[0], base[1], base[2]);
  return g.toNonIndexed();
}
function rod(a, b, r, radial = 7) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, Math.max(1e-3, len), radial, 1, false);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate(a.x, a.y, a.z);
  return g.toNonIndexed();
}
function boxGeo(cx, cy, cz, sx, sy, sz) { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(cx, cy, cz); return g.toNonIndexed(); }
function sphereGeo(cx, cy, cz, r, w = 16, h = 12) { const g = new THREE.SphereGeometry(r, w, h); g.translate(cx, cy, cz); return g.toNonIndexed(); }

function buffer(pos, nor, uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// Merge a [{geo,key}] list into one geometry per material key (real merge; concat fallback without the util).
function mergeByKey(list) {
  const out = new Map();
  for (const { geo, key } of list) {
    if (!geo) continue;
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(g);
  }
  const merged = new Map();
  for (const [key, geos] of out) {
    const g = geos.length === 1 ? geos[0] : (C.Addons && C.Addons.mergeGeometries ? C.Addons.mergeGeometries(geos, false) : concat(geos));
    g.computeBoundingBox(); g.computeBoundingSphere();
    merged.set(key, g);
  }
  return merged;
}
function concat(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) {
    const p = g.attributes.position, nn = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos[(o + i) * 3] = p.getX(i); pos[(o + i) * 3 + 1] = p.getY(i); pos[(o + i) * 3 + 2] = p.getZ(i);
      nor[(o + i) * 3] = nn ? nn.getX(i) : 0; nor[(o + i) * 3 + 1] = nn ? nn.getY(i) : 1; nor[(o + i) * 3 + 2] = nn ? nn.getZ(i) : 0;
      uv[(o + i) * 2] = u ? u.getX(i) : 0; uv[(o + i) * 2 + 1] = u ? u.getY(i) : 0;
    }
    o += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// -------------------------------------------------------------------------------------------------------------------
// Materials — plain MeshStandardNodeMaterial (no image inputs; frame-safe to build in a test).
// -------------------------------------------------------------------------------------------------------------------
function materials(kind) {
  const M = THREE.MeshStandardNodeMaterial;
  if (kind === 'owl') {
    return {
      white: new M({ color: 0xefeade, roughness: 0.74, metalness: 0.0 }),
      dark: new M({ color: 0x141517, roughness: 0.82, metalness: 0.0 }),      // backing + black slots
      slot: new M({ color: 0x1a1c1f, roughness: 0.78, metalness: 0.0 }),      // deliberate long black boards
      pastel: new M({ color: 0xbfe3e6, roughness: 0.68, metalness: 0.0 }),
      pastelPink: new M({ color: 0xe6c4d2, roughness: 0.68, metalness: 0.0 }),
      red: new M({ color: 0xa9372e, roughness: 0.7, metalness: 0.0 }),
      timber: new M({ color: 0x7c5a39, roughness: 0.9, metalness: 0.0 }),
      cream: new M({ color: 0xd9cbac, roughness: 0.82, metalness: 0.0 }),
      stageFloor: new M({ color: 0x2a1c17, roughness: 0.9, metalness: 0.0 }),   // inside the red stage recess
      pupil: new M({ color: 0x0b0b0c, roughness: 0.5, metalness: 0.0 })
    };
  }
  return {
    timber: new M({ color: 0xa87a4c, roughness: 0.9, metalness: 0.0 }),       // natural cream/red-brown timber
    timberCream: new M({ color: 0xd9c8a6, roughness: 0.88, metalness: 0.0 }), // pale cream timber boards
    timberRed: new M({ color: 0x8a4a33, roughness: 0.9, metalness: 0.0 }),    // reddish timber boards
    timberDark: new M({ color: 0x5a3c25, roughness: 0.92, metalness: 0.0 }),
    pale: new M({ color: 0xe8e2d6, roughness: 0.8, metalness: 0.0 }),         // white face mask
    darkMask: new M({ color: 0x22201e, roughness: 0.84, metalness: 0.0 }),    // black mask
    leaf: new M({ color: 0x6fae2e, roughness: 0.7, metalness: 0.0 }),         // lime-green leaf
    leafVein: new M({ color: 0x3f6b1f, roughness: 0.78, metalness: 0.0 }),    // darker leaf veins
    greenPost: new M({ color: 0x3f7d3a, roughness: 0.72, metalness: 0.0 }),
    cattail: new M({ color: 0x6d5233, roughness: 0.94, metalness: 0.0 }),     // brown capsules
    dragonfly: new M({ color: 0x3f7fd8, roughness: 0.5, metalness: 0.1 }),
    dragonflyWing: new M({ color: 0xdfe9f2, roughness: 0.5, metalness: 0.0 }),
    log: new M({ color: 0x6c4b2c, roughness: 0.94, metalness: 0.0 }),
    metal: new M({ color: 0xc4c8cb, roughness: 0.26, metalness: 0.85 }),
    rope: new M({ color: 0x5b4a33, roughness: 0.95, metalness: 0.0 }),
  };
}

// -------------------------------------------------------------------------------------------------------------------
// Snowy Owl Play Theatre
// -------------------------------------------------------------------------------------------------------------------
function buildOwlPlayTheatre(opts = {}) {
  const S = { ...OWL_SPEC, ...(opts.spec || {}) };
  const g = new THREE.Group();
  g.name = 'BiidaasigeSnowyOwlTheatre';
  const parts = [];
  const colliders = [];
  const surfaces = [];
  const estimates = { ...S };

  const crownBase = S.crownStart, crownTop = S.crownHeight;
  // The outer radius of the continuous body profile: a broad base tapering up, a shoulder bulge, then the rounded crown.
  const radiusAt = (y) => {
    if (y <= S.shoulderY) {
      const t = clamp(y / S.shoulderY, 0, 1);
      const taper = S.baseRadius * (1 - 0.42 * t);
      return taper * (1 + S.shoulderBulge * smooth(t * t));
    }
    if (y <= crownBase) return S.baseRadius * (1 - 0.42) * (1 + S.shoulderBulge) - 0.25 * ((y - S.shoulderY) / (crownBase - S.shoulderY));
    // the rounded crown: a dome that closes toward the top
    const t = clamp((y - crownBase) / (crownTop - crownBase), 0, 1);
    return Math.max(0.12, S.crownRadius * Math.sqrt(Math.max(0, 1 - t * t)));
  };
  // Forward pitch: the whole body leans forward, strongest at the crown (a continuous forward-curving axis).
  const zOffset = (y) => .62 * y + .15 * smooth(clamp((y-S.shoulderY)/(crownTop-S.shoulderY),0,1));

  // slot / pastel selection: sparse, long, deliberate
  const slotAt = (y, i, s) => hash(i, Math.floor(s / 5)) < S.slotChance;
  const pastelAt = (y, i, s) => !slotAt(y, i, s) && hash(i + 7, Math.floor(s / 5) + 3) < S.pastelChance;

  // (1) the continuous white slat body (real fitted boards covering most of the surface) + a smaller dark backing inset
  const openingAt = (y, a) => y < S.stageTop && y > .3 && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < .48;
  const yBottom = 0.35;   // leave the very bottom open for the portal
  for (const { geo, key } of fittedShell(radiusAt, yBottom, crownBase + 0.15, S.profileSteps, S.angularSegments, {
    gap: S.boardGap, slotAt, pastelAt, omitAt: openingAt
  })) {
    geo.translate(0, 0, 0);
    parts.push({ geo: pitched(geo, zOffset), key });
  }
  // a smaller dark backing inset (NOT an opaque outer cylinder): reads as shadow behind slots and gaps
  parts.push({ geo: pitched(backingShell(radiusAt, yBottom, crownBase + 0.1, S.profileSteps, 40, S.slotDepth, 'dark', openingAt).geo, zOffset), key: 'dark' });
  // the low accessible front portal: an OPEN recess in the base course (a red-lined opening the visitor enters), not a
  // flat opaque door. The dark floor is set back inside; the red arch frame is added with the stage below.
  const portalFloor = boxGeo(0, 0.06, S.baseRadius * 0.55, S.portalHalfWidth * 2.1, 0.1, 1.4);
  parts.push({ geo: portalFloor, key: 'stageFloor' });

  // The continuous crown cap (round, part of the same silhouette, not a separate sphere): the fitted shell continues to
  // the top; close it with a small white cap ring so the crown reads rounded rather than open.
  const capGeo = bodyOfRevolution(radiusAt, crownBase, crownTop, 10, 40);
  parts.push({ geo: pitched(capGeo, zOffset), key: 'white' });

  // (2) the two large swept slatted wing panels tapering to the ground behind (both sides; the back photo shows two).
  // Each wing is a fan of overlapping white slat strips (fitted widths) with black feather slots between, sweeping out
  // and down — a slatted feathered panel, not a thin fin.
  for (const sx of [-1, 1]) {
    const rootY = S.shoulderY + 0.5;
    const rootX = sx * (radiusAt(rootY) - 0.1);
    const root = new THREE.Vector3(rootX, rootY, zOffset(rootY) - 0.6);
    const tip = new THREE.Vector3(sx * (S.wingSpan + 0.8), 0.4, zOffset(1.2) - 2.8);
    // the wing's plane: spanwise (out/back/down) and chordwise (front/back across the panel)
    const spanwise = new THREE.Vector3().subVectors(tip, root).normalize();
    const chord = new THREE.Vector3(sx * 0.35, 0, 1).normalize();     // across the wing's width
    const normal = new THREE.Vector3().crossVectors(spanwise, chord).normalize();
    const strips = 9;
    for (let k = 0; k < strips; k++) {
      const tt = (k + 0.5) / strips;                                   // out along the wing
      const base = root.clone().lerp(tip, tt);
      const width = 2.3 * (1 - 0.55 * tt);                            // the panel narrows to the tip
      const c = base.clone().addScaledVector(chord, (k % 2 ? 1 : -1) * width * 0.12);
      const u = spanwise.clone().multiplyScalar(.65 * (1 - 0.25 * tt));   // slat run along the wing
      const v = chord.clone().multiplyScalar(width * 0.5);             // the slat's own width
      const key = (k % 9 === 8) ? 'slot' : 'white';
      parts.push({ geo: slab(c, u, v, 0.07, normal), key });
    }
    // black feather-stripe slots banding the wing
    for (let f = 0; f < S.wingFeathers; f++) {
      const t = (f + 0.5) / S.wingFeathers;
      const p = root.clone().lerp(tip, t);
      const w = 2.3 * (1 - 0.55 * t);
      const stripe = slab(p, spanwise.clone().multiplyScalar(0.05), chord.clone().multiplyScalar(w * 1.05), 0.09, normal);
      parts.push({ geo: stripe, key: 'slot' });
    }
  }

  // (3) eye masks mounted on the continuous front upper body: radial white slats with a black ring and a mesh pupil
  for (const sx of [-1, 1]) {
    const cz = zOffset(S.eyeY) + radiusAt(S.eyeY) * 0.92 + S.eyeForward;
    const cx = sx * (S.eyeHalfWidth * 0.95), cy = S.eyeY;
    const diskR = S.eyeHalfHeight * 0.96;
    for (let i = 0; i < S.eyeSlats; i++) {
      const a = (i / S.eyeSlats) * Math.PI * 2;
      const w = (Math.PI * 2 * diskR) / S.eyeSlats * 0.62;
      const innerR = S.pupilRadius + .16;
      const bar = new THREE.BoxGeometry(w, diskR - innerR, 0.06);
      bar.translate(0, (diskR + innerR) * .5, 0);
      bar.rotateZ(a);
      bar.translate(cx, cy, cz);
      parts.push({ geo: bar.toNonIndexed(), key: 'white' });
    }
    const ring = new THREE.TorusGeometry(S.pupilRadius + 0.09, 0.07, 8, 18);
    ring.translate(cx, cy, cz + 0.02);
    parts.push({ geo: ring.toNonIndexed(), key: 'dark' });
    // a MESH pupil (dark, set behind a faint recess), not a flat solid black disk
    const pupil = new THREE.CylinderGeometry(S.pupilRadius, S.pupilRadius, 0.05, 14);
    pupil.rotateX(Math.PI / 2);
    pupil.translate(cx, cy, cz + 0.045);
    parts.push({ geo: pupil.toNonIndexed(), key: 'pupil' });
  }
  // (4) the sharp narrow black beak between the eyes
  parts.push({ geo: cone([0, S.eyeY - 0.16, zOffset(S.eyeY) + radiusAt(S.eyeY) * 0.92 + S.eyeForward + 0.05], [0, S.eyeY - 0.44, zOffset(S.eyeY) + radiusAt(S.eyeY) * 0.92 + S.eyeForward + S.beakLength], 0.17, 4), key: 'slot' });

  // (5) the red belly/stage OPENING at the lower front: a recessed red-lined arch opening (not a black flat door). The
  // red liner wraps the inside of the opening and an arch frames it; the floor inside is the dark stage floor set back.
  parts.push({ geo: boxGeo(0, 1.4, S.baseRadius * .62 + zOffset(1.4), 2.7, 1.8, .08), key: 'red' });
  const bellyR = S.stageRadius;
  const openingHalfW = Math.max(S.portalHalfWidth, S.stageRadius * 0.42);
  const openingH = S.stageTop - 0.2;
  // a red floor lip at the mouth of the opening
  parts.push({ geo: flatRing(0.35, openingHalfW, S.stageBase + 0.05, 30), key: 'red' });
  // the red recess liner: a half-tube arch lying on the ground across the front (open toward +Z)
  const liner = new THREE.CylinderGeometry(openingHalfW, openingHalfW, openingH, 24, 1, true, Math.PI, Math.PI);
  liner.rotateZ(Math.PI / 2);
  liner.scale(1, 1, 0.5);
  liner.translate(0, S.stageBase + openingH / 2, S.baseRadius * 0.72 + zOffset(1.0) - S.stageDepth * 0.5);
  parts.push({ geo: liner.toNonIndexed(), key: 'red' });
  // the arch cheeks closing the sides of the opening
  for (const sx of [-1, 1]) {
    const cheek = slab(new THREE.Vector3(sx * openingHalfW, S.stageBase + openingH * 0.45, S.baseRadius * 0.72 + zOffset(1.0) - S.stageDepth * 0.5),
      new THREE.Vector3(0, 0, S.stageDepth * 0.5), new THREE.Vector3(0, openingH * 0.45, 0), 0.08, new THREE.Vector3(sx, 0, 0));
    parts.push({ geo: cheek, key: 'red' });
  }
  // the dark stage floor inside the recess (set back, so the opening reads as depth, not a door)
  parts.push({ geo: boxGeo(0, S.stageBase + 0.02, S.baseRadius * 0.72 + zOffset(1.0) - S.stageDepth, openingHalfW * 1.9, 0.08, S.stageDepth * 2), key: 'stageFloor' });

  // (6) the curved timber nest tiers in front (real curved slabs, not a flat pancake fan)
  for (let t = 0; t < S.nestTiers; t++) {
    const rr = S.stageRadius + 0.35 + t * 0.5, y = 0.2 + t * 0.28;
    const arc = Math.PI * 0.9;
    const seg = 16;
    for (let i = 0; i < seg; i++) {
      const a0 = -arc / 2 + (arc * i) / seg, a1 = -arc / 2 + (arc * (i + 1)) / seg;
      const c = new THREE.Vector3(Math.sin((a0 + a1) / 2) * rr, y, Math.cos((a0 + a1) / 2) * rr + S.baseRadius * 0.4 + zOffset(1.0));
      const u = new THREE.Vector3(Math.cos((a0 + a1) / 2), 0, -Math.sin((a0 + a1) / 2)).multiplyScalar(0.24);
      const v = new THREE.Vector3(0, 0.12, 0);
      parts.push({ geo: slab(c, u, v, 0.3, new THREE.Vector3(0, 1, 0)), key: 'timber' });
    }
  }
  // the distinct cream stool
  parts.push({ geo: new THREE.CylinderGeometry(0.5, 0.68, 1.0, 18).translate(0, 0.5, S.baseRadius * 1.5).toNonIndexed(), key: 'cream' });
  parts.push({ geo: new THREE.CylinderGeometry(0.7, 0.7, 0.12, 18).translate(0, 1.06, S.baseRadius * 1.5).toNonIndexed(), key: 'cream' });

  // (7) the base deck floor (walkable once movement is integrated)
  const deck = flatRing(0.5, S.baseRadius * 0.82, S.bandHeight || 0.35, 48);
  parts.push({ geo: deck, key: 'dark' });

  // ---- assemble
  const merged = mergeByKey(parts);
  const mats = materials('owl');
  let triangles = 0;
  const drawCalls = [];
  for (const [key, geo] of merged) {
    const mesh = new THREE.Mesh(geo, mats[key] || mats.white);
    mesh.name = `BiidaasigeSnowyOwlTheatre-${key}`;
    mesh.castShadow = key !== 'red' && key !== 'pastel' && key !== 'pastelPink';
    mesh.receiveShadow = true;
    g.add(mesh);
    triangles += geo.attributes.position.count / 3;
    drawCalls.push({ key, triangles: geo.attributes.position.count / 3 });
  }

  const baseHalf = S.baseRadius + 0.5;
  // Thin perimeter wall segments keep the visible front portal and interior accessible.
  for(let i=0;i<24;i++){
    const a=(i+.5)*Math.PI*2/24;
    if(Math.abs(Math.atan2(Math.sin(a),Math.cos(a)))<.50)continue;
    const r=S.baseRadius-.12,cx=Math.sin(a)*r,cz=Math.cos(a)*r+zOffset(.8),yaw=a+Math.PI/2;
    const hx=.12,hz=Math.PI*r/24,cs=Math.cos(yaw),sn=Math.sin(yaw);
    const ex=Math.abs(cs)*hx+Math.abs(sn)*hz,ez=Math.abs(sn)*hx+Math.abs(cs)*hz;
    colliders.push({minX:cx-ex,maxX:cx+ex,minZ:cz-ez,maxZ:cz+ez,minY:0,maxY:S.shoulderY,
      obb:{cx,cz,hx,hz,cs,sn},prop:true,kind:'owl-theatre-wall'});
  }
  colliders.push({ minX: -S.crownRadius - 0.3, maxX: S.crownRadius + 0.3, minY: crownBase, maxY: crownTop, minZ: zOffset(crownBase) - S.crownRadius, maxZ: zOffset(crownTop) + S.crownRadius, prop: true, kind: 'owl-crown' });

  collectFacingTriangles(deck, new THREE.Vector3(0, 1, 0), surfaces, 'owl-deck');

  const result = {
    group: g, colliders, surfaces, climbable: false, triangles, drawCalls, estimates,
    source: 'Monstrum — Snowy Owl Play Theatre (https://monstrum.dk/en/playground/snowy-owl-play-theatre)',
    attribution: 'Structure by Monstrum; procedural reconstruction for Slop Toronto.',
  };
  if (opts.scene && opts.scene.add) opts.scene.add(g);
  return result;
}

// -------------------------------------------------------------------------------------------------------------------
// Reaching Raccoon
// -------------------------------------------------------------------------------------------------------------------
function buildReachingRaccoon(opts = {}) {
  const S = { ...RACCOON_SPEC, ...(opts.spec || {}) };
  const g = new THREE.Group();
  g.name = 'BiidaasigeReachingRaccoon';
  const parts = [];
  const colliders = [];
  const surfaces = [];
  const estimates = { ...S };

  const torsoBase = S.legHeight, torsoTop = S.bodyHeight - 0.7;
  const profile = (y) => S.torsoRadius0 + (S.torsoRadius1 - S.torsoRadius0) * clamp((y - torsoBase) / (torsoTop - torsoBase), 0, 1);
  const zOff = (y) => S.torsoLean * Math.max(0, y - torsoBase);

  // (1) legs & feet — timber
  for (const sx of [-1, 1]) {
    parts.push({ geo: rod(new THREE.Vector3(sx * 0.42, 0, 0.05), new THREE.Vector3(sx * 0.42, S.legHeight, 0.05), 0.2, 10), key: 'timberDark' });
    parts.push({ geo: boxGeo(sx * 0.42, 0.1, 0.28, 0.34, 0.2, 0.6), key: 'timber' });
  }
  // (2) the broad FACETED timber torso: alternating cream / reddish-red timber boards that tile the torso as a closed
  // faceted VOLUME (each board steps in/out slightly, so the body reads as faceted timber, not bare posts or a box)
  {
    const { boardCount, openGapFrac, facetDepth } = S;
    const h = torsoTop - torsoBase, yMid = (torsoBase + torsoTop) / 2;
    const rBase = profile(torsoBase), rMid = profile(yMid), rTop = profile(torsoTop);
    for (let i = 0; i < boardCount; i++) {
      const a = (i / boardCount) * Math.PI * 2;
      const pitchAtBase = (2 * Math.PI * rBase) / boardCount;
      const pitchAtTop = (2 * Math.PI * rTop) / boardCount;
      const bw = ((pitchAtBase + pitchAtTop) / 2) * (1 - openGapFrac);
      const proud = (i % 2) ? facetDepth : 0;               // alternating facets step proud
      const key = (i % 2) ? 'timberCream' : (i % 3 === 0 ? 'timberRed' : 'timber');
      // a trapezoid board spanning base→top radius, wrapped on the torso and stepped proud by `proud`
      const g = boardFrustumBoard(a, (2 * Math.PI) / boardCount, bw, rBase, rMid, rTop, torsoBase, h, proud, zOff);
      parts.push({ geo: g, key });
    }
    // a slim dark inner core so any seam reads as shadow, not a hollow see-through
    { const core = bodyOfRevolution(profile, torsoBase, torsoTop, 8, 24); core.translate(0, 0, zOff(yMid)); parts.push({ geo: core, key: 'darkMask' }); }
  }

  // (3) two wide curved wooden striped arms gripping the cattail posts
  const shoulder = { x: 0, y: torsoTop - 0.2, z: zOff(torsoTop - 0.2) };
  for (const sx of [-1, 1]) {
    const from = new THREE.Vector3(sx * (S.torsoRadius1 * 0.7), shoulder.y, shoulder.z + 0.15);
    const grip = new THREE.Vector3(sx * 0.55, shoulder.y + 0.9, shoulder.z + 1.1);
    const mid = from.clone().lerp(grip, 0.5).add(new THREE.Vector3(sx * 0.4, 0.2, 0.25));
    const curve = new THREE.CatmullRomCurve3([from, mid, grip]);
    parts.push({ geo: new THREE.TubeGeometry(curve, 10, 0.16, 8, false).toNonIndexed(), key: 'timber' });
    // dark stripes on the arm
    for (let s = 0; s < 3; s++) {
      const p = curve.getPoint(0.3 + s * 0.22);
      const ring = new THREE.TorusGeometry(0.17, 0.05, 5, 10);
      ring.translate(p.x, p.y, p.z);
      parts.push({ geo: ring.toNonIndexed(), key: 'timberDark' });
    }
  }
  // (4) the broad triangular white/black face mask on a HEAD seated on the torso top (a timber head volume + mask)
  const headY = S.bodyHeight - 0.45, headZ = zOff(torsoTop);
  // the timber head volume, sitting ON the torso (a neck joins it, so it is not a detached floating head)
  const headR = S.faceWidth * 0.62;
  parts.push({ geo: rod(new THREE.Vector3(0, torsoTop - 0.3, headZ), new THREE.Vector3(0, headY - headR * 0.4, headZ), headR * 0.7, 10), key: 'timber' });
  parts.push({ geo: boxGeo(0,headY,headZ+.15,S.faceWidth*.88,S.faceHeight*.72,.55),key:'timberCream' });
  // a broad triangular mask: a tapered wedge (wide at the brow, narrowing to the muzzle) on the head's front
  parts.push({ geo: faceWedge(headY + 0.18, headZ + headR + .18, S.faceWidth, S.faceHeight * 0.85), key: 'pale' });
  // the black eye band across the mask
  parts.push({ geo: boxGeo(0, headY + 0.28, headZ + headR + .28, S.faceWidth * 0.94, 0.26, 0.14), key: 'darkMask' });
  // the muzzle tip
  parts.push({ geo: cone([0, headY + 0.02, headZ + headR + .35], [0, headY - 0.14, headZ + headR + .35 + 0.5], 0.2, 6), key: 'pale' });
  for (const sx of [-1, 1]) {
    parts.push({ geo: cone([sx * S.faceWidth * 0.42, headY + 0.5, headZ + headR * 0.5], [sx * S.faceWidth * 0.55, headY + 0.5 + S.earHeight, headZ + headR * 0.5], 0.18, 4), key: 'timberDark' });
  }
  // (5) the hollow striped tail den (a curved tube sweeping back, open at the tip)
  {
    const pts = [];
    for (let i = 0; i <= S.tailRings; i++) {
      const t = i / S.tailRings;
      pts.push(new THREE.Vector3(0, S.legHeight + 0.4 + Math.sin(t * 1.3) * 1.0 * t, -0.6 - S.tailSweep * t));
    }
    const curve = new THREE.CatmullRomCurve3(pts.reverse());
    const tail = new THREE.TubeGeometry(curve, 26, S.tailRadius0, 14, false);
    parts.push({ geo: tail.toNonIndexed(), key: 'timber' });
    for (let i = 1; i < S.tailRings; i++) {
      const t = i / S.tailRings;
      const p = curve.getPoint(t), rr = S.tailRadius0 * (1 - 0.6 * t) + 0.02;
      const ring = new THREE.TorusGeometry(rr, 0.09, 6, 14);
      ring.translate(p.x, p.y, p.z);
      parts.push({ geo: ring.toNonIndexed(), key: 'timberDark' });
    }
  }
  // (6) the huge lime-green leaf over the green cattail posts, brown capsules, dragonfly accents
  const postX = [0.75, 1.25];
  for (let i = 0; i < postX.length; i++) {
    const px = postX[i];
    parts.push({ geo: rod(new THREE.Vector3(px, 0, shoulder.z + 0.9), new THREE.Vector3(px, S.cattailHeight, shoulder.z + 0.9), 0.08, 8), key: 'greenPost' });
    parts.push({ geo: new THREE.CylinderGeometry(0.16, 0.16, S.cactusHeadLength, 10).translate(px, S.cattailHeight - S.cactusHeadLength * 0.5, shoulder.z + 0.9).toNonIndexed(), key: 'cattail' });
  }
  // the huge LEAF: a pointed organic almond leaf standing above the posts (a lens outline, not a rectangle), with vein
  // ribs. Built as a strip fan from the stalk tip: the width follows sin(), so it is broadest mid-leaf and points at the tip.
  {
    const baseX = (postX[0] + postX[1]) / 2;
    const baseY = S.cattailHeight - 0.1, baseZ = shoulder.z + 0.9;
    const tipY = baseY + S.leafHeight;
    const steps = 14, halfW = S.leafWidth / 2;
    const back = new THREE.Vector3(0, 0.18, 1).normalize();      // the leaf leans slightly back from vertical
    const sideAxis = new THREE.Vector3(1, 0, 0);
    const leafPt = (t, s) => {
      // t: 0 at the base → 1 at the tip; s: -1..1 across; width = sin(pi t) (0 at base & tip, max mid)
      const w = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * halfW;
      return new THREE.Vector3(
        baseX + sideAxis.x * s * w + back.x * t * S.leafHeight * 0.25,
        baseY + (tipY - baseY) * t + back.y * t * S.leafHeight * 0.1,
        baseZ + back.z * t * S.leafHeight * 0.18
      );
    };
    // the leaf blade: quads from s=-1..1 across, t along, with a slight fold along the midrib
    const pos = [], nor = [], uv = [];
    const N = new THREE.Vector3(0, 0.25, 1).normalize();
    const fold = (p, s) => p.clone().addScaledVector(new THREE.Vector3(0, 0, 0), 0).add(new THREE.Vector3(0, -Math.abs(s) * 0.08 * (1 - Math.abs(s)), 0));
    for (let a = 0; a < steps; a++) {
      const t0 = a / steps, t1 = (a + 1) / steps;
      for (let b = 0; b < 6; b++) {
        const s0 = -1 + (2 * b) / 6, s1 = -1 + (2 * (b + 1)) / 6;
        const A = fold(leafPt(t0, s0), s0), B = fold(leafPt(t0, s1), s1), C = fold(leafPt(t1, s1), s1), D = fold(leafPt(t1, s0), s0);
        for (const q of [A, B, C, A, C, D]) { pos.push(q.x, q.y, q.z); nor.push(N.x, N.y, N.z); }
        uv.push(b / 6, t0, (b + 1) / 6, t0, (b + 1) / 6, t1, b / 6, t0, (b + 1) / 6, t1, b / 6, t1);
      }
    }
    parts.push({ geo: buffer(pos, nor, uv), key: 'leaf' });
    // the midrib + vein ribs (darker green), from the base toward the edges
    parts.push({ geo: rod(leafPt(0, 0), leafPt(0.97, 0), 0.05, 6), key: 'leafVein' });
    for (let vI = 0; vI < S.leafVeins; vI++) {
      const t = 0.15 + 0.75 * (vI / (S.leafVeins - 1));
      const dir = (vI % 2 === 0) ? 1 : -1;
      parts.push({ geo: rod(leafPt(t, 0), leafPt(Math.min(0.98, t + 0.18), dir * 0.85), 0.028, 5), key: 'leafVein' });
    }
  }
  // dragonfly accents (flat blue/white) hovering around the leaf
  for (let d = 0; d < S.dragonflies; d++) {
    const px = 0.2 + d * 0.55, py = S.cattailHeight - 0.3 + (d % 2) * 0.4, pz = shoulder.z + 1.3 + (d % 3) * 0.3;
    parts.push({ geo: boxGeo(px, py, pz, 0.1, 0.04, 0.3), key: 'dragonfly' });
    parts.push({ geo: slab(new THREE.Vector3(px, py + 0.02, pz), new THREE.Vector3(0.14, 0, 0), new THREE.Vector3(0, 0, 0.12), 0.02, new THREE.Vector3(0, 1, 0)), key: 'dragonflyWing' });
  }
  // (7) the log jam + net pegs around the base
  for (let i = 0; i < S.logCount; i++) {
    const z = 1.7 + i * 0.4, y = 0.2 + (i % 2) * 0.3;
    const log = new THREE.CylinderGeometry(0.16, 0.16, 1.8, 8);
    log.rotateZ(Math.PI / 2);
    log.translate(-1.6 - i * 0.1, y, z);
    parts.push({ geo: log.toNonIndexed(), key: 'log' });
  }
  for (let i = 0; i < S.ropeCount; i++) {
    const sx = i % 2 ? 1 : -1;
    parts.push({ geo: rod(new THREE.Vector3(sx * (1.0 + i * 0.15), 1.4 + i * 0.2, 1.4 + i * 0.3), new THREE.Vector3(sx * (1.1 + i * 0.2), 0.2, 2.2 + i * 0.3), 0.035, 5), key: 'rope' });
  }
  // stepper stairs
  for (let i = 0; i < S.stepperCount; i++) {
    parts.push({ geo: boxGeo(-1.2, 0.16 * (i + 1), 1.0 + i * 0.4, 1.2, 0.16, 0.4), key: 'timber' });
  }
  // (8) the OPEN U-shaped polished metal chute (a half-pipe, not a sealed cylinder); NOT walkable, no ground guess
  {
    const top = new THREE.Vector3(1.4, S.slideTopY, shoulder.z + 0.9);
    const bottom = new THREE.Vector3(-0.8, 0.4, shoulder.z + 0.9 + S.slideLength);
    const dir = new THREE.Vector3().subVectors(bottom, top);
    const chute = new THREE.CylinderGeometry(S.slideWidth / 2, S.slideWidth / 2, dir.length(), 16, 1, true, 0, Math.PI);
    chute.translate(0, dir.length() / 2, 0);
    chute.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
    chute.translate(top.x, top.y, top.z);
    parts.push({ geo: chute.toNonIndexed(), key: 'metal' });
    // side rails of the open chute
    parts.push({ geo: rod(top.clone().add(new THREE.Vector3(S.slideWidth / 2, 0.1, 0)), bottom.clone().add(new THREE.Vector3(S.slideWidth / 2, 0.1, 0)), 0.05, 6), key: 'metal' });
    parts.push({ geo: rod(top.clone().add(new THREE.Vector3(-S.slideWidth / 2, 0.1, 0)), bottom.clone().add(new THREE.Vector3(-S.slideWidth / 2, 0.1, 0)), 0.05, 6), key: 'metal' });
    // the entry deck at the top
    parts.push({ geo: boxGeo(top.x, top.y - 0.1, top.z, 1.0, 0.12, 0.8), key: 'timber' });
  }

  const merged = mergeByKey(parts);
  const mats = materials('raccoon');
  let triangles = 0;
  const drawCalls = [];
  for (const [key, geo] of merged) {
    const mesh = new THREE.Mesh(geo, mats[key] || mats.timber);
    mesh.name = `BiidaasigeReachingRaccoon-${key}`;
    mesh.castShadow = key !== 'leaf' && key !== 'dragonflyWing';
    mesh.receiveShadow = true;
    g.add(mesh);
    triangles += geo.attributes.position.count / 3;
    drawCalls.push({ key, triangles: geo.attributes.position.count / 3 });
  }

  colliders.push({ minX: -1.0, maxX: 1.0, minY: 0, maxY: torsoTop + 0.4, minZ: -1.5, maxZ: zOff(torsoTop) + S.torsoRadius0 + 0.9, prop: true, kind: 'raccoon-body' });
  colliders.push({ minX: -S.faceWidth, maxX: S.faceWidth, minY: headY - 0.4, maxY: headY + 0.62 + S.earHeight, minZ: headZ - 0.4, maxZ: headZ + 1.0, prop: true, kind: 'raccoon-head' });
  colliders.push({ minX: 0.4, maxX: 1.6, minY: 0, maxY: S.cattailHeight, minZ: shoulder.z + 0.6, maxZ: shoulder.z + 1.2, prop: true, kind: 'raccoon-cattail' });

  const result = {
    group: g, colliders, surfaces, climbable: false, triangles, drawCalls, estimates,
    source: 'Earthscape — Biidaasige Park Raccoon Playground (https://www.earthscapeplay.com/fr/projects/biidaasige-park-raccoon-playground/)',
    attribution: 'Structure by Earthscape; procedural reconstruction for Slop Toronto.',
  };
  if (opts.scene && opts.scene.add) opts.scene.add(g);
  return result;
}

// -------------------------------------------------------------------------------------------------------------------
// Assembly + utilities
// -------------------------------------------------------------------------------------------------------------------
function buildBiidaasigePlayLandmarks(scene = null) {
  const owl = buildOwlPlayTheatre();
  const raccoon = buildReachingRaccoon();
  const group = new THREE.Group();
  group.name = 'BiidaasigePlayLandmarks';
  group.add(owl.group, raccoon.group);
  const result = {
    group, colliders: [...owl.colliders, ...raccoon.colliders], owl, raccoon,
    triangles: owl.triangles + raccoon.triangles, climbable: false,
    source: { owl: owl.source, raccoon: raccoon.source },
  };
  if (scene && scene.add) scene.add(group);
  return result;
}

// Apply the owl's forward pitch to an already-built (upright, Y-up) geometry: shear z by the zOffset profile.
function pitched(geo, zOffset) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + zOffset(p.getY(i)));
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
// Keep only the front (+Z) half of a body-of-revolution geometry (the belly/stage's visible front).
function clipFrontHalf(geo) {
  const p = geo.attributes.position;
  const keep = new Uint8Array(p.count);
  for (let i = 0; i < p.count; i++) keep[i] = p.getZ(i) >= -0.2 ? 1 : 0;
  const pos = [], nor = [], uv = [];
  const n = geo.attributes.normal, u = geo.attributes.uv;
  for (let t = 0; t + 2 < p.count; t += 3) {
    if (!(keep[t] && keep[t + 1] && keep[t + 2])) continue;
    for (let k = 0; k < 3; k++) {
      const j = t + k;
      pos.push(p.getX(j), p.getY(j), p.getZ(j));
      if (n) nor.push(n.getX(j), n.getY(j), n.getZ(j));
      if (u) uv.push(u.getX(j), u.getY(j));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (nor.length === pos.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (uv.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (!nor.length) out.computeVertexNormals();
  return out;
}
// The raccoon's broad triangular face wedge (a tapered slab).
function faceWedge(cy, cz, w, h) {
  const pos = [], nor = [], uv = [];
  const push = (a, b, c, n) => { for (const q of [a, b, c]) { pos.push(...q); nor.push(...n); uv.push(0, 0); } };
  const N = [0, 0.2, 1];
  const left = [-w / 2, cy + h / 2, cz], right = [w / 2, cy + h / 2, cz];
  const tipL = [-w / 4, cy - h / 2, cz + 0.3], tipR = [w / 4, cy - h / 2, cz + 0.3];
  push(left, tipR, right, N); push(left, tipL, tipR, N);
  return buffer(pos, nor, uv);
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smooth(t) { return t * t * (3 - 2 * t); }
function hash(i, s) {
  let h = (i * 374761393 + s * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function collectFacingTriangles(geo, dir, out, kind, dotMin = 0.75) {
  if (!geo) return;
  const p = geo.attributes.position, n = geo.attributes.normal;
  if (!p) return;
  for (let t = 0; t + 2 < p.count; t += 3) {
    const ux = p.getX(t + 1) - p.getX(t), uy = p.getY(t + 1) - p.getY(t), uz = p.getZ(t + 1) - p.getZ(t);
    const vx = p.getX(t + 2) - p.getX(t), vy = p.getY(t + 2) - p.getY(t), vz = p.getZ(t + 2) - p.getZ(t);
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (Math.hypot(cx, cy, cz) < 1e-7) continue;
    let nx = 0, ny = 0, nz = 0;
    if (n) { for (const k of [0, 1, 2]) { nx += n.getX(t + k); ny += n.getY(t + k); nz += n.getZ(t + k); } }
    const len = Math.hypot(nx, ny, nz) || 1;
    if ((nx * dir.x + ny * dir.y + nz * dir.z) / len < dotMin) continue;
    out.push({ kind, triangle: [p.getX(t), p.getY(t), p.getZ(t), p.getX(t + 1), p.getY(t + 1), p.getZ(t + 1), p.getX(t + 2), p.getY(t + 2), p.getZ(t + 2)] });
  }
}
function surfaceArea(tris) {
  let a = 0;
  for (const { triangle: T } of tris) {
    const ux = T[3] - T[0], uy = T[4] - T[1], uz = T[5] - T[2];
    const vx = T[6] - T[0], vy = T[7] - T[1], vz = T[8] - T[2];
    a += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return a;
}
// Measure the owl's WHITE COVERAGE from real geometry: the vertical (upward-facing) white board surface area divided by
// the whole board-bearing shell's vertical surface area (white + slot + pastel + backing is not counted). This proves
// the body reads white rather than as a black barrel.
function owlWhiteCoverage(owlResult) {
  let white = 0, total = 0;
  for (const d of owlResult.drawCalls) {
    if (d.key === 'white' || d.key === 'slot' || d.key === 'pastel' || d.key === 'pastelPink') total += d.triangles;
    if (d.key === 'white') white += d.triangles;
  }
  return total > 0 ? white / total : 0;
}

Object.assign(C, {
  BIIDAASIGE_OWL_SPEC: OWL_SPEC,
  BIIDAASIGE_RACCOON_SPEC: RACCOON_SPEC,
  buildOwlPlayTheatre,
  buildReachingRaccoon,
  buildBiidaasigePlayLandmarks,
  biidaasigePlaySurfaceArea: surfaceArea,
  biidaasigeOwlWhiteCoverage: owlWhiteCoverage,
});
})();
