// js/building-draw-detail.js — the near-tier details of a drawn house (st-ndw9.18): window sills and lintels, porch columns and
// the steps. Pure functions with no three.js and no DOM, called from planHouse's pushRoof (js/building-draw.js) for the NEAR roof only
// (lod false): the far roof and the walls' mid and far tiers never get them. Flat-coloured triangles in the hipped roofs' batch, as
// the bargeboards and dormers are: no material, mesh or draw call is added.
//
// Frame. As in js/building-draw.js: u along the front, v = -w out of the wall (so a part standing proud has a negative v), y up.
//
// The window grid is the facade shader's own (js/tsl-materials.js facadeCell): a stretch of wall `w` m wide holds bays of
// inner / round(inner / windowWidth) m between corner piers of min(cornerPier, 0.2 w); the opening is windowRatioX of the bay and
// windowRatioY of the storey, centred in its cell, the rows at whole storeys of the style's floorHeight counted from y = 0.

import { shade } from './building-draw-kit.js';

/**
 * The window openings of a front: [{ u0, u1, yb, yt, f }] for every window of every wall stretch.
 * `stretches`: [{ a, b, kind }] (the front's wall pieces, in u); `style`: the facade variant's { windowWidth, floorHeight, windowRatioX,
 * windowRatioY, cornerPier }; `storeys`; `skip`: [[ua, ub]] stretches of u that something stands in front of (a bay); `door`: the wall kind
 * whose ground floor has a door in a bay the plan does not know (its ground floor is left alone); `groundOff`: no window below the
 * first storey; `entry`: kind of the door wall.
 */
export function windowOpenings(stretches, style, storeys, o = {}) {
  const out = [];
  const { windowWidth: ww, floorHeight: fh, windowRatioX: rx, windowRatioY: ry, cornerPier: cp } = style;
  const hy = (1 - ry) * 0.5 * fh;
  for (const s of stretches) {
    const w = s.b - s.a;
    if (w < 0.6) continue;
    const pier = Math.min(cp, w * 0.2), inner = w - 2 * pier, bays = Math.max(Math.floor(inner / ww + 0.5), 1), bw = inner / bays;
    for (let k = 0; k < bays; k++) {
      const c = s.a + pier + (k + 0.5) * bw, hw = rx * bw / 2;
      if (hw < 0.2) continue;
      if (o.skip && o.skip.some(([ua, ub]) => c + hw > ua - 0.1 && c - hw < ub + 0.1)) continue;
      for (let f = 0; f < storeys; f++) {
        if (f === 0 && (o.groundOff || s.kind === o.entry)) continue; // (the door's bay is the shader's pick: no sill on a floor that may hold a door)
        out.push({ u0: c - hw, u1: c + hw, yb: f * fh + hy, yt: (f + 1) * fh - hy, f });
      }
    }
  }
  return out;
}

/**
 * A stone sill and a lintel over each opening: the sill a slab 0.1 m deep projecting 7 cm (a front and a top, 4 triangles), the lintel a
 * flat band standing 4 cm proud (2 triangles). Returns the triangle count written.
 */
export function sillsAndLintels(W, F, openings, o) {
  const P = F.P, n0 = W.tris;
  const { sillRgb, lintelRgb } = o, top = shade(sillRgb, 1.08);
  const sd = o.sillOut ?? 0.07, sh = o.sillH ?? 0.1, lh = o.lintelH ?? 0.19, wx = o.sillWide ?? 0.08;
  for (const w of openings) {
    if (o.sill !== false) {
      const a = w.u0 - wx, b = w.u1 + wx, yt = w.yb - 0.02, yb = yt - sh;
      W.quadFace(P(a, -sd, yb), P(b, -sd, yb), P(b, -sd, yt), P(a, -sd, yt), sillRgb, F.out);
      W.quadFace(P(a, 0, yt), P(b, 0, yt), P(b, -sd, yt), P(a, -sd, yt), top, [0, 1, 0]);
    }
    if (o.lintel !== false) {
      const a = w.u0 - 0.1, b = w.u1 + 0.1, yb = w.yt + 0.02, yt = yb + lh;
      W.quadFace(P(a, -0.04, yb), P(b, -0.04, yb), P(b, -0.04, yt), P(a, -0.04, yt), lintelRgb, F.out);
    }
  }
  return W.tris - n0;
}

