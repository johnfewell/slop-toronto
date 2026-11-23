// js/building-draw-worship.js — draws the six worship presets (st-ndw9.20): the Gothic church, the chapel, the modern church, the
// mosque, the synagogue and the temple, behind ?massing=1&presets=draw and the ?gallery=presets page. Pure functions with no
// three.js and no DOM, called from planHouse (js/building-draw.js) for a preset whose DRAW entry has kind 'worship'.
//
// A church is several massing parts (a nave, a tower, an aisle, a hall). The group's facts (js/building-presets.js drawFactsFrom)
// say which part this is: the largest is the nave; a compact part much smaller than the nave and taller than it is the tower;
// the rest are wings. Every part keeps its real outline and wall kinds (the page's entrance rule) and is drawn to a whole number
// of the style's storeys; what goes on top is flat-coloured triangles in the hipped roofs' batch (always drawn): a gable roof
// along the nave's long axis, a tower and spire, a porch and bellcote, a dome and a minaret, twin towers, a tiered or stepped roof,
// each a few hundred triangles at most. Where the data has no tower part a church gets one at the street end of its nave. Every
// random choice comes from the group's durable id; the group's religion and tradition choose the stone and the form.

import { WALL, stream, weighted, lerp, rad, clamp, shade, writer, slab, tarRgb, makeFrame, gableRoof, hipRoof } from './building-draw-kit.js';
import { obbOf, ringArea, inRing, boxTris } from './building-draw-tall.js';
import { DRAW, FACADE_VARIANTS, FIRST_DRAW_VARIANT } from './building-prototypes.js';
import { windowOpenings } from './building-draw-detail.js';

// a Gothic church whose largest part is under this footprint (m2) is too small to carry the older church's tower: it takes the chapel's look
export const GOTHIC_MIN_AREA = 300;

const DARK_GLASS = [0.012, 0.018, 0.022];

// a four-sided pyramid on a rectangle: four triangles
function pyramid(W, c, t, hu, hv, y, rise, rgb) {
  const s = [-t[1], t[0]], P = (u, v, yy) => [c[0] + t[0] * u + s[0] * v, yy, c[1] + t[1] * u + s[1] * v];
  const ap = P(0, 0, y + rise), q = [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]];
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], mx = (a[0] + b[0]) / 2, mv = (a[1] + b[1]) / 2;
    const f = [t[0] * mx + s[0] * mv, 0.45, t[1] * mx + s[1] * mv];
    W.face(P(a[0], a[1], y), P(b[0], b[1], y), ap, shade(rgb, i % 2 ? 0.88 : 1), f);
  }
}
// a dome: a hemisphere of `segs` sides and `rings` rings
function dome(W, c, r, y, rgb, segs = 10, rings = 3) {
  const pt = (j, k) => { const ph = (j / rings) * Math.PI / 2, th = (k / segs) * Math.PI * 2; return [c[0] + Math.cos(th) * r * Math.cos(ph), y + r * Math.sin(ph), c[1] + Math.sin(th) * r * Math.cos(ph)]; };
  for (let j = 0; j < rings; j++) for (let k = 0; k < segs; k++) {
    const a = pt(j, k), b = pt(j, k + 1), d = pt(j + 1, k), e = pt(j + 1, k + 1), fc = [(a[0] + b[0]) / 2 - c[0], 0.5, (a[2] + b[2]) / 2 - c[1]];
    const col = shade(rgb, 0.92 + 0.08 * Math.cos(((k + 0.5) / segs) * Math.PI * 2));
    if (j === rings - 1) W.face(a, b, d, col, fc);
    else { W.face(a, b, e, col, fc); W.face(a, e, d, col, fc); }
  }
}
// a round window: a fan of 8 triangles in a vertical plane, centred at (x, y, z), facing f (a horizontal unit vector)
function disc(W, x, y, z, r, f, rgb) {
  const s = [-f[2], 0, f[0]], pt = (k) => { const a = (k / 8) * Math.PI * 2; return [x + s[0] * Math.cos(a) * r, y + Math.sin(a) * r, z + s[2] * Math.cos(a) * r]; };
  for (let k = 0; k < 8; k++) W.face([x, y, z], pt(k), pt(k + 1), rgb, f);
}


