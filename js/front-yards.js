// js/front-yards.js (jf-ugq, docs/front-yards.md): the front yards of the drawn houses: clipped hedges, wrought-iron, picket and chain-link fences, stone and brick
// low walls with piers and gate gaps, foundation shrubs, garden beds along the walk and the front wall, a lawn, the odd ornamental tree and lamp post, the walk and the
// drive. Pure functions with no three.js and no DOM (as js/building-draw-detail.js): planHouse (js/building-draw.js) calls planYard once a house's front is known
// and hands back `pushYard(A)`; js/buildings.js writes it into the yard accumulator of the house's 500 m roof cell, drawn with the yard material
// (js/front-yard-material.js) within the roofs' near distance. Nothing here goes into the roof batch.
//
// Vertex layout of the accumulator A = { pos, nor, uv, col, aux }: uv = (kind, rnd) and aux = (metres along the run, height over its foot), so ONE material draws every
// kind in the right season (KIND below). Geometry is in the house's frame (u along the front, v out of the wall: the street is v negative; F.P turns it to world).
//
// Where each thing comes from (docs/front-yards.md):
//   hedges and shrub masses  the 2023 lidar (the shared dataset front-yard-vegetation/1, build/front-yards in the shared data repo): where the lot has any, they stand where they were found
//   the lot line's fence or wall, the beds, the lawn, the foundation shrubs, trees and lamps  a rule by the neighbourhood's style, from a stable per-house seed (stream(id, ...)):
//   no two neighbours match, and a house is the same on every load.
import { stream, weighted, lerp, clamp, shade } from './building-draw-kit.js';

export const KIND = { solid: 0, evergreen: 1, deciduous: 2, lawn: 3, bed: 4, iron: 5, picket: 6, chain: 7 };

// The yard styles by neighbourhood and era. Weights of the lot line's treatment: [hedge, stone wall, brick wall, iron fence (on a low stone base), picket, chain-link, nothing].
// A source: the streets of each neighbourhood from the photographs John named (Rosedale: stone walls with piers, cedar hedges, wrought iron; the Annex and Cabbagetown:
// wrought iron and low pickets on narrow lots; Leslieville and Riverdale: pickets, chain-link, low brick; the Beaches: pickets and hedges).
export const YARD_STYLES = {
  rosedale: { line: [30, 22, 2, 14, 3, 0, 29], lawn: 0.88, beds: 0.7, shrubs: 0.8, tree: 0.1, lamp: 0.1, hedgeH: [1.2, 2.1], wallH: [0.6, 1.0] },
  rosedaleGrand: { line: [30, 28, 2, 16, 1, 0, 23], lawn: 0.92, beds: 0.75, shrubs: 0.85, tree: 0.14, lamp: 0.16, hedgeH: [1.4, 2.3], wallH: [0.7, 1.1] },
  annex: { line: [12, 6, 14, 30, 8, 0, 30], lawn: 0.6, beds: 0.65, shrubs: 0.7, tree: 0.04, lamp: 0.03, hedgeH: [0.8, 1.4], wallH: [0.4, 0.7] },
  cabbagetown: { line: [10, 4, 16, 34, 8, 0, 28], lawn: 0.5, beds: 0.7, shrubs: 0.7, tree: 0.03, lamp: 0.02, hedgeH: [0.7, 1.2], wallH: [0.35, 0.6] },
  eastEnd: { line: [10, 2, 10, 4, 34, 18, 22], lawn: 0.65, beds: 0.55, shrubs: 0.6, tree: 0.03, lamp: 0.0, hedgeH: [0.7, 1.3], wallH: [0.3, 0.55] },
  beaches: { line: [22, 4, 2, 3, 38, 6, 25], lawn: 0.75, beds: 0.6, shrubs: 0.65, tree: 0.05, lamp: 0.02, hedgeH: [0.8, 1.6], wallH: [0.3, 0.5] },
  postwar: { line: [22, 2, 6, 4, 8, 12, 46], lawn: 0.92, beds: 0.5, shrubs: 0.6, tree: 0.05, lamp: 0.02, hedgeH: [0.7, 1.3], wallH: [0.3, 0.5] },
  city: { line: [16, 3, 8, 8, 14, 10, 41], lawn: 0.7, beds: 0.55, shrubs: 0.6, tree: 0.04, lamp: 0.02, hedgeH: [0.7, 1.4], wallH: [0.3, 0.6] }
};
const LINES = ['hedge', 'stone', 'brick', 'iron', 'picket', 'chain', null];

