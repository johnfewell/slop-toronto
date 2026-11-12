(function () {
// js/waterfront-concert-stage.js
// Harbourfront Centre Concert Stage: the open-sided, membrane-roofed outdoor stage on the south-west campus (John Quay
// side), rebuilt in 2022. This replaces the generic pitched-roof residential houses the city's building compiler had
// drawn on its mapped "Concert Stage" footprint (bead st-sb3r.43).
//
// Sources (structural): Blackwell (https://blackwell.ca/portfolio/project/harbourfront-centre-stage) — the 2022 roof
// is a fabric membrane carried wholly by the EXISTING masts, no new tie-downs, architect Athos Zaghi. Cast Connex
// (https://www.castconnex.com/projects/harbourfront-centre-stage) — raised, rain-protected seating deck. Harbourfront
// Centre official 2025 access guide p23 — OPEN SIDES, FIXED seats, entrance at the BACK of the seating, a RAMP at the
// CENTRE BACK to the accessible seats; p4 — the stage sits on the south-west campus, opening toward the water.
//
// Captain photo-form review (the author cannot read images; every photo form here is the captain's):
// stage-blackwell-9255/9310.jpg — a broad, low, slightly arched GREY-GREEN TRANSLUCENT central canopy on a WHITE open
// triangulated space-frame; SIX legible WHITE perimeter/front masts with fine stays, tops projecting well above the roof
// with small white pennants (total count NOT established); a lower WHITE SCALLOPED ring membrane hung from the same
// masts with a clear OPEN GAP up to the higher central roof; no pyramids, no enclosed walls; DARK FIXED SEATS WITH BACKS
// on the raised deck; low white perimeter wall with black guardrail; clear rear access. Temporary shipping containers
// and event banners are not copied. The older Commons aerial predates the 2022 membrane and is NOT used.
//
// WHAT IT IS: a conservative, representative structural typology bounded to the mapped footprint — central shallow
// arched membrane on an open truss, perimeter masts with stays, lower scalloped ring, raised seating deck with backed
// seats, low perimeter wall — plus a REAL walkable footing (a graded rear ramp joining the ground to the raised deck,
// returned by C.concertStageSurfaceAt). The sources give no measured spans, roof/mast heights, cable or mast counts, so
// every dimension is an ESTIMATE (STAGE_ESTIMATES) and the 7.1 m mapped row height is a MASSING value, not a survey. It
// is not an engineering reconstruction.
//
// INTEGRATION: the row is found by STABLE IDENTITY (name + world centre + mapped height + angle), never by index. Call
// createWaterfrontConcertStage(THREE, scene) -> { group, colliders, stats } (builds only when the frame carries and
// covers it). One culling root; seats, masts, truss and stays are instanced or merged, never one object per chair. The
// captain wires C.waterfrontConcertStageExcludesBuilding(i) into buildings.js and C.concertStageSurfaceAt into the deck
// height sampler; both are success-gated and bound to the GEO the build used.

const C = window.CITY;
const GROUND = 0;

const CONCERT_STAGE = {
  id: 'concertStage',
  name: 'Concert Stage',
  identity: { name: 'Concert Stage', cx: -451.5, cz: 710.7, h: 7.1, ang: -0.026 },
  sourceUrls: [
    'https://blackwell.ca/portfolio/project/harbourfront-centre-stage',
    'https://www.castconnex.com/projects/harbourfront-centre-stage'
  ]
};

// Every value is an ESTIMATE (metres) unless labelled source. Recorded in stats.estimates and docs.
const STAGE_ESTIMATES = {
  massingHeight: 7.1,       // mapped row height (massing, not a roof survey)
  roofSpring: 8.6,          // central roof spring height above the deck top
  roofRise: 1.1,            // slight arch camber
  ringTop: 3.6,             // low scalloped outer membrane apex above the deck top
  mastHeight: 12.0,         // perimeter mast above ground; tips project above the roof
  mastRadius: 0.16,
  deckLift: 0.3,            // representative low platform; leaves a gentle approach within the mapped rear space
  frontMasts: 6,            // SIX legible front/perimeter masts (captain photo) — representative, not a count
  backMasts: 2,             // two rear supports to carry the membrane back (representative)
  frontArcStart: -0.62,     // fraction of the front edge where the six front masts start
  frontArcEnd: 0.62,        // ...and end (a fan across the open/front side)
  ringPleats: 16,           // scallop pleats (decorative; one per membrane segment group)
  ringSegments: 64,         // ring band resolution
  ringBandOuterInset: 0.5,  // the scalloped band starts at the perimeter masts
  ringBandInnerInset: 4.0,  // ...and reaches several metres inward (a broad band, not a curtain)
  ringBandSag: 0.5,         // shallow inward sag (almost horizontal; open sightlines beneath)
  seatRows: 8,
  seatsPerRow: 14,
  rowPitch: 0.85,           // longitudinal row spacing (clear of the 0.48 m seat depth; no intersecting chairs)
  seatWidth: 0.46,
  seatDepth: 0.48,
  seatBack: 0.5,
  aisleCount: 2,
  sideWalk: 2.4,            // clear walkway along each side
  rearCourt: 4.0,           // rear-centre access court depth (official guide: enter at the back)
  rampRun: 5.2,             // graded rear ramp length within the mapped footprint (clamped to the rear space)
  rampHalfWidth: 2.0,
  wallHeight: 0.9,
  guardRailHeight: 0.4,
  reachableRise: 0.42       // max single step the city's walker climbs (conservative), gates the surface API
};

const RING_INSET = 0.55;

const isFiniteRow = (b) => Array.isArray(b) && b.length >= 10 && Number.isFinite(b[0]) && Number.isFinite(b[1]) &&
  Array.isArray(b[3]) && b[3].length > 0;

// Resolve the "Concert Stage" row for a GEO by stable identity; -1 when absent. Cached per GEO object.
const ROW_CACHE = new WeakMap();
function concertStageRow(G = C?.GEO) {
  if (!G || !Array.isArray(G.buildings)) return -1;
  if (ROW_CACHE.has(G)) return ROW_CACHE.get(G);
  const id = CONCERT_STAGE.identity;
  let found = -1;
  for (let i = 0; i < G.buildings.length; i++) {
    const b = G.buildings[i];
    if (!isFiniteRow(b) || b[9] !== id.name) continue;
    if (Math.hypot(b[0] - id.cx, b[1] - id.cz) > 0.5) continue;
    if (Math.abs(b[4] - id.h) > 0.05) continue;
    if (Math.abs((b[2] || 0) - id.ang) > 0.01) continue;
    found = i;
    break;
  }
  ROW_CACHE.set(G, found);
  return found;
}

// A mapped part [u0,u1,v0,v1] as a world axis box (city convention: world = (cx + u·cos + v·sin, cz − u·sin + v·cos)).
function concertStagePartBox(row, part) {
  const [cx, cz, ang] = row;
  const [u0, u1, v0, v1] = part;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const u = (u0 + u1) / 2, v = (v0 + v1) / 2;
  return { x: cx + u * cs + v * sn, z: cz - u * sn + v * cs, du: u1 - u0, dv: v1 - v0, ang, cs, sn, u0, u1, v0, v1 };
}

// The union plan of all parts in the row frame, plus the world centre of that union.
function concertStageFootprint(row) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of row[3]) {
    if (p[0] < u0) u0 = p[0];
    if (p[1] > u1) u1 = p[1];
    if (p[2] < v0) v0 = p[2];
    if (p[3] > v1) v1 = p[3];
  }
  const [cx, cz, ang] = row;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  return { u0, u1, v0, v1, uc, vc, cx: cx + uc * cs + vc * sn, cz: cz - uc * sn + vc * cs, ang, cs, sn };
}

