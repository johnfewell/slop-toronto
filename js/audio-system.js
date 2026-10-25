(function () {
// js/audio-system.js
// The city's sound, part 6 of 6: synthesized, spatial (HRTF) city audio. Every vehicle near the listener (the camera)
// gets a running voice: car, SUV & bus engines across the rev range, police sirens (wail & yelp), the TTC streetcars,
// the player's car, bicycle (drivetrain, freewheel, tyres), helicopter and footsteps; then one-shot events (horns,
// crashes, pedestrians' footsteps & chatter, crossing signals, streetcar bells, bus air brakes, gulls) and two beds,
// the wind (sheltered by the buildings) and Lake Ontario lapping at the waterfront. Walls muffle what's behind them
// and narrow streets ring (audio-acoustics.js). Everything is computed from the simulation at 10 Hz (crashes at once).
// mrdoob's Slop New York audio (f98e8da..7772c09: "Add synthesized spatial city audio" and the refinements after it),
// converted to classic scripts and fitted to Toronto (audio-toronto.js).
// - Starts on the first click, tap or key (browser autoplay rules); [N] or the speaker button in the toolbar mutes it
//   (remembered); [B] sounds the car's horn or the bike's bell. ?sound=0 starts muted. Silent in film mode (?film=…,
//   film.js, and the frame-by-frame film recorder) and while the tab is hidden.
// - Cost scales with the quality tier (quality.js `audio`: voices, events, HRTF or plain stereo panning).
// - Crashes: the traffic reports its contacts (traffic.js setCollisionListener); the player's own impacts (buildings,
//   walls, the ground under the helicopter) are read off a sudden change in its velocity, so any car physics works.
//
// Hooks for other systems (window.CITY.Audio, available as soon as this script has run):
// - Audio.addStreetcars(system): the streetcars sound from then on. `system.cars` is read 10 times a second; each car
//   is { speed (m/s), sections: [{ x, z, yaw }, ...] (nose first) } or { speed, x, z, yaw }, optionally y (rail
//   height) and curve (0-1, else from the nose-to-tail bend). Whine, rolling, joint clacks & squeal follow; the bell
//   rings by itself as a car pulls away from a stop and at a rider on the tracks ahead.
// - Audio.streetcarBell(car, { double = true }): ring a car's bell now (e.g. at a stop's doors).
// - Audio.setEnabled(on), Audio.enabled, Audio.system (the CityAudioSystem, for inspection).

const { createSynthResources, createMotorVoice, setControlRate } = window.CITY.AudioSynthesis;
const { createEventResources, playEvent, createWindVoice } = window.CITY.AudioEvents;
const { createTorontoResources, withTorontoEvents, createStreetcarVoice, createLakeVoice, WaterfrontProbe } = window.CITY.AudioToronto;
const { CityAudioSources, CityAcoustics, isTypingInField } = window.CITY;
const QUALITY = window.CITY.QUALITY || {};

const params = new URLSearchParams(location.search);
const FILM = params.has('film'); // film.js: the launch film plays (or renders) silent
const STORAGE_KEY = 'toronto-sound';
// This script's URL: the synthesis worker loads its siblings from beside it, at the same ?v= version
const SCRIPT_SRC = document.currentScript ? document.currentScript.src : '';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (param, value, now, time = 0.035, immediate = false) => {
  param.cancelScheduledValues(now);
  if (immediate) param.setValueAtTime(value, now);
  else param.setTargetAtTime(value, now, time);
};

// Where each kind of event sounds from: [panner reference distance, audible range (m), height above its source,
// directional (a cone in the source's heading)]. Crashes scale with their severity (emit()).
const EVENT_SPACE = {
  horn: [8, 140, 0, true],
  talk: [2, 30, 1.5, false],
  footstep: [1.8, 22, 0, false],
  signal: [1.8, 35, 0, false],
  bell: [7, 170, 1.2, true],
  bikebell: [2.5, 50, 0.4, false],
  gull: [12, 320, 0, false],
  hiss: [4, 90, 0.4, false]
};
const FOLLOWS = new Set(['talk', 'horn', 'bell']); // events that move with their source

// ---------------------------------------------------------------------------------------------------------------------
// Synthesis off the main thread. Baking the engines, the footsteps, the voices, the crashes and the gulls is ~0.35 s of
// arithmetic: done on the first click it would freeze the ride for a third of a second. A worker runs the same three
// scripts against a stand-in context (plain sample arrays) while the city loads; the first click only copies the
// samples into AudioBuffers (a few ms). Baked at 48 kHz whatever the device's rate: buffer sources resample.
// ---------------------------------------------------------------------------------------------------------------------
const WORKER_SOURCE = `
self.window = self;
self.CITY = {};
class StandInBuffer {
  constructor(channels, length, sampleRate) {
    Object.assign(this, { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate });
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(i) { return this.channels[i]; }
}
const context = {
  sampleRate: 48000,
  createBuffer: (channels, length, rate) => new StandInBuffer(channels, length, rate),
  createPeriodicWave: (real, imag) => ({ __wave: [Float32Array.from(real), Float32Array.from(imag)] })
};
onmessage = ({ data }) => {
  try {
    importScripts(...data.scripts);
    context.sampleRate = data.sampleRate;
    const resources = CITY.AudioEvents.createEventResources(context, CITY.AudioSynthesis.createSynthResources(context));
    resources.toronto = CITY.AudioToronto.torontoBuffers(context);
    const transfer = [];
    const pack = (v) => v instanceof StandInBuffer ? (v.channels.forEach((c) => transfer.push(c.buffer)), { __channels: v.channels, __rate: v.sampleRate })
      : Array.isArray(v) ? v.map(pack)
      : v && typeof v === 'object' && !v.__wave ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)])) : v;
    postMessage({ resources: pack(resources) }, transfer);
  } catch (error) {
    postMessage({ error: String(error) });
  }
};`;

// Resolves to the packed resources, or null (no workers here, or it failed: the first click synthesizes them instead)
function synthesizeOffThread(sampleRate = 48000) {
  return new Promise((resolve) => {
    try {
      if (!SCRIPT_SRC || typeof Worker === 'undefined') return resolve(null);
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      const worker = new Worker(url);
      const scripts = ['audio-synthesis.js', 'audio-events.js', 'audio-toronto.js'].map((name) => SCRIPT_SRC.replace('audio-system.js', name));
      const done = (resources) => { worker.terminate(); URL.revokeObjectURL(url); resolve(resources); };
      worker.onmessage = ({ data }) => {
        if (data.error) console.warn('[audio] synthesis worker:', data.error);
        done(data.resources || null);
      };
      worker.onerror = (event) => { event.preventDefault(); console.warn('[audio] synthesis worker failed'); done(null); };
      worker.postMessage({ scripts, sampleRate });
    } catch (error) {
      resolve(null);
    }
  });
}

// The worker's sample arrays back into AudioBuffers & PeriodicWaves of the real context
function unpack(context, v) {
  if (Array.isArray(v)) return v.map((x) => unpack(context, x));
  if (!v || typeof v !== 'object') return v;
  if (v.__wave) return context.createPeriodicWave(v.__wave[0], v.__wave[1]);
  if (v.__channels) {
    const buffer = context.createBuffer(v.__channels.length, v.__channels[0].length, v.__rate);
    v.__channels.forEach((samples, i) => buffer.copyToChannel(samples, i));
    return buffer;
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unpack(context, x)]));
}

