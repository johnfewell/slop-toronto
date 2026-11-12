(function () {
// js/biidaasige-dodem.js
// The seven Dodem clan-animal sculptures at Biidaasige Park (Port Lands / Ookwemin Minising).
//
// Scope (bead st-bmyv.4, independent of the adventure-play module):
//   C.buildBiidaasigeDodemAnimal(kind) -> { group, triangles, colliders, surfaces, dimensions,
//                                            appearanceConfidence, verifiedAppearance, sourceEvidence, ... }
//
// The City of Toronto Recreation page lists the seven Dodem animals (bear, beaver, eagle, turtle, otter, wolf,
// musky fish). It does NOT publish individual positions, so every model here is an UNPLACED local-origin factory:
// origin at the ground contact, +Y up, 1 unit = 1 metre, the animal faces +Z. Nothing is added to a scene unless the
// caller passes one, and no absolute coordinate is invented.
//
// Maker / material (verified 2026):
//   The City 2026 Port Lands open-house boards (p.5) credit the sculptures to
//   "APE Richter/Christian Huba in consultation with MCFN and MinoKamik Collective".
//   The maker's own catalogue states they are carved from mountain larch (Lärche) trunks, NOT oak.
//
// Appearance honesty (captain personally viewed the workshop Toronto photos and the City 2026 installed crop):
//   - eagle: the ONLY animal with a City primary photo and an installed crop. `verifiedAppearance: true`.
//   - bear, turtle, wolf: workshop-reference only (workshop photos / maker interview). Distinct from installed
//     as-built; `appearanceConfidence: 'workshop-reference'`.
//   - otter, beaver: maker programme sketches corroborate morphology plus a partial installed City crop whose
//     identities are not independently captioned; `appearanceConfidence: 'programme-and-partial-installed'`.
//   - musky: no individual photo; `appearanceConfidence: 'approximate-no-individual-photo'`.
//   None of the six non-eagle animals may be reported as a verified as-built reconstruction.
//
// Geometry: no 99-sphere anatomy. Each animal is a lathed/lofted contoured body (real rings of quads) with species
// features as trimesh or prism parts. Parts are merged per material, bounded to fewer than 8 meshes per animal. Flat
// shading from the merged geometry reads as carved wood. Quiet, gentle expressions; no Indigenous graphics or symbols
// are invented. No copyrighted pixels are shipped.

const C = (typeof window !== 'undefined' && (window.CITY || (window.CITY = {}))) || {};
const THREE = C.THREE;

const DODEM_ANIMALS = ['bear', 'beaver', 'eagle', 'turtle', 'otter', 'wolf', 'musky'];

const DODEM_ATTRIBUTION = 'APE Richter/Christian Huba in consultation with MCFN and MinoKamik Collective';
const DODEM_ATTRIBUTION_SOURCE = 'City of Toronto 2026 Port Lands open-house boards, page 5';
const DODEM_MATERIAL = 'mountain larch (Lärche) trunks, not oak';

// -------------------------------------------------------------------------------------------------------------------
// Appearance / source-evidence ledger. Dimensions are PHOTO / WORKSHOP ESTIMATES, never surveys.
// -------------------------------------------------------------------------------------------------------------------
const DODEM_SPECS = {
  bear: {
    appearance: 'upright seated massive broad brown larch bear: forepaws resting against the belly, big rounded block muzzle, round ears; broad connected black eye mask, black inner ears, very large faceted blunt black nose, natural larch rings around the pupils, black lower-claw accents; not on all fours',
    verified: false,
    confidence: 'workshop-reference',
    evidence: 'Workshop photo "Christian Huba bei der Arbeit am Bär" (© Huba), the City 2026 crop background-left upright bear, and the public RFO Toronto workshop video at 00:15 and 11:45 (captain-viewed): broad connected black eye mask, black inner ears, very large faceted blunt black nose, natural larch rings around the pupils, forepaws against the belly with black lower-claw accents. Workshop-reference only; not an installed as-built match. Height ~2.4 m is a workshop estimate, not a survey.',
  },
  beaver: {
    appearance: 'crouched upright rounded larch beaver on a small blue/green painted metal rocker/spring base: raised blunt head with two incisors, small forepaws at the chest, broad flat tail on the ground',
    verified: false,
    confidence: 'programme-and-partial-installed',
    evidence: 'Richter programme beaver sketch corroborates the crouched upright morphology; the City 2026 installed crop shows a round beaver-like form on the right on a visible blue/green painted metal rocker/spring base, but the identity is not independently captioned. Programme + partial installed; not as-built confirmed. The steel base is a ~0.15 m estimate, not a survey.',
  },
  eagle: {
    appearance: 'squat broad carved larch eagle: folded scalloped brown wings, natural brown body, white head with a jagged feather edge, black chest, broad yellow hooked beak, three white tail feather tips, yellow talons around a log perch',
    verified: true,
    confidence: 'primary-photo',
    evidence: 'City of Toronto primary photo (captain/dodem-eagle.jpg) and the City 2026 installed crop, personally viewed by the captain: squat broad folded scalloped wings, natural brown body, white head with jagged feather edge, black chest, broad yellow hooked beak, three white tail feather tips, yellow talons around a log perch.',
  },
  turtle: {
    appearance: 'huge low almost-flat natural larch turtle: broad low segmented shell (~0.45 m rise) of contiguous same-wood panels with thin green recessed seams, red band/underside, four very broad paddle flippers (front pair spanning almost the whole front side) with three turquoise claw triangles across each outer edge, and a huge wide oval head (~0.75 m wide, ~0.8 m long) with a broad curved black smiling lower face and large circle-outline eyes on the topsides',
    verified: false,
    confidence: 'workshop-reference',
    evidence: 'Workshop photo "Die Schildkröte" (© Huba) and the maker interview (five parts, ~1 tonne), captain-viewed: a broad low almost-flat segmented shell (~0.45 m rise) of contiguous same-wood panels with thin green recessed seams, a red band/underside, four very broad paddle flippers with three turquoise claw triangles across each outer edge, and a huge wide oval head (~0.75 m wide, ~0.8 m long) with a broad curved black smiling lower face and large circle-outline eyes on the topsides. Workshop-reference only; not an installed as-built match. Approx 3.2 m long, 2.4 m wide, 0.6 m tall is a workshop estimate, not a survey.',
  },
  otter: {
    appearance: 'long low arched larch otter on a small blue/green painted metal rocker/spring base: head raised on a slim neck, long tapered tail, round eyes and small rounded ears',
    verified: false,
    confidence: 'programme-and-partial-installed',
    evidence: 'Richter programme otter sketch corroborates the long low arched morphology; the City 2026 installed crop shows a long low otter-like form on the left on a visible blue/green painted metal rocker/spring base, but the identity is not independently captioned. Programme + partial installed; not as-built confirmed. The steel base is a ~0.15 m estimate, not a survey.',
  },
  wolf: {
    appearance: 'solid carved standing all-fours larch mother wolf with two complete cubs under the belly: broad continuous trunk back, short forward head with clear pointed ears and black eyes and nose, tapered broad wood legs; unfinished natural pale larch, no invented final paint',
    verified: false,
    confidence: 'workshop-reference',
    evidence: 'Workshop photo captioned "Eine Wölfin mit ihren Jungen" (a mother wolf with her cubs, © Blum), captain-viewed: a solid carved standing all-fours mother with a broad trunk back, a short forward head, clear pointed ears and black eyes/nose, and two complete cubs (four legs, head and ears each) under the belly with feet on the ground. Workshop-reference only; not an installed as-built match. The earlier seated-wolf reading of the owl photo was wrong.',
  },
  musky: {
    appearance: 'very long low flattened warm-brown larch musky (muskellunge): a moulded solid oval with a broad rounded head and short muzzle at +Z, two black/teal ringed eyes on the top near the front, and a tapering rounded tail at -Z; no large dorsal fin, no forked tail, no pedestal',
    verified: false,
    confidence: 'partial-installed-photo',
    evidence: 'Captain-viewed primary MVVA 4800x3600 finished-playground photo (private mvva-badlands-cableway.jpg; crop captain/dodem-west-three.png): a very long low flattened natural brown larch oval with a broad rounded head, two black/teal ringed eyes on the top near the front, and a tapering rounded tail; a moulded solid form with no large dorsal fin, forked tail or pedestal visible from overhead. Partial installed photo only; not a verified as-built match. Width ~0.65 m, length ~2 m, top height ~0.45 m is a photo estimate, not a survey.',
  },
};

// -------------------------------------------------------------------------------------------------------------------
// Materials — carved natural larch with the eagle's painted accents and the turtle's painted markings.
// High roughness, zero metalness.
// -------------------------------------------------------------------------------------------------------------------
function dodemMaterials() {
  const M = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return {
    wood: new M({ color: 0xb08a5a, roughness: 0.93, metalness: 0.0 }),
    woodDark: new M({ color: 0x6b4a2e, roughness: 0.95, metalness: 0.0 }),
    woodLight: new M({ color: 0xd8bd94, roughness: 0.9, metalness: 0.0 }),
    black: new M({ color: 0x1c1a18, roughness: 0.86, metalness: 0.0 }),
    white: new M({ color: 0xe8e2d4, roughness: 0.88, metalness: 0.0 }),
    yellow: new M({ color: 0xd9a520, roughness: 0.8, metalness: 0.0 }),
    green: new M({ color: 0x4f7a3a, roughness: 0.9, metalness: 0.0 }),
    red: new M({ color: 0xa8322a, roughness: 0.9, metalness: 0.0 }),
    turquoise: new M({ color: 0x3fb6a8, roughness: 0.85, metalness: 0.0 }),
    muskyWood: new M({ color: 0x8a5a34, roughness: 0.92, metalness: 0.0 }),
    steel: new M({ color: 0x3f6f7a, roughness: 0.45, metalness: 0.7 }),
  };
}

// -------------------------------------------------------------------------------------------------------------------
// Geometry helpers. Real rings of quads and prism parts; no sphere primitives for anatomy.
// -------------------------------------------------------------------------------------------------------------------
function pushTri(pos, a, b, c) {
  pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

function bufferGeo(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A vertical lofted body: ordered bottom-to-top rings of elliptical cross-sections, capped ends.
function loftY(rings, seg = 14) {
  const pos = [];
  const pts = rings.map((r) => {
    const out = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      out.push([(r.cx || 0) + Math.sin(a) * r.rx, r.y, (r.cz || 0) + Math.cos(a) * r.rz]);
    }
    return out;
  });
  for (let s = 0; s + 1 < rings.length; s++) {
    const A = pts[s], B = pts[s + 1];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      pushTri(pos, A[i], A[j], B[j]);
      pushTri(pos, A[i], B[j], B[i]);
    }
  }
  const first = rings[0], last = rings[rings.length - 1];
  if (first.rx > 1e-6 && first.rz > 1e-6) {
    const c = [first.cx || 0, first.y, first.cz || 0];
    for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; pushTri(pos, c, pts[0][j], pts[0][i]); }
  }
  if (last.rx > 1e-6 && last.rz > 1e-6) {
    const c = [last.cx || 0, last.y, last.cz || 0], L = pts[pts.length - 1];
    for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; pushTri(pos, c, L[i], L[j]); }
  }
  return bufferGeo(pos);
}

