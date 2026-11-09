// tools/zoo/rig.mjs: the zoo animals' "rig" without bones (docs/high-park-zoo-animals.md, st-gtnq). For each model,
// fitted by tools/build-zoo-animals.mjs (facing +z, x to its left, on its feet at the origin, metres), smooth per-vertex
// weights for the parts the shader bends (js/high-park-features.js zooAnimMaterial) and the hinges they bend about:
//   neck  the neck and head, bent down about the neck's base (grazing, pecking) and turned about it (looking round)
//   head  the head alone, about the poll (a long neck's head kept level as it bends: llama, emu, peafowl)
//   tail  swished about its root
//   legs  four (birds two) swung from the hips in a walk; codes 1 front left, 2 front right, 3 back left, 4 back right
//   ears  flicked about their base; codes 5 left, 6 right
// The weights ramp over a band at each hinge, so the low-poly skin bends instead of tearing; a separate shell (horns,
// antlers, ears, beaks) bends with the body at its root. The legs are found from the feet: each leg's axis from its
// hoof up to the belly, every vertex below the belly within reach of an axis on that leg.
// The vertex attribute _ZOOA = (neck, head, tail, (code + 0.9 x limb weight) / 8), all 0-1 (quantized to 12 bits in the
// file: the code is read back as floor(8 w + 0.02)).
// pose(): the shader's deformation on the CPU, the same steps in the same order, for the review renders and tests.

// u: along the body, tail 0 to nose 1; h: up, 0-1 of the model's height; dir: degrees from forward (+z), up positive;
// ramp: [start, end] of the weight along dir from the hinge, in fractions of the body's length. graze: the pose's
// angles in degrees (neck down, head up to keep it level, the body pitched forward about the hips: the birds' tip, the
// grazers' shoulder drop, their front legs bending at the top), the neck's most stretch (reach, m) and the muzzle's
// height to reach (to, m; default 6 cm): the grazers' muzzles to the grass
export const RIGS = {
  bison: { neck: { at: [0.68, 0.6], dir: -25, ramp: [0.0, 0.16] }, tail: { at: [0.02, 0.88], dir: -110, ramp: [0.0, 0.02], width: 0.07, amp: 18 },
    graze: { neck: 50, head: 0, pitch: 5, reach: 0.25, to: 0.015 }, gait: { exc: 0.2, lift: 0.08 } },
  // (the Quaternius cattle and stag: their skins' neck and tail joints give the weights, graded along the chain)
  yak: { neck: { at: [0.76, 0.66], bones: true }, tail: { at: [0.02, 0.84], bones: true, amp: 22 },
    graze: { neck: 78, head: 0, pitch: 7, reach: 0.25, to: 0.015 }, gait: { exc: 0.19, lift: 0.08 } },
  highland: { neck: { at: [0.76, 0.66], bones: true }, tail: { at: [0.02, 0.86], bones: true, amp: 22 },
    graze: { neck: 78, head: 0, pitch: 5, reach: 0.25, to: 0.015 }, gait: { exc: 0.17, lift: 0.07 } },
  reindeer: { neck: { at: [0.64, 0.58], bones: true }, tail: { at: [0.03, 0.56], bones: true, amp: 15 },
    graze: { neck: 95, head: 0, pitch: 9, reach: 0.27, to: 0.015 }, gait: { exc: 0.15, lift: 0.06 } },
  llama: { neck: { at: [0.76, 0.5], dir: 70, ramp: [-0.02, 0.2] }, head: { at: [0.86, 0.86], dir: 10, ramp: [0.0, 0.06] },
    tail: { at: [0.03, 0.56], dir: -120, ramp: [0.0, 0.04], width: 0.06, amp: 12 },
    graze: { neck: 115, head: -55, pitch: 0, reach: 0.2 }, ears: { u: [0.82, 0.92], h: [0.94, 1.0], s: 0.15, amp: 25 }, gait: { exc: 0.15, lift: 0.06 } },
  mouflon: { neck: { at: [0.7, 0.55], dir: 40, ramp: [0.0, 0.14] }, tail: { at: [0.06, 0.6], dir: -120, ramp: [0.0, 0.03], width: 0.05, amp: 15 },
    graze: { neck: 78, head: -10, pitch: 6, reach: 0.22, to: 0.015 }, ears: { u: [0.75, 0.8], h: [0.81, 0.87], s: 0.18, amp: 25 }, gait: { exc: 0.12, lift: 0.05 } },
  barbary: { neck: { at: [0.72, 0.58], dir: 35, ramp: [0.0, 0.14] }, tail: { at: [0.03, 0.62], dir: -120, ramp: [0.0, 0.03], width: 0.05, amp: 15 },
    graze: { neck: 75, head: -10, pitch: 6, reach: 0.22, to: 0.015 }, gait: { exc: 0.13, lift: 0.05 } },
  capybara: { neck: { at: [0.7, 0.62], dir: 0, ramp: [0.0, 0.14] }, tail: null,
    graze: { neck: 32, head: 0, pitch: 0, reach: 0.05 }, ears: { u: [0.69, 0.78], h: [0.93, 1.0], s: 0.2, amp: 30 }, gait: { exc: 0.07, lift: 0.03 } },
  emu: { neck: { at: [0.84, 0.6], dir: 70, ramp: [-0.02, 0.12] }, head: { at: [0.94, 0.93], dir: 20, ramp: [0.0, 0.04] }, tail: null,
    graze: { neck: 115, head: -70, pitch: 25, reach: 0.25 }, gait: { exc: 0.22, lift: 0.1 }, bird: true },
  peafowl: { neck: { at: [0.84, 0.6], dir: 60, ramp: [-0.01, 0.08] }, head: { at: [0.93, 0.9], dir: 30, ramp: [0.0, 0.03] },
    tail: { at: [0.55, 0.62], dir: 180, ramp: [0.0, 0.1], width: 0.4, amp: 6, axis: 'y', loose: true },
    graze: { neck: 82, head: -38, pitch: 18, reach: 0.16 }, gait: { exc: 0.08, lift: 0.05 }, bird: true }
};
// (the skinned models' chains: how much of the neck's or tail's bend each joint takes)
const NECK_BONES = { Neck1: 0.3, Neck2: 0.62, Neck3: 0.88, Head: 1 };
const TAIL_BONES = { Tail1: 0.3, Tail2: 0.6, Tail3: 0.85, Tail4: 1, Tail5: 1, Tail6: 1, Tail7: 1 };
const chain = (bw, table) => { if (!bw) return 0; let s = 0; for (const [n, w] of Object.entries(bw)) s += (table[n] || 0) * w; return s; };

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const key = (p) => p.map((v) => Math.round(v * 1e5)).join(',');

