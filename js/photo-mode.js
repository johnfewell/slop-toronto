(function () {
function createPhotoMode(app) {
  const C = window.CITY, camera = app.cameraSystem, resources = app.resources, store = C.createPostcardStore();
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = './css/photo.css'; document.head.append(style);
  const node = (tag, cls = '', value = '') => { const e = document.createElement(tag); e.className = cls; if (value) e.textContent = value; return e; };
  const button = (label, action, primary = false) => {
    const b = node('button', primary ? 'photo-button primary' : 'photo-button', label); b.type = 'button'; b.addEventListener('click', action); return b;
  };
  let state = 'inactive', overlay = null, epoch = 0, busy = false, pose = null, entryPose = null, entryMask = 1, entryNear = 0.35, framingBounds = null;
  let yaw = 0, pitch = 0, distance = 100, viewId = 'current', label = '', interior = false, current = null, imageURL = null, imageLease = null;
  let restoreFocus = null, inertNodes = [], drag = null, captionTimer = null, pageIndex = 0, selected = 0, albumItems = [], albumReturn = 'framing', gamepad = null, padRepeat = 0, albumGeneration = 0, previewPending = false;
  const keys = new Set(), blobs = new Map(), thumbnails = [];
  const root = node('section', 'photo-ui'); root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'photo-title');
  const header = node('div', 'photo-panel photo-header'), title = node('h2', '', 'Photo'); title.id = 'photo-title';
  const status = node('p', 'photo-status'); status.setAttribute('role', 'status');
  header.append(title, status, button('Return to city', () => close()));
  const center = node('div', 'photo-center'), preview = node('img', 'photo-preview'); preview.alt = 'Your Toronto photograph'; preview.hidden = true;
  const gallery = node('div', 'photo-gallery'); gallery.hidden = true; center.append(preview, gallery);
  const footer = node('div', 'photo-panel photo-footer'), framing = node('div', 'photo-framing'), editing = node('div', 'photo-editing'), albumBar = node('div', 'photo-album-actions');
  const views = node('select'); views.setAttribute('aria-label', 'Starting view');
  const viewOptions = [['current', 'Current view'], ['skyline', 'Skyline from the lake'], ['stLawrence', 'St. Lawrence Market'], ['sugarBeach', 'Sugar Beach'], ['viaduct', 'Don Valley viaduct']];
  for (const [id, name] of viewOptions) {
    const option = node('option', '', name); option.value = id; views.append(option);
  }
  const time = node('select'); time.setAttribute('aria-label', 'Light');
  for (const [id, name] of [['golden', 'Golden hour'], ['midday', 'Daylight'], ['twilight', 'Blue hour'], ['midnight', 'Night']]) {
    const option = node('option', '', name); option.value = id; time.append(option);
  }
  const lensLabel = node('label', 'photo-lens', 'Lens '), lens = node('input'); lens.type = 'range'; lens.min = '10'; lens.max = '120'; lens.step = '1'; lens.setAttribute('aria-label', 'Camera field of view'); lensLabel.append(lens);
  const shutter = button('Take photo', () => capture(), true), albumButton = button('Album', () => openAlbum());
  const moves = node('div', 'photo-moves');
  for (const [key, glyph, name] of [['left', '←', 'Move camera left'], ['forward', '↑', 'Move camera forward'], ['backward', '↓', 'Move camera back'], ['right', '→', 'Move camera right'], ['up', '+', 'Raise camera'], ['down', '−', 'Lower camera']]) {
    const b = button(glyph, () => {}); b.setAttribute('aria-label', name);
    b.addEventListener('pointerdown', (event) => { if (state !== 'framing') return; event.preventDefault(); keys.add(key); b.setPointerCapture(event.pointerId); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(type, () => keys.delete(key));
    moves.append(b);
  }
  const hint = node('p', 'photo-hint', 'Drag to look · WASD / arrows to move · Q/E for height · Space to take a photo');
  const captureSamples = 256;
  const progress = node('progress'); progress.max = captureSamples; progress.value = 0; progress.hidden = true; progress.setAttribute('aria-label', 'Preparing photograph');
  framing.append(views, time, lensLabel, moves, shutter, albumButton, hint, progress);
  const captionLabel = node('label', 'photo-caption', 'Caption'), caption = node('input'); caption.type = 'text'; caption.maxLength = 160; captionLabel.append(caption);
  const borderLabel = node('label', 'photo-border', ' Postcard border'), border = node('input'); border.type = 'checkbox'; borderLabel.prepend(border);
  const saveButton = button('Save on this device', () => save(), true), downloadButton = button('Download JPEG', () => download());
  const recallButton = button('Use this view', () => recall());
  editing.append(captionLabel, borderLabel, saveButton, downloadButton, recallButton, button('Back to camera', () => backToFraming()), button('Album', () => openAlbum()));
  const previousPage = button('Previous', () => { pageIndex--; renderAlbum(); }), nextPage = button('Next', () => { pageIndex++; renderAlbum(); });
  const pageLabel = node('span', 'photo-page');
  albumBar.append(previousPage, pageLabel, nextPage, button('Back to photo', () => leaveAlbum()));
  if (navigator.storage?.persist) albumBar.append(button('Protect saved photos', async () => {
    try { status.textContent = await navigator.storage.persist() ? 'Storage protection is on.' : 'Storage protection is unavailable. Keep a downloaded copy.'; }
    catch { status.textContent = 'Storage protection is unavailable. Keep a downloaded copy.'; }
  }));
  footer.append(framing, editing, albumBar); root.append(header, center, footer); document.body.append(root);
  const entry = node('div', 'photo-entry'); const entryPhoto = button('Photo', () => open()), entryAlbum = button('Album', () => openAlbum()); entry.append(entryPhoto, entryAlbum); document.body.append(entry);
  const toast = node('div', 'photo-toast'); toast.hidden = true; toast.setAttribute('role', 'status'); document.body.append(toast); let toastTimer = null;
  function tell(message) { toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 3500); }
  function setState(next) {
    state = next; root.dataset.phase = state; framing.hidden = state !== 'framing' && state !== 'capturing';
    editing.hidden = state !== 'preview'; gallery.hidden = state !== 'album'; albumBar.hidden = state !== 'album';
    preview.hidden = state !== 'preview'; progress.hidden = state !== 'capturing';
    shutter.disabled = state !== 'framing'; views.disabled = time.disabled = lens.disabled = state === 'capturing';
    albumButton.disabled = state === 'capturing'; for (const b of moves.children) b.disabled = state === 'capturing';
    hint.textContent = state === 'framing' ? 'Drag to look · WASD / arrows to move · Q/E for height · Space to take a photo · Controller: A photo, X album, Y view, D-pad left/right light'
      : 'Controller: A save/open · X download/delete · Y border/use view · B back · Bumpers change album page';
    hint.hidden = state === 'capturing'; footer.append(hint);
  }
  function retain(blob) {
    if (!blobs.has(blob)) blobs.set(blob, resources.track({ owner: 'photo', kind: 'image', resource: blob, cpuBytes: blob.size, gpuBytes: 0 }));
  }
  function releaseBlob(blob) { blobs.get(blob)?.release(); blobs.delete(blob); }
  function clearPreview() { preview.removeAttribute('src'); if (imageURL) URL.revokeObjectURL(imageURL); imageURL = null; imageLease?.release(); imageLease = null; }
  function clearCurrent() { clearPreview(); for (const lease of blobs.values()) lease.release(); blobs.clear(); current = null; }
  function clearThumbnails() {
    albumGeneration++;
    for (const thumb of thumbnails) { thumb.img.removeAttribute('src'); URL.revokeObjectURL(thumb.url); thumb.image.release(); thumb.blob.release(); }
    thumbnails.length = 0; gallery.replaceChildren();
  }
  function clearInput() { keys.clear(); gamepad = null; if (drag !== null && camera.domElement.hasPointerCapture(drag.id)) camera.domElement.releasePointerCapture(drag.id); drag = null; }
  function teardown() {
    epoch++; clearTimeout(captionTimer); clearInput(); clearCurrent(); clearThumbnails(); store.close();
    app.resetPhotoHistory();
    overlay = null; busy = false; previewPending = false; root.hidden = true; document.body.classList.remove('photo-active'); setState('inactive');
    for (const [element, value] of inertNodes) element.inert = value; inertNodes = [];
    if (restoreFocus?.isConnected) restoreFocus.focus(); restoreFocus = null;
  }
  function setPose(value) {
    pose = { position: [...value.position], target: [...value.target], fov: value.fov };
    const dx = pose.target[0] - pose.position[0], dy = pose.target[1] - pose.position[1], dz = pose.target[2] - pose.position[2];
    distance = Math.max(1, Math.hypot(dx, dy, dz)); yaw = Math.atan2(dx, dz); pitch = Math.asin(Math.max(-1, Math.min(1, dy / distance)));
    lens.value = String(pose.fov); camera.cinema = () => ({ pos: pose.position, look: pose.target, fov: pose.fov });
  }
  function open() {
    if (state !== 'inactive') return true;
    const lease = app.openOverlay('photo', { hold: true, onClose: teardown });
    if (!lease) { tell('The view is busy for a moment. Try again.'); return false; }
    overlay = lease; epoch++; restoreFocus = document.activeElement;
    entryPose = { position: camera.currentPos.toArray(), target: camera.currentLookAt.toArray(), fov: camera.camera.fov };
    framingBounds = { minX: Math.min(C.CITY_BOUNDS.minX, entryPose.position[0]) - 500,
      maxX: Math.max(C.CITY_BOUNDS.maxX, entryPose.position[0]) + 500,
      minZ: Math.min(C.CITY_BOUNDS.minZ, entryPose.position[2]) - 500,
      maxZ: Math.max(C.CITY_BOUNDS.maxZ, entryPose.position[2], C.GEO.points.cnTower[1] + 4200) + 500 };
    entryMask = camera.camera.layers.mask; entryNear = camera.camera.near;
    for (const element of document.body.children) if (element !== root && element.id !== 'canvas-container' && element !== toast) { inertNodes.push([element, element.inert]); element.inert = true; }
    label = C.getLocationLabel(app.controllerManager.getActiveEntity().position.x, app.controllerManager.getActiveEntity().position.z);
    viewId = 'current'; views.value = 'current'; time.value = app.lightingSystem.activePresetId; caption.value = label; border.checked = false;
    interior = app.rideSession.active || app.subwayRide.inside; setPose(entryPose); setState('framing');
    root.hidden = false; document.body.classList.add('photo-active'); status.textContent = 'The city is paused while you frame the shot.'; shutter.focus();
    return true;
  }
  function close() { if (overlay) overlay.release(); }
  function chooseView(id) {
    if (state !== 'framing') return;
    clearInput(); viewId = id; views.value = id; interior = id === 'current' && (app.rideSession.active || app.subwayRide.inside);
    camera.camera.layers.mask = id === 'current' ? entryMask : 1; camera.camera.near = id === 'current' ? entryNear : 0.35;
    camera.camera.far = 60000; camera.camera.updateProjectionMatrix();
    const cn = C.GEO.points.cnTower;
    if (id === 'skyline') { setPose({ position: [-2330, 8, 1030], target: [-520, 195, 110], fov: 32 }); label = 'Toronto skyline from the lake'; }
    else if (id === 'stLawrence') {
      const p = C.TELEPORT_LOCATIONS.stLawrence, site = C.LANDMARK_SITES.stLawrence;
      const y = app.controllerManager.getGroundHeight(p.x, p.z, 'person') + 1.7;
      setPose({ position: [p.x, y, p.z], target: [site.x, y + 8, site.z], fov: 54 }); label = 'St. Lawrence Market';
    }
    else if (id === 'sugarBeach') { const p = C.worldFromLatLon(43.6421, -79.3662); setPose({ position: [p.x, 2.6, p.z], target: [cn[0], 120, cn[1]], fov: 50 }); label = 'Sugar Beach'; }
    else if (id === 'viaduct') {
      const route = app.subwayRide.routes[0], p = C.sampleSubwayRide(route, (route.open0 + route.open1) / 2);
      setPose({ position: [p.x + Math.cos(p.yaw) * 240, p.y + 48, p.z - Math.sin(p.yaw) * 240], target: [p.x, p.y + 3, p.z], fov: 55 }); label = 'Prince Edward Viaduct';
    } else { setPose(entryPose); label = C.getLocationLabel(app.controllerManager.getActiveEntity().position.x, app.controllerManager.getActiveEntity().position.z); }
    caption.value = label; app.resetPhotoHistory();
  }
  views.addEventListener('change', () => chooseView(views.value));
  time.addEventListener('change', () => { if (state === 'framing') { app.applyVisualTime(time.value); app.resetPhotoHistory(); } });
  lens.addEventListener('input', () => { if (pose && state === 'framing') { pose.fov = Number(lens.value); viewId = null; } });
  async function showPreview(blob, token) {
    clearPreview(); if (token !== epoch || !overlay) return;
    imageURL = URL.createObjectURL(blob); preview.src = imageURL;
    imageLease = resources.track({ owner: 'photo', kind: 'image', resource: preview, cpuBytes: 0, gpuBytes: null });
    try { await preview.decode(); if (token === epoch) imageLease?.update({ cpuBytes: preview.naturalWidth * preview.naturalHeight * 4 }); }
    catch (error) { if (token === epoch) throw error; }
  }
  async function updatePreview() {
    if (!current || current.loaded) return;
    if (busy) { previewPending = true; return; }
    const requestedCaption = caption.value, requestedBorder = border.checked;
    const token = epoch; busy = true; saveButton.disabled = downloadButton.disabled = true; status.textContent = 'Preparing your photo…';
    try {
      clearPreview();
      const prepared = await C.preparePostcardImage(current.clean, { caption: requestedCaption, postcard: requestedBorder, resources });
      if (token !== epoch || !overlay) return;
      if (current.final && current.final.blob !== current.clean.blob) releaseBlob(current.final.blob);
      if (current.thumbnail) releaseBlob(current.thumbnail);
      current.final = prepared.final; current.thumbnail = prepared.thumbnail; retain(prepared.final.blob); retain(prepared.thumbnail);
      current.composition.caption = requestedCaption; current.composition.postcard = requestedBorder;
      current.composition.encoding = { width: prepared.final.width, height: prepared.final.height, quality: prepared.final.quality }; current.saved = false;
      await showPreview(prepared.final.blob, token);
      if (token === epoch) status.textContent = 'Photo ready. Download it or save it here.';
    } catch { if (token === epoch) status.textContent = 'Could not prepare that version. Try the clean photo again.'; }
    finally {
      if (token === epoch) {
        busy = false;
        if (previewPending || caption.value !== requestedCaption || border.checked !== requestedBorder) { previewPending = false; updatePreview(); }
        else { saveButton.disabled = !current?.final || !imageURL; downloadButton.disabled = !imageURL; }
      }
    }
  }
  for (const [element, event] of [[caption, 'input'], [border, 'change']]) element.addEventListener(event, () => {
    if (current && !current.loaded) current.saved = false;
    saveButton.disabled = downloadButton.disabled = true;
    clearTimeout(captionTimer); captionTimer = setTimeout(() => { if (state === 'preview') updatePreview(); }, 220);
  });
  async function capture() {
    if (state !== 'framing' || busy) return false;
    const captureLease = app.beginPhotoCapture(); if (!captureLease) { status.textContent = 'The camera is busy. Try again.'; return false; }
    const token = ++epoch, createdAtUtc = new Date().toISOString(); clearInput(); clearCurrent(); setState('capturing'); status.textContent = 'Preparing photo…'; progress.value = 0;
    const deadline = performance.now() + 15000;
    const bounded = async (operation) => {
      let timer;
      try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Photo preparation timed out')), Math.max(0, deadline - performance.now())); })]); }
      finally { clearTimeout(timer); }
    };
    try {
      for (let i = 0; i < captureSamples; i++) {
        if (token !== epoch || performance.now() > deadline) throw new Error('Photo preparation timed out');
        await bounded(captureLease.renderHeld({ resetHistory: i === 0, sampleFrame: i === 0 ? 0 : null })); progress.value = i + 1;
      }
      const clean = await bounded(captureLease.jpeg()); if (token !== epoch || !overlay) return false;
      const stamp = document.querySelector('meta[name="city-build"]')?.content;
      current = { clean, loaded: false, saved: false, composition: { schemaVersion: 1, id: crypto.randomUUID(), createdAtUtc,
        appBuild: /^[a-f0-9]{12}$/.test(stamp || '') ? stamp : 'development', viewId, locationLabel: label, caption: caption.value,
        qualityTier: app.quality.tier, cloudPreset: app.clockState().cloudPreset,
        camera: { position: camera.currentPos.toArray(), target: camera.currentLookAt.toArray(), fov: camera.camera.fov, space: interior ? 'interior' : 'world' },
        environment: { presetId: app.lightingSystem.activePresetId, cloudPhase: app.clockState().cloud ?? 0 } } };
      retain(clean.blob); caption.readOnly = false; border.disabled = false; recallButton.hidden = true; setState('preview');
      await updatePreview(); if (token !== epoch) return false;
      if (!current?.final || !imageURL) throw new Error('Photo preview failed');
      saveButton.focus(); return true;
    } catch { if (token === epoch && overlay) { clearCurrent(); busy = false; previewPending = false; setState('framing'); status.textContent = 'The photo could not finish. Your view is ready to try again.'; } return false; }
    finally { captureLease.release(); }
  }
  async function save() {
    if (!current?.final || busy || current.loaded || saveButton.disabled) return;
    const token = epoch, item = current; busy = true; saveButton.disabled = true; status.textContent = 'Saving photo…';
    try {
      await store.save(item.composition, item.final.blob, item.thumbnail);
      if (token === epoch) { item.saved = true; status.textContent = 'Saved on this device.'; }
    } catch { if (token === epoch) status.textContent = 'Could not save on this device. Download a copy instead.'; }
    finally { if (token === epoch) {
      busy = false; saveButton.disabled = item.saved;
      if (previewPending || caption.value !== item.composition.caption || border.checked !== item.composition.postcard) { previewPending = false; updatePreview(); }
    } }
  }
  function download() {
    if (!imageURL || !current?.final || busy || downloadButton.disabled) return;
    const link = node('a'); link.href = imageURL; link.download = `toronto-${current.composition.createdAtUtc.slice(0, 19).replace(/[:T]/g, '-')}.jpg`; link.click();
  }
  function backToFraming() {
    epoch++; clearTimeout(captionTimer); clearCurrent(); clearThumbnails(); clearInput(); busy = false;
    caption.readOnly = false; border.disabled = false; previewPending = false; setState('framing'); app.resetPhotoHistory(); status.textContent = 'Move the camera or choose a view.'; shutter.focus();
  }
  function recall() {
    if (!current?.composition) return;
    const record = current.composition, p = record.camera.position, b = C.CITY_BOUNDS;
    if (record.camera.space === 'interior') { status.textContent = 'This photo was taken inside a vehicle or station. Frame a new photo from your current ride.'; return; }
    if (p[0] < b.minX - 1000 || p[0] > b.maxX + 1000 || p[2] < b.minZ - 1000
        || p[2] > Math.max(b.maxZ, C.GEO.points.cnTower[1] + 4500) + 1000 || p[1] < 0 || p[1] > Math.max(800, entryPose.position[1] + 100)) {
      status.textContent = 'That saved view is outside the current area.'; return;
    }
    backToFraming(); interior = false; viewId = record.viewId; label = record.locationLabel;
    camera.camera.layers.mask = 1; camera.camera.near = 0.35; camera.camera.updateProjectionMatrix();
    setPose(record.camera); app.applyPhotoEnvironment(record.environment); time.value = app.lightingSystem.activePresetId; caption.value = record.caption;
    views.value = viewOptions.some(([id]) => id === viewId) ? viewId : 'current';
    app.resetPhotoHistory();
  }
  async function openAlbum() {
    if (busy || state === 'capturing') return;
    if (state === 'inactive' && !open()) return;
    epoch++; clearTimeout(captionTimer);
    albumReturn = current?.final ? 'preview' : 'framing'; clearPreview(); clearInput(); clearThumbnails(); setState('album'); pageIndex = 0; selected = 0;
    status.textContent = 'Opening album…'; const token = epoch;
    try {
      const items = await store.list(); if (token !== epoch || !overlay || state !== 'album') return; albumItems = items; await renderAlbum();
      if (token === epoch) (gallery.querySelector('button') || albumBar.querySelector('button:not([disabled])'))?.focus();
    }
    catch { if (token === epoch) { gallery.replaceChildren(node('p', 'photo-empty', 'The album is unavailable here. You can still take and download a photo.')); status.textContent = 'Your current photo has not been lost.'; } }
  }
  async function renderAlbum() {
    const token = epoch; clearThumbnails(); const generation = albumGeneration;
    const pages = Math.max(1, Math.ceil(albumItems.length / 8)); pageIndex = Math.max(0, Math.min(pages - 1, pageIndex));
    selected = Math.max(pageIndex * 8, Math.min(Math.min(albumItems.length - 1, pageIndex * 8 + 7), selected));
    previousPage.disabled = pageIndex === 0; nextPage.disabled = pageIndex === pages - 1; pageLabel.textContent = `${pageIndex + 1} / ${pages}`;
    status.textContent = albumItems.length ? `${albumItems.length} saved photo${albumItems.length === 1 ? '' : 's'}` : 'No saved photos yet.';
    if (!albumItems.length) gallery.append(node('p', 'photo-empty', 'Take a photo, then choose “Save on this device”.'));
    for (const [offset, item] of albumItems.slice(pageIndex * 8, pageIndex * 8 + 8).entries()) {
      const tile = node('div', 'photo-tile'), img = node('img'); img.alt = item.composition.caption || item.composition.locationLabel;
      const pick = button(item.composition.locationLabel, () => openSaved(item.id)); pick.prepend(img);
      const remove = button('Delete', async () => {
        if (busy) return; busy = true;
        try { await store.delete(item.id); if (token !== epoch) return; albumItems = albumItems.filter((v) => v.id !== item.id); await renderAlbum(); }
        catch { if (token === epoch) status.textContent = 'Could not delete this photo. Try again.'; }
        finally { if (token === epoch) busy = false; }
      });
      tile.dataset.index = String(pageIndex * 8 + offset); tile.append(pick, remove); gallery.append(tile);
      tile.classList.toggle('selected', Number(tile.dataset.index) === selected);
      try {
        const file = await store.get(item.id); if (token !== epoch || state !== 'album' || generation !== albumGeneration) return;
        if (!file) { pick.append(node('span', '', 'Photo no longer available')); continue; }
        const url = URL.createObjectURL(file.thumbnail), blobLease = resources.track({ owner: 'photo', kind: 'image', resource: file.thumbnail, cpuBytes: file.thumbnail.size, gpuBytes: 0 });
        const lease = resources.track({ owner: 'photo', kind: 'image', resource: img, cpuBytes: 0, gpuBytes: null }); thumbnails.push({ img, url, image: lease, blob: blobLease }); img.src = url;
        img.decode().then(() => lease.update({ cpuBytes: img.naturalWidth * img.naturalHeight * 4 })).catch(() => {});
      } catch { if (token === epoch) pick.append(node('span', '', 'Preview unavailable')); }
    }
  }
  async function openSaved(id) {
    if (busy) return; busy = true; const token = epoch;
    try {
      const item = await store.get(id); if (token !== epoch || !overlay) return;
      if (!item) { status.textContent = 'This photo is no longer in the album.'; return; }
      clearCurrent(); clearThumbnails(); retain(item.blob); retain(item.thumbnail);
      current = { loaded: true, saved: true, final: { blob: item.blob }, thumbnail: item.thumbnail, composition: item.composition };
      caption.value = item.composition.caption; caption.readOnly = true; border.checked = item.composition.postcard; border.disabled = true; recallButton.hidden = false;
      saveButton.disabled = true; downloadButton.disabled = false; setState('preview'); await showPreview(item.blob, token);
      if (token === epoch) { status.textContent = 'Saved on this device. Use this view to take a new photo.'; downloadButton.focus(); }
    } catch { if (token === epoch) status.textContent = 'This saved image could not be opened.'; }
    finally { if (token === epoch) busy = false; }
  }
  async function leaveAlbum() {
    epoch++; busy = false; clearThumbnails();
    if (albumReturn === 'preview' && current?.final) {
      setState('preview');
      try { await showPreview(current.final.blob, epoch); downloadButton.focus(); }
      catch { status.textContent = 'The preview could not open. Return to the camera to try again.'; }
    } else backToFraming();
  }
  function look(dx, dy) {
    if (!dx && !dy) return;
    yaw -= dx; pitch = Math.max(-1.4, Math.min(1.4, pitch - dy));
    pose.target = [pose.position[0] + Math.sin(yaw) * Math.cos(pitch) * distance, pose.position[1] + Math.sin(pitch) * distance, pose.position[2] + Math.cos(yaw) * Math.cos(pitch) * distance]; viewId = null;
  }
  const canvas = camera.domElement;
  canvas.addEventListener('pointerdown', (event) => { if (state === 'framing' && !drag && event.button === 0) { drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); event.preventDefault(); } });
  canvas.addEventListener('pointermove', (event) => { if (state === 'framing' && drag?.id === event.pointerId) { look((event.clientX - drag.x) * 0.004, (event.clientY - drag.y) * 0.004); drag.x = event.clientX; drag.y = event.clientY; } });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, (event) => { if (drag?.id === event.pointerId) drag = null; });
  canvas.addEventListener('wheel', (event) => { if (state === 'framing') { event.preventDefault(); pose.fov = Math.max(10, Math.min(120, pose.fov + event.deltaY * 0.02)); lens.value = String(pose.fov); } }, { passive: false });
  const bindings = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'backward', ArrowDown: 'backward', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyQ: 'down', KeyE: 'up', ShiftLeft: 'boost', ShiftRight: 'boost' };
  window.addEventListener('keydown', (event) => {
    if (C.isTypingInField(event)) return;
    if (event.code === 'KeyP' && !event.repeat && !event.ctrlKey && !event.metaKey) { event.preventDefault(); state === 'inactive' ? open() : close(); return; }
    if (state !== 'framing') return;
    if (bindings[event.code]) { event.preventDefault(); keys.add(bindings[event.code]); }
    else if (event.code === 'Space' && event.target?.tagName !== 'BUTTON' && !event.repeat) { event.preventDefault(); capture(); }
  });
  window.addEventListener('keyup', (event) => { if (bindings[event.code]) keys.delete(bindings[event.code]); });
  window.addEventListener('blur', clearInput); document.addEventListener('visibilitychange', () => { clearInput(); if (document.hidden && state === 'capturing') close(); });
  window.addEventListener('resize', () => { if (state === 'capturing') { close(); tell('Window resized. Open Photo to frame the new view.'); } });
  root.addEventListener('keydown', (event) => {
    if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.code !== 'Tab') return;
    const focusable = [...root.querySelectorAll('button,input,select')].filter((v) => !v.disabled && v.getClientRects().length);
    const next = (focusable.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
    if (focusable.length) { event.preventDefault(); focusable[next].focus(); }
  });
  function update(dt) {
    if (state !== 'framing' || !pose || document.hidden) return;
    const axis = (positive, negative) => Number(keys.has(positive)) - Number(keys.has(negative));
    const forward = axis('forward', 'backward') - (gamepad?.move.y || 0), side = axis('right', 'left') + (gamepad?.move.x || 0), up = axis('up', 'down') + (gamepad?.rise || 0);
    if (gamepad) { look(gamepad.look.x * dt * 1.5, gamepad.look.y * dt * 1.5); pose.fov = Math.max(10, Math.min(120, pose.fov + gamepad.zoom * dt * 25)); lens.value = String(pose.fov); }
    if (!forward && !side && !up) return;
    const amount = dt * (keys.has('boost') ? 70 : 18), old = [...pose.position];
    pose.position[0] += (Math.sin(yaw) * forward + Math.cos(yaw) * side) * amount;
    pose.position[2] += (Math.cos(yaw) * forward - Math.sin(yaw) * side) * amount; pose.position[1] += up * amount;
    const b = framingBounds;
    if (interior) pose.position = pose.position.map((v, i) => Math.max(entryPose.position[i] - 0.7, Math.min(entryPose.position[i] + 0.7, v)));
    else { pose.position[0] = Math.max(b.minX, Math.min(b.maxX, pose.position[0])); pose.position[2] = Math.max(b.minZ, Math.min(b.maxZ, pose.position[2])); pose.position[1] = Math.max(0.35, Math.min(Math.max(800, entryPose.position[1] + 100), pose.position[1])); }
    pose.target = pose.target.map((v, i) => v + pose.position[i] - old[i]); viewId = null;
  }
  function onGamepad(input) {
    if (!overlay) return false;
    if (input.reset) { gamepad = null; return true; }
    if (input.back) { state === 'preview' ? backToFraming() : state === 'album' ? leaveAlbum() : close(); return true; }
    if (state === 'framing') {
      gamepad = input;
      if (input.confirm) capture();
      else if (input.next || input.viewStep) { const ids = viewOptions.map(([id]) => id), at = Math.max(0, ids.indexOf(viewId)); views.value = ids[(at + (input.viewStep || 1) + ids.length) % ids.length]; chooseView(views.value); }
      else if (input.secondary) openAlbum();
      else if (input.timeStep) { const ids = ['golden', 'midday', 'twilight', 'midnight']; time.value = ids[(ids.indexOf(time.value) + input.timeStep + 4) % 4]; time.dispatchEvent(new Event('change')); }
    } else if (state === 'preview') {
      if (input.confirm) save(); if (input.secondary) download();
      if (input.next) { if (current?.loaded) recall(); else { border.checked = !border.checked; border.dispatchEvent(new Event('change')); } }
    }
    else if (state === 'album' && !busy) {
      padRepeat -= input.dt;
      const step = Math.abs(input.move.y) > 0.5 ? Math.sign(input.move.y) * (matchMedia('(max-width: 640px)').matches ? 2 : 4) : Math.abs(input.move.x) > 0.5 ? Math.sign(input.move.x) : 0;
      if (step && padRepeat <= 0 && albumItems.length) { selected = (selected + step + albumItems.length) % albumItems.length; pageIndex = Math.floor(selected / 8); renderAlbum(); padRepeat = 0.25; }
      if (input.viewStep) { pageIndex += input.viewStep; renderAlbum(); }
      if (input.confirm && albumItems[selected]) openSaved(albumItems[selected].id);
      if (input.secondary) gallery.querySelector('.photo-tile.selected button:last-child')?.click();
    }
    return true;
  }
  return { open, close, openAlbum, capture, save, download, chooseView, update, onGamepad,
    get state() { return state; }, get composition() { return current?.composition || null; }, get store() { return store; }, get previewBlob() { return current?.final?.blob || null; } };
}
Object.assign(window.CITY, { createPhotoMode });
})();
