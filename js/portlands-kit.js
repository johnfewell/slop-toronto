(function () {
'use strict';
// js/portlands-kit.js — the shape kit for the Port Lands pieces (js/portlands-landmarks.js, -bridges.js).
//
// Shapes and placement for the Port Lands set pieces were first worked out in the Canoe Cove rowing world (a sister
// project of this map: its plan came FROM this map, plan metres + [2250, 500] = this map's world metres). The shapes are
// re-written here as plain browser code on this map's own conventions: every part is a non-indexed geometry that carries
// position, normal and a per-vertex colour, written straight into world coordinates, so a whole structure merges into
// one mesh per material. There is no toon material, ink outline or Canoe Cove material library anywhere in here: the
// materials are this map's ordinary lit standard materials (portlandsMaterial below).
const C = window.CITY;

const _m = new C.THREE.Matrix4(), _q = new C.THREE.Quaternion(), _v = new C.THREE.Vector3(), _a = new C.THREE.Vector3(),
  _b = new C.THREE.Vector3(), _s = new C.THREE.Vector3(1, 1, 1), _c = new C.THREE.Color();
const UP = new C.THREE.Vector3(0, 1, 0);

/** Plan metres (Canoe Cove) -> world metres (this map): the plan's origin sits at world [2250, 500] on the same axes. */
const PLAN_ORIGIN = Object.freeze([2250, 500]);
const planToWorld = (x, z) => [x + PLAN_ORIGIN[0], z + PLAN_ORIGIN[1]];

/** A geometry with only position + normal + a flat per-vertex colour, non-indexed. */
function paint(geometry, colour) {
  const T = C.THREE;
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const n = g.getAttribute('position').count;
  const colours = new Array(n * 3);
  _c.set(colour);
  for (let i = 0; i < n; i++) { colours[i * 3] = _c.r; colours[i * 3 + 1] = _c.g; colours[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  if (g !== geometry) geometry.dispose();
  return g;
}

/** A collector of world-space parts, merged once at the end into a single geometry. */
class Parts {
  constructor() { this.list = []; }
  push(g) { this.list.push(g); return g; }
  get empty() { return this.list.length === 0; }
  get triangles() { return this.list.reduce((s, g) => s + g.getAttribute('position').count / 3, 0); }
  merged() {
    if (!this.list.length) return null;
    const out = C.Addons.mergeGeometries(this.list, false);
    if (!out) throw new Error('portlands-kit: could not merge parts');
    for (const g of this.list) g.dispose();
    this.list.length = 0;
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }
}

/** A frame on the ground: origin (x, y, z), +u along `angle` in plan, +w to its side, y up. */
class Frame {
  constructor(x, y, z, angle) { this.x = x; this.y = y; this.z = z; this.angle = angle; this.cos = Math.cos(angle); this.sin = Math.sin(angle); }
  at(u, y, w) { return [this.x + u * this.cos - w * this.sin, this.y + y, this.z + u * this.sin + w * this.cos]; }
  get yaw() { return -this.angle; } // three's rotation.y that turns local +u onto the plan direction
}

function box(f, u, y, w, su, sy, sw, colour, extraYaw = 0) {
  const g = paint(new C.THREE.BoxGeometry(su, sy, sw), colour);
  const [x, yy, z] = f.at(u, y, w);
  _q.setFromAxisAngle(UP, f.yaw + extraYaw);
  _m.compose(_v.set(x, yy, z), _q, _s);
  return g.applyMatrix4(_m);
}
/** A box whose base sits at local y0. */
const block = (f, u, y0, w, su, sy, sw, colour, extraYaw = 0) => box(f, u, y0 + sy / 2, w, su, sy, sw, colour, extraYaw);

/** A square-section bar from world point a to world point b. */
function bar(a, b, side, colour, roll = 0) {
  _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]);
  const length = _a.distanceTo(_b);
  const g = paint(new C.THREE.BoxGeometry(side, Math.max(length, 1e-4), side), colour);
  g.rotateY(roll);
  _v.subVectors(_b, _a).normalize();
  _q.setFromUnitVectors(UP, _v);
  _m.compose(_a.add(_b).multiplyScalar(0.5), _q, _s);
  return g.applyMatrix4(_m);
}

/** A vertical cylinder whose base sits at (x, y0, z). */
function cylinder(x, y0, z, rTop, rBottom, h, colour, segments = 16, openEnded = false) {
  const g = paint(new C.THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, openEnded), colour);
  return g.translate(x, y0 + h / 2, z);
}

function quad(a, b, c, d, colour) {
  const g = new C.THREE.BufferGeometry();
  g.setAttribute('position', new C.THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  g.computeVertexNormals();
  return paint(g, colour);
}
function tri(a, b, c, colour) {
  const g = new C.THREE.BufferGeometry();
  g.setAttribute('position', new C.THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  g.computeVertexNormals();
  return paint(g, colour);
}

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * A square-section lattice member from a to b: four corner chords, a ring of ties every bay, one diagonal per face per
 * bay, and a solid cuff plate every `cuffEvery` bays.
 */
function lattice(parts, a, b, o) {
  const T = C.THREE;
  const axis = new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const length = axis.length();
  axis.normalize();
  const p = new T.Vector3().crossVectors(axis, Math.abs(axis.y) > 0.98 ? new T.Vector3(1, 0, 0) : UP).normalize();
  const q = new T.Vector3().crossVectors(p, axis).normalize();
  const sideAt = (t) => (o.side + ((o.sideTop ?? o.side) - o.side) * t) / 2;
  const corner = (t, k) => {
    const s = sideAt(t), sp = (k === 0 || k === 3 ? -1 : 1) * s, sq = (k < 2 ? -1 : 1) * s;
    return [a[0] + (b[0] - a[0]) * t + p.x * sp + q.x * sq, a[1] + (b[1] - a[1]) * t + p.y * sp + q.y * sq, a[2] + (b[2] - a[2]) * t + p.z * sp + q.z * sq];
  };
  for (let k = 0; k < 4; k++) parts.push(bar(corner(0, k), corner(1, k), o.chord, o.colour));
  for (let i = 0; i <= o.bays; i++) {
    const t = i / o.bays;
    for (let k = 0; k < 4; k++) parts.push(bar(corner(t, k), corner(t, (k + 1) % 4), o.brace, o.colour));
    if (i === o.bays) break;
    const t2 = (i + 1) / o.bays;
    for (let k = 0; k < 4; k++) {
      const flip = (i + k) % 2 === 0;
      parts.push(bar(corner(flip ? t : t2, k), corner(flip ? t2 : t, (k + 1) % 4), o.brace, o.colour));
    }
  }
  if (o.cuffEvery) {
    const basis = new T.Matrix4().makeBasis(p, axis, q);
    for (let i = o.cuffEvery; i < o.bays; i += o.cuffEvery) {
      const t = i / o.bays, centre = lerp3(a, b, t), s = sideAt(t) * 2 + o.chord * 2.2;
      const g = paint(new T.BoxGeometry(s, Math.min(1.4, length / o.bays * 0.45), s), o.cuffColour ?? o.colour);
      g.applyMatrix4(basis);
      g.translate(centre[0], centre[1], centre[2]);
      parts.push(g);
    }
  }
}

/**
 * A skin through `rings` (each the same number of points, a convex section). Edge k joins ring point k to k + 1 and takes
 * colour(k). Normals run smooth along the length and sharp across the section, each face wound away from its ring's
 * centre. Used for the bridge decks and the shell arches.
 */
function loft(parts, rings, colour, o = {}) {
  const T = C.THREE;
  const count = rings[0].length;
  const centres = rings.map((ring) => ring.reduce((s, p) => s.add(p), new T.Vector3()).multiplyScalar(1 / ring.length));
  const quadNormals = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    const row = [];
    for (let k = 0; k < count; k++) {
      const a = rings[i][k], b = rings[i][(k + 1) % count], c = rings[i + 1][(k + 1) % count], d = rings[i + 1][k];
      const n = new T.Vector3().subVectors(c, a).cross(new T.Vector3().subVectors(d, b));
      const mid = new T.Vector3().add(a).add(b).add(c).add(d).multiplyScalar(0.25);
      const out = mid.sub(centres[i].clone().add(centres[i + 1]).multiplyScalar(0.5));
      if (n.dot(out) < 0) n.negate();
      row.push(n.lengthSq() > 1e-12 ? n.normalize() : out.normalize());
    }
    quadNormals.push(row);
  }
  const vn = (i, k) => {
    const n = new T.Vector3();
    if (i > 0) n.add(quadNormals[i - 1][k]);
    if (i < quadNormals.length) n.add(quadNormals[i][k]);
    return n.normalize();
  };
  const pos = [], nor = [], col = [];
  const push = (p, n, c) => { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b); };
  const emit = (a, b, c, na, nb, nc, colr) => { push(a, na, colr); push(b, nb, colr); push(c, nc, colr); };
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < count; k++) {
      const k1 = (k + 1) % count;
      const a = rings[i][k], b = rings[i][k1], c = rings[i + 1][k1], d = rings[i + 1][k];
      const na = vn(i, k), nc = vn(i + 1, k), face = quadNormals[i][k];
      _c.set(colour(k));
      const cc = _c.clone();
      const wound = new T.Vector3().subVectors(b, a).cross(new T.Vector3().subVectors(c, a)).dot(face) >= 0;
      if (wound) { emit(a, b, c, na, na, nc, cc); emit(a, c, d, na, nc, nc, cc); } else { emit(a, c, b, na, nc, na, cc); emit(a, d, c, na, nc, nc, cc); }
    }
  }
  const cap = (ring, centre, outward, colr) => {
    const n = outward.clone().normalize();
    for (let k = 0; k < count; k++) {
      const a = ring[k], b = ring[(k + 1) % count];
      const wound = new T.Vector3().subVectors(a, centre).cross(new T.Vector3().subVectors(b, centre)).dot(n) >= 0;
      if (wound) emit(centre, a, b, n, n, n, colr); else emit(centre, b, a, n, n, n, colr);
    }
  };
  _c.set(colour(0));
  const c0 = _c.clone();
  if (o.capStart && rings.length > 1) cap(rings[0], centres[0], centres[0].clone().sub(centres[1]), c0);
  const last = rings.length - 1;
  if (o.capEnd && rings.length > 1) cap(rings[last], centres[last], centres[last].clone().sub(centres[last - 1]), c0);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  parts.push(g);
}