// Direct sound is muffled behind buildings; the shared reflection path keeps some diffuse sound around corners.
// All voices share one short convolution and the existing collision grid, with no mesh traversal or per-voice reverb.
class SpatialEmitter {
  constructor(context, dry, reflections, acoustics, refDistance, height = 0, directional = false, panningModel = 'HRTF') {
    this.height = height;
    this.acoustics = acoustics;
    this.nextObstruction = 0;
    this.obstruction = 0;
    this.input = context.createGain();
    this.input.gain.value = 0;
    this.filter = context.createBiquadFilter();
    setControlRate(this.filter.frequency, this.filter.detune, this.filter.Q, this.filter.gain);
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.5;
    this.panner = context.createPanner();
    setControlRate(
      this.panner.positionX, this.panner.positionY, this.panner.positionZ,
      this.panner.orientationX, this.panner.orientationY, this.panner.orientationZ
    );
    this.panner.panningModel = panningModel;
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = refDistance;
    this.panner.rolloffFactor = 1.15;
    this.panner.maxDistance = 500;
    if (directional) {
      this.panner.coneInnerAngle = 120;
      this.panner.coneOuterAngle = 260;
      this.panner.coneOuterGain = 0.6;
    }
    this.direct = context.createGain();
    this.input.connect(this.filter).connect(this.panner);
    this.panner.connect(this.direct).connect(dry);
    this.panner.connect(reflections);
  }

  update(source, listener, now, range = 160, snap = false, immediate = false) {
    const y = source.y + this.height;
    const distance = Math.hypot(source.x - listener.x, y - listener.y, source.z - listener.z);
    if (snap) {
      this.panner.positionX.cancelScheduledValues(now);
      this.panner.positionY.cancelScheduledValues(now);
      this.panner.positionZ.cancelScheduledValues(now);
      this.panner.positionX.setValueAtTime(source.x, now);
      this.panner.positionY.setValueAtTime(y, now);
      this.panner.positionZ.setValueAtTime(source.z, now);
    } else {
      smooth(this.panner.positionX, source.x, now);
      smooth(this.panner.positionY, y, now);
      smooth(this.panner.positionZ, source.z, now);
    }
    if (this.panner.coneOuterAngle < 360 && Number.isFinite(source.heading)) {
      smooth(this.panner.orientationX, Math.sin(source.heading), now);
      smooth(this.panner.orientationZ, Math.cos(source.heading), now);
    }
    if (snap || now >= this.nextObstruction) {
      this.obstruction = this.acoustics.obstruction(source, listener, this.height);
      this.nextObstruction = now + 0.28 + (Math.abs(source.seed || 0) % 1) * 0.12;
    }
    const fade = clamp((range - distance) / (range * 0.3), 0, 1);
    smooth(this.input.gain, (source.gain ?? 1) * fade * fade * (3 - 2 * fade), now, 0.035, immediate);
    smooth(this.direct.gain, 1 - this.obstruction * 0.78, now, 0.12, immediate);
    const airCutoff = 1800 + 14000 * Math.exp(-distance / 70);
    smooth(this.filter.frequency, airCutoff * Math.pow(0.065, this.obstruction), now, 0.12, immediate);
    return distance;
  }

