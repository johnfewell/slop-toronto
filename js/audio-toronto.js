(function () {
// js/audio-toronto.js
// The city's sound, part 3 of 6: Toronto's own sounds, synthesized like the rest (no samples), on top of mrdoob's city
// audio (audio-synthesis.js, audio-events.js):
// - The TTC streetcar (createStreetcarVoice, a motor voice like the cars'): the traction inverters' whine rising with
//   speed (and the PWM carrier's buzz pulling away), the gearbox hum, steel wheels rolling and ringing on the rails,
//   the clack of each bogie over the rail joints, and flange squeal in the tight curves. Its bell (the 'bell' event:
//   ding-ding) rings as it pulls away from a stop and at a rider on the tracks ahead (audio-system.js).
// - The waterfront (createLakeVoice): Lake Ontario lapping at the seawall and the beaches, louder the more water is
//   around the listener (WaterfrontProbe samples city-config.js waterAt), and ring-billed & herring gulls calling over
//   the water (the 'gull' event: long calls, laughs & single mews).
// - Crossing signals as Toronto's accessible pedestrian signals sound them: a cuckoo for crossing north-south, a chirp
//   for east-west on the WALK, a quiet locator tick otherwise; the buses' air brakes hissing at stops ('hiss'); and a
//   bicycle bell for the player's bike ('bikebell', key B).
// World frame: x grid east, z grid south, y up, metres.

const { setControlRate, smoothParameter } = window.CITY.AudioSynthesis;
const { waterAt } = window.CITY;

const TAU = Math.PI * 2;
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, finite(value)));
const smoothstep = (a, b, value) => { const x = clamp((value - a) / (b - a)); return x * x * (3 - 2 * x); };

function randomSource(seed) {
  let state = (finite(seed, 1) * 2654435761) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x7feb352d);
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b);
  state ^= state >>> 16;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// A one-shot buffer, mean removed, faded at both ends (no clicks) and scaled to `peak`
function makeBuffer(ctx, duration, synthesize, peak = 0.6) {
  const buffer = ctx.createBuffer(1, Math.ceil(duration * ctx.sampleRate), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  let maximum = 0, mean = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = synthesize(i / ctx.sampleRate, i);
    mean += samples[i];
  }
  mean /= samples.length;
  for (let i = 0; i < samples.length; i++) {
    const fade = Math.min(1, i / (ctx.sampleRate * 0.002), (samples.length - 1 - i) / (ctx.sampleRate * 0.012));
    samples[i] = (samples[i] - mean) * fade;
    maximum = Math.max(maximum, Math.abs(samples[i]));
  }
  const scale = maximum > 0 ? peak / maximum : 0;
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  return buffer;
}

// ---------------------------------------------------------------------------------------------------------------------
// One-shot buffers
// ---------------------------------------------------------------------------------------------------------------------

// A struck bell: inharmonic partials, each with its own decay and a slow beat between its two halves, over a short
// strike. The streetcar's is a bright tram gong (~880 Hz); the bicycle's a small thumb-bell dome (~3.2 kHz).
function bell(ctx, { f0, partials, duration, strike, seed }) {
  const random = randomSource(seed);
  const modes = partials.map(([ratio, level, decay]) => ({
    f: f0 * ratio * (0.995 + random() * 0.01), level, decay, beat: 0.4 + random() * 1.2, phase: random() * TAU
  }));
  let hiss = 0;
  return makeBuffer(ctx, duration, (t) => {
    let v = 0;
    for (const m of modes) {
      const env = Math.exp(-t / m.decay) * (1 - Math.exp(-t * 900));
      v += Math.sin(TAU * m.f * t + m.phase) * env * m.level * (0.82 + 0.18 * Math.cos(TAU * m.beat * t));
    }
    const noise = random() * 2 - 1;
    hiss += (noise - hiss) * 0.5;
    return v + (noise - hiss) * Math.exp(-t / strike) * 0.6;
  }, 0.7);
}

