// The subway's passenger topology (docs/subway-topology.md): stable station, platform, direction and track-segment
// identities joined to their sources (OpenStreetMap stations, entrances & track ways in js/toronto-subway.js; the
// TTC's GTFS stops, directions and scheduled times in js/toronto-transit.js), the track's connectivity between
// consecutive platforms, and the rides the game supports with their validated geometry and depth profiles.
// A pure function of its inputs: tools/build-subway-topology.mjs writes js/toronto-subway-topology.js from it, and
// tests/subway-topology.test.mjs rebuilds it (byte for byte, and from shuffled inputs).
//
// Identities never come from array positions:
//   station   slug of the OpenStreetMap name ('queen', 'st-george', 'bloor-yonge')
//   line      'L1', 'L2' (OpenStreetMap "Line N ..." ways, GTFS route_short_name N)
//   direction line + GTFS direction_id ('L1-0' toward Vaughan Metropolitan Centre, 'L1-1' toward Finch, 'L2-0'
//             toward Kennedy, 'L2-1' toward Kipling); its sign and the platforms' own compass names come from GTFS
//   platform  station/direction ('queen/L1-0'), with its GTFS stop id
//   segment   direction:from>to ('L1-0:queen>king'): the directed track between consecutive platforms
//   entrance  'osm-node/<id>'
//   ride      authored (tools/subway-station-facts.mjs SUPPORTED_RIDES)

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
export const slug = (name) => name.toLowerCase().replace(/['.’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const lineOf = (name) => { const m = /^Line (\d)\b/.exec(name || ''); return m ? `L${m[1]}` : null; };
const TRAIN_LENGTH = 6 * 23 + 5 * 0.6;
const MATCH = 30; // a station node or GTFS stop within this of a track serves it
const TURN = (35 * Math.PI) / 180; // a smooth continuation at a joint

function polyline(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i], z: flat[i + 1] });
  return pts;
}
function cumulative(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return cum;
}
const heading = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const turn = (a, b) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

// The nearest point of a polyline to (x, z): its distance along, distance off, position and unit tangent
function project(track, x, z) {
  let best = { dist: Infinity };
  const { pts, cum } = track;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez) || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (L * L)));
    const px = a.x + ex * t, pz = a.z + ez * t, d = Math.hypot(px - x, pz - z);
    if (d < best.dist) best = { dist: d, s: cum[i - 1] + L * t, x: px, z: pz, tx: ex / L, tz: ez / L };
  }
  return best;
}
export function pointAt(track, s) {
  const { pts, cum } = track;
  s = Math.max(0, Math.min(cum.at(-1), s));
  let i = 1;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i], L = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / L;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: (b.x - a.x) / L, tz: (b.z - a.z) / L };
}
// The piece of a track from s0 to s1 (s1 < s0: run backwards), its vertices kept
function slice(track, s0, s1) {
  const dir = s1 >= s0 ? 1 : -1, out = [pointAt(track, s0)];
  const { pts, cum } = track;
  const inside = [];
  for (let i = 0; i < pts.length; i++) if ((cum[i] - s0) * dir > 0.05 && (s1 - cum[i]) * dir > 0.05) inside.push(i);
  if (dir < 0) inside.reverse();
  for (const i of inside) out.push(pts[i]);
  out.push(pointAt(track, s1));
  return out.map((p) => ({ x: p.x, z: p.z }));
}

