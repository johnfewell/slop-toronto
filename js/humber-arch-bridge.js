(function () {
// js/humber-arch-bridge.js
// The Humber Bay Arch Bridge (Montgomery Sisam Architects with Delcan, 1994): the Martin Goodman Trail over the mouth of
// the Humber, built procedurally on its OpenStreetMap line (city-config.js TRAIL_BRIDGES, way 33398082). What is known
// of it (Wikipedia; Terri Meyer Boake's notes from Advantage Steel):
// - twin arches of 1.2 m high-strength steel pipe bent to a parabola, 21.3 m high over a 100 m clear span, wide apart
//   at their feet and close at the crown (the "basket handle"), painted white;
// - steel cross bracing between them, its cut-outs a Thunderbird, in two stretches with none at the centre;
// - a tied arch (the soft ground takes no thrust): the deck, a concrete slab on a central spine and 22 tapered floor
//   beams, each hung by a 50 mm stainless hanger at either end (44); stainless railings;
// - concrete abutments on caissons, their panels carved with turtles & canoes (left plain here).
// The deck carries the trail's red asphalt & dashed yellow centre line; city-config.js makes it a surface to walk & ride.
// Built in the bridge's own frame (s along it from its east end, y up, l across to its left) and placed in one matrix.

const C = window.CITY;
const { THREE } = C;

const WHITE = 0xecebe6; // the arches & bracing
const STEEL = 0xb9bdc0; // stainless hangers & railings
const CONCRETE = 0xb3ada2; // (city-grid.js's flyovers)
const TRAIL_RED = 0x70281f; // (cycling.js: the Martin Goodman Trail's red-brown asphalt)
const LINE_YELLOW = 0xd9b13a;

// The arch: its centre line at u (0..1 from the east springing), side ±1
function archFrame(t, side) {
  const yBase = 0.5, crown = t.rise + C.CITY_BOUNDS.sidewalkHeight;
  const lBase = t.w / 2 + 3.6, lTop = t.w / 2 + 0.2; // (the basket handle: 6.2 m out at the feet, 2.8 at the crown)
  return (u) => {
    const f = 4 * u * (1 - u);
    const y = yBase + (crown - yBase) * f;
    return new THREE.Vector3(t.s0 + (t.s1 - t.s0) * u, y, side * (lBase + (lTop - lBase) * f));
  };
}

// A cylinder (r) from p to q, as a non-indexed geometry
const Y = new THREE.Vector3(0, 1, 0);
function rod(p, q, r, radial = 6) {
  const d = new THREE.Vector3().subVectors(q, p), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, radial, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()));
  g.translate((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2);
  return g.toNonIndexed();
}
// A box centred at (s, y, l), sizes along s, y & l
function box(s, y, l, ds, dy, dl) {
  const g = new THREE.BoxGeometry(ds, dy, dl);
  g.translate(s, y, l);
  return g.toNonIndexed();
}

// Quads facing n (wound counter-clockwise seen from that side), with world-ish uvs
function makeQuads() {
  const pos = [], nor = [], uv = [];
  const quad = (p0, p1, p2, p3, n) => {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const facing = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    const order = facing >= 0 ? [p0, p1, p2, p0, p2, p3] : [p0, p2, p1, p0, p3, p2];
    for (const p of order) { pos.push(...p); nor.push(...n); uv.push(p[0] / 4, (p[1] + p[2]) / 4); }
  };
  const geometry = () => {
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  };
  return { quad, geometry };
}

function buildArchBridge(t) {
  const parts = { white: [], steel: [], concrete: [], red: [], yellow: [] };
  const top = (s) => t.heightAt(s);
  const SLAB = 0.45;
  const inSpan = (s) => s > t.wet[0] - 1 && s < t.wet[1] + 1;

  // --- The deck: the slab (its top the trail's surface), its edges & underside; solid down to the ground on the banks
  {
    const red = makeQuads(), conc = makeQuads(), yel = makeQuads();
    const half = t.w / 2, th = t.trailW / 2;
    const step = 1;
    for (let s = 0; s < t.L - 1e-6; s += step) {
      const s2 = Math.min(t.L, s + step), y1 = top(s), y2 = top(s2);
      const b1 = inSpan(s) ? y1 - SLAB : -0.3, b2 = inSpan(s2) ? y2 - SLAB : -0.3;
      // the trail's red asphalt between concrete edge strips
      red.quad([s, y1, -th], [s2, y2, -th], [s2, y2, th], [s, y1, th], [0, 1, 0]);
      conc.quad([s, y1, th], [s2, y2, th], [s2, y2, half], [s, y1, half], [0, 1, 0]);
      conc.quad([s, y1, -half], [s2, y2, -half], [s2, y2, -th], [s, y1, -th], [0, 1, 0]);
      // the slab's faces (a fascia lip 0.1 m proud of the edge strips) & underside
      for (const side of [-1, 1]) conc.quad([s, b1, side * half], [s2, b2, side * half], [s2, y2 + 0.08, side * half], [s, y1 + 0.08, side * half], [0, 0, side]);
      for (const side of [-1, 1]) conc.quad([s, y1 + 0.08, side * (half - 0.15)], [s2, y2 + 0.08, side * (half - 0.15)], [s2, y2 + 0.08, side * half], [s, y1 + 0.08, side * half], [0, 1, 0]);
      conc.quad([s, b1, -half], [s2, b2, -half], [s2, b2, half], [s, b1, half], [0, -1, 0]);
    }
    // the ends
    for (const [s, n] of [[0, -1], [t.L, 1]]) conc.quad([s, -0.3, -half], [s, -0.3, half], [s, top(s), half], [s, top(s), -half], [n, 0, 0]);
    // the dashed yellow centre line (3 m dashes, 3 m gaps)
    for (let s = 1; s + 3 <= t.L - 1; s += 6) yel.quad([s, top(s) + 0.012, -0.06], [s + 3, top(s + 3) + 0.012, -0.06], [s + 3, top(s + 3) + 0.012, 0.06], [s, top(s) + 0.012, 0.06], [0, 1, 0]);
    parts.red.push(red.geometry());
    parts.concrete.push(conc.geometry());
    parts.yellow.push(yel.geometry());
  }

  // --- Under the deck over the water: the central spine & the 22 tapered floor beams, out past the edges to the hangers
  const beams = 22, hangerL = t.w / 2 + 0.35;
  {
    const spine = makeQuads();
    const s0 = t.wet[0] - 1, s1 = t.wet[1] + 1;
    for (let s = s0; s < s1 - 1e-6; s += 1) {
      const s2 = Math.min(s1, s + 1), y1 = top(s) - SLAB, y2 = top(s2) - SLAB;
      for (const side of [-1, 1]) spine.quad([s, y1 - 0.7, side * 0.6], [s2, y2 - 0.7, side * 0.6], [s2, y2, side * 0.6], [s, y1, side * 0.6], [0, 0, side]);
      spine.quad([s, y1 - 0.7, -0.6], [s2, y2 - 0.7, -0.6], [s2, y2 - 0.7, 0.6], [s, y1 - 0.7, 0.6], [0, -1, 0]);
    }
    parts.concrete.push(spine.geometry());
  }
  const stations = [];
  for (let k = 0; k < beams; k++) {
    const u = (k + 1) / (beams + 1), s = t.s0 + (t.s1 - t.s0) * u;
    stations.push({ u, s });
    const yb = top(s) - SLAB;
    // tapered: deep at the spine, shallow at the ends (two boxes stepping down)
    parts.white.push(box(s, yb - 0.3, 0, 0.35, 0.6, 2.4));
    parts.white.push(box(s, yb - 0.15, 0, 0.3, 0.3, hangerL * 2 + 0.3));
  }

  // --- The twin arches, the hangers, the Thunderbird bracing and the arches' feet
  const arch = [archFrame(t, -1), archFrame(t, 1)];
  for (const A of arch) {
    const pts = [];
    for (let i = 0; i <= 64; i++) pts.push(A(i / 64));
    // (a little into the feet, so the pipe meets its plinth)
    pts[0] = pts[0].clone().add(new THREE.Vector3(-0.3, -0.4, 0));
    pts[64] = pts[64].clone().add(new THREE.Vector3(0.3, -0.4, 0));
    parts.white.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.6, 14, false).toNonIndexed());
  }
  for (const { u, s } of stations) {
    for (const [side, A] of [[-1, arch[0]], [1, arch[1]]]) {
      const p = A(u);
      const foot = new THREE.Vector3(s, top(s) - SLAB - 0.1, side * hangerL);
      parts.steel.push(rod(foot, new THREE.Vector3(p.x, p.y - 0.55, p.z - side * 0.05), 0.06, 5));
    }
  }
  // the bracing: struts across between the arches and a zigzag of diagonals, over two stretches either side of the crown
  for (const [u0, u1] of [[0.2, 0.4], [0.6, 0.8]]) {
    const n = 5;
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const u = u0 + ((u1 - u0) * i) / n;
      const L = arch[0](u), R = arch[1](u);
      // (a little below the pipes' centres, between their inner faces)
      const l = L.clone().add(new THREE.Vector3(0, -0.1, 0.5)), r = R.clone().add(new THREE.Vector3(0, -0.1, -0.5));
      parts.white.push(rod(l, r, 0.2, 8));
      if (prev) parts.white.push(rod(i % 2 ? prev.l : prev.r, i % 2 ? r : l, 0.14, 6));
      // the Thunderbird's wings: short raking struts from mid-strut up to each pipe
      const m = l.clone().lerp(r, 0.5).add(new THREE.Vector3(0, 0.6, 0));
      if (i > 0 && i < n) { parts.white.push(rod(m, l.clone().lerp(r, 0.15), 0.1, 6)); parts.white.push(rod(m, l.clone().lerp(r, 0.85), 0.1, 6)); }
      prev = { l, r };
    }
  }
  // the arches' feet: concrete plinths on the banks
  for (const u of [0, 1]) for (const A of arch) {
    const p = A(u);
    parts.concrete.push(box(p.x + (u ? 0.6 : -0.6), 0.1, p.z, 3.6, 1.2, 2.8));
  }
  // the abutments at the water's edge: walls across under the deck, from the river's bed to the slab
  for (const [s, dir] of [[t.wet[0] - 1, -1], [t.wet[1] + 1, 1]]) {
    const y = top(s) - SLAB;
    parts.concrete.push(box(s + dir * 1.2, (y - 3) / 2, 0, 2.4, y + 3, t.w + 1.2));
  }

  // --- The railings: stainless posts every 2 m, a top rail & two rails between, 1.2 m (a bicycle's height), each side
  {
    const rail = (l) => {
      for (let s = 0.3; s <= t.L - 0.3; s += 2) parts.steel.push(box(s, top(s) + 0.6, l, 0.06, 1.2, 0.06));
      for (const h of [1.2, 0.75, 0.35]) {
        for (let s = 0.3; s < t.L - 0.3 - 1e-6; s += 4) {
          const s2 = Math.min(t.L - 0.3, s + 4);
          parts.steel.push(rod(new THREE.Vector3(s, top(s) + h, l), new THREE.Vector3(s2, top(s2) + h, l), h === 1.2 ? 0.035 : 0.02, 5));
        }
      }
    };
    rail(t.w / 2 - 0.1);
    rail(-(t.w / 2 - 0.1));
  }

  // --- Into the world: one mesh per material, placed by the bridge's frame
  const frame = new THREE.Matrix4().makeBasis(new THREE.Vector3(t.ux, 0, t.uz), Y, new THREE.Vector3(-t.uz, 0, t.ux)).setPosition(t.a.x, 0, t.a.z);
  const mats = {
    white: new THREE.MeshStandardNodeMaterial({ color: WHITE, roughness: 0.45, metalness: 0.1 }),
    steel: new THREE.MeshStandardNodeMaterial({ color: STEEL, roughness: 0.35, metalness: 0.75 }),
    concrete: new THREE.MeshStandardNodeMaterial({ color: CONCRETE, roughness: 0.86 }),
    red: new THREE.MeshStandardNodeMaterial({ color: TRAIL_RED, roughness: 0.9 }),
    yellow: new THREE.MeshStandardNodeMaterial({ color: LINE_YELLOW, roughness: 0.7 })
  };
  const group = new THREE.Group();
  group.name = 'HumberArchBridge';
  let triangles = 0;
  for (const [key, list] of Object.entries(parts)) {
    const geos = list.filter(Boolean).map((g) => { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; });
    if (!geos.length) continue;
    const g = geos.length === 1 ? geos[0] : C.Addons.mergeGeometries(geos, false);
    g.applyMatrix4(frame);
    g.computeBoundingSphere();
    triangles += g.attributes.position.count / 3;
    const m = new THREE.Mesh(g, mats[key]);
    m.name = `HumberArchBridge-${key}`;
    m.castShadow = key !== 'yellow' && key !== 'red';
    m.receiveShadow = true;
    group.add(m);
  }
  // the arches' feet stand in the way on the banks
  const colliders = [];
  const W = C.WorldCollision;
  if (W) {
    for (const u of [0, 1]) for (const A of arch) {
      const p = A(u).applyMatrix4(frame);
      colliders.push(W.circleCollider(p.x, p.z, 1.6, 0, 3, 'bridge'));
    }
  }
  return { group, colliders, triangles };
}

/** The trail bridges (city-config.js TRAIL_BRIDGES) into the scene: { colliders } */
function buildTrailBridges(scene) {
  const colliders = [];
  for (const t of C.TRAIL_BRIDGES || []) {
    const b = buildArchBridge(t);
    scene.add(b.group);
    colliders.push(...b.colliders);
    console.info(`[bridges] ${t.name}: ${t.L.toFixed(0)} m, span ${(t.s1 - t.s0).toFixed(0)} m, ${Math.round(b.triangles)} triangles`);
  }
  return { colliders };
}

Object.assign(window.CITY, { buildTrailBridges, buildArchBridge });
})();