// ---- pointed openings and a belfry stage (st-ndw9.18) -------------------------------------------------------------------------
// A face is { c: [x, z] centre, sv: [x, z] along it, n: [x, z] out of it }: P(u, y, o) is a point u along it, y up, o out of it.
const faceP = (f) => (u, y, o) => [f.c[0] + f.sv[0] * u + f.n[0] * o, y, f.c[1] + f.sv[1] * u + f.n[1] * o];
// a pointed (lancet) opening: a stone surround 0.1 m wider behind a dark glass, the glass a rectangle to the springing and a pointed head
// (the head 0.85 of the width: an equilateral arch). Six triangles. yb: the sill, yt: the apex
function lancet(W, f, u, w, yb, yt, glass, stone, off = 0.04) {
  const P = faceP(f), nrm = [f.n[0], 0, f.n[1]], hw = w / 2, head = w * 0.85, ys = Math.max(yb + 0.3, yt - head), s = 0.1;
  W.quadFace(P(u - hw - s, yb, off), P(u + hw + s, yb, off), P(u + hw + s, ys, off), P(u - hw - s, ys, off), stone, nrm);
  W.face(P(u - hw - s, ys, off), P(u + hw + s, ys, off), P(u, yt + 0.16, off), stone, nrm);
  W.quadFace(P(u - hw, yb + 0.05, off + 0.025), P(u + hw, yb + 0.05, off + 0.025), P(u + hw, ys, off + 0.025), P(u - hw, ys, off + 0.025), glass, nrm);
  W.face(P(u - hw, ys, off + 0.025), P(u + hw, ys, off + 0.025), P(u, yt, off + 0.025), glass, nrm);
  return 6;
}
// a pointed head on top of an opening the facade shader draws (a flat-topped window): the glass colour in the pointed shape over it
function pointedHead(W, f, u, w, yt, glass, stone, off = 0.03) {
  const P = faceP(f), nrm = [f.n[0], 0, f.n[1]], hw = w / 2, head = w * 0.85;
  W.face(P(u - hw - 0.08, yt - 0.02, off), P(u + hw + 0.08, yt - 0.02, off), P(u, yt + head + 0.14, off), stone, nrm);
  W.face(P(u - hw, yt - 0.02, off + 0.02), P(u + hw, yt - 0.02, off + 0.02), P(u, yt + head, off + 0.02), glass, nrm);
  return 2;
}
// the tower of a Gothic church, standing at tc with half width `half` from y0 to `top`: four stages in flat colour: the base with a
// pointed door on the street face and a slim lancet on each face, a string course, the belfry with a twin lancet on each face, a cornice
// that carries the spire (or four pinnacles when there is none). `fd`: the street face's outward direction.
function gothicTower(W, o) {
  const { tc, t, half, y0, top, fd, wallRgb, stone, glass, door, lin } = o, hT = top - y0;
  const s = [-t[1], t[0]], ys = y0 + Math.max(hT * 0.58, Math.min(hT - 3.4, 6)), n0 = W.tris;
  const faces = [[fd, true], [[-fd[0], -fd[1]], false], [[-fd[1], fd[0]], false], [[fd[1], -fd[0]], false]];
  for (const [dn, street] of faces) {
    const f = { c: [tc[0] + dn[0] * half, tc[1] + dn[1] * half], sv: [-dn[1], dn[0]], n: dn };
    const lw = Math.min(0.62, half * 0.26);
    if (street && door) {
      // the pointed door: a surround, a dark arch and a leaf
      lancet(W, f, 0, Math.min(1.7, half * 0.9), y0, y0 + 3.5, lin(0x2a1c14), stone, 0.05);
    } else lancet(W, f, 0, lw * 1.2, y0 + hT * 0.2, y0 + hT * 0.2 + Math.min(4.4, (ys - y0) * 0.55), glass, stone);
    // the belfry: a twin lancet over the string course
    const bh = Math.min(top - ys - 1.3, 4.4), bw = Math.min(0.78, half * 0.3), gap = Math.min(half * 0.36, 1.0);
    if (bh > 1.6) for (const side of [-1, 1]) lancet(W, f, side * gap, bw, ys + 0.7, ys + 0.7 + bh, glass, stone);
  }
  // the string course under the belfry, and the cornice at the top: bands a little wider than the shaft
  boxTris(W, tc, t, half + 0.1, half + 0.1, ys - 0.14, ys + 0.2, stone, stone);
  boxTris(W, tc, t, half + 0.16, half + 0.16, top - 0.4, top, stone, stone);
  void s; void wallRgb;
  return W.tris - n0;
}
// four small pinnacles at the corners of a tower's top (when it carries no spire)
function pinnacles(W, tc, t, half, top, rgb) {
  const s = [-t[1], t[0]];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    const c = [tc[0] + t[0] * a * (half - 0.2) + s[0] * b * (half - 0.2), tc[1] + t[1] * a * (half - 0.2) + s[1] * b * (half - 0.2)];
    boxTris(W, c, t, 0.17, 0.17, top, top + 0.7, rgb, rgb);
    pyramid(W, c, t, 0.2, 0.2, top + 0.7, 0.7, rgb);
  }
  return 16 * 2;
}

// (st-ndw9.18) what makes a modern church read as one: a tall slit of light glass up the middle of the street gable (a slot to near the ridge
// with a pointed top) and a cross standing on the ridge at the street end. g: gableRoof's { uc, vF, rise, y }.
function modernEnd(W, F, g, ob, glass, lightGlass, crossRgb) {
  const P = F.P, vF = g.vF - 0.04, n0 = W.tris;
  const sw = Math.min(0.55, g.half * 0.09), y1 = g.y + 0.35, y2 = Math.max(y1 + 1.5, g.y + g.rise * 0.78), ya = y2 - sw * 2.4;
  if (g.rise > 2.6) {
    W.quadFace(P(g.uc - sw, vF, y1), P(g.uc + sw, vF, y1), P(g.uc + sw, vF, ya), P(g.uc - sw, vF, ya), lightGlass, F.out);
    W.face(P(g.uc - sw, vF, ya), P(g.uc + sw, vF, ya), P(g.uc, vF, y2), lightGlass, F.out);
  }
  const c = F.xz(g.uc, 0.4), yr = g.y + g.rise, t = [F.tx, F.tz];
  boxTris(W, c, t, 0.08, 0.08, yr - 0.1, yr + 2.7, crossRgb, crossRgb);
  boxTris(W, c, t, 0.62, 0.08, yr + 1.5, yr + 1.7, crossRgb, crossRgb);
  void glass; void ob;
  return W.tris - n0;
}

