// js/building-draw.js — draws the house presets (st-ndw9.13, docs/building-prototypes-spec.md section 3.5): the Victorian
// bay-and-gable semi, the Edwardian detached house and the Victorian row, behind ?massing=1&presets=draw and the
// ?gallery=presets page. Pure functions with no three.js and no DOM (like js/massing-cells.js): buildings.js calls
// planHouse for a polygon building whose preset has drawing parameters (js/building-prototypes.js DRAW) and gets back
//   - the main record's outline and wall kinds (the front edge cut into door and window stretches), its facade
//     variant, brick colour and whole-storey eave height: the building table and cell meshes draw its walls as ever;
//   - `records`: the bays, porch slab and porch piers as small extra polygon records (nearOnly: the near tier
//     draws them, js/massing-cells.js), in the same materials and meshes;
//   - `pushRoof(A)`: the roof, gables, bargeboards, dormers and bay roofs as flat-coloured triangles into the hipped
//     roofs' batch (the existing HippedRoofs mesh). No material, mesh or draw call is added.
// or { ok: false, reason }, and the building keeps today's look.
//
// Every random choice comes from stream(id, label): a generator seeded by a hash of the building's durable id and a
// label, so a house is the same on every load and a change to one preset reshuffles no other. Joined houses draw from
// their group's id, so the two halves of a semi, or a row, share one brick, one roof, one trim and one facade style
// (and the halves of a semi mirror each other, the doors paired at the party wall).
//
// Frame. The front edge A -> B (an outline edge looking onto a street) gives u along it from A, w out of the wall
// (v = -w, into the building) and y up. Everything is placed in (u, v, y) and turned to world by `F.P`.

import { DRAW, ROSEDALE_DRAW, FACADE_VARIANTS, FIRST_DRAW_VARIANT, SHOP_SIGN_BOARDS, SHOP_SIGN } from './building-prototypes.js';
import { planBlock } from './building-draw-tall.js';
import { planWorship } from './building-draw-worship.js';
import { windowOpenings, sillsAndLintels, porchDetail, chimneyBox, porticoDetail, shutterBoards, turretDetail, yardDetail } from './building-draw-detail.js';
import { WALL, hash32, stream, weighted, lerp, rad, clamp, writer, shade, makeFrame, gableRoof, hipRoof, slab, tarRgb } from './building-draw-kit.js';
// (the helpers the planners share live in js/building-draw-kit.js; re-exported here for the tests and the tools)
export { WALL, hash32, stream, weighted, lerp, rad, clamp, writer, shade, makeFrame, gableRoof, hipRoof, slab, tarRgb };

export const DRAWN_PRESETS = Object.keys(DRAW);
export const ROSEDALE_PRESETS = Object.keys(ROSEDALE_DRAW); // (jf-bya: drawn too, but not catalogue entries; the gallery and the presets file know only DRAWN_PRESETS)
export const FALLBACK_REASONS = ['house-sized', 'too-low', 'bad-height', 'no-nave', 'landmark', 'no-front', 'shop-front', 'too-small', 'too-irregular', 'front-bulge', 'front-short', 'unfit-roof', 'other-facade', 'one-storey', 'too-tall'];

const polyArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
};

// A mansard over [u0, u1] x [v0, v1]: steep planes down to the cornice, a low deck (two planes and a ridge along u,
// hipped at an open end). A party side has no slope and no overhang: it stands against the next house.
function mansardRoof(W, F, s) {
  const e = s.eave, y = s.y, P = F.P;
  const uL = s.u0 - (s.partyL ? 0 : e), uR = s.u1 + (s.partyR ? 0 : e), vF = s.v0 - e, vB = s.v1 + e;
  const inset = s.rise / Math.tan(s.steep);
  const iuL = uL + (s.partyL ? 0 : inset), iuR = uR - (s.partyR ? 0 : inset), ivF = vF + inset, ivB = vB - inset;
  const yt = y + s.rise;
  const steep = (a, b, c) => W.slope(a, b, c, s.rgb, y, s.steep);
  steep(P(uL, vF, y), P(uR, vF, y), P(iuR, ivF, yt)); steep(P(uL, vF, y), P(iuR, ivF, yt), P(iuL, ivF, yt));
  steep(P(uR, vB, y), P(uL, vB, y), P(iuL, ivB, yt)); steep(P(uR, vB, y), P(iuL, ivB, yt), P(iuR, ivB, yt));
  if (!s.partyL) { steep(P(uL, vB, y), P(uL, vF, y), P(iuL, ivF, yt)); steep(P(uL, vB, y), P(iuL, ivF, yt), P(iuL, ivB, yt)); }
  if (!s.partyR) { steep(P(uR, vF, y), P(uR, vB, y), P(iuR, ivB, yt)); steep(P(uR, vF, y), P(iuR, ivB, yt), P(iuR, ivF, yt)); }
  // the deck: two shallow planes to a ridge along u, hipped at an open end
  const vm = (ivF + ivB) / 2, hd = (ivB - ivF) / 2, rise2 = s.deckRise != null ? s.deckRise : hd * Math.tan(s.deck), yr = yt + rise2; // (a row's decks share their height: no step at a party wall)
  const ru0 = s.partyL ? iuL : iuL + hd, ru1 = s.partyR ? iuR : iuR - hd;
  const a = Math.min(ru0, ru1), b = Math.max(ru0, ru1);
  const deck = (p, q, r) => W.slope(p, q, r, s.deckRgb, yt, Math.max(0.1, Math.atan2(rise2, hd)));
  deck(P(iuL, ivF, yt), P(iuR, ivF, yt), P(b, vm, yr)); deck(P(iuL, ivF, yt), P(b, vm, yr), P(a, vm, yr));
  deck(P(iuR, ivB, yt), P(iuL, ivB, yt), P(a, vm, yr)); deck(P(iuR, ivB, yt), P(a, vm, yr), P(b, vm, yr));
  if (!s.partyL) deck(P(iuL, ivB, yt), P(iuL, ivF, yt), P(a, vm, yr));
  if (!s.partyR) deck(P(iuR, ivF, yt), P(iuR, ivB, yt), P(b, vm, yr));
  // the cornice: a band of trim along the front eave, shared along the row
  const cy = y - 0.4;
  W.quadFace(P(uL, vF, cy), P(uR, vF, cy), P(uR, vF, y + 0.06), P(uL, vF, y + 0.06), s.trimRgb, F.out);
  return { uL, uR, vF, vB, inset, ivF, ivB, y, rise: s.rise, top: yr };
}

// A gable dormer standing on a roof slope that rises at `pitch` from (vRef, yRef) going into the building: its front at
// vFace, wall `hw` high, a front gable and two roof planes, the cheeks closing the sides, a dark window on its face.
function dormer(W, F, s) {
  const P = F.P, tanP = Math.tan(s.pitch), yS = (v) => s.yRef + (v - s.vRef) * tanP, vS = (y) => s.vRef + (y - s.yRef) / tanP;
  const uL = s.u - s.w / 2, uR = s.u + s.w / 2, yB = yS(s.vFace), yT = yB + s.hw, rise = (s.w / 2) * Math.tan(rad(36)), yR = yT + rise;
  const bl = P(uL, s.vFace, yB), br = P(uR, s.vFace, yB), tl = P(uL, s.vFace, yT), tr = P(uR, s.vFace, yT), ap = P(s.u, s.vFace, yR);
  W.quadFace(bl, br, tr, tl, s.trimRgb, F.out);
  W.face(tl, tr, ap, s.trimRgb, F.out);
  // the window: dark glass inset in the face
  const m = 0.14, mt = 0.1;
  W.quadFace(P(uL + m, s.vFace - 0.01, yB + mt + 0.05), P(uR - m, s.vFace - 0.01, yB + mt + 0.05), P(uR - m, s.vFace - 0.01, yT - mt), P(uL + m, s.vFace - 0.01, yT - mt), s.glassRgb, F.out);
  // the cheeks: a triangle each side from the face back to where the wall top meets the slope
  W.face(bl, tl, P(uL, vS(yT), yT), s.rgb, F.left);
  W.face(br, tr, P(uR, vS(yT), yT), s.rgb, F.right);
  // the roof: two planes from the eaves to a ridge running back to the slope
  const vBack = vS(yR);
  W.quadSlope(tl, P(uL, vS(yT), yT), P(s.u, vBack, yR), ap, s.roofRgb, yT, rad(36));
  W.quadSlope(tr, ap, P(s.u, vBack, yR), P(uR, vS(yT), yT), s.roofRgb, yT, rad(36));
}

// bargeboards: a board of `bw` along each rake of a front gable's end, in trim colour, standing just proud of it
function bargeboard(W, F, g, bw, rgb) {
  const P = F.P, off = g.vF - 0.035;
  const ang = Math.atan2(g.rise, g.half), sn = Math.sin(ang), cs = Math.cos(ang);
  for (const side of [-1, 1]) {
    const uBase = side < 0 ? g.uL : g.uR;
    const p0 = P(uBase, off, g.y), p1 = P(g.uc, off, g.y + g.rise);
    const du = -side * sn * bw, dy = -cs * bw; // down and inward, in the gable plane
    const q0 = P(uBase + du, off, g.y + dy), q1 = P(g.uc, off, g.y + g.rise + dy);
    W.quadFace(p0, p1, q1, q0, rgb, F.out);
  }
}

// the little attic window in a gable end
function atticWindow(W, F, g, w, h, frameRgb, glassRgb) {
  const P = F.P, off = g.vF - 0.04, yb = g.y + Math.min(g.rise * 0.12, 0.4) + 0.2, yt = yb + h;
  const room = (g.rise - (yt - g.y)) / Math.tan(Math.atan2(g.rise, g.half));
  if (room < w / 2 + 0.15) return false;
  const f = 0.08;
  W.quadFace(P(g.uc - w / 2 - f, off, yb - f), P(g.uc + w / 2 + f, off, yb - f), P(g.uc + w / 2 + f, off, yt + f), P(g.uc - w / 2 - f, off, yt + f), frameRgb, F.out);
  W.quadFace(P(g.uc - w / 2, off - 0.01, yb), P(g.uc + w / 2, off - 0.01, yb), P(g.uc + w / 2, off - 0.01, yt), P(g.uc - w / 2, off - 0.01, yt), glassRgb, F.out);
  return true;
}

// the roof over a canted bay: a low pyramid fanning from the wall to the three outer edges
function bayRoof(W, F, pts, rise, y, rgb) {
  const P = F.P, apex = P((pts[0][0] + pts[3][0]) / 2, -0.05, y + rise);
  for (let i = 0; i < 3; i++) W.slope(P(pts[i][0], pts[i][1], y), P(pts[i + 1][0], pts[i + 1][1], y), apex, rgb, y, Math.atan2(rise, 0.9));
}