// Running track (a line's ways with no service tag: no sidings, crossovers or yard tracks) joined end to end into
// chains wherever one way's end point is the next's and the track runs on smoothly (the source's shared node)
export function trackChains(ways) {
  const running = ways.map((w) => ({ name: w[0], flags: w[1], service: w[3], pts: polyline(w[4]), id: w[5] || 0, line: lineOf(w[0]) }))
    .filter((w) => w.line && !w.service && w.pts.length > 1)
    .sort((a, b) => a.id - b.id || a.pts[0].x - b.pts[0].x || a.pts[0].z - b.pts[0].z);
  const key = (p) => `${p.x},${p.z}`;
  const at = new Map();
  running.forEach((w, i) => [w.pts[0], w.pts.at(-1)].forEach((p, end) => {
    const k = key(p);
    (at.get(k) || at.set(k, []).get(k)).push({ i, end });
  }));
  const used = new Set(), chains = [];
  const outHeading = (w, end) => (end === 0 ? heading(w.pts[0], w.pts[1]) : heading(w.pts.at(-1), w.pts.at(-2)));
  for (let start = 0; start < running.length; start++) {
    if (used.has(start)) continue;
    used.add(start);
    let parts = [{ i: start, rev: false }];
    // extend forward from the last part's far end, then backward from the first part's near end
    for (const forward of [true, false]) {
      for (;;) {
        const edge = forward ? parts.at(-1) : parts[0];
        const w = running[edge.i];
        const end = forward ? (edge.rev ? 0 : 1) : (edge.rev ? 1 : 0);
        const p = end === 0 ? w.pts[0] : w.pts.at(-1);
        const arriving = outHeading(w, end) + Math.PI; // the travel heading arriving at p, going outward
        let best = null, bestTurn = TURN;
        for (const c of at.get(key(p)) || []) {
          if (used.has(c.i) || running[c.i].line !== w.line) continue;
          const t = turn(arriving, outHeading(running[c.i], c.end));
          if (t < bestTurn) { bestTurn = t; best = c; }
        }
        if (!best) break;
        used.add(best.i);
        // leaving p at best's end `best.end`: forward runs it from that end, backward ends it there
        const part = { i: best.i, rev: forward ? best.end === 1 : best.end === 0 };
        if (forward) parts.push(part); else parts.unshift(part);
      }
    }
    const pts = [], ways = [], wayLengths = [];
    for (const { i, rev } of parts) {
      const w = running[i], P = rev ? w.pts.slice().reverse() : w.pts;
      for (const p of P) if (!pts.length || pts.at(-1).x !== p.x || pts.at(-1).z !== p.z) pts.push(p);
      ways.push(w.id); wayLengths.push(cumulative(w.pts).at(-1));
    }
    chains.push({ line: running[start].line, pts, cum: cumulative(pts), ways, wayLengths, wayFlags: parts.map(({ i }) => running[i].flags) });
  }
  return chains;
}

