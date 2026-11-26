// tools/roadworks-traffic-measure.js: traffic round the City's lane closures, run inside the page by a capture shot
// (tools/shots/roadworks-traffic-measure.json), after the road works are drawn (needs a recorded feed: tools/make-roadworks-init.mjs).
// The real-time loop stops (film mode) and the traffic is stepped headless at a fixed 1/30 s with a seeded Math.random, as
// tools/traffic-measure.js does. For each lane closure the traffic has a zone for (edge.laneZones: js/roadworks-layout.js), it
// is run for `seconds` of game time with the focus on the zone, and logs one `[rwtraffic] {json}` line:
//   clipSamples: samples (every 0.2 s) in which a vehicle's body overlapped a barrel of the zone (a car sitting in the barrels);
//     0 is the aim. clearanceMin: the least gap (m) between a vehicle's side and a barrel while it passed
//   merged: vehicles that left the closed lane for an open one; passed: vehicles that went by the last barrel; mix of lanes
//   queue: the stopped vehicles in line back from the taper (a chain: each within 9 m of the next), their count and the length of
//     the line in m: max, mean, mean over the last third of the run; longestWait: the longest any one vehicle stood (s) in it
//   stuck: vehicles standing more than 60 s anywhere on the zone's edge or the edges leading to it (a jam that never clears)
(() => {
  const app = window.__CITY_APP, C = window.CITY, THREE = C.THREE;
  const T = app.trafficSystem;
  const DT = 1 / 30;
  const log = (o) => console.log('[rwtraffic] ' + JSON.stringify(o));
  const mulberry = (a) => () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const vehicles = () => [...T.cars, ...T.buses];
  const cam = app.cameraSystem.camera;
  const focus = new THREE.Vector3();
  let elapsed = 0, updateMs = 0, updates = 0;
  function aim(x, z) {
    focus.set(x, 60, z);
    cam.position.set(x, 60, z + 40);
    cam.lookAt(x, 0, z);
    cam.updateMatrixWorld();
  }
  function step() {
    elapsed += DT;
    const t0 = performance.now();
    T.update(DT, elapsed, focus, app.controllerManager.getActiveEntity(), 'helicopter', cam);
    updateMs += performance.now() - t0;
    updates++;
  }
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));

  // the zones in force: the edges with laneZones, busiest first (the City's counts, edge.vph at this hour)
  function zones() {
    const out = [];
    for (const e of T.network.edges) for (const z of e.laneZones || []) out.push({ e, z, name: (C.roadworksLive?.records[z.rec]?.r) || '?', len: z.b - z.a });
    return out.sort((p, q) => q.e.vph - p.e.vph);
  }
  // the edges that lead into e (vehicles queue back along them)
  const feeders = (e) => (e.from && e.from.in ? e.from.in.filter((f) => f.moves && f.moves.some((m) => m.to === e)) : []);

  async function measure(spot, seed, seconds, opts = {}) {
    const { e, z } = spot;
    Math.random = mulberry(seed);
    elapsed = 4000 + seed * 17;
    if (opts.baseline && C.roadworksLive?.laneTable) C.roadworksLive.laneTable.apply(() => false); else if (C.roadworksLive?.laneTable) C.roadworksLive.laneTable.apply((rec) => C.roadworksLive.activeSet.has(rec));
    const mid = z.a + (z.b - z.a) / 2;
    aim(e.sx + e.dx * mid, e.sz + e.dz * mid);
    for (let i = 0; i < 30 / DT; i++) { step(); if (i % 150 === 149) await yieldUI(); } // the jump places everyone, then they settle
    const up = feeders(e);
    const seen = new Set(), tracked = new Map(); // vehicle -> { passed, wasClosed, lastLane }
    let inBarrels = 0, samples = 0, merged = 0, passed = 0, queueMax = 0, queueLenMax = 0, queueSum = 0, qSamples = 0, lastThirdSum = 0, lastThirdN = 0, longestWait = 0;
    const lanes = e.lanes.map(() => 0);
    const wasIn = new Map(); // vehicle -> lane it was in on the edge, to count a merge
    const stuck = new Set();
    const total = Math.round(seconds / DT);
    const siteBarrels = (C.roadworksLive ? C.roadworksLive.sites : []).filter((q) => q.kind === 'barrel' && q.rec === z.rec);
    let clearance = Infinity, clips = 0;
    const lastClip = new Map(), bornAt = new Map();
    const barrelA = z.a + (C.roadworks ? C.roadworks.LANE_TAPER : 11), barrelB = z.b - 5;
    for (let i = 0; i < total; i++) {
      step();
      if (i % 6 === 0) { // every 0.2 s
        samples++;
        let inBar = 0;
        const stopped = [];
        for (const v of vehicles()) {
          if (!v.edge) continue;
          if (v.edge === e && v.conn && !tracked.has(v) && wasIn.has(v)) { tracked.set(v, 1); passed++; lanes[wasIn.get(v)]++; } // (went on into the junction: past the works)
          if (v.edge !== e) { wasIn.delete(v); bornAt.delete(v); }
          if (v.edge === e && !v.conn) {
            const prev = wasIn.get(v);
            if (prev !== undefined && prev !== v.lane && z.closed[prev] && !z.closed[v.lane]) merged++;
            wasIn.set(v, v.lane);
            if (!bornAt.has(v)) bornAt.set(v, elapsed);
            if (v.s > barrelA - v.half && v.s < barrelB + v.half) {
              const sn = Math.sin(v.yaw), cs = Math.cos(v.yaw);
              for (const b of siteBarrels) {
                const bx = b.x - v.x, bz = b.z - v.z, along = bx * sn + bz * cs;
                if (Math.abs(along) > v.half + 0.3) continue;
                const gap = Math.abs(bx * cs - bz * sn) - v.halfWidth - 0.3; // (a barrel is 0.3 m in radius)
                if (gap < clearance) clearance = gap;
                if (gap < 0) {
                  inBar++;
                  if (clips < 8 && (!lastClip.has(v) || elapsed - lastClip.get(v) > 5)) {
                    clips++; lastClip.set(v, elapsed);
                    log({ kind: 'clip', road: spot.name, t: +(elapsed - 4000).toFixed(1), bus: !!v.bus, lane: v.lane, closed: z.closed.map(Number).join(''), s: +v.s.toFixed(1), zoneA: +z.a.toFixed(1), zoneB: +z.b.toFixed(1), len: +e.len.toFixed(1), speed: +v.speed.toFixed(1), wait: +v.wait.toFixed(1), dl: +v.dl.toFixed(2), gap: +gap.toFixed(2), half: v.halfWidth, hug: v.hug, route: !!(v.route && !v.route.off), why: T.whyWaiting ? T.whyWaiting(v) : null, born: +(elapsed - (bornAt.get(v) ?? elapsed)).toFixed(1) });
                  }
                  break;
                }
              }
            }
            if (v.s > z.b && !tracked.has(v)) { tracked.set(v, 1); passed++; lanes[v.lane]++; }
            if (v.s < z.b - 1) tracked.delete(v);
            if (v.speed < 0.5 && v.s < z.a) stopped.push({ d: z.a - v.s, v });
          } else if (up.includes(v.edge) && !v.conn) {
            if (v.speed < 0.5) stopped.push({ d: z.a + (v.edge.len - v.s), v });
          }
          if (v.wait > 60 && (v.edge === e || up.includes(v.edge))) {
            if (!stuck.has(v)) { // (once: where it stands and what is round it)
              const occ = v.edge.occ ? v.edge.occ.map((l) => l.filter((o) => Math.abs(o.s - v.s) < 30).map((o) => `${o.v.bus ? 'B' : 'c'}@${(o.s - v.s).toFixed(1)}/${o.v.speed.toFixed(1)}`).join(' ')) : null;
              log({ kind: 'stuck', road: spot.name, onZoneEdge: v.edge === e, bus: !!v.bus, t: +(elapsed - 4000).toFixed(0), lane: v.lane, lanes: v.edge.lanes.length, s: +v.s.toFixed(1), len: +v.edge.len.toFixed(1), zoneA: +z.a.toFixed(1), zoneB: +z.b.toFixed(1), speed: +v.speed.toFixed(2), wait: +v.wait.toFixed(0), gap: +(v.gap === Infinity ? -1 : v.gap).toFixed(1), conn: !!v.conn, dl: +v.dl.toFixed(2), commit: !!v.commit, dodge: v.dodge, why: T.whyWaiting && !v.conn ? T.whyWaiting(v) : null, sig: v.edge.to.signal, turn: v.move && v.move.turn, out: v.move && v.move.out.join(','), closed: v.edge.laneZones ? v.edge.laneZones.map((q) => q.closed.map(Number).join('')).join('|') : null, occ, route: !!(v.route && !v.route.off) });
            }
            stuck.add(v);
          }
          if (v.edge === e && v.s < z.a + 4 && v.wait > longestWait) longestWait = v.wait;
        }
        if (inBar) inBarrels++;
        // the line back from the taper: each stopped vehicle within 9 m of the one before it
        stopped.sort((p, q) => p.d - q.d);
        let n = 0, len = 0, last = 0;
        for (const s of stopped) { if (s.d - last > 9 + (n ? 0 : 6)) break; n++; len = s.d; last = s.d; }
        queueMax = Math.max(queueMax, n); queueLenMax = Math.max(queueLenMax, len);
        queueSum += n; qSamples++;
        if (i > total * 2 / 3) { lastThirdSum += n; lastThirdN++; }
      }
      if (i % 150 === 149) await yieldUI();
    }
    log({ kind: 'zone', baseline: !!opts.baseline, road: spot.name, edge: e.id, lanes: e.lanes.length, open: z.open.length, closedLane: z.closed.map((c) => (c ? 1 : 0)).join(''), zoneLen: Math.round(z.b - z.a), vph: Math.round(e.vph), seed, seconds,
      clipSamples: inBarrels, clearanceMin: Number.isFinite(clearance) ? +clearance.toFixed(2) : null, samples, merged, passed, passedPerMin: +(passed / seconds * 60).toFixed(1), lanes: lanes.join('/'),
      queueMax, queueLenMax: +queueLenMax.toFixed(1), queueMean: +(queueSum / Math.max(1, qSamples)).toFixed(2), queueLastThird: +(lastThirdSum / Math.max(1, lastThirdN)).toFixed(2), longestWait: +longestWait.toFixed(1), stuck: stuck.size,
      cars: T.cars.filter((c) => c.edge).length, updateMs: +(updateMs / Math.max(1, updates)).toFixed(3) });
    updateMs = 0; updates = 0;
  }

  window.__roadworksTrafficMeasure = async (opts = {}) => {
    const t0 = performance.now();
    app.film.start(30);
    app.cameraSystem.cinema = null;
    if (opts.hour !== undefined && C.roadworksLive?.setHour) { T.setHour(opts.hour); C.roadworksLive.setHour(opts.hour); }
    const all = zones();
    log({ kind: 'zones', total: all.length, merge: all.filter((s) => s.z.open.length).length, crawl: all.filter((s) => !s.z.open.length).length, stats: C.roadworksStats && { laneBarrels: C.roadworksStats.laneBarrels, placed: C.roadworksStats.placed, laneZones: C.roadworksStats.laneZones, laneZonesActive: C.roadworksStats.laneZonesActive, closedEdges: C.roadworksStats.closedEdges, hour: C.roadworksStats.hour } });
    log({ kind: 'bloor', zones: all.filter((s) => /Bloor|Queen|Dundas/.test(s.name)).map((s) => `${s.name} e${s.e.id} lanes ${s.e.lanes.length} closed ${s.z.closed.map(Number).join('')} len ${Math.round(s.len)} vph ${Math.round(s.e.vph)}`) });
    log({ kind: 'merge-zones', zones: all.filter((s) => s.z.open.length).map((s) => `${s.name} e${s.e.id} lanes ${s.e.lanes.length} closed ${s.z.closed.map(Number).join('')} len ${Math.round(s.len)} vph ${Math.round(s.e.vph)}`) });
    // the zones asked for by road name, else the busiest merge zone and the busiest crawl zone
    const picks = [];
    const add = (x) => { if (x && !picks.includes(x)) picks.push(x); };
    for (const name of opts.roads || []) for (const want of [false, true]) add(all.find((x) => x.name === name && x.len >= 30 && !!x.z.open.length === want));
    for (const want of [true, false]) add(all.find((x) => !!x.z.open.length === want && x.len >= 40 && !picks.includes(x)));
    // (the busiest of each kind after those, up to `max`)
    for (const x of all) { if (picks.length >= (opts.max || 4)) break; if (x.len >= 40 && x.e.vph > 300) add(x); }
    for (const s of picks.slice(0, opts.max || 4)) for (const seed of opts.seeds || [1]) { await measure(s, seed, opts.seconds || 300, {}); if (opts.baseline) await measure(s, seed, opts.seconds || 300, { baseline: true }); }
    log({ kind: 'done', wallSeconds: (performance.now() - t0) / 1000 });
    app.film.stop();
  };
})();