/**
 * This map's ordinary lit material for a vertex-coloured structure: a MeshStandardNodeMaterial in the same family the
 * other Biidaasige models use (js/biidaasige-heritage.js material()), matte for concrete & stone, a little glossier for
 * painted steel. `kind` is 'stone' | 'steel' | 'leaf'.
 */
const MATERIALS = new Map();
function portlandsMaterial(kind) {
  if (MATERIALS.has(kind)) return MATERIALS.get(kind);
  const T = C.THREE;
  const Mat = T.MeshStandardNodeMaterial || T.MeshStandardMaterial;
  const spec = { stone: { roughness: 0.9, metalness: 0 }, steel: { roughness: 0.62, metalness: 0.04 }, leaf: { roughness: 0.95, metalness: 0, side: T.DoubleSide } }[kind];
  const m = new Mat({ vertexColors: true, color: 0xffffff, ...spec });
  m.name = 'portlands-' + kind;
  MATERIALS.set(kind, m);
  return m;
}

/** A static, shadow-casting mesh for merged parts, tagged for the scene's distance culling (js/scene-culling.js). */
function meshOf(geometry, kind, name, { cullDistance = 700, cullCell = 160, castShadow = true } = {}) {
  const mesh = new C.THREE.Mesh(geometry, portlandsMaterial(kind));
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.userData.cullDistance = cullDistance;
  mesh.userData.cullCell = cullCell;
  return mesh;
}

/** Local frame for a road bridge: x along the deck centre line, z across it; plan <-> world. */
function polylineFrame(pts) {
  const seg = [];
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 0.01) continue;
        seg.push({ a, b, L, s0: s, ux: (b.x - a.x) / L, uz: (b.z - a.z) / L });
    s += L;
  }
  const total = s;
  const at = (x) => {
    const xx = Math.max(0, Math.min(total, x));
    let g = seg[seg.length - 1];
    for (const e of seg) if (xx <= e.s0 + e.L) { g = e; break; }
    const t = xx - g.s0;
    // (local z is the road's own right-hand normal (-uz, ux), as the Canoe Cove bridge frame has it)
    return { x: g.a.x + g.ux * t, z: g.a.z + g.uz * t, nx: -g.uz, nz: g.ux, ux: g.ux, uz: g.uz };
  };
  return { length: total, at, toWorld(x, z) { const p = at(x); return [p.x + p.nx * z, p.z + p.nz * z]; } };
}

Object.assign(C, { PORTLANDS_KIT: { PLAN_ORIGIN, planToWorld, paint, Parts, Frame, box, block, bar, cylinder, quad, tri, lerp3, lattice, loft, portlandsMaterial, meshOf, polylineFrame } });
})();
