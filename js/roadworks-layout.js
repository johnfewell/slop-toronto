(function () {
// js/roadworks-layout.js
// The City of Toronto's Road Restrictions (worker/roadworks.js: the compact records /live/roadworks serves) laid out on the
// city's roads: which records are in effect on the scene's day, and where each one's barrels, cones, barriers, barricades
// and signs stand. Pure functions: tests/roadworks.test.mjs runs them on real records against the real road network;
// js/roadworks.js draws what they place.
//
// The records have no lane geometry: a centre-line polyline of the stretch, its dates, a daily schedule and a description,
// submitted by the permit applicant and not field verified. So the layout is a rule, not a survey:
// - CONSTRUCTION: the kerb lane on one side of the road is closed: a line of barrels along its inner edge down the stretch
//   (a gap of at most BARREL_STEP m), a taper of cones across the lane at each end and a "ROAD WORK" / "LANE CLOSED" sign
//   ahead of it; a work zone on an arterial gets an arrow board too. The side is the one the record's own points lie on
//   where they are off the centre line, else a fixed hash of its id (the feed does not say).
// - ROAD_CLOSED: a row of barricades (jersey barriers across an arterial) across the whole roadway, kerb to kerb, at each
//   end of the stretch (one end when it is short), a "ROAD CLOSED" sign on the row and cones in front. ONE_DIRECTION on a
//   two-way street closes the half on the hash's side.
// Everything stands on the roadway (blockAt: no curb island), never in a junction, on a crossing, on a streetcar track,
// on a parked car or inside another solid thing. A record's name must match the road it is snapped to.

const BARREL_STEP = 8; // m between barrels down a closed lane
const TAPER_LEN = 9; // m, the cones' diagonal across the lane at an end
const MIN_ZONE = 8; // m, a stretch shorter than this is drawn as this long, about its middle
const ZONE_CAP = 130; // m: a longer stretch has a work zone at each end (ZONE_END m long) and nothing between
const ZONE_END = 60;
const MAX_HALF_WIDTH = 11; // m: a kerb farther than this from the centre line is not a street's (a plaza, a junction)
const MIN_GAP = 0.7; // m between two placed things

// ---------------------------------------------------------------------------------------------------------------------
// Dates: the records' start & end are epoch ms; a day is Toronto's
// ---------------------------------------------------------------------------------------------------------------------
const TZ = 'America/Toronto';
function tzOffsetMin(ms) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName');
  const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(part ? part.value : '');
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}
/** Toronto's calendar day of an instant: { year, month, day } */
function torontoDayOf(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
}
const startOfDay = (y, m, d) => { const noon = Date.UTC(y, m - 1, d, 12); return Date.UTC(y, m - 1, d) - tzOffsetMin(noon) * 60000 + 0; };
/** The Toronto day { year, month, day } as { from, to (ms, to exclusive), dow (0 = Sunday) } */
function dayRange({ year, month, day }) {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { from: startOfDay(year, month, day), to: startOfDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()), dow: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}
/** Is the record in effect on the day: the City's dates span it, and its schedule has work that weekday (no schedule: any) */
function activeOn(rec, range) {
  if (!(rec.s < range.to && rec.e >= range.from)) return false;
  return !rec.sc || rec.sc[range.dow] !== '';
}
/** The scene's day: the day the city opened on (seasons.js SITE_DATE) when that is a real day (live, ?liveDate=, ?liveClock=);
 *  the presets' stand-in summer day is not one, so a preset opens on today's road works */
function sceneDay(siteDate, now = Date.now()) {
  const today = torontoDayOf(now);
  if (!siteDate || siteDate.source === 'preset' || !Number.isInteger(siteDate.month) || !Number.isInteger(siteDate.day)) return { ...today, source: 'today' };
  return { year: Number.isInteger(siteDate.year) ? siteDate.year : today.year, month: siteDate.month, day: siteDate.day, source: siteDate.source };
}

// ---------------------------------------------------------------------------------------------------------------------
// Names: the City's "Yonge St" and OSM's "Yonge Street" are one road
// ---------------------------------------------------------------------------------------------------------------------
const FULL = { st: 'street', ave: 'avenue', av: 'avenue', rd: 'road', blvd: 'boulevard', dr: 'drive', cres: 'crescent', ct: 'court', pl: 'place', pkwy: 'parkway',
  hwy: 'highway', ter: 'terrace', terr: 'terrace', ln: 'lane', cir: 'circle', sq: 'square', gdns: 'gardens', trl: 'trail', expy: 'expressway', blv: 'boulevard', cl: 'close', gt: 'gate', hts: 'heights', cr: 'crescent', rdwy: 'roadway' };
const DIRECTION = new Set(['north', 'south', 'east', 'west', 'n', 's', 'e', 'w']);
/** A road name as its tokens without the compass word, abbreviations spelled out ("St Clair Ave W" -> saint clair avenue) */
function nameKey(name) {
  const t = String(name || '').toLowerCase().replace(/[.,']/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (t[0] === 'st' && t.length > 2) t[0] = 'saint';
  return t.map((w) => FULL[w] || w).filter((w) => !DIRECTION.has(w)).join(' ');
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------------------------------
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; };
function polyLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); return L; }
/** The point `s` m along a polyline (clamped), and its direction there */
function along(pts, s) {
  let rest = Math.max(0, s);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.z - a.z);
    if (rest <= l || i === pts.length - 1) {
      const u = l > 1e-9 ? Math.min(1, rest / l) : 0;
      return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, dx: l > 1e-9 ? (b.x - a.x) / l : 1, dz: l > 1e-9 ? (b.z - a.z) / l : 0 };
    }
    rest -= l;
  }
  return { x: pts[0].x, z: pts[0].z, dx: 1, dz: 0 };
}
function cellGrid(points, cell = 32) {
  const m = new Map();
  for (const p of points) { const k = Math.floor(p.x / cell) * 100003 + Math.floor(p.z / cell); (m.get(k) || m.set(k, []).get(k)).push(p); }
  return { near(x, z, r) {
    for (let a = Math.floor((x - r) / cell); a <= Math.floor((x + r) / cell); a++) for (let b = Math.floor((z - r) / cell); b <= Math.floor((z + r) / cell); b++)
      for (const p of m.get(a * 100003 + b) || []) if (Math.hypot(p.x - x, p.z - z) < (p.r || 0) + r) return true;
    return false;
  } };
}

