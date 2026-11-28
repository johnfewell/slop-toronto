(function () {
// js/curb-smooth.js (jf-qw7, part 3; docs/rosedale-streetscape.md): smooth curb outlines for the Rosedale pilot's streets.
// A curb island's outline is the City's Edge of Roadway traced from a 1 m raster and simplified, so a bend in a road is a chain of straight
// pieces: on Chestnut Park, Roxborough and Crescent the median piece is 9.4 m long and the turn at each joint 15 degrees (p90 29 degrees),
// which reads at street level as a polyline, not the curve the road is. This puts a curve through the same points: a cubic Hermite piece
// between each pair of neighbours, its tangent at a point along the bisector of the two pieces that meet there, subdivided so no piece is over 3 m. Only pieces up to 28 m are smoothed.
// It passes through every original point (the curb never moves more than the sag of a gentle curve, 0.3 m at 15 degrees on 9 m), keeps the
// outline's corners (a turn of MAX_TURN degrees or more is a corner, not a bend, and keeps its sharp edge) and leaves straight pieces alone.
const C = (window.CITY = window.CITY || {});

const MAX_TURN = 50; // degrees: a bigger turn at a point is a corner of the outline and stays one
const STRAIGHT = 3; // degrees: a piece whose two ends turn by less than this on both sides is straight, and stays so
const PIECE = 3; // m: the longest piece of a smoothed curve
const MIN_EDGE = 2.5; // m: a shorter piece is left whole
const MAX_EDGE = 28; // m: a longer piece is a park's or a ravine's outline, a few points on a long edge, not a bend in a road: left as traced
const TENSION = 0.5; // the tangent's length as a share of the piece's: less than a full Hermite curve, so a curve through points 20 m apart sags by a few decimetres, not a metre

const deg = (rad) => (rad * 180) / Math.PI;

// pts: [{ x, z }] a closed outline without the first point repeated; returns a new array of the same kind (the input if there was nothing to smooth)
function smoothCurbRing(pts) {
  const n = pts.length;
  if (n < 4) return pts;
  const dir = []; // unit direction and length of the piece from point i to i + 1
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    dir.push(L > 1e-6 ? { x: dx / L, z: dz / L, L } : { x: 0, z: 0, L: 0 });
  }
  const turn = new Array(n), corner = new Array(n), tangent = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = dir[(i + n - 1) % n], q = dir[i];
    const c = p.x * q.x + p.z * q.z;
    turn[i] = p.L && q.L ? deg(Math.acos(Math.max(-1, Math.min(1, c)))) : 0;
    corner[i] = turn[i] >= MAX_TURN;
    const bx = p.x + q.x, bz = p.z + q.z, bl = Math.hypot(bx, bz);
    tangent[i] = bl > 1e-6 ? { x: bx / bl, z: bz / bl } : { x: q.x, z: q.z };
  }
  const out = [];
  let changed = false;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = pts[i], b = pts[j], d = dir[i];
    out.push(a);
    const bends = turn[i] >= STRAIGHT || turn[j] >= STRAIGHT;
    if (d.L < MIN_EDGE || d.L > MAX_EDGE || !bends || (corner[i] && corner[j])) continue;
    const k = Math.max(2, Math.min(8, Math.ceil(d.L / PIECE)));
    // at a corner the tangent is the piece's own direction, so the corner stays sharp and the curve leaves it straight
    const ta = corner[i] ? d : tangent[i], tb = corner[j] ? d : tangent[j];
    for (let s = 1; s < k; s++) {
      const t = s / k, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push({ x: h00 * a.x + h10 * d.L * TENSION * ta.x + h01 * b.x + h11 * d.L * TENSION * tb.x, z: h00 * a.z + h10 * d.L * TENSION * ta.z + h01 * b.z + h11 * d.L * TENSION * tb.z });
    }
    changed = true;
  }
  return changed ? out : pts;
}

// The Rosedale pilot's box (the zone of js/rosedale-zone.js: x 240 to 2380, z -4680 to -2900): the islands whose centre lies in it are smoothed
const SMOOTH_BOX = { x0: 240, x1: 2380, z0: -4680, z1: -2900 };
const inSmoothBox = (x, z) => x >= SMOOTH_BOX.x0 && x <= SMOOTH_BOX.x1 && z >= SMOOTH_BOX.z0 && z <= SMOOTH_BOX.z1;

Object.assign(C, { smoothCurbRing, inCurbSmoothBox: inSmoothBox, CURB_SMOOTH: { MAX_TURN, STRAIGHT, PIECE, MIN_EDGE, MAX_EDGE, TENSION, box: SMOOTH_BOX } });
})();