// (st-ndw9.18) the entrance portal of a mosque or a temple on its street end: a block standing 0.8 m out of the wall with the entrance in it. style
// 'arch' (a pointed arch recess in a screen wall that stands over the eave: a mosque's iwan, a gurdwara's), 'gopuram' (a stone frame under a short
// stepped top: a Hindu temple's), 'gate' (two red posts, a beam and a small roof: a Buddhist temple's). F is the hall's front frame (u across, v back).
function portal(W, F, o) {
  const P = F.P, n0 = W.tris, { u, w, y0, top, style, stone, dark, wood, roofRgb, lin } = o, hw = w / 2, d = 0.8, yt = y0 + top, nrm = F.out;
  const f = { c: F.xz(u, -d), sv: [F.tx, F.tz], n: [F.nx, F.nz] };
  if (style === 'gate') {
    const red = lin(0x9a2f2a), gold = lin(0xc9a46a), ph = Math.min(top, 3.8);
    for (const sd of [-1, 1]) { const c = F.xz(u + sd * hw * 0.8, -d); boxTris(W, c, [F.tx, F.tz], 0.22, 0.22, y0, y0 + ph, red, red); }
    boxTris(W, F.xz(u, -d), [F.tx, F.tz], hw * 0.8 + 0.4, 0.2, y0 + ph - 0.5, y0 + ph, red, red);
    boxTris(W, F.xz(u, -d), [F.tx, F.tz], hw * 0.8 + 0.5, 0.24, y0 + ph - 0.55, y0 + ph - 0.45, gold, gold);
    pyramid(W, F.xz(u, -d), [F.tx, F.tz], hw * 0.8 + 0.9, 0.9, y0 + ph, 0.9, roofRgb);
    return W.tris - n0;
  }
  W.quadFace(P(u - hw, -d, y0), P(u + hw, -d, y0), P(u + hw, -d, yt), P(u - hw, -d, yt), stone, nrm);
  W.quadFace(P(u - hw, 0, y0), P(u - hw, -d, y0), P(u - hw, -d, yt), P(u - hw, 0, yt), shade(stone, 0.86), F.left);
  W.quadFace(P(u + hw, -d, y0), P(u + hw, 0, y0), P(u + hw, 0, yt), P(u + hw, -d, yt), shade(stone, 0.92), F.right);
  W.quadFace(P(u - hw, 0, yt), P(u + hw, 0, yt), P(u + hw, -d, yt), P(u - hw, -d, yt), shade(stone, 1.1), [0, 1, 0]);
  if (style === 'gopuram') {
    // a short stepped top over the frame
    let sw = hw + 0.15, y = yt;
    for (let k = 0; k < 3; k++) { boxTris(W, F.xz(u, -d / 2), [F.tx, F.tz], sw, d / 2 + 0.15, y - 0.02, y + 0.7, shade(stone, 1.06 - 0.04 * k), shade(stone, 1.12)); y += 0.7; sw *= 0.72; }
    pyramid(W, F.xz(u, -d / 2), [F.tx, F.tz], sw, d / 2, y, 0.9, lin(0xc9a46a));
    lancetSquare(W, f, 0, w * 0.6, y0, y0 + top * 0.78, dark, shade(stone, 1.12));
  } else lancet(W, f, 0, w * 0.64, y0, y0 + top * 0.88, dark, shade(stone, 1.12), 0.03);
  // the door leaf in the recess
  W.quadFace(P(u - w * 0.2, -d - 0.06, y0), P(u + w * 0.2, -d - 0.06, y0), P(u + w * 0.2, -d - 0.06, y0 + Math.min(2.6, top * 0.5)), P(u - w * 0.2, -d - 0.06, y0 + Math.min(2.6, top * 0.5)), wood, nrm);
  return W.tris - n0;
}
// a square-headed opening (a surround and a dark glass): four triangles
function lancetSquare(W, f, u, w, yb, yt, glass, stone) {
  const P = faceP(f), nrm = [f.n[0], 0, f.n[1]], hw = w / 2;
  W.quadFace(P(u - hw - 0.12, yb, 0.04), P(u + hw + 0.12, yb, 0.04), P(u + hw + 0.12, yt + 0.12, 0.04), P(u - hw - 0.12, yt + 0.12, 0.04), stone, nrm);
  W.quadFace(P(u - hw, yb, 0.065), P(u + hw, yb, 0.065), P(u + hw, yt, 0.065), P(u - hw, yt, 0.065), glass, nrm);
  return 4;
}

const pick = (list, r) => list[Math.min(list.length - 1, Math.floor(r * list.length))];

/**
 * Plans one massing part of a place of worship. Input as planBlock's, plus `index` (the part's record index), `nearRoad`, and
 * `group`: { religion, tradition, name, recs: [{ index, area, h, asp }] }. Returns { ok: false, reason } or the plan planBlock returns.
 */