// A side-gable roof over [u0, u1] x [v0, v1]: the ridge along u, a slope to the street and one behind, a gable end at each
// open side (a party side has no end and no overhang: the next house's roof carries on). `rise` fixes the ridge height.
function sideGableRoof(W, F, s) {
  const uL = s.u0 - s.eL, uR = s.u1 + s.eR, vF = s.v0 - s.eF, vB = s.v1 + s.eB, y = s.y, P = F.P;
  const half = (vB - vF) / 2, rise = s.rise != null ? s.rise : half * Math.tan(s.pitch), vc = (vF + vB) / 2, pitch = Math.atan2(rise, half);
  const fl = P(uL, vF, y), fr = P(uR, vF, y), bl = P(uL, vB, y), br = P(uR, vB, y), rl = P(uL, vc, y + rise), rr = P(uR, vc, y + rise);
  W.quadSlope(fl, fr, rr, rl, s.rgb, y, pitch);
  W.quadSlope(br, bl, rl, rr, s.rgbL || s.rgb, y, pitch);
  if (!s.partyL) W.face(fl, bl, rl, s.endRgb, F.left);
  if (!s.partyR) W.face(fr, br, rr, s.endRgb, F.right);
  W.quadFace(P(uL, vF, y - 0.04), P(uR, vF, y - 0.04), P(uR, vB, y - 0.04), P(uL, vB, y - 0.04), shade(s.rgb, 0.6), [0, -1, 0]);
  const down = (p) => [p[0], p[1] - 0.05, p[2]];
  W.quadFace(fl, fr, down(fr), down(fl), shade(s.rgb, 0.8), F.out);
  W.quadFace(bl, br, down(br), down(bl), shade(s.rgb, 0.8), F.in);
  return { uL, uR, vF, vB, rise, half, vc, y, pitch };
}

/**
 * One front line per joined run (st-ndw9.15 round 3). `plans`: the first pass's [{ id, groupId, A, t, u0, u1, z1, edge }] (the
 * frames planHouse returned with no shift). The houses of a group that stand side by side (parallel within 3 degrees, their
 * blocks touching within 0.9 m) are one run; the run's front line is the MEDIAN of its houses' front lines (measured along
 * the first house's outward normal); each house whose own line is within `maxStep` (1.5 m) of it moves to it, the front block
 * of its drawing following (the real outline stays behind it). A house more than 1.5 m from the median keeps its own line:
 * the City's outlines truly step there. Returns { shifts: Map(id -> { edge, s, depth? }) (s: metres outward; depth: the block's depth from its composed front, one back line a run, st-ndw9.18),
 * runs, snapped, steps, depthSet (houses given a depth), depthRuns (runs with one), depthSteps (houses kept at their own depth) }.
 */
export function snapFronts(plans, maxStep = 2.6, maxDeeper = 8, maxLonger = 0) {
  const byGroup = new Map();
  for (const p of plans) (byGroup.get(p.groupId) || byGroup.set(p.groupId, []).get(p.groupId)).push(p);
  const shifts = new Map();
  const carry = new Map(); // (id -> { L, R }: metres a party side's roof is carried toward its neighbour so the two meet, st-ndw9.24)
  let runs = 0, snapped = 0, steps = 0, depthSet = 0, depthRuns = 0, depthSteps = 0;
  const cuts = [];
  for (const m of byGroup.values()) {
    if (m.length < 2) continue;
    const parent = m.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) {
      const a = m[i], b = m[j], nx = a.t[1], nz = -a.t[0];
      const dot = b.t[0] * a.t[0] + b.t[1] * a.t[1];
      if (dot < Math.cos(rad(3))) continue;
      const bu = (b.A[0] - a.A[0]) * a.t[0] + (b.A[1] - a.A[1]) * a.t[1], bv = -((b.A[0] - a.A[0]) * nx + (b.A[1] - a.A[1]) * nz);
      const cb = bu + dot * (b.u0 + b.u1) / 2, ca = (a.u0 + a.u1) / 2;
      const gap = Math.abs(cb - ca) - ((a.u1 - a.u0) + (b.u1 - b.u0)) / 2;
      if (Math.abs(gap) > 0.9 || Math.abs(bv) > Math.max(a.z1, b.z1)) continue;
      // the City's outlines of two neighbours can stand a few tenths of a metre apart: from a lane the sky shows through the roofs there
      // (st-ndw9.24). Each party-side roof is carried half that gap (and 1 cm) so the two meet, for a gap of 3 to 45 cm only (a wider one is a lane or a
      // real gap; none is no gap, and an overlap would draw two coplanar roofs)
      if (gap > 0.03 && gap <= 0.45) {
        const c = Math.min(0.2, gap / 2 + 0.01), bRight = cb > ca;
        const ea = carry.get(a.id) || carry.set(a.id, { L: 0, R: 0 }).get(a.id), eb = carry.get(b.id) || carry.set(b.id, { L: 0, R: 0 }).get(b.id);
        if (bRight) { ea.R = Math.max(ea.R, c); eb.L = Math.max(eb.L, c); } else { ea.L = Math.max(ea.L, c); eb.R = Math.max(eb.R, c); }
      }
      parent[find(i)] = find(j);
    }
    const comps = new Map();
    m.forEach((p, i) => (comps.get(find(i)) || comps.set(find(i), []).get(find(i))).push(p));
    for (const c of comps.values()) {
      if (c.length < 2) continue;
      runs++;
      const r = c[0], rn = [r.t[1], -r.t[0]];
      const off = c.map((p) => (p.A[0] - r.A[0]) * rn[0] + (p.A[1] - r.A[1]) * rn[1]);
      const sorted = [...off].sort((x, y) => x - y), target = sorted[(sorted.length - 1) >> 1];
      c.forEach((p, i) => {
        const s = target - off[i];
        if (Math.abs(s) < 0.03) return;
        if (Math.abs(s) > maxStep) { steps++; return; }
        shifts.set(p.id, { edge: p.edge, s }); snapped++;
      });
      // one back line per run (st-ndw9.18): the real row has one roof, so one ridge and one back eave. The run's back line is the (upper) MEDIAN of
      // its houses' (the outward position of the main block's back wall); a house whose block ends within `maxDeeper` m beyond it is cut back
      // to it (what lies behind becomes the rear wing, the real outline), a shallower house within `maxLonger` m is carried back to it (0 by default: a back wall is only ever cut back, never pushed out past the City outline, John 2026-11-17). A house
      // further off keeps its own depth: the outlines truly step there. The target depth is the frontShift's `depth` (from the house's own
      // unshifted front line: the composed front moves by `s`, the back wall does not)
      const backs = c.map((p, i) => off[i] - p.z1), bsorted = [...backs].sort((x, y) => x - y), tb = bsorted[bsorted.length >> 1]; // (the upper median: the shallower of a pair; additions are wings, not the block)
      let touched = false;
      c.forEach((p, i) => {
        const sh = shifts.get(p.id), want = off[i] - tb, d = want - p.z1; // (the depth from the house's own unshifted front line)
        if (Math.abs(d) < 0.05 || want < 4.6) return;
        if (d < 0 ? -d > maxDeeper : d > maxLonger) { depthSteps++; return; }
        const e = sh || { edge: p.edge, s: 0 };
        e.depth = want; shifts.set(p.id, e); depthSet++; touched = true;
        if (d < 0) cuts.push({ id: p.id, cut: -d });
      });
      if (touched) depthRuns++;
    }
  }
  const byId = new Map(plans.map((p) => [p.id, p]));
  for (const [id, c] of carry) {
    const e = shifts.get(id) || { edge: byId.get(id).edge, s: 0 };
    e.carryL = c.L; e.carryR = c.R; shifts.set(id, e);
  }
  return { shifts, runs, snapped, steps, depthSet, depthRuns, depthSteps, cuts, carried: carry.size };
}

// ---- layout ------------------------------------------------------------------------------------------------------------
const DARK_GLASS = [0.012, 0.018, 0.022];
const STONE = [[0xd8d2c2, 4], [0xcfc8b6, 3], [0xe4dfd2, 2], [0xbdb8aa, 2]]; // (dressed stone: sills, lintels)
const TIMBER = [[0xe4d9bd, 5], [0xd9cdb0, 3], [0xcbbf9f, 2]]; // (the stucco of a half-timbered gable end)

