// tools/signals-pictures.js: composed stills of the signals, crossings & street life (tools/shots/signals-pictures.json)
// window.__sigPic(opts): the camera at opts.pos looking at opts.look; the simulation stepped (film mode, frozen after)
// until the moment wanted: `walk` (the given junction's people on the WALK with at least `minOn` of them out on its
// crosswalks), `pxo` (someone on the given crossover), or just `settle` seconds. Logs `[pic] {json}` with what is in view.
(() => {
  const app = window.__CITY_APP, C = window.CITY, S = C.SIGNALS;
  const T = app.trafficSystem;
  const near = (x, z, r) => (o) => Math.hypot(o.x - x, o.z - z) < r;
  window.__sigPic = async (o) => {
    const { pos, look, fov = 45, settle = 12, maxS = 160, minOn = 3, hud = false, fps = 15 } = o;
    if (app.film.active) app.film.stop();
    if (!hud && !document.body.classList.contains('hud-minimized')) document.getElementById('btn-toggle-hud')?.click();
    // (a clean frame: not even the toggle)
    if (!hud && !document.getElementById('sigpic-clean')) {
      const st = document.createElement('style');
      st.id = 'sigpic-clean';
      st.textContent = '#btn-toggle-hud, .toolbar { visibility: hidden !important; }';
      document.head.appendChild(st);
    }
    if (o.teleport) app.teleportTo(o.teleport[0], o.teleport[1], o.teleport[2] ?? 0);
    app.cameraSystem.cinema = () => ({ pos, look, fov });
    app.film.start(fps);
    for (let i = 0; i < settle * fps; i += 10) await app.film.step(10);
    let j = -1, pxo = null;
    if (o.junction) j = S.junctions.findIndex((q) => q.name === o.junction);
    if (o.pxo) pxo = T.network.midCrossings.find((c) => c.kind === 'pxo' && C.PXOS[c.i].name === o.pxo);
    // (o.nearCam: only those within that many metres of the camera, the crossing in the foreground)
    const onCrossing = () => T.peds.filter((p) => p.placed && p.node && p.node.sigJ === j && p.t > 2.4 && p.t < p.len - 2.4 && (!o.nearCam || Math.hypot(p.x - pos[0], p.z - pos[2]) < o.nearCam)).length;
    let waited = 0, ok = !(o.junction || o.pxo);
    for (; !ok && waited < maxS * fps; waited++) {
      await app.film.step(1);
      if (j >= 0) ok = onCrossing() >= minOn;
      // (o.noStreetcarNear: and no streetcar within that many metres of the point looked at)
      if (ok && o.noStreetcarNear && app.streetcars) {
        const tmp = { x: 0, z: 0, y: 0, yaw: 0 };
        ok = !app.streetcars.cars.some((c) => {
          if (!c.track) return false;
          app.streetcars.sample(c.track, c.s, tmp);
          return Math.hypot(tmp.x - o.noStreetcarNear[0], tmp.z - o.noStreetcarNear[1]) < o.noStreetcarNear[2];
        });
      }
      if (pxo) ok = pxo.on > 0 && (!o.minOn || pxo.on >= o.minOn);
    }
    // (a moment more, so whoever stepped off is out on it)
    if (ok && o.after) for (let i = 0; i < o.after * fps; i++) await app.film.step(1);
    // framing on the crossing itself: behind one of its kerb ends, beside it along the road, looking over it
    if (ok && o.frame) {
      let track = null;
      if (pxo) track = T.pedRoutes.acrossMid(pxo).slice().sort((a, b) => T.peds.filter((p) => p.route === b).length - T.peds.filter((p) => p.route === a).length)[0];
      else {
        const counts = new Map();
        for (const p of T.peds) if (p.placed && p.node && p.node.sigJ === j) counts.set(p.route, (counts.get(p.route) || 0) + 1);
        track = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      }
      if (track) {
        const { back = 7, side = 4, h = 2, lookY = 1.5, end = 0 } = o.frame;
        const ux = track.ux * (end ? -1 : 1), uz = track.uz * (end ? -1 : 1);
        const ax = end ? track.ax + track.ux * track.len : track.ax, az = end ? track.az + track.uz * track.len : track.az;
        const mx = track.ax + track.ux * track.len / 2, mz = track.az + track.uz * track.len / 2;
        const sx = -uz, sz = ux;
        const P = [ax - ux * back + sx * side, h, az - uz * back + sz * side], L = [mx, lookY, mz];
        app.cameraSystem.cinema = () => ({ pos: P, look: L, fov });
        await app.film.step(1);
        await app.film.step(1);
      }
    }
    const inView = { cars: T.cars.filter((c) => c.edge && near(look[0], look[2], 90)(c)).length, peds: T.peds.filter((p) => p.placed && near(look[0], look[2], 90)(p)).length };
    console.log('[pic] ' + JSON.stringify({ name: o.name, found: ok, waitedS: +(waited / fps).toFixed(1), onCrossing: j >= 0 ? onCrossing() : undefined, pxoOn: pxo ? pxo.on : undefined, pxoActive: pxo ? pxo.active : undefined, carTarget: T.carTarget, pedTarget: T.pedTarget, ...inView }));
  };
})();