// A horizontal (front-to-back) lofted body along +Z: ordered rings, capped ends. Head is at +Z.
function loftZ(rings, seg = 14) {
  const pos = [];
  const pts = rings.map((r) => {
    const out = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      out.push([(r.cx || 0) + Math.sin(a) * r.rx, (r.cy || 0) + Math.cos(a) * r.ry, r.z]);
    }
    return out;
  });
  for (let s = 0; s + 1 < rings.length; s++) {
    const A = pts[s], B = pts[s + 1];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      pushTri(pos, A[i], B[i], B[j]);
      pushTri(pos, A[i], B[j], A[j]);
    }
  }
  const first = rings[0], last = rings[rings.length - 1];
  if (first.rx > 1e-6 && first.ry > 1e-6) {
    const c = [first.cx || 0, first.cy || 0, first.z];
    for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; pushTri(pos, c, pts[0][i], pts[0][j]); }
  }
  if (last.rx > 1e-6 && last.ry > 1e-6) {
    const c = [last.cx || 0, last.cy || 0, last.z], L = pts[pts.length - 1];
    for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; pushTri(pos, c, L[j], L[i]); }
  }
  return bufferGeo(pos);
}

function rod(a, b, r0, r1, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = new THREE.Vector3().subVectors(B, A), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, Math.max(1e-3, len), seg, 1, false);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate(A.x, A.y, A.z);
  return g.toNonIndexed();
}

