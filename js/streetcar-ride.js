(function () {
// js/streetcar-ride.js
// Ride a streetcar. Walking or cycling, at a stop where a car stands with its doors open, [E] (or the button on a touch
// screen) boards it: the rider takes a seat in the front module, behind the cab, looking ahead through the cab and out
// of the side windows ([V] / 5: the chase camera over the car). The car keeps to its route (streetcars.js): it dwells at
// the stops and waits at the lights. A small panel shows the route, its destination and the next stop. [E] at a stop
// gets off (between stops it requests the next one), onto the sidewalk beside the front door, walking or on the bike as
// before, facing the way the car goes. The featured ride ("Ride the 504 along King", #ride=504) puts the rider on a
// 504B leaving Dufferin Gate for King St & Broadview Station. (After Slop San Francisco's featured ride, MIT.)
// The car ridden is never retired or moved by the live feed's corrections (streetcars.js `ridden`); inside it, its body
// isn't drawn (seen from within, its faces are culled anyway) and a simple interior is: floor, seats, yellow poles,
// window pillars, ceiling with its light strips, the cab partition, the gangways. The interior casts the shadows, so the
// low sun comes in through the windows.

const { THREE, cityUniforms } = window.CITY;
const { attribute, vertexColor, float, smoothstep } = window.CITY.TSL;
const { mergeGeometries } = window.CITY.Addons;

const FLOOR = 0.42; // the low floor (m above the rails)
const WIN_LO = 1.02; // the window band (streetcars.js: the body's black band)
const WIN_HI = 2.6;
const CEIL = 2.72;
const CAB = 1.7; // the cab at each end, behind its partition
// the seat: the head module's second row, by the window on the curb side, an open bay ahead of it (the camera's near
// plane comes in to 0.12 m there, streetcar-ride.js update)
const EYE = { module: 0, x: -0.86, y: FLOOR + 1.28, z: 0.06 };

const COL = {
  floor: 0x34383d, wall: 0xd8d9d4, ceil: 0xe9e8e2, light: 0xfff4dc, frame: 0x17191c, seat: 0x5e1a1f, shell: 0x3f4348,
  pole: 0xf0bd1e, dash: 0x22252a, bellows: 0x2a2c30, door: 0x9a9da1
};

// a box with per-vertex colour & glow, for merging
function box(w, h, d, x, y, z, col, glow = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed().translate(x, y, z);
  return paint(g, col, glow);
}
function pole(x, z, y0, y1, r = 0.02) {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, 8, 1, true).toNonIndexed().translate(x, (y0 + y1) / 2, z);
  return paint(g, COL.pole, 0);
}
function rail(x, y, z0, z1, r = 0.018) {
  const g = new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), 8, 1, true).toNonIndexed().rotateX(Math.PI / 2).translate(x, y, (z0 + z1) / 2);
  return paint(g, COL.pole, 0);
}
function paint(g, col, glow) {
  const n = g.attributes.position.count;
  const c = new THREE.Color(col);
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(cols, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  g.deleteAttribute('uv');
  return g;
}

// One module's interior, in its own frame: z forward (the way the car goes), y up from the rails. `len` its length,
// `door` the local z of its double doors (null: none), `cab` +1 / -1 a cab at the front / back end
function moduleInterior(len, door, cab, HALF_W) {
  const W = HALF_W - 0.07; // the inner face of the side walls
  const half = len / 2;
  const parts = [];
  const z0 = cab < 0 ? -half + CAB : -half, z1 = cab > 0 ? half - CAB : half; // the saloon
  const L = z1 - z0, zc = (z0 + z1) / 2;
  // floor, ceiling & its two light strips, the cove over the windows
  parts.push(box(2 * W, 0.1, len, 0, FLOOR - 0.05, 0, COL.floor));
  parts.push(box(2 * W + 0.1, 0.06, len, 0, CEIL + 0.03, 0, COL.ceil));
  for (const s of [-1, 1]) parts.push(box(0.2, 0.012, L - 0.4, s * 0.55, CEIL - 0.006, zc, COL.light, 1));
  const inDoor = (z, m = 0) => door !== null && Math.abs(z - door) < 0.74 + m;
  for (const s of [-1, 1]) {
    const x = s * (W + 0.025);
    parts.push(box(0.05, CEIL - WIN_HI + 0.02, len, x, (WIN_HI + CEIL) / 2, 0, COL.wall));
    // the wall under the windows, the sill; at the doors the leaves' kick panels & the dark seam between them
    const runs = door === null ? [[-half, half]] : [[-half, door - 0.74], [door + 0.74, half]];
    for (const [a, b] of runs) {
      if (b - a < 0.05) continue;
      parts.push(box(0.05, WIN_LO - FLOOR, b - a, x, (FLOOR + WIN_LO) / 2, (a + b) / 2, COL.wall));
      parts.push(box(0.1, 0.03, b - a, s * (W - 0.03), WIN_LO, (a + b) / 2, COL.frame));
    }
    if (door !== null && s === 1) {
      parts.push(box(0.04, 0.55, 1.44, s * (W + 0.03), FLOOR + 0.28, door, COL.door));
      parts.push(box(0.05, WIN_HI - FLOOR, 0.035, s * (W + 0.02), (FLOOR + WIN_HI) / 2, door, COL.frame));
      for (const e of [-0.75, 0.75]) parts.push(box(0.12, WIN_HI - FLOOR, 0.08, s * (W - 0.01), (FLOOR + WIN_HI) / 2, door + e, COL.frame));
      parts.push(box(0.12, 0.08, 1.58, s * (W - 0.01), WIN_HI - 0.02, door, COL.frame));
    }
    // the window pillars, about every 1.4 m (not across the doors); in the cab modules every 1.65 m back from the cab,
    // one beside each seat row, so the windows by the seats are clear
    const pillars = [];
    if (cab === 0) {
      const n = Math.max(1, Math.round(len / 1.4));
      for (let k = 0; k <= n; k++) pillars.push(-half + 0.06 + (k * (len - 0.12)) / n);
    } else {
      for (let z = cab > 0 ? z1 - 1.65 : z0 + 1.65; Math.abs(z) < half; z -= cab * 1.65) pillars.push(z);
      pillars.push(-cab * (half - 0.06));
    }
    for (const z of pillars) {
      if (inDoor(z, 0.05)) continue;
      parts.push(box(0.08, WIN_HI - WIN_LO, 0.1, s * (W - 0.01), (WIN_LO + WIN_HI) / 2, z, COL.frame));
    }
    // the overhead grab rails
    parts.push(rail(s * 0.3, 2.12, z0 + 0.3, z1 - 0.3));
  }
  // seats: pairs against each wall, facing forward (+1) or back (-1), in the saloon clear of the doors
  const rows = [];
  const free = (z) => z > z0 + 0.3 && z < z1 - 0.3 && !inDoor(z, 0.3);
  // (face to face in the bays of the inner modules)
  // (the cab modules' front rows: on the curb side an open bay, its flip-up seat folded, so the rider's seat looks
  // ahead through the cab)
  if (cab > 0) rows.push([z1 - 0.5, 1, [1]], [z1 - 1.3, 1], [z0 + 0.45, 1]);
  else if (cab < 0) rows.push([z0 + 0.5, -1, [1]], [z0 + 1.3, -1], [z1 - 0.45, -1]);
  else if (door === null) rows.push([half - 0.45, -1], [half - 1.7, 1], [-half + 1.7, -1], [-half + 0.45, 1]);
  else rows.push([half - 0.45, -1], [half - 1.7, 1], [-half + 1.7, -1], [-half + 0.45, 1]);
  if (cab !== 0) {
    const z = cab > 0 ? z1 - 0.5 : z0 + 0.5;
    parts.push(box(0.06, 0.5, 0.75, -(W - 0.04), FLOOR + 0.75, z, COL.shell)); // the folded seat
  }
  for (const [z, f, sides = [-1, 1]] of rows) {
    if (!free(z)) continue;
    for (const s of sides) {
      const xc = s * (W - 0.46);
      parts.push(box(0.88, 0.1, 0.46, xc, FLOOR + 0.43, z, COL.seat)); // cushion
      parts.push(box(0.7, 0.38, 0.3, xc, FLOOR + 0.19, z - f * 0.04, COL.shell)); // pedestal
      parts.push(box(0.88, 0.5, 0.07, xc, FLOOR + 0.74, z - f * 0.25, COL.seat)); // backrest
      parts.push(box(0.88, 0.035, 0.09, xc, FLOOR + 1.0, z - f * 0.25, COL.shell)); // its top
      parts.push(box(0.035, 0.035, 0.1, s * (W - 0.92), FLOOR + 1.03, z - f * 0.25, COL.pole)); // the handle
    }
  }
  // poles: by the doors, and at the aisle end of the seat bays (none by the rider's own seat)
  if (door !== null) for (const e of [-0.85, 0.85]) for (const s of [-1, 1]) parts.push(pole(s * 0.32, door + e, FLOOR, CEIL));
  if (door === null) for (const s of [-1, 1]) parts.push(pole(s * 0.3, 0, FLOOR, CEIL));
  if (cab !== 0) parts.push(pole(0.3, cab > 0 ? z1 - 0.05 : z0 + 0.05, FLOOR, CEIL));
  // the cab: its partition (glazed above the waist), the dash & the driver's seat beyond, its ceiling
  if (cab !== 0) {
    const zp = cab > 0 ? z1 : z0;
    const zf = cab > 0 ? half : -half;
    const wx0 = -(W - 0.1), wx1 = W - 0.28, wy0 = 1.08, wy1 = 2.56; // the partition's glazing (its door at the left)
    const wall = (x0, x1, y0, y1) => parts.push(box(x1 - x0, y1 - y0, 0.06, (x0 + x1) / 2, (y0 + y1) / 2, zp, COL.wall));
    wall(-W, W, FLOOR, wy0);
    wall(-W, W, wy1, CEIL);
    wall(-W, wx0, wy0, wy1);
    wall(wx1, W, wy0, wy1);
    parts.push(box(wx1 - wx0 + 0.06, 0.05, 0.1, (wx0 + wx1) / 2, wy0, zp, COL.frame));
    parts.push(box(wx1 - wx0 + 0.06, 0.05, 0.1, (wx0 + wx1) / 2, wy1, zp, COL.frame));
    for (const x of [wx0, wx1]) parts.push(box(0.05, wy1 - wy0, 0.1, x, (wy0 + wy1) / 2, zp, COL.frame));
    const zd = zf - Math.sign(cab) * 0.75;
    parts.push(box(2 * W - 0.2, 0.55, 0.5, 0, FLOOR + 0.27, zd, COL.dash));
    parts.push(box(0.5, 0.45, 0.5, 0.2, FLOOR + 0.22, zp + Math.sign(cab) * 0.55, COL.shell)); // the driver's seat
    parts.push(box(2 * W, 0.06, CAB - 0.9, 0, CEIL + 0.03, zp + Math.sign(cab) * (CAB - 0.9) / 2, COL.ceil));
    for (const s of [-1, 1]) parts.push(box(0.05, WIN_LO - FLOOR, CAB - 1.0, s * (W + 0.025), (FLOOR + WIN_LO) / 2, zp + Math.sign(cab) * (CAB - 1.0) / 2, COL.dash));
  }
  return mergeGeometries(parts);
}

function createInteriorMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05 });
  // the light strips always glow; after dusk the saloon reads lit (no real light: a lift of its own colours)
  const night = smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow);
  const glow = attribute('glow', 'float');
  mat.emissiveNode = vertexColor().mul(glow.mul(night.mul(1.6).add(0.5)).add(night.mul(0.22)));
  return mat;
}