// The rig of one model: tris as the build leaves them ({ p: [[x,y,z] x3] }); returns per-corner attributes and the params
export function computeRig(tris, species) {
  const R = RIGS[species];
  if (!R) throw new Error(`no rig for ${species}`);
  // the unique vertices and their shells (connected components)
  const verts = new Map();
  tris.forEach((t) => t.p.forEach((p, i) => { const k = key(p); if (!verts.has(k)) verts.set(k, { p, k, bw: t.bw ? t.bw[i] : null }); }));
  const parent = new Map([...verts.keys()].map((k) => [k, k]));
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  for (const t of tris) { const [a, b, c] = t.p.map(key); parent.set(find(b), find(a)); parent.set(find(c), find(a)); }
  const size = new Map();
  for (const k of verts.keys()) { const r = find(k); size.set(r, (size.get(r) || 0) + 1); }
  const mainRoot = [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const V = [...verts.values()];
  for (const v of V) v.main = find(v.k) === mainRoot;
  let z0 = Infinity, z1 = -Infinity, H = 0, X = 0;
  for (const { p } of V) { z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); H = Math.max(H, p[1]); X = Math.max(X, Math.abs(p[0])); }
  const L = z1 - z0, Z = (u) => z0 + u * L, Y = (h) => h * H;

  // --- the legs: the feet's clusters, each leg's axis from its hoof to the belly
  const bird = !!R.bird;
  const feet = V.filter((v) => v.main && v.p[1] < 0.05 * H);
  let zCut = -Infinity;
  if (!bird) {
    const zs = feet.map((v) => v.p[2]).sort((a, b) => a - b);
    let gap = 0;
    for (let i = 1; i < zs.length; i++) if (zs[i] - zs[i - 1] > gap) { gap = zs[i] - zs[i - 1]; zCut = (zs[i] + zs[i - 1]) / 2; }
  }
  const legOf = (x, z) => (bird ? (x > 0 ? 3 : 4) : z > zCut ? (x > 0 ? 1 : 2) : (x > 0 ? 3 : 4));
  const legs = {};
  for (const v of feet) {
    const c = legOf(v.p[0], v.p[2]);
    const g = legs[c] || (legs[c] = { n: 0, x: 0, z: 0, zmin: Infinity, zmax: -Infinity });
    g.n++; g.x += v.p[0]; g.z += v.p[2]; g.zmin = Math.min(g.zmin, v.p[2]); g.zmax = Math.max(g.zmax, v.p[2]);
  }
  for (const g of Object.values(legs)) { g.x /= g.n; g.z /= g.n; }
  const codes = Object.keys(legs).map(Number);
  // (half the spacing between neighbouring legs: a vertex further than that from every axis is not on a leg)
  let spacing = Infinity;
  for (const a of codes) for (const b of codes) if (a < b) spacing = Math.min(spacing, Math.hypot(legs[a].x - legs[b].x, legs[a].z - legs[b].z));
  // (or the hoof's own spread, whichever is more: a paw reaching forward is the leg's)
  let footR = 0;
  for (const v of feet) { const g = legs[legOf(v.p[0], v.p[2])]; footR = Math.max(footR, Math.hypot(v.p[0] - g.x, v.p[2] - g.z)); }
  const reach = Math.max(Math.min(0.5 * spacing, 0.22 * H), footR + 0.02);
  // the belly: a quadruped's lowest point between the front and back legs; a bird's body's lowest point off the legs
  let belly = Infinity;
  if (!bird) {
    const zb = Math.max(legs[3].zmax, legs[4].zmax), zf = Math.min(legs[1].zmin, legs[2].zmin), m = (zf - zb) * 0.25;
    for (const v of V) if (v.main && v.p[2] > zb + m && v.p[2] < zf - m) belly = Math.min(belly, v.p[1]);
  } else {
    for (const v of V) if (v.main && v.p[1] > 0.12 * H && codes.every((c) => Math.hypot(v.p[0] - legs[c].x, v.p[2] - legs[c].z) > 0.12 * H)) belly = Math.min(belly, v.p[1]);
  }
  // (each axis leans: from the hoof's centre to the centre of its leg's vertices a little below the belly)
  for (const c of codes) {
    const g = legs[c], ys = belly * 0.75;
    let n = 0, sx = 0, sz = 0;
    for (const v of V) if (v.main && Math.abs(v.p[1] - ys) < belly * 0.08 && Math.hypot(v.p[0] - g.x, v.p[2] - g.z) < reach * 1.2 && legOf(v.p[0], v.p[2]) === c) { n++; sx += v.p[0]; sz += v.p[2]; }
    g.tx = n ? sx / n : g.x; g.tz = n ? sz / n : g.z; g.ty = ys;
  }
  const axisAt = (g, y) => { const t = y / g.ty; return [g.x + (g.tx - g.x) * t, g.z + (g.tz - g.z) * t]; };
  const top = belly + 0.03 * H, band = 0.2 * belly;
  const limb = (p) => {
    if (p[1] > top) return [0, 0];
    let best = 0, bd = Infinity;
    for (const c of codes) { const [ax, az] = axisAt(legs[c], Math.max(0, p[1])); const d = Math.hypot(p[0] - ax, p[2] - az); if (d < bd) { bd = d; best = c; } }
    const w = smooth(top, top - band, p[1]) * (1 - smooth(reach, reach * 1.4, bd));
    return [best, w];
  };
  // the hips (shoulders in front): in the body above the belly
  const hipY = (front) => belly + (bird ? 0.12 : 0.28) * ((front || bird ? R.shoulder || H * 0.92 : H * 0.92) - belly);
  // (the swing's pivot straight over the hooves, so a leaning leg's hoof swings along the ground, not into it)
  const hip = (cs) => { const g = cs.map((c) => legs[c]).filter(Boolean); return [g.reduce((s, q) => s + q.z, 0) / g.length]; };
  const hipF = bird ? null : [hipY(true), hip([1, 2])[0]], hipB = [hipY(false), hip([3, 4])[0]];

  // --- the neck, head and tail: a ramp along a direction from the hinge
  const hinge = (part) => {
    if (!part) return null;
    const a = ((part.dir ?? -90) * Math.PI) / 180, ramp = part.ramp || [0, 0.1];
    return { y: Y(part.at[1]), z: Z(part.at[0]), dy: Math.sin(a), dz: Math.cos(a), r0: ramp[0] * L, r1: ramp[1] * L, width: part.width, axis: part.axis, bones: part.bones, loose: part.loose };
  };
  const neck = hinge(R.neck), head = hinge(R.head), tail = hinge(R.tail);
  const along = (h, p) => smooth(h.r0, h.r1, (p[1] - h.y) * h.dy + (p[2] - h.z) * h.dz);
  // (a tail stands off the body: behind the rump's back at its height, measured off the body's sides wider than the tail)
  const NB = 48, rump = new Array(NB).fill(Infinity);
  if (tail && !tail.bones) for (const v of V) if (v.main && Math.abs(v.p[0]) > tail.width * 1.2) { const b = Math.min(NB - 1, Math.floor((v.p[1] / H) * NB)); rump[b] = Math.min(rump[b], v.p[2]); }
  const behind = (p) => { const b = Math.min(NB - 1, Math.max(0, Math.floor((p[1] / H) * NB))); const zr = Math.min(rump[b], rump[Math.max(0, b - 1)], rump[Math.min(NB - 1, b + 1)]); return zr === Infinity ? 1 : smooth(0.008, 0.03, zr - p[2]); };
  const ears = R.ears ? { z: Z((R.ears.u[0] + R.ears.u[1]) / 2), y: Y(R.ears.h[0]), x: R.ears.s * X } : null;
  const weights = (p, bw) => {
    const [code, lw] = limb(p);
    const free = 1 - lw;
    const wn = neck ? (neck.bones ? chain(bw, NECK_BONES) : along(neck, p)) * free : 0;
    const wh = head ? along(head, p) * wn : 0;
    let wt = 0;
    if (tail && tail.bones) wt = chain(bw, TAIL_BONES) * free;
    else if (tail) wt = along(tail, p) * (1 - smooth(tail.width * 0.6, tail.width, Math.abs(p[0]))) * free * (tail.loose ? 1 : behind(p));
    let ec = 0, ew = 0;
    if (R.ears) {
      const E = R.ears, u = (p[2] - z0) / L, h = p[1] / H, s = Math.abs(p[0]) / X;
      const inside = smooth(E.u[0] - 0.02, E.u[0], u) * smooth(E.u[1] + 0.02, E.u[1], u) * smooth(E.s - 0.05, E.s, s);
      ew = inside * smooth(E.h[0], E.h[0] + (E.h[1] - E.h[0]) * 0.4, h);
      if (ew > 0.01) ec = p[0] > 0 ? 5 : 6;
    }
    return ec ? [wn, wh, wt, ec, ew] : [wn, wh, wt, code, lw];
  };
  for (const v of V) v.w = weights(v.p, v.bw);
  // (a shell bends with the body where it is rooted: its neck and head weights from its vertex nearest the main body)
  const mainV = V.filter((v) => v.main);
  const shells = new Map();
  for (const v of V) if (!v.main) { const r = find(v.k); (shells.get(r) || shells.set(r, []).get(r)).push(v); }
  for (const S of shells.values()) {
    let best = null, bd = Infinity;
    for (const v of S) for (const m of mainV) { const d = (v.p[0] - m.p[0]) ** 2 + (v.p[1] - m.p[1]) ** 2 + (v.p[2] - m.p[2]) ** 2; if (d < bd) { bd = d; best = m; } }
    for (const v of S) { v.w[0] = best.w[0]; v.w[1] = best.w[1]; }
  }
  const pack = (w) => [w[0], w[1], w[2], w[3] ? (w[3] + 0.9 * Math.min(1, w[4])) / 8 : 0];
  const attr = tris.map((t) => t.p.map((p) => pack(verts.get(key(p)).w)));

  // --- the graze pose's reach: how far the neck must stretch down for the muzzle (or beak) to meet the ground
  const P = {
    neck: neck ? [neck.y, neck.z] : [0, 0], head: head ? [head.y, head.z] : [0, 0], tail: tail ? [tail.y, tail.z] : [0, 0],
    tailAxis: tail ? (tail.axis === 'y' ? [1, 0] : [tail.dz, -tail.dy]) : [0, 1],
    hipF: hipF || hipB, hipB, exc: R.gait.exc, lift: R.gait.lift, tailAmp: tail ? (R.tail.amp * Math.PI) / 180 : 0,
    ear: ears ? [ears.x, ears.y, ears.z] : [0, 0, 0], earAmp: R.ears ? (R.ears.amp * Math.PI) / 180 : 0,
    graze: [(R.graze.neck * Math.PI) / 180, (R.graze.head * Math.PI) / 180, (R.graze.pitch * Math.PI) / 180], reach: 0,
    bird, belly, height: H, length: L
  };
  const g = { g: 1, look: 0, stride: 0, amp: 0, t: 0, seed: 0 };
  let low = Infinity;
  for (const v of V) if (v.w[0] > 0.98) low = Math.min(low, pose(v.p, [0, 1, 0], pack(v.w), { ...P, reach: 0 }, g).p[1]);
  P.reach = Math.max(0, Math.min(low - (R.graze.to ?? 0.06), R.graze.reach ?? 0.2));
  const stats = { belly: +belly.toFixed(3), reach: +P.reach.toFixed(3), legs: codes.length, legReach: +reach.toFixed(3), lowBeforeReach: +low.toFixed(3),
    shells: shells.size, verts: V.length };
  return { attr, params: P, stats };
}