function coneAt(base, apex, r, seg = 6) {
  const A = new THREE.Vector3(...base), B = new THREE.Vector3(...apex);
  const d = new THREE.Vector3().subVectors(B, A), len = d.length();
  const g = new THREE.ConeGeometry(r, Math.max(1e-3, len), seg, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate(A.x, A.y, A.z);
  return g.toNonIndexed();
}

function boxAt(cx, cy, cz, sx, sy, sz) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  return g.toNonIndexed();
}

// A short thick disc (round ear / eye) facing `normal`.
function discAt(cx, cy, cz, r, thickness, normal) {
  const n = new THREE.Vector3(...normal).normalize();
  const g = new THREE.CylinderGeometry(r, r, thickness, 12, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n));
  g.translate(cx, cy, cz);
  return g.toNonIndexed();
}

// A thin ring (round outlined eye) facing `normal`.
function torusAt(cx, cy, cz, r, tube, normal) {
  const n = new THREE.Vector3(...normal).normalize();
  const g = new THREE.TorusGeometry(r, tube, 6, 12);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n));
  g.translate(cx, cy, cz);
  return g.toNonIndexed();
}

// A flat polygon extruded to a thin prism along `normal`. The polygon is reordered CCW around the normal so the
// front/back faces and side walls are consistently outward-wound. Keep polygons convex.
function prism(points, thickness, normal) {
  const n = new THREE.Vector3(...normal).normalize();
  const e1 = new THREE.Vector3(...points[1]).sub(new THREE.Vector3(...points[0]));
  const e2 = new THREE.Vector3(...points[2]).sub(new THREE.Vector3(...points[0]));
  if (new THREE.Vector3().crossVectors(e1, e2).dot(n) < 0) points = points.slice().reverse();
  const h = n.clone().multiplyScalar(thickness / 2);
  const front = points.map((p) => [p[0] + h.x, p[1] + h.y, p[2] + h.z]);
  const back = points.map((p) => [p[0] - h.x, p[1] - h.y, p[2] - h.z]);
  const pos = [];
  for (let i = 1; i + 1 < front.length; i++) pushTri(pos, front[0], front[i], front[i + 1]);
  for (let i = 1; i + 1 < back.length; i++) pushTri(pos, back[0], back[i + 1], back[i]);
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    pushTri(pos, front[i], back[i], back[j]);
    pushTri(pos, front[i], back[j], front[j]);
  }
  return bufferGeo(pos);
}

// A rounded flat paddle (the beaver tail) built as an extruded rounded shape lying flat.
function paddle(cx, cy, cz, width, length, thickness) {
  const w = width / 2, l = length / 2;
  const s = new THREE.Shape();
  s.moveTo(-w * 0.72, -l);
  s.quadraticCurveTo(-w, -l * 0.9, -w, -l * 0.35);
  s.quadraticCurveTo(-w, l * 0.35, -w * 0.72, l);
  s.quadraticCurveTo(0, l * 1.08, w * 0.72, l);
  s.quadraticCurveTo(w, l * 0.35, w, -l * 0.35);
  s.quadraticCurveTo(w, -l * 0.9, w * 0.72, -l);
  s.quadraticCurveTo(0, -l * 1.08, -w * 0.72, -l);
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false, curveSegments: 5 });
  g.rotateX(-Math.PI / 2);   // shape X-Y -> X-Z, extrusion -> +Y
  g.translate(cx, cy, cz);
  return g.index ? g.toNonIndexed() : g;
}

// --- surface-following solids (turtle shell seams, flippers) -----------------------------------------------------
function signedVolumePos(pos) {
  let v = 0;
  for (let t = 0; t + 8 < pos.length; t += 9) {
    const ax = pos[t], ay = pos[t + 1], az = pos[t + 2];
    const bx = pos[t + 3], by = pos[t + 4], bz = pos[t + 5];
    const cx = pos[t + 6], cy = pos[t + 7], cz = pos[t + 8];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

// Build a closed solid from a triangle soup, flipping the winding if it came out inward.
function solidGeo(pos) {
  if (signedVolumePos(pos) < 0) {
    for (let t = 0; t + 8 < pos.length; t += 9) {
      for (let k = 0; k < 3; k++) { const tmp = pos[t + 3 + k]; pos[t + 3 + k] = pos[t + 6 + k]; pos[t + 6 + k] = tmp; }
    }
  }
  return bufferGeo(pos);
}

// Sweep a closed cross-section loop along a list of loops, capping both ends.
function sweepSolid(loops) {
  const pos = [];
  const n = loops.length, m = loops[0].length;
  for (let i = 0; i + 1 < n; i++) {
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      pushTri(pos, loops[i][k], loops[i][k2], loops[i + 1][k2]);
      pushTri(pos, loops[i][k], loops[i + 1][k2], loops[i + 1][k]);
    }
  }
  for (let k = 1; k + 1 < m; k++) pushTri(pos, loops[0][0], loops[0][k + 1], loops[0][k]);
  for (let k = 1; k + 1 < m; k++) pushTri(pos, loops[n - 1][0], loops[n - 1][k], loops[n - 1][k + 1]);
  return solidGeo(pos);
}

// A thin seam ribbon that follows a height field yFn(x,z): every vertex y is derived from the surface, and the
// ribbon is buried slightly (bottom below the surface) so it never floats above the shell.
function domeRibbon(frames, halfW, top, bottom, yFn) {
  const n = frames.length;
  const lat = [];
  for (let i = 0; i < n; i++) {
    const a = frames[Math.max(0, i - 1)], b = frames[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    lat.push({ x: -tz, z: tx });
  }
  const loops = [];
  for (let i = 0; i < n; i++) {
    const f = frames[i], l = lat[i];
    const lx = f.x + l.x * halfW, lz = f.z + l.z * halfW;
    const rx = f.x - l.x * halfW, rz = f.z - l.z * halfW;
    const ly = yFn(lx, lz), ry = yFn(rx, rz);
    loops.push([
      [lx, ly + top, lz], [rx, ry + top, rz], [rx, ry + bottom, rz], [lx, ly + bottom, lz],
    ]);
  }
  return sweepSolid(loops);
}

// A broad carved plate tangent to a height field.
function domePlate(x, z, r, thickness, yFn) {
  const y = yFn(x, z);
  const e = 0.01;
  const nx = (yFn(x + e, z) - yFn(x - e, z)) / (2 * e);
  const nz = (yFn(x, z + e) - yFn(x, z - e)) / (2 * e);
  const n = new THREE.Vector3(-nx, 1, -nz).normalize();
  const g = new THREE.CylinderGeometry(r, r, thickness, 7, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n));
  g.translate(x, y + thickness * 0.2, z);
  return g.toNonIndexed();
}

// A broad, flattened, organic flipper lofted from a base to a tip with a tapering width profile.
function flipper(base, tip, widths, thickness, seg = 10) {
  const A = new THREE.Vector3(...base), B = new THREE.Vector3(...tip);
  const axis = new THREE.Vector3().subVectors(B, A);
  const len = axis.length(); axis.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const lat = new THREE.Vector3().crossVectors(up, axis).normalize();
  const pos = [];
  const rings = widths.map((w, i) => {
    const t = i / (widths.length - 1);
    const c = A.clone().addScaledVector(axis, t * len);
    const out = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const p = c.clone().addScaledVector(lat, Math.sin(a) * w).addScaledVector(up, Math.cos(a) * thickness * (1 - t * 0.5));
      out.push([p.x, p.y, p.z]);
    }
    return out;
  });
  for (let s = 0; s + 1 < rings.length; s++) {
    const R = rings[s], S = rings[s + 1];
    for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg; pushTri(pos, R[k], R[k2], S[k2]); pushTri(pos, R[k], S[k2], S[k]); }
  }
  const c0 = A, c1 = B;
  for (let k = 0; k < seg; k++) {
    const k2 = (k + 1) % seg;
    pushTri(pos, [c0.x, c0.y, c0.z], rings[0][k2], rings[0][k]);
    pushTri(pos, [c1.x, c1.y, c1.z], rings[rings.length - 1][k], rings[rings.length - 1][k2]);
  }
  return solidGeo(pos);
}