// ---- the writer -------------------------------------------------------------------------------------------------------------
function yardWriter(A) {
  const norm = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  const W = {
    tris: 0,
    // one triangle wound to face `facing`; per-vertex (s, t) = the run's coordinate and the height over its foot, `n` an optional smooth normal for each vertex
    tri(a, b, c, col, kind, rnd, facing, st, nrm) {
      let n = norm(a, b, c), swap = false;
      if (facing && n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2] < 0) { swap = true; n = [-n[0], -n[1], -n[2]]; }
      const P = swap ? [a, c, b] : [a, b, c], S = swap ? [st[0], st[2], st[1]] : st, N = nrm ? (swap ? [nrm[0], nrm[2], nrm[1]] : nrm) : null;
      for (let i = 0; i < 3; i++) {
        const p = P[i], q = N ? N[i] : n;
        A.pos.push(p[0], p[1], p[2]); A.nor.push(q[0], q[1], q[2]); A.uv.push(kind, rnd); A.col.push(col[0], col[1], col[2]); A.aux.push(S[i][0], S[i][1]);
      }
      W.tris++;
    },
    // a quad a, b, c, d (in order round it), the (s, t) of a and of c's neighbour b are given as sa..sd
    quad(a, b, c, d, col, kind, rnd, facing, sa = [0, 0], sb = [1, 0], sc = [1, 1], sd = [0, 1]) {
      W.tri(a, b, c, col, kind, rnd, facing, [sa, sb, sc]);
      W.tri(a, c, d, col, kind, rnd, facing, [sa, sc, sd]);
    }
  };
  return W;
}

// ---- shapes in the house's frame ------------------------------------------------------------------------------------------
const up = [0, 1, 0];
const SKIRT = 0.4; // m: what a hedge, wall or plinth sinks below the house's ground height, for a lot that falls toward the street

// an upright box along the segment a -> b ([u, v] ends), half thickness ht, from yb to yt: both long sides, the top and the two ends (never the underside)
function boxAlong(W, F, a, b, ht, yb, yt, rgb, kind, rnd, capRgb = null, aux0 = 0) {
  const dx = b[0] - a[0], dv = b[1] - a[1], L = Math.hypot(dx, dv) || 1e-6, tu = dx / L, tv = dv / L, nu = -tv, nv = tu;
  const c = (p, k) => [p[0] + nu * ht * k, p[1] + nv * ht * k];
  const A1 = c(a, 1), A2 = c(a, -1), B1 = c(b, 1), B2 = c(b, -1), P = F.P;
  const h = yt - yb;
  const side = (p, q, k) => W.quad(P(p[0], p[1], yb), P(q[0], q[1], yb), P(q[0], q[1], yt), P(p[0], p[1], yt), rgb, kind, rnd, null, [aux0, 0], [aux0 + L, 0], [aux0 + L, h], [aux0, h]);
  side(A1, B1); side(B2, A2); // (two-sided material: the winding does not matter)
  W.quad(P(A1[0], A1[1], yt), P(B1[0], B1[1], yt), P(B2[0], B2[1], yt), P(A2[0], A2[1], yt), capRgb || shade(rgb, 1.1), kind, rnd, up, [0, h], [L, h], [L, h], [0, h]);
  W.quad(P(A2[0], A2[1], yb), P(A1[0], A1[1], yb), P(A1[0], A1[1], yt), P(A2[0], A2[1], yt), shade(rgb, 0.88), kind, rnd, null, [0, 0], [0, 0], [0, h], [0, h]);
  W.quad(P(B1[0], B1[1], yb), P(B2[0], B2[1], yb), P(B2[0], B2[1], yt), P(B1[0], B1[1], yt), shade(rgb, 0.9), kind, rnd, null, [0, 0], [0, 0], [0, h], [0, h]);
}

// an upright post (a pier, a fence post, a lamp post): a square box with a cap
function post(W, F, u, v, hw, yb, yt, rgb, capRgb, kind = KIND.solid, rnd = 0) {
  const P = F.P, c = [[u - hw, v - hw], [u + hw, v - hw], [u + hw, v + hw], [u - hw, v + hw]];
  for (let i = 0; i < 4; i++) {
    const p = c[i], q = c[(i + 1) % 4];
    W.quad(P(p[0], p[1], yb), P(q[0], q[1], yb), P(q[0], q[1], yt), P(p[0], p[1], yt), i % 2 ? shade(rgb, 0.9) : rgb, kind, rnd, null, [0, 0], [0, 0], [0, yt - yb], [0, yt - yb]);
  }
  const ch = hw * 0.25, cap = capRgb || shade(rgb, 1.12), e = hw * 1.25;
  W.quad(P(u - e, v - e, yt), P(u + e, v - e, yt), P(u + e, v + e, yt), P(u - e, v + e, yt), cap, kind, rnd, up, [0, yt - yb], [0, yt - yb], [0, yt - yb], [0, yt - yb]);
  void ch;
}

