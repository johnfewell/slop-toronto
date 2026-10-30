// Browser integration fixtures, loaded only by tools/capture.mjs CAPTURE_INIT_SCRIPT.
// Live feeds are controlled; actors, controllers, rides, cameras and the render loop are the real app.
(() => {
  const pending = { transit: [], bikes: [] }, actualFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const kind = url.pathname.endsWith('/live/vehicles') ? 'transit' : url.pathname.includes('/station_status') ? 'bikes' : null;
    return kind ? new Promise((resolve) => pending[kind].push(resolve)) : actualFetch(input, options);
  };
  const complete = (kind, data) => {
    if (!pending[kind].length) throw new Error(`No pending ${kind} fixture`);
    pending[kind].shift()(new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }));
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const pose = (a) => JSON.stringify({ player: a.controllerManager.getActiveEntity().position.toArray(),
    traffic: a.trafficSystem.cars.map((v) => [v.x, v.y, v.z, v.speed, v.acc]),
    trams: a.streetcars.cars.map((v) => [v.id, v.s, v.speed, v.dwell, v.doorState]),
    subway: a.subwayRide.cars.map((v) => [v.id, v.s, v.speed, v.dwell, v.doorState]) });
  const projection = (a) => {
    const c = a.cameraSystem.camera;
    return JSON.stringify([c.layers.mask, c.near, c.far, c.fov, a.cameraSystem.activePresetId]);
  };
  function finiteActors(a) {
    for (const v of a.trafficSystem.cars) for (const k of ['x', 'z', 'speed', 'acc']) if (v[k] !== undefined) check(Number.isFinite(v[k]), `Nonfinite traffic ${k}`);
    for (const v of a.streetcars.cars) check([v.s, v.speed].every(Number.isFinite), 'Nonfinite tram');
    for (const v of Object.values(a.controllerManager.entities)) check(v.position.toArray().every(Number.isFinite), 'Nonfinite player');
  }
  window.__testExperience = async (kind) => {
    const a = window.__CITY_APP, C = window.CITY;
    if (kind === 'walk') {
      a.selectMode('person'); a.selectCamera('chase', true); await wait(350);
      const beforeProjection = projection(a), originalTime = a.lightingSystem.activePresetId;
      const lease = a.openOverlay('photo', { hold: true }); check(lease, 'Could not acquire free photo hold');
      const before = pose(a), clocks = a.clockState();
      check(a.film.start() === false, 'Film stole photo frame stepping');
      check(a.openOverlay('album') === false && a.experience.reserve('taxi') === false, 'Second owner acquired');
      a.mapSystem.toggleFullMap(true); check(!a.mapSystem.isFullMapOpen, 'Map opened over photo');
      let writes = 0, publishes = 0;
      const oldHour = a.trafficSystem.setHour, oldTime = C.TRANSIT.setTime;
      a.trafficSystem.setHour = (...args) => { writes++; return oldHour.apply(a.trafficSystem, args); };
      C.TRANSIT.setTime = (...args) => { writes++; return oldTime.apply(C.TRANSIT, args); };
      C.TRANSIT.onLive(() => publishes++);
      a.selectTime('midnight');
      complete('transit', { t: Date.now() / 1000, v: [] });
      const station = C.bikeShareStations[0];
      complete('bikes', { last_updated: Date.now() / 1000, data: { stations: [{ station_id: String(station.id), is_installed: 1,
        last_reported: Date.now() / 1000, num_bikes_available: 1, num_bikes_disabled: 0 }] } });
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      a.controllerManager.setTouchInput('forward', 1); a.controllerManager.setGamepadInput('right', 1);
      await wait(10000);
      check(pose(a) === before, 'An actor moved during the ten-second hold');
      check(a.clockState().simulation === clocks.simulation && a.clockState().shader === clocks.shader && a.clockState().cloud === clocks.cloud, 'Physical clock advanced during hold');
      check(C.TRANSIT.live.polls > 0 && publishes === 0, 'Live response applied during hold');
      check(C.bikeShareStats.cachedAt && !C.bikeShareStats.live, 'Bike counts applied during hold');
      check(Object.values(a.controllerManager.keys).every((v) => !v), 'Movement leaked through overlay');
      check(writes === 0, 'Visual time respawned service');
      lease.release(); check(!lease.release(), 'Overlay released twice');
      await wait(200); finiteActors(a);
      check(publishes === 1 && C.bikeShareStats.liveStations === 1, 'Newest cached response not applied after hold');
      check(a.clockState().simulation - clocks.simulation < 0.5 && a.clockState().shader - clocks.shader < 0.5, 'Resume caught up paused time');
      check(a.lightingSystem.activePresetId === originalTime && projection(a) === beforeProjection, 'Free view/environment not restored');
      check(writes === 0, 'Restore changed service time');
      a.trafficSystem.setHour = oldHour; C.TRANSIT.setTime = oldTime;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    } else if (kind === 'streetcar' || kind === 'subway') {
      check(a.rideFeatured(kind === 'streetcar' ? '504' : 'subway'), `Could not board ${kind}`);
      await wait(400);
      const ride = kind === 'streetcar' ? a.streetcarRide : a.subwayRide, car = ride.car;
      const camera = a.cameraSystem.camera, beforeProjection = projection(a), baseline = a.resourceSnapshot();
      for (let i = 0; i < 20; i++) {
        const lease = a.openOverlay('photo', { hold: true }); check(lease, 'Seat photo busy after transition');
        const before = pose(a);
        camera.layers.set(0); camera.near = 0.35; camera.fov = 44; camera.far = 60000; camera.updateProjectionMatrix();
        if (i === 0) await wait(kind === 'streetcar' ? 6000 : 1500);
        check(pose(a) === before, 'Occupied scene changed while framing');
        if (kind === 'streetcar' && i === 0) {
          const data = JSON.parse(localStorage.getItem('toronto-player-state')), anchor = a.experience.savedGround(data.activeMode);
          check(data && anchor && Math.hypot(data.entities[data.activeMode].x - anchor.x, data.entities[data.activeMode].z - anchor.z) < 0.1, 'Reload saved a seat coordinate');
          sessionStorage.setItem('test-saved-ground', JSON.stringify(data));
        }
        lease.release();
        check(projection(a) === beforeProjection && ride.active && ride.car === car && a.controllerManager.suspended, 'Seat camera/activity not restored');
      }
      check(a.resourceSnapshot().owned.liveCount === baseline.owned.liveCount, 'Overlay resources leaked'); finiteActors(a);
      if (kind === 'subway') {
        check(a.film.start(10), 'Film could not acquire after photo');
        try {
          for (let i = 0; i < 4000 && !(car.stopIndex === 1 && car.doorState === 'open'); i++) ride.service.update(0.1);
          ride.update(0.016);
          check(ride.exit(), 'Subway alighting failed');
          check(!ride.active && ride.inside && a.experience.owner === 'subway', 'Alighting released station ownership');
          check(a.experience.reserve('taxi') === false, 'Station admitted a competing owner');
        } finally { a.film.stop(); }
      }
      a.selectMode('person');
      check(!a.experience.owner && !a.controllerManager.suspended && !a.subwayRide.inside && a.cameraSystem.camera.layers.mask === 1, 'Surface cleanup failed');
      finiteActors(a);
    } else if (kind === 'panels') {
      await wait(350);
      a.mapSystem.toggleFullMap(true); check(C.uiOverlay === 'map', 'Map missing central overlay gate');
      a.controllerManager.setTouchInput('forward', 1); check(!a.controllerManager.keys.forward, 'Map leaked movement');
      a.mapSystem.toggleFullMap(false); check(!C.uiOverlay, 'Map left ownership behind');
      document.getElementById('btn-help').click(); check(C.uiOverlay === 'help', 'Help missing central gate');
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })); check(!C.uiOverlay, 'Help Escape left gate');
    } else if (kind === 'reload') {
      const saved = JSON.parse(sessionStorage.getItem('test-saved-ground'));
      check(saved && !a.experience.owner && !a.subwayRide.inside && !a.controllerManager.suspended, 'Reload restored an active ride');
      const ent = a.controllerManager.getActiveEntity();
      check(Math.abs(ent.position.y - a.controllerManager.getGroundHeight(ent.position.x, ent.position.z, a.controllerManager.activeMode)) < 0.2, 'Reload did not land on ground');
      finiteActors(a);
    }
    console.log(`[ride-check] experience ${kind} passed`);
  };
})();