// -------------------------------------------------------------------------------------------------------------------
// Species builders. Each returns [{ geo, key }] in local coordinates, ground at y = 0, facing +Z.
// -------------------------------------------------------------------------------------------------------------------
function buildBear() {
  const p = [];
  // barrel body (not a pear): the width stays broad from the seat to the shoulders
  p.push({ geo: loftY([
    { y: 0.00, rx: 0.50, rz: 0.46 },
    { y: 0.30, rx: 0.56, rz: 0.50 },
    { y: 0.70, rx: 0.56, rz: 0.50 },
    { y: 1.05, rx: 0.52, rz: 0.46 },
  ], 18), key: 'wood' });
  p.push({ geo: loftY([
    { y: 1.00, rx: 0.52, rz: 0.46 },
    { y: 1.35, rx: 0.54, rz: 0.46 },
    { y: 1.70, rx: 0.50, rz: 0.42 },
    { y: 1.95, rx: 0.40, rz: 0.34 },
  ], 18), key: 'wood' });
  // massive wide rounded head (~0.75 m wide)
  p.push({ geo: loftY([
    { y: 1.90, rx: 0.34, rz: 0.30, cz: 0.04 },
    { y: 2.08, rx: 0.38, rz: 0.32, cz: 0.08 },
    { y: 2.26, rx: 0.30, rz: 0.26, cz: 0.06 },
  ], 18), key: 'wood' });
  // short wide muzzle (short projection, not a long pale snout)
  p.push({ geo: loftZ([
    { z: 0.18, rx: 0.30, ry: 0.20, cy: 2.02 },
    { z: 0.34, rx: 0.28, ry: 0.18, cy: 2.01 },
  ], 12), key: 'woodLight' });
  // very broad faceted blunt black nose (~0.55 m wide, ~0.30 m high, ~0.25 m projection)
  p.push({ geo: loftZ([
    { z: 0.30, rx: 0.28, ry: 0.16, cy: 2.02 },
    { z: 0.48, rx: 0.26, ry: 0.15, cy: 2.01 },
    { z: 0.55, rx: 0.15, ry: 0.09, cy: 2.00 },
  ], 8), key: 'black' });
  // wide continuous black eye mask wrapping both eyes (one connected plane, not two squares)
  p.push({ geo: prism([
    [-0.30, 2.04, 0.34], [0.30, 2.04, 0.34], [0.32, 2.12, 0.34],
    [0.24, 2.18, 0.34], [-0.24, 2.18, 0.34], [-0.32, 2.12, 0.34],
  ], 0.08, [0, 0, 1]), key: 'black' });
  // natural larch rings around the pupils, with dark pupils inside
  for (const sx of [-1, 1]) {
    p.push({ geo: torusAt(sx * 0.16, 2.10, 0.38, 0.06, 0.02, [0, 0, 1]), key: 'woodLight' });
    p.push({ geo: discAt(sx * 0.16, 2.10, 0.39, 0.03, 0.02, [0, 0, 1]), key: 'woodDark' });
  }
  // round ears (thick discs) with black inner ears
  for (const sx of [-1, 1]) {
    p.push({ geo: discAt(sx * 0.24, 2.30, 0.02, 0.12, 0.07, [0, 0, 1]), key: 'wood' });
    p.push({ geo: discAt(sx * 0.24, 2.30, 0.06, 0.06, 0.03, [0, 0, 1]), key: 'black' });
  }
  // forepaws resting against the belly: rounded natural wood, not brown rectangular blocks
  for (const sx of [-1, 1]) {
    p.push({ geo: rod([sx * 0.44, 1.62, 0.16], [sx * 0.20, 1.18, 0.40], 0.11, 0.10, 8), key: 'wood' });
    p.push({ geo: loftZ([
      { z: 0.34, rx: 0.10, ry: 0.09, cy: 1.12, cx: sx * 0.18 },
      { z: 0.46, rx: 0.09, ry: 0.08, cy: 1.10, cx: sx * 0.18 },
    ], 8), key: 'wood' });
    p.push({ geo: boxAt(sx * 0.18, 1.05, 0.50, 0.14, 0.03, 0.05), key: 'black' });
  }
  // hind feet: rounded natural wood
  for (const sx of [-1, 1]) p.push({ geo: loftZ([
    { z: 0.20, rx: 0.13, ry: 0.07, cy: 0.07, cx: sx * 0.30 },
    { z: 0.48, rx: 0.13, ry: 0.07, cy: 0.07, cx: sx * 0.30 },
  ], 8), key: 'wood' });
  return p;
}

