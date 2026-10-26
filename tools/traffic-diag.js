// tools/traffic-diag.js: where the waiting is (tools/shots/traffic-why-detail.json): after `seconds` headless at a spot,
// the stuck queue heads, what stands beyond them, and why that waits
(() => {
  const app = window.__CITY_APP, T = app.trafficSystem, THREE = window.CITY.THREE;
  window.__trafficDiag = async ({ x, z, seconds = 120, n = 20 }) => {
    app.film.start(30);
    app.cameraSystem.cinema = null;
    const cam = app.cameraSystem.camera, focus = new THREE.Vector3(x, 60, z);
    cam.position.set(x, 60, z + 40); cam.lookAt(x, 0, z); cam.updateMatrixWorld();
    let el = 9000;
    for (let i = 0; i < seconds * 30; i++) { el += 1 / 30; T.update(1 / 30, el, focus, null, 'helicopter', cam); if (i % 300 === 0) await new Promise((r) => setTimeout(r, 0)); }
    const out = [];
    for (const v of [...T.cars, ...T.buses]) {
      if (!v.edge || v.speed > 0.3 || v.gap < 6 || v.conn) continue;
      const w = T.whyWaiting(v);
      if (!w.startsWith('no-room') && w !== 'give-way' && w !== 'box-busy') continue;
      const e = v.edge, m = v.move, f = m.to, j = m.out[v.lane];
      const lead = f.occ[j] && f.occ[j].filter((o) => o.s < f.len).slice(-1)[0];
      out.push({ w, at: [Math.round(v.x), Math.round(v.z)], wait: +v.wait.toFixed(0), node: { sig: e.to.signal, groups: e.to.groupCount, myGroup: e.axisIndex, general: !!e.to.general, shape: !!e.to.shape, in: e.to.in.length, out: e.to.out.length }, turn: m.turn,
        f: { len: +f.len.toFixed(1), lanes: f.lanes.length, toSig: f.to.signal, toGroups: f.to.groupCount, fGroup: f.axisIndex, cars: f.occ[j].length, end: [Math.round(f.sx + f.dx * f.len), Math.round(f.sz + f.dz * f.len)] },
        beyond: lead ? { why: T.whyWaiting(lead.v), speed: +lead.v.speed.toFixed(1), wait: +lead.v.wait.toFixed(0) } : null });
    }
    out.sort((a, b) => b.wait - a.wait);
    for (const o of out.slice(0, n)) console.log('[diag] ' + JSON.stringify(o));
    console.log('[diag] {"done":' + out.length + '}');
    app.film.stop();
  };
})();
