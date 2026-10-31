(function () {
const { THREE, SUBWAY_VIADUCTS, GEO_SUBWAY, TRANSIT, SUBWAY_TOPOLOGY, buildSubwayRidePaths, buildSubwayTrackPaths, createSubwayRideService,
  sampleSubwayRide, subwayRidePlatform, createStationWalk, stationWalkLayout, stationCellFloor, createSubwayCarGeometry, createSubwayCarMaterial } = window.CITY;
const { uniform, float, positionGeometry, normalGeometry, fract, abs, step, mix, color, max } = window.CITY.TSL;
const { mergeGeometries } = window.CITY.Addons;
const INTERIOR_LAYER = 2, DOORS = [-8.625, -2.875, 2.875, 8.625];
const FLOOR = 1.1, EYE_Z = 0.8;
const ST_LEN = 6.4; // js/subway.js: a street stairway's open stairwell

// The supported rides (js/toronto-subway-topology.js rides): Castle Frank ↔ Broadview across the viaduct, and the track
// rides (Queen ↔ King under Yonge), each a pair of stations, two directed routes and two persistent trains. A track
// ride's stations are walked: from a mapped street entrance's stairway down a corridor to the mezzanine and its stairs
// to either platform (js/subway-service.js stationWalkLayout).
function createSubwayRide({ scene, subway, controllerManager: controller, cameraSystem: camera,
  session, selectCamera, onChange = () => {}, canInteract = () => true }) {
  const api = { active: false, inside: false, entity: null, car: null, station: null, pair: null, routes: [], cars: [], pairs: [],
    action, exit, featured, update, enterStation, changePlatform, savedGround, warmGraphics,
    get canChase() { return !!api.car && outside(api.car) && api.car.s - 141 > api.car.track.open0 && api.car.s < api.car.track.open1 - 25; },
    get hasEntranceCandidate() { return !!nearestEntrance; },
    get surfaceMode() { return visit?.mode; },
    get onPlatform() { return !!visit && !api.active && visit.onPlatform; } };
  let visit = null, shown = '', ownedPrompt = false, nearestEntrance = null, fadeTimer = 0, fadeRelease = null;
  const pairs = [];

  // --- Castle Frank ↔ Broadview (the viaduct): unchanged since its first release
  (() => {
    const names = ['Castle Frank', 'Broadview'];
    const stations = names.map((name, i) => {
      const raw = GEO_SUBWAY.stations.find((s) => s[2] === name);
      let entrances = subway.entrances.sites.filter((s) => s.name === name).slice(0, 1);
      if (!entrances.length) entrances = GEO_SUBWAY.entrances.filter((s) => s[2] === name).slice(0, 1)
        .map((s) => ({ name, x: s[0], z: s[1], pylon: { x: s[0], z: s[1] }, authored: true }));
      return raw && entrances.length ? { id: i === 0 ? 'castle-frank' : 'broadview', name, x: raw[0], z: raw[1], entrances } : null;
    });
    if (stations.some((s) => !s) || !SUBWAY_VIADUCTS.length) return;
    const routes = buildSubwayRidePaths(stations, SUBWAY_VIADUCTS[0]);
    pairs.push({ id: 'l2-castle-frank-broadview', kind: 'viaduct', line: '2', stations, routes,
      label: (dir) => (dir === 0 ? 'Eastbound' : 'Westbound') });
  })();
  // --- the track rides
  for (const ride of SUBWAY_TOPOLOGY?.rides || []) {
    if (!ride.supported || ride.geometry !== 'track') continue;
    const stations = ride.stations.map((id) => {
      const st = SUBWAY_TOPOLOGY.stations.find((s) => s.id === id);
      if (!st) return null;
      // the first listed entrance that has a stairway on the street (js/subway.js), else none: not walkable
      const ids = st.facts?.walkEntrances || [];
      const site = ids.map((e) => subway.entrances.sites.find((s) => s.kind === 'stair' && `osm-node/${s.osm}` === e)).find(Boolean);
      if (!site) return null;
      const opening = { x: site.x - site.tx * ST_LEN / 2, z: site.z - site.tz * ST_LEN / 2, tx: site.tx, tz: site.tz };
      const entrance = { name: st.name, label: site.entranceName || 'the street', x: opening.x, z: opening.z, pylon: site.pylon, opening,
        prompt: { x: opening.x - site.tx * 0.6, z: opening.z - site.tz * 0.6 } };
      return { id: st.id, name: st.name, x: st.x, z: st.z, entrances: [entrance], topology: st };
    });
    if (stations.some((s) => !s)) { console.warn(`[subway-ride] ${ride.id}: a station has no walkable entrance`); continue; }
    const routes = buildSubwayTrackPaths(ride, stations);
    if (routes.length !== 2) continue;
    pairs.push({ id: ride.id, kind: 'track', line: ride.line.replace(/^L/, ''), stations, routes, ride,
      label: (dir) => routes[dir].compass || (dir === 0 ? 'Southbound' : 'Northbound') });
  }
  if (!pairs.length) return Object.assign(api, {
    action: () => false, exit: () => false, featured: () => false, update() {}, warmGraphics() {} });
  const stations = pairs.flatMap((pair) => pair.stations.map((station, index) => Object.assign(station, { pair, index })));

  for (const pair of pairs) {
    const route2 = TRANSIT.ofType(1).filter((p) => p.route === pair.line);
    pair.patterns = pair.routes.map((route) => {
      // the GTFS direction: the pattern calling at the origin before the destination
      return route2.find((p) => {
        const a = p.stops.findIndex((s) => s.name.startsWith(`${route.origin.name} Station`));
        const b = p.stops.findIndex((s) => s.name.startsWith(`${route.destination.name} Station`));
        return a >= 0 && b === a + 1;
      }) || route2.find((p) => p.dir === route.dir);
    });
    pair.duration = (dir) => {
      const stops = pair.patterns[dir]?.stops || [];
      // (by the GTFS stop's whole station name: 'Queen Station', never "Queen's Park Station")
      const a = stops.find((s) => s.name.startsWith(`${pair.routes[dir].origin.name} Station`));
      const b = stops.find((s) => s.name.startsWith(`${pair.routes[dir].destination.name} Station`));
      return a && b && b.time > a.time ? b.time - a.time : 110;
    };
    pair.service = createSubwayRideService(pair.routes, {
      headway: (dir) => Math.max(60, pair.patterns[dir] ? TRANSIT.headway(pair.patterns[dir]) : 150), duration: pair.duration,
      canRecycle: (train) => !visit || visit.station !== train.track.destination,
      idPrefix: pair.kind === 'viaduct' ? 'subway-line2' : `subway-${pair.id}`
    });
  }
  const viaduct = pairs.find((p) => p.kind === 'viaduct') || null;
  const main = viaduct || pairs[0];
  api.pairs = pairs;
  api.routes = main.routes;
  api.cars = pairs.flatMap((p) => p.service.cars);
  api.service = main.service;
  api.stations = main.stations;
  // The persistent service replaces ambient analytic trains only on this viaduct.
  if (viaduct) { subway.passengerRoutes.add(0); subway.passengerRoutes.add(1); }
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
  // the track rides' stations: Line 1's yellow trim, a paler tile for the stairs and corridors
  const yellowTrim = new THREE.MeshBasicMaterial({ color: 0xf2c418 });
  const passage = new THREE.MeshBasicNodeMaterial();
  passage.colorNode = mix(color(0xd9d4c7), color(0xaaa597), max(step(0.965, fract(positionGeometry.x.add(positionGeometry.z).mul(3))), step(0.965, fract(positionGeometry.y.mul(3)))));
  const daylight = new THREE.MeshBasicMaterial({ color: 0xf4f7ff });
  const lineColour = (pair) => (pair.line === '1' ? '#8a6d00' : '#1c2821');
  const directionSign = (pair, station, dir) => {
    const route = pair.routes[dir], label = pair.label(dir).toUpperCase();
    return route.origin === station ? `${pair.line}  ${label}  →  ${route.destination.name.toUpperCase()}` : `${pair.line}  ${label}  ·  RIDE ENDS HERE`;
  };

  // A platform cell (both platforms, the tracks, walls and ceiling) for the viaduct stations: the first release's
  function viaductStation(pair, station, index) {
    const routes = pair.routes;
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
  }

  // A track ride's station at its depth: the platform box (as the viaduct's, at the measured track spacing), the
  // stair hall at the mezzanine end, and the walk's stairs, mezzanine and corridors walled in from its rooms
  function trackStation(pair, station, index) {
    const platforms = [0, 1].map((dir) => subwayRidePlatform(pair.routes[dir], pair.routes[dir].origin === station ? 0 : 1));
    const facts = station.topology.facts;
    const layout = stationWalkLayout({ platforms, entrance: station.entrances[0].opening, concourse: facts.depth.concourseFloor.value });
    station.walk = { layout, space: createStationWalk(layout.cells, { floor: platforms[0].floor, platforms }), platforms };
    const { frame, rooms, top } = layout, { h, e, W } = frame, F = layout.floor, C = layout.concourse;
    const rail = F - FLOOR, ceiling = F + 3.8, END = 96;
    const group = new THREE.Group(); group.name = `SubwayPlatform_${station.id}`;
    const body = new THREE.Group();
    body.position.set(frame.x, rail, frame.z); body.rotation.y = frame.yaw; group.add(body);
    // (body frame: y up from the rail top, z along dir 0's travel, x across, dir 0's track at -h)
    const parts = new Map();
    const put = (material, w, hgt, d, x, y, z) => {
      (parts.get(material) || parts.set(material, []).get(material)).push(new THREE.BoxGeometry(w, hgt, d).translate(x, y, z));
    };
    const zc = (v) => e * v; // the mezzanine end is +z for e = 1
    put(dark, 2 * W + 0.6, 0.2, 2 * END, 0, -0.3, 0);
    for (const t of [-h, h]) for (const g of [-0.7475, 0.7475]) put(steel, 0.07, 0.12, 2 * END, t + g, 0.06, 0);
    for (const side of [-1, 1]) {
      const dir = side < 0 ? 0 : 1;
      const mid = side * (h + 3.375);
      put(floor, 3.45, FLOOR, 162, mid, FLOOR / 2, 0);
      put(edge, 0.28, 0.025, 160, side * (h + 1.79), FLOOR + 0.015, 0);
      // the outer wall the length of the box, to the platform ceiling; the stair hall's above it (rooms below)
      put(tile, 0.2, 3.9, 2 * END, side * (W + 0.2), FLOOR + 1.95, 0);
      put(yellowTrim, 0.035, 0.32, 160, side * (W + 0.08), FLOOR + 1.55, 0);
      for (let z = -72; z <= 72; z += 12) {
        put(lamp, 0.45, 0.07, 9, side * (h + 3.2), FLOOR + 3.2, z);
        const label = sign(station.name.toUpperCase(), 7, 0.55, lineColour(pair));
        label.position.set(side * (W + 0.07), FLOOR + 2.25, z); label.rotation.y = -side * Math.PI / 2; body.add(label);
        put(yellowTrim, 0.7, 0.45, 2.3, side * (W - 0.4), FLOOR + 0.225, z + 4);
      }
      const label = sign(directionSign(pair, station, dir), 9, 0.65, lineColour(pair));
      label.position.set(side * (h + 3.3), FLOOR + 2.5, zc(56)); label.rotation.y = e > 0 ? 0 : Math.PI; body.add(label);
      const up = sign('↑  STAIRS TO STREET', 3.4, 0.55, '#175d39');
      up.position.set(side * (h + 3.3), FLOOR + 2.5, zc(70)); up.rotation.y = e > 0 ? 0 : Math.PI; body.add(up);
      // the stair hall's sign: which platform this stair goes down to
      const down = sign(`↓  ${directionSign(pair, station, dir)}`, 4.6, 0.5, lineColour(pair));
      down.position.set(side * (h + 3.375), C - rail + 2.55, zc(87.9)); down.rotation.y = e > 0 ? Math.PI : 0; body.add(down);
    }
    // the platform ceiling to the stair hall; the hall (the platform stairs, the tracks between them and the mezzanine
    // over them) rises to the concourse's ceiling, closed at its platform end and along its sides
    put(tile, 2 * W + 0.6, 0.15, 160 + 8, 0, ceiling - rail, zc(-4));
    const hallTop = C + 3.0 - rail, hallLow = ceiling - rail;
    put(passage, 2 * W + 0.8, 0.15, 96 - 79.4, 0, hallTop + 0.075, zc((96 + 79.4) / 2));
    put(passage, 2 * W + 0.8, hallTop - hallLow + 0.2, 0.2, 0, (hallTop + hallLow) / 2, zc(79.9));
    for (const side of [-1, 1]) put(passage, 0.2, hallTop - FLOOR + 0.2, 96 - 79.4, side * (W + 0.35), (hallTop + FLOOR) / 2, zc((96 + 79.4) / 2));
    // the box's ends: walls round the tunnel mouths (the tunnel: 12 m wide, its roof 4.8 m over the rail)
    for (const v of [-END, END]) {
      for (const side of [-1, 1]) put(tile, W + 0.4 - 6, ceiling - rail + 0.6, 0.3, side * (W + 0.4 + 6) / 2, (ceiling - rail - 0.6) / 2, v);
      put(tile, 12, ceiling - rail - 4.8 + 0.2, 0.3, 0, (ceiling - rail + 4.8) / 2, v);
    }
    // the mezzanine's floor slab over the tracks, and the stair hall's ends above the platform ceiling
    put(floor, 2 * W, 0.4, 96 - 87.3, 0, C - rail - 0.2, zc((96 + 87.3) / 2));
    // the walk's rooms: steps or a floor, walls where no other room adjoins, a ceiling 3 m over the top
    const others = rooms;
    const inRoom = (x, z, y) => others.some((r) => {
      const dx = x - r.cx, dz = z - r.cz, cs = Math.cos(r.yaw), sn = Math.sin(r.yaw);
      const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
      if (Math.abs(u) > r.hx || Math.abs(v) > r.hz) return false;
      const ry = stationCellFloor(r, v);
      return Math.abs(ry - y) < 1.2;
    });
    const walk = new THREE.Group(); group.add(walk);
    const wput = (material, geometry) => (parts.get(`w|${material.uuid}`) || parts.set(`w|${material.uuid}`, { material, list: [] }).get(`w|${material.uuid}`)).list.push(geometry);
    for (const r of rooms) {
      if (r.kind === 'platform') continue;
      const cs = Math.cos(r.yaw), sn = Math.sin(r.yaw);
      const at = (u, v) => ({ x: r.cx + cs * u + sn * v, z: r.cz - sn * u + cs * v });
      const yAt = (v) => stationCellFloor(r, v);
      const place = (geometry, u, y, v) => { const p = at(u, v); return geometry.rotateY(r.yaw).translate(p.x, y, p.z); };
      const stair = r.y0 !== r.y1;
      if (stair) {
        const n = Math.max(2, Math.round(Math.abs(r.y1 - r.y0) / 0.17)), step = (2 * r.hz) / n;
        for (let k = 0; k < n; k++) {
          const v = -r.hz + step * (k + 0.5), y = yAt(v);
          wput(floor, place(new THREE.BoxGeometry(2 * r.hx, 0.2, step + 0.02), 0, y - 0.1, v));
          wput(yellowTrim, place(new THREE.BoxGeometry(2 * r.hx, 0.022, 0.06), 0, y + 0.002, v - step / 2 + 0.03));
        }
      } else wput(floor, place(new THREE.BoxGeometry(2 * r.hx, 0.25, 2 * r.hz), 0, r.y0 - 0.125, 0));
      // the ceiling 3 m over a level floor; over stairs, in steps 2.7 m over the treads
      const HEAD = stair ? 2.7 : 3.0, headAt = (v) => yAt(Math.max(-r.hz, Math.min(r.hz, v))) + HEAD;
      if (!stair) wput(passage, place(new THREE.BoxGeometry(2 * r.hx + 0.4, 0.15, 2 * r.hz + 0.4), 0, r.y0 + HEAD + 0.075, 0));
      else for (let v = -r.hz; v < r.hz - 1e-6; v += 0.5) wput(passage, place(new THREE.BoxGeometry(2 * r.hx + 0.4, 0.4, 0.52), 0, headAt(v + 0.25) + 0.2, v + 0.25));
      for (let k = -r.hz + 1.5; k < r.hz - 0.5; k += 3) wput(lamp, place(new THREE.BoxGeometry(0.4, 0.05, 1.6), 0, headAt(k + 0.75) - 0.03, k + 0.75));
      // walls: each edge in 0.5 m pieces, left open where another room carries on beyond it
      const edges = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [su, sv] of edges) {
        const along = su ? r.hz : r.hx, piece = 0.5;
        for (let a = -along; a < along - 1e-6; a += piece) {
          const b = Math.min(along, a + piece), m = (a + b) / 2;
          const u = su ? su * r.hx : m, v = su ? m : sv * r.hz;
          const yFloor = yAt(Math.max(-r.hz, Math.min(r.hz, v)));
          const out = at(u + su * 0.35, v + sv * 0.35);
          if (inRoom(out.x, out.z, yFloor)) continue;
          if ((r.kind === 'stair' || r.kind === 'entrance') && su === 0) continue; // (stairs open at both ends)
          if (r.kind === 'mezzanine' && sv === -1 && Math.abs(u) < h + 1.65) {
            // the mezzanine's balustrade over the stair hall and the tracks below
            wput(steel, place(new THREE.BoxGeometry(su ? 0.08 : b - a, 1.05, su ? b - a : 0.08), u, yFloor + 0.525, v));
            continue;
          }
          const low = yFloor - 0.25, high = headAt(v) + (stair ? 0.4 : 0.15);
          wput(passage, place(new THREE.BoxGeometry(su ? 0.2 : b - a + 0.02, high - low, su ? b - a + 0.02 : 0.2), u + su * 0.1, (low + high) / 2, v + sv * 0.1));
        }
      }
    }
    // the street stairway's top: daylight at the street, the exit sign over the steps
    if (top) {
      const t = station.entrances[0].opening, sy = Math.atan2(t.tx, t.tz);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.4), daylight);
      glow.position.set(t.x - t.tx * 0.2, 1.0, t.z - t.tz * 0.2); glow.rotation.y = sy; walk.add(glow);
      const exitSign = sign(`EXIT  ·  ${station.entrances[0].label.toUpperCase()}  ↑`, 2.4, 0.4, '#175d39');
      const p = { x: top.x + t.tx * 1.5, z: top.z + t.tz * 1.5 };
      exitSign.position.set(p.x, top.y + 2.6, p.z); exitSign.rotation.y = sy + Math.PI; walk.add(exitSign);
      const into = sign(`${pair.line}  ${station.name.toUpperCase()} STATION  ·  PLATFORMS  →`, 2.6, 0.38, lineColour(pair));
      const q = layout.cells.find((c) => c.kind === 'landing');
      if (q) { into.position.set(q.cx, C + 2.55, q.cz); into.rotation.y = sy + Math.PI; walk.add(into); }
    }
    for (const [key, value] of parts) {
      const material = value.material || key, list = value.list || value;
      const mesh = new THREE.Mesh(mergeGeometries(list), material);
      (typeof key === 'string' ? walk : body).add(mesh);
    }
    layerTree(group, INTERIOR_LAYER); group.visible = false; scene.add(group);
    return group;
  }

  // Tunnels: a dark box along each ride's tracks wherever it is neither in the open nor in a station
  function tunnelMesh(pair) {
    const route = pair.routes[0], parts = [];
    const stationCut = pair.kind === 'viaduct' ? 83 : 96;
    for (let i = 0; i + 1 < route.pts.length; i += 4) {
      const s = route.cum[i], next = Math.min(route.pts.length - 1, i + 4), end = route.cum[next];
      if (s > route.open0 && end < route.open1) continue;
      if (route.calls.some((call) => Math.abs((s + end) / 2 - (call - 70.5)) < stationCut)) continue;
      const a = route.pts[i], b = route.pts[next], yaw = Math.atan2(b.x - a.x, b.z - a.z), length = end - s + 0.12;
      // The direction-0 track is 2 m (half the track spacing) to the right of the tunnel's centre.
      const half = pair.kind === 'viaduct' ? 2 : pair.stations[0].walk?.layout.frame.h || 2.2;
      const x = (a.x + b.x) / 2 + Math.cos(yaw) * half, z = (a.z + b.z) / 2 - Math.sin(yaw) * half;
      const y = pair.kind === 'viaduct' ? route.y : (sampleSubwayRide(route, s).y + sampleSubwayRide(route, end).y) / 2;
      for (const [w, h, across, dy] of [[12, 0.15, 0, -0.3], [12, 0.15, 0, 4.8], [0.15, 5.1, -6, 2.25], [0.15, 5.1, 6, 2.25]]) {
        const geo = new THREE.BoxGeometry(w, h, length).translate(across, dy, 0).rotateY(yaw).translate(x, y, z);
        parts.push(geo);
      }
    }
    const group = new THREE.Group(); group.name = pair.kind === 'viaduct' ? 'SubwayRideTunnels' : `SubwayRideTunnels_${pair.id}`;
    if (parts.length) group.add(new THREE.Mesh(mergeGeometries(parts), dark));
    layerTree(group, INTERIOR_LAYER); scene.add(group);
    return group;
  }

  for (const pair of pairs) {
    pair.stationGroups = pair.stations.map((station, index) => (station.group = pair.kind === 'viaduct' ? viaductStation(pair, station, index) : trackStation(pair, station, index)));
    pair.tunnels = tunnelMesh(pair);
  }
  const stationGroups = stations.map((s) => s.group);
  const tunnelGroups = pairs.map((p) => p.tunnels);
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
  for (const pair of pairs) pair.models = pair.service.cars.map(trainMeshes);
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
  function savedGround(mode) {
    return visit && (mode === 'person' || mode === visit.mode) ? { ...visit.station.anchor } : null;
  }
  const routesOf = () => visit.pair.routes;
  function setPlatform(station, dir) {
    const pair = station.pair;
    visit.pair = pair; visit.station = station; visit.dir = dir; visit.onPlatform = true;
    api.station = station; api.pair = pair;
    const index = pair.routes[dir].origin === station ? 0 : 1;
    const platform = subwayRidePlatform(pair.routes[dir], index);
    visit.platform = platform;
    controller.interiorSpace = station.walk ? station.walk.space : platform;
    if (station.walk) station.walk.space.hint = platform.floor;
    controller.setMode('person');
    controller.teleportActiveTo(platform.landing.x, platform.landing.z, platform.centre.yaw + Math.PI / 2, platform.floor);
    camera.camera.layers.set(INTERIOR_LAYER); camera.followOverride = null;
    camera.resetForTeleport(); selectCamera('pov', true);
    stationGroups.forEach((g, i) => { g.visible = stations[i] === station; });
    shown = ''; prompt(null);
  }
  // A walked station entered from the street: the top of its stairway, below the street, facing down
  function setStairTop(station) {
    const top = station.walk.layout.top;
    visit.pair = station.pair; visit.station = station; visit.onPlatform = false;
    visit.dir = 0; visit.platform = subwayRidePlatform(station.pair.routes[0], station.pair.routes[0].origin === station ? 0 : 1);
    api.station = station; api.pair = station.pair;
    controller.interiorSpace = station.walk.space; station.walk.space.hint = top.y;
    controller.setMode('person');
    controller.teleportActiveTo(top.x, top.z, top.heading, top.y);
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
    visit = { pair: station.pair, station, dir: dir ?? station.index, mode: controller.activeMode,
      cameraMask: camera.camera.layers.mask, cameraPreset: camera.activePresetId,
      personLayers: [], reservation, cameraState: window.CITY.snapshotExperienceCamera(camera) };
    player.mesh.traverse((o) => { visit.personLayers.push([o, o.layers.mask]); o.layers.enable(INTERIOR_LAYER); });
    api.inside = true;
    if (station.walk && dir === null) setStairTop(station);
    else setPlatform(station, visit.dir);
    onChange(true); fade(); return true;
  }
  function changePlatform() {
    if (!visit || api.active || !canInteract()) return false;
    setPlatform(visit.station, visit.onPlatform ? 1 - visit.dir : visit.dir); onChange(true); fade(); return true;
  }
  function boardable() {
    if (!visit || api.active || !visit.onPlatform) return null;
    const train = visit.pair.service.cars[visit.dir];
    if (train.track.origin !== visit.station || train.stopIndex !== 0 || train.speed > 0.1 || train.doorState !== 'open') return null;
    const p = controller.getActiveEntity().position, q = visit.platform.landing;
    return Math.hypot(p.x - q.x, p.z - q.z) < 4 && Math.abs(p.y - q.y) < 0.1 ? train : null;
  }
  // At the top of a walked station's street stairway
  // (armed once the walker has been away from it: arriving there from the street never leaves at once, even when a
  // touch delivers its tap twice)
  function atStreetStairs() {
    if (!visit || api.active || !visit.station.walk) return false;
    const top = visit.station.walk.layout.top, p = controller.getActiveEntity().position;
    const d = Math.hypot(p.x - top.x, p.z - top.z);
    if (d > 2.5 || p.y < top.y - 1.2) visit.exitArmed = true;
    return !!top && !!visit.exitArmed && d < 1.3 && p.y > top.y - 0.5;
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
      controller.interiorSpace = saved.station.walk ? saved.station.walk.space : saved.platform;
      if (saved.station.walk) saved.station.walk.space.hint = saved.platform.floor;
      if (!session.end()) { controller.interiorSpace = previousSpace; return false; }
    }
    controller.interiorSpace = null;
    api.active = false; api.car = null; api.inside = false; api.station = null; api.pair = null;
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
    const platform = subwayRidePlatform(train.track, 1), destination = train.track.destination;
    controller.interiorSpace = destination.walk ? destination.walk.space : platform;
    if (destination.walk) destination.walk.space.hint = platform.floor;
    if (!session.end(platform.landing)) { controller.interiorSpace = null; return false; }
    api.active = false; api.car = null;
    setPlatform(destination, train.track.dir);
    interior.visible = false; onChange(true); fade(); return true;
  }
  function action() {
    if (!canInteract() || (session.active && !api.active)) return false;
    if (api.active) { exit(); return true; }
    if (visit) {
      if (atStreetStairs()) { leaveStation(); return true; }
      const train = boardable(); if (train) board(train); return true;
    }
    if (nearestEntrance) return enterStation(nearestEntrance.id);
    return false;
  }
  function featured(id = 'castle-frank') {
    if (visit) leaveStation();
    if (session.active || !canInteract()) return false;
    if (!['person', 'cyclist'].includes(controller.activeMode)) controller.setMode('person');
    const station = stations.find((s) => s.id === id) || main.stations[id === 'broadview' ? 1 : 0];
    const index = station.index;
    const train = station.pair.service.prepare(index);
    if (!train || !enterStation(station.id, index)) return false;
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
    const pair = visit.pair, routes = pair.routes, patterns = pair.patterns;
    if (!api.active && !visit.onPlatform) {
      // walking between the street and the platforms
      const atTop = atStreetStairs();
      const key = ['walk', visit.station.id, atTop].join('|');
      if (shown !== key) {
        shown = key; elHud.hidden = false;
        elNum.textContent = pair.line; elRoute.textContent = `Line ${pair.line} · ${visit.station.name} station`;
        elNextLabel.textContent = 'Station'; elNext.textContent = visit.station.name;
        elStatus.textContent = atTop ? 'Exit to the street' : 'Follow the signs to a platform';
        elStatus.disabled = !atTop; elStatus.classList.toggle('is-open', atTop); elStatus.classList.remove('is-requested');
        elCancel.textContent = `Exit to ${visit.station.name}`;
        if (elOther) { elOther.hidden = false; elOther.textContent = 'Go to a platform'; }
      }
      prompt(atTop ? `Exit to the street · ${visit.station.entrances[0].label}` : null);
      return;
    }
    const route = routes[visit.dir], train = pair.service.cars[visit.dir];
    const arrived = api.active && train.stopIndex === 1 && train.doorState === 'open';
    const direction = pair.label(visit.dir);
    const next = api.active ? arrived ? route.destination.name : route.destination.name : visit.station.name;
    const available = !!boardable();
    const h = patterns[visit.dir] ? TRANSIT.headway(patterns[visit.dir]) : 150;
    const distance = train.k < 2 ? Math.max(0, route.calls[Math.min(1, train.k)] - train.s) : 0;
    const remaining = train.k === 0 ? distance / 10 + 8 : train.k === 1 ? distance / 10 + 20 + h + 25 : Math.max(0, h - train.cooldown) + 25;
    const wait = Number.isFinite(remaining) ? `Next train · about ${Math.max(1, Math.ceil(remaining / 60))} min` : 'No scheduled service at this time';
    const status = api.active ? arrived ? 'This ride ends here · Get off' : train.doorState === 'open' ? 'Doors open · Departing soon' : `Next station: ${route.destination.name}`
      : available ? 'Board the train' : route.origin !== visit.station ? 'Change platforms for the return journey' : train.stopIndex === 0 && train.doorState === 'open' ? 'Walk to the front doors' : wait;
    const key = [pair.id, direction, next, status, api.active].join('|');
    if (shown !== key) {
      shown = key; elHud.hidden = false;
      elNum.textContent = pair.line; elRoute.textContent = api.active || route.origin === visit.station ? `${direction} → ${route.destination.name}` : `${direction} · Ride ends here`;
      elNextLabel.textContent = api.active ? arrived ? 'At' : 'Next station' : 'Platform'; elNext.textContent = next;
      elStatus.textContent = status; elStatus.disabled = api.active ? !arrived : !available;
      elStatus.classList.toggle('is-open', arrived || available); elStatus.classList.remove('is-requested');
      elCancel.textContent = api.active ? 'Return to departure station' : `Exit to ${visit.station.name}`;
      if (elOther) { elOther.hidden = api.active; elOther.textContent = 'Change to the other platform'; }
    }
    if (!api.active) prompt(available ? `Board the Line ${pair.line} train to ${route.destination.name}` : null);
  }
  function update(dt) {
    for (const pair of pairs) pair.service.update(dt);
    if (!visit) {
      nearestEntrance = null;
      if (!session.active && canInteract() && ['person', 'cyclist'].includes(controller.activeMode)) {
        const p = controller.getActiveEntity().position;
        let distance = 5;
        for (const station of stations) for (const entrance of station.entrances) {
          const q = entrance.prompt || entrance.pylon || entrance, d = Math.hypot(p.x - q.x, p.z - q.z);
          const reach = entrance.prompt ? 2.5 : 5;
          if (station.anchor && Math.abs(p.y - station.anchor.y) < 0.6 && d < Math.min(distance, reach)) { distance = d; nearestEntrance = station; }
        }
      }
      prompt(nearestEntrance ? `Enter ${nearestEntrance.name} station · Line ${nearestEntrance.pair.line}` : null);
    }
    // walking a station: which platform (if any) the walker is on
    if (visit && !api.active && visit.station.walk) {
      const p = controller.getActiveEntity().position, dir = visit.station.walk.space.platformAt(p.x, p.z, p.y);
      if (dir >= 0 && (dir !== visit.dir || !visit.onPlatform)) {
        visit.dir = dir; visit.platform = visit.station.walk.platforms[dir]; shown = '';
      }
      if ((dir >= 0) !== visit.onPlatform) shown = '';
      visit.onPlatform = dir >= 0;
    }
    if (api.active) {
      const train = api.car; placeRider(train);
      const player = controller.getActiveEntity(); player.position.copy(entity.position); player.heading = entity.heading; player.speed = 0;
      if (!api.canChase && camera.activePresetId !== 'pov') selectCamera('pov', true);
      camera.camera.layers.mask = outside(train) ? visit.cameraMask : 1 << INTERIOR_LAYER;
      interior.visible = camera.activePresetId === 'pov';
    }
    if (visit && !api.active) {
      const train = visit.pair.service.cars[visit.dir], call = train.track.origin === visit.station ? 0 : 1;
      if (visit.onPlatform && Math.abs(train.s - train.track.calls[call]) < 1) { placeRider(train); interior.visible = true; }
      else interior.visible = false;
    }
    // Reveal the arrival cell before alighting without changing the last safe departure station.
    stations.forEach((station) => {
      station.group.visible = !!visit && (api.active
        ? station.pair === visit.pair && Math.hypot(api.car.sections[0].x - station.x, api.car.sections[0].z - station.z) < 240
        : visit.station === station);
    });
    if (visit) hud();
    for (const pair of pairs) pair.models.forEach((model, index) => {
      const train = pair.service.cars[index], route = train.track;
      model.opened.value = train.doorProgress || 0;
      model.group.visible = !!visit || train.ridden || Math.hypot(train.sections[0].x - camera.camera.position.x, train.sections[0].z - camera.camera.position.z) < 3000;
      let count = 0, audible = false;
      train.sections.forEach((section, k) => {
        const inOpen = section.s > route.open0 - 24 && section.s < route.open1 + 24;
        const inStation = visit && pair.stations.some((station) => station.group.visible &&
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
    for (const group of [...stationGroups, interior, ...tunnelGroups]) group.traverse((object) => {
      if (!object.isMesh) return;
      if (enabled) { warmCulling.set(object, object.frustumCulled); object.frustumCulled = false; }
      else if (warmCulling.has(object)) object.frustumCulled = warmCulling.get(object);
    });
    if (!enabled) warmCulling.clear();
    stationGroups.forEach((g, i) => { g.visible = enabled || (visit && stations[i] === visit.station); });
    if (enabled) interior.visible = true; else interior.visible = api.active;
  }
  for (const pair of pairs) console.info(`[subway-ride] ${pair.stations.map((s) => s.name).join(' ↔ ')}, ${pair.routes.map((r) => `${Math.round(r.calls[1] - r.calls[0])} m / ${pair.duration(r.dir)} scheduled seconds`).join('; ')}${pair.kind === 'track' ? `; platforms ${(pair.routes[0].y + FLOOR).toFixed(1)} m, entrances ${pair.stations.map((s) => s.entrances[0].label).join(' / ')}` : ''}`);
  return api;
}

Object.assign(window.CITY, { createSubwayRide });
})();