// A gull's call, note by note: each note a harmonic-rich cry following its pitch contour (rise, then the long fall of
// "kyow"), with a nasal formant, jitter, a rough subharmonic at its loudest, and a little breath
function gullCall(ctx, seed, type) {
  const random = randomSource(seed);
  const notes = [];
  let t = 0;
  const base = 0.92 + random() * 0.16;
  if (type === 'long') {
    // a long rising "aaah", then a falling run of kyows, shorter and lower as it goes
    notes.push({ start: 0, len: 0.34, f: [760, 1180, 1250], loud: 0.7 });
    t = 0.46;
    const count = 4 + Math.floor(random() * 4);
    for (let i = 0; i < count; i++) {
      const len = 0.26 - i * 0.016 + random() * 0.03;
      notes.push({ start: t, len, f: [1150 - i * 25, 1500 - i * 40, 820 - i * 20], loud: 1 - i * 0.07 });
      t += len + 0.08 + random() * 0.05;
    }
  } else if (type === 'laugh') {
    // ha-ha-ha-ha: short barks, evenly paced
    const count = 5 + Math.floor(random() * 4);
    for (let i = 0; i < count; i++) {
      notes.push({ start: t, len: 0.085 + random() * 0.02, f: [880, 1020, 860], loud: 0.85 + random() * 0.15 });
      t += 0.145 + random() * 0.02;
    }
  } else {
    // one or two mewing kyows
    const count = 1 + (random() < 0.45 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const len = 0.3 + random() * 0.08;
      notes.push({ start: t, len, f: [1050, 1580, 760], loud: 1 });
      t += len + 0.18;
    }
  }
  const duration = notes.reduce((end, n) => Math.max(end, n.start + n.len), 0) + 0.05;
  const harmonics = [1, 0.85, 0.62, 0.42, 0.3, 0.2, 0.13, 0.08];
  const formant = 2600 + random() * 500;
  let phase = 0, sub = 0, index = 0, breath = 0, jitter = 1;
  return makeBuffer(ctx, duration, (time) => {
    while (index + 1 < notes.length && time >= notes[index + 1].start) index++;
    const n = notes[index];
    const local = time - n.start;
    if (local < 0 || local > n.len) return 0;
    const p = local / n.len;
    // pitch: the first fifth rises to the peak, the rest falls away
    const f = (p < 0.2 ? n.f[0] + (n.f[1] - n.f[0]) * Math.sin((p / 0.2) * Math.PI / 2)
      : n.f[1] + (n.f[2] - n.f[1]) * ((p - 0.2) / 0.8) ** 1.3) * base * jitter;
    phase += f / ctx.sampleRate;
    sub += f / 2 / ctx.sampleRate;
    if (phase >= 1) { phase -= 1; jitter = 0.985 + random() * 0.03; }
    if (sub >= 1) sub -= 1;
    let v = 0;
    for (let k = 0; k < harmonics.length; k++) {
      const fk = f * (k + 1);
      if (fk > ctx.sampleRate * 0.45) break;
      const boost = 1 + 1.6 * Math.exp(-(((fk - formant) / 900) ** 2));
      v += Math.sin(TAU * phase * (k + 1)) * harmonics[k] * boost;
    }
    const env = smoothstep(0, 0.03, local) * smoothstep(0, 0.06, n.len - local) * n.loud;
    const rough = Math.sin(TAU * sub) * 0.22 * Math.sin(Math.PI * p) ** 2;
    const noise = random() * 2 - 1;
    breath += (noise - breath) * 0.3;
    return (v * (1 + rough) + (noise - breath) * 0.25) * env;
  }, 0.6);
}