export function buildSubwayTopology({ subway, transit, facts, aliases = {}, rides = [], limits }) {
  const problems = [];
  // Stations (OpenStreetMap), by slug; a name used twice would be ambiguous: refuse it
  const stations = new Map();
  for (const [x, z, name, colour, accessible, osm] of subway.stations) {
    const id = slug(name);
    if (stations.has(id)) { problems.push(`two stations named ${id}`); continue; }
    stations.set(id, { id, name, osm: osm || null, x, z, colour, accessible: accessible ? true : false, lines: [], platforms: [], entrances: [] });
  }
  for (const [x, z, station, , name, , osm] of subway.entrances) {
    const s = stations.get(slug(station || ''));
    if (s && osm) s.entrances.push({ id: `osm-node/${osm}`, name, x, z });
  }
  const chains = trackChains(subway.ways);

  // GTFS directions & their stops (subway routes)
  const directions = [], platforms = new Map();
  const routes = transit.routes;
  const subwayPatterns = transit.patterns.filter((p) => p.t === 1 || routes[p.r]?.[2] === 1)
    .map((p) => ({ p, num: routes[p.r][0] }))
    .filter(({ p, num }) => /^\d$/.test(num) && p.stops?.length)
    .sort((a, b) => a.num.localeCompare(b.num) || a.p.d - b.p.d || b.p.n - a.p.n);
  const seen = new Set();
  for (const { p, num } of subwayPatterns) {
    const id = `L${num}-${p.d}`;
    if (seen.has(id)) continue; // the busiest pattern of each direction (the sort puts it first)
    seen.add(id);
    const calls = [];
    p.stops.forEach((s, k) => {
      const raw = transit.stopNames[s] || '';
      const m = /^(.*?) Station(?: - (\w+) Platform)?/.exec(raw);
      const base = slug(m ? m[1] : raw), station = aliases[base] || base;
      if (!stations.has(station)) return;
      calls.push({ station, stopId: String(transit.stopIds?.[s] ?? ''), compass: m?.[2] || null, time: p.times?.[k] ?? null,
        x: transit.stops[2 * s], z: transit.stops[2 * s + 1] });
    });
    directions.push({ id, line: `L${num}`, gtfsRoute: num, gtfsDirection: p.d, sign: (p.sign || []).join(' / '), calls });
  }
  directions.sort((a, b) => a.id.localeCompare(b.id));

  // Platforms: where each direction's track passes its station. The track: of this line's chains near the station,
  // the one the trains run along toward the next call on the right (the TTC runs right-handed; checked against the
  // other direction's track, not assumed, where both are mapped)
  const near = (line, x, z) => chains.filter((c) => c.line === line).map((c) => ({ c, q: project(c, x, z) })).filter(({ q }) => q.dist < MATCH);
  const segments = [];
  for (const d of directions) {
    const located = d.calls.map((call, k) => {
      const s = stations.get(call.station);
      // the station node where it lies on this line's track, else the GTFS stop
      let cands = near(d.line, s.x, s.z), basis = 'osm-station';
      if (!cands.length) { cands = near(d.line, call.x, call.z); basis = 'gtfs-stop'; }
      const ref = basis === 'osm-station' ? s : call;
      const nextCall = d.calls[k + 1] || null, prevCall = d.calls[k - 1] || null;
      return { call, s, cands, basis, ref, nextCall, prevCall };
    });
    for (let k = 0; k < located.length; k++) {
      const L = located[k], { call, s } = L;
      const pid = `${call.station}/${d.id}`;
      const platform = { id: pid, station: call.station, line: d.line, direction: d.id, gtfsStopId: call.stopId, compass: call.compass,
        basis: L.cands.length ? L.basis : null, x: null, z: null, yaw: null, running: null, trackSeparation: null, chainWays: null };
      // the travel heading here: toward the next call, else away from the previous one
      const other = L.nextCall ? stations.get(L.nextCall.station) : L.prevCall ? stations.get(L.prevCall.station) : null;
      if (L.cands.length && other) {
        const sign = L.nextCall ? 1 : -1;
        const oriented = L.cands.map(({ c, q }) => {
          const o = project(c, other.x, other.z);
          const forward = (o.s - q.s) * sign >= 0;
          return { c, q, tx: forward ? q.tx : -q.tx, tz: forward ? q.tz : -q.tz };
        });
        const tx = oriented[0].tx, tz = oriented[0].tz;
        const mx = oriented.reduce((t, o) => t + o.q.x, 0) / oriented.length, mz = oriented.reduce((t, o) => t + o.q.z, 0) / oriented.length;
        // right of travel: (-tz, tx) in this frame (x east, z south)
        const right = (o) => (o.q.x - mx) * -tz + (o.q.z - mz) * tx;
        const pick = oriented.length === 1 ? oriented[0] : oriented.reduce((a, b) => (right(b) > right(a) ? b : a));
        // 'right-hand': the other direction's track lies to the left, 3-12 m away (a side or centre platform's spacing)
        if (oriented.length > 1) {
          const others = oriented.filter((o) => o !== pick);
          platform.trackSeparation = r2(Math.min(...others.map((o) => Math.hypot(o.q.x - pick.q.x, o.q.z - pick.q.z))));
        }
        platform.running = oriented.length === 1 ? 'unverified'
          : right(pick) > 0.5 && platform.trackSeparation >= 3 && platform.trackSeparation <= 12 ? 'right-hand' : 'ambiguous';
        const q = project(pick.c, L.ref.x, L.ref.z);
        Object.assign(platform, { x: r1(q.x), z: r1(q.z), yaw: Math.round(Math.atan2(pick.tx, pick.tz) * 1e4) / 1e4, chainWays: pick.c.ways.slice() });
        L.pick = pick; L.q = q;
      }
      platforms.set(pid, platform);
      const st = stations.get(call.station);
      if (!st.lines.includes(d.line)) st.lines.push(d.line);
      st.platforms.push(pid);
    }
    // Segments between consecutive calls: continuous when both platforms lie on one chain, in the travel order
    for (let k = 0; k + 1 < located.length; k++) {
      const A = located[k], B = located[k + 1];
      const id = `${d.id}:${A.call.station}>${B.call.station}`;
      const seg = { id, direction: d.id, from: `${A.call.station}/${d.id}`, to: `${B.call.station}/${d.id}`, continuous: false,
        length: null, osmWays: [], structure: null, scheduled: A.call.time != null && B.call.time != null ? B.call.time - A.call.time : null, problem: null };
      if (!A.pick || !B.pick) seg.problem = 'platform not located on the line\'s track';
      else if (A.pick.c !== B.pick.c) seg.problem = 'platforms on different track chains (a gap or a junction in the source)';
      else {
        const c = A.pick.c, s0 = A.q.s, s1 = project(c, B.ref.x, B.ref.z).s;
        seg.continuous = true;
        seg.length = r1(Math.abs(s1 - s0));
        // the ways it runs through, in travel order
        const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
        let acc = 0;
        const along = [], flags = [];
        c.ways.forEach((way, i) => {
          const n = c.wayLengths[i];
          if (acc + n > lo + 0.05 && acc < hi - 0.05) { along.push(way); flags.push(c.wayFlags[i]); }
          acc += n;
        });
        seg.osmWays = s1 >= s0 ? along : along.reverse();
        // (OpenStreetMap: 2 tunnel, 8 viaduct, 1 bridge, 4 covered)
        seg.structure = flags.every((f) => f & 2) ? 'tunnel' : flags.some((f) => f & 8) ? 'tunnel+viaduct' : 'tunnel+open';
      }
      segments.push(seg);
    }
  }

  // Rides: validated against the platforms, the track and the depth facts
  const rideOut = [];
  for (const ride of rides) {
    const out = { id: ride.id, line: ride.line, stations: ride.stations.slice(), geometry: ride.geometry, connection: ride.connection || 'transition',
      supported: false, problems: [], directions: [] };
    const dirs = directions.filter((d) => d.line === ride.line);
    for (const d of dirs) {
      const ia = d.calls.findIndex((c) => c.station === ride.stations[0]), ib = d.calls.findIndex((c) => c.station === ride.stations[1]);
      if (ia < 0 || ib < 0 || Math.abs(ia - ib) !== 1) { out.problems.push(`${d.id}: stations not consecutive`); continue; }
      const [from, to] = ia < ib ? ride.stations : ride.stations.slice().reverse();
      const seg = segments.find((s) => s.id === `${d.id}:${from}>${to}`);
      if (!seg?.continuous) { out.problems.push(`${d.id}: ${seg?.problem || 'no segment'}`); continue; }
      const entry = { direction: d.id, from, to, segment: seg.id, platforms: [seg.from, seg.to], compass: platforms.get(seg.from).compass,
        sign: d.sign, scheduled: seg.scheduled };
      const depthKnown = ride.stations.every((st) => facts[st]?.depth?.platformFloor);
      if (ride.geometry === 'track' && depthKnown) Object.assign(entry, trackGeometry(platforms, seg, chains, facts, limits, out.problems));
      out.directions.push(entry);
    }
    for (const st of ride.stations) {
      const f = facts[st];
      if (!f) out.problems.push(`${st}: no station facts`);
      else if (ride.geometry === 'track' && !(f.depth?.platformFloor)) out.problems.push(`${st}: no platform depth`);
      else if (ride.geometry === 'viaduct' && f.depth?.worldDatum !== 'viaduct') out.problems.push(`${st}: not on the viaduct datum`);
      for (const p of stations.get(st)?.platforms || []) {
        const pl = platforms.get(p);
        if (pl.line === ride.line && pl.running !== 'right-hand') out.problems.push(`${p}: track ${pl.running}`);
      }
      const known = new Set((stations.get(st)?.entrances || []).map((e) => e.id));
      for (const e of f?.entrances || []) if (!known.has(`osm-node/${e}`)) out.problems.push(`${st}: entrance osm-node/${e} not a street entrance of the station`);
    }
    out.directions.sort((a, b) => a.direction.localeCompare(b.direction));
    out.supported = out.directions.length === 2 && !out.problems.length;
    rideOut.push(out);
  }

  // Station facts (levels, platforms, depths, the walkable connection's entrances) with their sources
  const stationOut = [...stations.values()].sort((a, b) => a.id.localeCompare(b.id)).map((s) => {
    const f = facts[s.id];
    return { ...s, lines: s.lines.sort(), platforms: s.platforms.sort(), entrances: s.entrances.sort((a, b) => a.id.localeCompare(b.id)),
      facts: f ? { levels: f.levels ?? null, levelNames: f.levelNames || null, platformType: f.platformType || null, accessible: f.accessible ?? null,
        depth: f.depth || null, walkEntrances: (f.entrances || []).map((e) => `osm-node/${e}`), sources: f.sources || [] } : null };
  });
  const platformOut = [...platforms.values()].sort((a, b) => a.id.localeCompare(b.id));
  segments.sort((a, b) => a.id.localeCompare(b.id));
  const lines = [...new Set(directions.map((d) => d.line))].sort().map((id) => ({ id, directions: directions.filter((d) => d.line === id).map((d) => d.id) }));
  return {
    version: 1,
    lines,
    directions: directions.map(({ calls, ...d }) => ({ ...d, calls: calls.map((c) => `${c.station}/${d.id}`) })),
    stations: stationOut,
    platforms: platformOut,
    segments,
    rides: rideOut,
    summary: {
      chains: chains.length,
      platforms: platformOut.length,
      platformsLocated: platformOut.filter((p) => p.x !== null).length,
      platformsRightHand: platformOut.filter((p) => p.running === 'right-hand').length,
      segments: segments.length,
      continuous: segments.filter((s) => s.continuous).length,
      rides: rideOut.filter((r) => r.supported).map((r) => r.id),
      problems: problems.concat(rideOut.flatMap((r) => r.problems.map((p) => `${r.id}: ${p}`)))
    }
  };
}