function buildBeaver() {
  const p = [];
  // crouched upright rounded body
  p.push({ geo: loftY([
    { y: 0.00, rx: 0.30, rz: 0.28 },
    { y: 0.20, rx: 0.36, rz: 0.32 },
    { y: 0.45, rx: 0.34, rz: 0.30 },
    { y: 0.62, rx: 0.26, rz: 0.24 },
  ], 16), key: 'wood' });
  // raised blunt head
  p.push({ geo: loftY([
    { y: 0.60, rx: 0.22, rz: 0.20, cz: 0.06 },
    { y: 0.78, rx: 0.24, rz: 0.22, cz: 0.10 },
    { y: 0.92, rx: 0.18, rz: 0.16, cz: 0.10 },
  ], 14), key: 'wood' });
  // blunt snout + nose
  p.push({ geo: loftZ([
    { z: 0.20, rx: 0.12, ry: 0.10, cy: 0.80 },
    { z: 0.34, rx: 0.09, ry: 0.08, cy: 0.78 },
  ], 10), key: 'woodLight' });
  p.push({ geo: boxAt(0, 0.78, 0.36, 0.08, 0.06, 0.05), key: 'woodDark' });
  // two front incisors
  for (const sx of [-1, 1]) p.push({ geo: boxAt(sx * 0.04, 0.70, 0.34, 0.045, 0.10, 0.03), key: 'woodLight' });
  // small rounded ears
  for (const sx of [-1, 1]) p.push({ geo: discAt(sx * 0.16, 0.90, 0.10, 0.05, 0.03, [0, 0, 1]), key: 'wood' });
  // small forepaws at the chest
  for (const sx of [-1, 1]) {
    p.push({ geo: rod([sx * 0.26, 0.55, 0.16], [sx * 0.12, 0.42, 0.30], 0.06, 0.05, 7), key: 'wood' });
    p.push({ geo: boxAt(sx * 0.10, 0.40, 0.32, 0.10, 0.08, 0.10), key: 'woodDark' });
  }
  // broad flat tail on the ground behind
  p.push({ geo: paddle(0, 0.06, -0.55, 0.55, 0.75, 0.10), key: 'woodDark' });
  for (const z of [-0.35, -0.55, -0.75]) p.push({ geo: boxAt(0, 0.12, z, 0.42, 0.02, 0.025), key: 'wood' });
  // hind feet
  for (const sx of [-1, 1]) p.push({ geo: boxAt(sx * 0.22, 0.04, 0.10, 0.14, 0.08, 0.20), key: 'woodDark' });
  // blue/green painted metal rocker/spring base (0.15 m) under the animal
  const baseH = 0.15;
  p.push({ geo: boxAt(0, baseH / 2, -0.1, 0.7, baseH, 1.0), key: 'steel' });
  for (const part of p) if (part.key !== 'steel') part.geo.translate(0, baseH, 0);
  return p;
}

function buildEagle() {
  const p = [];
  // log perch along X
  p.push({ geo: rod([-0.55, 0.10, 0.0], [0.55, 0.10, 0.0], 0.10, 0.10, 10), key: 'woodDark' });
  // squat broad body
  p.push({ geo: loftY([
    { y: 0.20, rx: 0.34, rz: 0.30 },
    { y: 0.45, rx: 0.40, rz: 0.34 },
    { y: 0.70, rx: 0.36, rz: 0.30 },
    { y: 0.88, rx: 0.26, rz: 0.22 },
  ], 16), key: 'wood' });
  // black chest
  p.push({ geo: loftY([
    { y: 0.30, rx: 0.18, rz: 0.12, cz: 0.22 },
    { y: 0.55, rx: 0.22, rz: 0.15, cz: 0.24 },
    { y: 0.80, rx: 0.16, rz: 0.12, cz: 0.22 },
  ], 14), key: 'black' });
  // white head
  p.push({ geo: loftY([
    { y: 0.88, rx: 0.22, rz: 0.20, cz: 0.02 },
    { y: 1.05, rx: 0.24, rz: 0.22, cz: 0.04 },
    { y: 1.20, rx: 0.18, rz: 0.16, cz: 0.04 },
    { y: 1.27, rx: 0.10, rz: 0.09, cz: 0.04 },
  ], 14), key: 'white' });
  // jagged white feather edge around the neck
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const x = Math.sin(a) * 0.24, z = Math.cos(a) * 0.22 + 0.02;
    p.push({ geo: coneAt([x, 0.90, z], [x * 1.15, 0.80, z * 1.15], 0.05, 4), key: 'white' });
  }
  // broad yellow hooked beak
  p.push({ geo: coneAt([0, 1.12, 0.20], [0, 1.08, 0.44], 0.10, 7), key: 'yellow' });
  p.push({ geo: coneAt([0, 1.10, 0.40], [0, 1.01, 0.46], 0.055, 6), key: 'yellow' });
  // eyes
  for (const sx of [-1, 1]) p.push({ geo: boxAt(sx * 0.11, 1.12, 0.20, 0.05, 0.05, 0.04), key: 'woodDark' });
  // squat broad folded wings with a scalloped lower edge
  for (const sx of [-1, 1]) {
    p.push({ geo: prism([
      [sx * 0.20, 0.86, 0.02],
      [sx * 0.58, 0.66, 0.02],
      [sx * 0.60, 0.42, 0.02],
      [sx * 0.20, 0.34, 0.02],
    ], 0.14, [0, 0, 1]), key: 'wood' });
    for (const gx of [0.30, 0.42, 0.54]) {
      p.push({ geo: prism([
        [sx * gx - 0.06, 0.42, 0.02], [sx * gx + 0.06, 0.42, 0.02], [sx * gx, 0.30, 0.02],
      ], 0.14, [0, 0, 1]), key: 'wood' });
    }
  }
  // three white tail feather tips at the back
  for (const sx of [-1, 0, 1]) {
    p.push({ geo: prism([
      [sx * 0.14 - 0.06, 0.30, -0.30], [sx * 0.14 + 0.06, 0.30, -0.30], [sx * 0.14, 0.10, -0.56],
    ], 0.06, [0, 0, 1]), key: 'white' });
  }
  // yellow talons gripping the log perch
  for (const sx of [-1, 1]) {
    p.push({ geo: rod([sx * 0.16, 0.24, 0.02], [sx * 0.16, 0.04, 0.10], 0.04, 0.03, 6), key: 'yellow' });
    p.push({ geo: rod([sx * 0.16, 0.24, 0.02], [sx * 0.16, 0.04, -0.06], 0.04, 0.03, 6), key: 'yellow' });
  }
  return p;
}