// A bus's air brakes letting go at a stop: a hard "pssh" of high, slightly whistling air, easing off
function airHiss(ctx, seed) {
  const random = randomSource(seed);
  const lowC = 1 - Math.exp(-TAU * 1400 / ctx.sampleRate), highC = 1 - Math.exp(-TAU * 7000 / ctx.sampleRate);
  let low = 0, high = 0;
  const whistle = 3200 + random() * 900;
  const len = 0.75 + random() * 0.35;
  return makeBuffer(ctx, len + 0.1, (t) => {
    const noise = random() * 2 - 1;
    low += (noise - low) * lowC;
    high += (noise - high) * highC;
    const env = (1 - Math.exp(-t * 260)) * Math.exp(-t / (len * 0.42)) * (1 + 0.08 * Math.sin(t * 61));
    return ((high - low) + Math.sin(TAU * whistle * t) * 0.05) * env;
  }, 0.55);
}

// Accessible pedestrian signals as Toronto's sound them: a two-note cuckoo (north-south) and a quick double chirp
// (east-west)
function cuckoo(ctx) {
  const notes = [{ start: 0, len: 0.15, f: 1240 }, { start: 0.21, len: 0.24, f: 1010 }];
  return makeBuffer(ctx, 0.48, (t) => {
    let v = 0;
    for (const n of notes) {
      const local = t - n.start;
      if (local < 0 || local > n.len) continue;
      const env = smoothstep(0, 0.012, local) * smoothstep(0, 0.04, n.len - local);
      const f = n.f * (1 + 0.004 * Math.sin(local * 38));
      v += (Math.sin(TAU * f * local) + Math.sin(TAU * 3 * f * local) * 0.12) * env;
    }
    return v;
  }, 0.5);
}

function chirp(ctx) {
  return makeBuffer(ctx, 0.2, (t) => {
    let v = 0;
    for (const start of [0, 0.11]) {
      const local = t - start;
      if (local < 0 || local > 0.045) continue;
      // a quick upward sweep, 2.7 -> 3.6 kHz
      const phase = 2700 * local + (900 / (2 * 0.045)) * local * local;
      v += Math.sin(TAU * phase) * smoothstep(0, 0.004, local) * smoothstep(0, 0.012, 0.045 - local);
    }
    return v;
  }, 0.45);
}

// A wheel over a rail joint, the streetcar's "dunk" (John, who hears them every day: "gadunk, gadunk, kadunka dunk"):
// a heavy, low knock of the truck and the car body, its pitch dropping as it rings out (130 -> 55 Hz), a wooden mid
// knock over it and only a trace of the rail's ring; `heavy` 0 is the lighter "ka" of a truck's leading axle
function railClack(ctx, seed, heavy = 1) {
  const random = randomSource(seed);
  const lowC = 1 - Math.exp(-TAU * 180 / ctx.sampleRate);
  let low = 0, phase = 0, knockPhase = 0;
  const f0 = 125 + random() * 20, f1 = 52 + random() * 8, knock = 290 + random() * 60, ring = 1900 + random() * 400;
  const bodyDecay = 0.07 + 0.05 * heavy;
  return makeBuffer(ctx, 0.32, (t) => {
    const noise = random() * 2 - 1;
    low += (noise - low) * lowC;
    phase += (f1 + (f0 - f1) * Math.exp(-t / 0.035)) / ctx.sampleRate;
    knockPhase += knock / ctx.sampleRate;
    const attack = 1 - Math.exp(-t * 1500);
    const body = Math.sin(TAU * phase) * Math.exp(-t / bodyDecay) * (0.7 + 0.3 * heavy);
    const mid = Math.sin(TAU * knockPhase) * Math.exp(-t / 0.03) * 0.35;
    const thud = low * 2.2 * Math.exp(-t / 0.018);
    const tink = Math.sin(TAU * ring * t) * Math.exp(-t / 0.012) * 0.06;
    return attack * (body + mid + thud) + tink;
  }, 0.6 + 0.3 * heavy);
}