// The deformation (the shader's, js/high-park-features.js zooAnimMaterial): p and n in the model's space, a its _ZOOA,
// P the species' params, S the instance's state as the herd sim gives it { g (the graze pose's share: neck, head and
// pitch; negative raises the head), look (the neck's turn, rad), stride (m: the legs' cycle), amp (0-1 the swing),
// t (s), seed }. Returns { p, n }
// (a walk: each foot on the ground for 0.65 of the cycle; the feet in the lateral sequence, a bird's two half a cycle apart)
export const GAIT = { duty: 0.65, offset: { 1: 0.25, 2: 0.75, 3: 0, 4: 0.5 } };
const rotX = (v, c, s, py, pz) => { const y = v[1] - py, z = v[2] - pz; return [v[0], py + y * c - z * s, pz + y * s + z * c]; };
const rotXn = (v, c, s) => [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
// (about the vertical through (px, pz))
const rotY = (v, c, s, px, pz) => { const x = v[0] - px, z = v[2] - pz; return [px + x * c + z * s, v[1], pz - x * s + z * c]; };
// (about an axis in the y-z plane (0, ay, az) through (0, py, pz): Rodrigues)
const rotA = (v, ay, az, c, s, py, pz) => {
  const x = v[0], y = v[1] - py, z = v[2] - pz, d = y * ay + z * az;
  const cx = ay * z - az * y, cy = az * x, cz = -ay * x; // axis x v
  return [x * c + cx * s, py + y * c + cy * s + ay * d * (1 - c), pz + z * c + cz * s + az * d * (1 - c)];
};
export function legSwing(u, duty = GAIT.duty) {
  // the foot's place along its stride, -1 (back) to 1 (forward), and its lift (0-1): back along the ground at an even
  // speed for the duty share of the cycle (the stance), then lifted and swung forward
  if (u < duty) return [1 - (2 * u) / duty, 0];
  const s = (u - duty) / (1 - duty);
  return [-1 + 2 * s * s * (3 - 2 * s), Math.sin(Math.PI * s)];
}
export function pose(p0, n0, a, P, S) {
  let p = p0.slice(), n = n0.slice();
  const wn = a[0], wh = a[1], wt = a[2], c8 = a[3] * 8, code = Math.floor(c8 + 0.02), wl = code ? Math.min(1, Math.max(0, (c8 - code) / 0.9)) : 0;
  const isLeg = code >= 1 && code <= 4 ? 1 : 0, isEar = code >= 5 ? 1 : 0, wleg = wl * isLeg;
  const phase = (S.stride * GAIT.duty) / (2 * Math.max(0.01, P.exc));
  // breathing: the torso swells across
  const torso = (1 - wn) * (1 - wt) * (1 - wleg);
  p[0] *= 1 + 0.012 * Math.sin(S.t * 1.6 + S.seed * 6.28) * torso * Math.min(1, Math.max(0, (p0[1] - P.belly) * 4));
  // ears: a flick about the ear's base, now and then
  if (isEar) {
    const sg = code === 5 ? 1 : -1, env = Math.pow(Math.max(0, Math.sin(S.t * 0.37 + S.seed * 17.0 + sg)), 24);
    const ang = sg * P.earAmp * env * Math.sin(S.t * 22) * wl, c = Math.cos(ang), s = Math.sin(ang);
    const x = p[0] - sg * P.ear[0], y = p[1] - P.ear[1];
    p = [sg * P.ear[0] + x * c - y * s, P.ear[1] + x * s + y * c, p[2]];
    n = [n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2]];
  }
  // legs: swung from the hip, the foot along the ground in the stance, lifted in the swing
  if (isLeg) {
    const u = (((phase + GAIT.offset[code]) % 1) + 1) % 1;
    const [fx, lift] = legSwing(u);
    const front = code <= 2, hy = front ? P.hipF[0] : P.hipB[0], hz = front ? P.hipF[1] : P.hipB[1];
    const ang = Math.asin(Math.max(-0.9, Math.min(0.9, (P.exc * fx * S.amp) / hy))) * wl;
    const depth = Math.min(1, Math.max(0, (hy - p0[1]) / hy));
    // (positive: the foot forward, so the rotation's sense is minus)
    const c = Math.cos(-ang), s = Math.sin(-ang);
    p = rotX(p, c, s, hy, hz); n = rotXn(n, c, s);
    p[1] += (P.lift * lift * S.amp - hy * (1 - Math.cos(ang))) * depth * wl;
  }
  // the tail: swished about its root, in gusts
  if (wt > 0) {
    const ang = P.tailAmp * wt * (Math.sin(S.t * 2.1 + S.seed * 9.0) * 0.7 + Math.sin(S.t * 3.3 + S.seed * 4.0) * 0.3) * (0.5 + 0.5 * Math.max(0, Math.sin(S.t * 0.23 + S.seed * 3.0)));
    const c = Math.cos(ang), s = Math.sin(ang);
    p = rotA(p, P.tailAxis[0], P.tailAxis[1], c, s, P.tail[0], P.tail[1]);
    n = rotA(n, P.tailAxis[0], P.tailAxis[1], c, s, 0, 0);
  }
  // the head about the poll, then the neck about its base (down, then turned), the reach, the body's pitch (birds)
  if (wh > 0) { const ang = S.g * P.graze[1] * wh, c = Math.cos(ang), s = Math.sin(ang); p = rotX(p, c, s, P.head[0], P.head[1]); n = rotXn(n, c, s); }
  if (wn > 0) {
    const ang = S.g * P.graze[0] * wn, c = Math.cos(ang), s = Math.sin(ang);
    p = rotX(p, c, s, P.neck[0], P.neck[1]); n = rotXn(n, c, s);
    const ya = S.look * wn, cy = Math.cos(ya), sy = Math.sin(ya);
    p = rotY(p, cy, sy, 0, P.neck[1]); n = rotY(n, cy, sy, 0, 0);
    p[1] -= P.reach * Math.min(1, Math.max(0, S.g)) * wn;
  }
  const pa = Math.max(0, S.g) * P.graze[2] * (1 - wleg);
  if (pa) { const c = Math.cos(pa), s = Math.sin(pa); p = rotX(p, c, s, P.hipB[0], P.hipB[1]); n = rotXn(n, c, s); }
  // walking: the body bobs twice a stride
  p[1] += 0.012 * P.hipB[0] * S.amp * Math.abs(Math.sin(phase * Math.PI * 2)) * (1 - wleg);
  return { p, n };
}