// The turtle shell is an analytic elliptical dome. The shell mesh, the scute plates and the green seam ribbons all
// derive their height from this one profile, so the seams sit on the surface instead of floating above it.
const TURTLE_SHELL = { a: 1.0, c: 1.2, y0: 0.12, b: 0.33 };
function turtleShellY(x, z) {
  const q = 1 - (x / TURTLE_SHELL.a) ** 2 - (z / TURTLE_SHELL.c) ** 2;
  return q <= 0 ? TURTLE_SHELL.y0 : TURTLE_SHELL.y0 + TURTLE_SHELL.b * Math.sqrt(q);
}

function buildTurtle() {
  const p = [];
  const { a, c, y0, b } = TURTLE_SHELL;
  // red band / underside
  p.push({ geo: loftY([
    { y: 0.00, rx: a * 0.98, rz: c * 0.98 },
    { y: 0.10, rx: a, rz: c },
    { y: 0.16, rx: a * 0.98, rz: c * 0.98 },
  ], 24), key: 'red' });
  // low broad segmented larch shell, built from the same analytic profile the seams follow
  const rings = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const t = 1 - i / N;
    rings.push({ y: y0 + b * Math.sqrt(1 - t * t), rx: Math.max(0.02, a * t), rz: Math.max(0.02, c * t) });
  }
  p.push({ geo: loftY(rings, 24), key: 'wood' });
  // natural same-wood shell with THIN green recessed seams that follow the dome (no white caps, no plaques)
  for (const z of [-0.9, -0.45, 0, 0.45, 0.9]) {
    const xmax = a * Math.sqrt(Math.max(0, 1 - (z / c) ** 2)) * 0.94;
    const frames = [];
    for (let i = 0; i <= 10; i++) frames.push({ x: -xmax + (2 * xmax * i) / 10, z });
    p.push({ geo: domeRibbon(frames, 0.018, 0.003, -0.03, turtleShellY), key: 'green' });
  }
  for (const x of [-0.5, 0, 0.5]) {
    const zmax = c * Math.sqrt(Math.max(0, 1 - (x / a) ** 2)) * 0.94;
    const frames = [];
    for (let i = 0; i <= 10; i++) frames.push({ x, z: -zmax + (2 * zmax * i) / 10 });
    p.push({ geo: domeRibbon(frames, 0.018, 0.003, -0.03, turtleShellY), key: 'green' });
  }
  // huge wide oval head (~0.75 m wide, ~0.8 m long), low at the front of the shell
  p.push({ geo: loftZ([
    { z: 1.15, rx: 0.30, ry: 0.22, cy: 0.30 },
    { z: 1.40, rx: 0.375, ry: 0.27, cy: 0.32 },
    { z: 1.70, rx: 0.36, ry: 0.26, cy: 0.32 },
    { z: 1.95, rx: 0.26, ry: 0.20, cy: 0.30 },
  ], 18), key: 'wood' });
  // broad curved black smiling lower face/mouth occupying the front quarter (one area, not three blocks)
  p.push({ geo: prism([
    [-0.26, 0.36, 1.97], [0.26, 0.36, 1.97], [0.24, 0.22, 1.97],
    [0.0, 0.14, 1.97], [-0.24, 0.22, 1.97],
  ], 0.012, [0, 0, 1]), key: 'black' });
  // large circle-outline eyes on the topsides of the head
  for (const sx of [-1, 1]) {
    p.push({ geo: torusAt(sx * 0.30, 0.46, 1.35, 0.09, 0.02, [sx * 0.7, 0.7, 0]), key: 'black' });
    p.push({ geo: discAt(sx * 0.321, 0.481, 1.35, 0.04, 0.012, [sx * 0.7, 0.7, 0]), key: 'black' });
  }
  // four very broad paddle flippers; the front pair spans almost the entire front side of the body
  const flippers = [
    { base: [0.30, 0.10, 0.85], tip: [1.20, 0.08, 1.20], widths: [0.14, 0.30, 0.34, 0.22, 0.08] },
    { base: [-0.30, 0.10, 0.85], tip: [-1.20, 0.08, 1.20], widths: [0.14, 0.30, 0.34, 0.22, 0.08] },
    { base: [0.30, 0.10, -0.85], tip: [1.20, 0.08, -1.20], widths: [0.12, 0.26, 0.30, 0.20, 0.07] },
    { base: [-0.30, 0.10, -0.85], tip: [-1.20, 0.08, -1.20], widths: [0.12, 0.26, 0.30, 0.20, 0.07] },
  ];
  for (const f of flippers) p.push({ geo: flipper(f.base, f.tip, f.widths, 0.06, 10), key: 'wood' });
  // three turquoise claw triangles across each broad flipper's outer edge
  for (const f of flippers) {
    const A = new THREE.Vector3(...f.base), B = new THREE.Vector3(...f.tip);
    const axis = new THREE.Vector3().subVectors(B, A).normalize();
    const lat = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), axis).normalize();
    for (const off of [-0.12, 0, 0.12]) {
      const c = B.clone().addScaledVector(lat, off);
      p.push({ geo: prism([
        [c.x, c.y + 0.05, c.z],
        [c.x + axis.x * 0.10 + lat.x * 0.05, c.y + 0.05, c.z + axis.z * 0.10 + lat.z * 0.05],
        [c.x + axis.x * 0.10 - lat.x * 0.05, c.y + 0.05, c.z + axis.z * 0.10 - lat.z * 0.05],
      ], 0.04, [0, 1, 0]), key: 'turquoise' });
    }
  }
  return p;
}