function concertStageLocalToWorld(frame, u, v) {
  return [frame.cx + (u - frame.uc) * frame.cs + (v - frame.vc) * frame.sn,
    frame.cz - (u - frame.uc) * frame.sn + (v - frame.vc) * frame.cs];
}
// A local plan point + a height as a world three-space point [x, y, z].
function concertStagePoint3(frame, u, v, y) {
  const [x, z] = concertStageLocalToWorld(frame, u, v);
  return [x, y, z];
}
function concertStageWorldToLocal(frame, x, z) {
  const dx = x - frame.cx, dz = z - frame.cz;
  return [frame.uc + dx * frame.cs - dz * frame.sn, frame.vc + dx * frame.sn + dz * frame.cs];
}

// Frame capability: the GEO has the row and its frame really covers the mapped parts.
function waterfrontConcertStageSupported(G = C?.GEO) {
  if (!G || !G.frame || !G.frame.detail) return false;
  const bi = concertStageRow(G);
  if (bi < 0) return false;
  const b = G.buildings[bi], d = G.frame.detail;
  for (const p of b[3]) {
    const box = concertStagePartBox(b, p);
    if (!(box.x > d.x0 && box.x < d.x1 && box.z > d.z0 && box.z < d.z1)) return false;
  }
  return true;
}

function concertStageEnabled() {
  if (C && C.waterfrontConcertStageEnabled === false) return false;
  try {
    if (typeof location !== 'undefined' && location && location.search && typeof URLSearchParams !== 'undefined') {
      if (new URLSearchParams(location.search).get('stage') === '0') return false;
    }
  } catch { /* no location (node tests) */ }
  return true;
}

// The plan, in the row frame (local metres inside the mapped footprint). The stage opens toward local +v (the waterward
// front); the rear access court and the graded ramp are at −v. All plan extents are clamped inside the mapped parts.
function concertStageLayout(G = C?.GEO) {
  const bi = concertStageRow(G);
  if (bi < 0) return null;
  const row = G.buildings[bi];
  const f = concertStageFootprint(row);
  const E = STAGE_ESTIMATES;
  const w = f.u1 - f.u0, d = f.v1 - f.v0;
  const walk = Math.min(E.sideWalk, w * 0.16);
  const halfLen = Math.min(w / 2 - walk, d / 2 - 0.2);
  if (!(halfLen > 3) || !(d > 8)) return null;
  const uc = f.uc, vc = f.vc;
  const lift = Math.min(E.deckLift, d * 0.18);
  const deck = { u0: uc - halfLen, u1: uc + halfLen, v0: vc - halfLen * 0.82, v1: vc + halfLen * 0.82, lift };
  // the ramp descends from the deck's rear edge (−v) to the ground, using the whole rear space inside the footprint
  const rearSpace = Math.max(0, deck.v0 - (f.v0 + 0.4));
  const rampRun = Math.min(E.rampRun, rearSpace);
  const ramp = {
    u0: uc - Math.min(E.rampHalfWidth, halfLen * 0.4), u1: uc + Math.min(E.rampHalfWidth, halfLen * 0.4),
    vTop: deck.v0, vBottom: deck.v0 - rampRun, topY: lift, bottomY: 0, run: rampRun,
    grade: rampRun > 0 ? lift / rampRun : Infinity
  };
  const roof = {
    u0: deck.u0 - 0.4, u1: deck.u1 + 0.4, v0: deck.v0 - 0.4, v1: deck.v1 + 0.4,
    top: lift + E.roofSpring, rise: E.roofRise
  };
  const ring = { u0: f.u0 + RING_INSET, u1: f.u1 - RING_INSET, v0: f.v0 + RING_INSET, v1: f.v1 - RING_INSET,
    top: lift + E.ringTop, pleats: E.ringPleats };
  // the scalloped band morphology: a broad, almost-horizontal band (several metres wide, shallow sag)
  const ringBand = {
    outerInset: E.ringBandOuterInset, innerInset: E.ringBandInnerInset,
    outerY: ring.top, innerY: ring.top - E.ringBandSag,
    width: E.ringBandInnerInset - E.ringBandOuterInset, rise: E.ringBandSag
  };
  return {
    rowIndex: bi,
    identity: CONCERT_STAGE.identity,
    frame: f,
    estimates: E,
    deck, ramp, roof, ring, ringBand,
    mastRadius: Math.min(E.mastRadius, 0.2),
    masts: stageMasts(f, deck, E),
    rearGap: { u0: ramp.u0, u1: ramp.u1, v0: f.v0, v1: ramp.vBottom },
    seats: seatRows(deck, E),
    height: { deckTop: lift, roofTop: roof.top, ringTop: ring.top, mastTop: E.mastHeight },
    rampGradeLabel: `representative ~1:${(1 / (ramp.grade || 1)).toFixed(1)} grade (guide documents a rear-centre ` +
      `ramp; height and grade are photo-informed estimates)`
  };
}