export function planWorship(inp, D) {
  const { preset, id, ring, edges, y0 = 0, lin, h, base = 0, roadDist = () => Infinity, nearRoad = null } = inp;
  const gid = inp.groupId || id, grp = inp.group || {};
  const fail = (reason, detail) => ({ ok: false, reason, detail });
  if (!Number.isFinite(h) || h <= 0 || !edges || !edges.length) return fail('bad-height');
  const b0 = Math.max(0, Math.min(base, h - 0.5));
  if (h - b0 < 2.4) return fail('too-low');
  const area = ringArea(ring);
  if (area < 6) return fail('too-small');
  const ob = obbOf(ring);
  if (!ob) return fail('too-irregular');

  // (a Gothic church too small for a tower of that kind takes the chapel's look)
  if (D.form === 'gothic' && inp.group && inp.group.recs && inp.group.recs.length && Math.max(...inp.group.recs.map((r) => r.area)) < GOTHIC_MIN_AREA) D = DRAW['church-chapel'];
  // (a mosque or temple that is a converted building, small or tall for a hall, keeps its apartment-like walls and is marked at the door)
  const nave0 = (grp.recs && grp.recs.length ? grp.recs : [{ area, h }]).reduce((m, r) => (r.area > m.area ? r : m));
  const converted = (D.form === 'mosque' || D.form === 'temple') && (nave0.area < 300 || nave0.h > 13); // (the group's: its parts agree)
  const g = stream(gid, `${preset}:group`);
  const gr = { wall: g(), stone: g(), roof: g(), pitch: g(), form: g(), tw: g(), twx: g(), spire: g(), spireH: g(), corner: g(), glass: g(), porch: g(), bell: g(), mod: g(), dome: g(), minaret: g(), rel: g(), flat: g(), mh: g(), side: g() };
  const religion = grp.religion || 'buddhist', tradition = grp.tradition || '';
  const high = (D.highChurch || []).includes(tradition);
  const stone = gr.stone < (high ? D.stoneShare[0] : D.stoneShare[1]);
  const wallHex = weighted(stone ? D.stone : D.brickWall, gr.wall);
  const vi = converted ? 3 : D.variants[0], variant = FIRST_DRAW_VARIANT + vi, floor = FACADE_VARIANTS[vi].floorHeight;
  const wallRgb = lin(wallHex), boxRgb = wallRgb.map((c) => Math.min(0.9, c * 1.3)), roofRgb = lin(weighted(D.roof, gr.roof)), trimRgb = lin(0xd7cdb4);
  const brick = D.form === 'gothic' ? true : D.form === 'chapel' || D.form === 'synagogue' ? true : D.form === 'modern' ? gr.mod < 0.45 : false;

  // ---- which part of the building this is
  const recs = grp.recs && grp.recs.length ? grp.recs : [{ index: inp.index, area, h, asp: ob.hu / ob.hv }];
  const nave = recs.reduce((m, r) => (r.area > m.area ? r : m), recs[0]);
  let towerRec = null;
  for (const r of recs) if (r !== nave && r.area <= 0.45 * nave.area && r.asp <= 1.9 && r.h >= nave.h * 1.05 && (!towerRec || r.h > towerRec.h)) towerRec = r;
  const isNave = inp.index === nave.index || recs.length === 1;
  const isTower = !!towerRec && inp.index === towerRec.index && D.form !== 'mosque' && D.form !== 'temple';
  const role = isNave ? 'nave' : isTower ? 'tower' : 'wing';
  const fitsGable = ob.fill >= 0.72 && ob.hv >= 2.2;

  // the street end: the short end of the nave nearer the road (the front)
  let tau = 1;
  if (nearRoad) tau = ((nearRoad.x - ob.cx) * ob.t[0] + (nearRoad.z - ob.cz) * ob.t[1]) >= 0 ? 1 : -1;
  const fd = [ob.t[0] * tau, ob.t[1] * tau], tf = [-fd[1], fd[0]];
  const A = [ob.cx + fd[0] * ob.hu - tf[0] * ob.hv, ob.cz + fd[1] * ob.hu - tf[1] * ob.hv];
  const F = makeFrame(A, [A[0] + tf[0], A[1] + tf[1]]); // u across the building from one side, v back from the front, y up

  // ---- the walls' height, by form
  const pitchDeg = D.pitch ? lerp(gr.pitch, D.pitch) : 30;
  let form = D.form, roofForm = 'gable';
  if (D.form === 'modern') roofForm = role === 'tower' ? 'flat' : weighted(D.forms, gr.form);
  else if (D.form === 'mosque' || D.form === 'temple') roofForm = 'flat';
  else if (D.form === 'synagogue') roofForm = gr.form < 0.5 ? 'gable' : 'flat';
  if (D.form === 'temple' && religion === 'buddhist') roofForm = 'tiered';
  if (role === 'tower') roofForm = 'spire';
  if (!fitsGable && (roofForm === 'gable' || roofForm === 'aframe' || roofForm === 'mono' || roofForm === 'tiered')) roofForm = 'flat';
  let rise = 0, n;
  // the City's height of a church is usually its spire or ridge, not its eave: a part far taller than a nave of its width would be
  // (about 4.5 m + 0.45 of its width, 7 to 13 m, under a ridge of its pitch) is a tower's top; its eave is the estimate, not h
  const estEave = clamp(4.5 + 0.45 * Math.min(ob.hv * 2, 24), 7, 13);
  let overH = false, eaveWanted = 0;
  if (roofForm === 'gable') {
    rise = Math.min(ob.hv * Math.tan(rad(pitchDeg)), 11);
    if (role === 'nave' && h > (estEave + rise) * 1.25) { overH = true; eaveWanted = estEave; }
    else { rise = Math.max(1.0, Math.min(rise, h - floor)); eaveWanted = h - b0 - rise; }
  } else if (roofForm === 'aframe') {
    // (st-ndw9.18) a steep pitch that says church from a bike and from the air: 58 degrees over the nave's width, a storey of wall under it
    rise = clamp(Math.min(ob.hv * Math.tan(rad(58)), Math.max(4, (h - b0) * 0.9)), 3.5, 13);
  }
  else if (roofForm === 'mono') rise = D.form === 'modern' ? clamp(ob.hv * 2 * 0.45, 3.2, 7) : Math.min(1.6, h * 0.25);
  else if (roofForm === 'tiered') rise = Math.min(ob.hv * Math.tan(rad(26)), h * 0.5);
  let spireRise = 0;
  if (role === 'tower') {
    // a spire where the data says there is one (st-ndw9.18): a tower part whose height is over four of its widths carries its spire in that
    // height (a plain tower is two to four widths to its parapet); the spire is what the height has over three and a bit widths
    const hh = h - b0, tw = ob.hv * 2, sp = D.form === 'gothic' ? hh / tw >= 4.0 : !!(D.tower && D.tower.spire != null && gr.spire < D.tower.spire);
    spireRise = sp ? clamp(D.form === 'gothic' ? hh - 3.2 * tw : lerp(gr.spireH, D.tower.spireRise || [1.3, 2.3]) * tw, 1.3 * tw, hh * 0.5) : 0;
    if (!sp) roofForm = 'flat';
  }
  if (roofForm === 'gable') n = Math.max(1, Math.round(eaveWanted / floor));
  else n = Math.max(1, Math.round((h - b0 - (roofForm === 'tiered' ? rise : roofForm === 'spire' ? spireRise : roofForm === 'aframe' ? 0 : rise)) / floor));
  if (roofForm === 'aframe') n = 1;
  // a hall (a mosque, a temple, a synagogue's) is one or two tall storeys, not an apartment block's
  if (!converted && (D.form === 'mosque' || D.form === 'temple' || D.form === 'synagogue')) n = 1; // (one storey of tall windows)
  if (D.form === 'modern' && role !== 'tower') n = Math.min(n, 2); // (low and broad)
  const eaveH = b0 + n * floor;
  const kinds = edges.map((e) => e.kind);
  const cover = edges.map((e, i) => (inp.covered && inp.covered.has(i) ? inp.covered.get(i) : NaN));
  const tar = tarRgb(lin, gid, id, preset);
  const stats = { N: 1, form: `${D.form}-${role}`, roofForm, fitsGable, fill: ob.fill, overH, h, tw: ob.hv * 2, tl: ob.hu * 2, area, storeys: n, roofTris: 0, gables: 0, dormers: 0, bays: 0, porches: 0, bargeboards: 0, towers: 0, spires: 0, domes: 0, minarets: 0, pointed: 0, portals: 0, crosses: 0 };

  const pushRoof = (Acc) => {
    const W = writer(Acc);
    const yE = y0 + eaveH, ov = 0.25;
    const fW = ob.hv * 2, fL = ob.hu * 2;
    const flat = () => { if (!inp.holes) slab(W, ring, yE - 0.015, tar); };
    // ---- the roof of this part
    if (roofForm === 'gable') {
      const g1 = gableRoof(W, F, { u0: 0, u1: fW, v0: 0, v1: fL, y: yE, pitch: rad(pitchDeg), rise, eL: ov, eR: ov, eF: ov, eB: ov, rgb: roofRgb, endRgb: D.form === 'modern' ? lin(0x34464e) : wallRgb, bands: null });
      stats.gables++;
      if (D.form === 'modern' && role === 'nave') { modernEnd(W, F, g1, ob, lin(0x34464e), lin(0x9fc2d2), lin(0xe6e4de)); stats.crosses++; }
      if (role === 'nave' && (D.form === 'gothic' || D.form === 'synagogue') && g1.rise > 2.2) { // the great window in the gable: a dark pointed lancet
        const ww = Math.min(2.6, fW * 0.26), y1 = yE + 0.4, y2 = yE + Math.min(g1.rise * 0.62, 5.2), vF = g1.vF - 0.05, uc = g1.uc;
        const P = F.P;
        W.quadFace(P(uc - ww / 2, vF, y1), P(uc + ww / 2, vF, y1), P(uc + ww / 2, vF, y2), P(uc - ww / 2, vF, y2), lin(0x1b2326), F.out);
        W.face(P(uc - ww / 2, vF, y2), P(uc + ww / 2, vF, y2), P(uc, vF, y2 + ww * 0.8), lin(0x1b2326), F.out);
      }
    } else if (roofForm === 'aframe') {
      const ga = gableRoof(W, F, { u0: 0, u1: fW, v0: 0, v1: fL, y: yE, rise, eL: 0.35, eR: 0.35, eF: 0.3, eB: 0.3, rgb: roofRgb, endRgb: lin(0x34464e), bands: null });
      stats.gables++;
      if (D.form === 'modern' && role === 'nave') { modernEnd(W, F, ga, ob, lin(0x34464e), lin(0x9fc2d2), lin(0xe6e4de)); stats.crosses++; }
    } else if (roofForm === 'mono') {
      const s = [-ob.t[1], ob.t[0]], P = (u, v, yy) => [ob.cx + ob.t[0] * u + s[0] * v, yy, ob.cz + ob.t[1] * u + s[1] * v];
      const hu = ob.hu + 0.3, hv = ob.hv + 0.3;
      W.quadSlope(P(-hu, -hv, yE), P(hu, -hv, yE), P(hu, hv, yE + rise), P(-hu, hv, yE + rise), roofRgb, yE, Math.atan2(rise, 2 * hv));
      W.face(P(-ob.hu, -ob.hv, yE), P(-ob.hu, ob.hv, yE), P(-ob.hu, ob.hv, yE + rise), wallRgb, [-ob.t[0], 0, -ob.t[1]]);
      W.face(P(ob.hu, -ob.hv, yE), P(ob.hu, ob.hv, yE), P(ob.hu, ob.hv, yE + rise), wallRgb, ob.t.length ? [ob.t[0], 0, ob.t[1]] : [1, 0, 0]);
      W.quadFace(P(-ob.hu, ob.hv, yE), P(ob.hu, ob.hv, yE), P(ob.hu, ob.hv, yE + rise), P(-ob.hu, ob.hv, yE + rise), wallRgb, [s[0], 0, s[1]]);
      if (D.form === 'modern' && role === 'nave' && rise > 2.4) {
        // tall slits of light glass in the high wall, and the cross on its top
        const nS = Math.max(2, Math.min(5, Math.round(ob.hu / 3.2))), gl = lin(0x9fc2d2);
        for (let k = 0; k < nS; k++) { const uu = -ob.hu + (k + 0.5) * (2 * ob.hu / nS); W.quadFace(P(uu - 0.32, ob.hv + 0.03, yE + 0.5), P(uu + 0.32, ob.hv + 0.03, yE + 0.5), P(uu + 0.32, ob.hv + 0.03, yE + rise - 0.5), P(uu - 0.32, ob.hv + 0.03, yE + rise - 0.5), gl, [s[0], 0, s[1]]); }
        const cc = [ob.cx + ob.t[0] * ob.hu * 0.7 + s[0] * (ob.hv - 0.4), ob.cz + ob.t[1] * ob.hu * 0.7 + s[1] * (ob.hv - 0.4)], cr = lin(0xe6e4de);
        boxTris(W, cc, ob.t, 0.08, 0.08, yE + rise - 0.1, yE + rise + 2.7, cr, cr); boxTris(W, cc, ob.s, 0.62, 0.08, yE + rise + 1.5, yE + rise + 1.7, cr, cr); stats.crosses++;
      }
      flat();
    } else if (roofForm === 'tiered') {
      const hr = hipRoof(W, F, { u0: 0, u1: fW, v0: 0, v1: fL, y: yE, pitch: rad(26), eL: 0.9, eR: 0.9, eF: 0.9, eB: 0.9, rgb: roofRgb });
      // the upper tier: a short wall in the lower roof's ridge, a smaller hip over it
      const c = [ob.cx, ob.cz], uw = ob.hu * 0.5, vw = ob.hv * 0.5, y1 = yE + hr.rise * 0.45;
      boxTris(W, c, ob.t, uw, vw, y1, y1 + 1.3, shade(wallRgb, 0.95), shade(roofRgb, 0.9));
      const F2 = F;
      hipRoof(W, F2, { u0: fW / 2 - vw, u1: fW / 2 + vw, v0: fL / 2 - uw, v1: fL / 2 + uw, y: y1 + 1.3, pitch: rad(30), eL: 0.7, eR: 0.7, eF: 0.7, eB: 0.7, rgb: shade(roofRgb, 1.08) });
    } else if (roofForm === 'spire') {
      flat();
      if (spireRise > 0) {
        if (D.form === 'gothic') boxTris(W, [ob.cx, ob.cz], ob.t, ob.hu + 0.14, ob.hv + 0.14, yE - 0.02, yE + 0.38, trimRgb, trimRgb); // (the cornice the spire stands on)
        pyramid(W, [ob.cx, ob.cz], ob.t, ob.hu + 0.15, ob.hv + 0.15, yE + (D.form === 'gothic' ? 0.36 : 0), spireRise, shade(roofRgb, 1.0)); stats.spires++;
      }
    } else flat();
    if (role === 'tower' && D.form === 'gothic') {
      // the tower the data has: pointed heads over the shader's windows, and a cornice and four pinnacles where there is no spire
      const glassC = lin(0x1b2326), style = FACADE_VARIANTS[vi];
      for (const e of edges) {
        if (e.kind < 0 || e.kind === WALL.lotLine || e.len < 2.4) continue;
        const tx = (e.bx - e.ax) / e.len, tz = (e.bz - e.az) / e.len, f = { c: [e.ax, e.az], sv: [tx, tz], n: [e.nx, e.nz] };
        for (const q of windowOpenings([{ a: 0, b: e.len, kind: e.kind }], style, n, { entry: WALL.entry })) {
          if (q.f === 0 && e.kind === WALL.entry) continue;
          const c = (q.u0 + q.u1) / 2, w = q.u1 - q.u0;
          pointedHead(W, { ...f, c: [f.c[0] + tx * c, f.c[1] + tz * c], }, 0, w, y0 + q.yt, glassC, trimRgb); stats.pointed++;
        }
      }
      if (spireRise <= 0) { boxTris(W, [ob.cx, ob.cz], ob.t, ob.hu + 0.14, ob.hv + 0.14, yE - 0.02, yE + 0.38, trimRgb, trimRgb); pinnacles(W, [ob.cx, ob.cz], ob.t, Math.min(ob.hu, ob.hv), yE + 0.36, trimRgb); }
    }
    if (roofForm !== 'gable' && roofForm !== 'aframe') { /* a flat roof: the cell cap is covered by the tar slab above */ }
    if (roofForm === 'gable' || roofForm === 'aframe') { /* the gable roof closes the top */ }

    // ---- what stands on or against the nave
    // (no buttresses: two rounds of them read as free-standing dark slabs; removed rather than shipped wrong)
    if (role === 'nave') {
      const wTower = clamp(lerp(gr.tw, D.tower && D.tower.width ? D.tower.width : [3.4, 4.4]) + Math.max(0, ob.hv - 7) * 0.35, 3.2, Math.min(10, Math.max(3.2, ob.hv * 2 * 0.8)));
      const sideOff = (D.form === 'gothic' && ob.hv >= 5) || gr.corner < 0.3 ? (gr.side < 0.5 ? -1 : 1) * Math.max(0, ob.hv - wTower / 2 - 0.1) : 0; // (a Gothic tower stands at a front corner: the nave's gable shows beside it)
      const tc = [ob.cx + fd[0] * (ob.hu - wTower / 2 + 0.04) + tf[0] * sideOff, ob.cz + fd[1] * (ob.hu - wTower / 2 + 0.04) + tf[1] * sideOff];
      const hasTowerRec = !!towerRec;
      if (D.form === 'gothic' && !hasTowerRec) {
        // the tower at the street end (st-ndw9.18): a box above the ridge in four stages (a door, a slim lancet, a belfry of twin lancets
        // under a cornice, js/building-draw-worship.js gothicTower), and a spire only where the data says there is one: a nave whose
        // height is far over a nave's own carries its spire in it (overH); a tower the data does not show has four pinnacles
        const withSpire = overH, spH = withSpire ? Math.min(lerp(gr.spireH, D.tower.spireRise) * wTower, Math.max(4, h * 0.4)) : 0;
        const top = overH ? y0 + h - spH : y0 + eaveH + rise + lerp(gr.twx, D.tower.extra);
        const half = wTower / 2;
        boxTris(W, tc, ob.t, half, half, y0, top, boxRgb, shade(tar, 0.9));
        gothicTower(W, { tc, t: ob.t, half, y0, top, fd, wallRgb: boxRgb, stone: trimRgb, glass: lin(0x1b2326), door: roadDist(tc[0] + fd[0] * (half + 2), tc[1] + fd[1] * (half + 2)) > 3, lin });
        if (withSpire) { pyramid(W, tc, ob.t, half + 0.12, half + 0.12, top, spH, roofRgb); stats.spires++; } else pinnacles(W, tc, ob.t, half, top, trimRgb);
        stats.towers++;
      }
      if (D.form === 'chapel') {
        if (gr.porch < D.porch) {
          const pc = [ob.cx + fd[0] * (ob.hu + 0.8), ob.cz + fd[1] * (ob.hu + 0.8)];
          if (roadDist(ob.cx + fd[0] * (ob.hu + 1.8), ob.cz + fd[1] * (ob.hu + 1.8)) >= 4.5) {
            for (const sd of [-1, 1]) boxTris(W, [pc[0] + ob.s[0] * sd * 1.0, pc[1] + ob.s[1] * sd * 1.0], ob.t, 0.09, 0.09, y0, y0 + 2.9, trimRgb, trimRgb);
            pyramid(W, pc, ob.t, 0.95, 1.45, y0 + 2.9, 1.1, roofRgb); stats.porches++;
          }
        }
        if (gr.bell < D.bellcote) { const bc = [ob.cx + fd[0] * (ob.hu - 1.2), ob.cz + fd[1] * (ob.hu - 1.2)]; boxTris(W, bc, ob.t, 0.5, 0.5, yE + rise - 0.2, yE + rise + 1.5, boxRgb, roofRgb); pyramid(W, bc, ob.t, 0.6, 0.6, yE + rise + 1.5, 1.1, roofRgb); }
      }
      if (D.form === 'modern' && D.tower && (gr.dome < D.tower || roofForm === 'flat')) { // (a flat-roofed one has no roof to say what it is: its tower and cross do)
        // a slender tower at a front corner, taller than the ridge, with a cross on it and a slit of light glass on each face
        const side = gr.side < 0.5 ? -1 : 1;
        // (the front corner on the group's side, then the other, then further in, then the back corners: the first that stands inside the outline)
        let tc2 = null;
        for (const [along, across, inset] of [[1, side, 1.1], [1, -side, 1.1], [1, side, 2.6], [1, -side, 2.6], [-1, side, 1.1], [-1, -side, 1.1]]) {
          const c = [ob.cx + fd[0] * along * (ob.hu - inset) + tf[0] * across * (ob.hv - inset), ob.cz + fd[1] * along * (ob.hu - inset) + tf[1] * across * (ob.hv - inset)];
          if (inRing(ring, c[0], c[1]) && inRing(ring, c[0] + 0.9, c[1]) && inRing(ring, c[0] - 0.9, c[1]) && inRing(ring, c[0], c[1] + 0.9) && inRing(ring, c[0], c[1] - 0.9)) { tc2 = c; break; }
        }
        if (tc2) {
          const half = 0.75, top = y0 + Math.max(eaveH + rise + 3.5, eaveH + 8.5) + gr.twx * 3, cr = [0.9, 0.9, 0.88];
          boxTris(W, tc2, ob.t, half, half, y0, top, boxRgb, shade(tar, 0.9));
          for (const dn of [fd, [-fd[0], -fd[1]], tf, [-tf[0], -tf[1]]]) {
            const f = { c: [tc2[0] + dn[0] * half, tc2[1] + dn[1] * half], sv: [-dn[1], dn[0]], n: dn }, P = faceP(f), nrm = [dn[0], 0, dn[1]];
            W.quadFace(P(-0.16, top - 4.2, 0.04), P(0.16, top - 4.2, 0.04), P(0.16, top - 0.9, 0.04), P(-0.16, top - 0.9, 0.04), lin(0x9fc2d2), nrm);
          }
          boxTris(W, tc2, ob.t, 0.09, 0.09, top, top + 2.9, cr, cr);
          boxTris(W, tc2, ob.s, 0.6, 0.09, top + 1.7, top + 1.9, cr, cr);
          stats.towers++; stats.crosses++;
        }
      }
      if (D.form === 'mosque' || (D.form === 'temple' && converted)) {
        const domeRgb = lin(weighted(D.dome || [[0xc8c3b6, 1]], gr.dome)), side = gr.side < 0.5 ? -1 : 1;
        if (converted) {
          // a converted building (every mosque and temple the data has is one: tall for a hall): its walls are the apartment-like ones, and what says
          // what it is stands at the door (st-ndw9.18): an entrance portal on the street end, a pointed arch under a small dome for a mosque or a
          // gurdwara, a stone frame with a stepped top for a Hindu temple, a red gate with a small roof for a Buddhist one. No minaret is drawn on a converted
          // mosque: the data has no compact tall part to say where one is
          const pw = clamp(fW * 0.22, 3.0, 5.0), ptop = clamp(eaveH * 0.4, 4.2, 7);
          const style = D.form === 'mosque' ? 'arch' : religion === 'hindu' ? 'gopuram' : religion === 'buddhist' ? 'gate' : 'arch';
          const stoneC = religion === 'hindu' && D.form === 'temple' ? shade(lin(weighted(D.sandstone || [[0xd8cdb4, 1]], gr.dome)), 1.15) : shade(boxRgb, 1.1);
          stats.portals += portal(W, F, { u: fW / 2, w: pw, y0, top: ptop, style, stone: stoneC, dark: lin(0x24383a), wood: lin(0x4a3426), roofRgb, lin }) ? 1 : 0;
          if (style === 'arch') { dome(W, F.xz(fW / 2, -0.4), pw * 0.58, y0 + ptop, domeRgb, 10, 3); stats.domes++; }
          // (no minaret on a converted mosque: the data has no compact tall part to carry one, John 2026-11-17)
        } else {
          // a prayer hall: a big dome over its centre on a low drum, a minaret standing at a corner from the ground
          // the dome is at least a third of the hall's width (here 0.9 of the half width = 0.9 of a half), on a drum 4 m high, set forward of the
          // middle so it shows from the street
          const r = clamp(ob.hv * 0.95, 3.2, 10), dcn = [ob.cx + fd[0] * ob.hu * 0.3, ob.cz + fd[1] * ob.hu * 0.3];
          boxTris(W, dcn, ob.t, r * 0.98, r * 0.98, yE - 0.02, yE + 4, boxRgb, shade(boxRgb, 1.05));
          dome(W, dcn, r, yE + 4, domeRgb, 12, 3); stats.domes++;
          // the minaret only where the data's height is over the dome's top by 2.5 m (what carries the City's height higher than the dome is something
          // tall: a minaret); its top is the data's height. Otherwise none is drawn
          if (h - b0 >= eaveH + 4 + r + 2.5) {
            const mc = [ob.cx + fd[0] * ob.hu + tf[0] * side * ob.hv, ob.cz + fd[1] * ob.hu + tf[1] * side * ob.hv], mh = y0 + h - 3.4;
            boxTris(W, mc, ob.t, 0.45, 0.45, y0, mh, boxRgb, shade(boxRgb, 1.1));
            boxTris(W, mc, ob.t, 0.95, 0.95, mh - 2.8, mh - 2.4, shade(boxRgb, 0.95), shade(boxRgb, 1.1));
            pyramid(W, mc, ob.t, 0.6, 0.6, mh, 3.4, domeRgb); stats.minarets++;
          }
          stats.portals += portal(W, F, { u: fW / 2, w: clamp(fW * 0.24, 3.0, 5.4), y0, top: eaveH + 1.6, style: 'arch', stone: shade(boxRgb, 1.08), dark: lin(0x24383a), wood: lin(0x4a3426), roofRgb, lin }) ? 1 : 0;
        }
      }
      if (D.form === 'synagogue') {
        // twin small towers at the front corners and a round window between them
        for (const side of [-1, 1]) {
          const sc = [ob.cx + fd[0] * (ob.hu - 1.3) + tf[0] * side * (ob.hv - 1.3), ob.cz + fd[1] * (ob.hu - 1.3) + tf[1] * side * (ob.hv - 1.3)];
          if (ob.hv < 3.2) continue;
          boxTris(W, sc, ob.t, 1.3, 1.3, y0, yE + 3.6, boxRgb, shade(tar, 0.9));
          pyramid(W, sc, ob.t, 1.4, 1.4, yE + 3.6, 2.2, roofRgb); stats.towers++;
        }
        disc(W, ob.cx + fd[0] * (ob.hu + 0.06), yE * 0.0 + y0 + Math.max(3.2, eaveH * 0.62), ob.cz + fd[1] * (ob.hu + 0.06), Math.min(1.2, ob.hv * 0.18), [fd[0], 0, fd[1]], lin(0x34464e));
      }
      if (D.form === 'temple' && !converted) {
        const sand0 = lin(weighted(D.sandstone || [[0xd8cdb4, 1]], gr.dome));
        stats.portals += portal(W, F, { u: fW / 2, w: clamp(fW * 0.2, 2.6, 4.6), y0, top: Math.max(3.8, eaveH + 0.4), style: religion === 'hindu' ? 'gopuram' : religion === 'buddhist' ? 'gate' : 'arch', stone: religion === 'hindu' ? shade(sand0, 1.15) : shade(boxRgb, 1.06), dark: lin(0x2a2220), wood: lin(0x4a3426), roofRgb, lin }) ? 1 : 0;
        // (a shikhara only where the data's height has 5 m over the hall's eave to carry it; its tiers share that height. Otherwise the shrine has a
        // flat roof and no tower is invented)
        const avail = h - b0 - eaveH;
        if (religion === 'hindu' && avail >= 5) {
          // a stepped, tapering tower over the shrine
          const sand = sand0, tiers = 5, hs0 = Math.min(ob.hu, ob.hv) * 0.75, shrink = 0.74;
          let tot = 0, hh0 = [1.8, 1.3, 1.3, 1.3, 1.3]; for (const q of hh0) tot += q; tot += hs0 * Math.pow(shrink, tiers) * 2.2;
          const sc = clamp(avail / tot, 0.5, 2.2);
          let hs = hs0, y = yE;
          for (let k = 0; k < tiers; k++) { const hh = hh0[k] * sc; boxTris(W, [ob.cx, ob.cz], ob.t, hs, hs, y - 0.02, y + hh, shade(sand, 1.25 - 0.03 * k), shade(sand, 1.3)); y += hh; hs *= shrink; }
          pyramid(W, [ob.cx, ob.cz], ob.t, hs, hs, y, hs * 2.2 * sc, lin(0xc9a46a)); stats.towers++;
        } else if (religion === 'sikh') {
          const wh = lin(weighted(D.white, gr.dome)), r = clamp(ob.hv * 0.8, 2.6, 8);
          boxTris(W, [ob.cx, ob.cz], ob.t, r, r, yE - 0.02, yE + 3.5, wh, wh);
          dome(W, [ob.cx, ob.cz], r * 0.95, yE + 3.5, wh, 12, 3); stats.domes++;
          for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
            const cc = [ob.cx + ob.t[0] * sa * (ob.hu - 1.5) + ob.s[0] * sb * (ob.hv - 1.5), ob.cz + ob.t[1] * sa * (ob.hu - 1.5) + ob.s[1] * sb * (ob.hv - 1.5)];
            boxTris(W, cc, ob.t, 0.45, 0.45, yE - 0.02, yE + 1.6, wh, wh);
            dome(W, cc, 0.9, yE + 1.6, wh, 8, 2); stats.domes++;
          }
        }
      }
    }
    stats.roofTris = W.tris;
    return W.tris;
  };
  void DARK_GLASS; void pick; void WALL;
  stats.religion = religion; stats.name = grp.name || '';
  { const d0 = F.xz(ob.hv, 0), d1 = F.xz(ob.hv, -1); stats.door = [d0[0], d0[1]]; stats.out = [d1[0] - d0[0], d1[1] - d0[1]]; } // (where the street end's door stands and which way it faces: for the capture tools)
  return { ok: true, keep: true, ring, kinds, cover, variant, material: 0, brickHex: wallHex, brick, glass: gr.glass, eaveH, form: stats.form, records: [], pushRoof, stats };
}
