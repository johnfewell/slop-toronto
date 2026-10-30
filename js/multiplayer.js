(function () {
// js/multiplayer.js
// Other people in the city (docs/multiplayer-spec.md, phase 1). Once the city is on screen the page joins a room on the
// rooms Worker (rooms/, its own Worker: production rooms from the production site, staging rooms from previews &
// localhost, ?mp=wss://... to choose, ?mp=0 for none), sends where the player is 10 times a second (twice standing
// still) and draws everyone else near the camera as ghosts: no collisions, no shared traffic. With no rooms to reach,
// or the service's kill switch on, the city is exactly what it was.
// - Privacy: no position is ever sent while hidden: a passenger, a background tab, or inside the private zone, 500 m
//   round the player's real location (tour-guide.js's locate card, js/mp-protocol.js createPrivacy). The zone is kept
//   with the saved player state (main.js), so a reload is hidden too; links made while hidden carry no position.
// - Rooms: public-1 first (a full room points to the next); "Ride with a friend" moves the player into a new private
//   room and then copies #room=<6 letters>&at=<x>,<z>; such a link wins over the saved position (#place & #ride over
//   #at).
// - Drawing: everyone 150 ms in the past, between the two samples either side; a new epoch (a teleport, a mode switch)
//   snaps. One budget per quality tier covers every mode: the nearest get the full models (the traffic's instanced car
//   in their colour, instanced bicycles, the shared skinned crowd, copies of the helicopter), the rest stand-ins (the
//   car proxy, the crowd's far detail, a helicopter proxy). All of it is made at start-up, before the warm-up frame
//   compiles the pipelines: a join never compiles a shader mid-ride.
// - Cost: stats() gives the main thread's time in multiplayer per frame (update & message handlers).

const { THREE } = window.CITY;
const P = window.CITY.MP_PROTOCOL;
const { BODY_SPECS, buildCarGeometry, buildCarProxyGeometry, createLoftedCarMaterial, PersonCrowd, PersonRig } = window.CITY;
const { mergeGeometries } = window.CITY.Addons;

const params = new URLSearchParams(location.search);
const OFF = !P || params.get('mp') === '0' || location.protocol === 'file:' || typeof WebSocket === 'undefined';
const PRODUCTION_SITES = ['sloptoronto.ca', 'www.sloptoronto.ca', 'slop-toronto.cloud6711.workers.dev'];
const ROOMS = { production: 'wss://slop-toronto-rooms.cloud6711.workers.dev', staging: 'wss://slop-toronto-rooms-staging.cloud6711.workers.dev' };

// the remote model budget (spec: Client integration): full models of any mode, of which helicopters, and drawn in all
const TIERS = {
  high: { full: 12, heli: 2, drawn: 24, shadows: true },
  medium: { full: 6, heli: 1, drawn: 12, shadows: false },
  low: { full: 0, heli: 0, drawn: 6, shadows: false }
};
const BUDGET = TIERS[window.CITY.QUALITY?.tier] || TIERS.medium;
const MAX = Math.max(1, BUDGET.drawn);
const NEAR = 500; // m from the camera
const DELAY = 150, EXTRAPOLATE = 250; // ms
const SEND_MOVING = 100, SEND_STILL = 500, HIDE_KEEPALIVE = 10000; // ms
const TOP_SPEED = [10, 70, 22, 60]; // m/s, as the rooms' distance budget: a faster step between frames is a teleport
const PAINT = [0xe63946, 0xf4a261, 0xe9c46a, 0x2a9d8f, 0x3a86ff, 0x8338ec, 0xff006e, 0x06d6a0]; // by colour index
const MODE = { person: 0, car: 1, cyclist: 2, helicopter: 3 };
const PARK_Y = -500; // the warm-up frame draws one of everything down here, out of sight

const TAU = Math.PI * 2;
const wrap = (a) => a - Math.round(a / TAU) * TAU;
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
const HELMET_SCALE = new THREE.Vector3(0.95, 0.68, 1.28), HELMET_OFFSET = new THREE.Vector3(0, 0.175, -0.012);

function createMultiplayer({ scene, controllerManager, privateZone = null }) {
  if (OFF) return null;
  const cm = controllerManager;
  const proto = window.CITY.ThirdPersonControllerManager.prototype;
  const group = new THREE.Group();
  group.name = 'Multiplayer';
  scene.add(group);
  const parked = new THREE.Matrix4().makeTranslation(0, PARK_Y, 0);
  const instanced = (geo, mat, n, shadows) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.frustumCulled = false; // (the instances are spread over the city)
    m.castShadow = shadows;
    m.receiveShadow = true;
    m.setMatrixAt(0, parked);
    m.count = 1; // one, parked, for the warm-up frame
    group.add(m);
    return m;
  };
  const paintAttrs = (geo, n) => {
    geo.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
    return geo;
  };

  // Cars: the traffic's sedan in its instanced material (per-instance paintColor & carState); stand-ins: its proxy
  const spec = BODY_SPECS.sedan;
  const carMat = createLoftedCarMaterial(spec);
  const cars = instanced(paintAttrs(buildCarGeometry(spec, true), MAX), carMat, MAX, BUDGET.shadows);
  const carProxies = instanced(paintAttrs(buildCarProxyGeometry(spec), MAX), carMat, MAX, false);

  // Bicycles: the player's (controllers.js), merged per material into one instanced draw each. The cranks are left out
  // (the rider's feet still go round); the tyres turn true, so a still wheel looks the same as a turning one.
  const bike = proto.createCyclistEntity.call({ scene: new THREE.Group() });
  bike.mesh.updateMatrixWorld(true);
  const skip = new Set();
  bike.crankPivot.traverse((o) => skip.add(o));
  const byMaterial = new Map();
  bike.leanPivot.traverse((o) => {
    if (!o.isMesh || skip.has(o)) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    g.applyMatrix4(o.matrixWorld);
    if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
    byMaterial.get(o.material).push(g);
  });
  const bikeParts = [...byMaterial].map(([mat, geos]) => instanced(mergeGeometries(geos), mat, MAX, BUDGET.shadows));
  const helmets = instanced(bike.helmet.geometry, bike.helmet.material, MAX, BUDGET.shadows);
  const bikeFrame = bike.bikeFrame;

  // Walkers & riders: one skinned crowd (its far detail is the stand-in)
  const crowd = new PersonCrowd(MAX, { farDistance: 34, castShadow: BUDGET.shadows });
  crowd.meshes.forEach((m) => group.add(m));

  // Helicopters: copies of the player's (about six meshes each, so few); stand-ins: one instanced fuselage & rotor disc
  const helis = [];
  for (let i = 0; i < BUDGET.heli; i++) {
    const h = proto.createHelicopterEntity.call({ scene: group });
    h.mesh.position.y = PARK_Y;
    h.mesh.traverse((o) => { if (o.isMesh) o.castShadow = BUDGET.shadows; });
    helis.push(h);
  }
  const heliProxyGeo = mergeGeometries([
    new THREE.CapsuleGeometry(1.1, 2.6, 4, 10).rotateX(Math.PI / 2).translate(0, 1.4, 0.2).toNonIndexed(),
    new THREE.CylinderGeometry(0.22, 0.32, 4.6, 8).rotateX(Math.PI / 2).translate(0, 1.7, -3.4).toNonIndexed(),
    new THREE.CylinderGeometry(4.6, 4.6, 0.04, 20).translate(0, 2.7, -0.3).toNonIndexed()
  ].map((g) => { for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n); return g; }));
  const heliProxies = instanced(heliProxyGeo, new THREE.MeshStandardNodeMaterial({ color: 0x3d4a5c, roughness: 0.45, metalness: 0.3 }), MAX, false);

  // --- the room
  const remotes = new Map(); // id -> { id, name, colour, samples, rig, pivot, ... }
  let ws = null, room = null, me = null, riding = 0;
  let ctx = null; // start(): tourGuide, rideSession, subwayRide, teleportTo, camera
  let backoff = 1000, retry = 0, givenUp = false;
  let clockOffset = null, lastRoomTime = -1; // performance.now() - roomTime, the smallest seen (drifting up slowly)
  let epoch = 0, lastSend = 0, lastSent = null, lastHide = 0;
  let prev = null; // the player last frame: { x, z, mode }
  let invite = null; // 'pending' while moving into a new private room for "Ride with a friend"
  let fromLink = false, toldUnreachable = false, welcomed = false;
  const privacy = P.createPrivacy(privateZone);
  const stateBuf = new ArrayBuffer(P.STATE_BYTES);
  const cpu = { frames: new Float32Array(600), n: 0, handlers: 0 };
  let paused = false;

  const hash = () => new URLSearchParams(location.hash.slice(1));
  const isPrivate = (name) => !!name && !name.startsWith('public-');
  function serverUrl() {
    const custom = params.get('mp');
    const base = custom && /^wss?:\/\//.test(custom) ? custom.replace(/\/$/, '')
      : PRODUCTION_SITES.includes(location.host) ? ROOMS.production : ROOMS.staging;
    return `${base}/mp/${room}?v=${P.VERSION}`;
  }
  function setRoomInHash(name) {
    const h = hash();
    if (isPrivate(name)) h.set('room', name); else h.delete('room');
    h.delete('at');
    const s = h.toString();
    history.replaceState(null, '', s ? `#${s}` : location.pathname + location.search);
  }

  function connect(delay = 0) {
    clearTimeout(retry);
    if (delay) { retry = setTimeout(() => connect(), delay); return; }
    if (givenUp || document.hidden) return;
    let reply = null;
    welcomed = false;
    const socket = (ws = new WebSocket(serverUrl()));
    socket.binaryType = 'arraybuffer';
    socket.onmessage = (e) => {
      if (socket !== ws) return;
      const t0 = performance.now();
      if (typeof e.data !== 'string') onSnapshot(P.decodeSnapshot(e.data));
      else {
        let m = null;
        try { m = JSON.parse(e.data); } catch { /* not ours */ }
        if (m) onControl(m);
        if (m && (m.type === 'full' || m.type === 'limited')) reply = m;
      }
      cpu.handlers += performance.now() - t0;
    };
    socket.onclose = (e) => {
      if (socket !== ws) return;
      ws = null;
      me = null;
      remotes.clear();
      riding = 0;
      renderHud();
      const wasWelcomed = welcomed;
      if (e.code === 4000 || e.code === 4003 || e.code === 4008) { givenUp = true; return; } // old page, banned: alone
      if (e.code === 4001) {
        if (reply && reply.next) { room = reply.next; return connect(); }
        if (invite === 'pending') return backToPublic('Couldn’t start a room right now: rooms are full');
        toast(isPrivate(room) ? 'Your friend’s room is full' : 'Rooms are full: riding solo for now');
        givenUp = true;
        return;
      }
      if (e.code === 4005) { toast('Too many connections from your network: riding solo for a minute'); return connect(60000); }
      if (invite === 'pending') return backToPublic('Couldn’t start your room: back in the public room');
      if (fromLink && !wasWelcomed && !toldUnreachable) { toldUnreachable = true; toast('Couldn’t reach your friend’s room: retrying'); }
      connect(backoff + Math.random() * 2000); // (jittered, so a deploy doesn't bring everyone back at once)
      backoff = Math.min(30000, backoff * 2);
    };
  }

  function onControl(m) {
    if (m.type === 'welcome') {
      welcomed = true;
      backoff = 1000;
      me = { id: m.id, name: m.name, colour: m.colour };
      room = m.room;
      remotes.clear();
      for (const p of m.players) addRemote(p);
      riding = m.riding || 0;
      clockOffset = null;
      lastRoomTime = -1;
      lastSent = null;
      if (invite === 'pending') {
        invite = null;
        setRoomInHash(room);
        copyLink(true);
      }
      renderHud();
    } else if (m.type === 'join') addRemote(m);
    else if (m.type === 'leave') remotes.delete(m.id);
    else if (m.type === 'hidden') { const r = remotes.get(m.id); if (r) r.samples.length = 0; }
    else if (m.type === 'riding') { riding = m.n; renderHud(); }
  }

  function addRemote(p) {
    if (remotes.has(p.id)) return;
    remotes.set(p.id, { id: p.id, name: p.name, colour: p.colour, samples: [], rig: null, pivot: null, ridden: false, lean: 0, pedal: 0, prevH: null, y: 0, shown: null });
  }

  function onSnapshot(s) {
    if (!s || !me) return;
    // a restarted room object: its clock starts again, and the old samples belong to another timeline
    if (lastRoomTime >= 0 && s.roomTime < lastRoomTime - 1000) {
      clockOffset = null;
      for (const r of remotes.values()) r.samples.length = 0;
    }
    lastRoomTime = s.roomTime;
    const o = performance.now() - s.roomTime;
    clockOffset = clockOffset === null || o < clockOffset ? o : clockOffset + (o - clockOffset) * 0.02;
    riding = s.riding;
    for (const p of s.records) {
      if (p.flags & P.FLAG_MAP_ONLY) continue; // (the map's, phase 2)
      const r = remotes.get(p.id);
      if (!r) continue;
      p.t = s.roomTime - p.age; // when the room received it: a repeated sample keeps its time
      const last = r.samples[r.samples.length - 1];
      if (last && last.t >= p.t) continue;
      r.samples.push(p);
      if (r.samples.length > 12) r.samples.shift();
    }
    renderHud();
  }

  // A remote player as of room time t: { x, y, z, heading, speed, mode, boost } or null (unknown, stale)
  const out = { x: 0, y: 0, z: 0, heading: 0, speed: 0, mode: 0, boost: false };
  function sampleAt(r, t) {
    const S = r.samples;
    if (!S.length) return null;
    if (t - S[S.length - 1].t > P.FRESH) return null;
    let a = S[0], b = null;
    for (let i = S.length - 1; i >= 0; i--) {
      if (S[i].t <= t) { a = S[i]; b = S[i + 1] || null; break; }
    }
    if (b && b.epoch === a.epoch && b.mode === a.mode) {
      const k = Math.max(0, Math.min(1, (t - a.t) / Math.max(1, b.t - a.t)));
      out.x = a.x + (b.x - a.x) * k;
      out.y = a.y + (b.y - a.y) * k;
      out.z = a.z + (b.z - a.z) * k;
      out.heading = a.heading + wrap(b.heading - a.heading) * k;
      out.speed = a.speed + (b.speed - a.speed) * k;
    } else {
      // past the newest sample (or across a teleport): on along the heading for a moment, then held
      const ahead = b ? 0 : Math.max(0, Math.min(EXTRAPOLATE, t - a.t)) / 1000;
      out.x = a.x + Math.sin(a.heading) * a.speed * ahead;
      out.y = a.y;
      out.z = a.z + Math.cos(a.heading) * a.speed * ahead;
      out.heading = a.heading;
      out.speed = a.speed;
    }
    out.mode = a.mode;
    out.boost = (a.flags & P.FLAG_BOOST) !== 0;
    return out;
  }

  // --- what this player sends. The hide decision comes first; a hidden player's frame has no position in it.
  function watchPlayer(dt) {
    const ent = cm.getActiveEntity();
    const mode = MODE[cm.activeMode] ?? 0;
    const x = ent.position.x, z = ent.position.z;
    let teleported = false;
    if (prev) {
      const step = Math.hypot(x - prev.x, z - prev.z);
      teleported = mode !== prev.mode || step > TOP_SPEED[mode] * 1.5 * Math.max(dt, 0.016) + 5;
      if (teleported) epoch = (epoch + 1) & 0xff;
    }
    prev = { x, z, mode };
    const real = ctx.tourGuide?.realLocation;
    privacy.update({ x, z, real: real && real.status === 'city' ? real : null, teleported });
    return { ent, mode };
  }

  function hideReason() {
    if (document.hidden) return 'background';
    if (ctx.rideSession?.active || ctx.subwayRide?.inside || cm.suspended) return 'passenger';
    if (privacy.hidden) return 'private';
    return null;
  }

  function send(now, ent, mode) {
    if (!ws || ws.readyState !== 1 || !me) return;
    const reason = hideReason();
    if (reason) {
      if (lastSent && lastSent.hidden && now - lastHide < HIDE_KEEPALIVE) return;
      ws.send(P.encodeHide(reason));
      lastHide = now;
      lastSent = { hidden: true };
      return;
    }
    const moving = Math.abs(ent.speed) > 0.3 || !lastSent || lastSent.hidden || lastSent.mode !== mode || lastSent.epoch !== epoch || Math.abs(wrap(ent.heading - lastSent.heading)) > 0.01;
    if (now - lastSend < (moving ? SEND_MOVING : SEND_STILL)) return;
    lastSend = now;
    lastSent = { mode, epoch, heading: ent.heading };
    const flags = cm.keys.boost && Math.abs(ent.speed) > 0.5 ? P.FLAG_BOOST : 0;
    ws.send(P.encodeState({ mode, flags, epoch, x: ent.position.x, y: ent.position.y, z: ent.position.z, heading: ent.heading, speed: ent.speed }, stateBuf));
  }

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) {
      if (ws && ws.readyState === 1 && me) { ws.send(P.encodeHide('background')); lastSent = { hidden: true }; lastHide = performance.now(); }
    } else if (!ws && !givenUp) { backoff = 1000; connect(); }
  });

  // --- drawing, within the tier's budget
  const groundFor = (r, x, z) => cm.getGroundHeight(x, z, 'person', r.y);
  const drawn = [];
  function draw(dt) {
    const camera = ctx.camera;
    const t = performance.now() - (clockOffset ?? 0) - DELAY;
    drawn.length = 0;
    for (const r of remotes.values()) {
      const s = me && clockOffset !== null ? sampleAt(r, t) : null;
      const d = s ? Math.hypot(s.x - camera.position.x, s.z - camera.position.z) : Infinity;
      if (!s || d > NEAR) { r.shown = null; r.prevH = null; continue; }
      r.shown = Object.assign(r.shown || {}, s, { d });
      drawn.push(r);
    }
    drawn.sort((a, b) => a.shown.d - b.shown.d);
    if (drawn.length > MAX) drawn.length = MAX;

    let nCar = 0, nCarProxy = 0, nBike = 0, nHeli = 0, nHeliProxy = 0, nFull = 0;
    crowd.begin();
    for (const r of drawn) {
      const s = r.shown;
      const full = nFull < BUDGET.full && (s.mode !== MODE.helicopter || nHeli < BUDGET.heli);
      if (full) nFull++;
      // heading rate -> the rider's lean, as the player's (controllers.js updateCyclist)
      const rate = r.prevH === null ? 0 : wrap(s.heading - r.prevH) / Math.max(dt, 1e-3);
      r.prevH = s.heading;
      r.y = s.y;
      if (s.mode === MODE.car) {
        const mesh = full ? cars : carProxies, i = full ? nCar++ : nCarProxy++;
        mesh.setMatrixAt(i, _m.compose(_v.set(s.x, s.y, s.z), _q.setFromAxisAngle(UP, s.heading), _s));
        _c.setHex(PAINT[r.colour % PAINT.length]);
        mesh.geometry.attributes.paintColor.setXYZ(i, _c.r, _c.g, _c.b);
        const braking = r.lastSpeed !== undefined && Math.abs(s.speed) < Math.abs(r.lastSpeed) - 0.02 && Math.abs(s.speed) > 0.3;
        mesh.geometry.attributes.carState.setXYZW(i, braking ? 1 : 0, 0, 0, 0);
      } else if (s.mode === MODE.cyclist) {
        const turn = Math.max(-1, Math.min(1, rate / 2.15));
        r.lean += (-turn * Math.min(1, Math.abs(s.speed) / 9) * 0.34 - r.lean) * Math.min(1, dt * 9);
        if (s.speed > 0.5) r.pedal += (s.speed / 0.35) * dt / 3.2;
        _m.makeRotationY(s.heading).multiply(_m2.makeRotationZ(r.lean)).setPosition(s.x, s.y, s.z);
        for (const part of bikeParts) part.setMatrixAt(nBike, _m);
        if (!r.pivot) { r.pivot = new THREE.Object3D(); r.pivot.rotation.order = 'YXZ'; }
        r.pivot.position.set(s.x, s.y, s.z);
        r.pivot.rotation.set(0, s.heading, r.lean);
        const rig = rigOf(r, true);
        rig.ride(r.pivot, r.pedal, bikeFrame);
        crowd.add(rig, full ? s.d : Infinity);
        _m.compose(_v.copy(HELMET_OFFSET).applyQuaternion(rig.headQuaternion).add(rig.headPosition), rig.headQuaternion, HELMET_SCALE);
        helmets.setMatrixAt(nBike, _m);
        nBike++;
      } else if (s.mode === MODE.person) {
        const rig = rigOf(r, false);
        const ground = groundFor(r, s.x, s.z);
        rig.update(dt, s.x, s.z, s.heading, groundFor, r, s.y - ground > 0.02 ? s.y - ground : 0);
        crowd.add(rig, full ? s.d : Infinity);
      } else if (s.mode === MODE.helicopter) {
        const tilt = Math.max(-0.24, Math.min(0.24, (s.speed / 52) * 0.24));
        if (full) {
          const h = helis[nHeli++];
          h.mesh.position.set(s.x, s.y, s.z);
          h.mesh.rotation.y = s.heading;
          h.tiltPivot.rotation.x = tilt;
          h.mainRotorPivot.rotation.y += dt * 24;
          h.tailRotorPivot.rotation.x += dt * 32;
          h.mesh.visible = true;
        } else {
          _m.makeRotationY(s.heading).multiply(_m2.makeRotationX(tilt)).setPosition(s.x, s.y, s.z);
          heliProxies.setMatrixAt(nHeliProxy++, _m);
        }
      }
      r.lastSpeed = s.speed;
    }
    crowd.end();
    const counted = [[cars, nCar], [carProxies, nCarProxy], [heliProxies, nHeliProxy], [helmets, nBike], ...bikeParts.map((m) => [m, nBike])];
    for (const [mesh, n] of counted) {
      mesh.count = n;
      if (!n) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.geometry.attributes.paintColor) { mesh.geometry.attributes.paintColor.needsUpdate = true; mesh.geometry.attributes.carState.needsUpdate = true; }
    }
    for (let i = nHeli; i < helis.length; i++) helis[i].mesh.visible = false;
  }

  // Each remote walker or rider gets its own rig (dressed by its id); a mode change starts it afresh
  function rigOf(r, isRiding) {
    if (!r.rig) {
      const k = r.id;
      r.rig = new PersonRig({ seed: 3 + (k % 97) * 0.731, scale: 0.94 + (k % 7) * 0.02, female: k % 3 === 0, girth: 0.95 + (k % 5) * 0.04, hair: (k % 4) * 0.15 });
    }
    if (r.ridden !== isRiding) { r.rig.placed = false; r.ridden = isRiding; }
    return r.rig;
  }

  // --- the HUD: "N riding"; a click brings a friend (into a private room first), the x leaves a private room
  const elBtn = document.getElementById('btn-mp');
  const elCount = document.getElementById('mp-count');
  const elLeave = document.getElementById('btn-mp-leave');
  const elToast = document.getElementById('toast');
  let toastTimer = 0;
  function toast(text, ms = 3600) {
    if (!elToast) return;
    elToast.textContent = text;
    elToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elToast.classList.remove('show'), ms);
  }
  let shown = '';
  function renderHud() {
    if (!elBtn) return;
    const label = invite === 'pending' ? 'Starting your room…' : !me ? '' : riding > 1 ? `${riding} riding` : 'Just you';
    elBtn.hidden = !label;
    if (elLeave) elLeave.hidden = !me || !isPrivate(room);
    if (label === shown) return;
    shown = label;
    if (elCount) elCount.textContent = label;
  }

  function roomLink() {
    const p = cm.getActiveEntity().position;
    const at = privacy.linkAt() && !hideReason() ? `&at=${Math.round(p.x)},${Math.round(p.z)}` : '';
    return `${location.origin}${location.pathname}#room=${room}${at}`;
  }
  async function copyLink(afterSwitch) {
    const link = roomLink();
    const where = link.includes('&at=') ? '' : ' (it doesn’t include where you are while you’re hidden)';
    try {
      await navigator.clipboard.writeText(link);
      toast(`Link copied: send it to a friend to ride together${where}`);
    } catch {
      toast(afterSwitch ? 'Your room is ready: click again to copy the link' : link, 8000);
    }
  }
  function switchRoom(name) {
    if (ws) { const old = ws; ws = null; old.close(1000); }
    me = null;
    remotes.clear();
    riding = 0;
    room = name;
    givenUp = false;
    backoff = 1000;
    connect();
  }
  function backToPublic(message) {
    invite = null;
    setRoomInHash('public-1');
    toast(message);
    switchRoom('public-1');
    renderHud();
  }
  if (elBtn) elBtn.addEventListener('click', () => {
    if (invite === 'pending' || !ctx) return;
    if (me && isPrivate(room)) return copyLink(false);
    // from a public room: a new private room for the two of you; the link is copied once this player is in it
    invite = 'pending';
    renderHud();
    switchRoom(Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => String.fromCharCode(97 + (b % 26))).join(''));
  });
  if (elLeave) elLeave.addEventListener('click', () => {
    fromLink = false;
    setRoomInHash('public-1');
    switchRoom('public-1');
    renderHud();
  });

  return {
    // once the city is on screen (main.js), after the deep links
    start(context) {
      ctx = context;
      const h = hash();
      const asked = h.get('room');
      room = asked && P.isRoomName(asked) && isPrivate(asked) ? asked : 'public-1';
      fromLink = isPrivate(room);
      // #at (a friend's link) wins over the saved position; #place & #ride win over #at
      const at = (h.get('at') || '').split(',').map(Number);
      if (!h.has('place') && !h.has('ride') && at.length === 2 && at.every(Number.isFinite) && ctx.teleportTo) ctx.teleportTo(at[0], at[1]);
      connect();
    },
    // every frame, after the player moves
    update(dt) {
      if (!ctx || paused) return;
      const t0 = performance.now();
      const { ent, mode } = watchPlayer(dt);
      send(t0, ent, mode);
      draw(dt);
      cpu.frames[cpu.n++ % cpu.frames.length] = performance.now() - t0;
    },
    // the private zone, kept with the saved player state (main.js); never sent
    get privateZone() { return privacy.zone; },
    // measuring only (tools/mp-perf.mjs): nothing drawn and nothing sent while paused, in the same page
    setPaused(on) {
      paused = !!on;
      if (!paused) return;
      for (const mesh of [cars, carProxies, heliProxies, helmets, ...bikeParts]) mesh.count = 0;
      for (const h of helis) h.mesh.visible = false;
      crowd.begin();
      crowd.end();
    },
    get hidden() { return ctx ? !!hideReason() : false; },
    get room() { return room; },
    get me() { return me; },
    get riding() { return me ? riding : 0; },
    remotes,
    // main-thread time in multiplayer: per frame (update) over the last 600 frames, and in the message handlers since
    // the last read (spec: Performance budget and measurement)
    stats() {
      const n = Math.min(cpu.n, cpu.frames.length);
      const f = Array.from(cpu.frames.subarray(0, n)).sort((a, b) => a - b);
      const handlers = cpu.handlers;
      cpu.handlers = 0;
      return { frames: n, mean: n ? f.reduce((a, b) => a + b, 0) / n : 0, p95: n ? f[Math.floor(n * 0.95)] : 0, max: n ? f[n - 1] : 0, handlersMs: handlers, drawn: drawn.length };
    }
  };
}

Object.assign(window.CITY, { createMultiplayer });
})();