/**
 * The details of a porch (st-ndw9.18): wooden columns on the brick plinths (the plinth records are the caller's: they stop at
 * `plinth`), the deck's edge and a low front step the full width. `piers`: [{ uc, vc, hw }] the plinths.
 */
export function porchDetail(W, F, p) {
  const P = F.P, n0 = W.tris;
  const { u0, u1, depth, y0, deckY, plinth, slabY, piers, colRgb, deckRgb, stepRgb } = p;
  const cw = 0.1; // half width of a column
  // the deck: the porch floor at deckY, its front and ends in concrete
  const dv = -depth;
  W.quadFace(P(u0, dv, y0), P(u1, dv, y0), P(u1, dv, y0 + deckY), P(u0, dv, y0 + deckY), deckRgb, F.out);
  W.quadFace(P(u0, dv, y0 + deckY), P(u1, dv, y0 + deckY), P(u1, 0, y0 + deckY), P(u0, 0, y0 + deckY), shade(deckRgb, 1.1), [0, 1, 0]);
  // the low step along the whole front
  const sv = dv - 0.3, sy = y0 + deckY * 0.5;
  W.quadFace(P(u0, sv, y0), P(u1, sv, y0), P(u1, sv, sy), P(u0, sv, sy), stepRgb, F.out);
  W.quadFace(P(u0, sv, sy), P(u1, sv, sy), P(u1, dv, sy), P(u0, dv, sy), shade(stepRgb, 1.1), [0, 1, 0]);
  // the columns on the plinths (the front stays open: the door's place is the shader's pick, so no rail closes it)
  const sorted = [...piers].sort((a, b) => a.uc - b.uc);
  for (const q of sorted) {
    const x0 = q.uc - cw, x1 = q.uc + cw, v0 = q.vc + cw, v1 = q.vc - cw, yb = y0 + plinth, yt = y0 + slabY;
    W.quadFace(P(x0, v1, yb), P(x1, v1, yb), P(x1, v1, yt), P(x0, v1, yt), colRgb, F.out);
    W.quadFace(P(x0, v0, yb), P(x0, v1, yb), P(x0, v1, yt), P(x0, v0, yt), shade(colRgb, 0.88), F.left);
    W.quadFace(P(x1, v1, yb), P(x1, v0, yb), P(x1, v0, yt), P(x1, v1, yt), shade(colRgb, 0.94), F.right);
  }
  return W.tris - n0;
}

// ---- the Rosedale houses' silhouette parts (jf-bya, docs/rosedale-walls.md) -----------------------------------------------------------------------

/**
 * A chimney stack: a box of w (along u) by d (along v) from yb to yt centred on (u, v), with a slightly wider cap slab on top. Four sides and the
 * cap's top and underside as flat quads: 12 triangles. A stack stands out of the roof, so it is drawn from yb, below the slope it comes through.
 */
export function chimneyBox(W, F, c) {
  const P = F.P, n0 = W.tris;
  const { u, v, w, d, yb, yt, rgb, capRgb } = c;
  const u0 = u - w / 2, u1 = u + w / 2, v0 = v + d / 2, v1 = v - d / 2; // (v1 is the outer face: v negative is out of the wall)
  const sideTop = yt - 0.12;
  W.quadFace(P(u0, v1, yb), P(u1, v1, yb), P(u1, v1, sideTop), P(u0, v1, sideTop), rgb, F.out);
  W.quadFace(P(u0, v0, yb), P(u1, v0, yb), P(u1, v0, sideTop), P(u0, v0, sideTop), shade(rgb, 0.85), F.in);
  W.quadFace(P(u0, v0, yb), P(u0, v1, yb), P(u0, v1, sideTop), P(u0, v0, sideTop), shade(rgb, 0.88), F.left);
  W.quadFace(P(u1, v1, yb), P(u1, v0, yb), P(u1, v0, sideTop), P(u1, v1, sideTop), shade(rgb, 0.94), F.right);
  // the cap: a slab 6 cm wider than the stack, 12 cm deep
  const cu0 = u0 - 0.06, cu1 = u1 + 0.06, cv0 = v0 + 0.06, cv1 = v1 - 0.06;
  W.quadFace(P(cu0, cv1, sideTop), P(cu1, cv1, sideTop), P(cu1, cv1, yt), P(cu0, cv1, yt), capRgb, F.out);
  W.quadFace(P(cu0, cv1, yt), P(cu1, cv1, yt), P(cu1, cv0, yt), P(cu0, cv0, yt), shade(capRgb, 1.05), [0, 1, 0]);
  return W.tris - n0;
}