// ---- the outline in the house's frame (st-ndw9.15): the composed front and the real back --------------------------------
// The street front of a house stays a clean composed rectangle (the entrance, the bays, the porch are drawn on it); behind
// it the house follows the City's outline, so a rear wing shows from the lane and from the air. The rule:
//   - the front line is the front edge's line. What the outline has in front of it (an old bay, a porch) is dropped: the
//     composed front replaces it (a house with a quarter of its area in front of the line has the wrong front edge: fallback);
//   - the main block is a rectangle as wide as the outline is through its first 7 m (its extent every metre from 2 m deep,
//     the median) and as deep as the outline keeps that width (within 0.9 m a side) from 4 m on, so a bay or a porch bulge
//     or a small step never ends it; a remainder under 1.8 m deep is absorbed into the block;
//   - what lies behind the block is the rear wing: the real outline there, one storey lower (at most two storeys) under its
//     own flat roof, a separate record; the main block's rear wall stands above it.
const extentAt = (rUV, v) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, n = rUV.length; i < n; i++) {
    const a = rUV[i], b = rUV[(i + 1) % n];
    if ((a[1] <= v) !== (b[1] <= v)) { const u = a[0] + (v - a[1]) / (b[1] - a[1]) * (b[0] - a[0]); if (u < lo) lo = u; if (u > hi) hi = u; }
  }
  return lo < hi ? [lo, hi] : null;
};
const insideUV = (rUV, u, v) => {
  let c = false;
  for (let i = 0, j = rUV.length - 1; i < rUV.length; j = i++) {
    const a = rUV[i], b = rUV[j];
    if ((a[1] > v) !== (b[1] > v) && u < (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
// the part of a ring (in uv) on the far side of v = d (Sutherland-Hodgman on one half-plane), each point with the source edge
// of the segment that leads to it (-1: the cut). `runs` > 1 when the outline leaves and re-enters the half-plane.
function clipBack(rUV, d) {
  const out = [];
  let exits = 0;
  for (let i = 0, n = rUV.length; i < n; i++) {
    const p = rUV[i], q = rUV[(i + 1) % n], pin = p[1] >= d, qin = q[1] >= d;
    const X = () => { const t = (d - p[1]) / (q[1] - p[1]); return [p[0] + t * (q[0] - p[0]), d]; };
    if (pin && qin) out.push({ p: q, src: i });
    else if (pin && !qin) { out.push({ p: X(), src: i }); exits++; }
    else if (!pin && qin) { out.push({ p: X(), src: -1 }); out.push({ p: q, src: i }); }
  }
  return { pts: out, runs: exits };
}
const areaUV = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return a / 2; };
const weightedStoreys = (st, r) => (typeof st === 'number' ? st : weighted(st, r));

/**
 * Plans one house. Input:
 *   preset, id (the record's durable id), groupId (the joined group's: a semi's halves, a row's houses share it),
 *   dwellings (this outline's, from the shared dataset's count), ring ([[x, z], ...] outer, counter-clockwise),
 *   edges (buildings.js footprintEdges' edges: { ax, az, bx, bz, nx, nz, len, kind, street }), y0 (ground height),
 *   roadDist(x, z) (m to the nearest road's centreline, or Infinity), nearRoad ({ x, z } | null: the nearest road point,
 *   for a house with no street edge), lin(hex) (an sRGB hex to the linear rgb the roof batch holds); for a shop also
 *   `h` (the data's height), `style` and `variant` (the facade style the building would have had).
 * Returns { ok: false, reason } or { ok: true, ring, kinds, cover (source edge per new edge), variant, brickHex, eaveH,
 *   records, pushRoof(A), stats }. Heights are above y0 + the plan's own origin; `eaveH` is the wall top above y0.
 */
export function planHouse(inp) {
  const { preset, id, ring, edges, y0 = 0, roadDist = () => Infinity, nearRoad = null, lin } = inp; // (inp.covered: the record's covered edges, edge -> neighbour's roof height)
  const D = DRAW[preset] || ROSEDALE_DRAW[preset];
  if (!D) return { ok: false, reason: 'not-drawn' };
  if (D.kind === 'shop') return planShop(inp, D);
  if (D.kind === 'block') return planBlock(inp, D);
  if (D.kind === 'worship') return planWorship(inp, D);
  const gid = inp.groupId || id;
  const R = (label) => stream(gid, `${preset}:${label}`);
  const fail = (reason, detail) => ({ ok: false, reason, detail });

  // ---- the front edge: a street edge that took the building's entrance, else the edge that best faces the nearest road. If the
  //      outline cannot be drawn from that edge (a short oblique edge on a ragged outline), the other street edges and
  //      road-facing edges are tried, longest first, and the first that fits is the front
  if (edges.some((e) => e.street && e.kind === WALL.shop)) return fail('shop-front');
  let fi = edges.findIndex((e) => e.street && e.kind === WALL.entry);
  let viaRoad = false;
  if (fi < 0) {
    if (nearRoad) {
      let best = -1, bestScore = 0;
      edges.forEach((e, i) => {
        if (e.kind < 0 || e.kind === WALL.lotLine || e.len < 3) return;
        const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2, dx = nearRoad.x - mx, dz = nearRoad.z - mz, d = Math.hypot(dx, dz) || 1;
        const facing = (e.nx * dx + e.nz * dz) / d;
        if (facing > 0.5 && e.len * facing > bestScore) { bestScore = e.len * facing; best = i; }
      });
      fi = best; viaRoad = fi >= 0;
    }
    if (fi < 0) return fail('no-front');
  }
  const cands = [fi];
  const alt = edges.map((e, i) => [e, i]).filter(([e, i]) => i !== fi && e.len >= 3 && e.kind >= 0 && e.kind !== WALL.lotLine && (e.street || (nearRoad && (e.nx * (nearRoad.x - (e.ax + e.bx) / 2) + e.nz * (nearRoad.z - (e.az + e.bz) / 2)) / (Math.hypot(nearRoad.x - (e.ax + e.bx) / 2, nearRoad.z - (e.az + e.bz) / 2) || 1) > 0.5)));
  alt.sort((p, q) => q[0].len - p[0].len);
  for (const [, i] of alt.slice(0, 3)) cands.push(i);
  let first = null;
  for (const c of cands) {
    const r = planFrom(c);
    if (r.ok) { r.stats.altFront = c !== fi; return r; }
    first = first || r;
  }
  return first;

  function planFrom(fi) {
  const fe = edges[fi];
  if (fe.len < 3) return fail('front-short');
  // the run's front line (snapFronts): the front moves outward by `sh` m, so the block's composed front is on the run's line
  let sh = inp.frontShift && inp.frontShift.edge === fi ? inp.frontShift.s : 0;
  // (a front carried more than 1.5 m toward the street stays 5 m clear of the road's centreline: else it is held at 1.5 m)
  if (sh > 1.5 && roadDist((fe.ax + fe.bx) / 2 + fe.nx * sh, (fe.az + fe.bz) / 2 + fe.nz * sh) < 5.0) sh = 1.5;
  const F = makeFrame([fe.ax + fe.nx * sh, fe.az + fe.nz * sh], [fe.bx + fe.nx * sh, fe.bz + fe.nz * sh]);

  // ---- the outline in the frame: the composed front's width, the main block's depth, the rear wing
  const rUV = ring.map(([x, z]) => F.uv(x, z));
  let vmin = Infinity, vmax = -Infinity;
  for (const [, v] of rUV) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
  if (vmax < 4.5) return fail('too-small');
  const area = Math.abs(areaUV(rUV));
  if (vmin < -0.5) { // what stands in front of the front line must be small: a bay or a porch, not the house
    const front = clipBack(rUV.map(([u, v]) => [u, -v]), 0.5);
    if (front.pts.length >= 3 && Math.abs(areaUV(front.pts.map((q) => q.p))) > area * 0.25) return fail('front-bulge');
  }
  const ex = [2, 3, 4, 5, 6, 7].filter((v) => v < vmax - 0.3).map((v) => extentAt(rUV, v)).filter(Boolean);
  if (!ex.length) ex.push(...[0.8, 1.6].map((v) => extentAt(rUV, Math.min(v, vmax - 0.2))).filter(Boolean));
  if (!ex.length) return fail('too-irregular');
  const mid = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
  const u0 = mid(ex.map((e) => e[0])), u1 = mid(ex.map((e) => e[1])), Wd = u1 - u0;
  let dMain = vmax;
  const off = (v) => { const e = extentAt(rUV, v); return !e || Math.abs(e[0] - u0) > 0.9 || Math.abs(e[1] - u1) > 0.9; };
  for (let v = 4; v < vmax; v += 0.5) {
    if (off(v)) { // (the step is between v - 0.5 and v: found to a centimetre, and the block ends a hair inside the wing)
      let lo = v - 0.5, hi = v;
      for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (off(m)) hi = m; else lo = m; }
      dMain = hi + 0.03; break;
    }
  }
  if (vmax - dMain < 1.8) dMain = vmax;
  // (the run's back line, snapFronts: the block ends where its neighbours' do, so one ridge and one back eave carry along the row)
  let depthRefused = false;
  if (inp.frontShift && inp.frontShift.edge === fi && inp.frontShift.depth > 4.5) {
    // (a cut must leave a rear wing that stands: what lies behind the cut is one piece of at least 4 m2, else the house keeps its own depth, so
    // nothing is sliced off and no wall is left hanging)
    const want = inp.frontShift.depth + sh;
    if (want < dMain - 0.05) {
      const cl = clipBack(rUV, want), pts = cl.pts.filter((q, i, a) => { const p = a[(i + a.length - 1) % a.length].p; return Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) > 0.05; });
      if (cl.runs === 1 && pts.length >= 3 && Math.abs(areaUV(pts.map((q) => q.p))) >= 4) dMain = want; else depthRefused = true;
    } else dMain = want;
  }
  if (Wd < 3.4 || dMain < 4.5) return fail('too-small', { Wd, dMain, vmax, vmin, L: fe.len });
  if (fe.len < Wd * 0.3) return fail('front-short');
  let inside = 0, total = 0;
  // (insideUV at every sample of a 0.7 m grid, row by row: the edges' crossings of a row are found once for all its samples; a sample is
  // inside when an odd number of them lie beyond it, the very test and arithmetic of insideUV, so the same count)
  const us = [];
  for (let u = u0 + 0.35; u < u1; u += 0.7) us.push(u);
  const xs = new Float64Array(rUV.length);
  for (let v = Math.max(0.35, sh + 0.35); v < dMain; v += 0.7) {
    let m = 0;
    for (let i = 0, j = rUV.length - 1; i < rUV.length; j = i++) {
      const a = rUV[i], b = rUV[j];
      if ((a[1] > v) !== (b[1] > v)) xs[m++] = (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]) + a[0];
    }
    for (const u of us) {
      total++;
      let c = false;
      for (let k = 0; k < m; k++) if (u < xs[k]) c = !c;
      if (c) inside++;
    }
  }
  if (!total || inside / total < (inp.fillMin ?? D.fillMin)) return fail('too-irregular');
  const Dp = dMain;
  // the rear wing: the outline behind the block, if it is one piece and big enough to see
  let wingPts = null;
  if (dMain < vmax - 0.01) {
    const cl = clipBack(rUV, dMain);
    // (points closer than 5 cm to the one before are one point: a cut that lands on a corner would leave a hair of an edge)
    const pts = cl.pts.filter((q, i, a) => { const p = a[(i + a.length - 1) % a.length].p; return Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) > 0.05; });
    if (cl.runs === 1 && pts.length >= 3 && Math.abs(areaUV(pts.map((q) => q.p))) >= 4) wingPts = pts;
  }
  // a side's neighbour: outline edges lying on the side line (within 0.9 m of it) over the block's depth, by their kind
  const sideOf = (side) => {
    let lot = 0, hid = 0, cov = NaN;
    edges.forEach((e, i) => {
      if (!(e.kind === WALL.lotLine || e.kind === -1)) return;
      const [ua, va] = F.uv(e.ax, e.az), [ub, vb] = F.uv(e.bx, e.bz);
      const on = Math.abs((ua + ub) / 2 - (side < 0 ? u0 : u1)) <= 0.9 && Math.max(Math.abs(ua - (side < 0 ? u0 : u1)), Math.abs(ub - (side < 0 ? u0 : u1))) <= 0.9;
      if (!on || Math.abs(vb - va) <= Math.abs(ub - ua)) return;
      const len = Math.max(0, Math.min(Dp, Math.max(va, vb)) - Math.max(0, Math.min(va, vb)));
      if (len <= 0) return;
      if (e.kind === -1) hid += len; else lot += len;
      const c = inp.covered && inp.covered.get(i);
      if (c != null && !(c <= cov)) cov = c;
    });
    const party = lot + hid >= Dp * 0.3;
    return { party, kind: !party ? WALL.rear : hid > lot ? -1 : WALL.lotLine, cover: party ? cov : NaN };
  };
  const sideL = sideOf(-1), sideR = sideOf(1);
  const partyL = sideL.party, partyR = sideR.party;
  // (the roof carried over a gap to the neighbour, snapFronts: on a party side only)
  const carryOn = inp.frontShift && inp.frontShift.edge === fi;
  const cL = carryOn && partyL ? inp.frontShift.carryL || 0 : 0, cR = carryOn && partyR ? inp.frontShift.carryR || 0 : 0;
  // (frameOnly: buildings.js' first pass asks for the front line alone (snapFronts); every way a plan can fail before this point is above,
  // and the ones below (other-facade, one-storey, too-tall) cannot happen without the style and height that pass does not give)
  if (inp.frameOnly) return { ok: true, stats: {}, frame: { A: [F.ax, F.az], t: [F.tx, F.tz], L: fe.len, u0, u1, z0: 0, z1: Dp, partyL, partyR, edge: fi, shift: sh } };

  // ---- dwellings: the shared dataset's count, kept to a believable frontage each
  const dw = Math.max(1, inp.dwellings || 1);
  let N;
  if (D.kind === 'detached') N = 1;
  else if (D.kind === 'semi') N = dw >= 2 && Wd / 2 >= 3.4 ? 2 : 1;
  else { N = clamp(dw, 1, 12); if (Wd / N < 3.2 || Wd / N > 8.5) N = Math.max(1, Math.round(Wd / 4.8)); }

  // ---- the group's choices (one brick, roof, trim, facade style, pitch for joined houses). New draws go on the end, so
  //      the older ones keep their values.
  const g = R('group');
  const gr = { variant: g(), brick: g(), glass: g(), roofCol: g(), patch: g(), trim: g(), pitch: g(), eave: g(), deck: g(), mrise: g(), side: g(), form: g(), accent: g(), barge: g(), attic: g(), atticH: g(), bay: g(), bayW: g(), bayD: g(), bayC: g(), bayR: g(), porch: g(), porchD: g(), pier: g(), slab: g(), dorm: g(), dormW: g(), dormH: g(),
    stor: g(), ridge: g(), dRise: g(), shell: g(), timber: g(), vest: g(), vestW: g(), vestD: g(), vestH: g(), stoop: g(), stoopW: g(), stoopD: g(), garage: g(), garW: g(), garH: g(), pic: g(), picW: g(), picH: g(), xg: g(), xgW: g(), doorW: g(), cornice: g(), corD: g(), corH: g(), sillC: g(), lintC: g(),
    chim: g(), chimW: g(), chimR: g(), chimSide: g(), shut: g(), shutC: g(), tur: g(), turR: g(), turH: g(), turSide: g(), port: g(), portW: g(), portD: g(), portH: g(), yKind: g(), yHed: g(), yDrive: g(), yHedH: g(), yWall: g() };
  const vlist = inp.variants || D.variants; // (a Rosedale house's facade styles: smaller windows than the downtown presets')
  const variantIdx = vlist[Math.floor(gr.variant * vlist.length) % vlist.length];
  const variant = FIRST_DRAW_VARIANT + variantIdx;
  const floorH = FACADE_VARIANTS[variantIdx].floorHeight;
  // (jf-bya: a Rosedale house's storeys, roof form and pitch come from the lidar's roof, `inp.hint` = js/rosedale-houses.js roofHint; its eave from the lidar's eave)
  const hint = inp.hint || null;
  const storeys = hint && hint.eave > 0 ? clamp(Math.round(hint.eave / floorH), 1, 3) : weightedStoreys(D.storeys, gr.stor);
  const eaveH = storeys * floorH;
  const wingH = storeys >= 2 ? Math.min(2, storeys - 1) * floorH : Math.min(eaveH, 2.7);
  const brickHex = weighted(D.wall, gr.brick);
  const brick = D.brickShare == null ? true : gr.shell < D.brickShare;
  const trimHex = weighted(D.trim, gr.trim);
  const roofHex = inp.roofHex != null ? inp.roofHex : weighted(D.roof.colors, gr.roofCol); // (a Rosedale house's roof colour is its style's, js/rosedale-houses.js LOOKS)
  const roofRgb = lin(roofHex), trimRgb = lin(trimHex), brickRgb = lin(brickHex), glassRgb = lin(0x1d262b);
  // a patched roof (a repaired slope in another tone), now and then; the group's, so joined houses agree
  const patched = inp.roofHex == null && gr.patch < (D.roof.patch || 0);
  const roofRgbL = patched ? lin(weighted(D.roof.colors, (gr.roofCol * 5.17) % 1)) : null;
  const pitch = rad(hint && hint.pitch >= 14 ? clamp(hint.pitch, 18, 58) : lerp(gr.pitch, D.roof.pitch));
  const eave = lerp(gr.eave, D.roof.eave);
  let form = weighted(D.roof.forms, gr.form);
  if (hint && hint.form) {
    // (the ridge across the front = the street sees the eave and a side gable; along it = the gable faces the street)
    const across = Math.abs(hint.ridge[0] * F.tx + hint.ridge[1] * F.tz) > 0.7;
    const hf = hint.form === 'flat' ? 'flat' : hint.form === 'hip' ? 'hip' : hint.form === 'gable' ? (across ? 'sideGable' : 'frontGable') : (across ? 'crossGable' : 'hipGable');
    if (hf !== 'flat' || D.roof.parapet || D.roof.forms.some(([f]) => f === 'flat')) form = hf;
    else if (hf === 'flat') form = 'hip';
  }
  // a hip stands alone: against a party wall the group's roof carries on as a side gable, so a pair of outlines has no seam
  if (form === 'hip' && (partyL || partyR)) form = 'sideGable';
  if (form === 'hipGable' && (partyL || partyR)) form = 'crossGable';
  // joined houses share their ridge height (a row's gables, a pair's), so the pitch follows each house's width
  const ridgeR = D.kind === 'detached' ? null : lerp(gr.ridge, D.roof.ridge || (D.kind === 'semi' ? [2.9, 3.6] : [2.4, 3.1]));
  const acc = D.parts.gableAccent && gr.accent < D.parts.gableAccent.p;
  const accentRgb = acc ? lin(weighted(D.parts.gableTones || D.trim, (gr.accent * 7.31) % 1)) : brickRgb;
  const bayOn = D.parts.bay && gr.bay < D.parts.bay.p;
  const chimSpec = D.parts.chimney || (inp.yard ? { p: 0.75, mode: 'ridge', size: [0.7, 0.9], rise: [1.0, 1.4] } : null); // (a Rosedale house with a preset that draws none still shows one)
  const tw = [lerp(gr.bayW, D.parts.bay ? D.parts.bay.width : [0, 0]), lerp(gr.bayD, D.parts.bay ? D.parts.bay.depth : [0, 0])];
  const stats = { N, form, viaRoad, bays: 0, porches: 0, dormers: 0, gables: 0, bargeboards: 0, wings: 0, vestibules: 0, stoops: 0, garages: 0, pictureWindows: 0, timbered: 0, crossGables: 0, parapets: 0, roofTris: 0, storeys, wingArea: 0, sills: 0, lintels: 0, columns: 0, detailTris: 0, depthRefused: depthRefused ? 1 : 0 };

  // ---- the front edge's stretches: window wall (rear kind) by default and a door stretch per dwelling (entry); the wall
  //      behind a bay stays (the mid tier, which has no bays, still needs it)
  const bays = []; // { b0, b1 } on the front line
  const doors = [];
  const stretch = [{ a: u0, b: u1, kind: WALL.rear }];
  const paint = (a, b, kind) => {
    a = Math.max(u0, a); b = Math.min(u1, b);
    if (!(b - a > 0.05)) return;
    const out = [];
    for (const s of stretch) {
      if (s.b <= a || s.a >= b) { out.push(s); continue; }
      if (s.a < a) out.push({ a: s.a, b: a, kind: s.kind });
      out.push({ a: Math.max(a, s.a), b: Math.min(b, s.b), kind });
      if (s.b > b) out.push({ a: b, b: s.b, kind: s.kind });
    }
    stretch.length = 0; stretch.push(...out);
  };
  const du = Wd / N; // dwelling k spans u0 + k*du .. u0 + (k+1)*du in the frame (the front edge's own u is 0..L)
  const dwellingSpan = (k) => [u0 + k * du, u0 + (k + 1) * du];

  // the dwelling's outer side (-1 left / +1 right): away from a party wall; the halves of a semi mirror each other
  const outerSide = (k) => {
    if (N === 2) return k === 0 ? -1 : 1;
    if (N === 1) return partyL && !partyR ? 1 : partyR && !partyL ? -1 : gr.side < 0.5 ? -1 : 1;
    return gr.side < 0.5 ? -1 : 1;
  };

  const records = [];
  const fenced = (p, labelRoad) => { // a part standing out of the wall must keep clear of the street
    const [x, z] = F.xz(p.u, -p.out);
    return roadDist(x, z) >= labelRoad;
  };

  // bays (semi, row)
  const bayPts = [];
  if (D.parts.bay && bayOn) {
    for (let k = 0; k < N; k++) {
      const [a, b] = dwellingSpan(k);
      const w = b - a, side = outerSide(k);
      const bw = clamp(tw[0] * Math.min(1, w / 5.2), 1.9, w - 1.7);
      if (bw < 1.9) continue;
      const margin = 0.3;
      const b0 = side < 0 ? a + margin : b - margin - bw, b1 = b0 + bw;
      if (b0 < u0 + 0.2 || b1 > u1 - 0.2) continue;
      if (!fenced({ u: (b0 + b1) / 2, out: tw[1] }, D.parts.bay.minRoad)) continue;
      const cant = clamp(lerp(gr.bayC, D.parts.bay.cant), 0.3, bw / 3);
      bays.push({ b0, b1, cant, depth: tw[1], k });
    }
  }
  // door stretches. The first three presets: beside the bay, nearest the party wall for a semi (the doors paired), else the
  // free stretch. The later presets (a vestibule, a stoop or a garage): a door-wide stretch of its own, so the door, the
  // vestibule or stoop and the garage sit where they are drawn; windows on the rest of the front
  const narrow = !!(D.parts.vestibule || D.parts.stoop || D.parts.portico || D.centreDoor);
  const doorW = lerp(gr.doorW, D.kind === 'row' || D.parts.garage ? [1.8, 2.0] : [2.0, 2.2]);
  for (let k = 0; k < N; k++) {
    const [a, b] = dwellingSpan(k);
    if (narrow) {
      const side = outerSide(k), inner = N === 2 ? -side : (gr.side < 0.5 ? -1 : 1) * -1; // (semi: next to the party wall; else by the group's side)
      const d0 = D.centreDoor ? (a + b) / 2 - doorW / 2 : inner > 0 ? b - 0.55 - doorW : a + 0.55, d1 = d0 + doorW; // (a Georgian front door stands in the middle)
      doors.push([d0, d1, k]);
      continue;
    }
    const bay = bays.find((x) => x.k === k);
    let d0 = a, d1 = b;
    if (bay) { if (bay.b0 - a > b - bay.b1) { d0 = a; d1 = bay.b0; } else { d0 = bay.b1; d1 = b; } }
    paint(d0, d1, WALL.entry);
    doors.push([d0, d1, k]);
  }
  // a vestibule is its own entrance (its front face is the entry wall); a stoop stands at the door in the wall
  const vestibules = [];
  if (D.parts.vestibule && gr.vest < D.parts.vestibule.p) {
    for (const [d0, d1, k] of doors) {
      const vw = Math.max(doorW + 0.1, lerp(gr.vestW, D.parts.vestibule.width)), vd = lerp(gr.vestD, D.parts.vestibule.depth), c = (d0 + d1) / 2;
      if (!fenced({ u: c, out: vd }, 6.5)) continue;
      vestibules.push({ c, vw, vd, wallH: lerp(gr.vestH, D.parts.vestibule.wall), k });
    }
  }
  for (const [d0, d1] of doors) if (narrow) paint(d0, d1, vestibules.some((v) => Math.abs(v.c - (d0 + d1) / 2) < 0.01) ? WALL.rear : WALL.entry);

  // ---- the new outline: the rectangle, its front edge cut at every stretch boundary
  const merged = [];
  for (const s of stretch) {
    const last = merged[merged.length - 1];
    if (last && last.kind === s.kind && s.kind !== WALL.entry) last.b = s.b; else if (s.b - s.a < 0.12 && last) last.b = s.b; else merged.push({ ...s });
  }
  const newRing = [], kinds = [], cover = [];
  merged.forEach((s) => { newRing.push(F.xz(s.a, 0)); kinds.push(s.kind); cover.push(NaN); });
  const frontWalls = merged.map((s) => ({ a: s.a, b: s.b, kind: s.kind })); // (the front's wall pieces: the sills and lintels' windows, js/building-draw-detail.js)
  newRing.push(F.xz(u1, 0), F.xz(u1, Dp), F.xz(u0, Dp)); // (right side, back, left side follow the front)
  kinds.push(sideR.kind, WALL.rear, sideL.kind);
  cover.push(sideR.cover, NaN, sideL.cover);

  // ---- the rear wing, a record of its own: lower, flat-roofed. Its edges take the real outline's kinds and covers; the cut
  //      against the block's rear wall is hidden where the block stands behind it (the block's wall shows above the wing)
  const topH = y0 + eaveH;
  let wingRing = null;
  if (wingPts) {
    const wring = [], wkinds = [], wcover = [];
    wingPts.forEach((q, i) => {
      // (the edge that STARTS at this point runs to the next; `src` tags the edge that leads to a point, so shift by one)
      const nx = wingPts[(i + 1) % wingPts.length];
      wring.push(F.xz(q.p[0], q.p[1]));
      const src = nx.src;
      if (src >= 0) { wkinds.push(edges[src].kind); wcover.push(inp.covered && inp.covered.has(src) ? inp.covered.get(src) : NaN); }
      else { const m = (q.p[0] + nx.p[0]) / 2; wkinds.push(m > u0 && m < u1 ? -1 : WALL.rear); wcover.push(NaN); }
    });
    wingRing = wring;
    records.push({ kind: 'wing', rings: [wring], kinds: wkinds, cover: wcover, base: y0, h: y0 + wingH, capY: y0 + wingH - 0.05, brick, hex: brickHex, variant, glass: gr.glass, nearOnly: false });
    stats.wings = 1; stats.wingArea = Math.abs(areaUV(wingPts.map((q) => q.p)));
  }

  // ---- extras: bays, porch, vestibule, stoop (near tier only)
  const bayExtras = [];
  for (const b of bays) {
    const c = b.cant, d = b.depth;
    const pts = [[b.b0, 0], [b.b0 + c, -d], [b.b1 - c, -d], [b.b1, 0]]; // (u, v): v negative is out of the wall
    const ringB = pts.map(([u, v]) => F.xz(u, v));
    records.push({ kind: 'bay', rings: [ringB], kinds: [WALL.rear, WALL.rear, WALL.rear, -1], base: y0, h: topH, capY: topH - 0.06, brick, hex: brickHex, variant, glass: gr.glass, nearOnly: true });
    bayExtras.push(pts);
    stats.bays++;
  }
  let porch = null;
  if (D.parts.porch && gr.porch < D.parts.porch.p) {
    const depth = lerp(gr.porchD, D.parts.porch.depth);
    const p0 = u0, p1 = u1;
    const tip = F.xz((p0 + p1) / 2, -depth);
    if (roadDist(tip[0], tip[1]) >= D.parts.porch.minRoad && Wd >= 4.2) {
      const slabY = lerp(gr.slab, D.parts.porch.slab), pier = lerp(gr.pier, D.parts.porch.pier);
      const ringP = [F.xz(p0, 0), F.xz(p0, -depth), F.xz(p1, -depth), F.xz(p1, 0)];
      records.push({ kind: 'porch-slab', rings: [ringP], kinds: [WALL.lotLine, WALL.lotLine, WALL.lotLine, -1], base: y0 + slabY, h: y0 + slabY + 0.3, capY: y0 + slabY + 0.3, brick: false, hex: trimHex, variant, glass: 0, nearOnly: true });
      const nPier = Wd > 8.5 ? 3 : 2;
      // (st-ndw9.18: a porch with `columns` stands on brick plinths with wooden columns above them, drawn in the near roof)
      const plinth = D.parts.porch.columns ? 0.95 : null, piers = [];
      for (let i = 0; i < nPier; i++) {
        const uc = nPier === 1 ? (p0 + p1) / 2 : p0 + pier / 2 + 0.06 + (i * (p1 - p0 - pier - 0.12)) / (nPier - 1);
        const hw = pier / 2, vc = -(depth - pier / 2 - 0.08), top = plinth ? y0 + plinth : y0 + slabY;
        records.push({ kind: 'porch-pier', rings: [[F.xz(uc - hw, vc + hw), F.xz(uc - hw, vc - hw), F.xz(uc + hw, vc - hw), F.xz(uc + hw, vc + hw)]], kinds: [WALL.lotLine, WALL.lotLine, WALL.lotLine, WALL.lotLine], base: y0 + 0.42, h: top, capY: top, brick, hex: brickHex, variant, glass: gr.glass, nearOnly: true });
        piers.push({ uc, vc, hw });
      }
      porch = { depth, slabY, p0, p1, plinth, piers };
      stats.porches++;
    }
  }
  for (const v of vestibules) { // (the front face is an entry wall: the shader draws the door in its only bay)
    const hw = v.vw / 2, ringV = [F.xz(v.c - hw, 0), F.xz(v.c - hw, -v.vd), F.xz(v.c + hw, -v.vd), F.xz(v.c + hw, 0)];
    records.push({ kind: 'vestibule', rings: [ringV], kinds: [WALL.lotLine, WALL.entry, WALL.lotLine, -1], base: y0, h: y0 + v.wallH, capY: y0 + v.wallH - 0.03, brick, hex: brickHex, variant, glass: gr.glass, nearOnly: true });
    stats.vestibules++;
  }
  const stoops = [];
  if (D.parts.stoop && gr.stoop < D.parts.stoop.p) {
    for (const [d0, d1] of doors) {
      const sw = Math.max(doorW + 0.3, lerp(gr.stoopW, D.parts.stoop.width)), sd = lerp(gr.stoopD, D.parts.stoop.depth), c = (d0 + d1) / 2;
      if (!fenced({ u: c, out: sd }, 6.0)) continue;
      const hw = sw / 2;
      records.push({ kind: 'stoop', rings: [[F.xz(c - hw, 0), F.xz(c - hw, -sd), F.xz(c + hw, -sd), F.xz(c + hw, 0)]], kinds: [WALL.lotLine, WALL.lotLine, WALL.lotLine, -1], base: y0, h: y0 + 0.36, capY: y0 + 0.36, brick: false, hex: 0xbdb9b0, variant, glass: 0, nearOnly: true });
      stoops.push({ c, sw }); stats.stoops++;
    }
  }

  // a portico (Georgian): the stoop's slab under a gabled roof on two columns
  const porticoes = [];
  if (D.parts.portico && gr.port < D.parts.portico.p) {
    for (const [d0, d1] of doors) {
      const pw = Math.max(doorW + 0.5, lerp(gr.portW, D.parts.portico.width)), pd = lerp(gr.portD, D.parts.portico.depth), c = (d0 + d1) / 2;
      if (!fenced({ u: c, out: pd }, D.parts.portico.minRoad)) continue;
      const hw = pw / 2;
      records.push({ kind: 'stoop', rings: [[F.xz(c - hw, 0), F.xz(c - hw, -pd), F.xz(c + hw, -pd), F.xz(c + hw, 0)]], kinds: [WALL.lotLine, WALL.lotLine, WALL.lotLine, -1], base: y0, h: y0 + 0.36, capY: y0 + 0.36, brick: false, hex: 0xbdb9b0, variant, glass: 0, nearOnly: true });
      porticoes.push({ c, w: pw, depth: pd, h: lerp(gr.portH, D.parts.portico.height) });
      stats.porticoes = (stats.porticoes || 0) + 1;
    }
  }
  // a corner turret (Queen Anne): a six-sided drum standing out of the front corner, a record of its own (the facade shader draws its windows), under a cone
  let turret = null;
  if (D.parts.turret && gr.tur < D.parts.turret.p && Wd >= 6.5) {
    const tr = lerp(gr.turR, D.parts.turret.radius), side = gr.turSide < 0.5 ? -1 : 1;
    // (on the street side of a joined house: never against a party wall)
    const left = side < 0 ? !partyL : !partyR;
    const uc = left ? (side < 0 ? u0 + tr * 0.55 : u1 - tr * 0.55) : null;
    if (uc != null && fenced({ u: uc, out: tr * 1.2 }, D.parts.turret.minRoad) && !bays.some((b) => b.b1 > uc - tr - 0.3 && b.b0 < uc + tr + 0.3)) {
      const vc = -tr * 0.45, n = 6, rise = lerp(gr.turH, D.parts.turret.rise);
      const ringT = [];
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + Math.PI / 6; ringT.push(F.xz(uc + Math.cos(a) * tr, vc + Math.sin(a) * tr)); }
      records.push({ kind: 'turret', rings: [ringT], kinds: ringT.map(() => WALL.rear), base: y0, h: topH + rise, capY: topH + rise - 0.05, brick, hex: brickHex, variant, glass: gr.glass, nearOnly: true });
      turret = { u: uc, v: vc, r: tr, n, y: topH + rise, h: tr * 1.9 };
      stats.turrets = (stats.turrets || 0) + 1;
    }
  }

  // the front yard of a Rosedale house (inp.yard = { lotW (m, 0 unknown), park (0 none, else the City licenses parking in the front yard) }): the walk to the door, a
  // hedge or a low wall along the lot line, a drive where the lot allows
  let yard = null;
  if (inp.yard && doors.length) {
    const dMid = roadDist(...F.xz((u0 + u1) / 2, -2));
    const yd = Math.min(12, dMid + 2 - 8.2); // (the lot line stands about 8 m from the road's centreline: half the road, the boulevard and the sidewalk)
    if (Number.isFinite(yd) && yd >= 2.2) {
      const lotW = inp.yard.lotW || 0, extra = lotW > 0 ? clamp((lotW - Wd) / 2, 0.3, 6) : 1.0;
      const uA = partyL ? u0 : u0 - extra, uB = partyR ? u1 : u1 + extra;
      const c = (doors[0][0] + doors[0][1]) / 2;
      const kind = gr.yKind < 0.42 ? 'hedge' : gr.yKind < 0.66 ? 'wall' : null;
      let drive = null;
      const room = (side) => (side < 0 ? (partyL ? 0 : extra) : (partyR ? 0 : extra));
      const side = outerSide(0), dw = 3.0;
      if (inp.yard.park && yd >= 4) { // a licensed front-yard pad: beside the walk, at the street end of the yard
        const a = side < 0 ? u0 + 0.4 : u1 - 0.4 - dw;
        drive = { u0: a, u1: a + dw, to: -0.5, rgb: lin(0x6c6b68) };
      } else if (lotW > 0 && room(side) >= dw + 0.6 && gr.yDrive < 0.3) { // a side drive, along the house to the back
        const a = side < 0 ? u0 - 0.3 - dw : u1 + 0.3, to = Math.min(Dp, 8);
        drive = { u0: a, u1: a + dw, to, rgb: lin(0x56565a) };
      }
      const stone = kind === 'wall' && gr.yWall < 0.55;
      const green = weighted([[0x24392a, 4], [0x2b4630, 3], [0x1f3324, 3]], gr.yHedH);
      yard = { y0, uA, uB, yd, gap: [c - 0.7, c + 0.7], kind, hh: kind === 'wall' ? 0.7 + gr.yHedH * 0.3 : 0.8 + gr.yHedH * 0.5,
        rgb: kind === 'hedge' ? lin(green) : stone ? lin(0x9a968c) : shade(brickRgb, 0.85), pier: stone ? lin(0xb5b0a4) : shade(brickRgb, 1.1), walk: lin(0xb4b0a6), drive };
      stats.yards = 1;
    }
  }

  // ---- parapets and the front cornice of a flat roof: small records, near tier only (as the bays and porches are)
  const tar = tarRgb(lin, gid, id, preset);
  if (form === 'flat') {
    const ph = lerp(gr.mrise, D.roof.parapet || [0.3, 0.5]), t = 0.18;
    const sidesP = [[[u0, 0], [u1, 0], F.out, false]]; // (the front only: the sides and back are not seen from the street, and a record costs about 9 near-tier triangles)
    for (const [a, b, o, skip] of sidesP) {
      if (skip) continue;
      const A = F.xz(...a), B = F.xz(...b), out = [o[0], o[2]];
      records.push({ kind: 'parapet', rings: [[A, B, [B[0] - out[0] * t, B[1] - out[1] * t], [A[0] - out[0] * t, A[1] - out[1] * t]]], kinds: [WALL.lotLine, WALL.lotLine, WALL.lotLine, WALL.lotLine], base: topH, h: topH + ph, capY: topH + ph, brick: false, hex: brickHex, variant, glass: 0, nearOnly: true });
      stats.parapets++;
    }
    if (D.parts.cornice) {
      const cd = lerp(gr.corD, D.parts.cornice.depth), ch = lerp(gr.corH, D.parts.cornice.height), A = F.xz(u0, 0), B = F.xz(u1, 0), out = [F.out[0], F.out[2]];
      records.push({ kind: 'cornice', rings: [[A, [A[0] + out[0] * cd, A[1] + out[1] * cd], [B[0] + out[0] * cd, B[1] + out[1] * cd], B]], kinds: [WALL.lotLine, WALL.lotLine, WALL.lotLine, -1], base: topH - ch, h: topH + 0.04, capY: topH + 0.04, brick: false, hex: trimHex, variant, glass: 0, nearOnly: true });
    }
  }

  // ---- the roof
  const z0 = 0, z1 = Dp;
  const garageSpec = D.parts.garage && gr.garage < D.parts.garage.p;
  const picSpec = D.parts.pictureWindow && gr.pic < D.parts.pictureWindow.p;
  // lod: the far roof (st-ndw9.21): the roof's own planes and the walls under them, without the small things that stand on it (dormers,
  // bargeboards, attic windows, timbering, gable bands, bay roofs, vestibule roofs, garage and picture-window quads)
  const pushRoof = (A, lod = false) => {
    const W = writer(A);
    const yE = y0 + eaveH;
    let info = null; // (the roof's own lines, for tools/report-row-steps.mjs)
    let rg = null; // (the main ridge, for the chimneys: { alongU, c (its other coordinate), a, b (its ends), top })
    const sides = (k) => ({ eL: (k === 0 && partyL) ? cL : (N > 1 && k > 0) ? 0 : eave, eR: (k === N - 1 && partyR) ? cR : (N > 1 && k < N - 1) ? 0 : eave });
    const hipDormers = (hr) => {
      if (lod || !(D.parts.dormer && gr.dorm < D.parts.dormer.p)) return;
      const dm = D.parts.dormer, dwid = lerp(gr.dormW, dm.width), vRef = hr.vF, tanP = Math.tan(hr.pitch ?? pitch);
      const inset = hr.alongU ? Math.min(hr.half * 0.8, 1.6) : dwid / 2 + 0.55;
      const gableRise = (dwid / 2) * Math.tan(rad(36));
      const room = hr.rise - 0.15 - inset * tanP - gableRise; // (the wall may not carry its roof past the ridge)
      const hw = Math.min(lerp(gr.dormH, dm.wall), room);
      if (!(hw >= 0.8 && (hr.alongU || inset < hr.half))) return;
      const centres = hr.alongU && N > 1 ? Array.from({ length: N }, (_, k) => { const [a, b] = dwellingSpan(k); return (a + b) / 2; }) : [(u0 + u1) / 2];
      for (const uc of centres) {
        dormer(W, F, { u: uc, w: dwid, vFace: vRef + inset, vRef, yRef: yE, pitch: hr.pitch ?? pitch, hw, rgb: trimRgb.map((c) => c * 0.9), trimRgb, glassRgb, roofRgb });
        stats.dormers++;
      }
    };
    const frontGable = (a, b, sd, rise) => {
      const bandA = acc ? accentRgb : shade(brickRgb, 1.0), bandB = acc ? shade(accentRgb, 0.8) : shade(brickRgb, 0.78);
      const timber = !lod && D.parts.timber && gr.timber < D.parts.timber.p ? { face: lin(weighted(TIMBER, (gr.timber * 3.7) % 1)), beam: lin(0x3a2a20) } : null;
      const gab = gableRoof(W, F, { u0: a, u1: b, v0: z0, v1: z1, y: yE, pitch, rise, eL: sd.eL, eR: sd.eR, eF: eave, eB: eave, rgb: roofRgb, rgbL: roofRgbL, endRgb: accentRgb, timber,
        bands: !timber && ((!lod && D.parts.gableBands) || inp.yard) ? { n: lod ? 4 : (D.parts.gableBands || 7), a: bandA, b: bandB, trim: trimRgb } : null }); // (a Rosedale house's front gable is in courses: a flat sheet of brick colour lit by the sun reads salmon)
      stats.gables++; if (timber) stats.timbered++;
      if (!lod && D.parts.bargeboard && gr.barge < D.parts.bargeboard.p) { bargeboard(W, F, gab, lerp(gr.barge, D.parts.bargeboard.width), trimRgb); stats.bargeboards++; }
      if (!lod && D.parts.atticWindow && gr.attic < D.parts.atticWindow.p) atticWindow(W, F, gab, lerp(gr.attic, D.parts.atticWindow.width), lerp(gr.atticH, D.parts.atticWindow.height), trimRgb, glassRgb);
      return gab;
    };
    const clampRise = (width, r) => (r == null ? null : clamp(r, (width / 2) * Math.tan(rad(26)), (width / 2) * Math.tan(rad(66))));
    if (form === 'frontGable') {
      for (let k = 0; k < N; k++) {
        const [a, b] = dwellingSpan(k);
        const sd = sides(k);
        const fg = frontGable(a, b, sd, clampRise((b - a) + sd.eL + sd.eR, ridgeR));
        if (k === 0) rg = { alongU: false, c: fg.uc, a: fg.vF, b: fg.vB, top: yE + fg.rise };
        if (!lod && k === 0) info = { form, y: yE, ridge: yE + fg.rise, vc: (fg.vF + fg.vB) / 2, vF: fg.vF, vB: fg.vB, uL: fg.uL, uR: fg.uR };
      }
      for (const pts of (lod ? [] : bayExtras)) bayRoof(W, F, pts, lerp(gr.bayR, D.parts.bay.roof), yE, roofRgb);
    } else if (form === 'sideGable' || form === 'crossGable') {
      const depth = z1 + 2 * eave;
      const sg = sideGableRoof(W, F, { u0, u1, v0: z0, v1: z1, y: yE, pitch, rise: ridgeR == null ? null : clamp(ridgeR, (depth / 2) * Math.tan(rad(18)), (depth / 2) * Math.tan(rad(45))), eL: partyL ? cL : eave, eR: partyR ? cR : eave, eF: eave, eB: eave, rgb: roofRgb, rgbL: roofRgbL, endRgb: brickRgb, partyL, partyR });
      rg = { alongU: true, c: sg.vc, a: sg.uL, b: sg.uR, top: yE + sg.rise, ends: true };
      if (!lod) info = { form, y: yE, ridge: yE + sg.rise, vc: sg.vc, vF: sg.vF, vB: sg.vB, uL: sg.uL, uR: sg.uR };
      if (form === 'crossGable') {
        // a front gable over part of the front: flush with the wall, its ridge a little under the main one, its back end
        // inside the main roof (the depth buffer hides what is under the slope). One shared gable over a pair in one outline
        // (D.roof.sharedGable), a small one each over the halves of a pair of outlines (D.roof.smallGable), else one a house
        const spans = [];
        if (D.roof.sharedGable && N === 2) { const gw = clamp(Wd * 0.34, 3.0, 4.8), c = (u0 + u1) / 2; spans.push([c - gw / 2, c + gw / 2]); }
        else for (let k = 0; k < N; k++) {
          const [a, b] = dwellingSpan(k), side = outerSide(k), w = b - a;
          const small = !!D.roof.smallGable, gw = small ? clamp(w * 0.4, 2.4, 3.4) : clamp(w * 0.5, 2.8, 4.8);
          if (w < (small ? 4.4 : 5.2)) continue;
          const ga = N === 1 && gr.xg < 0.4 ? (a + b) / 2 - gw / 2 : side < 0 ? a + 0.25 : b - 0.25 - gw;
          spans.push([ga, ga + gw]);
        }
        for (const [ga, gb] of spans) {
          const gw = gb - ga, ridge = Math.min(sg.rise * (D.roof.smallGable ? 0.88 : 0.94), (gw / 2 + eave) * Math.tan(rad(58)));
          const timber = !lod && D.parts.timber && gr.timber < D.parts.timber.p ? { face: lin(weighted(TIMBER, (gr.timber * 3.7) % 1)), beam: lin(0x3a2a20) } : null;
          const gab = gableRoof(W, F, { u0: ga, u1: gb, v0: z0, v1: sg.vc, y: yE, rise: ridge, eL: eave * 0.7, eR: eave * 0.7, eF: eave, eB: 0, rgb: roofRgb, rgbL: roofRgbL, endRgb: brickRgb, timber, bands: null });
          if (timber) stats.timbered++;
          if (!lod && D.parts.bargeboard && gr.barge < D.parts.bargeboard.p) { bargeboard(W, F, gab, lerp(gr.barge, D.parts.bargeboard.width), trimRgb); stats.bargeboards++; }
          stats.gables++; stats.crossGables++;
        }
      } else hipDormers({ vF: sg.vF, rise: sg.rise, half: sg.half, alongU: true, pitch: sg.pitch });
      for (const pts of (lod ? [] : bayExtras)) bayRoof(W, F, pts, lerp(gr.bayR, D.parts.bay.roof), yE, roofRgb);
    } else if (form === 'hip') {
      const hr = hipRoof(W, F, { u0, u1, v0: z0, v1: z1, y: yE, pitch, eL: eave, eR: eave, eF: eave, eB: eave, rgb: roofRgb });
      rg = hr.alongU ? { alongU: true, c: hr.vc, a: hr.uL + hr.half, b: hr.uR - hr.half, top: yE + hr.rise } : { alongU: false, c: hr.uc, a: hr.vF + hr.half, b: hr.vB - hr.half, top: yE + hr.rise };
      if (!lod) info = { form, y: yE, ridge: yE + hr.rise, vc: hr.vc, vF: hr.vF, vB: hr.vB, uL: hr.uL, uR: hr.uR };
      hipDormers({ ...hr });
      for (const pts of (lod ? [] : bayExtras)) bayRoof(W, F, pts, lerp(gr.bayR, D.parts.bay.roof), yE, roofRgb);
    } else if (form === 'hipGable') {
      // a hip with one front gable over the middle of the front (over the party wall of a pair in one outline)
      const hr = hipRoof(W, F, { u0, u1, v0: z0, v1: z1, y: yE, pitch, eL: eave, eR: eave, eF: eave, eB: eave, rgb: roofRgb });
      rg = hr.alongU ? { alongU: true, c: hr.vc, a: hr.uL + hr.half, b: hr.uR - hr.half, top: yE + hr.rise } : { alongU: false, c: hr.uc, a: hr.vF + hr.half, b: hr.vB - hr.half, top: yE + hr.rise };
      if (!lod) info = { form, y: yE, ridge: yE + hr.rise, vc: hr.vc, vF: hr.vF, vB: hr.vB, uL: hr.uL, uR: hr.uR };
      if (hr.alongU && Wd >= 6) {
        const gw = clamp(Wd * 0.3, 2.8, 4.2), c = (u0 + u1) / 2, ridge = Math.min(hr.rise * 0.9, (gw / 2 + eave) * Math.tan(rad(55)));
        const timber = !lod && D.parts.timber && gr.timber < D.parts.timber.p ? { face: lin(weighted(TIMBER, (gr.timber * 3.7) % 1)), beam: lin(0x3a2a20) } : null;
        const gab = gableRoof(W, F, { u0: c - gw / 2, u1: c + gw / 2, v0: z0, v1: hr.vc, y: yE, rise: ridge, eL: eave * 0.7, eR: eave * 0.7, eF: eave, eB: 0, rgb: roofRgb, rgbL: roofRgbL, endRgb: brickRgb, timber, bands: null });
        if (timber) stats.timbered++;
        if (!lod && D.parts.bargeboard && gr.barge < D.parts.bargeboard.p) { bargeboard(W, F, gab, lerp(gr.barge, D.parts.bargeboard.width), trimRgb); stats.bargeboards++; }
        stats.gables++; stats.crossGables++;
      }
      for (const pts of (lod ? [] : bayExtras)) bayRoof(W, F, pts, lerp(gr.bayR, D.parts.bay.roof), yE, roofRgb);
    } else if (form === 'mansard') {
      const mm = D.roof.mansard, steep = rad(lerp(gr.pitch, mm.steep)), deck = rad(lerp(gr.deck, mm.deck)), rise = lerp(gr.mrise, mm.rise);
      const mr = mansardRoof(W, F, { u0: u0 - cL, u1: u1 + cR, v0: z0, v1: z1, y: yE, steep, deck, rise, deckRise: lerp(gr.dRise, mm.deckRise || [0.5, 0.7]), eave: 0.2, partyL, partyR, rgb: roofRgb, deckRgb: shade(roofRgb, 1.12), trimRgb });
      if (!lod) info = { form, y: yE, ridge: mr.top, vc: (mr.vF + mr.vB) / 2, vF: mr.vF, vB: mr.vB, uL: mr.uL, uR: mr.uR };
      if (!lod && D.parts.dormer && gr.dorm < D.parts.dormer.p) {
        for (let k = 0; k < N; k++) {
          const [a, b] = dwellingSpan(k);
          const dm = D.parts.dormer;
          dormer(W, F, { u: (a + b) / 2, w: lerp(gr.dormW, dm.width), vFace: mr.vF + 0.13, vRef: mr.vF, yRef: yE, pitch: steep, hw: Math.min(lerp(gr.dormH, dm.wall), rise - 0.7), rgb: shade(roofRgb, 1.0), trimRgb, glassRgb, roofRgb });
          stats.dormers++;
        }
      }
      for (const pts of (lod ? [] : bayExtras)) bayRoof(W, F, pts, lerp(gr.bayR, D.parts.bay.roof), yE, roofRgb);
    } else if (form === 'flat') {
      // a flat roof: the tar slab over the block (its parapet and cornice are near-tier records, above)
      slab(W, [F.xz(u0, z0), F.xz(u1, z0), F.xz(u1, z1), F.xz(u0, z1)], yE - 0.015, tar);
      if (!lod) info = { form, y: yE, ridge: yE, vc: (z0 + z1) / 2, vF: z0, vB: z1, uL: u0, uR: u1 };
      for (const pts of (lod ? [] : bayExtras)) bayRoof(W, F, pts, lerp(gr.bayR, D.parts.bay.roof), yE, roofRgb);
    }
    // chimneys, a turret's cone, a portico's roof: the silhouette a house shows from the street (near tier only)
    // (the lidar's chimneys, where its returns show a stack over the roof: drawn where they stand, to the height they reach; they replace the preset's own)
    const seen = !lod && inp.chimneys && inp.chimneys.length ? inp.chimneys.map((q) => { const [u, v] = F.uv(q.x, q.z); return { u, v, q }; }).filter((q) => q.u > u0 - 0.6 && q.u < u1 + 0.6 && q.v > -0.8 && q.v < Dp + 0.8) : [];
    for (const { u, v, q } of seen) {
      const w = clamp(q.w * 0.85, 0.55, 1.3);
      chimneyBox(W, F, { u, v, w, d: w * 0.85, yb: y0 + q.base - 0.6, yt: y0 + Math.min(q.top, q.base + 3.0), rgb: shade(brickRgb, 0.9), capRgb: lin(0xbdb9b0) });
      stats.chimneys = (stats.chimneys || 0) + 1; stats.lidarChimneys = (stats.lidarChimneys || 0) + 1;
    }
    if (!lod && !seen.length && chimSpec && rg && gr.chim < chimSpec.p * (inp.chimneys ? 0.6 : 1)) {
      const w = lerp(gr.chimW, chimSpec.size), d = w * 0.85, rise = lerp(gr.chimR, chimSpec.rise);
      const brickC = shade(brickRgb, 0.9), capC = lin(0xbdb9b0);
      const stacks = []; // { u, v, yb, yt }
      if (chimSpec.mode === 'front') {
        stacks.push({ u: gr.chimSide < 0.5 ? u0 + 1.4 : u1 - 1.4, v: -d / 2 + 0.15, yb: y0 + 0.3, yt: Math.max(yE + 1.8, rg.top - 0.2) });
      } else if (rg.alongU) {
        const lo = rg.a + (rg.ends ? eave + w / 2 + 0.15 : w / 2 + 0.1), hi = rg.b - (rg.ends ? eave + w / 2 + 0.15 : w / 2 + 0.1);
        const at = chimSpec.mode === 'ends' ? (hi - lo > 2.4 ? [lo, hi] : [(lo + hi) / 2]) : [lo + (hi - lo) * (gr.chimSide < 0.5 ? 0.3 : 0.7)];
        for (const u of at) stacks.push({ u, v: rg.c, yb: rg.top - 0.9, yt: rg.top + rise });
      } else {
        const v = chimSpec.mode === 'ends' ? rg.b - 1.0 - d / 2 : rg.a + (rg.b - rg.a) * (gr.chimSide < 0.5 ? 0.4 : 0.6);
        stacks.push({ u: rg.c, v, yb: rg.top - 0.9, yt: rg.top + rise });
      }
      for (const q of stacks) { chimneyBox(W, F, { u: q.u, v: q.v, w, d, yb: q.yb, yt: q.yt, rgb: brickC, capRgb: capC }); stats.chimneys = (stats.chimneys || 0) + 1; }
    }
    if (!lod && turret) turretDetail(W, F, { ...turret, rgb: roofRgb, capRgb: trimRgb });
    if (!lod && yard) stats.yardTris = yardDetail(W, F, yard);
    if (!lod) for (const q of porticoes) porticoDetail(W, F, { c: q.c, w: q.w, depth: q.depth, y0, h: q.h, colRgb: lin(0xf0ede4), roofRgb, endRgb: trimRgb, pitch: rad(30) });
    // vestibule roofs: a small front gable over each
    for (const v of (lod ? [] : vestibules)) {
      const hw = v.vw / 2 + 0.12;
      const vg = gableRoof(W, F, { u0: v.c - hw, u1: v.c + hw, v0: -v.vd, v1: 0.05, y: y0 + v.wallH, pitch: rad(42), eL: 0.05, eR: 0.05, eF: 0.12, eB: 0, rgb: roofRgb, endRgb: brickRgb, bands: null });
      if (D.parts.bargeboard && gr.barge < D.parts.bargeboard.p) { bargeboard(W, F, vg, 0.1, trimRgb); stats.bargeboards++; } // (the era's board on the vestibule's gable too, st-ndw9.18)
    }
    // a picture window beside the door (postwar), a garage door at the far end (recent): flat quads just proud of the wall
    const front = (u0q, u1q, y0q, y1q, rgb, off) => W.quadFace(F.P(u0q, -off, y0 + y0q), F.P(u1q, -off, y0 + y0q), F.P(u1q, -off, y0 + y1q), F.P(u0q, -off, y0 + y1q), rgb, F.out);
    const doorSides = new Set();
    for (const [d0, d1, k] of (lod ? [] : doors)) {
      if (!narrow) continue;
      const [a, b] = dwellingSpan(k);
      const left = d0 - a, right = b - d1;
      const freeA = left > right ? a + 0.4 : d1 + 0.3, freeB = left > right ? d0 - 0.3 : b - 0.4;
      if (garageSpec) {
        const gw = lerp(gr.garW, D.parts.garage.width), gh = lerp(gr.garH, D.parts.garage.height);
        if (freeB - freeA >= gw + 0.2) {
          const c = (freeA + freeB) / 2;
          front(c - gw / 2 - 0.08, c + gw / 2 + 0.08, 0, gh + 0.08, trimRgb, 0.03);
          front(c - gw / 2, c + gw / 2, 0, gh, lin(0x55585b), 0.05);
          for (let r = 1; r < 4; r++) front(c - gw / 2, c + gw / 2, gh * r / 4 - 0.02, gh * r / 4 + 0.02, lin(0x3c3f41), 0.06);
          stats.garages++; continue;
        }
      }
      if (picSpec) {
        const pw = Math.min(lerp(gr.picW, D.parts.pictureWindow.width), freeB - freeA - 0.2), ph2 = lerp(gr.picH, D.parts.pictureWindow.height);
        if (pw >= 1.6) {
          const c = (freeA + freeB) / 2, sill = Math.min(0.85, eaveH - ph2 - 0.4);
          front(c - pw / 2 - 0.1, c + pw / 2 + 0.1, sill - 0.1, sill + ph2 + 0.1, trimRgb, 0.03);
          front(c - pw / 2, c + pw / 2, sill, sill + ph2, lin(0x3a4a55), 0.05);
          front(c - 0.03, c + 0.03, sill, sill + ph2, trimRgb, 0.06);
          stats.pictureWindows++;
        }
      }
    }
    void doorSides;
    // the near-tier details (st-ndw9.18; js/building-draw-detail.js): never in the far roof
    if (!lod) {
      const t0 = W.tris, wt = D.parts.windowTrim;
      if (wt) {
        const stone = lin(weighted(STONE, gr.sillC)), lintel = wt.stone === false ? lin(weighted(D.trim, gr.lintC)) : shade(stone, 0.97);
        const ops = windowOpenings(frontWalls, FACADE_VARIANTS[variantIdx], storeys, { skip: bays.map((b) => [b.b0, b.b1]), entry: WALL.entry });
        const keep = vestibules.length ? ops.filter((q) => !(q.f === 0 && vestibules.some((v) => q.u1 > v.c - v.vw / 2 - 0.1 && q.u0 < v.c + v.vw / 2 + 0.1))) : ops;
        sillsAndLintels(W, F, keep, { sillRgb: stone, lintelRgb: lintel, sill: wt.sill !== false, lintel: wt.lintel !== false });
        stats.sills += wt.sill !== false ? keep.length : 0; stats.lintels += wt.lintel !== false ? keep.length : 0;
        if (D.parts.shutters && gr.shut < D.parts.shutters.p) { stats.shutters = (stats.shutters || 0) + keep.length; shutterBoards(W, F, keep, lin(weighted([[0x2f4a3c, 4], [0x1f2023, 4], [0x3b4a6a, 2], [0x6e2b2b, 1]], gr.shutC))); }
      }
      if (porch && porch.plinth) {
        const col = lin(weighted(D.parts.porch.columnTrim || D.trim, gr.lintC));
        porchDetail(W, F, { u0: porch.p0, u1: porch.p1, depth: porch.depth, y0, deckY: 0.42, plinth: porch.plinth, slabY: porch.slabY, piers: porch.piers, colRgb: col.map((c) => Math.max(c, 0.5)), deckRgb: lin(0xb9b5ab), stepRgb: lin(0xa9a59b) });
        stats.columns += porch.piers.length;
      }
      stats.detailTris = W.tris - t0;
    }
    if (wingRing) slab(W, wingRing, y0 + wingH - 0.015, tar); // (the rear wing's flat roof)
    stats.roofTris = W.tris;
    if (info) stats.roofInfo = info;
    return W.tris;
  };
  return {
    ok: true, lodRoof: true, ring: newRing, kinds, cover, variant, brickHex, brick, glass: gr.glass, eaveH, form, records, pushRoof, stats,
    frame: { A: [F.ax, F.az], t: [F.tx, F.tz], L: fe.len, u0, u1, z0, z1, partyL, partyR, edge: fi, shift: sh }
  };
  }
}