function buildOtter() {
  const p = [];
  // long low arched body
  p.push({ geo: loftZ([
    { z: -0.70, rx: 0.12, ry: 0.12, cy: 0.26 },
    { z: -0.40, rx: 0.18, ry: 0.18, cy: 0.34 },
    { z: 0.00, rx: 0.20, ry: 0.20, cy: 0.40 },
    { z: 0.35, rx: 0.17, ry: 0.17, cy: 0.38 },
  ], 14), key: 'wood' });
  // slim raised neck + head
  p.push({ geo: loftZ([
    { z: 0.35, rx: 0.13, ry: 0.13, cy: 0.44 },
    { z: 0.55, rx: 0.12, ry: 0.12, cy: 0.52 },
    { z: 0.70, rx: 0.15, ry: 0.14, cy: 0.56 },
    { z: 0.82, rx: 0.10, ry: 0.10, cy: 0.54 },
  ], 12), key: 'wood' });
  // snout + nose
  p.push({ geo: loftZ([
    { z: 0.82, rx: 0.08, ry: 0.07, cy: 0.52 },
    { z: 0.92, rx: 0.05, ry: 0.05, cy: 0.51 },
  ], 9), key: 'woodLight' });
  p.push({ geo: boxAt(0, 0.51, 0.94, 0.05, 0.04, 0.04), key: 'woodDark' });
  // round eyes
  for (const sx of [-1, 1]) p.push({ geo: discAt(sx * 0.10, 0.60, 0.72, 0.035, 0.02, [0, 0, 1]), key: 'woodDark' });
  // small rounded ears
  for (const sx of [-1, 1]) p.push({ geo: discAt(sx * 0.11, 0.66, 0.60, 0.045, 0.03, [0, 0, 1]), key: 'wood' });
  // long tapered tail
  p.push({ geo: loftZ([
    { z: -0.70, rx: 0.12, ry: 0.11, cy: 0.26 },
    { z: -1.00, rx: 0.09, ry: 0.08, cy: 0.22 },
    { z: -1.30, rx: 0.04, ry: 0.04, cy: 0.18 },
  ], 10), key: 'wood' });
  // four short legs + paws
  for (const sx of [-1, 1]) for (const z of [0.25, -0.35]) {
    p.push({ geo: rod([sx * 0.16, 0.30, z], [sx * 0.18, 0.04, z], 0.055, 0.05, 7), key: 'wood' });
    p.push({ geo: boxAt(sx * 0.18, 0.03, z + 0.03, 0.09, 0.05, 0.13), key: 'woodDark' });
  }
  // blue/green painted metal rocker/spring base (0.15 m) under the animal
  const baseH = 0.15;
  p.push({ geo: boxAt(0, baseH / 2, -0.2, 0.5, baseH, 1.9), key: 'steel' });
  for (const part of p) if (part.key !== 'steel') part.geo.translate(0, baseH, 0);
  return p;
}

// A small wolf cub: body, head, two pointed ears, four legs to the ground and a tail. Natural larch, no paint.
function cubParts(cx) {
  const p = [];
  p.push({ geo: loftZ([
    { z: -0.18, rx: 0.07, ry: 0.07, cy: 0.18, cx },
    { z: 0.00, rx: 0.09, ry: 0.09, cy: 0.19, cx },
    { z: 0.16, rx: 0.07, ry: 0.07, cy: 0.18, cx },
  ], 10), key: 'wood' });
  p.push({ geo: loftZ([
    { z: 0.16, rx: 0.07, ry: 0.07, cy: 0.20, cx },
    { z: 0.28, rx: 0.06, ry: 0.06, cy: 0.20, cx },
  ], 8), key: 'wood' });
  for (const sx of [-1, 1]) p.push({ geo: coneAt([cx + sx * 0.04, 0.26, 0.20], [cx + sx * 0.05, 0.33, 0.19], 0.025, 4), key: 'wood' });
  for (const sx of [-1, 1]) for (const z of [0.10, -0.12]) {
    p.push({ geo: rod([cx + sx * 0.06, 0.16, z], [cx + sx * 0.06, 0.01, z], 0.025, 0.02, 5), key: 'wood' });
  }
  p.push({ geo: rod([cx, 0.18, -0.18], [cx, 0.10, -0.30], 0.03, 0.015, 5), key: 'wood' });
  return p;
}

function buildWolf() {
  const p = [];
  // solid carved mother body, broad continuous trunk back, standing on all fours
  p.push({ geo: loftZ([
    { z: -0.90, rx: 0.24, ry: 0.26, cy: 0.72 },
    { z: -0.50, rx: 0.32, ry: 0.34, cy: 0.76 },
    { z: 0.00, rx: 0.34, ry: 0.36, cy: 0.78 },
    { z: 0.40, rx: 0.30, ry: 0.32, cy: 0.74 },
    { z: 0.62, rx: 0.24, ry: 0.26, cy: 0.68 },
  ], 16), key: 'woodLight' });
  // shorter forward wolf head (not a needle)
  p.push({ geo: loftZ([
    { z: 0.62, rx: 0.22, ry: 0.21, cy: 0.66 },
    { z: 0.82, rx: 0.21, ry: 0.20, cy: 0.62 },
    { z: 0.98, rx: 0.15, ry: 0.14, cy: 0.58 },
  ], 12), key: 'woodLight' });
  // short blunt muzzle
  p.push({ geo: loftZ([
    { z: 0.98, rx: 0.11, ry: 0.10, cy: 0.56 },
    { z: 1.10, rx: 0.08, ry: 0.07, cy: 0.54 },
  ], 9), key: 'woodLight' });
  // black nose (small carved accent, not an extruded needle)
  p.push({ geo: boxAt(0, 0.54, 1.12, 0.07, 0.06, 0.05), key: 'black' });
  // clear pointed ears
  for (const sx of [-1, 1]) p.push({ geo: coneAt([sx * 0.13, 0.80, 0.66], [sx * 0.15, 0.98, 0.64], 0.07, 5), key: 'woodLight' });
  // black eyes on the head
  for (const sx of [-1, 1]) p.push({ geo: discAt(sx * 0.13, 0.68, 0.86, 0.035, 0.02, [0, 0, 1]), key: 'black' });
  // four tapered broad wood legs (no dark hoof blocks)
  for (const sx of [-1, 1]) for (const z of [0.42, -0.55]) {
    p.push({ geo: rod([sx * 0.24, 0.72, z], [sx * 0.24, 0.03, z], 0.11, 0.08, 8), key: 'woodLight' });
    p.push({ geo: loftZ([
      { z: z - 0.10, rx: 0.09, ry: 0.05, cy: 0.05, cx: sx * 0.24 },
      { z: z + 0.10, rx: 0.09, ry: 0.05, cy: 0.05, cx: sx * 0.24 },
    ], 8), key: 'woodLight' });
  }
  // tail behind
  p.push({ geo: rod([0, 0.70, -0.90], [0, 0.34, -1.18], 0.10, 0.05, 7), key: 'woodLight' });
  // two cubs under the belly, each a small wolf with four legs, head and ears, feet on the ground
  for (const sx of [-1, 1]) p.push(...cubParts(sx * 0.17));
  return p;
}