// a flat sheet at height y over the ring of [u, v] corners (a quad)
function flat(W, F, ring, y, rgb, kind, rnd = 0) {
  const P = F.P, p = ring.map(([u, v]) => P(u, v, y));
  W.quad(p[0], p[1], p[2], p[3], rgb, kind, rnd, up, [0, 0], [1, 0], [1, 1], [0, 1]);
}

// a clipped hedge (or a strip of one) from a to b: its cross section a trapezoid with a bevelled shoulder, `w` wide at the foot and `h` high; the ends closed
function hedgeRun(W, F, a, b, w, h, yb, rgb, kind, rnd, capEnds = true) {
  const dx = b[0] - a[0], dv = b[1] - a[1], L = Math.hypot(dx, dv);
  if (L < 0.15) return;
  const tu = dx / L, tv = dv / L, nu = -tv, nv = tu, P = F.P;
  const prof = [[-w / 2, -SKIRT], [-w / 2, h * 0.8], [-w * 0.36, h], [w * 0.36, h], [w / 2, h * 0.8], [w / 2, -SKIRT]]; // (lateral, height over the foot; the foot sinks a skirt into the ground so a slope shows no gap)
  const pt = (p, k) => P(p[0] + nu * prof[k][0], p[1] + nv * prof[k][0], yb + prof[k][1]);
  for (let k = 0; k < prof.length - 1; k++) {
    const shadeK = k === 2 ? 1.12 : k === 0 || k === 4 ? 0.9 : 1.0;
    W.quad(pt(a, k), pt(b, k), pt(b, k + 1), pt(a, k + 1), shade(rgb, shadeK), kind, rnd, null, [0, prof[k][1]], [L, prof[k][1]], [L, prof[k + 1][1]], [0, prof[k + 1][1]]);
  }
  if (capEnds) {
    for (const [p, s] of [[a, 0], [b, L]]) {
      for (let k = 1; k < prof.length - 2; k++) { // (a fan over the end: the profile's polygon)
        W.tri(pt(p, 0), pt(p, k), pt(p, k + 1), shade(rgb, 0.85), kind, rnd, null, [[s, 0], [s, prof[k][1]], [s, prof[k + 1][1]]]);
      }
      W.tri(pt(p, 0), pt(p, prof.length - 2), pt(p, prof.length - 1), shade(rgb, 0.85), kind, rnd, null, [[s, 0], [s, prof[prof.length - 2][1]], [s, 0]]);
    }
  }
}

// a rounded mass (a shrub, a clipped ball, a crown): a 7-sided dome, a base ring, a bulging middle ring and an apex; smooth normals, a little irregular
function dome(W, F, u, v, rx, rv, h, yb, rgb, kind, rnd, rough = 0.12) {
  const n = 7, P = F.P, g = stream(`${kind}:${Math.round(u * 40)}:${Math.round(v * 40)}`, 'dome');
  const r0 = [], r1 = [], rr = [];
  for (let i = 0; i < n; i++) { const j = 1 + (g() - 0.5) * 2 * rough; rr.push(j); }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + g() * 0.15;
    r0.push(P(u + Math.cos(a) * rx * 0.86 * rr[i], v + Math.sin(a) * rv * 0.86 * rr[i], yb + h * 0.04));
    r1.push(P(u + Math.cos(a) * rx * rr[i], v + Math.sin(a) * rv * rr[i], yb + h * 0.5));
  }
  const apex = P(u, v, yb + h);
  const nrm = (p, k) => { const dxz = [p[0] - P(u, v, 0)[0], p[2] - P(u, v, 0)[2]], l = Math.hypot(dxz[0], dxz[1]) || 1; return [dxz[0] / l * (1 - k), k, dxz[1] / l * (1 - k)]; };
  const nl = (p, k) => { const q = nrm(p, k), l = Math.hypot(q[0], q[1], q[2]) || 1; return [q[0] / l, q[1] / l, q[2] / l]; };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // the band between the base and the middle ring (almost upright), the cap between the middle ring and the apex
    W.tri(r0[i], r0[j], r1[j], rgb, kind, rnd, null, [[0, 0], [0, 0], [0, h * 0.5]], [nl(r0[i], 0.05), nl(r0[j], 0.05), nl(r1[j], 0.3)]);
    W.tri(r0[i], r1[j], r1[i], rgb, kind, rnd, null, [[0, 0], [0, h * 0.5], [0, h * 0.5]], [nl(r0[i], 0.05), nl(r1[j], 0.3), nl(r1[i], 0.3)]);
    W.tri(r1[i], r1[j], apex, shade(rgb, 1.08), kind, rnd, null, [[0, h * 0.5], [0, h * 0.5], [0, h]], [nl(r1[i], 0.55), nl(r1[j], 0.55), [0, 1, 0]]);
  }
}