// Control loops at a low rate for the lake: `swell`, the water rising and falling at the wall (uneven waves 2-4.5 s
// apart), and `crest`, its sharpened tops, when the waves break and fizz. Both wrap seamlessly.
function lakeBuffers(ctx) {
  const rate = 8000, duration = 36;
  const swell = ctx.createBuffer(1, rate * duration, rate);
  const crest = ctx.createBuffer(1, rate * duration, rate);
  const s = swell.getChannelData(0), c = crest.getChannelData(0);
  const random = randomSource(1793);
  const waves = [];
  let t = 0;
  while (t < duration - 2) {
    const period = 2.1 + random() * 2.4;
    waves.push({ start: t, period, height: 0.45 + random() * 0.55 });
    t += period;
  }
  const stretch = duration / t; // the waves fill the loop exactly
  for (const w of waves) { w.start *= stretch; w.period *= stretch; }
  for (const w of waves) {
    for (let i = Math.floor(w.start * rate); i < Math.min(s.length, Math.ceil((w.start + w.period) * rate)); i++) {
      const p = (i / rate - w.start) / w.period;
      // a slow rise as the wave runs in, a quick fall as it breaks and draws back
      const shape = p < 0.7 ? Math.sin((p / 0.7) * Math.PI / 2) : Math.cos(((p - 0.7) / 0.3) * Math.PI / 2);
      s[i] = 0.18 + 0.82 * w.height * shape * shape;
      c[i] = (w.height * Math.max(0, shape)) ** 6 * (p > 0.6 && p < 0.85 ? 1.6 : 0.5);
    }
  }
  return { swell, crest };
}

// The buffers (pure computation: audio-system.js runs this in a worker, see synthesizeOffThread)
function torontoBuffers(ctx) {
  return {
    bell: bell(ctx, {
      f0: 880, duration: 1.7, strike: 0.004, seed: 7,
      partials: [[0.5, 0.3, 1.5], [1, 1, 1.2], [1.19, 0.45, 0.9], [1.5, 0.32, 0.7], [2, 0.5, 0.55], [2.52, 0.22, 0.35], [3.01, 0.15, 0.25]]
    }),
    bikeBell: bell(ctx, {
      f0: 3150, duration: 1.0, strike: 0.002, seed: 11,
      partials: [[1, 1, 0.55], [1.52, 0.5, 0.4], [2.35, 0.32, 0.25], [2.9, 0.2, 0.18]]
    }),
    gulls: {
      long: [gullCall(ctx, 21, 'long'), gullCall(ctx, 22, 'long')],
      laugh: [gullCall(ctx, 31, 'laugh'), gullCall(ctx, 32, 'laugh')],
      mew: [gullCall(ctx, 41, 'mew'), gullCall(ctx, 42, 'mew'), gullCall(ctx, 43, 'mew')]
    },
    hiss: [airHiss(ctx, 51), airHiss(ctx, 52)],
    cuckoo: cuckoo(ctx),
    chirp: chirp(ctx),
    clacks: [railClack(ctx, 61, 0), railClack(ctx, 62, 0), railClack(ctx, 63, 1), railClack(ctx, 64, 1)], // ka, ka, dunk, dunk
    ...lakeBuffers(ctx)
  };
}