/**
 * A portico over a front door: two columns, a flat soffit and a small gable, in front of the wall (u from c - w/2 to c + w/2, out to `depth`), standing
 * `h` high. The gable's slope is `pitch`. 2 + 2 columns (6 triangles each) + the gable (about 12): about 30 triangles.
 */
export function porticoDetail(W, F, p) {
  const P = F.P, n0 = W.tris;
  const { c, w, depth, y0, h, colRgb, roofRgb, endRgb, pitch } = p;
  const u0 = c - w / 2, u1 = c + w / 2, cw = 0.09, dv = -depth + 0.15;
  for (const uc of [u0 + 0.2, u1 - 0.2]) {
    const x0 = uc - cw, x1 = uc + cw, yb = y0 + 0.36, yt = y0 + h;
    W.quadFace(P(x0, dv - cw, yb), P(x1, dv - cw, yb), P(x1, dv - cw, yt), P(x0, dv - cw, yt), colRgb, F.out);
    W.quadFace(P(x0, dv + cw, yb), P(x0, dv - cw, yb), P(x0, dv - cw, yt), P(x0, dv + cw, yt), shade(colRgb, 0.88), F.left);
    W.quadFace(P(x1, dv - cw, yb), P(x1, dv + cw, yb), P(x1, dv + cw, yt), P(x1, dv - cw, yt), shade(colRgb, 0.94), F.right);
  }
  // the pediment: a gable over the columns, its ridge into the wall
  const hw = w / 2 + 0.12, rise = hw * Math.tan(pitch), yb = y0 + h, yE = P(c, 0, yb)[1];
  const fl = P(c - hw, -depth, yb), fr = P(c + hw, -depth, yb), bl = P(c - hw, 0.05, yb), br = P(c + hw, 0.05, yb), rf = P(c, -depth, yb + rise), rb = P(c, 0.05, yb + rise);
  W.quadSlope(fl, bl, rb, rf, roofRgb, yE, pitch);
  W.quadSlope(fr, rf, rb, br, roofRgb, yE, pitch);
  W.face(fl, fr, rf, endRgb, F.out);
  W.quadFace(P(c - hw, -depth, yb - 0.04), P(c + hw, -depth, yb - 0.04), P(c + hw, 0.05, yb - 0.04), P(c - hw, 0.05, yb - 0.04), shade(roofRgb, 0.6), [0, -1, 0]);
  return W.tris - n0;
}

/** A pair of shutters beside each opening ([{ u0, u1, yb, yt }]): flat boards 0.45 m wide just proud of the wall, 4 triangles an opening. */
export function shutterBoards(W, F, openings, rgb) {
  const P = F.P, n0 = W.tris, sw = 0.42, gap = 0.07, off = 0.035;
  for (const o of openings) {
    for (const [a, b] of [[o.u0 - gap - sw, o.u0 - gap], [o.u1 + gap, o.u1 + gap + sw]]) {
      W.quadFace(P(a, -off, o.yb - 0.04), P(b, -off, o.yb - 0.04), P(b, -off, o.yt + 0.04), P(a, -off, o.yt + 0.04), rgb, F.out);
    }
  }
  return W.tris - n0;
}

/**
 * The cone over a corner turret: `n` slopes from the ring of radius r + `eave` at height y up to an apex `h` above, a soffit disc under it. The
 * turret's walls are a record of their own (the facade shader's windows). Returns the triangle count.
 */
export function turretDetail(W, F, t) {
  const P = F.P, n0 = W.tris;
  const { u, v, r, n, y, h, rgb, capRgb } = t, R = r + 0.3, pitch = Math.atan2(h, R);
  const apex = P(u, v, y + h);
  const ring = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; ring.push(P(u + Math.cos(a) * R, v + Math.sin(a) * R, y)); }
  for (let k = 0; k < n; k++) W.slope(ring[k], ring[(k + 1) % n], apex, k % 2 ? shade(rgb, 0.92) : rgb, y, pitch);
  const centre = P(u, v, y - 0.05);
  for (let k = 0; k < n; k++) W.face(ring[k], ring[(k + 1) % n], centre, shade(rgb, 0.55), [0, -1, 0]);
  // a finial
  const f0 = P(u, v, y + h), f1 = P(u, v, y + h + 0.5), w = 0.04;
  W.quadFace([f0[0] - w, f0[1], f0[2]], [f0[0] + w, f0[1], f0[2]], [f1[0] + w, f1[1], f1[2]], [f1[0] - w, f1[1], f1[2]], capRgb, F.out);
  W.quadFace([f0[0], f0[1], f0[2] - w], [f0[0], f0[1], f0[2] + w], [f1[0], f1[1], f1[2] + w], [f1[0], f1[1], f1[2] - w], capRgb, F.left);
  return W.tris - n0;
}

