// js/building-draw-tall.js — draws the apartment, tower, office and low-block presets (st-ndw9.20, docs/building-prototypes-spec.md
// section 3.5), behind ?massing=1&presets=draw and the ?gallery=presets page. Pure functions with no three.js and no DOM, called from
// planHouse (js/building-draw.js) for a preset whose DRAW entry (js/building-prototypes.js) has kind 'block'.
//
// A massing part keeps its outline and its wall kinds (the page's own entrance and storefront rule stays); what is drawn is
//   - its walls to a whole number of storeys (the style's own storey, so the window rows land on the wall), in the facade style the
//     preset names: the rendered material's styles or one of the merged curtain wall's (no material, mesh or draw call is added;
//     `material` in the returned plan tells the cell builder which, buildings.js);
//   - in the hipped roofs' batch (flat-coloured triangles, one mesh, always drawn, so they read from far away): a tar roof, a
//     parapet, a cornice, a mechanical penthouse or a stepped crown, and the balcony bands: one band per floor per long side
//     (a slab edge, its top, its underside and a rail, 8 triangles), never one box per balcony.
// Every random choice comes from the group's durable id (stream), so the parts of one group agree: one wall colour, one facade
// style, one balcony and roof treatment. A slab and a point tower are told apart by the group's main part's plan proportions.

import { WALL, stream, weighted, lerp, clamp, shade, writer, slab, tarRgb } from './building-draw-kit.js';
import { FACADE_VARIANTS, CURTAIN_VARIANTS, CURTAIN_FLOORS, FIRST_DRAW_VARIANT } from './building-prototypes.js';

// what the towers' near details leave out (st-ndw9.18; flags so a tool can count the roof with and without): the balcony slabs' tops below the top three
// floors, and the parapets' 0.22 m tops. A flag true means the trim is on (the top quads are left out)
export const TRIM = { balconyTops: true, parapetTops: true };
const CURTAIN_GLASS = [0x2a3744, 0x1e2326, 0x3d4245, ...CURTAIN_VARIANTS.map((v) => v.glassTint)];

export const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(a / 2); };
export const inRing = (ring, x, z) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

/** The smallest-area oriented rectangle round a ring: its centre, its long axis t and short axis s (unit, in x, z), half lengths hu >= hv, area, fill. */
export function obbOf(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 0.5) continue;
    const tx = dx / l, tz = dz / l;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of ring) {
      const u = (p[0] - a[0]) * tx + (p[1] - a[1]) * tz, v = -(p[0] - a[0]) * tz + (p[1] - a[1]) * tx;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) best = { A, a, tx, tz, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { a, tx, tz, u0, u1, v0, v1 } = best, sx = -tz, sz = tx;
  const cx = a[0] + tx * (u0 + u1) / 2 + sx * (v0 + v1) / 2, cz = a[1] + tz * (u0 + u1) / 2 + sz * (v0 + v1) / 2;
  const long = (u1 - u0) >= (v1 - v0);
  const T = long ? [tx, tz] : [sx, sz], S = long ? [sx, sz] : [-tx, -tz];
  const hu = Math.max(u1 - u0, v1 - v0) / 2, hv = Math.min(u1 - u0, v1 - v0) / 2;
  return { cx, cz, t: T, s: S, hu, hv, area: best.A, fill: ringArea(ring) / Math.max(1e-6, best.A) };
}

