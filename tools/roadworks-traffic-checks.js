// tools/roadworks-traffic-checks.js: the hours, the buses and the search for the road works, run inside the page by a capture
// shot (tools/shots/roadworks-traffic.json), after the road works are drawn. Logs `[rwcheck] {json}` lines.
(() => {
  const C = window.CITY, app = window.__CITY_APP, T = app.trafficSystem, L = C.roadworksLive;
  const log = (o) => console.log('[rwcheck] ' + JSON.stringify(o));
  // how many instances of the road works are drawn (a hidden one has no height), by kind
  const drawn = () => {
    const out = {};
    app.scene.traverse((o) => {
      if (!o.isInstancedMesh || !/^Roadworks_/.test(o.name)) return;
      const k = o.name.slice(10), arr = o.instanceMatrix.array;
      let n = 0;
      for (let j = 0; j < o.count; j++) if (arr[16 * j + 5] !== 0) n++;
      out[k] = (out[k] || 0) + n;
    });
    return out;
  };
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const edgesClosed = () => T.network.edges.filter((e) => e.worksClosed).length;
  const zonesOn = () => T.network.edges.reduce((n, e) => n + (e.laneZones ? e.laneZones.length : 0), 0);
  window.__roadworksChecks = async () => {
    // the hours: the scene clock decides which records show (the day's own: 25 November 2026, a Wednesday)
    const hours = [];
    for (const h of [12, 3, 20, 7.5, 18.9, 19.1, 12]) {
      L.setHour(h);
      const d = drawn();
      hours.push({ hour: h, ms: C.roadworksStats.trafficMs, active: C.roadworksStats.activeAtHour, pieces: sum(d), barrels: d.barrel || 0, edgesClosed: edgesClosed(), laneZones: zonesOn() });
    }
    log({ kind: 'hours', placed: C.roadworksStats.placed, hours });
    // the buses: routes taken round the closed roads (transit-buses.js), at noon and with the works off (3 a.m.)
    const B = app.transitBuses || null;
    if (B && B.detours) {
      L.setHour(12); const noon = { ...B.detours, edges: edgesClosed() };
      L.setHour(3); const night = { ...B.detours, edges: edgesClosed() };
      L.setHour(12);
      // a route through a closed link: how its links changed
      const changed = B.routes.filter((r) => r.links !== r.base.links).map((r) => `${r.sign[0]} ${r.base.links.length}->${r.links.length}`);
      log({ kind: 'buses', noon, night, changedRoutes: changed.length, sample: changed.slice(0, 8) });
    } else log({ kind: 'buses', missing: true });
    // the search
    const N = C.Navigation;
    for (const q of ['lane closure', 'road closed', 'bloor st w', 'closure dufferin']) {
      const r = N.searchPlaces(q, { limit: 6 });
      log({ kind: 'search', q, results: r.map((x) => `${x.kind}/${x.cat || ''}: ${x.name} — ${x.sub}`) });
    }
  };
})();