const REAL_SIGNS = new WeakMap();
// the real source-keyed signs of a building (js/toronto-storefronts.js, on the page as window.CITY.STOREFRONTS), by its id: [{x, z, nx, nz, hw}]
// (the sign's centre on its wall, the wall's outward normal, half the frontage it covers)
function realSigns(id) {
  const S = globalThis.window && globalThis.window.CITY && globalThis.window.CITY.STOREFRONTS;
  if (!S || !S.signs) return null;
  let map = REAL_SIGNS.get(S);
  if (!map) {
    map = new Map();
    for (const q of S.signs) {
      const key = String(q.face).split(':').slice(0, 2).join(':');
      const e = { x: q.x, z: q.z, nx: q.nx, nz: q.nz, hw: Math.min(7.2, Number.isFinite(q.width) ? q.width : 7.2) / 2 };
      (map.get(key) || map.set(key, []).get(key)).push(e);
    }
    REAL_SIGNS.set(S, map);
  }
  return map.get(id) || null;
}
// a blank board's stretch (centre c, half width hw, on edge e) lies over a real sign's: that sign stands in front of it and hides it
function coveredByRealSign(list, e, tx, tz, c, hw) {
  if (!list) return false;
  const px = e.ax + tx * c, pz = e.az + tz * c;
  for (const q of list) {
    if (q.x === undefined || q.nx * e.nx + q.nz * e.nz < 0.5) continue; // (a sign on another wall)
    const dx = q.x - px, dz = q.z - pz;
    if (Math.abs(dx * e.nx + dz * e.nz) > 2.5) continue; // (not on this wall)
    if (Math.abs(dx * tx + dz * tz) < q.hw + hw - 0.3) return true; // (the two stretches overlap)
  }
  return false;
}