function createStreetcarRide({ scene, streetcars, controllerManager, cameraSystem, selectCamera, onChange, session, trafficSystem, isBlocked = () => false, canInteract = () => true }) {
  const api = { active: false, car: null, entity: null, prompt: null, featured, action, exit, update, board, boardable, exitPoint, landingAt, dispose };
  const rideSession = session || window.CITY.createTransitRideSession({ controllerManager, cameraSystem });
  if (!streetcars || !streetcars.shape) return api;
  const { SECTIONS, DOORS, GANGWAY, HALF_W } = streetcars.shape;
  const boardingRange = SECTIONS.reduce((length, section) => length + section + GANGWAY, 0) + 18;
  const sample = streetcars.sample;
  const routes = streetcars.routes || [];

  // --- the interior: a mesh per module, one instanced for the gangways, placed on the ridden car each frame ---------
  const group = new THREE.Group();
  group.name = 'StreetcarInterior';
  const mat = createInteriorMaterial();
  const modules = SECTIONS.map((len, k) => {
    // (the tail module is the head turned round: its door behind its cab, DOORS[0] from the cab end)
    const door = k === 0 ? DOORS[0] : k === SECTIONS.length - 1 ? -DOORS[0] : DOORS[k];
    const m = new THREE.Mesh(moduleInterior(len, door, k === 0 ? 1 : k === SECTIONS.length - 1 ? -1 : 0, HALF_W), mat);
    m.name = `StreetcarInterior${k}`;
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
  });
  const W = HALF_W - 0.07;
  const gangGeo = mergeGeometries([
    box(2 * W - 0.2, 0.1, GANGWAY + 0.5, 0, FLOOR - 0.05, 0, COL.floor),
    box(2 * W, 0.06, GANGWAY + 0.5, 0, CEIL + 0.03, 0, COL.bellows),
    box(0.06, CEIL - FLOOR, GANGWAY + 0.5, -(W - 0.08), (FLOOR + CEIL) / 2, 0, COL.bellows),
    box(0.06, CEIL - FLOOR, GANGWAY + 0.5, W - 0.08, (FLOOR + CEIL) / 2, 0, COL.bellows)
  ]);
  const gangways = new THREE.InstancedMesh(gangGeo, mat, SECTIONS.length - 1);
  gangways.name = 'StreetcarInteriorGangways';
  gangways.castShadow = true;
  gangways.receiveShadow = true;
  gangways.frustumCulled = false;
  group.add(gangways);
  // (built & compiled with the city, under the ground: the first ride must not wait for its shaders; hidden after
  // the warm-up frame)
  group.position.y = -200;
  for (const m of modules) m.updateMatrix();
  scene.add(group);
  let frames = 0;

  // --- where the car's modules are: as streetcars.js places them, whether or not it has this frame --------------------
  const tmp = { x: 0, y: 0, z: 0, yaw: 0 };
  const poses = SECTIONS.map(() => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }));
  function placeModules(car) {
    let back = car.s;
    for (let k = 0; k < SECTIONS.length; k++) {
      sample(car.track, back, tmp);
      const ax = tmp.x, ay = tmp.y, az = tmp.z;
      sample(car.track, Math.max(0, back - SECTIONS[k]), tmp);
      const p = poses[k];
      p.x = (ax + tmp.x) / 2;
      p.y = (ay + tmp.y) / 2;
      p.z = (az + tmp.z) / 2;
      p.yaw = Math.atan2(ax - tmp.x, az - tmp.z);
      p.pitch = Math.atan2(ay - tmp.y, SECTIONS[k]);
      back -= SECTIONS[k] + GANGWAY;
    }
  }
  const dummy = new THREE.Object3D();
  const moduleMatrix = (p, out) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.yaw, 0, 'YXZ');
    dummy.rotateX(-p.pitch);
    dummy.updateMatrix();
    return out.copy(dummy.matrix);
  };
  // a point in module k's frame (x left, z forward) in the world
  const v = new THREE.Vector3();
  const local = (k, x, y, z, out) => out.set(x, y, z).applyMatrix4(moduleMatrix(poses[k], tmpM));
  const tmpM = new THREE.Matrix4();

  // --- the rider: the camera's entity while aboard (cameras.js: chase over the car, the seat for the POV camera) ------
  const entity = {
    type: 'streetcar', label: 'Streetcar', position: new THREE.Vector3(), heading: 0, speed: 0,
    chaseDistance: 24, chaseHeight: 5.4, cameraTargetOffset: new THREE.Vector3(0, 1.4, 0),
    minCamY: 6.9, // (over the overhead wire, 5.6 m, and well clear of the roof: the chase camera never cuts either)
    seatEye: new THREE.Vector3(), seatYaw: 0, seatLookY: -1.2
  };
  api.entity = entity;
  function placeEntity(car) {
    placeModules(car);
    const mid = poses[2];
    entity.position.set(mid.x, mid.y, mid.z);
    entity.heading = mid.yaw;
    entity.speed = car.speed;
    local(EYE.module, EYE.x, EYE.y, EYE.z, entity.seatEye);
    entity.seatYaw = poses[EYE.module].yaw;
  }

  // --- the stops, for the "wait here" hint: every route's stops, by name, on its right (where the stop stands) ---------
  const stopPts = [];
  for (const t of routes) {
    (t.stops || []).forEach((s, i) => {
      sample(t, s, tmp);
      const x = tmp.x - Math.cos(tmp.yaw) * 3, z = tmp.z + Math.sin(tmp.yaw) * 3;
      const name = (t.stopNames && t.stopNames[i]) || '';
      if (tmp.y > -1 && t.stopRecords?.[i] && !stopPts.some((q) => q.name === name && Math.hypot(q.x - x, q.z - z) < 15)) stopPts.push({ x, z, name, route: t.pattern.route });
    });
  }

  const label = (t) => {
    const sign = (t && t.sign) || ['Streetcar', ''];
    const m = String(sign[0]).match(/^(\d+[A-Z]?)\s*(.*)$/) || [sign[0], sign[0], ''];
    const title = (s) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bStn\b/, 'Station');
    return { num: m[1], name: title(m[2] || ''), dest: title(sign[1] || '') };
  };
  const cleanStop = (n) => (n || '').replace(/ (North|South|East|West) Side$/, '');
  const stopName = (t, i) => cleanStop(t.stopNames && t.stopNames[i]);

  // --- HUD: the board / get-off prompt (a button on touch screens) & the ride panel ----------------------------------
  const $ = (id) => document.getElementById(id);
  const elPrompt = $('ride-prompt'), elPromptText = $('ride-prompt-text');
  const elHud = $('ride-hud'), elNum = $('ride-num'), elRoute = $('ride-route'), elNext = $('ride-next'), elNextLabel = $('ride-next-label'), elStatus = $('ride-status');
  const elFade = $('ride-fade');
  const elCancel = $('ride-cancel');
  if (elCancel) elCancel.addEventListener('click', cancelRide);
  function cancelRide() { if (canInteract() && api.active) { exit({ cancel: true }); toast('Returned to where you boarded'); } }
  const elToast = $('toast');
  let toastTimer = 0;
  function toast(text, ms = 2600) {
    if (!elToast) return;
    elToast.textContent = text;
    elToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elToast.classList.remove('show'), ms);
  }
  let shownPrompt = null;
  function showPrompt(p) {
    const key = p ? `${p.kind}|${p.text}` : '';
    if (key === shownPrompt) return;
    shownPrompt = key;
    api.prompt = p;
    if (!elPrompt) return;
    elPrompt.hidden = !p;
    if (!p) return;
    elPromptText.textContent = p.text;
    elPrompt.classList.toggle('is-hint', p.kind === 'hint');
    elPrompt.disabled = p.kind === 'hint';
  }
  if (elPrompt) elPrompt.addEventListener('click', action);
  if (elStatus) elStatus.addEventListener('click', action); // (on a touch screen: tap to get off)
  let shownHud = '';
  function renderHud(car) {
    if (!elHud) return;
    const t = car.track;
    const L = label(t);
    const dwelling = car.doorState === 'open';
    const k = dwelling ? car.stopIndex : car.k;
    const atEnd = dwelling && k === car.lastPassengerStop;
    const next = stopName(t, k) || 'Next supported stop';
    const status = atEnd ? 'This ride ends here · Get off'
      : dwelling ? 'Doors open · Get off'
        : car.doorState === 'opening' ? 'Doors opening'
          : car.doorState === 'closing' ? 'Doors closing'
            : requested ? 'Stop requested · Cancel request' : idleTime > 8 ? 'Waiting in traffic · Request stop' : 'Request next stop';
    const key = [L.num, L.name, L.dest, dwelling, next, status].join('|');
    if (key === shownHud) return;
    shownHud = key;
    elNum.textContent = L.num;
    elRoute.textContent = `${L.name}${L.dest ? ` → ${L.dest}` : ''}`;
    elNextLabel.textContent = dwelling && !atEnd ? 'At' : atEnd ? '' : 'Next stop';
    elNext.textContent = next;
    elStatus.textContent = status;
    elStatus.disabled = car.doorState === 'opening' || car.doorState === 'closing';
    elStatus.classList.toggle('is-open', dwelling);
    elStatus.classList.toggle('is-requested', !dwelling && requested);
  }
  let fadeTimer = null, fadeRelease = null;
  function fade() {
    if (!elFade) return;
    clearTimeout(fadeTimer); fadeRelease?.(); fadeRelease = rideSession.beginTransition();
    elFade.classList.add('show');
    fadeTimer = setTimeout(() => { elFade.classList.remove('show'); fadeRelease?.(); fadeRelease = null; }, 260);
  }

  // Passenger transfer geometry is independent of the fleet's rendering/culling.
  let leftCar = null, requested = false, lastDoorState = null, lastStop = -1, idleTime = 0;
  const canRide = () => ['person', 'cyclist'].includes(controllerManager.activeMode);
  const G = window.CITY.WorldCollision;
  function pathClear(door, landing) {
    const n = Math.ceil(Math.hypot(landing.x - door.x, landing.z - door.z) / 0.5);
    for (let k = 0; k <= n; k++) {
      const f = k / Math.max(1, n), x = door.x + (landing.x - door.x) * f, z = door.z + (landing.z - door.z) * f;
      const y = door.y + (landing.y - door.y) * f;
      const shape = G.circleShape(x, z, 0.3);
      for (const c of controllerManager.nearColliders(x, z, shape.reach)) {
        if (y + 1.9 > (c.minY ?? 0) && y < c.maxY && G.contact(shape, c)) return false;
      }
    }
    return true;
  }
  function trafficClear(point, car) {
    const radius = controllerManager.activeMode === 'cyclist' ? 1.2 : 0.65;
    for (const other of [...(trafficSystem?.cars || []), ...(trafficSystem?.buses || []), ...(trafficSystem?.peds || [])]) {
      if (Math.abs((other.y || 0) - point.y) > 2) continue;
      const yaw = (other.yaw || 0) + (other.yawOffset || 0), dx = point.x - other.x, dz = point.z - other.z;
      const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      const across = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      if (Math.abs(along) < (other.half || 0.5) + radius + Math.min(2, Math.abs(other.speed || 0) * 0.3)
        && Math.abs(across) < (other.halfWidth || 0.45) + radius) return false;
    }
    for (const other of streetcars.cars) {
      if (other === car || !other.placed) continue;
      for (let k = 0; k < other.sections.length; k++) {
        const sec = other.sections[k], dx = point.x - sec.x, dz = point.z - sec.z;
        if (Math.abs(sec.y - point.y) < 2 && Math.abs(dx * Math.cos(sec.yaw) - dz * Math.sin(sec.yaw)) < HALF_W + radius
          && Math.abs(dx * Math.sin(sec.yaw) + dz * Math.cos(sec.yaw)) < SECTIONS[k] / 2 + radius) return false;
      }
    }
    return !isBlocked(point, radius);
  }
  // A stop's door-side sidewalk anchor, including the footprint and the transfer corridor. No unchecked fallback.
  function landingAt(track, index, dynamic = false, car = null, module = 0) {
    if (!track.stopRecords?.[index] || DOORS[module] === null) return null;
    const pose = {};
    const section = car?.sections[module];
    if (section) {
      Object.assign(pose, { x: section.x + Math.sin(section.yaw) * DOORS[module],
        y: section.y + Math.sin(section.pitch || 0) * DOORS[module],
        z: section.z + Math.cos(section.yaw) * DOORS[module], yaw: section.yaw });
    } else {
      let back = track.stops[index];
      for (let k = 0; k < module; k++) back -= SECTIONS[k] + GANGWAY;
      sample(track, back - SECTIONS[module] / 2 + DOORS[module], pose);
    }
    if (pose.y < -0.5) return null; // Underground loop platforms are not built yet.
    const rightX = -Math.cos(pose.yaw), rightZ = Math.sin(pose.yaw);
    const door = { x: pose.x + rightX * HALF_W, y: pose.y + FLOOR, z: pose.z + rightZ * HALF_W };
    for (let d = HALF_W + 0.9; d <= 14; d += 0.5) {
      for (const along of [0, 1.5, -1.5, 3, -3]) {
        const x = pose.x + rightX * d + Math.sin(pose.yaw) * along;
        const z = pose.z + rightZ * d + Math.cos(pose.yaw) * along;
        if (!controllerManager.isPointOnSidewalk(x, z)) continue;
        const y = controllerManager.getGroundHeight(x, z, controllerManager.activeMode);
        if (Math.abs(y - pose.y) > 0.6) continue;
        const point = { x, y, z, heading: pose.yaw, door, stopIndex: index, stopId: track.stopRecords[index].id };
        if (!pathClear(door, point)) continue;
        if (dynamic && (!controllerManager.findTeleportPosition(x, z, pose.yaw, y, true) || !trafficClear(point, car))) continue;
        if (!dynamic) {
          const shape = G.circleShape(x, z, 1.1);
          if ([...controllerManager.nearColliders(x, z, shape.reach)].some((c) => y + 1.9 > (c.minY ?? 0) && y < c.maxY && G.contact(shape, c))) continue;
        }
        return point;
      }
    }
    return null;
  }
  const lastStops = new WeakMap();
  function lastSupportedStop(track) {
    if (lastStops.has(track)) return lastStops.get(track);
    let last = -1;
    for (let i = track.stops.length - 1; i >= 0; i--) {
      if (landingAt(track, i)) { last = i; break; }
    }
    lastStops.set(track, last);
    return last;
  }
  function boardable() {
    if (!canRide() || controllerManager.suspended || !canInteract()) return null;
    const p = controllerManager.getActiveEntity().position;
    let best = null, distance = 4;
    for (const car of streetcars.cars) {
      if (!car.placed || car === leftCar || car.speed > 0.1 || car.doorState !== 'open') continue;
      if (!car.track.stopRecords?.[car.stopIndex] || !car.sections[0]
        || Math.abs(car.s - car.track.stops[car.stopIndex]) > 1) continue;
      if (Math.hypot(p.x - car.sections[0].x, p.z - car.sections[0].z) > boardingRange) continue;
      if (car.stopIndex >= lastSupportedStop(car.track)) continue;
      for (let module = 0; module < SECTIONS.length; module++) {
        const section = car.sections[module];
        if (DOORS[module] === null || !section || Math.hypot(p.x - section.x, p.z - section.z) > 18
          || Math.abs(p.y - section.y) > 0.6) continue;
        const anchor = landingAt(car.track, car.stopIndex, true, car, module);
        if (!anchor) continue;
        const d = Math.hypot(p.x - anchor.x, p.z - anchor.z);
        if (d > distance) continue;
        // Board at any open passenger door, including from a clear road-level boarding area beside it.
        const side = (p.x - anchor.door.x) * -Math.cos(anchor.heading) + (p.z - anchor.door.z) * Math.sin(anchor.heading);
        if (side < -0.1 || !pathClear(anchor.door, p) || !trafficClear(p, car)) continue;
        distance = d;
        best = car;
      }
    }
    return best;
  }
  function board(car) {
    if (api.active || !car || boardable() !== car) return false;
    const last = lastSupportedStop(car.track);
    if (last === car.stopIndex) return false;
    placeEntity(car);
    if (!rideSession.begin(car, entity, () => { car.ridden = false; car.hideBody = false; }, { onCancel: () => exit({ cancel: true }) })) return false;
    api.active = true;
    api.car = car;
    car.ridden = true;
    car.hideBody = true;
    car.lastPassengerStop = last;
    car.hold = Math.max(car.hold || 0, 3);
    requested = false;
    idleTime = 0;
    lastStop = car.stopIndex;
    lastDoorState = car.doorState;
    cameraSystem.resetOrbit();
    selectCamera('pov', true);
    showPrompt(null);
    fade();
    const L = label(car.track);
    toast(`Aboard the ${L.num} ${L.name}${L.dest ? ` to ${L.dest}` : ''}`);
    onChange?.(true);
    return true;
  }
  function exitPoint(car) {
    if (car.speed > 0.1 || car.doorState !== 'open') return null;
    return landingAt(car.track, car.stopIndex, true, car);
  }
  function exit({ cancel = false, place = true } = {}) {
    if (!api.active) return false;
    const car = api.car;
    const at = cancel || !place ? null : exitPoint(car);
    if (!cancel && place && !at) {
      car.hold = Math.max(car.hold || 0, 3);
      toast('The sidewalk is blocked. Stay aboard or try again at the next stop.');
      return false;
    }
    if (!rideSession.end(at)) return false;
    leftCar = car;
    if (car.doorState === 'open') car.hold = 2.5;
    api.active = false;
    api.car = null;
    setNear(null);
    group.visible = false;
    group.position.y = -200;
    if (elHud) elHud.hidden = true;
    shownHud = '';
    farNear = null;
    onChange?.(false);
    fade();
    return at || true;
  }
  function action() {
    if (!canInteract()) return false;
    if (!api.active) return board(boardable());
    const car = api.car;
    if (car.doorState === 'open') {
      const name = stopName(car.track, car.stopIndex), L = label(car.track);
      if (exit()) toast(`Off the ${L.num} at ${name || 'the stop'}`);
    } else if (car.doorState === 'closed') {
      requested = !requested;
      toast(requested ? `Stop requested: ${stopName(car.track, car.k) || 'the next stop'}` : 'Stop request cancelled');
    }
    return true;
  }
  function featured(routeNum = '504') {
    if (api.active) exit({ cancel: true });
    if (!canRide() || !canInteract()) return false;
    const mine = routes.filter((t) => t.pattern.route === routeNum && t.stops.length > 3 && Number.isFinite(t.headway))
      .sort((a, b) => Number(b.pattern.dir === 0) - Number(a.pattern.dir === 0));
    for (const track of mine) {
      for (let i = 0; i < track.stops.length - 1; i++) {
        if (routeNum === '504' && !/^King St/.test(stopName(track, i))) continue;
        const anchor = landingAt(track, i, true);
        if (!anchor) continue;
        const existing = streetcars.cars.find((c) => c.track === track && c.doorState === 'open' && c.stopIndex === i && c.speed < 0.1);
        const car = existing || streetcars.spawnAt(track, track.stops[i]);
        if (!car) continue;
        if (!existing) {
          window.CITY.openTransitDoors(car, i, Math.max(8, track.dwell || 15));
          car.doorProgress = 1;
          car.doorState = 'open';
          car.k = i + 1;
        }
        // Populate poses without advancing the fleet; the regular simulation remains its only clock.
        placeModules(car);
        car.sections.forEach((p, k) => Object.assign(p, poses[k]));
        car.placed = true;
        const original = controllerManager.getActiveEntity().position.clone();
        const heading = controllerManager.getActiveEntity().heading;
        controllerManager.teleportActiveTo(anchor.x, anchor.z, anchor.heading);
        if (board(car)) return true;
        if (!existing) streetcars.retire(car);
        controllerManager.teleportActiveTo(original.x, original.z, heading);
      }
    }
    toast(`No safe ${routeNum} boarding stop is available. Try another time of day.`);
    return false;
  }

  // the camera's near plane, brought in for the seat by the window (the wall a few tens of cm away)
  let farNear = null;
  function setNear(near) {
    const cam = cameraSystem.camera;
    if (near !== null && farNear === null) farNear = cam.near;
    const want = near !== null ? near : farNear;
    if (want === null || cam.near === want) return;
    cam.near = want;
    cam.updateProjectionMatrix();
    if (near === null) farNear = null;
  }

  // --- each frame (main.js: after streetcars.update, before the camera) ------------------------------------------------
  let hintClock = 0;
  function update(dt) {
    frames++;
    if (frames === 3 && !api.active) group.visible = false;
    if (!api.active) {
      // the prompt: a car to board within reach, else a stop to wait at
      hintClock -= dt;
      if (hintClock > 0) return;
      hintClock = 0.15;
      if (leftCar && leftCar.doorState === 'closed') leftCar = null;
      if (!canRide() || controllerManager.suspended || !canInteract()) return showPrompt(null);
      const car = boardable();
      if (car) {
        const L = label(car.track);
        return showPrompt({ kind: 'board', text: `Board the ${L.num} ${L.name}${L.dest ? ` to ${L.dest}` : ''}` });
      }
      const p = controllerManager.getActiveEntity().position;
      let near = null, nd = 14;
      for (const q of stopPts) {
        const d = Math.abs(q.x - p.x) + Math.abs(q.z - p.z);
        if (d < nd) {
          nd = d;
          near = q;
        }
      }
      return showPrompt(near ? { kind: 'hint', text: `Streetcar stop${near.name ? ` · ${cleanStop(near.name)}` : ''}: wait for the ${near.route}` } : null);
    }
    const car = api.car;
    if (!streetcars.cars.includes(car)) { exit({ cancel: true }); return; }
    idleTime = car.speed < 0.1 && car.doorState === 'closed' ? idleTime + dt : 0;
    placeEntity(car);
    // the hidden player rides along (the map, the street names & the sounds follow it), standing still
    const ent = controllerManager.getActiveEntity();
    ent.position.copy(entity.position);
    ent.heading = entity.heading;
    ent.speed = 0;
    // the interior from the seat; the body from outside
    const inside = cameraSystem.activePresetId === 'pov';
    car.hideBody = inside;
    group.visible = inside;
    setNear(inside ? 0.12 : null);
    if (inside) {
      group.position.y = 0;
      group.updateMatrix();
      group.updateMatrixWorld();
      modules.forEach((m, k) => {
        moduleMatrix(poses[k], m.matrix);
        m.matrixWorld.copy(m.matrix);
      });
      for (let k = 0; k + 1 < SECTIONS.length; k++) {
        const a = poses[k], b = poses[k + 1];
        dummy.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        let dy = b.yaw - a.yaw;
        dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
        dummy.rotation.set(0, a.yaw + dy / 2, 0);
        dummy.updateMatrix();
        gangways.setMatrixAt(k, dummy.matrix);
      }
      gangways.instanceMatrix.needsUpdate = true;
    }
    if (car.stopIndex !== lastStop && car.doorState === 'open') {
      lastStop = car.stopIndex;
      if (requested) toast(`Stop requested: ${stopName(car.track, lastStop)} · Get off when ready`, 4500);
      requested = false;
    }
    if (car.doorState !== lastDoorState) {
      if (car.doorState === 'open' || car.doorState === 'closing') window.CITY.Audio?.streetcarBell(car, { double: false });
      lastDoorState = car.doorState;
    }
    if (car.atEnd > 0) {
      toast('This ride has ended. Return to where you boarded.');
      exit({ cancel: true });
      return;
    }
    if (elHud) elHud.hidden = false;
    renderHud(car);
  }

  function dispose() {
    clearTimeout(fadeTimer); fadeRelease?.(); fadeRelease = null;
    if (api.active) exit({ cancel: true });
    elPrompt?.removeEventListener('click', action);
    elCancel?.removeEventListener('click', cancelRide);
    elStatus?.removeEventListener('click', action);
    group.traverse((object) => { if (object.isMesh) object.geometry.dispose(); });
    mat.dispose();
    group.removeFromParent();
    clearTimeout(toastTimer);
  }
  return api;
}

Object.assign(window.CITY, { createStreetcarRide });
})();
