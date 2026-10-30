(() => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const until = async (predicate) => { for (let i = 0; i < 100; i++) { if (predicate()) return; await wait(50); } throw new Error('Photo UI did not settle'); };
  window.__testPhoto = async (view, postcard = false, preset = 'golden') => {
    const a = window.__CITY_APP, p = a.photoMode; check(p, 'Photo interface not enabled');
    p.close(); await wait(200);
    const ground = a.controllerManager.getActiveEntity().position.toArray(), baseline = a.resourceSnapshot().owned.liveCount;
    check(p.open(), 'Photo could not open'); p.chooseView(view);
    const light = document.querySelector('select[aria-label="Light"]'); light.value = preset; light.dispatchEvent(new Event('change'));
    const pending = p.capture(); check(await p.capture() === false, 'Repeated shutter started a second capture');
    check(await pending, 'Photo capture failed: ' + document.querySelector('.photo-status').textContent);
    check(p.state === 'preview' && p.previewBlob?.type === 'image/jpeg' && p.previewBlob.size <= 2 * 1024 * 1024, 'Invalid encoded photo');
    if (postcard) {
      const caption = document.querySelector('.photo-caption input'), border = document.querySelector('.photo-border input');
      caption.value = 'Toronto, from the lake'; caption.dispatchEvent(new Event('input', { bubbles: true }));
      border.checked = true; border.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => p.composition.caption === 'Toronto, from the lake' && p.composition.postcard && ![...document.querySelectorAll('.photo-editing button')].find((b) => b.textContent.startsWith('Save')).disabled);
    }
    const bitmap = await createImageBitmap(p.previewBlob); check(Math.max(bitmap.width, bitmap.height) <= 1920, 'Photo exceeds long-edge cap'); bitmap.close();
    await p.save(); check((await p.store.list()).some((v) => v.id === p.composition.id), 'Save was not committed');
    check(/^[a-f0-9]{12}$/.test(p.composition.appBuild), 'Saved build does not identify loaded document');
    check(JSON.stringify(a.controllerManager.getActiveEntity().position.toArray()) === JSON.stringify(ground), 'Camera moved physical player');
    window.__photoBaseline = baseline;
    console.log('[ride-check] photo ' + view + ' passed ' + JSON.stringify({ bytes: p.previewBlob.size, composition: p.composition, owned: a.resourceSnapshot().owned }));
  };
  window.__testPhotoAlbum = async (close = false) => {
    const a = window.__CITY_APP, p = a.photoMode;
    await p.openAlbum(); check(p.state === 'album', 'Album did not open');
    await until(() => document.querySelectorAll('.photo-tile').length > 0);
    check(document.querySelectorAll('.photo-tile img').length <= 8, 'Unbounded decoded album window');
    if (!close) return;
    p.close(); await wait(150);
    check(!a.rideSession.overlay && !window.CITY.uiOverlay && a.resourceSnapshot().owned.liveCount === window.__photoBaseline, 'Photo resources/input gate leaked on close');
    check(!document.body.classList.contains('photo-active'), 'Photo UI remained visible');
    console.log('[ride-check] photo album cleanup passed');
  };

  window.__testPhotoCancellation = async () => {
    const a = window.__CITY_APP, p = a.photoMode;
    p.close(); await wait(100); const baseline = a.resourceSnapshot().owned.liveCount;
    p.open(); p.chooseView('skyline'); const pending = p.capture(); await wait(80); p.close();
    check(await pending === false, 'Cancelled capture reported success'); await wait(100);
    check(p.state === 'inactive' && !a.experience.overlay && a.resourceSnapshot().owned.liveCount === baseline, 'Cancelled capture retained UI/resources');
    check(p.open(), 'Cancelled capture retained frame authority'); p.close();
    console.log('[ride-check] photo cancellation passed');
  };

  window.__testPhotoDeviceLoss = async () => {
    const a = window.__CITY_APP, p = a.photoMode;
    p.close(); await wait(100); const baseline = a.resourceSnapshot().owned.liveCount;
    p.open(); const pending = p.capture(); await wait(80); a.renderer.backend.device.destroy();
    check(await pending === false, 'Destroyed device completed photo'); await until(() => a.deviceLost); await wait(100);
    check(p.state === 'inactive' && !a.experience.overlay && a.resourceSnapshot().owned.liveCount === baseline, 'Device loss retained photo/session resources');
    check(!p.open(), 'Photo reopened on a lost device');
    console.log('[ride-check] photo real GPU device-loss cleanup passed');
  };

  window.__testPhotoHidden = async () => {
    const a = window.__CITY_APP, p = a.photoMode;
    p.close(); await wait(100); const baseline = a.resourceSnapshot().owned.liveCount;
    p.open(); const pending = p.capture(); await wait(80);
    // Controlled browser lifecycle signal; this tests the real handlers, not OS background policy.
    const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange')); check(await pending === false, 'Hidden capture completed');
    } finally {
      if (descriptor) Object.defineProperty(document, 'hidden', descriptor); else delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    }
    await wait(100); check(p.state === 'inactive' && !a.experience.overlay && a.resourceSnapshot().owned.liveCount === baseline, 'Hidden capture leaked');
    check(p.open(), 'Visibility return kept frame ownership'); p.close();
    console.log('[ride-check] photo hidden-signal cleanup passed');
  };

  window.__startPhotoInput = async () => {
    const a = window.__CITY_APP, p = a.photoMode;
    p.close(); await wait(150); p.open(); p.chooseView('skyline');
    window.__photoInputBefore = { camera: [...a.cameraSystem.cinema().pos], ground: a.controllerManager.getActiveEntity().position.toArray(), clock: a.clockState().simulation };
  };
  window.__endPhotoInput = (kind) => {
    const a = window.__CITY_APP, before = window.__photoInputBefore;
    check(Math.hypot(...a.cameraSystem.cinema().pos.map((v, i) => v - before.camera[i])) > 0.1, kind + ' did not move camera');
    check(JSON.stringify(a.controllerManager.getActiveEntity().position.toArray()) === JSON.stringify(before.ground) && a.clockState().simulation === before.clock, kind + ' moved simulation');
    a.photoMode.close(); check(Object.values(a.controllerManager.keys).every((v) => !v), kind + ' retained input');
    console.log('[ride-check] photo native ' + kind + ' input passed');
  };
  window.__testPhotoGamepad = async () => {
    await window.__startPhotoInput(); const a = window.__CITY_APP;
    const original = navigator.getGamepads;
    const pad = { connected: true, index: 0, id: 'photo-fixture', mapping: 'standard', axes: [0, -1, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    try { navigator.getGamepads = () => [pad]; a.gamepadControls.reset(); await wait(250); }
    finally { navigator.getGamepads = original; a.gamepadControls.reset(); }
    window.__endPhotoInput('standard-gamepad fixture');
  };

  window.__testPhotoFailures = async () => {
    const a = window.__CITY_APP, p = a.photoMode;
    p.close(); await wait(100); p.open(); p.chooseView('sugarBeach'); check(await p.capture(), 'Failure fixture capture failed');
    const encoded = p.previewBlob, put = IDBObjectStore.prototype.put;
    const before = (await p.store.list()).map((v) => v.id).sort().join(',');
    try {
      IDBObjectStore.prototype.put = function (...args) { if (this.name === 'images') throw new DOMException('Fixture quota', 'QuotaExceededError'); return put.apply(this, args); };
      await p.save();
    } finally { IDBObjectStore.prototype.put = put; }
    check(document.querySelector('.photo-status').textContent.includes('Could not save'), 'Quota failure was shown as saved');
    check((await p.store.list()).map((v) => v.id).sort().join(',') === before, 'Quota failure changed saved album');
    check(p.previewBlob === encoded && ![...document.querySelectorAll('button')].find((b) => b.textContent === 'Download JPEG').disabled, 'Quota failure lost download');
    p.store.close(); const open = indexedDB.open;
    try {
      indexedDB.open = () => { throw new DOMException('Fixture disabled storage', 'SecurityError'); };
      await p.openAlbum();
      check(document.querySelector('.photo-empty').textContent.includes('unavailable'), 'Disabled album did not explain fallback');
    } finally { indexedDB.open = open; }
    p.close(); await wait(100);
    console.log('[ride-check] photo storage failure fallbacks passed');
  };

  window.__testPhotoCycles = async (count = 20) => {
    const a = window.__CITY_APP, p = a.photoMode;
    p.close(); await wait(100); const baseline = a.resourceSnapshot().owned.liveCount;
    const memory = [], clocks = [];
    // Keep the city held for the renderer comparison: live fleet creation/retirement would make
    // global memory snapshots from separately resumed sessions an unmatched measurement.
    p.open();
    const warming = [], warm = a.beginPhotoCapture(); check(warm, 'Warm-up could not acquire hold');
    try {
      for (let round = 0; round < 2; round++) for (const view of ['skyline', 'stLawrence', 'sugarBeach', 'viaduct']) {
        p.chooseView(view); await warm.renderHeld({ resetHistory: true, sampleFrame: 0 }); warming.push({ view, memory: { ...a.renderer.info.memory } });
      }
    } finally { warm.release(); }
    for (let i = 0; i < count; i++) {
      p.chooseView(['skyline', 'stLawrence', 'sugarBeach', 'viaduct'][i % 4]); check(await p.capture(), `Cycle ${i} failed`);
      memory.push({ ...a.renderer.info.memory }); clocks.push(a.clockState().simulation);
      p.onGamepad({ back: true }); await wait(40);
      check(a.resourceSnapshot().owned.liveCount === baseline, `Cycle ${i} leaked owned resources`);
      if ((i + 1) % 5 === 0) console.log(`[ride-check] photo cycles ${i + 1}/${count}`);
    }
    console.log('[ride-check] photo lifecycle samples ' + JSON.stringify({ first: memory[0], last: memory.at(-1), distinctSnapshots: new Set(memory.map((v) => JSON.stringify(v))).size }));
    check(clocks.every((v) => v === clocks[0]), 'Matched lifecycle scene advanced');
    check(JSON.stringify(memory[0]) === JSON.stringify(memory.at(-1)), 'Renderer memory grew across held photo cycles');
    p.close();
    for (let i = 0; i < count; i++) { check(p.open(), 'Repeated open failed'); p.close(); check(a.resourceSnapshot().owned.liveCount === baseline, 'Repeated close leaked'); }
    const result = { count, warming, memory, owned: a.resourceSnapshot().owned };
    console.log('[ride-check] photo lifecycle passed ' + JSON.stringify({ count, owned: result.owned })); return result;
  };

  window.__testPhotoSeat = async (kind) => {
    const a = window.__CITY_APP, p = a.photoMode;
    p.close(); a.selectMode(kind === 'car' ? 'car' : 'person'); await wait(350);
    if (kind !== 'car') { check(a.rideFeatured(kind === 'streetcar' ? '504' : 'subway'), 'Seat boarding failed'); await wait(400); }
    const car = a.rideSession.vehicle, owner = a.experience.owner;
    const camera = a.cameraSystem.camera;
    const projection = () => JSON.stringify([camera.layers.mask, camera.near, camera.far, camera.fov, a.cameraSystem.activePresetId]);
    const before = projection(), baseline = a.resourceSnapshot().owned.liveCount;
    p.open();
    if (kind !== 'car') {
      check(await p.capture(), 'Current seat capture failed'); check(p.composition.camera.space === 'interior', 'Seat capture was marked as exterior');
      p.onGamepad({ back: true });
    }
    p.chooseView('skyline'); check(await p.capture(), 'Exterior capture from seat failed');
    p.close(); check(projection() === before && a.rideSession.vehicle === car && a.experience.owner === owner, 'Seat camera/owner was not restored');
    check(a.resourceSnapshot().owned.liveCount === baseline, 'Seat capture leaked');
    a.selectMode('person'); console.log('[ride-check] photo seat ' + kind + ' passed');
  };

  window.__testPhotoAlbumActions = async () => {
    const a = window.__CITY_APP, p = a.photoMode;
    p.close(); const items = await p.store.list(), base = await p.store.get(items[0].id);
    for (let i = 0; i < 10; i++) await p.store.save({ ...base.composition, id: 'gallery-fixture-' + i }, base.blob, base.thumbnail);
    await p.openAlbum(); check(document.querySelectorAll('.photo-tile img').length === 8, 'Album page did not bound images');
    const pad = { dt: 0.016, move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0, rise: 0 };
    p.onGamepad({ ...pad, viewStep: 1 }); await until(() => document.querySelector('.photo-page').textContent.startsWith('2 /'));
    await until(() => document.querySelectorAll('.photo-tile img[src]').length > 0);
    const count = (await p.store.list()).length;
    p.onGamepad({ ...pad, secondary: true }); await until(() => document.querySelector('.photo-status').textContent.startsWith(String(count - 1) + ' saved'));
    check((await p.store.list()).length === count - 1, 'Controller delete did not commit');
    // Keep an old page load pending, then return to the camera. It must never resurrect the album.
    const get = p.store.get; let release;
    p.store.get = () => new Promise((resolve) => { release = resolve; });
    p.onGamepad({ ...pad, viewStep: -1 }); await until(() => !!release);
    p.onGamepad({ ...pad, back: true }); release(base); p.store.get = get; await wait(100);
    check(p.state === 'framing', 'Late album load changed navigation');
    await p.openAlbum(); p.onGamepad({ ...pad, confirm: true }); await until(() => p.state === 'preview');
    const position = a.controllerManager.getActiveEntity().position.toArray(), record = p.composition;
    p.onGamepad({ ...pad, next: true }); await wait(50);
    check(p.state === 'framing' && a.clockState().cloud === record.environment.cloudPhase, 'Saved view did not recall its environment');
    check(JSON.stringify(position) === JSON.stringify(a.controllerManager.getActiveEntity().position.toArray()), 'Recall teleported player');
    p.close(); console.log('[ride-check] photo album paging/delete/late-load/recall passed');
  };

  window.__testPhotoConvergence = async (view, preset = 'golden') => {
    const a = window.__CITY_APP, p = a.photoMode;
    p.close(); await wait(150); p.open(); p.chooseView(view);
    const light = document.querySelector('select[aria-label="Light"]'); light.value = preset; light.dispatchEvent(new Event('change'));
    const lease = a.beginPhotoCapture(); check(lease, 'Convergence fixture did not acquire capture');
    const canvas = a.renderer.domElement, samples = [], clocks = [];
    const difference = async (first, second) => {
      const decode = async (data) => {
        const image = await createImageBitmap(await (await fetch(data)).blob()), c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
        const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0); const bytes = ctx.getImageData(0, 0, c.width, c.height).data;
        image.close(); c.width = c.height = 0; return bytes;
      };
      const x = await decode(first), y = await decode(second);
      const region = (from, to) => {
        let sum = 0, n = 0; const histogram = new Uint32Array(256);
        for (let i = Math.floor(from * canvas.height) * canvas.width * 4; i < Math.floor(to * canvas.height) * canvas.width * 4; i += 4) {
          for (let k = 0; k < 3; k++) { const d = Math.abs(x[i + k] - y[i + k]); histogram[d]++; sum += d; n++; }
        }
        let p95 = 0, seen = 0; for (; p95 < 255; p95++) { seen += histogram[p95]; if (seen >= n * 0.95) break; }
        return { meanAbsoluteRgbError: sum / n, p95AbsoluteRgbError: p95 };
      };
      return { all: region(0, 1), sky: region(0, 0.35), lower: region(0.7, 1) };
    };
    try {
      for (let run = 0; run < 2; run++) {
        const images = {}; let previous = -1; clocks.push(a.clockState());
        for (let i = 0; i < 512; i++) {
          const frame = await lease.renderHeld({ resetHistory: i === 0, sampleFrame: i === 0 ? 0 : null });
          check(frame.cloudFrame === i && frame.rendererFrame > previous, 'Convergence skipped an independent sample'); previous = frame.rendererFrame;
          if ([127, 255, 383, 511].includes(i)) images[i + 1] = canvas.toDataURL('image/png');
        }
        samples.push(images); clocks.push(a.clockState());
      }
      const earlierComparison = await difference(samples[0][128], samples[0][384]);
      const comparison = await difference(samples[0][256], samples[0][512]), repeat = await difference(samples[0][512], samples[1][512]);
      const pass = comparison.all.meanAbsoluteRgbError <= 0.5 && comparison.all.p95AbsoluteRgbError <= 2
        && comparison.sky.meanAbsoluteRgbError <= 1 && comparison.sky.p95AbsoluteRgbError <= 4
        && comparison.lower.meanAbsoluteRgbError <= 0.1 && comparison.lower.p95AbsoluteRgbError <= 1;
      const report = { build: document.querySelector('meta[name="city-build"]').content, view, preset, tier: a.quality.tier,
        frames: [256, 512], independentFrames: 1024, earlierComparison, comparison, repeat, clocks, passesSettlingScreen: pass };
      console.log('[ride-check] photo convergence ' + JSON.stringify(report));
      check(clocks.every((v) => v.simulation === clocks[0].simulation && v.shader === clocks[0].shader && v.cloud === clocks[0].cloud), 'Held convergence clocks changed');
      // A sub-quantization repeat error must be at least 10x below the strictest region bound.
      check(repeat.all.meanAbsoluteRgbError <= 0.01 && repeat.all.p95AbsoluteRgbError === 0, 'Same-reset held control changed');
      check(pass, '256-sample settling did not pass for ' + view + '/' + preset);
      return report;
    } finally { lease.release(); p.close(); }
  };
})();