  dispose() {
    this.input.disconnect();
    this.filter.disconnect();
    this.panner.disconnect();
    this.direct.disconnect();
  }
}

class CityAudioSystem {
  constructor(simulation, { onStateChange = () => {} } = {}) {
    this.sources = new CityAudioSources(simulation);
    this.acoustics = new CityAcoustics(simulation.controllerManager);
    this.controllers = simulation.controllerManager;
    this.waterfront = new WaterfrontProbe();
    this.onStateChange = onStateChange;
    this.context = null;
    this.ready = false;
    this.disposed = false;
    this.blocked = FILM;
    this.supported = !!(globalThis.AudioContext || globalThis.webkitAudioContext);
    this.enabled = true;
    try { this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { /* Private browsing. */ }
    if (params.get('sound') === '0') this.enabled = false;
    else if (params.get('sound') === '1') this.enabled = true;
    // Voices by quality tier (quality.js), and fewer still on small devices
    const tier = QUALITY.audio || { motors: 8, sirens: 2, events: 8, hrtf: true };
    const smallDevice = navigator.hardwareConcurrency <= 4 || matchMedia('(pointer: coarse)').matches;
    this.limits = {
      motors: Math.min(tier.motors, smallDevice ? 6 : 8),
      sirens: Math.min(tier.sirens, smallDevice ? 1 : 2),
      events: Math.min(tier.events, smallDevice ? 5 : 8)
    };
    this.panningModel = tier.hrtf === false ? 'equalpower' : 'HRTF';
    this.packed = undefined; // the worker's resources: undefined while it runs, null if it couldn't
    if (this.supported && !this.blocked) synthesizeOffThread().then((packed) => { this.packed = packed; this.whenSynthesized?.(); });
    this.motors = new Map();
    this.sirens = new Map();
    this.events = [];
    this.states = new WeakMap();
    this.conversations = new WeakMap();
    this.listener = { x: 0, y: 0, z: 0 };
    this.haveListener = false;
    this.accumulator = 0;
    this.lastHorn = -Infinity;
    this.nextGull = 0;
    this.gullSequence = 0;
    this.collisionPairs = new WeakMap();
    this.collisionSequence = 0;
    this.lastPlayerContact = -Infinity;
    this.worldCollider = { type: 'building' }; // what the player's own impacts hit (see detectImpact)
    this.impact = { entity: null, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, boost: false };
    this.collisionSystems = [simulation.trafficSystem];
    this.onCollision = (impact) => this.crash(impact);
    for (const system of this.collisionSystems) system.setCollisionListener?.(this.onCollision);
    this.motorParams = { speed: 0, load: 0, verticalSpeed: 0, skid: 0, rpm: 0, curve: 0, doppler: 1, seed: 0 };
    this.windParams = { speed: 0, altitude: 0, night: 0, traffic: 0, enclosure: 0 };
    this.lakeParams = { exposure: 0, altitude: 0, enclosure: 0 };
    this.footPosition = { x: 0, y: 0, z: 0, seed: 0 };
    this.onGesture = (event) => {
      if (event.type === 'keydown' && (event.repeat || event.metaKey || event.ctrlKey || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName))) return;
      if (this.enabled) this.unlock();
    };
    this.onVisibility = () => {
      this.reset();
      if (document.hidden) this.suspend();
      else if (this.enabled && this.context) this.unlock();
    };
    // Keep gesture handlers: iOS can interrupt a previously running context, and resuming may need another tap.
    document.addEventListener('pointerdown', this.onGesture, { passive: true });
    document.addEventListener('pointerup', this.onGesture, { passive: true });
    document.addEventListener('keydown', this.onGesture);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  // Running and built (the graph waits for the synthesized resources)
  get running() {
    return !!this.master && this.context.state === 'running';
  }

  unlock() {
    if (!this.supported || !this.enabled || this.disposed || this.blocked || document.hidden) return;
    try {
      if (!this.context) this.initialize();
      if (this.context.state !== 'running') {
        this.context.resume().then(() => {
          if (!this.enabled || document.hidden || this.disposed) return this.suspend();
          this.onStateChange();
        }).catch(() => {}); // A later user gesture can retry autoplay/interruption failures.
      }
    } catch (error) {
      console.warn('[audio] Unable to initialize sound', error);
      this.supported = false;
      this.context?.close().catch(() => {});
      this.onStateChange();
    }
  }

  initialize() {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    const context = this.context = new Context({ latencyHint: 'interactive' });
    const listener = context.listener;
    setControlRate(
      listener.positionX, listener.positionY, listener.positionZ,
      listener.forwardX, listener.forwardY, listener.forwardZ,
      listener.upX, listener.upY, listener.upZ
    );
    // the graph is built once the worker has the resources ready (at once if it already has)
    if (this.packed === undefined) this.whenSynthesized = () => this.build();
    else this.build();
    context.onstatechange = () => this.onStateChange();
  }

  build() {
    const context = this.context;
    if (this.disposed || this.master || context.state === 'closed') return;
    const started = performance.now();
    const baked = !!this.packed;
    this.resources = baked ? withTorontoEvents(unpack(context, this.packed))
      : createTorontoResources(context, createEventResources(context, createSynthResources(context)));
    this.packed = null;
    console.info(`[audio] ${Math.round(performance.now() - started)} ms to ${baked ? 'unpack the worker\'s' : 'synthesize the'} sounds, ` +
      `${this.panningModel} panning, ${this.limits.motors} motors, ${this.limits.sirens} sirens, ${this.limits.events} events`);
    this.mix = context.createGain();
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.22;
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.mix.connect(this.compressor).connect(this.master).connect(context.destination);
    this.reflections = context.createGain();
    this.reflections.gain.value = 0.02;
    this.reverb = context.createConvolver();
    this.reverb.normalize = false;
    this.reverb.buffer = this.resources.impulse;
    this.reflectionFilter = context.createBiquadFilter();
    setControlRate(this.reflectionFilter.frequency, this.reflectionFilter.detune, this.reflectionFilter.Q, this.reflectionFilter.gain);
    this.reflectionFilter.type = 'lowpass';
    this.reflectionFilter.frequency.value = 2400;
    this.reflectionFilter.Q.value = 0.5;
    this.reflections.connect(this.reverb).connect(this.reflectionFilter).connect(this.mix);
    this.wind = createWindVoice(context, this.resources, this.mix);
    this.lake = createLakeVoice(context, this.resources, this.mix);
    this.onStateChange();
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    try { localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off'); } catch { /* Storage is optional. */ }
    if (this.enabled) this.unlock();
    else {
      this.reset();
      this.suspend();
    }
    this.onStateChange();
  }

  suspend() {
    if (!this.context || this.context.state === 'closed') return;
    // Visibility/mute can change again while suspend is pending. Reconcile after it settles so a rapid unmute
    // cannot leave an enabled system suspended merely because resume saw the old 'running' state.
    return this.context.suspend().then(() => {
      if (this.enabled && !document.hidden && !this.disposed && !this.blocked) this.unlock();
    }).catch(() => {});
  }

  reset() {
    for (const pool of [this.motors, this.sirens]) {
      for (const slot of pool.values()) { slot.voice.dispose(); slot.emitter.dispose(); }
      pool.clear();
    }
    for (const event of this.events) { event.voice.dispose(true); event.emitter.dispose(); }
    this.events.length = 0;
    this.conversations = new WeakMap();
    this.states = new WeakMap();
    this.collisionPairs = new WeakMap();
    this.haveListener = false;
    this.accumulator = 0;
    this.impact.entity = null;
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
    }
  }

  // Fade everything out without tearing it down (the film recorder took over the clock)
  silence() {
    if (!this.master || !this.running) return;
    smooth(this.master.gain, 0, this.context.currentTime, 0.05);
  }

  state(source, now) {
    let state = this.states.get(source.id);
    if (!state) {
      const hash = Math.sin(source.seed * 127.1 + 311.7) * 43758.5453;
      const variation = hash - Math.floor(hash);
      state = { variation, phase: source.phase, grounded: source.grounded, x: source.x, z: source.z,
        talk: now + 3 + variation * 12, signal: now + variation, horn: now + 8 + variation * 13, stopped: 0,
        stepSequence: 0, talkSequence: 0, speed: source.speed, still: 0, moved: -Infinity, hissed: true, warn: 0 };
      this.states.set(source.id, state);
    }
    return state;
  }

  updateConversations(people, now) {
    // Only the nearby pair's first member schedules speech. Shared turn state prevents overlapping replies.
    for (const source of people) {
      const pair = source.conversation;
      if (!pair || pair.a !== source.id || pair.a.conversation !== pair || pair.b.conversation !== pair) continue;
      const partner = people.find(person => person.id === pair.b && person.conversation === pair);
      if (!partner || source.speed > 0.15 || partner.speed > 0.15) continue;
      let state = this.conversations.get(pair);
      if (!state) {
        state = { reply: false, sequence: 0, next: now + 0.3 };
        this.conversations.set(pair, state);
      }
      if (now < state.next) continue;
      const speaker = state.reply ? partner : source;
      if (this.emit('talk', speaker, { intensity: 0.3, seed: speaker.seed + state.sequence, voiceSeed: speaker.seed })) {
        const voice = this.events[this.events.length - 1].voice;
        const pause = 0.35 + (Math.sin(speaker.seed * 53 + state.sequence * 17.13) * 0.5 + 0.5) * 0.75;
        state.next = voice.endTime + pause;
        state.reply = !state.reply;
        state.sequence++;
      } else {
        state.next = now + 0.5;
      }
    }
  }

  // A streetcar's traction effort from its change of speed: + pulling away, - braking (the motors regenerate, and
  // whine as they do), a little at cruise
  streetcarLoad(source, dt, now) {
    const state = this.state(source, now);
    const acc = (source.speed - state.speed) / Math.max(dt, 0.05);
    state.speed = source.speed;
    const cruise = source.speed > 1 ? 0.15 : 0;
    return clamp(Math.abs(acc) < 0.08 ? cruise : acc / 1.2, -1, 1);
  }

  updatePool(pool, candidates, limit, now, dt, siren = false) {
    for (const slot of pool.values()) slot.selected = false;
    let count = 0;
    for (const source of candidates) {
      if (siren && !source.police) continue;
      if (++count > limit) break;
      let slot = pool.get(source.id);
      if (!slot) {
        // Retiring voices count against the budget, so rapid source changes cannot temporarily double the graph.
        if (pool.size >= limit) continue;
        const streetcar = !siren && source.kind === 'streetcar';
        const emitter = new SpatialEmitter(this.context, this.mix, this.reflections, this.acoustics,
          siren ? 9 : source.kind === 'helicopter' ? 12 : streetcar ? 7 : 4, siren ? 0.9 : 0, siren, this.panningModel);
        const voice = streetcar ? createStreetcarVoice(this.context, this.resources, emitter.input)
          : createMotorVoice(this.context, this.resources, siren ? 'siren' : source.kind, emitter.input,
            { squeal: source.player && source.id.type === 'car' });
        slot = { emitter, voice, distance: 0, x: source.x, y: source.y, z: source.z, fresh: true };
        pool.set(source.id, slot);
      }
      slot.selected = true;
      slot.retire = 0;
      const jumped = Math.hypot(source.x - slot.x, source.y - slot.y, source.z - slot.z) > 35;
      const range = source.range;
      const distance = slot.emitter.update(source, this.listener, now, range, slot.fresh || jumped);
      const radial = slot.fresh || jumped ? 0 : clamp((distance - slot.distance) / dt, -60, 60);
      const params = this.motorParams;
      params.speed = source.speed;
      params.load = !siren && source.kind === 'streetcar' ? this.streetcarLoad(source, dt, now) : source.load;
      params.verticalSpeed = source.verticalSpeed;
      params.skid = source.skid;
      params.rpm = source.rpm;
      params.curve = source.curve;
      params.seed = source.seed;
      params.doppler = clamp(343 / (343 + radial), 0.85, 1.18);
      slot.voice.update(params, now);
      slot.distance = distance;
      slot.x = source.x; slot.y = source.y; slot.z = source.z;
      slot.fresh = false;
    }
    for (const [id, slot] of pool) {
      if (slot.selected) continue;
      if (!slot.retire) {
        smooth(slot.emitter.input.gain, 0, now, 0.025);
        slot.retire = now + 0.12;
      } else if (now >= slot.retire) {
        slot.voice.dispose(); slot.emitter.dispose(); pool.delete(id);
      }
    }
  }

  removeEvent(index) {
    const event = this.events[index];
    event.voice.dispose(true);
    event.emitter.dispose();
    this.events.splice(index, 1);
  }

  emit(kind, source, options = {}) {
    const now = this.context.currentTime;
    const crash = kind === 'crash';
    const severity = clamp(options.severity ?? options.intensity ?? 1, 0, 1);
    const space = EVENT_SPACE[kind] || [1.8, 35, 0, false];
    const ref = crash ? 4 + severity * 8 : space[0];
    const range = crash ? 50 + severity * 110 : space[1];
    if (Math.hypot(source.x - this.listener.x, source.y - this.listener.y, source.z - this.listener.z) > range) return false;
    if (crash) {
      // Impacts are immediate, between the 10 Hz ambience updates. Reclaim finished events first, then let
      // a strong impact displace a quieter crash or background event without increasing the voice budget.
      for (let i = this.events.length - 1; i >= 0; i--) {
        if (now >= this.events[i].voice.endTime) this.removeEvent(i);
      }
      let crashes = 0, weakest = -1;
      for (let i = 0; i < this.events.length; i++) {
        const event = this.events[i];
        if (event.kind !== 'crash') continue;
        crashes++;
        if (weakest < 0 || event.severity < this.events[weakest].severity) weakest = i;
      }
      if (crashes >= Math.min(3, this.limits.events)) {
        if (severity <= this.events[weakest].severity) return false;
        this.removeEvent(weakest);
      }
      if (this.events.length >= this.limits.events) {
        const background = this.events.findIndex(event => event.kind !== 'crash' && event.kind !== 'horn');
        if (background < 0) return false;
        this.removeEvent(background);
      }
    }
    if (this.events.length >= this.limits.events) return false;
    const emitter = new SpatialEmitter(this.context, this.mix, this.reflections, this.acoustics,
      ref, space[2], space[3], this.panningModel);
    // Do not fade away the first few milliseconds of a crash: its spatial gain and filtering are ready at onset.
    emitter.update(source, this.listener, now, range, true, crash);
    const voice = playEvent(this.context, this.resources, kind, emitter.input, { seed: source.seed, ...options });
    this.events.push({ kind, voice, emitter, id: source.id, range, severity, position: { ...source }, follow: FOLLOWS.has(kind) });
    return true;
  }

  crash(impact) {
    if (!this.ready || !this.enabled || !this.haveListener || !this.running || document.hidden) return false;
    const { a, b, x, y, z, speed } = impact;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || a === b
      || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(speed) || speed < 0.8) return false;
    const now = this.context.currentTime;
    const active = this.controllers.getActiveEntity();
    if (a === active || b === active) this.lastPlayerContact = now; // (detectImpact leaves this one to the traffic)
    if (Math.hypot(x - this.listener.x, y - this.listener.y, z - this.listener.z) > 160) return false;
    let contacts = this.collisionPairs.get(a);
    if (!contacts) this.collisionPairs.set(a, contacts = new WeakMap());
    let contact = contacts.get(b);
    if (!contact) {
      contact = { last: -Infinity, played: -Infinity, speed: 0 };
      contacts.set(b, contact);
      let reverse = this.collisionPairs.get(b);
      if (!reverse) this.collisionPairs.set(b, reverse = new WeakMap());
      reverse.set(a, contact);
    }
    const separated = now - contact.last > 0.3;
    contact.last = now;
    // Both pair orders share the gate. Sustained rubbing stays quiet, but a substantially stronger second hit
    // or a new impact after separation can sound again; muting/reset discards this history rather than queuing it.
    if (now - contact.played < 0.18 || (!separated && speed <= Math.max(4, contact.speed * 1.8))) return false;
    const light = a.type === 'cyclist' || b.type === 'cyclist';
    const severity = clamp((speed - 0.8) / 22, 0, 1) * (light ? 0.65 : 1);
    const intensity = (0.12 + 0.88 * Math.sqrt(severity)) * (light ? 0.7 : 1);
    // The physics record is reused. emit() copies this position so the crash remains at the contact point.
    if (!this.emit('crash', { id: a, x, y, z, seed: ++this.collisionSequence }, { severity, intensity })) return false;
    contact.played = now;
    contact.speed = speed;
    return true;
  }

