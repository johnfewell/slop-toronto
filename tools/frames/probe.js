// tools/frames/probe.js — one shot's record for tools/shots/map-scale.json (docs/map-scale-measurements.md), run by
// tools/capture.mjs as a shot's `js`: over 90 rendered frames, the triangles and draw calls each frame submits (summed
// over every draw between two animation frames, the view and the shadow passes apart: the renderer's own
// info.render.triangles is reset per render call, so a single read can be 0 or one pass), the CPU of the
// simulation's systems (their update calls, timed), the actors' counts, the JS heap and the renderer's memory counts.
// (tools/frames/make-shots.mjs inlines it into the shot list.)
(() => new Promise((resolve) => {
  const app = window.__CITY_APP, r = app.renderer, b = r.backend, view = app.cameraSystem.camera;
  const per = { tris: 0, draws: 0, viewTris: 0, viewDraws: 0 }, frames = [], infoTris = [];
  const orig = b.draw;
  b.draw = function (ro, info) {
    const before = info.render.triangles;
    const res = orig.apply(this, arguments);
    const d = info.render.triangles - before;
    per.tris += d; per.draws++;
    if (ro.camera === view) { per.viewTris += d; per.viewDraws++; }
    return res;
  };
  const systems = { traffic: app.trafficSystem, highway: app.highwayTraffic, streetcars: app.streetcars, buses: app.transitBuses,
    rail: app.railCorridor, subway: app.subway };
  const cpu = {}, restore = [];
  for (const [k, s] of Object.entries(systems)) {
    if (!s || typeof s.update !== 'function') continue;
    const f = s.update;
    cpu[k] = 0;
    s.update = function () { const t = performance.now(); try { return f.apply(this, arguments); } finally { cpu[k] += performance.now() - t; } };
    restore.push(() => { s.update = f; });
  }
  const N = 90;
  let n = 0;
  const t0 = performance.now();
  const tick = () => {
    infoTris.push(r.info.render.triangles);
    if (n > 0) frames.push({ ...per });
    per.tris = per.draws = per.viewTris = per.viewDraws = 0;
    if (++n <= N) return requestAnimationFrame(tick);
    const ms = performance.now() - t0;
    b.draw = orig;
    for (const f of restore) f();
    const med = (k) => { const v = frames.map((f) => f[k]).sort((p, q) => p - q); return v[Math.floor(v.length / 2)]; };
    const max = (k) => Math.max(...frames.map((f) => f[k]));
    const e = app.controllerManager.getActiveEntity().position;
    const t = app.trafficSystem;
    const mem = r.info.memory;
    resolve({
      q: location.search, frames: frames.length, wallMs: Math.round(ms),
      player: { x: Math.round(e.x), y: Math.round(e.y), z: Math.round(e.z), mode: app.controllerManager.activeMode },
      triangles: { median: med('tris'), max: max('tris'), viewMedian: med('viewTris'), viewMax: max('viewTris') },
      drawCalls: { median: med('draws'), max: max('draws'), viewMedian: med('viewDraws') },
      infoTrianglesAtRaf: { median: infoTris.slice().sort((p, q) => p - q)[infoTris.length >> 1], max: Math.max(...infoTris) },
      systemCpuMsPerFrame: Object.fromEntries(Object.entries(cpu).map(([k, v]) => [k, +(v / frames.length).toFixed(3)])),
      counts: { cars: t?.cars?.length, buses: t?.buses?.length, peds: t?.peds?.length, carTarget: t?.carTarget, pedTarget: t?.pedTarget,
        highwayCars: app.highwayTraffic?.cars?.length, streetcars: app.streetcars?.cars?.length, streetcarRoutes: app.streetcars?.routes?.length,
        busRoutes: app.transitBuses?.routes?.length, sceneChildren: app.scene.children.length },
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      heapLimitMB: performance.memory ? Math.round(performance.memory.jsHeapSizeLimit / 1048576) : null,
      renderer: { geometries: mem.geometries, textures: mem.textures, ...Object.fromEntries(Object.entries(mem).filter(([k, v]) => typeof v === 'number' && /bytes|Bytes|total|Total|attributes|Attributes|storage/i.test(k))) },
      readyAtMs: window.__mapScaleReadyAt ?? null, geoFrame: window.CITY.GEO.frame.detail, nav: (() => {
        const n = performance.getEntriesByType('navigation')[0];
        const res = performance.getEntriesByType('resource').filter((x) => /geodata|sidewalks|traffic-data|transit\.|frames\//.test(x.name))
          .map((x) => ({ name: x.name.split('/').slice(-2).join('/').split('?')[0], transfer: x.transferSize, decoded: x.decodedBodySize, ms: Math.round(x.duration) }));
        const decode = performance.getEntriesByName('geodata-decode')[0];
        const all = performance.getEntriesByType('resource').filter((x) => x.name.startsWith(location.origin));
        return { domContentLoaded: n && Math.round(n.domContentLoadedEventEnd), load: n && Math.round(n.loadEventEnd), res,
          sameOriginResources: all.length, sameOriginDecodedMB: +(all.reduce((s, x) => s + (x.decodedBodySize || 0), 0) / 1048576).toFixed(1),
          geodataDecodeMs: decode ? Math.round(decode.duration) : null };
      })()
    });
  };
  requestAnimationFrame(tick);
}))()
