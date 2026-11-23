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