// The kinds a site can be (js/roadworks.js builds one instanced mesh for each)
const KINDS = ['cone', 'barrel', 'barrier', 'barricade', 'signClosed', 'signWork', 'signLane', 'arrow'];

/**
 * Lays the active records out. `deps`:
 *   toWorld(lat, lon) -> { x, z }; inFrame(x, z); nearestRoads; blockAt; isOnLand
 *   blocked(x, z, r) -> true where something solid stands (buildings, furniture); parkedAt(x, z, pad)
 *   tramNear(x, z, r); crossings: [{ x, z, len }] (pedestrian crossings); sites of nothing else
 * Returns { sites: [{ kind, x, z, yaw, rec (index into `records`), w? (a barricade's or barrier's width) }], plans: per
 * record { rec, placed, kind }, rejected: { reason: count }, counts }
 */
function roadworksSites(records, deps, { day = null, now = Date.now(), siteDate = null } = {}) {
  const dayInfo = day || sceneDay(siteDate, now);
  const range = dayRange(dayInfo);
  const counts = { records: records.length, inFrame: 0, active: 0, placed: 0, placedClosed: 0, placedLane: 0, notActive: 0 };
  const rejected = {};
  const rej = (why) => { rejected[why] = (rejected[why] || 0) + 1; };
  const sites = [], plans = [];
  const crossGrid = cellGrid((deps.crossings || []).map((c) => ({ x: c.x, z: c.z, r: Math.min(10, (c.len || 8) / 2) })));
  const placedGrid = new Map();
  const taken = (x, z) => {
    for (let a = Math.floor((x - MIN_GAP) / 4); a <= Math.floor((x + MIN_GAP) / 4); a++) for (let b = Math.floor((z - MIN_GAP) / 4); b <= Math.floor((z + MIN_GAP) / 4); b++)
      for (const s of placedGrid.get(a * 100003 + b) || []) if (Math.hypot(s.x - x, s.z - z) < MIN_GAP) return true;
    return false;
  };
  const add = (s) => { sites.push(s); const k = Math.floor(s.x / 4) * 100003 + Math.floor(s.z / 4); (placedGrid.get(k) || placedGrid.set(k, []).get(k)).push(s); };

  records.forEach((rec, index) => {
    const pts = rec.ll.map(([lat, lon]) => deps.toWorld(lat, lon));
    if (!pts.some((p) => deps.inFrame(p.x, p.z))) return;
    counts.inFrame++;
    if (!activeOn(rec, range)) { counts.notActive++; return; }
    counts.active++;
    const plan = placeRecord(rec, index, pts);
    plans.push(plan);
    if (plan.placed) { counts.placed++; if (rec.t === 'R') counts.placedClosed++; else counts.placedLane++; }
    else rej(plan.why);
    for (const [why, n] of Object.entries(plan.items || {})) rejected['item:' + why] = (rejected['item:' + why] || 0) + n;
  });
  return { sites, plans, rejected, counts, day: dayInfo };

  function placeRecord(rec, index, pts) {
    const key = nameKey(rec.r);
    const L = polyLength(pts);
    const mid = along(pts, L / 2);
    if (!key) return { rec: index, placed: false, why: 'no-road-name' };
    const match = (x, z, r = 30) => deps.nearestRoads(x, z, r).find((n) => nameKey(n.road.name) === key);
    let anchor = match(mid.x, mid.z) || match(pts[0].x, pts[0].z) || match(pts[pts.length - 1].x, pts[pts.length - 1].z);
    if (!anchor) return { rec: index, placed: false, why: 'no-road-match' };
    const road = anchor.road;
    if (road.raised) return { rec: index, placed: false, why: 'elevated-road' };
    if (road.highway) return { rec: index, placed: false, why: 'expressway' };
    const rejectedItems = {};
    const bad = (why) => { rejectedItems[why] = (rejectedItems[why] || 0) + 1; };

    // the road at a point near the stretch: the centre line's nearest point & its direction, turned the way the stretch runs
    const dirX = pts[pts.length - 1].x - pts[0].x, dirZ = pts[pts.length - 1].z - pts[0].z;
    const snap = (x, z, flip = 1) => {
      const n = match(x, z, 25);
      if (!n || n.road !== road && n.road.name !== road.name) return null;
      let dx = n.dx, dz = n.dz;
      const ref = Math.hypot(dirX, dirZ) > 3 ? dx * dirX + dz * dirZ : dx * mid.dx + dz * mid.dz;
      if (ref < 0) { dx = -dx; dz = -dz; }
      return { px: n.px, pz: n.pz, dx: dx * flip, dz: dz * flip };
    };
    // the kerbs either side of a centre-line point: the distances to the first curb island along the right normal (+) and
    // the left (-); null where there is none (a junction's mouth, a plaza)
    const curbs = (s) => {
      if (deps.blockAt(s.px, s.pz)) return null;
      const nx = -s.dz, nz = s.dx, out = [];
      for (const sign of [1, -1]) {
        let d = 0, hit = null;
        for (d = 0.5; d <= MAX_HALF_WIDTH + 2; d += 0.5) if (deps.blockAt(s.px + nx * sign * d, s.pz + nz * sign * d) || !deps.isOnLand(s.px + nx * sign * d, s.pz + nz * sign * d, 0)) { hit = d - 0.25; break; }
        if (hit === null || hit > MAX_HALF_WIDTH) return null;
        out.push(hit);
      }
      return { right: out[0], left: out[1], nx, nz };
    };
    const standable = (x, z, r, kind) => {
      if (!deps.inFrame(x, z)) { bad('outside-frame'); return false; }
      if (deps.blockAt(x, z)) { bad('not-roadway'); return false; }
      if (!deps.isOnLand(x, z, 0)) { bad('water'); return false; }
      if (crossGrid.near(x, z, 1.5)) { bad('crossing'); return false; }
      if (deps.tramNear && deps.tramNear(x, z, kind === 'cone' ? 2.4 : 3.2)) { bad('streetcar-track'); return false; }
      for (const o of deps.nearestRoads(x, z, 22)) {
        if (o.road.name === road.name || o.road.raised || o.road.cls === 'service') continue;
        if (o.dist < (o.road.w || 7) / 2 + 1.5) { bad('junction'); return false; }
      }
      if (deps.parkedAt && deps.parkedAt(x, z, 0.5)) { bad('parked-car'); return false; }
      if (deps.blocked && deps.blocked(x, z, r)) { bad('obstruction'); return false; }
      if (taken(x, z)) { bad('overlap'); return false; }
      return true;
    };
    // zones: where along the stretch the things stand
    const zones = L <= ZONE_CAP ? [[Math.max(0, L / 2 - Math.max(L, MIN_ZONE) / 2), L / 2 + Math.max(L, MIN_ZONE) / 2]] : [[0, ZONE_END], [L - ZONE_END, L]];
    const placedBefore = sites.length;
    const rand = hash(String(rec.i));
    // the side the record's own points favour
    let side = rand < 0.5 ? 1 : -1;
    const m0 = snap(mid.x, mid.z);
    if (m0) {
      const off = (mid.x - m0.px) * -m0.dz + (mid.z - m0.pz) * m0.dx; // + : to the right of the road's way
      if (Math.abs(off) > 1.2 && L > 0) side = off > 0 ? 1 : -1;
    }
    const arterial = /Arterial|Expressway/.test(rec.k || '');
    const closed = rec.t === 'R';
    let hasSign = false, allFull = true;

    const emit = (kind, x, z, yaw, extra = {}) => { add({ kind, x, z, yaw, rec: index, ...extra }); };
    const clearSpot = (x, z, r, kind) => standable(x, z, r, kind);

    for (const [z0, z1] of zones) {
      const ends = [{ s: z0, out: -1 }, { s: z1, out: 1 }];
      if (!closed) {
        // CONSTRUCTION: barrels down the closed kerb lane, a taper & a sign at each end
        for (let s = z0; s <= z1 + 0.01; s += Math.max(BARREL_STEP, (z1 - z0) / 12)) {
          const q = along(pts, s), r = snap(q.x, q.z), c = r && curbs(r);
          if (!r) { bad('off-road'); continue; }
          if (!c) { bad('no-kerb'); continue; }
          const curb = side > 0 ? c.right : c.left, width = c.right + c.left;
          const lanes = Math.max(1, Math.round(width / 3.4)), lane = Math.min(3.6, Math.max(2.5, width / lanes));
          const lat = side * Math.max(0.6, curb - lane + 0.4);
          const x = r.px + c.nx * lat, z = r.pz + c.nz * lat;
          if (clearSpot(x, z, 0.35, 'barrel')) emit('barrel', x, z, hash(x + ':' + z) * 6.28, { side, fx: r.dx, fz: r.dz });
        }
        for (const e of ends) {
          const q = along(pts, e.s), r0 = snap(q.x, q.z);
          if (!r0) continue;
          // the taper: cones from the lane's inner edge, back along the road to the kerb, outwards of the stretch
          for (let k = 0; k <= 3; k++) {
            const back = 1.2 + (TAPER_LEN * k) / 3;
            const px = r0.px + r0.dx * e.out * back, pz = r0.pz + r0.dz * e.out * back;
            const r = snap(px, pz), c = r && curbs(r);
            if (!r || !c) { bad('no-kerb'); continue; }
            const curb = side > 0 ? c.right : c.left, width = c.right + c.left;
            const lanes = Math.max(1, Math.round(width / 3.4)), lane = Math.min(3.6, Math.max(2.5, width / lanes));
            const lat = side * Math.max(0.5, curb - lane + 0.4 + (lane - 0.8) * (k / 3));
            const x = r.px + c.nx * lat, z = r.pz + c.nz * lat;
            if (clearSpot(x, z, 0.25, 'cone')) emit('cone', x, z, hash(x + ':' + z) * 6.28);
          }
          // the sign at the far end of the taper, in the closed lane, facing the traffic that comes to it
          const sx = r0.px + r0.dx * e.out * (TAPER_LEN + 6), sz = r0.pz + r0.dz * e.out * (TAPER_LEN + 6);
          const r = snap(sx, sz), c = r && curbs(r);
          if (r && c) {
            const curb = side > 0 ? c.right : c.left;
            const x = r.px + c.nx * side * Math.max(0.5, curb - 1.0), z = r.pz + c.nz * side * Math.max(0.5, curb - 1.0);
            const kind = rec.i && hash(rec.i + 'sign') < 0.5 ? 'signWork' : 'signLane';
            const yaw = Math.atan2(r.dx * e.out, r.dz * e.out); // its face (+z) toward the way it is read from: outwards
            if (clearSpot(x, z, 0.3, kind)) { emit(kind, x, z, yaw); hasSign = true; }
          }
        }
        // an arrow board where the road is a big one and the work is long
        if (arterial && L > 25) {
          const q0 = along(pts, z0), r0 = snap(q0.x, q0.z);
          if (r0) {
            const r = snap(r0.px - r0.dx * (TAPER_LEN + 14), r0.pz - r0.dz * (TAPER_LEN + 14)), c = r && curbs(r);
            if (r && c) {
              const curb = side > 0 ? c.right : c.left;
              const x = r.px + c.nx * side * Math.max(0.8, curb - 1.3), z = r.pz + c.nz * side * Math.max(0.8, curb - 1.3);
              if (clearSpot(x, z, 1.2, 'arrow')) emit('arrow', x, z, Math.atan2(-r.dx, -r.dz), { side });
            }
          }
        }
      } else {
        // ROAD_CLOSED: a row across the roadway at each end (one for a short stretch)
        const rows = z1 - z0 < 14 ? [{ s: (z0 + z1) / 2, out: 1 }] : ends;
        for (const e of rows) {
          const q = along(pts, e.s), r = snap(q.x, q.z), c = r && curbs(r);
          if (!r) { bad('off-road'); continue; }
          if (!c) { bad('no-kerb'); continue; }
          const oneWay = road.dir !== 0 && road.dir !== undefined;
          const half = rec.d === 1 && !oneWay && c.right + c.left > 6.5;
          if (half) allFull = false;
          const from = half ? (side > 0 ? 0 : -c.left) : -c.left, to = half ? (side > 0 ? c.right : 0) : c.right;
          const span = to - from;
          if (span < 2) { bad('narrow'); continue; }
          const yaw = Math.atan2(-c.nz, c.nx) + (e.out < 0 ? 0 : Math.PI); // the row's x along the normal, its face to the traffic
          const kind = arterial ? 'barrier' : 'barricade';
          const unit = kind === 'barrier' ? 3.0 : 2.4;
          const n = Math.max(1, Math.round(span / unit));
          const w = span / n;
          let rowSigns = 0;
          for (let i = 0; i < n; i++) {
            const lat = from + w * (i + 0.5);
            const x = r.px + c.nx * lat, z = r.pz + c.nz * lat;
            if (clearSpot(x, z, w / 2, kind)) {
              emit(kind, x, z, yaw, { w });
              // the sign on the middle of the row (a barrier row's stands behind it on a post)
              if (i === Math.floor(n / 2)) { rowSigns++; emit('signClosed', x, z, yaw, { w, onBarrier: kind === 'barrier' }); hasSign = true; }
            }
          }
          // cones in front of the row, out to either side
          for (const lat of [from + 0.6, (from + to) / 2, to - 0.6]) {
            const x = r.px + c.nx * lat + r.dx * e.out * 2.2, z = r.pz + c.nz * lat + r.dz * e.out * 2.2;
            if (clearSpot(x, z, 0.25, 'cone')) emit('cone', x, z, hash(x + ':' + z) * 6.28);
          }
        }
      }
    }
    const placed = sites.length - placedBefore;
    return { rec: index, placed: placed > 0, why: placed > 0 ? '' : 'nothing-clear', sites: placed, items: rejectedItems, hasSign, line: pts, full: closed && allFull };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Hours: a record's daily window ("07:00-19:00") against the scene's clock
// ---------------------------------------------------------------------------------------------------------------------
/** "07:00-19:00" as { from, to } minutes after midnight, or null (no window: work all day) */
function hourWindow(text) {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  return { from: Number(m[1]) * 60 + Number(m[2]), to: Number(m[3]) * 60 + Number(m[4]) };
}
/** Is the record at work at `hour` (0-24, fractional) on a day whose weekday is `dow` (0 = Sunday)? No schedule: always. A
 *  window that runs past midnight ("21:00-05:00") also covers the early hours of the next day. */
function activeAtHour(rec, dow, hour) {
  if (!rec.sc) return true;
  const h = (((hour % 24) + 24) % 24) * 60;
  const today = hourWindow(rec.sc[dow]), prev = hourWindow(rec.sc[(dow + 6) % 7]);
  if (rec.sc[dow] && !today) return true; // (a window we cannot read: all day, as the card says it)
  if (today) {
    const end = today.to >= 23 * 60 + 59 ? 24 * 60 : today.to; // ("until 23:59" is to the end of the day)
    if (today.from <= today.to ? h >= today.from && h < end : h >= today.from) return true;
  }
  return !!(prev && prev.from > prev.to && h < prev.to);
}

// ---------------------------------------------------------------------------------------------------------------------
// Lane closures in the traffic: which lanes of which edges the barrels close, and what a driver does about it
// ---------------------------------------------------------------------------------------------------------------------
const CLIP = 1.5; // m from a barrel line to the centre of a lane a car clears it by
const HUG = 0.45; // m a driver edges away from the barrels where there is no open lane to move to
const LANE_TAPER = TAPER_LEN + 2; // m before the first barrel where the taper (and the closed lane's end for a driver) starts
const MERGE_LEAD = 45; // m before the taper where drivers in a closed lane begin to look for a gap
const MERGE_LAST = 18; // m before the taper: still in the closed lane, a driver stops short of it and waits to be let in
const ZONE_SPEED = 11; // m/s (40 km/h) past the works beside an open lane
const STOP_PATIENCE = 45; // s a driver waits at the taper for a gap before it goes on regardless
const CRAWL_SPEED = 4; // m/s (15 km/h) where no lane is open (one lane each way: the road narrows to the gap beside the barrels)
/**
 * `barrels`: [{ x, z, rec, side, fx, fz }] (the layout's barrel sites: side +1 is the right of the way the stretch's
 * direction (fx, fz) runs). Returns { apply(isActive(rec)) -> number of zones in force, zones }: a zone is { a, b, closed:
 * [bool per lane], open: [lane indexes], cap, rec } on an edge, a..b metres along it, and `apply` sets edge.laneZones from
 * the records that are active (so the hours switch them with the barrels). A lane is closed where its centre lies beyond
 * the barrel line, on the barrel's side, for the edge's own way (the barrels of a kerb lane close nothing of the other way).
 */
function laneZoneTable(network, barrels, { cell = 48 } = {}) {
  const edges = (network && network.edges) || [];
  const grid = new Map();
  for (const e of edges) {
    if (!(e.len > 0) || !e.lanes || !e.lanes.length) continue;
    for (let s = 0; s <= e.len + 10; s += 16) {
      const x = e.sx + e.dx * Math.min(s, e.len), z = e.sz + e.dz * Math.min(s, e.len);
      const k = Math.floor(x / cell) * 100003 + Math.floor(z / cell);
      const list = grid.get(k) || grid.set(k, []).get(k);
      if (list[list.length - 1] !== e) list.push(e);
    }
  }
  const per = new Map(); // `${rec}|${edgeIndex}` -> zone
  const index = new Map(edges.map((e, i) => [e, i]));
  const stage = { 'no-edge': 0, 'off-the-edge': 0, 'across-the-road': 0, 'outside-the-lanes': 0, 'no-lane-closed': 0, closed: 0 }; // (how far each barrel got)
  for (const b of barrels) {
    const seen = new Set();
    let best = 'no-edge';
    const rank = (k) => Object.keys(stage).indexOf(k);
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
      for (const e of grid.get((Math.floor(b.x / cell) + a) * 100003 + Math.floor(b.z / cell) + c) || []) {
        if (seen.has(e)) continue;
        seen.add(e);
        const px = b.x - e.sx, pz = b.z - e.sz;
        const s = px * e.dx + pz * e.dz, o = px * e.rx + pz * e.rz;
        const reach = (k) => { if (rank(k) > rank(best)) best = k; };
        if (s < -2 || s > e.len + 2) continue;
        reach('off-the-edge');
        const cos = e.dx * b.fx + e.dz * b.fz;
        if (Math.abs(cos) < 0.8) continue;
        reach('across-the-road');
        if (o < e.lanes[0] - 3.2 || o > e.lanes[e.lanes.length - 1] + 3.2) continue;
        reach('outside-the-lanes');
        const sideE = b.side * (cos > 0 ? 1 : -1);
        // a lane is closed where its centre lies beyond the barrel line, and where a car in it would clip the barrels (the
        // lane's centre within CLIP m of the line, on the open side): CLIP is a car's half width, a barrel's radius & a margin
        const closed = e.lanes.map((lo) => sideE * (lo - o) > -CLIP);
        if (!closed.some(Boolean)) continue;
        reach('closed');
        const key = `${b.rec}|${index.get(e)}`;
        let z = per.get(key);
        if (!z) per.set(key, (z = { edge: e, rec: b.rec, a: Infinity, b: -Infinity, closed: e.lanes.map(() => false), hugs: e.lanes.map(() => 0) }));
        z.a = Math.min(z.a, s); z.b = Math.max(z.b, s);
        closed.forEach((c, i) => { if (c) { z.closed[i] = true; z.hugs[i] = Math.sign(e.lanes[i] - o) * HUG || sideE * HUG; } });
      }
    }
    stage[best]++;
  }
  const zones = [];
  for (const z of per.values()) {
    z.open = z.closed.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
    z.cap = z.open.length ? ZONE_SPEED : CRAWL_SPEED;
    if (z.open.length) z.hugs = z.hugs.map(() => 0); // (a driver with an open lane goes to it; only where there is none does it edge over)
    z.a = Math.max(0, z.a - LANE_TAPER);
    z.b = Math.min(z.edge.len, z.b + 5);
    zones.push(z);
  }
  let applied = [];
  return {
    zones, stage,
    apply(isActive) {
      for (const e of applied) delete e.laneZones;
      applied = [];
      let n = 0;
      for (const z of zones) {
        if (isActive && !isActive(z.rec)) continue;
        const e = z.edge;
        if (!e.laneZones) { e.laneZones = []; applied.push(e); }
        e.laneZones.push(z);
        n++;
      }
      return n;
    }
  };
}
/** The zone of edge e that has lane `lane` closed within `reach` m ahead of position s (front bumper), still not past it */
function closedZoneAhead(e, lane, s, reach = MERGE_LEAD) {
  const zs = e && e.laneZones;
  if (!zs) return null;
  for (const z of zs) if (z.closed[lane] && s < z.b && s + reach > z.a) return z;
  return null;
}
/** The open lane a driver in closed lane `lane` takes a step towards (the neighbour towards the nearest open lane), or -1 */
function mergeStep(z, lane) {
  if (!z.closed[lane] || !z.open.length) return -1;
  let best = z.open[0];
  for (const i of z.open) if (Math.abs(i - lane) < Math.abs(best - lane)) best = i;
  return lane + Math.sign(best - lane);
}
/** The speed a driver front at `f` m along the edge may have for zone z: slowing to the zone's speed by the taper, at `decel` */
function zoneSpeedCap(z, f, tail, decel = 1.8) {
  if (tail > z.b) return Infinity; // (its rear is past the works)
  return Math.sqrt(z.cap * z.cap + 2 * decel * Math.max(0, z.a - f));
}
/**
 * What a driver in lane `lane`, front bumper f m along the edge, does about the zone: { merge: the lane to step to or -1,
 * bSafe: the hardest braking it asks of itself and the driver it cuts in front of (a gap that gets bigger as the taper
 * nears, and with the time it has waited), minGap, stop: the distance to the taper start where it must stop and wait to be
 * let in (Infinity: carry on) }. A driver in an open lane has nothing to do but keep to the zone's speed.
 */
function laneDecision(z, lane, f, waited = 0) {
  const none = { merge: -1, bSafe: -3, minGap: 1.5, stop: Infinity };
  if (!z || !z.closed[lane] || !z.open.length || f > z.b) return none;
  const d = z.a - f; // to the taper's start (negative: already inside)
  if (d > MERGE_LEAD) return none;
  const hurry = d > 25 ? 0 : d > 10 ? 1 : 2;
  const bSafe = -2.5 - 1.5 * hurry - (waited > 3 ? 2 : 0) - (waited > 8 ? 2 : 0);
  const minGap = waited > 8 ? 0.8 : waited > 3 ? 1.1 : 1.5;
  // the wait at the taper: short of its start; inside it (a zone that starts at the edge's mouth), short of the first barrel; and
  // after a long wait (the open lane never gave a gap) it carries on slowly rather than hold the road for ever
  let stop = Infinity;
  if (d < MERGE_LAST && waited < STOP_PATIENCE) stop = Math.max(0.1, d > -1 ? d - 1 : z.a + LANE_TAPER - 1.5 - f);
  return { merge: mergeStep(z, lane), bSafe, minGap, stop };
}

// ---------------------------------------------------------------------------------------------------------------------
// Buses: a route's chain of links, round the roads the works close
// ---------------------------------------------------------------------------------------------------------------------
const DETOUR_MAX = 400; // m of detour beyond three times the closed stretch
function detourPath(from, to, limit) {
  const dist = new Map([[from, 0]]), prev = new Map(), open = [[0, from]];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [d, e] = open.splice(bi, 1)[0];
    if (d > dist.get(e)) continue;
    if (e === to) {
      const path = [];
      for (let x = to; x !== from; x = prev.get(x)) path.push(x);
      return path.reverse();
    }
    for (const m of e.moves || []) {
      const f = m.to;
      if (f.worksClosed || f.tram) continue;
      const nd = d + (f === to ? 0 : f.len);
      if (nd < limit && nd < (dist.get(f) ?? Infinity)) { dist.set(f, nd); prev.set(f, e); open.push([nd, f]); }
    }
  }
  return null;
}
/**
 * A bus route's links with the closed ones (`worksClosed`) taken round: each closed stretch is replaced by the shortest way over
 * open links from the link before it to the link after it, when that is no longer than three times the stretch plus DETOUR_MAX m
 * (and never along a streetcar link). No way: a stretch at an end of the route is left out (`cut`); one in the middle stays
 * (`left`: the scheduled bus passes it as a position, and a bus on the road leaves its route there, traffic.js routeMove).
 * Returns { links, detoured, left, cut }; `links` is the argument itself when nothing on it is closed.
 */