  // The player's own impacts, every frame: the controllers knock the velocity back when it hits a building, a wall,
  // the lake's edge or (the helicopter) the ground. Braking or steering never changes it by more than ~25 m/s² (or by
  // a boost being let go, skipped); a teleport moves it further than it could travel, also skipped.
  detectImpact(dt, now) {
    const e = this.controllers.getActiveEntity();
    const t = this.impact;
    const p = e.position;
    const heli = e.type === 'helicopter';
    const speed = e.speed || 0;
    const vx = Math.sin(e.heading) * speed + (e.vx || 0);
    const vz = Math.cos(e.heading) * speed + (e.vz || 0);
    const vy = heli && t.entity === e && dt > 0 ? (p.y - t.y) / dt : 0;
    const boost = !!this.controllers.keys.boost;
    if (t.entity === e && dt > 0 && e.type !== 'person' && boost === t.boost) {
      const moved = Math.hypot(p.x - t.x, p.z - t.z);
      const reach = Math.max(Math.hypot(vx, vz), Math.hypot(t.vx, t.vz)) * dt + 4;
      const dx = vx - t.vx, dy = vy - t.vy, dz = vz - t.vz;
      const dv = Math.hypot(dx, dy, dz);
      if (moved < reach && dv > 2 + 30 * dt && now - this.lastPlayerContact > 0.3) {
        // The knock points away from what was hit: the contact is that way from the centre
        const horizontal = Math.hypot(dx, dz);
        const ground = heli && Math.abs(dy) > horizontal;
        const extent = heli ? 4.5 : e.type === 'car' ? 2.1 : 0.9;
        const nx = ground ? 0 : dx / horizontal, nz = ground ? 0 : dz / horizontal;
        this.crash({ a: e, b: this.worldCollider, x: p.x - nx * extent, y: ground ? p.y : p.y + (heli ? 1.1 : 0.56),
          z: p.z - nz * extent, speed: dv });
      }
    }
    t.entity = e; t.x = p.x; t.y = p.y; t.z = p.z; t.vx = vx; t.vy = vy; t.vz = vz; t.boost = boost;
  }