// The mast arrangement from the primary photos: SIX front/perimeter masts fanned across the open front side, plus two
// rear supports to carry the membrane back. The exact total is not established by the source; this is representative.
function stageMasts(f, deck, E) {
  const masts = [];
  const inset = RING_INSET;
  // six front masts along the +v (front) edge, fanned from frontArcStart..frontArcEnd of that edge
  const uFront0 = f.u0 + inset + (f.u1 - f.u0 - 2 * inset) * (0.5 + E.frontArcStart * 0.5);
  const uFront1 = f.u0 + inset + (f.u1 - f.u0 - 2 * inset) * (0.5 + E.frontArcEnd * 0.5);
  for (let i = 0; i < E.frontMasts; i++) {
    const t = E.frontMasts === 1 ? 0.5 : i / (E.frontMasts - 1);
    masts.push({ u: uFront0 + (uFront1 - uFront0) * t, v: f.v1 - inset, front: true });
  }
  // two rear masts behind the deck (at the rear third) to carry the back of the membrane
  for (let i = 0; i < E.backMasts; i++) {
    const t = E.backMasts === 1 ? 0.5 : i / (E.backMasts - 1);
    masts.push({ u: f.u0 + inset + (f.u1 - f.u0 - 2 * inset) * (0.28 + 0.44 * t), v: f.v0 + inset + 0.6, front: false });
  }
  return masts.map((m) => {
    const [x, z] = concertStageLocalToWorld(f, m.u, m.v);
    return { x, z, front: m.front };
  });
}

// Fixed seat block on the flat deck (dark, with backs), two clear aisles. Row pitch exceeds the seat depth so chairs do
// not intersect; every seat sits on the deck top (no floating). Every seat is one instance, not one object.
function seatRows(deck, E) {
  const seats = [];
  const len = deck.u1 - deck.u0 - 1.6;
  if (!(len > 3)) return seats;
  const rows = Math.min(E.seatRows, Math.max(1, Math.floor((deck.v1 - deck.v0 - 1.4) / E.rowPitch)));
  const sections = E.aisleCount + 1, aisleW = 1.1;
  const sectionW = (len - aisleW * E.aisleCount) / sections;
  const perSection = Math.max(1, Math.floor(sectionW / (E.seatWidth + 0.05)));
  for (let r = 0; r < rows; r++) {
    const v = deck.v0 + 1.0 + r * E.rowPitch;
    for (let s = 0; s < sections; s++) {
      const su0 = deck.u0 + 0.8 + s * (sectionW + aisleW);
      for (let k = 0; k < E.seatsPerRow && k < perSection; k++) {
        seats.push({ u: su0 + (k + 0.5) * (sectionW / perSection), v, row: r });
      }
    }
  }
  return seats;
}