function detourRoute(base) {
  const out = [];
  let i = 0, detoured = 0, left = 0, cut = 0, any = false;
  while (i < base.length) {
    if (!base[i].worksClosed) { out.push(base[i++]); continue; }
    any = true;
    let j = i;
    while (j < base.length && base[j].worksClosed) j++;
    const before = out[out.length - 1], after = base[j];
    const run = base.slice(i, j).reduce((t, e) => t + e.len, 0);
    const path = before && after ? detourPath(before, after, Math.min(3 * run + DETOUR_MAX, run + 1200)) : null;
    if (path) { for (const e of path.slice(0, -1)) out.push(e); detoured++; }
    else if (!before || !after) cut++;
    else { for (const e of base.slice(i, j)) out.push(e); left++; }
    i = j;
  }
  return { links: any && out.length ? out : base, detoured, left, cut };
}

// ---------------------------------------------------------------------------------------------------------------------
// The traffic: the roads a full closure shuts to cars (traffic.js edges: a closed edge is busOnly, as High Park's park roads
// are; js/high-park-features.js closeHighParkRoads)
// ---------------------------------------------------------------------------------------------------------------------
/** Closes the traffic edges lying along the closed stretches: `lines` [{ pts: [{x, z}], half: m }]. An edge whose points at
 *  a quarter, a half and three quarters of its length all lie within `half` m of a line is closed, then the open edges near
 *  them that no longer reach (or are reached from) the rest of the network are too. Returns { closed, stubs } */
