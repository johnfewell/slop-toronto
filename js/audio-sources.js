(function () {
// js/audio-sources.js
// The city's sound, part 5 of 6: what can be heard from where the listener is. Ten times a second it picks the nearest
// sounding things out of the simulation: the four player entities, the street traffic (traffic.js: cars, buses,
// police), the expressway cars, the TTC streetcars (whatever system audio-system.js was handed with
// window.CITY.Audio.addStreetcars), the pedestrians' feet and the crossing signals (street-details.js audioSignals).
// mrdoob's Slop New York audio, converted to a classic script and fitted to Toronto's simulation: the player's car
// sends its skid (entity.skid, else a proxy from its sideways slip and how hard it corners) and its revs when the car
// model has an engine (entity.rpm, aalghooneh's slop-toronto powertrain); mid-block crossings walk on their own phase.

const { signalPhase, walkSignal, SIGNAL_TIMING } = window.CITY;

const MOTOR_RANGE = 180;
const SIREN_RANGE = 220;
const STREETCAR_RANGE = 200;
const PEOPLE_RANGE = 45;
const SIGNAL_RANGE = 35;
const LOUDNESS = { streetcar: 0.08, bus: 0.64 }; // x the squared distance when ranking the voices
const unit = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const seedAt = (index) => ((Math.imul(index + 1, 2654435761) >>> 0) / 4294967296);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function driveLoad(keys, speed, cyclist) {
  // Match the controller's forward priority, and distinguish propulsion from braking.
  const throttle = unit(+keys.forward) || -unit(+keys.backward) * (cyclist ? 0.6 : 1);
  if ((cyclist && throttle <= 0) || speed * throttle < 0) return 0;
  return unit(Math.abs(throttle) * (cyclist || keys.boost ? 1 : 0.8));
}

function helicopterVerticalSpeed(entity) {
  const speed = Number.isFinite(entity.verticalSpeed) ? entity.verticalSpeed : 0;
  // The controller clamps altitude without clearing its stored vertical velocity.
  return (entity.position.y <= 0.25 && speed < 0) || (entity.position.y >= 380 && speed > 0) ? 0 : speed;
}

function helicopterLoad(entity, keys, verticalSpeed) {
  const forward = unit(+keys.forward) || -unit(+keys.backward);
  const collective = unit(+keys.up) || -unit(+keys.down);
  const grounded = entity.position.y <= 0.35 && verticalSpeed <= 0.03;
  return unit((grounded ? 0.12 : 0.45)
    + 0.28 * Math.max(collective, 0) - 0.16 * Math.max(-collective, 0)
    + 0.15 * unit(verticalSpeed / 16) - 0.08 * unit(-verticalSpeed / 16)
    + 0.1 * Math.abs(forward) + 0.12 * unit(Math.abs(entity.speed) / 52));
}

// How hard the player's car scrubs its tyres, 0-1: the controller's own figure when it keeps one (a car model with
// slides), else sideways slip (a shove from a collision) and cornering past what the tyres hold (~0.8 g)
function carSkid(car, keys) {
  if (Number.isFinite(car.skid)) return unit(car.skid);
  const slip = Math.hypot(car.vx || 0, car.vz || 0);
  const speed = Math.abs(car.speed || 0);
  const yawRate = Math.abs((car.steerAngle || 0) * 2.4 * Math.min(1, speed / 8) + (car.angularVel || 0));
  const lateral = speed * yawRate; // m/s²
  const braking = keys.backward && car.speed > 9 ? 0.25 : 0;
  return unit(Math.max((slip - 1.2) / 5, (lateral - 8) / 14, braking));
}

function roadLoad(speed, acceleration, maxAcceleration) {
  // Constant speed still needs power against rolling resistance and air drag.
  return unit(acceleration / maxAcceleration + unit(speed / 2) * (0.12 + 0.28 * unit(speed / 30) ** 2));
}

function writeMotor(item, id, kind, x, y, z, speed, load, heading, police, player, seed, blocked, gain, range, verticalSpeed = 0, skid = 0, rpm = 0, curve = 0) {
  item.id = id;
  item.kind = kind;
  item.x = x;
  item.y = y;
  item.z = z;
  item.speed = Number.isFinite(speed) ? Math.abs(speed) : 0;
  item.load = unit(load);
  item.verticalSpeed = Number.isFinite(verticalSpeed) ? verticalSpeed : 0;
  item.skid = unit(skid);
  item.rpm = Number.isFinite(rpm) ? rpm : 0;
  item.curve = unit(curve);
  item.heading = heading;
  item.police = police;
  item.player = player;
  item.seed = seed;
  item.blocked = blocked;
  item.gain = gain;
  item.range = range;
}

// Bounded insertion keeps only nearby candidates. Records and the public array are reused across collections.
class NearestSources {
  constructor(limit) {
    this.pool = Array.from({ length: limit }, () => ({}));
    this.items = [];
    this.scores = new Float64Array(limit);
  }

  take(score) {
    let i = this.items.length;
    let item;
    if (i < this.pool.length) item = this.pool[i];
    else {
      if (score >= this.scores[i - 1]) return null;
      item = this.items[--i];
    }
    while (i > 0 && score < this.scores[i - 1]) {
      this.items[i] = this.items[i - 1];
      this.scores[i] = this.scores[i - 1];
      i--;
    }
    this.items[i] = item;
    this.scores[i] = score;
    return item;
  }
}

// Read at audio's control rate (10 Hz), after simulation updates. Snapshots remain valid until the next collect().
// IDs are the simulation objects, independent of pooled record order, so voices survive ranking changes/recycling.
class CityAudioSources {
  constructor({ controllerManager, trafficSystem, highwayTraffic, streetDetails }) {
    this.controllers = controllerManager;
    this.players = Object.values(controllerManager.entities);
    this.cars = trafficSystem.cars;
    this.buses = trafficSystem.buses;
    this.peds = trafficSystem.peds;
    this.highwayCars = highwayTraffic ? highwayTraffic.cars : [];
    this.signalSites = (streetDetails && streetDetails.audioSignals) || [];
    this.streetcarSystems = [];
    this.motors = new NearestSources(10);
    this.sirens = new NearestSources(2);
    this.people = new NearestSources(6);
    this.signals = new NearestSources(2);
    this.trams = new NearestSources(4); // every streetcar in range, voiced or not (its bell, audio-system.js)
    this.snapshot = {
      motors: this.motors.items, sirens: this.sirens.items, streetcars: this.trams.items,
      people: this.people.items, signals: this.signals.items, traffic: 0, motion: 0
    };
  }

  // A streetcar system (js/streetcars.js): anything with a `cars` array, each car { speed, sections: [{ x, z, yaw }] }
  // (an articulated car, nose first) or { x, z, yaw, speed }; optional y (the rail height) and curve (0-1)
  addStreetcars(system) {
    if (system && Array.isArray(system.cars) && !this.streetcarSystems.includes(system)) this.streetcarSystems.push(system);
  }

  distanceSq(x, y, z) {
    const dx = x - this.listener.x;
    const dy = y - this.listener.y;
    const dz = z - this.listener.z;
    return dx * dx + dy * dy + dz * dz;
  }

  motor(id, kind, x, y, z, speed, load, heading, police, player, seed, blocked, gain = 1, range = kind === 'helicopter' ? 500 : 160, verticalSpeed = 0, skid = 0, rpm = 0, curve = 0) {
    const d2 = this.distanceSq(x, y, z);
    if (!Number.isFinite(d2)) return;
    if (police && d2 <= SIREN_RANGE * SIREN_RANGE) {
      const siren = this.sirens.take(d2);
      if (siren) writeMotor(siren, id, 'siren', x, y, z, speed, load, heading, true, player, seed, blocked, 1, 200);
    }
    const reach = kind === 'helicopter' ? range : kind === 'streetcar' ? STREETCAR_RANGE : MOTOR_RANGE;
    if (d2 > reach * reach) return;
    // The loud ones keep their voices further out: a streetcar counts as under a third as far away as a car, a bus 0.8
    const item = this.motors.take(player ? -1 : d2 * (LOUDNESS[kind] || 1));
    if (!item) return;
    writeMotor(item, id, kind, x, y, z, speed, load, heading, police, player, seed, blocked, gain, range, verticalSpeed, skid, rpm, curve);
  }

  person(id, x, y, z, speed, grounded, rig, player = false, priority = player) {
    const d2 = this.distanceSq(x, y, z);
    if (!Number.isFinite(d2) || d2 > PEOPLE_RANGE * PEOPLE_RANGE) return;
    const item = this.people.take(priority ? -1 : d2);
    if (!item) return;
    item.id = id;
    item.x = x;
    item.y = y;
    item.z = z;
    item.speed = Number.isFinite(speed) ? Math.abs(speed) : 0;
    item.grounded = grounded;
    item.seed = rig.seed;
    item.phase = rig.phase;
    item.player = player;
    item.conversation = player ? null : id.conversation || null;
    // Pedestrians without paired conversations (traffic.js keeps none yet) chat now and then on their own
    item.chatty = !player && !('conversation' in id);
    const left = rig.feet[0], right = rig.feet[1];
    item.leftX = left.px; item.leftY = left.py; item.leftZ = left.pz;
    item.rightX = right.px; item.rightY = right.py; item.rightZ = right.pz;
  }

  streetVehicles(vehicles, elapsed, seedOffset) {
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.edge) continue;
      const y = (v.y || 0) + 0.7;
      const d2 = this.distanceSq(v.x, y, v.z);
      const range = v.isPolice ? SIREN_RANGE : MOTOR_RANGE;
      if (!Number.isFinite(d2) || d2 > range * range) continue;
      if (d2 <= MOTOR_RANGE * MOTOR_RANGE) {
        this.snapshot.traffic += (1 - d2 / (MOTOR_RANGE * MOTOR_RANGE)) * (0.2 + 0.8 * unit(v.speed / 12));
      }
      const green = !v.edge.to.signal || signalPhase(elapsed, v.edge.axisIndex === 0) === 'green';
      const blocked = v.wait > 2 && v.speed < 0.5 && v.gap < 8 && v.leaderSpeed < 0.5 && green && !v.conn && !v.yielding;
      this.motor(v, v.bus ? 'bus' : v.isSUV ? 'suv' : 'sedan', v.x, y, v.z,
        v.speed, roadLoad(v.speed, v.acc, v.driver.a), v.yaw + v.yawOffset, !!v.isPolice, false, seedAt(seedOffset + i), blocked);
    }
  }

  streetcars() {
    for (let k = 0; k < this.streetcarSystems.length; k++) {
      const cars = this.streetcarSystems[k].cars;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        const sections = car.sections;
        const n = sections ? sections.length : 0;
        // The middle module sounds for the whole car; the nose sets its heading, nose against tail its bend
        const mid = n ? sections[n >> 1] : car;
        if (!mid || !Number.isFinite(mid.x) || !Number.isFinite(mid.z)) continue;
        const y = (Number.isFinite(car.y) ? car.y : 0) + 1.1;
        const d2 = this.distanceSq(mid.x, y, mid.z);
        if (!Number.isFinite(d2) || d2 > STREETCAR_RANGE * STREETCAR_RANGE) continue;
        const speed = Math.abs(car.speed || 0);
        if (d2 <= MOTOR_RANGE * MOTOR_RANGE) {
          this.snapshot.traffic += (1 - d2 / (MOTOR_RANGE * MOTOR_RANGE)) * (0.3 + 0.9 * unit(speed / 10));
        }
        const heading = n ? sections[0].yaw : car.yaw;
        const curve = Number.isFinite(car.curve) ? car.curve : n > 1 ? Math.abs(wrapAngle(sections[0].yaw - sections[n - 1].yaw)) / 0.45 : 0;
        const tram = this.trams.take(d2);
        if (tram) writeMotor(tram, car, 'streetcar', mid.x, y, mid.z, speed, 0, heading, false, false, 0, false, 1, STREETCAR_RANGE);
        // load: the system works it out from the change of speed (audio-system.js); 0.15 is cruising
        this.motor(car, 'streetcar', mid.x, y, mid.z, speed, 0.15, heading, false, false, seedAt(5000 + k * 500 + i), false,
          1, STREETCAR_RANGE, 0, 0, 0, curve);
      }
    }
  }

  collect(listenerPosition, elapsed) {
    this.listener = listenerPosition;
    this.motors.items.length = this.sirens.items.length = this.people.items.length = this.signals.items.length = 0;
    this.trams.items.length = 0;
    this.snapshot.traffic = 0;
    const active = this.controllers.getActiveEntity();
    const keys = this.controllers.keys;
    this.snapshot.motion = active.type === 'person' ? active.rig.speed
      : Math.hypot(active.speed, active.type === 'helicopter' ? helicopterVerticalSpeed(active) : 0);

    for (let i = 0; i < this.players.length; i++) {
      const entity = this.players[i];
      if (entity.mesh.visible === false || entity.position.y < -0.05) continue;
      const { x, y, z } = entity.position;
      const player = entity === active;
      if (entity.type === 'person') {
        const ground = this.controllers.getGroundHeight(x, z, 'person', y);
        const grounded = y <= ground + 0.03 && Math.abs(entity.verticalVel) < 0.1;
        this.person(entity, x, y, z, entity.rig.speed, grounded, entity.rig, true, player);
      } else {
        // Inactive bicycles stop updating and are silent, even if their stored speed is left over from riding.
        if (!player && entity.type === 'cyclist') continue;
        const kind = entity.type === 'car' ? 'sedan' : entity.type;
        const helicopter = kind === 'helicopter';
        const verticalSpeed = player && helicopter ? helicopterVerticalSpeed(entity) : 0;
        const load = player ? helicopter ? helicopterLoad(entity, keys, verticalSpeed) : driveLoad(keys, entity.speed, kind === 'cyclist') : 0;
        const gain = player ? 1 : helicopter ? 0.22 : 0.5;
        const range = helicopter ? (player ? 500 : 200) : 160;
        const car = player && entity.type === 'car';
        this.motor(entity, kind, x, y + (helicopter ? 2.66 : 0.7), z, player ? entity.speed : 0, load, entity.heading,
          false, player, seedAt(i), false, gain, range, verticalSpeed, car ? carSkid(entity, keys) : 0, car ? entity.rpm : 0);
      }
    }

    this.streetVehicles(this.cars, elapsed, 100);
    this.streetVehicles(this.buses, elapsed, 1000);
    this.streetcars();
    for (let i = 0; i < this.highwayCars.length; i++) {
      const car = this.highwayCars[i];
      // Lane ends sink into the road (the cars dip out of sight there); neither should sound above ground
      if (!car.placed || car.y < -0.05) continue;
      const d2 = this.distanceSq(car.x, car.y + 0.7, car.z);
      if (!Number.isFinite(d2) || d2 > MOTOR_RANGE * MOTOR_RANGE) continue;
      this.snapshot.traffic += (1 - d2 / (MOTOR_RANGE * MOTOR_RANGE)) * (0.2 + 0.8 * unit(car.v / 12));
      this.motor(car, car.kind === 'suv' ? 'suv' : 'sedan', car.x, car.y + 0.7, car.z,
        car.v, roadLoad(car.v, car.acc, 1.6), car.yaw, false, false, seedAt(2000 + i), car.v < 0.5);
    }
    this.snapshot.traffic = unit(this.snapshot.traffic / 16);

    for (let i = 0; i < this.peds.length; i++) {
      const ped = this.peds[i];
      if (!ped.placed) continue;
      const t = (ped.x - ped.ax) * ped.ux + (ped.z - ped.az) * ped.uz;
      const y = ped.node && t > 2 && t < ped.len - 2 ? 0.012 : 0.22;
      this.person(ped, ped.x, y, ped.z, ped.v, true, ped.rig);
    }
    const { cycle, avenueRed, walk } = SIGNAL_TIMING;
    for (let i = 0; i < this.signalSites.length; i++) {
      const site = this.signalSites[i];
      const d2 = this.distanceSq(site.x, site.y, site.z);
      if (!Number.isFinite(d2) || d2 > SIGNAL_RANGE * SIGNAL_RANGE) continue;
      const item = this.signals.take(d2);
      if (!item) continue;
      item.id = site;
      item.x = site.x;
      item.y = site.y;
      item.z = site.z;
      // A mid-block crossing's green man lights a second after its road turns red (street-details.js pedLensMat)
      item.walk = site.crossing ? (((elapsed - avenueRed - 1) % cycle) + cycle) % cycle < walk : walkSignal(elapsed, site.isAvenue);
      item.ns = !!site.ns;
      item.seed = seedAt(10000 + i);
    }
    return this.snapshot;
  }
}

Object.assign(window.CITY, { CityAudioSources });
})();