// --------------------------------------------------------------------------------------------------------------------
// The movement footing: the ONLY walkable raised surface this module owns. It is the exact rendered deck + ramp plan,
// not a bounding rectangle. A point outside returns null (ground); inside, its actual top height is returned, gated by
// the reachable-step rule from `baseY` so the walker can only step up a small rise at a time.
//   C.concertStageSurfaceAt(x, z, { baseY = 0, maxRise = STAGE_ESTIMATES.reachableRise })
// Active only after a successful build on the SAME GEO the build used (guard below).
function concertStageSurfaceAt(x, z, opts = {}) {
  const R = C.waterfrontConcertStage;
  if (!R || !R.active || !R.surface || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  // bound to the GEO the build used: a stale/other frame never reports this stage's footing
  if (!C.waterfrontConcertStageActiveGeo || C.GEO !== C.waterfrontConcertStageActiveGeo) return null;
  const baseY = Number.isFinite(opts.baseY) ? opts.baseY : 0;
  const maxRise = Number.isFinite(opts.maxRise) ? opts.maxRise : STAGE_ESTIMATES.reachableRise;
  return R.surface(x, z, baseY, maxRise);
}

// The surface function bound to a built layout: returns { h, id } for the deck or ramp, null otherwise.
function makeSurface(layout) {
  const f = layout.frame, d = layout.deck, r = layout.ramp;
  const EPS = 0.02; // a hair of plan tolerance so the foot of the ramp has no one-frame seam gap
  // (the deck's and ramp's plan corners in world space, once per layout: a query away from the stage stops at this box;
  // deckHeightAt and deckStoodOn ask it for every body, anywhere in the city, st-s1y8)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [u0, u1, v0, v1] of [[r.u0, r.u1, r.vBottom, r.vTop], [d.u0, d.u1, d.v0, d.v1]]) {
    for (const [u, v] of [[u0 - EPS, v0 - EPS], [u1 + EPS, v0 - EPS], [u0 - EPS, v1 + EPS], [u1 + EPS, v1 + EPS]]) {
      const [wx, wz] = concertStageLocalToWorld(f, u, v);
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx); minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
    }
  }
  minX -= 1e-6; maxX += 1e-6; minZ -= 1e-6; maxZ += 1e-6;
  return (x, z, baseY, maxRise) => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return null;
    const [u, v] = concertStageWorldToLocal(f, x, z);
    let top = null;
    // ramp plan first (graded from the deck's rear edge down to the ground): the walker rises onto the deck
    if (u >= r.u0 - EPS && u <= r.u1 + EPS && v >= r.vBottom - EPS && v <= r.vTop + EPS) {
      const t = (v - r.vBottom) / (r.vTop - r.vBottom || 1);
      top = r.bottomY + (r.topY - r.bottomY) * Math.max(0, Math.min(1, t));
    } else if (u >= d.u0 - EPS && u <= d.u1 + EPS && v >= d.v0 - EPS && v <= d.v1 + EPS) {
      top = d.lift; // the raised deck plan
    }
    if (top === null) return null;
    if (top - baseY > maxRise) return null; // not reachable as a single step from here
    return { h: top, id: 'waterfront-concert-stage-deck', pedestrianOnly: true };
  };
}

// --------------------------------------------------------------------------------------------------------------------
// Build
function standardMaterial(THREE, params) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat(params);
}
function pushTri(out, a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
function pushQuad(out, a, b, c, d) { pushTri(out, a, b, c); pushTri(out, a, c, d); }
function basisFromDir(primary, len) {
  // orthonormal basis with its local +primary axis along `primary` (used to aim struts/cables/seat backs)
  const yAx = [primary[0], primary[1], primary[2]];
  const helper = Math.abs(yAx[1]) < 0.94 ? [0, 1, 0] : [1, 0, 0];
  let xAx = [yAx[1] * helper[2] - yAx[2] * helper[1], yAx[2] * helper[0] - yAx[0] * helper[2], yAx[0] * helper[1] - yAx[1] * helper[0]];
  const xl = Math.hypot(xAx[0], xAx[1], xAx[2]) || 1;
  xAx = [xAx[0] / xl, xAx[1] / xl, xAx[2] / xl];
  const zAx = [xAx[1] * yAx[2] - xAx[2] * yAx[1], xAx[2] * yAx[0] - xAx[0] * yAx[2], xAx[0] * yAx[1] - xAx[1] * yAx[0]];
  return { x: xAx, y: yAx, z: zAx };
}

function mergedMesh(THREE, positions, material, name, role, opts = {}) {
  if (!positions.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.castShadow = opts.castShadow !== false;
  mesh.receiveShadow = opts.receiveShadow !== false;
  mesh.userData.cullDistance = opts.cullDistance ?? 700;
  mesh.userData.cullCell = opts.cullCell ?? 120;
  mesh.userData.role = role;
  return mesh;
}

function makeInstanced(THREE, geometry, material, items, name, role, opts = {}) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  mesh.name = name;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const p = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.basis) {
      m.makeBasis(new THREE.Vector3(...it.basis.x), new THREE.Vector3(...it.basis.y), new THREE.Vector3(...it.basis.z));
      q.setFromRotationMatrix(m);
    } else {
      e.set(it.rx || 0, it.ry || 0, it.rz || 0);
      q.setFromEuler(e);
    }
    p.set(it.x, it.y, it.z);
    s.set(it.sx, it.sy, it.sz);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = opts.castShadow !== false;
  mesh.receiveShadow = opts.receiveShadow !== false;
  mesh.userData.cullDistance = opts.cullDistance ?? 700;
  mesh.userData.cullCell = opts.cullCell ?? 120;
  mesh.userData.role = role;
  mesh.computeBoundingSphere();
  return mesh;
}

function perimeterPoint(f, inset, a) {
  const u0 = f.u0 + inset, u1 = f.u1 - inset, v0 = f.v0 + inset, v1 = f.v1 - inset;
  const w = u1 - u0, dd = v1 - v0, per = 2 * (w + dd);
  let t = (((a % 1) + 1) % 1) * per;
  if (t <= w) return [u0 + t, v0];
  if ((t -= w) <= dd) return [u1, v0 + t];
  if ((t -= dd) <= w) return [u1 - t, v1];
  t -= w;
  return [u0, v1 - t];
}

