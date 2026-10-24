(function () {
// js/main.js
// Main entry point for Abuja, Nigeria's Federal Capital, in Three.js WebGPURenderer & TSL (three.js dev, see index.html)

const { THREE } = window.CITY;
const {
  pass,
  mrt,
  output,
  normalView,
  positionView,
  metalness,
  roughness,
  vec2,
  smoothstep,
  renderOutput
} = window.CITY.TSL;
const { ssr, fxaa } = window.CITY.PostFX;
// The quality tier, chosen before anything was built (quality.js): desktops draw everything, phones less
const QUALITY = window.CITY.QUALITY;
const { createPostProcessing } = window.CITY;
const { ClusteredLighting } = window.CITY.Addons;

const { getLocationLabel, isTypingInField } = window.CITY;
const { buildCityGrid } = window.CITY;
const { buildTerrain } = window.CITY;
const { buildLandmarks } = window.CITY;
const { buildCityBlocks } = window.CITY;
const { buildStreetDetails } = window.CITY;
const { buildSignage } = window.CITY;
const { createTourGuide } = window.CITY;
const { createTrafficSystem, createHighwayTraffic } = window.CITY;
const { buildRoadPaint } = window.CITY;
const { ThirdPersonControllerManager } = window.CITY;
const { TouchControls } = window.CITY;
const { CameraSystem, CAMERA_PRESETS } = window.CITY;
const { LightingSystem } = window.CITY;
const { CityMapSystem } = window.CITY;
const { setupSceneCulling, updateSceneCulling } = window.CITY;

async function initApp() {
  const container = document.getElementById('canvas-container');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  const loadingTrack = loadingOverlay ? loadingOverlay.querySelector('.loader-track') : null;
  const loadingFill = document.getElementById('loading-progress');
  // The loading bar sweeps while the city is being built (the main thread is busy) and fills as the shaders compile
  const setLoadingProgress = (p) => {
    if (!loadingFill) return;
    if (loadingTrack) loadingTrack.classList.remove('is-indeterminate');
    loadingFill.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
  };

  if (loadingStatus) {
    loadingStatus.textContent = `Initializing Three.js r${THREE.REVISION} WebGPURenderer & TSL Shaders...`;
  }

  // 1. Initialize Three.js WebGPURenderer with 32-bit float reversedDepthBuffer. MSAA & the render resolution (a share
  //    of the CSS pixels) by quality tier (quality.js)
  const renderer = new THREE.WebGPURenderer({
    antialias: QUALITY.aa === 'msaa',
    powerPreference: 'high-performance',
    reversedDepthBuffer: true
  });
  renderer.setPixelRatio(QUALITY.scale);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  if (ClusteredLighting && !new URLSearchParams(location.search).has('nocl')) {
    renderer.lighting = new ClusteredLighting(256, 32, 28, 48);
  }
  container.appendChild(renderer.domElement);

  // Start-up phase timings (logged once as "[init] ...") to keep load-time regressions traceable
  let initTimings = [];
  let initMark = performance.now();
  const markInit = (label) => {
    const now = performance.now();
    initTimings.push(`${label} ${Math.round(now - initMark)}ms`);
    initMark = now;
  };

  await renderer.init();
  markInit('renderer');
  // The clouds' atmosphere & clouds contexts go on the renderer before anything renders (sky-clouds.js)
  const skyClouds = await window.CITY.setupClouds(renderer);

  // 2. Build Scene & Physical Atmospheric Sky / PMREM IBL / 4096x4096 Shadow Lighting
  const scene = new THREE.Scene();
  const lightingSystem = new LightingSystem(scene, renderer);
  markInit('lighting');

  if (loadingStatus) {
    loadingStatus.textContent = 'Building Toronto: Streets, Landmarks, the CN Tower & the Waterfront...';
  }

  // 3. Build Abuja's Ground & Terrain, Landmarks, Buildings, Street Details & Traffic
  const cityGrid = buildCityGrid(scene);
  // Lake Ontario in John's stylized water (lake-water.js)
  const lakeWater = window.CITY.setupLakeWater(scene, renderer, lightingSystem);
  markInit('cityGrid');
  const boroughs = buildTerrain(scene);
  markInit('terrain');
  const { colliders: landmarkColliders } = buildLandmarks(scene);
  markInit('landmarks');
  const cityBlocks = buildCityBlocks(scene);
  markInit('blocks');
  buildSignage(scene);
  markInit('signage');
  const allColliders = [...landmarkColliders, ...cityBlocks.colliders, ...boroughs.colliders, ...(cityGrid.colliders || [])];

  const streetDetails = buildStreetDetails(scene);
  markInit('streetDetails');
  // Trees: the City's street trees & the parkland ones in John's EZ-Tree models (ez-trees.js), else mrdoob's
  const treeMode = new URLSearchParams(location.search).get('trees'); // ?trees=slop: mrdoob's trees (comparison)
  if (treeMode === 'slop' || !(await window.CITY.buildEzTrees(scene, streetDetails.treePositions))) streetDetails.addFallbackTrees();
  markInit('trees');
  // John's hydrants, bike rings & post boxes where the City says they stand (street-props.js)
  await window.CITY.buildStreetProps(scene);
  // Yonge & Dundas: the screens round Sankofa Square (yonge-dundas.js)
  window.CITY.buildYongeDundas(scene);
  markInit('streetProps');
  // Buildings turned along non-grid streets have oriented colliders whose world bounds reach past their lots: they stay
  // inside the property line anyway, so the road network (lanes & sidewalks) doesn't need them
  const trafficSystem = createTrafficSystem(scene, cityGrid.sidewalks, [
    ...cityGrid.footprints,
    ...streetDetails.footprints,
    ...allColliders.filter((c) => !c.obb)
  ]);
  markInit('traffic');
  const highwayTraffic = createHighwayTraffic(scene, cityGrid.highwayLanes);
  buildRoadPaint(scene, trafficSystem.network);
  markInit('roadPaint');

  // 4. Initialize Third-Person Controllers (Person, Car, Cyclist, Helicopter) & Multi-Camera System
  const controllerManager = new ThirdPersonControllerManager(scene, allColliders);
  const cameraSystem = new CameraSystem(renderer.domElement, controllerManager);
  const touchControls = new TouchControls(controllerManager);
  markInit('controllers');

  // City-wide static geometry: chunk & distance-cull the small props, shadow stand-ins for the big casters
  // (scene-culling.js)
  const cullingRoots = ['CityGround', 'CityBuildings', 'CityStreetDetails', 'CityStreetProps', 'CityLandmarks', 'Terrain']
    .map((name) => scene.getObjectByName(name))
    .filter(Boolean);
  const cullingStats = setupSceneCulling(scene, cullingRoots, lightingSystem.sunLight.shadow);
  // The static city's ~9,000 objects never move: the per-frame matrix pass skips them (it was 2.6 ms of every frame).
  // Only its lights move (the street lights' spot pool follows the rider): the frame loop updates those itself
  const staticLights = [];
  for (const root of cullingRoots) {
    root.updateMatrixWorld(true);
    root.updateMatrixWorld = () => {}; // (three r187 walks every descendant even with the auto-update flags off)
    root.traverse((o) => { if (o.isLight) staticLights.push(o); });
  }
  markInit('culling');

  // Small InstancedMeshes (<= 1000 instances) keep their matrices in uniform buffers that three.js
  // re-uploads on every draw of every pass (~2.5 MB/frame with the shadow cascades, stalling the GPU queue).
  // Storage attributes are only uploaded when instanceMatrix.needsUpdate is set.
  scene.traverse((object) => {
    if (object.isInstancedMesh) {
      object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(object.instanceMatrix.array, 16);
    }
  });

  // 5. TSL RenderPipeline with Half-Res Screen Space Reflections (SSRNode), Bloom & Filmic Toning
  //    SSR skips pixels with zero metalness, so fading it out with distance spares the far facades
  const scenePass = pass(scene, cameraSystem.camera);
  // The multisampled colour attachments (output, normal, metalRough) only need resolving, never storing: discarding
  // them spares the GPU writing 3 x 4 samples per pixel to memory every frame (transient, memoryless attachments where
  // the browser supports them). The multisampled depth stays stored: SSR reads it.
  // Toronto: John's stylized lake water copies the frame mid-pass (its depth & refraction), so the colour attachments
  // must be stored for the pass to carry on after the copy
  scenePass.renderTarget.storeMultisampledColorBuffer = !!lakeWater.water;
  // The phone tiers draw no SSR, so the scene pass writes its colour & depth alone (quality.js)
  const ssrFade = smoothstep(360.0, 180.0, positionView.z.negate());
  const sceneMRT = QUALITY.ssr ? mrt({
    output: output,
    normal: normalView,
    metalRough: vec2(metalness.mul(ssrFade), roughness)
  }) : null;
  if (sceneMRT) {
    sceneMRT.setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending));
    sceneMRT.setBlendMode('metalRough', new THREE.BlendMode(THREE.MaterialBlending));
    scenePass.setMRT(sceneMRT);
  } else {
    // the decals' & effects' own normal / metalRough outputs (tsl-materials.js) only feed SSR: without the targets
    // they would leave their shaders with no output at all
    scene.traverse((o) => {
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) m.mrtNode = null;
    });
  }

  const scenePassColor = scenePass.getTextureNode('output');
  const scenePassDepth = scenePass.getTextureNode('depth');

  let ssrPass = null;
  if (QUALITY.ssr) {
    const scenePassNormal = scenePass.getTextureNode('normal');
    const scenePassMetalRough = scenePass.getTextureNode('metalRough');
    ssrPass = ssr(scenePassColor, scenePassDepth, scenePassNormal, {
      metalnessNode: scenePassMetalRough.r,
      roughnessNode: scenePassMetalRough.g,
      camera: cameraSystem.camera
    });
    ssrPass.resolutionScale = 0.5;
    ssrPass.blurQuality = 1;
    ssrPass.maxDistance.value = 42;
    ssrPass.thickness.value = 0.85;
    ssrPass.quality.value = 0.35;
    ssrPass.intensity.value = 0.50;
    ssrPass.screenEdgeFadeBlack = true;
  }

  // John's volumetric clouds (sky-clouds.js): marched through the scene depth, composited over the scene colour
  if (skyClouds) {
    skyClouds.attach(cameraSystem.camera, lightingSystem);
    skyClouds.pass.sceneDepth = scenePassDepth;
  }
  const colorGrade = createPostProcessing(renderer, skyClouds ? skyClouds.composite(scenePassColor) : scenePassColor, ssrPass, {
    bloom: QUALITY.bloom
  });
  const { bloomPass } = colorGrade;
  // FXAA instead of MSAA (the low tier): it smooths the tone-mapped sRGB image, so the pipeline's own output transform
  // moves ahead of it
  const renderPipeline = new THREE.RenderPipeline(
    renderer,
    QUALITY.aa === 'fxaa' ? fxaa(renderOutput(colorGrade.outputNode)) : colorGrade.outputNode
  );
  if (QUALITY.aa === 'fxaa') renderPipeline.outputColorTransform = false;

  // 6. Wire UI Controls (Strictly using safe DOM APIs: textContent, classList, addEventListener)
  const modeButtons = document.querySelectorAll('[data-mode]');
  const cameraButtons = document.querySelectorAll('[data-camera]');
  const timeButtons = document.querySelectorAll('[data-time]');
  const teleportButtons = document.querySelectorAll('[data-teleport]');
  const hudToggleBtn = document.getElementById('btn-toggle-hud');
  const modeSwitch = document.getElementById('mode-switch');
  touchControls.onAvailabilityChange = placeModeIndicator;

  const elFps = document.getElementById('hud-fps');
  const elMode = document.getElementById('hud-active-mode');
  const elCamera = document.getElementById('hud-active-camera');
  const elSpeed = document.getElementById('hud-speed');
  const elSpeedMeter = document.getElementById('hud-speed-meter');
  const elAltitude = document.getElementById('hud-altitude');
  const elLocation = document.getElementById('hud-location');
  const elControlsHint = document.getElementById('hud-controls-hint');

  // Keyboard guide for each mode: [keys, action]
  const controlHints = {
    person: [[['W', 'S'], 'Walk'], [['A', 'D'], 'Turn'], [['Shift'], 'Sprint'], [['Space'], 'Jump'], [['Drag'], 'Orbit']],
    car: [[['W', 'S'], 'Drive / Reverse'], [['A', 'D'], 'Steer'], [['Shift'], 'Boost'], [['Drag'], 'Orbit']],
    cyclist: [[['W', 'S'], 'Pedal / Brake'], [['A', 'D'], 'Lean & Turn'], [['Shift'], 'Sprint'], [['Drag'], 'Orbit']],
    helicopter: [[['W', 'S'], 'Pitch'], [['A', 'D'], 'Yaw'], [['Space', 'E'], 'Ascend'], [['Q', 'C'], 'Descend'], [['Shift'], 'Boost']]
  };
  // Boosted top speeds in km/h (controllers.js caps them at 8.2, 36, 19 & 52 m/s): full scale of the speed meter
  const topSpeedKmh = { person: 30, car: 130, cyclist: 68, helicopter: 187 };

  function renderControlHints(mode) {
    if (!elControlsHint) return;
    const items = (controlHints[mode] || []).map(([keys, action]) => {
      const item = document.createElement('span');
      item.className = 'hint';
      for (const key of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        item.appendChild(kbd);
      }
      const label = document.createElement('span');
      label.className = 'hint-label';
      label.textContent = action;
      item.appendChild(label);
      return item;
    });
    elControlsHint.replaceChildren(...items);
  }

  // The green pill under the selected mode glides from button to button
  function placeModeIndicator() {
    const active = modeSwitch ? modeSwitch.querySelector('.mode-btn.active') : null;
    if (!active) return;
    modeSwitch.style.setProperty('--ind-x', `${active.offsetLeft}px`);
    modeSwitch.style.setProperty('--ind-w', `${active.offsetWidth}px`);
  }

  function selectMode(mode) {
    controllerManager.setMode(mode);
    touchControls.setMode(controllerManager.activeMode);
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    document.body.dataset.mode = mode;
    placeModeIndicator();
    const ent = controllerManager.getActiveEntity();
    if (elMode) elMode.textContent = ent.label;
    renderControlHints(mode);

    // If currently on a static scenic camera, switch to 3rd-Person Chase so user sees their selected character/vehicle
    const currentCam = cameraSystem.getActivePreset();
    if (currentCam.category !== 'follow') {
      selectCamera('chase', false);
    }
  }

  function selectCamera(camId, snap = false) {
    cameraSystem.setCameraPreset(camId, snap);
    cameraButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-camera') === camId);
    });
    const preset = cameraSystem.getActivePreset();
    if (elCamera) elCamera.textContent = preset.name;
  }

  // Steps through CAMERA_PRESETS (V / Shift+V, and the arrows either side of the camera name)
  function cycleCamera(step) {
    const n = CAMERA_PRESETS.length;
    const idx = CAMERA_PRESETS.findIndex((p) => p.id === cameraSystem.activePresetId);
    selectCamera(CAMERA_PRESETS[(idx + step + n) % n].id, true);
  }

  function selectTime(timeId) {
    lightingSystem.applyPreset(timeId);
    colorGrade.applyPreset(lightingSystem.activePresetId);
    timeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-time') === timeId);
    });
  }

  // Popovers (native [popover]: light dismiss & Esc for free) open against the control that toggles them: data-anchor
  // names the element they sit above / below, data-align the one whose right edge they line up with
  const popovers = document.querySelectorAll('.popover[popover]');
  const supportsPopover = typeof HTMLElement.prototype.togglePopover === 'function';
  function closePopovers() {
    if (!supportsPopover) return;
    popovers.forEach((pop) => {
      if (pop.matches(':popover-open')) pop.hidePopover();
    });
  }
  popovers.forEach((pop) => {
    const invoker = document.querySelector(`[popovertarget="${pop.id}"]`);
    pop.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      if (invoker) invoker.classList.toggle('is-open', open);
      if (!open) return;
      const anchor = document.getElementById(pop.dataset.anchor) || invoker;
      const align = document.getElementById(pop.dataset.align) || invoker;
      if (!anchor || !align) return;
      const r = anchor.getBoundingClientRect();
      const spaceAbove = Math.max(0, r.top - 20);
      const spaceBelow = Math.max(0, window.innerHeight - r.bottom - 20);
      let above = pop.dataset.side === 'above';
      // The camera control moves to the top on touch screens; open toward the available space.
      if ((above ? spaceAbove : spaceBelow) < 160) above = spaceAbove > spaceBelow;
      pop.style.right = `${Math.max(8, window.innerWidth - align.getBoundingClientRect().right)}px`;
      if (above) {
        pop.style.top = 'auto';
        pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
        pop.style.maxHeight = `${spaceAbove}px`;
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = `${r.bottom + 8}px`;
        pop.style.maxHeight = `${spaceBelow}px`;
      }
    });
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectMode(btn.getAttribute('data-mode'));
    });
  });

  cameraButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectCamera(btn.getAttribute('data-camera'), true);
      closePopovers();
    });
  });

  const camPrevBtn = document.getElementById('cam-prev');
  const camNextBtn = document.getElementById('cam-next');
  if (camPrevBtn) camPrevBtn.addEventListener('click', () => cycleCamera(-1));
  if (camNextBtn) camNextBtn.addEventListener('click', () => cycleCamera(1));

  timeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTime(btn.getAttribute('data-time'));
    });
  });

  // A mouse click mustn't leave the focus on a HUD button, or Space (jump / ascend) and Enter would press it again
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn && e.detail > 0) btn.blur();
  });

  // Where you are: the place's name over its street corner, drawn as a pair of street-name signs
  const roadNames = new Set(window.CITY.ROADS.map((r) => r.name));
  const placeNames = new Set(window.CITY.CITY_LANDMARKS.map((l) => l.name));
  let locationText = '';
  function renderLocation(label) {
    if (!elLocation || label === locationText) return;
    locationText = label;
    let place = '';
    let streets = label;
    const split = label.indexOf(' · ');
    if (split >= 0) {
      place = label.slice(0, split);
      streets = label.slice(split + 3);
    } else if (placeNames.has(label) || (!label.includes(' & ') && !roadNames.has(label))) {
      place = label;
      streets = '';
    }
    const nodes = [];
    if (place) {
      const el = document.createElement('div');
      el.className = 'location-place';
      el.textContent = place;
      nodes.push(el);
    }
    if (streets) {
      const row = document.createElement('div');
      row.className = 'location-signs';
      if (streets.startsWith('near ')) {
        streets = streets.slice(5);
        const near = document.createElement('span');
        near.className = 'location-near';
        near.textContent = 'near';
        row.appendChild(near);
      }
      for (const name of streets.split(' & ')) {
        const sign = document.createElement('span');
        sign.className = 'street-sign';
        sign.textContent = name;
        row.appendChild(sign);
      }
      nodes.push(row);
    }
    elLocation.replaceChildren(...nodes);
  }

  function teleportTo(x, z, heading = Math.PI) {
    const destination = controllerManager.teleportActiveTo(x, z, heading);
    touchControls.reset();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true);
    return destination;
  }

  const mapSystem = new CityMapSystem({
    controllerManager,
    cameraSystem,
    trafficSystem,
    onToggle: (open) => {
      controllerManager.resetInput();
      touchControls.setEnabled(!open);
      const mapHint = document.getElementById('fullmap-hover-info');
      if (open && touchControls.available && mapHint) {
        mapHint.textContent = 'Tap a place for directions · Drag to pan · Pinch to zoom';
      }
    },
    onTeleport: teleportTo
  });

  // The tour guide: search, directions, navigation & Tour Drive (tour-guide.js)
  const tourGuide = createTourGuide({ scene, controllerManager, cameraSystem, mapSystem, trafficSystem, teleportTo, selectMode });

  // Help: every control at a glance ([?] / F1)
  const helpModal = document.getElementById('help-modal');
  function toggleHelp(open = helpModal && helpModal.hidden) {
    if (!helpModal) return;
    helpModal.hidden = !open;
    controllerManager.resetInput();
    if (open) {
      const card = helpModal.querySelector(`[data-help-mode="${controllerManager.activeMode}"]`);
      helpModal.querySelectorAll('[data-help-mode]').forEach((c) => c.classList.toggle('current', c === card));
    }
  }
  const helpBtn = document.getElementById('btn-help');
  if (helpBtn) helpBtn.addEventListener('click', () => toggleHelp());
  const helpClose = document.getElementById('help-close');
  if (helpClose) helpClose.addEventListener('click', () => toggleHelp(false));
  if (helpModal) helpModal.addEventListener('click', (e) => { if (e.target === helpModal) toggleHelp(false); });

  teleportButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-teleport');
      const loc = window.CITY.TELEPORT_LOCATIONS[key];
      if (loc) {
        teleportTo(loc.x, loc.z, loc.heading);
      }
      closePopovers();
    });
  });

  const openMapBtn = document.getElementById('btn-open-map');
  if (openMapBtn) openMapBtn.addEventListener('click', () => mapSystem.toggleFullMap(true));

  if (hudToggleBtn) {
    hudToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('hud-minimized');
      const isMin = document.body.classList.contains('hud-minimized');
      hudToggleBtn.setAttribute('aria-pressed', String(isMin));
      hudToggleBtn.setAttribute('aria-label', isMin ? 'Show HUD' : 'Hide HUD');
      hudToggleBtn.title = isMin ? 'Show the HUD [H]' : 'Clean view: hide the HUD [H]';
      if (isMin) closePopovers();
    });
  }

  // Global keyboard shortcuts for modes (1-4), cameras (V / 5-0), and HUD (H)
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e)) return;
    switch (e.code) {
      case 'Digit1':
        selectMode('person');
        break;
      case 'Digit2':
        selectMode('car');
        break;
      case 'Digit3':
        selectMode('cyclist');
        break;
      case 'Digit4':
        selectMode('helicopter');
        break;
      case 'Digit5':
        selectCamera('chase', true);
        break;
      case 'Digit6':
        selectCamera('action', true);
        break;
      case 'Digit7':
        selectCamera('pov', true);
        break;
      case 'Digit8':
        selectCamera('trail', true);
        break;
      case 'Digit9':
        selectCamera('islands', true);
        break;
      case 'Digit0':
        selectCamera('cnTower', true);
        break;
      case 'KeyV':
        cycleCamera(e.shiftKey ? -1 : 1);
        break;
      case 'KeyH':
        if (hudToggleBtn) hudToggleBtn.click();
        break;
      case 'F1':
        e.preventDefault();
        toggleHelp();
        break;
      case 'Slash':
        if (e.shiftKey) toggleHelp(); // '?'
        break;
      case 'Escape':
        if (helpModal && !helpModal.hidden) toggleHelp(false);
        break;
    }
  });

  window.addEventListener('resize', () => {
    cameraSystem.onResize(window.innerWidth, window.innerHeight);
    renderer.setSize(window.innerWidth, window.innerHeight);
    placeModeIndicator();
    if (mapSystem.isFullMapOpen) {
      mapSystem.resizeFullCanvas();
      mapSystem.renderFullMap();
    }
  });

  // Links from the landing page: explore.html#place=National%20Mosque (go there), #to=... (directions to it),
  // #mode=walk|drive|cycle|fly, #locate (find where you really are)
  function openDeepLink() {
    const params = new URLSearchParams(location.hash.slice(1));
    const mode = { walk: 'person', drive: 'car', cycle: 'cyclist', fly: 'helicopter' }[params.get('mode')];
    if (mode) selectMode(mode);
    const place = params.get('place');
    const dest = params.get('to');
    if (params.has('locate')) tourGuide.requestLocation();
    const hit = (q) => (q ? tourGuide.search(q)[0] : null);
    if (place && hit(place)) {
      const p = hit(place);
      tourGuide.teleportToPlace(p);
      tourGuide.showPlace(p, { fly: false });
    } else if (dest && hit(dest)) {
      tourGuide.showDirections(hit(dest), { kind: 'mylocation', name: 'Your location' });
    }
  }

  // Initialize default selection
  selectMode('cyclist');
  selectCamera('chase', true);
  selectTime('golden');
  // the web fonts change the buttons' widths once they arrive
  if (document.fonts) document.fonts.ready.then(placeModeIndicator);
  markInit('ui');

  // The loading screen stays up while the shaders compile (precompileShaders() & the warm-up frame, see the loop) and
  // until the first frame is on screen
  if (loadingStatus) {
    loadingStatus.textContent = 'Compiling Shaders & Render Pipelines...';
  }

  // Expose programmatic API for testing & inspection
  let currentFps = 60;
  window.__CITY_APP = {
    renderer,
    scene,
    renderPipeline,
    postFX: { scenePass, ssrPass, bloomPass, colorGrade },
    cullingStats,
    cityBlocks,
    quadtree: cityBlocks.quadtree,
    trafficSystem,
    highwayTraffic,
    controllerManager,
    touchControls,
    cameraSystem,
    lightingSystem,
    mapSystem,
    selectMode,
    selectCamera,
    cycleCamera,
    selectTime,
    tourGuide,
    teleportTo,
    quality: QUALITY,
    getFps: () => currentFps
  };
  // The quality safety net & the ?fps=1 readout (quality.js), fed every real-time frame
  const qualityNet = QUALITY.attach(window.__CITY_APP);

  // 6b. Shader pre-compilation behind the loading screen. compileAsync() builds the node graphs in slices and has the GPU
  //     process compile the pipelines in parallel, but after every 8 ms slice it waits for a rendered frame, which
  //     leaves the main thread idle about half the time while nothing else animates; several calls side by side keep
  //     it busy (warm cache: 2.1 s instead of 4.0 s). (Rendering straight away compiled ~500 pipelines one after
  //     another: ~25 s with a cold shader cache.)
  const COMPILE_POOL = Number(new URLSearchParams(location.search).get('pool') ?? 16);
  const nextTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));
  async function precompileShaders() {
    // An empty frame first: it sets up the post-processing chain, which configures the scene pass's render target
    // (MSAA samples, depth format), so the pipelines compiled below are the very ones the scene pass asks for
    scene.visible = false;
    renderPipeline.render();
    scene.visible = true;
    markInit('postFX');

    // Every visible object with frustum culling off (like the warm-up frame, see the loop). Plain meshes that share
    // a material share its shader, so one job compiles them in turn (the first build serves the rest); every
    // instanced mesh gets a build of its own
    const culled = [];
    const jobs = [];
    const jobByMaterial = new Map();
    scene.traverseVisible((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
      if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
      // chunks of one mesh share its pipeline (the first one compiles it) and the shadow stand-ins only ever draw in
      // the shadow maps (the warm-up frame compiles those)
      if (o.userData.sharesPipelineWith || o.userData.shadowProxy) return;
      if (o.isInstancedMesh || Array.isArray(o.material)) {
        jobs.push([o]);
        return;
      }
      let job = jobByMaterial.get(o.material);
      if (!job) {
        job = [];
        jobByMaterial.set(o.material, job);
        jobs.push(job);
      }
      job.push(o);
    });

    renderer.setRenderTarget(scenePass.renderTarget);
    renderer.setMRT(sceneMRT);
    const compile = async (object) => {
      // Each compile starts in a task of its own: compileAsync() keeps one precompilation state on the renderer,
      // which must not be mid-step for two of them in the same microtask checkpoint
      await nextTask();
      try {
        await renderer.compileAsync(object, cameraSystem.camera, scene);
      } catch (e) {
        console.warn('[compile]', e); // the warm-up frame compiles it instead
      }
    };
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        for (const object of job) await compile(object);
        done++;
        if (loadingStatus) {
          loadingStatus.textContent = `Compiling Shaders & Render Pipelines... ${Math.round((done / jobs.length) * 100)}%`;
        }
        setLoadingProgress(done / jobs.length);
      }
    };
    await Promise.all(Array.from({ length: COMPILE_POOL }, worker));
    renderer.setMRT(null);
    renderer.setRenderTarget(null);
    for (const o of culled) o.frustumCulled = true;
  }

  await precompileShaders();
  markInit('compile');

  // 6. Animation Loop
  let lastTime = performance.now();
  let elapsed = 0;
  let frameCount = 0;
  let fpsTimer = 0;
  let warmedUp = false; // see the first frame below

  if (elFps) elFps.textContent = '60';

  // One frame of the city. Film mode (below) passes a fixed step: the simulation then advances exactly 1 / fps per
  // frame however long the frame takes to render, so recorded footage plays back perfectly smooth
  function frame(now, fixedDt = null) {
    const rawDt = fixedDt !== null ? fixedDt : (now - lastTime) * 0.001;
    lastTime = now;
    const dt = fixedDt !== null ? fixedDt : Math.min(Math.max(rawDt, 0.001), 0.05);
    elapsed += dt;

    // Update 3rd-person controllers, camera, signals, traffic & vehicle collisions, building LODs, and dynamic shadow focus
    controllerManager.update(dt, elapsed);
    cameraSystem.update(dt, elapsed);
    streetDetails.signalClock.value = elapsed;
    trafficSystem.update(
      dt,
      elapsed,
      cameraSystem.currentPos,
      controllerManager.getActiveEntity(),
      controllerManager.activeMode,
      cameraSystem.camera
    );
    highwayTraffic.update(dt, cameraSystem.camera, controllerManager.getActiveEntity(), controllerManager.activeMode);
    cityBlocks.update(cameraSystem.currentPos.x, cameraSystem.currentPos.z);
    if (cityBlocks.updateLights) cityBlocks.updateLights(cameraSystem.camera);
    if (streetDetails.update) streetDetails.update(cameraSystem.camera);
    for (const l of staticLights) { l.updateMatrixWorld(); if (l.target) l.target.updateMatrixWorld(); }
    lightingSystem.update(cameraSystem.currentPos);
    lakeWater.update(elapsed);
    if (skyClouds) skyClouds.update(dt);
    mapSystem.update();
    tourGuide.update(dt, elapsed);
    if (warmedUp) updateSceneCulling(cameraSystem.camera.position); // the warm-up frame draws every chunk

    // Render frame via TSL RenderPipeline (SSR + Bloom)
    if (!warmedUp) {
      // First frame = pipeline warm-up behind the loading screen, for what precompileShaders() can't reach (the shadow
      // map passes): with frustum culling off, every visible material's pipelines compile now instead of stalling the
      // first time the camera turns towards it (one chunk / shadow stand-in per shared pipeline is enough)
      const culled = [];
      scene.traverse((o) => {
        if (o.frustumCulled && !o.userData.sharesPipelineWith) {
          culled.push(o);
          o.frustumCulled = false;
        }
      });
      renderPipeline.render();
      for (const o of culled) o.frustumCulled = true;
      markInit('warmup');
    }
    renderPipeline.render();
    if (!warmedUp) {
      warmedUp = true;
      markInit('firstFrame');
      // The loading screen stays up until the GPU has got through the first frame (and the pipelines its warm-up
      // compiled), i.e. until the city is actually on screen
      const device = renderer.backend.device;
      Promise.resolve(device && device.queue.onSubmittedWorkDone()).catch(() => {}).then(() => {
        markInit('gpu');
        console.log(`[init] ${initTimings.join(', ')}`);
        initTimings = null;
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        setLoadingProgress(1);
        window.__CITY_APP.ready = true;
        openDeepLink();
      });
    }

    if (fixedDt === null && warmedUp) qualityNet.tick(Math.max(0, rawDt));

    // Telemetry uses wall time, not the clamped simulation step, so slow frames and high-refresh displays report
    // their actual frame rate (updates DOM every 250ms).
    frameCount++;
    fpsTimer += Math.max(0, rawDt);
    if (fpsTimer >= 0.25) {
      currentFps = Math.round(frameCount / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;

      const activeEnt = controllerManager.getActiveEntity();
      const mode = controllerManager.activeMode;
      const kmh = Math.round(Math.abs(activeEnt.speed) * 3.6);
      const altM = Math.max(0, Math.round(activeEnt.position.y));

      if (elFps) {
        elFps.textContent = String(currentFps);
        elFps.className = currentFps >= 50 ? 'fps-ok' : currentFps >= 30 ? 'fps-warn' : 'fps-bad';
      }
      if (elSpeed) elSpeed.textContent = String(kmh);
      if (elSpeedMeter) elSpeedMeter.style.transform = `scaleX(${Math.min(1, kmh / (topSpeedKmh[mode] || 130))})`;
      document.body.classList.toggle('is-boosting', controllerManager.keys.boost && kmh > 0);
      if (elAltitude) elAltitude.textContent = altM.toLocaleString('en-US');
      // The street corner of the player on the follow cameras, of the camera itself on the scenic ones
      const where = cameraSystem.getActivePreset().category === 'follow' ? activeEnt.position : cameraSystem.currentPos;
      renderLocation(getLocationLabel(where.x, where.z));
    }
  }
  renderer.setAnimationLoop(frame);

  // Film mode (tools/video/record.mjs): the real-time loop stops; each step() advances the simulation by exactly
  // 1 / fps, renders, and resolves once the GPU has finished the frame, ready to be captured
  window.__CITY_APP.film = {
    active: false,
    fps: 30,
    start(fps = 30) {
      this.fps = fps;
      this.active = true;
      renderer.setAnimationLoop(null);
    },
    async step(frames = 1) {
      for (let i = 0; i < frames; i++) frame(performance.now(), 1 / this.fps);
      const device = renderer.backend.device;
      if (device) await device.queue.onSubmittedWorkDone();
      return elapsed;
    },
    stop() {
      this.active = false;
      cameraSystem.cinema = null;
      lastTime = performance.now();
      renderer.setAnimationLoop(frame);
    }
  };
}

initApp();

})();
