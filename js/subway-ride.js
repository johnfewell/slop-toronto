(function () {
const { THREE, SUBWAY_VIADUCTS, GEO_SUBWAY, TRANSIT, buildSubwayRidePaths, createSubwayRideService,
  sampleSubwayRide, subwayRidePlatform, createSubwayCarGeometry, createSubwayCarMaterial } = window.CITY;
const { uniform, float, positionGeometry, normalGeometry, fract, abs, step, mix, color, max } = window.CITY.TSL;
const { mergeGeometries } = window.CITY.Addons;
const INTERIOR_LAYER = 2, DOORS = [-8.625, -2.875, 2.875, 8.625];
const FLOOR = 1.1, EYE_Z = 0.8;

function createSubwayRide({ scene, subway, controllerManager: controller, cameraSystem: camera,
  session, selectCamera, onChange = () => {}, canInteract = () => true }) {
  const api = { active: false, inside: false, entity: null, car: null, station: null, routes: [], cars: [],
    action, exit, featured, update, enterStation, changePlatform, savedGround, warmGraphics,
    get canChase() { return !!api.car && outside(api.car) && api.car.s - 141 > api.car.track.open0 && api.car.s < api.car.track.open1 - 25; },
    get hasEntranceCandidate() { return !!nearestEntrance; },
    get surfaceMode() { return visit?.mode; } };
  let visit = null, shown = '', ownedPrompt = false, nearestEntrance = null, fadeTimer = 0, fadeRelease = null;
  const names = ['Castle Frank', 'Broadview'];
  const stations = names.map((name, i) => {
    const raw = GEO_SUBWAY.stations.find((s) => s[2] === name);
    let entrances = subway.entrances.sites.filter((s) => s.name === name).slice(0, 1);
    if (!entrances.length) entrances = GEO_SUBWAY.entrances.filter((s) => s[2] === name).slice(0, 1)
      .map((s) => ({ name, x: s[0], z: s[1], pylon: { x: s[0], z: s[1] }, authored: true }));
    return raw && entrances.length ? { id: i === 0 ? 'castle-frank' : 'broadview', name, x: raw[0], z: raw[1], entrances } : null;
  });
  if (stations.some((s) => !s) || !SUBWAY_VIADUCTS.length) return Object.assign(api, {
    action: () => false, exit: () => false, featured: () => false, update() {}, warmGraphics() {} });
  const routes = buildSubwayRidePaths(stations, SUBWAY_VIADUCTS[0]);
  api.routes = routes;
  const patterns = routes.map((route) => TRANSIT.ofType(1).find((p) => p.route === '2' && p.dir === route.dir));
  const duration = (dir) => {
    const stops = patterns[dir]?.stops || [];
    const a = stops.find((s) => s.name.includes(routes[dir].origin.name));
    const b = stops.find((s) => s.name.includes(routes[dir].destination.name));
    return a && b && b.time > a.time ? b.time - a.time : 110;
  };
  const service = createSubwayRideService(routes, {
    headway: (dir) => Math.max(60, patterns[dir] ? TRANSIT.headway(patterns[dir]) : 150), duration,
    canRecycle: (train) => !visit || visit.station !== train.track.destination
  });
  api.cars = service.cars;
  api.service = service;
  // The persistent service replaces ambient analytic trains only on this viaduct.
  subway.passengerRoutes.add(0); subway.passengerRoutes.add(1);
  window.CITY.Audio?.addStreetcars(api);

  const $ = (id) => document.getElementById(id);
  const elHud = $('ride-hud'), elNum = $('ride-num'), elRoute = $('ride-route'), elNext = $('ride-next');
  const elNextLabel = $('ride-next-label'), elStatus = $('ride-status'), elCancel = $('ride-cancel');
  const elOther = $('subway-other-platform'), elPrompt = $('ride-prompt'), elPromptText = $('ride-prompt-text');
  const elFade = $('ride-fade');
  elStatus?.addEventListener('click', action);
  elPrompt?.addEventListener('click', action);
  elCancel?.addEventListener('click', () => { if (visit && canInteract()) exit({ cancel: true }); });
  elOther?.addEventListener('click', () => { if (!api.active && canInteract()) changePlatform(); });
  function fade() {
    elFade?.classList.add('show'); clearTimeout(fadeTimer);
    fadeRelease?.(); fadeRelease = session.beginTransition();
    fadeTimer = setTimeout(() => { elFade?.classList.remove('show'); fadeRelease?.(); fadeRelease = null; }, 220);
  }
  function prompt(text) {
    if (!text && !ownedPrompt) return;
    ownedPrompt = !!text;
    if (elPrompt) { elPrompt.hidden = !text; elPrompt.disabled = false; elPrompt.classList.remove('is-hint'); }
    if (elPromptText && text) elPromptText.textContent = text;
  }
  function layerTree(root, layer) { root.traverse((o) => o.layers.set(layer)); }
  function box(w, h, d, x, y, z, material, group) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); group.add(mesh); return mesh;
  }
  const signMaterials = new Map();
  function sign(text, width, height, background = '#1c2821') {
    const key = `${background}|${text}`;
    let material = signMaterials.get(key);
    if (!material) {
      const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = background; ctx.fillRect(0, 0, 1024, 128);
      ctx.fillStyle = '#ffffff'; ctx.font = '700 56px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 512, 64, 960);
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshBasicMaterial({ map }); signMaterials.set(key, material);
    }
    const group = new THREE.Group(), geometry = new THREE.PlaneGeometry(width, height);
    group.add(new THREE.Mesh(geometry, material));
    const back = new THREE.Mesh(geometry, material); back.rotation.y = Math.PI; back.position.z = -0.012; group.add(back);
    return group;
  }
  const tile = new THREE.MeshBasicNodeMaterial();
  tile.colorNode = mix(color(0xc5beaa), color(0x9b978b), max(step(0.965, fract(positionGeometry.z.mul(4))), step(0.965, fract(positionGeometry.y.mul(4)))));
  const floor = new THREE.MeshBasicMaterial({ color: 0x6c6c65 });
  const edge = new THREE.MeshBasicMaterial({ color: 0xe8c43b });
  const dark = new THREE.MeshBasicMaterial({ color: 0x161b1e });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9caaad, metalness: 0.65, roughness: 0.42 });
  const green = new THREE.MeshBasicMaterial({ color: 0x007f3e });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xe5f2ff });
  const stationGroups = stations.map((station, index) => {
    const frame = subwayRidePlatform(routes[0], index).centre;
    const group = new THREE.Group(); group.name = `SubwayPlatform_${station.id}`;
    group.position.set(frame.x + Math.cos(frame.yaw) * 2, routes[0].y, frame.z - Math.sin(frame.yaw) * 2);
    group.rotation.y = frame.yaw;
    box(15, 0.2, 170, 0, -0.2, 0, dark, group);
    for (const x of [-2.7475, -1.2525, 1.2525, 2.7475]) box(0.07, 0.12, 170, x, 0.06, 0, steel, group);
    for (const side of [-1, 1]) {
      box(3.6, FLOOR, 164, side * 5.4, FLOOR / 2, 0, floor, group);
      box(0.28, 0.025, 162, side * 3.76, FLOOR + 0.015, 0, edge, group);
      box(0.2, 3.9, 168, side * 7.3, FLOOR + 1.95, 0, tile, group);
      box(0.035, 0.32, 166, side * 7.18, FLOOR + 1.55, 0, green, group);
      for (let z = -72; z <= 72; z += 12) {
        box(0.035, 3.8, 0.035, side * 7.17, FLOOR + 1.9, z, floor, group);
        box(0.45, 0.07, 9, side * 5.2, FLOOR + 3.2, z, lamp, group);
        {
          const label = sign(station.name.toUpperCase(), 7, 0.55);
          label.position.set(side * 7.12, FLOOR + 2.25, z); label.rotation.y = -side * Math.PI / 2; group.add(label);
          box(0.7, 0.45, 2.3, side * 6.7, FLOOR + 0.225, z + 4, green, group);
        }
      }
      const label = sign(side < 0 ? index === 0 ? '2  EASTBOUND  →  BROADVIEW' : '2  EASTBOUND  ·  RIDE ENDS HERE' : index === 1 ? '2  WESTBOUND  →  CASTLE FRANK' : '2  WESTBOUND  ·  RIDE ENDS HERE', 9, 0.65);
      label.position.set(side * 5.3, FLOOR + 2.5, 58); group.add(label);
      const exitSign = sign('EXIT TO STREET  ↑', 3.4, 0.55, '#175d39');
      exitSign.position.set(side * 5.3, FLOOR + 2.5, 72); group.add(exitSign);
    }
    box(15, 0.15, 168, 0, FLOOR + 3.8, 0, tile, group);
    // A single bounded platform cell is revealed on entry, never floating above the outdoor city.
    layerTree(group, INTERIOR_LAYER); group.visible = false; scene.add(group);
    return group;
  });

  const tunnels = new THREE.Group(); tunnels.name = 'SubwayRideTunnels';
  const route = routes[0], tunnelParts = [];
  for (let i = 0; i + 1 < route.pts.length; i += 4) {
    const s = route.cum[i], next = Math.min(route.pts.length - 1, i + 4), end = route.cum[next];
    if (s > route.open0 && end < route.open1) continue;
    if (route.calls.some((call) => Math.abs((s + end) / 2 - (call - 70.5)) < 83)) continue;
    const a = route.pts[i], b = route.pts[next], yaw = Math.atan2(b.x - a.x, b.z - a.z), length = end - s + 0.12;
    // The eastbound track is 2 m to the right of the tunnel's centre.
    const x = (a.x + b.x) / 2 + Math.cos(yaw) * 2, z = (a.z + b.z) / 2 - Math.sin(yaw) * 2;
    for (const [w, h, across, y] of [[12, 0.15, 0, -0.3], [12, 0.15, 0, 4.8], [0.15, 5.1, -6, 2.25], [0.15, 5.1, 6, 2.25]]) {
      const geo = new THREE.BoxGeometry(w, h, length).translate(across, y, 0).rotateY(yaw).translate(x, route.y, z);
      tunnelParts.push(geo);
    }
  }
  if (tunnelParts.length) tunnels.add(new THREE.Mesh(mergeGeometries(tunnelParts), dark));
  layerTree(tunnels, INTERIOR_LAYER); scene.add(tunnels);
  const interiorLight = new THREE.HemisphereLight(0xe9f4ff, 0x454446, 2.3); interiorLight.layers.set(INTERIOR_LAYER); scene.add(interiorLight);

  function trainMeshes(train) {
    const group = new THREE.Group(); group.name = `RideableTrain_${train.id}`;
    const opened = uniform(0), bodies = [];
    for (let i = 0; i < 6; i++) {
      const material = createSubwayCarMaterial(i === 0 || i === 5);
      const dz = fract(positionGeometry.z.div(5.75)).sub(0.5).mul(5.75);
      const door = step(abs(dz), 0.8).mul(step(1.05, positionGeometry.y)).mul(step(positionGeometry.y, 3.1))
        .mul(step(0.6, normalGeometry.x.mul(i === 5 ? 1 : -1)));
      material.maskNode = float(1).sub(door.mul(opened)).greaterThan(0.99);
      const mesh = new THREE.Mesh(createSubwayCarGeometry(i === 0 || i === 5), material);
      mesh.layers.enable(INTERIOR_LAYER); mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh); bodies.push(mesh);
    }
    const leaves = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 2.05, 0.8), steel, 48);
    leaves.layers.enable(INTERIOR_LAYER); leaves.frustumCulled = false; group.add(leaves); scene.add(group);
    return { group, bodies, leaves, opened };
  }
  const models = service.cars.map(trainMeshes);
  const interior = new THREE.Group(); interior.name = 'SubwayPassengerInterior';
  const wall = new THREE.MeshStandardMaterial({ color: 0xdddcd3, emissive: 0x484742, roughness: 0.8 });
  const seat = new THREE.MeshStandardMaterial({ color: 0xa42128, emissive: 0x28090b, roughness: 0.9 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xdbb72b, emissive: 0x30260a });
  box(3, 0.12, 23, 0, FLOOR - 0.06, 0, floor, interior);
  box(3.05, 0.1, 23, 0, 3.3, 0, wall, interior);
  for (const side of [-1, 1]) {
    box(0.07, 0.43, 23, side * 1.5, 3.1, 0, wall, interior);
    for (const z of [-11.15, -5.75, 0, 5.75, 11.15]) {
      box(0.1, 1.8, 0.12, side * 1.48, 2.15, z, wall, interior);
      box(0.75, 0.13, 2.3, side * 1.05, FLOOR + 0.45, z, seat, interior);
      box(0.1, 0.6, 2.3, side * 1.4, FLOOR + 0.75, z, seat, interior);
      box(0.035, 1.8, 0.035, side * 0.58, FLOOR + 1.0, z + 1.0, yellow, interior);
    }
    for (const z of [-11.5, -10.25, -6.9, -4.6, -1.15, 1.15, 4.6, 6.9, 10.25, 11.5]) {
      // Lower side panels stop at the four working doors.
      if (Math.abs(z) < 11.4) box(0.07, 0.65, 0.65, side * 1.5, FLOOR + 0.325, z, wall, interior);
    }
    box(0.1, 0.025, 21, side * 0.8, 3.21, 0, lamp, interior);
  }
  for (const door of DOORS) box(0.06, 2.05, 1.6, 1.5, 2.075, door, steel, interior);
  box(3, 2.2, 0.1, 0, 2.2, 11.35, wall, interior);
  box(3, 2.2, 0.1, 0, 2.2, -11.35, wall, interior);
  interior.traverse((o) => { o.layers.enable(INTERIOR_LAYER); }); interior.visible = false; scene.add(interior);
  const entity = { type: 'subway', label: 'Subway', position: new THREE.Vector3(), heading: 0, speed: 0,
    chaseDistance: 15, chaseHeight: 2.7, chaseSide: 15, cameraTargetOffset: new THREE.Vector3(0, 1.8, 0),
    seatEye: new THREE.Vector3(), seatYaw: 0, seatLookY: 0 };
  api.entity = entity;
  const dummy = new THREE.Object3D(), point = new THREE.Vector3(), doorMatrix = new THREE.Matrix4();
  function outside(train) { const s = train.sections[0].s + EYE_Z; return s > train.track.open0 && s < train.track.open1; }

  function surfaceAnchor(station) {
    const previousMode = controller.activeMode, previousSpace = controller.interiorSpace;
    controller.activeMode = 'person'; controller.interiorSpace = null;
    try {
      for (const entrance of station.entrances) {
        const p = entrance.pylon || entrance;
        for (const distance of [2, 3, 4, 5, 6, 8, 10, 14, 20]) for (let i = 0; i < 12; i++) {
          const x = p.x + Math.cos(i * Math.PI / 6) * distance, z = p.z + Math.sin(i * Math.PI / 6) * distance;
          if (controller.isPointOnSidewalk(x, z) && controller.findTeleportPosition(x, z, 0, 0, true))
            return { x, y: controller.getGroundHeight(x, z, 'person'), z, heading: 0 };
        }
      }
    } finally { controller.activeMode = previousMode; controller.interiorSpace = previousSpace; }
    return null;
  }
  for (const station of stations) {
    station.anchor = surfaceAnchor(station);
    if (station.anchor && station.entrances[0].authored) {
      const group = new THREE.Group(); group.name = `SubwayRideEntrance_${station.id}`;
      const at = station.anchor, entrance = station.entrances[0];
      entrance.pylon = { x: at.x, z: at.z + 1.3 };
      box(0.12, 3.1, 0.12, entrance.pylon.x, at.y + 1.55, entrance.pylon.z, steel, group);
      const label = sign(`2  ${station.name.toUpperCase()} STATION`, 3.2, 0.55);
      label.position.set(entrance.pylon.x, at.y + 2.65, entrance.pylon.z); group.add(label); scene.add(group);
      controller.colliders.push({ minX: entrance.pylon.x - 0.15, maxX: entrance.pylon.x + 0.15,
        minZ: entrance.pylon.z - 0.15, maxZ: entrance.pylon.z + 0.15, maxY: at.y + 3.1 });
      controller._colliderCells = null;
    }
  }
  api.stations = stations;
  function savedGround(mode) {
    return visit && (mode === 'person' || mode === visit.mode) ? { ...visit.station.anchor } : null;
  }
  function setPlatform(station, dir) {
    visit.station = station; visit.dir = dir;
    api.station = station;
    const index = routes[dir].origin === station ? 0 : 1;
    const platform = subwayRidePlatform(routes[dir], index);
    visit.platform = platform;
    controller.interiorSpace = platform;
    controller.setMode('person');
    controller.teleportActiveTo(platform.landing.x, platform.landing.z, platform.centre.yaw + Math.PI / 2);
    camera.camera.layers.set(INTERIOR_LAYER); camera.followOverride = null;
    camera.resetForTeleport(); selectCamera('pov', true);
    stationGroups.forEach((g, i) => { g.visible = stations[i] === station; });
    shown = ''; prompt(null);
  }
  function enterStation(id, dir = null) {
    if (!canInteract() || api.inside || session.owner) return false;
    const station = stations.find((s) => s.id === id || s.name === id);
    if (!station?.anchor || !['person', 'cyclist'].includes(controller.activeMode)) return false;
    const reservation = session.reserve('subway', { savedGround, surfaceMode: controller.activeMode,
      onCancel: () => exit({ cancel: true }) });
    if (!reservation) return false;
    const player = controller.entities.person;
    visit = { station, dir: dir ?? stations.indexOf(station), mode: controller.activeMode,
      cameraMask: camera.camera.layers.mask, cameraPreset: camera.activePresetId,
      personLayers: [], reservation, cameraState: window.CITY.snapshotExperienceCamera(camera) };
    player.mesh.traverse((o) => { visit.personLayers.push([o, o.layers.mask]); o.layers.enable(INTERIOR_LAYER); });
    api.inside = true;
    setPlatform(station, visit.dir);
    onChange(true); fade(); return true;
  }
  function changePlatform() {
    if (!visit || api.active || !canInteract()) return false;
    setPlatform(visit.station, 1 - visit.dir); onChange(true); fade(); return true;
  }
  function boardable() {
    if (!visit || api.active) return null;
    const train = service.cars[visit.dir];
    if (train.track.origin !== visit.station || train.stopIndex !== 0 || train.speed > 0.1 || train.doorState !== 'open') return null;
    const p = controller.getActiveEntity().position, q = visit.platform.landing;
    return Math.hypot(p.x - q.x, p.z - q.z) < 4 && Math.abs(p.y - q.y) < 0.1 ? train : null;
  }
  function board(train) {
    if (!train || boardable() !== train || session.active) return false;
    placeRider(train);
    if (!session.begin(train, entity, () => { train.ridden = false; })) return false;
    api.active = true; api.car = train; train.ridden = true;
    camera.camera.near = 0.12; camera.camera.updateProjectionMatrix(); train.hold = Math.max(3, train.hold || 0);
    controller.interiorSpace = null;
    prompt(null); shown = ''; onChange(true); selectCamera('pov', true); fade(); return true;
  }
  function leaveStation() {
    if (!visit) return false;
    const saved = visit, target = saved.station.anchor;
    if (session.overlay) return false;
    const previousSpace = controller.interiorSpace;
    controller.interiorSpace = null;
    const safe = controller.findTeleportPosition(target.x, target.z, target.heading, target.y || 0, true);
    controller.interiorSpace = previousSpace;
    if (!safe) return false;
    if (api.active) {
      controller.interiorSpace = saved.platform;
      if (!session.end()) { controller.interiorSpace = previousSpace; return false; }
    }
    controller.interiorSpace = null;
    api.active = false; api.car = null; api.inside = false; api.station = null;
    controller.interiorSpace = null;
    for (const [object, mask] of saved.personLayers) object.layers.mask = mask;
    controller.setMode('person'); controller.teleportActiveTo(target.x, target.z, target.heading);
    controller.setMode(saved.mode); controller.teleportActiveTo(target.x, target.z, target.heading);
    camera.camera.layers.mask = saved.cameraMask; camera.followOverride = null;
    camera.resetForTeleport(); selectCamera(saved.cameraPreset, true);
    window.CITY.restoreExperienceCamera(camera, saved.cameraState);
    stationGroups.forEach((g) => { g.visible = false; }); interior.visible = false;
    saved.reservation.release(); visit = null; prompt(null); shown = '';
    if (elHud) elHud.hidden = true;
    if (elOther) elOther.hidden = true;
    if (elCancel) elCancel.textContent = 'Return to where I boarded';
    onChange(false); fade(); return true;
  }
  function exit({ cancel = false } = {}) {
    if (!visit) return false;
    if (cancel || !api.active) return leaveStation();
    const train = api.car;
    if (train.speed > 0.1 || train.doorState !== 'open' || train.stopIndex !== 1) return false;
    const platform = subwayRidePlatform(train.track, 1);
    controller.interiorSpace = platform;
    if (!session.end(platform.landing)) { controller.interiorSpace = null; return false; }
    api.active = false; api.car = null;
    setPlatform(train.track.destination, train.track.dir);
    interior.visible = false; onChange(true); fade(); return true;
  }
  function action() {
    if (!canInteract() || (session.active && !api.active)) return false;
    if (api.active) { exit(); return true; }
    if (visit) { const train = boardable(); if (train) board(train); return true; }
    if (nearestEntrance) return enterStation(nearestEntrance.id);
    return false;
  }
  function featured(id = 'castle-frank') {
    if (visit) leaveStation();
    if (session.active || !canInteract()) return false;
    if (!['person', 'cyclist'].includes(controller.activeMode)) controller.setMode('person');
    const index = id === 'broadview' ? 1 : 0;
    const train = service.prepare(index);
    if (!train || !enterStation(stations[index].id, index)) return false;
    train.doorState = 'open'; train.doorProgress = 1;
    return board(train);
  }
  function placeRider(train) {
    const front = train.sections[0];
    entity.position.set(front.x, front.y, front.z); entity.heading = front.yaw; entity.speed = train.speed;
    dummy.position.set(front.x, front.y, front.z); dummy.rotation.set(0, front.yaw, 0); dummy.updateMatrix();
    entity.seatEye.set(-0.72, FLOOR + 1.3, EYE_Z).applyMatrix4(dummy.matrix);
    entity.seatYaw = front.yaw - Math.PI * 0.35;
    interior.position.copy(dummy.position); interior.rotation.copy(dummy.rotation);
  }
  function hud() {
    if (!visit || !elHud) return;
    const route = routes[visit.dir], train = service.cars[visit.dir];
    const arrived = api.active && train.stopIndex === 1 && train.doorState === 'open';
    const direction = visit.dir === 0 ? 'Eastbound' : 'Westbound';
    const next = api.active ? arrived ? route.destination.name : route.destination.name : visit.station.name;
    const available = !!boardable();
    const h = patterns[visit.dir] ? TRANSIT.headway(patterns[visit.dir]) : 150;
    const distance = train.k < 2 ? Math.max(0, route.calls[Math.min(1, train.k)] - train.s) : 0;
    const remaining = train.k === 0 ? distance / 10 + 8 : train.k === 1 ? distance / 10 + 20 + h + 25 : Math.max(0, h - train.cooldown) + 25;
    const wait = Number.isFinite(remaining) ? `Next train · about ${Math.max(1, Math.ceil(remaining / 60))} min` : 'No scheduled service at this time';
    const status = api.active ? arrived ? 'This ride ends here · Get off' : train.doorState === 'open' ? 'Doors open · Departing soon' : `Next station: ${route.destination.name}`
      : available ? 'Board the train' : route.origin !== visit.station ? 'Change platforms for the return journey' : train.stopIndex === 0 && train.doorState === 'open' ? 'Walk to the front doors' : wait;
    const key = [direction, next, status, api.active].join('|');
    if (shown !== key) {
      shown = key; elHud.hidden = false;
      elNum.textContent = '2'; elRoute.textContent = api.active || route.origin === visit.station ? `${direction} → ${route.destination.name}` : `${direction} · Ride ends here`;
      elNextLabel.textContent = api.active ? arrived ? 'At' : 'Next station' : 'Platform'; elNext.textContent = next;
      elStatus.textContent = status; elStatus.disabled = api.active ? !arrived : !available;
      elStatus.classList.toggle('is-open', arrived || available); elStatus.classList.remove('is-requested');
      elCancel.textContent = api.active ? 'Return to departure station' : `Exit to ${visit.station.name}`;
      if (elOther) { elOther.hidden = api.active; elOther.textContent = 'Change to the other platform'; }
    }
    if (!api.active) prompt(available ? `Board the Line 2 train to ${route.destination.name}` : null);
  }
  function update(dt) {
    service.update(dt);
    if (!visit) {
      nearestEntrance = null;
      if (!session.active && canInteract() && ['person', 'cyclist'].includes(controller.activeMode)) {
        const p = controller.getActiveEntity().position;
        let distance = 5;
        for (const station of stations) for (const entrance of station.entrances) {
          const q = entrance.pylon || entrance, d = Math.hypot(p.x - q.x, p.z - q.z);
          if (station.anchor && Math.abs(p.y - station.anchor.y) < 0.6 && d < distance) { distance = d; nearestEntrance = station; }
        }
      }
      prompt(nearestEntrance ? `Enter ${nearestEntrance.name} station · Line 2` : null);
    }
    if (api.active) {
      const train = api.car; placeRider(train);
      const player = controller.getActiveEntity(); player.position.copy(entity.position); player.heading = entity.heading; player.speed = 0;
      if (!api.canChase && camera.activePresetId !== 'pov') selectCamera('pov', true);
      camera.camera.layers.mask = outside(train) ? visit.cameraMask : 1 << INTERIOR_LAYER;
      interior.visible = camera.activePresetId === 'pov';
    }
    if (visit && !api.active) {
      const train = service.cars[visit.dir], call = train.track.origin === visit.station ? 0 : 1;
      if (Math.abs(train.s - train.track.calls[call]) < 1) { placeRider(train); interior.visible = true; }
      else interior.visible = false;
    }
    // Reveal the arrival cell before alighting without changing the last safe departure station.
    stationGroups.forEach((group, i) => {
      group.visible = !!visit && (api.active
        ? Math.hypot(api.car.sections[0].x - stations[i].x, api.car.sections[0].z - stations[i].z) < 240
        : visit.station === stations[i]);
    });
    if (visit) hud();
    models.forEach((model, index) => {
      const train = service.cars[index], route = train.track;
      model.opened.value = train.doorProgress || 0;
      model.group.visible = !!visit || train.ridden || Math.hypot(train.sections[0].x - camera.camera.position.x, train.sections[0].z - camera.camera.position.z) < 3000;
      let count = 0, audible = false;
      train.sections.forEach((section, k) => {
        const inOpen = section.s > route.open0 - 24 && section.s < route.open1 + 24;
        const inStation = visit && stations.some((station, i) => stationGroups[i].visible &&
          Math.abs(section.s - (route.calls[route.origin === station ? 0 : 1] - 70.5)) < 100);
        const visible = !!(inOpen || inStation || (train.ridden && k === 0));
        const mesh = model.bodies[k]; mesh.visible = visible && !(train.ridden && interior.visible && k === 0);
        mesh.position.set(section.x, section.y, section.z); mesh.rotation.y = section.yaw + (k === 5 ? Math.PI : 0);
        audible ||= visible;
        if (!visible || train.doorProgress >= 0.999) return; // fully retracted doors are inside their pockets
        dummy.position.set(section.x, section.y, section.z); dummy.rotation.set(0, section.yaw, 0); dummy.updateMatrix();
        doorMatrix.copy(dummy.matrix);
        for (const door of DOORS) for (const side of [-1, 1]) {
          point.set(-1.58, 2.075, door + side * (0.4 + (train.doorProgress || 0) * 0.85)).applyMatrix4(doorMatrix);
          dummy.position.copy(point); dummy.updateMatrix(); model.leaves.setMatrixAt(count++, dummy.matrix);
        }
      });
      model.leaves.count = count; model.leaves.instanceMatrix.needsUpdate = count > 0;
      train.audible = audible && model.group.visible;
    });
  }
  const warmCulling = new Map();
  function warmGraphics(enabled) {
    for (const group of [...stationGroups, interior, tunnels]) group.traverse((object) => {
      if (!object.isMesh) return;
      if (enabled) { warmCulling.set(object, object.frustumCulled); object.frustumCulled = false; }
      else if (warmCulling.has(object)) object.frustumCulled = warmCulling.get(object);
    });
    if (!enabled) warmCulling.clear();
    stationGroups.forEach((g) => { g.visible = enabled || (visit && stations[stationGroups.indexOf(g)] === visit.station); });
    if (enabled) interior.visible = true; else interior.visible = api.active;
  }
  console.info(`[subway-ride] Castle Frank ↔ Broadview, ${routes.map((r) => `${Math.round(r.calls[1] - r.calls[0])} m / ${duration(r.dir)} scheduled seconds`).join('; ')}`);
  return api;
}

Object.assign(window.CITY, { createSubwayRide });
})();