// a fence of bars or pickets between two points on the lot line: posts, a plinth where asked, rails and one alpha-tested strip (the material cuts the bars)
function fenceRun(W, F, a, b, o) {
  const { type, h, yb, rgb, post: postRgb, plinth, plinthRgb, rnd } = o;
  const dx = b[0] - a[0], dv = b[1] - a[1], L = Math.hypot(dx, dv);
  if (L < 0.3) return;
  const tu = dx / L, tv = dv / L, P = F.P;
  const y1 = yb + (plinth || 0);
  if (plinth) boxAlong(W, F, a, b, 0.17, yb - SKIRT, y1, plinthRgb, KIND.solid, rnd, shade(plinthRgb, 1.1));
  const top = y1 + h;
  const kind = type === 'iron' ? KIND.iron : type === 'picket' ? KIND.picket : KIND.chain;
  const A = P(a[0], a[1], y1), B = P(b[0], b[1], y1), A2 = P(a[0], a[1], top), B2 = P(b[0], b[1], top);
  W.quad(A, B, B2, A2, rgb, kind, rnd, null, [0, 0], [L, 0], [L, h], [0, h]);
  // rails: a thin top rail and a low one; posts every 2.4 to 3 m
  const rh = type === 'iron' ? 0.05 : 0.04;
  boxAlong(W, F, a, b, 0.03, top - rh * 2, top - rh, postRgb, KIND.solid, rnd);
  if (type !== 'chain') boxAlong(W, F, a, b, 0.03, y1 + 0.12, y1 + 0.12 + rh, postRgb, KIND.solid, rnd);
  const nP = Math.max(1, Math.round(L / 2.6));
  for (let i = 0; i <= nP; i++) {
    const s = (i / nP) * L;
    post(W, F, a[0] + tu * s, a[1] + tv * s, type === 'iron' ? 0.045 : 0.05, y1, top + (type === 'iron' ? 0.08 : 0.04), postRgb, shade(postRgb, 1.15));
  }
}

// a low wall of stone or brick along a -> b, with piers (a pier at each end and one every 3.5 to 4.5 m)
function wallRun(W, F, a, b, o) {
  const { h, yb, rgb, pier, cap, rnd } = o;
  const dx = b[0] - a[0], dv = b[1] - a[1], L = Math.hypot(dx, dv);
  if (L < 0.3) return;
  const tu = dx / L, tv = dv / L;
  boxAlong(W, F, a, b, 0.17, yb - SKIRT, yb + h, rgb, KIND.solid, rnd, cap);
  const nP = Math.max(1, Math.round(L / 4));
  for (let i = 0; i <= nP; i++) {
    const s = (i / nP) * L;
    post(W, F, a[0] + tu * s, a[1] + tv * s, 0.22, yb - SKIRT, yb + h + 0.3, pier, cap);
  }
}