function buildMusky() {
  const p = [];
  // very long, low, flattened solid larch oval: broad rounded head at +Z, tapering rounded tail at -Z.
  // No large dorsal fin, no forked tail, no pedestal — the installed overhead view shows a moulded solid form.
  p.push({ geo: loftZ([
    { z: -1.00, rx: 0.06, ry: 0.05, cy: 0.07 },
    { z: -0.70, rx: 0.16, ry: 0.10, cy: 0.12 },
    { z: -0.30, rx: 0.28, ry: 0.16, cy: 0.18 },
    { z: 0.10, rx: 0.325, ry: 0.20, cy: 0.22 },
    { z: 0.50, rx: 0.30, ry: 0.19, cy: 0.21 },
    { z: 0.80, rx: 0.24, ry: 0.15, cy: 0.17 },
    { z: 1.05, rx: 0.14, ry: 0.09, cy: 0.11 },
  ], 18), key: 'muskyWood' });
  // shallow integrated pectoral flukes (low, part of the solid form; not large protruding fins)
  for (const sx of [-1, 1]) {
    p.push({ geo: prism([
      [sx * 0.26, 0.14, 0.30], [sx * 0.40, 0.12, 0.10], [sx * 0.28, 0.14, -0.05],
    ], 0.05, [0, 1, 0]), key: 'muskyWood' });
  }
  // two black/teal ringed eyes on the top near the front
  for (const sx of [-1, 1]) {
    p.push({ geo: torusAt(sx * 0.12, 0.36, 0.70, 0.05, 0.018, [0, 1, 0]), key: 'black' });
    p.push({ geo: discAt(sx * 0.12, 0.36, 0.70, 0.025, 0.02, [0, 1, 0]), key: 'turquoise' });
  }
  // quiet short-muzzle mouth line at the front
  p.push({ geo: boxAt(0, 0.12, 1.00, 0.10, 0.03, 0.04), key: 'woodDark' });
  return p;
}

const BUILDERS = { bear: buildBear, beaver: buildBeaver, eagle: buildEagle, turtle: buildTurtle, otter: buildOtter, wolf: buildWolf, musky: buildMusky };

// -------------------------------------------------------------------------------------------------------------------
// Merge per material, assemble one THREE.Group. Bounded to one mesh per material key (< 8 per animal).
// -------------------------------------------------------------------------------------------------------------------
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
    const g = geos.length === 1 ? geos[0] : (C.Addons && C.Addons.mergeGeometries ? C.Addons.mergeGeometries(geos, false) : concatGeos(geos));
    merged.set(key, g);
  }
  return merged;
}

function concatGeos(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos[(o + i) * 3] = p.getX(i); pos[(o + i) * 3 + 1] = p.getY(i); pos[(o + i) * 3 + 2] = p.getZ(i);
      nor[(o + i) * 3] = n.getX(i); nor[(o + i) * 3 + 1] = n.getY(i); nor[(o + i) * 3 + 2] = n.getZ(i);
      uv[(o + i) * 2] = u.getX(i); uv[(o + i) * 2 + 1] = u.getY(i);
    }
    o += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function assemble(parts, name) {
  const mats = dodemMaterials();
  const merged = mergeByKey(parts);
  const group = new THREE.Group();
  group.name = name;
  const drawCalls = [];
  for (const [key, geo] of merged) {
    const mesh = new THREE.Mesh(geo, mats[key] || mats.wood);
    mesh.name = `${name}-${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    drawCalls.push({ key, triangles: geo.attributes.position.count / 3 });
  }
  return { group, drawCalls };
}

// -------------------------------------------------------------------------------------------------------------------
// Public factory
// -------------------------------------------------------------------------------------------------------------------
function normalizeKind(kind) {
  const k = String(kind || '').toLowerCase().replace(/[^a-z]/g, '');
  if (k === 'muskie' || k === 'muskiefish' || k === 'muskellunge') return 'musky';
  return k;
}

const round = (n) => Math.round(n * 100) / 100;

function buildBiidaasigeDodemAnimal(kind) {
  const key = normalizeKind(kind);
  const spec = DODEM_SPECS[key];
  if (!spec || !BUILDERS[key]) return null;

  const { group, drawCalls } = assemble(BUILDERS[key](), `BiidaasigeDodem-${key}`);
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);
  const triangles = drawCalls.reduce((s, d) => s + d.triangles, 0);

  const colliders = [{
    minX: box.min.x, maxX: box.max.x,
    minY: box.min.y, maxY: box.max.y,
    minZ: box.min.z, maxZ: box.max.z,
    kind: `dodem-${key}`, prop: true,
  }];

  return {
    kind: key,
    group,
    triangles,
    drawCalls,
    colliders,
    surfaces: [],            // the sculpture claims no walkable surface
    climbable: false,
    groundContactY: 0,
    dimensions: {
      heightM: round(size.y),
      lengthM: round(size.z),
      widthM: round(size.x),
      status: 'photo-estimate-not-survey',
    },
    appearance: spec.appearance,
    appearanceConfidence: spec.confidence,
    verifiedAppearance: spec.verified,
    sourceEvidence: [spec.evidence],
    attribution: DODEM_ATTRIBUTION,
    attributionSource: DODEM_ATTRIBUTION_SOURCE,
    material: DODEM_MATERIAL,
    position: null,
    placementStatus: 'unplaced',
    note: 'Local-origin factory: origin at ground contact, +Y up, 1 unit = 1 m, facing +Z. Individual Dodem positions are not published, so this model is unplaced. '
      + (spec.verified
        ? 'Appearance follows the City primary photo and installed crop.'
        : 'Appearance is an approximate carved-larch interpretation, not a verified as-built match.'),
  };
}

function buildBiidaasigeDodemSet() {
  const out = {};
  for (const k of DODEM_ANIMALS) out[k] = buildBiidaasigeDodemAnimal(k);
  return out;
}

// Exports
C.BIIDAASIGE_DODEM_ANIMALS = DODEM_ANIMALS.slice();
C.BIIDAASIGE_DODEM_SPECS = DODEM_SPECS;
C.BIIDAASIGE_DODEM_ATTRIBUTION = DODEM_ATTRIBUTION;
C.BIIDAASIGE_DODEM_MATERIAL = DODEM_MATERIAL;
C.BIIDAASIGE_DODEM_TURTLE_SHELL = TURTLE_SHELL;
C.biidaasigeTurtleShellY = turtleShellY;
C.buildBiidaasigeDodemAnimal = buildBiidaasigeDodemAnimal;
C.buildBiidaasigeDodemSet = buildBiidaasigeDodemSet;
})();