// The resources with Toronto's buffers (resources.toronto) and its events
function withTorontoEvents(resources) {
  const toronto = resources.toronto;
  // Events audio-events.js playEvent() plays through its own envelope & clean-up: player(play, start, random, options)
  const eventPlayers = {
    // walk: the cuckoo or the chirp by the crossing's direction; otherwise the locator tick
    signal: (play, start, random, options) => {
      if (options.walk) play(options.ns ? toronto.cuckoo : toronto.chirp, start);
      else play(resources.signalTick, start, 1, 0.55);
    },
    bell: (play, start, random, options) => {
      const rate = 0.985 + random() * 0.03;
      play(toronto.bell, start, rate);
      if (options.double !== false) play(toronto.bell, start + 0.3, rate, 0.85);
    },
    bikebell: (play, start, random) => {
      const rate = 0.97 + random() * 0.06;
      play(toronto.bikeBell, start, rate);
      play(toronto.bikeBell, start + 0.15, rate, 0.8);
    },
    gull: (play, start, random, options) => {
      const set = toronto.gulls[options.call] || toronto.gulls.mew;
      play(set[Math.floor(random() * set.length)], start, 0.92 + random() * 0.16);
    },
    hiss: (play, start, random) => {
      play(toronto.hiss[Math.floor(random() * toronto.hiss.length)], start, 0.9 + random() * 0.2);
    }
  };
  return {
    ...resources,
    eventPlayers,
    eventLevels: { bell: 0.3, bikebell: 0.2, gull: 0.5, hiss: 0.12 }
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The streetcar's voice: the same interface as audio-synthesis.js createMotorVoice ({ update(params, now), dispose() }),
// params { speed (m/s), load (-1 braking .. 1 full traction), curve (0 straight .. 1 the tightest bends), doppler, seed }
// ---------------------------------------------------------------------------------------------------------------------
const JOINT_AXLES = [0, 1.85, 10.6, 12.45, 21.2, 23.05]; // m behind the first axle: three bogies of two axles

function createStreetcarVoice(context, resources, output) {
  const toronto = resources.toronto;
  const nodes = [];
  const sources = [];
  const shots = new Set();
  let disposed = false;
  let variation = 0.5, lastSeed = NaN;
  const own = (node) => { nodes.push(node); return node; };
  const gain = (value = 0) => { const node = own(context.createGain()); node.gain.value = value; return node; };
  const filter = (type, frequency, q = 0.7) => {
    const node = own(context.createBiquadFilter());
    setControlRate(node.frequency, node.detune, node.Q, node.gain);
    node.type = type;
    node.frequency.value = Math.min(frequency, context.sampleRate * 0.45);
    node.Q.value = q;
    return node;
  };
  const oscillator = (type, frequency) => {
    const node = own(context.createOscillator());
    if (typeof type === 'string') node.type = type;
    else node.setPeriodicWave(type);
    node.frequency.value = frequency;
    sources.push(node);
    return node;
  };
  const loop = (buffer = resources.noise) => {
    const node = own(context.createBufferSource());
    node.buffer = buffer;
    node.loop = true;
    sources.push(node);
    return node;
  };
  const mix = gain();
  mix.channelCount = 1;
  mix.channelCountMode = 'explicit';
  mix.connect(output);

  // Traction inverters: a whine (fundamental & a slightly beating octave) and, pulling away, the PWM carrier's buzz
  const whineWave = context.createPeriodicWave(new Float32Array(6), new Float32Array([0, 1, 0.3, 0.14, 0.07, 0.04]));
  const whine = oscillator(whineWave, 200);
  const whineOctave = oscillator('sine', 400);
  const carrier = oscillator('sawtooth', 1050);
  const whineFilter = filter('lowpass', 3600, 0.6);
  const whineGain = gain(), octaveGain = gain(), carrierGain = gain();
  whine.connect(whineGain).connect(whineFilter);
  whineOctave.connect(octaveGain).connect(whineFilter);
  carrier.connect(carrierGain).connect(whineFilter);
  whineFilter.connect(mix);
  // Gearbox hum
  const gear = oscillator('triangle', 60);
  const gearGain = gain();
  gear.connect(gearGain).connect(mix);
  // Steel on steel: a low roll and the rail's narrow ring, from one noise loop
  const road = loop();
  const rollFilter = filter('bandpass', 600, 0.6);
  const ringFilter = filter('bandpass', 2150, 9);
  const rollGain = gain(), ringGain = gain();
  road.connect(rollFilter).connect(rollGain).connect(mix);
  road.connect(ringFilter).connect(ringGain).connect(mix);
  // Flange squeal: two inharmonic modes of the wheel, flickering with stick-slip (the wind's gust loop, fast)
  const squealA = oscillator('sine', 4100);
  const squealB = oscillator('sine', 6230);
  const squealGain = gain();
  const squealBGain = gain(0.45);
  squealA.connect(squealGain);
  squealB.connect(squealBGain).connect(squealGain);
  const flicker = loop(resources.gusts);
  flicker.playbackRate.value = 19;
  const flickerDepth = gain();
  flicker.connect(flickerDepth).connect(squealGain.gain);
  squealGain.connect(mix);
  // One-shot rail joint clacks
  const clackGain = gain(1);
  clackGain.connect(mix);

  const whineFrequency = smoothParameter(whine.frequency, 0.08, 0.5, true);
  const octaveFrequency = smoothParameter(whineOctave.frequency, 0.08, 0.5, true);
  const whineLevel = smoothParameter(whineGain.gain, 0.12);
  const octaveLevel = smoothParameter(octaveGain.gain, 0.12);
  const carrierLevel = smoothParameter(carrierGain.gain, 0.15);
  const carrierFrequency = smoothParameter(carrier.frequency, 0.1, 1);
  const gearFrequency = smoothParameter(gear.frequency, 0.08, 0.5, true);
  const gearLevel = smoothParameter(gearGain.gain, 0.15);
  const rollLevel = smoothParameter(rollGain.gain, 0.18);
  const rollFrequency = smoothParameter(rollFilter.frequency, 0.18, 1);
  const ringLevel = smoothParameter(ringGain.gain, 0.18);
  const ringFrequency = smoothParameter(ringFilter.frequency, 0.18, 1);
  const squealLevel = smoothParameter(squealGain.gain, 0.12);
  const flickerLevel = smoothParameter(flickerDepth.gain, 0.12);
  const squealPitch = smoothParameter(squealA.frequency, 0.1, 1);
  const squealPitchB = smoothParameter(squealB.frequency, 0.1, 1);
  const noiseRate = smoothParameter(road.playbackRate, 0.12, 0.001);

  let previousTime = -1, travel = 0, nextJoint = 8;
  const random = randomSource(Math.floor(Math.random() * 1e6));

  function clack(when, level, heavy) {
    const source = context.createBufferSource();
    const envelope = context.createGain();
    source.buffer = toronto.clacks[(heavy ? 2 : 0) + (random() < 0.5 ? 0 : 1)];
    source.playbackRate.value = 0.94 + random() * 0.12;
    envelope.gain.value = level;
    source.connect(envelope).connect(clackGain);
    shots.add(source);
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      shots.delete(source);
    };
    source.start(when);
  }

  function update({ speed = 0, load = 0, curve = 0, doppler = 1, seed = 0 } = {}, now = context.currentTime) {
    if (disposed) return;
    if (seed !== lastSeed) {
      const hash = Math.sin((finite(seed) % 1048576) * 12.9898 + 78.233) * 43758.5453;
      variation = hash - Math.floor(hash);
      lastSeed = seed;
    }
    now = Math.max(context.currentTime, finite(now, context.currentTime));
    speed = Math.min(Math.abs(finite(speed)), 30);
    load = clamp(load, -1, 1);
    doppler = clamp(doppler, 0.5, 2);
    const dt = previousTime < 0 ? 0 : clamp(now - previousTime, 0, 0.5);
    previousTime = now;
    const effort = Math.abs(load);
    const moving = smoothstep(0.3, 2.5, speed);
    const pitch = (0.98 + variation * 0.04) * doppler;
    // The whine climbs with the motors' speed (~1.3 kHz at 13 m/s); braking (regeneration) sings as well as pulling
    const f = (95 + speed * 92) * pitch;
    whineFrequency(f, now);
    octaveFrequency(f * 2 + 6, now);
    // (under the wheels: the whine is there pulling away and braking, but it's the knocking you hear)
    whineLevel((0.004 + 0.018 * effort) * moving, now);
    octaveLevel((0.002 + 0.007 * effort) * moving, now);
    carrierFrequency(1050 * pitch, now);
    carrierLevel(0.012 * effort * (1 - smoothstep(2, 6, speed)) * smoothstep(0.05, 0.5, speed + effort), now);
    gearFrequency(Math.max(20, speed * 21) * pitch, now);
    gearLevel(0.03 * smoothstep(1, 6, speed), now);
    const rolling = Math.min(1.3, speed / 13);
    rollLevel(Math.pow(rolling, 1.3) * 0.32, now);
    rollFrequency((420 + speed * 38) * doppler, now);
    ringLevel(rolling * 0.05, now);
    ringFrequency(2150 * (0.97 + variation * 0.06) * doppler, now);
    // Squeal only in the tight bends, and only rolling: it wavers as the flanges stick and slip
    const squeal = smoothstep(0.25, 0.75, curve) * smoothstep(1, 4, speed);
    const waver = Math.sin(now * 3.1 + variation * 9) * 90 + Math.sin(now * 7.7) * 40;
    squealLevel(squeal * 0.035, now);
    flickerLevel(squeal * 0.08, now);
    squealPitch((4100 + waver) * (0.97 + variation * 0.06) * doppler, now);
    squealPitchB((6230 + waver * 1.5) * (0.97 + variation * 0.06) * doppler, now);
    noiseRate((0.9 + Math.min(1, rolling) * 0.2) * doppler, now);
    // Rail joints, welds & worn spots in the street track every 5-11 m: each truck's two axles go over in turn, the
    // leading one lighter ("ka-dunk"), so a passing car is "ka-dunk ... ka-dunk, kadunka-dunk" as its trucks follow
    if (speed > 1.2 && dt > 0) {
      const before = travel;
      travel += speed * dt;
      if (travel >= nextJoint && shots.size < 40) {
        const level = 0.32 * Math.min(1.25, (speed / 10) ** 0.6) * (0.75 + random() * 0.5);
        const at = now + Math.max(0, (nextJoint - before) / speed);
        JOINT_AXLES.forEach((d, i) => {
          const heavy = i % 2 === 1;
          const jitter = (random() - 0.5) * 0.012;
          clack(at + d / speed + jitter, level * (heavy ? 1 : 0.6) * (0.85 + random() * 0.3), heavy);
        });
      }
      if (travel >= nextJoint) nextJoint = travel + 5 + random() * 6;
    }
  }

  const startTime = context.currentTime;
  mix.gain.setTargetAtTime(1, startTime, 0.05);
  for (const source of sources) {
    if (source.buffer) source.start(startTime, Math.random() * source.buffer.duration);
    else source.start(startTime);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const source of sources) source.stop();
    for (const source of shots) { source.onended = null; source.stop(); source.disconnect(); }
    shots.clear();
    for (const node of nodes) node.disconnect();
    clackGain.disconnect();
  }

  return { update, dispose };
}

