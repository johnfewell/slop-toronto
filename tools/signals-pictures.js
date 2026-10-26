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
    const btn = document.getElementById('btn-toggle-hud');
    if (btn) btn.style.visibility = hud ? '' : 'hidden'; // (a clean frame: not even the toggle)
    if (o.teleport) app.teleportTo(o.teleport[0], o.teleport[1], o.teleport[2] ?? 0);
    app.cameraSystem.cinema = () => ({ pos, look, fov });
    app.film.start(fps);
    for (let i = 0; i < settle * fps; i += 10) await app.film.step(10);
    let j = -1, pxo = null;
    if (o.junction) j = S.junctions.findIndex((q) => q.name === o.junction);
    if (o.pxo) pxo = T.network.midCrossings.find((c) => c.kind === 'pxo' && C.PXOS[c.i].name === o.pxo);
    const onCrossing = () => T.peds.filter((p) => p.placed && p.node && p.node.sigJ === j && p.t > 2.4 && p.t < p.len - 2.4).length;
    let waited = 0, ok = !(o.junction || o.pxo);
    for (; !ok && waited < maxS * fps; waited++) {
      await app.film.step(1);
      if (j >= 0) ok = onCrossing() >= minOn;
      if (pxo) ok = pxo.on > 0 && (!o.minOn || pxo.on >= o.minOn);
    }
    const inView = { cars: T.cars.filter((c) => c.edge && near(look[0], look[2], 90)(c)).length, peds: T.peds.filter((p) => p.placed && near(look[0], look[2], 90)(p)).length };
    console.log('[pic] ' + JSON.stringify({ name: o.name, found: ok, waitedS: +(waited / fps).toFixed(1), onCrossing: j >= 0 ? onCrossing() : undefined, pxoOn: pxo ? pxo.on : undefined, pxoActive: pxo ? pxo.active : undefined, carTarget: T.carTarget, pedTarget: T.pedTarget, ...inView }));
  };
})();
