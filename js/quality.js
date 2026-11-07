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
//   becomes the ceiling, so it never thrashes. `high` steps its render resolution instead (x0.75 while frames run
//   long, see RUNGS). ?autoscale=0 holds the start rung, ?scale=<0.4-1> sets the render resolution at the start.
// - ?fps=1 shows a readout (fps, frame ms, the share of frames over 16.7 ms, the resolution step, tier, resolution) for
//   reporting numbers from a phone, or headroom on a desktop under vsync.

const params = new URLSearchParams(location.search);

// What each tier draws. high is the look as tuned on the M4 mini & John's laptop; the others give up what costs most
// on a phone (the full-screen passes, the multisampled frame, the shadow & prop draw calls) and keep what makes the
// place: the golden light, the sun's shadows near the rider, the clouds, the water & the trees
const TIERS = {
  high: {
    scale: 1, // render resolution, as a share of the CSS pixels (the canvas runs at device pixel ratio 1)
    // 'msaa' (4x), 'smaa' (three passes after the grade), 'fxaa' (one cheap pass after the grade) or 'none'. SMAA on
    // desktops: MSAA 4x was the dearest full-screen setting on the M4 mini (Skyline view 20.3 -> 16.7 ms without it),
    // and SMAA keeps the overhead wires and the CN Tower's lit edge that FXAA smears (docs/perf-pass-coo.md)
    aa: 'smaa',
    ssr: true, // screen-space reflections (half res): also the scene pass's normal & metal/rough targets
    bloom: true,
    clouds: 'medium', // the clouds library's quality preset, or null: the sky dome's painted clouds
    // the clouds' render resolution: 0.75 (the medium tier's) since st-z51b. On the M4 mini it saves 0.4-0.8 ms where
    // the sky is in view (Skyline 20.0 -> 19.2 ms); 0.5 saved only 0.2-0.3 ms more and visibly softened the cumulus
    cloudScale: 0.75,
    shadowTile: 3072, // sun shadow map per cascade (2 cascades side by side), 2048 where the device allows less
    shadowFar: 1, // x the sun shadow distance (300 m at street level)
    // ez-trees.js: full mesh, decimated mesh (from street level: treeMidStreet) & its shadows within (m)
    treeNear: 55, treeMid: 320, treeMidStreet: 180, treeMidShadow: 65,
    // ez-trees.js: the High Park pilot's woods trees hand over from the mid mesh to their baked impostor here (m;
    // tree-impostors.js, docs/park-cover.md)
    treeImpMid: 45,
    treeFar: 1, // x the trees' furthest distances (3 km in the parks, 600 m for pines)
    // buildings.js ?massing=1 (js/massing-cells.js): a 500 m cell draws its buildings' full outlines within the first
    // distance (m, x dist), simplified ones within the second, their boxes beyond
    massingLimits: [600, 1600],
    cull: 1, // x the small props' cull distances (scene-culling.js)
    cars: 200, buses: 12, peds: 340, // (12 buses: mostly private cars, mrdoob's a1866b7)
    // parked-cars.js: the cars parked at the curbs (at most; data/toronto-geodata.bin holds ~10.8k), the full model
    // within parkedNear m (casting shadows if parkedShadows), the ~250-triangle stand-in out to parkedFar m (x Q.dist)
    parkedCars: 12000, parkedNear: 70, parkedFar: 260, parkedShadows: true,
    streetcarSpacing: 500, // streetcars.js: one car per this many metres of track (TTC Flexity Outlooks)
    trains: 1, // rail-corridor.js: x the GO trains on the Union Station Rail Corridor
    subway: 1, // subway.js: x the Line 2 trains (over the Bloor Viaduct, through the west end's open cuts)
    farCity: 1, // surroundings.js: share of the far city's blocks built up
    lightPool: 1, // x the night's street light & headlight spot pools
    signRes: 1, // storefront-signs.js: the storefront signs' lettering atlas resolution (1: full; under 1: half)
    // tsl-materials.js: wear on the asphalt & sidewalks. 2: everything (utility-cut patches, potholes, tar snakes,
    // cracks, oil drips; heaved, replaced, cracked & salt-scaled panels, gum); 1: the patches, potholes & panel wear
    // only (no Voronoi crack networks, gum or scaling); 0: plain asphalt & panels (the shaders before the port)
    surfaceWear: 2,
    // tsl-materials.js: the generated storefronts' interiors. 2: parallax shop interiors behind the glass (shelves, stock,
    // a counter, lamps); 1: a flat lit interior (glazing, doors & fascia unchanged)
    storefronts: 2,
    // street-details.js: the overhead lines strung between the wooden hydro poles (thin, many and only seen close up;
    // the poles' crossarms, insulators & transformers stay on every tier)
    poleWires: true,
    // streetcars.js: the span wires from the streetcar streets' poles to the contact wire (thin lines drawn with the
    // contact wire, in its draws: every tier)
    tramSpans: true,
    // main.js: once the city is on screen, drop the CPU copies of what the GPU already holds (static vertex & index
    // arrays, the sign atlases' pixels): hundreds of MB the phone needs
    lean: false,
    // the city's sound (audio-system.js): running vehicle voices, sirens & one-shot events at once, HRTF panning (else
    // plain stereo, far cheaper on the audio thread)
    audio: { motors: 8, sirens: 2, events: 8, hrtf: true }
  },
  medium: {
    scale: 1, aa: 'msaa', ssr: false, bloom: true, clouds: 'medium', cloudScale: 0.75,
    shadowTile: 2048, shadowFar: 0.75,
    treeNear: 45, treeMid: 250, treeMidShadow: 90, treeFar: 0.85, treeImpMid: 40, massingLimits: [450, 1300],
    cull: 0.8, cars: 140, buses: 8, peds: 220, streetcarSpacing: 700, trains: 0.7, subway: 1, farCity: 0.6, lightPool: 0.6,
    parkedCars: 7000, parkedNear: 50, parkedFar: 200, parkedShadows: true,
    signRes: 1, lean: true, surfaceWear: 1, storefronts: 2, poleWires: false, tramSpans: true,
    audio: { motors: 6, sirens: 1, events: 6, hrtf: true }
  },
  low: {
    scale: 1, aa: 'fxaa', ssr: false, bloom: true, clouds: 'low', cloudScale: 0.5,
    shadowTile: 1024, shadowFar: 0.5,
    treeNear: 35, treeMid: 180, treeMidShadow: 50, treeFar: 0.7, treeImpMid: 35,
    massingLimits: [300, 1000], // (the full outlines only close by on a phone)
    cull: 0.6, cars: 90, buses: 5, peds: 140, streetcarSpacing: 1000, trains: 0.5, subway: 0.7, farCity: 0.35, lightPool: 0.4,
    // (parked cars: about half, the full model only close by and no shadows from them)
    parkedCars: 5000, parkedNear: 30, parkedFar: 140, parkedShadows: false,
    signRes: 0.5, lean: true, surfaceWear: 1, storefronts: 1, poleWires: false, tramSpans: true,
    // (measured on the Pixel 8, which is CPU-bound: every shadow caster is drawn again in both cascades) no kerb
    // shadows (~1 ms a frame, unseen at phone size) and an even 30 fps. (Shadows to 100 m instead of 150 m saved under
    // 1 ms in a paired A/B on the phone and lost the far buildings' shadows: not taken)
    kerbShadows: false, maxFps: 30,
    // the static batches' frustum cells (the building massing, the far city) twice as wide: from the waterfront the
    // view looks across the whole city, and every cell is a draw (scene-culling.js, surroundings.js)
    staticCell: 2,
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
  staticCell: 1, // x the static batches' frustum cells (scene-culling.js STATIC_CELL, surroundings.js's far city)
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

// The safety net's rungs: [resolution x, draw distance x]. The phone tiers' are distances only: a resolution change
// reallocates every full-screen target at once (the scene pass, the clouds, the water's frame copy), which crashed the
// Pixel 8's GPU process a few seconds in, and a phone already renders at its CSS pixels (412 x 915 on the Pixel).
// Desktop high has one resolution rung: on the M4 mini the frame is GPU-bound and scales with pixels (x0.75 took every
// measured city view from 18-20 ms to a steady 16.7 ms, the Trinity Bellwoods side of Queen St from 26 to 23 ms;
// docs/perf-pass-coo.md), and its draw distances stay
const HIGH = tier === 'high';
const RUNGS = HIGH
  ? [[1, 1], [0.75, 1]]
  : [[1, 1], [1, 0.8], [1, 0.65], [1, 0.5]];
const AUTO = params.get('autoscale') !== '0' && !(forcedScale > 0); // (the net runs: attach below)
// The shortest draw distance scale QUALITY.dist can reach (the net's last rung, or a ?q.dist override below it):
// scene-culling.js's one-off shadow stand-in choice must hold at every rung
QUALITY.minDist = Math.min(QUALITY.dist, ...(AUTO ? RUNGS.map(([, d]) => d) : []));
const SLOW_MS = 36; // a window's median frame slower than this (~28 fps) is too slow...
const SLOW_WINDOWS = 2; // ...this many windows in a row: a rung down
const FAST_MS = 22; // ~45 fps: room to step back up...
const FAST_WINDOWS = 5; // ...after this many windows in a row (10 s)
// high judges a window by its MEAN frame: paced by vsync, a frame just over 16.7 ms costs a whole second vsync, so the
// median sits at 16.7 ms until half the frames miss. Over 20 ms (about a fifth of the frames late at 60 Hz) is slow,
// under 17.5 ms (a steady 60, or any faster display) has room to step back up
const HIGH_SLOW_MS = 20, HIGH_FAST_MS = 17.5;
// high's ceiling (a rung left again within 15 s of stepping up to it) lasts this long, then it may try again: the
// next street may be lighter. (The phone tiers keep theirs for the session)
const HIGH_RETRY_S = 60;
const WINDOW_S = 2;
const SETTLE_S = 5; // ignored after the start (the first frames still compile & stream)

function attach(app) {
  const { renderer } = app;
  const baseScale = QUALITY.scale;
  let rung = 0;
  let best = 0; // the best rung the net may step back up to
  let lastUpAt = -Infinity, clock = 0, slow = 0, fast = 0, windowStart = SETTLE_S, holdUntil = SETTLE_S, ceilingUntil = Infinity;
  const frames = [];
  const auto = AUTO;

  let changes = 0;
  function apply(r) {
    rung = r;
    changes++;
    const [s, d] = RUNGS[r];
    const before = QUALITY.scale;
    QUALITY.scale = baseScale * s;
    QUALITY.dist = d;
    if (QUALITY.scale !== before) { // (back up to x1 too)
      renderer.setPixelRatio(QUALITY.scale);
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    console.info(`[quality] rung ${r}: resolution x${QUALITY.scale.toFixed(2)}, distances x${d}`);
  }

  // ?fps=1: the readout, refreshed twice a second. `late` is the share of the last 5 s of frames that took over 16.7 ms
  // (a 60 Hz frame), so the headroom shows under vsync too: paced at 60 Hz a frame that misses is 33 ms, one that fits is
  // 16.7 (1 ms of slack for the pacing's jitter). `step` is desktop high's resolution step (the safety net's rung)
  let readout = null, readFrames = 0, readTime = 0, readLate = 0;
  const LATE_MS = 1000 / 60 + 1, LATE_BINS = 10; // (10 refreshes of 0.5 s)
  const lateBins = []; // [frames, late] per refresh
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
      if (dt * 1000 > LATE_MS) readLate++;
      if (readTime >= 0.5) {
        const c = renderer.domElement;
        const info = renderer.info.render;
        lateBins.push([readFrames, readLate]);
        if (lateBins.length > LATE_BINS) lateBins.shift();
        let n = 0, late = 0;
        for (const [f, l] of lateBins) { n += f; late += l; }
        const step = HIGH ? `  step x${RUNGS[rung][0].toFixed(2)}${auto ? '' : ' held'}` : '';
        readout.textContent = `${Math.round(readFrames / readTime)} fps  ${((readTime / readFrames) * 1000).toFixed(1)} ms\n` +
          `late ${Math.round((100 * late) / n)}% (>16.7 ms, ${Math.round(lateBins.length * 0.5)} s)${step}\n` +
          `${tier}${auto ? ` rung ${rung}` : ''}  ${c.width}x${c.height} (x${QUALITY.scale.toFixed(2)})\n` +
          `${info.drawCalls} draws  ${(info.triangles / 1e6).toFixed(2)}M tris`;
        readFrames = 0;
        readTime = 0;
        readLate = 0;
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
    const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
    frames.length = 0;
    if (HIGH) {
      slow = mean > HIGH_SLOW_MS ? slow + 1 : 0;
      fast = mean < HIGH_FAST_MS ? fast + 1 : 0;
      if (clock > ceilingUntil) { best = 0; ceilingUntil = Infinity; }
    } else {
      slow = median > SLOW_MS ? slow + 1 : 0;
      // (held at maxFps, a window that keeps up with the cap is as good as it gets: room to step back up)
      fast = median < (QUALITY.maxFps ? Math.max(FAST_MS, 1000 / QUALITY.maxFps + 2) : FAST_MS) ? fast + 1 : 0;
    }
    let next = rung;
    if (slow >= SLOW_WINDOWS && rung < RUNGS.length - 1) {
      // stepping down again soon after stepping up: the rung being left can't hold, it stays out of reach
      if (clock - lastUpAt < 15) {
        best = rung + 1;
        if (HIGH) ceilingUntil = clock + HIGH_RETRY_S;
      }
      next = rung + 1;
    } else if (fast >= FAST_WINDOWS && rung > best) {
      next = rung - 1;
      lastUpAt = clock;
    }
    if (next === rung) return;
    apply(next);
    slow = fast = 0;
    // the resize's own frames don't count: on high, the reallocated targets (the scene pass, SMAA's, the clouds' history)
    // run slow for ~3 s after a resolution change (M4 mini: 22-25 ms at King & Bay, against 16.7 ms steady), which
    // would otherwise read as a slow window and step straight back down
    holdUntil = windowStart = clock + (HIGH ? 4 : 1);
  }
  // (for captures and tests: the rung, the ceiling, and how many times the net has stepped)
  return { tick, state: () => ({ rung, best, scale: QUALITY.scale, changes, ceilingUntil }) };
}

QUALITY.attach = attach;
window.CITY.QUALITY = QUALITY;
})();