// a box standing at (cx, cz), axes t and s, half sizes hu and hv, from ya to yb: four walls and a top
export function boxTris(W, c, t, hu, hv, ya, yb, wallRgb, topRgb) {
  const s = [-t[1], t[0]];
  const P = (u, v, y) => [c[0] + t[0] * u + s[0] * v, y, c[1] + t[1] * u + s[1] * v];
  const a = P(-hu, -hv, ya), b = P(hu, -hv, ya), cc = P(hu, hv, ya), d = P(-hu, hv, ya);
  const a2 = P(-hu, -hv, yb), b2 = P(hu, -hv, yb), c2 = P(hu, hv, yb), d2 = P(-hu, hv, yb);
  W.quadFace(a, b, b2, a2, shade(wallRgb, 0.92), [-s[0], 0, -s[1]]);
  W.quadFace(b, cc, c2, b2, shade(wallRgb, 1.0), [t[0], 0, t[1]]);
  W.quadFace(cc, d, d2, c2, shade(wallRgb, 0.86), [s[0], 0, s[1]]);
  W.quadFace(d, a, a2, d2, shade(wallRgb, 0.95), [-t[0], 0, -t[1]]);
  W.quadFace(a2, b2, c2, d2, topRgb, [0, 1, 0]);
}

// a box that stands inside a ring: tries the wanted size, then smaller; null when none fits. (offU: along the long axis)
function placeBox(ring, ob, wantU, wantV, offU) {
  for (let k = 0; k < 4; k++) {
    const f = 1 - 0.22 * k, hu = wantU * f, hv = wantV * f, o = offU * f;
    const cx = ob.cx + ob.t[0] * o, cz = ob.cz + ob.t[1] * o;
    let ok = hu >= 1.2 && hv >= 1.2;
    for (const [du, dv] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (!ok) break;
      const x = cx + ob.t[0] * du * hu + ob.s[0] * dv * hv, z = cz + ob.t[1] * du * hu + ob.s[1] * dv * hv;
      if (!inRing(ring, x, z)) ok = false;
    }
    if (ok) return { c: [cx, cz], hu, hv };
  }
  return null;
}

// the balcony bands of one wall: a band per floor (a slab edge, its top and underside, and a rail), the whole length in `bands`
// mode, the left half and the right half on alternate floors in `stagger` mode; the ends stay 0.6 m clear of the corners
function balconyBands(W, e, o) {
  const t = [(e.bx - e.ax) / e.len, (e.bz - e.az) / e.len], n = [e.nx, e.nz], d = o.depth;
  const P = (u, out, y) => [e.ax + t[0] * u + n[0] * out, y, e.az + t[1] * u + n[1] * out];
  let count = 0;
  for (let k = 1; k < o.floors; k++) {
    let ua = 0.6, ub = e.len - 0.6;
    if (o.mode === 'stagger') { const half = (ub - ua) / 2; if ((k + o.phase) % 2) ub = ua + half - 0.2; else ua = ua + half + 0.2; }
    if (ub - ua < 2.4) continue;
    const y = o.y0 + k * o.floor;
    if (y < o.hidden) { o.skipped = (o.skipped || 0) + 1; continue; } // (st-ndw9.18: a floor under the neighbour's roof is inside the neighbour)
    W.quadFace(P(ua, d, y - 0.24), P(ub, d, y - 0.24), P(ub, d, y), P(ua, d, y), o.slabRgb, [n[0], 0, n[1]]);
    // the slab's top is seen only from above the floor and, behind its 1.05 m rail, only from over 37 degrees up: it is kept on the top floors, where the
    // roofline is seen from the air, and left out below (st-ndw9.18)
    if (!o.trimTops || k >= o.floors - o.topKeep) W.quadFace(P(ua, 0, y), P(ub, 0, y), P(ub, d, y), P(ua, d, y), shade(o.slabRgb, 1.05), [0, 1, 0]);
    W.quadFace(P(ua, 0, y - 0.24), P(ub, 0, y - 0.24), P(ub, d, y - 0.24), P(ua, d, y - 0.24), shade(o.slabRgb, 0.7), [0, -1, 0]);
    W.quadFace(P(ua, d - 0.04, y), P(ub, d - 0.04, y), P(ub, d - 0.04, y + 1.05), P(ua, d - 0.04, y + 1.05), o.railRgb, [n[0], 0, n[1]]);
    count++;
  }
  return count;
}

