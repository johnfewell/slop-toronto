(function () {
// js/quality.js
// Quality tiers, so phones ride smoothly while desktops keep the full look. The tier is chosen before anything is
// built (the other scripts read window.CITY.QUALITY as they load):
// - ?quality=low|medium|high, else from capability probes: the WebGPU adapter explore.html requested before loading
//   the scripts (a GPU without the desktop BC texture formats is a mobile one; its vendor & fallback flag), a coarse
//   primary pointer without hover (a touch screen), the screen's short side, navigator.deviceMemory & the core count.
//   By default only a touch screen on a mobile GPU (a phone or tablet) is detected; everything else is `high`, today's
//   settings exactly. ?quality=auto runs the detection on any device.
// - attach() (main.js, once the city is on screen) starts the safety net: frame times are taken over 2 s windows from
//   5 s after the start, and a tier still running well under 30 fps steps its draw distances (shadows, props) down a
//   rung at a time, and back up when there is headroom; a rung that had to be left again soon after stepping up
//   becomes the ceiling, so it never thrashes. `high` has no net. ?autoscale=0 holds the start rung, ?scale=<0.4-1>
//   sets the render resolution at the start.
// - ?fps=1 shows a readout (fps, frame ms, tier, resolution) for reporting numbers from a phone.

const params = new URLSearchParams(location.search);

// What each tier draws. high is the look as tuned on the M4 mini & John's laptop; the others give up what costs most
// on a phone (the full-screen passes, the multisampled frame, the shadow & prop draw calls) and keep what makes the
// place: the golden light, the sun's shadows near the rider, the clouds, the water & the trees
const TIERS = {
  high: {
    scale: 1, // render resolution, as a share of the CSS pixels (the canvas runs at device pixel ratio 1)
    aa: 'msaa', // 'msaa' (4x), 'fxaa' (one cheap pass after the grade) or 'none'
    ssr: true, // screen-space reflections (half res): also the scene pass's normal & metal/rough targets
    bloom: true,
    clouds: 'medium', // the clouds library's quality preset, or null: the sky dome's painted clouds
    cloudScale: 1, // the clouds' render resolution
    shadowTile: 3072, // sun shadow map per cascade (2 cascades side by side), 2048 where the device allows less
    shadowFar: 1, // x the sun shadow distance (300 m at street level)
    treeNear: 55, treeMid: 320, treeMidShadow: 130, // ez-trees.js: full mesh, decimated mesh & its shadows within (m)
    treeFar: 1, // x the trees' furthest distances (3 km in the parks, 600 m for pines)
    cull: 1, // x the small props' cull distances (scene-culling.js)
    cars: 200, buses: 12, peds: 340, // (12 buses: mostly private cars, mrdoob's a1866b7)
    streetcarSpacing: 500, // streetcars.js: one car per this many metres of track (TTC Flexity Outlooks)
    trains: 1, // rail-corridor.js: x the GO trains on the Union Station Rail Corridor
    subway: 1, // subway.js: x the Line 2 trains (over the Bloor Viaduct, through the west end's open cuts)
    farCity: 1, // surroundings.js: share of the far city's blocks built up
    lightPool: 1, // x the night's street light & headlight spot pools
    signRes: 1, // signage.js: the name boards' lettering resolution (1: 4096 x 4096 atlases)
    // main.js: once the city is on screen, drop the CPU copies of what the GPU already holds (static vertex & index
    // arrays, the name boards' canvases): hundreds of MB the phone needs
    lean: false,
    // the city's sound (audio-system.js): running vehicle voices, sirens & one-shot events at once, HRTF panning (else
    // plain stereo, far cheaper on the audio thread)
    audio: { motors: 8, sirens: 2, events: 8, hrtf: true }
  },
  medium: {
    scale: 1, aa: 'msaa', ssr: false, bloom: true, clouds: 'medium', cloudScale: 0.75,
    shadowTile: 2048, shadowFar: 0.75,
    treeNear: 45, treeMid: 250, treeMidShadow: 90, treeFar: 0.85,
    cull: 0.8, cars: 140, buses: 8, peds: 220, streetcarSpacing: 700, trains: 0.7, subway: 1, farCity: 0.6, lightPool: 0.6,
    signRes: 1, lean: true,
    audio: { motors: 6, sirens: 1, events: 6, hrtf: true }
  },
  low: {
    scale: 1, aa: 'fxaa', ssr: false, bloom: true, clouds: 'low', cloudScale: 0.5,
    shadowTile: 1024, shadowFar: 0.5,
    treeNear: 35, treeMid: 180, treeMidShadow: 50, treeFar: 0.7,
    cull: 0.6, cars: 90, buses: 5, peds: 140, streetcarSpacing: 1000, trains: 0.5, subway: 0.7, farCity: 0.35, lightPool: 0.4,
    signRes: 0.5, lean: true,
    // (measured on the Pixel 8, which is CPU-bound: every shadow caster is drawn again in both cascades) no kerb
    // shadows (~1 ms a frame, unseen at phone size) and an even 30 fps. (Shadows to 100 m instead of 150 m saved under
    // 1 ms in a paired A/B on the phone and lost the far buildings' shadows: not taken)
    kerbShadows: false, maxFps: 30,
    audio: { motors: 4, sirens: 1, events: 5, hrtf: false }
  }
};

function chooseTier() {
  const forced = params.get('quality');
  if (TIERS[forced]) return { tier: forced, reason: '?quality' };
  const adapter = window.CITY.gpuAdapter; // explore.html
  const info = (adapter && adapter.info) || {};
  const gpu = `${info.vendor || ''} ${info.architecture || ''} ${info.description || ''}`.toLowerCase();
  const mm = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
  const touch = navigator.maxTouchPoints > 0 && mm('(pointer: coarse)') && mm('(hover: none)');
  const shortSide = Math.min(screen.width, screen.height);
  const memory = navigator.deviceMemory || 8; // GB, rounded & capped at 8 (Chrome); absent elsewhere
  const cores = navigator.hardwareConcurrency || 8;
  // desktop GPUs all sample the BC formats; phone GPUs (Mali, Adreno, PowerVR, Apple's on iOS) don't
  const mobileGPU = !!adapter && (!adapter.features.has('texture-compression-bc') || /\b(arm|mali|qualcomm|adreno|imagination|powervr|samsung)\b/.test(gpu));
  const software = !!info.isFallbackAdapter || /swiftshader|llvmpipe|software/.test(gpu);
  const why = [touch && 'touch screen', `${shortSide} px screen`, mobileGPU && 'mobile GPU', gpu.trim() || 'no adapter info',
    navigator.deviceMemory && `${memory} GB`, `${cores} cores`].filter(Boolean).join(', ');
  // By default (John, 2026-10-25) only phones & tablets are detected: a touch screen on a mobile GPU gets its tier
  // below; every other device keeps high, today's look exactly (?quality=auto runs the full detection anywhere,
  // ?quality=high forces high)
  if (forced !== 'auto' && !(touch && mobileGPU)) return { tier: 'high', reason: 'default (?quality=auto detects)' };
  if (software) return { tier: 'low', reason: `software GPU (${why})` };
  if ((touch || mobileGPU) && (shortSide <= 600 || memory <= 4)) return { tier: 'low', reason: `phone (${why})` };
  if (touch || mobileGPU) return { tier: 'medium', reason: `tablet (${why})` };
  if (memory <= 4 || cores <= 4) return { tier: 'medium', reason: `small machine (${why})` };
  return { tier: 'high', reason: `desktop (${why})` };
}

const { tier, reason } = chooseTier();
const QUALITY = {
  tier, reason,
  shadows: true, // the sun's shadow cascades
  kerbShadows: true, // city-grid.js: the kerbs cast sun shadows (~400k triangles in the cascades)
  shadowEvery: 1, // main.js: the sun's shadow maps are redrawn every this many frames
  shadowType: 'pcf', // main.js: 'pcf' (filtered) or 'basic' (one tap)
  maxFps: 0, // main.js: frames that come early are skipped (0: every display refresh)
  clusterGrid: [256, 32, 28, 48], // main.js ClusteredLighting: max lights, screen tile px, depth slices, lights per cluster
  ...TIERS[tier], dist: 1
};
// Profiling knobs: ?q.<key>=<value> overrides one of the tier's settings (numbers, true/false, else the string), e.g.
// ?q.bloom=false&q.shadows=false, so each setting's cost can be measured on its own (nothing sets them by default)
for (const [k, v] of params) {
  if (!k.startsWith('q.') || !(k.slice(2) in QUALITY)) continue;
  const key = k.slice(2);
  QUALITY[key] = Array.isArray(QUALITY[key]) ? v.split(',').map(Number) // e.g. ?q.clusterGrid=128,64,16,24
    : v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) ? Number(v) : v;
}
const forcedScale = parseFloat(params.get('scale'));
if (forcedScale >= 0.25 && forcedScale <= 2) QUALITY.scale = forcedScale;
console.info(`[quality] ${tier}: ${reason}`);

// The safety net's rungs: [resolution x, draw distance x]. Only distances: a resolution change reallocates every
// full-screen target at once (the scene pass, the clouds, the water's frame copy), which crashed the Pixel 8's GPU
// process a few seconds in, and a phone already renders at its CSS pixels (412 x 915 on the Pixel). high has no net
const RUNGS = tier === 'high'
  ? [[1, 1]]
  : [[1, 1], [1, 0.8], [1, 0.65], [1, 0.5]];
const SLOW_MS = tier === 'high' ? 50 : 36; // a window's median frame slower than this (~20 / ~28 fps) is too slow...
const SLOW_WINDOWS = 2; // ...this many windows in a row: a rung down
const FAST_MS = 22; // ~45 fps: room to step back up...
const FAST_WINDOWS = 5; // ...after this many windows in a row (10 s)
const WINDOW_S = 2;
const SETTLE_S = 5; // ignored after the start (the first frames still compile & stream)

function attach(app) {
  const { renderer } = app;
  const baseScale = QUALITY.scale;
  let rung = 0;
  let best = 0; // the best rung the net may step back up to
  let lastUpAt = -Infinity, clock = 0, slow = 0, fast = 0, windowStart = SETTLE_S, holdUntil = SETTLE_S;
  const frames = [];
  const auto = params.get('autoscale') !== '0' && !(forcedScale > 0);

  function apply(r) {
    rung = r;
    const [s, d] = RUNGS[r];
    QUALITY.scale = baseScale * s;
    QUALITY.dist = d;
    if (s !== 1) {
      renderer.setPixelRatio(QUALITY.scale);
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    console.info(`[quality] rung ${r}: resolution x${QUALITY.scale.toFixed(2)}, distances x${d}`);
  }

  // ?fps=1: the readout, refreshed twice a second
  let readout = null, readFrames = 0, readTime = 0;
  if (params.get('fps') === '1') {
    readout = document.createElement('div');
    readout.id = 'quality-readout';
    readout.style.cssText = 'position:fixed;left:8px;top:42%;z-index:10000;pointer-events:none;padding:4px 8px;' +
      'border-radius:6px;background:rgba(0,0,0,.6);color:#fff;font:600 12px/1.35 ui-monospace,Menlo,monospace;white-space:pre';
    document.body.appendChild(readout);
  }

  // Per frame from main.js with the frame's wall-clock time (s)
  function tick(dt) {
    if (readout) {
      readFrames++;
      readTime += dt;
      if (readTime >= 0.5) {
        const c = renderer.domElement;
        const info = renderer.info.render;
        readout.textContent = `${Math.round(readFrames / readTime)} fps  ${((readTime / readFrames) * 1000).toFixed(1)} ms\n` +
          `${tier}${auto ? ` rung ${rung}` : ''}  ${c.width}x${c.height} (x${QUALITY.scale.toFixed(2)})\n` +
          `${info.drawCalls} draws  ${(info.triangles / 1e6).toFixed(2)}M tris`;
        readFrames = 0;
        readTime = 0;
      }
    }
    if (!auto || document.hidden || (app.film && app.film.active)) return;
    clock += dt;
    if (clock < holdUntil || dt > 0.25) return; // a hitch or a background tab says nothing about the steady frame rate
    frames.push(dt * 1000);
    if (clock - windowStart < WINDOW_S) return;
    windowStart = clock;
    frames.sort((a, b) => a - b);
    const median = frames[frames.length >> 1];
    frames.length = 0;
    slow = median > SLOW_MS ? slow + 1 : 0;
    // (held at maxFps, a window that keeps up with the cap is as good as it gets: room to step back up)
    fast = median < (QUALITY.maxFps ? Math.max(FAST_MS, 1000 / QUALITY.maxFps + 2) : FAST_MS) ? fast + 1 : 0;
    let next = rung;
    if (slow >= SLOW_WINDOWS && rung < RUNGS.length - 1) {
      // stepping down again soon after stepping up: the rung being left can't hold, it stays out of reach
      if (clock - lastUpAt < 15) best = rung + 1;
      next = rung + 1;
    } else if (fast >= FAST_WINDOWS && rung > best) {
      next = rung - 1;
      lastUpAt = clock;
    }
    if (next === rung) return;
    apply(next);
    slow = fast = 0;
    holdUntil = windowStart = clock + 1; // the resize's own frames don't count
  }
  return { tick };
}

QUALITY.attach = attach;
window.CITY.QUALITY = QUALITY;
})();