// A track ride's geometry: the directed track from `approach` before the departure platform to `runOut` past the
// arrival, its platforms' distances along it, and the rail-top profile (level platforms at each station's depth,
// joined by a constant grade), with its grade and platform-straightness checks
function trackGeometry(platforms, seg, chains, facts, limits, problems) {
  const A = platforms.get(seg.from), B = platforms.get(seg.to);
  const chain = chains.find((c) => c.ways.join() === A.chainWays.join());
  const qa = project(chain, A.x, A.z), qb = project(chain, B.x, B.z), dir = qb.s >= qa.s ? 1 : -1;
  const s0 = qa.s - dir * limits.approach, s1 = qb.s + dir * limits.runOut;
  if ((dir > 0 ? s0 < 0 || s1 > chain.cum.at(-1) : s1 < 0 || s0 > chain.cum.at(-1))) problems.push(`${seg.id}: the track does not run on far enough either side`);
  const pts = slice(chain, Math.max(0, Math.min(chain.cum.at(-1), s0)), Math.max(0, Math.min(chain.cum.at(-1), s1)));
  const track = { pts, cum: cumulative(pts) };
  const calls = [project(track, A.x, A.z).s, project(track, B.x, B.z).s];
  const railOf = (st) => facts[st].depth.platformFloor.value - 1.1;
  const ya = railOf(A.station), yb = railOf(B.station), half = limits.platformHalf;
  const profile = [[0, ya], [calls[0] + half, ya], [calls[1] - half, yb], [track.cum.at(-1), yb]];
  const grade = Math.abs(yb - ya) / Math.max(1, calls[1] - calls[0] - 2 * half);
  if (grade > limits.maxGrade) problems.push(`${seg.id}: grade ${(grade * 100).toFixed(1)}% over ${limits.maxGrade * 100}%`);
  // a platform must be straight enough for a six-car train: the track's sag from its chord over the platform
  const straight = calls.map((c) => {
    const a = pointAt(track, c - TRAIN_LENGTH / 2), b = pointAt(track, c + TRAIN_LENGTH / 2);
    let worst = 0;
    for (let s = c - TRAIN_LENGTH / 2; s <= c + TRAIN_LENGTH / 2; s += 2) {
      const p = pointAt(track, s), ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez) || 1;
      worst = Math.max(worst, Math.abs((p.x - a.x) * ez - (p.z - a.z) * ex) / L);
    }
    return r2(worst);
  });
  straight.forEach((w, i) => { if (w > 0.6) problems.push(`${seg.id}: platform ${i ? B.id : A.id} curves ${w} m off straight`); });
  return { track: pts.flatMap((p) => [r2(p.x), r2(p.z)]), calls: calls.map(r2), profile: profile.map(([s, y]) => [r2(s), r2(y)]),
    grade: Math.round(grade * 1e4) / 1e4, platformSag: straight, length: r1(track.cum.at(-1)) };
}