// ---------------------------------------------------------------------------------------------------------------------
// The lake: two channels of water at the wall, spread left & right like the wind, each a low lap and a high fizz on
// the breaking crests, both following the swell
// ---------------------------------------------------------------------------------------------------------------------
function createLakeVoice(ctx, resources, output) {
  const toronto = resources.toronto;
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(output);
  const nodes = [master], sources = [], channels = [];
  let disposed = false;
  const biquad = (type, frequency, q) => {
    const node = ctx.createBiquadFilter();
    setControlRate(node.frequency, node.detune, node.Q, node.gain);
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  };
  for (let i = 0; i < 2; i++) {
    const noise = ctx.createBufferSource();
    noise.buffer = resources.noise;
    noise.loop = true;
    const lapFilter = biquad('lowpass', 480, 0.6);
    const lap = ctx.createGain();
    lap.gain.value = 0;
    const fizzFilter = biquad('bandpass', 2600, 0.5);
    const fizz = ctx.createGain();
    fizz.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = i ? 0.65 : -0.65;
    const swell = ctx.createBufferSource();
    swell.buffer = toronto.swell;
    swell.loop = true;
    swell.playbackRate.value = i ? 0.83 : 1;
    const crest = ctx.createBufferSource();
    crest.buffer = toronto.crest;
    crest.loop = true;
    crest.playbackRate.value = swell.playbackRate.value;
    // gain = swell (lap) or crest (fizz) x the level set below
    const lapMod = ctx.createGain(), fizzMod = ctx.createGain();
    lapMod.gain.value = fizzMod.gain.value = 0;
    noise.connect(lapFilter).connect(lap).connect(lapMod).connect(pan);
    noise.connect(fizzFilter).connect(fizz).connect(fizzMod).connect(pan);
    pan.connect(master);
    swell.connect(lapMod.gain);
    crest.connect(fizzMod.gain);
    channels.push({ lap: smoothParameter(lap.gain, 0.8), fizz: smoothParameter(fizz.gain, 0.8) });
    sources.push(noise, swell, crest);
    nodes.push(noise, lapFilter, lap, fizzFilter, fizz, pan, swell, crest, lapMod, fizzMod);
    const offset = i * 0.41 + 0.13;
    noise.start(ctx.currentTime, offset * resources.noise.duration);
    swell.start(ctx.currentTime, offset * toronto.swell.duration);
    crest.start(ctx.currentTime, offset * toronto.crest.duration);
  }
  master.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
  return {
    update({ exposure = 0, altitude = 0, enclosure = 0 } = {}, now = ctx.currentTime) {
      if (disposed) return;
      now = Math.max(ctx.currentTime, finite(now, ctx.currentTime));
      // Strong at the water's edge, gone a street or two inland and high above it
      const near = clamp(exposure) ** 0.8 * Math.exp(-Math.max(0, finite(altitude) - 3) / 70) * (1 - clamp(enclosure) * 0.6);
      for (const channel of channels) {
        channel.lap(near * 0.32, now);
        channel.fizz(near * 0.1, now);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, 0.02);
      for (const source of sources) source.stop(now + 0.08);
      setTimeout(() => { for (const node of nodes) node.disconnect(); }, 200);
    }
  };
}