  honk(entity) {
    if (!this.ready || !this.enabled || !this.running) return;
    const now = this.context.currentTime;
    if (now - this.lastHorn < 0.8 || !this.haveListener) return;
    const kind = entity?.type === 'car' ? 'horn' : entity?.type === 'cyclist' ? 'bikebell' : null;
    if (kind && this.emit(kind, { id: entity, ...entity.position, heading: entity.heading, seed: 4 }, { intensity: 0.7 })) this.lastHorn = now;
  }

  streetcarBell(car, { double = true } = {}) {
    if (!this.ready || !this.enabled || !this.haveListener || !this.running || !car) return false;
    const sections = car.sections;
    const nose = sections && sections.length ? sections[0] : car;
    if (!Number.isFinite(nose.x) || !Number.isFinite(nose.z)) return false;
    return this.emit('bell', { id: car, x: nose.x, y: Number.isFinite(car.y) ? car.y : 0, z: nose.z,
      heading: nose.yaw, seed: ++this.gullSequence }, { intensity: 0.8, double });
  }

  update(dt, elapsed, camera, night = 0) {
    if (!this.ready || !this.enabled || !this.running || document.hidden) return;
    const frameNow = this.context.currentTime;
    if (this.haveListener) this.detectImpact(dt, frameNow);
    this.accumulator += dt;
    if (this.accumulator < 0.1) return;
    dt = Math.min(this.accumulator, 0.25);
    this.accumulator %= 0.1;
    const now = this.context.currentTime;
    const position = camera.position;
    if (this.haveListener && Math.hypot(position.x - this.listener.x, position.y - this.listener.y, position.z - this.listener.z) > 60) this.reset();
    this.listener.x = position.x; this.listener.y = position.y; this.listener.z = position.z;
    camera.updateMatrixWorld();
    const m = camera.matrixWorld.elements;
    const listener = this.context.listener;
    if (listener.positionX) {
      const values = [position.x, position.y, position.z, -m[8], -m[9], -m[10], m[4], m[5], m[6]];
      const params = [listener.positionX, listener.positionY, listener.positionZ, listener.forwardX, listener.forwardY,
        listener.forwardZ, listener.upX, listener.upY, listener.upZ];
      for (let i = 0; i < params.length; i++) {
        if (this.haveListener) smooth(params[i], values[i], now, 0.025);
        else params[i].setValueAtTime(values[i], now);
      }
    } else {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(-m[8], -m[9], -m[10], m[4], m[5], m[6]);
    }
    if (!this.haveListener) this.detectImpact(0, now);
    this.haveListener = true;
    this.acoustics.update(this.listener, now);
    const enclosure = this.acoustics.enclosure;
    smooth(this.reflections.gain, 0.02 + enclosure * 0.22, now, 0.4);
    smooth(this.reflectionFilter.frequency, 2400 + enclosure * 3400, now, 0.4);
    smooth(this.master.gain, 0.65, now, 0.12);
    const sources = this.sources.collect(this.listener, elapsed);
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (now >= event.voice.endTime) {
        this.removeEvent(i);
      } else {
        const pair = event.position.conversation;
        if (pair && (pair.a.conversation !== pair || pair.b.conversation !== pair)) {
          event.voice.dispose();
          event.follow = false; // Fade at the old position if the meeting ended or a pedestrian was recycled.
        }
        const source = event.follow && (sources.motors.find(s => s.id === event.id) || sources.people.find(s => s.id === event.id));
        if (source) Object.assign(event.position, source);
        event.emitter.update(event.position, this.listener, now, event.range);
      }
    }
    this.updatePool(this.motors, sources.motors, this.limits.motors, now, dt);
    this.updatePool(this.sirens, sources.sirens, this.limits.sirens, now, dt, true);
    for (const source of sources.people) {
      const state = this.state(source, now);
      const moved = Math.hypot(source.x - state.x, source.z - state.z);
      if (source.grounded && moved < 3 && Number.isFinite(state.phase)) {
        for (let foot = 0; foot < 2; foot++) {
          // The rig plants each foot when its phase wraps, including different stride lengths and running gaits.
          const offset = foot * 0.5;
          const planted = (source.phase + offset) % 1 < (state.phase + offset) % 1;
          if ((planted && source.speed > 0.2) || (!state.grounded && foot === 0)) {
            const position = this.footPosition;
            position.x = foot ? source.rightX : source.leftX;
            position.y = foot ? source.rightY : source.leftY;
            position.z = foot ? source.rightZ : source.leftZ;
            position.seed = source.seed;
            this.emit('footstep', position, { intensity: source.speed > 3 ? 0.65 : 0.4,
              seed: source.seed + state.stepSequence++, speed: source.speed });
          }
        }
      }
      state.phase = source.phase; state.grounded = source.grounded;
      state.x = source.x; state.z = source.z;
      // Pedestrians without a conversation partner say something now and then (f98e8da's chatter)
      if (source.chatty && now >= state.talk) {
        if (this.emit('talk', source, { intensity: 0.3, seed: source.seed + state.talkSequence++, voiceSeed: source.seed })) {
          const pause = Math.sin(source.seed + state.talkSequence * 17.13) * 0.5 + 0.5;
          state.talk = now + 8 + pause * 17;
        } else {
          state.talk = now + 1.5; // (no voice free: try again in a moment)
        }
      }
    }
    this.updateConversations(sources.people, now);
    for (const source of sources.signals) {
      const state = this.state(source, now);
      if (state.walk !== source.walk) {
        if (state.walk !== undefined) {
          for (let i = this.events.length - 1; i >= 0; i--) {
            const event = this.events[i];
            if (event.kind !== 'signal' || event.id !== source.id) continue;
            this.removeEvent(i);
          }
        }
        state.walk = source.walk;
        state.signal = now;
      }
      if (now + 0.12 >= state.signal) {
        const when = Math.max(now, state.signal);
        this.emit('signal', source, { walk: source.walk, ns: source.ns, intensity: 0.28, when });
        // Toronto's cadence: the cuckoo every 1.5 s, the chirp every second, the locator tick every second
        state.signal = when + (source.walk && source.ns ? 1.5 : 1);
      }
    }
    const rider = this.controllers.getActiveEntity();
    for (const source of sources.motors) {
      if (source.player || source.kind === 'helicopter' || source.kind === 'cyclist') continue;
      if (source.kind === 'streetcar') continue;
      const state = this.state(source, now);
      state.stopped = source.blocked ? state.stopped + dt : 0;
      if (state.stopped > 4 && now > state.horn && now - this.lastHorn > 3) {
        if (this.emit('horn', source, { intensity: 0.55 })) {
          state.horn = now + 18 + state.variation * 15;
          this.lastHorn = now;
        }
      }
      // A bus's air brakes let go as it comes to a stand
      if (source.kind === 'bus') {
        if (source.speed > 2) { state.moved = now; state.hissed = false; }
        else if (!state.hissed && source.speed < 0.25 && now - state.moved < 6) {
          state.hissed = true;
          this.emit('hiss', source, { intensity: 0.7 + state.variation * 0.3 });
        }
      }
    }
    for (const source of sources.streetcars) this.streetcarCues(source, this.state(source, now), rider, now, dt);
    // Lake Ontario: the water at the wall, and the gulls over it, in the day mostly
    this.waterfront.update(this.listener, now);
    const exposure = this.waterfront.exposure;
    Object.assign(this.lakeParams, { exposure, altitude: position.y, enclosure });
    this.lake.update(this.lakeParams, now);
    if (exposure > 0.12 && now >= this.nextGull) {
      const points = this.waterfront.points;
      const hash = (k) => { const v = Math.sin((this.gullSequence + 1) * 91.7 + k * 13.3) * 43758.5453; return v - Math.floor(v); };
      if (points.length) {
        const p = points[Math.floor(hash(1) * points.length)];
        const roll = hash(2);
        const call = roll < 0.3 ? 'long' : roll < 0.55 ? 'laugh' : 'mew';
        this.emit('gull', { id: this.waterfront, x: p.x + (hash(3) - 0.5) * 30, y: 6 + hash(4) * 20, z: p.z + (hash(5) - 0.5) * 30,
          seed: ++this.gullSequence }, { call, intensity: 0.55 + hash(6) * 0.45 });
      }
      this.nextGull = now + (night > 0.5 ? 30 + hash(7) * 50 : 3 + hash(7) * 9) / Math.min(1, exposure * 2);
    }
    Object.assign(this.windParams, { speed: Math.min(sources.motion, 50), altitude: position.y, traffic: sources.traffic, night, enclosure });
    this.wind.update(this.windParams, now);
  }

  // The streetcar's bell: as it pulls away from a stand of a few seconds (a stop, a red light), and at a rider on the
  // tracks 15-40 m ahead of its nose (once every 7 s at most)
  streetcarCues(source, state, rider, now, dt) {
    if (source.speed < 0.3) state.still += dt;
    else {
      if (state.still > 2.5) this.emit('bell', source, { intensity: 0.75 });
      state.still = 0;
    }
    if (source.speed < 2 || now < state.warn || !rider || rider.type === 'helicopter') return;
    const sin = Math.sin(source.heading), cos = Math.cos(source.heading);
    const dx = rider.position.x - source.x, dz = rider.position.z - source.z;
    const ahead = dx * sin + dz * cos;
    const side = Math.abs(dx * cos - dz * sin);
    if (ahead > 28 && ahead < 55 && side < 2.4) {
      state.warn = now + 7;
      this.emit('bell', source, { intensity: 1 });
    }
  }

  dispose() {
    this.disposed = true;
    for (const system of this.collisionSystems) system.setCollisionListener?.(null);
    document.removeEventListener('pointerdown', this.onGesture);
    document.removeEventListener('pointerup', this.onGesture);
    document.removeEventListener('keydown', this.onGesture);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.reset();
    this.wind?.dispose(true);
    this.lake?.dispose();
    for (const node of [this.mix, this.compressor, this.master, this.reflections, this.reverb, this.reflectionFilter]) node?.disconnect();
    if (this.context) {
      this.context.onstatechange = null;
      this.context.close().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The app's sound (main.js creates it once the controllers exist; update() every frame): the toolbar's speaker button,
// keys N (mute) & B (horn / bike bell), and the window.CITY.Audio hooks
// ---------------------------------------------------------------------------------------------------------------------
const pendingStreetcars = [];
let current = null;

function createCityAudio({ controllerManager, trafficSystem, highwayTraffic, streetDetails, cameraSystem, lightingSystem, mapSystem }) {
  const button = document.getElementById('btn-sound');
  const system = new CityAudioSystem({ controllerManager, trafficSystem, highwayTraffic, streetDetails }, { onStateChange: render });
  for (const streetcars of pendingStreetcars.splice(0)) system.sources.addStreetcars(streetcars);
  function render() {
    if (!button) return;
    button.disabled = !system.supported;
    button.setAttribute('aria-pressed', String(system.enabled));
    button.setAttribute('aria-label', system.enabled ? 'Mute sound' : 'Turn the sound on');
    button.title = system.supported ? `${system.enabled ? 'Mute' : 'Turn on'} the sound [N]` : 'Web Audio is unavailable';
    const use = button.querySelector('use');
    if (use) use.setAttribute('href', system.enabled ? '#i-sound' : '#i-sound-off');
  }
  if (button) button.addEventListener('click', () => system.setEnabled(!system.enabled));
  render();
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e) || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'KeyN') system.setEnabled(!system.enabled);
    else if (e.code === 'KeyB' && !(mapSystem && mapSystem.isFullMapOpen)) system.honk(controllerManager.getActiveEntity());
  });
  // pagehide also covers navigation away on mobile; preserve the context across back-forward cache restores.
  window.addEventListener('pagehide', (event) => { if (!event.persisted) system.dispose(); });

  let wasReady = false;
  function update(dt, elapsed) {
    const app = window.__CITY_APP;
    const ready = !!(app && app.ready) && !(app.film && app.film.active);
    if (wasReady && !ready) system.silence();
    wasReady = system.ready = ready;
    const preset = lightingSystem && lightingSystem.activePresetId;
    system.update(dt, elapsed, cameraSystem.camera, preset === 'midnight' ? 1 : preset === 'twilight' ? 0.4 : 0);
  }
  current = { system, update };
  return { system, update, setEnabled: (on) => system.setEnabled(on), honk: (entity) => system.honk(entity) };
}

const api = {
  get system() { return current ? current.system : null; },
  get enabled() { return current ? current.system.enabled : false; },
  setEnabled(on) { if (current) current.system.setEnabled(on); },
  addStreetcars(streetcars) {
    if (current) current.system.sources.addStreetcars(streetcars);
    else pendingStreetcars.push(streetcars);
  },
  streetcarBell(car, options) { return current ? current.system.streetcarBell(car, options) : false; }
};

Object.assign(window.CITY, { CityAudioSystem, createCityAudio, Audio: api });
})();