function closeEdges(network, lines, { reach = 160, rows = [] } = {}) {
  const edges = (network && network.edges) || [];
  const segDist = (x, z, ax, az, bx, bz) => {
    const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2));
    return Math.hypot(ax + ex * t - x, az + ez * t - z);
  };
  // (grids: each edge is asked about three points & the rows, and the hour changes ask again: the work is the few segments & rows near)
  const CELL = 32, key = (a, b) => a * 100003 + b;
  const segCells = new Map();
  for (const l of lines) for (let i = 1; i < l.pts.length; i++) {
    const a = l.pts[i - 1], b = l.pts[i], seg = { ax: a.x, az: a.z, bx: b.x, bz: b.z, half: l.half };
    for (let ix = Math.floor((Math.min(a.x, b.x) - l.half) / CELL); ix <= Math.floor((Math.max(a.x, b.x) + l.half) / CELL); ix++)
      for (let iz = Math.floor((Math.min(a.z, b.z) - l.half) / CELL); iz <= Math.floor((Math.max(a.z, b.z) + l.half) / CELL); iz++)
        (segCells.get(key(ix, iz)) || segCells.set(key(ix, iz), []).get(key(ix, iz))).push(seg);
  }
  const near = (x, z) => (segCells.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || []).some((g) => segDist(x, z, g.ax, g.az, g.bx, g.bz) < g.half);
  // a row of barricades across an edge ends the road there too: nobody drives up to it and waits for ever
  const rowCells = new Map();
  for (const r of rows) { const k = key(Math.floor(r.x / CELL), Math.floor(r.z / CELL)); (rowCells.get(k) || rowCells.set(k, []).get(k)).push(r); }
  const rowOn = (e) => {
    const lo = (e.lanes ? e.lanes[0] : -3) - 4, hi = (e.lanes ? e.lanes[e.lanes.length - 1] : 3) + 4;
    const seen = new Set();
    for (let t = 0; t <= e.len + 16; t += 16) {
      const x = e.sx + e.dx * Math.min(t, e.len), z = e.sz + e.dz * Math.min(t, e.len);
      for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const r of rowCells.get(key(Math.floor(x / CELL) + a, Math.floor(z / CELL) + c)) || []) {
        if (seen.has(r)) continue;
        seen.add(r);
        const px = r.x - e.sx, pz = r.z - e.sz, s = px * e.dx + pz * e.dz, o = px * e.rx + pz * e.rz;
        if (s > -1 && s < e.len + 1 && o > lo && o < hi) return true;
      }
    }
    return false;
  };
  let closed = 0;
  const shut = [], list = [];
  const shutEdge = (e) => { e.busOnly = true; e.roadClosed = true; e.worksClosed = true; list.push(e); };
  for (const e of edges) {
    if (e.busOnly) continue;
    if ([0.25, 0.5, 0.75].every((t) => near(e.sx + e.dx * e.len * t, e.sz + e.dz * e.len * t)) || (rows.length && rowOn(e))) { shutEdge(e); closed++; shut.push(e); }
  }
  if (!closed) return { closed: 0, stubs: 0 };
  // the region round the closures: open edges inside it that cannot reach the open edges outside it, nor be reached from them
  const shutCells = new Map();
  for (const s of shut) { const k = key(Math.floor(s.sx / reach), Math.floor(s.sz / reach)); (shutCells.get(k) || shutCells.set(k, []).get(k)).push(s); }
  const inRegion = (e) => {
    const ix = Math.floor(e.sx / reach), iz = Math.floor(e.sz / reach);
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const s of shutCells.get(key(ix + a, iz + c)) || []) if (Math.hypot(e.sx - s.sx, e.sz - s.sz) < reach) return true;
    return false;
  };
  const open = edges.filter((e) => !e.busOnly);
  const spread = (forward) => {
    const seen = new Set(open.filter((e) => !inRegion(e)));
    const into = new Map();
    if (!forward) for (const e of open) for (const m of e.moves || []) if (!m.to.busOnly) (into.get(m.to) || into.set(m.to, []).get(m.to)).push(e);
    const stack = [...seen];
    while (stack.length) {
      const e = stack.pop();
      const next = forward ? (e.moves || []).map((m) => m.to).filter((f) => !f.busOnly) : into.get(e) || [];
      for (const f of next) if (!seen.has(f)) { seen.add(f); stack.push(f); }
    }
    return seen;
  };
  const from = spread(true), to = spread(false);
  let stubs = 0;
  for (const e of open) if (inRegion(e) && !(from.has(e) && to.has(e))) { shutEdge(e); stubs++; }
  return { closed, stubs, edges: list };
}
/** Opens again the edges closeEdges closed (`list` is its `edges`) */
function openEdges(list) {
  for (const e of list || []) { e.busOnly = false; e.roadClosed = false; e.worksClosed = false; }
}

Object.assign(window.CITY, { roadworksSites, roadworks: { KINDS, nameKey, dayRange, activeOn, sceneDay, torontoDayOf, closeEdges, openEdges, detourRoute, along, polyLength, BARREL_STEP, TAPER_LEN,
  hourWindow, activeAtHour, laneZoneTable, closedZoneAhead, mergeStep, zoneSpeedCap, laneDecision, LANE_TAPER, MERGE_LEAD, MERGE_LAST, ZONE_SPEED, CRAWL_SPEED, STOP_PATIENCE, CLIP, HUG } });
})();