// One scalloped membrane band round the mapped rectangle; never rises above ring.top (so the open gap to the roof holds).
function ringBand(layout, outerInset, innerInset, outerY, innerY, segments, pleatCount) {
  const f = layout.frame;
  const scallop = (a) => (pleatCount ? 0.5 + 0.5 * Math.cos(a * pleatCount * Math.PI * 2) : 1);
  const out = [];
  for (let s = 0; s < segments; s++) {
    const a0 = s / segments, a1 = (s + 1) / segments;
    const O0 = concertStageLocalToWorld(f, ...perimeterPoint(f, outerInset, a0));
    const O1 = concertStageLocalToWorld(f, ...perimeterPoint(f, outerInset, a1));
    const I0 = concertStageLocalToWorld(f, ...perimeterPoint(f, innerInset, a0));
    const I1 = concertStageLocalToWorld(f, ...perimeterPoint(f, innerInset, a1));
    const a = [O0[0], Math.max(innerY, outerY - scallop(a0) * 0.3), O0[1]];
    const b = [O1[0], Math.max(innerY, outerY - scallop(a1) * 0.3), O1[1]];
    const c = [I1[0], innerY, I1[1]];
    const d = [I0[0], innerY, I0[1]];
    pushQuad(out, a, b, c, d);
    pushQuad(out, a, d, c, b);
  }
  return out;
}

// The shallow arched, slightly domed central roof membrane (one merged, two-sided surface).
function roofMembrane(layout) {
  const f = layout.frame, R = layout.roof, nu = 12, nv = 10, out = [];
  const sample = (iu, iv) => {
    const u = R.u0 + (R.u1 - R.u0) * iu, v = R.v0 + (R.v1 - R.v0) * iv;
    const dome = Math.sin(Math.PI * iu) * Math.sin(Math.PI * iv);
    return concertStagePoint3(f, u, v, R.top + R.rise * dome);
  };
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = sample(i / nu, j / nv), b = sample((i + 1) / nu, j / nv);
    const c = sample((i + 1) / nu, (j + 1) / nv), d = sample(i / nu, (j + 1) / nv);
    pushTri(out, a, b, c); pushTri(out, a, c, d);
    pushTri(out, a, c, b); pushTri(out, a, d, c);
  }
  return out;
}

// The open white space-frame: a top chord grid under the roof (diagonals implied by the grid), as aimed boxes.
function trussMembers(layout) {
  const f = layout.frame, R = layout.roof;
  const items = [], nu = 6, nv = 4, t = 0.11;
  const node = (iu, iv) => {
    const u = R.u0 + (R.u1 - R.u0) * iu, v = R.v0 + (R.v1 - R.v0) * iv;
    const dome = Math.sin(Math.PI * iu) * Math.sin(Math.PI * iv);
    return concertStagePoint3(f, u, v, R.top + R.rise * dome);
  };
  const strut = (a, b) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 0.15) return;
    const dir = [d[0] / len, d[1] / len, d[2] / len];
    // basisFromDir aligns the box's local +Y with the member, so the length must be sy (not sx)
    items.push({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2, sx: t, sy: len, sz: t, basis: basisFromDir(dir) });
  };
  for (let iv = 0; iv <= nv; iv++) for (let iu = 0; iu < nu; iu++) strut(node(iu / nu, iv / nv), node((iu + 1) / nu, iv / nv));
  for (let iu = 0; iu <= nu; iu++) for (let iv = 0; iv < nv; iv++) strut(node(iu / nu, iv / nv), node(iu / nu, (iv + 1) / nv));
  return items;
}

