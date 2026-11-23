// js/pedestrian-crowd.js (st-iqsg)
// People who do not walk through each other, and who wait for the light as a loose group, not a file.
//
// The walkers in traffic.js each follow a straight track (a sidewalk line, a crosswalk line) at `t` metres along it, with a
// sideways offset off that track. Before this, the only things that moved a walker off its track were a vehicle bearing
// down on it (p.dodge) and a queue at a curb that stood one behind another on the same line. Everything here is pure
// arithmetic on those fields, so it can be tested without the game:
//   - a spatial hash of the walkers placed near the camera (a fixed table of chain heads, no allocation per frame),
//   - steer(): for one walker, look at the people around it and answer with a sideways shift (`sepTarget`, eased in by
//     easeSep), a stopping distance (`crowdRoom`, along its way) and, rarely, "turn round" or "ignore them for a while"
//   - pickSpot(): where one more person waiting at a curb stands, clear of the ones already there.
// Rules of the road for two people on a collision course: facing each other, each steps to their own right (when they
// are almost dead on) or away from the other (when already offset), by only as much as is needed; one behind another,
// the follower slows; at an angle, the lower id has the right of way; a person standing still (waiting, talking, resting,
// held up) is walked round, by the side with room. If a side step is not possible (the sidewalk is full, a wall), the
// walker stops short; after a couple of seconds the lower id of two people facing each other turns back, and anyone
// held up for longer than that ignores the people in the way for a few seconds, so nobody is ever stuck.
(function () {
  const TUNE = {
    CELL: 3, // m, the hash cell (a walker looks at the 3 x 3 cells around it: everyone within 3 m)
    TABLE: 4096, // chain heads
    LOOK: 3.2, // m ahead that a person looks for someone coming
    BEHIND: 0.5, // m behind that still counts as alongside
    BODY: 0.55, // m, centre to centre, at which one walker stops short of another
    PASS: 0.85, // m, centre to centre, that two people going past each other keep
    PASS_STATIC: 0.8, // m, the room given to someone standing still
    SHIFT: 0.43, // m, the step to the right of two walkers dead on
    SEP_MAX: 0.75, // m, the most a walker steps off its line
    SEP_RATE: 0.9, // m/s, how fast it steps
    SEP_RATE_WAIT: 0.5, // m/s, shuffling into a place at a curb
    HOLD: 0.9, // s, a side step is held at least this long, so nobody shuffles back and forth
    TURN_AFTER: 2.0, // s held up before the lower id of two facing each other turns back
    GHOST_AFTER: 1.8, // s held up by someone standing still before walking on through them
    GHOST_AFTER_MOVING: 4.0, // (...by anyone else)
    GHOST_FOR: 3.5, // s of ignoring people after that
    SPOT_MIN_DEPTH: 0.3, // m, the front places are at least this far back from the curb stop
    SPOT_DEPTH: 1.5, // m, ...and at most this far back
    SPOT_GAP: 0.85, // m, ...most keep up to this far from the nearest (when there is room), a few as close as SPOT_GAP_MIN
    SPOT_GAP_MIN: 0.52,
    FACE: 0.44, // rad (25 degrees), most of the people waiting face the far side within this
    OVERLAP: 0.4 // m, the debug counter's "bodies overlap"
  };

  // ---- the hash --------------------------------------------------------------------------------------------------
  function createGrid(capacity) {
    const g = {
      head: new Int32Array(TUNE.TABLE).fill(-1),
      next: new Int32Array(capacity),
      stamp: new Int32Array(TUNE.TABLE),
      frame: 1,
      count: 0,
      slot: (ix, iz) => (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & (TUNE.TABLE - 1),
      begin() { this.frame++; this.count = 0; },
      add(i, x, z) {
        const s = this.slot(Math.floor(x / TUNE.CELL), Math.floor(z / TUNE.CELL));
        this.next[i] = this.stamp[s] === this.frame ? this.head[s] : -1;
        this.head[s] = i;
        this.stamp[s] = this.frame;
        this.count++;
      },
      // the first walker in the cell (-1: none); then next[j] while it is not -1 ... but the chain of an old frame is dead
      first(ix, iz) {
        const s = this.slot(ix, iz);
        return this.stamp[s] === this.frame ? this.head[s] : -1;
      }
    };
    return g;
  }

  // ---- steering --------------------------------------------------------------------------------------------------
  const S = { need: 0, side: 0, near: false, room: Infinity, blocker: null, alt: false, hx: 0, hz: 0, wx: 0, wz: 0, rightW: 1 };
  // stopped for any reason (walked round), and parked: standing there on purpose
  const isParked = (q) => !!(q.waiting || q.conversation || q.pause > 1);
  const isStatic = (q) => isParked(q) || q.v < 0.12;

  function consider(p, q) {
    if (q.knock || q.placed === false) return;
    const dx = q.x - p.x, dz = q.z - p.z;
    const f = dx * S.hx + dz * S.hz, l = dx * S.wx + dz * S.wz;
    const al = Math.abs(l);
    if (f > TUNE.LOOK || f < -TUNE.BEHIND || al > 1.3) return;
    const d2 = dx * dx + dz * dz;
    const away = al > 0.12 ? (l > 0 ? -1 : 1) : S.rightW;
    // bodies already touching: apart, whatever the rules say
    if (d2 < 0.45 * 0.45) {
      const n = 0.55 - al;
      if (n > S.need) { S.need = n; S.side = away; S.alt = al <= 0.12; }
    }
    if (isStatic(q)) {
      if (al < TUNE.PASS_STATIC) {
        const n = TUNE.PASS_STATIC - al;
        if (n > S.need) { S.need = n; S.side = away; S.alt = al <= 0.12; }
        S.near = true;
      }
      if (al < 0.55 && f > 0 && f - TUNE.BODY < S.room) { S.room = f - TUNE.BODY; S.blocker = q; }
      return;
    }
    const dot = S.hx * q.ux * q.dir + S.hz * q.uz * q.dir;
    if (dot < -0.4) { // coming towards me
      if (f < -0.3) return;
      if (al < TUNE.PASS + 0.35) S.near = true;
      if (al < TUNE.PASS) {
        const n = al <= 0.15 ? TUNE.SHIFT : (TUNE.PASS - al) * 0.6 + 0.04;
        if (n > S.need) { S.need = n; S.side = away; S.alt = al <= 0.15; }
      }
      if (al < 0.55 && f > 0 && f - TUNE.BODY < S.room) { S.room = f - TUNE.BODY; S.blocker = q; }
    } else if (dot > 0.4) { // going my way
      if (f <= 0) return;
      if (al < 0.6 && f - TUNE.BODY < S.room) { S.room = f - TUNE.BODY; S.blocker = q; }
      if (al < 0.5 && f < 1.2) {
        const n = 0.6 - al;
        if (n > S.need) { S.need = n; S.side = away; S.alt = false; }
      }
    } else if (q.id < p.id && f > 0 && al < 0.7) { // across my way: the lower id goes first
      if (f - TUNE.BODY < S.room) { S.room = f - TUNE.BODY; S.blocker = q; }
    }
  }

  // One walker. p: { id, x, z, ux, uz, dir, v, waiting, conversation, pause, knock, placed, sep, sepTarget, sepHold,
  //   sepHome, sepLock, blockedFor, ghostUntil, crowdRoom, crowdTurn }
  // ctx: { now, dt, canSide(p, sep) -> bool, canTurn(p) -> bool, extra: a person-like object or null (the player) }
  // Writes p.sepTarget, p.crowdRoom, p.crowdTurn, p.blockedFor, p.ghostUntil.
  function steer(p, i, peds, grid, ctx) {
    p.crowdRoom = Infinity;
    const now = ctx.now;
    if (p.waiting || p.conversation || p.pause > 0) { relax(p, now); return; }
    if (now < p.ghostUntil) { relax(p, now); return; }
    S.need = 0; S.side = 0; S.near = false; S.room = Infinity; S.blocker = null; S.alt = false;
    S.hx = p.ux * p.dir; S.hz = p.uz * p.dir; S.wx = p.uz; S.wz = -p.ux; S.rightW = -p.dir;
    const cx = Math.floor(p.x / TUNE.CELL), cz = Math.floor(p.z / TUNE.CELL);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        for (let j = grid.first(cx + ox, cz + oz); j >= 0; j = grid.next[j]) if (j !== i) consider(p, peds[j]);
      }
    }
    if (ctx.extra) consider(p, ctx.extra);
    let room = S.room;
    if (S.need > 0.02 && !p.sepLock) {
      const hi = TUNE.SEP_MAX, lo = Math.min(-hi, p.sepHome - 0.6), up = Math.max(hi, p.sepHome + 0.6);
      let ok = false, tgt = 0;
      const tries = S.alt ? 3 : 2;
      for (let k = 0; k < tries && !ok; k++) {
        const side = k === 2 ? -S.side : S.side;
        const amount = k === 1 ? S.need * 0.5 : S.need;
        tgt = Math.max(lo, Math.min(up, p.sep + side * amount));
        ok = Math.abs(tgt - p.sep) > 0.01 && ctx.canSide(p, tgt);
      }
      if (ok) { p.sepTarget = tgt; p.sepHold = now + TUNE.HOLD; }
      else if (S.near && S.blocker) room = Math.min(room, Math.max(0, S.room));
    } else if (S.near) p.sepHold = Math.max(p.sepHold, now + 0.5);
    else if (now >= p.sepHold) p.sepTarget = p.sepHome;
    // held up
    if (room < 0.9 && p.v < 0.2 && S.blocker) {
      p.blockedFor += ctx.dt;
      const b = S.blocker;
      const facing = !isParked(b) && (p.ux * p.dir * b.ux * b.dir + p.uz * p.dir * b.uz * b.dir) < -0.4;
      if (facing && p.id < b.id && p.blockedFor > TUNE.TURN_AFTER && ctx.canTurn(p)) { p.crowdTurn = true; p.blockedFor = 0; }
      else if (b.waiting) p.blockedFor = Math.min(p.blockedFor, TUNE.GHOST_AFTER); // (held up behind people waiting at a curb: stand behind them, they go when the WALK comes)
      else if (p.blockedFor > (isParked(b) ? TUNE.GHOST_AFTER : TUNE.GHOST_AFTER_MOVING)) {
        p.ghostUntil = now + TUNE.GHOST_FOR;
        p.blockedFor = 0;
        room = Infinity;
        ctx.stats.ghosted++;
      }
    } else if (p.blockedFor > 0) p.blockedFor = Math.max(0, p.blockedFor - ctx.dt * 2);
    p.crowdRoom = room > 0 ? room : 0;
  }

  function relax(p, now) {
    if (now >= p.sepHold) p.sepTarget = p.sepHome;
    p.blockedFor = 0;
  }

  // Ease a walker's sideways step towards its target (m/s), without overshooting
  function easeSep(p, dt, rate) {
    const step = rate * dt, d = p.sepTarget - p.sep;
    p.sep += d > step ? step : d < -step ? -step : d;
  }

  // ---- a place at the curb -----------------------------------------------------------------------------------------
  // The group waiting at a corner is a scatter of standing places over the sidewalk behind the crosswalk's curb edge: its
  // width plus a metre each side, up to ~1.5 m back (what the crosswalk's own track reaches), denser at the curb and thinning
  // behind, found by dart throwing (a random candidate is kept when it is SPOT_GAP clear of every place taken, so the
  // spacing is irregular and has gaps). The random numbers are seeded per person and corner: the same people at the same
  // corner choose the same places.
  // base: { x, z } the track point at the curb stop, hx, hz (unit, the way they face: towards the road), wx, wz (unit,
  //   the track's +sideways), dir (the walker's direction along its track, for the facing), cs (the crossing's centre,
  //   as a sideways step from the walker's own line; 0 if unknown), hw (half the width of the area, m), maxDepth.
  // priorX/priorZ: the places taken (world m), n of them. ra, rb: numbers in 0..1 that seed the choice.
  // ok(x, z): can a person stand there. out: { sep, depth, x, z, face, found, gap }.
  let rs = 1;
  const rnd = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
  function pickSpot(base, priorX, priorZ, n, ra, rb, rc, out, ok = null) {
    rs = (((Math.floor(ra * 65535) << 16) ^ Math.floor(rb * 65535) ^ Math.floor(rc * 255)) >>> 0) || 1;
    for (let k = 0; k < 4; k++) rnd();
    const cs = base.cs ?? 0, hwA = base.hw ?? 0.9;
    const maxDepth = Math.min(base.maxDepth ?? Infinity, TUNE.SPOT_DEPTH);
    const dmin = Math.min(TUNE.SPOT_MIN_DEPTH, maxDepth);
    let bestGap = -2, bestSep = 0, bestDepth = 0, bestX = 0, bestZ = 0, fbSep = 0, fbDepth = 0;
    for (let c = 0; c < 48; c++) {
      const g = (rnd() + rnd() + rnd() - 1.5) / 1.5;
      let sep = (rnd() < 0.5 ? 0 : cs) + g * hwA * 0.9; // (about where it arrived, or about the middle of the crossing)
      sep = Math.max(cs - hwA, Math.min(cs + hwA, sep));
      const depth = dmin + (maxDepth - dmin) * Math.pow(rnd(), 1.7); // (more of them near the curb)
      const x = base.x + base.wx * sep - base.hx * depth, z = base.z + base.wz * sep - base.hz * depth;
      if (c === 0) { fbSep = sep; fbDepth = depth; }
      if (ok && !ok(x, z)) continue;
      let gap = Infinity;
      for (let k = 0; k < n; k++) {
        const d = Math.hypot(x - priorX[k], z - priorZ[k]);
        if (d < gap) gap = d;
      }
      if (gap > bestGap) { bestGap = gap; bestSep = sep; bestDepth = depth; bestX = x; bestZ = z; }
      if (gap >= TUNE.SPOT_GAP_MIN + rnd() * (TUNE.SPOT_GAP - TUNE.SPOT_GAP_MIN)) break; // (some stand close, some keep their distance)
    }
    out.found = bestGap > -2;
    if (!out.found) { // (nowhere to stand was found: a scattered place anyway, never the shared point)
      bestSep = fbSep; bestDepth = fbDepth;
      bestX = base.x + base.wx * bestSep - base.hx * bestDepth; bestZ = base.z + base.wz * bestSep - base.hz * bestDepth;
    }
    out.gap = bestGap;
    out.sep = bestSep; out.depth = bestDepth; out.x = bestX; out.z = bestZ;
    // facing, off the way over the road: mostly towards the far side (+-25 degrees), some towards a neighbour, a few down the street
    const rf = rnd(), dir = base.dir ?? 1;
    let face = (rnd() - 0.5) * 2 * TUNE.FACE;
    if (rf < 0.14 && n > 0) {
      let nearest = -1, nd = Infinity;
      for (let k = 0; k < n; k++) { const d = Math.hypot(bestX - priorX[k], bestZ - priorZ[k]); if (d < nd) { nd = d; nearest = k; } }
      const dx = priorX[nearest] - bestX, dz = priorZ[nearest] - bestZ;
      face = Math.max(-1.2, Math.min(1.2, Math.atan2((dx * base.wx + dz * base.wz) * dir, dx * base.hx + dz * base.hz)));
    } else if (rf < 0.22) face = (rnd() < 0.5 ? -1 : 1) * (1.0 + rnd() * 0.3);
    out.face = face;
    return out;
  }

  const api = { TUNE, createGrid, steer, easeSep, pickSpot, isStatic };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.CITY = window.CITY || {}; window.CITY.pedCrowd = api; }
})();