// ---- the plan --------------------------------------------------------------------------------------------------------------
// Chooses a house's yard and returns the function that writes it. ctx = {
//   F, id, y0, u0, u1 (the front wall's ends), Dp (the house's depth), partyL, partyR,
//   yd (the yard's depth: the front wall to the lot line, m), lotW (m, 0 unknown), extra (the side yard each side, m), doorU (the door's centre on the wall), gap (the walk),
//   avoid: [[u0, u1]] stretches of the front wall that hold a porch, a bay or the door, drive: { u0, u1, to, rgb } | null,
//   style: a YARD_STYLES key, canopy (0 to 1, the share of the lot under a tree crown in the lidar; unknown: -1), veg: { hedges, shrubs } in the house's world frame | null,
//   brickRgb, lin: hex -> linear rgb, house (the Rosedale house record: era, style) } and
//   returns { stats, push(A) }.
export function planYard(ctx) {
  const { F, id, u0, u1, partyL, partyR, yd, avoid = [], drive = null, lin } = ctx;
  const y0 = ctx.y0 + (ctx.lift || 0); // (the plot's ground: a sidewalk's height over the road the house stands on)
  const S = YARD_STYLES[ctx.style] || YARD_STYLES.city;
  const R = (label) => stream(id, 'yard:' + label);
  const rl = R('line'), rb = R('bed'), rs = R('shrub'), rt = R('tree'), rg = R('misc');
  const lotW = ctx.lotW || 0, Wd = u1 - u0;
  const extra = ctx.extra != null ? ctx.extra : lotW > 0 ? clamp((lotW - Wd) / 2, 0.3, 6) : 1.0;
  const uA = partyL ? u0 : u0 - extra, uB = partyR ? u1 : u1 + extra;
  const gap = ctx.gap || [(u0 + u1) / 2 - 0.7, (u0 + u1) / 2 + 0.7];
  const mid = F.xz((u0 + u1) / 2, 0);
  const stats = { site: { x: mid[0], z: mid[1], ox: F.out[0], oz: F.out[2], yd, style: ctx.style || 'city' }, hedges: 0, hedgeM: 0, lidarHedges: 0, lidarShrubs: 0, shrubs: 0, fence: null, beds: 0, lawn: 0, trees: 0, lamps: 0 };
  const yb = y0; // (the lot line's things stand on the house's ground height, sunk SKIRT into it)
  const veg = ctx.veg || null;

  // hedges and shrubs the lidar found, in the house's frame (u, v); the yard's zone is what the street sees: from the front of the house out to the lot line and a little beyond
  const zone = (u, v) => v < 3.5 && v > -yd - 1.6 && u > uA - 2.2 && u < uB + 2.2 && !(v > -0.4 && u > u0 - 0.3 && u < u1 + 0.3);
  const hedges = [], shrubs = [];
  if (veg) {
    for (const hd of veg.hedges || []) {
      const pts = hd.pts.map(([x, z]) => F.uv(x, z));
      if (!pts.some(([u, v]) => v < 0.6 && v > -yd - 1.6 && u > uA - 2.2 && u < uB + 2.2)) continue; // (a hedge only the back garden has: not in the yard)
      hedges.push({ pts, w: hd.w, h: hd.h });
    }
    for (const sh of veg.shrubs || []) {
      const [u, v] = F.uv(sh.x, sh.z);
      if (zone(u, v)) shrubs.push({ u, v, r: sh.r, h: sh.h });
    }
    shrubs.sort((p, q) => q.r - p.r);
    shrubs.length = Math.min(shrubs.length, 12);
  }
  // does the lidar's hedge cover the lot's front line? A hedge along it (within 1.4 m of the line, at least 3.5 m of it inside the lot's width) is the lot line's treatment
  let frontHedge = 0;
  for (const hd of hedges) {
    for (let i = 0; i + 1 < hd.pts.length; i++) {
      const [a, b] = [hd.pts[i], hd.pts[i + 1]];
      if (Math.abs((a[1] + b[1]) / 2 + yd) < 1.4 && Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1])) frontHedge += Math.max(0, Math.min(Math.max(a[0], b[0]), uB) - Math.max(Math.min(a[0], b[0]), uA));
    }
  }
  // the lot line: kept from the lidar's hedge where it found one; where the lidar saw an open yard and no hedge, a lower share takes the rule's treatment (a wall or fence is not visible
  // to it); under a tree (the lidar sees nothing below the crown) the rule is full
  const seen = ctx.canopy != null && ctx.canopy >= 0 ? 1 - clamp(ctx.canopy / 0.5, 0, 1) : 0;
  let line = weighted(LINES.map((k, i) => [k, S.line[i]]), rl());
  if (frontHedge >= 3.5) line = rl() < 0.3 ? 'iron' : null; // (a hedge stands there; now and then an iron fence behind it)
  else if (line === 'hedge' && seen > 0.6 && rl() < 0.6) line = null; // (an open yard with no hedge in the lidar is mostly an open yard)
  if (yd < 2.2) line = null;
  const gr = { h: rl(), tone: rl(), plinth: rl(), side: rl(), sideLen: rl(), gate: rl() };

  const colours = () => {
    const green = lin(weighted([[0x2f4d38, 4], [0x36573f, 3], [0x2a4733, 3]], gr.tone));
    return { green };
  };

  return {
    stats,
    push(A) {
      const W = yardWriter(A);
      const wrng = R('walk');
      // ---- the walk and the drive (flat, on the ground)
      const c = (gap[0] + gap[1]) / 2;
      flat(W, F, [[gap[0] + 0.1, 0.05], [gap[1] - 0.1, 0.05], [gap[1] - 0.1, -yd], [gap[0] + 0.1, -yd]], y0 + 0.05, lin(0xb4b0a6), KIND.solid);
      if (drive) flat(W, F, [[drive.u0, drive.to], [drive.u1, drive.to], [drive.u1, -yd], [drive.u0, -yd]], y0 + 0.045, drive.rgb, KIND.solid);

      // ---- the steps up to a porch: two low treads of stone at the walk's end
      if (ctx.steps) {
        const sw = 0.9, stone = lin(0xa9a59b), d = ctx.steps.depth;
        boxAlong(W, F, [ctx.steps.c - sw, -d - 0.32], [ctx.steps.c + sw, -d - 0.32], 0.16, y0 - 0.05, y0 + 0.15, stone, KIND.solid, 0.5, shade(stone, 1.12));
        boxAlong(W, F, [ctx.steps.c - sw * 0.85, -d - 0.02], [ctx.steps.c + sw * 0.85, -d - 0.02], 0.16, y0 - 0.05, y0 + 0.3, stone, KIND.solid, 0.5, shade(stone, 1.12));
      }

      // ---- the lawn: between the walk and the drive, from the beds to the lot line
      const obstacles = [[gap[0] - 0.55, gap[1] + 0.55]];
      if (drive) obstacles.push([drive.u0 - 0.3, drive.u1 + 0.3]);
      obstacles.sort((p, q) => p[0] - q[0]);
      if (rg() < S.lawn && yd >= 2.6) {
        const lawnRgb = lin(weighted([[0x446631, 3], [0x3f6130, 3], [0x4e6c33, 2]], rg()));
        let a = uA + 0.2;
        const lv0 = -yd + (line ? 0.5 : 0.1), lv1 = -(ctx.bedDepth ?? 0.95) - 0.3;
        for (const [o0, o1] of [...obstacles, [uB + 1, uB + 2]]) {
          const b = Math.min(o0, uB - 0.2);
          if (b - a > 0.8 && lv1 - lv0 > 0.8) { flat(W, F, [[a, lv1], [b, lv1], [b, lv0], [a, lv0]], y0 + 0.035, lawnRgb, KIND.lawn, rg()); stats.lawn++; }
          a = Math.max(a, o1);
        }
      }

      // ---- beds along the front wall (mulch, in the spans between the door, the porch and the bays) and the foundation shrubs
      const spans = [];
      let from = u0 + 0.2;
      const av = [...avoid].sort((p, q) => p[0] - q[0]);
      for (const [a0, a1] of av) { if (a0 - from > 1.3) spans.push([from, a0 - 0.2]); from = Math.max(from, a1 + 0.2); }
      if (u1 - 0.2 - from > 1.3) spans.push([from, u1 - 0.2]);
      const bedD = 0.8 + rb() * 0.4;
      const bedOn = rb() < S.beds && yd >= 2.4;
      const mulch = lin(weighted([[0x4a3626, 3], [0x3f2f22, 3], [0x5a4330, 2]], rb()));
      const foundation = [];
      for (const [a, b] of spans) {
        if (bedOn) { flat(W, F, [[a, -0.15], [b, -0.15], [b, -0.15 - bedD], [a, -0.15 - bedD]], y0 + 0.04, mulch, KIND.bed, rb()); stats.beds++; }
        if (rs() < S.shrubs) {
          const n = clamp(Math.round((b - a) / 1.7), 1, 4);
          for (let i = 0; i < n; i++) {
            const u = a + ((i + 0.5 + (rs() - 0.5) * 0.5) / n) * (b - a);
            // (where the lidar has a shrub within 1.6 m, that one stands there instead)
            if (shrubs.some((s) => Math.hypot(s.u - u, s.v + 0.7) < 1.6)) continue;
            foundation.push({ u, v: -0.7 - rs() * 0.3, r: 0.38 + rs() * 0.34, h: 0.55 + rs() * 0.6 });
          }
        }
      }
      // a bed along each side of the walk (a mulch edge between it and the lawn), from the front wall's bed toward the street, a third of the walk's length or so
      if (bedOn && yd >= 4 && rb() < 0.7) {
        const wl = Math.min(yd - 1.0, 2.5 + rb() * Math.max(0, yd * 0.5 - 1.5)), bw = 0.55 + rb() * 0.3;
        for (const [a, b] of [[gap[0] - 0.05 - bw, gap[0] - 0.05], [gap[1] + 0.05, gap[1] + 0.05 + bw]]) {
          if (drive && b > drive.u0 - 0.2 && a < drive.u1 + 0.2) continue;
          if (a < uA + 0.3 || b > uB - 0.3) continue;
          flat(W, F, [[a, -0.15 - bedD], [b, -0.15 - bedD], [b, -wl], [a, -wl]], y0 + 0.04, mulch, KIND.bed, rb()); stats.beds++;
        }
      }
      const shrubKinds = [[KIND.evergreen, 5], [KIND.deciduous, 4]];
      const shrubCol = (kind, x) => kind === KIND.evergreen ? lin(weighted([[0x273d2c, 3], [0x2f4f33, 3], [0x35553a, 2]], x)) : lin(weighted([[0x5d7a45, 3], [0x6b8a3d, 3], [0x4a6a35, 3], [0x7a3b4a, 1]], x));
      for (const s of foundation) {
        const k = weighted(shrubKinds, rs());
        dome(W, F, s.u, s.v, s.r, s.r, s.h, y0 - 0.1, shrubCol(k, rs()), k, rs());
        stats.shrubs++;
      }
      // the lidar's shrub masses
      for (const s of shrubs) {
        const k = s.h > 2.2 ? KIND.deciduous : weighted(shrubKinds, rs());
        const r = clamp(s.r, 0.35, 2.4), h = clamp(s.h, 0.5, 4.2);
        dome(W, F, s.u, s.v, r, r, h, y0 - 0.1, shrubCol(k, rs()), k, rs());
        stats.lidarShrubs++;
      }

      // ---- the hedges the lidar found, cut where the walk and the drive cross them
      const gate = [[gap[0] - 0.15, gap[1] + 0.15]];
      if (drive) gate.push([drive.u0 - 0.15, drive.u1 + 0.15]);
      const cutSeg = (a, b) => { // [a, b] with the gate gaps cut out of it where it runs along the lot line
        const onLine = Math.abs((a[1] + b[1]) / 2 + yd) < 1.5 && Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
        if (!onLine) return [[a, b]];
        let pieces = [[a, b]];
        const ascending = a[0] <= b[0];
        for (const [g0, g1] of gate) {
          pieces = pieces.flatMap(([p, q]) => {
            const lo = Math.min(p[0], q[0]), hi = Math.max(p[0], q[0]);
            if (hi <= g0 || lo >= g1) return [[p, q]];
            const at = (uu) => { const t = (uu - p[0]) / ((q[0] - p[0]) || 1e-6); return [uu, p[1] + (q[1] - p[1]) * t]; };
            const out = [];
            if (ascending ? p[0] < g0 : p[0] > g1) out.push([p, at(ascending ? g0 : g1)]);
            if (ascending ? q[0] > g1 : q[0] < g0) out.push([at(ascending ? g1 : g0), q]);
            return out;
          });
        }
        return pieces;
      };
      for (const hd of hedges) {
        const hrng = stream(id, 'hedge:' + Math.round(hd.pts[0][0] * 10) + ':' + Math.round(hd.pts[0][1] * 10));
        const evergreen = hd.h >= 1.6 || hrng() < 0.6;
        const kind = evergreen ? KIND.evergreen : KIND.deciduous;
        const rgb = evergreen ? lin(weighted([[0x2f4d38, 4], [0x36573f, 3], [0x2a4733, 3], [0x3a5e42, 2]], hrng())) : lin(weighted([[0x4a6a35, 3], [0x557a3a, 3], [0x3f5f33, 2]], hrng()));
        const rnd = hrng();
        const w = clamp(hd.w * 0.85, 0.5, 2.6), h = clamp(hd.h, 0.6, 4.0);
        for (let i = 0; i + 1 < hd.pts.length; i++) {
          for (const [p, q] of cutSeg(hd.pts[i], hd.pts[i + 1])) {
            const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (L < 0.4) continue;
            // (a long run is cut into pieces of at most 6 m so a hedge's height wobbles a little)
            const n = Math.max(1, Math.round(L / 5));
            for (let k = 0; k < n; k++) {
              const a = [p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n], b = [p[0] + (q[0] - p[0]) * (k + 1) / n, p[1] + (q[1] - p[1]) * (k + 1) / n];
              hedgeRun(W, F, a, b, w, h * (0.96 + hrng() * 0.08), yb, rgb, kind, rnd, k === 0 || k === n - 1);
            }
            stats.hedgeM += L;
          }
        }
        stats.hedges++; stats.lidarHedges++;
      }

      // ---- the lot line from the rule: along the street edge of the lot (a gap at the walk, the drive's mouth), and a short return along each open side
      if (line) {
        const hh = lerp(gr.h, line === 'hedge' ? S.hedgeH : S.wallH);
        const stoneRgb = lin(weighted([[0x9a968c, 3], [0x8a8478, 2], [0xa8a398, 2]], gr.tone)), pierRgb = lin(0xb5b0a4);
        const brickCol = ctx.brickRgb ? shade(ctx.brickRgb, 0.85) : lin(0x7c6154);
        const hedgeRgb = colours().green;
        const sideLen = Math.min(yd - 0.4, 2.5 + gr.sideLen * 4);
        const doSide = gr.side < 0.6;
        const runs = [[[uA, -yd], [gap[0], -yd]], [[gap[1], -yd], [uB, -yd]]];
        if (doSide) {
          if (!partyL) runs.push([[uA, -yd], [uA, -yd + sideLen]]);
          if (!partyR) runs.push([[uB, -yd], [uB, -yd + sideLen]]);
        }
        const cuts = [];
        for (const r of runs) for (const seg of drive && Math.abs(r[0][1] - r[1][1]) < 1e-3 ? splitDrive(r, drive) : [r]) cuts.push(seg);
        const ironH = 0.95 + gr.h * 0.5, plinth = 0.3 + gr.plinth * 0.25;
        const picketRgb = lin(weighted([[0xe9e6dc, 6], [0xd8d4c8, 3], [0x8d9aa2, 1], [0x7a5b3f, 2], [0x4c6a58, 1]], gr.tone));
        for (const [a, b] of cuts) {
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.7) continue;
          const side = Math.abs(a[0] - b[0]) < 1e-3;
          const k = side ? 0.8 : 1;
          if (line === 'hedge') { hedgeRun(W, F, a, b, 0.8 + gr.plinth * 0.4, hh * k, yb, hedgeRgb, KIND.evergreen, gr.tone); stats.hedges++; stats.hedgeM += Math.hypot(b[0] - a[0], b[1] - a[1]); }
          else if (line === 'stone' || line === 'brick') wallRun(W, F, a, b, { h: hh * k, yb, rgb: line === 'stone' ? stoneRgb : brickCol, pier: line === 'stone' ? pierRgb : shade(brickCol, 1.12), cap: lin(0xb5b0a4), rnd: gr.tone });
          else if (line === 'iron') fenceRun(W, F, a, b, { type: 'iron', h: ironH * k, yb, rgb: lin(0x1a1b1d), post: lin(0x1a1b1d), plinth: gr.plinth < 0.6 ? plinth : 0, plinthRgb: stoneRgb, rnd: gr.tone });
          else if (line === 'picket') fenceRun(W, F, a, b, { type: 'picket', h: (0.8 + gr.h * 0.25) * k, yb, rgb: picketRgb, post: picketRgb, plinth: 0, rnd: gr.tone });
          else if (line === 'chain') fenceRun(W, F, a, b, { type: 'chain', h: 1.05 + gr.h * 0.3, yb, rgb: lin(0x8f969b), post: lin(0x6f767a), plinth: 0, rnd: gr.tone });
        }
        // piers either side of the gate on a wall or a fence of stone or iron
        if (line === 'stone' || line === 'brick' || (line === 'iron' && gr.gate < 0.7)) {
          for (const u of [gap[0] - 0.12, gap[1] + 0.12]) post(W, F, u, -yd, 0.22, yb - SKIRT, yb + hh + 0.35, line === 'brick' ? shade(brickCol, 1.12) : pierRgb, lin(0xb5b0a4));
        }
        stats.fence = line;
      }

      // ---- the odd ornamental tree (a small crown on a thin trunk: a Japanese maple, a crab apple) and the odd lamp post at the walk
      if (rt() < S.tree && yd >= 4 && (ctx.canopy == null || ctx.canopy < 0.3)) {
        const side = rt() < 0.5 ? -1 : 1;
        const u = side < 0 ? (partyL ? u0 + 1 : Math.max(uA + 1.2, u0 - 0.5)) : (partyR ? u1 - 1 : Math.min(uB - 1.2, u1 + 0.5));
        const v = -yd * (0.45 + rt() * 0.25), maple = rt() < 0.5;
        post(W, F, u, v, 0.1, y0 - 0.1, y0 + 1.7 + rt() * 0.4, lin(0x4a3b2c), lin(0x4a3b2c));
        const cr = 1.2 + rt() * 0.8;
        dome(W, F, u, v, cr, cr, 1.9 + rt() * 0.6, y0 + 1.5, maple ? lin(weighted([[0x6a1f2b, 3], [0x7a2a33, 2], [0x4a1c2a, 1]], rt())) : lin(weighted([[0x5d7a45, 3], [0x4a6a35, 2]], rt())), KIND.deciduous, rt(), 0.18);
        stats.trees++;
      }
      if (rg() < S.lamp && yd >= 3.6) {
        const u = gap[1] + 0.45, v = -yd + 0.55;
        post(W, F, u, v, 0.05, y0, y0 + 2.2, lin(0x1d1e20), lin(0x1d1e20));
        post(W, F, u, v, 0.12, y0 + 2.2, y0 + 2.5, lin(0xe8dcb0), lin(0x1d1e20));
        stats.lamps++;
      }
      void wrng; void c;
      stats.tris = W.tris;
      return W.tris;
    }
  };
}

// a street-line run with the drive's mouth cut out of it
function splitDrive(run, d) {
  const [a, b] = run, lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]), v = a[1];
  if (hi <= d.u0 - 0.15 || lo >= d.u1 + 0.15) return [run];
  const out = [];
  if (d.u0 - 0.15 - lo > 0.5) out.push([[lo, v], [d.u0 - 0.15, v]]);
  if (hi - (d.u1 + 0.15) > 0.5) out.push([[d.u1 + 0.15, v], [hi, v]]);
  return out;
}

/** The yard style of a Rosedale house record (js/rosedale-houses.js: its style code and the lot's frontage): the post-war and Moderne houses stand behind plainer yards, a big
 *  lot of a Georgian, revival, Victorian or Tudor house behind the grander ones (walls and piers, wrought iron) */
export function rosedaleYardStyle(h) {
  if (h.style === 10 || h.style === 11) return 'postwar';
  if (h.lotW >= 15 && (h.style === 2 || h.style === 3 || h.style === 5)) return 'rosedaleGrand';
  return 'rosedale';
}