function buildStage(THREE, layout, group, colliders, stats) {
  const f = layout.frame, E = layout.estimates, meshList = [];
  const add = (mesh, role) => { if (mesh) { mesh.userData.role = role; meshList.push(mesh); group.add(mesh); } };
  const doubleSide = THREE.DoubleSide;
  const membraneMat = standardMaterial(THREE, { color: 0x9aa99a, roughness: 0.62, metalness: 0.04, side: doubleSide });
  const ringMat = standardMaterial(THREE, { color: 0xe8e6df, roughness: 0.7, metalness: 0.03, side: doubleSide });
  const trussMat = standardMaterial(THREE, { color: 0xeeeeea, roughness: 0.45, metalness: 0.42 });
  const mastMat = standardMaterial(THREE, { color: 0xf2f1ec, roughness: 0.4, metalness: 0.5 });
  const cableMat = standardMaterial(THREE, { color: 0xb9bbbd, roughness: 0.35, metalness: 0.6 });
  const seatMat = standardMaterial(THREE, { color: 0x24282c, roughness: 0.6, metalness: 0.12 });
  const deckMat = standardMaterial(THREE, { color: 0x8f939a, roughness: 0.82, metalness: 0.05 });
  const wallMat = standardMaterial(THREE, { color: 0xdedbd2, roughness: 0.72, metalness: 0.04 });
  const railMat = standardMaterial(THREE, { color: 0x1d2226, roughness: 0.5, metalness: 0.45 });

  add(mergedMesh(THREE, roofMembrane(layout), membraneMat, 'WaterfrontConcertStage-RoofMembrane', 'roof-membrane',
    { cullDistance: 700 }), 'roof-membrane');
  const rb = layout.ringBand;
  add(mergedMesh(THREE, ringBand(layout, rb.outerInset, rb.innerInset, rb.outerY, rb.innerY,
    E.ringSegments, E.ringPleats), ringMat, 'WaterfrontConcertStage-RingMembrane', 'ring-membrane', { cullDistance: 700 }),
    'ring-membrane');
  const masts = layout.masts;
  const truss = trussMembers(layout);
  add(makeInstanced(THREE, new THREE.BoxGeometry(1, 1, 1), trussMat, truss, 'WaterfrontConcertStage-Truss', 'roof-truss',
    { castShadow: false, cullDistance: 650 }), 'roof-truss');
  stats.trussMembers = truss.length;

  const mastTop = E.mastHeight;
  const mastItems = masts.map((m) => ({ x: m.x, y: mastTop / 2, z: m.z, sx: layout.mastRadius, sy: mastTop, sz: layout.mastRadius }));
  const pennants = masts.map((m) => ({ x: m.x, y: mastTop - 0.25, z: m.z, sx: 0.26, sy: 0.15, sz: 0.7 }));
  add(makeInstanced(THREE, new THREE.CylinderGeometry(1, 1, 1, 8), mastMat, mastItems, 'WaterfrontConcertStage-Masts',
    'perimeter-masts', { cullDistance: 700 }), 'perimeter-masts');
  add(makeInstanced(THREE, new THREE.BoxGeometry(1, 1, 1), mastMat, pennants, 'WaterfrontConcertStage-Pennants',
    'mast-pennants', { castShadow: false, cullDistance: 700 }), 'mast-pennants');

  // fine stays from every mast tip to the nearest roof edge point and down to the ring apex (no new ground anchor)
  const cables = [];
  const R = layout.roof;
  const roofEdge = [
    concertStagePoint3(f, R.u0, R.v0, R.top), concertStagePoint3(f, R.u1, R.v0, R.top),
    concertStagePoint3(f, R.u1, R.v1, R.top), concertStagePoint3(f, R.u0, R.v1, R.top)
  ];
  for (let i = 0; i < masts.length; i++) {
    const m = masts[i], top = [m.x, mastTop - 0.4, m.z];
    addStay(cables, top, roofEdge[i % roofEdge.length]);
    const [ax, az] = concertStageLocalToWorld(f, ...perimeterPoint(f, RING_INSET, (i + 0.5) / masts.length));
    addStay(cables, top, [ax, layout.ring.top, az]);
  }
  add(makeInstanced(THREE, new THREE.BoxGeometry(1, 1, 1), cableMat, cables, 'WaterfrontConcertStage-Cables',
    'tension-cables', { castShadow: false, cullDistance: 650 }), 'tension-cables');
  stats.cables = cables.length;

  // the raised deck slab (exact rendered plan) — walkable via concertStageSurfaceAt
  const deckItems = deckSlabs(layout);
  add(makeInstanced(THREE, new THREE.BoxGeometry(1, 1, 1), deckMat, deckItems, 'WaterfrontConcertStage-Deck', 'raised-deck',
    { castShadow: false, cullDistance: 700 }), 'raised-deck');
  // the graded ramp wedge from the deck's rear edge down to the ground (merged triangles) — its top is walkable
  add(mergedMesh(THREE, rampWedge(layout), deckMat, 'WaterfrontConcertStage-Ramp', 'rear-ramp',
    { castShadow: false, cullDistance: 700 }), 'rear-ramp');

  // dark fixed seats WITH BACKS: seat pan + back per seat, one InstancedMesh (recognizable seating, not loose cubes)
  const seatItems = seatGeometry(layout);
  add(makeInstanced(THREE, seatGeometryUnit(THREE, E), seatMat, seatItems, 'WaterfrontConcertStage-Seats', 'fixed-seats',
    { castShadow: false, cullDistance: 600 }), 'fixed-seats');
  stats.seats = layout.seats.length;
  stats.seatRows = Math.max(0, ...layout.seats.map((s) => s.row + 1));

  const wallOut = [], railOut = [];
  buildPerimeter(layout, wallOut, railOut);
  add(mergedMesh(THREE, wallOut, wallMat, 'WaterfrontConcertStage-Wall', 'perimeter-wall', { cullDistance: 700 }), 'perimeter-wall');
  add(mergedMesh(THREE, railOut, railMat, 'WaterfrontConcertStage-Guardrail', 'guardrail', { castShadow: false, cullDistance: 650 }), 'guardrail');

  // ---------------------------------------------------------------- colliders (native, thin, height-bounded)
  // slim posts per mast
  for (const m of masts) {
    const r = Math.max(0.12, layout.mastRadius);
    colliders.push({ minX: m.x - r, maxX: m.x + r, minZ: m.z - r, maxZ: m.z + r, minY: GROUND, maxY: mastTop,
      prop: true, kind: 'concert-stage-mast', obb: { cx: m.x, cz: m.z, hx: r, hz: r, cs: 1, sn: 0 } });
  }
  // Height-bounded canopy proxy: cameras cannot pass through the roof, while
  // pedestrians retain the open space beneath it. The shallow arch is bounded
  // conservatively by its spring and crown, independently of the floor sampler.
  {
    const r = layout.roof;
    const [cx, cz] = concertStageLocalToWorld(f, (r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2);
    const hx = (r.u1 - r.u0) / 2, hz = (r.v1 - r.v0) / 2;
    const cs = Math.cos(f.ang), sn = Math.sin(f.ang);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez,
      minY: r.top - 0.15, maxY: r.top + r.rise + 0.05, prop: true, kind: 'concert-stage-roof',
      obb: { cx, cz, hx, hz, cs, sn } });
  }
  // low perimeter wall segments, height-bounded to the wall top (skips the rear gap and side walks)
  for (const seg of perimeterSegments(layout)) {
    const [a, b] = [concertStageLocalToWorld(f, seg.a[0], seg.a[1]), concertStageLocalToWorld(f, seg.b[0], seg.b[1])];
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 0.3) continue;
    const yaw = Math.atan2(dx, dz), cs = Math.cos(yaw), sn = Math.sin(yaw), hx = 0.12, hz = len / 2;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: GROUND, maxY: GROUND + E.wallHeight,
      prop: true, kind: 'concert-stage-wall', obb: { cx, cz, hx, hz, cs, sn } });
  }
  // The raised deck is NOT a solid collider: it is a walkable surface (concertStageSurfaceAt) reachable by the ramp, so
  // the walker's ground height rises onto it instead of being blocked or falling through.

  stats.meshes = meshList.length;
  stats.mastCount = masts.length;
  stats.deckTop = layout.deck.lift;
  stats.roofTop = layout.roof.top;
  stats.ringTop = layout.ring.top;
  stats.mastTop = mastTop;
  return meshList;
}

