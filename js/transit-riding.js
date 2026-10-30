(function () {
// Shared passenger ownership and doors. Vehicle simulation remains in each transit system.
function openTransitDoors(car, stopIndex, dwell) {
  car.stopIndex = stopIndex;
  car.speed = 0;
  car.dwell = Math.max(8, dwell);
  car.doorState = 'opening';
  car.doorProgress = 0;
}

function stepTransitDoors(car, dt) {
  if (!car.doorState) car.doorState = 'closed';
  if (car.doorState === 'closed') return false;
  car.speed = 0;
  if (car.doorState === 'opening') {
    car.doorProgress = Math.min(1, car.doorProgress + dt / 0.7);
    if (car.doorProgress === 1) car.doorState = 'open';
  } else if (car.doorState === 'open') {
    car.dwell = Math.max(0, car.dwell - dt);
    if (car.hold > 0) {
      car.hold = Math.max(0, car.hold - dt);
      car.dwell = Math.max(car.dwell, car.hold);
    }
    if (car.ridden && car.stopIndex === car.lastPassengerStop) car.dwell = Math.max(car.dwell, 1);
    if (car.dwell === 0) car.doorState = 'closing';
  } else {
    car.doorProgress = Math.max(0, car.doorProgress - dt / 0.7);
    if (car.doorProgress === 0) car.doorState = 'closed';
  }
  return true;
}

// Shared by rides and temporary overlays, including camera-only photo framing.
function snapshotExperienceCamera(system) {
  const camera = system.camera;
  const vectors = {};
  for (const key of ['currentPos', 'currentLookAt', 'followOffset', 'followLookOffset']) vectors[key] = system[key]?.clone();
  return { preset: system.activePresetId, near: camera.near, far: camera.far, fov: camera.fov, mask: camera.layers.mask,
    yaw: system.orbitYawOffset, pitch: system.orbitPitchOffset, zoom: system.zoomMultiplier,
    cinema: system.cinema, followOverride: system.followOverride, followEntity: system.followEntity,
    initialized: system.initialized, followBaseY: system.followBaseY, smoothedSpeed: system.smoothedSpeed,
    userOrbitTimer: system.userOrbitTimer, position: camera.position.clone(), quaternion: camera.quaternion.clone(), vectors };
}
function restoreExperienceCamera(system, state) {
  const camera = system.camera;
  system.setCameraPreset(state.preset, true);
  Object.assign(system, { orbitYawOffset: state.yaw, orbitPitchOffset: state.pitch, zoomMultiplier: state.zoom,
    cinema: state.cinema, followOverride: state.followOverride, followEntity: state.followEntity,
    initialized: state.initialized, followBaseY: state.followBaseY, smoothedSpeed: state.smoothedSpeed,
    userOrbitTimer: state.userOrbitTimer });
  for (const [key, value] of Object.entries(state.vectors)) if (value) system[key].copy(value);
  Object.assign(camera, { near: state.near, far: state.far, fov: state.fov });
  camera.layers.mask = state.mask; camera.position.copy(state.position); camera.quaternion.copy(state.quaternion);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}

function createTransitRideSession({ controllerManager: controller, cameraSystem: camera, onAcquire = () => {}, onOverlayChange = () => {}, canOverlay = () => true }) {
  let saved = null, release = null, reservation = null, automaticReservation = null, transitions = 0, closing = false;
  const api = { active: false, entity: null, vehicle: null, overlay: null, begin, end, reserve, savedGround,
    openOverlay, closeOverlay, cancel,
    get owner() { return reservation?.owner || null; },
    get surfaceMode() { return reservation?.surfaceMode || saved?.mode; },
    get transitioning() { return transitions > 0 || closing; },
    get held() { return !!api.overlay?.hold; },
    beginTransition() {
      transitions++; let live = true;
      return () => { if (live) { live = false; transitions--; } };
    }
  };
  function savedGround(mode) {
    return reservation?.savedGround?.(mode) || (saved?.mode === mode ? { ...saved.ground } : null);
  }
  // Station visits reserve the same owner while the player walks on its platform. Boarding is an attachment
  // within that reservation, not acquisition by another locomotion owner.
  function reserve(owner, { savedGround = null, surfaceMode = null, onCancel = null } = {}) {
    if (!owner || reservation || api.active || api.overlay || controller.suspended) return false;
    const current = { owner, savedGround, surfaceMode, onCancel };
    reservation = current;
    try { onAcquire(owner); } catch (error) { reservation = null; throw error; }
    controller.resetInput();
    let live = true;
    return { release() {
      if (!live) return false;
      if (api.active || api.overlay) return false;
      live = false;
      if (reservation === current) reservation = null;
      return true;
    } };
  }
  function begin(vehicle, entity, releaseLease, { onCancel = null } = {}) {
    if (api.active || api.overlay || controller.suspended || !vehicle || !entity) return false;
    const owner = entity.type;
    if (reservation && reservation.owner !== owner) return false;
    if (!reservation) automaticReservation = reserve(owner, { onCancel });
    if (!reservation) return false;
    const ground = controller.getActiveEntity();
    saved = { mode: controller.activeMode,
      ground: { x: ground.position.x, y: ground.position.y, z: ground.position.z, heading: ground.heading },
      visible: ground.mesh.visible, camera: snapshotExperienceCamera(camera) };
    release = releaseLease;
    controller.resetInput(); controller.suspended = true;
    ground.speed = 0; ground.mesh.visible = false; ground.verticalVel = 0;
    camera.followOverride = entity;
    api.active = true; api.entity = entity; api.vehicle = vehicle;
    return true;
  }
  function end(destination = null) {
    if (!api.active || api.overlay) return false;
    const target = destination || saved.ground;
    if (!controller.findTeleportPosition(target.x, target.z, target.heading, target.y || 0, true)) return false;
    controller.setMode(saved.mode);
    const ground = controller.getActiveEntity();
    ground.position.set(target.x, target.y || 0, target.z); ground.heading = target.heading;
    controller.teleportActiveTo(target.x, target.z, target.heading, target.y);
    ground.mesh.visible = saved.visible; ground.prevX = ground.position.x; ground.prevZ = ground.position.z;
    controller.suspended = false; controller.resetInput(); camera.resetForTeleport();
    restoreExperienceCamera(camera, saved.camera);
    const done = release;
    release = null; api.active = false; api.entity = api.vehicle = null; saved = null;
    automaticReservation?.release(); automaticReservation = null;
    done?.();
    return true;
  }
  function openOverlay(id, { hold = false, restoreCamera = hold, onClose = null } = {}) {
    if (!id || api.overlay || transitions || closing || !canOverlay()) return false;
    const current = { id, hold, camera: restoreCamera ? snapshotExperienceCamera(camera) : null, onClose };
    api.overlay = current; window.CITY.uiOverlay = id; window.CITY.presentationHeld = hold;
    controller.resetInput(); camera._clearPointers?.();
    try { onOverlayChange(current, null); }
    catch (error) { closeOverlay({ cancel: true }); throw error; }
    let live = true;
    return { release(options) { if (!live || api.overlay !== current) return false; live = false; return closeOverlay(options); } };
  }
  function closeOverlay({ cancel = false } = {}) {
    const current = api.overlay;
    if (!current || closing) return false;
    closing = true;
    // Keep the hold during camera/environment restoration. Live applies resume only in onOverlayChange.
    try {
      if (current.camera) restoreExperienceCamera(camera, current.camera);
      current.onClose?.({ cancel });
    } finally {
      api.overlay = null; closing = false; window.CITY.uiOverlay = null; window.CITY.presentationHeld = false;
      controller.resetInput(); camera._clearPointers?.(); onOverlayChange(null, current);
    }
    return true;
  }
  function cancel() {
    closeOverlay({ cancel: true });
    if (reservation?.onCancel) return reservation.onCancel() !== false;
    return api.active ? end() : !reservation;
  }
  return api;
}

Object.assign(window.CITY, { openTransitDoors, stepTransitDoors, createTransitRideSession,
  snapshotExperienceCamera, restoreExperienceCamera });
})();