/**
 * Plans one massing part of an apartment, tower, office or low-block group. Input as planHouse's (preset, id, groupId, ring, edges,
 * covered, y0, roadDist, lin), plus `h` (the data's height of the part), `base` (the part's base above the ground: a tower on a
 * podium starts at the podium's top), `holes` (courtyards), and `group`: { n, area, maxH, mainAspect, mainLong, podium } the group's
 * facts (js/building-presets.js drawFactsFrom). Returns { ok: false, reason } (today's look) or { ok: true, keep: true, ring, kinds,
 * cover, variant, material (0 rendered, 2 curtain wall), brickHex, brick, glass, eaveH, form, records: [], pushRoof(A), stats }.
 */
export function planBlock(inp, D) {
  const { preset, id, ring, edges, y0 = 0, lin, h, base = 0, roadDist = () => Infinity } = inp;
  const gid = inp.groupId || id, grp = inp.group || {};
  const fail = (reason, detail) => ({ ok: false, reason, detail });
  if (!Number.isFinite(h) || h <= 0 || !edges || !edges.length) return fail('bad-height');
  const b0 = Math.max(0, Math.min(base, h - 0.5));
  if (h - b0 < 2.4) return fail('too-low');
  const area = ringArea(ring);
  if (area < 4) return fail('too-small');
  if (D.smallGroup && (grp.area ?? area) < D.smallGroup) return fail('house-sized'); // (lidar heights on a small footprint: probably a house)
  const ob = obbOf(ring);
  if (!ob) return fail('too-irregular');

  const g = stream(gid, `${preset}:group`), own = stream(id, `${preset}:own`);
  const gr = { v: g(), wall: g(), brick: g(), glass: g(), par: g(), cor: g(), corD: g(), corH: g(), pent: g(), pentW: g(), pentD: g(), pentH: g(), pentEnd: g(), balc: g(), bDepth: g(), bRail: g(), bSlab: g(), bPhase: g(), crown: g(), crownIn: g(), crownH: g(), podV: g() };
  const podiumGroup = !!grp.podium;
  const isPodium = !!D.podium && podiumGroup && b0 === 0;
  // slab against point: a group whose main part is long and thin (at least 2.2 : 1 and 28 m) is a slab; a tower on a podium never is
  let slabLike = !!D.slab;
  if (D.slabByPlan) slabLike = !podiumGroup && (grp.mainAspect ?? (ob.hu / ob.hv)) >= 2.2 && (grp.mainLong ?? ob.hu * 2) >= 28;
  const look = isPodium ? { ...D.podium, material: 'rendered' } : slabLike && D.slabLook ? D.slabLook : D;
  const rendered = isPodium || look.material === 'rendered';
  const vlist = look.variants, vi = vlist[Math.floor((isPodium ? gr.podV : gr.v) * vlist.length) % vlist.length];
  const variant = rendered ? FIRST_DRAW_VARIANT + vi : vi;
  const floor = rendered ? FACADE_VARIANTS[vi].floorHeight : CURTAIN_FLOORS[vi];
  const wallHex = weighted(look.wall, gr.wall);
  const brick = rendered && gr.brick < (look.brickShare ?? 0);
  const wallRgb = lin(wallHex);
  const trimRgb = lin(weighted(D.trim, (gr.wall * 7.1) % 1));
  let n = Math.max(1, Math.round((h - b0) / floor));
  if (look.storeys && look.storeys[1]) n = Math.min(n, look.storeys[1]);
  const eaveH = b0 + n * floor;

  // ---- wall kinds: the page's, and the clear ground floor of a glass office and the shops of a podium
  const kinds = edges.map((e) => e.kind);
  if (D.groundGlass || (isPodium && look.shops)) edges.forEach((e, i) => { if (e.street && e.len >= 5 && (kinds[i] === WALL.entry || kinds[i] === WALL.rear)) kinds[i] = WALL.shop; });
  const cover = edges.map((e, i) => (inp.covered && inp.covered.has(i) ? inp.covered.get(i) : NaN));
  const exposed = (i) => kinds[i] >= 0 && kinds[i] !== WALL.lotLine && !(cover[i] >= eaveH - 0.3);

  const main = (grp.maxH ?? h) <= h + 0.01 || h >= (grp.maxH ?? h) * 0.85; // (the group's top part: it carries the penthouse and the crown)
  const stats = { N: 1, form: isPodium ? 'podium' : slabLike ? 'slab' : 'point', storeys: n, balconyBands: 0, bandsHidden: 0, penthouses: 0, crowns: 0, parapets: 0, cornices: 0, roofTris: 0, gables: 0, dormers: 0, bays: 0, porches: 0, bargeboards: 0 };
  const tar = tarRgb(lin, gid, id, preset);

  const pushRoof = (A) => {
    const W = writer(A);
    const yT = y0 + eaveH;
    if (!inp.holes) slab(W, ring, yT - 0.015, tar); // (a building with a courtyard keeps the cell material's cap)
    // the parapet and the cornice round the roof's exposed edges (not on a tall tower: it would not be seen)
    const pr = look.parapet || D.parapet;
    if (pr && (n <= 12 || isPodium)) {
      const ph = lerp(gr.par, pr), t = 0.22, pr0 = shade(wallRgb, 0.94);
      edges.forEach((e, i) => {
        if (!exposed(i) || e.len < 2.5) return;
        const nx = e.nx, nz = e.nz;
        const a = [e.ax, e.az], b = [e.bx, e.bz];
        W.quadFace([a[0], yT, a[1]], [b[0], yT, b[1]], [b[0], yT + ph, b[1]], [a[0], yT + ph, a[1]], pr0, [nx, 0, nz]);
        // (the parapet's top is a 0.22 m strip: under a pixel beyond about 25 m, and from above it only closes what the front face already shows)
        if (!TRIM.parapetTops) W.quadFace([a[0], yT + ph, a[1]], [b[0], yT + ph, b[1]], [b[0] - nx * t, yT + ph, b[1] - nz * t], [a[0] - nx * t, yT + ph, a[1] - nz * t], shade(trimRgb, 0.96), [0, 1, 0]);
        stats.parapets++;
      });
    }
    const cn = look.cornice || (D.parts && D.parts.cornice && gr.cor < D.parts.cornice.p ? D.parts.cornice : null);
    if (cn) {
      const cd = lerp(gr.corD, cn.depth), ch = lerp(gr.corH, cn.height);
      edges.forEach((e, i) => {
        if (!exposed(i) || e.len < 3 || !e.street) return;
        const nx = e.nx, nz = e.nz, a = [e.ax, e.az], b = [e.bx, e.bz];
        const ao = [a[0] + nx * cd, a[1] + nz * cd], bo = [b[0] + nx * cd, b[1] + nz * cd];
        W.quadFace([ao[0], yT - ch, ao[1]], [bo[0], yT - ch, bo[1]], [bo[0], yT, bo[1]], [ao[0], yT, ao[1]], trimRgb, [nx, 0, nz]);
        W.quadFace([a[0], yT, a[1]], [b[0], yT, b[1]], [bo[0], yT, bo[1]], [ao[0], yT, ao[1]], shade(trimRgb, 1.05), [0, 1, 0]);
        W.quadFace([a[0], yT - ch, a[1]], [b[0], yT - ch, b[1]], [bo[0], yT - ch, bo[1]], [ao[0], yT - ch, ao[1]], shade(trimRgb, 0.7), [0, -1, 0]);
        stats.cornices++;
      });
    }
    // the mechanical penthouse (a slab tower's stands at one end) and the crown of a tall glass tower (a smaller storey stepped in, with a screen)
    const pe = D.parts && D.parts.penthouse;
    if (pe && gr.pent < pe.p && main && area >= 100 && n >= 3 && !isPodium) {
      const wu = ob.hu * lerp(gr.pentW, pe.size), wv = ob.hv * lerp(gr.pentD, pe.size) + 0.8, ph = lerp(gr.pentH, pe.height);
      const off = pe.end ? (gr.pentEnd < 0.5 ? -1 : 1) * Math.max(0, ob.hu - wu - 3) : 0;
      const spot = placeBox(ring, ob, clamp(wu, 1.8, 9), clamp(wv, 1.8, 7), off);
      if (spot) { boxTris(W, spot.c, ob.t, spot.hu, spot.hv, yT - 0.02, yT + ph, [0.5, 0.5, 0.49], shade(tar, 0.85)); stats.penthouses++; }
    }
    const cw = D.parts && D.parts.crown;
    if (cw && gr.crown < cw.p && main && area >= 150 && n >= 10 && !isPodium) {
      const f = lerp(gr.crownIn, cw.inset), ch = lerp(gr.crownH, cw.height);
      const spot = placeBox(ring, ob, ob.hu * (1 - 2 * f), ob.hv * (1 - 2 * f), 0);
      if (spot) {
        const crownRgb = D.crownDark || !rendered ? shade(lin(CURTAIN_GLASS[vi] ?? 0x2a3744), 1.5) : shade(wallRgb, 0.9);
        boxTris(W, spot.c, ob.t, spot.hu, spot.hv, yT - 0.02, yT + ch, crownRgb, shade(tar, 0.8));
        stats.crowns++;
      }
    }
    // the balcony bands
    const bc = D.parts && D.parts.balcony;
    if (bc && gr.balc < bc.p && n >= 3 && area >= 90 && !isPodium) {
      const depth = lerp(gr.bDepth, bc.depth);
      const slabRgb = lin(weighted([[0xc4c0b6, 3], [0xd8d4c8, 3], [0xb0aca2, 2], [0xe4e0d4, 1]], gr.bSlab));
      const railRgb = bc.railing === 'glass' || gr.bRail < 0.4 ? lin(0x2f4a58) : gr.bRail < 0.7 ? lin(0xe4e2dc) : lin(0x33383b);
      const cands = [];
      edges.forEach((e, i) => {
        e = Object.assign(Object.create(e), { cv: Number.isFinite(cover[i]) ? cover[i] : 0 }); // (the neighbour's roof height on this edge)
        if (!exposed(i) || e.len < bc.minLen) return;
        if (bc.long && Math.abs((e.bx - e.ax) / e.len * ob.t[0] + (e.bz - e.az) / e.len * ob.t[1]) < Math.cos(25 * Math.PI / 180)) return;
        const mx = (e.ax + e.bx) / 2 + e.nx * (depth + 0.5), mz = (e.az + e.bz) / 2 + e.nz * (depth + 0.5);
        if (roadDist(mx, mz) < 5) return;
        cands.push(e);
      });
      cands.sort((p, q) => q.len - p.len);
      for (const e of cands.slice(0, bc.long ? 2 : 3)) {
        const bo = { depth, floors: n, floor, y0: y0 + b0, mode: bc.mode, phase: Math.floor(gr.bPhase * 2) + (e.len | 0), slabRgb, railRgb, hidden: y0 + e.cv - 0.2, trimTops: TRIM.balconyTops, topKeep: 3 };
        stats.balconyBands += balconyBands(W, e, bo); stats.bandsHidden += bo.skipped || 0;
      }
    }
    stats.roofTris = W.tris;
    return W.tris;
  };
  void own;
  return {
    ok: true, keep: true, ring, kinds, cover, variant, material: rendered ? 0 : 2, brickHex: rendered ? wallHex : null, brick, glass: gr.glass, eaveH,
    form: stats.form, records: [], pushRoof, stats
  };
}