function addStay(list, top, bottom) {
  const d = [bottom[0] - top[0], bottom[1] - top[1], bottom[2] - top[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 0.4) return;
  list.push({ x: (top[0] + bottom[0]) / 2, y: (top[1] + bottom[1]) / 2, z: (top[2] + bottom[2]) / 2, sx: 0.05, sy: len, sz: 0.05,
    basis: basisFromDir([d[0] / len, d[1] / len, d[2] / len]) });
}

// The deck slab as one world-space box turned with the row frame (exactly the walkable deck plan). The city's box
// convention is ry = +ang (world = (cx + u·cos + v·sin, cz − u·sin + v·cos)), so the deck uses +f.ang like every other
// native box; the sampler's deck plan is the same rectangle.
function deckSlabs(layout) {
  const f = layout.frame, d = layout.deck;
  const [x, z] = concertStageLocalToWorld(f, (d.u0 + d.u1) / 2, (d.v0 + d.v1) / 2);
  return [{ x, y: d.lift / 2, z, sx: d.u1 - d.u0, sy: d.lift, sz: d.v1 - d.v0, ry: f.ang }];
}

// The rear ramp as a solid wedge (top surface graded from the deck rear edge down to the ground), world triangles.
function rampWedge(layout) {
  const f = layout.frame, r = layout.ramp;
  const out = [];
  const P = (u, v, y) => concertStagePoint3(f, u, v, y);
  const tA = P(r.u0, r.vTop, r.topY), tB = P(r.u1, r.vTop, r.topY);
  const bA = P(r.u0, r.vBottom, r.bottomY), bB = P(r.u1, r.vBottom, r.bottomY);
  const gA = P(r.u0, r.vTop, r.bottomY), gB = P(r.u1, r.vTop, r.bottomY);
  // inclined top (two triangles, both faces)
  pushTri(out, tA, tB, bB); pushTri(out, tA, bB, bA);
  pushTri(out, tA, bB, tB); pushTri(out, tA, bA, bB);
  // rear vertical face under the deck edge
  pushQuad(out, gA, gB, tB, tA);
  pushQuad(out, gA, tA, tB, gB);
  // side walls
  pushTri(out, tA, bA, gA); pushTri(out, tA, gA, bA);
  pushTri(out, tB, gB, bB); pushTri(out, tB, bB, gB);
  return out;
}

// A real-size seat unit: a pan and a back (merged once, then instanced) so seats read as chairs with backs. Built with
// its base at y = 0 and the back at local −z (the rear), so an instance placed at the deck top rests on the floor.
function seatGeometryUnit(THREE, E) {
  const pan = new THREE.BoxGeometry(E.seatWidth, 0.12, E.seatDepth);
  pan.translate(0, 0.06, 0);
  const back = new THREE.BoxGeometry(E.seatWidth, E.seatBack, 0.1);
  back.translate(0, 0.06 + E.seatBack / 2, -E.seatDepth / 2 + 0.05);
  const merged = mergeGeometry(THREE, [pan, back]);
  pan.dispose(); back.dispose();
  return merged;
}
function mergeGeometry(THREE, geos) {
  const positions = [];
  for (const g of geos) {
    const n = g.index ? g.toNonIndexed() : g;
    const arr = n.attributes.position.array;
    for (let i = 0; i < arr.length; i++) positions.push(arr[i]);
    if (n !== g) n.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}
// seat instance transforms: the real-size unit (base at y=0) placed on the deck top, turned with the row frame (+f.ang)
// so the back sits at the rear (−v) and the seat faces the stage (+v front).
function seatGeometry(layout) {
  const f = layout.frame;
  return layout.seats.map((s) => {
    const [x, z] = concertStageLocalToWorld(f, s.u, s.v);
    return { x, y: layout.deck.lift, z, sx: 1, sy: 1, sz: 1, ry: f.ang };
  });
}

function perimeterSegments(layout) {
  const f = layout.frame, d = layout.deck, g = layout.rearGap;
  const u0 = f.u0, u1 = f.u1, v0 = f.v0, v1 = f.v1, segs = [];
  if (g.u0 - u0 > 0.3) segs.push({ a: [u0, v0], b: [g.u0, v0] });
  if (u1 - g.u1 > 0.3) segs.push({ a: [g.u1, v0], b: [u1, v0] });
  const sideV0 = Math.max(v0 + 0.2, d.v0 - 0.4), sideV1 = Math.min(v1 - 0.2, d.v1 + 0.4);
  if (sideV1 - sideV0 > 0.3) {
    segs.push({ a: [u0, sideV0], b: [u0, sideV1] });
    segs.push({ a: [u1, sideV0], b: [u1, sideV1] });
  }
  return segs;
}

function buildPerimeter(layout, wallOut, railOut) {
  const f = layout.frame, E = layout.estimates;
  for (const seg of perimeterSegments(layout)) {
    const [ax, az] = concertStageLocalToWorld(f, seg.a[0], seg.a[1]);
    const [bx, bz] = concertStageLocalToWorld(f, seg.b[0], seg.b[1]);
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.2) continue;
    const nx = -dz / len * 0.09, nz = dx / len * 0.09;
    const y0 = GROUND, y1 = GROUND + E.wallHeight, y2 = y1 + E.guardRailHeight;
    const A = [ax + nx, y0, az + nz], B = [bx + nx, y0, bz + nz], C = [bx + nx, y1, bz + nz], D = [ax + nx, y1, az + nz];
    const A2 = [ax - nx, y0, az - nz], B2 = [bx - nx, y0, bz - nz], C2 = [bx - nx, y1, bz - nz], D2 = [ax - nx, y1, az - nz];
    pushQuad(wallOut, A, B, C, D); pushQuad(wallOut, D2, C2, B2, A2); pushQuad(wallOut, D, C, C2, D2);
    const RA = [ax + nx, y1, az + nz], RB = [bx + nx, y1, bz + nz], RC = [bx + nx, y2, bz + nz], RD = [ax + nx, y2, az + nz];
    const RA2 = [ax - nx, y1, az - nz], RB2 = [bx - nx, y1, bz - nz], RC2 = [bx - nx, y2, bz - nz], RD2 = [ax - nx, y2, az - nz];
    pushQuad(railOut, RA, RB, RC, RD); pushQuad(railOut, RD2, RC2, RB2, RA2);
  }
}

// --------------------------------------------------------------------------------------------------------------------
// Success-gated state, bound to the GEO a build actually used. Any skip/failure/rebuild clears the previous success
// (exclusion + surface), so the same row index can never be suppressed in a different frame.
function clearSuccess() {
  if (!C) return;
  C.waterfrontConcertStageActiveGeo = null;
  C.waterfrontConcertStageExcludedRows = new Set();
  C.waterfrontConcertStageExcludesBuilding = () => false;
  if (C.waterfrontConcertStage) C.waterfrontConcertStage.active = false;
  C.waterfrontConcertStageSurfaceAt = concertStageSurfaceAt;
}

function createWaterfrontConcertStage(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-concert-stage: THREE is required');
  clearSuccess(); // any prior success does not survive a new build attempt
  const geo = C?.GEO;
  const layout = concertStageLayout(geo);
  if (!layout || !concertStageEnabled() || !waterfrontConcertStageSupported(geo)) {
    if (C) C.waterfrontConcertStageEnabled = false;
    console.info('[waterfrontConcertStage] skipped: the active city frame does not carry the mapped Concert Stage row');
    return null;
  }
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const group = new THREE.Group();
  group.name = 'WaterfrontConcertStage';
  const colliders = [];
  const stats = { colliders: 0, triangles: 0, seats: 0, seatRows: 0, trussMembers: 0, cables: 0, mastCount: 0, meshes: 0,
    deckTop: 0, roofTop: 0, ringTop: 0, mastTop: 0, rowIndex: layout.rowIndex, rampGrade: layout.rampGradeLabel,
    identity: layout.identity, estimates: layout.estimates };
  try {
    buildStage(THREE, layout, group, colliders, stats);
  } catch (err) {
    console.error('[waterfrontConcertStage] build failed:', err && err.message ? err.message : err);
    group.clear();
    colliders.length = 0;
    stats.meshes = 0;
    stats.buildError = err && err.message ? err.message : String(err);
  }
  let triangles = 0;
  for (const mesh of group.children) {
    const g = mesh.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    triangles += tris * (mesh.isInstancedMesh ? mesh.count : 1);
  }
  stats.triangles = Math.round(triangles);
  stats.colliders = colliders.length;
  group.userData.waterfrontConcertStage = stats;
  if (scene && scene.add) scene.add(group);
  const surface = makeSurface(layout);
  const result = { group, root: group, colliders, stats, layout, surface, active: !stats.buildError && stats.meshes > 0 };
  C.waterfrontConcertStage = result;
  C.waterfrontConcertStageLayout = layout;
  C.waterfrontConcertStageSurfaceAt = concertStageSurfaceAt;

  if (result.active) {
    // success: bind the exclusion + surface to THIS GEO, and mark the row drawn only here
    const bi = layout.rowIndex;
    C.waterfrontConcertStageActiveGeo = geo;
    C.waterfrontConcertStageExcludedRows = new Set([bi]);
    C.waterfrontConcertStageExcludesBuilding = (index, G = C?.GEO) => {
      if (!C.waterfrontConcertStageActiveGeo || G !== C.waterfrontConcertStageActiveGeo) return false;
      return index === bi;
    };
    stats.ms = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10;
    console.info(`[waterfrontConcertStage] Concert Stage (row ${bi}, ${layout.identity.cx}, ${layout.identity.cz}): ` +
      `open canopy + ${stats.mastCount} masts + ${stats.trussMembers} truss + ${stats.cables} stays, ` +
      `${stats.seatRows} seat rows (${stats.seats} seats), ramp + deck surface, ${stats.meshes} meshes, ` +
      `${stats.triangles} triangles, ${stats.colliders} colliders, ${stats.ms} ms`);
  }
  return result;
}

// Defaults for the captain's loader before any build runs.
if (C) {
  if (typeof C.waterfrontConcertStageExcludesBuilding !== 'function') C.waterfrontConcertStageExcludesBuilding = () => false;
  if (typeof C.concertStageSurfaceAt !== 'function') C.concertStageSurfaceAt = concertStageSurfaceAt;
}

Object.assign(C || (window.CITY = {}), {
  CONCERT_STAGE,
  STAGE_ESTIMATES,
  concertStageRow,
  concertStageLayout,
  concertStageFootprint,
  concertStagePartBox,
  concertStageLocalToWorld,
  concertStageWorldToLocal,
  waterfrontConcertStageSupported,
  concertStageSurfaceAt,
  createWaterfrontConcertStage
});
})();
