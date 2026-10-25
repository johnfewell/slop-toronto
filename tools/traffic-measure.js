// tools/traffic-measure.js: traffic-flow measurements, run inside the page by a capture shot (tools/shots/traffic-measure.json)
// The real-time loop stops (film mode) and the traffic & streetcars are stepped headless at a fixed 1/30 s with a
// seeded Math.random, so a run on one commit and on another start from the same random stream. Works with the global
// signal clock (signalPhase) and with the per-junction plan (SIGNALS). Logs one `[measure] {json}` line per result.
(() => {
  const app = window.__CITY_APP, C = window.CITY, THREE = C.THREE;
  const T = app.trafficSystem, SC = app.streetcars;
  const DT = 1 / 30;
  const log = (o) => console.log('[measure] ' + JSON.stringify(o));
  const mulberry = (a) => () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const stateOf = (e, time) => {
    if (!e.to.signal) return 'green';
    if (C.SIGNALS && e.to.sigJ !== undefined) return C.SIGNALS.state(e.to.sigJ, e.sigP, time);
    return C.signalPhase(time, e.axisIndex === 0);
  };
  const vehicles = () => [...T.cars, ...T.buses];
  const cam = app.cameraSystem.camera;
  const focus = new THREE.Vector3();
  let elapsed = 0;
  let updateMs = 0, updates = 0;
  function aim(x, z) {
    focus.set(x, 60, z);
    cam.position.set(x, 60, z + 40);
    cam.lookAt(x, 0, z);
    cam.updateMatrixWorld();
  }
  // one fixed step of the traffic & the streetcars
  function step(player = null, mode = 'helicopter') {
    elapsed += DT;
    const t0 = performance.now();
    T.update(DT, elapsed, focus, player || app.controllerManager.getActiveEntity(), mode, cam);
    updateMs += performance.now() - t0;
    updates++;
    if (SC) SC.update(DT, elapsed, cam, player, mode);
  }
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));
  async function run(seconds, each, player, mode) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      step(player, mode);
      if (each) each(i);
      if (i % 150 === 149) await yieldUI();
    }
  }
  const pct = (a, q) => {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  };
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  // --- A. Fleet: stop time per km, queued share, pedestrians' waits, around a spot ---
  async function fleet(spot, seed, seconds) {
    Math.random = mulberry(seed);
    elapsed = 3000 + seed * 13;
    aim(spot.x, spot.z);
    await run(30); // the jump places everyone, then they settle
    const last = new Map(), trips = [];
    const tripOf = (v) => last.get(v);
    const reasons = {};
    let samples = 0, queuedShare = 0, stoppedShare = 0, pedWaits = [], pedState = new Map(), sumStop = 0, sumKm = 0;
    await run(seconds, (i) => {
      for (const v of vehicles()) {
        if (!v.edge) continue;
        let tr = tripOf(v);
        const moved = tr ? Math.hypot(v.x - tr.x, v.z - tr.z) : 0;
        if (!tr || moved > 8) { // new or respawned
          if (tr && tr.km > 0.3) trips.push(tr.stop / tr.km);
          tr = { x: v.x, z: v.z, km: 0, stop: 0 };
          last.set(v, tr);
          continue;
        }
        tr.km += moved / 1000;
        sumKm += moved / 1000;
        if (v.speed < 0.3) { tr.stop += DT; sumStop += DT; }
        tr.x = v.x; tr.z = v.z;
      }
      if (i % 30 === 0) {
        // why each stopped vehicle stands: at a red, queued behind another, first in line at a green / at an
        // unsignalised junction (waiting to get in), or elsewhere
        for (const v of vehicles()) {
          if (!v.edge || v.speed >= 0.3) continue;
          const e = v.edge;
          let r;
          if (v.conn) r = v.yielding ? 'inside-turning' : 'inside-blocked';
          else if (v.gap < 6) r = e.to.signal && stateOf(e, elapsed) !== 'green' ? 'queue-at-red' : 'queue';
          else if (e.len - v.s - v.half > 12) r = 'midblock-other';
          else if (e.to.signal) r = stateOf(e, elapsed) === 'green' ? 'front-green-blocked' : 'front-red';
          else r = 'front-unsignalised';
          reasons[r] = (reasons[r] || 0) + 1;
        }
      }
      if (i % 15 === 0) {
        let act = 0, q = 0, st = 0;
        for (const v of vehicles()) {
          if (!v.edge) continue;
          act++;
          if (v.speed < 0.3) st++;
          if (v.speed < 0.3 && !v.conn && v.edge.to.signal && v.edge.len - v.s < 90 && stateOf(v.edge, elapsed) !== 'green') q++;
        }
        if (act) { samples++; queuedShare += q / act; stoppedShare += st / act; }
      }
      for (const p of T.peds) {
        const s = pedState.get(p);
        const w = !!(p.placed && p.waiting);
        if (w && !s) pedState.set(p, { t: elapsed, node: p.node, x: p.x, z: p.z });
        else if (!w && s) {
          if (p.node === s.node && Math.hypot(p.x - s.x, p.z - s.z) < 6) pedWaits.push(elapsed - s.t);
          pedState.delete(p);
        }
      }
    });
    for (const tr of last.values()) if (tr.km > 0.3) trips.push(tr.stop / tr.km);
    const placed = T.peds.filter((p) => p.placed);
    log({ kind: 'fleet', spot: spot.name, seed, seconds, cars: T.cars.length, buses: T.buses.length, active: vehicles().filter((v) => v.edge).length, peds: placed.length, pedsAtCrossings: placed.filter((p) => p.node).length, stopPerKm: sumStop / Math.max(1e-6, sumKm), tripMean: mean(trips), tripP95: pct(trips, 0.95), trips: trips.length, km: sumKm, queuedAtRed: queuedShare / samples, stopped: stoppedShare / samples, pedWaitMean: mean(pedWaits), pedWaitP95: pct(pedWaits, 0.95), pedWaits: pedWaits.length, updateMs: updateMs / updates, reasons });
    updateMs = 0; updates = 0;
  }

  // --- B. A scripted car down a corridor: from junction A to junction B, straight on ---
  // The approach into the junction at (x, z) along (ux, uz): an edge from outside it whose end is nearest (signalised
  // ends first)
  function edgeInto(x, z, ux, uz) {
    let best = null, bd = Infinity;
    for (const e of T.network.edges) {
      if (e.dx * ux + e.dz * uz < 0.8 || e.len < 15) continue;
      const dTo = Math.hypot(e.to.x - x, e.to.z - z), dFrom = Math.hypot(e.from.x - x, e.from.z - z);
      if (dTo > 50 || dFrom < dTo + 10) continue;
      const score = dTo + (e.to.signal ? 0 : 30);
      if (score < bd) { bd = score; best = e; }
    }
    return best;
  }
  async function probe(route, seed) {
    Math.random = mulberry(seed);
    elapsed = 5000 + seed * 9.3;
    const { from, to, ux, uz } = route;
    const e0 = edgeInto(from[0], from[1], ux, uz);
    if (!e0) return log({ kind: 'probe', route: route.name, seed, error: 'no start edge' });
    aim(from[0] - ux * 60, from[1] - uz * 60);
    await run(20);
    const v = T.cars.find((c, i) => i % 5 === 2 && !c.isPolice) || T.cars[2];
    // place it like traffic.js place(): rightmost lane, 70 m before the start junction
    Object.assign(v, { edge: e0, lane: e0.lanes.length - 1, s: Math.max(v.half + 2, e0.len - 70), conn: null, trail: null, commit: null, yielding: false, wait: 0, speed: 8, acc: 0, dl: 0, dlv: 0, vx: 0, vz: 0, yawOffset: 0, yawVel: 0 });
    v.x = e0.sx + e0.dx * v.s; v.z = e0.sz + e0.dz * v.s;
    v.yaw = Math.atan2(e0.dx, e0.dz);
    const straight = (e) => e.moves.reduce((m, k) => (!m || k.to.dx * ux + k.to.dz * uz > m.to.dx * ux + m.to.dz * uz ? k : m), null);
    // straight on along the corridor, from a lane it can be made from (a lane change, like traffic.js changeLanes)
    const steer = () => {
      const e = v.edge;
      v.move = straight(e);
      if (!v.move || v.move.out[v.lane] >= 0) return;
      let best = -1;
      for (let i = 0; i < v.move.out.length; i++) if (v.move.out[i] >= 0 && (best < 0 || Math.abs(i - v.lane) < Math.abs(best - v.lane))) best = i;
      if (best < 0) return;
      v.dl += e.lanes[v.lane] - e.lanes[best];
      v.lane = best;
    };
    steer();
    const u = (x, z) => x * ux + z * uz;
    const lat = (x, z) => (x - from[0]) * -uz + (z - from[1]) * ux;
    const u0 = u(from[0], from[1]), u1 = u(to[0], to[1]);
    let tStart = null, tEnd = null, stops = 0, stopped = false, stopT = 0, off = false, lastEdge = v.edge;
    const limit = route.limit || 1500;
    for (let i = 0; i < limit / DT && tEnd === null; i++) {
      aim(v.x, v.z);
      step();
      if (v.edge !== lastEdge && v.edge) { lastEdge = v.edge; steer(); }
      if (route.trace && i % 150 === 0) log({ kind: 'trace', t: +(elapsed - 5000).toFixed(1), x: +v.x.toFixed(1), z: +v.z.toFixed(1), edge: v.edge && v.edge.id, s: v.edge && +v.s.toFixed(1), len: v.edge && +v.edge.len.toFixed(1), lane: v.lane, speed: +v.speed.toFixed(2), conn: !!v.conn, turn: v.move && v.move.turn, out: v.move && v.move.out[v.lane], gap: +(v.gap || 0).toFixed(1), wait: +(v.wait || 0).toFixed(1), sig: v.edge && v.edge.to.signal, ph: v.edge && stateOf(v.edge, elapsed), yielding: v.yielding, commit: !!v.commit });
      if (Math.abs(lat(v.x, v.z)) > 40) { off = true; log({ kind: 'off', route: route.name, x: v.x, z: v.z, edge: v.edge && [v.edge.dx, v.edge.dz], t: elapsed }); break; }
      const p = u(v.x, v.z);
      if (tStart === null && p >= u0) tStart = elapsed;
      if (tStart !== null) {
        if (v.speed < 0.3) { stopT += DT; if (!stopped) { stops++; stopped = true; } } else if (v.speed > 2) stopped = false;
        if (p >= u1) tEnd = elapsed;
      }
      if (i % 150 === 149) await yieldUI();
    }
    // (in the time allowed: how far it got along the route past the start, and its mean speed there)
    const made = Math.max(0, Math.min(Math.abs(u1 - u0), (u(v.x, v.z) - u0) * Math.sign(u1 - u0)));
    const timeOn = tStart !== null ? (tEnd !== null ? tEnd : elapsed) - tStart : 0;
    log({ kind: 'probe', route: route.name, seed, travel: tEnd !== null ? tEnd - tStart : null, stops, stopTime: stopT, off, km: Math.abs(u1 - u0) / 1000, madeKm: made / 1000, kmh: timeOn ? (made / timeOn) * 3.6 : 0 });
  }

  // --- C. The rider at a red: a player car standing at the stop line, how long until its light turns green ---
  async function rider(spot, trials, seed) {
    Math.random = mulberry(seed);
    elapsed = 7000 + seed * 3.1;
    const e = edgeInto(spot.x, spot.z, spot.ux, spot.uz);
    if (!e) return log({ kind: 'rider', spot: spot.name, error: 'no edge' });
    aim(spot.x, spot.z);
    await run(40);
    const lane = e.lanes[e.lanes.length - 1];
    const s = e.len - 3;
    const ent = { position: { x: e.sx + e.dx * s + e.rx * lane, y: 0.0, z: e.sz + e.dz * s + e.rz * lane }, heading: Math.atan2(e.dx, e.dz), speed: 0, vx: 0, vz: 0, type: 'car' };
    const waits = [];
    for (let k = 0; k < trials; k++) {
      // away for a while, then arrive at the line
      await run(5 + Math.random() * 60);
      if (stateOf(e, elapsed) === 'green') { k--; continue; } // arrived on a green: no wait
      let w = 0;
      while (stateOf(e, elapsed) !== 'green' && w < 180) {
        ent.position.x = e.sx + e.dx * s + e.rx * lane; ent.position.z = e.sz + e.dz * s + e.rz * lane;
        ent.speed = 0; ent.vx = ent.vz = 0;
        step(ent, 'car');
        w += DT;
      }
      waits.push(w);
      await yieldUI();
    }
    log({ kind: 'rider', spot: spot.name, seed, waits: waits.map((w) => +w.toFixed(1)), mean: mean(waits), max: Math.max(...waits) });
  }

  window.__trafficEdges = (pts) => {
    for (const [x, z] of pts) {
      const near = T.network.edges.filter((e) => Math.hypot(e.sx + e.dx * e.len - x, e.sz + e.dz * e.len - z) < 40).map((e) => ({ id: e.id, d: [+e.dx.toFixed(2), +e.dz.toFixed(2)], len: +e.len.toFixed(0), to: [Math.round(e.to.x), Math.round(e.to.z)], sig: e.to.signal, from: [Math.round(e.from.x), Math.round(e.from.z)] }));
      log({ kind: 'edges', at: [x, z], near });
    }
  };
  window.__trafficProbe = (r, seed) => { app.film.start(30); return probe(r, seed); };
  window.__trafficMeasure = async (opts = {}) => {
    const t0 = performance.now();
    app.film.start(30);
    app.cameraSystem.cinema = null;
    const spots = [
      { name: 'king-spadina', x: -1109, z: -350 },
      { name: 'yonge-dundas', x: 330, z: -1150 },
      { name: 'bay-college', x: 86, z: -1772 },
      { name: 'strachan-lakeshore', x: -2525, z: 470 }
    ];
    const seeds = opts.seeds || [1, 2];
    if (opts.fleet !== false) for (const seed of seeds) for (const sp of spots) await fleet(sp, seed, opts.seconds || 240);
    const routes = [
      { name: 'king-east', from: [-1751, -361], to: [836, -349], ux: 1, uz: 0 },
      { name: 'king-west', from: [836, -349], to: [-1751, -361], ux: -1, uz: 0 },
      { name: 'bay-north', from: [137, -41], to: [88, -2805], ux: -0.0177, uz: -0.9998 },
      { name: 'bay-south', from: [88, -2805], to: [137, -41], ux: 0.0177, uz: 0.9998 }
    ];
    if (opts.probe !== false) for (const r of routes) for (const seed of opts.probeSeeds || [11, 12, 13, 14]) await probe(r, seed);
    const riders = [
      { name: 'strachan-sb-at-lakeshore', x: -2522, z: 482, ux: 0, uz: 1 },
      { name: 'strachan-nb-at-manitoba', x: -2531, z: 295, ux: 0, uz: -1 },
      { name: 'lakeshore-eb-at-strachan', x: -2522, z: 482, ux: 1, uz: 0 }
    ];
    if (opts.rider !== false) for (const seed of opts.riderSeeds || [21]) for (const r of riders) await rider(r, opts.trials || 8, seed);
    log({ kind: 'done', wallSeconds: (performance.now() - t0) / 1000 });
    app.film.stop();
  };
})();
