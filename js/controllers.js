(function () {
// js/controllers.js
// Sculpted, non-blocky GTA 6-style 3D models, animations, and physics controllers
// for Third-Person Navigation:
// 1. Person (Skinned Pedestrian: planted-footstep IK walk/run/jump, see pedestrians.js)
// 2. Car (Aerodynamic Sculpted Sedan with Sloped Windshield & Clearcoat)
// 3. Cyclist (Sculpted Road Cyclist with Drop-Bar Frame & Aero Helmet)
// 4. Helicopter (Twin-Turbine Light Helicopter)

const { THREE } = window.CITY;
const { CITY_BOUNDS, TELEPORT_LOCATIONS, isTypingInField, blockAt, waterAt, terrainHeightAt, deckHeightAt } = window.CITY;
// Start on Yonge Street by Sankofa Square, heading north to Dundas (city-config.js TELEPORT_LOCATIONS)
const SPAWN = (TELEPORT_LOCATIONS && TELEPORT_LOCATIONS.start) || { x: 0, z: 140, heading: Math.PI };
const {
  cityUniforms,
  createCarPaintMaterial,
  createContactShadowMaterial
} = window.CITY;
const {
  BODY_SPECS,
  buildCarGeometry,
  buildCarSidePatch,
  buildSteerableWheelGeo,
  createLoftedCarMaterial,
  buildHelicopterBodyGeometry,
  buildHelicopterMainRotorGeometry,
  buildHelicopterTailRotorGeometry,
  createLoftedHelicopterMaterial
} = window.CITY;
const { PersonCrowd, PersonRig } = window.CITY;
const { HEADLIGHTS, createVehicleHeadlight, placeVehicleHeadlight } = window.CITY;
// Walking surface for the player's pedestrian (its rig samples it around its feet)
const personGround = (controllers, x, z) => controllers.getGroundHeight(x, z, 'person', controllers.entities ? controllers.entities.person.position.y : null);

// --- Driving
// The bicycle (mrdoob's f3132b6 & 0e92315): constant rolling resistance, quadratic air drag and, off the pedals, a
// little extra coasting resistance, kept apart from braking; boost adds power, and letting it go lets the momentum
// decay instead of clamping it. (Backward input is scaled to 0.6, giving 4.5 m/s² braking.)
const BICYCLE_DRIVE = {
  speed: 12.8, boostSpeed: 19, reverseSpeed: 4.5, acceleration: 9, boostAcceleration: 13.5,
  rolling: 0.08, drag: 0.004, coast: 0.2, brake: 7.5
};

function driveSpeed(speed, throttle, boost, dt, drive) {
  const braking = speed * throttle < 0;
  const magnitude = Math.abs(speed);
  const deceleration = drive.rolling + (!throttle ? drive.coast : braking ? Math.abs(throttle) * drive.brake : 0);
  // (without crossing zero or large-dt instability)
  const coasting = Math.max(0, magnitude - deceleration * dt) / (1 + drive.drag * magnitude * dt);
  if (!throttle || braking) return Math.sign(speed) * coasting;
  const limit = throttle < 0 ? drive.reverseSpeed : boost ? drive.boostSpeed : drive.speed;
  const acceleration = boost ? drive.boostAcceleration : drive.acceleration;
  return Math.sign(throttle) * Math.min(Math.max(limit, coasting), coasting + Math.abs(throttle) * acceleration * dt);
}

// The car's powertrain (aalghooneh/slop-toronto f464ec8, MIT, modelled on a 2.0 L turbo crossover): 400 N·m from
// 1,500 rpm, ~188 kW, a six-speed automatic and all-wheel drive moving ~1,800 kg. Nothing caps its speed: it runs out
// of power against the air near 230 km/h; 0-100 km/h in about 7 s floored, 100-0 in about 40 m
const CAR_POWERTRAIN = {
  mass: 1800, wheelRadius: 0.35, finalDrive: 3.5, efficiency: 0.85,
  gears: [4.48, 2.87, 1.84, 1.41, 1.0, 0.74], reverse: 3.8,
  idle: 800, stall: 2200, redline: 6300, reverseLimit: 3000, peakTorque: 400, peakPower: 188000,
  shiftTime: 0.28, // the drive is cut while the box changes gear
  traction: 5.2, // m/s²: what the tyres (and the traction control) put down pulling away, all four driven
  drag: 3.06e-4, // ½ ρ Cd A / m (Cd A ≈ 0.9 m²): a = drag v²
  rolling: 0.13, // m/s²: tyre rolling resistance
  brake: 9.5, handbrake: 7
};
const RPM_PER_MS = 60 / (2 * Math.PI * CAR_POWERTRAIN.wheelRadius); // wheel rpm per m/s

// Full-load engine torque (N·m): building to the plateau off idle, then held to peak power
function engineTorque(rpm) {
  const E = CAR_POWERTRAIN;
  const r = Math.max(E.idle, Math.min(E.redline, rpm));
  const plateau = r < 1500 ? E.peakTorque * (0.6 + 0.4 * (r - E.idle) / (1500 - E.idle)) : E.peakTorque;
  return Math.min(plateau, E.peakPower / (r * Math.PI / 30));
}

// One step of the car's longitudinal motion: picks the gear like an automatic (holding gears to the redline with the
// pedal floored, short-shifting when cruising, kicking down for power), drives the wheels through it, and takes off the
// air drag, rolling resistance and engine braking. `throttle` -1..1 (backward brakes, then reverses); `pedal` 0..1.
// Leaves c.gear (-1 reverse), c.rpm and c.shiftTimer for the sound and the dashboard; returns the new speed
function driveCar(c, throttle, pedal, dt) {
  const E = CAR_POWERTRAIN;
  const v = c.speed;
  if (!Number.isInteger(c.gear)) c.gear = 0;
  const braking = throttle * v < 0 && Math.abs(v) > 0.3;
  if (!braking) {
    if (throttle < 0 && v <= 0.3) c.gear = -1;
    else if (throttle > 0 && v >= -0.3 && c.gear < 0) c.gear = 0;
  }
  c.shiftTimer = Math.max(0, (c.shiftTimer || 0) - dt);
  const wheelRpm = Math.abs(v) * RPM_PER_MS;
  const ratioOf = (g) => (g < 0 ? E.reverse : E.gears[g]) * E.finalDrive;
  if (c.gear >= 0 && !c.shiftTimer) {
    const up = pedal > 0.95 ? E.redline - 250 : 2200 + pedal * 3000;
    const down = pedal > 0.95 ? E.redline - 1500 : 1300 + pedal * 1800;
    if (c.gear < E.gears.length - 1 && wheelRpm * ratioOf(c.gear) > up) {
      c.gear++;
      c.shiftTimer = E.shiftTime;
    } else if (c.gear > 0 && wheelRpm * ratioOf(c.gear) < down && wheelRpm * ratioOf(c.gear - 1) < up * 0.9) {
      c.gear--;
      c.shiftTimer = pedal > 0 ? E.shiftTime * 0.7 : 0;
    }
  }
  const ratio = ratioOf(c.gear);
  // (the torque converter lets the engine spin up ahead of the wheels pulling away, to its stall speed)
  const rpm = Math.max(wheelRpm * ratio, !braking && pedal > 0 ? E.stall : E.idle);
  c.rpm = Math.min(E.redline, rpm);

  let push = 0; // along the gear's direction of travel
  if (!braking && pedal > 0 && !c.shiftTimer && rpm < (c.gear < 0 ? E.reverseLimit : E.redline)) {
    // (the spinning engine & wheels add to the mass to get moving, the more so in the low gears)
    const inertia = 1.04 + 0.004 * (ratio / E.finalDrive) ** 2;
    push = Math.min(E.traction, (engineTorque(rpm) * pedal * ratio * E.efficiency) / (E.wheelRadius * E.mass * inertia));
  }
  // what slows it: the brakes, the air, the tyres and, off the pedal, the engine held by the gearbox
  let resist = E.rolling + E.drag * v * v;
  if (braking) resist += E.brake * Math.abs(throttle);
  else if (!pedal) resist += ((20 + 0.012 * rpm) * ratio * E.efficiency) / (E.wheelRadius * E.mass);
  const dir = c.gear < 0 ? -1 : 1;
  let next = v + dir * push * dt;
  const slow = resist * dt;
  next = Math.abs(next) <= slow ? (push ? next : 0) : next - Math.sign(next) * slow;
  return next;
}

// Crash damage (aalghooneh/slop-toronto 0557fbb & 26da63c, MIT): an impact at `speed` m/s (closing speed along the
// contact normal) takes this much of the car's 100 condition. Bumps & scrapes under ~15 km/h are free; a 50 km/h wall
// costs about a tenth, a 100 km/h one about 40, so it takes a few big crashes to wreck it. The frames of one crash
// (grinding along a wall, bouncing back into it) count once: within `window` s only what a harder impact adds is taken
const CRASH = { threshold: 4, scale: 0.35, exponent: 1.5, window: 0.6, wreckTime: 3.5 };
function crashDamage(speed) {
  return speed > CRASH.threshold ? CRASH.scale * (speed - CRASH.threshold) ** CRASH.exponent : 0;
}
// --- end driving

// --- World contact (js/world-collision.js, after unable12/slop-sanfrancisco's, MIT): the player's body is the sedan's own
// tapered outline driving, a circle walking, cycling & flying, against each collider's outline (a landmark's polygon,
// a turned box, or the bounds). Only parts whose height range [minY, maxY] meets the body's [y + bottom, y + top]
// collide, so the road cuts, the underpasses, the decks & the tunnels keep working. Movement is cut into substeps no
// longer than STEP (the car's also bounded by how far its bumper swings turning), so nothing thin is stepped over at
// speed or when a frame takes long; each contact pushes the body out, takes away the motion into the wall and keeps the
// motion along it (sliding)
const G = window.CITY.WorldCollision;
const BODY_RADIUS = { person: 0.48, cyclist: 0.65, helicopter: 4.5 };
const HELI_BAND = [-0.25, 3.2], CAR_BAND = [0, 1.8], FOOT_BAND = [0, 1.9];
const bodyBand = (mode) => (mode === 'helicopter' ? HELI_BAND : mode === 'car' ? CAR_BAND : FOOT_BAND);
const meets = (c, y, band) => !(y + band[0] >= c.maxY || y + band[1] <= (c.minY ?? 0));
const STEP = { car: 0.2, person: 0.2, cyclist: 0.25, helicopter: 1.0 };
// --- end world contact

// Ontario number plate: white, blue lettering, "ONTARIO" along the top and the province's "YOURS TO DISCOVER" along the
// bottom
function createOntarioPlateTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f6f7f4';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#1d3f8f';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, 250, 122);
  ctx.fillStyle = '#1d3f8f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 17px Inter, Arial, sans-serif';
  ctx.fillText('ONTARIO', 128, 22);
  ctx.font = '900 46px JetBrains Mono, monospace';
  ctx.fillText('CNTW 553', 128, 68);
  ctx.font = '700 12px Inter, Arial, sans-serif';
  ctx.fillText('YOURS TO DISCOVER', 128, 110);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class ThirdPersonControllerManager {
  constructor(scene, colliders = []) {
    this.scene = scene;
    this.colliders = colliders;
    this._colliderCells = null; // built on first use, see nearColliders()
    this.activeMode = 'car'; // 'person' | 'car' | 'cyclist' | 'helicopter'

    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
      boost: false
    };

    this.entities = {
      person: this.createPersonEntity(),
      car: this.createCarEntity(),
      cyclist: this.createCyclistEntity(),
      helicopter: this.createHelicopterEntity()
    };
    // whatever the car runs into (buildings here; traffic & pedestrians in traffic.js) damages it (CRASH)
    this.entities.car.takeHit = (speed) => this.damageCar(speed);

    Object.values(this.entities).forEach((ent) => {
      if (ent.mesh) {
        ent.mesh.traverse((child) => {
          if (
            child.isMesh &&
            !child.material?.isMeshBasicNodeMaterial &&
            child.material?.type !== 'MeshBasicNodeMaterial' &&
            !child.material?.transparent
          ) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
      }
    });

    this.bindKeyboard();
  }

  bindKeyboard() {
    const bindings = {
      forward: ['KeyW', 'ArrowUp'],
      backward: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      up: ['Space', 'KeyE'],
      down: ['KeyQ', 'KeyC'],
      boost: ['ShiftLeft', 'ShiftRight']
    };
    const actionsByCode = new Map(Object.entries(bindings).flatMap(([action, codes]) => codes.map((code) => [code, action])));
    this._pressedCodes = new Set();
    this._keyboardKeys = {};
    this._touchKeys = {};
    this._gamepadKeys = {};

    const onKey = (e, isDown) => {
      const action = actionsByCode.get(e.code);
      if (!action || (isDown && isTypingInField(e))) return;
      if (isDown) this._pressedCodes.add(e.code);
      else this._pressedCodes.delete(e.code);
      // Releasing one binding must not cancel another key held for the same action.
      this._keyboardKeys[action] = bindings[action].some((code) => this._pressedCodes.has(code));
      this._blendInput(action);
    };

    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => this.resetInput());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetInput();
    });
  }

  // Keyboard, touch and gamepad (gamepad-controls.js) blend per action: a held key or button wins outright, else the
  // strongest analog value (a stick or a trigger part-way)
  _blendInput(action) {
    const keyboard = this._keyboardKeys[action] || false;
    const touch = this._touchKeys[action] || false;
    const gamepad = this._gamepadKeys[action] || false;
    const strength = Math.max(keyboard, touch, gamepad);
    this.keys[action] = keyboard === true || touch === true || gamepad === true ? true : strength || false;
  }

  _setAnalogInput(source, action, value) {
    if (!Object.hasOwn(this.keys, action)) return;
    const strength = Number(value);
    source[action] = typeof value === 'boolean' ? value : Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
    this._blendInput(action);
  }

  setTouchInput(action, value) {
    this._setAnalogInput(this._touchKeys, action, value);
  }

  setGamepadInput(action, value) {
    this._setAnalogInput(this._gamepadKeys, action, value);
  }

  clearTouchInput() {
    this._touchKeys = {};
    for (const action of Object.keys(this.keys)) this._blendInput(action);
  }

  clearGamepadInput() {
    this._gamepadKeys = {};
    for (const action of Object.keys(this.keys)) this._blendInput(action);
  }

  resetInput() {
    this._pressedCodes.clear();
    this._keyboardKeys = {};
    this._touchKeys = {};
    this._gamepadKeys = {};
    for (const action of Object.keys(this.keys)) this.keys[action] = false;
  }

  setMode(mode) {
    if (!this.entities[mode]) return;
    this.activeMode = mode;
    // a wrecked car restarts where this drive began
    if (mode === 'car') this.entities.car.home = { x: this.entities.car.position.x, z: this.entities.car.position.z, heading: this.entities.car.heading };
  }

  getActiveEntity() {
    return this.entities[this.activeMode];
  }

  // savedAltitude: the helicopter's height on a restored visit (main.js), else it arrives at a safe 92 m or more
  teleportActiveTo(x, z, heading = Math.PI, savedAltitude = null) {
    const ent = this.getActiveEntity();
    this.resetInput();
    if (!Number.isFinite(heading)) heading = ent.heading;
    const heli = this.activeMode === 'helicopter';
    const altitude = heli ? Math.max(0.25, Math.min(380, savedAltitude ?? Math.max(92, ent.position.y))) : 0;
    const destination = this.findTeleportPosition(x, z, heading, altitude);
    if (destination) {
      ent.position.x = destination.x;
      ent.position.z = destination.z;
      ent.heading = heading;
      ent.position.y = heli ? altitude : this.getGroundHeight(destination.x, destination.z, this.activeMode);
    }
    ent.speed = 0;
    if (this.activeMode === 'person') {
      ent.verticalVel = 0;
      ent.rig.reset(ent.position.x, ent.position.z, ent.heading, personGround, this);
      ent.crowd.begin();
      ent.crowd.add(ent.rig, 0);
      ent.crowd.end();
    } else if (this.activeMode === 'car') {
      ent.vx = ent.vz = ent.angularVel = ent.steerAngle = ent.skid = ent.gear = ent.shiftTimer = 0;
      ent.rpm = CAR_POWERTRAIN.idle;
      ent.home = { x: ent.position.x, z: ent.position.z, heading: ent.heading };
      ent.pitchVel = ent.rollVel = ent.heaveY = ent.heaveVel = 0;
      ent.chassisPivot.rotation.x = ent.chassisPivot.rotation.z = 0;
      ent.chassisPivot.position.y = 0;
      ent.lastCollisionSpark = null;
      for (const wheel of ent.wheels) if (wheel.isFront) wheel.steerPivot.rotation.y = 0;
      if (ent.carState) ent.carState.value.x = 1;
    } else if (this.activeMode === 'cyclist') {
      ent.leanAngle = ent.leanPivot.rotation.z = 0;
    } else if (heli) {
      ent.verticalSpeed = ent.pitchAngle = ent.rollAngle = 0;
      ent.tiltPivot.rotation.x = ent.tiltPivot.rotation.z = 0;
      ent.tiltPivot.position.y = 0;
    }
    ent.mesh.position.copy(ent.position);
    ent.mesh.rotation.y = ent.heading;
    return { x: ent.position.x, z: ent.position.z };
  }

  // Find a fully clear arrival before moving the player. Sequential collision pushes can leave a player trapped
  // between overlapping buildings, so test whole candidate footprints instead; retain the old position if none fits.
  // exact: only (x, z) itself (null if it isn't clear), no search round it
  findTeleportPosition(x, z, heading, altitude, exact = false) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const heli = this.activeMode === 'helicopter';
    const car = this.activeMode === 'car';
    const radius = BODY_RADIUS[this.activeMode] || 0.48;
    const sinH = Math.sin(heading), cosH = Math.cos(heading);
    const band = bodyBand(this.activeMode);
    const margin = heli ? 6000 : 0;
    const entity = this.getActiveEntity();
    // Conservative body cylinders, including the taxi's corners, bicycle wheels and helicopter tail/rotor.
    const body = { person: [0.48, 1.9], car: [2.4, 1.9], cyclist: [1.0, 1.9], helicopter: [6.2, 3.2] };
    const others = Object.values(this.entities).filter(e => e !== entity).map(e => ({
      x: e.position.x, z: e.position.z, radius: body[e.type][0],
      bottom: e.position.y - (e.type === 'helicopter' ? 0.7 : 0), top: e.position.y + body[e.type][1]
    }));
    const cameraBack = Math.cos(0.09) * entity.chaseDistance;
    const cameraUp = entity.chaseHeight + Math.sin(0.09) * entity.chaseDistance * 0.85;
    const clampPoint = (px, pz) => {
      const m = heli ? margin : -8;
      pz = Math.max(CITY_BOUNDS.minZ - m, Math.min(CITY_BOUNDS.maxZ + m, pz));
      px = Math.max(CITY_BOUNDS.minX - m, Math.min(CITY_BOUNDS.maxX + m, px));
      if (!heli && waterAt(px, pz)) return null; // not in a lake
      if (!heli && window.CITY.subwayCutAt && window.CITY.subwayCutAt(px, pz, 1, false)) return null; // nor down a subway cut (subway.js)
      return { x: px, z: pz };
    };
    const clear = (p) => {
      if (!p) return false;
      const baseY = heli ? altitude : this.getGroundHeight(p.x, p.z, this.activeMode);
      // Keep other player models out of both the arrival and its default chase view. A corridor also prevents a
      // parked car between camera and character from hiding the character even when the camera itself is outside it.
      const viewTop = baseY + Math.max(body[entity.type][1], cameraUp);
      for (const other of others) {
        if (other.bottom > viewTop + 0.3 || other.top < baseY - (heli ? 0.7 : 0) - 0.3) continue;
        const dx = other.x - p.x, dz = other.z - p.z;
        const back = Math.max(0, Math.min(cameraBack, -dx * sinH - dz * cosH));
        if (Math.hypot(dx + sinH * back, dz + cosH * back) < other.radius + Math.max(body[entity.type][0], 0.5) + 0.1) return false;
      }
      const shape = car ? (this._arrivalCar = G.carShape(p.x, p.z, heading, 0.1, this._arrivalCar))
        : (this._arrivalCircle = G.circleShape(p.x, p.z, radius + 0.1, this._arrivalCircle));
      for (const c of this.nearColliders(p.x, p.z, shape.reach)) {
        if (meets(c, baseY, band) && G.contact(shape, c)) return false;
      }
      return true;
    };
    const origin = clampPoint(x, z);
    if (exact) return origin && Math.hypot(origin.x - x, origin.z - z) < 0.01 && clear(origin) ? origin : null;
    if (clear(origin)) return origin;
    // Four-metre rings cover nearby streets and courtyards, with bounded work even for a click inside a large block.
    const cx = origin ? origin.x : Math.max(CITY_BOUNDS.minX + 8, Math.min(CITY_BOUNDS.maxX - 8, x));
    const cz = origin ? origin.z : Math.max(CITY_BOUNDS.minZ + 8, Math.min(CITY_BOUNDS.maxZ - 8, z));
    for (let distance = 4; distance <= 256; distance += 4) {
      for (let i = 0; i < 32; i++) {
        const angle = i * Math.PI / 16;
        const p = clampPoint(cx + Math.cos(angle) * distance, cz + Math.sin(angle) * distance);
        if (clear(p)) return p;
      }
    }
    return null;
  }

  // The R key: back onto the nearest road, clear of everything, facing along it: the way it runs if one-way, else the
  // way nearer the player's heading. Toronto drives on the right: the car in the right-hand lane of a two-way street,
  // the bicycle and the walker by its right-hand curb. Raised roads (on a deck) don't count, nor, walking or cycling,
  // the expressways. { x, z, heading }, or null (flying, or nothing clear within 400 m)
  findRoadReset() {
    const mode = this.activeMode;
    if (mode === 'helicopter' || !window.CITY.nearestRoads) return null;
    const ent = this.getActiveEntity(), x = ent.position.x, z = ent.position.z;
    const fwdX = Math.sin(ent.heading), fwdZ = Math.cos(ent.heading);
    const tried = new Set();
    for (const radius of [40, 120, 400]) {
      for (const near of window.CITY.nearestRoads(x, z, radius)) {
        const road = near.road, pts = road.pts;
        if (tried.has(road) || road.raised || (mode !== 'car' && road.highway) || pts.length < 2) continue;
        tried.add(road);
        // the nearest point as a distance along the road, then outward from it both ways, every 3 m up to 60 m
        const len = [0];
        let at = 0, best = Infinity;
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (l * l)));
          const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
          if (d < best) { best = d; at = len[i] + t * l; }
          len.push(len[i] + l);
        }
        const half = (road.w || 7) / 2;
        const lateral = mode === 'car' ? (road.dir ? 0 : Math.min(half * 0.5, 3.6)) : Math.max(0, half - (mode === 'cyclist' ? 1.4 : 1.0));
        for (let k = 0; k <= 40; k++) {
          const s = at + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 3;
          if (s < 0 || s > len[len.length - 1]) continue;
          let i = 0;
          while (i + 2 < len.length && len[i + 1] < s) i++;
          const a = pts[i], b = pts[i + 1], l = len[i + 1] - len[i] || 1e-9, ux = (b.x - a.x) / l, uz = (b.z - a.z) / l;
          const qx = a.x + ux * (s - len[i]), qz = a.z + uz * (s - len[i]);
          const back = road.dir < 0 || (!road.dir && ux * fwdX + uz * fwdZ < 0);
          const fx = back ? -ux : ux, fz = back ? -uz : uz, heading = Math.atan2(fx, fz);
          for (const off of [lateral, lateral * 0.5, 0]) {
            const px = qx - fz * off, pz = qz + fx * off; // (to the right of the way it faces)
            if (this.findTeleportPosition(px, pz, heading, 0, true)) return { x: px, z: pz, heading };
            if (!off) break;
          }
        }
      }
    }
    return null;
  }

  // =========================================================================
  // 1. PERSON (SKINNED PEDESTRIAN WITH PLANTED-FOOTSTEP IK GAIT, see pedestrians.js)
  // =========================================================================
  createPersonEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerPerson';

    // One skinned person, posed in world space every frame by its rig (walk, run, turn, jump)
    const crowd = new PersonCrowd(1, { farDistance: Infinity });
    crowd.meshes.forEach((m) => this.scene.add(m));
    const rig = new PersonRig({ seed: 4.2, scale: 1.0, girth: 1.02, hair: 0.18, armSwing: 1.0 });

    // Soft Under-Foot Contact Shadow (AO)
    const shadowGeo = new THREE.PlaneGeometry(0.95, 0.95);
    shadowGeo.rotateX(-Math.PI * 0.5);
    const pedShadow = new THREE.Mesh(shadowGeo, createContactShadowMaterial());
    pedShadow.position.y = 0.02;
    pedShadow.renderOrder = 998;
    root.add(pedShadow);

    this.scene.add(root);

    return {
      type: 'person',
      label: 'Pedestrian',
      mesh: root,
      crowd,
      rig,
      position: new THREE.Vector3(SPAWN.x - Math.cos(SPAWN.heading) * 2.4, 0.0, SPAWN.z + Math.sin(SPAWN.heading) * 2.4),
      heading: SPAWN.heading,
      speed: 0,
      verticalVel: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.55, 0),
      chaseDistance: 4.3,
      chaseHeight: 1.95
    };
  }

  // =========================================================================
  // 2. CAR (3D LOFTED SCULPTED SEDAN, A DEEP RED)
  // =========================================================================
  createCarEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerTaxiCar';

    const chassisPivot = new THREE.Group();
    root.add(chassisPivot);

    const spec = BODY_SPECS.sedan;
    const taxiLoftMat = createLoftedCarMaterial(spec, 0x9e1b22);

    // 1. 3D Lofted Taxi Body + Curved Windscreens + Crowned Roof + Side Mirrors + Roof Sign
    const carBodyGeo = buildCarGeometry(spec, false);
    const carBodyMesh = new THREE.Mesh(carBodyGeo, taxiLoftMat);
    carBodyMesh.castShadow = true;
    carBodyMesh.receiveShadow = true;
    chassisPivot.add(carBodyMesh);

    // 2. Ontario number plates on the bumpers
    const plateMat = new THREE.MeshStandardNodeMaterial({ map: createOntarioPlateTexture(), roughness: 0.28 });
    const rearPlate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.15, 0.02), plateMat);
    rearPlate.position.set(0, spec.plates[1], spec.zRear - 0.006);
    chassisPivot.add(rearPlate);

    const frontPlate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.15, 0.02), plateMat);
    frontPlate.position.set(0, spec.plates[0], spec.zFront + 0.006);
    chassisPivot.add(frontPlate);

    // 3b. Brake lights, CHMSL & turn signals are lit by the taxi material from its carState uniform (see updateCar)
    const carState = taxiLoftMat.userData.carState;

    // 4. Steerable & Spinning 3D LatheGeometry Tyres + Recessed 5-Spoke Alloy Wheels
    const leftWheelGeo = buildSteerableWheelGeo(spec, -1);
    const rightWheelGeo = buildSteerableWheelGeo(spec, 1);

    const wheels = [];
    const wheelCoords = [
      { side: -1, z: spec.wheelZ, isFront: true },
      { side: 1, z: spec.wheelZ, isFront: true },
      { side: -1, z: -spec.wheelZ, isFront: false },
      { side: 1, z: -spec.wheelZ, isFront: false }
    ];
    for (const wc of wheelCoords) {
      const steerPivot = new THREE.Group();
      steerPivot.position.set(wc.side * spec.wheelX, spec.wheelRadius, wc.z);
      const tire = new THREE.Mesh(wc.side < 0 ? leftWheelGeo : rightWheelGeo, taxiLoftMat);
      tire.castShadow = true;
      tire.receiveShadow = true;
      steerPivot.add(tire);
      root.add(steerPivot);
      wheels.push({ steerPivot, tire, isFront: wc.isFront });
    }

    // 5. Soft Under-Car Contact Shadow (AO) + Clustered Dual LED Headlight SpotLights & Rear Brake PointLight
    const carShadowGeo = new THREE.PlaneGeometry(2.22, 5.05);
    carShadowGeo.rotateX(-Math.PI * 0.5);
    const carShadow = new THREE.Mesh(carShadowGeo, createContactShadowMaterial());
    carShadow.position.set(0, 0.02, 0.0);
    carShadow.renderOrder = 998;
    root.add(carShadow);

    const headLights = [];
    for (const side of [-1, 1]) {
      const spot = createVehicleHeadlight();
      placeVehicleHeadlight(spot, spec, side);
      chassisPivot.add(spot, spot.target);
      headLights.push(spot);
    }

    this.scene.add(root);

    return {
      type: 'car',
      label: 'Car',
      mesh: root,
      chassisPivot,
      carState,
      headLights,
      wheels,
      position: new THREE.Vector3(SPAWN.x, 0.0, SPAWN.z),
      heading: SPAWN.heading,
      speed: 0,
      vx: 0,
      vz: 0,
      angularVel: 0,
      pitchVel: 0,
      rollVel: 0,
      heaveY: 0,
      heaveVel: 0,
      lastCollisionSpark: null,
      steerAngle: 0,
      wheelSpin: 0,
      skid: 0, // 0..1 how hard it slides (tyre squeal)
      gear: 0, // -1 reverse (CAR_POWERTRAIN)
      rpm: CAR_POWERTRAIN.idle,
      shiftTimer: 0,
      health: 100, // 0 wrecks it (CRASH)
      wrecked: 0, // seconds until a wrecked car restarts
      lastCrash: null,
      home: { x: SPAWN.x, z: SPAWN.z, heading: SPAWN.heading },
      cameraTargetOffset: new THREE.Vector3(0, 0.96, 0),
      chaseDistance: 6.9,
      chaseHeight: 2.12
    };
  }

  // =========================================================================
  // 3. CYCLIST (3D LOFTED RIDER + ROAD/CITI BICYCLE)
  // =========================================================================
  createCyclistEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerCyclist';

    const leanPivot = new THREE.Group();
    root.add(leanPivot);

    const frameMat = createCarPaintMaterial(0x0078e8);
    const tireMat = new THREE.MeshStandardNodeMaterial({
      color: 0x181a1e,
      roughness: 0.60
    });
    const chromeMat = new THREE.MeshStandardNodeMaterial({
      color: 0xe0e8f0,
      roughness: 0.16,
      metalness: 0.78
    });
    const shortsMat = new THREE.MeshStandardNodeMaterial({
      color: 0x1c2028,
      roughness: 0.55
    });
    const helmetMat = new THREE.MeshStandardNodeMaterial({
      color: 0xf4f7fb,
      emissive: 0x181c22,
      roughness: 0.22,
      metalness: 0.25
    });

    const wheelTorusGeo = new THREE.TorusGeometry(0.35, 0.038, 12, 24);
    wheelTorusGeo.rotateY(Math.PI * 0.5);
    const rimTorusGeo = new THREE.TorusGeometry(0.31, 0.018, 8, 24);
    rimTorusGeo.rotateY(Math.PI * 0.5);

    const frontWheel = new THREE.Mesh(wheelTorusGeo, tireMat);
    frontWheel.add(new THREE.Mesh(rimTorusGeo, chromeMat));
    frontWheel.position.set(0, 0.38, 0.58);
    leanPivot.add(frontWheel);

    const rearWheel = new THREE.Mesh(wheelTorusGeo, tireMat);
    rearWheel.add(new THREE.Mesh(rimTorusGeo, chromeMat));
    rearWheel.position.set(0, 0.38, -0.58);
    leanPivot.add(rearWheel);

    // Rear red LED safety strobe on seatpost
    const tailLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff1e26 })
    );
    tailLed.position.set(0, 0.86, -0.32);
    leanPivot.add(tailLed);

    const topTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 10), frameMat);
    topTube.rotation.x = Math.PI * 0.46;
    topTube.position.set(0, 0.78, 0.04);
    leanPivot.add(topTube);

    const downTube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.78, 10), frameMat);
    downTube.rotation.x = Math.PI * 0.28;
    downTube.position.set(0, 0.58, 0.16);
    leanPivot.add(downTube);

    const seatTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.64, 10), frameMat);
    seatTube.rotation.x = -0.22;
    seatTube.position.set(0, 0.66, -0.22);
    leanPivot.add(seatTube);

    const saddle = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 8, 10), shortsMat);
    saddle.rotation.x = Math.PI * 0.5;
    saddle.scale.set(1.15, 1.0, 0.55);
    saddle.position.set(0, 0.96, -0.28);
    leanPivot.add(saddle);

    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.68, 10), chromeMat);
    fork.rotation.x = -0.24;
    fork.position.set(0, 0.68, 0.48);
    leanPivot.add(fork);

    const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.48, 10), chromeMat);
    handlebar.rotation.z = Math.PI * 0.5;
    handlebar.position.set(0, 0.98, 0.40);
    leanPivot.add(handlebar);

    // Pedal cranks at the bottom bracket (they turn with the pedal phase, the pedals stay level)
    const bikeFrame = {
      seat: new THREE.Vector3(0, 0.98, -0.28),
      bars: new THREE.Vector3(0, 0.98, 0.4),
      gripHalf: 0.22,
      bracket: new THREE.Vector3(0, 0.34, -0.145),
      crankLength: 0.17
    };
    const crankPivot = new THREE.Group();
    crankPivot.position.copy(bikeFrame.bracket);
    const crankGeo = new THREE.BoxGeometry(0.016, bikeFrame.crankLength, 0.03).translate(0, -bikeFrame.crankLength / 2, 0);
    const pedalGeo = new THREE.BoxGeometry(0.09, 0.018, 0.07);
    const pedals = [];
    for (const side of [1, -1]) {
      const arm = new THREE.Group();
      arm.rotation.x = side > 0 ? 0 : Math.PI;
      const crank = new THREE.Mesh(crankGeo, chromeMat);
      crank.position.x = side * 0.065;
      const pedal = new THREE.Mesh(pedalGeo, tireMat);
      pedal.position.set(side * 0.1, -bikeFrame.crankLength, 0);
      arm.add(crank, pedal);
      crankPivot.add(arm);
      pedals.push(pedal);
    }
    leanPivot.add(crankPivot);

    // Skinned rider (see pedestrians.js), posed every frame with its hands on the grips and feet on the pedals; the
    // helmet rides on its head
    const riderCrowd = new PersonCrowd(1, { farDistance: Infinity });
    riderCrowd.meshes.forEach((m) => this.scene.add(m));
    const riderRig = new PersonRig({ seed: 12.8, scale: 1.0, girth: 0.97, hair: 0.1 });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 12), helmetMat);
    helmet.scale.set(0.95, 0.68, 1.28);
    this.scene.add(helmet);

    const bikeShadowGeo = new THREE.PlaneGeometry(0.85, 2.25);
    bikeShadowGeo.rotateX(-Math.PI * 0.5);
    const bikeShadow = new THREE.Mesh(bikeShadowGeo, createContactShadowMaterial());
    bikeShadow.position.set(0, 0.02, 0.0);
    bikeShadow.renderOrder = 998;
    root.add(bikeShadow);

    const headLight = new THREE.SpotLight(0xf2f7ff, 0, 20, 0.34, 0.76, 1.25);
    headLight.position.set(0, 1.32, 0.62);
    headLight.target.position.set(0, 0.0, 7.6);
    leanPivot.add(headLight, headLight.target);

    this.scene.add(root);

    return {
      type: 'cyclist',
      label: 'Cyclist',
      mesh: root,
      leanPivot,
      frontWheel,
      rearWheel,
      crankPivot,
      pedals,
      bikeFrame,
      riderCrowd,
      riderRig,
      helmet,
      headLight,
      position: new THREE.Vector3(SPAWN.x + Math.sin(SPAWN.heading) * 9, 0.0, SPAWN.z + Math.cos(SPAWN.heading) * 9),
      heading: SPAWN.heading,
      heading: 0,
      speed: 0,
      leanAngle: 0,
      pedalPhase: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.35, 0),
      chaseDistance: 4.8,
      chaseHeight: 2.05
    };
  }

  // =========================================================================
  // 4. HELICOPTER (3D LOFTED MANHATTAN SIGHTSEEING TWIN-TURBINE CHOPPER)
  // =========================================================================
  createHelicopterEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerHelicopter';

    const tiltPivot = new THREE.Group();
    root.add(tiltPivot);

    const heliLoftMat = createLoftedHelicopterMaterial();
    const blurDiscMat = new THREE.MeshBasicNodeMaterial({
      color: 0xc8d8e8,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    // 1. 3D Lofted Monocoque Fuselage + Tailboom + Twin-Turbine Cowling + Swept Fin + Stabilizers + Tubular Skids
    const heliBodyGeo = buildHelicopterBodyGeometry();
    const heliBodyMesh = new THREE.Mesh(heliBodyGeo, heliLoftMat);
    heliBodyMesh.castShadow = true;
    heliBodyMesh.receiveShadow = true;
    tiltPivot.add(heliBodyMesh);

    // 2. 4-Blade Main Rotor Assembly with Swashplate, Hub Dome & Yellow Safety Blade Tips
    const mainRotorPivot = new THREE.Group();
    mainRotorPivot.position.set(0, 2.66, -0.35);
    const mainRotorGeo = buildHelicopterMainRotorGeometry();
    const mainRotorMesh = new THREE.Mesh(mainRotorGeo, heliLoftMat);
    mainRotorMesh.castShadow = true;
    mainRotorPivot.add(mainRotorMesh);

    const blurDisc = new THREE.Mesh(new THREE.CylinderGeometry(4.85, 4.85, 0.015, 32), blurDiscMat);
    mainRotorPivot.add(blurDisc);
    tiltPivot.add(mainRotorPivot);

    // 3. 4-Blade Tail Rotor Assembly on Swept Vertical Fin
    const tailRotorPivot = new THREE.Group();
    tailRotorPivot.position.set(0.18, 2.02, -5.62);
    const tailRotorGeo = buildHelicopterTailRotorGeometry();
    const tailRotorMesh = new THREE.Mesh(tailRotorGeo, heliLoftMat);
    tailRotorPivot.add(tailRotorMesh);
    tiltPivot.add(tailRotorPivot);

    // 4. FAA Port (Red), Starboard (Green) & Anti-Collision Fin Beacon (Red) Navigation Strobes
    const navRed = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff2b2b })
    );
    navRed.position.set(-1.09, 1.54, -4.35);
    const navGreen = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0x22ff66 })
    );
    navGreen.position.set(1.09, 1.54, -4.35);
    const navTail = new THREE.Mesh(
      new THREE.SphereGeometry(0.042, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff3b2b })
    );
    navTail.position.set(0, 2.84, -6.04);
    tiltPivot.add(navRed, navGreen, navTail);

    this.scene.add(root);

    return {
      type: 'helicopter',
      label: 'Helicopter',
      mesh: root,
      tiltPivot,
      mainRotorPivot,
      tailRotorPivot,
      position: new THREE.Vector3(SPAWN.x - 120, 96, SPAWN.z + 80),
      heading: 0.62,
      speed: 0,
      verticalSpeed: 0,
      pitchAngle: 0,
      rollAngle: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.55, 0),
      chaseDistance: 11.4,
      chaseHeight: 3.3
    };
  }

  // On a raised curb island (city-config.js BLOCKS: the real blocks, medians & verges)
  isPointOnSidewalk(x, z) {
    const b = blockAt(x, z);
    return !!b;
  }

  // Height of what stands under (x, z): the raised curb island (walking), the hills (Aso Rock, the ridges), or a flyover
  // deck or ramp where whoever is at height y can step or drive onto it (y unknown: at street level)
  getGroundHeight(x, z, mode = 'person', y = null) {
    let ground = mode === 'person' && this.isPointOnSidewalk(x, z) ? CITY_BOUNDS.sidewalkHeight : 0.0;
    // down in a road cut (city-config.js cutAt: Strachan Ave under the railway), else up on the hills
    const cut = window.CITY.cutAt ? window.CITY.cutAt(x, z) : 0;
    if (cut < 0) ground += cut;
    else ground = Math.max(ground, terrainHeightAt(x, z));
    // (a deck only counts where one is in reach: deckHeightAt's 0 is "none", not the street level)
    const deck = deckHeightAt(x, z, y === null ? ground : y, mode === 'car' ? 0.9 : 0.6);
    return deck > 0 ? Math.max(ground, deck) : ground;
  }

  // The colliders whose bounds come within `r` of (x, z), in their original order. They never move, so they are
  // bucketed once into 48 m cells (tens of thousands of buildings: testing them all every frame cost ~0.5 ms)
  nearColliders(x, z, r) {
    const CELL = 48;
    const key = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
    // (a model that loaded later replaced its stand-in's colliders: js/world-collision.js swap)
    if (G && G.changes.length !== (this._changesSeen || 0)) {
      for (const { remove, add } of G.changes.slice(this._changesSeen || 0)) {
        const gone = new Set(remove);
        this.colliders = this.colliders.filter((c) => !gone.has(c)).concat(add);
      }
      this._changesSeen = G.changes.length;
      this._colliderCells = null;
    }
    if (!this._colliderCells) {
      this._colliderCells = new Map();
      this.colliders.forEach((c, i) => {
        c._order = i;
        for (let ix = Math.floor(c.minX / CELL); ix <= Math.floor(c.maxX / CELL); ix++) {
          for (let iz = Math.floor(c.minZ / CELL); iz <= Math.floor(c.maxZ / CELL); iz++) {
            const k = key(ix, iz);
            let list = this._colliderCells.get(k);
            if (!list) this._colliderCells.set(k, (list = []));
            list.push(c);
          }
        }
      });
      this._nearList = [];
      this._nearStamp = 0;
    }
    const out = this._nearList;
    out.length = 0;
    const stamp = ++this._nearStamp;
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const list = this._colliderCells.get(key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (c._seen === stamp) continue;
          c._seen = stamp;
          out.push(c);
        }
      }
    }
    if (out.length > 1) out.sort((a, b) => a._order - b._order);
    return out;
  }

  // Keeps pos inside the city & out of the lake (ground modes go back to the last dry spot)
  clampToWorld(pos, carEntity = null) {
    // The detailed city (the helicopter may roam out over the hills around it); no driving or walking into a lake
    const heli = this.activeMode === 'helicopter';
    const m = heli ? 12000 : -8;
    const bx = Math.max(CITY_BOUNDS.minX - m, Math.min(CITY_BOUNDS.maxX + m, pos.x));
    const bz = Math.max(CITY_BOUNDS.minZ - m, Math.min(CITY_BOUNDS.maxZ + m, pos.z));
    if ((bx !== pos.x || bz !== pos.z) && carEntity && carEntity.speed) carEntity.speed *= 0.4;
    pos.x = bx;
    pos.z = bz;
    if (!heli) {
      if (waterAt(pos.x, pos.z) && this._dry) {
        pos.x = this._dry.x;
        pos.z = this._dry.z;
        if (carEntity && carEntity.speed) carEntity.speed *= 0.3;
      } else {
        this._dry = { x: pos.x, z: pos.z };
      }
    }
  }

  // One frame's move of the active body (its position by its speed & heading; the car's by its momentum, turning from
  // `fromHeading` to its heading), in substeps, each pushed out of what it meets (WORLD CONTACT above)
  moveBody(ent, mode, dt, fromHeading = ent.heading) {
    const car = mode === 'car', pos = ent.position, radius = BODY_RADIUS[mode] || 0.48;
    const toHeading = ent.heading, turn = car ? toHeading - fromHeading : 0;
    const reach = car ? G.CAR_REACH : radius;
    const travel = Math.hypot(Math.sin(toHeading) * ent.speed + (car ? ent.vx : 0), Math.cos(toHeading) * ent.speed + (car ? ent.vz : 0)) * dt;
    const steps = Math.min(64, Math.max(1, Math.ceil((travel + Math.abs(turn) * reach) / STEP[mode])));
    let gx = pos.x, gz = pos.z;
    const gather = travel + reach + 2;
    let near = this.nearColliders(gx, gz, gather).slice();
    for (let s = 1; s <= steps; s++) {
      if (car) ent.heading = fromHeading + (turn * s) / steps;
      const h = ent.heading, k = dt / steps;
      pos.x += (Math.sin(h) * ent.speed + (car ? ent.vx : 0)) * k;
      pos.z += (Math.cos(h) * ent.speed + (car ? ent.vz : 0)) * k;
      // (pushed far from where the candidates were gathered: gather them again)
      if (Math.abs(pos.x - gx) > gather - reach - 1 || Math.abs(pos.z - gz) > gather - reach - 1) {
        gx = pos.x;
        gz = pos.z;
        near = this.nearColliders(gx, gz, gather).slice();
      }
      this.solveContacts(pos, mode, radius, ent, near, k);
    }
    this.clampToWorld(pos, car ? ent : null);
  }

  // Pushes the body at pos out of the candidates `near` it meets at its height (pos.y), a few passes (a corner has two
  // walls); `ent` (if given) feels it: the car loses the motion into the wall (a little bounce when it hits hard), spins
  // if struck off its centre, dips, rolls, sparks and takes damage; the bicycle (and the helicopter) stop when they meet
  // a wall square on, and glancing along one straighten up along it
  solveContacts(pos, mode, radius, ent, near, dt) {
    const band = bodyBand(mode), car = mode === 'car' ? ent : null;
    let hits = 0;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      let shape = car ? (this._carShape = G.carShape(pos.x, pos.z, car.heading, 0, this._carShape)) : (this._circle = G.circleShape(pos.x, pos.z, radius, this._circle));
      for (const c of near) {
        if (!meets(c, pos.y, band)) continue;
        const hit = G.contact(shape, c);
        if (!hit || !(hit.depth > 0)) continue;
        pos.x += hit.nx * (hit.depth + G.SKIN);
        pos.z += hit.nz * (hit.depth + G.SKIN);
        moved = true;
        hits++;
        this.lastWorldContact = { x: hit.x, z: hit.z, nx: hit.nx, nz: hit.nz, depth: hit.depth, collider: c };
        this.worldContactCount = (this.worldContactCount || 0) + 1;
        if (car) this.carHitsWall(car, hit);
        else if (ent && (mode === 'cyclist' || mode === 'helicopter')) this.riderHitsWall(ent, hit, dt, mode);
        shape = car ? G.carShape(pos.x, pos.z, car.heading, 0, this._carShape) : G.circleShape(pos.x, pos.z, radius, this._circle);
      }
      if (!moved) break;
    }
    return hits;
  }

  carHitsWall(c, hit) {
    const { nx, nz } = hit;
    const sinH = Math.sin(c.heading), cosH = Math.cos(c.heading);
    const vx = sinH * c.speed + (c.vx || 0), vz = cosH * c.speed + (c.vz || 0);
    const into = -(vx * nx + vz * nz);
    if (!(into > 0)) return;
    c.takeHit?.(into);
    // the motion into the wall goes (and comes back a little from a hard hit); along the wall it carries on
    const keep = into + (into > 2 ? 0.18 * into : 0);
    const tx = vx + nx * keep, tz = vz + nz * keep;
    c.speed = tx * sinH + tz * cosH;
    c.vx = tx - sinH * c.speed;
    c.vz = tz - cosH * c.speed;
    if (into > 0.5) {
      // struck off its centre it turns (about its centre: r x the push); square on it doesn't
      if (into > 1.5) {
        const rx = hit.x - c.position.x, rz = hit.z - c.position.z;
        c.angularVel = Math.max(-2.5, Math.min(2.5, (c.angularVel || 0) + (rz * nx - rx * nz) * into * 0.12));
      }
      const headOn = sinH * nx + cosH * nz, side = cosH * nx - sinH * nz;
      c.pitchVel = (c.pitchVel || 0) + headOn * Math.min(14.0, into) * 0.16;
      c.rollVel = (c.rollVel || 0) - side * Math.min(14.0, into) * 0.22;
      c.heaveVel = (c.heaveVel || 0) + Math.min(1.4, into * 0.11);
      if (into > 2.2) c.lastCollisionSpark = { x: hit.x, y: c.position.y + 0.56, z: hit.z, nx, nz, speed: into };
    }
  }

  riderHitsWall(ent, hit, dt, mode) {
    if (!ent.speed) return;
    const dir = Math.sign(ent.speed);
    const fx = Math.sin(ent.heading) * dir, fz = Math.cos(ent.heading) * dir;
    const into = -(fx * hit.nx + fz * hit.nz); // (the cosine between the way it goes & the wall's inward normal)
    if (!(into > 0)) return;
    if (into > 0.7) {
      // square on (within 45 degrees): the motion into the wall is lost
      ent.speed *= Math.sqrt(Math.max(0, 1 - into * into));
      return;
    }
    if (mode !== 'cyclist') return;
    // glancing: the bicycle turns along the wall (at most 2.5 rad/s)
    const tx = fx + hit.nx * into, tz = fz + hit.nz * into;
    let target = Math.atan2(tx, tz);
    if (dir < 0) target += Math.PI;
    const d = Math.atan2(Math.sin(target - ent.heading), Math.cos(target - ent.heading));
    ent.heading += Math.max(-2.5 * dt, Math.min(2.5 * dt, d));
  }

  // Pushes pos out of the colliders it overlaps at its height (pos.y) and keeps it in the city: one move's worth (the
  // controllers' own moves go through moveBody); carEntity: the car, which feels the walls it meets.
  // (resolveHorizontalCollision(pos, radius, y, car) is also taken, as in mrdoob's New York)
  resolveHorizontalCollision(pos, radius, carEntity = null) {
    if (carEntity !== null && typeof carEntity !== 'object') carEntity = arguments[3] && typeof arguments[3] === 'object' ? arguments[3] : null;
    const mode = carEntity ? 'car' : this.activeMode === 'car' ? 'person' : this.activeMode;
    const reach = carEntity ? G.CAR_REACH : radius;
    this.solveContacts(pos, mode, carEntity ? 0 : radius, carEntity, this.nearColliders(pos.x, pos.z, reach + 2).slice(), 0);
    this.clampToWorld(pos, carEntity);
  }

  // Pose the skinned characters once every entity has moved: the pedestrian's rig walks (or runs, turns, jumps) it to
  // where it now is, planting its feet on the ground; the cyclist sits on the bike, hands on the grips, feet on the
  // pedals, helmet on its head
  poseCharacters(dt) {
    const p = this.entities.person;
    const air = p.position.y - this.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y);
    p.rig.update(dt, p.position.x, p.position.z, p.heading, personGround, this, air > 0.02 ? air : 0);
    p.crowd.begin();
    p.crowd.add(p.rig, 0);
    p.crowd.end();

    const b = this.entities.cyclist;
    b.riderRig.ride(b.leanPivot, b.pedalPhase, b.bikeFrame);
    b.riderCrowd.begin();
    b.riderCrowd.add(b.riderRig, 0);
    b.riderCrowd.end();
    b.helmet.quaternion.copy(b.riderRig.headQuaternion);
    b.helmet.position.set(0, 0.175, -0.012).applyQuaternion(b.helmet.quaternion).add(b.riderRig.headPosition);
  }

  update(dt, elapsed) {
    this.clock = (this.clock || 0) + dt;
    const heli = this.entities.helicopter;
    heli.mainRotorPivot.rotation.y += dt * 24.0;
    heli.tailRotorPivot.rotation.x += dt * 32.0;

    if (this.activeMode === 'person') {
      this.updatePerson(dt, elapsed);
    } else {
      // The walker waits where it was left (New York's paced back & forth along a street between z -340 & 340, which
      // turned a start far from the origin, Sugar Beach's, round & walked it away)
      this.entities.person.speed = 0;
    }

    if (this.activeMode === 'car') {
      this.updateCar(dt, elapsed);
    } else if (this.activeMode === 'cyclist') {
      this.updateCyclist(dt, elapsed);
    } else if (this.activeMode === 'helicopter') {
      this.updateHelicopter(dt, elapsed);
    }

    for (const key of Object.keys(this.entities)) {
      const e = this.entities[key];
      e.mesh.position.copy(e.position);
      e.mesh.rotation.y = e.heading;
    }

    // Modulate clustered vehicle & bike lights by time of day (off during Midday & Golden Hour; fade in at Dusk & Night)
    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    const beamScale = Math.min(1.28, Math.max(0.0, (glow - 0.60) * 1.45));
    const car = this.entities.car;
    if (car.headLights) {
      for (const spot of car.headLights) {
        // Accelerating does not change the headlamp output or range.
        spot.intensity = HEADLIGHTS.intensity * beamScale;
      }
    }
    const bike = this.entities.cyclist;
    if (bike.headLight) {
      const bikeActive = this.activeMode === 'cyclist';
      bike.headLight.intensity = bikeActive ? 115 * beamScale : 0;
    }

    this.poseCharacters(dt);
  }

  updatePerson(dt) {
    const p = this.entities.person;
    const maxWalk = this.keys.boost ? 8.2 : 4.4;
    const turnRate = 2.6;

    let targetSpeed = 0;
    if (this.keys.forward) targetSpeed = maxWalk * this.keys.forward;
    else if (this.keys.backward) targetSpeed = -maxWalk * 0.65 * this.keys.backward;

    if (this.keys.left) p.heading += turnRate * dt * this.keys.left;
    if (this.keys.right) p.heading -= turnRate * dt * this.keys.right;

    p.speed += (targetSpeed - p.speed) * Math.min(1, dt * 10);

    this.moveBody(p, 'person', dt);

    const groundY = this.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y);
    if (this.keys.up && p.position.y <= groundY + 0.02) {
      p.verticalVel = 5.2;
    }
    p.verticalVel -= 14.5 * dt;
    p.position.y += p.verticalVel * dt;
    if (p.position.y < groundY) {
      p.position.y = groundY;
      p.verticalVel = 0;
    }
  }

  // An impact at `speed` m/s: takes its toll on the car's condition, and wrecks it at 0
  damageCar(speed) {
    const c = this.entities.car;
    if (c.wrecked > 0 || !Number.isFinite(speed)) return;
    const now = this.clock || 0;
    let damage = crashDamage(speed);
    if (c.lastCrash && now - c.lastCrash.time < CRASH.window) {
      damage -= crashDamage(c.lastCrash.speed);
      if (damage <= 0) return;
      c.lastCrash.speed = speed;
    } else {
      c.lastCrash = { time: now, speed };
    }
    c.health = Math.max(0, c.health - damage);
    if (c.health === 0) c.wrecked = CRASH.wreckTime;
  }

  // A wrecked car's restart: back where the drive began, as new
  restartCar() {
    const c = this.entities.car;
    c.health = 100;
    c.wrecked = 0;
    c.lastCrash = null;
    const home = c.home;
    if (this.activeMode === 'car') this.teleportActiveTo(home.x, home.z, home.heading);
    else {
      c.position.set(home.x, 0, home.z);
      c.heading = home.heading;
      c.speed = c.vx = c.vz = 0;
    }
    c.home = home;
  }

  updateCar(dt) {
    const c = this.entities.car;
    // wrecked: the engine is dead and the controls do nothing until it restarts
    if (c.wrecked > 0) {
      c.wrecked -= dt;
      if (c.wrecked <= 0) return this.restartCar();
    }
    const dead = c.wrecked > 0;
    let throttle = 0;
    if (!dead && this.keys.forward) throttle = this.keys.forward;
    else if (!dead && this.keys.backward) throttle = -this.keys.backward;

    // (as driveCar: under 0.3 m/s it isn't braking, it's changing direction; stopped against a wall the car keeps a
    // speed of ~1e-17 m/s from its momentum's split, and counted as braking, reverse never engaged: stuck there)
    const braking = c.speed * throttle < 0 && Math.abs(c.speed) > 0.3;
    const previousSpeed = c.speed;
    // the keys press the accelerator most of the way; Shift floors it (a gamepad trigger or the touch stick is analog)
    const pedal = braking ? 0 : Math.min(1, Math.abs(throttle) * (this.keys.boost ? 1 : 0.8));
    c.speed = driveCar(c, throttle, pedal, dt);
    const acceleration = dt > 0 ? (c.speed - previousSpeed) / dt : 0;

    let steerInput = 0;
    if (!dead && this.keys.left) steerInput = this.keys.left;
    if (!dead && this.keys.right) steerInput = -this.keys.right;

    c.steerAngle += (steerInput * 0.52 - c.steerAngle) * Math.min(1, dt * 14);

    // Arcade handling (aalghooneh/slop-toronto 6849713, MIT), in the spirit of the 90s car-chase games: the nose turns
    // in sharply and the car's momentum follows it only as far as the tyres can pull it round, so at speed the tail
    // steps out and the car slides; the handbrake (Space) locks the rear for power slides and handbrake turns. The car
    // moves with its momentum (forward speed along the nose + the slide across it in vx/vz), which is split again along
    // the new heading every frame
    const startHeading = c.heading;
    const handbrake = !dead && !!this.keys.up && Math.hypot(c.speed, c.vx, c.vz) > 2;
    if (handbrake) c.speed = Math.sign(c.speed) * Math.max(0, Math.abs(c.speed) - CAR_POWERTRAIN.handbrake * dt);
    const momentumX = Math.sin(c.heading) * c.speed + c.vx;
    const momentumZ = Math.cos(c.heading) * c.speed + c.vz;
    const moving = Math.hypot(momentumX, momentumZ);
    if (moving > 0.2) {
      // (it turns with its momentum, so a handbrake turn keeps swinging round while the car slides sideways)
      const dirSign = c.speed < -0.5 && !handbrake ? -1 : 1;
      const speedFactor = Math.min(1.0, moving / 5.0);
      c.heading += c.steerAngle * (handbrake ? 4.6 : 2.9) * speedFactor * dirSign * dt;
    }
    c.heading += c.angularVel * dt; // collision spin
    c.angularVel *= Math.exp(-dt * 7.8);
    const sinH = Math.sin(c.heading);
    const cosH = Math.cos(c.heading);
    c.speed = momentumX * sinH + momentumZ * cosH;
    let lateral = momentumX * cosH - momentumZ * sinH; // the slide across the car (m/s), + to its left
    // the tyres' sideways grip: firm at low speed, giving way at speed with the wheel turned hard, weaker still once
    // sliding (and next to none with the rear locked)
    const fast = Math.min(1, Math.max(0, (Math.abs(c.speed) - 9) / 22));
    let grip = handbrake ? 0.9 : 14 - fast * Math.abs(c.steerAngle / 0.52) * 11;
    if (Math.abs(lateral) > 4 && !handbrake) grip *= 0.55;
    lateral *= Math.exp(-dt * grip);
    c.speed *= Math.exp(-dt * Math.abs(lateral) * 0.035); // sliding scrubs off speed
    c.vx = cosH * lateral;
    c.vz = -sinH * lateral;
    c.skid = Math.min(1, Math.abs(lateral) / 6);

    const prevX = c.position.x;
    const prevZ = c.position.z;
    this.moveBody(c, 'car', dt, startHeading);
    c.position.y = this.getGroundHeight(c.position.x, c.position.z, 'car', c.position.y);

    // 3-DOF Spring-Damper Chassis Suspension (Pitch, Roll & Vertical Heave)
    // (soft and floaty: the body dives under braking, squats under power and leans hard into the corners & slides)
    const targetPitch = -Math.max(-1, Math.min(1, acceleration / CAR_POWERTRAIN.traction)) * 0.065;
    const targetRoll = -c.steerAngle * Math.min(1, c.speed / 30) * 0.15 + Math.max(-1, Math.min(1, lateral / 10)) * 0.09;
    const springK = 42.0;
    const dampC = 6.2;
    c.pitchVel += ((targetPitch - c.chassisPivot.rotation.x) * springK - c.pitchVel * dampC) * dt;
    c.rollVel += ((targetRoll - c.chassisPivot.rotation.z) * springK - c.rollVel * dampC) * dt;
    c.chassisPivot.rotation.x = Math.max(-0.22, Math.min(0.22, c.chassisPivot.rotation.x + c.pitchVel * dt));
    c.chassisPivot.rotation.z = Math.max(-0.26, Math.min(0.26, c.chassisPivot.rotation.z + c.rollVel * dt));

    c.heaveVel += (-c.heaveY * 85.0 - c.heaveVel * 12.0) * dt;
    c.heaveY = Math.max(-0.08, Math.min(0.14, c.heaveY + c.heaveVel * dt));
    c.chassisPivot.position.y = c.heaveY;

    // brake lamps: braking, or standing still off the pedal (mrdoob's f3132b6)
    if (c.carState) {
      c.carState.value.x = braking || (c.speed === 0 && !throttle) ? 1 : 0;
    }

    const forwardDist = (c.position.x - prevX) * Math.sin(c.heading) + (c.position.z - prevZ) * Math.cos(c.heading);
    const rawWheelStep = forwardDist / 0.35;
    const wheelStep = Math.sign(rawWheelStep) * Math.min(Math.abs(rawWheelStep), 0.48);
    c.wheelSpin = (c.wheelSpin + wheelStep) % (Math.PI * 2);
    for (const w of c.wheels) {
      w.tire.rotation.x = c.wheelSpin + (w.isFront ? 0.0 : 0.55);
      if (w.isFront) {
        w.steerPivot.rotation.y = c.steerAngle;
      }
    }
  }

  updateCyclist(dt) {
    const b = this.entities.cyclist;

    let throttle = 0;
    if (this.keys.forward) throttle = this.keys.forward;
    else if (this.keys.backward) throttle = -0.6 * this.keys.backward;

    b.speed = driveSpeed(b.speed, throttle, this.keys.boost, dt, BICYCLE_DRIVE);

    let turnInput = 0;
    if (this.keys.left) turnInput = this.keys.left;
    if (this.keys.right) turnInput = -this.keys.right;

    if (Math.abs(b.speed) > 0.15) {
      const dirSign = b.speed >= 0 ? 1 : -1;
      b.heading += turnInput * 2.15 * dirSign * dt;
    }

    this.moveBody(b, 'cyclist', dt);
    b.position.y = this.getGroundHeight(b.position.x, b.position.z, 'cyclist', b.position.y);

    const targetLean = -turnInput * Math.min(1.0, Math.abs(b.speed) / 9.0) * 0.34;
    b.leanAngle += (targetLean - b.leanAngle) * Math.min(1, dt * 9);
    b.leanPivot.rotation.z = b.leanAngle;

    const wheelDelta = (b.speed / 0.35) * dt;
    b.frontWheel.rotation.x += wheelDelta;
    b.rearWheel.rotation.x += wheelDelta;

    // The cranks turn with the rear wheel through the gears while pedalling (~110 rpm at cruising speed) and
    // freewheel otherwise; the rider's feet follow the pedals (see poseCharacters)
    if (throttle > 0 && wheelDelta > 0) b.pedalPhase += wheelDelta / 3.2;
    b.crankPivot.rotation.x = b.pedalPhase;
    for (const pedal of b.pedals) pedal.rotation.x = -b.pedalPhase;
  }

  updateHelicopter(dt, elapsed) {
    const h = this.entities.helicopter;
    const maxHorizSpeed = this.keys.boost ? 52.0 : 32.0;
    const maxVertSpeed = 16.0;

    let fwdInput = 0;
    if (this.keys.forward) fwdInput = this.keys.forward;
    else if (this.keys.backward) fwdInput = -this.keys.backward;

    let yawInput = 0;
    if (this.keys.left) yawInput = this.keys.left;
    if (this.keys.right) yawInput = -this.keys.right;

    let vertInput = 0;
    if (this.keys.up) vertInput = this.keys.up;
    else if (this.keys.down) vertInput = -this.keys.down;

    if (fwdInput !== 0) {
      h.speed += fwdInput * 24.0 * dt;
      h.speed = Math.max(-maxHorizSpeed * 0.6, Math.min(maxHorizSpeed, h.speed));
    } else {
      h.speed *= Math.max(0, 1 - dt * 1.8);
    }

    if (vertInput !== 0) {
      h.verticalSpeed += vertInput * 22.0 * dt;
      h.verticalSpeed = Math.max(-maxVertSpeed, Math.min(maxVertSpeed, h.verticalSpeed));
    } else {
      h.verticalSpeed *= Math.max(0, 1 - dt * 3.5);
    }

    h.heading += yawInput * 1.45 * dt;

    // up & down first: coming down onto a roof (or anything solid) it lands on top, instead of being shoved sideways
    // off it; climbing into something overhead it stops under it
    const y0 = h.position.y;
    h.position.y = Math.max(0.25, Math.min(380, y0 + h.verticalSpeed * dt));
    if (h.position.y !== y0) {
      const shape = (this._circle = G.circleShape(h.position.x, h.position.z, BODY_RADIUS.helicopter, this._circle));
      for (const c of this.nearColliders(h.position.x, h.position.z, shape.reach + 1)) {
        const was = meets(c, y0, HELI_BAND);
        if (was || !meets(c, h.position.y, HELI_BAND) || !G.contact(shape, c)) continue;
        if (h.position.y < y0) h.position.y = Math.max(h.position.y, c.maxY - HELI_BAND[0]);
        else h.position.y = Math.min(h.position.y, (c.minY ?? 0) - HELI_BAND[1]);
        h.verticalSpeed = 0;
      }
    }
    this.moveBody(h, 'helicopter', dt);

    const targetPitch = (h.speed / maxHorizSpeed) * 0.24;
    const targetRoll = -yawInput * 0.28;
    h.pitchAngle += (targetPitch - h.pitchAngle) * Math.min(1, dt * 5);
    h.rollAngle += (targetRoll - h.rollAngle) * Math.min(1, dt * 5);

    h.tiltPivot.rotation.x = h.pitchAngle;
    h.tiltPivot.rotation.z = h.rollAngle;
    h.tiltPivot.position.y = Math.sin(elapsed * 2.6) * 0.18;
  }
}

Object.assign(window.CITY, { ThirdPersonControllerManager });
})();