// ---- the main-street shops (st-ndw9.15) ---------------------------------------------------------------------------------
// The page draws a shop's ground floor by its own rule (shopFrontRule, buildingFront: wall kinds on the street edges, the
// signs on top), and none of that changes: the outline, its wall kinds and covers are kept as they are. What is drawn is
// the building above: a whole number of storeys (the data's height to the nearest, two to four), the facade style (the
// early shops' tall narrow upper windows), a projecting cornice along the street fronts and a parapet round the roof where
// the next building does not stand. A joined run shares its brick and its trim; each building keeps its own height, so the
// block steps as real blocks do.
function planShop(inp, D) {
  const { preset, id, ring, edges, y0 = 0, lin } = inp;
  const gid = inp.groupId || id;
  const g = stream(gid, `${preset}:group`), own = stream(id, `${preset}:own`);
  const fail = (reason) => ({ ok: false, reason });
  if ((inp.style ?? 0) !== 0) return fail('other-facade');
  const base = inp.variant ?? 0; // (the plain style the building would have drawn: 0 the houses', 1 the offices')
  const h = inp.h;
  const floorH = FACADE_VARIANTS[0].floorHeight;
  if (h < 5.2) return fail('one-storey');
  if (h > 16.5) return fail('too-tall');
  const baseFloor = base === 0 ? 3.4 : 3.6;
  const useNew = D.variantEarly != null && base === 0;
  const variant = useNew ? FIRST_DRAW_VARIANT + D.variantEarly : base;
  const floor = useNew ? FACADE_VARIANTS[D.variantEarly].floorHeight : baseFloor;
  const storeys = clamp(Math.round(h / floor), D.storeys[0], D.storeys[1]);
  const eaveH = storeys * floor;
  const gv = { brick: g(), trim: g(), par: g(), cor: g(), corD: g(), corH: g(), roofCol: g(), shell: g() };
  const brickHex = weighted(D.wall, gv.brick), trimHex = weighted(D.trim, gv.trim);
  const brickRgb = lin(brickHex), trimRgb = lin(trimHex);
  const ph = lerp(gv.par, D.roof.parapet) * (0.9 + 0.2 * own());
  const withCornice = D.parts.cornice && gv.cor < D.parts.cornice.p;
  const kinds = edges.map((e) => e.kind);
  const cover = edges.map((e, i) => (inp.covered && inp.covered.has(i) ? inp.covered.get(i) : NaN));
  const stats = { N: 1, form: 'shop', storeys, cornices: 0, parapets: 0, roofTris: 0, gables: 0, dormers: 0, bays: 0, porches: 0, bargeboards: 0 };
  // the parapet and the cornice along the street fronts are small records, near tier only (as the bays and porches are)
  const records = [], yTop = y0 + eaveH, open = (e) => e.kind >= 0 && e.kind !== WALL.lotLine;
  const trimHexS = D.brickShare ? brickHex : trimHex;
  for (const e of edges) {
    if (!open(e) || !e.street || e.len < 2) continue;
    const out = [e.nx, e.nz], A = [e.ax, e.az], B = [e.bx, e.bz], t = 0.2;
    if (withCornice) {
      // one record: the cornice's block (projecting, under the roof line) carrying on up as the parapet
      const cd = lerp(gv.corD, D.parts.cornice.depth), ch = lerp(gv.corH, D.parts.cornice.height);
      records.push({ kind: 'cornice', rings: [[A, [A[0] + out[0] * cd, A[1] + out[1] * cd], [B[0] + out[0] * cd, B[1] + out[1] * cd], B]], kinds: [WALL.lotLine, WALL.lotLine, WALL.lotLine, -1], base: yTop - ch, h: yTop + ph * 0.7, capY: yTop + ph * 0.7, brick: false, hex: trimHex, variant, glass: 0, nearOnly: true });
      stats.cornices++; stats.parapets++;
    } else {
      records.push({ kind: 'parapet', rings: [[A, B, [B[0] - out[0] * t, B[1] - out[1] * t], [A[0] - out[0] * t, A[1] - out[1] * t]]], kinds: [WALL.lotLine, WALL.lotLine, WALL.lotLine, WALL.lotLine], base: yTop, h: yTop + ph, capY: yTop + ph, brick: false, hex: trimHexS, variant, glass: 0, nearOnly: true });
      stats.parapets++;
    }
  }
  const tar = tarRgb(lin, gid, id, preset);
  // the sign band (st-ndw9.18): over each storefront of a shop wall (one a 7.5 m of frontage, as the shader lays them out), a fascia board at
  // the shader's fascia (0.55 m, its top 12 cm under the floor above) in one of the page's sign styles' colours, with a lighter name plate
  // in it: no lettering, so no name is invented. Four triangles a storefront in the roof batch. A source-keyed sign (js/storefront-signs.js)
  // stands in front of its stretch and hides it
  const signs = [];
  // (a real source-keyed sign hides the blank board over its own stretch of frontage only, not the building's other storefronts: st-ndw9.24; John 2026-11-17 asked for no blank board beside a real one)
  const real = realSigns(id);
  if (D.parts.signBand && stream(id, `${preset}:sign`)() < D.parts.signBand.p) {
    const sg = stream(id, `${preset}:signs`);
    for (const e of edges) {
      if (e.kind !== WALL.shop || e.len < 3.2) continue;
      const n = Math.max(1, Math.floor(e.len / SHOP_SIGN.unit + 0.5)), w = e.len / n, tx = (e.bx - e.ax) / e.len, tz = (e.bz - e.az) / e.len;
      for (let k = 0; k < n; k++) {
        if (w < 2.5) continue;
        const [bh, ih] = weighted(SHOP_SIGN_BOARDS.map(([b, i, wt]) => [[b, i], wt]), sg()); // (drawn first so a hidden board does not shift its neighbours' colours)
        if (coveredByRealSign(real, e, tx, tz, (k + 0.5) * w, w / 2)) continue;
        signs.push({ e, tx, tz, u0: k * w + 0.12, u1: (k + 1) * w - 0.12, board: lin(bh), ink: lin(ih), plate: 0.45 + 0.35 * sg() });
      }
    }
  }
  stats.signs = signs.length;
  const pushRoof = (A) => {
    const W = writer(A);
    if (!inp.holes) slab(W, ring, yTop - 0.015, tar); // (a building with a courtyard keeps the cell material's cap)
    // (the shader's own storey, absolute in y: the fascia is at floor - 0.12 - 0.55 .. floor - 0.12 of the ground floor)
    const y1 = floor - SHOP_SIGN.top, y0b = y1 - SHOP_SIGN.boardH;
    for (const s of signs) {
      const { e } = s, nrm = [e.nx, 0, e.nz], P = (u, off, y) => [e.ax + s.tx * u + e.nx * off, y, e.az + s.tz * u + e.nz * off];
      W.quadFace(P(s.u0, 0.05, y0b), P(s.u1, 0.05, y0b), P(s.u1, 0.05, y1), P(s.u0, 0.05, y1), s.board, nrm);
      const c = (s.u0 + s.u1) / 2, hw = (s.u1 - s.u0) * s.plate / 2, pm = 0.11;
      W.quadFace(P(c - hw, 0.09, y0b + pm), P(c + hw, 0.09, y0b + pm), P(c + hw, 0.09, y1 - pm), P(c - hw, 0.09, y1 - pm), s.ink, nrm);
    }
    stats.roofTris = W.tris;
    return W.tris;
  };
  void floorH;
  return {
    ok: true, keep: true, ring, kinds, cover, variant, brickHex: D.brickShare ? brickHex : null, brick: true, glass: 0, eaveH, form: 'shop', records, pushRoof, stats
  };
}