// ---- the front yard (jf-bya, docs/rosedale-walls.md) ----------------------------------------------------------------------------------------------

// an upright box [u0, u1] x [v0, v1] (v0 nearer the wall) from yb to yt: the face toward the street, the top and the two ends (the back and the underside are never seen)
function yardBox(W, F, u0, u1, v0, v1, yb, yt, rgb) {
  const P = F.P;
  W.quadFace(P(u0, v1, yb), P(u1, v1, yb), P(u1, v1, yt), P(u0, v1, yt), rgb, F.out);
  W.quadFace(P(u0, v1, yt), P(u1, v1, yt), P(u1, v0, yt), P(u0, v0, yt), shade(rgb, 1.12), [0, 1, 0]);
  W.quadFace(P(u0, v0, yb), P(u0, v1, yb), P(u0, v1, yt), P(u0, v0, yt), shade(rgb, 0.86), F.left);
  W.quadFace(P(u1, v1, yb), P(u1, v0, yb), P(u1, v0, yt), P(u1, v1, yt), shade(rgb, 0.92), F.right);
}

/**
 * A house's front yard in the near roof batch, as flat-coloured shapes on the ground (no lawn: the ground there is already the season's; a green sheet would
 * fight the snow). `y` = { y0, uA, uB (the lot's width along the front), yd (the yard's depth, m from the wall to the lot line), gap: [ua, ub] (the walk), kind:
 * 'hedge' | 'wall' | null (along the lot line), hh (its height), rgb (its colour), pier (the wall's piers' colour), walk: rgb | null, drive: { u0, u1, to (m beyond the
 * wall line, v positive), rgb } | null }. Returns the triangle count: about 12 for a hedge, 24 for a wall with piers, 2 for the walk and 2 for a drive.
 */
export function yardDetail(W, F, y) {
  const n0 = W.tris, P = F.P, y0 = y.y0;
  const flat = (ring, h, rgb) => { const pts = ring.map(([u, v]) => P(u, v, y0 + h)); W.quadFace(pts[0], pts[1], pts[2], pts[3], rgb, [0, 1, 0]); };
  if (y.drive) { const d = y.drive; flat([[d.u0, d.to], [d.u1, d.to], [d.u1, -y.yd], [d.u0, -y.yd]], 0.04, d.rgb); }
  if (y.walk) flat([[y.gap[0] + 0.1, 0], [y.gap[1] - 0.1, 0], [y.gap[1] - 0.1, -y.yd], [y.gap[0] + 0.1, -y.yd]], 0.05, y.walk);
  if (y.kind) {
    const t = y.kind === 'wall' ? 0.34 : 0.7, v0 = -y.yd + t, v1 = -y.yd, h = y.hh;
    const segs = [[y.uA, y.gap[0]]];
    if (!y.drive || y.drive.u1 <= y.gap[0] || y.drive.u0 >= y.gap[1]) segs.push([y.gap[1], y.uB]);
    else segs.push([y.gap[1], y.uB]);
    for (const [a, b] of segs) {
      if (!(b - a > 0.5)) continue;
      // (a drive's mouth: the hedge or wall stops where the drive crosses the lot line)
      let pieces = [[a, b]];
      if (y.drive) pieces = pieces.flatMap(([p, q]) => { const o = [], m0 = Math.max(p, y.drive.u0), m1 = Math.min(q, y.drive.u1); if (m0 < m1) { if (m0 - p > 0.4) o.push([p, m0]); if (q - m1 > 0.4) o.push([m1, q]); return o; } return [[p, q]]; });
      for (const [p, q] of pieces) {
        yardBox(W, F, p, q, v0, v1, y0, y0 + h, y.rgb);
        if (y.kind === 'wall') for (const u of [p, q]) yardBox(W, F, u - 0.2, u + 0.2, v1 + 0.1, v1 - 0.12, y0, y0 + h + 0.28, y.pier);
      }
    }
  }
  return W.tris - n0;
}