// How much of the listener's surroundings is lake, 0-1, from three rings of waterAt() probes (25, 60 & 120 m out,
// the nearest weighing most) twice a second; the wet probes are where the gulls call from
const RINGS = [[25, 0.5], [60, 0.3], [120, 0.2]];
class WaterfrontProbe {
  constructor() {
    this.exposure = 0;
    this.points = [];
    this.next = 0;
    this.x = Infinity;
    this.z = Infinity;
  }

  update(listener, now) {
    if (now < this.next && Math.hypot(listener.x - this.x, listener.z - this.z) < 15) return;
    this.next = now + 0.5;
    this.x = listener.x;
    this.z = listener.z;
    let wet = 0;
    this.points.length = 0;
    for (const [r, weight] of RINGS) {
      for (let i = 0; i < 8; i++) {
        const angle = (i + (r === 60 ? 0.5 : 0)) * Math.PI / 4;
        const x = this.x + Math.cos(angle) * r, z = this.z + Math.sin(angle) * r;
        if (!waterAt(x, z)) continue;
        wet += weight / 8;
        this.points.push({ x, z });
      }
    }
    this.exposure = wet;
  }
}

const createTorontoResources = (ctx, resources) => withTorontoEvents({ ...resources, toronto: torontoBuffers(ctx) });

Object.assign(window.CITY, {
  AudioToronto: { torontoBuffers, withTorontoEvents, createTorontoResources, createStreetcarVoice, createLakeVoice, WaterfrontProbe }
});
})();