/**
 * The preset's synthetic lot for the gallery: a rectangle of `width` x `depth` metres centred at (cx, cz) with its front
 * (the +z side) toward the street, as the sidecar record shape buildings.js reads (`rings`, `covered`, `hidden`, `street`).
 */
export function syntheticLot(id, cx, cz, width, depth, preset, opts = {}) {
  const hw = width / 2, hd = depth / 2, r1 = (v) => Math.round(v * 10) / 10;
  // counter-clockwise in (x, z): the right-hand normal (dz, -dx) of each edge points away from the mass. The +z edge
  // runs from +x to -x ... (hw, hd) -> (-hw, hd): dx = -w, dz = 0: normal (0, +w): out toward +z.
  let ring = [[cx + hw, cz - hd], [cx + hw, cz + hd], [cx - hw, cz + hd], [cx - hw, cz - hd]];
  if (opts.wing) {
    // a rear wing (st-ndw9.15): the back third of the depth, 60% of the width, on the left or the right, so the gallery shows
    // the real back behind the composed front
    const wd = depth * 0.34, ww = width * 0.6, left = !!opts.wingLeft;
    ring = left
      ? [[cx + hw, cz - hd + wd], [cx + hw, cz + hd], [cx - hw, cz + hd], [cx - hw, cz - hd], [cx - hw + ww, cz - hd], [cx - hw + ww, cz - hd + wd]]
      : [[cx + hw, cz - hd], [cx + hw, cz + hd], [cx - hw, cz + hd], [cx - hw, cz - hd + wd], [cx + hw - ww, cz - hd + wd], [cx + hw - ww, cz - hd]];
  }
  const rings = [ring.map(([x, z]) => [r1(x), r1(z)])];
  const covered = new Map();
  if (opts.joined) { // (a joined lot: both side walls stand against a neighbour as tall as itself)
    const n = rings[0].length;
    rings[0].forEach((a, i) => { const b = rings[0][(i + 1) % n]; if (Math.abs(b[0] - a[0]) < 0.01 && Math.abs(b[1] - a[1]) > 3) covered.set(i, opts.h || 9); });
  }
  return { id, index: -1, base: opts.base || 0, rings, covered, hidden: new Set(), street: new Map([[1, false]]), preset };
}
